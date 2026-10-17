/**
 * repo-face.mjs —— 「仓库扫描面」的**唯一口径**（task：**脏扫描面 ⇒ 假绿**）。
 *
 * ══ 它解决的问题 ══════════════════════════════════════════════════════════════
 * 判据用 `listFiles(ROOT) + SKIP_DIRS` 现算扫描面时，**本机多出来的副本**会一起进面：
 *   · 仓库里嵌着**另一个完整 git worktree**（实测 `.integration-notes/scratch/head-wt/**`，
 *     里面还带一个 `.git` 标记）；
 *   · 被 `.gitignore` 忽略的本地目录（`.integration-notes/`、`.npm-cache/`、`_refs/`、
 *     `scripts/out|reverse|core|anim` …）。
 * 于是"这个名字有没有人消费"这类判据会在**另一份副本**里读到它 ⇒ **本机恒绿、CI 红**
 * （实测：消费者面本机 1483 个代码文件 vs 干净检出 263 个）。
 *
 * ⚠️ 这是"扫描面写死"家族的**镜像面**：那一类是**面太窄**（漏报 → 假红/漏判），
 *    这一类是**面太脏**（多出副本 → **假绿**，更危险：本机看不见、CI 才报的问题）。
 *
 * ══ 口径（两条独立机制，都要）══════════════════════════════════════════════════
 *   ① **嵌套仓库一律不扫**：任何目录里出现 `.git`（目录，或 linked worktree 的 `.git` 文件）
 *      ⇒ 那是"另一份工作副本"，不是本仓的源码面。
 *   ② **gitignore 的本地目录按名单不扫**：`DEFAULT_SKIP` 里的**相对路径**（前缀匹配）。
 *      名单是**实测**出来的，加条目要写理由；不允许"把不确定的都塞进来"（那会让面变窄）。
 * 两条之外，`listFace()` 还会跳过平凡目录名（`.git` / `node_modules` / `.test-cache` …）。
 *
 * ══ 自检（独立真源）════════════════════════════════════════════════════════════
 * `gitTrackedFiles()` / `gitViewDiff()` 用 **`git ls-files`** 当独立真源，把"走出来的面"
 * 与"git 视角的面"对账：
 *   · 走出来的文件**不在** git 视角里 ⇒ 要么它是被有意忽略的产物（用 `allowedExtra` 逐条说明），
 *     要么就是"又一撮脏东西" ⇒ 判红；
 *   · git 视角里的代码文件**没被走到** ⇒ 面变窄了 ⇒ 判红。
 * git 不可用（或沙箱禁子进程 ⇒ EPERM）时返回**具名 SKIP**（`{ ok: false, reason }`），
 * 由调用方打印成「SKIP（原因）」，**不许**静默当成"一致"。
 */
import { readdirSync, existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

/** 平凡跳过：版本库元数据 / 依赖 / 测试缓存 / 构建与覆盖率产物。 */
export const PLAIN_SKIP_DIRS = new Set([
  '.git', 'node_modules', '.test-cache', '.cache', '.npm-cache', 'dist', 'build', 'coverage', '.dsh',
]);

/**
 * 被 `.gitignore` 忽略的**本地目录**（相对仓库根，POSIX；前缀匹配）。
 * 每条都对应 `.gitignore` 里的一条（括号里是那一条），不是"猜着塞"：
 *   `.integration-notes`（`/.integration-notes/`：本地移交/取证笔记，**嵌着另一个 worktree**）、
 *   `_refs`（`/_refs/`）、`scripts/out|reverse|core|anim|lwe-ref`（`/scripts/out/` 等）、
 *   `.zcode` / `.v2c` / `.video_agent`（ZCode 本地文件）、`.git.bak-broken`、`.playwright-mcp`。
 * ⚠️ 只有**确实可能装着代码副本**的才进这张表（文档/图片类目录本来就不在代码扩展名内）。
 */
export const DEFAULT_SKIP = [
  '.integration-notes', '_refs', '.zcode', '.v2c', '.video_agent', '.git.bak-broken', '.playwright-mcp',
  'scripts/out', 'scripts/reverse', 'scripts/core', 'scripts/anim', 'scripts/lwe-ref',
];

/** 该目录是不是"另一份工作副本"（含 `.git` 目录，或 linked worktree 的 `.git` 文件）。 */
export function isNestedRepoDir(absDir) {
  return existsSync(join(absDir, '.git'));
}

/** 相对路径是否落在跳过名单里（相对路径 posix 前缀匹配）。 */
function inSkipList(rel, skip) {
  return skip.some((s) => rel === s || rel.startsWith(s + '/'));
}

/**
 * 列出扫描面（绝对路径，字典序）。
 *
 * @param {string} root 仓库根
 * @param {{exts?: string[], skip?: string[], skipDirs?: Set<string>, skipNestedRepos?: boolean}} [opts]
 *   `skipNestedRepos: false` 只为**负对照**准备（复现"没修之前会把另一份副本算进来"的假绿）。
 * @returns {string[]}
 */
export function listFace(root, opts = {}) {
  const exts = opts.exts || ['.js'];
  const skipDirs = opts.skipDirs || PLAIN_SKIP_DIRS;
  const skip = opts.skip === undefined ? DEFAULT_SKIP : opts.skip;
  const skipNestedRepos = opts.skipNestedRepos !== false;
  const out = [];
  const walk = (absDir, rel) => {
    let entries;
    try { entries = readdirSync(absDir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = join(absDir, e.name);
      const childRel = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) {
        if (skipDirs.has(e.name)) continue;
        if (inSkipList(childRel, skip)) continue;
        if (skipNestedRepos && isNestedRepoDir(abs)) continue; // 口径 ①
        walk(abs, childRel);
        continue;
      }
      if (exts.some((x) => e.name.endsWith(x))) out.push(abs);
    }
  };
  walk(root, '');
  return out.sort();
}

/**
 * `git ls-files` 视角的文件面（相对 root、POSIX，字典序）。
 * @returns {{ok: true, files: string[]} | {ok: false, reason: string}}
 */
export function gitTrackedFiles(root) {
  let r;
  try {
    r = spawnSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    return { ok: false, reason: 'fatal:' + ((e && e.code) || (e && e.message) || String(e)) };
  }
  if (r.error) return { ok: false, reason: 'fatal:' + (r.error.code || r.error.message) };
  if (r.status !== 0) return { ok: false, reason: 'exit:' + r.status + ' ' + String(r.stderr || '').trim().slice(0, 120) };
  const files = String(r.stdout || '').split('\0').filter(Boolean).map((p) => p.split(sep).join('/')).sort();
  return { ok: true, files };
}

/**
 * **纯函数**：走出来的面（相对路径）vs git 视角的文件面 ⇒ 差集。
 * `gitViewDiff` 与负对照都调这一份（负对照喂合成输入，不用真 git）。
 * @param {string[]} walkedRel 相对 root、POSIX
 * @param {string[]} trackedFiles git ls-files 的相对路径
 * @param {{exts?: string[], allowedExtra?: string[]}} [opts]
 * @returns {{ok: boolean, extra: string[], missing: string[], trackedCode: number, walkedCount: number}}
 */
export function diffFace(walkedRel, trackedFiles, opts = {}) {
  const exts = opts.exts || ['.js'];
  const allowedExtra = new Set(opts.allowedExtra || []);
  const walkedSet = new Set(walkedRel);
  const trackedSet = new Set(trackedFiles);
  const trackedCode = trackedFiles.filter((f) => exts.some((x) => f.endsWith(x)));
  const extra = walkedRel.filter((f) => !trackedSet.has(f) && !allowedExtra.has(f));
  const missing = trackedCode.filter((f) => !walkedSet.has(f));
  return { ok: extra.length === 0 && missing.length === 0, extra, missing, trackedCode: trackedCode.length, walkedCount: walkedRel.length };
}

/**
 * 走出来的面 vs git 视角 ⇒ 差集（`allowedExtra` 里的差异视为**可解释**，逐条要写理由）。
 * @param {string} root
 * @param {string[]} walked `listFace()` 的绝对路径结果
 * @param {{exts?: string[], allowedExtra?: string[]}} [opts]
 * @returns {{ok: boolean, reason?: string, extra: string[], missing: string[], trackedCode: number, walkedCount: number}}
 */
export function gitViewDiff(root, walked, opts = {}) {
  const exts = opts.exts || ['.js'];
  const tracked = gitTrackedFiles(root);
  if (!tracked.ok) {
    return { ok: false, reason: tracked.reason, extra: [], missing: [], trackedCode: 0, walkedCount: walked.length };
  }
  const walkedRel = walked.map((p) => p.slice(root.length + 1).split(sep).join('/'));
  return diffFace(walkedRel, tracked.files, { exts, allowedExtra: opts.allowedExtra });
}
