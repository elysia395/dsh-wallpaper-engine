/**
 * audit-guard-teeth.mjs — 守卫"牙齿"普查（**只给候选、不下判决**）。
 *
 * 为什么需要：守卫失效有两种，第二种不会变红 —— **守卫悄悄失去牙齿**：
 *   A. **对照构造了却没被评估**：`controls` 的评估循环排在某个 `controls.push(...)` **之前** ⇒
 *      后推的对照"推了、没人看"。这个形状在任何新写的守卫上都会复发，所以扫描面保留。
 *   B. **log 形式的伪判据**：`console.log('x (expect 1):', n === 1)` 在日志里**像**断言，实际不判
 *      真假 —— 产品改坏了它照样 exit 0。`verify-client.mjs` 对本文件有归零棘轮，
 *      **其余守卫没有** ⇒ 这正是本工具的扫描面。
 *   C. **声明了却零引用的判据/助手**：写了判据函数但没人调（"有守卫、没调用方"）。
 *   D. **恒真写法的最粗形态**：`assert.ok(true)` / `.length >= 0` / `check('…', true)`。
 *   E. **守卫没有"会红"的出口**（只会 `console.log` + `process.exit(0)` ⇒ 永远是绿的）。
 *   F. **朴素剥注释吃掉/改动了真实代码**："判据先剥注释再判"那条纪律的盲点 —— 朴素块注释正则
 *      **不认字符串、行注释与正则字面量**：注释、字符串或正则里出现块注释起始标记（把
 *      `scripts/**`、`test/**`、`docs/*.md` 写进注释，或把 `[/*]` 写进一个正则，就够了）就会从
 *      那里启动一个"块注释"，一路吃到下一个结束标记。单文件最长一段被吃掉 **331 行**
 *      （`test/verify-scene-live.mjs`）。
 *      判据是**精确比较**：同一份文本分别喂给朴素实现与共享的字符串感知实现（`test/tools/js-text.mjs`），
 *      去掉空白后不同即为缺陷。本仓守卫面已统一到共享实现（`verify-module-layout` 规则 ⑦ 钉住）
 *      ⇒ 本条现行含义是"换回朴素剥法会付什么代价"。
 *      影响方向：**只有"守卫 A 剥文件 B"时才挖洞** ⇒ 该看的是**被扫的那一面**。
 *      ⚠️ 本条说明自身就是证据：写这段时注释里出现了字面的结束标记，**当场把这个文件变成语法错误**。
 *
 * **它不是判据，是候选清单** —— 与 `audit-fixture-coverage.mjs` 同一立场：结论要人读。
 * 所以它**不进 `npm run verify`**（CODE-STRUCTURE §4 第 5 条：无 CI 消费者的手动工具住 `test/tools/`）。
 *
 * 已知局限（写在工具头，别让读者以为它是穷尽的）：
 *   ① A 的判据是"**最后一次 push 晚于最后一次评估**"。成对交错（评估、push、评估、push…）里
 *      若最后一次评估仍晚于最后一次 push，就漏报 —— 那种形态要人读。
 *   ② A **按名字认变量，不看作用域** ⇒ 两个不同块里的同名数组（如两处 `offenders`、DOM 替身里
 *      的 `children`）会被并成一条，产出假阳性。输出里带**声明行**就是为了让人一眼识破。
 *   ③ B 比 `verify-client.mjs` 内那条棘轮**更窄**（那条还带 `/expect|应该|必须|不得/` 的词分支）
 *      —— 那个分支在别的文件里命中的几乎全是章节标题。代价：不带运算符的伪判据抓不到。
 *   ③b A **看不见"把数组交给判据函数"**那种评估（`noticeBudgetOk(KINDS, calls, …)`）—— 为了
 *      躲开递归 walker 的假阳性而刻意不收。那种写法会**漏报**，要人读。
 *   ④ C 只认"全文只出现一次"的声明 ⇒ 名字出现在注释/字符串里就不算死（宁可漏报）。
 *   ⑤ D 是**最粗形态**的 grep，不解析语法："恒真得绕一圈"的写法（如对恒空集合做 `.every()`）
 *      它看不见 —— 那类要人读。
 *   ⑥ E 只看"有没有会红的出口"，不看那条出口**是否可达**（`if (failed) exit(1)` 里 `failed`
 *      永不递增也照样算"能红"）。可达性要人读。
 *   ⑦ F 报的是"**这一段被剥注释时会消失**"，不报"这已经造成缺陷" —— 是否有影响取决于
 *      **有没有守卫剥这个文件**（见判据的方向说明）。本工具不追那层，要人接。
 *
 * Usage:  node test/tools/audit-guard-teeth.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// 判据 F 要与共享的字符串感知实现对比（同目录 js-text.mjs）。
import { stripComments } from './js-text.mjs';

// `test/tools/` 比 `test/` 深一层 ⇒ 推仓库根要退**两层**（CODE-STRUCTURE §4 第 5 条；verify-module-layout ④ 有断言）
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// 扫描面 = 守卫面（verify-* 结构守卫 + *-smoke 节点级冒烟）。手动工具自己不算守卫，不扫。
const guardFiles = readdirSync(join(ROOT, 'test'), { withFileTypes: true })
  .filter((e) => e.isFile() && /^(verify-.*|.*-smoke)\.mjs$/.test(e.name))
  .map((e) => 'test/' + e.name)
  .sort();

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

// ── 判据 A：对照集合的最后一次评估是否晚于最后一次 push ────────────────────────
/** 评估点 = 真的在"逐条判真假"的读法；`!IDENT.length` 那种前置检查不算（它不是评估）。 */
// 只收**判真假**形态的方法：`.filter(` / `.map(` / `.reduce(` 是取用与变换，会把"定时器登记表"
// 这类数组算成对照（实测假阳性）。
// ⚠️ **不把"IDENT 当参数传出去"算评估**：本仓到处都是递归 walker
//    `function walkFiles(dir, out = []) { … walkFiles(abs, out); out.push(…) }` ——
//    递归调用会被误当成评估，于是遍地 `out` 假阳性。代价：真正"把数组交给判据函数"
//    （`noticeBudgetOk(KINDS, calls, …)`）的写法看不见 ⇒ **可能漏报**（宁可漏报，不造假阳性）。
const EVAL_METHODS = ['.forEach(', '.every(', '.some('];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function staleControls(src) {
  const lines = src.split('\n');
  // 找出所有以 `IDENT.push(` 形态出现的标识符，并记住它的声明行（同名碰撞时人一眼能看出）
  const idents = new Map();
  lines.forEach((line, i) => {
    if (isComment(line)) return;
    for (const m of line.matchAll(/([A-Za-z_$][\w$]*)\.push\(/g)) {
      if (!idents.has(m[1])) idents.set(m[1], []);
      const decl = new RegExp('(?:const|let|var)\\s+' + esc(m[1]) + '\\s*=');
      if (decl.test(line)) idents.get(m[1]).push(i + 1);
    }
  });
  const out = [];
  // 只认**本文件里用 `const/let/var` 声明过**的名字：`children`（假 DOM 的属性）、`calls`（HTTP 替身
  // 的记录数组）这类"同名不同物"因此直接出局。实测：加这一条之前 7 个候选全是它们。
  const declared = (id) => new RegExp('(?:const|let|var)\\s+' + esc(id) + '\\b').test(src);
  for (const [id, decls] of idents) {
    if (!declared(id)) continue;
    const pushAt = [];
    const evalAt = [];
    lines.forEach((line, i) => {
      if (isComment(line)) return;
      const n = i + 1;
      if (new RegExp('\\b' + esc(id) + '\\.push\\(').test(line)) pushAt.push(n);
      // 评估形态：`for (const … of IDENT)`、`IDENT.forEach(` / `.every(` / `.some(`
      const ofLoop = new RegExp('for\\s*\\(\\s*const\\s+\\[?[^\\]]*\\]?\\s+of\\s+' + esc(id) + '\\b').test(line);
      const method = EVAL_METHODS.some((m) => new RegExp('\\b' + esc(id) + esc(m)).test(line));
      if (ofLoop || method) evalAt.push(n);
    });
    if (!pushAt.length || !evalAt.length) continue;
    const lastPush = Math.max(...pushAt);
    const lastEval = Math.max(...evalAt);
    if (lastPush > lastEval) {
      out.push({ id, decls, lastEval, orphanPushes: pushAt.filter((n) => n > lastEval) });
    }
  }
  return out.sort((a, b) => a.orphanPushes[0] - b.orphanPushes[0]);
}

// ── 判据 B：log 形式的伪判据（**比 verify-client 内那条棘轮更窄**）─────────────────
// verify-client 那条还带一个 `/expect|应该|必须|不得/` 的**词**分支；在别的文件里那个分支命中的
// 几乎全是章节标题（`console.log('\n④ 相对说明符必须解析到真实文件')`）⇒ 假阳性淹没真信号。
// 所以本工具**要求出现比较运算**（`===` `!==` `<` `>` `&&` `||`），并排除两类"不是伪判据"的行：
//   · **汇总**：`console.log(failures === 0 ? 'PASSED' : … 'FAILED')` —— 退出码就取决于同一个计数器，
//     它不是"写在日志里没人看"的判据；
//   · **报告**：`console.log('扫描面：' + ALL.length + …)` —— 只有取值、没有比较。
// 收紧前实测 25 个候选全是这两类；收紧后剩下的才是真信号：`console.log('x (expect 1):', n === 1)`。
// 代价：`console.log('应该等于 3')` 这种不带运算符的伪判据抓不到（那要人读）。
function fakeJudgements(src) {
  const hit = (line) => {
    const t = line.trim();
    if (!/^console\.log\(/.test(t)) return false;
    if (/catch|threw|\.message/.test(t)) return false;
    if (!/(===|!==|<=|>=|&&|\|\|)/.test(t)) return false;   // 只认真比较运算（裸 `<` `>` 会命中散文）
    if (/(?:failures|failed|problems|stray|failedCount)(?:\.length)?\s*===\s*0/.test(t)) return false; // 汇总（可能跨行）
    if (/===\s*0\s*\?/.test(t)) return false;            // 汇总形态：计数 == 0 ? PASS : FAIL
    if (/'(?:ALL[^']*PASSED|[^']*FAILED|OK|PASSED)'/.test(t)) return false; // 汇总文案
    return true;
  };
  return src.split('\n').map((line, i) => ({ n: i + 1, line: line.trim() })).filter((x) => hit(x.line));
}

// ── 判据 E：守卫必须有"会红"的出口 ────────────────────────────────────────────
// 一个只会 `console.log` 与 `process.exit(0)` 的守卫**永远是绿的** —— 它比伪判据更彻底：
// 连"看起来像判据"都没有。判据：存在 `process.exit(1|2)` / `process.exitCode =` / `throw`，
// 或者用了 node `assert`（断言失败即抛）。三者都无 ⇒ 候选。
const CAN_FAIL_RES = [
  // ⚠️ 不能只认 `process.exit(1)`：本仓的常见写法是 `process.exit(failed ? 1 : 0)`（实测 5 处）
  // ⇒ 判据是"`process.exit(` 后面**不是**字面 0"。
  [/process\.exit\(\s*(?!0\s*\))/, 'process.exit(非 0 字面量)'],
  [/process\.exitCode\s*=/, 'process.exitCode ='],
  [/\bthrow\s+new\b/, 'throw new'],
  [/\bassert\.\w+\(/, 'assert.*'],
];
function cannotFail(src) {
  // ⚠️ 必须走**字符串/正则感知**的共享剥离器（`test/tools/js-text.mjs:45-103`）——判据 F（`:177`）存在的
  //    理由就是朴素正则不认字符串与正则字面量：`// 面 = \`test/**\`` 后面再跟一段文档注释，朴素剥法会从
  //    那个 `/*` 一路吃到文档注释的 `*/`，把夹在中间的 `process.exit(...)` 一起删掉，于是"有会红出口"的
  //    守卫被判成恒绿（实测假阳性：`test/verify-i18n.mjs:1`，而该文件 `:433` 就是 `process.exit(failed ? 1 : 0)`）。
  const code = stripComments(src);
  for (const [re] of CAN_FAIL_RES) if (re.test(code)) return null;
  return '既无 process.exit(1|2) / exitCode，也无 throw / assert';
}

// ── 判据 C：声明了却零引用的判据/助手 ──────────────────────────────────────────
// ⚠️ 这里**故意不剥注释**（与"判据先剥注释再判"那条纪律相反），原因实测过：`/\/\*[\s\S]*?\*\//g`
//    会被**夹具里当字符串用的注释语法**带跑 —— 从那个 `/*` 一路吃到下一个 `*/`，把夹在中间的
//    真实代码一起删掉。实测 `verify-module-layout.mjs` 的 `devSpecifiers` 原文出现 4 次，
//    剥完只剩 1 次 ⇒ 被判成死代码（假阳性）。所以：声明在**代码行**上认，计数用**原文**。
//    代价：名字只出现在注释里就算"用过"（宁可漏报）。
function deadDeclarations(src) {
  const lines = src.split('\n');
  const DECL_RES = [
    /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/,
    /^\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/,
  ];
  const decls = [];
  lines.forEach((line, i) => {
    if (isComment(line)) return;
    for (const re of DECL_RES) {
      const m = re.exec(line);
      if (m) decls.push({ name: m[1], at: i + 1 });
    }
  });
  return decls.filter((d) => (src.match(new RegExp('\\b' + d.name + '\\b', 'g')) || []).length === 1);
}

// ── 判据 F：朴素剥注释是否**吃掉/改动了真实代码**（"先剥注释"这条纪律的盲点）────────────
// 朴素块注释正则（本工具保留它是为了**检测**，见文件头）**不认字符串、行注释与正则字面量**：
// 注释、字符串或正则里出现"块注释起始"那两个字符就会从那里启动一个"块注释"，一路吃到下一个
// 结束标记 —— 把中间的真实代码静默删掉（把 `scripts/**`、`test/**`、`docs/*.md` 写进一句注释，
// 或把 `[/*]` 写进一个正则，就够了）。
// 判据是**精确比较**：同一份文本分别喂给朴素实现与共享的字符串感知实现（`test/tools/js-text.mjs`），
// 去掉全部空白后若不同 ⇒ 朴素实现在这份文本上丢掉了真实代码。不再依赖"区间多长 / 起点在不在行首"
// 的启发式（那会把合法地写在中段的文档注释误当成缺陷）。
// 本仓守卫面已统一到共享实现（`test/verify-module-layout.mjs` 规则 ⑦ 钉住）⇒ 本判据现在的含义是
// "换回朴素实现会付什么代价"，而不是"今天有几个文件是坏的"。
function stripSwallows(src) {
  const naive = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  const squeeze = (s) => s.replace(/\s+/g, '');
  const aware = squeeze(stripComments(src));
  const blunt = squeeze(naive);
  if (blunt === aware) return [];
  return [{ n: 0, to: 0, text: '若换回朴素剥法，这份文本会丢掉 ' + (aware.length - blunt.length) + ' 个非空白字符（吃掉真代码，或删改字符串/模板里的内容）' }];
}
// ── 判据 D：恒真写法的最粗形态 ────────────────────────────────────────────────
const TAUTOLOGY_RES = [
  [/\.ok\(\s*true\s*[,)]/, 'assert.ok(true)'],
  [/\.equal\(\s*([A-Za-z_$][\w$.]*)\s*,\s*\1\s*[,)]/, 'assert.equal(x, x)'],
  [/\.length\s*>=\s*0\b/, '.length >= 0'],
  [/check\(\s*(['"`])[^'"`]*\1\s*,\s*true\s*\)/, "check('…', true)"],
];
function tautologies(src) {
  const out = [];
  src.split('\n').forEach((line, i) => {
    if (isComment(line)) return;
    for (const [re, what] of TAUTOLOGY_RES) if (re.test(line)) { out.push({ n: i + 1, what, line: line.trim() }); break; }
  });
  return out;
}

// ── 自检：四个判据各自必须能抓到合成输入（否则工具本身是空转的）──────────────────
const SELF = [
  ['A 能抓到"push 在评估之后"', staleControls([
    'const controls = [];',
    'for (const [w, ok] of controls) { if (!ok) failed++; }',
    'controls.push(["后推的对照", true]);',
  ].join('\n')).length === 1],
  ['A 不误伤"评估在最后"', staleControls([
    'const controls = [];',
    'controls.push(["a", true]);',
    'for (const [w, ok] of controls) { if (!ok) failed++; }',
  ].join('\n')).length === 0],
  ['B 能抓到 log 形式伪判据', fakeJudgements("  console.log('x (expect 1):', n === 1);").length === 1],
  ['B 不误伤真断言与 catch 上报', fakeJudgements([
    "  assert.equal(n, 1, 'x');",
    "  catch (e) { console.log('threw:', e && e.message); }",
  ].join('\n')).length === 0],
  ['C 能抓到零引用声明', deadDeclarations('function neverCalled() {}\n').length === 1],
  ['C 不误伤有引用的声明', deadDeclarations('function used() {}\nused();\n').length === 0],
  ['D 能抓到 assert.ok(true)', tautologies('assert.ok(true);').length === 1],
  ['D 不误伤真判据', tautologies('assert.ok(rows.length === 3);').length === 0],
  ['E 能抓到"只会 log 与 exit(0)"', cannotFail("console.log('ok');\nprocess.exit(0);\n") !== null],
  ['E 不误伤 assert 型守卫', cannotFail("assert.equal(a, b);\nconsole.log('PASSED');\n") === null],
  ['E 不误伤 check+process.exit(1) 型守卫',
    cannotFail("if (failed) process.exit(1);\nconsole.log('PASSED');\n") === null],
  ['E 不误伤 process.exit(failed ? 1 : 0) 型守卫',
    cannotFail("process.exit(failed ? 1 : 0);\n") === null],
  // 对照：注释/字符串里的 `/*` + 后面的 `*/` 之间夹着真退出语句 —— 共享剥离器必须保住那个出口。
  // 朴素剥法会连同出口一起吃掉 ⇒ 这条在换回朴素实现时会红。
  ['E 不误伤"行注释里的 `/*` 与后面的文档注释夹住真出口"',
    cannotFail("// 面 = `test/**`\nif (failed) process.exit(1);\n/** 文档 */\n") === null],
  ['F 能抓到"注释里的 /* 挖出多行空洞"（吃掉真代码）',
    stripSwallows("// 面 = `lib/**`\nconst a = 1;\nconst b = 2;\nconst c = 3;\n/** 正常文档注释 */\n").length === 1],
  ['F 能抓到"正则字面量里的 [/*] 挖出空洞"',
    stripSwallows("const r = /[/*]/g;\nconst a = 1;\n/* 真注释 */\nconst b = 2;\n").length === 1],
  ['F 不误伤纯文档注释（剥了也不丢代码）', stripSwallows("/**\n * 文档\n * 注释\n */\nconst a = 1;\n").length === 0],
  ['F 不误伤"注释只是换了空白"', stripSwallows("const a = 1; // 说明\nconst b = 2;\n").length === 0],
];
let selfFailed = 0;
console.log('自检（四个判据对合成输入都必须有牙）');
for (const [what, ok] of SELF) {
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + what);
  if (!ok) selfFailed++;
}
if (selfFailed) { console.log('\nSELF-CHECK FAILED — 判据本身无牙，候选清单不可信'); process.exit(2); }

// ── 扫描 ─────────────────────────────────────────────────────────────────────
const found = { A: [], B: [], C: [], D: [], E: [], F: [] };
for (const file of guardFiles) {
  const src = read(file);
  for (const x of staleControls(src)) found.A.push({ file, ...x, text: '对照「' + x.id + '」最后一次评估在第 ' + x.lastEval + ' 行，之后还有 push：第 ' + x.orphanPushes.join(',') + ' 行（声明行 ' + (x.decls.length ? x.decls.join(',') : '—未按 const/let/var 声明—') + '）' });
  for (const x of fakeJudgements(src)) found.B.push({ file, n: x.n, text: x.line.slice(0, 118) });
  for (const x of deadDeclarations(src)) found.C.push({ file, n: x.at, text: '声明后全文只出现一次：' + x.name });
  for (const x of tautologies(src)) found.D.push({ file, n: x.n, text: x.what + ' —— ' + x.line.slice(0, 100) });
  const why = cannotFail(src);
  if (why) found.E.push({ file, n: 1, text: why });
  for (const x of stripSwallows(src)) found.F.push({ file, n: x.n, text: x.text });
}

console.log(`\n扫描面：${guardFiles.length} 个守卫（verify-* + *-smoke）`);
const sections = [
  ['A. 对照构造了却没被评估', 'A'],
  ['B. log 形式的伪判据（带比较运算的那些）', 'B'],
  ['C. 声明了却零引用的判据/助手', 'C'],
  ['D. 恒真写法的最粗形态', 'D'],
  ['E. 守卫没有"会红"的出口（永远是绿的）', 'E'],
  ['F. 朴素剥注释在这份文本上的代价面（会丢内容：真代码 / 字符串 / 模板）', 'F'],
];
let total = 0;
for (const [title, key] of sections) {
  const list = found[key];
  total += list.length;
  console.log(`\n${title} —— 候选 ${list.length} 处`);
  for (const x of list) console.log(`  ${x.file}:${x.n}  ${x.text}`);
}
console.log(`\n候选合计 ${total} 处。**这只是候选清单**：逐条读代码再决定是不是缺陷 ——`);
console.log('有的是有意的（如"评估在前、末尾再汇总"），有的要人看才知道（见工具头的四条局限）。');
