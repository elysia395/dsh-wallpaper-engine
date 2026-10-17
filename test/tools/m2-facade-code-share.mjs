// M2 口径：门面 `lib/index.js` 里「非装配代码」的行数占比。
//
// 口径（纯文本、可复算、不引新依赖）：
//   1. 逐字符扫描（跳过字符串/模板/注释/正则字面量）得到每行的净括号增量。
//   2. **顶层语句** = 从列 1 开始（深度 0）、且不是注释/空行的那一行，直到括号深度回 0
//      且语句以非空结束为止。连续空行/注释不切断语句。
//   3. 语句分类：
//        - `assembly`：语句体内出现 `ctx.` / `ctx[`（唯一入口 `apply(ctx, config)` 及其
//          直接操作插件上下文的顶层语句），或出现路由注册调用 `registerXxxRoutes(`。
//        - `code`：其余顶层语句（函数、箭头、对象/数组字面量常量等，全部是"要读的实现"）。
//        - `other`：没有顶层语句归属的行（文件头大注释、import 块、段间空行/注释）。
//   4. 指标：
//        - totalLines                = 文件行数（`split('\n').length - 1`，等价 `wc -l`）
//        - nonAssemblyLines          = code 语句占行数
//        - nonAssemblyShare          = nonAssemblyLines / totalLines
//        - implementationLines       = code + assembly（真正的"实现行"）
//        - implementationShare       = implementationLines / totalLines
//   5. 与计划 §2.1 的 1,396 行并不等价：计划用**手工分段**只圈了 4 段（转码 619 /
//      Steam 发现 457 / 数据目录-config 231 / HTTP body 89），余下函数仍算"门面"。
//      两种口径都写进 `.integration-notes/p0-baseline.md`，并列出计划的 4 段区间复核值。
//
// 段窗（P2-3B）：计划 §3.3 的手工分段原本是**行号硬编码**，门面内容搬移后段内语句行数会变
// 而段的行范围不变（O9）。现在默认走**内容锚点**：每段给一组候选模式（按序取首个命中行），
// 锚点全缺 ⇒ 非 0 退出（拒绝输出可能误导的段表）；段窗按命中行的行序两两配对（末段到 EOF）。
// 想复现计划时代的硬编码段窗（含旧版逐字相同的 stdout）加 `--plan-legacy`。
//
// 用法：
//   node test/tools/m2-facade-code-share.mjs [文件路径] [--list] [--plan-legacy]
//                                           [--self-check] [--self-file=<路径>]
//   · 默认文件 `lib/index.js`（不带参数的行为不变）；`--self-check` 在**被测文件**上断言 P0
//     基线五数 `1974/139/71/1049/373`。被测文件 = 位置参数；没有位置参数时，带 `--self-check`
//     取 `--self-file=`（默认 `.integration-notes/scratch/p02-base-index.js`），否则 `lib/index.js`
//     ⇒ `node … --self-check` 即对 P0 基线自检、打印 `self-check PASS`；
//     `node … lib/index.js --self-check` 会如实 FAIL（lib/index.js 不是基线门面）。
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const list = args.includes('--list');
const legacy = args.includes('--plan-legacy');
const selfCheck = args.includes('--self-check');
const selfFileArg = args.find((a) => a.startsWith('--self-file='));
const selfFile = selfFileArg ? selfFileArg.slice('--self-file='.length) : '.integration-notes/scratch/p02-base-index.js';
// 被测文件：位置参数优先；没有位置参数时，`--self-check` 走基线文件（文件头即真源），
// 其余情况仍是 `lib/index.js` —— 保证「不带参数跑默认分析 lib/index.js」的行为不变。
const positional = args.find((a) => !a.startsWith('--'));
const file = positional || (selfCheck ? selfFile : 'lib/index.js');

const raw = readFileSync(file, 'utf8');
const lines = raw.split('\n');
if (lines[lines.length - 1] === '') lines.pop();
const total = lines.length;

/** 单行净括号增量（跳过注释/字符串/模板/近似正则）。模板字符串里的 ${} 不展开，误差可忽略。 */
function netDepth(line, inBlockStart) {
  let d = 0, i = 0, inBlock = inBlockStart;
  while (i < line.length) {
    const c = line[i], c2 = line.slice(i, i + 2);
    if (inBlock) { if (c2 === '*/') { inBlock = false; i += 2; continue; } i++; continue; }
    if (c2 === '//') break;
    if (c2 === '/*') { inBlock = true; i += 2; continue; }
    if (c === '`' || c === "'" || c === '"') {
      const q = c; i++;
      while (i < line.length) { if (line[i] === '\\') { i += 2; continue; } if (line[i] === q) break; i++; }
      // 模板字符串跨行：本行没闭合就认为闭合（够用，门面里模板不以括号起头）
      i++; continue;
    }
    if (c === '/' && i > 0) {
      const prev = line.slice(0, i).replace(/\s+$/, '').slice(-1);
      if (prev && '(,=:[!&|?{};'.includes(prev)) {
        i++; let cls = false;
        while (i < line.length) {
          if (line[i] === '\\') { i += 2; continue; }
          if (line[i] === '[') cls = true; else if (line[i] === ']') cls = false;
          else if (line[i] === '/' && !cls) break;
          i++;
        }
        i++; continue;
      }
    }
    if (c === '{' || c === '(' || c === '[') d++;
    if (c === '}' || c === ')' || c === ']') d--;
    i++;
  }
  return { d, inBlock };
}

const stmts = [];
let depth = 0, inBlock = false, start = null;
for (let n = 0; n < lines.length; n++) {
  const line = lines[n];
  const trimmed = line.trim();
  const r = netDepth(line, inBlock);
  inBlock = r.inBlock;
  const isComment = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
  const isBlank = trimmed === '';
  const atTop = depth === 0;
  if (start === null) {
    if (atTop && !isComment && !isBlank) { start = n; depth = r.d; }
  } else {
    depth += r.d;
    if (depth <= 0) { stmts.push([start, n]); start = null; depth = 0; }
  }
}
if (start !== null) stmts.push([start, lines.length - 1]);

const assemblyRe = /\bctx\s*[.[]|register[A-Za-z]*Routes\s*\(/;

// 计划 §3.3 的手工分段区间（1-based、闭区间）——硬编码版，只在 `--plan-legacy` 用，
// 用于复核计划的 619/457/231/89 行并逐字复现旧输出。
const LEGACY_PLAN_WINDOWS = [
  ['webShim+seed(:149-206)', 149, 206],
  ['Steam/WE 发现(:207-663)', 207, 663],
  ['数据目录/config(:682-912)', 682, 912],
  ['转码/ffmpeg(:1242-1860)', 1242, 1860],
  ['HTTP body 内核(:2753-2841)', 2753, 2841],
];

// 内容锚点：每段一组候选（按序取该文件里首个命中行）。锚点全部缺失 ⇒ 非 0 退出。
// 候选序 = 计划时代原标记（若有）→ P0 基线标记 → 当代门面里仍在的族内符号。
const PLAN_ANCHORS = [
  { name: 'webShim+seed', res: [/^\s*let webShimCache\b/, /\bshimSeedKit\b/, /\bWEBWALLGL_DIR\b/] },
  { name: 'Steam/WE 发现', res: [/^\s*const STEAM_PROBE_DIRS\b/, /\blocateWallpaperEngineP\b/, /\bisBetterSidebarLoaded\b/] },
  { name: '数据目录/config', res: [/数据目录\s*\/\s*config/, /^\s*function pluginDataDir\s*\(/, /\breadSettings\b/] },
  { name: '转码/ffmpeg', res: [/Frame-skip transcode/, /\bgenerateVideoPreview\b/, /\btranscodeKit\b/] },
  { name: 'HTTP body 内核', res: [/\bCONTROL_JSON_MAX_BYTES\b/] },
];

/** 解析锚点：返回 [{name, line}] 与缺失清单。 */
function resolveAnchors(allLines) {
  const found = [], missing = [];
  for (const seg of PLAN_ANCHORS) {
    let hit = null;
    for (const re of seg.res) {
      const i = allLines.findIndex((l) => re.test(l));
      if (i >= 0) { hit = { line: i + 1, pat: String(re) }; break; }
    }
    if (hit) found.push({ name: seg.name, line: hit.line, pat: hit.pat });
    else missing.push({ name: seg.name, res: seg.res.map(String) });
  }
  return { found, missing };
}

let planSegments;
if (legacy) {
  planSegments = LEGACY_PLAN_WINDOWS.map(([name, s, e]) => ({ label: name, s, e }));
} else {
  const { found, missing } = resolveAnchors(lines);
  if (missing.length > 0) {
    for (const m of missing) {
      console.error(`[anchor-missing] 段「${m.name}」：候选 ${m.res.join(' | ')} 在本文件全部未命中`);
    }
    console.error(`[anchor-missing] ${missing.length} 个段窗锚点定位失败 —— 拒绝输出可能误导的段表；` +
      `要复现计划时代的硬编码段窗请加 --plan-legacy`);
    process.exit(2);
  }
  const sorted = [...found].sort((a, b) => a.line - b.line);
  const planOrder = found.map((f) => f.name).join(' > ');
  const lineOrder = sorted.map((f) => f.name).join(' > ');
  if (planOrder !== lineOrder) {
    console.error(`[anchor-order] 计划序(${planOrder}) ≠ 行序(${lineOrder}) —— 段窗按行序两两配对`);
  }
  planSegments = sorted.map((seg, i) => ({
    label: `${seg.name}(anchor@${seg.line})`,
    s: seg.line,
    e: i + 1 < sorted.length ? sorted[i + 1].line - 1 : total,
  }));
}

let codeLines = 0, assemblyLines = 0, importLines = 0;
const rows = [];
for (const [a, b] of stmts) {
  const body = lines.slice(a, b + 1).join('\n');
  const head = lines[a];
  const isImport = /^import\s/.test(head.trim());
  const kind = isImport ? 'import' : (assemblyRe.test(body) ? 'assembly' : 'code');
  const len = b - a + 1;
  if (kind === 'code') codeLines += len;
  else if (kind === 'assembly') assemblyLines += len;
  else importLines += len;
  rows.push({ start: a + 1, end: b + 1, len, kind, head: head.slice(0, 70) });
}
// ⚠️ 这里曾有一个 `const implCode = codeLines;` 的死别名（全仓 grep 只此一处、没有任何断言读它）
// —— 它被 `no-unused-vars` 判红。语义等价的名字是 `codeLines`（下面 :196/:203/:215 都用它，
// 且 `EXPECT.nonAssemblyLines` 就是它的期望值），所以直接删掉别名而不是加豁免。
let planStatementLines = 0;
const planSegments2 = [];
for (const p of planSegments) {
  const inSeg = rows.filter((r) => r.start >= p.s && r.end <= p.e);
  const covered = inSeg.reduce((acc, r) => acc + r.len, 0);
  planStatementLines += covered;
  planSegments2.push({ label: p.label, s: p.s, e: p.e });
  // 区间内被"语句"占用的行（与 covered 相同口径，后者对相邻语句不重复计数）
  console.log(`planSegment ${p.label}\trangeLines=${p.e - p.s + 1}\tstatements=${inSeg.length}\tstatementLines=${covered}\tgapLines=${(p.e - p.s + 1) - covered}`);
}
const inAnyPlan = (r) => planSegments2.some((p) => r.start >= p.s && r.end <= p.e);
const codeOutOfPlan = rows.filter((r) => r.kind === 'code' && !inAnyPlan(r));
const codeOutLines = codeOutOfPlan.reduce((a, r) => a + r.len, 0);
console.log(`codeStatementLines=${codeLines}\tplanStatementLines=${planStatementLines}\tcodeOutsidePlan=${codeOutLines} (${codeOutOfPlan.length} statements)`);
const impl = codeLines + assemblyLines;
const pct = (x) => (x / total * 100).toFixed(1) + '%';
console.log(`file=${file}`);
console.log(`totalLines=${total}`);
console.log(`topLevelStatements=${stmts.length}`);
console.log(`importLines=${importLines}\timportShare=${pct(importLines)}`);
console.log(`nonAssemblyLines=${codeLines}\tnonAssemblyShare=${pct(codeLines)}`);
console.log(`assemblyLines=${assemblyLines}\tassemblyShare=${pct(assemblyLines)}`);
console.log(`implementationLines=${impl}\timplementationShare=${pct(impl)}`);
console.log(`otherLines=${total - impl - importLines}\totherShare=${pct(total - impl - importLines)}`);
if (list) {
  console.log('--- top-level statements (start-end len kind | head) ---');
  for (const r of rows) console.log(`${r.start}-${r.end}\t${r.len}\t${r.kind}\t${r.head}`);
}

if (selfCheck) {
  // P0 基线门面（`.integration-notes/scratch/p02-base-index.js`）的自检五数。
  const EXPECT = { totalLines: 1974, topLevelStatements: 139, importLines: 71, nonAssemblyLines: 1049, assemblyLines: 373 };
  const actual = { totalLines: total, topLevelStatements: stmts.length, importLines, nonAssemblyLines: codeLines, assemblyLines };
  const bad = Object.keys(EXPECT).filter((k) => EXPECT[k] !== actual[k]);
  const got = Object.keys(EXPECT).map((k) => actual[k]).join('/');
  if (bad.length === 0) {
    console.log(`self-check PASS ${got} (${file})`);
  } else {
    console.log(`self-check FAIL ${got} (期望 ${Object.values(EXPECT).join('/')}; 差异字段 ${bad.join(',')})`);
    process.exit(1);
  }
}
