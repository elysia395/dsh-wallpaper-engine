#!/usr/bin/env node
/**
 * ci-routing-selftest.mjs —— CI 变更分类器 / 文档快通道判据的**纯函数自检**（表驱动、零 I/O）。
 *
 * ## 为什么需要它
 * `test/tools/ci-routing.mjs` 决定「这一次 CI 跑不跑重活」。在此之前它**零判据覆盖**：
 * 白名单写宽了、引用按仓库根而不是文档所在目录解析、二进制素材被当 UTF-8 扫、
 * 符号链接被当成普通 Markdown —— 这四类错法都能让门禁静默少跑，而且**没有任何一条测试会红**。
 * 本文件把每类错法变成一行表项：**喂合成输入，断言分类/发现**。不读盘、不 spawn、无副作用，
 * 所以它在任何沙箱里都能跑，也正是它该有的形态（判据是纯函数，就用纯函数验）。
 *
 * ## 表的读法
 * 每条 `{ name, entries | text, expect }`：
 *   · `expect.mode` —— 分类结果（`docs` / `docs-assets` / `full`）；
 *   · `expect.reason` —— 命中的理由里必须出现的关键词（证明**为什么**是 full，而不只是结果碰巧）；
 *   · `expect.findings` —— `auditDocs` 的发现条数 / 种类。
 * 表项**只增不减**：删掉一条等于删掉一类错法的防线。
 *
 * Usage:  node test/tools/ci-routing-selftest.mjs
 */
import {
  MODE_DOCS, MODE_DOCS_ASSETS, MODE_NOTICE, MODE_FULL, MODES,
  DIFF_FLOOR, DOC_ROOT_FILES, GENERATED_CONTRACTS,
  classify, parseNameStatus, parseRawDiff, judgeResult,
  docReferences, conflictMarkers, trailingWhitespace, auditDocs,
} from './ci-routing.mjs';
import { collectDiff, parseArgs } from '../../scripts/ci-routing.mjs';

let failed = 0;
let passed = 0;
const check = (name, ok, detail) => {
  if (ok) { passed += 1; console.log('  ✓ ' + name + (detail ? ' — ' + detail : '')); }
  else { failed += 1; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
};
const eq = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected),
  '期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual));

const E = (status, path, extra) => ({ status, path, ...(extra || {}) });

// ── ① 分类：白名单的边界（宽一格就少跑一条门禁）────────────────────────────────
const CLASSIFY_CASES = [
  { name: '根目录 README 单独改动 ⇒ docs', entries: [E('M', 'README.md')], mode: MODE_DOCS },
  { name: '根目录 README.en.md ⇒ docs（不是白名单外）', entries: [E('M', 'README.en.md')], mode: MODE_DOCS },
  { name: '根目录 README.beginner.md ⇒ docs', entries: [E('M', 'README.beginner.md')], mode: MODE_DOCS },
  { name: 'CONTRIBUTING.md ⇒ docs', entries: [E('M', 'CONTRIBUTING.md')], mode: MODE_DOCS },
{ name: 'AGENTS.md ⇒ docs', entries: [E('M', 'AGENTS.md')], mode: MODE_DOCS },
  { name: 'docs/ 子目录 Markdown ⇒ docs', entries: [E('M', 'docs/DEV-GUIDE.md')], mode: MODE_DOCS },
  { name: '展示素材图片 ⇒ docs-assets', entries: [E('M', 'assets/readme/hero-dark.png')], mode: MODE_DOCS_ASSETS },
  { name: 'docs + 展示素材 ⇒ docs-assets', entries: [E('M', 'docs/README.md'), E('M', 'assets/readme/hero-dark.png')], mode: MODE_DOCS_ASSETS },
  { name: '排版源稿 SOURCES.md ⇒ docs-assets', entries: [E('M', 'assets/readme/SOURCES.md')], mode: MODE_DOCS_ASSETS },
  { name: 'layout 源稿 hero.html ⇒ docs-assets', entries: [E('M', 'assets/readme/hero.html')], mode: MODE_DOCS_ASSETS },
  { name: 'metadata.json ⇒ docs-assets', entries: [E('M', 'assets/readme/metadata.json')], mode: MODE_DOCS_ASSETS },
  { name: 'assets/readme 里的字体 ⇒ full（二进制，不是展示素材）', entries: [E('M', 'assets/readme/Jersey20-Regular.ttf')], mode: MODE_FULL, reason: '白名单外' },
  { name: 'assets/readme 里的未知后缀 ⇒ full（不按前缀放行）', entries: [E('M', 'assets/readme/notes.xyz')], mode: MODE_FULL, reason: '白名单外' },
  { name: 'assets/about 的图片 ⇒ full（不是文档素材）', entries: [E('M', 'assets/about/sponsor-fish.png')], mode: MODE_FULL, reason: '白名单外' },
  { name: '代码改动 ⇒ full', entries: [E('M', 'lib/index.js')], mode: MODE_FULL, reason: '白名单外' },
  { name: 'docs 里的 .mjs（文档目录不是代码豁免）⇒ full', entries: [E('M', 'docs/tool.mjs')], mode: MODE_FULL, reason: '白名单外' },
  { name: '删除 ⇒ full（路径边界不可信）', entries: [E('D', 'docs/OLD.md')], mode: MODE_FULL, reason: '非新增/修改' },
  { name: '重命名 ⇒ full', entries: [E('R', 'docs/NEW.md', { oldPath: 'docs/OLD.md' })], mode: MODE_FULL, reason: '非新增/修改' },
  { name: '未知状态 ⇒ full', entries: [E('X', 'docs/README.md')], mode: MODE_FULL, reason: '非新增/修改' },
  { name: '空差异 ⇒ full（取不到差异不豁免）', entries: [], mode: MODE_FULL, reason: '差异为空' },
  { name: '差异超过地板 ⇒ full', entries: Array.from({ length: DIFF_FLOOR + 1 }, (_, i) => E('M', 'docs/f' + i + '.md')), mode: MODE_FULL, reason: '地板' },
  { name: '机器派生契约 ⇒ full（判据不给自己免检）', entries: [E('M', 'docs/GUARD-MAP.md')], mode: MODE_FULL, reason: '机器派生契约' },
  { name: 'package.json ⇒ full', entries: [E('M', 'package.json')], mode: MODE_FULL, reason: '包清单' },
  { name: 'CI 接线 ⇒ full', entries: [E('M', '.github/workflows/verify.yml')], mode: MODE_FULL, reason: 'CI 接线' },
  { name: '符号链接（mode 120000）冒充 Markdown ⇒ full', entries: [E('A', 'docs/sneaky.md', { newMode: '120000' })], mode: MODE_FULL, reason: '符号链接' },
  { name: '普通文件 mode 100644 的 Markdown ⇒ docs（mode 不误伤）', entries: [E('M', 'docs/README.md', { newMode: '100644' })], mode: MODE_DOCS },
];

for (const c of CLASSIFY_CASES) {
  const got = classify(c.entries);
  eq(c.name, got.mode, c.mode);
  if (c.reason) {
    check(c.name + '（理由可追溯）', got.reasons.some((r) => r.includes(c.reason)),
      '理由里必须有「' + c.reason + '」：' + got.reasons.join(' | '));
  }
}
check('MODES 恰为四条路径（docs / docs-assets / notice / full）',
  JSON.stringify(MODES) === JSON.stringify([MODE_DOCS, MODE_DOCS_ASSETS, MODE_NOTICE, MODE_FULL]), MODES.join('/'));
check('GENERATED_CONTRACTS 不含不存在的 docs/ARCHITECTURE.md',
  !GENERATED_CONTRACTS.includes('docs/ARCHITECTURE.md'), GENERATED_CONTRACTS.join(' '));
check('DOC_ROOT_FILES 覆盖三个根 README',
  ['README.md', 'README.en.md', 'README.beginner.md'].every((f) => DOC_ROOT_FILES.includes(f)), DOC_ROOT_FILES.join(' '));

// ── ② 差异解析：-z 形态与 --raw 形态（路径带空格 / 模式位）────────────────────────
eq('name-status -z 解析：A/M/D 与带空格路径',
  parseNameStatus('M\0docs/a b.md\0A\0docs/c.md\0D\0lib/x.js\0'),
  [{ status: 'M', path: 'docs/a b.md', oldPath: '' }, { status: 'A', path: 'docs/c.md', oldPath: '' }, { status: 'D', path: 'lib/x.js', oldPath: '' }]);
eq('name-status -z 解析：重命名占三段',
  parseNameStatus('R100\0docs/old.md\0docs/new.md\0'),
  [{ status: 'R', path: 'docs/new.md', oldPath: 'docs/old.md' }]);
eq('--raw -z 解析：模式位随条目带出',
  parseRawDiff(':100644 100644 50dc20e e566c38 M\0docs/CHANGELOG.md\0:000000 120000 0000000 1ca0cf4 A\0docs/sneaky.md\0'),
  [{ status: 'M', path: 'docs/CHANGELOG.md', oldPath: '', oldMode: '100644', newMode: '100644' },
    { status: 'A', path: 'docs/sneaky.md', oldPath: '', oldMode: '000000', newMode: '120000' }]);

// ── ③ 引用抽取：外链 / 锚点 / 绝对路径不核对 ────────────────────────────────────
eq('Markdown 图片与链接', docReferences('![a](assets/readme/x.png) 与 [b](../docs/y.md)'),
  ['assets/readme/x.png', '../docs/y.md']);
eq('HTML src/href', docReferences('<img src="a.png"><a href="b.md">'), ['a.png', 'b.md']);
eq('外链 / 锚点 / 绝对路径 / data URI 跳过',
  docReferences('[a](https://x) [b](#sec) [c](/abs) [d](data:image/png;base64,AA) [e](mailto:a@b)'), []);
eq('带 # 片段与查询串的引用被裁掉', docReferences('[a](x.md#L1) [b](y.png?v=2)'), ['x.md', 'y.png']);

// ── ④ 冲突标记：`=======` 不是冲突（与 workflow 同一条判据）──────────────────────
check('冲突标记只认两侧（<<<<<<< / >>>>>>>）',
  conflictMarkers('<<<<<<< HEAD\na\n=======\nb\n>>>>>>> other\n').map((m) => m.line).join(',') === '1,5',
  '行号 ' + conflictMarkers('<<<<<<< HEAD\na\n=======\nb\n>>>>>>> other\n').map((m) => m.line).join(','));
check('setext 标题的 ====== 不误报', conflictMarkers('标题\n=======\n').length === 0, '');
eq('尾随空白逐行', trailingWhitespace('a\nb  \nc\t\n'), [{ line: 2 }, { line: 3 }]);

// ── ⑤ auditDocs：引用按**文档所在目录**解析（D1 的牙）───────────────────────────
const fakeFs = (files) => ({
  read: (p) => (Object.prototype.hasOwnProperty.call(files, p) ? files[p] : null),
  exists: (spec, baseDir) => Object.prototype.hasOwnProperty.call(files, baseDir ? baseDir + '/' + spec : spec)
    || Object.prototype.hasOwnProperty.call(files, spec),
  sizeOf: (p, baseDir) => {
    const key = baseDir ? baseDir + '/' + p : p;
    return Object.prototype.hasOwnProperty.call(files, key) ? Buffer.byteLength(files[key]) : 0;
  },
});

{
  // 子目录文档引用同级文件：按仓库根解析会误报缺失，按文档所在目录解析才对。
  const fs1 = fakeFs({ 'docs/README.md': '[x](CHANGELOG.md)\n', 'docs/CHANGELOG.md': '# c\n' });
  const r = auditDocs({ entries: [E('M', 'docs/README.md')], ...fs1 });
  check('子目录 Markdown 的相对引用按所在目录解析（不再误报缺失）',
    r.findings.length === 0 && r.counts.missingRefs === 0, JSON.stringify(r.findings));
}
{
  const fs2 = fakeFs({ 'docs/README.md': '[x](MISSING.md)\n' });
  const r = auditDocs({ entries: [E('M', 'docs/README.md')], ...fs2 });
  check('真的缺失仍然报 missing-ref', r.counts.missingRefs === 1
    && r.findings.some((f) => f.kind === 'missing-ref'), JSON.stringify(r.findings));
}
{
  // 二进制素材不按 UTF-8 扫：PNG 的尾随空白/替换字符都是噪声。
  const png = '\uFFFD\uFFFD  \n\uFFFD';
  const fs3 = fakeFs({ 'assets/readme/x.png': png });
  const r = auditDocs({ entries: [E('M', 'assets/readme/x.png')], ...fs3 });
  check('图片不按文本扫描（零 trailing-ws / 零 conflict）', r.findings.length === 0, JSON.stringify(r.findings));
}
{
  const fs4 = fakeFs({ 'assets/readme/x.png': '' });
  const r = auditDocs({ entries: [E('M', 'assets/readme/x.png')], ...fs4 });
  check('0 字节展示素材 ⇒ asset-empty', r.findings.some((f) => f.kind === 'asset-empty'), JSON.stringify(r.findings));
}
{
  const fs5 = fakeFs({ 'docs/data.json': '{bad' });
  const r = auditDocs({ entries: [E('M', 'docs/data.json')], ...fs5 });
  check('JSON 不合法 ⇒ json 发现', r.findings.some((f) => f.kind === 'json'), JSON.stringify(r.findings));
}
{
  const fs6 = fakeFs({ 'docs/notes.txt': 'a  \n' });
  const r = auditDocs({ entries: [E('M', 'docs/notes.txt')], ...fs6 });
  check('非 Markdown 文本仍查尾随空白', r.findings.some((f) => f.kind === 'trailing-ws'), JSON.stringify(r.findings));
}
{
  const fs7 = fakeFs({ 'docs/README.md': 'a  \n' });
  const r = auditDocs({ entries: [E('M', 'docs/README.md')], ...fs7 });
  check('Markdown 的行尾双空格是换行语义 ⇒ 不查尾随空白', r.findings.length === 0, JSON.stringify(r.findings));
}
{
  // 路径越界：引用爬出仓库的，必须由探针拒绝（CLI 的 exists 会做包含性检查）。
  const calls = [];
  auditDocs({
    entries: [E('M', 'docs/README.md')],
    read: () => '[x](../../etc/passwd)\n',
    exists: (spec, baseDir) => { calls.push([spec, baseDir]); return false; },
    sizeOf: () => 0,
  });
  check('越界引用交给探针裁决（baseDir 一并传入）',
    calls.length === 1 && calls[0][1] === 'docs', JSON.stringify(calls));
}

// ── ⑥ ci/result 汇总判据：失败 / 取消 / 跳过 / 缺失 / 未知 mode 一律不放行 ──────────
// 这条判据的失败方式最贵：一旦它放行了没真跑过的作业，分支保护上那颗绿勾就是假的。
// 所以每条表项都写成「一个必须红的形态」，而不是「一个大概能过的形态」。
const RESULT_CASES = [
  { name: 'docs 路径：changes + docs 都 success、full 按 if 跳过 ⇒ 放行',
    input: { mode: MODE_DOCS, jobs: { changes: 'success', docs: 'success', full: 'skipped' } }, ok: true },
  { name: 'docs-assets 路径同理（同一个 docs 作业服务两条轻路径）⇒ 放行',
    input: { mode: MODE_DOCS_ASSETS, jobs: { changes: 'success', docs: 'success', full: 'skipped' } }, ok: true },
  { name: 'full 路径：changes + full 都 success、docs 跳过 ⇒ 放行',
    input: { mode: MODE_FULL, jobs: { changes: 'success', full: 'success', docs: 'skipped' } }, ok: true },
  { name: 'docs 路径但 docs 作业失败 ⇒ 不放行',
    input: { mode: MODE_DOCS, jobs: { changes: 'success', docs: 'failure', full: 'skipped' } }, ok: false, reason: 'failure' },
  { name: 'docs 路径但 docs 作业被取消 ⇒ 不放行',
    input: { mode: MODE_DOCS, jobs: { changes: 'success', docs: 'cancelled', full: 'skipped' } }, ok: false, reason: 'cancelled' },
  { name: 'docs 路径但 docs 作业意外跳过 ⇒ 不放行（跳过不等于通过）',
    input: { mode: MODE_DOCS, jobs: { changes: 'success', docs: 'skipped', full: 'skipped' } }, ok: false, reason: '跳过' },
  { name: 'docs 路径但 docs 结果缺失 ⇒ 不放行',
    input: { mode: MODE_DOCS, jobs: { changes: 'success', full: 'skipped' } }, ok: false, reason: '缺失' },
  { name: 'changes 自己失败 ⇒ 不放行（分类都没成，路径不可信）',
    input: { mode: MODE_DOCS, jobs: { changes: 'failure', docs: 'success', full: 'skipped' } }, ok: false, reason: 'changes' },
  { name: 'full 路径但 full 失败 ⇒ 不放行',
    input: { mode: MODE_FULL, jobs: { changes: 'success', full: 'failure', docs: 'skipped' } }, ok: false, reason: 'failure' },
  { name: 'full 路径但 full 缺失 ⇒ 不放行（旧工作流形态）',
    input: { mode: MODE_FULL, jobs: { changes: 'success' } }, ok: false, reason: '缺失' },
  { name: 'mode 为空 ⇒ 不放行（outputs 没接上时不能默认文档）',
    input: { mode: '', jobs: { changes: 'success', docs: 'success' } }, ok: false, reason: '未登记' },
  { name: 'mode 是没登记过的值 ⇒ 不放行',
    input: { mode: 'fast', jobs: { changes: 'success', docs: 'success' } }, ok: false, reason: '未登记' },
  { name: '必需作业都成功，但另一条腿跑起来并失败 ⇒ 不放行（状态自相矛盾）',
    input: { mode: MODE_DOCS, jobs: { changes: 'success', docs: 'success', full: 'failure' } }, ok: false, reason: 'failure' },
];
for (const c of RESULT_CASES) {
  const got = judgeResult(c.input);
  check('ci/result 判据：' + c.name, Boolean(got.ok) === c.ok,
    '期望 ok=' + c.ok + '，实际 ' + JSON.stringify(got.reasons || []));
  if (c.reason) {
    check('ci/result 判据：' + c.name + '（理由可追溯）',
      (got.reasons || []).some((r) => r.includes(c.reason)), (got.reasons || []).join(' | '));
  }
}

// ── ⑦ collectDiff 的差异边界（合成 git，零 spawn）────────────────────────────────
// force-push 场景：PR 需要的是 merge-base 完整差异；push 的 before/after 是**精确范围**。
// 反例拓扑（captain 裁定，与 E2E force 幕同图）：
//   共同祖先 A **没有** app/index.js；before 分支独有提交**新增** app/index.js；
//   after 从 A 只改文档、仍没有 app/index.js。merge-base(before, after)=A：
//   A→after 只见文档 ⇒ merge-base 通道判 docs 是**真实的误判**（把 before→after 的
//   代码删除算漏）；exact 通道按 before→after 原样 diff ⇒ 删除被看见 ⇒ full。
const Z40 = '0'.repeat(40);
const MB_COMMIT = 'a'.repeat(40); // merge-base(before, after) 的结果（= 共同祖先 A）
const FORCE_BASE_DIFF = ':000000 100644 ' + Z40 + ' ' + Z40 + ' A\0docs/story.md\0';
const FORCE_EXACT_DIFF = ':000000 100644 ' + Z40 + ' ' + Z40 + ' D\0app/index.js\0';
/** 合成 git：按调用序列回放（命中后移除该项，防止同键误回放）。 */
function frozenGit(calls) {
  const list = calls.slice();
  return (args) => {
    const key = args.join(' ');
    const hit = list.find((c) => c.call === key || c.call === '*' );
    const idx = list.indexOf(hit);
    if (idx !== -1) list.splice(idx, 1);
    if (!hit) return { ok: false, out: '', err: '合成 git：未编排的调用 ' + key };
    return hit.reply({ args });
  };
}
{
  const calls = [
    { call: 'merge-base A B', reply: () => ({ ok: true, out: MB_COMMIT + '\n' }) },
    { call: 'diff --raw -z --no-renames ' + MB_COMMIT + ' B', reply: () => ({ ok: true, out: FORCE_BASE_DIFF }) },
  ];
  const mbMode = collectDiff({ git: frozenGit(calls), base: 'A', head: 'B', root: '/synthetic' });
  check('collectDiff（合成）：merge-base 通道在 force-push 拓扑下漏掉代码删除 ⇒ 误判 docs（反例成立，需 exact 通道修复）',
    mbMode.ok === true && mbMode.entries.length === 1 && mbMode.entries[0].path === 'docs/story.md',
    JSON.stringify(mbMode.entries || []));
  // 漏算的完整语义：把 merge-base 通道拿到的差异喂给分类本体 ⇒ docs（误放行形态闭环，
  // 不只停在 collectDiff 的 entries 层）。
  const mbClassified = classify(mbMode.entries);
  check('collectDiff（合成）：merge-base 通道的差异过分类本体 ⇒ docs（漏删除误放行闭环）',
    mbClassified.mode === 'docs',
    'mode=' + mbClassified.mode + ' reasons=' + JSON.stringify((mbClassified.reasons || []).slice(0, 2)));

  const callsExact = [
    { call: 'diff --raw -z --no-renames A B', reply: () => ({ ok: true, out: FORCE_EXACT_DIFF }) },
  ];
  const exactMode = collectDiff({ git: frozenGit(callsExact), base: 'A', head: 'B', root: '/synthetic', baseMode: 'exact' });
  check('collectDiff：--base-mode exact 跳过 merge-base 按 before→after 原样 diff ⇒ 删除的代码进差异（full）',
    exactMode.ok === true && exactMode.entries.length === 1 && exactMode.entries[0].path === 'app/index.js',
    JSON.stringify(exactMode.entries || []));

  check('collectDiff：缺省（不给 baseMode）保持 merge-base 语义（PR 路径不因 push 修复而变）',
    collectDiff({ git: frozenGit([
      { call: 'merge-base A B', reply: () => ({ ok: true, out: MB_COMMIT + '\n' }) },
      { call: 'diff --raw -z --no-renames ' + MB_COMMIT + ' B', reply: () => ({ ok: true, out: '' }) },
    ]), base: 'A', head: 'B', root: '/synthetic' }).baseRef === MB_COMMIT,
    'baseRef 必须是 merge-base 输出而非 base 原文');
}
{
  // --base-mode 参数：值参数、只认两值；PR 场景不传（缺省 merge-base），push 场景传 exact。
  const good = parseArgs(['check', '--base-mode', 'exact']);
  check('parseArgs：--base-mode exact 被接受', good.errors.length === 0 && good.baseMode === 'exact',
    JSON.stringify(good.errors));
  const inline = parseArgs(['check', '--base-mode=merge-base']);
  check('parseArgs：--base-mode=merge-base（= 形态）被接受', inline.errors.length === 0 && inline.baseMode === 'merge-base',
    JSON.stringify(inline.errors));
  const bad = parseArgs(['check', '--base-mode', 'wild']);
  check('parseArgs：--base-mode 未知取值 ⇒ 参数错误', bad.errors.some((e) => e.includes('base-mode')),
    JSON.stringify(bad.errors));
  const missing = parseArgs(['check', '--base-mode']);
  check('parseArgs：--base-mode 缺值 ⇒ 参数缺值', missing.errors.some((e) => e.includes('缺值')),
    JSON.stringify(missing.errors));
}

console.log('');
if (failed) {
  console.log('CI ROUTING SELFTEST FAILED：' + failed + ' 条失败 / ' + (failed + passed) + ' 条');
  process.exit(1);
}
console.log('CI ROUTING SELFTEST PASSED (' + passed + ')');
