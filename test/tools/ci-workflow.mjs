#!/usr/bin/env node
/**
 * ci-workflow.mjs — `.github/workflows/verify.yml` 的**作业结构判据**（纯函数库：不读盘、不写盘、无副作用）。
 *
 * ## 守的是什么实害（ADR-0004 / ADR-0014 S9 + CI 分流第一阶段）
 * 这个 workflow 是"提交前必须绿"那条铁律在 CI 上的**唯一**执行者。但它自己的**接线**
 * —— 跑哪些作业、哪条路径跑哪些步骤、什么顺序、哪一步允许失败 —— 此前**没有任何判据**：
 * 删掉 `verify:static` 或 `verify:bridge` 一步、把 `continue-on-error` 从软档挪到硬档、
 * 把 `ci/result` 的 `if: always()` 摘掉（docs 跳过时汇总作业跟着 skip ⇒ 假绿合入），
 * 全仓守卫照样全绿，而 CI 已经**静默少了一颗牙**。本文件把那根接线变成机器事实。
 *
 * ## 为什么是行扫描，而不是引一个 YAML 库
 * `test/verify-package-files.mjs` 的 P5 把整条 build/verify/smoke 链钉在**零裸依赖**上
 * （CI 只 `npm ci --omit=peer` 装运行期依赖，devDependencies 根本没装）。引 `js-yaml`
 * 会让这一步在 CI 上直接 `ERR_MODULE_NOT_FOUND` —— 判据自己先把链弄红。
 * 我们要断言的只有那几个键（`name` / `uses` / `run` / `shell` / `continue-on-error` / `if`），
 * 行扫描足够；形状变了会**判红**（作业齐全 + 步骤数地板 + 序列判据），不会静默放过。
 *
 * ## 为什么按**作业**解析，而不是"文件里第一个 steps:"
 * 分流之后工作流不再只有一个作业（changes 分类 / full 完整链 / docs 快通道 / ci/result 汇总），
 * 而"某个步骤在哪条路径上"本身就是判据 —— 只认第一个 `steps:` 会把全部判据对着错误的
 * 作业块比对：要么假红（逼人把作业挪回去迁就解析器），要么假绿（判据看的是别人的步骤）。
 * 判据按**覆盖责任**表达（`docs` 只做文档检查、`full` 保留完整序列、`ci/result` fail-closed），
 * 不按"文件里第 N 行是什么"。
 *
 * ## 为什么正判据与负对照共用一个函数（DEV-GUIDE §4.7 约定 5）
 * 所有断言逻辑都在 `auditCiWorkflow()` 里；`test/verify-ci-steps.mjs` 只做
 * "读盘 → 调它 → 打印 ✓/✗ → 非 0 退出"。负对照也只把**文本**变异后再喂回同一个函数，
 * 因此它是"同一个判据真的判红"，不是"打印一句应该会红"。
 */

/** CI 步骤表的仓库相对路径（判据的唯一输入）。 */
export const CI_WORKFLOW_REL = '.github/workflows/verify.yml';

/**
 * `full` 作业上 `npm run <script>` 步骤的**有序**序列 —— 完整验证链原样保留，不因分流缩水。
 * 改动它等于改动"哪些门在 PR 上真的会拦人"，因此必须显式、成对地改这份清单与 workflow。
 */
export const EXPECTED_NPM_SEQUENCE = [
  'verify:static', 'build', 'verify', 'verify:bridge', 'smoke',
];

/** `full` 必须按序包含的完整验证链（与上面的完整序列一致；判据名按"覆盖责任"表达）。 */
export const FULL_REQUIRED_SEQUENCE = EXPECTED_NPM_SEQUENCE;

/** 非空转地板：分流后 `full` 作业仍是 11 条步骤（含 3 条非 npm 步）。解析器空转 ⇒ 其余判据全假绿。 */
export const STEP_FLOOR = 10;

/** 运行期依赖安装步的**逐字**命令（"CI 不装 devDependencies"这个前提就写在它里面）。 */
export const INSTALL_COMMAND = 'npm ci --omit=peer --ignore-scripts --no-audit --no-fund';

/** 产物出库判据的指纹：CSS/产物出库那一类"非 npm 步骤"里必须真的在跑 git。 */
export const ARTIFACT_STEP_NEEDLE = 'git ls-files';

/**
 * 分流后必须齐全的五个作业（判据按 id 对账）：
 * `changes` 分类 → `full` / `docs` / `notice` 按路径三选一 → `ci/result` 汇总（唯一分支保护勾）。
 */
export const REQUIRED_JOBS = ['changes', 'full', 'docs', 'notice', 'result'];

/** 汇总作业的**固定**显示名（分支保护与人工读日志都按它认；改名即判红）。 */
export const RESULT_JOB_NAME = 'ci/result';

/**
 * 差异边界的**逐字符同一**表达式与模式档位（判据：diff-alignment）：changes 与 docs 两腿
 * 必须**按事件分支**审计同一份差异：
 *   · pull_request：base.sha/head.sha + `--base-mode merge-base` —— merge-base 完整 PR 差异；
 *   · push：before/after + `--base-mode exact` —— 精确推送范围（force-push 后 before 不是
 *     祖先，merge-base 会把 before 独有的代码删除算漏 ⇒ push 必须原样 diff，不取 merge-base）；
 *   · workflow_dispatch：github.sha/github.sha ⇒ 空差异 ⇒ 分类器保守 full。
 * 空串回退 `|| ''` 被禁止：parseArgs 对空值 exit 2，`''` 回退等于把注释当实现。
 */
export const DIFF_BASE_EXPR = 'github.event.pull_request.base.sha';
export const DIFF_HEAD_EXPR = 'github.event.pull_request.head.sha';
export const DIFF_PUSH_BASE_EXPR = 'github.event.before';
export const DIFF_PUSH_HEAD_EXPR = 'github.event.after';
export const DIFF_DISPATCH_EXPR = 'github.sha';
/** PR 差异边界模式档（collectDiff 取 merge-base —— PR 语义）。 */
export const BASE_MODE_MERGE_BASE = '--base-mode merge-base';
/** push 差异边界模式档（collectDiff 按 before→after 原样 diff —— force-push 安全）。 */
export const BASE_MODE_EXACT = '--base-mode exact';

/**
 * 信任边界 overlay 步的**整块指纹**（判据：trusted-gate；二审 F01 P02 实证 + 评审补洞）。
 *
 * 初版按"令牌在场 + 按行计数"校验，评审构造出一批一行级最小变异照样全绿：同一行串第二条
 * `git fetch`（后一次改写 FETCH_HEAD ⇒ 信任边界指向 PR merge commit）、`git show` 重定向改
 * `/dev/null`（文件保持 PR 树版本）、`BASE=FETCH_HEAD` 之后二次赋值、fetch 行尾追加 refspec。
 * 根因都一样：**令牌在场 ≠ 语义成立**。因此改为**整块逐字节全等** —— 四个判定作业
 * （changes / docs / notice / result）的 overlay run 块逐字相同（与 `INSTALL_COMMAND` 的
 * "逐字 pin"先例同款），改形状必须显式成对改这里与 workflow。
 *
 * push / dispatch 事件没有 PR base，回退 `BASE="${{ github.sha }}"` 是**合法**的
 * （push 的 github.sha 就是 main 上被推的提交本身，不存在"不可信的 PR 内容"）。
 * 行文取解析器口径：每行 trim 后以 `\n` 相接（parseStepsBlock 的块标量折叠规则）。
 */
export const TRUSTED_OVERLAY_RUN = [
  'set -euo pipefail',
  'if [ -n "${{ github.event.pull_request.base.ref }}" ]; then',
  'git fetch --no-tags origin "${{ github.event.pull_request.base.ref }}"',
  'BASE=FETCH_HEAD',
  'else',
  'BASE="${{ github.sha }}"',
  'fi',
  'for f in scripts/ci-routing.mjs test/tools/ci-routing.mjs test/tools/src-scope.mjs; do',
  'git show "$BASE:$f" > "$f"',
  'done',
].join('\n');
/** overlay 允许触碰的判定脚本（base ci-routing 链的全部三个文件；缺一 = 那个文件继续走 PR 树）。 */
export const TRUSTED_OVERLAY_FILES = ['scripts/ci-routing.mjs', 'test/tools/ci-routing.mjs', 'test/tools/src-scope.mjs'];
/** 分类器命令行的**逐字**形态（判据：changes-wiring；评审补洞：同行 `&&` 追加覆写必须红）。 */
export const CLASSIFIER_CLI_LINE = 'node scripts/ci-routing.mjs check --github-output "${BASE_ARGS[@]}"';
/** changes 作业 outputs.mode 的**逐字**映射（评审补洞：改指 bootstrap 步的输出必须红）。 */
export const CHANGES_OUTPUTS_MODE = '${{ steps.classify.outputs.mode }}';

/**
 * 四条 CLI 步 run 块的**整块指纹**（判据：changes-wiring / docs-fast-path / notice-fast-path /
 * result-gate；2026-11-09 评审补洞，实测越过判据的四种形态全部全绿）：
 *   · `classify` 步里**同一 run 再串一条**分类器（`node … check --github-output --base …`
 *     缩小差异范围）——按步计数只看到一条步，后写的那次覆盖 outputs.mode；
 *   · 四条 CLI 行尾追加 `|| true`（judgeResult / docs / notice / classify）——
 *     判据只查"字符串在场"，退出码被抑制后 full 链/汇总器失败照样绿；
 *   · judgeResult 的**参数被换成常量**（`--full "${{ needs.full.result }}"` → `--full success`）
 *     ——汇总器永远放行，判据只查"有 judgeResult 这个串"；
 *   · CLI 步挂 `env: NODE_OPTIONS: --require …` / 改 `shell:` 模板 —— run 一字未动，
 *     单看 run 的指纹看不见（node 侧可改退出码）。
 * 根因同 trusted-gate 的 overlay：**令牌在场 ≠ 语义成立**。因此 CLI 步也改为**整块逐字全等**
 * （与 `INSTALL_COMMAND` / `TRUSTED_OVERLAY_RUN` 同款），并把 CLI 步允许出现的 YAML 键收窄到
 * allowlist（`CLI_STEP_KEYS`）：多出 `env:` / `working-directory:` / `uses:` 等键 = 判红。
 * 改写 CLI 步的形状必须显式成对改这里与 workflow —— 这正是"门禁接线也是代码"的代价。
 */
export const CLASSIFY_RUN = [
  'if [ -n "${{ github.event.pull_request.base.sha }}" ]; then',
  'BASE_ARGS=(--base "${{ github.event.pull_request.base.sha }}" --head "${{ github.event.pull_request.head.sha }}" --base-mode merge-base)',
  'elif [ -n "${{ github.event.before }}" ]; then',
  'BASE_ARGS=(--base "${{ github.event.before }}" --head "${{ github.event.after }}" --base-mode exact)',
  'else',
  'BASE_ARGS=(--base "${{ github.sha }}" --head "${{ github.sha }}" --base-mode exact)',
  'fi',
  'node scripts/ci-routing.mjs check --github-output "${BASE_ARGS[@]}"',
].join('\n');
/** docs 快通道 CLI 步 run 块的逐字指纹（同一事件分支 + `docs` 子命令）。 */
export const DOCS_CLI_RUN = [
  'if [ -n "${{ github.event.pull_request.base.sha }}" ]; then',
  'BASE_ARGS=(--base "${{ github.event.pull_request.base.sha }}" --head "${{ github.event.pull_request.head.sha }}" --base-mode merge-base)',
  'elif [ -n "${{ github.event.before }}" ]; then',
  'BASE_ARGS=(--base "${{ github.event.before }}" --head "${{ github.event.after }}" --base-mode exact)',
  'else',
  'BASE_ARGS=(--base "${{ github.sha }}" --head "${{ github.sha }}" --base-mode exact)',
  'fi',
  'node scripts/ci-routing.mjs docs "${BASE_ARGS[@]}"',
].join('\n');
/** notice 快通道 CLI 步 run 块的逐字指纹（同一事件分支 + `notice` 子命令）。 */
export const NOTICE_CLI_RUN = DOCS_CLI_RUN.replace('ci-routing.mjs docs', 'ci-routing.mjs notice');
/** 汇总作业 judgeResult 步 run 块的逐字指纹（参数映射原样 pin：改一个常量 = 汇总器恒放行）。 */
export const RESULT_JUDGE_RUN = [
  'node scripts/ci-routing.mjs judgeResult \\',
  '--mode "${{ needs.changes.outputs.mode }}" \\',
  '--changes "${{ needs.changes.result }}" \\',
  '--docs "${{ needs.docs.result }}" \\',
  '--notice "${{ needs.notice.result }}" \\',
  '--full "${{ needs.full.result }}" \\',
  '--github-output',
].join('\n');

/**
 * CLI 步允许出现的键（解析器内部键也算）。多出来的键就是**整步级旁路**：
 * `env:`（NODE_OPTIONS/BASH_ENV 注入）、`working-directory:`（换目录跑别的同名脚本）、
 * `uses:`（把 run 换成 composite action）。判据要求 CLI 步是"纯 run 步"。
 */
export const CLI_STEP_KEYS = ['index', 'line', 'end', 'indent', 'name', 'uses', 'run', 'shell', 'continueOnError', 'if', 'id'];

/** 这一步多出来的 YAML 键（不在 CLI_STEP_KEYS 里）；空数组 = 形状干净。 */
export function unexpectedStepKeys(step) {
  if (!step) return ['缺步骤'];
  return Object.keys(step).filter((k) => !CLI_STEP_KEYS.includes(k));
}

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

/** flow 序列 `[a, b]` → `['a', 'b']`（去引号去空）。 */
function flowList(value) {
  return String(value == null ? '' : value)
    .replace(/^\[/, '').replace(/\]$/, '')
    .split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

/**
 * 行扫描一个 `steps:` 列表（`[stepsAt, jobEnd)` 行区间），返回步骤对象：
 * `{ index, line, end, indent, name, uses, run, shell, continueOnError, if }`
 * （`line`/`end` 是 `lines` 里的 0-based 半开区间，供变异器整块增删）。
 *
 * 只认 YAML 里我们真正要断言的部分：列表项 `- name:` / `- uses:`，以及项内同级的
 * `run:` / `shell:` / `continue-on-error:` / `if:`；`run: |` / `run: >` 这种块标量按缩进收满。
 * 缩进回到 `steps:` 级（或越过 `jobEnd`）⇒ 步骤段结束。
 */
function parseStepsBlock(lines, stepsAt, jobEnd) {
  const stepsIndent = lineIndent(lines[stepsAt]);
  const steps = [];
  let current = null;
  let blockKey = '';
  let blockIndent = -1;
  for (let i = stepsAt + 1; i < jobEnd; i += 1) {
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
        name: '', uses: '', run: '', shell: '', continueOnError: false, if: '',
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
    const next = steps[step.index + 1] ? steps[step.index + 1].line : jobEnd;
    let end = next;
    // 尾随空行/注释行属于**下一条**步骤的说明，不算本步的行跨度。
    while (end > step.line + 1 && isBlankOrComment(lines[end - 1])) end -= 1;
    step.end = Math.min(end, jobEnd);
  }
  return steps;
}

/**
 * 行扫描整个 `jobs:` 段，返回**作业感知**的解析结果：
 * `{ jobs, steps, lines }`；`jobs` 每项 `{ id, name, needs, runsOn, if, steps }`，
 * `steps` 是全部作业步骤的扁平拼接（`jobs` 声明顺序），供沿用旧消费形态的调用方使用。
 * 找不到 `jobs:` ⇒ 空（上游的作业齐全判据会因此判红，而不是静默通过）。
 */
export function parseWorkflow(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const jobsAt = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (jobsAt < 0) return { jobs: [], steps: [], lines };
  const jobsIndent = lineIndent(lines[jobsAt]);
  // 作业头：`jobs:` 下缩进 +2 的 `id:` 键行。
  const heads = [];
  for (let i = jobsAt + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const indent = lineIndent(line);
    if (indent <= jobsIndent) break;
    if (indent !== jobsIndent + 2) continue;
    const m = /^([A-Za-z_][\w-]*):\s*$/.exec(line.trim());
    if (m) heads.push({ id: m[1], line: i });
  }
  const jobs = heads.map((h, idx) => {
    const end = idx + 1 < heads.length ? heads[idx + 1].line : lines.length;
    return { id: h.id, line: h.line, end, name: '', needs: [], runsOn: '', if: '', outputs: {}, steps: [] };
  });
  for (const job of jobs) {
    const jobIndent = lineIndent(lines[job.line]);
    let stepsAt = -1;
    for (let i = job.line + 1; i < job.end; i += 1) {
      const line = lines[i];
      if (!line.trim() || /^\s*#/.test(line)) continue;
      const indent = lineIndent(line);
      if (indent <= jobIndent) break;
      if (indent !== jobIndent + 2) continue;
      const kv = readKeyValue(line);
      if (!kv) continue;
      if (kv.key === 'steps') stepsAt = i;
      else if (kv.key === 'name') job.name = kv.value.replace(/^['"]|['"]$/g, '');
      else if (kv.key === 'runs-on') job.runsOn = kv.value;
      else if (kv.key === 'if') job.if = kv.value;
      else if (kv.key === 'needs' && kv.value) job.needs = flowList(kv.value);
      else if (kv.key === 'outputs') {
        // outputs 条目比 `outputs:` 再深一层（jobIndent + 4）；回到 jobIndent + 2 及以下 ⇒ 块结束。
        for (let j = i + 1; j < job.end; j += 1) {
          const l2 = lines[j];
          if (!l2.trim() || /^\s*#/.test(l2)) continue;
          if (lineIndent(l2) <= jobIndent + 2) break;
          const kv2 = readKeyValue(l2);
          if (kv2) job.outputs[kv2.key] = kv2.value;
        }
      }
    }
    // block 形式的 needs（`needs:` 换行后逐个 `- id`）。
    for (let i = job.line + 1; i < job.end; i += 1) {
      const line = lines[i];
      if (!line.trim() || /^\s*#/.test(line)) continue;
      const indent = lineIndent(line);
      if (indent <= jobIndent) break;
      const kv = readKeyValue(line);
      if (!kv || kv.key !== 'needs' || kv.value) continue;
      for (let j = i + 1; j < job.end; j += 1) {
        const l2 = lines[j];
        if (!l2.trim()) continue;
        if (lineIndent(l2) <= indent) break;
        const it = ITEM_RE.exec(l2);
        if (it) job.needs.push(it[2].trim().replace(/^['"]|['"]$/g, ''));
      }
    }
    if (stepsAt >= 0) job.steps = parseStepsBlock(lines, stepsAt, job.end);
  }
  const steps = jobs.flatMap((j) => j.steps);
  return { jobs, steps, lines };
}

/** 这一步的 `run:` 是不是 `npm run <script>`；是则返回脚本名，否则 `''`。 */
export function npmScriptOf(step) {
  const m = /(?:^|\s)npm run ([\w:.-]+)/.exec(String(step && step.run ? step.run : ''));
  return m ? m[1] : '';
}

/**
 * 有序的 `npm run <script>` 序列（扁平：按作业声明顺序拼接全部作业）。
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

/**
 * 一条步骤的 `run:` 折成**逐行**（去缩进、去空行）。
 *
 * 为什么必须逐行：`run: |` 是块标量，一个步骤里可以塞任意多条命令。判据只对**首行**做
 * `startsWith` 时，"把安装藏到第二行"就能从判据底下溜过去 —— 实测（C3 盲区 A）：
 * docs 腿插一条 `run: |` / `set -e` / `npm ci …` 的步骤，`docs-fast-path` 的
 * `install=0` 依旧报绿，而这步在 CI 上**真的装了依赖**。
 */
export function runLines(step) {
  return String(step && step.run ? step.run : '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/** 这一步是否真的在跑安装命令（**逐行**逐字比对：多行 run 里藏在第二行也算）。 */
export function installsDeps(step) {
  return runLines(step).some((l) => l.startsWith(INSTALL_COMMAND));
}

/** 安装步的下标（找不到 ⇒ -1）。逐字比对命令，防止"看起来装了、其实少了 --omit=peer"。 */
export function installStepIndex(steps) {
  return steps.findIndex((s) => installsDeps(s));
}

/**
 * 顶层 `permissions:` 块（`on:` / `jobs:` 之前）折成 `{ scope: access }`；没有这个块 ⇒ `null`。
 *
 * 为什么必须单独判：`fork-safety` 只查 `pull_request_target` 与顶层 `paths-ignore` 两个**坏形态**，
 * 对"**把整个 `permissions:` 块删掉**"无感 —— 实测（C3 盲区 B）删掉后 `auditCiWorkflow` 全绿，
 * 而删掉意味着作业回落到仓库默认权限（可能含 write），这正是最小权限声明要挡的事。
 */
export function topLevelPermissions(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const at = lines.findIndex((l) => /^permissions:\s*$/.test(l));
  if (at < 0) return null;
  const out = {};
  for (let i = at + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (lineIndent(line) === 0) break; // 回到顶层键 ⇒ 块结束
    const kv = readKeyValue(line);
    if (kv) out[kv.key] = kv.value.replace(/^['"]|['"]$/g, '');
  }
  return out;
}

/**
 * 判据本体（纯函数）：`{ workflowText, scripts }` → `{ jobs, steps, npmSequence, checks }`。
 * `checks` 每项 `{ id, name, ok, detail }`；正判据与负对照都只走这一个函数。
 * 判据按**覆盖责任**分组：作业齐全 / full 完整链 / docs 快通道边界 / 软档定义 /
 * 分类接线 / 汇总 fail-closed / fork 安全 / checkout 深度 / 脚本存在性 / 出库步真在跑。
 */
export function auditCiWorkflow(input) {
  const workflowText = String(input && input.workflowText ? input.workflowText : '');
  const scripts = (input && input.scripts) || {};
  const { jobs, steps } = parseWorkflow(workflowText);
  const npmSequence = npmRunSequence(steps);
  const checks = [];
  const add = (id, name, ok, detail) => {
    checks.push({ id, name, ok: !!ok, detail: String(detail == null ? '' : detail) });
  };
  const jobOf = (id) => jobs.find((j) => j.id === id);
  const full = jobOf('full');
  const docs = jobOf('docs');
  const changes = jobOf('changes');
  const result = jobOf('result');
  const ids = jobs.map((j) => j.id);
  const fullScripts = full ? npmRunSequence(full.steps) : [];
  const briefOf = (s, n = 60) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n) || '（空）';

  // ① 作业齐全：changes / full / docs / result 四个都在（缺任何一个 ⇒ 分流残废）。
  const missingJobs = REQUIRED_JOBS.filter((id) => !ids.includes(id));
  add('job-structure',
    '作业齐全（' + REQUIRED_JOBS.join(' / ') + '）：分流后每个作业都承担一段覆盖责任，缺一即假绿',
    missingJobs.length === 0,
    missingJobs.length ? '缺作业：' + missingJobs.join(' ') : 'ids=' + JSON.stringify(ids));

  // ② 非空转地板：full 作业的步骤数（解析器一旦空转，下面每条都会假绿 ⇒ 先钉住）。
  add('step-floor',
    'full 作业步骤数 ≥ 地板 ' + STEP_FLOOR + '（解析器空转 ⇒ 其余判据全假绿）',
    !!full && full.steps.length >= STEP_FLOOR,
    full ? 'full steps=' + full.steps.length : '缺 full 作业');

  // ③ full 的覆盖责任：完整 npm 序列恰好、装依赖在第一次 npm run 之前、产物出库判据真在跑。
  const seqExact = fullScripts.length === FULL_REQUIRED_SEQUENCE.length
    && fullScripts.every((s, i) => s === FULL_REQUIRED_SEQUENCE[i]);
  const installIdx = full ? installStepIndex(full.steps) : -1;
  const firstNpmIdx = full ? full.steps.findIndex((s) => npmScriptOf(s)) : -1;
  const artifactHit = !!full && full.steps.some((s) => String(s.run || '').includes(ARTIFACT_STEP_NEEDLE));
  add('full-coverage',
    'full 覆盖责任：npm 序列恰好 ' + FULL_REQUIRED_SEQUENCE.join(' → ')
    + ' · `' + INSTALL_COMMAND + '` 在第一条 npm run 之前 · 产物出库判据（' + ARTIFACT_STEP_NEEDLE + '）在链上',
    !!full && seqExact && installIdx >= 0 && firstNpmIdx >= 0 && installIdx < firstNpmIdx && artifactHit,
    full ? 'npm=' + JSON.stringify(fullScripts) + ' install@' + installIdx + ' firstNpm@' + firstNpmIdx
      + ' artifact=' + artifactHit : '缺 full 作业');

  // ④ docs 快通道边界：核心步必须是**真 docs CLI**（`node scripts/ci-routing.mjs docs`），
  //    且与 changes 取**同一份 PR 差异**（--base/--head 表达式与 changes 腿逐字符同一，
  //    见 DIFF_BASE_EXPR/DIFF_HEAD_EXPR）—— warn-only 内务 `npm run verify:docs` 已移到定时 housekeeping，
  //    拦不住冲突标记/断链/素材问题，不能顶替分类审计（队内裁定）。
  //    不许装依赖、不许混入任何 `npm run` 门禁步、不许偷偷跑 verify:docs、必须有路径 if 守卫。
  //    docs 腿 checkout 还必须显式 ref 到 head 表达式（否则审计树 ≠ 实际 head 树）。
  const docsCliHits = docs
    ? docs.steps.filter((s) => /node\s+\S*ci-routing\.mjs\s+docs(?:\s|$)/.test(String(s.run || '')))
    : [];
  const diffAligned = (run) => String(run || '').includes(DIFF_BASE_EXPR) && String(run || '').includes(DIFF_HEAD_EXPR);
  const diffAlignedFull = (run) => {
    const t = String(run || '');
    // 三个事件分支都齐：PR 档（merge-base）、push 档（exact）、dispatch 档（保守 full）。
    return diffAligned(t) && t.includes(DIFF_PUSH_BASE_EXPR) && t.includes(DIFF_PUSH_HEAD_EXPR)
      && t.includes(DIFF_DISPATCH_EXPR) && t.includes(BASE_MODE_MERGE_BASE) && t.includes(BASE_MODE_EXACT);
  };
  const docsStep = docsCliHits.length === 1 ? docsCliHits[0] : null;
  const docsSameDiff = !!docsStep && diffAlignedFull(docsStep.run);
  const docsRunExact = !!docsStep && String(docsStep.run || '') === DOCS_CLI_RUN;
  const docsExtra = docsStep ? unexpectedStepKeys(docsStep) : ['缺步骤'];
  const docsShell = docsStep ? String(docsStep.shell || '').trim() : '';
  const docsClean = !!docsStep && docsShell === 'bash'
    && !String(docsStep.if || '').trim() && !docsStep.continueOnError && docsExtra.length === 0;
  const docsHeadCheckout = docs ? docs.steps.some((s) => String(s.ref || '').includes(DIFF_HEAD_EXPR)) : false;
  const docsNpmSteps = docs ? docs.steps.filter((s) => npmScriptOf(s)) : [];
  //    「不装依赖」按**逐行**判（`installsDeps`）：只比首行时，`run: |` 把安装藏到第二行
  //    （首行 `set -e`）就从判据底下溜过去 —— 实测 install=0 仍报绿（C3 盲区 A）。
  const docsInstalls = docs ? docs.steps.filter((s) => installsDeps(s)) : [];
  add('docs-fast-path',
    'docs 快通道边界：核心步是真 docs CLI（ci-routing.mjs docs · run 块与 DOCS_CLI_RUN **逐字全等**'
    + ' · --base/--head 与 changes 按事件分支同一 · 纯 run 步：shell: bash，无 if/env/working-directory/uses）'
    + ' · checkout ref 指向 head 树 · 零 npm run 步（不许混入 verify:docs 内务或别的门禁）· 不装依赖 · 有路径 if 守卫',
    !!docs && !!docsStep && docsSameDiff && docsRunExact && docsClean && docsHeadCheckout
      && docsNpmSteps.length === 0 && docsInstalls.length === 0
      && String(docs.if || '').trim().length > 0,
    docs ? 'cli=' + docsCliHits.length + ' sameDiff=' + docsSameDiff + ' run块逐字=' + docsRunExact
      + ' shell=' + (docsShell || '缺') + ' 多余键=' + JSON.stringify(docsExtra) + ' headRef=' + docsHeadCheckout
      + ' npm=' + JSON.stringify(docsNpmSteps.map(npmScriptOf)) + ' install=' + docsInstalls.length
      + ' if=' + briefOf(docs.if) : '缺 docs 作业');

  // ④-b 公告快通道边界：核心步必须是**真 notice CLI**（`node scripts/ci-routing.mjs notice`），
  //     且与 changes 取**同一份差异**（三种事件分支齐）。同样：零 npm run 步、不装依赖、
  //     有路径 if 守卫、checkout 指到 head 树。
  //     额外一条（这条通道独有的实害）：notice 作业的**内容级判据**依赖 `git show <base>:<path>`
  //     取旧版内容 ⇒ fetch-depth 必须是 0；浅克隆会让判据 fail-closed 阻断 —— 那是安全方向，
  //     但会把"纯公告改动"永久判红，等于通道不可用 ⇒ 用判据钉住它真的在。
  const noticeJob = jobOf('notice');
  const noticeCliHits = noticeJob
    ? noticeJob.steps.filter((s) => /node\s+\S*ci-routing\.mjs\s+notice(?:\s|$)/.test(String(s.run || '')))
    : [];
  const noticeStep = noticeCliHits.length === 1 ? noticeCliHits[0] : null;
  const noticeSameDiff = !!noticeStep && diffAlignedFull(noticeStep.run);
  const noticeRunExact = !!noticeStep && String(noticeStep.run || '') === NOTICE_CLI_RUN;
  const noticeExtra = noticeStep ? unexpectedStepKeys(noticeStep) : ['缺步骤'];
  const noticeShell = noticeStep ? String(noticeStep.shell || '').trim() : '';
  const noticeClean = !!noticeStep && noticeShell === 'bash'
    && !String(noticeStep.if || '').trim() && !noticeStep.continueOnError && noticeExtra.length === 0;
  const noticeHeadCheckout = noticeJob
    ? noticeJob.steps.some((s) => String(s.ref || '').includes(DIFF_HEAD_EXPR)) : false;
  const noticeNpmSteps = noticeJob ? noticeJob.steps.filter((s) => npmScriptOf(s)) : [];
  const noticeInstalls = noticeJob ? noticeJob.steps.filter((s) => installsDeps(s)) : [];
  add('notice-fast-path',
    'notice 快通道边界：核心步是真 notice CLI（ci-routing.mjs notice · run 块与 NOTICE_CLI_RUN **逐字全等**'
    + ' · --base/--head 与 changes 按事件分支同一 · 纯 run 步：shell: bash，无 if/env/working-directory/uses）'
    + ' · checkout ref 指向 head 树 · 零 npm run 步 · 不装依赖 · 有路径 if 守卫',
    !!noticeJob && !!noticeStep && noticeSameDiff && noticeRunExact && noticeClean && noticeHeadCheckout
      && noticeNpmSteps.length === 0 && noticeInstalls.length === 0
      && String(noticeJob.if || '').trim().length > 0,
    noticeJob ? 'cli=' + noticeCliHits.length + ' sameDiff=' + noticeSameDiff + ' run块逐字=' + noticeRunExact
      + ' shell=' + (noticeShell || '缺') + ' 多余键=' + JSON.stringify(noticeExtra) + ' headRef=' + noticeHeadCheckout
      + ' npm=' + JSON.stringify(noticeNpmSteps.map(npmScriptOf)) + ' install=' + noticeInstalls.length
      + ' if=' + briefOf(noticeJob.if) : '缺 notice 作业');

  // ⑤ 软档已撤出 full 链：`verify:docs` 是仓库内务（非文档检查），按 ADR-0017 移到
  //    `.github/workflows/housekeeping.yml` 定时跑；本链因此**不允许任何 continue-on-error**，
  //    所有步骤都必须是 fail-closed 的（否则就是"灰档"）。
  const coerce = steps.filter((s) => s.continueOnError);
  add('soft-tier',
    'full 链不再有软档（verify:docs 已移入定时 housekeeping）：continue-on-error 一律不允许出现',
    coerce.length === 0,
    coerce.length
      ? '越界步：' + coerce.map((s) => (npmScriptOf(s) || s.name || s.uses || '#' + (s.index + 1))).join(' ')
      : 'continue-on-error 步数=0');

  // ⑥ 分类接线：changes 作业真的在调分类器、把 mode 写进 GITHUB_OUTPUT，且差异边界与 docs
  //    腿**同一表达式**（丢掉 --base/--head ⇒ 与 docs 各审各的，非同一差异 ⇒ 判红；
  //    退化为父提交/最后提交同罪——表达式就是三种事件的完整范围，见 DIFF_BASE_EXPR）。
  //    二审 F01 P03 实证的"接线还在、结论被换"形态 + 评审补洞（同行 `&&` 追加、outputs 改指、
  //    变量间接写）都必须判红 —— 后写的 mode 赢，分类结论被换成 docs 就能让 full 链整段跳过：
  //      · 分类器命令行**逐字**等于 CLASSIFIER_CLI_LINE（同行夹带任何尾巴 ⇒ 不全等 ⇒ 红）；
  //      · 分类器行**之后**的行（注释行不算——注释不执行，口径与 installsDeps 的"提及不算"
  //        对齐）不得再写 mode / GITHUB_OUTPUT；
  //      · 分类器**之后的任何步骤**不得触碰 GITHUB_OUTPUT（不要求带 mode 字样——变量间接写
  //        如 `printf "$OUT_KEY=docs" >> …` 同样拦下）；
  //      · `id: classify` 恰好一条，且作业级 outputs.mode **逐字**等于 CHANGES_OUTPUTS_MODE
  //        （改指 bootstrap 步的输出 ⇒ 红）。
  //      · 分类器行**之前**的 GITHUB_OUTPUT 写出不算（分类器随后必然覆盖它；分类器不写 = 作业红）。
  const CLASSIFIER_CLI = /node\s+\S*ci-routing\.mjs\s+check\s+--github-output/;
  const classifyHits = changes
    ? changes.steps.filter((s) => CLASSIFIER_CLI.test(String(s.run || '')))
    : [];
  const classifyStep = classifyHits.length === 1 ? classifyHits[0] : null;
  const classifyIdx = classifyStep ? changes.steps.indexOf(classifyStep) : -1;
  const classifyLineAt = classifyStep
    ? runLines(classifyStep).findIndex((l) => CLASSIFIER_CLI.test(l))
    : -1;
  const classifierLineExact = classifyLineAt >= 0
    && runLines(classifyStep)[classifyLineAt] === CLASSIFIER_CLI_LINE;
  // 整块逐字 pin：同 run 串第二条分类器（缩小差异范围/后写覆盖 mode）、行尾 `|| true` 抑制退出码、
  // 事件分支退化 —— 全部只能通过"改文本"发生 ⇒ 文本不全等即判红（令牌在场 ≠ 语义成立）。
  const classifierRunExact = !!classifyStep && String(classifyStep.run || '') === CLASSIFY_RUN;
  // 整步级旁路：env（NODE_OPTIONS/BASH_ENV）/ working-directory / uses / if / continue-on-error / 非 bash shell。
  const classifyExtra = classifyStep ? unexpectedStepKeys(classifyStep) : ['缺步骤'];
  const classifyShell = classifyStep ? String(classifyStep.shell || '').trim() : '';
  const classifyClean = !!classifyStep && classifyShell === 'bash'
    && !String(classifyStep.if || '').trim() && !classifyStep.continueOnError && classifyExtra.length === 0;
  const sameStepOverwrite = classifyLineAt >= 0
    && runLines(classifyStep).slice(classifyLineAt + 1)
      .some((l) => !l.startsWith('#') && (/GITHUB_OUTPUT/.test(l) || /\bmode\s*=/.test(l)));
  const laterOverwrite = classifyIdx >= 0 && changes.steps.slice(classifyIdx + 1)
    .some((s) => /GITHUB_OUTPUT/.test(String(s.run || '')));
  const classifyIds = changes
    ? changes.steps.filter((s) => String(s.id || '').trim() === 'classify').length
    : 0;
  const outputsModePinned = !!changes && changes.outputs.mode === CHANGES_OUTPUTS_MODE;
  const changesAligned = !!changes && classifyHits.length === 1 && diffAlignedFull(classifyStep.run);
  add('changes-wiring',
    'changes 作业恰好一条真分类器步（id: classify 唯一 · run 块与 CLASSIFY_RUN **逐字全等** · outputs.mode 逐字 pin）、'
    + 'CLI 步是纯 run 步（只许 shell: bash；不得挂 if / continue-on-error / env / working-directory / uses）、'
    + '其后同一步（注释除外）与后续步都不得再写 GITHUB_OUTPUT（后写即覆盖分类结论）、'
    + '差异边界与 docs 腿**按事件分支**同一'
    + '（PR=merge-base 档 / push=exact 档 / dispatch=保守 full；丢分支或丢 --base-mode ⇒ 判红）',
    changesAligned && classifierRunExact && classifyClean && !sameStepOverwrite && !laterOverwrite
      && classifyIds === 1 && outputsModePinned,
    changes ? '接线步=' + classifyHits.length + ' alignedFull=' + (classifyStep ? diffAlignedFull(classifyStep.run) : false)
      + ' 行逐字=' + classifierLineExact + ' run块逐字=' + classifierRunExact
      + ' shell=' + (classifyShell || '缺') + ' 多余键=' + JSON.stringify(classifyExtra)
      + ' 同步覆写=' + sameStepOverwrite + ' 后续覆写=' + laterOverwrite
      + ' id/classify=' + classifyIds + ' outputs.mode=' + (outputsModePinned ? 'pin' : String(changes.outputs.mode || '缺'))
      : '缺 changes 作业');

  // ⑦ 汇总 fail-closed：ci/result 用 judgeResult 核验"该跑的作业真的 success"，
  //    且 `if: always()`（**只认作业级**：docs/full 按设计跳过时汇总作业仍要被调度执行；
  //    步骤级写法在作业整体被 skip 时根本不会执行，等于没写。二审 F01 P04 实证：旧判据用
  //    "作业有 always **或任一步有 always**"放行 —— 恰好接受了它自己注释里写明的坏形态，
  //    见 GitHub needs 语义：依赖被 skip 时其步骤不会救活作业）、且 needs 三条腿齐全。
  const resultNeedsOk = !!result && ['changes', 'docs', 'notice', 'full'].every((n) => result.needs.includes(n));
  // 作业级 if 必须**逐字**等于 always()：子串匹配放行 `always() && false` /
  // `always() && github.event_name == 'push'` —— PR 事件下汇总作业被 skip，而 GitHub 把必需
  // check 的 skipped 与 success 同形对待 ⇒ 假绿合入（2026-11-09 评审实测，见 verify-ci-steps 负对照）。
  const resultIf = result ? String(result.if || '').trim() : '';
  const resultAlways = resultIf === 'always()';
  const resultAlwaysStepOnly = !!result && !resultAlways
    && result.steps.some((s) => /always\(\)/.test(String(s.if || '')));
  // judgeResult 步：恰好一条、run 块逐字等于 RESULT_JUDGE_RUN（`--full success` 这类参数替换 =
  // 汇总器恒放行）、纯 run 步（此前只查"有 judgeResult 这个串"：`|| true`、env 注入、非默认
  // shell 都能骗过它）。
  const judgeHits = result ? result.steps.filter((s) => String(s.run || '').includes('judgeResult')) : [];
  const judgeStep = judgeHits.length === 1 ? judgeHits[0] : null;
  const judgeRunExact = !!judgeStep && String(judgeStep.run || '') === RESULT_JUDGE_RUN;
  const judgeExtra = judgeStep ? unexpectedStepKeys(judgeStep) : ['缺步骤'];
  const judgeClean = !!judgeStep && !String(judgeStep.shell || '').trim()
    && !String(judgeStep.if || '').trim() && !judgeStep.continueOnError && judgeExtra.length === 0;
  add('result-gate',
    '汇总作业 needs [changes, docs, notice, full] · 作业级 if **逐字** always()（子串不算：'
    + '`always() && false` 会让汇总作业被 skip） · judgeResult 步恰好一条且 run 块逐字等于 RESULT_JUDGE_RUN'
    + '（参数映射逐一 pin · 纯 run 步：无 shell/env/if/continue-on-error）',
    !!result && resultNeedsOk && resultAlways && judgeRunExact && judgeClean,
    result ? 'needs=' + JSON.stringify(result.needs) + ' if=' + briefOf(result.if, 60) + ' 逐字always=' + resultAlways
      + (resultAlwaysStepOnly ? '（步骤级有但作业级不逐字 —— 不作数）' : '')
      + ' judge步=' + judgeHits.length + ' run块逐字=' + judgeRunExact + ' 多余键=' + JSON.stringify(judgeExtra)
      : '缺 result 作业');

  // ⑦-b 判定脚本信任边界（P0）：changes / docs / notice / result 四个作业都必须先取 base 分支的
  //     判定脚本（`git show <base>:scripts/ci-routing.mjs`），**之后**才允许执行 `node scripts/ci-routing.mjs`。
  //     否则 PR 可改分类器/汇总器，让自己的 full 链整段跳过；fail-closed 只对"作业失败"成立，
  //     对"判定器被改"不成立。
  //     二审 F01 P02 实证旧判据失明（`BASE=FETCH_HEAD` 换成 github.sha 照样全绿）；初版"令牌
  //     在场 + 按行计数"的指纹又被评审构造出一批一行级绕过（同行串第二条 fetch / show 重定向
  //     丢弃 / BASE 二次赋值 / 行尾追加 refspec）。根因是**令牌在场 ≠ 语义成立**，因此升格为
  //     **整块逐字节全等**（TRUSTED_OVERLAY_RUN，四个作业的 overlay 块逐字相同），外加三条
  //     边界钉：overlay 步不得挂 if / continue-on-error（挂了 = 运行时整步跳过、文件保持 PR
  //     树版本）；作业内**只许** overlay 与 CLI 两步触碰判定脚本路径（多出一步 = 可以用
  //     `git checkout <head> -- scripts/ci-routing.mjs` 之类的恢复步把 PR 版判定器换回来）；
  //     overlay 必须在 CLI 之前。
  //     ⚠️ 残余边界（如实写明，不夸大）：不点名判定脚本路径的整树恢复（如 `git checkout . `）
  //     不在本判据射程内 —— 检查器自身活在 PR 可改的 workflow 里，机器上没有最终信任根，
  //     这是 D01（信任边界决策）的领域，不是本判据能单独解决的。
  const TRUSTED_PATH_RE = /scripts\/ci-routing\.mjs|test\/tools\/ci-routing\.mjs|test\/tools\/src-scope\.mjs/;
  const gateJobIds = ['changes', 'docs', 'notice', 'result'];
  const gateFailures = [];
  for (const id of gateJobIds) {
    const job = jobOf(id);
    if (!job) { gateFailures.push(id + ':缺作业'); continue; }
    const overlays = job.steps.filter((s) => /git show/.test(String(s.run || ''))
      && /scripts\/ci-routing\.mjs/.test(String(s.run || '')));
    if (overlays.length !== 1) { gateFailures.push(id + ':overlay步=' + overlays.length); continue; }
    const overlay = overlays[0];
    const overlayIdx = job.steps.indexOf(overlay);
    if (String(overlay.run || '') !== TRUSTED_OVERLAY_RUN) {
      gateFailures.push(id + ':overlay 与 TRUSTED_OVERLAY_RUN 指纹不全等'); continue;
    }
    if (String(overlay.if || '').trim() || overlay.continueOnError) {
      gateFailures.push(id + ':overlay 步挂了 if / continue-on-error（运行时可整步跳过）'); continue;
    }
    // 整步级旁路：override 的 run 一字未动，只把 shell 模板换成 `bash {0} || true`（失败不致命）
    // 或挂 env（GIT_CONFIG_* / BASH_ENV）—— overlay 必须是纯 run 步。
    if (String(overlay.shell || '').trim() !== 'bash') {
      gateFailures.push(id + ':overlay 步 shell 不是 bash（shell 模板可吞掉 git show 失败）'); continue;
    }
    const overlayExtra = unexpectedStepKeys(overlay);
    if (overlayExtra.length) {
      gateFailures.push(id + ':overlay 步多出键 ' + JSON.stringify(overlayExtra) + '（env/working-directory 等可改取脚本行为）'); continue;
    }
    // 触碰面：作业内提到判定脚本路径的步必须恰好是 overlay + CLI 两步、且顺序正确。
    const touchers = job.steps.filter((s) => TRUSTED_PATH_RE.test(String(s.run || '')));
    const cliIdx = job.steps.findIndex((s) => /node\s+\S*ci-routing\.mjs\s+(check|docs|notice|judgeResult)/.test(String(s.run || '')));
    if (touchers.length !== 2) {
      gateFailures.push(id + ':触碰判定脚本路径的步=' + touchers.length + '（只许 overlay + CLI）'); continue;
    }
    if (cliIdx < 0 || overlayIdx > cliIdx) gateFailures.push(id + ':overlay=' + overlayIdx + '/cli=' + cliIdx);
  }
  add('trusted-gate',
    '判定脚本信任边界：四个判定作业的 overlay 步与 TRUSTED_OVERLAY_RUN **逐字节全等**'
    + '（fetch base.ref → BASE=FETCH_HEAD → git show "$BASE:" 覆盖三文件），overlay 步无 if/continue-on-error、'
    + '作业内只有 overlay + CLI 两步触碰判定脚本路径、且 overlay 在前'
    + '（否则 PR 可改判定器跳过 full 链；任何形状偏差 ⇒ 判红）',
    gateFailures.length === 0,
    gateFailures.length ? gateFailures.join(' · ') : '四个判定作业均为 base 脚本 → 再执行');

  // ⑦-c 每个作业都必须有 timeout-minutes（默认 360 分钟对挂起/网络不动是巨大的浪费面）。
  const jobTimeoutCount = (workflowText.match(/^ {4}timeout-minutes:\s*\d+\s*$/gm) || []).length;
  add('job-timeouts',
    '每个作业都声明 timeout-minutes（挂起不占用默认 360 分钟；至少 5 个作业各一条）',
    jobTimeoutCount >= REQUIRED_JOBS.length,
    'timeout-minutes 行=' + jobTimeoutCount + '（需要 ≥ ' + REQUIRED_JOBS.length + '）');

  // ⑧ fork 安全：不许 pull_request_target（fork 拿到写上下文），也不许顶层 paths-ignore
  //    （把 .github/** 排除掉会让"改 CI 接线"的提交静默不跑任何门）。
  const hasPRT = /pull_request_target/.test(workflowText);
  const hasPI = /^paths-ignore:/m.test(workflowText);
  add('fork-safety',
    '无 pull_request_target、无顶层 paths-ignore（fork 安全 + CI 改动自身必须被门禁看见）',
    !hasPRT && !hasPI,
    hasPRT ? '出现 pull_request_target' : (hasPI ? '出现顶层 paths-ignore' : '触发器干净'));

  // ⑧-b 最小权限声明：顶层必须有 `permissions:` 块且 `contents: read`，任何 scope 都不许给 write。
  //    为什么单独判：`fork-safety` 只认两个**坏形态**，对"把整块删掉"无感 —— 实测删掉后全绿
  //    （C3 盲区 B），而删掉等于回落到仓库默认权限（可能含 write）。这是**存在性 + 取值**判据，
  //    不只是"别写 write"。
  const perms = topLevelPermissions(workflowText);
  const permScopeGranted = perms ? Object.keys(perms) : [];
  const contentsRead = !!perms && String(perms.contents || '').trim() === 'read';
  const writeScopes = permScopeGranted.filter((k) => /write/.test(String(perms[k])));
  add('permissions-minimal',
    '顶层声明最小权限（`permissions:` 块存在 · `contents: read` · 无任何 scope 取 write）'
    + '—— 整块删除 ⇒ 回落仓库默认权限，等于放开写',
    contentsRead && writeScopes.length === 0,
    perms === null ? '缺顶层 permissions 块（回落默认权限）'
      : 'scope=' + JSON.stringify(permScopeGranted) + ' contents=' + String(perms.contents)
        + (writeScopes.length ? ' 越界 write：' + writeScopes.join(' ') : ''));

  // ⑨ checkout 深度：分类要 merge-base 完整历史，浅克隆会让"整段 PR 差异"变成"看不见差异"。
  const deepCheckout = /fetch-depth:\s*0/.test(workflowText);
  add('checkout-depth',
    'checkout 取全历史（fetch-depth: 0）—— 分类取 merge-base 完整 PR 差异的前提',
    deepCheckout, deepCheckout ? '有 fetch-depth: 0' : '全文无 fetch-depth: 0');

  // ⑩ 防悬空：workflow 里引用的脚本名必须在根 package.json 的 scripts 里真实存在。
  const missing = npmSequence.filter((s) => !Object.prototype.hasOwnProperty.call(scripts, s));
  add('npm-scripts-exist',
    '每个 npm run <script> 都在根 package.json 的 scripts 里真实存在（防改名/删脚本后 CI 悬空）',
    npmSequence.length > 0 && missing.length === 0,
    missing.length ? '悬空：' + missing.join(' ')
      : '校验 ' + npmSequence.length + ' 个脚本名 · 均在 scripts 里');

  // ⑪ 非 npm 的产物出库判据必须真在跑（shell: bash + run 里确实有 git）。
  const bashSteps = steps.filter((s) => String(s.shell || '').trim() === 'bash');
  const artifactBash = bashSteps.filter((s) => !npmScriptOf(s) && String(s.run || '').includes(ARTIFACT_STEP_NEEDLE));
  add('bash-artifact-step',
    '至少一条 shell: bash 的非 npm 步，且 run 里出现 `' + ARTIFACT_STEP_NEEDLE + '`（产物出库判据真在跑，不是摆设）',
    artifactBash.length >= 1,
    'shell: bash 步 ' + bashSteps.length + ' 条 · 含 `' + ARTIFACT_STEP_NEEDLE + '` 的 ' + artifactBash.length + ' 条');

  return { jobs, steps, npmSequence, checks };
}

// ── 变异器（负对照专用；只改文本，绝不写盘）──────────────────────────────────
// 它们与判据共处一个模块，是为了让"负对照喂的就是同一个纯函数"这件事在文件层面成立：
// 变异器本身对不匹配的输入是**恒等**，于是入口可以自检"这次变异真的改了文本"。

function dropStepsWhere(text, pred) {
  const { steps, lines } = parseWorkflow(text);
  const hits = steps.filter(pred);
  if (!hits.length) return text;
  for (const step of [...hits].sort((a, b) => b.line - a.line)) {
    lines.splice(step.line, step.end - step.line);
  }
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

/** 非 npm 步的定位：name 或 run 文本含片段（install 步的标识在 run 的 `npm ci` 里）。 */
function matchesFragment(step, fragment) {
  return String(step.name || '').includes(fragment) || String(step.run || '').includes(fragment);
}

/** 删掉 `npm run <script>` 的那（几）步（含它的 name/run 行，不含其前后注释）。 */
export function dropStep(text, script) {
  return dropStepsWhere(text, (s) => npmScriptOf(s) === script);
}

/** 按 `name:`（或 run 文本）片段删步（给非 npm 步用，如 shell: bash 的产物出库步）。 */
export function dropStepNamed(text, nameFragment) {
  return dropStepsWhere(text, (s) => matchesFragment(s, nameFragment));
}

/** 对调两个 `npm run <script>` 步。 */
export function swapSteps(text, scriptA, scriptB) {
  return swapStepWhere(text, (s) => npmScriptOf(s) === scriptA, (s) => npmScriptOf(s) === scriptB);
}

/** 按 `name:`（或 run 文本）片段对调两步（给非 npm 步用，如 install 步）。 */
export function swapStepsNamed(text, nameA, nameB) {
  return swapStepWhere(text, (s) => matchesFragment(s, nameA), (s) => matchesFragment(s, nameB));
}

/** 给 `npm run <script>` 的那（几）步加上/删掉 `continue-on-error: true`（`on=false` 时删除）。 */
export function setContinueOnError(text, script, on) {
  const { steps, lines } = parseWorkflow(text);
  const hits = steps.filter((s) => npmScriptOf(s) === script);
  if (!hits.length) return text;
  let out = lines;
  for (const step of [...hits].sort((a, b) => b.line - a.line)) {
    out = setCoEOnLines(out, step, on);
  }
  return out.join('\n');
}

function setCoEOnLines(lines, step, on) {
  const coAt = lines.findIndex((l, i) => i >= step.line && i < step.end && /^\s*continue-on-error\s*:/.test(l));
  if (!on) {
    if (coAt < 0) return lines;
    lines.splice(coAt, 1);
    return lines;
  }
  if (coAt >= 0) {
    lines[coAt] = (lines[coAt].match(/^\s*/) || [''])[0] + 'continue-on-error: true';
    return lines;
  }
  const runAt = lines.findIndex((l, i) => i >= step.line && i < step.end && /^\s*run\s*:/.test(l));
  const indent = runAt >= 0 ? (lines[runAt].match(/^\s*/) || [''])[0] : ' '.repeat(step.indent + 2);
  lines.splice(runAt >= 0 ? runAt : step.end, 0, indent + 'continue-on-error: true');
  return lines;
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

/** 整体删掉一个作业（id 精确匹配；不存在 ⇒ 恒等）。 */
export function dropJob(text, jobId) {
  const { jobs, lines } = parseWorkflow(text);
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return text;
  lines.splice(job.line, job.end - job.line);
  return lines.join('\n');
}

/** 把一步（name + run）插进指定作业的 steps 末尾（判"快通道上偷跑全量门"）。 */
export function insertStepIntoJob(text, jobId, run, name) {
  const { jobs, lines } = parseWorkflow(text);
  const job = jobs.find((j) => j.id === jobId);
  if (!job || !job.steps.length) return text;
  const last = job.steps[job.steps.length - 1];
  const indent = ' '.repeat(last.indent);
  const keyIndent = ' '.repeat(last.indent + 2);
  lines.splice(last.end, 0,
    indent + '- name: ' + String(name || jobId + ' —— 判据注入口'),
    keyIndent + 'run: ' + String(run || ''));
  return lines.join('\n');
}

/** 设置/清空一个作业的 `if:`（value 空串 ⇒ 删掉 if 行；作业不存在 ⇒ 恒等）。 */
export function setJobIf(text, jobId, value) {
  const { jobs, lines } = parseWorkflow(text);
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return text;
  const jobIndent = lineIndent(lines[job.line]);
  const ifAt = lines.findIndex((l, i) => i > job.line && i < job.end
    && lineIndent(l) === jobIndent + 2 && /^\s*if\s*:/.test(l));
  if (ifAt < 0) {
    if (!String(value || '')) return text;
    lines.splice(job.line + 1, 0, ' '.repeat(jobIndent + 2) + 'if: ' + value);
    return lines.join('\n');
  }
  if (!String(value || '')) {
    lines.splice(ifAt, 1);
    return lines.join('\n');
  }
  lines[ifAt] = (lines[ifAt].match(/^\s*/) || [''])[0] + 'if: ' + value;
  return lines.join('\n');
}

/**
 * 设置/清空某一条**步骤**的 `if:`（按 name/run 片段定位；value 空串 ⇒ 删掉；找不到 ⇒ 恒等）。
 * 负对照 P04（二审 F01）用它把 `if: always()` 从汇总作业挪到步骤级 —— 旧判据把
 * "任一步有 always"当作作业级 always 的替代，恰好接受了这个坏形态。
 */
export function setStepIf(text, fragment, value) {
  const { steps, lines } = parseWorkflow(text);
  const step = steps.find((s) => matchesFragment(s, fragment));
  if (!step) return text;
  const ifAt = lines.findIndex((l, i) => i >= step.line && i < step.end && /^\s*if\s*:/.test(l));
  if (!String(value || '')) {
    if (ifAt < 0) return text;
    lines.splice(ifAt, 1);
    return lines.join('\n');
  }
  if (ifAt >= 0) {
    lines[ifAt] = (lines[ifAt].match(/^\s*/) || [''])[0] + 'if: ' + value;
    return lines.join('\n');
  }
  const runAt = lines.findIndex((l, i) => i >= step.line && i < step.end && /^\s*run\s*:/.test(l));
  const indent = runAt >= 0 ? (lines[runAt].match(/^\s*/) || [''])[0] : ' '.repeat(step.indent + 2);
  lines.splice(runAt >= 0 ? runAt : step.end, 0, indent + 'if: ' + value);
  return lines.join('\n');
}

/**
 * 给某一步插入 `env:` 块（按 name/run 片段定位；找不到 ⇒ 恒等）。
 * 负对照用：CLI 步 run 一字未动，只靠 `env: NODE_OPTIONS: --require ./hack.cjs`
 * 就能在 node 侧改退出码 —— 判据必须看见"多出来的键"。
 */
export function setStepEnv(text, fragment, envBody) {
  const { steps, lines } = parseWorkflow(text);
  const step = steps.find((s) => matchesFragment(s, fragment));
  if (!step) return text;
  const runAt = lines.findIndex((l, i) => i >= step.line && i < step.end && /^\s*run\s*:/.test(l));
  const indent = runAt >= 0 ? (lines[runAt].match(/^\s*/) || [''])[0] : ' '.repeat(step.indent + 2);
  const body = String(envBody == null ? '' : envBody).split('\n');
  lines.splice(runAt >= 0 ? runAt : step.end, 0, indent + 'env:',
    ...body.map((l) => indent + '  ' + l));
  return lines.join('\n');
}

/** 在文件顶层（第一行之前）插入一段文本（判"trigger/过滤被换成危险形态"）。 */
export function insertTopLevel(text, snippet) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  lines.unshift(...String(snippet == null ? '' : snippet).split('\n'), '');
  return lines.join('\n');
}

/** 删掉所有匹配的行（负对照专用：摘掉一行接线，判据必须当场红）。 */
export function removeLineMatching(text, re) {
  const rx = new RegExp(re.source, String(re.flags || '').replace(/[gy]/g, ''));
  return String(text).replace(/\r\n?/g, '\n').split('\n').filter((l) => !rx.test(l)).join('\n');
}

/**
 * 整块删掉顶层 `permissions:`（负对照专用：C3 盲区 B 的原形态）。
 * 块不存在 ⇒ 恒等（入口据此自检"这次变异真的改了文本"）。
 */
export function dropPermissionsBlock(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const at = lines.findIndex((l) => /^permissions:\s*$/.test(l));
  if (at < 0) return text;
  let end = at + 1;
  while (end < lines.length && (!lines[end].trim() || lineIndent(lines[end]) > 0)) end += 1;
  lines.splice(at, end - at);
  return lines.join('\n');
}

/**
 * 把顶层某个权限 scope 设成给定取值（`scope` 不存在 ⇒ 追加进块里；块不存在 ⇒ 恒等）。
 * 负对照用它造"最小权限被悄悄放开"。
 */
export function setPermissionScope(text, scope, access) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const at = lines.findIndex((l) => /^permissions:\s*$/.test(l));
  if (at < 0) return text;
  let end = at + 1;
  while (end < lines.length && (!lines[end].trim() || lineIndent(lines[end]) > 0)) end += 1;
  const step = 2;
  for (let i = at + 1; i < end; i += 1) {
    const kv = readKeyValue(lines[i]);
    if (kv && kv.key === scope) {
      lines[i] = ' '.repeat(step) + scope + ': ' + access;
      return lines.join('\n');
    }
  }
  lines.splice(at + 1, 0, ' '.repeat(step) + scope + ': ' + access);
  return lines.join('\n');
}
