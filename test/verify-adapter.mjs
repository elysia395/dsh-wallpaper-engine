#!/usr/bin/env node
/**
 * verify-adapter.mjs — 适配器模式：三档判定表、手选优先级与四处行为落点。
 *
 * 为什么要有这一层：适配目标是**跨两侧的契约** —— 宿主按请求头/UA 观测（lib/index.js
 * 的 observeAdapter），客户端拿上报值 + 本地信号兜底（src/adapter.js），两边用同一套
 * 字面量。判定与行为各改各的不会有任何报错，只会在某个宿主形态下安静地出事：
 * 载荷走错源（网页壁纸 403 黑屏）、外壳材质规则吃进浏览器形态、失焦暂停定格可见画面。
 * 所以本守卫分两层断言：**行为**（打真路由读响应、比 inventory 的入口 URL 形态）与
 * **源码形态**（body 钩子挂摘、外壳选择器门控、面板行的显隐条件）。
 *
 * 分节：
 *   ① schema：四字面量 + 默认 auto + enum 接到同一张表 + 缺键/越界回落
 *   ② 客户端判定（src/adapter.js）：手选 > 宿主上报 > 本地信号、能力矩阵、文案
 *      —— 直接 import 该文件，把它的两个自由变量挂到 globalThis 上（等价于构建期
 *      的同作用域拼接），每种初值用**新 URL 重新 import** 以拿到干净的缓存
 *   ③ 宿主判定表（行为）：三种请求 → 三档；闩锁只增不减；能力头优先于 Electron UA；
 *      手选覆盖体现在 GET /settings 的 adapter.target 上
 *   ④ 媒体源条件启动（行为）：栅栏/桌面 ⇒ 媒体源绝对 URL；裸请求 ⇒ 应用源相对路径；
 *      手选两个方向都能强制
 *   ⑤ 客户端落点（源码形态）：body 属性挂摘、外壳选择器全带门控、面板行与失焦档、
 *      persistence 上报
 *
 * 每条判据都配负对照（把坏输入喂给**同一个**判据函数并断言它判坏），并带覆盖面断言
 *（扫描/计数类判据的集合必须非空，否则解析器返回空表会恒绿）。退出码 0/1。
 *
 * Usage: node test/verify-adapter.mjs
 */

import { readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
// 剥注释：共享的字符串感知实现（test/tools/js-text.mjs）。
import { stripComments } from './tools/js-text.mjs';
// 刀3：样式族取文（8 个域模块 + 组装点，构建序拼接）——别再自己 readFileSync 单文件。
import { styleText, panelText } from './tools/src-scope.mjs';
// 单独 import `src/**` 时补上 bundle 作用域的取词层（中文身份；见 test/tools/weT-shim.mjs）。
import { installWeTShim } from './tools/weT-shim.mjs';
installWeTShim();

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

// ── 隔离：全部写落在 .test-cache（不碰用户真实 config / 上传目录 / HOME）────────
// env 必须在 lib/index.js 被 import **之前**设好：UPLOAD_DIR 在模块加载时解析。
const ISO = join(root, '.test-cache', 'adapter');
rmSync(ISO, { recursive: true, force: true });
const TEST_HOME = join(ISO, 'home');
mkdirSync(TEST_HOME, { recursive: true });
mkdirSync(join(ISO, 'data'), { recursive: true });
mkdirSync(join(ISO, 'uploads'), { recursive: true });
process.env.DSH_WE_CACHE_DIR = join(ISO, 'cache');
process.env.DSH_WE_UPLOAD_DIR = join(ISO, 'uploads');
process.env.DSH_WE_DATA_DIR = join(ISO, 'data');
process.env.HOME = TEST_HOME;
process.env.USERPROFILE = TEST_HOME;

// 合成蒸汽库：一个网页壁纸（webLiveSrc 只对 type=web 且入口文件在的条目计算）。
// 库根只有在 steamapps/common/wallpaper_engine 存在时才被纳入扫描。
const steamRoot = join(ISO, 'steamlib');
const webDir = join(steamRoot, 'steamapps', 'workshop', 'content', '431960', '990003');
mkdirSync(webDir, { recursive: true });
mkdirSync(join(steamRoot, 'steamapps', 'common', 'wallpaper_engine'), { recursive: true });
writeFileSync(join(webDir, 'project.json'), JSON.stringify({
  title: 'Adapter Web Fixture', type: 'web', file: 'index.html', preview: 'preview.jpg',
  contentrating: 'Everyone',
}));
writeFileSync(join(webDir, 'index.html'), '<!doctype html><html><body>adapter</body></html>');
writeFileSync(join(webDir, 'preview.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
process.env.DSH_WE_STEAM_ROOT = steamRoot;

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log('  ✓ ' + name + (detail ? ' — ' + detail : ''));
  else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); failed++; }
};

// 三档字面量（与 lib/settings-schema.js 的 ADAPTER_TARGET_VALUES 同源；本表是判据的期望值）
const EXPECTED = ['auto', 'browser', 'desktop-community', 'desktop-official'];
const sameTable = (v) => Array.isArray(v) && v.length === EXPECTED.length
  && EXPECTED.every((x, i) => v[i] === x);

// ═══ ① schema ════════════════════════════════════════════════════════════════
console.log('\n① schema：值表 / 默认值 / enum 接线');
const schemaMod = await import(pathToFileURL(join(root, 'lib', 'settings-schema.js')).href);
check('ADAPTER_TARGET_VALUES 四字面量且顺序固定', sameTable(schemaMod.ADAPTER_TARGET_VALUES),
  JSON.stringify(schemaMod.ADAPTER_TARGET_VALUES));
check('默认 auto + KINDS enum 接到同一张表',
  schemaMod.DEFAULTS.adapterTarget === 'auto' && schemaMod.KINDS.adapterTarget
  && schemaMod.KINDS.adapterTarget.kind === 'enum' && sameTable(schemaMod.KINDS.adapterTarget.values),
  'kind=' + (schemaMod.KINDS.adapterTarget && schemaMod.KINDS.adapterTarget.kind));
check('缺键两侧都读作 auto（手选才生效的前提）',
  schemaMod.sanitizeFromSchema({}, 'client').adapterTarget === 'auto'
  && schemaMod.sanitizeFromSchema({}, 'host').adapterTarget === 'auto');
check('越界值回落 auto（enum 白名单真的有牙）',
  schemaMod.sanitizeFromSchema({ adapterTarget: 'chrome' }, 'client').adapterTarget === 'auto');
check('手选值原样通过（非 auto 的三档不被消毒吃掉）',
  schemaMod.sanitizeFromSchema({ adapterTarget: 'desktop-community' }, 'host').adapterTarget === 'desktop-community');
// 负对照：把期望表喂给同一个判据函数，改一个字必须判假。
check('负对照：值表改一个字 ⇒ 判据变假',
  sameTable(['auto', 'browser', 'desktop-community', 'desktop-officialx']) === false
  && sameTable(EXPECTED.slice(1)) === false);
check('正对照：判据对真表为真（不是恒假）', sameTable(EXPECTED) === true);

// ═══ ② 客户端判定（src/adapter.js）═══════════════════════════════════════════
console.log('\n② 客户端判定：手选 > 宿主上报 > 本地信号');
// 该文件按构建期契约以**同作用域**内联（ADAPTER_TARGET_VALUES 与 selection 都是
// 外部作用域的自由变量）。Node 里把这两个名字挂到 globalThis 上即可复现同一形态。
globalThis.ADAPTER_TARGET_VALUES = schemaMod.ADAPTER_TARGET_VALUES;
let importSeq = 0;
/**
 * 用新 URL 重新 import —— 模块内的判定缓存（adapterLocalTarget）与上报状态是模块级
 * 变量，同一份实例跨用例会互相污染。
 */
async function freshAdapter({ picked = 'auto', host = null, search = '', ua = 'Mozilla/5.0 (Macintosh)' } = {}) {
  globalThis.selection = { adapterTarget: picked };
  Object.defineProperty(globalThis, 'location', { value: { search }, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'document', {
    value: { querySelector: () => null, body: { hasAttribute: () => false } },
    configurable: true, writable: true,
  });
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: ua }, configurable: true, writable: true });
  const mod = await import(pathToFileURL(join(root, 'src', 'adapter.js')).href + '?case=' + (++importSeq));
  if (host) mod.setAdapterFromHost(host);
  return mod;
}
{
  const m = await freshAdapter();
  check('标签表与值表逐键对齐（面板下拉不会出现漏项）',
    sameTable(Object.keys(m.ADAPTER_LABELS)) && EXPECTED.every((k) => typeof m.ADAPTER_LABELS[k] === 'string'
      && m.ADAPTER_LABELS[k].length > 0),
    Object.keys(m.ADAPTER_LABELS).join(','));
  check('无上报 + 无信号 ⇒ 判浏览器（保守初值）', m.resolveAdapterTarget() === 'browser',
    m.resolveAdapterTarget());
}
{
  const m = await freshAdapter({ host: { detected: 'desktop-community', fence: true } });
  check('宿主上报生效（能力头 → 非官方桌面端）', m.resolveAdapterTarget() === 'desktop-community',
    m.resolveAdapterTarget());
  check('能力矩阵：fence=true 且是桌面 ⇒ 失焦档不适用',
    m.adapterCaps().fence === true && m.adapterCaps().desktop === true && m.adapterCaps().blurPause === false);
  check('状态行读到栅栏', /非官方桌面端/.test(m.adapterDetectedLabel()), m.adapterDetectedLabel());
}
{
  const m = await freshAdapter({ picked: 'browser', host: { detected: 'desktop-community', fence: true } });
  check('手选优先于宿主上报', m.resolveAdapterTarget() === 'browser', m.resolveAdapterTarget());
  check('手选浏览器 + 观测到栅栏 ⇒ 给出可执行警示（403）',
    /403/.test(m.adapterMismatchWarning()), m.adapterMismatchWarning());
}
{
  const m = await freshAdapter({ picked: 'desktop-official', host: { detected: 'browser', fence: false } });
  check('手选优先于"观测到浏览器"（反方向同样成立）',
    m.resolveAdapterTarget() === 'desktop-official', m.resolveAdapterTarget());
  check('手选 ≠ 检测 ⇒ 有一句不一致提示', m.adapterMismatchWarning().length > 0, m.adapterMismatchWarning());
}
{
  const m = await freshAdapter({ search: '?dsh-desktop-mode=extended' });
  check('本地信号：壳层查询参数 ⇒ 判桌面（拿不到上报时的兜底）',
    m.resolveAdapterTarget() === 'desktop-official', m.resolveAdapterTarget());
}
{
  const m = await freshAdapter({ ua: 'Mozilla/5.0 Electron/33.2.0' });
  check('本地信号：UA 带 Electron/ ⇒ 判桌面', m.resolveAdapterTarget() === 'desktop-official',
    m.resolveAdapterTarget());
}
{
  const m = await freshAdapter({ picked: 'not-a-target' });
  check('手选值不在表内 ⇒ 当作 auto（回落判定链）',
    m.resolveAdapterTarget() === 'browser', m.resolveAdapterTarget());
}
{
  const m = await freshAdapter();
  m.setAdapterFromHost(undefined);
  m.setAdapterFromHost('nonsense');
  check('宿主没给 adapter 字段时不抛、保持本地判定', m.resolveAdapterTarget() === 'browser');
}
{
  // 负对照：把优先级判据喂给颠倒的输入 —— 上报值不该盖过手选。
  const m = await freshAdapter({ picked: 'browser', host: { detected: 'desktop-official', fence: true } });
  const pickedWins = m.resolveAdapterTarget() === 'browser';
  const hostWins = m.resolveAdapterTarget() === 'desktop-official';
  check('负对照：同一条优先级判据在颠倒实现下会判出差别',
    pickedWins === true && hostWins === false);
}

// ═══ ③④ 宿主（行为）═════════════════════════════════════════════════════════
console.log('\n③④ 宿主判定表与媒体源条件启动（打真路由）');
const hostMod = await import(pathToFileURL(join(root, 'lib', 'index.js')).href);
const host = hostMod.default || hostMod;
const apply = host.apply || (host.inject && host.apply);

function fakeReq(url, headers) {
  return { url, headers: headers || {}, method: 'GET' };
}
function fakeRes() {
  const state = { status: 200, headers: {}, body: Buffer.alloc(0), ended: false };
  const res = new Writable({
    write(chunk, enc, cb) {
      state.body = Buffer.concat([state.body, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]); cb();
    },
    final(cb) { state.ended = true; cb(); },
  });
  res.setHeader = (k, v) => { state.headers[k] = v; };
  res.writeHead = (s, h) => { state.status = s; if (h) Object.assign(state.headers, h); };
  Object.defineProperty(res, 'statusCode', { get: () => state.status, set: (v) => { state.status = v; } });
  res.on('finish', () => {});
  res.__state = state;
  return res;
}
async function runHandler(route, url, headers) {
  const res = fakeRes();
  const done = route.handler(fakeReq(url, headers), res);
  if (done && typeof done.then === 'function') await done;
  if (!res.__state.ended) {
    await new Promise((r) => {
      const t = setTimeout(r, 8000);
      res.on('finish', () => { clearTimeout(t); r(); });
    });
  }
  return res;
}
/** 一次新的 apply() = 一个干净的闩锁（闩锁住 apply 作用域，见 lib/index.js 的 3c-0）。 */
function freshApply() {
  const routes = [];
  const dispose = apply({
    webServer: {
      register(route) { routes.push(route); return () => {}; },
      tapIndex() { return () => {}; },
    },
  });
  return { routes, dispose, find: (p) => routes.find((r) => r.path === p) };
}
const FENCE = { 'x-dsh-desktop-renderer': '1', 'user-agent': 'Electron/33.2.0' };
const ELECTRON_ONLY = { 'user-agent': 'Electron/33.2.0' };
const CONFIG_PATH = join(ISO, 'data', 'config.json');
const writeAdapterSetting = (value) => {
  mkdirSync(join(ISO, 'data'), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify({ settings: { adapterTarget: value } }));
};
const clearAdapterSetting = () => { writeFileSync(CONFIG_PATH, JSON.stringify({})); };
const settingsAdapter = async (app, headers) => {
  const route = app.find('/wallpaper-engine/settings');
  if (!route) return null;
  const res = await runHandler(route, '/wallpaper-engine/settings', headers);
  try { return JSON.parse(res.__state.body.toString('utf8')).adapter || null; } catch { return null; }
};
const inventoryWebSrc = async (app, headers) => {
  const route = app.find('/wallpaper-engine/inventory');
  if (!route) return null;
  const res = await runHandler(route, '/wallpaper-engine/inventory', headers);
  try {
    const body = JSON.parse(res.__state.body.toString('utf8'));
    const web = (body.wallpapers || []).find((w) => w.id === '990003') || null;
    return web ? String(web.webLiveSrc || '') : null;
  } catch { return null; }
};

clearAdapterSetting();
{
  const app = freshApply();
  const a = await settingsAdapter(app, FENCE);
  check('能力头 ⇒ detected=desktop-community（栅栏属于社区壳）',
    a && a.detected === 'desktop-community' && a.fence === true, JSON.stringify(a));
  const src = await inventoryWebSrc(app, FENCE);
  check('有栅栏 ⇒ 网页壁纸载荷是媒体源绝对 URL（事故闸门）',
    /^http:\/\/127\.0\.0\.1:\d+\/wallpaper-engine\/scene-files\//.test(String(src)), String(src).slice(0, 70));
  app.dispose();
}
{
  const app = freshApply();
  const a = await settingsAdapter(app, ELECTRON_ONLY);
  check('无能力头 + Electron UA ⇒ detected=desktop-official（栅栏 false）',
    a && a.detected === 'desktop-official' && a.fence === false, JSON.stringify(a));
  const src = await inventoryWebSrc(app, ELECTRON_ONLY);
  check('桌面壳（无栅栏）⇒ 仍走媒体源（安全默认，不因判官民而改）',
    /^http:\/\/127\.0\.0\.1:\d+\/wallpaper-engine\/scene-files\//.test(String(src)), String(src).slice(0, 70));
  app.dispose();
}
{
  const app = freshApply();
  const a = await settingsAdapter(app, {});
  check('裸请求（无头无 Electron）⇒ detected=browser',
    a && a.detected === 'browser' && a.fence === false, JSON.stringify(a));
  const src = await inventoryWebSrc(app, {});
  check('浏览器形态 ⇒ 载荷走应用源相对路径（不起第二个监听）',
    /^\/wallpaper-engine\/scene-files\//.test(String(src)) && !/^http/.test(String(src)),
    String(src).slice(0, 70));
  app.dispose();
}
{
  // 闩锁只增不减：先见到 Electron，后一条裸请求不许把桌面改判回浏览器。
  const app = freshApply();
  await settingsAdapter(app, ELECTRON_ONLY);
  const a = await settingsAdapter(app, {});
  check('闩锁：桌面一旦判明，后续裸请求不回退成浏览器',
    a && a.detected === 'desktop-official', JSON.stringify(a));
  app.dispose();
}
{
  // 能力头优先于 UA：两条都在时按栅栏判（社区壳的请求就是这个形态）。
  const app = freshApply();
  const a = await settingsAdapter(app, FENCE);
  check('能力头优先于 Electron UA（两条同时在 ⇒ 社区端）',
    a && a.detected === 'desktop-community', JSON.stringify(a));
  app.dispose();
}
{
  // 手选覆盖（客户端与宿主看到同一个值）：观测到栅栏，但手选浏览器。
  writeAdapterSetting('browser');
  const app = freshApply();
  const a = await settingsAdapter(app, FENCE);
  check('手选浏览器：adapter.target 取手选值（detected 仍是观测值）',
    a && a.target === 'browser' && a.detected === 'desktop-community', JSON.stringify(a));
  const src = await inventoryWebSrc(app, FENCE);
  check('手选浏览器 ⇒ 强制应用源（逃生口真的生效）',
    /^\/wallpaper-engine\/scene-files\//.test(String(src)), String(src).slice(0, 70));
  app.dispose();
}
{
  writeAdapterSetting('desktop-community');
  const app = freshApply();
  const a = await settingsAdapter(app, {});
  check('手选非官方桌面端：裸请求下 target 仍取手选值',
    a && a.target === 'desktop-community' && a.detected === 'browser', JSON.stringify(a));
  const src = await inventoryWebSrc(app, {});
  check('手选桌面 ⇒ 裸请求也强制媒体源绝对 URL',
    /^http:\/\/127\.0\.0\.1:\d+\/wallpaper-engine\/scene-files\//.test(String(src)),
    String(src).slice(0, 70));
  app.dispose();
}
clearAdapterSetting();

// ═══ ⑤ 客户端落点（源码形态）═════════════════════════════════════════════════
console.log('\n⑤ 客户端落点：body 钩子 / 外壳选择器门控 / 面板行 / 上报');
const effectsSrc = read('src/effects.js');
// 刀3：样式族已按域拆成 8 个模块 + 组装点 ⇒ 取**整族源码文本**（构建序拼接）；判据文本不变。
const stylesSrc = styleText();
const tabsSrc = panelText();
const clientSrc = read('src/client.js');
const persistSrc = read('src/persistence.js');
const adapterSrc = read('src/adapter.js');

/** 判据只看真实规则行：注释由共享的 `stripComments`（字符串感知）剥掉。
 *  样式表住在 `src/styles.js` 的模板字面量里，而共享实现按设计**不剥模板内容** ⇒ 先把模板
 *  分隔符换成空格，让同一份实现也按块注释（CSS 与 JS 同形）剥这份文本；读取的仍是源文件。 */
function shellSelectorLines(s) {
  return stripComments(s.replace(/`/g, ' ')).split('\n').filter((l) => /data-dsh-desktop-mode=|data-we-mica=/.test(l));
}
/** 判据（唯一定义处，正/负对照都喂它）：每条壳层选择器必须带适配目标门控。 */
const gated = (lines) => lines.length > 0 && lines.every((l) => l.includes('[data-we-adapter^="desktop-"]'));

check('body 钩子成对挂摘（applyEffects 挂 / clearEffects 摘）',
  /setAttribute\("data-we-adapter"/.test(effectsSrc) && /removeAttribute\("data-we-adapter"\)/.test(effectsSrc));
const shellLines = shellSelectorLines(stylesSrc);
check('外壳材质选择器全部带 [data-we-adapter^="desktop-"] 门控', gated(shellLines),
  shellLines.length + ' 行 · 未门控 ' + shellLines.filter((l) => !l.includes('[data-we-adapter^="desktop-"]')).length);
check('覆盖面：扫到的壳层选择器非空（防空表恒真）', shellLines.length >= 3, shellLines.length + ' 行');
check('负对照：去掉门控的合成选择器 ⇒ 同一条判据变假',
  gated(shellLines.map((l) => l.replace('[data-we-adapter^="desktop-"]', ''))) === false);
check('正对照：门控齐全的真表 ⇒ 判据为真', gated(shellLines) === true);

check('面板有「适配」段：下拉 + 检测行 + 不一致警示',
  // ⚠️ 只断言**代码面**（下拉走值表、检测行与警示都由函数现算）。
  //    此前这里还 `includes('适配目标')` —— 那是钉**中文文案**（见 docs/adr/0007）。
  tabsSrc.includes('ADAPTER_TARGET_VALUES.map(')
  && tabsSrc.includes('adapterDetectedLabel()') && tabsSrc.includes('adapterMismatchWarning()'));
// 状态行的三种措辞必须与宿主 mediaOriginNeeded 的三分支一一对应（说错载荷走哪个源
// 比不说更糟：用户会据此判断黑屏原因）。
// ⚠️ 断言的是**机制**："检测值 + 三分支，且每支都是 `weT(...)` 可译键"；
//    此前三条 `includes('有能力头栅栏…')` 钉的是**具体措辞**，改一句话就判红（ADR-0007）。
//    `weT(` 这一层保证"那三句真的进了词表"，与 verify-i18n 的口径一致。
check('状态行三分支齐全（栅栏 / 无栅栏桌面 / 浏览器），与宿主裁决对齐',
  /target:\s*weT\(adapterDetectedLabel\(\)\)[\s\S]{0,400}?\?[\s\S]{0,80}?weT\([\s\S]{0,200}?\?[\s\S]{0,80}?weT\([\s\S]{0,120}?:\s*weT\(/.test(stripComments(tabsSrc)),
  'status-line ternary has 3 weT branches');
check('失焦档按能力矩阵显隐（面板行被 blurPause 门控）',
  // 行文案走 weT（中文原文即键）—— 判据认"门控 + 该行仍在"的形态，不认裸字面量。
  // ⚠️ 此前还多一条 `includes('「窗口失焦时暂停」只在原生浏览器目标下提供')` —— 那是**提示文案**，
  //    属被撤除的散文判定（ADR-0007）；门控本身由上面这条钉住。
  /blurPause\s*&&\s*switchRow\(\s*weT\("窗口失焦时暂停"\)/.test(stripComments(tabsSrc)),
  'panel blur gate');
check('渲染层：occlusion 的失焦档也走能力矩阵（面板隐藏 + 判定跳过两腿都在）',
  clientSrc.includes('adapterCaps().blurPause && selection.pauseOnBlur'));
check('persistence 把宿主上报交给 adapter（缺字段不抛）',
  persistSrc.includes('setAdapterFromHost(data && data.adapter)'));
check('判定优先级写在 resolveAdapterTarget 里（手选先返回）',
  /function resolveAdapterTarget\(\) \{[\s\S]{0,200}if \(picked !== 'auto'\) return picked;/.test(adapterSrc));
check('适配目标已注册进内联清单（否则永远不进产物）',
  read('scripts/build-client.mjs').includes("file: 'src/adapter.js'"));

console.log('\n' + (failed ? 'ADAPTER CHECKS FAILED — ' + failed + ' failed' : 'ALL ADAPTER CHECKS PASSED'));
process.exit(failed ? 1 : 0);
