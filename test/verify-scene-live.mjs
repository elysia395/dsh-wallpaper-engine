#!/usr/bin/env node
/**
 * verify-scene-live.mjs — WebWallGL live render pipeline self-test.
 *
 * Levels:
 *   A. Renderer page + engine: lib/webwallgl/ carries our adapter page, which
 *      loads the self-contained global engine build from the `webwallgl` npm
 *      dependency (./engine/webwallgl.global.min.js, classic script), and
 *      defines every __wp method the client calls; the engine bundle still
 *      carries the web shim the host extracts.
 *   B. /scene-live route (mock webServer): index.html, the page module and the
 *      engine serve with the right mime/cache headers, the directory fences
 *      reject escapes (encoded ../), and non-GET is 405.
 *   C. /scene-files route: a synthetic Steam library fixture (DSH_WE_STEAM_ROOT
 *      → temp dir with steamapps/common/wallpaper_engine + workshop content)
 *      drives the real inventory so a token gets minted; asserts scene pkg /
 *      project.json byte-for-byte serving, the fence, unknown-token 404,
 *      missing-subpath 404 and Range/206.
 *   D. Client source contract: src/client.js exposes the live pieces
 *      (priority chain, heartbeat, audio mux, key extension) — cheap static
 *      assertions that fail loudly when a refactor drops the wiring.
 *
 * Runs anywhere (no Steam needed — the fixture is synthetic).
 *
 * Usage:  node test/verify-scene-live.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable, Writable } from 'node:stream';
// 剥注释：共享的字符串感知实现（`verify-module-layout` 的『剥注释必须字符串感知』一节钉住"不许再用朴素正则"）。
import { stripComments, stripExportBlocks } from './tools/js-text.mjs';
// 子包登记面的**发现层**：T2 起子包构建数据是逐包配方 JSON，本守卫不写死 packages/fx / packages/parallax。
import { discoverPackages } from './tools/packages.mjs';
// 刀3：样式族取文（8 个域模块 + 组装点，构建序拼接）。刀6：客户端正文族（正文 + 助手模块）。
import { styleText, panelSources, panelText, liveText, clientText } from './tools/src-scope.mjs';
// 单独 import `src/**` 时补上 bundle 作用域的取词层（面板渲染器直接用 weT；见该 shim 的文件头）。
import { installWeTShim } from './tools/weT-shim.mjs';
// 判据工具（计数打点 / 函数体取法）与 `test/verify-client.mjs` 共用同一份实现：
// 两处各留一份就是两处会各自漂的判据面。契约见该文件头（`fnNameBody` 的朴素截断是契约）。
import { createCheck, normCrlf, braceBody, fnNameBody as fnBody } from './tools/assert-harness.mjs';
installWeTShim();

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── A3 之后 fx / parallax 两族的浏览器半边住在**自己的子包**里 ─────────────────────
// 源码在 packages/<pkg>/src/**，产物在 packages/<pkg>/lib/client.<短名>.js（宿主按
// cordis.patch.yml 的行名加载子包行，行再提供自己的浏览器半边）。本守卫里对这四个文件
// 的读盘 / import 全都走下面这两枚定位器 —— 落点散在十处，写死字符串必再漂一次。
const subFxFile = (f) => join(root, 'packages', 'fx', 'src', f);
const subParallaxFile = (f) => join(root, 'packages', 'parallax', 'src', f);
const SUB_FX_PRODUCT = join(root, 'packages', 'fx', 'lib', 'client.fx.js');
const SUB_PARALLAX_PRODUCT = join(root, 'packages', 'parallax', 'lib', 'client.parallax.js');

/** 子包构建配方（`packages/<pkg>/client.build.json`）的取文 —— 本守卫唯一的子包登记面。
 *
 *  T2 起 `scripts/build-client.mjs` 里**不再有** `SUBPACKAGE_BUILDS` 字面量表：前端构建数据逐包一份
 *  配方 JSON（`artifact` / `inline[].file` 都**相对包目录**）。所以「哪两份源文件住在子包产物里」
 *  只能从配方读 —— 继续从构建器源码文本里切片找那张表，在 T2 之后是**读空**（正面证据恒不成立）。
 *
 *  发现面走 `discoverPackages()`（不写死 packages/fx / packages/parallax）。子包目录里**没有**
 *  配方文件是正常的（host-only 子包不编浏览器半边），因此只收在盘的配方；**在盘但读不出来**
 *  逐包登记到 `broken`，调用方必须判红并点名（静默跳过 = 登记面判据恒真）。
 */
const subpackageRecipes = () => {
  const dirs = [];
  const broken = [];
  const files = [];
  const chunks = [];
  for (const p of discoverPackages(root).packages) {
    const rel = p.dir + '/client.build.json';
    if (!existsSync(join(root, rel))) continue;
    try {
      const src = readFileSync(join(root, rel), 'utf8');
      const recipe = JSON.parse(src);
      dirs.push(p.dir);
      chunks.push(src);
      for (const inline of recipe.inline || []) if (inline && typeof inline.file === 'string') files.push(inline.file);
    } catch {
      broken.push(p.dir);
    }
  }
  return { dirs, broken, files, text: chunks.join('\n') };
};

/** 配方里登记了某份源文件 —— **引号不敏感**：JSON `"file": "…"` 与旧 JS 字面量 `file: '…'` 同判。 */
const registersFile = (text, rel) =>
  new RegExp('["\']?file["\']?\\s*:\\s*["\']' + rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\']').test(text);

/** 装配共享注册表（src/extension-registry.js）并登记「扩展」页签的三项。
 *
 *  为什么挂载台需要它：三份 bundle（主包 / packages/fx / packages/parallax）的**求值顺序不保证**，
 *  panel-tabs 的 extensionModules() 只问注册表。挂载台是**按文件** import 的，于是必须自己把表
 *  装起来 —— 否则 weExtensionModules 是裸标识符（ReferenceError，且只在渲染「扩展」页签时才炸）。
 *
 *  ⚠️ 这里用字面量路径 join(root, 'src', 'extension-registry.js') 来 import：本守卫因此是
 *  src/extension-registry.js 的真实覆盖（test/verify-guard-map.mjs 的「零覆盖」那条判据认它）。
 *  幂等：两块挂载台共用同一个模块实例，重复登记会撞注册表的「id 重复注册」抛错。
 */
let weExtensionRegistryPromise = null;
function installExtensionRegistry() {
  // 幂等靠 promise memo：模块级变量只在**同步**段写一次（async 函数里 await 之后回写会被
  // require-atomic-updates 判成竞态）；两块挂载台 await 同一个 promise ⇒ 同一个模块实例。
  if (!weExtensionRegistryPromise) weExtensionRegistryPromise = loadExtensionRegistry();
  return weExtensionRegistryPromise;
}
async function loadExtensionRegistry() {
  const reg = await import(pathToFileURL(join(root, 'src', 'extension-registry.js')).href);
  Object.assign(globalThis, reg);
  const avatarMod = await import(pathToFileURL(join(root, 'src', 'ext-avatar.js')).href);
  const fxMod = await import(pathToFileURL(subFxFile('ext-fx.js')).href);
  const parallaxMod = await import(pathToFileURL(subParallaxFile('ext-parallax.js')).href);
  // 故意**乱序**登记：屏上顺序必须由描述符的 order 决定（注册序 / 数组序不是契约）。
  reg.weRegisterExtensionModule('fx', fxMod.FX_EXTENSION_MODULE);
  reg.weRegisterExtensionModule('parallax', parallaxMod.PARALLAX_EXTENSION_MODULE);
  reg.weRegisterExtensionModule('avatar', avatarMod.AVATAR_EXTENSION_MODULE);
  check('扩展注册表：三项齐 · 顺序 = order（乱序登记下头像仍第一）· 不靠注册序',
    reg.weExtensionModules().map((m) => m.id).join(',') === 'avatar,fx,parallax'
    // 第二半是**牙**：注册序确实是 fxp/parallax/avatar，不等于输出序 ⇒ 排序真的在按 order 工作
    //（把注册表的 (order, seq) 排序去掉，这条会立刻红）。
    && ['fx', 'parallax', 'avatar'].join(',') !== reg.weExtensionModules().map((m) => m.id).join(','),
    '注册序=fx,parallax,avatar · 输出序=' + reg.weExtensionModules().map((m) => m.id + '(' + m.order + ')').join(' '));
  check('扩展注册表：id 唯一（重复注册当场抛 —— 注册链不许静默吞掉抢 id 的那一份）',
    (() => {
      try { reg.weRegisterExtensionModule('avatar', avatarMod.AVATAR_EXTENSION_MODULE); return false; }
      catch { return true; }
    })());
  // P-C：外观页签的第六节「全局字体」已随字体包搬走 ⇒ 夹具按**真入口同形**登记它。
  // 挂载台与 ext-fx / ext-parallax 一样是"按文件 import 包内源文件"，取的也是同一份渲染器；
  // 描述符形状与 packages/fonts/src/client.js 逐字同形（title 是 accessor ⇒ 注册期不读译文）。
  const fontSectionMod = await import(pathToFileURL(join(root, 'packages', 'fonts', 'src', 'appearance-font-section.js')).href);
  reg.weRegisterPanelSection('appearance', 'fonts', {
    id: 'fonts',
    get title() { return globalThis.weT('全局字体'); },
    render: fontSectionMod.renderAppearanceFontSection,
  });
  return reg;
}
// Keep every cache/config write inside the workspace (same stance as
// verify-scene.mjs) — apply() may sweep/purge caches on startup.
const TEST_CACHE_DIR = join(root, '.test-cache', 'scene-live');
process.env.DSH_WE_CACHE_DIR = TEST_CACHE_DIR;
// Custom-storage fixture, created BEFORE lib/index.js is imported: UPLOAD_DIR
// is resolved at module load, and the inventory scan must see the fixture from
// its very first call (the scan result is TTL-cached for 3 s).
const TEST_UPLOAD_DIR = join(TEST_CACHE_DIR, 'uploads-fixture');
process.env.DSH_WE_UPLOAD_DIR = TEST_UPLOAD_DIR;
// 设置文件（config.json）也挪进来：本脚本会 PUT 设置来验证「覆盖值 → HTML 种子」
// 这条链路，绝不能碰用户真实的那份（pluginDataDir 认这个变量，不设时行为不变）。
const TEST_DATA_DIR = join(TEST_CACHE_DIR, 'data');
process.env.DSH_WE_DATA_DIR = TEST_DATA_DIR;
// POSIX 读 $HOME、Windows 读 %USERPROFILE%，两个都覆盖。
const TEST_HOME = join(TEST_CACHE_DIR, 'home');
mkdirSync(TEST_HOME, { recursive: true });
process.env.HOME = TEST_HOME;
process.env.USERPROFILE = TEST_HOME;

/** Minimal PKGV writer (raw entries) — mirrors the synthetic builder in
 *  verify-scene.mjs so the static-frame extractor has something real to chew on. */
function buildPkg(entries) {
  const parts = [];
  const index = [];
  let offset = 0;
  for (const { path, bytes } of entries) {
    index.push({ path, offset, length: bytes.length });
    parts.push(bytes);
    offset += bytes.length;
  }
  const headerSize = 12 + 8 + index.reduce((n, e) => n + 4 + Buffer.byteLength(e.path, 'utf8') + 8, 0);
  const header = Buffer.alloc(headerSize);
  let p = 0;
  header.writeInt32LE(8, p); p += 4;
  header.write('PKGV0001', p, 'ascii'); p += 8;
  header.writeInt32LE(index.length, p); p += 4;
  for (const e of index) {
    header.writeInt32LE(Buffer.byteLength(e.path, 'utf8'), p); p += 4;
    header.write(e.path, p, 'utf8'); p += Buffer.byteLength(e.path, 'utf8');
    header.writeUInt32LE(e.offset, p); p += 4;
    header.writeUInt32LE(e.length, p); p += 4;
  }
  return Buffer.concat([header.subarray(0, p), ...parts]);
}
function buildTexRgba(width, height, rgbaBytes) {
  const mip = Buffer.alloc(20 + rgbaBytes.length);
  mip.writeInt32LE(width, 0);
  mip.writeInt32LE(height, 4);
  mip.writeInt32LE(0, 8);
  mip.writeInt32LE(0, 12);
  mip.writeInt32LE(rgbaBytes.length, 16);
  rgbaBytes.copy(mip, 20);
  const header = Buffer.alloc(9 + 9 + 4 * 8 + 9 + 4 * 2);
  let p = 0;
  header.write('TEXV0005\0', p, 'ascii'); p += 9;
  header.write('TEXI0001\0', p, 'ascii'); p += 9;
  header.writeInt32LE(0, p); p += 4;  // RGBA8888
  header.writeInt32LE(0, p); p += 4;
  header.writeInt32LE(width, p); p += 4;
  header.writeInt32LE(height, p); p += 4;
  header.writeInt32LE(width, p); p += 4;
  header.writeInt32LE(height, p); p += 4;
  header.writeInt32LE(0, p); p += 4;
  header.write('TEXB0002\0', p, 'ascii'); p += 9;
  header.writeInt32LE(1, p); p += 4;
  header.writeInt32LE(1, p); p += 4;
  return Buffer.concat([header.subarray(0, p), mip]);
}
/** 32×32 noise RGBA (noise survives the extractor's flatness/color gates). */
function noiseRgba(w) {
  const rgba = Buffer.alloc(w * w * 4);
  let seed = 0x12345678;
  for (let i = 0; i < w * w; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    rgba[i * 4] = seed & 0xff;
    rgba[i * 4 + 1] = (seed >> 8) & 0xff;
    rgba[i * 4 + 2] = (seed >> 16) & 0xff;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}
function writeUploadsFixture() {
  rmSync(TEST_UPLOAD_DIR, { recursive: true, force: true });
  // A WE project directory, exactly the shape a WallpaperEM downloads folder
  // has: project.json declaring scene.json while only scene.pkg ships.
  const projDir = join(TEST_UPLOAD_DIR, 'my-scene-1');
  mkdirSync(projDir, { recursive: true });
  const pkg = buildPkg([
    { path: 'scene.json', bytes: Buffer.from(JSON.stringify({ objects: [{ image: 'main.tex' }] })) },
    { path: 'main.tex', bytes: buildTexRgba(32, 32, noiseRgba(32)) },
  ]);
  writeFileSync(join(projDir, 'scene.pkg'), pkg);
  writeFileSync(join(projDir, 'project.json'), JSON.stringify({
    title: 'Custom Dir Scene', type: 'scene', file: 'scene.json', preview: 'preview.jpg',
    contentrating: 'Everyone',
    // 作者配色：这条属性既是垫底图的底色兜底，也是「主题随壁纸」的优先级①。
    // 目录形态的上传一旦在 inventory 里把它丢掉，优先级①对这些壁纸就不生效、只能退到
    // 画面主色 —— 实测那会把作者标了 0 0 0 的暗色壁纸判成浅色（本夹具就是那条判据）。
    general: { properties: { schemecolor: { order: 0, text: 'ui_browse_properties_scheme_color', type: 'color', value: '0.114 0.220 0.329' } } },
  }));
  writeFileSync(join(projDir, 'preview.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  // A legacy single-file upload must keep working alongside directories.
  writeFileSync(join(TEST_UPLOAD_DIR, 'up-fixture-image.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
}
writeUploadsFixture();

// 计数与打点由共享工具提供（迁移前是这两行 `let` + 下面那个函数；输出与语义逐字节一致，
// 唯一区别是计数改成读 `stats.passed` / `stats.failed`）。
const { check, stats } = createCheck();
// 未执行的判据**必须**显式记名（DEV-GUIDE §4.7 约定 10：跳过不得与通过同形）。
// 平台造不出链接时那两条围栏判据整条不存在 —— 只打印一句"平台跳过"就放过，
// 汇总行仍是 `ALL … PASSED (N)`，调用方分不清"N 条判据都在"和"N 条里少两条"。
// 所以：逐条点名 + 计数进汇总行。**这不是通过**，也不替代判据本身（CI 的
// windows-latest 腿用 junction、POSIX 腿用 dir 链接，两处都有真覆盖）。
const skipNotes = [];
function skip(name, why) {
  skipNotes.push(name);
  console.log('  ○ SKIP ' + name + ' —— ' + why + '（不是通过）');
}

// ── Level A: renderer page + npm engine ─────────────────────────────────────
console.log('Level A — WebWallGL renderer page (lib/webwallgl/) + npm engine (webwallgl)');
const pageDir = join(root, 'lib', 'webwallgl');
const pageHtmlPath = join(pageDir, 'index.html');
check('lib/webwallgl/index.html exists', existsSync(pageHtmlPath));
const pageHtml = existsSync(pageHtmlPath) ? readFileSync(pageHtmlPath, 'utf8') : '';
const assetRefs = [...pageHtml.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
const engineRefs = assetRefs.filter((r) => r.startsWith('./engine/'));
check('renderer html loads the engine then its module relative to /scene-live/ (./engine/… → ./renderer.js)',
  assetRefs.length === 2 && engineRefs.length === 1 && assetRefs[1] === './renderer.js'
    && existsSync(join(pageDir, 'renderer.js')),
  assetRefs.join(', ') || '无引用');
// 引擎必须是**经典脚本**（全局版自包含）：ESM 版对 mediabunny 是裸导入，浏览器解析不了。
check('engine is loaded as a classic script (not type="module")',
  engineRefs.length === 1
    && new RegExp('<script\\s+src="' + engineRefs[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"\\s*>').test(pageHtml),
  engineRefs[0] || '无 ./engine/ 引用');
const pageJs = existsSync(join(pageDir, 'renderer.js')) ? readFileSync(join(pageDir, 'renderer.js'), 'utf8') : '';
const engineImport = engineRefs[0] || '';
check('renderer page takes the engine API from window.WebWallGL',
  /=\s*globalThis\.WebWallGL;/.test(pageJs));
const pkgJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const enginePkgDir = join(root, 'node_modules', 'webwallgl');
const enginePkg = existsSync(join(enginePkgDir, 'package.json'))
  ? JSON.parse(readFileSync(join(enginePkgDir, 'package.json'), 'utf8')) : null;
check('webwallgl is a runtime dependency and installed (CI: npm install before verify)',
  Boolean(pkgJson.dependencies && pkgJson.dependencies.webwallgl) && Boolean(enginePkg),
  'declared=' + ((pkgJson.dependencies || {}).webwallgl || '-') + ' installed=' + (enginePkg ? enginePkg.version : '-'));
check('renderer page loads the engine from ./engine/ and that file ships in the package',
  Boolean(engineImport) && existsSync(join(enginePkgDir, engineImport.slice('./engine/'.length))),
  engineImport || '无 ./engine/ 引用');
// 控制面契约：客户端按名调用渲染页的 `__wp` 方法（缺一个只表现为壁纸不响应，没有报错）——
// 客户端源码里出现的每个 `wp.<方法>(` 都必须在渲染页上有定义。
const clientSrc = liveText() + '\n' + clientText();
const calledWp = [...new Set([...clientSrc.matchAll(/\bwp\.(\w+)\(/g)].map((m) => m[1]))].sort();
const missingWp = calledWp.filter((name) => !new RegExp('^  ' + name + '\\(', 'm').test(pageJs));
check('renderer page defines every __wp method the client calls',
  calledWp.length >= 10 && missingWp.length === 0,
  'called=[' + calledWp.join(', ') + '] missing=[' + missingWp.join(', ') + ']');
// 网页壁纸的 URL 一律带 webSandbox=strict：控制面任何方法都不得按 URL 参数被摘掉 ——
// 摘掉 setAudioBridge 时音频可视化壁纸静默不跳（客户端 typeof 判空后直接跳过，不报错）。
check('renderer page never strips __wp methods (strict web sandbox keeps the full host surface)',
  !/delete\s+window\.__wp\b/.test(pageJs) && !/delete\s+window\.__wp\[/.test(pageJs));
check('renderer page exposes __wpStats.frame()', /window\.__wpStats\s*=\s*\{\s*frame:/.test(pageJs));
// 兜底页（issue #129 证据 4）：渲染页在场景解析失败时把 iframe 指到
// `<BASE>/default-wallpaper/index.html` —— 缺了它，「静默超时」没有可见落点。
check('fallback page present: default-wallpaper/index.html exists',
  existsSync(join(pageDir, 'default-wallpaper', 'index.html')));
check('renderer page mounts the fallback page on error',
  pageJs.includes('./default-wallpaper/index.html') && /inst\.on\("error"/.test(pageJs));
check('scene-serve serves default-wallpaper without long cache',
  /rest === 'default-wallpaper\/index.html'/.test(readFileSync(join(root, 'lib', 'routes', 'scene-serve.js'), 'utf8')));

// 网页壁纸 shim：npm 包不单独发 web-shim.js，宿主从 bundle 的 `shimSource` 模板字面量提取
// （lib/index.js 的 extractWebShim）。bundle 形态变了提取就静默得空串 —— 先钉住形态还在。
const engineBundle = existsSync(join(enginePkgDir, 'webwallgl.mjs'))
  ? readFileSync(join(enginePkgDir, 'webwallgl.mjs'), 'utf8') : '';
const shimLiteral = (/const shimSource = \x60((?:\\[\s\S]|[^\x60\\])*)\x60;/.exec(engineBundle) || [])[1] || '';
check('engine bundle still carries the web shim as `const shimSource = \x60…\x60`',
  shimLiteral.length > 1000, shimLiteral.length + ' chars');
check('engine shim installs only once (idempotent guard)',
  /__weShimInstalled/.test(shimLiteral),
  '双 shim 会让 rAF 节流叠加：15fps 上限实测变成 7.5fps');
// 站点根夹住（官方 WE 语义：壁纸目录是站点根）：插件形态是 <BASE>/scene-files/<token>/…，
// 靠宿主声明 __weSiteRoot；少了它，作者按官方语义写的 `../assets/x` 会 404（spine 类整页黑屏）。
check('engine shim honours the host-declared __weSiteRoot', /__weSiteRoot/.test(shimLiteral));
check('engine rewrite recognises any data-we-shim value (host-injected shim)',
  engineBundle.includes('data-we-shim(?:-src)?'),
  '宿主注入的是 data-we-shim="host"，按值匹配会重复注入');

// ── shared mock webServer + req/res shims ───────────────────────────────────
const routes = [];
const mockCtx = {
  webServer: {
    register(route) { routes.push(route); return () => { const i = routes.indexOf(route); if (i >= 0) routes.splice(i, 1); }; },
    tapIndex() { return () => {}; },
  },
};
const hostMod = await import(pathToFileURL(resolve(root, 'lib', 'index.js')).href);
const host = hostMod.default || hostMod;
const apply = host.apply || (host.inject && host.apply);
const dispose = apply(mockCtx);

// ── 组件行也要 boot（本分支的路由族归属：媒体状态族归 `media-bridge` 组件行）──
// ⚠️ 这不是"放宽判据"，而是夹具的 boot 段要跟上本分支结构：`/media-status`、`/audio-spectrum`、
// `/now-playing`、`/now-playing/artwork`、`/media-control` 五条路由的实现住在
// `packages/media-bridge/lib/`（P2-2 入包、P-F 批 1c 出户，ADR-0013 D14「实现入包、主包不留注册点」，
// 由 `verify-route-ownership` 的 M10 钉住）。上游那条判据按"门面 apply 后即可用"写（单包单行假设）。
// 处置与第 4 轮 `/avatar` 一致：**连组件一起 boot**，判据判什么一个字没改。
if (typeof hostMod.applyComponent === 'function') {
  for (const comp of ['media-bridge', 'mascot-avatar', 'about-notice']) {
    try { hostMod.applyComponent(mockCtx, {}, comp); } catch (err) {
      console.log('  · 组件行 boot 失败（' + comp + '）：' + String(err && err.message));
    }
  }
}

// 本脚本全程模拟**带能力头栅栏的桌面端**：社区壳（DSH Desktop.app）会给每条插件
// 路由注入 x-dsh-desktop-renderer，观测到它宿主才把网页壁纸载荷放进独立媒体源 ——
// 下面那条「webLiveSrc 是媒体源绝对 URL」的闸门正是这个形态的回归门。裸请求
//（原生浏览器，载荷走应用源相对路径）那一档由 test/verify-adapter.mjs 另行断言。
const FENCE_HEADERS = { 'x-dsh-desktop-renderer': '1', 'user-agent': 'Electron/33.2.0' };

function fakeReq(url, headers) {
  return { url, headers: headers || {}, method: 'GET' };
}
function fakeRes() {
  const state = { status: 200, headers: {}, body: Buffer.alloc(0), ended: false };
  const res = new Writable({
    write(chunk, enc, cb) { state.body = Buffer.concat([state.body, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]); cb(); },
    final(cb) { state.ended = true; cb(); },
  });
  res.setHeader = (k, v) => { state.headers[k] = v; };
  res.writeHead = (s, h) => { state.status = s; if (h) Object.assign(state.headers, h); };
  Object.defineProperty(res, 'statusCode', { get: () => state.status, set: (v) => { state.status = v; } });
  res.__state = state;
  return res;
}
/** 带请求体的 fake 请求（settings PUT）：handler 里是 req.on('data'/'end')，用 Readable 即可。 */
function fakeReqBody(url, method, obj) {
  const r = Readable.from([Buffer.from(JSON.stringify(obj))]);
  r.url = url;
  r.method = method;
  r.headers = { 'content-type': 'application/json' };
  return r;
}
/** 等响应 end/finish（PUT 的应答在写盘之后才发，等它就是等持久化完成）。 */
function waitRes(res) {
  return new Promise((resolveFn) => {
    if (res.__state.ended) { resolveFn(); return; }
    const t = setTimeout(resolveFn, 5000);
    res.on('finish', () => { clearTimeout(t); resolveFn(); });
  });
}
async function runHandler(route, url, headers) {
  const res = fakeRes();
  const done = route.handler(fakeReq(url, headers), res);
  if (done && typeof done.then === 'function') await done;
  if (!res.__state.ended) {
    await new Promise((resolveFn) => {
      const t = setTimeout(resolveFn, 8000);
      res.on('finish', () => { clearTimeout(t); resolveFn(); });
    });
  }
  return res;
}
const h = (res, k) => res.__state.headers[k] || res.__state.headers[k.toLowerCase()] || '';

// ── Level B: /scene-live static route ────────────────────────────────────────
console.log('Level B — /scene-live route (mock webServer)');
const liveRoute = routes.find((r) => r.path === '/wallpaper-engine/scene-live');
check('scene-live route registered', Boolean(liveRoute), liveRoute ? 'kind=' + liveRoute.kind : 'missing');
if (liveRoute) {
  const idxRes = await runHandler(liveRoute, '/wallpaper-engine/scene-live/index.html');
  check('index.html 200 + text/html', idxRes.__state.status === 200 && /text\/html/.test(h(idxRes, 'Content-Type')),
    'status=' + idxRes.__state.status + ' ' + h(idxRes, 'Content-Type'));
  check('index.html no-store', /no-store/.test(h(idxRes, 'Cache-Control')), h(idxRes, 'Cache-Control'));

  // The page module and the engine: no hash in their names ⇒ revalidating cache, never immutable.
  for (const rel of ['renderer.js', engineImport.replace(/^\.\//, '')]) {
    const r = rel ? await runHandler(liveRoute, '/wallpaper-engine/scene-live/' + rel) : null;
    check(rel + ' 200 + js mime + revalidate (not immutable)',
      r && r.__state.status === 200 && /javascript/.test(h(r, 'Content-Type'))
        && /must-revalidate/.test(h(r, 'Cache-Control')) && !/immutable/.test(h(r, 'Cache-Control')),
      r ? h(r, 'Content-Type') + ' ' + h(r, 'Cache-Control') : 'no engine import found');
  }
  const engEsc = await runHandler(liveRoute, '/wallpaper-engine/scene-live/engine/%2e%2e%2fpackage.json');
  check('engine/ encoded ../ escape fenced (403)', engEsc.__state.status === 403, 'status=' + engEsc.__state.status);

  // Bare prefix serves index.html (the client loads /scene-live/index.html, but
  // the directory form must not 404).
  const dirRes = await runHandler(liveRoute, '/wallpaper-engine/scene-live/');
  check('directory form serves index.html', dirRes.__state.status === 200 && /text\/html/.test(h(dirRes, 'Content-Type')),
    'status=' + dirRes.__state.status);

  // Encoded ../ escape must be fenced. NOTE: literal ../ (or %2e%2e) segments
  // are normalised away by `new URL()` itself and never reach the handler;
  // the %2e%2e%2f form (encoded slash) survives normalisation, decodes to a
  // real parent hop inside the handler and MUST be stopped by the fence.
  const escRes = await runHandler(liveRoute, '/wallpaper-engine/scene-live/%2e%2e%2findex.js');
  check('encoded ../ escape fenced (403)', escRes.__state.status === 403, 'status=' + escRes.__state.status);

  const postRes = fakeRes();
  liveRoute.handler({ url: '/wallpaper-engine/scene-live/index.html', headers: {}, method: 'POST' }, postRes);
  check('POST rejected (405)', postRes.__state.status === 405, 'status=' + postRes.__state.status);
}

// ── Level C: /scene-files via synthetic Steam fixture ────────────────────────
console.log('Level C — /scene-files route (synthetic Steam library)');
const fixtureRoot = join(root, '.test-cache', 'scene-live', 'steamlive-fixture');
const workshopDir = join(fixtureRoot, 'steamapps', 'workshop', 'content', '431960', '990001');
rmSync(fixtureRoot, { recursive: true, force: true });
mkdirSync(workshopDir, { recursive: true });
// A library root is only counted when steamapps/common/wallpaper_engine exists
// (see owningLibrariesP) — create it so enumerate picks the workshop content up.
mkdirSync(join(fixtureRoot, 'steamapps', 'common', 'wallpaper_engine'), { recursive: true });
const pkgBytes = Buffer.concat([
  Buffer.from('PKGV0023', 'latin1'),
  Buffer.alloc(4096, 0x5a),
]);
writeFileSync(join(workshopDir, 'scene.pkg'), pkgBytes);
writeFileSync(join(workshopDir, 'project.json'), JSON.stringify({
  title: 'Live Fixture Scene',
  type: 'scene',
  file: 'scene.pkg',
  preview: 'preview.jpg',
  contentrating: 'Everyone',
}));
// preview only needs to exist for the inventory probe; content is irrelevant.
writeFileSync(join(workshopDir, 'preview.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
// A file OUTSIDE the wallpaper dir, targeted by the fence test.
const secretPath = join(fixtureRoot, 'secret.txt');
writeFileSync(secretPath, 'top-secret');
// A web-wallpaper fixture directory (project.json + HTML entry + subresources):
// drives the /scene-files HTML shim injection, subresource MIME and CORS asserts.
const webDir = join(fixtureRoot, 'steamapps', 'workshop', 'content', '431960', '990003');
mkdirSync(webDir, { recursive: true });
writeFileSync(join(webDir, 'project.json'), JSON.stringify({
  title: 'Fixture Web Wallpaper', type: 'web', file: 'index.html', preview: 'preview.jpg',
  contentrating: 'Everyone',
  // 用户属性：host 必须把它转成 seed 脚本注入 HTML（严格沙箱下渲染页无法运行时补推）
  general: {
    properties: {
      color0: { order: 0, type: 'color', value: '1 0 0' },
      fpslock: { order: 1, type: 'bool', value: true },
      // order 用浮点（真实壁纸拿它做细分排序）
      size: { order: 2.5, type: 'slider', value: 0.5, min: 0, max: 2, step: 0.05, precision: 2, text: 'Size' },
      // combo 选项值类型混用：必须原样保留（字符串化会让壁纸里的 === 失配）
      mode: { order: 3, type: 'combo', value: 1, options: [{ label: 'One', value: 1 }, { label: 'Two', value: '2' }] },
      tip: { order: 4, type: 'text', text: 'Section' },
      // 条件只影响面板显隐，值照常下发
      extra: { order: 5, type: 'bool', value: true, condition: 'fpslock.value == true' },
      // 作者标记「用户不可编辑」：面板隐藏，值照常下发
      internal: { order: 6, type: 'slider', value: 1, editable: false },
    },
    localization: { 'zh-chs': { tip: '分节标题', size: '尺寸' } },
  },
}));
writeFileSync(join(webDir, 'index.html'), [
  '<!doctype html><html><head><meta charset="utf-8"><title>fixture</title>',
  '<link rel="stylesheet" href="style.css"></head>',
  '<body><div id="app"></div><script src="app.js"></script></body></html>',
].join('\n'));
writeFileSync(join(webDir, 'style.css'), '#app{color:#fff}');
writeFileSync(join(webDir, 'app.js'), 'window.__fixtureWeb=true;');
writeFileSync(join(webDir, 'preview.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
// A TRUE loose-directory scene fixture (WebWallGL 2.1.0 松散目录形态)：project.json
// 声明 .json 入口，入口 json 与同级素材**散放在盘上** —— 整个目录没有任何 scene.pkg。
// 渲染器 auto 档按 project.json.file 后缀判 loose、拉入口与同级素材；宿主必须给它
// 发 live token（旧「live render is pkg-only」门把这些壁纸整体关死 = 用户报障形态）。
const looseDir = join(fixtureRoot, 'steamapps', 'workshop', 'content', '431960', '990005');
mkdirSync(looseDir, { recursive: true });
const looseSceneJson = Buffer.from(JSON.stringify({ objects: [{ image: 'main.tex' }] }));
const looseTexBytes = buildTexRgba(24, 24, noiseRgba(24));
writeFileSync(join(looseDir, 'scene.json'), looseSceneJson);
writeFileSync(join(looseDir, 'main.tex'), looseTexBytes);
writeFileSync(join(looseDir, 'project.json'), JSON.stringify({
  title: 'Loose Fixture Scene', type: 'scene', file: 'scene.json', preview: 'preview.jpg',
  contentrating: 'Everyone',
}));
writeFileSync(join(looseDir, 'preview.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
process.env.DSH_WE_STEAM_ROOT = fixtureRoot;

const invRoute = routes.find((r) => r.path === '/wallpaper-engine/inventory');
const filesRoute = routes.find((r) => r.path === '/wallpaper-engine/scene-files');
check('scene-files route registered', Boolean(filesRoute), filesRoute ? 'kind=' + filesRoute.kind : 'missing');
let fixture = null;
let looseFixture = null;
if (invRoute) {
  const res = await runHandler(invRoute, '/wallpaper-engine/inventory', FENCE_HEADERS);
  const body = JSON.parse(res.__state.body.toString('utf8'));
  fixture = (body.wallpapers || []).find((w) => w.type === 'scene' && w.title === 'Live Fixture Scene') || null;
  check('fixture scene listed in inventory', Boolean(fixture), fixture ? fixture.id : 'not found');
  check('inventory marks fixture sceneLive=true with sceneLiveSrc',
    Boolean(fixture && fixture.sceneLive === true && typeof fixture.sceneLiveSrc === 'string' && fixture.sceneLiveSrc),
    fixture ? 'src len=' + String(fixture.sceneLiveSrc || '').length : '-');
  // 场景载荷的源由**宿主**给出（桌面形态下 = 自建媒体源的 origin）。这一条钉住"客户端
  // 不再自己拼 location.origin"的前提：宿主必须先把它端出来，空串才是"回落应用源"的合法值。
  check('inventory 给场景载荷端出宿主自己的源（sceneMediaBase）',
    typeof body.sceneMediaBase === 'string' && /^http:\/\/127\.0\.0\.1:\d+$/.test(body.sceneMediaBase || ''),
    'sceneMediaBase=' + (body.sceneMediaBase || '(空)'));
  // 松散目录场景（file=scene.json，盘上没有 scene.pkg）：WebWallGL 2.1.0 起渲染器
  // 自判形态，宿主必须照发 live token —— 这三条就是「松散场景壁纸无法实时渲染」
  // 的回归闸门（修复前 sceneLive=false / sceneLiveSrc=null，直接判红）。
  looseFixture = (body.wallpapers || []).find((w) => w.type === 'scene' && w.title === 'Loose Fixture Scene') || null;
  check('松散目录场景列在 inventory', Boolean(looseFixture), looseFixture ? looseFixture.id : 'not found');
  check('松散目录场景也标 sceneLive=true + sceneLiveSrc（pkg-only 旧门会把这两项关死）',
    Boolean(looseFixture && looseFixture.sceneLive === true && typeof looseFixture.sceneLiveSrc === 'string' && looseFixture.sceneLiveSrc),
    looseFixture ? 'sceneLive=' + looseFixture.sceneLive : '-');
  check('松散 token 解开 = 入口 json 绝对路径（token 契约：站点根 = 其所在目录，渲染器据此拉 project.json）',
    Boolean(looseFixture && looseFixture.sceneLiveSrc)
      && Buffer.from(looseFixture.sceneLiveSrc, 'base64url').toString('utf8').endsWith(sep + 'scene.json'),
    looseFixture && looseFixture.sceneLiveSrc
      ? 'token→' + Buffer.from(looseFixture.sceneLiveSrc, 'base64url').toString('utf8') : '-');
}
if (filesRoute && fixture && fixture.sceneLiveSrc) {
  const token = fixture.sceneLiveSrc;
  const pkgRes = await runHandler(filesRoute, `/wallpaper-engine/scene-files/${token}/scene.pkg`);
  check('scene.pkg 200 + octet-stream + byte-identical',
    pkgRes.__state.status === 200 && h(pkgRes, 'Content-Type') === 'application/octet-stream'
      && pkgRes.__state.body.equals(pkgBytes),
    'status=' + pkgRes.__state.status + ' ' + pkgRes.__state.body.length + 'B');

  const pjRes = await runHandler(filesRoute, `/wallpaper-engine/scene-files/${token}/project.json`);
  let pjOk = false;
  try { pjOk = pjRes.__state.status === 200 && JSON.parse(pjRes.__state.body.toString('utf8')).file === 'scene.pkg'; } catch { /* leave false */ }
  check('project.json 200 + parses', pjOk, 'status=' + pjRes.__state.status);

  const rangeRes = await runHandler(filesRoute, `/wallpaper-engine/scene-files/${token}/scene.pkg`, { range: 'bytes=0-99' });
  check('Range request → 206 + Content-Range + 100B',
    rangeRes.__state.status === 206 && /^bytes 0-99\//.test(h(rangeRes, 'Content-Range'))
      && rangeRes.__state.body.length === 100,
    'status=' + rangeRes.__state.status + ' ' + h(rangeRes, 'Content-Range'));

  // ── 大包的传输代价：可重验证缓存 + 载荷账本 ────────────────────────────────
  // 实测 `scene.pkg` 到 336MB，而每次重建 live 层都会重新拉一整遍；内容由 size+mtime
  // 唯一确定 ⇒ 给 ETag/Last-Modified（304 无体 = 复用手上的字节）。判据必须**两半都钉**：
  // ① 头在（缓存可用）；② 命中条件时真的 304 且零体（不是"带了头但仍然全量重传"）。
  const pkgEtag = h(pkgRes, 'ETag');
  const pkgCc = h(pkgRes, 'Cache-Control');
  check('scene.pkg 可重验证缓存（ETag + Last-Modified + must-revalidate，且**不是** no-store）',
    Boolean(pkgEtag) && Boolean(h(pkgRes, 'Last-Modified')) && /must-revalidate/.test(pkgCc) && !/no-store/.test(pkgCc),
    'etag=' + pkgEtag + ' cc=' + pkgCc);
  const notMod = await runHandler(filesRoute, `/wallpaper-engine/scene-files/${token}/scene.pkg`, { 'if-none-match': pkgEtag });
  check('条件 GET 命中 ⇒ 304 + 零体（真的省掉一次几百 MB 的读盘与传输）',
    notMod.__state.status === 304 && notMod.__state.body.length === 0,
    'status=' + notMod.__state.status + ' ' + notMod.__state.body.length + 'B');
  // 负对照：换一个 ETag ⇒ 必须回 200 全量（否则"凡带 if-none-match 就 304"也能过）
  const staleEtag = await runHandler(filesRoute, `/wallpaper-engine/scene-files/${token}/scene.pkg`, { 'if-none-match': 'W/"0-0"' });
  check('负对照：ETag 不匹配 ⇒ 200 全量（缓存判据有牙）',
    staleEtag.__state.status === 200 && staleEtag.__state.body.equals(pkgBytes),
    'status=' + staleEtag.__state.status + ' ' + staleEtag.__state.body.length + 'B');
  // 只带 If-Modified-Since（没有 ETag 的客户端）同样要能 304
  const imsRes = await runHandler(filesRoute, `/wallpaper-engine/scene-files/${token}/scene.pkg`, { 'if-modified-since': h(pkgRes, 'Last-Modified') });
  check('只带 If-Modified-Since ⇒ 同样 304 零体',
    imsRes.__state.status === 304 && imsRes.__state.body.length === 0,
    'status=' + imsRes.__state.status);
  // 目录围栏/404 这些**错误**响应仍必须 no-store（见下面 unknown token → 404 旁的判据）

  // ── 载荷传输账本（客户端首帧看护的"到底还在不在下载"）──────────────────────
  const progressRoute = routes.find((r) => r.path === '/wallpaper-engine/scene-payload-progress');
  check('载荷进度路由已注册', Boolean(progressRoute), progressRoute ? 'kind=' + progressRoute.kind : 'missing');
  if (progressRoute) {
    const progRes = await runHandler(progressRoute, `/wallpaper-engine/scene-payload-progress?token=${encodeURIComponent(token)}`);
    let prog;
    try { prog = JSON.parse(progRes.__state.body.toString('utf8')); } catch { prog = null; }
    // 上面已经真的拉过整包（200 全量 + Range）⇒ 账本必须记下"传过多少字节、走完几次"。
    check('账本记下这次传输（served ≥ 整包字节、completed ≥ 1、active 归零）',
      Boolean(prog) && prog.ok === true && prog.served >= pkgBytes.length && prog.completed >= 1 && prog.active === 0,
      prog ? JSON.stringify(prog) : 'bad json');
    check('账本带上整包体积（客户端据此把预算按包大小放大）',
      Boolean(prog) && prog.size >= pkgBytes.length, prog ? 'size=' + prog.size : '-');
    const unknownProg = await runHandler(progressRoute, '/wallpaper-engine/scene-payload-progress?token=bm90LWEtdG9rZW4');
    let unknownBody;
    try { unknownBody = JSON.parse(unknownProg.__state.body.toString('utf8')); } catch { unknownBody = null; }
    check('未知 token ⇒ ok:false（"没记账" ≠ "没在动"，客户端据此回落墙钟）',
      Boolean(unknownBody) && unknownBody.ok === false, unknownBody ? JSON.stringify(unknownBody) : 'bad json');
    // 老宿主没有这条路由时客户端必须静默退回墙钟：这里只钉"路由缺失不是崩溃源"的判据形态
    check('负对照：账本对"零传输"的 token 不给假进展（served=0）',
      Boolean(unknownBody) && unknownBody.served === 0 && unknownBody.completed === 0,
      unknownBody ? 'served=' + unknownBody.served : '-');
  }

  // Fence: encoded parent hops aiming at a file OUTSIDE the wallpaper dir
  // (5 hops up from …/431960/990001 to the fixture root; literal ../ would be
  // normalised away by `new URL()` before the handler ever sees it).
  const fenceUrl = `/wallpaper-engine/scene-files/${token}/%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fsecret.txt`;
  const fenceRes = await runHandler(filesRoute, fenceUrl);
  check('encoded ../../ escape fenced (403)', fenceRes.__state.status === 403, 'status=' + fenceRes.__state.status);

  const unknownRes = await runHandler(filesRoute, '/wallpaper-engine/scene-files/bm90LWF0b2tlbg/scene.pkg');
  check('unknown token → 404', unknownRes.__state.status === 404, 'status=' + unknownRes.__state.status);
  // 负对照：可重验证缓存**不得**把错误响应也放行（否则 Electron 会缓存住 404 错误页，
  // 之后即使文件到位也一直显示旧错误文本 —— 那是这条缓存策略唯一的已知风险）。
  check('负对照：404 仍 no-store',
    /no-store/.test(h(unknownRes, 'Cache-Control') || ''), h(unknownRes, 'Cache-Control'));

  // ── 目录围栏的第二层：**字面围栏不认识链接** ────────────────────────────────
  // `resolve()` + `startsWith` 只挡 `..`，而 `serveFile` 会跟随链接 ⇒ 只有第一层时
  // 目标并没有被真正钉在壁纸目录里。上面那条 encoded-escape 测的是**第一层**（字面路径），
  // 这里测**第二层**（`lstatSync` 拒链接 + `realpathSync.native` 包含性），两层各一条。
  // 真实建链接：Windows 用 junction（**不需要**开发者模式 / 管理员，故这一层在 CI 的
  // windows-latest 上真有覆盖），POSIX 用 dir 链接；file 链接两边都要权限，建不出来就
  // **显式记为平台跳过** —— 绝不静默当成通过。
  const dirLinkType = process.platform === 'win32' ? 'junction' : 'dir';
  // (a) 最终组件是链接：普通文件名，字面路径完全在界内，只有链接它才越界。
  const fileLinkName = 'escape-link.pkg';
  let fileLinkMade = false;
  try { symlinkSync(secretPath, join(workshopDir, fileLinkName), 'file'); fileLinkMade = true; } catch { /* 平台不允许 */ }
  if (fileLinkMade) {
    const linkRes = await runHandler(filesRoute, `/wallpaper-engine/scene-files/${token}/${fileLinkName}`);
    const linkBody = linkRes.__state.body.toString('utf8');
    check('指向界外的**文件链接** ⇒ 403（且没有读出 secret.txt）',
      linkRes.__state.status === 403 && linkBody.indexOf('top-secret') === -1,
      'status=' + linkRes.__state.status);
  } else {
    skip('指向界外的**文件链接** ⇒ 403（且没有读出 secret.txt）',
      '本机不允许创建文件符号链接（该层在此平台零覆盖）');
  }
  // (b) **中间目录**是链接：字面路径全在界内（没有 `..`），只有 realpath 能判出越界 ——
  // 这一条才是第二层的真牙齿：删掉 realpath 比对，它必然变红。
  const dirLinkName = 'escape-dir';
  let dirLinkMade = false;
  try { symlinkSync(fixtureRoot, join(workshopDir, dirLinkName), dirLinkType); dirLinkMade = true; } catch { /* 平台不允许 */ }
  if (dirLinkMade) {
    const viaDir = await runHandler(filesRoute, `/wallpaper-engine/scene-files/${token}/${dirLinkName}/secret.txt`);
    const viaBody = viaDir.__state.body.toString('utf8');
    check('中间目录是**指向界外的链接** ⇒ 403（字面路径全在界内，只有 realpath 判得出）',
      viaDir.__state.status === 403 && viaBody.indexOf('top-secret') === -1,
      'status=' + viaDir.__state.status);
    // 负对照（防空转）：同一目录里的**普通文件**照旧 200 ⇒ 上面两条 403 不是"一律拒绝"，
    // 新增的这一层没有把整个 /scene-files 变成 403。
    const plainRes = await runHandler(filesRoute, `/wallpaper-engine/scene-files/${token}/project.json`);
    check('负对照：同目录的普通文件不受新围栏影响（200）',
      plainRes.__state.status === 200, 'status=' + plainRes.__state.status);
  } else {
    // 两条判据（403 本体 + 「同目录普通文件仍 200」的防空转负对照）在这里**都**没执行 ⇒
    // 逐条记名，否则"未执行"的条数会比真实缺口少。
    skip('中间目录是**指向界外的链接** ⇒ 403（字面路径全在界内，只有 realpath 判得出）',
      '本机不允许创建目录链接 / junction（realpath 那层在此平台零覆盖）');
    skip('负对照：同目录的普通文件不受新围栏影响（200）',
      '同上：目录链接建不出来 ⇒ 这条对照与它要护的主判据一起不存在');
  }

  const nosubRes = await runHandler(filesRoute, `/wallpaper-engine/scene-files/${token}/`);
  check('missing subpath → 404', nosubRes.__state.status === 404, 'status=' + nosubRes.__state.status);
}

// ── 松散目录场景的 /scene-files 供文件链（WebWallGL 2.1.0 loose 形态）────────────
// 渲染器 auto 档先试 sceneDir：拉 <root>/project.json → file 以 .json 结尾 ⇒ loose，
// 再拉 <root>/<file>（入口 json）与同级素材。这里逐件钉 200 + 字节一致，并钉「目录里
// 没有 scene.pkg ⇒ 404」的负对照 —— 若 token→根 的映射坏了，auto 回退链就可能拿到
// 假 200，渲染器会按错误口径解析而不是失败。
if (filesRoute && looseFixture && looseFixture.sceneLiveSrc) {
  const lt = looseFixture.sceneLiveSrc;
  const loosePj = await runHandler(filesRoute, `/wallpaper-engine/scene-files/${lt}/project.json`);
  let loosePjOk = false;
  try { loosePjOk = loosePj.__state.status === 200 && JSON.parse(loosePj.__state.body.toString('utf8')).file === 'scene.json'; } catch { /* leave false */ }
  check('松散：project.json 200 + file=scene.json（渲染器的形态判据就在这个字段上）',
    loosePjOk, 'status=' + loosePj.__state.status);
  const looseEntry = await runHandler(filesRoute, `/wallpaper-engine/scene-files/${lt}/scene.json`);
  check('松散：入口 scene.json 200 + 字节一致',
    looseEntry.__state.status === 200 && looseEntry.__state.body.equals(looseSceneJson),
    'status=' + looseEntry.__state.status);
  const looseAsset = await runHandler(filesRoute, `/wallpaper-engine/scene-files/${lt}/main.tex`);
  check('松散：同级素材 main.tex 200 + 字节一致（sceneDir 的 read 就走这条）',
    looseAsset.__state.status === 200 && looseAsset.__state.body.equals(looseTexBytes),
    'status=' + looseAsset.__state.status);
  const loosePkg404 = await runHandler(filesRoute, `/wallpaper-engine/scene-files/${lt}/scene.pkg`);
  check('松散负对照：目录里没有 scene.pkg ⇒ 404（不是 200 的假容器）',
    loosePkg404.__state.status === 404, 'status=' + loosePkg404.__state.status);
}

// ── Level C3: web wallpapers over /scene-files ──────────────────────────────
// The strict-sandbox web path needs three host duties: inject the engine's WE
// shim into the HTML entry, serve subresources with correct MIME types (a CSS
// file as application/octet-stream is rejected by the browser), and allow
// opaque-origin fetches via CORS.
{
  // 回归闸门：道具入口必须在**场景**壁纸上也在。踩过的坑：inventory 条目先展开
  // sceneFieldsFor 再展开 webFieldsFor，两者都返回 propsUrl，后者的 null 把场景
  // 的值盖掉 —— 表现就是「场景壁纸没有壁纸属性按钮」。
  const inv = JSON.parse((await runHandler(invRoute, '/wallpaper-engine/inventory', FENCE_HEADERS)).__state.body.toString('utf8'));
  const sc = (inv.wallpapers || []).find((w) => w.id === '990001') || null;
  check('场景壁纸也带 propsUrl（属性入口不被 web 分支覆盖）',
    Boolean(sc && sc.propsUrl && sc.propsUrl.indexOf('/props/') > 0),
    sc ? String(sc.propsUrl || '(空)').slice(0, 52) : 'scene not found');
}

console.log('Level C3 — web wallpaper files (shim injection / MIME / CORS)');
let mediaEntry;   // C4 复用：C3 里从 inventory 拿到的那条入口 URL
{
  const res = await runHandler(invRoute, '/wallpaper-engine/inventory', FENCE_HEADERS);
  const body = JSON.parse(res.__state.body.toString('utf8'));
  const web = (body.wallpapers || []).find((w) => w.id === '990003') || null;
  check('web wallpaper listed with webLive + webLiveSrc',
    Boolean(web && web.webLive === true && web.webLiveSrc),
    web ? 'type=' + web.type + ' src=' + String(web.webLiveSrc || '').length + 'ch' : 'not found');
  // 入口 URL 必须是**媒体源绝对 URL**（host 自建的第二个 loopback 监听），
  // 而不是插件路由：Desktop 的能力头（x-dsh-desktop-renderer）栅栏拒绝不透明源
  //（严格沙箱 iframe）对插件路由的请求，网页壁纸载荷因此整体挪到我们自己的源；
  // 这条断言就是「网页壁纸全黑」形态的回归闸门。
  mediaEntry = String((web && web.webLiveSrc) || '');
  check('webLiveSrc 是媒体源绝对 URL（不再落回插件路由）',
    /^http:\/\/127\.0\.0\.1:\d+\/wallpaper-engine\/scene-files\//.test(mediaEntry),
    mediaEntry.slice(0, 76) || '(空)');
  if (web && web.webLiveSrc) {
    // 应用源挂载仍然存在（场景 pkg / 媒体源不可用时的回落）：去掉源后用同一条
    // 路径把同样的断言跑一遍，保证两处挂载行为一致。
    const entryUrl = mediaEntry.replace(/^http:\/\/127\.0\.0\.1:\d+/, '');
    const baseUrl = entryUrl.replace(/\/[^/]*$/, '');
    const htmlRes = await runHandler(filesRoute, entryUrl);
    const html = htmlRes.__state.body.toString('utf8');
    check('HTML entry served with shim injected',
      htmlRes.__state.status === 200 && /text\/html/.test(h(htmlRes, 'Content-Type'))
        && html.indexOf('data-we-shim="host"') !== -1,
      'status=' + htmlRes.__state.status + ' shim=' + (html.indexOf('data-we-shim') !== -1));
    // 标签在、体是空的也会过上一条：shim 正文来自 npm 包 webwallgl 的 bundle 提取，
    // 包缺失或 bundle 形态变化时提取静默得空串 —— 这里钉住正文真的到了页面。
    check('injected shim carries the engine shim body (extracted from the webwallgl package)',
      html.indexOf('__weShimInstalled') !== -1 && html.indexOf('__weSetPaused') !== -1,
      'body=' + (html.indexOf('__weShimInstalled') !== -1));
    // 帧级夺焦围栏：与 shim 同门控（就注在这一处），但**必须早于 seed** —— 晚于作者脚本就等于没装。
    // 这里打的是真响应体：证明 `weFocusGuardInstall.toString()` 取到的源码经 esc() 后原样到达页面。
    check('HTML entry carries the frame-focus guard (before the seed)',
      html.indexOf('data-we-focus-guard="host"') !== -1 && html.indexOf('__weFocusGuard') !== -1
        && html.indexOf('data-we-focus-guard') < html.indexOf('data-we-seed'),
      'guard=' + (html.indexOf('data-we-focus-guard') !== -1)
        + ' 顺序=' + html.indexOf('data-we-focus-guard') + '<' + html.indexOf('data-we-seed'));
    // 属性 seed：严格沙箱下渲染页读不到 iframe（无法运行时补推 __weApplyProps），
    // 属性只能由宿主随 HTML 注入 —— 漏掉它依赖属性的壁纸会画成默认（实测黑屏）。
    check('HTML entry carries the property seed from project.json',
      html.indexOf('data-we-seed="host"') !== -1 && html.indexOf('__weSeedProps') !== -1
        && html.indexOf('color0') !== -1,
      'seed=' + (html.indexOf('data-we-seed') !== -1));
    // 站点根声明：必须**早于 shim**（shim 首次解析 URL 前就要读到），值是 token 目录。
    // 不给它，spine 类壁纸（作者按官方语义写 `../assets/…`）会逃出条目目录 404 黑屏。
    check('HTML entry 声明站点根（token 目录、早于 shim）',
      html.indexOf('data-we-site-root="host"') !== -1
        && html.indexOf(`window.__weSiteRoot=${JSON.stringify(baseUrl + '/')}`) !== -1
        && html.indexOf('data-we-site-root') < html.indexOf('data-we-shim'),
      'root=' + (html.indexOf('__weSiteRoot') !== -1) + ' 顺序=' + html.indexOf('data-we-site-root') + '<' + html.indexOf('data-we-shim'));
    check('HTML entry advertises CORS for opaque origins',
      h(htmlRes, 'Access-Control-Allow-Origin') === '*', h(htmlRes, 'Access-Control-Allow-Origin'));
    const cssRes = await runHandler(filesRoute, `${baseUrl}/style.css`);
    check('stylesheet served as text/css (not octet-stream)',
      cssRes.__state.status === 200 && /text\/css/.test(h(cssRes, 'Content-Type')),
      h(cssRes, 'Content-Type'));
    const jsRes = await runHandler(filesRoute, `${baseUrl}/app.js`);
    check('script served as javascript',
      jsRes.__state.status === 200 && /javascript/.test(h(jsRes, 'Content-Type')),
      h(jsRes, 'Content-Type'));
  }
}

// ── Level C4: wallpaper media origin (real loopback listener) ───────────────
// C3 打的是 mock 出来的「应用源挂载」；这一层对**真实 socket** 打一轮：不透明源
//（Origin: null）能否取到入口、子资源 MIME、OPTIONS 预检、目录围栏、非本路由
// 404。Desktop 上网页壁纸能不能显示，完全取决于这个源。
console.log('Level C4 — 壁纸媒体源（真实 loopback 监听）');
{
  const moRoute = routes.find((r) => r.path === '/wallpaper-engine/media-origin');
  check('media-origin 诊断路由已注册', Boolean(moRoute));
  if (moRoute) {
    const moRes = await runHandler(moRoute, '/wallpaper-engine/media-origin');
    const mo = JSON.parse(moRes.__state.body.toString('utf8') || '{}');
    const base = String(mo.base || '');
    check('media-origin 上报可用源（127.0.0.1 + 随机端口）',
      /^http:\/\/127\.0\.0\.1:\d+$/.test(base), 'base=' + (base || '(空)'));
    if (base && mediaEntry) {
      const entryPath = mediaEntry.replace(/^http:\/\/127\.0\.0\.1:\d+/, '');
      const dirPath = entryPath.replace(/\/[^/]*$/, '');
      // 不透明源（严格沙箱 iframe）真实发出的请求就长这样：Origin: null。
      const opaque = await fetch(base + entryPath, { headers: { Origin: 'null' }, cache: 'no-store' });
      const opaqueHtml = await opaque.text();
      check('Origin: null 下入口 HTML 200 + shim/seed/焦点围栏注入 + CORS *',
        opaque.status === 200 && opaque.headers.get('access-control-allow-origin') === '*'
          && opaqueHtml.indexOf('data-we-shim="host"') !== -1
          && opaqueHtml.indexOf('data-we-focus-guard="host"') !== -1
          && opaqueHtml.indexOf('__weFocusGuard') !== -1
          && opaqueHtml.indexOf('data-we-seed="host"') !== -1,
        'status=' + opaque.status + ' acao=' + opaque.headers.get('access-control-allow-origin'));
      // 载荷改成可重验证缓存之后，入口 HTML 必须**仍然** no-store：它带注入的
      // shim + 用户属性种子，缓存住 = 把旧种子喂给壁纸。
      const htmlCc = opaque.headers.get('cache-control') || '';
      check('入口 HTML 仍 no-store（可重验证缓存只放行载荷本身）', /no-store/.test(htmlCc), htmlCc);
      const css = await fetch(base + dirPath + '/style.css', { cache: 'no-store' });
      check('子资源经媒体源可达（text/css）',
        css.status === 200 && /text\/css/.test(css.headers.get('content-type') || ''),
        'status=' + css.status + ' ' + css.headers.get('content-type'));
      const pre = await fetch(base + entryPath, { method: 'OPTIONS', cache: 'no-store' });
      check('OPTIONS 预检放行（204 + ACAO *）',
        pre.status === 204 && pre.headers.get('access-control-allow-origin') === '*',
        'status=' + pre.status + ' acao=' + pre.headers.get('access-control-allow-origin'));
      const fenced = await fetch(base + dirPath + '/%2e%2e%2f%2e%2e%2fsecret.txt', { cache: 'no-store' });
      const fencedBody = await fenced.text();
      check('媒体源同样受目录围栏保护（403 + 自解释体）',
        fenced.status === 403 && fencedBody.indexOf('forbidden-scene-files[') === 0,
        'status=' + fenced.status + ' body=' + fencedBody.slice(0, 32));
      const off = await fetch(base + '/wallpaper-engine/media-status', { cache: 'no-store' });
      check('媒体源只服务 /scene-files（其它路径 404）', off.status === 404, 'status=' + off.status);
      // ── 隐藏耦合：**mediaBase 同时是诊断信标的 origin** ─────────────────────────
      // 渲染页的 reportDiag() 打的是 `{mediaBase origin}/diag`（根路径，见 routes/diag.js
      // 引的 Kg()）。场景壁纸的 mediaBase 改成指向本媒体源之后，这个根路径若不在媒体源上
      // 也有落点，"大场景 pkg 首帧超时"时渲染页的告警会以 404 **静默丢掉** —— 而那正是
      // 排查现场唯一的内窗。所以这里对**真实 socket** 打一发信标，并要求它出现在
      // `/diag-log` 的**同一份**环形缓冲里（不是另起一份）。
      const beaconMsg = 'verify-scene-live: media-origin diag sink';
      const beacon = await fetch(base + '/diag?msg=' + encodeURIComponent(beaconMsg) + '&lvl=warn', { cache: 'no-store' });
      check('媒体源根路径 /diag 可达并收下信标（204）', beacon.status === 204, 'status=' + beacon.status);
      const logRoute = routes.find((r) => r.path === '/wallpaper-engine/diag-log');
      if (logRoute) {
        const logRes = await runHandler(logRoute, '/wallpaper-engine/diag-log', FENCE_HEADERS);
        let entries = [];
        try { entries = JSON.parse(logRes.__state.body.toString('utf8')).entries || []; } catch { /* 留空 = 判据变假 */ }
        check('媒体源上的告警落进**同一份**诊断缓冲（/diag-log 可回读）',
          entries.some((e) => String(e.msg || '').indexOf(beaconMsg) !== -1),
          'entries=' + entries.length);
        // 负对照（防空转）：没打过的信标不许被读到 ⇒ 上面那条不是"任何串都算命中"。
        check('负对照：未上报的信标读不到（判据不是恒真）',
          !entries.some((e) => String(e.msg || '').indexOf('never-reported-beacon') !== -1));
      } else {
        check('diag-log 路由已注册（否则上一条无从读取）', false, 'missing');
      }
    }
  }
}

// ── Level C5: 壁纸属性（project.json general.properties → 面板 / 种子）───────
// 「壁纸属性」面板读这条路由；写入走 settings（userProps），再由 buildSeedScript
// 并进 HTML 种子 —— 这里把整条链路验证到底。
console.log('Level C5 — 壁纸属性解析 / 覆盖值 → HTML 种子');
{
  const propsRoute = routes.find((r) => r.path === '/wallpaper-engine/props');
  const settingsRoute = routes.find((r) => r.path === '/wallpaper-engine/settings');
  check('props 路由已注册', Boolean(propsRoute));
  let token;
  {
    const inv = JSON.parse((await runHandler(invRoute, '/wallpaper-engine/inventory', FENCE_HEADERS)).__state.body.toString('utf8'));
    const web = (inv.wallpapers || []).find((w) => w.id === '990003') || null;
    token = String((web && web.propsUrl) || '').split('/').pop();
    check('inventory 给场景/网页壁纸带 propsUrl', Boolean(web && web.propsUrl), web ? String(web.propsUrl).slice(0, 48) : 'not found');
  }
  const pres = await runHandler(propsRoute, `/wallpaper-engine/props/${encodeURIComponent(token)}`);
  const pdata = JSON.parse(pres.__state.body.toString('utf8') || '{}');
  const byName = Object.fromEntries((pdata.props || []).map((p) => [p.name, p]));
  check('属性面板数据可取（含全部类型）',
    pres.__state.status === 200 && pdata.ok === true && (pdata.props || []).length === 6,
    'count=' + ((pdata.props || []).length) + ' status=' + pres.__state.status);
  check('editable:false 从面板隐藏（值照常下发）', !byName.internal);
  check('order 按浮点排序（2.5 落在 2 与 3 之间）',
    (pdata.props || []).map((p) => p.name).join(',') === 'color0,fpslock,size,mode,tip,extra',
    (pdata.props || []).map((p) => p.name).join(','));
  check('slider 带 min/max/step/precision',
    byName.size && byName.size.min === 0 && byName.size.max === 2 && byName.size.step === 0.05 && byName.size.precision === 2);
  check('combo 选项保留声明类型（数字 / 字符串混用）',
    byName.mode && byName.mode.options[0].value === 1 && byName.mode.options[1].value === '2',
    byName.mode ? JSON.stringify(byName.mode.options.map((o) => o.value)) : 'missing');
  check('文案逐键本地化回退 zh-chs',
    byName.size && byName.size.text === '尺寸' && byName.tip && byName.tip.text === '分节标题',
    byName.size ? byName.size.text : 'missing');
  check('text 类型是静态说明（无值）', byName.tip && byName.tip.value === null);
  check('condition 只随定义带出（面板按当前值求值）', byName.extra && byName.extra.condition === 'fpslock.value == true');

  // 覆盖值 → 种子：PUT 设置后，同一份 HTML 应当带上被改过的值
  const entryPath = '/wallpaper-engine/scene-files/' + token + '/index.html';
  const putRes = fakeRes();
  await settingsRoute.handler(fakeReqBody('/wallpaper-engine/settings', 'PUT', {
    userProps: { [token]: { color0: '0 1 0', size: 1.25 } },
  }), putRes);
  await waitRes(putRes);   // 「响应即已持久化」：等应答再读种子
  check('设置接受 userProps 覆盖值（白名单）', putRes.__state.status === 200, 'status=' + putRes.__state.status);
  const html2 = (await runHandler(filesRoute, entryPath)).__state.body.toString('utf8');
  check('覆盖值并进 HTML 种子（host 侧合并，网页壁纸不闪默认值）',
    html2.includes('__weSeedProps') && html2.includes('0 1 0') && html2.includes('1.25'),
    'seed=' + html2.includes('__weSeedProps'));
  const pdata2 = JSON.parse((await runHandler(propsRoute, `/wallpaper-engine/props/${encodeURIComponent(token)}`)).__state.body.toString('utf8'));
  const byName2 = Object.fromEntries((pdata2.props || []).map((p) => [p.name, p]));
  check('覆盖值在面板数据里标记为 overridden',
    byName2.color0 && byName2.color0.overridden === true && byName2.color0.value === '0 1 0');
  // 还原（同一份临时 config 后续断言还用它）
  const putBack = fakeRes();
  await settingsRoute.handler(fakeReqBody('/wallpaper-engine/settings', 'PUT', { userProps: {} }), putBack);
  await waitRes(putBack);
  const html3 = (await runHandler(filesRoute, entryPath)).__state.body.toString('utf8');
  check('清空覆盖值后种子回到默认（1 0 0）',
    html3.includes('1 0 0') && !html3.includes('0 1 0'));
}

// ── Level C2: custom storage (uploads) — WE project directories ─────────────
// The reported bug: pointing 存储位置 at a WallpaperEM-style downloads folder
// found none of its scene wallpapers (the old scanner only matched `up-*.ext`
// single files). The fixture (created before import) holds one WE project dir
// plus one legacy single-file upload.
console.log('Level C2 — custom storage scan (WE project dirs under uploads)');
{
  const sceneFrameRoute = routes.find((r) => r.path === '/wallpaper-engine/scene-frame');
  const res = await runHandler(invRoute, '/wallpaper-engine/inventory', FENCE_HEADERS);
  const body = JSON.parse(res.__state.body.toString('utf8'));
  const dirScene = (body.wallpapers || []).find((w) => w.id === 'up-dir-my-scene-1') || null;
  check('uploads WE project dir listed as scene', Boolean(dirScene), dirScene ? dirScene.type : 'not found');
  check('custom-storage scene takes its project.json title',
    Boolean(dirScene && dirScene.title === 'Custom Dir Scene'), dirScene ? dirScene.title : '-');
  check('custom-storage scene marked sceneLive + sceneLiveSrc',
    Boolean(dirScene && dirScene.sceneLive === true && dirScene.sceneLiveSrc),
    dirScene ? 'src len=' + String(dirScene.sceneLiveSrc || '').length : '-');
  // 回归：目录形态的上传必须把作者配色带进 inventory（见夹具里 schemecolor 的注释）。
  // 值走的是与 Steam 扫描同一条 schemeToCss（0–1 浮点三元组 → rgb()）。
  check('custom-storage scene carries the author scheme color (regression)',
    Boolean(dirScene && dirScene.schemeColor === 'rgb(29, 56, 84)'),
    dirScene ? String(dirScene.schemeColor) : '-');
  check('custom-storage scene has frameUrl + preview',
    Boolean(dirScene && dirScene.frameUrl && dirScene.preview),
    dirScene ? 'frameUrl=' + Boolean(dirScene.frameUrl) + ' preview=' + Boolean(dirScene.preview) : '-');
  const fileUp = (body.wallpapers || []).find((w) => w.id === 'up-fixture-image') || null;
  check('single-file upload still scanned alongside',
    Boolean(fileUp && fileUp.type === 'image' && fileUp.playable === true),
    fileUp ? fileUp.type + ' playable=' + fileUp.playable : 'not found');

  if (dirScene && dirScene.sceneLiveSrc) {
    const pkgRes = await runHandler(filesRoute, `/wallpaper-engine/scene-files/${dirScene.sceneLiveSrc}/scene.pkg`);
    check('custom-storage scene.pkg served via /scene-files',
      pkgRes.__state.status === 200 && pkgRes.__state.body.length > 1000,
      'status=' + pkgRes.__state.status + ' ' + pkgRes.__state.body.length + 'B');
  }
  if (dirScene && dirScene.frameUrl && sceneFrameRoute) {
    const frameRes = await runHandler(sceneFrameRoute, dirScene.frameUrl);
    // P2-12 之后 `/scene-frame` 只剩「实时抓帧 → 自定义画面 → 空」三级：这个 fixture 既没被
    // 抓过帧、也没导入自定义画面 ⇒ 必须是**诚实的空态**（404），而不是"替作者猜一张图"
    //（旧语义会在这里 CPU 解包一张静态帧并回 200）。
    check('custom-storage scene frame：无抓帧且无自定义画面 ⇒ 404 空态（不猜图）',
      frameRes.__state.status === 404,
      'status=' + frameRes.__state.status + ' ' + frameRes.__state.body.length + 'B');
  }
}

// ── Level D: client source contract ─────────────────────────────────────────
console.log('Level D — client source wiring (src/client.js + 抽出的模块)');
// 客户端源码现在是**三个文件**：逻辑（src/client.js）、注入的样式表（src/styles.js）、
// 实时渲染管线（src/live-layer.js）。Level D 的判据里既有 JS 结构断言、也有样式规则断言、
// 还有"跨文件的接线"断言（如"面板调用 + 被调函数里的门禁"）—— 所以三个来源都读出来，
// **各自用在对应的判据上**（不图省事拼成一个字符串：那样一个文件的文本就能满足另一个文件的
// 结构断言，判据会失去牙）。
const src = clientText();
// 快捷播放面板源码（类型筛选等面板本地行为的断言读它）。
// ⚠️ 这里**在定义点**统一剥掉文件末尾的 `export { … }`：本文件有两处把它喂给 `new Function`
// （模块级自由变量形态复现台），而 `new Function` 不是模块环境 ⇒ 不剥就是语法错误。
// 同一手法见 `test/verify-client.mjs` 的 effects 段；构建期内联时也是这么剥的。
const qpSrc = stripExportBlocks(readFileSync(join(root, 'src', 'quick-panel.js'), 'utf8'));
check('前置：qpSrc 已剥掉 `export { … }`（两处 new Function 依赖这条）',
  !/^\s*export\b/m.test(qpSrc), '残留 export ⇒ new Function 会当场语法错误');
// 同上，但**剥掉注释**：面板那条下钻的判据要找"最后一个 renderUserPropsPanel() 调用点"，
// 而文件头的散文里也写着这个名字（首个匹配落在注释里 ⇒ 判据恒真）。剥注释的共享实现见
// `test/tools/js-text.mjs`（本仓纪律：字符串感知的剥注释，不用朴素块注释正则）。
const qpCode = stripComments(qpSrc);
// 刀3：样式族已拆成 8 个域模块 + 组装点 ⇒ 取整族源码文本（构建序拼接）；判据不变。
const stylesSrc = styleText();
const liveSrc = liveText();
const prepSrc = readFileSync(join(root, 'src', 'media-prep.js'), 'utf8');
// 刀4：panel-tabs 已按域拆成 5 个兄弟模块 + 组装点 ⇒ 判"页签族的渲染/接缝"一律扫**并集**。
const tabsSrc = panelText();
// P-C：外观页签第六节「全局字体」的渲染器随字体包搬出页签族（packages/fonts/src/appearance-font-section.js）
// ⇒ 判"该节画什么 / 有没有 surface 门 / 有没有 ↺ / 解构了哪些 ctx 字段"的判据必须读
//    **页签族 + 包内那一节**的并集 —— 它们判的是行为口径，不是文件住处。
const fontSectionSrc = readFileSync(join(root, 'packages', 'fonts', 'src', 'appearance-font-section.js'), 'utf8')
  .replace(/\r\n/g, '\n');
const tabsSrcWithFontSection = tabsSrc + '\n;\n' + fontSectionSrc;
// 组装点自身：只喂给"8 个 render*Tab 声明在 src/panel-tabs.js"那条不变量（族并集会让它变弱）。
const tabsHubSrc = readFileSync(join(root, 'src', 'panel-tabs.js'), 'utf8');
// `fnBody` 的实现在 `test/tools/assert-harness.mjs`（`fnNameBody`，取首个 `\n}`；
// 与 `verify-client.mjs` 共用一份 —— 朴素截断是有意的契约，见该文件头）。
// resolveWallpaperFadeBg 自 P1-7 后半起住在 src/effects.js —— 断言改读该模块
// （函数体判据本身不变；同时钉住它**不在** src/client.js，防两边各留一份）。
const effectsSrc = readFileSync(join(root, 'src', 'effects.js'), 'utf8');
const fadeBgBody = fnBody(effectsSrc, 'resolveWallpaperFadeBg');
check('效果应用层已抽成独立模块并被内联',
  // 签名带可选 opts（拖动档 live，见 applyEffects 的文件头说明）⇒ 这里只认前缀。
  effectsSrc.includes('function applyEffects(') && effectsSrc.includes('function clearEffects()')
    && readFileSync(join(root, 'lib', 'client.js'), 'utf8').includes('function applyEffects(')
    && !src.includes('function applyEffects('));
// live 激活态（`selection.sceneLiveActive`）的判据共用一份"判据实现 + 归一化函数体"：
// 断言与它下面的负对照必须**跑同一个函数**，否则负对照证明不了断言有牙（本仓纪律）。
// ⚠️ 两处与既有 `fnBody` 不同的取舍，都是有具体原因踩出来的：
//   1) 归一化：源码是 CRLF，跨行字面量若写 `\n` 就会与 `\r\n` 错开 ⇒ 判据恒假。
//   2) `fnBody` 只切到**首个** `\n}` —— 对本文件常见的"函数头先来一行早退"
//      （`startLiveWatch` 开头就是 `if (!frame.isConnected) { … return; }`）会被截在
//      早退块上，函数主体根本不在切片里，判据恒假。所以这里用配平大括号取整段函数体，
//      并显式跳过字符串/模板串/行注释/块注释里的花括号（`'${…}'`、`"{"` 否则会算错深度）。
const liveFlagChecks = (() => {
  // 下面两个取法现在都由共享工具提供（`test/tools/assert-harness.mjs`）：CRLF 归一 +
  // 配平大括号取整段函数体（跳过字符串/模板串/注释里的花括号）。原来内联在这里的那份实现
  // 与本文件外（`verify-client.mjs`）的同类扫描是两份会各自漂的判据面，已合并成一份。
  const norm = normCrlf;
  const balancedBody = braceBody;
  // "模块顶层代码"提取器：把字符串/模板串/注释整段挖空，再把**函数体内部**（`function`
  // 关键字与块体箭头 `=> { }` 两种形态，本文件没有 class/方法简写）一并挖空 —— 留下的就是
  // "模块求值时就会跑"的那几行。判据用它回答「这条副作用是不是挂在模块作用域」。
  // ⚠️ 只挖**函数体**，不挖普通块：模块级的 `try { … } catch {}` / `if (…) { … }` 里的
  // 代码照样在模块求值时执行（历史上那三段模块级副作用正是包在顶层 `try{}catch{}` 里的，
  // 只按花括号配平深度会**漏判**，负对照就是钉这一点的）。
  const topLevelText = (source) => {
    const s = norm(source);
    let out = '', code = '', fnDepth = 0, mode = null;
    const stack = [];
    for (let i = 0; i < s.length; i++) {
      const c = s[i], n = s[i + 1];
      if (mode === 'line') { if (c === '\n') { mode = null; if (fnDepth === 0) out += '\n'; } continue; }
      if (mode === 'block') { if (c === '*' && n === '/') { mode = null; i++; } continue; }
      if (mode === 'single' || mode === 'double' || mode === 'tpl') {
        const close = mode === 'single' ? "'" : (mode === 'double' ? '"' : '`');
        if (c === '\\') { i++; continue; }
        if (c === close) mode = null;
        continue;
      }
      if (c === '/' && n === '/') { mode = 'line'; i++; continue; }
      if (c === '/' && n === '*') { mode = 'block'; i++; continue; }
      if (c === "'") { mode = 'single'; code = (code + ' ').slice(-300); continue; }
      if (c === '"') { mode = 'double'; code = (code + ' ').slice(-300); continue; }
      if (c === '`') { mode = 'tpl'; code = (code + ' ').slice(-300); continue; }
      if (c === '{') {
        const isFn = /(?:function\b[^{};]*|=>)\s*$/.test(code);
        stack.push(isFn);
        if (isFn) fnDepth++;
        code = (code + '{').slice(-300);
        continue;
      }
      if (c === '}') {
        if (stack.pop() === true) fnDepth--;
        code = (code + '}').slice(-300);
        continue;
      }
      code = (code + c).slice(-300);
      if (fnDepth === 0) out += c;
    }
    return out;
  };
  const prepBody = () => balancedBody(prepSrc, 'applySelection');
  const tickBody = () => balancedBody(liveSrc, 'startLiveWatch');
  const syncBody = () => balancedBody(liveSrc, 'syncLayers');
  // 模块顶层的"副作用调用"计数（只数这三个：它们是**加载即生效**的那一类；`createElement`
  // 之类留在顶层也无害，且判据的正则放宽会踩到 `topLevelText` 对解构参数/表达式体箭头的
  // 已知盲区，见文件内注释）。
  const trioCalls = (text) => (topLevelText(text).match(/\b(?:addEventListener|setInterval|setTimeout)\s*\(/g) || []).length;
  // 全 `src/**/*.js` 普查：本轮把同类第二处（`src/client.js` 的轮换恢复监听）也搬进 fiber 后，
  // 判据覆盖整棵树 —— 任何模块顶层的定时器/监听器都判红，而不是只钉 live-layer 一个文件。
  // 返回违规清单（空数组 = 干净），失败时能直接点名文件。
  const srcTreeOffenders = () => {
    const out = [];
    const walk = (dir) => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, ent.name);
        if (ent.isDirectory()) { walk(full); continue; }
        if (!ent.name.endsWith('.js')) continue;
        const n = trioCalls(readFileSync(full, 'utf8'));
        if (n > 0) out.push(full.slice(root.length + 1).replace(/\\/g, '/') + '×' + n);
      }
    };
    walk(join(root, 'src'));
    return out;
  };
  return {
    prepBody,
    tickBody,
    syncBody,
    // ① 同 id 重申不得清标志。判据只看**正常路径**（两道早退守卫之后的那一段）：
    // 两个 early-return 分支（id 为空 / 被过滤或条目消失）里的 `sceneLiveActive = false`
    // 是**正确**的清理 —— 那种情况下后面不会再同步任何层，清是对的；issue 归因的
    // `:10009` 就是正常路径那一行。所以：
    //   · 正常路径的 live 清零必须写成 `if (idChanged) …`；
    //   · 比较中间量 `idChanged` 必须在 `selection.id` 赋值**之前**声明；
    //   · 正常路径里**不得**再出现裸清零（旧写法正是此处一句裸赋值）。
    clearsOnlyOnIdChange: (body) => {
      const decl = body.indexOf('const idChanged = selection.id !== (id || "")');
      const assign = body.indexOf('selection.id = id || ""');
      const normal = body.slice(body.indexOf('if (!w || !keepPlayingWallpaper(w, selection.contentRatingFilter))'));
      const props = normal.indexOf('selection.propsUrl =');
      const live = normal.indexOf('selection.sceneLiveActive = false;');
      const indented = /(^|\n)[ \t]+selection\.sceneLiveActive = false;/.test(normal);
      return decl >= 0 && assign > decl && props >= 0 && live > props
        && indented && /if \(idChanged\) selection\.sceneLiveActive = false;/.test(normal);
    },
    prepDiagnostic: () => {
      const body = prepBody();
      const normal = body.slice(body.indexOf('if (!w || !keepPlayingWallpaper(w, selection.contentRatingFilter))'));
      return 'decl@' + body.indexOf('const idChanged = selection.id !== (id || "")')
        + ' assign@' + body.indexOf('selection.id = id || ""')
        + ' normalBody=' + normal.length
        + ' bareIndentedClear=' + /(^|\n)[ \t]+selection\.sceneLiveActive = false;/.test(normal)
        + ' guardedClear=' + /if \(idChanged\) selection\.sceneLiveActive = false;/.test(normal);
    },
    // ② 领养路径补挂：一整条**连续语句**必须同时含新 watch 校验、去延迟校验、
    // 「真的在播」与同源就绪判据，然后才置真 —— 允许换行/缩进，但必须是同一段。
    // 只断言"文件里出现过这些名字"是没有牙的（它们各自在别处也出现）。
    adoptRearms: (body) => /if \(!selection\.sceneLiveActive && watchHere && watchHere\.frame === liveFrame\s*\n\s*&& liveFrame\.isConnected && !liveFrameDeferred\(liveFrame\)[\s\S]{0,200}?&& liveHeartbeatReady\(liveFrame, liveStats\(liveFrame\), liveStateOf\(liveFrame\), selection\.type === "web"\)\) \{\s*\n\s*selection\.sceneLiveActive = true;/.test(body),
    // ③ 自愈必须挂在 `responsive` 上（真的在出帧才自愈），不能挂原来那个分支条件
    //（含 `|| !isEffectivelyPlaying()`，暂停期也走它，而暂停中的场景页 fps=0 ⇒
    // `alive` 恒为假 ⇒ 自愈失能），也不能写成"无条件置真"（暂停期会把**故意暂停**
    // 的渲染页标成 active，指针注入与媒体桥白热）。置真条件本身还必须带
    // `isEffectivelyPlaying()`：**网页**壁纸的 `alive` 只问 iframe 加载与否
    //（`iframeLoaded`），暂停期照样为真 —— 暂停语义只能由这一条补上（场景暂停期
    // `alive` 本就为假，此条对场景零影响）。置真之后只报一次诊断。
    // P3-5：这一条与领养补挂（②）共用**同一个类型判据**（`liveHeartbeatReady`），
    // 于是顺手钉住"唯一来源"——函数体只能有一份、两个调用点都必须过它。
    tickHeals: (body) => body.includes('if (responsive) {')
      && !/if \(responsive \|\|/.test(body)
      && /if \(alive && isEffectivelyPlaying\(\) && liveHeartbeatReady\(frame, stats, wstate\) && !selection\.sceneLiveActive\) \{\s*\n\s*selection\.sceneLiveActive = true;/.test(body)
      && /if \(!watch\.rearmed\) \{\s*\n\s*watch\.rearmed = true;/.test(body)
      && body.includes('liveLog("live-rearm"'),
    // ④ P3-5 唯一来源：类型判据只有一份函数体（`function liveHeartbeatAlive(...)`），
    // 别名 `liveHeartbeatReady` 指向它，两个看护点（心跳自愈 / 领养补挂）都必须过它。
    // 若谁日后把条件内联回去（两只眼睛各写各的），这里立刻判红 —— 那正是这条缝的复发形态。
    // 计数取 2 调用点（心跳自愈 + 领养补挂）；本判据要喂**全文件**源码（`liveSrc`），
    // 只喂 `tickBody()` 会把领养那处漏在窗口外、等于半个判据。
    heartbeatSingle: (body) => (body.match(/function liveHeartbeatAlive\s*\(/g) || []).length === 1
      && /const liveHeartbeatReady = liveHeartbeatAlive;/.test(body)
      && (body.match(/liveHeartbeatReady\(/g) || []).length === 2
      && !/function\s+liveHeartbeatReady/.test(body),
    // `src/live-layer.js` 的 `export { … }` 块里**只许出现本文件真的声明过的名字**。
    // 背景（本轮顺手发现的既存缺陷）：`retireFadingLayer` / `nudgeWallpaperRepaint` 两个名字
    // 其实住在 `src/layer-core.js`，却被抄进了这张导出表 —— 内联构建把整块 `export` 剥掉、
    // 又把两个文件并进同一个作用域，所以调用点照样解析、`lib/client.js` 一切正常；
    // 但"导出自己没声明的名字"在任何**真** ESM 语境下都是链接期错误
    // （`node --check src/live-layer.js` 报 `Export 'nudgeWallpaperRepaint' is not defined in module`）。
    exportListHonest: (body) => {
      const block = body.match(/export\s*\{([\s\S]*?)\};/);
      if (!block) return false;
      // 注释先剥掉再按逗号切 —— 否则块内一行 `// …` 注释会把后面的名字连成一块，
      // 拼进 `new RegExp` 就是一条非法正则（写这条判据时踩过）。
      return block[1].replace(/\/\/[^\n]*/g, ' ').split(',').map((s) => s.trim()).filter(Boolean)
        .map((s) => s.split(/\s+as\s+/)[0].trim())
        .filter((n) => /^[A-Za-z_$][\w$]*$/.test(n))
        .filter((n) => !(new RegExp('(^|\\s)(?:function|async\\s+function|const|let|var|class)\\s+' + n + '\\b')).test(body))
        .length === 0;
    },
    // 模块作用域静默（本轮修的契约违规；现场与原文见 `src/live-layer.js` 的
    // `installLiveDiagnostics` 与 `src/client.js` 的 `installRotationResumeListeners` 注释）：
    // `addEventListener` / `setInterval` / `setTimeout` **不许出现在模块顶层** —— 宿主每次
    // revision 变化都会 `tearDownEntryFiber` 后用新模块体重跑一遍，模块级副作用不挂 fiber ⇒
    // 旧实例的定时器/监听器永不释放（实测同一 document 214 个页 id、一次真实的 window blur
    // 被 117 份实例各记一条）。它们必须住在随 `ctx.effect` 注册/注销的安装器里。这条判据
    // 既对单个源文件用（`moduleScopeQuiet`），也由 `srcTreeOffenders` 铺满 `src/**/*.js`：
    // 现场是**两处同型泄漏**（live-layer 的诊断 + client.js 的轮换恢复监听），只钉一个文件
    // 就会漏掉另一处。历史形态与"已搬进函数"的形态在负对照里各喂一遍（两处各喂）。
    moduleScopeQuiet: (body) => trioCalls(body) === 0,
    // 全树普查的结果（`src/**/*.js`），供主判据用。
    srcTreeOffenders,
    // 安装器必须真的接进 `apply` 的 `ctx.effect`。否则"搬进函数"只是换个地方永不注销：
    // 没人调用它 ⇒ 连一条留痕都没有、`bootRestore` 也不再被交互翻假，那比模块级更糟。
    // 只认这一种接线形态（一条 `ctx.effect` 一个安装器）；三个安装器缺一不可 ——
    // 漏掉 `installRotationResumeListeners` 会让"隐藏期轮换推迟到可见时补做"永远不触发
    // （隐藏过再回来就不轮换了），漏掉前两个会让诊断留痕与「重启恢复」整段失效。
    installersWired: (clientSrc) => /ctx\.effect\(\(\) => installLiveDiagnostics\(\) \|\| undefined\)/.test(clientSrc)
      && /ctx\.effect\(\(\) => installLiveBootRestore\(\) \|\| undefined\)/.test(clientSrc)
      && /ctx\.effect\(\(\) => installRotationResumeListeners\(\) \|\| undefined\)/.test(clientSrc),
    topLevelText,
    installerBody: () => balancedBody(liveSrc, 'installLiveDiagnostics'),
  };
})();
const clientChecks = [
  // live 优先与 sceneVideo 让位都发生在 **buildMedia** 里（已抽到 media-prep.js）。
  ['live is the top priority for scenes and web', /const isLive = \(sel\.type === "scene" \|\| sel\.type === "web"\) && liveRenderEnabled\(sel\)/.test(prepSrc)],
  ['sceneVideo yields to live', /Boolean\(sel\.sceneVideo\) && !isLive/.test(prepSrc)],
  ['web wallpapers force the strict sandbox', /webSandbox=strict/.test(liveSrc)],
  ['heartbeat watchdog exists', /function startLiveWatch/.test(liveSrc) && /LIVE_FIRST_FRAME_MS/.test(liveSrc)],
  // P4-15：这条接线从 panel-tabs.js 挪进了 client.js 的 `onToggleSceneLive`（渲染器只调处理器）。
  // 两端都钉：处理器真的清了失败记忆，且面板确实引用那个处理器。
  ['failure memory persists', /function onToggleSceneLive\(e\)[\s\S]*?setSetting\("sceneLiveFailures", \{\}\)/.test(src)
    && /function liveFail/.test(liveSrc) && /onToggleSceneLive/.test(tabsSrc)],
  ['audio mux honours live', /!selLike\.sceneLiveActive/.test(src)],
  ['syncLayers key carries live state', /"live\\u0000" \+ \(selection\.sceneLiveSrc \|\| selection\.webLiveSrc\)/.test(liveSrc)],
  // sceneVideo 只在**非 live** 形态下进 key：live 生效时 buildMedia 已把 isSceneVideo
  // 短路，把 sceneVideo 算进 key 会让「sceneVideo 诚实化的时序补拉」
  //（scheduleSceneVideoResync 落地时 sceneVideo 由 null 变 URL）在 live 播放中
  // 冷启动一次渲染页 —— 无意义重建，用户会看到画面重新加载。
  ['sceneVideo stays out of the layer key while live renders',
    /\(layerLive \? "" : \(selection\.sceneVideo \|\| ""\)\)/.test(liveSrc)],
  // 同 id 的 revalidate 不得拆掉待挂载的预热页。`loadInventory() → revalidateSelection() →
  // applySelection(selection.id)` 传进来的就是当前选中项，而那份 pending 正是**本次要用的**
  // 那一个；无条件 `cancelLiveMount("selection")` 会把它清成 `about:blank` 并且此后没有任何人
  // 恢复（`liveMountPending` 已空、看护器只在挂载成功路径上武装）⇒ 图层永久停在垫底图。
  // 判据钉**机制**：那记取消必须被"新旧 id 不等"包住，且比较必须发生在 `selection.id` 赋值
  // **之前**（赋值之后两边永远相等，守卫会失效）。
  // ⚠️ 这是一次**时序竞态**（`SCENE_VIDEO_RESYNC_MS` 与 `liveBootDelay` 撞在同一时刻、主线程被
  // pkg 解码占住时预热页先输），源码与合成 DOM 判据看不见它 —— 这条只钉住结构不退回，
  // 运行期的复现证据是诊断里的 `boot-mount-cancel reason=selection` + `beat · liveOn=0 watch=-`。
  ['a same-id revalidate does not tear down the pending live mount',
    (() => {
      const body = fnBody(prepSrc, 'applySelection');
      // 判据钉「新旧 id 不等」这个**中间量**，而不是它的内联写法：同一个 `idChanged`
      // 还守卫着下面的 `sceneLiveActive` 清理（见下一条），两处必须共用一次比较
      // —— 各写各的迟早会漂移。声明必须在 `selection.id` 赋值**之前**（赋值之后
      // 两边永远相等，守卫会失效）。
      const guard = body.indexOf('const idChanged = selection.id !== (id || "")');
      const use = body.indexOf('if (idChanged) cancelLiveMount("selection")');
      const assign = body.indexOf('selection.id = id || ""');
      const bare = body.includes('\n    cancelLiveMount("selection")');
      return guard >= 0 && use > guard && assign > guard && !bare;
    })(),
    (() => {
      const body = fnBody(prepSrc, 'applySelection');
      return 'guard=' + body.indexOf('const idChanged = selection.id !== (id || "")')
        + ' use=' + body.indexOf('if (idChanged) cancelLiveMount("selection")')
        + ' assign=' + body.indexOf('selection.id = id || ""')
        + ' bareCall=' + body.includes('\n    cancelLiveMount("selection")');
    })()],
  // **实测**症状：切换会话（或设置里对**同一张**壁纸重新 apply 一次）之后壁纸照播，
  // 但不再响应鼠标 —— Scene 的指针视差 / 点击交互、Web 页里的指针效果全部静默失效，
  // 只有整页重载才恢复；因为画面照动，用户只会觉得「壁纸有时候坏了」。
  // 机制：`revalidateSelection()` / 设置页重选都会以**同一个 id** 再次进 `applySelection`，
  // 而这条清零点原来是无条件的。同 id 时层键（`wantKey`，不含版本/时间戳）一字不差
  // ⇒ `syncLayers` 走 `adopt-live` 领养分支：渲染页不重载、首帧门也不会重走，于是
  // 标志永久停在 false，而消费点**全是提前 return**（`livePointerFlush` /
  // `livePointerSample` 挡住指针注入、`startMediaSync` 的 1s 拍挡住音频频谱与
  // Now Playing），`we-live-on` 类与垫底图早就是终态所以画面看不出异常。
  // 清零点只保留「真的换图」；同 id 的**真**重建（live 开关 / fps 档 / 媒体源变化
  // ⇒ 键变化）由 `syncLayers` 的 `layer-rebuild` 分支 `stopLiveWatch()` 负责清。
  ['the live-active flag is only cleared when the selection id really changes',
    liveFlagChecks.clearsOnlyOnIdChange(liveFlagChecks.prepBody()),
    liveFlagChecks.prepDiagnostic()],
  // 领养那一跳立刻补挂（不等心跳）：同 id 重新 apply 时 `syncLayers` 不重建层，
  // 但标志可能已被清 —— 这里按**与心跳自愈逐字同源**的就绪判据（`liveHeartbeatReady`，
  // 类型分型住在 `liveHeartbeatAlive`）把语义补回来，否则指针注入与媒体桥要等到下一拍
  //（≤1s）才恢复，且若 `responsive` 恰好为假就永远不恢复。
  // P3-5 修正：原先这里用 `liveFrameReady`，它对**网页**要求 `getState` 可读 ⇒ 可达到底
  // 但还没 load 完的窗口恒 false，而心跳那边早在认这帧 —— 两只眼睛答案不同，缝就出在
  // 那里。合成一处后两边对同一帧答案逐字相同。
  // 时序：本块在 `adopt-live` 分支的 `startLiveWatch` **之后** —— 新 watch 的
  // `firstFrame` 要等一秒后的首拍，所以这里以「这一拍就有帧」直接判定，不等那一拍。
  ['adopting the same live layer re-arms the active flag',
    liveFlagChecks.adoptRearms(liveFlagChecks.syncBody()),
    (() => {
      const body = liveFlagChecks.syncBody();
      return 'syncBody=' + body.length
        + ' guardChain=' + /if \(!selection\.sceneLiveActive && watchHere && watchHere\.frame === liveFrame/.test(body)
        + ' rearm@' + body.indexOf('selection.sceneLiveActive = true;');
    })()],
  // （推荐，兜底）心跳自愈：这个标志的语义就是「渲染页活着且应在播」，而它全文件的
  // **唯一**置真点是首帧门 —— 那扇门一辈子只走一次。把语义的**唯一权威**放回心跳这
  // 一层，任何现在或将来漏掉的清零点都会被下一拍纠回来。分支进 `responsive`、**不**挂
  // 原来的分支条件：分支条件含 `|| !isEffectivelyPlaying()`，暂停期也走它，而暂停中的
  // 场景页 fps=0 ⇒ `alive` 恒为假（挂分支条件则自愈失能）；但**置真本身**必须再带
  // `isEffectivelyPlaying()` —— 网页壁纸的 `alive` 只问 iframe 加载与否，暂停期也为真，
  // 不补这条就会在暂停期把**故意暂停**的网页渲染页标成 active（指针注入 / 媒体桥白热）。
  // 详见该处注释；负对照在下方合成源码上验证这条判据真的会红。
  ['the heartbeat self-heals the active flag while the frame is really alive',
    liveFlagChecks.tickHeals(liveFlagChecks.tickBody()),
    (() => {
      const body = liveFlagChecks.tickBody();
      return 'tickBody=' + body.length
        + ' heal@' + body.indexOf('if (alive && isEffectivelyPlaying() && liveHeartbeatReady(')
        + ' rearmed@' + body.indexOf('if (!watch.rearmed)')
        + ' responsiveBranch=' + body.includes('if (responsive) {');
    })()],
  // P3-5 唯一来源：类型判据只能有一份函数体，两个看护点（心跳自愈 / 领养补挂）都必须
  // 过别名 `liveHeartbeatReady`。若谁日后把条件内联回去（两只眼睛各写各的），这里立刻
  // 判红 —— 那正是这条缝的复发形态。
  ['both live guards share one aliveness predicate',
    liveFlagChecks.heartbeatSingle(liveSrc),
    (() => {
      return 'aliveBodies=' + (liveSrc.match(/function liveHeartbeatAlive\s*\(/g) || []).length
        + ' alias=' + liveSrc.includes('const liveHeartbeatReady = liveHeartbeatAlive;')
        + ' callSites=' + (liveSrc.match(/liveHeartbeatReady\(/g) || []).length;
    })()],
  // 导出表只列自己声明过的名字（见 `exportListHonest` 的注释）。历史形态
  // （把 `layer-core.js` 的 `retireFadingLayer` 抄进来）也在负对照里钉一遍。
  ['live-layer exports only names it declares',
    liveFlagChecks.exportListHonest(liveSrc),
    (() => {
      const block = liveSrc.match(/export\s*\{([\s\S]*?)\};/);
      const names = block ? block[1].split(',').map((s) => s.trim()).filter(Boolean).length : -1;
      return 'exportedNames=' + names;
    })()],
  // 诊断留痕的安装面（本轮修复）：`src/live-layer.js` 的**模块顶层**不许有定时器/监听器
  // 副作用，且安装器必须经 `apply` 的 `ctx.effect` 接线 —— 两条缺一不可（只有前者 ⇒ 留痕
  // 永不启动；只有后者 ⇒ 旧实例的定时器照旧留在页面里）。判据与负对照见 `moduleScopeQuiet`。
  ['live diagnostics install with the fiber, not at module scope',
    liveFlagChecks.moduleScopeQuiet(liveSrc),
    (() => {
      const top = liveFlagChecks.topLevelText(liveSrc);
      const hits = (top.match(/(?:addEventListener|setInterval|setTimeout)\s*\(/g) || []).length;
      const body = liveFlagChecks.installerBody();
      return 'moduleScopeCalls=' + hits + ' installerBody=' + body.length
        + ' unregisters=' + (body.match(/removeEventListener\(/g) || []).length
        + ' clears=' + (body.match(/clear(?:Timeout|Interval)\(/g) || []).length;
    })()],
  ['the live-layer installers are wired into apply through ctx.effect',
    liveFlagChecks.installersWired(src),
    (() => 'installers@client=' + (src.match(/installLiveDiagnostics|installLiveBootRestore|installRotationResumeListeners/g) || []).length)()],
  // 同类第二处（`src/client.js` 的轮换恢复监听）搬进 fiber 之后的**全树**判据：`src/**/*.js`
  // 任何模块顶层的定时器/监听器都判红。这条把"只修一个文件"挡住 —— 现场正是两处同型泄漏。
  ['no src module registers timers or listeners at module scope',
    liveFlagChecks.srcTreeOffenders().length === 0,
    (() => { const off = liveFlagChecks.srcTreeOffenders(); return 'offenders=' + (off.length ? off.join(' ') : 'none'); })()],
  // 垫底静态帧是 iframe 的**下层**：只要 iframe 半透明（壁纸透明度一高），它就会以
  // a(1−a) 的强度透出来（实测「壁纸透明度高时显现静态帧」）。首帧点亮后必须整块退场，
  // 且必须**串行**——延迟到 iframe 淡入（1.8s）完成后再快收。若退回与 iframe 同步
  // 双淡出，两个半透明层互换会让黑底在中点漏出 ~25%（层底是原生纯黑/纯白），实测
  // 症状「切换完成后整屏呼吸式变暗后恢复」会复发。
  ['the static-frame underlay retires once the live frame is on',
    /:has\(\.we-live-iframe\.we-live-on\) \.we-live-poster\s*\{[^}]*opacity:\s*0/.test(stylesSrc)
    && /:has\(\.we-live-iframe\.we-live-on\) \.we-live-poster\s*\{[^}]*transition:\s*opacity\s+0\.3s\s+ease\s+1\.8s/.test(stylesSrc)],
  // 淡出底色必须是**原生外观**（纯黑/纯白），不能是主题面板色 —— 否则拉高「壁纸
  // 透明度」会露出一块与原生外观不符的主题色（用户实测反馈）。
  ['the wallpaper fade base is the native black/white, not the panel token',
    fadeBgBody.includes('--dsw-alias-bg-base')
    && /"#000000" : "#ffffff"/.test(fadeBgBody)
    && !fadeBgBody.includes('--dsw-alias-bg-layer-1')],
  // 画面来源选项的三条门禁：
  // - 「壁纸画面刷新」换的是 **CPU 静态帧**，实时画面在跑时它没有任何作用 → 只在
  //   live 未生效时渲染；
  // - 「实时帧」（GPU 抓帧：重新截 / 清除 / 微缩预览）与「自定义画面」**live 开着时
  //   同样显示** —— 那张静帧正是切换途中与 live 首帧前给用户看的画面，构图不对时
  //   必须能立刻重抓，而不是先关掉实时渲染；导入截图与 live 也互不干扰。
  ['CPU frame-variant row shows only while live is not effective',
    /sel\.type === "scene" && sel\.sceneFrameUrl && !liveRenderEnabled\(sel\)/.test(tabsSrc)],
  ['live-frame (GPU capture) row is NOT gated on the live switch',
    /sceneWithFrame && \(gpuPinnedHere \|\| liveRenderEnabled\(sel\)\)/.test(tabsSrc)],
  ['custom-frame row is NOT gated on the live switch',
    /sel\.type === "scene" && React\.createElement\("div", \{ className: "we-picker__ctl" \}/.test(tabsSrc)],
  // 「重新截」= force 重抓：必须走「先抓帧 + 内容门禁 → 成功后才清旧帧」的安全顺序，
  // 抓不到时不许把原来那张删掉（面板上给失败原因）。
  ['manual re-capture forces a fresh capture through the safe path',
    // 跨文件接线：面板（client.js）发起 force 重抓；"先抓帧 + 内容门禁 → 成功后才清旧帧"
    // 的安全顺序在被调的 scheduleLiveFrameBackfill 里（live-layer.js）。
    /scheduleLiveFrameBackfill\(live, \{ force: true \}\)/.test(src)
    && /const stale = force \|\| \(hasGpu && areaRef > 0/.test(liveSrc)],
  // 微缩预览必须指向层里正在用的那个 URL（同档位）+ 缓存破坏参数。
  ['frame preview points at the live layer URL',
    /function framePreviewSrc\(selLike\)[\s\S]{0,500}?frameUrlWithVariant\(selLike && selLike\.sceneFrameUrl, v\)[\s\S]{0,200}?we-prev=/.test(src)],
  ['pointer injection wired', /__wp\.pushPointer|wp\.pushPointer/.test(liveSrc) && /pointerLeave/.test(liveSrc)],
  ['fit mapping table present', /SCENE_LIVE_FIT = \{ cover: "cover"/.test(liveSrc)],
  // **实测**：渲染页 resume() 会 resetFrameMeter，心跳若每秒无条件调 resume 会永远读到
  // fps=0 → 15s 误降级。控制必须去重下发，且 tick 内先读统计再应用控制。
  ['controls are deduped before dispatch', /liveApplied\.playing !== playing/.test(liveSrc)],
  ['heartbeat reads stats before applying controls', /const stats = liveStats\(frame\);\s*\n\s*applyLiveControls\(frame\);/.test(liveSrc)],
  ['upload management list excludes project dirs', /isUploadedWallpaper\(w\) && !isDirWallpaper\(w\)/.test(src)],
  // 帧率取证（「限了 30 还卡」时唯一能分清「壁纸自身掉帧」与「整页掉帧」的手段）
  ['live fps probe reports ui / web / rnd to the diag channel',
    liveSrc.includes('function reportLiveFps') && liveSrc.includes('"live-fps"')
      && liveSrc.includes('function takeUiFps') && liveSrc.includes('wstate.webFps')],
  // 网页壁纸的 src 直用 host 给的绝对 URL（媒体源）；相对形态仅作回落。
  ['web live src reuses the absolute media-origin URL', liveSrc.includes('const webEntry = String(selLike.webLiveSrc || "")')
    && liveSrc.includes('/^https?:\\/\\//i.test(webEntry)')],
  // **实测**症状：「场景类壁纸正常几秒就失效」「网页也是」「失效以后是静态的」
  // 「只有扩展模式」「网页类是预览图」。成因是 extended 的「首帧后延迟 8000ms 换元」自救：
  // 换元后的新元素为防白闪被摘掉 `we-live-on`，层回落垫底图（场景=静态帧、网页=预览图），
  // 而渲染页照旧出声；日志上 first-frame-ok 后**正好 +8s** 出现 live-frame-rebuilt。
  // 该 workaround 的前提（启动期 iframe 永不上屏）已不成立 ⇒ 改成 **opt-in**。
  ['extended frame swap is opt-in (default off) — it is the "几秒后失效" 病因',
    /function useExtendedFrameSwap\(\)/.test(liveSrc)
    && /extendedFrameSwap = String\(rawFlag\)\.toLowerCase\(\) === "1";/.test(liveSrc)
    && /if \(desktopWindowMode\(\) === "extended" && !liveFrameRebuildTimer && useExtendedFrameSwap\(\)\) \{/.test(liveSrc)],
];
for (const [name, ok] of clientChecks) check(name, ok);
// 负对照：**没有开关的**换元调用点（旧写法）喂给同一判据必须被判不合格 —— 否则这条断言
// 只要文件里出现 `we-ext-swap` 字样就会通过，等于没有牙。
{
  const swapIsOptIn = (s) => /if \(desktopWindowMode\(\) === "extended" && !liveFrameRebuildTimer && useExtendedFrameSwap\(\)\) \{/.test(s);
  const ungated = 'if (desktopWindowMode() === "extended" && !liveFrameRebuildTimer) {';
  check('negative control: the ungated extended swap call site is rejected', swapIsOptIn(ungated) === false);
  check('positive control: the current client gates the extended swap', swapIsOptIn(liveSrc) === true);
}
// 负对照：live 激活态的三条判据都必须有牙 —— 把**修复前**的写法喂给同一判据
// （`liveFlagChecks`，与上面三条断言跑的是同一个函数），必须被判不合格；
// 否则这些断言只是"文件里出现过某个变量名"就通过。
{
  // ① 修复前的正常路径：`selection.propsUrl = …` 之后一句**裸**清零（没有 id 守卫）。
  // 早退分支里的裸清零是**正确**的，不得被这条判据连带判红 —— 所以判据只看正常路径。
  const oldNormalPath = 'function applySelection(id, opts) {\n'
    + '  const idChanged = selection.id !== (id || "");\n'
    + '  if (idChanged) cancelLiveMount("selection");\n'
    + '  selection.id = id || "";\n'
    + '  if (!selection.id) { selection.sceneLiveActive = false; return; }\n'
    + '  const w = selection.inventory.wallpapers.find((x) => x.id === selection.id);\n'
    + '  if (!w || !keepPlayingWallpaper(w, selection.contentRatingFilter)) {\n'
    + '    selection.propsUrl = null;\n'
    + '    selection.sceneLiveActive = false;\n'
    + '    return;\n'
    + '  }\n'
    + '  selection.propsUrl = w.propsUrl;\n'
    + '  selection.sceneLiveActive = false;\n'
    + '}';
  check('negative control: the unguarded normal-path live-flag clear is rejected',
    liveFlagChecks.clearsOnlyOnIdChange(oldNormalPath) === false
    && liveFlagChecks.clearsOnlyOnIdChange(liveFlagChecks.prepBody()) === true);
  // ② 领养补挂：把同源就绪判据（`liveHeartbeatReady`）/ `!liveFrameDeferred` /
  // `isEffectivelyPlaying` 拿掉任何一项，或整块挪到 `ensureLivePointer` 之前的旧形态，
  // 都必须被拒。这里拿掉的是"这一拍真的就绪"那一项。
  const oldAdopt = liveFlagChecks.syncBody()
    .replace(/\n\s*&& liveHeartbeatReady\(liveFrame, liveStats\(liveFrame\), liveStateOf\(liveFrame\), selection\.type === "web"\)/, '');
  check('negative control: a readiness-blind re-arm is rejected',
    liveFlagChecks.adoptRearms(oldAdopt) === false
    && liveFlagChecks.adoptRearms(liveFlagChecks.syncBody()) === true);
  // ③ 自愈判据的两种退化形态：退回**分支条件**（含 `|| !isEffectivelyPlaying()`，
  // 暂停期也走 ⇒ 场景 fps=0 时自愈失能）、以及"无条件置真"（暂停期把故意暂停的
  // 渲染页标成 active）。两者都必须被拒。
  const tickHead = '  const responsive = isWeb ? Boolean(wstate || stats) : alive;\n';
  const oldBranch = tickHead
    + '  if (responsive || !isEffectivelyPlaying()) {\n'
    + '    if (alive && !selection.sceneLiveActive) { selection.sceneLiveActive = true; }\n'
    + '  }';
  const unconditional = tickHead
    + '  if (responsive) {\n'
    + '    selection.sceneLiveActive = true;\n'
    + '  }';
  check('negative control: the paused-branch / unconditional self-heal shapes are rejected',
    liveFlagChecks.tickHeals(oldBranch) === false && liveFlagChecks.tickHeals(unconditional) === false
    && liveFlagChecks.tickHeals(liveFlagChecks.tickBody()) === true);
  // ④ P3-5 唯一来源：把两处看护判据**各自内联回各自的写法**（心跳那拍不看 fps 是否
  // 真的在出帧、领养那跳退回 `liveFrameReady` 的可达性口径），正是这条缝的复发形态 ——
  // 必须被 `heartbeatSingle` 拒。
  const splitEyes = liveSrc
    .replace(/const liveHeartbeatReady = liveHeartbeatAlive;/, 'const liveHeartbeatReady = () => true;');
  check('negative control: two guards with their own aliveness predicate are rejected',
    liveFlagChecks.heartbeatSingle(splitEyes) === false
    && liveFlagChecks.heartbeatSingle(liveSrc) === true);
  // ⑤ 导出表诚实性的负对照：造两份"抄了别人名字"的合成源码，`exportListHonest` 必须拒；
  // 喂真源码必须收（否则这条判据只会恒真）。
  const ghostExport = 'function realOne() {}\nexport {\n  realOne, notDeclaredAnywhere,\n};\n';
  const ghostExportHistorical = 'function realOne() {}\nexport {\n  realOne, retireFadingLayer, nudgeWallpaperRepaint,\n};\n';
  check('negative control: an export list naming undeclared symbols is rejected',
    liveFlagChecks.exportListHonest(ghostExport) === false
    && liveFlagChecks.exportListHonest(ghostExportHistorical) === false
    && liveFlagChecks.exportListHonest('function realOne() {}\nexport {\n  realOne,\n};\n') === true
    && liveFlagChecks.exportListHonest(liveSrc) === true);
  // ⑥ 模块级副作用（本轮修复）的负对照：把历史上那三段**模块级**副作用造回来（boot 记时的
  // `setTimeout` / `window` 的 focus·blur 监听 / 60s `setInterval`），`moduleScopeQuiet` 必须拒；
  // 同时喂"同样三个调用但住在函数里"的形态必须收 —— 否则判据只是"文件里没有这三个词"。
  const moduleScopeOld = 'function liveLog(tag) { /* 留痕 */ }\n'
    + 'try {\n'
    + '  setTimeout(function () { liveLog("client-boot"); }, 0);\n'
    + '} catch { /* ignore */ }\n'
    + 'try {\n'
    + '  window.addEventListener("focus", function () { liveLog("window-focus"); });\n'
    + '  window.addEventListener("blur", function () { liveLog("window-blur"); });\n'
    + '  document.addEventListener("visibilitychange", function () { liveLog("tab-hidden"); });\n'
    + '  window.setInterval(function () { liveLog("beat"); }, 60000);\n'
    + '} catch { /* ignore */ }\n';
  const moduleScopeInstalled = 'function installLiveDiagnostics() {\n'
    + '  const bootTimer = setTimeout(function () {}, 0);\n'
    + '  const beatTimer = setInterval(function () {}, 60000);\n'
    + '  window.addEventListener("blur", function () {});\n'
    + '  return function () { clearTimeout(bootTimer); clearInterval(beatTimer); };\n'
    + '}\n';
  check('negative control: module-scope timers/listeners are rejected while the installed shape passes',
    liveFlagChecks.moduleScopeQuiet(moduleScopeOld) === false
    && liveFlagChecks.moduleScopeQuiet(moduleScopeInstalled) === true
    && liveFlagChecks.moduleScopeQuiet(liveSrc) === true,
    'old=' + liveFlagChecks.moduleScopeQuiet(moduleScopeOld)
    + ' installed=' + liveFlagChecks.moduleScopeQuiet(moduleScopeInstalled)
    + ' live=' + liveFlagChecks.moduleScopeQuiet(liveSrc)
    + ' moduleScopeCalls=' + ((liveFlagChecks.topLevelText(liveSrc)
      .match(/(?:addEventListener|setInterval|setTimeout)\s*\(/g) || []).length));
  // 接线判据的负对照：模块级直调安装器（没进 ctx.effect）必须被拒 —— 那正是"搬进函数却
  // 永不注销"的形态；只接一个、漏掉 `bootRestore` 那个也必须被拒。喂真源码必须收。
  const bareInstall = 'if (typeof document !== "undefined") { installLiveDiagnostics(); installLiveBootRestore(); }';
  const halfWired = 'ctx.effect(() => installLiveDiagnostics() || undefined);';
  check('negative control: calling the installers outside ctx.effect is rejected',
    liveFlagChecks.installersWired(bareInstall) === false
    && liveFlagChecks.installersWired(halfWired) === false
    && liveFlagChecks.installersWired(src) === true,
    'bare=' + liveFlagChecks.installersWired(bareInstall)
    + ' half=' + liveFlagChecks.installersWired(halfWired)
    + ' src=' + liveFlagChecks.installersWired(src));
  // ⑦ 同类第二处的负对照：`src/client.js` 历史上那对**模块顶层**的轮换恢复监听（顶层
  // `try { document.addEventListener("visibilitychange"…); window.addEventListener("focus"…) }`）
  // 必须被判据拒；同一对监听搬进返回 disposer 的安装器后必须收。只把三个安装器接了两个
  // （漏 `installRotationResumeListeners`）也必须被接线判据拒。
  const clientModuleScopeOld = 'let rotationPendingHidden = false;\n'
    + 'function resumePendingRotation() { rotationPendingHidden = false; }\n'
    + 'try {\n'
    + '  document.addEventListener("visibilitychange", resumePendingRotation);\n'
    + '  window.addEventListener("focus", resumePendingRotation);\n'
    + '} catch { /* ignore */ }\n'
    + 'function installRotationResumeListeners() {\n'
    + '  document.addEventListener("visibilitychange", resumePendingRotation);\n'
    + '  return function () { document.removeEventListener("visibilitychange", resumePendingRotation); };\n'
    + '}\n';
  check('negative control: the rotation-resume listeners are rejected at module scope too',
    liveFlagChecks.moduleScopeQuiet(clientModuleScopeOld) === false
    && liveFlagChecks.moduleScopeQuiet(src) === true
    && liveFlagChecks.srcTreeOffenders().length === 0,
    'clientOld=' + liveFlagChecks.moduleScopeQuiet(clientModuleScopeOld)
    + ' clientNow=' + liveFlagChecks.moduleScopeQuiet(src)
    + ' treeOffenders=' + liveFlagChecks.srcTreeOffenders().length
    + ' topLevelCalls=' + ((liveFlagChecks.topLevelText(clientModuleScopeOld)
      .match(/(?:addEventListener|setInterval|setTimeout)\s*\(/g) || []).length));
  const rotationUnwired = 'ctx.effect(() => installLiveDiagnostics() || undefined);\n'
    + 'ctx.effect(() => installLiveBootRestore() || undefined);\n';
  check('negative control: wiring two of the three installers is rejected',
    liveFlagChecks.installersWired(rotationUnwired) === false
    && liveFlagChecks.installersWired(src) === true,
    'two=' + liveFlagChecks.installersWired(rotationUnwired)
    + ' src=' + liveFlagChecks.installersWired(src)
    + ' rotationWires=' + (src.match(/ctx\.effect\(\(\) => installRotationResumeListeners\(\) \|\| undefined\)/g) || []).length);
}
// ── Level D3: 首帧看护的"按进展判超时" + 载荷延迟/暂停 + 失败分因 ──
// 现场：320MB/94MB 的 `scene.pkg` 在**三个客户端实例**同时挂载时
// 传输被饿死，可见那个实例 15s 后 `stats={"fps":0,"running":false}`（一帧都没出）→ 被判
// 「首帧超时」并写进**共享**失败记忆（所有窗口一起降级），而渲染器单独跑同一份包只要 1–2s。
// 四条修正各配一条判据 + 负对照；判据只看真实代码行（注释由共享 stripComments 剥掉）。
{
  const code = stripComments(liveSrc);
  // ① 预算由包大小放大 + 有硬上限（不是固定 15s 墙钟）
  check('首帧预算按 scenePkgBytes 放大，且封顶 LIVE_FIRST_FRAME_MAX_MS',
    /function liveFirstFrameBudget\(/.test(code) && /scenePkgBytes/.test(code)
      && /Math\.min\(LIVE_FIRST_FRAME_MAX_MS, scaled\)/.test(code)
      && /const LIVE_FIRST_FRAME_MAX_MS = \d+/.test(code));
  // ② 传输有进展 ⇒ 每拍重置计时（与"暂停期不计时"同一条纪律）
  check('载荷有进展就不计超时（loadingTicks + startedAt 重置）',
    /if \(livePayloadFlowing\(watch\)\) \{\s*\n\s*watch\.loadingTicks \+= 1;\s*\n\s*watch\.startedAt = Date\.now\(\);/.test(code)
      && /function livePayloadFlowing\(watch\)/.test(code)
      && /LIVE_PAYLOAD_STALL_MS/.test(code));
  // ③ 账本读数三态分离（issue #129）：HTTP 200 + ok:false = 账本**明确**没见过这个 token
  //    （本实例的取包根本没到宿主）→ 标 payloadUnseen，归因时按传输侧；请求失败（旧宿主
  //    404 / 断网）⇒ payload=null 且不标 unseen → 归因退回墙钟原语义。
  check('账本读数三态：ok:false 标 payloadUnseen；请求失败仍是未知（退回墙钟）',
    /if \(!d \|\| d\.ok !== true\) \{/.test(code)
    && /if \(d && d\.ok === false\) watch\.payloadUnseen = true;/.test(code)
    && /\.catch\(\(\) => \{ watch\.payloadPolling = false; \}\)/.test(code)
    && /SCENE_PAYLOAD_PROGRESS_PATH/.test(code));
  // ④ 隐藏/不播时不拉载荷：建层延迟 + 中途摘 src + 可见时补回（三条都在）
  check('隐藏/不播的实例不拉载荷（建层延迟 + 中途暂停 + 可见时补回）',
    /if \(liveFrameShouldDefer\(\)\) \{\s*\n\s*frame\.dataset\.weLiveSrc = url;/.test(code)
      && /function suspendLivePayload\(frame, watch\)/.test(code)
      && /frame\.src = "about:blank";/.test(code)
      && /function armDeferredLiveFrame\(frame\)/.test(code)
      && /armDeferredLiveFrame\(liveFrame\);/.test(code));
  // ⑤ 延迟载荷的帧不得被"空白文档的 load"武装心跳（那会白烧一个预算窗口 → 误判超时）
  check('空白文档（载荷暂停）不武装心跳：load 与三处直接武装都过 liveFrameDeferred',
    /if \(frame\.isConnected && !liveFrameDeferred\(frame\)\) startLiveWatch\(frame, sel\.id\);/.test(code)
      && /if \(!liveFrameDeferred\(frame\)\) \{ try \{ startLiveWatch\(frame, sel\.id\); \} catch/.test(code)
      && (code.match(/!liveFrameDeferred\(/g) || []).length >= 4);
  // ⑥ 失败分因（issue #129 收紧后）：归"渲染侧"（落盘）必须先有**本看护窗口内**的整包
  //    完成证据 —— 账本跨实例累积，completed>0 可能只是别的窗口很久以前传完的；
  //    没有窗口内证据（含账本明确 unseen）一律按传输侧软失败。stall 同级：失焦/被遮挡
  //    窗口的"无帧"不是"渲染不出来"的证据，同样只进会话内。
  check('失败分因：落盘要有窗口内整包证据；unseen/stall 都走会话内软失败',
    /function liveFailCauseOf\(watch\)/.test(code)
      && /if \(!p\) return watch && watch\.payloadUnseen \? "transfer" : "";/.test(code)
      && /if \(p\.active > 0\) return "transfer";/.test(code)
      && /if \(p\.completed - s\.completed <= 0\) \{/.test(code)
      && /watch\.payloadStart = \{ served, completed: watch\.payload\.completed \};/.test(code)
      && /cause === "transfer" \|\| reason === "stall"/.test(code)
      && /liveSessionFailures\.set\(wid, softReason\)/.test(code)
      && /function scheduleLiveTransferRetry\(wid, attempts\)/.test(code)
      && /LIVE_TRANSFER_RETRY_LIMIT/.test(code)
      && /LIVE_TRANSFER_RETRY_DELAY_MS/.test(code));
  check('软失败自动重试认一切会话内软失败（stall 也走重试，不只 transfer）',
    /if \(!liveSessionFailures\.has\(String\(wid\)\)\) return;/.test(code));
  check('出首帧即清软失败与重试计数（否则一次抖动会永久压着这张壁纸）',
    /liveSessionFailures\.delete\(watch\.wid\);/.test(code) && /liveTransferAttempts\.delete\(watch\.wid\);/.test(code));
  // ⑦ 层键带 mediaBase：宿主把媒体源端出来之后必须重建（否则旧渲染页一直用陈旧的源）
  check('层键含 sceneMediaBase（源变化 ⇒ 重建到媒体源）',
    /selection\.inventory\.sceneMediaBase\) \|\| ""\)/.test(code));
  // ⑧ 软失败重试前刷库存（本实例的 inventory 可能粘在"媒体源起来之前"的空串上）
  check('软失败重试前刷库存（粘住的空串是传输饿死的常见成因）',
    /if \(!\(selection\.inventory && selection\.inventory\.sceneMediaBase\)\) \{\s*\n\s*try \{ loadInventory\(\); \}/.test(code));
  // ⑨ client-boot 必须延迟一拍（顶层读 selection 会撞 TDZ，实测 0 行落盘）
  check('client-boot 延迟一拍上报（顶层读 selection 会被 TDZ 静默吞掉）',
    /setTimeout\(function \(\) \{\s*\n\s*try \{\s*\n\s*liveLog\("client-boot"/.test(code));
  // ⑩ 显式重试（面板重开开关）必须把会话内软失败一起清掉 —— 否则「重开开关可重试」
  //    这条逃生门对传输类失败不成立（它不在设置里，页面上看不见却拦着 live）。
  check('显式重试同时清会话内软失败（跨文件接线：面板 → 处理器 → clearLiveSessionFailures）',
    /function clearLiveSessionFailures\(\)/.test(code)
      && /liveSessionFailures\.clear\(\)/.test(code)
      // P4-15：调用点从 panel-tabs.js 挪进 client.js 的 `onToggleSceneLive`。**两端都要在**
      //（面板引用处理器 + 处理器真的清）：只钉一端就漏掉了"把另一端删掉"这种回归。
      && /function onToggleSceneLive\(e\)[\s\S]*?clearLiveSessionFailures\(\);/.test(src)
      && /onToggleSceneLive/.test(tabsSrc));
  // ⑪ 失败记忆的**管线身份**：旧管线的 timeout 断言不许跨管线复用 —— 它是面板那行
  //    「实时渲染失败（…）」的唯一来源，实测会让"宿主半没重载 + 客户端已更新"看起来毫无作用。
  check('失败记忆带管线身份，换管线作废一次（bundle 变 / 媒体源从无到有）',
    /function migrateStaleLiveFailures\(\)/.test(code)
      && /migrateStaleLiveFailures\(\);/.test(code)
      && /function livePipelineChanged\(\)/.test(code)
      && /String\(prev\.build \|\| ""\) !== now\.build\) return "build"/.test(code)
      && /Number\(prev\.media\) === 0 && now\.media === 1\) return "media"/.test(code)
      && /rememberLivePipeline\(\)/.test(code)
      && /LIVE_DIAG_BUILD = "d8"/.test(code));
  // 记录失败时必须**记住管线身份**，否则下次启动会把这条管线自己挣来的记忆当陌生管线清掉。
  check('记录失败时写下管线身份（否则自己的记忆会被下一次启动清掉）',
    /map\[wid\] = reason === "stall" \? "stall" : "timeout";[\s\S]{0,400}?rememberLivePipeline\(\);/.test(code));
  // 负对照：把"单向"改成双向（媒体源消失也清）⇒ 同一条判据变假。
  const oneWayPredicate = (s) => /Number\(prev\.media\) === 0 && now\.media === 1\) return "media"/.test(s)
    && !/Number\(prev\.media\) === 1 && now\.media === 0/.test(s);
  const twoWay = code.replace('Number(prev.media) === 0 && now.media === 1',
    'Number(prev.media) === 1 && now.media === 0');
  check('负对照：把单向判据改成双向（源一抖动就抹掉真实失败记忆）会被判红',
    twoWay !== code && oneWayPredicate(twoWay) === false && oneWayPredicate(code) === true);
  // 负对照：把"按进展重置"那两行换成旧的固定墙钟写法 ⇒ 同一条判据变假
  const flowingOk = (s) => /if \(livePayloadFlowing\(watch\)\) \{\s*\n\s*watch\.loadingTicks \+= 1;/.test(s);
  const degraded = code.replace(/if \(livePayloadFlowing\(watch\)\) \{\s*\n\s*watch\.loadingTicks \+= 1;\s*\n\s*watch\.startedAt = Date\.now\(\);\s*\n\s*\}/,
    '/* 旧写法：照常计时 */');
  check('负对照：退回固定墙钟（不看进展）会被同一条判据判红',
    degraded !== code && flowingOk(degraded) === false && flowingOk(code) === true);
}
// ── Level D2: 实时管线抽模块的结构契约（抽出来之后钉住）─────────────────────
// 契约的可核对形式：
//   · 管线**只在 live-layer.js 里**（client.js 不得再留一份同名实现）；
//   · 它对 client.js 的跨模块**写**为零 —— 唯一一处曾被外部翻转的状态（liveDiagOn）
//     必须走 toggleLiveDiag() 入口；
//   · 必须登记进 INLINE_MODULES **且真的进了产物**（防孤儿：文件在却不进 bundle）。
{
  const build = readFileSync(join(root, 'scripts', 'build-client.mjs'), 'utf8');
  const bundle = readFileSync(join(root, 'lib', 'client.js'), 'utf8');
  const MOVED = ['function startLiveWatch(', 'function syncLayers()', 'function scheduleLiveFrameBackfill(',
    'function liveLog(', 'function createLiveFrame('];
  const stillInClient = MOVED.filter((m) => src.includes(m));
  check('实时管线只在 src/live-layer.js（client.js 不留第二份）', stillInClient.length === 0,
    stillInClient.join(' ') || '搬走了 ' + MOVED.length + ' 个入口');
  check('client.js 对管线状态零跨模块写（liveDiagOn 必须走入口）',
    !/^\s*liveDiagOn\s*=/m.test(src) && !/^\s*liveDiagOn\s*=/m.test(tabsSrc)
    // P4-15：入口调用点从 panel-tabs.js 挪进 client.js 的 `onToggleLiveDiag`（渲染器只调处理器）。
    && /function onToggleLiveDiag\(\) \{ toggleLiveDiag\(\); emit\(\); \}/.test(src)
    && /onToggleLiveDiag/.test(tabsSrc));
  // ── 视频壁纸走**独立通道**（`src/video-layer.js`），不走实时那条路 ──────────────────
  // 现场（实测）：视频档此前过实时管线的切层内容闸门 ⇒ 整次切换（含过场）被推迟到首个
  // 可解码帧（源越大 / 帧率上限越高越久，十几秒）。正解不是调阈值，而是给视频一条自己的
  // 通道：就绪判据 = 海报**已加载** / 首帧 / 预算，且没画面时旧壁纸留屏（绝不露层底色 ——
  // 改成"poster 属性存在即放行"时出现过"十几秒纯色"，那正是这条注释要防的）。
  {
    const CH = readFileSync(new URL('../src/video-layer.js', import.meta.url), 'utf8');
    const LIVE = liveText();
    check('视频通道有独立的就绪判据 videoContentReady（海报已加载 / 首帧）',
      CH.includes('function videoContentReady(video)')
      && CH.includes('__wePosterReady === true')
      && CH.includes('Number(video.readyState) >= 2'));
    check('视频通道必须探海报**加载**，不是只看属性存在',
      CH.includes('function probeVideoPoster(') && CH.includes('img.onload'));
    check('视频通道有兜底预算（拿不到海报也要能换下去 —— ⑥ 后它与执行器一起在通道里）',
      CH.includes('VIDEO_POSTER_BUDGET_MS') && CH.includes('setTimeout(stallGuard, VIDEO_POSTER_BUDGET_MS)'));
    // 真机取证：旧行为"预算到期就放行"会在 `<video>` rs=0 时把层放上屏，
    // 屏上只剩这一层底色（用户看到"纯色帧"，实测 1–2 秒起）。判据：预算这一路**只许在
    // 屏上真有画面时放行**，停滞到上限就停手留旧壁纸，绝不放行空层。
    // 审计收口（合并 PR #128 后）：自续期链的取消句柄必须是读最新 id 的
    // cancelStall 闭包 —— 快照 id 清不掉在途下一跳，连切时遗留 tick 会把下一层的空层推上屏；
    // 且链上放行只许经 recheck（video 有画面 ≠ 层有画面，Edge canvas 还要等第一笔）。
    check('兜底预算不得放行空层（停滞只留旧壁纸，不铺底色）',
      CH.includes('const stallGuard = () => {')
      && /videoContentReady\(video\) \|\| video\.__weReady === true/.test(CH)
      && CH.includes('VIDEO_STALL_GIVE_UP_MS')
      && /waited >= VIDEO_STALL_GIVE_UP_MS[\s\S]{0,400}?video-stall/.test(CH)
      && CH.includes('cancelStall')
      && LIVE.includes('p.cancelStall')
      && !CH.includes('budget: posterGiveUp')
      && !LIVE.includes('clearTimeout(p.posterGiveUp)'));
    // 真机取证：**只有设了「帧率上限」时才会再看到纯色帧** —— 抽帧就绪
    // 那一刻在在屏元素上 `src=transcoded; load()` 会清掉当前帧。判据：自动升级不许在"已上屏"
    // 的层上换源（推到下一次建层直接用抽帧版），只有"层还被闸门押着"或"用户刚主动改过上限"
    // 才当场换。
    check('抽帧升级不在已上屏的层上换源（换源＝清掉当前帧＝纯色）',
      CH.includes('function layerStillPending(')
      && /if \(!layerStillPending\(\) && !upgradeByUser\)[\s\S]{0,400}?selection\.transcodeReady = \{ token, fps: cap, url: transcodedUrl \}/.test(CH)
      && /useCached \? rc\.url : sel\.url/.test(CH)
      && /upgradeByUser = Date\.now\(\) - capChangedAt < 5000/.test(CH));
    // ── ① 提交前预热：把"取数"挪出切换的关键路径 ───────────────────────────────
    // 实测：宿主+磁盘 ~4ms、loadedmetadata→presented ~110ms，其余是"还没开始取数"；
    // 视频档此前刻意不跑准备链（怕第二个 4K 解码器）⇒ 整段启动成本压在关键路径上。
    // 折中＝只预到 HAVE_METADATA：**绝不 play()、绝不开 autoplay**。
    check('① 提交前预热只到元数据（不引进第二个解码器）',
      CH.includes('const VIDEO_WARM_TTL_MS')
      && CH.includes('el.preload = "metadata"')
      && CH.includes('el.autoplay = false')
      && !/el\.play\(/.test(CH)
      && CH.includes('function consumeWarmVideo(')
      && CH.includes('function warmVideoForPointer(')
      // 赋 src 已经启动资源选择，**不得**再补一次 load()（同值重启 = 白跑一次取数）。
      && !/el\.src = u;\s*\n\s*el\.load\(\);/.test(CH)
      && CH.includes('const warmed = prepared ? null : consumeWarmVideo(sel.url);')
      // 领养的元素**不得重赋 src**（同值重赋也会重启资源选择 = 黑屏闪烁源）：
      // 建层那段"设 src / 挑抽帧版"只对新建元素生效。
      && CH.includes('if (!prepared && !warmed) {'));
    check('① 预热的触发点是卡片身份标记（按下即预热、停在卡上也预热）',
      src.includes('warmVideoForPointer')
      && src.includes('addEventListener("pointerdown", onWarmPointerDown, { capture: true, passive: true });')
      && src.includes('addEventListener("pointerover", onWarmPointerOver, { capture: true, passive: true });')
      && CH.includes('VIDEO_WARM_HOVER_MS')
      && src.includes('disposeWarmVideo();')
      && readFileSync(join(root, 'src', 'picker-modal.js'), 'utf8').includes('"data-we-id": String(w.id)')
      && readFileSync(join(root, 'src', 'quick-panel.js'), 'utf8').includes('"data-we-id": String(w.id)'));
    // faststart：从"落盘变体"改成"服务期虚拟布局"（磁盘 0），以及"字节布局不得中途改换"。
    //   · 真机取证（当时加的临时插桩，已随该次提交删除）：播放器对 `Range: bytes=0-` 会
    //     **顺流整读**，moov 在尾部的源于是要读到文件末尾才报元数据，耗时 ∝ 文件大小
    //     （764MB/1761ms … 97MB/324ms）—— 把 moov 挪到头部即解。
    //   · 旧做法 = 用 ffmpeg `-c copy -movflags +faststart` 落一份**与源等大**的副本
    //     （本机实测 5 张 = 1570MB；卡在 8GB 上限之下永不淘汰）。新做法 = 只把 moov 搬到
    //     mdat 之前、并给每条 `stco`/`co64` 整体 `+len(moov)`，字节**在服务期按段表合成**
    //     （lib/mp4-vfs.js）：总长不变、内容逐字节等价（真机 framemd5 视频+音频与源全等），
    //     磁盘 0，且这条路上不再需要 ffmpeg。
    //   · 原片与虚拟布局的**字节偏移不同**，同一次播放里绝不能前半段读原片、后半段读虚拟
    //     布局（解复用器会按旧偏移读新布局 ⇒ 花屏/解码失败）。所以 /media 的选片必须经
    //     `pinnedFaststartVariant`（第一次请求定音）——它现在钉的是"这一份播放用不用虚拟布局"。
    //     ⚠️ 这条判据跨四个文件：**定音机制**在 `lib/faststart.js`（模块级 `MEDIA_CHOICE_PIN`
    //     ＋ `pin.at = now` 续期），**布局数学**在 `lib/mp4-vfs.js`，**服务期合成**在
    //     `lib/serve.js`，**消费点**在 `lib/routes/media-bytes.js`。
    const faststartLib = readFileSync(join(root, 'lib', 'faststart.js'), 'utf8');
    const vfsLib = readFileSync(join(root, 'lib', 'mp4-vfs.js'), 'utf8');
    const mediaBytesFam = readFileSync(join(root, 'lib', 'routes', 'media-bytes.js'), 'utf8');
    // 服务面与接线面的源文本就地读：本文件别处的同名常量声明在更后面（TDZ）。
    const serveLib = readFileSync(join(root, 'lib', 'serve.js'), 'utf8');
    // ⚠️ 合成宿主面：门面 + 内核段 + P0 拆出的模块。**不要**只读 lib/index.js ——
// 判据自己的纪律是"每新增一个从 apply() 拆出的模块必须加进来"，否则该模块里的接线会被误报丢失。
// 例：`createMp4VfsKit({ appendDiagLine })` 随 P0 库化搬进 lib/kernel/host-session.js。
const hostLibComposed = ['lib/index.js',
  ...readdirSync(join(root, 'lib', 'kernel')).filter((f) => f.endsWith('.js')).map((f) => 'lib/kernel/' + f),
  'lib/mp4-vfs.js', 'lib/faststart.js', 'lib/diag-trace.js']
  .map((f) => { try { return readFileSync(join(root, f), 'utf8'); } catch { return ''; } }).join('\n');
const hostLib = hostLibComposed;
    check('① 视频字节布局：同一 token 钉住同一份布局，且"搬家"改为服务期合成（磁盘 0、不跑 ffmpeg）',
      faststartLib.includes('function pinnedFaststartVariant(')
      && faststartLib.includes('const MEDIA_CHOICE_PIN = new Map();')
      // 钉子命中必须**续期**（审计）：循环壁纸一次播放远超 TTL，固定窗口会在
      // 会话中途（seek/重缓冲触发新 Range 请求时）换字节布局。
      && faststartLib.includes('pin.at = now;')
      && /pinnedFaststartVariant\(abs, token, log\)/.test(mediaBytesFam)
      && /serveLayout\(pick\.layout, pick\.abs, req, res, method === 'HEAD'\)/.test(mediaBytesFam)
      // 布局数学：moov 搬 mdat 前 + 两条 chunk 偏移表整体平移（缺一条就不是"等价搬家"）。
      && vfsLib.includes('export function analyzeMp4Layout(')
      // moov 上限：钉"值本身 + 强制执行点"，而不是 export 关键字（该常量本轮起不再对外导出：零消费者）。
      && /const MP4_VFS_MAX_MOOV_BYTES = 8 \* 1024 \* 1024;/.test(vfsLib)
      && /moov\.size > MP4_VFS_MAX_MOOV_BYTES\) return \{ kind: 'none', reason: 'moov-too-big' \};/.test(vfsLib)
      && vfsLib.includes("'stco'") && vfsLib.includes("'co64'")
      && vfsLib.includes('mdat.start')
      // 服务期合成：段表 → Range 切片（单段文件/内存段/跨段三条路都要在）。
      && serveLib.includes('function serveLayout(')
      && serveLib.includes('function layoutRangeStream(')
      // 接线：分析器先建、喂给 faststart；启动时一次性回收旧版落盘副本。
      && hostLib.includes('createMp4VfsKit({ appendDiagLine })')
      && hostLib.includes('sweepLegacyFaststartVariants()')
      // 负对照（防止旧实现留着让上面判据蒙过去）：落盘副本那条路整条消失。
      && !/'-c', 'copy', '-movflags', '\+faststart'/.test(faststartLib)
      && !faststartLib.includes('FASTSTART_CACHE_MAX_BYTES')
      && !faststartLib.includes('touchFaststart(')
      && !/serveFile\(fast \|\| abs/.test(mediaBytesFam)
      // 虚拟布局这条路**只读不写**：不落盘、不起进程（磁盘 0 与"CI 无 ffmpeg 也能跑"都靠这条）。
      && !/\bffmpeg\b/i.test(stripComments(vfsLib))
      && !/writeFileSync|createWriteStream|spawn\(/.test(stripComments(vfsLib)));
    check('实时管线的视频分支委托给通道，而不是自己下判据',
      LIVE.includes('return videoContentReady(video);'));
    // ── 视频通道的**符号围栏**（目标 ①：先造判据再搬家）──────────────────────────
    // 通道的价值就是"实时专属的东西一件都不过去"。搬家期间它是安全网：每搬一块进来，
    // 立刻检查这块有没有把实时符号带过来。两个方向都要防：
    //   · 围栏 —— 通道文件里不得出现清单里的任何符号；
    //   · **反空转地板** —— 清单里的符号必须仍真实存在于实时模块（否则有人改名之后，
    //     围栏就成了"查一堆不存在的名字"，永远绿）。
    const CHANNEL_FILES = ['../src/video-layer.js', '../src/layer-core.js'];
    const LIVE_ONLY = [
      'liveRenderEnabled', 'liveRenderUrl', 'applyLiveControls', 'startLiveWatch', 'stopLiveWatch',
      'liveFail', 'liveFrameEl', 'buildLivePoster', 'scheduleLiveMount', 'createLiveFrame',
      'cancelLiveMount', 'retainFrameBytes', 'releaseFrameBytes', 'paintFrame',
      'probeWallpaperOnScreen', 'layerContentReady', 'armLayerContentReveal', 'livePipelineNow',
      'migrateStaleLiveFailures', 'scheduleLiveFrameBackfill',
    ];
    const srcOf = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
    // ⚠️ **先剥注释再扫**（本仓 ADR-0006 规矩 ⑦）：⑥ 之后视频通道里会出现
    // 「实时管线只留一次委托」这类注释，注释里提到符号名不算引用。
    // 剥注释走**共享的字符串感知实现**（文件顶部的 `stripComments` 就是它）——
    // 这里不要再写第二份朴素正则：块注释正则会把字符串里的 `/*` 也吃掉
    //（docs 档的 verify-module-layout 专门判这一条，实测曾因这份本地副本判红）。
    const hits = (text) => LIVE_ONLY.filter((s) => new RegExp('\\b' + s + '\\b').test(stripComments(text)));
    const offenderList = [];
    for (const rel of CHANNEL_FILES) {
      for (const s of hits(srcOf(rel))) offenderList.push(rel + String.fromCharCode(58) + s);
    }
    check('围栏：视频通道不引用任何实时专属符号（' + CHANNEL_FILES.length + ' 文件 × ' + LIVE_ONLY.length + ' 符号）',
      offenderList.length === 0, offenderList.join(', ') || '干净');
    check('反空转：清单里的符号仍真实存在于实时模块（改名后围栏不许退化成查空名单）',
      hits(liveText()).length === LIVE_ONLY.length,
      '实时模块命中 ' + hits(liveText()).length + '/' + LIVE_ONLY.length);
    check('negative control: 通道里塞进任一实时符号都会被同一函数判出',
      hits('const u = liveRenderUrl(sel); const f = () => armLayerContentReveal();').length === 2
      && hits('const u = myOwnRenderUrl(sel);').length === 0);
    // ⑦ 名单**显式钉住**：恰好是视频通道的两个文件（通道本体 + 共用核心），且不含 ④ 已
    // 并入的 transcode.js —— 免得以后"扩容"成一份过期名单（那种名单会静静地不再看守）。
    check('⑦ 围栏名单恰好覆盖视频通道（通道 + 共用核心，不含已并入的 transcode.js）',
      CHANNEL_FILES.length === 2
      && CHANNEL_FILES.includes('../src/video-layer.js')
      && CHANNEL_FILES.includes('../src/layer-core.js')
      && !CHANNEL_FILES.some((f) => f.includes('transcode')));
  }
    // 搬移要**真的发生**：符号在核心里有定义，且原处不再有副本（否则只是复制一份、
    // 两条通道各留一个 —— 改一边另一边不动，那比不搬更坏）。
    const coreSrc = readFileSync(new URL('../src/layer-core.js', import.meta.url), 'utf8');
    const liveSrc = liveText();
    const movedBlocks = ['nudgeWallpaperRepaint', 'onScreenBrief', 'retireFadingLayer', 'startLayerTransition', 'layerKeyDiff', 'switchTransitionOf', 'releaseLayerMedia', 'openRotationAudioGate', 'mediaFramesOf',
      'scheduleFadingLayerRemoval', 'applyInlineStyle'];
    const defsInFile = (text, n) => (text.match(new RegExp('^(?:function\\s+' + n + '\\s*\\(|(?:const|let|var)\\s+' + n + '\\s*=)', 'gm')) || []).length;
    check('共用核心真的持有搬过来的块，且实时管线里不再有副本（' + movedBlocks.length + ' 个符号）',
      movedBlocks.every((n) => defsInFile(coreSrc, n) === 1 && defsInFile(liveSrc, n) === 0),
      movedBlocks.map((n) => n + ':' + defsInFile(coreSrc, n) + '/' + defsInFile(liveSrc, n)).join(' '));
    // ③ 的搬移同理：视频档的媒体构建必须在**视频通道**里，media-prep 只留委托。
    const prepSrc = readFileSync(new URL('../src/media-prep.js', import.meta.url), 'utf8');
    const videoSrc = readFileSync(new URL('../src/video-layer.js', import.meta.url), 'utf8');
    check('③ 视频档的媒体构建在视频通道里，media-prep 里不再有副本（只剩委托）',
      defsInFile(videoSrc, 'buildVideoMedia') === 1
      && defsInFile(prepSrc, 'buildVideoMedia') === 0
      && prepSrc.includes('buildVideoMedia(sel, fitClass)'),
      'video=' + defsInFile(videoSrc, 'buildVideoMedia') + ' prep=' + defsInFile(prepSrc, 'buildVideoMedia'));
    // ⚠️ 实测回归：提取 buildVideoMedia 时切分器的**末端排他**把分支最后一行切掉了，
    // 而那行正是 `.we-media` / `.we-media--fit` 类名的来源 ⇒ 视频只显示左上角、占不满屏。
    // 这条把"两条腿都要挂类名"钉住（Edge 腿挂的是镜像 canvas，非 Edge 腿挂 <video>）。
    const videoFn = (videoSrc.match(/function buildVideoMedia\s*\([\s\S]*?\n\}/) || [])[0] || '';
    check('③ 视频档两条腿都挂了类名（we-media--canvas + fitClass / we-media + fitClass）',
      videoFn.includes('canvas.className = \"we-media we-media--canvas\" + fitClass;')
      && videoFn.includes('media.className = \"we-media\" + fitClass;'));
    // ⚠️ 实测回归（Edge 里「视频壁纸切换无反应」）：切层闸门的镜像画布分支被写成
    // "有画布 ⇒ 判否"，本意是"等 weDrawFrame 画上第一笔" —— 但画笔的留痕（canvas.dataset.weDrawn）
    // 从来没被读，首笔落下时回调的 recheck 又撞回同一条判据 ⇒ Edge 腿的放行条件**永远不成立**，
    // 15s 停滞上限一到旧壁纸永久留屏。两半必须同时在场且指向同一留痕。
    const liveSrcForGate = liveText();
    const clientSrcForGate = clientText();
    const canvasGateOk = (src) => /mirror\.dataset && mirror\.dataset\.weDrawn === "1"/.test(src)
      && !/if \(node\.querySelector\("canvas\.we-media--canvas"\)\) return false;/.test(src);
    check('③ 镜像画布的放行读画笔留痕（weDrawn）：闸门读它、weDrawFrame 写它，两半同时在场',
      canvasGateOk(liveSrcForGate) && /canvas\.dataset\.weDrawn = "1";/.test(clientSrcForGate),
      'gate=' + canvasGateOk(liveSrcForGate) + ' draw=' + /canvas\.dataset\.weDrawn = "1";/.test(clientSrcForGate));
    check('③ 负对照：退回"有画布就判否"的旧形态（首笔也放不出去），同一条判据必须判红',
      canvasGateOk(liveSrcForGate.replace('return !!(mirror.dataset && mirror.dataset.weDrawn === "1");', 'return false;')) === false);
    // ── ② 帧率上限的判据是「上限能不能真的降帧」─────────────────────────────────
    // 设计口径：上限存在的唯一目的是压 GPU 解码占用（Video Decode 随帧率上升）。
    // 所以只有"源帧率高于上限"才值得整片重编码；源帧率 ≤ 上限时转码纯属白烧。
    // ⚠️ 曾经把"原生可解"当免转条件（修）：4K120 的 H.264 既原生可解、
    // 又远高于上限 ⇒ 帧率上限在实际在用的 mp4 上一律失效、只剩一句面板文案。
    // 判据（三态都钉住）：帧率已知且高于上限 ⇒ 转；已知且不高于 ⇒ skip；**未知**才轮到
    // "原生可解就别盲转"这条成本护栏。
    check('② 抽帧决策看「上限能否真降帧」：高于上限才转、不高于则 skip、未知才用原生可解护栏',
      videoSrc.includes('function capNeedsTranscode(')
      && videoSrc.includes('const FPS_CAP_TOLERANCE = 1;')
      && videoSrc.includes('return src > cap + FPS_CAP_TOLERANCE;')
      && videoSrc.includes('if (need === false) {')
      && videoSrc.includes('if (need === null && isNativelyPlayableSource(mi, selection.url, selection.mediaExt)) {')
      && videoSrc.includes('selection.transcodeState = "skipped";')
      && videoSrc.includes('selection.transcodeState = "native";')
      // 不许出现"原生可解 ⇒ 直接不转"的裸条件块（它就是帧率上限失效的原因）；由下面那条 `②`
      // 的 `OLD_NATIVE_EXEMPT_RE` **正反两向**钉住（真源码必须不命中 + 该形态样本必须命中）。
      // 这里不照抄逐字散文串：换个缩进/换行就匹配不上，而且从不检验判据本身有没有牙。
      );
    check('② 正对照：判定只认原生容器/编码（mkv 之类的非原生容器不在白名单里）',
      videoSrc.includes('NATIVE_SRC_EXT') && videoSrc.includes('NATIVE_CODEC_RE')
      && /mp4\|m4v\|webm/.test(videoSrc)
      && !/NATIVE_SRC_EXT = \/[^/]*mkv/.test(videoSrc));
    // 「原生可解 ⇒ 免转」的**缺陷形态** = 一段**没有 `need === null` 前置**的裸条件块，块内先 revert、
    // 再把状态写成 "native"。这条判据**正反两向都用同一个正则**：照抄逐字散文串既容易被缩进/换行
    // 骗过，也**从不检验判据自己有没有牙**。
    //   阳性 = 真源码（该形态不得存在 ⇒ 必须不命中）；阴性 = 该形态样本（正则没坏 ⇒ 必须命中）。
    const OLD_NATIVE_EXEMPT_SAMPLE = 'if (isNativelyPlayableSource(mi, selection.url, selection.mediaExt)) {\n'
      + '    if (video.dataset.weTranscoded) revertTranscodedVideo(video);\n'
      + '    selection.transcodeReady = null;\n'
      + '    selection.transcodeState = "native";';
    const OLD_NATIVE_EXEMPT_RE = /if \(isNativelyPlayableSource\(mi, selection\.url, selection\.mediaExt\)\) \{[\s\S]*?revertTranscodedVideo\(video\);[\s\S]*?transcodeState = "native";/;
    check('② 负对照：把"原生可解"重新写成免转条件会被同一条判据判出（同一条正则扫真源码必须不命中）',
      videoSrc.includes('function capNeedsTranscode(')
      && OLD_NATIVE_EXEMPT_RE.test(OLD_NATIVE_EXEMPT_SAMPLE)
      && !OLD_NATIVE_EXEMPT_RE.test(videoSrc));
    // 容器**必须**能拿到真实后缀：媒体 URL 是 `/media/<base64url>`，路径里没有扩展名 ——
    // 只靠 URL 判会**恒为假**（实测回归：设了帧率上限时每次切换仍跑整片重编码）。
    // 两端各钉一条：宿主把 mediaExt 发出来、客户端把它接进 selection 再传进判据。
    // ⚠️ `mediaExt:` 的**产出点**已随清单构建族搬进 `lib/inventory.js`（§★ W-B B1）；
    //    `extOf` 的**真源**在本分支是叶子 `lib/fs-paths.js`（F 接线后扫描族改为**注入**它，
    //    见 `lib/wallpaper-scan.js` 文件头）—— 这一行是**落点更正**：它原先按"上游把 extOf 定义在
    //    扫描族内部"的形状指 `lib/wallpaper-scan.js`，判的仍是同一条不变量（`extOf` 的声明存在），
    //    不是放宽。
    check('② 真实容器由宿主给、客户端接（mediaExt 全链路在场）',
      readFileSync(join(root, 'lib', 'inventory.js'), 'utf8').includes('mediaExt: w.fileAbs ? extOf(w.fileAbs) : null,')
      && readFileSync(join(root, 'lib', 'fs-paths.js'), 'utf8').includes('function extOf(p)')
      && videoSrc.includes('const e = String(ext || "").toLowerCase();')
      && videoSrc.includes('NATIVE_EXT_SET')
      && readFileSync(join(root, 'src', 'media-prep.js'), 'utf8').includes('selection.mediaExt = w.mediaExt || null;'));
    // ── ⑤ 派发化：视频的转码触发归视频通道（syncLayers 不再直呼它）──────────────
    // 原来这 3 行是视频档在实时管线里**唯一的类型专属逻辑**，现在它只委托。
    check('⑤ 转码触发归视频通道（live-layer 只委托，不再直呼 maybeUpgradeToTranscoded）',
      videoSrc.includes('function videoChannelAfterLayerBuild(')
      && /videoChannelAfterLayerBuild\(video, selection\);/.test(liveSrc)
      && !/maybeUpgradeToTranscoded\(video, selection\.url/.test(liveSrc));
    // ── ⑥ 反向探针：视频档的放行**不经过实时管线的闸门机器** ──────────────────
    const liveSrcNow = liveText();
    check('⑥ 视频档的放行机器归视频通道（实时管线只留一次委托）',
      videoSrc.includes('function armVideoChannelReveal(')
      && /armVideoChannelReveal\(video, recheck, giveUp\);/.test(liveSrcNow)
      && !/probeVideoPoster\(video, recheck, giveUp\)/.test(liveSrcNow)
      && !/VIDEO_POSTER_BUDGET_MS/.test(liveSrcNow));

  check('live-layer.js 已登记进 INLINE_MODULES 且在产物里只有一份',
    /file:\s*'src\/live-layer\.js'/.test(build)
    && (bundle.match(/function syncLayers\(\)/g) || []).length === 1);
  // 阴性侧把变异喂进**上一条用的同一个正则**：把登记行里的模块名换成没登记过的 `src/nope.js`，
  // 同一条判据必须命中（而不是只在常量自比里恒真）。
  const moduleRegistered = (text) => /file:\s*'src\/live-layer\.js'/.test(text);
  check('negative control: 未登记的模块名会被判出',
    moduleRegistered(build) && /file:\s*'src\/nope\.js'/.test(build.replace("'src/live-layer.js'", "'src/nope.js'")));
  // ── 点击效果与拖尾效果（「扩展」二号模块）：A3 起**整族搬进子包 packages/fx** ──────
  // 口径翻了：不再是"登记进主 bundle 的 INLINE_MODULES"，而是"**不在主产物里、只住在自己的
  // 子包产物里**"。子包行由宿主按 cordis.patch.yml 的行名加载，它的浏览器半边由
  // packages/fx/lib/client.fx.js 提供（__ModuleLoader__.load({ id: <子包真名> })）。
  // 主产物零残留是这条的重点：两份同样实现 = 两个 rAF 各画各的、指针各记一份轨迹。
  const fxProduct = readFileSync(SUB_FX_PRODUCT, 'utf8');
  const countOnce = (text, needle) => text.split(needle).length - 1;
  // ⚠️ 判「不在 INLINE_MODULES 里」必须**切片**：build 文本里还有别的 `file:` 登记（构建器的
  //   INLINE_MODULES 之外，子包配方是同名文件住在子目录）—— 拿整份文本判会恒红。
  const inlineText = build.slice(build.indexOf('const INLINE_MODULES = ['), build.indexOf('\n];', build.indexOf('const INLINE_MODULES = [')));
  const subRecipes = subpackageRecipes();
  // 登记面判据：子包配方必须真的读到（读空 = T2 前的旧写法在 T2 之后的事故模式）。
  check('子包构建配方在盘且读得出来（登记面判据不许静默跳过 · 逐包 client.build.json）',
    subRecipes.broken.length === 0 && subRecipes.dirs.length >= 2,
    subRecipes.broken.length
      ? '读不出：' + subRecipes.broken.join(' ')
      : '读到 ' + subRecipes.dirs.length + ' 份：' + subRecipes.dirs.join(' '));
  check('negative control: 配方登记面判据引号不敏感且有牙（JSON 双引号 / 旧 JS 单引号同判；没登记的模块名判红）',
    registersFile('{ "file": "src/fx-layer.js" }', 'src/fx-layer.js')
    && registersFile("{ file: 'src/fx-layer.js' }", 'src/fx-layer.js')
    && !registersFile('{ "file": "src/fx-layer.js" }', 'src/nope.js'));
  check('fx-layer.js / ext-fx.js 已搬出主 bundle（零残留 · 只住在 packages/fx/lib/client.fx.js）',
    !/file:\s*'src\/fx-layer\.js'/.test(inlineText) && !/file:\s*'src\/ext-fx\.js'/.test(inlineText)
    // 正面证据：两处必须**登记在子包配方**里（否则子包产物从哪来）。配方是 JSON ⇒ 引号不敏感同判。
    && registersFile(subRecipes.text, 'src/fx-layer.js') && registersFile(subRecipes.text, 'src/ext-fx.js')
    && !bundle.includes('function syncFxLayer()') && !bundle.includes('function renderFxIsland(')
    && countOnce(fxProduct, 'function syncFxLayer()') === 1
    && countOnce(fxProduct, 'function disposeFxLayer()') === 1
    // 帧循环只有一条：混回两份就是两个 rAF 各画各的。
    && countOnce(fxProduct, 'function fxFrame()') === 1
    && countOnce(fxProduct, 'function renderFxIsland(ctx)') === 1
    && fxProduct.includes('fxColorMode')
    // 产物自己是**按子包真名**注册的（与 patch 行名逐字相等）—— 名不对 ⇒ 客户端 require 不到。
    // 两段分开判：产物头是跨行的（load({ \n \t id: "<包名>"）—— 合成一行会认不中。
    && fxProduct.includes('__ModuleLoader__.load({')
    && fxProduct.includes('id: "dsh-plugin-wallpaper-engine-fx"'));
  // ── 3D 效果（「扩展」三号模块）：同上，整族搬进 packages/parallax ──────────────────
  // 与前两族不同的设计要点：行为层**不建 DOM**（只写 CSS 变量）——"顺手 appendChild 一版"
  // 是最容易走偏的写法，所以在**产物**层面断言它没有建 DOM 的痕迹（变量型行为层是它的要点）。
  const parallaxProduct = readFileSync(SUB_PARALLAX_PRODUCT, 'utf8');
  check('parallax-layer.js / ext-parallax.js 已搬出主 bundle（零残留 · 只住在 packages/parallax/lib/client.parallax.js）',
    !/file:\s*'src\/parallax-layer\.js'/.test(inlineText) && !/file:\s*'src\/ext-parallax\.js'/.test(inlineText)
    // 正面证据同上：登记在子包配方里（引号不敏感）。
    && registersFile(subRecipes.text, 'src/parallax-layer.js') && registersFile(subRecipes.text, 'src/ext-parallax.js')
    && !bundle.includes('function syncParallaxLayer()') && !bundle.includes('function renderParallaxIsland(')
    && countOnce(parallaxProduct, 'function syncParallaxLayer()') === 1
    && countOnce(parallaxProduct, 'function disposeParallaxLayer()') === 1
    // 位移只有一条帧循环：混回两份就是两个 rAF 各追各的目标，CSS 变量来回打架。
    && countOnce(parallaxProduct, 'function parallaxFrame(') === 1
    && countOnce(parallaxProduct, 'function renderParallaxIsland(ctx)') === 1
    && parallaxProduct.includes('parallaxSmooth')
    && !parallaxProduct.includes('parallaxHost')
    && parallaxProduct.includes('id: "dsh-plugin-wallpaper-engine-parallax"'));
  // 负对照：两侧都要有牙 —— ① 登记被加回 INLINE_MODULES；② 子包产物里少一份实现。
  check('negative control: 登记被加回 INLINE_MODULES ⇒ 同一条判据判红',
    !/file:\s*'src\/fx-layer\.js'/.test(inlineText)
    && /file:\s*'src\/fx-layer\.js'/.test(inlineText.replace('const INLINE_MODULES = [', "const INLINE_MODULES = [\n  { file: 'src/fx-layer.js' },")));
  check('negative control: 子包产物少一份实现 ⇒ 同一条判据判红（抽掉一处函数声明）',
    countOnce(fxProduct, 'function disposeFxLayer()') === 1
    && countOnce(fxProduct.split('function disposeFxLayer()').join('function goneDispose()'), 'function disposeFxLayer()') === 0);
  // ── 自定义会话头像（「扩展」页签**第一个**模块）：装饰层 + 扩展岛同样是两条登记 ──
  //    它跟另三个模块的关键差别是**它动宿主的会话 DOM**（给消息行补头像节点）——
  //    所以"产物里只有一份"在这里更要紧：两份注入逻辑就是同一行补两个头像。
  check('avatar-layer.js 已登记进 INLINE_MODULES 且在产物里只有一份',
    /file:\s*'src\/avatar-layer\.js'/.test(build)
    && (bundle.match(/function syncAvatarLayer\(\)/g) || []).length === 1
    && (bundle.match(/function disposeAvatarLayer\(\)/g) || []).length === 1
    // 补头像只有一条路径（行标记 + 节点填充都在它里），混回两份 = 一行补两个头。
    && (bundle.match(/function avatarDecorateRow\(/g) || []).length === 1
    && (bundle.match(/function avatarFillNode\(/g) || []).length === 1);
  check('ext-avatar.js 已登记进 INLINE_MODULES 且在产物里只有一份',
    /file:\s*'src\/ext-avatar\.js'/.test(build)
    && (bundle.match(/function renderAvatarIsland\(ctx\)/g) || []).length === 1
    && bundle.includes('avatarRadius') && bundle.includes('avatarUserImage')
    // A3 起**不再**断言"三项写在同一张静态数组里"：avatar 仍住主包，fx / parallax 各住自己的
    // 子包产物，屏上顺序由共享注册表按描述符 order 排（见下面那批注册表判据）。
    && bundle.includes('weRegisterExtensionModule("avatar", AVATAR_EXTENSION_MODULE)'));
  // ── 扩展页签的**注册表**契约（A3 起跨三份 bundle）──────────────────────────────
  // 三份产物（主 + packages/fx + packages/parallax）的并集恰好注册这三项；屏上顺序**只**由
  // 描述符的 order 决定（三份 bundle 的求值顺序不保证，静态数组序不是契约 —— §6.2 显式键集）。
  const regIds = Array.from((bundle + '\n' + fxProduct + '\n' + parallaxProduct)
    // 两种拼写都要认：宿主注入的显式键是 registerExtensionModule（小写 r），
    // 包内的冻结表函数是 weRegisterExtensionModule（大写 R）—— 只认一种就会漏掉某一侧。
    .matchAll(/[Rr]egisterExtensionModule\(\s*['"]([\w-]+)['"]/g)).map((m) => m[1]);
  const unionIsThree = (ids) => Array.from(new Set(ids)).sort().join(',') === 'avatar,fx,parallax';
  check('扩展模块 id 三份产物并集恰好三项（avatar 主包 / fx · parallax 各自子包）',
    unionIsThree(regIds), regIds.join(',') || '一处注册调用都没找到');
  check('negative control: 并集少一项 / 多一项都判红（同一份判据函数）',
    !unionIsThree(['fx', 'parallax']) && !unionIsThree(regIds.concat(['zzz'])));
  check('panel-tabs 的 extensionModules() 只问注册表（不留静态清单 —— 跨包顺序不是契约）',
    /function extensionModules\(\) \{\s*\n?\s*return weExtensionModules\(\);/.test(tabsHubSrc));
  // 顺序的真源 = **描述符声明的 order**（avatar=1 / fx=2 / parallax=3），不是任何数组序。
  // 行为侧的排序在挂载台里由 installExtensionRegistry() 再判一次（乱序登记）。
  const orderOfModule = (text, name) => {
    const i = text.indexOf('const ' + name + ' = {');
    if (i < 0) return null;
    const m = /order:\s*(\d+)/.exec(text.slice(i, i + 4000));
    return m ? Number(m[1]) : null;
  };
  const avatarExtSrc = readFileSync(join(root, 'src', 'ext-avatar.js'), 'utf8');
  const fxExtSrc = readFileSync(subFxFile('ext-fx.js'), 'utf8');
  const parExtSrc = readFileSync(subParallaxFile('ext-parallax.js'), 'utf8');
  check('屏上顺序 = 描述符的 order（avatar 1 / fx 2 / parallax 3）· 不靠数组序',
    orderOfModule(avatarExtSrc, 'AVATAR_EXTENSION_MODULE') === 1
    && orderOfModule(fxExtSrc, 'FX_EXTENSION_MODULE') === 2
    && orderOfModule(parExtSrc, 'PARALLAX_EXTENSION_MODULE') === 3,
    [orderOfModule(avatarExtSrc, 'AVATAR_EXTENSION_MODULE'),
      orderOfModule(fxExtSrc, 'FX_EXTENSION_MODULE'),
      orderOfModule(parExtSrc, 'PARALLAX_EXTENSION_MODULE')].join('/'));
  // ── 面板页签（C）：渲染器只在 panel-tabs.js，且**只从一个参数取外界** ──
  const TAB_FNS = ['renderWallpaperTab', 'renderAppearanceTab', 'renderAudioTab',
    'renderMascotTab', 'renderEffectsTab', 'renderAdvancedTab', 'renderExtensionsTab',
    'renderAboutTab'];
  check('页签渲染器只在 src/panel-tabs.js（client.js 不留第二份）',
    TAB_FNS.every((n) => !new RegExp('function ' + n + '\\s*\\(').test(src))
    && TAB_FNS.every((n) => tabsHubSrc.includes('function ' + n + '(ctx) {')));
  // 每个渲染器的**首行**必须是 `const { … } = ctx;` —— "要什么"写在签名处，
  // 而不是靠闭包默默捕获（这正是这一刀的意义；也防止后来人图省事把捕获加回去）。
  const tabBodies = tabsHubSrc.split(/^ {2}function (render\w+Tab)\(ctx\) \{$/m).slice(1);
  const noCtxLine = [];
  for (let i = 0; i < tabBodies.length; i += 2) {
    const fn = tabBodies[i], body = tabBodies[i + 1] || '';
    if (!/^\s*\n\s*const \{[^}]*\} = ctx;/.test(body)) noCtxLine.push(fn);
  }
  check('每个页签首行都从 ctx 解构（不许再靠闭包捕获）', noCtxLine.length === 0,
    noCtxLine.join(' ') || TAB_FNS.length + ' 个页签都显式取外界');
  // ── 外观页五节的**默认开合**（二次修订的用户口径，**必须源码级判**）──────────
  //    用户口径：侧边栏「**后面三个默认隐藏**」、设置页「**全部开启**但也支持隐藏」。
  //    ⚠️ 为什么不能靠渲染用例：那些用例是**直接调渲染器**（隔离测试），默认值住在**面板组件**
  //    里（`readQpOpen` / `readSavedPickerOpen` 的default 参数）—— 隔离测试**看不见默认值**。
  //    这正是上一轮"拉宽没生效"那类错误的同一形状（隔离绿、真实链路断），所以这里读源码钉住。
  //    顺序与设置页同序：细节 / 主题预设 / 玻璃 UI / 侧边栏圆角 / 全局 UI 配色 / 全局字体
  //    （「主题预设」只在设置页画 ⇒ 只有设置页这半边判据，没有侧栏的 QP 键）。
  {
    // 某一档里某个键的**实际默认值**：看它的读调用写的是 `true` 还是 `false`。
    // ⚠️ 不要去猜调用形态（第一版用"调用点后 200 字符内找 return true"—— 而设置页的
    //    `React.useState(readSavedPickerFontOpen)` **根本没有括号**，于是全都判成"收起"，
    //    7 条假红）。改成两件事分开验：**读函数的语义**（下面单独验）+ **传进去的默认值**。
    const qpDefault = (key) => (new RegExp('readQpOpen\\(\\s*' + key + '\\s*,\\s*true\\s*\\)').test(qpSrc)
      ? true
      : (new RegExp('readQpOpen\\(\\s*' + key + '\\s*,\\s*false\\s*\\)').test(qpSrc) ? false : null));
    const sidebarDefaults = [
      ['细节', 'QP_DETAIL_OPEN_KEY', true],
      ['玻璃 UI', 'QP_GLASS_UI_OPEN_KEY', true],
      ['侧边栏圆角', 'QP_CORNERS_OPEN_KEY', false],
      ['全局 UI 配色', 'QP_UI_COLOR_OPEN_KEY', false],
      ['全局字体', 'QP_FONT_OPEN_KEY', false],
    ];
    for (const [name, key, want] of sidebarDefaults) {
      const got = qpDefault(key);
      check('侧边栏「' + name + '」默认' + (want ? '展开' : '隐藏') + '（用户口径：后三节默认隐藏）',
        got === want, '实测 ' + (got === null ? '（读不到默认值）' : got ? '展开' : '隐藏'));
    }
    check('侧边栏：**后面三节**默认隐藏、前面两节默认展开',
      sidebarDefaults.every(([, key, want]) => qpDefault(key) === want),
      sidebarDefaults.map(([n, key]) => n + '=' + (qpDefault(key) ? '展开' : '隐藏')).join(' '));
    // 「详细玻璃调节」是**子门**（管玻璃节内部的高级行），与整节门不是一回事 ⇒ 默认仍收起。
    check('侧边栏「详细玻璃调节」子门默认收起（它与整节门不是一回事）',
      qpDefault('QP_GLASS_DETAIL_KEY') === false, '默认 ' + (qpDefault('QP_GLASS_DETAIL_KEY') ? '展开' : '收起'));
    // 设置页：四个门共用 `readSavedPickerOpen`（无默认值参数 ⇒ 默认值写在那条读函数里），
    // 另两个各有自己的读函数。所以这里验"**读函数在 null 分支返回 true**"。
    const pickerReads = [
      ['细节', 'readSavedPickerOpen', 'PICKER_DETAIL_OPEN_KEY'],
      ['主题预设', 'readSavedPickerOpen', 'PICKER_PRESETS_OPEN_KEY'],
      ['玻璃 UI', 'readSavedPickerOpen', 'PICKER_GLASS_UI_OPEN_KEY'],
      ['侧边栏圆角', 'readSavedPickerOpen', 'PICKER_CORNERS_OPEN_KEY'],
      ['全局 UI 配色', 'readSavedPickerUiColorOpen', null],
      ['全局字体', 'readSavedPickerFontOpen', null],
    ];
    for (const [name, reader, key] of pickerReads) {
      const body = fnBody(src, reader);
      // ① 该节确实交给这条读函数。⚠️ 三节是**经自定义 hook** 传键的
      //    （`usePickerSectionOpen(PICKER_DETAIL_OPEN_KEY)` → hook 内 `readSavedPickerOpen(key)`），
      //    所以"接线"要验两段：键进了 hook、hook 把键交给读函数。第一版只验了
      //    `readSavedPickerOpen(KEY)` 直连 ⇒ 三节全假红（键根本不在这条调用里）。
      const wired = key
        ? (new RegExp('usePickerSectionOpen\\(\\s*' + key + '\\s*\\)').test(src)
          && /readSavedPickerOpen\(key\)/.test(src))
        : true;
      // ② 读函数在"从没表过态"（localStorage 为 null）时返回 true = 默认展开
      const m = body.match(/if\s*\(\s*v\s*===\s*null\s*\)\s*return\s+(true|false)\s*;/);
      const def = m ? m[1] === 'true' : null;
      check('设置页「' + name + '」默认展开（"全部开启"）',
        wired && def === true,
        '接线=' + wired + ' 默认=' + (def === null ? '（读不到 null 分支）' : def ? '展开' : '收起'));
    }
    // ⚠️ 存储语义：**读到 "0" 必须当收起**（用户显式收起过，默认值不许覆盖他的选择）。
    //    两个读函数都必须先判 `=== null`（从没表过态）才吃默认值 —— 这是"改默认值不砸老用户"的
    //    唯一防线：若写成 `!== "0"` 或 `return v === "1" || defaultOpen`，用户以前的收起选择会被
    //    静默抹掉（那正是"改了默认值，用户发现自己的布局被重置"的成因）。
    const qpReadBody = fnBody(qpSrc, 'readQpOpen');
    check('侧边栏读默认：先判 `=== null` 才吃默认值，读到 "0" 一律当收起',
      /===\s*null/.test(qpReadBody) && /===\s*"1"/.test(qpReadBody)
      && !/\|\|\s*defaultOpen/.test(qpReadBody),
      qpReadBody ? '语义正确' : '（解析不出 readQpOpen 函数体）');
    for (const reader of ['readSavedPickerOpen', 'readSavedPickerFontOpen', 'readSavedPickerUiColorOpen']) {
      const body = fnBody(src, reader);
      check('设置页 ' + reader + ' 的存储语义正确（先判 `=== null`）',
        /===\s*null/.test(body) && /===\s*"1"/.test(body), body ? '语义正确' : '（解析不出函数体）');
    }
    // 负对照：把侧边栏「细节」的默认写成 false ⇒ 同一个取默认值的函数必须给出 false（判据有牙）。
    check('negative control: 同一个取默认值的函数对 false 形态给 false',
      qpDefault('QP_CORNERS_OPEN_KEY') === false, '侧边栏圆角 = ' + qpDefault('QP_CORNERS_OPEN_KEY'));
  }
  check('panel-tabs.js 已登记进 INLINE_MODULES 且在产物里只有一份',
    /file:\s*'src\/panel-tabs\.js'/.test(build)
    && (bundle.match(/function renderEffectsTab\(ctx\)/g) || []).length === 1);
}

// host 的 sanitizeSettings 是白名单：漏加 sceneLiveFailures 会让 PUT 上来的
// 失败记忆被丢弃、刷新后记忆消失。
// ── Level E: 三条宿主路由必须各有行为断言 ───────────────────────────────────
// 这三条在 `docs/ROUTE-INDEX.md` 的"零提及"清单里不许出现 ⇒ 拆分 `apply(ctx)` 之前必须
// 补上真实行为断言，否则动它们等于没有安全网。三条都只断言**无副作用的失败路径**：
// 不写宿主持久化配置、不落盘、不依赖本机是否真有封面（否则 CI 会随环境飘）。
{
  const byPath = (p) => routes.find((r) => r.path === '/wallpaper-engine' + p);
  const clientDiag = byPath('/client-diag');
  const uploadDir = byPath('/upload-dir');
  const artwork = byPath('/now-playing/artwork');
  const mediaControl = byPath('/media-control');
  check('/client-diag 已注册（kind=exact）', Boolean(clientDiag) && clientDiag.kind === 'exact');
  check('/upload-dir 已注册（kind=exact）', Boolean(uploadDir) && uploadDir.kind === 'exact');
  check('/now-playing/artwork 已注册（kind=exact）', Boolean(artwork) && artwork.kind === 'exact');
  check('/media-control 已注册（kind=exact）', Boolean(mediaControl) && mediaControl.kind === 'exact');
  if (clientDiag) {
    const wrongMethod = await runHandler(clientDiag, '/wallpaper-engine/client-diag', {});
    check('/client-diag 非 POST ⇒ 405（早退，不落盘）', wrongMethod.__state.status === 405,
      'status=' + wrongMethod.__state.status);
    // 超限体 ⇒ 413：与客户端半的 64KB 上限对齐，同时钉住"不会把大体读进内存"。
    const big = Readable.from([Buffer.alloc(70 * 1024, 0x41)]);
    big.url = '/wallpaper-engine/client-diag';
    big.method = 'POST';
    big.headers = { 'content-type': 'application/json' };
    const resBig = fakeRes();
    clientDiag.handler(big, resBig);
    await waitRes(resBig);
    check('/client-diag 超 64KB ⇒ 413', resBig.__state.status === 413, 'status=' + resBig.__state.status);
  }
  if (uploadDir) {
    const wrongMethod = await runHandler(uploadDir, '/wallpaper-engine/upload-dir', {});
    check('/upload-dir 非 POST ⇒ 405（不改宿主持久化配置）', wrongMethod.__state.status === 405,
      'status=' + wrongMethod.__state.status);
  }
  if (artwork) {
    const r = await runHandler(artwork, '/wallpaper-engine/now-playing/artwork', {});
    const st = r.__state.status;
    check('/now-playing/artwork 无封面 ⇒ 404 no-artwork；有封面 ⇒ 2xx（绝不 5xx）',
      (st === 404 && r.__state.body.toString('utf8') === 'no-artwork') || (st >= 200 && st < 300),
      'status=' + st);
  }
}

// ⚠️ 门面面 = lib/index.js + **组件行真源**。本分支把媒体桥实现搬进了
// lib/components/media-bridge/**（P2 拆包）→ **P-F 批 1c 出户到 `packages/media-bridge/lib/**`**，
// "中间件优先 / legacy 回落 / 音频已关透传"这些形态住在那儿 ⇒ 只扫门面会误报丢失
// （判据纪律同 hostHalfSrc："拆出的模块必须加进来"）。
const componentMediaSources = ['packages/media-bridge/lib/index.js', 'packages/media-bridge/lib/legacy.js',
  'packages/media-bridge/lib/routes/now-playing.js', 'packages/media-bridge/lib/provision.js',
  'packages/media-bridge/lib/supervisor.js']
  .map((f) => { try { return readFileSync(join(root, f), 'utf8'); } catch { return ''; } }).join('\n');
// 再补 **P0 拆出的 lib 模块**：这些模块的实现形态（如 upload-dir 的 `up-dir-${name}` 前缀与
// `resolveSceneMainFileP` 解析）本就是"原门面里那段代码"，判据按门面面扫时必须能看到它们。
const p0LibSources = ['lib/upload-dir.js', 'lib/upload-store.js', 'lib/inventory.js', 'lib/cache-dir.js',
  'lib/fs-paths.js', 'lib/we-assets.js', 'lib/media-origin.js', 'lib/startup-sweep.js',
  'lib/shim-seed.js', 'lib/we-props.js']
  .map((f) => { try { return readFileSync(join(root, f), 'utf8'); } catch { return ''; } }).join('\n');
const hostSrc = readFileSync(join(root, 'lib', 'index.js'), 'utf8') + '\n' + componentMediaSources + '\n' + p0LibSources;
/** 壁纸媒体源 + 适配器形态观测：已从 `apply()` 拆出（见 lib/media-origin.js 文件头）。 */
const mediaOriginSrc = readFileSync(join(root, 'lib', 'media-origin.js'), 'utf8');
/** 清单构建族：已从 `apply()` 拆出（见 lib/inventory.js 文件头，工厂 `createInventoryBuilder`）。 */
const inventorySrc = readFileSync(join(root, 'lib', 'inventory.js'), 'utf8');
/** 字节出站套件（载荷账本 / 静态发送 / `/scene-files` 注入）：已从 `apply()` 拆出（见 lib/serve.js 文件头，工厂 `createServeKit`）。 */
const serveSrc = readFileSync(join(root, 'lib', 'serve.js'), 'utf8');
/** faststart 变体子系统（moov 搬家 / 字节布局钉子 / 预热）：已从 `apply()` 拆出（见 lib/faststart.js 文件头，工厂 `createFaststartKit`）。 */
const faststartSrc = readFileSync(join(root, 'lib', 'faststart.js'), 'utf8');
/**
 * 宿主半的**全部实现面** = `lib/index.js` + `lib/routes/*.js` + 从 `apply()` 拆出的独立模块
 *（`lib/media-origin.js` ＋ `lib/inventory.js` ＋ `lib/serve.js` ＋ `lib/faststart.js`）。
 * 路由族 / 逻辑块拆出 `apply(ctx)` 是 P2-11 与 §★ 重构的正常动作 ⇒ 凡断言"宿主仍实现某契约"的
 * 判据必须覆盖这些落点，否则"已搬走"会被误报成"契约丢了"。⚠️ 反过来，断言"某路由**已不在正文**"
 *（如 /diag）的判据必须继续只用 `hostSrc` —— 拿扩面集合去检查"不在"，会把搬走的代码判成还在。
 * ⚠️ 每新增一个"从 apply() 拆出的独立模块"，此处**必须**同步加进来，否则该模块里的契约会被误报丢失。
 */
// ⚠️ 扫描面 = 门面 + P0 拆出的独立模块 + 路由族。**每新增一个从 apply() 拆出的模块必须加进来**
//（本判据自己的纪律，见上方注释）—— 漏加会让该模块里的契约被**误报为丢失**。
// 例：`traceMediaRequests` 随 P0 库化搬进 lib/diag-trace.js，而本数组原先只读门面与路由族，
// 于是"双挂载"那条判据的第四个条件恒 false（形态在、扫描面不在 ⇒ 假红）。
const extraHostHalfSources = [
  'lib/diag-trace.js', 'lib/cache-dir.js', 'lib/http-lifecycle.js', 'lib/shim-seed.js',
  'lib/startup-sweep.js', 'lib/we-assets.js', 'lib/media-origin.js',
  ...readdirSync(join(root, 'lib', 'kernel')).filter((f) => f.endsWith('.js')).map((f) => 'lib/kernel/' + f),
  ...readdirSync(join(root, 'lib', 'media')).filter((f) => f.endsWith('.js')).map((f) => 'lib/media/' + f),
].map((f) => { try { return readFileSync(join(root, f), 'utf8'); } catch { return ''; } });
const hostHalfSrc = [hostSrc, mediaOriginSrc, inventorySrc, serveSrc, faststartSrc,
  ...extraHostHalfSources,
  ...readdirSync(join(root, 'lib', 'routes')).filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(join(root, 'lib', 'routes', f), 'utf8'))].join('\n');
// 宿主设置白名单已改为**派生**（唯一真源 lib/settings-schema.js，P1-5）。因此这几条不再
// 抠实现里的字面量，而是把值喂给宿主的规范化函数看它收不收 —— 断言的是**行为**。
const schemaMod = await import(pathToFileURL(join(root, 'lib', 'settings-schema.js')).href);
const sanitizeHost = (raw0) => schemaMod.sanitizeFromSchema(raw0, 'host');
const hostKeeps = (k, v) => JSON.stringify(sanitizeHost({ [k]: v })[k]) === JSON.stringify(v);
check('host settings whitelist keeps sceneLiveFailures', hostKeeps('sceneLiveFailures', { w1: 'timeout' }));
check('host injects the engine shim into web HTML', /data-we-shim="host"/.test(serveSrc) && /readWebShim\(\)/.test(serveSrc));
// ── 网页壁纸的**帧级夺焦围栏**（lib/we-focus-guard.js）────────────────────────────
// 现象：播某些网页类壁纸时，DSH 的输入框 / 下拉选择框 / 左下角账号菜单每点一次就丢焦点 ——
// 与点击位置无关、与组件类型有关（只有"必须持有键盘焦点才正常"的控件看得出来）。
// 机制：宿主 window 捕获相把每次真实 mousedown 注入渲染页（src/live-layer-pointer.js 的 `ensureLivePointer()`，且只在
// `selection.sceneLiveActive` 时发 ⇒ 暂停即停）→ 严格沙箱下经 web-shim 的 op 通道 → shim 用
// elementFromPoint + dispatchEvent 在壁纸文档里合成 pointer/mouse（isTrusted === false）→ 作者在
// 捕获相 mousedown 里调 window.focus() 争键盘 ⇒ DSH 的焦点被搬进壁纸帧。
// 围栏吞掉**帧级** window.focus() 并留计数；**元素级** focus（#148 第二步）只在"最近一次
// 真实交互"的 1000 ms 窗口内放行 —— 窗口外吞掉（`setInterval(()=>input.focus(),2000)` 这类
// 无手势的周期性夺焦由此被拦，而用户真点壁纸时作者页的编辑框照常拿焦点）。
// 这里钉四件机器可判的事：① 注入体真的能拦（在假 realm 里跑**真源码**）；② 元素级围栏的两侧
// （窗口内放行 / 窗口外吞掉）都成立且逃生门同时放开两条；③ 宿主真的把它注进
// web HTML，且顺序在 shim 与 seed 之间；④ 注入体不含会被 `</script` 截断或被当模块执行的形态。
const guardPath = join(root, 'lib', 'we-focus-guard.js');
const guardSrc = readFileSync(guardPath, 'utf8');
const guardMod = await import(pathToFileURL(guardPath).href);
const guardSource = guardMod.weFocusGuardSource();
/** 在只有 `window` 的假 realm 里执行注入体的真源码，返回那个假 window（注入体必须自足）。 */
const runGuard = (stub) => { new Function('window', guardSource)(stub); return stub; };
{
  // ① 赋值腿装上 ⇒ 帧级 focus 被吞、原函数不被调用、计数如实累加。
  const rawHits = [];
  const win1 = { focus () { rawHits.push('raw'); } };
  const returned = runGuard(win1);
  const g1 = win1.__weFocusGuard;
  const patched1 = win1.focus;
  win1.focus();
  check('focus guard blocks frame-level window.focus()',
    returned === win1 && g1 !== undefined && g1.installed === true
      && g1.calls === 1 && g1.blocked === 1 && g1.allowed === 0 && rawHits.length === 0
      && typeof patched1 === 'function',
    'calls=' + (g1 && g1.calls) + ' blocked=' + (g1 && g1.blocked) + ' raw=' + rawHits.length);
  // ② 幂等：重复注入不换 guard 对象、不重复计数（同一文档只装一次）。
  runGuard(win1);
  win1.focus();
  check('focus guard install is idempotent',
    win1.__weFocusGuard === g1 && g1.calls === 2 && g1.blocked === 2, 'calls=' + g1.calls);
  // ③ 逃生门：allow = true 时转交原函数（给对比测试用，不是用户开关）。
  g1.allow = true;
  win1.focus();
  check('focus guard honours the allow escape hatch',
    rawHits.length === 1 && g1.allowed === 1 && g1.calls === 3, 'allowed=' + g1.allowed);
  // ④ 兜底腿：focus 只长在原型上且不可写 ⇒ 赋值静默失败 ⇒ defineProperty 建自有属性顶上。
  const protoRaw = [];
  const proto2 = {};
  Object.defineProperty(proto2, 'focus', { configurable: true, writable: false, value () { protoRaw.push('x'); } });
  const win2 = Object.create(proto2);
  runGuard(win2);
  win2.focus();
  check('focus guard falls back to defineProperty when assignment is ignored',
    Object.prototype.hasOwnProperty.call(win2, 'focus') === true
      && win2.__weFocusGuard.installed === true && win2.__weFocusGuard.blocked === 1 && protoRaw.length === 0,
    'installed=' + win2.__weFocusGuard.installed);
  // ⑤ 不可补丁：自有且不可写不可配置 ⇒ installed 如实为 false，且**绝不抛**（注入体住在壁纸文档里，
  //    抛异常会毁掉作者脚本，而那正是要防的事）。
  const win3 = {};
  Object.defineProperty(win3, 'focus', { configurable: false, writable: false, value () {} });
  let guardThrew = false;
  try { runGuard(win3); } catch { guardThrew = true; }
  check('focus guard reports installed=false when focus is unpatchable (never throws)',
    guardThrew === false && win3.__weFocusGuard.installed === false && win3.__weFocusGuard.blocked === 0);
  // ⑥ 负对照：把"吞掉"改回"转交" ⇒ ① 的核心断言（原函数一次都没被调用）必须变假。
  const mutantHits = [];
  const winM = { focus () { mutantHits.push('raw'); } };
  new Function('window', guardSource.replace('return undefined;', 'return raw.apply(w, arguments);'))(winM);
  winM.focus();
  check('负对照：注入体改成转交 ⇒ 核心断言（原函数不被调用）变假',
    mutantHits.length === 1 && winM.__weFocusGuard.installed === true);
  // ⚠️ 上面那条负对照 `String.replace` **只换第一处** `return undefined;` ⇒ 那句字面量必须唯一，
  //    否则它可能被换到别的分支上（负对照会变成"看着绿、其实没测到"）。
  check('负对照的前提：注入体里 `return undefined;` 只有一处（帧级那一处）',
    guardSource.split('return undefined;').length === 2,
    '出现 ' + (guardSource.split('return undefined;').length - 1) + ' 次');
}
{
  // ⑦ 元素级围栏（#148 第二步）：无手势吞掉、手势窗口内放行、窗口过期重新拦住、逃生门放开两条。
  const elRaw = [];
  const FakeHTMLElement = function () {};
  FakeHTMLElement.prototype.focus = function () { elRaw.push('el'); };
  const gestureHandlers = [];
  const win4 = {
    focus () {},
    document: {},
    HTMLElement: FakeHTMLElement,
    addEventListener (t, fn) { gestureHandlers.push({ t, fn }); },
  };
  runGuard(win4);
  const g4 = win4.__weFocusGuard;
  const input4 = new FakeHTMLElement();
  input4.focus();
  check('元素级围栏：没有用户手势时 element.focus() 被吞（计数 + 不转交原函数 + 两个原型腿都装了）',
    g4.elInstalled === true && g4.elCalls === 1 && g4.elBlocked === 1 && g4.elAllowed === 0
      && elRaw.length === 0 && gestureHandlers.length === 4
      && gestureHandlers.every((h) => ['pointerdown', 'mousedown', 'touchstart', 'keydown'].includes(h.t)),
    'elCalls=' + g4.elCalls + ' elBlocked=' + g4.elBlocked + ' raw=' + elRaw.length
      + ' 手势源=' + gestureHandlers.map((h) => h.t).join('/'));
  check('元素级围栏：最近一次被拦的调用点留下时间戳与栈头（壁纸帧控制台可自证）',
    g4.elLastBlockedAt > 0 && typeof g4.elLastBlockedStack === 'string' && g4.elLastBlockedStack.length > 0,
    'at=' + g4.elLastBlockedAt + ' stack=' + String(g4.elLastBlockedStack).slice(0, 40));
  // 手势窗口内：shim 合成的 pointer/mouse 也算（isTrusted === false 也正是那一类）。
  gestureHandlers.forEach((h) => h.fn({ type: h.t, isTrusted: false }));
  input4.focus();
  check('元素级围栏：真实交互后的窗口内放行（用户点壁纸自己的编辑框照常拿焦点）',
    g4.gestureAt > 0 && g4.elCalls === 2 && g4.elAllowed === 1 && g4.elBlocked === 1 && elRaw.length === 1,
    'elAllowed=' + g4.elAllowed + ' raw=' + elRaw.length);
  // 窗口过期：定时器式夺焦（报告里的 0.9–3.6 s 周期）走这条。
  g4.gestureAt = Date.now() - 5000;
  input4.focus();
  check('元素级围栏：窗口过期后重新拦住（无手势的周期性 element.focus() 在这里被吞）',
    g4.elCalls === 3 && g4.elBlocked === 2 && g4.elAllowed === 1 && elRaw.length === 1,
    'elBlocked=' + g4.elBlocked + ' raw=' + elRaw.length);
  // 逃生门：与帧级同一个开关。
  g4.allow = true;
  input4.focus();
  check('元素级围栏：allow 逃生门同时放开元素级那一半', g4.elAllowed === 2 && elRaw.length === 2);
  // ⑧ 负对照：把"窗口判定"改成恒真 ⇒ "窗口过期后重新拦住"必须变假（判据真的在判手势）。
  const elRawM = [];
  const ElM = function () {};
  ElM.prototype.focus = function () { elRawM.push('el'); };
  const winM2 = { focus () {}, document: {}, HTMLElement: ElM,
    addEventListener () {} };
  new Function('window', guardSource.replace('guard.allow || fresh', 'true'))(winM2);
  const gM = winM2.__weFocusGuard;
  new ElM().focus();
  check('负对照：窗口判定恒真 ⇒ 元素级围栏失效（无手势不再被吞）',
    gM.elBlocked === 0 && gM.elAllowed === 1 && elRawM.length === 1,
    'elBlocked=' + gM.elBlocked + ' raw=' + elRawM.length);
  // ⑨ 元素级补丁装不上时如实记账，且绝不抛（注入体住在壁纸文档里）。
  const ElFrozen = function () {};
  Object.defineProperty(ElFrozen.prototype, 'focus', { configurable: false, writable: false, value () {} });
  const win5 = { focus () {}, document: {}, HTMLElement: ElFrozen, addEventListener () {} };
  let elGuardThrew = false;
  try { runGuard(win5); } catch { elGuardThrew = true; }
  check('元素级围栏：补丁装不上时 elInstalled=false 且绝不抛（帧级那一半仍有效）',
    elGuardThrew === false && win5.__weFocusGuard.elInstalled === false
      && win5.__weFocusGuard.installed === true && win5.__weFocusGuard.elBlocked === 0);
}
check('focus guard source is classic-script and markup safe',
  guardSource.length > 200 && !/<\/script/i.test(guardSource) && !/^\s*(?:import|export)\b/m.test(guardSource)
    && guardSrc.includes('weFocusGuardInstall.toString()'),
  'len=' + guardSource.length + ' via toString=' + guardSrc.includes('weFocusGuardInstall.toString()'));
// 接线腿：注入点只有一处（/scene-files 的 HTML 分支），顺序必须是 site-root → shim → focus-guard → seed
//（四段都早于作者脚本 —— 围栏晚于作者脚本就等于没装）。剥注释后判定：自己注释里的标签名会让判据误真。
const hostCode = stripComments(serveSrc);
const guardWired = (s) => /data-we-focus-guard="host"/.test(s)
  && /weFocusGuardSource\(\)/.test(s)
  && s.indexOf('data-we-focus-guard') > s.indexOf('data-we-site-root')
  && s.indexOf('data-we-focus-guard') > s.indexOf('data-we-shim')
  && s.indexOf('data-we-focus-guard') < s.indexOf('data-we-seed');
check('host injects the focus guard into web HTML (between shim and seed)', guardWired(hostCode));
check('负对照：拿掉注入腿 ⇒ 同一条判据变假',
  !guardWired(hostCode.replace('data-we-focus-guard="host"', 'data-we-x')));
check('focus guard module lives outside the renderer page dir (it is a host module, not page code)',
  existsSync(guardPath) && !existsSync(join(root, 'lib', 'webwallgl', 'we-focus-guard.js')));
check('host sends CORS for opaque-origin fetches', /Access-Control-Allow-Origin', '\*'/.test(serveSrc));
// ⚠️ 下面这条读**宿主半**：`buildInventory` 已搬进 `lib/inventory.js`（§★ W-B B1）。
check('inventory derives webLive via webFieldsFor', /webFieldsFor\(w, hasMedia, webMediaBase\)/.test(hostHalfSrc));
// 黑屏的**成因**：Desktop 的能力头栅栏（**外部宿主** `@deepseek-ai/dsh-host-webserver`
// 的 decideDesktopBrowserAccess —— 本仓没有该文件）只放行同源 frame，不透明源的沙箱 iframe 永远拿不到
// x-dsh-desktop-renderer → 插件路由一律 403。网页壁纸载荷因此必须走 host 自建的
// 独立 loopback 源，两处挂载共用同一段处理函数。
check('host 自建壁纸媒体源（独立 loopback 监听）',
  /let mediaOrigin = null/.test(mediaOriginSrc) && /function ensureMediaOrigin\(\)/.test(mediaOriginSrc)
    && /server\.listen\(0, '127\.0\.0\.1'/.test(mediaOriginSrc) && /function mediaOriginBase\(\)/.test(mediaOriginSrc));
check('scene-files 处理函数被双挂载（应用源 + 媒体源）',
  /function handleSceneFiles\(req, res, mount\)/.test(hostHalfSrc)
    && hostHalfSrc.includes("handleSceneFiles(req, res, 'media')")
    && hostHalfSrc.includes("handleSceneFiles(req, res, 'app')")
    && hostHalfSrc.includes('function traceMediaRequests('));
check('媒体源只服务 /scene-files 前缀', mediaOriginSrc.includes("pathname.startsWith(`${base}/scene-files/`)"));
// ── 场景载荷改走自建源：三处必须同时成立（少一处就退化成"静默回落"，或更糟：告警丢失）──
// 背景：`scene.pkg` 实测到 336MB，走应用源那条路挤不过首帧预算（那里还要买纹理解码与
// shader 编译），故场景载荷改走自建 loopback 源。三条判据把这次改动的**每个接缝**都钉住：
//   ① 宿主端出这个源，且门控按"库里真有可实时渲染的场景"（不是无条件起监听）；
//   ② 客户端消费宿主给的值，**不再自己拼 location.origin**（否则改动无声失效）；
//   ③ 媒体源接住 `/diag`，且用的是诊断族**同一个** handleDiag（否则渲染页告警 404 静默丢失）。
//
// ⚠️ 2026-09 修正：① 的**形态门控**被拿掉了 —— `mediaOriginBase()` 在原生浏览器形态下
// 恒返空串（它门控的是"网页壁纸的能力头栅栏"），而场景载荷要独立源的理由是**带宽**，
// 与宿主形态无关。旧断言（`await mediaOriginBase()`）因此钉住的是一个**已知会饿死**的写法，
// 现在改成钉 `ensureSceneMediaOrigin()`，并加负对照：退回旧写法必须被判红。
// ⚠️ 下面这组读**宿主半**：`sceneMediaBase` 的**产出点**已随清单构建族搬进 `lib/inventory.js`
//    （§★ W-B B1）。`mediaOriginApi` 的调用形态仍在 `lib/index.js`（被多族共用）⇒ 两处分开读。
check('宿主端出场景载荷的源，且按 sceneLive 门控（没有场景不多起监听）',
  /const sceneMediaBase = wallpapers\.some\(\(w\) => w\.sceneLive\) \? await mediaOriginApi\.ensureSceneMediaOrigin\(\) : ''/.test(hostHalfSrc)
    && /^\s*sceneMediaBase,$/m.test(hostHalfSrc));
{
  // 同一判据喂"改回旧写法"的源码：必须变假（旧写法在浏览器形态下恒空串 ⇒ 大包回落应用源）。
  const scenePinned = (s) => /const sceneMediaBase = wallpapers\.some\(\(w\) => w\.sceneLive\) \? await mediaOriginApi\.ensureSceneMediaOrigin\(\) : ''/.test(s)
    && !/sceneMediaBase = wallpapers\.some\(\(w\) => w\.sceneLive\) \? await mediaOriginApi\.mediaOriginBase\(\) : ''/.test(s);
  const mutated = hostHalfSrc.replace('? await mediaOriginApi.ensureSceneMediaOrigin()', '? await mediaOriginApi.mediaOriginBase()');
  check('负对照：把调用点改回 mediaOriginBase() ⇒ 同一条判据变假',
    mutated !== hostHalfSrc && scenePinned(mutated) === false && scenePinned(hostHalfSrc) === true,
    'mutated=' + (mutated !== hostHalfSrc));
}
{
  // `ensureSceneMediaOrigin` 里不得出现 mediaOriginNeeded / adapterOverride：
  // 那就是把形态门控偷偷加回来（判据只取该函数体，取不到就显式报缺）。
  const fn = (mediaOriginSrc.match(/function ensureSceneMediaOrigin\(\) \{[\s\S]{0,240}?\n {2}\}/) || [''])[0];
  check('ensureSceneMediaOrigin 只做懒启动（不读 mediaOriginNeeded / adapterOverride）',
    fn.includes('ensureMediaOrigin()') && !fn.includes('mediaOriginNeeded') && !fn.includes('adapterOverride'),
    fn ? 'body=' + fn.replace(/\s+/g, ' ').slice(0, 80) : 'function 未找到');
}
// 判据必须钉在**赋值表达式**上，而不是"文件里出现过 sceneMediaBase"：后者在"读进变量却
// 不用它"的写法下照样为真（实测：把 mediaBase 改成无条件 location.origin 时它不变红 ⇒
// 那是恒真式判据，属于 P3-16 点名的形态）。所以抠出 mediaBase 的赋值再断言它消费宿主值
// —— 场景路径消费 resolveSceneMediaBase()（issue #129：那里同时决定远程页面回落自身
// origin；宿主源是 127.0.0.1 loopback，远程客户端打它等于打自己）。
const mbAssign = (liveSrc.match(/const mediaBase = [\s\S]{0,220}?;/) || [''])[0];
check('客户端场景 mediaBase 的**赋值表达式**消费宿主给的源（经 resolveSceneMediaBase）',
  /isWeb \? /.test(mbAssign) && /resolveSceneMediaBase\(\)/.test(mbAssign)
    && !/const mediaBase = location\.origin/.test(mbAssign),
  mbAssign.replace(/\s+/g, ' ').slice(0, 90));
check('该源来自宿主载荷 inventory.sceneMediaBase',
  /const hostSceneBase = selection\.inventory && selection\.inventory\.sceneMediaBase/.test(liveSrc));
check('远程 http(s) 页面回落自身 origin；本机/自定义 scheme 维持宿主媒体源（issue #129）',
  /function originIsRemoteHttp\(origin\)/.test(liveSrc)
    && /u\.protocol !== "http:" && u\.protocol !== "https:"/.test(liveSrc)
    && /!\(h === "127\.0\.0\.1" \|\| h === "localhost"/.test(liveSrc)
    && /!originIsRemoteHttp\(typeof location !== "undefined" \? location\.origin : ""\)/.test(liveSrc));
check('negative control: 老的硬编码写法会被上一条判出',
  !liveSrc.includes('location.origin + "/wallpaper-engine/scene-files"'));
check('媒体源的 /diag 走诊断族同一个 handleDiag（同一份缓冲，且先于 scene-files 分派）',
  (() => {
    const diagAt = mediaOriginSrc.indexOf("pathname === '/diag'");
    const callAt = mediaOriginSrc.indexOf('mediaDiagHandler(req, res)');
    const sceneAt = mediaOriginSrc.indexOf("pathname.startsWith(`${base}/scene-files/`)");
    return diagAt > 0 && callAt > diagAt && sceneAt > diagAt
      && hostSrc.includes('onHandleDiag: mediaOriginApi.setDiagHandler')
      && /if \(onHandleDiag\) onHandleDiag\(handleDiag\)/.test(hostHalfSrc)
      && /let mediaDiagHandler = null/.test(mediaOriginSrc);
  })());
check('negative control: 调用点保持语句形态（加赋值前缀会被路由索引判成孤儿族模块）',
  /^\s*registerDiagRoutes\(webServer, \{$/m.test(hostSrc)
    && !/^\s*\w+\s*=\s*registerDiagRoutes\(/m.test(hostSrc));

// 封面（Now Playing artwork）：实测用户反馈「不显示歌曲封面」的根因是只问 Spotify。
// 现在通用路径是 media-control 自带的 artworkData（系统 MediaRemote，任何播放器都有），
// 且缓存后缀按 MIME 决定（PNG 存成 .jpg 会按错误类型解码）。
// 这套现为**回落实现**（lib/media/legacy.js），首选是 media-bridge 子进程（lib/media/*）
// —— 断言因此两边都盯：回落能力不能退化，新链路的接缝要在。
// ⚠️ 实现归属随 P2 拆包搬进**组件行**（lib/components/media-bridge/legacy.js），P-F 批 1c 出户到
// `packages/media-bridge/lib/legacy.js`：判据按**真源**读，候选表兼容三种排布，缺锚即判红。
const legacyBridgePath = ['packages/media-bridge/lib/legacy.js', 'lib/components/media-bridge/legacy.js',
  'lib/media/legacy.js']
  .find((rel) => existsSync(join(root, rel)));
const legacyBridgeSrc = legacyBridgePath ? readFileSync(join(root, legacyBridgePath), 'utf8') : '';
check('回落实现住在 media-bridge 组件行 legacy.js（回落路径还在）',
  Boolean(legacyBridgePath) && !existsSync(join(root, 'lib', 'media-bridge.js')),
  legacyBridgePath || '未找到 legacy 实现（组件行与 lib/media 都没有）');
check('封面走 media-control 的 artworkData（通用，不限 Spotify）',
  legacyBridgeSrc.includes('artworkData') && legacyBridgeSrc.includes('artworkMimeType')
    && legacyBridgeSrc.includes('function takeArtworkMac('));
check('例行轮询 --no-artwork（封面 base64 每秒几百 KB），换曲才取',
  legacyBridgeSrc.includes("'get', '--no-artwork'") && legacyBridgeSrc.includes('npNoArtwork'));
check('封面缓存按 MIME 定后缀并清旧文件',
  legacyBridgeSrc.includes('ARTWORK_EXT') && legacyBridgeSrc.includes('function writeArtwork(')
    && legacyBridgeSrc.includes("'artwork'"));
check('Spotify AppleScript 降为兜底', legacyBridgeSrc.includes('function fetchSpotifyArtwork('));
check('回落实现暴露 artworkMime 与 backend 标记',
  legacyBridgeSrc.includes('artworkMime: () => artworkMime') && legacyBridgeSrc.includes("backend: 'legacy'"));
check('回落实现尊重「音频已关」（不会偷偷开采集/申请权限）',
  legacyBridgeSrc.includes('if (audio) startAudio();'));
check('host 按扩展名回封面 Content-Type', serveSrc.includes("bmp: 'image/bmp'"));

// ── media-bridge 中间件的接缝（首选路径）────────────────────────────────────
// ── media 域真源映射（P2 拆包把实现搬进组件行）────────────────────────────────
// 上游把媒体域放在 `lib/media/<f>`；本分支随 P2 把整套实现搬进了**组件行**、P-F 批 1c 再出户到
// `packages/media-bridge/lib/**`。判据按真源读：出户包优先、组件行兼容、`lib/media` 兜底；
// 三处都没有时返回首选路径（后续 readFileSync 会响亮地 ENOENT）—— 绝不回落到"再调一次自己"。
const mediaSrcCandidates = (f) => ['packages/media-bridge/lib/' + f, 'packages/media-bridge/lib/routes/' + f,
  'lib/components/media-bridge/' + f, 'lib/media/' + f].map((rel) => join(root, rel));
const mediaSrcPath = (f) => mediaSrcCandidates(f).find((abs) => existsSync(abs)) || mediaSrcCandidates(f)[0];
const provSrc = readFileSync(mediaSrcPath('provision.js'), 'utf8');
const supSrc = readFileSync(mediaSrcPath('supervisor.js'), 'utf8');
// ⚠️ 门面面 = 媒体桥子包的**整面**（不是只有 index.js）：'中间件优先/回落/音频已关透传'这些形态
// 分布在 index.js 与 legacy.js/supervisor.js 里 ⇒ 只读一个文件会误报丢失（判据纪律：拆出的模块必须加进来）。
const mediaPkgDir = ['packages/media-bridge/lib', 'lib/components/media-bridge']
  .map((rel) => join(root, rel)).find((abs) => existsSync(abs));
const facadeSrc = (mediaPkgDir ? readdirSync(mediaPkgDir) : [])
  .filter((f) => f.endsWith('.js'))
  .map((f) => { try { return readFileSync(join(mediaPkgDir, f), 'utf8'); } catch { return ''; } }).join('\n');
check('产物表：darwin 通用包 / linux x64 musl / win32 双架构',
  provSrc.includes("'media-bridge-darwin-universal'")
    && provSrc.includes("'media-bridge-linux-x64-musl'") && provSrc.includes("'media-bridge-win32-x64.exe'"));
check('产物 sha256 全部固定（宁可回落也不执行未校验的二进制）',
  // ≥5：win32-arm64 是可选产物，Release 里没有时它能没有哈希（靠 x64 回落链）
  (provSrc.match(/[0-9a-f]{64}/g) || []).length >= 5 && provSrc.includes('MEDIA_BRIDGE_SHA256'));
check('魔数识别包含 macOS universal 的 fat 头', provSrc.includes('0xca') && provSrc.includes('0xfe'));
// win32-arm64 在 CI 里是可选产物（windows-11-arm runner 会卡）：没有它时 Windows ARM64
// 必须能回落到 x64（系统自带模拟），否则那台机器会直接掉到 legacy 实现。
check('Windows ARM64 有 x64 产物回落链',
  /MEDIA_BRIDGE_FALLBACKS/.test(provSrc)
    && /'media-bridge-win32-arm64\.exe': \['media-bridge-win32-x64\.exe'\]/.test(provSrc));
check('产物解析链：环境变量 → 插件 bin/ → 下载缓存 → Release 下载',
  provSrc.includes('DSH_WE_MEDIA_BRIDGE') && provSrc.includes("join(PLUGIN_ROOT, 'bin', asset)")
    && provSrc.includes('cacheDirFor(dataDir, tag)') && provSrc.includes('releases/download/'));
check('协议握手校验 hello.protocol（版本不符不硬来）',
  supSrc.includes('hello.protocol') && supSrc.includes('PROTOCOL_VERSION'));
check('事件与响应按字段分流（不能假设下一行是响应）',
  supSrc.includes('if (msg.event)') && supSrc.includes('pending.has(msg.id)'));
check('频谱走订阅推送（50ms），不是每帧去问', supSrc.includes('SPECTRUM_INTERVAL_MS') && supSrc.includes("events.push('spectrum')"));
check('音频关时用 --no-audio（连音频授权都不会弹）', supSrc.includes("'--no-audio'"));
check('位置外推用 updatedAtMs + rate（暂停不外推）',
  supSrc.includes('playing && pb.positionSource !== ') && supSrc.includes('Date.now() - ref'));
check('事件里已外推的位置不重复外推（参考时刻改写成事件时刻）',
  supSrc.includes("pb.positionSource === 'interpolated'") && supSrc.includes('pb.updatedAtMs = refMs'));
check('歌词换算成渲染页要的 [[秒, 文本], …]（含 LRC offset）',
  supSrc.includes('export function lyricsToTuples') && supSrc.includes('offsetMs'));
// 状态缓存兜底：中间件的 status 事件只在元数据源报错时发时，音频源
// idle→preparing→running 的变化不通知 —— 消费端只在启动时读一次 status，会永远停在
// preparing（频谱有数据、客户端却拿不到）。所以插件这层自己也兜底刷新，两层互不依赖。
check('supervisor 兜底刷新 status（不依赖中间件的事件是否齐全）',
  /const STATUS_REFRESH_MS = /.test(supSrc) && /function refreshStatusSoon\(/.test(supSrc)
    && /refreshStatusSoon\(\);/.test(supSrc));
check('崩溃退避重启 + 超预算回落（onFatal）',
  supSrc.includes('MAX_RESTARTS') && supSrc.includes('onUnexpectedExit') && supSrc.includes('onFatal'));
check('空闲停进程 + 下次访问自动唤醒', supSrc.includes('IDLE_STOP_MS') && supSrc.includes('asleep'));
// Windows 黑框回归：GUI 宿主（DSH Desktop / Electron）spawn 控制台子进程时必须带
// windowsHide（= Win32 CREATE_NO_WINDOW），否则会弹出/闪一个黑框。中间件与 ffmpeg
// 的每一处 spawn 都要带上；macOS/Linux 专属的调用（media-control/playerctl/xattr 等）
// 不在 Windows 上跑，但一并带上也无害。
const winHideSites = [
  { file: 'lib/media/supervisor.js', spawn: /spawn\(binPath[\s\S]{0,80}\.\.\.a\.opts/, minFlags: 2 },
  { file: 'lib/transcode.js', spawn: /spawn\(a\.file[\s\S]{0,80}\.\.\.a\.opts/, minFlags: 2 },
  { file: 'lib/media/legacy.js', spawn: /spawnSync\('ffmpeg'[\s\S]{0,220}windowsHide: true/, minFlags: 1 },
];
const winHideBad = [];
for (const site of winHideSites) {
  // ⚠️ 真源解析：表内保留**上游坐标**（lib/transcode.js、lib/media/legacy.js），读取时按候选表
  // 定位本分支的真源 —— P2 拆包把媒体域实现搬进了组件行（P-F 批 1c 再出户到 `packages/media-bridge/lib/`），
  // 而 lib/transcode.js 在本分支是 lib/media/transcode.js。找不到就落回原路径（下面的判据会以"读了空/缺失"响亮地判红）。
  const siteBase = site.file.split('/').pop();
  const siteAbs = [join(root, site.file), join(root, 'lib', 'media', siteBase),
    join(root, 'packages', 'media-bridge', 'lib', siteBase),
    join(root, 'lib', 'components', 'media-bridge', siteBase)]
    .find((abs) => existsSync(abs)) || join(root, site.file);
  const body = readFileSync(siteAbs, 'utf8');
  const flags = (body.match(/windowsHide: true/g) || []).length;
  if (!site.spawn.test(body) || flags < site.minFlags) winHideBad.push(site.file);
}
check('平台 spawn 点都带 windowsHide（GUI 宿主在 Windows 上不出黑框）',
  winHideBad.length === 0, winHideBad.join(', ') || '已覆盖中间件 / ffmpeg 转码 / 回落路径');
check('门面：中间件优先，失败回落 legacy 并留下原因',
  facadeSrc.includes('fallBackTo(') && facadeSrc.includes("backend: live ? 'bridge'"));
check('门面支持 DSH_WE_MEDIA_LEGACY=1 强制走 legacy 回落', facadeSrc.includes('DSH_WE_MEDIA_LEGACY'));
check('门面把「音频已关」传给回落实现（不让回落偷偷开采集）',
  facadeSrc.includes('createLegacy({ dataDir, cacheBaseDir: cacheRoot, log, audio: optsRef.audio })'));
// 媒体状态族已搬到 lib/routes/now-playing.js（P2-11）。判据按 diag 族的同一形态翻成三条：
// ① URL 形状由**真实注册表**（mock webServer 跑一遍 apply 的结果）断言 —— 与代码住在哪个文件无关；
// ② 该路由的实现契约在**它现在所在的文件**里断言；③ 正文侧钉住"已搬走"（零路径字面量 + 一次调用）。
const nowPlayingSrc = readFileSync(mediaSrcPath('now-playing.js'), 'utf8');
const nowPlayingPaths = ['/media-status', '/audio-spectrum', '/now-playing', '/now-playing/artwork', '/media-control'];
const missingNowPlaying = nowPlayingPaths.filter((p) => !routes.some((r) => r.path === '/wallpaper-engine' + p));
check('host 路由形状不变（客户端/渲染页无需感知后端切换）',
  missingNowPlaying.length === 0, missingNowPlaying.join(', ') || '五条都在');
check('negative control: 同一条判据能点出没注册的路径',
  ['/media-status', '/not-registered'].filter((p) => !routes.some((r) => r.path === '/wallpaper-engine' + p)).join() === '/not-registered');
check('spectrum 路由回报 running（客户端据此决定装不装音频桥）',
  nowPlayingSrc.includes('running: st.audio.status ===') && nowPlayingSrc.includes('mediaBackend.status()'));
// ⚠️ 拆成两个面看（这是**口径修正**，不是放宽）：
//   · "门面**正文**零路径字面量" ⇒ 只看 lib/index.js（族文件的字面量本来就该在族文件里，
//     把加宽后的 hostSrc 拿来判这一半会把正确结构判成假红）；
//   · "一次调用" ⇒ 门面或**组件行入口**任一处有即可（本分支该族整体出户，调用点在组件入口）。
check('媒体状态族已搬出 lib/index.js（正文零路径字面量 + 一次调用）',
  !/path: `\$\{BASE\}\/(media-status|audio-spectrum|now-playing)/.test(readFileSync(join(root, 'lib', 'index.js'), 'utf8'))
    && /registerNowPlayingRoutes\(webServer, \{/.test(hostSrc));
check('settings 白名单保留 mediaLyricsOnline（否则开关会被丢）', hostKeeps('mediaLyricsOnline', true));

// 客户端：封面必须转成**自包含 data URL** —— 宿主给的是插件路由，
// 沙箱壁纸在 Desktop 上取不到（能力头栅栏只放行同源 frame）。
check('client 把封面降采样成 data URL 再推给壁纸',
  src.includes('async function fetchArtworkDataUrl(') && src.includes('createImageBitmap(')
    && src.includes('toDataURL("image/jpeg"') && src.includes('thumbnail: mediaArtData || undefined'));
check('client 按曲目缓存封面并重试（宿主下载封面是异步的）',
  src.includes('function scheduleArtworkFetch(') && src.includes('MEDIA_ART_MAX_TRIES'));
check('client 透传歌词与 albumArtist（[[秒, 文本]] 原样给渲染页）',
  src.includes('lyrics: Array.isArray(m.lyrics) && m.lyrics.length ? m.lyrics : undefined')
    && src.includes('albumArtist: m.albumArtist || ""'));
check('client 的 push key 带歌词版本（歌词晚到也要再推一帧）',
  src.includes('const lyrRev =') && src.includes('lyrRev].join('));
check('音频桥按宿主 running 装卸（装了桥 = 渲染页放弃自带音频源）',  src.includes('function syncAudioBridge(frame, running)') && src.includes('syncAudioBridge(frame, d.running === true)'));
// 媒体控制面（控制反转）：场景壁纸里 Now Playing 组件的按钮由渲染页推断成动作，
// 打到宿主注入的控制面 → POST /media-control → 中间件真控播放器。判据按**源码形态**
// 写成谓词（于是负对照能喂合成输入），三条缺一不可：控制面装载（五个动作齐）、
// 与显示面分离（按 window 记忆 + 卸载时才清）、动作名与宿主路由契约一致。
{
  const CONTROL_ACTIONS = ['play', 'pause', 'playPause', 'skipNext', 'skipPrevious'];
  const controlWiring = (text) =>
    text.includes('function syncMediaControl(frame)')
    && text.includes('wp.setMediaControl(controls)')
    && text.includes('mediaControlWin === win')
    && text.includes('wp.setMediaControl(null)')
    && CONTROL_ACTIONS.every((a) => text.includes('"' + a + '"'))
    && text.includes('apiPostJson("/media-control", { action })');
  check('client 装媒体控制面（五个动作 → 宿主 /media-control；装一次按 window 记忆、卸载时清）',
    controlWiring(src), '控制反转的宿主半：壁纸按钮 → 真实播放器');
  check('negative control: 卸载不清 / 不按 window 记忆 / 缺动作的三种坏形态都被判出',
    !controlWiring('function syncMediaControl(frame) { wp.setMediaControl(controls); }')
      && !controlWiring(src.replace('mediaControlWin === win', 'false'))
      && !controlWiring(src.replace('apiPostJson("/media-control", { action })', 'apiJson("/now-playing")')));
}
check('host 侧 /media-control 只收 POST + 动作走 mediaBackend.control（不在路由里触发懒启动）',
  nowPlayingSrc.includes('path: `${BASE}/media-control`')
    && nowPlayingSrc.includes('mediaBackend.control(action)')
    && !/media-control[\s\S]{0,700}ensureMedia\(\)/.test(nowPlayingSrc));
// 「在线歌词 / 系统音频反应 / 媒体信息」三键已**退役为常开**（用户口径：默认接入，
// 设置页与侧边栏都不再提供页面定义）。三件事一起钉：① schema 侧 kind 'const'（读取
// 时老配置里的关闭值被默认值取代）+ 默认 on；② UI 侧两个来源（设置页签渲染器 /
// 快捷播放面板）按**代码**（剥注释）都不得再出现这三个开关。
{
  const RETIRED_LABELS = ['系统音频反应', '媒体信息', '在线歌词'];
  const leftoversIn = (text) => RETIRED_LABELS.filter((label) => text.includes(label));
  const tabsCode = stripComments(tabsSrc);
  const qpCode = stripComments(readFileSync(join(root, 'src', 'quick-panel.js'), 'utf8'));
  check('三键退役为常开（schema kind const + 默认接入）',
    schemaMod.DEFAULTS.audioSource === 'auto' && schemaMod.KINDS.audioSource.kind === 'const'
      && schemaMod.DEFAULTS.mediaIntegration === true && schemaMod.KINDS.mediaIntegration.kind === 'const'
      && schemaMod.DEFAULTS.mediaLyricsOnline === true && schemaMod.KINDS.mediaLyricsOnline.kind === 'const',
    'kinds=' + schemaMod.KINDS.audioSource.kind + '/' + schemaMod.KINDS.mediaIntegration.kind
      + '/' + schemaMod.KINDS.mediaLyricsOnline.kind
      + ' · defaults=' + schemaMod.DEFAULTS.audioSource + '/' + schemaMod.DEFAULTS.mediaIntegration
      + '/' + schemaMod.DEFAULTS.mediaLyricsOnline);
  check('三个开关的页面定义已从设置页与快捷面板移除（按代码判，注释里提到不算）',
    leftoversIn(tabsCode).length === 0 && leftoversIn(qpCode).length === 0,
    '残留：' + ([...leftoversIn(tabsCode), ...leftoversIn(qpCode)].join(', ') || '无'));
  // 负对照：同一条判据喂合成文本 —— 真出现开关文案必须被判出（判据不是恒真）。
  check('negative control: 合成代码里的开关文案会被同一条判据点出',
    leftoversIn('switchRow("在线歌词", v)').join(',') === '在线歌词'
      && leftoversIn('switchRow("媒体信息", v) && switchRow("系统音频反应", v)').length === 2);

// 用户口径（更新）：侧栏壁纸列表的类型档（全部 / 场景 / 网页 / 视频 / 图片）
// **与设置页是同一个键 `typeFilter`** —— 类型变动两处同步、不做单独的档（原「面板本地
// 瞬态 qpType + 两层交集空态兜底」整套退役：不再 setTransient("qpType")、不再有默认档
// 行、空态不再有"没有交集/完整操作链"提示）。「图片」是后补的一档（上传的单文件图片
// 壁纸）：判据按**同一份档位表**逐档核对，再加一条负对照 —— 少一档必须被判红。
  const QP_TYPE_ROWS = [['all', '全部'], ['scene', '场景'], ['web', '网页'], ['video', '视频'], ['image', '图片']];
  const sideTypeFilterOk = (text) => text.includes('function qpTypes()')
    && QP_TYPE_ROWS.every(([id, label]) => text.includes('id: "' + id + '"')
      && (text.includes('label: weT("' + label + '")') || text.includes('label: weT("' + label + '", null,')))
    && text.includes('w.type !== typeFilter');
  check('侧栏列表类型筛选：五档齐全（含「图片」）+ 与设置页同键同步（setSetting typeFilter，单独档已退役）',
  // i18n（中文原文即键）之后：容器从文件顶层常量改成 `qpTypes()`（每次渲染现建，
  // 否则文案会冻在加载期），每档 label 各自走 `weT("…")` —— 判据只认"档位 id 仍绑着
  // 同一句原文"，不认包装形态（认形态的判据会在下一次改写法时静默失效）。
    sideTypeFilterOk(qpSrc)
    && qpSrc.includes('setSetting("typeFilter", e.target.value)')
    && !qpSrc.includes('setTransient("qpType"')
    && !qpSrc.includes('sel.qpType')
    && !src.includes('qpType: "all"')
    && !qpSrc.includes('没有交集')
    && !qpSrc.includes('完整操作链'));
  // 负对照：同一条判据喂"少一档"的合成文本，必须被判红（判据不是恒真）。
  check('negative control: 少一档（缺「图片」）会被同一条判据点出',
    !sideTypeFilterOk(qpSrc.replace('{ id: "image", label: weT("图片") },', ''))
      && sideTypeFilterOk(qpSrc));
  // ↑ 本段与"三键退役"共用同一个 `{ … }` 块（原先那条 check 的收尾 `}` 就在这里）——
  //   不要再包一层 `{}`：块会多开一层，整个文件在 EOF 报 "Unexpected end of input"。
}
// 用户口径：设置页切「类型」不得把**正在应用**的壁纸干掉 ⇒ 类型档只筛列表与轮播
// 候选、不入播放闸门（keepPlayingWallpaper：分级拦播放，类型档没有入参）；轮播在场
// 时「仅被类型档排除」也不换台（typeOnlyExcluded）。分级闸门照旧干掉并解释 —— 那
// 一半钉在 verify-playback-controls E 段，这里钉类型档这一半。
{
  const gateKeepsPlaying = (clientText, prepText) =>
    clientText.includes('const keepCurrent = keepPlayingWallpaper(cur, selection.contentRatingFilter)')
      && clientText.includes('const typeOnlyExcluded = keepCurrent')
      && prepText.includes('if (!w || !keepPlayingWallpaper(w, selection.contentRatingFilter))');
  check('类型档不入播放闸门：revalidate 丢弃走 keepPlayingWallpaper + 换台豁免 typeOnlyExcluded',
    gateKeepsPlaying(src, prepSrc));
  // 负对照：把闸面换回「读类型档」的旧形态（变异输入），同一条判据必须判否。
  check('negative control: 闸门改回读类型档的形态会被同一条判据点出',
    !gateKeepsPlaying(src, 'if (!w || !isRotatableWallpaper(w, selection.contentRatingFilter, selection.typeFilter))'));
}
// 场景/网页实时渲染**默认开** —— 这是用户可见的默认值，三处一起钉：DEFAULTS 的值、
// KINDS 的类型（boolTrue = 缺键读作开）、以及面板/活层的判据形态（`!== false`，
// truthy 判断会在缺键时静默变成"关"）。缺键必须两侧都读作开。
{
  const countOf = (s, needle) => s.split(needle).length - 1;
  check('「场景实时渲染」默认开（DEFAULTS + KINDS boolTrue + 缺键两侧读作开）',
    schemaMod.DEFAULTS.sceneLive === true && schemaMod.KINDS.sceneLive.kind === 'boolTrue'
      && schemaMod.sanitizeFromSchema({}, 'client').sceneLive === true
      && sanitizeHost({}).sceneLive === true,
    'DEFAULTS.sceneLive=' + String(schemaMod.DEFAULTS.sceneLive));
  check('面板/活层判据是 `!== false` 形态（面板 ≥4 处 + live 层 ≥1 处）',
    countOf(tabsSrc, 'sel.sceneLive !== false') >= 4
      && countOf(liveSrc, 'selLike.sceneLive !== false') >= 1,
    'panel=' + countOf(tabsSrc, 'sel.sceneLive !== false') + ' live=' + countOf(liveSrc, 'selLike.sceneLive !== false'));
  // 负对照：默认翻成关，同一条判据必须变假 —— 证明上面两条不是恒真。
  const savedSceneLiveDefault = schemaMod.DEFAULTS.sceneLive;
  schemaMod.DEFAULTS.sceneLive = false;
  const flipped = schemaMod.DEFAULTS.sceneLive === true
    && schemaMod.sanitizeFromSchema({}, 'client').sceneLive === true;
  schemaMod.DEFAULTS.sceneLive = savedSceneLiveDefault;
  check('负对照：默认改成关 ⇒ 同一条判据变假', flipped === false && schemaMod.DEFAULTS.sceneLive === true);
}
check('host builds the property seed from project.json + 覆盖值',
  /function buildSeedScript\(entryAbs, token\)/.test(hostSrc) && /parseUserPropDefs\(pj, overrides/.test(hostSrc)
    && /userPropsFor\(token\)/.test(hostSrc));
check('host 侧属性解析模块（order 浮点 / combo 保类型 / 逐键本地化 / condition）',
  existsSync(join(root, 'lib', 'we-props.js'))
    && /parseUserPropDefs/.test(readFileSync(join(root, 'lib', 'we-props.js'), 'utf8')));
check('settings 白名单保留 userProps（按 token 存标量）',
  JSON.stringify(sanitizeHost({ userProps: { tok: { c: 'x', n: 1, obj: { bad: 1 } } } }).userProps)
    === '{"tok":{"c":"x","n":1}}');
// i18n 之后按钮文案走 `weT("…")`（中文原文即键）—— 判据改认带包装的形态，
// 顺序判据仍锚在"属性入口在播放/暂停按钮之前"这个**位置关系**上。
check('「壁纸属性」按钮：仅场景/网页壁纸 + 常规按钮样式（并入播放控制行、排在「暂停」之前）',
  tabsSrc.includes('(current.type === "scene" || current.type === "web") && sel.propsUrl')
    && !tabsSrc.includes('we-picker__btn--props')
    && tabsSrc.indexOf('weT("壁纸属性")') !== -1
    && tabsSrc.indexOf('weT("壁纸属性")') < tabsSrc.indexOf('weT("暂停")'));
// 「侧栏播放控制行」这一节钉两件事：全局主按钮款式不被二次覆盖、窄容器下控制行不溢出。
// 两件都只看**当前形态**，不涉及某枚具体按钮。
{
  // 全局 primary 款式仍是"实心底 + 墨随 accent"（styles-ext.js 那条未限定作用域的覆盖
  // 是历史上真实发生过的隐形 bug —— 这里正面钉住 panel 段那条主规则还在、且 styles-ext
  // 中不再有第二份 .we-picker__btn--primary 覆盖把它压掉）。
  const extStyleSrc = readFileSync(join(root, 'src', 'styles-ext.js'), 'utf8');
  check('全局主按钮款式不被 styles-ext 二次覆盖（隐形 bug 防复发）',
    stylesSrc.includes('color: var(--we-accent-ink, #fff);')
      && !/^\s*\.we-picker__btn--primary\s*\{/m.test(extStyleSrc),
    'ext 覆盖规则数=' + (extStyleSrc.match(/^\s*\.we-picker__btn--primary\s*\{/m) || []).length
      + ' extStyleSrc.length=' + extStyleSrc.length);
  // 窄容器不溢出：播放控制行多枚按钮（暂停/刷新/清除，外加场景壁纸的「壁纸属性」），
  // 官方右栏最窄 276px 时可能放不下 ⇒ 控制行必须允许整组折行、按钮组带
  // margin-left: auto（折行时靠右）。判据钉两个声明在**同一条规则**上。
  const curRowRule = stylesSrc.match(/\.we-qp__current\s*\{[^}]*\}/);
  const actsRule = stylesSrc.match(/\.we-qp__current-actions\s*\{[^}]*\}/);
  check('窄容器防溢出：控制行 flex-wrap + 按钮组 margin-left: auto（折行右对齐）',
    Boolean(curRowRule) && /flex-wrap:\s*wrap/.test(curRowRule[0])
      && Boolean(actsRule) && /margin-left:\s*auto/.test(actsRule[0]),
    'row=' + (curRowRule ? curRowRule[0].replace(/\s+/g, ' ').trim() : 'MISSING')
      + ' | acts=' + (actsRule ? actsRule[0].replace(/\s+/g, ' ').trim() : 'MISSING'));
}
check('属性面板热更新走 __wp.updateWebProps',
  src.includes('function applyUserProps(') && src.includes('wp.updateWebProps(wire)'));
check('属性面板值以渲染页实时表为准（getProperties）',
  src.includes('wp.getProperties()') && src.includes('function loadUserPropDefs('));
// 求值器自 P1-7 起是**独立模块** src/we-cond.js（构建期内联回客户端作用域）。
// 断言改为三件事：模块在位、产物里确实有它、client.js 不再自带实现 —— 免得抽出去之后
// 两边各留一份（那正是要防的漂移）。
const weCondSrc = readFileSync(join(root, 'src', 'we-cond.js'), 'utf8');
const bundleSrc = readFileSync(join(root, 'lib', 'client.js'), 'utf8');
check('条件求值器已抽成独立模块并被内联（fail open）',
  /\(function weEvalCondition|function weEvalCondition\(/.test(weCondSrc)
    && weCondSrc.includes('function weCondParse(')
    && bundleSrc.includes('function weEvalCondition(')
    && !src.includes('function weEvalCondition('));
check('场景就绪后回放覆盖值（无 HTML 种子通道）',
  // 声明留在 client.js（用户属性域），调用点在实时管线的挂载路径里（live-layer.js）。
  src.includes('function applyStoredUserProps(') && liveSrc.includes('applyStoredUserProps(selection)'));
// 用户口径：库视图只保留**顶部**返回按钮（底部那个是重复的）。
// 计数口径：UI 重构后选择壁纸是**页内下钻视图**（不再有遮罩/弹框）⇒ closePicker
// 只剩顶部「返回」按钮这 1 处绑定。
// P3-11 阶段 2：库视图标记已搬到 src/picker-modal.js ⇒ 这三条文本断言跟着**所属文件**走
// （同下面诊断族那批"按所属文件分家"的口径）。计数口径仍覆盖**整个客户端半**
// （client.js + picker-modal.js），所以在别处再加一个返回/关闭绑定照样会被判出。
const modalSrc = readFileSync(join(root, 'src', 'picker-modal.js'), 'utf8');
const clientHalf = src + '\n' + modalSrc;
// 官方侧栏接入（src/sidebar-right.js）：能力门 / 两段注册 / 模式真源的断言读它。
const sidebarSrc = readFileSync(join(root, 'src', 'sidebar-right.js'), 'utf8');
check('库视图只留顶部返回按钮（页内下钻，无遮罩绑定）',
  (clientHalf.match(/onClick: closePicker/g) || []).length === 1
    && modalSrc.includes('we-picker__modal-foot" },'),
  // ⚠️ 此前这里是 `&& modalSrc.includes('ESC 返回')` —— 断言**提示文案**，改一句话或换语言
  //    就判红（ADR-0007），已撤除。ESC 本身**不改动**：它由 verify-client.mjs 的
  //    「0b：ESC 关闭 picker」做**行为断言**（真派发 Escape + 非 Escape 负对照），
  //    比在这里读一句静态文案强得多 —— 别再加静态复制品。
  'closePicker 绑定数=' + ((clientHalf.match(/onClick: closePicker/g) || []).length));
// ── 抽屉形态：右侧左滑、装快捷播放面板 ──
// 钉三件事：滑动方向与宽度（`translateX`，不得出现 `translateY`）、内容与官方侧栏同源
// （QuickPanel，不另建 WallpaperPicker 副本）、弹框所有权只走一套机制
// （`repoPanelOwnsModal` 必须不存在）。
check('抽屉右侧左滑（360px、translateX；不再是顶部下落的 25vw/translateY）',
  stylesSrc.includes('width: 360px; max-width: 92vw;')
    && /we-repo-panel\s*\{[^}]*transform: translateX\(102%\)/.test(stylesSrc)
    && !/we-repo-panel\s*\{[^}]*translateY/.test(stylesSrc));
// 断言的是**机制**（同一个组件、壳只差 dock），不冻结 props 的字面形状 —— 面板渲染器
// 后来以 prop 形式加进来，写死 `{ dock: "drawer" }` 会让这条正确的改动判红（ADR-0007）。
check('抽屉与官方侧栏共用同一份 QuickPanel（不再是 WallpaperPicker 副本）',
  /React\.createElement\(QuickPanel, \{ dock: "drawer"/.test(src)
    && !src.includes('repoPanel: true')
    && !src.includes('repoPanelOwnsModal'));
check('官方侧栏接入用能力门 + 可选服务（不写进 inject，低版本宿主不会 park）',
  src.includes('installSidebarRight(ctx)')
    && sidebarSrc.includes('ctx.slots.inject("sidebar.right.pane.tab"')
    && sidebarSrc.includes('ctx.get("sidebarRightTabs")')
    && sidebarSrc.includes('ctx.get("sidebarRight")'));
// ── 侧栏三档页签（壁纸 / 外观 / 播放）──────────────────────────────────────
// 用户口径：设置页的「外观」「播放」两页也要能在侧栏快捷调（调参数时实时看壁纸效果）。
// 三件事各一条判据：① 页签栏的位置（在「轮播」之下 —— 当前壁纸与轮播三档都显示）；
// ② 两页与设置页**共用同一批渲染器**（surface 档少画设置页专属分组），不许在侧栏
// 自写一份控件；③ 页签记忆是 UI 状态（localStorage，不进 config.json）。
{
  const QP_TAB_ROWS = [['wallpaper', '壁纸'], ['appearance', '外观'], ['playback', '播放']];
  // 页签栏夹在「轮播」与「底栏」之间（三个锚点都是只在对应节出现的类名）。
  const tabBarBetween = (text) => {
    const t = text.indexOf('we-tabs we-qp__tabs');
    return t >= 0 && text.indexOf('we-qp__group') < t && t < text.indexOf('we-qp__foot');
  };
  const qpTabsOk = (text) => text.includes('const QP_TABS = [') && tabBarBetween(text)
    && QP_TAB_ROWS.every(([id, label]) => text.includes('id: "' + id + '"')
      && text.includes('label() { return weT("' + label + '")'));
  check('侧栏三档页签齐全（壁纸 / 外观 / 播放）且页签栏在「轮播」之下、底栏之上', qpTabsOk(qpSrc));
  check('negative control: 页签栏挪到「轮播」之上会被同一条判据判出',
    !tabBarBetween('we-tabs we-qp__tabs … we-qp__group … we-qp__foot')
      && tabBarBetween('we-qp__group … we-tabs we-qp__tabs … we-qp__foot'));
  check('侧栏页签记忆只进 localStorage（同 qp-view / picker-tab 口径，不进 config.json）',
    qpSrc.includes('localStorage.getItem(QP_TAB_KEY)')
      && qpSrc.includes('localStorage.setItem(QP_TAB_KEY, id)')
      && !qpSrc.includes('setSetting("qpTab"') && !qpSrc.includes('"qpTab"'));
  // 两页 = 设置页同名页签的同一批渲染器；侧栏不再自写控件（此前那份手写的「声音」组
  // 已并回渲染器 —— 它的提示语当时已经和设置页不一致了）。
  const sharedRenderers = (text) => text.includes('renderAppearanceTab(sidebarRenderCtx(')
    && text.includes('renderEffectsTab(sidebarRenderCtx(')
    && (text.match(/renderAudioTab\(sidebarRenderCtx\(/g) || []).length === 2
    && !/switchRow\(weT\("壁纸音轨"/.test(text)
    && !/SliderRow\(weT\("音量"/.test(text);
  check('侧栏「外观」「播放」两页与设置页共用同一批渲染器（壁纸页那份声音组也已并回）',
    sharedRenderers(qpSrc));
  check('negative control: 在侧栏自写一份音量行会被同一条判据判出',
    !sharedRenderers(qpSrc + '\nswitchRow(weT("壁纸音轨"), true, () => {});\n'));
  // 渲染器的 surface 档：侧栏档与设置页共用渲染器，差异一律走 `surface` 门 ——
  // 行为级 golden 在 verify-client.mjs。
  const gated = (text, label) => new RegExp('!sidebarSurface &&[\\s\\S]{0,240}?weT\\("' + label + '"\\)').test(text);
  // ⚠️ 分档（ADR-0008 D4 **三次修订**，用户口径）：**「全局字体」两档都画**。
  //    二次修订曾把它单向迁进侧栏（门 `!sidebarSurface` 反转为 `sidebarSurface &&`），随后
  //    用户在设置页找不到该节、报"字体自定义被干掉了" —— 用户口径是"两边都有"。现在**两个
  //    方向都不带 surface 门**，折叠门（`fontOpen`，默认收起）保留；「输入光标」照旧两档都画。
  //    行层面的差异（玻璃高级行收在侧栏折叠块 / 预设方案只在设置页）仍由下面 MORE_CASES 钉。
  // ⚠️ 负向后顾 `(?<!!)`：不加它的话 `!sidebarSurface &&` 也含 `sidebarSurface &&`
  //    子串 ⇒ "门方向反了"的文本照样判绿（负对照会失效）。窗口 800 覆盖折叠头到节标签
  //    的 656 字符。
  const gatedSidebar = (text, label) => new RegExp('(?<!!)sidebarSurface &&[\\s\\S]{0,800}?weT\\("' + label + '"\\)').test(text);
  check('「全局字体」节两档都画（两个方向的 surface 门都已摘掉；折叠门保留；输入光标照旧无门）',
    !gated(tabsSrcWithFontSection, '全局字体') && !gatedSidebar(tabsSrcWithFontSection, '全局字体')
      && tabsSrcWithFontSection.includes('open && switchRow(weT("字体自定义"')
      && !gated(tabsSrcWithFontSection, '输入光标'));
  check('播放页的准备与诊断行（出图来源 / 实时帧 / 自定义画面 / 帧率上限 / 源信息 / 转码进度）只在设置页档渲染',
    ['出图来源', '实时帧', '自定义画面', '帧率上限'].every((label) => gated(tabsSrc, label))
      && tabsSrc.includes('!sidebarSurface && sel.type === "video" && sel.mediaInfo')
      && tabsSrc.includes('!sidebarSurface && sel.type === "video" && sel.transcodeState === "working"'));
  // 负对照只测**判据本身的牙**（喂合成文本），不断产品状态 —— 产品的"两档都画"由上面那条
  // 正面判据负责；把两者混在一条里，会让负对照因产品的红而红，掩盖"判据是否恒真"这个问题。
  check('negative control: 任一方向的 surface 门加回「全局字体」都会被判出（判据不是恒真）',
    gated('!sidebarSurface && React.createElement("div", { className: "we-picker__section" },\n'
      + '  React.createElement("span", { className: "we-picker__section-label" }, weT("全局字体")),', '全局字体') === true
    && gatedSidebar('sidebarSurface && React.createElement("div", { className: "we-picker__section" },\n'
      + '  React.createElement("span", { className: "we-picker__section-label" }, weT("全局字体")),', '全局字体') === true);
  check('侧栏档空态 CTA 切回壁纸页（不是设置页的库下钻）',
    tabsSrc.includes('sidebarSurface ? onPickWallpaper : onOpenPicker')
      && tabsSrc.includes('sidebarSurface ? weT("去挑一张 ›") : weT("选择壁纸")')
      && qpSrc.includes('onPickWallpaper: () => switchQpTab("wallpaper")'));
  // ── 侧栏壁纸档的「壁纸属性」（用户口径：属性要在侧栏里调，不要跳设置页）──────
  // 交互口径 = **页内下钻**：点入口把壁纸页内容区整区换成属性面板（列表让位），
  // 顶部「返回」/ 再点一次入口退出 —— 与设置页库视图那套下钻同一形态（那里是
  // pickerOpen 顶掉 renderActiveTab）。面板本体与设置页**共用同一个开关与同一个
  // 渲染器**（`propsPanelOpen` / `renderUserPropsPanel`），不许在侧栏另存一份。
  {
    // ① 入口在**页签栏下方**、独占整行、无背景（用户口径）。
    {
      // 锚点顺序：页签栏 → 入口 → **内容区**。⚠️ 内容区锚点不能用 `const tabBodyClass`
      //（那句在组件顶部声明，索引反而比页签栏更靠前），要用它被当作 render 参数的落点。
      const btnBelowTabs = (text) => {
        const tabs = text.indexOf('we-tabs we-qp__tabs');
        const btn = text.indexOf('we-qp__propsbtn');
        const area = text.indexOf('className: tabBodyClass');
        return tabs !== -1 && btn !== -1 && area !== -1 && tabs < btn && btn < area;
      };
      check('「壁纸属性」入口在页签栏下方、内容区之前（三档同一位置）', btnBelowTabs(qpCode));
      check('negative control: 把入口挪到页签栏之上会被同一条判据判出',
        !btnBelowTabs('we-qp__propsbtn … we-tabs we-qp__tabs … const tabBodyClass'));
      /** `.we-qp__propsbtn` 的**任意**规则（含 is-on / @supports 各态）里声明过透明边框吗。
       *  按"声明过没有"判，而不是"最后一条是什么"：级联里最后一条会被 is-on 那条盖住，
       *  于是"注入透明边框"这种变异反而判不出来（负对照会假红，实测踩过）。 */
      const declaresTransparentBorder = (styles) =>
        /\.we-qp__propsbtn(?:[^{}]*)\{[^}]*border-color:\s*transparent/.test(styles);
      // 用户口径（最终版）：整行、**保留边框**、文字居中、字号与页签标签一致（12px）。
      // 判据只写一次（命名谓词），正判据与负对照调同一个 —— 负对照喂变异输入。
      const entryStyled = (styles, code) => code.includes('we-picker__btn we-qp__propsbtn')
        && /\.we-qp__propsbtn \{[^}]*width: 100%/.test(styles)
        && /\.we-qp__propsbtn \{[^}]*justify-content: center/.test(styles)
        && /\.we-qp__propsbtn \{[^}]*font-size: 12px/.test(styles)
        && /\.we-tabs__tab \{[^}]*font-size: 12px/.test(styles)
        // 边框：所有 .we-qp__propsbtn 规则里**最后**声明的 border-color 不能是透明
        //（要按级联判最后一处——`@supports` 那条就是靠"更晚"生效的）。
        && !declaresTransparentBorder(styles);
      check('入口样式：整行 + 有边框 + 居中 + 字号与页签标签一致',
        entryStyled(stylesSrc, qpCode));
      // 上下内边距 + 解掉基类的固定高：固定高 + 零纵向内边距会让文字贴边、整枚看着被压扁。
      {
        const rule = /\.we-qp__propsbtn \{[^}]*\}/.exec(stylesSrc)[0];
        check('入口有上下内边距、且高度不再被钉死（`padding: 7px 12px` + `height: auto`）',
          /padding: 7px 12px/.test(rule) && /height: auto/.test(rule) && /line-height: 1\.2/.test(rule));
        check('negative control: 退回「固定高 + 零纵向内边距」会被同一条判据判出',
          !(/padding: 7px 12px/.test(rule.replace('padding: 7px 12px', 'padding: 0 12px'))
            && /height: auto/.test(rule.replace('height: auto', 'height: 30px'))));
      }
      // 负对照：改**这一条规则自己的块**（`justify-content: center;` 在别处也出现，全局替换
      // 会改到别的规则 ⇒ 变异没落在被判的对象上，负对照会假红）。
      // 边框那条变异必须落在**真正生效**的那处 —— `@supports` 里那句（更晚、且带颜色），
      // 往第一条规则里塞 `border-color: transparent` 是打不过它的（负对照会假红，实测）。
      const btnBlock = /\.we-qp__propsbtn \{[^}]*\}/.exec(stylesSrc)[0];
      const mixRule = /border-color: color-mix\(in srgb, var\(--we-ink[^;]*;/.exec(stylesSrc)[0];
      check('negative control: 去掉居中 / 让生效的边框颜色透明，都会被同一条判据判出',
        !entryStyled(stylesSrc.replace(btnBlock, btnBlock.replace('justify-content: center;', 'justify-content: flex-start;')), qpCode)
          && !entryStyled(stylesSrc.replace(mixRule, mixRule.replace('color-mix(in srgb, var(--we-ink, currentColor) 40%, transparent)', 'transparent')), qpCode));
      // 边框颜色必须取自**该主题下的文字色**（`--we-ink`）：深色主题浅字、浅色主题深字，
      // 于是两套主题都看得见（现场反馈过"无边框线"—— 宿主那条中性描边在这套玻璃上近乎不可见）。
      // 命名谓词：正判据与负对照调同一个（负对照喂变异输入，不是另抄一份）。
      const entryBorder = (styles) => {
        const rule = /\.we-qp__propsbtn \{[^}]*\}/.exec(styles);
        return !!rule && /border: 1px solid/.test(rule[0])
          && /var\(--we-ink, currentColor\) 40%, transparent/.test(styles);
      };
      check('入口边框显式声明，颜色取该主题的文字色（--we-ink）+ 40% 透明（color-mix 兜底）',
        entryBorder(stylesSrc));
      check('negative control: 退回"只靠宿主中性描边"（自身不写 border）会被同一条判据判出',
        (() => {
          const rule = /\.we-qp__propsbtn \{[^}]*\}/.exec(stylesSrc)[0];
          return !entryBorder(stylesSrc.replace(rule, rule.replace(/\s*border: 1px solid[^;]*;/, '')))
            && entryBorder(stylesSrc);
        })());
    }
    // ⚠️ 血泪判据：**面板渲染器必须是模块级声明**，不能是 `apply()` 里的闭包。
    //    `src/sidebar-right.js` 是 prelude（在 `apply()` **之前**求值），它注册的渲染回调
    //    引用不到 apply 的作用域 ⇒ 真机上 `ReferenceError: renderUserPropsPanel is not defined`
    //    ⇒ React 卸载整棵树 ⇒ **整个页面空白**（实测复现；不是"这里不画"那种局部问题）。
    //    设置页那条路察觉不到：它经 ctx 显式收这个函数，所以只有侧栏会炸。
    {
      // 模块级 = 顶格声明（源码里 `function` 前没有缩进）。缩进只认 `[ \t]`：
      // `\s` 会跨行吞掉换行，CRLF 检出下 `^` 落在 `\r` 后、`\s+` 吃掉 `\n`，
      // 顶格声明前面是注释行就会被误判成"缩进形态"（LF 检出测不出来）。
      const isModuleLevel = (t) => /^function renderUserPropsPanel\(/m.test(t) && !/^[ \t]+function renderUserPropsPanel\(/m.test(t);
      check('面板渲染器是**模块级**声明（放回 apply() 闭包会让侧栏一点就整页白屏）',
        isModuleLevel(src));
      check('quick-panel 当自由变量用它（不许改成只认 prop —— 那会再掉回同一个坑）',
        qpCode.includes('renderUserPropsPanel()') && !qpCode.includes('props.renderUserPropsPanel'));
      check('两个挂载点都不再传它（它已不在闭包里，传了也没用）',
        !src.includes('QuickPanel, { dock: "drawer", renderUserPropsPanel }')
          && !sidebarSrc.includes('QuickPanel, { dock: "official", renderUserPropsPanel }'));
      check('negative control: 缩进写进 apply()（闭包形态）会被同一条判据判红',
        isModuleLevel('  function renderUserPropsPanel() {') === false);
    }
    // 共用同一个开关：两个壳（设置页 / 侧栏）不许各存一份 `propsPanelOpen`。
    // ⚠️ 同上：按**剥注释**的那份判，否则解释原理的散文里那句 `` `propsPanelOpen` `` 会被当成直读。
    check('「壁纸属性」开关只有一份（侧栏走 accessor，不另存一份状态）',
      (src.match(/let propsPanelOpen = /g) || []).length === 1
        && src.includes('function userPropsPanelOpen(')
        && qpCode.includes('userPropsPanelOpen()')
        && !qpCode.includes('propsPanelOpen'));
  }
  // ── 侧栏缩略图圆盘：圆度靠整圆裁切，不靠 mask ────────────────────────────────
  // 现场反馈"当前壁纸图片不够圆"。成因：外缘走 border-radius + overflow（把方盒子裁圆），
  // 同时又叠了 radial-gradient mask 去挖中心孔 —— mask 会提升一层光栅、把外缘抗锯齿弄糊。
  // 现在：外缘 = `clip-path: circle(50%)`，中心孔 = ::after 那枚描边圆环，整体不再用 mask。
  {
    const thumbRule = () => (/\.we-qp__thumb \{[^}]*\}/.exec(stylesSrc) || [''])[0];
    check('缩略图圆盘：整圆裁切（clip-path: circle）+ 方形外接盒；不再用 mask',
      /clip-path: circle\(50%\)/.test(thumbRule())
        && /aspect-ratio: 1 \/ 1/.test(thumbRule())
        && !/mask:/.test(thumbRule()));
    check('negative control: 退回「只靠 border-radius 裁圆 + mask 挖孔」会被同一条判据判出',
      !(() => {
        const r = thumbRule();
        return /clip-path: circle\(50%\)/.test(r.replace('clip-path: circle(50%);', ''))
          && !/mask:/.test(r + 'mask: radial-gradient(circle, transparent 0 3px, #000 4px);');
      })());
    check('中心孔仍由 ::after 的描边圆环画（不是叠色块；玻璃要能透出底色）',
      /\.we-qp__thumb::after \{[^}]*border: 1px solid/.test(stylesSrc)
        && /\.we-qp__thumb::after \{[^}]*border-radius: 50%/.test(stylesSrc));
  }
  // ── 侧栏列表的滚动链（真机回归：列表滚不动）────────────────────────────────
  // 布局靠"同级权重 + 源码顺序"决胜：`.we-qp--official .we-qp__section { flex: 0 0 auto }`
  // 与 `.we-qp--official .we-qp__library { flex: 1 1 auto }` 同为两个类，后者在源码里更晚
  // ⇒ 列表那节拿到弹性高度、它里面的 `overflow-y:auto` 才触发。**任何多一个类的写法**
  //（如 `.we-qp__tabbody--library > .we-qp__section`）会不看顺序地压过它 —— 列表随即被压成
  // 内容高、滚不动（用户实测到的那一版）。判据按**权重**判：给 `.we-qp__section` 设 flex
  // 的选择器不得比同族那条更重；再加一条顺序判据。
  {
    // 规则来自 styles.js 的 CSS：注释里也会出现这些类名（上面那条警告就写着坏写法）⇒ 先按
    // **CSS 词法**跳过注释与字符串再解析规则。不用"朴素块注释正则"（本仓 ⑦ 号规则：那类写法
    // 会从注释 / 字符串里开一个块注释，把中间的真实内容**静默删掉**）；CSS 也不套 JS 词法
    //（它没有行注释，`url(//host/x)` 会被误删）。
    const skipCssComments = (text) => {
      let out = '';
      for (let i = 0; i < text.length; i++) {
        if (text[i] === '/' && text[i + 1] === '*') {
          const end = text.indexOf('*/', i + 2);
          i = end === -1 ? text.length : end + 1;
          out += ' ';
          continue;
        }
        if (text[i] === '"' || text[i] === "'") {
          const quote = text[i];
          out += quote;
          for (i++; i < text.length && text[i] !== quote; i++) out += text[i] === '\\' ? text[i++] + (text[i] || '') : text[i];
          out += quote;
          continue;
        }
        out += text[i];
      }
      return out;
    };
    const css = skipCssComments(stylesSrc);
    /** 规则清单（含 @media/@keyframes 的嵌套：按花括号深度切）。 */
    const rules = [];
    for (let i = 0; i < css.length; i++) {
      if (css[i] !== '{') continue;
      const sel = css.slice(css.lastIndexOf('}', i) + 1, i);
      let depth = 0; let k = i;
      for (; k < css.length; k++) {
        if (css[k] === '{') depth++;
        else if (css[k] === '}' && --depth === 0) break;
      }
      rules.push({ at: i, sel, body: css.slice(i + 1, k) });
      i = k;
    }
    const weightOf = (sel) => (sel.match(/\.[\w-]+/g) || []).length + (sel.match(/\[[^\]]+\]/g) || []).length;
    const baseSel = '.we-qp--official .we-qp__section';
    const sectionFlexRules = [];
    for (const r of rules) {
      if (!/(^|[;\s])flex\s*:/.test(r.body)) continue;
      for (const part of r.sel.split(',')) {
        const s = part.trim();
        if (/\.we-qp__section\b/.test(s)) sectionFlexRules.push({ at: r.at, sel: s, w: weightOf(s) });
      }
    }
    const libraryRule = rules.find((r) => r.sel.split(',').some((s) => s.trim() === '.we-qp--official .we-qp__library')
      && /(^|[;\s])flex\s*:\s*1 1 auto/.test(r.body));
    const tooHeavy = sectionFlexRules.filter((r) => r.w > weightOf(baseSel));
    check('侧栏列表的滚动链：给 .we-qp__section 设 flex 的选择器不得比 `' + baseSel + '` 更重',
      sectionFlexRules.length >= 1 && tooHeavy.length === 0,
      tooHeavy.map((r) => r.sel + '(' + r.w + ')').join(' | ')
        || sectionFlexRules.length + ' 条同权重规则（靠源码顺序决胜）');
    check('列表那节的 `flex: 1 1 auto` 必须晚于同权重那条 `flex: 0 0 auto`（顺序即胜负）',
      Boolean(libraryRule) && sectionFlexRules.every((r) => libraryRule.at > r.at));
    check('negative control: `.we-qp__tabbody--library > .we-qp__section` 那条坏写法会被同一条判据判出',
      weightOf('.we-qp--official .we-qp__tabbody--library > .we-qp__section') > weightOf(baseSel));

    // ── 属性下钻的滚动（真机回归：属性多的壁纸，面板显示不全且滚不动）──────────────
    // 土壤与「列表滚不动」同一条：宿主页签内容区是固定高 + overflow:hidden（见 styles.js 里
    // .we-qp--official 那段），壁纸档又挂 --library 特意不自己滚 —— 滚动交给列表。属性下钻
    // 那一屏**没有列表** ⇒ 面板自己必须是滚动容器，否则内容被裁掉，且从它到 body 之间
    // **没有任何"用户滚得动"的祖先**（overflow:hidden 的容器程序上也能 scrollTop，但用户
    // 滚不动 —— 那正是这条 bug 的形态；真浏览器判定台见
    // test/tools/sidebar-props-scroll-rig.mjs）。判据 = 面板自带滚动 + 前提（内容区裁切）
    // + 有界高，另配负对照。
    const ruleOfSel = (sel) => rules.find((r) => r.sel.split(',').some((s) => s.trim() === sel));
    const userScroll = (body) => /(^|[;\s])overflow(-y)?\s*:\s*(auto|scroll)/.test(body);
    const drillRule = ruleOfSel('.we-qp--official .we-qp__propsview--drill');
    check('属性下钻：官方档的面板自带纵向滚动（宿主页签内容区不替它滚）',
      Boolean(drillRule) && userScroll(drillRule.body),
      drillRule ? drillRule.body.trim().replace(/\s+/g, ' ') : '找不到 .we-qp--official .we-qp__propsview--drill 规则');
    check('negative control: 把 overflow-y 去掉后同一条判据判红',
      Boolean(drillRule) && !userScroll(drillRule.body.replace(/overflow-y\s*:\s*(auto|scroll)\s*;?/, '')));
    check('属性下钻：面板在 flex 列里有界高（flex: 1 1 auto + min-height: 0，否则滚动条永远不出现）',
      Boolean(drillRule) && /(^|[;\s])flex\s*:\s*1 1 auto/.test(ruleOfSel('.we-qp__propsview--drill').body)
        && /(^|[;\s])min-height\s*:\s*0/.test(ruleOfSel('.we-qp__propsview--drill').body));
    const libTabbody = ruleOfSel('.we-qp--official .we-qp__tabbody--library');
    check('前提（这条判据的土壤）：壁纸档的页签内容区是裁切而不是滚动',
      Boolean(libTabbody) && /(^|[;\s])overflow(-y)?\s*:\s*hidden/.test(libTabbody.body));
  }
  // ── 需求④（两边数据一致）：侧栏不持有第二份状态 ──
  // ① 外观 / 画面处理器**提升到模块级**（在 WallpaperPicker 之前声明）—— 两处调的是
  //    同一份实现，不是两份手抄；
  // ② 渲染器解构的每个 ctx 字段，侧栏这一侧都要有交代（提供，或进 setting-only 名单
  //    由"取用即抛错"的占位器兜住）—— 将来渲染器加字段，这里会红；
  // ③ 侧栏两页零裸写（`selection.X =` 计数为 0）。
  const PROMOTED = ['onScrim', 'onWallpaperOpacity', 'onBorder', 'onBlur', 'onWallpaperBlur',
    'onBackgroundBrightness', 'onBackgroundContrast', 'onBackgroundSaturate', 'onAccent',
    'onGlassColor', 'onGlassAlpha', 'onGlassFidelity', 'onChatGlassFidelity', 'onExtraGlassSelectors', 'onToggleThemeFollow'];
  {
    // 界线判据提成命名函数：阳性侧喂真实源码（块底那个字面量就是同一份，只改了换行写法 ⇒ 不构成对照），
    // 阴性侧喂一份**改动过的源码副本** —— 删掉 `function WallpaperPicker() {` 这个界标，`compStart` 变 -1，
    // 同一条判据必须判红（`-1` 若被当成"都合格"，所有 `at > compStart` 反而恒真、判据静默放行）。
    const strayProcessors = (text) => {
      const boundary = text.indexOf('function WallpaperPicker() {');
      if (boundary === -1) return PROMOTED.slice();
      return PROMOTED.filter((n) => {
        const at = text.indexOf('const ' + n + ' = ');
        return at === -1 || at > boundary;
      });
    };
    const notPromoted = strayProcessors(src);
    check('外观 / 画面处理器已提升到模块级（设置页与侧栏共用同一份实现）',
      notPromoted.length === 0, notPromoted.join(', ') || PROMOTED.length + ' 个都在组件之前');
    check('negative control: 仍住在组件里的处理器会被同一条判据判出',
      strayProcessors(src.replace('function WallpaperPicker() {', '')).length === PROMOTED.length);
  }
  // 另：字体 / 主题处理器与三个 ctx 构造器**同样**必须在模块级（从 WallpaperPicker
  //    体内提到模块级）：它们只读模块级单例 `selection`、只调模块级函数（setFontValues /
  //    applyEffects / emit / ensureSystemFonts / fontset-store 与 preset-store 一族），
  //    不需要组件作用域；住在组件里等于每次渲染重建一份（函数 / 对象身份全变）。
  const PROMOTED_FONT = ['nextFontSetName', 'fontSetCtx', 'glassPresetCtx', 'onThemeFamily',
    'onGlobalFamily', 'onRefreshSystemFonts', 'onThemeSize', 'onThemeWeight', 'onComponentFont',
    'onThemeColor', 'onThemeColorClear', 'onThemeTypeOnly', 'onThemeDarkSeparate', 'toHexColor',
    'officialColorOf',
    // 第二刀（同日）：同族 4 个纯处理器，同样只读 selection / 只调模块级函数。
    'onToggleFontCustom', 'onFontAdvanced', 'onComponentFamily', 'onFontResetAll'];
  {
    const compStart = src.indexOf('function WallpaperPicker() {');
    // 两种声明形态都认（函数声明 `function foo(` 与 `const foo = `），取更靠前的那个。
    const posOf = (n) => {
      const a = src.indexOf('function ' + n + '(');
      const b = src.indexOf('const ' + n + ' = ');
      if (a === -1) return b;
      return b === -1 ? a : Math.min(a, b);
    };
    const flagged = (boundary) => PROMOTED_FONT.filter((n) => {
      const i = posOf(n);
      return i === -1 || i > boundary;
    });
    const stray = flagged(compStart);
    check('字体 / 主题处理器与 ctx 构造器也在模块级（组件之前声明，不再每次渲染重建）',
      stray.length === 0, stray.join(', ') || PROMOTED_FONT.length + ' 个都在组件之前');
    // 独立地板：名单空了的话上面那条 `stray.length === 0` 是**恒真**的 —— 空域上的"全部合格"
    // 等于零覆盖。这条把"名单被掏空"当场变红。
    check('覆盖面：PROMOTED_FONT 非空', PROMOTED_FONT.length > 0);
    check('negative control: 把界线画到文件开头（等价于"全算组件内"）同一条判据会判出全部',
      PROMOTED_FONT.every((n) => posOf(n) > 0) && flagged(0).length === PROMOTED_FONT.length);
  }
  // 另（第三刀）：壁纸库 / 库视图的纯处理器与纯常量同样提到模块级 —— 判据同前
  //    （只读模块级单例 `selection` / 只调模块级函数 ⇒ 不需要组件作用域；住在组件里等于每次
  //    渲染重建一份，函数 / 对象身份全变）。
  // ⚠️ 例外（**必须留组件内**，故意不进名单）：`group` / `candidates` 是读**可变** store 算出的
  //    派生值 —— 提到模块级会退化成"只在模块初始化时算一次"的冻结快照。下面那条负对照钉住它。
  const PROMOTED_HANDLERS = ['onRefresh', 'onRatingFilterChange', 'onTypeFilterChange',
    'onLayoutChange', 'onEdgeCompatChange', 'onGroupInterval', 'onArmDeleteGroup', 'onDeleteGroup',
    'onSwitchTransition', 'onSwitchTransitionDir', 'onSwitchTransitionSpeed',
    'onRopeVisibilityChange', 'onRopeFormChange', 'onRopeScaleChange',
    'currentLiveFrame', 'setCustomFrameLocal', 'closePicker',
    'INTERVALS', 'pagerRow',
    'onShowNormalView', 'onShowHiddenView', 'onToggleBatchMode', 'onArmBatchHide',
    'onBatchHide', 'onBatchCancel', 'onSearchInput', 'onPickCard'];
  {
    const compStart = src.indexOf('function WallpaperPicker() {');
    // 位置解析必须吃**传进来的那份文本**：阴性对照会把它喂给改动过的源码副本，
    // 若这里仍写死 `src`，`flagged(text, …)` 就会对副本永远判出"全员是孤儿"（判据恒红）。
    const posOf = (text, n) => {
      const a = text.indexOf('function ' + n + '(');
      const b = text.indexOf('const ' + n + ' = ');
      if (a === -1) return b;
      return b === -1 ? a : Math.min(a, b);
    };
    const flagged = (text, boundary, names = PROMOTED_HANDLERS) => names.filter((n) => {
      const i = posOf(text, n);
      return i === -1 || i > boundary;
    });
    const stray = flagged(src, compStart);
    check('壁纸库 / 库视图处理器与纯常量也在模块级（组件之前声明）',
      stray.length === 0, stray.join(', ') || PROMOTED_HANDLERS.length + ' 个都在组件之前');
    // 负对照：把**真实组件内成员**喂进同一条界线，必须判得出；再把它的声明提到组件之前，
    // 同一条界线必须闭嘴 —— 这才证明界线不是恒真/恒假（拿 `flagged(compStart)` 与上面那条
    // `stray.length === 0` 互证是按构造恒真，不算对照）。
    // ⚠️ 样本只取 `candidates`：`posOf` 取**首现**，而 `group` 在文件更早处另有一份模块级
    //    `const group = `（本文件靠 `lastIndexOf` 才看得到组件里那一份）⇒ 它在 posOf 语义下
    //    按构造就不会被这条界线判出，不能当阴性样本；它只作为"组件体内确实有第二份声明"的证据。
    const inComponent = ['candidates'];
    const hoisted = (n) => 'const ' + n + ' = null;' + String.fromCharCode(10) + src;
    check('negative control: 组件体内的派生值候选会被同一条界线判出，提到组件之前则闭嘴',
      src.lastIndexOf('const group = ') > compStart
      && src.lastIndexOf('const candidates = ') > compStart
      && flagged(src, compStart, inComponent).length === inComponent.length
      && flagged(hoisted('candidates'), compStart, inComponent).length === 0
      && !flagged(hoisted('candidates'), compStart, inComponent).includes('candidates'));
  }
  // 另（B3-a）：syncLayers 的 6 个分段助手也已提到模块级 —— 判据=只读模块级单例
  //    `selection` / 只调模块级函数（`selection` 与 `IS_EDGE` 在本模块内是自由变量）⇒
  //    syncLayers 只留编排（键计算 / 取层 / 旧层处置 / Scrim / 抓帧探测 / 槽位收尾各一行调用）。
  const SYNC_LAYER_HELPERS = ['layerWantKey', 'obtainLayerNode', 'disposeOutgoingLayer',
    'syncScrimElement', 'syncSceneFrameProbe', 'reclaimLayerAdoptionSlot'];
  {
    const syncStart = liveSrc.indexOf('function syncLayers() {');
    const flaggedAt = (n) => { const i = liveSrc.indexOf('function ' + n + '('); return i === -1 || i > syncStart; };
    const stray = SYNC_LAYER_HELPERS.filter(flaggedAt);
    check('syncLayers 的 6 个分段助手都在模块级（syncLayers 之前声明）',
      syncStart > 0 && stray.length === 0, stray.join(', ') || SYNC_LAYER_HELPERS.length + ' 个都在 syncLayers 之前');
    // 负对照：同一条界线对 syncLayers **之后**声明的函数必须判得出（判据不是恒真）。
    check('negative control: 同一条界线对 syncLayers 之后声明的函数（resetLayerSwitchStyles）判得出',
      flaggedAt('resetLayerSwitchStyles') === true && stray.length === 0);
  }
  {
    // 渲染器解构行 → ctx 字段表。
    // ⚠️ **必须容忍 CRLF**（`\\r?\\n`，不能写裸 `\\n`）：CI 跑在 windows-latest，检出是 CRLF
    //    形态（本仓没有 .gitattributes，Git for Windows 默认 autocrlf），而本文件的其它判据
    //    大多用 `\\s` 吃掉了那个 `\\r` —— 只有这条把换行写成了字面量 `\\n`，于是**候选恒为 0**：
    //    症状是 `候选 0 个` + 279 passed / 1 failed，本机（LF 检出）却全绿。
    //    实测复现：`git clone -c core.autocrlf=true` 的检出上 `node test/verify-scene-live.mjs`
    //    得到与 CI 逐字相同的失败（PR #125 首次推送）。
    const CTX_DESTRUCTURE = (fnName) =>
      new RegExp('function ' + fnName + '\\(ctx\\) \\{\\r?\\n\\s*const \\{([^}]*)\\} = ctx;');
    const ctxFieldsOf = (fnName, text = tabsSrc) => {
      const m = text.match(CTX_DESTRUCTURE(fnName));
      return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : null;
    };
    // 正/负对照成对：同一判据在两种换行形态下都要认出字段（LF 是本机形态、CRLF 是 CI 形态），
    // 且对"换个函数名"要落空 —— 否则上面那条 ≥20 的判据可能是空转的。
    const lfSample = 'function renderAppearanceTab(ctx) {\n  const { a, b } = ctx;';
    check('ctx 解构判据在 LF / CRLF 两种检出形态下都认得出字段（CI 是 CRLF）',
      JSON.stringify(ctxFieldsOf('renderAppearanceTab', lfSample)) === JSON.stringify(['a', 'b'])
      && JSON.stringify(ctxFieldsOf('renderAppearanceTab', lfSample.replace(/\n/g, '\r\n'))) === JSON.stringify(['a', 'b'])
      && ctxFieldsOf('renderNope', lfSample) === null,
      'lf=' + JSON.stringify(ctxFieldsOf('renderAppearanceTab', lfSample))
        + ' crlf=' + JSON.stringify(ctxFieldsOf('renderAppearanceTab', lfSample.replace(/\n/g, '\r\n'))));
    const mentions = (text, f) => new RegExp('(^|[\\s,{])' + f + '\\s*[,:}]', 'm').test(text)
      || text.includes('"' + f + '"');
    // ⚠️ P4-19 之后要连**节函数**一起收：拆分把字段从 `render*Tab` 搬到了 `render*Section` 里，
    // 只读 Tab 那一层会得到空集（判据的 `>= 20` 会当场红 —— 它红得对，是口径没跟上代码）。
    const allFieldsOf = (fn) => {
      const domain = fn.replace(/^render/, '').replace(/Tab$/, '');
      const secNames = [...tabsSrc.matchAll(new RegExp('function (render' + domain + '\\w*Section)\\(ctx\\)', 'g'))]
        .map((m) => m[1]);
      return [fn, ...secNames].flatMap((n) => ctxFieldsOf(n) || []);
    };
    const wanted = ['renderAppearanceTab', 'renderEffectsTab', 'renderAudioTab']
      .flatMap((fn) => allFieldsOf(fn));
    const missing = wanted.filter((f) => !mentions(qpSrc, f));
    check('侧栏 ctx 覆盖渲染器要的全部字段（提供的字段 + setting-only 占位器），候选 ' + wanted.length + ' 个',
      wanted.length >= 20 && missing.length === 0, '缺：' + (missing.join(', ') || '无'));
    check('negative control: 漏掉一个 ctx 字段会被同一条判据判出',
      !mentions('const x = 1;', 'onGlassAlpha'));
    const bareWrites = (stripComments(qpSrc).match(/(?<![\w.$])selection\.[\w$]+\s*=(?!=)/g) || []).length;
    check('侧栏（quick-panel.js）对 store 零裸写 —— 写一律走处理器 / setSetting / setTransient',
      bareWrites === 0, bareWrites + ' 处裸写');
  }
  // 底栏深链：外观 / 播放各带自己的 tabId，落地走同一个 switchTab（一次性请求）。
  const deepLinkOk = (clientText, sideText, qpText) => sideText.includes('function openSettingsSection(tabId)')
    && sideText.includes('setTransient("settingsTabRequest", String(tabId))')
    && sideText.includes('setTransient("settingsTabRequest", "")')
    && clientText.includes('settingsTabRequest: ""')
    && clientText.includes('const req = selection.settingsTabRequest')
    && qpText.includes('openSettingsSection(foot.target)')
    && qpText.includes('label: weT("更多外观设置 ›")')
    && qpText.includes('label: weT("更多播放设置 ›")');
  check('底栏深链：外观 / 播放页各带自己的 tabId（瞬态请求 + 超时清理）',
    deepLinkOk(src, sidebarSrc, qpSrc));
  check('negative control: 不带 tabId 的旧形态会被同一条判据判出',
    !deepLinkOk(src, 'function openSettingsSection() {', qpSrc));

  // 侧栏 ctx 的 setting-only 占位器要有**牙**：调用它、或读它的属性都抛错 —— 将来某次
  // 编辑把一行挪进侧栏档（比如把「帧率上限」放进播放页），会当场炸而不是静默变成
  // "点了没反应"。判据拿**真源码**求值后再戳（不是照着实现抄一遍 —— 那样只会测到抄写）。
  {
    const factory = new Function('weT', 'React', 'localStorage',
      qpSrc + '\nreturn { sidebarRenderCtx, QP_CTX_SETTINGS_ONLY, QP_TABS };');
    const bag = factory((k) => k, { createElement: () => null }, { getItem: () => null, setItem() {} });
    const ctx = bag.sidebarRenderCtx({ sel: {}, onAccent: () => 'ok' });
    // 牙改钉**仍在名单里**的字段（迁移后字体与玻璃高级行已移出占位器、
    // 改传真值 ⇒ 拿它们戳会得到 "not a function" 而不是 [we-sidebar]，那是**预期**）：
    // 播放页专属的 onFpsCap（调用）与预设 glassPresets（取属性，单独那条也判）。
    const called = (() => { try { ctx.onFpsCap(); return 'no-throw'; } catch (e) { return String(e.message); } })();
    const read = (() => { try { return String(ctx.glassPresets.presets); } catch (e) { return String(e.message); } })();
    check('侧栏 ctx 的 setting-only 占位器：调用 / 取属性都抛错（响亮且可定位）',
      ctx.surface === 'sidebar' && ctx.onAccent() === 'ok' && bag.QP_TABS.length === 3
        && called.includes('[we-sidebar]') && called.includes('onFpsCap')
        && read.includes('[we-sidebar]') && read.includes('glassPresets')
        // 迁移的另一半：字体与玻璃高级行**必须已移出**名单（否则它们在侧栏是替身 ⇒ 死旋钮）。
        && !bag.QP_CTX_SETTINGS_ONLY.includes('onFontAdvanced')
        && !bag.QP_CTX_SETTINGS_ONLY.includes('fontSet')
        && !bag.QP_CTX_SETTINGS_ONLY.includes('onGlassChildParam'),
      called.slice(0, 48));
    // 预设块那道门也有牙：`glassPresets` 是高级配置的 ctx 字段（ADR-0008 D4），侧栏档指向替身 ⇒
    // 谁把 `src/glass-panel.js` 里那道 `!sidebarSurface` 门拆掉，渲染器**解构它的第一下就炸**
    // （不是静默把预设块画进侧栏 —— 那是"整快照覆盖且不可撤销"的动作，不该随手可达）。
    const presetTeeth = (() => { try { return String(ctx.glassPresets.presets); } catch (e) { return String(e.message); } })();
    check('侧栏 ctx 的 `glassPresets` 也是占位器（拆掉预设块的门 ⇒ 解构即抛错）',
      presetTeeth.includes('[we-sidebar]') && presetTeeth.includes('glassPresets'), presetTeeth.slice(0, 48));
    check('负对照：名单外的字段仍是 undefined（判据不是恒真 —— 占位器只覆盖点过名的）',
      ctx.someFieldNeverListed === undefined && bag.QP_CTX_SETTINGS_ONLY.length >= 5
        // 迁移后名单=预设 + 播放 6 项；字段被清空成 [] 的形态同样判红。
        && bag.QP_CTX_SETTINGS_ONLY.includes('glassPresets') && bag.QP_CTX_SETTINGS_ONLY.includes('onFpsCap'));
  }
}

// ── 字体节的自由变量预置（本机字体 / 思考块玻璃落位后，面板引用的消毒层与清单）──
// panel-tabs 是 bundle-inline 形态：这些符号在真产物里由 settings-schema / system-fonts
// 的内联段供给；真模块导入形态下必须当 global 预置，缺一个就是渲染期 ReferenceError。
{
  const sysMod = await import(pathToFileURL(join(root, 'src', 'system-fonts.js')).href);
  const schemaEarly = await import(pathToFileURL(join(root, 'lib', 'settings-schema.js')).href);
  Object.assign(globalThis, {
    sanitizeFamilyKey: schemaEarly.sanitizeFamilyKey,
    systemFontKeyOf: schemaEarly.systemFontKeyOf,
    systemFontNameOf: schemaEarly.systemFontNameOf,
    filterUsableSystemFonts: sysMod.filterUsableSystemFonts,
    // fontFamilyKeyOf 是 client.js 的反查（依赖 FONT_FAMILY_STACKS / BY_STACK，不导出）。
    // 渲染台只需要"返回字符串"这一契约面；反查正确性归 verify-system-fonts / smoke 管。
    fontFamilyKeyOf: (v) => (typeof v === 'string' ? v.trim() : ''),
    FONT_FAMILY_LABELS: [
      { v: 'inherit', label: '默认' }, { v: 'Microsoft YaHei', label: '雅黑' }, { v: 'KaiTi', label: '楷体' },
      { v: 'SimSun', label: '宋体' }, { v: 'SimHei', label: '黑体' }, { v: 'STXingkai', label: '行楷' },
      { v: 'monospace', label: '等宽' },
    ],
  });
}

// ── 渲染回归：三档页签都渲染得出，且各画各的 ────────────────────────────────
// 源码级判据看不出的那一类（漏声明的名字、ctx 装错对象、占位器在解构时就炸）只有真渲染
// 一次才知道。React / store 用最小替身，**渲染器用真的**（import src/panel-tabs.js）。
{
  const panelMod = await import(pathToFileURL(join(root, 'src', 'panel-tabs.js')).href);
  // 刀4：节的渲染器拆到 5 个兄弟模块里了 —— 挂载台是**按文件 import** 的，而运行时是同作用域，
  // 所以把它们逐个挂到 globalThis（与 glass-panel / section-head / 字体表同一做法）。
  for (const rel of panelSources().slice(0, -1)) {
    const mod = await import(pathToFileURL(join(root, rel)).href);
    for (const [k, v] of Object.entries(mod)) globalThis[k] = v;
  }
  // A3：装共享注册表 —— 三项来自三份不同 bundle（求值顺序不保证）⇒ 挂载台必须自己登记。
  await installExtensionRegistry();
  const schema = await import(pathToFileURL(join(root, 'lib', 'settings-schema.js')).href);
  const noop = () => null;
  // useState 的值由队列喂（QuickPanel 的调用序：[view, qpTab]）。
  const STATE = [];
  const ReactStub = {
    Fragment: 'Fragment',
    useState: (init) => [STATE.length ? STATE.shift() : (typeof init === 'function' ? init() : init), () => {}],
    useEffect: () => {}, useRef: (v) => ({ current: v }), createRef: () => ({ current: null }),
    createElement: (t, p, ...c) => (typeof t === 'function' ? t(p || {}, ...c) : { type: t, props: p || null, children: c }),
  };
  const shapeOf = (n, acc = []) => {
    if (Array.isArray(n)) { n.forEach((x) => shapeOf(x, acc)); return acc; }
    if (!n || typeof n !== 'object') return acc;
    if (n.props && n.props.className) acc.push(String(n.props.className));
    if (Array.isArray(n.children)) n.children.forEach((x) => shapeOf(x, acc));
    return acc;
  };
  const textOf = (n) => (Array.isArray(n) ? n.map(textOf).join(' ') : (!n || typeof n !== 'object' ? ''
    : ((Array.isArray(n.children) ? n.children.filter((c) => typeof c === 'string').join(' ') : '') + ' '
      + (Array.isArray(n.children) ? n.children.map(textOf).join(' ') : ''))));
  // 面板渲染器（panel-tabs.js 是真模块）要的**全局**预置：求值参数时会碰到的那几个。
  globalThis.React = ReactStub;
  globalThis.SliderRow = noop; globalThis.switchRow = noop;
  globalThis.ctlText = noop; globalThis.swatchRow = noop; globalThis.renderFontSetEditor = noop;
  globalThis.ACCENT_PRESETS = []; globalThis.GLASS_COLOR_PRESETS = []; globalThis.CARET_COLOR_PRESETS = [];
  // 模块级重置的处理器（issue #192）：quick-panel 的装配点会按名引用它 ⇒ 这里必须预置
  //（与 onAccent 那批模块级处理器同一条口径：本守卫只验"渲染得出"，动作不真的跑）。
  globalThis.onResetModule = noop;
  // 子 UI 玻璃登记表 + 键名生成器：panel-tabs 的「玻璃 UI」节按它逐项渲染。
  // ⚠️ 给**真值**（schema 的同一份），不手抄 —— 手抄一份就多一个会漂的副本，
  //    而且夹具渲染的项数一旦与真实面板不同就是假绿。
  globalThis.GLASS_CHILDREN = schema.GLASS_CHILDREN || [];
  globalThis.childGlassKey = schema.childGlassKey || ((id, p) => id + p.charAt(0).toUpperCase() + p.slice(1));
  // ⚠️ 「玻璃 UI」节的渲染器已抽到 `src/glass-panel.js`（wip §10.13）：**打包后**它与
  //    `panel-tabs.js` 同作用域，所以后者能按名字直接调；但这里是**按文件 import** 的替身，
  //    两个模块各有自己的作用域 ⇒ 必须自己把它挂成全局（与上面那批模块级助手同一条口径）。
  globalThis.renderAppearanceGlassSection =
    (await import(pathToFileURL(join(root, 'src', 'glass-panel.js')).href)).renderAppearanceGlassSection;
  // 节头构件（三节在侧边栏默认收敛）—— 同上一条口径，给**真实现**：
  // 折叠逻辑（`collapsible` 短路 + aria-expanded + caret）正是本节新判据要验的东西，
  // 挂个替身等于"判据测替身"（比红更糟）。
  globalThis.sectionHead =
    (await import(pathToFileURL(join(root, 'src', 'section-head.js')).href)).sectionHead;
  // 模块级重置按钮（issue #192）：同样是 panel-tabs 与 glass-panel 共用的构件，同样给**真实现**
  // —— 判据要验"每处节头都挂上了 ↺"，挂替身就等于判据测替身。
  globalThis.moduleResetButtonNode =
    (await import(pathToFileURL(join(root, 'src', 'module-reset.js')).href)).moduleResetButtonNode;
  // ⚠️ 域模块（-appearance / -effects / -mascot）的节头调的是**薄包装** `moduleResetButton(...)`：
  //    它是 panel-tabs.js 的工厂作用域自由名字（打包后同作用域）；按文件 import 时是裸标识符
  //    ⇒ 这里同样挂**真实现**（不是替身：判据要验"每处节头都挂上了 ↺"）。
  globalThis.moduleResetButton = panelMod.moduleResetButton;
  // `renderMascotTab` 会调 `ropeArtOf(sel)`（主页面那只吉祥物当前用哪张立绘）—— 它住在
  // `src/client.js` 顶层，按文件 import 的替身里没有 ⇒ 挂一个形状正确的替身（本文件对它的
  // 判据在 verify-client 那边打真产物；这里只需要"有个合法的立绘盒"让环画得出来）。
  globalThis.ropeArtOf = () => ({ img: "data:image/png;base64,", w: 64, h: 96, custom: false });
  // `renderMascotTab` 还把 `onRopeFormChange` / `onMascotPick` / `onMascotClear` 当**自由变量**用
  // （它们是 client.js 顶层的处理器，不在 ctx 里）⇒ 同样要挂；不然按文件 import 时是 ReferenceError。
  // （第一版只挂了 onRopeFormChange，于是报下一个 —— 逐个补到齐。）
  globalThis.onRopeFormChange = noop;
  globalThis.onMascotPick = noop;
  globalThis.onMascotClear = noop;
  // `ROPE_FORM_VALUES`（枚举，真源在 schema）与 `ROPE_FORMS`（形态表：立绘 + 显示盒）也是自由变量。
  // ⚠️ `ROPE_FORMS` 必须与**真表逐项一致**（项数 + 每项的 w/h）—— 下面的几何判据按真表的项数
  //    复算半径，桩表项数不同就会算出不一样的期望值（判据自己骗自己）。所以从 client.js 源码
  //    文本**解析**出同一张表，而不是随手写几条。
  globalThis.ROPE_FORM_VALUES = schema.ROPE_FORM_VALUES || [];
  // 吉祥物大小滑块的量程（renderMascotTab 的自由变量，真源同样在 schema）。
  globalThis.ROPE_SCALE_MIN = schema.ROPE_SCALE_MIN;
  globalThis.ROPE_SCALE_MAX = schema.ROPE_SCALE_MAX;
  globalThis.ROPE_SCALE_STEP = schema.ROPE_SCALE_STEP || 0.1;
  {
    const clientForForms = readFileSync(join(root, 'src', 'client.js'), 'utf8');
    const forms = {};
    for (const m of clientForForms.matchAll(/^\s{2}(\w+):\s+\{ get label\(\) \{ return weT\("([^"]+)"\); \}, img: ROPE_IMG\w*,\s+w: (\d+), h: (\d+) \}/gm)) {
      forms[m[1]] = { label: m[2], img: "data:image/png;base64,", w: Number(m[3]), h: Number(m[4]) };
    }
    globalThis.ROPE_FORMS = forms;
  }
  globalThis.FRAME_VARIANTS = []; globalThis.FPS_CAP_VALUES = (schema.FPS_CAP_VALUES || [0, 24, 30, 60]);
  // 侧边栏四角圆角的值域（panel-tabs 的「侧边栏圆角」节按自由变量读它）：给真值，别手抄。
  globalThis.SIDEBAR_CORNER_RADIUS_VALUES = schema.SIDEBAR_CORNER_RADIUS_VALUES;
  // 角色表要**真的**：`renderAppearanceTab` 一进门就 `THEME_TYPE_ROLES.filter(...)`（与画不画
  // 字体那节无关）—— 给空数组也活得下去，但真表更接近运行期（而且这几张表是纯数据）。
  globalThis.THEME_TYPE_ROLES = (await import(pathToFileURL(join(root, 'src', 'font', 'typography.js')).href)).THEME_TYPE_ROLES || [];
  globalThis.THEME_COLOR_ROLES = (await import(pathToFileURL(join(root, 'src', 'font', 'color-roles.js')).href)).THEME_COLOR_ROLES || [];
  globalThis.gpuFrameUi = { wid: '', pinned: false, w: 0, h: 0, busy: false, recapturing: false, error: '' };
  // QuickPanel 的自由变量：一律当**形参**传（真实现或替身），漏一个就是 ReferenceError。
  const FREE = ['weT', 'React', 'localStorage',
    'useWeLocale', 'useStore', 'liveRenderEnabled', 'CARD_TYPE_LABELS', 'applySelection', 'cardKeyDown',
    'playbackIsVideoLike', 'playableInventory', 'groupWallpapers', 'rotationCandidates',
    'emit', 'setTransient', 'setSetting', 'onTogglePlay', 'onClear', 'onGroupChange', 'onNextWallpaper',
    'onToggleRotation', 'onToggleAudio', 'onVideoVolume', 'loadInventory', 'openSettingsSection',
    'renderAppearanceTab', 'renderEffectsTab', 'renderAudioTab',
    'onAccent', 'onBlur', 'onBorder', 'onGlassAlpha', 'onGlassColor', 'onGlassFidelity', 'onChatGlassFidelity', 'onExtraGlassSelectors', 'onToggleThemeFollow',
    'onScrim', 'onWallpaperBlur', 'onWallpaperOpacity',
    'onBackgroundBrightness', 'onBackgroundContrast', 'onBackgroundSaturate',
    // 壁纸层取景（位置 / 缩放）：侧栏「播放」档同样画这三行 ⇒ 它们也是 quick-panel.js 的
    // 自由变量（与上面同一纪律：漏一个就是渲染期 ReferenceError）。
    'onLayerPositionX', 'onLayerPositionY', 'onLayerScale', 'onLayerReset',
    // P4-15 从 panel-tabs.js 抽出的具名处理器：侧栏档也画到它们，于是它们成了 quick-panel.js
    // 的**自由变量** ⇒ 必须在这里当形参给（漏一个就是 ReferenceError，这正是本判据的设计）。
    // 与 QP_CTX_SETTINGS_ONLY 的分工：**侧栏档真的会画到的**由这里给真值（替身），
    // 设置页专属的（如 onFpsCap —— 帧率上限那行带 `!sidebarSurface` 门）才进占位器名单。
    'onLeftSidebarGlass', 'onTitlebarGlass', 'onSidebarGlass',
    'onSidebarAllCorners', 'onSidebarCornerRadius', 'onSidebarCornerSquare', 'onSidebarFullClear',
    // （ADR-0008 D4 二次修订）：字体节与玻璃高级行**迁入侧栏**（折叠块）⇒ 它们
    // 从 QP_CTX_SETTINGS_ONLY 占位器名单移出、由 quick-panel 真值接线 ⇒ 这些名字现在是
    // **quick-panel 源码里的裸标识符** ⇒ 必须在这里当形参给（漏一个就是 vm 求值 ReferenceError）。
    'onCaretColor', 'onSidebarAlpha', 'onSidebarBlur', 'onSidebarColor',
    'onSidebarContentAlpha', 'onSidebarContentColor', 'onSidebarFollowGlobal', 'onThinkingMode',
    'onCapsuleBlur', 'onCapsuleColor',
    // 「玻璃 UI」节的**子项「独立配置」**及其参数处理器（glass-panel.js 里 `= ctx` 解构出的
    // 绑定不是自由变量，真正需要这里给的是 panel 模块作用域里的那些名字）；
    // 两级子 UI 开关那两个名字（`onToggleGlassChild` / `onToggleGlassIndependent`）随
    // 「要不要玻璃」整层退役，已清掉（src 里零出现 = 死数据）。
    'onToggleChildIndependent',
    'onGlassChildParam', 'childIndependentOn',
    // ── 全局字体节（迁入侧栏）：渲染器与 ctx 构造器都是 quick-panel 的
    //    自由变量 —— 与上面同一条纪律。`ensureSystemFonts` 是清单触发点随迁带来的
    //    （effect 在 QuickPanel 里调它）。
    'fontSetCtx', 'officialColorOf', 'ensureSystemFonts',
    'onComponentFamily', 'onComponentFont', 'onFontAdvanced', 'onFontResetAll',
    'onGlobalFamily', 'onRefreshSystemFonts', 'onToggleFontCustom',
    'onThemeColor', 'onThemeColorClear', 'onThemeDarkSeparate', 'onThemeFamily',
    'onThemeSize', 'onThemeTypeOnly', 'onThemeWeight',
    // ── 全局 UI 配色节：同一纪律 —— 渲染器与 ctx 构造器都在 quick-panel 的
    //    作用域里引用这两个名字，漏一个就是 vm 求值 ReferenceError（本判据已经抓到过一次）。
    'onToggleUiColorCustom', 'onUiColorElement',
    // 子 UI 登记表：renderAppearanceGlassSection 按它逐项渲染。替身必须给**与 schema 同源**
    // 的那份（不能手抄），否则夹具渲染的项数与真实面板不同，等于假绿。
    'GLASS_CHILDREN', 'childGlassKey',
    'onToggleSceneLive', 'onLiveBootDelay', 'onSceneLiveFps',
    'onPlaybackRate', 'onObjectFit', 'onFlip', 'onOpenPicker', 'setPickerOpener',
    // 侧栏壁纸档的「壁纸属性」：开关读数 / 开关动作 / 面板渲染器**都是模块级的**
    //（client.js 里的函数声明），本台把它们当自由变量带传进来 —— 与内联后的真实形态一致。
    'userPropsPanelOpen', 'openUserPropsPanel', 'closeUserPropsPanel', 'renderUserPropsPanel'];
  const selBase = Object.assign({}, schema.DEFAULTS, {
    loaded: true, loading: false, id: 'w1', url: '/x', playing: true, videoPlaying: true,
    videoVolume: 0.5, videoAudioEnabled: false, videoError: '', type: 'video',
    contentRatingFilter: 'all', hiddenIds: [], rotationGroups: [], rotationGroupId: '',
    rotationEnabled: false, qpSearch: '', qpType: 'all', url2: '',
    inventory: { wallpapers: [], error: null, installDir: '/we', uploadDir: '/up', weAssetsDir: null, sceneMediaBase: '', total: 0, portableCount: 0, playlists: [] },
    accent: '#4f8cff', glassColor: '#ffffff', glassAlpha: 0, blur: 0, border: 0,
    themeFollow: false, themeFollowLine: '',
  });
  // 下钻动作的记账（判据：点开真的走了处理器的打开路径，不是就地偷改状态）。
  const OPEN_CALLS = [];
  // 「壁纸属性」面板渲染器替身：**模块级自由变量形态**（真产物里它就是模块级的函数声明，
  // 见 client.js；写成 `apply()` 里的闭包时真机会抛 ReferenceError，见 repro-sidebar-props.mjs）。
  let SEL = null;
  const propsPanelStub = () => (SEL && SEL.userPropsPanelOpen
    ? { type: 'div', props: { className: 'we-picker__props' }, children: [] }
    : null);
  SEL = selBase;
  const bag = new Function(...FREE,
    qpSrc + '\nreturn { QuickPanel };')(
    ...FREE.map((n) => ({
      weT: globalThis.weT, React: ReactStub,
      localStorage: { getItem: () => null, setItem() {} },
      useWeLocale: noop, useStore: () => SEL,
      liveRenderEnabled: () => false, CARD_TYPE_LABELS: { video: '视频', web: '网页', image: '图片', scene: '场景' },
      applySelection: noop, cardKeyDown: noop, playbackIsVideoLike: () => true,
      playableInventory: () => [], groupWallpapers: () => [], rotationCandidates: () => [],
      emit: noop, setTransient: noop, setSetting: noop,
      onTogglePlay: noop, onClear: noop, onGroupChange: noop, onNextWallpaper: noop,
      onToggleRotation: noop, onToggleAudio: noop, onVideoVolume: noop,
      loadInventory: noop, openSettingsSection: noop,
      renderAppearanceTab: panelMod.renderAppearanceTab, renderEffectsTab: panelMod.renderEffectsTab,
      renderAudioTab: panelMod.renderAudioTab,
      onAccent: noop, onBlur: noop, onBorder: noop, onGlassAlpha: noop, onGlassColor: noop, onGlassFidelity: noop, onChatGlassFidelity: noop,
      onExtraGlassSelectors: noop,
      onToggleThemeFollow: noop, onScrim: noop, onWallpaperBlur: noop, onWallpaperOpacity: noop,
      onBackgroundBrightness: noop, onBackgroundContrast: noop, onBackgroundSaturate: noop,
      onLayerPositionX: noop, onLayerPositionY: noop, onLayerScale: noop, onLayerReset: noop,
      onLeftSidebarGlass: noop, onTitlebarGlass: noop, onSidebarGlass: noop,
      // 子项「独立配置」及其参数处理器；登记表与键名生成器给**真值**
      //（与 schema 同源，来自被内联的 panel 模块作用域）—— 手抄一份就会漂。
      onToggleChildIndependent: noop,
      onGlassChildParam: noop, childIndependentOn: () => false,
      // 字体节（迁入侧栏）：ctx 构造器给真形状的替身 —— `fontSetCtx` 会被
      // qpRenderAppearancePane 无条件调用（noop 返回 undefined 也不炸，但给真形状更接近
      // 运行期：`fontSet.open` 若被读到就是布尔而不是 undefined 属性错）。
      fontSetCtx: () => ({ open: false, fontSets: [], activeId: '', loading: false, error: '' }),
      officialColorOf: () => '#ffffff',
      onToggleSceneLive: noop, onLiveBootDelay: noop, onSceneLiveFps: noop,
      onPlaybackRate: noop, onObjectFit: noop, onFlip: noop, onOpenPicker: noop, setPickerOpener: noop,
      userPropsPanelOpen: () => SEL.userPropsPanelOpen === true,
      openUserPropsPanel: () => { OPEN_CALLS.push(1); SEL.userPropsPanelOpen = true; },
      closeUserPropsPanel: () => { SEL.userPropsPanelOpen = false; },
      renderUserPropsPanel: propsPanelStub,
    })[n] || noop));
  const renderTab = (tab, sel, ...extraState) => {
    SEL = sel || selBase;
    // useState 取值顺序 = view / qpTab / fontOpen / glassDetailOpen（QuickPanel 内的声明序）
    // ⇒ extraState 顺位追加：['cards', tab, fontOpen, glassDetailOpen]。
    STATE.length = 0; STATE.push('cards', tab, ...extraState);
    // 面板渲染器替身由 FREE 注入（模块级自由变量形态，见上面 FREE 表）—— 与真产物的
    // 作用域形态一致：`apply()` 里的闭包在真机上会抛 ReferenceError（见 repro-*.mjs）。
    const tree = bag.QuickPanel({ dock: 'official' });
    return { tree, shape: shapeOf(tree).join('|'), text: textOf(tree) };
  };
  const threw = (tab, sel) => {
    try { renderTab(tab, sel); return ''; } catch (e) { return String((e && e.message) || e); }
  };
  const bad = ['wallpaper', 'appearance', 'playback'].map((t) => t + ':' + threw(t)).filter((s) => !s.endsWith(':'));
  check('三档页签都渲染得出（真源码 + 真渲染器）', bad.length === 0, bad.join(' | ') || '三档 ok');
  const wp = renderTab('wallpaper'); const ap = renderTab('appearance'); const pb = renderTab('playback');
  const tabsOf = (t) => t.shape.split('|')
    .filter((c) => c === 'we-tabs__tab' || c === 'we-tabs__tab we-tabs__tab--active');
  check('三档页签栏都在（每档三个页签，且只有当前档带 --active）',
    [wp, ap, pb].every((t) => tabsOf(t).length === 3 && tabsOf(t).filter((c) => c.includes('--active')).length === 1));
  check('壁纸档画列表、外观 / 播放档不画（列表只属于壁纸页）',
    wp.shape.includes('we-qp__library') && wp.shape.includes('we-qp__list')
      && wp.shape.includes('we-qp__viewtabs') // 列表/卡片视图切换也只在壁纸档（标签式，非页签栏成员）
      && !ap.shape.includes('we-qp__library') && !pb.shape.includes('we-qp__library'));
  // ── 外观档的字体节（迁入侧栏，默认收起）────────────────────────────
  //    ⚠️ 本台的 switchRow / ctlText 是 noop ⇒ 标签文字不进 text，行级判据用**类名锚**
  //    （字体表 `we-picker__font-table` 是直接 createElement，收起/展开两态都看得见）。
  //    收起态：节头「全局字体」在、字体表不在；展开态（extraState 第三位 = true）+ 总开关开
  //    ⇒ 字体表回来。两头都钉 ⇒ "收起"不是"整节没了"，判据也不是恒真。
  check('外观档含字体节（迁移后只有侧栏有），主题 / 细节照旧',
    ap.text.includes('主题') && ap.text.includes('细节') && ap.text.includes('全局字体')
      && ap.shape.includes('we-picker__section-head--toggle'));
  check('默认收起：字体节只有节头，字体表不渲染',
    !ap.shape.includes('we-picker__font-table'));
  const apOpen = renderTab('appearance', Object.assign({}, selBase, { fontCustom: true }), true);
  check('展开态 + 字体自定义开 ⇒ 字体表回来（负对照 —— 收起判据不是恒真）',
    apOpen.shape.includes('we-picker__font-table'));
  check('播放档 = 画面 + 声音两组；准备与诊断（帧率上限档位）不画，倍速 / 适配照旧在',
    pb.text.includes('画面') && pb.text.includes('声音')
      && !pb.text.includes('无限制') && pb.text.includes('2x') && pb.text.includes('覆盖'));
  check('底栏入口随页签换文案（壁纸 / 外观 / 播放三档各一）',
    wp.text.includes('壁纸引擎设置 ›') && ap.text.includes('更多外观设置 ›')
      && pb.text.includes('更多播放设置 ›'));
  check('播放档的空态 CTA =「去挑一张 ›」（拿走当前壁纸再渲染一次）',
    renderTab('playback', Object.assign({}, selBase, { id: '', url: '' })).text.includes('去挑一张 ›'));
  // ── 壁纸属性下钻（真源码渲染）：入口可达 → 整区换面板 → 返回退出 ────────────
  // 入口判据与设置页同一条（上面那条源码判据、`verify-picker-props` ①）：仅
  //「场景/网页 + propsUrl」才出。下面几种输入调的是**同一个**谓词函数。
  {
    const findBtn = (root, label) => {
      let hit = null;
      (function walk(n) {
        if (hit) return;
        if (Array.isArray(n)) { n.forEach(walk); return; }
        if (!n || typeof n !== 'object') return;
        const cls = String((n.props && n.props.className) || '');
        if (n.type === 'button' && cls.split(/\s+/).includes('we-picker__btn')
          && textOf(n).trim() === label) { hit = n; return; }
        if (Array.isArray(n.children)) n.children.forEach(walk);
      })(root);
      return hit;
    };
    const hasPropsPanel = (t) => t.shape.includes('we-picker__props');
    const hasLibrary = (t) => t.shape.includes('we-qp__library');
    // 入口按**类名**找：文案随下钻在「壁纸属性 / 收起壁纸属性」之间切，按文字找会漏。
    const hasEntry = (t) => t.shape.includes('we-qp__propsbtn');
    // ⚠️ 入口判据里的 `current` 是**从库清单里按 id 找回来**的那一条（见 quick-panel.js）——
    //    夹具不给条目，`current` 恒为 null，再对的实现在这里也只会是一条空转的红。
    //    `userPropsPanelOpen` 是本台的开关读数（真源码读 `userPropsPanelOpen()`）。
    const withCurrent = (type, id, propsUrl, propsOpen, itemPropsUrl) => Object.assign({}, selBase, {
      type, id, url: '/x', propsUrl, userPropsPanelOpen: propsOpen === true,
      inventory: Object.assign({}, selBase.inventory, {
        wallpapers: [{ id, type, title: id, propsUrl: itemPropsUrl === undefined ? propsUrl : itemPropsUrl, preview: null }],
      }),
    });
    const sceneSel = () => withCurrent('scene', 's1', 'http://x/props/tokS');
    const webSel = () => withCurrent('web', 'w9', 'http://x/props/tokW');
    const noUrlSel = () => withCurrent('scene', 's2', null);
    const imgSel = () => withCurrent('image', 'i1', null);
    const entryOf = (sel) => findBtn(renderTab('wallpaper', sel).tree, '壁纸属性');
    check('侧栏壁纸档：场景 / 网页壁纸出「壁纸属性」入口（判据与设置页同一条）',
      Boolean(entryOf(sceneSel())) && Boolean(entryOf(webSel())));
    check('negative control: 图片壁纸 / 没有 propsUrl 的场景壁纸都不出入口',
      !entryOf(imgSel()) && !entryOf(noUrlSel()));
    // 点开 ⇒ 走处理器的打开路径（不是就地偷改状态），内容区整区换成「返回 + 面板」。
    {
      OPEN_CALLS.length = 0;
      const target = renderTab('wallpaper', sceneSel());
      const btn = findBtn(target.tree, '壁纸属性');
      check('点「壁纸属性」⇒ 走 openUserPropsPanel（不是就地偷改开关）',
        Boolean(btn) && !hasPropsPanel(target) && (btn.props.onClick(), OPEN_CALLS.length === 1));
      const openSel = withCurrent('scene', 's1', 'http://x/props/tokS', true);
      const opened = renderTab('wallpaper', openSel);
      check('下钻后：列表 / 搜索栏让位，内容区**直接就是面板**（没有返回按钮那一行）',
        hasPropsPanel(opened) && !hasLibrary(opened) && !opened.shape.includes('we-qp__viewbar')
          && !findBtn(opened.tree, '返回'),
        'panel=' + hasPropsPanel(opened) + ' lib=' + hasLibrary(opened));
      check('下钻时入口仍在（同一行同一位置，文案换成「收起壁纸属性」）—— 收起路径靠它',
        hasEntry(opened) && !findBtn(opened.tree, '壁纸属性') && Boolean(findBtn(opened.tree, '收起壁纸属性')));
      // 收起 ⇒ 回壁纸页（列表回来、面板消失），走的是处理器的关闭路径（没有返回按钮，
      // 所以走的是那枚「收起壁纸属性」；这条判据同时钉住"收起路径没有丢"）。
      const collapse = findBtn(opened.tree, '收起壁纸属性');
      const closedSel = withCurrent('scene', 's1', 'http://x/props/tokS', false);
      const closed = renderTab('wallpaper', closedSel);
      check('点「收起壁纸属性」⇒ 回壁纸页（列表与入口都回来、面板消失）',
        Boolean(collapse) && (collapse.props.onClick(), hasLibrary(closed)
          && !hasPropsPanel(closed) && hasEntry(closed) && Boolean(findBtn(closed.tree, '壁纸属性'))));
      // 结构性判据（这一族缺陷的共同形态就是"某一档里内容区什么都没有"）：壁纸档在任何
      // 开关 / 属性组合下，内容区都必须有**列表**或**面板**之一。
      for (const [name, sel] of [
        ['有属性 + 开关开（下钻）', withCurrent('scene', 's1', 'http://x/props/tokS', true)],
        ['有属性 + 开关关（列表）', withCurrent('scene', 's1', 'http://x/props/tokS', false)],
        ['propsUrl 被清掉 + 开关开', withCurrent('scene', 's1', '', true, null)],
        ['开关关着', withCurrent('scene', 's1', 'http://x/props/tokS', false)],
        ['本来就没属性（图片壁纸）', withCurrent('image', 'i1', null, true)],
      ]) {
        const t = renderTab('wallpaper', sel);
        check('壁纸档内容区非空（' + name + '）—— 列表或面板必居其一',
          hasLibrary(t) || hasPropsPanel(t), 'lib=' + hasLibrary(t) + ' panel=' + hasPropsPanel(t));
      }
      // 入口三档都在同一位置（页签栏下方）⇒ 切到外观 / 播放档时入口照旧在，面板不画。
      check('入口三档都在（不随页签消失、也不随下钻消失）；面板只属壁纸档',
        hasEntry(renderTab('wallpaper', openSel)) && hasEntry(renderTab('appearance', openSel))
          && hasEntry(renderTab('playback', openSel))
          && hasEntry(renderTab('wallpaper', withCurrent('scene', 's1', 'http://x/props/tokS', false)))
          && !hasPropsPanel(renderTab('appearance', openSel))
          && !hasPropsPanel(renderTab('playback', openSel)));
    }
  }
  // 接线判据：侧栏三档的树里**不许出现设置页专属的占位器**（把它戳一下会抛 [we-sidebar]）。
  // 抓的是"ctx 装错对象 / 少接一个处理器"那一类 —— 源码级判据只认名字在不在文件里，认不出
  // 它被塞进了哪一个 ctx 对象。其余抛错（例如替身里缺 weDrawCtx）不算，本判据只认那串前缀。
  const stubHits = (tree) => {
    const hits = [];
    (function walk(n) {
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (!n || typeof n !== 'object') return;
      for (const k of Object.keys(n.props || {})) {
        const fn = n.props[k];
        if (typeof fn !== 'function') continue;
        hits.push('#'); // 覆盖率计数（见下）：判据不能因为"树里根本没有处理器"而恒真
        try { fn({ target: { value: '1', checked: true } }); }
        catch (e) { if (String(e && e.message).includes('[we-sidebar]')) hits.push(k); }
      }
      if (Array.isArray(n.children)) n.children.forEach(walk);
    })(tree);
    return hits;
  };
  const wired = [wp, ap, pb].map((t) => stubHits(t.tree));
  const handlerCount = wired.reduce((sum, h) => sum + h.filter((x) => x === '#').length, 0);
  check('侧栏三档的控件都接在真人身上（树里没有设置页专属的占位器）—— 覆盖面 ' + handlerCount + ' 个处理器',
    handlerCount >= 10 && wired.every((h) => h.filter((x) => x !== '#').length === 0),
    wired.flat().filter((x) => x !== '#').join(', ') || '没有占位器上线');
  check('负对照：把设置页专属处理器塞进树里会被同一判据抓出',
    stubHits({ props: { onClick: () => { throw new Error('[we-sidebar] ctx.fontSet 属于设置页'); } }, children: [] })
      .filter((x) => x !== '#').length === 1);
}

// ── 设置页页签的渲染挂载台 + **节顺序**判据（P4-19 的前置）──────────────────────
// 为什么需要它：`renderWallpaperTab`（最大，458 行）与 `renderAdvancedTab` 此前**一条行为判据
// 都没有** —— 只有源码锚点（"函数在这儿""首行从 ctx 解构"）。而纯搬动最容易出的事
// （**漏掉一节 / 改掉顺序 / 复制一节**）源码锚点一个都看不见。
// 这里的挂载台用**真渲染器**（同一个 `panelMod`）+ 最小替身渲染这两个页签，并抽出树里
// `we-picker__section-label` 的**有序**序列 —— 于是"节顺序"成了**行为**判据：它对任何重构
// 都不变（代码搬去哪都行，只要渲染出来还是这个顺序），正是拆分这种纯搬动需要的那类判据。
{
  const noop = () => null;
  // 同一个模块（前面那块已经 import 过 ⇒ 这里拿的是缓存），但 `const` 是块作用域、不能跨块用。
  const panelMod = await import(pathToFileURL(join(root, 'src', 'panel-tabs.js')).href);
  // 刀4：节的渲染器拆到 5 个兄弟模块里了 —— 挂载台是**按文件 import** 的，而运行时是同作用域，
  // 所以把它们逐个挂到 globalThis（与 glass-panel / section-head / 字体表同一做法）。
  for (const rel of panelSources().slice(0, -1)) {
    const mod = await import(pathToFileURL(join(root, rel)).href);
    for (const [k, v] of Object.entries(mod)) globalThis[k] = v;
  }
  // A3：装共享注册表 —— 三项来自三份不同 bundle（求值顺序不保证）⇒ 挂载台必须自己登记。
  await installExtensionRegistry();
  const schemaMod = await import(pathToFileURL(join(root, 'lib', 'settings-schema.js')).href);
  // ⚠️ 先归一成 LF 再切片：工作树是 CRLF，而下面的边界串是 `\n  }\n`（裸 LF）——
  // 在 CRLF 上它**匹配不到**，`indexOf` 回 -1 会让切片一路吃到文件尾（把别人的解构也当成
  // 这一节的），于是判据会把整个词表都报成"漏解构"。这类"切错了还照旧报"正是判据要防的形状。
  const tabsSrcNow = panelText()
    .replace(/\r\n/g, '\n')
    + '\n;\n' + fontSectionSrc;
  // 这些名字在产物里是**内联同一作用域**的常量 / 纯组件 / 纯函数；单独 import 时按内联规则
  // 补 globalThis 替身（`weT` 由 tools/weT-shim.mjs 装、React 等由上面那块装）。
  Object.assign(globalThis, {
    DEFAULTS: schemaMod.DEFAULTS,
    ADAPTER_TARGET_VALUES: schemaMod.ADAPTER_TARGET_VALUES,
    Toggle: noop, VinylRecord: noop,
    SWITCH_DIRS: ['left', 'right'], SWITCH_DIR_LABELS: { left: '左', right: '右' },
    SWITCH_SPEEDS: [{ id: 'fast', ms: 200 }, { id: 'normal', ms: 400 }],
    SWITCH_TRANSITIONS: [{ id: 'fade' }, { id: 'wipe' }],
    ADAPTER_LABELS: { auto: '自动检测' },
    adapterCaps: () => ({}), adapterDetectedLabel: () => '', adapterMismatchWarning: () => '',
    liveDiagVerbose: () => false, weAudioVolume: () => 0, vinylSpinVisible: () => false,
    liveFailReasonOf: () => '', groupWallpapers: () => [], switchFrames: () => [],
    switchTransitionOf: () => ({ id: 'fade', dir: 'left', speed: 'normal', ms: 400 }),
    renderConfirmRow: noop,
    changeUploadDir: async () => {}, changeWeAssetsDir: async () => {},
    uploadWallpaperFile: () => {}, removeUploadWallpaper: () => {},
    importPlaylistIntoDraft: () => {}, saveEditingGroup: () => {},
    startEditGroup: () => {}, cancelEditGroup: () => {}, startCreateGroup: () => {},
    // 效果页**实时渲染组**（`sel.type` 为场景/网页时才画）此前从没渲染过 —— 它要的这批替身
    // 一个都没给，于是那几十行连"渲染得出"这一条都过不了。补上才能让它进入判据视野。
    codecLabel: () => '', framePreviewSrc: () => '',
    probeGpuFrameState: () => ({}), syncLayers: () => {},
    // `false` = 实时渲染未生效 ⇒ 「出图来源」那一行也画出来（覆盖更宽的那一支）。
    liveRenderEnabled: () => false, customFrameInput: null,
    SCENE_LIVE_FPS_VALUES: [0, 24, 30, 60],
    // ⚠️ 挂载台原先把 `FRAME_VARIANTS` 设成**空数组** ⇒ 场景档那一行读 `FRAME_VARIANTS[i].label`
    // 直接抛（"从没渲染过"的又一处：空替身让整条分支不可达）。给成有内容的表，分支才可达。
    FRAME_VARIANTS: [{ id: 0, label: '默认' }, { id: 1, label: '档 1' }, { id: 2, label: '档 2' }],
    frameVariantCount: () => 3,
  });
  /** 树上 `we-picker__section-label` 的**有序**文本序列（深度优先 = 渲染顺序）。 */
  const sectionSeq = (n, acc = []) => {
    if (Array.isArray(n)) { n.forEach((x) => sectionSeq(x, acc)); return acc; }
    if (!n || typeof n !== 'object') return acc;
    const cls = n.props && n.props.className;
    if (typeof cls === 'string' && cls.includes('we-picker__section-label')) {
      const txt = (Array.isArray(n.children) ? n.children : []).filter((c) => typeof c === 'string').join('');
      if (txt) acc.push(txt);
    }
    if (Array.isArray(n.children)) n.children.forEach((x) => sectionSeq(x, acc));
    return acc;
  };
  const sameSeq = (got, want) => got.length === want.length && got.every((x, i) => x === want[i]);

  // ── 把"标签"从替身里**放回树里**：`SliderRow` / `switchRow` / `ctlText` 的标签本来就是
  // 用户看得见的那一行文字，但 `noop` 把它们吞成 null ⇒ "控件标签的有序序列"就不可能成为判据。
  // 这条细锚是 `renderEffectsTab` 需要的：它**只有一个节标签**，节顺序钉不住它的内部结构。
  const REACT = globalThis.React;
  const labelStub = (label) => (typeof label === 'string' && label
    ? REACT.createElement('span', { className: 'stub-label' }, label) : null);
  globalThis.SliderRow = labelStub;
  globalThis.switchRow = (label) => labelStub(label);
  globalThis.ctlText = (label) => labelStub(label);
  /** 树里**控件标签**的有序序列（`stub-label` = SliderRow / switchRow / ctlText 的标签）。 */
  const labelSeq = (n, acc = []) => {
    if (Array.isArray(n)) { n.forEach((x) => labelSeq(x, acc)); return acc; }
    if (!n || typeof n !== 'object') return acc;
    const cls = n.props && n.props.className;
    if (typeof cls === 'string' && cls.includes('stub-label')) {
      const txt = (Array.isArray(n.children) ? n.children : []).filter((c) => typeof c === 'string').join('');
      if (txt) acc.push(txt);
    }
    if (Array.isArray(n.children)) n.children.forEach((x) => labelSeq(x, acc));
    return acc;
  };
  /**
   * 树里所有 `className` 的**有序**序列，以及去重排序后的"**画了哪些控件种类**"。
   *
   * 为什么需要这条：`labelSeq` **只看得见走 `SliderRow` / `switchRow` / `ctlText` 的标签** ——
   * 而轮播编辑器那几十行是**裸 `<input>` / `<select>` / `<span>`** 拼的，一个标签都不产。
   * 实测：把 `groups` / `group` / `editing` / `armedConfirm` 全打开后，`labelSeq` **仍然是原来那 3 个**
   * ⇒ 标签锚对"裸控件"这一段是**盲的**。类名序列补的正是这个盲区（它认"画了哪些种类"，
   * 而不是"写了哪些词"），且同样是行为级的：对任何重构不变。
   */
  const classSeq = (n, acc = []) => {
    if (Array.isArray(n)) { n.forEach((x) => classSeq(x, acc)); return acc; }
    if (!n || typeof n !== 'object') return acc;
    const cls = n.props && n.props.className;
    if (typeof cls === 'string' && cls) acc.push(cls);
    if (Array.isArray(n.children)) n.children.forEach((x) => classSeq(x, acc));
    return acc;
  };
  const classKinds = (tree) => [...new Set(classSeq(tree))].sort();
  /** 树里所有字符串（去重后排序）—— **文本锚**用：有些分支只改文案（同一套构件），
   *  类名锚看不见，标签锚也只认走 SliderRow/switchRow/ctlText 的那些。 */
  const treeStrings = (n, acc = []) => {
    if (Array.isArray(n)) { n.forEach((x) => treeStrings(x, acc)); return acc; }
    if (!n || typeof n !== "object") return acc;
    if (Array.isArray(n.children)) {
      for (const c of n.children) { if (typeof c === "string") acc.push(c); else treeStrings(c, acc); }
    }
    return acc;
  };
  const textKinds = (tree) => [...new Set(treeStrings(tree))].sort();

  // ── 共享地基符号的替身（src/we-base.js）──────────────────────────────────────
  // `weClampTo` / `weNow` / `weBody` 在构建期是同一作用域里的兄弟模块符号，单文件 import 时
  // 却是**裸标识符** ⇒ 下面所有"单独 import 真模块"的腿（fx / parallax / avatar 三层）都要在
  // 运行前把这三枚补到 globalThis 上，跑完还原（别的腿可能正判"这些名字不存在"）。
  const weBaseMod = await import(pathToFileURL(join(root, 'src', 'we-base.js')).href);
  const stubWeBase = () => {
    const keys = ['weClampTo', 'weNow', 'weBody'];
    const prev = {};
    for (const k of keys) { prev[k] = globalThis[k]; globalThis[k] = weBaseMod[k]; }
    return () => { for (const k of keys) { if (prev[k] === undefined) delete globalThis[k]; else globalThis[k] = prev[k]; } };
  };


  // ── 点击效果与拖尾效果（「扩展」二号模块）的两半：画布层 + 扩展岛 ──────────────────
  // 与一号模块同款覆盖方式：单独 import 真模块 + 真渲染一次。这一族的驱动源是**输入事件**
  // 与一个内容驱动的 rAF 循环 —— 沙箱里两者都没有，所以"零副作用"这条比一号模块更要紧：
  // 没有 rAF 时它连 DOM 都不该建（碰一下 `document` 就是 TypeError）。
  const fxLayerMod = await import(pathToFileURL(subFxFile('fx-layer.js')).href);
  const extFxMod = await import(pathToFileURL(subFxFile('ext-fx.js')).href);
  {
    const PREV_SEL = globalThis.selection;
    const restoreWeBase = stubWeBase();
    let threw = '';
    try {
      // ① 开着 ⇒ 走 fxStart（无 rAF ⇒ 那一行守卫把整段挡回去）
      globalThis.selection = { fxEnabled: true };
      fxLayerMod.syncFxLayer();
      // ② 开着但点击与拖尾都关了 ⇒ 走 fxStop（"两个子开关全关"就不该留一层空画布）
      globalThis.selection = { fxEnabled: true, fxClick: false, fxTrail: false };
      fxLayerMod.syncFxLayer();
      // ③ 关掉 ⇒ 仍是 stop 分支；卸载幂等
      globalThis.selection = { fxEnabled: false };
      fxLayerMod.syncFxLayer();
      fxLayerMod.disposeFxLayer();
    } catch (e) { threw = String((e && e.message) || e); } finally { globalThis.selection = PREV_SEL; restoreWeBase(); }
    check('fx-layer.js 可单独 import · 导出只有两枚 · 无 rAF 环境零抛错零副作用',
      Object.keys(fxLayerMod).sort().join(',') === 'disposeFxLayer,syncFxLayer'
      && typeof fxLayerMod.syncFxLayer === 'function'
      && typeof fxLayerMod.disposeFxLayer === 'function'
      && !threw, threw);
    // 源码口径：这一层最要紧的几件事都是"看不见的行为"（层级、输入过滤、混合写在宿主、
    // 空闲零帧），运行期判据在沙箱里够不着 ⇒ 与一号模块同款用源码断言钉住形态。
    // ⚠️ 归一成 LF 再切片：CI（windows-latest）检出是 CRLF，字面量 \\n 的 includes 在那边恒 miss。
    const fxSrc = readFileSync(subFxFile('fx-layer.js'), 'utf8').replace(/\r\n/g, '\n');
    check('fx-layer.js 内容驱动帧循环 + 层级压在暗化层之上 + 不接管输入 + 混合写在宿主 + 死锁负向',
      fxSrc.includes("const FX_HOST_ID = 'we-fx-layer';")
      && fxSrc.includes('const FX_UI_SELECTOR = ')
      && fxSrc.includes('function fxEnsureHost()')
      && fxSrc.includes('if (fxHost && fxHost.isConnected) return;')
      && fxSrc.includes('function fxRemoveHost()')
      && fxSrc.includes("if (typeof requestAnimationFrame !== 'function') return;")
      && fxSrc.includes('function fxFrame()')
      // 帧循环是**内容驱动**的：还有活着的点/圈才续帧，画空了就自然收工（空闲零帧）。
      && fxSrc.includes('const active = fxClicks.length > 0 || fxTrail.length > 1;')
      && fxSrc.includes('if (active) fxKick();')
      // ⚠️ 帧头只能判"该不该画"，紧接着就 ensure 宿主 —— 把"宿主还没建"也算进早退条件会死锁
      // （早退条件里带上"宿主还没就绪"犯过一次：帧循环还没轮到建宿主就被自己 return 掉）。
      // 这里断言的是**正确形态**本身：那条 return 之后第一句就是幂等的 fxEnsureHost()。
      && fxSrc.includes('if (!fxOn || !st.on) return;\n  fxEnsureHost();')
      && fxSrc.includes('function fxPlace()')
      && fxSrc.includes('compareDocumentPosition')
      // 层级：本层压在暗化层**之上**（壁纸 → 本层 → 暗化层 → 界面）。
      && fxSrc.includes('scrim.parentNode.insertBefore(fxHost, scrim.nextSibling)')
      // 不透明度与混合模式写在**宿主**上（写在画布上只跟宿主自己的 stacking context 混合）。
      && fxSrc.includes("fxNodeStyle(fxHost, 'mix-blend-mode', st.blend)")
      && fxSrc.includes("fxNodeStyle(fxHost, 'opacity', String(st.opacity / 100))")
      && fxSrc.includes("g.globalCompositeOperation = 'lighter'")
      // 不接管输入：点在自己的控件上不炸光效，监听是 passive 的（绝不拦指针）。
      && fxSrc.includes('function fxAllowClick(target)')
      && fxSrc.includes('target.closest(FX_UI_SELECTOR)')
      && fxSrc.includes('{ passive: true }'),
      'fx-layer = 内容驱动 rAF + 层级 + 输入过滤 + 宿主混合；死锁形态 = 帧头 ensure 之前不许有别的早退');
  }
  {
    // ── #190 光效层性能契约 ────────────────────────────────────────────────────
    // 报告实测的敏感度与代码结构逐条对应：主因是 Canvas2D 的 shadowBlur（每次 stroke/fill
    // 触发一次离屏高斯模糊）落在**每帧每图元**上 —— 「点击光晕 / 拖尾光晕影响很大」、
    // 「拖尾时长正相关」（每帧模糊次数 ≈ 存活点数）、「星火 > 涟漪」（12 次 vs 2 次）。
    // 这条判据用**假 canvas 数贵操作**：只数 stroke / fill / 非零 shadowBlur 赋值，
    // 在最小 DOM 替身下真跑一遍画布层，断言"一帧的贵操作数"落在一个**只许下降**的上界内。
    // 纯源码断言（例如"文件里不许出现 shadowBlur"）挡不住"换成别的贵写法"，故以计数为准。
    const fxPerfSrc = readFileSync(subFxFile('fx-layer.js'), 'utf8').replace(/\r\n/g, '\n');
    const restorePerfBase = stubWeBase();
    const PERF_KEYS = ['document', 'window', 'requestAnimationFrame', 'cancelAnimationFrame', 'selection', 'weNow'];
    const prevPerf = {};
    for (const k of PERF_KEYS) prevPerf[k] = globalThis[k];
    let perfNote;
    let ops = null;
    try {
      // 假 2D 上下文：只数贵操作。**模糊按"绘制时 shadowBlur > 0"计**（那才是真的
      // 高斯模糊次数）—— 只数赋值会漏掉"一次赋值、多次描边"（星火那 12 条正是这个形态）。
      const mkCtx = () => {
        const c = { ops: { stroke: 0, fill: 0, blur: 0 } };
        const noop = () => {};
        for (const m of ['setTransform', 'clearRect', 'beginPath', 'moveTo', 'lineTo', 'arc',
          'save', 'restore', 'closePath', 'rect', 'fillRect', 'translate', 'scale']) c[m] = noop;
        c.clearRect = noop;
        c.stroke = () => { c.ops.stroke += 1; if (c.shadowBlur > 0) c.ops.blur += 1; };
        c.fill = () => { c.ops.fill += 1; if (c.shadowBlur > 0) c.ops.blur += 1; };
        for (const p of ['globalAlpha', 'globalCompositeOperation', 'strokeStyle', 'fillStyle',
          'shadowColor', 'lineWidth', 'lineCap', 'lineJoin', 'font']) c[p] = '';
        c.shadowBlur = 0;
        return c;
      };
      const ctx = mkCtx();
      const mkStyle = () => ({
        _m: {},
        setProperty(k, v) { this._m[k] = v; },
        getPropertyValue(k) { return this._m[k] || ''; },
        removeProperty() {},
      });
      const fakeCanvas = {
        width: 0, height: 0, style: mkStyle(), className: '',
        setAttribute() {}, appendChild() {}, getContext() { return ctx; },
      };
      const fakeHost = {
        id: '', className: '', style: mkStyle(), isConnected: true, parentNode: null,
        setAttribute() {}, appendChild() {},
        compareDocumentPosition() { return 0; },
      };
      const listeners = {};
      globalThis.document = {
        body: { appendChild() {} },
        createElement(tag) { return tag === 'canvas' ? fakeCanvas : fakeHost; },
        addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
        removeEventListener(type, fn) {
          const a = listeners[type] || [];
          const i = a.indexOf(fn);
          if (i >= 0) a.splice(i, 1);
        },
        querySelector() { return null; },
      };
      let clock = 1000;
      globalThis.weNow = () => clock;
      globalThis.window = {
        innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1,
        performance: { now: () => clock },
      };
      let rafCb = null;
      globalThis.requestAnimationFrame = (fn) => { rafCb = fn; return 1; };
      globalThis.cancelAnimationFrame = () => { rafCb = null; };
      // 满档设置：光晕与时长都拉满（= 报告里最吃 GPU 的那组），两种点击样式与拖尾样式各测一次。
      globalThis.selection = {
        fxEnabled: true, fxClick: true, fxTrail: true,
        fxClickStyle: 'both', fxTrailStyle: 'comet',
        fxClickSize: 140, fxClickGlow: 100, fxTrailLength: 2000, fxTrailWidth: 3,
        fxTrailGlow: 100, fxOpacity: 85, fxBlend: 'screen',
        fxColorMode: 'accent', fxColor: '#4f8cff',
      };
      const runFrame = () => {
        const cb = rafCb;
        rafCb = null;
        if (cb) cb();
      };
      fxLayerMod.syncFxLayer();
      // 灌一条足够长的拖尾（模拟光标划过）+ 一次点击，然后量**一帧**的贵操作数。
      for (let i = 0; i < 400; i += 1) {
        for (const fn of (listeners.pointermove || [])) {
          fn({ clientX: 60 + i * 4, clientY: 120 + (i % 60) * 6 });
        }
      }
      for (const fn of (listeners.pointerdown || [])) fn({ clientX: 900, clientY: 500, target: null });
      clock += 100; // 跨过降帧闸门
      ctx.ops.stroke = 0; ctx.ops.fill = 0; ctx.ops.blur = 0;
      runFrame();
      ops = { stroke: ctx.ops.stroke, fill: ctx.ops.fill, blur: ctx.ops.blur };
      perfNote = 'stroke=' + ops.stroke + ' fill=' + ops.fill + ' blur=' + ops.blur;
    } catch (e) {
      perfNote = 'threw: ' + String((e && e.message) || e);
    } finally {
      try { fxLayerMod.disposeFxLayer(); } catch { /* 已卸载 */ }
      for (const k of PERF_KEYS) {
        if (prevPerf[k] === undefined) delete globalThis[k]; else globalThis[k] = prevPerf[k];
      }
      restorePerfBase();
    }
    // 上界是**棘轮**（只许下降）：实测形态下 96 点的彗尾 + both 点击，分带后每帧只剩个位数
    // 的带级描边；这里留出余量到 40，但把"逐段一次模糊"（≈99）挡在外面。
    const OPS_CAP = 40;
    const BLUR_CAP = 24;
    check('#190 光效层：一帧的贵操作数在棘轮内（分带 + 星火合并 + 光晕不再逐图元）',
      Boolean(ops) && ops.stroke + ops.fill <= OPS_CAP && ops.blur <= BLUR_CAP,
      '需 stroke+fill ≤ ' + OPS_CAP + ' 且 blur ≤ ' + BLUR_CAP + ' —— ' + perfNote);
    // 源码口径：降级状态机与分带表的形态（行为计数够不着"有没有可回退的降级"这件事）。
    check('#190 光效层：自适应降级状态机 + 拖尾分带表在位（可回退 / 有迟滞）',
      fxPerfSrc.includes('FX_PERF_SLOW_MS')
      && fxPerfSrc.includes('FX_PERF_DOWN_RUN')
      && fxPerfSrc.includes('FX_PERF_UP_RUN')
      && fxPerfSrc.includes('FX_TRAIL_BANDS_BY_LEVEL')
      && fxPerfSrc.includes('function fxPerfUpdate(')
      // 升档必须存在（只降不升 = 一次卡顿永久降级）。
      && /fxPerfLvl\s*-=\s*1/.test(fxPerfSrc)
      // 12 条火花合并成一条 path、只描边一次。
      && /g\.beginPath\(\);\s*\n\s*for \(let i = 0; i < FX_SPARK_COUNT/.test(fxPerfSrc),
      'fxPerfSrc: ' + fxPerfSrc.length + ' 字节');
  }
  {
    // ── #192 模块级 / 页签级 / 全局重置 ────────────────────────────────────────
    // 键集是**派生或手写+对账**的（RESET_MODULES / RESET_TABS ← KINDS）⇒ 判据盯四件事：
    // 四档口径都要有、各组非空、两两不相交、且每个键都有默认值可回写。
    const groups = schemaMod.RESET_MODULES || {};
    const names = Object.keys(groups);
    const allKeys = [];
    for (const n of names) { for (const k of groups[n]) allKeys.push(k); }
    const uniq = new Set(allKeys);
    // 真正要守的是"每个键都有默认值可回写" —— 缺默认值的键会让重置**静默什么都不做**
    //（`resetKeysToDefault` 会跳过它），那正是"假控件"。刻意**不**用
    // `PROFILE_PRESET_KEYS` 当判据：头像文件名属预设的**资产段**、`parallaxPluginDepths`
    // 属排除段，但两者都该跟着模块一起重置（重置不该留着"上次导入的头像"）。
    const missingDefault = allKeys.filter((k) => !Object.prototype.hasOwnProperty.call(schemaMod.DEFAULTS, k));
    check('#192 模块分组：扩展 3 + 外观 6 共九组、非空、两两不相交、每键都有默认值可回写',
      names.length === 9
      && names.every((n) => groups[n].length > 0)
      && uniq.size === allKeys.length
      && missingDefault.length === 0,
      'names=' + names.join(',') + ' keys=' + allKeys.length + ' missingDefault=' + missingDefault.join(','));
    // 面板侧源码口径：全局重置**必须**经过既有两步确认构件（直接上屏 = 违背 #192 的
    // "不可撤销所以要确认"），模块头要有 ↺ 且真的接到 onResetModule。
    const ptSrc = readFileSync(join(root, 'src', 'panel-tabs.js'), 'utf8').replace(/\r\n/g, '\n');
    check('#192 全局重置走两步确认 + 模块头有 ↺ 且接到分组',
      ptSrc.includes('function renderResetSection(')
      && ptSrc.includes('renderConfirmRow(armedConfirm, token,')
      && ptSrc.includes('we-mod-reset') === false // 类名住在共用构件里
      && ptSrc.includes('moduleResetButton(mod.resetGroup, onResetModule)'),
      'panel-tabs 源码口径');
    // 模块级 ↺ 必须**覆盖外观页签下的每个模块**（用户口径："外观下的模块也要能单独重置"）：
    // 六个外观节各有一处调用，且共用构件必须阻止冒泡（否则点 ↺ 会连带收起该节）。
    const mrSrc = readFileSync(join(root, 'src', 'module-reset.js'), 'utf8').replace(/\r\n/g, '\n');
    const gpSrc = readFileSync(join(root, 'src', 'glass-panel.js'), 'utf8').replace(/\r\n/g, '\n');
    // ⚠️ 刀4 之后节的渲染器搬到了 src/panel-tabs-*.js 域模块 ⇒ 扫**页签族全文**（组装点在末尾），
    //    而不是组装点单文件（否则六处调用全在域模块里 ⇒ 假红 missing=theme,detail,…）。
    const appearanceModules = ['theme', 'detail', 'corners', 'uiColor', 'font'];
    const panelAllSrc = panelText() + '\n;\n' + fontSectionSrc;
    const missingModules = appearanceModules.filter((m) => !panelAllSrc.includes('moduleResetButton("' + m + '"'));
    check('#192 外观六模块各挂 ↺ + 玻璃 UI 也挂 + 共用构件阻止冒泡',
      missingModules.length === 0
      && gpSrc.includes('moduleResetButtonNode("glass", onResetModule')
      && mrSrc.includes('function moduleResetButtonNode(moduleName, onResetModule, labels) {')
      && mrSrc.includes('stopPropagation')
      && mrSrc.includes('"we-mod-reset"'),
      'missing=' + missingModules.join(',') + ' glass=' + gpSrc.includes('moduleResetButtonNode("glass"')
      + ' stop=' + mrSrc.includes('stopPropagation'));
    // 页签级划分（用户口径「每个选项卡后面加重置，重置指定选项卡」）：
    // 必须是一份**完整划分** —— 每个可重置键恰好属于一个页签，或落在显式排除表里。
    // 这是"手写表"的唯一兜底：新增设置键若两边都没登记，这里当场判红（而不是静默不重置）。
    const tabs = schemaMod.RESET_TABS || {};
    const excluded = schemaMod.RESET_TABS_EXCLUDED || [];
    const resettable = Object.keys(schemaMod.KINDS)
      .filter((k) => !schemaMod.DEFAULTS_ONLY.includes(k) && !schemaMod.CLIENT_ONLY.includes(k));
    const tabKeys = [];
    for (const n of Object.keys(tabs)) { for (const k of tabs[n]) tabKeys.push(k); }
    const tabSeen = new Set(tabKeys);
    const tabDup = tabKeys.filter((k, i) => tabKeys.indexOf(k) !== i);
    const uncovered = resettable.filter((k) => !tabSeen.has(k) && !excluded.includes(k));
    const overlapWithExcluded = excluded.filter((k) => tabSeen.has(k));
    const strayExcluded = excluded.filter((k) => !resettable.includes(k));
    check('#192 页签划分：五页签非空 + 完整覆盖可重置键 + 与排除表互斥（新增键漏登记即判红）',
      Object.keys(tabs).length === 5
      && Object.keys(tabs).every((n) => tabs[n].length > 0)
      && tabDup.length === 0
      && uncovered.length === 0
      && overlapWithExcluded.length === 0
      && strayExcluded.length === 0,
      'tabs=' + Object.keys(tabs).join(',') + ' covered=' + tabSeen.size + '/' + resettable.length
      + ' dup=' + tabDup.join(',') + ' uncovered=' + uncovered.join(',')
      + ' overlap=' + overlapWithExcluded.join(',') + ' stray=' + strayExcluded.join(','));
    // 面板侧：页签重置**挂在渲染点一处**（六处渲染器各挂一遍必然漏一个）。
    const clSrc3 = readFileSync(join(root, 'src', 'client.js'), 'utf8').replace(/\r\n/g, '\n');
    check('#192 页签重置：单一挂载点 + 关于页签不给假按钮 + 处理器在 client.js',
      ptSrc.includes('function renderTabReset(ctx, tabId)')
      && ptSrc.includes('if (tabId === "about") return null;')
      && ptSrc.includes('renderConfirmRow(armedConfirm, token,')
      // ⚠️ 重置节的标题**不许**用 `we-picker__section-label`：那是"设置分组卡"的类名，
      // 而那些按"末三张分组卡"取窗口的判据（3D 效果页正好三张）会被它挤掉。
      && ptSrc.includes('we-picker__section-reset-label')
      && !/weT\("重置本页"\)\).*section-label/.test(ptSrc)
      && clSrc3.includes('renderTabReset({')
      && clSrc3.includes('const onResetTab = (tabId) =>'),
      'panel-tabs + client 源码口径');
  }
  {
    // ── #191 问题 2：连续同侧消息只在首条显示头像 ──────────────────────────────
    const avSrc = readFileSync(join(root, 'src', 'avatar-layer.js'), 'utf8').replace(/\r\n/g, '\n');
    // ⚠️ 刀4 之后 `src/styles.js` 只是 31 行组装点 ⇒ 样式判据必须读**样式族全文**（styleText()）。
    const stSrc = styleText();
    check('#191 头像分组：只在首条显示 + 续行用 visibility 隐藏（不摘节点 ⇒ 不踩回 #154）',
      avSrc.includes("const AVATAR_CONT_CLASS = 'we-avatar--cont';")
      && avSrc.includes('function avatarApplyGrouping()')
      && avSrc.includes('classList.toggle(AVATAR_CONT_CLASS, side === prev)')
      && avSrc.includes('function avatarScheduleGrouping()')
      && avSrc.includes('if (decorated) avatarScheduleGrouping();')
      // #154 的保护线：续行**只许**用 visibility 隐藏。出现 display 就是踩回那个坑 ——
      // 摘掉/收起头像那一路曾让收起的思考行宽度塌成 0、连入口一起消失。
      && /\.we-avatar--cont\s*\{\s*visibility:\s*hidden;\s*\}/.test(stSrc)
      && !/\.we-avatar--cont\s*\{[^}]*display\s*:/.test(stSrc),
      'avatar-layer + styles 源码口径');
  }
  {
    // ── #191 问题 1：上传裁切 ──────────────────────────────────────────────────
    // 做法是"**导入时先裁再传**"（盘上那张就是裁完的方形图）⇒ 零新设置键、预览与会话天然一致。
    // 判据盯三件事：① 裁切几何只有一份实现（渲染器不自己再算一遍）；② 上传腿走既有的
    // postImageAsset（不新开第二条落盘通道）；③ 弹窗有取消路径（取消 = 不上传、撤 URL）。
    const clSrc2 = readFileSync(join(root, 'src', 'client.js'), 'utf8').replace(/\r\n/g, '\n');
    const eaSrc = readFileSync(join(root, 'src', 'ext-avatar.js'), 'utf8').replace(/\r\n/g, '\n');
    check('#191 上传裁切：唯一几何实现 + 走既有上传腿 + 有取消路径',
      clSrc2.includes('function avatarCropGeometry()')
      && clSrc2.includes('function cropAvatarToBlob()')
      && clSrc2.includes('function onAvatarCropConfirm()')
      && clSrc2.includes('postImageAsset("/avatar/" + side, img.blob, weT("头像"))')
      // 取消必须真的撤掉预览 URL（否则每次取消漏一个 blob）
      && clSrc2.includes('function closeAvatarCrop()')
      && clSrc2.includes('URL.revokeObjectURL(url)')
      // 渲染器只读 ctx 传进来的几何（不引 avatarCropGeometry 这个裸标识符）
      && eaSrc.includes('function renderAvatarCropModal(ctx)')
      && eaSrc.includes('ctx.avatarCropGeo')
      && !eaSrc.includes('avatarCropGeometry('),
      'client + ext-avatar 源码口径');
  }
  {
    // ── 文件头尺寸解析器：**喂真字节**跑真实现（#185 后续）──────────────────────────
    // 上面那组判据只钉"函数在不在、顺序对不对"（源码口径）。但 `parseBitmapHeaderSize`
    // 是这轮**唯一含位运算的新代码** —— 位域读错一位就会把 1024 读成 0（闸随之恒放行）。
    // 所以这里 import **真实现**、用合成的最小文件头喂它，断言的是**返回值**而不是源码形状。
    // 之所以能这么测：`src/avatar-import.js` 是纯函数（零 DOM、零异步、零外界），
    // 而它独立成文件的理由与 section-head / module-reset 完全相同（按文件 import 的替身
    // 必须取到真实现）。
    const ai = await import(pathToFileURL(join(root, 'src', 'avatar-import.js')).href);
    /** 造一个 PNG 头（89 50 4E 47 0D 0A 1A 0A + 长度 + IHDR + 宽 + 高）。 */
    const pngHead = (w, h) => {
      const b = new Uint8Array(32);
      b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
      b.set([0, 0, 0, 13], 8);
      b.set([0x49, 0x48, 0x44, 0x52], 12);
      b[16] = (w >>> 24) & 255; b[17] = (w >>> 16) & 255; b[18] = (w >>> 8) & 255; b[19] = w & 255;
      b[20] = (h >>> 24) & 255; b[21] = (h >>> 16) & 255; b[22] = (h >>> 8) & 255; b[23] = h & 255;
      return b.buffer;
    };
    const png = ai.parseBitmapHeaderSize(pngHead(1024, 768));
    check('尺寸解析：PNG 头部读出真实宽高（1024×768）+ 认得出 kind',
      png && png.width === 1024 && png.height === 768 && png.kind === 'png',
      JSON.stringify(png));
    // GIF：GIF89a + 小端 u16 宽高。
    const gifGot = (() => {
      const b = new Uint8Array(16);
      b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
      b[6] = 300 & 255; b[7] = (300 >> 8) & 255;
      b[8] = 200 & 255; b[9] = (200 >> 8) & 255;
      return ai.parseBitmapHeaderSize(b.buffer);
    })();
    check('尺寸解析：GIF 头部读出小端宽高（300×200）',
      gifGot && gifGot.width === 300 && gifGot.height === 200 && gifGot.kind === 'gif',
      JSON.stringify(gifGot));
    // BMP：BM + DIB，宽高是**有符号**小端 i32（负高度 = 自顶向下）。
    const bmpGot = (() => {
      const b = new Uint8Array(32);
      b[0] = 0x42; b[1] = 0x4d;
      const w = 640; const h = -480;
      b[18] = w & 255; b[19] = (w >> 8) & 255; b[20] = (w >> 16) & 255; b[21] = (w >> 24) & 255;
      const u = h >>> 0;
      b[22] = u & 255; b[23] = (u >> 8) & 255; b[24] = (u >> 16) & 255; b[25] = (u >> 24) & 255;
      return ai.parseBitmapHeaderSize(b.buffer);
    })();
    check('尺寸解析：BMP 负高度（自顶向下位图）取绝对值（640×480）',
      bmpGot && bmpGot.width === 640 && bmpGot.height === 480 && bmpGot.kind === 'bmp',
      JSON.stringify(bmpGot));
    // JPEG：SOI + APP0（要跨过它）+ SOF0。SOF 段内布局（从段标记起算）：
    //   +2..+3 = 段长、+4 = 精度、+5..+6 = 高、+7..+8 = 宽（都是大端 u16）。
    const jpegGot = (() => {
      const b = new Uint8Array(40);
      b[0] = 0xff; b[1] = 0xd8;
      b[2] = 0xff; b[3] = 0xe0; b[4] = 0x00; b[5] = 0x10; // APP0，长度 16 ⇒ 下一段在 20
      b[20] = 0xff; b[21] = 0xc0; b[22] = 0x00; b[23] = 0x11; // SOF0
      b[24] = 8;                                              // 精度
      b[25] = (512 >> 8) & 255; b[26] = 512 & 255;            // 高
      b[27] = (768 >> 8) & 255; b[28] = 768 & 255;            // 宽
      return ai.parseBitmapHeaderSize(b.buffer);
    })();
    check('尺寸解析：JPEG 跨过 APP 段找到 SOF0 并读对宽高（768×512）',
      jpegGot && jpegGot.width === 768 && jpegGot.height === 512 && jpegGot.kind === 'jpeg',
      JSON.stringify(jpegGot));
    // WebP：VP8X 的宽高是 **24 位小端 + 1**（位域少加一就会读出 0 ⇒ 闸恒放行）。
    const webpGot = (() => {
      const b = new Uint8Array(32);
      b.set([0x52, 0x49, 0x46, 0x46], 0);
      b.set([0x57, 0x45, 0x42, 0x50], 8);
      b.set([0x56, 0x50, 0x38, 0x58], 12); // "VP8X"
      const w = 4096 - 1; const h = 2048 - 1;
      b[24] = w & 255; b[25] = (w >> 8) & 255; b[26] = (w >> 16) & 255;
      b[27] = h & 255; b[28] = (h >> 8) & 255; b[29] = (h >> 16) & 255;
      return ai.parseBitmapHeaderSize(b.buffer);
    })();
    check('尺寸解析：WebP VP8X 的 24 位宽高（+1 语义）读对（4096×2048）',
      webpGot && webpGot.width === 4096 && webpGot.height === 2048 && webpGot.kind === 'webp',
      JSON.stringify(webpGot));
    // 认不出 = null（而不是抛错）：调用方据此退回解码腿，绝不因此误拒用户的图。
    check('尺寸解析：认不出的字节流给 null（调用方退回解码腿，不误拒）',
      ai.parseBitmapHeaderSize(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]).buffer) === null
      && ai.parseBitmapHeaderSize(null) === null);
    // SVG：属性优先，其次是 viewBox（都没有给 null，交给解码腿裁决）。
    const svgAttr = ai.parseSvgSize('<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="1536"></svg>');
    const svgView = ai.parseSvgSize('<svg viewBox="0 0 640 480"></svg>');
    const svgNone = ai.parseSvgSize('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    check('尺寸解析：SVG 读 width/height，缺失时退回 viewBox，都没有给 null',
      svgAttr && svgAttr.width === 2048 && svgAttr.height === 1536
      && svgView && svgView.width === 640 && svgView.height === 480
      && svgNone === null,
      JSON.stringify([svgAttr, svgView, svgNone]));
    // 两道闸的**行为**（不只是常量在不在）：边界两侧各喂一次。
    const over = ai.avatarImportLimit({ size: 5 * 1024 * 1024 }, { width: 800, height: 800 });
    const overEdge = ai.avatarImportLimit({ size: 1024 }, { width: 4096, height: 100 });
    const okEdge = ai.avatarImportLimit({ size: 1024 }, { width: 1024, height: 1024 });
    const okBoth = ai.avatarImportLimit({ size: 4 * 1024 * 1024 }, { width: 1024, height: 1024 });
    const unknown = ai.avatarImportLimit({ size: 1024 }, null);
    check('两道闸的行为：超体积/超边长各自判拒，恰好等于上限放行，尺寸未知时只按体积判',
      over.ok === false && over.overBytes === true && over.overEdge === false
      && overEdge.ok === false && overEdge.overEdge === true && overEdge.overBytes === false
      && okEdge.ok === true && okBoth.ok === true && unknown.ok === true,
      JSON.stringify([over.ok, overEdge.ok, okEdge.ok, okBoth.ok, unknown.ok]));
    // 负对照：把 PNG 的字节序故意当成"小端"（即读错位）⇒ 同一个断言必须判坏。
    const wrongEndian = (() => {
      const b = new Uint8Array(pngHead(1024, 768));
      return { width: (b[19] << 24 | b[18] << 16 | b[17] << 8 | b[16]) >>> 0 }; // 小端解读
    })();
    check('negative control: 字节序/位域读错会被同一条断言判出（判据不是恒真）',
      png.width === 1024 && wrongEndian.width !== 1024,
      '正确=' + png.width + ' 错读=' + wrongEndian.width);
    // ── AVIF（ISOBMFF）：`ftyp` → `meta` → `iprp` → `ipco` → `ispe` ─────────────────────
    // 这条格式就在 `IMAGE_RASTER_ACCEPT` 里，但 PR #202 的探针**一个分支都没写**：AVIF 的
    // 宽高不在文件开头，而在盒树里 ⇒ 旧实现恒返 null、`avatarImportLimit` 只剩体积闸，
    // 边长闸对它形同虚设（3 MiB 的 20000×20000 AVIF 直接过闸，直到 `createImageBitmap`
    // 才炸出 1.6 GB 像素内存 —— 而"先拒再解"的全部价值就在这条格式上归零）。
    // 下面按**真实结构**造最小盒链喂真实现，顺带覆盖三处真实坑：`size === 1` 的 64 位
    // largesize 盒头、`ispe` 不是 `ipco` 的首个属性、以及"多个 `ispe` 要取**主图**"
    //（`pitm` 给主 item_ID + `ipma` 给属性索引 ⇒ 指认出来的那个，而不是列表第一个）。
    const ascii = (s) => {
      const out = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
      return out;
    };
    const catBytes = (...arrs) => {
      const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
      let at = 0;
      for (const a of arrs) { out.set(a, at); at += a.length; }
      return out;
    };
    const u32be = (v) => new Uint8Array([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]);
    const u16be = (v) => new Uint8Array([(v >>> 8) & 255, v & 255]);
    /** 拼一个 ISOBMFF 盒；`large` 走 `size = 1` + 64 位 largesize 那套盒头。 */
    const isobox = (type, payload, large) => {
      const p = payload || new Uint8Array(0);
      const head = large ? 16 : 8;
      const out = new Uint8Array(head + p.length);
      const total = out.length;
      if (large) {
        out[3] = 1; // size=1 ⇒ 盒头后跟 64 位 largesize（高 32 位为 0，低位在 [12..15]）
        out[12] = (total >>> 24) & 255; out[13] = (total >>> 16) & 255;
        out[14] = (total >>> 8) & 255; out[15] = total & 255;
      } else {
        out[0] = (total >>> 24) & 255; out[1] = (total >>> 16) & 255;
        out[2] = (total >>> 8) & 255; out[3] = total & 255;
      }
      for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
      out.set(p, head);
      return out;
    };
    /** FullBox 的 version(1) + flags(3)（这里只需要全零那一种）。 */
    const fullBox = (payload) => catBytes(new Uint8Array(4), payload || new Uint8Array(0));
    const ispeBox = (w, h) => isobox('ispe', fullBox(catBytes(u32be(w), u32be(h))));
    /** 造最小 AVIF 头：`ftyp` + [pre] + `meta`{ `pitm` + `iprp`{ `ipco`{ [pad] + ispe… } + [ipma] } }。 */
    const avifHead = (o) => {
      const props = [];
      if (o.pad) props.push(o.pad);
      for (const d of o.ispes) props.push(ispeBox(d[0], d[1]));
      for (const t of (o.tail || [])) props.push(t);
      let iprpPayload = isobox('ipco', catBytes(...props));
      if (o.associate) {
        const n = new Uint8Array(1);
        n[0] = o.associate.length;
        iprpPayload = catBytes(iprpPayload, isobox('ipma', fullBox(catBytes(
          u32be(1), u16be(o.itemId || 1), n,
          ...o.associate.map((idx) => new Uint8Array([idx & 0x7f])),
        ))));
      }
      return catBytes(
        isobox('ftyp', catBytes(ascii('avif'), u32be(0), ascii('mif1'), ascii('miaf'))),
        o.pre || new Uint8Array(0),
        isobox('meta', catBytes(
          fullBox(new Uint8Array(0)),
          isobox('pitm', fullBox(u16be(o.itemId || 1))),
          isobox('iprp', iprpPayload),
        )),
      );
    };
    // ① 基本链：`meta` 前多一个 `free` 盒、`ispe` 前多一个 `av1C` 属性 ⇒ 都该照读不误。
    const avifBasicBytes = avifHead({
      ispes: [[4096, 2048]],
      pad: isobox('av1C', new Uint8Array(4)),
      pre: isobox('free', new Uint8Array(3)),
    });
    const avifBasic = ai.parseBitmapHeaderSize(avifBasicBytes.buffer);
    check('尺寸解析：AVIF 走 ftyp → meta → iprp → ipco → ispe 读出真宽高（4096×2048）',
      !!avifBasic && avifBasic.width === 4096 && avifBasic.height === 2048 && avifBasic.kind === 'avif',
      JSON.stringify(avifBasic));
    // ② 多个 ispe：`ipma` 把主 item 指向第 2 个属性 ⇒ 必须取 640×480（取列表第一个就错）。
    const avifMulti = ai.parseBitmapHeaderSize(avifHead({
      ispes: [[4096, 2048], [640, 480]],
      associate: [2],
      itemId: 1,
    }).buffer);
    check('尺寸解析：AVIF 有多个 ispe 时取**主图**（pitm + ipma 指认的那个，不是列表第一个）',
      !!avifMulti && avifMulti.width === 640 && avifMulti.height === 480,
      JSON.stringify(avifMulti));
    // ②b 逐字复刻**真实编码器**产物的 `ipma`：4 条关联、第 3 条带 essential 位（0x83）、
    //     ispe 排第 1、后面跟着 pixi/av1C/colr 三个非 ispe 属性。
    //     （ffmpeg + libsvtav1 出的 AVIF 实测就是 `pitm itemID=1` + `ipma ver=0 flags=0 [1,2,131,4]`。）
    const avifRealShape = ai.parseBitmapHeaderSize(avifHead({
      ispes: [[2000, 1200]],
      tail: [
        isobox('pixi', new Uint8Array(4)),
        isobox('av1C', new Uint8Array(4)),
        isobox('colr', new Uint8Array(11)),
      ],
      associate: [1, 2, 131, 4],
      itemId: 1,
    }).buffer);
    check('尺寸解析：AVIF 复刻真实编码器 ipma（4 条关联 + essential 位置位 + ispe 排第 1）读出 2000×1200',
      !!avifRealShape && avifRealShape.width === 2000 && avifRealShape.height === 1200,
      JSON.stringify(avifRealShape));
    // ③ 64 位 largesize：这个盒头按"8 字节头"读会把 size 读成 1 ⇒ 直接判非法停住，读不到 ispe。
    const avifLarge = ai.parseBitmapHeaderSize(avifHead({
      ispes: [[3000, 2000]],
      pad: isobox('av1C', new Uint8Array(6), true),
    }).buffer);
    check('尺寸解析：AVIF 盒头 size=1 的 64 位 largesize 之后仍能走到 ispe（3000×2000）',
      !!avifLarge && avifLarge.width === 3000 && avifLarge.height === 2000,
      JSON.stringify(avifLarge));
    // ④ 端到端：`probeImageSize`（只读头、不解码）→ `avatarImportLimit` 的**行为**两侧各喂一次。
    const avifBigBytes = avifHead({ ispes: [[20000, 20000]] });
    const avifOkBytes = avifHead({ ispes: [[800, 600]] });
    const fakeAvif = (bytes) => ({
      type: 'image/avif',
      size: bytes.length,
      slice: (from, to) => ({ arrayBuffer: async () => bytes.slice(from, to).buffer }),
    });
    const probedBig = await ai.probeImageSize(fakeAvif(avifBigBytes));
    const probedOk = await ai.probeImageSize(fakeAvif(avifOkBytes));
    const gateBig = ai.avatarImportLimit(fakeAvif(avifBigBytes), probedBig);
    const gateOk = ai.avatarImportLimit(fakeAvif(avifOkBytes), probedOk);
    check('AVIF 两道闸：探针读到的 20000×20000 判拒、800×600 放行（全程不解码）',
      !!probedBig && probedBig.width === 20000 && probedBig.height === 20000
      && gateBig.ok === false && gateBig.overEdge === true && gateBig.overBytes === false
      && !!probedOk && probedOk.width === 800 && gateOk.ok === true,
      JSON.stringify([probedBig, gateBig.ok, probedOk, gateOk.ok]));
    // ⑥ 兜底扫描：有的编码器把 `ftyp` 的 size 写成整个文件 ⇒ 按盒链就走不到 `meta`。
    const avifWide = avifHead({ ispes: [[1234, 567]] });
    const wideLen = avifWide.length;
    avifWide[0] = (wideLen >>> 24) & 255;
    avifWide[1] = (wideLen >>> 16) & 255;
    avifWide[2] = (wideLen >>> 8) & 255;
    avifWide[3] = wideLen & 255;
    const avifScanned = ai.parseBitmapHeaderSize(avifWide.buffer);
    check('尺寸解析：AVIF 的 ftyp 把 size 写成整个文件（盒链够不到 meta）时兜底扫出尺寸（1234×567）',
      !!avifScanned && avifScanned.width === 1234 && avifScanned.height === 567,
      JSON.stringify(avifScanned));
    // ⑤ 负对照：认不出**必须给 null**（退回解码腿），不许从「漏拒」变成「乱拒」。
    //    三喂：盒链被截断（meta 之后就没了）/ 有 meta 但没有 ispe / 根本不是 ISOBMFF 的随机字节。
    const cutBytes = avifHead({ ispes: [[800, 600]] });
    const avifCut = ai.parseBitmapHeaderSize(cutBytes.slice(0, 40).buffer);
    const avifNoIspe = ai.parseBitmapHeaderSize(
      isobox('ftyp', catBytes(ascii('avif'), u32be(0))).buffer);
    const avifNoIspe2 = ai.parseBitmapHeaderSize(avifHead({ ispes: [], pad: null }).buffer);
    let seed = 0x9e3779b9;
    const junk = new Uint8Array(512);
    for (let i = 0; i < junk.length; i++) { seed = (seed * 1103515245 + 12345) >>> 0; junk[i] = seed >>> 24; }
    const avifJunk = ai.parseBitmapHeaderSize(junk.buffer);
    check('negative control: AVIF 盒链截断 / 有 meta 无 ispe / 非 ISOBMFF 随机字节 ⇒ 全给 null（不误拒）',
      avifCut === null && avifNoIspe === null && avifNoIspe2 === null && avifJunk === null,
      'truncated=' + JSON.stringify(avifCut) + ' noIspe=' + JSON.stringify(avifNoIspe)
        + ' metaNoIspe=' + JSON.stringify(avifNoIspe2) + ' junk=' + JSON.stringify(avifJunk));
    // ⑦ **变异负对照**（判据有牙的证据，不是恒真式）：把真实现的 `ispe` 宽度读成高度
    //    （`hit.start + 4` → `hit.start + 8`），把变异体 import 一次 —— ① 那条
    //    「4096×2048」的判据必须在这个变异体上判红。改坏了还不红，说明判据是形状死钉。
    const aiText = readFileSync(join(root, 'src', 'avatar-import.js'), 'utf8');
    const mutatedText = aiText.replace(
      '  const width = readU32BE(b, hit.start + 4);',
      '  const width = readU32BE(b, hit.start + 8);');
    const mutDir = join(root, '.test-cache', 'avif-mutant');
    mkdirSync(mutDir, { recursive: true });
    const mutFile = join(mutDir, 'avatar-import-mutated.mjs');
    writeFileSync(mutFile, mutatedText);
    const mutatedMod = await import(pathToFileURL(mutFile).href);
    const dimOk = (r) => !!r && r.width === 4096 && r.height === 2048 && r.kind === 'avif';
    const mutatedDim = mutatedMod.parseBitmapHeaderSize(avifBasicBytes.buffer);
    check('变异负对照: 把 ispe 宽度读成高度 ⇒ 同一条 4096×2048 判据必须判红（改坏了还不红就是死钉）',
      mutatedText !== aiText && dimOk(avifBasic) === true && dimOk(mutatedDim) === false,
      'replaced=' + (mutatedText !== aiText) + ' real=' + JSON.stringify(avifBasic)
        + ' mutated=' + JSON.stringify(mutatedDim));
    rmSync(mutDir, { recursive: true, force: true });
    // ⑧ 残留洞 A：`meta` 排在 `mdat` **之后**（`ftyp` + 3.4 MB `mdat` + `meta`，总 3.40 MiB
    //    **低于 4 MiB 体积闸**）—— 256 KB 读头够不到 `meta` ⇒ 探针返 null ⇒ 边长闸被绕过，
    //    体积闸也不会替它兜底（这份文件没超体积）。夹具是真的：内嵌真 `ispe` 4096×4096。
    //    验收口径（两种收口都算过，就是不许静默放行）：量得出尺寸 ⇒ 必须被**边长闸**拦下；
    //    量不出 ⇒ 必须**显式拒绝**。配一条变异负对照：把放宽上限改回 256 KB（= 修改前的
    //    行为）⇒ 同一段断言必须判红。
    const mdatFixture = catBytes(
      isobox('ftyp', catBytes(ascii('avif'), u32be(0), ascii('mif1'), ascii('miaf'))),
      isobox('mdat', new Uint8Array(3.4 * 1024 * 1024)),
      isobox('meta', catBytes(
        fullBox(new Uint8Array(0)),
        isobox('pitm', fullBox(u16be(1))),
        isobox('iprp', isobox('ipco', ispeBox(4096, 4096))),
      )),
    );
    const fakeMdat = (cap) => ({
      type: 'image/avif',
      size: mdatFixture.length,
      slice: (from, to) => {
        const want = to === undefined ? mdatFixture.length : to;
        const v = mdatFixture.subarray(from, cap ? Math.min(want, cap) : want);
        return { arrayBuffer: async () => v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) };
      },
    });
    /** 这段断言本身：真实现过、变异体（256 KB 上限）不过。 */
    const mdatHeldBy = async (mod) => {
      const probed = await mod.probeImageSize(fakeMdat(0));
      const gate = mod.avatarImportLimit(fakeMdat(0), probed);
      return probed !== null
        ? gate.ok === false && gate.overEdge === true && gate.overBytes === false : gate.ok === false;
    };
    const mdatMutText = aiText.replace(
      'const AVATAR_AVIF_HEAD_BYTES = AVATAR_IMPORT_MAX_BYTES;',
      'const AVATAR_AVIF_HEAD_BYTES = AVATAR_BITMAP_HEAD_BYTES;');
    const mdatMutDir = join(root, '.test-cache', 'avif-mdat-mutant');
    mkdirSync(mdatMutDir, { recursive: true });
    const mdatMutFile = join(mdatMutDir, 'avatar-import-mutated.mjs');
    writeFileSync(mdatMutFile, mdatMutText);
    const mdatMutMod = await import(pathToFileURL(mdatMutFile).href);
    const mdatDeep = await ai.probeImageSize(fakeMdat(0));
    const mdatGate = ai.avatarImportLimit(fakeMdat(0), mdatDeep);
    check('残留洞 A: meta 排在 3.4 MB mdat 之后（3.40 MiB < 4 MiB 体积闸）⇒ 要么量出 4096×4096 被边长闸拦下、要么显式拒绝；变异负对照: 放宽上限改回 256 KB ⇒ 该判据必须判红',
      (await mdatHeldBy(ai)) === true && mdatMutText !== aiText
        && (await mdatHeldBy(mdatMutMod)) === false,
      'size=' + mdatFixture.length + ' real=' + JSON.stringify([mdatDeep, mdatGate])
        + ' mutated=' + JSON.stringify(await mdatMutMod.probeImageSize(fakeMdat(0))));
    rmSync(mdatMutDir, { recursive: true, force: true });
  }
  {
    // ── 头像导入的两道闸 + 「自动压缩后导入」（#185 后续，用户口径）──────────
    // 这道闸之前**根本不存在**：选什么图都直接 decodeImageFile，再缩到 512px 上传。
    // 危险在"解码炸弹"—— 一个 20000×20000 的 PNG 只有几百 KB，解码却要 1.6 GB 像素内存；
    // 而"这图多大"**不用解码就能从文件头读出来**。判据因此盯五件事：
    //   ① 两道闸的常量在位（边长 1024 / 体积 4 MiB）；
    //   ② 尺寸解析走**文件头**，解析函数自己不许解码；
    //   ③ 判定发生在**解码之前**（先拒再解 —— 这条顺序就是闸的全部价值）；
    //   ④ 自动压缩**无损优先**（PNG 排在 WebP 前面）；
    //   ⑤ 结构上不泄原始文件：上传的那份 blob 来自**裁切画布**（于是 SVG 这类"客户端收得下、
    //      宿主不认"的格式只可能以像素形态落盘，同源存储型 XSS 无从谈起）。
    const gsrc = readFileSync(join(root, 'src', 'client.js'), 'utf8').replace(/\r\n/g, '\n');
    const eSrc = readFileSync(join(root, 'src', 'ext-avatar.js'), 'utf8').replace(/\r\n/g, '\n');
    // 闸的常量与探针住在 src/avatar-import.js（纯函数，上面那组判据用真字节喂它）；
    // 这里钉的是**接线**：client 正文有没有真的用它们、以及用的顺序对不对。
    const aiSrc = readFileSync(join(root, 'src', 'avatar-import.js'), 'utf8').replace(/\r\n/g, '\n');
    const limitsInPlace = aiSrc.includes('const AVATAR_IMPORT_MAX_EDGE = 1024;')
      && aiSrc.includes('const AVATAR_IMPORT_MAX_BYTES = 4 * 1024 * 1024;');
    const headFn = aiSrc.includes('function parseBitmapHeaderSize(buffer)');
    const svgFn = aiSrc.includes('function parseSvgSize(text)');
    const probeFn = aiSrc.includes('async function probeImageSize(file)');
    const headerOnly = headFn && svgFn && probeFn
      // ⚠️ 必须在**剥掉注释**后的代码上判：本模块的注释里正好写着 `decodeImageFile`
      //（解释"为什么必须在解码之前"），不剥就会被自己那句话判红（实测踩过）。
      && !/decodeImageFile|createImageBitmap/.test(stripComments(aiSrc));
    /** 判定是否排在解码之前（正/负对照共用**这一个**函数）。 */
    const gateBeforeDecode = (src2) => {
      const body = fnBody(src2, 'onAvatarFileChosen');
      const gateAt = body.indexOf('avatarImportLimit(');
      const cropAt = body.indexOf('openAvatarCrop(');
      return gateAt >= 0 && cropAt >= 0 && gateAt < cropAt
        && !/decodeImageFile|createImageBitmap/.test(body);
    };
    /** 自动压缩是否无损优先（PNG 先于 WebP 出现）。 */
    const losslessFirst = (src2) => {
      const body = fnBody(src2, 'downscaleDecoded');
      return /losslessFirst/.test(body)
        && body.indexOf('image/png') >= 0 && body.indexOf('image/png') < body.indexOf('image/webp');
    };
    const confirmFn = fnBody(gsrc, 'onAvatarCropConfirm');
    const canvasOnly = confirmFn.includes('cropAvatarToBlob()')
      && confirmFn.includes('postImageAsset("/avatar/" + side, img.blob');
    check('头像导入闸：两道闸常量在位、尺寸走文件头（不解码）、判定排在解码之前',
      limitsInPlace && headerOnly && gateBeforeDecode(gsrc),
      'limits=' + limitsInPlace + ' headerOnly=' + headerOnly
      + ' gateBeforeDecode=' + gateBeforeDecode(gsrc));
    check('头像自动压缩：无损优先（PNG 先于 WebP）+ 上传的是裁切画布（原始文件永不直传）',
      losslessFirst(gsrc) && canvasOnly,
      'losslessFirst=' + losslessFirst(gsrc) + ' canvasOnly=' + canvasOnly);
    // 面板侧：超限时给的是**出路**（一枚「自动压缩后导入」），不是只有一句拒绝。
    check('头像超限的面板出口：提示行 + 「自动压缩后导入」按钮都接在真处理器上',
      eSrc.includes('sel.avatarOverflow') && eSrc.includes('onAvatarAutoCompress')
      && eSrc.includes('weT("自动压缩后导入")') && eSrc.includes('weT("压缩中…")'),
      'ext-avatar 源码口径');
    // 负对照：把判定挪到解码之后（先 openAvatarCrop 再判）⇒ 同一条判据判红。
    const reversed = gsrc.replace(
      /([ \t]*)const verdict = avatarImportLimit\(/,
      '$1const __verdictMoved = avatarImportLimit(')
      .replace('function onAvatarFileChosen(', 'function onAvatarFileChosenMutant(');
    check('negative control: 判定挪到解码之后就判红（同一条判据不是恒真）',
      gateBeforeDecode(gsrc) === true && gateBeforeDecode(reversed) === false);
  }
  {
    // ── 模块级 ↺ 的视觉对齐（#192 的回归，用户口径）────────────────────────
    // 根因：`.we-picker__section-caret` 与 `.we-mod-reset` **都写了 margin-left: auto**，
    // 同一 flex 行里两个 auto 会把剩余空间**均分** ⇒ ↺ 停在行中间；而「主题」节头没有
    // 折叠三角、只剩一个 auto ⇒ 它贴在最右端。用户要的是**所有模块都长成主题那样**。
    // 于是两件事：① 节头里 ↺ 排到折叠三角**之后**（坐进原来"小绿点"那一列）；
    //            ② 有三角同排时 ↺ 不再抢剩余空间（让位给三角的 auto）。
    const headSrc = readFileSync(join(root, 'src', 'section-head.js'), 'utf8').replace(/\r\n/g, '\n');
    // ⚠️ 同上：CSS 住在 src/styles-*.js 域模块里，`src/styles.js` 只是组装点 ⇒ 读样式族全文。
    const styleSrc = styleText();
    /** 节头尾部次序：标签 → 折叠三角 → ↺（正/负对照共用**这一个**函数）。 */
    const tailOrderOk = (src2) => {
      const iLabel = src2.indexOf('we-picker__section-label');
      const iCaret = src2.indexOf('"we-picker__section-caret');
      const iAction = src2.indexOf('action || null');
      return iLabel >= 0 && iCaret >= 0 && iAction >= 0 && iLabel < iCaret && iCaret < iAction;
    };
    /** 有三角同排时 ↺ 让出剩余空间（不再抢 auto）。 */
    const resetYieldsOk = (src2) => /\.we-picker__section-caret\s*\+\s*\.we-mod-reset\s*\{[^}]*margin-left:\s*8px/.test(src2);
    // 折叠节头**只有一个实现**：panel-tabs 里那两处手写的 --toggle 节头已并回共用构件
    //（手写副本正是顺序会漂的地方 —— 一处改了另一处不改，就是"只有部分模块对齐"）。
    const handRolled = (readFileSync(join(root, 'src', 'panel-tabs.js'), 'utf8')
      .match(/we-picker__section-head--toggle/g) || []).length;
    check('#192 回归：节头里 ↺ 排在折叠三角之后（标签 → 三角 → ↺）+ 有三角时 ↺ 让出剩余空间',
      tailOrderOk(headSrc) && resetYieldsOk(styleSrc),
      'order=' + tailOrderOk(headSrc) + ' yields=' + resetYieldsOk(styleSrc));
    check('#192 回归：折叠节头只剩共用构件一个实现（panel-tabs 不再手写 --toggle 节头）',
      handRolled === 0, '手写处数=' + handRolled);
    // 负对照：把次序换回旧样子（↺ 排在三角之前）⇒ 同一条判据判红。
    const oldOrder = headSrc.replace('    action || null,\n', '')
      + '\n// 旧样子：action 排在 caret 之前\n';
    check('negative control: ↺ 排回折叠三角之前会被同一条判据判出',
      tailOrderOk(headSrc) === true && tailOrderOk(oldOrder) === false);
  }
  {
    // 二号模块的岛：注册表项形状 + 「关着只画总开关、开着才画 12 个参数」这条可见行为。
    // 注意它**没有**「自动」档 —— 这一层刻意不采样壁纸像素（见 src/fx-layer.js 文件头）。
    const PREV_BLEND = globalThis.FX_BLEND_VALUES;
    // 混合档位同理：**唯一真源**是 lib/settings-schema.js，扩展岛直接读它、不复制第二份
    //（复制一份就等于给"改了 schema 却忘了改岛"留了条静默失效的路）。
    globalThis.FX_BLEND_VALUES = schemaMod.FX_BLEND_VALUES;
    const ctxOf = (sel) => ({
      sel,
      onFxEnabled: () => {}, onFxClick: () => {}, onFxClickStyle: () => {},
      onFxClickSize: () => {}, onFxClickGlow: () => {},
      onFxTrail: () => {}, onFxTrailStyle: () => {}, onFxTrailLength: () => {},
      onFxTrailWidth: () => {}, onFxTrailGlow: () => {},
      onFxOpacity: () => {}, onFxBlend: () => {}, onFxColorMode: () => {}, onFxColor: () => {},
    });
    const PARAMS = ['点击效果', '点击样式', '半径', '点击光晕',
      '拖尾效果', '拖尾样式', '拖尾时长', '拖尾粗细', '拖尾光晕',
      '不透明度', '混合模式', '效果配色'];
    const off = labelSeq(extFxMod.renderFxIsland(ctxOf(schemaMod.DEFAULTS)));
    const on = labelSeq(extFxMod.renderFxIsland(
      ctxOf(Object.assign({}, schemaMod.DEFAULTS, { fxEnabled: true }))));
    globalThis.FX_BLEND_VALUES = PREV_BLEND;
    const mod = extFxMod.FX_EXTENSION_MODULE;
    const fxSrc = readFileSync(subFxFile('ext-fx.js'), 'utf8');
    const wantOff = [globalThis.weT('启用点击与拖尾效果')];
    const wantOn = wantOff.concat(PARAMS.map((k) => globalThis.weT(k)));
    check('ext-fx.js 可单独 import · 注册表项形状 · 关着只画总开关、开着才画 12 参数',
      Boolean(mod) && mod.id === 'fx' && mod.render === extFxMod.renderFxIsland
      && typeof mod.title === 'string' && mod.title === globalThis.weT('点击效果与拖尾效果')
      && typeof mod.desc === 'string' && mod.desc.length > 0
      // 混合档位直接读 lib/settings-schema.js 的常量（唯一真源）⇒ 本文件里不许再有第二份声明。
      && fxSrc.includes('FX_BLEND_VALUES') && !fxSrc.includes('const FX_BLEND_VALUES')
      && off.join('|') === wantOff.join('|') && on.join('|') === wantOn.join('|'),
      'off=' + off.length + ' on=' + on.length + ' [' + on.join('|') + ']');
  }
  {
    // 二号模块的取色器：**只在「自定义」档出现**，恰好一个、默认值就是 fxColor。
    const PREV_SWATCH = globalThis.swatchRow;
    const PREV_BLEND = globalThis.FX_BLEND_VALUES;
    globalThis.FX_BLEND_VALUES = schemaMod.FX_BLEND_VALUES;
    const ctxOf = (sel) => ({
      sel,
      onFxEnabled: () => {}, onFxClick: () => {}, onFxClickStyle: () => {},
      onFxClickSize: () => {}, onFxClickGlow: () => {},
      onFxTrail: () => {}, onFxTrailStyle: () => {}, onFxTrailLength: () => {},
      onFxTrailWidth: () => {}, onFxTrailGlow: () => {},
      onFxOpacity: () => {}, onFxBlend: () => {}, onFxColorMode: () => {}, onFxColor: () => {},
    });
    const rows = [];
    const picked = [];
    globalThis.swatchRow = (label, presets, value, onPick, opts) => {
      rows.push([label, value, presets.length, (opts && opts.key) || '', (opts && opts.colorValue) || ''].join('/'));
      picked.push(typeof onPick);
      return null;
    };
    const before = rows.length;
    extFxMod.renderFxIsland(ctxOf(Object.assign({}, schemaMod.DEFAULTS, { fxEnabled: true })));
    const accentCount = rows.length - before;
    extFxMod.renderFxIsland(ctxOf(Object.assign({}, schemaMod.DEFAULTS,
      { fxEnabled: true, fxColorMode: 'custom', fxColor: '#ff00aa' })));
    const customRows = rows.slice(accentCount);
    globalThis.swatchRow = PREV_SWATCH;
    globalThis.FX_BLEND_VALUES = PREV_BLEND;
    const wantRow = [globalThis.weT('自定义颜色'), '#ff00aa', 7, 'fx-color', '#ff00aa'].join('/');
    check('ext-fx.js 取色器只在「自定义」档出现 · 默认值 = fxColor（预设 7 色）',
      accentCount === 0 && customRows.join('|') === wantRow
      && picked.every((t) => t === 'function'),
      'accent=' + accentCount + ' custom=' + customRows.length + ' [' + customRows.join('|') + ']');
  }

  // ── 3D 效果（「扩展」三号模块）的两半：视差行为层 + 扩展岛 ──────────────────────────
  // 这一层与前两层的关键差别：它**一个 DOM 节点都不建** —— 只往 body 上写 CSS 变量与一个
  // 开关属性，位移在 src/styles.js 的视差段里算。所以"沙箱里零副作用"这条比前两层更硬：
  // 碰一下 `document` 就是 TypeError，而运行期判据（真的挪了多少像素）在无头环境够不着
  // ⇒ 一半靠"零抛错"、一半靠源码口径（下面第二条），与前两层同款。
  const parallaxLayerMod = await import(pathToFileURL(subParallaxFile('parallax-layer.js')).href);
  const extParallaxMod = await import(pathToFileURL(subParallaxFile('ext-parallax.js')).href);
  {
    const PREV_SEL = globalThis.selection;
    const restoreWeBase = stubWeBase();
    let threw = '';
    try {
      // ① 开着 ⇒ 走 parallaxStart（无 rAF ⇒ 那一行守卫把整段挡回去，连 body 都不碰）
      globalThis.selection = { parallaxEnabled: true };
      parallaxLayerMod.syncParallaxLayer();
      // ② 越界的设置值 ⇒ 钳位路径（背景 0..10 / 平滑 0..98 之外不许算出天量位移）
      globalThis.selection = { parallaxEnabled: true, parallaxBg: 999, parallaxSmooth: 100 };
      parallaxLayerMod.syncParallaxLayer();
      // ③ 关掉 ⇒ stop 分支；卸载幂等
      globalThis.selection = { parallaxEnabled: false };
      parallaxLayerMod.syncParallaxLayer();
      parallaxLayerMod.disposeParallaxLayer();
    } catch (e) { threw = String((e && e.message) || e); } finally { globalThis.selection = PREV_SEL; restoreWeBase(); }
    check('parallax-layer.js 可单独 import · 导出只有四枚 · 无 rAF / 无 DOM 环境零抛错零副作用',
      Object.keys(parallaxLayerMod).sort().join(',')
        === 'PARALLAX_PLUGIN_DEFAULT,disposeParallaxLayer,parallaxDiscoveredGroups,syncParallaxLayer'
      && typeof parallaxLayerMod.syncParallaxLayer === 'function'
      && typeof parallaxLayerMod.disposeParallaxLayer === 'function'
      // 「扩展」面板要按同一份名单画"插件前端"那几行 ⇒ 发现函数必须能从层里单独取到；
      // 缺省距离（缺键时算多少）也只有层里那一份真源，面板直接读它。
      && typeof parallaxLayerMod.parallaxDiscoveredGroups === 'function'
      && Array.isArray(parallaxLayerMod.parallaxDiscoveredGroups())
      && parallaxLayerMod.PARALLAX_PLUGIN_DEFAULT === 1
      && !threw, threw);
    // 源码口径：这一层的要点全是"看不见的形态"（不建 DOM、只用独立属性可用量、中心对称、
    // 到位就停、系数可配、特效层不参与）。逐条钉住，改坏了当场红。
    const parSrc = readFileSync(subParallaxFile('parallax-layer.js'), 'utf8');
    const weBaseSrc = readFileSync(join(root, 'src', 'we-base.js'), 'utf8');
    check('parallax-layer.js 不建 DOM + 独立属性直接写位移 + 中心对称(负向) + 收敛驱动 + 特效不参与 + 帧内零测量',
      parSrc.includes("const PARALLAX_DIRECTION = -1;")
      && parSrc.includes("const PARALLAX_ATTR = 'data-we-parallax';")
      // 每帧写的是**位移本身**，落在 CSS 独立属性 translate 上（自定义属性一个都不写）。
      && parSrc.includes("const PARALLAX_TRANSLATE = 'translate';")
      && parSrc.includes("const PARALLAX_VAR_BG = '--we-parallax-bg';")
      // 系数就近钳位（范围不引 lib/settings-schema.js：单文件 import 时会 ReferenceError）。
      && parSrc.includes('const PARALLAX_BG_MIN = 0;') && parSrc.includes('const PARALLAX_BG_MAX = 10;')
      && parSrc.includes('const PARALLAX_SMOOTH_MAX = 98;')
      // 没有 DOM 的环境（无头沙箱 / SSR 探测）一律从这一个入口静默返回：body 入口是共享地基
      // src/we-base.js 的 `weBody()`（无 DOM 一律 null），这里断言"层只经它取 body"。
      && parSrc.includes('weBody()')
      && !parSrc.includes('parallaxBody')
      && weBaseSrc.includes('function weBody()')
      && weBaseSrc.includes("if (typeof document === 'undefined' || !document || !document.body) return null;")
      && parSrc.includes("if (typeof requestAnimationFrame !== 'function') return;")
      // ① **不建 DOM**：整份文件里没有 createElement / appendChild / insertBefore。
      && !parSrc.includes('createElement') && !parSrc.includes('appendChild')
      && !parSrc.includes('insertBefore') && !parSrc.includes('removeChild')
      // ② 单位量 = 光标偏离屏幕中心的百分之几，方向取负 ⇒ 关于中心对称（光标在右上、整块往左下）。
      //   用户口径 m02697-①："最大缓动距离占屏幕对角线长度的百分比" ⇒ 除数是 100 / 2 = 50
      //   （光标贴到屏幕角上时 |u| = 最长对角线的一半 ⇒ |位移| 恰好 = pct% × 对角线）。
      && parSrc.includes('const PARALLAX_STEP_DIV = 50;')
      && parSrc.includes('const targetX = PARALLAX_DIRECTION * (cx - vw / 2) / PARALLAX_STEP_DIV;')
      && parSrc.includes('const targetY = PARALLAX_DIRECTION * (cy - vh / 2) / PARALLAX_STEP_DIV;')
      // ③ **缓动**：按帧时长做指数逼近（跟手程度 = parallaxSmooth），不是直接赋值。
      && parSrc.includes('const a = 1 - st.smooth / 100;')
      && parSrc.includes('1 - Math.pow(1 - a, dt / PARALLAX_FRAME_MS)')
      // ④ **收敛驱动**：追上目标就收工（空闲零帧），下一次 pointermove 再起一帧。
      && parSrc.includes('const settle = Math.max(PARALLAX_SETTLE_PX,')
      && parSrc.includes('const doneX = Math.abs(targetX - parallaxStepX) <= settle;')
      && parSrc.includes('const doneY = Math.abs(targetY - parallaxStepY) <= settle;')
      && parSrc.includes('if (!doneX || !doneY) parallaxKick();')
      && parSrc.includes('else parallaxTargetsSettle();')
      // ⑤ 被动监听（绝不拦指针、绝不接管输入），并且只有这两条。
      && parSrc.includes("document.addEventListener('pointermove', parallaxOnPointerMove, { passive: true })")
      && parSrc.includes("window.addEventListener('resize', parallaxOnResize, { passive: true })")
      // ⑥ 点击/拖尾那一层**刻意不参与**（用户口径：特效不跟着偏移）—— 连类名都不该出现。
      && !parSrc.includes('we-fx')
      // ⑧ **低开销**（用户口径：动效的性能开销较高）：位移每帧直接写在那几层自己的 translate 上，
      //    **一个自定义属性都不写**（自定义属性是继承的 —— 写一次就让整棵子树重算样式），
      //    body 上只剩一个"壁纸补边系数"（设置变了才写一次）；不再人工封顶 60Hz（跟随真实刷新率）；
      //    "到位"按**看得见的位移**折算、光标静下来后放宽；系数全 0 时一帧都不排；
      //    帧里零测量（视口只在起帧 / resize 读，重扫挪到起帧路径）；页面不可见不排帧；
      //    起帧才提合成层、收工摘掉。
      && parSrc.includes("const PARALLAX_TARGET_SELECTOR = '.we-layer, .we-rope';")
      && parSrc.includes("const PARALLAX_MOVING_CLASS = 'we-parallax--moving';")
      && parSrc.includes('const PARALLAX_SETTLE_VISIBLE_PX = 0.25;')
      && parSrc.includes('const PARALLAX_IDLE_MS = 180;')
      && parSrc.includes('const PARALLAX_IDLE_VISIBLE_PX = 1;')
      && parSrc.includes('function parallaxVarOn(el, prop, value)')
      && parSrc.includes('function parallaxReadViewport()')
      && parSrc.includes('function parallaxTargetLift(el, on)')
      && parSrc.includes('function parallaxTargetsRefresh(now, inFrame)')
      && parSrc.includes('function parallaxTargetsSettle()')
      && parSrc.includes("typeof document.querySelectorAll !== 'function'")
      // 每帧的位移是"算完乘完的最终值"，一次 setProperty 写下去（值没变就不写）。
      && parSrc.includes('function parallaxApply(st)')
      && parSrc.includes('parallaxVarOn(el, PARALLAX_TRANSLATE, value);')
      && parSrc.includes('function parallaxTargetKind(el)')
      // 界面组（用户口径：把 3D 感扩到输入框 / 文本区 / 侧栏与其中的用户气泡，且"文字本体跟着
      // 玻璃一起动" ⇒ 动的是容器）：四组各按**自己的绝对距离**（四个设置项，常量只作缺值兜底）、与壁纸
      // **同向**的符号、整设备像素量化 **+ 迟滞**（m01915-② 的抖就是量化在零附近来回翻转）、
      // 静止摘属性、组里有 fixed 后代就整组不动（本仓 #89 的包含块坑），**左栏例外**走
      // `position: relative` + `left`/`top`（m01915-③：那一列里钉着宿主的 fixed 标题栏按钮，
      // translate 会把它变成包含块 ⇒ 按钮整体下移一个标题栏高度），以及"槽出口没盒子 ⇒ 位移落到
      // 最近的有盒子的祖先"（asar 里的 `ANCHOR_STYLE = display: contents`；m01915 起改成
      // **从锚点自身起判** ⇒ 输入卡片落到卡片本体、每条用户气泡各自成为一个位移目标）。
      && parSrc.includes('[data-composer-card], [data-slot="conversation.view"], [data-slot="sidebar"], [data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]')
      // 用户裁决 m02697-①/③：四个区域**自己就是绝对距离**（不再是乘在总倍率上的系数）
      // ⇒ 滑杆上限 10%、0 = 这一块不缓动；出厂值 = 用户实际调好的那一组
      //（用户诉求 m04159 ⇒ 1.2 / 1.8 / 1.6 / 1.4，与 lib/settings-schema.js 的 DEFAULTS 逐字同值）。
      && parSrc.includes('const PARALLAX_GROUP_CHAT = 1.2;')
      && parSrc.includes('const PARALLAX_GROUP_COMPOSER = 1.8;')
      && parSrc.includes('const PARALLAX_GROUP_SIDEBAR = 1.6;')
      && parSrc.includes('const PARALLAX_GROUP_BUBBLE = 1.4;')
      && parSrc.includes('const PARALLAX_GROUP_BUBBLE_MAX = 24;')
      && parSrc.includes('const PARALLAX_GROUP_DEPTH_MIN = 0;')
      && parSrc.includes('const PARALLAX_GROUP_DEPTH_MAX = 10;')
      // 老口径的"界面跟随距离总倍率"整条退役（键从 lib/settings-schema.js 里删掉）。
      && !parSrc.includes('PARALLAX_UI_DEPTH') && !parSrc.includes('st.uiDepth')
      && parSrc.includes('const PARALLAX_GROUP_DEAD_PX = 0.25;')
      && parSrc.includes('const PARALLAX_GROUP_STICK_PX = 0.75;')
      && parSrc.includes("const PARALLAX_OFFSET_LEFT = 'left';")
      && parSrc.includes("const PARALLAX_OFFSET_TOP = 'top';")
      && parSrc.includes("const PARALLAX_POSITION = 'position';")
      && parSrc.includes("const PARALLAX_POSITION_RELATIVE = 'relative';")
      && parSrc.includes('const PARALLAX_UI_SIGN = 1;')
      // 插件前端（用户裁决 m02697-②/③）：认别的插件注册的槽出口（出口自身 `display: contents`
      // ⇒ 位移落在**元素子节点**上）、跳掉整帧容器 / 原生三组的出口本身 / 设置与插件管理那一整块
      // 子树，再过一道 `parallaxPluginEffectiveGroups()`（落在原生四组盒子里、或落在另一个认到的
      // 插件组里的出口不算 —— 「界面元素跟随」开着时才算这道）；距离住 `parallaxPluginDepths`
      // （槽键 → %），缺键 = 缺省 1%、显式 0 = 这一组不缓动；整块还由它自己的开关 `parallaxPlugin`
      // 看着（用户诉求 m03549：独立于 `parallaxUi`、默认关）。
      && parSrc.includes("const PARALLAX_PLUGIN_SLOT_ATTR = 'data-slot';")
      && parSrc.includes("const PARALLAX_PLUGIN_SELECTOR = '[data-slot]';")
      && parSrc.includes('const PARALLAX_PLUGIN_SKIP = [')
      && parSrc.includes("const PARALLAX_PLUGIN_SKIP_PREFIX = ['settings.', 'plugins.', 'shell.'];")
      && parSrc.includes('const PARALLAX_PLUGIN_SKIP_SCOPE = ')
      && parSrc.includes('const PARALLAX_PLUGIN_DEFAULT = 1;')
      && parSrc.includes('selection.parallaxPluginDepths')
      && parSrc.includes('function parallaxPluginKey(el)')
      && parSrc.includes('function parallaxPluginGroups()')
      && parSrc.includes('function parallaxDiscoveredGroups()')
      // 审计 A6：出口有多个元素子节点、或两个不同槽键最终落到**同一个盒子**时，`parallaxTargetAdd()`
      // 只留先入列的那一条（它按 `el` 去重）⇒ 后一条的距离无处可写。名单必须**按落点去重**，
      // 否则「扩展」页签会多列一行永不生效的槽键（"面板名单与屏上同源"这条硬不变量就破了）。
      && parSrc.includes('const boxes = [];')
      && parSrc.includes('if (!box || boxes.indexOf(box) >= 0) continue;')
      && parSrc.includes('return kept;')
      && parSrc.includes('out.push({ el: kids[j], slot: slot });')
      // 到位阈值看的"最大距离"现在是各层里最大的那个（只看壁纸会把界面 / 插件组的尾巴抹平）。
      && parSrc.includes('function parallaxMaxPercent(st)')
      && parSrc.includes('const pctMax = parallaxMaxPercent(st);')
      && parSrc.includes('const PARALLAX_GROUP_SCAN_MAX = 400;')
      && parSrc.includes('const PARALLAX_GROUP_BOX_MAX_UP = 3;')
      && parSrc.includes('function parallaxGroupKind(el)')
      && parSrc.includes("if (flow === 'user' || flow === 'steering') return 'bubble';")
      && parSrc.includes('function parallaxGroupBox(el)')
      && parSrc.includes('let node = el;')
      && parSrc.includes('function parallaxSnapAxis(v, prev)')
      && parSrc.includes('function parallaxGroupBlocked(el)')
      && parSrc.includes('function parallaxGroupNeedsRelative(el)')
      && parSrc.includes('function parallaxGroupOffsets(kind)')
      && parSrc.includes("return kind === 'sidebar';")
      && parSrc.includes('function parallaxTargetIsOffset(rec)')
      && parSrc.includes('function parallaxTargetOffset(rec, x, y)')
      && parSrc.includes('parallaxVarOn(el, PARALLAX_POSITION, PARALLAX_POSITION_RELATIVE);')
      && parSrc.includes('function parallaxGroupCounts()')
      && parSrc.includes('function parallaxTargetUnset(rec)')
      && parSrc.includes('function parallaxTargetAdd(next, prev, el, group, inFrame, kind, slot)')
      && parSrc.includes('parallaxTargetUnset(rec);')
      && parSrc.includes('const dx = parallaxSnapAxis(parallaxStepX * ratio, rec.dx);')
      && parSrc.includes('if (dx === 0 && dy === 0) { parallaxTargetUnset(rec); continue; }')
      && parSrc.includes('if (parallaxTargetIsOffset(rec)) parallaxTargetOffset(rec, x.toFixed(2), y.toFixed(2));')
      && parSrc.includes('const offsets = isGroup && parallaxGroupOffsets(recKind);')
      && parSrc.includes('blocked: isGroup && !offsets ? (inFrame ? true : parallaxGroupBlocked(el)) : false,')
      && parSrc.includes('chatDepth: weClampTo(selection.parallaxUiChatDepth, PARALLAX_GROUP_DEPTH_MIN,')
      && parSrc.includes('composerDepth: weClampTo(selection.parallaxUiComposerDepth, PARALLAX_GROUP_DEPTH_MIN,')
      && parSrc.includes('sidebarDepth: weClampTo(selection.parallaxUiSidebarDepth, PARALLAX_GROUP_DEPTH_MIN,')
      && parSrc.includes('bubbleDepth: weClampTo(selection.parallaxUiBubbleDepth, PARALLAX_GROUP_DEPTH_MIN,')
      && parSrc.includes('let coef = st.chatDepth;')
      && parSrc.includes("if (rec.kind === 'composer') coef = st.composerDepth;")
      && parSrc.includes("else if (rec.kind === 'sidebar') coef = st.sidebarDepth;")
      && parSrc.includes("else if (rec.kind === 'bubble') coef = st.bubbleDepth;")
      && parSrc.includes("cs.position === 'fixed'")
      // 系数：原生四组各按自己的距离（等 `st.ui`）、插件组按槽键查 `parallaxPluginDepths`
      // （缺键 = PARALLAX_PLUGIN_DEFAULT；等 `st.pluginOn`，与界面那整块互不依赖）。
      && parSrc.includes('return coef * PARALLAX_UI_SIGN;')
      && parSrc.includes("if (rec.kind === 'plugin') {")
      // 查表只认**自己的键**（审计 M4：存档里的 `__proto__` 会经 schema 的 `Object.assign({}, v)` 变成
      // 那张表的原型，直接 `st.plugin[rec.slot]` 就把原型链上的东西当成了设置 —— 与 parallaxMaxPercent
      // 的 `hasOwnProperty` 遍历口径也要一致）。
      // P3-2：两条取数路径（最大距离的遍历 / 这一组的系数）现共用**同一个取值器**
      // `parallaxPluginDepth(st, slot)`，非有限值 / 超范围 / 缺键从此同一个结果 ⇒ 再也不会有
      // "max 算 0、系数算 1" 那种一半信 clamp 一半信直读的错位（维护者 review P3-2）。
      && parSrc.includes('const own = Object.prototype.hasOwnProperty.call(map, slot) ? map[slot] : undefined;')
      && parSrc.includes('return weClampTo(own, PARALLAX_GROUP_DEPTH_MIN, PARALLAX_GROUP_DEPTH_MAX, PARALLAX_PLUGIN_DEFAULT);')
      && parSrc.includes('function parallaxPluginDepth(st, slot) {')
      && parSrc.includes('const v = parallaxPluginDepth(st, key);')
      && parSrc.includes('return parallaxPluginDepth(st, rec.slot) * PARALLAX_UI_SIGN;')
      // 反向：老的两套内联取数必须整条消失 —— ① `parallaxMaxPercent` 那遍把非有限值钳成
      // **0**（P3-2 那条缝的来源）；② `parallaxTargetRatio` 自己 hasOwnProperty + 自己 clamp。
      // 注意：不能拿"`weClampTo(own, …)` 不再出现"当反证 —— 那串现在正是共用取值器自己
      // 的那一行，写了等于把正面判据反着再说一遍（恒假）。
      && !parSrc.includes('if (weClampTo(map[key], PARALLAX_GROUP_DEPTH_MIN, PARALLAX_GROUP_DEPTH_MAX, 0) > max)')
      && !parSrc.includes('PARALLAX_PLUGIN_DEFAULT) * PARALLAX_UI_SIGN;')
      // P3-3：`parallaxGroupKind()` 里那条"在 **className** 里找 `data-composer-card`"的分支已删。
      // 它永远不成立（属性名不会长在类名里）⇒ 行为腿抓不到它（复活它不改变任何可达形态），
      // 只能靠这条**结构**反证钉住：一旦有人把它写回来，判据必须判红（变异体 B 实测如此）。
      && !parSrc.includes("cls.indexOf(' data-composer-card ')")
      // 插件前端那一块**有自己的开关**（用户诉求 m03549；裁决 = 独立于界面跟随、默认关）：
      // 关着时层连扫都不扫（不是"系数算成 0"），最大距离与系数这两条路也都不看那张表。
      && parSrc.includes('pluginOn: selection.parallaxPlugin === true,')
      && parSrc.includes('if (st.pluginOn) {')
      && parSrc.includes('if (!st.pluginOn) return 0;')
      && parSrc.includes('if (!st.pluginOn) return max;')
      && parSrc.includes('if (!st.ui) return 0;')
      // 审计 M1：缺键的槽按缺省 1% 计入 `pctMax`。不补这一下、`parallaxBg` 又是 0 且原生四组全 0 时
      // `pctMax` 算成 0，帧会走"一次落位收工"的短路（见 parallaxFrame 的 `if (pctMax <= 0)`）⇒ 插件组
      // 每帧直接贴目标、`parallaxSmooth` 静默失效（只开插件前端 + 关掉背景那一段就是这条路的实测面，
      // 下面行为台的 M1 那条腿逐帧验它）。
      && parSrc.includes('if (PARALLAX_PLUGIN_DEFAULT > max) max = PARALLAX_PLUGIN_DEFAULT;')
      // 审计 #1：名单与屏上**同源** —— 「扩展」页签画行用的是 parallaxPluginEffectiveGroups()（先剔掉
      // 被外层组吃掉的），原生四组那一段也只在「界面元素跟随」开着时才收集（关着时它们系数恒 0、还会
      // 把落在它们盒子里的插件槽当成嵌套吃掉 ⇒ 只开插件前端就成了拖了不动的空开关）。两道闸门一起看。
      && parSrc.includes('function parallaxPluginEffectiveGroups()')
      && parSrc.includes('const plugins = parallaxPluginEffectiveGroups();')
      && parSrc.includes("if (st.ui && typeof document !== 'undefined' && document")
      // 审计 L1：过零那一帧先归零（`prev` 是上一条写出去的**带符号**整数、量化只看绝对值 —— 不认
      // 符号的话光标跨过屏幕中线那次会把 -1 直接翻成 +1 = 2 个设备像素的台阶）。
      && parSrc.includes('const sign = raw < 0 ? -1 : 1;')
      && parSrc.includes('if (prev && (prev > 0) !== (raw > 0)) return 0;')
      && parSrc.includes('if (!prev) {')
      // 反向：插件组不再挂在「界面元素跟随」上（老写法 `parallaxSettings().ui` 认插件组、以及
      // 只看界面开关就早退的那条最大距离算式，两处都删了）。
      && !parSrc.includes('if (!st.ui) return max;')
      && !parSrc.includes('parallaxSettings().ui')
      // 插件组也要带上槽键（记录的 `slot` 就是查表的键）。
      && parSrc.includes('parallaxTargetAdd(next, prev, parallaxGroupBox(el) || el, true, inFrame, candidates[i].kind,')
      && parSrc.includes('candidates[i].slot);')
      && parSrc.includes("if (nested && candidates[i].kind !== 'bubble') continue;")
      && parSrc.includes("const from = bubbles.length > PARALLAX_GROUP_BUBBLE_MAX")
      && parSrc.includes('parallaxTargetsRefresh(now, true);')
      && parSrc.includes('if (rec.group) continue;')
      && parSrc.includes('parallaxDpr = isFinite(dpr) && dpr > 0 ? dpr : 1;')
      // 重扫与视口补读**都在帧外**（起帧路径节流重扫）：帧里不碰 querySelectorAll / window.innerWidth。
      && parSrc.includes('function parallaxTargetsEnsure(now)')
      // 页面不可见就不排帧：document.hidden 直接返回 + visibilitychange 回来再接上。
      && parSrc.includes('function parallaxHidden()')
      && parSrc.includes("document.addEventListener('visibilitychange', parallaxOnVisibility, { passive: true })")
      // 自检开关（localStorage.weParallaxDebug = '1'）：每帧耗时 / 写入次数 / 帧间隔 → 收工打一行。
      && parSrc.includes("const PARALLAX_DEBUG_KEY = 'weParallaxDebug';")
      && parSrc.includes('function parallaxDebugSync(now)')
      && parSrc.includes('function parallaxDebugFrame(t0, now, writes)')
      && parSrc.includes('function parallaxDebugReport(groupCounts)')
      // 审计 A1：收工那条自检报告的"界面组 会话/输入/侧栏/气泡/插件"读的是位移目标表，而
      // `parallaxStop()` 是先清表再报告 ⇒ 这一行**恒为 0**（看着像"界面组一个都没认到"，实测是
      // 把表清空后才去数）。修法是清表**之前**先快照组数、把它交给报告覆盖读数。两条一起钉：
      // 快照必须出现在清表那一句之前，报告必须收下这份快照。
      && parSrc.includes('const groupCounts = parallaxDebugOn ? parallaxGroupCounts() : null;')
      && parSrc.indexOf('const groupCounts = parallaxDebugOn ? parallaxGroupCounts() : null;')
        < parSrc.indexOf('parallaxTargetsClear();')
      && parSrc.includes('parallaxDebugReport(groupCounts);')
      && parSrc.includes('win.__weParallaxStats = report;')
      // 老口径"只看壁纸的系数"整条消失：最大距离现在从各层里取（见上面 parallaxMaxPercent）。
      && !parSrc.includes('const pctMax = st.bg;')
      && parSrc.includes('if (pctMax <= 0) {')
      && parSrc.includes('const idle = parallaxMoveMs > 0 && now - parallaxMoveMs >= PARALLAX_IDLE_MS;')
      && parSrc.includes('parallaxTargetLift(el, true);')
      // 反向：每帧写自定义属性那条老路整条消失（不再有 -x / -y，也不再有 60Hz 封顶那三行），
      // 旧的 body 版写入函数也删了。
      && !parSrc.includes('--we-parallax-x')
      && !parSrc.includes('--we-parallax-y')
      && !parSrc.includes('PARALLAX_MIN_FRAME_MS')
      && !parSrc.includes('parallaxVarOn(weBody()')
      && !parSrc.includes('parallaxVar('),
      'parallax-layer = 独立属性行为层：不建 DOM + 中心对称 + 指数缓动 + 到位就停 + 特效不参与 + 帧内零测量');
    // 位移实际落在 CSS 上：那一段必须（a）整段挂在开关属性下、（b）只用独立属性
    // translate / scale（transform 会被壁纸过场的 resetLayerSwitchStyles 清掉）、
    // （c）壁纸同时放大补边、（d）特效层不在里面。
    // 刀3：样式族取整族源码文本（8 个域模块 + 组装点，构建序拼接）；下面的锚点与切片不变。
    const stylesSrc = styleText();
    const parCssAt = stylesSrc.indexOf('「扩展」三号模块');
    const parCss = parCssAt < 0 ? '' : stylesSrc.slice(parCssAt);
    check('styles.js 视差段：开关属性下才生效 · 只用独立属性 · 壁纸放大补边 · 特效层不参与 · 动的那几帧才提合成层 · 会话滚动容器不长横向滚动条',
      parCssAt > 0
      && parCss.includes('body[data-we-parallax="on"] .we-layer')
      // 位移由行为层直接写 translate ⇒ 样式表这边只剩这个**静态**补边放大（系数在设置变了时写一次）。
      // 除数是 50（= 100 / 2）：新口径下最大位移 = pct% × 对角线，补边也得按同一倍率（m02697-①）。
      && parCss.includes('scale: calc(1 + var(--we-parallax-bg, 0) / 50)')
      // 低开销：只有"正在动的那几帧"才提合成层（类由行为层加、到位摘），且只提示 translate。
      && parCss.includes('body[data-we-parallax="on"] .we-parallax--moving { will-change: translate; }')
      && parCss.includes('will-change: translate;')
      // 界面跟随挪的是 scroller **里面**的元素 ⇒ 位移一旦越出它的 inline-end，`overflow-y: auto`
      // 会把横向那条 visible 当 auto 用、长出一条横向滚动条；它占掉一条滚动条高的 scrollport，
      // sticky 的输入卡片只能跟着上移（用户口径 m02410-①："输入框底部会出现一个黑条，把输入框
      // 顶上去"；跨中线位移换向 ⇒ 滚动条出没 ⇒ 抖）。封掉 scroller 的横轴即根治。
      && parCss.includes('body[data-we-parallax="on"] [data-conversation-scroll] { overflow-x: hidden; }')
      // 独立属性而不是 transform：壁纸层的过场会内联写 / 清 transform（resetLayerSwitchStyles）。
      && !parCss.includes('transform:')
      // 每帧写自定义属性那条老路整条消失：-x / -y 与"吉祥物系数"都不再出现在样式表里。
      && !parCss.includes('--we-parallax-x')
      && !parCss.includes('--we-parallax-y')
      && !parCss.includes('--we-parallax-mascot')
      // 点击 / 拖尾那一层不参与偏移。
      && !parCss.includes('.we-fx'),
      'parCss=' + parCss.length + ' 段起始=' + parCssAt);
  }
  {
    // Plan A 的机制换到哪儿了（用户口径：动效的性能开销较高）：位移现在**直接**落在那几个元素
    // 自己的 CSS 独立属性 translate 上，一个自定义属性都不写。无头环境本来没有 DOM，这里搭一副
    // 最小的假 DOM（querySelectorAll 返回两个假元素、假 rAF 由我们手动驱动），真跑几帧验证：
    // ① 位移落在**那几个元素自己**身上、body 上只有 1 个补边系数；
    // ② 自定义属性 -x / -y / 吉祥物系数一个都没写；
    // ③ 起帧时给它们加了合成层提示类、到位收工摘掉（本仓刻意不留常驻合成层）；
    // ④ 打开自检开关后收工时 window.__weParallaxStats 里有一份帧统计；
    // ⑤ 关掉总开关后位移与类、body 上的系数都收干净。
    const PREV_SEL = globalThis.selection;
    const PREV_DOC = globalThis.document;
    const PREV_WIN = globalThis.window;
    const PREV_RAF = globalThis.requestAnimationFrame;
    const PREV_CAF = globalThis.cancelAnimationFrame;
    const PREV_LS = globalThis.localStorage;
    const PREV_GCS = globalThis.getComputedStyle;
    const restoreWeBase = stubWeBase();
    const storeOf = () => {
      const props = {};
      return {
        props,
        style: {
          setProperty: (k, v) => { props[k] = v; },
          getPropertyValue: (k) => (k in props ? props[k] : ''),
          removeProperty: (k) => { delete props[k]; },
        },
      };
    };
    const mkTarget = (cls) => {
      const store = storeOf();
      const classes = [];
      return {
        className: cls, props: store.props, style: store.style,
        classList: {
          add: (c) => { if (classes.indexOf(c) < 0) classes.push(c); },
          remove: (c) => { const i = classes.indexOf(c); if (i >= 0) classes.splice(i, 1); },
          contains: (c) => classes.indexOf(c) >= 0,
        },
      };
    };
    const bodyStore = storeOf();
    const fakeBody = {
      style: bodyStore.style, props: bodyStore.props,
      setAttribute: () => {}, removeAttribute: () => {},
    };
    const layerEl = mkTarget('we-layer');
    const ropeEl = mkTarget('we-rope');
    const targets = [layerEl, ropeEl];
    // 界面组用的假元素照**宿主真实形态**造（asar 复算）：命中的是**槽出口**（`data-slot` /
    // `data-composer-card` / `data-chat-flow-kind`），而宿主给出口写死 `display: contents`
    // ⇒ 出口自己不生成盒子，位移必须落到它**父元素**那个真盒子上（这正是"侧栏与会话文本区不跟
    // 着动"的修法）。所以每个锚点造一对：outlet（display: contents）+ box（display: block）。
    const mkGroup = (attrs) => {
      const outlet = mkTarget('we-group');
      outlet.display = 'contents';                    // 宿主 ANCHOR_STYLE
      outlet.children = [];
      outlet.querySelectorAll = () => outlet.children;
      outlet.contains = () => false;
      outlet.getAttribute = (k) => (k in attrs ? attrs[k] : null);
      outlet.hasAttribute = (k) => k in attrs;
      const box = mkTarget('we-group-box');
      box.display = 'block';
      box.children = [];
      box.querySelectorAll = () => box.children;
      box.contains = () => false;
      outlet.parentElement = box;
      return { outlet, box };
    };
    // 会话文本区 / 输入卡片 / 侧栏各一组 + 一个**嵌在会话文本区里**的组（只留最外侧那个）；
    // 输入卡片那个盒子里塞一个 fixed 后代 ⇒ 它必须整组不动（本仓 #89：translate 会让它成为
    // 那个 fixed 后代的包含块）。气泡另造 30 条：验"只留**最近** 24 条"与"长在文本区盒子里也
    // 照样拿到自己的位移（两个位移故意叠加）"。
    const chatGroup = mkGroup({ 'data-slot': 'conversation.view' });
    const composerGroup = mkGroup({ 'data-composer-card': '' });
    const sidebarGroup = mkGroup({ 'data-slot': 'sidebar' });
    const nestedGroup = mkGroup({ 'data-slot': 'conversation.view' });
    const bubbles = [];
    for (let i = 0; i < 30; i += 1) bubbles.push(mkGroup({ 'data-chat-flow-kind': 'user' }));
    // 气泡住在会话文本区那个盒子里 ⇒ 文本区出口"包含"它们（嵌套判定对气泡放行）。
    chatGroup.outlet.contains = (other) => other === nestedGroup.outlet
      || other === pluginNestedChild          // 插件槽落在原生组里（见下面的 ②）
      || bubbles.some((b) => b.outlet === other);
    composerGroup.box.children = [{ position: 'fixed' }];
    // 侧栏那一列同样塞一个 fixed 后代 —— 宿主在 Windows 标题栏模式下**就是这样**把「收起侧边栏」
    // 按钮钉在那一列里的。它走相对偏移（不建立包含块）⇒ 照样要动，而且**一个 `translate` 都不许写**
    // （写了那一列就成包含块，按钮下移一个标题栏高度 = m01915-③）。
    sidebarGroup.box.children = [{ position: 'fixed' }];
    // 别的插件注册的前端元素组（用户诉求 m03549）：宿主的槽出口（`display: contents`、没有盒子）
    // + 一个**有盒子的元素子节点** —— 位移要落在这个子节点上。插件那一整块走**它自己的开关**
    // （独立于「界面元素跟随」、默认关），下面单独跑两条腿验它。
    const pluginOutlet = mkTarget('we-slot');
    pluginOutlet.display = 'contents';
    pluginOutlet.getAttribute = (k) => (k === 'data-slot' ? 'dshmarket.panel' : null);
    pluginOutlet.hasAttribute = (k) => k === 'data-slot';
    pluginOutlet.closest = () => null;              // 不在设置页 / 插件管理页那块子树里
    pluginOutlet.contains = () => false;
    const pluginChild = mkTarget('we-plugin-card');
    pluginChild.display = 'block';
    pluginChild.children = [];
    pluginChild.querySelectorAll = () => pluginChild.children;
    pluginChild.contains = () => false;
    pluginChild.parentElement = pluginOutlet;
    pluginOutlet.children = [pluginChild];
    pluginOutlet.querySelectorAll = () => pluginOutlet.children;
    // ② 落在原生组**里面**的插件槽（用户诉求 m03549 与"只开插件前端"的交叉情形，审计 #1）：它自己
    //    的距离没有落点（原生组一动它就跟着走）⇒ 名单与屏上都得把它当"被外层吃掉"，**但只在**
    //    「界面元素跟随」**开着**时**才这么算 —— 关着时原生四组系数恒 0、压根不是候选，这时它必须
    //    拿到自己的位移，否则"只开插件前端"就成了拖了不动的空开关（下面单独跑两条腿验这两面）。
    const pluginNestedOutlet = mkTarget('we-slot');
    pluginNestedOutlet.display = 'contents';
    pluginNestedOutlet.getAttribute = (k) => (k === 'data-slot' ? 'otheracc.widget' : null);
    pluginNestedOutlet.hasAttribute = (k) => k === 'data-slot';
    pluginNestedOutlet.closest = () => null;
    pluginNestedOutlet.contains = () => false;
    const pluginNestedChild = mkTarget('we-plugin-nested');
    pluginNestedChild.display = 'block';
    pluginNestedChild.children = [];
    pluginNestedChild.querySelectorAll = () => pluginNestedChild.children;
    pluginNestedChild.contains = () => false;
    pluginNestedChild.parentElement = pluginNestedOutlet;
    pluginNestedOutlet.children = [pluginNestedChild];
    pluginNestedOutlet.querySelectorAll = () => pluginNestedOutlet.children;
    // P3 三条行为腿的现场值（只在报错串里用）；`docGroups` 是假 DOM 里那个组数组的别名 ——
    // 腿里要往台上**新增**假组件，只能推这个同一个引用（文档假 DOM 的组选择器就返回它）。
    let composerAttrOk = false;
    let overScanOk = false;
    let badDepthOk = false;
    let overScanOut = null;
    let legacyDepthOut = null;
    const groups = [chatGroup.outlet, composerGroup.outlet, sidebarGroup.outlet, nestedGroup.outlet,
      pluginOutlet, pluginNestedOutlet].concat(bubbles.map((b) => b.outlet));
    // 假 DOM 的组选择器就返回**这个**数组 ⇒ P3 的腿要新增假组件，推它即可（同一引用）。
    // 顺序有讲究：`docGroups` 必须声明在 `groups` **之后** —— 早期版本把赋值行排在 `groups` 之前，TDZ 直接抛（踩过）。
    const docGroups = groups;
    const listeners = {};
    let clock = 0;
    let pending = null;
    let threw = '';
    let movedOn = false;
    let groupsOk = false;
    let settled = false;
    let centerCleared = false;
    let dbgOk = false;
    let hysteresisOk = false;
    let regionsOk = false;
    let pluginOk = false;
    let pluginOffOk = false;
    let pluginDefaultOk = false;
    let pluginNestedOk = false;
    let pluginSmoothOk = false;
    let crossZeroOk = false;
    let pluginNumOut = null;
    let chatNowOut = null;
    let pluginAloneOut = null;
    // 新三条腿的现场值（只在报错串里用；`crossSeq` 那一条在 try 里是局部的 ⇒ 拷一份出来）。
    let pluginNestedOut = null;
    let firstFrameOut = null;
    let slotsOut = null;
    let crossSeqOut = null;
    let slotsOutOn = null;
    let cleared = false;
    // 自检开关走 localStorage：宿主可能把它定义成只读访问器 ⇒ 用 defineProperty 覆盖。
    const setLocalStorage = (value) => {
      try {
        Object.defineProperty(globalThis, 'localStorage', {
          value, configurable: true, writable: true,
        });
      } catch { /* 只读宿主 */ }
    };
    try {
      globalThis.document = {
        body: fakeBody,
        // 按选择器分流：界面组那几条选择器拿全部**原生**界面锚点（出口 + 气泡，宿主按 DOM
        // 顺序给），其余（壁纸 / 吉祥物）拿 targets ——"任何选择器都返回同一个数组"的老写法会把
        // 界面组当成壁纸层。插件那一块扫的是**裸** `[data-slot]`（宿主的槽出口语义属性），
        // 那时要把别的插件那个出口也给出去；而原生那几条选择器是按**槽名**写的，匹配不到它。
        querySelectorAll: (sel) => {
          const s = String(sel);
          if (s === '[data-slot]') return groups;
          if (s.indexOf('data-slot="conversation.view"') >= 0 || s.indexOf('data-slot="sidebar"') >= 0
            || s.indexOf('data-composer-card') >= 0 || s.indexOf('data-chat-flow-kind') >= 0) {
            return groups.filter((g) => g !== pluginOutlet && g !== pluginNestedOutlet);
          }
          return targets;
        },
        addEventListener: (type, fn) => { listeners[type] = fn; },
        removeEventListener: () => {},
      };
      // 假 getComputedStyle：只回答 position 与 display（"组里有 fixed 后代"与"出口是不是
      // `display: contents`"这两条判据靠它）。
      globalThis.getComputedStyle = (node) => ({
        position: (node && node.position) || 'static',
        display: (node && node.display) || 'block',
      });
      globalThis.window = {
        innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1,
        addEventListener: () => {}, removeEventListener: () => {},
        performance: { now: () => clock },
      };
      globalThis.requestAnimationFrame = (fn) => { pending = fn; return 1; };
      globalThis.cancelAnimationFrame = () => { pending = null; };
      globalThis.selection = {
        parallaxEnabled: true, parallaxBg: 1, parallaxMascot: true,
        parallaxSmooth: 85, parallaxUi: true,
        // 四个区域**各是绝对距离**（新口径 m02697-①/③：不再乘在总倍率上）⇒ 故意给四个不同的数，
        // 下面要验"分档各自生效"（侧栏 / 气泡都比会话文本区小；输入卡片被 fixed 后代挡下）。
        parallaxUiChatDepth: 1, parallaxUiComposerDepth: 1.5,
        parallaxUiSidebarDepth: 0.6, parallaxUiBubbleDepth: 0.4,
      };
      // 自检开关走 localStorage（宿主可能把它定义成只读访问器 ⇒ 用 defineProperty 覆盖）。
      setLocalStorage({ getItem: (k) => (k === 'weParallaxDebug' ? '1' : null) });
      const step = (dt) => { clock += dt; const fn = pending; pending = null; if (fn) fn(clock); };
      // 重扫那几层是**节流**的（`PARALLAX_TARGETS_MS` = 250ms，基准就是这里的假时钟 —— 测试里
      // 假 `window.performance.now` 直接返回 `clock`）：改完 `selection` 想让它**当场**按新状态
      // 重认一遍候选，就必须先把时钟推过节流窗、再挪一次指针；否则新记录要等后面某一帧的 kick
      // 才补得上 —— 而"到位就收工"意味着那一帧可能**根本不会排**（`pending` 为空时 `step` 只推
      // 时钟），于是"开关开了却没动"会看起来像功能坏了。挪指针这一步同时也躲开"原地只改
      // `selection` 排不出帧"那条（见下面插件那几条腿的注释）。
      const rescan = (x, y) => {
        for (let i = 0; i < 16; i += 1) step(20);            // 320ms ⇒ 推过节流窗
        if (typeof listeners.pointermove === 'function') listeners.pointermove({ clientX: x, clientY: y });
        for (let i = 0; i < 400 && pending; i += 1) step(20);   // eslint-disable-line no-unmodified-loop-condition -- pending 由 step() 改（跨函数副作用，规则看不见）
      };
      parallaxLayerMod.syncParallaxLayer();          // 起帧（假 rAF ⇒ 只排一帧）
      if (typeof listeners.pointermove === 'function') listeners.pointermove({ clientX: 1600, clientY: 900 });
      for (let i = 0; i < 6; i += 1) step(20);       // 挪到右下角 ⇒ 目标 = (-16, -9)（bg 1% / 除数 50）
      const moved = String(layerEl.props['translate'] || '');
      const same = targets.every((el) => el.props['translate'] === moved);
      // 界面组：四块各按**自己的绝对距离**（会话文本区 1%、输入卡片 1.5%、侧栏 0.6%、用户气泡
      // 在文本区之上再叠 0.4% —— 气泡住在文本区的盒子里，两段位移叠加，见文件头 ④）；
      // 位移**与壁纸同向**（用户口径 m01371 第二条："希望输入框和背景同向运动"）；落在**整设备
      // 像素**上（dpr = 1 ⇒ 整数）；落点是**出口的父盒子**（出口是 display: contents，写它没用）；
      // 嵌套的非气泡组一个位移都没有、气泡照拿（两个位移故意叠加）；被 fixed 后代挡住的组不动；
      // 30 条气泡只留**最近 24 条**；界面组**一个都不许带 `we-parallax--moving`**（不提合成层）。
      const numOf = (box) => {
        const m = /^(-?\d+\.\d\d)px (-?\d+\.\d\d)px$/.exec(String(box.props['translate'] || ''));
        return m ? [Number(m[1]), Number(m[2])] : null;
      };
      // 左栏走的是相对偏移 ⇒ 读的是 `left` / `top` 这一对（换算回设备像素的整数量化）。
      const offsetNum = (box) => {
        const m = /^(-?\d+\.\d\d)px (-?\d+\.\d\d)px$/.exec(
          String((box.props['left'] || '') + ' ' + (box.props['top'] || '')));
        return m ? [Number(m[1]), Number(m[2])] : null;
      };
      const layerNum = numOf(layerEl);
      const chatNum = numOf(chatGroup.box);
      const sideNum = offsetNum(sidebarGroup.box);
      const bubbleMoved = bubbles.filter((b) => 'translate' in b.box.props);
      const bubbleNum = bubbleMoved.length ? numOf(bubbleMoved[bubbleMoved.length - 1].box) : null;
      const snapOk = [chatNum, bubbleNum].every((n) => n
        && n[0] === Math.round(n[0]) && n[1] === Math.round(n[1]))
        && !!sideNum && sideNum[0] === Math.round(sideNum[0]) && sideNum[1] === Math.round(sideNum[1]);
      const dirOk = !!layerNum && !!chatNum && layerNum[0] * chatNum[0] > 0
        && layerNum[1] * chatNum[1] > 0;
      const depthOk = !!chatNum && !!sideNum && !!bubbleNum
        && Math.abs(sideNum[0]) < Math.abs(chatNum[0])
        && Math.abs(bubbleNum[0]) < Math.abs(chatNum[0]);
      // 左栏那一列**一个 `translate` 都不能留**：写了它就成了宿主的 fixed 标题栏按钮的包含块
      // （m01915-③ 的来路）；它该留的是相对定位前缀 + `left`/`top`。
      const sideOk = !('translate' in sidebarGroup.box.props)
        && !('translate' in sidebarGroup.outlet.props)
        && sidebarGroup.box.props['position'] === 'relative'
        && !!sideNum;
      // 气泡按 DOM 顺序截尾：最新的 24 条（下标 6..29）动，最早的 6 条一动不动。
      const capOk = bubbleMoved.length === 24
        && bubbles.slice(0, 6).every((b) => !('translate' in b.box.props));
      // 出口自己**一个位移都没有**（它没有盒子）—— 这正是这一版修掉的那条 bug。
      const boxOk = !('translate' in chatGroup.outlet.props)
        && !('translate' in sidebarGroup.outlet.props);
      groupsOk = snapOk && dirOk && depthOk && capOk && boxOk && sideOk
        && !('translate' in nestedGroup.box.props)
        && !('translate' in composerGroup.outlet.props)
        && !('translate' in composerGroup.box.props)
        && !chatGroup.box.classList.contains('we-parallax--moving')
        && !composerGroup.box.classList.contains('we-parallax--moving')
        && !sidebarGroup.box.classList.contains('we-parallax--moving')
        && !bubbles[29].box.classList.contains('we-parallax--moving');
      movedOn = same && /^-?\d+\.\d\dpx -?\d+\.\d\dpx$/.test(moved)
        && targets.every((el) => el.classList.contains('we-parallax--moving'))
        && !('--we-parallax-x' in bodyStore.props) && !('--we-parallax-y' in bodyStore.props)
        && !('--we-parallax-mascot' in bodyStore.props)
        && bodyStore.props['--we-parallax-bg'] === '1';
      for (let i = 0; i < 400 && pending; i += 1) step(20);   // eslint-disable-line no-unmodified-loop-condition -- pending 由 step() 改（跨函数副作用，规则看不见）
      settled = pending === null && targets.every((el) => !el.classList.contains('we-parallax--moving'));
      // 迟滞（用户口径 m01915-②：光标从屏幕一半挪到另一半时中央文本区与输入框会抖）：量化死区
      // 0.25 / 重新起跳 0.75 设备像素。先让它稳定在大位移那一档，再把光标挪到"本该归零"的 0.4
      // 设备像素档 —— 不带迟滞的写法（直接 Math.round）这一下会把 `translate` 摘掉，光标在零附近
      // 一磨就 0↔1 来回翻转 = 屏上一下一下地跳；带迟滞则**保留上一档的 1px**，直到真的落进死区。
      if (typeof listeners.pointermove === 'function') listeners.pointermove({ clientX: 1600, clientY: 900 });
      for (let i = 0; i < 400 && pending; i += 1) step(20);   // eslint-disable-line no-unmodified-loop-condition -- pending 由 step() 改（跨函数副作用，规则看不见）
      const engaged = !!numOf(chatGroup.box);
      if (typeof listeners.pointermove === 'function') listeners.pointermove({ clientX: 840, clientY: 450 });
      for (let i = 0; i < 400 && pending; i += 1) step(20);   // eslint-disable-line no-unmodified-loop-condition -- pending 由 step() 改（跨函数副作用，规则看不见）
      const holdNum = numOf(chatGroup.box);
      hysteresisOk = engaged && !!holdNum && Math.abs(holdNum[0]) === 1 && holdNum[1] === 0;
      // ① 各区域单独可调（用户口径 m01915-①；0 的语义见 m02697-③）：把会话文本区那一档的距离
      // 置 0 ⇒ 它一动不动，而侧栏照旧拿自己的偏移 —— 四个距离真的是各自的，不是共用同一个数。
      globalThis.selection.parallaxUiChatDepth = 0;
      if (typeof listeners.pointermove === 'function') listeners.pointermove({ clientX: 1600, clientY: 900 });
      for (let i = 0; i < 400 && pending; i += 1) step(20);   // eslint-disable-line no-unmodified-loop-condition -- pending 由 step() 改（跨函数副作用，规则看不见）
      regionsOk = !('translate' in chatGroup.box.props) && !!offsetNum(sidebarGroup.box);
      globalThis.selection.parallaxUiChatDepth = 1;
      // ② 插件前端那一整块**自己的开关**（用户诉求 m03549："把插件前端也单独归类加开关"；裁决 =
      // 独立于界面跟随、默认关）。三条腿合起来才叫"独立"：
      //   a) 界面跟随开着、插件开关没开 ⇒ 认到的槽位**一动不动**（层那时连扫都不扫）；
      //   b) 只打开插件开关 ⇒ 出口的元素子节点照样拿到位移，距离就是缺省的 1%（与原生区域同距离）；
      //   c) 再把界面整块关掉、插件开关留着 ⇒ 插件那组照动，原生四组 + 24 条气泡全停
      //      （反向的"只开界面跟随"已经在 a) 里验过）。
      pluginOffOk = !('translate' in pluginChild.props);
      globalThis.selection.parallaxPlugin = true;
      // ⚠️ 每条腿都要走 `rescan`（先把假时钟推过 250ms 重扫节流窗、再挪到一个**新位置**）：
      // 这一层到位就收工（`pending === null`）、重扫又只在 kick 里发生 —— 原地只 mutate
      // `selection` 或只挪 1px，下面几条腿会"看着像开关没生效"（细节见 `rescan` 的注释）。
      // b/c 两条腿的位置差 1 设备像素，量化后目标值逐字相同 ⇒ 可以直接比"关掉界面整块前后
      // 插件那一组走的一样远"。
      rescan(1560, 860);
      const pluginNum = numOf(pluginChild);
      const chatNow = numOf(chatGroup.box);
      pluginNumOut = pluginNum; chatNowOut = chatNow;
      pluginDefaultOk = !!pluginNum && !!chatNow
        && pluginNum[0] === chatNow[0] && pluginNum[1] === chatNow[1];
      globalThis.selection.parallaxUi = false;
      // 这一条腿同时是"改了开关之后**重新认一遍候选**"的验证：`rescan` 会把时钟推过节流窗再 kick
      // ⇒ 界面整块关掉之后，原生四组**当场**从候选里掉出去（记录被清、位移被收），而插件那一组
      // 留在候选里继续拿自己的位移。两个位置相隔 1px、量化后目标逐字相同 ⇒ 可以直接比值。
      rescan(1561, 861);
      const pluginAloneNum = numOf(pluginChild);
      pluginAloneOut = pluginAloneNum;
      pluginOk = pluginOffOk && pluginDefaultOk && !!pluginAloneNum
        && pluginAloneNum[0] === pluginNum[0] && pluginAloneNum[1] === pluginNum[1]
        && !('translate' in chatGroup.box.props) && !('translate' in composerGroup.box.props)
        && !('translate' in nestedGroup.box.props) && !('left' in sidebarGroup.box.props)
        && bubbles.every((b) => !('translate' in b.box.props));
      // ③ 落在原生组**里面**的那个插件槽（审计 #1）：界面跟随**关着**时原生四组压根不是候选 ⇒ 它
      //    必须拿到自己的位移；「扩展」页签画行用的名单也必须把它算进来（同一个挑选）。它和
      //    dshmarket 那个出口都在同一批 `[data-slot]` 里、距离都用缺省 1% ⇒ 直接与 pluginChild 比。
      const nestedAloneNum = numOf(pluginNestedChild);
      const listedAlone = parallaxLayerMod.parallaxDiscoveredGroups();
      pluginNestedOk = !!pluginAloneNum && !!nestedAloneNum
        && nestedAloneNum[0] === pluginAloneNum[0] && nestedAloneNum[1] === pluginAloneNum[1]
        && listedAlone.indexOf('otheracc.widget') >= 0 && listedAlone.indexOf('dshmarket.panel') >= 0;
      pluginNestedOut = nestedAloneNum;
      slotsOut = listedAlone;
      // ④ 平滑（审计 M1）：壁纸倍率 0、界面跟随关着、只有插件前端开着时，`pctMax` 曾经算出 0 ⇒ 帧
      //    走"一次落位收工"的短路，插件组每帧直接贴目标、`parallaxSmooth` 静默失效（尾巴上还能看到
      //    10px 级的瞬移）。修法是"缺键的槽按缺省 1% 计入 pctMax" ⇒ 从零跳到满档的第一帧必须**只
      //    走一部分**（严格小于收敛后的值）。先让它归零，再一步跨到满档 ⇒ 差值够大，量化也看得出来。
      const bgPrev = globalThis.selection.parallaxBg;
      globalThis.selection.parallaxBg = 0;
      if (typeof listeners.pointermove === 'function') listeners.pointermove({ clientX: 800, clientY: 450 });
      for (let i = 0; i < 400 && pending; i += 1) step(20);   // eslint-disable-line no-unmodified-loop-condition -- pending 由 step() 改（跨函数副作用，规则看不见）
      if (typeof listeners.pointermove === 'function') listeners.pointermove({ clientX: 1600, clientY: 900 });
      step(20);
      const firstFrameNum = numOf(pluginChild);
      for (let i = 0; i < 400 && pending; i += 1) step(20);   // eslint-disable-line no-unmodified-loop-condition -- pending 由 step() 改（跨函数副作用，规则看不见）
      const smoothSettledNum = numOf(pluginChild);
      pluginSmoothOk = !!firstFrameNum && !!smoothSettledNum && firstFrameNum[0] !== 0
        && Math.abs(firstFrameNum[0]) < Math.abs(smoothSettledNum[0]);
      firstFrameOut = firstFrameNum;
      globalThis.selection.parallaxBg = bgPrev;
      // 后面的腿回到"界面跟随也开着"那一态（停止那条腿的收尾判据要看到左栏的定位前缀还在）。
      globalThis.selection.parallaxUi = true;
      rescan(1520, 830);
      // ⑤ 反过来：界面跟随**开着**时它必须被外层吃掉（原生组会带着它一起走 ⇒ 它自己再写一次就是两段
      //    位移叠在一起，面板那行也是拖了没反应）—— 屏上一个 `translate` 都不许写，名单里也不许有。
      const listedOn = parallaxLayerMod.parallaxDiscoveredGroups();
      pluginNestedOk = pluginNestedOk && !('translate' in pluginNestedChild.props)
        && !('translate' in pluginNestedOutlet.props)
        && listedOn.indexOf('otheracc.widget') < 0 && listedOn.indexOf('dshmarket.panel') >= 0;
      slotsOutOn = listedOn;
      // ⑥ 过零不跳（审计 L1；用户口径 m01915-②：光标跨过屏幕中线时中央文本区会抖/跳）：`prev` 是
      //    上一条写给同一个轴的**带符号**整数、量化又只看绝对值 ⇒ 不带"过零先归零"的写法会在跨零
      //    那一帧把上一次的 -1 直接翻成 +1（2 个设备像素的台阶）。逐帧采样，断言**不存在相邻两帧
      //    符号相反**（跨零那一帧写的是 0，`translate` 被摘掉 ⇒ 采样值按 0 记），且确实跨了过去。
      const crossSeq = [];
      if (typeof listeners.pointermove === 'function') listeners.pointermove({ clientX: 200, clientY: 450 });
      for (let i = 0; i < 400 && pending; i += 1) {   // eslint-disable-line no-unmodified-loop-condition -- pending 由 step() 改（跨函数副作用，规则看不见）
        step(20);
        const n = numOf(chatGroup.box);
        crossSeq.push(n ? n[0] : 0);
      }
      let crossOk = crossSeq.some((v) => v < 0) && crossSeq.some((v) => v > 0);
      for (let i = 1; i < crossSeq.length; i += 1) {
        if (crossSeq[i - 1] * crossSeq[i] < 0) crossOk = false;
      }
      crossZeroOk = crossOk;
      crossSeqOut = crossSeq;
      // 光标回到屏幕正中 ⇒ 位移归零 ⇒ 界面组那几层的 `translate` 必须**整条摘掉**
      // （属性只要在，包含块就成立 —— 静止的界面连一个空位移都不许留）；左栏摘的是 `left`/`top`，
      // 它那条 `position: relative` 留着（值与插件玻璃那一段逐字相同，摘挂反而是把锚点来回换）。
      if (typeof listeners.pointermove === 'function') listeners.pointermove({ clientX: 800, clientY: 450 });
      for (let i = 0; i < 400 && pending; i += 1) step(20);   // eslint-disable-line no-unmodified-loop-condition -- pending 由 step() 改（跨函数副作用，规则看不见）
      centerCleared = [chatGroup, nestedGroup, composerGroup]
        .every((g) => !('translate' in g.box.props) && !('translate' in g.outlet.props))
        && !('left' in sidebarGroup.box.props) && !('top' in sidebarGroup.box.props)
        && sidebarGroup.box.props['position'] === 'relative'
        && bubbles.every((b) => !('translate' in b.box.props))
        // 插件那一组也归零（开关还开着 ⇒ 这一条验的是"回到中心就收干净"，不是"关掉才收"）。
        && !('translate' in pluginChild.props) && !('translate' in pluginOutlet.props);
      const dbg = globalThis.window.__weParallaxStats;
      // 自检里还带一份界面组清点：会话 1、侧栏 1、气泡 24（截尾后的）、被 fixed 挡下 1（输入卡片）。
      dbgOk = !!dbg && dbg.frames > 0 && dbg.writes > 0
        && typeof dbg.costMs.p50 === 'number' && typeof dbg.gapMs.max === 'number'
        && !!dbg.groups && dbg.groups.chat === 1 && dbg.groups.sidebar === 1
        && dbg.groups.bubble === 24 && dbg.groups.blocked === 1 && dbg.groups.offset === 1;
      globalThis.selection = { parallaxEnabled: false };
      parallaxLayerMod.syncParallaxLayer();
      cleared = targets.every((el) => !('translate' in el.props)
        && !el.classList.contains('we-parallax--moving'))
        && !('--we-parallax-bg' in bodyStore.props)
        // 左栏那条腿连 `position` 一起还回去（记录都没了，这一列还原成 static 才算收干净）。
        && !('position' in sidebarGroup.box.props)
        && !('left' in sidebarGroup.box.props) && !('top' in sidebarGroup.box.props)
        && !('translate' in pluginChild.props) && !('translate' in pluginOutlet.props)
        && typeof listeners.pointermove === 'function';
      // ── P3 三条行为腿（都在最尾部：这一段会把假组件的形态改掉，前面那批断言要看到的是
      //    旧形态=输入卡片被 fixed 后代挡下、自检里"被 fixed 挡下 1"）。────────────────────
      // 视觉系数：光标在最右下时 `u = (1600−800)/50 = 16`、`(900−450)/50 = 9`（PARALLAX_DIRECTION
      // = −1）⇒ 位移 = `u × ratio / 50`；1% 档 = −16、1.5% 档 = −24（Y 侧 −9 / −13.5 之后再量化）。
      // 断言一律**与同台的基准组（会话文本区 = 1% 档）相对**比，不抄绝对值 —— 绝对值属于另一条
      // 腿（`chatNowOut` 那里已经钉过），这里要钉的是"谁的档位是谁的档位"。
      // `cleared` 那一步会把 `globalThis.selection` 换成只带 `parallaxEnabled:false` 的新对象
      // ⇒ 这里**只能**就地改那个新对象（需要哪些字段就从它身上补齐），**不能**换引用：换掉之后
      // `parallaxSettings()` 读到缺字段，整族候选都不再建（踩过：所有位移都成了 undefined）。
      globalThis.selection.parallaxEnabled = true;
      globalThis.selection.parallaxUi = true;
      globalThis.selection.parallaxPlugin = false;
      globalThis.selection.parallaxPluginDepths = {};
      // ⚠️ 四个区域距离必须**显式补齐**：`cleared` 那一步换掉的对象只剩 `parallaxEnabled`
      // ⇒ `parallaxSettings()` 的四条 `weClampTo(...)` 全部落到各自的**兜底常数**
      // （`PARALLAX_GROUP_CHAT` 1.2 / `COMPOSER` 1.8 / `SIDEBAR` 1.6 / `BUBBLE` 1.4，见
      // `packages/parallax/src/parallax-layer.js` 的这四枚常数与 `parallaxSettings()` 里那四条 `weClampTo(...)`）—— 那样"会话基准"就不是 1.0 档、
      // "输入卡片"也不是 1.5 档，下面所有分档断言全部对着错的档位（踩过：composer 读成 1.8 档
      // = −29，而判据在等 1.5 档 = −24）。
      globalThis.selection.parallaxUiChatDepth = 1;
      globalThis.selection.parallaxUiComposerDepth = 1.5;
      globalThis.selection.parallaxUiSidebarDepth = 0.6;
      globalThis.selection.parallaxUiBubbleDepth = 0.4;
      // 停用那一跳把监听器与 rAF 一起解绑了 ⇒ 光改字段再派事件没人听。真驱动方是
      // `subscribe(syncParallaxLayer)`（设置一变就调一次），台里没有那条总线 ⇒ 手动补这一跳。
      parallaxLayerMod.syncParallaxLayer();
      rescan(1600, 900);
      const chatRef = (numOf(chatGroup.box) || []).slice();
      // 先备一个"扫两个来回"的助手：新加的组第一次只在帧里被记下来（`blocked` 直接置 true，
      // **不做**子树判定），只有帧外的重扫才真去数它 ⇒ 想让一个新组被认出来，至少要跑过两次
      // 重扫窗（节流 `PARALLAX_TARGETS_MS` = 250ms 一轮）。
      const rescanTwice = (x, y) => { rescan(x, y); rescan(x, y); };
      // 视口 1600×900、指针停在右下角 ⇒ **1% 档**位移就是 (±16, ±9)：`targetX = -(cx - vw/2)/50`。
      // 分档位移都按它折算：会话文本区 1.2% ⇒ -19.2（量化 -19）、输入卡片 1.5% ⇒ -24 / -13.5、
      // 侧栏 0.6% ⇒ -9.6（-10）。**别拿 1.2% 档当"1%"的基准**（踩过：`chatRef * 1.5` = -28.5，
      // 永远不等于任何量化后的整数，判据恒假）。
      const unitX = (1600 - 1600 / 2) / 50;
      const unitY = (900 - 900 / 2) / 50;
      // ── P3-3：① 组件身份只认 `data-composer-card` **属性**，且它只吃**自己的**距离（1.5%），
      //    与基准档（会话文本区 1.2%）不同 —— 这条是"输入卡片被当成会话文本区"那种回归的哨兵。
      //    （老写法里那条"在 className 里找 data-composer-card"的分支已按 P3-3 删掉；它永远
      //    不成立，删掉不改变任何可达形态 ⇒ 那个方向由源码结构那条判据钉。）
      //    ⚠️ 位移落在哪一层：`mkGroup` 给的出口已经是 `display: contents`（照宿主 ANCHOR_STYLE），
      //    所以 `parallaxGroupBox()` 会走过出口、把记录与位移都落在**父盒子上**
      //    （`packages/parallax/src/parallax-layer.js` 的 `parallaxGroupBox()`）⇒ 读数一律读 `.box` 的 `translate`，出口那份 props
      //    永远没有 translate（老腿里"出口无 translate"那条断言因此是恒真的，改读盒子才有牙）。
      const composerAttr = mkGroup({ 'data-composer-card': '' });
      docGroups.push(composerAttr.outlet);
      rescanTwice(1600, 900);
      const composerAttrNum = numOf(composerAttr.box);
      // ② 整组不动是"组里有 fixed 后代"这一条的功劳，**不是**"没认出组件身份"：同一个锚点先记下
      //    "确实一个位移都没有"，撤掉那个 fixed 后代后必须立刻拿到它自己的 1.5% 档。
      const composerBeforeNum = numOf(composerGroup.box);
      composerGroup.box.children = [];
      rescanTwice(1600, 900);
      const composerFixedGoneNum = numOf(composerGroup.box);
      // ── P3-1：超限组（>400 节点）在冷却窗内**一次都不再枚举**。老写法是"先整棵枚举、再看
      //    长度" ⇒ 每 250ms 一轮重扫都为一句"没验完"白付一次全量 `querySelectorAll('*')`。
      //    ⚠️ 假桩要挂在**盒子**上（真语义：`box.querySelectorAll('*')` 返回后代节点）。挂在出口上
      //    是挂错元素 ⇒ 计数恒 0、判据失去意义（踩过）。
      //    ⚠️ 锚点数组必须**真的超过** 400：没数出"太大"之前缓存写的是 `big:false`，那种组不会走
      //    冷却（踩过：喂 1 个节点 ⇒ 缓存 `big:false` ⇒ 冷却那侧恒 0）。
      const overNode = mkGroup({ 'data-composer-card': '' });
      const overKids = new Array(401).fill(null);
      let overCalls = 0;
      overNode.box.querySelectorAll = () => { overCalls += 1; return overKids; };
      docGroups.push(overNode.outlet);
      rescanTwice(1600, 900);
      const overCallsFirst = overCalls;
      const overClockFirst = clock;
      // 冷却窗（1000ms）内再推**一轮**重扫（+320ms）—— 一次都不许多数。这里的界是**保守**的：
      // 计数发生在"第一段重扫"里的某一刻，最坏情况距 `overClockFirst` 还有 640ms
      // （`rescan` = 16 × step(20) = 320ms，第一段 `rescanTwice` 有两轮）⇒ 这一刻距上次计数的
      // 最坏间隔 = 640 + 320 = 960ms < 1000ms，仍然落在冷却窗里。
      rescan(1601, 899);
      const overCallsSecond = overCalls;
      const overElapsedWithin = clock - overClockFirst;
      // 空转越过 1000ms 冷却后**必须**重新数一次（"子树缩回可验范围"要靠这一下被重新认到）。
      for (let i = 0; i < 53; i += 1) step(20);
      rescanTwice(1600, 900);
      const overCallsAfterCooldown = overCalls;
      const overElapsed = clock - overClockFirst;
      // ── P3-2：槽里的值必须走**同一个**取值器（`parallaxPluginDepth`）—— 缺键、非有限值、
      //    超范围三种形态各回一个确定结果，且"算屏上最大距离"与"算这一组系数"必须是**同一个**数。
      //    修复前的两个坑：① 非有限值一边算 0、一边算缺省 1 ⇒ `pctMax` 落到 0 触发"一次落位、
      //    收工"短路，整组缓动静默失效（屏上表现为瞬移）；② 超范围值只在一侧被钳到 10 的路径
      //    上表现不一致。这里三种形态并排比：非有限 = 缺键（都 = 缺省 1% = 基准组同距），
      //    超范围的 42 钳到 `PARALLAX_GROUP_DEPTH_MAX`(10%) ⇒ 位移正好是基准组的 10 倍。
      globalThis.selection.parallaxPlugin = true;
      globalThis.selection.parallaxPluginDepths = { '@audit/styled': 'not-a-number' };
      const styledNode = mkGroup({ 'data-slot': '@audit/styled' });
      const styledChild = mkTarget('we-plugin-card');
      styledChild.display = 'block';
      styledChild.children = [];
      styledChild.querySelectorAll = () => styledChild.children;
      styledChild.contains = () => false;
      styledChild.parentElement = styledNode.outlet;
      styledNode.outlet.children = [styledChild];
      styledNode.outlet.closest = () => null;
      docGroups.push(styledNode.outlet);
      const badDepthNode = mkGroup({ 'data-slot': 'audit.clamped' });
      const badDepthChild = mkTarget('we-plugin-card');
      badDepthChild.display = 'block';
      badDepthChild.children = [];
      badDepthChild.querySelectorAll = () => badDepthChild.children;
      badDepthChild.contains = () => false;
      badDepthChild.parentElement = badDepthNode.outlet;
      badDepthNode.outlet.children = [badDepthChild];
      badDepthNode.outlet.closest = () => null;
      docGroups.push(badDepthNode.outlet);
      globalThis.selection.parallaxPluginDepths['audit.clamped'] = 42;
      rescan(1600, 900);
      const badDepthNum = numOf(badDepthChild);
      const styledNum = numOf(styledChild);
      const badDepthListed = parallaxLayerMod.parallaxDiscoveredGroups();
      legacyDepthOut = { bad: badDepthNum, styled: styledNum, listed: badDepthListed };
      // 基准组必须还在动、且**真的是 1.2% 那一档**（`-19.2` 量化成 -19）—— 否则下面所有
      // "倍率"断言都会因为 `chatRef` 是 null 而落空。
      const baseOk = !!chatRef && chatRef.length === 2
        && chatRef[0] < 0 && chatRef[1] < 0
        && chatRef[0] === chatRef[1] * 16 / 9;
      // 钳制上界从层源码现读（`10`）—— 台上那份 `__src` 是模块源码，直接正则取，别抄常数。
      const depthMaxMatch = readFileSync(subParallaxFile('parallax-layer.js'), 'utf8')
        .match(/const PARALLAX_GROUP_DEPTH_MAX = (\d+);/);
      const depthMax = depthMaxMatch ? Number(depthMaxMatch[1]) : 10;
      composerAttrOk = baseOk && !!composerAttrNum
        && composerAttrNum[0] === -unitX * 1.5              // 自己的 1.5% 档（-24，精确）
        && Math.abs(composerAttrNum[1] + unitY * 1.5) <= 1  // -13.5 量化后 ±1
        && composerAttrNum[0] !== chatRef[0]                // ≠ 会话文本区那一档（1.2% ⇒ -19）
        && !composerBeforeNum                               // 带 fixed 后代时一个位移都没有
        && !!composerFixedGoneNum
        && composerFixedGoneNum[0] === -unitX * 1.5;         // 撤掉后立刻拿到 1.5% 档
      overScanOk = overCallsFirst >= 1 && overElapsedWithin < 1000
        && overCallsSecond === overCallsFirst
        && overCallsAfterCooldown > overCallsSecond && overElapsed > 1000;
      overScanOut = { first: overCallsFirst, second: overCallsSecond,
        after: overCallsAfterCooldown, within: overElapsedWithin, elapsed: overElapsed };
      badDepthOk = baseOk && !!badDepthNum && !!styledNum
        && styledNum[0] === -unitX && styledNum[1] === -unitY  // 非有限值 ⇒ 与缺键同距（1% 档）
        && badDepthNum[0] === -unitX * depthMax                // 超范围的 42 ⇒ 钳到上界
        && badDepthNum[1] === -unitY * depthMax
        && badDepthListed.indexOf('@audit/styled') >= 0
        && badDepthListed.indexOf('audit.clamped') >= 0;
      legacyDepthOut = { bad: badDepthNum, styled: styledNum, listed: badDepthListed,
        unit: [unitX, unitY], base: chatRef, depthMax,
        before: composerBeforeNum, attr: composerAttrNum, gone: composerFixedGoneNum };
    } catch (e) { threw = String((e && e.message) || e); } finally {
      globalThis.selection = PREV_SEL;
      globalThis.document = PREV_DOC;
      globalThis.window = PREV_WIN;
      globalThis.requestAnimationFrame = PREV_RAF;
      globalThis.cancelAnimationFrame = PREV_CAF;
      globalThis.getComputedStyle = PREV_GCS;
      setLocalStorage(PREV_LS);
      restoreWeBase();
    }
    check('parallax-layer.js 位移直接写在那几层自己的 translate 上 · body 只放补边系数 · 起帧提合成层到位摘 · 自检出帧统计 · 停用全收干净 · 界面组量化位移(带迟滞)/与壁纸同向/分档(四个区域距离各自生效)/气泡截尾/静止摘属性/fixed 后代整组不动/左栏走相对偏移不吃那条判定/槽出口没盒子就落父盒子/插件前端独立开关(默认关 · 只开它也能动)/嵌在原生组里的插件槽跟「界面元素跟随」那道闸走/插件槽没存过值也照样缓动/跨中线不跳变 · P3 三条:组件只认属性且吃自己的距离(撤掉 fixed 后代立刻拿到)/超限组冷却窗内一次都不重数/非有限槽值与缺键同距',
      !threw && movedOn && groupsOk && settled && centerCleared && dbgOk && hysteresisOk
        && regionsOk && pluginOk && pluginNestedOk && pluginSmoothOk && crossZeroOk && cleared
        && composerAttrOk && overScanOk && badDepthOk,
      threw || ('movedOn=' + movedOn + ' groups=' + groupsOk + ' settled=' + settled
        + ' center=' + centerCleared + ' dbg=' + dbgOk + ' hysteresis=' + hysteresisOk
        + ' regions=' + regionsOk + ' plugin=' + pluginOk + ' cleared=' + cleared
        + ' translate=' + layerEl.props['translate']
        + ' chat=' + chatGroup.box.props['translate'] + ' sidebar=' + sidebarGroup.box.props['left']
        + '/' + sidebarGroup.box.props['top'] + ' ' + sidebarGroup.box.props['position']
        + ' composer=' + composerGroup.box.props['translate'] + ' nested=' + nestedGroup.box.props['translate']
        + ' plugin=' + pluginChild.props['translate'] + ' outlet=' + pluginOutlet.props['translate']
        + ' 插件腿=' + pluginOffOk + '/' + pluginDefaultOk + ' 只开插件=' + pluginAloneOut
        + ' 与原生同距=' + pluginNumOut + ' 原生=' + chatNowOut
        // 新三条腿：嵌在原生组里的插件槽（两个方向）、插件槽缺省值的缓动、跨中线不跳。
        + ' 嵌进原生=' + pluginNestedOk + ' 插件缓动=' + pluginSmoothOk + ' 跨中线=' + crossZeroOk
        + ' 嵌套child=' + pluginNestedChild.props['translate'] + ' 插槽=' + pluginNestedOut
        + ' 首帧=' + firstFrameOut + ' 过零=' + crossSeqOut + ' 槽名单(关界面)=' + slotsOut
        + ' 槽名单(开界面)=' + slotsOutOn
        // P3 三条腿：组件身份认属性 + 只吃自己的距离 / 超限组冷却窗内不重数 / 非有限槽值同一兜底。
        + ' 组件档位=' + composerAttrOk + ' 超限组重数=' + overScanOk + JSON.stringify(overScanOut)
        + ' 槽值一致=' + badDepthOk + JSON.stringify(legacyDepthOut)));
  }
  {
    // 三号模块的岛：注册表项形状 + 「关着只画总开关、开着才画 3 个参数」这条可见行为。
    // 与另两个模块同一张注册表 ⇒ id 必须唯一（'parallax'），title/desc 取的就是译文。
    // 单独 import 时 `PARALLAX_PLUGIN_DEFAULT` / `PARALLAX_GROUP_DEPTH_MIN` / `PARALLAX_GROUP_DEPTH_MAX`
    // 在**构建期**是同一作用域的兄弟模块符号（packages/parallax/src/parallax-layer.js 里那三枚）⇒ 按内联规则补替身。
    // 缺省值有导出、直接取层本尊；钳制范围那一对层**不导出** ⇒ 从层源码里现读（`const NAME = N;`，
    // 顺手把"面板回显的范围就是层那一对常量"钉住），值都是现取的、这里不抄数。
    const PREV_PLUGIN_DEFAULT = globalThis.PARALLAX_PLUGIN_DEFAULT;
    globalThis.PARALLAX_PLUGIN_DEFAULT = parallaxLayerMod.PARALLAX_PLUGIN_DEFAULT;
    const parSrcIsland = readFileSync(subParallaxFile('parallax-layer.js'), 'utf8');
    const parConstNum = (name) => {
      const m = new RegExp('const ' + name + ' = (-?\\d+(?:\\.\\d+)?);').exec(parSrcIsland);
      return m ? Number(m[1]) : NaN;
    };
    const PREV_DEPTH_MIN = globalThis.PARALLAX_GROUP_DEPTH_MIN;
    const PREV_DEPTH_MAX = globalThis.PARALLAX_GROUP_DEPTH_MAX;
    globalThis.PARALLAX_GROUP_DEPTH_MIN = parConstNum('PARALLAX_GROUP_DEPTH_MIN');
    globalThis.PARALLAX_GROUP_DEPTH_MAX = parConstNum('PARALLAX_GROUP_DEPTH_MAX');
    const ctxOf = (sel, slots) => ({
      sel,
      onParallaxEnabled: () => {}, onParallaxBg: () => {},
      onParallaxMascot: () => {}, onParallaxSmooth: () => {},
      onParallaxUi: () => {}, onParallaxPlugin: () => {}, onParallaxPluginDepth: () => {},
      onParallaxUiChatDepth: () => {}, onParallaxUiComposerDepth: () => {},
      onParallaxUiSidebarDepth: () => {}, onParallaxUiBubbleDepth: () => {},
      // 「插件前端」那一组画什么**完全由运行期名单决定**（src/client.js 从层里取、与层同源）。
      parallaxPluginSlots: slots,
    });
    // 「插件前端」那一张卡永远有自己的开关（用户诉求 m03549），但它的**行**再多等两个条件：
    // 那个开关开着 + 运行期真的认到了别的插件的槽位（认到几个画几行）。原生前端那五行同理，
    // 等的是「界面元素跟随」——两张卡、两个开关，互不依赖（下面 `onPlugin` 那一腿就是反向）。
    const PARAMS = ['背景缓动距离', '吉祥物跟随', '界面元素跟随', '插件前端跟随', '缓动平滑'];
    const UI_PARAMS = ['背景缓动距离', '吉祥物跟随', '界面元素跟随',
      '会话文本区距离', '输入卡片距离', '侧栏距离', '用户气泡距离', '插件前端跟随', '缓动平滑'];
    // 只开插件那一块（界面跟随关着）时该长出来的：三类开关都在，插件行也在，而**四个区域距离一个都没有**。
    const PLUGIN_PARAMS = ['背景缓动距离', '吉祥物跟随', '界面元素跟随', '插件前端跟随'];
    const SLOT_A = 'dshmarket.panel';
    const SLOT_B = '@linxin666/dsh-client-ui-task-board';
    const off = labelSeq(extParallaxMod.renderParallaxIsland(ctxOf(schemaMod.DEFAULTS)));
    const on = labelSeq(extParallaxMod.renderParallaxIsland(
      ctxOf(Object.assign({}, schemaMod.DEFAULTS, { parallaxEnabled: true }))));
    const onUi = labelSeq(extParallaxMod.renderParallaxIsland(
      ctxOf(Object.assign({}, schemaMod.DEFAULTS, { parallaxEnabled: true, parallaxUi: true }))));
    // 界面跟随开着、插件开关关着（名单照给）⇒ 插件那几行**一个都不许出现**（层那时也不认它们）。
    const onUiSlots = labelSeq(extParallaxMod.renderParallaxIsland(
      ctxOf(Object.assign({}, schemaMod.DEFAULTS, { parallaxEnabled: true, parallaxUi: true }),
        [SLOT_A, SLOT_B])));
    // 只开插件那一块 ⇒ 插件行照画（证明它不依赖「界面元素跟随」）。
    const onPlugin = labelSeq(extParallaxMod.renderParallaxIsland(
      ctxOf(Object.assign({}, schemaMod.DEFAULTS, { parallaxEnabled: true, parallaxPlugin: true }),
        [SLOT_A, SLOT_B])));
    const mod = extParallaxMod.PARALLAX_EXTENSION_MODULE;
    const extParSrc = readFileSync(subParallaxFile('ext-parallax.js'), 'utf8');
    const wantOff = [globalThis.weT('启用 3D 效果')];
    const wantOn = wantOff.concat(PARAMS.map((k) => globalThis.weT(k)));
    const wantOnUi = wantOff.concat(UI_PARAMS.map((k) => globalThis.weT(k)));
    // 插件行用**槽名本身**当标签（那不是译文，原样画）；「缓动平滑」永远排在最后。
    const wantOnPlugin = wantOff.concat(PLUGIN_PARAMS.map((k) => globalThis.weT(k)))
      .concat([SLOT_A, SLOT_B], [globalThis.weT('缓动平滑')]);
    // 越界值那条路径也要能跑通：存档里只有手改 settings.json / 跨版本 / 第三方塞值才会出现 42 / -5，
    // 面板那一行会走 `Math.min(PARALLAX_GROUP_DEPTH_MAX, Math.max(PARALLAX_GROUP_DEPTH_MIN, n))`（审计 #2，
    // 回显的数字必须就是层真正生效的数字）—— 少了上面那对替身这里会当场 ReferenceError，而只钉源码
    // 引脚看不出这一层。行数与顺序照旧（值被钳掉不影响"画几行"）。
    const outOfRange = labelSeq(extParallaxMod.renderParallaxIsland(
      ctxOf(Object.assign({}, schemaMod.DEFAULTS, {
        parallaxEnabled: true, parallaxPlugin: true, parallaxPluginDepths: { [SLOT_A]: 42, [SLOT_B]: -5 },
      }), [SLOT_A, SLOT_B])));
    check('ext-parallax.js 可单独 import · 注册表项形状 · 关着只画总开关、开了才画参数（原生前端那五行等「界面元素跟随」、插件前端那几行等它自己的开关 + 运行期名单）',
      Boolean(mod) && mod.id === 'parallax' && mod.render === extParallaxMod.renderParallaxIsland
      && typeof mod.title === 'string' && mod.title === globalThis.weT('3D 效果')
      && typeof mod.desc === 'string' && mod.desc.length > 0
      // 模块自己不许写设置 / 发通知 / 持有状态：动作一律经 ctx 里的具名处理器。
      && !extParSrc.includes('setSetting') && !extParSrc.includes('emit(')
      && !extParSrc.includes('commitLiveSetting')
      && off.join('|') === wantOff.join('|') && on.join('|') === wantOn.join('|')
      && onUi.join('|') === wantOnUi.join('|')
      && onUiSlots.join('|') === wantOnUi.join('|')
      && onPlugin.join('|') === wantOnPlugin.join('|')
      && outOfRange.join('|') === wantOnPlugin.join('|'),
      'off=' + off.length + ' on=' + on.length + ' onUi=' + onUi.length
        + ' onUiSlots=' + onUiSlots.length + ' onPlugin=' + onPlugin.length
        + ' outOfRange=' + outOfRange.length
        + ' [' + on.join('|') + '] [' + onUi.join('|') + '] [' + onUiSlots.join('|') + '] ['
        + onPlugin.join('|') + ']');
    // 四个区域距离的**单位口径**（用户裁决 m02697-①："最大缓动距离占屏幕对角线长度的百分比"）：
    // 存档与面板**从此同一个单位**（0..10 / 步长 0.1，真源 = lib/settings-schema.js 的 KINDS）⇒
    // 面板不再 ×100、src/client.js 那一侧也不再 ÷100（与「暗化」「边框」那条旧口径分道扬镳）；
    // 单位仍用**裸** "%"（裸单位才有拖动期就地回显，预格式化整串拖动期数字不跟手）。
    const clientSrcPar = readFileSync(join(root, 'src', 'client.js'), 'utf8');
    const pctRows = ['Chat', 'Composer', 'Sidebar', 'Bubble'].map((name) => ({
      args: ', 0, 10, 0.1, sel.parallaxUi' + name + 'Depth, onParallaxUi' + name + 'Depth',
      unit: '"%", "parallax-ui-' + name.toLowerCase() + '-depth"',
      write: 'commitLiveSetting("parallaxUi' + name + 'Depth", v, live)',
      writeOld: 'commitLiveSetting("parallaxUi' + name + 'Depth", v / 100, live)',
    }));
    check('ext-parallax.js 四个区域距离存的就是百分比（0..10 / 0.1，与 KINDS 同域）· 回写直写 v（不再 ×100 / ÷100）',
      pctRows.every((r) => extParSrc.includes(r.args) && extParSrc.includes(r.unit)
        && clientSrcPar.includes(r.write) && !clientSrcPar.includes(r.writeOld))
      // 老口径整条消失：面板不再拿倍率算百分比，就再没有 ×100 / Math.round 那一层。
      && !extParSrc.includes('* 100') && !extParSrc.includes('Math.round(sel.parallaxUi')
      && !clientSrcPar.includes('parallaxUiChatDepth", v / 100')
      && !extParSrc.includes('preformatted'),
      pctRows.map((r) => (extParSrc.includes(r.args) ? '1' : '0')
        + (extParSrc.includes(r.unit) ? '1' : '0')
        + (clientSrcPar.includes(r.write) ? '1' : '0')).join('/'));
    // 插件槽位那一行**没存过值**时必须回显层的缺省（1%），显式 0 要显示成 0 —— 0 是"这一组不缓动"，
    // 与"没调过"是两件事（用户裁决 m02697-③）。这里只钉源码口径（本文件的 SliderRow 替身只留标签、
    // 吞掉 value；值本身的口径在 test/verify-client.mjs 那边按带 value 的替身判）。
    check('ext-parallax.js 插件槽位回显按层的缺省走（没存过值 ⇒ PARALLAX_PLUGIN_DEFAULT、显式 0 保留）· 越界值按层同一对常量钳制',
      extParSrc.includes('function parallaxPluginPercent(v)')
      && extParSrc.includes('if (v === null || v === undefined || v === "" || !Number.isFinite(n)) return PARALLAX_PLUGIN_DEFAULT;')
      && extParSrc.includes('parallaxPluginPercent(depths[slot])')
      // 审计 #2：回显的钳制范围读的是层那一对常量（层按 [MIN, MAX] 生效 ⇒ 面板不能照原样显示 42%）。
      && extParSrc.includes('return Math.min(PARALLAX_GROUP_DEPTH_MAX, Math.max(PARALLAX_GROUP_DEPTH_MIN, n));')
      && parSrcIsland.includes('const PARALLAX_GROUP_DEPTH_MIN = 0;')
      && parSrcIsland.includes('const PARALLAX_GROUP_DEPTH_MAX = 10;')
      && globalThis.PARALLAX_GROUP_DEPTH_MIN === 0 && globalThis.PARALLAX_GROUP_DEPTH_MAX === 10
      // 名单与动作都从 ctx 来（模块自己不查 DOM、不读 selection、不写设置）——注册表契约。
      && extParSrc.includes('parallaxPluginSlots')
      && extParSrc.includes('onParallaxPluginDepth(slot, v, live)')
      && !extParSrc.includes('querySelectorAll'));
    // 「插件前端」那一整块**有自己的开关**（用户诉求 m03549；裁决 = 独立开关、默认关）：
    // 三条边都要钉住 —— ①面板那一卡先画自己的开关、行与提示只等它（不是等「界面元素跟随」）；
    // ②动作经 ctx 的具名处理器回到 src/client.js（模块自己不写设置）；③设置真源里那个键默认 false。
    check('ext-parallax.js / client.js / settings-schema.js 插件前端有自己的开关（独立于界面跟随 · 默认关）',
      extParSrc.includes('const pluginOn = on && sel.parallaxPlugin === true;')
      && extParSrc.includes('const slots = pluginOn && Array.isArray(parallaxPluginSlots) ? parallaxPluginSlots : [];')
      && extParSrc.includes('switchRow(weT("插件前端跟随"), sel.parallaxPlugin === true, onParallaxPlugin,')
      && extParSrc.includes('pluginOn && (slots.length')
      && extParSrc.includes('pluginOn && slots.map(')
      // 反向：插件那几行不再挂在「界面元素跟随」上（老写法 `ui &&`）。
      && !extParSrc.includes('ui && (slots.length') && !extParSrc.includes('ui && slots.map(')
      && clientSrcPar.includes('function onParallaxPlugin(e) { setSetting("parallaxPlugin", e.target.checked); emit(); }')
      // 名单与"真的会动"同源：开关关着 ⇒ 连名单都不给（面板于是画不出行，也不会画完却一动不动）。
      && clientSrcPar.includes('parallaxPluginSlots: sel.parallaxPlugin === true ? weDiscoveredGroupsOf(\'parallax\').sort() : [],')
      && schemaMod.DEFAULTS.parallaxPlugin === false
      && schemaMod.KINDS.parallaxPlugin.kind === 'boolFalse',
      'island=' + (extParSrc.includes('const pluginOn = on && sel.parallaxPlugin === true;') ? '1' : '0')
        + (extParSrc.includes('switchRow(weT("插件前端跟随"), sel.parallaxPlugin === true, onParallaxPlugin,') ? '1' : '0')
        + (extParSrc.includes('pluginOn && slots.map(') ? '1' : '0')
        + ' client=' + (clientSrcPar.includes('function onParallaxPlugin(e)') ? '1' : '0')
        + ' schema=' + String(schemaMod.DEFAULTS.parallaxPlugin) + '/' + schemaMod.KINDS.parallaxPlugin.kind);
    if (PREV_PLUGIN_DEFAULT === undefined) delete globalThis.PARALLAX_PLUGIN_DEFAULT;
    else globalThis.PARALLAX_PLUGIN_DEFAULT = PREV_PLUGIN_DEFAULT;
    if (PREV_DEPTH_MIN === undefined) delete globalThis.PARALLAX_GROUP_DEPTH_MIN;
    else globalThis.PARALLAX_GROUP_DEPTH_MIN = PREV_DEPTH_MIN;
    if (PREV_DEPTH_MAX === undefined) delete globalThis.PARALLAX_GROUP_DEPTH_MAX;
    else globalThis.PARALLAX_GROUP_DEPTH_MAX = PREV_DEPTH_MAX;
  }

  // ── 自定义会话头像（「扩展」页签一号模块）的两半：装饰层 + 扩展岛 ────────────────
  // 这一层的判据口径与视差层相反：它**要**建节点（往宿主的消息行里插），但无头沙箱里
  // 连 `document` 都没有 ⇒ 一半靠"零抛错零副作用"（开着也不许炸），一半靠**源码口径**
  // 把"只碰哪几类消息行 / 关掉怎么回原生 / 名字从哪来 / 观察者怎么早退"逐条钉住。
  const avatarLayerMod = await import(pathToFileURL(join(root, 'src', 'avatar-layer.js')).href);
  const extAvatarMod = await import(pathToFileURL(join(root, 'src', 'ext-avatar.js')).href);
  {
    const PREV_SEL = globalThis.selection;
    const restoreWeBase = stubWeBase();
    // 单独 import 时这两枚在**构建期**是同一作用域的兄弟模块符号（src/api-client.js 的
    // apiUrl、src/avatar-layer.js 的默认名/头像几何）⇒ 按内联规则补替身。
    const PREV_API_URL = globalThis.apiUrl;
    globalThis.apiUrl = (p) => '/wallpaper-engine' + String(p || '');
    let threw = '';
    let pure = '';
    try {
      // ① 开着 ⇒ 没有 document / MutationObserver，整段守卫应当直接返回
      globalThis.selection = { avatarEnabled: true };
      avatarLayerMod.syncAvatarLayer();
      // ② 越界的设置值 ⇒ 钳位路径（24..72 / 0..100 之外不许算出天量尺寸或负半径）
      globalThis.selection = { avatarEnabled: true, avatarSize: 9999, avatarRadius: -5 };
      avatarLayerMod.syncAvatarLayer();
      // ③ 关掉 ⇒ stop 分支；卸载幂等
      globalThis.selection = { avatarEnabled: false };
      avatarLayerMod.syncAvatarLayer();
      avatarLayerMod.disposeAvatarLayer();
      // ④ 纯函数面：没设置过图片 ⇒ 空串（面板与层共用这一条 URL 构造）；设置过 ⇒ 带 side 的路由
      globalThis.selection = {};
      const urlEmpty = avatarLayerMod.avatarImageUrl('user');
      globalThis.selection = { avatarUserImage: 'user-abc12.png' };
      const urlSet = avatarLayerMod.avatarImageUrl('user');
      if (!(urlEmpty === '' && urlSet.includes('/avatar/user'))) {
        pure = 'urlEmpty=' + JSON.stringify(urlEmpty) + ' urlSet=' + urlSet;
      }
    } catch (e) { threw = String((e && e.message) || e); } finally {
      globalThis.selection = PREV_SEL;
      if (PREV_API_URL === undefined) delete globalThis.apiUrl; else globalThis.apiUrl = PREV_API_URL;
      restoreWeBase();
    }
    check('avatar-layer.js 可单独 import · 导出面固定 · 无 DOM 环境零抛错零副作用 · 纯函数面（URL 构造）',
      Object.keys(avatarLayerMod).sort().join(',')
        === 'avatarImageUrl,disposeAvatarLayer,renderAvatarGlyph,syncAvatarLayer'.split(',').sort().join(',')
      && typeof avatarLayerMod.syncAvatarLayer === 'function'
      && typeof avatarLayerMod.disposeAvatarLayer === 'function'
      && !threw && !pure, threw || pure);
    {
      // ── 超限提示行：**跑真渲染器**看它到底画出什么文本（#185 后续）──────────────────
      // 为什么值得单独一条：三个占位符（{w}/{h}/{mb}）由 `weT` 的**第二个实参**替换 ——
      // 漏传时屏上会原样显示 "{w}×{h}"，而 i18n 守卫只对账"占位符集合一致"、看不出这个。
      // 渲染器是纯函数（读 sel、返回 React 元素树），所以这里能直接调它、遍历树取文本。
      const PREV_REACT = globalThis.React;
      const restoreWeBase2 = stubWeBase();
      const stubs2 = {
        apiUrl: (p) => '/wallpaper-engine' + String(p || ''),
        avatarImageUrl: () => '', renderAvatarGlyph: () => null,
        switchRow: () => null, SliderRow: () => null, ctlText: () => null,
        // ⚠️ `humanMb` 给**真实现**（不是替身）：它就是超限文案里那句 "{mb}" 的格式化器，
        // 替身会让"这个函数在产物里根本不存在"这种缺陷溜过去（ext-avatar 只在超限时调它，
        // 别的用例喂的是没有超限的 sel ⇒ 那条路覆盖不到）。
        humanMb: (await import(pathToFileURL(join(root, 'src', 'avatar-import.js')).href)).humanMb,
      };
      const prevFns = {};
      for (const k of Object.keys(stubs2)) { prevFns[k] = globalThis[k]; globalThis[k] = stubs2[k]; }
      for (const k of ['AVATAR_SIZE_MIN', 'AVATAR_SIZE_MAX', 'AVATAR_RADIUS_MIN', 'AVATAR_RADIUS_MAX']) {
        prevFns[k] = globalThis[k]; globalThis[k] = schemaMod[k];
      }
      try {
        // 极简 React 替身：只要 createElement 把 props/children 原样装成可遍历的树即可。
        globalThis.React = {
          createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
          Fragment: 'Fragment',
        };
        // 遍历替身树收集全部文本节点。⚠️ **迭代式、不用递归**：本文件跑在一条已经很深的
        // 调用链上（顶层 await → 一堆 check 闭包），递归版实测**偶发**把 V8 的栈顶爆掉
        // （`v8::String::Utf8Value::~Utf8Value` 那种崩法，退出码还随机会不同）——
        // 只递归进 children、不碰 props，深度由渲染树决定但仍是外部输入。
        const textsOf = (root) => {
          const acc = [];
          const stack = [root];
          while (stack.length) {
            const n = stack.pop();
            if (typeof n === 'string') { acc.push(n); continue; }
            if (Array.isArray(n)) { for (const x of n) stack.push(x); continue; }
            if (!n || typeof n !== 'object') continue;
            if (Array.isArray(n.children)) for (const x of n.children) stack.push(x);
          }
          return acc;
        };
        const islandCtx = (sel) => ({
          sel,
          onAvatarEnabled: () => {}, onAvatarSize: () => {}, onAvatarRadius: () => {},
          onAvatarPick: () => {}, onAvatarClear: () => {}, onAvatarAutoCompress: () => {},
        });
        const exceeded = Object.assign({}, schemaMod.DEFAULTS, {
          avatarEnabled: true,
          avatarOverflow: {
            side: 'user', bytes: 12.5 * 1024 * 1024, width: 4096, height: 3072,
            overBytes: true, overEdge: true,
          },
        });
        const flat = textsOf(extAvatarMod.renderAvatarIsland(islandCtx(exceeded))).join(' ');
        const nodes = textsOf(extAvatarMod.renderAvatarIsland(islandCtx(exceeded)));
        // ⚠️ 必须用**整节点相等**而不是子串：那句总说明里本来就写着"可选择自动压缩后导入"
        //（解释这个功能是怎么工作的），子串匹配会把说明当成按钮 ⇒ 负对照永远失败。
        const hasAutoCompress = nodes.some((t) => t === '自动压缩后导入');
        // 三个占位符都不许以原样出现在文本里（漏传实参的典型形态）。
        const noRawPlaceholder = !/\{w\}|\{h\}|\{mb\}/.test(flat);
        // 实测值必须真的插进去了（4096 / 3072 / 12.5 MB）。
        const interpolated = flat.includes('4096') && flat.includes('3072') && flat.includes('12.5 MB');
        // 负对照：同一个渲染器喂"没有超限"的 sel ⇒ 这一行整个不画（判据不是恒真）。
        const plainSel = Object.assign({}, schemaMod.DEFAULTS, { avatarEnabled: true, avatarOverflow: null });
        const noneNodes = textsOf(extAvatarMod.renderAvatarIsland(islandCtx(plainSel)));
        const noneFlat = noneNodes.join(' ');
        check('#185 超限提示行：占位符真的插了值（不出现裸 {w}/{h}/{mb}）+ 「自动压缩后导入」按钮在场',
          hasAutoCompress && noRawPlaceholder && interpolated,
          'btn=' + hasAutoCompress + ' noRaw=' + noRawPlaceholder + ' interpolated=' + interpolated
          + ' | ' + flat.slice(0, 120));
        check('negative control: 没有超限信息时这一行整个不画（同一条判据不是恒真）',
          noneNodes.length > 0 && !noneNodes.some((t) => t === '自动压缩后导入'),
          'noneLen=' + noneFlat.length);
      } finally {
        if (PREV_REACT === undefined) delete globalThis.React; else globalThis.React = PREV_REACT;
        for (const k of Object.keys(prevFns)) {
          if (prevFns[k] === undefined) delete globalThis[k]; else globalThis[k] = prevFns[k];
        }
        restoreWeBase2();
      }
    }
    // 源码口径：这一层的要点全是"看不见的形态"或"只准碰哪几类行"。逐条钉住，改坏了当场红。
    const avSrc = readFileSync(join(root, 'src', 'avatar-layer.js'), 'utf8');
    // 收窄导出面（task-17 第 56 条）：`avatarGlyphSvgString` 零跨模块按名引用 ⇒ 只删导出面。
    // 它是内置默认头像的**几何真源**（:107 声明，:164 内部使用）⇒ 本体与用法必须仍在；
    // 否则后人会把它当死代码连声明一起清掉，默认头像静默变成空 glyph。
    check('avatar-layer.js 内置头像几何（avatarGlyphSvgString）仍存在且仍被内部使用 —— 本刀只收导出面',
      avSrc.includes('function avatarGlyphSvgString(side, size) {')
      && avSrc.includes('glyph.innerHTML = avatarGlyphSvgString(side, 16);'),
      'decl=' + (avSrc.includes('function avatarGlyphSvgString(side, size) {') ? '1' : '0')
        + ' use=' + (avSrc.includes('glyph.innerHTML = avatarGlyphSvgString(side, 16);') ? '1' : '0'));
    check('avatar-layer.js 只认三类消息行 + 关掉逐字节回原生 + 名字（默认取模型名）+ 观察者两级早退 + 不写设置',
      // ① 只给 user / steering / assistant-step 补头像（工具调用、思考、压缩标记一律不碰）。
      avSrc.includes("const AVATAR_FLOW_SIDES = { user: 'user', steering: 'user', 'assistant-step': 'ai' };")
      && avSrc.includes(`const AVATAR_ROW_SELECTOR = '[data-chat-flow-kind="user"], [data-chat-flow-kind="steering"], [data-chat-flow-kind="assistant-step"]';`)
      && avSrc.includes("const AVATAR_ROW_ATTR = 'data-we-avatar-row';")
      && avSrc.includes("const AVATAR_NODE_ATTR = 'data-we-avatar-node';")
      // ② 开关属性与两个观感变量（样式段读它们；尺寸/圆角靠变量替换 ⇒ 拖滑块不重建节点）。
      && avSrc.includes("const AVATAR_ATTR = 'data-we-avatar';")
      && avSrc.includes("const AVATAR_VAR_SIZE = '--we-avatar-size';")
      && avSrc.includes("const AVATAR_VAR_ROUND = '--we-avatar-round';")
      // ③ **昵称整体移除**（用户口径："加了昵称太丑了"）：装饰层里不得再有名字节点、
      //    模型名读取或那套选择器 —— 加回来就是又背上一条对官方输入框的 DOM 依赖。
      && !avSrc.includes('__name') && !avSrc.includes('avatarDisplayName')
      && !avSrc.includes('avatarModelName') && !avSrc.includes('_triggerLabel')
      && !avSrc.includes('conversation.input.model')
      // ④ 关掉 = 逐字节回原生：撤开关属性与两个变量、摘掉全部注入节点与行标记、断观察者。
      && avSrc.includes('avatarObserver.disconnect()')
      && avSrc.includes('body.removeAttribute(AVATAR_ATTR)')
      && avSrc.includes('body.style.removeProperty(AVATAR_VAR_SIZE)')
      && avSrc.includes('body.style.removeProperty(AVATAR_VAR_ROUND)')
      && avSrc.includes("nodes = document.querySelectorAll('[' + AVATAR_NODE_ATTR + ']')")
      && avSrc.includes("rows = document.querySelectorAll('[' + AVATAR_ROW_ATTR + ']')")
      && avSrc.includes('row.removeAttribute(AVATAR_ROW_ATTR)')
      // ⑤ 观察者两级早退：新增元素先判"是不是消息行"，再判"是不是已经在装饰过的行里"——
      //    流式输出每帧都在插节点，第二级把开销钉在一次 closest 上。
      && avSrc.includes("n.closest('[' + AVATAR_ROW_ATTR + ']')")
      && avSrc.includes("typeof MutationObserver !== 'function'")
      // ⑥ 只读 selection：一个字节都不写（写设置只发生在 client.js 的具名处理器里）。
      && !avSrc.includes('setSetting') && !avSrc.includes('persistSelection')
      && !avSrc.includes('commitLiveSetting') && !avSrc.includes('emit()')
      // ⑦ 头像插到行的最前面：助手行 row（左）、用户行 row-reverse（右），一份插入顺序同时满足两侧。
      && avSrc.includes('row.insertBefore(node, row.firstChild)'),
      'avatar-layer = 会话 DOM 装饰层：三类行 + 回原生 + 无昵称 + 两级早退 + 只读');
  }
  {
    // 一号模块的岛：注册表项形状 + 「关着只画总开关、开着才画两方各行 + 两个滑块」这条可见行为。
    // ⚠️ 挂载台里 SliderRow / ctlText 是标签替身 ⇒ 这里判的是**标签的有序序列**；
    //    两个滑块的量程（24..72 / 0..100）由 verify-client 在真渲染树上判（那边有真控件）。
    const ctxOf = (sel) => ({
      sel,
      onAvatarEnabled: () => {}, onAvatarSize: () => {}, onAvatarRadius: () => {},
      onAvatarPick: () => {}, onAvatarClear: () => {},
    });
    const PARAMS = ['「我」的头像', '「助手」的头像', '头像大小', '圆角强度'];
    // 岛的取值面跨了三个模块：schema 的四个常量（滑块范围 / 昵称上限）+ 头像层的三枚
    // （URL / 默认名 / 默认头像几何）⇒ 单独 import 时补替身（同 ext-fx 那块对
    // FX_BLEND_VALUES 的处理）。
    const STUB_KEYS = ['AVATAR_SIZE_MIN', 'AVATAR_SIZE_MAX', 'AVATAR_RADIUS_MIN', 'AVATAR_RADIUS_MAX',
      'avatarImageUrl', 'renderAvatarGlyph'];
    const PREV_STUBS = {};
    for (const k of STUB_KEYS) PREV_STUBS[k] = globalThis[k];
    Object.assign(globalThis, {
      AVATAR_SIZE_MIN: schemaMod.AVATAR_SIZE_MIN, AVATAR_SIZE_MAX: schemaMod.AVATAR_SIZE_MAX,
      AVATAR_RADIUS_MIN: schemaMod.AVATAR_RADIUS_MIN, AVATAR_RADIUS_MAX: schemaMod.AVATAR_RADIUS_MAX,
      avatarImageUrl: avatarLayerMod.avatarImageUrl,
      renderAvatarGlyph: avatarLayerMod.renderAvatarGlyph,
    });
    let off = [];
    let on = [];
    let islandThrew = '';
    try {
      off = labelSeq(extAvatarMod.renderAvatarIsland(ctxOf(schemaMod.DEFAULTS)));
      on = labelSeq(extAvatarMod.renderAvatarIsland(
        ctxOf(Object.assign({}, schemaMod.DEFAULTS, { avatarEnabled: true }))));
      // 坏值路径也走一遍：`NaN` / `undefined` 的尺寸必须落回**本文件里的**兜底常量，而不是
      // 撞上一个只在产物作用域里存在的名字 —— "单文件 import 时 ReferenceError"这类缺陷
      // 只有这样才现形（第一版就是这么栽的：兜底常量跟着改名，引用没跟上）。
      extAvatarMod.renderAvatarIsland(ctxOf(Object.assign({}, schemaMod.DEFAULTS,
        { avatarEnabled: true, avatarSize: NaN, avatarRadius: undefined })));
    } catch (e) { islandThrew = String((e && e.message) || e); } finally {
      for (const k of STUB_KEYS) {
        if (PREV_STUBS[k] === undefined) delete globalThis[k]; else globalThis[k] = PREV_STUBS[k];
      }
    }
    const mod = extAvatarMod.AVATAR_EXTENSION_MODULE;
    const extAvSrc = readFileSync(join(root, 'src', 'ext-avatar.js'), 'utf8');
    const wantOff = [globalThis.weT('启用自定义会话头像')];
    const wantOn = wantOff.concat(PARAMS.map((k) => globalThis.weT(k)));
    check('ext-avatar.js 可单独 import · 注册表项形状 · 关着只画总开关、开着才画两方各行与两个滑块',
      Boolean(mod) && mod.id === 'avatar' && mod.render === extAvatarMod.renderAvatarIsland
      && typeof mod.title === 'string' && mod.title === globalThis.weT('自定义会话头像')
      && typeof mod.desc === 'string' && mod.desc.length > 0
      // 模块自己不许写设置 / 发通知 / 持有状态：动作一律经 ctx 里的具名处理器
      //（文件选择器那种一次性 DOM 副作用也不许在这里造 —— 归 client.js 的 onAvatarPick）。
      && !extAvSrc.includes('setSetting') && !extAvSrc.includes('emit(')
      && !extAvSrc.includes('commitLiveSetting') && !extAvSrc.includes('document.createElement')
      && off.join('|') === wantOff.join('|') && on.join('|') === wantOn.join('|'),
      islandThrew || ('off=' + off.length + ' on=' + on.length + ' [' + on.join('|') + ']'));
    // 两个滑块的范围必须读 schema 的真源（写死数字 = 改一处忘一处）；
    // 同时钉住"昵称已移除"：这一页不得再长出文本输入或名字行。
    check('ext-avatar.js 两个滑块的范围取自 schema 常量（AVATAR_SIZE_* / AVATAR_RADIUS_*）· 无昵称残留',
      /AVATAR_SIZE_MIN,\s*AVATAR_SIZE_MAX/.test(extAvSrc)
      && /AVATAR_RADIUS_MIN,\s*AVATAR_RADIUS_MAX/.test(extAvSrc)
      && !extAvSrc.includes('昵称') && !extAvSrc.includes('avatarName')
      && !extAvSrc.includes('AVATAR_NAME_MAX') && !extAvSrc.includes('type: "text"'));
    // 排布落在样式表上：那一段必须（a）整段挂在开关属性下、（b）用户行反过来（头像在右）、
    // （c）消息内容那一格可伸缩（否则长消息会把头像挤出可视区）、（d）不得再有名字行。
    // 刀3：样式族取整族源码文本（8 个域模块 + 组装点，构建序拼接）；下面的锚点与切片不变。
    const stylesSrcAv = styleText();
    const avCssAt = stylesSrcAv.indexOf('「扩展」页签一号模块');
    const avCss = avCssAt < 0 ? '' : stylesSrcAv.slice(avCssAt, stylesSrcAv.indexOf('「扩展」二号模块', avCssAt));
    // 断言一律打在**剥注释**的样式文本上：注释里写着锚点与 display: contents 这些词，
    // 不剥的话注释本身就能把这几个 includes 喂饱（判据会假绿）。剥注释走共享的**字符串感知**
    // 实现（`test/tools/js-text.mjs`），不用朴素块注释正则 —— 本仓 ADR-0006 规则 ⑦ 由
    // test/verify-module-layout.mjs 钉住（那份判据扫 test/** 与 src/** 里的源码文本）。
    // 切片从段头**注释**中间开始（锚点是「扩展」页签一号模块 这行注释），所以先从第一条真规则
    // 起切：否则注释里那些 CSS 词会以"代码"身份活着，负对照（不许给锚点写 display:）会被自己的
    // 说明喂饱。（尾部那段未闭合的注释由共享实现照未终止块注释处理。）
    const avRulesAt = avCss.indexOf('body[data-we-avatar="on"]');
    const avCssBare = stripComments(avRulesAt < 0 ? avCss : avCss.slice(avRulesAt)).replace(/\s+/g, ' ');
    // 「消息格可伸缩」那条规则必须**同时**覆盖直挂内容与槽出口锚点后面那一层：宿主给
    // `div[data-slot="conversation.chat.node"]` 写死内联 `display: contents`（没有盒子 ⇒
    // 既不是 flex item 也不接受 flex 属性），只写直挂那一半就是打在空气上——内容根退回
    // 默认 flex item、主轴尺寸按 max-content 算；宿主给收起态的思考行写死 `contain: size layout`
    // （固有尺寸 = 0）⇒ 一行只剩"思考"折叠行时整条消息宽 0px（issue #154）。
    // 这条钉法故意要求"两条选择器、一条声明块"：少写锚点那半条就红。
    const AV_GROW_RULE = /body\[data-we-avatar="on"\] \[data-we-avatar-row\] > :not\(\.we-avatar\), body\[data-we-avatar="on"\] \[data-we-avatar-row\] > \[data-slot\] > :not\(\.we-avatar\) \{ flex: 1 1 auto; min-width: 0; \}/;
    check('styles.js 头像段：开关属性下才生效 · 用户行反过来 · 消息格穿透槽出口锚点可伸缩 · 无昵称残留',
      avCssAt > 0
      && avCssBare.includes('body[data-we-avatar="on"] [data-we-avatar-row] { display: flex; align-items: flex-start; gap: 8px; }')
      && avCssBare.includes('body[data-we-avatar="on"] [data-we-avatar-row="user"] { flex-direction: row-reverse; }')
      && AV_GROW_RULE.test(avCssBare)
      // 负对照：不许去改锚点自己的 display —— 宿主契约明写它靠 `display:contents` 让 flex/grid
      // 父级"看见槽的孩子"（renderer 的 ANCHOR_STYLE）；改成 block/flex 会把宿主自己的
      // 列间距与空条目判据（`.xz4KEq_column > :not([hidden]) ~ …` / `:has(> [data-slot]:empty)`）带歪。
      && !/\[data-we-avatar-row\][^{}]*\[data-slot\][^{}]*\{[^}]*display:/.test(avCssBare)
      && avCss.includes('border-radius: calc(var(--we-avatar-round, 100) * 0.5%)')
      // 头像就是一个节点（不是"圆脸 + 名字"的两段列）：昵称整条已移除。
      && !avCss.includes('__name') && !avCss.includes('we-avatar-col')
      && avCss.includes('width: var(--we-avatar-size, 40px); height: var(--we-avatar-size, 40px);')
      // 别的功能不该被这一层带上（它只动消息行的排布）。
      && !avCss.includes('backdrop-filter'),
      'avCss=' + avCss.length + ' 段起始=' + avCssAt);
    // ── 装饰层的**行为**判据：用最小 DOM 替身真跑一遍「开 ⇒ 补节点 / 换设置 ⇒ 就地更新 /
    //    关 ⇒ 逐字节回原生」。源码口径看不见"补出来的东西长什么样"，而这一层恰恰只能靠
    //    真跑才知道（宿主 DOM 在无头环境里不存在 ⇒ 只能自己搭一个够它用的替身）。
    {
      const created = [];
      const rows = [];
      class El {
        constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.attrs = {}; this.style = { props: {}, setProperty: (k, v) => { this.style.props[k] = v; }, removeProperty: (k) => { delete this.style.props[k]; } }; this.className = ''; this.textContent = ''; }
        get firstChild() { return this.children[0] || null; }
        get firstElementChild() { return this.children[0] || null; }
        get classList() { const self = this; return { contains: (c) => String(self.className).split(/\s+/).includes(c) }; }
        appendChild(c) { c.parent = this; this.children.push(c); return c; }
        insertBefore(c) { c.parent = this; this.children.unshift(c); return c; }
        remove() {
          const p = this.parent;
          if (p) { const i = p.children.indexOf(this); if (i >= 0) p.children.splice(i, 1); }
          this.parent = null;
        }
        setAttribute(k, v) { this.attrs[k] = String(v); }
        getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
        removeAttribute(k) { delete this.attrs[k]; }
        querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
        querySelectorAll(sel) { return query(this, sel); }
      }
      const query = (rootEl, sel) => {
        const out = [];
        const want = String(sel).split(',').map((s) => s.trim());
        const matches = (el) => want.some((s) => {
          if (s.startsWith('.')) return String(el.className).split(/\s+/).includes(s.slice(1));
          const m = /^\[([a-z-]+)(?:="?([^"\]]*)"?)?\]$/.exec(s);
          if (!m) return false;
          return m[2] === undefined
            ? el.getAttribute(m[1]) !== null                 // [attr] = 只要求存在
            : el.getAttribute(m[1]) === m[2];                 // [attr="v"]
        });
        (function walk(el) { for (const c of el.children || []) { if (matches(c)) out.push(c); walk(c); } })(rootEl);
        return out;
      };
      const PREV = { document: globalThis.document, MutationObserver: globalThis.MutationObserver, selection: globalThis.selection };
      const restoreWeBase = stubWeBase();
      const body = new El('body');
      // 行照**宿主真实形态**造（asar 复算）：消息内容不直接挂在行下，而是裹在**槽出口锚点**
      // 里（`div[data-slot="conversation.chat.node"]`，宿主给它写死内联 `display: contents`
      // ⇒ 没有盒子、不吃 flex 属性、真正的 flex item 是锚点的孩子）。省掉这层的假 DOM 会让
      // "内容格撑满行"的规则**看起来**生效 —— issue #154 就是这样躲过判据的（真实屏上那条
      // 规则打在空气上，内容根按 max-content 定宽，收起态思考行的固有宽为 0 ⇒ 整条消息 0px）。
      const mkRow = (kind) => {
        const el = new El('div'); el.setAttribute('data-chat-flow-kind', kind);
        const outlet = new El('div');
        outlet.setAttribute('data-slot', 'conversation.chat.node');
        outlet.style.display = 'contents';
        const content = new El('div'); content.className = 'v5IAXa_root';
        outlet.appendChild(content);
        el.appendChild(outlet);
        rows.push(el); body.appendChild(el);
        return { el, outlet, content };
      };
      const userBox = mkRow('user');
      const aiBox = mkRow('assistant-step');
      const toolBox = mkRow('tool-call');
      const userRow = userBox.el;
      const aiRow = aiBox.el;
      const toolRow = toolBox.el;
      let observed = 0;
      let disconnected = 0;
      class MO { constructor() { observed += 0; } observe() { observed++; } disconnect() { disconnected++; } }
      let behavior = '';
      try {
        globalThis.document = {
          body,
          createElement: (t) => { const el = new El(t); created.push(el); return el; },
          querySelectorAll: (sel) => query(body, sel),
          querySelector: (sel) => query(body, sel)[0] || null,
        };
        globalThis.MutationObserver = MO;
        // 有意喂一个 SUT 不认的字段：`src/avatar-layer.js:268/275/276` 只按名读 enabled / size / radius，
        // 而 ③ 断言节点仍只有一枚 `.we-avatar__glyph` 子节点 ⇒ 证明设置里多出来一个名字字段也不会
        // 凭空长出名字节点（未知字段负对照，保留）。
        globalThis.selection = { avatarEnabled: true, avatarSize: 40, avatarRadius: 100, avatarUserName: '' };
        avatarLayerMod.syncAvatarLayer();
        const uNode = userRow.firstElementChild;
        const aNode = aiRow.firstElementChild;
        // ① 开关属性与两个变量落在 body 上；② 两类消息行各补了一个头像节点、工具行没补；
        // ③ 节点就是一个圆脸（只有一个 .we-avatar__glyph 子节点 —— 没有名字节点）；④ 40px / 100；
        // ⑤ 头像补在**锚点前面**（行 = [头像, 槽出口锚点]），锚点里只有内容根、装饰层不往里插东西
        //    （否则锚点的 `display: contents` 语义被改，宿主自己的列间距 / 空条目判据会跟着歪）。
        if (body.getAttribute('data-we-avatar') !== 'on'
          || body.style.props['--we-avatar-size'] !== '40px' || body.style.props['--we-avatar-round'] !== '100'
          || !uNode || uNode.className.indexOf('we-avatar--user') < 0
          || !aNode || aNode.className.indexOf('we-avatar--ai') < 0
          || toolRow.getAttribute('data-we-avatar-row') !== null || toolRow.children.length !== 1
          || toolRow.firstElementChild !== toolBox.outlet
          || uNode.children.length !== 1 || uNode.children[0].className !== 'we-avatar__glyph'
          || userRow.children.length !== 2 || userRow.children[1] !== userBox.outlet
          || userBox.outlet.children.length !== 1 || userBox.outlet.children[0] !== userBox.content
          || userRow.getAttribute('data-we-avatar-row') !== 'user' || aiRow.getAttribute('data-we-avatar-row') !== 'ai') {
          behavior = '补节点不对：' + JSON.stringify({
            attr: body.getAttribute('data-we-avatar'),
            vars: body.style.props,
            u: uNode && [uNode.className, uNode.children.map((c) => c.className)],
            row: userRow.children.map((c) => c.getAttribute('data-slot') || c.className),
            outlet: userBox.outlet.children.map((c) => c.className),
            tool: toolRow.getAttribute('data-we-avatar-row'),
          });
        }
        // 换设置：大小与圆角 ⇒ **就地更新**（不重建节点：同一个对象还在原处）+ 变量跟着换。
        globalThis.selection = { avatarEnabled: true, avatarSize: 56, avatarRadius: 0 };
        avatarLayerMod.syncAvatarLayer();
        if (userRow.firstElementChild !== uNode
          || body.style.props['--we-avatar-size'] !== '56px' || body.style.props['--we-avatar-round'] !== '0') {
          behavior = behavior || '就地更新不对：' + JSON.stringify({
            same: userRow.firstElementChild === uNode,
            vars: body.style.props,
          });
        }
        // 关掉：节点摘掉、行标记抹掉、开关属性与两个变量撤掉、观察者断开。
        // 行要**逐字节回原生** —— 只剩那层槽出口锚点（内容根还在它里面、原位未被重建）。
        globalThis.selection = { avatarEnabled: false };
        avatarLayerMod.syncAvatarLayer();
        if (userRow.children.length !== 1 || userRow.firstElementChild !== userBox.outlet
          || aiRow.children.length !== 1 || aiRow.firstElementChild !== aiBox.outlet
          || userBox.outlet.children.length !== 1 || userBox.outlet.children[0] !== userBox.content
          || aiBox.outlet.children[0] !== aiBox.content
          || userRow.getAttribute('data-we-avatar-row') !== null
          || body.getAttribute('data-we-avatar') !== null
          || body.style.props['--we-avatar-size'] !== undefined || observed !== 1 || disconnected !== 1) {
          behavior = behavior || '关掉没回原生：' + JSON.stringify({
            userKids: userRow.children.map((c) => c.getAttribute('data-slot') || c.className),
            rowAttr: userRow.getAttribute('data-we-avatar-row'),
            bodyAttr: body.getAttribute('data-we-avatar'), vars: body.style.props,
            observed, disconnected,
          });
        }
      } catch (e) { behavior = behavior || ('抛错：' + String((e && e.message) || e)); } finally {
        if (PREV.document === undefined) delete globalThis.document; else globalThis.document = PREV.document;
        if (PREV.MutationObserver === undefined) delete globalThis.MutationObserver; else globalThis.MutationObserver = PREV.MutationObserver;
        globalThis.selection = PREV.selection;
        restoreWeBase();
      }
      check('avatar-layer.js 行为：开 ⇒ 只给两类消息行补节点 + body 两个变量 · 换设置就地更新 · 关 ⇒ 逐字节回原生',
        !behavior, behavior);
    }
  }

  const st = Object.assign({}, schemaMod.DEFAULTS, {
    loaded: true, loading: false, id: 'w1', url: '/x', type: 'video', playing: true,
    videoPlaying: true, videoVolume: 0.5, videoAudioEnabled: false, videoError: '',
    contentRatingFilter: 'all', hiddenIds: [], rotationGroups: [], rotationGroupId: '',
    rotationEnabled: false, flip: false, objectFit: 'cover', playbackRate: 1,
    sceneLive: true, sceneLiveFailures: {}, themeFollow: false, themeFollowLine: '',
    adapterTarget: 'auto', pauseOnHidden: false, pauseOnBlur: false, pauseOnBattery: false,
    editingUploadDir: false, uploadDirDraft: '', editingWeAssetsDir: false, weAssetsDirDraft: '',
    weAssetsError: '', propsUrl: '/wallpaper-engine/props/tok',
    inventory: {
      wallpapers: [], error: null, installDir: '/we', uploadDir: '/up', weAssetsDir: null,
      sceneMediaBase: '', total: 0, portableCount: 0, playlists: [],
    },
  });
  const withHandlers = (names) => Object.fromEntries(names.map((n) => [n, noop]));
  const CASES = [
    {
      fn: 'renderWallpaperTab',
      label: '',
      mk: () => st,
      want: ['当前壁纸', '切换过场', '自动轮播', '自定义壁纸'],
      // ⚠️ 实测：456 行的渲染器在「最小替身」下只吐出 3 个控件标签 —— 说明 `editing` / `groups` /
      // `uploadedList` / `propsPanelOpen` 这些门关着时，四节里绝大部分内容**根本没被渲染**。
      // 钉住现状不是认可它：门的另一侧一旦开始渲染，这条就会变红、逼人回来看（下一步就是开门）。
      wantLabels: ['过场动画', '时长', '自动轮转'],
      // 门的**另一侧**：这几条门关着时，编辑器块 / 上传列表 / 错误与提示都不该出现 ——
      // 与后面两条"开门"用例成对，钉住"门"本身（只钉开门侧的话，"把门拆掉、永远画编辑器"也会绿）。
      rejectClasses: ['we-picker__editor', 'we-picker__uploads-list', 'we-picker__error', 'we-picker__note',
        // 第 3 门（属性/实时）关着时：没有错误行、也没有 `is-on` 的属性按钮。
        'we-picker__current-error', 'we-picker__btn is-on'],
      ctx: (sel) => Object.assign({
        setSetting: noop, setTransient: noop, setPickerOpener: noop,
        INTERVALS: [5, 10, 30, 60], armedConfirm: '', cdMode: '', current: sel,
        editing: null, editorPageView: '', group: null, groups: [], isLiveScene: false,
        pagerRow: () => null, playableCount: 0, playableList: [], playbackLive: false,
        propsPanelOpen: false, renderUserPropsPanel: () => null, sel, uploadedList: [],
      }, withHandlers(['onArmConfirm', 'onArmDeleteGroup', 'onCancelEditUploadDir',
        'onCancelEditWeAssetsDir', 'onClear', 'onDeleteGroup', 'onDisarmConfirm', 'onEditInterval',
        'onEditName', 'onEditOrder', 'onGroupChange', 'onGroupInterval', 'onOpenPicker',
        'onOpenPickerDraft', 'onRefresh', 'onStartEditUploadDir', 'onStartEditWeAssetsDir',
        'onSwitchTransition', 'onSwitchTransitionDir', 'onSwitchTransitionSpeed', 'onToggleAudio',
        'onTogglePlay', 'onTogglePropsPanel', 'onToggleRotation', 'onUploadDirDraft',
        'onWeAssetsDirDraft'])),
    },
    {
      // 第 1 门：**轮播编辑器**。此前这一档（149 行）在最小替身下只渲染出「自动转轮」一个标签 ——
      // `groups` / `group` / `editing` / `armedConfirm` 全关着。开门才能让编辑器那几十行进入判据。
      fn: 'renderWallpaperTab',
      label: '（轮播编辑器打开）',
      mk: () => st,
      ctxOver: {
        groups: [{ id: 'g1', name: 'A 组', wallpaperIds: ['w1'], interval: 10, order: 'sequence' }],
        group: { id: 'g1', name: 'A 组', wallpaperIds: ['w1'], interval: 10, order: 'sequence' },
        editing: { name: 'A 组', interval: 10, order: 'sequence', wallpaperIds: ['w1'] },
        armedConfirm: 'group:g1',
      },
      want: ['当前壁纸', '切换过场', '自动轮播', '自定义壁纸'],
      // 这一档**不设** `wantLabels`：实测标签锚对它完全盲（编辑器是裸 input/select/span 拼的，
      // 开满四门后标签仍是那 3 个）—— 该档由下面的类名锚负责。
      // ⚠️ 实测：`labelSeq` 对这一段是**盲的** —— 编辑器是裸 `<input>` / `<select>` / `<span>` 拼的，
      // 把四个门全打开后标签仍是原来那 3 个。类名锚才看得见：多出 `we-picker__editor` + `we-picker__text`。
      wantClasses: ['we-picker__editor', 'we-picker__text'],
    },
    {
      // 第 2 门：**上传与资源路径编辑器**。门是 `uploadedList` 非空 + 两个编辑态 + 错误/提示两条；
      // 全都是**裸 input/div**（不经过 SliderRow/switchRow/ctlText）⇒ 同样由类名锚负责。
      fn: 'renderWallpaperTab',
      label: '（上传与路径编辑器打开）',
      mk: () => Object.assign({}, st, {
        editingUploadDir: true, uploadDirDraft: 'D:/uploads',
        editingWeAssetsDir: true, weAssetsDirDraft: 'E:/we',
        weAssetsError: '该目录不可写', uploadError: '上传失败', uploadNote: '已就绪',
      }),
      ctxOver: { uploadedList: [{ id: 'u1', title: '上传的壁纸' }] },
      want: ['当前壁纸', '切换过场', '自动轮播', '自定义壁纸'],
      wantClasses: ['we-picker__uploads', 'we-picker__uploads-path', 'we-picker__uploads-list',
        'we-picker__uploads-item', 'we-picker__uploads-name', 'we-picker__file',
        'we-picker__error', 'we-picker__note'],
    },
    {
      // 第 3 门：**当前壁纸节的属性与实时那一半**。门：`current.type = scene|web` + `sel.propsUrl`
      // （属性按钮）· `propsPanelOpen`（按钮 `is-on` + 面板）· `sel.videoError`/`blockedNote`（错误行）。
      fn: 'renderWallpaperTab',
      label: '（场景壁纸 + 属性面板打开）',
      mk: () => Object.assign({}, st, {
        type: 'scene', videoError: '解码失败', blockedNote: '内容受限',
      }),
      ctxOver: {
        current: { type: 'scene', title: '场景名' },
        isLiveScene: true,
        propsPanelOpen: true,
        renderUserPropsPanel: () => REACT.createElement('div', { className: 'stub-props-panel' }, 'props'),
      },
      want: ['当前壁纸', '切换过场', '自动轮播', '自定义壁纸'],
      wantClasses: ['we-picker__current', 'we-picker__current-info', 'we-picker__current-title',
        'we-picker__current-error', 'we-picker__btn is-on', 'stub-props-panel'],
    },
    {
      // 视频壁纸：「实时渲染诊断」**按门不画**（它只对能走实时渲染的场景 / 网页显示）。
      fn: 'renderAdvancedTab',
      label: '（视频壁纸：诊断节按门不画）',
      mk: () => st,
      want: ['浏览方式', '兼容性', '适配', '省电', '缓存位置'],
      wantLabels: ['紧凑布局', 'Edge 兼容', '适配目标', '最小化/切页时暂停', '使用电池时暂停'],
      adv: true,
    },
    {
      // 场景壁纸：诊断节出现，且**在最后**（缓存位置是设置行，排在诊断这类排查开关之前）。
      fn: 'renderAdvancedTab',
      label: '（场景壁纸：诊断节出现且在最后）',
      mk: () => Object.assign({}, st, { type: 'scene', sceneLive: true, sceneLiveSrc: '/x' }),
      want: ['浏览方式', '兼容性', '适配', '省电', '缓存位置', '实时渲染诊断'],
      wantLabels: ['紧凑布局', 'Edge 兼容', '适配目标', '最小化/切页时暂停', '使用电池时暂停', 'live 诊断日志'],
      adv: true,
    },
  ];
  const advCtx = (sel) => Object.assign({ setSetting: noop, setTransient: noop, sel },
    withHandlers(['onAdapterTarget', 'onEdgeCompatChange', 'onLayoutChange', 'onPauseOnBattery',
      'onPauseOnBlur', 'onPauseOnHidden', 'onToggleLiveDiag']));
  for (const t of CASES) {
    const sel = t.mk();
    let tree = null;
    let err = '';
    // `ctxOver` 让一个用例把门**打开**（`groups` / `editing` / `uploadedList` … 默认全关着，
    // 于是那些分支从没被渲染过 —— 这一档就是为了让它们第一次进入判据的视野）。
    // 只给 `ctxOver` 的用例复用**第一条**（墙纸档）的 ctx 构造器：同一批处理器，只是门开着。
    const buildCtx = t.ctx || CASES[0].ctx;
    try { tree = panelMod[t.fn](t.adv ? advCtx(sel) : Object.assign(buildCtx(sel), t.ctxOver || {})); } catch (e) { err = String((e && e.message) || e); }
    // ① 渲染得出（缺 ctx 字段 / 缺全局替身都会在这里响亮地炸）
    check(t.fn + t.label + ' 渲染得出（真渲染器 + 最小替身）', err === '', err || 'ok');
    if (err) continue;
    // ② 节**有序**且一节不多不少 —— 这是纯搬动唯一会破坏的东西
    const seq = sectionSeq(tree);
    if (t.want) {
      check(t.fn + t.label + ' 的节顺序与集合逐字不变', sameSeq(seq, t.want),
        'want=[' + t.want.join(' / ') + '] got=[' + seq.join(' / ') + ']');
    }
    if (t.wantLabels) {
      const labels = labelSeq(tree);
      check(t.fn + t.label + ' 的控件标签顺序与集合逐字不变', sameSeq(labels, t.wantLabels),
        'want=[' + t.wantLabels.join(' / ') + '] got=[' + labels.join(' / ') + ']');
    }
    // 类名锚：`wantClasses` 是**子串**判定（构件名常带修饰类，如 `we-picker__btn --primary`）——
    // 它认的是"这一段画出来了没有"，正是 `labelSeq` 对**裸 input/select** 的盲区。
    if (t.wantClasses) {
      const kinds = classKinds(tree);
      const missing = t.wantClasses.filter((c) => !kinds.some((k) => k.includes(c)));
      check(t.fn + t.label + ' 画出了该档应有的控件种类（类名锚）', missing.length === 0,
        'want⊆got? 缺=[' + missing.join(', ') + '] got=' + kinds.length + ' 种');
    }
    // 门的**另一侧**：这一档**不该**出现的构件（如"编辑器没打开时不该有 `we-picker__editor`"）。
    // 门的两个方向都钉住，才不是"只要画得多就算过"。
    if (t.rejectClasses) {
      const kinds = classKinds(tree);
      const present = t.rejectClasses.filter((c) => kinds.some((k) => k.includes(c)));
      check(t.fn + t.label + ' 不该出现的构件一个都没画（门的另一侧）', present.length === 0,
        '多出=[' + present.join(', ') + ']');
    }
    if (process.env.DSH_WE_SHOW_LABELS) {
      console.log('    LABELS ' + t.fn + t.label + ' = ' + JSON.stringify(labelSeq(tree)));
      console.log('    CLASSES ' + t.fn + t.label + ' (' + classKinds(tree).length + ') = '
        + JSON.stringify(classKinds(tree).filter((c) => /editor|playlist|rotation|text|select|hint/.test(c))));
    }
  }
  // 负对照：同一个比较器对"顺序被换 / 少一节 / 多一节"都必须判坏（否则上面两条可能是恒真）。
  // ── 守卫的守卫：判据**缺守卫时是"崩"而不是"判红"**，比判红更隐蔽 ──────────────
  // 实测过：ctx 驱动那个循环的标签检查漏了 `if (t.wantLabels)`，而有一条用例改用类名锚、
  // 压根没有 `wantLabels` ⇒ `sameSeq(labels, undefined)` 当场抛，整个守卫**一条结论都没留下**
  // （比"红"更糟：红至少留下了"哪一条不成立"）。这条把"每个 `sameSeq(x, t.<field>)` 都必须被
  // `if (t.<field>)` 包住"钉成静态事实。
  {
    // 只扫**本判据之前**的代码：负对照里的示例字符串也在源码里，扫全文件会把它们当代码。
    const MARK = '每个 sameSeq 的期望值都被';
    const src = stripComments(readFileSync(new URL(import.meta.url), "utf8"));
    const head = src.slice(0, src.indexOf(MARK));
    const unguarded = (text) => {
      const ls = text.split("\n"); const out = [];
      ls.forEach((l, i) => {
        const m = /sameSeq\([^,]+,\s*(t\.\w+)\)/.exec(l);
        if (!m) return;
        const win = ls.slice(Math.max(0, i - 4), i).join(" ");
        if (!win.includes("if (" + m[1] + ")")) out.push("L" + (i + 1) + ":" + m[1]);
      });
      return out;
    };
    const bad = unguarded(head);
    check('每个 sameSeq 的期望值都被 `if (t.<field>)` 守卫（缺守卫 ⇒ 崩而非判红，一条结论都不留）',
      bad.length === 0, bad.join(', ') || '全部已守卫');
    check('negative control: 缺 if 守卫的 sameSeq 会被同一条判据判出',
      unguarded('const a = sameSeq(x, t.wantLabels);').length === 1
      && unguarded(['if (t.wantLabels) {', '  const a = sameSeq(x, t.wantLabels);', '}'].join(String.fromCharCode(10))).length === 0);
    // 同一件事的**另一半**：三条锚的调用（`labelSeq` / `classKinds` / `textKinds`）也必须被
    // `if (t.<field>)` 包住 —— 否则那条判据要么恒真、要么在缺期望时崩。
    // （`DSH_WE_SHOW_LABELS` 那几行是**探查用 dump**，不是判据，跳过。）
    const unguardedAnchors = (text) => {
      const ls = text.split("\n"); const out = [];
      ls.forEach((l, i) => {
        if (!/=\s*(labelSeq|classKinds|textKinds)\(tree\)/.test(l)) return;
        const win = ls.slice(Math.max(0, i - 5), i + 1).join(" ");
        if (win.includes("DSH_WE_SHOW_LABELS")) return;
        if (!/if \(t\./.test(win)) out.push("L" + (i + 1) + ":" + l.trim().slice(0, 44));
      });
      return out;
    };
    const badAnchors = unguardedAnchors(head);
    check('三条锚的调用都被 `if (t.<field>)` 包住（否则判据恒真或缺期望时崩）',
      badAnchors.length === 0, badAnchors.join(' | ') || '全部已守卫');
    check('negative control: 未守卫的锚调用会被同一条判据判出',
      unguardedAnchors('const labels = labelSeq(tree);').length === 1
      && unguardedAnchors(['if (t.wantLabels) {', '  const labels = labelSeq(tree);', '}'].join(String.fromCharCode(10))).length === 0);
  }

  // ── 覆盖面地板（本轮实测的静默失败就是它要防的）─────────────────────────────
  // 一次补丁把新用例插进了上一条的 `ctx:` 构造器里 —— **语法合法、却从没被迭代到**，于是判据一条
  // 都没加而整个套件照旧全绿（当时靠"通过数没动"才发现）。用例没进数组 / 被改名 / 被注释掉都属于
  // 这一类：**静默少跑**。地板把"少跑"变成红。（带标签期望的条数单独设下限：那是细锚的覆盖面。）
  // 地板本身提成命名判据：阳性侧喂真实 `CASES`，阴性侧喂「空数组 / 四条都没有标签期望」的合成数组
  // —— 两侧走的是**同一个** `floorOk`，不是各自重打一遍数字。
  const floorOk = (cs) => cs.length >= 4 && cs.filter((c) => c.wantLabels).length >= 3;
  check('覆盖面：渲染用例数 ≥ 4 且其中带控件标签期望的 ≥ 3（用例静默没进数组即红）',
    floorOk(CASES),
    'cases=' + CASES.length + ' withLabels=' + CASES.filter((c) => c.wantLabels).length);
  check('negative control: 空数组 / 缺标签期望会被同一条地板判出',
    floorOk([]) === false && floorOk([{ wantLabels: [] }, {}, {}, {}]) === false);

  // ── 类名锚的**正/负对照**（目标 ④：新守卫必须带负对照）─────────────────────
  // 类名锚的判定是"子串 + 子集"，两个方向都可能恒真：恒真一 = 集合里总有它；恒真二 = 子集判空。
  // 这里对**合成树**各验一次，并补一条"空树不会让判据恒真"。
  {
    const kindsOf = (tree0) => classKinds(tree0);
    const has = (kinds, c) => kinds.some((k) => k.includes(c));
    const editorTree = [{ props: { className: 'we-picker__editor' }, children: [] }];
    const multi = [
      { props: { className: 'we-picker__uploads' }, children: [
        { props: { className: 'we-picker__uploads-list' }, children: [] },
      ] },
    ];
    check('正对照：类名锚认得出该有的构件（含子串判定）',
      has(kindsOf(editorTree), 'we-picker__editor') && kindsOf(editorTree).length === 1);
    check('正对照：嵌套树的类名也收得到（不是只看顶层）',
      has(kindsOf(multi), 'we-picker__uploads') && has(kindsOf(multi), 'we-picker__uploads-list'));
    check('negative control: 缺构件会被 `wantClasses` 那一条判出来',
      ['we-picker__editor', 'we-picker__uploads-list'].filter((c) => !has(kindsOf(editorTree), c)).length === 1);
    check('negative control: 多出不该有的构件会被 `rejectClasses` 那一条判出来',
      ['we-picker__editor'].filter((c) => has(kindsOf(multi), c)).length === 0
      && ['we-picker__uploads'].filter((c) => has(kindsOf(multi), c)).length === 1);
    check('negative control: 空树 / 无 className 的树不会让两条判据恒真',
      kindsOf([]).length === 0 && kindsOf([{ props: {}, children: [] }]).length === 0);
  }

  check('负对照：节顺序判据对换序 / 缺节 / 多节都有牙',
    sameSeq(['甲', '乙'], ['甲', '乙'])
    && !sameSeq(['乙', '甲'], ['甲', '乙'])
    && !sameSeq(['甲'], ['甲', '乙'])
    && !sameSeq(['甲', '乙', '丙'], ['甲', '乙']));
  check('负对照：节抽取只认 section-label 节点（旁边普通文本不得被当节）',
    sectionSeq({ props: { className: 'we-picker__ctl' }, children: ['当前壁纸'] }).length === 0
    && sectionSeq({ props: { className: 'we-picker__section-label' }, children: ['当前壁纸'] }).length === 1);

  // ── appearance / effects：同一套挂载台（ctx 由**渲染器自己的解构行**驱动）────────
  // 这两页签的节顺序此前也没有判据（`verify-fontset` 只判"某串在场"，`renderEffectsTab`
  // 甚至只有一个节标签）。补上之后，它们才具备"按节拆成子渲染器"的安全网（P4-19 余项）。
  const ctxFieldsOf = (fnName) => {
    const at = tabsSrcNow.indexOf('function ' + fnName + '(ctx) {');
    const dm = /const \{([^}]*)\} = ctx;/.exec(tabsSrcNow.slice(at, at + 4000));
    return dm ? dm[1].split(',').map((s) => s.trim().split(':')[0].trim()).filter(Boolean) : [];
  };
  // 解构行里除少数几个"值形状"（fontSet / surface / sel）外全是处理器 ⇒ 其余一律 noop。
  // ⚠️ 必须收**这个页签 + 它的节函数**的字段并集：P4-19 之后 `render*Tab` 自己只解构 `{ }`，
  // 只读那一层会得到空集 ⇒ 处理器全是 undefined（此前一直没炸，只因没走到会**调用**它们的
  // 分支 —— 字体节一打开就撞上 `officialColorOf is not a function`）。
  // ⚠️ `sel` 必须**跳过**：它不在 `known` 里，若不排除就会被 noop 覆盖 ⇒ `sel.id` 变 undefined
  // ⇒ 效果页签走上"还没有启用壁纸"的**空态提前返回**，节判据于是拿到空树而"照旧报"。
  const allCtxFieldsOf = (fnName) => {
    const domain = fnName.replace(/^render/, '').replace(/Tab$/, '');
    const secs = [...tabsSrcNow.matchAll(new RegExp('function (render' + domain + '\\w*Section)\\(ctx\\)', 'g'))]
      .map((m) => m[1]);
    return [fnName, ...secs].flatMap((n) => ctxFieldsOf(n) || []);
  };
  const ctxFrom = (fnName, sel, known) => {
    const c = { sel };
    for (const n of allCtxFieldsOf(fnName)) if (n !== 'sel' && !(n in known)) c[n] = noop;
    return Object.assign(c, known);
  };
  const FONTSET_STUB = {
    open: true, fontSets: [], activeId: '', loading: false, error: '', editingId: '', draftName: '',
    exportUrl: () => '', onOpen: noop, onActivate: noop, onRefresh: noop, onDelete: noop, onEdit: noop,
    onDraftName: noop, onRenameCommit: noop, onCancelEdit: noop, onCreate: noop,
  };
  const MORE_CASES = [
    { fn: 'renderAppearanceTab', label: '（设置页：七节 —— 简化玻璃 + 主题预设 + 字体节头（收起），玻璃高级行已迁侧栏）', surface: 'settings',
      // 玻璃四件套 + 雾化已归入新节「玻璃 UI」；「左侧栏液态玻璃」与它的子项也都在本节
      //（§10.25 起）。⚠️ 本档是**设置页**：只画**简化配置 + 预设方案 + 字体节头（收起）** ——
      //    **玻璃**高级行（独立配置层 / 胶囊细调）仍只住侧栏折叠块（边界判据翻转后双向钉住：
      //    设置档一个「独立配置」都不许有）；**字体节**在三次修订后两档都画
      //    （默认收起 ⇒ 本节只多一个节头，内容仍不进树）。
      // ⚠️ `selOver` 打开宿主能力位：`sidebarPresent` + `sidebarGlass` 之后，侧栏家族与内容面
      // 那几行才画得出来（`sidebarPresent` 为假时它们整段不渲染 —— 这正是"窗口与侧栏"那节
      // 在没装 dsh-better-sidebar 的机器上只剩空标题的原因，§10.25 因此把它并进了「玻璃 UI」）。
      selOver: { sidebarPresent: true, sidebarGlass: true, thinkingGlass: true },
      // 预设块的 ctx 替身：只给 `presets`（空清单）就够把它画出来 —— 空位虚框 + 保存行是
      // 渲染期就存在的构件，其余处理器只在点击时才用（本用例不点）。
      // ⚠️ **二次修订**：五个整节门在**两档都能折叠** ⇒ 用例必须**显式**给出
      //    "这一档要展开哪几节"（`ctxFrom` 会把没给的字段填成 `noop` ⇒ `noop === true` 为假
      //    ⇒ 被当成"收起"）。本用例 = 设置页的**默认形态**：细节 / 主题预设 / 玻璃 UI /
      //    侧边栏圆角都展开；字体与配色那两节在本台按"收起"跑（它们各自有专门用例）。
      //    「主题预设」并入本序列：独立节；与其他节同口径
      //    可折叠（presetsOpen）。
      ctxOver: { glassPresets: { presets: [] }, detailOpen: true, glassUiOpen: true, cornersOpen: true, presetsOpen: true },
      want: ['主题', '细节', '主题预设', '玻璃 UI', '侧边栏圆角', '全局 UI 配色', '全局字体'],
      // ⚠️ 本档打开 `thinkingGlass`（上游 #134 的「思考块液态玻璃」，默认关）：原属本档的
      //    「胶囊雾化」与「思考触发条玻璃·独立配置」都迁进侧栏折叠块了（本档不再画它们 ——
      //    这正是"真迁移"的字面含义；侧栏展开档在下面钉它们）。
      wantLabels: ['主题随壁纸', '边框', '预设方案', '深色单独设置', '玻璃透明度', '雾化', '额外补雾化的选择器', '玻璃保真度', '思考块液态玻璃', '左侧栏液态玻璃', '标题栏液态玻璃', '侧栏液态玻璃', '侧栏全透明', '侧栏玻璃跟随全局', '左侧栏 · 统一圆角', '左侧栏 · 四角单独', '右侧栏 · 统一圆角', '右侧栏 · 四角单独'] },
    // 设置页 · 主题预设**收起**档：不给 `presetsOpen`（ctxFrom 填 noop ⇒ 被当成收起）。
    // 节头必须仍在（它是重新展开的唯一入口），预设网格一行都不画 —— 判据形状与「全局 UI 配色」
    // 收起档同款（verify-client 里那条"存 0 ⇒ 色板不进树、节头仍在"的渲染侧镜像）。
    { fn: 'renderAppearanceTab', label: '（设置页 · 主题预设收起：只画节头）', surface: 'settings',
      selOver: { sidebarPresent: true, sidebarGlass: true, thinkingGlass: true },
      ctxOver: { glassPresets: { presets: [] }, detailOpen: true, glassUiOpen: true, cornersOpen: true },
      want: ['主题', '细节', '主题预设', '玻璃 UI', '侧边栏圆角', '全局 UI 配色', '全局字体'],
      wantLabels: ['主题随壁纸', '边框', '深色单独设置', '玻璃透明度', '雾化', '额外补雾化的选择器', '玻璃保真度', '思考块液态玻璃', '左侧栏液态玻璃', '标题栏液态玻璃', '侧栏液态玻璃', '侧栏全透明', '侧栏玻璃跟随全局', '左侧栏 · 统一圆角', '左侧栏 · 四角单独', '右侧栏 · 统一圆角', '右侧栏 · 四角单独'] },
    // 侧栏档（默认收起）：**简化配置 + 两块折叠块的头**（ADR-0008 D4）——
    // 「详细玻璃调节」开关在（收起 ⇒ 它后面的独立配置层一行都不画）；「全局字体」节头在
    // （收起 ⇒ 字体内容不画）。`selOver` 与设置页用例同位 ⇒ 侧栏家族开关同样画得出来。
    // ⚠️ 起「细节 / 玻璃 UI / 侧边栏圆角」三节**在侧边栏整节默认收起** ⇒ 这三条
    //    老用例一律把三个门播种为**展开**（`ctxOver` 那三个字段）：它们要测的是"展开后控件在
    //    不在、接线通不通"，那是**等价前提**下的老断言，不该因为默认值变了就删/改判不在
    //    （那会把"控件坏了"与"默认收起了"混成同一件事）。默认收敛这条**新行为**由紧随的
    //    下面这条用例单独承担（它一个门都不给 ⇒ 新判据的"收起"分支才不会空转）。
    // 侧栏档 · 三节**默认收敛**（一个门都不给 = 全收起）：这是用户口径要的新行为 ——
    // 侧栏外观页打开时只剩六行节头，一屏放得下（此前「细节 + 玻璃 UI + 侧边栏圆角」要滚好几屏）。
    { fn: 'renderAppearanceTab', label: '（侧栏档 · 三节默认收敛：只画节头）', surface: 'sidebar',
      selOver: { sidebarPresent: true, sidebarGlass: true },
      want: ['主题', '细节', '玻璃 UI', '侧边栏圆角', '全局 UI 配色', '全局字体'],
      wantLabels: ['主题随壁纸'] },
    // ⚠️ 「左右拉宽、顶格」：环按**面板实测宽度**等比缩放（`ctxOver.paneWidth`）。
    //    ⚠️ 这条必须打在 `renderMascotTab` 上 —— 吉祥物是**独立页签**，不在 `renderAppearanceTab`
    //    里（第一版我挂错了函数，于是 items=0、判据在空转：它"红"了但红的是对象不存在，
    //    而不是缩放不对）。本档喂宽面板 900，带 `geomProbe` ⇒ 下面那条判据**端到端**核对
    //    "卡宽/半径/透视/立绘盒/窗口高都真的乘上了 scale" —— 只判"渲染得出"不够。
    { fn: 'renderMascotTab', label: '（吉祥物页签 · 宽面板 900px：环按宽度等比放大）', surface: 'settings',
      ctxOver: { paneWidth: 900 }, geomProbe: 900, want: ['聊天吉祥物'] },
    { fn: 'renderAppearanceTab', label: '（侧栏档：三节展开 + 两块折叠块默认收起）', surface: 'sidebar',
      selOver: { sidebarPresent: true, sidebarGlass: true },
      ctxOver: { detailOpen: true, glassUiOpen: true, cornersOpen: true },
      want: ['主题', '细节', '玻璃 UI', '侧边栏圆角', '全局 UI 配色', '全局字体'],
      wantLabels: ['主题随壁纸', '边框', '玻璃透明度', '雾化', '额外补雾化的选择器', '玻璃保真度', '思考块液态玻璃', '左侧栏液态玻璃', '标题栏液态玻璃', '侧栏液态玻璃', '侧栏全透明', '侧栏玻璃跟随全局', '详细玻璃调节', '左侧栏 · 统一圆角', '左侧栏 · 四角单独', '右侧栏 · 统一圆角', '右侧栏 · 四角单独'] },
    // 侧栏档 · 「详细玻璃调节」展开（ctxOver.glassDetailOpen）：高级行全部回来 ——
    // 胶囊细调（thinkingGlass 开 ⇒ 同门）、内容面与登记表各面的「独立配置」。
    // `sidebarFollowGlobal` 默认开 ⇒ 「侧栏玻璃·独立配置」被跟随门收起（画出来又不生效的
    // 旋钮是要防的），序列里没有它；内容面与跟随无关 ⇒ 照旧在场。
    { fn: 'renderAppearanceTab', label: '（侧栏档 · 详细玻璃调节展开：高级行全部回来）', surface: 'sidebar',
      selOver: { sidebarPresent: true, sidebarGlass: true, thinkingGlass: true },
      ctxOver: { glassDetailOpen: true, detailOpen: true, glassUiOpen: true, cornersOpen: true },
      want: ['主题', '细节', '玻璃 UI', '侧边栏圆角', '全局 UI 配色', '全局字体'],
      wantLabels: ['主题随壁纸', '边框', '玻璃透明度', '雾化', '额外补雾化的选择器', '玻璃保真度', '思考块液态玻璃', '左侧栏液态玻璃', '标题栏液态玻璃', '侧栏液态玻璃', '侧栏全透明', '侧栏玻璃跟随全局', '详细玻璃调节', '胶囊雾化', '内容面玻璃·独立配置', '设置窗口玻璃·独立配置', '对话框玻璃·独立配置', '思考触发条玻璃·独立配置', '浮层玻璃·独立配置', '左侧栏 · 统一圆角', '左侧栏 · 四角单独', '右侧栏 · 统一圆角', '右侧栏 · 四角单独'] },
    // ⚠️ 这一条是**覆盖缺口**补上的：字体那一节的细节（颜色角色 / 排版角色 / 字体族 / 组件字体 /
    // 字体集预设，~180 行）被 `sel.fontCustom` 挡着，而它的默认值是关 ⇒ **任何用例都没渲染过它**。
    // 打开它才能让那些行第一次进入判据的视野（这本身是找缺陷，不只是补锚）。
    //  迁移后这节只在侧栏档渲染 ⇒ 本档同步改 surface + `fontOpen: true`（展开）。
    { fn: 'renderAppearanceTab', label: '（侧栏档 · 字体节展开 · 字体自定义开）', surface: 'sidebar',
      selOver: { fontCustom: true, sidebarPresent: true, sidebarGlass: true },
      ctxOver: { fontOpen: true, detailOpen: true, glassUiOpen: true, cornersOpen: true, fontSet: FONTSET_STUB },
      want: ['主题', '细节', '玻璃 UI', '侧边栏圆角', '全局 UI 配色', '全局字体'],
      wantLabels: ['主题随壁纸', '边框', '玻璃透明度', '雾化', '额外补雾化的选择器', '玻璃保真度', '思考块液态玻璃', '左侧栏液态玻璃', '标题栏液态玻璃', '侧栏液态玻璃', '侧栏全透明', '侧栏玻璃跟随全局', '详细玻璃调节',
        '左侧栏 · 统一圆角', '左侧栏 · 四角单独', '右侧栏 · 统一圆角', '右侧栏 · 四角单独',
        '字体自定义', '默认字体', '终端字体', '文字颜色角色', '深色单独设置', '正文', '次要文字', '弱化说明', '极小说明', '禁用 / 更弱',
        '排版角色', '只看改过的', '高级字体设置', '字体集预设'] },
    // ⚠️ 三次修订：字体节**回到设置页** ⇒ 必须有一条**设置档展开**的用例。
    //    为什么非有不可：上面那条设置档用例默认收起，只证明"节头在" —— 而这次改动的实质是
    //    "设置页那份能真用"，也就是**展开后整段字体内容（~180 行）要进树**。只有节头没有内容
    //    正是"接线断了一半"的形态（ctx 里少给一个 fontOpen / 处理器没接上），而那种形态在上面
    //    那条收起档判据下**照样全绿**。两档同 sel 同 ctxOver，差异只该来自玻璃行（预设方案）。
    { fn: 'renderAppearanceTab', label: '（设置页 · 字体节展开 · 字体自定义开）', surface: 'settings',
      selOver: { fontCustom: true, sidebarPresent: true, sidebarGlass: true },
      // ⚠️ 前三个门同样要显式给（二次修订后两档都可折叠；不给会被当成收起）；
      //    「主题预设」的门（presetsOpen）同口径。
      ctxOver: { fontOpen: true, glassPresets: { presets: [] }, detailOpen: true, glassUiOpen: true, cornersOpen: true, presetsOpen: true },
      want: ['主题', '细节', '主题预设', '玻璃 UI', '侧边栏圆角', '全局 UI 配色', '全局字体'],
      // ⚠️ 这条序列 = 上面设置档（收起）那 17 项玻璃标签 + 侧栏字体展开那 14 项字体标签，
      //    **按序拼接** —— 两个来源各自都被别的用例钉住了，这里是它们的交叉验证：拼接后
      //    逐字相等 ⇒ 设置页的字体节渲染的就是侧栏那一份同一渲染器的产物（无 surface 分支残留）。
      wantLabels: ['主题随壁纸', '边框', '预设方案', '深色单独设置', '玻璃透明度', '雾化', '额外补雾化的选择器', '玻璃保真度', '思考块液态玻璃', '左侧栏液态玻璃', '标题栏液态玻璃', '侧栏液态玻璃', '侧栏全透明', '侧栏玻璃跟随全局',
        '左侧栏 · 统一圆角', '左侧栏 · 四角单独', '右侧栏 · 统一圆角', '右侧栏 · 四角单独',
        '字体自定义', '默认字体', '终端字体', '文字颜色角色', '深色单独设置', '正文', '次要文字', '弱化说明', '极小说明', '禁用 / 更弱',
        '排版角色', '只看改过的', '高级字体设置', '字体集预设'] },
    // 效果页**只有一个节标签** ⇒ 节顺序钉不住它的内部结构。这里用**控件标签的有序序列**作细锚：
    // 它同样是行为级的（对任何重构不变），却细到能看见"某一行的位置被挪了 / 被删了"。
    { fn: 'renderEffectsTab', label: '（画面 · 设置页）', surface: 'settings', want: ['画面'],
      wantLabels: ['壁纸模糊', '亮度', '对比度', '饱和度', '水平', '垂直', '缩放', '壁纸透明度', '暗化', '倍速', '帧率上限', '适配', '水平翻转'] },
    { fn: 'renderEffectsTab', label: '（画面 · 侧栏档）', surface: 'sidebar', want: ['画面'],
      wantLabels: ['壁纸模糊', '亮度', '对比度', '饱和度', '水平', '垂直', '缩放', '壁纸透明度', '暗化', '倍速', '适配', '水平翻转'] },
    // 第 4 门：**效果页的实时渲染组**（`sel.type` 为场景/网页时才画；视频档一个都不出）。
    // 这一组的标签走 `switchRow` / `ctlText` ⇒ **标签锚这次看得见**（与墙纸档的门后裸控件不同）。
    { fn: 'renderEffectsTab', label: '（画面 · 场景壁纸：实时渲染组出现）', surface: 'settings',
      selOver: { type: 'scene', sceneLive: true, sceneFrameUrl: '/f.png', sceneLiveSrc: '/x' },
      want: ['画面'],
      // 实测：13 个标签 —— 比网页档多的两个（`出图来源` / `自定义画面`）正是**场景专属**那两行
      // （网页壁纸没有"出图来源"这一说）。标签锚是**精确序列**判定 ⇒ 两个方向都钉住了。
      wantLabels: ['壁纸模糊', '亮度', '对比度', '饱和度', '水平', '垂直', '缩放', '壁纸透明度', '暗化', '场景实时渲染',
        '启动最长等待时间', '实时渲染帧率', '出图来源', '自定义画面', '适配', '水平翻转'] },
    { fn: 'renderEffectsTab', label: '（画面 · 网页壁纸：实时渲染组出现）', surface: 'settings',
      selOver: { type: 'web', webLive: true, webLiveSrc: '/x' },
      want: ['画面'],
      wantLabels: ['壁纸模糊', '亮度', '对比度', '饱和度', '水平', '垂直', '缩放', '壁纸透明度', '暗化', '网页实时渲染',
        '启动最长等待时间', '实时渲染帧率', '适配', '水平翻转'] },
    // 目标③ 余项 1：「实时帧」那一段（门 = gpuFrameUi.wid === sel.id && pinned —— 这一张壁纸的槽里真有帧）。
    // 它有几行随 w/h/error/recapturing/busy 显隐的分支，全在模块级替身里，故用 globals。
    { fn: 'renderEffectsTab', label: '（画面 · 场景壁纸 + 本壁纸已固定实时帧）', surface: 'settings',
      selOver: { type: 'scene', sceneLive: true, sceneFrameUrl: '/f.png', sceneLiveSrc: '/x', id: 'w1' },
      globals: { gpuFrameUi: { wid: 'w1', pinned: true, w: 1920, h: 1080, busy: false, recapturing: false, error: '' } },
      want: ['画面'],
      // 实测 14 个：门打开后多出 `实时帧`（正好夹在 `出图来源` 与 `自定义画面` 之间）。
      wantLabels: ['壁纸模糊', '亮度', '对比度', '饱和度', '水平', '垂直', '缩放', '壁纸透明度', '暗化', '场景实时渲染',
        '启动最长等待时间', '实时渲染帧率', '出图来源', '实时帧', '自定义画面', '适配', '水平翻转'] },
    // 目标③ 余项 2：转码进度行的 done 态（另一态由「进行中」覆盖）。
    { fn: 'renderEffectsTab', label: '（画面 · 转码进度 done）', surface: 'settings',
      selOver: { type: 'video', transcodeState: 'working', transcodeProgress: { phase: 'done', percent: 100 } },
      want: ['画面'],
      // 进度行是**裸 div**（`we-picker__prog*`）⇒ 标签锚看不见，改由类名锚钉住（下面两档共用）。
      wantClasses: ['we-picker__prog', 'we-picker__prog-track', 'we-picker__prog-bar'],
      // 文本锚补的正是类名锚的盲区：这一行的**五个分支只差文案**（构件完全一样）。
      wantTexts: ['即将完成…'], },
    // 转码进度行的**进行中**态（`phase: "download"`）—— 与上面的 done 态**只差文案**（构件相同），
    // 故由**文本锚**钉住（`weT` 在挂载台里是身份层、占位符照插 ⇒ 期望串就是面板上那一串）。
    { fn: 'renderEffectsTab', label: '（画面 · 转码进度 download 42%）', surface: 'settings',
      selOver: { type: 'video', transcodeState: 'working', transcodeProgress: { phase: 'download', percent: 42 } },
      want: ['画面'],
      wantClasses: ['we-picker__prog-bar'],
      wantTexts: ['下载 ffmpeg 42%'] },
    // 转码收尾中（`phase: "transcode"` + `finalizing`）—— 同样只差文案，由文本锚钉住。
    { fn: 'renderEffectsTab', label: '（画面 · 转码进度 transcode 收尾中）', surface: 'settings',
      selOver: { type: 'video', transcodeState: 'working', transcodeProgress: { phase: 'transcode', percent: 96, finalizing: true } },
      want: ['画面'],
      wantTexts: ['收尾中…'] },
    // 转码进行中（不带 finalizing）：文案含 `{percent}`/`{eta}` 两个插值 ⇒ 只断言构件已画出
    // （分支确实被走到），文案留给上面的两档钉 —— 不猜插值结果。
    { fn: 'renderEffectsTab', label: '（画面 · 转码进度 transcode 进行中）', surface: 'settings',
      selOver: { type: 'video', transcodeState: 'working', transcodeProgress: { phase: 'transcode', percent: 66, eta: '' } },
      want: ['画面'],
      wantClasses: ['we-picker__prog', 'we-picker__prog-bar'] },
    // `gpuFrameUi` 的三态：错误提示行 + 两个按钮的进行中文案（都住在模块级替身里 ⇒ 用 globals）。
    { fn: 'renderEffectsTab', label: '（画面 · 抓帧出错 + 两态进行中）', surface: 'settings',
      selOver: { type: 'scene', sceneLive: true, sceneFrameUrl: '/f.png', sceneLiveSrc: '/x', id: 'w1' },
      globals: { gpuFrameUi: { wid: 'w1', pinned: true, w: 1920, h: 1080, busy: true, recapturing: true, error: '抓帧失败：超时' } },
      want: ['画面'],
      wantClasses: ['we-picker__hint'],
      wantTexts: ['抓帧失败：超时', '抓帧中…', '清除中…'] },
  ];
  for (const t of MORE_CASES) {
    // `known` = 该档真正提供的 ctx 字段（其余由 `ctxFrom` 填 noop）。`ctxOver` 让用例补上
    // **需要真形状**的字段 —— 例：预设块的入口守卫是 `if (!presets) return null`，喂 noop 它
    // 整块不画，那样"设置档必须有预设块"这条断言就永远测不到东西（判据空转，本仓最忌）。
    const known = Object.assign({ surface: t.surface, fontSet: t.surface === 'sidebar' ? undefined : FONTSET_STUB }, t.ctxOver || {});
    const sel = t.selOver ? Object.assign({}, st, t.selOver) : st;
    // `globals`：有些门住在**模块级替身**里（如 `gpuFrameUi.pinned` 决定"实时帧"那一段画不画），
    // 既不在 ctx 也不在 sel ⇒ 用例临时改写它，**渲染完立刻还原**（含 `continue` 那条路径，
    // 否则会串到后面的用例上）。
    const savedGlobals = t.globals ? Object.keys(t.globals).map((k) => [k, globalThis[k]]) : [];
    if (t.globals) Object.assign(globalThis, t.globals);
    let tree = null;
    let err = '';
    try { tree = panelMod[t.fn](ctxFrom(t.fn, sel, known)); } catch (e) { err = String((e && e.message) || e); }
    for (const [k, v] of savedGlobals) globalThis[k] = v;
    check(t.fn + t.label + ' 渲染得出', err === '', err || 'ok');
    if (err) continue;
    // ── 端到端：**按面板宽度等比缩放**（「左右拉宽、顶格」）──────────────────
    //    判据自己从源码取设计常量、**独立复算** scale，再逐个核对渲染树里的行内尺寸：
    //    只判"渲染得出"不够 —— 缩放漏接一处（卡放大了、立绘没放大）照样渲染得出。
    if (t.geomProbe) {
      const src = tabsSrc;
      const nc = (re) => Number((src.match(re) || [])[1]);
      const BOX = nc(/const MASCOT_BOX_PX = (\d+);/);
      const FACTOR = nc(/const MASCOT_RING_FACTOR = ([\d.]+);/);
      const PERSP = nc(/const MASCOT_PERSP_PX = (\d+);/);
      const PAD = nc(/const MASCOT_CARD_PAD_PX = (\d+);/);
      const DESIGN_W = nc(/const MASCOT_DESIGN_PANE_PX = (\d+);/);
      const S_MAX = nc(/const MASCOT_SCALE_MAX = ([\d.]+);/);
      const ROPE_FORMS_SRC = readFileSync(join(root, 'src', 'client.js'), 'utf8');
      const boxes = [...ROPE_FORMS_SRC.matchAll(/img: ROPE_IMG\w*,\s+w: (\d+), h: (\d+) \}/g)]
        .map((m) => ({ w: Number(m[1]), h: Number(m[2]) }));
      const n = boxes.length + 1;                     // + 「自定义」
      const S = Math.round(Math.min(S_MAX, Math.max(1, t.geomProbe / DESIGN_W)) * 100) / 100;
      const at = (v) => Math.round(v * S);
      const wantBox = at(BOX);
      const wantR = at((BOX / 2) / Math.tan(Math.PI / n) * FACTOR);
      const wantPersp = at(PERSP);
      const wantCardH = at(Math.max(...boxes.map((b) => b.h))) + PAD;
      const items = [];
      const arts = [];
      let winStyle = null;
      (function walk(node) {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        const cls = typeof node.props?.className === 'string' ? node.props.className : '';
        if (cls.split(/\s+/).includes('we-picker__mascot-item')) items.push(node);
        if (cls.split(/\s+/).includes('we-picker__mascot-art')) arts.push(node);
        if (cls.split(/\s+/).includes('we-picker__mascot-window')) winStyle = node.props.style || {};
        if (cls.split(/\s+/).includes('we-picker__mascot-stage')) {
          const ps = node.props.style || {};
          check(t.label + ' 舞台透视也乘了 scale（否则放大率会漂）',
            String(ps.perspective) === wantPersp + 'px',
            'want ' + wantPersp + 'px got ' + String(ps.perspective));
        }
        if (Array.isArray(node.children)) node.children.forEach(walk);
      })(tree);
      check(t.label + ' scale 复算非 1（否则这条判据在空转）', S > 1, 'S=' + S);
      check(t.label + ' 卡宽 = 设计卡宽 × scale',
        items.length >= 3 && items.every((it) => String(it.props.style.width) === wantBox + 'px'),
        'want ' + wantBox + 'px got ' + (items[0] && String(items[0].props.style.width)));
      check(t.label + ' 半径 = 公式 × scale',
        items.every((it) => String(it.props.style.transform).includes('translateZ(' + wantR + 'px)')),
        'want ' + wantR + 'px got ' + (items[0] && String(items[0].props.style.transform)));
      check(t.label + ' 卡高 = (最高立绘 + 余量) × scale',
        items.every((it) => String(it.props.style.height) === wantCardH + 'px'),
        'want ' + wantCardH + 'px got ' + (items[0] && String(items[0].props.style.height)));
      check(t.label + ' 立绘盒也随 scale 放大（只放大卡就是"缩放接了一半"）',
        arts.length >= 3 && arts.every((a) => Number(String(a.props.style.width).replace('px', '')) > BOX),
        'arts=' + arts.length + ' 首个宽=' + (arts[0] && String(arts[0].props.style.width)));
      check(t.label + ' 窗口高容得下透视放大后的卡（截断那条判据在缩放下仍成立）',
        Number(String(winStyle && winStyle.height).replace('px', ''))
          >= wantCardH * (wantPersp / (wantPersp - wantR)),
        '窗口高 ' + (winStyle && winStyle.height) + ' vs 投影高 '
          + (wantCardH * (wantPersp / (wantPersp - wantR))).toFixed(1));
      // 负对照：把 scale 当成 1（即设计档尺寸）必须被上面同一条卡宽判据判出
      check(t.label + ' negative control: 拿设计档卡宽（' + BOX + 'px）会被同一条判据判出',
        wantBox !== BOX, wantBox + ' vs ' + BOX);
    }
    const seq = sectionSeq(tree);
    if (t.want) {
      check(t.fn + t.label + ' 的节顺序与集合逐字不变', sameSeq(seq, t.want),
        'want=[' + t.want.join(' / ') + '] got=[' + seq.join(' / ') + ']');
    }
    // 细锚：**控件标签的有序序列**（`renderEffectsTab` 只有一个节标签，靠这条才钉得住内部结构）。
    // 用类名锚的档（如转码进度：裸 div 拼的）**不设** `wantLabels` ⇒ 这条必须守卫，
    // 否则 `sameSeq(labels, undefined)` 会当场崩，而不是判红（崩了就没有那条结论）。
    if (t.wantLabels) {
      const labels = labelSeq(tree);
      check(t.fn + t.label + ' 的控件标签顺序与集合逐字不变',
        sameSeq(labels, t.wantLabels),
        'want=[' + t.wantLabels.join(' / ') + '] got=[' + labels.join(' / ') + ']');
      // ── 简化配置 / 高级配置的**边界**（ADR-0008 **D4**；二次修订）──
      //   简化配置（两档都画）= 全局四件套 + 各面**总开关**（思考块液态玻璃 / 左侧栏液态玻璃 /
      //   侧栏那三个开关）；**预设方案**只在设置档（跨面快照覆盖 + 无撤销 ⇒ 不进窄面板）；
      //   高级配置 = 每个面的「独立配置」层**及其子项**、思考块门下的细调行（胶囊雾化 /
      //   胶囊颜色）—— 起**迁入侧栏「详细玻璃调节」折叠块**（默认收起；
      //   设置页对话框挡住主页面、调完看不到实时效果是迁移动因），设置档一个都不许有。
      //   判定走 `ctx.surface` + `ctxOver.glassDetailOpen`（折叠态）；配套的 quick-panel
      //   占位器现在只剩 `glassPresets` 与播放页字段（高级行处理器已改传真值）。
      //   两个方向都钉：侧栏默认收起 ⇒ 独立配置 = 0；展开 ⇒ ≥ 1；设置档恒 0；总开关**必须还在**
      //   （防"一刀切藏整节"）。
      // ⚠️ 这道判据只对**带「玻璃 UI」节**的档判（其它页签本来就没有独立配置层）；
      //    它必须住在**跑得到外观用例的那个循环**里 —— 上一版住在旧的 `CASES` 循环、
      //    而外观用例早已搬进 `MORE_CASES` ⇒ 那条判据当时是**空转的**（实测：改口径它不红）。
      const indep = labels.filter((l) => l.includes('独立配置'));
      // 预设块的标签（`预设方案`）**也进标签序列** —— 它由 `ctlText` 画成一行 `we-picker__ctl`，
      // 与滑块 / 开关同族。所以两侧都钉得住：序列里不许有（侧栏档）/ 必须有（设置档），
      // 再加一条整树文本锚兜住"块被画了但标签换了写法"的形态。
      const flat = JSON.stringify(tree);
      const PRESET_MARK = '保存当前为预设';
      const presetLeak = [PRESET_MARK, '预设方案'].filter((s) => flat.includes(s));
      if ((t.want || []).includes('玻璃 UI')) {
        //  真迁移后的 D4：**高级行（独立配置层 / 胶囊细调）只在侧栏档、且
        // 「详细玻璃调节」展开时画**；设置档一个都不许有（它们搬走了）。预设方案相反 ——
        // 仍只在设置档（跨面快照覆盖 + 无撤销，不进随手可点的窄面板）。
        // 折叠态用 `ctxOver.glassDetailOpen` / `ctxOver.fontOpen` 认（默认收起 ⇒ 用例不给 = 收起）。
        const detailOpen = !!(t.ctxOver && t.ctxOver.glassDetailOpen);
        const fontOpen = !!(t.ctxOver && t.ctxOver.fontOpen);
        // ── 整节折叠（**二次修订**：两档都能折叠，差别只在**默认值**）──────────
        //    用户口径：侧边栏「后面三个默认隐藏」、设置页「全部开启但也支持隐藏」。
        //    ⚠️ 默认值由**面板组件**算（`readQpOpen` / `readSavedPickerOpen`），本台是
        //    **直接调渲染器**（隔离测试）⇒ 这里只能判"渲染器**尊重**传进来的开合"：
        //    展开 ⇒ 节内标签必须在；收起 ⇒ 节头在（唯一入口）而节内标签一个都不许在。
        //    "哪一档默认开、哪一档默认收"另有**源码级**判据（见本文件后面的默认值一组）——
        //    隔离测试证明不了默认值，两件事必须分开测（这条教训来自"拉宽没生效"那次）。
        //    探针取每节里**最靠前且不挂任何其它门**的那一个标签。
        for (const [key, secLabel, probe] of [
          ['detailOpen', '细节', '边框'],
          ['glassUiOpen', '玻璃 UI', '玻璃透明度'],
          ['cornersOpen', '侧边栏圆角', '左侧栏 · 统一圆角'],
        ]) {
          const on = !!(t.ctxOver && t.ctxOver[key]);
          const headThere = flat.includes(secLabel);
          const probeThere = labels.includes(probe) || flat.includes(probe);
          if (on) {
            check(t.fn + t.label + ' 「' + secLabel + '」节展开 ⇒ 内容必须在',
              probeThere, probeThere ? '在' : '缺：' + probe);
          } else {
            check(t.fn + t.label + ' 「' + secLabel + '」整节收起 ⇒ 节头在（唯一入口）而内容不画',
              headThere && !probeThere,
              '节头=' + (headThere ? '在' : '缺') + ' 内容=' + (probeThere ? '泄漏:' + probe : '未画'));
          }
        }
        // ── **两档都必须是"可折叠节头"**（二次修订的核心）────────────────────────────
        //    旧口径是"设置页节头纯标题"，现在用户要求设置页**也支持隐藏** ⇒ 反转成：
        //    两档的这三个节头都必须带 role=button + aria-expanded + caret（点得动、读屏能报态）。
        //    ⚠️ 判据读**树**：只在源码里写 `collapsible = true` 而忘了传 onToggle 时，
        //    aria-expanded 还在但点了没反应 —— 所以同时要求 `onClick` 是个函数。
        {
          const headOf = (root, label) => {
            let hit = null;
            (function walk(node) {
              if (hit !== null || !node || typeof node !== 'object') return;
              if (Array.isArray(node)) { node.forEach(walk); return; }
              const cls = typeof node.props?.className === 'string' ? node.props.className : '';
              if (cls.includes('we-picker__section-head') && JSON.stringify(node).includes(label)) { hit = node; return; }
              if (Array.isArray(node.children)) node.children.forEach(walk);
            })(root);
            return hit;
          };
          for (const secLabel of ['细节', '玻璃 UI', '侧边栏圆角', '全局 UI 配色', '全局字体']) {
            const h = headOf(tree, secLabel);
            const c = h ? String(h.props?.className || '') : '';
            const ok = !!h && c.includes('we-picker__section-head--toggle')
              && h.props.role === 'button' && 'aria-expanded' in h.props
              && typeof h.props.onClick === 'function';
            check(t.fn + t.label + ' 「' + secLabel + '」节头必须可折叠（两档都支持隐藏）',
              ok, h ? ('toggle=' + c.includes('we-picker__section-head--toggle')
                + ' role=' + h.props.role + ' aria=' + ('aria-expanded' in h.props)
                + ' onClick=' + (typeof h.props.onClick === 'function')) : '找不到该节头');
          }
        }
        if (t.surface === 'sidebar') {
          if (detailOpen) {
            check(t.fn + t.label + ' 侧栏档 · 详细玻璃调节展开 ⇒ 必须有「独立配置」层（D4 迁移的目的地）',
              indep.length >= 1, indep.length + ' 个：' + indep.join(' / '));
          } else {
            check(t.fn + t.label + ' 侧栏档（默认收起）不许出现「独立配置」层（折叠门，D4）',
              indep.length === 0, indep.length + ' 个：' + indep.join(' / '));
          }
          check(t.fn + t.label + ' 侧栏档不许出现预设块（预设仍设置页专属，D4）',
            presetLeak.length === 0, presetLeak.length ? '泄漏：' + presetLeak.join(' / ') : '无泄漏');
          // ⚠️ 下面两条只在**玻璃 UI 整节展开**时成立：整节收起 ⇒ 简化配置也一并不画
          //    （那是的新门）。不按门分档的话，这条老判据会把"整节收起"
          //    误判成"简化配置丢了"。收起档要判的是**相反**的东西 —— 见上面那组整节判据。
          if (t.ctxOver && t.ctxOver.glassUiOpen) {
            for (const sw of ['思考块液态玻璃', '左侧栏液态玻璃']) {
              check(t.fn + t.label + ' 侧栏档仍画总开关「' + sw + '」（简化配置，D4）',
                labels.includes(sw), labels.includes(sw) ? '在' : '缺：' + sw);
            }
            // 「详细玻璃调节」开关本身两态都画（它是收起时唯一的入口）。
            check(t.fn + t.label + ' 侧栏档画「详细玻璃调节」开关（折叠块的入口）',
              labels.includes('详细玻璃调节'), labels.includes('详细玻璃调节') ? '在' : '缺：详细玻璃调节');
          }
          if (fontOpen) {
            check(t.fn + ' 侧栏档 · 字体节展开 + 总开关开 ⇒ 字体行必须在（迁移目的地）',
              labels.includes('字体自定义'), '缺：字体自定义');
          } else {
            check(t.fn + ' 侧栏档（字体节默认收起）不许出现「字体自定义」（折叠门，D4）',
              !labels.includes('字体自定义'), '泄漏：' + labels.filter((l) => l === '字体自定义').join(''));
          }
        } else {
          // 设置档：**玻璃**高级行仍不许出现（真迁移的反向钉，未变）。
          check(t.fn + t.label + ' 设置档不许出现任何「独立配置」层（已迁侧栏折叠块，D4）',
            indep.length === 0, indep.length + ' 个：' + indep.join(' / '));
          // ⚠️ 这里原有三条「设置档节头是**纯标题**（不随侧栏折叠）」的判据，
          //    **二次修订**后按用户口径（"设置页也支持隐藏"）**反转**了 —— 现在两档都必须是
          //    可折叠节头，那三条已由上面那组「节头必须可折叠（两档都支持隐藏）」取代。
          //    反转而不是删除：这条性质真的会回退（谁把 `collapsible` 写回 surface 判断就中了）。
          // ⚠️ **字体节已回到设置页**（三次修订，用户口径"两边都有"）⇒ 这一条不再是
          //    "迁移的反向钉"，而是与侧栏**同形**的**折叠门**判据：展开 ⇒ 字体行必须在；
          //    收起 ⇒ 不许有。两个 surface 走同一条判据，正是"两档都画"的字面含义。
          if (fontOpen) {
            check(t.fn + t.label + ' 设置档 · 字体节展开 + 总开关开 ⇒ 字体行必须在（三次修订：字体节回到设置页）',
              labels.includes('字体自定义'), '缺：字体自定义');
          } else {
            check(t.fn + t.label + ' 设置档（字体节默认收起）不许出现「字体自定义」（折叠门，D4）',
              !labels.includes('字体自定义'), '泄漏：' + labels.filter((l) => l === '字体自定义').join(''));
          }
          check(t.fn + t.label + ' 设置档不许出现「详细玻璃调节」开关（那是侧栏折叠块的入口）',
            !labels.includes('详细玻璃调节'), '泄漏：' + labels.filter((l) => l === '详细玻璃调节').join(''));
          // 门的另一侧：能画出来的时候才判（用例给了 `presets` 替身）—— 否则这条会恒假。
          //  起「主题预设」与其他节同口径可折叠：ctxOver 给了 `presetsOpen: true`
          // 的用例判**整块在**（网格 + 保存行）；没给（= 收起档）的用例反过来判**网格不许在**
          // —— 节头本身由 want 的节序列钉住（'主题预设' 一直在，它是重新展开的唯一入口）。
          if (t.ctxOver && t.ctxOver.glassPresets) {
            if (t.ctxOver.presetsOpen === true) {
              check(t.fn + t.label + ' 设置档必须画预设块（预设仍住设置页，D4）',
                labels.includes('预设方案') && flat.includes(PRESET_MARK),
                labels.includes('预设方案') ? '标签与按钮都在' : '缺：预设方案 / ' + PRESET_MARK);
            } else {
              check(t.fn + t.label + ' 设置档 · 主题预设收起 ⇒ 预设网格不画（折叠门）',
                !labels.includes('预设方案') && !flat.includes(PRESET_MARK),
                '泄漏：' + (labels.includes('预设方案') ? '预设方案 ' : '') + (flat.includes(PRESET_MARK) ? PRESET_MARK : ''));
            }
          }
        }
      }
    }
    if (t.wantTexts) {
      const texts = textKinds(tree);
      const missingTexts = t.wantTexts.filter((s0) => !texts.includes(s0));
      check(t.fn + t.label + ' 渲染出了该档应有的文案（文本锚）', missingTexts.length === 0,
        '缺=[' + missingTexts.join(' | ') + '] 共 ' + texts.length + ' 条字符串');
    }
    if (t.wantClasses) {
      const kinds = classKinds(tree);
      const missing = t.wantClasses.filter((c) => !kinds.some((k) => k.includes(c)));
      check(t.fn + t.label + ' 画出了该档应有的控件种类（类名锚）', missing.length === 0,
        'want⊆got? 缺=[' + missing.join(', ') + '] got=' + kinds.length + ' 种');
    }
    if (t.rejectClasses) {
      const kinds = classKinds(tree);
      const present = t.rejectClasses.filter((c) => kinds.some((k) => k.includes(c)));
      check(t.fn + t.label + ' 不该出现的构件一个都没画（门的另一侧）', present.length === 0,
        '多出=[' + present.join(', ') + ']');
    }
    if (process.env.DSH_WE_SHOW_LABELS) {
      const all = [];
      (function walk(n) {
        if (Array.isArray(n)) { n.forEach(walk); return; }
        if (!n || typeof n !== 'object') return;
        if (Array.isArray(n.children)) { for (const c of n.children) if (typeof c === 'string') all.push(c); }
        if (Array.isArray(n.children)) n.children.forEach(walk);
      })(tree);
      // ⚠️ 这里**不能**复用上面 `if (t.wantLabels)` 块里的 `labels`：那个 `const` 在块作用域内，
      // 走到本行已经出界 ⇒ 一旦设了 `DSH_WE_SHOW_LABELS` 就 ReferenceError（本行原来就是那么写的，
      // 是 ESLint `no-undef` 抓出来的真缺陷）。上面 `:5201` 那处 dump 一直是现算的，此处照同一写法。
      console.log('    LABELS ' + t.fn + t.label + ' = ' + JSON.stringify(labelSeq(tree)));
      console.log('    STRINGS(' + all.length + ') hasFontPreset=' + all.some((s) => s.includes('字体集预设'))
        + ' hasRole=' + all.some((s) => s.includes('角色')) + ' sample=' + JSON.stringify(all.slice(0, 14)));
    }
  }
  // 负对照：上面这条"侧栏档少两节"必须真的来自门，而不是来自"侧栏档根本没渲染"。
  check('覆盖面：ctx 驱动的用例数 ≥ 5 且全部带控件标签期望（MORE_CASES 循环之后 —— 定义在它之前会撞 TDZ）',
    MORE_CASES.length >= 5 && MORE_CASES.filter((c) => c.wantLabels).length >= 5,
    'cases=' + MORE_CASES.length + ' withLabels=' + MORE_CASES.filter((c) => c.wantLabels).length);
  check('覆盖面：每个渲染用例都必须声明 `want`（关掉上面那条守卫空转的可能）',
    [...CASES, ...MORE_CASES].every((c) => Array.isArray(c.want) && c.want.length > 0),
    'cases=' + (CASES.length + MORE_CASES.length));
  // 锚体系的**覆盖面地板**：三种锚都必须被真的用上 —— 否则它们会被逐渐掏空
  // （新用例都用最省事的那种锚，另两种慢慢没人用，而"没人用"不会自己变红）。
  {
    const all = [...CASES, ...MORE_CASES];
    const anchorsOk = (cs) => cs.filter((c) => c.wantLabels).length >= 6
      && cs.filter((c) => c.wantClasses).length >= 4
      && cs.filter((c) => c.wantTexts).length >= 2;
    const nLabels = all.filter((c) => c.wantLabels).length;
    const nClasses = all.filter((c) => c.wantClasses || c.rejectClasses).length;
    const nTexts = all.filter((c) => c.wantTexts).length;
    check('覆盖面：三种锚都被真的用上（标签 ≥ 6 · 类名 ≥ 4 · 文本 ≥ 2）',
      anchorsOk(all),
      'labels=' + nLabels + ' classes=' + nClasses + ' texts=' + nTexts + ' cases=' + all.length);
    check('negative control: 只堆一种锚会被同一条地板判出',
      anchorsOk([{ wantLabels: [] }, { wantLabels: [] }, { wantLabels: [] }, { wantLabels: [] },
        { wantLabels: [] }, { wantLabels: [] }]) === false);
  }

  check('负对照：外观页侧栏档确实渲染出了内容（不是空树 ⇒ 上面的"少节数"才有意义）',
    (() => {
      // 侧栏档画「主题 / 细节 / 侧边栏圆角 / 玻璃 UI / 全局字体 / 输入光标」**六节** —— 迁移后
      //（2026-10 新增「侧边栏圆角」节 ⇒ 由五节变六节，与上面两组 want 同步改）
      // 字体节的**节头**进侧栏（折叠门只收内容不收节）；设置档反而只剩四节（字体节整节不在）。
      // ⚠️ 这个数字是**随节数变化**的：新增一节就要同步（它自己就是"节数"那条判据的负对照）。
      try { return sectionSeq(panelMod.renderAppearanceTab(ctxFrom('renderAppearanceTab', st,
        { surface: 'sidebar', fontSet: undefined }))).length === 6; } catch { return false; }
    })());

  // ── 拆成"一节一个子渲染器"之后新增的失败模式：**节用了某个 ctx 字段却没解构它** ──
  // 这类错误的形状是"某个分支一旦被执行就 ReferenceError"，而渲染挂载台只在**走到的分支**上
  // 才撞得见它（本次实测正是这么抓到一处：`...INTERVALS.map(...)` 的展开写法让派生正则漏了它）。
  // 所以再补一条**静态**判据把它按在源码层：以"这个页签的 ctx 字段全集"为词表，逐个节函数检查
  // "用到了却没解构"。先剥注释（规则 ⑦），否则散文里的词会假报。
  const CTX_UNIVERSE = {
    renderWallpaperTab: ['setSetting', 'setTransient', 'INTERVALS', 'armedConfirm', 'cdMode', 'current',
      'editing', 'editorPageView', 'group', 'groups', 'isLiveScene', 'onArmConfirm', 'onArmDeleteGroup',
      'onCancelEditUploadDir', 'onCancelEditWeAssetsDir', 'onClear', 'onDeleteGroup', 'onDisarmConfirm',
      'onEditInterval', 'onEditName', 'onEditOrder', 'onGroupChange', 'onGroupInterval', 'onOpenPicker',
      'onOpenPickerDraft', 'onRefresh', 'onStartEditUploadDir', 'onStartEditWeAssetsDir',
      'onSwitchTransition', 'onSwitchTransitionDir', 'onSwitchTransitionSpeed', 'onToggleAudio',
      'onTogglePlay', 'onTogglePropsPanel', 'onToggleRotation', 'onUploadDirDraft', 'onWeAssetsDirDraft',
      'pagerRow', 'playableCount', 'playableList', 'playbackLive', 'propsPanelOpen',
      'renderUserPropsPanel', 'sel', 'setPickerOpener', 'uploadedList'],
    renderAdvancedTab: ['setSetting', 'onAdapterTarget', 'onEdgeCompatChange', 'onLayoutChange',
      'onPauseOnBattery', 'onPauseOnBlur', 'onPauseOnHidden', 'onToggleLiveDiag', 'sel'],
    renderAppearanceTab: ['setSetting', 'officialColorOf', 'onAccent', 'onBlur', 'onBorder',
      'onCaretColor', 'onChatGlassFidelity', 'onComponentFamily', 'onComponentFont', 'onExtraGlassSelectors', 'onFontAdvanced', 'onFontResetAll',
      'onGlassAlpha', 'onGlassColor', 'onGlassFidelity', 'onThinkingMode', 'onLeftSidebarGlass', 'onTitlebarGlass', 'onSidebarAlpha',
      'onSidebarBlur', 'onSidebarColor', 'onSidebarContentAlpha', 'onSidebarContentColor',
      'onSidebarGlass', 'onThemeColor', 'onThemeColorClear', 'onThemeDarkSeparate', 'onThemeFamily',
      'onThemeSize', 'onThemeTypeOnly', 'onThemeWeight', 'onToggleFontCustom', 'onToggleThemeFollow',
      'fontSet', 'sel', 'surface'],
  };
  // ⚠️ `tabsSrcNow` 在本块顶部声明（归一成 LF）—— 这里不再重复声明。
  /** 某页签的节函数（`render<Domain>…Section`）—— 拆分后的每一节。 */
  const sectionFnsOf = (domain) => {
    const out = [];
    const re = new RegExp('^  function (render' + domain + '\\w*Section)\\(ctx\\) \\{$', 'gm');
    for (const m of tabsSrcNow.matchAll(re)) {
      const to = tabsSrcNow.indexOf('\n  }\n', m.index);
      out.push({ name: m[1], body: tabsSrcNow.slice(m.index, to < 0 ? tabsSrcNow.length : to) });
    }
    return out;
  };
  const USED = (code, n) => new RegExp('(^|[^.\\w$]|\\.\\.\\.)' + n + '\\b(?!\\s*:)').test(code);
  const missingCtx = [];
  let sectionCount = 0;
  for (const [tab, all] of Object.entries(CTX_UNIVERSE)) {
    const domain = tab.replace(/^render/, '').replace(/Tab$/, '');
    const at = tabsSrcNow.indexOf('function ' + tab + '(ctx) {');
    const body = tabsSrcNow.slice(at, tabsSrcNow.indexOf('\n  }\n', at));
    const fns = [{ name: tab, body }, ...sectionFnsOf(domain)];
    for (const f of fns) {
      if (f.name.includes('Section')) sectionCount++;
      const code = stripComments(f.body);
      const dm = /const \{([^}]*)\} = ctx;/.exec(code);
      const own = dm ? dm[1].split(',').map((s) => s.trim().split(':')[0].trim()).filter(Boolean) : [];
      for (const n of all) if (USED(code, n) && !own.includes(n)) missingCtx.push(f.name + '→' + n);
    }
  }
  check('每个节函数都用到了 ctx 字段就解构它（覆盖面 ' + sectionCount + ' 个节函数）',
    sectionCount >= 8 && missingCtx.length === 0,
    'sections=' + sectionCount + (missingCtx.length ? ' · 漏解构=' + missingCtx.join(', ') : ''));
  check('负对照：用了却没解构的节函数会被同一判据抓出',
    (() => {
      const code = stripComments('function renderXSection(ctx) {\n const { sel } = ctx;\n ...INTERVALS.map((m) => m);\n}');
      return USED(code, 'INTERVALS') && !['sel'].includes('INTERVALS');
    })());
  check('负对照：对象键形态（`{ sel: … }`）不得被误报为"用到 ctx 字段"', !USED('const o = { sel: 1 };', 'sel'));
}

// 用户口径：吉祥物**点一下要能开也能关**侧栏 —— 点击必须进统一开关；
// 恒走 openPanel/openTab 就会变成只能开不能关。
// 判据按真实源码形态：点击分支走统一开关（不残留只开的 openPanel）、官方态 toggle 的
// 收起条件（展开 + 正显示本 kind）、手势的上推=关。
{
  const ropeActivate = (text) => /!d\.moved\) wallSidebarToggle\(\)/.test(text)
    && /wallSidebarOpen\(\)/.test(text)
    && /wallSidebarClose\(\)/.test(text)
    && !/openPanel\(/.test(text);
  check('吉祥物点击 = 开/关切换（官方态能关；下拉=开、上推=关走同一组开关）',
    ropeActivate(src) && src.includes('wallSidebarToggle()'));
  check('negative control: 「只开不关」的旧形态会被同一条判据判出',
    !ropeActivate('if (!canceled && !d.moved) openPanel();'));
  check('官方态 toggle 语义：展开且正显示「壁纸」才收起（别人的 tab 不替用户关）',
    sidebarSrc.includes('function sidebarRightOursActive(')
      && sidebarSrc.includes('a.kind === WE_SIDEBAR_KIND')
      && sidebarSrc.includes('weSidebarCtrl.isExpanded()')
      && sidebarSrc.includes('weSidebarCtrl.toggleExpanded()'));
  check('抽屉桥：RopeDock 注册三动作、隐藏/卸载时撤销（快捷键与点击共用同一入口）',
    src.includes('ropeDrawerControl = {') && src.includes('toggle: () => setOpen((o) => !o)')
      && src.includes('ropeDrawerControl = null;'));
}
// 快捷键（官方桌面默认 Cmd/Ctrl+Alt+W）：注册进宿主 shortcuts 服务，命令可改键；
// 无面板可开时 resolve=pass（不吞按键）；不写进 inject（缺服务的旧宿主不该 park）。
check('壁纸侧栏快捷键：走宿主 shortcuts 服务 + 桌面三档默认 primary+alt+W + pass 兜底',
  src.includes('installWallSidebarShortcut(ctx)')
    && sidebarSrc.includes('function installWallSidebarShortcut(')
    && sidebarSrc.includes('ctx.get("shortcuts")')
    && sidebarSrc.includes('shortcuts.register({')
    && sidebarSrc.includes('"wallpaper.sidebar.toggle"')
    && sidebarSrc.includes('"desktop:macos": { code: "KeyW", modifiers: ["primary", "alt"] }')
    && sidebarSrc.includes('"desktop:windows": { code: "KeyW", modifiers: ["primary", "alt"] }')
    && sidebarSrc.includes('"desktop:linux": { code: "KeyW", modifiers: ["primary", "alt"] }')
    && sidebarSrc.includes('{ status: "pass" }'));

// 设置入口的触发钮选取：官方应用里带 aria-haspopup="dialog" 的按钮
// 有十几个（TurnUsagePanel / StatsPills / ContextMeter / 插件管理器 / 任务管理器日期时间
// 选择器…），且都在左栏「设置」之前 —— 文档序取第一个必然点错，症状就是应用里
// 「壁纸引擎设置」无反应。判据：**按可读名字挑 + 必须没有裸首个匹配回退**。
//
// ⚠️ 本判据此前还断言了 `sidebarSrc.includes('/设置|Settings/i.test')` ——
//    那是**把措辞钉进判据**（见 docs/adr/0007）：锚点后来改成 locale 感知的候选集
//    （`isSettingsText` / `settingsLabelCandidates`），旧断言就开始拦正确的修复。
//    现在只断言**机制**（有按名字过滤、有排除自家入口、有无名字兜底、有重入锁），
//    不断言锚点怎么写 —— 怎么写属于实现，措辞与候选集由约定承担。
check('设置入口按可读名字选触发钮（不再取文档序第一个 dialog 按钮）',
  sidebarSrc.includes('function findSettingsTrigger(')
    && sidebarSrc.includes('function isSettingsText(')
    && sidebarSrc.includes('const named = dialogTriggers.filter(isSettingsLabel)')
    && !/querySelector\('button\[aria-haspopup="dialog"\]'\)/.test(sidebarSrc)
    && sidebarSrc.includes('findAccountMenuTrigger') && sidebarSrc.includes('findSettingsMenuItem')
    && sidebarSrc.includes('button[aria-haspopup="menu"][data-collapsed]') // 账号菜单触发钮（AccountMenu 的确定性锚）
    && sidebarSrc.includes('cand=[')
    && sidebarSrc.includes('data-we-qp-entry') // 必须排除自己的「壁纸引擎设置 ›」入口（实测曾自误中递归）
    && sidebarSrc.includes('openSettingsBusy')); // 重入锁

// 名字匹配必须**容忍宿主给标签加的修饰**：宿主左栏那颗入口实测文本是 `全局设置`（不是裸
// `设置`），桌面壳里还有 `Global settings`。相等匹配在宿主换措辞时**静默**失效 —— 症状就是
// 面板底栏那颗「壁纸引擎设置」点了没反应（诊断里落 `trigger=none` + 6s 后
// `settings-entry-timeout dialog=false`）。判据钉**机制**：`isSettingsText` 走包含匹配，
// 且候选集里带着那两条带修饰的宿主原文（照字面在册，见 verify-i18n 的 VALUE_ALLOW）。
check('设置入口的名字匹配容忍宿主标签的修饰（包含匹配 + 长候选优先）',
  /settingsLabelCandidates\(\)\s*\n?\s*\.slice\(\)\s*\n?\s*\.sort\(\(a, b\) => b\.length - a\.length\)/.test(sidebarSrc)
    && /\.some\(\(c\) => t\.includes\(c\)\)/.test(sidebarSrc)
    && !/settingsLabelCandidates\(\)\.includes\(t\)/.test(sidebarSrc)
    && /push\("全局设置"\)/.test(sidebarSrc)
    && /push\("Global settings"\)/.test(sidebarSrc));

// 应用侧诊断：入口找没找到/点的是谁/有没有落到本节（写宿主 diag 文件，跨实例可回读）。
check('设置入口带落盘诊断（settings-entry / settings-entry-timeout）',
  sidebarSrc.includes('reportClientDiag("settings-entry",')
    && sidebarSrc.includes('"settings-entry-timeout"'));
// 封面重试窗：桥出封面可能滞后换曲（抽帧/下载），4 次×0.7s 的旧窗口会让整首歌没封面。
check('封面重试窗拉长到 12 次 + 退避（封顶 4s，覆盖 ~40s）',
  src.includes('MEDIA_ART_MAX_TRIES = 12') && src.includes('Math.min(700 * mediaArtTries, 4000)'));
// 失败记忆（sceneLiveFailures，持久降级）只在**用户手动选中**时清除：手动点开 =
// 想看它 live，重试一次（真失败会自动回退并重新记账）。启动恢复 / revalidate /
// 轮换提交都不清 —— 凡路过就清等于没记忆（smoke L2 钉住该不变量）。
check('live 失败记忆只在用户手动选中时清除（fromManual 显式传入）',
  src.includes('function clearLiveFailure(') && prepSrc.includes('opts && opts.fromManual')
    && src.includes("applySelection(w.id, { fromManual: true })")
    && src.includes('applySelection(next.id, { fromManual: true })'));
// 封面链路的落盘诊断（media-art*）：只在应用侧复现的失败要能被回读定位。
check('封面链路带落盘诊断（media-art*，每曲最多一条）+ 慢拍不放弃',
  src.includes('"media-art-slow"') && src.includes('"media-art-try-fail"')
    && src.includes('let mediaArtDiag') && src.includes('MEDIA_ART_SLOW_MS')
    && src.includes('slow ? MEDIA_ART_SLOW_MS'));
// ── 诊断族（P2-11 第一族）：注册已搬到 lib/routes/diag.js ⇒ 文本断言按**所属文件**分家 ──
// 行为断言（上面的 Level E 405/413）走 mock webServer，搬去哪个文件都照样有效；这里钉的是
// "这一族只在那个文件里注册"—— 两边各留一份会让同一路径被重复挂载，而卸载只放掉一份。
const diagSrc = readFileSync(join(root, 'lib', 'routes', 'diag.js'), 'utf8');
check('renderer diagnostics sink registered at /diag', /path: '\/diag'/.test(diagSrc) && /diag-log/.test(diagSrc));
// **实测**：同一份渲染页产物里还有一条走 ${BASE}/diag 的告警通道，只挂根路径会让
// 「壁纸黑屏」时最关键的渲染页告警全部 404 静默丢掉。
check('renderer diagnostics also accepted at ${BASE}/diag', diagSrc.includes('path: `${BASE}/diag`'));
check('诊断族只在 lib/routes/diag.js 注册（lib/index.js 只留一次调用）',
  !/path: '\/diag'/.test(hostSrc) && !/path: `\$\{BASE\}\/diag/.test(hostSrc)
  && !/const diagLog = \[\]/.test(hostSrc) && !/const handleDiag = /.test(hostSrc)
  && /registerDiagRoutes\(webServer, \{/.test(hostSrc));
// 负对照：把注册塞回主文件那种写法必须被判出（否则上面这条只是"主文件恰好没这几个字"
const diagBackInMain = "disposers.push(webServer.register({ kind: 'exact', path: '/diag', handler: handleDiag }));";
check('negative control: diag 注册回流 lib/index.js 会被判出', /path: '\/diag'/.test(diagBackInMain));
// 自定义存储位置的目录型条目：up-dir- 前缀（用户自己的内容 / 不参与 /remove）
check('uploads scan tags project dirs with up-dir- prefix', /id: `up-dir-\$\{name\}`/.test(hostSrc));
check('uploads scan resolves scene.pkg for declared scene.json', /resolveSceneMainFileP\(abs, proj\.file\)/.test(hostSrc));

// ── Level E: WE 官方素材（local-assets）端点 + 目录设置 ─────────────────────
// 契约对齐上游 renderer/src/local-assets.ts 的四种请求形；素材 fixture 是
// 合成字节（端点不解析 .tex，只透传字节）。
console.log('Level E — WE local-assets endpoint + assets-dir setting');
const weAssetsFixture = join(TEST_CACHE_DIR, 'we-assets');
rmSync(weAssetsFixture, { recursive: true, force: true });
mkdirSync(join(weAssetsFixture, 'materials', 'util'), { recursive: true });
mkdirSync(join(weAssetsFixture, 'materials', 'particle'), { recursive: true });
mkdirSync(join(weAssetsFixture, 'materials', 'gradient'), { recursive: true });
mkdirSync(join(weAssetsFixture, 'fonts'), { recursive: true });
const NOISE_BYTES = Buffer.from('synthetic-util-noise-tex-bytes');
writeFileSync(join(weAssetsFixture, 'materials', 'util', 'noise.tex'), NOISE_BYTES);
writeFileSync(join(weAssetsFixture, 'materials', 'particle', 'halo.tex'), Buffer.from('synthetic-halo'));
writeFileSync(join(weAssetsFixture, 'materials', 'gradient', 'gradient_0.tex'), Buffer.from('synthetic-gradient'));
const FONT_BYTES = Buffer.from('synthetic-font-bytes');
writeFileSync(join(weAssetsFixture, 'fonts', 'NotoSans.ttf'), FONT_BYTES);

const laRoute = routes.find((r) => r.path === '/api/local-assets');
const weDirRoute = routes.find((r) => r.path === '/wallpaper-engine/we-assets-dir');
check('/api/local-assets route registered as prefix', Boolean(laRoute) && laRoute.kind === 'prefix',
  laRoute ? 'kind=' + laRoute.kind : 'missing');
check('we-assets-dir route registered', Boolean(weDirRoute) && weDirRoute.kind === 'exact');

function fakePostReq(url, body) {
  const listeners = {};
  const req = {
    url, method: 'POST', headers: {},
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); return req; },
  };
  queueMicrotask(() => {
    for (const fn of listeners.data || []) fn(Buffer.from(body));
    for (const fn of listeners.end || []) fn();
  });
  return req;
}
async function postJson(route, url, obj) {
  const res = fakeRes();
  const done = route.handler(fakePostReq(url, JSON.stringify(obj)), res);
  if (done && typeof done.then === 'function') await done;
  if (!res.__state.ended) {
    await new Promise((resolveFn) => {
      const t = setTimeout(resolveFn, 8000);
      res.on('finish', () => { clearTimeout(t); resolveFn(); });
    });
  }
  return res;
}

if (laRoute && weDirRoute) {
  // 未配置素材：探测 ok:false（渲染页静默回落，不是错误）。
  const probe0 = await runHandler(laRoute, '/api/local-assets');
  const probe0Body = JSON.parse(probe0.__state.body.toString('utf8'));
  check('probe before configure → ok:false', probe0.__state.status === 200 && probe0Body.ok === false);

  // POST 校验：不存在的目录 / 缺 materials/ 都 400。
  const badPost = await postJson(weDirRoute, '/wallpaper-engine/we-assets-dir', { dir: join(TEST_CACHE_DIR, 'no-such-dir') });
  check('POST with missing materials/ rejected', badPost.__state.status === 400,
    'status=' + badPost.__state.status);
  const relPost = await postJson(weDirRoute, '/wallpaper-engine/we-assets-dir', { dir: 'relative/path' });
  check('POST with relative path rejected', relPost.__state.status === 400,
    'status=' + relPost.__state.status);

  // 配置合法素材目录 → available + 贴图计数。
  const okPost = await postJson(weDirRoute, '/wallpaper-engine/we-assets-dir', { dir: weAssetsFixture });
  const okBody = JSON.parse(okPost.__state.body.toString('utf8'));
  check('POST valid assets dir accepted (with texture count)',
    okPost.__state.status === 200 && okBody.available === true && okBody.textures === 3,
    'status=' + okPost.__state.status + ' textures=' + okBody.textures);

  const probe1 = await runHandler(laRoute, '/api/local-assets');
  const probe1Body = JSON.parse(probe1.__state.body.toString('utf8'));
  check('probe after configure → ok + roots[0].id=local',
    probe1Body.ok === true && probe1Body.roots && probe1Body.roots[0] && probe1Body.roots[0].id === 'local');

  const idxRes = await runHandler(laRoute, '/api/local-assets/local/materials/index.json');
  const idxBody = JSON.parse(idxRes.__state.body.toString('utf8'));
  check('materials index lists engine names (posix, ext stripped)',
    Array.isArray(idxBody.names)
      && idxBody.names.includes('util/noise')
      && idxBody.names.includes('particle/halo')
      && idxBody.names.includes('gradient/gradient_0'),
    (idxBody.names || []).join(','));

  const texRes = await runHandler(laRoute, '/api/local-assets/local/materials/util/noise.tex');
  check('tex bytes served verbatim', texRes.__state.status === 200
    && texRes.__state.body.equals(NOISE_BYTES), 'status=' + texRes.__state.status);

  const fontRes = await runHandler(laRoute, '/api/local-assets/local/fonts/NotoSans.ttf');
  check('arbitrary file served (fonts fallback path)', fontRes.__state.status === 200
    && fontRes.__state.body.equals(FONT_BYTES), 'status=' + fontRes.__state.status);

  // 安全与错误面：越界 → 403；未知素材源 → 404；缺失文件 → 404。
  // 注意：%2e%2e 会被 WHATWG URL 解析器在 pathname 阶段直接归并掉（到不了
  // 路由），真正能触达路径限定的是编码斜杠（..%2f 在 pathname 里保持编码，
  // 经 decodeURIComponent 后才变成 '/'）—— 用后者测围栏。
  const travRes = await runHandler(laRoute, '/api/local-assets/local/..%2f..%2fetc%2fpasswd');
  check('encoded-slash traversal fenced (403)', travRes.__state.status === 403,
    'status=' + travRes.__state.status);
  const badIdRes = await runHandler(laRoute, '/api/local-assets/nope/materials/index.json');
  check('unknown source id → 404', badIdRes.__state.status === 404, 'status=' + badIdRes.__state.status);
  const missRes = await runHandler(laRoute, '/api/local-assets/local/materials/util/missing.tex');
  check('missing file → 404', missRes.__state.status === 404, 'status=' + missRes.__state.status);

  // 清除（空串）→ 探测回落 ok:false。
  const clearPost = await postJson(weDirRoute, '/wallpaper-engine/we-assets-dir', { dir: '' });
  const clearBody = JSON.parse(clearPost.__state.body.toString('utf8'));
  check('POST empty dir clears the setting', clearPost.__state.status === 200 && clearBody.available === false);
  const probe2 = await runHandler(laRoute, '/api/local-assets');
  check('probe after clear → ok:false', JSON.parse(probe2.__state.body.toString('utf8')).ok === false);
}

// Level D 增补：local-assets 接线的静态契约（防重构丢线）。
check('client gates localAssets=1 on inventory availability',
  /weAssetsAvailable \? "&localAssets=1"/.test(liveSrc));
check('syncLayers key carries local-assets availability',
  /weAssetsAvailable \? "la1"/.test(liveSrc));
check('client posts assets dir to host route',
  /we-assets-dir/.test(src) && /function changeWeAssetsDir/.test(src));
// ⚠️ 读**宿主半**：`weAssetsAvailable()` 的产出点已随清单构建族搬进 `lib/inventory.js`（§★ W-B B1）。
check('host inventory reports weAssets availability',
  /weAssetsAvailable: weAssetsAvailable\(\)/.test(hostHalfSrc));
// ⚠️ 下面这组读**宿主半**：`/api/local-assets` 与 `/we-assets-dir` 已搬进
//    `lib/routes/we-assets.js`（§★ 重构 W-B B1）。本文件头 `hostHalfSrc` 的约定 ——
//    断言"宿主仍实现某契约"必须覆盖族目录，否则"已搬走"会被误报成"契约丢了"。
const weAssetsFamSrc = readFileSync(join(root, 'lib', 'routes', 'we-assets.js'), 'utf8');
/** 被搬走的路由体的指纹（只在这两处路由的响应里出现过）。 */
const movedOut = (t) => /未知素材源/.test(t);
check('host fences local-assets file paths',
  movedOut(hostHalfSrc) && /target\.startsWith\(root \+ sep\)/.test(hostHalfSrc));
check('we-assets 族已搬进 lib/routes/we-assets.js（门面里零残留）',
  !movedOut(hostSrc) && movedOut(weAssetsFamSrc)
    && /path: '\/api\/local-assets'/.test(weAssetsFamSrc)
    && /path: `\$\{BASE\}\/we-assets-dir`/.test(weAssetsFamSrc));
check('negative control: 门面里重新出现被搬走的路由体会被同一条判据拒掉',
  movedOut(hostSrc + '\n  jsonOut(404, { error: `未知素材源：${id}` });'));

// ── teardown ────────────────────────────────────────────────────────────────
try { if (dispose) dispose(); } catch { /* ignore */ }
delete process.env.DSH_WE_STEAM_ROOT;
delete process.env.DSH_WE_UPLOAD_DIR;
rmSync(fixtureRoot, { recursive: true, force: true });
rmSync(TEST_UPLOAD_DIR, { recursive: true, force: true });
rmSync(weAssetsFixture, { recursive: true, force: true });

console.log('');
if (skipNotes.length) {
  console.log(`⚠️  ${skipNotes.length} 条未执行（不是通过，见上面的 ○ 行）：${skipNotes.join('；')}`);
}
if (stats.failed > 0) {
  console.log(`SCENE-LIVE CHECKS FAILED — ${stats.failed} failed, ${stats.passed} passed${skipNotes.length ? `, ${skipNotes.length} skipped` : ''}`);
  process.exit(1);
}
console.log(`ALL SCENE-LIVE CHECKS PASSED (${stats.passed})${skipNotes.length ? ` —— ⚠️ ${skipNotes.length} 条未执行（不是通过，见上面的 ○ 行）` : ''}`);
