#!/usr/bin/env node
/**
 * i18n-scan.mjs — 源码里的**中文字面量**扫描器（守卫与迁移工具共用的唯一实现）。
 *
 * 干什么：把一份 JS 源码词法扫一遍，找出所有"含 CJK 的字符串字面量 / 模板字面量的静态段"，
 * 并回答每个字面量的三个问题：
 *
 *   ① `frames`  —— 它处在哪些**调用实参**里（从外到内的被调函数名，如 `["createElement","weT"]`）。
 *      判"翻译过没有"就靠它：**最内层帧**是 `weT` ⇒ 已包；最内层帧是诊断函数 ⇒ 诊断串。
 *      为什么按"帧"而不是"往前找 `weT(`"：嵌套调用（`weT(cond ? "甲" : "乙")`、
 *      `weT("共 {n} 张", { n })`）里，字面量前面并不是 `weT(`；而字面量又可能出现在
 *      `weT(f("中文"))` 这种**外层包了、内层没包**的位置 —— 逐字符维护括号栈才分得清。
 *
 *   ② `kind` —— `string` 还是 `template`（模板的**静态段**）。模板字面量带 `${}` 时
 *      **不能被 `weT(...)` 包住就完事**：JS 会先把 `${}` 求值，`weT` 拿到的是已插值的结果，
 *      字典里查不到 ⇒ 原样吐中文。这类位置必须改写成 `weT("共 {n} 张", { n })`（占位符
 *      由字典/`weT` 负责插值）。判据给出 `hasInterp` 让守卫能把它和普通字符串分开数。
 *
 *   ③ `concatAdjacent` —— 字面量是不是 `+` 拼接的一段。`weT("共 ") + n + weT(" 张")`
 *      逐段都"包过了"，却是**碎片化翻译**（英文语序/复数对不上，翻译者拿到的是半句话）。
 *      判据把相邻于 `+` 的字面量标出来，守卫据此要求改成一个带占位符的整句。
 *
 * 词法覆盖面：行注释 / 块注释 / `'…'` `"…"` / `` `…` ``（含 `${…}` 内部再递归扫，模板套模板
 * 也算）/ 正则字面量（按 `js-text.mjs` 同一套启发式跳过，避免把 `/\//` 里的内容当代码）。
 * 注释与正则里的 CJK **不产生**结果 —— 注释里的中文是文档，不是 UI 文案。
 *
 * CLI：
 *   node test/tools/i18n-scan.mjs                     扫 src/ 下全部 .js（默认）
 *   node test/tools/i18n-scan.mjs --json src/x.js ...  机器可读（迁移工具用这个）
 *   node test/tools/i18n-scan.mjs --all                连"已包 / 诊断 / 允许清单"的项一起打印
 *   node test/tools/i18n-scan.mjs selftest             正负对照自检
 *
 * 契约：本文件是**纯函数库 + 薄 CLI**，不 import 任何其它仓库模块（守卫与迁移脚本都能直接
 * 复制/引用它）。判据只做词法判断，不做语义判断 —— "这句中文该不该翻译"是人的决定，
 * 机器只回答"它有没有进 `weT(...)`"。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** CJK 判定：汉字（含扩展 A）+ CJK 标点/全角形式（「」、，。、：；！？…）。 */
export const CJK_RE = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/;

/** 含 CJK 就算"要翻译的候选"（数字/拉丁字母串不算）。 */
export function hasCjk(text) {
  return CJK_RE.test(String(text));
}

/**
 * 词法扫描：返回源码里所有含 CJK 的字符串/模板静态段。
 * @param {string} src - JS 源码。
 * @param {{translateCallees?: string[]}} [options] - 视为"译文包装"的被调函数名（默认 `['weT']`）。
 * @returns {Array<{index:number,line:number,column:number,value:string,kind:'string'|'template',
 *   hasInterp:boolean,concatAdjacent:boolean,frames:string[],innermost:string|null,
 *   wrapped:boolean,diagnostic:boolean,quote:string}>}
 */
export function scanCjkStrings(src, options = {}) {
  const translateCallees = new Set(options.translateCallees || ['weT']);
  const text = String(src);
  const n = text.length;
  const out = [];
  // 行号表：一次性算好每行起始偏移，行号查询 O(log n)。
  const lineStarts = [0];
  for (let i = 0; i < n; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const posOf = (i) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= i) lo = mid; else hi = mid - 1; }
    return { line: lo + 1, column: i - lineStarts[lo] + 1 };
  };
  /** 括号栈：`(` 帧带被调函数名；其它括号帧 callee 为 null（只用于配对）。 */
  const frames = [];
  const frameNames = () => frames.map((f) => f.callee).filter((c) => c !== null);
  /** 上一个有意义 token（用于正则判定与取被调函数名）。 */
  let prevSig = '';
  let lastIdent = null;      // 最近的标识符（`(` 的候选被调函数名）
  let lastIdentEnd = -1;

  const push = (i, value, kind, quote, hasInterp, start, end) => {
    if (!hasCjk(value)) return;
    const names = frameNames();
    const innermostFrame = frames.length ? frames[frames.length - 1] : null;
    const innermost = innermostFrame ? innermostFrame.callee : null;
    const p = posOf(i);
    out.push({
      index: i, line: p.line, column: p.column, value, kind, quote,
      hasInterp: Boolean(hasInterp),
      concatAdjacent: false,
      frames: names,
      innermost,
      // 带 `${}` 的模板**永远不算包过**：`weT(`共 ${n} 张`)` 里 JS 先插值再查字典，
      // 键是 "共 3 张" ⇒ 必然查不到、原样吐中文。这类位置必须改成占位符形式。
      wrapped: !(kind === 'template' && hasInterp) && innermost !== null && translateCallees.has(innermost),
      diagnostic: innermost !== null && DIAGNOSTIC_CALLEES.has(innermost),
      // 内部字段（后置一趟算 concatAdjacent 用；返回前删掉）
      _local: true, _start: start, _end: end, _frames: frames.slice(),
    });
  };

  let i = 0;
  while (i < n) {
    const c = text[i];
    const c2 = text[i + 1];
    // ── 注释 ────────────────────────────────────────────────────────────────
    if (c === '/' && c2 === '/') { while (i < n && text[i] !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    // ── 正则字面量（同一套启发式：上一个有意义字符是运算符/分隔符 ⇒ 视为正则开始）──
    if (c === '/' && (prevSig === '' || /[=([,;:!&|?{}+*%<>~^-]/.test(prevSig))) {
      let j = i + 1;
      let closed = false;
      let inClass = false;
      while (j < n) {
        const d = text[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '\n') break;
        if (inClass) { if (d === ']') inClass = false; }
        else if (d === '[') inClass = true;
        else if (d === '/') { closed = true; break; }
        j++;
      }
      if (closed) { i = j + 1; prevSig = '/'; lastIdent = null; continue; }
      // 未闭合：不跳（最多本行少剥，绝不跨行吞）
    }
    // ── 字符串 ──────────────────────────────────────────────────────────────
    if (c === '"' || c === "'") {
      const start = i;
      let j = i + 1;
      let value = '';
      while (j < n) {
        const d = text[j];
        if (d === '\\') { value += text[j + 1] === undefined ? '' : text[j + 1]; j += 2; continue; }
        if (d === c) break;
        if (d === '\n') break;
        value += d;
        j++;
      }
      push(start, value, 'string', c, false, start, j + 1);
      i = j + 1; prevSig = c; lastIdent = null; continue;
    }
    // ── 模板字面量：静态段逐个上报；`${…}` 内部按代码递归 ───────────────────
    if (c === '`') {
      const start = i;
      let j = i + 1;
      let chunk = '';
      let hasInterp = false;
      // 模板整体算**一条**命中（静态段拼接起来就是迁移时要写进字典的整句）：
      // `共 ${n} 张` ⇒ 一条 "共 张"（hasInterp=true），迁移改写成 weT("共 {n} 张", { n })。
      // 逐段上报会把一句话拆成两条，迁移者与守卫都会数错。
      const chunks = [];
      while (j < n) {
        const d = text[j];
        if (d === '\\') { chunk += text[j + 1] === undefined ? '' : text[j + 1]; j += 2; continue; }
        if (d === '`') {
          chunks.push(chunk);
          push(start, chunks.join(''), 'template', '`', hasInterp, start, j + 1);
          break;
        }
        if (d === '$' && text[j + 1] === '{') {
          chunks.push(chunk);
          hasInterp = true;
          // 跳过 ${…}：括号配对（认字符串/模板/注释）—— 用同一套词法递归代价太大，
          // 这里只做"配对跳过"，其中的 CJK 由外层 while 之后的常规扫描负责吗？不：
          // 插值里的中文字面量同样是 UI 文案，必须能被看到 ⇒ 递归调用本函数扫那一段。
          let depth = 1;
          let k = j + 2;
          const innerStart = k;
          while (k < n && depth > 0) {
            const e = text[k];
            if (e === '\\') { k += 2; continue; }
            if (e === '"' || e === "'" || e === '`') {
              // 字符串/嵌套模板整体跳过（内部再递归处理模板的静态段）
              const q = e;
              let m = k + 1;
              while (m < n) {
                if (text[m] === '\\') { m += 2; continue; }
                if (text[m] === q || text[m] === '\n') break;
                if (q === '`' && text[m] === '$' && text[m + 1] === '{') {
                  // 嵌套模板里的插值：交给递归（简单括起）
                  let d2 = 1; let p = m + 2;
                  while (p < n && d2 > 0) {
                    if (text[p] === '{') d2++;
                    else if (text[p] === '}') d2--;
                    else if (text[p] === '"' || text[p] === "'") {
                      const q2 = text[p]; let r = p + 1;
                      while (r < n && text[r] !== q2 && text[r] !== '\n') { if (text[r] === '\\') r++; r++; }
                      p = r;
                    }
                    p++;
                  }
                  m = p; continue;
                }
                m++;
              }
              k = m + 1;
              continue;
            }
            if (e === '{') depth++;
            else if (e === '}') depth--;
            if (depth === 0) break;
            k++;
          }
          const inner = text.slice(innerStart, k);
          for (const hit of scanCjkStrings(inner, options)) {
            // 插值内部的命中：位置换算回外层偏移，帧栈带上"模板外层"的帧。
            const p = posOf(innerStart + hit.index);
            out.push({
              ...hit,
              index: innerStart + hit.index,
              line: p.line,
              column: p.column,
              frames: [...frameNames(), ...hit.frames],
            });
          }
          j = k + 1;
          chunk = '';
          continue;
        }
        chunk += d;
        j++;
      }
      i = j + 1; prevSig = '`'; lastIdent = null; continue;
    }
    // ── 标识符 / 成员名 ────────────────────────────────────────────────────
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(text[j])) j++;
      lastIdent = text.slice(i, j);
      lastIdentEnd = j;
      i = j; prevSig = 'a'; continue;
    }
    if (c === '.' && lastIdentEnd === i) { i++; prevSig = '.'; continue; }
    // ── 括号 ────────────────────────────────────────────────────────────────
    if (c === '(') {
      // 被调函数名：紧邻的标识符（允许空白），且它必须与 `(` 之间只隔空白。
      let callee = null;
      if (lastIdent !== null && /^[\s]*$/.test(text.slice(lastIdentEnd, i))) callee = lastIdent;
      frames.push({ callee, parenIndex: i, endIndex: null });
      i++; prevSig = '('; lastIdent = null; continue;
    }
    if (c === ')' || c === ']' || c === '}') {
      const frame = frames.length ? frames.pop() : null;
      if (frame && c === ')') frame.endIndex = i;
      i++; prevSig = c; lastIdent = null; continue;
    }
    if (c === '[' || c === '{') {
      frames.push({ callee: null });
      i++; prevSig = c; lastIdent = null; continue;
    }
    if (!/\s/.test(c)) { prevSig = c; lastIdent = null; }
    i++;
  }
  // ── 后置一趟：算 `+` 拼接标记 ──────────────────────────────────────────────
  // 两种形态都算"碎片化翻译"：① 字面量自己紧邻 `+`（`"共 " + n`）；② 包着它的 `weT(...)`
  // 整体紧邻 `+`（`weT("共 ") + n + weT(" 张")` —— 逐段都"包过"，却是半句话）。
  const skipWsBack = (k) => { while (k >= 0 && /\s/.test(text[k])) k--; return k; };
  const skipWsFwd = (k) => { while (k < n && /\s/.test(text[k])) k++; return k; };
  for (const hit of out) {
    if (!hit._local) continue;
    const before = skipWsBack(hit._start - 1);
    const after = skipWsFwd(hit._end);
    if (text[before] === '+' || text[after] === '+') { hit.concatAdjacent = true; }
    else {
      for (let k = hit._frames.length - 1; k >= 0; k--) {
        const f = hit._frames[k];
        if (!f || !translateCallees.has(f.callee) || f.endIndex === null) continue;
        const b = skipWsBack(f.parenIndex - 1);
        const a = skipWsFwd(f.endIndex + 1);
        if (text[b] === '+' || text[a] === '+') hit.concatAdjacent = true;
        break;
      }
    }
    delete hit._local; delete hit._start; delete hit._end; delete hit._frames;
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * 视为"诊断/日志"的最内层被调函数名：这些位置的中文不进 UI，不要求翻译。
 * 口径是"**只**去诊断通道"：同时被面板显示的（如 `themeFollowTrace` 的决策留痕）不在册 ——
 * 那种串要翻译；而 `Error(...)` 是程序员错误（id 非法一类），不面向用户。
 */
export const DIAGNOSTIC_CALLEES = new Set([
  'liveLog', 'weLog', 'log', 'warn', 'error', 'debug', 'info', 'trace',
  'console', 'weDiag', 'diag', 'reportDiag', 'reportClientDiag', 'Error',
]);

/** 扫一棵目录树下所有 `.js`（默认排除 node_modules / lib 产物）。 */
export function scanTree(root, options = {}) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const p = join(dir, entry);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (p.endsWith('.js')) files.push(p);
    }
  };
  walk(root);
  const hits = [];
  for (const file of files.sort()) {
    const src = readFileSync(file, 'utf8');
    for (const hit of scanCjkStrings(src, options)) hits.push({ file, ...hit });
  }
  return hits;
}

/** 一条命中是否"必须被翻译"（守卫的判据本体；允许清单在这里只做精确值豁免）。 */
export function needsTranslation(hit, allowValues = new Set()) {
  if (hit.wrapped) return false;
  if (hit.diagnostic) return false;
  if (allowValues.has(hit.value)) return false;
  return true;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
function main(argv) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  if (argv[0] === 'selftest') return selftest();
  const json = argv.includes('--json');
  const all = argv.includes('--all');
  const rest = argv.filter((a) => !a.startsWith('--'));
  const targets = rest.length ? rest : [join(root, 'src')];
  const hits = [];
  for (const t of targets) {
    const abs = resolve(t);
    if (statSync(abs).isDirectory()) hits.push(...scanTree(abs));
    else {
      const src = readFileSync(abs, 'utf8');
      for (const hit of scanCjkStrings(src)) hits.push({ file: abs, ...hit });
    }
  }
  const pending = hits.filter((h) => needsTranslation(h));
  if (json) {
    process.stdout.write(JSON.stringify(all ? hits : pending, null, 1) + '\n');
    return 0;
  }
  const shown = all ? hits : pending;
  console.log(`共 ${hits.length} 条中文字面量；待处理（未包 weT / 非诊断 / 不在允许清单）${pending.length} 条`);
  for (const h of shown) {
    const tag = h.wrapped ? 'weT' : h.diagnostic ? 'diag' : 'TODO';
    const extra = [h.kind === 'template' ? 'template' : '', h.hasInterp ? 'interp' : '', h.concatAdjacent ? 'concat' : '']
      .filter(Boolean).join('+');
    console.log(`  [${tag}] ${h.file.replace(root + '/', '')}:${h.line}:${h.column} ${extra ? '(' + extra + ') ' : ''}${JSON.stringify(h.value.slice(0, 70))}`);
  }
  return 0;
}

/** 正负对照：判据必须能区分"包了/没包/诊断/注释里的中文"。 */
function selftest() {
  const cases = [
    { src: 'x = weT("中文")', want: 0 },
    { src: 'x = "中文"', want: 1 },
    { src: 'x = liveLog("reason", "中文")', want: 0 },
    { src: 'x = f("中文")', want: 1 },
    { src: 'x = weT(f("中文"))', want: 1 },
    { src: 'x = weT(cond ? "甲" : "乙")', want: 0 },
    { src: 'x = weT("共 {n} 张", { n: 3 })', want: 0 },
    { src: '// 中文注释', want: 0 },
    { src: '/* 中文 */', want: 0 },
    { src: 'x = "abc" // 中文', want: 0 },
    { src: 'x = weT("共 ") + n + weT(" 张")', want: 0 },
    { src: 'x = `共 ${n} 张`', want: 1 },
    { src: 'x = `共 ${weT("张")} 张`', want: 1 },
    { src: 'x = weT(`共 ${n} 张`)', want: 1 },
    { src: 'x = weT(`共 张`)', want: 0 },
    { src: 'x = /中[文]/', want: 0 },
    { src: 'createElement("p", { title: "标题" }, "正文")', want: 2 },
  ];
  let failed = 0;
  for (const c of cases) {
    const hits = scanCjkStrings(c.src).filter((h) => needsTranslation(h));
    const ok = hits.length === c.want;
    if (!ok) { failed++; console.log(`  ✗ ${JSON.stringify(c.src)} → ${hits.length}，期望 ${c.want}（${hits.map((h) => h.value).join('|')}）`); }
    else console.log(`  ✓ ${JSON.stringify(c.src)} → ${hits.length}`);
  }
  // 结构性判据：包过的要能被认出"包过"，拼接/模板要各自带标记。
  const shaped = scanCjkStrings('x = weT("共 ") + n + `张${n}`');
  const okShape = shaped.length === 2 && shaped[0].wrapped === true && shaped[0].concatAdjacent === true
    && shaped[1].kind === 'template' && shaped[1].hasInterp === true;
  if (!okShape) { failed++; console.log('  ✗ 标记（wrapped/concat/hasInterp）判定'); }
  else console.log('  ✓ 标记（wrapped/concat/hasInterp）判定');
  console.log(failed ? `selftest FAILED（${failed}）` : 'selftest ok');
  return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
