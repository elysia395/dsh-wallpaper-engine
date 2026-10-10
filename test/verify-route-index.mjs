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
 *   ⑤ **索引 == 运行时真实注册**（这条才是真有牙的那条，见下）。
 *
 * 为什么必须有 ⑤：`webServer.register({` 的**字面量**条数与索引行数做比较是"文本对文本"，
 * 两边可以一起错。**实测**形态：`for (const seg of ['media','preview']) { … register(…) }`
 * 一个字面量产出**两条**路由，索引若把它折成一行 `(动态路径)` 就记 30 条、运行时实际 31 条，
 * 而字面量比对（30 == 30）永远绿 —— /media 与 /preview 就这样从设计稿里消失。
 * （该循环后来已搬进 `lib/routes/media-bytes.js`，本判据的 ② 节相应改成**按文件**对账。）
 * ⑤ 用 mock webServer 真的跑一遍 `apply()` 数注册条数，是唯一能发现这类折叠的判据。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildIndex, parseRouteModuleText } from './tools/host-route-index.mjs';

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
  const registered = [];
  const dispose = (host.apply || (host.inject && host.apply))({
    webServer: {
      register(route) { registered.push(route); return () => {}; },
      tapIndex() { return () => {}; },
    },
  });
  check('运行时注册条数 == 索引行数', registered.length === routes.length,
    `运行时 ${registered.length} / 索引 ${routes.length}`);
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
}

console.log('');
if (failed) { console.log(`ROUTE INDEX CHECKS FAILED — ${failed} failed`); process.exit(1); }
console.log('ALL ROUTE INDEX CHECKS PASSED');
process.exit(0);
