/**
 * test/tools/child-out.mjs —— 拿子进程输出的**唯一**方式（本仓）。
 *
 * 为什么要有这个文件：本会话沙箱（以及部分受限环境）**禁止子进程管道**，而
 * `execFileSync` / `spawnSync` 默认就是 pipe ⇒ 抛 `EPERM`。判据里的"读 runner 的
 * --list-json""检查子进程输出"这类写法会因此**假红**——看起来像"链坏了/文件缺了"，
 * 实际是传输方式与环境不兼容。
 *
 * 实测踩过三次（verify-guard-chain 的 readChain / verify-scene-live-occlusion 的语法检查 /
 * verify-package-files 的 runner 探测）。收敛到这一处，后续不要再各写一份：
 *   · 需要输出 → `runNodeCaptured(args, opts)`：stdout 落到 .test-cache 临时文件再读回。
 *   · 只要退出码/是否成功 → `runNodeStatus(args, opts)`：`stdio: 'ignore'`（不产生管道）。
 */
import { execFileSync } from 'node:child_process';
import { openSync, closeSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TMP_DIR = join(ROOT, '.test-cache');

/** 跑一个 node 子进程并**把 stdout 写到文件后读回**；失败（非零退出）时抛，行为与 execFileSync 一致。 */
export function runNodeCaptured(args, opts = {}) {
  mkdirSync(TMP_DIR, { recursive: true });
  const tmp = join(TMP_DIR, 'child-out-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.txt');
  const fd = openSync(tmp, 'w');
  try {
    execFileSync(process.execPath, args, { ...opts, stdio: ['ignore', fd, 'inherit'] });
  } finally {
    closeSync(fd);
  }
  const out = readFileSync(tmp, 'utf8');
  try { rmSync(tmp, { force: true }); } catch { /* 清理失败不影响判据 */ }
  return out;
}

/** 只要"成功/失败"：不捕获任何输出（因此不产生管道）。 */
export function runNodeStatus(args, opts = {}) {
  try {
    execFileSync(process.execPath, args, { ...opts, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
