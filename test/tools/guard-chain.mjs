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
 * 口径：`verify` / `smoke` 是**硬档组**，地板与 P5 一致（24 / 5）；`docs` 整组是软档
 * ⇒ 地板 **0**（对它设 1 会把"整组软档"这个**设计**判成违规）；`all` 的地板是前两者之和
 * （`build` 那一步是 npm 步骤，不落 `file`，不计）。
 */
export const TIER_FLOOR = { verify: 24, docs: 0, smoke: 5, all: 29 };

/** 读某一组的 `--list-json`。runner 起不来 / 输出不是 JSON ⇒ 抛（调用方转成判据失败）。 */
export function readChain(group) {
  const out = execFileSync(process.execPath, [join(ROOT, 'test', 'run-guards.mjs'), group, '--list-json'], {
    cwd: ROOT, encoding: 'utf8',
  });
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
