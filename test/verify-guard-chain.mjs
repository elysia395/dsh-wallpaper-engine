#!/usr/bin/env node
/**
 * verify-guard-chain.mjs —— 守卫链与**冻结 fixture** 的对账。
 *
 * 回答的问题：「链的形状有没有在没人注意的时候变过？」
 *
 *   · 真源是 `test/run-guards.mjs` 的 `MANIFEST`（经 `--list-json` 子进程读出）。
 *   · fixture 是 `test/fixtures/verify-chain.json` —— 链在**切链那一刻**的逐字快照。
 *
 * 为什么要有它（fixture 以外的判据都不够）：
 *   · P5（`verify-package-files.mjs`）钉的是"链上零裸包依赖 + 条数不低于地板"——它**允许**
 *     换掉一条守卫（只要新的也不裸包、条数不减）。
 *   · module-layout ④ 钉的是"相对说明符指向真实文件"——它**不关心**某个文件有没有在链上。
 *   · 于是"把 `verify-permissions.mjs` 从链里删掉"这种改动在现有判据下**全绿**，而它意味着
 *     一条硬档判据静默脱离了 PR 门禁。本守卫就是补这个缺口的：链的每一个成员、顺序、档位、
 *     参数都逐字冻结，变一个字符就红 —— 改链必须是**可见的动作**（改 fixture + 在提交说明里
 *     说清为什么）。
 *
 * 判据（正判据与负对照走 `test/tools/guard-chain.mjs` 里的同一个判据函数）：
 *   ① fixture 的四组与 runner 现读的四组逐条一致（`chainKey` / 步数 / 顺序 / 每步字段）；
 *   ② 每组硬档条数 ≥ 地板（防"清单削空 ⇒ 判据永真"）；
 *   ③ 清单里每个 `file` 真实存在（防清单漂成死路径）；
 *   ④ `all` 组**恰好**是 `build` + 其余三组的有序拼接（防组合组被悄悄改短）。
 *
 * 重冻结（**刻意做成显式动作**，不是自动跟随）：
 *
 *   node test/verify-guard-chain.mjs --write-fixture
 *
 * 加了/删了守卫、或调整了顺序 ⇒ 跑它，然后把 fixture 的改动与业务改动放在**同一次提交**里，
 * 提交说明写清"为什么链变了"。这就是本守卫的全部维护成本。
 *
 * Usage:  node test/verify-guard-chain.mjs [--write-fixture]
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ROOT, GROUPS, CHAIN_KEYS, TIER_FLOOR, readChain, normalize, chainDiff, floorDiff,
  compositionDiff, hardFiles, describe,
} from './tools/guard-chain.mjs';

const FIXTURE = join(ROOT, 'test', 'fixtures', 'verify-chain.json');

let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? '✓ ' : '✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!ok) failed++;
};

/**
 * 差异列表的打印口径：**封顶 5 条 + 计数**。
 * 链一漂就常常是几十条(一次重排会让后面每一步都错位)，全打出来会淹掉后面那些**独立**判据的
 * 结论 —— 而"哪一条错了"里第一条和步数差才是要读的。
 */
const showDiff = (list) => (list.length <= 5
  ? list.join(' | ')
  : list.slice(0, 5).join(' | ') + ' …（共 ' + list.length + ' 条差异，只列前 5 条）');

// ── 输入：runner 现读的四组 ─────────────────────────────────────────────────
const live = {};
let readError = null;
for (const g of GROUPS) {
  try { live[g] = normalize(readChain(g)); } catch (e) { readError = g + ': ' + e.message; }
}
check('覆盖面：四组都能从 runner 读出（`--list-json` 可用且是合法 JSON）', readError === null, readError || GROUPS.join(' / '));
if (readError) {
  console.log('\nGUARD CHAIN CHECKS FAILED — runner 读不出来，后面的判据无从谈起');
  process.exit(1);
}

// ── `--write-fixture`：重冻结（唯一会写盘的分支）────────────────────────────
if (process.argv.includes('--write-fixture')) {
  const frozen = {
    note: '守卫链（test/run-guards.mjs 的 MANIFEST）在切链那一刻的快照。改链 ⇒ 跑 '
      + '`node test/verify-guard-chain.mjs --write-fixture` 并把它与业务改动放在同一次提交里，提交说明写清为什么。',
    groups: Object.fromEntries(GROUPS.map((g) => [g, live[g]])),
  };
  writeFileSync(FIXTURE, JSON.stringify(frozen, null, 2) + '\n');
  console.log('✓ 已重冻结 ' + FIXTURE);
  for (const g of GROUPS) console.log('    ' + CHAIN_KEYS[g] + '：' + live[g].steps.length + ' 步（硬档 '
    + hardFiles(live[g]).length + '）');
  process.exit(0);
}

// ── 判据 ①：fixture × runner 逐条一致 ──────────────────────────────────────
check('fixture 存在（`test/fixtures/verify-chain.json`）', existsSync(FIXTURE), FIXTURE);
if (!existsSync(FIXTURE)) {
  console.log('\nGUARD CHAIN CHECKS FAILED — 缺 fixture（用 --write-fixture 生成）');
  process.exit(1);
}
const frozen = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const groups = frozen.groups || {};

const drift = [];
for (const g of GROUPS) for (const d of chainDiff(groups[g], live[g])) drift.push(CHAIN_KEYS[g] + ' ' + d);
check('链与 fixture 逐条一致（顺序 / 档位 / 参数 / 文件名）', drift.length === 0,
  drift.length ? showDiff(drift) + ' ⇒ 若这是有意的改动，跑 --write-fixture 并说明为什么'
    : GROUPS.length + ' 组全一致');

// ── 判据 ②：地板（防判据永真）─────────────────────────────────────────────
const floors = [];
for (const g of GROUPS) for (const d of floorDiff(g, live[g])) floors.push(d);
check('每组硬档条数不低于地板（防清单削空 ⇒ 判据永真）', floors.length === 0,
  floors.length ? floors.join(' | ') : GROUPS.map((g) => g + '=' + hardFiles(live[g]).length
    + '≥' + TIER_FLOOR[g]).join(' '));

// ── 判据 ③：清单里每个 file 真实存在 ────────────────────────────────────────
const dead = [];
for (const g of GROUPS) {
  for (const s of live[g].steps) {
    if (s.kind === 'guard' && !existsSync(join(ROOT, s.file))) dead.push(CHAIN_KEYS[g] + ' → ' + s.file);
  }
}
check('清单里每个 file 都真实存在（防清单漂成死路径）', dead.length === 0,
  dead.length ? dead.join(' | ') : '全部在位');

// ── 判据 ④：all = build + verify + docs + smoke ──────────────────────────
const comp = compositionDiff(live);
check('`all` = `build` + verify + docs + smoke（有序拼接）', comp.length === 0, comp.join(' | ') || '结构正确');

// ── 负对照 ────────────────────────────────────────────────────────────────
// 喂给**同一个**判据函数：一处改动必须被报出来，且报出来的那一条要指对位置。
{
  const perturbed = JSON.parse(JSON.stringify(groups));
  perturbed.verify.steps.splice(1, 1); // 删掉第 2 条守卫
  const d = chainDiff(perturbed.verify, live.verify);
  check('负对照：fixture 少一条守卫会被判出（且报出步数差）',
    d.length > 0 && d.some((x) => /步数/.test(x)), showDiff(d) || '（没报出来）');

  const reordered = JSON.parse(JSON.stringify(groups));
  [reordered.verify.steps[0], reordered.verify.steps[1]] = [reordered.verify.steps[1], reordered.verify.steps[0]];
  check('负对照：**顺序**换两条也会被判出（不只是"少了一条"才报）',
    chainDiff(reordered.verify, live.verify).length > 0);

  const retiered = JSON.parse(JSON.stringify(groups));
  retiered.verify.steps[0].tier = 'soft';
  check('负对照：档位被偷偷降级（hard→soft）会被判出',
    chainDiff(retiered.verify, live.verify).length > 0);

  const rearged = JSON.parse(JSON.stringify(groups));
  const softIdx = live.verify.steps.findIndex((s) => s.tier === 'soft' && s.args.length);
  if (softIdx >= 0) rearged.verify.steps[softIdx].args = [];
  check('负对照：软档的参数被抹掉会被判出',
    softIdx < 0 || chainDiff(rearged.verify, live.verify).length > 0,
    softIdx < 0 ? '（本链没有带参数的软档步骤，本对照不适用）' : '');
}

// 地板负对照：把某组的硬档全降级 ⇒ 必须判低于地板
{
  const gutted = { chainKey: 'smoke', steps: live.smoke.steps.map((s) => ({ ...s, tier: 'soft' })) };
  check('负对照：把一组的硬档全降到软档 ⇒ 地板判据必须报红', floorDiff('smoke', gutted).length > 0);
  check('负对照：地板判据对达标的输入放行（不是恒真）', floorDiff('smoke', live.smoke).length === 0);
}

// 组合负对照：把 all 的尾段砍掉一段 ⇒ 必须判出
{
  const cut = JSON.parse(JSON.stringify(live));
  cut.all.steps = cut.all.steps.slice(0, 5);
  check('负对照：`all` 的尾段被砍短会被判出', compositionDiff(cut).length > 0);
}

// 死路径负对照：合成一条不存在的条目 ⇒ 必须被同一套 existsSync 判出
{
  const ghost = { kind: 'guard', npm: null, file: 'test/verify-no-such-guard.mjs', args: [], tier: 'hard', probe: false };
  check('负对照：合成一条不存在的 file 会被判出',
    !existsSync(join(ROOT, ghost.file)) && describe(ghost).includes('verify-no-such-guard'));
}

console.log('');
if (failed) {
  console.log('GUARD CHAIN CHECKS FAILED — ' + failed + ' failed');
  process.exit(1);
}
console.log('ALL GUARD CHAIN CHECKS PASSED');
process.exit(0);
