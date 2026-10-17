#!/usr/bin/env node
/**
 * verify-cache-prune.mjs —— **缓存清扫族**的聚焦判据。
 *
 * ⚠️ 重指真源（cache-prune 删除前置）：上游同名副本 `lib/cache-prune.js` 已不在 import 图上，
 * 清扫本体住在活侧**两个套件的返回面**里，本守卫改为**两源适配器**（判据与期望值一字未改，
 * 只多一层"把两源合并成原来那个 5 名 kit 面"的装配）：
 *   · `lib/media/transcode.js` 的 `createTranscodeKit()` → `sweepTranscodeArtifacts`（孤儿产物清扫：
 *     `.tmp<pid><序号>` / `.part` / `.prog` / `ffmpeg-err-*`）· `sweepCustomFrameTmp`（自定义画面目录
 *     只清**够旧的** `.tmp`）；
 *   · `lib/media/video-preview.js` 的 `createVideoPreviewKit()` → `pruneVideoPreviewCache`（缩略图份数
 *     上限）· `pruneCacheDirBySize` · `TRANSCODE_CACHE_MAX_BYTES`（转码缓存总量上限 LRU）。
 * 时点与顺序（`startupSweepTimer` 先后）由 `lib/startup-sweep.js` 编排，不属本守卫的被测面。
 * 变异体是**多源**的（共享 `test/tools/multi-source-mutants.mjs`）：每条编辑带源键，
 * 在该源文本里命中自检后替换，落盘再 import。
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
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTranscodeKit } from '../lib/media/transcode.js';
import { createVideoPreviewKit } from '../lib/media/video-preview.js';
import { makeMultiSourceMutants } from './tools/multi-source-mutants.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ISO = join(ROOT, '.test-cache', 'cache-prune-guard');
/** 两处真源：源键 → 文件（变异体按源键分派）。 */
const SOURCES = {
  transcode: join(ROOT, 'lib', 'media', 'transcode.js'),
  videoPreview: join(ROOT, 'lib', 'media', 'video-preview.js'),
};
const FACTORY_NAMES = { transcode: 'createTranscodeKit', videoPreview: 'createVideoPreviewKit' };
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

/**
 * 软链能力探针（判据夹具的**前置条件**，不是判据）：D11/D12 要造一条**悬空软链**
 * （目录项还在 ⇒ lstat 看得见，但 stat 失败）。Windows 账户没有
 * SeCreateSymbolicLinkPrivilege（或宿主沙箱禁止 reparse point）时 `symlinkSync` 一律
 * EPERM/ENOSYS ⇒ 「stat 失败」这条失效形态在本机造不出来（junction 也不行：悬空后 lstat
 * 同样抛 ENOENT，且 rmSync 会 ENOTEMPTY 留垃圾）。此时按本文件既有约定（D6 同款）记入
 * `skipNotes`、**不计入通过**；能建软链的平台（CI / Linux / 开了开发者模式的 Windows）上
 * 两条判据原样带牙跑 —— 用探针而不是常量判断：能力取决于运行账户与沙箱，不是平台名。
 */
const SYMLINK_OK = (() => {
  const probe = join(ISO, 'symlink-capability');
  mkdirSync(probe, { recursive: true });
  try { symlinkSync(join(probe, 'nowhere'), join(probe, 'probe.link')); return true; }
  catch { return false; }
})();

let dirSeq = 0;
/**
 * 每个判据一个空目录，互不干扰。**返回的就是"视频缩略图缓存目录"本身**
 * （`<label>/video-previews`）—— 与真源 `videoPreviewCacheDir() = join(cacheBaseDir(), 'video-previews')`
 * 的落点对齐：单目录形态的夹具（C/D 段）因此可以原样用 `d`（见 `liveDeps()` 的反推）。
 */
function dir (label) {
  const base = join(ISO, (dirSeq++) + '-' + label);
  const p = join(base, 'video-previews');
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
 * 两源套件的装配（**按活侧 deps 契约**给）：
 *   `createTranscodeKit({ cacheBaseDir, configPath, videoPreviewCacheDir, getMediaInfo, atomicTmpPath, pluginRoot })`
 *   `createVideoPreviewKit({ cacheBaseDir, ensureDirOnce, transcodeKit })`
 *
 * `dirs` 三种形态（判据沿用原来的调用点，不改成"到处传新键"）：
 *   · 三访问器 `{ cacheBase, configPath, preview }` —— A 段用它跟踪"每个注入访问器恰好被调用一次"；
 *   · 单目录 `{ preview: () => d }` —— `d` 必须以 `video-previews` 结尾（真源由 cacheBaseDir 派生），
 *     适配器据此反推 `cacheBaseDir = () => dirname(d)`；
 *   · `{}` —— 三个访问器都是**抛异常的哨兵**：判据若误用没注入的目录会立刻炸出来，而不是静默扫错目录。
 */
function liveDeps (dirs) {
  const boom = () => { throw new Error('未注入的目录解析器被调用'); };
  if (dirs.cacheBase || dirs.configPath) {
    return {
      cacheBaseDir: dirs.cacheBase || boom,
      configPath: dirs.configPath || boom,
      videoPreviewCacheDir: dirs.preview || boom,
    };
  }
  if (dirs.preview) {
    const p = dirs.preview();
    if (basename(p) !== 'video-previews') {
      throw new Error('单目录形态的夹具目录必须以 video-previews 结尾（真源按 join(cacheBaseDir(), …) 派生）：' + p);
    }
    return { cacheBaseDir: () => dirname(p), configPath: () => join(dirname(p), 'config.json'), videoPreviewCacheDir: () => p };
  }
  return { cacheBaseDir: boom, configPath: boom, videoPreviewCacheDir: boom };
}

/** 建两个真源套件；`mods` = 源键 → 变异体工厂（未变异的源用真源工厂）。 */
function makeKits (dirs, mods = {}) {
  const deps = liveDeps(dirs);
  const tk = (mods.transcode || createTranscodeKit)({
    cacheBaseDir: deps.cacheBaseDir,
    configPath: deps.configPath,
    videoPreviewCacheDir: deps.videoPreviewCacheDir,
    getMediaInfo: () => null,
    atomicTmpPath: (f) => f + '.tmp' + PID,
    pluginRoot: ROOT,
  });
  const vk = (mods.videoPreview || createVideoPreviewKit)({
    cacheBaseDir: deps.cacheBaseDir,
    ensureDirOnce: (p) => { mkdirSync(p, { recursive: true }); return p; },
    transcodeKit: tk,
  });
  return { tk, vk };
}
/** 判据要的那个"合并面"（= 原 `createCachePruneKit` 暴露的 5 个名字）。 */
function mergedKit ({ tk, vk }) {
  return {
    sweepTranscodeArtifacts: tk.sweepTranscodeArtifacts,
    sweepCustomFrameTmp: tk.sweepCustomFrameTmp,
    pruneVideoPreviewCache: vk.pruneVideoPreviewCache,
    pruneCacheDirBySize: vk.pruneCacheDirBySize,
    TRANSCODE_CACHE_MAX_BYTES: vk.TRANSCODE_CACHE_MAX_BYTES,
  };
}
/** 真套件（`dirs` 口径见 `liveDeps()`）。 */
const realKit = (dirs) => mergedKit(makeKits(dirs));

// ── 变异体加载器（共享基础设施：LF 归一 / 相对说明符绝对化 / 每条编辑命中自检）──
const { loadMutant: loadSourceMutant, mutantCount } = makeMultiSourceMutants({
  sources: SOURCES, factories: FACTORY_NAMES, outDir: join(ISO, 'mutants'),
});
/** 沿用旧调用点形状：`(dirs) => kit`；把加载器交回的"源键 → 变异体工厂"合成同一个面。 */
async function loadMutant (label, edits) {
  const mods = await loadSourceMutant(label, edits);
  const fn = (dirs) => mergedKit(makeKits(dirs, mods));
  fn.mods = mods;   // C 段的导出面判据要直接看两个**套件**的面（不是合并面）
  return fn;
}
const names = (p) => readdirSync(p);

// ── 判据本体（正向与负对照共用同一段代码；`make` = (dirs) => kit）──────────────

/** ① 三个注入访问器都要真被调用、且三个目录都要真扫到：各自的孤儿清掉、各自的在途写留住。 */
function ownTmpProtected (make, d) {
  const root = join(d, 'cache');
  const cfgRoot = join(d, 'cfg');
  const previewDir = join(root, 'video-previews');
  const sub = [join(root, 'transcodes'), join(cfgRoot, 'ffmpeg'), previewDir];
  for (const p of sub) mkdirSync(p, { recursive: true });
  const own = ['tc_a.mp4.tmp' + PID, 'tc_b.mp4.tmp' + PID + '000123'];
  const foreign = 'tc_c.mp4.tmp' + (PID + 1);
  const orphans = ['tc_d.mp4.prog', 'tc_e.mp4.part0', 'ffmpeg-err-x.log'];
  const keep = ['tc_keep.mp4', 'unrelated.txt'];
  for (const dir of sub) for (const n of [...own, foreign, ...orphans, ...keep]) file(join(dir, n), 8);
  const seen = [];
  // 注入点是活侧套件的三个访问器（`cacheBaseDir` / `configPath` / `videoPreviewCacheDir`）：
  // 真源在 sweep 顶部**各调用一次**把它们落成三个目录 —— 这条不变量与原来"三个目录解析器各一次"同义。
  const providers = {
    cacheBase: () => { seen.push('t'); return root; },
    configPath: () => { seen.push('f'); return join(cfgRoot, 'config.json'); },
    preview: () => { seen.push('p'); return previewDir; },
  };
  make(providers).sweepTranscodeArtifacts();
  const alive = (dir, n) => existsSync(join(dir, n));
  return sub.every((dir) => own.every((n) => alive(dir, n)) && !alive(dir, foreign)
      && orphans.every((n) => !alive(dir, n)) && keep.every((n) => alive(dir, n)))
    && seen.join('') === 'tfp';
}

/** ② 三个注入访问器必须真的被调用（注入点是函数、在 sweep 顶部求值）。 */
function allDirProvidersCalled (make, d) {
  const seen = [];
  const track = (tag) => { seen.push(tag); return d; };
  make({ cacheBase: () => track('t'), configPath: () => track('f'), preview: () => track('p') })
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
  const k = make({ cacheBase: () => missing, configPath: () => join(d, 'nope2', 'config.json'), preview: () => join(d, 'nope3') });
  try {
    k.sweepTranscodeArtifacts();
    k.sweepCustomFrameTmp(join(d, 'nope4'));
    k.pruneVideoPreviewCache();
    k.pruneCacheDirBySize(join(d, 'nope5'), 1, /./);
    return true;
  } catch { return false; }
}

/**
 * ⑫ 导出面：两个真源各暴露**各自被消费的**清扫面，内部常量（年龄门 / 份数上限 / 陈旧阈值）
 * 不得出现在任一导出面里。
 *
 * ⚠️ 判据形状的变化（原：合并 kit "恰好 5 个名字"）：那种"恰好"只对**上游副本那个合并 kit**
 * 成立；真源是**两个套件**，它们的导出面本来就比 5 个大（转码套件还有 ffmpeg 供给链 / 在途任务
 * 账本；预览套件的 prune 面也一样）。这里守的是**同一条不变量** —— "内部常量不外泄 + 被消费的
 * 清扫面在场" —— 只是从"个数相等"改成"两个面各查一遍"：少一个被消费的名字、或多暴露一个内部
 * 常量，都判红。
 */
function kitSurfaceOnlyConsumed (mods = {}) {
  const { tk, vk } = makeKits({}, mods);
  const has = (o, ks) => ks.every((k) => (typeof o[k] === 'function') || (typeof o[k] === 'number'));
  const leaks = (o) => ['CACHE_PRUNE_MIN_AGE_MS', 'VIDEO_PREVIEW_CACHE_MAX', 'CUSTOM_FRAME_TMP_STALE_MS']
    .filter((k) => k in o);
  return has(tk, ['sweepTranscodeArtifacts', 'sweepCustomFrameTmp'])
    && has(vk, ['pruneVideoPreviewCache', 'pruneCacheDirBySize', 'TRANSCODE_CACHE_MAX_BYTES'])
    && leaks(tk).length === 0 && leaks(vk).length === 0;
}

// ═══ A. 孤儿清扫（文件头不变量 1 + 3）════════════════════════════════════════
await (async () => {
  section('A. 孤儿产物清扫：本进程在途写必须留住（含 `.tmp<pid><6 位序号>`），其余孤儿清掉');
  check('A1 三个注入目录各自：`.tmp<pid>` 与 `.tmp<pid>123456` 留住；别的 pid 的 .tmp、.prog/.part/ffmpeg-err 清掉；无关文件不动；每个解析器恰好调用一次',
    ownTmpProtected(realKit, dir('a1')));
  check('A2 三个目录解析器都被调用（注入点是函数、在模块加载期求值）',
    allDirProvidersCalled(realKit, dir('a2')));

  const noSeq = await loadMutant('own-tmp-no-seq', [[
    'transcode',
    "new RegExp('\\\\.tmp' + process.pid + '\\\\d*$')",
    "new RegExp('\\\\.tmp' + process.pid + '$')",
  ]]);
  check('A3 负对照：变异体把 ownTmpRe 收成 `.tmp<pid>$`（丢掉递增序号）⇒ A1 判据判红',
    ownTmpProtected(noSeq, dir('a3')) === false);

  const notCalled = await loadMutant('dir-provider-not-called', [[
    'transcode',
    'const dirs = [transcodeCacheDir(), ffmpegDataDir(), videoPreviewCacheDir()];',
    'const dirs = [transcodeCacheDir, ffmpegDataDir, videoPreviewCacheDir];',
  ]]);
  check('A4 负对照：变异体把目录解析器当路径用（不调用）⇒ A2 判据判红',
    allDirProvidersCalled(notCalled, dir('a4')) === false);

  const d5 = dir('a5');
  file(join(d5, 'not-a-dir'), 8);
  const k5 = realKit({ cacheBase: () => join(d5, 'not-a-dir'), configPath: () => join(d5, 'missing', 'config.json'), preview: () => join(d5, 'missing2') });
  let threw = false;
  try { k5.sweepTranscodeArtifacts(); } catch { threw = true; }
  const d6 = dir('a6');
  const t6 = join(d6, 'transcodes');   // 真源的转码目录 = join(cacheBaseDir(), 'transcodes')
  mkdirSync(t6, { recursive: true });
  file(join(t6, 'tc_y.mp4.prog'), 8);
  realKit({ cacheBase: () => d6, configPath: () => join(d6, 'missing', 'config.json'), preview: () => join(d6, 'missing2') })
    .sweepTranscodeArtifacts();
  check('A5 readdir 抛异常（路径是文件 / 目录不存在）⇒ 不抛，且不阻断其余目录的清扫',
    !threw && !existsSync(join(t6, 'tc_y.mp4.prog')));

  const noPart = await loadMutant('sweep-no-part', [['transcode', ' || /\\.part\\d*$/.test(name)', '']]);
  check('A6 负对照：变异体删掉 `.part\\d*$` 这一支 ⇒ 下载残片不再被清 ⇒ A1 判据判红',
    ownTmpProtected(noPart, dir('a6b')) === false);
})();

// ═══ B. 自定义画面 .tmp（时间口径）═══════════════════════════════════════════
await (async () => {
  section('B. 自定义画面 `.tmp`：只清够旧的（HMR 重扫时在途上传的确定性临时名必须留住）');
  check('B1 够旧的 .tmp 被删；新鲜的 .tmp、非 .tmp、`.tmp.bak` 都留', staleTmpOnly(realKit, dir('b1')));
  check('B2 判据对"够旧"确实敏感（换一个目录再跑一次必须同样成立）', staleTmpOnly(realKit, dir('b2')));

  const noAge = await loadMutant('stale-tmp-no-age', [[
    'transcode', 'if (statSync(abs).mtimeMs > cutoff) continue;', 'if (false) continue;',
  ]]);
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

  const zeroCap = await loadMutant('preview-cap-zero', [[
    'videoPreview', 'const VIDEO_PREVIEW_CACHE_MAX = 512;', 'const VIDEO_PREVIEW_CACHE_MAX = 0;',
  ]]);
  check('C2 负对照：变异体把上限设成 0 ⇒ 513 个全被删 ⇒ C1 判据判红',
    previewCapHolds(zeroCap, dir('c2')) === false);

  const keepOldest = await loadMutant('preview-keep-oldest', [[
    'videoPreview', '.sort((a, b) => b.mtime - a.mtime)', '.sort((a, b) => a.mtime - b.mtime)',
  ]]);
  check('C3 负对照：变异体把排序反过来（保最旧）⇒ 最新一份被删 ⇒ C1 判据判红',
    previewCapHolds(keepOldest, dir('c3')) === false);

  check('C4 两个真源的导出面：被消费的清扫面在场、三个内部常量不外泄', kitSurfaceOnlyConsumed());

  const leaky = await loadMutant('kit-leaks-const', [[
    'videoPreview',
    '    pruneVideoPreviewCache, pruneCacheDirBySize, TRANSCODE_CACHE_MAX_BYTES,\n',
    '    pruneVideoPreviewCache, pruneCacheDirBySize, TRANSCODE_CACHE_MAX_BYTES,\n    CACHE_PRUNE_MIN_AGE_MS,\n',
  ]]);
  check('C5 负对照：变异体把内部常量塞进返回值 ⇒ C4 判据判红',
    kitSurfaceOnlyConsumed(leaky.mods) === false);

  const sizeKeepNewestFirst = await loadMutant('size-sort-reversed', [[
    'videoPreview', 'entries.sort((x, y) => x.mtime - y.mtime);', 'entries.sort((x, y) => y.mtime - x.mtime);',
  ]]);
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

  const noOwn = await loadMutant('size-no-own-tmp', [[
    'videoPreview',
    'if (name.endsWith(ownTmpSuffix) || !matchRe.test(name)) continue;',
    'if (false || !matchRe.test(name)) continue;',
  ]]);
  const d7 = dir('d7');
  // 让本进程 .tmp 成为**最旧**的一份 —— 变异体才会真的轮到它（否则循环先删掉旧的真文件就停了）
  file(join(d7, 'tc_own.mp4.tmp' + PID), 100, OLD + MINUTE);
  file(join(d7, 'tc_a.mp4'), 100, OLD);
  noOwn({}).pruneCacheDirBySize(d7, 50, /^tc_/);
  check('D7 负对照：变异体不保护本进程 .tmp ⇒ 它被删 ⇒ D4 判据判红',
    existsSync(join(d7, 'tc_own.mp4.tmp' + PID)) === false);

  const noAgeGate = await loadMutant('size-no-age-gate', [[
    'videoPreview',
    'if (now - e.mtime < CACHE_PRUNE_MIN_AGE_MS) continue; // 可能是在途任务刚写的',
    'if (false) continue;',
  ]]);
  const d8 = dir('d8');
  file(join(d8, 'young.mp4'), 100);
  file(join(d8, 'young2.mp4'), 100);
  noAgeGate({}).pruneCacheDirBySize(d8, 1, /\.mp4$/);
  check('D8 负对照：变异体拆掉 5 分钟年龄门 ⇒ 年轻文件被删 ⇒ D3 判据判红',
    existsSync(join(d8, 'young.mp4')) === false || existsSync(join(d8, 'young2.mp4')) === false);

  const noNewest = await loadMutant('size-may-delete-newest', [[
    'videoPreview',
    'for (let i = 0; i < entries.length - 1 && total > maxBytes; i++) {',
    'for (let i = 0; i < entries.length && total > maxBytes; i++) {',
  ]]);
  const d9 = dir('d9');
  file(join(d9, 'a.mp4'), 100, OLD + MINUTE); // 最新
  file(join(d9, 'b.mp4'), 100, OLD);          // 最旧
  noNewest({}).pruneCacheDirBySize(d9, 0, /\.mp4$/);
  check('D9 负对照：变异体允许删到"最新的一份" ⇒ D2 判据判红',
    existsSync(join(d9, 'a.mp4')) === false && existsSync(join(d9, 'b.mp4')) === false);

  check('D10 全部失败路径安静：四个清扫函数面对不存在/非目录路径都不抛', failuresAreQuiet(realKit, dir('d10')));

  if (!SYMLINK_OK) {
    skipNotes.push('D11/D12 stat 失败（悬空软链）族：本机 symlinkSync 不可用（EPERM/ENOSYS）⇒ 夹具造不出来');
    console.log('  ⚠ SKIP D11/D12：本机建不出软链（悬空链 ⇒ stat 失败这条路径无法造）—— 不是通过');
  } else {
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

    const noStatCatch = await loadMutant('size-stat-uncaught', [[
      'videoPreview', 'try { st = statSync(p); } catch { continue; }', 'st = statSync(p);',
    ]]);
    check('D12 负对照：变异体不再吞掉 stat 异常 ⇒ 悬空软链让清扫抛出去 ⇒ D11 判据判红',
      (() => {
        const d12 = dir('d12');
        file(join(d12, 'tc_a.mp4'), 100, OLD);
        symlinkSync(join(d12, 'nowhere'), join(d12, 'tc_dangle.mp4'));
        try { noStatCatch({}).pruneCacheDirBySize(d12, 0, /^tc_/); return false; } catch { return true; }
      })());
  }
})();

// ═══ G. 覆盖面地板（写在 if 之外）════════════════════════════════════════════
section('G. 覆盖面地板（防"判据在空域上恒真"）');
check('G1 正向判据数 ≥ 18', passed >= 18, 'passed=' + passed);
check('G2 变异体负对照数 ≥ 6', mutantCount() >= 6, 'mutants=' + mutantCount());
check('G3 本文件直读**两处真源**且两家工厂都在（guard-map 的覆盖认定靠这些路径字面量）',
  readFileSync(SOURCES.transcode, 'utf8').includes('export function createTranscodeKit')
  && readFileSync(SOURCES.videoPreview, 'utf8').includes('export function createVideoPreviewKit')
  && typeof createTranscodeKit === 'function' && typeof createVideoPreviewKit === 'function');

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
