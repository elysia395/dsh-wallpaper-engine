#!/usr/bin/env node
/**
 * run-guards.mjs —— 守卫链的**显式有序清单 + 执行器**（`package.json` 的四条 scripts 都指向它）。
 *
 * ## 为什么需要它
 *
 * 此前 `verify` / `verify:docs` / `smoke` 各自是 `package.json` 里的一行 `&&` 链：
 * `verify` 一行 1.6KB / 43 条 `node test/xxx.mjs && …`。那行有两个问题：
 *   ① **不可读**：一条守卫的档位（硬 / 软）、它的参数（`--probe-spawn` / `--allow-skip`）、
 *      它在链里的位置，全都要人肉在 `&&` 之间数。
 *   ② **不可判**：想断言"链里有没有漏掉某条守卫"，只能去正则抠那行字符串（`verify-package-files`
 *      的 P5 就是这么干的）。字符串一改，判据就静默缩水。
 * 清单落到本文件后，链的形状成为**机器可读的数据**：`--list-json` 直接输出有序步骤表。
 *
 * ## 清单即真源
 *
 * `MANIFEST` 是这条链的**唯一真源**，本文件**不读 `package.json`**（否则 runner 与
 * package.json 互为循环、等价证明无从谈起）。`package.json` 那一侧只留一行
 * `node test/run-guards.mjs [group]`，由 `test/verify-package-files.mjs` 的 P5 从
 * `--list-json` 取有序清单与档位。
 *
 * ## 逐条等价（对旧 `&&` 链）
 *
 * | 旧写法 | 本 runner |
 * |---|---|
 * | `node test/a.mjs && node test/b.mjs` | 硬档步骤**串行**执行；任一步非 0 ⇒ 立即以**同一个退出码**退出（`&&` 的短路语义） |
 * | `node test/warn-only.mjs test/soft.mjs` | 软档步骤 → `node test/warn-only.mjs <file> [args…]`，**逐字复用现入口**：退出码降级、`[warn-only] 软档守卫原退出码 = N`、具名 `SKIP` 全都不重写 |
 * | `node test/warn-only.mjs --probe-spawn test/x.mjs --allow-skip` | 软档 + `probeSpawn: true` ⇒ 原样带上 `--probe-spawn` |
 * | `npm run build`（`verify:all` 首步） | `npmStep` ⇒ `npm run build`，与旧串一字不差 |
 *
 * 子进程一律 `stdio: 'inherit'`，与 `&&` 链一样把守卫自己的 `✓` / `✗` / `PASS |` 明细
 * 直接接到父进程的终端上。
 *
 * ## 用法
 *
 *   node test/run-guards.mjs [verify|docs|smoke|all]   跑一组（缺省 verify）
 *   node test/run-guards.mjs [group] --list            打印该组的等价命令串（**不执行**）
 *   node test/run-guards.mjs [group] --list-json       打印该组的机器可读步骤表（**不执行**）
 *
 * `--list` 的口径与旧 `package.json` 字符串**逐字等价**：把同组每一步渲染成
 * `node <file> <args…>` / `npm run <step>`，再用 ` && ` 连起来 —— 于是"清单有没有漂"
 * 可以拿旧字符串做一次纯文本 diff（见交付报告里的等价证明）。
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HERE = 'test/run-guards.mjs';

/**
 * 一条步骤。
 *   `file`     —— 仓库根相对的守卫路径。
 *   `args`     —— 该守卫的参数（按旧链逐字抄）。
 *   `tier`     —— `'hard'`（挡 PR，失败即整组失败）/ `'soft'`（经 `warn-only` 降级，永不让组红）。
 *   `probe`    —— 软档专用：是否带 `--probe-spawn`（环境起不了子进程时点名 SKIP）。
 *   `kind`     —— 缺省 `'guard'`；`'npm'` 表示这一步是 npm 脚本（`verify:all` 的 `build`）。
 */
const step = (file, args = [], tier = 'hard', probe = false) => ({ file, args, tier, probe });
const npmStep = (script) => ({ file: null, npm: script, args: [], tier: 'hard', probe: false });

// ── 各组的步骤表。**顺序 = 执行顺序 = 旧 `&&` 链的顺序**，不得重排：
// `verify` 与 `smoke` 里有依赖前一步副作用的守卫（如 `verify-client-sync` 重建产物后
// `verify-client` 才读它），重排会改变结论。

/** `npm run verify` —— 硬档（挡 PR）。旧链 43 条，其中软档 1 条（媒体桥，探测式 SKIP）。 */
const VERIFY_STEPS = [
  step('test/verify-client-sync.mjs'),
  step('test/verify-client.mjs'),
  step('test/verify-windows-caption.mjs'),
  step('test/verify-transcode-state.mjs'),
  step('test/verify-playback-controls.mjs'),
  step('test/verify-scene.mjs'),
  step('test/verify-scene-live.mjs'),
  step('test/verify-scene-live-occlusion.mjs'),
  step('test/verify-scene-probe.mjs'),
  step('test/verify-occlusion-hub.mjs'),
  step('test/verify-occlusion-client.mjs'),
  step('test/verify-adapter.mjs'),
  step('test/verify-theme-follow.mjs'),
  step('test/verify-logging.mjs'),
  step('test/verify-media-bridge.mjs', ['--allow-skip'], 'soft', true),
  step('test/verify-media-probe.mjs'),
  step('test/verify-softrender.mjs'),
  step('test/verify-readability.mjs'),
  step('test/verify-glass-compositing.mjs'),
  step('test/verify-glass-surfaces.mjs'),
  step('test/verify-package-files.mjs'),
  step('test/verify-package-publish.mjs'),
  step('test/verify-contracts.mjs'),
  step('test/verify-body-caps.mjs'),
  step('test/verify-json-response.mjs'),
  step('test/verify-i18n.mjs'),
  step('test/verify-types.mjs'),
  step('test/verify-host-paint-scope.mjs'),
  step('test/verify-route-index.mjs'),
  step('test/verify-route-families.mjs'),
  step('test/verify-cache-dir.mjs'),
  step('test/verify-cache-prune.mjs'),
  step('test/verify-we-install-probe.mjs'),
  step('test/verify-wallpaper-scan.mjs'),
  step('test/verify-inventory-index.mjs'),
  step('test/verify-mp4-vfs.mjs'),
  step('test/verify-theme-layer.mjs'),
  step('test/verify-api-client.mjs'),
  step('test/verify-component-fonts.mjs'),
  step('test/verify-fontset.mjs'),
  step('test/verify-presets.mjs'),
  step('test/verify-system-fonts.mjs'),
  step('test/verify-picker-upload.mjs'),
  step('test/verify-picker-model.mjs'),
  step('test/verify-picker-props.mjs'),
  step('test/verify-about.mjs'),
  step('test/verify-token-contract.mjs'),
  step('test/verify-config-store.mjs'),
];

/** `npm run verify:docs` —— 软档（只出声）。全部经 warn-only 降级。 */
const DOCS_STEPS = [
  step('test/verify-module-layout.mjs', [], 'soft'),
  step('test/verify-reachability.mjs', [], 'soft'),
  step('test/verify-retired-lines.mjs', [], 'soft'),
  step('test/verify-dead-declarations.mjs', [], 'soft'),
  step('test/verify-guard-map.mjs', [], 'soft'),
  step('test/verify-guard-chain.mjs', [], 'soft'),
];

/** `npm run smoke` —— 节点级行为冒烟（硬档）。 */
const SMOKE_STEPS = [
  step('test/rotation-smoke.mjs'),
  step('test/rotation-live-smoke.mjs'),
  step('test/rotation-prepared-leak-smoke.mjs'),
  step('test/live-frame-backfill-smoke.mjs'),
  step('test/live-frame-async-identity-smoke.mjs'),
  step('test/fontset-load-smoke.mjs'),
];

/**
 * 四组的清单（**唯一真源**）。
 *
 * `verify:all` 是纯组合（旧串 = `npm run build && npm run verify && npm run verify:docs && npm run smoke`）：
 * 直接**引用同一批步骤对象**（不复制 —— 复制会让"改一处、漏一处"重新变成可能）。
 * `build` 留在 npm 侧（`package.json` 的 `build` 键是本步的真源，P5 的 build 地板仍从那里取），
 * 且**必须不经过** `verify` 组，否则跑 `all` 之外的组时会被意外触发产物重写。
 */
const MANIFEST = {
  verify: { chainKey: 'verify', steps: VERIFY_STEPS },
  docs: { chainKey: 'verify:docs', steps: DOCS_STEPS },
  smoke: { chainKey: 'smoke', steps: SMOKE_STEPS },
  all: { chainKey: 'verify:all', steps: [npmStep('build'), ...VERIFY_STEPS, ...DOCS_STEPS, ...SMOKE_STEPS] },
};

/** 把一条步骤渲染成旧链里的等价命令串（`--list` 用）。 */
function commandOf(s) {
  if (s.npm) return 'npm run ' + s.npm;
  const guard = ['node', s.file, ...s.args].join(' ');
  if (s.tier !== 'soft') return guard;
  return ['node', 'test/warn-only.mjs', ...(s.probe ? ['--probe-spawn'] : []), s.file, ...s.args].join(' ');
}

/** 组名 → 步骤数组。未知组返回 null（调用方负责报错与退出码 2）。 */
function stepsOf(group) {
  const entry = MANIFEST[group];
  return entry ? entry.steps : null;
}

/** 组名 → `package.json` 的脚本键（`chainKey`）。 */
function chainKeyOf(group) {
  const entry = MANIFEST[group];
  return entry ? entry.chainKey : null;
}

/** `--list-json` 的载荷：有序步骤表，P5 与外部判据据此取"链上到底跑哪些文件"。 */
function listJson(group) {
  return {
    group,
    chainKey: chainKeyOf(group),
    steps: stepsOf(group).map((s, i) => ({
      index: i + 1,
      kind: s.npm ? 'npm' : 'guard',
      npm: s.npm || null,
      file: s.file,
      args: s.args,
      tier: s.tier,
      probe: s.probe,
      command: commandOf(s),
    })),
  };
}

/** 执行一步：硬档直接起守卫，软档经 `warn-only.mjs` 起守卫。返回子进程 status（null = 没起来）。 */
function runStep(s) {
  // ⚠️ 软档必须传**仓库根相对路径**，不能传绝对路径：`test/warn-only.mjs` 自己按
  // `join(ROOT, target)` 解析目标（它的契约就是"收相对路径"），给绝对路径会被它拼成
  // `<ROOT>/<绝对路径>` ⇒ 前置缺失，全组以合成码 2 退出（实测踩过）。硬档那侧直接执行，
  // 传绝对路径无所谓。
  const argv = s.npm
    ? ['run', s.npm]
    : s.tier === 'soft'
      ? [join(ROOT, 'test', 'warn-only.mjs'), ...(s.probe ? ['--probe-spawn'] : []), s.file, ...s.args]
      : [join(ROOT, s.file), ...s.args];
  const exe = s.npm ? 'npm' : process.execPath;
  const r = spawnSync(exe, argv, { cwd: ROOT, stdio: 'inherit' });
  return r.status;
}

const USAGE = '用法：node ' + HERE + ' [verify|docs|smoke|all] [--list|--list-json]';
const GROUPS = Object.keys(MANIFEST);

const rawArgs = process.argv.slice(2);
const wantList = rawArgs.includes('--list');
const wantJson = rawArgs.includes('--list-json');
const positional = rawArgs.filter((a) => !a.startsWith('--'));
const unknownFlags = rawArgs.filter((a) => a.startsWith('--') && a !== '--list' && a !== '--list-json');

if (unknownFlags.length) {
  console.error('✗ 未知参数：' + unknownFlags.join(' ') + '\n' + USAGE);
  process.exit(2);
}
if (positional.length > 1) {
  console.error('✗ 只接受一个组名，收到：' + positional.join(' ') + '\n' + USAGE);
  process.exit(2);
}
const group = positional[0] || 'verify';
const steps = stepsOf(group);
if (!steps) {
  console.error('✗ 未知组：' + group + '（可选：' + GROUPS.join(' / ') + '）\n' + USAGE);
  process.exit(2);
}

// ── 只读模式：打印清单，不执行 ────────────────────────────────────────────────
if (wantJson) {
  console.log(JSON.stringify(listJson(group), null, 2));
  process.exit(0);
}
if (wantList) {
  for (const s of steps) console.log(commandOf(s));
  process.exit(0);
}

// ── 执行模式 ──────────────────────────────────────────────────────────────────
// 清单完整性先自检：清单漂成死路径时**当场**报出来，而不是等 npm 报一个难读的
// "Cannot find module"（这条与 P5 的"清单里每个 file 真实存在"同源，但本处是运行期兜底）。
const deadFiles = steps.filter((s) => s.file && !existsSync(join(ROOT, s.file)));
if (deadFiles.length) {
  console.error('✗ 清单里有 ' + deadFiles.length + ' 条指向不存在的文件（清单漂了）：');
  for (const s of deadFiles) console.error('    ' + s.file);
  process.exit(2);
}

console.log('▶ ' + group + ' —— ' + steps.length + ' 步（硬档 '
  + steps.filter((s) => s.tier !== 'soft').length + ' / 软档 '
  + steps.filter((s) => s.tier === 'soft').length + '）');

for (let i = 0; i < steps.length; i++) {
  const s = steps[i];
  console.log('\n── [' + (i + 1) + '/' + steps.length + '] ' + commandOf(s));
  const status = runStep(s);
  if (status === null) {
    // 与 `package.json` 的 `&&` 链同形：子进程起不来时 `&&` 链终止且 npm 以非 0 退出。
    console.error('✗ [' + (i + 1) + '/' + steps.length + '] 没能起来：' + commandOf(s));
    process.exit(1);
  }
  if (status !== 0 && s.tier !== 'soft') {
    // 短路语义：与 `&&` 一致 —— 后续步骤不再执行，退出码与原命令一致。
    console.error('✗ [' + (i + 1) + '/' + steps.length + '] 退出码 = ' + status + ' ⇒ 链在此短路');
    process.exit(status);
  }
  if (status !== 0) {
    console.log('⚠ [' + (i + 1) + '/' + steps.length + '] 软档守卫原退出码 = ' + status
      + '（已由 warn-only 降级，不决定本组红绿）');
  }
}

console.log('\n✓ ' + group + ' 全部 ' + steps.length + ' 步执行完毕');
process.exit(0);
