#!/usr/bin/env node
/**
 * verify-wallpaper-scan.mjs —— `lib/wallpaper-scan.js` 的聚焦判据。
 *
 * 被测对象：`createWallpaperScanKit({ WE_APPID, pathExistsP, isFileP, isDirectoryP, extOf, schemeToCss })` ——
 * 「目录树 → 清单条目」的唯一推导链（扫描根 → 签名 → project.json → 条目 → WE 播放列表）。
 * ⚠️ 后两个是**本分支的注入项**（上游把这两个 helper 定义在扫描族内部；本分支的单一真源分别是
 * `lib/fs-paths.js` 与 `lib/kernel/host-kernel.js`）—— 判据面据此注入，见 `realDeps()` 与 D8。
 *
 * 为什么值得独立守卫：这条链错了，症状不是报错而是**静默少东西** ——
 *   · 扫描根少算一个 ⇒ 那一根里新增的壁纸永远不进库（签名一直"没变"，见 #158）；
 *   · `project.json` 声明 `scene.json` 却只发 `scene.pkg` ⇒ 帧路由指向不存在的文件；
 *   · 播放列表去重失效 ⇒ 同一份列表出现两次。
 * 全都是"用户会撞上但不会看到异常"的形态 ⇒ 硬档。
 *
 * 判据设计（DEV-GUIDE §4.7）：
 *   · 每条正向判据都有一条**同一段判据代码**跑出来的变异体负对照（变异体由源码现场改写，
 *     落在 `.test-cache/` 下，不动 `lib/`）。变异体必须被判红，否则判据是恒真的。
 *   · 夹具在 `.test-cache/wallpaper-scan-guard/` 里现造，不依赖仓库 fixture。
 *   · 覆盖面地板写在 `if` 之外（G 段）。
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, utimesSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createWallpaperScanKit } from '../lib/wallpaper-scan.js';
import { extOf } from '../lib/fs-paths.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ISO = join(ROOT, '.test-cache', 'wallpaper-scan-guard');
const SRC = join(ROOT, 'lib', 'wallpaper-scan.js');
/** `extOf` 的真源（本分支把它做成注入项 ⇒ 它的变异体改这里，见 loadExtOfMutant）。 */
const EXTOF_SRC = join(ROOT, 'lib', 'fs-paths.js');
const APPID = '431960';
const CONTENT = ['steamapps', 'workshop', 'content', APPID].join('/');

let passed = 0; let failed = 0;
function check (name, ok, detail) {
  if (ok) passed++;
  else failed++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
}
function section (t) { console.log('\n' + t); }

rmSync(ISO, { recursive: true, force: true });
mkdirSync(ISO, { recursive: true });

// ── 真磁盘替身（注入点）+ 夹具 ──────────────────────────────────────────────
/**
 * 注入点用**真实** fs 语义：被测对象自己不做任何路径语义判断，这正是注入的意义。
 *
 * ⚠️ 本分支把 `extOf` / `schemeToCss` 也做成了注入项（见 `lib/wallpaper-scan.js` 文件头的差异说明）：
 *   · `extOf` 注入**真源** `lib/fs-paths.js` 的那份（E1 的"只认真后缀"判据因此钉的是真源行为）；
 *   · `schemeToCss` 的**真源**住 `lib/kernel/host-kernel.js`（未导出），这里按"期望值自行重推"
 *     的纪律给一份同语义实现 —— 它只负责把 `schemecolor.value` 转成 CSS 色，C6/C7 判的是
 *     "条目把作者配色带出来了、无效值不编色"这条**通过性**语义；那条转换的端到端真源
 *     （目录形态上传 → inventory 的 `schemeColor`）由 `test/verify-scene-live.mjs` 的金值
 *     `rgb(29, 56, 84)` 覆盖。
 */
const schemeToCssForFixture = (v) => {
  if (typeof v !== 'string') return null;
  const parts = v.trim().split(/\s+/).map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some((x) => !Number.isFinite(x))) return null;
  const c = parts.slice(0, 3).map((x) => Math.max(0, Math.min(255, Math.round(x * 255))));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
};
const realDeps = () => ({
  pathExistsP: (p) => existsSync(p),
  isFileP: (p) => { try { return statSync(p).isFile(); } catch { return false; } },
  isDirectoryP: (p) => { try { return statSync(p).isDirectory(); } catch { return false; } },
  extOf,
  schemeToCss: schemeToCssForFixture,
});
const makeKit = (deps = {}) => createWallpaperScanKit({ WE_APPID: APPID, ...realDeps(), ...deps });

let envSeq = 0;
/** 一个环境 = 一份 WE 安装目录 + 两个 Steam 库（各自带 workshop content 根）。 */
function makeEnv (label) {
  const base = join(ISO, (envSeq++) + '-' + label);
  const install = join(base, 'install');
  const libA = join(base, 'libA');
  const libB = join(base, 'libB');
  mkdirSync(join(install, 'projects', 'defaultprojects'), { recursive: true });
  mkdirSync(join(install, 'projects', 'myprojects'), { recursive: true });
  mkdirSync(join(libA, CONTENT), { recursive: true });
  mkdirSync(join(libB, CONTENT), { recursive: true });
  return { base, install, libA, libB, contentA: join(libA, CONTENT), contentB: join(libB, CONTENT) };
}
/** `project.json` 写盘；`obj === null` ⇒ 只建目录不写 project.json。 */
function project (dir, obj, files = {}) {
  mkdirSync(dir, { recursive: true });
  if (obj !== null) writeFileSync(join(dir, 'project.json'), JSON.stringify(obj));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}
/** 目录 mtime 只在新条目进出时变；要确定性就显式推 —— 被测对象正是读它算签名。 */
function bump (p) { const t = new Date(Date.now() + 2000); utimesSync(p, t, t); }

// ── 变异体加载器（源码文本改写 ⇒ `.test-cache/` 里 import）───────────────────
// 本模块只 import node: 内置模块（无相对 import）⇒ 变异体可直接落在 tmp 目录里跑。
let mutantSeq = 0;
async function loadMutant (label, transform) {
  const src = readFileSync(SRC, 'utf8');
  const out = transform(src);
  if (out === src) throw new Error('变异体没改到源码（判据会失真）: ' + label);
  const dir = join(ISO, 'mutants');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, (mutantSeq++) + '-' + label + '.mjs');
  writeFileSync(file, out);
  return (await import(pathToFileURL(file).href)).createWallpaperScanKit;
}

/**
 * ⚠️ `extOf` 在本分支是**注入项**（真源 `lib/fs-paths.js`）⇒ 它的变异体要改真源、再把变异体
 * 作为注入项喂进扫描族 —— 这样 D8 钉的仍是"真后缀"这条语义，只是落点从扫描族内部挪到真源。
 * 同一份源码只 import node: 内建 ⇒ 变异体可直接落 tmp 跑。
 */
let extMutantSeq = 0;
async function loadExtOfMutant (label, transform) {
  const src = readFileSync(EXTOF_SRC, 'utf8');
  const out = transform(src);
  if (out === src) throw new Error('extOf 变异体没改到源码（判据会失真）: ' + label);
  const dir = join(ISO, 'mutants');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'ext-' + (extMutantSeq++) + '-' + label + '.mjs');
  writeFileSync(file, out);
  return (await import(pathToFileURL(file).href)).extOf;
}

// ── 判据本体（正/负对照共用同一段代码）──────────────────────────────────────
/** ① 每个库根都得算进签名 —— 新增一个 workshop 项目必须改签名，否则它永远不进库（#158）。 */
async function everyLibraryRootCounted (make, env) {
  const kit = make();
  const before = await kit.scanSignatureP(env.install, [env.libA, env.libB]);
  project(join(env.contentB, '99001'), { file: 'scene.json', title: 'Brand New' });
  bump(env.contentB);
  const after = await kit.scanSignatureP(env.install, [env.libA, env.libB]);
  return before !== after;
}

/** ② 每个候选根都被探到、且**每个只探一次**（多探一次 = 每请求多一组 stat；漏探 = 根不进签名）。 */
async function everyRootProbedOnce (make, env, probes) {
  const kit = make();
  await kit.scanSignatureP(env.install, [env.libA, env.libB]);
  const roots = [
    join(env.install, 'projects', 'defaultprojects'),
    join(env.install, 'projects', 'myprojects'),
    env.contentA,
    env.contentB,
  ];
  return roots.every((r) => probes.filter((x) => x === r).length === 1)
    && roots.every((r) => probes.includes(r));
}

/** ③ `extOf` 只认真正的后缀：前导点（`.bashrc`）与"路径里有点、末尾无点"都不算后缀。 */
function extOnlyForRealSuffixes (make) {
  const kit = make();
  return kit.extOf('a/b/MOVIE.MP4') === 'mp4'
    && kit.extOf('.bashrc') === ''
    && kit.extOf('a.b/c') === ''
    && kit.extOf('') === '';
}

/** ④ 场景主文件解析：**恰好一个** *.pkg 才敢认它；多个候选等于没候选（不许猜）。 */
async function singlePkgOnly (make, env) {
  const kit = make();
  const dir = join(env.base, 'multi-pkg');
  project(dir, { file: 'nope.json', type: 'scene' }, { 'a.pkg': 'a', 'b.pkg': 'b' });
  return await kit.resolveSceneMainFileP(dir, 'nope.json') === null;
}

/** ⑤ `project.json` 的 type 走白名单：认不得就落 `scene`，不许把未知类型原样透传。 */
async function unknownTypeFallsBack (make, env) {
  const kit = make();
  const dir = project(join(env.base, 'odd-type'), { file: 'x.pkg', type: 'QUAKE' });
  const p = await kit.readProjectP(dir);
  return p !== null && p.type === 'scene';
}

/** ⑥ 重复 id（两个根里同名项目目录）⇒ 只留一个，且**先扫到的那个赢**。 */
async function firstWinsOnDuplicateId (make, env) {
  const kit = make();
  project(join(env.contentA, 'dup'), { file: 'scene.pkg', title: 'First Dup' }, { 'scene.pkg': 'x' });
  project(join(env.contentB, 'dup'), { file: 'scene.pkg', title: 'Second Dup' }, { 'scene.pkg': 'x' });
  const got = (await kit.enumerateWallpapersAsync(env.install, [env.libA, env.libB])).filter((p) => p.id === 'dup');
  return got.length === 1 && got[0].title === 'First Dup';
}

/** ⑦ 播放列表按「名字 + 条目」签名去重：同一份列表在多个 profile 里重复只出现一次。 */
async function playlistDedupe (make, env) {
  const kit = make();
  const row = { name: 'Same', items: ['C:\\wp\\a', 'C:\\wp\\b'] };
  writeFileSync(join(env.install, 'config.json'), JSON.stringify({
    p1: { general: { playlists: [row] } },
    p2: { general: { playlists: [{ ...row }] } },
  }));
  return (await kit.readPlaylistsP(env.install)).length === 1;
}

/** ④ 安装目录下的两个根（defaultprojects / myprojects）都要**既进签名又进枚举** ——
 *  漏一个 = 那一类项目整族消失，且签名也不再随它变（#158 的第二种形态）。 */
async function installRootsServed (make, env) {
  const kit = make();
  const before = await kit.scanSignatureP(env.install, []);
  const beforeCount = (await kit.enumerateWallpapersAsync(env.install, [])).length;
  project(join(env.install, 'projects', 'myprojects', 'mp-new'),
    { file: 'scene.json', title: 'New Mine' }, { 'scene.json': '{}' });
  bump(join(env.install, 'projects', 'myprojects'));
  const after = await kit.scanSignatureP(env.install, []);
  const afterList = await kit.enumerateWallpapersAsync(env.install, []);
  return before !== after
    && afterList.length === beforeCount + 1
    && afterList.some((p) => p.id === 'mp-new');
}

// ═══ A. 扫描根与签名（#158）═══════════════════════════════════════════════════
await (async () => {
  section('A. 扫描根是唯一推导：每个根都进签名（少算一根 ⇒ 那一根的新壁纸永远不进库）');
  const env = makeEnv('a');
  const kit = makeKit();
  const sig = await kit.scanSignatureP(env.install, [env.libA, env.libB]);
  check('A1 签名是 40 位 sha1 且同输入可复现（不是随机/带时间戳）',
    /^[0-9a-f]{40}$/.test(sig) && sig === await kit.scanSignatureP(env.install, [env.libA, env.libB]), sig);

  check('A2 第二个库里新增一个 workshop 项目 ⇒ 签名必须变（#158 的核心症状）',
    await everyLibraryRootCounted(makeKit, env));

  const envProbe = makeEnv('a-probe');
  const probes = [];
  const countingKit = () => {
    const deps = realDeps();
    return createWallpaperScanKit({ WE_APPID: APPID,
      pathExistsP: (p) => { probes.push(p); return deps.pathExistsP(p); },
      isFileP: deps.isFileP, isDirectoryP: deps.isDirectoryP,
      extOf: deps.extOf, schemeToCss: deps.schemeToCss });
  };
  check('A3 四个候选根（defaultprojects / myprojects / 两个库）都被探到，且每个恰好一次',
    await everyRootProbedOnce(countingKit, envProbe, probes), 'probes=' + JSON.stringify(probes));

  const noWs = await loadMutant('no-workshop-root', (s) => s.replace(
    'if (await pathExistsP(ws)) roots.push(ws);', 'if (await pathExistsP(ws)) { /* mutant */ }'));
  const env2 = makeEnv('a-neg');
  check('A4 负对照：变异体不算 workshop 根 ⇒ A2 那条判据判红',
    await everyLibraryRootCounted(() => noWs({ WE_APPID: APPID, ...realDeps() }), env2) === false);

  const twice = await loadMutant('probe-twice', (s) => s.replace(
    'if (await pathExistsP(ws)) roots.push(ws);', 'if (await pathExistsP(ws) && await pathExistsP(ws)) roots.push(ws);'));
  const env3 = makeEnv('a-neg2');
  const probes3 = [];
  const twiceDeps = () => {
    const deps = realDeps();
    return { WE_APPID: APPID,
      pathExistsP: (p) => { probes3.push(p); return deps.pathExistsP(p); },
      isFileP: deps.isFileP, isDirectoryP: deps.isDirectoryP,
      extOf: deps.extOf, schemeToCss: deps.schemeToCss };
  };
  check('A5 负对照：变异体把一个根探两次 ⇒ "每个只探一次"判红',
    await everyRootProbedOnce(() => twice(twiceDeps()), env3, probes3) === false);

  const envMine = makeEnv('a-mine');
  check('A8 myprojects 根里新增项目 ⇒ 签名变**且**枚举多一条（签名与枚举共用同一套根推导）',
    await installRootsServed(makeKit, envMine));

  const dropMy = await loadMutant('drop-myprojects', (s) => s.replace(
    "for (const sub of ['defaultprojects', 'myprojects'])", "for (const sub of ['defaultprojects'])"));
  const envMineNeg = makeEnv('a-mine-neg');
  check('A9 负对照：变异体漏掉 myprojects 根 ⇒ A8 判据判红（签名与枚举同时漏）',
    await installRootsServed(() => dropMy({ WE_APPID: APPID, ...realDeps() }), envMineNeg) === false);

  // 变异体"签名不 stat 根"：把 stat 结果换成常量 ⇒ 每个根的 stamp 恒为 0:0，根内新增不再改签名。
  const noStat = await loadMutant('signature-no-stat', (s) => s.replace(
    'const st = await stat(root);', 'const st = { mtimeMs: 0, size: 0 };'));
  const envNoStat = makeEnv('a-nostat');
  check('A10 负对照：变异体签名不 stat 根目录 ⇒ 根内新增不再改签名 ⇒ A2/A8 判据判红',
    await everyLibraryRootCounted(() => noStat({ WE_APPID: APPID, ...realDeps() }), envNoStat) === false);

  check('A6 空输入不崩：installDir 为空字符串 / 没有库 ⇒ 仍给出稳定签名',
    await kit.scanSignatureP('', []) === await kit.scanSignatureP(null, []));
  check('A7 覆盖面：安装目录的 defaultprojects / myprojects 两个根都参与签名（改其一会变）',
    await (async () => {
      const before = await kit.scanSignatureP(env.install, [env.libA, env.libB]);
      project(join(env.install, 'projects', 'defaultprojects', 'dp-new'), { file: 'scene.json' });
      bump(join(env.install, 'projects', 'defaultprojects'));
      const after = await kit.scanSignatureP(env.install, [env.libA, env.libB]);
      return before !== after;
    })());
})();

// ═══ B. 枚举：project.json → 条目 ════════════════════════════════════════════
await (async () => {
  section('B. 枚举：标题排序、scene 容器解析、去重、分块边界');
  const env = makeEnv('b');
  const kit = makeKit();
  project(join(env.install, 'projects', 'defaultprojects', 'dp1'),
    { file: 'scene.pkg', title: 'Gamma' }, { 'scene.pkg': 'pkg' });
  project(join(env.install, 'projects', 'defaultprojects', 'dp2'),
    { file: 'scene.json', title: 'Alpha' }, { 'scene.json': '{}' });
  project(join(env.install, 'projects', 'myprojects', 'mp1'),
    { file: 'page.html', type: 'web', title: 'Beta' }, { 'page.html': '<html>' });
  // 声明 scene.json、实际只发 scene.pkg —— WE 上极常见，必须解析到**真正存在**的那个。
  project(join(env.contentA, '111'), { file: 'scene.json', title: 'Packed Only' }, { 'scene.pkg': 'pkg' });
  project(join(env.contentA, '222'), { file: 'movie.mp4', type: 'VIDEO', title: 'Clip' }, { 'movie.mp4': 'v' });

  const got = await kit.enumerateWallpapersAsync(env.install, [env.libA, env.libB]);
  check('B1 五个项目都进清单，且按 title 排序（顺序稳定）',
    got.map((p) => p.title).join('|') === 'Alpha|Beta|Clip|Gamma|Packed Only',
    got.map((p) => p.title).join('|'));
  const byId = new Map(got.map((p) => [p.id, p]));
  check('B2 声明 scene.pkg 且存在 ⇒ fileAbs 指向它（信任声明）',
    (byId.get('dp1').fileAbs || '').endsWith('scene.pkg'));
  check('B3 声明 scene.json 且存在 ⇒ fileAbs 指向 scene.json',
    (byId.get('dp2').fileAbs || '').endsWith('scene.json'));
  check('B4 声明 scene.json 但只发了 scene.pkg ⇒ 解析到真实存在的 scene.pkg（不是指向不存在的文件）',
    (byId.get('111').fileAbs || '').endsWith('scene.pkg'), byId.get('111').fileAbs);
  check('B5 非 scene 类型不走进 scene 容器解析（web 直接用声明文件）',
    (byId.get('mp1').fileAbs || '').endsWith('page.html') && byId.get('mp1').type === 'web');
  check('B6 type 大小写归一（"VIDEO" ⇒ video，且 fileAbs 用声明文件）',
    byId.get('222').type === 'video' && (byId.get('222').fileAbs || '').endsWith('movie.mp4'));
  check('B7 没有 preview ⇒ previewAbs 为 null（不编路径）', byId.get('dp1').previewAbs === null);
  check('B8 每个条目都带 dirAbs（清单逐条目复核的失效键）',
    got.every((p) => typeof p.dirAbs === 'string' && p.dirAbs.length > 0));

  // 分块边界：SCAN_CHUNK 是 24 ⇒ 25 个项目必须全过（正好跨一个 chunk）。
  const env2 = makeEnv('b-chunk');
  const kit2 = makeKit();
  for (let i = 0; i < 25; i++) project(join(env2.contentA, 'p' + String(i).padStart(2, '0')), { file: 'scene.pkg', title: 'T' + i }, { 'scene.pkg': 'x' });
  const many = await kit2.enumerateWallpapersAsync(env2.install, [env2.libA]);
  check('B9 超过 SCAN_CHUNK(24) 的项目全部被发现（分块边界不丢尾块）',
    many.length === 25 && kit2.SCAN_CHUNK === 24, 'found=' + many.length + ' chunk=' + kit2.SCAN_CHUNK);

  const env3 = makeEnv('b-dup');
  check('B10 两个根里同名项目目录 ⇒ 只留一个，且先扫到的那个赢（去重按 id）',
    await firstWinsOnDuplicateId(makeKit, env3));
  const noDedupe = await loadMutant('no-dedupe-id', (s) => s.replace(
    'if (!hit || found.has(hit.p.id)) continue;', 'if (!hit) continue;'));
  const env4 = makeEnv('b-dup-neg');
  check('B11 负对照：变异体去掉 id 去重 ⇒ B10 那条判据判红（后者会覆盖前者）',
    await firstWinsOnDuplicateId(() => noDedupe({ WE_APPID: APPID, ...realDeps() }), env4) === false);
})();

// ═══ C. readProjectP ════════════════════════════════════════════════════════
await (async () => {
  section('C. project.json → 条目（缺字段的降级、类型白名单、schemecolor 换算）');
  const env = makeEnv('c');
  const kit = makeKit();
  check('C1 没有 project.json ⇒ null',
    await kit.readProjectP(project(join(env.base, 'c1'), null)) === null);
  const badJson = project(join(env.base, 'c2'), null);
  writeFileSync(join(badJson, 'project.json'), '{ not json');
  check('C2 project.json 不是合法 JSON ⇒ null（不许把半解析结果漏出去）',
    await kit.readProjectP(badJson) === null);
  check('C3 没有 file 字段 ⇒ null（缺主文件的"项目"不算条目）',
    await kit.readProjectP(project(join(env.base, 'c3'), { title: 'x' })) === null);

  const bare = project(join(env.base, 'bare-title'), { file: 'scene.pkg' });
  const p1 = await kit.readProjectP(bare);
  check('C4 缺 title / preview / contentrating ⇒ 分别落 basename / null / null',
    p1.id === 'bare-title' && p1.title === 'bare-title' && p1.preview === null && p1.contentrating === null);

  const typed = await kit.readProjectP(project(join(env.base, 't'), { file: 'a.mp4', type: 'QUAKE' }));
  check('C5 type 不在白名单（scene/video/web/application）⇒ 落 scene（未知类型不许透传）',
    typed.type === 'scene', typed.type);

  const scheme = await kit.readProjectP(project(join(env.base, 'scheme'), {
    file: 'scene.pkg',
    general: { properties: { schemecolor: { value: '0.847 0.725 0.713' } } },
  }));
  check('C6 schemecolor 0–1 三元组 ⇒ rgb(...)（四舍五入到 0–255）',
    scheme.schemeColor === 'rgb(216, 185, 182)', scheme.schemeColor);
  const badScheme = await kit.readProjectP(project(join(env.base, 'scheme-bad'), {
    file: 'scene.pkg', general: { properties: { schemecolor: { value: 'not a color' } } },
  }));
  check('C7 无效 schemecolor ⇒ null（不许编一个颜色出来）', badScheme.schemeColor === null);
  const inferred = {
    video: await kit.readProjectP(project(join(env.base, 'inf-v'), { file: 'a.MP4' })),
    web: await kit.readProjectP(project(join(env.base, 'inf-w'), { file: 'a.html' })),
    scene: await kit.readProjectP(project(join(env.base, 'inf-s'), { file: 'a.pkg' })),
  };
  check('C10 没有 type ⇒ 按扩展名判（mp4 ⇒ video / html ⇒ web / 其它 ⇒ scene）',
    inferred.video.type === 'video' && inferred.web.type === 'web' && inferred.scene.type === 'scene',
    [inferred.video.type, inferred.web.type, inferred.scene.type].join('|'));

  const rating = await kit.readProjectP(project(join(env.base, 'rating'), { file: 'scene.pkg', contentrating: 'Mature' }));
  check('C8 contentrating 原样透传（浏览器半边的分级筛选用它）', rating.contentrating === 'Mature');

  const badRating = await kit.readProjectP(project(join(env.base, 'rating-bad'), { file: 'scene.pkg', contentrating: 5 }));
  check('C11 contentrating 非字符串 ⇒ null（不许把数字漏给前端的筛选）', badRating.contentrating === null);

  const openKinds = await loadMutant('kinds-open', (s) => s.replace(
    'if (!KINDS.includes(type)) type = \'scene\';', 'if (false && !KINDS.includes(type)) type = \'scene\';'));
  const envC = makeEnv('c-neg');
  check('C9 负对照：变异体拆掉类型白名单 ⇒ 同一条判据判红（QUAKE 会原样漏出去）',
    await unknownTypeFallsBack(() => openKinds({ WE_APPID: APPID, ...realDeps() }), envC) === false);
})();

// ═══ D. resolveSceneMainFileP ═══════════════════════════════════════════════
await (async () => {
  section('D. 场景主容器解析：声明优先，其次 scene.pkg / scene.json，最后"恰好一个 *.pkg"');
  const env = makeEnv('d');
  const kit = makeKit();
  const d1 = project(join(env.base, 'd1'), null, { 'scene.pkg': 'p' });
  check('D1 声明的文件存在 ⇒ 用声明（信任 project.json）',
    await kit.resolveSceneMainFileP(d1, 'scene.pkg') === 'scene.pkg'
    && await kit.resolveSceneMainFileP(d1, 'custom.pkg') === 'scene.pkg');
  const d2 = project(join(env.base, 'd2'), null, { 'scene.json': '{}' });
  check('D2 声明的是 scene.pkg 但只有 scene.json ⇒ 回退到 scene.json',
    await kit.resolveSceneMainFileP(d2, 'scene.pkg') === 'scene.json');
  const d3 = project(join(env.base, 'd3'), null, { 'only-one.pkg': 'p' });
  check('D3 没有命名候选、目录里恰好一个 *.pkg ⇒ 认它（名字任意）',
    await kit.resolveSceneMainFileP(d3, 'scene.json') === 'only-one.pkg');
  const d4 = project(join(env.base, 'd4'), null, { 'a.pkg': 'a', 'b.pkg': 'b' });
  check('D4 多个 *.pkg ⇒ null（候选多于一个等于没候选，不许猜）',
    await kit.resolveSceneMainFileP(d4, 'scene.json') === null);
  const d5 = project(join(env.base, 'd5'), null, { 'notes.txt': 'x' });
  check('D5 什么都不匹配 ⇒ null', await kit.resolveSceneMainFileP(d5, null) === null);
  check('D6 目录读不到（不存在）⇒ null（不抛）',
    await kit.resolveSceneMainFileP(join(env.base, 'no-such-dir'), 'scene.json') === null);

  const anyPkg = await loadMutant('any-pkg', (s) => s.replace(
    'return pkgs.length === 1 ? pkgs[0] : null;', 'return pkgs[0] || null;'));
  const mkAny = () => anyPkg({ WE_APPID: APPID, ...realDeps() });
  const envD = makeEnv('d-neg');
  check('D7 负对照：变异体把"恰好一个"放宽成"第一个" ⇒ D4 那条判据判红',
    await singlePkgOnly(mkAny, envD) === false);

  const swappy = await loadMutant('swap-container-probe', (s) => s.replace(
    "[declared, 'scene.pkg', 'scene.json']", "[declared, 'scene.json', 'scene.pkg']"));
  const mkSwap = () => swappy({ WE_APPID: APPID, ...realDeps() });
  check('D9 负对照：变异体把容器探测顺序换成 scene.json 优先 ⇒ 同一条判据判红',
    await (async () => {
      const k = mkSwap();
      const dir = project(join(envD.base, 'swap'), { file: 'nope.json' }, { 'scene.pkg': 'p', 'scene.json': '{}' });
      return await k.resolveSceneMainFileP(dir, 'nope.json') !== 'scene.pkg';
    })());
  check('D10 正判据：同时有 scene.pkg 与 scene.json ⇒ scene.pkg 优先（探测顺序是有意的）',
    await (async () => {
      const dir = project(join(env.base, 'both'), null, { 'scene.pkg': 'p', 'scene.json': '{}' });
      return await kit.resolveSceneMainFileP(dir, 'nope.json') === 'scene.pkg';
    })());

  const extMut = await loadExtOfMutant('ext-any-dot', (s) => s.replace(
    'return dot > sepAt + 1 ? s.slice(dot + 1).toLowerCase() : \'\';',
    'return dot >= 0 ? s.slice(dot + 1).toLowerCase() : \'\';'));
  check('D8 负对照：变异体把"真后缀"放宽成"有点就算" ⇒ extOf 判据判红（.bashrc 会变成 bashrc）',
    extOnlyForRealSuffixes(() => makeKit({ extOf: extMut })) === false);
})();

// ═══ E. pathKey / extOf / playlistItemId ═══════════════════════════════════
await (async () => {
  section('E. 路径与 id 的小工具（清单索引与播放列表都靠它们对齐）');
  const kit = makeKit();
  check('E1 extOf：只认真正后缀（前导点 / 路径中点 / 空串都不算）', extOnlyForRealSuffixes(makeKit));
  check('E2 pathKey 统一分隔符并小写（同一路径的两种写法必须同键）',
    kit.pathKey('C:/Wallpapers/A/Project.json') === kit.pathKey('c:\\wallpapers\\a\\project.json')
    && kit.pathKey('C:/A/B') !== kit.pathKey('C:/A/C'));

  const byPath = new Map([[kit.pathKey('C:\\wp\\a'), 'a']]);
  const byId = new Map([['555', { id: '555' }]]);
  check('E3 playlistItemId：精确路径命中优先',
    kit.playlistItemId('C:\\wp\\a', byPath, byId) === 'a');
  check('E4 playlistItemId：workshop 路径按 appid 段取目录名当 id',
    kit.playlistItemId('C:\\steam\\steamapps\\workshop\\content\\431960\\555\\scene.pkg', byPath, byId) === '555');
  check('E5 playlistItemId：安装目录相对项按**末尾项目目录名**回退匹配',
    kit.playlistItemId('projects\\defaultprojects\\555\\project.json', new Map(), byId) === '555');
  check('E6 playlistItemId：都匹配不上 ⇒ null（不许编 id）',
    kit.playlistItemId('D:\\elsewhere\\zzz\\file.pkg', byPath, byId) === null);
})();

// ═══ F. WE 播放列表 ═════════════════════════════════════════════════════════
await (async () => {
  section('F. WE 播放列表：两种来源、名字/顺序/延迟的归一、去重');
  const env = makeEnv('f');
  const kit = makeKit();
  check('F1 没有 installDir / 没有 config.json ⇒ []（不抛）',
    (await kit.readPlaylistsP('')).length === 0 && (await kit.readPlaylistsP(env.install)).length === 0);

  writeFileSync(join(env.install, 'config.json'), JSON.stringify({
    profileA: { general: { playlists: [
      { name: 'Mix', items: ['C:\\wp\\a', '  ', 42], settings: { order: 'random', delay: 30 } },
      { items: ['C:\\wp\\b'] },
      { name: 'Empty', items: [] },
    ] } },
    profileB: { general: { wallpaperconfig: { selectedwallpapers: {
      0: { playlist: { name: 'FromSel', items: ['C:\\wp\\c'], settings: { order: 'weird' } } },
    } } } },
  }));
  const rows = await kit.readPlaylistsP(env.install);
  check('F2 两种来源都读：general.playlists 与 wallpaperconfig.selectedwallpapers 的 playlist',
    rows.length === 3, rows.map((r) => r.name).join('|'));
  const mix = rows.find((r) => r.name === 'Mix');
  check('F3 items 过滤非字符串与纯空白（"  " 与 42 都不进列表）',
    JSON.stringify(mix.items) === JSON.stringify(['C:\\wp\\a']), JSON.stringify(mix.items));
  check('F4 settings.order 只认 random，其余落 sequence；delay 非数字落 null',
    mix.order === 'random' && mix.delay === 30
    && rows.find((r) => r.name === 'FromSel').order === 'sequence'
    && rows.find((r) => r.name === 'FromSel').delay === null);
  check('F5 缺 name ⇒ `Playlist <序号>`；items 为空的行整行跳过',
    rows.some((r) => r.name === 'Playlist 2') && !rows.some((r) => r.name === 'Empty'));
  check('F6 id 是 base64url 且随 profile/序号/名字变化',
    /^[A-Za-z0-9_-]+$/.test(mix.id)
    && new Set(rows.map((r) => r.id)).size === rows.length);

  const env2 = makeEnv('f-dup');
  check('F7 跨 profile 的重复列表（同名字同条目）只出现一次',
    await playlistDedupe(makeKit, env2));
  const noDedupe = await loadMutant('no-dedupe-playlist', (s) => s.replace(
    'if (seen.has(signature)) continue;', 'if (false) continue;'));
  const env3 = makeEnv('f-dup-neg');
  check('F8 负对照：变异体去掉列表去重 ⇒ F7 那条判据判红',
    await playlistDedupe(() => noDedupe({ WE_APPID: APPID, ...realDeps() }), env3) === false);

  // 坏配置的诚实降级：`general.playlists` 不是数组（WE 的 config 由用户/第三方写，形态不可信）
  // ⇒ 必须落到 `wallpaperconfig.selectedwallpapers` 回退；两边都没有 ⇒ []，且都不许抛。
  const env4 = makeEnv('f-nonarray');
  writeFileSync(join(env4.install, 'config.json'), JSON.stringify({
    profileA: { general: {
      playlists: { name: 'not-an-array' },
      wallpaperconfig: { selectedwallpapers: { 0: { playlist: { name: 'Fallback', items: ['C:\\wp\\z'] } } } },
    } },
  }));
  const env5 = makeEnv('f-nonarray-empty');
  writeFileSync(join(env5.install, 'config.json'), JSON.stringify({
    profileA: { general: { playlists: 'nope' } },
  }));
  check('F9 `general.playlists` 不是数组 ⇒ 落到 selectedwallpapers 回退；两边都没有 ⇒ []（不抛）',
    await (async () => {
      try {
        const a = await makeKit().readPlaylistsP(env4.install);
        const b = await makeKit().readPlaylistsP(env5.install);
        return a.length === 1 && a[0].name === 'Fallback' && b.length === 0;
      } catch { return false; }
    })());

  const truthyPlaylists = await loadMutant('playlists-truthy-not-array', (s) => s.replace(
    'if (Array.isArray(general.playlists) && general.playlists.length) return general.playlists;',
    'if (general.playlists) return general.playlists;'));
  check('F10 负对照：变异体把数组判据换成真值判据 ⇒ 非数组配置抛出去 ⇒ F9 判据判红',
    await (async () => {
      try {
        await truthyPlaylists({ WE_APPID: APPID, ...realDeps() }).readPlaylistsP(env4.install);
        return false;
      } catch { return true; }
    })());
})();

// ═══ G. 注入点的退化路径（替身恒假 ⇒ 空结果，不抛）═══════════════════════════
await (async () => {
  section('G. 注入点语义：三个探测替身真被调用；替身恒 false 时安静退化（不抛）');
  const env = makeEnv('g');
  project(join(env.contentA, '777'), { file: 'scene.pkg', title: 'Hidden' }, { 'scene.pkg': 'x' });
  const noRoots = makeKit({ pathExistsP: () => false, isFileP: () => false, isDirectoryP: () => false });
  check('G1 pathExistsP 恒 false ⇒ 没有扫描根，枚举为空且不抛（Steam 没装/全被删的退化）',
    (await noRoots.enumerateWallpapersAsync(env.install, [env.libA])).length === 0);
  check('G2 isDirectoryP 恒 false ⇒ 根里即使有项目也全被跳过（不抛）',
    (await makeKit({ isDirectoryP: () => false }).enumerateWallpapersAsync(env.install, [env.libA])).length === 0);
  check('G3 isFileP 恒 false ⇒ 声明的主文件不可用 ⇒ 落回容器探测链（不抛）',
    await (async () => {
      const dir = project(join(env.base, 'not-a-file'), { file: 'scene.pkg' }, { 'scene.pkg': 'p' });
      const k = makeKit({ isFileP: () => false });
      return await k.resolveSceneMainFileP(dir, 'scene.pkg') === 'scene.pkg';
    })());
  const calls = [];
  const counting = makeKit({
    pathExistsP: (p) => { calls.push(p); return realDeps().pathExistsP(p); },
    isFileP: (p) => { calls.push(p); return realDeps().isFileP(p); },
    isDirectoryP: (p) => { calls.push(p); return realDeps().isDirectoryP(p); },
  });
  await counting.enumerateWallpapersAsync(env.install, [env.libA]);
  check('G4 三个注入点确实被调用（不是模块自己偷偷 stat）', calls.length >= 3, 'calls=' + calls.length);
  const badCfg = makeEnv('g-cfg');
  writeFileSync(join(badCfg.install, 'config.json'), '{ nope');
  check('G5 坏 JSON 的 config.json ⇒ []（不抛）', (await makeKit().readPlaylistsP(badCfg.install)).length === 0);
})();

// ═══ H. 覆盖面地板（防"判据在空域上恒真"）═══════════════════════════════════
section('G. 覆盖面地板（防"判据在空域上恒真"）');
check('G1 正向判据数 ≥ 25', passed >= 25, 'passed=' + passed);
check('G2 负对照（变异体）数 ≥ 6', mutantSeq >= 6, 'mutants=' + mutantSeq);
check('G3 本文件确实 import 了被测模块（不是隔着别的东西判）',
  typeof createWallpaperScanKit === 'function' && readFileSync(SRC, 'utf8').includes('export function createWallpaperScanKit'));

console.log('');
if (failed) {
  console.log(`WALLPAPER-SCAN CHECKS FAILED — ${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`ALL WALLPAPER-SCAN CHECKS PASSED (${passed})`);
