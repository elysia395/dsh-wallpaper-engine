#!/usr/bin/env node
/**
 * compat-harness-surfaces.mjs —— harness UI 面清单棘轮 + sidebar 源码活判据
 *（compat 层：需要已安装的 `@deepseek-ai/dsh`；由 `.github/workflows/harness-compat.yml`
 *   在装好目标版本 harness 后调用，本地可手动跑，见 docs/DEV-GUIDE.md。）
 *
 * 回答的问题：**harness 新增了页面/表面，我们的美化没覆盖** —— 插件自指断言查不出这类
 * 回归，必须把 harness 侧事实拉进判据：
 *
 *   ① **清单棘轮**：枚举已装 harness 的 `dsh-client-ui-*` 包集（harness 每个 UI 表面
 *      基本是一个独立包），与提交清单 `test/fixtures/harness-ui-surfaces.json`（每项带
 *      人的裁定 verdict）做差。**新表面未登记 ⇒ 红** —— 机器只判「新东西出现了」，
 *      盖不盖由人裁定，但裁定必须落盘；改名会被这条抓到（新名未登记），纯删除不拦。
 *      已知边界：包没变、包内新增页面这种情况本条查不出（页面级快照属下一档）。
 *
 *   ② **sidebar 活判据**：我们的 CSS 有 25 处选择器直接钉着
 *      `data-sidebar-right-panel` / `data-sidebar-right-open`，以及「收起时面板仍挂载、
 *      translate 滑出」的隐藏机制 —— 这些必须在**实际安装的源码**里仍然存在。
 *      上游 issue #107 那类回归（隐藏机制换代 ⇒ 美化失效）在此从注释里的散文引用
 *      变成对真源码的活断言。
 *
 * 缺前置（找不到已装 harness）= **默认红**（P3-13 口径，不与「通过」同形）：
 * 用 `DSH_WE_HARNESS_ROOT` 指定 dsh 包目录可绕过自动探测。
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const INVENTORY = join(ROOT, 'test', 'fixtures', 'harness-ui-surfaces.json');
const SURFACE_PREFIX = 'dsh-client-ui-';

// 我们 CSS 依赖的 sidebar 隐藏机制标记：容器 `translate(100%)` 滑出，或子元素
// `visibility:hidden`（上游 #107）。两条都不在 = 隐藏机制换代 ⇒ 红。
const HIDE_MARKERS = ['translate(100%)', 'visibility:hidden', 'visibility: hidden'];

// 面板锚点：这两个属性是**面板专属**，只有它们能证明一条规则属于右栏面板。
const PANEL_ANCHORS = ['data-sidebar-right-panel', 'data-sidebar-right-open'];

// 只认「赋值号后面的双引号串」为 CSS 文本（上游把 module.css 内联成 const css = "..."）。
// 不这么切、直接在 JS 源码上找 `{`/`}`，会被 JS 自己的对象字面量与模板串带偏（实测会算错选择器）。
const cssBlobsIn = (src) => {
  const blobs = [];
  for (const m of src.matchAll(/=\s*"((?:\\.|[^"\\])*)"/gs)) {
    const text = m[1].replace(/\\(.)/g, '$1');
    if (text.includes('{') && text.includes('}')) blobs.push(text);
  }
  return blobs;
};

// 把 CSS 文本切成 { selector, body }（按 `{`/`}` 配平，兼容 @media 嵌套）。
const cssRulesIn = (src) => {
  const rules = [];
  for (const text of cssBlobsIn(src)) {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open === -1) break;
      const prelude = text.slice(text.lastIndexOf('}', open) + 1, open);
      const selector = prelude.slice(prelude.lastIndexOf(';') + 1).trim();
      let depth = 1, j = open + 1;
      while (j < text.length && depth > 0) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++; }
      if (selector) rules.push({ selector, body: text.slice(open + 1, j - 1) });
      i = j;
    }
  }
  return rules;
};

const classesIn = (selector) => [...selector.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((c) => c[1]);

// 标记是否出现在**面板作用域**的规则里：选择器直接点名面板锚点，或与锚点规则共用同一个 CSS-module
// 类（上游隐藏规则写的是 `.JRZOga_panel [data-dockkit-host=dock]`，不含属性字面量；只有面板容器规则
// `.JRZOga_panel[data-sidebar-right-open]` 才点名锚点 ⇒ 必须两段合起来判）。
const hideMechanismIn = (src, markers) => {
  const rules = cssRulesIn(src);
  const panelClasses = new Set();
  for (const r of rules) {
    if (PANEL_ANCHORS.some((a) => r.selector.includes(a))) for (const c of classesIn(r.selector)) panelClasses.add(c);
  }
  const scoped = rules.filter((r) => PANEL_ANCHORS.some((a) => r.selector.includes(a))
    || classesIn(r.selector).some((c) => panelClasses.has(c)));
  return markers.filter((m) => scoped.some((r) => r.body.includes(m)));
};

const results = [];
function check(name, ok, detail) {
  results.push(Boolean(ok));
  console.log((ok ? '✓ ' : '✗ ') + name + (detail ? ' — ' + detail : ''));
  return Boolean(ok);
}

function walkJs(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walkJs(p, out);
    else if (ent.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/** 收集一棵子树里所有 `dsh-client-ui-*` 包目录（按包名取集合，去重）。 */
function collectSurfaces(searchRoots) {
  const found = new Map(); // name -> 任一所在路径
  const visit = (dir, depth) => {
    if (!existsSync(dir) || depth > 12) return;
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      if (ent.name.startsWith(SURFACE_PREFIX) && !ent.name.startsWith('.')) {
        if (!found.has(ent.name)) found.set(ent.name, join(dir, ent.name));
      } else if (ent.name === 'node_modules' || ent.name === '@deepseek-ai' || !found.size) {
        visit(join(dir, ent.name), depth + 1);
      }
    }
  };
  for (const r of searchRoots) visit(r, 0);
  return found;
}

function resolveHarnessPkg() {
  const explicit = process.env.DSH_WE_HARNESS_ROOT;
  if (explicit) return explicit;
  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return join(globalRoot, '@deepseek-ai', 'dsh');
  } catch (err) {
    return null;
  }
}

// ── 前置：找到已装 harness（找不到 = 红，不静默跳过）───────────────────────────
const harnessPkg = resolveHarnessPkg();
const harnessOk = Boolean(harnessPkg) && existsSync(join(harnessPkg, 'package.json'));
let harnessVersion = '?';
if (harnessOk) {
  try { harnessVersion = JSON.parse(readFileSync(join(harnessPkg, 'package.json'), 'utf8')).version || '?'; } catch { /* 下面的判据会红 */ }
}
if (!check('已装 harness 可定位（DSH_WE_HARNESS_ROOT 或 npm 全局）', harnessOk,
  harnessOk ? `${harnessPkg} @ ${harnessVersion}` : '找不到 @deepseek-ai/dsh —— 装一个或设 DSH_WE_HARNESS_ROOT')) {
  console.log(`\nHARNESS SURFACES FAILED — ${results.filter((ok) => !ok).length}/${results.length} 条判据不成立`);
  process.exit(1);
}

// ── ① 清单棘轮 ────────────────────────────────────────────────────────────────
let inventory = null;
try { inventory = JSON.parse(readFileSync(INVENTORY, 'utf8')); } catch { inventory = null; }
const known = inventory && typeof inventory.known === 'object' && inventory.known ? inventory.known : {};
const inventoryOk = check('提交清单可解析且非空（known 表是裁定的唯一真源）',
  Object.keys(known).length > 0 && inventory.meta && typeof inventory.meta.seededFrom === 'string',
  INVENTORY);
if (inventoryOk) {
  const badKeys = Object.keys(known).filter((k) => !k.startsWith(SURFACE_PREFIX));
  check('清单键全部是 dsh-client-ui-* 表面（命名空间写错 = 那条裁定永不生效）',
    badKeys.length === 0, badKeys.length ? '越界键：' + badKeys.join(', ') : Object.keys(known).length + ' 个键');
  const badVerdicts = Object.entries(known)
    .filter(([, v]) => !v || !['covered', 'native', 'exempt'].includes(v.verdict));
  check('每个裁定都带合法 verdict（covered / native / exempt）',
    badVerdicts.length === 0, badVerdicts.length ? '非法项：' + badVerdicts.map(([k]) => k).join(', ') : '全部合法');
}

// 两个搜索根覆盖 npm 的两种布局：依赖**嵌套**在 dsh 包内（全局安装的常态）时看 root1；
// 依赖被**提升**成兄弟目录（npm --prefix / CI 缓存安装）时看 root2（dsh 所在的 scope 目录）。
const surfaces = collectSurfaces([join(harnessPkg, 'node_modules'), join(harnessPkg, '..')]);
check('已装 harness 里能枚举到 UI 表面（枚举器空转 = 判据失效）',
  surfaces.size >= 10, surfaces.size + ' 个 dsh-client-ui-* 包');

const newSurfaces = [...surfaces.keys()].filter((s) => !(s in known)).sort();
check('没有未登记的新 UI 表面（新表面必须显式裁定：补美化或写豁免）',
  inventoryOk && surfaces.size >= 10 && newSurfaces.length === 0,
  newSurfaces.length ? '未登记：' + newSurfaces.join(', ') : '清单已覆盖全部 ' + surfaces.size + ' 个');
const stale = Object.keys(known).filter((s) => !surfaces.has(s));
if (stale.length) {
  console.log('  ℹ️ 清单里有 ' + stale.length + ' 个表面不在本机已装 harness（版本差集：本机 harness 较旧或上游已删/改名；改名会以「新表面未登记」被抓到）：'
    + stale.slice(0, 6).join(', ') + (stale.length > 6 ? ' …' : ''));
}

// ── ② sidebar 源码活判据（对真源码，不是散文引用）─────────────────────────────
const sidebarDir = surfaces.get(SURFACE_PREFIX + 'sidebar-right');
if (check('dsh-client-ui-sidebar-right 在已装 harness 中（我们 25 处选择器依赖它）',
  Boolean(sidebarDir), sidebarDir || '包缺失 —— 右栏美化所依赖的表面不存在了')) {
  const src = walkJs(sidebarDir).map((f) => readFileSync(f, 'utf8')).join('\n');
  check('属性锚点 data-sidebar-right-panel 仍在源码中（CSS 选择器直接钉它）',
    src.includes('data-sidebar-right-panel'));
  check('属性锚点 data-sidebar-right-open 仍在源码中（开合态选择器直接钉它）',
    src.includes('data-sidebar-right-open'));
  // 口径：标记必须落在**面板作用域**的规则里才算命中 —— 出现在无关规则里的同名标记
  // （如分隔线 / 提示框自己的 visibility:hidden）不能算命中。
  const mechanism = hideMechanismIn(src, HIDE_MARKERS);
  check('隐藏机制仍是已知形态之一（translate 滑出 / visibility 切换；都不在 = 机制换代）',
    mechanism.length > 0, mechanism.length ? '命中：' + mechanism.join(' + ')
      : '已知标记全不在 —— 上游换了隐藏机制，美化适配需复核（#107 型回归）');
}

// ── ③ 接口棘轮：我们依赖的令牌 / 锚点 / 槽名必须仍存在于已装 harness ──────────────
// 为什么单开这一组：①② 回答的是"有哪些面、某个面的锚点在不在"，而**我们到底钉了哪些接口**
// 散在 src/** 里（设计令牌、数据属性、类名后缀、槽名）。宿主改掉一个令牌名或槽名，①② 都不会响。
// 口径三条：
//   · 依赖清单**从我们自己的源码抽**（不手抄 ⇒ 不会与实现漂移）；
//   · 逐条在已装 harness 的 **UI 表面包**的 JS 里找（设计令牌由 dsh-client-ui-theme 定义、
//     各面包消费 ⇒ 表面包这一层足够；找不到 = 红）；
//   · **第三方**接口（better-sidebar / dsh-webui / 桌面壳 URL 参数）走台账 `interfaces.exempt`
//     豁免，且必须写明理由 —— 豁免是**需要人复核的裁定**，不是静默跳过。
const ifaceLedger = inventory && inventory.interfaces ? inventory.interfaces : null;
const exemptRules = Array.isArray(ifaceLedger && ifaceLedger.exempt) ? ifaceLedger.exempt : [];
const exemptHit = new Set();   // 存**实际被豁免的依赖名**（不是命中的规则名）：一条宽规则可以豁免 74 项，
// 而 exemptHit.size 若只数规则，就是拿代理计数 ⇒ 加宽一条规则照样过（B2）。下面第二条地板数的是项。
const isExempt = (name) => {
  for (const rule of exemptRules) {
    if (!rule || typeof rule.match !== 'string') continue;
    if (new RegExp(rule.match).test(name)) { exemptHit.add(name); return rule; }
  }
  return null;
};
if (check('台账带 interfaces 豁免表（第三方接口不许静默混进棘轮）',
  Boolean(ifaceLedger) && exemptRules.length > 0 && exemptRules.every((r) => r.why && r.why.length > 10),
  ifaceLedger ? exemptRules.length + ' 条豁免（每条都写了理由）' : '缺 interfaces 段')) {
  // 依赖清单：从 src/** 抽（含 CSS 与 JS；lib/client.js 是产物，跳过）
  const ourSrc = walkJs(join(ROOT, 'src')).map((f) => readFileSync(f, 'utf8')).join('\n');
  // ⚠️ 两类**不能进清单**的东西（否则是假红）：
  //   · 我们自己写的属性：`data-we-*`（玻璃门控）、`data-webwallgl-gl`（渲染页画布标记）、
  //     `data-plugin-css`（我们自己那块 <style> 的标记）；
  //   · **动态拼名**的令牌前缀（源码里写成 `--dsw-font-${x}` 这种，末尾带 `-`）——
  //     它们没有确定的名字，逐个当接口去查必然查不到。
  const OURS_PREFIX = /^data-we-|^data-webwallgl-|^data-plugin-css$/;
  // ⚠️ `concrete` 还挡掉两类非接口：**动态拼名前缀**（末尾 `-`）与**注释里引用的写法**
  //    （形如 `data-slot="<slotKey>"` —— 那是我们在注释里解释宿主怎么写的，不是我们钉的值）。
  //    真实接口名不会含 `<>{}` 这类字符。
  const concrete = (n) => n.length > 4 && !n.endsWith('-') && !/[<>{}]/.test(n);
  const tokens = [...new Set([...ourSrc.matchAll(/--dsw-[a-z0-9-]+/g)].map((m) => m[0]))].filter(concrete).sort();
  const attrs = [...new Set([...ourSrc.matchAll(/\[(data-[a-z0-9-]+)/g)].map((m) => m[1]))]
    .filter((a) => !OURS_PREFIX.test(a) && concrete(a)).sort();
  const suffixes = [...new Set([...ourSrc.matchAll(/\[class\*="(_[A-Za-z0-9]+)"\]/g)].map((m) => m[1]))]
    .filter(concrete).sort();
  const slots = [...new Set([...ourSrc.matchAll(/data-slot="([^"]+)"/g)].map((m) => m[1]))]
    .filter(concrete).sort();
  // 已装 harness 的 UI 表面源码（一次读完，逐条 includes 判定）
  const harnessSrc = [...surfaces.values()].flatMap((dir) => walkJs(dir))
    .filter((f) => { try { return statSync(f).size < 8 * 1024 * 1024; } catch { return false; } })
    .map((f) => readFileSync(f, 'utf8')).join('\n');
  const hunt = (list, label, needleOf) => {
    const miss = list.filter((n) => !isExempt(n) && !harnessSrc.includes(needleOf(n)));
    return check('我们依赖的' + label + '仍存在于已装 harness（' + list.length + ' 项）',
      list.length >= 3 && miss.length === 0,
      miss.length ? '已消失：' + miss.join(', ') : list.length + ' 项全部命中');
  };
  hunt(tokens, '设计令牌', (n) => n);
  hunt(attrs, '数据属性锚点', (n) => n);
  hunt(suffixes, '类名后缀锚点', (n) => n);
  // 槽名要按**调用形状**找（值本身在多处出现，裸子串会把普通字符串算成槽）
  const slotShapes = (n) => [`renderSlot("${n}")`, `renderSlotChain("${n}")`, `entriesOf("${n}")`,
    `slotKey: "${n}"`, `registerSlot("${n}")`, `slots.register("${n}")`].some((s) => harnessSrc.includes(s));
  const slotMiss = slots.filter((n) => !isExempt(n) && !slotShapes(n));
  check('我们钉的槽名仍是宿主槽（按调用形状判定；' + slots.length + ' 个）',
    slots.length >= 1 && slotMiss.length === 0,
    slotMiss.length ? '不再是槽：' + slotMiss.join(', ') : slots.join(', ') + ' 全部仍是槽名');
  // 负面自检：豁免表若把**所有**依赖都豁免掉，这一组就退化成恒真 —— 必须留下非豁免项。
  // 地板按**被豁免的项**（exemptHit 存的是依赖名）从实际清单里减，不能拿"命中了 N 条规则"当代理：
  // 加宽一条规则就能豁免几十项，规则计数不变、清单其实已空转。
  const exemptNames = new Set([...tokens, ...attrs, ...suffixes, ...slots].filter((n) => isExempt(n)));
  check('覆盖面：接口棘轮的非豁免项足够多（防空转）',
    tokens.length + attrs.length + suffixes.length + slots.length - exemptNames.size >= 20,
    '非豁免接口 ' + (tokens.length + attrs.length + suffixes.length + slots.length - exemptNames.size) + ' 项'
      + '（豁免 ' + exemptNames.size + ' 项 / 规则 ' + exemptRules.length + ' 条）');
}

const failed = results.filter((ok) => !ok).length;
if (failed) console.log(`\nHARNESS SURFACES FAILED — ${failed}/${results.length} 条判据不成立`);
else console.log(`\nHARNESS SURFACES PASSED — ${results.length} 条判据全部成立（harness ${harnessVersion}，表面 ${surfaces.size} 个）`);
process.exit(failed ? 1 : 0);
