#!/usr/bin/env node
/**
 * branch-notify.mjs —— **分支级**审"改了 store 却没通知"（`verify-client` ①i 复用同一份实现）。
 *
 * 不变量：**每一条从处理器出口离开的执行路径，都必须在该路径最后一次写 store 之后通知过一次。**
 * 为什么需要分支级：处理器级判据（见 `test/verify-client.mjs` ①h）只要体内**某处**能通知就放过，
 * 于是"一个 `if` 的两支里只有一支通知"这种形态它看不见 —— 下面这个形状正是它漏掉的那类：
 *
 *     onOpen: (v) => {
 *       setTransient("fontSetOpen", v === true);   // 无条件写
 *       if (selection.fontSetOpen) busy(refresh()); // 这一支通知（busy 内部 emit）
 *       else disarmConfirm();                       // 这一支不通知 ⇒ 收起时视图不动
 *     }
 *
 * 做法：把处理器体按**缩进**切成顶层语句，遇到 `if/else if/else` 就展开成若干"路径文本"，
 * 逐条路径算"最后一次写"与"最后一次通知"的位置先后。路径数封顶（超过就退化成"整体看一次"并
 * 在输出里标注），免得有病态输入把工具挂住。
 *
 * 已知边界（写在这里，别让读者以为它是穷尽的）：
 *   ① 按**缩进**切语句 ⇒ 依赖本仓的排版风格；压缩成一行的 `if (a) x(); else y();` 会被当**一条**
 *      语句（那时路径不展开，等价于处理器级判据）。
 *   ② 只看"写 store"与"通知"两类动作的**先后**，不看数据流；`try/catch`、`switch`、循环体内部
 *      的分支不作展开（一次线性读）。
 *   ③ "通知"的判定沿用处理器级那条：直接 `emit()` 或调用"能通知的名字"（传递闭包派生）——
 *      闭包按**名字**算，同名不同函数可能互相背书。
 *   ④ 输出是**候选**：要人读（例如"通知在调用点"的形态会被误报）。
 *
 * 用法：`node test/tools/branch-notify.mjs audit`（打印候选）；被 import 时导出 `pathNotifications`、
 * `definitionsOf` 与**定义形态正则 `DEF`**（`verify-client` ①h/①i 共用同一份，避免两处正则分叉）。
 * CLI 的扫描面**派生**自构建脚本的 `INLINE_MODULES`（同 `verify-client` ①h/①i），不手工列文件名。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripComments } from './js-text.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// 扫描面 = 与 `verify-client` ①h/①i **同源**：正文 + 构建脚本的 INLINE_MODULES。
// 手工清单会只审 2 个模块，人手跑 `audit` 时把其余模块的候选漏掉（判据本体用的一直是全量扫描面，
// 所以差异只影响**人读工具**的覆盖面）。
const inlineModuleFiles = () => [...readFileSync(join(ROOT, 'scripts', 'build-client.mjs'), 'utf8')
  .matchAll(/file:\s*'([^']+)'/g)].map((m) => m[1]);
const FILES = [...new Set(['src/client.js', ...inlineModuleFiles()])];
const NOTIFY_HELPERS = ['busy', 'done', 'armConfirm', 'disarmConfirm'];
const WRITES = /(?:setTransient\(|setSetting\(|setFontValues\(|(?<![\w.$])selection\.[\w$]+\s*=(?!=))/;
/**
 * 定义形态。`verify-client` ①h/①i 共用**这一份**：形态只许定义一次，两处各抄一份会在补齐时静默分叉。
 * 覆盖本仓真实用到的全部形态：`async function name(` / `function name(` / `const name = (…) =>` /
 * `onXxx:` 条目 / `const|let|var name = (…) {` / `onXxx(…) {` 方法简写。
 * ⚠️ 少认一种形态 = 那批处理器在**处理器级**与**分支级**两条判据里一起静默隐身
 *（实测 `async function` 形态最容易漏：`src/client.js:1602 changeUploadDir`、`:1633 changeCacheDir`、
 * `:1671 changeWeAssetsDir` 三个都必须被扫到）。
 */
export const DEF = /^(\s*)(?:async\s+function\s+([\w$]+)\s*\(|function\s+([\w$]+)\s*\(|const\s+([\w$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>|(on[A-Z][\w$]*)\s*:|(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:function\s*)?\([^)]*\)\s*(?:=>|\{)|((?:on[A-Z]|set[A-Z]|change[A-Z]|toggle[A-Z])[\w$]*)\s*\([^)]*\)\s*\{)/;
/** 取定义名：七个可选组里第一个命中的。 */
export const defName = (m) => m[2] || m[3] || m[4] || m[5] || m[6] || m[7];
const MAX_PATHS = 64;

const indentOf = (l) => (l.match(/^\s*/)[0] || '').length;
const callsAny = (text, names) => [...names].some((n) => new RegExp('(?:^|[^\\w$.])' + n + '\\s*\\(').test(text));

/** 定义（函数 / 箭头常量 / `onXxx:` 条目）→ { name, line, lines }；单行定义**就地**收尾。 */
export function definitionsOf(text) {
  const ls = stripComments(String(text)).split('\n');
  const out = [];
  ls.forEach((l, i) => {
    const m = DEF.exec(l);
    if (!m) return;
    const name = defName(m);
    const opens = (l.match(/\{/g) || []).length;
    const closes = (l.match(/\}/g) || []).length;
    if (opens === 0 || opens === closes) { out.push({ name, line: i + 1, lines: [l] }); return; }
    const indent = m[1].length;
    let end = ls.length;
    for (let k = i + 1; k < ls.length; k++) {
      if (ls[k].trim() === '') continue;
      const ind = indentOf(ls[k]);
      if (ind < indent) { end = k; break; }
      if (/^\s*\}/.test(ls[k]) && ind === indent) { end = k + 1; break; }
    }
    out.push({ name, line: i + 1, lines: ls.slice(i, end) });
  });
  return out;
}

/** "能通知的名字"：种子 = `emit` + NOTIFY_HELPERS，再按"体内调用了闭包名字"求传递闭包。 */
export function notifyingNames(defs) {
  const names = new Set(['emit', ...NOTIFY_HELPERS]);
  for (let pass = 0; pass < 8; pass++) {
    for (const d of defs) if (!names.has(d.name) && callsAny(d.lines.join('\n'), names)) names.add(d.name);
  }
  return names;
}

/** 把一段语句行切成顶层语句（每项是行数组）——按**花括号配平**切，`} else {` 不另起一条。 */
function splitStatements(lines, baseIndent) {
  const out = [];
  let cur = [];
  let depth = 0;
  for (const l of lines) {
    if (l.trim() === '') { if (cur.length) cur.push(l); continue; }
    const startsNew = cur.length > 0 && depth === 0 && indentOf(l) <= baseIndent
      && !/^\s*(?:else\b|\}|\))/.test(l);
    if (startsNew) { out.push(cur); cur = []; }
    cur.push(l);
    depth += (l.match(/\{/g) || []).length - (l.match(/\}/g) || []).length;
    if (depth < 0) depth = 0;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** 一条 `if` 语句 → 各分支的文本数组（`else if` 递归展开；没有 else 时只有 then）。 */
function branchesOf(stmt) {
  const first = stmt[0];
  const headIndent = indentOf(first);
  if (first.indexOf('{') < 0) {
    // 无花括号的头部：then = 该行 `)` 之后的部分；后面的 `else …`（若在）是另一支
    const close = first.indexOf(')');
    const thenText = first.slice(close + 1);
    const rest = stmt.slice(1);
    if (!rest.length) return [thenText];
    const firstElse = rest.findIndex((l) => /^\s*\}?\s*else\b/.test(l));
    if (firstElse < 0) return [[firstText(first), ...rest].join('\n')];
    const elseLines = rest.slice(firstElse).map((l, i) => (i === 0 ? l.replace(/^\s*\}?\s*else\s*/, '') : l));
    if (/^\s*\}?\s*else\s+if\b/.test(rest[firstElse])) return [thenText, ...branchesOf(elseLines)];
    return [thenText, elseLines.join('\n')];
  }
  // then = 从 `{` 到同缩进的 `}`
  let end = stmt.length - 1;
  for (let k = 1; k < stmt.length; k++) {
    if (/^\s*\}/.test(stmt[k]) && indentOf(stmt[k]) === headIndent) { end = k; break; }
  }
  const thenLines = stmt.slice(0, end + 1);
  const rest = stmt.slice(end + 1);
  const closeLine = stmt[end] || '';
  const elseOnClose = /\}\s*else\b/.test(closeLine);
  if (!elseOnClose && !(rest[0] && /^\s*\}?\s*else\b/.test(rest[0]))) return [thenLines.join('\n')];
  const elseLines = elseOnClose ? rest : rest.slice(1);
  const elseFirst = elseOnClose ? closeLine.slice(closeLine.indexOf('else')) : rest[0];
  if (/^\s*\}?\s*else\s+if\b/.test(elseFirst)) return [thenLines.join('\n'), ...branchesOf(elseLines)];
  return [thenLines.join('\n'), elseLines.join('\n')];
}
/** 无花括号头部的 then 文本（把 `if (…)` 前缀去掉后原样保留）。 */
function firstText(line) {
  const close = line.indexOf(')');
  return line.slice(0, close + 1);
}

const isIf = (stmt) => /^\s*\}?\s*if\s*\(/.test(stmt[0]);

/**
 * 判据：返回"某条路径在最后一次写 store 之后没有通知"的候选（`名字@L行: 说明`）。
 * 正/负对照共用它。
 */
export function pathNotifications(text, defsOverride) {
  const defs = defsOverride || definitionsOf(text);
  const names = notifyingNames(defs);
  const flags = [];
  for (const d of defs) {
    if (!/^(?:on[A-Z]|set[A-Z]|change[A-Z]|toggle[A-Z])/.test(d.name)) continue;
    const body = d.lines.slice(1);
    const inner = body.filter((l) => l.trim() !== '' && !/^\s*\}/.test(l));
    if (!inner.length) continue;
    const baseIndent = indentOf(inner[0]);
    const stmts = splitStatements(body, baseIndent);
    if (!stmts.some((s) => WRITES.test(s.join('\n')))) continue; // 不写 store 的处理器不归这条
    let paths = [''];
    let capped = false;
    for (const s of stmts) {
      const piece = isIf(s) ? branchesOf(s) : [s.join('\n')];
      const next = [];
      for (const p of paths) for (const b of piece) next.push(p + '\n' + b);
      if (next.length > 8 && paths.length * piece.length > MAX_PATHS) { capped = true; }
      paths = next.slice(0, MAX_PATHS);
    }
    for (const p of paths) {
      const w = p.search(WRITES);
      if (w < 0) continue; // 这条路径不写 store
      let lastWrite = -1;
      const wr = new RegExp(WRITES.source, 'g');
      for (let m = wr.exec(p); m; m = wr.exec(p)) lastWrite = m.index;
      let lastNotify = -1;
      for (const n of names) {
        const re = new RegExp('(?:^|[^\\w$.])' + n + '\\s*\\(', 'g');
        for (let m = re.exec(p); m; m = re.exec(p)) lastNotify = Math.max(lastNotify, m.index);
      }
      if (!(lastNotify > lastWrite)) {
        flags.push(d.name + '@L' + d.line + (capped ? '（路径数触顶）' : ''));
        break; // 一个处理器只报一次
      }
    }
  }
  return flags;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cmd = process.argv[2];
  if (cmd !== 'audit') {
    console.error('用法：node test/tools/branch-notify.mjs audit');
    process.exit(1);
  }
  let total = 0;
  for (const rel of FILES) {
    const text = readFileSync(join(ROOT, rel), 'utf8');
    const flags = pathNotifications(text);
    for (const f of flags) console.log(rel + '  ' + f);
    total += flags.length;
  }
  console.log('\n分支级候选合计 ' + total + ' 处（人读定性）');
}
