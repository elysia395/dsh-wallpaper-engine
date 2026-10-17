#!/usr/bin/env node
/**
 * verify-media-probe.mjs — `lib/media/mp4-probe.js`（`createMp4ProbeKit().getMediaInfo`，一次 moov 盒走读）的自检。
 *
 * 为什么需要这个文件：它**此前零覆盖**（`node test/verify-guard-map.mjs` 的①直接点名
 * `lib/media/mp4-probe.js`）。而它的答案有两个**用户看得见**的消费者（内核装配后注入路由族）：
 *   · `/media-info` 的面板提示（"源 4K · 120fps · H.264"）与 `runFfmpegTranscode` 的
 *     "源帧率 ≤ 上限就整段跳过转码"决策 —— 读错 fps/尺寸 ⇒ 要么白起一次 ffmpeg，要么画质被降。
 *   · `moovStart` / `moovSize` 就是「moov 落在头部还是尾部」这个事实本身（`lib/mp4-vfs.js`
 *     只在 moov 落尾时才需要搬虚拟布局）。
 *
 * 判据的口径：
 *   · **夹具全部手搓字节**（不等 ffmpeg —— CI 未必有它；而这条链的正确性本来就只是"盒表算术"）。
 *   · **期望值不与被测对象同源**（§4.7 约定 9）：本文件带一份**独立的**盒树走读 `ownInfo(buf,…)`
 *     —— 它按 mp4 规范自己数偏移，`getMediaInfo` 的答案必须与它**逐字段相同**。于是"两个读数
 *     一起漂"这种最隐蔽的失效（例如把 `mdhd` 的 duration 读成 timescale）也会显形。
 *   · 每个正例都配**负对照**：把夹具的同一个字节改坏（或抽掉一个盒），同一判据必须给出相反结论。
 *
 * 隔离：临时文件全在 `.test-cache/media-probe/`，全程不碰真实用户目录。
 */
import { mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ⚠️ 重指真源（task-10 B）：被测实现住 `lib/media/mp4-probe.js` 的工厂返回值里。
// 原先 import 的是上游同名副本 `lib/media-probe.js`（模块级状态；task-10 末次提交已随本批删除）——
// 那份副本恰好带着 v1 `mdhd` 的偏移修法，而真源当时读成 u64@20/+28 ⇒ fps = timescale<<32
// （实测同一份 v1 字节流：真源 128849018880 / 期望 30）。修法已搬进真源（见该文件 mdhd 段注释），
// 本守卫随之重指 —— 于是 D3/D4 从"给孤儿做体检"变成"钉住发布面真源"。
import { createMp4ProbeKit } from '../lib/media/mp4-probe.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { getMediaInfo } = createMp4ProbeKit();
const ISO = join(root, '.test-cache', 'media-probe');
rmSync(ISO, { recursive: true, force: true });
mkdirSync(ISO, { recursive: true });

let passed = 0;
let failed = 0;
/** 畸形输入用例计数 —— 与 `passed` 分开："拒绝面多宽"是这条守卫自己的覆盖面地板。 */
let rejected = 0;
/** 各段的正例读数，供最后的地板统计（null 必须能显形，不能被 `filter(Boolean)` 悄悄吃掉）。
 *  不写 `= null` 初值：各段都先赋值再读，初值没人读（`no-useless-assignment`）。 */
let got; let got2; let got3; let gotAudioSkip; let gotCache; let gotTail;
function check(name, ok, detail) {
  if (ok) passed++;
  else failed++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
}
function section(t) { console.log('\n' + t); }
/** 拒绝面用例：`expected` 是"这个畸形输入应当被判成什么"的**独立期望**。 */
function rejection(name, actual, expected = null) {
  rejected += 1;
  check(name, actual === expected, '得到 ' + JSON.stringify(actual));
}

// ═══ 盒写入器（手搓 MP4 的最小积木）═══════════════════════════════════════════
function box (type, ...parts) {
  const payload = Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + payload.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, payload]);
}
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n, 0); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n, 0); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n), 0); return b; };
const u8 = (n) => Buffer.from([n]);
const zeros = (n) => Buffer.alloc(n);
const ascii = (s) => Buffer.from(s, 'latin1');

/** ftyp：主品牌 + 兼容品牌表（探测不读它，但真文件必须有）。 */
const ftyp = box('ftyp', ascii('isom'), u32(512), ascii('isom'), ascii('avc1'));

function mdhd ({ version, timescale, duration }) {
  return version === 1
    ? box('mdhd', u8(1), zeros(3), u64(0), u64(0), u32(timescale), u64(duration), u16(0x55c4), u16(0))
    : box('mdhd', u8(0), zeros(3), u32(0), u32(0), u32(timescale), u32(duration), u16(0x55c4), u16(0));
}

/** `stsd` 的样本描述项：`avc1` 的 width/height 在项内 +32/+34（见 `lib/media/mp4-probe.js` 的读法）。 */
function stsdEntry (codec, width, height) {
  // ⚠️ 偏移从**项起点**（盒头之后）算：项长 78B = 8B 盒头 + 70B 载荷，width@32 / height@34，
  //    所以载荷内要写在 **24 / 26**（32-8 / 34-8）。把 32/34 直接写进载荷不会报错，
  //    只会静默读出 0×0（实测踩过一次：全部尺寸断言一起变 0）。
  const fixed = Buffer.alloc(70);
  fixed.write(codec, 4, 'latin1');
  fixed.writeUInt16BE(width, 24);
  fixed.writeUInt16BE(height, 26);
  return box('stsd', u32(0), u32(1), box(codec, fixed));
}

/** `stts`：`entryCount` 条 `[count, delta]`。 */
function stts (...entries) {
  return box('stts', u32(0), u32(entries.length),
    ...entries.map(([count, delta]) => Buffer.concat([u32(count), u32(delta)])));
}

/**
 * 完整 moov：`trak → mdia → { mdhd, hdlr, minf → stbl → { stsd, stts } }`。
 * `handler` 用来造"非视频轨"（`vide` 之外 ⇒ 该 trak 必须被跳过）；`omit` 用来抽掉某个盒。
 */
function moovBox ({ codec = 'avc1', width = 1920, height = 1080, timescale = 30000, duration = 10000, samples = 300, delta = 1000, version = 0, handler = 'vide', omit = [] } = {}) {
  const parts = [];
  if (!omit.includes('mdhd')) parts.push(mdhd({ version, timescale, duration }));
  if (!omit.includes('hdlr')) parts.push(box('hdlr', u32(0), u32(0), ascii(handler), u32(0), u32(0), u32(0), u8(1), u8(0)));
  const stblParts = [];
  if (!omit.includes('stsd')) stblParts.push(stsdEntry(codec, width, height));
  if (!omit.includes('stts')) stblParts.push(stts([samples, delta]));
  parts.push(box('minf', box('stbl', ...stblParts)));
  return box('moov', box('trak', box('mdia', ...parts)));
}

/** `mdat`：填充字节可控，用来把 moov 顶到文件尾部 / 藏假 moov 串。 */
const mdat = (n, fill = 0) => box('mdat', Buffer.alloc(n, fill));

// ═══ 独立走读（期望值的来源，不与被测对象同源）═══════════════════════════════
/**
 * 按 mp4 规范自己走一遍盒树，算 `{width,height,codec,fps,duration,moovStart,moovSize}`。
 * 故意写成"另一条路径"：从**已知的盒布局**推，而不是抄 `lib/media/mp4-probe.js` 的偏移常量。
 */
function ownInfo (buf, moovStart, moovSize, trackIndex = 0, frameAt = moovStart) {
  const typeAt = (o) => buf.toString('latin1', o + 4, o + 8);
  const sizeAt = (o) => buf.readUInt32BE(o);
  const findIn = (from, to, type) => {
    for (let o = from; o + 8 <= to; o += sizeAt(o)) {
      if (sizeAt(o) < 8) break;
      if (typeAt(o) === type) return o;
    }
    return -1;
  };
  const findNth = (from, to, type, n) => {
    let seen = 0;
    for (let o = from; o + 8 <= to; o += sizeAt(o)) {
      if (sizeAt(o) < 8) break;
      if (typeAt(o) === type && seen++ === n) return o;
    }
    return -1;
  };
  const moovEnd = moovStart + moovSize;
  const trak = findNth(moovStart + 8, moovEnd, 'trak', trackIndex);
  const mdia = findIn(trak + 8, trak + sizeAt(trak), 'mdia');
  const mdiaEnd = mdia + sizeAt(mdia);
  const mdhd = findIn(mdia + 8, mdiaEnd, 'mdhd');
  const minf = findIn(mdia + 8, mdiaEnd, 'minf');
  const stbl = findIn(minf + 8, minf + sizeAt(minf), 'stbl');
  const stblEnd = stbl + sizeAt(stbl);
  const stsd = findIn(stbl + 8, stblEnd, 'stsd');
  const stts = findIn(stbl + 8, stblEnd, 'stts');
  const codec = buf.toString('latin1', stsd + 16 + 4, stsd + 16 + 8);
  const width = buf.readUInt16BE(stsd + 16 + 32);
  const height = buf.readUInt16BE(stsd + 16 + 34);
  // ⚠️ mdhd 字段偏移（从**盒起点**算，v0 实测字节：`…6d646864 | 01 000000 | creation | modification | timescale | duration`）：
  //    盒头 8B → version/flags@8 → creation@12 → modification@16 → **timescale@20** → **duration@24**。
  //    v1 的 creation/modification **各 8B** ⇒ **timescale@28（仍 4B！）** → **duration@32（8B）**。
  //    v1 的 timescale 不是 8 字节 —— 把它当 u64 读会静默变成 `timescale<<32`（实测 206158430208 fps）。
  const ver = buf.readUInt8(mdhd + 8);
  const readU = (o) => (ver === 1 ? Number(buf.readBigUInt64BE(o)) : buf.readUInt32BE(o));
  const timescale = ver === 1 ? buf.readUInt32BE(mdhd + 28) : readU(mdhd + 20);
  const durationTicks = readU(mdhd + (ver === 1 ? 32 : 24));
  const count = buf.readUInt32BE(stts + 12);
  let samples = 0; let ticks = 0;
  for (let i = 0; i < count; i++) {
    const cnt = buf.readUInt32BE(stts + 16 + i * 8);
    const dlt = buf.readUInt32BE(stts + 20 + i * 8);
    samples += cnt; ticks += cnt * dlt;
  }
  return {
    width,
    height,
    codec,
    fps: ticks > 0 ? Math.round((samples * timescale / ticks) * 100) / 100 : null,
    duration: timescale > 0 && durationTicks > 0 ? Math.round((durationTicks / timescale) * 100) / 100 : null,
    moovStart: frameAt,
    moovSize,
  };
}
const FIELDS = ['width', 'height', 'codec', 'fps', 'duration', 'moovStart', 'moovSize'];
const sameFields = (a, b) => a !== null && b !== null && FIELDS.every((k) => a[k] === b[k]);
/** "没有答案"的两种合法形态：显式 null 或整键缺席。**不许**是 0/NaN/Infinity —— 那些是"看起来像读数"的假答案。 */
const unknown = (v) => v === null || v === undefined;

// ═══ 夹具落盘 ═════════════════════════════════════════════════════════════════
let seq = 0;
/** 每个用例一个**新路径**：`getMediaInfo` 的缓存键含路径，用新名避免用例之间互相污染。 */
function writeCase (label, buf) {
  seq += 1;
  const abs = join(ISO, String(seq).padStart(2, '0') + '-' + label + '.mp4');
  writeFileSync(abs, buf);
  return abs;
}
const infoAt = (abs) => getMediaInfo(abs);

// ═══ A. faststart（moov 在头部）═══════════════════════════════════════════════
section('A. faststart 文件（moov 在头部）—— 手搓字节 + 独立走读对账');
{
  const m = moovBox();
  const file = Buffer.concat([ftyp, m, mdat(900, 0x11)]);
  const want = ownInfo(file, ftyp.length, m.length);
  got = infoAt(writeCase('faststart-head', file));
  check('A1 七个字段与独立走读逐字段相同（期望不取自被测对象）', sameFields(got, want),
    JSON.stringify(got) + ' vs want ' + JSON.stringify(want));
  check('A2 具体读数：1920×1080 avc1 · fps 30 · duration 0.33s（timescale 30000 / duration 10000）',
    got !== null && got.width === 1920 && got.height === 1080 && got.codec === 'avc1'
    && got.fps === 30 && got.duration === 0.33 && got.moovStart === ftyp.length,
    JSON.stringify(got));
  check('A3 moovSize = moov 盒自述长度（与手搓盒的字节长度相同）',
    got !== null && got.moovSize === m.length, 'moovSize=' + (got && got.moovSize) + ' 实际盒长=' + m.length);
  rejection('A4 负对照：同一夹具挖掉 stsd ⇒ 同一个判据判 null（证明 A1 不是恒真）',
    infoAt(writeCase('head-no-stsd', Buffer.concat([ftyp, moovBox({ omit: ['stsd'] }), mdat(900)]))));
}

// ═══ B. moov 在尾部：`anchoredToEof` 分支 ═════════════════════════════════════
section('B. moov 落在 mdat 之后（尾部）—— 走 `anchoredToEof` 那一支');
{
  const m = moovBox();
  const file = Buffer.concat([ftyp, mdat(1000, 0x22), m]);
  const moovStart = ftyp.length + 8 + 1000;
  const want = ownInfo(file, moovStart, m.length);
  gotTail = infoAt(writeCase('moov-at-tail', file));
  check('B1 尾部 moov 也能读出全部字段，且与独立走读逐字段一致', sameFields(gotTail, want),
    JSON.stringify(gotTail) + ' vs want ' + JSON.stringify(want));
  check('B2 moovStart 落在 mdat 之后（正是 mp4-vfs 要不要搬布局的判据本身）',
    gotTail !== null && gotTail.moovStart === moovStart && gotTail.moovStart > ftyp.length,
    'moovStart=' + (gotTail && gotTail.moovStart) + ' want=' + moovStart);
  rejection('B3 负对照：同一个尾部 moov 截掉 60 字节（盒长越界）⇒ 判 null',
    infoAt(writeCase('tail-truncated', file.slice(0, file.length - 60))));
}

// ═══ C. mdat 内部的假 `moov` 串 —— 必须绕开它，不许把 mdat 字节当盒 ════════════
section('C. mdat 内部的假 `moov` 串 —— 两块窗口（头 1MB / 尾锚 EOF）的分工');
{
  // 真 moov 先单独留一份字节 ⇒ 期望值可以**直接对真盒**跑独立走读（绕开窗口/provider 语义）。
  const fake = moovBox({ width: 2, height: 2, timescale: 1000, duration: 5, samples: 1, delta: 1 });
  const real = moovBox();
  const file = Buffer.concat([ftyp, box('mdat', fake, Buffer.alloc(200, 0x33)), real]);
  const realAt = file.length - real.length;
  const wantC = ownInfo(real, 0, real.length, 0, realAt);
  const gotC = infoAt(writeCase('fake-moov-in-mdat', file));
  check('C1 小文件：mdat 里那个**同尺寸**假 moov 不得胜出 —— 七个字段与"直接对真 moov 走读"逐个相同',
    sameFields(gotC, wantC), JSON.stringify(gotC) + ' vs want ' + JSON.stringify(wantC));
  check('C2 假串与真串**盒长完全相同**（宽的判据抓不住它：靠的是"真 moov 结束在 EOF"这条锚）',
    fake.length === real.length && gotC !== null && gotC.moovSize === real.length,
    'fake=' + fake.length + ' real=' + real.length);

  // 真文件里 mdat 可以几百 MB ⇒ 头窗口（1MB）里全是 mdat 字节。故意在**头 1MB 之内**放一个
  // 假 `moov` 串（只是字符串，不是盒）、真 moov 放 EOF 之外：头扫描必须**扫不到它**，
  // 否则这条链会用 mdat 的垃圾字节冒充元信息。
  const big = Buffer.concat([ftyp, box('mdat', ascii('moov'), Buffer.alloc(1024 * 1024, 0x5a)), real]);
  const gotBig = infoAt(writeCase('fake-string-head-plus-tail-moov', big));
  check('C3 >1MB 的 mdat：头部窗口里的假 `moov` 字节串扫不出盒 ⇒ 由尾部（锚 EOF）窗口接住真 moov',
    sameFields(gotBig, ownInfo(real, 0, real.length, 0, big.length - real.length))
    && gotBig.moovStart === big.length - real.length,
    JSON.stringify(gotBig) + ' vs want moovStart=' + (big.length - real.length));
}

// ═══ D. 位移算术的交叉验证（换 timescale / 换 mdhd 版本）═══════════════════════
section('D. 位移算术：换 timescale / version=1 时读数必须跟着变');
{
  const m2 = moovBox({ timescale: 600, duration: 1200, samples: 60, delta: 20 });
  const f2 = Buffer.concat([ftyp, m2, mdat(800)]);
  got2 = infoAt(writeCase('timescale-600', f2));
  const want2 = ownInfo(m2, 0, m2.length, 0, ftyp.length);
  check('D1 timescale=600 / duration=1200 ⇒ duration=2s、fps=30（与 A2 的 0.33s 不同 ⇒ 不是写死的）',
    got2 !== null && got2.duration === 2 && got2.fps === 30 && got2.duration !== 0.33, JSON.stringify(got2));
  check('D2 同一夹具与独立走读（直接对 moov 字节）逐字段一致', sameFields(got2, want2),
    JSON.stringify(got2) + ' vs ' + JSON.stringify(want2));

  const m3 = moovBox({ version: 1, timescale: 48000, duration: 96000, samples: 96, delta: 1000 });
  const f3 = Buffer.concat([ftyp, m3, mdat(800)]);
  got3 = infoAt(writeCase('mdhd-version-1', f3));
  const want3 = ownInfo(m3, 0, m3.length, 0, ftyp.length);
  check('D3 mdhd version=1（64 位 timescale/duration 那条分支）⇒ duration=2s、fps=48，且与独立走读一致',
    got3 !== null && got3.duration === 2 && got3.fps === 48 && sameFields(got3, want3),
    JSON.stringify(got3) + ' vs want ' + JSON.stringify(want3));
  // 负对照：**同一份字节**只把 mdhd 的 version 从 1 改成 0（其余一字不动）⇒ 按 32 位读法解出来的
  // timescale/duration 必然不同 ⇒ 读数必须变。证明 D3 真的走进了 64 位分支。
  const v0 = Buffer.from(m3);
  v0.writeUInt8(0, 8 + 8 + 8 + 8); // moov头(8) + trak头(8) + mdia头(8) + mdhd头(8) = version 字节
  const g0 = infoAt(writeCase('mdhd-version-0-samebytes', Buffer.concat([ftyp, v0, mdat(800)])));
  check('D4 负对照：同一字节流把 version 改成 0 ⇒ 读数不再是 2s/48（证明 D3 走的是 64 位分支）',
    g0 === null || g0.duration !== 2 || g0.fps !== 48, JSON.stringify(g0));
}

// ═══ E. 非视频轨必须被跳过 ═══════════════════════════════════════════════════
section('E. 非视频轨（hdlr ≠ vide）不得被当成视频读数');
{
  const audio = moovBox({ handler: 'soun', width: 4, height: 4 });
  const video = moovBox();
  const both = box('moov', audio.slice(8), video.slice(8));
  gotAudioSkip = infoAt(writeCase('soun-then-vide', Buffer.concat([ftyp, both, mdat(300)])));
  // 期望值不取自被测对象：把 soun/vide 两轨并成一个 moov 后，第二轨才是真视频轨。
  const wantE = ownInfo(both, 0, both.length, 1, ftyp.length);
  check('E1 第一条 trak 是 soun（假尺寸 4×4）⇒ 跳过它，读第二条 vide 的 1920×1080（读成 4×4 就是把音频轨当视频）',
    gotAudioSkip !== null && gotAudioSkip.width === 1920 && gotAudioSkip.height === 1080
    && sameFields(gotAudioSkip, wantE),
    JSON.stringify(gotAudioSkip) + ' vs 第二轨 want ' + JSON.stringify(wantE));
  rejection('E2 负对照：只有 soun 轨 ⇒ 判 null（不许把音频轨的 stsd 当视频读）',
    infoAt(writeCase('only-soun', Buffer.concat([ftyp, audio, mdat(300)]))));
}

// ═══ F. 拒绝面 ═══════════════════════════════════════════════════════════════
section('F. 拒绝面（每个畸形输入各自的理由）');
{
  rejection('F1 不存在的路径 ⇒ null', infoAt(join(ISO, 'does-not-exist.mp4')));
  rejection('F2 空文件 ⇒ null', infoAt(writeCase('empty', Buffer.alloc(0))));
  rejection('F3 小于 64 字节 ⇒ null（早于任何盒走读）', infoAt(writeCase('tiny', Buffer.alloc(40, 1))));
  rejection('F4 非 MP4（无 ftyp / 无 moov）⇒ null', infoAt(writeCase('not-mp4', Buffer.alloc(4096, 0x7a))));
  rejection('F5 有 ftyp 但无 moov ⇒ null', infoAt(writeCase('no-moov', Buffer.concat([ftyp, mdat(2000)]))));
  rejection('F6 moov 盒自述长度超出文件尾 ⇒ null（不许按越界长度去 readSync）', (() => {
    const bad = Buffer.from(moovBox());
    bad.writeUInt32BE(bad.length + 4096, 0);
    return infoAt(writeCase('moov-size-lies', Buffer.concat([ftyp, bad, mdat(600)])));
  })());
  // F7/F8 钉住的是**"缺什么就只缺什么"**：mdhd 缺失 / timescale=0 时，时长与帧率**没有**答案
  //（必须是 null，不许是 NaN/Infinity/0 这类"看起来像读数"的东西），但 stsd 里的尺寸仍然可用
  //（面板尺寸与转码决策是两件事 ⇒ 不该被一起打成 null）。这是取舍，写在判据里而不是散在注释里。
  const noMdhd = infoAt(writeCase('moov-no-mdhd', Buffer.concat([ftyp, moovBox({ omit: ['mdhd'] }), mdat(400)])));
  check('F7 moov 缺 mdhd ⇒ duration/fps 判"无答案"（null 或整键缺席，不许 NaN/0 冒充），尺寸仍给出',
    noMdhd !== null && unknown(noMdhd.duration) && unknown(noMdhd.fps)
    && noMdhd.width === 1920 && noMdhd.height === 1080, JSON.stringify(noMdhd));
  const zeroTs = infoAt(writeCase('timescale-zero', Buffer.concat([ftyp, moovBox({ timescale: 0, duration: 0 }), mdat(400)])));
  check('F8 timescale=0 ⇒ duration/fps 判"无答案"（不是 NaN/Infinity 漏出去），尺寸仍给出',
    zeroTs !== null && unknown(zeroTs.duration) && unknown(zeroTs.fps) && zeroTs.width === 1920, JSON.stringify(zeroTs));
  rejection('F9 未知编码（stsd 里不是 avc1/hvc1/…）⇒ codec 认不出 ⇒ null',
    infoAt(writeCase('unknown-codec', Buffer.concat([ftyp, moovBox({ codec: 'zzzz' }), mdat(400)]))));
  // 这一条钉住一个**取舍**：fps 不可得不等于整份元信息不可得（尺寸仍要给面板用）。
  const zeroDelta = infoAt(writeCase('stts-zero-delta',
    Buffer.concat([ftyp, moovBox({ samples: 0, delta: 0 }), mdat(400)])));
  check('F10 stts 的 delta=0 ⇒ fps 算不出来，但尺寸仍给出（fps 为空，不许整份判 null）',
    zeroDelta !== null && zeroDelta.width === 1920 && zeroDelta.fps === null, JSON.stringify(zeroDelta));
}

// ═══ G. 缓存键：同一路径换文件必须重新探测 ════════════════════════════════════
section('G. 缓存（键 = 路径 + size + mtime）');
{
  const abs = join(ISO, 'cache-same-path.mp4');
  const a = Buffer.concat([ftyp, moovBox(), mdat(500)]);
  const b = Buffer.concat([ftyp, moovBox({ width: 1280, height: 720, timescale: 600, duration: 900, samples: 45, delta: 20 }), mdat(500)]);
  writeFileSync(abs, a);
  const first = getMediaInfo(abs);
  const second = getMediaInfo(abs);
  gotCache = first;
  check('G1 同一路径连续两次给出**同一个对象**（第二次走缓存）', first !== null && first === second);
  check('G2 期望值来自手搓布局：第一次 1920×1080', first !== null && first.width === 1920 && first.height === 1080);
  writeFileSync(abs, b);
  const st = statSync(abs);
  utimesSync(abs, st.atime, st.mtimeMs / 1000 + 5); // 时间戳推到未来，避免粒度把"改了"抹平
  const third = getMediaInfo(abs);
  check('G3 同一路径换了内容 ⇒ 重新探测，读到 1280×720（旧的 1920 不许留在缓存里）',
    third !== null && third.width === 1280 && third.height === 720 && third !== first, JSON.stringify(third));
  check('G4 负对照：换内容前的那个对象仍是旧值（证明 G3 的变化来自重新探测，不是同一对象被改写）',
    first.width === 1920 && first.height === 1080);
}

// ═══ H. 覆盖面地板 ════════════════════════════════════════════════════════════
section('H. 覆盖面地板（防"判据在空域上恒真"）');
{
  // 地板写在条件块**外面**（§4.5 第 3 条）：`positive` 是"真的从 moov 里读出过答案"的用例数，
  // 零值必须被看见，而不是让下面的判据在空域上恒真。
  const positive = [got, got2, got3, gotAudioSkip, gotCache, gotTail].filter((x) => x !== null).length;
  check('H1 真读出过答案的用例数 ≥ 5（零值必须显形）', positive >= 5, 'positive=' + positive);
  check('H2 畸形输入用例数 ≥ 8（拒绝面足够宽）', rejected >= 8, 'rejected=' + rejected);
  check('H3 本文件确实 import 了被测模块（不是隔着别的东西判）', typeof getMediaInfo === 'function');
}

rmSync(ISO, { recursive: true, force: true });
console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
