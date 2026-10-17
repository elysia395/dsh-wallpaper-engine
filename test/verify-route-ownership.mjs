#!/usr/bin/env node
/**
 * verify-route-ownership.mjs —— **实现归属唯一性**守卫（ADR-0013 的 D14「组件的路由实现随组件走、主包不留注册点」；度量 M10）。
 *
 * 为什么需要它（M10 的由来）：组件出户（P2-1 / P2-2）搬走的是**注册点**，而组件的私有路由实现
 * 当时仍留在主包 `lib/routes/` ⇒ "这个组件由哪些文件构成"只能靠文档说明，不能靠**位置**回答。
 * P2-8 把四个实现文件搬进所属组件目录后，边界从"注册点"落到"文件归属"；这条守卫就是那个边界的
 * 机械判据 —— 它让归属**搬家以后不会再漂回去**（否则下一次改动把它们放回去也没人拦）。
 *
 * 判据（全部**数据驱动**：组件清单与"谁拥有哪个文件"都现算，不写死组件名，也不维护
 * "组件名 → 目录"的硬编码清单 —— M5）：
 *   ① **M10 → 0**：patch 里有自己那一行的组件（P-F 出户后 = 声明面 `COMPONENT_VIEW_KEYS` 点名的
 *      每一格 → `packages/<pkg>/lib/index.js`；未出户仍落 `lib/components/<pkg>/index.js`），
 *      其**拥有**的路由实现模块**不得**位于 `lib/routes/`。"拥有"由**调用点派生**：组件入口调用
 *      哪个 `register…Routes(webServer, …)`，那个注册入口所在的文件就是它的实现。
 *   ② 组件目录下的**每一个文件**都必须被 `package.json` 的 `files` 覆盖（否则打包时静默漏发，
 *      装到用户机器上才炸成 `ERR_MODULE_NOT_FOUND`）。口径与 `verify-package-files.mjs` 的
 *      `coveredBy` 一致（目录条目 / 精确路径 / glob 三类）。
 *   ③ 每个**路由族文件**都必须**被某个行模块调用** —— 面由 `routeModuleFiles()` 现算，=
 *      `lib/routes/*.js` ∪ `lib/components/<c>/*.js`（组件目录里的族同样参与；修复前面只有
 *      `lib/routes/`，于是"把组件里的调用点摘掉"这种残渣判不出来）；其中 `lib/routes/` 下每个
 *      文件还**必须**是可解析的路由族模块 ——
 *      搬家最容易留下的两种残渣都在这里现形：①复制而不是删除（旧文件成了没人调用的孤儿）；
 *      ②`lib/routes/` 里的文件没了注册入口（认不出来 ⇒ 从路由索引里静默消失）。
 *
 * ── 判据必须有牙 ───────────────────────────────────────────────────────────────
 * 只断言"今天干净"不够：解析器一旦静默返回空表，①的"零违规"会变成空对空。因此：
 *   · 覆盖面地板（≥2 个组件行、每行都解析到 ≥1 个实现模块、`lib/routes/` 非空）；
 *   · 负对照喂**同一条判据函数**：合成一个"实现留在 `lib/routes/`"的组件 ⇒ 必须判红；
 *     把真实组件行的第一个实现文件改写成 `lib/routes/` 下的同名文件 ⇒ 同样判红；
 *     一个合成**组件族**（在磁盘上、导出注册入口、零调用点）⇒ 必须被判成孤儿。
 * 真实世界的负对照（报告里复算）：把某个已出户组件的实现文件**临时复制回** `lib/routes/`
 * ⇒ 本守卫判红（③ 的孤儿 + ① 的归属违规），删除临时文件 ⇒ 复绿。
 *
 * Usage:  node test/verify-route-ownership.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildIndex, routeModuleCandidates, routeModuleFiles, rowRegistrationCounts, patchRowNames,
  subpackageModuleViolations, subpackageManifests,
} from './tools/host-route-index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const toRel = (abs) => relative(ROOT, abs).split(sep).join('/');

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log('  ✓ ' + name + (detail ? ' — ' + detail : ''));
  else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); failed++; }
};

/** 递归枚举目录下的**文件**（相对仓库根，`/` 分隔，已排序）。目录不存在时返回空表。 */
function walkFiles(dir, out = []) {
  // ⚠️ 两个 `let` 都**不带初值**：初值永远不会被读到（catch 里早退 / continue）
  //    ⇒ 会被 `no-useless-assignment` 判红（本仓基线是空棘轮，只能减不能增）。
  let names;
  try { names = readdirSync(dir); } catch { return out; }
  for (const name of names) {
    const abs = join(dir, name);
    let st;
    try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) walkFiles(abs, out);
    else if (st.isFile()) out.push(toRel(abs));
  }
  return out.sort();
}

/** npm `files` 条目里的 glob → 正则（`*` 不跨 `/`，`**` 跨）—— 与 verify-package-files 同口径。 */
function globRe(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') { re += '.*'; i++; } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if ('\\^$+.[]{}()|'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return new RegExp('^' + re + '$');
}

/** 条目 `entry` 是否覆盖相对路径 `rel`（目录条目可带尾斜杠，也可指磁盘上真实存在的目录）。 */
function coveredBy(rel, entry) {
  const e = String(entry).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!e) return false;
  let isDir = String(entry).endsWith('/');
  if (!isDir) {
    try { isDir = statSync(join(ROOT, e)).isDirectory(); } catch { /* 非目录 / 不存在 */ }
  }
  if (isDir) return rel.startsWith(e + '/');
  if (/[*?]/.test(e)) return globRe(e).test(rel);
  return rel === e;
}

// ── 判据函数（生产输入与负对照走**同一份**）────────────────────────────────────

/**
 * 一个组件行**拥有**的路由实现模块：由调用点派生（它调用了哪个 `register…Routes(webServer, …)`）。
 * `modules` = `buildIndex().modules`（每个 `{rel, fnName, routes, …}`）。
 * 返回 `{ owned, fns, unknown }`：`owned` 是实现文件的 rel（去重保序）；`unknown` 非空 = 调用点
 * 解析不到路由族（判据要红，不能静默算 0 个实现）。
 */
export function ownedRouteModules(rel, modules) {
  // ⚠️ 归属按**函数名**算，且**同名实现的每一份都算被拥有** —— 不能用"最后写入者赢"的 Map：
  // 否则把组件实现**又复制一份**回 `lib/routes/` 时（复制而非搬移的残渣），`owned` 仍指向组件目录
  // 那一份，① 会报 `M10 = 0`（假绿），只有 ③ 的孤儿判据红。P2-8V 独立复核实测过这个状态。
  const byFn = new Map();
  for (const m of modules) {
    if (!byFn.has(m.fnName)) byFn.set(m.fnName, []);
    byFn.get(m.fnName).push(m.rel);
  }
  const { fns, unknown } = rowRegistrationCounts(rel, modules);
  const owned = [];
  for (const f of fns) {
    for (const r of byFn.get(f) || []) if (!owned.includes(r)) owned.push(r);
  }
  return { owned, fns, unknown };
}

/** M10 的违规对：已出户组件拥有的实现文件仍住在 `lib/routes/`。空 = M10 → 0。 */
export function outOfHouseViolations(entries) {
  return entries.flatMap((e) => (e.owned || [])
    .filter((r) => r.startsWith('lib/routes/'))
    .map((r) => e.rel + ' 拥有 ' + r));
}

/** `files` 对一组相对路径的漏覆盖（空 = 全覆盖）。 */
export function fileCoverageGaps(files, rels) {
  return rels.filter((rel) => !files.some((e) => coveredBy(rel, e)));
}

/** `lib/routes/` 文件里"认不出注册入口"的那些（空 = 每个文件都能被索引认成路由族模块）。 */
export function unrecognizedRouteFiles(rels, moduleRels) {
  return rels.filter((rel) => !moduleRels.has(rel));
}

/** `lib/routes/` 文件里的孤儿：文件在、没有任何行模块调用它（复制而非搬移的残渣）。 */
export function orphanRouteFiles(rels, orphanRels) {
  return rels.filter((rel) => orphanRels.has(rel));
}

/** 覆盖对账：`theirs` 里没有被 `ours` 覆盖的成员（空 = 覆盖完整）。生产与下面三条负对照共用。 */
export function uncoveredMembers(ours, theirs) {
  const have = new Set(ours);
  return [...new Set(theirs)].filter((x) => !have.has(x));
}

/** 声明面每一格都必须有一条**真名** patch 行（P-F：出户后行名就是真包名，不再含 `/`）。
 *  `rows` / `names` 由调用方注入 ⇒ 生产与负对照走同一条判据（不写死组件名，也不写死数量）。 */
export function missingComponentRows(names, rows, rootName) {
  const have = new Set(rows);
  return names.filter((n) => !have.has(rootName + '-' + n));
}

/** 组件行 → 入口文件的覆盖缺口（存在性由调用方注入 ⇒ 负对照能喂合成输入，不用碰磁盘）。 */
export function rowEntryGaps(rows, entryList, existsOnDisk) {
  const have = new Set(entryList);
  return rows.filter((rel) => !have.has(rel) || !existsOnDisk(rel));
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const files = Array.isArray(pkg.files) ? pkg.files : [];
// ⚠️ P-F 批 1c：三格组件已全部出户到 `packages/<pkg>/` ⇒ 发现层的 `kind === 'subpath'`（旧
// `COMPONENT_MODULES`）为空数组**属预期形态**，"组件行"因此不再等于 `lib/components/` 那个目录，
// 而是**声明面**点名的入口集合：出户落 `packages/<name>/lib/index.js`、未出户落
// `lib/components/<name>/index.js`（迁移窗口内两种落点并存）。组件清单与落点都**现算**，不写死名字。
const { COMPONENT_VIEW_KEYS } = await import(pathToFileURL(join(ROOT, 'lib', 'kernel', 'component-session.js')).href);
const COMPONENT_NAMES = Object.keys(COMPONENT_VIEW_KEYS || {}).sort();
const componentEntryRel = (name) => (existsSync(join(ROOT, 'packages', name, 'lib', 'index.js'))
  ? 'packages/' + name + '/lib/index.js' : 'lib/components/' + name + '/index.js');
const componentEntries = COMPONENT_NAMES.map(componentEntryRel);
const isOutOfHouse = (rel) => rel.startsWith('packages/');
const built = buildIndex();
const modules = built.modules;
const orphanRels = new Set(built.orphanModules.map((m) => m.rel));

// ═══ ① M10 → 0：组件的实现文件不得留在 lib/routes/ ══════════════════════════════
console.log('\n① 实现归属：已出户组件拥有的实现不得留在 `lib/routes/`（M10 → 0）');
{
  // 覆盖面：组件清单**数据驱动**（声明面 `COMPONENT_VIEW_KEYS` → 现算落点），每一格都要解析到自己的实现。
  const entries = componentEntries.map((rel) => ({ rel, ...ownedRouteModules(rel, modules) }));
  const unresolved = entries.filter((e) => e.unknown.length || e.owned.length === 0);
  // ⚠️ 原先这里是 `COMPONENT_MODULES.length >= 2`（**快照地板**：上游加一行 ⇒ 无判别力的绿；
  //    合并掉一行 ⇒ 无判别力的红）。改成对账 patch 真源：**声明面每一格**都必须有一条真名行
  //    （P-F：出户后行名就是真包名）+ 磁盘上真实存在的入口文件（少一个都点名）—— "行 → 入口"不变量。
  const rowGaps = missingComponentRows(COMPONENT_NAMES, patchRowNames(), pkg.name);
  const entryGaps = rowEntryGaps(componentEntries, componentEntries, (rel) => existsSync(join(ROOT, rel)));
  check('覆盖面：声明面每一格都有真名行 + 磁盘上的入口文件（数据驱动，不写死组件名 / 数量）',
    COMPONENT_NAMES.length > 0 && rowGaps.length === 0 && entryGaps.length === 0,
    COMPONENT_NAMES.map((n) => n + '→' + componentEntryRel(n)).join(' ') || '（没有组件）');
  // 负对照（调同一份判据函数）：缺行 / 入口不在磁盘上 —— 两个方向各一条。
  check('negative control：声明面某格缺真名行、或入口不在磁盘上 ⇒ 同一条判据点名',
    missingComponentRows([...COMPONENT_NAMES, 'zzz-ghost'], patchRowNames(), pkg.name).join() === 'zzz-ghost'
    && rowEntryGaps([componentEntries[0]], componentEntries, () => false).length === 1
    && missingComponentRows(COMPONENT_NAMES, patchRowNames(), pkg.name).length === 0);
  check('覆盖面：每个组件都解析到了自己的路由实现（组件清单数据驱动，不写死组件名）',
    componentEntries.length > 0 && unresolved.length === 0,
    entries.map((e) => e.rel.replace(/^lib\/components\//, '').replace(/^packages\//, '').replace(/\/lib\/index\.js$/, '').replace(/\/index\.js$/, '')
      + '=' + e.owned.length).join(' · ') || '（一个组件都没有）');
  for (const e of unresolved) {
    console.log('    ↳ ' + e.rel + '：调用点 ' + e.fns.join(' ') + ' / 解析不到 ' + e.unknown.join(' '));
  }

  const violations = outOfHouseViolations(entries);
  const m10 = entries.reduce((n, e) => n + e.owned.filter((r) => r.startsWith('lib/routes/')).length, 0);
  check('M10 = 0：组件拥有的实现全部住在组件目录里（`lib/routes/` 里零残留）',
    violations.length === 0 && m10 === 0,
    violations.length ? violations.join('；') : 'M10=' + m10 + '（' + entries.reduce((n, e) => n + e.owned.length, 0) + ' 个实现文件全部有主）');

  // 负对照（同一条判据函数）：合成"实现留在 lib/routes/"的组件 ⇒ 红；实现随组件走 ⇒ 绿。
  const syntheticBad = [{ rel: 'lib/components/probe/index.js', owned: ['lib/routes/probe.js'] }];
  const syntheticGood = [{ rel: 'lib/components/probe/index.js', owned: ['lib/components/probe/probe.js'] }];
  check('负对照：实现留在 `lib/routes/` 的组件被同一条判据判红（且随组件走时不报）',
    outOfHouseViolations(syntheticBad).length === 1 && outOfHouseViolations(syntheticGood).length === 0,
    outOfHouseViolations(syntheticBad).join('；') || '（没判出来）');

  // 负对照（真实模块表）：拿真实组件行的实现文件名拼回 `lib/routes/` —— 必须判红。
  const real = entries.find((e) => e.owned.length);
  const realProbe = real
    ? [{ rel: real.rel, owned: ['lib/routes/' + real.owned[0].split('/').pop()] }]
    : [];
  check('负对照（真实输入）：把真实组件的一个实现改写成 `lib/routes/<同名>` ⇒ 判红',
    Boolean(real) && outOfHouseViolations(realProbe).length === 1,
    real ? real.rel + ' 的 ' + real.owned[0] + ' → lib/routes/' + real.owned[0].split('/').pop() : '（没有可用的组件）');

  // 实现文件必须真的在磁盘上（归属判据不许指向幽灵文件）。
  const missing = entries.flatMap((e) => e.owned).filter((rel) => !existsSync(join(ROOT, rel)));
  check('组件拥有的实现文件都在磁盘上（归属不是幽灵路径）', missing.length === 0,
    missing.join(' ') || entries.reduce((n, e) => n + e.owned.length, 0) + ' 个路径都存在');
}

// ═══ ② 组件目录下的文件逐条被 package.json 的 files 覆盖 ═════════════════════════
console.log('\n② 组件目录下的文件逐条进 `package.json` 的 `files`');
{
  // P-F：文件面 = 仍在 `lib/components/` 的（迁移期残留）+ **每个出户组件自己的包目录**
  //     （出户后实现住 `packages/<name>/lib/**`，主包 `files` 不再负责它们）。
  const legacyComponentFiles = walkFiles(join(ROOT, 'lib', 'components'));
  const outOfHouseFiles = COMPONENT_NAMES.filter((n) => isOutOfHouse(componentEntryRel(n)))
    .flatMap((n) => walkFiles(join(ROOT, 'packages', n)));
  const componentFiles = [...legacyComponentFiles, ...outOfHouseFiles].sort();
  const gaps = fileCoverageGaps(files, legacyComponentFiles);
  // ⚠️ 原先这里是 `componentFiles.length >= 4`（快照）。改成"每个组件入口都在这个文件面里"
  //    （由声明面派生，组件增删它跟着变；面塌陷则入口必然不在面内 ⇒ 红）。
  const missingEntries = uncoveredMembers(componentFiles, componentEntries);
  check('覆盖面：磁盘枚举出的组件文件面包含全部组件入口（防扫描面为空而恒真；不写死文件数）',
    componentEntries.length > 0 && componentFiles.length > 0 && missingEntries.length === 0,
    componentFiles.length + ' 个文件 · 组件入口 ' + componentEntries.length + ' 个'
      + (missingEntries.length ? ' · 不在面内 ' + missingEntries.join(' ') : ''));
  check('negative control：文件面里少一个组件入口 ⇒ 同一条 uncoveredMembers 判出（不写死文件数的代价是有牙）',
    uncoveredMembers(componentFiles.filter((r) => r !== componentEntries[0]), componentEntries).length === 1
    && uncoveredMembers(componentFiles, componentEntries).length === 0);
  check('`lib/components/**` 每个文件都被主包 `files` 覆盖（含搬进来的路由实现）', gaps.length === 0,
    gaps.length ? '漏发：' + gaps.join(', ') : legacyComponentFiles.length + ' 个文件全部覆盖（条目 `lib/components/`）');
  // 出户组件：包内文件必须被**自己清单**的 `files` 覆盖（条目相对包目录解析 —— 与
  // `verify-bundle-rows` / `verify-subpackage-manifests` 同口径）。
  const pkgGaps = [];
  for (const n of COMPONENT_NAMES) {
    if (!isOutOfHouse(componentEntryRel(n))) continue;
    const dir = 'packages/' + n + '/';
    let ownFiles = [];
    try { ownFiles = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8')).files || []; } catch { /* 缺清单由别的判据管 */ }
    pkgGaps.push(...fileCoverageGaps(ownFiles.map((f) => dir + f), walkFiles(join(ROOT, dir))));
  }
  check('出户组件的包内文件都被各自清单的 `files` 覆盖（条目按包目录解析）', pkgGaps.length === 0,
    pkgGaps.length ? '漏发：' + pkgGaps.join(', ') : '出户 ' + COMPONENT_NAMES.filter((n) => isOutOfHouse(componentEntryRel(n))).length + ' 个包全覆盖');
  // 负对照（同一条判据函数）：没有目录条目时，组件文件必须被判漏发。
  // ⚠️ 这里**不用**一个真实存在的入口路径（如 `lib/index.js`）当夹具：`guard-targets` 按路径字面量
  //    派生"守卫 ↔ 模块"映射，写一个真模块会让本守卫被算成"读它"（本守卫不读任何具体模块）。
  const bare = fileCoverageGaps(['lib/no-such-entry.js'], ['lib/components/probe/probe.js']);
  check('负对照：`files` 里丢掉组件目录条目 ⇒ 同一条判据判出漏发',
    bare.length === 1 && bare[0] === 'lib/components/probe/probe.js',
    bare.join(', ') || '（没判出来）');
}

// ═══ ③ 每个路由族文件仍必须被某个行模块调用（面 = lib/routes/ ∪ 组件目录） ══════
console.log('\n③ 每个路由族文件（`lib/routes/` 与组件目录里的实现）仍必须被某个行模块调用');
{
  // 两个文件面都取自 `host-route-index.mjs` 的现算真源（不另抄一份组件名单）：
  //   · `routeModuleFiles()` = **真路由族**（含 `export function register…Routes(webServer` 入口），
  //     面 = `lib/routes/*.js` ∪ `lib/components/<c>/*.js` ⇒ **孤儿判据用这一面**（组件族必须在内：
  //     修复前这里只取 `lib/routes/`，组件目录里的族被摘掉调用点也判不出来）；
  //   · `routeModuleCandidates()` 的 `lib/routes/` 那一份 = "可能住着族"的文件面 ⇒ 只有它参与
  //     "认不出入口"判据（组件目录里的 `index.js` / `supervisor.js` 之类本就不是族，扩到那里是误报）。
  const routeFiles = routeModuleFiles();
  const libRouteCandidates = routeModuleCandidates().filter((rel) => rel.startsWith('lib/routes/'));
  const moduleRels = new Set(modules.map((m) => m.rel));
  const unrecognized = unrecognizedRouteFiles(libRouteCandidates, moduleRels);
  const orphans = orphanRouteFiles(routeFiles, orphanRels);
  // ⚠️ 原先这里是 `routeFiles.length >= 15`（快照：上游合并路由族 ⇒ 无判别力的红）。
  //    改成**跨列举面覆盖对账**：`lib/routes/` 下每个 `buildIndex()` 认作路由族的文件都必须在
  //    本守卫的候选文件面里（两个列举面互相兜底；面塌陷 / 过滤条件写错都会点名）。
  const builtLibRoutes = modules.filter((m) => m.rel.startsWith('lib/routes/')).map((m) => m.rel);
  const notScannedLib = uncoveredMembers(libRouteCandidates, builtLibRoutes);
  check('覆盖面：`buildIndex()` 的 `lib/routes/` 族文件面 ⊆ 本守卫的候选面（不写死文件数，防空集恒真）',
    builtLibRoutes.length > 0 && notScannedLib.length === 0,
    '候选 ' + libRouteCandidates.length + ' 个 · 索引认作路由族 ' + builtLibRoutes.length + ' 个'
      + (notScannedLib.length ? ' · 漏扫 ' + notScannedLib.join(' ') : ''));
  check('negative control：索引认得、本守卫候选面里没有的文件 ⇒ 同一条 uncoveredMembers 判出',
    uncoveredMembers(libRouteCandidates, [...builtLibRoutes, 'lib/routes/zzz-not-scanned.js']).length === 1
    && uncoveredMembers(libRouteCandidates, builtLibRoutes).length === 0);
  // ⚠️ 孤儿面的地板（这一条就是修复缺口的判据）：**组件拥有的实现必须落在孤儿面里**。组件清单与
  //    "谁拥有哪个实现"都现算（声明面的落点清单 + `ownedRouteModules()`，后者内部走
  //    `rowRegistrationCounts`）—— 面塌回 `lib/routes/`-only 时这些文件**不在面内**，这里点名。
  const builtRouteRels = modules.map((m) => m.rel);
  const componentOwned = [...new Set(componentEntries.flatMap((rel) => ownedRouteModules(rel, modules).owned))];
  const notScannedComponents = uncoveredMembers(routeFiles, componentOwned);
  check('覆盖面：组件行拥有的实现模块 ⊆ 孤儿扫描面（组件族不参与 ⇒ 从这里点名）',
    componentOwned.length > 0 && notScannedComponents.length === 0,
    '组件实现 ' + componentOwned.length + ' 个'
      + (notScannedComponents.length ? ' · 不在面内 ' + notScannedComponents.join(' ') : ''));
  check('negative control：把孤儿面塌回 `lib/routes/`-only（修复前的形态）⇒ 组件实现被同一条 uncoveredMembers 判出不在面内',
    componentOwned.length > 0
      && uncoveredMembers(routeFiles.filter((rel) => rel.startsWith('lib/routes/')), componentOwned).length === componentOwned.length
      && uncoveredMembers(routeFiles, componentOwned).length === 0);
  check('覆盖面：索引认作路由族的文件面 ⊆ 孤儿扫描面（面塌陷 ⇒ 红）',
    builtRouteRels.length > 0 && uncoveredMembers(routeFiles, builtRouteRels).length === 0,
    '族文件 ' + routeFiles.length + ' 个 · 索引 ' + builtRouteRels.length + ' 个');
  check('`lib/routes/` 每个文件都是可解析的路由族模块（文件在、入口认不出来 ⇒ 从索引静默消失）',
    unrecognized.length === 0, unrecognized.join(', ') || '全部有注册入口');
  check('每个路由族文件都被某个行模块调用（`lib/routes/` 里的残渣 / 组件目录里被摘掉调用点的族都在此现形）',
    orphans.length === 0, orphans.join(', ') || '零孤儿（行模块 ' + moduleRels.size + ' 个 · 族文件 ' + routeFiles.length + ' 个）');
  // 负对照（同一条判据函数）：喂合成输入 —— 无入口 / 孤儿都必须被判出，干净输入不报。
  const fakeOrphans = new Set(['lib/routes/probe.js']);
  check('负对照：无注册入口的文件与孤儿文件都被同一条判据判出（干净输入不报）',
    unrecognizedRouteFiles(['lib/routes/probe.js'], new Set()).length === 1
    && orphanRouteFiles(['lib/routes/probe.js', 'lib/routes/ok.js'], fakeOrphans).join() === 'lib/routes/probe.js'
    && unrecognizedRouteFiles(['lib/routes/ok.js'], new Set(['lib/routes/ok.js'])).length === 0
    && orphanRouteFiles(['lib/routes/ok.js'], new Set()).length === 0);
  // 负对照（同一条 orphanRouteFiles）：**合成组件族** —— 文件在磁盘上、导出注册入口、但没有任何调用点
  // ⇒ 必须判成孤儿（修复前面里没有组件目录，这种族一律判不出来）；有调用点时不报（否则只会"一律红"）。
  const fakeComponentFamily = 'lib/components/probe/probe.js';
  check('负对照：磁盘上、导出注册入口、但零调用点的合成组件族被同一条 orphanRouteFiles 判成孤儿',
    orphanRouteFiles([fakeComponentFamily], new Set([fakeComponentFamily])).join() === fakeComponentFamily
    && orphanRouteFiles([fakeComponentFamily], new Set()).length === 0,
    orphanRouteFiles([fakeComponentFamily], new Set([fakeComponentFamily])).join() || '（没判出来）');
}

// ═══ ④ 每个子包行都必须解析到磁盘上存在的宿主入口（P-A：包发现层双向对账）══════════
console.log('\n④ 子包行 ⇄ `packages/<dir>/package.json` 双向对账（行静默少一行 = 浏览器半边静默失效）');
{
  const rows = patchRowNames();
  const manifests = subpackageManifests();
  const exists = (rel) => existsSync(join(ROOT, rel));
  const violations = subpackageModuleViolations(rows, manifests, exists);
  check('每条子包行都有包认领、每个包都有行、且 `main` 指向磁盘上存在的入口',
    manifests.length > 0 && violations.length === 0,
    '子包 ' + manifests.map((p) => p.dir + ' → ' + p.main).join(' / ')
      + (violations.length ? ' · ' + violations.join('；') : ''));

  // 负对照（同一条判据）：把真实清单里的一个 `main` 改成不存在的路径 ⇒ 必须点名（"缺入口 ⇒
  // `MAIN_MODULES` 静默少一行 ⇒ 运行面与声明面一起少"的牙）。
  const broken = manifests.map((p, i) => (i === 0 ? { ...p, main: './lib/does-not-exist.js' } : p));
  const brokenViolations = subpackageModuleViolations(rows, broken, exists);
  check('negative control：某个包的 `main` 指向不存在的路径 ⇒ 同一条判据点名（缺入口不许静默）',
    manifests.length > 0 && brokenViolations.length === 1 && brokenViolations[0].includes('入口不存在'),
    brokenViolations.join('；') || '（没判出来）');
  // 负对照（同一条判据）：包在磁盘上、patch 里却**没有它的行** ⇒ "未登记行"（§2.2：只写 npm 依赖 /
  // 只建目录都不会让行出现，而且没有别的判据会告诉你 —— 这正是启动自检那条判据的机械形态）。
  const orphanManifest = manifests[0];
  const withoutRow = orphanManifest ? subpackageModuleViolations(rows.filter((n) => n !== orphanManifest.name), manifests, exists) : [];
  check('negative control：包在磁盘上但 patch 里没有它的行 ⇒ 同一条判据点名 "未登记行"',
    Boolean(orphanManifest) && withoutRow.some((v) => v.includes('未登记行')), withoutRow.join('；') || '（没判出来）');
  // 负对照（同一条判据）：patch 里多一条没有包认领的子包行 ⇒ "死行"。
  const deadRow = subpackageModuleViolations([...rows, 'dsh-plugin-wallpaper-engine-ghost'], manifests, exists);
  check('negative control：patch 里多一条没有包认领的子包行 ⇒ 同一条判据点名 "死行"',
    deadRow.some((v) => v.includes('死行')), deadRow.join('；') || '（没判出来）');

  // 子包路由族必须在孤儿扫描面内（面塌回 `lib/routes/`-only ⇒ 搬走的族"文件在、没人调用"判不出来）。
  const pkgRouteCandidates = routeModuleCandidates().filter((rel) => rel.startsWith('packages/') && rel.includes('/lib/routes/'));
  const routeFiles = routeModuleFiles();
  const built = buildIndex();
  const builtPkgRoutes = new Set(built.routes.filter((r) => r.src && r.src.startsWith('packages/')).map((r) => r.src));
  const notInOrphanSurface = pkgRouteCandidates.filter((rel) => !routeFiles.includes(rel));
  check('覆盖面：子包路由族候选面非空且全在孤儿扫描面内（面塌陷 ⇒ 红）',
    pkgRouteCandidates.length > 0 && notInOrphanSurface.length === 0,
    '包内候选 ' + pkgRouteCandidates.length + ' 个 · 索引计入 ' + builtPkgRoutes.size + ' 个'
      + (notInOrphanSurface.length ? ' · 不在面内 ' + notInOrphanSurface.join(' ') : ''));
  check('negative control：孤儿面塌回 `lib/routes/`-only ⇒ 子包路由族被同一条 uncoveredMembers 判出不在面内',
    pkgRouteCandidates.length > 0
      && uncoveredMembers(routeFiles.filter((rel) => rel.startsWith('lib/routes/')), pkgRouteCandidates).length === pkgRouteCandidates.length
      && uncoveredMembers(routeFiles, pkgRouteCandidates).length === 0);
}

console.log('');
if (failed) { console.log(`ROUTE OWNERSHIP CHECKS FAILED — ${failed} failed`); process.exit(1); }
console.log('ALL ROUTE OWNERSHIP CHECKS PASSED (M10 = 0)');
process.exit(0);
