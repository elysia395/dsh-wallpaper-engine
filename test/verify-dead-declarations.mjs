#!/usr/bin/env node
/**
 * verify-dead-declarations.mjs — **独立脚本面**（`test/verify-*.mjs` + `test/*-smoke.mjs` +
 * `test/compat-*.mjs`）里不得有**零引用的顶层声明**（"声明孤儿"）。
 *
 * 为什么只扫这些文件：它们都是**独立脚本**（不 import 彼此的业务符号）⇒ 一个顶层声明在本文件里
 * 只出现一次，就真的没人用。反过来 `src/**` **不适用**：那里的模块被构建期内联进**同一个作用域**，
 * `client.js` 里只出现一次的名字（`trapModalTab` / `VinylRecord` / `renderConfirmRow` …）正由
 * `panel-tabs.js` / `picker-modal.js` 在用 —— 按"本文件只出现一次"判会得到 **44 处假阳性**（实测）。
 * `lib/client.js` 同理（它是生成物，名字与 `src/` 各模块成对出现）。
 * `test/tools/` 也不扫：那里的模块**导出**给守卫用，跨文件引用是正常的。
 *
 * `test/compat-*.mjs`（harness 适配层，需网络 / 真 harness / Chromium，因此**不进 `verify` 链**）
 * 同样满足"独立脚本"这个前提 ⇒ 一并纳进来。加这条面时要先复核这个前提：它们**只能**引用
 * node 内置模块或彼此 import 的导出（后者在本文件里出现 ≥2 次，不会被误判）。
 *
 * 为什么需要：**死代码不会自己变红**。断言被撤掉时，只在断言里用到的解析助手（`pngInfo` /
 * `jpegInfo` / `pngToRgba` 这类 PNG/JPEG 字节解析器）会安静地留在文件里，谁也不会去调它 ——
 * 没有任何判据看得见。与守卫 ① 的"文件孤儿"是同一族：① 管"没人 import 的文件"，
 * 本判据管"没人调用的声明"。
 *
 * 判据口径（与 `test/tools/audit-guard-teeth.mjs` 的判据 C 同族）：
 *   · 声明只认**代码行**上、行首的 `function NAME(` 与 `const NAME = (`；
 *   · 计数只看**代码**：扫描前用共享的**字符串感知**剥离器（`test/tools/js-text.mjs` 的
 *     `stripComments`，等长替换 ⇒ 行号不变）把注释换成空格。**P2-3D（D3）起改的**：此前计数
 *     用原文 ⇒ 一个**同行注释**就能把真死声明"刷"成有引用（p1b-recon 实验 E3：`const FOO =
 *     () => 1; // FOO is called from bar()` 判出 `[]`，去掉注释才是 `[{FOO}]`），死代码判据可以
 *     被一行注释静默清零。
 *     为什么可以用剥注释：那个"剥注释反而误判"的坑属于**朴素块注释正则**（见 audit-guard-teeth
 *     判据 F：一句行注释里的 `scripts/**` 会让朴素剥法吃掉后面 95 行真实代码，`devSpecifiers`
 *     原文 4 次、剥完只剩 1 次 ⇒ 假死声明）。共享实现认字符串/模板/正则字面量、且**只剥不删**
 *     （等长空格），方向安全：识别不出正则时最多**少剥**（漏报），绝不会多吃真代码。
 *     残余代价（仍保留）：名字出现在**字符串/模板**里仍算"用过"（那部分按字符串原样保留）。
 *
 * Usage:  node test/verify-dead-declarations.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// 剥注释：共享的**字符串感知**实现（P2-3D 起引用计数只看代码，见 deadDeclarations 的注释）。
import { stripComments } from './tools/js-text.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? '✓ ' : '✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!ok) failed++;
};

const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);
const DECL_RES = [
  /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/,
  /^\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/,
];

/** 判据：这些顶层声明在本文件里只出现一次（= 没有任何调用点）。生产扫描与正/负对照共用它。 */
function deadDeclarations(src) {
  // P2-3D（D3 硬化）：**引用计数只看代码**。剥注释走共享的字符串感知实现（等长替换 ⇒ 行号不变），
  // 理由与实测见文件头「判据口径」。旧写法直接数原文 ⇒ 同行注释即可把死声明清零。
  const code = stripComments(src);
  const out = [];
  code.split('\n').forEach((line, i) => {
    if (isComment(line)) return;
    for (const re of DECL_RES) {
      const m = re.exec(line);
      if (!m) continue;
      if ((code.match(new RegExp('\\b' + m[1] + '\\b', 'g')) || []).length === 1) out.push({ n: i + 1, name: m[1] });
    }
  });
  return out;
}

// 扫描面 = 独立脚本面（`test/tools/` 不扫：那里的模块**导出**给守卫用，跨文件引用是正常的）
const GUARDS = readdirSync(join(ROOT, 'test'), { withFileTypes: true })
  .filter((e) => e.isFile() && /^(verify-.*|.*-smoke|compat-.*)\.mjs$/.test(e.name))
  .map((e) => 'test/' + e.name)
  .sort();

// 覆盖面：判据完全可能"因为扫描面为空而恒真"（没有文件 ⇒ 没有违规）
check('覆盖面：扫到 ≥30 个独立脚本（防 walker 返回空表）', GUARDS.length >= 30, GUARDS.length + ' 个');

const offenders = [];
for (const rel of GUARDS) {
  for (const d of deadDeclarations(readFileSync(join(ROOT, rel), 'utf8'))) {
    offenders.push(rel + ':' + d.n + ' → ' + d.name);
  }
}
check('独立脚本面零引用顶层声明 == 0（死代码不会自己变红，所以要有判据看着）', offenders.length === 0,
  offenders.length ? offenders.join(' | ') : GUARDS.length + ' 个脚本干净');

// 正/负对照：把合成输入喂给**同一个判据函数**
check('negative control: 零调用点的声明会被判出',
  deadDeclarations('function neverCalled() {}\n').length === 1);
check('negative control: 声明之后没有任何引用的也判出',
  deadDeclarations('function lonely() {}\nconst x = 1;\n').length === 1);
check('positive control: 有调用点就不报（判据不是恒真）',
  deadDeclarations('function used() {}\nused();\n').length === 0);
check('positive control: 注释行上的"声明"不算声明（口径与实现一致）',
  deadDeclarations('// function ghost() {}\n').length === 0);

// ── P2-3D（D3）负对照：证明**旧的绕过手法**（把"引用"写进注释）不再成立 ──────────────────
// 旧写法直接数原文 ⇒ 一句注释就能把真死声明"刷"成有引用。这几条与生产扫描共用同一个判据函数，
// 所以撤掉 D3 硬化（`deadDeclarations` 里退回数 `src`）会让前两条当场变红。
check('negative control(硬化): 引用只出现在同行行注释里 ⇒ 仍判死声明（旧写法此处清零）',
  deadDeclarations('const FOO = () => 1; // FOO is called from bar()\n').length === 1);
check('negative control(硬化): 引用只出现在块注释里 ⇒ 仍判死声明（旧写法此处清零）',
  deadDeclarations('const BAR = () => 1;\n/* BAR(); */\n').length === 1);
check('positive control(硬化): 真代码里的调用点没被"剥注释"一起剥掉（判据没被剥空）',
  deadDeclarations('const BAZ = () => 1;\nBAZ();\n').length === 0);
check('positive control(硬化): 行注释里出现 `/*` 时不吃掉后面的真代码（朴素块注释正则的老坑）',
  deadDeclarations('const QUX = () => 1;\n// see /* here\nQUX();\n/* end */\n').length === 0);

console.log('');
if (failed) {
  console.log('DEAD-DECLARATION CHECKS FAILED — ' + failed + ' failed');
  process.exit(1);
}
console.log('ALL DEAD-DECLARATION CHECKS PASSED');
