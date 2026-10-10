#!/usr/bin/env node
/**
 * verify-route-families.mjs — 账本 §7 触发条件 6 的**读代码监视器**。
 *
 * ── 它为什么存在（这条判据的来历）────────────────────────────────────────────
 * 财务 §7-6 的触发线是「宿主某个路由族长到 ≥3 条 ⇒ 按族单独拆」。
 * 这条线原先是**机器看守**的：挂在 `test/verify-ledger.mjs` 的 `P2-11` 证据①上，某族长到
 * 3 条那一行当场变红 ⇒ 逼人回来裁决「拆族 或 改这条线」。
 * 后来 `verify-ledger.mjs` 随 [ADR-0006](docs/adr/0006-comment-discipline-as-written-convention.md)
 * **整体下线**，其代价一节自己写明：**「这个监视器现在失效」**。
 * 于是本仓出现了一个**真实覆盖损失**：触发线还在文档里，却没有任何东西看着它 ——
 * 路由可以一路长到 3 条、4 条而无人被提醒。
 *
 * ADR-0006 同时给了恢复它的**正确做法**：把判据搬进**读代码**的守卫（而不是把账本守卫装回来）。
 * 本文件就是那一步。
 *
 * ── 它红的时候该做什么（这不是"代码有 bug"）──────────────────────────────────
 * 本判据变红**不代表实现有缺陷**，它代表**触发线被越过了**，必须做一次裁决：
 *   ① **拆族**（首选）：把该族按账本 §3.5 的固定动作搬成 `lib/routes/<族>.js`
 *      （新建模块 + 导出 `register<族>Routes` + `apply` 里改成一次调用 + 共享可变状态
 *      **只以引用进 `c`** + 改完重生成 `docs/ROUTE-INDEX.md` + 该族的守卫必须先存在）；
 *      或
 *   ② **改这条线**：如果实测认为"族到 3 条"已不该触发拆分，就在账本 §7-6 里改线**并同改本文件**
 *      —— 判据与文档必须同时动，否则下一个读者会按文档而不是按代码行事。
 *   ③ 两者都不做、只想让它变绿 ⇒ **本判据不接受**（没有"忽略"通道）。
 *
 * ── 口径 ───────────────────────────────────────────────────────────────────
 * 枚举**只认** `test/tools/host-route-index.mjs` 的 `buildIndex()`（路由枚举的单一真源：
 * 它会展开循环注册、并把搬进 `lib/routes/*.js` 的族按调用点放回原位）。
 * 归族规则与 `analyze-host-apply.mjs` 的 ② 组**逐字相同**：取路径的第一个非空段
 * （`/a/b` 与 `/a` 同族；`(动态路径)` 归 `(动态)`）。
 *
 * Usage:  node test/verify-route-families.mjs
 */

import { buildIndex } from './tools/host-route-index.mjs';

/** 触发线：同一族达到这么多条 ⇒ 必须裁决（见文件头）。 */
const FAMILY_TRIGGER = 3;
/** 覆盖面地板：路由条数少于它说明枚举退化了（而不是"族很干净"）。 */
const ROUTE_FLOOR = 30;
/** 归族：与 `analyze-host-apply.mjs` 的 ② 组逐字相同的规则。 */
const familyOf = (path) => (path === '(动态路径)' ? '(动态)' : (path.split('/').filter(Boolean)[0] || '/'));

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log('  ✓ ' + name + (detail ? ' — ' + detail : ''));
  else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); failed++; }
};

/** 归族 + 计数。合成输入与真实输入走**同一个**函数（负对照因此证明的是同一条判据）。 */
function groupFamilies(routes) {
  const fam = new Map();
  for (const r of routes) {
    const seg = familyOf(r.path);
    if (!fam.has(seg)) fam.set(seg, []);
    fam.get(seg).push(r.path);
  }
  return [...fam.entries()].sort((a, b) => b[1].length - a[1].length);
}

// ── ① 判据自身的正/负对照（先证明它有牙）────────────────────────────────────
{
  const synthetic = [
    { path: '/alpha' }, { path: '/alpha/beta' }, { path: '/alpha/gamma' }, // 同族 3 条
    { path: '/delta' },
  ];
  const g = groupFamilies(synthetic);
  check('负对照：同一族 3 条会被判到（判据有牙）', g[0][0] === 'alpha' && g[0][1].length === FAMILY_TRIGGER,
    `max=${g[0][1].length}`);
  check('正对照：每族都 <3 时不会被判到',
    groupFamilies([{ path: '/a' }, { path: '/b/x' }, { path: '/b/y' }])[0][1].length === 2);
  check('负对照：归族只取首段（`/a/b` 与 `/a` 同族）',
    familyOf('/a/b') === 'a' && familyOf('/a') === 'a');
}

// ── ② 真实代码：枚举口径 = 路由索引（单一真源）──────────────────────────────
let routes = [];
try {
  routes = buildIndex().routes;
} catch (err) {
  check('路由枚举可用（buildIndex() 未抛）', false, String((err && err.message) || err));
}
// 覆盖面地板必须在分支**外面**：枚举静默退化成空表时（`buildIndex()` 不抛错 ——
// 见 test/tools/host-route-index.mjs:173 `if (!existsSync(dir)) return [];`），
// 下面整块会被跳过，届时只有这条能红；否则"没有大族，通过"会盖掉"枚举没了"。
check('覆盖面：路由枚举非空（buildIndex() 返回了路由表，而非静默空表）', routes.length > 0,
  `实测 ${routes.length} 条`);
if (routes.length) {
  const families = groupFamilies(routes);
  const maxSize = families[0][1].length;
  const over = families.filter(([, v]) => v.length >= FAMILY_TRIGGER);

  console.log(`\n  路由 ${routes.length} 条 / ${families.length} 族（口径 = host-route-index 的 buildIndex）`);
  console.log('  最大的几族：');
  for (const [k, v] of families.slice(0, 6)) console.log(`    ${String(v.length).padStart(2)}  ${k}   ${v.join(' ')}`);
  console.log('');

  // 覆盖面地板：枚举静默退化 ⇒ 当场红，而不是"没有大族，通过"。
  check(`覆盖面：路由条数 ≥ ${ROUTE_FLOOR}（枚举退化即失败）`, routes.length >= ROUTE_FLOOR,
    `实测 ${routes.length}`);
  check('覆盖面：族数 ≥ 20（归族规则未退化成"一族装全部"）', families.length >= 20,
    `实测 ${families.length}`);
  check('负对照：同一条判据对合成输入能判出越线族',
    groupFamilies([...routes, { path: '/probe' }, { path: '/probe/x' }, { path: '/probe/y' }])
      .some(([k, v]) => v.length >= FAMILY_TRIGGER));

  // ── 触发线本体 ────────────────────────────────────────────────────────────
  check(`触发条件 6：没有任何族达到 ${FAMILY_TRIGGER} 条`, over.length === 0,
    over.length ? over.map(([k, v]) => `${k}(${v.length})`).join(' · ') : `最大族 ${maxSize} 条`);
}

console.log('');
if (failed) {
  console.log(`ROUTE-FAMILY TRIGGER FIRED — ${failed} 条不合格`);
  console.log('这不是代码缺陷，是**触发线被越过**：请做一次裁决 ——');
  console.log('  ① 拆族（推荐）：见 lib/routes/ 现有 8 个族模块的形态 + 账本 §3.5 的固定动作；');
  console.log('  ② 或改账本 §7-6 的线，并**同改本文件**的 FAMILY_TRIGGER（判据与文档必须同时动）。');
  console.log('不做裁决而想让它变绿是不接受的：本判据没有忽略通道。');
  process.exit(1);
}
console.log('ROUTE-FAMILY TRIGGER NOT FIRED (below the line)');
console.log('提示：本判据红 = 该回来裁决了，不是代码坏了；处置方式见文件头。');
