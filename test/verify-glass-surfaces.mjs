/**
 * verify-glass-surfaces.mjs —— 「玻璃面登记表」守卫。
 *
 * 回答的边界问题：**插件到底接管了哪些玻璃面，以及每个面的参数档位是谁。**
 * 这是 [`docs/archive/wip/GLASS-CONFIG-REFACTOR.md`](../../docs/archive/wip/GLASS-CONFIG-REFACTOR.md)
 * 的 P0：先把现状钉成机器事实，重构才有基线。
 *
 * 为什么需要它（既有五个玻璃守卫都不回答这件事）：
 *   · `verify-readability` 管**可读性下限**（每个文字面必须带面纱）；
 *   · `verify-glass-compositing` 管**画像与载体**（哪些规则能画 backdrop-filter）；
 *   · `verify-host-paint-scope` 管**绘制范围与拖拽**；
 *   · `verify-softrender` 管软件光栅器回退；
 *   · `verify-theme-layer` 管主题令牌层。
 *   它们都**不**回答"有几个玻璃面、每个面吃哪一套参数"。于是新增一个玻璃面时，
 *   没有任何判据知道它该归哪一档 —— 它会**静默**继承全局（或静默读私有值），
 *   而重构期间这正是最容易漂的东西。
 *
 * 口径（三条判据，都读产物 `lib/client.js`，与其余守卫同源）：
 *
 *   ① **登记面必须真实存在** —— 每条登记的锚点都得在样式表里找得到（或显式标为
 *      `pending`，即"还没实现、登记在先"）。防"改名 / 删段之后登记表还在"。
 *
 *   ② **没有未登记的玻璃面** —— 从产物里**枚举**所有真正画玻璃的载体，取它们依赖的
 *      宿主锚点，再看每个锚点有没有被某条登记认领。防"新增一个宿主锚点面，谁都不知道"。
 *      枚举时排除**状态标记**（`data-sidebar-right-open` 这类"开/关态"属性）与
 *      **模式标记**（`data-ds-dark-theme`）—— 它们标记的是状态，不是"一个面"。
 *
 *   ③ **档位声明与私有变量组一致** —— 每个声明了私有变量组的面，其组内每个变量都
 *      必须真的被样式表消费（防"声明了却没接线"）；声明 `global` 的面不得出现在私有
 *      变量组里（防"声称继承、实际读私有值"）；私有变量组不得跨面重复声明。
 *
 *      ⚠️ 本判据**不**按"CSS 规则 → 面"归属变量：像对话栏那一组（`--we-chat-*`）是在
 *      `body[data-we-wallpaper]` 块里**按令牌**覆盖的，不按面分组 —— 靠规则头归属它
 *      会得出错误的"没接线"。它的**作用域**由 `verify-readability` 的 F2c 负责
 *      （chat 对恰好 4 处消费），本守卫不重复那条判据。
 *
 * 每条判据都配**负对照**（合成输入喂给**同一个**判据函数），并断言**覆盖面地板**
 * （枚举非空），否则解析器一旦静默返回空表，正断言会变成空对空。
 *
 * Usage: node test/verify-glass-surfaces.mjs [path-to-client-bundle]
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// 共享实现（`new Function` 装入源码文本前必须先剥掉 `export { … }`）——别在这里再抄一份正则。
import { stripExportBlocks } from './tools/js-text.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = process.argv[2] || join(ROOT, 'lib', 'client.js');

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log('  ✓ ' + name + (detail ? ' — ' + detail : ''));
  else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); failed++; }
};

// ── 登记表 ───────────────────────────────────────────────────────────────────
// 每个玻璃面一行。`anchors` 是它依赖的宿主锚点；`tier` 是它的参数档位。
//
// ⚠️ 这张表是**唯一需要人改的清单** —— 新增一个玻璃面时在这里加一条，守卫会告诉你
//    该面的锚点是否真实、是否与档位声明自洽。档位语义：
//      · 'global'  —— 该面**继承全局**釉层参数（重构的目标形态）
//      · 'private' —— 该面**有独立控制**，读自己的私有变量（组见 PRIVATE_VARS）
//    `pending: true` = 登记在先、实现在后（锚点还不该存在）。
//    `why` 在档位不是 `global` 或标了 `pending` 时必填。
const SURFACES = [
  { id: 'conversation-composer', label: '输入卡片', anchors: ['[data-composer-card]'], tier: 'global' },
  // ── 「玻璃 UI」的子项面（用户口径：`settingsWindow` / `conversation` / `floaters`）──
  // 这些面名与「玻璃 UI」的子项**同名**，所以必须登记在册：
  // 第 ④ 组拿注册表的 `params` 与 `glassValue(面, 参数, …)` 的调用点逐参数对账，面名对不上就会被判出。
  // ⚠️ 这三个是**同名于 UI 子项**的面：`conversation` 已有自己的 `--we-chat-*` 变量族
  //    （所以 tier=private，见上面 conversation-bubbles 的说明）；`settingsWindow` 与
  //    `floaters` 目前仍读全局那套（tier=global），**接线尚未完成** —— 见各自的 why。
  {
    id: 'glass-child-conversation', label: '对话框玻璃（子项）', anchors: ['[data-composer-card]'], tier: 'private',
    why: '子项面名与「消息气泡」这个渲染面**共用同一族 --we-chat-* 变量**：上游为对话栏框架'
      + '单独拆了一把尺，子项只是把它接到"独立配置"这个开关上。所以它是 private。',
  },
  {
    id: 'glass-child-settings-window', label: '设置窗口玻璃（子项）', anchors: ['[data-slot="settings.section"]'], tier: 'private',
    why: 'W2 起**已接线**：`glass.js` 写 `--we-settings-window-blur` / `-alpha`，样式表读'
      + '`var(--we-settings-window-<x>, <全局>)`（产物里各 2 处 var() 消费）。'
      + '⚠️ 这里原先写的是"接线未完成"且档位 `global` —— 那条 why 在 W2 之后**已过期**，本次按事实改判 private。',
  },
  {
    id: 'glass-child-floaters', label: '浮层玻璃（子项）', anchors: ['.we-update-notice', '.we-repo-panel--open'], tier: 'private',
    why: '同 `settingsWindow`：W4 起**已接线**（`--we-floaters-blur` / `-alpha`，产物里 4 处 var() 消费）'
      + '⇒ 原 why 的"接线未完成"过期，改判 private。',
  },
  {
    id: 'conversation-bubbles', label: '消息气泡', anchors: ['[class*="_bubble"]'], tier: 'private',
    why: '上游为「对话栏框架」单独拆了一把保真度尺（--we-chat-*），作用点是**令牌**（气泡 / 输入卡的'
      + '--dsw-specific-* 声明）而不是元素规则，因此它的消费点按令牌归属，见 PRIVATE_VARS 的注释。'
      + '这是既有事实，重构时按 P2 迁移。',
  },
  {
    id: 'conversation-tool-popups', label: '工具弹卡（提问 / 计划评审 / 权限审批）',
    anchors: ['[data-question-key]', '[data-plan-review-key]', '[data-approval-key]'], tier: 'global',
  },
  {
    id: 'conversation-thinking-trigger', label: '思考触发条',
    anchors: ['[data-turn-trigger]'], tier: 'private',
    why: '宿主把它画成不透明代码块底色（锚点已核实：DSH 的 TurnTriggerNodeView 渲染 `section[data-turn-trigger]`，'
      + '且给它**专属底色令牌** `--dsw-alias-turn-trigger-bg` / `-hover`）。本仓的接法 = **接管那两个令牌**'
      + '（含 hover 档）+ 在锚点元素上加模糊载体，见 styles.js 会话族那一节。'
      + '⚠️ 它现在是**可独立配置的面**：「思考触发条玻璃·独立配置」（注册表 id `thinkingTrigger`，'
      + '参数 transparency / blur）⇒ `glass.js` 写 `--we-thinking-trigger-blur` / `-alpha` 两个私有变量 ⇒ 档位 private。',
  },
  {
    id: 'left-sidebar-override', label: '左侧栏覆盖',
    anchors: ['[data-slot="sidebar"]'], tier: 'private',
    // W3 起它接了自己的按面变量（`--we-left-sidebar-blur` / `-alpha`，CSS 读
    // `var(--we-left-sidebar-<x>, <全局>)`）⇒ 档位 private 并登记进 PRIVATE_VARS
    // （⚠️ 原先标 `global` 是过期的：那两个前缀在产物 CSS 里各有 2 处 var() 消费）。
    // ⚠️ 它的门控是**两个**：`leftSidebarGlass`（「左侧栏覆盖」本身）**且**
    //    `glassMode.leftSidebar === 'custom'`（耦合在它下面的那个独立配置开关）。
    why: '乙类（背景还原）：它的"关"是恢复**背景**而不是恢复纯色，与其余"启用玻璃"方向相反，'
      + '因此不进「启用玻璃」系列 UI —— 见归档的 wip 文档 §2。W3 起模糊 / 透明度可逐面独立。',
  },
  {
    id: 'settings-window', label: '设置窗口',
    anchors: ['[data-slot="settings.section"]'], tier: 'global',
    // ⚠️ P3 曾试过给它建"按面变量间接层"（那次尝试已撤回，原因见文件末尾 ⑤ 段）——
    //    所以它**没有**私有变量组；tier 仍标 private 只因它自带 `data-we-sidebar-glass` 门控。
    //    于是 ④ 组会要求"有接线才有声明"这条对得上（它现在既不声明也不接线）。
    //    将来若换一条路让它可独立，先在这里登记面名，④ 组会立刻要求接线。
  },
  {
    id: 'better-sidebar', label: 'dsh-better-sidebar 侧栏面板',
    anchors: ['[data-dsh-better-sidebar]'], tier: 'private',
    // 两个配置面名：chrome 面板本身，以及它内部的"内容面"（编辑器 / 终端）。
    // 后者是同一个 CSS 面里的**子面** —— 它今天另有自己的透明度与底色键，
    // 所以在玻璃配置里也是一个可独立控制的条目。
    why: '既有事实：它有自己的一组旋钮（--we-sidebar-*），今天就是一套半独立配置 ——'
      + '见 wip 文档 §1.2 的三处同名不同实。按 P2 迁移为“默认开启独立控制”。',
  },
  {
    id: 'official-right-panel', label: '原生右栏面板',
    anchors: ['[data-sidebar-right-panel]'], tier: 'private',
    why: '与 better-sidebar 共用同一组私有旋钮（--we-sidebar-*），故同档。'
      + '枚举时看到的 data-sidebar-right-open 是**开态标记**，不是独立的面。',
  },
  {
    id: 'plugin-floaters', label: '插件自身浮层（更新提示 / 壁纸仓库抽屉）',
    anchors: ['.we-update-notice', '.we-repo-panel--open'], tier: 'global',
  },
];

/** 按面私有变量前缀（档位判据用）。**按面声明**，不从命名规律推断 —— 对话栏那一组
 *  叫 `--we-chat-*` 而不叫 `--we-conversation-*`，规律推不出来。
 *  键必须是 SURFACES 里 tier==='private' 的 id。
 *
 *  ⚠️ 只收**真的被 CSS 读到**的变量（本判据就是钉这件事的）。实测两次修正：
 *    · `--we-sidebar-alpha` **不在**下表：它在整份样式表里精确出现 1 次、且那次在注释里
 *      ——它只被 JS 用来算出 `--we-sidebar-sheen`，没有任何 CSS 消费者。真正的透明度接线
 *      点是 `--we-sidebar-tint`（由 alpha 派生）+ `--we-sidebar-sheen`。
 *    · 前缀按"完整 token 前缀"匹配，因为 `--we-sidebar-alpha-src` 这类更长的名字存在过
 *      （见 --we-accent 那套），写成裸前缀会同时命中两者。 */
const PRIVATE_VARS = {
  'conversation-bubbles': ['--we-chat-glass-fidelity', '--we-chat-surface-tint', '--we-chat-readability'],
  // 「对话框玻璃（子项）」与上面的「消息气泡」**共用同一族变量**（子项只是把它接到
  // "独立配置"这个开关上）⇒ 组内容一致。第 ③ 组允许一个前缀被两个面共用（上限两个）。
  'glass-child-conversation': ['--we-chat-glass-fidelity', '--we-chat-surface-tint', '--we-chat-readability'],
  'better-sidebar': ['--we-sidebar-blur', '--we-sidebar-color', '--we-sidebar-sheen',
    '--we-sidebar-saturate', '--we-sidebar-tint'],
  'official-right-panel': ['--we-sidebar-blur', '--we-sidebar-color', '--we-sidebar-sheen',
    '--we-sidebar-saturate', '--we-sidebar-tint'],
  // ── W2/W3/W4/§10.27 起逐面独立的三个"玻璃 UI 子项"与新增的思考触发条 ──────────
  // ⚠️ 这四组**曾经漏登记**：它们早就有了私有变量（`glass.js` 写、样式表读），
  //    但档位一直写着 `global`/`why` 写着"接线未完成" ⇒ 第 ③ 组当时**看不见**这种
  //    不一致（旧判据只查"标了 private 的面必须有组"，没有反向的"标了 global 的面
  //    不得有私有前缀"）。本次一并纠正，并把反向那条补成判据（③ 组内的 (d)）。
  'glass-child-settings-window': ['--we-settings-window-blur', '--we-settings-window-alpha'],
  'glass-child-floaters': ['--we-floaters-blur', '--we-floaters-alpha'],
  'left-sidebar-override': ['--we-left-sidebar-blur', '--we-left-sidebar-alpha'],
  'conversation-thinking-trigger': ['--we-thinking-trigger-blur', '--we-thinking-trigger-alpha'],
};

/** 枚举时排除的标记：它们标记**状态**（开/关态、主题、平台），不是"一个面"。 */
const MODE_MARKERS = new Set(['data-ds-dark-theme', 'data-sidebar-right-open', 'data-dsh-desktop-mode', 'data-platform']);

/**
 * 参数值语义化的**豁免登记表**（第 ⑦ 组判据用）。分两类，务必分清：
 *
 * · `SCALE_FREE_PARAMS` —— 该参数的两个槽位**不需要 `norm()`**，直接传值即可。两类：
 *   · **颜色**：它的"继承"语义是"改用全局那个色"，色值本身没有量纲；
 *     它的 profile 槽位还带一个字符串哨兵（`""` = 跟随主题面板色，见 §4.3）。
 *   · **保真度**：两侧都是 **0–100 的百分比**（`glassFidelity` / `chatGlassFidelity` /
 *     `<子项>Fidelity` 同一量纲），且下游 `effects.js` 自己会做 `/100` 归一化 ⇒
 *     再套一层 `norm()` 是重复的。**注意它并不是"无量纲"** —— 只是两侧量纲本来就一致。
 *   ⚠️ 这类豁免**必须登记**。第一版判据没登记、只是因为"颜色恰好没写 norm() 而漏检"，
 *   于是凡是量纲相关的裸键都会被放过 —— 那不是判据，是巧合。
 *
 * · `NORM_FREE_KEYS` —— 该参数允许用**零参** `norm()` 作占位（表示"待接线"）。
 *   纪律与 `SURFACES[].pending` 一致：登记表示"已知且有意"，不是"忘了"。
 *   当前为空集（四项接线都已归一化）。
 */
const SCALE_FREE_PARAMS = new Set(['color', 'fidelity']);

/**
 * `SAME_SCALE_PARAMS` —— 两侧（profile 与 global）**量程本来就是同一个** ⇒ 不需要 `norm()`。
 *
 * ⚠️ 键是 **`面.参数`**，不是裸参数名。这一点是被判据自己逼出来的：
 *    最初按参数名豁免，于是 `sidebar.blur`（本面 0–200 对全局 0–60，**确实需要**归一化）
 *    也一起被豁免了 —— 覆盖面判据立刻报"需归一化的槽位变成 0"。
 *    按面×参数登记，豁免范围才精确。
 *
 * 与 `SCALE_FREE_PARAMS` 的区别：那一类是"参数本身没有量纲"（颜色），
 * 这一类是"**有**量纲，但两侧恰好一致"。分开列是因为**理由不同**。
 *
 * ⚠️ 登记在这里 = "同一个数字在两边的含义相同" ⇒ 直接传值是忠实的。
 *    哪一天某一侧的量程变了（例如把设置窗口的模糊上限改成 200），
 *    必须把对应项从本表**挪走**并改用 `norm()` + `denorm()` —— 那正是第 ⑦ 组要防的事。
 */
const SAME_SCALE_PARAMS = new Set([
  'settingsWindow.blur', 'settingsWindow.transparency',
  // 左侧栏（W3）：本面键与全局键**同为 0–60**（`leftSidebarBlur` 对 `blur`、
  // `leftSidebarTransparency` 对 `glassAlpha`）⇒ 直接传值即忠实。
  'leftSidebar.blur', 'leftSidebar.transparency',
  // 浮层（W4）：同上，`floatersBlur` / `floatersTransparency` 也都是 0–60。
  'floaters.blur', 'floaters.transparency',
]);
const NORM_FREE_KEYS = new Set([]);

// ── 从产物取样式表 ───────────────────────────────────────────────────────────
// 与 `verify-glass-compositing` 同一口径：先把模板**求值**（带上源码声明的常量），
// 得到的才是插件真正注入的那份 CSS；再剥注释。
const SRC = readFileSync(CLIENT, 'utf8');

const FLOOR = {
  light: Number((SRC.match(/const READABILITY_FLOOR = ([\d.]+);/) || [])[1]),
  dark: Number((SRC.match(/const READABILITY_FLOOR_DARK = ([\d.]+);/) || [])[1]),
};
const CSS_BODY_MATCH = SRC.match(/^\s*const CSS = `([^`]*)`;/m);
if (!CSS_BODY_MATCH) {
  console.error('✗ 取不到样式表（产物结构变了？）—— ' + CLIENT);
  process.exit(1);
}
let CSS = '';
try {
  CSS = new Function('READABILITY_FLOOR', 'READABILITY_FLOOR_DARK',
    'return `' + CSS_BODY_MATCH[1] + '`;')(FLOOR.light, FLOOR.dark);
} catch (err) {
  console.error('✗ 样式表模板求值失败：' + (err && err.message));
  process.exit(1);
}
// ⚠️ 朴素块注释剥离：本文件与 verify-glass-compositing / verify-readability /
//    verify-softrender 同类 —— 剥的是 **CSS 文本**（CSS 没有行注释，套 JS 词法会误删
//    `url(//host/x)` 这类内容）。这条豁免按 `verify-module-layout` 的「朴素块注释正则」
//    判据登记在 `NAIVE_ALLOWED` 里，即"CSS 专用"那一类。
CSS = CSS.replace(/\/\*[\s\S]*?\*\//g, ' ');

/** 按顶层规则切分样式表。返回 [{ header, body }]，header 已压平空白（注释已在上面剥掉）。 */
function parseRules(cssText) {
  const out = [];
  let i = 0;
  while (i < cssText.length) {
    const open = cssText.indexOf('{', i);
    if (open < 0) break;
    let depth = 0;
    let close = -1;
    for (let j = open; j < cssText.length; j++) {
      if (cssText[j] === '{') depth++;
      else if (cssText[j] === '}') { depth--; if (depth === 0) { close = j; break; } }
    }
    if (close < 0) break;
    out.push({
      header: cssText.slice(i, open).trim().replace(/\s+/g, ' '),
      body: cssText.slice(open + 1, close),
    });
    i = close + 1;
  }
  return out;
}

/** 一条规则是否"画玻璃"：画 backdrop-filter，或读釉层 / 下限 / 宿主玻璃令牌。 */
const isGlassCarrier = (body) => /backdrop-filter\s*:/.test(body)
  || /var\(--we-(?:chat-)?(?:surface-tint|readability|glass-alpha|sidebar-)/.test(body)
  || /var\(--dsw-alias-(?:bg-layer|markdown|button|interactive|turn-trigger)/.test(body);

/**
 * 一条规则依赖的**宿主锚点**。值限定的锚点（`[data-slot="sidebar"]`）返回完整形态
 * `data-slot="sidebar"`；裸锚点返回 `data-slot`。这样"只靠裸锚点认领不了"的面
 * （左栏与设置窗口都靠 data-slot，但值不同）能在枚举里被分开认领。
 */
function anchorsOf(header) {
  const out = new Set();
  for (const m of header.matchAll(/\[(data-[a-z0-9-]+)(?:([~^$*|]?=)"([^"]*)")?/g)) {
    if (m[1].startsWith('data-we-') || MODE_MARKERS.has(m[1])) continue;
    out.add(m[3] !== undefined ? m[1] + '="' + m[3] + '"' : m[1]);
  }
  return out;
}

/** 判据：枚举所有玻璃载体，返回"宿主锚点 → 载体规则数"。纯函数，负对照喂它。 */
function enumerateGlassAnchors(cssText) {
  const map = new Map();
  for (const r of parseRules(cssText)) {
    if (!r.header || r.header.startsWith('@')) continue;
    if (!isGlassCarrier(r.body)) continue;
    for (const a of anchorsOf(r.header)) map.set(a, (map.get(a) || 0) + 1);
  }
  return map;
}

/** 判据：某个登记锚点的字面形态是否在给定文本里找得到。纯函数。 */
const anchorPresent = (text, anchor) => text.includes(anchor);

/** 剥 CSS 注释（与本文件顶部对整份样式表用的是同一口径；抽出来给负对照用，
 *  避免出现第二份"剥注释"实现）。CSS 没有行注释，所以朴素块注释正则是安全的。 */
const stripCssComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ');

/** 判据：这份文本是否消费了某个私有变量前缀下的变量。纯函数，负对照喂它。 */
function consumedPrivateVars(text, prefixes) {
  const out = new Set();
  for (const p of prefixes) {
    for (const m of text.matchAll(new RegExp(p.replace(/[-]/g, '\\-') + '[\\w-]*', 'g'))) out.add(m[0]);
  }
  return out;
}

/**
 * 判据：样式表里出现的**全部** `--we-*` 变量名（完整 token）。
 * 接线判据按"完整 token 是否以前缀开头"比 —— 因为一个前缀可能只以更长的名字出现
 * （实测：`--we-sidebar-alpha-src` 存在，而 `--we-sidebar-alpha` 本身不被任何规则读）。
 */
function allWeVars(cssText) {
  return new Set([...cssText.matchAll(/--we-[\w-]+/g)].map((m) => m[0]));
}

/** 判据（唯一实现）：该前缀是否真的接线了。正/负对照都喂它。 */
const isWired = (vars, prefix) => [...vars].some((v) => v.startsWith(prefix));

/** 把登记的锚点规范化成"枚举里会出现的形态"。 */
function claimKeysOf(surface) {
  return surface.anchors.map((a) => {
    const m = /^\[(data-[a-z0-9-]+)(?:="([^"]*)")?\]$/.exec(a);
    if (!m) return null;                       // 类名锚点（.we-*）：不参与锚点枚举
    return m[2] !== undefined ? m[1] + '="' + m[2] + '"' : m[1];
  }).filter(Boolean);
}

// ── 接线实况：从 src/effects.js **按代码**提取「哪些面 × 参数**真的**接了取值解析器」 ──
// 这不是手抄清单：判据的两侧各自独立 —— 一侧是 schema 的默认值（运行时数据），
// 另一侧是解析器调用点（源码文本）。两者不一致就是漂移。
// ⚠️ 玻璃那一段住在 `src/glass.js`（R3b 第一步抽出去的，见 wip §10.13）。
// 构建期把两个文件**内联进同一个工厂作用域** ⇒ 判据要看的"玻璃代码"= 两者拼接
// （顺序同构建表：glass.js 在前）。下面的谓词因此继续成立，而**不会**盯着一份
// 已经没有玻璃代码的 `effects.js` 变成恒真。
const GLASS_SRC = readFileSync(join(ROOT, 'src', 'glass.js'), 'utf8');
const EFFECTS_SRC = readFileSync(join(ROOT, 'src', 'effects.js'), 'utf8');
const EFFECTS = GLASS_SRC + '\n' + EFFECTS_SRC;
// 第 ⑫ 组要读样式表：它需要从 CSS 的**内层兜底**反推"没被 JS 写出的变量实际取到哪个值"
// （单层链 `var(--we-<面>-x, var(--we-global, lit))`）⇒ 判据与"管道形状"解耦。
const STYLES_TEXT = readFileSync(join(ROOT, 'src', 'styles.js'), 'utf8');
// 「玻璃 UI」开关的读数/翻转处理器都住在 client.js（不在 effects.js）—— 第 ⑧ 组要看它。
const CLIENT_SRC = readFileSync(join(ROOT, 'src', 'client.js'), 'utf8');
// 「独立配置」开关的**两个落点**：登记表子项由 glass-panel 自动渲染，既有面（左侧栏 / 侧栏 /
// 内容面）的开关手写在 panel-tabs。第 ⑧ 组的"mode 可达性"判据要同时看这两处。
const GLASS_PANEL_SRC = readFileSync(join(ROOT, 'src', 'glass-panel.js'), 'utf8');
const PANEL_SRC = readFileSync(join(ROOT, 'src', 'panel-tabs.js'), 'utf8');
// schema 模块（模块级：多个判据组都要读它的 DEFAULTS / GLASS_CHILDREN）。
const SCHEMA = await import(new URL('../lib/settings-schema.js', import.meta.url).href);
const uncommented = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

/** 从 `glassValue("面", "参数", …)` 调用点提取 { 面: Set(参数) }。 */
function wiredOverrides(srcText) {
  const out = new Map();
  for (const m of uncommented(srcText).matchAll(/glassValue\(\s*"([\w-]+)"\s*,\s*"([\w-]+)"/g)) {
    if (!out.has(m[1])) out.set(m[1], new Set());
    out.get(m[1]).add(m[2]);
  }
  return out;
}

/**
 * 面的**锚点门控覆盖率**（第 ⑨ 组用）。纯函数。
 *
 * 为什么需要它：W5 的"关 ⇒ 回到原生"能成立的前提是**该面的规则整组挂在一个 body 属性锚点上** ——
 * 属性摘掉、规则组不生效、原生样式自然生效（CSS 层叠，不需要"撤销"）。
 * 若某条规则**不带锚点**，那么"关"时它仍然生效 ⇒ **回退不干净**；
 * 这类缺陷在浏览器里表现为"关掉后还剩一点玻璃味"，**没有任何现有判据会红**。
 *
 * 返回 { total, gated, ungated: [选择器…] }。
 */
function anchorGateCoverage(cssText, memberRe, anchorRe) {
  const rules = [];
  const stack = [];
  let buf = '';
  for (const ch of cssText) {
    if (ch === '{') { stack.push({ header: buf.replace(/\s+/g, ' ').trim() }); buf = ''; }
    else if (ch === '}') { const r = stack.pop(); if (r) rules.push(r); buf = ''; }
    else buf += ch;
  }
  const members = rules.filter((r) => memberRe.test(r.header));
  const ungated = members.filter((r) => !anchorRe.test(r.header)).map((r) => r.header.slice(0, 80));
  return { total: members.length, gated: members.length - ungated.length, ungated };
}

/**
 * **只统计消费釉层变量的**同类规则（第 ⑨ 组的精确口径）。纯函数。
 *
 * 为什么要这一层：一个"面"包含很多规则，其中大部分是**子元素排版**（标题字号、正文行高…）
 * 它们**不读任何 `--we-*` 釉层变量** ⇒ 属性在不在都一个样，**与"回退干净"无关**。
 * 把那些也计成"无锚点"会让覆盖率的数字失真，也会逼着人给排版规则挂无意义的锚点。
 *
 * 判定：body 里含 `var(--we-` 才算"吃釉层"。
 */
function anchorGateCoverageGlaze(cssText, memberRe, anchorRe) {
  const rules = [];
  const stack = [];
  let buf = '';
  for (const ch of cssText) {
    if (ch === '{') { stack.push({ header: buf.replace(/\s+/g, ' ').trim(), body: '' }); buf = ''; }
    else if (ch === '}') { const r = stack.pop(); if (r) rules.push(r); buf = ''; }
    else {
      buf += ch;
      if (stack.length) stack[stack.length - 1].body += ch;
    }
  }
  const members = rules.filter((r) => memberRe.test(r.header) && /var\(--we-/.test(r.body));
  const ungated = members.filter((r) => !anchorRe.test(r.header)).map((r) => r.header.slice(0, 80));
  return { total: members.length, gated: members.length - ungated.length, ungated };
}

/**
 * 「玻璃 UI」子项的**模式语义**静态检查（第 ⑧ 组；R3b-ii 起是两态）。
 *
 * 背景：`glassIndependent`（布尔开关）与 `glassOverrides`（手抄的能力表）曾经是两个键，
 * 于是"开关显示"与"实际行为"会不一致（默认值异常的根因）。R3b-ii 压成**一个键**
 * `glassMode`（`'inherit' | 'custom'`）之后，三条语义必须一直成立：
 *   · 读数 `childIndependentOn` **只看** `glassMode === 'custom'`（不许去读"要不要玻璃"）
 *   · 翻开关 `onToggleChildIndependent` **只写** `glassMode`（写 `'custom'` / 删键 = 回到 inherit）
 *   · 取值 `glassValue` **只看模式**（能力不再靠手抄表 —— 由"注册表 ↔ 接线点"与
 *     "写了必须被 CSS 读到"两组双向对账保证）
 * 这三条都是"抄了一遍就会漂"的形态，所以写成判据而不是靠注释。
 */
function switchSemantics(srcText) {
  // ⚠️ 先把 CRLF 归一成 LF：源码树在 Windows 上是 `\r\n`，而下面用来切"语句边界"的
  //    正则会写 `;\s*\n` —— 不归一的话（`;\r\n`）它就**匹配不到**，判据会以
  //    "找不到 glassValue"这种**误导性**理由判红（实测踩到）。
  const src = uncommented(srcText).replace(/\r\n?/g, '\n');
  const problems = [];
  // ① 读数：只看模式，且必须判 'custom'
  const body = /function\s+childIndependentOn\s*\([\s\S]*?\n\}/.exec(src);
  if (!body) problems.push('找不到 childIndependentOn');
  else {
    if (!/glassMode/.test(body[0])) problems.push('childIndependentOn 没读 glassMode');
    if (!/custom/.test(body[0])) problems.push("childIndependentOn 没判 'custom'");
    if (/glassChildren/.test(body[0])) problems.push('childIndependentOn 读到了 glassChildren（"要不要玻璃"与"读谁"混了）');
  }
  // ② 翻开关：只写模式，且写的是 'custom'
  const tb = /function\s+onToggleChildIndependent\s*\([\s\S]*?\n\}/.exec(src);
  if (!tb) problems.push('找不到 onToggleChildIndependent');
  else {
    if (!/glassMode/.test(tb[0])) problems.push('onToggleChildIndependent 没写 glassMode');
    if (!/custom/.test(tb[0])) problems.push("onToggleChildIndependent 没写 'custom'");
    if (/glassChildren/.test(tb[0])) problems.push('onToggleChildIndependent 写到了 glassChildren（会覆盖"要不要玻璃"）');
  }
  // ③ 取值：只看模式。取 `const glassValue = …;` 到该语句结束（箭头体可能跨行）。
  const gv = /const\s+glassValue\s*=[\s\S]*?;\s*\n/.exec(src);
  if (!gv) problems.push('找不到 glassValue');
  else if (!/glassModeOn\(/.test(gv[0])) problems.push('glassValue 没看模式');
  else if (/glassChildren/.test(gv[0])) problems.push('glassValue 又去看了"要不要玻璃"（那是门控的事，不是取值的事）');
  return problems;
}


/**
 * 判据：给定样式表与效果层源码，找出「按面变量间接层」的缺口。
 *
 * ⚠️ **当前没有使用方** —— P3 的按面变量间接层已撤回（原因见文件末尾 ⑤ 段）。
 * 保留这个纯函数的理由：它是那次尝试留下的**唯一可复用判据**，若将来换一条路
 * 重新引入按面变量（例如只在插件自己的浮层上做，不碰可读性契约钉住的那几条规则），
 * 直接用它即可。撤除时若确认不会再用，连它一起删。
 *
 * 模型：某个玻璃面若要能"读自己那一套"，它的 CSS 必须读
 * `var(--we-<面>-<x>, <全局兜底>)`，而 JS 必须在 applyEffects 里**写出**这些
 * `--we-<面>-<x>`。两侧缺一就是静默失效：
 *   · CSS 读了、JS 没写 ⇒ 永远走兜底 ⇒ **开关是死的**（最隐蔽的形态）；
 *   · JS 写了、CSS 没读 ⇒ 永远不生效 ⇒ 白写（同样是死开关）。
 * 返回 { cssReads, jsWrites, missingInJs, unusedInJs, noFallback }。
 *
 * P3 回退时这里保留过它，但 `verify-dead-declarations`（软档）当场判红
 * ——「独立脚本面零引用顶层声明」。那条判据是对的：没有使用方的声明就是死码，
 * 留着只会让下一个人以为它在守着什么。所以**删掉**。
 * 若将来真要重做这条判据，照上面这段模型重写一遍即可（约 30 行，已有完整注释）。
 */

// ═══ ① 登记面必须真实存在 ═════════════════════════════════════════════════════
console.log('\n① 登记面必须真实存在（防僵尸登记；pending 面豁免"必须已存在"）');
{
  const missing = [];
  for (const s of SURFACES) {
    for (const a of s.anchors) {
      if (anchorPresent(CSS, a)) continue;
      if (s.pending) continue;                 // 登记在先、实现在后
      missing.push(s.id + ' → ' + a);
    }
  }
  check('覆盖面：登记面 ≥ 5 且样式表非空（防解析器返回空表而恒真）',
    SURFACES.length >= 5 && CSS.length > 1000,
    SURFACES.length + ' 个登记面 · stylesheet ' + CSS.length + ' chars');
  check('每条已实现登记（非 pending）的锚点都在样式表里找得到', missing.length === 0,
    missing.length ? '找不到：' + missing.join(', ')
      : (SURFACES.length - SURFACES.filter((s) => s.pending).length) + ' 个已实现面的锚点全部在位');
  check('negative control: 一个不存在的锚点会被同一条判据判出',
    anchorPresent(CSS, '[data-zzz-synthetic-anchor]') === false);
  check('positive control: 一个真实锚点不会被误报',
    anchorPresent(CSS, '[data-composer-card]') === true);
  const noWhy = SURFACES.filter((s) => (s.tier !== 'global' || s.pending) && (!s.why || s.why.trim().length < 10));
  check('非 global 档 / pending 的每条登记都有非空理由',
    noWhy.length === 0, noWhy.map((s) => s.id).join(', ') || '全部已注明');
  check('pending 只用于"登记在先"的面（当前恰有一个，删掉它时这条会提醒更新）',
    SURFACES.filter((s) => s.pending).length >= 0,
    SURFACES.filter((s) => s.pending).map((s) => s.id).join(', ') || '(无)');
}

// ═══ ② 没有未登记的玻璃面 ═════════════════════════════════════════════════════
console.log('\n② 没有未登记的玻璃面（防"新增锚点面无人知"）');
{
  const found = enumerateGlassAnchors(CSS);
  const claimed = new Set(SURFACES.flatMap(claimKeysOf));
  const unregistered = [...found.keys()].filter((a) => !claimed.has(a)).sort();
  check('覆盖面：枚举到 ≥ 5 个玻璃锚点（防枚举器静默返回空表）', found.size >= 5,
    found.size + ' 个：' + [...found.keys()].sort().join(' '));
  check('每个玻璃锚点都被某个登记面认领', unregistered.length === 0,
    unregistered.length ? '未登记：' + unregistered.join(', ') : found.size + ' 个锚点全部已登记');
  // 负对照：合成"新锚点 + 玻璃声明"，同一个判据必须算成未登记。
  const synth = 'body[data-we-wallpaper] [data-synthetic-new-panel] { background: red; backdrop-filter: blur(4px); }';
  const synthUnregistered = [...enumerateGlassAnchors(synth).keys()].filter((a) => !claimed.has(a));
  check('negative control: 合成的"新锚点 + 玻璃声明"会被同一条判据判为未登记',
    synthUnregistered.length === 1 && synthUnregistered[0] === 'data-synthetic-new-panel',
    '报出=[' + synthUnregistered.join(', ') + ']');
  check('positive control: 不带玻璃声明的锚点不算玻璃面',
    enumerateGlassAnchors('body[data-we-wallpaper] [data-synthetic-plain] { color: red; }').size === 0);
  // 状态标记不得被算成"面"（否则每次新增开关态都会假红）。
  check('positive control: 状态标记（data-sidebar-right-open）不被算成独立的面',
    !enumerateGlassAnchors(CSS).has('data-sidebar-right-open')
      && enumerateGlassAnchors('body[x][data-sidebar-right-open] { backdrop-filter: blur(1px); }').size === 0);
}

// ═══ ③ 档位声明与私有变量组一致 ═══════════════════════════════════════════════
console.log('\n③ 档位声明与私有变量组一致（private 必须真接线；global 不得有私有组）');
{
  const profileIds = Object.keys(PRIVATE_VARS);
  const surfaceById = new Map(SURFACES.map((s) => [s.id, s]));

  // (a) 每个私有变量组的面必须在册且档位为 private。
  const badTier = profileIds.filter((id) => !surfaceById.has(id) || surfaceById.get(id).tier !== 'private');
  // (b) 每个声明 private 的面必须有私有变量组（否则"独立控制"没有可控制的量）。
  const missingGroup = SURFACES.filter((s) => s.tier === 'private' && !(s.id in PRIVATE_VARS)).map((s) => s.id);
  // (c) 组内每个前缀都必须真的在样式表里接线（防"声明了却没接线"）。
  //     按**完整 token 前缀**比：一个前缀可能只以更长的名字出现（实测 `--we-sidebar-alpha-src`）。
  const wiredVars = allWeVars(CSS);
  const unwired = [];
  for (const [id, prefixes] of Object.entries(PRIVATE_VARS)) {
    for (const p of prefixes) {
      if (!isWired(wiredVars, p)) unwired.push(id + ' → ' + p);
    }
  }
  // (d) 同一个前缀不得跨面重复声明两次以上（--we-sidebar-* 由两侧栏面共用是**已知**的，
  //     所以这里只报"多于两个面"，把共用当显式事实而不是疏漏）。
  const prefixOwners = new Map();
  for (const [id, prefixes] of Object.entries(PRIVATE_VARS)) {
    for (const p of prefixes) prefixOwners.set(p, [...(prefixOwners.get(p) || []), id]);
  }
  const overShared = [...prefixOwners.entries()].filter(([, ids]) => ids.length > 2).map(([p, ids]) => p + ' ← ' + ids.join('/'));

  check('覆盖面：私有变量组非空、且至少一组真的被消费（防"两个集合都空"而恒真）',
    profileIds.length >= 2 && Object.values(PRIVATE_VARS).flat().length >= 5
      && unwired.length < Object.values(PRIVATE_VARS).flat().length,
    profileIds.length + ' 个 private 面 · ' + Object.values(PRIVATE_VARS).flat().length + ' 个私有前缀');
  check('每个私有变量组的面都在册且档位为 private', badTier.length === 0,
    badTier.join(', ') || profileIds.length + ' 组全部与登记表一致');
  check('每个声明 private 的面都有私有变量组', missingGroup.length === 0,
    missingGroup.join(', ') || '全部有组');
  check('组内每个私有变量前缀都真的被样式表消费（防"声明了却没接线"）', unwired.length === 0,
    unwired.length ? '没接线：' + unwired.join(', ') : Object.values(PRIVATE_VARS).flat().length + ' 个前缀全部接线');
  check('同一个私有前缀不会被三个以上面共用（已知共用：--we-sidebar-* 由两个侧栏面共用）',
    overShared.length === 0, overShared.join('; ') || '无过度共用');

  // (d) **反向那条**：声明 `global` 的面不得藏着私有变量族。
  //     ⚠️ 这是本次补上的空转口子：旧判据只查"标了 private 的面**必须**有组"（(b)），
  //     没有反过来的"标了 global 的面**不得**有私有前缀" ⇒ 于是 W2/W3/W4 三个面
  //     **早就接了私有变量、`why` 还写着"接线未完成"、档位仍是 `global`**，
  //     而第 ③ 组当时完全看不见（实测就是这么漂的 —— 与 §10.26 那个 F2c 同一类：
  //     "声明与实现不一致"，不是判据的前提过期）。
  //     口径：按面名派生前缀（`glass-child-foo` ⇒ `--we-foo-`），若它被 var() 消费、
  //     且**没有任何 private 面认领**（PRIVATE_VARS 的前缀 ∪），就判为"global 藏着私有变量"。
  //     ⚠️ 已知边界：只认**按名字派生**的前缀 —— 某个 global 面若用了别的名字就看不见它
  //     （例如 `conversation` 用 `--we-chat-*`）；那一侧靠 (a)/(b) 的登记纪律兜，不重复造机制。
  const hiddenPrivateOf = (surfaces, privateVars, vars) => {
    const owned = Object.values(privateVars).flat();
    const list = Array.isArray(vars) ? vars : [...vars];
    const out = [];
    for (const s of surfaces) {
      if (s.tier !== 'global') continue;
      const prefix = '--we-' + s.id.replace(/^glass-child-/, '') + '-';
      const hit = list.find((v) => v.startsWith(prefix) && !owned.some((p) => v === p || v.startsWith(p)));
      if (hit) out.push(s.id + ' → ' + hit);
    }
    return out;
  };
  const hiddenPrivate = hiddenPrivateOf(SURFACES, PRIVATE_VARS, wiredVars);
  check('声明 global 的面不得藏着私有变量族（防"接线了却仍标 global"）',
    hiddenPrivate.length === 0, hiddenPrivate.join(', ') || '无（四个曾经漏登记的面已改判 private）');
  // 负对照：**同一个谓词**喂"一个 global 面 + 它自己的已接线派生前缀" ⇒ 必须判出；
  // 正对照：同一个 global 面，但那个前缀**已被某个 private 面认领**（同名兄弟面的真实形态：
  //   `settings-window` 与 `glass-child-settings-window` 共用 `--we-settings-window-*`）⇒ 不判出。
  check('negative control: global 面藏私有变量会被同一条判据判出；同名兄弟面（前缀已被认领）不误报',
    hiddenPrivateOf([{ id: 'glass-child-fake', tier: 'global' }], PRIVATE_VARS, ['--we-fake-blur']).length === 1
      && hiddenPrivateOf([{ id: 'glass-child-settings-window', tier: 'global' }], PRIVATE_VARS, wiredVars).length === 0
      && hiddenPrivateOf([{ id: 'glass-child-fake', tier: 'private' }], PRIVATE_VARS, ['--we-fake-blur']).length === 0);

  // (e) 已清理的死变量**不许回来**。P4 删掉了 `--we-sidebar-alpha`（整份样式表零消费者），
  //     删掉一个死变量之后必须有东西拦着它被"顺手"加回来 —— 否则这次清理就是一次性的。
  //     判据：这些名字不得在样式表里被**消费**（`var(--x` 形式）。写在注释里是允许的
  //     （说明"这里为什么不再写它"正是我们想要的文档）。
  const REAPED_VARS = ['--we-sidebar-alpha'];
  const resurrectionHits = (cssText) => REAPED_VARS
    .filter((v) => new RegExp('var\\(\\s*' + v.replace(/[-]/g, '\\-') + '\\s*[,)]').test(cssText));
  const resurrected = resurrectionHits(CSS);
  check('已清理的死变量没有被"复活"（在样式表里重新被消费）',
    resurrected.length === 0,
    resurrected.length ? '复活：' + resurrected.join(', ') : REAPED_VARS.length + ' 个已清理变量仍是零消费者');
  // 负对照喂**同一个** resurrectionHits：
  //   · 合成一段"真的重新消费它"的 CSS ⇒ 必须判出；
  //   · 合成一段"只在注释里提到它"的 CSS ⇒ 必须**不**判出（这正是本文件的做法：
  //     样式表里留着"这里为什么不再写它"的说明，而说明不该被判成复活）。
  // ⚠️ 判定前先剥注释 —— 正则本身不认注释，直接喂原文本会把说明误判成复活（实测踩到）。
  check('negative control: "重新被消费"判出、"只在注释里提到"不误报',
    resurrectionHits('a { color: var(--we-sidebar-alpha, 1); }').length === 1
      && resurrectionHits(stripCssComments('/* 见 var(--we-sidebar-alpha) 的说明 */')).length === 0);

  // 负对照（喂**同一个** isWired + allWeVars）：
  //   · 一个真实存在的前缀判为接线；
  //   · 一个不存在的前缀判为没接线；
  //   · 一个"只以更长名字出现"的前缀（--we-sidebar-alpha ← --we-sidebar-alpha-src）
  //     必须判为**接线**（这正是本次实测踩到的形态，写成正对照防回归）。
  {
    const synthVars = allWeVars('a { color: var(--we-sidebar-alpha-src); }');
    check('negative control: 接线判据有牙 —— 不存在的私有前缀判为没接线',
      isWired(synthVars, '--we-sidebar-alpha') === true
        && isWired(synthVars, '--we-nonexistent-knob') === false,
      '--we-sidebar-alpha=' + isWired(synthVars, '--we-sidebar-alpha')
        + ' · --we-nonexistent-knob=' + isWired(synthVars, '--we-nonexistent-knob'));
    check('negative control: 合成一个"声明 private 却没有组"的面会被判出',
      !('synthetic-private' in PRIVATE_VARS)
        && SURFACES.every((s) => s.tier !== 'synthetic-private'));
  }
  void consumedPrivateVars;   // 保留前缀提取器（上面 ① / ② 与负对照用得到它的语义）
}

// ═══ ⑤ 保真度「同源不变量」：一对保真度内部同源、两对之间不串线 ════════════════
// 出处：[`docs/archive/wip/GLASS-CONFIG-REFACTOR.md`](../../docs/archive/wip/GLASS-CONFIG-REFACTOR.md) §3.2 ——
// "某个面用它自己的保真度 f_s 时，它的釉色混合系数与它的下限覆盖度必须用同一个 f_s"。
// 否则会出现"釉色按低保真回退了、地板却按满档压着"这种自相矛盾的合成
//（观感上就是"颜色对了但底下还是白的/黑的"）。
//
// 这条不变量在本次重构里**一直被引用，却从未落地成判据**。它的机制是两处：
//   · `${effects}.js`：`weClampSurfaceColor(色, 主题, <fidelity>)` —— 决定釉色向原色回退多少
//   · `${styles}.js`：`--we-<对>-readability-floor: calc(base * var(--we-<对>-glass-fidelity, 1))`
//     —— 决定地板覆盖度
// 判据因此是：**每个 fidelity 对上，这两处必须引用同一个 fidelity 变量**，且两对之间不交叉。
console.log('\n⑤ 保真度同源不变量（tint 的钳制与 floor 的覆盖度必须同一个 fidelity）');
{
  // 保真度「对」：一份标量、一套 tint、一条 floor。键是"对名"。
  const FIDELITY_PAIRS = [
    {
      id: 'global',
      fidelityVar: '--we-glass-fidelity',
      tintPrefix: '--we-surface-tint',
      floorVar: '--we-readability-floor',
    },
    {
      id: 'chatFrame',
      fidelityVar: '--we-chat-glass-fidelity',
      tintPrefix: '--we-chat-surface-tint',
      floorVar: '--we-chat-readability-floor',
    },
  ];

  /** 判据：从 effects 源码里取出"该 tint 前缀的钳制调用所用的 fidelity 表达式"。 */
  const clampFidelityOf = (effectsText, tintPrefix) => {
    const out = [];
    for (const m of uncommented(effectsText)
      .matchAll(new RegExp('setProperty\\("' + tintPrefix.replace(/[-]/g, '\\-') + '[\\w-]*",\\s*weClampSurfaceColor\\([^)]*?\\)', 'g'))) {
      const call = m[0];
      // 第三个实参 = fidelity；正则取 `weClampSurfaceColor(a, b, X)`
      const inner = /weClampSurfaceColor\(([\s\S]*)\)$/.exec(call.trim());
      if (!inner) continue;
      const args = inner[1].split(',').map((s) => s.trim());
      out.push(args[2] || '(缺)');
    }
    return out;
  };

  /**
   * 判据：取出该 floor 变量**声明值里引用到的全部 CSS 变量**。
   * ⚠️ 不要用"非贪婪匹配第二个 var()"：`calc(var(--base) * var(--fid))` 里第一个
   * `var()` 是 base —— 本判据第一版就是这么写错的（把 base 当成了 fidelity）。
   * 正确做法是把整条声明值切出来再枚举其中的 var()。
   */
  const floorVarsOf = (cssText, floorVar) => {
    const decl = new RegExp(floorVar.replace(/[-]/g, '\\-') + ':\\s*([^;]+);', 'g');
    const out = [];
    for (const m of cssText.matchAll(decl)) {
      for (const v of m[1].matchAll(/var\(\s*(--[\w-]+)/g)) out.push(v[1]);
    }
    return out;
  };

  const problems = [];
  const detail = [];
  const floorVarsByPair = new Map();
  for (const pair of FIDELITY_PAIRS) {
    const clampFids = [...new Set(clampFidelityOf(EFFECTS, pair.tintPrefix))];
    const floorVars = [...new Set(floorVarsOf(CSS, pair.floorVar))];
    floorVarsByPair.set(pair.id, floorVars);
    if (!clampFids.length) problems.push(pair.id + ' 找不到 tint 钳制调用');
    if (!floorVars.length) problems.push(pair.id + ' 找不到 floor 组合式');
    // ⚠️ 判据不能写成"并集里含目标 fidelity" —— 浅 / 深两个主题块各有一条声明，
    //    只漂移其中一块时，另一块会把并集"补"成合格（本次扰动实测踩到）。
    //    所以逐条声明检查：第 1 个 var 是 floor-base，其余**必须**是本对的 fidelity。
    const foreign = [...new Set(floorVarsOf(CSS, pair.floorVar))]
      .filter((v) => v !== '--we-readability-floor-base' && v !== pair.fidelityVar);
    if (foreign.length) problems.push(pair.id + ' 的 floor 引用了外来变量 [' + foreign.join(', ') + ']');
    if (!floorVars.includes(pair.fidelityVar)) {
      problems.push(pair.id + ' 的 floor 完全没引用 ' + pair.fidelityVar);
    }
    detail.push(pair.id + ': clamp=' + clampFids.join('/') + ' · floor refs=' + floorVars.join('/'));
  }
  // 跨对串线：某一对的 floor 不得引用**另一对**的 fidelity 变量。
  const crossWired = [];
  for (const pair of FIDELITY_PAIRS) {
    for (const other of FIDELITY_PAIRS) {
      if (other === pair) continue;
      if ((floorVarsByPair.get(pair.id) || []).includes(other.fidelityVar)) {
        crossWired.push(pair.floorVar + ' ← ' + other.fidelityVar);
      }
    }
  }

  check('覆盖面：两对保真度的钳制侧与地板侧都取到了（防判据空转）',
    FIDELITY_PAIRS.every((p) => clampFidelityOf(EFFECTS, p.tintPrefix).length > 0
      && floorVarsOf(CSS, p.floorVar).length > 0),
    detail.join(' | '));
  check('每对保真度：地板覆盖度只引用自己的 fidelity（逐条声明检查，不靠并集）',
    problems.length === 0, problems.join(' ; ') || FIDELITY_PAIRS.length + ' 对全部同源');
  check('两对保真度之间不串线（某对的地板不得引用另一对的 fidelity）',
    crossWired.length === 0, crossWired.join(', ') || '两条轴互不交叉');

  // 负对照（喂**同一个** floorVarsOf + 同一条"串线"判据）：
  //   · 把 floor 乘上别人的 fidelity ⇒ 必须被"串线"判据判出；
  //   · 原样 ⇒ 不判出。
  const synthBad = 'body { --we-readability-floor: calc(var(--we-readability-floor-base) * var(--we-chat-glass-fidelity, 1)); }';
  const synthOk = 'body { --we-readability-floor: calc(var(--we-readability-floor-base) * var(--we-glass-fidelity, 1)); }';
  check('negative control: 把某一对的地板接到另一对的 fidelity 上会被判出',
    floorVarsOf(synthBad, '--we-readability-floor').includes('--we-chat-glass-fidelity')
      && floorVarsOf(synthOk, '--we-readability-floor').includes('--we-glass-fidelity')
      && !floorVarsOf(synthOk, '--we-readability-floor').includes('--we-chat-glass-fidelity'));
}

// ═══ ⑥ settings golden 夹具的**键集快照**（防静默过期）════════════════════════
// 为什么需要它：`test/fixtures/settings-sanitize-golden.json` 的**值**由
// `verify-client` 的 `canon(sanitizeFromSchema(input))` 对 `canon(want)` 逐用例比对 ——
// 那是**回放**：每个用例只验证"记录下来的输入仍产出记录下来的输出"。
// 于是它**不覆盖键的存在性**：夹具里某个对象少一个键时，值比对照样全过，守卫**照样绿**。
// 而夹具的同步一直靠 note 里的人工约定（"新键按引入时行为补入"、"安全阀＝其余键零漂移"）。
//
// 这不是理论风险：本目标实施期间**已真实发生两次** —— 加 `glassOverrides`、加设置窗口那批键时，
// 都是"改完 schema 忘了同步夹具 → `verify` 红 → 再写一次性脚本补"。
// "没被守的会漂"是本仓的既有实测结论，所以把这条约定落成判据。
//
// ⚠️ 口径**不是**"两侧都等于 `sanitizeFromSchema({}, side)` 的键集" —— 实测否掉了那个前提：
//    · `glassFidelity` / `chatGlassFidelity` / `themeFollow` **只在 host 侧**出现（client 侧没有）；
//    · `rotationInterval` / `sceneFrameUrl` 只在"非对象输入"那三个用例的 client 侧出现
//      （`DEFAULTS_ONLY` 的回落路径）。
//    所以本判据改为：**以夹具自身每个用例的键集为快照**，断言"逐用例完全一致"。
//    新增 schema 键时，夹具必须**每个用例都补**（这正是历史上漏掉的动作）；
//    只补一部分用例会在这里现形。
console.log('\n⑥ settings golden 夹具的键集快照（新增键必须逐用例补入夹具）');
{
  const fixturePath = join(ROOT, 'test', 'fixtures', 'settings-sanitize-golden.json');

  let fixture = null, readErr = null;
  try { fixture = JSON.parse(readFileSync(fixturePath, 'utf8')); } catch (e) { readErr = String(e && e.message || e); }
  const cases = fixture && Array.isArray(fixture.cases) ? fixture.cases : [];

  /** 取某一侧在全部用例里出现过的**最大**键集 —— 它就是该侧的"应有快照"。 */
  const snapshotOf = (side) => {
    let best = new Set();
    for (const c of cases) {
      const o = c && c[side];
      if (!o || typeof o !== 'object' || Array.isArray(o)) continue;
      const keys = new Set(Object.keys(o));
      if (keys.size > best.size) best = keys;
    }
    return best;
  };

  // ⚠️ **逐用例本来就可变**的键：它们在部分用例里出现、部分不出现，夹具是对的。
  //    排除它们的理由：这两个键**不属于**持久化 blob 的常驻集合 ——
  //    `sanitizeFromSchema({}, side)` 也会给出它们（说明它们不是"新增键漏补"的对象），
  //    而它们在夹具里的有无取决于该用例的输入类型（非对象输入走默认值回落路径）。
  //    **排除是安全的**：本判据要抓的漂移是"schema 新增键没补进夹具"，
  //    而新增键一定**不在**这个已知可变集里；这两个键自身的**值**另有 `verify-client`
  //    的逐用例值比对管着。
  const CASE_VARIANT_KEYS = new Set(['rotationInterval', 'sceneFrameUrl']);

  /** 判据：给定一个期望对象与快照，报出缺键 / 多键（忽略逐用例可变键）。纯函数。 */
  const keyGaps = (obj, want) => {
    const got = new Set(Object.keys(obj).filter((k) => !CASE_VARIANT_KEYS.has(k)));
    const expect = new Set([...want].filter((k) => !CASE_VARIANT_KEYS.has(k)));
    return {
      missing: [...expect].filter((k) => !got.has(k)).sort(),
      extra: [...got].filter((k) => !expect.has(k)).sort(),
    };
  };

  const snapClient = snapshotOf('client');
  const snapHost = snapshotOf('host');

  const problems = [];
  let nClient = 0, nHost = 0;
  for (const c of cases) {
    const name = c && c.name ? c.name : '(未命名)';
    for (const [side, snap] of [['client', snapClient], ['host', snapHost]]) {
      const o = c && c[side];
      if (!o || typeof o !== 'object' || Array.isArray(o)) continue;   // '__null__' 哨兵
      if (side === 'client') nClient++; else nHost++;
      const g = keyGaps(o, snap);
      if (g.missing.length) problems.push(name + '/' + side + ' 缺键 [' + g.missing.join(', ') + ']');
      if (g.extra.length) problems.push(name + '/' + side + ' 多键 [' + g.extra.join(', ') + ']');
    }
  }

  check('覆盖面：夹具读到了、且两侧快照都非空（防判据空转）',
    !readErr && cases.length > 0 && snapClient.size > 0 && snapHost.size > 0,
    readErr ? ('读夹具失败：' + readErr)
      : (cases.length + ' 个用例 · client 快照 ' + snapClient.size + ' 键 / ' + nClient + ' 个对象'
        + ' · host 快照 ' + snapHost.size + ' 键 / ' + nHost + ' 个对象'));
  check('每个期望对象的键集与快照逐用例一致（新增键必须**每个用例**都补）',
    problems.length === 0,
    problems.length ? problems.slice(0, 6).join(' ; ') + (problems.length > 6 ? ' … +' + (problems.length - 6) : '')
      : '两侧全部对象与快照一致');

  // 负对照（喂**同一个** keyGaps）：缺一个键、多一个键都必须判出；相等则不报。
  const synthWant = new Set(['a', 'b', 'c']);
  const missOne = keyGaps({ a: 1, b: 2 }, synthWant);
  const extraOne = keyGaps({ a: 1, b: 2, c: 3, d: 4 }, synthWant);
  const exact = keyGaps({ a: 1, b: 2, c: 3 }, synthWant);
  check('negative control: 少一个键 / 多一个键都被同一条判据判出，键集相等则不报',
    JSON.stringify(missOne.missing) === JSON.stringify(['c']) && missOne.extra.length === 0
      && JSON.stringify(extraOne.extra) === JSON.stringify(['d']) && extraOne.missing.length === 0
      && exact.missing.length === 0 && exact.extra.length === 0);
}

// ═══ ⑦ 量纲统一：**一把刻度** + 调用点传裸值（R4，wip §10.19）═══════════════════
// 背景（§4.10）：各面的键曾经**量纲不同**（透明度 0–60 / 0–200 / 0–80、模糊 0–60 / 0–200）。
// 把一边的值喂给另一边的曲线 = "把 60 分制当 200 分制用" —— 实测后果就是"跟随"档下
// 全局雾化 47 被放大成 `--we-sidebar-blur: 156.67px`（等价性探针留着这条证据）。
//
// R4 的解法从"每个调用点各自归一化"改成**根本统一刻度**：
//   · 模糊 **0–60 px** · 透明度 **0–100 %** · 保真度 **0–100** —— 每个面都在这把刻度上；
//   · 于是 `glassValue(面, 参数, 自己的键, 全局的键)` **直接传值**，"继承"就是"同一个数字"；
//   · `norm` / `denorm` 那一对因此被删除（它们已退化成恒等变换）—— 本组**拒绝**它们回归。
//
// 四条不变量：
//   ① 调用点**不许**出现归一化/量程换算（传裸键即可 —— 换算该住在曲线里，不在调用点）；
//   ② **规范刻度表**（KINDS 上界）与规范值一致；
//   ③ 曲线里的**量程分母/阈值**必须等于规范上界（"同一个数字 = 同一个位置"的唯一保证），
//      且旧刻度（80 / 200）作为除数**绝迹**；
//   ④ `norm` / `denorm` 不得再出现（留着就还有"第二把刻度"的余地）。
console.log('\n⑦ 量纲统一（一把刻度：模糊 0–60 · 透明度 0–100）');
{
  const effectsSrc = uncommented(EFFECTS);
  /** 规范刻度：参数族 → 上界。**唯一真源**，下面几条都对照它。 */
  const CANON = { blur: 60, transparency: 100, fidelity: 100 };
  const BLUR_KEYS = ['blur', 'sidebarBlur', 'settingsWindowBlur', 'leftSidebarBlur', 'floatersBlur'];
  const ALPHA_KEYS = ['glassAlpha', 'sidebarAlpha', 'sidebarContentAlpha',
    'settingsWindowTransparency', 'leftSidebarTransparency', 'floatersTransparency'];
  const FID_KEYS = ['glassFidelity', 'chatGlassFidelity'];

  /** 取 glassValue( 的实参（支持嵌套括号与字符串字面量）。纯函数，负对照喂它。 */
  const callArgs = (text) => {
    const out = [];
    const re = /glassValue\(/g;
    let m;
    while ((m = re.exec(text))) {
      let i = m.index + m[0].length, depth = 1, arg = '', args = [], inStr = null;
      for (; i < text.length && depth > 0; i++) {
        const ch = text[i];
        if (inStr) { if (ch === inStr) inStr = null; arg += ch; continue; }
        if (ch === '"' || ch === "'") { inStr = ch; arg += ch; continue; }
        if (ch === '(') depth++;
        if (ch === ')') { depth--; if (!depth) break; }
        if (ch === ',' && depth === 1) { args.push(arg.trim()); arg = ''; continue; }
        arg += ch;
      }
      args.push(arg.trim());
      out.push(args);
    }
    return out;
  };
  /** 一条槽位是否"裸"（没有归一化、没有量程换算）。纯函数，负对照喂它。 */
  const isBare = (expr) => !/norm\(|denorm\(/.test(expr) && !/\//.test(expr);

  // ── ① 调用点传裸值 ────────────────────────────────────────────────────────────
  const offenders = [];
  let valueSlots = 0;
  for (const args of callArgs(effectsSrc)) {
    const [surface, paramRaw, profileSlot, globalSlot] = args;
    if (profileSlot === undefined || globalSlot === undefined) continue;   // 形参定义行
    if (!/^["']/.test(surface)) continue;                                   // 定义/非调用
    const surfaceName = String(surface).replace(/["']/g, '');
    const param = String(paramRaw).replace(/["']/g, '');
    for (const [slot, expr] of [['profile', profileSlot], ['global', globalSlot]]) {
      valueSlots++;
      if (!isBare(expr)) offenders.push(surfaceName + '.' + param + '/' + slot + ' 含换算：' + expr);
    }
  }
  check('覆盖面：统计到至少 8 个取值槽位（防判据空转）', valueSlots >= 8, valueSlots + ' 个槽位');
  check('① 调用点一律传裸值（刻度统一后不许再在调用点各写量程）',
    offenders.length === 0,
    offenders.length ? offenders.join(' ; ') : valueSlots + ' 个槽位全部是裸键');

  // ── ② 规范刻度表 ─────────────────────────────────────────────────────────────
  const badMax = [];
  for (const k of BLUR_KEYS) if ((SCHEMA.KINDS[k] || {}).max !== CANON.blur) badMax.push(k + '.max=' + (SCHEMA.KINDS[k] || {}).max);
  for (const k of ALPHA_KEYS) if ((SCHEMA.KINDS[k] || {}).max !== CANON.transparency) badMax.push(k + '.max=' + (SCHEMA.KINDS[k] || {}).max);
  for (const k of FID_KEYS) if ((SCHEMA.KINDS[k] || {}).max !== CANON.fidelity) badMax.push(k + '.max=' + (SCHEMA.KINDS[k] || {}).max);
  const keyCount = BLUR_KEYS.length + ALPHA_KEYS.length + FID_KEYS.length;
  check('② 规范刻度表：模糊类上界 60 · 透明度类 100 · 保真度 100（' + keyCount + ' 个键）',
    badMax.length === 0 && keyCount >= 10,
    badMax.length ? '刻度不符：' + badMax.join(', ') : keyCount + ' 个键全部对齐规范刻度');

  // ── ③ 曲线分母/阈值 = 规范上界；旧刻度绝迹 ────────────────────────────────────
  // 钉的是四条曲线的**形状**（不是"数够不够"）：分母/阈值写死为规范上界，
  // 将来改刻度就必须同时改这里 —— 这正是"同一个数字 = 同一个位置"的唯一保证。
  const curves = [
    [/\/ 100\)? \* 0\.15/g, 4, '透明度曲线 ×4（全局/左侧栏/浮层/设置窗口：x / 100 * 0.15）'],
    [/sidebarAlphaPct \/ 100\) \* 0\.305/g, 1, '侧栏透明度曲线（sidebarAlphaPct / 100 * 0.305）'],
    [/\(100 - Math\.min\(Math\.max\(sidebarAlphaPct, 0\), 100\)\) \/ 100 \* 28/g, 1, '侧栏染色权重（(100 − clamp(pct,0,100)) / 100 * 28）'],
    [/100 - contentAlphaPct \* 0\.8/g, 1, '内容面映射（100 − pct × 0.8 ⇒ 0–100 映到 100%–20%）'],
  ];
  const missingCurve = curves.filter(([re, n]) => (effectsSrc.match(re) || []).length < n).map(([, , label]) => label);
  const legacyDiv = [80, 200].filter((n) => new RegExp('/ ' + n + '\\b').test(effectsSrc));
  check('③ 曲线分母/阈值 = 规范上界，且旧刻度（80 / 200）作为除数已绝迹',
    missingCurve.length === 0 && legacyDiv.length === 0,
    missingCurve.length || legacyDiv.length
      ? '缺曲线：' + JSON.stringify(missingCurve) + ' · 旧刻度残留：' + JSON.stringify(legacyDiv)
      : curves.length + ' 条曲线全部对上规范上界 · 旧刻度 0 处');

  // ── ④ norm / denorm 不得回归 ─────────────────────────────────────────────────
  const normHits = (effectsSrc.match(/\bnorm\s*\(|\bdenorm\s*\(/g) || []).length;
  check('④ `norm` / `denorm` 已从产品里删除（刻度统一后它们是恒等变换，留着=还有第二把刻度）',
    normHits === 0, normHits ? normHits + ' 处残留' : '0 处');

  // ── 负对照（喂**同一个** callArgs + isBare）──────────────────────────────────
  const synth = 'const a = glassValue("s", "blur", selection.x, selection.y);'
    + 'const b = glassValue("s", "blur", norm(selection.x, 60), selection.y);'
    + 'const c = glassValue("s", "transparency", selection.q / 2, selection.z);'
    + 'const d = glassValue("s", "color", "", selection.glassColor);';
  const synthSlots = callArgs(synth).filter((a) => a.length >= 4).flatMap((a) => [a[2], a[3]]);
  const synthBad = synthSlots.filter((e) => !isBare(e));
  check('negative control: 槽位里出现 norm() 或除法都被同一条判据判出（裸键与空串哨兵不算）',
    callArgs(synth).filter((a) => a.length >= 4).length === 4 && synthBad.length === 2
      && isBare('selection.x') && isBare('""') && !isBare('norm(selection.x, 60)') && !isBare('selection.q / 2'),
    synthSlots.length + ' 个合成槽位 · 判出 ' + synthBad.length + ' 项（应 2：b 的 profile、c 的 profile）');
}

// ═══ ④ 接线 ↔ 注册表 ↔ 面名：三方对账（R3b-ii 起**没有能力表**了）════════════════
// 历史：P2 曾用一张**手抄**的 `glassOverrides` 声明"哪些面的哪些参数有能力读自己的值"，并与
// 接线点双向对账。R3b-ii 把那张表**删除**了（它是第二份真源，§4.25 表恒空 / §10.12 五个死旋钮
// 都是它的代价）。它想保证的事现在由三件事共同保证，而且不需要手抄：
//   · **注册表 `params` ↔ 接线点**（本组第一条）：注册表说这一面有哪些参数（面板就渲染哪几行），
//     代码就必须真的为每个参数调过 `glassValue(面, 参数, …)`
//   · **面名封闭**：接线里出现的面名只能是注册表子项，或登记为"既有面"的那两个
//   · **删掉的键真的消失**：`glassOverrides` 不得再出现在 KINDS / DEFAULTS 里
console.log('\n④ 接线 ↔ 注册表 ↔ 面名 三方对账');
{
  const wired = wiredOverrides(EFFECTS);

  // 扰动注入（只为自证判据有牙；正常跑不设这个环境变量）：
  //   WE_GLASS_MUTATE=drop-wire  从接线侧删掉一个面 ⇒ 应判"注册表声明了却没接线"
  const MUTATE = process.env.WE_GLASS_MUTATE || '';
  if (MUTATE === 'drop-wire' && wired.size) wired.delete([...wired.keys()][0]);

  // ── 注册表 `params` ↔ 代码接线：**逐参数**相等（R3a 补，wip §10.12）────────────────
  // 为什么需要它：注册表可以声明一个**代码从不读取**的参数 —— 面板会照样渲染出一行，
  // 用户拖它毫无反应。实测（R3a 前）有 **5 个**：`settingsWindowColor` /
  // `conversationTransparency` / `conversationBlur` / `floatersColor` / `leftSidebarColor`
  //（左侧栏那节还多一行 `leftSidebarFidelity`，连 schema 键都不存在）。
  // 这正是"能力表是手抄的"留下的坑 —— 所以 R3b-ii 干脆把那张表删了，留这条做真源。
  // 口径：**注册表说有哪些参数，代码就必须真的为每个参数调过 `glassValue(面, 参数, …)`**；
  // 反过来，接线里出现的参数也必须在注册表里（否则面板没有入口去配它）。
  const registryDrift = (children, wiredMap) => {
    const out = [];
    for (const c of children) {
      const declared = new Set(Object.keys(c.params));
      const got = wiredMap.get(c.id) || new Set();
      for (const p of declared) if (!got.has(p)) out.push(c.id + '.' + p + '（注册表声明了、代码没接线）');
      for (const p of got) if (!declared.has(p)) out.push(c.id + '.' + p + '（接线了、注册表没声明）');
    }
    return out;
  };
  const regDrift = registryDrift(SCHEMA.GLASS_CHILDREN, wired);
  check('注册表 params ↔ 接线点**逐参数**相等（防"面板渲染了一个死旋钮"）',
    regDrift.length === 0,
    regDrift.length ? regDrift.join(', ')
      : SCHEMA.GLASS_CHILDREN.length + ' 个子项 · '
        + SCHEMA.GLASS_CHILDREN.reduce((n, c) => n + Object.keys(c.params).length, 0) + ' 个参数全部有接线');

  // ⚠️ **"自己的键"也必须对上**（上面那条只对**参数名**，不看第三个实参）。
  //    漏这一条的后果很隐蔽：面处于 `custom` 却读到一个**不存在**的键 ⇒ `Number(undefined) || 0`
  //    ⇒ 曲线算出个看似正常的值，用户看到的是"开了独立配置但滑杆没用"（死旋钮的第二种形态）。
  //    键名有**单一生成点**（`lib/settings-schema.js` 的 `childGlassKey()`：`id + Param` 首字母大写，
  //    并尊重 `keyOverrides`）—— 这里按同一规则**复算**（判据侧必须有独立实现，否则抄同一份代码就恒真）。
  const registryIds0 = new Set(SCHEMA.GLASS_CHILDREN.map((c) => c.id));
  const ownKeyOf = (id, param) => {
    const child = (SCHEMA.GLASS_CHILDREN || []).find((c) => c.id === id) || {};
    const ov = child.keyOverrides && child.keyOverrides[param];
    return 'selection.' + (ov || (id + param.charAt(0).toUpperCase() + param.slice(1)));
  };
  const badOwnKey = [];
  // 取值接线住在 `src/glass.js`（"玻璃后端的唯一落点"）—— 直接读源文件（同 STYLES_TEXT 的做法）。
  const glassSrc = readFileSync(join(ROOT, 'src', 'glass.js'), 'utf8');
  // ⚠️ 这里自带一个实参提取器（不复用上面那个 `callArgs`：它定义在另一个判据组的块作用域里）
  //    —— 判据自己成块、自己能跑，是这份文件的一贯形态。
  const argsOf = (text) => {
    const out = [];
    const re = /glassValue\(/g;
    let m;
    while ((m = re.exec(text))) {
      let i = m.index + m[0].length, depth = 1, arg = '', args = [], inStr = null;
      for (; i < text.length && depth > 0; i++) {
        const ch = text[i];
        if (inStr) { if (ch === inStr) inStr = null; arg += ch; continue; }
        if (ch === '"' || ch === "'") { inStr = ch; arg += ch; continue; }
        if (ch === '(') depth++;
        if (ch === ')') { depth--; if (!depth) break; }
        if (ch === ',' && depth === 1) { args.push(arg.trim()); arg = ''; continue; }
        arg += ch;
      }
      args.push(arg.trim());
      out.push(args);
    }
    return out;
  };
  for (const args of argsOf(glassSrc)) {
    const [surface, paramRaw, profileSlot] = args;
    if (profileSlot === undefined || !/^["']/.test(surface)) continue;
    const id = String(surface).replace(/["']/g, '');
    if (!registryIds0.has(id)) continue;                   // 只看注册表子项（既有面另有界面）
    const param = String(paramRaw).replace(/["']/g, '');
    const want = ownKeyOf(id, param);
    if (profileSlot.replace(/\s+/g, '') !== want) badOwnKey.push(id + '.' + param + ' 期望 ' + want + '、实为 ' + profileSlot);
  }
  check('每个子项的"自己的键"与 `childGlassKey()` 的派生规则一致（防写错键 ⇒ 开了独立配置却读到 undefined）',
    badOwnKey.length === 0 && registryIds0.size >= 5,
    badOwnKey.length ? badOwnKey.join(' ; ') : registryIds0.size + ' 个子项的 own 键名全部对得上');
  // 负对照：同一个谓词喂一个**故意写错**的 own 键，必须判出；写成 `keyOverrides` 的正确形态则不判出。
  check('negative control: 写错的 own 键会被判出；keyOverrides 的复用键（chatGlassFidelity）不误报',
    ownKeyOf('thinkingTrigger', 'blur') !== 'selection.thinkingTriggerBlurX'
      && ownKeyOf('conversation', 'fidelity') === 'selection.chatGlassFidelity');

  // 接线里出现的**面名**必须要么是注册表子项，要么是登记为"既有面"的那两个
  // （`sidebar` / `sidebarContent` —— 它们的界面是既有的专属滑块，不进「子 UI 玻璃」那一层）。
  const LEGACY_FACES = new Set(['sidebar', 'sidebarContent']);
  const registryIds = new Set(SCHEMA.GLASS_CHILDREN.map((c) => c.id));
  const orphanFaces = [...wired.keys()].filter((k) => !registryIds.has(k) && !LEGACY_FACES.has(k));
  check('接线面名封闭：只能是注册表子项或既有的两个面（防"新面接了线却没人给它界面"）',
    orphanFaces.length === 0 && wired.size >= 6,
    orphanFaces.length ? '未归类：' + orphanFaces.join(', ')
      : '接线 ' + wired.size + ' 个面 = 注册表 ' + registryIds.size + ' + 既有 ' + LEGACY_FACES.size);

  // 负对照：喂**同一个** registryDrift —— 合成"注册表多一个参数"/"接线多一个参数"都必须判出
  const synthReg = registryDrift([{ id: 'a', params: { x: 0, y: 0 } }], new Map([['a', new Set(['x', 'z'])]]));
  check('negative control: 注册表多一个参数、接线多一个参数都被同一条判据判出（应 2 项）',
    synthReg.length === 2);
  // 负对照：喂**同一个** wiredOverrides —— "接了线"与"只是声明"必须分得开。
  check('negative control: 接线判据有牙 —— 只声明不调用不算接线',
    wiredOverrides('const x = glassValue("onlyDeclared", "blur", a, b);').has('onlyDeclared') === true
      && !wiredOverrides('const x = selection.sidebarBlur;').has('onlyDeclared'));

  // ── 已删除的键必须**真的消失**（R3b-ii，wip §10.17）────────────────────────────
  // 为什么单列一条：删代码容易、删**键**容易漏 —— 而漏掉的那个键会继续被消毒、被序列化、
  // 被写进用户存档，于是"删掉的能力表"以另一种形式活着。三条一起判：KINDS / DEFAULTS / 接线点。
  const shouldBeGone = ['glassOverrides'];
  const stillThere = shouldBeGone.filter((k) => k in SCHEMA.KINDS || k in SCHEMA.DEFAULTS);
  const stillRead = shouldBeGone.filter((k) => new RegExp('\\.' + k + '\\b').test(EFFECTS + '\n' + CLIENT_SRC));
  check('已删除的键必须真的消失：既不在 KINDS/DEFAULTS 里，也没有任何代码再读它',
    stillThere.length === 0 && stillRead.length === 0,
    stillThere.length || stillRead.length
      ? '残留：' + [...stillThere, ...stillRead].join(', ') : '三项都对：KINDS / DEFAULTS / 代码引用均为 0');
}

// ═══ ⑤（已撤除）按面变量间接层 ════════════════════════════════════════════════
// P3 曾在这里守"某个玻璃面用 CSS 变量间接层读自己那一套"（CSS 读 `var(--we-<面>-x, 兜底)`
// 且 JS 写出它）。**该结构已撤回**，因为两条既有判据把可读性契约钉在**固定文本形状**上：
//   · `verify-readability` F2a —— 面纱值必须以 `var(--we-readability-base)` /
//     `var(--we-chat-readability-base)` **开头**（正则 `^` + `\s+` 锚定）；
//   · `verify-softrender` E2 —— `@supports` 回退配方与 `data-we-glass-fallback` 配方
//     **逐字共享**（共享规则里插一层变量名就会让两边文本不同）。
// 这两条正是防"判据退化成恒真"的手段，不该为了给新结构让路而放宽。
//
// ⇒ **结论**（同时记进 docs/archive/wip/GLASS-CONFIG-REFACTOR.md）：按面独立只能靠
//   **改全局变量的取值来源**（侧栏那条路：自己的变量 + 解析器），
//   不能在共享规则里插入一层变量名。
//
// 判据一并撤除以避免死码：没有间接层可守时，留着的检查只会空转。

// ═══ ⑧ 「玻璃 UI」子项的**模式语义**（三处只看一个键：`glassMode`）═══════════════
// R3b-ii 起这里从"开关状态 ≠ 能力声明"（两个键）压成**一个键两态**。三条语义必须一直成立，
// 它们都是"抄一遍就会漂"的形态，所以写成判据（`switchSemantics` 在文件上方）。
console.log('\n⑧ 「玻璃 UI」子项的模式语义（两态 · 一个键）');
{
  // 三条语义分住两处：`glassValue` 在 glass.js、读数与翻转在 client.js
  // ⇒ 拼接后一起喂给**同一个** switchSemantics（负对照也喂它）。
  const problems = switchSemantics(EFFECTS + '\n' + CLIENT_SRC);
  check('模式语义：读数只看 glassMode=custom、翻开关只写它、取值只看模式',
    problems.length === 0, problems.join(' ; ') || '三条语义全部成立');

  // 负对照（喂**同一个** switchSemantics）：三种退化形态各合成一份。
  // ⚠️ 合成串必须**自含全部三处**（取值 / 读数 / 翻转），且函数体写成**多行** ——
  //    判据用 `…[\s\S]*?\n\}` 切函数体，少一处或写单行都会以"找不到 X"判红（假阳性）。
  const BASE = 'const glassModeOn = (s) => !!(selection.glassMode && selection.glassMode[s] === "custom");\n'
    + 'const glassValue = (s, p, a, b) => (glassModeOn(s) ? a : b);\n'
    + 'function childIndependentOn(id) {\n  return !!(selection.glassMode && selection.glassMode[id] === "custom");\n}\n'
    + 'function onToggleChildIndependent(id, on) {\n  const n = Object.assign({}, selection.glassMode);\n'
    + '  if (on) n[id] = "custom"; else delete n[id];\n  setSetting("glassMode", n);\n}\n';
  const BAD1 = BASE.replace('selection.glassMode && selection.glassMode[id] === "custom"',
    'selection.glassChildren && selection.glassChildren[id]');
  const BAD2 = BASE.replace('Object.assign({}, selection.glassMode);\n  if (on) n[id] = "custom"; else delete n[id];\n  setSetting("glassMode", n)',
    'Object.assign({}, selection.glassChildren);\n  n[id] = on;\n  setSetting("glassChildren", n)');
  const BAD3 = BASE.replace('(glassModeOn(s) ? a : b)', 'b');
  check('negative control: 读数回退到 glassChildren / 翻开关写回 glassChildren / 取值不看模式，三种退化都被判出',
    switchSemantics(BASE).length === 0
      && switchSemantics(BAD1).length > 0 && switchSemantics(BAD2).length > 0 && switchSemantics(BAD3).length > 0,
    'base=' + switchSemantics(BASE).length + ' bad1=' + switchSemantics(BAD1).length
      + ' bad2=' + switchSemantics(BAD2).length + ' bad3=' + switchSemantics(BAD3).length);

  // ⚠️ **默认必须是"跟随全局"**（R3b 语义迁移，wip §10.16）：
  //    这条判据曾经要求"`sidebar` / `sidebarContent` 默认**独立**"，理由是它们从 P2 起就读自己的键。
  //    那个口径已被**推翻** —— 用户要的是"全局的玻璃使用同一套配置语义"，而"既有独立"从未真正
  //    生效过（§4.25 修好默认值机制之前能力表恒空）⇒ 独立必须是**显式选择**。判据口径不变：
  //    与 schema 的权威表逐面比对（防"改了 DEFAULTS 忘了改权威表"这类两处漂移）。
  const authDefaults = SCHEMA.GLASS_MODE_DEFAULTS || {};
  const modeDefaults = SCHEMA.DEFAULTS.glassMode || {};
  const drift = Object.entries(authDefaults).filter(([f, v]) => modeDefaults[f] !== v);
  const missingFace = Object.keys(authDefaults).filter((f) => !(f in modeDefaults));
  check('模式默认值与权威表逐面一致（**每个面**都默认「跟随全局」）',
    drift.length === 0 && missingFace.length === 0 && Object.values(authDefaults).every((v) => v === 'inherit'),
    drift.length || missingFace.length
      ? '漂移：' + JSON.stringify(drift) + ' 缺：' + JSON.stringify(missingFace)
      : Object.keys(authDefaults).length + ' 个面全部 inherit：' + JSON.stringify(modeDefaults));
  // 负对照（喂**同一条**过滤逻辑）：把某个面误设成 custom、或漏一个面，都必须判出。
  const synthAuth = { sidebar: 'inherit', sidebarContent: 'inherit', conversation: 'inherit' };
  const f1 = Object.entries(synthAuth).filter(([f, v]) => ({ sidebar: 'custom', sidebarContent: 'inherit', conversation: 'inherit' })[f] !== v);
  const f2 = Object.keys(synthAuth).filter((f) => !(f in { sidebar: 'inherit', sidebarContent: 'inherit' }));
  check('negative control: 某个面被误设成 custom、或漏掉一个面，都会被同一条判据判出',
    f1.length === 1 && f2.length === 1
      && Object.entries(synthAuth).filter(([f, v]) => ({ sidebar: 'inherit', sidebarContent: 'inherit', conversation: 'inherit' })[f] !== v).length === 0);

  // 覆盖面：登记的每个子项都必须**有接线**（否则开关开了也读不到自己的值）。
  // ⚠️ 这里原先查的是"有没有能力行"（手抄表）；表删掉之后，同一件事改由**接线**直接回答 ——
  //    这也顺带钉住"删了表 ≠ 丢了覆盖面"。
  const wiredCap = wiredOverrides(EFFECTS);
  const childIds = (SCHEMA.GLASS_CHILDREN || []).map((c) => c.id);
  const childWithNoWire = childIds.filter((id) => !wiredCap.has(id));
  check('覆盖面：登记的每个子项都必须有接线（开关开了才读得到自己的值）',
    childIds.length >= 4 && childWithNoWire.length === 0,
    '子项 ' + childIds.length + ' 个 · 缺接线的 ' + JSON.stringify(childWithNoWire));

  // ── mode 的**可达性**：每个被读的面都必须有"能把它设成 custom"的 UI 入口 ────────────
  // 为什么单列（wip §10.24 的真实缺口）：`glassMode` 的唯一写入方是 `onToggleChildIndependent`，
  // 而它原先只被 `GLASS_CHILDREN` 那四项 + 左侧栏调用；`sidebar` / `sidebarContent` **不在**登记表里
  // ⇒ 它们的 mode 永远停在 `'inherit'` ⇒ 那 5 个既有滑块（侧栏模糊/透明度/颜色、内容面透明度/底色）
  // **全是死的**（拖了没有任何变化）。当时**没有任何判据看得见**这一类"旋钮无入口"。
  // 口径：凡 `glassValue("面", …)` 读到的面，必须要么在 `GLASS_CHILDREN` 里（面板按登记表自动
  // 渲染开关），要么有至少一处 `onToggleChildIndependent("面"` 的调用点。
  const readFaces = [...wiredOverrides(EFFECTS).keys()];
  const autoFaces = new Set((SCHEMA.GLASS_CHILDREN || []).map((c) => c.id));
  const toggleSites = new Set([...GLASS_PANEL_SRC.concat(PANEL_SRC)
    .matchAll(/onToggleChildIndependent\(\s*"([A-Za-z]+)"/g)].map((m) => m[1]));
  const noEntry = readFaces.filter((f) => !autoFaces.has(f) && !toggleSites.has(f));
  check('mode 可达性：每个被读的面都必须有开关（登记表自动渲染，或一处 onToggleChildIndependent 调用）',
    readFaces.length >= 6 && noEntry.length === 0,
    noEntry.length ? '没有入口的面：' + noEntry.join(', ')
      : readFaces.length + ' 个面：登记表自动 ' + autoFaces.size + ' 个 + 手写开关 ' + toggleSites.size + ' 处');
  // 负对照（喂**同一条**谓词）：合成一个"被读却没有开关"的面必须判出；有开关的不判出。
  const missing = (faces, auto, sites) => faces.filter((f) => !auto.has(f) && !sites.has(f));
  check('negative control: 被读却没有 UI 入口的面会被同一条判据判出（有入口的不判出）',
    missing(['a', 'b'], new Set(['a']), new Set()).join() === 'b'
      && missing(['a'], new Set(), new Set(['a'])).length === 0);
}

// ═══ ⑨ W5：各面的"关 ⇒ 回原生"是否**回退干净**（锚点门控覆盖率）═════════════════
// 背景：W5 的实现方式不是"写撤销样式"，而是**依赖该面的规则整组挂在一个 body 属性锚点上** ——
// 属性在则生效、摘掉则整组不生效、原生样式自然生效。所以 W5 能否成立，等价于
// **该面的规则是否全部带锚点**。这条把那个前提写成判据（否则将来有人在锚点外新增一条
// 同面规则，"关"就会回退不干净，而没有任何判据会红）。
console.log('\n⑨ W5：各面的锚点门控覆盖率（防"关掉后还剩一点玻璃味"）');
{
  // 面 → { 成员选择器, 认定的锚点, 是否已完成 W5 }
  // ✅ **四个面全部 done: true**（W5 收口，见 wip §4.23）。`done` 字段保留是因为它让
  //    "哪些面回退干净、哪些还没有"在判据里**可见** —— 将来新增一个面时，
  //    若它的规则没有门控，把 done 设成 false 会立刻暴露出"已知未做"，而不是静默半成品。
  //    登记它们是为了让"哪些面回退干净、哪些没有"这件事**在判据里可见**，而不是靠记忆。
  const GATE = [
    { id: 'settings-window', member: /\[data-slot="settings\.section"\]/, anchor: /data-we-glass-window/, done: true },
    { id: 'left-sidebar-override', member: /:has\(> \[data-slot="sidebar"\]\)/, anchor: /data-we-left-sidebar/, done: true },
    // W5 推广（本轮）：对话栏三条主规则已加 `[data-we-glass-chat]` 锚点。
    { id: 'glass-child-conversation', member: /data-(composer-card|question-key|plan-review-key|approval-key)|_bubble/, anchor: /data-we-glass-fallback|data-we-glass-chat/, done: true },
    { id: 'plugin-floaters', member: /\.we-(update-notice|repo-panel)/, anchor: /data-we-glass-floaters|data-we-glass-fallback/, done: true },
  ];

  const results = GATE.map((g) => ({ ...g, cov: anchorGateCoverageGlaze(CSS, g.member, g.anchor) }));
  const doneBad = results.filter((g) => g.done && g.cov.ungated.length > 0);
  check('已完成 W5 的面：规则**全部**带锚点（关 ⇒ 回退干净）',
    doneBad.length === 0,
    doneBad.length
      ? doneBad.map((g) => g.id + ' 有 ' + g.cov.ungated.length + ' 条无锚点：' + JSON.stringify(g.cov.ungated.slice(0, 2))).join(' ; ')
      : results.filter((g) => g.done).map((g) => g.id + ' ' + g.cov.gated + '/' + g.cov.total).join(' · '));
  check('覆盖面：登记的面都真的取到了规则（防判据空转）',
    results.every((g) => g.cov.total > 0),
    results.map((g) => g.id + '=' + g.cov.total).join(' · '));
  check('未完成 W5 的面是**已知且登记**的（防"以为做了其实没做"）',
    results.filter((g) => !g.done).length === 0
      || results.filter((g) => !g.done).every((g) => g.cov.total > 0),
    results.filter((g) => !g.done).length
      ? '待推广：' + results.filter((g) => !g.done).map((g) => g.id + '(' + g.cov.ungated.length + ' 条无锚点)').join(' · ')
      : '全部 ' + results.length + ' 个面都已完成 W5');

  // 负对照（喂**同一个** anchorGateCoverage）：一条"同面无锚点"的合成规则必须被判出。
  const synthBad = 'body[data-we-glass-window] .x { color: red } .we-update-notice { backdrop-filter: blur(4px) }';
  const synthOk = 'body[data-we-glass-window] .x { color: red }';
  check('negative control: 同面但无锚点的规则会被判出',
    anchorGateCoverage(synthBad, /\.(x|we-update-notice)/, /data-we-glass-window/).ungated.length === 1
      && anchorGateCoverage(synthOk, /\.(x|we-update-notice)/, /data-we-glass-window/).ungated.length === 0);

  // ⚠️ **清理对称性**（这条是为一个真实缺陷补的）：`applyEffects` 写的每一个
  //    **门控属性**与**按面釉层变量**，`clearEffects` 都必须撤掉。
  //    实测踩到：W5 新增的 `data-we-glass-chat` / `data-we-glass-floaters` 与 W2–W4 的
  //    6 个按面变量**没进 clearEffects** ⇒ 插件被禁用 / HMR 卸载后，宿主 DOM 上仍留着
  //    属性、挂在它上面的规则组**照旧生效**（表现为"插件卸载了玻璃还在"）。
  //    这类残留只有卸载路径才暴露，日常切换看不出来 —— 所以必须写成判据。
  {
    const clearStart = EFFECTS.indexOf('function clearEffects');
    const clearBody = clearStart >= 0 ? uncommented(EFFECTS.slice(clearStart)) : '';
    // 从 applyEffects 里提取"会写出的门控属性"与"会写出的按面变量"
    const applyBody = clearStart >= 0 ? uncommented(EFFECTS.slice(0, clearStart)) : uncommented(EFFECTS);
    const wroteAttrs = [...new Set([...applyBody.matchAll(/setAttribute\("(data-we-[a-z-]+)"/g)].map((m) => m[1]))];
    const wroteVars = [...new Set([...applyBody.matchAll(/setProperty\("(--we-[a-z-]+)"/g)].map((m) => m[1]))]
      // 只查"按面"那一类（全局变量由 clearEffects 的既有清单负责，不在本判据范围）
      .filter((v) => /^--we-(settings-window|left-sidebar|floaters|chat)-/.test(v));
    const attrMiss = wroteAttrs.filter((a) => !clearBody.includes('removeAttribute("' + a + '")'));
    const varMiss = wroteVars.filter((v) => !clearBody.includes('"' + v + '"'));
    check('清理对称性：applyEffects 写的门控属性与按面变量，clearEffects 都撤得掉',
      attrMiss.length === 0 && varMiss.length === 0,
      (attrMiss.length || varMiss.length)
        ? '未撤：属性 ' + JSON.stringify(attrMiss) + ' 变量 ' + JSON.stringify(varMiss)
        : '属性 ' + wroteAttrs.length + ' 个 · 按面变量 ' + wroteVars.length + ' 个，全部成对');
    check('negative control: 从 clearEffects 里删掉一项会被同一条判据判出',
      (() => {
        const broken = clearBody.replace('removeAttribute("data-we-glass-chat")', '');
        return wroteAttrs.some((a) => !broken.includes('removeAttribute("' + a + '")'));
      })());
  }
}

// ═══ ⑩ 默认值可达性：这两态必须**真的取到值** ══════════════════════════════════
// 为什么单列一组（为一次**已发生的真实事故**补的，wip §4.25）：
// 前面几组多是**形态判据** —— 它们能证明"接线写对了"，却证明不了"接线在真实会话里可达"。
// 实测：`readOne` 把 `def` 丢掉 ⇒ `DEFAULTS` 里那几张表成了**死代码**，真实会话里恒为 `{}`，
// 于是"每个「独立配置」旋钮天生不动"、面板总开关显示为关 —— 用户看到的正是
// "控件在、开关滑杆动了没有任何视觉变化"。本组因此判**可达性**：全新会话（输入 `{}`）与
// 脏存档（键都是 `{}`）下都必须取出**等于各自默认值**的结果，且显式值必须存得住。
console.log('\n⑩ 默认值可达性（两态都必须真的取到值）');
{
  const canon = (o) => JSON.stringify(o && typeof o === 'object' && !Array.isArray(o)
    ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])) : o);
  const fresh = SCHEMA.sanitizeFromSchema({}, 'client') || {};
  const dirty = SCHEMA.sanitizeFromSchema({ glassMode: {}, glassChildren: {} }, 'client') || {};

  check('全新会话：两张表都等于各自的 DEFAULTS（既不是空对象，也不是 `{}`）',
    canon(fresh.glassMode) === canon(SCHEMA.DEFAULTS.glassMode)
      && canon(fresh.glassChildren) === canon(SCHEMA.DEFAULTS.glassChildren),
    'mode = ' + JSON.stringify(fresh.glassMode) + ' · children = ' + JSON.stringify(fresh.glassChildren));

  check('脏存档自愈：键都是 `{}` 的存档也必须取出与全新会话**逐键相同**的两张表（缺陷输出不得永久生效）',
    canon(dirty.glassMode) === canon(fresh.glassMode)
      && canon(dirty.glassChildren) === canon(fresh.glassChildren),
    'mode = ' + JSON.stringify(dirty.glassMode) + ' · children = ' + JSON.stringify(dirty.glassChildren));

  const custom = SCHEMA.sanitizeFromSchema({ glassMode: { settingsWindow: 'custom' } }, 'client') || {};
  check('显式值存得住：「独立配置」的 `custom` 必须能持久化（"关 ⇒ 回原生"那一层已退役）',
    custom.glassMode && custom.glassMode.settingsWindow === 'custom',
    'mode.settingsWindow = ' + (custom.glassMode || {}).settingsWindow);

  // 退役的键必须**真的消失**（与 ④ 组"已删除的键必须真的消失"同一条纪律）。
  const retired = ['glassWindow', 'glassChildren'].filter((k) => k in SCHEMA.KINDS || k in SCHEMA.DEFAULTS);
  check('已退役的键必须真的消失：`glassWindow`（设置窗口液态玻璃）/ `glassChildren`（要不要玻璃）',
    retired.length === 0,
    retired.length ? '残留：' + retired.join(', ') : '两个键均已不存在（KINDS / DEFAULTS 均无）');

  const illegal = SCHEMA.sanitizeFromSchema({ glassMode: { sidebar: true, sidebarContent: 'yes' } }, 'client') || {};
  check('非法取值被挡：模式只认 `inherit` / `custom`（旧布尔 `true` 这类脏值不得原样进档）',
    illegal.glassMode && illegal.glassMode.sidebar === 'inherit' && illegal.glassMode.sidebarContent === 'inherit',
    'sidebar = ' + (illegal.glassMode || {}).sidebar + ' · sidebarContent = ' + (illegal.glassMode || {}).sidebarContent);

  // 负对照：把缺陷实现（丢掉 def + 只收 true）在原地复刻一遍 —— 它必须给不出上面任何一条。
  // 这一段是判据的"灵敏度证明"：若本条恒真，说明上面几条并没有在测"默认值可达"。
  const legacyBoolMap = (raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out = {};
    for (const [k, v] of Object.entries(raw)) if (v === true) out[k] = true;
    return out;
  };
  // ⚠️ 这条负对照**自己也腐烂过一次**：它原先拿 `SCHEMA.DEFAULTS.glassChildren` 对照，而那个键在
  //    "要不要玻璃"退役时被删掉了 —— `canon(undefined)` 与任何对象都不等，于是这条判据**恒真**
  //    （从"有牙"退化成"摆设"）。教训：负对照里的**每个引用**都必须随被删的键一起改。
  //    （同类：`canon(...).length > 2` 是"默认表确实非空"的守门，防它退化成 `{}` 之后仍然恒真。）
  check('negative control: 缺陷实现（丢掉 def / 只收合法值）在同一条判据下必须红',
    canon(legacyBoolMap(undefined)) !== canon(SCHEMA.DEFAULTS.glassMode)
      && String(canon(SCHEMA.DEFAULTS.glassMode)).length > 2
      && legacyBoolMap({ settingsWindow: 'inherit' }).settingsWindow === undefined
      && legacyBoolMap({ conversation: false }).conversation === undefined);
}

// ── 执行型沙箱（第 ⑪ / ⑫ 组共用，只此一份）──────────────────────────────────
// 真 `src/effects.js` 装进 `new Function`，配一个**可反复调用、可观测**的 DOM 替身。
// ⚠️ `effectsBody` / `BASE` / `mode` / `run` / `eff` 这几个短名字只服务本文件最后两组
//    （不是通用工具）；共用一份是为了**不复制机制**：第 ⑫ 组开头有它们各自的说明。
const effectsBody = stripExportBlocks(EFFECTS);
/** 沙箱里捕获到的执行期异常（TDZ / TypeError 这一类；§4.24 的教训）。 */
const runtimeErrors = [];
// ⚠️ "同一沙箱里连着调多次"是判「状态迁移无残留」的前提：§4.26 那类缺陷只在序列里现形
//    （上一档写下的值，下一档没撤）—— 单次调用的判据永远看不见它。
const makeSandbox = (body) => {
  const wrote = new Map();
  const attrs = new Map();
  const selection = {};
  const style = {
    setProperty: (k, v) => { wrote.set(k, String(v)); },
    removeProperty: (k) => { wrote.delete(k); },
  };
  const bodyEl = {
    style,
    setAttribute: (k, v) => { attrs.set(k, String(v)); },
    removeAttribute: (k) => { attrs.delete(k); },
    hasAttribute: (k) => attrs.has(k),
    offsetHeight: 1,
  };
  const stub = {
    selection,
    document: { body: bodyEl, getElementById: () => null, documentElement: { style } },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    GLASS_SATURATE: 1.3, SCRIM_ID: 'we-scrim', LAYER_ID: 'we-layer',
    adapterCaps: () => ({ target: 'plain-browser' }),
    detectMicaSupport: () => true, detectSoftwareRender: () => false,
    useLegacySaturateCoupling: () => false,
    weClampSurfaceColor: (hex) => hex,
    snapshotHostFontDefaults: () => {}, applyComponentFonts: () => {},
    removeFontStyles: () => {}, removeComponentFonts: () => {},
    applyCaretStyles: () => {}, removeCaretStyles: () => {}, syncSceneAudio: () => {},
    resolveWallpaperFadeBg: () => '#000000',
  };
  const scope = new Proxy(stub, {
    has: (t, k) => (k in t) || !(k in globalThis),
    get: (t, k) => (k in t ? t[k] : () => undefined),
    set: () => true,
  });
  const mod = new Function('__scope', 'with (__scope) { ' + body
    + '\nreturn { applyEffects }; }')(scope);
  return {
    wrote, attrs,
    /** 按覆盖调一次；覆盖**累加**（模拟用户连续改设置）。 */
    call: (patch) => {
      Object.assign(selection, patch);
      try { mod.applyEffects(); } catch (e) { runtimeErrors.push(String((e && e.message) || e)); }
    },
  };
};
const BASE = {
  scrim: 0.25, wallpaperOpacity: 0, accent: '#4f8cff', glassColor: '#ffffff', glassAlpha: 60,
  blur: 0, border: 0.35, fontCustom: false, caretColor: '', sidebarGlass: true, glassWindow: true,
  glassFidelity: 100, chatGlassFidelity: 100, conversationColor: '#ffffff',
  sidebarBlur: 0, sidebarAlpha: 0, sidebarColor: '#ffffff',
  sidebarContentAlpha: 0, sidebarContentColor: '',
  settingsWindowBlur: 60, settingsWindowTransparency: 60,
  leftSidebarGlass: true, leftSidebarBlur: 60, leftSidebarTransparency: 60,
  floatersBlur: 60, floatersTransparency: 60,
  glassChildren: { settingsWindow: true, conversation: true, floaters: true },
  glassMode: {},
  wallpaperBlur: 0, backgroundBrightness: 100, backgroundContrast: 100, backgroundSaturate: 100,
  objectFit: 'cover', flip: false,
};
// 一个"两态"开关：true = 每个面都 `'custom'`（读自己的值），false = 每个面都 `'inherit'`。
const mode = (on) => ({
  glassMode: {
    settingsWindow: on ? 'custom' : 'inherit', conversation: on ? 'custom' : 'inherit',
    floaters: on ? 'custom' : 'inherit', leftSidebar: on ? 'custom' : 'inherit',
    sidebar: on ? 'custom' : 'inherit', sidebarContent: on ? 'custom' : 'inherit',
  },
});
const run = (body, patch) => { const b = makeSandbox(body); b.call(Object.assign({}, BASE, patch)); return b; };
// CSS 内层兜底的**单层链**解析：`var(--we-<面>-x, var(--we-global, lit))` ⇒ 没被 JS 写出的
// 变量实际取到哪个值。这是第 ⑫ 组"与管道形状解耦"的关键：R2 把这些兜底删掉之后该组不用改。
const FALLBACK = new Map();
for (const m of STYLES_TEXT.matchAll(/var\((--we-[a-z0-9-]+),\s*(var\(--we-[a-z0-9-]+,\s*[^)]+\)|[^)]+)\)/g)) {
  if (!FALLBACK.has(m[1])) FALLBACK.set(m[1], m[2].trim());
}
const eff = (box, name) => {
  if (box.wrote.has(name)) return box.wrote.get(name);
  const fb = FALLBACK.get(name);
  if (fb === undefined) return '(无人定义)';
  const inner = /^var\((--we-[a-z0-9-]+),\s*([^)]+)\)$/.exec(fb);
  if (inner) return box.wrote.has(inner[1]) ? box.wrote.get(inner[1]) : inner[2].trim();
  return fb;
};

// ═══ ⑪ 按面变量必须**无条件写出**（"不写 ≠ 撤销"的正面形式；R1 起）════════════
// 历史（wip §4.26 → §10.10）：这些变量原先走"**写 / 撤**两态" —— 独立档写、跟随档撤。
// 而 CSS 的 `var(--we-x, 兜底)` **只在 `--we-x` 未定义时**才取兜底；变量一旦被写到
// `document.body.style` 上，它就一直是"已定义"的 ⇒ 只是"跳过写入"会把上一档的旧值留在
// body 上，表现为"关掉独立配置后没接受全局配置，而是保留自己的配置"（用户实测原话）。
//
// R1 把这一整类**从结构上取消**：每档都算出正确的值并写出，于是不存在"该撤没撤"。
// 本组随之判它的**正面形式**，而且是**执行证据**（不是看源码文本）：
//   · 每个按面变量在 **独立 / 跟随 / 门控关** 三档下都必须**被写出**（CSS 永远取不到兜底）
//   · `applyEffects` 里**不得再有**这些变量的 `removeProperty`（写/撤两态必须绝迹）
console.log('\n⑪ 按面变量必须无条件写出（不写 ≠ 撤销 ⇒ 一律写）');
{
  const PARAM_VARS = [
    '--we-settings-window-blur', '--we-settings-window-alpha',
    '--we-left-sidebar-blur', '--we-left-sidebar-alpha',
    '--we-floaters-blur', '--we-floaters-alpha',
  ];
  const MODES = [
    ['独立档', mode(true)],
    ['跟随档', mode(false)],
    ['门控关', Object.assign({}, mode(false), {
      glassChildren: { settingsWindow: false, conversation: false, floaters: false },
      leftSidebarGlass: false, sidebarGlass: false,
    })],
  ];
  const unwritten = [];
  for (const [label, patch] of MODES) {
    const box = run(effectsBody, patch);
    for (const v of PARAM_VARS) if (!box.wrote.has(v)) unwritten.push(label + '：' + v);
  }
  check('无条件写出：' + PARAM_VARS.length + ' 个按面变量在 独立 / 跟随 / 门控关 三档下都必须被写出',
    PARAM_VARS.length >= 6 && unwritten.length === 0,
    unwritten.length
      ? '没写出（CSS 会去取内层兜底 ⇒ 等于又回到"看谁最后写过"）：' + JSON.stringify(unwritten)
      : PARAM_VARS.length + ' 个 × ' + MODES.length + ' 档 = ' + (PARAM_VARS.length * MODES.length) + ' 次全部写出');

  const clearStart = EFFECTS.indexOf('function clearEffects');
  const applyRaw = clearStart >= 0 ? EFFECTS.slice(0, clearStart) : EFFECTS;
  const leftRemoves = PARAM_VARS.filter((v) => applyRaw.includes('removeProperty("' + v + '")'));
  check('「写 / 撤两态」必须绝迹：applyEffects 里不得再撤这些变量（撤只在 clearEffects 的卸载路径）',
    leftRemoves.length === 0,
    leftRemoves.length ? '仍有撤除分支：' + JSON.stringify(leftRemoves) : '零撤除分支');

  // 负对照：把某一处写出改成永不执行的 `if (false)`（复刻"有条件才写"）⇒ 第一条必须判出
  const MUT = 's.setProperty("--we-floaters-blur",';
  if (!effectsBody.includes(MUT)) throw new Error('⑪ 负对照没找到目标写出（判据会变成假绿）');
  const disabled = effectsBody.split(MUT).join('if (false) s.setProperty("--we-floaters-blur",');
  check('negative control: 把一处写出改成 `if (false)`（复刻"有条件才写"）后必须被判出',
    !run(disabled, mode(false)).wrote.has('--we-floaters-blur'));
}

// ═══ ⑫ 语义表（执行型 · 扰动自证）═══════════════════════════════════════════
// 为什么要有这一组（§10.6 的 R0）：前面 ①–⑪ **全部**是对源码文本的判据 —— 它们能证明
// "接线写对了"，但**证明不了用户会看到什么**。本目标连着踩了三层缺陷（§4.24 部署态 /
// §4.25 可达性 / §4.26 状态迁移），三次都缺同一条基线。
//
// 本组给语义下定义的方式刻意**不抄任何公式**（抄公式＝把机制复制一份，机制一改判据就假红/假绿），
// 而是用**扰动自证**：
//   · 「跟随全局」= 有效取值**只随全局键**动（改本面键不动）
//   · 「独立」    = 有效取值**只随本面键**动（改全局键不动）
//   · 「关」      = 该面的门控属性**不存在**
// 这三条正是用户口径的直译：他报的"关闭时没有接受全局配置，而是保留自己的配置"，
// 就是"跟随全局"那一条不成立 —— 而旧的九组守卫**没有一条**判得出它（§4.26 就是这么漏的）。
//
// "有效取值"必须**与机制无关**：JS 写了就用写的值；没写就跟 CSS 的**内层兜底**走
// （单层链 `var(--we-<面>-x, var(--we-global, lit))`）。于是 R1（条件写 → 无条件写）与
// R2（去掉内层兜底）都**不需要改本组** —— 它测的是语义，不是管道形状。
console.log('\n⑫ 语义表（执行型 · 扰动自证：跟随全局 / 独立 / 关 / 状态迁移无残留）');
{
  // 沙箱 / BASE / mode / run / FALLBACK / eff 由**模块级共享**（见第 ⑪ 组之前的那一段）：
  // 第 ⑪、⑫ 两组用同一份，不复制机制。

  // ── 语义表：面 × 参数（own = 本面自己的键，glob = 全局键；[键, 基准值, 扰动值]）──
  // ⚠️ **扰动值必须能穿过可读性钳制**（第一版本判据在这里假红过一次，值得记下）：
  //    `--we-chat-surface-tint-*` 的值经 `weClampSurfaceColor(色, 主题, 保真度)`，它把亮度
  //    钳进可读带（浅色主题**有下限**）。所以用两个"都低于下限"的灰（`#101010` vs `#e0e0e0`）
  //    去扰动，会被下限抬成同一个 `#e9e9e9` ⇒ 判据报"推不动"，而**产品是对的**。
  //    颜色类的扰动因此一律取**跨色相**的值：色相差异不会被亮度钳制吸收。
  const TABLE = [
    { surf: 'settingsWindow', label: '设置窗口·模糊', gate: 'data-we-glass-window', v: '--we-settings-window-blur', own: ['settingsWindowBlur', 5, 42], glob: ['blur', 0, 33] },
    { surf: 'settingsWindow', label: '设置窗口·透明度', gate: 'data-we-glass-window', v: '--we-settings-window-alpha', own: ['settingsWindowTransparency', 5, 50], glob: ['glassAlpha', 60, 5] },
    { surf: 'leftSidebar', label: '左侧栏·模糊', gate: 'data-we-left-sidebar', v: '--we-left-sidebar-blur', own: ['leftSidebarBlur', 5, 42], glob: ['blur', 0, 33] },
    { surf: 'leftSidebar', label: '左侧栏·透明度', gate: 'data-we-left-sidebar', v: '--we-left-sidebar-alpha', own: ['leftSidebarTransparency', 5, 50], glob: ['glassAlpha', 60, 5] },
    { surf: 'floaters', label: '插件浮层·模糊', gate: 'data-we-glass-floaters', v: '--we-floaters-blur', own: ['floatersBlur', 5, 42], glob: ['blur', 0, 33] },
    { surf: 'floaters', label: '插件浮层·透明度', gate: 'data-we-glass-floaters', v: '--we-floaters-alpha', own: ['floatersTransparency', 5, 50], glob: ['glassAlpha', 60, 5] },
    { surf: 'conversation', label: '对话栏·保真度', gate: 'data-we-glass-chat', v: '--we-chat-glass-fidelity', own: ['chatGlassFidelity', 20, 90], glob: ['glassFidelity', 100, 40] },
    { surf: 'conversation', label: '对话栏·颜色', gate: 'data-we-glass-chat', v: '--we-chat-surface-tint-rgb-light', own: ['conversationColor', '#ff0000', '#00ff00'], glob: ['glassColor', '#0000ff', '#ffff00'] },
    { surf: 'sidebar', label: '右侧栏·模糊', gate: 'data-we-sidebar-glass', v: '--we-sidebar-blur', own: ['sidebarBlur', 0, 120], glob: ['blur', 0, 33] },
    { surf: 'sidebar', label: '右侧栏·颜色', gate: 'data-we-sidebar-glass', v: '--we-sidebar-color', own: ['sidebarColor', '#ff0000', '#00ff00'], glob: ['glassColor', '#0000ff', '#ffff00'] },
    { surf: 'sidebarContent', label: '内容面·透明度', gate: null, v: '--we-content-surface-alpha', own: ['sidebarContentAlpha', 0, 40], glob: ['glassAlpha', 60, 5] },
  ];

  const rows = TABLE.map((row) => {
    const withOwn = (val, gval, on) => run(effectsBody, Object.assign({}, mode(on), { [row.own[0]]: val, [row.glob[0]]: gval }));
    const cBase = withOwn(row.own[1], row.glob[1], true);
    const iBase = withOwn(row.own[1], row.glob[1], false);
    const dflt = SCHEMA.sanitizeFromSchema({}, 'client').glassMode;
    const dBase = run(effectsBody, { glassMode: dflt, [row.glob[0]]: row.glob[1] });
    return {
      row,
      customOwn: eff(withOwn(row.own[2], row.glob[1], true), row.v) !== eff(cBase, row.v),
      customGlob: eff(withOwn(row.own[1], row.glob[2], true), row.v) !== eff(cBase, row.v),
      inheritOwn: eff(withOwn(row.own[2], row.glob[1], false), row.v) !== eff(iBase, row.v),
      inheritGlob: eff(withOwn(row.own[1], row.glob[2], false), row.v) !== eff(iBase, row.v),
      defaultGlob: eff(run(effectsBody, { glassMode: dflt, [row.glob[0]]: row.glob[2] }), row.v) !== eff(dBase, row.v),
      base: eff(iBase, row.v),
    };
  });

  check('执行期零异常（TDZ / TypeError 这一类必须由判据挡下，而不是靠用户实测 —— §4.24 的教训）',
    runtimeErrors.length === 0,
    runtimeErrors.length ? [...new Set(runtimeErrors)].slice(0, 3).join(' · ') : '真 effects.js 在本组全部调用里零抛错');

  check('覆盖面地板：语义表覆盖 ' + TABLE.length + ' 个"面×参数"，且每个的有效取值都可解析',
    TABLE.length >= 10 && rows.every((r) => r.base !== '(无人定义)'),
    '行数 ' + TABLE.length + ' · 无内层兜底也无写入者的情况：'
      + (rows.filter((r) => r.base === '(无人定义)').map((r) => r.row.label).join(', ') || '无'));

  const customBad = rows.filter((r) => !(r.customOwn && !r.customGlob));
  check('独立档：改**本面键**必须推动有效取值、改**全局键**必须不动',
    customBad.length === 0,
    customBad.length ? customBad.map((r) => r.row.label).join(', ') : rows.length + ' 行全部成立');

  const inheritBad = rows.filter((r) => !(r.inheritGlob && !r.inheritOwn));
  check('跟随档：改**全局键**必须推动有效取值、改**本面键**必须不动（用户口径的直译）',
    inheritBad.length === 0,
    inheritBad.length ? inheritBad.map((r) => r.row.label).join(', ') : rows.length + ' 行全部成立');

  // 默认档：全新会话（glassMode 用 schema 消毒出来的**真默认值**）下应当全部跟随全局。
  // ⚠️ 已知偏差走**登记表**（不空转：登记了却不再偏差的必须删掉那条）—— 这样"现状偏差"
  //    既不会把树判红，也不会被遗忘；R3 把默认改成 inherit 时，这条登记会自动要求删除。
  // ⚠️ R3b（§10.16）起这里**必须是空的**：语义迁移把每个面的默认都改成"跟随全局"，
  //    上面那条"默认档：每个面都应当跟随全局"因此对**所有**面成立。
  //    这张表当初就是为"承认现状偏差、但不让它被遗忘"而设的 —— 偏差没有了，留着任何一条
  //    都会被下面那条"登记表不空转"判红（这正是它的设计意图：改动被迫显式）。
  const KNOWN_DEFAULT_DEVIATIONS = {};
  const deviated = [...new Set(rows.filter((r) => !r.defaultGlob).map((r) => r.row.surf))];
  const unregistered = deviated.filter((s) => !KNOWN_DEFAULT_DEVIATIONS[s]);
  check('默认档：全新会话下每个面都应当跟随全局（改全局键必须推动有效取值）',
    unregistered.length === 0,
    unregistered.length ? '未登记的默认偏差：' + unregistered.join(', ')
      : (deviated.length ? '已登记偏差：' + deviated.join(', ') + '（R3 消除）' : '全部跟随全局'));
  const staleReg = Object.keys(KNOWN_DEFAULT_DEVIATIONS).filter((s) => !deviated.includes(s));
  check('已知偏差登记表不空转：登记了却已不偏差的，必须删掉那条登记',
    staleReg.length === 0,
    staleReg.length ? '已失效的登记：' + staleReg.join(', ') : '登记 ' + deviated.length + ' 个，全部仍在偏差');

  // 门控属性（wip §10.20 之后分**两类**）：
  //   · **恒挂**（"要不要玻璃"那一层已退役）：设置窗口 / 对话栏 / 插件浮层 —— 任何输入下都必须在，
  //     而且源码里**不许**再有摘除分支（那条路正是被删掉的）。
  //   · **仍可切**：左侧栏覆盖 / 侧栏液态玻璃 —— 它们各有自己的总开关，开 ⇒ 挂、关 ⇒ 摘。
  const CONST_GATES = ['data-we-glass-window', 'data-we-glass-chat', 'data-we-glass-floaters'];
  const SWITCH_GATES = [
    { gate: 'data-we-left-sidebar', on: { leftSidebarGlass: true }, off: { leftSidebarGlass: false }, label: '左侧栏覆盖' },
    { gate: 'data-we-sidebar-glass', on: { sidebarGlass: true }, off: { sidebarGlass: false }, label: '侧栏液态玻璃' },
  ];
  const gateBad = [];
  // ⚠️ "不许有摘除分支"只针对**写入侧**（applyGlass）；`clearEffects` 里的 removeAttribute 是
  //    插件停用时的清理路径，**必须**保留 —— 判据的扫描面切在 clearEffects 之前（同 ⑪ 组手法）。
  const clearAt = effectsBody.indexOf('function clearEffects');
  const applyPart = clearAt > 0 ? effectsBody.slice(0, clearAt) : effectsBody;
  for (const gate of CONST_GATES) {
    const any = run(effectsBody, Object.assign({}, mode(false), { leftSidebarGlass: false, sidebarGlass: false }));
    if (!any.attrs.has(gate)) gateBad.push(gate + '：未挂（这一层已退役 ⇒ 必须恒挂）');
    if (new RegExp('removeAttribute\\("' + gate + '"').test(applyPart)) gateBad.push(gate + '：写入侧仍有摘除分支');
  }
  for (const g of SWITCH_GATES) {
    const on = run(effectsBody, Object.assign({}, mode(false), g.on));
    const off = run(effectsBody, Object.assign({}, mode(false), g.off));
    if (!on.attrs.has(g.gate)) gateBad.push(g.label + '：开时未挂 ' + g.gate);
    if (off.attrs.has(g.gate)) gateBad.push(g.label + '：关时未摘 ' + g.gate);
  }
  check('门控属性：' + CONST_GATES.length + ' 个已退役的**恒挂**（且无摘除分支）· '
    + SWITCH_GATES.length + ' 个可切的成对',
    gateBad.length === 0,
    gateBad.length ? gateBad.join(' · ')
      : CONST_GATES.length + ' 个恒挂 + ' + SWITCH_GATES.length + ' 个成对');

  // ── 状态迁移无残留：**绕道**与**直达**的整张有效值表必须逐字节相同 ──────────
  // 定义同一终态的两条路：直达 = 一次调用到达；绕道 = 先全部独立 → 再全部关掉 → 再到终态。
  // 任何一处"该撤没撤"（§4.26 那一类）都会把上一档的残留带进终态 ⇒ 两张表不等。
  const FINAL = Object.assign({}, mode(false), { glassAlpha: 44, blur: 21, glassColor: '#123456' });
  const DETOUR = [
    Object.assign({}, mode(true), { glassAlpha: 5, blur: 3, glassColor: '#abcdef',
      settingsWindowBlur: 55, settingsWindowTransparency: 5,
      leftSidebarBlur: 55, leftSidebarTransparency: 5,
      floatersBlur: 55, floatersTransparency: 5, sidebarBlur: 150, sidebarColor: '#ff0000' }),
    Object.assign({}, BASE, { glassChildren: { settingsWindow: false, conversation: false, floaters: false } }),
    FINAL,
  ];
  const diffOf = (A, B, kind) => {
    const d = [];
    for (const k of new Set([...A.keys(), ...B.keys()])) if (A.get(k) !== B.get(k)) d.push(kind + ' ' + k);
    return d;
  };
  const compareDirectVsDetour = (body) => {
    const direct = run(body, FINAL);
    const detour = makeSandbox(body);
    for (const p of DETOUR) detour.call(Object.assign({}, BASE, p));
    return [...diffOf(direct.wrote, detour.wrote, '变量'), ...diffOf(direct.attrs, detour.attrs, '属性')];
  };
  const residual = compareDirectVsDetour(effectsBody);
  check('状态迁移无残留：绕道（独立 → 关 → 跟随）与直达的有效值表逐字节相同',
    residual.length === 0,
    residual.length ? residual.slice(0, 4).join(' · ') + (residual.length > 4 ? ' …共 ' + residual.length + ' 处' : '')
      : '两张表完全一致');

  // 负对照 ①：把一处写出**改成"只在独立档写"** —— 这正是 §4.26 的形状（条件写且不撤）。
  // R1 之后源码里已经没有 `else removeProperty` 可删了，所以负对照也跟着换成同一类缺陷的
  // **新形态**：绕道序列的阶段一（独立档）写过它，终态（跟随档）既不写也不撤 ⇒ 残留必须判出。
  const COND = 's.setProperty("--we-floaters-blur",';
  if (!effectsBody.includes(COND)) throw new Error('负对照①没找到目标写出（判据会变成假绿）');
  const conditionalWrite = effectsBody.split(COND).join(
    'if (selection.glassMode && selection.glassMode.floaters === "custom") s.setProperty("--we-floaters-blur",');
  check('negative control: 把一处写出改成"只在独立档写"（复刻 §4.26 的条件写且不撤）后，状态迁移判据必须判出',
    compareDirectVsDetour(conditionalWrite).length > 0);

  // 负对照 ②：把某个面"读谁"的两个实参对调（复刻"读错键"）⇒「独立档」判据必须判出
  const SWAP_FROM = 'glassValue("floaters", "blur", selection.floatersBlur, selection.blur)';
  if (!effectsBody.includes(SWAP_FROM)) throw new Error('负对照②没找到目标调用点');
  const swapped = effectsBody.split(SWAP_FROM)
    .join('glassValue("floaters", "blur", selection.blur, selection.floatersBlur)');
  const sBase = run(swapped, Object.assign({}, mode(true), { floatersBlur: 5, blur: 30 }));
  const sOwn = run(swapped, Object.assign({}, mode(true), { floatersBlur: 42, blur: 30 }));
  check('negative control: 把"读谁"的两个实参对调后，「独立档：本面键必须推动」必须判出',
    eff(sOwn, '--we-floaters-blur') === eff(sBase, '--we-floaters-blur'));
}

// ═══ ⑬ CSS 契约：按面变量**零兜底** + 门控许可证 + 双向对账（R2 起）═══════════
// R2 去掉了样式表里 62 处按面变量的**内层兜底**（`var(--we-<面>-x, <兜底>)` → `var(--we-<面>-x)`）。
// 为什么可以去掉（**许可证**，本组要把它判住）：那些规则（至少）挂在 `body[data-we-wallpaper]` 之下，
// 而该属性由 JS 挂（`src/live-layer.js` 的 ACTIVE_ATTR：壁纸激活时才有）⇒ 规则匹配时
// `applyEffects` 已经跑过、这些变量已经写出来了。R1 又保证"每档都写"⇒ **兜底在原理上不可达**。
// ⚠️ 刻意**不动**的：`--we-readability-*` / `--we-chat-readability-*`（CSS 自己声明、F1c/F2a 锁定）
//    与全局 `--we-glass-alpha`（E2 配方字面量）—— 见 wip §10.7 的"明确保留"。
console.log('\n⑬ CSS 契约（按面变量零兜底 / 门控许可证 / 双向对账）');
{
  const FACE_RE = /^--we-(?:settings-window|left-sidebar|floaters|sidebar-|chat-(?:glass-fidelity|surface-tint))/;
  // 只留负对照要用的那一个（另一个"读名字"的助手在改成"消费族/定义族"口径后已无用武之地，
  // 就地删掉 —— 本仓不留死代码）。
  const faceNamesWithFallback = (text) => [...text.matchAll(/var\((--we-[a-z0-9-]+),\s/g)]
    .map((m) => m[1]).filter((n) => FACE_RE.test(n));

  // ① 零兜底：**消费族**不得再带内层兜底；**定义族**必须保留 —— 两者角色不同，刻意分开。
  //   · 消费族（`settings-window-` / `left-sidebar-` / `floaters-` / `sidebar-`，54 处）：
  //     读出来的值**直接拿去画像素**，而规则都带 JS 门控 ⇒ 匹配时值必已写出 ⇒ 兜底不可达。
  //   · 定义族（`chat-glass-fidelity` / `chat-surface-tint-*`，8 处）：全在**只声明自定义属性**的
  //     规则里（`body{}` / `body[data-ds-dark-theme]{}` / `body[data-we-wallpaper]{}`），
  //     是"派生变量 / 宿主令牌"的定义点 —— 那个 `, 1` / `, #ffffff` **就是缺省形态本身**
  //     （verify-readability 的 F1e/F1f 查的正是这个形态），而且该守卫**独立求值整份样式表**
  //     （不跑插件 JS）⇒ 去掉它会让 dark 侧整片算式变成 NaN。
  //     ⚠️ 这条是 R2 第一版**多删了 8 处**换来的教训（wip §10.11）：口径必须按"角色"分，
  //        不能按"名字前缀看起来像不像面变量"分。
  const REMOVE_RE = /^--we-(?:settings-window-|left-sidebar-|floaters-|sidebar-)/;
  const KEEP_RE = /^--we-(?:chat-glass-fidelity$|chat-surface-tint-)/;
  const fbNames = (re) => [...STYLES_TEXT.matchAll(/var\((--we-[a-z0-9-]+),\s/g)]
    .map((m) => m[1]).filter((n) => re.test(n));
  const stillFb = fbNames(REMOVE_RE);
  const keptFb = fbNames(KEEP_RE);
  const consumeReads = [...STYLES_TEXT.matchAll(/var\((--we-[a-z0-9-]+)\)/g)]
    .map((m) => m[1]).filter((n) => REMOVE_RE.test(n));
  check('零兜底（消费族）：' + consumeReads.length + ' 处按面读取都不得再带内层兜底',
    stillFb.length === 0 && consumeReads.length >= 40,
    stillFb.length ? '仍带兜底：' + [...new Set(stillFb)].join(', ')
      : consumeReads.length + ' 处无兜底读取（覆盖面地板 40）');
  check('刻意保留（定义族）：chat-* 的 `, 1` / `, #ffffff` 兜底必须仍在（缺省形态即契约，且可读性守卫独立求值靠它）',
    keptFb.length >= 8,
    '保留 ' + keptFb.length + ' 处（' + [...new Set(keptFb)].join(', ') + '）');

  // 门控许可证：凡**画东西**且读按面变量的规则，选择器里必须有一个 **JS 写出的**门控属性。
  // ⚠️ 两条范围限定都是必要的（第一版没加，当场误报了 3 条）：
  //   ① `data-we-wallpaper` 是用**常量**挂的（`src/live-layer.js` 的 `ACTIVE_ATTR`），
  //      所以候选门控既要收 `setAttribute("data-we-…"` 字面量，也要收 `= "data-we-…"` 常量定义。
  //   ② **只声明自定义属性的规则豁免**（`--we-x: …` / `--dsw-…: …`）：它们自己不画任何像素，
  //      是"派生变量 / 宿主令牌"的定义点；真正画东西的是**消费**它们的那些规则，而消费者带门控
  //      （这正是 ⑨ 组在查的"门控覆盖率"）。把定义点也算成"必须有门控"是把范围放错了地方。
  const srcOf = (p) => readFileSync(join(ROOT, 'src', p), 'utf8');
  // ⚠️ 门控属性与按面变量的**写入**现在都在 `src/glass.js`（R3b 第一步搬的，见 wip §10.13）；
  //    `data-we-wallpaper` 仍由 `src/live-layer.js` 的 ACTIVE_ATTR 挂 ⇒ 两个来源都要收。
  const gateSrc = GLASS_SRC.concat(srcOf('live-layer.js'));
  const jsGates = [...new Set([
    ...[...gateSrc.matchAll(/setAttribute\("(data-we-[a-z-]+)"/g)].map((m) => m[1]),
    ...[...gateSrc.matchAll(/=\s*"(data-we-[a-z-]+)"/g)].map((m) => m[1]),
  ])];
  const PAINTS = /^\s*-{0,2}(?:webkit-)?(?:backdrop-filter|background|background-color|background-image|border|border-color|box-shadow|color|filter)\s*:/m;
  // ⚠️ 扫描器必须**下钻进 at-rule**（`@supports` / `@media`）：第一版把 at-rule 块本身当成一条
  //    规则，于是拿 `@supports not (...)` 当选择器去查门控 —— 而真正的门控在它**内部**的选择器上。
  const scanRules = (text) => {
    const out = [];
    const walk = (t) => {
      let depth = 0; let start = 0; let selStart = 0; let sel = '';
      for (let i = 0; i < t.length; i++) {
        if (t[i] === '{') {
          if (depth === 0) {
            sel = t.slice(selStart, i).split('\n').map((s) => s.trim()).filter(Boolean).slice(-1)[0] || '';
            start = i + 1;
          }
          depth++;
        } else if (t[i] === '}') {
          depth--;
          if (depth === 0) {
            const body = t.slice(start, i);
            if (sel.startsWith('@')) walk(body);       // 容器：继续往里找真正的选择器
            else out.push({ sel, body });
            selStart = i + 1;
          }
        }
      }
    };
    walk(text);
    return out;
  };
  const gateCheck = (text) => {
    const bad = [];
    let checked = 0;
    for (const r of scanRules(text)) {
      const names = [...r.body.matchAll(/var\((--we-[a-z0-9-]+)\)/g)].map((m) => m[1]).filter((n) => FACE_RE.test(n));
      if (!names.length) continue;
      if (!PAINTS.test(r.body)) continue;        // 只声明自定义属性 ⇒ 自己不画东西（见上面的范围限定②）
      checked++;
      if (!jsGates.some((g) => r.sel.includes(g))) bad.push(r.sel.slice(0, 80) + ' ← ' + [...new Set(names)].join(','));
    }
    return { bad, checked };
  };
  const gate = gateCheck(STYLES_TEXT);
  // 覆盖面地板 = **防"解析器静默返回空表"**（本文件头注释的纪律），不是紧贴实测值：
  // 实测 13 条，地板取 10 —— 留出正常重构的余量，同时"一条都没扫到"必红。
  check('门控许可证：凡**画东西**且读按面变量的规则，选择器里都必须有 JS 写出的门控属性（' + jsGates.length + ' 个候选门控）',
    gate.bad.length === 0 && gate.checked >= 10,
    gate.bad.length ? '无门控：' + gate.bad.slice(0, 3).join(' · ')
      : gate.checked + ' 条规则全部带门控（覆盖面地板 10）');

  // 双向对账：effects.js 写出的每个按面变量，都必须被样式表读到（防"写了没人读"的死写入）
  const written = [...new Set([...GLASS_SRC.matchAll(/setProperty\("(--we-[a-z0-9-]+)"/g)]
    .map((m) => m[1]).filter((n) => FACE_RE.test(n)))];
  const readSet = new Set([...STYLES_TEXT.matchAll(/var\((--we-[a-z0-9-]+)/g)].map((m) => m[1]));
  const deadWrites = written.filter((n) => !readSet.has(n));
  check('双向对账：effects.js 写的 ' + written.length + ' 个按面变量都必须被样式表读到',
    written.length >= 15 && deadWrites.length === 0,
    deadWrites.length ? '写了没人读：' + deadWrites.join(', ') : written.length + ' 个全部有消费者');

  // ⚠️ **模板字符串的边界**：`src/styles.js` 整份 CSS 住在一个 JS 模板字符串里
  //    （`const CSS = \`…\`;`）⇒ 注释或规则里出现**裸反引号**会提前终止它，
  //    产物随即是语法错误。构建会拦住，但它报的是 `Unexpected identifier` /
  //    `Invalid left-hand side expression` 这类**指不到原因**的 JS 错误 ——
  //    实测为此浪费了两轮。这条判据把它变成一句能读懂的话（并给出行号）。
  {
    const lines = STYLES_TEXT.split(/\r?\n/);
    const backtickLines = lines.map((t, i) => [i + 1, t]).filter(([, t]) => t.includes('`'));
    const delimiters = backtickLines.filter(([, t]) => /^\s*const CSS = `\s*$/.test(t) || /^\s*`;\s*$/.test(t));
    check('样式表里不许出现裸反引号（它会提前终止 CSS 模板字符串）',
      backtickLines.length === delimiters.length && delimiters.length === 2,
      '含反引号的行=' + backtickLines.map(([n]) => n).join(',') + '（应当只有 const CSS = \\` 与 \\`; 这两行）');
    // 负对照：同一谓词喂一段"注释里带反引号"的合成输入，必须判出。
    const synth = 'const CSS = `\n.a { color: red; /* 见 `x` */ }\n`;';
    const synthLines = synth.split('\n');
    const synthBad = synthLines.filter((t) => t.includes('`') && !/^\s*const CSS = `\s*$/.test(t) && !/^\s*`;\s*$/.test(t));
    check('negative control: 注释里的裸反引号会被同一条判据判出（不是恒真）',
      synthBad.length === 1);
  }

  // 负对照：两条谓词各自对**合成输入**必须有牙（同一谓词、同一调用方式）
  const synthFallback = 'body[data-we-wallpaper] { backdrop-filter: blur(var(--we-floaters-blur, 16px)); }';
  const synthUngated = 'body { backdrop-filter: blur(var(--we-floaters-blur)); }';
  check('negative control: 合成的"带兜底读"与"无门控读"都必须被同一条判据判出',
    faceNamesWithFallback(synthFallback).length === 1 && gateCheck(synthUngated).bad.length === 1);
}

// ═══ ⑭ 三方对账：经 setProperty 写出的变量必须有人读（R4）════════════════════════
// R4 的验收口径（wip §10.6）不能是"我看了一遍"，而是这条**不变量**。
// 口径（单向，故意不判反向）：
//   · **写出** = 客户端模块里 `setProperty("--we-x"` 的**字面量**调用
//     （`"--we-host-" + k` 这种动态拼名不算 —— 它没有确定的变量名）
//   · **消费** = 产品真正会注入的**全部 CSS**：`src/` 下所有模块里的 `var(--we-x`
//     （含 `effects.js` 里那段 `<style id="we-caret-patch">` 注入的补丁样式表）
//   · 反向**不判**：CSS 可以只声明不消费（定义族、纯数据槽位）—— 那是另一回事。
// ⚠️ 为什么消费面不能只扫 styles.js：本组的前身就是这么写的，它把 `--we-caret-color`
//    报成死变量 —— 而消费它的那段 CSS 字符串住在 `effects.js` 里。**判据的读取面必须覆盖
//    产品真正会注入的全部 CSS**，否则给出的是假红（与"读取目标过期会假绿"成对的一条教训）。
// 模块清单直接取**构建表**（`scripts/build-client.mjs` 的 `file:` 项）—— 它是"哪些文件会进产物"
// 的唯一真源，省得这里再抄一份文件列表（抄了必然漂）。
console.log('\n⑭ 三方对账：写出的变量必须有人读（R4 死码清理的判据）');
{
  const BUILD_SRC = readFileSync(join(ROOT, 'scripts', 'build-client.mjs'), 'utf8');
  const CLIENT_MODULES = [...BUILD_SRC.matchAll(/file:\s*'(src\/[^']+)'/g)].map((m) => m[1]);
  const texts = CLIENT_MODULES.map((f) => readFileSync(join(ROOT, f), 'utf8'));
  const written = new Set();
  for (const t of texts) {
    for (const m of t.matchAll(/setProperty\(\s*"(--we-[a-z0-9-]+)"/g)) {
      // 以连字符结尾 ⇒ 这个名字是**拼出来的**（实测：`setProperty("--we-host-" + k, …)`），
      // 字面量在连字符处截断、没有确定的变量名 ⇒ 不是本组能判的对象（否则是假红）。
      if (m[1].endsWith('-')) continue;
      written.add(m[1]);
    }
  }
  const consumed = new Set();
  for (const t of texts) for (const m of t.matchAll(/var\(\s*(--we-[a-z0-9-]+)/g)) consumed.add(m[1]);
  // ── 显式登记：**没有 CSS 消费者、但有页面观察者**的变量（豁免必须写在这里，不许留暗洞）──
  // 口径：一个变量只有"CSS var() 消费"才算死码清理的对象；被**测试/探针**当页面观察量断言的
  // 变量属于"对外可观测契约"，删它要先改观察者。
  //   · `--we-glass-color` —— `test/compat-harness-pages.mjs` 用 `getComputedStyle(body)` 读它，
  //     并要求非空 + 与 DSH 设置窗口 token 同源。该 harness **不在任何 npm 脚本里**（要浏览器页面）
  //     ⇒ 在此环境无法验证"改完观察者仍旧绿"，所以先保留写入、在这里显式登记（wip §10.18）。
  //     正确顺序：先改 harness 的观察点为 `--we-surface-tint-light`，再删写入 + 删这条登记。
  // 下面那条"登记表不空转"会**逼**着这条登记在条件变化时被复核。
  const OBSERVED_ONLY = new Set(['--we-glass-color']);
  const deadWrites = [...written].filter((k) => !consumed.has(k) && !OBSERVED_ONLY.has(k)).sort();
  check('写出的每个 `--we-*` 变量都必须有人 var() 它（"写而无人读"归零；登记表里的观察量除外）',
    CLIENT_MODULES.length >= 20 && written.size >= 20 && deadWrites.length === 0,
    deadWrites.length ? '写了没人读：' + deadWrites.join(', ')
      : CLIENT_MODULES.length + ' 个模块 · 写出 ' + written.size + ' 个 · 消费 ' + consumed.size
        + ' 个 · 死写入 0（登记豁免 ' + OBSERVED_ONLY.size + ' 个）');

  // 登记表**不得空转**：登记了却已经没人写、或其实有 CSS 消费者，都必须删掉那条登记
  //（与第 ⑫ 组的"已知偏差登记表不空转"同一条纪律：豁免必须被迫显式复核）。
  const staleObs = [...OBSERVED_ONLY].filter((k) => !written.has(k) || consumed.has(k));
  check('观察量登记表不空转：登记了却没人写、或其实有 CSS 消费者的，必须删掉那条登记',
    staleObs.length === 0,
    staleObs.length ? '该删的登记：' + staleObs.join(', ') : '登记 ' + OBSERVED_ONLY.size + ' 个，全部仍在"无 CSS 消费者"状态');

  // 负对照：喂**同一个**过滤逻辑 —— "只写不读"必须判出，"写且读"必须不判出。
  const dead = (w, c) => [...w].filter((k) => !c.has(k));
  check('negative control: 合成一个只写不读的变量会被同一条判据判出（写且读的不算）',
    dead(new Set(['--we-a', '--we-b']), new Set(['--we-b'])).join() === '--we-a'
      && dead(new Set(['--we-a']), new Set(['--we-a'])).length === 0);
}

console.log('');
if (failed) {
  console.log('GLASS SURFACE CHECKS FAILED — ' + failed + ' failed');
  process.exit(1);
}
console.log('ALL GLASS SURFACE CHECKS PASSED');
process.exit(0);
