/**
 * guard-targets.mjs —— 「哪个守卫管哪个模块」的**派生映射**（§4 期 1）。
 *
 * 为什么需要：守卫的名字（`verify-theme-follow`）**不总是**它真正断言的东西
 * （例如 `verify-api-client` 在代码里碰了 **14** 个模块；`verify-i18n` 碰了 8 个）——
 * 于是"改了 `src/x.js` 该跑哪几条"只能靠猜。本工具从**守卫自己的代码**里派生这张映射，
 * 而不是让作者维护一份清单：清单漏一行只会让那个文件**静默脱离**（[`DEV-GUIDE.md`] §4.7 约定 4）。
 *
 * 覆盖本仓实际出现的六种写法：
 *   A) 字面量路径      `'src/picker-model.js'` / `'../src/client.js'`
 *   B) 目录拼接        `join(root, 'src', 'quick-panel.js')`（含嵌套如 `'font','apply.js'`）
 *   C) 纯文件名        `'quick-panel.js'`（切片 / 读源码用）—— 只在 basename **唯一**时认
 *   D) 内联产物        `lib/client.js` —— 单独统计（多数行为判据是隔着产物做的）
 *   E) **前缀族读法**  `scopeFiles('src/i18n-copy')` / `scopeText('src/i18n-copy')`
 *      （`test/tools/src-scope.mjs` 的 API）—— 构建期内联族是"一族文件平铺进同一作用域"，
 *      于是"这条守卫管这一族"的自然写法就是**前缀**：路径以该前缀开头的模块全部算命中。
 *   F) **经共享族助手读**  `import { panelText } from './tools/src-scope.mjs'` + 真调用
 *      —— 守卫常常不写前缀字面量，而是调助手（`panelText()` / `styleText()` …），
 *      族口径封在 `test/tools/src-scope.mjs` 里。那个库**同时是守卫的库**（DEV-GUIDE §4.6：
 *      改它等于改判据），所以判据跟着走一层：解析助手体里的字面量前缀。
 *
 * ⚠️ 判据只看**代码**（先剥注释）：模块名出现在散文里不算"管它"——
 * 否则每个头注释提到 `src/client.js` 的守卫都会被算成 client 的守卫。
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

// `test/tools/` 比 `test/` 深一层 ⇒ 推仓库根退**两层**（CODE-STRUCTURE §4 第 5 条）。
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEST = join(ROOT, 'test');
/** 构建产物（浏览器半边唯一可加载的形态）—— 单独一档：多数行为判据隔着它做断言。 */
const ARTIFACT = 'lib/client.js';

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

/** 磁盘上的模块面（`src/**` + `lib/**`，含 `lib/client.js` —— 它是"隔着产物"的那一档）。 */
function moduleSurface(root = ROOT) {
  return [...walk(join(root, 'src'), [], 'src'), ...walk(join(root, 'lib'), [], 'lib')].sort();
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

function targetsOf(srcText, modules, helpers = familyHelpers()) {
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
  // ⚠️ **产物 `lib/client.js` 单列**：守卫常经 `'client.js'` 常量或 URL 拼它，不走路径
  //    字面量；而它又是"隔着产物做模块断言"那一档的落点 ⇒ 单独判并在 `targets` 里带上它。
  for (const m of modules) {
    if (m === ARTIFACT) continue;
    const pat = new RegExp('(?<![\\w$.\\-/])' + esc(m) + '(?![\\w$-])');
    if (pat.test(code)) hits.add(m);
  }
  // 产物：`lib/client.js` 常经**相对 URL / 常量 / 字符串拼接 / resolve** 引用（不是路径字面量）。
  // 只认这几种**配方**，不做裸子串匹配 —— 否则散文/文档里提一句 `lib/client.js` 就会被算成"读它"
  // （实测：本工具的调用方因为自己生成映射，被自己算成了产物守卫）。本轮实际出现的配方：
  //   `new URL('../lib/client.js', import.meta.url)` · `'client.js'` 常量 · `ROOT + 'lib/client.js'`
  //   · `resolve(ROOT, 'lib/client.js')`
  if (/new URL\(\s*['"][^'"]*lib\/client\.js['"]/.test(code)
    || /join\([^)]*['"]lib['"]\s*,\s*['"]client\.js['"]/.test(code)
    || /['"][^'"]*lib\/client\.js['"]/.test(code)
    || /['"]client\.js['"]/.test(code)) hits.add(ARTIFACT);
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
  return [...hits].sort();
}

/** 整张映射（派生，不手写）。 */
function buildMap(root = ROOT) {
  const modules = moduleSurface(root);
  const helpers = familyHelpers(root); // F 的族助手表（解析一次，别在循环里反复读盘）
  const guards = guardSurface(join(root, 'test'))
    .filter((g) => !SELF_REFERENTIAL.includes(g)); // 结构性自指见上面的说明
  const rows = guards.map((g) => {
    const raw = readFileSync(join(root, 'test', g), 'utf8');
    const targets = targetsOf(raw, modules, helpers);
    // `viaBundle` 只作为**注释性**列：真源是 `targets` 里有没有 `lib/client.js`
    // （只用 `code.includes` 会与 targets 口径漂开 —— 实测踩过一次）。
    return { guard: g, targets, viaBundle: targets.includes('lib/client.js') };
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
  const out = [];
  out.push('# 守卫映射（生成物，勿手改）');
  out.push('');
  out.push('> 由 `node test/tools/guard-targets.mjs --write` 重算；`test/verify-guard-map.mjs` 会重算并逐字比对。');
  out.push('> **怎么用**：改了 `src/` 或 `lib/` 的某个模块，在「模块 → 守卫」那张表里查该跑哪几条。');
  out.push('> 口径：只统计守卫**代码**里真正碰到的模块（先剥注释），并区分"直接读源文件"与"隔着产物 `lib/client.js`"。');
  out.push('> 写法：字面量路径 / `join(...)` 拼接 / 唯一 basename / 产物配方 / **前缀族读法** `scopeFiles|scopeText(<前缀>)` / **经共享族助手读**（`import { panelText } from \'./tools/src-scope.mjs\'` + 真调用；族口径封在那个库里，见 DEV-GUIDE §4.6「同时是守卫的库」）。');
  out.push('');
  out.push(`模块面 ${map.modules.length} 个 · 守卫 ${map.rows.length} 个`);
  out.push('');
  out.push('## 守卫 → 模块');
  out.push('');
  out.push('| 守卫 | 直接读的模块 | 隔着产物 |');
  out.push('|---|---|:--:|');
  for (const r of map.rows) {
    const direct = r.targets.filter((t) => t !== 'lib/client.js').map((t) => '`' + t + '`').join(' ');
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

export { moduleSurface, guardSurface, targetsOf, buildMap, render, familyHelpers };

// 作为脚本直接跑时才输出（被 import 时不得有副作用 —— 守卫要 import 本模块）
const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === new URL('file://' + process.argv[1].replace(/\\/g, '/')).href.replace(/^file:\/\/\//, 'file:///');
if (invokedDirectly) {
  const map = buildMap();
  if (process.argv.includes('--json')) { console.log(JSON.stringify(map, null, 2)); process.exit(0); }
  const md = render(map);
  if (process.argv.includes('--write')) {
    writeFileSync(join(ROOT, 'docs', 'GUARD-MAP.md'), md, 'utf8');
    console.log('已写入 docs/GUARD-MAP.md');
  } else {
    console.log(md);
  }
  const short = (p) => p.replace(/^src\//, '').replace(/^lib\//, 'lib/');
  console.log(`\n[guard-targets] 模块 ${map.modules.length} 个 · 守卫 ${map.rows.length} 个 · 零覆盖 ${map.uncovered.length} 个`);
  if (map.uncovered.length) console.log('  零覆盖：' + map.uncovered.map(short).join(' '));
}
