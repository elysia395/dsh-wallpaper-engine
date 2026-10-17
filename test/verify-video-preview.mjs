#!/usr/bin/env node
/**
 * 聚焦守卫：`lib/media/video-preview.js`（picker 的视频缩略图：抽帧 → 落缓存 → 同键合流）。
 *
 * ⚠️ 重指真源（task-10 C）：被测实现住 `lib/media/video-preview.js` 的工厂返回值里；本守卫原先
 * import 上游同名副本 `lib/video-preview.js`（task-10 末次提交已随本批删除）。副本里带着 `produced` 旗标
 * 修法（"产出＝spawn 正常返回且留下文件"，见 D2 与 M_LEFTOVER），而真源当时只看"文件在不在"。
 * 修法已搬进真源；真源的 deps 契约是 `{cacheBaseDir, ensureDirOnce, transcodeKit}`（宽度/闸值
 * 为可选注入，缺省 960/2），夹具据此重建 —— 判据与期望值一字未改。
 *
 * 判据按模块文件头的四条不变量分组：
 *   1. **同键合流**（C 段）：同一输出路径的并发请求只 spawn 一次、只写一次盘。注意
 *      **不要断言两次调用返回同一个 promise/身份** —— `generateVideoPreview` 是 `async function`，
 *      外层包装 promise 天然每次不同；合流点在 `VIDEO_PREVIEW_INFLIGHT` 账本层，用 **spawn 计数**判。
 *   2. **自己的并发闸**（G 段）：`VIDEO_PREVIEW_MAX_CONCURRENT` 由注入，缩略图任务互不重叠。
 *   3. **缓存键含 size + mtime + width**（F/B 段）：换源、改 mtime、改宽度都必须换键，绝不吐旧图。
 *   4. 失败路径清 `.tmp` 并放闸（E 段，finally）——否则一次失败永久吃掉一个名额。
 *
 * 口径（docs/DEV-GUIDE.md §4.7）：期望值从源码自行重推；正向与负对照喂**同一个判据函数**
 * （变异体只改被测源码）；地板写在 `if` 之外；"槽被永久吃掉"这种失败形态用**看门狗**变成
 * 判红而不是让守卫挂死。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createVideoPreviewKit } from '../lib/media/video-preview.js';
import { createCheck } from './tools/assert-harness.mjs';
import { stripComments } from './tools/js-text.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ISO = join(ROOT, '.test-cache', 'video-preview-guard');
const SRC = join(ROOT, 'lib', 'media', 'video-preview.js');
// ⚠️ 变异体锚点写的是 `\n`：源码文本先归一成 LF 再做字面替换，否则 CRLF 检出（Windows 上
// 常见）会让每条锚点都不命中、把负对照变成"锚点没命中"的异常。与
// `test/verify-transcode-state.mjs` 的 `\r?\n` 处理同一个理由（`.gitattributes` 约定检出为 LF，
// 但守卫不该依赖 checkout 的 EOL）。
const SOURCE = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
const OWN = readFileSync(fileURLToPath(import.meta.url), 'utf8');
mkdirSync(ISO, { recursive: true });

const { check, stats } = createCheck();
let mutants = 0;
let seq = 0;
const SENTINEL = Symbol('watchdog-timeout');

function section(title) { console.log('\n' + title); }

/** 一个空目录：**返回的就是缓存目录本身**（`<label>-<seq>/video-previews`）—— 与真源
 *  `videoPreviewCacheDir()` = join(cacheBaseDir(), 'video-previews') 的落点对齐，这样
 *  `tmpLeftovers(dir)` / `existsSync(out)` 判的仍是同一个目录。 */
function freshDir(label) {
  seq += 1;
  const base = join(ISO, `${label}-${seq}`);
  const d = join(base, 'video-previews');
  rmSync(base, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  return d;
}

function freshFile(label, body = 'VIDEO') {
  const p = join(ISO, `${label}-${++seq}.mp4`);
  writeFileSync(p, body);
  return p;
}

function sleep(ms) { return new Promise((resolve) => { setTimeout(resolve, ms); }); }

function tmpLeftovers(dir) {
  return readdirSync(dir).filter((n) => n.includes('.tmp'));
}

/** 看门狗：把"槽被吃光 ⇒ 永远挂着"变成判红，而不是让守卫挂死。 */
async function watch(promise, ms) {
  let timer;
  const guard = new Promise((resolve) => { timer = setTimeout(() => resolve(SENTINEL), ms); });
  const out = await Promise.race([promise.then((v) => ({ v }), (e) => ({ e })), guard]);
  clearTimeout(timer);
  return out;
}

/** 与宿主同形的 ffmpeg 替身：收到的 `args` 末位就是输出 tmp 路径。 */
function makeSpawn({ behavior = 'ok', delayMs = 0, log = null } = {}) {
  const calls = [];
  const spawnFfmpeg = async (ff, args) => {
    const rec = { ff, args, ss: args[args.indexOf('-ss') + 1], vf: args[args.indexOf('-vf') + 1], out: args[args.length - 1] };
    calls.push(rec);
    if (log) log.push(rec);
    // 失败即不落帧：抛出的那次不写输出。"抛了却留下 0 字节残片"由 D2 的专用替身覆盖。
    if (behavior === 'throw-always') throw new Error('ffmpeg boom');
    if (behavior === 'throw-first' && calls.length === 1) throw new Error('ffmpeg boom');
    if (delayMs) await sleep(delayMs);
    writeFileSync(rec.out, 'JPEG');
  };
  return { spawnFfmpeg, calls };
}

/** 会记录并发峰值的替身（G 段）。 */
function makeGateSpawn(delayMs) {
  const calls = [];
  let active = 0;
  let peak = 0;
  const spawnFfmpeg = async (ff, args) => {
    active += 1;
    peak = Math.max(peak, active);
    calls.push(args[args.length - 1]);
    await sleep(delayMs);
    writeFileSync(args[args.length - 1], 'JPEG');
    active -= 1;
  };
  return { spawnFfmpeg, calls, peak: () => peak };
}

function kitFor(dir, opts = {}) {
  const factory = opts.factory || createVideoPreviewKit;
  // 真源 deps 契约（`lib/media/video-preview.js` 文件头）：目录一律由访问器注入。
  // `cacheBaseDir: () => dirname(dir)` 让 videoPreviewCacheDir() 正好等于 dir；
  // ffmpeg 的解析与 spawn 经 transcodeKit 注入；宽度/闸值是可选项（缺省 960/2）。
  return factory({
    cacheBaseDir: () => dirname(dir),
    ensureDirOnce: opts.ensureDir || ((p) => { mkdirSync(p, { recursive: true }); return p; }),
    transcodeKit: { resolveFfmpeg: async () => '/fake/ffmpeg', spawnFfmpeg: opts.spawn },
    VIDEO_PREVIEW_WIDTH: opts.width === undefined ? 960 : opts.width,
    VIDEO_PREVIEW_MAX_CONCURRENT: opts.max === undefined ? 4 : opts.max,
  });
}

function loadMutant(label, transforms) {
  let text = SOURCE;
  for (const [find, replace] of transforms) {
    if (!text.includes(find)) {
      throw new Error(`变异体 ${label} 的锚点没命中：${JSON.stringify(find.slice(0, 70))} —— 源码变了就同步改锚点`);
    }
    text = text.replace(find, () => replace);
  }
  mutants += 1;
  const file = join(ISO, 'mutants', `${mutants}-${label}.mjs`);
  mkdirSync(join(ISO, 'mutants'), { recursive: true });
  writeFileSync(file, text);
  return import(pathToFileURL(file).href);
}

/** 同一个判据函数喂正向与负对照（负对照只换被测源码）。 */
async function pair(name, judge, label, transforms) {
  const pos = await judge({});
  check(name, pos.ok === true, '正向读数：' + pos.detail);
  const mod = await loadMutant(label, transforms);
  const mut = await judge({ factory: mod.createVideoPreviewKit });
  check(`${name} —— 负对照（${label}）必须判红`, mut.ok === false, '变异体读数：' + mut.detail);
}

// 两处捷径都要去掉：只去掉外层那处时，IIFE 内的 `if (existsSync(out)) return out;` 仍会接管 ⇒ 变异体不判红。
const M_EXISTS = [
  [`    if (existsSync(out)) return out;\n`, ''],
  [`        if (existsSync(out)) return out; // a queued sibling may have produced it\n`, ''],
];
const M_FALLBACK = [[`        for (const ss of [1, 0]) {`, `        for (const ss of [1]) {`]];
const M_SEEK = [[`              '-ss', String(ss),`, `              '-ss', '0',`]];
const M_WIDTH = [[`              '-vf', \`scale='min(\${VIDEO_PREVIEW_WIDTH},iw)':-2\`,`,
  `              '-vf', \`scale='min(1080,iw)':-2\`,`]];
// 只摘掉查表（保留 `let entry;` —— 否则变异体自己会 ReferenceError，红得没有意义）。
const M_INFLIGHT = [[`    let entry = VIDEO_PREVIEW_INFLIGHT.get(out);\n    if (entry) return entry;\n`, `    let entry;\n`]];
// 吞掉"两次都没产出"的那次抛出 ⇒ 随后 renameSync(tmp,out) 以 ENOENT 失败，错误语义被换掉。
const M_LASTERR = [[`        if (!produced) throw lastErr || new Error('no preview frame produced');`,
  `        if (!produced) { /* 吞掉最后一次失败 */ }`]];
// 回退到修前语义：只按"文件在不在"裁决 ⇒ 抛出的那次留下的 0 字节残片会被 renameSync 当帧发布。
const M_LEFTOVER = [[`        if (!produced) throw lastErr || new Error('no preview frame produced');`,
  `        if (!existsSync(tmp)) throw lastErr || new Error('no preview frame produced');`]];
const M_FINALLY = [[`        releaseVideoPreviewSlot();`, `        /* 忘了放闸 */`]];
const M_KEY_MTIME = [[`      .update(abs + '|' + size + '|' + mtime + '|v1|' + VIDEO_PREVIEW_WIDTH)`,
  `      .update(abs + '|' + size + '|v1|' + VIDEO_PREVIEW_WIDTH)`]];
const M_KEY_WIDTH = [[`      .update(abs + '|' + size + '|' + mtime + '|v1|' + VIDEO_PREVIEW_WIDTH)`,
  `      .update(abs + '|' + size + '|' + mtime + '|v1|')`]];
const M_STAT_GUARD = [[`    try { const st = statSync(abs); size = st.size; mtime = Math.round(st.mtimeMs); } catch { /* ignore */ }`,
  `    const st = statSync(abs); size = st.size; mtime = Math.round(st.mtimeMs);`]];
const M_GATE = [[`    if (videoPreviewActive < VIDEO_PREVIEW_MAX_CONCURRENT) {`, `    if (true) {`]];

// ───────────────────────── A. 命中即回（不派进程） ─────────────────────────
async function judgeHit(make) {
  const dir = freshDir('a-hit');
  const { spawnFfmpeg, calls } = makeSpawn();
  const kit = kitFor(dir, { ...make, spawn: spawnFfmpeg });
  const src = freshFile('a-src');
  const hit = kit.videoPreviewCachePath(src);
  writeFileSync(hit, 'JPEG');
  const out = await kit.generateVideoPreview(src);
  return { ok: out === hit && calls.length === 0 && readFileSync(hit, 'utf8') === 'JPEG', detail: `返回命中路径=${out === hit} spawn=${calls.length} 内容=${readFileSync(hit, 'utf8')}` };
}

// ───────────────────────── B. 冷启动与二次命中 ─────────────────────────
async function judgeColdStart(make) {
  const dir = freshDir('b-cold');
  const { spawnFfmpeg, calls } = makeSpawn();
  const kit = kitFor(dir, { ...make, spawn: spawnFfmpeg });
  const src = freshFile('b-src');
  const out = await kit.generateVideoPreview(src);
  return {
    ok: calls.length === 1 && calls[0].ss === '1' && calls[0].vf.includes('min(960,iw)')
      && out.endsWith('.jpg') && existsSync(out) && tmpLeftovers(dir).length === 0,
    detail: `spawn=${calls.length} ss=${calls[0] && calls[0].ss} vf=${calls[0] && calls[0].vf} 产出=${existsSync(out)} tmp 残留=${JSON.stringify(tmpLeftovers(dir))}`,
  };
}

async function judgeSecondCallNoSpawn(make) {
  const dir = freshDir('b-second');
  const { spawnFfmpeg, calls } = makeSpawn();
  const kit = kitFor(dir, { ...make, spawn: spawnFfmpeg });
  const src = freshFile('b2-src');
  const first = await kit.generateVideoPreview(src);
  const second = await kit.generateVideoPreview(src);
  return { ok: first === second && calls.length === 1, detail: `两次同路径=${first === second} spawn=${calls.length}` };
}

async function judgeWidthInjected(make) {
  const dir = freshDir('b-width');
  const { spawnFfmpeg, calls } = makeSpawn();
  const kit = kitFor(dir, { ...make, spawn: spawnFfmpeg, width: 432 });
  await kit.generateVideoPreview(freshFile('b3-src'));
  return { ok: calls.length === 1 && calls[0].vf.includes('min(432,iw)'), detail: `vf=${calls[0] && calls[0].vf}` };
}

// ───────────────────────── C. 同键合流（不变量 1） ─────────────────────────
async function judgeInflightCoalesce(make) {
  const dir = freshDir('c-inflight');
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { spawnFfmpeg, calls } = makeSpawn();
  const slow = async (ff, args) => { await gate; return spawnFfmpeg(ff, args); };
  const kit = kitFor(dir, { ...make, spawn: slow });
  const src = freshFile('c-src');
  const p1 = kit.generateVideoPreview(src);
  const p2 = kit.generateVideoPreview(src);
  release();
  const [r1, r2] = await Promise.all([p1, p2]);
  // 只比"解析到同一路径"与 spawn 次数 —— 不比 promise 身份（async 包装天然不同）。
  return { ok: r1 === r2 && calls.length === 1, detail: `同路径=${r1 === r2} spawn=${calls.length}` };
}

// ───────────────────────── D. 首帧失败回退（-ss 1 → 0） ─────────────────────────
async function judgeSeekFallback(make) {
  const dir = freshDir('d-fallback');
  const { spawnFfmpeg, calls } = makeSpawn({ behavior: 'throw-first' });
  const kit = kitFor(dir, { ...make, spawn: spawnFfmpeg });
  // 负对照（只试 -ss 1）会把这条判据变成"带异常逃逸"：接住它并判红，而不是让守卫崩掉。
  let out = null; let err = null;
  try { out = await kit.generateVideoPreview(freshFile('d-src')); } catch (e) { err = e; }
  const order = calls.map((c) => c.ss);
  const ok = !err && JSON.stringify(order) === '["1","0"]' && existsSync(out) && tmpLeftovers(dir).length === 0;
  return { ok, detail: `ss 顺序=${JSON.stringify(order)} 产出=${Boolean(out) && existsSync(out)} 逃逸异常=${err ? err.message : '无'} tmp 残留=${JSON.stringify(tmpLeftovers(dir))}` };
}

// ── D2. 失败留下的残片不得被当帧发布（真缺陷回归：lead 裁决"spawn 抛 ⇒ 该次尝试无产出"） ──
async function judgeLeftoverTmp(make) {
  const dir = freshDir('d-leftover');
  const calls = [];
  // ffmpeg 的 image2 复用器"打开输出即建档"：编码中途失败很可能留下 0 字节/半张图。
  const spawn = async (ff, args) => {
    calls.push(args[args.indexOf('-ss') + 1]);
    writeFileSync(args[args.length - 1], '');
    throw new Error('ffmpeg boom');
  };
  const kit = kitFor(dir, { ...make, spawn });
  const src = freshFile('d-leftover-src');
  const out = kit.videoPreviewCachePath(src);
  let err = null; let ret = null;
  try { ret = await kit.generateVideoPreview(src); } catch (e) { err = e; }
  return {
    ok: Boolean(err) && err.message === 'ffmpeg boom' && calls.length === 2 && ret === null
      && !existsSync(out) && tmpLeftovers(dir).length === 0,
    detail: `err=${err && err.message} 返回值=${ret ? '有（错！）' : '无'} 正式产物存在=${existsSync(out)} tmp 残留=${JSON.stringify(tmpLeftovers(dir))}`,
  };
}

// ───────────────────────── E. 全失败：reject + 清 tmp + 放闸 ─────────────────────────
async function judgeAllFail(make) {
  const dir = freshDir('e-fail');
  const { spawnFfmpeg, calls } = makeSpawn({ behavior: 'throw-always' });
  const kit = kitFor(dir, { ...make, spawn: spawnFfmpeg });
  let err = null;
  try { await kit.generateVideoPreview(freshFile('e-src')); } catch (e) { err = e; }
  return { ok: Boolean(err) && err.message === 'ffmpeg boom' && calls.length === 2 && tmpLeftovers(dir).length === 0, detail: `err=${err && err.message} spawn=${calls.length} tmp 残留=${JSON.stringify(tmpLeftovers(dir))}` };
}

// E1b. 老兜底不许被换掉：spawn 正常返回但两次都没留文件 ⇒ 仍 reject 'no preview frame produced'。
// （这格是回归：produced 旗标修法不得顺手丢掉"返回了却没出帧"的语义。
//   没有变异体 —— 回放旧语义的变异体在这格上行为相同，牙齿由 D2 那条负对照承担。）
async function judgeSpawnOkButNoFile(make) {
  const dir = freshDir('e-nofile');
  const calls = [];
  const spawn = async (ff, args) => { calls.push(args[args.indexOf('-ss') + 1]); };
  const kit = kitFor(dir, { ...make, spawn });
  const src = freshFile('e-nofile-src');
  const out = kit.videoPreviewCachePath(src);
  let err = null; let ret = null;
  try { ret = await kit.generateVideoPreview(src); } catch (e) { err = e; }
  return {
    ok: Boolean(err) && err.message === 'no preview frame produced' && calls.length === 2
      && ret === null && !existsSync(out) && tmpLeftovers(dir).length === 0,
    detail: `err=${err && err.message} 返回值=${ret ? '有（错！）' : '无'} 正式产物存在=${existsSync(out)} spawn=${calls.length} tmp 残留=${JSON.stringify(tmpLeftovers(dir))}`,
  };
}

async function judgeSlotReleasedAfterFailure(make) {
  const dir = freshDir('e-release');
  let failing = true;
  const calls = [];
  const spawn = async (ff, args) => {
    calls.push(args);
    if (failing) throw new Error('ffmpeg boom');
    writeFileSync(args[args.length - 1], 'JPEG');
  };
  // 闸=1：若失败路径没放闸，第二次调用会永远排队 ⇒ 看门狗判红（而不是挂死）。
  // 第二次刻意换一个**源**（不同键）：同键会走"命中即回"捷径，把泄漏遮住。
  const kit = kitFor(dir, { ...make, spawn, max: 1 });
  const first = freshFile('e2-first');
  const second = freshFile('e2-second');
  try { await kit.generateVideoPreview(first); } catch { /* 预期失败 */ }
  failing = false;
  const settled = await watch(kit.generateVideoPreview(second), 3000);
  const ok = settled !== SENTINEL && settled.v && existsSync(settled.v);
  return { ok, detail: settled === SENTINEL ? '第二次调用超时（槽被永久吃掉）' : `第二次产出=${settled.v && existsSync(settled.v)} spawn=${calls.length}` };
}

// ───────────────────────── F. 缓存键：mtime / width / 缺源不抛（不变量 3） ─────────────────────────
async function judgeKeyTracksMtime(make) {
  const dir = freshDir('f-mtime');
  const kit = kitFor(dir, { ...make, spawn: makeSpawn().spawnFfmpeg });
  const src = freshFile('f-src');
  const before = kit.videoPreviewCachePath(src);
  const st = statSync(src);
  utimesSync(src, st.atime, new Date(st.mtimeMs + 60_000));
  const after = kit.videoPreviewCachePath(src);
  return { ok: before !== after, detail: `改 mtime 前后=${before !== after}` };
}

async function judgeKeyTracksWidth(make) {
  const dir = freshDir('f-width');
  const src = freshFile('f2-src');
  const narrow = kitFor(dir, { ...make, spawn: makeSpawn().spawnFfmpeg, width: 960 }).videoPreviewCachePath(src);
  const wide = kitFor(dir, { ...make, spawn: makeSpawn().spawnFfmpeg, width: 1280 }).videoPreviewCachePath(src);
  return { ok: narrow !== wide, detail: `960/1280 不同键=${narrow !== wide}` };
}

async function judgeMissingSourceNoThrow(make) {
  const dir = freshDir('f-missing');
  const kit = kitFor(dir, { ...make, spawn: makeSpawn().spawnFfmpeg });
  let p; let threw = false;
  try { p = kit.videoPreviewCachePath(join(ISO, 'definitely-not-here.mp4')); } catch { threw = true; }
  return { ok: !threw && typeof p === 'string' && p.endsWith('.jpg'), detail: threw ? '抛了' : `返回 ${p}` };
}

// ───────────────────────── G. 并发闸（不变量 2） ─────────────────────────
async function judgeConcurrencyGate(make) {
  const dir = freshDir('g-gate');
  const { spawnFfmpeg, calls, peak } = makeGateSpawn(30);
  const kit = kitFor(dir, { ...make, spawn: spawnFfmpeg, max: 1 });
  const a = freshFile('g-a');
  const b = freshFile('g-b');
  const [ra, rb] = await Promise.all([kit.generateVideoPreview(a), kit.generateVideoPreview(b)]);
  return { ok: peak() <= 1 && existsSync(ra) && existsSync(rb) && calls.length === 2, detail: `峰值=${peak()} 产出=${existsSync(ra) && existsSync(rb)} spawn=${calls.length}` };
}

// ───────────────────────── 判据 ─────────────────────────
section('A. 命中即回：缓存已在 ⇒ 不派进程（不变量 3 的前置）');
await pair('A 缓存命中直接返回该路径、spawn 次数为 0', judgeHit, 'no-exists-shortcut', M_EXISTS);

section('B. 冷启动：参数 / 产出 / 无 tmp 残留 / 二次不重跑');
await pair('B1 冷启动 spawn 恰 1 次、先试 -ss 1、-vf 用注入宽度、产出为 .jpg 且无 .tmp 残留', judgeColdStart, 'seek-always-zero', M_SEEK);
await pair('B2 同键二次调用不再 spawn', judgeSecondCallNoSpawn, 'no-exists-shortcut', M_EXISTS);
await pair('B3 宽度来自注入（不是写死 1080）', judgeWidthInjected, 'width-hardcoded', M_WIDTH);

section('C. 同键合流：并发只 spawn 一次（不变量 1，比较路径而非 promise 身份）');
await pair('C 同 tick 两次调用解析到同一路径且 spawn 恰 1 次', judgeInflightCoalesce, 'no-inflight-lookup', M_INFLIGHT);

section('D. 首帧失败回退：-ss 1 → 0');
await pair('D 首次 spawn 失败 ⇒ 第二次用 -ss 0，最终产出存在且无 .tmp 残留', judgeSeekFallback, 'no-fallback', M_FALLBACK);
await pair('D2 spawn 抛且留下 0 字节残片 ⇒ 必须 reject、正式产物不得生成、tmp 无残留', judgeLeftoverTmp, 'publish-leftover-tmp', M_LEFTOVER);

section('E. 全失败：reject、清 .tmp、放闸（finally）');
await pair('E1 两次都失败 ⇒ reject 最后一条 spawn 错误、spawn 2 次、无 .tmp 残留', judgeAllFail, 'swallow-last-error', M_LASTERR);
const noFile = await judgeSpawnOkButNoFile({});
check('E1b spawn 正常返回但两次都没留文件 ⇒ 老兜底仍 reject `no preview frame produced`（真修没换掉这条语义）',
  noFile.ok === true, '正向读数：' + noFile.detail);
await pair('E2 失败后闸被放回：闸=1 时同键再次调用能成功', judgeSlotReleasedAfterFailure, 'finally-no-release', M_FINALLY);

section('F. 缓存键含 size + mtime + width；缺源退化不抛（不变量 3）');
await pair('F1 源 mtime 变 ⇒ 键变', judgeKeyTracksMtime, 'key-no-mtime', M_KEY_MTIME);
await pair('F2 VIDEO_PREVIEW_WIDTH 变 ⇒ 键变', judgeKeyTracksWidth, 'key-no-width', M_KEY_WIDTH);
await pair('F3 源不存在 ⇒ 返回路径字符串、不抛（size/mtime 退化 0）', judgeMissingSourceNoThrow, 'stat-unguarded', M_STAT_GUARD);

section('G. 自己的并发闸（不变量 2）');
await pair('G 闸=1 时两个不同源不重叠（峰值 ≤1）且都产出', judgeConcurrencyGate, 'gate-open', M_GATE);

// ───────────────────────── H. 自检与地板 ─────────────────────────
section('H. 自检与覆盖面地板');
check('H1 本文件确实调用了被测模块（不是只 import）',
  stripComments(OWN).includes('createVideoPreviewKit('),
  '剥注释后含 createVideoPreviewKit(');
check('H2 注释里的调用不算调用（先剥注释再判）',
  !stripComments('// createVideoPreviewKit(x)\n/* createVideoPreviewKit(y) */').includes('createVideoPreviewKit('),
  'stripComments 剥掉行注释与块注释');

const CHECK_FLOOR = 14;
const MUTANT_FLOOR = 8;
const totalChecks = stats.passed + stats.failed;
check(`H3 覆盖面地板：执行的判据 ≥ ${CHECK_FLOOR}`, totalChecks >= CHECK_FLOOR, `实测 ${totalChecks}`);
check(`H4 负对照地板：变异体 ≥ ${MUTANT_FLOOR}`, mutants >= MUTANT_FLOOR, `实测 ${mutants}`);

console.log('');
if (stats.failed > 0) {
  console.log(`VIDEO-PREVIEW CHECKS FAILED — ${stats.failed} failed, ${stats.passed} passed`);
  process.exit(1);
}
console.log(`ALL VIDEO-PREVIEW CHECKS PASSED (${stats.passed})`);
