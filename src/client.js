/**
 * dsh-wallpaper-engine — client (browser) half source.
 *
 * CANONICAL source; `scripts/build-client.mjs` emits `lib/client.js`. Edit this
 * file, run `npm run build`. Do not hand-edit `lib/client.js`.
 *
 * The plugin:
 *   1. Fetches the wallpaper inventory from the host half's same-origin route
 *      (GET /wallpaper-engine/inventory); "刷新" refetches on demand.
 *   2. Renders the selected wallpaper BEHIND the DSH GUI: a `position:fixed;
 *      z-index:-1` child of `document.body` + a readability scrim (frame + sidebar transparent).
 *   3. Applies four user-adjustable effects, each with its own slider:
 *      - 壁纸模糊 (wallpaper blur) → `--we-media-filter`（blur() 项）
 *      - 暗化 (scrim strength)      → `--we-scrim-color`
 *      - 边框 (border emphasis)     → `--dsw-alias-border-l1/l2` alpha
 *      - 玻璃 (glass blur on panels)→ `--we-blur` + frosted-glass backgrounds
 *   4. Automatic rotation over USER-DEFINED carousel lists (轮播列表): any number
 *      of lists, each with its own interval and order, persisted with the rest of
 *      the settings (schema key `rotationGroups` → the host's config.json) — never
 *      depends on WE's own config.json playlist paths (an import source only). An
 *      imported playable WE playlist seeds the first list on first run.
 */

const React = require("react");
// Portal for the wallpaper picker modal. react-dom is registered in the DSH
// client module loader (see @deepseek-ai/dsh-client-web), so out-of-tree client
// bundles can require it just like "react".
const ReactDOM = require("react-dom");

const SETTINGS_KEY = "dsh-wallpaper-engine:selection";
// Host-sourced settings: the same-origin route the browser half uses to read
// and write its persisted settings. The host stores them in a plain file
// (~/.dsh-wallpaper-engine/config.json), which is PORT-INDEPENDENT — unlike
// localStorage, which is origin-scoped and therefore reset whenever DSH
// Desktop restarts on a new random --port 0 loopback port.
const SETTINGS_URL = "/wallpaper-engine/settings";
// 「壁纸属性」面板：host 把项目目录的 project.json 解析成 UI 描述后从这里取。
const PROPS_URL = "/wallpaper-engine/props";
const INVENTORY_URL = "/wallpaper-engine/inventory";
// ── 组件行状态面（ADR-0013 D3②/D3③）────────────────────────────────────────
// 「关掉一个组件行 ⇒ 该组件的浏览器可见面整块不渲染」的**唯一判据**。状态面就是宿主行状态
// （`/inventory` 的 `components` 字段，产出点见 packages/media-bridge/lib/routes/inventory.js）：浏览器半边**只读**，
// 不写第二份"组件名 → UI"清单 —— 可见面落点由宿主侧的声明表 + 对账守卫双向钉住。
// 三态口径（顺序即优先级）：
//   ① `components` 整块读不到（字段缺席 / 不是对象：老宿主、探针没起来）⇒ **可用**
//      —— 宁可显示、不可静默消失（D3③）；
//   ② 该组件的键取不到（两个面都没这一行）⇒ **不可用**；
//   ③ 值不是 `started` ⇒ **不可用**（`missing` 包含"行被 disable"这一支，`failed:<文案>` 是
//      apply 抛错那一支）。
// ②③ 合成一句 `=== "started"`：唯一算"可用"的值只有它。
function weComponentVisible(components, name) {
  if (!components || typeof components !== "object") return true;
  return components[name] === "started";
}

/* ── 玻璃行停用后的残留回收（主包侧）────────────────────────────────────────
 * 为什么必须由主包做：清理玻璃的函数 `disposeGlassLayer` 住在 `packages/glass`，
 * 而行被停用后**那个 bundle 根本不求值** —— 「清理者」与「需要被清理的残留」恰好
 * 在同一侧，谁也够不着谁。实测症状：关掉 `wallpaper-engine-glass` 行后**左侧栏
 * 仍是玻璃**（`data-we-glass-page` 与 `--we-*` 变量留在 body 上，主包样式里挂在
 * 那个门下的规则照旧命中），只有刷新页面才好。
 *
 * 主包永远加载 ⇒ 由它当回收站。判据源复用 `/inventory` 已透传的 `components`
 * （与 weComponentVisible 同一份、同一口径），不新开路由、不引第二个真源。
 * ⚠️ 只撤**玻璃专属**的门控/变量：`data-we-wallpaper`、`data-we-ui-color` 等主包
 * 自有门控与玻璃行正交，各有各的状态机，不在此列。
 * 幂等：行活着时一次 `components.glass !== "started"` 判定就返回，零 DOM 走访。 */
const GLASS_RESIDUE_ATTRS = [
  "data-we-glass-page", "data-we-glass-chat", "data-we-glass-window", "data-we-glass-floaters",
  "data-we-left-sidebar", "data-we-left-sidebar-radius", "data-we-right-sidebar-radius",
  "data-we-left-sidebar-square", "data-we-right-sidebar-square",
  "data-we-titlebar-glass", "data-we-thinking-glass", "data-we-thinking-native", "data-we-table-readability",
  "data-we-sidebar-follow", "data-we-sidebar-glass", "data-we-sidebar-fullclear",
  "data-we-floater-solid", "data-we-glass-fallback",
];
const GLASS_RESIDUE_VARS = [
  "--we-blur", "--we-saturate", "--we-glass-brightness", "--we-glass-alpha", "--we-glass-color",
  "--we-sheen-scale",
  "--we-surface-tint-light", "--we-surface-tint-dark",
  "--we-surface-tint-rgb-light", "--we-surface-tint-rgb-dark",
  "--we-left-sidebar-radius", "--we-right-sidebar-radius",
  "--we-sidebar-blur", "--we-sidebar-saturate", "--we-sidebar-sheen",
  "--we-sidebar-color", "--we-sidebar-tint",
  "--we-content-surface-alpha", "--we-content-surface-color",
  "--we-settings-window-blur", "--we-settings-window-alpha",
  "--we-left-sidebar-blur", "--we-left-sidebar-alpha",
  "--we-titlebar-blur", "--we-titlebar-alpha",
  "--we-floaters-blur", "--we-floaters-alpha",
  "--we-chat-glass-fidelity", "--we-chat-surface-tint-light", "--we-chat-surface-tint-dark",
  "--we-chat-surface-tint-rgb-light", "--we-chat-surface-tint-rgb-dark",
];

/**
 * 玻璃行停用 ⇒ 撤玻璃门控与变量（幂等；健康态零 DOM 走访）。
 * @param {unknown} components `/inventory` 的 components 表
 * @returns {boolean} 本轮是否真的清了东西
 */
function reclaimGlassResidue(components) {
  try {
    if (typeof document === "undefined" || !document.body) return false;
    // 缺 `glass` 键 = 探针没给结论（老宿主 / 探针没起）⇒ 按可用处理，与 weComponentVisible 同口径
    if (!components || typeof components !== "object" || !("glass" in components)) return false;
    if (components.glass === "started") return false;   // 行活着，玻璃归它自己管
    const body = document.body;
    const hasAttr = GLASS_RESIDUE_ATTRS.some((a) => body.hasAttribute(a));
    const hasVar = GLASS_RESIDUE_VARS.some((v) => body.style.getPropertyValue(v) !== "");
    const glassSheet = document.querySelector('style[data-plugin-css="dsh-wallpaper-engine/glass"]');
    if (!hasAttr && !hasVar && !glassSheet) return false; // 已经干净：不写任何东西
    for (const a of GLASS_RESIDUE_ATTRS) body.removeAttribute(a);
    for (const v of GLASS_RESIDUE_VARS) body.style.removeProperty(v);
    if (glassSheet) glassSheet.remove();
    for (const el of document.querySelectorAll("[data-we-titlebar-anchor]")) el.removeAttribute("data-we-titlebar-anchor");
    return true;
  } catch { return false; } // 回收失败不外抛：下一次 inventory 加载再对时
}

// 把可见面判据**注入全局**：可单独 import / 可独立求值的模块（avatar-layer、panel-tabs 的页签函数）
// 通过 `globalThis.__weComponentVisible` 取用它，而不裸引用本作用域里的符号（那些模块单独求值时会 ReferenceError）。
// 契约与 `selection` / `apiUrl` 一致：模块输入一律走 globalThis。
globalThis.__weComponentVisible = weComponentVisible;
// 玻璃残留回收同理注入全局：`src/effects.js`（applyEffects 每次设置变动都会跑）要用它，
// 但它单独求值时看不到本作用域 ⇒ 经 globalThis 桥接，缺席时那边静默跳过。
globalThis.__weReclaimGlassResidue = reclaimGlassResidue;
// Body attribute set while a wallpaper is active; CSS uses it to make the frame
// background transparent so the behind-body layer shows through.
const ACTIVE_ATTR = "data-we-wallpaper";
const LAYER_ID = "dsh-wallpaper-engine-layer"; // 壁纸层单例：全仓唯一声明点（verify-layer-ownership P1）
const SCRIM_ID = "dsh-wallpaper-engine-scrim"; // 可读性 scrim 单例：同上
// **层所有权契约（P-D S4，ADR-0013 D12）**：壁纸层与 scrim 是
// **进程内单例 DOM 节点**，所有权 = 主包渲染内核独占 —— `src/live-layer.js` 建层/领养/退役，
// `src/client.js` 的 fiber cleanup 摘净。子包（`packages/media-bridge` 浏览器半边）**不得**建层/退层，
// 也不许持 `#layer` 引用：它只经 host 键面拿渲染器与状态（`selection` 等活别名）。
// 判据：`test/verify-layer-ownership.mjs`（P1 声明/id 赋值点 · P2 body 挂载白名单 ·
// P3 拆卸零残留 · P4 iframe 父链）。改这两行或这两条路径 = 改契约，必须同步守卫。
// Chat-interface rope dock: a draggable pull-cord floating over the chat plus
// the glass repo side panel it pulls out. Both are portalled onto <body> under
// their own React root (see apply), independent of the settings view.
const ROPE_DOCK_ID = "dsh-wallpaper-engine-rope-dock";
const ROPE_POS_KEY = "dsh-wallpaper-engine:rope-pos";

// ── Defaults ─────────────────────────────────────────────────────────────────
// scrim default is intentionally LOW now: iOS liquid glass needs the wallpaper
// colour to pass through the glass, so we no longer crush it behind a near-black
// scrim. Users can raise it back via the 暗化 slider for busy wallpapers.
// 默认值来自**唯一真源** `lib/settings-schema.js`：构建期由 scripts/build-client.mjs
// 把该文件内联进本 bundle 的工厂作用域（缺标记即构建失败），所以 `DEFAULTS` / `KINDS` /
// 各枚举白名单在这里**直接可用、且不得重复声明**（重复即 SyntaxError，构建脚本会拦）。
// 每个键的语义注释也随默认值一起迁到了 schema。

// 白名单常量（过滤器取值 / 形态 / 帧率档 / 转场 / 字体族 / scale 上下限）由 schema 预置：
// 它们随 lib/settings-schema.js 在构建期内联到本作用域，本文件不再声明（重复即构建失败）。
// 吉祥物（拉绳）形态：whale = Deepseek_Pro / phoebe = 菲比啾比 / 八只「模型娘」；默认 = DeepSeek
// （`maid`「小女仆」从出厂形态除名，那只图搬进「作者自用」预设当彩蛋）；大小步进见下。
const ROPE_SCALE_STEP = 0.05;
// 字体族按钮数据（白名单 FONT_FAMILY_VALUES 在 schema 里；inherit = 跟随 dsh 原生字体栈）：
// label 显示名 + stack 应用/预览字体栈。stack 里保留中文
// fallback 链（行楷缺字体时退楷体、等宽用系统等宽栈），预览与应用同源，
// 用户在按钮上看到的就是应用后的效果。
// 华文行楷 STXingkai 随 Office 安装，缺失时退 KaiTi；macOS 走 "Xingkai SC"。
const FONT_FAMILY_STACKS = {
  inherit: "inherit",
  "Microsoft YaHei": '"Microsoft YaHei", sans-serif',
  KaiTi: 'KaiTi, serif',
  SimSun: 'SimSun, serif',
  SimHei: 'SimHei, sans-serif',
  STXingkai: '"STXingkai", "Xingkai SC", KaiTi, serif',
  monospace: 'ui-monospace, Consolas, "Courier New", monospace',
};
const FONT_FAMILY_LABELS = [
  { v: "inherit", get label() { return weT("默认"); } },
  { v: "Microsoft YaHei", get label() { return weT("雅黑"); } },
  { v: "KaiTi", get label() { return weT("楷体"); } },
  { v: "SimSun", get label() { return weT("宋体"); } },
  { v: "SimHei", get label() { return weT("黑体"); } },
  { v: "STXingkai", get label() { return weT("行楷"); } },
  { v: "monospace", get label() { return weT("等宽"); } },
];
// 依持久化值取应用字体栈。取值域有两类**族键**（都只存键、不存栈）：
//   · 内置键：FONT_FAMILY_STACKS 里的那些（栈写死在这里，含中文 fallback 链）；
//   · 本机字体键 `sys:<族名>`：清单来自宿主枚举（src/settings/system-fonts.js），栈在这里现拼。
// 另有一类**历史值**：组件字体可能存的是"解析后的 CSS 栈"（见 onComponentFamily 的注释）
// —— 那种值原样可用，因此解析侧两条都认（老字体集零迁移）。
const FONT_FAMILY_BY_STACK = Object.create(null);
for (const [key, stack] of Object.entries(FONT_FAMILY_STACKS)) FONT_FAMILY_BY_STACK[stack] = key;
// 本机字体栈的**最后一道**兜底链：只有 `--we-host-font-family`（宿主原字族的快照）也拿不到时
// 才用到。之所以优先用快照：fallback 链是 DSH 的决定（中文/等宽的退路都在里面），抄一份到这里
// 就会在下一次 DSH 调整时漏改。
const FONT_STACK_FALLBACK = 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif';
/**
 * **每条非 `inherit` 的栈都以它收尾**：先用自己的族名，再退回 **DSH 原来那条字族链的运行时快照**。
 *
 * 为什么内置族键也要收尾（**现场教训**）：内置那几条栈是**给 Windows 写的**（`KaiTi` / `SimSun` /
 * `STXingkai` …）。在 macOS 上它们**一个都不存在**（实测 `KaiTi` / `STXingkai` 都匹配不上）——
 * 不收尾时 `--dsw-font-family: KaiTi, serif` 会把**整个界面**压到 `serif`（Times），比"没生效"更糟。
 * 收尾之后，匹配不上的族名只是"这一档不起作用"，后面的 DSH 原链照常接管（中文 / emoji / 等宽都在）。
 */
const FONT_STACK_TAIL = ', var(--we-host-font-family, ' + FONT_STACK_FALLBACK + ')';
/** `sys:` 键 → `"<族名>"`（族名一律加引号：空格、连字符、中文名都安全）。 */
function systemFontStack(key) {
  const name = systemFontNameOf(key);
  return name ? '"' + name + '"' : "";
}
/** 族键 / 历史栈 → 可用的 CSS 栈；空、`inherit`、未知一律 `inherit`（=不覆盖官方外观）。 */
function fontFamilyStack(v) {
  const key = typeof v === "string" ? v.trim() : "";
  if (!key || key === "inherit") return "inherit";
  const base = FONT_FAMILY_STACKS[key] || (isSystemFontKey(key) ? systemFontStack(key) : (FONT_FAMILY_BY_STACK[key] || ""));
  if (!base || base === "inherit") return "inherit";
  return base + FONT_STACK_TAIL;
}
/** 反查：存下来的值（族键或历史栈）→ 下拉该选哪一项（空串 = 跟随 / 认不出的历史栈）。 */
function fontFamilyKeyOf(v) {
  const key = typeof v === "string" ? v.trim() : "";
  if (!key) return "";
  if (FONT_FAMILY_STACKS[key] || isSystemFontKey(key)) return key;
  return FONT_FAMILY_BY_STACK[key] || "";
}
/**
 * **摊平**成具体字体列表（没有 `var()`）—— 给"会被当成字体名列表**字符串**用掉"的下游。
 *
 * 为什么需要它：`fontFamilyStack` 给本机字体拼的是 `"<族名>", var(--we-host-font-family, …)`，
 * 那是给**CSS 声明**用的（`var()` 由浏览器替换）。但 dsh-ssh 的终端面板是把
 * `--dsh-ssh-terminal-font` 的值**当字符串读走再交给 xterm 的 `fontFamily` 选项**
 * （xterm 的 DOM/画布渲染器都不认 `var()`，`ctx.font` 里它就是个字面量 ⇒ 整条字体列表失效）。
 * 所以喂给它的那一份必须**当场摊平**：快照取不到就退回那条保底链。
 */
function fontFamilyStackConcrete(v) {
  const stack = fontFamilyStack(v);
  if (stack.indexOf("var(") < 0) return stack;
  let snapshot = "";
  // 读的是 documentElement 上的**内联**属性（`snapshotHostFontDefaults` 写在那儿）——
  // 内联读不触发样式重算（不像 getComputedStyle 那样强制布局）。
  try { snapshot = document.documentElement.style.getPropertyValue("--we-host-font-family").trim(); } catch { /* 拿不到就用保底 */ }
  return stack.replace(/var\(--we-host-font-family,\s*([^)]*)\)/, snapshot || "$1");
}
// 帧率上限 options (fps); 0 = 无限制. Mirror of the host whitelist.
// 场景实时渲染（WebWallGL）帧率上限档位。Mirror of lib/settings-schema.js 的 FPS_CAP_VALUES.

// 配色 presets for the settings-page liquid-glass theme. The accent drives
// buttons/sliders/selected cards/badges and the glass sheen via --we-accent;
// users can also pick any color with the native <input type="color">.
const ACCENT_PRESETS = [
  "#4f8cff", // 经典蓝 (default)
  "#67DCE7", // 冰青 (summer-liquid-glass primary)
  "#DD8FAC", // 玫瑰粉 (summer-liquid-glass brand)
  "#F3B75F", // 琥珀金
  "#F1717F", // 珊瑚红
  "#CBE77D", // 黄绿 (success)
];

// 玻璃颜色 presets for the settings-window glass BASE tint (--we-surface-tint-light/dark).
// The first two are the stock-look defaults (white in light mode, deep navy in
// dark); picking any preset (or a custom color) tints the glass in BOTH themes.
const GLASS_COLOR_PRESETS = [
  "#ffffff", // 白（浅色默认）
  "#0d1524", // 深夜蓝（深色默认）
  "#67DCE7", // 冰青
  "#DD8FAC", // 玫瑰粉
  "#F3B75F", // 琥珀金
  "#F1717F", // 珊瑚红
];

// 输入光标颜色 presets：光标要在壁纸/玻璃底上「跳出来」，高对比的
// 黑白最常用，其余给想让光标带主题色的用户；任意色可用后面的自定义取色器。
const CARET_COLOR_PRESETS = [
  "#ffffff", // 白（深色/深色壁纸）
  "#000000", // 黑（浅色壁纸）
  "#4f8cff", // 经典蓝（默认 accent）
  "#67DCE7", // 冰青
  "#DD8FAC", // 玫瑰粉
  "#F1717F", // 珊瑚红
];

// ── Persisted selection ─────────────────────────────────────────────────────


// 设置规范化：白名单与每个键的校验规则**全部**来自 lib/settings-schema.js（唯一真源）。
// 宿主侧调用同一个函数（side='host'，不收 CLIENT_ONLY 的键），因此两侧不可能再漂。
function sanitizeSettings(o) {
  return sanitizeFromSchema(o, "client");
}

// `readPersisted()` 已随持久化层抽到 src/settings/persistence.js（store 初始化仍在下面调用它）。

// ── Shared selection store (React + DOM layer share it) ────────────────────
const selection = {
  // ① 视图态默认值（`DEFAULTS_ONLY`）：它们**不在持久化白名单里** ⇒ `readPersisted()` 与本地缓存都
  //    不会提供，不显式铺这一层就是 `undefined`。默认 false 的键侥幸无事，**默认 true 的会静默失效**
  //    （`themeTypeOnly` 就这样失效过：代码声称默认开、界面上却是关的）。
  ...panelDefaults(),
  ...readPersisted(),
  // 字体值走**另一条**通道：真源是 `fontsets/<活动 id>.json`。
  // ⚠️ 顺序是承重的，两行都不能少：
  //   ① `fontValueDefaults()` —— 那些键已不在 settings 白名单里，`readPersisted()` **不再提供**它们，
  //      而字体集是异步载入、还可能失败。缺这份兜底 ⇒ selection 里根本没有 themeColors 等键，
  //      面板「字体自定义」门控的配色区会在打开开关那一刻抛 TypeError（整个面板崩掉）。
  //   ② `readCachedFontSetValues()` —— 有缓存就用缓存那份（首帧即用户字体，不出现默认值→用户值跳变）；
  //      没有时它返回的就是①那份兜底。宿主回了真值再由 loadFontSet() 覆盖。
  ...fontValueDefaults(),
  ...readCachedFontSetValues(),
  // 本机字体清单（src/settings/system-fonts.js）：**首帧就用缓存那份** —— 否则一个已选中的本机字体
  // 在下拉里会先显示成"跟随"，等宿主回话才跳回来。`systemFontsAt: 0` 让它照样算过期，
  // 打开字体设置时该重扫还是会重扫（缓存只是"先有个能显示的名字"）。
  systemFonts: readCachedSystemFonts(),
  // Transient: becomes true once loadPersisted() has applied the host-side
  // settings (the port-independent source of truth). The one-time notice waits
  // for it so it never flashes before the persisted noticeSeen is known.
  hostLoaded: false,
  // Transient（本机字体清单）：来源永远是宿主那次进程扫描 ⇒ 不落盘、不进字体集。
  //   systemFontsAt   上次取到的时刻（TTL 判据）
  //   systemFontsApproximate  宿主是**按文件名推测**出来的（面板要说出来）
  //   systemFontsLoading / systemFontsError  在途 / 可判定失败文案
  systemFontsAt: 0,
  systemFontsApproximate: false,
  systemFontsLoading: false,
  systemFontsError: "",
  // Transient: 活动字体集那一次加载的失败原因（面板据此显示可判定文案；空串 = 没问题）。
  fontSetError: "",
  // Transient（字体集编辑器）：
  //   fontSetOpen  子分支开关（视图态，defaults-only；这里显式给一份，缓存路径下也确定）
  //   fontSets     宿主清单（来源永远是宿主 ⇒ 只做瞬态，不落盘）
  //   fontSetActive 活动集 id（宿主的 `active`）
  //   fontSetLoading 清单在途
  //   fontSetEditing/fontSetDraftName  正在改名的那一行 + 输入框内容
  fontSetOpen: false,
  fontSets: [],
  fontSetActive: "",
  fontSetLoading: false,
  fontSetEditing: "",
  fontSetDraftName: "",
  // Transient（玻璃预设）：清单与失败原因来自宿主（不落盘）；saving/draftName 是保存
  // 对话框第一行（名字）的视图态；busy 是任何在途动作（应用/保存/导入/删除/清单）；
  // assetChecks 是保存对话框的资产勾选态（ADR-0011 D4：字体/吉祥物默认勾、头像默认不勾，
  // 且只有本机有那份资产时才可勾）；note 是导入成功这类一次性提示（成功与失败不同屏）。
  // store 见 src/settings/preset-store.js。
  glassPresets: [],
  glassPresetError: "",
  glassPresetBusy: false,
  glassPresetSaving: false,
  glassPresetDraftName: "",
  glassPresetNote: "",
  // 对话框用途（"save" = 存进预设栏 / "export" = 导出为文件；"" = 关着）。保存与导出
  // 共用同一组资产勾选项，导出时这是"对哪一份导出"的 id 载体（glassPresetTargetId）。
  glassPresetSaveTarget: "",
  glassPresetTargetId: "",
  glassPresetAssetChecks: { font: true, mascot: true, avatar: false, fontAvailable: false, mascotAvailable: false, avatarAvailable: false },
  // #219 首用引导：清单是否已真正从宿主加载成功（初始 false —— 判据不能把"还没加载"
  // 误当成"用户没存过"），以及引导当前挂着的目标 id（空串 = 不显示引导）。
  glassPresetsLoaded: false,
  glassPresetGuideTargetId: "",
  // 「已隐藏的出厂预设」清单：随包层被墓碑遮蔽的那些，供面板画恢复区。
  glassPresetHidden: [],
  url: null,
  type: null,
  previewUrl: null,
  // Transient: real container suffix of the media (host inventory `mediaExt`, e.g. "mp4").
  // The media URL is token-shaped (`/media/<base64url>`) with no extension, so the
  // "browser can play this natively" decision (see src/wallpaper/video-layer.js) needs this field.
  mediaExt: null,
  // Transient: 图片 / 幻灯片壁纸的图集入口（host inventory `slidesUrl`，形如
  // `/wallpaper-engine/slides/<token>`；只有图集 ≥2 张时才给）。`buildMedia` 据此在底层
  // 封面图上叠交叉淡化层；`slideIntervalMs` 是 WE 项目里声明的那一档（`imageswitchtimes`），
  // 用户设置 `pictureSlideSeconds` 非 0 时以用户为准。两者都不落盘 —— 它们随壁纸变。
  slidesUrl: null,
  slideIntervalMs: null,
  // Transient: scene wallpaper animation MP4 URL (host /scene-video route).
  // When present the scene plays as a hardware-decoded <video>; on load error
  // it is nulled and the layer rebuilds as a still image (the frame URL:
  // live-backfilled GPU frame / user-imported custom frame / empty state).
  sceneVideo: null,
  // Transient: WebWallGL 实时渲染 token（host /scene-files 路由的 src 参数）。
  // 场景取 sceneLiveSrc（主文件 token：pkg 容器或松散入口 json），网页取 webLiveSrc（入口 HTML）；
  // 存在且开关开启且无失败记忆时以 live iframe 形态播放
  //（buildMedia 最高优先级，见 liveRenderEnabled）。
  sceneLiveSrc: null,
  webLiveSrc: null,
  // Transient: 「壁纸属性」面板入口（host /props/<token>，仅场景/网页壁纸有）。
  propsUrl: null,
  // Transient: live 渲染心跳已确认出帧（startLiveWatch）。音频互斥（live 时
  // WebWallGL 自播包内音频，不再启动外置 <audio>）与卡片状态用。
  sceneLiveActive: false,
  // Transient: 场景包内独立音频（mp3/ogg 等，host /scene-audio 路由）。与
  // sceneVideo 互斥使用 —— 内嵌 MP4 时视频自带音轨；无内嵌视频时由独立
  // <audio> 元素播放，音量/开关复用 videoVolume / videoAudioEnabled。
  sceneAudioUrl: null,
  sceneHasAudio: false,
  // Transient: source media metadata ({ width, height, codec, fps }) from
  // /media-info (host moov probe, cached).
  mediaInfo: null,
  // Transient: whether dsh-better-sidebar is installed & enabled (host reports
  // it via the settings GET response). Gates the 侧栏玻璃 control group in the
  // picker — the knobs are meaningless without the sidebar, so they only show
  // when it is actually there.
  sidebarPresent: false,
  // Transient: 抽帧转码 lifecycle — "idle" | "working" | "ready" | "fallback"
  // | "skipped" (see maybeUpgradeToTranscoded).
  transcodeState: "idle",
  // Transient: { phase: "download"|"transcode"|"done"|"error", percent, source }
  // polled from /transcode-progress while "working" (progress bar).
  transcodeProgress: null,
  playing: true,
  // 真实播放态（transient）: `playing` 是「用户意图」，这里是 <video>
  // 元素的真实状态。play() 可能被拒（自动播放策略 / 浏览器解不了自上传视频的
  // 编码 / 被紧接着的 src 切换打断），只信意图的话面板会一直写「播放中」、
  // 卡片上唯一的按钮是「暂停」—— 壁纸冻在首帧（看上去就是空白）而用户找不到
  // 「继续」。见 syncVideoState / applyVideoPlayback。
  videoPlaying: true,
    // 播放失败原因（transient，"" = 正常）。非空时当前壁纸卡片显示一句
  // 可读原因，提示用户重试或换编码。
  videoError: "",
  // 选择被拒原因（transient）: applySelection 没能应用该 id（被内容分级 /
  // 类型过滤排除，或文件已消失）—— 卡片上给出一句可操作的说明。
  blockedNote: "",
  loading: false,
  rotationTimer: null,
  // Draft of the rotation group currently being created/edited in the picker
  // (null when the editor is closed). Mutated live; committed on 保存.
  editing: null,
  // Transient picker UI state (NOT persisted): batch hide/restore selection
  // mode, the open/closed state of the wallpaper picker MODAL and its active
  // view ("normal" | "hidden"). The hidden section used to be inline; it now
  // lives as a tab inside the modal (see WallpaperPicker).
  batchMode: false,
  batchSelected: [],
  page: 0,
  hiddenPage: 0,
  editorPage: 0,
  hiddenOpen: false,
  pickerOpen: false,
  // Transient: 库视图的用途开关 —— true = 轮播编辑器的「选择壁纸」下钻
  //（点卡片 = 加入/移出草稿，不切当前壁纸）；false = 普通下钻（点卡片即应用）。
  pickerDraft: false,
  modalView: "normal",
  // Transient: picker-modal title search (not persisted).
  search: "",
  // Transient: 快捷播放面板自己的搜索词（与库视图互不影响；不落盘）。
  // 类型筛选与设置页共用持久化键 `typeFilter`（"两处同步、不做单独的"是用户口径）。
  qpSearch: "",
  // Transient: 侧栏底栏的深链请求 —— "打开设置页后停在哪一页"（`""` = 无请求）。
  // 由 WallpaperPicker 的一个 effect 消费一次即清（见 src/ui/sidebar-right.js 的
  // openSettingsSection 与 client.js 的「侧栏深链」段）。
  settingsTabRequest: "",
  // 破坏性动作的「面板内确认」令牌 —— **所有族共用这一个真源**（`""` = 没有动作待确认）。
  // 形态 `<族>:<id>`（族内带 id 的动作）或 `<族>`（整块动作）。机制与三条不变量见
  // `armConfirm` 那一段（本文件，"破坏性动作的面板内确认"）。**不是** picker 私有字段：
  // 轮播列表 / 移除自定义壁纸 / 批量隐藏 / 全部恢复 / 删字体集 五处共用它。
  armedConfirm: "",
  // Custom-upload UI state (transient): in-flight flag + last error message.
  uploading: false,
  uploadError: "",
  uploadNote: "",
  // URL 源导入（transient）：草稿直链 / 在途标志 / 最后错误 / 成功提示。
  urlDraft: "",
  urlBusy: false,
  urlError: "",
  urlNote: "",
  // 自定义会话头像（「扩展」页签第一个模块）的导入态（transient）：在途的那一方
  // （"" = 空闲，值是 'user' | 'ai'）与最后一条错误。与上面两枚同口径 —— 只活在内存里，
  // 设置白名单没有它们（serialize 时被 schema 过滤掉）。
  avatarBusy: "",
  avatarError: "",
  avatarCompressing: false,
  // 自定义吉祥物立绘的导入态（transient）：在途标志与最后一条错误（同上面两枚口径）。
  mascotBusy: false,
  mascotError: "",
  // 待确认的**形态切换目标**（transient）：自定义立绘生效时点内置项 / 按 ‹ › 都会先把目标
  // 记在这里并置 armedConfirm，由面板画一行两步确认 —— 切到内置形态必须先清除那张自定义
  // 立绘，而清除**不可恢复**，所以是唯一需要确认的路径。空串 = 没有待确认的切换。
  mascotPendingForm: "",
  // Upload-directory editor (transient): open state + draft path.
  editingUploadDir: false,
  uploadDirDraft: "",
  // 缓存位置编辑器（transient）：开态 + 草稿路径 + 上次错误。**生效值由 inventory.cacheDir
  // 携带**（host 是唯一真相）—— 它给的是解析链的答案，设了 `DSH_WE_CACHE_DIR` 时这个答案
  // 和用户填的值不同，界面据此提示"当前由环境变量覆盖"。
  editingCacheDir: false,
  cacheDirDraft: "",
  cacheDirBusy: false,
  cacheDirError: "",
  cacheDirNote: "",
  // 缓存位置目录浏览器（transient）：null=关。列表条目是宿主给的 { name, path } ——
  // path 原样回传问下一级，客户端**不做任何路径拼接**（分隔符/盘符大小写都是宿主的口径）；
  // display 是地址栏草稿（可手输，Enter 跳转），选中即把它填进 cacheDirDraft 走既有保存链。
  cacheDirBrowse: null,
  // WE 官方资源路径编辑器（transient）：开态 + 草稿路径 + 上次错误。
  // 生效状态（目录/可用性）由 inventory 携带（host 是唯一真相）。
  editingWeAssetsDir: false,
  weAssetsDirDraft: "",
  weAssetsError: "",
  inventory: { installDir: null, uploadDir: null, cacheDir: null, weAssetsDir: null, weAssetsAvailable: false, weAssetsSource: null, sceneMediaBase: "", wallpapers: [], total: 0, portableCount: 0, playlists: [], wallpaperMachineRoots: 0, error: null },
  loaded: false,
};

const listeners = new Set();
function emit() { for (const fn of [...listeners]) fn(); }
function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// ── 皮肤中心（dsh-skins）互操作：皮肤在台上 ⇒ 我方整族退场 ─────────────────────
// 对立面已由对方实现（只读 `body[data-we-wallpaper]`：壁纸应用时皮肤整体停画）；这里补
// **反向**——皮肤试穿 / 应用时我方让路。信号只有一条腿，只读、绝不写对方任何状态：
//   `html[data-dsh-skin]` = 对方"皮肤在台上 / 皮肤要求上台"的公开标记。dsh-skins#49 起，
//   对方的**显式**试穿 / 应用会让这一次激活照常上台并重写该属性（同值 setAttribute 也产生
//   mutation record ⇒「重复应用同一款」同样可见）；对方另给了那条让路信号 1500ms 上限，
//   我们不接时它会自己退回普通停画。早先为补"应用"这条腿做的轻轮询
//   （`GET /api/skin-center/v2/active`）已随该契约落地整体删除 —— 纯事件、无网络。
// 退场 = 清当前壁纸（若设过；层 / 遮罩 / `body[data-we-wallpaper]` 随 `selection.url` 一起退）
//        + 玻璃整族门控整组不匹配（与旧「要不要玻璃 = 关」同语义；落点在 applyGlass 与
//        effects 的两个门控点）
//        + **主题放回**（`themeFollowRelease`，随清空路径自动走到）：我方为这张壁纸改过主题
//        才放回原值；别人改过（让位标记 / 现值对不上）就一个字节都不碰 —— "退干净"与
//        "不硬覆盖回去"两条在这里合流。没设壁纸时前半条是空操作，但玻璃让路照常 —— 玻璃与
//        壁纸正交（data-we-glass-page 恒挂），皮肤在台上时它不该盖在皮肤上。
// 复位 = 持续不在台上（滞回，见下）才做：按记忆放回壁纸与轮播开关；用户期间手动选过壁纸
//        就不抢（手动重选那条路会**立刻**退让路，见 src/media-prep.js 的钩子）。放回壁纸时
//        主题评估走 `fromSkinRestore`（不复位让位标记）：皮肤在台期间用户改过的主题活过这次
//        放回，不被打回壁纸判决。
// ⚠️ 轮播会把"空 id"当信号自动补位（`rotationEnabled && !id` ⇒ 取候选第一张），所以退场
//    必须连轮播一起按停，否则刚清掉的壁纸会被自己补回来。
const SKIN_YIELD_EXIT_GRACE_MS = 2600; // 复位宽限：对方 refresh 会先把标记摘掉再补回，瞬时摘不算退场
const SKIN_YIELD_ENTER_GRACE_MS = 450; // 退场宽限：对方的**启动上妆**是瞬时翻转（随后被它自己的 refresh 自纠），
                                       // 真实动作会持续 ≥1.5s（它的让路宽限）⇒ 只认"过一拍还在"的出现
let skinYielded = false;
let skinYieldMemory = null;        // { id, rotationEnabled }：退场前的用户选择
let skinYieldExitTimer = null;     // 复位要「持续不在台上」才执行（对方 refresh 的瞬时空窗不算退场）
let skinYieldEnterTimer = null;    // 退场要「过一拍还在台上」才执行（对方启动上妆的瞬时翻转不算动作）

/** 让路态是否生效（glass / effects 的门控点读它）。try 防 TDZ：prelude 早于 client 主体执行。 */
function skinYieldActive() {
  try { return skinYielded === true; } catch { return false; }
}

/** 皮肤上台 ⇒ 退场（幂等）。 */
function enterSkinYield(reason) {
  if (skinYielded) return;
  skinYielded = true;
  skinYieldMemory = { id: String(selection.id || ""), rotationEnabled: selection.rotationEnabled === true };
  // 记忆**落盘**（skinYieldRestoreId / skinYieldRestoreRotation，schema 两枚无界面键）：
  // 让路态跨重启后模块记忆归零、盘上只剩"清空后的现状" —— 认领与启动复位要靠这两枚
  // 键把退场前的选择拿回来，否则重启一次记忆就丢、之后退皮肤永远放不回来。
  setSetting("skinYieldRestoreId", skinYieldMemory.id);
  setSetting("skinYieldRestoreRotation", skinYieldMemory.rotationEnabled);
  if (selection.rotationEnabled) setSetting("rotationEnabled", false);
  applySelection("");        // 清层：url=null ⇒ syncLayers 摘层 / 遮罩 / data-we-wallpaper
  persistSelection();
  applyEffects();            // 让路态里玻璃门控整族摘除
  emit();
  reportClientDiag("skin-yield", "enter · " + reason + " · restore=" + (skinYieldMemory.id || "-"));
}

/** 皮肤退场 ⇒ 复位（幂等）。`opts.skipRestore` = 调用点自带新选择（手动重选那条路）。 */
function exitSkinYield(reason, opts) {
  if (!skinYielded) return;
  const skipRestore = !!(opts && opts.skipRestore);
  skinYielded = false;
  const mem = skinYieldMemory || {};
  skinYieldMemory = null;
  if (!skipRestore && !selection.id && mem.id) {
    // `fromSkinRestore`：这次应用是"皮肤退场后的放回"—— 主题评估据此**不复位让位标记**，
    // 皮肤在台期间用户改过的主题不被这次放回盖掉（"切换过主题不硬覆盖回去"）。
    applySelection(mem.id, { fromSkinRestore: true });
  }
  if (mem.rotationEnabled && selection.rotationEnabled !== true) setSetting("rotationEnabled", true);
  // 落盘记忆已消费（放回，或被用户新选择取代）⇒ 清掉 —— 别留给下一次启动当陈旧依据。
  setSetting("skinYieldRestoreId", "");
  setSetting("skinYieldRestoreRotation", false);
  persistSelection();
  applyEffects();
  emit();
  reportClientDiag("skin-yield", "exit · " + reason);
}

/**
 * 排定一次退场：对方**启动上妆**（它的运行时在我们的标记到达前先按持久化选择上妆）会在自己的
 * `refresh()` 里被自纠，是一次**瞬时翻转**；而用户显式动作会一直亮着（它的让路宽限 1.5s
 * 才回收）。所以只认"过一拍还在"的出现：宽限结束时 DOM 仍带标记、且我方确实有要退的东西
 * （壁纸在台 ⇒ 清层；或**无壁纸**且设置已就位 ⇒ 只剩玻璃要让）⇒ 才是动作。
 * ⚠️ 450ms 必须显著短于对方的 1500ms 宽限，否则真实动作会在我们确认前被它回收。
 */
function scheduleSkinYieldEnter(reason) {
  if (skinYieldEnterTimer !== null || skinYielded) return;
  const fire = () => {
    skinYieldEnterTimer = null;
    try {
      if (!document.documentElement.hasAttribute("data-dsh-skin")) return; // 瞬时翻转：已自纠
      // 「我方在台上」有两条腿（竞态注见 syncSkinYield）：
      //   · 壁纸腿：标记在场 ⇒ 有层要让。它兼防启动竞态 —— 标记不在场时，只有"设置已
      //     就位且 id 为空"（真·无壁纸）才放行；设置在途（!loaded）或壁纸在册但层还没建
      //     （id 非空）都可能是竞态窗口，一律不算动作（实测报障：有壁纸时刷新掉壁纸）。
      //   · 无壁纸腿：没有层可清、也没有竞态可防，但玻璃整族仍盖在皮肤上（玻璃与壁纸
      //     正交，data-we-glass-page 恒挂）⇒ 这条腿也要进，否则无壁纸用户中途试穿 /
      //     应用皮肤永远摘不掉玻璃（安装期的 adopt 只管启动那一拍）。
      const wallMarkerOn = !!(document.body && document.body.hasAttribute("data-we-wallpaper"));
      if (!wallMarkerOn && (selection.id || !selection.loaded)) return;
      enterSkinYield(reason + "/dom");
    } catch { /* ignore */ }
  };
  try {
    if (typeof window === "undefined" || typeof window.setTimeout !== "function") { fire(); return; }
    skinYieldEnterTimer = window.setTimeout(fire, SKIN_YIELD_ENTER_GRACE_MS);
  } catch { fire(); }
}

/** 撤销已排定的退场（标记又消失了 / 卸载）。 */
function cancelSkinYieldEnter() {
  if (skinYieldEnterTimer === null) return;
  try { if (typeof window !== "undefined" && typeof window.clearTimeout === "function") window.clearTimeout(skinYieldEnterTimer); } catch { /* ignore */ }
  skinYieldEnterTimer = null;
}

/** 撤销已排定的复位（皮肤又回来了 / 卸载）。 */
function cancelSkinYieldExit() {
  if (skinYieldExitTimer === null) return;
  try { if (typeof window !== "undefined" && typeof window.clearTimeout === "function") window.clearTimeout(skinYieldExitTimer); } catch { /* ignore */ }
  skinYieldExitTimer = null;
}

/**
 * 排定一次复位：必须**持续**不在台上才真的复位 —— 对方 refresh（withheld 翻转）会先把
 * `html[data-dsh-skin]` 摘掉再补回，瞬时摘若直接复位，壁纸会被抢回来把皮肤顶掉。
 * 宽限结束时再合一次数；对方那条让路信号只有 1500ms 上限，2.6s 的宽限天然晚于它。
 */
function scheduleSkinYieldExit(reason) {
  if (skinYieldExitTimer !== null) return;
  const fire = () => {
    skinYieldExitTimer = null;
    try {
      if (document.documentElement.hasAttribute("data-dsh-skin")) return; // 又回来了
      exitSkinYield(reason + "/cleared");
    } catch { /* ignore */ }
  };
  try {
    if (typeof window === "undefined" || typeof window.setTimeout !== "function") { fire(); return; }
    skinYieldExitTimer = window.setTimeout(fire, SKIN_YIELD_EXIT_GRACE_MS);
  } catch { fire(); }
}

/** 合议当前状态：皮肤"要求上台"且我方确实在台上 ⇒ 退场；持续不在台上则排定复位。 */
function syncSkinYield(reason) {
  try {
    if (document.documentElement.hasAttribute("data-dsh-skin")) {
      cancelSkinYieldExit();
      // ⚠️ 「我方在台上」有两条腿：壁纸在台（标记在场 ⇒ 有层要让）与无壁纸（设置已就位
      //    且 id 为空 ⇒ 只剩玻璃要让）。启动竞态只长在壁纸腿上——对方运行时会先于我们的
      //    标记上妆（他们的首屏预判只管**交付文档**，管不到运行时那次同步读；那时
      //    `body[data-we-wallpaper]` 还没挂，因为我们的层是启动链解析完才建的），把它当
      //    动作会清掉壁纸（实测报障：有壁纸时刷新掉壁纸）。正确的收场是：让我们的层建起来
      //    → 标记挂上 → 对方 watcher 自行 withhold 撤掉皮肤。无壁纸腿没有竞态（没有层可清），
      //    随宽限进即可。不是立即退场：先排定一次"过一拍再确认"（见 scheduleSkinYieldEnter）。
      scheduleSkinYieldEnter(reason);
      return;
    }
    cancelSkinYieldEnter();
    if (skinYielded) scheduleSkinYieldExit(reason);
  } catch { /* 互操作是增强：任何异常都不波及壁纸主路径 */ }
}

/** 装上互操作（单腿：DOM 观察）；返回幂等 teardown。 */
function installSkinInterop() {
  if (typeof document === "undefined" || !document.documentElement) return () => {};
  let observer = null;
  try {
    observer = new MutationObserver(() => syncSkinYield("dom"));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-dsh-skin"] });
  } catch { observer = null; }
  // 启动期的「认领」：只认领现状，不当作动作。认定条件：
  //   · 皮肤在台上（文档交付时 tap 已画）+ 我方**没有**选中的壁纸 ⇒ 本来就该在让路态
  //     （玻璃退场）——认领，不清层；记忆从**盘上落的那份**拿（enter 写的
  //     skinYieldRestoreId / skinYieldRestoreRotation），没落过盘才退回空记忆；
  //   · 皮肤在台上 + 我方有选中的壁纸 ⇒ 壁纸赢（对方的 withhold 会处理皮肤），不动；
  //   · 皮肤**已不在**台上 + 我方没有壁纸 + 盘上留着让路记忆 ⇒ 启动复位：按记忆放回
  //     （应用关闭期间皮肤被移除 / 卸载的那条路 —— 没有它，记忆落了盘也无人消费）。
  // ⚠️ 认领必须等**宿主设置到位**（`selection.loaded`）：本地缓存可能过期（本窗口缓存空、
  //    宿主却有壁纸）——那时认领会留下"壁纸在画 + 我们却在让路态"的错位。
  let adoptPending = true;
  const adoptOnLoaded = () => {
    if (!adoptPending || !selection.loaded) return;
    adoptPending = false;
    try {
      if (document.documentElement.hasAttribute("data-dsh-skin") && !selection.id) {
        const rid = String(selection.skinYieldRestoreId || "");
        skinYielded = true;
        skinYieldMemory = {
          id: rid,
          rotationEnabled: rid ? selection.skinYieldRestoreRotation === true : selection.rotationEnabled === true,
        };
        applyEffects(); // 认领即刻摘玻璃门控（首次 applyEffects 可能已经跑过）
        reportClientDiag("skin-yield", "adopt · install/dom");
      } else if (!document.documentElement.hasAttribute("data-dsh-skin") && !selection.id
        && String(selection.skinYieldRestoreId || "")) {
        skinYielded = true;
        skinYieldMemory = {
          id: String(selection.skinYieldRestoreId || ""),
          rotationEnabled: selection.skinYieldRestoreRotation === true,
        };
        exitSkinYield("boot-restore"); // 借 exit 的消费路径：放回 + 清落盘记忆 + 落盘 + 诊断行
      }
    } catch { /* 互操作是增强：任何异常都不波及壁纸主路径 */ }
  };
  const unsubAdopt = subscribe(adoptOnLoaded);
  adoptOnLoaded(); // remount / 已加载：立刻判一次
  return () => {
    try { if (observer) observer.disconnect(); } catch { /* ignore */ }
    cancelSkinYieldExit();
    cancelSkinYieldEnter();
    try { unsubAdopt(); } catch { /* ignore */ }
    skinYielded = false;
    skinYieldMemory = null;
  };
}

// ── 「终端字体」抢跑一次（**时机问题**，不是优化）────────────────────────────
// dsh-ssh 的终端面板**只在构造终端的那一刻**读 `--dsh-ssh-terminal-font`，之后只有它自己的设置
// 变化才重读（见 src/font/apply.js 里 `applyTerminalHostVar` 的注释）。而我们的权威值要等宿主把
// 设置与字体集**异步**读回来 —— 终端常常在那之前就建好了（现场症状："重启了还是口"）。
// 这里用**同步可读**的那份缓存（localStorage 里的字体集 + 设置缓存）先把值写上，抢在别的插件
// 构造终端之前；宿主回话后由 applyEffects → applyComponentFonts 再写一遍权威值。
// ⚠️ 必须是正文里的**顶层语句**：内联模块被注入在正文之前，模块顶层读 selection 会撞 TDZ。
applyTerminalHostVar();

// ── 出图来源：场景壁纸「这张画面从哪来」（beta 渲染不参与）───────────────
// 值域的**真源**在宿主侧 `packages/media-bridge/lib/routes/scene-frame.js`（它把非法值 clamp 掉）——本表要与它一致，
// 只剩两档：
//   0 = 自动（求链头：实时抓帧 → 自定义画面 → 空态）
//   4 = 强制自定义画面（用户导入的截屏）
// ⚠️ UI **只能给出上面这两档**：别的值到了宿主一律被 clamp 成 0，点了等于"没反应"。
// ⚠️ 表里存的是**档位值**（进 ?v=），不是下标；值域有洞（0 与 4）⇒ 推进不能用取模。
const FRAME_VARIANTS = [
  { id: 0, get label() { return weT("实时画面"); } },
  { id: 4, get label() { return weT("自定义画面"); } },
];
// 卡片类型徽标（卡片左上角）：与「类型」筛选的四类一一对应。
const CARD_TYPE_LABELS = {
  get video() { return weT("视频"); },
  get web() { return weT("网页"); },
  get image() { return weT("图片"); },
  get scene() { return weT("场景"); },
};
// 开启「壁纸音轨」时，音量若为 0 自动提升到的默认可听值（0–1）。
// 默认音量是 0（静音起步），而音轨开关只翻总开关不动音量 —— 不自动提音量的话，
// 用户点「音乐开」开关状态变了却依然无声，看起来就是「音量开/关都不生效」
//（注意勿误读：语义见 onToggleAudio）。
const DEFAULT_AUDIO_VOLUME = 0.5;
// 当前壁纸可用档位数：未导入自定义画面时只剩「自动」一档（切过去会被宿主 422）。
function frameVariantCount(selLike, wid) {
  const cf = selLike.customFrames || {};
  const inv = (selLike.inventory && selLike.inventory.wallpapers) || [];
  const wp = inv.find((w) => String(w.id) === wid);
  return (cf[wid] === true || (wp && wp.hasCustomFrame)) ? FRAME_VARIANTS.length : 1;
}
function frameUrlWithVariant(frameUrl, v) {
  if (!frameUrl) return frameUrl;
  const base = String(frameUrl).split("?")[0];
  return v > 0 ? base + "?v=" + v : base;
}
// ── React hook for the picker UI ────────────────────────────────────────────
function useStore() {
  const [, setTick] = React.useState(0);
  React.useEffect(() => subscribe(() => setTick((n) => n + 1)), []);
  return selection;
}

// ── 改 store 的三个入口────────────────────────────
// "赋值 + persistSelection()" 必须成对，而手抄这份成对关系时**漏掉 persist 就是静默失效**
// （"改了不生效 / 刷新后回退"，且没有任何判据会红）。收成三个入口后：
//   · setSetting(field, value)   改**设置**并落盘（唯一入口）
//   · setFontValues(patch)       改**字体值**并落盘（唯一入口；真源是 fontsets/<id>.json，
//     见 src/settings/fontset-store.js —— 这些键已退出 settings 的持久化白名单）
//   · setTransient(field, value) 改**瞬态**字段（上传中/编辑中/加载中…），不落盘 ——
//     它们不在 schema 白名单里，落盘只会白跑一次 debounce。
// 页签（src/panel-tabs.js）通过 ctx 拿到前两个入口，因此**完全不碰** `selection`。
//
// ⚠️ 已知边界（守卫 ①e 的上界棘轮盯着，只许下降）：`src/media-prep.js` / `src/effects.js` /
// `src/live-layer.js` 手上只有 `selection`（没有入口可调），对**已知瞬态字段**仍有 11 处裸直写
// （`url` / `blockedNote` / `videoPlaying` / `videoError`）。要收掉得先把这三个入口注入进去 ——
// 在那之前，新增一处就会被判红，收掉一处要把上界一起下调（余量空转同样会被判红）。
function setSetting(field, value) {
  selection[field] = value;
  persistSelection();
  return value;
}
function setTransient(field, value) {
  selection[field] = value;
  return value;
}
// ── 拖动期的「看得见的那部分」（live）──────────────────────────────────────
// 拖动类控件（色板 / 滑块）在 input 上**每格**都发事件 —— 原生颜色轮盘一次拖动可以上百次。
// 若每格都 `setSetting + emit()`：emit 让整棵面板（设置页那棵最重）重渲染，而 emit 的
// 订阅者里那次全量 applyEffects 还会重建字体样式表、同步场景音频、并读出一次**强制同步
// 样式计算**（壁纸透明度 > 0 时）—— 拖动因此发涩（用户实测）。故分两档：
//   · live（input / 拖动中）：写值 + `applyEffects({ live: true })`（跳过与本次改动无关的
//     重活，样式变量照旧全量写），**不 emit** —— 面板不重渲染，数值回显由控件自己就地更新
//     （SliderRow 的 --we-fill / 原生色块的自身外观）；
//   · 抬手（change）：走完整的一次 —— `emit()`（applyEffects 是它的订阅者，全量那一次照旧）。
// 与「壁纸属性」面板的 silent 拖动同一条口径（src/picker/picker-props-panel.js 的 onPropInput）。
// 拖动期的中间值**照样会落盘**（setSetting → debounce 200ms），所以中途关窗也不丢最后一次值。
function commitLiveSetting(field, value, live) {
  setSetting(field, value);
  if (live) applyEffects({ live: true });
  else emit();
}
/**
 * 同一套两档口径，但写给**瞬态**字段（`setTransient`，不落盘）。
 *
 * 为什么需要它：瞬态也有"拖动中每格都来"的场景（上传裁切的拖拽与缩放），而那些值同样
 * 只需要"看得见的那部分"跟手、**不需要**整棵面板重渲染。与 `commitLiveSetting` 同形成对 ——
 * 面板处理器写 store 必须能通知到（本仓既有判据），走这个入口就自动满足。
 */
function commitLiveTransient(field, value, live) {
  setTransient(field, value);
  if (live) applyEffects({ live: true });
  else emit();
}

/**
 * schema 的**取值域**（与 `readOne` 的 `num` 档同源；`min` / `max` 允许写成 `CONSTS` 的名字）。
 *
 * 为什么必须有它：滑块一类的处理器要自己钳一次（控件值可能来自键盘 / 粘贴），而**手写**那对
 * 数字会与 `KINDS` 漂移。⚠️ 这不是理论风险 —— 把刻度改成 0–100 时改了 `KINDS` 与面板量程，
 * 漏了这里手写的四处；后果比"钳错"更糟：`clampNum` 是**越界即回落到默认值**，于是一旦拖过旧上限，
 * 滑块就**跳回默认值**（用户实测：「玻璃透明度」最多只能拉到 20% —— 20 正是默认值）。
 * ⇒ 取值域只从 schema 取，不在这里出现数字。守卫 `verify-client` 对账这两者。
 */
const schemaRange = (key) => {
  const m = KINDS[key] || {};
  const lo = typeof m.min === "string" ? CONSTS[m.min] : m.min;
  const hi = typeof m.max === "string" ? CONSTS[m.max] : m.max;
  return [lo, hi];
};

// ── 破坏性动作的「面板内确认」（**唯一机制**，五个动作共用）─────────────────────
// 为什么禁用原生模态（`window.confirm` / `alert`）：本插件跑在**同一个渲染页**里，原生
// 对话框会把焦点交给它自己的窗口，后果三重的 ——
//   ① `blur` 立刻命中「窗口失焦时暂停」（`pauseOnBlur`，用户可开）⇒ 壁纸停住；
//   ② 模态在时渲染线程**被同步阻塞** ⇒ 输入框收不到键，壁纸即便焦点回来也恢复不了；
//   ③ 关闭时回来那个 `focus` 事件**不保证送达** ⇒ 遮挡判定卡在"窗口失焦"，只剩重载能救。
// 客户端另有 3s 低频复核（`OCCLUSION_RECHECK_MS`）把③自愈，但那是**兜底**：≤3s 的停摆
// 仍会发生，且②在原生模态下无解 ⇒ 本族一个 `window.confirm` 都不许有（守卫按 0 钉住）。
//
// 三条不变量：
//   1. **唯一令牌**：同一时刻最多一个动作待确认（`selection.armedConfirm` 是单值）⇒ 结构上
//      不可能同时挂着两个问句，也不可能"确认"到用户没看见的那个对象上。
//   2. **破坏性动作只由「确认」发起**：第一下点击只置令牌；真正的写操作是问句行里那枚
//      「确认」的回调 —— 不是"按钮里套一个 if"。置令牌与落地因此可以被分别断言。
//   3. **瞬态 + 上下文切换必清**：令牌不落盘；关模态框 / 换模态视图 / 退批量 / 换轮播列表 /
//      切页签都必须 `disarmConfirm()` —— 留着它会让问句跨上下文残留（用户在新上下文里看到
//      一个针对旧对象的问句）。
const armConfirm = (token) => { setTransient("armedConfirm", token); emit(); };
// **总是通知**（没有令牌也 emit）：这两个函数经常被拿来**顶替一句 `emit()`**（"换上下文 ⇒ 顺手清令牌"），
// 一旦这里在"本来就没有令牌"时静默返回，那条路径就**丢了重渲染** —— 视图停在上一个状态，直到用户
// 碰了别的控件才一起兑现（实测：收起「字体集预设」子分支时开关不动、再点别的按钮才连带收起）。
// 多一次幂等重渲比丢一次重渲便宜得多，所以这里不做"没变就不发"的优化。
const disarmConfirm = () => { setTransient("armedConfirm", ""); emit(); };
/** 该族当前待确认项的 id（没有 = `""`）。令牌形态 `<族>:<id>`；整块动作不带 id。 */
const armedIdOf = (family) => {
  const t = typeof selection.armedConfirm === "string" ? selection.armedConfirm : "";
  return t.indexOf(family + ":") === 0 ? t.slice(family.length + 1) : "";
};
/**
 * 「待确认」那一行：问句在左、两枚按钮（`确认` / `取消`）在右。不匹配令牌 ⇒ 返回 `null`。
 *
 * `armed` 是**读值**，`onConfirm` / `onDisarm` 是**回调** —— 由组件经 ctx 交给渲染器，
 * 渲染器自己不写 `selection`（两个渲染器的文件头契约）。问句文本由**调用点**现算（"选中的
 * N 张"这类计数跟着当前状态走），所以渲染器不许把它当常量缓存。
 * 4 处使用点（src/panel-tabs.js 两处 / src/picker/picker-modal.js 两处）共用这一份标记：抄四份会让
 * "两字的按钮等宽""置灰不塌位"这类形态约束各走各的。
 *
 * ⚠️ `!token` 这一支是**必须的**，不是防御性编程：令牌由当前对象现算，对象没了就退化成 `""`
 * —— 那与"没有动作待确认"的 `""` **相等**，于是刚删掉的那个列表会留下一个指向空对象的问句行
 *（实测：删光列表后问句行不收起）。空令牌的语义是"这一处没有可确认的对象"，永不渲染。
 */
function renderConfirmRow(armed, token, question, onConfirm, onDisarm) {
  if (!token || armed !== token) return null;
  return React.createElement("div", { className: "we-picker__row we-picker__confirm-row" },
    React.createElement("span", { className: "we-picker__hint we-picker__confirm-ask" }, question),
    React.createElement("button", {
      className: "we-picker__btn", type: "button", onClick: onConfirm,
      title: weT("就这么办（不可撤销）"),
    }, weT("确认")),
    React.createElement("button", {
      className: "we-picker__btn", type: "button", onClick: onDisarm,
      title: weT("算了"),
    }, weT("取消")),
  );
}

// ── 设置持久化（debounce / 迁移 / 重试 / 启动加载）────────────────────────────
// 这一族的实现已抽到 **src/settings/persistence.js**。构建期内联回本作用域，
// 调用点（persistSelection / flushPersist / onPageHideFlush / …）无需改动。
// 契约：8 个出向依赖的清单、入口与不变量 —— 见该文件头。
// ⚠️ **字体值不走这条通道**：那些键住 `fontsets/<活动 id>.json`，通道在
// **src/settings/fontset-store.js**（同形的 debounce + 脏标记 + 重试，但真源、键集与失败语义都不同）。

// Concurrency guard: 刷新 / 上传完成 / 移除 / 改目录 all call loadInventory(),
// and two overlapping requests used to resolve in arbitrary order — an older,
// slower response could clobber a newer inventory. The last caller wins;
// superseded requests drop their result entirely.
/**
 * 把"请求失败"的两种情形翻成**同一句可读原因**（**唯一一处**）：
 *   · `status === 0` ⇒ 请求没完成（宿主不可达）—— 不是"宿主返回了 0"；
 *   · 其余 ⇒ 宿主有响应但非 2xx，优先用宿主给的原因（`{ error }`，需 `parse: "always"`）。
 * 面板与错误行都靠这句话告诉用户"到底哪一步不对"，所以不许各自手写。
 */
function hostFailureReason(res) {
  if (!res || !res.status) return weT("宿主不可达（请求未完成）");
  const data = res.data;
  if (data && data.error) return data.error;
  // 非 2xx 且拿到的是 HTML 页 ⇒ 这不是宿主的接口（反代把挂载前缀丢了）。
  // 把"404 归因不清"说成一句可执行的话：以前只显示"宿主返回 404"，用户看不出是前缀问题。
  if (res.notHostEnvelope) {
    return weT("宿主返回 {status}：响应不是插件的接口，检查 DSH 是否挂在子路径下", { status: res.status });
  }
  return weT("宿主返回 {status}", { status: res.status });
}
let inventorySeq = 0;
/**
 * 库存预取：`/inventory` 与设置无关，启动链却把它排在 settings → fontsets → fontsets/<id>
 * 之后（见 apply 末尾的链）。链走到 inventory 前发出这一次请求，好让扫描和字体集那几步
 * 并行（inventory 请求 971→1036ms，纯串行浪费）。
 *
 * ⚠️ **发起时机在首帧之后**：插件激活期就发会让大库的整轮扫描和宿主启动抢 I/O；
 * 现在由启动链在 `afterFirstPaint()` 放行后调用，见 apply 末尾。
 * 只预取一次；`loadInventory` 消费后清空，手动刷新 / 轮播补拉仍走自己的请求。
 *
 * **预取只加速成功路径**：`apiFetch` 不抛错，网络瞬断会以 `{ ok:false, status:0 }` 的
 * 已兑现 promise 留在这里。若启动链直接消费这份失败结果，原本排在 settings/fontset 之后
 * （那时宿主通常已就绪）的那次请求就永远不发了 —— 启动反而更坏。所以消费前先看 `ok`：
 * 预取没成功就照旧发一次自己的请求。
 */
let inventoryBootPrefetch = null;
function prefetchInventoryOnce() {
  if (inventoryBootPrefetch) return inventoryBootPrefetch;
  try { inventoryBootPrefetch = apiJson(INVENTORY_URL); } catch { inventoryBootPrefetch = null; }
  return inventoryBootPrefetch;
}
async function loadInventory(opts) {
  // silent = 后台轮询：不亮 loading、清单没变就一个 emit 都不发（见 invWatch 的调用点）。
  // 手动刷新 / 上传完成 / 设置页重拉仍走默认路径，loading 与重渲染照旧。
  const silent = Boolean(opts && opts.silent);
  const prevInv = selection.inventory;   // 错误去重要比对"换掉之前"的那一份
  const seq = ++inventorySeq;
  if (!silent) {
    setTransient("loading", true);
    emit();
  }
  let next;
  const prefetched = inventoryBootPrefetch;
  inventoryBootPrefetch = null;
  try {
    let pre = null;
    try { pre = prefetched ? await prefetched : null; } catch { pre = null; }
    const res = pre && pre.ok ? pre : await apiJson(INVENTORY_URL);
    // 两种失败（宿主不可达 / 非 2xx）由 hostFailureReason 统一翻译，面板那一行据此显示。
    if (!res.ok) throw new Error(hostFailureReason(res));
    const data = res.data || {};
    next = {
      installDir: data.installDir,
      uploadDir: data.uploadDir || null,
      cacheDir: data.cacheDir || null,
      weAssetsDir: data.weAssetsDir || null,
      weAssetsAvailable: Boolean(data.weAssetsAvailable),
      // 来源：'env' / 'config' / 'auto' / null —— 'auto' 表示从探测到的安装目录带出。
      weAssetsSource: data.weAssetsSource || null,
      // 场景载荷的源（独立壁纸媒体源的 origin；空串 = 回落应用源，见 live-layer 的 liveRenderUrl）。
      sceneMediaBase: typeof data.sceneMediaBase === "string" ? data.sceneMediaBase : "",
      // 本机真实存在的 WallpaperMachine 库根数（宿主实测）。0 = 不轮询 —— 见 invWatch 的门控。
      wallpaperMachineRoots: Number(data.wallpaperMachineRoots) || 0,
      // 宿主给的资源 URL 在这里**一次性**补挂载前缀：消费点全是 <img>/<video>/iframe，
      // 不走 apiFetch，补在这里才能同时盖住选择器卡片、属性面板与轮播。
      wallpapers: normalizeWallpaperUrls(data.wallpapers || []),
      total: data.total || 0,
      portableCount: data.portableCount || 0,
      playlists: Array.isArray(data.playlists) ? data.playlists : [],
      // WE「已安装」文件夹（只读镜像）：树形，空数组 = 用户没建过 ⇒ 选择器不画文件夹栏。
      folders: Array.isArray(data.folders) ? data.folders : [],
      // 组件行状态面（ADR-0013 D3②）：原样透传，**不做归一化** —— 判据与失效口径都在
      // `weComponentVisible` 一处（字段缺席 / 形状不对 ⇒ 按可用渲染）。失败分支（下面的
      // catch）**有意不带这个键**：宿主不可达时可见面照常渲染，不许静默消失（D3③）。
      components: data.components,
      error: null,
    };
    // 玻璃行停用时回收残留（新开面板 / 手动刷新 / 上传完成都会走到这里）。
    // 放在"拿到新 components"之后、写 store 之前：门控与变量必须先撤干净，
    // 随后这次 render 才不会在"行已停用但玻璃还在"的中间态上画一帧。
    reclaimGlassResidue(data.components);
  } catch (err) {
    // 失败分支**不许**用一份空库存顶掉手里那一份：请求失败只说明"这次没拿到新
    // 数据"，不说明"用户的库空了"。这里一旦换成 `wallpapers: []`，后面任何一次
    // revalidateSelection() 都会把当前选择判成"壁纸已被移除" → `setSetting("id", "")`
    // 落盘 ⇒ 背景当场变黑、重启也回不来（用户视角就是数据丢失）。
    // 所以：已经有一份（哪怕它自己也带着 error）就原样留着，只把本次的失败原因盖上去；
    // 真正空库/首次加载失败才回落到空骨架 —— 那时没有任何东西可丢。
    const message = String(err && err.message ? err.message : err);
    const prev = selection.inventory;
    next = prev && Array.isArray(prev.wallpapers) && prev.wallpapers.length
      ? { ...prev, error: message }
      : {
        installDir: null,
        uploadDir: null,
        cacheDir: null,
        weAssetsDir: null,
        weAssetsAvailable: false,
        weAssetsSource: null,
        sceneMediaBase: "",
        wallpapers: [],
        total: 0,
        portableCount: 0,
        playlists: [],
        folders: [],
        wallpaperMachineRoots: 0,
        error: message,
      };
  }
  if (seq !== inventorySeq) return; // superseded by a newer loadInventory()
  setTransient("inventory", next);
  setTransient("loading", false);
  setTransient("loaded", true);
  if (next.error) {
    // 失败时**不重算选择**（同上：落盘点就在 revalidateSelection 里）。校验"选中的
    // id 还在不在库里"只在真拿到新库存时有意义 —— 拿不到库存时库里有什么我们并不知道。
    // 背景保持现状，面板顶部照常显示 next.error。
    // 静默轮询下同一个错误只报一次：每 30s 重刷一次错误横幅只是噪音（换一条错误要报）。
    if (!silent || prevInv.error !== next.error) emit();
    return;
  }
  // 文件夹筛选的僵尸值：宿主的夹子表里已经找不到这个 id（用户在 WE 里删了/改名了）
  // ⇒ 回落「全部」并**把设置清掉**。只回落不清理的话，一个失效 id 会一直躺在设置里，
  // 等用户以后又建出同名夹子（id 由 profile+名称路径生成）时会莫名其妙"复活"。
  if (selection.folderFilter && selection.folderFilter !== "all"
    && !flattenWallpaperFolders(next.folders, 0, []).some((f) => f.id === selection.folderFilter)) {
    setSetting("folderFilter", "all");
  }
  // Fresh inventory → reset pagination, but ONLY when the wallpaper id set
  // actually changed: an upload/remove/refresh that keeps the same list must
  // not kick the user back to page 1.
  const prevIds = selection._invIds || "";
  const nextIds = next.wallpapers.map((w) => w.id).join("\u0001");
  if (prevIds !== nextIds) {
    setTransient("_invIds", nextIds);
    setTransient("editorPage", 0);
  }
  // 轮询（silent）且清单没变 ⇒ 到此为止：不重算选择、不 emit。
  // revalidateSelection → applySelection 会 cancelRotationPrepare() + disposePreparedMedia()，
  // 每 30s 一次会把正在准备的轮播过场掐掉；面板也会跟着重渲染（评审）。
  if (silent && prevIds === nextIds) return;

  // Rotation groups: validate the active one and seed a first group from a
  // playable Wallpaper Engine playlist when the user has none yet (so the
  // rotation feature starts working out of the box, using ids the host already
  // resolved — no WE config.json path matching involved). Seeding happens once
  // (`rotationSeeded`), so deleting every list stays respected on refresh.
  if (!selection.rotationGroups.length && !selection.rotationSeeded) {
    selection.rotationSeeded = true;
    seedGroupsFromPlaylists();
    persistSelection();
  }
  if (selection.rotationGroupId && !activeRotationGroup()) {
    setSetting("rotationGroupId", "");
  }
  if (selection.rotationEnabled) {
    if (!selection.rotationGroupId) {
      const usable = firstUsableGroup();
      if (usable) selection.rotationGroupId = usable.id;
      else selection.rotationEnabled = false;
    } else if (rotationCandidates().length < 2) {
      const usable = firstUsableGroup();
      if (usable && usable.id !== selection.rotationGroupId) selection.rotationGroupId = usable.id;
      else if (!usable) selection.rotationEnabled = false;
    }
    persistSelection();
  }

  // Re-validate the selection against the refreshed inventory + filters (also
  // covers the rating/type filters): drop vanished/no-longer-matching
  // selections, then restore rotation state.
  revalidateSelection();
  scheduleSceneVideoResync();
}

// ── sceneVideo 诚实化的时序补拉 ────────────────────────────────────────────────
// 宿主侧 sceneVideo 是**真探测**的结果（遍历 .tex 找内嵌 MP4）：未命中缓存时
// 先给 null（不猜）并把探测投到后台（整库约 1–3 秒出定论），不用 hasFrame
// 冒充。而客户端只在启动 / 手动刷新 / 目录变更后重拉 inventory ⇒ **首次加载**时
// 真正内嵌 MP4 的场景会先落到静态帧（本机实测 3/35 个场景，探测本身 ~0.9s）。
// 这里对每一批「新的场景集合」补拉一次，把窗口收掉：只在库里有场景壁纸时补、
// 每批只补一次（补拉结果不会自触发成轮询）。
const SCENE_VIDEO_RESYNC_MS = 3000;
let sceneVideoResyncTimer = null;
let sceneVideoResyncedKey = ""; // 已补拉过的场景 id 集合指纹
function sceneVideoResyncKey() {
  const list = (selection.inventory && selection.inventory.wallpapers) || [];
  const ids = [];
  for (const w of list) if (w.type === "scene") ids.push(String(w.id));
  return ids.sort().join(",");
}
function scheduleSceneVideoResync() {
  if (typeof window === "undefined" || typeof window.setTimeout !== "function") return;
  const key = sceneVideoResyncKey();
  if (!key || key === sceneVideoResyncedKey) return; // 没有场景壁纸 / 这批已补过
  if (sceneVideoResyncTimer) return; // 已在等待
  sceneVideoResyncTimer = window.setTimeout(() => {
    sceneVideoResyncTimer = null;
    sceneVideoResyncedKey = key; // 先记账：这次补拉不会再排一个定时器
    loadInventory().catch(() => { /* 失败保持现状，用户仍可手动刷新 */ });
  }, SCENE_VIDEO_RESYNC_MS);
}

// ── 内容分级 / 类型筛选的调用点已按族搬出 ────────────────────────────────────
// selectionBlockedNote / playableInventory / 目录扁平化 / 轮播候选池 / 收窄后的重新校验
// 整段住 src/client/handlers/selection-filters.js；判定本体仍在 src/picker/picker-model.js。

// ── Rotation groups (user-defined carousel lists) ───────────────────────────
function activeRotationGroup() {
  return selection.rotationGroups.find((g) => g.id === selection.rotationGroupId) || null;
}

// byId lookup cache: groupWallpapers() is called from render, revalidate,
// rotation scheduling and firstUsableGroup() — rebuilding a full Map per call
// was O(N) × O(calls) on every emit. Keyed by the inventory ARRAY REFERENCE,
// so a fresh loadInventory() (which replaces the array) invalidates it.
let byIdCache = null;
let byIdRef = null;
function wallpaperById() {
  const list = selection.inventory.wallpapers;
  if (byIdRef !== list) {
    byIdRef = list;
    byIdCache = new Map(list.map((w) => [w.id, w]));
  }
  return byIdCache;
}

function groupWallpapers(group) {
  if (!group || !Array.isArray(group.wallpaperIds)) return [];
  const byId = wallpaperById();
  return group.wallpaperIds
    .map((id) => byId.get(id))
    .filter((w) => w
      && isRotationEligible(w, selection.contentRatingFilter)
      && !isHiddenWallpaper(w.id, selection.hiddenIds));
}

function rotationCandidates() {
  return groupWallpapers(activeRotationGroup());
}

function firstUsableGroup() {
  return selection.rotationGroups.find((g) => groupWallpapers(g).length >= 2) || null;
}

// First run / upgrade path: turn the first playable Wallpaper Engine playlist
// into a rotation group so existing setups keep working without any WE-side
// configuration. Returns true when a group was created.
function seedGroupsFromPlaylists() {
  const playable = selection.inventory.playlists.filter((p) => (p.portableCount || 0) >= 2);
  const source = playable[0];
  if (!source) return false;
  const ids = Array.isArray(source.wallpaperIds) ? source.wallpaperIds.slice() : [];
  if (!ids.length) return false;
  selection.rotationGroups.push({
    id: nextGroupId(),
    name: typeof source.name === "string" && source.name.trim() ? source.name.trim() : weT("轮播列表"),
    interval: DEFAULTS.rotationInterval,
    order: source.order === "random" ? "random" : "sequence",
    trigger: "interval",
    wallpaperIds: ids,
  });
  selection.rotationGroupId = selection.rotationGroups[selection.rotationGroups.length - 1].id;
  return true;
}

function nextGroupId() {
  return "grp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

// 轮换锚点 = 当前【实际显示】的壁纸（按 selection.url / sceneFrameUrl 反查），
// 而非裸 selection.id：storage 跨窗同步只改 id 不重建层，id 可能与上屏内容
// 脱节，以其为锚点会把"正在显示的"当作下一张再切回去（A→B→A→B 乒乓）。
// scene 的 selection.url 是 frameUrl 的变体形态（?v= 档位），按 sceneFrameUrl
// 反查才命中。
function rotationAnchorWallpaper() {
  const byId = wallpaperById();
  const sel = byId.get(selection.id);
  const matches = (w) => {
    if (!w) return false;
    if (w.media && w.media === selection.url) return true;
    if (w.frameUrl && (w.frameUrl === selection.url
      || (selection.type === "scene" && w.frameUrl === selection.sceneFrameUrl))) return true;
    return false;
  };
  if (matches(sel)) return sel;
  const displayed = selection.inventory.wallpapers.find(matches);
  return displayed || sel || null;
}

// 候选选择：排除锚点（当前显示）与已失败 id；sequence 从锚点位置向后取第一个
// 可用者，random 随机取。全部排除完返回 null（调用方 re-arm，下轮重新评估）。
function rotationNextCandidate(excluded) {
  const full = rotationCandidates();
  const anchor = rotationAnchorWallpaper();
  const anchorId = anchor ? anchor.id : selection.id;
  const usable = full.filter((w) => w.id !== anchorId && !(excluded && excluded.has(w.id)));
  if (!usable.length) return null;
  const group = activeRotationGroup();
  let pick = null;
  if (group && group.order === "random") {
    pick = usable[Math.floor(Math.random() * usable.length)] || null;
  } else {
    const cur = full.findIndex((w) => w.id === anchorId);
    for (let i = 1; i <= full.length; i++) {
      const w = full[(cur + i + full.length) % full.length];
      if (w && usable.indexOf(w) !== -1) { pick = w; break; }
    }
    if (!pick) pick = usable[0];
  }
  return pick;
}

function clearRotationTimer() {
  if (selection.rotationTimer === null) return;
  if (typeof window !== "undefined" && typeof window.clearTimeout === "function") {
    window.clearTimeout(selection.rotationTimer);
  }
  setTransient("rotationTimer", null);
}

function syncRotationTimer() {
  clearRotationTimer();
  if (!selection.rotationEnabled || !selection.id) return;
  if (rotationCandidates().length < 2) return;
  const group = activeRotationGroup();
  // 「当前视频播完就换」档：**不计时** —— 推进由视频的 ended
  // 事件驱动（watchVideoState 里那一支）。这里只把上一次留下的计时收掉（上面已调
  // clearRotationTimer），于是切回「按间隔」档时由下一次 sync 重新 arm。
  const trigger = group && group.trigger === "videoEnd" ? "videoEnd" : "interval";
  if (trigger === "videoEnd") {
    liveLog("rotation-arm", "跟随视频播放结束（不计时，候选 " + rotationCandidates().length + " 张）");
    return;
  }
  if (typeof window === "undefined" || typeof window.setTimeout !== "function") return;
  // #254：实时覆盖只改这一次运行的节奏（不写回 group.interval / 列表预设）。
  const liveInterval = clampNum(Number(selection.rotationLiveInterval), ...schemaRange("rotationLiveInterval"), DEFAULTS.rotationLiveInterval);
  const minutes = liveInterval > 0 ? liveInterval : (group ? group.interval : DEFAULTS.rotationInterval);
  // 开发/测试覆盖钩子：localStorage.weRotationTestSec（秒）可临时缩短轮换
  // 间隔（冒烟测试与手动预览用）；未设置时按组间隔正常运转（缺省值见 lib/settings-schema.js
  // 的 rotationInterval —— 本行不复述那个数，避免与真源漂成两份）。
  let delayMs = minutes * 60 * 1000;
  try {
    const testSec = Number(localStorage.getItem("weRotationTestSec"));
    if (testSec > 0) delayMs = Math.max(1000, Math.round(testSec * 1000));
  } catch { /* ignore */ }
  setTransient("rotationTimer", window.setTimeout(() => {
    setTransient("rotationTimer", null);
    if (!selection.rotationEnabled || !selection.id) return;
    // 就绪后切换：不再到点即 applySelection —— 先在后台把下一张壁纸准备到
    // 完全 ready（live 渲染页首帧 / 实时抓帧就绪 / 视频可播放 / 图片解码
    // 完成），就绪才落实切换并做交叉淡化。准备期间旧壁纸原样保持。
    beginRotationPrepare(new Set());
  }, delayMs));
  liveLog("rotation-arm", Math.round(delayMs / 1000) + "s 后（候选 " + rotationCandidates().length + " 张）");
}

// ── Rotation prepare pipeline (就绪后切换 + 渐变) ───────────────────────────
// 到点 → beginRotationPrepare：后台探测下一张壁纸的就绪信号，ready 才 commit
// （applySelection + 交叉淡化），fail 则跳过该候选链式尝试下一个（有界于候选
// 数，全灭则 re-arm 定时器下轮重来）。手动切换/关闭轮换会取消进行中的准备。
// eslint-disable-next-line prefer-const -- 跨片段写入：src/media-prep/prepare.js 与 src/client/rotation.js 的 `rotationPrep`
let rotationPrep = null; // { id, fromId, excluded, cancelled, settled, timers, staged, probeMedia, readyEl, kind }
// eslint-disable-next-line prefer-const -- 跨片段写入：src/live-layer.js 与 src/client/handlers/media-prep-handlers.js 的 `pendingRotationFade`
let pendingRotationFade = false; // commit 置位，syncLayers 消费后清零
// eslint-disable-next-line prefer-const -- 跨片段写入：layer-core.js 与 live-layer.js 的 `fadingLayerNode`
let fadingLayerNode = null;      // 正在淡出的旧壁纸层（渐变结束移除）
// iframe 类媒体（live 渲染页 / 旧链网页壁纸）的「节点级领养」通道：同源 iframe
// 在同文档内 reparent 会重载文档（Chromium 实测：appendChild 移动 iframe =
// 浏览上下文销毁重建，首帧 15s 预算重启，大包必超时）—— 所以 live/web 探测
// 的 staging 容器在 commit 时【整体转为新层】，iframe 全程不移动，渲染状态
// 零扰动。img/video 无此问题，仍走元素级领养（preparedMediaEl）。
// eslint-disable-next-line prefer-const -- 跨片段写入：src/live-layer.js 与 src/client/handlers/media-prep-handlers.js 的 `pendingStagedLayerNode`
let pendingStagedLayerNode = null;
// 已就绪、等待被 buildMedia 领养进新层的媒体元素（img/video）。就绪态随元素
// 走：探测用的就是最终上屏的元素，杜绝"探测就绪了但层里另建空白元素重新
// 加载"的黑屏闪烁。
// eslint-disable-next-line prefer-const -- 跨片段写入：src/client/rotation.js 与 src/client/handlers/media-prep-handlers.js 的 `preparedMediaEl`
let preparedMediaEl = null;
const ROTATION_PREP_TIMEOUT_MS = 20000; // 单阶段就绪探测上限（超时走兜底，不卡死轮换）
// 交叉淡化时长 ROTATION_FADE_MS 随「切换过场」族搬进 src/client/handlers/transition-handlers.js
// （档位表的 fade 项在模块初始化时读它，留在正文会撞 TDZ）。
// ── 切换过场的档位表与几何已按族搬出 ────────────────────────────────────────
// SWITCH_TRANSITIONS / SWITCH_SPEEDS / SWITCH_DIR_LABELS / SWITCH_DIRECTIONAL / SWITCH_BARS_TEETH
// 与 wipeInset 整段住 src/client/handlers/transition-handlers.js；条带几何 barsPolygon 住 src/client/rotation.js。

// 条带几何（barsPolygon）的说明随函数住在 src/client/rotation.js。
// ── 轮换 / 媒体生命周期助手已按族搬出（构建期内联在正文之前，同一扁平作用域）────────────
// 声明在 src/client/rotation.js：过场几何（barsPolygon / switchFrames）、探测元素的领养与释放、
// 隐藏期轮换推迟与可见时补做。LIVE_FIRST_FADE_MS 与两个隐藏态标记随声明一起搬走（初始化式不读模块状态）。

// ── 媒体准备处理器已按族搬出 ───────────────────────────────────────────────
// 预准备、构建与选中项落地整段住 src/client/handlers/media-prep-handlers.js；构建期内联回本作用域。

// ── 轮播组 CRUD（草稿式编辑器）已按族搬出 ───────────────────────────────────
// 新建/改名/删除/成员增删与两步确认整段住 src/client/handlers/rotation-crud.js；构建期内联回本作用域。


// ── Hidden wallpapers (soft delete / restore, localStorage only) ───────────
// Hiding is a pure status flag: no source file is touched, and a hidden
// wallpaper that is currently playing keeps playing (it only leaves the
// lists). Rotation candidates exclude hidden ids via groupWallpapers(), so a
// hidden wallpaper can never be auto-selected by the carousel. The membership
// test itself lives in **src/picker/picker-model.js**（`isHiddenWallpaper(id, hiddenIds)`）——
// 隐藏集合从调用点显式传入。

function hideWallpapers(ids) {
  const added = ids.filter((id) => id && !selection.hiddenIds.includes(id));
  if (!added.length) return;
  for (const id of added) selection.hiddenIds.push(id);
  persistSelection();
  syncRotationTimer(); // 候选可能跌破 2 个 → 停表；恢复时重新 arm
  emit();
}

function restoreWallpapers(ids) {
  const set = new Set(ids.filter(Boolean));
  if (!set.size) return;
  const before = selection.hiddenIds.length;
  selection.hiddenIds = selection.hiddenIds.filter((id) => !set.has(id));
  if (selection.hiddenIds.length !== before) {
    persistSelection();
    syncRotationTimer(); // 候选恢复到 ≥2 → 重新 arm 轮播
    emit();
  }
}

// ── 自定义上传处理器（read-A 存储）已按族搬出 ────────────────────────────────
// 选文件、校验、命名、写入与删除整段住 src/client/handlers/upload-handlers.js；构建期内联回本作用域。

// ── 图片 URL 源（Bing 每日一图 / 用户直链）已按族搬出 ────────────────────────────
// 草稿输入、导入、手动刷新、两枚入口整段住 src/client/handlers/url-source.js；构建期内联回本作用域。

// ── 三个目录设置（上传 / 缓存 / WE 素材）已按族搬出 ──────────────────────────────
// 编辑态、浏览、迁移开关、保存与失败文案整段住 src/client/handlers/dir-settings.js（含四个路由常量）；
// 构建期内联回本作用域。

// ── Behind-body layer: wallpaper + scrim (plain DOM, NOT a slot) ───────────
// Edge (and only Edge) paints its own floating "下载/投屏" media-overlay toolbar
// over any VISIBLE <video> element, and it ignores pointer-events / controlsList /
// disableRemotePlayback; there is no browser switch to turn it off. The only
// reliable way to keep it off the wallpaper is to never paint a visible video
// element, so on Edge video wallpapers are drawn onto a <canvas> instead:
//   * Edge-only (UA-gated): Chrome/Firefox/other engines keep the native <video>
//     path untouched — zero cost and zero behaviour change outside Edge.
//   * Event-driven: requestVideoFrameCallback() redraws only when the video
//     presents a NEW frame (video framerate, not display refresh rate; paused or
//     background-tab → no callbacks → zero work). Falls back to rAF if absent.
//   * The canvas bitmap is capped at the video's native resolution (never
//     upscaled), then CSS scales it to the viewport — ~1/4 the pixels of a
//     dpr-2 fullscreen canvas.
// The <video> stays in the DOM (offscreen, invisible) purely as the decoder
// source for drawImage; play/pause/playbackRate still work on it.
const IS_EDGE = typeof navigator !== "undefined" && /Edg\//.test(navigator.userAgent);

// ── 画布/媒体/GPU 帧助手已按族搬出（构建期内联在正文之前，同一扁平作用域）──────────────
// 助手声明在 src/client/media-frame.js：它们自带的模块级变量（媒体计时器、GPU 帧 pin、画布 ctx 句柄…）
// 与各自的赋值点同处一文件；本文件保留「壁纸属性」的开关与快照状态（propsPanelOpen / propsState），
// 因为改这两个状态的处理器（openUserPropsPanel / closeUserPropsPanel）仍在本文件。
// ── 壁纸属性（WE 用户属性）的状态与处理器已按族搬出 ─────────────────────────────
// 打开/收起、载入定义、覆盖写入、「从 WE 导入」、热更新、重启回放，连同它们的状态
// （propsPanelOpen / propsState / 180ms 去抖计时器）整段住 src/client/handlers/props-panel.js；
// 构建期由 scripts/build-client.mjs 内联回本作用域 —— 扁平作用域不变，调用点无需改动。
// 面板标记仍住 src/picker/picker-props-panel.js（ctx 在本文件调用点组装）。

// eslint-disable-next-line prefer-const -- 跨片段写入：src/client/plugin-apply.js 的 `weBattery`
let weBattery = null; // BatteryManager from navigator.getBattery (if available)
/**
 * `pauseOnHidden` 的**持续期防抖**。
 *
 * 宿主在虚拟桌面切换 / 焦点变化期间会瞬时把 `document.hidden` 误判为 true（Chromium 遮挡跟踪
 * 竞态，2–3 秒后被复查纠正）。旧逻辑对 `document.hidden` **零防抖、照单全收** ⇒ 一次瞬时抖动就
 * 走「暂停 → 拆页 → 重建 → 重新解析整个 scene 包（实测 6.4MB / 首帧 2001ms）」，用户看到黑屏
 * 约 2 秒；可见性快速振荡时反复付这个代价。
 *
 * 现在只有隐藏**持续 ≥ HIDDEN_PAUSE_DEBOUNCE_MS** 才把 `hiddenHoldActive` 置真（由 apply 里
 * 的 `applyHiddenHold` 维护，随 fiber 注销）；瞬时翻转不改变播放状态、也就不触发任何冷重载。
 * 判定源仍只有一个：`occlusionReason()` 读这个布尔，`occlusionActive()` 由它派生。
 */
const HIDDEN_PAUSE_DEBOUNCE_MS = 1200;
// eslint-disable-next-line prefer-const -- 跨片段写入：src/client/plugin-apply.js 的 `hiddenHoldActive`
let hiddenHoldActive = false;
// 遮挡原因（可读文案；空串 = 没被遮挡）。occlusionActive 由它派生，保证「是谁把
// 渲染页停掉的」只有一个判定源 —— 诊断日志直接引用；失焦档再经适配目标门控（桌面壳失焦时壁纸多半仍整块可见，按失焦暂停会定格**可见**画面，见 adapterCaps）。
function occlusionReason() {
  if (selection.pauseOnHidden && hiddenHoldActive) return weT("标签页隐藏(pauseOnHidden)");
  if (adapterCaps().blurPause && selection.pauseOnBlur && typeof document !== "undefined"
    && typeof document.hasFocus === "function" && !document.hasFocus()) return weT("窗口失焦(pauseOnBlur)");
  if (selection.pauseOnBattery && weBattery && !weBattery.charging) return weT("电池供电(pauseOnBattery)");
  return "";
}
function occlusionActive() {
  return occlusionReason() !== "";
}
/**
 * 遮挡判定的**复核周期**（毫秒）。事件之外还得自己看一遍：原生模态会抢焦点，而回来时的
 * `focus` 事件不保证送达 —— 只靠事件的话判定会永久卡在「窗口失焦」。3s 是"用户感觉不到、
 * 又不至于让省电白做"的折中（复核只在判定变化时 emit）。
 */
const OCCLUSION_RECHECK_MS = 3000;

/** URL 源（Bing 每日一图）的清单复核周期：宿主每天换图，客户端半小时看一眼即可。 */
const URL_SOURCE_POLL_MS = 30 * 60 * 1000;

/** 壁纸库自动刷新周期（**仅本机真的存在 WallpaperMachine 库时才启用**，判据是 /inventory 的
 *  wallpaperMachineRoots）：WallpaperMachine 自己把新壁纸下到库目录（Library/<id>/），宿主每次
 *  /inventory 都重新推导库根并看时间戳，所以客户端低频重拉一次就能把它们带出来。Steam 侧大库
 *  （几百上千张）不该周期整库重建 —— 那里保持原「手动刷新」语义不变。 */
const INVENTORY_POLL_MS = 30 * 1000;

// 「live 渲染页为什么没在出帧」的一句话原因：用户暂停与遮挡都算 —— 两者都会让
// applyLiveControls 把渲染页 pause() 掉，而暂停中的渲染页 __wpStats.frame()
// 恒为 {fps:0, running:false}（渲染器实现：paused → running:false）。
function livePauseReason() {
  if (selection.playing) {
    // 遮挡暂停（X11 矩形遮挡 ⇒ 渲染器 pause 档）也是"故意不出帧"：必须让看护
    //（首帧预算 / stall 计数 / 载荷延迟）与 UI 归因都看见它，否则全遮挡下轮播
    // 换页会把故意暂停误判成传输停滞并自动回退（实测事故）。
    if (occlusionRendererPaused()) return weT("窗口被完全遮挡(pauseOnOcclusion)");
    return occlusionReason();
  }
  return weT("用户暂停");
}
function isEffectivelyPlaying() {
  // 标签页隐藏（`document.hidden`）必须显式算进来：Chromium 对隐藏页**冻结 rAF**，
  // 出帧物理上不可能，而首帧预算与运行期 stall 两条判据都以"有帧"为唯一证据。
  // 少了这一项，收拍期间窗口被最小化 / 切到别的标签页 ⇒ 渲染页被冻结 ⇒ 看护按
  // `LIVE_FIRST_FRAME_MAX_MS` 判 timeout；而 `liveFailCauseOf` 在"本窗口内确有整包
  // 完成证据"时会归成渲染侧并**落盘**（实测事故：一张 29.7MB 的场景壁纸
  // 在隐藏期被判 timeout 写进 sceneLiveFailures，此后六天多每次启动都直接降级静态帧，
  // 直到下一次管线变更才被 migrateStaleLiveFailures 清掉）。
  // 运行期 stall 规则此前已有同款守卫（看护心跳的 `!isEffectivelyPlaying()` 分支），
  // 首帧预算这一侧必须与其对称 —— 否则"隐藏"在两个判据里有两种语义。
  if (typeof document !== "undefined" && document.hidden) return false;
  return selection.playing && !occlusionActive() && !occlusionRendererPaused();
}

// ── 真实播放态回写────────────────────────────────────────────────────
// `selection.playing` 是用户意图；<video> 是否真的在播是另一回事 —— 自动播放
// 策略可能拒绝、浏览器可能解不了自上传视频的编码（HEVC / 10-bit 等）、play()
// 也可能被紧接着的 src 切换打断（AbortError）。只信意图的话面板会一直写「播放中」，
// 卡片上唯一的按钮是「暂停」，而壁纸冻在首帧（看上去就是空白）—— 用户没有任何
// 「继续」可点。这里把元素的真实状态同步进 store：按钮于是总能回到「播放」
// （可点的继续），失败时还附带一句原因；播放成功后原因自动清掉。
function videoPlaybackError(video) {
  const err = video && video.error;
  if (!err) return "";
  // MediaError: 1 ABORTED / 2 NETWORK / 3 DECODE / 4 SRC_NOT_SUPPORTED
  if (err.code === 4) return weT("浏览器无法解码这段视频（自上传建议改用 H.264 编码的 MP4）");
  if (err.code === 3) return weT("视频解码失败（文件可能已损坏）");
  if (err.code === 2) return weT("视频读取失败（文件可能已被移动或删除）");
  return weT("视频加载失败");
}
// 拒绝的性质（记在元素的 dataset 上）: AbortError = play() 被 pause() / load() /
// 换源打断，属瞬时失败 —— 媒体就绪后重试即可自愈，不该当「真拒绝」堵住重试。
// 其余（NotAllowedError / NotSupportedError …）视为真拒绝，等用户显式点「播放」。
function playRefusalBlocks(video) {
  const r = video && video.dataset ? video.dataset.wePlayRefused : "";
  return Boolean(r) && r !== "AbortError";
}
// 把元素真实状态写进 store（仅在变化时 emit —— play/pause/error 监听器会在
// 每次浏览器驱动的状态切换时被调用，不能每次都触发整树重渲染）。
function syncVideoState(video) {
  const playing = Boolean(video) && !video.paused && !video.ended && !video.error;
  // 拒绝原因只在「确实没在播」时报：转码替换 src 打断 play() 会让标记留下，
  // 而随后 loadedmetadata 里补的 play() 成功时标记没人清 —— 不判 playing 的话
  // 面板会同时显示「播放中」和「浏览器拒绝了播放请求」。
  const reason = videoPlaybackError(video)
    || (!playing && playRefusalBlocks(video) ? weT("浏览器拒绝了播放请求") : "");
  if (selection.videoPlaying === playing && selection.videoError === reason) return;
  setTransient("videoPlaying", playing);
  setTransient("videoError", reason);
  emit();
}
// 每个元素只挂一次状态监听（切壁纸会新建 <video>，故标记挂在元素上）。
function watchVideoState(video) {
  if (!video || !video.dataset || video.dataset.weStateWatched === "1") return;
  video.dataset.weStateWatched = "1";
  for (const t of ["play", "playing", "pause", "ended", "error", "emptied"]) {
    try { video.addEventListener(t, () => syncVideoState(video)); } catch { /* ignore */ }
  }
  // 「当前视频播完就换下一张」：轮播组选了 `trigger: 'videoEnd'`
  // 时，壁纸视频的 ended 就是轮换信号 —— 与计时器二选一（syncRotationTimer 在该档不计时）。
  // 只认**当前层**那个 <video>：预热 / 探测元素也走 watchVideoState，它们播完不代表壁纸播完。
  // `loop` 会把 ended 吞掉，所以按 trigger 在建层时关掉 loop（见 video-layer 的
  // loop 分支）—— 这里再加一道 `video.loop` 判断，防止旧层残留的 ended 误触。
  try {
    video.addEventListener("ended", () => {
      if (video.loop) return;
      if (!selection.rotationEnabled || !selection.id) return;
      const group = activeRotationGroup();
      if (!group || group.trigger !== "videoEnd") return;
      const cur = (selection.inventory && selection.inventory.wallpapers || []).find((w) => w && w.id === selection.id);
      // 只对**视频**壁纸生效：场景内嵌视频播完不等于场景结束（它可能还有别的动画）；
      // 图片 / 网页壁纸没有 ended 语义，真出现了也按"不是这个档该管的事"跳过。
      if (!cur || cur.type !== "video") return;
      if (video.currentSrc && selection.url && video.currentSrc.indexOf(String(selection.url).split("?")[0]) < 0) return;
      if (rotationCandidates().length < 2) return;
      liveLog("rotation-video-end", "视频播完 → 换下一张（候选 " + rotationCandidates().length + " 张）");
      beginRotationPrepare(new Set());
    });
  } catch { /* ignore */ }
  // 媒体就绪后按意图自动补一次播放：play() 最常见的失败是被紧接着的 src 切换
  // （转码替换 / 换源）打断 —— 那一刻元素已经 paused，用户看到的就是冻在首帧
  // 的静止画面。就绪事件里重试即可自愈；真的被拒过时由 wePlayRefused 兜底，
  // 不会无限重试。
  for (const t of ["loadeddata", "canplay"]) {
    try { video.addEventListener(t, () => applyVideoPlayback(video)); } catch { /* ignore */ }
  }
}
// 应用期望的播放态，语义是「可重试 + 不说谎」：
//   * 意图 = 暂停            → pause()；
//   * 意图 = 播放但没在播    → 再次 play()（幂等；这正是让卡片上的「播放」
//                              成为真正的重试、而不是一个没反应的按钮）；
//   * 真拒绝记在元素上        → emit / UI tick 不会无限重试 play()，只有用户
//                              显式点击「播放」才清掉重来（见 onTogglePlay）；
//                              AbortError（被换源打断）不算真拒绝，见
//                              playRefusalBlocks。
// ── 壁纸音轨（volume / 总开关）───────────────────────────────────────────
// 期望音量：总开关关闭 → 0；否则取 videoVolume（钳到 0–1）。
// 把最终决策收成一个函数，避免 buildMedia / applyVideoPlayback / UI tick
// 三处各自判断而漂移。
function weAudioVolume() {
  try {
    if (selection.videoAudioEnabled === false) return 0;   // 总开关关闭 → 静音
    return clampNum(selection.videoVolume, 0, 1, 0);
  } catch { return 0; }
}
// ── 音频 / 播放桥已按族搬出（构建期内联在正文之前，同一扁平作用域）────────────────
// 声明在 src/client/audio-playback.js：期望音量与元素音量写入、轮换音频闸、层内媒体元素枚举、
// live iframe 音量与场景包 BGM 的起停、播放状态应用；三个顶层状态随声明一起搬走。


// ── Effect application: push the knobs into CSS variables ───────────────────
// 效果应用层（设置 → DOM）已抽到 src/effects.js：applyEffects / clearEffects 及其字体、
// 光标、壁纸淡出底色助手都在那里；构建期由 build-client.mjs 内联回本作用域，
// 因此下面这些 applyEffects() / clearEffects() 调用点无需改动（契约见该文件头）。

// ── Picker tabs ─────────────────────────────────────────────────────────────
// 调节面板的信息架构：六个页签互斥展示（壁纸库 / 外观 / 播放 / 系统 / 扩展 / 关于）。
// 「关于」不读面板状态、不写设置；外部输入只有两样：那行 star 数与两张二维码 PNG，后者经
// 宿主路由 /about-qr/<文件名> 直出，客户端只存路径。「扩展」在「关于」**之前**、是**模块
// 容器**（页签栏里它排第 5、致谢仍压尾）：内容是一张注册表，见 src/panel-tabs.js 的
// extensionModules()。最后停留
// 的页签记在 localStorage（仅 UI 状态，不进 config.json，也不需要 sanitize / serialize）。
const PICKER_TAB_KEY = "dsh-wallpaper-engine:picker-tab";
const PICKER_TABS = [
  { id: "library", get label() { return weT("壁纸库"); } },
  { id: "appearance", get label() { return weT("外观"); } },
  { id: "playback", get label() { return weT("播放"); } },
  { id: "system", get label() { return weT("系统"); } },
  { id: "extensions", get label() { return weT("扩展"); } },
  { id: "about", get label() { return weT("关于"); } },
];
// 旧页签 id → 新 id 的迁移（「字体」并入「外观」）：别把老用户甩回第一页。
const PICKER_TAB_LEGACY = {
  wallpaper: "library", font: "appearance", effects: "playback",
  audio: "playback", mascot: "system", advanced: "system",
};
// ── 可见页签表与页签记忆已按族搬出 ──────────────────────────────────────────
// PICKER_TABS（按注册表现存性现算）、PICKER_TAB_KEY / PICKER_TAB_LEGACY 与
// readSavedPickerTab 整段住 src/client/picker-tabs.js；构建期内联回本作用域。

// ── 设置页「全局字体」节的折叠态（ADR-0008 D4 三次修订）──────────────
// 那个节**两档都画**（侧栏 + 设置页），但两档各有自己的开合状态 —— 与 `qp-tab` /
// `picker-tab` 同一条"每档各自的 UI 状态"口径。只存 localStorage，**不进 config.json**
// （它不是设置，是视图状态）。
// ⚠️ 二次修订：设置页**默认全展开**（用户口径「设置页则是全部开启但也支持隐藏」）。
//    存储语义：只在用户真的点过时才写 "1"/"0" ⇒ 读到 "0" 必定是"他主动收起过"，必须尊重；
//    读到 null（从没点过）才用默认值 —— 这样改默认值不会覆盖用户的选择。
const PICKER_FONT_OPEN_KEY = "dsh-wallpaper-engine:picker-font-open";
function readSavedPickerFontOpen() {
  try {
    const v = localStorage.getItem(PICKER_FONT_OPEN_KEY);
    if (v === null) return true;          // 没表过态 ⇒ 设置页默认展开
    return v === "1";
  } catch { /* ignore */ }
  return true;
}
function writeSavedPickerFontOpen(on) {
  try { localStorage.setItem(PICKER_FONT_OPEN_KEY, on ? "1" : "0"); } catch { /* ignore */ }
}

// ── 设置页「全局 UI 配色」节的折叠态（同批二次修订为默认展开）──────────
const PICKER_UI_COLOR_OPEN_KEY = "dsh-wallpaper-engine:picker-ui-color-open";
function readSavedPickerUiColorOpen() {
  try {
    const v = localStorage.getItem(PICKER_UI_COLOR_OPEN_KEY);
    if (v === null) return true;          // 没表过态 ⇒ 设置页默认展开
    return v === "1";
  } catch { /* ignore */ }
  return true;
}
function writeSavedPickerUiColorOpen(on) {
  try { localStorage.setItem(PICKER_UI_COLOR_OPEN_KEY, on ? "1" : "0"); } catch { /* ignore */ }
}

// ── 设置页「细节 / 玻璃 UI / 侧边栏圆角 / 主题预设」四节的折叠态（二次修订）──────────
// 用户口径：「侧边栏保证后面三个默认隐藏；设置页全部开启但也支持隐藏」⇒
// 这几节在**设置页**默认展开（侧边栏那侧由 quick-panel 的 readQpOpen 给各自的默认值）。
// 「主题预设」只在设置页画（侧栏档整节不渲染 ⇒ 没有 QP 侧的孪生键），并入本组共用一条读法。
// 与上面两个键同一条存储语义（没表过态才吃默认值）。
const PICKER_DETAIL_OPEN_KEY = "dsh-wallpaper-engine:picker-detail-open";
const PICKER_GLASS_UI_OPEN_KEY = "dsh-wallpaper-engine:picker-glass-ui-open";
const PICKER_CORNERS_OPEN_KEY = "dsh-wallpaper-engine:picker-corners-open";
const PICKER_PRESETS_OPEN_KEY = "dsh-wallpaper-engine:picker-presets-open";
/** 设置页这三个门共用一条读法（都默认展开）；写各用各的键。 */
function readSavedPickerOpen(key) {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return true;          // 没表过态 ⇒ 设置页默认展开
    return v === "1";
  } catch { /* ignore */ }
  return true;
}
function writeSavedPickerOpen(key, on) {
  try { localStorage.setItem(key, on ? "1" : "0"); } catch { /* ignore */ }
}

// ── 仓库 star 数的取数与文案已按族搬出 ──────────────────────────────────────
// 缓存键、取数、陈旧标注与失败降级整段住 src/client/handlers/star-count.js；构建期内联回本作用域。

// ── Settings picker ─────────────────────────────────────────────────────────
// `key` is only needed when a SliderRow sits inside a conditionally-rendered
// ARRAY (the sidebar-glass group) — React requires keys there.
function SliderRow(label, min, max, step, value, onInput, suffix, key, opts) {
  opts = opts || {};
  const unit = suffix == null ? "" : String(suffix);
  // ⚠️ 两种调用口径必须并存：
  //   · **裸单位**（"px" / "%" / "s" / "ms"…，#135 新滑杆的口径）⇒ 回显 = 值 + 单位；
  //   · **预格式化整串**（如 `sel.glassAlpha + "%"`）⇒ 整串**原样**显示，
  //     绝不能再去拼值（否则 35 显示成 "3535%"、拖动期还会叠出陈旧单位）。
  // 判别看串里有没有数字：预格式化口径传的一定含值，裸单位一定不含。
  const preformatted = /\d/.test(unit);
  const readout = (v) => (v == null || v === ""
    ? ""
    : (preformatted ? unit : String(v) + unit));
  // `opts.numberEdit`：右侧数值区改成**可取数**的输入框（数值 + 单位同处一个胶囊）。
  // 与滑块走同一个处理器：键入即时生效，回车 / 失焦提交并夹取到本控件的 min..max；
  // 打字中途的空串**不写值**（`Number("") === 0` 会让退格那一下把画面弹到最小值）。
  // #255⑤：**默认可输入**（只有显式传 false 或预格式化口径才退回只读回显）——「滑杆右侧
  // 那格数字只能看不能改」是用户报障的那条；预格式化口径（整串含数字）仍保持只读，
  // 因为那种调用点传的已经是「值+单位」的完整串，拆不出裸值。
  const numberEdit = opts.numberEdit !== false && !preformatted;
  // 拖动期的轨道填充与**数值回显**：就地改这一行的 --we-fill 与右侧数值文本
  //（**局部 DOM 写，不触发 React 渲染**）。抬手那一次仍走完整 emit（含落盘），
  // 于是慢帧下也不会出现"数字跟不上滑块"的空档。
  const liveFill = (el) => {
    try {
      const lo = Number(el.min); const hi = Number(el.max); const v = Number(el.value);
      const pct = hi > lo ? Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100)) : 0;
      el.style.setProperty("--we-fill", pct + "%");
      const row = el.parentNode;
      // #255⑤：numberEdit 行的右侧是 <input>（.we-picker__value-input）——拖动期必须**只改
      // input.value**；写父级 .we-picker__value 的 textContent 会把 React 的输入框子树抹掉，
      // 下一次 emit 就崩（用户报障的「拖动几下输入框没了」）。
      const input = row && typeof row.querySelector === "function" ? row.querySelector(".we-picker__value-input") : null;
      if (input) { input.value = String(el.value); return; }
      const out = row && typeof row.querySelector === "function" ? row.querySelector(".we-picker__value") : null;
      // 预格式化口径不做拖动期就地改写 —— 保持原有的既有观感
      //（放手后的 emit 重渲染会给出正确文本）。缺元素 / 预格式化整串：什么都不做。
      if (out && !preformatted) out.textContent = readout(el.value);
    } catch { /* 回显是增强，失败不影响取值 */ }
  };
  // 键入提交住在 NumberValueInput 里（编辑期不受控 + 回车 / 失焦提交），这里只剩滑杆。
  return React.createElement("div", { className: "we-picker__row we-picker__slider-row", key: key },
    React.createElement("span", {
      className: "we-picker__hint we-picker__label",
      title: opts.tooltip || undefined,
      // 可选手势：双击标签回默认（位置行回中心、缩放行回 100%）。只有传了它的行会挂，
      // 且挂上时禁掉文字选择 —— 双击否则会先把标签选中，"回默认"看着像没反应。
      onDoubleClick: opts.onLabelDoubleClick || undefined,
      style: opts.onLabelDoubleClick ? { userSelect: "none" } : undefined,
    }, label),
    React.createElement("input", {
      className: "we-picker__slider", type: "range",
      min: String(min), max: String(max), step: String(step),
      value: String(value),
      // accent 填充进度：track 左段着 accent 色（macOS/Linear 式滑块质感），
      // --we-fill 由当前值算出，emit 重渲染时同步更新（拖动中由 liveFill 就地更新）。
      style: { "--we-fill": Math.max(0, Math.min(100, ((Number(value) - min) / (max - min)) * 100)) + "%" },
      // The visible label is a <span> (not a <label>), so expose it to AT.
      "aria-label": label,
      // 拖动档（第二个实参 live=true）：处理器只写值 + 应用样式，不 emit（见 commitLiveSetting）；
      // 抬手那一次由 onChange 走完整路径。
      onInput: (e) => { liveFill(e.currentTarget); onInput(Number(e.target.value), true); },
      // onChange stays as a final commit fallback (some engines only fire it
      // on release); onInput above is what makes the knob feedback instant.
      onChange: (e) => onInput(Number(e.target.value), false),
    }),
    // 右侧数值 = 当前值 + 单位（用户口径："滑动条右侧显示数值"）。它是**回显**，
    // 真值永远在设置里；liveFill 在拖动中就地把这行文本换成同一个格式
    //（仅裸单位口径；预格式化口径见上面 readout 的说明）。
    numberEdit
      ? React.createElement("span", { className: "we-picker__hint we-picker__value" },
        React.createElement(NumberValueInput, {
          label, min, max, step, unit,
          value,
          title: opts.valueTooltip || undefined,
          // 完整路径（第二参 false）：与滑杆抬手同一条口径 —— 写值 + emit。
          onCommit: (n) => onInput(n, false),
        }),
        React.createElement("span", { className: "we-picker__value-unit" }, unit),
      )
      : React.createElement("span", { className: "we-picker__hint we-picker__value" }, readout(value)),
  );
}

// ── Row builders for the tabbed picker ──────────────────────────────────────
// 设置行统一语法：左「标签(+一句话说明)」、右控件；长说明走 title tooltip，
// 不再整行铺陈强调色文字 —— 面板降噪的第一步。行内文字颜色一律走主题墨色
// token（.we-picker 上的 --we-ink*），强调色只留给选中态与控件激活态。

// 行左则：标签 + 可选一句话说明。
function ctlText(label, hint, tooltip) {
  return React.createElement("div", { className: "we-picker__ctl-text" },
    React.createElement("span", {
      className: "we-picker__ctl-label",
      title: tooltip || undefined,
    }, label),
    hint ? React.createElement("span", { className: "we-picker__ctl-hint" }, hint) : null,
  );
}

// 胶囊开关：统一替换原生 checkbox（原生勾选框是面板里最廉价的控件）。
// input 视觉隐藏但可聚焦，焦点环落在 track 上（键盘可达）。
function Toggle(props) {
  return React.createElement("label", { className: "we-picker__switch", title: props.title },
    React.createElement("input", {
      type: "checkbox",
      checked: props.checked,
      disabled: props.disabled === true,
      onChange: props.onChange,
      "aria-label": props.label,
    }),
    React.createElement("span", { className: "we-picker__switch-track" },
      React.createElement("span", { className: "we-picker__switch-thumb" }),
    ),
  );
}

// 开关行：标签(+说明)在左，胶囊开关在右。
function switchRow(label, checked, onChange, opts) {
  opts = opts || {};
  return React.createElement("div", { className: "we-picker__ctl", key: opts.key },
    ctlText(label, opts.hint, opts.tooltip),
    Toggle({ checked: checked, onChange: onChange, label: label, title: opts.tooltip, disabled: opts.disabled }),
  );
}

// 色板行：标签在左，预设圆点 + 自定义取色在右（窄容器自动换行）。
// aria-label 保持「<标签> <hex>」格式（verify 断言依赖）；opts.auto 用于
// 「跟随主题」这类重置项，opts.colorValue 允许自定义取色器的回退显示值。
function swatchRow(label, presets, value, onPick, opts) {
  opts = opts || {};
  return React.createElement("div", { className: "we-picker__ctl we-picker__ctl--wrap", key: opts.key },
    ctlText(label, opts.hint, opts.tooltip),
    React.createElement("div", { className: "we-picker__swatches", role: "group", "aria-label": label },
      opts.auto || null,
      presets.map((hex) => React.createElement("button", {
        key: hex,
        className: "we-picker__swatch" + (value === hex ? " we-picker__swatch--active" : ""),
        type: "button",
        style: { background: hex },
        title: hex,
        onClick: () => onPick(hex),
        "aria-label": label + " " + hex,
      })),
      React.createElement("label", { className: "we-picker__swatch-custom" },
        React.createElement("input", {
          type: "color",
          value: opts.colorValue || value || "#ffffff",
          // 拖动色盘：每格都发 input（原生颜色轮盘一次拖动可以上百次）⇒ 拖动档只写值 +
          // 应用样式、**不 emit**（见 commitLiveSetting）；抬手那一次（change）走完整路径。
          onInput: (e) => onPick(e.target.value, true),
          onChange: (e) => onPick(e.target.value, false),
          title: weT("自定义{label}", { label: weT(label) }),
        }),
        React.createElement("span", { className: "we-picker__hint" }, weT("自定义")),
      ),
    ),
  );
}

// ── Vinyl record (黑胶唱片) ─────────────────────────────────────────────────
// A rotating record disc showing the SELECTED wallpaper's cover as the label —
// the "CD player" presentation the author liked. Pure presentational: cover =
// the current wallpaper's preview URL (or null), playing drives the spin.
// Shown in BOTH settings layouts and in the picker modal head.
// 旋转是挂在 backdrop-filter 玻璃面上的无限动画: 页面不可见时 (后台标签/最小化)
// 它仍会驱动合成器反复重绘 backdrop。document.hidden 期间不转 — 元素此刻本来
// 就看不见, visibilitychange (apply 的 occlusion 监听 → emit) 会立刻转回来。
function vinylSpinVisible() {
  return typeof document === "undefined" || document.hidden !== true;
}
function VinylRecord(props) {
  const cover = props.cover;
  const title = props.title || weT("未选择壁纸");
  const playing = props.playing === true;
  const sm = props.sm === true;
  return React.createElement("div", {
    className: "we-vinyl" +
      (playing ? " we-vinyl--playing" : "") +
      (sm ? " we-vinyl--sm" : ""),
    title: title,
  },
    React.createElement("div", { className: "we-vinyl__cover" },
      cover
        ? React.createElement("img", {
            src: cover, alt: "", loading: "lazy",
            onError: (e) => { e.target.style.display = "none"; },
                            onLoad: (e) => { e.target.style.opacity = "1"; },
          })
        : React.createElement("span", { className: "we-vinyl__empty" }, "▦"),
    ),
    React.createElement("span", { className: "we-vinyl__hole" }),
  );
}

// ── Library-view a11y helpers ────────────────────────────────────────────────
// pickerOpener: the「选择壁纸」button — focus returns here when the library
// view closes. pickerFocusPending: one-shot flag so the view's initial focus
// lands exactly once on open (an inline ref callback would re-fire every render).
// eslint-disable-next-line prefer-const -- 跨片段写入：src/client/handlers/library-tab-handlers.js 的 `pickerOpener`
let pickerOpener = null;
// eslint-disable-next-line prefer-const -- 跨片段写入：src/panel-tabs/effects.js 的 `customFrameInput`
let customFrameInput = null;
let pickerFocusPending = false;
// GPU 抓帧缓存状态（面板展示用）：wid 对应当前面板壁纸，pinned=缓存里已有
// <key>_gpu.png。GPU 帧优先于「出图来源」的自动档（按用户决策），因此
// 想切档位/换回 CPU 生成的画面必须先清掉它 —— 面板据此给出提示与清除入口。
const gpuFrameUi = {
  wid: "", pinned: false, busy: false, probedAt: 0, error: "",
  // 实时帧预览用：抓帧的像素尺寸（宿主 HEAD 的 X-WE-GPU-W/H）+ 手动重抓是否在途。
  w: 0, h: 0, recapturing: false,
};
const GPU_FRAME_PROBE_TTL_MS = 30000;
function gpuFrameToken(frameUrl) {
  const src = String(frameUrl || "");
  if (src.indexOf("/scene-frame/") === -1) return "";
  return String(src.split("/scene-frame/").pop() || "").split("?")[0];
}
function markGpuFrameProbed(wid, pinned) {
  gpuFrameUi.wid = String(wid || "");
  gpuFrameUi.pinned = Boolean(pinned);
  gpuFrameUi.probedAt = Date.now();
}

// ── 「壁纸库」页签的处理器已按族搬出 ──────────────────────────────────────────
// 搜索、分页、下钻、选择、批量操作、素材目录编辑态等整段住 src/client/handlers/library-tab-handlers.js；
// 构建期内联回本作用域（保存/浏览仍在 src/client/handlers/dir-settings.js）。

// ── 外观 / 播放 / 系统页签的处理器（同上一条：渲染器只读值 + 调这些）────────────
function onLeftSidebarGlass(e) { setSetting("leftSidebarGlass", e.target.checked); emit(); }

// ── 侧边栏四角圆角 / 直角（外观 → 侧边栏圆角）────────────────────────────────
// 键名表**只此一份**：面板按 (side, corner) 调 —— 手抄第二份必然漂。
const SIDEBAR_CORNER_KEYS = {
  left: { tl: "leftSidebarSquareTL", tr: "leftSidebarSquareTR", br: "leftSidebarSquareBR", bl: "leftSidebarSquareBL" },
  right: { tl: "rightSidebarSquareTL", tr: "rightSidebarSquareTR", br: "rightSidebarSquareBR", bl: "rightSidebarSquareBL" },
};
const SIDEBAR_RADIUS_KEYS = { left: "leftSidebarCornerRadius", right: "rightSidebarCornerRadius" };
/** 统一档（'native' | '6' | '12' | '20'）：写 border-radius 简写的那一半。 */
function onSidebarCornerRadius(side, value) {
  const key = SIDEBAR_RADIUS_KEYS[side];
  if (key) setSetting(key, value);
  emit();
}
/** 单角直角开关：true = 这一角强制 0px（覆盖统一档）。 */
function onSidebarCornerSquare(side, corner, square) {
  const key = SIDEBAR_CORNER_KEYS[side] && SIDEBAR_CORNER_KEYS[side][corner];
  if (key) setSetting(key, square === true);
  emit();
}
const onGlassOptics = (e) => { setSetting("glassOptics", e.target.checked); emit(); };
// 标题栏液态玻璃（titlebarGlass）：与左侧栏同一形状的**乙类**总开关 —— 门控属性挂在
// 玻璃后端（现 packages/glass/src/glass.js，ADR-0016 第三刀出户；本文件只翻存储键，切换不重建任何东西）。
function onTitlebarGlass(e) { setSetting("titlebarGlass", e.target.checked); emit(); }
// 「思考块液态玻璃」三挡分段（关 / 液态玻璃 / 原生）：一次写两键 —— 原生挡赢过玻璃挡的
// 互斥由 glass-layer.js 的门控属性保证（thinkingNative ⇒ 不挂 data-we-thinking-glass），
// 这里让存储两键与所选拍始终一致（不留给手改 config 4 种组合里的矛盾态）。
function onThinkingMode(mode) {
  setSetting("thinkingGlass", mode === "glass");
  setSetting("thinkingNative", mode === "native");
  emit();
}
function onTableReadability(e) {
  setSetting("tableReadability", e.target.checked);
  emit();
}
// 胶囊雾化（行内代码 / 新会话 / 导航按钮）：与 thinkingGlass 同族 —— 消费它的规则
// 全部挂在 data-we-thinking-glass 门下，所以滑杆也只在该开关打开时渲染（glass-panel）。
const onCapsuleBlur = (px, live) =>
  commitLiveSetting("capsuleBlur", clampNum(px, ...schemaRange("capsuleBlur"), DEFAULTS.capsuleBlur), live);
// 胶囊釉色：与 onSidebarColor 同形（hex 白名单校验 + live 落效）。
const onCapsuleColor = (hex, live) => {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
  commitLiveSetting("capsuleColor", hex, live);
};

// ── 以下处理器模块级 —— 快捷播放面板（src/ui/quick-panel.js）与设置页**共用同一批处理器**。
//    ⚠️ 分档（ADR-0008 D4）：侧栏档只画**简化配置**（全局材质旋钮 + 各面总开关），
//    高级行的处理器在那份 ctx 里是"取用即抛错"的占位器 —— 所以这里给的是**全量**模块级处理器，
//    "哪一档真的用到哪些"由 quick-panel 的 provided 对象与 QP_CTX_SETTINGS_ONLY 名单决定。
//    依赖（setSetting / commitLiveSetting / clampNum / schemaRange / selection /
//    persistSelection / applyEffects / emit）全部模块级。
// 侧栏玻璃（dsh-better-sidebar）：独立于会话玻璃的一套细粒度控制，各自立即
// 生效并持久化（--we-sidebar-blur / --we-sidebar-alpha / --we-sidebar-color）。
const onSidebarBlur = (px, live) =>
  commitLiveSetting("sidebarBlur", clampNum(px, ...schemaRange("sidebarBlur"), DEFAULTS.sidebarBlur), live);
// 跟随全局：只切一个门（body 属性 + 一组变量指向），不重建任何东西。
function onSidebarFollowGlobal(e) { setSetting("sidebarFollowGlobal", e.target.checked); emit(); }
const onSidebarAlpha = (pct, live) =>
  commitLiveSetting("sidebarAlpha", clampNum(pct, ...schemaRange("sidebarAlpha"), DEFAULTS.sidebarAlpha), live);
const onSidebarColor = (hex, live) => {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
  commitLiveSetting("sidebarColor", hex, live);
};


// 内容面（编辑器/终端）近不透明玻璃底：透明度滑块 + 底色（空 = 跟随主题）。
const onSidebarContentAlpha = (pct, live) =>
  commitLiveSetting("sidebarContentAlpha", clampNum(pct, ...schemaRange("sidebarContentAlpha"), DEFAULTS.sidebarContentAlpha), live);
const onSidebarContentColor = (hex, live) => {
  if (hex === "") {
    // 跟随主题面板色：清键 + 落盘（拖动档不会走到这里 —— 色盘的「跟随」是按钮）。
    selection.sidebarContentColor = "";
    persistSelection();
    if (live) applyEffects({ live: true }); else emit();
    return;
  }
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
  commitLiveSetting("sidebarContentColor", hex, live);
};


// 输入光标颜色："" = 跟随 dsh 原生（自动档），hex = 立即注入并持久化。
const onCaretColor = (hex, live) => {
  if (hex === "") {
    commitLiveSetting("caretColor", "", live);
    return;
  }
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
  commitLiveSetting("caretColor", hex, live);
};

function onSidebarGlass(e) { setSetting("sidebarGlass", e.target.checked); emit(); }
// 侧栏全透明：显式放弃可读性下限。与 onSidebarGlass 同形 —— 门控属性
//（data-we-sidebar-fullclear）由 applyGlass 挂/摘，CSS 那组规则只认属性。
function onSidebarFullClear(e) { setSetting("sidebarFullClear", e.target.checked); emit(); }

// #277：第三方表面实底底板（默认开）。与上面同形 —— 门控属性 data-we-floater-solid
// 由玻璃包的 applyGlass 挂/摘（值与门正交），玻璃包的 CSS 那组规则只认属性。
function onFloaterSolidBase(e) { setSetting("floaterSolidBase", e.target.checked); emit(); }

// 插件市场（dsh-market）吸顶条下的内容裁切（默认开）：门控属性 data-we-market-sticky
// 由玻璃包的 applyGlass 挂/摘，**属性值带渐隐宽度 px**（0 = 硬切口，仍是有效值）⇒ 两个键
// 各自写、各自 emit。写宿主元素 mask 的行为在 packages/glass/src/glass-market-sticky.js。
function onMarketStickyClip(e) { setSetting("marketStickyClip", e.target.checked); emit(); }
const onMarketStickyFade = (px, live) =>
  commitLiveSetting("marketStickyFade", clampNum(px, ...schemaRange("marketStickyFade"), DEFAULTS.marketStickyFade), live);

// ── 「玻璃 UI」各子项的「独立配置」开关已按族搬出 ────────────────────────────
// 模式写入与校验整段住 src/client/handlers/settings-toggle-handlers.js；构建期内联回本作用域。
// ── 「扩展」页签（一号模块：点击效果与拖尾效果）的处理器 ──────────────────────
// 形状与上面一致：控件只报事件，写设置 + 重渲染都在这里。那一层没有网络往返、"点了就有反应"是
// 每帧现读设置 ⇒ 开关与档位走 emit 的完整路径，滑块走 commitLiveSetting 的 live 档
// （拖动时即时可见，抬手才落盘 + emit）。
function onPerfEnabled(e) {
  const on = e.target.checked;
  setSetting("perfEnabled", on);
  // 关掉监控就没有读数可显示，悬浮窗跟着关，免得留一块空壳。
  if (!on) setSetting("perfFloat", false);
  emit();
}
// 悬浮窗开关：浮窗本身订阅 store，写 perfFloat + emit 即可挂上 / 摘下。
function onPerfFloatToggle() {
  const next = !(selection.perfFloat === true);
  setSetting("perfFloat", next);
  emit();
}
function onFxEnabled(e) { setSetting("fxEnabled", e.target.checked); emit(); }
function onFxClick(e) { setSetting("fxClick", e.target.checked); emit(); }
function onFxTrail(e) { setSetting("fxTrail", e.target.checked); emit(); }
function onFxClickStyle(id) { setSetting("fxClickStyle", id); emit(); }
function onFxTrailStyle(id) { setSetting("fxTrailStyle", id); emit(); }
function onFxColorMode(id) { setSetting("fxColorMode", id); emit(); }
function onFxBlend(e) { setSetting("fxBlend", e.target.value); emit(); }
function onFxColor(value, live) { commitLiveSetting("fxColor", value, live); }
function onFxClickSize(v, live) { commitLiveSetting("fxClickSize", v, live); }
function onFxClickGlow(v, live) { commitLiveSetting("fxClickGlow", v, live); }
function onFxTrailLength(v, live) { commitLiveSetting("fxTrailLength", v, live); }
function onFxTrailWidth(v, live) { commitLiveSetting("fxTrailWidth", v, live); }
function onFxTrailGlow(v, live) { commitLiveSetting("fxTrailGlow", v, live); }
function onFxOpacity(v, live) { commitLiveSetting("fxOpacity", v, live); }
// ── 「扩展」页签（三号模块：3D 效果）的处理器 ───────────────────────────────
// 与上面同形：控件只报事件，写设置 + 重渲染都在这里。视差层没有网络往返与画布，
// 它每帧现读设置 ⇒ 开关走 emit 的完整路径，滑块走 commitLiveSetting 的 live 档
// （拖动时即时可见，抬手才落盘 + emit）。方向不是设置项（口径是"壁纸/吉祥物关于屏幕中心对称"、
// 界面整块与壁纸同向），要换向改 packages/parallax/src/parallax-layer.js 的 PARALLAX_DIRECTION / PARALLAX_UI_SIGN。
function onParallaxEnabled(e) { setSetting("parallaxEnabled", e.target.checked); emit(); }
function onParallaxMascot(e) { setSetting("parallaxMascot", e.target.checked); emit(); }
function onParallaxUi(e) { setSetting("parallaxUi", e.target.checked); emit(); }
// 插件前端那一整块自己的开关（用户诉求 m03549）：**独立于「界面元素跟随」**（两件事互不牵连）、
// 默认关（它挪的是别的插件画出来的真实界面）。关掉时层一个插件组都不认 —— 不是"系数算成 0"，
// 而是连扫都不扫（见 packages/parallax/src/parallax-layer.js 的 parallaxTargetsRefresh），表里的距离原样留着。
function onParallaxPlugin(e) { setSetting("parallaxPlugin", e.target.checked); emit(); }
function onParallaxBg(v, live) { commitLiveSetting("parallaxBg", v, live); }
// 四个区域距离（用户口径 m02697-①③）：每行都是**那一组自己的最大位移百分比**，0 = 该组不缓动。
// 存档与面板是同一个单位 —— 面板百分比直接就是存的位移百分比，无总倍率换算。
function onParallaxUiChatDepth(v, live) { commitLiveSetting("parallaxUiChatDepth", v, live); }
function onParallaxUiComposerDepth(v, live) { commitLiveSetting("parallaxUiComposerDepth", v, live); }
function onParallaxUiSidebarDepth(v, live) { commitLiveSetting("parallaxUiSidebarDepth", v, live); }
function onParallaxUiBubbleDepth(v, live) { commitLiveSetting("parallaxUiBubbleDepth", v, live); }
// 别的插件注册的前端元素组（用户口径 m02697-②）：一行一个槽，值是那个槽的最大位移百分比。
// 存档是一张 slot → 百分比 的表（lib/settings-schema.js 的 map 档，浅拷贝、不校验值），所以每次都
// 整张克隆再改一个键 —— 就地改就等于把只读的选择对象当草稿纸，别的读者会看到半成品。
// 0 也照存：0% = 该组不缓动，与"没这一行"（缺键 ⇒ 层的 PARALLAX_PLUGIN_DEFAULT）是两件事。
// 整张表只在 `parallaxPlugin` 开着时才算数（关着时层一个插件组都不认、面板也不画行）。
function onParallaxPluginDepth(slot, v, live) {
  const src = selection && selection.parallaxPluginDepths;
  const base = (src && typeof src === "object" && !Array.isArray(src)) ? src : {};
  const next = Object.assign({}, base);
  next[String(slot)] = v;
  commitLiveSetting("parallaxPluginDepths", next, live);
}
function onParallaxSmooth(v, live) { commitLiveSetting("parallaxSmooth", v, live); }
// ── 用户图片资产导入的共用腿（会话头像 / 吉祥物立绘）─────────────────────────
// 两族走的是同一条链：选文件 → 解码 → 按上限缩一遍 → POST 到宿主 → 把返回的文件名记账。
// 差别只有"目标路由 / MIME 白名单口径与记账键"，所以链本身只写一份。
//
// 为什么**不缓存 input 元素**（custom-frame 那种模块级 ref 是为了"面板重渲染后还点得到"）：
// 这里每次导入都是一次性的 —— 造一个、点开、用完即弃，语义经闭包带进来。
/** 客户端缩放上限（px）：显示尺寸最多 72px（头像）/ 96px（立绘），把原图按它缩一遍 ——
 *  直接把 8MB 的原图发上去只会让宿主目录变大、每次加载多传几倍字节。
 *  ⚠️ 头像是**例外**：裁切链要按原图分辨率取样，72px 的显示尺寸放大 4 倍也才 288 —
 *  它用 src/extensions/avatar-import.js 的 AVATAR_IMPORT_MAX_EDGE（1024）。 */
const IMAGE_IMPORT_MAX_EDGE = 512;
// 头像导入的两道闸（边长 1024 / 体积 4 MiB）、零解码尺寸探针与两层 MIME 清单全部住在
// `src/extensions/avatar-import.js` —— **纯函数**，因此 `test/verify-scene-live.mjs` 能 import 真实现、
// 用真字节喂它（"源码里有没有这行字"测不出位域读错一位：1024 读成 0 ⇒ 闸恒放行）。
/** 选图腿的 accept：默认直传层；调用方要收更多格式就显式传（头像传两层之和）。 */
function pickImageFile(onFile, accept) {
  if (typeof document === "undefined" || typeof document.createElement !== "function") return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept || IMAGE_DIRECT_ACCEPT;
  input.style.display = "none";
  try { document.body.appendChild(input); } catch { /* ignore */ }
  const done = () => { try { input.remove(); } catch { /* ignore */ } };
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    done();
    if (file) onFile(file);
  });
  // 用户在系统选择框里点「取消」：Chromium 会发 cancel（不发 change）—— 不收的话这个
  // 隐藏 input 就永远留在 body 上（每次取消漏一个）。再补一根定时兜底，覆盖不发 cancel 的老壳。
  input.addEventListener("cancel", done);
  if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
    window.setTimeout(done, 60000);
  }
  try { input.click(); } catch { /* ignore */ }
}
/** 解码一张图（createImageBitmap 优先；没有就走 <img> + objectURL 的老路）。 */
async function decodeImageFile(file) {
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(file); } catch { /* 落到下面那条腿 */ }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("decode failed"));
      img.src = url;
    });
  } finally {
    // 解码完成即可释放：canvas 已经把像素拷走了。
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
  }
}
/** 把用户选的图缩到 maxEdge 以内并重新编码（webp 优先，编不出来退回 png）。
 *  返回 `{ blob, width, height }` —— 宽高是**缩放后**的像素数（立绘要用它算显示盒）。 */
async function downscaleImageFile(file, maxEdge) {
  const src = await decodeImageFile(file);
  return await downscaleDecoded(src, maxEdge, file);
}
/**
 * 同一件事的 **blob 入口**：裁切链手里已经是一个画好的 canvas/blob，没有 `File`
 * （`downscaleImageFile` 吃的是 `File`）。两者共用下面同一段实现，不复制第二份缩放逻辑。
 */
async function downscaleImageBlob(blob, maxEdge) {
  const src = await decodeImageFile(blob);
  return await downscaleDecoded(src, maxEdge, blob);
}
/** 缩放 + 重编码的**唯一实现**（两个入口共用；`fallback` 是编码全失败时原样交出去的那份）。
 *  `losslessFirst` = 先试 PNG（**像素级无损**）再退 WebP —— 只有头像的「自动压缩后导入」
 *  走这一档（用户口径："保证原图信息不丢失"）；其余导入档仍按"WebP 优先、体积优先"编。 */
async function downscaleDecoded(src, maxEdge, fallback, losslessFirst) {
  const w = Number(src.width) || 0;
  const h = Number(src.height) || 0;
  if (!w || !h) throw new Error("bad image");
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = tw;
  canvas.height = th;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("no canvas");
  g.drawImage(src, 0, 0, tw, th);
  if (src.close) { try { src.close(); } catch { /* ignore */ } }
  const toBlob = (type, quality) => new Promise((resolve) => {
    try { canvas.toBlob((b) => resolve(b), type, quality); } catch { resolve(null); }
  });
  // 无损优先（头像压缩档）：PNG 装得下就用 PNG，装不下才退视觉无损的 WebP。
  if (losslessFirst) {
    const png = await toBlob("image/png");
    if (png && png.type === "image/png") return { blob: png, width: tw, height: th };
    const lossy = await toBlob("image/webp", 0.92);
    return { blob: (lossy && lossy.type === "image/webp") ? lossy : ((await toBlob("image/png")) || fallback), width: tw, height: th };
  }
  const webp = await toBlob("image/webp", 0.92);
  const blob = (webp && webp.type === "image/webp") ? webp : (await toBlob("image/png")) || fallback;
  return { blob, width: tw, height: th };
}

/**
 * 用户资产路由的失败文案。
 *
 * **裸状态码 = 请求没到本族**。两族的每个非 2xx 都由路由发 `{ error }` 信封
 * （`method not allowed` / `not-set` / `不支持的格式…`），所以一个**没有信封**的 404/405
 * 只可能来自别的层（SPA 兜底 / 静态层）—— 实测语义只有一个：**宿主里没有这条路由**。
 * 最常见的原因是**宿主没重挂**：宿主模块只在启动时 load 一次，而浏览器里的 bundle 每次
 * 刷新都重新取，于是"刷新页面只换前端、宿主那份还是启动时那份"，表现就是这两个裸状态码
 *（实测：改了宿主代码只等客户端 HMR ⇒ 导入报「宿主返回 405」）。
 * 这句话必须说出来 —— 只说"宿主返回 405"用户只能一脸茫然（同 fontset / system-fonts 口径）。
 */
function assetRouteFailure(res, what) {
  const bare = !res || !res.data || typeof res.data !== "object" || !res.data.error;
  if (bare && (res.status === 404 || res.status === 405)) {
    return weT("宿主里没有{what}路由：重启 DSH 后再试（改过宿主代码要重挂，刷新页面不够）",
      { what: what });
  }
  return (res && res.data && res.data.error) || weT("宿主返回 {status}", { status: res ? res.status : 0 });
}
/** 两族共用的"POST 一张图"这条腿：返回 `{ ok, name }`（失败时 `error` 是给人看的原因）。 */
async function postImageAsset(path, blob, what) {
  const res = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": blob.type },
    body: blob,
    parse: "always", // 非 2xx 的原因（含"没有这条路由"）都要读得到
  });
  const name = res.data && typeof res.data.name === "string" ? res.data.name : "";
  if (!res.ok || !name) return { ok: false, error: assetRouteFailure(res, what) };
  return { ok: true, name: name };
}

// ── 「扩展」页签（一号模块：自定义会话头像）的处理器已按族搬出 ──────────────────────
// 开关 / 两个滑块 / 出现间隔、图片选择与自动压缩、裁切弹窗的开关，连同 AVATAR_CROP_VIEW 与
// 两份 pending 状态整段住 src/client/handlers/avatar-ext-handlers.js；构建期内联回本作用域。
// 裁切几何与出图住 src/client/handlers/image-assets.js（同一族，搬在它之前）。
// ── 用户图片资产导入的共用腿（会话头像裁切 / 吉祥物立绘）已按族搬出 ────────────────
// 取景框几何、拖动/缩放/滚轮手势、裁切出图与确认、清空，以及吉祥物立绘的选择/上传/清除
// 整段住 src/client/handlers/image-assets.js；构建期由 scripts/build-client.mjs 内联回本作用域。
// 「适配方式」onObjectFit 是外观处理器，不属于本族，仍在下面。

/**
 * 适配方式（覆盖 / 填充 / 居中 / 拉伸）：除写设置外，Edge 的 canvas 渲染路径把 fit 存在
 * `weDrawCtx` 上，而 `syncLayers` 的 same-canvas 守卫不会重建 draw loop ⇒ 这里要直接更新并重绘。
 */
function onObjectFit(mode) {
  setSetting("objectFit", mode);
  emit();
  if (weDrawCtx) {
    weDrawCtx.fit = mode;
    weDrawFrame();
  }
}
// 面板上「当前壁纸实时帧」微缩预览的 URL：与层里正在用的那个 URL **同源**（同一
// 画面档位；scene-frame 路由在有 _gpu.png 时优先服务它），所以预览看到什么、切换
// 途中与 live 首帧前显示的就是什么。尾上挂一个缓存破坏参数：probedAt 一变（重抓/
// 清除后的复检）URL 就变 → <img> 会重新取图，预览立刻跟上。
function framePreviewSrc(selLike) {
  const v = Number(selLike && selLike.frameVariants && selLike.frameVariants[String(selLike && selLike.id)]) || 0;
  const base = frameUrlWithVariant(selLike && selLike.sceneFrameUrl, v);
  if (!base) return "";
  return base + (base.indexOf("?") === -1 ? "?" : "&") + "we-prev=" + (gpuFrameUi.probedAt || 0);
}
// 探测当前壁纸的抓帧槽位状态（HEAD，纯磁盘探测，绝不触发任何生成）。带 TTL
// 去重：syncLayers 调用频繁，同一壁纸 30s 内只探一次；force 用于清除后复检。
function probeGpuFrameState(frameUrl, force) {
  const wid = String(selection.id || "");
  const token = gpuFrameToken(frameUrl);
  if (!wid || !token) return;
  if (!force && gpuFrameUi.wid === wid && Date.now() - gpuFrameUi.probedAt < GPU_FRAME_PROBE_TTL_MS) return;
  const at = Date.now();
  gpuFrameUi.wid = wid;
  gpuFrameUi.probedAt = at;
  const wasPinned = gpuFrameUi.pinned;
  // 探测 = 读主帧在不在 + 几何（W/H 头），面板的「已抓帧/未抓帧」读数、清除与
  // 重抓动作作用在同一份主帧上，读行动作一致。
  apiHead("/scene-frame/" + encodeURIComponent(token))
    .then((res) => {
      if (gpuFrameUi.wid !== wid || gpuFrameUi.probedAt !== at) return; // 期间切了壁纸
      const rh = res.response;
      const pinned = Boolean(res.ok && rh && rh.headers && typeof rh.headers.get === "function"
        && rh.headers.get("x-we-gpu") === "1");
      gpuFrameUi.pinned = pinned;
      // 存帧像素尺寸（预览窗口展示用；旧宿主没有这两个头 → 保持 0，预览只显示图）。
      const gw = pinned ? Number(rh.headers.get("x-we-gpu-w")) : 0;
      const gh = pinned ? Number(rh.headers.get("x-we-gpu-h")) : 0;
      gpuFrameUi.w = Number.isFinite(gw) && gw > 0 ? gw : 0;
      gpuFrameUi.h = Number.isFinite(gh) && gh > 0 ? gh : 0;
      gpuFrameUi.busy = false;
      if (pinned !== wasPinned) { try { emit(); } catch { /* ignore */ } }
    })
    .catch(() => { /* 探测失败保持现状，30s 后再试 */ });
}
function modalInitialFocus(el) {
  if (el && pickerFocusPending) {
    pickerFocusPending = false;
    try { el.focus(); } catch { /* ignore */ }
  }
}
// Keyboard activation for the div[role="button"] wallpaper cards
// (Enter / Space → click), shared by the normal / hidden / close cards.
function cardKeyDown(e) {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); }
}

// ── 播放控制处理器（模块级）已按族搬出 ─────────────────────────────────────────
// 播放/暂停、静音、音量（live 档不 emit）、清除当前壁纸、清 live 失败记忆、换组、
// 开停轮播、下一张 —— 整段住 src/client/handlers/playback-handlers.js，构建期内联回本作用域。
// ── 外观 / 画面处理器（模块级）──────────────────────────────────────────────
// 与上面那批播放控制处理器同源理由：快捷播放面板的「外观」「播放」两页与设置页
// 同名页签**共用同一批渲染器**（renderAppearanceTab / renderEffectsTab 的
// ctx.surface 分支），而渲染器的回调必须在模块级才组得进侧栏的 ctx。
// 这几支的取值单位与落盘路径与设置页逐字相同（照原样搬出组件闭包）。统一的写法是
// commitLiveSetting：非拖动档 = 写设置 + emit（applyEffects 是 emit 的订阅者，一趟里
// 更新 CSS 变量与数值回读）；拖动档 = 写设置 + 只应用样式、不 emit（见该函数的说明）。
//   · 画面组：scrim / wallpaperOpacity / wallpaperBlur / background{Brightness,Contrast,Saturate}
//   · 外观组：accent / glassColor / glassAlpha / border / blur（雾化）
//   · 主题随壁纸开关（打开时立刻按当前壁纸补判一次）
const onScrim = (pct, live) => commitLiveSetting("scrim", pct / 100, live);
  // 壁纸透明度：存 %，applyEffects 换算成 element opacity（可拖范围见 clampNum 的实参，真源是 lib/settings-schema.js 的 KINDS）。
const onWallpaperOpacity = (pct, live) =>
  commitLiveSetting("wallpaperOpacity", clampNum(pct, ...schemaRange("wallpaperOpacity"), DEFAULTS.wallpaperOpacity), live);
const onBorder = (pct, live) => commitLiveSetting("border", pct / 100, live);
const onBlur = (px, live) => commitLiveSetting("blur", px, live);
const onWallpaperBlur = (px, live) => commitLiveSetting("wallpaperBlur", px, live);
const onBackgroundBrightness = (pct, live) => commitLiveSetting("backgroundBrightness", pct, live);
const onBackgroundContrast = (pct, live) => commitLiveSetting("backgroundContrast", pct, live);
const onBackgroundSaturate = (pct, live) => commitLiveSetting("backgroundSaturate", pct, live);
// 壁纸层取景（位置 / 缩放，对应 WE 壁纸属性面板的 水平 / 垂直 / 缩放）：整屏百分比偏移
// （50 = 居中）与缩放百分比（100 = 原大小）。量程一律走 schemaRange，不在这里写数字 ——
// 手写那对数字会与 KINDS 漂移，而 clampNum 越界即回落默认值（用户实测过"拉到头跳回默认"）。
const onLayerPositionX = (pct, live) =>
  commitLiveSetting("layerPositionX", clampNum(pct, ...schemaRange("layerPositionX"), DEFAULTS.layerPositionX), live);
const onLayerPositionY = (pct, live) =>
  commitLiveSetting("layerPositionY", clampNum(pct, ...schemaRange("layerPositionY"), DEFAULTS.layerPositionY), live);
const onLayerScale = (pct, live) =>
  commitLiveSetting("layerScale", clampNum(pct, ...schemaRange("layerScale"), DEFAULTS.layerScale), live);
// 三条行的"回到默认"手势（双击标签）：面板没有通用的恢复默认行，而把滑块精确拖回
// 50 / 100 很难。走完整 emit（含落盘），一步到位。
const onLayerReset = (key) => {
  const field = key === "x" ? "layerPositionX" : key === "y" ? "layerPositionY" : "layerScale";
  setSetting(field, DEFAULTS[field]);
  emit();
};

// ── 模块级 / 页签级 / 全局重置已按族搬出 ─────────────────────────────────────
// resetKeysToDefault 与三个 onReset* 整段住 src/client/handlers/reset-and-accent-handlers.js；构建期内联回本作用域。
// ── 全局 UI 配色处理器已按族搬出 ─────────────────────────────────────────────
// 角色/元素配色写入、自定义开关、清除整段住 src/client/handlers/color-handlers.js；构建期内联回本作用域。

// ── 字体 / 主题处理器 + 三个 ctx 构造器 ──────────────────────────────────────
// 它们只读模块级单例 `selection`、只调模块级函数（setFontValues / applyEffects / emit /
// ensureSystemFonts / fontset-store 与 preset-store 一族），**不需要组件作用域** ——
// 声明在模块级即可，不必随每次渲染重建一份（身份会变）。
// 与上面「播放控制处理器」「外观 / 画面处理器」两段同源：渲染器只读值 + 调这些。
/**
 * 新集的**默认名字**（面板不再让用户先取名 —— 名字之后随时能用「重命名」改）：
 * 「我的字体集」/「我的字体集 2」… 取第一个没被占用的后缀。**确定性**（同样的清单给同样的名字），
 * 因此可以当判据断言；碰撞只可能发生在 999 个同名前缀之后，那时退回时间戳。
 */
function nextFontSetName() {
  const base = weT("我的字体集");
  const taken = new Set((selection.fontSets || []).map((r) => r && r.name).filter(Boolean));
  if (!taken.has(base)) return base;
  for (let i = 2; i <= 999; i++) {
    const name = base + " " + i;
    if (!taken.has(name)) return name;
  }
  return base + " " + Date.now().toString(36);
}

// ── 字体集编辑器的一屏：**显式 ctx**，面板完全不碰 selection ──────
// 各字段的含义见 packages/fonts/src/fontset-editor.js 的文件头。这里只做三件事：状态从 selection 取、
// 动作用 fontset-store 发、完事 emit()。（删除的 confirm 门控在**面板**里 —— 问那一句的地方
// 就是按钮那儿，与轮换列表 / 移除自定义壁纸同形。）
function fontSetCtx() {
  const rowOf = (id) => (selection.fontSets || []).find((r) => r && r.id === id) || { id };
  const done = () => { setTransient("fontSetLoading", false); emit(); };
  const busy = (promise) => { setTransient("fontSetLoading", true); emit(); promise.then(done, done); };
  return {
    open: selection.fontSetOpen === true,
    onOpen: (v) => {
      setTransient("fontSetOpen", v === true);
      if (selection.fontSetOpen) busy(refreshFontSets()); // 打开就拉一次清单（来源永远是宿主）
      else disarmConfirm(); // 收起子分支 ⇒ 待确认状态一起清掉（不变量 3）
    },
    fontSets: selection.fontSets,
    activeId: selection.fontSetActive,
    // 「使用中」的判据是**值仍然一致**，不是"宿主指针指着它"：手动改过字体值 ⇒ 标记让位给「已改」。
    // 注意 `activeId` 仍按指针给 —— 能力判定（活动集不可删、先切走）必须与宿主一致，不能受漂移影响。
    inUseId: fontSetDrifted() ? "" : selection.fontSetActive,
    loading: selection.fontSetLoading === true,
    error: selection.fontSetError,
    editingId: selection.fontSetEditing,
    draftName: selection.fontSetDraftName,
    armedId: armedIdOf("fontset"),
    exportUrl: (id) => exportFontSetUrl(id),
    onImport: (file) => busy(importFontSet(file)),
    onActivate: (id) => busy(activateFontSet(id)),
    onRefresh: () => busy(refreshFontSets()),
    onDelete: (id) => { disarmConfirm(); busy(deleteFontSet(id)); },
    // 删除的**面板内确认**：走与轮播列表 / 移除自定义画面同一套令牌（`armConfirm`）。
    // 第一下只"待确认"，点问句行里的「确认」才发请求。
    onArm: (id) => armConfirm("fontset:" + id),
    onDisarm: () => disarmConfirm(),
    onEdit: (id) => {
      setTransient("fontSetEditing", id);
      setTransient("fontSetDraftName", rowOf(id).name || "");
      emit();
    },
    onDraftName: (v) => { setTransient("fontSetDraftName", String(v == null ? "" : v)); emit(); },
    onRenameCommit: (id) => busy(renameFontSet(id, selection.fontSetDraftName).then((ok) => {
      if (ok) { setTransient("fontSetEditing", ""); setTransient("fontSetDraftName", ""); }
    })),
    onCancelEdit: () => { setTransient("fontSetEditing", ""); setTransient("fontSetDraftName", ""); emit(); },
    // 先把挂起的编辑落地（否则新集可能拿到旧值），再以**当前外观**建一份并切过去。
    // 名字由 `nextFontSetName()` 生成（面板不问；行内「重命名」随时可改）。
    onCreate: () => busy(flushFontSetNow()
      .then(() => createFontSet(nextFontSetName()))
      .then(() => { emit(); })),
  };
}

// ── 玻璃预设的接线已按族搬出 ──────────────────────────────────────────────────
// 资产可用位三态、玻璃预设 ctx（保存 / 应用 / 引导 / 导出 / 导入 / 删除两步确认）
// 整段住 src/client/handlers/glass-preset-handlers.js；构建期内联回本作用域。
// 导出预设的一次性 <a> 也随族搬走，body 挂载白名单里记在该文件名下。

// 角色色。默认「单色」—— 一个色同时写进 light/dark 两套（内部始终存两套，
// 因为令牌服务的值必须是 {light,dark} 对，缺一套在另一套配色下会不可读）。
// G4 字族（角色级）：空 = 回官方字族。存**族键**（CSS 栈由 fontFamilyStack 在模块侧解析）。
const onThemeFamily = (role, key) => {
  const next = Object.assign({}, selection.themeFamily);
  if (!key) delete next[role];
  else next[role] = key;
  setFontValues({ themeFamily: next }); applyEffects(); emit();
};

// **全局字族**：空 = 跟随 DSH。它是**默认**而不是强制 —— 角色级（themeFamily）与组件级
// （componentFonts）写在它上面（见 src/font/typography.js 的 buildTypePayload：
// 「该角色自己设了就用它，否则用全局」），DSH 的字族层次不会被压平。
// 值是族键（内置键或 `sys:` 键），消毒走共享内核 —— 与本机字体清单同一条值域。
const onGlobalFamily = (key) => {
  setFontValues({ globalFamily: sanitizeFamilyKey(key) });
  applyEffects(); emit();
};

// 面板上的「重新扫描」：跳过 TTL 再要一次本机字体清单（用户刚装完字体时的出路）。
const onRefreshSystemFonts = () => { ensureSystemFonts(true); };

// F2/G4 字号（角色级，**绝对值**）：空 = 用 DSH 官方值（角色表的 defaultPx 即面板显示的默认）。
const onThemeSize = (role, raw) => {
  const next = Object.assign({}, selection.themeSize);
  const num = raw === "" ? NaN : Number(raw);
  if (!Number.isFinite(num)) delete next[role];
  else next[role] = Math.round(num);
  setFontValues({ themeSize: next }); applyEffects(); emit();
};

// G4 字重（角色级）：空/0 = 回官方字重（组合式里的字面量前缀）。
const onThemeWeight = (role, raw) => {
  const next = Object.assign({}, selection.themeWeight);
  const num = raw === "" ? NaN : Number(raw);
  if (!Number.isFinite(num)) delete next[role];
  else next[role] = Math.round(num);
  setFontValues({ themeWeight: next }); applyEffects(); emit();
};

// G3/G4：组件级字体。空/删键 = 回官方值（**官方值作初始值**）。
const onComponentFont = (prefix, prop, raw) => {
  const next = Object.assign({}, selection.componentFonts);
  const one = Object.assign({}, next[prefix]);
  const num = raw === "" ? NaN : Number(raw);
  if (!Number.isFinite(num)) delete one[prop];
  else one[prop] = Math.round(num);
  if (Object.keys(one).length) next[prefix] = one;
  else delete next[prefix];
  setFontValues({ componentFonts: next }); applyEffects(); emit();
};

const onThemeColor = (role, mode, hex, separate) => {
  const cur = selection.themeColors[role] || { light: "", dark: "" };
  const next = { light: cur.light || "", dark: cur.dark || "" };
  if (separate) next[mode] = hex;
  else { next.light = hex; next.dark = hex; }
  // ⚠️ 深浅分开只填一边 ⇒ 另一侧留空 = **半对**。半对过不了任何一层消毒
  //（readThemeColors / buildTokenPayload 都是"缺一套整角色丢弃"）⇒ 颜色**落不了盘、
  // 也不会生效**，面板却显示着已选 —— 用户重启后看到的就是"保存的颜色没了"（实测反馈）。
  // 补齐规则：另一侧 = 当前官方色（主题服务不可达时退回同色，与"没分开时两态同色"
  // 的既有语义一致）—— pair 永远完整，不落消毒黑洞。
  if (separate) {
    const other = mode === "light" ? "dark" : "light";
    if (!next[other]) {
      const tokens = (THEME_COLOR_ROLES.find((r) => r.id === role) || {}).tokens;
      next[other] = (tokens && officialColorOf(tokens)) || hex;
    }
  }
  setFontValues({ themeColors: Object.assign({}, selection.themeColors, { [role]: next }) }); applyEffects(); emit();
};
const onThemeColorClear = (role) => {
  const next = Object.assign({}, selection.themeColors);
  delete next[role];
  setFontValues({ themeColors: next }); applyEffects(); emit();
};
// 视图开关（defaults-only，不持久化）：只列调过的角色，便于收尾核对。
const onThemeTypeOnly = (v) => {
  setTransient("themeTypeOnly", v);
  emit();
};

const onThemeDarkSeparate = (v) => {
  setFontValues({ themeDarkSeparate: v }); applyEffects(); emit();
};
// 颜色角色的「当前 DSH 默认值」：宿主墨色快照（snapshotHostFontDefaults 写在 documentElement
// 上）转为 #rrggbb 供 <input type="color"> 用。取不到就返回空串 —— 面板会退回显示"跟随"，
// 不影响覆盖能力。这样色块本身显示的就是当前实际生效的颜色，而不是占位字样。
const toHexColor = (v) => {
  const s = String(v || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s;
  const m = s.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (!m) return "";
  const h = (n) => Number(n).toString(16).padStart(2, "0");
  return "#" + h(m[1]) + h(m[2]) + h(m[3]);
};
const officialColorOf = (tokens) => {
  try {
    const es = document.documentElement.style;
    for (const t of tokens || []) {
      const hex = toHexColor(es.getPropertyValue("--we-host-" + t.slice(2)));
      if (hex) return hex;
    }
  } catch { /* ignore */ }
  return "";
};

// 字体自定义：总开关 + 颜色/字重/字体族，各项立即生效并持久化。
// 打开开关时**顺手**去要一次本机字体清单（宿主那次扫描很贵，只在用户真的进这一区时才发生；
// 清单本身不参与字体值，拿不到也不影响任何别的功能 —— 见 src/settings/system-fonts.js）。
const onToggleFontCustom = (v) => {
  setSetting("fontCustom", !!v); applyEffects(); emit();
  if (v) ensureSystemFonts(false);
};

// 全局字重与全局字体族都已移除：字重/字族都按角色与按组件细化（见 src/font/）。
// 「高级字体设置」视图开关（defaults-only，不持久化）。
const onFontAdvanced = (v) => {
  setTransient("fontAdvanced", v);
  emit();
};

// 组件字体族：存 **族键**（内置键或 `sys:<本机字体>`），解析成 CSS 栈是 apply 那一侧的事
// （components.js 的 buildComponentCss / buildDslBlocks 经 resolveFamily 拿栈）。
// ⚠️ 另一种历史值是**解析后的栈**（fontFamilyStack）—— 解析侧照样认，故老字体集不必迁移；
//    "选中项反查"两种形态都能处理（fontFamilyKeyOf）。
const onComponentFamily = (prefix, key) => {
  const next = Object.assign({}, selection.componentFonts);
  const one = Object.assign({}, next[prefix]);
  const family = sanitizeFamilyValue(key);
  if (!family) delete one.family;
  else one.family = family;
  if (Object.keys(one).length) next[prefix] = one;
  else delete next[prefix];
  setFontValues({ componentFonts: next }); applyEffects(); emit();
};

// 「恢复默认」：所有字体自定义项清回 DSH 默认值（空 = 不覆盖；字体族回跟随）。
// 这些容器 + themeDarkSeparate + globalFamily 是**字体集正文**的键 ⇒ 整批赋值后走
// persistFontSet()（它们已不在 settings 白名单里，`setSetting` 那条通道不会把它们写出去）。
// ⚠️ 这是字体键**唯一**允许出现字面直写的地方（逐键走 `setFontValues` 会发一整串 PUT）；
//    判据：`verify-fontset` ⑦ 的字面直写棘轮 —— 别处的直写会让它变红。
const onFontResetAll = () => {
  selection.themeColors = {};
  selection.themeSize = {};
  selection.themeWeight = {};
  selection.themeFamily = {};
  selection.globalFamily = "";
  selection.componentFonts = {};
  selection.themeDarkSeparate = false;
  // 「只看改过的」是**视图**状态，不归"恢复默认"管：它清的是字体值，不该顺手把用户选的筛选
  // 也翻掉（那会让"恢复默认"改掉界面的看法）。判据钉住这一点。
  persistFontSet();
  // `fontAdvanced` 是**仅默认值**键（不在持久化白名单里）⇒ 走**瞬态**入口。走 `setSetting` 会顺手
  // `persistSelection()`，把一个永远不会被写出去的键送进 debounce 队列 —— 白跑一次宿主 PUT。
  // 判据：`verify-client` ⑤d ①c（DEFAULTS_ONLY 键不得经落盘通道写，键集从 schema 派生）。
  setTransient("fontAdvanced", false); applyEffects(); emit();
};

// ── 壁纸库 / 库视图处理器已按族搬出 ───────────────────────────────────────────
// 刷新、分级/类型/文件夹/方向筛选、布局、Edge 兼容、轮播间隔与触发、过场、Rope 显隐/形态/比例、
// 立绘两步确认、当前 live 帧、自定义帧记忆、关闭选择器、INTERVALS 档位表
// 整段住 src/client/handlers/library-handlers.js；构建期内联回本作用域。
// ── Pagination row: big libraries must not render every card at once (hundreds
//    of thumbnails per emit make the picker lag). The slicing itself is the
//    model's (`pageSlice` in src/picker/picker-model.js); 这里只画「上一页 / 下一页」。──
const pagerRow = (count, page, pages, onPrev, onNext) =>
  React.createElement("div", { className: "we-picker__pager" },
    React.createElement("span", { className: "we-picker__hint" },
      weT("共 {count} 个 · 第 {page} / {pages} 页", { count, page: page + 1, pages })),
    React.createElement("button", {
      className: "we-picker__btn", type: "button",
      disabled: page <= 0,
      onClick: onPrev,
    }, weT("‹ 上一页")),
    React.createElement("button", {
      className: "we-picker__btn", type: "button",
      disabled: page >= pages - 1,
      onClick: onNext,
    }, weT("下一页 ›")),
  );

// ── 模态框交互的接线 ───────────────────────────────────────────────────────
// 契约：渲染器（`src/picker/picker-modal.js`）**不写 `selection`、不自己发通知** ⇒
// 「改状态 + 发通知」的动作一律留在这里（模块级），经 `ctx` 交给渲染器；标记里只剩
// `onClick: onShowNormalView` 这样的引用。判据是接缝那几条（同 `panel-tabs` / 属性面板口径）。
const onShowNormalView = () => { disarmConfirm(); setTransient("modalView", "normal"); emit(); };
const onShowHiddenView = () => { disarmConfirm(); setTransient("modalView", "hidden"); setTransient("batchMode", false); setTransient("batchSelected", []); emit(); };
const onToggleBatchMode = () => { disarmConfirm(); setTransient("batchMode", !selection.batchMode); setTransient("batchSelected", []); emit(); };
// 「批量隐藏」按钮只置令牌；落地在问句行的「确认」（不变量 2）。
const onArmBatchHide = () => armConfirm("batchHide");
const onBatchHide = () => {
  disarmConfirm();
  hideWallpapers(selection.batchSelected.slice());
  setTransient("batchMode", false);
  setTransient("batchSelected", []);
  emit();
};
const onBatchCancel = () => { disarmConfirm(); setTransient("batchMode", false); setTransient("batchSelected", []); emit(); };
const onSearchInput = (e) => { setTransient("search", e.target.value); emit(); };
const onPickCard = (w) => {
  // 轮播编辑器的下钻（pickerDraft）：点卡片 = 加入/移出**草稿**，不切当前壁纸；
  // 草稿对象被就地增删（与 importPlaylistIntoDraft / 面板编辑器同一口径），
  // 「保存」时才由 saveEditingGroup 落盘。
  if (selection.pickerDraft && selection.editing) {
    const ids = selection.editing.wallpaperIds;
    const i = ids.indexOf(w.id);
    if (i >= 0) ids.splice(i, 1);
    else ids.push(w.id);
    emit();
    return;
  }
  if (selection.batchMode) {
    const i = selection.batchSelected.indexOf(w.id);
    if (i >= 0) selection.batchSelected.splice(i, 1);
    else selection.batchSelected.push(w.id);
    emit();
  } else {
    applySelection(w.id, { fromManual: true });
  }
};

// ── 壁纸选择器组件 WallpaperPicker 已整段搬出 ─────────────────────────────────
// 组件体（hooks / 窗口测量 / 渲染接线）住 src/client/picker-component.js；构建期内联回本作用域，
// 函数声明提升 ⇒ WallpaperPickerSection 与 renderPickerModal 的调用点文本零改动。

// ── Settings section wrapper (first-level page) ─────────────────────────────
// Mirrors the skin-center's sectionList > pluginCard structure: the picker is
// rendered inside a liquid-glass card shell so the whole settings page reads
// as one frosted surface over the wallpaper. Owner props ({ close }) are
// intentionally ignored — this section never leaves settings.
function WallpaperPickerSection() {
  // 语言切换：顶层组件订阅一次，整棵子树（含 render* 那些纯渲染器）跟着重渲染。
  useWeLocale();
  return React.createElement("ul", { className: "we-picker__section-list" },
    React.createElement("li", { className: "we-picker__card-shell" },
      React.createElement(WallpaperPicker, null),
    ),
  );
}

// ── Chat-interface rope dock ────────────────────────────────────────────────
// A chibi ship-whale maid grips a pull-cord and floats over the chat. Drag it
// along the top to reposition; on release it snaps back to the TOP edge (and is
// clamped so it can never be dragged out of view). What it opens depends on the
// host (src/ui/sidebar-right.js 是唯一模式真源):
//   · harness ≥0.1.5（有官方右侧栏）：点击/下拉 → openTab 展开右侧栏的「壁纸」
//     tab（快捷播放面板融进官方侧栏，抽屉不启动）；
//   · 低版本宿主：点击/下拉 → 右滑抽屉（玻璃面板自右向左划出，内容同一份
//     QuickPanel），上推 / ESC / 收起 关闭。拖拽全程有跟手预览（合成器属性
//     直写 DOM，不进 React 渲染路径）。

// ── Rope artwork ────────────────────────────────────────────────────────────
// The original chibi ship-whale maid used to be inlined here as `ROPE_IMG`.
// (upstream design): it is no longer a built-in form. The very same
// bytes now live in the 「作者自用」 factory preset as an embedded custom artwork
// (`lib/glass-presets/factory-author.json`, assets.mascot.data) — an easter egg.
// Alternate rope artwork: the full-body whale "onee-san" maid (source 1024×1536,
// downscaled to 384×576, transparent) — a second selectable mascot form. Taller
// portrait (aspect 2:3) than the chibi, so its base box below differs; the <img>
// still fills .we-rope__art with object-fit: contain.
//
// 启动性能：立绘不是启动必需的数据 —— 桌面只画**当前形态**一张，其余只在吉祥物面板里出现。
// 所以字节住 `assets/rope/`（随 npm 包发布），由宿主 `/wallpaper-engine/rope-art/<name>.png`
// 按需直出，客户端只拿 URL；**不要再把字节 base64 内联进主产物**（那会让主产物多背几 MB）。
// `scripts/build-client.mjs` 保留"声明 ↔ 文件"的对账（防漏/改名）。
const ROPE_IMG_WHALE = BASE + "/rope-art/whale.png";
// Third rope artwork: Phoebe Jiubi — the blonde chibi gripping the rope (source 1254×1254,
// downscaled to 384×384, transparent) — square 1:1 like the chibi proportions; the
// drawn rope runs in from the top edge, same convention as the maid artwork.
const ROPE_IMG_PHOEBE = BASE + "/rope-art/phoebe.png";
// ── 八只「模型娘」（用户提供）──────────────────────────────────────
// 每个模型一张竖版立绘（源图 2048×2048，四周 20–28% 是透明留白 ⇒ **先裁到 alpha 紧致
// 包围盒再缩放**，否则等于白存那些像素）。统一缩放到**高 384**、PNG 载荷。
// 与「Deepseek_Pro」同档（她也 384），显示盒 64 宽时约 4.8× 余量，ropeScale 放大也不糊。
// 源资产归档在 assets/mascot/，运行时载荷在 assets/rope/（随包发布），流程见那里的 README。
const ROPE_IMG_CLAUDE = BASE + "/rope-art/claude.png";
const ROPE_IMG_DEEPSEEK = BASE + "/rope-art/deepseek.png";
const ROPE_IMG_GEMINI = BASE + "/rope-art/gemini.png";
const ROPE_IMG_GPT = BASE + "/rope-art/gpt.png";
const ROPE_IMG_GLM = BASE + "/rope-art/glm.png";
const ROPE_IMG_GROK = BASE + "/rope-art/grok.png";
const ROPE_IMG_KIMI = BASE + "/rope-art/kimi.png";
const ROPE_IMG_QWEN = BASE + "/rope-art/qwen.png";


// Rope forms: artwork + a display label + a base box size (before the user
// scale). The box aspect mirrors the image so object-fit: contain fills it with
// no letterboxing; the drag/clamp maths read the real rendered box at runtime.
const ROPE_FORMS = {
  // ── 两只内置：用户自绘（`maid` 已从出厂形态除名 —— 那只图搬进「作者自用」
  //    出厂预设当内嵌的自定义立绘）。⚠️ `phoebe` 换了**竖版**立绘（源
  //    902×1223），显示盒因此从 1:1 的 64×64 变成 64×87 —— 与原来那只方图不是同一个构图。──
  whale: { get label() { return weT("Deepseek_Pro"); }, img: ROPE_IMG_WHALE, w: 64, h: 96 },
  phoebe: { get label() { return weT("菲比啾比"); }, img: ROPE_IMG_PHOEBE, w: 64, h: 87 },
  // ── 八只「模型娘」：宽度统一 64，**高度按各自源图比例算**（8 张比例都不同，硬统一成
  //    方盒会让 object-fit: contain 上下留白、看起来忽大忽小）。名字就是模型名（两种语言同形）。──
  claude:   { get label() { return weT("Claude"); }, img: ROPE_IMG_CLAUDE,     w: 64, h: 76 },
  deepseek: { get label() { return weT("DeepSeek"); }, img: ROPE_IMG_DEEPSEEK,   w: 64, h: 74 },
  gemini:   { get label() { return weT("Gemini"); }, img: ROPE_IMG_GEMINI,     w: 64, h: 83 },
  gpt:      { get label() { return weT("GPT"); }, img: ROPE_IMG_GPT,        w: 64, h: 77 },
  glm:      { get label() { return weT("GLM"); }, img: ROPE_IMG_GLM,        w: 64, h: 80 },
  grok:     { get label() { return weT("Grok"); }, img: ROPE_IMG_GROK,       w: 64, h: 79 },
  kimi:     { get label() { return weT("Kimi"); }, img: ROPE_IMG_KIMI,       w: 64, h: 82 },
  qwen:     { get label() { return weT("Qwen"); }, img: ROPE_IMG_QWEN,       w: 64, h: 80 },
};

/**
 * 主页面那只吉祥物**当前用的立绘**：自定义优先（`mascotImage` 非空且显示盒合法），
 * 否则用「吉祥物形态」选的内置立绘。返回 `{ img, w, h, custom }` ——
 * RopeDock 与设置页的预览**共用这一处解析**（两处各写一遍必然漂）。
 * ⚠️ 显示盒坏掉（空 / 不合法 / 超设计上限）时整条自定义都作废：宁可回到内置立绘，也不要拿
 * 一个猜出来的盒子去量一只吉祥物（拖动与视口钳位都读它）。
 */
function ropeArtOf(selLike) {
  const sel = selLike || selection;
  const form = ROPE_FORMS[sel.ropeForm] || ROPE_FORMS.deepseek;
  const name = String(sel.mascotImage || "");
  const m = /^(\d{1,3})x(\d{1,3})$/.exec(String(sel.mascotImageBox || ""));
  const bw = m ? Number(m[1]) : 0;
  const bh = m ? Number(m[2]) : 0;
  // 形状合法之外还要在**设计上限**内：PUT 的 sanitize（mascotBox 档）拦得住超盒值，
  // 但拦不住直接手改 config.json —— `999x999` 按"盒坏"处理，回落内置，不按它渲染。
  if (!name || !m || !(bw >= 1 && bw <= MASCOT_BOX_MAX_W && bh >= 1 && bh <= MASCOT_BOX_MAX_H)) {
    return { img: form.img, w: form.w, h: form.h, custom: false };
  }
  return {
    img: apiUrl("/mascot?v=" + encodeURIComponent(name)),
    w: bw,
    h: bh,
    custom: true,
  };
}

const ROPE_OPEN_THRESHOLD = 96;   // px of downward/upward drag that commits open/close (less twitchy)
const ROPE_PREVIEW_START = 32;    // px of pull before the panel preview starts tracking
const ROPE_EDGE_INSET = 8;        // resting distance below the snapped top edge
const ROPE_VIEW_MARGIN = 8;       // hard clamp so the rope can never leave the viewport
const ROPE_FALLBACK_SIZE = { w: 52, h: 57 }; // matches the CSS box; real size measured at runtime

// Standard clamping (the shared clampNum is an in-range-or-fallback check).
function ropeClamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// Resting rope position, persisted across sessions (viewport-clamped on read).
// size is the current form's scaled box; it only shapes the first-run centering
// and the clamp margins, so the initial position adapts to the mascot geometry.
function readRopePos(size) {
  const s = size || ROPE_FALLBACK_SIZE;
  const w = (typeof window !== "undefined" && window.innerWidth) || 1280;
  const h = (typeof window !== "undefined" && window.innerHeight) || 800;
  let p = null;
  try {
    const raw = localStorage.getItem(ROPE_POS_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && Number.isFinite(o.x) && Number.isFinite(o.y)) p = { x: o.x, y: o.y };
    }
  } catch { /* ignore */ }
  // Resting position is the TOP edge (any horizontal spot). x stays wherever
  // the user left it (clamped to the viewport); y is always the top inset.
  if (!p) p = { x: Math.max(ROPE_EDGE_INSET, Math.round((w - s.w) / 2)), y: ROPE_EDGE_INSET };
  return {
    x: ropeClamp(p.x, ROPE_VIEW_MARGIN, Math.max(ROPE_VIEW_MARGIN, w - s.w - ROPE_VIEW_MARGIN)),
    y: ropeClamp(p.y, ROPE_EDGE_INSET, Math.max(ROPE_EDGE_INSET, h - s.h - ROPE_VIEW_MARGIN)),
  };
}

// ── 更新公告（what's new）已按族搬出 ─────────────────────────────────────────
// 哨兵版本、配图探针节奏、UpdateNotice 组件与整套文案住 src/client/update-notice.js；
// 构建期内联回本作用域（CONST 里 UPDATE NOTICE COPY 标记随组件一起走）。

// ── 首次安装：自动套用「深色 + 作者自用」（用户口径，取代原来的推广弹窗）──────
// 口径：新装默认就是作者在用的那套观感，不再弹窗问"要不要试试"。
// 触发点只有一个 —— `src/settings/persistence.js` 的 `loadPersisted()` 发现**宿主没有存档
// 且本机也没有本地存档**（真正第一次）。升级用户、重装宿主但本地存档还在的用户，
// 一概不受影响；套用后存档被写出，下次启动走宿主分支，天然只触发一次。
//
// 三条不变量：
//   · **失败不回滚**：预设应用是一整批操作，主题这一腿或某段资产失败时只记错误文案，
//     不把已经落好的部分撤掉（撤一半比不套用更难解释）。
//   · **不阻塞启动**：异步跑，不 await —— 启动链（settings → fontset → inventory）不该
//     等一次预设应用。
//   · **主题腿要等服务**：宿主 `theme` 服务在启动早期拿不到（实测 7ms 时还没有、325ms 才有），
//     而 `applyPreset` 里的 `themeFollowApplyPreference` 拿到空句柄会静默跳过。
//     所以这里先套预设（设置 + 资产），主题留给服务就绪后补一次 —— 见下面的 `pending`。
//     补写只有一次，且**只补主题**，不重跑整份预设（重跑会把用户这几百毫秒里的改动盖掉）。
let firstRunAuthorPending = false;
function firstRunAdopt() {
  try {
    applyPreset("factory-author").then((ok) => {
      if (ok) return;
      // 失败静默：新装用户不该一上手就看见一条红字。诊断行留给排障。
      try { liveLog && liveLog("首次安装套用作者自用失败：" + String(selection.glassPresetError || "")); } catch { /* ignore */ }
    });
    // 主题补写：服务可能还没就绪 ⇒ 交给主题层 onReady 那次回调（见 armFirstRunThemeFlush）。
    firstRunAuthorPending = true;
    flushFirstRunAuthorTheme();
  } catch { /* 首装美化是增强：任何异常都不该阻断启动 */ }
}

/** 主题服务就绪后把首装的主题腿补上（可被 onReady 与定时重试两处调，幂等）。 */
function flushFirstRunAuthorTheme() {
  if (!firstRunAuthorPending) return;
  try {
    if (themeFollowApplyPreference("dark")) firstRunAuthorPending = false;
  } catch { /* 服务异常：留给下一次 */ }
}

// Bumped v3: tabbed picker IA + unified control chrome (sliding segmented tab
// bar, pill switches everywhere, ink-token labels, 30px control heights).
// Forces a fresh <style> injection even when a page still carries the
// old stylesheet tag from a previous bundle (TAG_ID dedupes the injection; a
// static id would leave stale CSS rules active and new rules missing).
const TAG_ID = "dsh-wallpaper-engine/styles-v3";
// 本次 bundle 求值的代际标记: cleanup 只移除自己这一代的 <style>, 于是 HMR 的
// "新代已挂载、旧代才卸载"顺序下不会误删新代仍在用的样式表。
const CSS_GEN = Date.now() + ":" + Math.random().toString(36).slice(2);
// 注入抽成函数: fiber cleanup (见 apply) 会移除这个 <style>, 所以 effect 挂载时
// 必须能再注入一次 — 否则同一页面内 disable→enable 后整个界面无样式。
function ensurePluginCss() {
  if (typeof document === "undefined") return null;
  let tag = document.querySelector("style[data-plugin-css=" + JSON.stringify(TAG_ID) + "]");
  if (tag === null) {
    tag = document.createElement("style");
    tag.dataset.plugin = "dsh-wallpaper-engine";
    tag.dataset.pluginCss = TAG_ID;
    document.head.appendChild(tag);
  }
  // 同 id 的旧标签可能带的是上一个 bundle 的 CSS → 按当前 bundle 的内容刷新
  if (tag.textContent !== CSS) tag.textContent = CSS;
  tag.dataset.pluginCssGen = CSS_GEN;
  return tag;
}
ensurePluginCss();

// ── Plugin exports ──────────────────────────────────────────────────────────
const inject = ["slots"];

// ── Mica 能力探测 ──────────────────────────────────────────────────────────
// 「增强模式」下 DSH 桌面外壳把左侧工作区 (.dshDesktopSidebarSurface) 交给系统
// 材质：有 Mica 时保持透明（壁纸透出），没有 Mica 时改用 --dsw-alias-bg-layer-1
// 实心绘制，左侧工作区的背景因此与壁纸无关。Mica 只在 Windows build ≥ 22621
// （Win11 22H2+）存在，Win10 永远拿不到。桌面外壳已按 os.release() 的 build 号
// 算好结果，并写进渲染 URL 的 dsh-desktop-mica 查询参数（1/0）——这是页面能拿到
// 的最准信号，同步读取、零成本。参数缺失（普通浏览器 / 非增强模式）时退回 UA：
// UA 几乎总是不带 build 号，平台不是 Windows 就完全不动作（非 Windows 行为不变），
// 是 Windows 但解析不出 build 则按「不支持」处理（安全侧，宁可给确定性底色也不
// 赌系统材质）。结果只探测一次并缓存 —— applyEffects 每次设置变动都会调用它。
// 全程用 try/catch 吞掉异常，绝不抛出，也绝不因探测本身改变页面行为。
const MICA_MIN_BUILD = 22621;
let micaSupport; // undefined = 未探测 · null = 非 Windows（不适用）· false = 无 Mica
function detectMicaSupport() {
  if (micaSupport !== undefined) return micaSupport;
  micaSupport = null;
  try {
    let marker = null;
    if (typeof location !== "undefined" && location && typeof location.search === "string") {
      marker = new URLSearchParams(location.search).get("dsh-desktop-mica");
    }
    if (marker === "1") {
      micaSupport = true;
    } else if (marker === "0") {
      micaSupport = false;
    } else {
      const ua = (typeof navigator !== "undefined" && navigator && navigator.userAgent) || "";
      if (/Windows/i.test(ua)) {
        const build = /Windows NT 10\.0\.(\d+)/.exec(ua);
        micaSupport = !!build && Number(build[1]) >= MICA_MIN_BUILD;
      }
    }
  } catch { /* 探测异常：保持 null（不适用）→ 不改任何既有行为 */ }
  return micaSupport;
}

// ── 玻璃饱和度解耦（?we-saturate）─────────────────────────────────────────────
// **不变量**：`--we-saturate` 是常量材料属性，不随 玻璃 滑块（模糊深度）变化。
// 随它线性上升（1.15 + blur*0.028 ⇒ 0px→1.15 … 60px→2.83）等于让一个滑块同时改两件
// 语义无关的事：毛玻璃深度（--we-blur）和背景「色彩融化」强度 —— 高模糊 + 高饱和会把
// 玻璃后残留的壁纸文字放大成 荧光/彩色鬼影，而不是中性雾面。取 1.25–1.4 液态玻璃区间
// 的低端 1.3，且低于样式表自身 1.8 的回退默认值。
// A/B 逃生舱（与 dsh-desktop-mica 同风格）：
//   ?we-saturate=legacy → 完全恢复旧的耦合公式（逐字节等值）
//   其余（缺省 / 垃圾值 / 大小写混写）→ 新的常量行为
// 只解析一次并缓存 —— applyEffects 每次设置变动都会读它。
// 全程 typeof 守卫 + try/catch：非浏览器 / 验证沙箱里绝不抛出，也绝不改变行为。
// 不挂任何 DOM 属性，所以 dispose 没有额外清理（--we-saturate 本身已在
// clearEffects 里移除）。
const GLASS_SATURATE = 1.3;
let legacySaturateCoupling; // undefined = 未解析 · true = 旧耦合 · false = 常量
function useLegacySaturateCoupling() {
  if (legacySaturateCoupling !== undefined) return legacySaturateCoupling;
  legacySaturateCoupling = false;
  try {
    if (typeof location !== "undefined" && location && typeof location.search === "string") {
      let raw = "";
      if (typeof URLSearchParams === "function") {
        raw = new URLSearchParams(location.search).get("we-saturate") || "";
      } else {
        const m = /[?&]we-saturate=([^&]*)/.exec(location.search);
        raw = m ? decodeURIComponent(m[1]) : "";
      }
      legacySaturateCoupling = String(raw).toLowerCase() === "legacy";
    }
  } catch { /* 解析异常：保持新行为（常量），绝不抛出 */ }
  return legacySaturateCoupling;
}

// ── 跨包扩展注册（P-A）：三项「扩展」里有两项（点击拖尾 packages/fx、3D packages/parallax）
//    从 P-A 起各自住在自己的包里 —— 它们的描述符与行为层**不再出现在本 bundle 的作用域里**，
//    唯一通道是 src/extensions/extension-registry.js 这张共享注册表。本文件是**组装根**：
//      · 留在主包的那一项（自定义会话头像）在这里自登记（模块作用域，不用等挂载）；
//      · 挂载期按注册表把每一层的 sync 接上 store 订阅（见下面 ctx.effect）；
//      · 拆卸期逐层 dispose（收尾所有权与"关掉=逐字节回原生"这条不变量同源）。
//    屏上顺序 = (order, 注册序)：头像固定 order 1，子包各自声明 2 / 3（跨包求值顺序不是契约）。
//    子包产物可能**在本组件挂载之后**才求值（loader 按需）⇒ 挂载期还要装一个 attacher
//    让迟到的层立刻补接（见 ctx.effect 里的 weSetLayerAttacher）。
weRegisterExtensionModule("avatar", AVATAR_EXTENSION_MODULE);
weRegisterLayerHooks("avatar", { sync: syncAvatarLayer, dispose: disposeAvatarLayer });
weRegisterExtensionModule("perf", PERF_EXTENSION_MODULE);

// ── 首帧后空闲门────────────────────────────────────────────────────────
// 口径：宿主 `ClientEntries.start()` 对**每个**插件都 `create` + `loader.await()`，
// 插件没法把自己摘出启动关键路径（审计 docs/archive/wip/ISSUE-AUDIT-148PLUS.md 的更正 ①）；
// 能减的只有"启动期别让宿主干重活"。inventory 的冷路径在大库上要等整轮扫描
// （实测总延迟 1.6–2.0 s），而**首帧之前没有任何界面在等它** —— 所以这一腿排到首帧画完后
// 的空闲时段：双 rAF 保证已经上屏，再 requestIdleCallback（1 s 兜底，躲开长任务）。
// 没有浏览器 API（vm 测试台 / 非浏览器宿主）时立即放行，行为与本改动之前一致。
function afterFirstPaint() {
  return new Promise((resolve) => {
    const w = typeof window !== "undefined" ? window : null;
    if (!w || typeof w.requestAnimationFrame !== "function") { resolve(); return; }
    let settled = false;
    const done = () => { if (settled) return; settled = true; resolve(); };
    // 绝对兜底：页面不可见 / 最小化 / 托盘启动时 Chromium 会冻结 rAF（本文件 :2052 同一结论），
    // 只靠双 rAF 可能永不回调 ⇒ inventory 一直不加载、列表停在"扫描 Wallpaper Engine…"。
    // idle 的 timeout 只管 idle 阶段，管不到 rAF；这里给整条门加 1 s 上限（与 idle 兜底同口径）。
    try { w.setTimeout(done, 1000); } catch { done(); return; }
    const idle = () => {
      try {
        if (typeof w.requestIdleCallback === "function") w.requestIdleCallback(() => done(), { timeout: 1000 });
        else if (typeof w.setTimeout === "function") w.setTimeout(done, 150);
        else done();
      } catch { done(); }
    };
    try { w.requestAnimationFrame(() => w.requestAnimationFrame(idle)); } catch { done(); }
  });
}

// ── 浏览器半边入口 apply(ctx) 已整段搬出 ─────────────────────────────────────
// fiber 生命周期、启动链与宿主服务接线住 src/client/plugin-apply.js；构建期内联回本作用域，
// 函数声明提升 ⇒ 下面 `exports.apply = apply;` 文本零改动。

exports.apply = apply;
exports.inject = inject;
// ── 桌宠联动的宿主侧门面已按族搬出 ───────────────────────────────────────────
// petLinkWiring（登记/补接线/warmup/dispose 转发与"缺席=抛错"语义）整段住
// src/client/pet-link-facade.js；构建期内联回本作用域，9 处 petLink.* 调用点文本零改动。

// ── 跨包浏览器半边通道（ADR-0014 S5.1 / S5.4「宿主注入显式键集」）────────────────────
// 显式键集表已独立到 `src/core/host-bridge.js`（契约真源；构建期内联在本正文之前，同处一个
// 扁平工厂作用域 ⇒ 正文里的活绑定照旧以 getter 形式给出去，产物行为逐字不变）。
// 搬走的原因：这张表是跨包契约，改一个键要同时对账 6 处 `} = host;` 解构名单（判据见
// test/verify-subpackage-client-half.mjs 的 D-7；产物里的申报表由构建期从解构派生），不该埋在 6,000+ 行正文深处。
// 窄键常量 `ROTATION_INTERVAL_DEFAULT` 只服务键表，随表一起搬走。
// ── 玻璃运行时状态门面（ADR-0016 第三刀）────────────────────────────────────
// weGlassSurfaceStatus（表面策略诊断投影）的真实现住 packages/glass 的 glass-surfaces.js ——
// 本 bundle 的作用域里没有那个函数名。外观 ctx 的组装点要它 ⇒ 与 petLink 同款「门面 + 缓冲登记」：
// 真实现经桥键 registerGlassStatus 由玻璃包在求值期送进来；缺席（玻璃行没装 / 被关）时返回 []，
// 面板的状态列表空着 —— 缺的是那一节的状态，不是页面。迟到登记由玻璃包同一次求值里的
// registerLayerHooks 触发注册表 listener ⇒ emit() 重画，状态自然补上。
let glassStatusApi = null;
function weGlassSurfaceStatus() {
  return glassStatusApi ? glassStatusApi.status() : [];
}
/** 子包登记入口（桥键 registerGlassStatus）：入槽即可 —— 状态是纯投影，无补做动作。 */
function glassStatusRegister(api) {
  glassStatusApi = api;
  return api;
}

// HOST_BRIDGE_BINDINGS / HOST_BRIDGE_KEYS / exports.hostBridgeKeys 见 src/core/host-bridge.js。
return module.exports;
