#!/usr/bin/env node
/**
 * verify-token-contract.mjs — `--dsw-*` 令牌契约**不许烂掉**（共存审计 S2 的守卫）。
 *
 * 守什么：本插件把宿主设计令牌层整层改写成玻璃配方，是全仓最大的隐式耦合面
 * （DSH 官方规范让插件作者用 `--dsw-alias-*` 上色 ⇒ 按规范写的第三方 UI 插件
 * 自动继承我们的玻璃 —— 共存审计 M1）。契约由 `test/tools/token-contract.mjs`
 * 从 `src/styles.js` 现算，本守卫：
 *
 *   ① `docs/TOKEN-CONTRACT.md` 与现算契约**逐字节一致**（增删令牌忘了重算 ⇒ 红）；
 *   ② 覆盖面地板（声明 >100、令牌 >30 —— 解析器静默返回空表时 ① 变成空对空）；
 *   ③ **无门控白名单封闭**：没有门控的 `--dsw-*` 声明只允许落在两处已知语义
 *      （`body[data-we-thinking-native]` 思考块自带开关、`.we-layer` 插件自有元素）；
 *      **新增任何一条无门控改写 ⇒ 红**（这正是审计 M1 说的"看不见的耦合"的止损线）；
 *   ④ `--dsw-alias-bg-base` 必须**全部**挂壁纸门控 —— 壁纸可见性的关键前提归壁纸半边
 *      （审计 §三.3：这是玻璃/壁纸解耦能干净落地的既成事实，钉死防回退）；
 *   ⑤ 解析口径的负对照（注释掩蔽 / var() 读不计 / 跨行声明 / 归桶正确性）——
 *      每条判据都配一个"能失败"的探针，防止判据本身空转。
 *   ⑥ **门控计数自洽**：产物里每个 `标签(N)` 的 N 必须 > 0、N 之和 = 该令牌条数、
 *      组数 = 归并出的桶数。旧版工具拿声明对象比桶名字符串 ⇒ 每格恒 0，而 ① 的逐字节
 *      比对把这个 0 永久冻绿（见 §11 A1-3）。
 *
 * 红了怎么办：令牌集合的**有意**变更跑 `node test/tools/token-contract.mjs --write`
 * 重新生成契约并随代码提交；③ ④ 变红说明出现**新的无门控改写**或 bg-base 挪了门控 ——
 * 先回答"为什么这条可以不挂门控"，再改白名单（改白名单 = 一次可见的评审）。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContract, scanTokenDecls, bucketOf, ungatedReason } from './tools/token-contract.mjs';
import { stripComments } from './tools/js-text.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log('  ✓ ' + name + (detail ? ' — ' + detail : ''));
  else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); failed++; }
};

console.log('\n① 契约与代码一致');
const { decls, tokens, buckets, text } = buildContract();
const doc = readFileSync(join(ROOT, 'docs', 'TOKEN-CONTRACT.md'), 'utf8').replace(/\r\n/g, '\n').trimEnd();
check('docs/TOKEN-CONTRACT.md 与现算的契约一致', doc === text.trimEnd(),
  doc === text.trimEnd()
    ? decls.length + ' 条声明 / ' + tokens.length + ' 个令牌'
    : '不一致 ⇒ 跑 `node test/tools/token-contract.mjs --write`');
// 负对照：把改动后的文本喂给同一条判据，证明它能失败（同源比较的自证）
const sameAsDoc = (t) => t.trimEnd() === text.trimEnd();
const mutated = text.replace(/共 \*\*\d+\*\* 条声明/, '共 **0** 条声明');
check('负对照：契约数字被改动会被判不一致', mutated !== text && sameAsDoc(mutated) === false);
// 覆盖面地板：解析器静默返回空表时 ① 会变成空对空
check('覆盖面地板：声明 >100 且令牌 >30',
  decls.length > 100 && tokens.length > 30,
  decls.length + ' 条 / ' + tokens.length + ' 个');

console.log('\n② 无门控白名单封闭（M1 的止损线）');
{
  const strays = buckets.ungated.filter((d) => !ungatedReason(d.chain));
  check('无门控声明全部落在白名单（thinking-native / .we-layer）', strays.length === 0,
    strays.length ? strays.map((d) => 'styles.js:' + d.line + ' ' + d.token + ' @ ' + d.chain).join(' | ')
      : buckets.ungated.length + ' 条（' + new Set(buckets.ungated.map((d) => d.token)).size + ' 个令牌）');
  // 负对照 1：构造一条无门控声明 ⇒ 分类器必须把它报成白名单外（否则 ② 永远绿）
  const stray = scanTokenDecls('const CSS = `\n  body { --dsw-probe-stray: red; }\n`;\n');
  check('负对照：新增无门控声明会被判出白名单',
    stray.length === 1 && bucketOf(stray[0].chain) === 'ungated' && ungatedReason(stray[0].chain) === null,
    stray.map((d) => d.token + '@' + d.chain).join(','));
  // 负对照 2：挂在玻璃门控下的探针归玻璃桶 —— 证明 ② 不是"把所有声明都当 stray"
  const gated = scanTokenDecls('const CSS = `\n  body[data-we-glass-page] { --dsw-probe-gated: red; }\n`;\n');
  check('负对照：玻璃门控下的声明归玻璃桶（不误伤）',
    gated.length === 1 && bucketOf(gated[0].chain) === 'glass',
    gated.map((d) => d.chain).join(','));
  // 负对照 3：白名单内的探针（thinking-native）判过
  const thinking = scanTokenDecls('const CSS = `\n  body[data-we-thinking-native] [x] { --dsw-probe-think: red; }\n`;\n');
  check('负对照：thinking-native 门控在白名单内（白名单不是空的）',
    thinking.length === 1 && ungatedReason(thinking[0].chain) !== null);
}

console.log('\n②b 独立锚点表（A1：口径不能自己证明自己）');
{
  // ⚠️ 这张表是**人工独立来源**的 oracle，不是跑工具抄结果（抄结果 = 退回 A1）。
  //    期望值逐条从产品/文档约定推出，来源写在 `why` 里：
  //      · 无门控封闭白名单 = thinking-native + `.we-layer` 两处
  //        （docs/COEXISTENCE.md §审计、docs/adr/0010-*:17-19、docs/wip/COEXISTENCE-AUDIT.md:198）；
  //      · 玻璃门 = 链上有 `[data-we-glass-*]`（docs/CHANGELOG.md「页面玻璃锚点 data-we-glass-page」、
  //        docs/HOW-IT-WORKS.md、src/styles.js 的 `body[data-we-glass-page]` 块）；
  //      · 壁纸门 = 只有 `[data-we-wallpaper]`（src/styles.js 里 bg-base/侧栏填充那两条）；
  //      · 契约口径只收 `--dsw-*`（docs/TOKEN-CONTRACT.md 的口径段；`--we-*` 是插件自有变量族）。
  //    工具口径若被放宽（例如把 `:root` 或 `@media` 也当门控/白名单），这张表当场红。
  const ANCHORS = [
    {
      label: '裸 `:root` 里的 `--dsw-*` 声明',
      css: 'const CSS = `\n  :root { --dsw-anchor-root: red; }\n`;\n',
      decls: 1, bucket: 'ungated', reason: null,
      why: '无门控白名单只开 thinking-native 与 `.we-layer` 两处 ⇒ `:root` 既无门控也不在白名单，'
        + '`ungatedReason` 必须为 null（② 会把它判成 stray）—— 这是白名单**封闭性**的锚点',
    },
    {
      label: '顶层 `.we-layer` 里的 `--dsw-*` 声明',
      css: 'const CSS = `\n  .we-layer { --dsw-anchor-layer: red; }\n`;\n',
      decls: 1, bucket: 'ungated', reason: 'we-layer',
      why: '白名单的正向面：`.we-layer` 是插件自有元素（卸载即消失）⇒ 无门控但必须给出理由',
    },
    {
      label: '挂在已知门控选择器 `body[data-we-glass-page]` 下',
      css: 'const CSS = `\n  body[data-we-glass-page] { --dsw-anchor-glass: red; }\n`;\n',
      decls: 1, bucket: 'glass', reason: null,
      why: '`data-we-glass-*` 即玻璃门（src/styles.js 的整页玻璃锚点）⇒ 有门控，`ungatedReason` 为空',
    },
    {
      label: '只挂壁纸门 `body[data-we-wallpaper]`',
      css: 'const CSS = `\n  body[data-we-wallpaper] { --dsw-anchor-wall: red; }\n`;\n',
      decls: 1, bucket: 'wallpaper', reason: null,
      why: '只有 `[data-we-wallpaper]` ⇒ 壁纸桶（bg-base「页面让开」那半边）⇒ 有门控，白名单不适用',
    },
    {
      label: '`@media` 里、没有任何门控选择器的声明',
      css: 'const CSS = `\n  @media (min-width: 1px) { :root { --dsw-anchor-media: red; } }\n`;\n',
      decls: 1, bucket: 'ungated', reason: null,
      why: '既有约定：`@media` 是前提不是门控（bucketOf 只认 `data-we-glass-*` / `data-we-wallpaper`）'
        + '⇒ 该声明仍算无门控且不在白名单 —— 防止「塞进 @media 就绕过封闭白名单」',
    },
    {
      label: '`--we-*` 声明（插件自有变量，不在契约口径内）',
      css: 'const CSS = `\n  body[data-we-wallpaper] { --we-anchor-knob: red; }\n`;\n',
      decls: 0,
      why: '契约口径只收 `--dsw-*` 属性位声明（docs/TOKEN-CONTRACT.md 口径段；styles.js 里 `--we-*` 成族存在）'
        + '⇒ 扫描结果必须是 0 条，`--we-*` 不得混进契约',
    },
  ];
  const anchorProblems = ANCHORS.filter((a) => {
    const ds = scanTokenDecls(a.css);
    if (a.decls === 0) return ds.length !== 0;
    if (ds.length !== a.decls) return true;
    if (bucketOf(ds[0].chain) !== a.bucket) return true;
    return Boolean(ungatedReason(ds[0].chain)) !== Boolean(a.reason);
  }).map((a) => a.label + '（' + a.why + '）');
  check('覆盖面：独立锚点表非空且逐条被工具口径复现',
    ANCHORS.length >= 4 && anchorProblems.length === 0,
    anchorProblems.length ? anchorProblems.join(' | ')
      : ANCHORS.length + ' 条人工锚点全部被口径复现（来源见各条 why）');
}

console.log('\n③ `--dsw-alias-bg-base` 归壁纸半边（审计 §三.3 的关键前提）');
{
  const bg = decls.filter((d) => d.token === '--dsw-alias-bg-base');
  check('bg-base 声明存在且全部挂壁纸门控',
    bg.length > 0 && bg.every((d) => bucketOf(d.chain) === 'wallpaper'),
    bg.map((d) => 'styles.js:' + d.line).join(' + ') + ' → ' +
    bg.map((d) => bucketOf(d.chain)).join(' + '));
  // 负对照：bg-base 若出现在无门控下，必须被判红
  const probe = scanTokenDecls('const CSS = `\n  html { --dsw-alias-bg-base: transparent; }\n`;\n');
  check('负对照：bg-base 出现在无门控下会被判出',
    probe.length === 1 && bucketOf(probe[0].chain) === 'ungated');
}

console.log('\n④ 解析口径负对照（契约的两条根基规则）');
{
  const inComment = scanTokenDecls('const CSS = `\n  body[data-we-glass-page] { /* --dsw-in-comment: red; */ }\n`;\n');
  check('注释里的 `--dsw-…` 声明不计', inComment.length === 0, '实测 ' + inComment.length + ' 条');
  const reads = scanTokenDecls('const CSS = `\n  body { color: var(--dsw-alias-bg-base, #fff); }\n`;\n');
  check('值里的 var(--dsw-…) 是读不是写，不计', reads.length === 0, '实测 ' + reads.length + ' 条');
  const real = scanTokenDecls('const CSS = `\n  body { --dsw-probe-real: red; }\n`;\n');
  check('属性位的真实声明会抓到',
    real.length === 1 && real[0].token === '--dsw-probe-real' && real[0].value === 'red',
    real.map((d) => d.token + '=' + d.value).join(','));
  const multi = scanTokenDecls('const CSS = `\n  body {\n    --dsw-probe-multi: color-mix(in srgb,\n      red, blue);\n  }\n`;\n');
  check('跨行声明计 1 条且起始行正确',
    multi.length === 1 && typeof multi[0].line === 'number',
    '实测 ' + multi.length + ' 条 @ line ' + (multi[0] && multi[0].line));
}

console.log('\n⑤ 口径完整性：CSS 模板外不许有漏网的属性位声明');
{
  const src = readFileSync(join(ROOT, 'src', 'styles.js'), 'utf8');
  // extractCss 的前提：全文件恰好一个 `const CSS = \`` 模板。第二个模板出现时，
  // 工具只会扫第一个 ⇒ 契约静默漏掉新模板里的一切（这条钉住那个前提）。
  const count = (src.match(/const CSS = `/g) || []).length;
  check('styles.js 只有一个 CSS 模板（多模板 ⇒ 契约会静默漏扫）', count === 1, count + ' 个');
  // 模板外（JS 正文 / 字符串）再出现属性位声明，契约口径就漏了它 —— 今天必须为 0。
  const templateOutside = (s) => {
    const open = s.indexOf('const CSS = `');
    const start = open + 'const CSS = `'.length;
    let i = start;
    for (; i < s.length; i++) { if (s[i] === '\\') { i++; continue; } if (s[i] === '`') break; }
    return stripComments(s.slice(0, start) + s.slice(i));
  };
  const strays = templateOutside(src).match(/--dsw-[a-z0-9-]+/g) || [];
  check('CSS 模板外没有 `--dsw-` 提及（声明/写入都会漏出口径）',
    strays.length === 0, strays.length ? strays.slice(0, 3).join(' | ') : '0 处');
  // 负对照：把一条声明放进模板外（甚至行中形态），同一条判据必须判出（否则这条永远绿）
  const probe = templateOutside('const CSS = `body {}`;\nconst extra = `\n  body { --dsw-probe-outside: red; }\n`;');
  const pStrays = probe.match(/--dsw-[a-z0-9-]+/g) || [];
  check('负对照：模板外的 `--dsw-` 会被这条判据判出',
    pStrays.length === 1 && pStrays[0] === '--dsw-probe-outside', '实测 ' + pStrays.length + ' 处');
}

console.log('\n⑥ 门控计数自洽（A1-3：工具曾把每格算成 0，而被 ① 冻绿）');
{
  // 从**产物文本**反解每行：第二格 = 条数，第三格 = `标签(N) [+ 标签(N)]`。判据不认标签，
  // 只认括号里的数 —— 这样工具改了归并口径也不会和这条守卫串通。
  const rowsOf = (docText) => {
    const rows = new Map();
    for (const line of docText.split('\n')) {
      const m = /^\|\s*`([^`]+)`\s*\|\s*(\d+)\s*\|\s*([^|]*?)\s*\|/.exec(line);
      if (m) rows.set(m[1], { count: Number(m[2]), gates: m[3] });
    }
    return rows;
  };
  const gateProblems = (docText, tokenList) => {
    const problems = [];
    const rows = rowsOf(docText);
    for (const t of tokenList) {
      const row = rows.get(t.token);
      if (!row) { problems.push(t.token + ': 全量表里没有它'); continue; }
      if (row.count !== t.decls.length) {
        problems.push(t.token + ': 条数 ' + row.count + ' ≠ 归并出的 ' + t.decls.length);
      }
      const nums = [...row.gates.matchAll(/\((\d+)\)/g)].map((m) => Number(m[1]));
      if (nums.length !== t.buckets.size) {
        problems.push(t.token + ': 门控组数 ' + nums.length + ' ≠ 归并桶数 ' + t.buckets.size);
      }
      if (nums.some((n) => n <= 0)) problems.push(t.token + ': 出现 0 计数（' + row.gates + '）');
      const sum = nums.reduce((a, b) => a + b, 0);
      if (sum !== t.decls.length) {
        problems.push(t.token + ': 门控计数之和 ' + sum + ' ≠ 条数 ' + t.decls.length);
      }
    }
    return problems;
  };
  const problems = gateProblems(text, tokens);
  check('产物里每格门控计数 > 0、之和 = 条数、组数 = 桶数', problems.length === 0,
    problems.length ? problems.slice(0, 3).join(' | ') : tokens.length + ' 个令牌全部自洽');
  // 负对照：从 **⑥ 自己那个解析器（rowsOf）产出的门控计数格**里挑一格改成 0 —— 同一条判据
  // 必须判出（否则它只是"恒真的空转"）。⚠️ 不能拿全文本第一个 `(N)` 下手：那命中的是
  // 说明行「探针 (2)」之类的文字，压根没落在门控格上（A4：探针必须穿过主判据真正用的解析器）。
  // 探针找不到门控格 ⇒ 判红，不许静默通过。
  const gateCellProbe = (docText, tokenList) => {
    const lines = docText.split('\n');
    const rowRe = /^\|\s*`([^`]+)`\s*\|\s*(\d+)\s*\|\s*([^|]*?)\s*\|/;
    for (let i = 0; i < lines.length; i++) {
      const m = rowRe.exec(lines[i]);
      // 只认**全量令牌表**里那几行（tokenList 是 ⑥ 正在核对的那份名单），
      // 别把无门控白名单表的行（第二格是 `styles.js:96`）或说明行当成计数格。
      if (!m || !tokenList.some((t) => t.token === m[1])) continue;
      const gm = /\(([1-9]\d*)\)/.exec(m[3]);
      if (!gm) continue;
      const doctored = lines.slice(0, i).concat(lines[i].replace(gm[0], '(0)'), lines.slice(i + 1)).join('\n');
      return { token: m[1], rowLine: i + 1, gates: m[3], hit: gm[0], doctored };
    }
    return null;
  };
  const probe = gateCellProbe(text, tokens);
  const probeProblems = probe ? gateProblems(probe.doctored, tokens) : [];
  check('负对照：门控计数格被改成 0 会被判出自洽性失败',
    probe !== null && probeProblems.length > 0,
    probe
      ? '探针 全量表第 ' + probe.rowLine + ' 行 `' + probe.token + '` 的门控格「' + probe.gates
        + '」里 ' + probe.hit + ' → 判出 ' + probeProblems.length + ' 处（' + probeProblems[0] + '）'
      : '产物里找不到可下手的门控计数格（探针失效 ⇒ 判红）');
}

console.log('');
if (failed) { console.log(`TOKEN CONTRACT CHECKS FAILED — ${failed} failed`); process.exit(1); }
console.log('ALL TOKEN CONTRACT CHECKS PASSED');
process.exit(0);
