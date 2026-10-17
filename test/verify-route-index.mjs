#!/usr/bin/env node
/**
 * verify-route-index.mjs — **路由索引不许烂掉**（P2-11 前置 1 的守卫）。
 *
 * 账本 §3.5 把"路由索引"列为 P2-11 的前置 1：它既是导航表，也是将来 context 对象的**设计稿**。
 * 但手写索引一定会烂 —— 所以索引由 `test/tools/host-route-index.mjs` 生成，本守卫**重算并逐字节比对**
 * `docs/ROUTE-INDEX.md`：路由增删、路径改名、处理器换了形态而忘了重新生成，这里都会红。
 *
 * 断言（每条都配负对照，见各节）：
 *   ① 索引文件与"从源码现算的索引"逐字节一致；
 *   ② 覆盖面：路由条数 > 20（防解析器静默返回空表 ⇒ ① 变成空对空）；
 *   ③ **路由模块不漏**：`lib/routes/*.js` 每个都进了索引，且没有"文件在、apply 里没调用"的孤儿；
 *   ④ **context 契约没有死声明**：模块声明了却没用到的 `c` 字段必须为 0；
 *   ⑤ **索引 == 运行时真实注册**（裸行 + **所有**组件行，逐行数据驱动；这条才是真有牙的那条，见下）。
 *
 * 为什么必须有 ⑤：`webServer.register({` 的**字面量**条数与索引行数做比较是"文本对文本"，
 * 两边可以一起错。**实测**形态：`for (const seg of ['media','preview']) { … register(…) }`
 * 一个字面量产出**两条**路由，索引若把它折成一行 `(动态路径)` 就记 30 条、运行时实际 31 条，
 * 而字面量比对（30 == 30）永远绿 —— /media 与 /preview 就这样从设计稿里消失。
 * （该循环后来已搬进 `lib/routes/media-bytes.js`，本判据的 ② 节相应改成**按文件**对账。）
 * ⑤ 用 mock webServer 真的跑一遍 `apply()` 数注册条数，是唯一能发现这类折叠的判据。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildIndex, parseRouteModuleText, SUBPACKAGE_MODULES, rowRegistrationCounts } from './tools/host-route-index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log('  ✓ ' + name + (detail ? ' — ' + detail : ''));
  else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); failed++; }
};

console.log('\n① 路由索引与代码一致');
const { text, routes, modules, orphanModules } = buildIndex();
const file = readFileSync(join(ROOT, 'docs', 'ROUTE-INDEX.md'), 'utf8').replace(/\r\n/g, '\n').trimEnd();
check('docs/ROUTE-INDEX.md 与现算的索引一致', file === text.trimEnd(),
  file === text.trimEnd() ? routes.length + ' 条路由' : '不一致 ⇒ 跑 `node test/tools/host-route-index.mjs --write`');
// 覆盖面：解析器若静默返回空表，上面那条会变成空对空
check('负对照：解析器确实抓到了路由（>20 条）', routes.length > 20, routes.length + ' 条');
// 负对照：必须把改动后的文本**喂给同一条判据**再断言它判"不一致"。
// 断言 `mutated !== text` 只证明"正则替换命中了"，不证明那条比较能失败（属"同源比较"一类）。
const sameAsIndex = (t) => t.trimEnd() === text.trimEnd();
const mutated = text.replace(/(\| `\/inventory` \|)/, '| `/inventory-typo` |');
check('负对照：索引里的路径被改动会被判不一致', mutated !== text && sameAsIndex(mutated) === false);
// 覆盖断言：每个路由模块的路由都必须真的出现在索引里 —— 这条可以失败（恒真式做不到）。
check('每个路由模块的路由都出现在索引里',
  modules.every((m) => routes.some((r) => r.src === m.rel)),
  modules.map((m) => m.rel).join(' ') || '（还没有路由模块）');
// "零提及"行必须**与实际计算一致**：只对索引文本做 `/零提及/.test(text)` 会命中它自己的
// 图例行、从不看数据 ⇒ 恒真。故这条判据按路由数据现算。
const uncoveredNow = routes.filter((r) => !r.mentions).map((r) => r.path);
const expectedZero = uncoveredNow.length ? uncoveredNow.map((p) => '`' + p + '`').join('、') : '（无）';
const zeroLine = text.split('\n').find((l) => l.startsWith('**零提及')) || '';
// 判据提成命名函数，让阳性（真文档行）与阴性（构造的漂移行）走**同一条判据**：
// 原对照是 `X.replace(a,b)` 之后在结果里再找 `a` —— 对任何输入恒真，零鉴别力。
const zeroLineMatches = (line) => line.includes(expectedZero);
check('索引的"零提及"行与实际计算一致', zeroLineMatches(zeroLine),
  '实际零提及 ' + uncoveredNow.length + ' 条');
check('负对照：零提及行被改动会被同一条判据判不一致',
  zeroLineMatches('**零提及**：`/__nope__`') === false && zeroLineMatches('') === false,
  `零提及行 ${zeroLine ? '在' : '缺失'}`);

console.log('\n② 循环注册：一个 register 字面量产出多条路由时必须逐条列出');
{
  // 负对照：字面量条数与路由条数**不相等**是正常的（循环展开），相等才说明没展开。
  // ⚠️ 拆分后 `/media` 循环不在门面里了（已搬进 `lib/routes/media-bytes.js`）⇒ 这条对账
  //    必须**按文件**做：门面"路由数 == 字面量数"，循环所在的那个模块"路由数 > 字面量数"。
  const host = readFileSync(join(ROOT, 'lib', 'index.js'), 'utf8');
  const literals = (host.match(/webServer\.register\(\{/g) || []).length;
  const fromMain = routes.filter((r) => r.src === 'lib/index.js').length;
  check('门面里的注册字面量逐条列出（门面已无循环注册）',
    fromMain === literals, `字面量 ${literals} = 路由 ${fromMain}`);
  const bytesSrc = readFileSync(join(ROOT, 'lib', 'routes', 'media-bytes.js'), 'utf8');
  const bytesLiterals = (bytesSrc.match(/webServer\.register\(\{/g) || []).length;
  const fromBytes = routes.filter((r) => r.src === 'lib/routes/media-bytes.js').length;
  check('媒体字节族的循环注册已展开（1 个字面量 ⇒ 2 条路由）',
    bytesLiterals === 1 && fromBytes === bytesLiterals + 1,
    `字面量 ${bytesLiterals} + 1（media/preview 循环）= 路由 ${fromBytes}`);
  // 同一条"按文件对账"纪律的第二例：P0.2-D 把 apply() 里最后一条内联注册（`/inventory`）
  // 搬进了 lib/routes/inventory.js ⇒ 门面字面量归零后，这 1 条路由也在模块里逐条对账。
  const invSrc = readFileSync(join(ROOT, 'lib', 'routes', 'inventory.js'), 'utf8');
  const invLiterals = (invSrc.match(/webServer\.register\(\{/g) || []).length;
  const fromInv = routes.filter((r) => r.src === 'lib/routes/inventory.js').length;
  check('清单 JSON 路由的内联注册已展开（1 个字面量 ⇒ 1 条路由）',
    invLiterals === 1 && fromInv === invLiterals,
    `字面量 ${invLiterals} = 路由 ${fromInv}`);
  check('负对照：索引里同时有 /media 与 /preview（折叠成一行时这条会红）',
    routes.some((r) => r.path === '/media') && routes.some((r) => r.path === '/preview'));
}

console.log('\n③ 路由模块（lib/routes/*.js）不漏进索引');
{
  check('索引里有来自路由模块的路由', modules.length > 0 && routes.some((r) => r.src.startsWith('lib/routes/')),
    modules.map((m) => m.rel + '(' + m.routes.length + ')').join(' ') || '（还没有路由模块）');
  check('没有孤儿模块（文件在、apply 里却没有调用）', orphanModules.length === 0,
    orphanModules.map((m) => m.rel).join(' ') || '全部有调用点');
  // （原负对照"索引里没有 lib/routes/nope.js"断言的是一个**不可能存在的名字** ⇒ 恒真；
  //   域非空已由上面 :82 的"modules 非空 + 索引里有来自路由模块的路由"地板守住，故删除。）
}

console.log('\n④ context 契约没有死声明');
{
  const dead = modules.filter((m) => m.unused.length);
  check('每个路由模块声明的 `c` 字段都被用到', dead.length === 0,
    dead.map((m) => m.rel + ':' + m.unused.join(',')).join(' ') || '无死声明');
  // 负对照 1：声明了却没用到 ⇒ 必须报出来（否则 ④ 永远绿）
  const probe = parseRouteModuleText([
    'export function registerX(webServer, c) {',
    '  const { used, unusedField } = c;',
    '  void used;',
    "  webServer.register({ kind: 'exact', path: '/x', handler: (q, r) => r.end() });",
    '}',
  ].join('\n'), 'lib/routes/x.js', 'registerX');
  check('负对照：声明了却没用的 `c` 字段会被报出来', probe.unused.join(',') === 'unusedField',
    'unused=[' + probe.unused.join(',') + ']');
  // 负对照 2：嵌套回调的形参 `c` 与 context 同名，**不得**被当成 context 字段
  // （实测：req.on('data', (c) => … c.length) 让 `length` 混进契约）
  const shadow = parseRouteModuleText([
    'export function registerY(webServer, c) {',
    '  const { base } = c;',
    '  webServer.register({ kind: "exact", path: base + "/y", handler: (req, res) => {',
    '    req.on("data", (c) => { res.end(String(c.length)); });',
    '  } });',
    '}',
  ].join('\n'), 'lib/routes/y.js', 'registerY');
  check('负对照：嵌套回调里同名的 `c` 不会污染 context 契约',
    shadow.fields.map((f) => f.field).join(',') === 'base',
    'fields=[' + shadow.fields.map((f) => f.field).join(',') + ']');
  // 下限断言（防空集恒真）：**源码里有 `= c;` 解构，就必须解析出 ≥1 个字段**。
  // 少了这条，解析器一旦解析不出多行解构就会静默返回空字段表 —— 于是"无死声明"与索引里
  // 那一整列**一起空转**（实测：字段一多就换行，upload.js 的 15 个字段曾被整列显示为空）。
  const blind = modules.filter((m) => readFileSync(join(ROOT, m.rel), 'utf8').includes('= c;') && m.fields.length === 0);
  check('有解构的路由模块都解析出了 `c` 字段（解析不得静默变空）', blind.length === 0,
    blind.map((m) => m.rel).join(' ') || modules.map((m) => m.rel + ':' + m.fields.length).join(' '));
  // 负对照：跨多行的解构必须被解析出来（逐行匹配的旧写法会在这一条上红）
  const multiline = parseRouteModuleText([
    'export function registerZ(webServer, c) {',
    '  const {',
    '    alpha, beta: B, gamma,',
    '  } = c;',
    '  void alpha; void B; void gamma;',
    "  webServer.register({ kind: 'exact', path: '/z', handler: (q, r) => r.end() });",
    '}',
  ].join('\n'), 'lib/routes/z.js', 'registerZ');
  check('负对照：跨多行的 `c` 解构会被解析出全部字段',
    multiline.fields.map((f) => f.field).join(',') === 'alpha,beta,gamma',
    'fields=[' + multiline.fields.map((f) => f.field).join(',') + ']');
}

// ── ⑤ 运行时对账：真的跑一遍 apply()，数它注册了多少条 ────────────────────────
// 环境隔离**必须在 import lib/index.js 之前**完成：apply() 启动时会碰缓存/配置目录，
// 不隔离就会动用户真实的那份（与 verify-scene-live.mjs 同一套约定）。
const ISO = join(ROOT, '.test-cache', 'route-index');
process.env.DSH_WE_CACHE_DIR = join(ISO, 'cache');
process.env.DSH_WE_DATA_DIR = join(ISO, 'data');
process.env.DSH_WE_UPLOAD_DIR = join(ISO, 'uploads');
process.env.HOME = join(ISO, 'home');
process.env.USERPROFILE = process.env.HOME;

console.log('\n⑤ 索引 == 运行时真实注册的路由（唯一能发现"循环折叠"的判据）');
{
  const mod = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href);
  const host = mod.default || mod;
  // `applyComponent` 是具名导出（`export default` 只有 { inject, apply }）⇒ 这里必须读命名空间。
  const applyComponent = mod.applyComponent || host.applyComponent;
  const registered = [];
  const mock = {
    // 组件行与主行同款取服务姿势：`inject = ['webServer']` + 直读 `ctx.webServer`（真机
    // 故障：未声明 inject 就直读会被 cordis reflect 门禁抛错）⇒ mock 提供 `webServer` 即可。
    webServer: {
      register(route) { registered.push(route); return () => {}; },
      tapIndex() { return () => {}; },
    },
  };
  const dispose = (host.apply || (host.inject && host.apply))(mock);
  // P2-1/P2-2：组件行是**独立 plugin**（patch 里一行一行加载）⇒ 同一条 mock 上逐行都跑一遍，再与
  // 索引做**严格等式**（并集，不是 ≥）。放松成 ≥ 就发现不了"组件行悄悄少注册一条 / 多注册一条"。
  // 组件清单与"每行该注册几条"（该入口调用的路由族条数）都**现算** —— 不写死组件名，也不写死 2。
  // ⚠️ P-F 批 1c：三格组件已全部出户到 `packages/<pkg>/` ⇒ 发现层的 `kind === 'subpath'` 为空，
  // `COMPONENT_MODULES` 是空数组**属预期形态**（不是"少了行"）。组件清单因此改由**声明面**现解析：
  // `COMPONENT_VIEW_KEYS` 点名的每一格 → 出户落 `packages/<pkg>/lib/index.js`、未出户落
  // `lib/components/<pkg>/index.js`。出户那几格在下面的**子包行**循环里要跳过，否则同一 mock 上
  // 注册两遍（并集等式与 (kind,path) 去重都会误红），而它们已经在这一节按门面分发点姿势各跑过一遍。
  const { COMPONENT_VIEW_KEYS } = await import(pathToFileURL(join(ROOT, 'lib', 'kernel', 'component-session.js')).href);
  const declaredComponents = Object.keys(COMPONENT_VIEW_KEYS || {}).sort();
  const entryRelOf = (name) => (existsSync(join(ROOT, 'packages', name, 'lib', 'index.js'))
    ? 'packages/' + name + '/lib/index.js' : 'lib/components/' + name + '/index.js');
  const componentEntryRels = declaredComponents.map(entryRelOf);
  const componentDisposers = [];
  const perComponent = [];
  const countIssues = [];
  for (let i = 0; i < declaredComponents.length; i++) {
    const sub = declaredComponents[i];
    const rel = componentEntryRels[i];
    const before = registered.length;
    componentDisposers.push(typeof applyComponent === 'function' ? applyComponent(mock, undefined, sub) : undefined);
    const got = registered.length - before;
    const exp = rowRegistrationCounts(rel, modules);
    if (exp.unknown.length) countIssues.push(sub + ' 调用点解析不到路由模块：' + exp.unknown.join(' '));
    else if (got !== exp.expected) countIssues.push(sub + ' 注册 ' + got + ' 条 ≠ 路由族 ' + exp.expected + ' 条（' + exp.fns.join(' ') + '）');
    perComponent.push(sub + '=' + got);
  }
  check('每个组件（声明面的每一格）在同一个 mock 上注册的条数 == 它调用的路由族条数（逐行数据驱动）',
    declaredComponents.length >= 1 && componentEntryRels.every((rel) => existsSync(join(ROOT, rel))) && countIssues.length === 0,
    countIssues.join('；') || perComponent.join(' '));
  // P-A：**子包行**也是独立 plugin（patch 里裸真名一行）⇒ 与组件行同款在同一个 mock 上逐行跑一遍。
  // 这一遍同时是 D3③ 的机器事实：跨行注册面若重合，本节的 (kind, path) 重复判据当场现形
  // （fonts 搬迁期实测：主包门面与子包行都注册 fontsets ⇒ 装第二行时 "duplicate prefix route"）。
  const subpackageDisposers = [];
  const perSubpackage = [];
  const outMovedComponents = new Set(componentEntryRels);
  for (const rel of SUBPACKAGE_MODULES) {
    // P-F：出户组件已在上面的组件节按门面分发点姿势跑过 ⇒ 这里跳过，避免同一 mock 重复注册。
    if (outMovedComponents.has(rel)) continue;
    const short = rel.replace(/^packages\//, '').split('/')[0];
    const before = registered.length;
    const entry = await import(pathToFileURL(join(ROOT, rel)).href);
    const applyFn = entry.apply || (entry.default && entry.default.apply);
    subpackageDisposers.push(typeof applyFn === 'function' ? applyFn(mock) : undefined);
    const got = registered.length - before;
    const exp = rowRegistrationCounts(rel, modules);
    if (exp.unknown.length) countIssues.push(short + ' 调用点解析不到路由模块：' + exp.unknown.join(' '));
    else if (got !== exp.expected) countIssues.push(short + ' 注册 ' + got + ' 条 ≠ 路由族 ' + exp.expected + ' 条（' + exp.fns.join(' ') + '）');
    perSubpackage.push(short + '=' + got);
  }
  check('每个子包行在同一个 mock 上注册的条数 == 它调用的路由族条数（逐行数据驱动，含零路由空壳行）',
    SUBPACKAGE_MODULES.length >= 1 && countIssues.length === 0,
    countIssues.join('；') || perSubpackage.join(' '));
  check('运行时注册条数 == 索引行数（裸行 + 组件行 + 子包行的并集）', registered.length === routes.length,
    `运行时 ${registered.length} / 索引 ${routes.length}`);
  // 跨行 (kind, path) 不得重复：宿主对重复注册**可能**抛错（R1 未证实），这里兜底钉住"两行注册面不相交"。
  const keyed = registered.map((r) => r.kind + ' ' + r.path);
  const dupes = [...new Set(keyed.filter((k, i) => keyed.indexOf(k) !== i))];
  check('跨行无重复 (kind, path)（裸行与组件行的注册面不相交）', dupes.length === 0, dupes.join(' ') || '无重复');
  // 负对照：循环注册在运行时**确实**是两条独立的注册（证明上面那条对账有对象可数）
  const looped = registered.filter((r) => r.path === '/wallpaper-engine/media' || r.path === '/wallpaper-engine/preview');
  check('负对照：循环注册在运行时是两条独立注册', looped.length === 2, looped.map((r) => r.path).join(' '));
  // 每条索引里的路径都必须在运行时注册里出现（索引不得有幽灵路由）
  const runtimePaths = new Set(registered.map((r) => r.path));
  const ghosts = routes.filter((r) => r.path !== '(动态路径)' && !runtimePaths.has('/wallpaper-engine' + r.path)
    && !runtimePaths.has(r.path));
  check('索引里没有幽灵路由（每条都在运行时注册表里）', ghosts.length === 0,
    ghosts.map((r) => r.path).join(' ') || '全部对得上');
  // 反向：运行时注册的路径也要在索引里（这条与"条数相等"互补，防止一增一减互相抵消）
  const indexed = new Set(routes.map((r) => r.path === '(动态路径)' ? null : r.path).filter(Boolean));
  const unindexed = [...runtimePaths].filter((p) => !indexed.has(p.replace(/^\/wallpaper-engine/, '')));
  check('运行时注册的路径都在索引里（没有路由绕过索引）', unindexed.length === 0, unindexed.join(' ') || '全部在索引');
  if (typeof dispose === 'function') { try { dispose(); } catch { /* 清理失败不影响判定 */ } }
  for (const d of componentDisposers) { if (typeof d === 'function') { try { d(); } catch { /* 同上 */ } } }
  for (const d of subpackageDisposers) { if (typeof d === 'function') { try { d(); } catch { /* 同上 */ } } }
}

console.log('');
if (failed) { console.log(`ROUTE INDEX CHECKS FAILED — ${failed} failed`); process.exit(1); }
console.log('ALL ROUTE INDEX CHECKS PASSED');
process.exit(0);
