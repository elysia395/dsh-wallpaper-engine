/**
 * verify-mp4-vfs.mjs — 「虚拟 faststart」（moov 前置的**服务期合成**）这条链的自检。
 *
 * 为什么独立成一个文件：这条链跨四个文件，任何一环退化都会让用户遇到"第一帧要等一两秒"
 * 或者更糟（解复用器按错偏移读 ⇒ 花屏）：
 *   ① `lib/mp4-vfs.js` 的布局数学：顶层盒表 → moov → `stco`/`co64` 每条 +len(moov) →
 *      段表。判不了（非 mp4 / 无 moov / 多个 mdat / 偏移落在 mdat 外 / 分片或辅助表 /
 *      moov 过大 / IO 失败）必须**安静回退原片**。
 *   ② `lib/serve.js` 的段映射发送：Range / HEAD / 416 / suffix 全套语义与 `serveFile`
 *      逐字一致，只有"字节从哪来"不同。
 *   ③ `lib/faststart.js` 的定音（同一次播放钉住同一份字节布局）+ 旧副本清扫。
 *   ④ `/media` 的消费点。
 *   ⑤ 「有缓存转码就直接播转码」那半条：`/media-info?fps=` 的**只读**缓存回答（见 E 段）——
 *      它与虚拟布局是同一件事的两半：都在让"第一帧之前少搬字节"。E 段的键算法由本文件**自己
 *      独立算一遍**（`sha256(abs|round(mtime)|fps)`），漂移才算得出来。
 *
 * 判据尽量走**公开面**（真 `apply()` + mock webServer + 真请求），因为"布局数学对不对"
 * 只有把服务出的字节与独立算出的期望字节逐字节比才判得干净。夹具**全在纯 JS 里手搓**
 * （不等 ffmpeg —— CI 未必有它，而这条链的正确性本来只是"盒子表 + 偏移平移"的算术）；
 * 真机 muxer 语义等价（framemd5 逐帧一致 / `-f null` 无输出）由 docs/CHANGELOG.md 记录。
 *
 * 隔离：`DSH_WE_DATA_DIR` / `DSH_WE_STEAM_ROOT` / `DSH_WE_CACHE_DIR` 全指向 `.test-cache/`，
 * 全程不碰真实 `~/.dsh-wallpaper-engine`，也不碰真实 Steam 库。
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Writable } from 'node:stream';

import { createFaststartKit } from '../lib/faststart.js';
import { analyzeMp4Layout, createMp4VfsKit } from '../lib/mp4-vfs.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ISO = join(root, '.test-cache', 'mp4-vfs');
const DATA_DIR = join(ISO, 'data');
const CACHE_DIR = join(ISO, 'cache');
const SWEEP_DIR = join(ISO, 'sweep-cache');
const STEAM = join(ISO, 'steam');
const FIXTURES = join(ISO, 'fixtures');
const WORKSHOP = join(STEAM, 'steamapps', 'workshop', 'content', '431960');

rmSync(ISO, { recursive: true, force: true });
for (const d of [DATA_DIR, CACHE_DIR, SWEEP_DIR, FIXTURES, WORKSHOP]) mkdirSync(d, { recursive: true });
// 隔离必须在 import lib/index.js **之前**生效（缓存根 / 数据目录 / 机库都在 import 期解析）。
process.env.DSH_WE_DATA_DIR = DATA_DIR;
process.env.DSH_WE_CACHE_DIR = CACHE_DIR;
process.env.DSH_WE_STEAM_ROOT = STEAM;
delete process.env.DSH_WE_UPLOAD_DIR;

// ── tiny check harness（与 verify-cache-dir.mjs 同形） ───────────────────────
let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) passed++;
  else failed++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
}
function section(title) { console.log('\n' + title); }

// ── 纯 JS 的 mp4 夹具（够 moov→trak→mdia→minf→stbl→stco/co64 这一条链） ──────
function box(type, payload) {
  const body = payload || Buffer.alloc(0);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
}
/** full box：version/flags(4) + 内容。 */
function fullBox(type, payload) { return box(type, Buffer.concat([Buffer.alloc(4), payload])); }
/** `stco`（4 字节/条）或 `co64`（8 字节/条）—— 全文件唯一的绝对偏移面。 */
function offsetTableBox(wide, offsets) {
  const body = Buffer.alloc(4 + offsets.length * (wide ? 8 : 4));
  body.writeUInt32BE(offsets.length, 0);
  offsets.forEach((v, i) => {
    if (wide) body.writeBigUInt64BE(BigInt(v), 4 + i * 8);
    else body.writeUInt32BE(v, 4 + i * 4);
  });
  return fullBox(wide ? 'co64' : 'stco', body);
}
function moovWith(tables, offsetsFor) {
  const traks = tables.map((t) => box('trak', box('mdia', box('minf', box('stbl',
    offsetTableBox(Boolean(t.wide), offsetsFor(t)))))));
  return box('moov', Buffer.concat(traks));
}
function mdatWith(len) {
  const payload = Buffer.alloc(len);
  for (let i = 0; i < len; i += 1) payload[i] = (i * 31 + 7) & 0xff;
  return box('mdat', payload);
}
const FTYP = () => box('ftyp', Buffer.from('isomiso2avc1mp41', 'latin1'));
const FREE = () => box('free');

/**
 * 造一份夹具，返回**独立算出的期望字节**（测试自己的 faststart 实现：moov 挪前 + 每条偏移
 * +len(moov)）——它与 lib/mp4-vfs.js 是两份独立代码，比对才有意义。
 */
function buildFixture(opts) {
  const o = opts || {};
  const tables = o.tables || [{ count: 5 }];
  const mdatLen = o.mdatLen || 400;
  const extras = o.extras || [];
  const before = Buffer.concat([FTYP(), FREE(), ...extras]);
  const mdat = mdatWith(mdatLen);
  const moovLen = moovWith(tables, (t) => t.count ? new Array(t.count).fill(0) : []).length;
  // moov 在尾：mdat 紧跟在 before 之后；moov 在前：mdat 再后移 len(moov)。
  const moovFirst = Boolean(o.moovFirst);
  const mdatStart = moovFirst ? before.length + moovLen : before.length;
  const offsetsFor = (t) => {
    const n = t.count || 0;
    const room = Math.max(1, mdatLen - 8);
    return Array.from({ length: n }, (_, i) => mdatStart + 8 + Math.floor(((i + 1) * room) / (n + 1)));
  };
  const moov = moovWith(tables, offsetsFor);
  const file = moovFirst
    ? Buffer.concat([before, moov, mdat])
    : Buffer.concat([before, mdat, moov]);
  const patchedMoov = moovWith(tables, (t) => offsetsFor(t).map((v) => v + moovLen));
  const expectedVirtual = Buffer.concat([before, patchedMoov, mdat]);
  return {
    file, before, mdat, moov, moovFirst,
    mdatStart, mdatLen, moovLen, offsetsFor,
    expectedVirtual, expectedPatchedMoov: patchedMoov,
  };
}

/** 按段表把虚拟字节拼出来（模拟 `lib/serve.js` 的 layoutRangeStream，逐字节）。 */
function bytesFromSegments(layout, absPath) {
  const src = readFileSync(absPath);
  const parts = [];
  for (const seg of layout.segments) {
    if (seg.buf) { parts.push(seg.buf); continue; }
    parts.push(src.subarray(seg.srcStart, seg.srcStart + seg.len));
  }
  return Buffer.concat(parts);
}
const hash = (buf) => buf.toString('base64').slice(0, 24);

function writeFixture(name, buf) {
  const p = join(FIXTURES, name);
  writeFileSync(p, buf);
  return p;
}
const reasonOf = (r) => (r && r.kind === 'none' ? r.reason : r && r.kind);

// ── A. 布局数学（纯函数，无 IO 之外的依赖） ──────────────────────────────────
section('A. lib/mp4-vfs.js：盒子表 → moov 搬家 → 段表');
const tail = buildFixture({ tables: [{ count: 5 }], mdatLen: 400 });
const tailPath = writeFixture('tail.mp4', tail.file);
{
  const r = analyzeMp4Layout(tailPath);
  check('A1 moov 在尾部的源 ⇒ virtual（这正是要搬家的情况）', r.kind === 'virtual', reasonOf(r));
  check('A2 虚拟总长与源**完全相同**（Content-Length / Range 端点因此逐字不变）',
    r.size === tail.file.length && r.moov.size === tail.moovLen && r.delta === tail.moovLen,
    `size=${r.size} delta=${r.delta}`);
  const served = bytesFromSegments(r, tailPath);
  check('A3 按段表拼出的字节 == 独立算出的 faststart 布局（逐字节）',
    served.equals(tail.expectedVirtual) && served.length === tail.file.length,
    `served=${served.length}B expected=${tail.expectedVirtual.length}B head=${hash(served)}`);
  check('A4 段表无缝无洞且顺序为 [before…][moov][mdat]',
    r.segments.length === 4
    && r.segments[2].buf !== null && r.segments[2].len === tail.moovLen
    && r.segments[3].srcStart === tail.mdatStart
    && r.segments.reduce((a, s) => a + s.len, 0) === tail.file.length);
  // 打了补丁的 moov：除了条目的 +delta，其余字节必须原样（盒子结构不许被动过）
  const entryStart = 8 + 8 + 8 + 8 + 8 + 8 + 4 + 4; // moov/trak/mdia/minf/stbl/stco 头 + version/flags + count
  const patchedEntries = [];
  for (let i = 0; i < 5; i += 1) patchedEntries.push(tail.expectedPatchedMoov.readUInt32BE(entryStart + i * 4));
  const wantEntries = tail.offsetsFor({ count: 5 }).map((v) => v + tail.moovLen);
  check('A5 stco 每条 = 原偏移 + len(moov)，且改前改后盒子长度不变',
    JSON.stringify(patchedEntries) === JSON.stringify(wantEntries)
    && tail.expectedPatchedMoov.length === tail.moov.length
    && tail.expectedPatchedMoov.subarray(0, entryStart).equals(tail.moov.subarray(0, entryStart)));
}
{
  const wide = buildFixture({ tables: [{ count: 4, wide: true }], mdatLen: 300 });
  const p = writeFixture('wide.mp4', wide.file);
  const r = analyzeMp4Layout(p);
  const got = [];
  const es = 8 + 8 + 8 + 8 + 8 + 8 + 4 + 4;
  for (let i = 0; i < 4; i += 1) got.push(Number(wide.expectedPatchedMoov.readBigUInt64BE(es + i * 8)));
  check('A6 co64（8 字节/条）走同一条平移：条目 +delta、tracks 记到宽表',
    r.kind === 'virtual' && r.tracks === 1
    && bytesFromSegments(r, p).equals(wide.expectedVirtual)
    && JSON.stringify(got) === JSON.stringify(wide.offsetsFor({ count: 4, wide: true }).map((v) => v + wide.moovLen)));
}
{
  const first = buildFixture({ moovFirst: true, tables: [{ count: 3 }] });
  const p = writeFixture('moov-first.mp4', first.file);
  const r = analyzeMp4Layout(p);
  check('A7 moov 本来就靠前 ⇒ plain（今天这条路的 Range 语义已经是对的，别多此一举）',
    r.kind === 'plain', reasonOf(r));
}
{
  // 畸形输入：一律安静回退原片（这条是优化，不是功能）
  const twoMdat = Buffer.concat([
    FTYP(), mdatWith(200), mdatWith(200),
    moovWith([{ count: 2 }], () => [0, 0]),
  ]);
  const p1 = writeFixture('two-mdat.mp4', twoMdat);
  check('A8 两个 mdat ⇒ none/no-moov-or-mdat', reasonOf(analyzeMp4Layout(p1)) === 'no-moov-or-mdat');

  const noMoov = Buffer.concat([FTYP(), mdatWith(200)]);
  const p2 = writeFixture('no-moov.mp4', noMoov);
  check('A9 没有 moov ⇒ none/no-moov-or-mdat', reasonOf(analyzeMp4Layout(p2)) === 'no-moov-or-mdat');

  const outside = buildFixture({ tables: [{ count: 3 }] });
  // 把三条 stco 改成指向 mdat **之外**（1 / 2 / 3 字节处）—— 这种文件硬搬就花屏。
  const bad = Buffer.from(outside.file);
  const at = outside.file.length - outside.moovLen + 8 + 8 + 8 + 8 + 8 + 8 + 8;
  bad.writeUInt32BE(1, at); bad.writeUInt32BE(2, at + 4); bad.writeUInt32BE(3, at + 8);
  const p3 = writeFixture('offsets-outside.mp4', bad);
  check('A10 有偏移落在 mdat 之外 ⇒ none/offsets-outside-mdat（宁可慢，不许花屏）',
    reasonOf(analyzeMp4Layout(p3)) === 'offsets-outside-mdat');

  const truncated = writeFixture('truncated.mp4', Buffer.concat([FTYP(), mdatWith(400), Buffer.from([0, 0, 1])]));
  check('A11 顶层盒越界（截断） ⇒ none/top-boxes', reasonOf(analyzeMp4Layout(truncated)) === 'top-boxes');

  const fragmented = buildFixture({ tables: [{ count: 2 }] });
  const frag = Buffer.concat([
    fragmented.file.subarray(0, fragmented.file.length - fragmented.moovLen),
    box('moov', Buffer.concat([box('mvex'), moovWith([{ count: 2 }], () => [0, 0]).subarray(8)])),
  ]);
  const p4 = writeFixture('fragmented.mp4', frag);
  check('A12 moov 里带分片族标记（mvex/moof…） ⇒ none/fragmented-or-aux',
    reasonOf(analyzeMp4Layout(p4)) === 'fragmented-or-aux');

  const noStbl = Buffer.concat([FTYP(), mdatWith(120), box('moov', box('trak', box('mdia', box('minf'))))]);
  const p5 = writeFixture('no-stbl.mp4', noStbl);
  check('A13 trak 下没有 stbl ⇒ none/no-chunk-offsets', reasonOf(analyzeMp4Layout(p5)) === 'no-chunk-offsets');

  const hugeMoov = Buffer.concat([
    FTYP(), mdatWith(64),
    box('moov', Buffer.concat([moovWith([{ count: 2 }], () => [0, 0]).subarray(8),
      Buffer.alloc(8 * 1024 * 1024 + 16)])),
  ]);
  const p6 = writeFixture('huge-moov.mp4', hugeMoov);
  check('A14 moov 超上限（>8MiB） ⇒ none/moov-too-big（内存兜底，不是布局兜底）',
    reasonOf(analyzeMp4Layout(p6)) === 'moov-too-big');

  check('A15 扩展名不在 {mp4,m4v,mov} ⇒ none/ext（不猜容器）',
    reasonOf(analyzeMp4Layout(join(FIXTURES, 'x.mkv'))) === 'ext');
  check('A16 路径不存在 ⇒ none（不抛：判不了就是回退原片）',
    (() => { try { const r = analyzeMp4Layout(join(FIXTURES, 'nope.mp4')); return r.kind === 'none'; } catch { return false; } })());
}

// ── B. 分析器：只读、有界缓存、判不了不缓存 ──────────────────────────────────
section('B. 布局分析器：只读 / 缓存 / 不缓存判不了');
const diag = [];
const kit = createMp4VfsKit({ appendDiagLine: (kind, obj) => diag.push({ kind, obj }) });
{
  const beforeBytes = readFileSync(tailPath);
  const beforeListing = readdirSync(FIXTURES).sort().join(',');
  const first = kit.layoutFor(tailPath, null);
  const second = kit.layoutFor(tailPath, null);
  check('B1 同一份源解析一次：第二次是同一份结论（有界内存缓存）', first === second && first.kind === 'virtual');
  check('B2 首次算出虚拟布局落一行诊断（虚拟布局对用户不可见的"磁盘 0"要靠它核对）',
    diag.length === 1 && diag[0].kind === 'faststart' && diag[0].obj && diag[0].obj.virtual === true
    && diag[0].obj.moovSize === tail.moovLen);
  check('B3 分析**只读**：源的字节、大小、目录内容一个都没变',
    readFileSync(tailPath).equals(beforeBytes) && readdirSync(FIXTURES).sort().join(',') === beforeListing);
  const noneFirst = kit.layoutFor(join(FIXTURES, 'no-moov.mp4'), null);
  const noneSecond = kit.layoutFor(join(FIXTURES, 'no-moov.mp4'), null);
  check('B4 判不了的结论**不缓存**（瞬时 IO 失败下次必须能重试）',
    noneFirst !== noneSecond && noneFirst.reason === 'no-moov-or-mdat' && noneSecond.reason === 'no-moov-or-mdat');
  const rewritten = buildFixture({ tables: [{ count: 7 }], mdatLen: 512 });
  writeFixture('tail.mp4', rewritten.file);
  const third = kit.layoutFor(tailPath, null);
  check('B5 源被改过（大小/mtime 变） ⇒ 重新解析（键含 size+mtime）',
    third !== first && third.kind === 'virtual' && third.patched === 7);
  writeFixture('tail.mp4', tail.file);
}

// ── C. 端到端：/media 真的在发虚拟字节（真 apply + 真请求） ─────────────────
section('C. 端到端：/media 发的是虚拟布局，其他族一个字节都不变');
// 视频夹具进一台"合成 Steam 库"：workshop 项目 + 一份 moov 在尾的 mp4
const mediaFixture = buildFixture({ tables: [{ count: 6 }], mdatLen: 600 });
const mediaAbs = join(WORKSHOP, '1000000001', 'clip.mp4');
const brokenAbs = join(WORKSHOP, '1000000002', 'broken.mp4');
const brokenBytes = Buffer.concat([FTYP(), mdatWith(200), mdatWith(200), moovWith([{ count: 2 }], () => [0, 0])]);
mkdirSync(dirname(mediaAbs), { recursive: true });
mkdirSync(dirname(brokenAbs), { recursive: true });
writeFileSync(mediaAbs, mediaFixture.file);
writeFileSync(brokenAbs, brokenBytes);
writeFileSync(join(dirname(mediaAbs), 'project.json'), JSON.stringify({ type: 'video', file: 'clip.mp4', title: 'VFS fixture' }));
writeFileSync(join(dirname(brokenAbs), 'project.json'), JSON.stringify({ type: 'video', file: 'broken.mp4', title: 'VFS broken fixture' }));

const routes = [];
const mockCtx = {
  webServer: {
    register(route) {
      routes.push(route);
      return () => { const i = routes.indexOf(route); if (i >= 0) routes.splice(i, 1); };
    },
    tapIndex() { return () => {}; },
  },
};
const hostMod = await import(pathToFileURL(resolve(root, 'lib', 'index.js')).href);
const host = hostMod.default || hostMod;
const apply = host.apply || (host.inject && host.apply);
const dispose = apply(mockCtx);

function fakeRes() {
  const state = { status: 200, headers: {}, body: Buffer.alloc(0), ended: false };
  const res = new Writable({
    write(chunk, enc, cb) {
      state.body = Buffer.concat([state.body, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      cb();
    },
    final(cb) { state.ended = true; cb(); },
  });
  res.setHeader = (k, v) => { state.headers[String(k).toLowerCase()] = v; };
  res.writeHead = (s, h) => { state.status = s; if (h) for (const k of Object.keys(h)) state.headers[k.toLowerCase()] = h[k]; };
  Object.defineProperty(res, 'statusCode', { get: () => state.status, set: (v) => { state.status = v; } });
  res.__state = state;
  return res;
}
function fakeReq(url, method, headers) {
  return { url, method: method || 'GET', headers: headers || {} };
}
async function runHandler(route, req) {
  const res = fakeRes();
  const done = route.handler(req, res);
  if (done && typeof done.then === 'function') await done;
  if (!res.__state.ended) {
    await new Promise((resolveFn) => {
      const t = setTimeout(resolveFn, 8000);
      res.on('finish', () => { clearTimeout(t); resolveFn(); });
    });
  }
  return res;
}
const routeFor = (path) => routes.find((r) => r.path === path || r.path === path + '/');
const invRoute = routeFor('/wallpaper-engine/inventory');
const inv = await runHandler(invRoute, fakeReq('/wallpaper-engine/inventory', 'GET'));
let items = [];
try { items = (JSON.parse(inv.__state.body.toString('utf8')).wallpapers) || []; } catch { /* 见下一条判据 */ }
const itemFor = (title) => items.find((w) => w && w.title === title);
const vfsItem = itemFor('VFS fixture');
const brokenItem = itemFor('VFS broken fixture');
const tokenOf = (w) => (w && w.media ? String(w.media).split('/').pop() : '');
// /media 的 token 必须与磁盘绝对路径对上（本文件自己算，不看宿主内部映射）
const expectToken = Buffer.from(mediaAbs).toString('base64url').replace(/=+$/, '');
check('C1 合成库里两张视频壁纸都拿到 /media token（端到端的前置条件）',
  Boolean(vfsItem && brokenItem && tokenOf(vfsItem) && tokenOf(brokenItem)),
  vfsItem ? tokenOf(vfsItem) : 'no-inventory-item');
check('C2 token 就是源文件的 base64url（客户端凭 URL 找不回扩展名，宿主不能改成随机串）',
  tokenOf(vfsItem).replace(/=+$/, '') === expectToken, tokenOf(vfsItem));

const mediaRoute = routeFor('/wallpaper-engine/media');
const previewRoute = routeFor('/wallpaper-engine/preview');
const mediaUrl = (token) => '/wallpaper-engine/media/' + token;
{
  const res = await runHandler(mediaRoute, fakeReq(mediaUrl(tokenOf(vfsItem)), 'GET', { range: 'bytes=0-' }));
  const st = res.__state;
  check('C3 首个请求（bytes=0-）⇒ 206 + Content-Range/Content-Length 按**虚拟总长**给出',
    st.status === 206
    && st.headers['content-range'] === `bytes 0-${mediaFixture.file.length - 1}/${mediaFixture.file.length}`
    && st.headers['content-length'] === String(mediaFixture.file.length),
    `${st.status} ${st.headers['content-range']}`);
  check('C4 响应体 == 独立算出的虚拟布局字节（这才是"第一段就拿到 moov"）',
    st.body.equals(mediaFixture.expectedVirtual),
    `got=${hash(st.body)} want=${hash(mediaFixture.expectedVirtual)}`);
  check('C5 响应体 ≠ 磁盘原字节（证明真的走了段映射，而不是原片）',
    !st.body.equals(mediaFixture.file));
  // 跨 moov/mdat 边界的 Range：虚拟布局里 moov 紧跟在 before（ftyp+free）之后
  const moovVStart = mediaFixture.before.length;
  const from = moovVStart - 5;
  const to = moovVStart + mediaFixture.moovLen + 5;
  const cross = await runHandler(mediaRoute, fakeReq(mediaUrl(tokenOf(vfsItem)), 'GET', { range: `bytes=${from}-${to}` }));
  check('C6 跨 moov/mdat 边界的 Range ⇒ 与虚拟布局逐字节一致（跨段合成这条路）',
    cross.__state.status === 206
    && cross.__state.body.equals(mediaFixture.expectedVirtual.subarray(from, to + 1)),
    `${cross.__state.status} len=${cross.__state.body.length} want=${to - from + 1}`);
  const suffix = await runHandler(mediaRoute, fakeReq(mediaUrl(tokenOf(vfsItem)), 'GET', { range: 'bytes=-64' }));
  check('C7 suffix Range（bytes=-64）语义不变：末尾 64 字节按虚拟布局算',
    suffix.__state.status === 206 && suffix.__state.body.equals(mediaFixture.expectedVirtual.subarray(-64)));
  const head = await runHandler(mediaRoute, fakeReq(mediaUrl(tokenOf(vfsItem)), 'HEAD', {}));
  check('C8 HEAD ⇒ 与 GET 同样的头、无 body',
    head.__state.status === 200 && head.__state.headers['content-length'] === String(mediaFixture.file.length)
    && head.__state.body.length === 0);
  const bad = await runHandler(mediaRoute, fakeReq(mediaUrl(tokenOf(vfsItem)), 'GET', { range: `bytes=${mediaFixture.file.length}-` }));
  check('C9 不可满足的 Range ⇒ 416 + `Content-Range: bytes */size`（与 serveFile 同语义）',
    bad.__state.status === 416 && bad.__state.headers['content-range'] === `bytes */${mediaFixture.file.length}`);
  const again = await runHandler(mediaRoute, fakeReq(mediaUrl(tokenOf(vfsItem)), 'GET', { range: 'bytes=0-' }));
  check('C10 同一 token 第二次请求 ⇒ 同一份字节（钉子：同一次播放不换布局）',
    again.__state.body.equals(res.__state.body));
  const broken = await runHandler(mediaRoute, fakeReq(mediaUrl(tokenOf(brokenItem)), 'GET', { range: 'bytes=0-' }));
  check('C11 判不了布局的源 ⇒ 原样发磁盘字节（回退这条路是硬要求）',
    broken.__state.status === 206 && broken.__state.body.equals(brokenBytes));
  const prev = await runHandler(previewRoute, fakeReq('/wallpaper-engine/preview/' + tokenOf(vfsItem), 'GET', { range: 'bytes=0-' }));
  check('C12 /preview 不参与虚拟布局（预览图/非 /media 族一律原样）',
    prev.__state.status !== 206 || prev.__state.body.equals(mediaFixture.file));
  check('C13 **磁盘 0**：整条链跑完，缓存根里没有新建的 faststart 目录/副本',
    !existsSync(join(CACHE_DIR, 'faststart')));
}

// ── D. 旧副本一次性回收 ────────────────────────────────────────────────────
section('D. 旧版 `fs_*.mp4` 副本：升级即回收，且只碰认识的命名');
{
  // 用**真**套件（不是重实现）：清扫是 lib/faststart.js 的导出之一，测副本等于没测。
  const fastFix = createFaststartKit({
    layoutFor: () => ({ kind: 'none' }),
    cacheBaseDir: () => SWEEP_DIR,
    readConfig: () => ({}),
    mediaMap: new Map(),
  });
  const dir = join(SWEEP_DIR, 'faststart');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'fs_0123456789abcdef.mp4'), Buffer.alloc(4096));
  writeFileSync(join(dir, 'fs_abcdef0123456789.mp4'), Buffer.alloc(1024));
  writeFileSync(join(dir, 'fs_pending.mp4.tmp999000123'), Buffer.alloc(512));
  writeFileSync(join(dir, 'preview.mp4'), Buffer.alloc(2048));      // 不认识的字节：不许碰
  writeFileSync(join(dir, 'notes.txt'), 'keep me');
  const out = fastFix.sweepLegacyFaststartVariants();
  const left = readdirSync(dir).sort();
  check('D1 回收旧副本（含原子写的 .tmp 残留）：文件数/字节数如实回报',
    out.files === 3 && out.bytes === 4096 + 1024 + 512 && out.capped === false,
    JSON.stringify(out));
  check('D2 只碰 `fs_*.mp4` 命名：别的文件一个都不动',
    left.join(',') === 'notes.txt,preview.mp4', left.join(','));
}

// ── E. 「有缓存转码就直接播转码」：/media-info 的只读缓存回答 ────────────────
section('E. /media-info 的抽帧缓存回答：只读、键与落盘一致、不起转码');
{
  const infoRoute = routeFor('/wallpaper-engine/media-info');
  const transcodeDir = join(CACHE_DIR, 'transcodes');
  // 本文件**自己**按公开算法算一遍缓存路径：宿主与这里各算一份，才能判出键漂移。
  const keyFor = (abs, fps) => createHash('sha256')
    .update(abs + '|' + Math.round(statSync(abs).mtimeMs) + '|' + fps)
    .digest('hex').slice(0, 20);
  const tcPath = join(transcodeDir, 'tc_' + keyFor(mediaAbs, 30) + '.mp4');
  const jsonOf = (res) => { try { return JSON.parse(res.__state.body.toString('utf8')); } catch { return null; } };
  const runInfo = async (qs) => jsonOf(await runHandler(infoRoute,
    fakeReq('/wallpaper-engine/media-info/' + tokenOf(vfsItem) + qs, 'GET')));

  const plain = await runInfo('');
  check('E1 不带 fps ⇒ transcode 为 null（宿主不猜客户端的上限）', plain && plain.transcode === null);

  const miss = await runInfo('?fps=30');
  check('E2 盘上没有该上限的抽帧版 ⇒ `{fps:30,cached:false}`', miss && miss.transcode
    && miss.transcode.fps === 30 && miss.transcode.cached === false, JSON.stringify(miss && miss.transcode));
  check('E3 **只读**：一次命中失败的回答不会凭空建出抽帧目录/文件（顺手转码是真实浪费）',
    !existsSync(transcodeDir) || readdirSync(transcodeDir).filter((n) => /^tc_.*\.mp4$/.test(n)).length === 0);

  mkdirSync(transcodeDir, { recursive: true });
  writeFileSync(tcPath, Buffer.from('fixture'));
  const hit = await runInfo('?fps=30');
  check('E4 盘上有该上限的抽帧版（路径按 abs|mtime|fps 的 sha256 独立算出）⇒ cached:true',
    hit && hit.transcode && hit.transcode.cached === true && hit.transcode.fps === 30,
    JSON.stringify(hit && hit.transcode));
  const zero = await runInfo('?fps=0');
  check('E5 上限 0（无限制）⇒ transcode 为 null（不是"查了 0fps 的缓存"）', zero && zero.transcode === null);
  const other = await runInfo('?fps=60');
  check('E6 别的上限没缓存 ⇒ cached:false（不许把 30 的缓存当成 60 的）',
    other && other.transcode && other.transcode.fps === 60 && other.transcode.cached === false);
  // E7：`ok` 的期望值**不取自同一响应的 `info`** —— `plain.ok === (plain.info !== null)` 只是把
  // `lib/routes/media-derived.js:93` 的 `ok: !!info` 再抄一遍：两边**一起**翻（info 变成对象而 ok 仍是
  // true）它就看不出来。这里给独立期望：夹具是手搓的布局盒（不含 `getMediaInfo` 要的元信息盒）⇒
  // `info` 必须是 null、于是 `ok` 必须是 false；不带 fps ⇒ `transcode` 必须是 null。
  // 同一个具名判据再喂一份**共同翻转**的变异响应，必须出来相反。
  const infoAnswerOk = (r) => Boolean(r) && 'info' in r && 'transcode' in r
    && r.info === null && r.ok === false && r.transcode === null;
  check('E7 元信息与缓存回答在**同一次**探测里给出，且否定答案来自独立期望（夹具不是真 mp4）',
    infoAnswerOk(plain), JSON.stringify(plain));
  check('E7 对照：`info` 与 `ok` 一起翻转的回答必须被判不合格（旧写法 `ok === (info !== null)` 会放它过）',
    !infoAnswerOk({ ...(plain || {}), info: { width: 1 }, ok: true }));
}

// ── 收尾 ────────────────────────────────────────────────────────────────────
if (typeof dispose === 'function') dispose();
delete process.env.DSH_WE_DATA_DIR;
delete process.env.DSH_WE_CACHE_DIR;
delete process.env.DSH_WE_STEAM_ROOT;
rmSync(ISO, { recursive: true, force: true });

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
