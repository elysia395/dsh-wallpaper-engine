/**
 * warn-only.mjs —— 软档入口：跑一个守卫，**不让它决定红绿**，并处理"本环境起不了子进程"。
 *
 * 它一次做两件事，都是有意的：
 *  ① **退出码降级**：软档守卫失败时打印 `[warn-only] 软档守卫原退出码 = N`，本入口以 0 退出。
 *     判据一字未改 —— 跳过不得与通过同形（docs/README.md §写作纪律 6）。
 *  ② **起不了子进程时的显式 SKIP**：本仓有些自检（媒体桥）必须真起子进程，而受限环境里
 *     带管道的 spawn 是 EPERM（程序不能开命名管道）——**本机实测**：同一个二进制用
 *     `--provision` 下得下来（`fetch` 不受限），但起不来；普通终端里同一套参数全过。
 *     那是"跑命令的方式"，不是被测代码的缺陷 ⇒ 打 `SKIP` + 原因，不当断言失败。
 *
 * 为什么合并成一个入口：仓库已经够大，第一遍读代码的人不该为"分档"多认三个脚本。
 * 环境探测只在真的需要时花一次 spawn（`--probe-spawn`）。
 *
 * 用法（`package.json` 的 `verify:docs` / `verify` 里唯一需要写的一处）：
 *   node test/warn-only.mjs <脚本相对路径> [参数…]        软档：失败只警告
 *   node test/warn-only.mjs --probe-spawn <脚本> [参数…]  软档 + 先探"能否 spawn"，不能则 SKIP
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const PROBE = argv[0] === '--probe-spawn';
const [target, ...rest] = PROBE ? argv.slice(1) : argv;

if (!target) {
  console.error('用法：node test/warn-only.mjs [--probe-spawn] <脚本相对路径> [参数…]');
  process.exit(2);
}
const abs = join(ROOT, target);
if (!existsSync(abs)) {
  console.error('✗ 前置缺失：找不到 ' + target + ' —— 本入口只做降级与探测，不替你找脚本');
  process.exit(2);
}

if (PROBE) {
  // 与 `lib/media/supervisor.js` 同口径：带管道是协议通道，detached/plain 是它试的两种姿势。
  const blocked = [
    ['带管道（协议通道）', { stdio: ['pipe', 'pipe', 'pipe'] }],
    ['detached', { stdio: 'ignore', detached: true, windowsHide: true }],
    ['plain', { stdio: 'ignore', windowsHide: true }],
  ].filter(([, opts]) => {
    const r = spawnSync(process.execPath, ['-e', 'process.exit(0)'], opts);
    return !(r.error === undefined && r.status === 0);
  }).map(([name]) => name);
  if (blocked.length) {
    console.log('SKIP ' + target + ' —— 本环境起不了子进程（' + blocked.join(' / ') + '）。');
    console.log('     这不是"通过"：该自检在本环境**没有覆盖**（CI 与普通终端里照跑）。');
    process.exit(0);
  }
}

const r = spawnSync(process.execPath, [abs, ...rest], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, DSH_WARN_ONLY: '1' },
});
if (r.status === null) {
  // 守卫**根本没起来**（spawn 失败，或被信号结束）⇒ 没有"原退出码"这回事。把合成码 1 当
  // "原退出码"打印后 `exit 0` 与"守卫真的红了一次"同形：判据没跑，报告里却像跑过。
  // `verify:docs` 那几条软档**不带** `--probe-spawn`，所以这里是它们的兜底路径 —— 走与
  // `--probe-spawn` 分支同样的**具名 SKIP**，并明说"这不是通过"。
  console.log('SKIP ' + target + ' —— 本环境没能把该自检跑起来（spawn 失败'
    + (r.error ? '：' + (r.error.code || r.error.message) : '，或进程被信号结束')
    + (r.signal ? '，signal=' + r.signal : '') + '）。');
  console.log('     这不是"通过"：该自检在本环境**没有覆盖**（CI 与普通终端里照跑）。');
  process.exit(0);
}
if (r.status !== 0) {
  process.env.DSH_WARN_ONLY_EXIT = String(r.status);
  console.log('\n[warn-only] 软档守卫原退出码 = ' + r.status
    + ' —— 已降级为警告，不决定本次红绿（判据未改；要它重新拦下改动，就 `node ' + target + '` 直接跑）');
}
process.exit(0);
