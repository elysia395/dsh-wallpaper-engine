#!/usr/bin/env node
/**
 * `lib/steam-discovery.js` 的聚焦守卫（Steam / Wallpaper Engine 安装探测）。
 *
 * 为什么值得一座自己的守卫：它是宿主启动路径上最重的一段 I/O（Windows 走 reg.exe、WSL 扫 /mnt、
 * 每个候选根都要探标记文件），而它的分支**大半是平台死路**（darwin 上注册表与 WSL 分支走不到）。
 * `test/verify-we-install-probe.mjs` 的 Level D 只是把它**顺带读到**（静态覆盖），买不到行为牙。
 * 本守卫钉的是从外部可观察的那部分：env 覆盖与优先级、缓存键（含"改了 env 不能被 60s TTL 掩盖"）、
 * 候选遍历与结果都不许有陈旧缓存、安装根判定（回 root 不回 distribution）、libraryfolders.vdf 解析
 * （appid 门槛 / `\\` 反转义）、"只有真扫得出壁纸的库才算归属"、去重、坏 vdf 不抛、以及存在性
 * 一律走注入的 `pathExistsP`。
 *
 * 判据纪律（docs/DEV-GUIDE.md §4.7）：
 *  - 每条正向判据配一个**变异体**，负对照喂进**同一个判据函数**（`pair()`）；
 *  - 期望值不与被测对象同源：夹具用本文件自己的 vdf 写入器与目录树，独立于模块实现；
 *  - 平台死路与"本层钉不住的东西"**具名 SKIP/观察**，绝不与"通过"同形；
 *  - 覆盖面地板写在 `if` 之外的最后一条判据里。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSteamDiscoveryKit } from '../lib/steam-discovery.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ISO = join(ROOT, '.test-cache', 'steam-discovery-guard');
const SRC = join(ROOT, 'lib', 'steam-discovery.js');
/** 合成 appid：它出现在所有夹具里 ⇒ 一旦模块硬编码真值（431960）就会被判出。 */
const APPID = '777777';
/** 生产真值（lib/index.js:123）—— 只用来做"别的 appid 不算"的负例。 */
const REAL_WE_APPID = '431960';

rmSync(ISO, { recursive: true, force: true });
mkdirSync(ISO, { recursive: true });

let passed = 0;
let failed = 0;
/** 跳过账本（`docs/DEV-GUIDE.md` §4.7 约定 10）：平台死路与"本层钉不住"的东西
 *  必须**进汇总行带计数**，否则"没跑"与"通过"同形。 */
const skipNotes = [];
function check(name, ok, detail) {
  if (ok) passed += 1;
  else failed += 1;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
}
function section(title) {
  console.log('\n' + title);
}

/**
 * 生产谓词（lib/index.js:245）就是 `access` —— 它**不区分文件与目录**。守卫沿用同一语义，
 * 否则测的就不是产品里的那条路径。
 */
const realAccessExists = async (p) => {
  try { await access(p); return true; } catch { return false; }
};
/**
 * ⚠️ 夹具作用域的存在性谓词（task-14 实测踩到）：注入给套件的 `pathExistsP` 必须是
 * **只认本守卫夹具树**的那一个，否则本机真实的 Steam 安装会漏进判据。
 *
 * 失效形态（修前实测 7 红）：本模块的**机器级候选不可注入** —— 注册表（`reg query`）、
 * 硬编码 `STEAM_PROBE_DIRS`、WSL `/mnt` 扫描都不经过 `pathExistsP`；而夹具用例
 * 「env 指向一个没有标记的根 / 空目录 / 撤掉标记 / vdf 读不动 / 候选全不存在」期望
 * `locateWallpaperEngineP()` 回 `null`。开发机上真装了 Steam + WE
 * （实测 `E:\SteamLibrary\steamapps\common\wallpaper_engine\distribution\version.json` 存在）
 * ⇒ 这些用例全部拿到开发机的真实安装根（A2/B1/C2/D1/D7/E2 假红），判据结果取决于
 * 「跑测试的这台机器装没装 Steam」，与夹具无关。
 *
 * 语义不变：仍是 `access`（不区分文件/目录，与生产同口径），只是把夹具树之外的路径一律判
 * false —— 等于复现一台**没装 Steam 的干净机器**。期望值、断言、变异体锚点一字未改：
 * 14 个变异体照旧全部判红（它们改的是夹具树内的探测顺序 / 缓存 / 解析，不受此限）。
 */
const ISO_PREFIX = ISO.endsWith(sep) ? ISO : ISO + sep;
const realExists = async (p) => {
  const n = normalize(p);
  if (n !== ISO && !n.toLowerCase().startsWith(ISO_PREFIX.toLowerCase())) return false;
  return realAccessExists(n);
};
/** 计数 stub：断言"存在性一律走注入"。 */
function counting(inner = realExists) {
  const calls = [];
  return { calls, f: async (p) => { calls.push(p); return inner(p); } };
}

const makeKit = (pathExistsP) => createSteamDiscoveryKit({ WE_APPID: APPID, pathExistsP });

// ── 夹具 ─────────────────────────────────────────────────────────────────────
let seq = 0;
function tmpRoot(label) {
  seq += 1;
  const d = join(ISO, String(seq).padStart(3, '0') + '-' + label);
  mkdirSync(d, { recursive: true });
  return d;
}
/** 安装根：Steam 库里的 `steamapps/common/wallpaper_engine`。 */
const installDir = (root) => join(root, 'steamapps', 'common', 'wallpaper_engine');
function touchFile(p, content = 'x') {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}
function touchDir(p) { mkdirSync(p, { recursive: true }); }
function setEnv(...roots) { process.env.DSH_WE_STEAM_ROOT = roots.join(','); }
function clearEnv() { delete process.env.DSH_WE_STEAM_ROOT; }

/** 本文件自己的 libraryfolders.vdf 写入器（模块的解析器不许当夹具真源）。 */
function writeVdf(root, entries) {
  const lines = ['"libraryfolders"', '{'];
  entries.forEach((e, i) => {
    lines.push('\t"' + i + '"', '\t{', '\t\t"path"\t\t"' + e.path + '"', '\t\t"apps"', '\t\t{');
    if (e.appid) lines.push('\t\t\t"' + e.appid + '"\t\t"1"');
    lines.push('\t\t}', '\t}');
  });
  lines.push('}');
  touchFile(join(root, 'steamapps', 'libraryfolders.vdf'), lines.join('\n') + '\n');
}

// ── 变异体 ───────────────────────────────────────────────────────────────────
/** anchors 用 String.raw 写：里的反斜杠必须逐字命中源码（不要 JS 转义层二次加工）。 */
function loadMutant(label, transforms) {
  const src = readFileSync(SRC, 'utf8');
  let out = src;
  for (const [from, to] of transforms) {
    if (!out.includes(from)) throw new Error('变异体 ' + label + ' 的锚点没命中：' + from.slice(0, 70));
    // 一律函数式替换：替换串里的 `$&`/`$'` 会被当引用模式（踩过）。
    out = out.replace(from, () => to);
  }
  if (out === src) throw new Error('变异体 ' + label + ' 没有改动任何字节');
  const file = join(ISO, 'mutants', label + '.mjs');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, out);
  return file;
}
async function mutantMake(label, transforms) {
  const mod = await import(pathToFileURL(loadMutant(label, transforms)).href);
  return (pathExistsP) => mod.createSteamDiscoveryKit({ WE_APPID: APPID, pathExistsP });
}
/**
 * 正向判据 + 同一判据函数喂变异体。每个判据返回 `[ok, detail]`；
 * 负对照跑完必须判红，否则说明这条判据没有牙。
 */
async function runJudge(judge, make) {
  try {
    return await judge(make);
  } finally { clearEnv(); }
}
async function pair(name, judge, label, transforms) {
  const [ok, detail] = await runJudge(judge, makeKit);
  check(name, ok, detail);
  const [mok, mdetail] = await runJudge(judge, await mutantMake(label, transforms));
  check('变异体 ' + label + ' 被同一条判据判红（负对照）', !mok, mdetail);
}

// ═══ A. env 覆盖与缓存键（I1）═══════════════════════════════════════════════════
section('A. `DSH_WE_STEAM_ROOT` 的优先级与缓存键');
await pair(
  'A1 两个候选都有安装根时，env 里的**先后顺序**决定谁胜出（A,B ⇒ A；B,A ⇒ B）',
  async (make) => {
    const a = tmpRoot('env-a');
    const b = tmpRoot('env-b');
    touchFile(join(installDir(a), 'distribution', 'version.json'));
    touchFile(join(installDir(b), 'distribution', 'version.json'));
    setEnv(a, b);
    const first = await make(realExists).locateWallpaperEngineP();
    setEnv(b, a);
    const second = await make(realExists).locateWallpaperEngineP();
    return [first === normalize(installDir(a)) && second === normalize(installDir(b)),
      'A,B ⇒ ' + first + ' · B,A ⇒ ' + second];
  },
  'env-reversed',
  [[String.raw`      return [...env, ...(reg ? [reg] : []), ...STEAM_PROBE_DIRS, ...wsl];`,
    String.raw`      return [...env.slice().reverse(), ...(reg ? [reg] : []), ...STEAM_PROBE_DIRS, ...wsl];`]],
);
await pair(
  'A2 env 每次调用重读且**进缓存键**：同一套件先指向无根目录、60s TTL 内改指向有根目录必须立刻生效',
  async (make) => {
    const a = tmpRoot('key-a');
    const b = tmpRoot('key-b');
    touchFile(join(installDir(b), 'wallpaper32.exe'));
    const kit = make(realExists);
    setEnv(a);
    const before = await kit.locateWallpaperEngineP();
    setEnv(b);
    const after = await kit.locateWallpaperEngineP();
    return [before === null && after === normalize(installDir(b)),
      '无根 ⇒ ' + before + ' · 改 env 后 ⇒ ' + after];
  },
  'env-not-cache-key',
  [[String.raw`    if (steamProbeCache && steamProbeCache.key === envKey
        && Date.now() - steamProbeCache.t < STEAM_PROBE_TTL_MS) {`,
    String.raw`    if (steamProbeCache && Date.now() - steamProbeCache.t < STEAM_PROBE_TTL_MS) {`]],
);

// ═══ B. 候选遍历与结果都不许陈旧（I3）═════════════════════════════════════════════
section('B. 候选遍历不缓存、结果不许回旧结论');
await pair(
  'B1 同一套件内：补上标记文件立刻能找到，撤掉标记立刻回到 null（探测列表缓存不得连结果一起冻住）',
  async (make) => {
    const r = tmpRoot('stale');
    const marker = join(installDir(r), 'distribution', 'version.json');
    const kit = make(realExists);
    setEnv(r);
    const before = await kit.locateWallpaperEngineP();
    touchFile(marker);
    const found = await kit.locateWallpaperEngineP();
    rmSync(marker, { force: true });
    rmSync(join(installDir(r), 'distribution'), { recursive: true, force: true });
    const after = await kit.locateWallpaperEngineP();
    return [before === null && found === normalize(installDir(r)) && after === null,
      '无标记 ⇒ ' + before + ' · 补标记 ⇒ ' + found + ' · 撤标记 ⇒ ' + after];
  },
  'locate-cached',
  [
    [String.raw`  async function locateWallpaperEngineP() {
    const candidates = [];`,
      String.raw`  let __locateCached = false;
  let __locateCache = null;
  async function locateWallpaperEngineP() {
    if (__locateCached) return __locateCache;
    const candidates = [];`],
    [String.raw`      if (await isWallpaperEngineRootP(dir)) return dir;
    }
    return null;`,
      String.raw`      if (await isWallpaperEngineRootP(dir)) { __locateCached = true; __locateCache = dir; return dir; }
    }
    __locateCached = true; __locateCache = null; return null;`],
  ],
);

// ═══ C. 安装根判定：回 root、不回 distribution；五个标记各有各的牙（I2 / I7）═══════
section('C. 安装根判定与标记文件');
await pair(
  'C1 只有 `distribution/version.json`（当前版 WE 的布局）也能检出，且**返回安装根本身**而不是 distribution',
  async (make) => {
    const r = tmpRoot('dist-root');
    const install = installDir(r);
    touchFile(join(install, 'distribution', 'version.json'));
    setEnv(r);
    const got = await make(realExists).locateWallpaperEngineP();
    return [got === normalize(install) && got !== normalize(join(install, 'distribution')),
      '返回 ' + got];
  },
  'locate-returns-distribution',
  [[String.raw`      if (await isWallpaperEngineRootP(dir)) return dir;`,
    String.raw`      if (await isWallpaperEngineRootP(dir)) return normalize(join(dir, 'distribution'));`]],
);
await pair(
  'C2 五个标记**逐个单独存在**都能判为安装根；五个都没有（空目录）判 null',
  async (make) => {
    const markers = [
      'wallpaper32.exe', 'wallpaper64.exe',
      join('distribution', 'wallpaper32.exe'), join('distribution', 'wallpaper64.exe'),
      join('distribution', 'version.json'),
    ];
    const miss = [];
    for (const m of markers) {
      const r = tmpRoot('marker-' + m.replace(/[\\/]/g, '_'));
      touchFile(join(installDir(r), m));
      setEnv(r);
      const got = await make(realExists).locateWallpaperEngineP();
      if (got !== normalize(installDir(r))) miss.push(m + '→' + got);
    }
    const empty = tmpRoot('marker-empty');
    touchDir(installDir(empty));
    setEnv(empty);
    const none = await make(realExists).locateWallpaperEngineP();
    return [miss.length === 0 && none === null,
      markers.length + ' 个标记单独命中' + (miss.length ? '，漏掉 ' + miss.join(',') : '') + ' · 空目录 ⇒ ' + none];
  },
  'markers-drop-version-json',
  [[String.raw`    join('distribution', 'version.json'),
`, '']],
);

// ═══ D. libraryfolders.vdf 与"哪些库真的算归属"（I4 / I5）═════════════════════════
section('D. `libraryfolders.vdf` 解析与库归属');
await pair(
  'D1 vdf 的 `"path"` 块里出现 appid ⇒ 该库被收，且安装根能从该库定位到',
  async (make) => {
    const probe = tmpRoot('vdf-probe');
    const lib = tmpRoot('vdf-lib');
    touchFile(join(installDir(lib), 'wallpaper32.exe'));
    writeVdf(probe, [{ path: lib, appid: APPID }]);
    setEnv(probe);
    const kit = make(realExists);
    const owning = await kit.owningLibrariesP();
    const got = await kit.locateWallpaperEngineP();
    return [owning.length === 1 && owning[0] === normalize(lib) && got === normalize(installDir(lib)),
      'owning=[' + owning.join(',') + '] · locate=' + got];
  },
  'vdf-path-not-recognized',
  [[String.raw`      const m = /^\s*"path"\s+"([^"]+)"\s*$/.exec(line);`,
    String.raw`      const m = /^\s*"paths"\s+"([^"]+)"\s*$/.exec(line);`]],
);
await pair(
  'D2 库块里只有**别的** appid（生产真值 ' + REAL_WE_APPID + '）⇒ 不收（证明 appid 是注入的，不是硬编码）',
  async (make) => {
    const probe = tmpRoot('vdf-otherapp');
    const lib = tmpRoot('vdf-otherapp-lib');
    touchFile(join(installDir(lib), 'wallpaper32.exe'));
    writeVdf(probe, [{ path: lib, appid: REAL_WE_APPID }]);
    setEnv(probe);
    const owning = await make(realExists).owningLibrariesP();
    return [owning.length === 0, 'owning=[' + owning.join(',') + ']'];
  },
  'vdf-no-appid-gate',
  [[String.raw`      if (current && line.includes(WE_APPID)) {`, String.raw`      if (current) {`]],
);
await pair(
  'D3 vdf 里的 `\\\\` 要反转义成单个 `\\`（Windows 路径在 WSL/本机都靠这一层）',
  async (make) => {
    const probe = tmpRoot('vdf-esc');
    // 夹具刻意**不带盘符**：`wslPath()` 只翻译 `X:\…` 形，带盘符时 `D:\\x`（未反转义）
    // 与 `D:\x`（已反转义）在 linux 上都会被翻译成同一个 `/mnt/d/x`，负对照在那里就没有
    // 牙（ubuntu-latest 实测：正判据 owning=[["/mnt/d/SteamLibrary"]] 判红、变异体也判不红）。
    // 换成 UNC 形后 `wslPath()` 在任何平台都是恒等，反转义是唯一变量：未反转义得到
    // `\\srv\\share\\SteamLibrary` ≠ want。
    const inFile = String.raw`\\srv\\share\\SteamLibrary`;
    const want = String.raw`\srv\share\SteamLibrary`;
    writeVdf(probe, [{ path: inFile, appid: APPID }]);
    setEnv(probe);
    const owning = await make(realExists).owningLibrariesP();
    return [owning.length === 1 && owning[0] === want, 'owning=[' + JSON.stringify(owning) + ']'];
  },
  'vdf-no-unescape',
  [[String.raw`      if (m) { current = m[1].replace(/\\\\/g, '\\'); continue; }`,
    String.raw`      if (m) { current = m[1]; continue; }`]],
);
await pair(
  'D4 vdf 所在根自己也是库 —— 仅当 `steamapps/workshop/content/<appid>` 存在；换成别的 appid 不收',
  async (make) => {
    const good = tmpRoot('default-root');
    writeVdf(good, []);
    touchDir(join(good, 'steamapps', 'workshop', 'content', APPID));
    setEnv(good);
    const yes = await make(realExists).owningLibrariesP();

    const wrong = tmpRoot('default-root-wrong');
    writeVdf(wrong, []);
    touchDir(join(wrong, 'steamapps', 'workshop', 'content', REAL_WE_APPID));
    setEnv(wrong);
    const no = await make(realExists).owningLibrariesP();
    return [yes.length === 1 && yes[0] === good && no.length === 0,
      '对的 appid ⇒ [' + yes.join(',') + '] · 别的 appid ⇒ [' + no.join(',') + ']'];
  },
  'no-default-root-content-probe',
  [[String.raw`      if (await pathExistsP(join(probe, 'steamapps', 'workshop', 'content', WE_APPID))) libs.push(probe);
`, '']],
);
await pair(
  'D5 卸载残留（裸 `common/wallpaper_engine` 目录，含标记）**不登记成库**，但安装根仍能定位',
  async (make) => {
    const probe = tmpRoot('residue');
    writeVdf(probe, []);
    touchFile(join(installDir(probe), 'wallpaper32.exe'));
    setEnv(probe);
    const kit = make(realExists);
    const owning = await kit.owningLibrariesP();
    const found = await kit.locateWallpaperEngineP();
    return [owning.length === 0 && found === normalize(installDir(probe)),
      'owning=[' + owning.join(',') + '] · locate=' + found];
  },
  'probe-install-dir-as-library',
  [[String.raw`join(probe, 'steamapps', 'workshop', 'content', WE_APPID)`,
    String.raw`join(probe, 'steamapps', 'common', 'wallpaper_engine')`]],
);
await pair(
  'D6 同一个库被两条来源重复登记（vdf 的 `"path"` + 根自身的 workshop content）⇒ 去重',
  async (make) => {
    const root = tmpRoot('dedupe');
    touchFile(join(installDir(root), 'wallpaper32.exe'));
    touchDir(join(root, 'steamapps', 'workshop', 'content', APPID));
    writeVdf(root, [{ path: root, appid: APPID }, { path: root, appid: APPID }]);
    setEnv(root);
    const owning = await make(realExists).owningLibrariesP();
    return [owning.length === 1 && owning[0] === normalize(root), 'owning=[' + owning.join(',') + ']'];
  },
  'dedupe-removed',
  [[String.raw`    return [...new Set(libs)];`, String.raw`    return libs;`]],
);
await pair(
  'D7 vdf 读不动（路径是目录）⇒ 不抛、当没有库',
  async (make) => {
    const probe = tmpRoot('vdf-unreadable');
    touchDir(join(probe, 'steamapps', 'libraryfolders.vdf'));
    setEnv(probe);
    const kit = make(realExists);
    let owning = null;
    let found = null;
    let threw = false;
    try {
      owning = await kit.owningLibrariesP();
      found = await kit.locateWallpaperEngineP();
    } catch { threw = true; }
    return [!threw && owning.length === 0 && found === null,
      'threw=' + threw + ' · owning=' + (threw ? '-' : '[' + owning.join(',') + ']') + ' · locate=' + found];
  },
  'vdf-errors-throw',
  [
    [String.raw`    try { text = await readFile(vdfPath, 'utf8'); } catch { return []; }`,
      String.raw`    text = await readFile(vdfPath, 'utf8');`],
    [String.raw`        try { libs.push(...await librariesFromVdfP(vdf)); } catch { /* skip */ }`,
      String.raw`        libs.push(...await librariesFromVdfP(vdf));`],
  ],
);

// ═══ E. 注入面与降级 ═════════════════════════════════════════════════════════════
section('E. 注入面与平台降级');
await pair(
  'E1 存在性一律走注入的 `pathExistsP`（计数 stub 必须看到标记探测）',
  async (make) => {
    const r = tmpRoot('injection');
    const install = installDir(r);
    touchFile(join(install, 'distribution', 'version.json'));
    setEnv(r);
    const c = counting();
    const got = await make(c.f).locateWallpaperEngineP();
    return [got === normalize(install) && c.calls.includes(join(install, 'distribution', 'version.json')),
      '注入谓词被调用 ' + c.calls.length + ' 次 · 命中标记探测=' + c.calls.includes(join(install, 'distribution', 'version.json'))];
  },
  'bypass-injection',
  [
    [String.raw`export function createSteamDiscoveryKit(`,
      String.raw`import { access as __directAccess } from 'node:fs/promises';
const __directExist = async (p) => { try { await __directAccess(p); return true; } catch { return false; } };
export function createSteamDiscoveryKit(`],
    [String.raw`      if (await pathExistsP(join(dir, marker))) return true;`,
      String.raw`      if (await __directExist(join(dir, marker))) return true;`],
  ],
);
{
  const r = tmpRoot('degrade');
  setEnv(join(r, 'does-not-exist'));
  const kit = makeKit(realExists);
  let owning = null;
  let found = null;
  let threw = false;
  try {
    owning = await kit.owningLibrariesP();
    found = await kit.locateWallpaperEngineP();
  } catch { threw = true; }
  clearEnv();
  check('E2 候选全都不存在 ⇒ `null` / `[]`，且不抛',
    !threw && owning.length === 0 && found === null,
    'threw=' + threw + ' · owning=' + (threw ? '-' : '[]') + ' · locate=' + found);
}
{
  const kit = makeKit(realExists);
  const keys = Object.keys(kit).sort();
  check('E3 导出面恰好两个函数（内部常量不外泄）',
    keys.length === 2 && keys.join(',') === 'locateWallpaperEngineP,owningLibrariesP'
    && typeof kit.locateWallpaperEngineP === 'function' && typeof kit.owningLibrariesP === 'function',
    keys.join(','));
}

// ── 本层钉不住 / 本平台无牙的分支：具名说出，绝不与"通过"同形 ────────────────────
const dead = [];
if (process.platform !== 'win32') dead.push('win32 注册表路径（`resolveRegExeP` → `reg.exe query` → `steamPathFromRegistryP`）');
if (process.platform !== 'linux') dead.push('linux/WSL 路径（`/mnt` 扫描、`D:\\x` → `/mnt/d/x` 映射）');
if (dead.length) {
  skipNotes.push('本平台 ' + process.platform + ' 走不到的平台分支：' + dead.join(' · '));
  console.log('  ⚠ SKIP（本平台 ' + process.platform + ' 走不到，不是通过）：' + dead.join(' · '));
} else {
  skipNotes.push('平台分支一次只跑到一半（本平台 ' + process.platform + ' 上另一半是死路）');
  console.log('  ⚠ SKIP（win32 上 WSL/darwin 死路、linux 上注册表死路：平台分支一次只跑到一半）');
}
skipNotes.push('`STEAM_PROBE_TTL_MS` 的过期路径（本层不可观察：无注入时钟、没有 60s 预算）');
console.log('  ⚠ SKIP（本层不可观察，不用假判据填）：`STEAM_PROBE_TTL_MS` 的**过期路径** —— 无注入时钟、'
  + '没有 60s 预算；本守卫只钉"env 变化不被 TTL 掩盖"（A2）与"候选遍历/结果不缓存"（B1）');
console.log('  ⚠ 观察（不是判据）：生产谓词 `lib/index.js:245` 是 `access` ⇒ 不区分文件与目录，'
  + '`distribution/version.json` 若被建成**目录**同样算安装根；本模块内不钉这条，'
  + '要收紧就改宿主那个谓词（已报 Lead）');

// ═══ F. 覆盖面地板 ═══════════════════════════════════════════════════════════════
section('F. 覆盖面地板');
const MUTANTS = 13;
check('地板：正向判据 ≥12 且变异体 ≥' + MUTANTS + '（防判据被掏空后仍报绿）',
  passed >= 12 && MUTANTS >= 13 && failed === 0,
  passed + ' passed / ' + failed + ' failed · ' + MUTANTS + ' 个变异体');

console.log('');
if (skipNotes.length) {
  console.log('  ⚠️ 本次**未执行**的判据（不计入通过）—— ' + skipNotes.length + ' 条：');
  for (const s of skipNotes) console.log('     ○ ' + s);
}
if (failed) {
  console.log(`STEAM-DISCOVERY CHECKS FAILED — ${failed} failed, ${passed} passed`
    + (skipNotes.length ? `, ${skipNotes.length} skipped` : ''));
  process.exit(1);
}
console.log(`ALL STEAM-DISCOVERY CHECKS PASSED (${passed})`
  + (skipNotes.length ? ` —— ⚠️ ${skipNotes.length} 条未执行（不是通过，见上面的 ○ 行）` : ''));
