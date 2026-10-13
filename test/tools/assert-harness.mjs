#!/usr/bin/env node
/**
 * assert-harness.mjs — 大守卫共用的**判据工具**（不是夹具，不是守卫）。
 *
 * 从 `test/verify-scene-live.mjs` / `test/verify-client.mjs` 里逐字提取的行内脚手架。
 * 提取的唯一目的：同一段"取函数体 / 配平大括号 / 计数打点"的实现不在两处各留一份
 * （两处实现就是两处会各自漂的判据面）。**行为必须逐字节不变** —— 每个函数的契约写在
 * 它自己的注释里，改之前先看契约，别顺手"改进"：
 *   · `fnNameBody` 只切到**首个** `\n}`，对"函数头一行早退"的形态会截断 —— 这是既有取舍，
 *     调用方知道并接受（要整段函数体请用 `braceBody`）；
 *   · `braceBody` 会先把源码里的 `\r` 去掉（CRLF 检出下跨行字面量才对得上），返回**不含**
 *     外层花括号的函数体，并显式跳过字符串/模板串/行注释/块注释里的花括号；
 *   · `createCheck()` 的输出逐字节等于原来那两个文件里的 `check`：`'  ✓ ' | '  ✗ '` + name
 *     +（detail 非空时 `' — ' + detail`）；
 *   · `naiveBlockBody` / `naiveFuncSlice` 是**朴素**切片（两个 `indexOf` / 朴素数花括号，不跳
 *     字符串与注释）：把"朴素"与"配平 aware"两种口径各留一个**有名有契约的实现**，守卫里别
 *     再手抄第三种；两种口径不可互换（判据文本会不同 ⇒ 等于改判据）。
 *
 * 提取纪律（DEV-GUIDE §4.7）：迁移**只 import 化**、不重写调用点；迁移前后守卫的 PASS 数
 * 逐字一致（`verify-scene-live` 642 / `verify-client` 自己的计数）。
 */

/**
 * 判据打点器：`const { check, stats } = createCheck();`
 * 输出与计数语义与原文件里的 `check(name, ok, detail)` 完全一致（`ok` 取真值）。
 * 计数读 `stats.passed` / `stats.failed`（原来是两个模块级 `let`）。
 */
export function createCheck() {
  const stats = { passed: 0, failed: 0 };
  function check(name, ok, detail) {
    if (ok) stats.passed++;
    else stats.failed++;
    console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  }
  return { check, stats };
}

/** CRLF 归一：源码是 CRLF 检出时，跨行字面量写 `\n` 会与 `\r\n` 错开 ⇒ 判据恒假。 */
export function normCrlf(s) {
  return String(s).replace(/\r/g, '');
}

/**
 * `function name() { … }` 的函数体源码，取**首个** `\n}` 之前（不含该 `\n}`）。
 * 找不到函数头 ⇒ `''`；找不到 `\n}` ⇒ 切到文件尾。**朴素是契约的一部分**：
 * 对"函数头一行早退"的形态会截在早退块上（要整段用 `braceBody`）。
 */
export function fnNameBody(source, name) {
  const i = source.indexOf('function ' + name + '(');
  if (i < 0) return '';
  const j = source.indexOf('\n}', i);
  return j < 0 ? source.slice(i) : source.slice(i, j);
}

/**
 * 配平大括号取整段函数体（**不含**外层花括号），先做 CRLF 归一。
 * 显式跳过：行注释、块注释、单/双引号串、模板串（`'${…}'`、`"{"` 否则会算错深度）。
 * 找不到函数头 / 开括号 / 未配平 ⇒ `''`。
 */
export function braceBody(source, name) {
  const s = normCrlf(source);
  const start = s.indexOf('function ' + name + '(');
  if (start < 0) return '';
  const open = s.indexOf('{', start);
  if (open < 0) return '';
  let depth = 0, mode = null;
  for (let i = open; i < s.length; i++) {
    const c = s[i], n = s[i + 1];
    if (mode === 'line') { if (c === '\n') mode = null; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = null; i++; } continue; }
    if (mode === 'single') { if (c === '\\') { i++; continue; } if (c === "'") mode = null; continue; }
    if (mode === 'double') { if (c === '\\') { i++; continue; } if (c === '"') mode = null; continue; }
    if (mode === 'tpl') { if (c === '\\') { i++; continue; } if (c === '`') mode = null; continue; }
    if (c === '/' && n === '/') { mode = 'line'; i++; continue; }
    if (c === '/' && n === '*') { mode = 'block'; i++; continue; }
    if (c === "'") { mode = 'single'; continue; }
    if (c === '"') { mode = 'double'; continue; }
    if (c === '`') { mode = 'tpl'; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return s.slice(open + 1, i); }
  }
  return '';
}

/**
 * 朴素块体切片：先找 `needle`，再取它之后**第一个** `{` 与**第一个** `}` 之间的文本。
 * **不跳字符串/注释**（契约就是"两个 indexOf"，不是配平）—— 调用方拿它切的是
 * CSS 规则块这种嵌套浅、无花括号字面量的文本。任一缺失 ⇒ `null`。
 * 要"配平且跳字符串/注释"的版本用 `braceBody`；要"含花括号的配平片段"用 `naiveFuncSlice`。
 */
export function naiveBlockBody(code, needle) {
  const i = code.indexOf(needle);
  if (i < 0) return null;
  const open = code.indexOf('{', i);
  const close = code.indexOf('}', open);
  return open < 0 || close < 0 ? null : code.slice(open + 1, close);
}

/**
 * 朴素"从头配平"切片：找 `function <name>(` 之后第一个 `{`，朴素数花括号到闭合，
 * 返回**含**这对外层花括号的整段。**不跳字符串/注释**（同上：契约就是朴素配平）。
 * 找不到函数头 / 开括号 / 未配平 ⇒ `''`。
 */
export function naiveFuncSlice(text, name) {
  const at = text.indexOf('function ' + name + '(');
  if (at < 0) return '';
  const open = text.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}' && (depth -= 1) === 0) return text.slice(open, i + 1);
  }
  return '';
}
