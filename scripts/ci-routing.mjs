#!/usr/bin/env node
/**
 * scripts/ci-routing.mjs — 变更分类与文档快通道的**命令行入口**（薄壳）。
 *
 * 判据本身在 `test/tools/ci-routing.mjs`（纯函数 + 负对照），这里只做
 * 「读参数 → 跑 git 取差异 → 调纯函数 → 打印 → 写 GITHUB_OUTPUT → 非 0 退出」，
 * 与 `test/verify-ci-steps.mjs` / `test/tools/ci-workflow.mjs` 的分层一致。
 *
 * ## 用法
 *   node scripts/ci-routing.mjs check [--base <ref>] [--head <ref>] [--json] [--github-output]
 *       —— 只分类，输出 docs / docs-assets / notice / full 与原因；分类成功退出码 0。
 *         取不到差异 / 参数错误退出码 2（阻断：分类失败绝不能默认文档）。
 *   node scripts/ci-routing.mjs docs [--base <ref>] [--head <ref>] [--json] [--github-output]
 *       —— 跑文档快通道（冲突标记 / 尾随空白 / 本地引用 / 素材非空）。
 *         有发现退出码 1；**差异不是纯文档时退出码 3（明确拒绝，不是"跳过即通过"）**。
 *   node scripts/ci-routing.mjs notice [--base <ref>] [--head <ref>] [--json] [--github-output]
 *       —— 跑**公告快通道**（只改更新公告文案的提交）。内容级判据：两个公告文件的
 *         `UPDATE NOTICE COPY` 区块**外**逐字节一致、区块**内**代码骨架一致。
 *         通过退出码 0；骨架/区块外有改动退出码 1；取不到内容或差异不是纯公告退出码 2/3。
 *
 * ## 四个曾经写错的地方（都在这里钉住）
 *   ① **差异必须是整段 PR 的**：`--base` 给定时取 `merge-base(base, head)` 再 diff，
 *      否则"基线分支自己前进的部分"会被算成这次 PR 的反向改动（还会漏掉真正的改动）。
 *   ② **本地通道一条都不能漏**：`--head` 缺省时把 staged、unstaged、untracked 全并进来。
 *      只看 `HEAD^..HEAD` 会让"改完没提交"的代码文件从分类里消失。
 *   ③ **`--flag=value` 与 `--flag value` 等价**：只认空格形态会让 `--base=origin/main`
 *      通过参数校验却**不被读取**，静默退回 `head^` —— 分类对象悄悄换了，没人会注意。
 *   ④ **`docs` 在 full 差异上必须非 0 拒绝**：否则一旦有人把 `docs` 接进必跑步骤，
 *      "这次不是纯文档"就会变成绿灯 —— 那正是这条捷径最危险的失败方式。
 *
 * ## 子进程输出走常规管道
 * `spawnSync` 的默认 `stdio: 'pipe'` 由 Node 自己回读，CI 与本地同一条通道。
 * ⚠️ 受限沙箱里"带管道的 spawn"可能直接 `EPERM`（本仓实测过 `execFileSync` 形态）。
 * 那种情况**只如实记录**（本文件把 `r.error.code/message` 原样带进错误串），不换通道、
 * 不改 stdio 去绕边界 —— 换通道会让"本机跑不了"与"真的取不到差异"长得一样，
 * 而分类器的全部安全性都建立在"取不到差异 ⇒ 阻断"上。
 */
import { spawnSync } from 'node:child_process';
import {
  appendFileSync, existsSync, lstatSync, readFileSync, statSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseInlineModules } from '../test/tools/src-scope.mjs';
import {
  MODES, MODE_FULL, MODE_NOTICE, SYMLINK_MODE, NOTICE_FILES,
  parseRawDiff, classify, auditDocs, judgeResult, judgeNoticeEdit,
} from '../test/tools/ci-routing.mjs';

/**
 * 词表族文件（`src/i18n/i18n-copy.js` + 各 `src/i18n/i18n-copy-*.js`）。
 * 从构建脚本的 INLINE_MODULES 现解析（单一真源，不抄第二份）；解析失败就退回只查公告
 * 词表文件 —— 缺文件的真实缺陷由 full 链的 `verify-i18n` 判，不在这里重复实现。
 */
function dictionaryFamilyFiles() {
  try {
    return parseInlineModules().map(({ file }) => file)
      .filter((file) => /(?:^|\/)i18n-copy(?:-[^/]+)?\.js$/.test(file));
  } catch {
    return ['src/i18n/i18n-copy-ext.js'];
  }
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const posix = (p) => String(p == null ? '' : p).split('\\').join('/');

const USAGE = [
  '用法：node scripts/ci-routing.mjs <check|docs|notice|judgeResult> [选项]',
  '',
  'check / docs / notice 选项：',
  '  --base <ref>        PR 基线：取 merge-base(base, head) 之后的完整差异（缺省用 head^）',
  '  --head <ref>        被检视的提交（缺省 HEAD）',
  '  --base-mode <mode>  差异边界模式：merge-base（缺省，PR 用）| exact（push 用，按 before→after 原样 diff，需 --base 与 --head 双端）',
  '  --local             额外把 staged / unstaged / untracked 全部纳入（--head 缺省时自动开）',
  '  --json              机器可读输出',
  '  --github-output     把 mode / reason / count 写进 $GITHUB_OUTPUT（CI 用）',
  '',
  'judgeResult 选项（ci/result 汇总核验，fail-closed）：',
  '  --mode <mode>       changes 作业分类出的模式（docs / docs-assets / notice / full）',
  '  --changes <result>  changes 作业的 needs.<job>.result',
  '  --docs <result>     docs 作业的 needs.<job>.result',
  '  --notice <result>   notice 作业的 needs.<job>.result',
  '  --full <result>     full 作业的 needs.<job>.result',
  '  --github-output     把 ok / reason 写进 $GITHUB_OUTPUT（CI 用）',
  '',
].join('\n');

/** 已知参数表：`value` 要吃一个值，`bool` 不接受取值。 */
const FLAGS = {
  '--base': 'value',
  '--base-mode': 'value',
  '--head': 'value',
  '--json': 'bool',
  '--local': 'bool',
  '--github-output': 'bool',
  '--mode': 'value',
  '--changes': 'value',
  '--docs': 'value',
  '--notice': 'value',
  '--full': 'value',
};

/** 值域表：取值受限的带值参数。取值错了等于悄悄换了差异边界，必须当场拒绝。 */
const VALUE_DOMAINS = {
  '--base-mode': ['merge-base', 'exact'],
};

/**
 * GitHub 的**全零 SHA**（push 事件的 `before` 在「新建分支 / 首次推送」时取这个值）。
 * 它不是任何 git 对象：送去 `git diff` 只会 `fatal: bad object`。语义上等于**空树** ——
 * 分支在此前不存在，整条历史都是本次推送带来的。
 */
const ZERO_SHA_RE = /^0{40}$/;

const camel = (flag) => flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());

/**
 * 解析参数（纯函数，负对照可以喂合成 argv）。
 * 返回 `{ cmd, base, head, json, local, githubOutput, errors }`；`errors` 非空 ⇒ 用法错误。
 */
export function parseArgs(argv) {
  const out = { cmd: '', base: '', head: '', baseMode: '', json: false, local: false, githubOutput: false, errors: [] };
  const list = Array.isArray(argv) ? argv.slice() : [];
  if (list.length && !String(list[0]).startsWith('-')) out.cmd = String(list.shift());
  for (let i = 0; i < list.length; i += 1) {
    const arg = String(list[i]);
    const eq = arg.indexOf('=');
    const name = eq > 0 ? arg.slice(0, eq) : arg;
    const inline = eq > 0 ? arg.slice(eq + 1) : null;
    const kind = FLAGS[name];
    if (!kind) { out.errors.push('未知参数：' + arg); continue; }
    if (kind === 'bool') {
      if (inline != null) { out.errors.push('布尔参数不接受取值：' + arg); continue; }
      out[camel(name)] = true;
      continue;
    }
    let value = inline;
    if (value == null) {
      const next = list[i + 1];
      if (next == null || String(next).startsWith('--')) { out.errors.push('参数缺值：' + name); continue; }
      value = String(next);
      i += 1;
    }
    if (!value) { out.errors.push('参数值为空：' + name); continue; }
    const domain = VALUE_DOMAINS[name];
    if (domain && !domain.includes(value)) {
      out.errors.push('参数取值不在允许范围：' + name + ' 只认 ' + domain.join(' / '));
      continue;
    }
    out[camel(name)] = value;
  }
  return out;
}

/**
 * 造一个 git 执行器：`(args) => { ok, out, err }`（不抛、不退出）。
 * 注入点在这里 —— 测试可以换成合成输出，不必真的起子进程。
 *
 * 输出捕获用 `spawnSync` 的常规管道（默认 `stdio: 'pipe'`）。`r.error` 一旦存在
 * （受限沙箱里的 `EPERM`、`git` 不在 PATH 的 `ENOENT`、超时被杀……）一律返回 `ok:false`
 * 并把 `code` / `message` 原样带出 —— 调用方据此 **fail-closed**（分类失败 ⇒ 阻断），
 * 绝不把"跑不了"读成"没有差异"。
 */
export function makeGit(root) {
  return (args) => {
    const r = spawnSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' });
    const out = r.stdout == null ? '' : String(r.stdout);
    const err = r.stderr == null ? '' : String(r.stderr).trim();
    if (r.error) {
      // TS2339：`r.error` 静态型是 `Error`（没有 `code` 属性），但运行时 Node 把子进程
      // 启动失败的 `SystemError` 原样放进这里（EPERM / ENOENT / ETIMEDOUT…）。
      // 用 `in` 收窄取码，缺省/空串回落 'error' —— 与原先 `|| 'error'` 的语义逐字一致。
      const e = r.error;
      const code = 'code' in e && e.code ? String(e.code) : 'error';
      return {
        ok: false,
        out,
        err: 'git 子进程不可用（' + code + '）：' + String(e.message),
      };
    }
    if (r.status !== 0) {
      return { ok: false, out, err: err || ('git 退出码 ' + String(r.status) + '：git ' + args.join(' ')) };
    }
    return { ok: true, out, err };
  };
}

const riskyStatus = (s) => !(s === 'A' || s === 'M');

/** 同一路径在多条通道里出现时合并：**风险更高的状态与符号链接模式位都保留**。 */
function mergeEntry(prev, next) {
  const status = riskyStatus(prev.status) ? prev.status : (riskyStatus(next.status) ? next.status : 'M');
  const newMode = (prev.newMode === SYMLINK_MODE || next.newMode === SYMLINK_MODE)
    ? SYMLINK_MODE : (next.newMode || prev.newMode);
  const oldMode = prev.oldMode === SYMLINK_MODE ? prev.oldMode : (next.oldMode || prev.oldMode);
  return { status, path: next.path, oldPath: next.oldPath || prev.oldPath, oldMode, newMode };
}

/** 未跟踪件没法从 git 拿模式位 ⇒ 看盘上是不是符号链接（是 ⇒ 与已跟踪件同判）。 */
function modeOfFile(root, rel) {
  try {
    return lstatSync(resolve(root, rel)).isSymbolicLink() ? SYMLINK_MODE : '100644';
  } catch {
    return '100644';
  }
}

/**
 * 取完整差异（纯编排：所有 git 调用都检查成败，任一失败 ⇒ `{ ok: false }`）。
 *
 * 通道：`base..head` 的 `--raw -z`（带模式位）+ 本地模式下的 `HEAD` 工作区差异 + 未跟踪件。
 */
export function collectDiff(input) {
  const src = input || {};
  const git = src.git;
  const root = src.root || ROOT;
  const base = String(src.base || '');
  const head = String(src.head || '');
  const target = head || 'HEAD';
  const wantLocal = Boolean(src.local) || !head;

  let baseRef;
  const notes = [];
  // --base-mode exact（push 专用）：before/after 是**精确差异范围**，不取 merge-base ——
  // force-push 后 before 不是 after 的祖先，共同祖先形态下 merge-base 会把 before 独有的
  // 代码删除算漏（详见 selftest 的合成反例）。PR 场景**禁止**传 exact（misuse 报错阻断）。
  if (src.baseMode === 'exact') {
    if (!base) return { ok: false, reason: '--base-mode exact 需要 --base（push 的 before）；没有边界就阻断，不猜' };
    if (!head) return { ok: false, reason: '--base-mode exact 需要 --head（push 的 after）；精确模式必须有双端，不给本地通道' };
    // GitHub 在**新建分支 / 首次推送**时把 push 事件的 `before` 填成全零 SHA（40 个 0）。
    // 它不是一个 git 对象，直接 `git diff --raw 000…  <head>` 会 `fatal: bad object`，
    // 于是"跑不了"被当成阻断（本意是 fail-closed，但这里是**必然误报**：分支之前根本
    // 不存在，整条历史都是本次推送新增的）。零 SHA 的语义就是**空树**，与下面根提交
    // 分支同形处理 ⇒ 该提交的全部文件都是"新增"，仍在安全方向上（差异只会更大，不会漏）。
    if (ZERO_SHA_RE.test(base)) {
      const empty = git(['hash-object', '-t', 'tree', '/dev/null']);
      if (!empty.ok) return { ok: false, reason: 'git hash-object 失败：' + empty.err };
      baseRef = String(empty.out).trim();
      notes.push('push 的 before 是全零 SHA（' + base + '：新建分支 / 首次推送）⇒ 按空树 diff，全部文件计为新增');
    } else {
      baseRef = base;
    }
  } else if (base) {
    const mb = git(['merge-base', base, target]);
    if (mb.ok && String(mb.out).trim()) {
      baseRef = String(mb.out).trim();
    } else {
      // 没有共同祖先（新分支 / 无关历史）：只要 base 能解析成一个对象就按它直接 diff。
      // 这不放宽判据 —— 整段 base..head 的改动仍然全在差异里，只是不再"取 merge-base"。
      const kind = git(['cat-file', '-t', base]);
      const type = kind.ok ? String(kind.out).trim() : '';
      if (type === 'tree' || type === 'commit') {
        baseRef = base;
        notes.push('merge-base(' + base + ', ' + target + ') 不可得，按 ' + type + ' ' + base + ' 直接 diff');
      } else {
        return { ok: false, reason: '取 merge-base(' + base + ', ' + target + ') 失败，且 base 不是可解析的提交/树：'
          + (mb.err || '空输出') };
      }
    }
  } else {
    const parent = git(['rev-parse', '--verify', target + '^']);
    if (parent.ok && String(parent.out).trim()) {
      baseRef = String(parent.out).trim();
    } else {
      // 根提交（没有父提交）：拿空树当 base ⇒ 该提交的全部文件都是"新增"。
      const empty = git(['hash-object', '-t', 'tree', '/dev/null']);
      if (!empty.ok) return { ok: false, reason: 'git hash-object 失败：' + empty.err };
      baseRef = String(empty.out).trim();
    }
  }

  const merged = new Map();
  const add = (entries) => {
    for (const e of entries) {
      if (!e || !e.path) continue;
      const prev = merged.get(e.path);
      merged.set(e.path, prev ? mergeEntry(prev, e) : e);
    }
  };

  const raw = git(['diff', '--raw', '-z', '--no-renames', baseRef, target]);
  if (!raw.ok) return { ok: false, reason: 'git diff --raw 失败：' + raw.err };
  add(parseRawDiff(raw.out));

  if (wantLocal) {
    // 已暂存 + 未暂存都在 `diff HEAD` 里（这条以前完全没跑 ⇒ 本地"完整差异"是假的）。
    const work = git(['diff', '--raw', '-z', '--no-renames', 'HEAD']);
    if (!work.ok) return { ok: false, reason: 'git diff --raw HEAD 失败：' + work.err };
    add(parseRawDiff(work.out));
    const untracked = git(['ls-files', '--others', '--exclude-standard', '-z']);
    if (!untracked.ok) return { ok: false, reason: 'git ls-files --others 失败：' + untracked.err };
    for (const p of String(untracked.out).split('\0').filter(Boolean)) {
      add([{ status: 'A', path: posix(p), oldPath: '', oldMode: '000000', newMode: modeOfFile(root, p) }]);
    }
  }

  const entries = [...merged.values()].sort((a, b) => (a.path < b.path ? -1 : (a.path > b.path ? 1 : 0)));
  return { ok: true, entries, baseRef, target, local: wantLocal };
}

/**
 * 文档检查探针（读盘）：**引用按所在目录解析，且不许爬出仓库**。
 * 越界（`../../etc/passwd` 之类）一律当"不存在" ⇒ 报 missing-ref，而不是去读仓库外的东西。
 */
export function makeProbes(root) {
  const inside = (rel) => {
    const abs = resolve(root, rel);
    return abs === root || abs.startsWith(root + sep);
  };
  const read = (p) => {
    const rel = posix(p);
    if (!rel || !inside(rel)) return null;
    try { return readFileSync(resolve(root, rel), 'utf8'); } catch { return null; }
  };
  const exists = (spec, baseDir) => {
    const rel = posix(join(String(baseDir || ''), String(spec || '')));
    if (!rel || !inside(rel)) return false;
    try { return existsSync(resolve(root, rel)); } catch { return false; }
  };
  const sizeOf = (p) => {
    const rel = posix(p);
    if (!rel || !inside(rel)) return 0;
    try { return statSync(resolve(root, rel)).size; } catch { return 0; }
  };
  return { read, exists, sizeOf };
}

/** 把分类结果写进 `$GITHUB_OUTPUT`（多行安全：逐行 `k=v`，追加写）。 */
export function writeOutputs(payload, env) {
  const path = String((env && env.GITHUB_OUTPUT) || '');
  if (!path) return false;
  const reasons = Array.isArray(payload.reasons) ? payload.reasons : [];
  const lines = [
    'mode=' + String(payload.mode || ''),
    'reason=' + String(reasons[0] || '').replace(/[\r\n]+/g, ' '),
    'count=' + String(payload.count == null ? (payload.files || []).length : payload.count),
  ];
  appendFileSync(path, lines.join('\n') + '\n');
  return true;
}

/** 拒绝路径的退出码（与"有发现"1、"取不到差异"2 区分开）。 */
export const EXIT_REFUSED = 3;

/**
 * `judge-result` 子命令：ci/result 汇总作业的核心（fail-closed）。
 * 调 `test/tools/ci-routing.mjs` 的 `judgeResult` 纯函数核验"该跑的作业真的 success"，
 * 打印每条不放行的理由，返回退出码：0 放行 / 1 不放行（缺 mode 等参数错误也算 1 ——
 * 汇总作业宁可红，也不给"参数没接上"发绿）。
 */
export function judgeResultMain(args, deps) {
  const d = deps || {};
  const log = d.log || ((s) => console.log(s));
  const env = d.env || process.env;
  const jobs = {
    changes: String(args.changes || ''),
    docs: String(args.docs || ''),
    notice: String(args.notice || ''),
    full: String(args.full || ''),
  };
  const verdict = judgeResult({ mode: args.mode, jobs });
  const lines = ['mode=' + String(args.mode || ''), 'ok=' + (verdict.ok ? 'true' : 'false'),
    ...verdict.reasons.map((r, i) => 'reason' + (i + 1) + '=' + String(r).replace(/[\r\n]+/g, ' '))];
  const path = String(env.GITHUB_OUTPUT || '');
  if (args.githubOutput && path) {
    try {
      appendFileSync(path, lines.join('\n') + '\n');
    } catch (err) {
      log('写 GITHUB_OUTPUT 失败（照旧按判词退出）：' + String(err && err.message ? err.message : err));
    }
  }
  log('\nci/result（mode=' + String(args.mode || '空') + ' · changes=' + (jobs.changes || '空')
    + ' docs=' + (jobs.docs || '空') + ' notice=' + (jobs.notice || '空')
    + ' full=' + (jobs.full || '空') + '）');
  if (verdict.ok) {
    log('  ✓ 该跑的作业都真的 success（跳过的那条腿是按设计跳过）');
    return 0;
  }
  for (const r of verdict.reasons) log('  ✗ ' + r);
  log('\nRESULT GATE FAILED — 不放行（fail-closed：失败/取消/缺失/意外跳过/未知 mode 都不是绿）');
  return 1;
}

/**
 * `notice` 子命令：公告快通道的**内容级**判定（CLI 侧负责取两份内容，判据在纯函数里）。
 *
 * 分类器（`classify`）只能看出"恰好改了两个公告文件"，看不到内容；这里把 base 侧与 head 侧
 * 的**文件内容**读出来交给 `judgeNoticeEdit`：区块外必须逐字节一致、区块内代码骨架必须一致。
 *
 * 取旧版本内容走 `git show <baseRef>:<path>`（**不是**工作树）—— 工作树就是新版，拿它当旧版
 * 会让判据恒真。任一取不到 ⇒ exit 2 阻断（fail-closed，绝不"取不到就算通过"）。
 *
 * 退出码：0 = 纯公告换血（放行）/ 1 = 结构或区块外有改动（判红，回落 full）/ 2 = 取不到内容（阻断）。
 */
export function noticeMain(args, deps) {
  const d = deps || {};
  const log = d.log || ((s) => console.log(s));
  const env = d.env || process.env;
  const root = d.root || ROOT;
  const git = d.git || makeGit(root);
  const readCurrent = d.readCurrent || ((rel) => {
    try { return readFileSync(resolve(root, rel), 'utf8'); } catch { return null; }
  });

  const diff = collectDiff({ git, root, base: args.base, head: args.head, local: args.local, baseMode: args.baseMode });
  if (!diff.ok) {
    log('\n公告快通道：取不到差异 ⇒ 阻断：' + diff.reason);
    return 2;
  }
  const classified = classify(diff.entries);
  if (classified.mode !== MODE_NOTICE) {
    // 不是纯公告改动：与 docs 通道同一口径 —— 明确拒绝（exit 3），不假成功。
    log('\n拒绝：本次差异不是"只改公告文案"（分类=' + classified.mode + '）—— 请跑 `npm run verify:all`。');
    for (const r of classified.reasons) log('   · ' + r);
    return EXIT_REFUSED;
  }

  const before = {};
  const after = {};
  for (const rel of NOTICE_FILES) {
    const show = git(['show', diff.baseRef + ':' + rel]);
    before[rel] = show.ok ? show.out : null;
    // ⚠️ **两个文件的当前内容都要读**（不只改动那个）：译文覆盖检查要拿未改动的那一侧
    // 现读的词表来核 —— 只改中文时正需要这条。
    after[rel] = readCurrent(rel);
  }
  const changed = diff.entries.map((e) => e.path).filter((p) => NOTICE_FILES.includes(p));

  // 译文覆盖检查要**整个词表族**：公告里的「知道了」等词条住在别的域文件
  // （`src/i18n/i18n-copy-core.js`），只查 `i18n-copy-ext.js` 会误判成漏译。族清单从构建脚本的
  // INLINE_MODULES 现解析（不抄第二份），文件读不到就跳过（缺文件由 full 链判）。
  const dictionary = dictionaryFamilyFiles()
    .map((rel) => readCurrent(rel))
    .filter((t) => t != null)
    .join('\n');

  const verdict = judgeNoticeEdit({ before, after, changed, dictionary });
  const payload = {
    ok: verdict.ok,
    mode: MODE_NOTICE,
    reasons: verdict.reasons,
    files: NOTICE_FILES.slice(),
    base: diff.baseRef,
    head: diff.target,
    count: diff.entries.length,
  };
  if (args.githubOutput) writeOutputs(payload, env);
  if (args.json) {
    log(JSON.stringify(payload, null, 2));
  } else {
    log('\n公告快通道（base=' + diff.baseRef + ' head=' + diff.target + '）');
    for (const r of verdict.reasons) log('  ' + (verdict.ok ? '✓' : '✗') + ' ' + r);
    log('\n' + (verdict.ok
      ? 'NOTICE FAST PATH PASSED —— 只改了公告文案（区块外逐字节一致 · 区块内骨架一致）'
      : 'NOTICE FAST PATH FAILED —— 这不是"只改公告文案"，回落 `npm run verify:all`'));
  }
  return verdict.ok ? 0 : 1;
}

/**
 * 主流程（可注入 `{ git, root, env, log }`，于是端到端可以喂合成差异而不碰真实索引）。
 * 返回退出码，不调用 `process.exit`。
 */
export function main(argv, deps) {
  const d = deps || {};
  const log = d.log || ((s) => console.log(s));
  const env = d.env || process.env;
  const root = d.root || ROOT;
  const git = d.git || makeGit(root);
  const args = parseArgs(argv);

  // ci/result 汇总核验走独立分支：不取差异，只核验各作业的真实 result（fail-closed）。
  if (args.cmd === 'judgeResult') {
    if (args.errors.length) {
      for (const e of args.errors) log('参数错误：' + e);
      log(USAGE);
      return 2;
    }
    return judgeResultMain(args, { log, env });
  }

  // 公告快通道：取两份内容 → 内容级判据（区块外逐字节一致 + 区块内骨架一致）。
  if (args.cmd === 'notice') {
    if (args.errors.length) {
      for (const e of args.errors) log('参数错误：' + e);
      log(USAGE);
      return 2;
    }
    if (args.baseMode === 'exact' && args.local) {
      log('参数错误：--base-mode exact（push 精确范围）与 --local（本地未提交通道）互斥');
      log(USAGE);
      return 2;
    }
    return noticeMain(args, { log, env, root, git });
  }

  if (args.errors.length || !['check', 'docs'].includes(args.cmd)) {
    for (const e of args.errors) log('参数错误：' + e);
    log(USAGE);
    return 2;
  }

  // exact（push 精确范围）与本地未提交通道互斥：push 审计的是"远程改动"，混入本地通道
  // 会把开发者机器上未推送的东西算进远程差异 —— 边界必须单一可审计。
  if (args.baseMode === 'exact' && args.local) {
    log('参数错误：--base-mode exact（push 精确范围）与 --local（本地未提交通道）互斥');
    log(USAGE);
    return 2;
  }

  const diff = collectDiff({ git, root, base: args.base, head: args.head, local: args.local, baseMode: args.baseMode });
  if (!diff.ok) {
    const payload = { ok: false, mode: MODE_FULL, reasons: [diff.reason], files: [], count: 0 };
    if (args.githubOutput) writeOutputs(payload, env);
    if (args.json) log(JSON.stringify(payload, null, 2));
    log('\n取不到完整差异 ⇒ 阻断（不按文档放行）：' + diff.reason);
    return 2;
  }

  const result = classify(diff.entries);
  if (!MODES.includes(result.mode)) {
    // 分类器返回了未登记的模式：宁可阻断，也不让下游 `if: outputs.mode == …` 落空。
    const payload = { ok: false, mode: MODE_FULL, reasons: ['分类器返回未登记模式：' + String(result.mode)], files: [], count: 0 };
    if (args.githubOutput) writeOutputs(payload, env);
    if (args.json) log(JSON.stringify(payload, null, 2));
    log('\n分类器返回未登记模式 ⇒ 阻断：' + String(result.mode));
    return 2;
  }

  const payload = {
    ok: true,
    mode: result.mode,
    reasons: result.reasons,
    files: result.files,
    base: diff.baseRef,
    head: diff.target,
    local: diff.local,
    count: diff.entries.length,
  };

  if (args.cmd === 'docs') {
    if (result.mode === MODE_FULL) {
      payload.ok = false;
      payload.refused = true;
      payload.findings = [];
      payload.counts = {};
      if (args.githubOutput) writeOutputs(payload, env);
      if (args.json) log(JSON.stringify(payload, null, 2));
      log('\n拒绝：本次差异不是纯文档，文档快通道不适用 —— 请跑 `npm run verify:all`。');
      for (const r of result.reasons) log('   · ' + r);
      return EXIT_REFUSED;
    }
    const audit = auditDocs({ entries: diff.entries, ...makeProbes(root) });
    payload.findings = audit.findings;
    payload.counts = audit.counts;
    if (args.githubOutput) writeOutputs(payload, env);
    if (args.json) {
      log(JSON.stringify(payload, null, 2));
    } else {
      log('\n文档快通道（' + result.mode + ' · 检查 ' + audit.counts.files + ' 个文件 / '
        + audit.counts.refs + ' 条相对引用' + (audit.assetMode ? ' · 含素材尺寸检查' : '') + '）');
      if (!audit.findings.length) log('  ✓ 无冲突标记 / 无本地断链' + (audit.assetMode ? ' / 素材均非空' : ''));
      for (const f of audit.findings) log('  ✗ ' + f.file + '（' + f.kind + '）：' + f.detail);
      log('\n' + (audit.findings.length
        ? 'DOC FAST PATH FAILED — ' + audit.findings.length + ' findings'
        : 'DOC FAST PATH PASSED') + '（仅文档检查，不代表代码门禁已过）');
    }
    return audit.findings.length ? 1 : 0;
  }

  if (args.githubOutput) writeOutputs(payload, env);
  if (args.json) {
    log(JSON.stringify(payload, null, 2));
  } else {
    log('\n变更分类（base=' + diff.baseRef + ' head=' + diff.target + ' · ' + diff.entries.length + ' 个条目'
      + (diff.local ? ' · 含本地未提交通道' : '') + '）');
    log('  路径：' + result.mode);
    for (const r of result.reasons) log('   · ' + r);
  }
  return 0;
}

const invokedDirectly = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
