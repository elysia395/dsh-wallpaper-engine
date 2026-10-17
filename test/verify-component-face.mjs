#!/usr/bin/env node
/**
 * verify-component-face.mjs — **组件注入面的分级判据**（ADR-0013 的 D12① 收窄面 / D13 两级公开面；度量 M8 与 M9）。
 *
 * 回答的边界问题：组件入口到底能吃内核的哪些键？——在这之前答案是"整个 `hostKernel`（95 个键，
 * 其中 88 个内部面）"：两个组件入口各自 `const { … } = hostKernel` 现解构（about-notice 6 项、
 * mascot-avatar 17 项），依赖面名义上是 `c` 的四个键、实际是整个内核对象。P2-7B 把组件面收成
 * **内核导出的具名视图**（`lib/kernel/component-session.js` 的 `COMPONENT_VIEW_KEYS` +
 * `componentViewFrom()`），本守卫把这条边界变成机械判据。
 *
 * 判据（ADR-0013 的 D12③「内核内部面不得被组件 / 路由族直接解构」，加上本守卫要的三条面归属）：
 *   ① **内核分级面机械复算**：`KERNEL_STABLE_FACE`（`lib/kernel/host-kernel.js` 导出的 15 项）
 *      与**实跑内核**的 `Object.keys()` 对账。**合同数字的唯一真源 = 本行**（改一次 =
 *      一次可见的决策：同时把下面这行改掉）：
 *      「合计 99 / 稳定面 15 / 稳定面 ∩ 内核 7 / 内部面 92」
 *      —— 判据**从这一行现算**期望值，不再把数字抄进 check 名与负对照（本会话实测：内核从
 *      95 长到 98 后，主判据与它的负对照一起假红 —— 负对照写死了 95/96/89/87）。
 *   ② **M9 → 0**：`lib/components/**` 与 `lib/routes/**` 里**零处**直接消费内核对象
 *      （`const { … } = hostKernel` 解构或 `hostKernel.<键>` 成员访问）。组件只能从视图取键。
 *   ③ **声明面 ↔ 实际消费面逐键相等**（双向）：每个组件声明的视图键集 == 组件自己解构的键
 *      ∪ 会话（`createComponentSession`）从同一视图解构的 serve 依赖键；且 `componentViewFrom()`
 *      真取一次视图，键集一致、缺键即抛。声明了没人给 / 给了没声明，两个方向都红。
 *   ④ **姿势不变**（P2-5C / P2-6）：组件入口仍是 `inject = ['webServer']` + `export function apply`
 *      + `handOffTeardown(ctx, runComponent(…))`；组件会话**不** acquire / release 内核租约
 *      （有意不对称），teardown 四步与两处原实现逐字同序。
 *   ⑤ **内部面暴露预算（只减不增）**：组件视图暴露的内部面键 ≤ 20、组件入口自取的内部面键 ≤ 11
 *      （P2-7B 落地时按两个组件钉的是 16 / 10；第三件组件"媒体桥入包"按**实测**加到 20 / 11：
 *      视图 +4 = `readConfig` · `traceMediaRequests` · `readWebShim` · `buildSeedScript`
 *      ——后 3 项是 `SESSION_SERVE_KEYS` 强制的 serve 管线依赖；入口 +1 = `readConfig`。
 *      媒体桥另需的 `configPath` / `CONTROL_JSON_MAX_BYTES` **不在实跑内核对象上**，因此不进视图，
 *      由入口直接 import 叶子模块（`kernel/data-dir.js` / `http-body.js`）⇒ 不计入内部面暴露。
 *      **只按实测加、不预留**）；再收窄可以过，悄悄多暴露一个内部面键必须红。
 *      预算判据的负对照走**同一条聚合函数**（合成一个超预算组件），不再是 `21 > 20` 这种纯算术复述。
 *
 * ⚠️ 各节都带**负对照**，且负对照与生产扫描调用**同一个判据函数**（合成源码喂进去）——
 *    "断言 assert X != Y" 这种同源比较不算对照。
 *
 * ⚠️ 三个模块路径（门面 / 内核 / 会话）一律经 `test/tools/source-locator.mjs` **定位符号**得到，
 *    不写死路径：实现搬家时判据跟着符号走（0 处 / 多处声明才判红），而不是静默读旧文件。
 *
 * ⚠️ 判据只看**剥注释后**的代码（`test/tools/js-text.mjs` 的 `stripComments`）：本文件与组件
 *    文件头都写着 `const { … } = hostKernel` 这类**反例文本**，按原文匹配会把注释算成违规。
 *
 * Usage:  node test/verify-component-face.mjs
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripComments } from './tools/js-text.mjs';
// 真源定位（符号 → 唯一声明文件）+ 内核/组件行的**数据驱动真源**（不写死组件清单）。
import { locate } from './tools/source-locator.mjs';
import { MAIN_MODULES, routeModuleCandidates } from './tools/host-route-index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log('  ✓ ' + name + (detail ? ' — ' + detail : ''));
  else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); failed++; }
};
const section = (t) => console.log('\n' + t);

// ── 纯函数判据（生产扫描与负对照共用同一份实现）────────────────────────────────

/**
 * 分级复算：内核实跑键集 + 稳定面声明 → `{ total, stableFace, stableOnKernel, internal }`。
 * 内部面口径 = 内核键 − 稳定面（稳定面里那 8 个"门面构建"键不在内核上，自然算不进来）。
 */
function classifyFaces(kernelKeys, stableFace) {
  const stable = new Set(stableFace);
  return {
    total: kernelKeys.length,
    stableFace: stableFace.length,
    stableOnKernel: kernelKeys.filter((k) => stable.has(k)),
    internal: kernelKeys.filter((k) => !stable.has(k)),
  };
}

/**
 * ① 的判据本体：实跑分级 vs **合同数字**（文件头那一行的解析结果）⇒ 不一致清单。
 * 生产与负对照调这一个函数。
 */
function faceAgreement(face, contract) {
  const bad = [];
  if (face.total !== contract.total) bad.push('合计 ' + face.total + ' ≠ 合同 ' + contract.total);
  if (face.stableFace !== contract.stableFace) bad.push('稳定面 ' + face.stableFace + ' ≠ 合同 ' + contract.stableFace);
  if (face.stableOnKernel.length !== contract.stableOnKernel) bad.push('稳定面 ∩ 内核 ' + face.stableOnKernel.length + ' ≠ 合同 ' + contract.stableOnKernel);
  if (face.internal.length !== contract.internal) bad.push('内部面 ' + face.internal.length + ' ≠ 合同 ' + contract.internal);
  return bad;
}

/** 合同数字**唯一真源** = 本文件头那一行（缺锚即红，绝不回落到默认数字）。 */
function parseFaceContract(fileText) {
  const m = /「合计 (\d+) \/ 稳定面 (\d+) \/ 稳定面 ∩ 内核 (\d+) \/ 内部面 (\d+)」/.exec(fileText);
  if (!m) return null;
  return { total: Number(m[1]), stableFace: Number(m[2]), stableOnKernel: Number(m[3]), internal: Number(m[4]) };
}

/** 从剥注释后的源码里抽 `const { a, b: local } = <name>;` 的**原名**（支持跨多行、别名）。 */
function destructuredFrom(code, name) {
  const re = new RegExp('(?:const|let|var)\\s*\\{([^}]*)\\}\\s*=\\s*' + name + '\\s*;', 'g');
  const out = [];
  for (const m of code.matchAll(re)) {
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      out.push(t.split(':')[0].trim()); // `a: b` 别名 → 取内核键名 `a`
    }
  }
  return out;
}

/** M9 判据：这段**剥注释后**的源码有没有直接消费内核对象（解构 / 成员访问）。 */
function directKernelAccess(code) {
  const destructure = /(?:const|let|var)\s*\{[^}]*\}\s*=\s*hostKernel\s*[;,]/.test(code);
  const member = /\bhostKernel\s*\.\s*[A-Za-z_$]/.test(code);
  return { destructure, member, violation: destructure || member };
}

/** 组件视图消费面：组件入口自己解构的键 + 会话从同一视图解构的键。 */
function viewConsumption(ownKeys, sessionKeys) {
  const uniq = (a) => [...new Set(a)].sort();
  return {
    own: uniq(ownKeys),
    session: uniq(sessionKeys),
    union: uniq([...ownKeys, ...sessionKeys]),
    overlap: uniq(ownKeys.filter((k) => sessionKeys.includes(k))),
  };
}

/** 键集相等（顺序无关、去重）。 */
function sameKeys(a, b) {
  const A = [...new Set(a)].sort();
  const B = [...new Set(b)].sort();
  return A.length === B.length && A.every((x, i) => x === B[i]);
}

/** teardown 四步的相对次序（返回各自 `indexOf`，未找到为 -1）。 */
function teardownOrder(code) {
  return ['for (const d of disposers)', 'stream.destroy()', 'activeStreams.clear()', 'mediaMap.clear()']
    .map((s) => code.indexOf(s));
}

/** teardown 四步必须**全部找到且严格递增**（同序实现 == 行为等价性的承重面）。 */
function teardownOrderOk(code) {
  const idx = teardownOrder(code);
  return idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1]));
}

/** 内部面暴露的**聚合**（生产扫描与负对照走同一份）：rows = `[{ name, declared, own }]`。 */
function internalExposure(rows, stableFace) {
  const stable = new Set(stableFace);
  let viewInternal = 0;
  let entryInternal = 0;
  const detail = [];
  for (const r of rows) {
    const vi = r.declared.filter((k) => !stable.has(k));
    const ei = r.own.filter((k) => !stable.has(k));
    viewInternal += vi.length;
    entryInternal += ei.length;
    detail.push(r.name + '：视图 ' + r.declared.length + ' 键（其中内部面 ' + vi.length + '）/ 入口自取 '
      + r.own.length + ' 键（其中内部面 ' + ei.length + '）');
  }
  return { viewInternal, entryInternal, detail };
}

/** 预算判据：值 ≤ 预算（正/负对照与生产共用）。 */
function withinBudget(value, budget) { return value <= budget; }

/** 内部面暴露预算（只减不增 —— 多暴露一个内部面键必须显式改这里 + 契约）。
 *  现值 = P2-7B 的 16 / 10 + 第三件组件"媒体桥入包"的**实测**增量 4 / 1（见文件头 ⑤）。 */
const VIEW_INTERNAL_BUDGET = 20;
const ENTRY_INTERNAL_BUDGET = 11;

// ── 生产读数 ───────────────────────────────────────────────────────────────────
// 三个模块路径一律**定位符号**（0 处 / 多处声明即红），不写死路径 —— 实现搬家时判据跟着走。
// ⚠️ 三处调用必须是**字面量** `locate('符号')`：`guard-targets.mjs` 的 G 类按文本认"这条守卫读了
//    哪个模块"，写成 `locate(symbol)`（变量）就解析不出，本守卫的模块覆盖会**静默消失**
//    （实测：改成变量实参后 guard-map 立刻报"零目标且未登记"）。内联包装函数只做断言与取值。
const anchorRel = (r) => {
  check('锚点：`' + r.symbol + '` 在 lib/** + src/** 里唯一声明（0 处 / 多处即红）', r.ok, r.detail);
  return r.ok ? r.hit.rel : null;
};
const HOST_BOOT_REL = anchorRel(locate('hostKernel'));
const HOST_KERNEL_REL = anchorRel(locate('KERNEL_STABLE_FACE'));
const SESSION_REL = anchorRel(locate('COMPONENT_VIEW_KEYS'));
const importRel = async (rel) => (rel ? import(pathToFileURL(join(ROOT, rel)).href) : {});

const kernelMod = await importRel(HOST_KERNEL_REL);
const hostBoot = await importRel(HOST_BOOT_REL);
const sessionMod = await importRel(SESSION_REL);

const COMPONENTS_DIR = 'lib/components';
/** 组件入口落点：未出户 = `lib/components/<k>/index.js`；已出户（P-F）= `packages/<k>/lib/index.js`。 */
function componentEntryRel(name) {
  for (const rel of [COMPONENTS_DIR + '/' + name + '/index.js', 'packages/' + name + '/lib/index.js']) {
    if (existsSync(join(ROOT, rel))) return rel;
  }
  return null;
}
/** `lib/components/` 下还剩哪些组件目录（出户是逐格搬的 ⇒ 迁移期内两种落点并存，判据两个方向都查）。
 *  P-F 三格全部出户后该目录**已不存在**（D-16：`visibility.js` 也搬去 `lib/component-visibility.js`）
 *  ⇒ 目录缺席 = 合法终态，返回空集；`existsSync` 是承重的（缺了会 ENOENT 崩在扫描而非判红）。 */
const legacyComponentDirs = existsSync(join(ROOT, COMPONENTS_DIR))
  ? readdirSync(join(ROOT, COMPONENTS_DIR), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
  : [];
// **组件清单的声明面真源 = 会话导出的 `COMPONENT_VIEW_KEYS`**（③ 要逐键对账的那一份），入口落点按
// 上面两种形态现解析。为什么不再从 `lib/components/` 反推：P-F 起组件行可以出户到 `packages/<k>/`，
// "组件"从此不是那个目录的同义词；而普通子包（fx / parallax / fonts）不在这份声明里 ⇒ 不会混进来。
const components = Object.keys(sessionMod.COMPONENT_VIEW_KEYS || {}).sort().map((name) => {
  const rel = componentEntryRel(name);
  return { name, rel, src: rel ? stripComments(readFileSync(join(ROOT, rel), 'utf8')) : '' };
});
// ② 的路由族扫描面 = `host-route-index` 的候选文件面**同一份真源**（`lib/routes/*.js` ∪
// `packages/<pkg>/lib/routes/*.js` ∪ 组件目录直接子文件）。写死 `lib/routes/` 会让随子包行出户的族
// **静默掉出** M9 面（P-A：fonts 两族已在 `packages/fonts/lib/routes/`）—— 与下方覆盖面判据同源。
const routeRels = routeModuleCandidates();
// 组件自己的实现文件面：未出户 = 目录下全部 `.js`（不只是 `index.js`；只认 `index.js` 会让那些
// 路由实现**静默脱离** M9 判据，§10 风险 12 的同款）；已出户 = `packages/<k>/lib/**` 递归。
function componentImplRelsOf(name) {
  const legacyDir = join(ROOT, COMPONENTS_DIR, name);
  if (existsSync(legacyDir)) {
    return readdirSync(legacyDir).filter((f) => f.endsWith('.js')).sort()
      .map((f) => COMPONENTS_DIR + '/' + name + '/' + f);
  }
  const out = [];
  const walk = (dir, rel) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.isDirectory()) walk(join(dir, e.name), rel + '/' + e.name);
      else if (e.name.endsWith('.js')) out.push(rel + '/' + e.name);
    }
  };
  walk(join(ROOT, 'packages', name, 'lib'), 'packages/' + name + '/lib');
  return out;
}
const componentImplRels = components.flatMap((c) => componentImplRelsOf(c.name));
const sessionSrc = SESSION_REL ? stripComments(readFileSync(join(ROOT, SESSION_REL), 'utf8')) : '';
/** 本文件自己的头注释 = ① 的合同数字唯一真源（读自己，判据才知道期望值）。 */
const FACE_CONTRACT = parseFaceContract(readFileSync(SELF, 'utf8'));

// ═══ ① 内核分级面机械复算（合同数字的唯一真源 = 本文件头那一行）════════════════════════
section('① 内核分级面机械复算（合同数字的唯一真源 = 本文件头那一行；期望值从那里现算）');
{
  // 缺锚即红：三份真源读不到时不许继续（否则"复算"会变成空对空）。
  check('锚点：门面导出 hostKernel 对象（缺锚即红）',
    Boolean(hostBoot.hostKernel) && typeof hostBoot.hostKernel === 'object' && Object.keys(hostBoot.hostKernel).length > 0,
    hostBoot.hostKernel ? Object.keys(hostBoot.hostKernel).length + ' 个键' : '**hostBoot.hostKernel 缺失**');
  check('锚点：内核导出非空数组 KERNEL_STABLE_FACE（缺锚即红）',
    Array.isArray(kernelMod.KERNEL_STABLE_FACE) && kernelMod.KERNEL_STABLE_FACE.length > 0,
    Array.isArray(kernelMod.KERNEL_STABLE_FACE) ? kernelMod.KERNEL_STABLE_FACE.length + ' 项' : '**KERNEL_STABLE_FACE 缺失**');
  check('锚点：本文件头写着合同数字那一行（它是 ① 的期望值唯一真源；缺锚即红）',
    FACE_CONTRACT !== null,
    FACE_CONTRACT ? JSON.stringify(FACE_CONTRACT) : '**文件头「合计 N / 稳定面 N / 稳定面 ∩ 内核 N / 内部面 N」那一行没了**');

  const kernelKeys = Object.keys(hostBoot.hostKernel || {});
  const stableFace = kernelMod.KERNEL_STABLE_FACE || [];
  const face = classifyFaces(kernelKeys, stableFace);

  check('KERNEL_STABLE_FACE 无重复（项数由合同那一行钉住：' + (FACE_CONTRACT ? FACE_CONTRACT.stableFace : '?') + '）',
    stableFace.length === new Set(stableFace).size && FACE_CONTRACT !== null && stableFace.length === FACE_CONTRACT.stableFace,
    stableFace.length + ' 项 / 去重后 ' + new Set(stableFace).size + ' 项');
  const bad = FACE_CONTRACT ? faceAgreement(face, FACE_CONTRACT) : ['合同锚点缺失'];
  check('内核实跑分级 == 文件头合同数字（合计 / 稳定面 / 稳定面 ∩ 内核 / 内部面 四项全对）',
    bad.length === 0,
    bad.length ? bad.join('；') : '合计 ' + face.total + ' / 稳定面 ' + face.stableFace + ' / 稳定面 ∩ 内核 '
      + face.stableOnKernel.length + ' / 内部面 ' + face.internal.length);

  // 负对照（**派生式**：期望值从实跑分级与合同那一行现算，不写死 96/89/87 —— 本会话实测
  // 内核从 95 长到 98 后，写死数字的负对照与主判据**一起**假红）。
  const phantom = classifyFaces([...kernelKeys, 'phantomKey'], stableFace);
  check('negative control ①a：多一个内核键 ⇒ 同一条 faceAgreement 判红（派生式，不写死数字）',
    faceAgreement(phantom, FACE_CONTRACT).length > 0
    && phantom.total === face.total + 1 && phantom.internal.length === face.internal.length + 1,
    faceAgreement(phantom, FACE_CONTRACT).join('；'));
  const firstInternal = face.internal[0];
  const widened = firstInternal ? classifyFaces(kernelKeys, [...stableFace, firstInternal]) : null;
  check('negative control ①b：把**实跑内部面里真实存在的键**误升进稳定面 ⇒ 判红（键名从实跑取，不写死 ABOUT_DIR）',
    Boolean(widened) && faceAgreement(widened, FACE_CONTRACT).length > 0
    && widened.stableOnKernel.length === face.stableOnKernel.length + 1
    && widened.internal.length === face.internal.length - 1,
    widened ? '升面键 = ' + firstInternal + ' ⇒ ' + faceAgreement(widened, FACE_CONTRACT).join('；') : '**内部面为空**');
  check('negative control ①c：合同那一行缺锚 ⇒ 同一条判据判红（解析失败不许静默取默认数字）',
    parseFaceContract('（这一行被删了）') === null
    && parseFaceContract('「合计 1 / 稳定面 2 / 稳定面 ∩ 内核 3 / 内部面 4」').total === 1
    && faceAgreement(face, { total: face.total + 1, stableFace: face.stableFace, stableOnKernel: face.stableOnKernel.length, internal: face.internal.length }).length === 1);
}

// ═══ ② 组件 / 路由族不得直接消费内核对象（M9 → 0）══════════════════════════════════
section('② 组件与路由族不得直接消费内核对象（`const { … } = hostKernel` / `hostKernel.<键>`，M9 → 0）');
{
  const scanned = [
    ...componentImplRels.map((rel) => ({ rel, code: stripComments(readFileSync(join(ROOT, rel), 'utf8')) })),
    ...routeRels.map((rel) => ({ rel, code: stripComments(readFileSync(join(ROOT, rel), 'utf8')) })),
  ];
  const scannedSet = new Set(scanned.map((f) => f.rel));
  const offenders = scanned.filter((f) => directKernelAccess(f.code).violation).map((f) => f.rel);
  // 覆盖面：**对账真源**（`host-route-index` 的候选文件面 = `lib/routes/*.js` ∪ 组件目录直接子文件），
  // 而不是写死"≥15 个路由族"这种随实现漂的数字 —— 扫描面一窄，这里就点名少了哪个文件。
  const candidates = routeModuleCandidates();
  const missed = candidates.filter((rel) => !scannedSet.has(rel));
  // 「多扫」= 扫到了既不是路由族候选、也不属于任何**已声明组件**落点的文件。出户后组件的入口与
  // 支持模块（`packages/<k>/lib/**`）不落在路由候选面里（候选面只收 `lib/routes/*.js` 与
  // `packages/<p>/lib/routes/*.js`），但它们仍是组件实现文件 ⇒ 按组件落点前缀放行；组件名一改、
  // walker 走错目录、或某文件被扫出组件面之外 ⇒ 这里点名。
  const compPrefixes = components.map((c) => (c.rel ? c.rel.replace(/\/[^/]+$/, '/') : null)).filter(Boolean);
  for (const d of legacyComponentDirs) compPrefixes.push(COMPONENTS_DIR + '/' + d + '/');
  const extra = [...scannedSet].filter((rel) => !candidates.includes(rel) && !compPrefixes.some((p) => rel.startsWith(p)));
  check('覆盖面：② 的扫描面覆盖全部路由族候选 + 每个组件的全部实现文件（入口 + 族；少扫/多扫都点名）',
    candidates.length > 0 && missed.length === 0 && extra.length === 0
    && components.every((c) => scannedSet.has(c.rel)),
    '候选 ' + candidates.length + ' 个' + (missed.length ? ' · 漏扫 ' + missed.join(' ') : '')
      + (extra.length ? ' · 多扫 ' + extra.join(' ') : '') + ' · 组件实现 ' + componentImplRels.length + ' 个 .js');
  // negative control：把扫描面塌回**出户前**的形态（`lib/routes/*.js` + 仍住在 `lib/components/` 的
  // 组件目录）⇒ 随子包行出户的族必须被**同一条**覆盖面判据点名（否则"覆盖面对账"只是把当前文件数
  // 复述一遍，没有牙）。⚠️ P-F 起不能用 `componentImplRels` 当"窄面"的那一半：出户组件的族已经在
  // `packages/` 下，把它算进窄面会让这个负对照**恒绿**（塌陷实验自己把出户的族也覆盖了）。
  const pkgRouteRels = candidates.filter((rel) => rel.startsWith('packages/'));
  const legacyImplRels = components.filter((c) => c.rel && c.rel.startsWith(COMPONENTS_DIR + '/'))
    .flatMap((c) => componentImplRelsOf(c.name));
  const narrowedSet = new Set([...routeRels.filter((rel) => rel.startsWith('lib/routes/')), ...legacyImplRels]);
  const missedNarrowed = candidates.filter((rel) => !narrowedSet.has(rel));
  check('negative control：扫描面塌回 `lib/routes/`-only ⇒ 子包路由族被同一条判据点名',
    pkgRouteRels.length > 0 && missedNarrowed.join() === pkgRouteRels.join(),
    '塌陷后面外 = ' + (missedNarrowed.join(' ') || '（一个都没点名）') + ' · 子包族 = ' + pkgRouteRels.join(' '));
  check('覆盖面：每个组件的入口落点都在 `MAIN_MODULES` 真源里（行入口清单数据驱动，双向对账）',
    components.length > 0 && components.every((c) => MAIN_MODULES.includes(c.rel)),
    '组件 ' + components.map((c) => c.name + '→' + c.rel).join(' ') + ' ⇄ 行入口 ' + MAIN_MODULES.join(' '));
  check('反向：`lib/components/*` 剩下的目录都已声明、每条声明的入口都在盘（迁移期内两种落点各查一次）',
    legacyComponentDirs.every((d) => components.some((c) => c.name === d))
    && components.every((c) => Boolean(c.rel)),
    'lib/components/=[' + (legacyComponentDirs.join(' ') || '（空）') + '] · 解析不到入口的声明=['
      + (components.filter((c) => !c.rel).map((c) => c.name).join(' ') || '无') + ']');
  check('零处直接解构 / 成员访问 hostKernel（M9 = 0）', offenders.length === 0,
    offenders.length ? '直接消费内核对象：' + offenders.join(' ') : '组件 ' + components.map((c) => c.name).join(' ') + ' 与全部路由族都只消费声明面');

  // 负对照：判据函数本身必须能判出两种直接消费形态，且不误伤视图写法。
  check('负对照：`const { ABOUT_DIR } = hostKernel;` 被判出', directKernelAccess('const { ABOUT_DIR } = hostKernel;').violation === true);
  check('负对照：`hostKernel.mascotDir` 成员访问被判出', directKernelAccess('const x = hostKernel.mascotDir;').violation === true);
  check('正对照：`const { ABOUT_DIR } = view;` 不算违规（判据不恒真）',
    directKernelAccess('const { ABOUT_DIR } = view;').violation === false
    && directKernelAccess("const v = componentViewFrom(hostKernel, 'about-notice');").violation === false);
}

// ═══ ③ 组件视图：声明面 ↔ 实际消费面逐键相等（双向）═══════════════════════════════
section('③ 组件视图声明面 ↔ 实际消费面逐键相等（双向；缺键即抛）');
{
  const declaredKeySet = sessionMod.COMPONENT_VIEW_KEYS || {};
  const sessionKeys = destructuredFrom(sessionSrc, 'view');
  // 缺锚即红：这两份声明面读不到时，下面的"逐键相等"会退化成空对空。
  check('锚点：会话导出 COMPONENT_VIEW_KEYS（非空对象）与 SESSION_SERVE_KEYS（非空数组）（缺锚即红）',
    Object.keys(declaredKeySet).length > 0 && Array.isArray(sessionMod.SESSION_SERVE_KEYS)
    && sessionMod.SESSION_SERVE_KEYS.length > 0 && sessionKeys.length > 0,
    '声明面 ' + Object.keys(declaredKeySet).length + ' 个组件 · SESSION_SERVE_KEYS '
      + (Array.isArray(sessionMod.SESSION_SERVE_KEYS) ? sessionMod.SESSION_SERVE_KEYS.length : '**缺**') + ' 项 · view 解构 ' + sessionKeys.length + ' 项');
  check('会话从视图自取的 serve 依赖键 == SESSION_SERVE_KEYS（单一真源不漂移）',
    sameKeys(sessionKeys, sessionMod.SESSION_SERVE_KEYS || []),
    'view 解构 = [' + sessionKeys.join(',') + ']');
  // P-F：组件清单由 `COMPONENT_VIEW_KEYS` 现解析（组件可以出户到 `packages/<k>/`），所以这条不再
  // "从目录反推声明"，而是钉**两个方向都有牙**的实事：每条声明都解析到在盘入口（缺 = 死声明）、
  // `lib/components/` 下剩下的目录不能有未声明的（漏声明）。
  check('组件声明面 ⇄ 落点一一对应（每条声明都有在盘入口；`lib/components/` 下无未登记组件）',
    components.length > 0 && components.every((c) => Boolean(c.rel))
    && legacyComponentDirs.every((d) => Object.keys(declaredKeySet).includes(d)),
    '声明 ' + Object.keys(declaredKeySet).join(' ') + ' · 解析不到入口 ['
      + (components.filter((c) => !c.rel).map((c) => c.name).join(' ') || '无') + '] · 未登记目录 ['
      + (legacyComponentDirs.filter((d) => !Object.keys(declaredKeySet).includes(d)).join(' ') || '无') + ']');

  const issues = [];
  const rows = [];
  for (const c of components) {
    const declared = declaredKeySet[c.name];
    if (!declared) { issues.push(c.name + ' 没有视图声明'); continue; }
    // 两种取视图形态：未出户 = `componentViewFrom(hostKernel, '<name>')`（直取主包符号）；
    // 已出户（P-F）= 经宿主服务拿到**已绑 hostKernel** 的那个 `componentViewFrom('<name>')`，
    // 组件半边此时**拿不到 `hostKernel`**（零主包说明符），所以单实参形态必须被认。
    const call = /componentViewFrom\(\s*(?:hostKernel\s*,\s*)?'([^']+)'\s*\)/.exec(c.src);
    if (!call) { issues.push(c.name + ' 入口没有 componentViewFrom([hostKernel, ]…)'); continue; }
    if (call[1] !== c.name) issues.push(c.name + ' 取的视图名却是 ' + call[1]);
    const own = destructuredFrom(c.src, 'view');
    const cons = viewConsumption(own, sessionKeys);
    if (cons.overlap.length) issues.push(c.name + ' 组件与会话重复消费：' + cons.overlap.join(','));
    if (!sameKeys(cons.union, declared)) {
      issues.push(c.name + ' 声明 ≠ 消费：声明=[' + [...declared].join(',') + '] 消费=[' + cons.union.join(',') + ']');
    }
    // 真取一次视图：键集必须与声明逐键相等；内核缺键 ⇒ 这里抛（响亮报错，不静默 undefined）。
    let view = null;
    try { view = sessionMod.componentViewFrom(hostBoot.hostKernel, c.name); } catch (e) { issues.push(c.name + ' 取视图抛错：' + e.message); }
    if (view && !sameKeys(Object.keys(view), declared)) {
      issues.push(c.name + ' 视图实取键集 ≠ 声明：[' + Object.keys(view).join(',') + ']');
    }
    rows.push(c.name + ' 声明 ' + declared.length + ' = 入口自取 ' + own.length + ' + 会话自取 ' + sessionKeys.length);
  }
  check('每个组件的「声明键集 == 入口解构 ∪ 会话解构」且视图实取一致（声明与实现双向对账）',
    issues.length === 0, issues.join('；') || rows.join(' · '));

  // 负对照：**派生式** —— 拿磁盘上第一个组件的**真实声明键集**当基准，往两个方向各做一次变异。
  // ⚠️ 原先这里写的是 `sameKeys(viewConsumption(['ABOUT_DIR','mascotDir'], sessionKeys).union, declaredAbout)`，
  //    其中 `declaredAbout = declaredKeySet['about-notice'] || []` —— 组名一改 / 声明面一搬，
  //    它静默变成 `[]`，而"任何非空消费集 ≠ 空集"**恒真** ⇒ 负对照永远不会红（假牙）。
  //    现在：基准从 `components[0]` 取，且先断言它是**非空**的（缺锚即红）。
  const probeComp = components[0];
  const declaredProbe = probeComp ? (declaredKeySet[probeComp.name] || []) : [];
  check('负对照的锚点自检：负对照基准组件有**非空**声明键集（否则下面的比较是恒真式）',
    Boolean(probeComp) && declaredProbe.length > 0,
    probeComp ? probeComp.name + ' ⇒ ' + declaredProbe.length + ' 键' : '**一个组件都没有**');
  const moreThanDeclared = [...declaredProbe, 'phantomInternalKey'];
  const lessThanDeclared = declaredProbe.slice(1);
  check('负对照：消费比声明**多**一个键（内部面键没写进声明面）⇒ 同一条判据判不相等',
    declaredProbe.length > 0 && sameKeys(viewConsumption(moreThanDeclared, []).union, declaredProbe) === false,
    '消费=[' + viewConsumption(moreThanDeclared, []).union.join(',') + ']');
  check('负对照：消费比声明**少**一个键（声明了没人消费 / 漏声明两个方向都有牙）⇒ 同一条判据判不相等',
    sameKeys(viewConsumption(lessThanDeclared, []).union, declaredProbe) === false,
    '消费=[' + viewConsumption(lessThanDeclared, []).union.join(',') + ']');
  check('正对照：消费**恰好等于**声明 ⇒ 同一条判据判相等（判据不是恒假）',
    declaredProbe.length > 0 && sameKeys(viewConsumption(declaredProbe, []).union, declaredProbe) === true);
}

// ═══ ④ 入口姿势与 teardown 姿势不变（P2-5C / P2-6）═══════════════════════════════
section('④ 入口姿势与 teardown 姿势不变（inject + 直读 / handOffTeardown / 不 acquireKernelLease / 同序 teardown）');
{
  // 入口姿势两种形态（P-F 迁移窗口内并存）：
  //   · 未出户 = `inject = ['webServer']` + `handOffTeardown(ctx, runComponent(…))`（直取主包符号）
  //   · 已出户 = `inject = ['webServer', 'wallpaperEngineHost']` + `keys.handOffTeardown(ctx, keys.runComponent(…))`
  //     （经宿主服务的冻结键表；姿势不变 —— 仍然是"先注入再直读 + teardown 交 fiber"）
  const postureOffenders = components.filter((c) => !(
    /export const inject = \['webServer'(?:,\s*'wallpaperEngineHost')?\]/.test(c.src)
    && /export function apply\s*\(/.test(c.src)
    && (/(?:^|[^.\w])handOffTeardown\(ctx,\s*runComponent\(/.test(c.src)
      || /[A-Za-z_$][\w$]*\.handOffTeardown\(ctx,\s*[A-Za-z_$][\w$]*\.runComponent\(/.test(c.src))
  )).map((c) => c.rel);
  check('组件入口仍是 inject = [\'webServer\'(, \'wallpaperEngineHost\')?] + export function apply + handOffTeardown(ctx, runComponent(…))',
    postureOffenders.length === 0, postureOffenders.join(' ') || components.map((c) => c.name).join(' '));

  check('组件会话不 acquire / release 内核租约（"只有静态读写、无可释放共享资源"的有意不对称保留）',
    !/acquireKernelLease|releaseKernelLease/.test(sessionSrc), '零处租约调用');

  check('组件会话 teardown 四步次序与两处原实现逐字同序（disposers → destroy → 清 activeStreams → 清 mediaMap）',
    teardownOrderOk(sessionSrc), '位置 = ' + teardownOrder(sessionSrc).join(','));

  check('负对照：teardown 次序被打乱 ⇒ 判据红',
    teardownOrderOk('for (const d of disposers) {} mediaMap.clear(); activeStreams.clear(); stream.destroy();') === false);
  check('正对照：同序文本 ⇒ 判据绿（判据不是恒真/恒假）',
    teardownOrderOk('for (const d of disposers) {} stream.destroy(); activeStreams.clear(); mediaMap.clear();') === true);
}

// ═══ ⑤ 内部面暴露预算（只减不增）+ 键数台账 ═══════════════════════════════════════
section('⑤ 内部面暴露预算（只减不增）与键数台账');
{
  const stable = kernelMod.KERNEL_STABLE_FACE || [];
  const rows = components.map((c) => ({
    name: c.name,
    declared: sessionMod.COMPONENT_VIEW_KEYS[c.name] || [],
    own: destructuredFrom(c.src, 'view'),
  }));
  const exposure = internalExposure(rows, stable);
  check('组件视图暴露的内部面键总数 ≤ ' + VIEW_INTERNAL_BUDGET + '（合同值，只减不增；实测 ' + exposure.viewInternal + '）',
    withinBudget(exposure.viewInternal, VIEW_INTERNAL_BUDGET), '内部面 ' + exposure.viewInternal + ' 键');
  check('组件入口自己解构的内部面键总数 ≤ ' + ENTRY_INTERNAL_BUDGET + '（合同值，只减不增；实测 ' + exposure.entryInternal + '）',
    withinBudget(exposure.entryInternal, ENTRY_INTERNAL_BUDGET), '内部面 ' + exposure.entryInternal + ' 键');
  // 负对照：合成一个**超预算**的组件，喂给**同一条聚合函数**（不再是 `21 > 20` 这种纯算术复述 ——
  // 那种写法只复述了预算表，聚合函数写错它也照样绿）。
  const synthStable = ['qs1', 'qs2'];
  const synth = (n, prefix) => [...synthStable, ...Array.from({ length: n }, (_, i) => prefix + i)];
  const over = internalExposure([
    { name: 'qz-over', declared: synth(VIEW_INTERNAL_BUDGET + 1, 'v'), own: synth(ENTRY_INTERNAL_BUDGET + 1, 'e') },
  ], synthStable);
  const onBudget = internalExposure([
    { name: 'qz-ok', declared: synth(VIEW_INTERNAL_BUDGET, 'v'), own: synth(ENTRY_INTERNAL_BUDGET, 'e') },
  ], synthStable);
  check('negative control：合成超预算组件（视图 ' + (VIEW_INTERNAL_BUDGET + 1) + ' / 入口 ' + (ENTRY_INTERNAL_BUDGET + 1)
    + ' 个内部面键）经**同一条聚合** ⇒ 超预算判红',
    withinBudget(over.viewInternal, VIEW_INTERNAL_BUDGET) === false
    && withinBudget(over.entryInternal, ENTRY_INTERNAL_BUDGET) === false,
    '聚合得 视图 ' + over.viewInternal + ' / 入口 ' + over.entryInternal);
  check('正对照：合成恰好等于预算的组件 ⇒ 同一条聚合判合格（预算判据不是恒假）',
    withinBudget(onBudget.viewInternal, VIEW_INTERNAL_BUDGET) === true
    && withinBudget(onBudget.entryInternal, ENTRY_INTERNAL_BUDGET) === true,
    '聚合得 视图 ' + onBudget.viewInternal + ' / 入口 ' + onBudget.entryInternal);
  console.log('  · 台账：' + exposure.detail.join(' · '));
}

console.log('');
if (failed) {
  console.log('COMPONENT FACE CHECKS FAILED — ' + failed + ' failed');
  process.exit(1);
}
console.log('ALL COMPONENT FACE CHECKS PASSED');
process.exit(0);
