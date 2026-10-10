/**
 * verify-guard-map.mjs —— 「守卫 ↔ 模块」映射**不许烂掉**（§4 期 1）。
 *
 * 回答的问题：**改了某个模块，该跑哪几条守卫？** 在此之前只能靠猜 —— 守卫的名字不总是它
 * 真正断言的东西（`verify-api-client` 在代码里碰了 14 个模块、`verify-i18n` 碰了 8 个）。
 *
 * 做法：映射**从守卫自己的代码派生**（`test/tools/guard-targets.mjs`），再把它与
 * `docs/GUARD-MAP.md`（生成物）**逐字节对账**。三条判据各自对应一种"烂法"：
 *
 *   ① **零覆盖**：磁盘上某个模块**没有任何守卫**在代码里碰它。唯一允许的例外写在
 *      `ZERO_COVERAGE_WHY` 里，**每条都要有人写下的理由**，且**只许缩小**（不空转断言）。
 *      这是"域从磁盘枚举"那条纪律（DEV-GUIDE §4.7 约定 4）在覆盖面上的形态：
 *      手工清单漏一行，那个文件就**静默脱离**判据。
 *   ② **生成物不新鲜**：`docs/GUARD-MAP.md` 与重算结果不一致（有人加了守卫/改了扫描面却没重算）。
 *   ③ **覆盖面地板**：模块数与守卫数非空（解析器静默返回空表时，①②都会变成空对空）。
 *
 * ⚠️ **为什么是软档**（`warn-only`，不挡 PR）：它守的是**仓库内务的形式**，
 * 说不出"用户会撞上什么" ⇒ 按 [`adr/0004`](../adr/0004-two-tier-guard-verification.md) 的判据放软档。
 * 但**允许变差是错的**：`ZERO_COVERAGE_WHY` 只许缩小。
 *
 * Usage:  node test/verify-guard-map.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMap, render, targetsOf, moduleSurface } from './tools/guard-targets.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAP_DOC = join(ROOT, 'docs', 'GUARD-MAP.md');

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log('  ✓ ' + name + (detail ? ' — ' + detail : ''));
  else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); failed++; }
};

/**
 * 允许"零守卫覆盖"的模块 —— **每条都要有理由**，且**只许缩小**。
 * 加一条 = 一次可见的改动（这才是这张表存在的意义）。
 *
 * ⚠️ 键**用 `join` 拼出来**（不写字面量路径）：本文件自己是守卫面的一员，
 * 而判据只统计**代码**里的路径 —— 写死字面量会让本文件被算成"管这些模块的守卫"，
 * 于是它们的零覆盖被自己的例外表**掩盖**掉（实测踩过：表一写完，零覆盖就报了 0 个）。
 */
const M = (...p) => p.join('/');
const ZERO_COVERAGE_WHY = {
  [M('lib', 'webwallgl', 'assets', 'modulepreload-polyfill-B5Qt9EMX.js')]: 'vendored 第三方副本（不许改；同步走 `test/tools/sync-webwallgl.mjs`）—— 只在 `lib/webwallgl/` 内被引用',
  [M('lib', 'webwallgl', 'assets', 'renderer-AJkjEL9i.js')]: '同上（WebWallGL 渲染页的构建产物）',
};

/**
 * 三类守卫的**口径**（别混）：
 *   · **直读模块**   —— 代码里碰了某个具体模块（字面量路径 / join / 唯一 basename）
 *   · **只隔产物**   —— 没碰具体模块，但读 `lib/client.js`（产物里含**全部**内联模块），
 *                       常见形态是"从产物切出 `src/x.js` 那段再求值" ⇒ 它**确实针对模块**，只是隔着产物
 *   · **无模块目标** —— 目标不是模块：仓库结构 / 依赖方向 / 产物同步 / 退役线 / 真浏览器路径 …
 *
 * 允许**第三类**的守卫 —— **可枚举 + 每条有理由**。
 */
const NO_MODULE_TARGET_WHY = {
  'verify-dead-declarations.mjs': '管的是**声明孤儿**（跨全部独立脚本面），不针对某个模块',
  'verify-route-families.mjs': '管的是**路由族触发线**（枚举口径经 `test/tools/host-route-index.mjs` 的 `buildIndex()` 重算）',
  'compat-harness-live.mjs': '真 harness 安装/启动探活（不读源文件）',
  'compat-harness-pages.mjs': '无头浏览器逐页 DOM 断言（不读源文件）',
  'compat-harness-surfaces.mjs': 'UI 面清单棘轮 + sidebar 源码活判据（读的是已安装的 harness 包）',
  'verify-retired-lines.mjs': '管的是**退役线的零残留**（`walk` lib/src/scripts/test 全树搜退役词），目标是"整棵树里不许出现这些词"，不是某个模块',
};

const map = buildMap(ROOT);
// 产物路径**拼出来**（同 §下文自检里那条理由）：本文件在守卫面上，写字面量路径会让
// 自己把自己算成"读产物的守卫"，于是下面 `NO_MODULE_TARGET_WHY` 的登记被自己推翻。
const ARTIFACT = ['lib', 'client.js'].join('/');

// ═══ ③ 覆盖面地板（先跑：它红了，下面的判据都在空转）═══════════════════════════
console.log('\n③ 覆盖面地板');
check('模块面非空（≥40 个：src/** + lib/**）', map.modules.length >= 40, map.modules.length + ' 个');
check('守卫面非空（≥20 个）', map.rows.length >= 20, map.rows.length + ' 个');
check('至少一个守卫隔着产物做断言（否则"隔着产物"这一列恒空）',
  map.rows.some((r) => r.viaBundle), map.rows.filter((r) => r.viaBundle).length + ' 个守卫读产物');

// ═══ ① 零覆盖 ════════════════════════════════════════════════════════════════
console.log('\n① 每个模块都要有守卫碰过它（例外表只许缩小、每条有理由）');
{
  const allowed = new Set(Object.keys(ZERO_COVERAGE_WHY));
  const unknown = map.uncovered.filter((m) => !allowed.has(m));
  check('没有"未登记的零覆盖"模块', unknown.length === 0,
    unknown.length ? '零覆盖且未登记：' + unknown.join(', ') : map.uncovered.length + ' 个零覆盖，全部已登记');
  const stale = [...allowed].filter((m) => !map.uncovered.includes(m));
  check('例外表不空转（登记了却已有守卫的，该删）', stale.length === 0,
    stale.length ? '该删：' + stale.join(', ') : allowed.size + ' 条都在用');
  const noReason = Object.entries(ZERO_COVERAGE_WHY).filter(([, w]) => !w || w.trim().length < 10).map(([m]) => m);
  check('例外表每条都有非空的理由', noReason.length === 0, noReason.join(', ') || Object.keys(ZERO_COVERAGE_WHY).length + ' 条都有');
  // 负对照：同一条判据对合成输入必须判出
  const probe = ['src/zzz-new-module.js'];
  check('negative control: 新模块没守卫时会被同一条判据判出',
    probe.filter((m) => !allowed.has(m)).length === 1);
  check('positive control: 已登记的例外不算未登记',
    [M('lib', 'webwallgl', 'assets', 'renderer-AJkjEL9i.js')].filter((m) => !allowed.has(m)).length === 0);
}

// ═══ ② 生成物新鲜 ════════════════════════════════════════════════════════════
console.log('\n② docs/GUARD-MAP.md 与重算结果一致（映射是生成物）');
{
  check('生成物在磁盘上', existsSync(MAP_DOC), MAP_DOC.replace(ROOT, '').replace(/\\/g, '/'));
  if (existsSync(MAP_DOC)) {
    const want = render(map);
    const got = readFileSync(MAP_DOC, 'utf8');
    const same = got.replace(/\r\n/g, '\n') === want.replace(/\r\n/g, '\n');
    check('逐字一致（不一致就 `node test/tools/guard-targets.mjs --write`）', same,
      same ? got.split('\n').length + ' 行' : '内容不同 ⇒ 有人改了守卫/扫描面却没重算');
  }
}

// ═══ ⑤ 每个守卫都要有目标（直读 / 只隔产物 / 登记成元守卫）══════════════════════
console.log('\n⑤ 每个守卫要么针对模块（直读或隔着产物），要么登记成元守卫');
{
  const allowedNoTarget = new Set(Object.keys(NO_MODULE_TARGET_WHY));
  const direct = (r) => r.targets.filter((t) => t !== ARTIFACT);
  // 第三类 = targets 为空（`lib/client.js` 本身也是一种"目标"：产物同步那类守卫针对的就是它）
  const noTarget = map.rows.filter((r) => r.targets.length === 0).map((r) => r.guard);
  const unknown = noTarget.filter((g) => !allowedNoTarget.has(g));
  const bundleOnly = map.rows.filter((r) => r.targets.length === 1 && r.targets[0] === ARTIFACT);
  check('没有"未登记的零目标守卫"', unknown.length === 0,
    unknown.length ? '零目标且未登记：' + unknown.join(', ')
      : `零目标 ${noTarget.length} 个全部已登记 · 只隔产物 ${bundleOnly.length} 个 · 直读模块 ${map.rows.filter((r) => direct(r).length > 0).length} 个`);
  const stale = [...allowedNoTarget].filter((g) => !noTarget.includes(g));
  check('元守卫表不空转（登记了却已有目标的，该删）', stale.length === 0,
    stale.length ? '该删：' + stale.join(', ') : allowedNoTarget.size + ' 条都在用');
  const noReason = Object.entries(NO_MODULE_TARGET_WHY).filter(([, w]) => !w || w.trim().length < 10).map(([g]) => g);
  check('元守卫表每条都有非空的理由', noReason.length === 0, noReason.join(', ') || Object.keys(NO_MODULE_TARGET_WHY).length + ' 条都有');
  check('negative control: 合成一个零目标的新守卫会被同一条判据判出',
    ['zzz-new-guard.mjs'].filter((g) => !allowedNoTarget.has(g)).length === 1);
  check('正判据：只隔产物的守卫**不算**零目标（产物里含全部内联模块）',
    bundleOnly.length > 0, '例：' + bundleOnly.slice(0, 3).map((r) => r.guard).join(' '));
}

// ═══ ④ 派生判据的自检（正负对照调同一条函数）════════════════════════════════════
console.log('\n⑥ 派生判据本身有牙（正负对照调同一条 targetsOf）');
{
  // ⚠️ 这些自检里的路径**用 `join` 拼**，不写字面量：本文件自己也在守卫面上，
  //    而 A 口径按路径边界匹配 —— 写死 `'src/x.js'` 会让本文件被算成"管了那个模块"，
  //    于是它的"零目标元守卫"登记被自己推翻（实测踩过两次：一次是注释里的模板，
  //    一次就是这里的自检字符串）。拼出来的字符串在**运行时**照样是那条路径。
  const P = (...p) => p.join('/');
  const mods = moduleSurface(ROOT);
  const pm = P('src', 'picker-model.js');
  check('字面量路径被认出', targetsOf(`const p = '${pm}';`, mods).includes(pm));
  check('join 目录拼接被认出（含嵌套）',
    targetsOf(`readFileSync(join(root, 'src', 'font', 'apply.js'), 'utf8');`, mods).includes(P('src/font/apply.js'))
    && targetsOf(`readFileSync(join(root, 'src', 'quick-panel.js'), 'utf8');`, mods).includes(P('src/quick-panel.js')));
  check('唯一 basename 被认出',
    targetsOf(`readFileSync(join(root,'src','nav-icon.js'),'utf8')`, mods).includes(P('src/nav-icon.js')));
  check('negative control: **注释里**提到模块不算"管它"（判据先剥注释）',
    targetsOf(`// 见 ${pm} 的说明\nconst a = 1;`, mods).length === 0);
  check('negative control: 不存在的文件不会被认成目标',
    targetsOf(`const p = '${P('src', 'no-such-module.js')}';`, mods).length === 0);
  check('negative control: 更长的路径不算（子串匹配会把它误判成"引用了那个模块"）',
    !targetsOf(`const p = '${P('assets', 'src', 'picker-model.js')}';`, mods).includes(pm));
}

console.log('');
if (failed) {
  console.log('GUARD MAP CHECKS FAILED — ' + failed + ' failed');
  process.exit(1);
}
console.log('ALL GUARD MAP CHECKS PASSED');
process.exit(0);
