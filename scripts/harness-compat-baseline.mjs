#!/usr/bin/env node
/**
 * harness-compat-baseline.mjs —— harness 适配基线的读写（`.github/harness-baseline.json`）。
 *
 * 基线的语义：**只有「完全适配全绿」的 (harness 版本 × 插件 commit) 对才配当基线**。
 * 由 `.github/workflows/harness-compat.yml` 在全部步骤通过后调用 `record` 写入；
 * 任何一步失败的工作流根本走不到 `record`，所以基线天然停在上一个全绿对上。
 *
 * 三个子命令（都只用 node: 内置模块）：
 *   · `check   --harness <ver> --sha <sha> [--force]`
 *       目标对已全绿入基线 ⇒ 输出 `should_run=false`（派发时的秒过路径）；否则 `should_run=true`。
 *       判定结果写进 $GITHUB_OUTPUT（存在时），并打印在日志里。`check` 永远退出 0：
 *       「跳过」是结论，不是错误。
 *   · `record  --harness <ver> --sha <sha> [--dist-tag <tag>] [--node <n>] [--runner <os>]`
 *       把当前对写进基线文件；**按插件内容身份判重**（见下）⇒ 同一份内容不改动（幂等，
 *       避免时间戳造成空转提交）。工作流用 `git status --porcelain` 决定是否提交。
 *   · `selftest`
 *       在**临时仓库**里跑**同一条判定**（`decide`），正/负对照成对，退出码非 0 即失败。
 *
 * ⚠️ **"插件有没有变"不能用 commit sha 判**（这条是修出来的）：`record` 会把基线提交进
 *    `main`，于是插件 HEAD 自己前进一格 ⇒ 下一轮 `check` 必然判"未覆盖" ⇒ 又跑一整轮完整
 *    适配（5–9 分钟）并再写一条基线，而新的基线又推进 HEAD …… 每小时如此。实测形态：
 *    连续三条 `ci(baseline)` 提交，每条记的都是**它自己的父提交**；上游仓库同样如此。
 *    ⇒ 判定改用 **插件内容身份 `plugin.revision`**：`git ls-tree -r <sha>` 里**除基线文件
 *    之外**的 (模式, blob 哈希, 路径) 清单的 sha256 前 16 位。只动基线文件 ⇒ 身份不变 ⇒
 *    `should_run=false`（秒过）；真文件变了才重跑。
 *    基线里没有 `revision`（更早写的基线）或取不到 git 时，**退回按 sha 比较** —— 那是
 *    "判有变化、多跑一轮"的安全方向，绝不会漏测。
 *
 * 失败与重试的闭环：一轮派发的目标测试失败 ⇒ 工作流红、基线不变 ⇒ 再次派发时
 * `check` 仍判定 should_run=true ⇒ 红到修好为止（"出问题就需要报错"；不自动重试）。
 */
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, openSync, closeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
/** 基线文件自身的路径（相对仓库根）。判定"插件有没有变"时要把它排除在外。 */
const BASELINE_REL = '.github/harness-baseline.json';
const HARNESS_PKG = '@deepseek-ai/dsh';

const baselinePath = (root) => join(root, BASELINE_REL);

function parseArgs(argv) {
  const out = { force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') { out.force = true; continue; }
    const key = a.replace(/^--/, '');
    const val = argv[i + 1];
    if (val === undefined || val.startsWith('--')) throw new Error(`参数 ${a} 缺少取值`);
    out[key] = val;
    i++;
  }
  return out;
}

function readBaseline(root = ROOT) {
  try { return JSON.parse(readFileSync(baselinePath(root), 'utf8')); } catch { return null; }
}

function requirePair(args) {
  if (!args.harness || !args.sha) throw new Error('需要 --harness <版本> 与 --sha <插件 commit>');
  return { target: String(args.harness), sha: String(args.sha) };
}

/**
 * 跑一条命令并取回 stdout：**经临时文件**，不用管道。
 * 为什么绕这一下：受限环境（本机沙箱、部分受限容器）里子进程管道会直接 EPERM，而这条路径
 * 必须能在本机手动跑（[`docs/DEV-GUIDE.md`](../../docs/DEV-GUIDE.md) 的 compat 层约定）。
 * stdout 走文件描述符不受该限制影响。失败返回 null，调用方走安全回退。
 */
function runCapture(cwd, cmd, argv) {
  const out = join(tmpdir(), `hc-baseline-${process.pid}-${Math.random().toString(36).slice(2)}.txt`);
  let fd = null;
  try {
    fd = openSync(out, 'w');
    execFileSync(cmd, argv, { cwd, stdio: ['ignore', fd, 'ignore'] });
    closeSync(fd);
    fd = null;
    return readFileSync(out, 'utf8');
  } catch {
    return null;
  } finally {
    if (fd !== null) { try { closeSync(fd); } catch { /* ignore */ } }
    try { rmSync(out, { force: true }); } catch { /* ignore */ }
  }
}

/**
 * 插件侧的**内容身份**：`<sha>` 的整棵树里，除基线文件之外的 (模式, blob 哈希, 路径) 清单的哈希。
 * 用 `git ls-tree -r` ⇒ 只需要**当前** commit 对象（浅克隆也够），不需要历史。
 * 取不到（不在 git 仓库里 / 该 sha 不存在 / 没有 git）⇒ null ⇒ 调用方退回按 sha 比较。
 */
function pluginRevision(root, sha) {
  const raw = runCapture(root, 'git', ['ls-tree', '-r', sha]);
  if (raw === null) return null;
  const lines = raw.split('\n').map((s) => s.replace(/\r$/, '')).filter(Boolean)
    .filter((l) => !l.endsWith('\t' + BASELINE_REL));
  if (!lines.length) return null;
  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);
}

/**
 * `decide` 的入参形状。**必须显式声明**：只给默认值时 tsc 只能从默认值推出
 * `{ root?: string; force?: boolean }`，于是 `target` / `sha` / `baseline` 既在函数里读不到
 * （TS2339），也在每个调用点被判成"多余属性"（TS2353）。
 * @typedef {object} DecideOptions
 * @property {string} [root] 仓库根；缺省为仓库自身（selftest 注入临时仓库）
 * @property {string} [target] 目标 harness 版本（逻辑上必填：`--harness`；写成可选是为了让
 *   形参默认值 `= {}` 仍合法 —— 缺了它 `requirePair()` 会先抛错，行为不变）
 * @property {string} [sha] 插件 commit（逻辑上必填：`--sha`，同上）
 * @property {boolean} [force] `--force`：无条件重跑
 * @property {object|null} [baseline] 基线对象；`undefined` ⇒ 从 `root` 读盘，`null` ⇒ 当作「无基线」
 */

/**
 * **唯一的判定函数** —— `check` 与 `selftest` 共用它，所以自检钉的就是生产逻辑本身。
 * `root` / `baseline` 可注入，便于在临时仓库里跑（不必碰真仓库）。
 * @param {DecideOptions} [opts]
 */
function decide({ root = ROOT, target, sha, force = false, baseline } = {}) {
  if (force) return { shouldRun: true, why: '--force 指定强制重跑' };
  const bl = baseline === undefined ? readBaseline(root) : baseline;
  if (!bl) return { shouldRun: true, why: '基线文件不存在（首轮）' };
  if (bl.status !== 'pass') return { shouldRun: true, why: `基线 status=${bl.status}（只认 pass）` };
  if (bl.harness?.version !== target) {
    return { shouldRun: true, why: `harness ${bl.harness?.version ?? '（无）'} → 目标 ${target}` };
  }
  const cur = pluginRevision(root, sha);
  if (bl.plugin?.revision && cur && bl.plugin.revision === cur) {
    return { shouldRun: false, why: `基线已覆盖 ${target}（插件内容身份未变：${cur}）` };
  }
  if (bl.plugin?.commit !== sha) {
    return {
      shouldRun: true,
      why: `插件 ${String(bl.plugin?.commit ?? '').slice(0, 7)} → ${sha.slice(0, 7)}`
        + `（内容身份 ${bl.plugin?.revision ?? '（无）'} → ${cur ?? '（取不到）'}）`,
    };
  }
  return { shouldRun: false, why: `基线已覆盖 ${target} × ${sha.slice(0, 7)}` };
}

function check(args) {
  const { target, sha } = requirePair(args);
  const { shouldRun, why } = decide({ target, sha, force: args.force });
  console.log(`harness-compat check：${why} ⇒ should_run=${shouldRun}`);
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, `should_run=${shouldRun}\n`, { flag: 'a' });
  }
}

function record(args) {
  const { target, sha } = requirePair(args);
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const revision = pluginRevision(ROOT, sha);
  const bl = readBaseline();
  const already = bl && bl.status === 'pass' && bl.harness?.version === target
    && (revision ? bl.plugin?.revision === revision : bl.plugin?.commit === sha);
  if (already) {
    console.log(`harness-compat record：${target} × ${sha.slice(0, 7)} 已在基线，不改动`);
    return;
  }
  const plugin = { commit: sha, version: pkg.version || '' };
  if (revision) plugin.revision = revision;
  const doc = {
    harness: { package: HARNESS_PKG, distTag: args['dist-tag'] || 'latest', version: target },
    plugin,
    node: args.node || '',
    runner: args.runner || '',
    runId: process.env.GITHUB_RUN_ID || '',
    status: 'pass',
    passedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
  writeFileSync(baselinePath(ROOT), JSON.stringify(doc, null, 2) + '\n');
  console.log(`harness-compat record：${target} × ${sha.slice(0, 7)} 写入基线`
    + `（内容身份 ${revision ?? '取不到，只记 sha'}）`);
}

/**
 * 自检：在一个**临时 git 仓库**里跑同一条 `decide`，正/负对照成对。
 * 核心不变量：**只动基线文件不构成"插件变了"** —— 那正是"追尾"的成因。
 */
function selftest() {
  const root = mkdtempSync(join(tmpdir(), 'hc-baseline-selftest-'));
  const results = [];
  const ok = (name, cond, detail) => results.push({ name, cond: Boolean(cond), detail });
  const git = (...argv) => (runCapture(root, 'git', argv) || '').trim();
  try {
    git('init', '-q');
    git('config', 'user.email', 'selftest@example.invalid');
    git('config', 'user.name', 'selftest');
    mkdirSync(join(root, '.github'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'selftest', version: '0.0.0' }) + '\n');
    writeFileSync(join(root, 'work.txt'), 'v1\n');
    git('add', '-A');
    git('commit', '-qm', 'work v1');
    const sha1 = git('rev-parse', 'HEAD');
    const rev1 = pluginRevision(root, sha1);
    ok('能算出插件内容身份（16 位）', typeof rev1 === 'string' && rev1.length === 16, rev1);

    const H = '1.2.3';
    ok('负对照：无基线 ⇒ should_run=true',
      decide({ root, target: H, sha: sha1, baseline: null }).shouldRun === true);
    ok('负对照：harness 版本不同 ⇒ should_run=true',
      decide({ root, target: H, sha: sha1, baseline: { status: 'pass', harness: { version: '0.0.1' }, plugin: { commit: sha1, revision: rev1 } } }).shouldRun === true);

    // ③ 只动基线文件（= `record` 自己制造的那种提交）⇒ 身份不变 ⇒ **不该跑**。这就是"追尾"的修法。
    const bl = { status: 'pass', harness: { version: H }, plugin: { commit: sha1, revision: rev1 } };
    writeFileSync(baselinePath(root), '{}\n');
    git('add', '-A');
    git('commit', '-qm', 'ci(baseline): selftest');
    const sha2 = git('rev-parse', 'HEAD');
    ok('只动基线文件 ⇒ 内容身份不变', pluginRevision(root, sha2) === rev1, pluginRevision(root, sha2));
    const d3 = decide({ root, target: H, sha: sha2, baseline: bl });
    ok('正判据：只动基线文件 ⇒ should_run=false（追尾修法）', d3.shouldRun === false, d3.why);

    // ④ 真文件变了 ⇒ 必须重跑。
    writeFileSync(join(root, 'work.txt'), 'v2\n');
    git('add', '-A');
    git('commit', '-qm', 'work v2');
    const sha3 = git('rev-parse', 'HEAD');
    ok('正判据：真文件变了 ⇒ 内容身份变了', pluginRevision(root, sha3) !== rev1, pluginRevision(root, sha3));
    const d4 = decide({ root, target: H, sha: sha3, baseline: bl });
    ok('正判据：真文件变了 ⇒ should_run=true', d4.shouldRun === true, d4.why);

    // ⑤ 更早写的基线没有 revision ⇒ 退回按 sha 比较（安全方向：宁可多跑）。
    const legacy = { status: 'pass', harness: { version: H }, plugin: { commit: sha3 } };
    ok('回退：无 revision 且 sha 相同 ⇒ should_run=false',
      decide({ root, target: H, sha: sha3, baseline: legacy }).shouldRun === false);
    ok('回退：无 revision 且 sha 不同 ⇒ should_run=true',
      decide({ root, target: H, sha: sha2, baseline: legacy }).shouldRun === true);
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  let failed = 0;
  for (const r of results) {
    console.log((r.cond ? '✓ ' : '✗ ') + r.name + (r.detail ? ' — ' + r.detail : ''));
    if (!r.cond) failed++;
  }
  console.log('');
  if (failed) {
    console.log(`harness-compat-baseline selftest FAILED — ${failed}/${results.length}`);
    process.exit(1);
  }
  console.log(`harness-compat-baseline selftest PASSED (${results.length})`);
}

const cmd = process.argv[2];
const rest = process.argv.slice(3);
try {
  const args = parseArgs(rest);
  if (cmd === 'check') check(args);
  else if (cmd === 'record') record(args);
  else if (cmd === 'selftest') selftest();
  else throw new Error(`未知子命令：${cmd || '（空）'}（可用：check / record / selftest）`);
} catch (err) {
  console.error(`harness-compat-baseline：${err.message}`);
  process.exit(1);
}
