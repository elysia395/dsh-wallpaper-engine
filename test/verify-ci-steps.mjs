#!/usr/bin/env node
/**
 * verify-ci-steps.mjs — CI 步骤表判据（BUNDLE-SPLIT §13.1 R-7）。
 *
 * ## 这条守卫守什么
 * `.github/workflows/verify.yml` 是"提交前必须绿"在 CI 上的唯一执行者，但它的**接线**
 * （跑哪些步骤、什么顺序、哪一步允许失败）此前**没有任何判据** —— 删掉 `verify:static`
 * 一步，静态棘轮就从 PR 门禁里消失，而全仓守卫照样全绿。详细的实害清单写在
 * `test/tools/ci-workflow.mjs` 的文件头。
 *
 * ## 为什么入口这么薄
 * DEV-GUIDE §4.7 约定 5：所有断言逻辑（含负对照要吃的那份）都在
 * `./tools/ci-workflow.mjs` 并 export；这里只做「读盘 → 调纯函数 → 打印 → 非 0 退出」。
 * 于是负对照是"把变异的文本喂给**同一个**判据函数"，而不是打印一句"应该会红"。
 *
 * ## 为什么负对照在内存里变异、绝不动真文件
 * `verify.yml` 是共享工作树里的文件（同树可能还有别人在跑）。改它会把假红传染给队友，
 * 且这一层判据要证的恰恰是"文本变了会红" —— 文本变异已经足够，且无副作用。
 *
 * Usage: node test/verify-ci-steps.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCheck } from './tools/assert-harness.mjs';
import {
  CI_WORKFLOW_REL, EXPECTED_NPM_SEQUENCE, STEP_FLOOR, INSTALL_COMMAND, ARTIFACT_STEP_NEEDLE, SOFT_STEP,
  auditCiWorkflow, parseWorkflow, npmScriptOf,
  dropStep, dropStepNamed, swapSteps, swapStepsNamed, setContinueOnError, renameNpmScript, insertNpmStepAfter,
} from './tools/ci-workflow.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const { check, stats } = createCheck();
const rel = (p) => join(ROOT, p);
const brief = (s, n = 56) => {
  const one = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n) + '…' : one;
};

// ── 前置：判据的输入必须在盘 ──────────────────────────────────────────────────
if (!existsSync(rel(CI_WORKFLOW_REL)) || !existsSync(rel('package.json'))) {
  console.log('  ✗ 前置缺失：' + CI_WORKFLOW_REL + ' / package.json 必须先存在（判据的输入不在盘，无从谈起）');
  process.exit(1);
}
const workflowText = readFileSync(rel(CI_WORKFLOW_REL), 'utf8');
const scripts = JSON.parse(readFileSync(rel('package.json'), 'utf8')).scripts || {};

const result = auditCiWorkflow({ workflowText, scripts });
const judge = (res, id) => res.checks.find((c) => c.id === id);

// ── ① 解析概览（人读的证据：判据真的解析到了哪几条步骤）──────────────────────
console.log('\n① CI 步骤表：行扫描 ' + CI_WORKFLOW_REL + '（零依赖，不引 YAML 库）');
console.log('  解析到 ' + result.steps.length + ' 条步骤 · npm run 序列：' + (result.npmSequence.join(' → ') || '（空）'));
for (const step of result.steps) {
  const who = step.name || step.uses || '（无 name/uses）';
  console.log('   · #' + (step.index + 1) + ' ' + brief(who, 40) + ' —— ' + brief(step.run || step.uses));
}

// ── ② 正判据 ──────────────────────────────────────────────────────────────────
console.log('\n② 判据（同一纯函数 auditCiWorkflow；正判据与负对照共用）');
for (const c of result.checks) check(c.name, c.ok, c.detail);

// ── ③ 负对照（在内存里变异文本，喂回同一个函数）──────────────────────────────
console.log('\n③ 负对照：把 workflow 文本变异后喂回同一个纯函数（绝不改真文件）');
const control = (desc, mutatedText, id) => {
  const res = auditCiWorkflow({ workflowText: mutatedText, scripts });
  const c = judge(res, id);
  const red = c && !c.ok ? c.id + '：' + c.detail : '';
  check('negative control: ' + desc + ' ⇒ ' + id + ' 判红', red !== '', red || '（没有判红 —— 这条判据没牙）');
};

control('删掉 verify:static 步', dropStep(workflowText, 'verify:static'), 'npm-sequence-exact');
control('删掉 verify:bridge 步', dropStep(workflowText, 'verify:bridge'), 'npm-sequence-exact');
control('把 verify:static 与 build 对调', swapSteps(workflowText, 'verify:static', 'build'), 'npm-sequence-exact');
control('在 verify 之后插入一步未知的 npm run lint', insertNpmStepAfter(workflowText, 'verify', 'lint'), 'npm-sequence-exact');
control('在 verify 这一步里偷偷再串一条 npm run verify:bogus',
  workflowText.replace('run: npm run verify\n', 'run: npm run verify && npm run verify:bogus\n'), 'npm-sequence-exact');
control('给 npm run verify 加 continue-on-error: true', setContinueOnError(workflowText, 'verify', true), 'continue-on-error-soft-only');
control('删掉 ' + SOFT_STEP + ' 的 continue-on-error', setContinueOnError(workflowText, SOFT_STEP, false), 'soft-step-carries-soft-flag');
control('把 verify 改成不存在的 verify:bogus', renameNpmScript(workflowText, 'verify', 'verify:bogus'), 'npm-scripts-exist');
control('删掉 shell: bash 的产物出库步', dropStepNamed(workflowText, '产物不入库'), 'bash-artifact-step');
control('把 install 步挪到 verify:static 之后', swapStepsNamed(workflowText, 'install', 'verify:static'), 'install-before-first-npm-run');
control('把步骤表截断成空文本', '', 'step-floor');

// ── ④ 自检：变异真的改了文本 / 判据不是恒红 ──────────────────────────────────
console.log('\n④ 自检：变异器与判据都不会自己骗自己');
{
  const mutations = [
    ['dropStep(verify:static)', dropStep(workflowText, 'verify:static')],
    ['swapSteps(verify:static, build)', swapSteps(workflowText, 'verify:static', 'build')],
    ['insertNpmStepAfter(verify, lint)', insertNpmStepAfter(workflowText, 'verify', 'lint')],
    ['setContinueOnError(verify, true)', setContinueOnError(workflowText, 'verify', true)],
    ['setContinueOnError(verify:docs, false)', setContinueOnError(workflowText, SOFT_STEP, false)],
    ['renameNpmScript(verify, verify:bogus)', renameNpmScript(workflowText, 'verify', 'verify:bogus')],
    ['dropStepNamed(产物不入库)', dropStepNamed(workflowText, '产物不入库')],
    ['swapStepsNamed(install, verify:static)', swapStepsNamed(workflowText, 'install', 'verify:static')],
    ['空文本', ''],
    ['verify 步里偷偷串一条 npm run verify:bogus',
      workflowText.replace('run: npm run verify\n', 'run: npm run verify && npm run verify:bogus\n')],
  ];
  const unchanged = mutations.filter(([, text]) => text === workflowText).map(([name]) => name);
  check('negative control 自检：每条变异都真的改了文本（否则"判红"可能只是原文本本来就红）',
    unchanged.length === 0, unchanged.length ? '未生效：' + unchanged.join(' / ') : mutations.length + ' 条变异均已生效');

  const noops = [
    dropStep(workflowText, 'verify:nonexistent') === workflowText,
    swapSteps(workflowText, 'a', 'b') === workflowText,
    setContinueOnError(workflowText, 'nope', true) === workflowText,
    dropStepNamed(workflowText, '不存在的步名') === workflowText,
  ];
  check('negative control 自检：变异器对不匹配的输入是恒等（防"锚点写错 ⇒ 变异没发生 ⇒ 假绿"）',
    noops.every(Boolean), noops.filter((x) => !x).length + ' 条变异器对不匹配输入改了文本');

  const withoutScripts = auditCiWorkflow({ workflowText, scripts: {} });
  const c = judge(withoutScripts, 'npm-scripts-exist');
  check('positive control：同一函数在 scripts 表为空时对"脚本名核对"判红（证明该判据真在读 package.json）',
    c && !c.ok && /verify:static|verify:bridge/.test(c.detail), c ? c.id + '：' + c.detail : '找不到判据');
}

// ── ⑤ 判据面非空转的算术自证 ─────────────────────────────────────────────────
console.log('\n⑤ 判据面与期望面自证');
{
  const parsed = parseWorkflow(workflowText);
  const named = parsed.steps.filter((s) => npmScriptOf(s)).map((s) => npmScriptOf(s));
  check('解析面与期望面同尺寸（' + EXPECTED_NPM_SEQUENCE.length + ' 步）：' + named.join(' → '),
    named.length === EXPECTED_NPM_SEQUENCE.length, 'named=' + named.length);
  check('地板常量与实测一致：STEP_FLOOR=' + STEP_FLOOR + ' ≤ 实测步骤数 ' + parsed.steps.length,
    parsed.steps.length >= STEP_FLOOR, 'steps=' + parsed.steps.length);
  check('判据面覆盖 install 步与 ' + ARTIFACT_STEP_NEEDLE + ' 步（这两条不是"恰好也绿"）',
    String(workflowText).includes(INSTALL_COMMAND) && parsed.steps.some((s) => String(s.shell || '') === 'bash' && String(s.run || '').includes(ARTIFACT_STEP_NEEDLE)));
}

console.log('\n' + (stats.failed
  ? 'ALL CI STEP CHECKS FAILED — ' + stats.failed + ' failed'
  : 'ALL CI STEP CHECKS PASSED') + ' (' + (stats.passed + stats.failed) + ')');
process.exit(stats.failed ? 1 : 0);
