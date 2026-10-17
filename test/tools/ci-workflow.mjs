#!/usr/bin/env node
/**
 * ci-workflow.mjs — `.github/workflows/verify.yml` 的**步骤表判据**（纯函数库：不读盘、不写盘、无副作用）。
 *
 * ## 守的是什么实害（BUNDLE-SPLIT §13.1 R-7）
 * 这个 workflow 是"提交前必须绿"那条铁律在 CI 上的**唯一**执行者。但它自己的**接线**
 * —— 跑哪些步骤、什么顺序、哪一步允许失败 —— 此前**没有任何判据**：删掉 `verify:static`
 * 或 `verify:bridge` 一步、把 static 挪到 build 之后、把 `continue-on-error` 从
 * `verify:docs` 挪到 `verify` 上，全仓守卫照样全绿，而 CI 已经**静默少了一颗牙**：
 *   · 删 `verify:static` ⇒ 静态棘轮（ESLint / tsc 基线）在 PR 上不再跑；
 *   · 删 `verify:bridge` ⇒ media-bridge 端到端通道不再被覆盖（而"覆盖了这条通道"的定义
 *     就是这一步会失败）；
 *   · 把 `continue-on-error` 挪到硬档步 ⇒ 硬档失效（该拦的 PR 放行）；
 *   · 从 `verify:docs` 上摘掉它 ⇒ 软档变硬档（内务判据反过来拦下所有人的改动）。
 * 本文件把那根接线变成机器事实。
 *
 * ## 为什么是行扫描，而不是引一个 YAML 库
 * `test/verify-package-files.mjs` 的 P5 把整条 build/verify/smoke 链钉在**零裸依赖**上
 * （CI 只 `npm ci --omit=peer` 装运行期依赖，devDependencies 根本没装）。引 `js-yaml`
 * 会让这一步在 CI 上直接 `ERR_MODULE_NOT_FOUND` —— 判据自己先把链弄红。
 * 我们要断言的只有那几个键（`name` / `uses` / `run` / `shell` / `continue-on-error`），
 * 行扫描足够；形状变了会**判红**（步骤数地板 + 序列判据），不会静默放过。
 *
 * ## 为什么正判据与负对照共用一个函数（DEV-GUIDE §4.7 约定 5）
 * 所有断言逻辑都在 `auditCiWorkflow()` 里；`test/verify-ci-steps.mjs` 只做
 * "读盘 → 调它 → 打印 ✓/✗ → 非 0 退出"。负对照也只把**文本**变异后再喂回同一个函数，
 * 因此它是"同一个判据真的判红"，不是"打印一句应该会红"。
 */

/** CI 步骤表的仓库相对路径（判据的唯一输入）。 */
export const CI_WORKFLOW_REL = '.github/workflows/verify.yml';

/**
 * CI 上 `npm run <script>` 步骤的**有序**序列 —— 这就是"门禁的接线"本身。
 * 改动它等于改动"哪些门在 PR 上真的会拦人"，因此必须显式、成对地改这份清单与 workflow。
 */
export const EXPECTED_NPM_SEQUENCE = [
  'verify:static', 'build', 'verify', 'verify:bridge', 'smoke', 'verify:docs',
];

/** 非空转地板：当前 verify.yml 有 12 条步骤（含 3 条非 npm 步）。解析器空转 ⇒ 其余判据全假绿。 */
export const STEP_FLOOR = 10;

/** 运行期依赖安装步的**逐字**命令（"CI 不装 devDependencies"这个前提就写在它里面）。 */
export const INSTALL_COMMAND = 'npm ci --omit=peer --ignore-scripts --no-audit --no-fund';

/** 软档步：`continue-on-error` 是这一档的定义本身（见 workflow :102-109 的注释）。 */
export const SOFT_STEP = 'verify:docs';

/** 产物出库判据的指纹：CSS/产物出库那一类"非 npm 步骤"里必须真的在跑 git。 */
export const ARTIFACT_STEP_NEEDLE = 'git ls-files';

const ITEM_RE = /^(\s*)-\s+(\S.*)$/;
const KEY_RE = /^([A-Za-z_][\w-]*):\s*(.*)$/;

const lineIndent = (line) => line.length - line.trimStart().length;
const isBlankOrComment = (line) => !line.trim() || /^\s*#/.test(line);
const isBlockScalar = (value) => value === '|' || value === '>' || /^[|>][-+]?\d*$/.test(value);

function readKeyValue(text) {
  const m = KEY_RE.exec(String(text).trim());
  return m ? { key: m[1], value: m[2].trim() } : null;
}

function applyKey(step, kv) {
  if (kv.key === 'continue-on-error') {
    step.continueOnError = /^(true|yes|on)$/i.test(kv.value);
    return;
  }
  step[kv.key] = kv.value;
}

/**
 * 行扫描 `steps:` 段，返回步骤对象：
 * `{ index, line, end, indent, name, uses, run, shell, continueOnError }`
 * （`line`/`end` 是 `lines` 里的 0-based 半开区间，供变异器整块增删）。
 *
 * 只认 YAML 里我们真正要断言的部分：列表项 `- name:` / `- uses:`，以及项内同级的
 * `run:` / `shell:` / `continue-on-error:`；`run: |` / `run: >` 这种块标量按缩进收满。
 * 找不到 `steps:` ⇒ 空数组（上游的步骤数地板会因此判红，而不是静默通过）。
 */
export function parseWorkflow(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const stepsAt = lines.findIndex((l) => /^\s*steps:\s*$/.test(l));
  if (stepsAt < 0) return { steps: [], lines };
  const stepsIndent = lineIndent(lines[stepsAt]);
  const steps = [];
  let current = null;
  let blockKey = '';
  let blockIndent = -1;
  for (let i = stepsAt + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    const indent = lineIndent(line);
    // 回到作业级键（缩进 ≤ `steps:`）⇒ 步骤段结束。
    if (indent <= stepsIndent && !/^\s*#/.test(line)) break;
    if (current && blockKey) {
      if (indent > blockIndent) {
        current[blockKey] += (current[blockKey] ? '\n' : '') + line.trim();
        continue;
      }
      blockKey = '';
    }
    const item = ITEM_RE.exec(line);
    if (item && indent > stepsIndent) {
      current = {
        index: steps.length, line: i, end: i + 1, indent,
        name: '', uses: '', run: '', shell: '', continueOnError: false,
      };
      steps.push(current);
      const kv = readKeyValue(item[2]);
      if (kv) applyKey(current, kv);
      continue;
    }
    if (!current) continue;
    const kv = readKeyValue(line);
    if (!kv) continue;
    if (isBlockScalar(kv.value)) {
      current[kv.key] = '';
      blockKey = kv.key;
      blockIndent = indent;
    } else {
      applyKey(current, kv);
    }
  }
  for (const step of steps) {
    const next = steps[step.index + 1] ? steps[step.index + 1].line : lines.length;
    let end = next;
    // 尾随空行/注释行属于**下一条**步骤的说明，不算本步的行跨度。
    while (end > step.line + 1 && isBlankOrComment(lines[end - 1])) end -= 1;
    step.end = end;
  }
  return { steps, lines };
}

/** 这一步的 `run:` 是不是 `npm run <script>`；是则返回脚本名，否则 `''`。 */
export function npmScriptOf(step) {
  const m = /(?:^|\s)npm run ([\w:.-]+)/.exec(String(step && step.run ? step.run : ''));
  return m ? m[1] : '';
}

/**
 * 有序的 `npm run <script>` 序列（就是 EXPECTED_NPM_SEQUENCE 要逐项对齐的那份）。
 * **一条步骤里出现多个 `npm run` 会全部计入** —— 否则 `run: npm run verify && npm run x`
 * 这种"把一步掰成两步、或偷偷再串一条"的形态会从判据底下溜过去。
 */
export function npmRunSequence(steps) {
  const out = [];
  const re = /(?:^|\s)npm run ([\w:.-]+)/g;
  for (const step of steps) {
    for (const m of String(step.run || '').matchAll(re)) out.push(m[1]);
  }
  return out;
}

/** 安装步的下标（找不到 ⇒ -1）。逐字比对命令，防止"看起来装了、其实少了 --omit=peer"。 */
export function installStepIndex(steps) {
  return steps.findIndex((s) => String(s.run || '').trim().startsWith(INSTALL_COMMAND));
}

/**
 * 判据本体（纯函数）：`{ workflowText, scripts }` → `{ steps, npmSequence, checks }`。
 * `checks` 每项 `{ id, name, ok, detail }`；正判据与负对照都只走这一个函数。
 */
export function auditCiWorkflow(input) {
  const workflowText = String(input && input.workflowText ? input.workflowText : '');
  const scripts = (input && input.scripts) || {};
  const { steps } = parseWorkflow(workflowText);
  const npmSequence = npmRunSequence(steps);
  const checks = [];
  const add = (id, name, ok, detail) => {
    checks.push({ id, name, ok: !!ok, detail: String(detail == null ? '' : detail) });
  };
  const observed = npmSequence.length ? npmSequence.join(' → ') : '（空）';

  // ① 非空转地板：解析器一旦空转，下面每条都会假绿 ⇒ 先钉住"真的解析到了步骤"。
  add('step-floor',
    '步骤数地板：解析出的 CI 步骤 ≥ ' + STEP_FLOOR + ' 条（解析器空转 ⇒ 其余判据全假绿）',
    steps.length >= STEP_FLOOR, 'steps=' + steps.length);

  // ② 接线本体：门禁的顺序、有无、以及"有没有偷偷插一步"。
  const sequenceOk = npmSequence.length === EXPECTED_NPM_SEQUENCE.length
    && npmSequence.every((s, i) => s === EXPECTED_NPM_SEQUENCE[i]);
  add('npm-sequence-exact',
    'CI 的 npm run 步骤序列恰好是 ' + EXPECTED_NPM_SEQUENCE.join(' → ') + '（顺序、无遗漏、无插入）',
    sequenceOk, '实测：' + observed);

  // ③ 防悬空：workflow 里引用的脚本名必须在根 package.json 的 scripts 里真实存在。
  const missing = npmSequence.filter((s) => !Object.prototype.hasOwnProperty.call(scripts, s));
  add('npm-scripts-exist',
    '每个 npm run <script> 都在根 package.json 的 scripts 里真实存在（防改名/删脚本后 CI 悬空）',
    npmSequence.length > 0 && missing.length === 0,
    missing.length ? '悬空：' + missing.join(' ')
      : '校验 ' + npmSequence.length + ' 个脚本名 · 均在 scripts 里');

  // ④ 软档的定义：`continue-on-error` 只许长在 verify:docs 上，别处一律 fail-closed。
  const softIndex = steps.findIndex((s) => npmScriptOf(s) === SOFT_STEP);
  const coerce = steps.filter((s) => s.continueOnError);
  const offSoft = coerce
    .filter((s) => s.index !== softIndex)
    .map((s) => (npmScriptOf(s) || s.name || s.uses || '#' + (s.index + 1)));
  add('continue-on-error-soft-only',
    'continue-on-error 只允许出现在 ' + SOFT_STEP + ' 这一步（软档的定义：docs 组不拦 PR，其余一律 fail-closed）',
    softIndex >= 0 && coerce.length === 1 && coerce[0].index === softIndex,
    offSoft.length
      ? '越界步：' + offSoft.join(' ')
      : '软档步 #' + (softIndex + 1) + ' 带 continue-on-error · 其余 ' + (steps.length - (softIndex >= 0 ? 1 : 0)) + ' 步 fail-closed');

  // ⑤ 软档必须**真的**是软档：摘掉这一行，内务判据就会反过来拦下所有人的改动。
  const softCarries = softIndex >= 0 && steps[softIndex].continueOnError === true;
  add('soft-step-carries-soft-flag',
    SOFT_STEP + ' 步骤必须带 continue-on-error: true（否则软档变硬档：内务红会拦下所有人的改动）',
    softCarries,
    softIndex < 0 ? '找不到 ' + SOFT_STEP + ' 步' : 'continue-on-error=' + steps[softIndex].continueOnError);

  // ⑥ 非 npm 的产物出库判据必须真在跑（shell: bash + run 里确实有 git）。
  const bashSteps = steps.filter((s) => String(s.shell || '').trim() === 'bash');
  const artifactHits = bashSteps.filter((s) => !npmScriptOf(s) && String(s.run || '').includes(ARTIFACT_STEP_NEEDLE));
  add('bash-artifact-step',
    '至少一条 shell: bash 的非 npm 步，且 run 里出现 `' + ARTIFACT_STEP_NEEDLE + '`（产物出库判据真在跑，不是摆设）',
    artifactHits.length >= 1,
    'shell: bash 步 ' + bashSteps.length + ' 条 · 含 `' + ARTIFACT_STEP_NEEDLE + '` 的 ' + artifactHits.length + ' 条');

  // ⑦ 前置：没装依赖的话后面每一步的红都指向错误的原因（"缺依赖"而不是"真回归"）。
  const installIdx = installStepIndex(steps);
  const firstNpmIdx = steps.findIndex((s) => npmScriptOf(s));
  add('install-before-first-npm-run',
    '前置安装步 `' + INSTALL_COMMAND + '` 存在，且在第一条 npm run 之前',
    installIdx >= 0 && firstNpmIdx >= 0 && installIdx < firstNpmIdx,
    'install 步 #' + (installIdx + 1) + ' · 首个 npm run 步 #' + (firstNpmIdx + 1));

  return { steps, npmSequence, checks };
}

// ── 变异器（负对照专用；只改文本，绝不写盘）──────────────────────────────────
// 它们与判据共处一个模块，是为了让"负对照喂的就是同一个纯函数"这件事在文件层面成立：
// 变异器本身对不匹配的输入是**恒等**，于是入口可以自检"这次变异真的改了文本"。

function dropStepWhere(text, pred) {
  const { steps, lines } = parseWorkflow(text);
  const step = steps.find(pred);
  if (!step) return text;
  lines.splice(step.line, step.end - step.line);
  return lines.join('\n');
}

function swapStepWhere(text, predA, predB) {
  const { steps, lines } = parseWorkflow(text);
  const a = steps.find(predA);
  const b = steps.find(predB);
  if (!a || !b || a === b) return text;
  const [first, second] = a.line < b.line ? [a, b] : [b, a];
  const firstText = lines.slice(first.line, first.end);
  const secondText = lines.slice(second.line, second.end);
  return [
    ...lines.slice(0, first.line),
    ...secondText,
    ...lines.slice(first.end, second.line),
    ...firstText,
    ...lines.slice(second.end),
  ].join('\n');
}

/** 删掉 `npm run <script>` 那一步（含它的 name/run 行，不含其前后注释）。 */
export function dropStep(text, script) {
  return dropStepWhere(text, (s) => npmScriptOf(s) === script);
}

/** 按 `name:` 片段删步（给非 npm 步用，如 shell: bash 的产物出库步）。 */
export function dropStepNamed(text, nameFragment) {
  return dropStepWhere(text, (s) => String(s.name || '').includes(nameFragment));
}

/** 对调两个 `npm run <script>` 步。 */
export function swapSteps(text, scriptA, scriptB) {
  return swapStepWhere(text, (s) => npmScriptOf(s) === scriptA, (s) => npmScriptOf(s) === scriptB);
}

/** 按 `name:` 片段对调两步（给非 npm 步用，如 install 步）。 */
export function swapStepsNamed(text, nameA, nameB) {
  return swapStepWhere(text, (s) => String(s.name || '').includes(nameA), (s) => String(s.name || '').includes(nameB));
}

/** 给 `npm run <script>` 那一步加上/删掉 `continue-on-error: true`（`on=false` 时删除）。 */
export function setContinueOnError(text, script, on) {
  const { steps, lines } = parseWorkflow(text);
  const step = steps.find((s) => npmScriptOf(s) === script);
  if (!step) return text;
  const coAt = lines.findIndex((l, i) => i >= step.line && i < step.end && /^\s*continue-on-error\s*:/.test(l));
  if (!on) {
    if (coAt < 0) return text;
    lines.splice(coAt, 1);
    return lines.join('\n');
  }
  if (coAt >= 0) {
    lines[coAt] = (lines[coAt].match(/^\s*/) || [''])[0] + 'continue-on-error: true';
    return lines.join('\n');
  }
  const runAt = lines.findIndex((l, i) => i >= step.line && i < step.end && /^\s*run\s*:/.test(l));
  const indent = runAt >= 0 ? (lines[runAt].match(/^\s*/) || [''])[0] : ' '.repeat(step.indent + 2);
  lines.splice(runAt >= 0 ? runAt : step.end, 0, indent + 'continue-on-error: true');
  return lines.join('\n');
}

/** 把 `npm run <from>` 改名成 `npm run <to>`（只在那一行内改，不碰注释里的同名文本）。 */
export function renameNpmScript(text, from, to) {
  const { steps, lines } = parseWorkflow(text);
  const step = steps.find((s) => npmScriptOf(s) === from);
  if (!step) return text;
  for (let i = step.line; i < step.end; i += 1) lines[i] = lines[i].replace('npm run ' + from, 'npm run ' + to);
  return lines.join('\n');
}

/** 在某一步之后插入一条假的 `npm run <script>` 步（判"插入未知的一步必须红"）。 */
export function insertNpmStepAfter(text, afterScript, script) {
  const { steps, lines } = parseWorkflow(text);
  const step = steps.find((s) => npmScriptOf(s) === afterScript);
  if (!step) return text;
  const indent = ' '.repeat(step.indent);
  const keyIndent = ' '.repeat(step.indent + 2);
  lines.splice(step.end, 0,
    indent + '- name: ' + script + ' —— 判据注入口（负对照用，不属于真接线）',
    keyIndent + 'run: npm run ' + script);
  return lines.join('\n');
}
