#!/usr/bin/env node
/**
 * js-text.mjs — JS/TS 源码的**文本级**工具（守卫读源码时用）。
 *
 * 入口清单见文件末 `export`（`stripComments` / `blankStringLiterals` / `moduleScopeOf` / `functionBodyOf` /
 * `stripExportBlocks` / `splitLinesSafe` / `selftest`）。前三个：`stripComments(src)`（把注释换成等长空格）、
 * `moduleScopeOf(src)`
 * （取出**模块作用域**文本 —— 顶层、任何 `{ … }` 体之外的片段；环的求值期纪律类判据用它）
 * 与 `functionBodyOf(src, header)`（取出某个 `{ … }` 体的原文；`verify-logging` / `verify-types`
 * 的函数体判据用它）。三者共用同一套字符扫描器（注释/字符串/模板/**正则字面量** + 花括号配对）。
 *
 * ── 为什么不许用朴素正则 ─────────────────────────────────────────────────────
 * 朴素写法（块注释正则 + 行注释正则）**不认字符串与行注释**：
 * 只要注释或字符串里出现"块注释起始"那两个字符（把 `scripts/**`、`test/**`、`docs/*.md`
 * 写进一句行注释就够了），它就会从那里**开一个块注释**，一路吃到下一个结束标记 ——
 * 把中间的真实代码**静默删掉**。那些判据因此**看不见**这段代码，却照样报绿 —— 静默失效，
 * 正是本仓最不想要的失败形态。代价的量级：本仓实测单文件最长一段被吃掉 **331 行**
 * （`test/tools/audit-guard-teeth.mjs` 判据 F 拿这个当反面参照，逐文件报"换回朴素剥法会丢多少内容"）。
 *
 * ── 这个实现的性质 ───────────────────────────────────────────────────────────
 *   · **字符串感知**：`'…'` / `"…"` / 模板字面量里的 `//`、`/*` 都不算注释（`https://x` 因此
 *     不再被当成注释；模板里的 `/*` 也不再开块注释）。
 *   · **等长 + 保留换行**：删掉的注释按字符数换成空格、换行原样留 ⇒ 行号与列偏移不变
 *     （按列定位的消费者，如 `test/tools/host-route-index.mjs`，依赖这一点）。
 *   · **正则字面量按启发式识别**：上一个有意义字符是运算符/分隔符（`=` `(` `,` `:` `[` `!` `&` `|`
 *     `?` `{` `}` `;` `+` `-` `*` `%` `<` `>` `~` `^`）时，`/` 视为正则字面量的开始，整段跳到收尾的
 *     `/`（认 `\` 转义与 `[…]` 字符类）。**这一步必需**：正则里可以出现 `\/\/`、`[/*]` 这类内容，
 *     不跳过就会被当成注释吃掉 —— 以 `\//` 收尾的正则会让**该行后半段静默变成空格**
 *     （本仓 4 个文件里都有这种写法）。
 *     边界：`return /re/` 这类"上一个字符是字母"的位置按除号处理 ⇒ 代价只是**不跳**该正则（最多
 *     一行内少剥），不会多吃；正则若在行内未闭合则收手，**绝不跨行吞**。
 *   · **模板的 `${…}` 内部不另做词法**：整段按字符串处理 ⇒ 插值里的注释不会被剥掉。
 *     方向是安全的（宁可少剥，不可多吃）：少剥最多让某条判据**变红**（响亮），多吃是静默失效。
 *
 * ── 为什么不给 CSS 用 ───────────────────────────────────────────────────────
 * CSS 的注释语法只有块注释一种（没有 `//`），且 `url(...)`、转义与字符串规则与 JS 不同 ⇒
 * 套 JS 词法会误删 `url(//host/x)` 这类内容。CSS 侧继续用自己的、只剥块注释的实现。
 *
 * 自检：`node test/tools/js-text.mjs selftest`（正/负对照成对，含"朴素实现会吃掉真代码"的
 * **反面参照** ⇒ 修法与缺陷在同一处对照）。
 */
import { pathToFileURL } from 'node:url';

const isSpace = (ch) => ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n';

/**
 * 把 JS 源码里的注释替换成等长空格（换行保留）。
 * 字符串与模板字面量里的注释标记**不**算注释。
 */
function stripComments(src) {
  const text = String(src);
  const n = text.length;
  const out = [];
  /** 注释字符 → 空格；换行原样保留（保证行号/列偏移不变）。 */
  const blank = (ch) => out.push(ch === '\n' ? '\n' : ' ');
  /** 上一个**有意义**字符（注释与空白之外）—— 用来粗判 `/` 是除号还是正则字面量的开始。 */
  let prev = '';
  const isValueEnd = (ch) => ch !== '' && /[\w$)\]}'"`]/.test(ch);
  let i = 0;
  while (i < n) {
    const c = text[i];
    const c2 = text[i + 1];
    // 行注释：// … 到行尾（`//` 在 JS 里总是注释，先判它，避免与正则字面量混淆）
    if (c === '/' && c2 === '/') {
      while (i < n && text[i] !== '\n') { blank(text[i]); i++; }
      continue;
    }
    // 块注释：到下一个结束标记
    if (c === '/' && c2 === '*') {
      blank(c); blank(c2); i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) { blank(text[i]); i++; }
      if (i < n) { blank(text[i]); blank(text[i + 1]); i += 2; }
      continue;
    }
    // 字符串 / 模板字面量：整段原样保留（内部不认注释）
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out.push(c); i++;
      while (i < n) {
        const d = text[i];
        if (d === '\\') { out.push(d); if (i + 1 < n) out.push(text[i + 1]); i += 2; continue; }
        out.push(d); i++;
        if (d === quote) break;
      }
      prev = quote;
      continue;
    }
    // 正则字面量：整段原样跳过（`\` 转义、`[…]` 字符类都认；行内未闭合就收手，绝不跨行）
    if (c === '/' && !isValueEnd(prev)) {
      out.push(c); i++;
      let inClass = false;
      while (i < n) {
        const d = text[i];
        if (d === '\\') { out.push(d); if (i + 1 < n) out.push(text[i + 1]); i += 2; continue; }
        if (d === '\n') break;
        out.push(d); i++;
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) break;
      }
      prev = '/';
      continue;
    }
    out.push(c); i++;
    if (!isSpace(c)) prev = c;
  }
  return out.join('');
}

/** 值结尾字符（判 `/` 是除号还是正则字面量的启发式；与 `stripComments` 内那份同源）。 */
function isValueEndChar(ch) {
  return ch !== '' && /[\w$)\]}'"`]/.test(ch);
}

/**
 * 单遍字符扫描器的**原子识别**：从 `text[i]` 起若开始一个"整体原子"，返回它的结束位置、是否
 * 闭合、类型与扫过之后的上一个有义字符；否则返回 `null`（调用方按普通字符处理）。
 *
 * 原子 = 行注释 / 块注释 / 字符串 / 模板字面量 / 正则字面量 —— 共同点是**内部的花括号不参与
 * JS 配对**。`moduleScopeOf` 与 `functionBodyOf` 共用这一份识别（P2-3A 归一：此前
 * `verify-logging` 与 `verify-types` 各抄了一份朴素配平，正则/字符串里的花括号能骗过它们）。
 *
 * `/` 是正则还是除号：用"上一个有意义字符"启发式（`prev` 是值结尾就按除号）。注释先于正则判
 * （`//`、`/*` 在 JS 里总是注释）。行内未闭合的正则**绝不跨行吞**。
 * @param {string} text 源码
 * @param {number} i 当前位置
 * @param {string} prev 上一个有意义字符
 * @returns {{ end: number, closed: boolean, kind: string, prevAfter: string }|null}
 */
function scanAtom(text, i, prev) {
  const n = text.length;
  const c = text[i];
  if (c === '/' && text[i + 1] === '/') {
    let j = i + 2;
    while (j < n && text[j] !== '\n') j++;
    return { end: j, closed: true, kind: 'line-comment', prevAfter: prev };
  }
  if (c === '/' && text[i + 1] === '*') {
    const close = text.indexOf('*/', i + 2);
    return { end: close < 0 ? n : close + 2, closed: close >= 0, kind: 'block-comment', prevAfter: prev };
  }
  if (c === '"' || c === "'" || c === '`') {
    let j = i + 1;
    let closed = false;
    while (j < n) {
      const d = text[j];
      if (d === '\\') { j += 2; continue; }
      j++;
      if (d === c) { closed = true; break; }
    }
    return { end: Math.min(j, n), closed, kind: 'string', prevAfter: c };
  }
  if (c === '/' && !isValueEndChar(prev)) {
    let j = i + 1;
    let inClass = false;
    let closed = false;
    while (j < n) {
      const d = text[j];
      if (d === '\\') { j += 2; continue; }
      if (d === '\n') break;
      if (d === '[') inClass = true;
      else if (d === ']') inClass = false;
      else if (d === '/' && !inClass) { j++; closed = true; break; }
      j++;
    }
    return { end: Math.min(j, n), closed, kind: 'regex', prevAfter: closed ? '/' : c };
  }
  return null;
}

/**
 * 取出**模块作用域**的文本 —— 顶层、任何 `{ … }` 体（函数体、对象字面量、`import { … }` 的
 * 说明符表…）之外的片段拼起来。给"环的求值期纪律"类判据用：模块求值期执行的就是这段文本。
 *
 * 为什么不能只按 `{`/`}` 配平：**正则字面量里可以合法地出现花括号**（本仓就写得出
 * `/[{]/`、`/[{}]/`）。不跳过正则时 `/[.]` 里的那个 `{` 会把深度永久抬高 ⇒ 之后所有代码都
 * 被当成"体内"，模块作用域**缩成空**，而判据照样报绿（静默失效，正是本仓最不想要的形态）。
 * 所以这里与 `stripComments` 共用同一套"上一个有意义字符"启发式来识别正则字面量，并整体
 * 跳过字符串/模板（含 `\` 转义）。也先剥注释（等长），于是 `//` 里、块注释里的花括号不算数。
 *
 * 方向仍是安全的：识别不出正则时最多**少切**（某些体内文本留在结果里 ⇒ 判据偏严/变红），
 * 不会**多吃**掉真实模块作用域。
 * @param {string} src 模块源码
 * @returns {string} 模块作用域的文本（各顶层片段按原顺序拼接）
 */
function moduleScopeOf(src) {
  const text = stripComments(src);
  const n = text.length;
  const out = [];
  let depth = 0;
  let prev = '';
  let i = 0;
  while (i < n) {
    const atom = scanAtom(text, i, prev);
    if (atom !== null) {
      // 原子整段跳过；它在模块作用域里时要原样保留（字符串/正则的字面文本得留着）。
      if (depth === 0) out.push(text.slice(i, atom.end));
      prev = atom.prevAfter;
      i = atom.end;
      continue;
    }
    const c = text[i];
    if (c === '{') { depth++; i++; prev = c; continue; }
    if (c === '}') { if (depth > 0) depth--; i++; prev = c; continue; }
    if (depth === 0) out.push(c);
    if (!isSpace(c)) prev = c;
    i++;
  }
  return out.join('');
}

/**
 * 取出 `header` 之后**第一个 `{ … }` 体的原文**（含花括号、含体内注释），与 `moduleScopeOf`
 * **共用同一份原子扫描器**（`scanAtom`）—— 字符串 / 模板 / 正则字面量 / 注释里的花括号都不会
 * 骗过配对。P2-3A 起 `verify-logging` 与 `verify-types` 的本地 `functionBody` 都委托到这里。
 *
 * ⚠️ **不能拿 `moduleScopeOf` 代替这个语义**：两者方向相反 —— `moduleScopeOf` 返回"所有 `{…}`
 * 体之外"的文本（模块求值期），本函数返回"某一个 `{…}` 体之内"的文本。`verify-logging` 的
 * N8/N8b 依赖"非 apply 函数体里的 `log.warn` 也算模块级引用"（既有负对照
 * `moduleScopeLogRefs("function f(){ log.warn('x'); }…")` 必须数到 1 条），换成 `moduleScopeOf`
 * 会把这个函数体整段抠掉 ⇒ 既有负对照自己变红。别互换。
 *
 * 定位失败（找不到 `header`、其后没有 `{`、或大括号不配对）返回 `null`；调用方**必须**把
 * `null` 当"解析失败 ⇒ 判据变红"，不许静默放行。
 * @param {string} src 源码
 * @param {string} header 函数头文本（`indexOf` 匹配，如 `'function reportFailure(kind, err)'`）
 * @returns {string|null} 函数体原文（含花括号）
 */
function functionBodyOf(src, header) {
  const text = String(src);
  const at = text.indexOf(header);
  if (at < 0) return null;
  const open = text.indexOf('{', at + header.length);
  if (open < 0) return null;
  const n = text.length;
  let depth = 0;
  let prev = '';
  let i = open;
  while (i < n) {
    const atom = scanAtom(text, i, prev);
    if (atom !== null) { prev = atom.prevAfter; i = atom.end; continue; }
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return text.slice(open, i + 1); }
    if (!isSpace(c)) prev = c;
    i++;
  }
  return null;
}

/**
 * 把 `src/**` 模块的**正文**从它的 `export` 语法里剥出来 —— 供 `new Function` / `vm.Script`
 * 这类**非模块环境**求值时使用（构建期内联时也是这么剥的，见 `scripts/build-client.mjs`）。
 *
 * 为什么需要：`src/` 模块用 `export { … }` 列出对外名字（那份清单同时是**守卫的接口**，
 * 见 `CODE-STRUCTURE.md` §5 第 5 条）。可一旦守卫把**原始源码**喂给 `new Function` / `vm.Script`，
 * `export` 就是语法错误 —— 实测三处踩过：`verify-scene-live`（quick-panel 复现台）、
 * `verify-i18n`（i18n 运行时沙箱）、`verify-client`（effects 段）。
 * 与其在每个调用点各抄一份正则，收在这里一处。
 *
 * `src/client.js` 是**正文**、本来没有导出块 ⇒ 传进来等于空操作（本函数对它恒等）。
 * @param {string} text 模块源码
 * @returns {string} 去掉 `export { … }` 块与 `export ` 关键字后的正文
 */
function stripExportBlocks(text) {
  // ⚠️ `g` 是必需的：一个文本里可能有**多个**模块拼在一起（玻璃重构 R3b 起，
  // `verify-glass-surfaces` 要把 `src/glass.js` + `src/effects.js` 拼成一个沙箱源码）。
  // 少了 `g` 只剥第一个块，剩下的那个会退化成一个裸的 `{ a, b, };` ⇒ `new Function` 报
  // `Unexpected token '}'`（实测踩过，报错位置还落在拼接后的第 735 行，很难一眼看出根因）。
  return String(text).replace(/^\s*export\s*\{[\s\S]*?\};?\s*$/gm, '').replace(/^\s*export\s+/gm, '');
}

/**
 * 工具：把文本切成"行"（**同时切掉行尾的 `\r`**），再用给定的行尾拼回去。
 *
 * 为什么值得单独一个函数：本仓是**一份跨平台代码**，检出侧常是 CRLF，而构建脚本会
 * **硬失败**在"孤立回车"上（`\r\r\n` ⇒ 产物变成平台相关、另一条 CI 腿的产物同步判据会红）。
 * 实测踩过：改 `src/client.js` 注释的脚本按 `\n` 切行、再用 `join('\r\n')` 还原，
 * 把整份文件弄成**每行 `\r\r\n`（4568 处）** —— 是构建守卫当场拦住的，不是人看出来的。
 * 正确姿势：先按 `\r\n|\r|\n` 切（`\r` 一起切掉），再按**原文件的行尾**拼回去。
 *
 * @param {string} text 原文
 * @returns {{ lines: string[], eol: 'CRLF'|'LF', join: (ls: string[]) => string }}
 */
function splitLinesSafe(text) {
  const eol = String(text).includes('\r\n') ? 'CRLF' : 'LF';
  const lines = String(text).split(/\r\n|\r|\n/);
  return { lines, eol, join: (ls) => ls.join(eol === 'CRLF' ? '\r\n' : '\n') };
}

/**
 * 把**内容匹配 `test`** 的字符串 / 模板字面量的内容换成等长空格（引号保留、换行保留、长度不变）。
 *
 * 用途：守卫读源码时，自己为负对照写下的"夹具文本"（形如 `"import x from 'pkg'"`）是**数据**，
 * 不是依赖 —— 不抹掉就会把守卫自己判红（实测：P5 的裸依赖扫描把 purity 的夹具全当成真依赖）。
 * 与 `stripComments` **共用同一套正则/字符串识别**（`scanAtom`）：正则字面量里带引号
 * （`/['"]/`）不会让它错位 —— 朴素的字符扫描器正是在这里翻车，之后整段漏抹且不报错。
 * @param {string} src 源码（**先过 `stripComments`**：注释里的一句 `from 'pkg'` 不是字符串，
 *   本函数不认识注释，注释必须由调用方先剥）
 * @param {(content: string) => boolean} test 内容命中即抹白（内容 = 两引号之间的原文）
 * @returns {string} 与入参**等长**的文本
 */
function blankStringLiterals(src, test) {
  const text = String(src);
  const n = text.length;
  const out = [];
  let prev = '';
  let i = 0;
  while (i < n) {
    const atom = scanAtom(text, i, prev);
    if (atom !== null) {
      let seg = text.slice(i, atom.end);
      if (atom.kind === 'string' && atom.closed && seg.length >= 2 && test(seg.slice(1, -1))) {
        seg = seg[0] + seg.slice(1, -1).replace(/[^\n]/g, ' ') + seg[seg.length - 1];
      }
      out.push(seg);
      prev = atom.prevAfter;
      i = atom.end;
      continue;
    }
    const c = text[i];
    out.push(c);
    if (!isSpace(c)) prev = c;
    i++;
  }
  return out.join('');
}

/** 自检：正/负对照成对；并含一条"朴素实现会吃掉真代码"的**反面参照**。 */
function selftest() {
  const results = [];
  const ok = (name, cond, detail) => results.push({ name, cond: Boolean(cond), detail });
  // ⚠️ 这是**反面参照**（不是生产路径）：朴素写法**故意**留在这里当对照，用来证明上面那个缺陷真实存在。
  const naive = (s) => String(s).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

  // ① 行注释里的"块注释起始"不得开块注释。
  //    真实形态：把 `scripts/**` 写进一句行注释，**后面还有一条真块注释** ⇒ 朴素实现会从前者
  //    一路吃到后者的结束标记，把中间的真实代码静默删掉（本仓实测到的量级：95 / 331 行）。
  const caseLine = '// 面 = `scripts/**` 与 `test/**`\nconst a = 1;\n/** 真注释 */\nconst b = 2;\n';
  ok('正判据：行注释里的 `/**` 不吃掉后面的代码',
    stripComments(caseLine).includes('const a = 1;') && stripComments(caseLine).includes('const b = 2;'));
  ok('反面参照：朴素实现会吃掉中间的代码（证明缺陷真实）',
    !naive(caseLine).includes('const a = 1;'), '朴素输出=' + JSON.stringify(naive(caseLine).slice(0, 44)));

  // ② 字符串里的"块注释起始"同样不得开块注释（真实形态：'test/tools/*.mjs'）
  const caseStr = "const p = 'test/tools/*.mjs';\nconst q = 1;\n/* z */\nconst r = 2;\n";
  ok('正判据：字符串里的 `/*` 不吃掉后面的代码',
    stripComments(caseStr).includes("'test/tools/*.mjs'")
    && stripComments(caseStr).includes('const q = 1;') && stripComments(caseStr).includes('const r = 2;'));
  ok('反面参照：朴素实现会吃掉中间的代码',
    !naive(caseStr).includes('const q = 1;'), '朴素输出=' + JSON.stringify(naive(caseStr).slice(0, 44)));

  // ③ 真块注释仍要剥掉，且不影响后续代码
  const caseBlock = '/* c */ const a = 1;';
  ok('正判据：真块注释被剥掉、代码保留',
    !stripComments(caseBlock).includes('/*') && stripComments(caseBlock).includes('const a = 1;'));

  // ④ 行注释里的 `//` 仍要剥掉（含"URL 不算注释"的负对照）
  ok('正判据：行注释被剥掉', !stripComments('const a = 1; // hi\n').includes('hi'));
  ok('负对照：字符串里的 URL 不算注释',
    stripComments("const u = 'https://x/y';").includes('https://x/y'));

  // ⑤ 等长 + 换行保留（行号/列偏移不变的判据）
  const sample = '/* a\nb */ x\n// tail\ny\n';
  const got = stripComments(sample);
  ok('正判据：剥后与原文**等长**', got.length === sample.length, `${got.length} vs ${sample.length}`);
  ok('正判据：行数不变（换行原样保留）', got.split('\n').length === sample.split('\n').length);
  ok('正判据：未被注释的字符原样在', got.includes('x') && got.includes('y'));

  // ⑥ 模板字面量与转义
  ok('正判据：模板里的 `/*` 不算注释', stripComments('const t = `a/*b`;\nconst z = 1;\n').includes('const z = 1;'));
  ok('正判据：转义引号不会提前结束字符串', stripComments("const s = 'a\\'/*b';\nconst z = 1;\n").includes('const z = 1;'));

  // ⑦ 正则字面量（这一步是必需的：正则里会合法地出现 `/*`、`//`）
  //    真实形态 a：字符类里带 `/*`（守卫搜源码里的块注释标记时就会这么写）
  const caseReClass = String.raw`const r = /[/*]/g;` + '\nconst a = 1;\n/* z */\nconst b = 2;\n';
  ok('正判据：正则字符类里的 `/*` 不算注释（后面的代码保留）',
    stripComments(caseReClass).includes('const a = 1;') && stripComments(caseReClass).includes('const b = 2;'));
  ok('反面参照：朴素实现会从正则里那个 `/*` 一路吃到后面的块注释结束',
    !naive(caseReClass).includes('const a = 1;'), '朴素输出=' + JSON.stringify(naive(caseReClass).slice(0, 44)));
  //    真实形态 b：以 `\//` 收尾的正则（本仓 4 个文件这么写）—— 不识别就会把该行后半段当行注释
  const caseReTail = String.raw`const r = /\/\//g; const a = 1;` + '\nconst b = 2;\n';
  ok('正判据：以 `\\//` 收尾的正则不被当成行注释（该行原样保留）',
    stripComments(caseReTail).includes('const a = 1;') && stripComments(caseReTail).includes(String.raw`/\/\//g`));
  ok('负对照：除号不会被当成正则（`a / b / c` 原样保留）',
    stripComments('const x = a / b / c;\nconst y = 1;\n').includes('a / b / c;'));

  // ⑥ 剥导出块（供 new Function / vm.Script 这类非模块环境求值用）
  ok('正判据：多行 `export { … }` 块被剥掉、正文保留',
    (() => {
      const out = stripExportBlocks('const a = 1;\nexport {\n  a,\n};\n');
      return out.includes('const a = 1;') && !/^\s*export\b/m.test(out);
    })());
  ok('正判据：缩进的导出块同样被剥掉（本仓 picker-modal / quick-panel 那三个文件的形态）',
    !/^\s*export\b/m.test(stripExportBlocks('  function f() {}\n  export {\n    f,\n  };\n')));
  ok('负对照：`export const` 行内形态也能剥',
    !/^\s*export\b/m.test(stripExportBlocks('export const A = 1;\nexport function g() {}\n')));
  ok('负对照：没有导出块的正文逐字不变（client.js 是正文，传进来必须是恒等）',
    stripExportBlocks('const a = 1;\n') === 'const a = 1;\n');
  ok('负对照：正文里的 `wrapper.export` 之类的词不受影响',
    stripExportBlocks('const x = obj.export;\n').includes('obj.export'));
  ok('正判据：**两个模块拼在一起**时两个导出块都要剥掉（R3b 起 glass.js + effects.js 的沙箱形态）',
    (() => {
      const out = stripExportBlocks('const a = 1;\nexport { a };\nconst b = 2;\nexport {\n  b,\n};\n');
      if (/^\s*export\b/m.test(out)) return false;
      try { new Function(out + '\nreturn [a, b];'); return true; } catch { return false; }
    })());

  // ⑦ 行尾安全的切行（改注释的脚本必用；见 splitLinesSafe 的注释里那次实测）
  ok('正判据：CRLF 原文切行后行尾不带 `\\r`，拼回去仍是 CRLF',
    (() => {
      const s = splitLinesSafe('a\r\nb\r\n');
      return s.eol === 'CRLF' && s.lines.join('|') === 'a|b|' && s.join(s.lines) === 'a\r\nb\r\n';
    })());
  ok('正判据：LF 原文拼回去仍是 LF（不把 LF 升成 CRLF）',
    (() => {
      const s = splitLinesSafe('a\nb\n');
      return s.eol === 'LF' && s.join(s.lines) === 'a\nb\n';
    })());
  // 不要拿"朴素 split/join 会造出 `\r\r\n`"当对照：它只复述 JS 的 `split`/`join` 语义，
  // 对任何实现都真。真实契约（CRLF/LF 原文往返不串行尾）由上面两条 `splitLinesSafe` 正判据钉。

  // ⑧ 模块作用域（环的求值期纪律用）：函数体/字符串/正则里的花括号都不得扰乱深度。
  //    真实形态：判据要问"组件入口的模块作用域里有没有门面导入名"，而源码里就有 `/[{]/` 这类正则。
  const naiveScope = (s) => {
    // ⚠️ 反面参照（不是生产路径）：只按花括号配平、不跳字符串/正则 —— 用来证明缺陷真实存在。
    const t = stripComments(String(s));
    let d = 0;
    const out = [];
    for (const c of t) {
      if (c === '{') { d++; continue; }
      if (c === '}') { if (d > 0) d--; continue; }
      if (d === 0) out.push(c);
    }
    return out.join('');
  };
  const scopeCase = 'const RE = /[{]/;\nconst a = 1;\nfunction f() { const inner = 2; }\nconst b = 3;\n';
  ok('正判据：正则字面量里的 `{` 不抬高深度（后面的顶层声明仍在模块作用域里）',
    moduleScopeOf(scopeCase).includes('const a = 1;') && moduleScopeOf(scopeCase).includes('const b = 3;'));
  ok('反面参照：不跳正则的朴素配平会把后面全部吞进"体内"（证明缺陷真实）',
    !naiveScope(scopeCase).includes('const a = 1;'), '朴素输出=' + JSON.stringify(naiveScope(scopeCase).slice(0, 44)));
  ok('正判据：函数体内的文本不算模块作用域，函数签名仍在',
    moduleScopeOf(scopeCase).includes('function f()') && !moduleScopeOf(scopeCase).includes('const inner = 2;'));
  ok('正判据：字符串里的 `{` 不算深度',
    moduleScopeOf("const s = '{';\nconst y = 1;\n").includes('const y = 1;'));
  ok('正判据：`import { a } from …` 的说明符表算"体内"（环判据才不会把 import 自己当违规）',
    moduleScopeOf("import { applyComponent } from '../../index.js';\n").includes("'../../index.js'")
    && !moduleScopeOf("import { applyComponent } from '../../index.js';\n").includes('applyComponent'));
  ok('正判据：块注释/行注释里的花括号不算深度（已先剥注释）',
    moduleScopeOf('/* { */ const a = 1; // }\nconst b = 2;\n').includes('const a = 1;')
    && moduleScopeOf('/* { */ const a = 1; // }\nconst b = 2;\n').includes('const b = 2;'));

  // ⑨ 函数体提取（`verify-logging` / `verify-types` 的 functionBody 归一到 `functionBodyOf`）：
  //    与 ⑧ 共用 `scanAtom`。真实形态：函数体里合法地写着 `/[}]/`、`'}'`、`/* } */` —— 只按
  //    花括号配平会**提前收尾**（把后半段静默丢掉），于是"体内有没有 console"这类判据假绿。
  const naiveBody = (s, header) => {
    // ⚠️ 反面参照（不是生产路径）：只按花括号配平、不跳字符串/正则/注释。
    const at = s.indexOf(header);
    if (at < 0) return null;
    const open = s.indexOf('{', at + header.length);
    if (open < 0) return null;
    let d = 0;
    for (let i = open; i < s.length; i++) {
      if (s[i] === '{') d++;
      else if (s[i] === '}' && --d === 0) return s.slice(open, i + 1);
    }
    return null;
  };
  const bodyCase = 'function f() { const re = /[}]/; console.log("x"); }\n';
  ok('正判据：正则字面量里的 `}` 不提前收尾（函数体含后半段）',
    (functionBodyOf(bodyCase, 'function f(') || '').includes('console.log("x")'));
  ok('反面参照：不跳正则的朴素配平会提前收尾、后半段被静默丢掉（证明缺陷真实）',
    (naiveBody(bodyCase, 'function f(') || '').includes('console.log("x")') === false,
    '朴素输出=' + JSON.stringify(naiveBody(bodyCase, 'function f(')));
  ok('正判据：字符串里的 `}` 不算配平',
    (functionBodyOf("function f() { const s = '}'; return 1; }", 'function f(') || '').includes('return 1;'));
  ok('正判据：注释里的花括号不算配平（块注释 + 行注释都算）',
    (functionBodyOf('function f() { /* } */ return 1; // }\n}', 'function f(') || '').includes('return 1;'));
  ok('正判据：header 定位不到 / 其后无 `{` / 不配对 ⇒ null（调用方必须判红）',
    functionBodyOf('const a = 1;', 'function f(') === null
    && functionBodyOf('function f() ;', 'function f(') === null
    && functionBodyOf('function f() { return 1;', 'function f(') === null);
  ok('正判据：只取第一个匹配的函数体，后面的函数体不混进来',
    functionBodyOf('function f() { return 1; }\nfunction g() { return 2; }', 'function f(') === '{ return 1; }');
  ok('正判据：模块作用域与函数体是**相反语义**（前者不含 `return 1;`，后者含）',
    !moduleScopeOf('function f() { return 1; }\n').includes('return 1;')
    && (functionBodyOf('function f() { return 1; }\n', 'function f(') || '').includes('return 1;'));

  // ⑩ 夹具字符串抹白（守卫的负对照文本不得被守卫自己的扫描器当成依赖）。
  //    真实形态：P5 的裸依赖扫描把 purity 里 `text: "import { x } from 'lodash';"` 当成了真依赖。
  const fixtureSrc = 'const a = "import { x } from \'lodash\';";\nconst b = 1;\n';
  const blankFixture = (s) => blankStringLiterals(stripComments(s), (c) => /\b(?:import|export|require)\b/.test(c));
  ok('正判据：内容含模块语法的字符串被抹白（长度不变、后续代码保留）',
    blankFixture(fixtureSrc).includes('const b = 1;') && blankFixture(fixtureSrc).length === fixtureSrc.length
    && !blankFixture(fixtureSrc).includes('lodash'));
  ok('负对照：真说明符字符串不被抹白（内容不含模块关键字 ⇒ 原样）',
    blankFixture("import x from 'left-pad';").includes("'left-pad'"));
  ok('正判据：正则字面量里带引号时不致错位（朴素字符扫描器在这里翻车）',
    (() => {
      const s = "const r = /['\"]/;\nconst t = \"import x from 'lodash'\";\n";
      const out = blankFixture(s);
      return out.includes("/['\"]/") && !out.includes('lodash');
    })());
  let failed = 0;
  for (const r of results) {
    console.log((r.cond ? '✓ ' : '✗ ') + r.name + (r.detail ? ' — ' + r.detail : ''));
    if (!r.cond) failed++;
  }
  console.log('');
  if (failed) {
    console.log(`js-text selftest FAILED — ${failed}/${results.length}`);
    process.exit(1);
  }
  console.log(`js-text selftest PASSED (${results.length})`);
}

export { stripComments, blankStringLiterals, moduleScopeOf, functionBodyOf, stripExportBlocks, splitLinesSafe, selftest };

// 作为脚本直接跑时才执行自检（被 `import` 时**不得**有副作用 —— 守卫要 import 这个模块）
const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly && process.argv[2] === 'selftest') selftest();
