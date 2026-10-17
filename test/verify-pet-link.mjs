import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
// ── 本入口的覆盖面（为什么下面这 12 条、以及包内那 6 条为什么**不**在这里）────────────
// 这里只跑**零外部输入**的离线回归：宿主半边、无浏览器依赖的客户端半边、绳/吉祥物/
// 彩蛋的排播与几何。它们够纯，所以能进默认硬门禁。
//
// `packages/pet-link/test/` 下另有 6 个**驱动器式**夹具，它们的第一件事就是读取一个
// 外部输入（`process.argv[2]`），仓库里没有、也不该有那份输入（不许随包分发上游源码）：
//   verify-pet-asset-cache.mjs       ← dsh-pet@0.3.6 的 lib/client.js 源码
//   verify-pet-native-throw.mjs      ← 同上
//   verify-pet-phase-lifecycle.mjs   ← 同上
//   verify-pet-runtime-owner.mjs     ← 同上
//   verify-pet-control-regressions.mjs ← 同上（外加本包 src/ 三个文件）
//   verify-pet-install-transaction.mjs ← 默认 packages/pet-link/test/hotplug-upstream/package
//                                        （仓库内不存在 ⇒ 必须显式给出上游包目录）
// 用法（维护者本机、手跑）：
//   node packages/pet-link/test/verify-pet-asset-cache.mjs /path/to/dsh-pet/lib/client.js
//   node packages/pet-link/test/verify-pet-install-transaction.mjs /path/to/upstream/package
// 它们不进链是**有意的**：链上零下载、零外部文件是硬约束，把需要外部输入的夹具挂上来
// 只会让它恒跳过（比脱链更坏）。上游文件一旦变了，这几条必须手跑一遍。
const checks = [
  'verify-pet-package.mjs', 'verify-pet-hotplug-host.mjs', 'verify-pet-hotplug-client.mjs',
  'verify-pet-rope-entry.mjs', 'verify-pet-tuner.mjs', 'verify-pet-bubble-timing.mjs',
  'verify-pet-mascot-motion.mjs', 'verify-pet-egg1-motion.mjs', 'verify-pet-egg1-rebound.mjs',
  'verify-pet-sidebar-rebound.mjs', 'verify-pet-egg2-motion.mjs', 'verify-pet-follow.mjs',
];
for (const check of checks) {
  const result = spawnSync(process.execPath, ['test/' + check], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('PASS 可选桌宠联动完整定点回归');
