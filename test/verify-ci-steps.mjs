/**
 * 核对 `.github/workflows/verify.yml` 的**作业结构**与覆盖责任。
 *
 * 为什么改成按作业解析（而不是"文件里第一个 steps:"）：分流之后工作流不再只有一个作业，
 * 而"某个步骤在哪条路径上"本身就是判据 —— 旧写法只认第一个 `steps:`，于是加一个 `changes`
 * 作业就会让全部判据对着错误的作业块比对：要么假红（逼人把作业挪回去迁就解析器），
 * 要么假绿（判据看的是别人的步骤，怎么改都不响）。
 *
 * 判据按**覆盖责任**表达，不按固定字符串序列：
 *   · `full` 必须含完整验证序列（顺序固定，不因分流缩水），且装依赖在第一次 npm run 之前；
 *   · `docs` 只做文档检查，不许跑构建 / 运行时门禁，也不许在快通道上装依赖；
 *   · 两条路径都由 `changes` 分类，`full` 保持 Windows + Ubuntu 双平台；
 *   · 固定作业 `ci/result` 用 `judgeResult` 核验"这次该跑的作业真的 success"——
 *     失败、取消、缺失、意外跳过都不放行（判据本体在 `test/tools/ci-routing.mjs`，这里只核对接线）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCheck } from './tools/assert-harness.mjs';
import {
  ARTIFACT_STEP_NEEDLE,
  CI_WORKFLOW_REL,
  FULL_REQUIRED_SEQUENCE,
  INSTALL_COMMAND,
  REQUIRED_JOBS,
  RESULT_JOB_NAME,
  STEP_FLOOR,
  auditCiWorkflow,
  dropJob,
  dropPermissionsBlock,
  dropStep,
  dropStepNamed,
  insertNpmStepAfter,
  insertStepIntoJob,
  insertTopLevel,
  installsDeps,
  npmScriptOf,
  parseWorkflow,
  removeLineMatching,
  renameNpmScript,
  setContinueOnError,
  setJobIf,
  setPermissionScope,
  setStepEnv,
  setStepIf,
  swapSteps,
  swapStepsNamed,
  topLevelPermissions,
  unexpectedStepKeys,
} from './tools/ci-workflow.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const WORKFLOW_PATH = join(ROOT, CI_WORKFLOW_REL);
const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts || {};

const { check, stats } = createCheck();
const brief = (s, n = 72) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

/* ── ① 解析概览 ─────────────────────────────────────────────────────────── */
const parsed = parseWorkflow(workflowText);
console.log('解析出的作业：');
for (const job of parsed.jobs) {
  console.log(`  · ${job.id}（name=${brief(job.name, 24)} · needs=${JSON.stringify(job.needs)}`
    + ` · steps=${job.steps.length} · runs-on=${brief(job.runsOn, 28)}）`);
}
const full = parsed.jobs.find((j) => j.id === 'full');
console.log('full 作业的 npm 序列：'
  + JSON.stringify(full ? full.steps.map((s) => npmScriptOf(s)).filter(Boolean) : []));

/* ── ② 正判据 ───────────────────────────────────────────────────────────── */
const live = auditCiWorkflow({ workflowText, scripts });
for (const c of live.checks) check(c.name, c.ok, c.detail);

/* ── ③ 负对照：每条判据都要有一条变异把它打红 ─────────────────────────────── */
const control = (desc, mutatedText, id) => {
  const changed = mutatedText !== workflowText;
  check(`负对照：${desc}`, changed, changed ? '' : '变异没有改动文本（对照失效）');
  if (!changed) return;
  const result = auditCiWorkflow({ workflowText: mutatedText, scripts });
  const hit = result.checks.find((c) => c.id === id);
  check(`负对照判红：${desc} → ${id}`, !!hit && !hit.ok, hit ? brief(hit.detail) : '判据缺失：' + id);
};

control('删掉 docs 作业', dropJob(workflowText, 'docs'), 'job-structure');
control('full 作业只剩 8 步', dropStep(dropStep(dropStep(workflowText, 'verify:bridge'), 'smoke'), 'verify:static'), 'step-floor');
control('分类步骤不写 GITHUB_OUTPUT', removeLineMatching(workflowText, /--github-output/), 'changes-wiring');
control('docs 作业偷偷跑 npm run verify', insertStepIntoJob(workflowText, 'docs', 'npm run verify', '顺手全量'), 'docs-fast-path');
control('docs 作业去掉 mode 守卫', setJobIf(workflowText, 'docs', ''), 'docs-fast-path');
// docs 腿的核心步必须是真 docs CLI（同一差异二次分类）；退回 warn-only 内务必须红。
// docs 腿 run 已是多行 bash（三个事件分支 + --base-mode 档位），负控对着整个 run 块替换。
const DOCS_RUN_BLOCK = [
  '        run: |',
  '          if [ -n "${{ github.event.pull_request.base.sha }}" ]; then',
  '            BASE_ARGS=(--base "${{ github.event.pull_request.base.sha }}" --head "${{ github.event.pull_request.head.sha }}" --base-mode merge-base)',
  '          elif [ -n "${{ github.event.before }}" ]; then',
  '            BASE_ARGS=(--base "${{ github.event.before }}" --head "${{ github.event.after }}" --base-mode exact)',
  '          else',
  '            BASE_ARGS=(--base "${{ github.sha }}" --head "${{ github.sha }}" --base-mode exact)',
  '          fi',
  '          node scripts/ci-routing.mjs docs "${BASE_ARGS[@]}"',
].join('\n');
control('docs 腿退回仅 verify:docs 内务', workflowText.replace(DOCS_RUN_BLOCK, '        run: npm run verify:docs'), 'docs-fast-path');
control('docs 腿丢掉同一差异接线', removeLineMatching(workflowText, /--base "/), 'docs-fast-path');
// 同一变异（两腿的 --base 行一起消失）也要打红 changes-wiring：两腿必须同一差异边界。
control('changes 腿丢掉差异边界（与 docs 同一变异）', removeLineMatching(workflowText, /--base "/), 'changes-wiring');
control('docs 腿 checkout 不指向 head 树', removeLineMatching(workflowText, /ref: \$\{\{ github\.event\.pull_request\.head\.sha/), 'docs-fast-path');
// changes 腿的 PR 分支退化成 github.sha（与 docs 腿不一致）——两腿各审各的差异 ⇒ 判红。
// PR 分支行在两腿逐字符相同，replace 只换第一处 = changes 腿（文件顺序在 docs 之前）。
control('changes 腿 PR 分支退化成 github.sha（与 docs 不一致）', workflowText
  .replace('BASE_ARGS=(--base "${{ github.event.pull_request.base.sha }}" --head "${{ github.event.pull_request.head.sha }}" --base-mode merge-base)',
    'BASE_ARGS=(--base "${{ github.sha }}" --head "${{ github.sha }}" --base-mode exact)'), 'changes-wiring');
// push 场景的 exact 档被退化成 merge-base：force-push 后 before 非祖先，merge-base 会漏算
// before 独有的代码删除（E2E force-push 幕实证）——退化即回归 ⇒ 判红。
control('push exact 档退化成 merge-base',
  workflowText.split('--base-mode exact').join('--base-mode merge-base'), 'changes-wiring');
// dispatch 分支（github.sha 空差异 ⇒ 保守 full）被删 ⇒ 无事件边界时接线不完整 ⇒ 判红。
control('dispatch 边界分支被删',
  removeLineMatching(workflowText, /github\.sha.*base-mode exact/), 'changes-wiring');
// 二审 F01 P03：分类器之后**同一步**再写一次 mode —— 后写的赢，分类结论被换成 docs 后
// full 链整段跳过。旧判据只查"分类器存在 + 差异对齐"会放行；新判据扫分类器行之后
// 的 mode 写出 ⇒ 必须红。
control('P03：分类器同一步内追加第二次 mode 输出', workflowText.replace(
  'node scripts/ci-routing.mjs check --github-output "${BASE_ARGS[@]}"',
  'node scripts/ci-routing.mjs check --github-output "${BASE_ARGS[@]}"\n'
  + '          echo "mode=docs" >> "$GITHUB_OUTPUT"'), 'changes-wiring');
// 二审 F01 P03 变体：**另起一步**覆盖 mode（分类步本身没动）⇒ 后续步骤覆写检测 ⇒ 必须红。
control('P03 变体：后续步骤再写 mode',
  insertStepIntoJob(workflowText, 'changes', 'echo "mode=full" >> "$GITHUB_OUTPUT"', '覆盖分类结论'), 'changes-wiring');

// ── ③-d 评审补洞：初版"令牌在场 + 按行计数"指纹的一行级绕过（全部必须红）──────────
// 同一行串第二条 fetch：后一次 fetch 改写 FETCH_HEAD ⇒ 信任边界指向 PR merge commit。
control('P02 补洞：同行串第二条 fetch 改写 FETCH_HEAD', workflowText.replace(
  'git fetch --no-tags origin "${{ github.event.pull_request.base.ref }}"',
  'git fetch --no-tags origin "${{ github.event.pull_request.base.ref }}"; git fetch --no-tags origin "${{ github.sha }}"'),
  'trusted-gate');
// show 重定向丢弃：文件保持 PR 树版本，令牌全部在场。
control('P02 补洞：git show 重定向改 /dev/null（覆盖失效）', workflowText.split('git show "$BASE:$f" > "$f"')
  .join('git show "$BASE:$f" > /dev/null'), 'trusted-gate');
// BASE 二次赋值：保留受信赋值，其后改写（保持缩进，模拟结构合法的语义等价变异）。
control('P02 补洞：BASE=FETCH_HEAD 之后二次赋值', workflowText.split('BASE=FETCH_HEAD')
  .join('BASE=FETCH_HEAD\n            BASE="${{ github.sha }}"'), 'trusted-gate');
// overlay 步挂 if：运行时整步跳过，文件保持 PR 树版本。
control('P02 补洞：overlay 步挂 if: false', setStepIf(workflowText, '取受信判定脚本', 'false'), 'trusted-gate');
// 恢复步：overlay 之后另起一步把 PR 版判定器拷回来（不经过 git show 形态）。
control('P02 补洞：追加 git checkout 恢复 PR 版判定器', insertStepIntoJob(workflowText, 'changes',
  'git checkout "${{ github.sha }}" -- scripts/ci-routing.mjs', '恢复 PR 版判定器'), 'trusted-gate');
// 同行 && 追加覆写：该行本身匹配分类器 CLI，"从下一行开始扫"的口径漏它 ⇒ 逐字 pin 必须接住。
control('P03 补洞：分类器同行 && 追加第二次 mode 输出', workflowText.replace(
  'node scripts/ci-routing.mjs check --github-output "${BASE_ARGS[@]}"',
  'node scripts/ci-routing.mjs check --github-output "${BASE_ARGS[@]}" && echo "mode=docs" >> "$GITHUB_OUTPUT"'),
  'changes-wiring');
// outputs 改指：分类器一字未动，作业级输出改指（可被 bootstrap 步喂假 mode）。
control('P03 补洞：outputs.mode 改指别的步骤输出', workflowText.split('mode: ${{ steps.classify.outputs.mode }}')
  .join('mode: ${{ steps.bootstrap.outputs.mode }}'), 'changes-wiring');
// 变量间接写：后续步不带 mode 字样也能覆写 ⇒ 后续步只认"碰没碰 GITHUB_OUTPUT"。
control('P03 补洞：后续步骤用变量间接写 mode',
  insertStepIntoJob(workflowText, 'changes', 'printf "$OUT_KEY=docs" >> "$GITHUB_OUTPUT"', '间接覆写'), 'changes-wiring');
control('full 漏掉 verify:bridge', dropStep(workflowText, 'verify:bridge'), 'full-coverage');
control('full 漏掉 smoke', dropStep(workflowText, 'smoke'), 'full-coverage');
control('full 把安装放到第一次 npm run 之后', swapStepsNamed(workflowText, 'npm ci', 'verify:static'), 'full-coverage');
control('给 verify 加 continue-on-error', setContinueOnError(workflowText, 'verify', true), 'soft-tier');
// 信任边界负对照：判定脚本不再从 base 树取（把 overlay 的 git show 全换成 true）⇒ trusted-gate 必须红。
control('去掉 base 树判定脚本 overlay（判定器变回 PR 树）', workflowText.replace(/git show/g, 'true'), 'trusted-gate');
// 二审 F01 P02：PR 分支的 BASE=FETCH_HEAD 换成 github.sha —— pull_request 事件下那是
// merge commit（**含 PR 内容**），信任边界名存实亡。旧判据只查"有 git show"会放行；
// 形状指纹判据要求 fetch base.ref → BASE=FETCH_HEAD 的形状必须存在 ⇒ 必须红。
control('P02：overlay 的 BASE 被换成 github.sha（信任边界指向 PR 内容）',
  workflowText.split('BASE=FETCH_HEAD').join('BASE="${{ github.sha }}"'), 'trusted-gate');
// 二审 F01 P02 变体：fetch 的 ref 换成 head（FETCH_HEAD 内容 = PR 树）⇒ 同罪，必须红。
control('P02 变体：overlay 的 fetch 改取 head ref',
  workflowText.split('git fetch --no-tags origin "${{ github.event.pull_request.base.ref }}"')
    .join('git fetch --no-tags origin "${{ github.event.pull_request.head.ref }}"'), 'trusted-gate');
// 硬化负对照：full 作业去掉 timeout-minutes ⇒ job-timeouts 必须红。
control('full 作业去掉 timeout-minutes', workflowText.replace('    timeout-minutes: 30\n', ''), 'job-timeouts');
control('ci/result 不再 always()', removeLineMatching(workflowText, /if: always\(\)/), 'result-gate');
// 二审 F01 P04：if: always() 从**作业级**挪到**步骤级** —— 依赖作业被 skip 时步骤根本不会
// 执行，等于没写（GitHub needs 语义）。旧判据用"作业或任一步有 always"放行这个坏形态；
// 新判据只认作业级 ⇒ 必须红。
control('P04：ci/result 的 always() 挪到步骤级',
  setStepIf(setJobIf(workflowText, 'result', ''), 'judgeResult', 'always()'), 'result-gate');
control('ci/result 不用 judgeResult', removeLineMatching(workflowText, /judgeResult/), 'result-gate');
control('ci/result 少 needs 一条腿', removeLineMatching(workflowText, /needs: \[changes, docs, notice, full\]/), 'result-gate');

/* ── ③-e 2026-11-09 评审 P0：result-gate 与四条 CLI 步的"令牌在场 ≠ 语义成立"补洞 ────────
 * 旧 result-gate 只查 `/always\(\)/` 子串 + "run 里有 judgeResult 这个串"：
 *   · `always() && false` / `always() && event == 'push'` —— 汇总作业在 PR 事件下被 skip，
 *     而 GitHub 把必需 check 的 skipped 与 success 同形对待 ⇒ 假绿合入；
 *   · judgeResult 行尾 `|| true`、参数换常量（`--full success`）、env 注入 —— 汇总器恒放行。
 * 旧 changes-wiring 按"步"计数 + 只扫分类器行**之后**的行：
 *   · 同一 run 再串一条分类器（改差异范围/档位）⇒ 后写覆盖 outputs.mode，判据只看到一条步；
 *   · 行尾 `|| true`、env/shell 模板旁路 —— run 文本一字未动也能量掉退出码。
 * 现在四条 CLI 步都整块逐字 pin + 键 allowlist：以下每条都必须判红。 */
control('P0：result 作业 if 改成 always() && false',
  setJobIf(workflowText, 'result', '${{ always() && false }}'), 'result-gate');
control('P0：result 作业 if 改成仅在 push 上跑（PR 下被 skip）',
  setJobIf(workflowText, 'result', "${{ always() && github.event_name == 'push' }}"), 'result-gate');
control('P0：judgeResult 行尾追加 || true（抑制汇总器退出码）',
  workflowText.replace('            --github-output', '            --github-output || true'), 'result-gate');
control('P0：judgeResult 的 --full 参数换成常量 success',
  workflowText.replace('--full "${{ needs.full.result }}"', '--full success'), 'result-gate');
control('P0：judgeResult 步注入 env（NODE_OPTIONS --require 改退出码）',
  setStepEnv(workflowText, 'ci/result —— 汇总核验', 'NODE_OPTIONS: --require ./hack.cjs'), 'result-gate');
control('P0：classify 同一 run 串第二条分类器（改差异范围/覆盖 mode）', workflowText.replace(
  'node scripts/ci-routing.mjs check --github-output "${BASE_ARGS[@]}"',
  'node scripts/ci-routing.mjs check --github-output "${BASE_ARGS[@]}"\n'
  + '          node scripts/ci-routing.mjs check --github-output --base "$(git rev-parse HEAD^)" --head "$(git rev-parse HEAD)" --base-mode exact'),
  'changes-wiring');
control('P0：classify 行尾追加 || true',
  workflowText.replace('node scripts/ci-routing.mjs check --github-output "${BASE_ARGS[@]}"',
    'node scripts/ci-routing.mjs check --github-output "${BASE_ARGS[@]}" || true'), 'changes-wiring');
control('P0：classify 步注入 env（BASH_ENV / NODE_OPTIONS）',
  setStepEnv(workflowText, '分类这次差异', 'BASH_ENV: ./hack.sh'), 'changes-wiring');
control('P0：classify 步 shell 模板改成 bash {0} || true',
  workflowText.replace(
    '      - name: 分类这次差异（docs / docs-assets / full，fail-closed）\n        id: classify\n        shell: bash',
    '      - name: 分类这次差异（docs / docs-assets / full，fail-closed）\n        id: classify\n        shell: bash {0} || true'),
  'changes-wiring');
// overlay 步的同类旁路：run 一字未动，只换 shell 模板（git show 失败不致命 ⇒ 信任边界 fail-open）。
control('P0：overlay 步 shell 模板改成 bash {0} || true',
  workflowText.replace(
    '      - name: 取受信判定脚本（base 分支，覆盖 PR 树里的同名文件）\n        shell: bash\n        run: |',
    '      - name: 取受信判定脚本（base 分支，覆盖 PR 树里的同名文件）\n        shell: bash {0} || true\n        run: |'),
  'trusted-gate');
control('P0：docs CLI 行尾追加 || true',
  workflowText.replace('node scripts/ci-routing.mjs docs "${BASE_ARGS[@]}"',
    'node scripts/ci-routing.mjs docs "${BASE_ARGS[@]}" || true'), 'docs-fast-path');
control('P0：notice CLI 行尾追加 || true',
  workflowText.replace('node scripts/ci-routing.mjs notice "${BASE_ARGS[@]}"',
    'node scripts/ci-routing.mjs notice "${BASE_ARGS[@]}" || true'), 'notice-fast-path');
control('P0：docs CLI 步注入 env（NODE_OPTIONS --require）',
  setStepEnv(workflowText, 'docs —— 同一差异二次分类', 'NODE_OPTIONS: --require ./hack.cjs'), 'docs-fast-path');
// 键 allowlist 本体自检：干净 run 步无多余键；env 注入后被看见。
check('unexpectedStepKeys：干净 CLI 步无多余键', unexpectedStepKeys({ run: 'node x' }).length === 0);
check('unexpectedStepKeys：env / NODE_OPTIONS 被看见',
  JSON.stringify(unexpectedStepKeys({ run: 'node x', env: '', NODE_OPTIONS: 'y' })) === JSON.stringify(['env', 'NODE_OPTIONS']),
  JSON.stringify(unexpectedStepKeys({ run: 'node x', env: '', NODE_OPTIONS: 'y' })));
control('改用 pull_request_target', insertTopLevel(workflowText, 'pull_request_target:\n  branches: [main]'), 'fork-safety');
control('顶层加 paths-ignore', insertTopLevel(workflowText, 'paths-ignore:\n  - "docs/**"'), 'fork-safety');
control('checkout 不取全历史', removeLineMatching(workflowText, /fetch-depth: 0/), 'checkout-depth');

/* ── ③-b C3 盲区 A：多行 run 把安装藏到第二行 ─────────────────────────────
 * 原判据只对**折行后的整串**做 `startsWith(INSTALL_COMMAND)` ⇒ 只要安装不是 run 的第一行，
 * `docs-fast-path` 的 `install=0` 照样报绿，而这步在 CI 上真的装了依赖（实测先红）。
 * 下面三条：首行安装（逃不掉，作参照）· 第二行安装（原盲区的原形态）· 三行 bash 里藏在末行。 */
control('docs 腿安装写成首行（参照：本来就该红）',
  insertStepIntoJob(workflowText, 'docs', INSTALL_COMMAND, 'docs 腿装依赖（首行）'), 'docs-fast-path');
control('docs 腿多行 run 把安装藏到第二行（set -e 在首行）',
  insertStepIntoJob(workflowText, 'docs', '|\n            set -e\n            ' + INSTALL_COMMAND,
    'docs 腿多行安装（C3 盲区 A）'), 'docs-fast-path');
control('docs 腿三行 bash 把安装藏在末行',
  insertStepIntoJob(workflowText, 'docs', '|\n            set -euo pipefail\n            echo prepare\n            ' + INSTALL_COMMAND,
    'docs 腿三行安装（末行）'), 'docs-fast-path');
// 判据本体自检：`installsDeps` 对"首行/非首行/多命令混排"三种形态都必须为真（直接断言纯函数，
// 不靠变异间接证明），对"只是提到 npm ci 但没真执行"的注释行必须为假。
check('installsDeps：首行安装为真', installsDeps({ run: INSTALL_COMMAND }));
check('installsDeps：第二行安装为真', installsDeps({ run: 'set -e\n' + INSTALL_COMMAND }));
check('installsDeps：缩进/CRLF/空行混排仍为真',
  installsDeps({ run: 'set -e\r\n\r\n   ' + INSTALL_COMMAND + '   \r\n' }));
check('installsDeps：只在行尾提一句不算安装',
  installsDeps({ run: 'echo "see ' + INSTALL_COMMAND + ' later"' }) === false);
check('installsDeps：非安装命令为假', installsDeps({ run: 'npm run verify:docs' }) === false);
check('installsDeps：无 run 为假', installsDeps({}) === false);

/* ── ③-c C3 盲区 B：顶层 permissions 整块删除 / 取值放开 ───────────────────
 * 原 `fork-safety` 只认 `pull_request_target` 与顶层 `paths-ignore` 两个坏形态，对"整块删掉
 * permissions"无感（实测全绿）。下面三条把存在性、取值、越界 write 分别钉住。 */
control('删掉顶层 permissions 整块（C3 盲区 B）', dropPermissionsBlock(workflowText), 'permissions-minimal');
control('顶层 permissions 的 contents 改成 write',
  setPermissionScope(workflowText, 'contents', 'write'), 'permissions-minimal');
control('顶层 permissions 追加一个越界 write scope',
  setPermissionScope(workflowText, 'id-token', 'write'), 'permissions-minimal');
// 判据本体自检：纯函数口径（块缺失 ⇒ null；块内只认当前块的键，不吃到 jobs 里的 permissions）。
check('topLevelPermissions：读出 contents=read',
  JSON.stringify(topLevelPermissions(workflowText)) === JSON.stringify({ contents: 'read' }),
  JSON.stringify(topLevelPermissions(workflowText)));
check('topLevelPermissions：无块 ⇒ null', topLevelPermissions('on: push\njobs: {}\n') === null);
check('topLevelPermissions：作业内的 permissions 不算顶层',
  topLevelPermissions('on: push\njobs:\n  a:\n    permissions:\n      contents: write\n') === null);
control('full 漏掉产物入库检查', dropStepNamed(workflowText, ARTIFACT_STEP_NEEDLE), 'full-coverage');
control('空工作流', '', 'job-structure');

// 变异器本身的自检：对不匹配的输入必须是恒等（否则负对照会"自己打自己"）。
check('变异器恒等：dropStep 对不存在的脚本', dropStep(workflowText, 'verify:bogus') === workflowText);
check('变异器恒等：dropJob 对不存在的作业', dropJob(workflowText, 'nope') === workflowText);
check('变异器恒等：swapSteps 对不存在的脚本',
  swapSteps(workflowText, 'verify:bogus', 'verify:static') === workflowText);
check('变异器恒等：renameNpmScript 对不存在的脚本',
  renameNpmScript(workflowText, 'verify:bogus', 'verify:still-bogus') === workflowText);
check('变异器恒等：insertNpmStepAfter 对不存在的锚点',
  insertNpmStepAfter(workflowText, 'verify:bogus', 'lint') === workflowText);
check('变异器恒等：setJobIf 对不存在的作业', setJobIf(workflowText, 'nope', 'true') === workflowText);
check('变异器恒等：setStepIf 对不存在的片段', setStepIf(workflowText, '不存在的步骤片段', 'always()') === workflowText);
check('变异器恒等：setStepEnv 对不存在的片段', setStepEnv(workflowText, '不存在的步骤片段', 'A: 1') === workflowText);

// 正对照：脚本表为空时"每个 npm 步骤的脚本都存在"必须判红（否则那条判据永远真）。
const emptyScripts = auditCiWorkflow({ workflowText, scripts: {} });
const existsCheck = emptyScripts.checks.find((c) => c.id === 'npm-scripts-exist');
check('正对照：脚本表为空 ⇒ npm-scripts-exist 判红', !!existsCheck && !existsCheck.ok,
  existsCheck ? brief(existsCheck.detail) : '判据缺失：npm-scripts-exist');

/* ── ④ 结构面：作业齐全、序列按序、装依赖与产物检查都在 ───────────────────── */
const ids = parsed.jobs.map((j) => j.id);
check(`作业齐全（${REQUIRED_JOBS.join(' / ')}）`, REQUIRED_JOBS.every((id) => ids.includes(id)), JSON.stringify(ids));
check(`full 步骤数 ≥ 地板 ${STEP_FLOOR}`, !!full && full.steps.length >= STEP_FLOOR,
  full ? String(full.steps.length) : '缺 full 作业');

const fullScripts = full ? full.steps.map((s) => npmScriptOf(s)).filter(Boolean) : [];
const seqOk = (() => {
  let at = 0;
  for (const want of FULL_REQUIRED_SEQUENCE) {
    const found = fullScripts.indexOf(want, at);
    if (found < 0) return false;
    at = found + 1;
  }
  return true;
})();
check('full 的 npm 序列按序包含完整验证链', seqOk, JSON.stringify(fullScripts));

const installAt = full ? full.steps.findIndex((s) => String(s.run || '').trim().startsWith(INSTALL_COMMAND)) : -1;
const firstNpmAt = full ? full.steps.findIndex((s) => /(?:^|\s)npm run\s/.test(String(s.run || ''))) : -1;
check('full 先装依赖再跑第一条 npm 脚本', installAt >= 0 && (firstNpmAt < 0 || installAt < firstNpmAt),
  `install@${installAt} firstNpm@${firstNpmAt}`);
check('full 保留产物不入库检查', !!full && full.steps.some((s) => String(s.run || '').includes(ARTIFACT_STEP_NEEDLE)));
check(`汇总作业名为 ${RESULT_JOB_NAME}`,
  parsed.jobs.some((j) => j.name === RESULT_JOB_NAME), JSON.stringify(parsed.jobs.map((j) => j.name)));

/* ── 收尾 ───────────────────────────────────────────────────────────────── */
if (stats.failed) {
  console.error(`\n${stats.failed} CHECK(S) FAILED`);
  process.exit(1);
}
console.log(`\nALL CI STEP CHECKS PASSED (${stats.passed})`);
