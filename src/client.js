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
// Body attribute set while a wallpaper is active; CSS uses it to make the frame
// background transparent so the behind-body layer shows through.
const ACTIVE_ATTR = "data-we-wallpaper";
const LAYER_ID = "dsh-wallpaper-engine-layer";
const SCRIM_ID = "dsh-wallpaper-engine-scrim";
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
// （`maid`「小女仆」2026-10-13 从出厂形态除名，那只图搬进「作者自用」预设当彩蛋）；大小步进见下。
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
//   · 本机字体键 `sys:<族名>`：清单来自宿主枚举（src/system-fonts.js），栈在这里现拼。
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
/** 族键 / 历史栈 → 可用的 CSS 栈；空、`inherit`、未知一律 `inherit`（= 不覆盖官方外观）。 */
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
// 场景实时渲染（WebWallGL）帧率上限档位。Mirror of lib/index.js.

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

// `readPersisted()` 已随持久化层抽到 src/persistence.js（store 初始化仍在下面调用它）。

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
  // 本机字体清单（src/system-fonts.js）：**首帧就用缓存那份** —— 否则一个已选中的本机字体
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
  // store 见 src/preset-store.js。
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
  url: null,
  type: null,
  previewUrl: null,
  // Transient: real container suffix of the media (host inventory `mediaExt`, e.g. "mp4").
  // The media URL is token-shaped (`/media/<base64url>`) with no extension, so the
  // "browser can play this natively" decision (see src/video-layer.js) needs this field.
  mediaExt: null,
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
  // 由 WallpaperPicker 的一个 effect 消费一次即清（见 src/sidebar-right.js 的
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
  inventory: { installDir: null, uploadDir: null, cacheDir: null, weAssetsDir: null, weAssetsAvailable: false, sceneMediaBase: "", wallpapers: [], total: 0, portableCount: 0, playlists: [], error: null },
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
 * `refresh()` 里被自纠，是一次**瞬时翻转**；而用户显式动作（#49）会一直亮着（它的让路宽限 1.5s
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
// 值域的**真源**在宿主侧 `lib/routes/scene-frame.js`（它把非法值 clamp 掉）——本表要与它一致，
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
//     见 src/fontset-store.js —— 这些键已退出 settings 的持久化白名单）
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
// 与「壁纸属性」面板的 silent 拖动同一条口径（src/picker-props-panel.js 的 onPropInput）。
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
 * 数字会与 `KINDS` 漂移。⚠️ 这不是理论风险 —— R4 把刻度改成 0–100 时改了 `KINDS` 与面板量程，
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
 * 4 处使用点（src/panel-tabs.js 两处 / src/picker-modal.js 两处）共用这一份标记：抄四份会让
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
// 这一族的实现已抽到 **src/persistence.js**。构建期内联回本作用域，
// 调用点（persistSelection / flushPersist / onPageHideFlush / …）无需改动。
// 契约：8 个出向依赖的清单、入口与不变量 —— 见该文件头。
// ⚠️ **字体值不走这条通道**：那些键住 `fontsets/<活动 id>.json`，通道在
// **src/fontset-store.js**（同形的 debounce + 脏标记 + 重试，但真源、键集与失败语义都不同）。

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
  return (data && data.error) || weT("宿主返回 {status}", { status: res.status });
}
let inventorySeq = 0;
async function loadInventory() {
  const seq = ++inventorySeq;
  setTransient("loading", true);
  emit();
  let next;
  try {
    const res = await apiJson(INVENTORY_URL);
    // 两种失败（宿主不可达 / 非 2xx）由 hostFailureReason 统一翻译，面板那一行据此显示。
    if (!res.ok) throw new Error(hostFailureReason(res));
    const data = res.data || {};
    next = {
      installDir: data.installDir,
      uploadDir: data.uploadDir || null,
      cacheDir: data.cacheDir || null,
      weAssetsDir: data.weAssetsDir || null,
      weAssetsAvailable: Boolean(data.weAssetsAvailable),
      // 场景载荷的源（独立壁纸媒体源的 origin；空串 = 回落应用源，见 live-layer 的 liveRenderUrl）。
      sceneMediaBase: typeof data.sceneMediaBase === "string" ? data.sceneMediaBase : "",
      wallpapers: data.wallpapers || [],
      total: data.total || 0,
      portableCount: data.portableCount || 0,
      playlists: Array.isArray(data.playlists) ? data.playlists : [],
      error: null,
    };
  } catch (err) {
    next = {
      installDir: null,
      uploadDir: null,
      cacheDir: null,
      weAssetsDir: null,
      weAssetsAvailable: false,
      sceneMediaBase: "",
      wallpapers: [],
      total: 0,
      portableCount: 0,
      playlists: [],
      error: String(err && err.message ? err.message : err),
    };
  }
  if (seq !== inventorySeq) return; // superseded by a newer loadInventory()
  setTransient("inventory", next);
  setTransient("loading", false);
  setTransient("loaded", true);
  // Fresh inventory → reset pagination, but ONLY when the wallpaper id set
  // actually changed: an upload/remove/refresh that keeps the same list must
  // not kick the user back to page 1.
  const prevIds = selection._invIds || "";
  const nextIds = next.wallpapers.map((w) => w.id).join("\u0001");
  if (prevIds !== nextIds) {
    setTransient("_invIds", nextIds);
    setTransient("editorPage", 0);
  }

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

// ── Content-rating + type filters ───────────────────────────────────────────
// 判定本身（`ratingOf` / `matchesRatingFilter` / `matchesTypeFilter` /
// `isPlayableType` / `isRotatableWallpaper` / `isHiddenWallpaper`）与它们的分级正则已抽到
// **src/picker-model.js** —— 网格、轮换编辑器、轮换候选、自动选择与两个下拉的计数共用
// 同一份判定，判定留在本文件就会长出第二个真源。这里是**调用点**：两个过滤档从
// `selection` 显式传入，模型自己不读任何模块级状态。

// 选择被拒 / 被丢弃时的可读原因（`""` = 没有可解释的原因，正常应用）：壁纸层不渲染、
// 播放按钮因 !sel.url 变灰时，卡片上至少给出原因。类型档不在原因表里：它只筛列表与
// 轮播候选、不拦播放（keepPlayingWallpaper）。
function selectionBlockedNote(w) {
  if (!w) return weT("当前壁纸已不在列表里（可能已被移除或隐藏）");
  if (!isPlayableType(w)) return weT("这张壁纸没有可播放的媒体文件");
  if (!matchesRatingFilter(w, selection.contentRatingFilter)) return weT("这张壁纸被「内容分级」过滤排除了 —— 把内容分级切回「全部」即可播放");
  return "";
}

function playableInventory() {
  return playableWallpapers(
    selection.inventory.wallpapers, selection.contentRatingFilter, selection.typeFilter, selection.hiddenIds,
  );
}

// Re-validate the active selection against the current inventory + filters.
// Called after a refresh AND after changing the rating/type filter. 丢弃闸门是
// keepPlayingWallpaper：分级是内容闸门（拦播放），类型档只筛列表与轮播候选 ——
// 切类型档不得把正在应用的壁纸干掉。轮播在场时拿不到候选就换下一张，但「仅被
// 类型档排除」这一档不换台。
function revalidateSelection() {
  // 被过滤条件丢弃的选择要留下原因：先取下来，applySelection("") 会清掉
  // blockedNote，故在其之后写回 —— 否则用户改一次过滤条件，壁纸就无声变空白。
  let droppedNote = "";
  const cur = selection.id ? selection.inventory.wallpapers.find((w) => w.id === selection.id) : null;
  const keepCurrent = keepPlayingWallpaper(cur, selection.contentRatingFilter);
  if (selection.id && !keepCurrent) {
    droppedNote = selectionBlockedNote(cur);
    setSetting("id", "");
  }
  // 「仅被类型档排除」= 还能播、没被隐藏、确实属于当前轮播列表，只是候选表按类型
  // 筛掉了它。这一档不换台（下一次轮换 tick 自然按候选走）；隐藏 / 不在列表 / 被
  // 分级拦这些真原因照旧换台。
  const typeOnlyExcluded = keepCurrent && Boolean(selection.id)
    && !isHiddenWallpaper(selection.id, selection.hiddenIds)
    && Boolean(activeRotationGroup()) && activeRotationGroup().wallpaperIds.indexOf(selection.id) >= 0;
  if (selection.rotationEnabled && selection.id && !typeOnlyExcluded
    && !rotationCandidates().some((w) => w.id === selection.id)) {
    const first = rotationCandidates()[0];
    setSetting("id", first ? first.id : "");
  }
  if (!selection.id && selection.rotationEnabled) {
    const first = rotationCandidates()[0];
    if (first) selection.id = first.id;
  }
  applySelection(selection.id);
  // 仍然没有可播壁纸 → 把被排除的原因显示出来（有轮播接手则不打扰）。
  if (droppedNote && !selection.id) setTransient("blockedNote", droppedNote);
  emit();
}

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
      && isRotatableWallpaper(w, selection.contentRatingFilter, selection.typeFilter)
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
  if (typeof window === "undefined" || typeof window.setTimeout !== "function") return;
  const group = activeRotationGroup();
  const minutes = group ? group.interval : DEFAULTS.rotationInterval;
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
let rotationPrep = null; // { id, fromId, excluded, cancelled, settled, timers, staged, probeMedia, readyEl, kind }
let pendingRotationFade = false; // commit 置位，syncLayers 消费后清零
// eslint-disable-next-line prefer-const -- 跨片段写入：layer-core.js:52,67 · live-layer.js:398,424
let fadingLayerNode = null;      // 正在淡出的旧壁纸层（渐变结束移除）
// iframe 类媒体（live 渲染页 / 旧链网页壁纸）的「节点级领养」通道：同源 iframe
// 在同文档内 reparent 会重载文档（Chromium 实测：appendChild 移动 iframe =
// 浏览上下文销毁重建，首帧 15s 预算重启，大包必超时）—— 所以 live/web 探测
// 的 staging 容器在 commit 时【整体转为新层】，iframe 全程不移动，渲染状态
// 零扰动。img/video 无此问题，仍走元素级领养（preparedMediaEl）。
let pendingStagedLayerNode = null;
// 已就绪、等待被 buildMedia 领养进新层的媒体元素（img/video）。就绪态随元素
// 走：探测用的就是最终上屏的元素，杜绝"探测就绪了但层里另建空白元素重新
// 加载"的黑屏闪烁。
let preparedMediaEl = null;
const ROTATION_PREP_TIMEOUT_MS = 20000; // 单阶段就绪探测上限（超时走兜底，不卡死轮换）
// 交叉淡化时长（新层淡入 + 旧层宽限移除的基准）。切换过场表（SWITCH_TRANSITIONS）
// 里 fade 的基准毫秒直接引用本常量，所以「调交叉淡化时长」只需要改这里一处。
const ROTATION_FADE_MS = 1800;
// ── 切换过场（手动点选与自动轮播共用）──────────────────────────────────────
// 每种过场只动 transform / opacity / clip-path —— 全是合成器友好属性。（本插件在
// <video> 与 live <iframe> 上踩过 mask / filter 掉出合成层的坑，故一律不用。）
// 所有过场都守同一条铁律：**旧层保持不透明垫在新层之下**，新层在它之上入场 ——
// 玻璃的 backdrop-filter 采样到透明背景会静默失效（见 applyEffects 内注释），
// 所以这里没有「淡到黑再淡出」那种中间态透明的方案。
// ms = 基准毫秒 × 速度档乘子（SWITCH_SPEEDS）。基准在快档也不为 0，避免「点了没反应」。
const SWITCH_TRANSITIONS = [
  { id: "cut", get label() { return weT("硬切"); }, ms: 0 },
  { id: "fade", get label() { return weT("交叉淡化"); }, ms: ROTATION_FADE_MS },
  { id: "push", get label() { return weT("推移"); }, ms: 700 },
  { id: "wipe", get label() { return weT("擦除"); }, ms: 700 },
  { id: "iris", get label() { return weT("光圈"); }, ms: 800 },
  { id: "zoom", get label() { return weT("缩放"); }, ms: 900 },
  { id: "bars", get label() { return weT("条带"); }, ms: 800 },
];
const SWITCH_SPEEDS = [
  { id: "fast", get label() { return weT("快"); }, factor: 0.6 },
  { id: "normal", get label() { return weT("标准"); }, factor: 1 },
  { id: "slow", get label() { return weT("慢"); }, factor: 1.6 },
];
const SWITCH_DIR_LABELS = {
  get left() { return weT("左"); },
  get right() { return weT("右"); },
  get up() { return weT("上"); },
  get down() { return weT("下"); },
};
// 只有方向型过场听 switchTransitionDir（条带用它决定竖条 / 横条）。
const SWITCH_DIRECTIONAL = ["push", "wipe", "bars"];
// 条带（百叶窗）：板数。横向过场时是 N 块横板，纵向时是 N 块竖板；板数决定缝的
// 密度 —— 5 块太粗、9 块以上在 4K 上偏碎，7 块实测最像百叶窗。点数恒定
// （4N+1），polygon() 才可插值 → 动画连续。
const SWITCH_BARS_TEETH = 7;

/** 当前生效的过场（类型 + 方向 + 实测算出的毫秒）。cut = 不动画。 */

/** 擦除的起始 inset：从新画面「进入」的那一侧长出来（left = 新画面自右进入）。 */
function wipeInset(dir) {
  if (dir === "right") return "inset(0 100% 0 0)";
  if (dir === "up") return "inset(100% 0 0 0)";
  if (dir === "down") return "inset(0 0 100% 0)";
  return "inset(0 0 0 100%)"; // left
}

/**
 * 条带 / 百叶窗：N 块**独立的板**从「进入侧」一起长出来，板间留缝 —— 这才看得出是条带。
 * ⚠️ 必须是独立板（有缝、两端不收拢）：实测做成连续锯齿扫过时，肉眼与「擦除」
 * 分不出来，等于白做。
 *
 * 记法：outer = 进入侧（left/up 取 1，right/down 取 0），t 轴是与扫过方向垂直的轴
 * （left/right 时板是**横板**，up/down 时是竖板）。每块板厚 slat = p/N，深度
 * depth = p：p=0 时全塌在进入侧边缘（零面积），p=1 时板厚刚好铺满一个周期
 * （slat = period）→ 缝隙闭合、合成完整矩形。
 *
 * ⚠️ clip-path: polygon() 只能画**一个连通区域**，而 N 块板彼此不相连 —— 用一条
 * 贴在进入侧边缘、宽度 spine（≤0.4%，且随 depth 从 0 一起长起）的「脊」把板串起来。
 * 脊落在已经露出新画面的那一侧，所以视觉上完全看不出来。
 *
 * 点数恒定（4N+1），polygon() 才能平滑插值。
 */
// ── 轮换 / 媒体生命周期助手已按族搬出（构建期内联在正文之前，同一扁平作用域）────────────
// 声明在 src/client-rotation.js：过场几何（barsPolygon / switchFrames）、探测元素的领养与释放、
// 隐藏期轮换推迟与可见时补做。LIVE_FIRST_FADE_MS 与两个隐藏态标记随声明一起搬走（初始化式不读模块状态）。

// ── 媒体准备（预准备 / 构建 / 选中项落地）────────────────────────────────────
// 这一族的实现已抽到 **src/media-prep.js**（642 行，跨三个不相邻区段：预准备与轮换预挂载、
// applySelection、buildMedia）。构建期内联回本作用域，调用点无需改动。
// 契约：出向依赖清单 / 入口 / 不变量 —— 见该文件头（清单只在那里维护，此处不复述数量）。

function commitRotationSwitch(prep) {
  rotationPrep = null;
  for (const t of prep.timers) { try { clearTimeout(t); } catch { /* ignore */ } }
  prep.timers = [];
  releaseProbeMedia(prep);
  const staged = prep.staged;
  prep.staged = null;
  const w = wallpaperById().get(prep.id);
  const valid = selection.rotationEnabled && selection.id === prep.fromId
    && w && isRotatableWallpaper(w, selection.contentRatingFilter, selection.typeFilter)
    && !isHiddenWallpaper(w.id, selection.hiddenIds);
  liveLog("rotation-commit", "wid=" + prep.id + " from=" + prep.fromId + " kind=" + (prep.kind || "-")
    + " valid=" + valid + " " + liveStateBrief());
  if (!valid) {
    if (staged) { try { staged.div.remove(); } catch { /* ignore */ } }
    if (prep.readyEl) disposeMediaEl(prep.readyEl);
    syncRotationTimer();
    return;
  }
  // 就绪元素随提交走，分两条通道：
  // - iframe 类（live 渲染页 / 旧链网页）：staging 容器整体转为新层（节点级
  //   领养）—— 同源 iframe 同文档 reparent 会重载文档，绝不能让 iframe 移动；
  // - img/video：元素级领养，buildMedia 直接收编进新层。
  if ((prep.kind === "live" || prep.kind === "web") && staged && staged.div && prep.readyEl) {
    pendingStagedLayerNode = staged.div;
    prep.readyEl = null; // iframe 留在容器里，不拆散
  } else {
    preparedMediaEl = prep.readyEl || null;
    prep.readyEl = null;
    if (staged) { try { staged.div.remove(); } catch { /* ignore */ } }
  }
  pendingRotationFade = true;
  applySelection(prep.id, { fromRotation: true, kind: prep.kind });
  // 领养保险丝：applySelection 的 emit 未消费节点级领养（理论上不可达 ——
  // 准备期前提与领养条件一致，此处仅兜底）时 staging 容器不能泄漏。
  if (pendingStagedLayerNode) {
    const div = pendingStagedLayerNode;
    pendingStagedLayerNode = null;
    try {
      const f = div.querySelector && div.querySelector("iframe");
      if (f) disposeMediaEl(f);
    } catch { /* ignore */ }
    try { div.remove(); } catch { /* ignore */ }
  }
}

// ── Rotation group CRUD (draft-based editor) ────────────────────────────────
function startEditGroup(id) {
  const group = selection.rotationGroups.find((g) => g.id === id);
  if (!group) return;
  setTransient("editing", JSON.parse(JSON.stringify(group)));
  emit();
}

function startCreateGroup() {
  setTransient("editing", {
    id: nextGroupId(),
    name: weT("轮播列表 {index}", { index: selection.rotationGroups.length + 1 }),
    interval: DEFAULTS.rotationInterval,
    order: "sequence",
    wallpaperIds: [],
  });
  emit();
}

function saveEditingGroup() {
  const draft = selection.editing;
  if (!draft) return;
  const idx = selection.rotationGroups.findIndex((g) => g.id === draft.id);
  const cleaned = {
    id: draft.id,
    name: typeof draft.name === "string" && draft.name.trim() ? draft.name.trim() : weT("轮播列表"),
    interval: clampNum(draft.interval, ...schemaRange("rotationInterval"), DEFAULTS.rotationInterval),
    order: draft.order === "random" ? "random" : "sequence",
    wallpaperIds: Array.isArray(draft.wallpaperIds)
      ? draft.wallpaperIds.filter((x) => typeof x === "string" && x)
      : [],
  };
  if (idx >= 0) selection.rotationGroups[idx] = cleaned;
  else selection.rotationGroups.push(cleaned);
  selection.rotationGroupId = cleaned.id;
  setTransient("editing", null);
  // 列表成员可能已变：进行中的轮换准备候选作废，下轮按新成员重评。
  cancelRotationPrepare();
  if (selection.rotationEnabled && !rotationCandidates().some((w) => w.id === selection.id)) {
    const first = rotationCandidates()[0];
    applySelection(first ? first.id : "");
    return;
  }
  persistSelection();
  syncRotationTimer();
  emit();
}

function cancelEditGroup() {
  setTransient("editing", null);
  emit();
}

function deleteGroup(id) {
  const idx = selection.rotationGroups.findIndex((g) => g.id === id);
  if (idx < 0) return;
  selection.rotationGroups.splice(idx, 1);
  // 列表结构变化：进行中的轮换准备候选可能已不在活动列表 → 取消，下轮重评。
  cancelRotationPrepare();
  if (selection.rotationGroupId === id) {
    selection.rotationGroupId = "";
    if (selection.rotationEnabled) {
      const fallback = firstUsableGroup();
      if (fallback) selection.rotationGroupId = fallback.id;
      else selection.rotationEnabled = false;
    }
  }
  if (selection.editing && selection.editing.id === id) setSetting("editing", null);
  syncRotationTimer();
  emit();
}

function importPlaylistIntoDraft(playlist) {
  if (!selection.editing || !playlist || !Array.isArray(playlist.wallpaperIds)) return;
  selection.editing.wallpaperIds = playlist.wallpaperIds.slice();
  emit();
}


// ── Hidden wallpapers (soft delete / restore, localStorage only) ───────────
// Hiding is a pure status flag: no source file is touched, and a hidden
// wallpaper that is currently playing keeps playing (it only leaves the
// lists). Rotation candidates exclude hidden ids via groupWallpapers(), so a
// hidden wallpaper can never be auto-selected by the carousel. The membership
// test itself lives in **src/picker-model.js**（`isHiddenWallpaper(id, hiddenIds)`）——
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

// ── Custom uploads (read-A storage) ─────────────────────────────────────────
// The HOST writes the uploaded bytes to its plugin-managed directory and
// serves them through the same token/media/preview routes as WE media; the
// client only POSTs the file, then refreshes the (already-merged) inventory.
const UPLOAD_URL = "/wallpaper-engine/upload";
const REMOVE_URL = "/wallpaper-engine/remove";
const UPLOAD_TYPES = ["image/jpeg", "image/png", "video/mp4"];

// `isUploadedWallpaper(w)` / `isDirWallpaper(w)`（id 前缀判定）住在
// **src/picker-model.js** —— ratingOf 的宽松分级与上传管理列表共用同一对判定。

async function uploadWallpaperFile(file) {
  const ctype = (file.type || "").toLowerCase();
  if (!UPLOAD_TYPES.includes(ctype)) {
    setTransient("uploadError", weT("仅支持 JPG / PNG 图片与 MP4 视频"));
    emit();
    return;
  }
  if (!/\.(jpe?g|png|mp4)$/i.test(file.name)) {
    setTransient("uploadError", weT("文件扩展名需为 .jpg / .png / .mp4"));
    emit();
    return;
  }
  setTransient("uploading", true);
  setTransient("uploadError", "");
  setTransient("uploadNote", "");
  emit();
  try {
    const title = file.name.replace(/\.[^.]+$/, "").slice(0, 80);
    const res = await apiFetch(UPLOAD_URL + "?title=" + encodeURIComponent(title), {
      method: "POST",
      headers: { "Content-Type": ctype },
      body: file,
      parse: "always", // 失败时也要读宿主给的原因（4xx/5xx 的 {error}）
    });
    const data = res.data || {};
    if (!res.ok) throw new Error(hostFailureReason(res));
    // Host dedup: uploading the same file again returns the existing entry
    // (data.duplicate) instead of storing a second copy.
    if (data.duplicate) {
      setTransient("uploadNote", weT("已存在相同内容的壁纸，已直接选择原有的那张"));
    }
    await loadInventory();
    applySelection(data.id);
  } catch (err) {
    setTransient("uploadError", weT("上传失败：{error}", { error: weT(err && err.message ? err.message : err) }));
  }
  setTransient("uploading", false);
  emit();
}

async function removeUploadWallpaper(id) {
  if (!id) return;
  setTransient("uploading", true);
  setTransient("uploadError", "");
  emit();
  try {
    const res = await apiPostJson(REMOVE_URL, { id }, { parse: "always" });
    if (!res.ok) throw new Error(hostFailureReason(res));
    if (selection.id === id) applySelection("");
    await loadInventory();
  } catch (err) {
    setTransient("uploadError", weT("移除失败：{error}", { error: weT(err && err.message ? err.message : err) }));
  }
  setTransient("uploading", false);
  emit();
}

const UPLOAD_DIR_URL = "/wallpaper-engine/upload-dir";

// Change where custom uploads are stored. The host persists the choice to its
// config file (survives restarts) and migrates existing files by default —
// users can point uploads at a non-system drive without touching config files.
async function changeUploadDir(dir, migrate) {
  if (!dir || !String(dir).trim()) {
    setTransient("uploadError", weT("请输入存储位置路径"));
    emit();
    return;
  }
  setTransient("uploading", true);
  setTransient("uploadError", "");
  emit();
  try {
    const res = await apiPostJson(UPLOAD_DIR_URL,
      { dir: String(dir).trim(), migrate: migrate !== false }, { parse: "always" });
    if (!res.ok) throw new Error(hostFailureReason(res));
    setTransient("editingUploadDir", false);
    setTransient("uploadDirDraft", "");
    await loadInventory();
  } catch (err) {
    setTransient("uploadError", weT("更改失败：{error}", { error: weT(err && err.message ? err.message : err) }));
  }
  setTransient("uploading", false);
  emit();
}

const CACHE_DIR_URL = "/wallpaper-engine/cache-dir";
const CACHE_DIR_BROWSE_URL = "/wallpaper-engine/cache-dir/browse";

// Change where regenerable caches live (transcoded wallpapers / faststart variants /
// scene frames / video previews / media-bridge). The host persists the choice to its
// config file (survives restarts) and moves the known cache subdirectories by default —
// the point is not making users edit config files, and not letting a multi-GB cache
// pile up on the system drive. Nothing here is user-authored data: worst case the
// moved-away cache is rebuilt on demand.
async function changeCacheDir(dir, migrate) {
  if (!dir || !String(dir).trim()) {
    setTransient("cacheDirError", weT("请输入缓存位置路径"));
    emit();
    return;
  }
  setTransient("cacheDirError", "");
  setTransient("cacheDirNote", "");
  setTransient("cacheDirBusy", true);
  emit();
  try {
    const res = await apiPostJson(CACHE_DIR_URL,
      { dir: String(dir).trim(), migrate: migrate !== false }, { parse: "always" });
    if (!res.ok) throw new Error(hostFailureReason(res));
    const moved = Number((res.data && res.data.migrated) || 0);
    const skipped = Number((res.data && res.data.skipped) || 0);
    setTransient("editingCacheDir", false);
    setTransient("cacheDirDraft", "");
    setTransient("cacheDirBrowse", null);
    // 生效值一律以 host 的解析链为准（重新拉清单回显）—— 设了 DSH_WE_CACHE_DIR 时
    // 保存成功但生效值仍是环境变量那个目录，这条提示就是给那种情形看的。
    setTransient("cacheDirNote", skipped > 0
      ? weT("已迁移 {moved} 个缓存文件，{skipped} 个跳过", { moved, skipped })
      : weT("已迁移 {moved} 个缓存文件", { moved }));
    await loadInventory();
  } catch (err) {
    setTransient("cacheDirError", weT("更改失败：{error}", { error: weT(err && err.message ? err.message : err) }));
  }
  setTransient("cacheDirBusy", false);
  emit();
}

const WE_ASSETS_DIR_URL = "/wallpaper-engine/we-assets-dir";

// Set / clear the WE official-assets directory (host-persisted). Scene live
// rendering then serves official pixels via /api/local-assets instead of the
// renderer's programmatic recreations. Empty input clears the setting.
// 保存后刷新 inventory（weAssetsAvailable 进 syncLayers key）→ live 渲染页
// 带新参数重建，官方像素即刻生效。
async function changeWeAssetsDir(dir) {
  setTransient("weAssetsError", "");
  emit();
  try {
    const res = await apiPostJson(WE_ASSETS_DIR_URL,
      { dir: String(dir || "").trim() }, { parse: "always" });
    if (!res.ok) throw new Error(hostFailureReason(res));
    setTransient("editingWeAssetsDir", false);
    setTransient("weAssetsDirDraft", "");
    await loadInventory();
    syncLayers(); // 可用性变化进 key → live iframe 带/去 localAssets=1 重建
  } catch (err) {
    setTransient("weAssetsError", weT("保存失败：{error}", { error: weT(err && err.message ? err.message : err) }));
  }
  emit();
}

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
// 助手声明在 src/client-media-frame.js：它们自带的模块级变量（媒体计时器、GPU 帧 pin、画布 ctx 句柄…）
// 与各自的赋值点同处一文件；本文件保留「壁纸属性」的开关与快照状态（propsPanelOpen / propsState），
// 因为改这两个状态的处理器（openUserPropsPanel / closeUserPropsPanel）仍在本文件。
// ── 壁纸属性（WE 用户属性）──────────────────────────────────────────────────
// 「壁纸属性」按钮 → 面板：读 host `/props/<token>`（把 project.json 的
// general.properties 解析成 UI 描述），改动即时 `__wp.updateWebProps` 热更新到
// 正在跑的壁纸，并写进设置（`userProps`，按 token 存）—— 刷新/重启后网页壁纸由
// host 并进 HTML 种子、场景壁纸由 applyStoredUserProps 在就绪后回放。
//
// 条件求值器已抽到 src/we-cond.js（纯计算、零外界依赖；构建期由 build-client.mjs
// 内联回本作用域，因此下面的 weEvalCondition(...) 调用点无需改动，见该文件头的契约）。

// 面板状态：token 变了就重新拉一次（换壁纸/换目录）。
let propsPanelOpen = false;
let propsState = { token: "", loading: false, error: "", props: [], remote: false };


/** 打开发送（侧栏下钻的入口）：先落状态再拉定义 —— 判据是"该有属性了"。 */
function openUserPropsPanel() {
  propsPanelOpen = true;
  loadUserPropDefs(propTokenOf(selection), true);
  emit();
}

/** 收起：只翻开关（定义留着，下次开不必重拉）。 */
function closeUserPropsPanel() {
  propsPanelOpen = false;
  emit();
}

/** 当前 live 渲染 iframe（属性热更新与心跳读的是同一个）。 */

/** token（propsUrl 末段；同时是设置里 userProps 的键）。 */
function propTokenOf(selLike) {
  const url = String((selLike && selLike.propsUrl) || "");
  const i = url.lastIndexOf("/");
  return i >= 0 ? url.slice(i + 1) : "";
}

function storedUserPropsOf(token) {
  const all = selection.userProps;
  const v = all && typeof all === "object" ? all[token] : null;
  return v && typeof v === "object" && !Array.isArray(v) ? { ...v } : {};
}

/** 覆盖值写入设置（与默认值相同 = 删除该覆盖项）。 */
function saveUserProp(token, name, value, isDefault) {
  if (!token) return;
  const all = { ...(selection.userProps || {}) };
  const cur = { ...(all[token] || {}) };
  if (isDefault) delete cur[name];
  else cur[name] = value;
  if (Object.keys(cur).length) all[token] = cur;
  else delete all[token];
  setSetting("userProps", all);
}

/** 热更新到正在跑的壁纸（渲染页 __wp.updateWebProps → 场景对象脚本 / 网页 shim）。 */
function applyUserProps(wire) {
  const frame = liveFrameEl();
  if (!frame) return false;
  try {
    const wp = frame.contentWindow && frame.contentWindow.__wp;
    if (!wp || typeof wp.updateWebProps !== "function") return false;
    wp.updateWebProps(wire);
    return true;
  } catch {
    return false;
  }
}

function loadUserPropDefs(token, force) {
  if (!token) return;
  if (!force && (propsState.token === token && (propsState.props.length || propsState.loading))) return;
  const url = PROPS_URL + "/" + encodeURIComponent(token);
  propsState = { token, loading: true, error: "", props: propsState.token === token ? propsState.props : [], remote: true };
  apiJson(url)
    .then((res) => {
      const d = res.data;
      // ⚠️ 这条 message 会被渲染进「壁纸属性」面板（见 picker-props-panel.js 的 error 分支），
      //    所以它是**面向用户**的文案，尽管包在 Error 里。裸中文字面量会被 i18n-scan 的
      //    Error 豁免放过 —— 用 weT 包住，改文案时才有词表口径可循。
      if (!d || !d.ok) throw new Error((d && d.error) || weT("读取失败"));
      if (propsState.token !== token) return; // 期间换了壁纸：丢弃
      // 值以渲染页的实时表为准（场景壁纸的默认值在 scene.json 快照里，可能和
      // project.json 不同 —— 上游 getProperties 正是为此存在）；拿不到就用宿主值。
      let live = null;
      try {
        const frame = liveFrameEl();
        const wp = frame && frame.contentWindow && frame.contentWindow.__wp;
        live = wp && typeof wp.getProperties === "function" ? wp.getProperties() : null;
      } catch { live = null; }
      const props = (d.props || []).map((p) => {
        if (!live || !(p.name in live)) return p;
        return { ...p, value: live[p.name], overridden: Boolean(d.overrides && p.name in d.overrides) };
      });
      propsState = { token, loading: false, error: "", props, remote: false };
      emit();
    })
    .catch((e) => {
      if (propsState.token !== token) return;
      propsState = { token, loading: false, error: String((e && e.message) || e), props: [], remote: false };
      emit();
    });
}

/** 一次属性改动：本地状态 + 热更新 + 持久化（silent = 拖动中不重渲染）。 */
function onUserPropInput(def, value, silent) {
  def.value = value;
  def.overridden = !sameUserPropValue(value, def.default);
  applyUserProps({ [def.name]: { value } });
  saveUserProp(propsState.token, def.name, value, !def.overridden);
  if (!silent) emit();
}

function sameUserPropValue(a, b) {
  if (a === b) return true;
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return false;
}

/** 恢复默认：清掉这张壁纸的全部覆盖值，并把默认值热更新回渲染页。 */
function resetUserProps() {
  const token = propsState.token;
  if (!token) return;
  const wire = {};
  for (const p of propsState.props) {
    p.value = p.default;
    p.overridden = false;
    if (p.default !== null) wire[p.name] = { value: p.default };
  }
  applyUserProps(wire);
  const all = { ...(selection.userProps || {}) };
  delete all[token];
  setSetting("userProps", all);
  emit();
}

/** 就绪后回放覆盖值：网页壁纸由 host 并进 HTML 种子，场景壁纸没有种子通道。 */
function applyStoredUserProps(selLike) {
  if (!selLike) return;
  const token = propTokenOf(selLike);
  if (!token) return;
  const ov = storedUserPropsOf(token);
  const names = Object.keys(ov);
  if (!names.length) return;
  const wire = {};
  for (const [k, v] of Object.entries(ov)) wire[k] = { value: v };
  applyUserProps(wire);
}

/** Web 颜色 "r g b"（0–1 浮点）↔ #rrggbb */
function weColorToHex(v) {
  if (typeof v !== "string") return "#000000";
  const parts = v.trim().split(/\s+/).map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return "#000000";
  const hex = parts.slice(0, 3)
    .map((n) => Math.max(0, Math.min(255, Math.round(n * 255))).toString(16).padStart(2, "0"))
    .join("");
  return "#" + hex;
}
function weHexToColor(hex) {
  const h = String(hex || "").replace(/^#/, "");
  if (h.length !== 6) return "0 0 0";
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return [r, g, b].map((n) => Math.round(n * 1000) / 1000).join(" ");
}

let weBattery = null; // BatteryManager from navigator.getBattery (if available)
// 遮挡原因（可读文案；空串 = 没被遮挡）。occlusionActive 由它派生，保证「是谁把
// 渲染页停掉的」只有一个判定源 —— 诊断日志直接引用；失焦档再经适配目标门控（桌面壳失焦时壁纸多半仍整块可见，按失焦暂停会定格**可见**画面，见 adapterCaps）。
function occlusionReason() {
  if (selection.pauseOnHidden && typeof document !== "undefined" && document.hidden) return weT("标签页隐藏(pauseOnHidden)");
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
// 「live 渲染页为什么没在出帧」的一句话原因：用户暂停与遮挡都算 —— 两者都会让
// applyLiveControls 把渲染页 pause() 掉，而暂停中的渲染页 __wpStats.frame()
// 恒为 {fps:0, running:false}（渲染器实现：paused → running:false）。
function livePauseReason() {
  if (selection.playing) {
    // 遮挡暂停（X11 矩形遮挡 ⇒ 渲染器 pause 档）也是"故意不出帧"：必须让看护
    //（首帧预算 / stall 计数 / 载荷延迟）与 UI 归因都看见它，否则全遮挡下轮播
    // 换页会把故意暂停误判成传输停滞并自动回退（实测事故，2026-10-12）。
    if (occlusionRendererPaused()) return weT("窗口被完全遮挡(pauseOnOcclusion)");
    return occlusionReason();
  }
  return weT("用户暂停");
}
function isEffectivelyPlaying() {
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
// 声明在 src/client-audio-playback.js：期望音量与元素音量写入、轮换音频闸、层内媒体元素枚举、
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
function readSavedPickerTab() {
  try {
    let v = localStorage.getItem(PICKER_TAB_KEY);
    if (v && PICKER_TAB_LEGACY[v]) v = PICKER_TAB_LEGACY[v];
    if (v && PICKER_TABS.some((t) => t.id === v)) return v;
  } catch { /* ignore */ }
  return "library";
}

// ── 设置页「全局字体」节的折叠态（ADR-0008 D4 三次修订，2026-10-11）──────────────
// 那个节**两档都画**（侧栏 + 设置页），但两档各有自己的开合状态 —— 与 `qp-tab` /
// `picker-tab` 同一条"每档各自的 UI 状态"口径。只存 localStorage，**不进 config.json**
// （它不是设置，是视图状态）。
// ⚠️ 2026-10-11 二次修订：设置页**默认全展开**（用户口径「设置页则是全部开启但也支持隐藏」）。
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

// ── 设置页「全局 UI 配色」节的折叠态（2026-10-11；同批二次修订为默认展开）──────────
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

// ── 设置页「细节 / 玻璃 UI / 侧边栏圆角 / 主题预设」四节的折叠态（2026-10-11 二次修订）──────────
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

// ── 仓库 star 数（「关于」页签那行「⭐ 当前 N star」）────────────────────────────
// 数据由宿主代取（lib/routes/github-stars.js：只读一条腿、10 分钟 TTL、落盘缓存兜底、
// 失败静默），客户端只管"什么时候问一次"与"怎么显示"。**不是设置**：不进 selection、
// 不落盘 —— 换机器 / 清缓存都只是重新取一次，没有需要持久化的用户意图。
// 与宿主同一量级的 TTL：避免每次重渲染、每次切页签都打一次网络（GitHub 未认证限流
// 60 次/小时 **整机共享**）。失败不写 at ⇒ 下次切到关于页立刻重试（失败不该被冷却）。
const STAR_COUNT_TTL = 10 * 60 * 1000;
let starCount = { value: null, at: 0, busy: false, tried: false };
function loadStarCount(force) {
  if (starCount.busy) return;
  if (!force && starCount.tried && Date.now() - starCount.at < STAR_COUNT_TTL) return;
  starCount = { value: starCount.value, at: starCount.at, busy: true, tried: true };
  apiJson("/star-count")
    .then((res) => {
      const d = res && res.data;
      const n = d && d.ok && Number.isFinite(d.count) ? d.count : null;
      // 冷却用**本地**时间戳（不是宿主的 fetchedAt）：宿主的缓存可能本身就是上一次的
      // 旧值（离线兜底那条腿），拿它当年龄会让客户端每次切页签都去问一次 —— 冷却的意义
      // 是"别重复问"，数据到底多旧由宿主那一层的 TTL 负责。
      starCount = { value: n, at: n == null ? 0 : Date.now(), busy: false, tried: true };
      emit();
    })
    .catch(() => {
      starCount = { value: null, at: 0, busy: false, tried: true };
      emit();
    });
}
// 那行字的唯一出处（渲染器直接读它 —— 与 SliderRow 一类模块级助手同口径）。
// 三种态各有明确文案：还没问过 ⇒ 空串（不占位）、正在问 ⇒ 说明在取、取不到 ⇒ 如实说。
function starCountLabel() {
  if (starCount.busy && starCount.value == null) return weT("⭐ 正在获取 star 数…");
  if (starCount.value != null) {
    return weT("⭐ 当前 {count} star", { count: Number(starCount.value).toLocaleString("en-US") });
  }
  if (starCount.tried) return weT("⭐ 暂时取不到 star 数");
  return "";
}

// 滑杆右侧那格「数值区」的可输入形态（SliderRow 的 opts.numberEdit 用它）。
//
// 为什么单独一个组件、并且**编辑期不受控**：受控写法（value 由设置渲染、每敲一键就写设置）
// 在"删空重打"这一路会自锁 —— 退格把框清成空串，空串不是合法值 ⇒ 不写设置 ⇒ React 又把旧值
// 渲回去，用户看到的是"数字删不掉"（实测反馈原话：「我在输入框里不能删除已有数字」）。所以：
//   · 未编辑（聚焦前）：value = 设置值，跟着滑杆拖动 / 别处改动同步显示；
//   · 编辑中：自己管自己（defaultValue + 本地 draft），**空串也是合法中间态**，随便删；
//   · 回车 / 失焦：夹取到 [min, max] 后交给同一个处理器（第二参 false = 完整路径），并收起
//     draft 回到受控 —— 值真被拒（越界回落默认）时也能立刻看到真实值。
// draft 只在编辑期覆盖显示，"删空 + 回车"于是回落设置值，而不是把 0 写进去。
function NumberValueInput(props) {
  const { label, min, max, step, unit, value, onCommit, title } = props;
  const [draft, setDraft] = React.useState(null);
  const editing = draft !== null;
  const commit = (raw) => {
    setDraft(null);
    const s = String(raw == null ? "" : raw).trim();
    if (s === "") return;                       // 空 = 放弃这次编辑，保留原值
    const n = Number(s);
    if (!Number.isFinite(n)) return;
    onCommit(Math.max(Number(min), Math.min(Number(max), n)));
  };
  return React.createElement("input", {
    className: "we-picker__value-input", type: "number",
    min: String(min), max: String(max), step: String(step),
    title: title || undefined,
    "aria-label": label + " " + unit,
    ...(editing ? { defaultValue: draft } : { value: String(value) }),
    onFocus: () => { if (!editing) setDraft(String(value)); },
    onInput: (e) => setDraft(e.currentTarget.value),
    onBlur: (e) => commit(e.currentTarget.value),
    onKeyDown: (e) => {
      if (e.key === "Enter") { commit(e.currentTarget.value); e.currentTarget.blur(); }
    },
  });
}

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
  // 旧调用点不传它就还是原来的只读回显。
  const numberEdit = Boolean(opts.numberEdit) && !preformatted;
  // 拖动期的轨道填充与**数值回显**：就地改这一行的 --we-fill 与右侧数值文本
  //（**局部 DOM 写，不触发 React 渲染**）。抬手那一次仍走完整 emit（含落盘），
  // 于是慢帧下也不会出现"数字跟不上滑块"的空档。
  const liveFill = (el) => {
    try {
      const lo = Number(el.min); const hi = Number(el.max); const v = Number(el.value);
      const pct = hi > lo ? Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100)) : 0;
      el.style.setProperty("--we-fill", pct + "%");
      const row = el.parentNode;
      const out = row && typeof row.querySelector === "function" ? row.querySelector(".we-picker__value") : null;
      // 预格式化口径不做拖动期就地改写 —— 保持原有的既有观感
      //（放手后的 emit 重渲染会给出正确文本）。
      // 缺元素 / 预格式化整串：什么都不做。
      if (out && !preformatted) out.textContent = readout(el.value);
      else return;
      // numberEdit 口径下右侧是 <input>：它有**自己的 value 属性** ⇒ 改走 value，
      // 且必须在上面那次 textContent 之后**判形态再覆盖**（写 textContent 会把
      // React 的子节点删掉，下一次 emit 就崩）。非输入框元素没有 value，无害。
      if (typeof out.value === "string") out.value = String(el.value);
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
let pickerOpener = null;
// eslint-disable-next-line prefer-const -- 跨片段写入：panel-tabs-effects.js:175
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

// ── 壁纸库页签的处理器（渲染器只读值 + 调这些）────────────────────────────────
// `src/panel-tabs.js` 的契约是「只读 + 组装 React 树」：**写设置 / 改状态 / 发通知都归这里**。
// 下面这些处理器是 ctx 的**供给方**（同模态框 / 属性面板那条契约）：渲染器只读值 + 调它们，
// 本身不引用 `selection` / `emit`，也不写本文件模块作用域的 `propsPanelOpen` /
// `pickerFocusPending` / `pickerOpener`（**别人的状态**）。
// 判据：`test/verify-client.mjs` 的接缝判据（页签与那两个渲染器同一条口径）。
function setPickerOpener(el) { pickerOpener = el; }
function onTogglePropsPanel() {
  propsPanelOpen = !propsPanelOpen;
  if (propsPanelOpen) loadUserPropDefs(propTokenOf(selection), true);
  emit();
}
/** 两个「选择壁纸」入口只差草稿标志：普通下钻（点卡片即应用）与轮播编辑器的草稿下钻。 */
function openPicker(draft) {
  setTransient("pickerOpen", true);
  setTransient("pickerDraft", draft);
  setTransient("modalView", "normal");
  pickerFocusPending = true; // 打开后焦点落入下钻视图（见 modalInitialFocus）
  emit();
}
function onOpenPicker() { openPicker(false); }
function onOpenPickerDraft() { openPicker(true); }
// 轮播列表编辑器的**草稿**（住在 selection.editing；保存才由 saveEditingGroup 落盘）。
function onEditName(e) {
  if (selection.editing) { selection.editing.name = e.target.value; emit(); }
}
function onEditInterval(e) {
  if (!selection.editing) return;
  selection.editing.interval = clampNum(Number(e.target.value), ...schemaRange("rotationInterval"), DEFAULTS.rotationInterval);
  emit();
}
function onEditOrder(e) {
  if (selection.editing) { selection.editing.order = e.target.value; emit(); }
}
// 两个可编辑路径（上传目录 / 官方资源路径）的**草稿**状态 —— 都在 selection 的瞬态字段里。
function onStartEditUploadDir() {
  setTransient("editingUploadDir", true);
  setTransient("uploadDirDraft", selection.inventory.uploadDir || "");
  emit();
}
function onUploadDirDraft(e) { setTransient("uploadDirDraft", e.target.value); emit(); }
function onCancelEditUploadDir() { setTransient("editingUploadDir", false); emit(); }
function onCacheDirDraft(e) { setTransient("cacheDirDraft", e.target.value); emit(); }
// 缓存位置（高级页签）的草稿态 —— 与上传目录同口径：生效值从 inventory 取。
// 「更改」= 打开草稿行（保留确认/迁移提示那一步）**并**弹出目录浏览器 —— 网页拿不到
// 原生选择框（给不了绝对路径），这块面板就是等价物：宿主列目录、用户点着进出。
function onStartEditCacheDir() {
  setTransient("editingCacheDir", true);
  setTransient("cacheDirDraft", selection.inventory.cacheDir || "");
  setTransient("cacheDirError", "");
  setTransient("cacheDirNote", "");
  openCacheDirBrowse(selection.inventory.cacheDir || "");
  emit();
}
function openCacheDirBrowse(path) {
  setTransient("cacheDirBrowse", {
    path: path || "", display: path || "", dirs: [], parent: null,
    home: "", truncated: false, loading: true, error: "",
  });
  browseCacheDir(path);
}
function onCloseCacheDirBrowse() { setTransient("cacheDirBrowse", null); emit(); }
function onCacheDirBrowseInput(e) {
  const b = selection.cacheDirBrowse;
  if (b) setTransient("cacheDirBrowse", { ...b, display: e.target.value });
  emit();
}
function onCacheDirBrowseGo() {
  const b = selection.cacheDirBrowse;
  if (b) browseCacheDir(b.display);
}
function onCacheDirBrowseEnter(entryPath) { browseCacheDir(entryPath); }
function onCacheDirBrowseUp() {
  const b = selection.cacheDirBrowse;
  if (b && b.parent) browseCacheDir(b.parent);
}
// 选中：地址栏草稿（改了没跳转也算数）填进 cacheDirDraft，收起浏览器 —— 保存/迁移
// 语义仍在草稿行那一步（与上传目录同族口径：选完还要按保存）。
function onPickCacheDir() {
  const b = selection.cacheDirBrowse;
  const picked = b ? String(b.display || b.path || "").trim() : "";
  if (picked) setTransient("cacheDirDraft", picked);
  setTransient("cacheDirBrowse", null);
  setTransient("editingCacheDir", true);
  emit();
}
// 拉一级目录列表（根视图传空）。失败**保住旧列表**只亮错误行：浏览是辅助，
// 不能因为一次读失败把用户已经走到的位置丢掉。
async function browseCacheDir(path) {
  const prev = selection.cacheDirBrowse || {};
  setTransient("cacheDirBrowse", { ...prev, path: path || "", loading: true, error: "" });
  emit();
  try {
    const q = path ? "?path=" + encodeURIComponent(path) : "";
    const res = await apiJson(CACHE_DIR_BROWSE_URL + q, { parse: "always" });
    if (!res.ok) throw new Error(hostFailureReason(res));
    const d = res.data || {};
    setTransient("cacheDirBrowse", {
      path: d.current || "",
      display: d.current || "",
      home: d.home || "",
      dirs: Array.isArray(d.dirs) ? d.dirs : [],
      parent: d.parent || null,
      truncated: d.truncated === true,
      loading: false,
      error: "",
    });
  } catch (err) {
    setTransient("cacheDirBrowse", {
      ...prev,
      loading: false,
      error: weT("无法读取该目录：{error}", { error: weT(err && err.message ? err.message : err) }),
    });
  }
  emit();
}
function onCancelEditCacheDir() {
  setTransient("editingCacheDir", false);
  setTransient("cacheDirBrowse", null);
  setTransient("cacheDirError", "");
  emit();
}
function onStartEditWeAssetsDir() {
  setTransient("editingWeAssetsDir", true);
  setTransient("weAssetsDirDraft", selection.inventory.weAssetsDir || "");
  setTransient("weAssetsError", "");
  emit();
}
function onWeAssetsDirDraft(e) { setTransient("weAssetsDirDraft", e.target.value); emit(); }
function onCancelEditWeAssetsDir() {
  setTransient("editingWeAssetsDir", false);
  setTransient("weAssetsError", "");
  emit();
}

// ── 外观 / 播放 / 系统页签的处理器（同上一条：渲染器只读值 + 调这些）────────────
function onLeftSidebarGlass(e) { setSetting("leftSidebarGlass", e.target.checked); emit(); }

// ── 侧边栏四角圆角 / 直角（外观 → 侧边栏圆角）────────────────────────────────
// 键名表**只此一份**：面板按 (side, corner) 调，批量化也读它 —— 手抄第二份必然漂。
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
/** 批量：四角一起直角 / 一起回到统一档（只 emit 一次，别让四个键各刷一遍）。 */
function onSidebarAllCorners(side, square) {
  const table = SIDEBAR_CORNER_KEYS[side];
  if (table) for (const key of Object.values(table)) setSetting(key, square === true);
  emit();
}
// 标题栏液态玻璃（titlebarGlass）：与左侧栏同一形状的**乙类**总开关 —— 门控属性挂在
// src/glass.js（本文件只翻存储键，切换不重建任何东西）。
function onTitlebarGlass(e) { setSetting("titlebarGlass", e.target.checked); emit(); }
// 「思考块液态玻璃」三挡分段（关 / 液态玻璃 / 原生）：一次写两键 —— 原生挡赢过玻璃挡的
// 互斥由 effects.js 的门控属性保证（thinkingNative ⇒ 不挂 data-we-thinking-glass），
// 这里让存储两键与所选拍始终一致（不留给手改 config 4 种组合里的矛盾态）。
function onThinkingMode(mode) {
  setSetting("thinkingGlass", mode === "glass");
  setSetting("thinkingNative", mode === "native");
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

// ── 以下处理器模块级 —— 快捷播放面板（src/quick-panel.js）与设置页**共用同一批处理器**。
//    ⚠️ 分档（ADR-0008 D4）：侧栏档只画**简化配置**（全局四件套 + 各面总开关），
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
// 侧栏全透明（issue #137）：显式放弃可读性下限。与 onSidebarGlass 同形 —— 门控属性
//（data-we-sidebar-fullclear）由 applyGlass 挂/摘，CSS 那组规则只认属性。
function onSidebarFullClear(e) { setSetting("sidebarFullClear", e.target.checked); emit(); }

// ── 「玻璃 UI」各子项的「独立配置」开关（写的是**模式**）───────────────────
// ⚠️ 只有 `glassMode` 一个键：能读自己的值这件事，由"注册表 params ↔ 接线点"（守卫 ④）
//    与"写了必须被 CSS 读到"（⑬）保证。
function onToggleChildIndependent(id, on) {
  const next = Object.assign({}, selection.glassMode);
  if (on) next[id] = "custom"; else delete next[id];
  setSetting("glassMode", next);
  emit();
}
/** 某一个子项的「独立配置」是否已开（**只看模式**）。 */
function childIndependentOn(id) {
  return !!(selection.glassMode && selection.glassMode[id] === "custom");
}
// 子 UI 独立参数：直接写它自己的键（键名由 childGlassKey 生成，与 schema 同源）。
function onGlassChildParam(id, param, value) { setSetting(childGlassKey(id, param), value); emit(); }
// 场景 / 网页实时渲染的总开关就是**显式重试入口**：除写设置外还要清空全部失败记忆
//（含**会话内**的传输类软失败 —— 它不在设置里），并重建层与音频互斥态。
// 五件事必须一起发生，所以它是一个处理器，而不是渲染器里的五行。
function onToggleSceneLive(e) {
  setSetting("sceneLive", e.target.checked);
  setSetting("sceneLiveFailures", {});
  prepareLiveTimeouts.clear(); // 准备期 live 超时冷却一并清零
  clearLiveSessionFailures();  // 会话内的传输类软失败同样要清
  syncLayers();                // key 的 live 段变化 → 层重建（升级/降级）
  syncSceneAudio(selection);   // 音频互斥状态随形态切换
  emit();
}
function onLiveBootDelay(secs) { setSetting("liveBootDelay", secs); emit(); }
function onSceneLiveFps(f) { setSetting("sceneLiveFps", f); syncLayers(); emit(); }
function onPlaybackRate(rate) { setSetting("playbackRate", rate); emit(); }
function onFpsCap(cap) {
  // 用户主动改上限：这一轮抽帧升级允许当场换源（自动触发的那一轮不允许，见 upgradeByUser）。
  try { noteFpsCapChange(); } catch { /* ignore */ }
  setSetting("fpsCap", cap);
  refreshMediaInfo(true);
  emit();
}
function onFlip(e) { setSetting("flip", e.target.checked); emit(); }
function onAdapterTarget(e) { setSetting("adapterTarget", e.target.value); emit(); }
function onPauseOnHidden(e) { setSetting("pauseOnHidden", e.target.checked); emit(); }
function onPauseOnBlur(e) { setSetting("pauseOnBlur", e.target.checked); emit(); }
function onPauseOnBattery(e) { setSetting("pauseOnBattery", e.target.checked); emit(); }
function onToggleLiveDiag() { toggleLiveDiag(); emit(); }
// ── 「扩展」页签（一号模块：点击效果与拖尾效果）的处理器 ──────────────────────
// 形状与上面一致：控件只报事件，写设置 + 重渲染都在这里。那一层没有网络往返、"点了就有反应"是
// 每帧现读设置 ⇒ 开关与档位走 emit 的完整路径，滑块走 commitLiveSetting 的 live 档
// （拖动时即时可见，抬手才落盘 + emit）。
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
// 界面整块与壁纸同向），要换向改 src/parallax-layer.js 的 PARALLAX_DIRECTION / PARALLAX_UI_SIGN。
function onParallaxEnabled(e) { setSetting("parallaxEnabled", e.target.checked); emit(); }
function onParallaxMascot(e) { setSetting("parallaxMascot", e.target.checked); emit(); }
function onParallaxUi(e) { setSetting("parallaxUi", e.target.checked); emit(); }
// 插件前端那一整块自己的开关（用户诉求 m03549）：**独立于「界面元素跟随」**（两件事互不牵连）、
// 默认关（它挪的是别的插件画出来的真实界面）。关掉时层一个插件组都不认 —— 不是"系数算成 0"，
// 而是连扫都不扫（见 src/parallax-layer.js 的 parallaxTargetsRefresh），表里的距离原样留着。
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
 *  它用 src/avatar-import.js 的 AVATAR_IMPORT_MAX_EDGE（1024）。 */
const IMAGE_IMPORT_MAX_EDGE = 512;
// 头像导入的两道闸（边长 1024 / 体积 4 MiB）、零解码尺寸探针与两层 MIME 清单全部住在
// `src/avatar-import.js` —— **纯函数**，因此 `test/verify-scene-live.mjs` 能 import 真实现、
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

// ── 「扩展」页签（一号模块：自定义会话头像）的处理器 ────────────────────────────
// 控件只报事件，写设置 + 重渲染都在这里。装饰层（src/avatar-layer.js）每收到一次 emit
// 就按当前设置重画一遍，所以：开关 / 导入 / 清除走完整路径（emit）；两个滑块走
// commitLiveSetting 的 live 档，但**额外补一次 syncAvatarLayer()** —— 那一层是 emit 的
// 订阅者（不 emit 就不会被叫到），而拖动时的即时反馈正是这个模块的主要看点。
function onAvatarEnabled(e) { setSetting("avatarEnabled", e.target.checked); emit(); }
function onAvatarSize(v, live) { commitLiveSetting("avatarSize", v, live); if (live) syncAvatarLayer(); }
function onAvatarRadius(v, live) { commitLiveSetting("avatarRadius", v, live); if (live) syncAvatarLayer(); }
// 上传裁切（issue #191 问题 1）：用户口径是"上传非正方形、或主体不在中央时效果很差"。
// 做法是**导入时先裁再传**（而不是存裁切参数第二次渲染）：
//   · 盘上那张就是裁完的方形图 ⇒ 预览、会话里、以及"以后任何读到它的地方"天然一致，
//     不存在"存了参数但某处忘了应用"的漏网点；
//   · **零新设置键**（不动 KINDS / 夹具 / 预设段），也就没有"预设带不带裁切参数"的语义问题。
// 代价：裁切是一次性的、事后不可再调（要重调就重新导入 —— 与"替换图片"同一条路）。
const AVATAR_CROP_VIEW = 260; // 弹窗取景框边长（px，与 CSS 里那格同值）
/** 待裁的原图（**内存**里，不是设置）：唯一消费者是当前这次弹窗。 */
let avatarCropPending = null;
/** 超限**被拦下**的原图（内存里）：用户在提示行点「自动压缩后导入」时走它。 */
let avatarOverflowPending = null;
/** 导入前的裁切弹窗：先让用户框选构图，确认后才真正上传。 */
function onAvatarPick(side) {
  // 收的格式 = 直传层 ∪ 仅光栅化层（AVATAR_PICK_ACCEPT 与两层清单同住 src/avatar-import.js）。
  pickImageFile((file) => onAvatarFileChosen(side, file), AVATAR_PICK_ACCEPT);
}
/**
 * 选好图之后的**第一站**：先过两道闸，再进裁切弹窗（`#185` 后续，用户口径 2026-10-13）。
 *
 * 顺序就是这道闸的全部价值 —— `avatarImportLimit` 只读文件头，**一次都不解码**；
 * 超限则当场拦下并记住这张图（`avatarOverflowPending`），让面板画一行提示 + 一枚
 * 「自动压缩后导入」。用户点它才真的解码 → 缩到 1024 → 无损重编（见 `onAvatarAutoCompress`）。
 */
async function onAvatarFileChosen(side, file) {
  if (!file) return;
  const type = String(file.type || "").toLowerCase();
  // 白名单两层都收；认不出的 MIME（或浏览器不给 type）仍放行给解码腿去判 ——
  // 这里只挡"明确不在清单里"的，别把扩展名不规范的图也一起拒了。
  const known = (IMAGE_DIRECT_ACCEPT + "," + IMAGE_RASTER_ACCEPT).split(",");
  if (type && !known.includes(type)) {
    setTransient("avatarOverflow", null);
    setTransient("avatarError", weT("仅支持 JPG / PNG / WebP / SVG / GIF / BMP / AVIF 图片"));
    emit();
    return;
  }
  const size = await probeImageSize(file);
  const verdict = avatarImportLimit(file, size);
  if (verdict.ok) {
    avatarOverflowPending = null;
    setTransient("avatarOverflow", null);
    await openAvatarCrop(side, file);
    return;
  }
  // 拦下：把"哪一条超了、实测多少"说清楚（笼统的"图太大"等于什么都没说）。
  avatarOverflowPending = { side: side, file: file };
  setTransient("avatarError", "");
  setTransient("avatarOverflow", {
    side: side,
    bytes: verdict.bytes,
    width: verdict.width,
    height: verdict.height,
    overBytes: verdict.overBytes,
    overEdge: verdict.overEdge,
    // 压缩后仍可能装不下的提示用得上（超大图压到 1024 也可能 > 4 MiB —— 见 ext-avatar 文案）。
    compressible: true,
  });
  emit();
}
/**
 * 「自动压缩后导入」：解码 → 缩到 1024 → **无损优先**重编（PNG，装不下才退 WebP）→ 进裁切弹窗。
 *
 * 为什么压在 1024 而不是更小：用户要的是"信息不丢失"，1024 是显示尺寸（72px）的 14 倍，
 * 肉眼与矢量几乎没有差别；PNG 优先则保证**像素级无损**（只有 PNG 真装不下时才退视觉无损的
 * WebP，并在面板上如实说明）。
 */
async function onAvatarAutoCompress() {
  const pending = avatarOverflowPending;
  if (!pending) return;
  setTransient("avatarCompressing", true);
  setTransient("avatarError", "");
  emit();
  try {
    const src = await decodeImageFile(pending.file);
    const shrunk = await downscaleDecoded(src, AVATAR_IMPORT_MAX_EDGE, pending.file, true);
    // 压缩结果包成 File 再进裁切弹窗：裁切腿吃的是 File（它要 type 与 size）。
    const name = "avatar-compressed." + (shrunk.blob.type === "image/png" ? "png" : "webp");
    const compressed = (typeof File === "function")
      ? new File([shrunk.blob], name, { type: shrunk.blob.type })
      : shrunk.blob;
    setTransient("avatarCompressing", false);
    avatarOverflowPending = null;
    setTransient("avatarOverflow", null);
    await openAvatarCrop(pending.side, compressed);
  } catch (err) {
    setTransient("avatarCompressing", false);
    setTransient("avatarError", weT("压缩失败：{error}", { error: err && err.message ? err.message : String(err) }));
    emit();
  }
}
/** 打开裁切弹窗（读原图尺寸 → 填瞬态 → 交给面板画）。 */
async function openAvatarCrop(side, file) {
  if (!file || !/^image\//.test(String(file.type || ""))) {
    setTransient("avatarError", weT("仅支持 JPG / PNG / WebP / SVG / GIF / BMP / AVIF 图片"));
    emit();
    return;
  }
  let url;
  try {
    const src = await decodeImageFile(file);
    const w = Number(src.width) || 0;
    const h = Number(src.height) || 0;
    if (src.close) { try { src.close(); } catch { /* ignore */ } }
    if (!w || !h) throw new Error(weT("读不出图片尺寸"));
    url = URL.createObjectURL(file);
  } catch (err) {
    setTransient("avatarError", weT("导入失败：{error}", { error: err && err.message ? err.message : String(err) }));
    emit();
    return;
  }
  // 待裁的原图**存在内存里**（不是设置）：它的唯一消费者是这次弹窗。
  avatarCropPending = { side: side, file: file };
  setTransient("avatarError", "");  setTransient("avatarCropSide", side);
  setTransient("avatarCropUrl", url);
  setTransient("avatarCropW", w);
  setTransient("avatarCropH", h);
  setTransient("avatarCropZoom", 1);
  setTransient("avatarCropX", 0);
  setTransient("avatarCropY", 0);
  emit();
}
/** 关掉裁切弹窗（撤掉预览 URL，**不上传**）。 */
function closeAvatarCrop() {
  const url = selection.avatarCropUrl;
  if (url) { try { URL.revokeObjectURL(url); } catch { /* ignore */ } }
  avatarCropPending = null;
  setTransient("avatarCropSide", "");
  setTransient("avatarCropUrl", "");
  setTransient("avatarCropW", 0);
  setTransient("avatarCropH", 0);
  setTransient("avatarCropZoom", 1);
  setTransient("avatarCropX", 0);
  setTransient("avatarCropY", 0);
  emit();
}
/**
 * 取景框里那张图的实际绘制几何（换算成"显示 px"）。
 *
 * 口径：方形取景框边长 `AVATAR_CROP_VIEW`；`zoom = 1` 时图**短边刚好铺满**取景框
 * （cover 语义 —— 再小就会在框里露白），放大只增不减。`x` / `y` 是 -1..1 的归一化平移，
 * 边界取"图不能露出空白"的最大可移动量。
 */
function avatarCropGeometry() {
  const w = Number(selection.avatarCropW) || 0;
  const h = Number(selection.avatarCropH) || 0;
  const zoom = Math.max(1, Number(selection.avatarCropZoom) || 1);
  if (!w || !h) return { dw: 0, dh: 0, dx: 0, dy: 0, base: 1 };
  const base = AVATAR_CROP_VIEW / Math.min(w, h); // 短边铺满
  const dw = w * base * zoom;
  const dh = h * base * zoom;
  const slackX = Math.max(0, (dw - AVATAR_CROP_VIEW) / 2);
  const slackY = Math.max(0, (dh - AVATAR_CROP_VIEW) / 2);
  const nx = Math.max(-1, Math.min(1, Number(selection.avatarCropX) || 0));
  const ny = Math.max(-1, Math.min(1, Number(selection.avatarCropY) || 0));
  return {
    dw: dw, dh: dh, base: base,
    dx: -slackX * nx, // 向右拖（nx>0）⇒ 图左移
    dy: -slackY * ny,
  };
}
/** 拖动取景：把指针位移换成归一化平移（1 = 可用位移的满量）。 */
function onAvatarCropDrag(dxPx, dyPx) {
  const geo = avatarCropGeometry();
  const slackX = Math.max(0, (geo.dw - AVATAR_CROP_VIEW) / 2);
  const slackY = Math.max(0, (geo.dh - AVATAR_CROP_VIEW) / 2);
  const nx = slackX > 0 ? (Number(selection.avatarCropX) || 0) - dxPx / slackX : 0;
  const ny = slackY > 0 ? (Number(selection.avatarCropY) || 0) - dyPx / slackY : 0;
  // 拖动是"看得见的那部分" ⇒ 走 live 档（面板不重渲染；预览图由控件按新值自己挪）。
  commitLiveTransient("avatarCropX", Math.max(-1, Math.min(1, nx)), true);
  commitLiveTransient("avatarCropY", Math.max(-1, Math.min(1, ny)), true);
}
/** 缩放取景（滚轮 / 滑块）。 */
function onAvatarCropZoom(z, live) {
  const v = Math.max(1, Math.min(4, Number(z) || 1));
  commitLiveTransient("avatarCropZoom", v, live);
}
/** 把取景框里那一块**按原图分辨率**裁出来（再用既有 downscale 链缩到 512）。 */
async function cropAvatarToBlob() {
  const pending = avatarCropPending;
  if (!pending) throw new Error(weT("没有待裁的图片"));
  const src = await decodeImageFile(pending.file);
  const w = Number(src.width) || 0;
  const h = Number(src.height) || 0;
  const geo = avatarCropGeometry();
  // 显示几何 → 原图像素：取景框边长对应原图 (AVATAR_CROP_VIEW / (base*zoom)) 个像素。
  const perSrc = 1 / (geo.base * Math.max(1, Number(selection.avatarCropZoom) || 1));
  const side = AVATAR_CROP_VIEW * perSrc;
  // 取景框左上角在图坐标里的位置：图中心 + dx/dy，再退半个框。
  const cx = w / 2 - geo.dx * perSrc;
  const cy = h / 2 - geo.dy * perSrc;
  const sx = Math.max(0, Math.min(w - side, cx - side / 2));
  const sy = Math.max(0, Math.min(h - side, cy - side / 2));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(side));
  out.height = Math.max(1, Math.round(side));
  const g = out.getContext("2d");
  if (!g) throw new Error(weT("没有可用的画布"));
  g.drawImage(src, sx, sy, side, side, 0, 0, out.width, out.height);
  if (src.close) { try { src.close(); } catch { /* ignore */ } }
  const toBlob = (type, quality) => new Promise((resolve) => {
    try { out.toBlob((b) => resolve(b), type, quality); } catch { resolve(null); }
  });
  const webp = await toBlob("image/webp", 0.92);
  return (webp && webp.type === "image/webp") ? webp : (await toBlob("image/png"));
}
/** 确认裁切 → 上传裁好的图（走既有 postImageAsset 那条腿）。 */
async function onAvatarCropConfirm() {
  const pending = avatarCropPending;
  if (!pending) { closeAvatarCrop(); return; }
  const side = pending.side;
  setTransient("avatarBusy", side);
  emit();
  try {
    const cut = await cropAvatarToBlob();
    if (!cut) throw new Error(weT("裁切失败"));
    const img = await downscaleImageBlob(cut, AVATAR_IMPORT_MAX_EDGE);
    const posted = await postImageAsset("/avatar/" + side, img.blob, weT("头像"));
    if (!posted.ok) throw new Error(posted.error);
    // 记账：文件名进设置（它同时是"设置过没有"与 `<img>` 的缓存键）。
    setSetting(side === "ai" ? "avatarAiImage" : "avatarUserImage", posted.name);
    setTransient("avatarBusy", "");
    closeAvatarCrop(); // 它自己会 emit
  } catch (err) {
    setTransient("avatarBusy", "");
    setTransient("avatarError", weT("导入失败：{error}", { error: err && err.message ? err.message : String(err) }));
    closeAvatarCrop();
  }
}
function onAvatarClear(side) {
  setTransient("avatarError", "");
  apiDelete("/avatar/" + side, { parse: "always" }).then((r) => {
    if (!r.ok) throw new Error(assetRouteFailure(r, weT("头像")));
    setSetting(side === "ai" ? "avatarAiImage" : "avatarUserImage", "");
    emit();
  }).catch((err) => {
    setTransient("avatarError", weT("清除失败：{error}", { error: err && err.message ? err.message : String(err) }));
    emit();
  });
}

// ── 「系统」页签（自定义吉祥物立绘）的处理器 ──────────────────────────────────
// 与头像同一条导入链（pickImageFile / downscaleImageFile / postImageAsset），差别只有：
//   · 路由不带 side（立绘只有一张，再导入即覆盖 —— 宿主那边清同族旧文件）；
//   · 除文件名外还记一个**显示盒**（`<宽>x<高>`）：立绘按自己的宽高比适配 96×192 的框，
//     结果存下来给主页面那只吉祥物用（拖动 / 贴边 / 视口钳位都读它）。
// 立绘的尺寸直接改主页面那只（RopeDock 是 emit 的订阅者）⇒ 全部走完整路径。
// 盒的**设计上限**（MASCOT_BOX_MAX_W/H）真源在 lib/settings-schema.js —— `mascotBox`
// 档限量级与上传腿的适配框同作用域引用这一对常量，两侧永不漂；短边下限是上传腿
// 自己的口径（"太小的图标点不到"），schema 不知道它。
const MASCOT_BOX_MIN_SIDE = 28;
function onMascotPick() { pickImageFile((file) => uploadMascotFile(file)); }
async function uploadMascotFile(file) {
  if (!file || !/^image\/(png|jpeg|webp)$/.test(String(file.type || ""))) {
    setTransient("mascotError", weT("仅支持 JPG / PNG / WebP 图片"));
    emit();
    return;
  }
  setTransient("mascotError", "");
  setTransient("mascotBusy", true);
  emit();
  try {
    const img = await downscaleImageFile(file, IMAGE_IMPORT_MAX_EDGE);
    // 显示盒：等比适配 96×192（大图缩到框内）；小图不放大，只为"太小的图标点不到"
    // 留一条下限（短边 < 28px 才放大到 28px）。
    const fit = Math.min(MASCOT_BOX_MAX_W / img.width, MASCOT_BOX_MAX_H / img.height);
    const lift = Math.max(1, MASCOT_BOX_MIN_SIDE / Math.min(img.width, img.height));
    const k = Math.min(fit, lift);
    const box = Math.max(1, Math.round(img.width * k)) + "x" + Math.max(1, Math.round(img.height * k));
    const posted = await postImageAsset("/mascot", img.blob, weT("立绘"));
    if (!posted.ok) throw new Error(posted.error);
    setSetting("mascotImage", posted.name);
    setSetting("mascotImageBox", box);
  } catch (err) {
    setTransient("mascotError", weT("导入失败：{error}", { error: err && err.message ? err.message : String(err) }));
  } finally {
    setTransient("mascotBusy", false);
    emit();
  }
}
function onMascotClear() {
  setTransient("mascotError", "");
  // 回执是**布尔**（真删掉 = true / 失败 = false）：`onMascotFormConfirm` 要拿它决定"改不改档位"，
  // 所以这里不能把结果吞掉。失败路径自己已经把原因写进 `mascotError` 并 emit。
  return apiDelete("/mascot", { parse: "always" }).then((r) => {
    if (!r.ok) throw new Error(assetRouteFailure(r, weT("立绘")));
    setSetting("mascotImage", "");
    setSetting("mascotImageBox", "");
    emit();
    return true;
  }).catch((err) => {
    setTransient("mascotError", weT("清除失败：{error}", { error: err && err.message ? err.message : String(err) }));
    emit();
    return false;
  });
}

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

// ── 播放控制处理器（模块级）─────────────────────────────────────────────────
// 设置页与快捷播放面板（quick-panel.js，官方侧栏 tab 与低版本抽屉共用）调用**同一份实现**
// （语义唯一真源，不是两份手抄）—— 它们改的也是同一批设置键。
function playbackIsVideoLike(selLike) {
  const isLiveScene = (selLike.type === "scene" || selLike.type === "web") && liveRenderEnabled(selLike);
  return !isLiveScene && (selLike.type === "video"
    || (selLike.type === "scene" && Boolean(selLike.sceneVideo)));
}
// 播放/暂停: 意图 =「播放」但元素并没有真的在播时（被拒 / 解码失败 /
// 被浏览器暂停），点击必须【重试播放】而不是把意图翻成 false —— 否则这个
// 按钮在冻住状态下等于没反应，用户没有可用的「继续」。
function onTogglePlay() {
  if (selection.playing && playbackIsVideoLike(selection) && !selection.videoPlaying) {
    const layer = document.getElementById(LAYER_ID);
    const v = layer && layer.querySelector("video");
    if (v && v.dataset) delete v.dataset.wePlayRefused; // 清掉拒绝标记才能重试
    setTransient("videoError", "");
    emit(); // syncLayers → applyVideoPlayback 会重新 play()
    return;
  }
  setTransient("playing", !selection.playing);
  emit();
}
// 音乐开关：只翻总开关，不动 videoVolume —— 关掉再打开能恢复原音量。
// 例外：**开启时若音量为 0**（默认值），自动提到默认可听音量 —— 否则开关
// 打开了却依然无声，用户把这条读作「音量开/关都不生效」（实测）。
function onToggleAudio() {
  const enabling = selection.videoAudioEnabled === false;
  selection.videoAudioEnabled = enabling;
  if (enabling && clampNum(selection.videoVolume, 0, 1, 0) <= 0) {
    selection.videoVolume = DEFAULT_AUDIO_VOLUME;
  }
  const layer = document.getElementById(LAYER_ID);
  const v = layer && layer.querySelector("video");
  if (v) weApplyAudio(v);
  syncSceneAudio(selection);
  if (sceneAudioEl && selection.videoAudioEnabled !== false && weAudioVolume() > 0) {
    const p = sceneAudioEl.play();
    if (p && typeof p.catch === "function") p.catch(() => { /* ignore */ });
  }
  persistSelection();
  emit();
}
// 音量滑块（0–100%）：视频 / 场景内嵌 MP4 / 场景包内音频共用同一 videoVolume。
// 拖动档（live）照样即时改音量（听得见），只是不 emit —— 见 commitLiveSetting。
function onVideoVolume(pct, live) {
  selection.videoVolume = clampNum(Number(pct) / 100, 0, 1, 0);
  const layer = document.getElementById(LAYER_ID);
  const vid = layer && layer.querySelector("video");
  if (vid) weApplyAudio(vid);
  syncSceneAudio(selection);
  if (sceneAudioEl && selection.videoAudioEnabled !== false && weAudioVolume() > 0) {
    const p = sceneAudioEl.play();
    if (p && typeof p.catch === "function") p.catch(() => { /* ignore */ });
  }
  persistSelection();
  if (!live) emit();
}
function onClear() {
  // 清掉壁纸 = 这张的属性面板也失去对象：顺手把「壁纸属性」收起来。不收的话开关会
  // 「挂着」，下次随便选一张带属性的壁纸时面板会**自动弹开**（用户没点过它）。
  propsPanelOpen = false;
  applySelection("");
}
// 手动点开一张壁纸 = 明确想看它：作废它的 live 失败记忆（sceneLiveFailures，持久
// 降级），让实时渲染重试一次（真失败会自动回退并重新记账）。没有这条路时，一张
// 「某次首帧超时」的壁纸会被**永久**降级到无音频桥形态 —— 音频驱动的壁纸（如
// 音域回响）就此黑屏且用户无路可走（实测）。只清手动路径：轮换提交不清。
function clearLiveFailure(id) {
  const k = String(id || "");
  const m = selection.sceneLiveFailures;
  if (!k || !m || !m[k]) return;
  const next = Object.assign({}, m);
  delete next[k];
  setSetting("sceneLiveFailures", next);
}
function onGroupChange(e) {
  // 换列表 ⇒ 清掉待确认（不变量 3）：否则"删除「A」？"会跟着新选中的 B 一起显示。
  disarmConfirm();
  selection.rotationGroupId = e.target.value;
  if (selection.rotationEnabled) {
    const first = rotationCandidates()[0];
    if (first) applySelection(first.id);
    else applySelection("");
    return;
  }
  persistSelection();
  syncRotationTimer();
  emit();
}
function onToggleRotation() {
  selection.rotationEnabled = !selection.rotationEnabled;
  // 关闭轮换：进行中的准备（staging/探测元素）一并取消，不再落实切换。
  if (!selection.rotationEnabled) cancelRotationPrepare();
  if (selection.rotationEnabled) {
    if (!selection.rotationGroupId) {
      const usable = firstUsableGroup();
      if (usable) selection.rotationGroupId = usable.id;
    }
    if (!rotationCandidates().some((w) => w.id === selection.id)) {
      const first = rotationCandidates()[0];
      if (first) {
        applySelection(first.id);
        return;
      }
    }
  }
  persistSelection();
  syncRotationTimer();
  emit();
}
// 「下一张」（快捷面板）：轮播开着按活动列表推进、关着按可播放网格推进；
// 锚点是【实际显示】的那张（与轮换同一锚点判定，避免 A→B→A 乒乓）。
function onNextWallpaper() {
  const list = selection.rotationEnabled ? rotationCandidates() : playableInventory();
  if (list.length < 2) return;
  const anchor = rotationAnchorWallpaper();
  const anchorId = anchor ? anchor.id : selection.id;
  const cur = list.findIndex((w) => w.id === anchorId);
  const next = list[(cur + 1 + list.length) % list.length];
  if (next && next.id !== anchorId) applySelection(next.id, { fromManual: true });
}

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

// ── 模块级 / 页签级 / 全局重置（issue #192）────────────────────────────────────
// 键集一律取自 lib/settings-schema.js 的 `RESET_MODULES`（模块级）/ `RESET_TABS`（页签级）/
// `PROFILE_PRESET_KEYS`（全局）—— 都在那一侧定义，这一侧不手抄键表。
// ⚠️ 必须是**整批赋值 + 一次 persistSelection + 一次 emit**：逐键走 `setSetting` 会发 N 次
// debounce、N 次整棵面板重渲染（本仓"写必成对"纪律，同 src/fontset-store.js 的注释）。
/**
 * 把给定的键整批写回默认值，返回真正改动的键数。
 * 只碰"确实有默认值"的键：缺默认值的键原样留着，免得把 `undefined` 写进 store ——
 * 那会被宿主 sanitize 折成默认值，看着像"重置生效了"，实际是绕了一圈的静默改写。
 */
function resetKeysToDefault(keys) {
  let touched = 0;
  for (let i = 0; i < keys.length; i += 1) {
    const k = keys[i];
    if (!Object.prototype.hasOwnProperty.call(DEFAULTS, k)) continue;
    if (selection[k] === DEFAULTS[k]) continue;
    selection[k] = DEFAULTS[k];
    touched += 1;
  }
  if (touched) persistSelection();
  return touched;
}
/**
 * 模块级重置（**无需确认**：单模块代价低 —— 用户口径见 issue #192）。
 * 覆盖**两处**的模块：扩展页签的三个（avatar / fx / parallax）与外观页签的六个
 * （theme / detail / glass / corners / uiColor / font）—— 同一个入口，键集由模块名查表。
 */
const onResetModule = (groupName) => {
  const keys = (typeof RESET_MODULES === "object" && RESET_MODULES && RESET_MODULES[groupName]) || [];
  if (!keys.length) return;
  resetKeysToDefault(keys);
  emit();
};
/**
 * 页签级重置（issue #192 用户口径：「每个选项卡后面加重置，重置指定选项卡」）。
 * 键集取自 `RESET_TABS`（schema 里手写并由守卫对账的完整划分）。
 * 走两步确认 ⇒ 这个函数只负责"确认之后真的做"，确认由面板用 armConfirm 上膛。
 */
const onResetTab = (tabId) => {
  const keys = (typeof RESET_TABS === "object" && RESET_TABS && RESET_TABS[tabId]) || [];
  resetKeysToDefault(keys);
  disarmConfirm(); // 确认行自己收掉（它内部会 emit）
};
/**
 * 全局重置（**必须二次确认**）：确认由面板走既有 `armConfirm` 两步确认构件完成
 * （`selection.armedConfirm` 是单值 ⇒ 结构上同一时刻只有一个动作待确认，见那段注释），
 * 这里只负责"确认之后真的做"。
 * 范围 = `PROFILE_PRESET_KEYS`（全部会持久化的设置键）；**不含导入的资产文件**
 * （头像图 / 吉祥物立绘 / 字体集住各自的目录，删不删是另一件事 —— 重置设置不该顺手删用户的图）。
 */
const onResetAll = () => {
  resetKeysToDefault(PROFILE_PRESET_KEYS);
  disarmConfirm(); // 确认行自己收掉（它内部会 emit）
};
// 配色 (accent color) + 玻璃透明度 (glass transparency) + 玻璃颜色 (glass base
// tint): applied instantly through applyEffects() (--we-accent /
// --we-glass-alpha / --we-surface-tint-light/dark), persisted so the settings page keeps
// its custom look across reloads.
const onAccent = (hex, live) => {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
  commitLiveSetting("accent", hex, live);
};
// ── 全局 UI 配色（2026-10-11 用户口径）────────────────────────────────────────
// 「UI 配色自定义」总开关：与 fontCustom 同形（默认关）。开启后「全局配色」不再生效、改由
// 五个元素键分别决定（面板那一行会被禁用，见 panel-tabs 的 renderAppearanceUiColorSection）。
const onToggleUiColorCustom = (v) => {
  setSetting("uiColorCustom", !!v);
  applyEffects();
  emit();
};
// 五个元素各自的颜色。⚠️ 空串 = **跟随「全局配色」**（不是"回宿主原生"）—— effects.js 里
// `selection[k] || selection.accent` 就是这条语义的实现处；面板的「跟随」按钮写空串。
const onUiColorElement = (field, hex, live) => {
  if (hex !== "" && !/^#[0-9a-f]{6}$/i.test(hex)) return;
  if (UI_COLOR_KEYS.indexOf(field) < 0) return; // 只认那五个键（渲染器传错名字时不静默写脏）
  commitLiveSetting(field, hex, live);
};
// #159②：玻璃颜色**内部永远是一对** `{light, dark}`（见 lib/settings-schema.js 的 readGlassColors）。
// 色板行只写"当前在设的那一侧"；开关关着时两侧写同一个色 —— 与颜色角色的 onThemeColor 同构。
// 读那一对用 `panelGlassPair`（住在 src/glass-panel.js）：它**自带归一、不引用工厂作用域里的兄弟**，
// 因为 test/verify-scene-live.mjs 把 glass-panel.js 当真模块 import；这里不另存一份口径，
// 免得"读的一侧"和"画的一侧"漂开（走到这儿的值可能仍是标量：老预设定档直传 / 台架 selection）。
const onGlassColor = (mode, hex, live) => {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
  const cur = panelGlassPair(selection);
  // 缺的那一侧用本次选的色补上 —— **绝不写半对**：半对在另一配色下会退化成兜底色，
  // 用户的观感就是"没染上"（readGlassColors 也会把它补回另一侧，但那要等下一次 sanitize）。
  const next = { light: cur.light || hex, dark: cur.dark || hex };
  if (selection.glassDarkSeparate === true) next[mode === "dark" ? "dark" : "light"] = hex;
  else { next.light = hex; next.dark = hex; }
  commitLiveSetting("glassColor", next, live);
};
// 「深色单独设置」开关（玻璃色那一行）：关掉时把两侧**收敛到浅色那一侧** —— 这就是"一个颜色
// 同时用于两套"的字面含义。不做收敛的话，关掉后深色还留着上一次的深色值，再打开会突然跳回旧值。
// 与 onThemeDarkSeparate（字体角色那一个）同构：开关本身不改任何渲染，只是面板的显隐 + 写入口径。
const onGlassDarkSeparate = (v) => {
  const on = v === true;
  setSetting("glassDarkSeparate", on);
  if (!on) {
    const cur = panelGlassPair(selection);
    const light = cur.light || cur.dark;
    if (light) setSetting("glassColor", { light, dark: light });
  }
  applyEffects(); emit();
};
const onGlassAlpha = (pct, live) =>
  commitLiveSetting("glassAlpha", clampNum(pct, ...schemaRange("glassAlpha"), DEFAULTS.glassAlpha), live);
// 玻璃保真度（默认 100 = 完整可读性红线）：唯一的「颜色 vs 可读」权衡旋钮，
// 数学入口在 effects.js 的 weClampSurfaceColor 第三参 + --we-glass-fidelity。
const onGlassFidelity = (pct, live) =>
  commitLiveSetting("glassFidelity", clampNum(pct, ...schemaRange("glassFidelity"), DEFAULTS.glassFidelity), live);
// 额外补雾化的选择器（#200）：值是一串 CSS 选择器（逗号 / 换行分隔，最多 8 条）。
// 消毒只走 settings-schema 的 sanitizeExtraGlassSelectors —— 读侧（sanitizeFromSchema）
// 与本模块生成侧（glass-extra.js）**共用同一份**判据，所以用户敲到一半的非法串既不会进
// 规则、也不会被"修剪"成另一个选择器。**不做防抖**：只有清单真的变了才会重写 <style>
// （glass-extra 里那句内容比对），且一次只写一条文本节点，代价与拖滑杆同量级。
const onExtraGlassSelectors = (text) => {
  setSetting("extraGlassSelectors", text == null ? "" : String(text));
  applyEffects();
  emit();
};
// 对话栏玻璃保真度（默认 100）：独立于全局的第二把尺子，只作用对话栏玻璃面
// （气泡 / 输入卡片 / 对话内 markdown 家族 —— styles.js 消费 --we-chat-readability-*）。
const onChatGlassFidelity = (pct, live) =>
  commitLiveSetting("chatGlassFidelity", clampNum(pct, ...schemaRange("chatGlassFidelity"), DEFAULTS.chatGlassFidelity), live);
// 主题随壁纸（**默认关**）：开关本身只写设置；**打开时**立刻按当前壁纸补判一次，
// 不等下一次换壁纸（补判走与换壁纸同一条入口；关时那条入口整体空转，不写主题）。
const onToggleThemeFollow = (v) => {
  setSetting("themeFollow", !!v); themeFollowOnWallpaper(selection); emit();
};

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
// 各字段的含义见 src/fontset-editor.js 的文件头。这里只做三件事：状态从 selection 取、
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

// ── 玻璃预设的接线（渲染器只读 ctx、动作经 on*；store 与失败语义见 src/preset-store.js）──
// 与 fontSetCtx 同形：清单/错误是宿主投影，busy 是在途标记，删除走 armConfirm 两步确认。
// 应用预设会**整机快照覆盖**（settings 段 + 勾选的资产段）⇒ 动作前先清掉挂着的删除确认
//（上下文切换必清，同字体集）。
/**
 * 保存对话框的**资产可用位 + 默认勾**（ADR-0011 D4，三态）：
 *   · 默认勾：字体 ✅ / 吉祥物 ✅ / 头像 ❌（头像体积翻倍、与"分享一份外观配置"关系最弱）；
 *   · available = 本机现在**有**那份资产 —— **只决定提示文案**（勾上是"带过去"还是"声明无"），
 *     **不再禁用开关、也不再把勾选钳成 false**（那样用户就没法声明"这一族是无"）：
 *     字体段的可带判据 = 活动字体集至少改过一个颜色角色（全默认的字体集没有个性）；
 *     吉祥物 = selection.mascotImage 非空；头像 = 两张任一非空。
 * 纯函数、零副作用：调用点（打开保存对话框时）把产物经 setTransient 存进 glassPresetAssetChecks。
 */
function presetAssetChecksNow() {
  const fontValues = (() => {
    const out = {};
    for (const key of FONTSET_KEYS) out[key] = selection[key];
    return sanitizeFontset(out);
  })();
  const fontAvailable = Boolean(fontValues.themeColors
    && typeof fontValues.themeColors === "object"
    && Object.keys(fontValues.themeColors).length > 0);
  const mascotAvailable = Boolean(selection.mascotImage);
  const avatarAvailable = Boolean(selection.avatarUserImage || selection.avatarAiImage);
  const prev = (selection.glassPresetAssetChecks && typeof selection.glassPresetAssetChecks === "object")
    ? selection.glassPresetAssetChecks : {};
  return {
    // 用户上一轮的勾选保留（重开对话框不丢他的选择）；available 位每次现算，**只决定提示文案**。
    // ⚠️ 勾选**不再**被 available 钳住（2026-10-12）：勾上 = "按本机现状声明这一族" —— 本机没有
    //    图 ⇒ 宿主落 `null`（**显式声明「无」**，套用它的人回到内置），这是用户有权做的声明；
    //    不勾 = 不动对方。旧版把勾选钳成 false + 行禁用 ⇒ 用户自存预设永远无法声明「无」。
    font: prev.font !== false,
    mascot: prev.mascot !== false,
    avatar: prev.avatar === true,
    // 吉祥物族的**指向**（第四态）：`""` = 按本机现状，形态值 = 这一族只存"指向出厂自带的那一只"。
    // 与勾选同款：保留上一轮的选择（重开对话框不丢），值域由宿主再判一次（认不清就丢）。
    mascotPoint: typeof prev.mascotPoint === "string" ? prev.mascotPoint : "",
    fontAvailable,
    mascotAvailable,
    avatarAvailable,
  };
}

function glassPresetCtx() {
  const done = () => { setTransient("glassPresetBusy", false); emit(); };
  const busy = (promise) => { setTransient("glassPresetBusy", true); emit(); promise.then(done, done); };
  // 待确认的动作（应用 / 真保存 / 导入 / 删除）共用 busy；错误行由 store 内部的
  // setPresetError 收口。
  return {
    presets: selection.glassPresets,
    loading: selection.glassPresetBusy === true,
    error: selection.glassPresetError,
    note: selection.glassPresetNote,
    saving: selection.glassPresetSaving === true,
    // 对话框用途："save"（存进预设栏）/ "export"（导出为文件）/ ""（关着）。
    // 渲染器据此画名字行 + 勾选 +「保存预设」，或只画勾选 +「下载 .json」。
    saveTarget: selection.glassPresetSaveTarget,
    // 导出的目标预设 id（对话框里那个下拉的当前值）。与 saveTarget 同住一个瞬态字段组：
    // 保存用 ""，导出用"选中的那一份"。
    exportTargetId: selection.glassPresetTargetId,
    draftName: selection.glassPresetDraftName,
    armedId: armedIdOf("gpreset"),
    assetChecks: selection.glassPresetAssetChecks,
    // 勾选/取消只改视图态 —— 真正的名单在「保存预设」那一下才交给 store。
    onAssetToggle: (kind, on) => {
      const next = Object.assign({}, selection.glassPresetAssetChecks);
      next[kind] = on === true;
      setTransient("glassPresetAssetChecks", next);
      emit();
    },
    // 吉祥物族的**指向**（第四态）：`""` = 按本机现状；形态值 = "这一段只存指向出厂自带的那一只"。
    // 与勾选同住 glassPresetAssetChecks（内存 UI 瞬态，不进 settings schema）；值域外的值一律折成 ""。
    onMascotPoint: (value) => {
      const next = Object.assign({}, selection.glassPresetAssetChecks);
      next.mascotPoint = ROPE_FORM_VALUES.includes(value) ? value : "";
      setTransient("glassPresetAssetChecks", next);
      emit();
    },
    onApply: (id) => {
      disarmConfirm();
      busy(applyPreset(id));
    },
    onOpenSave: () => {
      setTransient("glassPresetSaving", true);
      setTransient("glassPresetSaveTarget", "save");
      setTransient("glassPresetTargetId", "");
      setTransient("glassPresetDraftName", "");
      setTransient("glassPresetError", "");
      setTransient("glassPresetNote", "");
      // 可用位在打开对话框那一刻现算（字体集/立绘/头像可能刚被改过）。
      setTransient("glassPresetAssetChecks", presetAssetChecksNow());
      disarmConfirm();
      emit();
    },
    // 导出（ADR-0011 D7 + 2026-10-11 用户口径）：入口**独立成一行**（网格下方与
    // 保存 / 导入并列），不再逐格挂键 —— 所以这里不再收 id，默认选中清单里
    // **第一份读得出来的**（broken 的没有可导出的正文，宿主对它 422）。
    // 仍是"先弹同一组资产勾选对话框，确认后才发起下载"。
    onOpenExport: () => {
      const first = (Array.isArray(selection.glassPresets) ? selection.glassPresets : [])
        .find((r) => !r.broken);
      setTransient("glassPresetSaving", true);
      setTransient("glassPresetSaveTarget", "export");
      setTransient("glassPresetTargetId", first ? first.id : "");
      setTransient("glassPresetError", "");
      setTransient("glassPresetNote", "");
      // 可用位在这里现算，但**勾选默认重置**成 D4 默认值：导出的对象是"那一份预设"，
      // 不是当前 selection —— 沿用上一轮为"保存"勾过的状态反而容易带错东西。
      // 指向同理重置（导出的是"那一份"，别把上一轮为保存选过的指向带进去）。
      setTransient("glassPresetAssetChecks", Object.assign(presetAssetChecksNow(), { font: true, mascot: true, avatar: false, mascotPoint: "" }));
      disarmConfirm();
      emit();
    },
    // 换"导出哪一份"：只改目标 id。资产勾选与可用位**不动** —— 可用位回答的是
    // "本机现在有没有这份资产"，与选中的是哪一份预设无关。
    onExportTargetChange: (id) => {
      setTransient("glassPresetTargetId", String(id == null ? "" : id));
      emit();
    },
    // 导出的确认步：普通链接导航（宿主带 Content-Disposition: attachment 应答）——
    // 不引入 blob / showSaveFilePicker / window.confirm。勾选名单走 ?assets= 查询参数。
    onExportCommit: () => {
      const id = selection.glassPresetTargetId;
      if (!isGlassPresetId(id)) return;
      const checks = selection.glassPresetAssetChecks || {};
      const embeds = ["font", "mascot", "avatar"].filter((k) => checks[k] === true);
      // 指向出厂自带（第四态）：走 ?point=mascot:<形态> —— 与内嵌互斥（那一段没有字节可带），
      // 所以有指向时把 `mascot` 从内嵌名单里摘掉（否则宿主会照旧把本机那张图内嵌进去）。
      const point = ROPE_FORM_VALUES.includes(checks.mascotPoint) ? checks.mascotPoint : "";
      setTransient("glassPresetSaving", false);
      setTransient("glassPresetSaveTarget", "");
      setTransient("glassPresetTargetId", "");
      emit();
      const a = document.createElement("a");
      a.href = exportGlassPresetUrl(id, embeds.filter((k) => !(k === "mascot" && point)), point);
      a.download = id + ".json";
      document.body.appendChild(a);
      a.click();
      a.remove();
    },
    onDraftName: (v) => { setTransient("glassPresetDraftName", String(v == null ? "" : v)); emit(); },
    // 对话框第一步的「下一步」/ 名字框里的 Enter：只做最小校验（名字非空 ——
    // 空名字在保存时也会被 store 拦，但提前拦能让错误行贴着输入框出现）。
    onSaveCommit: () => {
      if (!String(selection.glassPresetDraftName || "").trim()) {
        setPresetError(weT("先给预设起个名字"));
        return;
      }
      emit();
    },
    // 对话框第二步的「保存预设」：勾选名单此刻才交给 store（saveGlassPreset 内部会做
    // 资产前置校验 —— 勾了但本机没有的组合给可判定原因）。成功后收起对话框。
    onSaveCommit2: () => {
      const checks = selection.glassPresetAssetChecks || {};
      const embeds = ["font", "mascot", "avatar"].filter((k) => checks[k] === true);
      busy(saveGlassPreset(selection.glassPresetDraftName, embeds).then((id) => {
        if (id) { setTransient("glassPresetSaving", false); setTransient("glassPresetDraftName", ""); }
        emit(); // 收起输入行的分支写完 store 必须通知（渲染纪律判据）
      }));
    },
    onCancelSave: () => {
      setTransient("glassPresetSaving", false);
      setTransient("glassPresetSaveTarget", "");
      setTransient("glassPresetTargetId", "");
      setTransient("glassPresetDraftName", "");
      emit();
    },
    onArmDelete: (id) => armConfirm("gpreset:" + id),
    onDisarm: () => disarmConfirm(),
    onDelete: (id) => { disarmConfirm(); busy(deleteGlassPreset(id)); },
    // 导出对话框的确认步在上面（onExportCommit —— 普通链接，宿主附件应答）。
    onImportFile: (file) => { disarmConfirm(); busy(importGlassPreset(file)); },
  };
}

// F1：角色色。默认「单色」—— 一个色同时写进 light/dark 两套（内部始终存两套，
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
// 清单本身不参与字体值，拿不到也不影响任何别的功能 —— 见 src/system-fonts.js）。
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

// ── 壁纸库 / 库视图处理器 ────────────────────────────────────────────────────
const onRefresh = () => loadInventory();
// Filter changes: persist + re-validate so wallpapers outside the selected
// categories drop out of the grid/rotation immediately.
const onRatingFilterChange = (e) => {
  setSetting("contentRatingFilter", e.target.value);
  revalidateSelection();
};
const onTypeFilterChange = (e) => {
  setSetting("typeFilter", e.target.value);
  revalidateSelection();
};
// Card style: classic (CD-rack) vs fixed (overlap-proof).
const onLayoutChange = (value) => {
  setSetting("pickerLayout", value);
  emit();
};
// Edge 兼容渲染开关：关闭后任何浏览器都走原生 <video>。改的是渲染模式，
// syncLayers 的 wantKey 已并入模式，emit 会重建壁纸层并立即按新路径生效。
const onEdgeCompatChange = (checked) => {
  setSetting("edgeCompat", checked);
  emit();
};
// Per-group interval: writes straight into the active group so each rotation
// list keeps its own switch cadence.
const onGroupInterval = (e) => {
  const group = activeRotationGroup();
  if (!group) return;
  group.interval = clampNum(Number(e.target.value), ...schemaRange("rotationInterval"), DEFAULTS.rotationInterval);
  persistSelection();
  syncRotationTimer();
  emit();
};
// 「删除」按钮**只置令牌**；真正的删除在问句行的「确认」里（不变量 2）。两件事分开的
// 好处：守卫可以分别断言"第一下不删"与"确认才删"，而不是只验一个 if。
const onArmDeleteGroup = () => {
  const group = activeRotationGroup();
  if (!group) return;
  armConfirm("group:" + group.id);
};
const onDeleteGroup = () => {
  const group = activeRotationGroup();
  if (!group) return;
  disarmConfirm();
  deleteGroup(group.id);
};

// 切换过场（类型 / 方向 / 速度）：只写选择 —— 下一次换壁纸（手动点选或轮换提交）
// 生效，不需要重建当前层。
const onSwitchTransition = (id) => {
  if (!SWITCH_TRANSITION_VALUES.includes(id)) return;
  setSetting("switchTransition", id); emit();
};
const onSwitchTransitionDir = (dir) => {
  if (!SWITCH_DIRS.includes(dir)) return;
  setSetting("switchTransitionDir", dir); emit();
};
const onSwitchTransitionSpeed = (id) => {
  if (!SWITCH_SPEED_VALUES.includes(id)) return;
  setSetting("switchTransitionSpeed", id); emit();
};
// Mascot pull-cord show/hide, persisted with the other toggles.
const onRopeVisibilityChange = (e) => {
  setSetting("ropeShown", e.target.checked); emit();
};
/**
 * 点吉祥物环上的内置项 = **换成出厂自带**（2026-10-12 用户口径：内置项不再禁用；
 * 2026-10-13 并入 #180 后，平铺卡片换成 3D 环、单击换成两步确认）：
 *   · 本机没有自定义立绘 ⇒ 纯档位切换（写一个键、零网络，与旧行为一字不差）；
 *   · 本机有自定义立绘 ⇒ 这里只**上膛**（`mascotPendingForm` + `armedConfirm`），真正的动作在
 *     `onMascotFormConfirm`：走与「清除」按钮**同一条路**（宿主删同族文件），成功后才摘引用 + 钉 form
 *     —— 失败就一个字段都不动（屏上仍是那张自定义图），原因进 `mascotError`。
 * 与预设的第四态（`assets.mascot` 字符串 = 指向内置形态 ⇒ 清本机立绘族 + 钉 `ropeForm`）同语义：
 * 三个入口（环上内置项 / 「清除」按钮 / 套用"指向出厂自带"的预设）在"这一族归谁"上必须给同一个结果。
 */
const onRopeFormChange = (form) => {
  if (!ROPE_FORM_VALUES.includes(form)) return;
  // ── 自定义立绘生效时不能直接改形态（2026-10-11 用户口径：「按钮要可点击」）──────────
  // `ropeArtOf` 的优先序是「有自定义立绘就用它」⇒ 只写 ropeForm 对屏上那只**毫无影响**。
  // 旧版因此把内置项与 ‹ › 全**禁用**了 —— 而用户实测的反馈正是"按钮都没办法点"，
  // 所以那条路不能留。现在把它做成一条**真能生效**的动作：代价是清除那张自定义立绘，
  // 而清除在宿主那边是 DELETE、**不可恢复** ⇒ 走两步确认（与本仓其它破坏性动作同一口径）。
  if (selection.mascotImage) {
    setTransient("mascotPendingForm", String(form));
    setTransient("armedConfirm", "mascot-form");
    emit();
    return;
  }
  setSetting("ropeForm", form); emit();
};
// 确认后的形态切换：**先真的把文件删掉、拿到成功再改档位**（2026-10-13 合并口径）。
// ⚠️ 顺序不能反 —— mascotImage 还在时写 ropeForm 就是"写了没人读"（ropeArtOf 仍取自定义）；
// 而"先写档位再删文件"在 DELETE 失败时会留下"档位变了、图还在"的半截状态（屏上没变化、
// 设置里却已经不是原来那只）⇒ 删除失败就一个字段都不动，原因由 onMascotClear 进 mascotError。
const onMascotFormConfirm = () => {
  const form = selection.mascotPendingForm;
  disarmConfirm();
  setTransient("mascotPendingForm", "");
  if (!ROPE_FORM_VALUES.includes(form)) { emit(); return; }
  const cleared = selection.mascotImage ? onMascotClear() : Promise.resolve(true);
  cleared.then((ok) => {
    if (!ok) return;
    setSetting("ropeForm", form);
    setSetting("mascotImage", "");
    setSetting("mascotImageBox", "");
    emit();
  });
};
const onRopeScaleChange = (scale) => {
  setSetting("ropeScale", clampNum(scale, ROPE_SCALE_MIN, ROPE_SCALE_MAX, DEFAULTS.ropeScale)); emit();
};

// 当前 live 渲染页的 iframe（面板「重新截」的抓帧源）。
// livePointerFrame 由 syncLayers 每次挂上 live 层时更新；切到非 live 壁纸后它可能
// 仍指向已移除的旧元素，所以再用 DOM 查一次兜底。
const currentLiveFrame = () => {
  const ref = livePointerFrame;
  if (ref && (!("isConnected" in ref) || ref.isConnected)) return ref;
  try {
    const node = document.getElementById(LAYER_ID);
    const f = node && typeof node.querySelector === "function" ? node.querySelector("iframe.we-live-iframe") : null;
    if (f) return f;
  } catch { /* ignore */ }
  return null;
};

// 自定义画面（截屏导入）：从 WE 等处截图后导入，成为该壁纸的「自定义画面」档
// （?v=4）显示源。
const setCustomFrameLocal = (wid, on) => {
  const m = Object.assign({}, selection.customFrames || {});
  if (on) m[wid] = true; else delete m[wid];
  selection.customFrames = m;
};

// Close the picker library view (ESC / 返回 button share this path).
const closePicker = () => {
  // 关库视图 ⇒ 清掉待确认（不变量 3）：否则重新打开时会看到一个针对上次那个对象的问句。
  disarmConfirm();
  setTransient("pickerOpen", false);
  setTransient("pickerDraft", false);
  setTransient("batchMode", false);
  setTransient("batchSelected", []);
  emit();
  // Focus restore: return focus to the「选择壁纸」button that opened the
  // view (WCAG focus management).
  if (pickerOpener && pickerOpener.isConnected) {
    try { pickerOpener.focus(); } catch { /* ignore */ }
  }
};

const INTERVALS = [1, 5, 10, 30, 60, 120];

// ── Pagination row: big libraries must not render every card at once (hundreds
//    of thumbnails per emit make the picker lag). The slicing itself is the
//    model's (`pageSlice` in src/picker-model.js); 这里只画「上一页 / 下一页」。──
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
// 契约：渲染器（`src/picker-modal.js`）**不写 `selection`、不自己发通知** ⇒
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

function WallpaperPicker() {
  useWeLocale(); // 设置页壁纸库：语言切换 → 整棵选择器（含 render* 渲染器）重渲染
  const sel = useStore();
  // 视频类壁纸（原生视频 + 内嵌 MP4 场景）: 只有它们有
  // 「真实播放态」的概念。实时渲染（live iframe）形态必须排除在外：它没有
  // <video> 元素可回写真实状态，且 sceneVideo 在 live 形态下非空（降级备用），
  // 沿用视频类判定会让 playbackLive 恒为 videoPlaying=true —— 「暂停」后按钮
  // 永不变「播放」（实测）。
  const isLiveScene = (sel.type === "scene" || sel.type === "web") && liveRenderEnabled(sel);
  const isVideoLike = !isLiveScene && (sel.type === "video"
    || (sel.type === "scene" && Boolean(sel.sceneVideo)));
  // 卡片上显示/按钮用的播放态: 视频类壁纸以 <video> 元素的真实状态为准。
  // 意图为「播放」但元素被拒/解码失败时，面板必须说「已暂停」并把按钮显示成
  // 「播放」，否则用户面对一张冻住的壁纸却只有「暂停」可点 —— 没有「继续」。
  const playbackLive = isVideoLike ? sel.videoPlaying : sel.playing;
  // 播放/暂停 / 音轨 / 音量 / 关闭 / 轮播切换 / 换列表：处理器见「播放控制处理器」段
  //（快捷播放面板共用同一份实现）。

  // 画面滑块（暗化 / 壁纸透明度 / 壁纸模糊 / 亮度 / 对比度 / 饱和度）与外观细调
  //（配色 / 玻璃颜色 / 玻璃透明度 / 边框 / 雾化）：处理器见「外观 / 画面处理器」段
  //（快捷播放面板共用同一份实现）。
  // 主题随壁纸的开关处理器同「外观 / 画面处理器」段。

  // 出图来源：当前场景壁纸在「自动 ⇄ 自定义画面」之间切换（按壁纸记忆）。
  // 只有一档可切（没导入自定义画面）时**不动** —— 避免"点了没反应"。
  const onRefreshFrame = () => {
    if (sel.type !== "scene" || !sel.sceneFrameUrl) return;
    const wid = String(sel.id);
    const total = frameVariantCount(sel, wid);
    if (total < 2) return;
    // 推进**下标**、存**档位值**：值域有洞（0 与 4），取模会造出 1/2/3 这种退役档位。
    const cur = Number(sel.frameVariants && sel.frameVariants[wid]) || 0;
    const idx = Math.max(0, FRAME_VARIANTS.findIndex((f) => f.id === cur));
    const next = FRAME_VARIANTS[(idx + 1) % total].id;
    const map = Object.assign({}, selection.frameVariants || {});
    map[wid] = next;
    selection.frameVariants = map;
    // 切换作用于出图来源：把层切到该档的画面。
    setSetting("url", frameUrlWithVariant(sel.sceneFrameUrl, next)); syncLayers(); emit();
  };
  // 清除 GPU 抓帧缓存（<key>_gpu.png）：按用户决策 GPU 帧优先于全部档位，
  // 所以「切档位 / 换回 CPU 生成画面」的前置动作就是先删掉它。删除后立刻按
  // 当前档位重挂静态帧（scene-frame 响应带 no-store，重挂即重新取图）。
  const onClearGpuFrame = () => {
    if (sel.type !== "scene" || !sel.sceneFrameUrl || gpuFrameUi.busy) return;
    const wid = String(sel.id || "");
    const token = gpuFrameToken(sel.sceneFrameUrl);
    if (!wid || !token) return;
    gpuFrameUi.wid = wid;
    gpuFrameUi.busy = true;
    emit();
    // 清除 = 删主帧（单主帧语义）。这是共享资源：清掉后其他窗口在下一次回填点
    // 各自按自己的画布尺寸重抓——与旧单槽时代一致，用户显式点「清除」即此意。
    apiDelete("/scene-frame-cache/" + encodeURIComponent(token), { parse: true })
      .then((r) => {
        // 真·失败只有一种：宿主 500（unlink 被权限/占用挡住）。`removed:false`
        //（200）= 主帧本来就没有 —— 目标态已达成，按成功走：探测读数本来就说
        // 没有帧，两面一致。
        if (!r.ok) {
          gpuFrameUi.busy = false;
          gpuFrameUi.error = weT("清除失败：宿主返回 {status}", { status: r.status });
          emit();
          return;
        }
        gpuFrameUi.error = "";
        markGpuFrameProbed(wid, false);
        forgetGpuFramePin(token);
        // 请求期间用户可能已经切走：槽位状态属于发起时那张壁纸，URL 重写/渲染恢复
        // 只对「还是它」的情况做（同 A4 的身份校验；否则会把当前壁纸的 URL 改写成
        // 「当前帧 URL + 旧壁纸的档位」→ 画面与面板读数不一致）。
        if (String(selection.id || "") !== wid) { gpuFrameUi.busy = false; emit(); return; }
        gpuFrameUi.busy = false;
        const variant = Number(selection.frameVariants && selection.frameVariants[wid]) || 0;
        setSetting("url", frameUrlWithVariant(sel.sceneFrameUrl, variant)); syncLayers(); emit();
      })
      .catch(() => {
        gpuFrameUi.busy = false;
        gpuFrameUi.error = weT("清除失败：请求未完成");
        emit();
      });
  };
  // 「重新截」：实时渲染**开着时也要能用** —— GPU 实时帧就是切换途中 / live 首帧
  // 之前给用户看的那张静帧，构图或时机不对时（黑帧、旧视口、切走时那张）用户必须
  // 能立刻重抓，而不是先关掉实时渲染再回来。
  // 走的是自动回填那条同一条安全路径（先抓帧 + 内容门禁 → 成功后才清旧帧 → PUT），
  // 所以抓不到时**不会**把原来那张删掉；失败原因直接显示在面板上。
  const onRecaptureGpuFrame = () => {
    if (sel.type !== "scene" || !sel.sceneFrameUrl || gpuFrameUi.recapturing) return;
    const live = currentLiveFrame();
    if (!live) {
      gpuFrameUi.error = weT("拿不到实时画面（实时渲染没在运行）→ 想抓实时帧请先开「场景实时渲染」");
      emit();
      return;
    }
    gpuFrameUi.recapturing = true;
    gpuFrameUi.error = "";
    emit();
    // force：即使槽里已有 GPU 帧也重抓一张（用户显式要求换一张）。
    scheduleLiveFrameBackfill(live, { force: true });
  };
  const onCustomFrameFile = (e) => {
    const file = e.target.files && e.target.files[0];
    try { e.target.value = ""; } catch { /* ignore */ }
    if (!file || sel.type !== "scene" || !sel.id) return;
    const wid = String(sel.id);
    const ctype = (file.type === "image/jpeg" || file.type === "image/png" || file.type === "image/webp")
      ? file.type : "image/png";
    apiFetch("/custom-frame/" + encodeURIComponent(wid), {
      method: "POST",
      headers: { "Content-Type": ctype },
      body: file,
    }).then((r) => {
      if (!r.ok) throw new Error("宿主返回 " + r.status);
      setCustomFrameLocal(wid, true);
      const map = Object.assign({}, selection.frameVariants || {});
      map[wid] = 4;
      selection.frameVariants = map;
      // 上传可能花掉秒级（截屏多 MB）：期间用户切走就只记账到发起时那张壁纸，
      // 不改当前壁纸的 URL（否则当前壁纸会被套上旧壁纸的档位 4）。
      if (String(selection.id || "") !== wid) { persistSelection(); emit(); return; }
      // 落盘只能挂在这条分支上（不能挂在下面那个 `if` 里）：`setSetting("url", …)` 只在有
      // `sceneFrameUrl` 时才发，而上面刚写的 `customFrames` / `frameVariants` 是**客户端持久化字段**
      // —— 漏掉 persist 就是"导入的自定义画面刷新后不见了"（同族缺陷的另一头）。
      if (sel.sceneFrameUrl) setSetting("url", frameUrlWithVariant(sel.sceneFrameUrl, 4));
      else persistSelection();
      syncLayers(); emit();
    }).catch(() => { /* 导入失败保持现状 */ });
  };
  const onClearCustomFrame = () => {
    if (!sel.id) return;
    const wid = String(sel.id);
    apiDelete("/custom-frame/" + encodeURIComponent(wid))
      .then((r) => {
        if (!r.ok) throw new Error("宿主返回 " + r.status);
        setCustomFrameLocal(wid, false);
        const map = Object.assign({}, selection.frameVariants || {});
        const cur = Number(map[wid]) || 0;
        if (cur === 4) map[wid] = 0;
        selection.frameVariants = map;
        if (String(selection.id || "") !== wid) { persistSelection(); emit(); return; }
        if (cur === 4 && sel.sceneFrameUrl) {
          setTransient("url", frameUrlWithVariant(sel.sceneFrameUrl, 0));
          syncLayers();
        }
        persistSelection(); emit();
      }).catch(() => { /* ignore */ });
  };

  // ESC anywhere closes the library view. Capture phase + stopPropagation so the
  // shell's own ESC handling (which may close the whole settings panel) never
  // sees the key while the view is open.
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && selection.pickerOpen) {
        e.stopPropagation();
        closePicker();
      }
    };
    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("keydown", onKey, true);
      return () => { window.removeEventListener("keydown", onKey, true); };
    }
  }, []);

  // ── 页签状态：调节面板分六个页签（壁纸库/外观/播放/系统/扩展/关于 —— 前四个由原六域
  //    合并，「扩展」「关于」后加），每份实例独立记忆（设置页与仓库抽屉互不影响）；只存
  //    localStorage，不进 config.json。useState 必须在下方早退分支之前调用（Rules of Hooks）。 ──
  const [activeTab, setActiveTab] = React.useState(readSavedPickerTab);
  const switchTab = (id) => {
    if (!PICKER_TABS.some((t) => t.id === id) || id === activeTab) return;
    // 切页签 ⇒ 清掉待确认（不变量 3）：问句行随页签一起离屏，不能留着它等回来。
    disarmConfirm();
    // 下钻的库视图也随页签一起退出：否则切走再切回来，看到的还是库而不是该页内容。
    if (selection.pickerOpen) setTransient("pickerOpen", false);
    setTransient("pickerDraft", false);
    // 「关于」页才去问 star 数（TTL 内是空操作）：别的页签一次网络都不发。
    if (id === "about") loadStarCount(false);
    setActiveTab(id);
    try { localStorage.setItem(PICKER_TAB_KEY, id); } catch { /* ignore */ }
  };
  // 停在「关于」页刷新页面这条路径不走 switchTab（activeTab 直接从 localStorage 读出来），
  // 用一次订阅式 effect 补上；TTL 同日历口径，重复触发是空操作。
  React.useEffect(() => { if (activeTab === "about") loadStarCount(false); }, [activeTab]);

  // ── 外观页各节的折叠态（本档 = 设置页）──────────────────────────────────────────
  //    用户口径（2026-10-11 二次修订）：「设置页则是**全部开启**但也支持隐藏」⇒
  //    下面五个门在本档**默认都展开**，但每个都能点节头收起（与侧边栏同一套构件）。
  //    与侧边栏那一侧同序：细节 / 玻璃 UI / 侧边栏圆角 / 全局 UI 配色 / 全局字体。
  //    hook 必须在早退分支之前调用（Rules of Hooks），与 activeTab 相邻。
  const [pickerFontOpen, setPickerFontOpen] = React.useState(readSavedPickerFontOpen);
  const togglePickerFontSection = () => {
    setPickerFontOpen((prev) => {
      const next = !prev;
      writeSavedPickerFontOpen(next);
      return next;
    });
  };
  const [pickerUiColorOpen, setPickerUiColorOpen] = React.useState(readSavedPickerUiColorOpen);
  const togglePickerUiColorSection = () => {
    setPickerUiColorOpen((prev) => {
      const next = !prev;
      writeSavedPickerUiColorOpen(next);
      return next;
    });
  };
  // 「细节 / 玻璃 UI / 侧边栏圆角」三节（2026-10-11 二次修订：设置页也支持隐藏）。
  // ⚠️ 与上面两个同形，但三者共用一条读法（都默认展开）—— 所以抽成一个**自定义 hook**
  //    生成，避免把同一段"读-写-翻转"抄三遍（抄三遍就一定会有一处漏写 localStorage）。
  //    名字必须以 `use` 开头：它内部调 `React.useState`，React 的规则要求 hook 只能从
  //    组件或**另一个 hook** 里以固定顺序调用（三次调用顺序恒定 ⇒ 合法）。
  const usePickerSectionOpen = (key) => {
    const [open, setOpen] = React.useState(() => readSavedPickerOpen(key));
    const toggle = () => setOpen((prev) => {
      const next = !prev;
      writeSavedPickerOpen(key, next);
      return next;
    });
    return [open, toggle];
  };
  const [pickerDetailOpen, togglePickerDetailSection] = usePickerSectionOpen(PICKER_DETAIL_OPEN_KEY);
  const [pickerGlassUiOpen, togglePickerGlassUiSection] = usePickerSectionOpen(PICKER_GLASS_UI_OPEN_KEY);
  const [pickerCornersOpen, togglePickerCornersSection] = usePickerSectionOpen(PICKER_CORNERS_OPEN_KEY);
  const [pickerPresetsOpen, togglePickerPresetsSection] = usePickerSectionOpen(PICKER_PRESETS_OPEN_KEY);

  // 本机字体清单的触发点**两处都有**（2026-10-11 三次修订）：字体节回到设置页之后，
  // 这里也要一份 —— 否则「全局字族」那排下拉在本档是空的死旋钮（清单由宿主现扫描）。
  // 三条门与侧栏那侧同形：停在外观页 + 字体节展开 + 字体自定义打开；TTL 内是空操作。
  React.useEffect(() => {
    if (activeTab === "appearance" && pickerFontOpen && sel.fontCustom) ensureSystemFonts(false);
  }, [activeTab, pickerFontOpen, sel.fontCustom]);

  // 侧栏深链（快捷播放面板底栏的「更多外观设置 ›」/「更多播放设置 ›」）：请求"打开
  // 设置页后停在哪一页"。打开对话框由 src/sidebar-right.js 的 DOM 路径负责，这里只管
  // 落地 —— 走**同一个 switchTab**（清待确认 / 退出下钻 / 写 localStorage 这些副作用
  // 一处不落），落地后把请求清掉（一次性；否则用户几分钟后自己开设置会被旧请求劫持）。
  // 组件没挂载时请求就先躺在 store 里，挂载后这一趟 effect 消费它 —— 两条路都覆盖。
  React.useEffect(() => {
    const req = selection.settingsTabRequest;
    if (!req) return;
    if (req === activeTab || !PICKER_TABS.some((t) => t.id === req)) {
      setTransient("settingsTabRequest", "");
      return;
    }
    switchTab(req);
  }, [sel.settingsTabRequest, activeTab]);

  // 库视图虚拟滚动的窗口（机制与几何见 src/picker-modal.js 顶注）：hooks 必须长在组件
  // 里（renderPickerModal 是纯渲染器），经 ctx 传下去。classic CD 架不虚拟化 ⇒ 渲染侧
  // 不把 gridRef 挂到网格上，测量 effect 拿不到元素就整体空转。count 给**上界**（正常 /
  // 隐藏两个列表 + 关闭卡都 ≤ 库存 + 1；无滚动容器时窗口 = count，渲染侧按真实列表
  // 长度钳），viewTag 戳这份窗口量自哪个形态 —— 换形态 / 开关下钻的一帧按未测量处理
  // （首窗 + 零占位），测量 effect 随 tag 进 deps 立刻跟上。
  const pickerGridRef = React.useRef(null);
  const pickerRootRef = React.useRef(null);
  // ── 吉祥物 3D 环的「面板宽度」（2026-10-11：「左右拉宽、顶格」）──────────────────────
  // 环要随可用宽度等比放大才填得满，而**渲染器是纯函数、拿不到宽度** ⇒ 在这里量一次、
  // 经 ctx 的 `paneWidth` 传下去（渲染器量不到时退回 scale=1，见 panel-tabs 的 SCALE）。
  // 量的是**环那一行的可用宽度**（`.we-picker__mascot-carousel` 是 width:100% 的 flex 行，
  // 它的宽度不随窗口的 max-width 变 ⇒ 拿它当"可用宽度"不会自我指涉）。
  // ⚠️ 这个控件住在**系统**页签（不是外观）⇒ deps 用 `activeTab`，切到系统页时重量一次；
  //   只在挂载时量会让"先开壁纸页再切系统页"永远停在 scale=1（**实测踩过**）。
  // ⚠️ 元素**不存在时不更新**（而不是写 0）：别的页签上根本没有这个元素，写 0 会白白触发
  //   一次重渲染；到了系统页自然会重量到真值。
  const [paneW, setPaneW] = React.useState(0);
  React.useEffect(() => {
    const root = pickerRootRef.current;
    if (!root) return undefined;
    const measure = () => {
      const el = root.querySelector(".we-picker__mascot-carousel");
      if (!el || !el.clientWidth) return;                 // 本页签没画它 ⇒ 保持原值
      const w = el.clientWidth;
      // 容差 2px：避免亚像素抖动把整棵面板反复重渲染。
      setPaneW((prev) => (Math.abs(prev - w) < 2 ? prev : w));
    };
    measure();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(root);
    window.addEventListener("resize", measure);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [activeTab]);
  const pickerViewTag = sel.pickerOpen
    ? (sel.modalView === "hidden" ? "hidden" : (sel.pickerDraft ? "draft" : "normal"))
    : "closed";
  const pickerVwin = qpVirtWindow(pickerGridRef, (sel.inventory.wallpapers || []).length + 1,
    PICKER_CARD_H, PICKER_CARD_GAP, true, pickerViewTag);

  if (!sel.loaded) {
    return React.createElement("div", { className: "we-picker" },
      React.createElement("span", { className: "we-picker__hint" }, weT("扫描 Wallpaper Engine…")));
  }
  if (sel.inventory.error) {
    return React.createElement("div", { className: "we-picker" },
      React.createElement("div", { className: "we-picker__error" },
        weT("未检测到 Wallpaper Engine：{error}", { error: weT(sel.inventory.error) })),
      React.createElement("button", {
        className: "we-picker__btn", type: "button", onClick: onRefresh, disabled: sel.loading,
      }, sel.loading ? weT("刷新中…") : weT("重试")));
  }

  const list = sel.inventory.wallpapers;
  // 派生数据 + 分页全部由 **src/picker-model.js** 算（`pickerModel`）：可播放网格、两个
  // 过滤下拉的分档计数、隐藏列表，以及三个列表各自的当页切片。搜索是大小写不敏感的
  // 标题子串匹配（空查询 = 不过滤），每页 24 张，页号越界自动 clamp。这里只把状态喂
  // 进去、把结果取出来 —— 组件体不再就地算这些（分级/类型/隐藏的判定也在那边）。
  const {
    query, playableList, basePlayable, ratingCounts, typeCounts, hiddenList,
    editorPageView,
  } = pickerModel({
    wallpapers: list,
    hiddenIds: selection.hiddenIds,
    search: sel.search,
    ratingFilter: sel.contentRatingFilter,
    typeFilter: sel.typeFilter,
    editorPage: sel.editorPage,
  });
  // CD-rack mode: compact one-page grid (no pagination, no virtualization —
  // aspect-ratio cards with overlapping rows don't fit the fixed-pitch model).
  const cdMode = sel.pickerLayout === "classic";
  const current = list.find((w) => w.id === sel.id) || null;
  const uploadedList = list.filter((w) => isUploadedWallpaper(w) && !isDirWallpaper(w));
  const groups = sel.rotationGroups;
  const group = activeRotationGroup();
  const candidates = rotationCandidates();
  const playableCount = candidates.length;
  const editing = sel.editing;

  // ── 壁纸属性面板的接线────────────────────────────────────
  // 面板标记搬去了 `src/picker-props-panel.js`（构建期内联回本作用域）。这里只做**组装**：
  // 面板状态（开关 / token / 加载态 / 错误 / 属性表 / 实时渲染是否接管）与三个动作
  // （该重拉时重拉、改一个属性、恢复默认）都留在本文件 —— 状态与处理器是 ctx 的**供给方**，
  // 渲染器只拿值 + 回调（同模态框那条契约）。判定就一句：
  // token 变了且不在加载中才重拉。
  // ── 页签面板内容（函数声明提升，renderActiveTab 在 return 里先调用）──────
  // 六页签 = 三个单渲染器（「外观」「扩展」「关于」）+ 两个合并渲染器（「播放」= 效果 + 声音，
  // 「系统」= 吉祥物 + 高级）+ 壁纸库。「关于」不取任何 ctx 字段（静态页）；「扩展」自己也不读
  // 字段，但要把 ctx **整包转交**给注册表里的模块（每个模块的控件由它自己的渲染器画）。
  const extensionCtx = () => ({
    sel: selection,
    onFxEnabled, onFxClick, onFxClickStyle, onFxClickSize, onFxClickGlow,
    onFxTrail, onFxTrailStyle, onFxTrailLength, onFxTrailWidth, onFxTrailGlow,
    onFxOpacity, onFxBlend, onFxColorMode, onFxColor,
    onParallaxEnabled, onParallaxBg, onParallaxMascot, onParallaxUi, onParallaxSmooth,
    onParallaxPlugin,
    onParallaxUiChatDepth, onParallaxUiComposerDepth, onParallaxUiSidebarDepth, onParallaxUiBubbleDepth,
    onParallaxPluginDepth,
    // 认到的插件槽位（用户口径 m02697-②）：只给**槽键字符串**（画一行一个）。发现逻辑在
    // src/parallax-layer.js（与层自己每帧扫的是同一份名单），这里只是转交；**插件前端那一块
    // 自己的开关**（用户诉求 m03549）关着时层也不认它们，面板就跟着空 —— 名单与"真的会动"
    // 必须同源，否则会出现点了没反应的滑杆。它与「界面元素跟随」互不依赖（不是 `ui &&`）。
    parallaxPluginSlots: sel.parallaxPlugin === true ? parallaxDiscoveredGroups().sort() : [],
    onAvatarEnabled, onAvatarSize, onAvatarRadius, onAvatarPick, onAvatarClear,
    // 上传裁切（issue #191 问题 1）：几何在这里现算（唯一实现），渲染器只读结果。
    onAvatarCropZoom, onAvatarCropDrag, onAvatarCropConfirm, onAvatarCropCancel: closeAvatarCrop,
    avatarCropGeo: avatarCropGeometry(), avatarCropView: AVATAR_CROP_VIEW,
    // 超限拦截（#185 后续）：面板画提示行 + 「自动压缩后导入」按钮，处理器在 client 这一侧。
    onAvatarAutoCompress,
    // 模块级重置（issue #192）：各模块头的 ↺ 把该模块的键整批写回默认值。
    onResetModule,
  });
  const renderActiveTab = () => {
    if (activeTab === "about") return renderAboutTab({});
    if (activeTab === "extensions") return renderExtensionsTab(extensionCtx());
    if (activeTab === "appearance") return renderAppearanceTab({
      setSetting, setTransient,
      fontSet: fontSetCtx(),
      glassPresets: glassPresetCtx(),
      // 「全局字体」节的折叠态（ADR-0008 D4 三次修订）：设置页也画那一节 ⇒ 本档自己一份
      // 开合状态（picker-font-open），展开后字体清单由上面的 effect 去要。
      fontOpen: pickerFontOpen, onToggleFontSection: togglePickerFontSection,
      // 「全局 UI 配色」节（含原「输入光标」节的光标颜色行）：同样本档自己一份开合状态；
      // 处理器是模块级的（onAccent / onCaretColor / onToggleUiColorCustom / onUiColorElement）。
      uiColorOpen: pickerUiColorOpen, onToggleUiColorSection: togglePickerUiColorSection,
      onToggleUiColorCustom, onUiColorElement,
      officialColorOf, onAccent, onCapsuleBlur, onCapsuleColor, onBlur, onBorder, onCaretColor, onChatGlassFidelity, onComponentFamily, onComponentFont, onExtraGlassSelectors, onFontAdvanced, onFontResetAll, onGlassAlpha, onGlassColor, onGlassDarkSeparate, onGlassFidelity, onGlobalFamily, onLeftSidebarGlass, onTitlebarGlass, onRefreshSystemFonts, onSidebarAllCorners, onSidebarAlpha, onSidebarBlur, onSidebarColor, onSidebarContentAlpha, onSidebarContentColor, onSidebarCornerRadius, onSidebarCornerSquare, onSidebarFollowGlobal, onSidebarGlass, onSidebarFullClear, onThemeColor, onThemeColorClear, onThemeDarkSeparate, onThemeFamily, onThemeSize, onThemeTypeOnly, onThemeWeight, onThinkingMode, onToggleFontCustom, onToggleThemeFollow, sel,
      // 玻璃 UI 子项开关 + 独立配置 + 独立参数（见 onToggleChildIndependent 那段注释）
      onToggleChildIndependent, onGlassChildParam, childIndependentOn,
      // 2026-10-11 二次修订：设置页也**支持隐藏**这几节（默认全展开）——
      // 「细节 / 玻璃 UI / 侧边栏圆角」三个门是本档新增的，与「全局 UI 配色 / 全局字体」
      // 那两个同形。顺序与侧边栏同序（两侧都走 renderAppearanceTab 这一处装配）。
      // 「主题预设」（2026-10-12）：与其他节同口径升折叠节 —— 只在设置页画 ⇒ 没有侧栏半边。
      detailOpen: pickerDetailOpen, onToggleDetailSection: togglePickerDetailSection,
      glassUiOpen: pickerGlassUiOpen, onToggleGlassUiSection: togglePickerGlassUiSection,
      cornersOpen: pickerCornersOpen, onToggleCornersSection: togglePickerCornersSection,
      // 模块级重置（issue #192）：外观页签下每个模块（主题 / 细节 / 玻璃 UI / 侧边栏圆角 /
      // 全局 UI 配色 / 全局字体）节头右端各一枚 ↺。
      onResetModule,
      presetsOpen: pickerPresetsOpen, onTogglePresetsSection: togglePickerPresetsSection,
    });
    if (activeTab === "playback") return React.createElement(React.Fragment, null,
      renderEffectsTab({
        setSetting, setTransient,
        onBackgroundBrightness, onBackgroundContrast, onBackgroundSaturate, onClearCustomFrame, onClearGpuFrame, onCustomFrameFile, onFlip, onFpsCap, onLayerPositionX, onLayerPositionY, onLayerReset, onLayerScale, onLiveBootDelay, onObjectFit, onOpenPicker, onPlaybackRate, onRecaptureGpuFrame, onRefreshFrame, onSceneLiveFps, onScrim, onToggleSceneLive, onWallpaperBlur, onWallpaperOpacity, sel, setPickerOpener,
      }),
      renderAudioTab({
        setSetting, setTransient,
        onToggleAudio, onVideoVolume, sel,
      }),
    );
    if (activeTab === "system") return React.createElement(React.Fragment, null,
      renderMascotTab({
        onMascotClear, onMascotPick, onRopeFormChange, onMascotFormConfirm, onDisarmConfirm: disarmConfirm, onRopeScaleChange, onRopeVisibilityChange, sel,
        // ⚠️⚠️ 吉祥物环的等比缩放基准**必须接在这一档**（2026-10-11 实测「左右拉宽没生效」）：
        //   吉祥物控件由**系统**页签渲染（不是外观页签），我上一轮把它加进了外观档的 ctx
        //   ⇒ 渲染器永远收到 undefined ⇒ scale 恒为 1、拉宽毫无效果。
        //   而当时的判据是**直接调 renderMascotTab**（隔离测试）⇒ 它当然全绿。
        //   教训：隔离测试证明不了"线接上了"；接线必须单独有判据（见 verify-client 的接线判据）。
        paneWidth: paneW,
      }),
      renderAdvancedTab({
        setSetting, setTransient,
        onAdapterTarget, onEdgeCompatChange, onLayoutChange, onPauseOnBattery, onPauseOnBlur, onPauseOnHidden, onToggleLiveDiag, sel,
        onStartEditCacheDir, onCancelEditCacheDir, onCacheDirDraft,
        onCacheDirBrowseInput, onCacheDirBrowseGo, onCacheDirBrowseEnter, onCacheDirBrowseUp, onPickCacheDir, onCloseCacheDirBrowse,
      }),
    );
    return renderWallpaperTab({
      setSetting, setTransient,
      INTERVALS, armedConfirm: sel.armedConfirm, cdMode, current, editing, editorPageView, group, groups, isLiveScene, onArmConfirm: armConfirm, onArmDeleteGroup, onCancelEditUploadDir, onCancelEditWeAssetsDir, onClear, onDeleteGroup, onDisarmConfirm: disarmConfirm, onEditInterval, onEditName, onEditOrder, onGroupChange, onGroupInterval, onOpenPicker, onOpenPickerDraft, onRefresh, onStartEditUploadDir, onStartEditWeAssetsDir, onSwitchTransition, onSwitchTransitionDir, onSwitchTransitionSpeed, onToggleAudio, onTogglePlay, onTogglePropsPanel, onToggleRotation, onUploadDirDraft, onWeAssetsDirDraft, pagerRow, playableCount, playableList, playbackLive, propsPanelOpen, renderUserPropsPanel, sel, setPickerOpener, uploadedList,
    });
  };
  const tabIdx = Math.max(0, PICKER_TABS.findIndex((t) => t.id === activeTab));

  return React.createElement("div", { className: "we-picker", "data-we-cards": sel.pickerLayout, ref: pickerRootRef },
    // ── Card header (mirrors the skin-center's pluginCard header): plugin
    //    name + live wallpaper count badge + description. ──
    React.createElement("div", { className: "we-picker__card-head" },
      React.createElement("span", { className: "we-picker__card-name" }, weT("壁纸引擎")),
      React.createElement("span", { className: "we-picker__card-badge" }, String(playableList.length)),
      React.createElement("span", { className: "we-picker__card-desc" }, weT("本地 Wallpaper Engine 壁纸 · 液态玻璃主题")),
    ),
    // ── 页签栏（分段式）：六个页签互斥展示，替代三十控件的单列长滚动。
    //    指示胶囊随 activeTab 平移（transform 合成器属性，不引发布局）；宽度按
    //    PICKER_TABS.length 现算 ⇒ 加页签只改那张表，这里零改动。 ──
    React.createElement("div", { className: "we-tabs", role: "tablist", "aria-label": weT("壁纸引擎设置分区") },
      React.createElement("span", {
        className: "we-tabs__pill",
        "aria-hidden": "true",
        style: {
          width: "calc((100% - 6px) / " + PICKER_TABS.length + ")",
          transform: "translateX(" + tabIdx * 100 + "%)",
        },
      }),
      PICKER_TABS.map((t) => React.createElement("button", {
        key: t.id,
        type: "button",
        role: "tab",
        "aria-selected": activeTab === t.id ? "true" : "false",
        className: "we-tabs__tab" + (activeTab === t.id ? " we-tabs__tab--active" : ""),
        onClick: () => switchTab(t.id),
      }, t.label)),
    ),
    React.createElement("div", { className: "we-tabpanel", role: "tabpanel" },
      // 库视图是**页内下钻**：pickerOpen 时页签面板整区切换成
      // 壁纸网格，ESC / 顶部「返回」退出，切页签也会退出（见 switchTab）。
      sel.pickerOpen ? renderPickerModal({
        sel, closePicker, current, playbackLive, playableList, hiddenList,
        cdMode, query, basePlayable, ratingCounts, typeCounts,
        gridRef: pickerGridRef, vwin: pickerVwin,
        armedConfirm: sel.armedConfirm, onArmConfirm: armConfirm, onDisarmConfirm: disarmConfirm,
        onClear, onRatingFilterChange, onTypeFilterChange,
        onShowNormalView, onShowHiddenView,
        onToggleBatchMode, onArmBatchHide, onBatchHide, onBatchCancel, onSearchInput, onPickCard,
      }) : React.createElement(React.Fragment, null,
        // 页签内容 → **每个页签末尾一个重置**（issue #192 用户口径：重置指定选项卡）→
        // 全局重置（只在「系统」页签末尾，即设置页里最接近"最底部"的位置）。
        renderActiveTab(),
        renderTabReset({
          armedConfirm: sel.armedConfirm, onArmConfirm: armConfirm,
          onDisarmConfirm: disarmConfirm, onResetTab,
        }, activeTab),
        activeTab === "system"
          ? renderResetSection({
              armedConfirm: sel.armedConfirm, onArmConfirm: armConfirm,
              onDisarmConfirm: disarmConfirm, onResetAll,
            })
          : null,
      )),
  );
}

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
// host (src/sidebar-right.js 是唯一模式真源):
//   · harness ≥0.1.5（有官方右侧栏）：点击/下拉 → openTab 展开右侧栏的「壁纸」
//     tab（快捷播放面板融进官方侧栏，抽屉不启动）；
//   · 低版本宿主：点击/下拉 → 右滑抽屉（玻璃面板自右向左划出，内容同一份
//     QuickPanel），上推 / ESC / 收起 关闭。拖拽全程有跟手预览（合成器属性
//     直写 DOM，不进 React 渲染路径）。

// ── Rope artwork ────────────────────────────────────────────────────────────
// The original chibi ship-whale maid used to be inlined here as `ROPE_IMG`.
// 2026-10-13 (upstream design): it is no longer a built-in form. The very same
// bytes now live in the 「作者自用」 factory preset as an embedded custom artwork
// (`lib/glass-presets/factory-author.json`, assets.mascot.data) — an easter egg.
// Alternate rope artwork: the full-body whale "onee-san" maid (source 1024×1536,
// downscaled to 384×576, transparent) — a second selectable mascot form. Taller
// portrait (aspect 2:3) than the chibi, so its base box below differs; the <img>
// still fills .we-rope__art with object-fit: contain.
const ROPE_IMG_WHALE = "data:image/png;base64,__ROPE_ART_WHALE__";
// Third rope artwork: Phoebe Jiubi — the blonde chibi gripping the rope (source 1254×1254,
// downscaled to 384×384, transparent) — square 1:1 like the chibi proportions; the
// drawn rope runs in from the top edge, same convention as the maid artwork.
const ROPE_IMG_PHOEBE = "data:image/png;base64,__ROPE_ART_PHOEBE__";
// ── 八只「模型娘」（2026-10-11 用户提供）──────────────────────────────────────
// 每个模型一张竖版立绘（源图 2048×2048，四周 20–28% 是透明留白 ⇒ **先裁到 alpha 紧致
// 包围盒再缩放**，否则等于白存那些像素）。统一缩放到**高 384**、转 base64 内联 ——
// 与「Deepseek_Pro」同档（她也 384），显示盒 64 宽时约 4.8× 余量，ropeScale 放大也不糊。
// 源资产归档在 assets/mascot/（不进 npm 包），流程见那里的 README。
const ROPE_IMG_CLAUDE = "data:image/png;base64,__ROPE_ART_CLAUDE__";
const ROPE_IMG_DEEPSEEK = "data:image/png;base64,__ROPE_ART_DEEPSEEK__";
const ROPE_IMG_GEMINI = "data:image/png;base64,__ROPE_ART_GEMINI__";
const ROPE_IMG_GPT = "data:image/png;base64,__ROPE_ART_GPT__";
const ROPE_IMG_GLM = "data:image/png;base64,__ROPE_ART_GLM__";
const ROPE_IMG_GROK = "data:image/png;base64,__ROPE_ART_GROK__";
const ROPE_IMG_KIMI = "data:image/png;base64,__ROPE_ART_KIMI__";
const ROPE_IMG_QWEN = "data:image/png;base64,__ROPE_ART_QWEN__";


// Rope forms: artwork + a display label + a base box size (before the user
// scale). The box aspect mirrors the image so object-fit: contain fills it with
// no letterboxing; the drag/clamp maths read the real rendered box at runtime.
const ROPE_FORMS = {
  // ── 两只内置：用户自绘（`maid` 已于 2026-10-13 从出厂形态除名 —— 那只图搬进「作者自用」
  //    出厂预设当内嵌的自定义立绘）。⚠️ `phoebe` 在 2026-10-11 换了**竖版**立绘（源
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

function RopeDock() {
  useWeLocale(); // 语言切换 → 吉祥物/抽屉里的文案跟着换（见 src/i18n.js）
  const sel = useStore();
  const hidden = !sel.ropeShown;
  // 立绘：自定义优先（用户导入的那张），否则当前形态的内置图（同一条解析见 ropeArtOf）。
  const art = ropeArtOf(sel);
  const scale = clampNum(sel.ropeScale, ROPE_SCALE_MIN, ROPE_SCALE_MAX, 1);
  // The artwork's base box scaled by the user's size setting (rounded to px);
  // written inline so the .we-rope CSS box follows it and ropeSize() reads it.
  const box = { w: Math.round(art.w * scale), h: Math.round(art.h * scale) };
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState(() => readRopePos(box));
  const ropeRef = React.useRef(null);
  const panelRef = React.useRef(null);
  const dragRef = React.useRef(null);

  const ropeSize = () => {
    const el = ropeRef.current;
    if (el && el.offsetWidth > 0) return { w: el.offsetWidth, h: el.offsetHeight };
    return box;
  };
  const clampX = (x) => {
    const w = (typeof window !== "undefined" && window.innerWidth) || 1280;
    return ropeClamp(x, ROPE_VIEW_MARGIN, Math.max(ROPE_VIEW_MARGIN, w - ropeSize().w - ROPE_VIEW_MARGIN));
  };
  const clampY = (y) => {
    const h = (typeof window !== "undefined" && window.innerHeight) || 800;
    return ropeClamp(y, ROPE_EDGE_INSET, Math.max(ROPE_EDGE_INSET, h - ropeSize().h - ROPE_VIEW_MARGIN));
  };
  // Live drag preview on the panel: p ∈ [0,1], 1 = fully open. The panel is a
  // right-edge drawer — it slides in from the RIGHT (translateX) as it opens.
  // Written as inline styles (compositor-only props) straight to the DOM —
  // bypassing React state keeps QuickPanel out of the per-pointermove render path.
  const applyPreview = (p) => {
    const el = panelRef.current;
    if (!el) return;
    const q = ropeClamp(p, 0, 1);
    // Follow the pull with a gentle, regulated glide (a set "speed") rather
    // than a 1:1 snap: the drawer eases after the hand (weighty, not twitchy).
    // On commit the inline transition is cleared so the slow open/close run
    // takes over from wherever the hand left the panel.
    el.style.transition = "transform 440ms cubic-bezier(0.25, 0.8, 0.25, 1), opacity 320ms ease";
    el.style.visibility = "visible";
    el.style.opacity = String(q);
    el.style.transform = "translateX(" + ((1 - q) * 102).toFixed(2) + "%)";
  };
  const clearPreview = () => {
    const el = panelRef.current;
    if (!el) return;
    el.style.transition = "";
    el.style.visibility = "";
    el.style.opacity = "";
    el.style.transform = "";
  };

  const onRopePointerDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const el = ropeRef.current;
    if (!el || dragRef.current) return;
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    dragRef.current = {
      id: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      baseX: pos.x, baseY: pos.y,
      lastX: pos.x, lastY: pos.y,
      moved: false,
    };
    el.classList.add("we-rope--dragging");   // kill the settle transition while following the finger
    el.classList.remove("we-rope--settle");
    e.preventDefault();
  };
  const onRopePointerMove = (e) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && dx * dx + dy * dy < 9) return; // dead zone: treat jitter as a click
    d.moved = true;
    d.lastX = clampX(d.baseX + dx);
    d.lastY = clampY(d.baseY + dy);
    const el = ropeRef.current;
    if (el) { el.style.left = d.lastX + "px"; el.style.top = d.lastY + "px"; }
    // Follow-hand preview: pull down opens (when closed), push up closes (when open).
    // 官方态没有抽屉可预览（面板在右侧栏里）—— 只跟手移动吉祥物，不出抽屉影子。
    if (sidebarRightMode() === "official") { clearPreview(); return; }
    if (!open && dy > ROPE_PREVIEW_START) {
      applyPreview((dy - ROPE_PREVIEW_START) / (ROPE_OPEN_THRESHOLD - ROPE_PREVIEW_START));
    } else if (open && dy < -ROPE_PREVIEW_START) {
      applyPreview(1 - (-dy - ROPE_PREVIEW_START) / (ROPE_OPEN_THRESHOLD - ROPE_PREVIEW_START));
    } else {
      clearPreview();
    }
  };
  // 吉祥物触发的统一入口（click / 手势 / 快捷键共用一组模块级开关，见
  // src/sidebar-right.js 的 wallSidebarToggle/Open/Close）：官方态 → 控制器切换
  // 右侧栏（展开且正显示「壁纸」⇒ 收起；否则展开并聚焦本 tab）；抽屉态 → 开关抽屉。
  const finishDrag = (clientX, clientY, canceled) => {
    const d = dragRef.current;
    const el = ropeRef.current;
    dragRef.current = null;
    if (!el) return;
    el.classList.remove("we-rope--dragging");
    el.classList.add("we-rope--settle");
    if (d) {
      const dy = clientY - d.startY;
      // 点击 = 开/关切换；下拉 ≥ 阈值 = 开；上推 ≥ 阈值 = 关（官方态收起同样由此统一）。
      if (!canceled && !d.moved) wallSidebarToggle();
      else if (!canceled && dy >= ROPE_OPEN_THRESHOLD) wallSidebarOpen();
      else if (!canceled && dy <= -ROPE_OPEN_THRESHOLD) wallSidebarClose();
    }
    clearPreview(); // committed class transitions continue smoothly from the inline value
    // Snap to the TOP edge; Y resets to the top inset while X stays wherever
    // the user dragged it (clamped so the rope is never lost off-screen). The
    // rope is a pull-cord that hangs from the top, so it always returns there.
    const x = d ? d.lastX : pos.x;
    const next = { x: clampX(x), y: ROPE_EDGE_INSET };
    // Write the snapped coords imperatively TOO: if they happen to equal the
    // previous React-managed values, React would skip the style diff and the
    // rope would stay wherever the finger left it instead of settling.
    if (el) { el.style.left = next.x + "px"; el.style.top = next.y + "px"; }
    setPos(next);
    try { localStorage.setItem(ROPE_POS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const onRopeKeyDown = (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); wallSidebarToggle(); }
  };

  // ESC anywhere closes the panel — unless the picker modal is open. The
  // modal's handler sits on WINDOW capture and calls stopPropagation, which
  // halts the event BEFORE it reaches this DOCUMENT-level capture listener,
  // so ESC closes the modal first and the panel survives. When no modal is
  // open the event arrives here and closes the panel.
  React.useEffect(() => {
    if (typeof document === "undefined" || !document.addEventListener) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape" || selection.pickerOpen) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  // Keep the rope inside the viewport when the window shrinks/grows.
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.addEventListener) return undefined;
    const onResize = () => setPos((p) => ({ x: clampX(p.x), y: clampY(p.y) }));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // When the mascot FORM or SIZE actually changes (bigger box), re-clamp the
  // position so a larger form (e.g. whale) never ends up half off-screen. The
  // ref skips the FIRST run (the box is pristine on mount), so the default
  // path adds no extra setPos/render/paint in the kiosk window — keeping the
  // markup identical to the build that shipped the lazy-mounted panel.
  const lastBoxRef = React.useRef(null);
  React.useEffect(() => {
    const last = lastBoxRef.current;
    lastBoxRef.current = box;
    if (last && (last.w !== box.w || last.h !== box.h)) {
      setPos((p) => ({ x: clampX(p.x), y: clampY(p.y) }));
    }
    // 依赖数组刻意收窄成 box.w / box.h：只有形态尺寸真的变了才需要重新钳位
    // （上面那段"首次运行不做事"的纪律靠它成立）。clampX / clampY / setPos 是稳定引用，
    // 补进依赖数组只会让这个 effect 每次渲染都白跑一遍 setPos。
  }, [box.w, box.h]);

  // Hidden ⇒ 抽屉必须关上（吉祥物没了，它的面板入口也没了）。
  React.useEffect(() => {
    if (hidden) setOpen(false);
  }, [open, hidden]);

  // 模块桥（src/sidebar-right.js 的 ropeDrawerControl）：抽屉的三个动作注册给
  // 快捷键与统一开关使用 —— 组件 state 只能由组件自己改。吉祥物隐藏时撤销注册
  // （此时抽屉开不出来，快捷键 resolve 走 pass 不吞键）；卸载时同样撤销。
  React.useEffect(() => {
    if (hidden) { ropeDrawerControl = null; return undefined; }
    ropeDrawerControl = {
      toggle: () => setOpen((o) => !o),
      open: () => setOpen(true),
      close: () => setOpen(false),
    };
    return () => { ropeDrawerControl = null; };
  }, [hidden]);

  // Hidden: render nothing (rope + drawer), but keep the one-time update
  // notice — it is independent of the mascot and must still surface. The
  // preset intro dialog rides the same rule (independent of mascot too).
  if (hidden) {
    return React.createElement(React.Fragment, null,
      React.createElement(UpdateNotice, null),
      React.createElement(PresetIntroDialog, null),
    );
  }

  // Rope style: only emit an explicit box size when it differs from the
  // stylesheet's default (52×57 at 1× — the box the retired chibi maid used). At the default the rope is
  // exactly CSS-sized, so we leave width/height out — making the default markup
  // byte-identical to the build that shipped the lazy-mounted panel (no extra
  // layout/compositing the kiosk window could trip on).
  const ropeStyle = { top: pos.y + "px", left: pos.x + "px" };
  if (box.w !== 52 || box.h !== 57) {
    ropeStyle.width = box.w + "px";
    ropeStyle.height = box.h + "px";
  }

  return React.createElement(React.Fragment, null,
    React.createElement("div", {
      ref: ropeRef,
      className: "we-rope we-rope--settle",
      style: ropeStyle,
      role: "button",
      tabIndex: 0,
      "aria-label": weT("壁纸库拉绳：沿顶部拖动移动位置，向下拉打开壁纸库面板"),
      title: weT("壁纸库 · 沿顶部拖动 / 向下拉打开"),
      onPointerDown: onRopePointerDown,
      onPointerMove: onRopePointerMove,
      onPointerUp: (e) => finishDrag(e.clientX, e.clientY, false),
      onPointerCancel: (e) => finishDrag(e.clientX, e.clientY, true),
      onKeyDown: onRopeKeyDown,
    },
      React.createElement("div", { className: "we-rope__art", "aria-hidden": "true" },
        React.createElement("img", { className: "we-rope__img", src: art.img, alt: "", draggable: false }),
      ),
    ),
    React.createElement("aside", {
      ref: panelRef,
      className: "we-repo-panel" + (open ? " we-repo-panel--open" : ""),
      "aria-hidden": String(!open),
      "aria-label": weT("壁纸库面板"),
      // Closed panel must not expose focusable descendants to Tab / AT.
      inert: open ? undefined : "",
    },
      React.createElement("header", { className: "we-repo-panel__head" },
        React.createElement("span", { className: "we-repo-panel__title" }, weT("壁纸库")),
        React.createElement("button", {
          type: "button",
          tabIndex: open ? 0 : -1,
          className: "we-picker__btn",
          onClick: () => setOpen(false),
        }, weT("收起")),
      ),
      React.createElement("div", { className: "we-repo-panel__body" },
        // Lazy-mount the panel only while the drawer is open: keeping it mounted
        // behind a hidden full-viewport fixed panel was the biggest compositing
        // footprint of the rope dock — a driver of the kiosk-window white flash.
        // 内容与官方侧栏 tab 同一份（QuickPanel），壳只有这一个抽屉。
        open ? React.createElement(QuickPanel, { dock: "drawer" }) : null,
      ),
    ),
    React.createElement(UpdateNotice, null),
    React.createElement(PresetIntroDialog, null),
  );
}

// ── One-time "what's new" notice ─────────────────────────────────────────────
// The notice carries five user-facing stories:
//   ① session avatars got a big import upgrade — SVG / GIF / BMP / AVIF now
//      supported, oversized images get an「auto-compress & import」escape hatch,
//      and a crop dialog runs before upload (Extensions tab),
//   ② a batch of fixes — live scene wallpapers in multiple windows stop kicking
//      each other off; web-wallpaper audio reactivity under the strict sandbox;
//      inline code in thinking blocks, native dropdown popups and the preset
//      dialog display correctly again,
//   ③ Linux X11 occlusion power saving — a covered window drops frames, a fully
//      covered one pauses (more battery left),
//   ④ a bold tip: enabling dark mode + the「作者自用」preset is one of the
//      plugin's best looks.
// The notice art (GitHub star plea, shipped as lib/about/update-notice.jpg and
// served by the /about-qr whitelist route — same family as the contact QRs,
// NOT inlined: see src/about-assets.js) sits at the top with a caption
// pointing at 设置 → 壁纸引擎 → 关于. The dismissal version is stored WITH the
// settings (host file, port-independent) so it survives DSH Desktop's random
// --port restarts and never re-shows after being closed. Bump NOTICE_VERSION
// next release to announce something new again (swap the art bytes in
// lib/about/, the path stays put — ETag revalidation picks it up).
//
// ⚠️ 公告**等配图就绪才弹**（art-gate，见 UpdateNotice）：面板 bundle 宿主每次开页
// 都从磁盘现读，而后端路由只在 DSH 重启时换血 —— 更新后未重启的窗口期里，旧后端
// 的 /about-qr 白名单还没有 update-notice.jpg ⇒ 图 404。若照旧立刻弹窗，用户看到
// 裂图，而「知道了」一关整版公告永久退场，配图等于永远没人看到。
// ⚠️ 2026-10-15 公告随新版本换血：v1.3.2 之后的一整批（头像导入大升级 / 修复一批 /
// Linux 遮挡省电 / 深色模式 + 作者自用提示；求星按钮已按用户口径回退）。配图沿用
// 「星来」那张、caption 保留；哨兵升到下一版号 ——
// 看过 1.3.2 公告的机器重弹一次，是设计意图。
const NOTICE_VERSION = "1.3.3";
// 公告内容改版（新增「侧边栏只是简略版」大字说明 + 配图缩小）必须升哨兵：
// 否则看过旧版的用户永远看不到新说明，改了等于没改 ⇒ 重弹一次是设计意图。
// 配图就绪探针的节奏：HEAD 轮询到新白名单在场（= 后端已重启）才弹；旧后端一直
// 不在场超过 WAIT 则降级为**无图**弹出（文案信息完整；求星入口在「关于」页常驻，
// 不靠弹窗这一条命）。探针打在 /about-qr 上是自清洁的：404 响应 no-store、200
// no-cache（lib/routes/about-qr.js），怎么轮询都不会污染 Electron 缓存。
const NOTICE_ART_WAIT_MS = 90000;
// 探针的**退避表**（不是固定间隔）：旧后端在场时，1.5s 一拍的固定轮询在一个时限里就是
// 60 个 HEAD，而每个 404 都会在 DevTools 控制台留下一行 —— 用户看到的是"一屏红字"
// （实测：未重启的后端 + 面板多开几次 ≈150 行 404）。
// 请求本身是自清洁的，但刷屏不是。换成 1.5→3→6→12→30（表尾封顶）后，同一时限内
// 总请求数 **≤10**（见 noticeArtSchedule），而"新后端一上线就带图弹"的灵敏度几乎不变
// —— 第一拍仍在挂载瞬间，最坏情况只是晚一拍发现。
const NOTICE_ART_BACKOFF_MS = [1500, 3000, 6000, 12000, 30000];
// 同一次**页面加载**内只探一个结论：面板可反复开关（每次挂载都新建组件、重跑 effect），
// 但"这台机器上这个后端有没有那张图"是页面级事实 —— 缓存下来后多开面板只发一轮请求。
// 空串 = 还没结论；"ready"/"timeout" 是**终态**（不做 TTL：页面刷新即重新探，恰好等价于
// "后端重启后刷新页面就能拿到图"）。用模块级变量而不是 store 字段：纯视图态，进 store
// 会平白多一对瞬态字段要过直写棘轮（与 art 用组件本地 state 同一条理由）。
let noticeArtVerdict = "";

/**
 * 配图探针的时刻表（**纯函数**：判据在真源码上跑它，见 test/verify-about.mjs ⑤）。
 * @param {number} waits   总时限（ms）—— 到点仍未就绪就降级
 * @param {number[]} backoff 退避表（ms，表尾持续复用 = 封顶）
 * @returns {number[]} 每次请求的相对时刻（ms），首个恒为 0（挂载即探）
 * 末拍允许被时限**截短**（`min(step, left)`）：这样"等满时限"那一拍仍然真的发出，
 * 降级判定紧跟其后（失败回来时看是否超时）。
 */
function noticeArtSchedule(waits, backoff) {
  const out = [0];
  let t = 0;
  let i = 0;
  for (;;) {
    const left = waits - t;
    if (left <= 0) break;
    const step = backoff[Math.min(i, backoff.length - 1)];
    const next = t + Math.min(step, left);
    if (next <= t) break;
    out.push(next);
    t = next;
    i += 1;
  }
  return out;
}

// ❗ 的字体强制：U+2757 在正文字体栈里落到细杆字形（实测渲染成细红竖线，用户口径
// 是"红色感叹号"）—— 单包一层 span 强制走 Segoe UI Emoji，出来的才是胖红感叹号。
const noticeEx = (n) => React.createElement("span",
  { style: { fontFamily: '"Segoe UI Emoji", "Noto Color Emoji", sans-serif' } }, "❗".repeat(n) + " ");

function UpdateNotice() {
  useWeLocale(); // 更新说明是长文案，语言切换后要跟着换（同一棵 RopeDock 子树）
  const sel = useStore();
  // Art-gate 探针：pending（探测中，什么都不弹）→ ready（新后端在场，带图弹）→
  // timeout（等满 WAIT 仍 404，降级为无图弹）。用组件本地 state 而不是共享
  // selection —— 纯视图态，进 store 会平白多一对瞬态字段要过直写棘轮。
  const [art, setArt] = React.useState(noticeArtVerdict || "pending");
  // Only render once the host settings (source of truth) are applied, so the
  // persisted noticeSeen is final. On a fresh port/restart the localStorage
  // origin is empty (noticeSeen == "") and would briefly flash the notice before
  // the host GET merges the real value — wait for hostLoaded to avoid that.
  const eligible = sel.hostLoaded && sel.noticeSeen !== NOTICE_VERSION;
  React.useEffect(() => {
    // 已关过本版公告的用户一个请求都不发（每次开面板都探一遍是纯浪费）。
    if (!eligible) return undefined;
    // 同一页面已有结论 ⇒ 直接采纳，一个请求都不再发（多开面板 / 来回切页不复探）。
    if (noticeArtVerdict) { setArt(noticeArtVerdict); return undefined; }
    let alive = true;
    const timers = [];
    const schedule = noticeArtSchedule(NOTICE_ART_WAIT_MS, NOTICE_ART_BACKOFF_MS);
    const probe = (i) => {
      // apiHead 不抛（api-client 契约）：404/断网都是 ok:false —— 落到时刻表的下一拍，
      // 走完最后一拍仍在 404 就降级（timeout = 无图弹出，文案信息完整）。
      apiHead(NOTICE_ART_PATH).then((r) => {
        if (!alive) return;
        if (r.ok) { noticeArtVerdict = "ready"; setArt("ready"); return; }
        if (i + 1 >= schedule.length) { noticeArtVerdict = "timeout"; setArt("timeout"); return; }
        timers.push(setTimeout(() => probe(i + 1), schedule[i + 1] - schedule[i]));
      });
    };
    timers.push(setTimeout(() => probe(0), schedule[0]));
    return () => { alive = false; for (const t of timers) clearTimeout(t); };
  }, [eligible]);
  const show = eligible && (art === "ready" || art === "timeout");
  const dismiss = () => {
    // Persist the dismissed version through the settings pipeline (localStorage
    // cache + host file). emit() re-renders this component (useStore) to hide it.
    setSetting("noticeSeen", NOTICE_VERSION);
    emit();
  };
  if (!show) return null;
  return React.createElement("div", { className: "we-update-notice", role: "alert" },
    React.createElement("div", { className: "we-update-notice__title" }, weT("🎉 更新：头像导入大升级 · 一组修复 · 省电与外观提示")),
    // 只有 ready 才渲染配图与说明行（timeout 降级态无图弹出，正文信息自足）。
    // 2026-10-12 配图换「星来」，但**求星路径指引保留**（用户口径）：图下那行
    // 「关于页一键直达」是用户找到点星入口的唯一指引，不随配图换血退场。
    art === "ready" ? React.createElement("img", { className: "we-update-notice__art", src: apiUrl(NOTICE_ART_PATH), alt: weT("新朋友「星来」登场") }) : null,
    art === "ready" ? React.createElement("div", { className: "we-update-notice__art-cap" },
      React.createElement("strong", null, weT("在设置中的壁纸引擎页面中的关于中可一键直达，谢谢喵！"))) : null,
    React.createElement("div", { className: "we-update-notice__body" },
      // 2026-10-15 换血（用户口径：简单公告）：延续「简洁 + 大字」——只讲四件事，
      // 全部走 16pt callout（.we-update-notice__callout），每条一句不加尾巴长文。
      React.createElement("p", { className: "we-update-notice__callout" },
        "① ", noticeEx(2), React.createElement("strong", null, weT("头像导入大升级！")),
        weT("现支持 SVG / GIF 等更多格式，超大图可自动压缩，上传前还能先裁切 —— 都在「扩展」分页。")),
      React.createElement("p", { className: "we-update-notice__callout" },
        "② ", noticeEx(2), React.createElement("strong", null, weT("修复一批")),
        weT("：多窗口实时渲染不再互相踢掉；网页壁纸音频可视化恢复跳动；设置图标对齐、思考块行内代码与下拉弹层显示恢复正常。")),
      React.createElement("p", { className: "we-update-notice__callout" },
        "③ ", noticeEx(2), React.createElement("strong", null, weT("Linux 用户更省电")),
        weT("：窗口被遮挡时自动降帧，完全遮挡时暂停渲染。")),
      React.createElement("p", { className: "we-update-notice__callout" },
        "④ ", noticeEx(2), React.createElement("strong", null, weT("在设置中启用深色模式 + 「作者自用」预设，为本插件最佳效果之一！"))),
      React.createElement("p", { className: "we-update-notice__hint" },
        weT("升级后建议重启一次 DSH，改动才完整生效；本提示每个新版本只出现一次，点下方按钮关闭后不再弹出。")),
    ),
    React.createElement("button", { className: "we-update-notice__btn we-picker__btn", type: "button", onClick: dismiss }, weT("知道了")),
  );
}

// ── One-time preset intro dialog（「作者自用」推广弹窗，2026-10-12 用户口径）──────────
// 方案：更新后弹**一次性**对话框，由用户自选 —— A：采用「作者自用」（作者日常在用、
// 兼顾美观与可读性，降低新用户上手难度）；B：保持当前设置不变。不强制：老调参用户选
// B 即可，答过就不再问。
// ⚠️ 哨兵住 **settings**（`presetIntroSeen`，2026-10-16 修正 2026-10-12 的口径）：
// 最初这标记放 localStorage —— 但 localStorage 按**源**（协议+主机+端口）隔离，而 DSH
// Desktop 每次启动都换一个随机 `--port 0` 回环端口 ⇒ 每次启动都是一份全新空存储，已读
// 标记自清 ⇒ 弹窗每次开机重弹（更新公告没这毛病：noticeSeen 一开始就走设置通道、落宿主
// config.json，与端口无关）。搬进 settings 后跨重启存活；与 noticeSeen 一样挂
// `PRESET_EXCLUDED_KEYS` ⇒ 不进任何预设快照（"答没答过"是每机状态，不是外观配置）。
// 升级到本版时每个用户**最后再被问一次**（旧 localStorage 标记救不回来 —— 它本就活不过
// 一次重启），答完（A/B 均可）之后永久安静。
// ⚠️ 排在公告**之后**：门控借用 NOTICE_VERSION 本尊（noticeSeen 已写 = 公告已处理）
// —— 同一次更新先读"有什么新"，再答"要不要换外观"，两个弹窗不同屏。
const PRESET_INTRO_VERSION = "1";
// 后端代际探针（#188）：弹窗 A 键走 applyPreset("factory-author")，而宿主半边只在 DSH
// 重启时换血 —— 升级窗口期（磁盘已是新版、宿主内存还是旧路由）里这个 GET 必然失败，
// 弹窗必然报错。与更新公告的 art-gate 同一条防线：**探到 200 才允许弹**。
// 非 200 就不弹、也**不写**已读哨兵 —— 重启后端后（同一次升级里）弹窗照常出现，
// 用户不会永久错过；区别只是"在必然失败的窗口期里保持安静"。
// 探针打正文路由而不是清单：弹窗要应用的就是这一份，它 200 才有弹的意义（清单 200
// 只说明路由挂了，说明不了这条随包预设读得懂 —— 旧后端读新 tag 文件正是读不懂）。
// 结论缓存到模块级（与 noticeArtVerdict 同口径）：面板可反复开关，"这台机器上这个
// 后端认不认这份预设"是页面级事实，多开面板只探一轮；页面刷新重新探，恰好等价于
// "重启后刷新就能弹"。
let presetIntroProbeVerdict = "";
function PresetIntroDialog() {
  useWeLocale(); // 与公告同一条口径：文案跟随语言切换
  const sel = useStore();
  // 已答过 = 设置通道的哨兵（`sel.presetIntroSeen`）。hostLoaded 之前它可能还是启动缓存
  // 或空值 —— 没关系，eligible 的 hostLoaded 门会把未定态挡住（与公告同一道防线，
  // 见 UpdateNotice 里"localStorage 空源会闪一下"的对应注释）。
  const seen = sel.presetIntroSeen === PRESET_INTRO_VERSION;
  // 探针态："pending"（在探，不弹）/"ok"（后端认，可弹）/"no"（后端不认，不弹）。
  // 组件本地 state 而不是 store 字段：纯视图态，进 store 会平白多一对瞬态字段要过
  // 直写棘轮（与公告 art 态同一条理由）。
  const [probe, setProbe] = React.useState(presetIntroProbeVerdict || "pending");
  const [applying, setApplying] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  // 记已读 = 写设置通道（落宿主 config.json，跨重启存活）：与公告 dismiss 同一条路。
  // emit() 让本组件经 useStore 重渲染 ⇒ seen 翻 true、eligible 翻 false，弹窗退场。
  const markSeen = () => {
    setSetting("presetIntroSeen", PRESET_INTRO_VERSION);
    emit();
  };
  // A 键 = 与预设卡片同一条 applyPreset 整快照链（settings 合并 + 资产落位 + 失败滚回）。
  // 失败**不**记已读：弹窗留在原地，错误文案读 glassPresetError 现值（与卡片同一通道，
  // emit 后重渲染拿到的就是本次失败的 freshly 值 —— 本地 state 只记"要不要显示错误行"）。
  const accept = () => {
    if (applying) return;
    setApplying(true);
    setFailed(false);
    setTransient("glassPresetError", ""); // 清掉面板里可能挂着的旧错，别让它串场
    emit();
    applyPreset("factory-author").then((ok) => {
      setApplying(false);
      if (ok) markSeen(); else setFailed(true);
    });
  };
  const eligible = sel.hostLoaded && !seen && sel.noticeSeen === NOTICE_VERSION;
  // 探针只在 eligible 时起跑：已答过/公告未处理完的机器一个请求都不发。
  React.useEffect(() => {
    if (!eligible) return undefined;
    if (presetIntroProbeVerdict) { setProbe(presetIntroProbeVerdict); return undefined; }
    let alive = true;
    gpJson(glassPresetUrl("factory-author")).then((r) => {
      if (!alive) return;
      // 200 = 后端这份预设读得懂（路由与 tag 同代）⇒ 弹。其余（404/405/422/断网）
      // 都归 "no"：不管哪种，A 键在这个后端上都必然失败，不值得打扰用户。
      presetIntroProbeVerdict = r.ok && !r.error ? "ok" : "no";
      setProbe(presetIntroProbeVerdict);
    });
    return () => { alive = false; };
  }, [eligible]);
  if (!eligible || probe !== "ok") return null;
  return React.createElement("div", { className: "we-preset-intro", role: "alertdialog", "aria-label": weT("试试「作者自用」外观预设？") },
    React.createElement("div", { className: "we-preset-intro__title" }, weT("试试「作者自用」外观预设？")),
    React.createElement("div", { className: "we-preset-intro__body" },
      React.createElement("p", null, weT("「作者自用」是作者日常在用的整机外观方案：兼顾美观与可读性，一键套用、不用逐项调。")),
      React.createElement("p", null, weT("采用后当前外观设置会被整份替换（不能一键撤销）；选择保持的话，随时可在「设置 → 壁纸引擎 → 主题预设」里再套用。")),
      failed && sel.glassPresetError ? React.createElement("p", { className: "we-preset-intro__err" }, sel.glassPresetError) : null,
    ),
    React.createElement("div", { className: "we-preset-intro__actions" },
      React.createElement("button", { className: "we-preset-intro__btn we-preset-intro__btn--primary", type: "button", disabled: applying,
        onClick: accept }, applying ? weT("正在应用…") : weT("采用「作者自用」")),
      React.createElement("button", { className: "we-preset-intro__btn", type: "button", onClick: markSeen }, weT("保持我的设置")),
    ),
  );
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

// ── 软件光栅化探测 ─────────────────────────────────────────────────────────
// 某些第三方桌面外壳（增强 / 扩展窗口模式，通常是软件合成）里 `backdrop-filter`
// 被静默忽略：属性语法仍然被接受，所以 `@supports not (backdrop-filter: …)`
// 永远为真 —— 那条回退根本不会启用，玻璃面板就变成「过透」（全透）。因此这里做
// 运行时探测：真的去建一个 WebGL 上下文并读渲染器字符串，如果它是软件光栅器
// （或连上下文都建不出来），就把 body[data-we-glass-fallback] 挂上，让 CSS 用
// 既有的近不透明配方接管（见 CSS 里那一段）。
// 手动覆盖（用户排障 / 维护者无 GPU 环境复现）：
//   ?we-glassfallback=on|1  → 强制回退 · off|0 → 强制关闭 · 其他值 = 自动探测
// 只探测一次并缓存 —— applyEffects 每次设置变动都会读它。
// 全程 typeof 守卫 + try/catch：非浏览器 / 验证沙箱里绝不抛出，也绝不改变行为。
const SOFT_RENDER_RE = /swiftshader|software|llvmpipe|softpipe|microsoft basic render|angle \(software|stack-gl/i;
let softRenderFallback; // undefined = 未探测 · true = 软件/无 WebGL · false = 硬件
function detectSoftwareRender() {
  if (softRenderFallback !== undefined) return softRenderFallback;
  softRenderFallback = false;
  try {
    // 手动覆盖优先于一切探测（缓存最终决定）。
    if (typeof location !== "undefined" && location && typeof location.search === "string") {
      let raw = "";
      if (typeof URLSearchParams === "function") {
        raw = new URLSearchParams(location.search).get("we-glassfallback") || "";
      } else {
        const m = /[?&]we-glassfallback=([^&]*)/.exec(location.search);
        raw = m ? decodeURIComponent(m[1]) : "";
      }
      const flag = String(raw).toLowerCase();
      if (flag === "on" || flag === "1") return (softRenderFallback = true);
      if (flag === "off" || flag === "0") return (softRenderFallback = false);
    }
    if (typeof document === "undefined" || !document
        || typeof document.createElement !== "function") return softRenderFallback;
    const canvas = document.createElement("canvas");
    if (!canvas || typeof canvas.getContext !== "function") return (softRenderFallback = true);
    let gl = null;
    try { gl = canvas.getContext("webgl"); } catch { /* ignore */ }
    if (!gl) { try { gl = canvas.getContext("experimental-webgl"); } catch { /* ignore */ } }
    // 连 WebGL 上下文都拿不到 → 没有硬件合成，backdrop-filter 必定不生效。
    if (!gl) return (softRenderFallback = true);
    let renderer = "";
    let vendor = "";
    try {
      const dbg = typeof gl.getExtension === "function" && gl.getExtension("WEBGL_debug_renderer_info");
      if (dbg && typeof gl.getParameter === "function") {
        renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "";
        vendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || "";
      }
      // 没有调试扩展（或被隐私设置屏蔽）时退回公开的 RENDERER / VENDOR。
      if (!renderer && typeof gl.getParameter === "function" && gl.RENDERER !== undefined) {
        renderer = gl.getParameter(gl.RENDERER) || "";
      }
      // VENDOR 只是同一判定的第二个可读串（实测：本仓库自带的 supreium-headless-gl
      // 是软件光栅器，但 RENDERER 只报裸 "ANGLE"，软件线索只出现在 VENDOR="stack-gl"，
      // 且它不暴露 WEBGL_debug_renderer_info）—— 浏览器硬件链路不会因此误判。
      if (!vendor && typeof gl.getParameter === "function" && gl.VENDOR !== undefined) {
        vendor = gl.getParameter(gl.VENDOR) || "";
      }
    } catch { /* 读不到渲染器字符串：不判定为软件渲染 */ }
    softRenderFallback = SOFT_RENDER_RE.test(String(renderer) + " " + String(vendor));
    // 礼貌释放：只探测一次，但也不给页面永久占一个 WebGL 槽位。
    try {
      const lose = typeof gl.getExtension === "function" && gl.getExtension("WEBGL_lose_context");
      if (lose && typeof lose.loseContext === "function") lose.loseContext();
    } catch { /* ignore */ }
  } catch { /* 探测异常：保持 false（不改变既有行为） */ }
  return softRenderFallback;
}

function apply(ctx) {
  // 0. i18n：把插件文案接上宿主的 locale 服务（`ctx.get("locale")`，可选服务 + 短轮询 ——
  //    缺服务时静默停在默认语言，见 src/i18n.js）。放在最前面：界面首次渲染就要按当前
  //    语言取词；服务通常已在（dsh-web-app 的 base bundle 自带），轮询只是兜底。
  if (ctx.effect) ctx.effect(() => weI18nAttach(ctx) || undefined);

  // 1. Mount the behind-body wallpaper + scrim layers and keep them in sync
  //    with the selection store. ctx.effect gives fiber-lifetime cleanup.
  if (ctx.effect) {
    ctx.effect(() => {
      const unsub = subscribe(syncLayers);
      const unsubEffects = subscribe(applyEffects);
      // 「扩展」页签二号模块（点击效果与拖尾效果）的画布层：接法与壁纸层同形 —— 每次
      // emit 重判一次"该不该活"。它只在"总开关开着且点击或拖尾至少一个没关"时才活，
      // 并且**内容驱动**——没有轨迹点、没有存活的特效时它自己停下 rAF 并清空画布，
      // 光标不动就不耗帧。参数不在这里传：那一层每帧现读 `selection`。
      const unsubFx = subscribe(syncFxLayer);
      // 「扩展」页签三号模块（3D 效果）的视差层：接法同上，但它是**唯一不建 DOM 的一层** ——
      // 每帧把算完的位移直接写进要动的那几个元素自己的 CSS 独立属性 translate（零自定义属性
      // 写入 ⇒ 整棵子树不重算样式；总开关属性 data-we-parallax 仍挂在 body 上），
      // 另加一张"谁跟着动"的规则段在 src/styles.js。它只在"总开关开着"时才活，并且
      // **收敛驱动**——屏上剩下的位移看不出来就停 rAF，光标不动不耗帧（跟随真实刷新率）。
      const unsubParallax = subscribe(syncParallaxLayer);
      // 「扩展」页签一号模块（自定义会话头像）的装饰层：接法同上。它是**唯一改宿主会话 DOM**
      // 的一层 —— 给消息行补头像节点（观察者 + 就地更新），关掉时逐字节恢复原样。
      const unsubAvatar = subscribe(syncAvatarLayer);
      // 启动对时：挂载后的第一次 emit 由 applySelection 触发，但「轮播开关 / 场景实时
      // 渲染 / 帧率档 / 播放倍速」这族键不在 emit 订阅链里（syncRotationTimer /
      // syncSceneAudio 需显式调用）—— preset-store 的 reapplyAll() 只在应用预设时跑。
      // 这里补一次对时，让挂载那一刻就按真实设置运转（幂等：按当前值重排定时器 / 音频）。
      try { reapplyAll(); } catch { /* 挂载期静默：无媒体层时是空操作 */ }
      // Occlusion pause: re-apply the effective playing state whenever the
      // page hides/shows or the window loses/gains focus (see occlusionActive).
      // Fires syncLayers → play/pause on the video; decode drops to 0 while
      // minimized / covered by another app, exactly like desktop WE.
      const onOcclusionChange = () => emit();
      const ocListeners = [];
      if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
        for (const t of ["visibilitychange", "blur", "focus"]) {
          window.addEventListener(t, onOcclusionChange);
          ocListeners.push(t);
        }
      }
      // 视频壁纸的**提交前预热**：指针按到/停在卡片上时就把它预到元数据（见 src/video-layer.js
      // 的 warmVideoUrl）—— 点击发生在抬手，按下→抬手、以及鼠标停在卡片上的这段时间都是白捡的
      // 窗口（手动点选没有准备链）。capture + passive：不拦事件、不进冒泡链。
      const onWarmPointerDown = (ev) => { try { warmVideoForPointer(ev, true); } catch { /* ignore */ } };
      const onWarmPointerOver = (ev) => { try { warmVideoForPointer(ev, false); } catch { /* ignore */ } };
      let warmBound = false;
      if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
        document.addEventListener("pointerdown", onWarmPointerDown, { capture: true, passive: true });
        document.addEventListener("pointerover", onWarmPointerOver, { capture: true, passive: true });
        warmBound = true;
      }
      // 可见性恢复（最小化 → 还原 / 页面从 bfcache 回来）：**只在"隐藏 → 可见"这一个方向**
      // 做两件事 —— 一次两帧的复合成微推（见 nudgeWallpaperRepaint）与"画面真的回到屏上了吗"
      // 的留痕（见 probeWallpaperOnScreen）。普通 focus（用户点回窗口）不做，否则每次点窗口
      // 都要动一次层；两件事都是事件级、不进热路径。
      const onBackVisible = () => {
        if (typeof document !== "undefined" && document.hidden) return;   // 还在隐藏态
        try { nudgeWallpaperRepaint(); } catch { /* ignore */ }
        try { probeWallpaperOnScreen("back-visible"); } catch { /* ignore */ }
      };
      let backVisBound = false, pageShowBound = false;
      if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
        document.addEventListener("visibilitychange", onBackVisible);
        backVisBound = true;
      }
      if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
        window.addEventListener("pageshow", onBackVisible);
        pageShowBound = true;
      }
      // 客户端 JS 异常的**留痕**：这台机器打不开 DevTools ⇒ 没有这一条，一次渲染期异常就只剩
      // "UI 崩了"这句转述（实测过：面板白屏时诊断缓冲里什么也没有）。只**记录**、不改行为；
      // 与其它监听器一样随 fiber 注销（HMR 重挂不会叠）。
      const onClientError = (ev) => {
        try {
          const err = ev && (ev.error || ev.reason);
          const type = (ev && ev.type) ? ev.type : "error";
          const msg = String((err && err.message) || (ev && ev.message) || err || ev || "").slice(0, 240);
          const where = (err && err.stack) ? " @ " + String(err.stack).split("\n").slice(0, 3).join(" <- ") : "";
          liveLog("client-error", type + ": " + msg + where);
        } catch { /* 连记录都失败就放弃，绝不在错误处理里再抛 */ }
      };
      if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
        window.addEventListener("error", onClientError);
        window.addEventListener("unhandledrejection", onClientError);
      }
      // 遮挡判定**不能只靠事件**：原生模态（`window.confirm` / `alert`）会把焦点交给自己的窗口，
      // 而**回来时的 focus 事件不保证送达** —— 判定就会一直停在「窗口失焦」，壁纸从此不恢复
      // （真机形态：删除确认弹窗之后壁纸停住、输入框也收不到键，只剩重载能救）。
      // 事件之外再**低频复核**一次，且只在判定**变了**时 emit ⇒ 常态零代价、不 churn。
      let lastOcclusion = occlusionReason();
      let ocWatch = 0;
      if (typeof setInterval === "function") {
        ocWatch = setInterval(() => {
          const now = occlusionReason();
          if (now === lastOcclusion) return;
          lastOcclusion = now;
          // 留痕：这条日志是"事件丢了、靠复核补上"的唯一事后证据（真机排查时缺的就是它）。
          try { liveLog("play-state", liveStateBrief("occlusion-recheck")); } catch { /* ignore */ }
          emit();
        }, OCCLUSION_RECHECK_MS);
      }
      // 持久化监听器: pagehide → 立即 flush 未落盘的设置; visibilitychange →
      // 页面回到前台时重试失败过的 PUT。注册在这里 (而不是模块作用域) 才能随
      // fiber 注销 — 否则每次插件重载/HMR 都会在同一页面再叠一对, 永不释放。
      // 字体集是**另一条**通道（src/fontset-store.js），同形但各自记自己的脏标记 ⇒ 各自注册。
      let pageHideBound = false, visBound = false;
      let fontPageHideBound = false, fontVisBound = false;
      if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
        window.addEventListener("pagehide", onPageHideFlush);
        pageHideBound = true;
        window.addEventListener("pagehide", onPageHideFlushFontSet);
        fontPageHideBound = true;
      }
      if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
        document.addEventListener("visibilitychange", onVisibilityResyncPersist);
        visBound = true;
        document.addEventListener("visibilitychange", onVisibilityResyncFontSet);
        fontVisBound = true;
      }
      // 样式标签也按 fiber 生命周期注入 (dispose 会移除, 见下方 cleanup)
      ensurePluginCss();
      // Battery optimization (省电暂停): navigator.getBattery is deprecated but
      // still functional in Chromium; feature-detected so other engines just
      // no-op. 'chargingchange' covers plug/unplug; onOcclusionChange re-applies
      // the effective playing state.
      let batteryCleanup = null;
      let disposed = false;
      if (typeof navigator !== "undefined" && typeof navigator.getBattery === "function") {
        navigator.getBattery().then((bm) => {
          // The plugin effect may have been torn down (disable / HMR) while
          // this promise was pending — registering listeners then would leak.
          if (disposed) return;
          weBattery = bm;
          bm.addEventListener("chargingchange", onOcclusionChange);
          batteryCleanup = () => bm.removeEventListener("chargingchange", onOcclusionChange);
          emit(); // already on battery → pause immediately
        }).catch(() => { /* battery API unavailable: no-op */ });
      }
      syncLayers();
      applyEffects();
      syncFxLayer();
      syncParallaxLayer();
      syncAvatarLayer();
      return () => {
        disposed = true;
        unsub();
        unsubEffects();
        unsubFx();
        unsubParallax();
        unsubAvatar();
        if (ocWatch) { try { clearInterval(ocWatch); } catch { /* ignore */ } ocWatch = 0; }
        if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
          for (const t of ocListeners) window.removeEventListener(t, onOcclusionChange);
          if (pageShowBound) window.removeEventListener("pageshow", onBackVisible);
          window.removeEventListener("error", onClientError);
          window.removeEventListener("unhandledrejection", onClientError);
          if (pageHideBound) window.removeEventListener("pagehide", onPageHideFlush);
          if (fontPageHideBound) window.removeEventListener("pagehide", onPageHideFlushFontSet);
        }
        if (backVisBound && typeof document !== "undefined" && typeof document.removeEventListener === "function") {
          document.removeEventListener("visibilitychange", onBackVisible);
        }
        if (warmBound && typeof document !== "undefined" && typeof document.removeEventListener === "function") {
          document.removeEventListener("pointerdown", onWarmPointerDown, { capture: true });
          document.removeEventListener("pointerover", onWarmPointerOver, { capture: true });
        }
        if (visBound && typeof document !== "undefined" && typeof document.removeEventListener === "function") {
          document.removeEventListener("visibilitychange", onVisibilityResyncPersist);
        }
        if (fontVisBound && typeof document !== "undefined" && typeof document.removeEventListener === "function") {
          document.removeEventListener("visibilitychange", onVisibilityResyncFontSet);
        }
        if (batteryCleanup) { batteryCleanup(); batteryCleanup = null; }
        weBattery = null;
        clearRotationTimer();
        // 卸载/禁用要收掉「进行中的准备」与「领养槽位」：否则 staged iframe 继续
        // 跑 rAF/WebGL、探测 <video> 以无句柄后台解码器的形态活到页面关闭，
        // 而且 prep 的兜底定时器之后仍会 commit（往已卸载的插件里建层）。
        cancelRotationPrepare();
        disposePreparedMedia();
        // 预热槽位同一条纪律：留着就是一个没有句柄的解复用器（页面关闭前不会自己走）。
        disposeWarmVideo();
        // 点击与拖尾效果的画布层：DOM 节点、指针监听与 rAF 循环同样在那一层自己手里
        // （它的 rAF 只在自己还有内容时续帧，所以这里主要是摘节点 + 解绑监听）。
        disposeFxLayer();
        // 3D 效果的视差层：它没有 DOM 节点与画布，收尾就是把监听、rAF 与 body 上的
        // 那几个 CSS 变量 / 开关属性一起摘掉（否则换过一次重挂还会残留着上一份位移）。
        disposeParallaxLayer();
        // 会话头像层：收尾 = 摘掉注入的头像节点与行标记、断开观察者、撤掉开关属性与两个
        // 变量（"关掉 = 逐字节回到原生"这条不变量在卸载路径上的同一个动作）。
        disposeAvatarLayer();
        // 关掉音频闸并退役渐变中的旧层：禁用/重挂时旧层不能被留在屏上等退役定时器
        // （≤1.3s 的可见残留），闸也不该跨过一次重挂活着（准备链的 BGM 起播会被它
        // 推迟到那个定时器触发为止）。这两条收尾本身是正确性要求：跨过一次重挂活着的闸
        // 会让准备链的 BGM 起播被推迟，而留在屏上的旧层要等退役定时器（≤1.3s 可见残留）。
        // 先清闸、再退役渐变层：卸载不是「渐变结束」，走放行会 restoreNodeAudio →
        // syncSceneAudio → play()，刚被闸压住的场景 BGM 反而在禁用时响一下（smoke 场景 H
        // 锁定）。清掉闸后 retireFadingLayer 内部的
        // releaseRotationAudioGateFor 直接早退；场景音频元素也一并拆掉 —— 不拆的话
        // 禁用后正在播的 BGM 不会停止。
        rotationAudioGate = null;
        retireFadingLayer();
        stopSceneAudioEl();
        cancelLiveFrameBackfill(); // 卸载后不得再发 HEAD/PUT（少这一步就漏一次）
        stopLiveWatch();
        cancelLiveMount("unload"); // 延迟期那个正在预热的渲染页也要终止（否则卸载后仍在后台跑）
        abortTranscodeUpgrade(); // 含 clearUpgradePoll + AbortController.abort（否则卸载后 500ms 轮询永久泄漏）
        cancelPendingPersist(); // 模块级 persistTimer 不属于 fiber：不取消则 200ms 后仍会写一次
        cancelPendingFontSet(); // 字体集那条通道的 timer 同理（各自一个模块级 timer）
        // media-info 探测的 AbortController 也要断开 (token 可能永远不再变化)
        abortMediaInfoProbe();
        // sceneVideo 时序补拉: 卸载后不该再拉 inventory (也不该钉住本次求值的闭包)
        if (sceneVideoResyncTimer && typeof window !== "undefined" && typeof window.clearTimeout === "function") {
          window.clearTimeout(sceneVideoResyncTimer);
        }
        sceneVideoResyncTimer = null;
        weStopDraw();
        const node = document.getElementById(LAYER_ID);
        if (node) { releaseLayerMedia(node); node.remove(); }
        const scrim = document.getElementById(SCRIM_ID);
        if (scrim) scrim.remove();
        clearEffects();
        setWallpaperActive(false);
        // 主样式标签: 每次 bundle 求值都会注入一份 (HMR 后旧 <style>
        // 永久留在 <head>), 故只移除本次求值这一代, 重挂载由 ensurePluginCss() 补回。
        if (typeof document !== "undefined" && typeof document.querySelector === "function") {
          const cssTag = document.querySelector("style[data-plugin-css=" + JSON.stringify(TAG_ID) + "]");
          if (cssTag && cssTag.dataset && cssTag.dataset.pluginCssGen === CSS_GEN
              && typeof cssTag.remove === "function") cssTag.remove();
        }
      };
    });
  }

  // 1b. F1「文字颜色角色」令牌层：后台轮询 theme 服务（启动竞态：实测 7ms 时还没有、
  //     325ms 才有），拿到后按设置给每个角色上色；拿不到就**什么都不做** —— 全局
  //     令牌层是**唯一**的上色通道：`#we-font-patch` 那类全局回落通道已不存在，
  //     所以拿不到服务时角色色就是不上色，而不是换一条腿顶上。
  //     - 不声明 `inject: ["theme"]`：缺服务时声明式依赖会让插件 park（F0 A7）。
  //     - 首次写入前先取宿主墨色基线，否则退出契约会把我们的颜色当宿主原值快照。
  //     - 不监听配色变化重注册：值给的是 {light,dark} 对，配色切换由服务自己换值。
  if (ctx.effect && typeof ctx.get === "function" && typeof document !== "undefined") {
    ctx.effect(() => {
      let layer = null;
      // F2 排版层：**必须独立 source** —— 同 source 再注册会整层替换，会把颜色层顶掉。
      // 它不碰 --dsw-alias-label-*，因此与宿主墨色基线（onBeforeFirstWrite）无关。
      let typeLayer = null;
      let unsub = null;
      const cancelPoll = pollThemeService(ctx, {
        intervalMs: 250,
        timeoutMs: 6000,
        onReady: (theme) => { themeFollowAttach(theme, ctx);   // 主题随壁纸：同一个服务句柄，接上即补评一次（开关默认关，关着时这次补评整体空转）
          try {
            const available = scanThemeTokens(document);
            // 样式表扫描是清单的权威来源（active.tokens 为空、exportInspectTokens 只有 14 条）；
            // 再叠一层 computed 存在性探测，跨源样式表读不到 cssRules 时也能判定。
            const hasToken = (t) => available.has(t)
              || (typeof getComputedStyle === "function"
                && getComputedStyle(document.body).getPropertyValue(t).trim() !== "");
            layer = createThemeLayer({
              theme,
              // 绑在「字体自定义」总开关下：关闭 = 连颜色一起恢复原生（与面板文案一致）。
              // `|| {}` 是第二道：这几个 getter 会在**订阅回调**里被调到，而订阅回调不在 try 里 ——
              // 数据侧已有兜底（selection 初始化必带字体键），这里再挡一次，免得"某个键缺失"
              // 升级成"改一下设置整块面板崩"。
              getColors: () => (selection.fontCustom ? (selection.themeColors || {}) : {}),
              isAvailable: hasToken,
              onBeforeFirstWrite: () => { try { snapshotHostFontDefaults(); } catch { /* 基线失败不阻断上色 */ } },
            });
            typeLayer = createThemeLayer({
              theme,
              source: THEME_TYPE_SOURCE,
              // 全局字族也在这一层生效（作为**每个角色的默认**）。本机字体的栈里要拼
              // `var(--we-host-font-family, …)`，那是"开写之前"的宿主快照 ⇒ 本层也挂一次
              // onBeforeFirstWrite（它是幂等的"已快照则跳过"，与颜色层共用同一份快照）。
              onBeforeFirstWrite: () => { try { snapshotHostFontDefaults(); } catch { /* 基线失败不阻断字体 */ } },
              buildPayload: () => buildTypePayload(
                selection.fontCustom ? (selection.themeSize || {}) : {},
                hasToken,
                selection.fontCustom ? (selection.themeWeight || {}) : {},
                selection.fontCustom ? (selection.themeFamily || {}) : {},
                fontFamilyStack,
                selection.fontCustom ? (selection.globalFamily || "") : ""),
            });
            layer.sync();
            typeLayer.sync();
            // 订阅回调必须自己收异常：它跑在 emit() 里，抛出去就是"改一下设置整个面板崩"。
            unsub = subscribe(() => {
              try { if (layer) layer.sync(); if (typeLayer) typeLayer.sync(); } catch { /* 令牌层是增强 */ }
            });
          } catch { /* 主题层是增强：任何异常都不该影响壁纸主路径 */ }
        },
      });
      return () => {
        try { if (unsub) unsub(); } catch { /* ignore */ }
        try { if (cancelPoll) cancelPoll(); } catch { /* ignore */ }
        // 交给服务的 disposer 把令牌还原（F0 实测干净）；这里只保证调用一次
        try { if (layer) layer.dispose(); } catch { /* ignore */ }
        try { if (typeLayer) typeLayer.dispose(); } catch { /* ignore */ }
      };
    });
  }

  // 2. Settings page as a FIRST-LEVEL settings section (mirrors the skin-center
  //    in dsh-web-ui-all: its own nav entry, rendered inside the panel content
  //    column). The picker renders inside the liquid-glass card shell.
  //    `label` 用 **thunk**（官方 SlotLabel 支持"每次读取时求值"）：语言切换后设置导航里
  //    的那一行跟着换文字，不需要重注册座位。nav-icon.js / sidebar-right.js 的 DOM 锚点
  //    认的就是这个词的当前译文。
  if (ctx.slots) {
    ctx.slots.inject("settings.section", () =>
      ctx.slots.register(
        { name: "settings.section", id: "wallpaper-engine", order: 500, label: () => weT("壁纸引擎") },
        () => React.createElement(WallpaperPickerSection),
      ),
    );
  }

  // 2b. 设置导航图标：官方 nav 的图标是 shell 里 navIcon(id) 的硬编码映射，第三方
  //     section 一律拿兜底齿轮 —— 用 DOM 补丁把「壁纸引擎」那格换成自绘 SVG
  //    （src/nav-icon.js；补丁失败 = 保留齿轮，不抛、不重试）。
  if (ctx.effect && typeof document !== "undefined") {
    ctx.effect(() => installWeNavIcon() || undefined);
  }

  // 2c. 官方右侧栏接入（harness ≥0.1.5）：能力门在 src/sidebar-right.js —— 座位
  //     声明则面板融进右侧栏 tab，未声明则保持抽屉态。低版本宿主上回调永远不跑，
  //     插件也不会 park（可选服务全靠 ctx.get，不写进 inject）。
  if (ctx.effect && typeof document !== "undefined") {
    ctx.effect(() => installSidebarRight(ctx) || undefined);
  }

  // 2d. 壁纸侧栏快捷键（官方桌面默认 Cmd/Ctrl+Alt+W）：注册进宿主的 shortcuts 服务
  //     （可选服务 + 短轮询，缺服务安静跳过），命令在宿主快捷键编辑器里可改键。
  if (ctx.effect && typeof document !== "undefined") {
    ctx.effect(() => installWallSidebarShortcut(ctx) || undefined);
  }

  // 2e. 这些副作用**必须挂 fiber**（已在 `src/live-layer.js` 与本文件的轮换恢复监听两处收口）：
  //     诊断留痕（加载即留痕 / 窗口失焦·隐藏 / 60s 心跳）与「重启恢复」档的交互即退出监听
  //     （pointerdown/keydown，once），以及「隐藏期轮换推迟到可见时补做」的
  //     visibilitychange/focus 两条监听。理由：宿主每次 revision 变化
  //     都会 tearDownEntryFiber 后用新模块体重跑一遍，不挂 fiber ⇒ 旧实例的定时器
  //     与监听器永不释放（实测同一 document 214 个页 id、一次 window blur 被 117 份实例各记一条）。
  //     与官方契约一致（原文与现场见 src/live-layer.js 的 installLiveDiagnostics）。
  //     焦点交还（#148 宿主半）同理由同形态：document/window 级监听器，拆除函数交给 fiber。
  if (ctx.effect && typeof document !== "undefined") {
    ctx.effect(() => installLiveDiagnostics() || undefined);
    ctx.effect(() => installLiveBootRestore() || undefined);
    ctx.effect(() => installRotationResumeListeners() || undefined);
    ctx.effect(() => installFocusHandback() || undefined);
  }

  // 3b. 皮肤中心互操作（皮肤在台上 ⇒ 我方整族退场）：只读对方两条公开信号，
  //     见文件顶部互操作块。随 fiber 注销（卸载即摘下观察器与轮询）。
  if (ctx.effect && typeof document !== "undefined") {
    ctx.effect(() => installSkinInterop() || undefined);
  }

  // 3. Chat-interface rope dock: the draggable pull-cord + glass repo side
  //    panel, portalled onto <body> under its own React root — independent of
  //    the settings view, floating above the conversation. Feature-detected
  //    (react-dom without createRoot → skip) so minimal host/mocks stay safe.
  if (ctx.effect && typeof document !== "undefined" &&
      typeof ReactDOM !== "undefined" && typeof ReactDOM.createRoot === "function") {
    ctx.effect(() => {
      let host = document.getElementById(ROPE_DOCK_ID);
      if (!host && document.body && typeof document.createElement === "function") {
        host = document.createElement("div");
        host.id = ROPE_DOCK_ID;
        document.body.appendChild(host);
      }
      if (!host) return undefined;
      const root = ReactDOM.createRoot(host);
      root.render(React.createElement(RopeDock, null));
      return () => {
        try { root.unmount(); } catch { /* already gone */ }
        if (host.parentNode) host.parentNode.removeChild(host);
      };
    });
  }

  // Settings first (host file, port-independent), then the ACTIVE FONTSET (its values live in
  // fontsets/<id>.json — a different store on the same host), then inventory — so the
  // selection restore inside loadInventory()'s revalidateSelection() sees the persisted id
  // and can resolve its media URL, and the first paint already has the user's fonts.
  //
  // ⚠️ 终止 `.catch` 是**必须**的：这条链上任何一步 reject，后面的 `loadInventory` 就永不执行 ——
  // 选择器永久停在「扫描 Wallpaper Engine…」，一次性提示也不收敛（用户只能靠刷新或禁用插件自救）。
  // 各步内部已各自消化可预期的失败（宿主不可达 / 存储被拒 / 坏 JSON），这一条兜的是"没预料到的那次抛"。
  loadPersisted().then(loadFontSet).then(loadInventory).then(loadGlassPresets).catch((err) => {
    try { reportClientDiag("boot-chain-failed", String((err && err.message) || err)); } catch { /* 诊断本身不许再抛 */ }
  });
}

exports.apply = apply;
exports.inject = inject;
return module.exports;
