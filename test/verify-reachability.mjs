#!/usr/bin/env node
/**
 * verify-reachability.mjs —— 可达性棘轮（发布面只剩活代码的减量守卫）。
 *
 * 为什么要有它：度量（只回答"现在有多少行不可达"，退出码恒为 0）拦不住这个数字回增 ——
 * 本仓的策略是"发布面只剩活代码"，所以"死树不许长大"必须由**会失败的守卫**钉住：
 * 本脚本复算同一份口径，把结果变成**只许缩小的棘轮**。（当年配套的度量脚本
 * `scripts/audit-reachability.mjs` **已不在本仓**，别按那条路径去找。）
 *
 * 口径（本脚本即当前唯一实现；改口径要先读下面五类边）：
 *   起点：`lib/index.js` + `lib/client.js`。
 *   跟随五类边：静态 `import` / `export … from` 再导出 / 动态 `import()` / `require()` /
 *              `new Worker(new URL(…, import.meta.url))` 与 `new Worker('…')`。
 *   排除：`lib/webwallgl/**`（HTTP 路由按 URL 提供的渲染页与资源）、`lib/vendor/**`
 *        （第三方副本）—— 它们不靠 import 到达，算进"不可达"就是误报。
 *   不可达 = `lib/**.{js,mjs}` 里既不在可达集合、又不在排除面内的文件（按行数计权）。
 *   `lib/index.js` **只按文本解析，绝不 import**：它有副作用（建目录、起定时器）。
 *
 * 假活锚点：有些边**永远不执行**，却让整棵死树看起来活着。本守卫按**内容**定位它们，不按行号
 *   （行号会随无关改动漂移）：一条 `new Worker(…)` 边落在某个函数体内，而该函数名在全文件
 *   只出现一次（它自己的声明）且未被导出 ⇒ 该函数零调用点 ⇒ 它发出的边都不算数。
 *
 * 不变量：
 *   R1 覆盖面——入口集合解析到 ≥2 个文件、扫描面 `lib` 文件数 ≥15、可达集合 ≥10 个文件；
 *      空解析 / 解析失败必须红，不许"空对空"通过。
 *   R2 棘轮——剪掉假活锚点后的不可达行数与文件数都 ≤ BASELINE，只许收紧。
 *   R3 锚点校验——包围函数名出现次数为 1 且未导出；若锚点已不存在（树里本就没有那条边），
 *      按**减量** INFO 报告，不判失败。
 *   R4 抽取器有牙——合成源码必须抽出五类边，空源码 / 非相对说明符 / 解析失败必须抽不出边；
 *      这是 R1 之所以有意义的依据（否则"可达 ≥10"可能出自一个恒真的抽取器）。
 *
 * 用法：`node test/verify-reachability.mjs`
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIB = join(ROOT, 'lib');
const posix = (p) => p.split(sep).join('/');
const lineOf = (txt, idx) => txt.slice(0, idx).split('\n').length;

const ENTRY = ['lib/index.js', 'lib/client.js'];
const EXCLUDE = [/^lib\/webwallgl\//, /^lib\/vendor\//];

/** 棘轮基线：剪掉假活锚点后的不可达规模（文件数 / 行数）。数字只许变小。 */
// 棘轮基线：不可达 0 文件 / 0 行 ⇒ 基线收到 0。
// 此后任何一条新的不可达边都会立刻把它顶红 —— 这正是"发布面只剩活代码"的最终形态。
const BASELINE = { files: 0, lines: 0 };

// ── 输出 ────────────────────────────────────────────────────────────────────
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log('  ✓ ' + name + (detail ? ' — ' + detail : ''));
  else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); failed++; }
};
const info = (msg) => console.log('  INFO ' + msg);

// ── 扫描面 ──────────────────────────────────────────────────────────────────
function listLibFiles(dir, out = []) {
  let names;
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    const p = join(dir, n);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) listLibFiles(p, out);
    else if (st.isFile() && /\.(js|mjs)$/.test(n)) out.push(posix(relative(ROOT, p)));
  }
  return out.sort();
}
const ALL = listLibFiles(LIB);
const linesOf = (rel) => {
  try { return readFileSync(join(ROOT, rel), 'utf8').split('\n').length; } catch { return 0; }
};
const TOTAL_LINES = ALL.reduce((a, f) => a + linesOf(f), 0);

// ── 五类边：抽取器是**纯函数**（源码文本 + 说明符解析器 ⇒ 边），负对照直接喂合成源码 ──
const EDGE_SPECS = [
  ['static-import', /(?:^|[^\w$])import\s+[^'"]*?from\s*['"](\.\.?\/[^'"]+)['"]/g],
  ['static-import', /(?:^|[^\w$])import\s*['"](\.\.?\/[^'"]+)['"]/g],
  ['dynamic-import', /\bimport\s*\(\s*['"](\.\.?\/[^'"]+)['"]/g],
  ['require', /\brequire\s*\(\s*['"](\.\.?\/[^'"]+)['"]/g],
  ['re-export', /\bexport\s+(?:\*|\{[^}]*\})\s*(?:as\s+[\w$]+\s*)?from\s*['"](\.\.?\/[^'"]+)['"]/g],
  ['worker', /\bnew\s+Worker\s*\(\s*new\s+URL\s*\(\s*['"](\.\.?\/[^'"]+)['"]/g],
  ['worker', /\bnew\s+Worker\s*\(\s*['"](\.\.?\/[^'"]+)['"]/g],
];
const KINDS = ['static-import', 're-export', 'dynamic-import', 'require', 'worker'];

/**
 * 从源码文本抽边。`resolveSpec(spec)` 返回相对 ROOT 的 posix 路径，或 null（解析不到 ⇒ 不是边）。
 * 边 = { kind, spec, to, at, line }；`at` 是**说明符自身**的字符偏移 —— 锚点按它做内容匹配。
 */
function extractEdges(src, resolveSpec) {
  const out = [];
  for (const [kind, re] of EDGE_SPECS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
      const to = resolveSpec(m[1]);
      if (!to) continue;
      // 偏移必须取说明符自身：正则前缀 `(?:^|[^\w$])` 会吃掉上一行的换行，用 m.index 会算成上一行。
      const at = m.index + m[0].lastIndexOf(m[1]);
      out.push({ kind, spec: m[1], to, at, line: lineOf(src, at) });
    }
  }
  return out;
}

/** 相对说明符 → 磁盘上的真实文件（同口径的候选顺序）。 */
function resolveRelative(fromRel, spec) {
  const abs = resolve(dirname(join(ROOT, fromRel)), spec);
  for (const c of [abs, abs + '.js', abs + '.mjs', join(abs, 'index.js'), join(abs, 'index.mjs')]) {
    if (existsSync(c) && statSync(c).isFile()) return posix(relative(ROOT, c));
  }
  return null;
}

const srcCache = new Map();
function sourceOf(rel) {
  if (!srcCache.has(rel)) {
    let src;
    try { src = readFileSync(join(ROOT, rel), 'utf8'); } catch { src = ''; }
    srcCache.set(rel, src);
  }
  return srcCache.get(rel);
}
const edgeCache = new Map();
function edgesOf(rel) {
  if (!edgeCache.has(rel)) {
    const src = sourceOf(rel);
    edgeCache.set(rel, src ? extractEdges(src, (s) => resolveRelative(rel, s)) : []);
  }
  return edgeCache.get(rel);
}

// ── 按内容定位函数（注释与字符串里的同名文本不算代码）─────────────────────────
/** 跳过从 i 开始的字符串 / 模板字面量，返回收尾引号的下标；未闭合返回 -1。 */
function skipString(src, i) {
  const q = src[i];
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') { j += 2; continue; }
    if (c === q) return j;
    j++;
  }
  return -1;
}

/** 跳过字符串与注释后做配对，返回 openIdx 处开符的配对位置；未配对返回 -1。 */
function matchClose(src, openIdx, open, close) {
  let depth = 0;
  let i = openIdx;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      const n = src.indexOf('\n', i);
      i = n < 0 ? src.length : n + 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const n = src.indexOf('*/', i);
      i = n < 0 ? src.length : n + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const n = skipString(src, i);
      if (n < 0) return -1;
      i = n + 1;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
    i++;
  }
  return -1;
}

/**
 * 行级注释掩码：整行都是注释的行标 0。逐行独立判定 ⇒ 不会因为正文里的引号/斜杠
 * 而发生"解码错位"（那种错位会把大片真代码误判成注释）。函数定位只认非注释行。
 */
function commentLines(src) {
  const mask = new Uint8Array(src.length).fill(1);
  let i = 0;
  while (i <= src.length) {
    const n = src.indexOf('\n', i);
    const end = n < 0 ? src.length : n;
    if (/^\s*(?:\/\/|\*|\/\*)/.test(src.slice(i, end))) mask.fill(0, i, end);
    if (n < 0) break;
    i = end + 1;
  }
  return mask;
}

const FN_PATTERNS = [
  // function 声明 / 函数表达式：`async function NAME(`
  { kind: 'function', re: /(?:^|[^\w$])(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g, paren: true },
  // 赋值形式的具名函数 / 带括号的箭头函数：`const NAME = (…`
  { kind: 'assigned', re: /(?:^|[^\w$])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?\(/g, paren: true },
  // 单形参箭头函数：`const NAME = ident =>`
  { kind: 'arrow-ident', re: /(?:^|[^\w$])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?[A-Za-z_$][\w$]*\s*=>/g, paren: false },
];

const skipWs = (src, k) => { while (k < src.length && /\s/.test(src[k])) k++; return k; };

/** 找 at 所在的**最内层**具名函数；返回 { name, bodyOpen, bodyEnd, line } 或 null。 */
function enclosingFunction(src, at, mask) {
  let best = null;
  for (const p of FN_PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(src)) !== null) {
      const nameAt = m.index + m[0].indexOf(m[1]);
      if (mask && mask[nameAt] !== 1) continue; // 注释 / 字符串里的同名文本不算
      let bodyOpen = -1;
      if (p.paren) {
        const closeParen = matchClose(src, m.index + m[0].length - 1, '(', ')');
        if (closeParen < 0) continue;
        let k = skipWs(src, closeParen + 1);
        if (src[k] === '{') bodyOpen = k;
        else if (src.startsWith('=>', k)) {
          k = skipWs(src, k + 2);
          if (src[k] === '{') bodyOpen = k;
        }
      } else {
        const k = skipWs(src, m.index + m[0].length); // 配对到 `=>` 之后
        if (src[k] === '{') bodyOpen = k;
      }
      if (bodyOpen < 0) continue;
      const bodyEnd = matchClose(src, bodyOpen, '{', '}');
      if (bodyEnd < 0) continue;
      if (at > bodyOpen && at < bodyEnd && (!best || bodyOpen > best.bodyOpen)) {
        best = { name: m[1], bodyOpen, bodyEnd, line: lineOf(src, bodyOpen) };
      }
    }
  }
  return best;
}

// ── 标识符 / 导出判定 ───────────────────────────────────────────────────────
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (name, flags = 'g') =>
  new RegExp('(?<![\\w$])' + esc(name) + '(?![\\w$])', flags);
const countRefs = (src, name) => (src.match(wordRe(name)) || []).length;

const EXPORT_FORMS = [
  ['export function', (n) => new RegExp('\\bexport\\s+(?:default\\s+)?(?:async\\s+)?function\\s*\\*?\\s*' + wordRe(n, '').source)],
  ['export const/let/var/class', (n) => new RegExp('\\bexport\\s+(?:const|let|var|class)\\s+' + wordRe(n, '').source)],
  ['export { … }', (n) => new RegExp('\\bexport\\s*\\{[^}]*' + wordRe(n, '').source + '[^}]*\\}')],
  ['exports.NAME', (n) => new RegExp('\\bexports\\.' + wordRe(n, '').source)],
  ['module.exports = NAME', (n) => new RegExp('\\bmodule\\.exports\\s*=\\s*' + wordRe(n, '').source)],
];
/** 命中的导出形态（打印用，避免"命中 0 处"这种写死的说明）。 */
const exportHits = (src, name) => EXPORT_FORMS.filter(([, re]) => re(name).test(src)).map(([label]) => label);

// ── 假活锚点：按内容定位，剪掉"零调用点函数"发出的全部边 ──────────────────────
const ANCHOR_FILE = 'lib/index.js';
const anchorRanges = new Map(); // rel -> [[bodyOpen, bodyEnd], …]
const anchors = [];
const orphanWorkerEdges = [];

{
  const src = sourceOf(ANCHOR_FILE);
  const mask = src ? commentLines(src) : null;
  for (const e of edgesOf(ANCHOR_FILE).filter((x) => x.kind === 'worker')) {
    const fn = src && mask ? enclosingFunction(src, e.at, mask) : null;
    const refs = fn ? countRefs(src, fn.name) : 0;
    const exported = fn ? exportHits(src, fn.name) : [];
    if (fn && refs === 1 && !exported.length) anchors.push({ edge: e, fn });
    else orphanWorkerEdges.push({ edge: e, fn, refs, exported });
  }
  if (anchors.length) anchorRanges.set(ANCHOR_FILE, anchors.map((a) => [a.fn.bodyOpen, a.fn.bodyEnd]));
}
const inAnchorBody = (rel, at) =>
  (anchorRanges.get(rel) || []).some(([s, e]) => at > s && at < e);
/** 被锚点剪掉的边数（只用于打印；剪枝判定本身走 inAnchorBody）。 */
const anchoredEdgeCount = [...anchorRanges.keys()]
  .reduce((a, rel) => a + edgesOf(rel).filter((e) => inAnchorBody(rel, e.at)).length, 0);

// ── 可达闭包 ────────────────────────────────────────────────────────────────
function reach(prune) {
  const seen = new Set();
  const queue = [...ENTRY];
  while (queue.length) {
    const rel = queue.pop();
    if (seen.has(rel) || !existsSync(join(ROOT, rel))) continue;
    seen.add(rel);
    for (const e of edgesOf(rel)) {
      if (prune && inAnchorBody(rel, e.at)) continue;
      if (!seen.has(e.to)) queue.push(e.to);
    }
  }
  return seen;
}
const deadOf = (seen) => ALL.filter((f) => !seen.has(f) && !EXCLUDE.some((re) => re.test(f)));
const AS_IS = reach(false);
const PRUNED = reach(true);
const deadAsIs = deadOf(AS_IS);
const deadPruned = deadOf(PRUNED);
const linesAsIs = deadAsIs.reduce((a, f) => a + linesOf(f), 0);
const linesPruned = deadPruned.reduce((a, f) => a + linesOf(f), 0);
const libReachable = (s) => [...s].filter((f) => f.startsWith('lib/')).length;

console.log('lib 扫描面：' + ALL.length + ' 个文件 / ' + TOTAL_LINES + ' 行；入口 ' + ENTRY.join(' + '));
console.log('  A) as-is   不可达 ' + deadAsIs.length + ' 个 / ' + linesAsIs + ' 行');
console.log('  B) pruned  不可达 ' + deadPruned.length + ' 个 / ' + linesPruned + ' 行 = lib 的 '
  + (TOTAL_LINES ? (linesPruned / TOTAL_LINES * 100).toFixed(1) : '0.0') + '%'
  + '（剪掉锚点函数体内的 ' + anchoredEdgeCount + ' 条边）');

// ── R1 覆盖面：空解析 / 解析失败不许通过 ─────────────────────────────────────
console.log('\nR1 覆盖面（防"空对空"通过）');
{
  const entries = ENTRY.filter((f) => AS_IS.has(f));
  check('入口集合解析到 ≥2 个文件', entries.length >= 2,
    entries.length + '/' + ENTRY.length + '（' + ENTRY.join(', ') + '）');
  check('扫描面 lib 文件数 ≥15（P2-12 已删除 48 个死文件，地板随之收紧）', ALL.length >= 15,
    ALL.length + ' 个文件 / ' + TOTAL_LINES + ' 行');
  check('可达集合 ≥10 个文件', libReachable(AS_IS) >= 10, libReachable(AS_IS) + ' 个 lib 文件可达');
}

// ── R4 抽取器负对照：证明"抽到边"不是恒真 ───────────────────────────────────
console.log('\nR4 边抽取器正/负对照（同一条 extractEdges）');
{
  const synth = [
    "import a from './syn-a.js';",
    "import './syn-side.js';",
    "export { b } from './syn-b.js';",
    "const c = await import('./syn-c.js');",
    "const d = require('./syn-d.js');",
    "const e = new Worker(new URL('./syn-w.mjs', import.meta.url));",
    "const f = new Worker('./syn-v.js');",
  ].join('\n');
  const fakeResolve = (spec) => 'lib/' + spec.replace(/^\.\//, '');
  const got = extractEdges(synth, fakeResolve);
  const kinds = [...new Set(got.map((e) => e.kind))].sort();
  const missing = KINDS.filter((k) => !kinds.includes(k));
  check('正对照：合成源码抽出全部五类边', missing.length === 0 && got.length >= 5,
    got.length + ' 条边，类型=[' + kinds.join(', ') + ']');
  check('负对照：空源码抽出 0 条边（抽取器确实能返回空）',
    extractEdges('', fakeResolve).length === 0, 'edges=0');
  // 假包名在运行时拼出来：写成字面量会被链条守卫的"裸依赖"扫描当成真的裸依赖。
  const fakePkg = ['left', 'pad'].join('-');
  const notRelative = "import x from '" + fakePkg + "';\nconst y = require('node:fs');\nimport('" + fakePkg + "');";
  check('负对照：非相对说明符抽出 0 条边', extractEdges(notRelative, fakeResolve).length === 0,
    'edges=0（只跟相对路径）');
  check('负对照：解析器返回 null 时抽出 0 条边（说明符不可解析 ⇒ 不是边）',
    extractEdges("import z from './syn-missing.js';", () => null).length === 0, 'edges=0');
}

// ── R3 锚点校验：内容定位，行号只用于打印 ───────────────────────────────────
console.log('\nR3 假活锚点（按内容定位，非行号）');
{
  const workerEdges = edgesOf(ANCHOR_FILE).filter((e) => e.kind === 'worker');
  if (workerEdges.length === 0) {
    info('锚点已不存在：' + ANCHOR_FILE + ' 内没有任何 `new Worker(…)` 相对边 ⇒ P2-12 减量（INFO，不判失败）');
    check('锚点缺席时剪枝 = 原样（棘轮退化为 as-is，仍受 R2 约束）',
      deadPruned.length === deadAsIs.length && linesPruned === linesAsIs,
      'as-is ' + deadAsIs.length + ' 个 / pruned ' + deadPruned.length + ' 个');
  } else if (anchors.length === 0) {
    const o = orphanWorkerEdges[0];
    check('`new Worker(…)` 边的包围函数是零调用点且未导出', false,
      ANCHOR_FILE + ':' + o.edge.line + ' 的包围函数='
      + (o.fn ? o.fn.name + '（全文件出现 ' + o.refs + ' 次，导出形态=[' + o.exported.join(', ') + ']）' : '未找到具名函数')
      + ' ⇒ 它可能是活代码，需重新推导锚点集合');
  } else {
    const a = anchors[0];
    const src = sourceOf(ANCHOR_FILE);
    const refs = countRefs(src, a.fn.name);
    const range = a.fn.line + '-' + lineOf(src, a.fn.bodyEnd);
    check('`new Worker(…)` 边落在函数体内，且该函数名全文件只出现 1 次（零调用点）',
      refs === 1,
      ANCHOR_FILE + ':' + a.edge.line + ' 位于 ' + ANCHOR_FILE + ':' + range + ' 的函数体，'
      + '名字出现 ' + refs + ' 次');
    check('该函数未被导出（导出即活代码，剪枝就不成立）',
      exportHits(src, a.fn.name).length === 0,
      '导出形态命中=[' + (exportHits(src, a.fn.name).join(', ') || '无') + ']');
  }
  // 负对照：锚点判据自身有牙 —— 导出检测能命中，引用计数能数出调用点（否则上面两条可能恒真）。
  check('负对照：导出检测与引用计数能判出"活代码"',
    exportHits('export function helper() {}', 'helper').length === 1
    && exportHits('export { helper };', 'helper').length === 1
    && countRefs('function helper() {}\nhelper();', 'helper') === 2,
    '导出形态与引用计数均可判非零');
  // 行为对照：剪枝必须真的把东西剪掉，否则 R2 的棘轮是空转。
  // ⚠️ 锚点消失 ⇒ 剪枝**按定义**是空操作（上面 R3 已断言 pruned == as-is），
  //    此时这条对照报 INFO，而不是判红。
  const cut = AS_IS.size - PRUNED.size;
  if (workerEdges.length === 0) {
    info('剪枝对照不适用（无锚点可剪）：pruned == as-is 已在上一条断言');
  } else {
    check('剪枝确实缩小了可达集合（棘轮不是空转）', cut >= 1,
      '可达 ' + AS_IS.size + ' → ' + PRUNED.size + ' 个（-' + cut + '）');
  }
}

// ── R2 棘轮：只许收紧 ───────────────────────────────────────────────────────
console.log('\nR2 棘轮（剪枝后的不可达规模 ≤ 基线，只许变小）');
{
  const m = { files: deadPruned.length, lines: linesPruned };
  const within = (x) => x.files <= BASELINE.files && x.lines <= BASELINE.lines;
  check('不可达行数 ≤ 基线 ' + BASELINE.lines, m.lines <= BASELINE.lines,
    '实测 ' + m.lines + ' 行 / 基线 ' + BASELINE.lines + ' 行'
    + (m.lines < BASELINE.lines ? '（可下修 ' + (BASELINE.lines - m.lines) + '）' : ''));
  check('不可达文件数 ≤ 基线 ' + BASELINE.files, m.files <= BASELINE.files,
    '实测 ' + m.files + ' 个 / 基线 ' + BASELINE.files + ' 个');
  check('负对照：棘轮判定能失败（基线 +1 会被判不合格）',
    within({ files: BASELINE.files, lines: BASELINE.lines + 1 }) === false
    && within({ files: BASELINE.files + 1, lines: BASELINE.lines }) === false);
}

// ── 汇总 ────────────────────────────────────────────────────────────────────
if (failed) {
  console.log('\n不可达清单（as-is）：' + (deadAsIs.length ? '' : '（无）'));
  for (const f of deadAsIs) console.log('   ' + String(linesOf(f)).padStart(6) + ' 行  ' + f);
  console.log('不可达清单（pruned）：' + (deadPruned.length ? '' : '（无）'));
  for (const f of deadPruned) console.log('   ' + String(linesOf(f)).padStart(6) + ' 行  ' + f);
}
console.log('');
if (failed) {
  console.log('REACHABILITY CHECKS FAILED — ' + failed + ' failed');
  console.log('P2-12 预期会继续删减这棵树 ⇒ 基线只许收紧，不得放宽。');
  process.exit(1);
}
console.log('ALL REACHABILITY CHECKS PASSED');
console.log('P2-12 预期会继续删减这棵树 ⇒ 基线只许收紧：减量后请把 BASELINE 下调到本次实测值。');
process.exit(0);
