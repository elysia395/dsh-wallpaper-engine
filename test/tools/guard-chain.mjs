/**
 * guard-chain.mjs —— 守卫链（`test/run-guards.mjs`）与**冻结 fixture** 的对账。
 *
 * 为什么放在 `test/tools/`：判据本身要有正/负对照，对照必须喂给**同一个判据函数**。
 * 纯函数住这里、`test/verify-guard-chain.mjs` 只做"从磁盘取值 → 调它 → 打印红绿"，
 * 于是正判据与负对照走的是同一段代码（DEV-GUIDE §4.7 约定 5）。
 *
 * 真源是 `test/run-guards.mjs --list-json`（**子进程读**，不 import —— 隔着一层进程边界，
 * "runner 起不来 / JSON 坏了"会在这里显形，而不是变成一条静默通过的判据）。
 */

import { execFileSync } from 'node:child_process';
import { openSync, closeSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 链上的组（顺序固定，与 runner 的 `MANIFEST` 键一致）。 */
export const GROUPS = ['verify', 'docs', 'smoke', 'all'];

/** 各组在 fixture 里的**名称**（`package.json` 的脚本键就是别名，读的人不必回查）。 */
export const CHAIN_KEYS = { verify: 'verify', docs: 'verify:docs', smoke: 'smoke', all: 'verify:all' };

/**
 * 地板：硬档步骤数的下界。**这是防"把清单削空 ⇒ 判据永真"的那一条**，
 * 与 `test/verify-package-files.mjs` 的 P5 同源（那边也按同一组数字设地板）。
 * 只数 `tier === 'hard'`；软档不计（软档改档位不该触发地板变化）。
 *
 * 口径：`docs` 整组是软档 ⇒ 地板 **0**（对它设 1 会把"整组软档"这个**设计**判成违规）；
 * `all` 的地板是前两者之和（`build` 那一步是 npm 步骤，不落 `file`，不计）。
 *
 * **取值 = 实测**（2026-10-17 复算：84 / 0 / 6 / 90，与 `test/verify-package-files.mjs`
 * 的 P5 实测同源）。地板只该在**链有意变短**时下调，且必须与
 * `test/fixtures/verify-chain.json` 在同一次改动里更新 —— 否则就是"把清单削空"。
 * 旧的宽口径（24 / 5 / 29）等于给"悄悄砍掉 60 条硬档"留了通道。
 */
export const TIER_FLOOR = { verify: 84, docs: 0, smoke: 6, all: 90 };

/** 读某一组的 `--list-json`。runner 起不来 / 输出不是 JSON ⇒ 抛（调用方转成判据失败）。 */
export function readChain(group) {
  // ⚠️ 子进程的 stdout **落到文件**再读，不用管道捕获：某些沙箱（本会话实测）禁止子进程管道
  // （`execFileSync` 默认 pipe ⇒ EPERM），那样本判据会因环境限制而**读不出链**，而不是链真的坏了。
  // 换成文件传输后行为完全不变（拿到的仍是 `--list-json` 的逐字输出），判据在沙箱内外都能真跑。
  const tmp = join(ROOT, '.test-cache', 'guard-chain-out-' + process.pid + '-' + Date.now() + '.json');
  const fd = openSync(tmp, 'w');
  try {
    execFileSync(process.execPath, [join(ROOT, 'test', 'run-guards.mjs'), group, '--list-json'], {
      cwd: ROOT, stdio: ['ignore', fd, 'inherit'],
    });
  } finally {
    closeSync(fd);
  }
  const out = readFileSync(tmp, 'utf8');
  try { rmSync(tmp, { force: true }); } catch { /* 清理失败不影响判据 */ }
  return JSON.parse(out);
}

/** 把 runner 的输出折成**可比形状**：只留判据关心的字段，去掉只为打印存在的 `command`。 */
export function normalize(chain) {
  return {
    chainKey: chain.chainKey,
    steps: chain.steps.map((s) => ({
      kind: s.kind, npm: s.npm, file: s.file, args: s.args, tier: s.tier, probe: s.probe,
    })),
  };
}

/**
 * 判据：把 fixture 的某组与 runner 现读的某组逐条比。返回**差异描述数组**（空 = 一致）。
 * 正判据（真实 fixture × 真实 runner）与负对照（扰动 fixture）共用它。
 */
export function chainDiff(frozen, live) {
  const out = [];
  if (!frozen || typeof frozen !== 'object') return ['fixture 缺这一组（或不是对象）'];
  if (frozen.chainKey !== live.chainKey) out.push(`chainKey: fixture=${frozen.chainKey} runner=${live.chainKey}`);
  const a = frozen.steps || [];
  const b = live.steps || [];
  if (a.length !== b.length) out.push(`步数: fixture=${a.length} runner=${b.length}`);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (!x) { out.push(`[${i + 1}] runner 多出一步：${describe(y)}`); continue; }
    if (!y) { out.push(`[${i + 1}] fixture 多出一步：${describe(x)}`); continue; }
    const fx = JSON.stringify({ kind: x.kind, npm: x.npm, file: x.file, args: x.args, tier: x.tier, probe: x.probe });
    const fy = JSON.stringify(y);
    if (fx !== fy) out.push(`[${i + 1}] 不一致：fixture=${fx} runner=${fy}`);
  }
  return out;
}

/** 一条步骤的人读描述（失败文案用）。 */
export function describe(s) {
  if (!s) return '（无）';
  const head = s.kind === 'npm' ? 'npm run ' + s.npm : s.file + (s.args && s.args.length ? ' ' + s.args.join(' ') : '');
  return head + ' [' + s.tier + (s.probe ? ',probe' : '') + ']';
}

/** 某一组里硬档步骤的 `file` 列表（地板计数与"每个 file 真实存在"都用它）。 */
export function hardFiles(chain) {
  return chain.steps.filter((s) => s.tier === 'hard' && s.kind === 'guard').map((s) => s.file);
}

/** 判据：硬档条数是否达地板。返回差异描述数组（空 = 达标）。 */
export function floorDiff(group, chain) {
  const n = hardFiles(chain).length;
  const floor = TIER_FLOOR[group];
  return n >= floor ? [] : [`${group} 硬档 ${n} 条 < 地板 ${floor} 条（清单被削空就会让判据永真）`];
}

/**
 * 判据：`all` 必须**恰好**是 `build` + 其余三组的有序拼接。
 * 防"组合组被悄悄改短"——组合是结构的一部分，不是可以各写一份的清单。
 */
export function compositionDiff(chains) {
  const out = [];
  if (!chains.all) return ['缺 all 组'];
  const head = chains.all.steps[0];
  if (!head || head.kind !== 'npm' || head.npm !== 'build') out.push('all 组首步必须是 npm run build');
  const tail = chains.all.steps.slice(1);
  const want = [...(chains.verify.steps || []), ...(chains.docs.steps || []), ...(chains.smoke.steps || [])];
  if (tail.length !== want.length) out.push(`all 的尾段 ${tail.length} 步 ≠ 三组之和 ${want.length} 步`);
  for (let i = 0; i < Math.max(tail.length, want.length); i++) {
    const x = JSON.stringify(tail[i] || null);
    const y = JSON.stringify(want[i] || null);
    if (x !== y) { out.push(`all 尾段第 ${i + 1} 步不一致：all=${x} want=${y}`); break; }
  }
  return out;
}

/**
 * 脱链豁免的**代码内真源**（R-5）。
 *
 * 为什么必须有它：链会**短路**，没挂链的判据永远不会在 PR 门禁上跑；而"没跑"与"跑绿"在报告里
 * 长得一模一样 ⇒ 一条新写的强判据可以静默脱链，没人会注意到。原先这些理由只写在文档里，
 * 代码里没有 ⇒ 判据无从检查。现在：守卫面（`test/tools/guard-targets.mjs` 的 `guardSurface()`：
 * `verify-*` / `*-smoke` / `e2e-*` / `compat-*`）上每个文件要么在链上，要么在这里有一条**非空**理由；
 * 反之这里的每一条都必须**确实存在且确实脱链**（过期豁免同样判红 —— 否则它会给未来的回归打掩护）。
 *
 * 判据见 `test/verify-guard-chain.mjs` ⑤（正判据与负对照走 `offChainDiff` 同一个函数）。
 */
export const OFF_CHAIN_WHY = {
  'verify-pet-link.mjs': '快捷汇总入口 npm run verify:pet-link；其十二个离线用例已逐项接入默认 verify 链，不重复运行汇总器。',
  'verify-pet-hotplug-integration.mjs': '显式安装集成入口，需要受支持原版桌宠夹具与真实 Cordis 模块；不得在离线 verify 链隐式下载或修改用户安装。',
  'verify-pet-hotplug-browser.mjs': '完整 React 与真实视频集成，需要独立 Edge、ReactDOM 和已准备隔离 profile，使用 verify:pet-link:browser 显式运行。',
  'verify-pet-egg2-browser-case.mjs': '完整浏览器入口导入的彩蛋二用例模块，依赖其 CDP 会话与真实视频，不是独立命令。',
  'verify-pet-egg1-native-browser.mjs': '真实原生抛掷与媒体验收，需要独立 Edge 和显式 PET_TEST_CLIENT 隔离客户端。',
  'verify-pet-phase-browser.mjs': '真实阶段接管验收，需要独立 Edge 和显式 PET_TEST_CLIENT 隔离客户端。',
  'verify-pet-tuner-browser.mjs': '真实面板几何和动效验收，需要独立 Edge；默认链保留无外部依赖的面板 DOM 回归。',
  'compat-harness-live.mjs': '真跑**活** harness 页面（需要宿主实际启动）：本地/CI 都按需手动跑，由 .github/workflows/harness-compat.yml 单独触发；verify 链要求零外部环境依赖。',
  'compat-harness-pages.mjs': '同族：活 harness 的页面面普查，断言依赖真实宿主实例，不进链。',
  'compat-harness-surfaces.mjs': '同族：活 harness 的界面面普查，断言依赖真实宿主实例，不进链。',
  'e2e-web-media-origin.mjs': '端到端媒体源判据（`npm run verify:e2e` 的手动入口）：要真宿主 + 真渲染路径，本地按需跑。',
  'verify-bridge-ci.mjs': '`npm run verify:bridge` 的**判词入口**（要下载产物并真跑中间件）⇒ 独立 CI 步骤，不进 verify 链（链上零下载、零外部进程）。',
  'verify-bundle-rows.mjs': '有意脱链：链尾有一条**真 cordis 往返**（按路径拼接动态 `import` 宿主 peer 包 `@deepseek-ai/cordis`，见本文件 `cordisPath` / `pathToFileURL` 那处），而 CI 是 `npm ci --omit=peer` ⇒ 挂链只会让它永久"出声 SKIP"（P5 的字面量扫描看不到路径拼接的说明符，所以挂链并不会被 P5 判红 —— 但"链上恒跳过"比脱链更坏）；故留在链外 + 每次改行/包必须手跑一次（BUNDLE-SPLIT §10.1 #2）。',
  'verify-static.mjs': '静态棘轮入口（ESLint / tsc 都是 devDependencies）⇒ CI 独立步骤 `npm run verify:static`；链上零裸依赖容不下它。',
};

/** 守卫面地板（防"面变空 ⇒ 脱链判据永真"）。实测 2026-10-17 = 109（链上 95 · 豁免 14）。 */
export const OFF_CHAIN_FLOOR = 109;

/**
 * 判据：守卫面上每个文件「要么在链上、要么有非空脱链理由」，且豁免表里没有过期/悬空条目。
 * `surface` = basename 数组（`guardSurface()` 的输出）；`chained` = 链上 `file` 列表（带 `test/` 前缀）。
 * 返回差异描述数组（空 = 一致）。正判据与负对照共用它。
 */
export function offChainDiff(surface, chained, whyTable = OFF_CHAIN_WHY) {
  const out = [];
  const onChain = new Set(chained);
  for (const name of surface) {
    if (onChain.has('test/' + name)) continue;
    if (!Object.prototype.hasOwnProperty.call(whyTable, name)) {
      out.push(`脱链且没有 OFF_CHAIN_WHY：test/${name}`);
    } else if (!String(whyTable[name] || '').trim()) {
      out.push(`OFF_CHAIN_WHY 是空的（空串等于没写）：test/${name}`);
    }
  }
  for (const name of Object.keys(whyTable)) {
    if (!surface.includes(name)) out.push(`OFF_CHAIN_WHY 指向不在守卫面（或已不存在）的文件：test/${name}`);
    else if (onChain.has('test/' + name)) out.push(`OFF_CHAIN_WHY 已过期（它现在在链上）：test/${name}`);
  }
  return out;
}
