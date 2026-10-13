/**
 * src-scope.mjs — **构建期内联族**的共享读法（守卫用）。
 *
 * 浏览器半边的模块不是 ESM：`scripts/build-client.mjs` 按 `INLINE_MODULES` 的顺序把各文件
 * **原样内联进同一个工厂作用域**，模块之间不 import、靠扁平符号协作（见 docs/CODE-STRUCTURE.md §3）。
 * 所以"某个符号住在哪个文件"对守卫不是重点，重点是**同族文件按注册顺序拼起来**就是运行时的真实作用域。
 *
 * 单一真源：清单本身从 `scripts/build-client.mjs` 解析（不在这里抄第二份）——
 *   ① 新增模块只登记一次：构建与守卫读法一起跟上；
 *   ② 守卫读到的顺序**就是**构建期内联的顺序（键序、常量可见性都由它决定）。
 *
 * API 冻结（`test/tools/guard-targets.mjs` 按这些名字识别前缀族读法；改签名要先协调 owner）：
 *   · parseInlineModules()      → [{ file, markers }]，顺序 = 构建顺序
 *   · scopeFiles(prefix)        → 路径数组（工作区相对、正斜杠），顺序 = 构建顺序
 *   · scopeText(prefix, sep?)   → 各文件全文按序拼接（默认 '\n;\n'，保持语句边界）
 *   · styleSources()            → 样式族（src/styles*）路径，顺序 = 构建顺序
 *   · styleText(sep?)           → 样式族全文按序拼接
 *   · cssPartsOf(text)          → 文本里全部样式域模板体（源码/产物同形；取不到返回 []）
 *   · cssBodyOf(text)           → 同上拼成一份 CSS；**取不到即抛错**（防"空串 ⇒ 判据恒真"）
 *
 * 空族必须抛错：守卫拿到空集就会"静默全绿"，那正是本仓最不想要的失败形态。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BUILD_SCRIPT = join(ROOT, 'scripts', 'build-client.mjs');

/** 解析 `scripts/build-client.mjs` 的 INLINE_MODULES 清单（顺序即构建期内联顺序）。 */
export function parseInlineModules() {
  const src = readFileSync(BUILD_SCRIPT, 'utf8');
  const at = src.indexOf('const INLINE_MODULES = [');
  if (at < 0) throw new Error('src-scope: scripts/build-client.mjs 里找不到 `const INLINE_MODULES = [`');
  const end = src.indexOf('\n];', at);
  if (end < 0) throw new Error('src-scope: INLINE_MODULES 清单没有收尾 `\\n];`');
  const entries = [];
  for (const chunk of src.slice(at, end).split(/\n {2}\{/).slice(1)) {
    const file = chunk.match(/file:\s*'([^']+)'/);
    if (!file) continue;
    const mk = chunk.match(/markers:\s*\[([\s\S]*?)\]/);
    entries.push({
      file: file[1],
      markers: mk ? [...mk[1].matchAll(/'([^']*)'/g)].map((m) => m[1]) : [],
    });
  }
  if (entries.length === 0) throw new Error('src-scope: INLINE_MODULES 解析出 0 条');
  return entries;
}

/** 同族（路径前缀相同）文件，按 INLINE_MODULES 顺序。前缀命中 0 个文件即抛错（防"空族静默全绿"）。 */
export function scopeFiles(prefix) {
  const files = parseInlineModules().map((e) => e.file).filter((f) => f.startsWith(prefix));
  if (files.length === 0) throw new Error('src-scope: 前缀 ' + prefix + ' 在 INLINE_MODULES 里没有命中任何文件');
  return files;
}

/** 同族文件全文按序拼接（`sep` 默认 '\\n;\\n'：跨文件语句边界，与构建期内联同形）。 */
export function scopeText(prefix, sep = '\n;\n') {
  return scopeFiles(prefix).map((f) => readFileSync(join(ROOT, f), 'utf8')).join(sep);
}

/**
 * 样式族（`src/styles*`：8 个域模块 + 组装点 `src/styles.js`），顺序 = 构建期内联顺序。
 *
 * 为什么需要它：整份样式表原先是**一个** `const CSS = \`…\`` 模板；按视觉域切成 8 个域模块后，
 * "样式表文本"不再是单一文件。守卫要判的仍然是**运行时真实作用域的并集**，于是取文口径从
 * "读一个文件"换成"按构建顺序拼同族文件"——判据本身与强度不变（只有取文来源变了）。
 */
export function styleSources() {
  return scopeFiles('src/styles');
}

/** 样式族源码全文按序拼接（默认分隔符同 scopeText：跨文件语句边界）。 */
export function styleText(sep = '\n;\n') {
  return scopeText('src/styles', sep);
}

/** 样式域模板的声明（源码与产物同形：产物里只是整体多了一层 tab 缩进）。 */
const CSS_DECL_RE = /^[ \t]*const CSS(?:_[A-Z][A-Z0-9_]*)? = `([^`]*)`;/gm;

/**
 * 抽出文本里**全部**样式域模板体（按声明出现顺序）—— 源码与产物都适用。
 *
 * 取不到模板时返回空数组（组装点 `src/styles.js` 本来就没有模板），**不抛错**；
 * 需要"必须取到"的读点请用 `cssBodyOf`。
 */
export function cssPartsOf(text) {
  return [...text.matchAll(CSS_DECL_RE)].map((m) => m[1]);
}

/**
 * 抽出文本里全部样式域模板体并拼成一份 CSS（= 运行时的样式表文本）。
 *
 * ⚠️ **一个模板都取不到时抛错，绝不返回空串**：拆段后守卫若按单个 `const CSS = \`…\`` 取文，
 * 正则抽不到就会拿到 `''`，下游判据于是**静默恒真**（本仓最不想要的失败形态 —— 实测
 * `verify-glass-compositing` / `verify-host-paint-scope` / `verify-glass-surfaces` /
 * `verify-readability` 四个读点都曾是 `match(...) ? … : ''` 形状）。抛错把这条风险结构性堵死。
 */
export function cssBodyOf(text) {
  const parts = cssPartsOf(text);
  if (!parts.length) {
    throw new Error('cssBodyOf: 一个样式域模板都没取到（锚点漂了？—— 这一格曾经会静默返回空串让判据恒真）');
  }
  return parts.join('');
}
