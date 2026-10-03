#!/usr/bin/env node
/**
 * js-text.mjs — JS/TS 源码的**文本级**工具（守卫读源码时用）。
 *
 * 目前只有一个入口：`stripComments(src)` —— 把注释替换成**等长空格**（换行原样保留）。
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
  ok('negative control: 朴素的 `split("\\n")` + `join("\\r\\n")` 会造出 `\\r\\r\\n`（这就是那次事故）',
    'a\r\n'.split('\n').join('\r\n') === 'a\r\r\n');

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

export { stripComments, stripExportBlocks, splitLinesSafe, selftest };

// 作为脚本直接跑时才执行自检（被 `import` 时**不得**有副作用 —— 守卫要 import 这个模块）
const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly && process.argv[2] === 'selftest') selftest();
