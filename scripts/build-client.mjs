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

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

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
    why: '「关于」页签的静态数据：仓库地址 + 两张二维码的路由路径（图本体是随包 PNG，见 lib/about/）',
    markers: ['const ABOUT_REPO_URL = "https://github.com/elysia395/dsh-wallpaper-engine"',
      'const ABOUT_QR_QQ_PATH = "/about-qr/qq-group.png"',
      'const ABOUT_QR_DOUYIN_PATH = "/about-qr/douyin-group.png"'],
  },
  {
    file: 'src/i18n-copy.js',
    why: '英文词表（中文原文即键）：客户端表 + 宿主显示表（两张表的键集各由 verify-i18n 双向对账）',
    markers: ['const WE_I18N_EN = {', 'const WE_I18N_HOST_EN = {'],
  },
  {
    file: 'src/i18n.js',
    why: 'i18n 运行时：跟随宿主 locale 服务的取词层（语言种类与 dsh web 同一份目录；含 ?we-lang 逃生舱）',
    markers: ['const WE_I18N_NS = ', 'function weT(', 'function weI18nAttach(',
      'function useWeLocale()', 'function weOnLocaleChange('],
  },
  {
    file: 'src/styles.js',
    why: '注入的整份样式表（纯数据，零分支；可读性下限与 CSS 必须同处一文件）',
    markers: ['const READABILITY_FLOOR = ', 'const READABILITY_FLOOR_DARK = ', 'const CSS = '],
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
    markers: ['const KINDS = {', 'function sanitizeFromSchema(', 'function settingsDefaults(',
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
  {
    file: 'src/fontset-editor.js',
    why: '字体集编辑器面板（F3 阶段 3）：纯渲染 + 意图回调（网络与状态由 client 侧经显式 ctx 给）',
    markers: ['function deleteLabel(row)', 'function renderFontSetEditor(ctx)'],
  },
  {
    // 「玻璃 UI」节的渲染器（wip §10.13）：与其余页签只共享**模块级纯助手**，
    // 所以抽出去不需要 ctx 传参样板。
    file: 'src/glass-panel.js',
    why: '「玻璃 UI」节渲染器（注册表驱动：GLASS_CHILDREN + childGlassKey；只读 ctx、动作经 on* 处理器）',
    markers: ['function renderAppearanceGlassSection(ctx) {', 'const CHILD_CN = {'],
  },
  {
    // 「扩展」页签一号模块的资源柱状图：画布层（基座模块，直接读 selection）与它的
    // **模块描述符**。两份都排在 panel-tabs 之前（数组顺序 = 注入顺序）—— 描述符是
    // panel-tabs 的 `extensionModules()` 的返回值来源；那是个**惰性**函数，所以顺序
    // 不再是"prelude 求值期"的硬约束，但依赖关系上仍该先注入。
    file: 'src/metrics-layer.js',
    why: '「硬件资源监控柱状图」的画布层：轮询 /metrics、把序列画成一行行的荧光柱（基座模块：只读 selection、零 ctx）',
    markers: ['const METRICS_SERIES = [', 'const METRICS_HOST_ID = ',
      'function syncMetricsLayer()', 'function disposeMetricsLayer()'],
  },
  {
    file: 'src/ext-metrics.js',
    why: '「扩展」页签一号模块的描述符（渲染该扩展岛；动作一律经 ctx 里的具名 on* 处理器）',
    markers: ['const METRICS_EXTENSION_MODULE = {', 'function renderMetricsIsland(ctx)'],
  },
  {
    // 「扩展」页签二号模块（点击效果与拖尾效果）：同样是"画布层 + 描述符"，同样排在
    // panel-tabs 之前（见上面一号模块那条注释里关于注入顺序的说明）。
    file: 'src/fx-layer.js',
    why: '「点击效果与拖尾效果」的画布层：跟着指针画点击光效与拖尾，内容驱动地起停 rAF（基座模块：只读 selection、零 ctx）',
    markers: ['const FX_HOST_ID = ', 'function syncFxLayer()', 'function disposeFxLayer()'],
  },
  {
    file: 'src/ext-fx.js',
    why: '「扩展」页签二号模块的描述符（渲染该扩展岛；动作一律经 ctx 里的具名 on* 处理器）',
    markers: ['const FX_EXTENSION_MODULE = {', 'function renderFxIsland(ctx)'],
  },
  {
    // 「扩展」页签三号模块（3D 效果）：跟前两个模块不同 —— 它**不建 DOM**，行为层只写 CSS 变量
    // （"各层系数"落在 body 上、"位移步长"落在要动的那几层自己身上）与一个开关属性，位移在
    // src/styles.js 的视差段里算（所以这里只注入"行为层 + 描述符"两份，样式那份归 styles.js 管）。
    // 同样排在 panel-tabs 之前。
    file: 'src/parallax-layer.js',
    why: '「3D 效果」的行为层：把光标位置换算成各层要乘的系数与位移步长（系数写 body、步长写要动的那几层自己）写进 CSS 变量（基座模块：只读 selection、零 ctx、不建 DOM）',
    markers: ['const PARALLAX_DIRECTION = ', 'const PARALLAX_VAR_X = ',
      'function syncParallaxLayer()', 'function disposeParallaxLayer()'],
  },
  {
    file: 'src/ext-parallax.js',
    why: '「扩展」页签三号模块的描述符（渲染该扩展岛；动作一律经 ctx 里的具名 on* 处理器）',
    markers: ['const PARALLAX_EXTENSION_MODULE = {', 'function renderParallaxIsland(ctx)'],
  },
  {
    // 「头像」页签的行为层：给每条助手回复挂左侧头像、每条用户消息挂右侧头像。做法是往
    // 页面里注入**一张**样式表（不建 DOM、不碰 dsh 原生的 markdown / 推理折叠 / 反馈 / 统计），
    // 头像由 ::before 伪元素画。基座模块：只读 selection、零 ctx；排在 panel-tabs 之前。
    file: 'src/avatar-layer.js',
    why: '「消息头像」层：往聊天消息行注入 ::before 头像（基座模块：只读 selection、零 ctx、只更新一张样式表）',
    markers: ['const AVATAR_STYLE_ID = ', 'function buildAvatarCss(',
      'function syncAvatarLayer()', 'function disposeAvatarLayer()'],
  },
  {
    file: 'src/picker-avatar.js',
    why: '「头像」页签的渲染器（总开关 + 两张头像的上传/清除 + 尺寸/间距/圆角滑块；显式 ctx 取外界）',
    markers: ['function renderAvatarTab(ctx)', 'function avatarUploadRow('],
  },
  {
    file: 'src/system-fonts.js',
    why: '本机字体清单的客户端通道：宿主那次进程扫描的唯一读者（清单 / 缓存 / 失败文案 / 本浏览器能否匹配的探针），与字体集通道同形',
    markers: ['const SYSTEM_FONTS_CACHE_KEY = ', 'function readCachedSystemFonts()',
      'async function ensureSystemFonts(', 'function systemFontKeyList(',
      'function filterUsableSystemFonts('],
  },
  {
    file: 'src/panel-tabs.js',
    why: '面板页签的渲染器（一个页签一个 render*Tab，其中「扩展」页签只画 extensionModules() 里登记的模块；「玻璃 UI」节已抽到 src/glass-panel.js）—— 显式 ctx 取外界',
    markers: ['function renderWallpaperTab(ctx)', 'function renderAppearanceTab(ctx)',
      'function renderAudioTab(ctx)', 'function renderMascotTab(ctx)',
      'function renderEffectsTab(ctx)', 'function renderAdvancedTab(ctx)',
      'function renderExtensionsTab(ctx)', 'function renderAboutTab(ctx)'],
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
    file: 'src/live-layer.js',
    why: '实时渲染管线：live 看护/判失败/抓帧回填/指针/poster 与壁纸层构建（syncLayers）与过场',
    markers: ['const LIVE_FIRST_FRAME_MS = ', 'function liveLog(', 'function startLiveWatch(',
      'function scheduleLiveFrameBackfill(', 'function syncLayers()', 'function toggleLiveDiag('],
  },
  {
    file: 'src/api-client.js',
    why: '宿主 API 的唯一出入口（P2-9）：前缀 / 默认 no-store / 不吞错的结构化结果',
    markers: ['const BASE = ', 'function apiUrl(', 'function pickFetch(', 'async function apiFetch(',
      'const apiJson = ', 'const apiHead = '],
  },
  {
    // 玻璃后端的唯一落点（wip §10.13）：从 `effects.js` 抽出的那一段 ——
    // 输入输出封闭（只要 `selection` + `body.style`），所以抽出来之后
    // ⑪/⑫/⑬ 三组守卫读的"写了什么"有了单一归属，R3b 的形状改动也只落在这里。
    file: 'src/glass.js',
    why: '玻璃后端：取值解析 / 各面釉层变量 / 门控属性（无条件写，值槽位与开关正交）',
    markers: ['const toRgbTriple = (hex) => {', 'function applyGlass(selection, s) {',
      'const glassValue = (surface, param, profileValue, globalValue) =>'],
  },
  {
    file: 'src/effects.js',
    why: '效果应用层（设置 → DOM；契约见文件头，见 P1-7 后半）—— 玻璃那一段已抽到 src/glass.js',
    markers: ['let lastScrimCss = "";', 'function applyEffects(', 'applyGlass(selection, s);',
      'function clearEffects()', 'function resolveWallpaperFadeBg()'],
  },
];

/**
 * 读取一个构建输入、归一化成 LF，**并断言不再有孤立 CR**。
 *
 * 为什么这条断言值得让构建**红**：源文件里若混进多余的回车（历史形态：`src/i18n-copy.js` 曾有
 * 28 行是 `\r\r\n`），Windows 检出会把它放大成 `\r\r\n`、Linux 检出是 `\r\n`，而这里只做
 * `\r\n → \n` 归一化 ⇒ Windows 上会**残留一个孤立 CR** ⇒ **同一份源码在两个平台产出不同字节的
 * 产物**。于是 commit 哪一份，另一条 CI 腿的「产物与源码同步」（`git diff --exit-code --
 * lib/client.js`）都会红 —— 实测：ubuntu 腿红、win32 腿绿（本机怎么跑都看不出来）。
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

const src = readNormalized(resolve(root, 'src', 'client.js'));
const body = stripHeader(src).replace(/\n+$/, '');
const prelude = readInlinedPrelude();

const outline = [
  'window.__ModuleLoader__.load({',
  `\tid: ${JSON.stringify(id)},`,
  '\tfactory: (require) => {',
  '\t\tvar module = { exports: {} };',
  '\t\tvar exports = module.exports;',
  '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
  indent(prelude),
  '\t\t// ── 客户端正文（src/client.js）────────────────────────────────────────',
];

// Indent the source body by two tabs. Preserve blank-line gaps; never indent
// an already-blank line.
outline.push(indent(body));
outline.push('\t},');
outline.push('});');
outline.push('');

const output = outline.join('\n');

// 产物必须可解析 —— 内联后出现重复声明/括号错配时在这里就红，而不是等到用户页面白屏。
try {
  new Script(output, { filename: 'lib/client.js' });
} catch (err) {
  console.error(`[build-client] 产物语法错误：${err && err.message}`);
  process.exit(1);
}

const target = resolve(root, 'lib', 'client.js');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, output);
const inlined = INLINE_MODULES.map((m) => m.file).join(' + ');
// 进度信息走 **stderr**，把 stdout 留给机读输出：`npm run build` 的输出会被 `prepare` 带进
// `npm pack` / `npm publish` 的 stdout，而它们的 `--json` 要求 stdout 上**只有 JSON**
// （实测：`npm pack --dry-run --json` 原本因这一行而无法解析）。错误本就打 stderr。
console.error(`built ${target} (${Buffer.byteLength(output)} bytes; inlined: ${inlined})`);

function indent(text) {
  return text.split('\n').map((line) => (line.trim() === '' ? '' : '\t\t' + line)).join('\n');
}

/**
 * 读取 INLINE_MODULES 并拼成可内联的 prelude：
 *   · 断言每个模块**浏览器安全**（无 import/require/Node 全局）；
 *   · 断言形状符合预期（markers 全在）；
 *   · 剥掉 `export {...}` 块与声明前的 `export ` 关键字（内联后同作用域，不需要导出）；
 *   · 断言 src/client.js **没有**重复声明任何一个被注入的名字
 *     （重复 = 运行时 SyntaxError；名字从模块里**机器提取**，不维护手工清单）。
 */
function readInlinedPrelude() {
  const parts = [];
  const injected = new Map(); // name -> file
  for (const mod of INLINE_MODULES) {
    const abs = resolve(root, mod.file);
    const text = readNormalized(abs);
    // 判据针对**代码**：先剥注释。否则模块头里写一句 `node -e "require('fs')…"` 的
    // 复核命令就会被判成"含 require"（**实测**：这类假阳性出现过多次）。
    const code = text
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

    for (const [re, what] of [
      [/^\s*import\s/m, 'import 语句'],
      [/\brequire\s*\(/, 'require()'],
      [/^\s*export\s+default/m, 'export default'],
      [/\bprocess\.\w/, 'process.*'],
      [/\b__dirname\b|\b__filename\b/, 'CommonJS 路径全局量'],
    ]) {
      if (re.test(code)) {
        console.error(`[build-client] ${mod.file} 必须浏览器安全，但含${what}`);
        process.exit(1);
      }
    }
    for (const marker of mod.markers) {
      if (!text.includes(marker)) {
        console.error(`[build-client] ${mod.file} 缺少预期标记：${marker}（结构变了？请同步本脚本）`);
        process.exit(1);
      }
    }

    // 机器提取被注入的名字：**顶层**声明名 + export 列表。
    // ⚠️ 判据是"缩进 == 本文件声明的最小缩进"，不是"行首"也不是任意缩进：
    //   · 要求行首（原实现 `^(?:const|let|var|function)`)会**静默漏掉**把顶层声明写了一层缩进的模块
    //     （本仓真实形态：`src/picker-modal.js` / `src/picker-props-panel.js` / `src/quick-panel.js`）
    //     ⇒ 撞名不被判出，平铺后就是运行期 SyntaxError；
    //   · 只写 `^\s*` 又会把**嵌套**声明（函数内 const/let）全收进来 ⇒ 遍地假撞名。
    const DECL_RE = /^([ \t]*)(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;
    const decls = [...text.matchAll(DECL_RE)];
    const minIndent = decls.length ? Math.min(...decls.map((m) => m[1].length)) : 0;
    for (const m of decls) if (m[1].length === minIndent) injected.set(m[2], mod.file);
    const EXPORT_BLOCK = /^\s*export\s*\{[\s\S]*?\};?\s*$/m;
    const exp = text.match(EXPORT_BLOCK);
    if (exp) for (const n of exp[0].replace(/^\s*export\s*\{|\};?\s*$/g, '').split(',').map((s) => s.trim()).filter(Boolean)) injected.set(n, mod.file);

    const stripped = text.replace(EXPORT_BLOCK, '').replace(/^\s*export\s+/gm, '');
    if (/^\s*export\b/m.test(stripped)) {
      console.error(`[build-client] ${mod.file} 剥除 export 后仍有残留（导出块不止一块？本仓约定每文件恰好一块）`);
      process.exit(1);
    }
    parts.push(
      `\t\t// ── 内联模块：${mod.file} —— ${mod.why}（构建期注入；勿手改本段）──\n` +
      indent(stripped.trim()) + '\n');
  }

  // 平铺后同作用域 ⇒ 与 `src/client.js` 正文撞名就是运行期 SyntaxError。判据同上去缩进口径
  // （否则带缩进的顶层声明漏判 —— 那正是这条断言存在的理由）。
  const bodyDecls = new Set([...body.matchAll(/^([ \t]*)(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)]
    .filter((m) => m[1].length === 0)
    .map((m) => m[2]));
  const clashes = [...injected.keys()].filter((name) => bodyDecls.has(name));
  if (clashes.length) {
    console.error('[build-client] src/client.js 重复声明了内联模块提供的常量/函数：' + clashes.join(', '));
    process.exit(1);
  }
  return parts.join('\n');
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
  return lines.slice(codeStart).join('\n');
}
