/**
 * guard-targets.mjs —— 「哪个守卫管哪个模块」的**派生映射**（§4 期 1）。
 *
 * 为什么需要：守卫的名字（`verify-theme-follow`）**不总是**它真正断言的东西
 * （例如 `verify-api-client` 在代码里碰了 **14** 个模块；`verify-i18n` 碰了 8 个）——
 * 于是"改了 `src/x.js` 该跑哪几条"只能靠猜。本工具从**守卫自己的代码**里派生这张映射，
 * 而不是让作者维护一份清单：清单漏一行只会让那个文件**静默脱离**（[`DEV-GUIDE.md`] §4.7 约定 4）。
 *
 * 覆盖本仓实际出现的七种写法：
 *   A) 字面量路径      `'src/picker-model.js'` / `'../src/client.js'`
 *   B) 目录拼接        `join(root, 'src', 'quick-panel.js')`（含嵌套如 `'font','apply.js'`）
 *   C) 纯文件名        `'quick-panel.js'`（切片 / 读源码用）—— 只在 basename **唯一**时认
 *   D) 内联产物        `lib/client.js` · `packages/<pkg>/lib/client.<x>.js` —— 单独一档（多数行为
 *      判据是隔着产物做的）。产物面**取发现层 `clientPackages`**（不写死清单），且把**整个产物
 *      集合**从「直接读的模块」列里移出 —— 主包产物与子包产物同档。
 *   E) **前缀族读法**  `scopeFiles('src/i18n-copy')` / `scopeText('src/i18n-copy')`
 *      （`test/tools/src-scope.mjs` 的 API）—— 构建期内联族是"一族文件平铺进同一作用域"，
 *      于是"这条守卫管这一族"的自然写法就是**前缀**：路径以该前缀开头的模块全部算命中。
 *   F) **经共享族助手读**  `import { panelText } from './tools/src-scope.mjs'` + 真调用
 *      —— 守卫常常不写前缀字面量，而是调助手（`panelText()` / `styleText()` …），
 *      族口径封在 `test/tools/src-scope.mjs` 里。那个库**同时是守卫的库**（DEV-GUIDE §4.6：
 *      改它等于改判据），所以判据跟着走一层：解析助手体里的字面量前缀。
 *   G) **真源定位读**  `locate('COMPONENT_VISIBILITY')` / `locateFile('cordis.patch.yml')`
 *      / `locateCallSites('registerSettingsRoutes')`（`test/tools/source-locator.mjs` 的 API）
 *      —— 判据不再写死"实现在哪个文件"，而是问真源定位器"这个符号唯一声明在哪 / 这个调用点在哪"。
 *      **映射必须跟着认这种写法**，否则"把写死路径改成符号锚点"会让那个模块的守卫覆盖
 *      **静默消失**（本类正是为了堵这个洞）。解析不到（符号 0 处 / 多处同名 / 解析到的文件
 *      不在模块面）⇒ **零命中**，不许当覆盖。
 *
 * ⚠️ 判据只看**代码**（先剥注释）：模块名出现在散文里不算"管它"——
 * 否则每个头注释提到 `src/client.js` 的守卫都会被算成 client 的守卫。
 *
 * ⚠️ 扫描面（`moduleSurface`）是**磁盘通配**（`packages/<dir>/{src,lib}`，只许长不许缩），产物面却来自
 * **发现层**（`test/tools/packages.mjs` 的 `clientPackages`）。两者发散时（`packages/<dir>` 有
 * `package.json` 却没被认成 standalone 包）该目录的模块会被扫进模块面、产物面却没有判据 ⇒
 * 由 `packageDivergences()` 显式报红（退出码 1），而不是静默少一档。
 *
 * Usage:  node test/tools/guard-targets.mjs [--json] [--map]
 *   --map   输出 docs/GUARD-MAP.md 的内容（不写盘；由 `--write` 决定写不写）
 *   --write 写入 docs/GUARD-MAP.md
 *   --json  机器可读
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// 剥注释走共享实现（§4.7 约定 3）：本文件自己的头注释里就写着 `'src/…'` 字面量。
import { stripComments } from './js-text.mjs';
// G) 真源定位：`locate('SYM')` 的解析要用**同一份**索引（符号 → 唯一声明文件）。
import { index as sourceIndex, locateCallSites } from './source-locator.mjs';
// D) 产物面的真源：包 ⇄ 浏览器半边产物的对应关系只有发现层一处（写死清单会静默脱离）。
import { discoverPackages } from './packages.mjs';

// `test/tools/` 比 `test/` 深一层 ⇒ 推仓库根退**两层**（CODE-STRUCTURE §4 第 5 条）。
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEST = join(ROOT, 'test');
/** 主包产物（浏览器半边唯一可加载的形态）—— 产物这一档的**锚点**：`viaBundle` 只认它。 */
const MAIN_ARTIFACT = 'lib/client.js';

/** 路径统一成发现层口径（根相对 · 正斜杠 · 无 `./` 前缀）。 */
const relOf = (s) => String(s).replace(/\\/g, '/').replace(/^\.\//, '');

/**
 * **产物面**（分母来自发现层，不是写死清单）：`clientPackages` = 主包 + 每个声明了浏览器半边
 * （`dsh.client` / `exports['./client']`）的 standalone 子包各一份。BUNDLE-SPLIT §7.2「每包一产物」。
 * 写死清单的失败模式：新增一份产物后它**静默脱离**本映射 —— 守卫隔着的产物换了一茬，
 * 映射还指着老的那份，于是"改了哪个源文件该跑哪条守卫"给出错误答案。
 */
function artifactSurface(root = ROOT) {
  const rels = [];
  for (const p of discoverPackages(root).clientPackages) {
    const rel = p.clientArtifact ? relOf(p.clientArtifact) : '';
    if (rel && !rels.includes(rel)) rels.push(rel);
  }
  return rels;
}

// 解析一次缓存（`targetsOf` 的缺省参数每行都会求值 —— 别在循环里反复读盘）。
let artifactCache = null;
function artifactsOf(root = ROOT) {
  if (!artifactCache) artifactCache = new Set(artifactSurface(root));
  return artifactCache;
}

/**
 * **发散判据**：扫描面是磁盘通配（只许长不许缩），产物面来自发现层。`packages/<dir>` 有
 * `package.json` 却不在 `discoverPackages().packages` 里 ⇒ 该目录的模块被扫进模块面，
 * 却没有任何"能不能被加载 / 新鲜度"判据盯着它（它的浏览器半边不会被编出来）。
 * 返回 `{ dirs, discovered, divergent, error }`：`discovered` 为 null 表示发现层本身抛错。
 */
function packageDivergences(root = ROOT) {
  const dirs = packageDirs(root);
  let discovered;
  try {
    discovered = new Set(discoverPackages(root).packages.map((p) => relOf(p.dir)));
  } catch (e) {
    return { dirs, discovered: null, divergent: dirs, error: String((e && e.message) || e) };
  }
  return { dirs, discovered, divergent: dirs.filter((d) => !discovered.has('packages/' + d)), error: '' };
}

function walk(dir, out = [], base = '') {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules') continue;
    const rel = base ? base + '/' + n : n;
    const abs = join(dir, n);
    if (statSync(abs).isDirectory()) walk(abs, out, rel);
    else if (/\.(js|mjs|cjs)$/.test(n)) out.push(rel);
  }
  return out;
}

/** `packages/<pkg>/` 下的子包目录名（P-A 起产品源码分居主包与子包两处；没有 `packages/` 时为空）。 */
function packageDirs(root = ROOT) {
  const dir = join(root, 'packages');
  let names;
  try { names = readdirSync(dir); } catch { return []; }
  return names.filter((n) => { try { return statSync(join(dir, n)).isDirectory(); } catch { return false; } }).sort();
}

/**
 * 磁盘上的模块面（`src/**` + `lib/**` + **`packages/<pkg>/{src,lib}/**`**，含 `lib/client.js`
 * —— 它是"隔着产物"的那一档）。
 *
 * ⚠️ P-A（BUNDLE-SPLIT §7.1 / §10.1 #8）之前这里只走主包两棵树：子包迁出后，`packages/<pkg>/src|lib/**`
 * 里的产品代码会**整片脱离**这张映射 —— 症状不是报错，而是这些文件既不进"零覆盖"表、也不会在
 * "改了 X 该跑哪几条"里出现（静默失去覆盖，正是本工具存在的理由）。
 */
function moduleSurface(root = ROOT) {
  const out = [...walk(join(root, 'src'), [], 'src'), ...walk(join(root, 'lib'), [], 'lib')];
  for (const pkg of packageDirs(root)) {
    for (const sub of ['src', 'lib']) {
      const dir = join(root, 'packages', pkg, sub);
      try { out.push(...walk(dir, [], `packages/${pkg}/${sub}`)); } catch { /* 该子目录不存在 */ }
    }
  }
  return out.sort();
}

/** 守卫面：`verify-*` / `*-smoke` / `e2e-*` / `compat-*`。 */
function guardSurface(testDir = TEST) {
  return readdirSync(testDir).filter((f) => /^(verify-.*|.*-smoke|e2e-.*|compat-.*)\.mjs$/.test(f)).sort();
}

/**
 * **不参与**映射的守卫 —— 结构性自指：本工具与它的判据一起工作，
 * 而本工具内部必然写着"怎么认模块路径"的**示例字面量**（如 `'<src>/x.js'`）。
 * 把它们算进映射，会让"零覆盖"表被工具自己的示例**掩盖**（实测踩过两次）。
 * ⇒ 两者一起排除；它们的目标是**映射本身**，不是模块行为。
 */
const SELF_REFERENTIAL = [
  'verify-guard-map.mjs',   // 判据：对账生成物
  'tools/guard-targets.mjs', // 工具：派生映射（不是守卫，但同属这一体）
];

/**
 * 判据（唯一一份）：从一段**守卫源码** + 模块面派生出它碰的模块。
 * 正判据与负对照调这一个函数。
 */
const SCOPE_LIB = 'test/tools/src-scope.mjs';

/**
 * F) 的解析层：`test/tools/src-scope.mjs` 里每个**导出的族助手** → 它体内引用的字面量前缀。
 * （`panelText()` → `['src/panel-tabs']`；`styleText()` → `['src/styles']`；`cssBodyOf(text)`
 *  收的是文本 ⇒ 没有前缀 ⇒ 不进表、也不该进表。）
 *
 * ⚠️ 四条**不许放宽**的边界（每一条都有负对照真的在跑，见 `test/verify-guard-map.mjs` ⑥c）：
 *   ① 只认 `test/tools/src-scope.mjs` 这一个库（别的文件里同名函数不算）；
 *   ② 助手体里必须有**字面量**前缀（`scopeFiles(prefix)` 用变量 ⇒ 解析不出，不认）；
 *   ③ 守卫必须**真的调用**那个导入名（只 `import` 不调用不算 —— 否则"导入后忘了用"
 *      会被算成覆盖，而真实读法是零）；
 *   ④ 前缀匹配不到任何磁盘模块 ⇒ 零命中不算覆盖（与 E 同一条地板，防"万能豁免"）。
 */
function familyHelpers(root = ROOT) {
  let text;
  try { text = stripComments(readFileSync(join(root, SCOPE_LIB), 'utf8')); } catch { return new Map(); }
  const out = new Map();
  for (const chunk of text.split(/\bexport\s+function\s+/).slice(1)) {
    const name = chunk.slice(0, chunk.indexOf('(')).trim();
    if (!name) continue;
    const prefixes = [...chunk.matchAll(/(?<![\w$.])(?:scopeFiles|scopeText)\s*\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    if (prefixes.length) out.set(name, [...new Set(prefixes)]);
  }
  return out;
}

/**
 * G) 的解析层：**锚点表**（符号名 → 唯一声明文件；文件名 → 唯一命中文件），只保留
 * `modules`（模块面）里的那些 —— 锚点落在模块面之外时**零命中**（不是覆盖）。
 *
 * 与 F 同一条纪律：`locate()` 命中多处 / 零处的符号**不进表**，于是"判据引用了一个
 * 已经不唯一的名字"在映射上表现为**零覆盖**（红），而不是静默认成"管了那个模块"。
 */
function anchorTable(root = ROOT, modules = moduleSurface(root), guardTexts = []) {
  const symbols = new Map();
  const files = new Map();
  const callSites = new Map();
  // ⚠️ 声明**不带初值**：`let idx = {…}` 的初值读不到（catch 里直接 return）⇒
  //    静态门禁的 `no-useless-assignment` 会红（本仓基线是空棘轮，只能减不能增）。
  let idx;
  try { idx = sourceIndex(root); } catch { return { symbols, files, callSites }; }
  for (const [sym, hits] of idx.bySymbol) {
    if (hits.length !== 1) continue;
    if (modules.includes(hits[0].rel)) symbols.set(sym, hits[0].rel);
  }
  for (const [base, rels] of idx.files || []) {
    const uniq = [...new Set(rels)];
    if (uniq.length === 1 && modules.includes(uniq[0])) files.set(base, uniq[0]);
  }
  // `locateCallSites('SYM')`：**按需**解析（只在守卫真的写了这个调用时才算；全量扫会白烧）。
  const wanted = new Set();
  for (const raw of guardTexts) {
    const code = stripComments(String(raw));
    for (const m of code.matchAll(/locateCallSites\s*\(\s*['"]([^'"]+)['"]/g)) wanted.add(m[1]);
  }
  for (const sym of wanted) {
    try {
      const r = locateCallSites(sym, { root });
      if (r.ok && modules.includes(r.hit.rel)) callSites.set(sym, r.hit.rel);
    } catch { /* 解析失败 ⇒ 不进表 ⇒ 零命中（不是覆盖） */ }
  }
  return { symbols, files, callSites };
}

/** 无锚点表（合成夹具的缺省：G 类写法**零命中** —— 负对照就靠这个证明"表格外的名字不算覆盖"）。 */
const NO_ANCHORS = { symbols: new Map(), files: new Map(), callSites: new Map() };

function targetsOf(srcText, modules, helpers = familyHelpers(), anchors = NO_ANCHORS, artifacts = artifactsOf()) {
  // 相对说明符的 `../` 前缀先剥掉：`'../lib/routes/system-fonts.js'` 里模块路径左邻是 `/`
  //（在下方的左边界排除类里）⇒ 直接匹配会漏（实测：verify-system-fonts 直接 import 的
  // 路由文件被判成零覆盖）。剥前缀只影响字符串开头的点斜杠段，不会把 `assets/../src/x.js`
  // 这类"路径中段"伪造出来（中段的 `../` 前邻仍是字符，不在 `(['"])(\.\./)+` 的射程）。
  const code = stripComments(String(srcText)).replace(/(['"])((?:\.\.\/)+)/g, '$1');
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hits = new Set();
  // A) 字面量路径。**必须按路径边界匹配**，不能 `includes` 子串：
  //    否则判据自己的注释里写个模板 `src/x.js`，或 `assets/src/a.js` 这种更长路径，
  //    都会被当成"真的引用了这个模块"（实测踩过：本工具的调用方因此被算成管了 4 个模块，
  //    它自己的例外表反而被掩盖）。左边界排除 `[\w$.\-/]`，右边界排除 `[\w$\-]`。
  // ⚠️ **产物面整集合单列**：守卫常经 `'client.js'` 常量或 URL 拼它，不走路径字面量；
  //    而它又是"隔着产物做模块断言"那一档的落点 ⇒ 单列判并在 `targets` 里带上它。
  //    产物**不止一份**（BUNDLE-SPLIT §7.2「每包一产物」）⇒ 这里跳过的是**产物集合**，
  //    集合本身由发现层给出（写死一份的失败模式：新产物静默脱离本映射）。
  for (const m of modules) {
    if (artifacts.has(m)) continue;
    const pat = new RegExp('(?<![\\w$.\\-/])' + esc(m) + '(?![\\w$-])');
    if (pat.test(code)) hits.add(m);
  }
  // 产物：常经**相对 URL / 常量 / 字符串拼接 / 目录分段 join / 纯文件名**引用（不是路径字面量）。
  // 只认这几种**配方**，不做裸子串匹配 —— 否则散文/文档里提一句就会被算成"读它"
  // （实测：本工具的调用方因为自己生成映射，被自己算成了产物守卫）。
  // 配方**按每一份产物生成**：主包 `lib/client.js` 的四条与历史上写死的四条**逐字同形**
  // （`new URL('../lib/client.js', …)` · `join(ROOT, 'lib', 'client.js')` · `ROOT + 'lib/client.js'`
  //  · `'client.js'` 常量）；子包产物只是把路径分段换成它自己的（`packages/fx/lib/client.fx.js`）。
  //  第五种（产物面**整集合**）：守卫经**发现层枚举**产物面 —— `import … from './tools/packages.mjs'`
  //  且用了 `clientPackages` / `clientArtifact`。这类守卫目标是**整个产物面**，不给配方就会在
  //  `targets` 里一份产物都不剩（正是本工具存在的理由：覆盖静默脱离）。
  const viaDiscovery = /['"][^'"]*tools\/packages\.mjs['"]/.test(code)
    && /clientPackages|clientArtifact/.test(code);
  for (const art of artifacts) {
    const segs = art.split('/');
    const base = segs.pop();
    const dirPat = segs.map((s) => "['\"]" + esc(s) + "['\"]").join('\\s*,\\s*');
    const relPat = esc(art).replace(/\//g, '\\/');
    if (viaDiscovery                                                                  // 经发现层枚举产物面
      || new RegExp('new URL\\(\\s*[\'"][^\'"]*' + relPat + '[\'"]').test(code)        // new URL('../lib/client.js', import.meta.url)
      || new RegExp('join\\([^)]*' + dirPat + '\\s*,\\s*[\'"]' + esc(base) + '[\'"]').test(code) // join(ROOT, 'lib', 'client.js')
      || new RegExp('[\'"][^\'"]*' + relPat + '[\'"]').test(code)                     // ROOT + 'lib/client.js'
      || new RegExp('[\'"]' + esc(base) + '[\'"]').test(code)) hits.add(art);          // 'client.js' 常量
  }
  // B) join(..., 'packages', <pkg>, 'src'|'lib', <parts>) —— 子包面（P-A 起）。
  for (const m of code.matchAll(/join\([^)]*?['"]packages['"]\s*,\s*((?:['"][^'"]+['"]\s*,?\s*)+)\)/g)) {
    const parts = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
    const cand = 'packages/' + parts.join('/');
    if (modules.includes(cand)) hits.add(cand);
  }
  // B) join(..., 'src'|'lib', <parts>)
  for (const [rootDir, prefix] of [['src', 'src/'], ['lib', 'lib/']]) {
    const re = new RegExp(`join\\([^)]*?['"]${rootDir}['"]\\s*,\\s*((?:['"][^'"]+['"]\\s*,?\\s*)+)\\)`, 'g');
    for (const m of code.matchAll(re)) {
      const parts = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
      const cand = prefix + parts.join('/');
      if (modules.includes(cand)) hits.add(cand);
    }
  }
  // C) 纯 basename（只在唯一时认）
  const byBase = new Map();
  for (const m of modules) {
    const b = m.split('/').pop();
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push(m);
  }
  for (const [base, list] of byBase) {
    if (list.length !== 1) continue;
    if (new RegExp(`['"]${esc(base)}['"]`).test(code)) hits.add(list[0]);
  }
  // E) **前缀族读法**：`scopeFiles(<字面量前缀>)` / `scopeText(<字面量前缀>)`
  //    （`test/tools/src-scope.mjs` 的 API；单一真源 = 解析 `scripts/build-client.mjs` 的
  //    `INLINE_MODULES`）。本仓的构建期内联族天生是"一族文件平铺进同一作用域"，所以
  //    "这条守卫管这一族"的自然写法只能是前缀 —— 逐个写 7 条字面量路径既不现实也会漂。
  //
  //    ⚠️ 三条**不许放宽**的边界：
  //      ① 前缀必须是**代码里的字符串字面量**（先剥注释 ⇒ 注释里提一句不算，同 A–C）；
  //      ② 只认 `scopeFiles` / `scopeText` 这两个**裸调用**（前面不许是 `.` ⇒ `x.scopeText(…)` 不算）；
  //      ③ **零命中不算覆盖**：前缀若匹配不到任何磁盘模块，`hits` 里一个都不加。
  //         这一条同时是"不许变成万能豁免"的地板 —— 前缀只覆盖**真实存在的同族文件**，
  //         所以这里"按 `startsWith(prefix)`"不会比 `src-scope.mjs` 的族语义更宽
  //         （它的族成员同样只能是 `INLINE_MODULES` 里真实存在的文件）。
  //         负对照（`verify-guard-map.mjs` ⑥ 有一条真的在跑）：`scopeText('src/zzz')`
  //         在磁盘上没有同族模块 ⇒ 必须**零命中**。
  for (const m of code.matchAll(/(?<![\w$.])(?:scopeFiles|scopeText)\s*\(\s*['"]([^'"]+)['"]/g)) {
    const prefix = m[1];
    for (const mod of modules) if (mod.startsWith(prefix)) hits.add(mod);
  }
  // F) **经共享族助手读**：`import { panelText } from './tools/src-scope.mjs'` + 真调用 `panelText(…)`。
  //    见 `familyHelpers()` 的四条边界。别名写法（`import { panelText as pt }`）按**本地名**
  //    判"有没有真调用"，但族前缀要从**原名**查（`pt` 不在助手表里，`panelText` 才在）。
  const scoped = new Map(); // 本地名 → 助手原名
  for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"][^'"]*tools\/src-scope\.mjs['"]/g)) {
    for (const raw of m[1].split(',')) {
      const parts = raw.trim().split(/\s+as\s+/).map((s) => s.trim()).filter(Boolean);
      if (parts.length === 2) scoped.set(parts[1], parts[0]);
      else if (parts.length === 1) scoped.set(parts[0], parts[0]);
    }
  }
  for (const [local, orig] of scoped) {
    if (!new RegExp('(?<![\\w$.])' + esc(local) + '\\s*\\(').test(code)) continue; // 只 import 不调用不算
    for (const prefix of helpers.get(orig) || []) {
      for (const mod of modules) if (mod.startsWith(prefix)) hits.add(mod);
    }
  }
  // G) **真源定位读**：`import { locate, locateFile } from './tools/source-locator.mjs'` + 真调用。
  //    四条边界（与 F 对称，负对照见 `verify-guard-map.mjs` ⑥d）：
  //      ① 只认 `test/tools/source-locator.mjs` 这一个库（别的文件里同名函数不算）；
  //      ② 实参必须是**字符串字面量**（`locate(sym)` 用变量 ⇒ 解析不出 ⇒ 不认）；
  //      ③ 只认裸调用（前邻不许是 `.` ⇒ `x.locate(…)` 不算）；
  //      ④ **解析不到锚点 ⇒ 零命中**（符号 0 处 / 多处 / 落在模块面之外都不算覆盖）。
  const located = new Map();
  for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"][^'"]*tools\/source-locator\.mjs['"]/g)) {
    for (const raw of m[1].split(',')) {
      const parts = raw.trim().split(/\s+as\s+/).map((s) => s.trim()).filter(Boolean);
      if (parts.length === 2) located.set(parts[1], parts[0]);
      else if (parts.length === 1) located.set(parts[0], parts[0]);
    }
  }
  for (const [local, orig] of located) {
    const re = new RegExp('(?<![\\w$.])' + esc(local) + '\\s*\\(\\s*([\'"])([^\'"]+)\\1', 'g');
    for (const m of code.matchAll(re)) {
      const table = orig === 'locateFile' ? anchors.files
        : (orig === 'locateCallSites' ? anchors.callSites : anchors.symbols);
      const rel = table && table.get(m[2]);
      if (rel && modules.includes(rel)) hits.add(rel);
    }
  }
  return [...hits].sort();
}

/** 整张映射（派生，不手写）。 */
function buildMap(root = ROOT) {
  const modules = moduleSurface(root);
  const helpers = familyHelpers(root); // F 的族助手表（解析一次，别在循环里反复读盘）
  const guards = guardSurface(join(root, 'test'))
    .filter((g) => !SELF_REFERENTIAL.includes(g)); // 结构性自指见上面的说明
  const texts = new Map(guards.map((g) => [g, readFileSync(join(root, 'test', g), 'utf8')]));
  const anchors = anchorTable(root, modules, [...texts.values()]); // G 的锚点表（符号/文件/调用点 → 唯一落点）
  const rows = guards.map((g) => {
    const raw = texts.get(g);
    const targets = targetsOf(raw, modules, helpers, anchors);
    // `viaBundle` 只作为**注释性**列：真源是 `targets` 里有没有**主包**产物 `lib/client.js`
    // （只用 `code.includes` 会与 targets 口径漂开 —— 实测踩过一次）。子包产物**不算**"隔着产物"
    // 这一列：它们自己就是产物面的一档，且历史口径就是主包产物一个。
    return { guard: g, targets, viaBundle: targets.includes(MAIN_ARTIFACT) };
  });
  const covered = new Set(rows.flatMap((r) => r.targets));
  return {
    modules,
    rows,
    uncovered: modules.filter((m) => !covered.has(m)),
    fanIn: Object.fromEntries(modules.map((m) => [m, rows.filter((r) => r.targets.includes(m)).length])),
  };
}

/** 渲染 `docs/GUARD-MAP.md`（**生成物**，勿手改）。 */
function render(map) {
  const artifacts = artifactsOf(); // 产物集合（发现层）—— 「直接读的模块」列与 targetsOf 同一口径
  const out = [];
  out.push('# 守卫映射（生成物，勿手改）');
  out.push('');
  out.push('> 由 `node test/tools/guard-targets.mjs --write` 重算；`test/verify-guard-map.mjs` 会重算并逐字比对。');
  out.push('> **怎么用**：改了 `src/` 或 `lib/` 的某个模块，在「模块 → 守卫」那张表里查该跑哪几条。');
  out.push('> 口径：只统计守卫**代码**里真正碰到的模块（先剥注释），并区分"直接读源文件"与"隔着产物 `lib/client.js`"。');
  out.push('> 写法：字面量路径 / `join(...)` 拼接 / 唯一 basename / 产物配方 / **前缀族读法** `scopeFiles|scopeText(<前缀>)` / **经共享族助手读**（`import { panelText } from \'./tools/src-scope.mjs\'` + 真调用；族口径封在那个库里，见 DEV-GUIDE §4.6「同时是守卫的库」）/ **真源定位读**（`locate(\'符号\')` / `locateFile(\'文件名\')`，`test/tools/source-locator.mjs`：符号唯一声明在哪就是读了哪个模块）。');
  out.push('');
  out.push(`模块面 ${map.modules.length} 个 · 守卫 ${map.rows.length} 个`);
  out.push('');
  out.push('## 守卫 → 模块');
  out.push('');
  out.push('| 守卫 | 直接读的模块 | 隔着产物 |');
  out.push('|---|---|:--:|');
  for (const r of map.rows) {
    // 「直接读的模块」列里**整份产物集合**都不出现（主包与子包产物同档，另见「隔着产物」列）——
    // 否则产物一旦不止一份，这一列就会把子包产物当成"直接读的源文件"混进来。
    const direct = r.targets.filter((t) => !artifacts.has(t)).map((t) => '`' + t + '`').join(' ');
    out.push(`| \`${r.guard}\` | ${direct || '—'} | ${r.viaBundle ? '✅' : ''} |`);
  }
  out.push('');
  out.push('## 模块 → 守卫');
  out.push('');
  out.push('| 模块 | 守卫数 | 守卫 |');
  out.push('|---|---:|---|');
  for (const m of map.modules) {
    const guards = map.rows.filter((r) => r.targets.includes(m)).map((r) => '`' + r.guard.replace(/\.mjs$/, '') + '`');
    out.push(`| \`${m}\` | ${guards.length} | ${guards.join(' ') || '**（无）**'} |`);
  }
  out.push('');
  return out.join('\n');
}

export {
  moduleSurface, guardSurface, targetsOf, buildMap, render, familyHelpers, anchorTable,
  artifactSurface, artifactsOf, packageDivergences, MAIN_ARTIFACT,
};

// 作为脚本直接跑时才输出（被 import 时不得有副作用 —— 守卫要 import 本模块）
const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === new URL('file://' + process.argv[1].replace(/\\/g, '/')).href.replace(/^file:\/\/\//, 'file:///');
if (invokedDirectly) {
  const map = buildMap();
  // 发散判据（见头注释）：扫描面 ⇄ 发现层。发散时**映射照样输出**，但退出码非 0 ——
  // 静默少一档是这张映射最危险的失败模式（它会被读成"这些模块没人管"）。
  const div = packageDivergences();
  const divergent = div.divergent.length > 0 || div.discovered === null;
  if (divergent) {
    console.error('[guard-targets] ✗ packages/ 枚举面 ⇄ 发现层发散：'
      + (div.discovered === null
        ? 'discoverPackages() 抛错 — ' + div.error
        : div.divergent.join(' ') + '（有 package.json 却没被认成 standalone 包 ⇒ 产物面没有判据）'));
  }
  if (process.argv.includes('--json')) { console.log(JSON.stringify(map, null, 2)); process.exit(divergent ? 1 : 0); }
  const md = render(map);
  if (process.argv.includes('--write')) {
    writeFileSync(join(ROOT, 'docs', 'GUARD-MAP.md'), md, 'utf8');
    console.log('已写入 docs/GUARD-MAP.md');
  } else {
    console.log(md);
  }
  const short = (p) => p.replace(/^src\//, '').replace(/^lib\//, 'lib/');
  console.log(`\n[guard-targets] 模块 ${map.modules.length} 个 · 守卫 ${map.rows.length} 个 · 零覆盖 ${map.uncovered.length} 个`);
  console.log(`  产物 ${artifactsOf().size} 份（发现层 clientPackages）：${[...artifactsOf()].join(' ')}`);
  if (map.uncovered.length) console.log('  零覆盖：' + map.uncovered.map(short).join(' '));
  if (divergent) console.log('  ✗ packages/ 发散：' + (div.discovered === null ? '发现层抛错' : div.divergent.join(' ')));
  process.exit(divergent ? 1 : 0);
}
