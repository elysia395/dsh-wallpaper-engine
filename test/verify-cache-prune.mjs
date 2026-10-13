#!/usr/bin/env node
/**
 * verify-cache-prune.mjs —— `lib/cache-prune.js` 的聚焦判据。
 *
 * 被测对象：`createCachePruneKit({ transcodeCacheDir, ffmpegDataDir, videoPreviewCacheDir })` ——
 * 启动/重扫时跑的四件清理：孤儿产物清扫、自定义画面 `.tmp` 清扫、视频缩略图上限、转码缓存总量上限。
 *
 * 为什么值得独立守卫：这四件事的失效形态全是**静默**的 ——
 *   · 少认了「本进程在途写」的形态 ⇒ HMR 重扫时删掉正在写的转码产物（产物损坏，无报错）；
 *   · 年龄 / 「永不删最新一份」保护失效 ⇒ 删掉在途任务的输入；
 *   · 上限失效 ⇒ 缓存涨到几十 GB；反过来保护过头 ⇒ 永不清理。
 * 它读的目录全部注入 ⇒ 判据可以完全在 `.test-cache/` 里造，不需要真机。
 *
 * 判据设计（DEV-GUIDE §4.7）：每条正向判据都配一条**同一段判据代码**跑出来的变异体负对照
 * （源码现场改写，落在 `.test-cache/` 下，不动 `lib/`）；覆盖面地板在 G 段，写在 `if` 之外。
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, utimesSync, rmSync, readdirSync, symlinkSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCachePruneKit } from '../lib/cache-prune.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ISO = join(ROOT, '.test-cache', 'cache-prune-guard');
const SRC = join(ROOT, 'lib', 'cache-prune.js');
const PID = process.pid;
const MINUTE = 60 * 1000;
const OLD = 30 * MINUTE; // 比 5 分钟（在途保护）与 10 分钟（.tmp 年龄门）都旧

let passed = 0; let failed = 0;
/** 跳过账本（`docs/DEV-GUIDE.md` §4.7 约定 10）：本文件当前的跳过出口只有 D6 一条，
 *  但跳过必须**进汇总行带计数**，否则"没跑"与"通过"同形。 */
const skipNotes = [];
function check (name, ok, detail) {
  if (ok) passed++;
  else failed++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
}
function section (t) { console.log('\n' + t); }

rmSync(ISO, { recursive: true, force: true });
mkdirSync(ISO, { recursive: true });

let dirSeq = 0;
/** 每个判据一个空目录，互不干扰。 */
function dir (label) {
  const p = join(ISO, (dirSeq++) + '-' + label);
  mkdirSync(p, { recursive: true });
  return p;
}
/** 造有内容的文件（判据只看 size 与 mtime，内容不重要）。 */
function file (p, size = 8, ageMs = 0) {
  writeFileSync(p, 'x'.repeat(size));
  if (ageMs) { const t = new Date(Date.now() - ageMs); utimesSync(p, t, t); }
  return p;
}

/**
 * 被测套件的构造方式。**未注入的目录解析器默认为抛异常的哨兵** ——
 * 判据若误用了没注入的目录会立刻炸出来，而不是静默扫错目录。
 */
function sentinelProviders (dirs) {
  const boom = () => { throw new Error('未注入的目录解析器被调用'); };
  return {
    transcodeCacheDir: dirs.transcode || boom,
    ffmpegDataDir: dirs.ffmpeg || boom,
    videoPreviewCacheDir: dirs.preview || boom,
  };
}
const realKit = (dirs) => createCachePruneKit(sentinelProviders(dirs));

// ── 变异体加载器（本模块只 import node: 内建 ⇒ 变异体可直接落在 tmp 里跑）────────
let mutantSeq = 0;
async function loadMutant (label, transform) {
  const src = readFileSync(SRC, 'utf8');
  const out = transform(src);
  if (out === src) throw new Error('变异体没改到源码（判据会失真）: ' + label);
  const d = join(ISO, 'mutants');
  mkdirSync(d, { recursive: true });
  const f = join(d, (mutantSeq++) + '-' + label + '.mjs');
  writeFileSync(f, out);
  const mod = await import(pathToFileURL(f).href);
  return (dirs) => mod.createCachePruneKit(sentinelProviders(dirs));
}
const names = (p) => readdirSync(p);

// ── 判据本体（正向与负对照共用同一段代码；`make` = (dirs) => kit）──────────────

/** ① 三个注入目录都要真扫到：各自的孤儿清掉、各自的在途写留住；每个解析器恰好被调用一次。 */
function ownTmpProtected (make, d) {
  const sub = ['t', 'f', 'p'].map((tag) => { const p = join(d, tag); mkdirSync(p, { recursive: true }); return p; });
  const own = ['tc_a.mp4.tmp' + PID, 'tc_b.mp4.tmp' + PID + '000123'];
  const foreign = 'tc_c.mp4.tmp' + (PID + 1);
  const orphans = ['tc_d.mp4.prog', 'tc_e.mp4.part0', 'ffmpeg-err-x.log'];
  const keep = ['tc_keep.mp4', 'unrelated.txt'];
  for (const dir of sub) for (const n of [...own, foreign, ...orphans, ...keep]) file(join(dir, n), 8);
  const seen = [];
  const providers = {};
  ['transcode', 'ffmpeg', 'preview'].forEach((key, i) => {
    providers[key] = () => { seen.push('tfp'[i]); return sub[i]; };
  });
  make(providers).sweepTranscodeArtifacts();
  const alive = (dir, n) => existsSync(join(dir, n));
  return sub.every((dir) => own.every((n) => alive(dir, n)) && !alive(dir, foreign)
      && orphans.every((n) => !alive(dir, n)) && keep.every((n) => alive(dir, n)))
    && seen.join('') === 'tfp';
}

/** ② 三个目录解析器必须真的被调用（注入点是函数、在模块加载期求值）。 */
function allDirProvidersCalled (make, d) {
  const seen = [];
  const track = (tag) => { seen.push(tag); return d; };
  make({ transcode: () => track('t'), ffmpeg: () => track('f'), preview: () => track('p') })
    .sweepTranscodeArtifacts();
  return seen.sort().join('') === 'fpt';
}

/** ③ 自定义画面只清「够旧的 .tmp」：新鲜的（可能在途）与非 .tmp 都留。 */
function staleTmpOnly (make, d) {
  file(join(d, 'old.tmp'), 8, OLD);
  file(join(d, 'fresh.tmp'), 8);
  file(join(d, 'old.png'), 8, OLD);
  file(join(d, 'old.tmp.bak'), 8, OLD);
  make({}).sweepCustomFrameTmp(d);
  return !existsSync(join(d, 'old.tmp')) && existsSync(join(d, 'fresh.tmp'))
    && existsSync(join(d, 'old.png')) && existsSync(join(d, 'old.tmp.bak'));
}

/** ④ 缩略图上限（512）：513 个 pv_*.jpg ⇒ 删最旧的 1 个、留 512、最新必留。 */
function previewCapHolds (make, d) {
  const n = 513;
  for (let i = 0; i < n; i++) file(join(d, 'pv_' + String(i).padStart(4, '0') + '.jpg'), 8, (n - i) * MINUTE);
  file(join(d, 'other.jpg'), 8, OLD);
  file(join(d, 'pv_x.png'), 8, OLD);
  make({ preview: () => d }).pruneVideoPreviewCache();
  const left = names(d);
  const pv = left.filter((x) => x.startsWith('pv_') && x.endsWith('.jpg'));
  return pv.length === 512 && !left.includes('pv_0000.jpg') && left.includes('pv_0512.jpg')
    && left.includes('other.jpg') && left.includes('pv_x.png');
}

/** ⑤ 不超预算 ⇒ 一个不删。 */
function sizeCapNoopBelowBudget (make, d) {
  file(join(d, 'a.mp4'), 100, OLD);
  file(join(d, 'b.mp4'), 100, OLD);
  make({}).pruneCacheDirBySize(d, 1000, /\.mp4$/);
  return existsSync(join(d, 'a.mp4')) && existsSync(join(d, 'b.mp4'));
}

/** ⑥ 超限 ⇒ 按 mtime 从最旧删到 ≤ 上限，且**永不删最新的一份**。 */
function sizeCapKeepsNewest (make, d) {
  file(join(d, 'a.mp4'), 100, OLD + 3 * MINUTE); // 最旧
  file(join(d, 'b.mp4'), 100, OLD + 2 * MINUTE);
  file(join(d, 'c.mp4'), 100, OLD + MINUTE);     // 最新
  make({}).pruneCacheDirBySize(d, 150, /\.mp4$/);
  return !existsSync(join(d, 'a.mp4')) && !existsSync(join(d, 'b.mp4')) && existsSync(join(d, 'c.mp4'));
}

/** ⑦ 年轻文件（< 5 分钟）即使超限也不删 —— 可能是在途任务刚写的产物。 */
function sizeCapAgeGate (make, d) {
  file(join(d, 'young.mp4'), 100);
  file(join(d, 'young2.mp4'), 100);
  make({}).pruneCacheDirBySize(d, 1, /\.mp4$/);
  return existsSync(join(d, 'young.mp4')) && existsSync(join(d, 'young2.mp4'));
}

/** ⑧ 本进程的 `.tmp<pid>` 输出既不计数也不删。 */
function sizeCapProtectsOwnTmp (make, d) {
  const own = 'tc_own.mp4.tmp' + PID;
  file(join(d, own), 100, OLD);
  file(join(d, 'tc_a.mp4'), 100, OLD + MINUTE);
  // matchRe 故意也匹配 .tmp 名 ⇒ 唯一挡住它的是 ownTmpSuffix（而不是 matchRe 偶然不匹配）
  make({}).pruneCacheDirBySize(d, 50, /^tc_/);
  return existsSync(join(d, own));
}

/** ⑨ 目录不计入总量：唯一"超额"来自一个目录时，真文件必须活下来。 */
function sizeCapIgnoresDirs (make, d) {
  const sub = join(d, 'tc_dir.mp4');
  mkdirSync(sub);
  const dirSize = statSync(sub).size;
  // macOS/APFS 上目录 size 极小（< 4096）⇒ 本机无判别力，具名 SKIP 并进 G 段可见性；
  // Linux/CI 的 ext4 腿目录恒 4096 字节，**那条腿才有牙**（matrix.os 双平台的意义，见 DEV-GUIDE §4.3）。
  if (dirSize < 4096) return null;
  file(join(d, 'tc_real.mp4'), 100, OLD + MINUTE); // 比目录新 ⇒ 若目录计数，先删目录（失败）再轮到它
  make({}).pruneCacheDirBySize(d, 4096, /^tc_/);
  return existsSync(join(d, 'tc_real.mp4'));
}

/** ⑩ matchRe 是调用方口径：不匹配的名字不参与计数也不该被删。 */
function sizeCapRespectsMatcher (make, d) {
  file(join(d, 'a.mp4'), 100, OLD);
  file(join(d, 'big.bin'), 5000, OLD);
  make({}).pruneCacheDirBySize(d, 10, /\.mp4$/);
  return existsSync(join(d, 'big.bin'));
}

/** ⑪ 全部失败路径"宁可不清"：目录不存在 / 不是目录 ⇒ 不抛。 */
function failuresAreQuiet (make, d) {
  const missing = join(d, 'no-such-dir');
  file(missing, 8); // 存在但是个文件 —— 也是 readdir 的失败路径
  const k = make({ transcode: () => missing, ffmpeg: () => join(d, 'nope2'), preview: () => join(d, 'nope3') });
  try {
    k.sweepTranscodeArtifacts();
    k.sweepCustomFrameTmp(join(d, 'nope4'));
    k.pruneVideoPreviewCache();
    k.pruneCacheDirBySize(join(d, 'nope5'), 1, /./);
    return true;
  } catch { return false; }
}

/** ⑫ 工厂只暴露 5 个名字；内部常量（年龄门 / 上限 / 陈旧阈值）不得外泄成 API。 */
function kitSurfaceOnlyFive (make) {
  const k = make({});
  const want = 'TRANSCODE_CACHE_MAX_BYTES,pruneCacheDirBySize,pruneVideoPreviewCache,'
    + 'sweepCustomFrameTmp,sweepTranscodeArtifacts';
  return Object.keys(k).sort().join(',') === want
    && typeof k.TRANSCODE_CACHE_MAX_BYTES === 'number' && k.TRANSCODE_CACHE_MAX_BYTES > 0
    && !('CACHE_PRUNE_MIN_AGE_MS' in k) && !('VIDEO_PREVIEW_CACHE_MAX' in k)
    && !('CUSTOM_FRAME_TMP_STALE_MS' in k);
}

// ═══ A. 孤儿清扫（文件头不变量 1 + 3）════════════════════════════════════════
await (async () => {
  section('A. 孤儿产物清扫：本进程在途写必须留住（含 `.tmp<pid><6 位序号>`），其余孤儿清掉');
  check('A1 三个注入目录各自：`.tmp<pid>` 与 `.tmp<pid>123456` 留住；别的 pid 的 .tmp、.prog/.part/ffmpeg-err 清掉；无关文件不动；每个解析器恰好调用一次',
    ownTmpProtected(realKit, dir('a1')));
  check('A2 三个目录解析器都被调用（注入点是函数、在模块加载期求值）',
    allDirProvidersCalled(realKit, dir('a2')));

  const noSeq = await loadMutant('own-tmp-no-seq', (s) => s.replace(
    "new RegExp('\\\\.tmp' + process.pid + '\\\\d*$')", () => "new RegExp('\\\\.tmp' + process.pid + '$')"));
  check('A3 负对照：变异体把 ownTmpRe 收成 `.tmp<pid>$`（丢掉递增序号）⇒ A1 判据判红',
    ownTmpProtected(noSeq, dir('a3')) === false);

  const notCalled = await loadMutant('dir-provider-not-called', (s) => s.replace(
    'const dirs = [transcodeCacheDir(), ffmpegDataDir(), videoPreviewCacheDir()];',
    'const dirs = [transcodeCacheDir, ffmpegDataDir, videoPreviewCacheDir];'));
  check('A4 负对照：变异体把目录解析器当路径用（不调用）⇒ A2 判据判红',
    allDirProvidersCalled(notCalled, dir('a4')) === false);

  const d5 = dir('a5');
  file(join(d5, 'not-a-dir'), 8);
  const k5 = realKit({ transcode: () => join(d5, 'not-a-dir'), ffmpeg: () => join(d5, 'missing'), preview: () => join(d5, 'missing2') });
  let threw = false;
  try { k5.sweepTranscodeArtifacts(); } catch { threw = true; }
  const d6 = dir('a6');
  file(join(d6, 'tc_y.mp4.prog'), 8);
  realKit({ transcode: () => d6, ffmpeg: () => join(d6, 'missing'), preview: () => join(d6, 'missing2') })
    .sweepTranscodeArtifacts();
  check('A5 readdir 抛异常（路径是文件 / 目录不存在）⇒ 不抛，且不阻断其余目录的清扫',
    !threw && !existsSync(join(d6, 'tc_y.mp4.prog')));

  const noPart = await loadMutant('sweep-no-part', (s) => s.replace(' || /\\.part\\d*$/.test(name)', ''));
  check('A6 负对照：变异体删掉 `.part\\d*$` 这一支 ⇒ 下载残片不再被清 ⇒ A1 判据判红',
    ownTmpProtected(noPart, dir('a6b')) === false);
})();

// ═══ B. 自定义画面 .tmp（时间口径）═══════════════════════════════════════════
await (async () => {
  section('B. 自定义画面 `.tmp`：只清够旧的（HMR 重扫时在途上传的确定性临时名必须留住）');
  check('B1 够旧的 .tmp 被删；新鲜的 .tmp、非 .tmp、`.tmp.bak` 都留', staleTmpOnly(realKit, dir('b1')));
  check('B2 判据对"够旧"确实敏感（换一个目录再跑一次必须同样成立）', staleTmpOnly(realKit, dir('b2')));

  const noAge = await loadMutant('stale-tmp-no-age', (s) => s.replace(
    'if (statSync(abs).mtimeMs > cutoff) continue;', 'if (false) continue;'));
  const d3 = dir('b3');
  file(join(d3, 'old.tmp'), 8, OLD);
  file(join(d3, 'fresh.tmp'), 8);
  noAge({}).sweepCustomFrameTmp(d3);
  check('B3 负对照：变异体拆掉年龄门 ⇒ 新鲜 .tmp 也被删 ⇒ B1 判据判红',
    existsSync(join(d3, 'fresh.tmp')) === false);

  let ok = true;
  try { realKit({}).sweepCustomFrameTmp(join(ISO, 'no-such')); } catch { ok = false; }
  check('B4 目录不存在 ⇒ 不抛（宁可不清）', ok);
})();

// ═══ C. 缩略图上限 512 ══════════════════════════════════════════════════════
await (async () => {
  section('C. 视频缩略图上限：513 个 pv_*.jpg ⇒ 删最旧的 1 个、留 512、最新必留');
  check('C1 上限成立：删到 512、删最旧、留最新；非 pv_*.jpg 一律不碰', previewCapHolds(realKit, dir('c1')));

  const zeroCap = await loadMutant('preview-cap-zero', (s) => s.replace(
    'const VIDEO_PREVIEW_CACHE_MAX = 512;', 'const VIDEO_PREVIEW_CACHE_MAX = 0;'));
  check('C2 负对照：变异体把上限设成 0 ⇒ 513 个全被删 ⇒ C1 判据判红',
    previewCapHolds(zeroCap, dir('c2')) === false);

  const keepOldest = await loadMutant('preview-keep-oldest', (s) => s.replace(
    '.sort((a, b) => b.mtime - a.mtime)', '.sort((a, b) => a.mtime - b.mtime)'));
  check('C3 负对照：变异体把排序反过来（保最旧）⇒ 最新一份被删 ⇒ C1 判据判红',
    previewCapHolds(keepOldest, dir('c3')) === false);

  check('C4 工厂只暴露 5 个名字，内部常量不外泄', kitSurfaceOnlyFive(realKit));

  const leaky = await loadMutant('kit-leaks-const', (s) => s.replace(
    '    TRANSCODE_CACHE_MAX_BYTES,\n  };', '    TRANSCODE_CACHE_MAX_BYTES,\n    CACHE_PRUNE_MIN_AGE_MS,\n  };'));
  check('C5 负对照：变异体把内部常量塞进返回值 ⇒ C4 判据判红',
    kitSurfaceOnlyFive(leaky) === false);

  const sizeKeepNewestFirst = await loadMutant('size-sort-reversed', (s) => s.replace(
    'entries.sort((x, y) => x.mtime - y.mtime);', 'entries.sort((x, y) => y.mtime - x.mtime);'));
  check('C6 负对照：变异体把容量修剪的排序反过来（先删最新）⇒ D2 判据判红',
    sizeCapKeepsNewest(sizeKeepNewestFirst, dir('c6')) === false);
})();

// ═══ D. 总量上限（按 mtime-LRU）═════════════════════════════════════════════
await (async () => {
  section('D. 转码缓存总量上限：按 mtime 从最旧删到 ≤ 上限，永不删最新 / 在途 / 本进程 .tmp');
  check('D1 total ≤ max ⇒ 一个不删', sizeCapNoopBelowBudget(realKit, dir('d1')));
  check('D2 超限 ⇒ 从最旧开始删到 ≤ 上限，且最新的一份必须留下', sizeCapKeepsNewest(realKit, dir('d2')));
  check('D3 年轻文件（< 5 分钟）即使超限也不删（在途任务的产物）', sizeCapAgeGate(realKit, dir('d3')));
  check('D4 本进程 `.tmp<pid>` 输出既不计数也不删（matchRe 也匹配它时仍受保护）',
    sizeCapProtectsOwnTmp(realKit, dir('d4')));
  check('D5 matchRe 是调用方口径：不匹配的名字不参与计数也不被删', sizeCapRespectsMatcher(realKit, dir('d5')));
  const dirJudgment = sizeCapIgnoresDirs(realKit, dir('d6'));
  if (dirJudgment === null) {
    skipNotes.push('D6 目录不计入总量（本文件系统上目录 size 过小，无判别力）');
    console.log('  ⚠ SKIP D6：本文件系统上目录 size 过小 ⇒ 该判据无判别力（不是通过）');
  } else check('D6 目录不计入总量：唯一"超额"来自目录时真文件活下来', dirJudgment);

  const noOwn = await loadMutant('size-no-own-tmp', (s) => s.replace(
    'if (name.endsWith(ownTmpSuffix) || !matchRe.test(name)) continue;',
    'if (false || !matchRe.test(name)) continue;'));
  const d7 = dir('d7');
  // 让本进程 .tmp 成为**最旧**的一份 —— 变异体才会真的轮到它（否则循环先删掉旧的真文件就停了）
  file(join(d7, 'tc_own.mp4.tmp' + PID), 100, OLD + MINUTE);
  file(join(d7, 'tc_a.mp4'), 100, OLD);
  noOwn({}).pruneCacheDirBySize(d7, 50, /^tc_/);
  check('D7 负对照：变异体不保护本进程 .tmp ⇒ 它被删 ⇒ D4 判据判红',
    existsSync(join(d7, 'tc_own.mp4.tmp' + PID)) === false);

  const noAgeGate = await loadMutant('size-no-age-gate', (s) => s.replace(
    'if (now - e.mtime < CACHE_PRUNE_MIN_AGE_MS) continue; // 可能是在途任务刚写的',
    'if (false) continue;'));
  const d8 = dir('d8');
  file(join(d8, 'young.mp4'), 100);
  file(join(d8, 'young2.mp4'), 100);
  noAgeGate({}).pruneCacheDirBySize(d8, 1, /\.mp4$/);
  check('D8 负对照：变异体拆掉 5 分钟年龄门 ⇒ 年轻文件被删 ⇒ D3 判据判红',
    existsSync(join(d8, 'young.mp4')) === false || existsSync(join(d8, 'young2.mp4')) === false);

  const noNewest = await loadMutant('size-may-delete-newest', (s) => s.replace(
    'for (let i = 0; i < entries.length - 1 && total > maxBytes; i++) {',
    'for (let i = 0; i < entries.length && total > maxBytes; i++) {'));
  const d9 = dir('d9');
  file(join(d9, 'a.mp4'), 100, OLD + MINUTE); // 最新
  file(join(d9, 'b.mp4'), 100, OLD);          // 最旧
  noNewest({}).pruneCacheDirBySize(d9, 0, /\.mp4$/);
  check('D9 负对照：变异体允许删到"最新的一份" ⇒ D2 判据判红',
    existsSync(join(d9, 'a.mp4')) === false && existsSync(join(d9, 'b.mp4')) === false);

  check('D10 全部失败路径安静：四个清扫函数面对不存在/非目录路径都不抛', failuresAreQuiet(realKit, dir('d10')));

  check('D11 stat 失败（悬空软链）⇒ 跳过且不抛（宁可不清），真文件照常参与上限',
    (() => {
      const d11 = dir('d11');
      file(join(d11, 'tc_a.mp4'), 100, OLD);
      symlinkSync(join(d11, 'nowhere'), join(d11, 'tc_dangle.mp4'));
      let ok = true;
      try { realKit({}).pruneCacheDirBySize(d11, 0, /^tc_/); } catch { ok = false; }
      // existsSync 会跟随软链 ⇒ 悬空链必须用 lstat 才看得见
      return ok && lstatSync(join(d11, 'tc_dangle.mp4')).isSymbolicLink();
      
    })());

  const noStatCatch = await loadMutant('size-stat-uncaught', (s) => s.replace(
    'try { st = statSync(p); } catch { continue; }', 'st = statSync(p);'));
  check('D12 负对照：变异体不再吞掉 stat 异常 ⇒ 悬空软链让清扫抛出去 ⇒ D11 判据判红',
    (() => {
      const d12 = dir('d12');
      file(join(d12, 'tc_a.mp4'), 100, OLD);
      symlinkSync(join(d12, 'nowhere'), join(d12, 'tc_dangle.mp4'));
      try { noStatCatch({}).pruneCacheDirBySize(d12, 0, /^tc_/); return false; } catch { return true; }
    })());
})();

// ═══ G. 覆盖面地板（写在 if 之外）════════════════════════════════════════════
section('G. 覆盖面地板（防"判据在空域上恒真"）');
check('G1 正向判据数 ≥ 18', passed >= 18, 'passed=' + passed);
check('G2 变异体负对照数 ≥ 6', mutantSeq >= 6, 'mutants=' + mutantSeq);
check('G3 本文件直读被测模块（guard-map 的覆盖认定靠这个路径字面量）',
  readFileSync(SRC, 'utf8').includes('export function createCachePruneKit')
  && typeof createCachePruneKit === 'function');

console.log('');
if (skipNotes.length) {
  console.log('  ⚠️ 本次**未执行**的判据（不计入通过）—— ' + skipNotes.length + ' 条：');
  for (const s of skipNotes) console.log('     ○ ' + s);
}
if (failed) {
  console.log(`CACHE-PRUNE CHECKS FAILED — ${failed} failed, ${passed} passed`
    + (skipNotes.length ? `, ${skipNotes.length} skipped` : ''));
  process.exit(1);
}
console.log(`ALL CACHE-PRUNE CHECKS PASSED (${passed})`
  + (skipNotes.length ? ` —— ⚠️ ${skipNotes.length} 条未执行（不是通过，见上面的 ○ 行）` : ''));
