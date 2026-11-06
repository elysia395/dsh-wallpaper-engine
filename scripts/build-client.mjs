/**
 * build-client.mjs — minimal build for the browser half.
 *
 * Reproduces the exact artifact shape the DSH client module loader consumes,
 * the same shape `tsdown` emits for in-box client packages:
 *
 *     window.__ModuleLoader__.load({
 *       id: "<package-name>",
 *       factory: (require) => {
 *         var module = { exports: {} };
 *         var exports = module.exports;
 *         Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
 *         <inlined modules, in INLINE_MODULES order>
 *         <src/client.js body, indent-normalized>
 *         return module.exports;
 *       }
 *     });
 *
 * The body must end in `return module.exports` (it does). This script is a
 * deterministic, dependency-free stand-in for `tsdown bundle`.
 *
 * **Why inlining**: the browser half cannot `import` a sibling local file — the
 * bundle has no local-module resolver (only the loader's `require` for external
 * packages). So any code split out of `src/client.js` for readability (see
 * INLINE_MODULES) is inlined here as a **prelude** in the same factory scope.
 * The extracted files stay the single source; `src/client.js` just uses their
 * names. Shape mismatches are a **hard build failure**, never a silent empty
 * prelude — that is what keeps the split honest.
 *
 * Usage:  node scripts/build-client.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
// 跨树 import（scripts/ → test/）是**刻意的单一事实源**：本仓有哪些包、每个包的浏览器半边产物
// 叫什么，只能有一处枚举。scripts/ 与 test/ 都在根 package.json 的 files[] 之外（两者都是开发期
// 专属、不进发布面），所以构建器直接读发现层既不扩大发布面，也不制造第二份会漂移的包清单。
// 反过来把枚举复制一份才是病：新增包时两处要同时改，而漏改的那一处**不会红**（子包静默不产出）。
import { discoverPackages } from '../test/tools/packages.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const id = pkg.name;

/**
 * 内联进客户端 bundle 的模块（顺序即注入顺序）。
 * `markers` 是"结构变了就报错"的锚点 —— 缺任何一个都构建失败，避免内联悄悄变空。
 */
const INLINE_MODULES = [
  {
    // 纯数据、零依赖 ⇒ 放最前：后面任何模块都能直接读（也不可能有 TDZ 交互）。
    file: 'src/about-assets.js',
    why: '「关于」页签与更新公告的静态数据：仓库地址 + 随包图的路由路径（图本体在 lib/about/，见 lib/routes/about-qr.js 白名单）',
    markers: ['const ABOUT_REPO_URL = "https://github.com/elysia395/dsh-wallpaper-engine"',
      'const ABOUT_QR_QQ_PATH = "/about-qr/qq-group.png"',
      'const ABOUT_QR_DOUYIN_PATH = "/about-qr/douyin-group.png"',
      'const NOTICE_ART_PATH = "/about-qr/update-notice.jpg"'],
  },
  {
    // 零依赖的纯工具 ⇒ 紧随纯数据之后：三个层模块（fx / parallax / avatar）都要读，
    // 排在它们之前即可（本身无依赖，何处都无 TDZ 交互）。
    file: 'src/we-base.js',
    why: '浏览器半边的最小地基：三枚到处都用的纯工具（唯一实现）—— 钳位 `weClampTo` · 单调时钟 `weNow` · body 根 `weBody`；零依赖 + 零顶层可执行语句，故可排在内联清单最前',
    markers: ['function weClampTo(', 'function weNow(', 'function weBody('],
  },
  {
    // 词表域模块（8 个）必须排在组装点 `src/i18n-copy.js` **之前**：构建期内联进同一工厂作用域，
    // 组装点顶层读它们是 TDZ 的正面用法。域划分 = 文案归属的界面域（表体一行未改、顺序未动）；
    // 顺序即键插入序，守卫 test/verify-i18n.mjs 按 INLINE_MODULES 顺序逐条比对。
    file: 'src/i18n-copy-core.js',
    why: '英文词表域：客户端外壳（adapter / client / 更新公告）',
    markers: ['const WE_I18N_EN_CORE = {', '"自动检测": "Auto-detect",'],
  },
  {
    file: 'src/i18n-copy-font.js',
    why: '英文词表域：字体与配色（font/* · fontset-store；fontset-editor 与外观页签字体节已搬进 packages/fonts，词表仍住本域、由主包 weT 供词）',
    markers: ['const WE_I18N_EN_FONT = {', '"正文": "Primary text",'],
  },
  {
    file: 'src/i18n-copy-live.js',
    why: '英文词表域：实时层与素材预处理（live-layer · media-prep）',
    markers: ['const WE_I18N_EN_LIVE = {', '"首帧超时（{secs} 秒内无画面）": "First-frame timeout'],
  },
  {
    file: 'src/i18n-copy-panel.js',
    why: '英文词表域：设置面板页签（panel-tabs）',
    markers: ['const WE_I18N_EN_PANEL = {', '"当前壁纸": "Current wallpaper",'],
  },
  {
    file: 'src/i18n-copy-picker.js',
    why: '英文词表域：壁纸选择器与快捷面板（picker-* · quick-panel · sidebar-right · theme-follow）',
    markers: ['const WE_I18N_EN_PICKER = {', '"返回": "Back",'],
  },
  {
    file: 'src/i18n-copy-ext.js',
    why: '英文词表域：扩展页签 · 关于页签 · 更新公告（ext-* · panel-tabs）',
    markers: ['const WE_I18N_EN_EXT = {', '"扩展模块": "Extension modules",'],
  },
  {
    file: 'src/i18n-copy-glass.js',
    why: '英文词表域：玻璃预设与外观细项（思考块 · 系统字体 · 预设 · 侧栏圆角）',
    markers: ['const WE_I18N_EN_GLASS = {', '"思考块液态玻璃": "Thinking-block liquid glass",'],
  },
  {
    file: 'src/i18n-copy-pet-link.js',
    why: '英文词表域：桌宠联动（pet-link 的浏览器半边文字；源在包内时属"停在主 bundle"的域表，收口后按 fonts 惯例归主包 src/）',
    markers: ['const WE_I18N_EN_PET_LINK = {'],
  },
  {
    file: 'src/i18n-copy.js',
    why: '英文词表的**组装点** + 宿主显示表（域模块在前，这里只展开组装；两张表的键集各由 verify-i18n 双向对账）',
    markers: ['const WE_I18N_EN = {', 'const WE_I18N_HOST_EN = {'],
  },
  {
    file: 'src/i18n.js',
    why: 'i18n 运行时：跟随宿主 locale 服务的取词层（语言种类与 dsh web 同一份目录；含 ?we-lang 逃生舱）',
    markers: ['const WE_I18N_NS = ', 'function weT(', 'function weI18nAttach(',
      'function useWeLocale()', 'function weOnLocaleChange('],
  },
  {
    file: 'src/styles/base.js',
    why: '样式域 base（原 styles.js 61–592；ADR-0016 第四刀玻璃段出户后）：画布兜底 · 全局 UI 配色 · 面板色与弹层行配对',
    markers: ['const CSS_BASE = `', '/* ── 画布兜底色', '--we-popup-row-bg'],
  },
  {
    file: 'src/styles/shell.js',
    why: '样式域 shell（ADR-0016 第四刀玻璃段出户后）：原生左栏模式底 · 外壳画布底（壁纸让位两段）',
    markers: ['const CSS_SHELL = `', '/* ── 原生左栏在 extended/advanced 窗口模式下的不透明底', '/* ── 外壳画布底'],
  },
  // ── ADR-0016 第四刀：styles-sidebar.js **整文件**随玻璃包走（该域全部是
  //    玻璃接管：左栏 / 四角圆角 / 标题栏 / better-sidebar / 官方右栏 / 内容面）——
  //    内容住 packages/glass/src/glass-css.js 的 CSS_GLASS，主包组装式不再有 CSS_SIDEBAR 段。
  {
    file: 'src/styles/chrome.js',
    why: '样式域 chrome（ADR-0016 第四刀玻璃段出户后）：统一控件 token · corner-shape 兼容(#74)',
    markers: ['const CSS_CHROME = `', '/* ── 统一控件 token', '/* ── DSH harness corner-shape 兼容'],
  },
  {
    file: 'src/styles/settings.js',
    why: '样式域 settings（原 styles.js 1916–2167）：预设圆角表格 · 原生下拉弹层 · 视觉分组 divider · 可折叠节头 · 窄栏兜底 · 页签栏 · 统一设置行 32px',
    markers: ['const CSS_SETTINGS = `', '/* ── 预设方案'],
  },
  {
    file: 'src/styles/panel.js',
    why: '样式域 panel（原 styles.js 2168–2925）：吉祥物 3D 圆环转盘 · 圆点跳转 · 效果空态 · 黑胶 · 当前壁纸卡 · 壁纸属性面板 · 库下钻 · 目录浏览器',
    markers: ['const CSS_PANEL = `', '/* ── 吉祥物形态'],
  },
  {
    file: 'src/styles/quick.js',
    why: '样式域 quick（原 styles.js 2926–3357）：Rope dock · 快捷播放面板 QuickPanel',
    markers: ['const CSS_QUICK = `', '/* ── Rope dock'],
  },
  {
    file: 'src/styles/ext.js',
    why: '样式域 ext（ADR-0016 第四刀玻璃段出户后）：「关于」页签 · 扩展槽位与三号模块',
    markers: ['const CSS_EXT = `', '/* ── 「关于」页签：静态页'],
  },
  {
    file: 'src/styles.js',
    why: '样式族**组装点**（域模块按本清单顺序相加；ADR-0016 第四刀起玻璃段住 packages/glass/src/glass-css.js 的 CSS_GLASS，由玻璃包自注入）',
    markers: ['const CSS = CSS_BASE + CSS_SHELL + CSS_CHROME + CSS_SETTINGS + CSS_PANEL + CSS_QUICK + CSS_EXT;',
      'export { CSS };'],
  },
  {
    file: 'src/nav-icon.js',
    why: '「壁纸引擎」SVG 图标（几何唯一真源）+ 设置导航图标 DOM 补丁（官方 nav 硬编码兜底齿轮）',
    markers: ['const WE_ICON_PARTS = [', 'function renderWeIcon(',
      'function weIconSvgString(', 'function installWeNavIcon('],
  },
  {
    file: 'src/sidebar-right.js',
    why: '官方右侧栏接入（能力门 + 两段注册）+ 侧边栏触达模式真源 + 「壁纸引擎设置」DOM 入口',
    markers: ['function sidebarRightMode(', 'function sidebarRightOpen(',
      'function installSidebarRight(', 'function openSettingsSection('],
  },
  {
    file: 'src/font/components.js',
    why: 'G3/G4 组件级字体：模块前缀白名单 + 启动自探测 + 官方 --dsl-* 钩子生成',
    markers: ['const COMPONENT_FONT_TARGETS = [', 'function probeComponentTargets(',
      'function buildComponentCss(', 'const DSL_FONT_HOOKS = ['],
  },
  {
    file: 'lib/settings-schema.js',
    why: '设置唯一真源（宿主也 import 同一文件，见 P1-5）',
    // `function settingsDefaults(` 曾是第 3 个锚点，但它全仓零调用点、已按死代码删除
    // （settings-schema 的零消费者导出面清理）。按"锚点只能换、不能减"的规矩，换成
    // `function sanitizePresetValues(`：同为**顶层函数声明**，且客户端半边
    // （`src/preset-store.js`）与宿主半边（`lib/routes/presets.js`）都在调它 ⇒
    // 它不可能被单独删掉，作结构锚比原锚更稳。
    markers: ['const KINDS = {', 'function sanitizeFromSchema(', 'function sanitizePresetValues(',
      'function serializeSettings(', 'const DEFAULTS = {'],
  },
  {
    // 排在 settings-schema 之后：本文件的判定值域就是那里的 ADAPTER_TARGET_VALUES。
    file: 'src/adapter.js',
    why: '适配器模式：宿主形态判定（手选 > 宿主上报 > 本地信号）与能力矩阵',
    markers: ['const ADAPTER_LABELS = {', 'function setAdapterFromHost(',
      'function resolveAdapterTarget(', 'function adapterCaps('],
  },
  {
    file: 'src/theme-follow.js',
    why: '主题随壁纸：作者配色 → 画面主色 → 不动，按相对亮度自动切全局深/浅',
    markers: ['const THEME_FOLLOW_LIGHT_ABOVE = ', 'function themeFollowParseColor(',
      'function themeFollowModeColorOf(', 'function themeFollowAttach('],
  },
  {
    file: 'src/we-cond.js',
    why: 'WE 条件求值器（纯计算、零外界依赖，独立可测，见 P1-7）',
    markers: ['const WE_COND_OPS = [', 'function weEvalCondition(', 'function weCondTokenize('],
  },
  {
    file: 'src/font/color-roles.js',
    why: 'F1 令牌层：给文字颜色角色分角色上色（纯逻辑 + feature-detect，契约见文件头）',
    markers: ['const THEME_COLOR_ROLES = [', 'function createThemeLayer(', 'function pollThemeService(',
      'function buildTokenPayload('],
  },
  {
    file: 'src/font/typography.js',
    why: 'F2 排版角色：按角色调整字号（绝对值 px）/字重/字族（基准表达式照抄 DSH，见文件头）',
    markers: ['const THEME_TYPE_ROLES = [', 'function buildTypePayload(', 'const THEME_TYPE_SOURCE ='],
  },
  {
    file: 'src/font/apply.js',
    why: '字体自定义的落地点（宿主默认值快照 + 组件作用域样式表；设置 → DOM 的唯一字体出口）',
    markers: ['const WE_HOST_TOKENS = [', 'function componentFontAvailability()',
      'function applyComponentFonts()', 'function snapshotHostFontDefaults()',
      'function removeFontStyles()'],
  },
  {
    file: 'src/persistence.js',
    why: '设置持久化层：debounce 写 / 脏标记重试 / 宿主→本地迁移 / 在途 GET 竞态守卫',
    markers: ['function readPersisted()', 'function serializeSelection()', 'function pushPersisted()',
      'function schedulePersist()', 'async function loadPersisted()', 'function cancelPendingPersist()'],
  },
  {
    file: 'src/fontset-store.js',
    why: '字体集通道（F3 阶段 2）：活动集正文的加载 / 原子采用 / debounce 落盘 / 本地缓存（与设置平行但另一条真源）',
    markers: ['const FONTSET_CACHE_KEY = ', 'function readCachedFontSet()', 'function setFontValues(patch)',
      'async function loadFontSet()', 'function scheduleFontSet()', 'function cancelPendingFontSet()'],
  },
  {
    file: 'src/preset-store.js',
    why: '玻璃预设通道：清单加载 / 整快照应用（走设置通道落效）/ 保存 / 删除（重名由宿主裁决）',
    markers: ['const gpFetch = ', 'function glassPresetFailureReason(res)', 'async function applyGlassPreset(id)',
      'async function saveGlassPreset(name)', 'async function deleteGlassPreset(id)'],
  },
  // P-C：字体集编辑器面板 + 外观页签字体节**已搬进 packages/fonts**（本包自己的 inline 表），
  // 主 bundle 不再内联它们；两条通道各有配方（packages/fonts/client.build.json）。
  // 顺序注记：这两条原先排在 `src/preset-store.js` 之后、`src/section-head.js` 之前，搬走后
  // 本数组里 `preset-store → section-head` 的相邻关系不变（各模块都按名字引用，顺序不承载语义）。
  {
    // 面板各节的统一节头构件（二次修订：**两档都支持隐藏**）。
    // ⚠️ 必须排在 `src/panel-tabs.js` **之前**：它按名字直接调它（内联后同作用域）。
    //    虽然函数声明有提升、顺序其实不致命，但排在调用方前面才读得出依赖方向 —— 与
    //    `we-base.js` 排最前是同一条理由。（ADR-0016 第二刀起 glass-panel 那份经主 bundle
    //    的 HOST_BRIDGE 键 `sectionHead` 取同一实现，不再本表内联。）
    file: 'src/section-head.js',
    why: '节头构件（可折叠）：panel-tabs 用；packages/glass 经桥接键 sectionHead 取同一份，抽出来是为了让挂载台能 import 真实现',
    markers: ['function sectionHead(label, open, onToggle, action) {',
      'className: "we-picker__section-head we-picker__section-head--toggle"'],
  },
  {
    // 模块级重置按钮（issue #192 的 ↺）：与 section-head 同一条理由抽出来 ——
    // panel-tabs（外观各节 + 扩展模块头）在主 bundle 用；packages/glass（玻璃 UI）经桥接键
    // moduleResetButtonNode 取同一实现（ADR-0016 第二刀起不再本表内联）。
    file: 'src/module-reset.js',
    why: '模块级重置按钮（↺）：panel-tabs 用；packages/glass 经桥接键 moduleResetButtonNode 取同一份；模块名查 RESET_MODULES 取键集',
    markers: ['function moduleResetButtonNode(moduleName, onResetModule, labels) {',
      'className: "we-mod-reset"'],
  },
  // ── ADR-0016 第二刀：「主题预设」+「玻璃 UI」节渲染器（现 packages/glass/src/glass-panel.js）
  //    **已迁出主 bundle**，住 packages/glass，由该包自己的 client.build.json 出产物
  //    packages/glass/lib/client.glass.js；主包只留 panel-tabs 里那枚按 id 取渲染器的**注册表占位桩**
  //    （屏上位置不变：主题 → 细节 → 玻璃 UI → 侧栏圆角 → 全局 UI 配色 → 全局字体）。
  //    迁出的等价性证据与 fx/parallax 同款：逐字节相同（`git diff --no-index` 可复核），
  //    差量只有 outline 的 host 绑定与空 apply/inject。
  // ── P-A 起：点击拖尾与 3D 两份「画布层 + 描述符」**已迁出主 bundle**，各自住自己的包
  //    （packages/fx、packages/parallax），由各包自己的 `client.build.json` 配方各出一份产物；主包只留
  //    `src/extension-registry.js` 这张收件箱（谁登记了什么只能问它）。
  //    迁出的等价性证据：两个子包产物里的 fx-layer/ext-fx/parallax-layer/ext-parallax 与迁出前
  //    逐字节相同（`git diff --no-index` 可复核），差量只有 outline 的 host 绑定与空 apply/inject。
  {
    // 头像导入的两道闸 + 零解码尺寸探针（#185 后续）。**纯函数**，因此是本仓少数几个
    // 能被守卫**直接执行**的模块之一（用真字节喂真函数 —— 位域读错一位那种错，
    // "源码里有没有这行字"测不出来）。排在 avatar-layer / ext-avatar / client 正文之前：
    // 那几处的调用点直接按名引用这些常量与函数。
    file: 'src/avatar-import.js',
    why: '头像导入的两道闸（边长 1024 / 体积 4 MiB）、零解码的文件头尺寸探针（PNG/JPEG/GIF/BMP/WebP/SVG）与两层 MIME 清单（直传 / 仅光栅化）',
    markers: ['const AVATAR_IMPORT_MAX_EDGE = ', 'const AVATAR_IMPORT_MAX_BYTES = ',
      'const IMAGE_DIRECT_ACCEPT = ', 'const IMAGE_RASTER_ACCEPT = ',
      'function parseBitmapHeaderSize(', 'function parseSvgSize(',
      'async function probeImageSize(', 'function avatarImportLimit('],
  },
  {
    // 「扩展」页签**一号模块**（自定义会话头像）：与前面两份不同 —— 它的"本体"既不是画布层
    // 也不是纯变量层，而是**会话界面上的 DOM 补丁**（给宿主的消息行补头像节点 + 一个
    // 观察者），所以行为层是 src/avatar-layer.js。排在 panel-tabs 之前（它要在渲染时取
    // 得到 AVATAR_EXTENSION_MODULE 与那几张默认头像的零件表）。
    file: 'src/avatar-layer.js',
    why: '「自定义会话头像」的装饰层：按 data-chat-flow-kind 给消息行补头像节点（观察者 + 就地更新；基座模块：只读 selection、零 ctx），并供面板预览复用同一条 URL 与同一张默认头像零件表',
    markers: ['const AVATAR_FLOW_SIDES = ', 'const AVATAR_GLYPH_PARTS = ',
      'function syncAvatarLayer()', 'function disposeAvatarLayer()'],
  },
  {
    file: 'src/ext-avatar.js',
    why: '「扩展」页签第一个模块的描述符（渲染该扩展岛；动作一律经 ctx 里的具名 on* 处理器）',
    markers: ['const AVATAR_EXTENSION_MODULE = {', 'function renderAvatarIsland(ctx)'],
  },
  {
    file: 'src/system-fonts.js',
    why: '本机字体清单的客户端通道：宿主那次进程扫描的唯一读者（清单 / 缓存 / 失败文案 / 本浏览器能否匹配的探针），与字体集通道同形',
    markers: ['const SYSTEM_FONTS_CACHE_KEY = ', 'function readCachedSystemFonts()',
      'async function ensureSystemFonts(', 'function systemFontKeyList(',
      'function filterUsableSystemFonts('],
  },
  {
    // ── P-A 起：跨包「扩展模块 / 层钩子」注册表（src/extension-registry.js）。三项扩展里
    //    有**两项**（点击拖尾 packages/fx、3D packages/parallax）从 P-A 起各自住在自己的包
    //    里，三份 bundle 的求值顺序不保证 ⇒ 谁登记了什么只能落在一张共享注册表上：
    //    panel-tabs 只问它（屏上顺序 = (order, 注册序)）、client.js 只问它（挂载期接 sync /
    //    拆卸期交 dispose）。零依赖、浏览器安全。必须排在 panel-tabs 与 client.js 正文之前。
    file: 'src/extension-registry.js',
    why: '跨包扩展模块/层钩子注册表：登记与排序（order）扩展模块描述符、登记层的 sync/dispose、迟到注册的补接与重画回调',
    markers: ['const weExtensionModuleTable = ', 'const weLayerHookTable = ',
      'function weRegisterExtensionModule(', 'function weExtensionModules()',
      'function weRegisterLayerHooks(', 'function weDiscoveredGroupsOf('],
  },
  {
    file: 'src/panel-tabs/appearance.js',
    why: '「外观」页签的节渲染器与字体一族（从 src/panel-tabs.js 按域拆出）',
    markers: ['function renderAppearanceThemeSection(ctx) {', '    const { onResetModule, onToggleThemeFollow, sel } = ctx;'],
  },
  {
    file: 'src/panel-tabs/mascot.js',
    why: '「吉祥物」页签的节渲染器与其模块级常量/拖拽状态（从 src/panel-tabs.js 按域拆出）',
    markers: ['function renderMascotFormCards(sel, previewArt, previewW, previewH,', '  const MASCOT_BOX_PX = 64;'],
  },
  {
    file: 'src/panel-tabs/effects.js',
    why: '「播放」页签的三个节渲染器：滑块 / 实时帧 / 出图来源（从 src/panel-tabs.js 按域拆出；倍速·帧率上限与适配·翻转两节住在 packages/media-bridge 的浏览器半边，ADR-0013/ADR-0014）',
    markers: ['function renderEffectsSlidersSection(ctx) {',
      '    const { onBackgroundBrightness, onBackgroundContrast, onBackgroundSaturate, onLayerPositionX, onLayerPositionY, onLayerReset, onLayerScale, onScrim, onWallpaperBlur, onWallpaperOpacity, sel } = ctx;'],
  },
  {
    file: 'src/panel-tabs/advanced.js',
    why: '「系统」页签的六个节渲染器（从 src/panel-tabs.js 按域拆出）',
    markers: ['function renderAdvancedBrowsingSection(ctx) {', '    const { onLayoutChange, sel } = ctx;'],
  },
  {
    file: 'src/panel-tabs.js',
    why: '面板页签**组装点**：只留一个页签一个 render*Tab（其中「扩展」页签只画 extensionModules() 里登记的模块）；五个域的节渲染器在 panel-tabs-*.js 里 —— 显式 ctx 取外界',
    markers: ['function renderWallpaperTab(ctx) {', '    const { } = ctx;',
      'function renderExtensionsTab(ctx) {', 'function renderAboutTab(ctx) {',
      'renderWallpaperTab, renderAppearanceTab, renderAudioTab, renderMascotTab, renderEffectsTab, renderAdvancedTab,'],
  },
  {
    file: 'src/picker-model.js',
    why: '选择器模型层：过滤判定 + 派生数据 + 分页切片（纯函数 / 显式入参 / 零 DOM）',
    markers: ['function ratingOf(w)', 'function isPlayableType(w)',
      'function isRotatableWallpaper(w, ratingFilter, typeFilter)',
      'function isHiddenWallpaper(id, hiddenIds)', 'const PICKER_PAGE_SIZE = 24',
      'function pageSlice(list, page)', 'function pickerModel(input)'],
  },
  {
    file: 'src/picker-modal.js',
    why: '选择器库视图的渲染器（整棵 we-picker__modal 子树；页内下钻，不再是弹框）—— 显式 ctx 取外界，标记逐字搬',
    markers: ['function renderPickerModal(ctx)',
      'className: "we-picker__modal"',
      'className: "we-picker__modal-head"', 'className: "we-picker__grid"'],
  },
  {
    file: 'src/picker-props-panel.js',
    why: '选择器「壁纸属性」面板的渲染器（整棵 we-picker__props 子树 + 每个 ptype 的控件分支）—— 显式 ctx 取外界，标记逐字搬',
    markers: ['function renderPickerPropsPanel(ctx)', 'function renderUserPropRow(p, onPropInput)',
      'className: "we-picker__props"', 'className: "we-picker__props-row"',
      'className: "we-picker__props-section"'],
  },
  {
    file: 'src/quick-panel.js',
    why: '快捷播放面板（官方侧栏 tab 与低版本抽屉共用同一份内容）：当前壁纸 + 轮播 + 列表快切 + 声音 + 设置入口。列表虚拟滚动（spacer + 可视窗口）',
    markers: ['function qpFindScroller(', 'function qpVirtWindow(', 'function qpTypeLabel(', 'function QuickPanel(props)'],
  },
  {
    file: 'src/video-layer.js',
    why: '视频壁纸通道：海报已加载/首帧/预算的就绪判据（实测：一律等首帧会把切换推到十几秒）',
    markers: ['function probeVideoPoster(', 'function videoContentReady(', 'VIDEO_POSTER_BUDGET_MS', 'let mediaInfoToken = ', 'function clearUpgradePoll(', 'async function refreshMediaInfo(', 'function abortTranscodeUpgrade(', 'function maybeUpgradeToTranscoded(', 'function invalidateMediaInfoProbe('],
  },
  {
    file: 'src/media-prep.js',
    why: '选中项落地：预准备（预挂载 + 探测 + 超时记账）→ buildMedia → applySelection',
    markers: ['function beginRotationPrepare(', 'function prepareWallpaper(', 'const prepareLiveTimeouts = ',
      'function prepareSceneLiveStage(', 'function applySelection(', 'function buildMedia('],
  },
  {
    file: 'src/layer-core.js',
    why: '两条通道共用的切换核心：层退役/延迟移除、过场内联样式、可见性复推（不得引用实时符号）',
    markers: ['function retireFadingLayer(', 'function scheduleFadingLayerRemoval(', 'function nudgeWallpaperRepaint('],
  },
  {
    file: 'src/focus-handback.js',
    why: '#148 宿主侧：焦点被（无手势地）搬进壁纸帧时交还给用户本来在用的元素 —— 与 lib/we-focus-guard.js 分工的另一半',
    markers: ['function installFocusHandback(', 'function weIsWallpaperFrame(', 'GESTURE_WINDOW_MS', 'window.__weFocusHandback'],
  },
  {
    file: 'src/live-layer-diag.js',
    why: '实时渲染管线·诊断与日志域：分级日志 / 状态摘要 / 诊断留痕的安装',
    markers: ['function liveLog(', 'const LIVE_DIAG_KEY = '],
  },
  {
    file: 'src/live-layer-watch.js',
    why: '实时渲染管线·心跳与载荷域：看护 tick / 判失败 / 转移重试 / 抓帧回填',
    markers: ['function startLiveWatch(', 'function scheduleLiveFrameBackfill('],
  },
  {
    file: 'src/live-layer-pointer.js',
    why: '实时渲染管线·指针与帧域：指针注入 / 帧字节簿记 / poster 与挂载',
    markers: ['function livePointerFlush(', 'function liveFrameEl('],
  },
  {
    file: 'src/live-layer-gate.js',
    why: '实时渲染管线·内容闸门域：待显层的揭示闸门与失败记忆的管线身份',
    markers: ['function armLayerContentReveal(', 'function livePipelineNow('],
  },
  {
    file: 'src/live-layer-underlay.js',
    why: '实时渲染管线·兜底色域：画布兜底色采样与可见性恢复',
    markers: ['function writeUnderlayColor(', 'function refreshUnderlayColor('],
  },
  {
    file: 'src/live-layer.js',
    why: '实时渲染管线的组装点（syncLayers 编排收尾 / toggleLiveDiag）；上面五个域按本清单顺序内联在本文件之前',
    markers: ['const LIVE_FIRST_FRAME_MS = ', 'function syncLayers()', 'function toggleLiveDiag('],
  },
  {
    file: 'src/api-client.js',
    why: '宿主 API 的唯一出入口（P2-9）：前缀 / 默认 no-store / 不吞错的结构化结果',
    markers: ['const BASE = ', 'function apiUrl(', 'function pickFetch(', 'async function apiFetch(',
      'const apiJson = ', 'const apiHead = '],
  },
  {
    // Linux 壳窗遮挡轮询器（docs/wip/LINUX-OCCLUSION.md §6）：宿主 /occlusion 快照
    // → innerWidth/own.w 缩放到画布 CSS 像素 → postMessage 给 scene-live 遮挡桥。
    // 顶层只声明函数与 var 状态、apiJson 在调用期解引用（无 TDZ 交互），跟随
    // api-client 之后内联。
    file: 'src/occlusion.js',
    why: '遮挡投递：/occlusion 轮询 + 缩放 + postMessage（1Hz，含退避与可见性暂停）',
    markers: ['var OCCLUSION_POLL_MS = ', 'function startOcclusionPolling(', 'function stopOcclusionPolling(',
      'function occlusionTick(', 'function deliverOcclusionSnapshot('],
  },
  // ── ADR-0016 第三刀：玻璃**运行时**（现 packages/glass/src/glass.js / glass-surfaces.js /
  //    glass-extra.js + effects.js 的玻璃段 + detectSoftwareRender）**已迁出主 bundle**，
  //    住 packages/glass/src/，由该包的 client.build.json 出产物，经 registerLayerHooks('glass')
  //    挂进主包的 emit 节拍（sync = 原玻璃段写入、dispose = 原清理清单，逐字搬迁）；
  //    weClampSurfaceColor / glassColorOf 两个纯函数**家留主包**（effects.js，染色地板判据
  //    从主包产物抽取复算），子包经 HOST_BRIDGE 键集取同一份。
  {
    file: 'src/effects.js',
    why: '效果应用层（设置 → DOM；契约见文件头）—— 玻璃段已出户（ADR-0016 第三刀），本文件只剩非玻璃效果',
    markers: ['let lastScrimCss = "";', 'function applyEffects(',
      'function clearEffects()', 'function resolveWallpaperFadeBg()'],
  },
  {
    file: 'src/client-media-frame.js',
    why: 'src/client.js 正文的媒体/帧渲染助手（画布绘制、GPU 帧钉、音频桥与封面、属性面板装配；含其模块级状态变量）—— 构建期内联在正文之前，同处一个扁平作用域',
    markers: ['function weStopDraw()', 'const GPU_FRAME_PIN_TTL_MS = 30000;',
      'function renderUserPropsPanel()'],
  },
  {
    file: 'src/client-rotation.js',
    why: 'src/client.js 正文的轮换/媒体生命周期助手（过场几何、探测元素领养与释放、隐藏期轮换推迟；含其顶层状态）—— 构建期内联在正文之前，同处一个扁平作用域',
    markers: ['function barsPolygon(dir, p) {', 'const LIVE_FIRST_FADE_MS = 1800;',
      'function installRotationResumeListeners() {'],
  },
  {
    file: 'src/client-audio-playback.js',
    why: 'src/client.js 正文的音频/播放桥助手（期望音量与元素音量写入、轮换音频闸、层内媒体元素枚举、live iframe 音量与场景包 BGM 起停、播放状态应用；含其顶层状态）—— 构建期内联在正文之前，同处一个扁平作用域',
    markers: ['function weApplyAudio(video) {', 'let rotationAudioGate = null;',
      'const LAYER_KEY_FIELDS = ["type", "url", "edge", "sceneVideo", "audio", "live"];'],
  },
  {
    // 跨包浏览器半边的**显式键集契约表**（ADR-0014 S5.1 / S5.4）：71 个 getter 挂到 module.exports。
    // 必须排在内联清单**末尾**：表顶层读 `DEFAULTS`（lib/settings-schema.js 的内联件）⇒ 要排在它之后；
    // 正文里的函数声明在工厂体内提升、getter 又是惰性求值 ⇒ 与正文的先后无关。
    // （原先住 src/client.js 正文底部，搬出来只为让"改一个键要同时对账 8 张 *_HOST_REQUIRED"
    // 的契约表有个能一眼找到的家；产物行为逐字不变 —— verify 链与 golden 快照会兜住这一点。）
    file: 'src/host-bridge.js',
    why: '跨包浏览器半边契约表：子包经 require(主包名) 取到的显式键集 + 冻结的 exports.hostBridgeKeys；改一个键要同时对账 8 张 *_HOST_REQUIRED（test/verify-subpackage-client-half.mjs D-7）',
    markers: ['const HOST_BRIDGE_BINDINGS = {',
      'const HOST_BRIDGE_KEYS = Object.keys(HOST_BRIDGE_BINDINGS);',
      'exports.hostBridgeKeys = Object.freeze(HOST_BRIDGE_KEYS.slice());'],
  },
];

/**
 * **子包各自的浏览器半边产物**（ADR-0014（子包契约） §7.1 / ADR-0013 D9「多包后每包一产物」）。
 *
 * 为什么不把 packages/* 追加进 INLINE_MODULES：INLINE_MODULES 的语义是「内联进**主** bundle 的
 * prelude」，而 test/verify-module-layout.mjs（规则③）、test/tools/src-scope.mjs、
 * test/verify-glass-surfaces.mjs 等一批守卫都按这张表交叉对账 ⇒ 往里塞子包文件会同时改掉一堆
 * 不相关的判据。子包走自己的**配方**：同样的注入/撞名/浏览器安全判据（函数参数化，判据只有一份），
 * 不同的产物落点。
 *
 * 产物名 lib/client.<pkg>.js（而不是 client.js）：主产物已经是 lib/client.js，同名会在
 * 「按名字扫描产物」的守卫里撞面（包级约定 exports['./client'] 见 test/verify-package-publish.mjs）。
 *
 * **配方数据驱动 N（ADR-0014（子包契约） §7.2）**：子包清单不再写死在本文件里，而是「每个有浏览器半边的
 * standalone 包一份 `packages/<pkg>/client.build.json`」：
 *   { "entry": "src/client.js",         // 该包浏览器半边入口（相对包目录；缺省 src/client.js）
 *     "artifact": "lib/client.fx.js",   // 产物落点（相对包目录，必须逐字 == exports['./client']）
 *     "inline": [ { file, why, markers } ] }
 * 包集合来自发现层（test/tools/packages.mjs）⇒ **新增一个子包只加"包目录 + 配方"两处数据，
 * 本文件零改动**。配方只是构建输入，不进发布面（不在任何 package.json 的 files[] 里）。
 */
const RECIPE_FILE = 'client.build.json';
const DEFAULT_SUBPACKAGE_ENTRY = 'src/client.js';

/** `dir`/`entry` 一律正向斜杠：`label`/`bodyLabel` 会进产物正文，Windows 的反斜杠会**静默改产物字节**。 */
function toPosix(rel) {
  return rel.split('\\').join('/');
}

/**
 * 读全部 standalone 子包的配方，并做**双向**一致性硬检查（缺配方 / 孤儿配方都判红，且点名包）。
 *
 * 判据（与发现层的不变量同源，这里是构建期的第二道，白拿一次交叉检查）：
 *   · 声明了浏览器半边（清单 `exports['./client']` ⇒ 发现层给出 `clientArtifact`）⟺ 存在配方文件；
 *   · 配方的 `artifact` 经包目录拼接后必须**逐字等于**发现层的 `clientArtifact`（防两处漂移）。
 * 缺配方会让该包的浏览器半边**静默不产出**（页面白屏、构建却全绿），所以宁可让构建红。
 */
function loadSubpackageRecipes() {
  const model = discoverPackages(root);
  const recipes = [];
  for (const p of model.packages) {
    if (p.kind !== 'standalone') continue;
    const relDir = toPosix(p.dir);
    const recipeAbs = resolve(root, relDir, RECIPE_FILE);
    const hasRecipe = existsSync(recipeAbs);
    const declaresClient = typeof p.clientArtifact === 'string' && p.clientArtifact.length > 0;
    if (declaresClient && !hasRecipe) {
      console.error(`[build-client] ${p.name}（${relDir}）声明了浏览器半边`
        + `（exports['./client'] ⇒ ${p.clientArtifact}）却没有构建配方 ${relDir}/${RECIPE_FILE}`
        + '：该包的浏览器半边会静默不产出（用户页面白屏，而构建/守卫全绿）。'
        + `请补上 ${relDir}/${RECIPE_FILE}（形状 { entry, artifact, inline:[{file,why,markers}] }，`
        + '可照抄任一别包的同名文件）。');
      process.exit(1);
    }
    if (!declaresClient && hasRecipe) {
      console.error(`[build-client] ${p.name}（${relDir}）留着孤儿配方 ${relDir}/${RECIPE_FILE}`
        + "，但清单没有声明浏览器半边（exports['./client']）：配方不会被消费，"
        + "它描述的产物也没人会加载。请删掉该配方，或给清单补上 exports['./client']。");
      process.exit(1);
    }
    if (!hasRecipe) continue;
    const recipe = JSON.parse(readNormalized(recipeAbs));
    const joined = `${relDir}/${recipe.artifact}`;
    if (joined !== p.clientArtifact) {
      console.error(`[build-client] ${p.name}（${relDir}）配方与清单漂移：${RECIPE_FILE} 的 artifact=`
        + `${JSON.stringify(recipe.artifact)} ⇒ 产物 ${joined}，`
        + `而清单 exports['./client'] ⇒ ${p.clientArtifact}。`
        + '两者必须一致（否则构建出的产物没人加载，按产物名对账的守卫也会红）。');
      process.exit(1);
    }
    // upstream-fork 形态（P1）：预构建产物。它没有本仓的构建链（源码是上游 .ts 体系），
    // 所以这里**不读源码重编**，只做「登记字节 ⇄ 盘上字节」的对账（见 assertPrebuiltBundle）。
    if (recipe.prebuilt != null) {
      if (recipe.entry != null || recipe.inline != null) {
        console.error(`[build-client] ${p.name}（${relDir}）${RECIPE_FILE} 同时给了 prebuilt 与 entry/inline：`
          + '预构建形态不消费源码（entry/inline 会被忽略），两种形态只能选一种，混写等于让人误以为它在编译。');
        process.exit(1);
      }
      recipes.push({ dir: relDir, dirAbs: resolve(root, relDir), name: p.name, artifact: recipe.artifact, prebuilt: recipe.prebuilt });
      continue;
    }
    recipes.push({
      dir: relDir,
      dirAbs: resolve(root, relDir),
      name: p.name,
      artifact: recipe.artifact,
      entry: typeof recipe.entry === 'string' && recipe.entry ? recipe.entry : DEFAULT_SUBPACKAGE_ENTRY,
      inline: recipe.inline,
    });
  }
  return recipes;
}

/**
 * 读取一个构建输入、归一化成 LF，**并断言不再有孤立 CR**。
 *
 * 为什么这条断言值得让构建**红**：源文件里若混进多余的回车（历史形态：`src/i18n-copy.js` 曾有
 * 28 行是 `\r\r\n`），Windows 检出会把它放大成 `\r\r\n`、Linux 检出是 `\r\n`，而这里只做
 * `\r\n → \n` 归一化 ⇒ Windows 上会**残留一个孤立 CR** ⇒ **同一份源码在两个平台产出不同字节的
 * 产物**。于是同一份源码在不同机器上会产出不同字节的产物（实测过：一条 CI 腿红、另一条绿，
 * 本机怎么跑都看不出来）。产物出库后虽不再有「跨腿 git diff」那一判，可复现性仍是硬要求。
 * 宁可构建失败并点名文件，也不要产出一份平台相关的产物。
 */
function readNormalized(abs) {
  const text = readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
  if (/\r/.test(text)) {
    console.error(`[build-client] ${abs} 含孤立回车（常见形态 \\r\\r\\n 或行内 CR）：`
      + '产物会变成平台相关，另一条 CI 腿的「产物与源码同步」判据将变红。'
      + '请先把该文件的行尾归一化成 LF（每行只留 \\n）。');
    process.exit(1);
  }
  return text;
}

/**
 * 顶层声明的机器提取口径 —— `readInlinedPrelude()` 的撞名判据与 `assertNoShadowedScopeDecls()`
 * 的全作用域重复判据**共用这一份**（两份口径写着写着必然漂移，而这两条判据判的正是同一件事）。
 * ⚠️ 判据是"缩进 == 本文件声明的最小缩进"，不是"行首"也不是任意缩进：
 *   · 要求行首（原实现 `^(?:const|let|var|function)`)会**静默漏掉**把顶层声明写了一层缩进的模块
 *     （本仓真实形态：`src/picker-modal.js` / `src/picker-props-panel.js` / `src/quick-panel.js`）
 *     ⇒ 撞名不被判出，平铺后就是运行期 SyntaxError；
 *   · 只写 `^\s*` 又会把**嵌套**声明（函数内 const/let）全收进来 ⇒ 遍地假撞名。
 */
const DECL_RE = /^([ \t]*)(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;

// ── 产物生成 ─────────────────────────────────────────────────────────────────
// 主 bundle 与子包 bundle 走**同一套**注入 / 浏览器安全 / 撞名判据（`readInlinedPrelude` /
// `assertNoShadowedScopeDecls` 都参数化了模块表与基准目录）：判据只有一份，只有模块表不同。
const OUTPUTS = [
  { kind: 'compiled', label: 'lib/client.js', target: resolve(root, 'lib', 'client.js'), inlined: INLINE_MODULES, text: buildMainBundle() },
  ...loadSubpackageRecipes().map((recipe) => (recipe.prebuilt != null
    ? { kind: 'prebuilt', label: `${recipe.dir}/${recipe.artifact}`, dirAbs: recipe.dirAbs, name: recipe.name, artifact: recipe.artifact, prebuilt: recipe.prebuilt }
    : {
      kind: 'compiled',
      label: `${recipe.dir}/${recipe.artifact}`,
      target: resolve(recipe.dirAbs, recipe.artifact),
      inlined: recipe.inline,
      text: buildSubpackageBundle(recipe),
    })),
];

for (const out of OUTPUTS) {
  if (out.kind === 'prebuilt') {
    // 预构建形态：只对账、不写盘。为什么**不**写盘：这份字节是上游派生世代的产物证据，
    // 构建期重写它会让「登记值 ⇄ 盘上值」这条判据变成自证（写什么都是对的）。
    assertPrebuiltBundle(out);
    continue;
  }
  // 产物必须可解析 —— 内联后出现重复声明/括号错配时在这里就红，而不是等到用户页面白屏。
  try {
    new Script(out.text, { filename: out.label });
  } catch (err) {
    console.error(`[build-client] 产物语法错误（${out.label}）：${err && err.message}`);
    process.exit(1);
  }
  mkdirSync(dirname(out.target), { recursive: true });
  writeFileSync(out.target, out.text);
  // 进度信息走 **stderr**，把 stdout 留给机读输出：`npm run build` 的输出会被 `prepare` 带进
  // `npm pack` / `npm publish` 的 stdout，而它们的 `--json` 要求 stdout 上**只有 JSON**
  // （实测：`npm pack --dry-run --json` 原本因这一行而无法解析）。错误本就打 stderr。
  console.error(`built ${out.target} (${Buffer.byteLength(out.text)} bytes; inlined: ${out.inlined.map((m) => m.file).join(' + ')})`);
}

/**
 * 预构建 bundle 的对账（upstream-fork 形态专用）：配方登记的字节必须真的在盘上。
 *
 * 判据四条，缺一条就红：
 *   ① 产物与宿主半边都在盘（fork 的两半同批派生，缺一半就是半个包）；
 *   ② 两半的 sha256 逐字等于登记值（**这是"受控派生"的唯一机器证据**：任何手改/重编都会红）；
 *   ③ 产物里 `__ModuleLoader__` 的注册 id 等于登记值（防止拿错世代的文件冒充）；
 *   ④ 产物可被解析（与编译路径同一条语法底线）。
 * ⚠️ 本函数**不改盘**：登记值不是"构建输出"，而是"输入必须长这样"。要让这条通过，只能改来源或改登记。
 */
function assertPrebuiltBundle(out) {
  const pre = out.prebuilt;
  const want = String(pre.sha256 || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(want)) {
    console.error(`[build-client] ${out.label}：prebuilt.sha256 不是 64 位十六进制（${JSON.stringify(pre.sha256)}）`);
    process.exit(1);
  }
  const pairs = [
    { rel: pre.entry, hash: want, what: '浏览器半边' },
    { rel: pre.hostEntry, hash: String(pre.hostSha256 || '').toLowerCase(), what: '宿主半边' },
  ];
  for (const pair of pairs) {
    if (typeof pair.rel !== 'string' || !pair.rel) {
      console.error(`[build-client] ${out.label}：prebuilt.${pair.what} 的落点没登记`);
      process.exit(1);
    }
    const abs = resolve(out.dirAbs, pair.rel);
    if (!existsSync(abs)) {
      console.error(`[build-client] ${out.label}：登记的${pair.what} ${pair.rel} 不在盘上`);
      process.exit(1);
    }
    const got = createHash('sha256').update(readFileSync(abs)).digest('hex');
    if (got !== pair.hash) {
      console.error(`[build-client] ${out.label}：${pair.rel} 字节与登记值不符（受控派生被改动过）——\n`
        + `  登记 ${pair.hash}\n  实际 ${got}\n`
        + '  要么恢复上游派生产物，要么连同来源登记一起改（不许只改一边）。');
      process.exit(1);
    }
  }
  const artAbs = resolve(out.dirAbs, pre.entry);
  const artText = readFileSync(artAbs, 'utf8');
  const marker = `id: ${JSON.stringify(pre.moduleId)}`;
  const at = artText.indexOf('__ModuleLoader__');
  if (at < 0 || artText.slice(at, at + 400).indexOf(marker) < 0) {
    console.error(`[build-client] ${out.label}：产物里没有 __ModuleLoader__.load({ ${marker} … }) 注册`
      + `（登记的 moduleId 与实际注册 id 不一致 ⇒ 宿主加载的是别的东西）`);
    process.exit(1);
  }
  try {
    new Script(artText, { filename: out.label });
  } catch (err) {
    console.error(`[build-client] 预构建产物语法错误（${out.label}）：${err && err.message}`);
    process.exit(1);
  }
  console.error(`verified ${artAbs} (prebuilt; sha256 ${want.slice(0, 12)}…; 宿主半边同批登记)`);
}

function indent(text) {
  return text.split('\n').map((line) => (line.trim() === '' ? '' : '\t\t' + line)).join('\n');
}

/**
 * 读取一张内联模块表（主 bundle = INLINE_MODULES，子包 = 该包 `client.build.json` 的 `inline`）拼成可内联的 prelude：
 * `baseDir` / `label` / `bodySrc` 由调用方给（主 bundle = 仓库根 / '' / 主正文；子包 = 子包目录 /
 * 'packages/<pkg>/' / 子包正文）—— 判据只有这一份，主包与子包走同一条路。
 *   · 断言每个模块**浏览器安全**（无 import/require/Node 全局）；
 *   · 断言形状符合预期（markers 全在）；
 *   · 剥掉 `export {...}` 块与声明前的 `export ` 关键字（内联后同作用域，不需要导出）；
 *   · 断言 src/client.js **没有**重复声明任何一个被注入的名字（名字机器提取，不维护手工清单）。
 *     ⚠️ 这一条只管「注入 ↔ 正文」这一个方向；**同一作用域内**更广的重复声明（含正文内部、
 *     含内联模块彼此之间）由 `assertNoShadowedScopeDecls()` 判 —— 两者是互补判据，不是重复判据。
 */
function readInlinedPrelude(modules, baseDir, bodySrc, label = '') {
  const parts = [];
  const injected = new Map(); // name -> file
  for (const mod of modules) {
    const abs = resolve(baseDir, mod.file);
    const text = readNormalized(abs);
    // 判据针对**代码**：先剥注释。否则模块头里写一句 `node -e "require('fs')…"` 的
    // 复核命令就会被判成"含 require"（**实测**：这类假阳性出现过多次）。
    const code = text
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

    // 判据清单：`[正则, 人话]`。**JSDoc 注解是必须的** —— 无注解时 tsc 把元组数组宽化成
    // `(string | RegExp)[][]`，下面的 `re.test()` 就会报 TS2339「Property 'test' does not
    // exist on type 'string | RegExp'」。运行期恒为 RegExp（这里全是正则字面量），故这是
    // 类型推断过宽而非缺陷。
    /** @type {Array<[RegExp, string]>} */
    const browserSafetyChecks = [
      [/^\s*import\s/m, 'import 语句'],
      [/\brequire\s*\(/, 'require()'],
      [/^\s*export\s+default/m, 'export default'],
      [/\bprocess\.\w/, 'process.*'],
      [/\b__dirname\b|\b__filename\b/, 'CommonJS 路径全局量'],
    ];
    for (const [re, what] of browserSafetyChecks) {
      if (re.test(code)) {
        console.error(`[build-client] ${label}${mod.file} 必须浏览器安全，但含${what}`);
        process.exit(1);
      }
    }
    for (const marker of mod.markers) {
      if (!text.includes(marker)) {
        console.error(`[build-client] ${label}${mod.file} 缺少预期标记：${marker}（结构变了？请同步本脚本）`);
        process.exit(1);
      }
    }

    // 机器提取被注入的名字：**顶层**声明名 + export 列表。缩进口径见文件上方的 `DECL_RE`。
    const decls = [...text.matchAll(DECL_RE)];
    const minIndent = decls.length ? Math.min(...decls.map((m) => m[1].length)) : 0;
    for (const m of decls) if (m[1].length === minIndent) injected.set(m[2], mod.file);
    const EXPORT_BLOCK = /^\s*export\s*\{[\s\S]*?\};?\s*$/m;
    const exp = text.match(EXPORT_BLOCK);
    if (exp) for (const n of exp[0].replace(/^\s*export\s*\{|\};?\s*$/g, '').split(',').map((s) => s.trim()).filter(Boolean)) injected.set(n, mod.file);

    const stripped = text.replace(EXPORT_BLOCK, '').replace(/^\s*export\s+/gm, '');
    if (/^\s*export\b/m.test(stripped)) {
      console.error(`[build-client] ${label}${mod.file} 剥除 export 后仍有残留（导出块不止一块？本仓约定每文件恰好一块）`);
      process.exit(1);
    }
    parts.push(
      `\t\t// ── 内联模块：${label}${mod.file} —— ${mod.why}（构建期注入；勿手改本段）──\n` +
      indent(stripped.trim()) + '\n');
  }

  // 平铺后同作用域 ⇒ 与 `src/client.js` 正文撞名就是运行期 SyntaxError。判据同上去缩进口径
  // （否则带缩进的顶层声明漏判 —— 那正是这条断言存在的理由）。
  const bodyDecls = new Set([...bodySrc.matchAll(/^([ \t]*)(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)]
    .filter((m) => m[1].length === 0)
    .map((m) => m[2]));
  const clashes = [...injected.keys()].filter((name) => bodyDecls.has(name));
  if (clashes.length) {
    console.error('[build-client] ' + (label || 'src/client.js') + ' 重复声明了内联模块提供的常量/函数：' + clashes.join(', '));
    process.exit(1);
  }
  return parts.join('\n');
}

/**
 * 立绘（rope art）载荷的**外置**与构建期对账（2026-10-30 启动性能）。
 *
 * ## 为什么不再内联
 * 10 张立绘以前在构建期以 base64 注入主产物：2,369,676 字符 = 4.2MB bundle 的 56%，
 * 而渲染主线程实测下载 178ms、`v8.compile` 25ms（DevTools trace 2026-10-30）。立绘不是
 * 启动必需数据 —— 桌面只画**当前形态**一张，其余只在吉祥物面板里出现。现在字节仍住
 * `assets/rope/<name>.png`（随 npm 包发布），由宿主只读路由
 * `/wallpaper-engine/rope-art/<name>.png` 按需直出，客户端只拿 URL（`ROPE_IMG_*`）。
 *
 * ## 本函数只剩对账（任一不成立都 exit 1）
 * 1. 声明形态必须逐字是 `const ROPE_IMG_<NAME> = BASE + "/rope-art/<name>.png";`；
 * 2. `const ROPE_IMG_` 声明数 == 命中的形态数（有人改回内联 base64 / 改错形态 → 红）；
 * 3. 声明名与文件名一致（`ROPE_IMG_WHALE` ↔ `whale.png`；改名必须两边一起改）；
 * 4. 每个声明都有对应文件，且文件是 PNG（magic 校验；路由按 .png 出 content-type）；
 * 5. `assets/rope/*.png` 里的每一张都被某个声明用到（改名只改一边会留下孤儿文件 → 红）；
 * 6. 正文里不得残留旧的 `__ROPE_ART_` 占位符（防止半迁移状态把图挂掉）。
 *
 * 图片字节本身不改：外置是"搬位置"，不是重编码。
 */
function checkRopeArtDeclarations(text) {
  const dir = resolve(root, 'assets', 'rope');
  const declRe = /^const (ROPE_IMG_([A-Z0-9_]+)) = BASE \+ "\/rope-art\/([a-z0-9]+)\.png";$/gm;
  const hits = [...text.matchAll(declRe)];
  const declared = (text.match(/^const ROPE_IMG_/gm) || []).length;
  if (!hits.length) {
    console.error('[build-client] src/client.js 里一个立绘声明都没有：应写成'
      + ' `const ROPE_IMG_<NAME> = BASE + "/rope-art/<name>.png";`（字节在 assets/rope/，见该目录 README）');
    process.exit(1);
  }
  if (declared !== hits.length) {
    console.error(`[build-client] src/client.js 里 const ROPE_IMG_ 声明有 ${declared} 条，`
      + `符合外置形态的只有 ${hits.length} 条 —— 有一条被改回内联 base64 或写坏了`);
    process.exit(1);
  }
  const names = new Set();
  for (const m of hits) {
    const [, decl, declName, fileStem] = m;
    const want = declName.toLowerCase();
    if (fileStem !== want) {
      console.error(`[build-client] ${decl} 指向 rope-art/${fileStem}.png，但声明名要求 ${want}.png`
        + '（文件名 = 声明名的小写形式，改名必须同时动源码与 assets/rope/）');
      process.exit(1);
    }
    if (names.has(want)) {
      console.error(`[build-client] 立绘声明重复：${want}（同一张图被声明两次）`);
      process.exit(1);
    }
    names.add(want);
    const asset = resolve(dir, `${want}.png`);
    let bytes;
    try {
      bytes = readFileSync(asset);
    } catch {
      console.error(`[build-client] 找不到立绘载荷 ${asset} —— 声明 ${decl} 没有对应文件`);
      process.exit(1);
    }
    if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
      console.error(`[build-client] ${asset} 不是 PNG（magic 不符）—— 路由按 .png 出 content-type，`
        + '载荷就必须真是 PNG');
      process.exit(1);
    }
  }
  let files = [];
  try {
    files = readdirSync(dir).filter((name) => name.toLowerCase().endsWith('.png')).map((name) => name.slice(0, -4));
  } catch {
    console.error(`[build-client] 读不到立绘目录 ${dir}`);
    process.exit(1);
  }
  const orphans = files.filter((name) => !names.has(name));
  if (orphans.length) {
    console.error('[build-client] assets/rope/ 里有没被任何 ROPE_IMG_ 声明用到的孤儿文件：'
      + orphans.map((n) => n + '.png').join(', ') + '（改名只改了一边？）');
    process.exit(1);
  }
  if (/__ROPE_ART_[A-Z0-9_]+__/.test(text)) {
    console.error('[build-client] 正文里残留旧的 __ROPE_ART_ 占位符 —— 半迁移状态会让立绘挂掉');
    process.exit(1);
  }
  return text;
}

/**
 * 平铺进同一个 factory 作用域的全部代码里，**不得有两个同名顶层声明**。
 *
 * ## 为什么必须单独一条判据（现有两道都盖不住它）
 *   · `new Script(output)` 只报**语法**错误。而 `var` / `function` 的重复声明在**脚本**语义下
 *     是合法的 —— 后声明**静默胜出**，解析器一声不吭（同一份代码当成 **模块** 解析时才是
 *     SyntaxError，这个语义分裂本身就是判据缺口）。
 *   · `readInlinedPrelude()` 的撞名判据是 `injected ∩ bodyDecls`，而 `injected` 是 **Map**：
 *     内联模块**彼此之间**的重名会被 `Map.set` 静默覆盖，同样判不出来。
 *
 * **实测（本仓真实缺陷，这条判据就是为它写的）**：`src/client.js` 里 `onStartEditCacheDir`
 * 被声明两次 —— 前者只 `setTransient` + `emit`，后者多调一次 `openCacheDirBrowse`。脚本语义下
 * 后者胜出 ⇒ 前者是永不执行的死代码；而**删掉后者**（重构挪代码、或拆分这个 6206 行文件）
 * 就会让前者**静默复活** ⇒ 「更改」按钮不再弹目录浏览器，**而当时的守卫链全绿**。
 * 这类"行为改了却零判据"正是本仓最该挡的东西。
 *
 * 口径与撞名判据同源（`DECL_RE` + 该文件的最小缩进口径），因此不会因缩进写法漏判。
 */
function assertNoShadowedScopeDecls({ bodySrc, lineOffset, bodyFile, modules, baseDir, label = '' }) {
  const seen = new Map(); // name -> 'file:line'
  const dups = [];
  const scan = (file, text, lineOffset) => {
    const decls = [...text.matchAll(DECL_RE)];
    if (!decls.length) return;
    const minIndent = Math.min(...decls.map((m) => m[1].length));
    for (const m of decls) {
      if (m[1].length !== minIndent) continue;
      const at = `${file}:${text.slice(0, m.index).split('\n').length + lineOffset}`;
      const prev = seen.get(m[2]);
      if (prev) dups.push(`${m[2]} —— ${prev} 与 ${at}（后者胜出，前者永不执行）`);
      else seen.set(m[2], at);
    }
  };
  scan(bodyFile, bodySrc, lineOffset);
  for (const mod of modules) scan(`${label}${mod.file}`, readNormalized(resolve(baseDir, mod.file)), 0);
  if (dups.length) {
    console.error('[build-client] 平铺后同一作用域里有同名顶层声明（后声明静默胜出 ⇒ 前者是死代码；'
      + '反过来删掉后者会让前者无声复活，行为改变而语法层无感）：\n  ' + dups.join('\n  '));
    process.exit(1);
  }
}

// Header comments in the source are preserved inside the factory, which is
// harmless, but strip the leading "this is not the artifact / edit src" banner
// so the emitted bundle reads as a compiled artifact.
function stripHeader(srcText) {
  const lines = srcText.split('\n');
  let codeStart = 0;
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inBlock && /^\s*\/\*\*/.test(line)) inBlock = true;
    else if (inBlock && /\*\/\s*$/.test(line)) { codeStart = i + 1; break; }
  }
  // 返回 `codeStart`（正文在原文件里的起始行偏移）而不只是正文：所有报错判据都要能指回
  // **原文件**的行号 —— 报"正文第 3 行"对读日志的人毫无用处。
  return { body: lines.slice(codeStart).join('\n'), codeStart };
}

/**
 * 组装一份客户端产物 —— 主 bundle 与子包 bundle **同形**（同一个 window.__ModuleLoader__.load
 * 形状），差别只有两处：
 *   · 子包 bundle 由构建发出 `const host = require('<主包名>')`，那是跨包通道的唯一入口
 *     （ADR-0013 D13 / ADR-0014（子包契约） §5.1 ②：子包不 import 主包源码，只消费主 bundle 的
 *     `module.exports`；`exports.hostBridgeKeys` 是冻结的显式键集）。
 *     这一行**必须**由构建发出：源码面写 require 会被 test/verify-subpackage-purity.mjs 判红
 *     （它只放行产物，只放行主包名出现在 packages/<pkg>/lib/client*.js 里）。
 *   · 子包 bundle 的贡献（注册表登记）已在**模块作用域**完成 ⇒ 这里补一对幂等空 `apply` /
 *     空 `inject` 满足装载契约（宿主客户端会为图里每个 bundle 调 apply，缺了它就可能被判成
 *     「没有 apply 的插件」）；不接管任何 fiber、不注册任何 effect，因此没有可拆的东西。
 * 主 bundle 的 `apply` / `inject` / `return module.exports` 都写在 src/client.js 正文末尾，
 * 本函数不重复发（重复声明会让 assertNoShadowedScopeDecls 与运行期 var 提升语义打架）。
 */
function assembleBundle({ id: bundleId, prelude, bodySrc, hostPackage = null, bodyLabel }) {
  const outline = [
    'window.__ModuleLoader__.load({',
    `\tid: ${JSON.stringify(bundleId)},`,
    '\tfactory: (require) => {',
    '\t\tvar module = { exports: {} };',
    '\t\tvar exports = module.exports;',
    '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
  ];
  if (hostPackage) outline.push(`\t\tconst host = require(${JSON.stringify(hostPackage)});`);
  outline.push(indent(prelude));
  outline.push('\t\t// ── 客户端正文（' + bodyLabel + '）' + '─'.repeat(Math.max(0, 62 - bodyLabel.length)));
  outline.push(indent(bodySrc));
  if (hostPackage) {
    outline.push('\t\tif (typeof exports.apply !== "function") exports.apply = () => undefined;');
    outline.push('\t\tif (!Array.isArray(exports.inject)) exports.inject = [];');
    outline.push('\t\treturn module.exports;');
  }
  outline.push('\t},');
  outline.push('});');
  outline.push('');
  return outline.join('\n');
}

/** 主 bundle：立绘载荷注入只作用于它（子包没有 rope art）。 */
function buildMainBundle() {
  const source = readNormalized(resolve(root, 'src', 'client.js'));
  const { body: rawBody, codeStart: lineOffset } = stripHeader(source);
  const bodySrc = rawBody.replace(/\n+$/, '');
  checkRopeArtDeclarations(bodySrc);
  const prelude = readInlinedPrelude(INLINE_MODULES, root, bodySrc);
  // 这两条必须在拼产物**之前**跑：撞名/重复声明的失败后果在语法解析层完全看不见，
  // 因此不能指望 `new Script(...)` 兜住（见 assertNoShadowedScopeDecls 的注释）。
  assertNoShadowedScopeDecls({ bodySrc, lineOffset, bodyFile: 'src/client.js', modules: INLINE_MODULES, baseDir: root });
  return assembleBundle({ id, prelude, bodySrc, bodyLabel: 'src/client.js' });
}

/** 子包 browser half：入口正文（配方 `entry`，缺省 `src/client.js`）+ 本包自己的内联件表，产物落 `packages/<pkg>/lib/client.<pkg>.js`。 */
function buildSubpackageBundle(recipe) {
  const dir = recipe.dirAbs;
  const entryRel = toPosix(recipe.entry);
  const source = readNormalized(resolve(dir, entryRel));
  const { body: rawBody, codeStart: lineOffset } = stripHeader(source);
  const bodySrc = rawBody.replace(/\n+$/, '');
  const label = `${recipe.dir}/`;
  const entryLabel = `${label}${entryRel}`;
  const prelude = readInlinedPrelude(recipe.inline, dir, bodySrc, label);
  assertNoShadowedScopeDecls({ bodySrc, lineOffset, bodyFile: entryLabel, modules: recipe.inline, baseDir: dir, label });
  return assembleBundle({ id: recipe.name, prelude, bodySrc, hostPackage: id, bodyLabel: entryLabel });
}
