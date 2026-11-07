#!/usr/bin/env node
/**
 * verify-notice-routing.mjs —— **公告快通道**（CI 的 `notice` 模式）的判据守卫。
 *
 * ## 守的是什么实害
 * `notice` 是**绕过全量验证链**的一条捷径：只改更新公告文案的提交不跑全量守卫。
 * 它比文档快通道更危险，因为公告住在 `src/client.js`（整份浏览器半边）与
 * `src/i18n/i18n-copy-ext.js`（词表域）里 —— **判据一旦写宽，等于让整份客户端免检**。
 * 最坏的失效形态是"看起来在判，其实恒真"：标记切不出来 ⇒ before/after 都是空串 ⇒
 * 逐字节比对恒等 ⇒ 任何代码改动都被放行。
 *
 * 所以这份守卫的第一要务是**证明判据有牙**：每一条放行条件都配一条负对照，喂合成输入
 * 给**同一个** `judgeNoticeEdit`，断言它判红。
 *
 * ## 判据面
 *   ① `noticeSkeleton` 与 `test/tools/js-text.mjs` 的 `stripComments + blankStringLiterals`
 *      在同一批输入上**逐字节一致**（两份实现不许漂：漂了就是"判据自己另立一套语义"）；
 *   ② `sliceNoticeBlock` 的边界：正常切分 / 缺标记 / 重复标记 / 顺序颠倒；
 *   ③ `judgeNoticeEdit` 的正判据：只改引号里的字 ⇒ 放行；
 *   ④ 负对照（每条都必须判红）：
 *      · 区块**之前**加一行代码
 *      · 区块**之后**加一行代码
 *      · 区块内**增删一条 callout**（骨架变）
 *      · 区块内改一个 props（骨架变）
 *      · 只改一个文件（不是"公告换血"的完整形态）
 *      · 多改第三个文件
 *      · 标记被删掉 / 重复
 *      · 旧版本读不到（新增文件）
 *   ⑤ 真仓库自检：`src/client.js` 与 `src/i18n/i18n-copy-ext.js` 当前**确实**各有一个唯一标记区块，
 *      且对"当前内容 vs 当前内容"判定为放行（否则这条通道在真实树上根本不可用）。
 *
 * Usage:  node test/verify-notice-routing.mjs
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MODE_NOTICE, NOTICE_FILES, NOTICE_MARK_BEGIN, NOTICE_MARK_END,
  sliceNoticeBlock, noticeSkeleton, judgeNoticeEdit, classify,
} from './tools/ci-routing.mjs';
import { stripComments, blankStringLiterals } from './tools/js-text.mjs';
import { parseInlineModules } from './tools/src-scope.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

let passed = 0;
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) passed += 1; else failed += 1;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
};

// ══ ① 两份骨架实现逐字节一致 ═════════════════════════════════════════════════
console.log('① noticeSkeleton ⇄ js-text.mjs（stripComments + blankStringLiterals）逐字节一致');
{
  // js-text 侧的参照实现：先剥注释，再把**所有**字符串内容挖空。
  const reference = (src) => blankStringLiterals(stripComments(src), () => true);
  const CASES = [
    ['普通字符串与注释', 'const a = "中文文案"; // 注释\n/* 块 */ const b = \'x\';'],
    ['URL 里的双斜杠不算注释', 'const u = "https://example.com/a"; const c = 1;'],
    ['正则里的注释起始符', 'const re = /[/*]/; const d = 2;'],
    ['转义引号', 'const s = "a\\"b"; const t = 3;'],
    ['块注释里的引号', '/* "x" */ const e = "y";'],
    ['模板无插值', 'const t = `纯文案`; const f = 4;'],
    ['多行字符串', 'const m = "第一行\\n第二行"; const g = 5;'],
  ];
  const bad = CASES.filter(([, src]) => noticeSkeleton(src) !== reference(src))
    .map(([name]) => name);
  check('同一批输入两份实现逐字节相等（漂了就是判据自己另立语义）', bad.length === 0,
    bad.length ? '不一致：' + bad.join(' / ') : CASES.length + ' 组输入');

  // 负对照：改引号里的字 ⇒ 骨架不变（这是通道存在的理由）；改代码 token ⇒ 骨架变。
  const s1 = noticeSkeleton('React.createElement("p", { className: x }, weT("旧文案"))');
  const s2 = noticeSkeleton('React.createElement("p", { className: x }, weT("新文案"))');
  const s3 = noticeSkeleton('React.createElement("p", { className: y }, weT("新文案"))');
  check('只改引号里的字 ⇒ 骨架不变', s1 === s2);
  check('negative control: 改一个属性名 ⇒ 骨架必须变', s1 !== s3);

  // 模板的 ${…} 是代码不是文案：改了必须判红（否则"插值被改掉"会被放过）。
  const t1 = noticeSkeleton('const x = `共 ${a} 张`;');
  const t2 = noticeSkeleton('const x = `共 ${b} 张`;');
  const t3 = noticeSkeleton('const x = `共 ${a} 条`;');
  check('negative control: 模板插值表达式被改 ⇒ 骨架变', t1 !== t2);
  check('模板静态段被改 ⇒ 骨架不变（静态段就是文案）', t1 === t3);
}

// ══ ② sliceNoticeBlock 的边界 ════════════════════════════════════════════════
console.log('② sliceNoticeBlock 边界（缺标记 / 重复 / 顺序颠倒都必须返回 null）');
{
  const ok = 'A_BEFORE\n// ══ ' + NOTICE_MARK_BEGIN + ' ══\nbody\n// ══ ' + NOTICE_MARK_END + ' ══\nA_AFTER\n';
  const s = sliceNoticeBlock(ok);
  check('正常切分：区块外两段与区块本身都在',
    !!s && s.before === 'A_BEFORE\n' && s.block.includes('body') && s.after === 'A_AFTER\n',
    s ? JSON.stringify({ before: s.before, after: s.after }) : 'null');
  check('negative control: 缺 begin ⇒ null', sliceNoticeBlock('A\nbody\n') === null);
  check('negative control: 缺 end ⇒ null',
    sliceNoticeBlock('// ' + NOTICE_MARK_BEGIN + '\nbody\n') === null);
  check('negative control: begin 重复 ⇒ null',
    sliceNoticeBlock('// ' + NOTICE_MARK_BEGIN + '\n// ' + NOTICE_MARK_BEGIN + '\n// ' + NOTICE_MARK_END + '\n') === null);
  check('negative control: end 重复 ⇒ null',
    sliceNoticeBlock('// ' + NOTICE_MARK_BEGIN + '\n// ' + NOTICE_MARK_END + '\n// ' + NOTICE_MARK_END + '\n') === null);
  check('negative control: 顺序颠倒（end 在前）⇒ null',
    sliceNoticeBlock('// ' + NOTICE_MARK_END + '\n// ' + NOTICE_MARK_BEGIN + '\n') === null);
}

// ══ ③④ judgeNoticeEdit 正判据与全部负对照 ════════════════════════════════════
console.log('③④ judgeNoticeEdit：只改文案放行，任何结构/区块外改动判红');
{
  const mk = (body, around = {}) => (around.before || 'const path = 1;\n')
    + '// ══ ' + NOTICE_MARK_BEGIN + ' ══\n' + body + '// ══ ' + NOTICE_MARK_END + ' ══\n'
    + (around.after || 'const tail = 2;\n');
  const CLIENT_A = 'const a = weT("旧标题");\nconst b = weT("旧正文");\n';
  const CLIENT_B = 'const a = weT("新标题");\nconst b = weT("新正文");\n';
  const DICT_A = '  "旧标题": "Old title",\n  "旧正文": "Old body",\n';
  const DICT_B = '  "新标题": "New title",\n  "新正文": "New body",\n';
  const before = { [NOTICE_FILES[0]]: mk(CLIENT_A), [NOTICE_FILES[1]]: mk(DICT_A) };
  const pass = judgeNoticeEdit({
    before,
    after: { [NOTICE_FILES[0]]: mk(CLIENT_B), [NOTICE_FILES[1]]: mk(DICT_B) },
  });
  check('只改引号里的字（两个文件都改）⇒ 放行', pass.ok, pass.reasons.join(' | '));

  const judge = (afterOverrides) => judgeNoticeEdit({
    before,
    after: Object.assign({
      [NOTICE_FILES[0]]: mk(CLIENT_B),
      [NOTICE_FILES[1]]: mk(DICT_B),
    }, afterOverrides),
  });

  // 区块之前 / 之后加代码
  check('negative control: 区块**之前**加一行代码 ⇒ 判红',
    judge({ [NOTICE_FILES[0]]: mk(CLIENT_B, { before: 'const path = 1;\nconst evil = 1;\n' }) }).ok === false);
  check('negative control: 区块**之后**加一行代码 ⇒ 判红',
    judge({ [NOTICE_FILES[0]]: mk(CLIENT_B, { after: 'const tail = 2;\nconst evil = 1;\n' }) }).ok === false);
  // 区块内结构变化
  check('negative control: 区块内**增删一条 callout**（骨架变）⇒ 判红',
    judge({ [NOTICE_FILES[0]]: mk(CLIENT_B + 'const c = weT("多一条");\n') }).ok === false);
  check('negative control: 区块内**改一个 props**（骨架变）⇒ 判红',
    judge({ [NOTICE_FILES[0]]: mk(CLIENT_B.replace('const a =', 'const z =')) }).ok === false);
  check('negative control: 区块内**删掉一条键**（词表骨架变）⇒ 判红',
    judge({ [NOTICE_FILES[1]]: mk('  "新标题": "New title",\n') }).ok === false);
  // 文件集合：**允许只改一个**（改中文时英文常可原样复用），但不许改第三个。
  const onlyClient = judgeNoticeEdit({
    before, after: { [NOTICE_FILES[0]]: mk(CLIENT_B), [NOTICE_FILES[1]]: mk(DICT_A) },
    changed: [NOTICE_FILES[0]],
    dictionary: '  "旧标题": "Old title",\n  "旧正文": "Old body",\n  "新标题": "New title",\n  "新正文": "New body",\n',
  });
  check('只改中文正文（译文沿用）⇒ 放行', onlyClient.ok === true, onlyClient.reasons.join(' | '));
  const onlyClientMissingDict = judgeNoticeEdit({
    before, after: { [NOTICE_FILES[0]]: mk(CLIENT_B), [NOTICE_FILES[1]]: mk(DICT_A) },
    changed: [NOTICE_FILES[0]],
    dictionary: '  "旧标题": "Old title",\n  "旧正文": "Old body",\n',
  });
  check('negative control: 只改中文且新键**没有**词条 ⇒ 译文覆盖判红',
    onlyClientMissingDict.ok === false && /缺少英文词条/.test(onlyClientMissingDict.reasons.join(' ')),
    onlyClientMissingDict.reasons[0] || '');
  check('negative control: 多改第三个文件 ⇒ 判红',
    judge({ 'lib/index.js': 'const x = 1;\n' }).ok === false);
  check('negative control: 新版文件读不到（删除）⇒ 判红',
    judge({ [NOTICE_FILES[0]]: null }).ok === false);
  check('negative control: 旧版文件读不到（新增）⇒ 判红',
    judgeNoticeEdit({ before: {}, after: { [NOTICE_FILES[0]]: mk(CLIENT_B), [NOTICE_FILES[1]]: mk(DICT_B) } }).ok === false);
  // 标记被破坏
  check('negative control: 新版删掉标记 ⇒ 判红',
    judge({ [NOTICE_FILES[0]]: CLIENT_B }).ok === false);
  // 空差异
  check('negative control: 空差异 ⇒ 判红', judgeNoticeEdit({ before, after: {} }).ok === false);
}

// ══ ⑤ 分类器：只有恰好两个公告文件才给 notice ════════════════════════════════
console.log('⑤ classify：notice 候选的形状边界');
{
  const E = (status, path) => ({ status, path, oldPath: '', oldMode: '100644', newMode: '100644' });
  const both = classify([E('M', NOTICE_FILES[0]), E('M', NOTICE_FILES[1])]);
  check('恰好两个公告文件 ⇒ mode=notice', both.mode === MODE_NOTICE, both.mode);
  const one = classify([E('M', NOTICE_FILES[0])]);
  check('只改一个公告文件 ⇒ mode=notice（允许；漏译由内容级判据抓）', one.mode === MODE_NOTICE, one.mode);
  const extra = classify([E('M', NOTICE_FILES[0]), E('M', NOTICE_FILES[1]), E('M', 'lib/index.js')]);
  check('negative control: 两个公告文件 + 一个代码文件 ⇒ full', extra.mode === 'full', extra.mode);
  const deleted = classify([E('D', NOTICE_FILES[0]), E('M', NOTICE_FILES[1])]);
  check('negative control: 公告文件被删除 ⇒ full（非新增/修改）', deleted.mode === 'full', deleted.mode);
}

// ══ ⑥ 真仓库自检 ═════════════════════════════════════════════════════════════
console.log('⑥ 真仓库：两个文件各有一个唯一标记区块，且"自己 vs 自己"放行');
{
  const snap = {};
  for (const rel of NOTICE_FILES) {
    let text;
    try { text = read(rel); } catch { text = null; }
    snap[rel] = text;
    const sliced = text == null ? null : sliceNoticeBlock(text);
    check(rel + ' 有唯一的公告区块标记', !!sliced,
      sliced ? '区块 ' + sliced.block.length + ' 字节（前 ' + sliced.before.length + ' / 后 ' + sliced.after.length + '）'
        : '缺标记或缺文件');
    if (sliced) {
      check(rel + ' 区块确实包含公告文案（不是空壳）',
        sliced.block.length > 200, sliced.block.length + ' 字节');
    }
  }
  // 词表族按构建清单现解析（单一真源）：公告里的「知道了」住在 i18n-copy-core.js。
  const dictFamily = parseInlineModules().map(({ file }) => file)
    .filter((file) => /(?:^|\/)i18n-copy(?:-[^/]+)?\.js$/.test(file));
  const dictionary = dictFamily.map((rel) => { try { return read(rel); } catch { return ''; } }).join('\n');
  check('词表族可解析出 ≥2 个域文件（译文覆盖检查的输入不是单文件）',
    dictFamily.length >= 2, dictFamily.join(' '));
  const self = judgeNoticeEdit({ before: snap, after: snap, dictionary });
  check('当前内容 vs 当前内容 ⇒ 放行（否则这条通道在真实树上不可用）', self.ok, self.reasons.join(' | '));
  // negative control：把词表里「知道了」那条删掉 ⇒ 译文覆盖必须判红。
  const narrowed = dictionary.replace(/"知道了":\s*"[^"]*",?/, '');
  const missDict = judgeNoticeEdit({ before: snap, after: snap, dictionary: narrowed });
  check('negative control: 词表里少一条公告用到的键 ⇒ 译文覆盖判红',
    missDict.ok === false && /缺少英文词条/.test(missDict.reasons.join(' ')),
    missDict.reasons[0] || '');
  // 真数据的负对照：在真 client.js 的区块外插一行代码 ⇒ 必须判红。
  const c = snap[NOTICE_FILES[0]];
  if (c) {
    const mutated = 'const inserted = 1;\n' + c;
    const bad = judgeNoticeEdit({
      before: snap,
      after: { [NOTICE_FILES[0]]: mutated, [NOTICE_FILES[1]]: snap[NOTICE_FILES[1]] },
    });
    check('negative control: 在**真** src/client.js 的区块外插一行代码 ⇒ 判红', bad.ok === false,
      bad.reasons[0] || '');
  }
}

console.log('\n' + (failed === 0
  ? 'NOTICE ROUTING CHECKS PASSED'
  : 'NOTICE ROUTING CHECKS FAILED') + ' (' + passed + ' passed, ' + failed + ' failed)');
process.exit(failed === 0 ? 0 : 1);
