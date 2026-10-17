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
import { buildMap, render, targetsOf, moduleSurface, familyHelpers } from './tools/guard-targets.mjs';
// 真源定位工具**自身的**正/负对照（`--selftest` 的那 11 条）也挂到守卫链上：否则
// "多处声明 ⇒ 红 / 零处声明 ⇒ 红 / 生成物副本不算真源"这些最关键的牙齿只在人手跑 CLI 时才被验证。
import { selftest as locatorSelftest } from './tools/source-locator.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAP_DOC = join(ROOT, 'docs', 'GUARD-MAP.md');
/**
 * 例外表"理由"的地板长度。**不是**内容判据（机器判不了理由好不好），只判"有没有人真的写字"：
 * 空串 / 一个词（`同上`）不算理由。数字本身是**形状不变量**（表格每条都必须是一句人话），
 * 不是会随实现漂的快照 ⇒ 留在这里，并只有一处。
 */
const MIN_REASON_CHARS = 10;

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log('  ✓ ' + name + (detail ? ' — ' + detail : ''));
  else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); failed++; }
};

// ── 两张例外表的判据本体（正判据与负对照调**同一份**函数）──────────────────────────
// ⚠️ 本会话踩过的坑：这两条的负对照原先写成 `['zzz-new-module.js'].filter(m => !allowed.has(m)).length === 1`
//    —— 那句话**重写了一遍判据**（而不是调判据），于是它恒真、恒绿（假红/假绿）。判据一改
//    （比如换了走查方式），负对照不会跟着红，"有牙"就成了摆设。现在两张表各有三个小函数，
//    生产与负对照都只经过它们。

/** ① 零覆盖里**没有登记理由**的那些（非空 = 有新模块静默脱离判据）。 */
const uncoveredUnregistered = (uncovered, allowed) => uncovered.filter((m) => !new Set(allowed).has(m));
/** ① 登记了却**已经有守卫碰过**的（非空 = 例外表在静默长大，该删）。 */
const staleExceptions = (registered, covered) => {
  const set = new Set(covered);
  return [...new Set(registered)].filter((m) => !set.has(m));
};
/** 两张表共用的"理由有没有真的写"判据。 */
const thinReasons = (table) => Object.entries(table)
  .filter(([, why]) => !why || why.trim().length < MIN_REASON_CHARS).map(([key]) => key);

/** ⑤ 零目标守卫里**没有登记**的那些。 */
const noTargetUnregistered = (noTarget, allowed) => noTarget.filter((g) => !new Set(allowed).has(g));
/** ⑤ 登记成元守卫、却已经有模块目标了的（该删）。 */
const staleMetaGuards = (registered, noTarget) => {
  const set = new Set(noTarget);
  return [...new Set(registered)].filter((g) => !set.has(g));
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
  // ── P2 拆包：行为级覆盖（本工具只认"直读 / 隔产物"两列，行为级覆盖按口径算零覆盖）──
  [M('packages', 'mascot-avatar', 'lib', 'index.js')]: '组件行入口（P2 拆包，P-F 出户）：实现归属由 verify-route-ownership 的"行→入口"对账覆盖（按目录集合派生，非直读本文件）',
  // ⚠️ P-F 出户后 `packages/about-notice/lib/index.js` **不需要**登记：verify-about 直读它
  //    （注册点形态判据的读取面），所以它在"直读"那一列是有守卫的 —— 登记了反而会被判"例外表空转"。
  //    （实测踩过一次：先按旧路径登记，再修 verify-about 的路径 ⇒ stale。）
  // ── P-A 拆包：行为级覆盖（同上口径；这些文件由按包目录/按 patch 行**动态派生**的守卫覆盖）──
  [M('packages', 'fx', 'lib', 'index.js')]: '子包宿主入口（P-A 拆包）：只做 subpackageKeys 校验 + handOffTeardown，实现归属与逐行装载由 verify-subpackage-boot（按 packages/* 目录与 patch 行双向对账）与 verify-subpackage-toggle-roundtrip（逐行装载 · 关→开→再关 · 零残留）覆盖，本工具只认字面量路径 ⇒ 按口径算零覆盖',
  [M('packages', 'parallax', 'lib', 'index.js')]: '同上（3D 子包宿主入口，P-A 拆包）：覆盖来源与 fx 逐条相同 —— verify-subpackage-boot 的双射对账 + verify-subpackage-toggle-roundtrip 的逐行装载与拆卸',
  [M('packages', 'fx', 'src', 'client.js')]: '子包浏览器半边入口（P-A 拆包）：注入键契约由 verify-subpackage-client-half 隔产物断言，宿主键集与包间纯度由 verify-subpackage-purity 动态扫 packages/*/src 覆盖，产物侧由 verify-scene-live / verify-client 在同一 vm 里真求值，本工具只认字面量路径 ⇒ 按口径算零覆盖',
  [M('packages', 'parallax', 'src', 'client.js')]: '同上（3D 子包浏览器半边入口，P-A 拆包）：覆盖来源与 fx 逐条相同 —— verify-subpackage-client-half 的隔产物断言 + verify-subpackage-purity 的动态扫面 + verify-scene-live / verify-client 的真求值',
  // ── PR #5（可选桌宠联动）：2026-10-15 收口成一般形态（自出浏览器半边产物）──
  //    词条表 `src/i18n-copy-pet-link.js` 已按 fonts 惯例归主包 src/（verify-i18n 的整族词表对账覆盖它）
  //    ⇒ 旧的那条例外登记随之删除（登记了反而会被判"例外表空转"）。
  [M('packages', 'pet-link', 'src', 'client.js')]: '桌宠联动浏览器半边入口（收口成一般形态后自出 packages/pet-link/lib/client.pet-link.js）：注入键契约由 verify-subpackage-client-half 隔产物断言（dsh.client / exports["./client"] / 产物 id / 构建期 require 主包），宿主键集与包间纯度由 verify-subpackage-purity 动态扫 packages/*/src 覆盖，行为面由 test/verify-pet-*.mjs 那组离线回归与 verify-scene-live 的真求值覆盖，本工具只认字面量路径 ⇒ 按口径算零覆盖',
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
  'verify-guard-chain.mjs': '管的是**守卫链的形状**（`test/run-guards.mjs` 的 `MANIFEST` 与冻结 fixture 对账：成员/顺序/档位/参数/地板），读的是链自己的清单，不读任何模块',
  'verify-ci-steps.mjs': '管的是 **CI 步骤表自身**（`.github/workflows/verify.yml` 的步骤序列 / `npm run` 脚本是否存在 / `continue-on-error` 档位 / bash 与 install 步位置），读的是工作流文本与 package.json，不读任何模块',
  'verify-static.mjs': '管的是**静态门禁的棘轮**（ESLint / tsc 的**按规则计数**基线），读的是 `test/fixtures/static-baseline.json` 与 package.json 里的两个脚本名，不读源模块',
  // P-F 批 1c：`verify-route-ownership.mjs` 现在**直读**各包的 `lib/index.js` 与实现文件（双形态落点解析），
  // 不再是"零模块目标"的元守卫 ⇒ 原例外条目已被元守卫表判为"登记了却已有目标，该删"。
  'verify-bridge-ci.mjs': '管的是 **CI 桥接面**（工作流/脚本接线，不读源模块）',
  'verify-undefined-refs.mjs': '管的是**未定义引用**（"用了但没 import/声明"的非全局内置名），扫 lib/src/scripts 全树按 AST 判，目标不是某个模块',
  // D-G1 收口（2026-10-16）：行尾契约是**字节级**的，判的是"整棵入库树"，不指向某个模块。
  'verify-eol.mjs': '管的是**行尾契约**（`.gitattributes` 的 `* text=auto eol=lf`）：扫 `git ls-files` 的全部入库文件，判"文本文件字节里零 `0x0D`"，目标是"整棵入库树必须是 LF"，不针对某个模块',
  // PR #5：可选桌宠联动离线回归的**聚合入口**（逐个 spawn 上面那批 `verify-pet-*.mjs`，自身不读源文件）。
  'verify-pet-link.mjs': '管的是**可选桌宠联动离线回归的整组**（聚合入口：按清单 spawn `test/verify-pet-*.mjs`，自身不直读任何源模块）；组内每条各自在链上，入口只是手动/包内便利入口',
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
  const allowed = Object.keys(ZERO_COVERAGE_WHY);
  const unknown = uncoveredUnregistered(map.uncovered, allowed);
  check('没有"未登记的零覆盖"模块', unknown.length === 0,
    unknown.length ? '零覆盖且未登记：' + unknown.join(', ') : map.uncovered.length + ' 个零覆盖，全部已登记');
  const stale = staleExceptions(allowed, map.uncovered);
  check('例外表不空转（登记了却已有守卫的，该删）', stale.length === 0,
    stale.length ? '该删：' + stale.join(', ') : allowed.length + ' 条都在用');
  const noReason = thinReasons(ZERO_COVERAGE_WHY);
  check('例外表每条都有非空的理由', noReason.length === 0, noReason.join(', ') || allowed.length + ' 条都有');
  // ── 负对照：调**上面同一份**判据函数（合成输入），每一条都能真的红 ────────────────
  //    （原先这里是把判据重写一遍的恒真式 —— 判据一改，负对照不会跟着红 = 假牙。）
  //    合成用的"已登记"例子取表里**当前确实在册**的那一条（表随接线不断缩小：例子过期会让
  //    正/负对照一起变成假红，见 D/F 两次收口）。
  const registeredExample = M('packages', 'mascot-avatar', 'lib', 'index.js');
  check('negative control: 新模块没守卫时会被同一条判据判出（合成输入）',
    uncoveredUnregistered(['src/zzz-new-module.js'], allowed).length === 1
    && uncoveredUnregistered([registeredExample], allowed).length === 0,
    '合成未登记模块 ⇒ ' + uncoveredUnregistered(['src/zzz-new-module.js'], allowed).length + ' 个');
  check('negative control: 登记了却已有守卫的例外会被同一条判据判出（否则例外表会静默长大）',
    staleExceptions([...allowed, M('lib', 'zzz-gone.js')], map.uncovered).includes(M('lib', 'zzz-gone.js'))
    && staleExceptions(map.uncovered, map.uncovered).length === 0,
    '合成过期登记 ⇒ ' + staleExceptions([...allowed, M('lib', 'zzz-gone.js')], map.uncovered).length + ' 条该删');
  check('negative control: 空理由 / 一个词的"理由"都被同一条判据判出',
    thinReasons({ [M('lib', 'zzz-a.js')]: '', [M('lib', 'zzz-b.js')]: '同上' }).length === 2
    && thinReasons({ [M('lib', 'zzz-a.js')]: '这是一条足够长的理由说明（≥' + MIN_REASON_CHARS + ' 字）' }).length === 0,
    'MIN_REASON_CHARS=' + MIN_REASON_CHARS);
  check('正对照: 已登记的例外不算未登记（同一份判据的反方向）',
    uncoveredUnregistered([registeredExample], allowed).length === 0);
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
  const allowedNoTarget = Object.keys(NO_MODULE_TARGET_WHY);
  const direct = (r) => r.targets.filter((t) => t !== ARTIFACT);
  // 第三类 = targets 为空（`lib/client.js` 本身也是一种"目标"：产物同步那类守卫针对的就是它）
  const noTarget = map.rows.filter((r) => r.targets.length === 0).map((r) => r.guard);
  const unknown = noTargetUnregistered(noTarget, allowedNoTarget);
  const bundleOnly = map.rows.filter((r) => r.targets.length === 1 && r.targets[0] === ARTIFACT);
  check('没有"未登记的零目标守卫"', unknown.length === 0,
    unknown.length ? '零目标且未登记：' + unknown.join(', ')
      : `零目标 ${noTarget.length} 个全部已登记 · 只隔产物 ${bundleOnly.length} 个 · 直读模块 ${map.rows.filter((r) => direct(r).length > 0).length} 个`);
  const stale = staleMetaGuards(allowedNoTarget, noTarget);
  check('元守卫表不空转（登记了却已有目标的，该删）', stale.length === 0,
    stale.length ? '该删：' + stale.join(', ') : allowedNoTarget.length + ' 条都在用');
  const noReason = thinReasons(NO_MODULE_TARGET_WHY);
  check('元守卫表每条都有非空的理由', noReason.length === 0, noReason.join(', ') || allowedNoTarget.length + ' 条都有');
  // ── 负对照（同一条判据函数；原先那两条是恒真式）────────────────────────────────
  check('negative control: 合成一个零目标的新守卫会被同一条判据判出',
    noTargetUnregistered(['zzz-new-guard.mjs'], allowedNoTarget).length === 1
    && noTargetUnregistered(noTarget, allowedNoTarget).length === 0);
  check('negative control: 元守卫登记了却已经有目标 ⇒ 同一条判据报"该删"',
    staleMetaGuards([...allowedNoTarget, 'zzz-stale-guard.mjs'], noTarget).includes('zzz-stale-guard.mjs')
    && staleMetaGuards(noTarget, noTarget).length === 0);
  check('negative control: 元守卫的理由为空 / 过短 ⇒ 同一条判据判出',
    thinReasons({ 'zzz-guard.mjs': '', 'zzz-guard2.mjs': '同上' }).length === 2);
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

// ═══ ⑥b 前缀族读法（`scopeFiles` / `scopeText`）══════════════════════════════════
console.log('\n⑥b 前缀族读法（`scopeFiles(<前缀>)` 覆盖整族；零命中不算覆盖）');
{
  // 用**合成模块面**判：既不看磁盘现状（族还在演进），也不会碰到真模块（本文件在守卫面上）。
  const P = (...p) => p.join('/');
  const q = P('src', 'q1');
  const fam = [P('src', 'q1.js'), P('src', 'q1-core.js'), P('src', 'q1-panel.js'), P('src', 'q1cat.js'), P('src', 'q2.js')];
  const call = (fn, prefix) => fn + "('" + prefix + "')";
  const got = targetsOf(call('scopeText', q) + ';', fam);
  check('`scopeText("<前缀>")` 覆盖整族（含同前缀的**另一个**文件 q1cat.js —— startsWith 语义，与 `src-scope.mjs` 的族口径一致）',
    got.join(' ') === [P('src', 'q1-core.js'), P('src', 'q1-panel.js'), P('src', 'q1.js'), P('src', 'q1cat.js')].join(' '),
    '命中 ' + got.length + ' 个：' + got.join(' '));
  check('`scopeFiles("<前缀>")` 与 `scopeText` 同口径',
    targetsOf(call('scopeFiles', q) + ';', fam).join(' ') === got.join(' '), got.length + ' 个');
  check('negative control: 前缀匹配不到任何模块 ⇒ **零命中**（不许把"空族"当成覆盖 ⇒ 不许变成万能豁免）',
    targetsOf(call('scopeText', P('src', 'zzz')) + ';', fam).length === 0);
  check('negative control: **注释里**的 scopeText 不算（判据先剥注释，同 A–C）',
    targetsOf(`// 见 ${call('scopeText', q)} 的说明\nconst a = 1;`, fam).length === 0);
  check('negative control: 前缀不是字面量（模板/变量）不算',
    targetsOf('scopeText(`' + q + '`);', fam).length === 0 && targetsOf('scopeText(prefix);', fam).length === 0);
  check('negative control: 带成员访问的写法不算（`x.scopeText(…)` 不是那个 API）',
    targetsOf('helper.scopeText(' + JSON.stringify(q) + ');', fam).length === 0);
}

// ═══ ⑥c 经共享族助手读（`import { panelText } from './tools/src-scope.mjs'` + 真调用）══
console.log('\n⑥c 经共享族助手读（族口径封在 `src-scope.mjs` 里；只 import 不调用不算）');
{
  const P = (...p) => p.join('/');
  const q = P('src', 'q1');
  const fam = [P('src', 'q1.js'), P('src', 'q1-core.js'), P('src', 'q1-panel.js'), P('src', 'q1cat.js'), P('src', 'q2.js')];
  // 合成助手表：不经磁盘（族在演进），也避免依赖真 `src-scope.mjs` 的当前形状。
  const helpers = new Map([[ 'q1Text', [q] ], [ 'qzzzText', [P('src', 'zzz')] ], [ 'qvarText', [] ]]);
  const lib = './tools/src-scope.mjs';
  const imp = (names) => 'import { ' + names + " } from '" + lib + "';\n";
  const got = targetsOf(imp('q1Text') + 'const src = q1Text();', fam, helpers);
  check('导入了族助手并**真调用** ⇒ 覆盖整族（startsWith 语义，与 `scopeText` 同口径）',
    got.join(' ') === [P('src', 'q1-core.js'), P('src', 'q1-panel.js'), P('src', 'q1.js'), P('src', 'q1cat.js')].join(' '),
    '命中 ' + got.length + ' 个：' + got.join(' '));
  check('别名导入（`import { q1Text as t }`）按**本地名**认',
    targetsOf(imp('q1Text as t') + 'const src = t();', fam, helpers).length === 4);
  check('negative control: 只 `import` 不调用 ⇒ 零命中（"导入后忘了用"不是覆盖）',
    targetsOf(imp('q1Text') + 'const src = 1;', fam, helpers).length === 0);
  check('negative control: 助手体里的前缀匹配不到模块 ⇒ 零命中（与 ⑥b 同一条地板，不许变成万能豁免）',
    targetsOf(imp('qzzzText') + 'const src = qzzzText();', fam, helpers).length === 0);
  check('negative control: 助手没有字面量前缀（`scopeFiles(prefix)` 用变量）⇒ 不进表、零命中',
    targetsOf(imp('qvarText') + 'const src = qvarText();', fam, helpers).length === 0);
  check('negative control: 不来自 `./tools/src-scope.mjs` 的同名调用不算（F 只跟这一个库）',
    targetsOf("import { q1Text } from './tools/other.mjs';\nconst src = q1Text();", fam, helpers).length === 0);
  check('negative control: **注释里**的导入与调用都不算（判据先剥注释）',
    targetsOf('// ' + imp('q1Text') + '// const src = q1Text();\nconst a = 1;', fam, helpers).length === 0
    && targetsOf('/* ' + imp('q1Text') + 'const src = q1Text(); */\nconst a = 1;', fam, helpers).length === 0);
  // 真源自检：助手表是从那片库里**解析**出来的（期望值不与被测对象同源 —— 这里断言的是
  // "两个已知助手的族前缀确实是那两串"，由 `src-scope.mjs` 的 API 契约决定）。
  const real = familyHelpers();
  check('真源：`familyHelpers()` 从 `test/tools/src-scope.mjs` 解析出 `panelText`/`styleText` 的族前缀',
    (real.get('panelText') || []).join(' ') === P('src', 'panel-tabs')
    && (real.get('styleText') || []).join(' ') === P('src', 'styles'),
    'panelText=' + JSON.stringify(real.get('panelText')) + ' · styleText=' + JSON.stringify(real.get('styleText'))
      + ' · 表内 ' + real.size + ' 个助手');
  check('真源：收文本的助手（`cssBodyOf` / `cssPartsOf`）不进表（它们没有族前缀，不该被当成族读法）',
    !real.has('cssBodyOf') && !real.has('cssPartsOf'), '表内：' + [...real.keys()].join(' '));
}

// ═══ ⑥d 真源定位读（`locate('符号')` / `locateFile('名')` —— G 类）═══════════════════
console.log('\n⑥d 真源定位读（`test/tools/source-locator.mjs`；符号解析不到 ⇒ 零命中，不算覆盖）');
{
  // ⚠️ 夹具里的**符号名与路径都用合成值**（与 ⑥b/⑥c 同纪律）：本文件在守卫面上，
  //    夹具里写一个**真**符号名会让本文件被算成"管了那个模块"，把它的"零目标元守卫"
  //    登记自己推翻（A 类与 G 类都会命中）。
  const P = (...p) => p.join('/');
  const rel = P('src', 'q1.js');
  const other = P('src', 'q2.js');
  const sym = 'q1Anchor';
  const fileName = 'q1.js';
  const lib = './tools/source-locator.mjs';
  const imp = (names) => 'import { ' + names + " } from '" + lib + "';\n";
  const mods = [rel, other];
  // 合成锚点表：符号/文件名/调用点 → 唯一落点（真表由 `anchorTable()` 从磁盘派生）。
  const anchors = { symbols: new Map([[sym, rel]]), files: new Map([[fileName, rel]]), callSites: new Map([[sym, other]]) };
  const G = (text) => targetsOf(text, mods, new Map(), anchors);
  const callSym = 'locate(' + JSON.stringify(sym) + ')';

  check('`locate("<符号>")` 命中唯一声明所在模块 ⇒ 覆盖它',
    G(imp('locate') + 'const r = ' + callSym + ';').join(' ') === rel, G(imp('locate') + callSym + ';').join(' '));
  check('`locateFile("<文件名>")` 命中唯一文件 ⇒ 覆盖它',
    G(imp('locateFile') + 'const r = locateFile(' + JSON.stringify(fileName) + ');').join(' ') === rel);
  check('`locateCallSites("<符号>")` 命中唯一调用点所在模块 ⇒ 覆盖它（调用点与声明点可能不在同一个文件）',
    G(imp('locateCallSites') + 'const c = locateCallSites(' + JSON.stringify(sym) + ');').join(' ') === other);
  check('negative control: 调用点锚点表里没有的名字 ⇒ 零命中',
    G(imp('locateCallSites') + "locateCallSites('q1NotInTable');").length === 0);
  check('别名导入（`import { locate as L }`）按**本地名**认',
    G("import { locate as L } from '" + lib + "';\nL(" + JSON.stringify(sym) + ');').join(' ') === rel);
  check('negative control: 锚点表里没有的名字（0 处 / 多处声明）⇒ **零命中**（不许变成万能豁免）',
    G(imp('locate') + "locate('q1NotInTable');").length === 0);
  check('negative control: 解析到的文件不在模块面 ⇒ 零命中',
    targetsOf(imp('locate') + 'locate(' + JSON.stringify(sym) + ');', [other], new Map(), anchors).length === 0);
  check('negative control: 实参是变量 / 模板字面量 ⇒ 不算',
    G(imp('locate') + 'const s = "' + sym + '"; locate(s);').length === 0
    && G(imp('locate') + 'locate(`' + sym + '`);').length === 0);
  check('negative control: 带成员访问的写法不算（`x.locate(…)` 不是那个 API）',
    G(imp('locate') + 'helper.locate(' + JSON.stringify(sym) + ');').length === 0);
  check('negative control: 不来自 `./tools/source-locator.mjs` 的同名调用不算（G 只跟这一个库）',
    G("import { locate } from './tools/other.mjs';\nlocate(" + JSON.stringify(sym) + ');').length === 0);
  check('negative control: **注释里**的导入与调用都不算（判据先剥注释）',
    G('// ' + imp('locate') + '// ' + callSym + ';\nconst a = 1;').length === 0
    && G('/* ' + imp('locate') + callSym + '; */\nconst a = 1;').length === 0);
  check('negative control: 只 `import` 不调用 ⇒ 零命中',
    G(imp('locate') + 'const a = 1;').length === 0);
}

// ═══ ⑥e 真源定位工具自身的正/负对照（挂上链，不让牙齿只在人手跑 CLI 时存在）═══════════
console.log('\n⑥e `source-locator --selftest` 的 11 条走进守卫链（工具自身也有牙）');
{
  /** 跑一份"自检式"函数并统计失败项（生产与负对照共用这一份收账逻辑）。 */
  const collect = (run) => {
    let total = 0;
    const bad = [];
    run((name, cond, detail) => {
      total++;
      if (!cond) bad.push(name + (detail ? ' — ' + detail : ''));
    });
    return { total, bad };
  };
  const real = collect(locatorSelftest);
  check('真源定位器自检全过（唯一/多处/零处/注释内/缩进工厂作用域/生成物副本/in 作用域/多声明符/调用点定义处）',
    real.total >= 10 && real.bad.length === 0, real.bad.join('；') || real.total + ' 条全过');
  const fake = collect((ok) => { ok('always-true', true); ok('deliberate-failure', false, '注入的假失败'); });
  check('negative control: 自检里任何一条失败都会被上面的收账逻辑记成红（注入一条假失败 ⇒ bad=1）',
    fake.total === 2 && fake.bad.length === 1 && /deliberate-failure/.test(fake.bad[0]),
    'total=' + fake.total + ' · bad=' + fake.bad.length + '（' + fake.bad.join('；') + '）');
}

console.log('');
if (failed) {
  console.log('GUARD MAP CHECKS FAILED — ' + failed + ' failed');
  process.exit(1);
}
console.log('ALL GUARD MAP CHECKS PASSED');
process.exit(0);
