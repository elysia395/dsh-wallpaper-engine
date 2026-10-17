#!/usr/bin/env node
/**
 * verify-subpackage-toggle-roundtrip.mjs -- BUNDLE-SPLIT 7.6(4) 开关往返（对 patch 里的每一行）
 *
 * 7.6(4) 要求对**每一行**做 关 -> 开 -> 再关，每步满足：
 *   1. 该行路由整族在场/缺席与声明一致（声明面 = tools/host-route-index.mjs 的 buildIndex().routes.length）；
 *   2. 可见面按状态面渲染 -- 浏览器面按**包声明**数据驱动：只有声明了 dsh.client 的包才有浏览器半边
 *      （P-A 里 fonts 是宿主半边行、fx/parallax 才是浏览器包），渲染面的双向对账由既有守卫
 *      test/verify-component-visibility.mjs 承担，本文件只查"声明了浏览器面的包其产物在不在"；
 *   3. 停用后零残留（本文件用 mock webServer 表 + 定时器/进程监听/活动句柄探针量出来）；
 *   4. 这一关**只**动它自己那一行（其余行的路由账逐条不变）。
 * 关键量法：每行的"自己那份贡献" = 在**独立** table 里单独装载该行得到的键集合（不是累计快照）。
 * 行来源数据驱动：根 cordis.patch.yml 的 (id, name)；name 解析：
 *   裸包名 -> lib/index.js；<裸包>/<子> -> lib/components/<子>/index.js；子包真实包名 -> packages/<dir>/<main>。
 * 负对照（必须有牙）：
 *   a. 合成"只 return dispose 不交给 fiber"的插件 -> 本判据检测函数判红；
 *   b. 真源码变异体：把行入口里的**交接调用**（旧叶子形态 handOffTeardown( 或服务面形态
 *      <receiver>.handOff(）换成恒等函数（= lead 口径的 return dispose），用 data: URL 装载
 *      -> 检测函数判红。空壳行没有交接调用则显式列出并计数。
 *   c. mock ctx 不带跨包服务面（ctx.wallpaperEngineHost）-> 每个子包宿主半边都必须在装载期抛错。
 *
 * 跨包服务面（§5.1 ①）：mock ctx 用主包叶子 createSubpackageHost() 的**真值**（不是手搓 stub），
 * 服务名 HOST_SERVICE_NAME 也动态读自同一叶子；行入口零主包说明符（§5.2）在本文件另有一条判据。
 * 挂链：test/run-guards.mjs 的 VERIFY_STEPS（hard）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripComments, functionBodyOf } from './tools/js-text.mjs';
import { buildIndex } from './tools/host-route-index.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MUT_HELPER = '__weMutNoHandoff';
/**
 * 「该行声明了手工交接」的源码形态（检测用，**不带 /g**，避免 lastIndex 串味）：
 *   · 旧叶子形态：handOffTeardown(ctx, dispose)
 *   · 服务面形态（refactor 后三个子包宿主半边的写法）：host.handOff(ctx, dispose)
 * 变异时接收者/函数名**一起**换成恒等函数，等价于"只 return dispose、不交给 fiber"。
 */
const HANDOFF_SRC_RE = /(?:[A-Za-z_$][\w$]*\s*\.\s*handOff(?:Teardown)?|\bhandOffTeardown)\s*\(/;
const HANDOFF_MUT_RE = new RegExp(HANDOFF_SRC_RE.source, 'g');
/** 跨包服务面（§5.1 ①）槽位：mock ctx 用的**真**服务名与真服务值，主流程里从主包叶子动态读入。 */
let HOST_SERVICE_NAME = 'wallpaperEngineHost';
let HOST_SERVICE = null;
let failed = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else { failed++; console.log('  FAIL ' + name + (detail ? '\n      ' + detail : '')); }
}
const isFile = (abs) => { try { return statSync(abs).isFile(); } catch { return false; } };
const isDir = (abs) => { try { return statSync(abs).isDirectory(); } catch { return false; } };
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

function parsePatchRows(text) {
  const rows = [];
  let cur = null;
  for (const raw of String(text).split('\n')) {
    if (/^\s*#/.test(raw)) continue;
    const line = raw.replace(/\s+#.*$/, '');
    const idm = /^\s*-\s*id:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line);
    if (idm) { cur = { id: idm[1], name: null }; rows.push(cur); continue; }
    const nm = /^\s*name:\s*['"]?([^'"\s#]+)['"]?\s*$/.exec(line);
    if (nm && cur && !cur.name) cur.name = nm[1];
  }
  return rows.filter((r) => r.name);
}

function discoverSubpackages() {
  const dir = join(ROOT, 'packages');
  if (!isDir(dir)) return [];
  const out = [];
  for (const n of readdirSync(dir).sort()) {
    const pj = join(dir, n, 'package.json');
    if (!isFile(pj)) continue;
    let manifest;
    try { manifest = JSON.parse(readFileSync(pj, 'utf8')); } catch { manifest = null; }
    out.push({ dir: 'packages/' + n, manifest });
  }
  return out;
}

function resolveRows(rootPkg, pkgs) {
  const rows = parsePatchRows(read('cordis.patch.yml'));
  const rootBrowser = !!(rootPkg.dsh && rootPkg.dsh.client);
  return rows.map((r) => {
    const name = r.name;
    if (name === rootPkg.name) return { id: r.id, name, kind: 'root', rel: 'lib/index.js', browser: rootBrowser };
    if (name.indexOf(rootPkg.name + '/') === 0) {
      const sub = name.slice(rootPkg.name.length + 1);
      return { id: r.id, name, kind: 'component', rel: 'lib/components/' + sub + '/index.js', browser: rootBrowser };
    }
    const s = pkgs.filter((p) => p.manifest && p.manifest.name === name)[0];
    if (!s) return { id: r.id, name, kind: 'unknown', rel: null, browser: false };
    const main = (s.manifest.main || './lib/index.js').replace(/^\.\//, '');
    return { id: r.id, name, kind: 'subpackage', rel: s.dir + '/' + main, browser: !!(s.manifest.dsh && s.manifest.dsh.client), manifest: s.manifest };
  });
}

const makeTable = () => {
  const table = new Map();
  return {
    table,
    webServer: {
      register(route) {
        const key = route.kind + ' ' + route.path;
        if (table.has(key)) throw new Error('webserver: duplicate ' + route.kind + ' route "' + route.path + '"');
        table.set(key, route);
        return () => { table.delete(key); };
      },
      tapIndex() { return () => {}; },
    },
  };
};
const makeFiber = (webServer) => {
  const collected = [];
  let handoffs = 0;
  const provided = [];
  return {
    // handoffs = 该行**交给 fiber 的 teardown 数目**（§7.6④ 的第二个观测面：路由之外唯一能看出
    // "拆卸有没有真交接"的量；纯浏览器空壳行宿主侧零路由，只有这一面能分辨真源码与变异体）。
    ctx: {
      webServer,
      // 跨包服务面（§5.1 ①）：子包宿主半边只经 ctx.<服务名> 取面，这里给**真值**
      // （主包 createSubpackageHost()）——手搓 stub 等于把"服务面名字/键集"从本判据里挖掉，
      // 那一面由 test/verify-subpackage-boot.mjs 逐键对账，这里只保证"取得到、能用"。
      [HOST_SERVICE_NAME]: HOST_SERVICE,
      // 真宿主的 provide：主包 apply() 第一件事就是 provideSubpackageHost(ctx)（服务随 fiber 撤销、
      // 子包 inject 级联的物理基础）。mock 里也放上，免得主包/子包将来走 provide 分支时静默失效。
      provide(name, value) { provided.push([name, value]); },
      effect(cb) { handoffs++; const d = cb(); if (typeof d === 'function') collected.push(d); return d; },
    },
    unload() { while (collected.length) collected.pop()(); },
    handoffs: () => handoffs,
    provided: () => provided,
  };
};
/** 模拟 cordis 对函数声明 apply 的构造分支：返回值被丢弃，只有 ctx.effect 能救回 teardown。 */
const loadDroppingReturn = (applyFn, ctx) => { applyFn(ctx); };

const keySet = (table) => new Set(table.keys());
const sameSet = (a, b) => a.size === b.size && [...a].every((k) => b.has(k));
const minus = (a, b) => new Set([...a].filter((k) => !b.has(k)));
const inter = (a, b) => [...a].filter((k) => b.has(k));

/** 每行自己那份贡献：在本行独占的 table 里量。 */
function measureOwn(plugins) {
  const own = new Map();
  for (const p of plugins) {
    const t = makeTable();
    const f = makeFiber(t.webServer);
    loadDroppingReturn(p.apply, f.ctx);
    own.set(p.label, keySet(t.table));
    f.unload();
  }
  return own;
}

/** 每行自己那份**交接量**：在本行独占的 table 里量"交给 fiber 的 teardown 数目"。
 *  零宿主贡献行（纯浏览器空壳）路由面为空，变异体与真源码在路由面上完全同构 ⇒ 必须靠这个面给牙。 */
function measureHandoffs(plugins) {
  const out = new Map();
  for (const p of plugins) {
    const t = makeTable();
    const f = makeFiber(t.webServer);
    try { loadDroppingReturn(p.apply, f.ctx); } catch { out.set(p.label, -1); continue; }
    out.set(p.label, f.handoffs());
    f.unload();
  }
  return out;
}

/** 单行往返检测。own = label -> 该行自己那份路由集合。返回问题清单。 */
function rowRoundtripProblems(target, plugins, own) {
  const bad = [];
  const ownSets = own || measureOwn(plugins);
  const t = makeTable();
  const fibers = new Map();
  for (const p of plugins) {
    try { const f = makeFiber(t.webServer); loadDroppingReturn(p.apply, f.ctx); fibers.set(p.label, f); }
    catch (e) { bad.push(p.label + ' 首次装载抛错：' + String(e.message || e).split('\n')[0]); }
  }
  // 有行装载抛错时也要把已经建起来的 fiber 拆掉，否则会污染外层「零残留」探针（假红）。
  if (bad.length) { for (const f of fibers.values()) f.unload(); return bad; }
  const full = keySet(t.table);
  const mine = ownSets.get(target);
  if (!mine) return ['内部错误：own 里没有 ' + target];
  // 不相交性（每行自己那份贡献互不相交）
  const labels = plugins.map((p) => p.label);
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
    const ov = inter(ownSets.get(labels[i]), ownSets.get(labels[j]));
    if (ov.length) bad.push('行 ' + labels[i] + ' 与 ' + labels[j] + ' 的路由不相交性不成立，重合 ' + ov.length + ' 条：' + ov.slice(0, 3).join(', '));
  }
  // 关
  fibers.get(target).unload();
  const afterOff = keySet(t.table);
  const expectOff = minus(full, mine);
  if (!sameSet(afterOff, expectOff)) {
    bad.push('关掉 ' + target + ' 后剩 ' + afterOff.size + ' 条，应为 ' + expectOff.size + ' 条'
      + '；本行残留 ' + inter(afterOff, mine).length + ' 条'
      + '；误伤他行 ' + inter(afterOff, expectOff).length + ' 条之外的差异 ' + inter(expectOff, afterOff).length + ' 条');
  }
  // 开（reload 撞 duplicate 就是 teardown 没撤干净）
  let f2 = null, reloadErr = null;
  try { f2 = makeFiber(t.webServer); loadDroppingReturn(plugins.filter((p) => p.label === target)[0].apply, f2.ctx); } catch (e) { reloadErr = e; }
  if (reloadErr) bad.push('再打开 ' + target + ' 撞错：' + String(reloadErr.message || reloadErr).split('\n')[0] + '（teardown 没撤干净）');
  else {
    const afterOn = keySet(t.table);
    if (!sameSet(afterOn, full)) bad.push('再打开 ' + target + ' 后路由账与首次不同（首次 ' + full.size + ' 条 / 现在 ' + afterOn.size + ' 条）');
    const reloaded = minus(afterOn, afterOff);
    if (!sameSet(reloaded, mine)) bad.push('再打开 ' + target + ' 注册的路由集合与首次不同（多/少 ' + (reloaded.size - mine.size) + ' 条）');
    // 再关
    f2.unload();
    const afterOff2 = keySet(t.table);
    if (!sameSet(afterOff2, expectOff)) bad.push('第二次关掉 ' + target + ' 后剩 ' + afterOff2.size + ' 条，应为 ' + expectOff.size + ' 条（残留 ' + inter(afterOff2, mine).length + ' 条）');
  }
  // 收尾：拆掉本 harness 里所有行，避免污染外层「零残留」探针
  for (const p of plugins) { const f = fibers.get(p.label); if (f) f.unload(); }
  if (f2) f2.unload();
  return bad;
}

function mutateNoHandoff(src) {
  // 交接调用 -> 恒等函数：host.handOff(ctx, dispose) / handOffTeardown(ctx, dispose) 都变成
  // __weMutNoHandoff(ctx, dispose)（返回 dispose 但不经 ctx.effect ⇒ 交接量归零）。
  return 'const ' + MUT_HELPER + ' = (_c, d) => d;\n' + String(src).replace(HANDOFF_MUT_RE, MUT_HELPER + '(') + '\n';
}
function absolutize(src, fileAbs) {
  const fileUrl = pathToFileURL(fileAbs).href;
  const dirUrl = pathToFileURL(dirname(fileAbs) + sep).href;
  // data: URL 模块里的 import.meta.url 是 data: URL ⇒ 先钉成**真文件 URL**：被测源码里
  // `new URL('../cordis.patch.yml', import.meta.url)` 这类"按本文件位置读本包文件"的写法
  // （lib/index.js 的启动自检就是这么读 patch / package.json 的）在 data: 变异体里才成立。
  return String(src)
    .replace(/import\.meta\.url/g, JSON.stringify(fileUrl))
    .replace(/(from\s*|import\s*\(\s*)(['"])(\.[^'"]*)\2/g, (m, a, q, p) => a + q + new URL(p, dirUrl).href + q);
}
/** `<主包名>` / `<主包名>/<子路径>` -> 主包 exports 指的文件（映射不到返回 null）。 */
function rootExportsTarget(spec) {
  const ex = rootPkg.exports || {};
  if (spec === rootPkg.name) return exportTarget(ex['.']) || rootPkg.main || null;
  if (spec.startsWith(rootPkg.name + '/')) return exportTarget(ex['./' + spec.slice(rootPkg.name.length + 1)]) || null;
  return null;
}
/**
 * **过渡期兜底**（refactor 后行入口应为零主包说明符，见主流程的判据）：
 * 老形态的子包宿主入口按裸名 import 主包（'dsh-plugin-wallpaper-engine/subpackage-boot.js'）。
 * 真实 profile 里主包就装在 node_modules/<主包名>，本仓普通检出下 node_modules 里没有主包自己，
 * 于是裸名解析不到 —— 这里按主包 exports 把裸名映射成仓内 file:// URL。只改解析、不改被测代码；
 * 映射不到（exports 缺该子路径）就保持原样，让 import 大声失败（顺带钉住主包 exports 面）。
 * 保留它的理由：真出现说明符时不要把"解析不到"伪装成"往返坏掉"，但说明符本身由主流程判红。
 */
/** 源码里的模块说明符（from / side-effect import / dynamic import / require 四种形态都收）。 */
function specifiersOf(src) {
  const out = [];
  const re = /(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(String(src))) !== null) out.push(m[1]);
  return out;
}
/**
 * 出户的组件/子包真名 → `packages/<dir>/<main>` 的 file:// URL（映射不到返回 null）。
 *
 * P-F 起主包门面按**裸包名**静态 import 出户的组件（`lib/index.js` → `dsh-plugin-wallpaper-engine-about-notice`，
 * 见 ADR-0014 §12「主包以精确版本依赖子包」）：真实 profile 里靠 `<profile>/node_modules/<name>` 解析，
 * 而 data: URL 变异体**解析不到任何裸名** ⇒ 必须像主包裸名那样映射成仓内 file URL。
 */
function subpackageEntryUrl(spec) {
  let names;
  try { names = readdirSync(join(ROOT, 'packages')); } catch { return null; }
  for (const dir of names) {
    const abs = join(ROOT, 'packages', dir, 'package.json');
    let pkg;
    try { pkg = JSON.parse(readFileSync(abs, 'utf8')); } catch { continue; }
    if (pkg && pkg.name === spec) {
      const main = String(pkg.main || './lib/index.js').replace(/^\.\//, '');
      return pathToFileURL(join(ROOT, 'packages', dir, main)).href;
    }
  }
  return null;
}
/** 该源码（先去注释）里的**主包说明符**；空数组 = 零主包说明符（§5.2 目标态）。 */
function rootSpecifiersOf(src) {
  return specifiersOf(stripComments(String(src))).filter((s) => s === rootPkg.name || s.indexOf(rootPkg.name + '/') === 0);
}
function mapRootSpecifiers(src) {
  return String(src).replace(/(from\s*|import\s*\(\s*)(['"])([^'"]+)\2/g, (m, pre, q, spec) => {
    const t = rootExportsTarget(spec);
    if (t) return pre + q + pathToFileURL(resolve(ROOT, t.replace(/^\.\//, ''))).href + q;
    const sp = subpackageEntryUrl(spec);
    return sp ? pre + q + sp + q : m;
  });
}
/** 装载行入口：零主包说明符（refactor 后的目标态）直接按**真文件**装载（保住 import.meta.url）；
 *  过渡期仍有说明符时才走 data: URL + 裸名映射（见 mapRootSpecifiers 的说明）。 */
async function importEntry(abs) {
  const src = readFileSync(abs, 'utf8');
  if (rootSpecifiersOf(src).length === 0) return import(pathToFileURL(abs).href);
  const code = absolutize(mapRootSpecifiers(src), abs);
  return import('data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64') + '#entry-' + encodeURIComponent(abs));
}
async function importMutant(src, fileAbs, tag) {
  // 子包入口也会 import 主包裸名 ⇒ data: 体里先映射成仓内 file:// URL（data: 模块解析不到裸名）。
  const code = absolutize(mapRootSpecifiers(mutateNoHandoff(src)), fileAbs);
  const url = 'data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64') + '#' + tag;
  return import(url);
}

/** exports 值可能是字符串或 {import|default|require} 对象。 */
function exportTarget(v) {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    for (const k of ['import', 'default', 'require', 'node']) if (typeof v[k] === 'string') return v[k];
    for (const k of Object.keys(v)) { const got = exportTarget(v[k]); if (got) return got; }
  }
  return null;
}

// ---------------------------------------------------------------------------
const rootPkg = JSON.parse(read('package.json'));
const pkgs = discoverSubpackages();
const rows = resolveRows(rootPkg, pkgs);
check('根 patch 至少有一行', rows.length > 0, rows.length ? '' : 'cordis.patch.yml 里解析不到 (id, name) 行');

// 跨包服务面（§5.1 ①）：从主包叶子**动态**读服务名 + createSubpackageHost()。mock ctx 用真值，
// 不手搓 stub —— 名字/键集漂移由 verify-subpackage-boot.mjs 逐键对账，这里保证本文件的 mock
// 与真宿主同形（子包宿主半边 inject 的唯一条目就是这个服务）。
let bootLoadErr = null;
try {
  const boot = await import(pathToFileURL(join(ROOT, 'lib/subpackage-boot.js')).href);
  HOST_SERVICE_NAME = boot.HOST_SERVICE_NAME;
  HOST_SERVICE = boot.createSubpackageHost();
} catch (e) { bootLoadErr = e; }
check('主包跨包服务面可动态装载（mock ctx 用真 createSubpackageHost()，不手搓 stub）',
  HOST_SERVICE !== null && typeof HOST_SERVICE_NAME === 'string' && HOST_SERVICE_NAME.length > 0,
  bootLoadErr ? ('装载 lib/subpackage-boot.js 失败：' + String(bootLoadErr.message || bootLoadErr).split('\n')[0]) : 'HOST_SERVICE=' + String(HOST_SERVICE));

const unknown = rows.filter((r) => r.kind === 'unknown');
check('每一行的 name 都能解析到宿主入口（子包必须能按包名找到 packages/<dir>）', unknown.length === 0,
  unknown.map((r) => 'id=' + r.id + ' name=' + r.name + ' 在 packages/ 下找不到对应包').join('；'));
const missingEntry = rows.filter((r) => r.rel && !isFile(join(ROOT, r.rel)));
check('每个行入口文件都存在', missingEntry.length === 0, missingEntry.map((r) => r.name + ' -> ' + r.rel).join('；'));

// 行入口零主包说明符（§5.2）：refactor 后子包宿主半边只经 ctx.<服务名> 取面，**不再** import 主包。
// 装载器里的 mapRootSpecifiers 保留成过渡期兜底（真出现说明符时仍把裸名映射到仓内 file:// URL，
// 免得"解析不到"冒充"往返坏掉"），但说明符本身在这里**判红**并点名：不许静默回到模块图上的边。
const rootSpecRows = [];
for (const r of rows) {
  if (!r.rel || !isFile(join(ROOT, r.rel))) continue;
  const hits = [...new Set(rootSpecifiersOf(read(r.rel)))];
  if (hits.length) rootSpecRows.push(r.name + '（' + r.rel + '）：' + hits.join(', '));
}
check('行入口零主包说明符（子包半边只许经 ctx.' + HOST_SERVICE_NAME + ' 取面；浏览器产物不在此列，见 verify-subpackage-purity.mjs）',
  rootSpecRows.length === 0, rootSpecRows.join('；'));
console.log('    · 行表：' + rows.map((r) => r.id + '[' + r.kind + (r.browser ? ',浏览器面' : ',宿主面') + ']').join(' / '));

const plugins = [];
for (const r of rows) {
  if (!r.rel || !isFile(join(ROOT, r.rel))) continue;
  try {
    const mod = await importEntry(join(ROOT, r.rel));
    const applyFn = mod.apply || (mod.default && mod.default.apply);
    if (typeof applyFn !== 'function') { check('行 ' + r.name + ' 的入口导出 apply', false, r.rel + ' 没有导出 apply'); continue; }
    plugins.push({ label: r.name, apply: applyFn, row: r });
  } catch (e) { check('行 ' + r.name + ' 的入口可装载', false, r.rel + '：' + String(e.message || e).split('\n')[0]); }
}
check('所有行入口都装载成功', plugins.length === rows.filter((r) => r.rel && isFile(join(ROOT, r.rel))).length,
  plugins.map((p) => p.label).join(' / '));

// 真宿主腿（整合面）：主包行 apply() 必须通过 ctx.provide 把服务面挂给当前 fiber ——
// 子包 inject: ['<服务名>'] 的级联（关主包=关整族，D-13 B）就建立在这条腿上。
{
  const rootPlugin = plugins.filter((p) => p.row.kind === 'root')[0];
  if (!rootPlugin) check('行表里有主包行（kind=root）可验真宿主腿', false, '找不到 kind=root 的行');
  else {
    const tR = makeTable();
    const fR = makeFiber(tR.webServer);
    let provErr = null;
    try { loadDroppingReturn(rootPlugin.apply, fR.ctx); } catch (e) { provErr = e; }
    const prov = fR.provided();
    const gotName = prov.length === 1 ? prov[0][0] : null;
    const gotVal = prov.length === 1 ? prov[0][1] : null;
    check('主包行 apply() 通过 ctx.provide 挂出服务面（名字=' + HOST_SERVICE_NAME + '、6 键冻结、真宿主腿 = 子包 inject 级联成立）',
      provErr === null && gotName === HOST_SERVICE_NAME && gotVal !== null && typeof gotVal === 'object'
        && typeof gotVal.keys === 'function' && typeof gotVal.handOff === 'function'
        && (gotVal.schema && gotVal.http ? true : false) && Object.isFrozen(gotVal),
      (provErr ? '装载抛错：' + String(provErr.message || provErr).split('\n')[0] + ' · ' : '')
        + 'ctx.provide 记录 ' + JSON.stringify(prov.map((x) => [x[0], x[1] ? Object.keys(x[1]).join(',') : String(x[1])])));
    fR.unload();
  }
}

// 负对照 c：mock ctx **不带**服务面 ⇒ 每个子包宿主半边都必须在装载期抛错。
// 某行在没有 ctx.<服务名> 时仍能装载 = 它没走服务面（静态 import 主包 / 自搓 stub），
// 那"零主包说明符"就成了纸面文章。放在零残留探针之前跑，避免把它的残留算到后面头上。
{
  const noServiceOk = [];
  for (const p of plugins.filter((q) => q.row.kind === 'subpackage')) {
    const t = makeTable();
    const f = makeFiber(t.webServer);
    delete f.ctx[HOST_SERVICE_NAME];
    try { loadDroppingReturn(p.apply, f.ctx); noServiceOk.push(p.label + '（' + p.row.rel + '）在没有 ctx.' + HOST_SERVICE_NAME + ' 时仍装载成功'); }
    catch { /* 预期：抛错 */ }
    try { f.unload(); } catch { /* 装载已抛错，收尾尽力而为 */ }
  }
  check('负对照：mock ctx 不带服务面 ⇒ 每个子包宿主半边都在装载期抛错（证明它真经 ctx.' + HOST_SERVICE_NAME + ' 取面）',
    noServiceOk.length === 0, noServiceOk.join('；'));
}

if (plugins.length > 0) {
  // 零残留探针（定时器：被 clear 或已触发就出账；只统计停用后仍挂着的）
  const timerIds = new Set();
  const oST = globalThis.setTimeout, oCT = globalThis.clearTimeout, oSI = globalThis.setInterval, oCI = globalThis.clearInterval;
  globalThis.setTimeout = (cb, ms, ...rest) => {
    let id = null;
    const wrapped = typeof cb === 'function' ? (...a) => { timerIds.delete(id); return cb(...a); } : cb;
    id = oST(wrapped, ms, ...rest);
    if (typeof cb === 'function') timerIds.add(id);
    return id;
  };
  globalThis.setInterval = (cb, ms, ...rest) => {
    let id = null;
    const wrapped = typeof cb === 'function' ? (...a) => { timerIds.delete(id); return cb(...a); } : cb;
    id = oSI(wrapped, ms, ...rest);
    if (typeof cb === 'function') timerIds.add(id);
    return id;
  };
  globalThis.clearTimeout = (id) => { timerIds.delete(id); return oCT(id); };
  globalThis.clearInterval = (id) => { timerIds.delete(id); return oCI(id); };
  const EVENTS = ['exit', 'beforeExit', 'SIGINT', 'SIGTERM', 'message', 'warning', 'uncaughtException', 'unhandledRejection'];
  const listenerBase = {};
  for (const ev of EVENTS) listenerBase[ev] = process.listenerCount(ev);
  const handlesBase = (typeof process._getActiveHandles === 'function' ? process._getActiveHandles().length : -1);

  // 每行独立量自己的贡献，并顺带量该行装载期间挂上的定时器 / 停用后是否清掉
  const ownSets = new Map(), timerRows = [], loadFailures = [];
  for (const p of plugins) {
    const before = new Set(timerIds);
    const t = makeTable();
    const f = makeFiber(t.webServer);
    try { loadDroppingReturn(p.apply, f.ctx); }
    catch (e) { loadFailures.push(p.label + '：' + String(e.message || e).split('\n')[0]); continue; }
    ownSets.set(p.label, keySet(t.table));
    const afterLoad = minus(timerIds, before);
    f.unload();
    const afterUnload = minus(timerIds, before);
    if (afterLoad.size || afterUnload.size) timerRows.push(p.label + ' 装载期挂 ' + afterLoad.size + ' 个定时器，停用后仍挂 ' + afterUnload.size + ' 个');
  }

  // 观测面 2：交接量（路由之外唯一的可观测差异）。零宿主贡献行（§2.2 纯浏览器空壳）宿主侧零路由，
  // 它的 apply 若把交接退回成"只 return dispose"，路由面上**毫无差别** ⇒ 本条判据在这类行上会变成
  // 没有牙的恒真判据。源码里出现交接调用（handOffTeardown( 或服务面 host.handOff(）就是"必须交接"
  // 的声明，据此要求实测 ≥1。
  const ownHandoffs = measureHandoffs(plugins);
  const handoffIssues = [];
  for (const p of plugins) {
    const expected = HANDOFF_SRC_RE.test(read(p.row.rel)) ? 1 : 0;
    const got = ownHandoffs.get(p.label);
    if (got < expected) handoffIssues.push(p.label + '（' + p.row.rel + '）源码里' + (expected ? '有' : '没有')
      + ' 交接调用（handOffTeardown( / <receiver>.handOff(），实测交给 fiber 的 teardown ' + got + ' 个');
  }
  check('交接面：源码里有交接调用（handOffTeardown( / <receiver>.handOff(）的行，实测至少向 ctx.effect 交 1 个 teardown（零路由行也吃这条）',
    handoffIssues.length === 0, handoffIssues.join('；'));
  console.log('    · 交接量：' + plugins.map((p) => p.label + '=' + ownHandoffs.get(p.label)).join(' / '));

  // 逐行的**真源码基线问题集**：变异体的"牙"= 比基线**多**出来的问题（否则搬迁期里任何他行的
  // 既存红都会让所有变异体看起来"已被判红"，牙是假的）。realByRow 供负对照 b 做差集用。
  const real = [], realByRow = new Map();
  for (const p of plugins) {
    const probs = rowRoundtripProblems(p.label, plugins, ownSets);
    realByRow.set(p.label, probs);
    for (const v of probs) real.push(v);
  }
  check('对每一行做 关 -> 开 -> 再关：整族在场/缺席、互不相交、只动自己那一行', real.length === 0, real.join('\n      '));

  const union = new Set();
  for (const s of ownSets.values()) for (const k of s) union.add(k);
  const runtimeTotal = union.size;
  // 逐行贡献必须互不相交：重叠 = 同一族被两行各注册一次（关掉一行不会让它真消失，且后装载的那行会
  // 直接撞 "duplicate ... route"）—— P-A 搬家期的典型半成品状态，必须出声。
  {
    const labels = plugins.map((p) => p.label);
    const overlaps = [];
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
      const ov = inter(ownSets.get(labels[i]), ownSets.get(labels[j]));
      if (ov.length) overlaps.push(labels[i] + ' ∩ ' + labels[j] + ' = ' + ov.slice(0, 3).join(', ') + (ov.length > 3 ? ' …（' + ov.length + ' 条）' : ''));
    }
    const sumOwn = [...ownSets.values()].reduce((n, s) => n + s.size, 0);
    check('逐行贡献互不相交（各行自己的路由集合 sum=' + sumOwn + ' 应等于并集 union=' + runtimeTotal + '）',
      overlaps.length === 0, overlaps.join('；'));
  }
  const declaredTotal = buildIndex().routes.length;
  check('运行面路由总数（' + runtimeTotal + '）与声明面 buildIndex().routes.length（' + declaredTotal + '）一致', runtimeTotal === declaredTotal,
    '不一致时：新包的宿主入口要纳入 tools/host-route-index.mjs 的包发现层（MAIN_MODULES）');
  console.log('    · 逐行条数：' + plugins.map((p) => p.label + '=' + ownSets.get(p.label).size).join(' / '));

  // 整族关掉：表清空 + 零残留
  const tAll = makeTable();
  const fAll = makeFiber(tAll.webServer);
  const allLoadFailures = [];
  for (const p of plugins) {
    try { loadDroppingReturn(p.apply, fAll.ctx); }
    catch (e) { allLoadFailures.push(p.label + '：' + String(e.message || e).split('\n')[0]); }
  }
  fAll.unload();
  if (allLoadFailures.length) loadFailures.push(...allLoadFailures);
  check('每一行的 apply 在本 harness 里可独立装载（零主包说明符 ⇒ 按真文件装载；过渡期裸名仍先映射到仓内文件，不抛异常）',
    loadFailures.length === 0, loadFailures.join('；'));
  const leftover = tAll.table.size;
  const pendingTimers = [...timerIds].length;
  const listenerDelta = EVENTS.map((ev) => ev + ':' + (process.listenerCount(ev) - listenerBase[ev])).filter((s) => !/:0$/.test(s));
  const handlesNow = (typeof process._getActiveHandles === 'function' ? process._getActiveHandles().length : -1);
  check('整族关掉后路由表清空 + 零残留（无遗留定时器 / 进程监听 / 活动句柄）',
    leftover === 0 && pendingTimers === 0 && listenerDelta.length === 0 && (handlesBase < 0 || handlesNow <= handlesBase),
    '残留路由 ' + leftover + ' · 停用后仍挂的定时器 ' + pendingTimers + ' · 监听增量 ' + (listenerDelta.join(',') || '无')
      + ' · 活动句柄 ' + handlesBase + ' -> ' + handlesNow + (timerRows.length ? ' · 逐行：' + timerRows.join(' / ') : ''));
  globalThis.setTimeout = oST; globalThis.setInterval = oSI; globalThis.clearTimeout = oCT; globalThis.clearInterval = oCI;

  // 可见面按包声明数据驱动
  const browserRows = plugins.filter((p) => p.row.browser);
  if (browserRows.length === 0) console.log('    · 没有行声明浏览器半边（P-A 范围）-> 渲染面对账交给 verify-component-visibility.mjs');
  else {
    const rootClient = exportTarget(rootPkg.exports && rootPkg.exports['./client']) || './lib/client.js';
    const rootRel = rootClient.replace(/^\.\//, '');
    const text = isFile(join(ROOT, rootRel)) ? read(rootRel) : '';
    const registered = text.indexOf('id: "' + rootPkg.name + '"') >= 0 || text.indexOf("id: '" + rootPkg.name + "'") >= 0;
    check('声明浏览器面的行（' + browserRows.map((p) => p.row.id).join(', ') + '）其包客户端产物存在且注册了包 id', registered && text.length > 1000,
      rootRel + ' 里' + (registered ? '' : '没有') + '注册 id ' + rootPkg.name + '（' + text.length + ' 字符；构建产物缺失时先跑 npm run build）');
  }

  // 负对照 a：合成"只 return dispose"的插件必须被判红
  const synthGood = (prefix) => (ctx) => { const d = ctx.webServer.register({ kind: 'exact', path: '/' + prefix }); ctx.effect(() => d); return d; };
  const synthBad = (prefix) => (ctx) => { const d = ctx.webServer.register({ kind: 'exact', path: '/' + prefix }); return () => d(); };
  const synthRows = [
    { label: '/a', apply: synthGood('synth-a') },
    { label: '/bad', apply: synthBad('synth-bad') },
    { label: '/c', apply: synthGood('synth-c') },
  ];
  const synthOkProblems = rowRoundtripProblems('/a', synthRows);
  check('负对照基准：合成全交接插件集 0 问题（检测函数不恒真）', synthOkProblems.length === 0, JSON.stringify(synthOkProblems));
  const synthBadProblems = rowRoundtripProblems('/bad', synthRows);
  check('负对照：合成"只 return dispose 不交给 fiber"的行被检测函数判红', synthBadProblems.length > 0, JSON.stringify(synthBadProblems));

  // 负对照 b：真源码变异体
  let mutated = 0;
  const skipped = [];
  const mutProblems = [];
  // 每个变异体是靠哪个观测面被判红的 —— 零宿主贡献行只剩"交接面"这一个可观测差异（判据的牙在此处）。
  const mutFaces = [];
  for (const p of plugins) {
    const abs = join(ROOT, p.row.rel);
    const src = readFileSync(abs, 'utf8');
    if (!HANDOFF_SRC_RE.test(src)) { skipped.push(p.label + '（0 处交接调用，空壳行）'); continue; }
    const mod = await importMutant(src, abs, 'mut-' + encodeURIComponent(p.label));
    const applyFn = mod.apply || (mod.default && mod.default.apply);
    if (typeof applyFn !== 'function') { mutProblems.push(p.label + '：变异体没有导出 apply'); continue; }
    const mutPlugins = plugins.map((q) => (q.label === p.label ? { label: q.label, apply: applyFn, row: q.row } : q));
    let mutOwn, bad2, mutHandoff;
    const expectedHandoff = HANDOFF_SRC_RE.test(src) ? 1 : 0;
    try {
      mutOwn = measureOwn(mutPlugins);
      bad2 = rowRoundtripProblems(p.label, mutPlugins, mutOwn);
      mutHandoff = measureHandoffs(mutPlugins).get(p.label);
    } catch (e) {
      mutProblems.push(p.label + ' 变异体在 harness 里抛错（说明 harness 需要修，不代表判据有牙）：' + String(e.message || e).split('\n')[0]);
      continue;
    }
    mutated++;
    // 判红 = 两个观测面任一抓到**真源码没有的**问题：
    //   · 路由面：变异体的往返问题集中出现基线里没有的条目（delta）；
    //   · 交接面：交给 fiber 的 teardown 数 < 真源码声明的下限（零宿主贡献行只有这一面能分辨）。
    const baseline = realByRow.get(p.label) || [];
    const delta = bad2.filter((v) => !baseline.includes(v));
    mutFaces.push(p.label + (delta.length ? '（路由面 +' + delta.length + '）' : '（交接面 ' + mutHandoff + ' < ' + expectedHandoff + '）'));
    if (delta.length === 0 && !(mutHandoff < expectedHandoff)) {
      mutProblems.push(p.label + '：变异体（交接调用 -> 恒等 = 只 return dispose）**没有被判红** —— 本条判据没有牙'
        + '（路由面相对真源码基线新增 0 条；交接面实测 ' + mutHandoff + ' 个，真源码声明下限 ' + expectedHandoff + ' 个）');
    }
  }
  check('负对照：每个有 teardown 交接的行，其真源码变异体都被判红（路由面或交接面，零路由行靠交接面）',
    mutated > 0 && mutProblems.length === 0,
    (mutProblems.length ? mutProblems.join('；') : mutated + ' 个变异体全部被判红') + (skipped.length ? ' · 跳过：' + skipped.join(' / ') : ''));
  console.log('    · 变异体判红口：' + mutFaces.join(' / '));

  // 文本兜底：注册了路由的行，apply 体里必须出现交接调用
  const textIssues = [];
  for (const p of plugins) {
    if (ownSets.get(p.label).size === 0) continue;
    const src = read(p.row.rel);
    const body = functionBodyOf(stripComments(src), 'export function apply(');
    if (body === null) textIssues.push(p.label + '（' + p.row.rel + '）定位不到 export function apply( 的函数体');
    else if (!HANDOFF_SRC_RE.test(body)) textIssues.push(p.label + '（' + p.row.rel + '）apply 体里没有交接调用（handOffTeardown( / <receiver>.handOff(）');
  }
  check('注册了路由的行：apply 体里都有交接调用（handOffTeardown( / <receiver>.handOff(）', textIssues.length === 0, textIssues.join('；'));
}

// ── P-C 字体实例（task-8 第 3 条）：关掉 `wallpaper-engine-fonts` 行 ⇒
//   ① 宿主路由整族缺席 ② 外观页签不再画字体节（可见面由面板节注册表派生）③ 关闭后零残留
//   ④ 只有该行状态变化。
//
// v2 口径（Lead）：本轮只搬「字体节的渲染器」——屏上那一节的 `descriptor.render` 必须来自注册表，
// 主 bundle 不再内联它；`fontset-store/system-fonts/font/apply/typography/color-roles` 留在主包，
// 所以这里**不**断言那 5 个文件不在主包。
// 四个观测面都做成纯函数（输入是量出来的集合/文本/注册表模块），负对照喂合成输入，不靠磁盘变异。

const FONTS_ROW_ID = 'wallpaper-engine-fonts';
const FONTS_PKG_NAME = 'dsh-plugin-wallpaper-engine-fonts';
const PANEL_ID = 'appearance';
const FONTS_SECTION_ID = 'fonts';
const FONTS_ROW = rows.filter((r) => r.id === FONTS_ROW_ID && r.name === FONTS_PKG_NAME)[0];
const FONTS_PLUGIN = FONTS_ROW ? plugins.filter((p) => p.label === FONTS_ROW.name)[0] : undefined;

/** ①③④ 宿主面：字体行整族缺席/在场、关闭后零残留、只动自己那行。 */
function fontsRowHostProblems(i) {
  const bad = [];
  // 前提（判据要有牙）：字体行的宿主半边必须真留下可观测的贡献，否则"关闭后整族缺席"是恒真。
  if (!i.own || i.own.size === 0) {
    bad.push('字体行的宿主半边在独占 table 里注册 0 条路由 —— "关闭后整族缺席"对它恒真（本轮它应贡献 fontsets + system-fonts 整族）');
    return bad;
  }
  const leak = inter(i.offKeys, i.own);
  if (leak.length) bad.push('关闭态仍在表里：' + leak.join(', '));
  const onExtra = minus(i.onKeys, new Set([...i.offKeys, ...i.own]));
  if (onExtra.size) bad.push('开启态多出不属于任何一行的路由：' + [...onExtra].join(', '));
  const onMissing = minus(new Set([...i.offKeys, ...i.own]), i.onKeys);
  if (onMissing.size) bad.push('开启态缺了本行整族里的路由：' + [...onMissing].join(', '));
  if (!sameSet(i.restoredKeys, i.offKeys)) {
    bad.push('再关掉后路由表没有回到关闭态：残留 ' + [...minus(i.restoredKeys, i.offKeys)].join(', ')
      + ' / 又少了 ' + [...minus(i.offKeys, i.restoredKeys)].join(', '));
  }
  const stolen = [];
  for (const [label, keys] of i.otherOwn) {
    const ov = inter(keys, i.own);
    if (ov.length) stolen.push(label + ' 也注册了字体行的族：' + ov.slice(0, 3).join(', '));
  }
  if (stolen.length) bad.push('只有字体行该动它的族，实际：' + stolen.join('；'));
  return bad;
}

/** ② 浏览器面：字体节只能经面板节注册表显形（关行 = 字体产物不装载 ⇒ 注册表里没有这一节）。 */
function panelSectionProblems(reg, panelId, sectionId) {
  if (!reg || typeof reg !== 'object') return ['面板节注册表模块装载不到'];
  const bad = [];
  for (const fn of ['weRegisterPanelSection', 'wePanelSectionsOf', 'weSetPanelSectionListener']) {
    if (typeof reg[fn] !== 'function') bad.push('src/extension-registry.js 没导出 ' + fn + '（P-C 契约 §2.1 冻结接口）');
  }
  if (bad.length) return bad;
  const fresh = reg.wePanelSectionsOf(panelId);
  if (!Array.isArray(fresh)) return ['wePanelSectionsOf("' + panelId + '") 不返回数组'];
  if (fresh.some((s) => s && s.id === sectionId)) {
    bad.push('面板节注册表在**没有装载字体产物**的初始态就已经有节 "' + sectionId + '" —— '
      + '这一节的显形不受行状态约束（直接渲染 / 静态注册），关掉行它照样在屏上');
  }
  let fired = 0, titleReads = 0;
  const prev = reg.wePanelSectionsOf(panelId).length;
  reg.weSetPanelSectionListener(() => { fired++; });
  reg.weRegisterPanelSection(panelId, sectionId, {
    id: sectionId,
    get title() { titleReads++; return '字体'; },
    order: 210,
    render: () => null,
  });
  const after = reg.wePanelSectionsOf(panelId);
  const mine = after.filter((s) => s && s.id === sectionId);
  if (mine.length !== 1) bad.push('注册字体节后 wePanelSectionsOf("' + panelId + '") 里看到 ' + mine.length + ' 个节（应为 1）');
  else if (typeof mine[0].render !== 'function') bad.push('注册表里的字体节没有 render 函数（descriptor.render 必须来自注册表）');
  if (after.length !== prev + 1) bad.push('注册字体节后节数 ' + after.length + '，应为 ' + prev + ' + 1');
  if (fired === 0) bad.push('注册面板节没有通知 weSetPanelSectionListener 的订阅者 —— 迟到注册不会重画，外观页签看不到这一节');
  if (titleReads !== 0) bad.push('注册期读了 title ' + titleReads + ' 次（契约 §2.1：注册期不得求值 getter，那时 i18n 表可能还没到位）');

  // §2.1 第三条硬口径（id 唯一）：作用域 = **一次页面生命周期**。同页二次注册必须当场抛 —— 它把
  // "同一页面内 bundle 被求值两次"这种异常状态暴露出来，而不是静默半渲染；且抛错必须是原子的。
  // （运行期同页"关→开→关"不做判据：DSH 行开关在浏览器侧 = 客户端图 prune + 客户端重载，
  //   真实链路上"关→再开"是新的页面生命周期，注册表随之重建。见 Lead v3 裁决。）
  let dupErr = null;
  try {
    reg.weRegisterPanelSection(panelId, sectionId, { id: sectionId, title: () => '字体', render: () => null });
  } catch (e) { dupErr = e; }
  if (!dupErr) {
    bad.push('同一 (' + panelId + '/' + sectionId + ') 二次注册没有抛错（契约 §2.1 ③ id 唯一：作用域 = 一次页面生命周期，'
      + '二次注册意味着同一页面内 bundle 被求值两次，必须当场暴露而不是静默半渲染）');
  } else if (!/重复注册/.test(String((dupErr && dupErr.message) || dupErr))) {
    bad.push('二次注册抛了错但文案里没有"重复注册"：' + String((dupErr && dupErr.message) || dupErr).split('\n')[0]);
  }
  const afterDup = reg.wePanelSectionsOf(panelId).filter((s) => s && s.id === sectionId).length;
  if (afterDup !== 1) {
    bad.push('二次注册抛错后节表被改动："' + sectionId + '" 现在有 ' + afterDup + ' 个（抛错必须是原子的，不留半注册的节）');
  }

  // §2.1 第一条硬口径（缺什么抛什么）+ 描述符形状：四条非法注册必须当场抛，且抛错必须原子。
  // 补牙理由：这两条是 §2.1 冻结接口的承重面（导出的 renderer 会被主包直接调用；缺 render 的节在屏上是
  // "凭空消失"），原先只有"注册成功"的正向读数，非法描述符照收的实现会被判绿。
  const countBefore = reg.wePanelSectionsOf(panelId).length;
  const miss = [];
  const mustThrow = (why, fn) => {
    try { fn(); miss.push(why + '（没有抛）'); } catch { /* 抛了才合格 */ }
  };
  mustThrow('描述符缺 render', () => reg.weRegisterPanelSection(panelId, '__we_probe_norender', { id: '__we_probe_norender', get title() { return 'x'; } }));
  mustThrow('描述符缺 title', () => reg.weRegisterPanelSection(panelId, '__we_probe_notitle', { id: '__we_probe_notitle', render: () => null }));
  mustThrow('描述符 id 与 sectionId 不一致', () => reg.weRegisterPanelSection(panelId, '__we_probe_mismatch', { id: '__we_probe_other', get title() { return 'x'; }, render: () => null }));
  mustThrow('描述符不是对象', () => reg.weRegisterPanelSection(panelId, '__we_probe_null', null));
  mustThrow('sectionId 为空字符串', () => reg.weRegisterPanelSection(panelId, '', { id: '', get title() { return 'x'; }, render: () => null }));
  mustThrow('panelId 为空字符串', () => reg.weRegisterPanelSection('', '__we_probe_nopanel', { id: '__we_probe_nopanel', get title() { return 'x'; }, render: () => null }));
  if (miss.length) bad.push('§2.1 ①「缺什么抛什么」没抛：' + miss.join('；'));
  const countAfter = reg.wePanelSectionsOf(panelId).length;
  if (countAfter !== countBefore) {
    bad.push('非法注册改动了节表：' + countBefore + ' -> ' + countAfter + '（抛错必须是原子的）');
  }
  if (reg.wePanelSectionsOf('').length !== 0) bad.push('空 panelId 的注册在表里留下了节（panelId 校验失效）');

  // §2.1 顺序口径 = (order, 注册序)，描述符不写 order ⇒ 落到默认位。屏上顺序必须与今天逐项一致，
  // 而"跨包求值顺序不保证"意味着顺序只能由声明决定 —— 所以这里用注册序**反向**登记三个节来钉它。
  reg.weRegisterPanelSection(panelId, '__we_probe_late', { id: '__we_probe_late', get title() { return '晚'; }, order: 300, render: () => null });
  reg.weRegisterPanelSection(panelId, '__we_probe_default', { id: '__we_probe_default', get title() { return '默认位'; }, render: () => null });
  const orderIds = reg.wePanelSectionsOf(panelId).map((s) => s && s.id);
  const wantOrder = ['__we_probe_default', sectionId, '__we_probe_late'];
  if (orderIds.join(',') !== wantOrder.join(',')) {
    bad.push('屏上顺序不等于 (order, 注册序)：实得 [' + orderIds.join(', ') + ']，应为 [' + wantOrder.join(', ')
      + ']（默认位 ' + 100 + ' < ' + sectionId + ' 的 210 < 300；仅按注册序排会把字体节挤到末尾之外）');
  }
  return bad;
}

/** ② 的归属面（文本）：字体节的注册住在**字体包产物**里，主包产物不许内联，屏上可见面必须按注册表取节。 */
const FONTS_REG_RE = /registerPanelSection\s*\([^)]{0,160}fonts/;
/**
 * 注册表的取节面（panel-tabs / 外观页签按它画节）。
 * 口径必须是**大小写不敏感 + 不要求调用形式**：§2.1 冻的是 `wePanelSectionsOf(panelId)`
 * （大写 P，本文件早先写的 /panelSectionsOf\s*\(/ 只认小写 p，对真实现恒不命中 —— 假红），
 * 而消费侧也可能写成解构后的别名（`const { wePanelSectionsOf: sectionsOf } = host;`）。
 */
const PANEL_READ_RE = /panelsectionsof\b/i;
function fontsSectionOwnershipProblems(t) {
  const bad = [];
  // 文本面一律先过 stripComments()：注释里写一句 `registerPanelSection(… "fonts" …)` **不算**注册
  // （否则"注册真代码被删掉、注释留着"会恒绿 = 假绿），反向也不许拿注释当"主包内联"的证据。
  if (typeof t.fontsArtifact !== 'string' || t.fontsArtifact.length === 0) {
    bad.push('字体包客户端产物读不到（' + t.fontsArtifactRel + '）—— 没有地方注册这一节，外观页签不会有字体节');
  } else if (!FONTS_REG_RE.test(stripComments(t.fontsArtifact))) {
    bad.push('字体包客户端产物里没有面板节注册（/registerPanelSection( … fonts/）：' + t.fontsArtifactRel
      + ' —— 字体节的显形不在包产物里（注释里的字句不算，已过 stripComments），关行不能让它消失');
  }
  // 覆盖面无牙地板（真空为真）：主包产物 / 外观页签源码**读不到**时，"主包没有内联这一节"会静默通过。
  // 这与 verify-host-teardown 的 NC3 是同一个纪律：判据的输入取不到就必须判红，不许真空为真。
  if (typeof t.rootArtifact !== 'string' || t.rootArtifact.length === 0) {
    bad.push('主包客户端产物读不到（' + (t.rootArtifactRel || 'lib/client.js') + '）—— "主包没有内联这一节"对它是真空为真');
  }
  if (typeof t.rootAppearanceSrc !== 'string' || t.rootAppearanceSrc.length === 0) {
    bad.push('外观页签源码读不到（src/panel-tabs-appearance.js）—— 同上，"没有内联注册"是真空为真');
  }
  for (const [label, text] of [['主包客户端产物', t.rootArtifact], ['外观页签源码', t.rootAppearanceSrc]]) {
    if (typeof text === 'string' && FONTS_REG_RE.test(stripComments(text))) {
      bad.push(label + '里内联了字体节的面板节注册（注释不算，已过 stripComments）—— 这一节又回到"不受行状态约束"的静态渲染');
    }
  }
  const readers = (t.panelSrcs || []).filter(([, text]) => typeof text === 'string' && PANEL_READ_RE.test(stripComments(text)));
  if (readers.length === 0) {
    bad.push('外观页签 / 面板层源码里没有一处按注册表取节（/panelSectionsOf( …/）：可见面不是从注册表派生的，'
      + '"关行 ⇒ 外观页签不再画字体节"不成立（字体节的显形又回到静态清单）');
  }
  return bad;
}

{
  if (!FONTS_ROW || !FONTS_PLUGIN) {
    check('字体实例前提：根 patch 有字体行（id=' + FONTS_ROW_ID + ' name=' + FONTS_PKG_NAME + '）且入口可装载',
      false, FONTS_ROW ? '行入口装载失败（' + FONTS_ROW.rel + '）' : 'cordis.patch.yml 里找不到该行');
  } else {
    const own = measureOwn([FONTS_PLUGIN]).get(FONTS_PLUGIN.label);
    const others = plugins.filter((p) => p.label !== FONTS_PLUGIN.label);
    const otherOwn = measureOwn(others);
    const t = makeTable();
    for (const p of others) { const f = makeFiber(t.webServer); loadDroppingReturn(p.apply, f.ctx); }
    const offKeys = keySet(t.table);
    const fOn = makeFiber(t.webServer);
    loadDroppingReturn(FONTS_PLUGIN.apply, fOn.ctx);
    const onKeys = keySet(t.table);
    fOn.unload();
    const restoredKeys = keySet(t.table);
    const probs = fontsRowHostProblems({ own, offKeys, onKeys, restoredKeys, otherOwn });
    check('字体实例 ①③④：关 -> 开 -> 再关 字体行整族缺席/在场、关闭后零残留、只动自己那行',
      probs.length === 0, probs.join('\n      '));
    console.log('    · 字体行宿主贡献 ' + own.size + ' 条：' + [...own].slice(0, 4).join(', ') + (own.size > 4 ? ' …' : ''));
    const leftover = inter(keySet(t.table), own);
    check('字体实例③：关掉字体行后它自己的路由一条不剩', leftover.length === 0, leftover.join(', '));

    // 负对照（合成输入，不依赖磁盘变异）：检测函数必须不是恒真。
    const neg = [];
    const negCase = (patch, why) => {
      const r = fontsRowHostProblems(Object.assign({ own, offKeys, onKeys, restoredKeys, otherOwn }, patch));
      if (r.length === 0) neg.push(why + '（没有被判红）');
    };
    negCase({ offKeys: new Set([...offKeys, [...own][0]]) }, '关闭态仍留着字体行的一条路由');
    negCase({ onKeys: minus(onKeys, new Set([[...own][0]])) }, '开启态少了一条本行路由');
    negCase({ restoredKeys: new Set([...restoredKeys, [...own][0]]) }, '再关掉后有残留');
    negCase({ own: new Set() }, '字体行宿主侧 0 贡献（前提缺失）');
    negCase({ otherOwn: new Map([['others', new Set([...own])]]) }, '别的行也注册了字体族的同一族');
    check('负对照：字体行宿主面检测函数在合成坏输入下都判红（不恒真）', neg.length === 0, neg.join('；'));

    // ② 运行时：真注册表模块（fresh 实例 = "字体产物还没装载"的初始态）
    let reg = null, regErr = null;
    try { reg = await import(pathToFileURL(join(ROOT, 'src/extension-registry.js')).href + '?fonts-instance=' + Date.now()); }
    catch (e) { regErr = e; }
    const regProbs = regErr
      ? ['装载 src/extension-registry.js 失败：' + String(regErr.message || regErr).split('\n')[0]]
      : panelSectionProblems(reg, PANEL_ID, FONTS_SECTION_ID);
    check('字体实例②：外观页签的字体节只能经面板节注册表显形（初始态无此节 / 装上后可见 / 订阅者被通知 / 注册期不读译文 / 同页二次注册原子抛错 / §2.1 ①缺什么抛什么且原子 / 顺序 = (order, 注册序)）',
      regProbs.length === 0, regProbs.join('\n      '));

    // ② 负对照：合成实现。'good' 是**正对照**（其余 modes 都是"只差一处"的坏实现）——
    // 没有正对照，新增的"缺什么抛什么 / 顺序 (order, 注册序)"就可能恒红而没人发现。
    const mkFake = (mode) => {
      let listener = null;
      let titleReads = 0;
      const table = new Map();                       // panelId -> Map(sectionId -> {descriptor, seq})
      let seq = 0;
      const DEFAULT_ORDER = 100;
      const fire = () => { if (typeof listener === 'function') listener(); };
      const put = (panelId, sectionId, d) => {
        let m = table.get(panelId);
        if (!m) { m = new Map(); table.set(panelId, m); }
        seq += 1; m.set(sectionId, { descriptor: d, seq });
      };
      return {
        // 可观察的"注册期读译文"计数：负对照靠它证明 readTitle 那一条**真的**读了 title
        // （否则"判红"可能来自别的缺陷，负对照就没有牙）。用普通读取，不引入 `void`（静态棘轮 no-void）。
        get titleReads() { return titleReads; },
        weRegisterPanelSection(panelId, sectionId, d) {
          if (mode === 'readTitle' && d && typeof d.title !== 'undefined') titleReads += 1;
          if (mode === 'nothrow') { put(panelId, sectionId, d); fire(); return d; }
          if (mode === 'static') return d;           // 静态实现：注册被吞掉，节却一直在屏上
          if (typeof panelId !== 'string' || panelId === '') throw new Error('panelId 非法');
          if (typeof sectionId !== 'string' || sectionId === '') throw new Error('sectionId 非法');
          if (!d || typeof d !== 'object' || d.id !== sectionId || !('title' in d) || typeof d.render !== 'function') {
            throw new Error('描述符不合法');
          }
          const m = table.get(panelId);
          if (m && m.has(sectionId)) throw new Error('面板节重复注册：' + panelId + '/' + sectionId);
          put(panelId, sectionId, d);
          if (mode !== 'silent') fire();
          return d;
        },
        wePanelSectionsOf(panelId) {
          if (mode === 'static') return [{ id: 'fonts', title: '字体', render: () => null }];
          const m = table.get(panelId);
          if (!m) return [];
          const list = Array.from(m.values());
          if (mode !== 'unsorted') list.sort((a, b) => {
            const ad = a.descriptor || {}, bd = b.descriptor || {};
            const ao = typeof ad.order === 'number' ? ad.order : DEFAULT_ORDER;
            const bo = typeof bd.order === 'number' ? bd.order : DEFAULT_ORDER;
            return ao === bo ? a.seq - b.seq : ao - bo;
          });
          return list.map((e) => e.descriptor);
        },
        weSetPanelSectionListener(fn) { listener = fn; },
      };
    };
    const goodFake = mkFake('good');
    const goodFakeProbs = panelSectionProblems(goodFake, PANEL_ID, FONTS_SECTION_ID);
    check('正对照：合成正确实现（校验 + 原子 + 通知 + 不读译文 + (order, 注册序)）⇒ 0 条（判据可满足，不是恒红）',
      goodFakeProbs.length === 0, goodFakeProbs.join(' | ') || '0 条');
    const regNeg = [], regCaught = [];
    for (const [why, fake] of [
      ['注册表初始态就直接给出字体节（直接渲染，不受行状态约束）', mkFake('static')],
      ['注册面板节不通知订阅者（迟到注册不重画）', mkFake('silent')],
      ['注册期就求值 title（把 weT 拉到 bundle 求值期）', mkFake('readTitle')],
      ['注册表缺 wePanelSectionsOf 导出', { weRegisterPanelSection() {}, weSetPanelSectionListener() {} }],
      ['缺什么都不抛（描述符缺 render/title、id 不一致、空 id 照收）', mkFake('nothrow')],
      ['顺序退回注册序（忽略 descriptor.order 与默认位）', mkFake('unsorted')],
    ]) {
      const r = panelSectionProblems(fake, PANEL_ID, FONTS_SECTION_ID);
      if (r.length === 0) regNeg.push(why + '（没有被判红）');
      else regCaught.push(why + ' ⇒ ' + r[0]);
    }
    check('负对照：面板节检测函数在"直接渲染 / 不通知 / 求值译文 / 缺接口 / 不校验 / 顺序错"六种合成实现下都判红',
      regNeg.length === 0, regNeg.join('；') || regCaught.join(' ； '));
    console.log('    · 面板节负对照逐条命中原因：' + regCaught.join(' ； '));
    // 「注册期不读译文」这条负对照的自证：合成实现在注册期**真的**读了 title（titleReads>0），
    // 且判红原因里确实有"注册期读了 title" —— 排除"被别的缺陷顺手判红"。
    const readTitleFake = mkFake('readTitle');
    const rtProbs = panelSectionProblems(readTitleFake, PANEL_ID, FONTS_SECTION_ID);
    check('负对照（readTitle 自证）：合成实现注册期确实读了 title（titleReads=' + readTitleFake.titleReads + '）且判红原因含"注册期读了 title"',
      readTitleFake.titleReads > 0 && rtProbs.some((x) => x.indexOf('注册期读了 title') >= 0),
      'titleReads=' + readTitleFake.titleReads + ' · ' + (rtProbs.join(' | ') || '（没报出来）'));

    // ② 归属：注册住在字体包产物里，主包不许内联
    const fontsPkg = pkgs.filter((p) => p.manifest && p.manifest.name === FONTS_PKG_NAME)[0];
    const fontsArtifactRel = fontsPkg
      ? (exportTarget(fontsPkg.manifest.exports && fontsPkg.manifest.exports['./client']) || '').replace(/^\.\//, '')
      : '';
    const fontsArtifactAbs = fontsPkg && fontsArtifactRel ? fontsPkg.dir + '/' + fontsArtifactRel : '';
    const rootClientRel = (exportTarget(rootPkg.exports && rootPkg.exports['./client']) || './lib/client.js').replace(/^\.\//, '');
    const panelSrcRels = ['src/panel-tabs-appearance.js', 'src/panel-tabs.js', 'src/client.js'].filter((rel) => isFile(join(ROOT, rel)));
    const owned = {
      fontsArtifactRel: fontsArtifactAbs || '(清单里没有 exports["./client"])',
      fontsArtifact: fontsArtifactAbs && isFile(join(ROOT, fontsArtifactAbs)) ? read(fontsArtifactAbs) : '',
      rootArtifact: isFile(join(ROOT, rootClientRel)) ? read(rootClientRel) : '',
      rootAppearanceSrc: isFile(join(ROOT, 'src/panel-tabs-appearance.js')) ? read('src/panel-tabs-appearance.js') : '',
      panelSrcs: panelSrcRels.map((rel) => [rel, read(rel)]),
      rootArtifactRel: rootClientRel,
    };
    const ownProbs = fontsSectionOwnershipProblems(owned);
    check('字体实例②归属：字体节的注册住在字体包客户端产物里、主包产物不许内联、可见面按注册表取节',
      ownProbs.length === 0, ownProbs.join('\n      '));
    // 负对照自证：把每个坏输入**被抓到的第一条原文原因**打出来（否则"没有变红"这件事在日志里
    // 只剩一句 ok，复核者无法判断它是因为目标缺陷变红、还是被别的地板顺手判红）。
    const ownNeg = [], ownCaught = [];
    const GOOD_ART = 'const host = require("dsh-plugin-wallpaper-engine"); host.registerPanelSection("appearance", "fonts", { id: "fonts" });';
    const BAD_ROOT = 'x.registerPanelSection("appearance", "fonts", { id: "fonts", render: () => null });';
    const GOOD_READ = ['x', 'const secs = wePanelSectionsOf("appearance");'];
    // 每个坏输入只带**一个**缺陷：主包产物 / 外观页签源码默认给"读得到、但没内联注册"的正常文本，
    // 否则新加的覆盖面无牙地板会替别的缺陷判红，负对照就不再是"这条缺陷被抓到"的证据。
    const GOOD_ROOT = 'window.__ModuleLoader__.load({ id: "dsh-plugin-wallpaper-engine", factory: () => {} });';
    const GOOD_APP = 'export function renderAppearanceFontSection() { return null; }';
    const base = (over) => Object.assign({
      fontsArtifactRel: 'x', rootArtifact: GOOD_ROOT, rootAppearanceSrc: GOOD_APP, panelSrcs: [GOOD_READ],
    }, over);
    for (const [why, tt] of [
      ['字体产物里没有面板节注册（节留在主包 = 直接渲染）', base({ fontsArtifact: 'window.__ModuleLoader__.load({ id: "fonts", factory: () => {} });' })],
      ['字体产物里只有注释写了面板节注册（注释不算注册 ⇒ 不许假绿）', base({
        fontsArtifact: 'window.__ModuleLoader__.load({ id: "fonts", factory: () => {} });'
          + ' /* host.registerPanelSection("appearance", "fonts", { id: "fonts" }); */',
      })],
      ['主包客户端产物内联了字体节注册', base({ fontsArtifact: GOOD_ART, rootArtifact: BAD_ROOT })],
      ['外观页签源码内联了字体节注册', base({ fontsArtifact: GOOD_ART, rootAppearanceSrc: BAD_ROOT })],
      ['字体产物读不到（清单没声明 exports["./client"]）', base({ fontsArtifact: '' })],
      ['主包客户端产物读不到（覆盖面无牙：没内联恒真）', base({ fontsArtifact: GOOD_ART, rootArtifact: '' })],
      ['外观页签源码读不到（覆盖面无牙：没内联恒真）', base({ fontsArtifact: GOOD_ART, rootAppearanceSrc: '' })],
      ['可见面不按注册表取节（一处 panelSectionsOf( 都没有）', base({ fontsArtifact: GOOD_ART, panelSrcs: [] })],
      ['可见面用了别的名字 / 别的注册表（不是面板节注册表的取节面）', base({ fontsArtifact: GOOD_ART, panelSrcs: [['x', 'const secs = panelSections("appearance");']] })],
    ]) {
      const r = fontsSectionOwnershipProblems(tt);
      if (r.length === 0) ownNeg.push(why + '（没有被判红）');
      else ownCaught.push(why + ' ⇒ ' + r[0]);
    }
    check('负对照：归属检测函数在"节没搬进产物 / 只有注释注册 / 主包内联 / 页签内联 / 产物缺失 / 两份文本读不到 / 可见面不派生 / 取节面被替名"九种坏输入下都判红',
      ownNeg.length === 0, ownNeg.join('；') || ownCaught.join(' ； '));
    console.log('    · 归属负对照逐条命中原因：' + ownCaught.join(' ； '));
    // 正对照：两侧都能满足 ⇒ 0 条。没有这一条，"可见面不派生"会恒红 —— 假红比恒真更坏，
    // 它会让真实现落地后仍旧看不到绿（本轮就踩过：GOOD_READ 里的 wePanelSectionsOf 是大写 P，
    // 而旧正则是 /panelSectionsOf\s*\(/ 只认小写 p）。
    const goodAll = base({ fontsArtifact: GOOD_ART });
    const goodProbs = fontsSectionOwnershipProblems(goodAll);
    check('正对照：字体产物里有面板节注册 + 可见面按注册表取节 ⇒ 0 条（归属判据两侧都可满足，不是恒红）',
      goodProbs.length === 0, goodProbs.join(' | ') || '0 条');
    console.log('    · 字体包客户端产物：' + (owned.fontsArtifact
      ? owned.fontsArtifactRel + '（' + owned.fontsArtifact.length + ' 字符）'
      : '不在盘（等 fonts-pc 落 packages/fonts/src/client.js + client.build.json 后 npm run build）'));
  }
}

console.log('');
if (failed) { console.log('SUBPACKAGE TOGGLE ROUNDTRIP CHECKS FAILED -- ' + failed + ' failed'); process.exit(1); }
console.log('ALL SUBPACKAGE TOGGLE ROUNDTRIP CHECKS PASSED');
process.exit(0);
