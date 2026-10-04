/**
 * settings-schema.js — **设置的唯一真源**（客户端与宿主两侧共用）。
 *
 * 为什么要有这个文件：同一份设置表若在各处各写一遍 —— 客户端 `DEFAULTS`、
 * 客户端 `sanitizeSettings`、客户端 `serializeSelection`、宿主 `sanitizeSettings`
 * （外加宿主侧 8 张手抄枚举表）—— 白名单漏一个键就会让客户端的设置被**静默丢弃**
 * （症状是"改了没生效、重启回默认"）。现在键集只在这里定义一次：
 * 客户端与宿主都从 `KINDS` 派生各自的 sanitize，守卫再断言两侧集合一致。
 *
 * 三份数据的分工（都在本文件里）：
 *   · `DEFAULTS` —— 默认值（含只做默认值、不持久化的 `DEFAULTS_ONLY`）。
 *   · `KINDS`    —— 每个键怎么校验（范围 / 枚举 / 布尔方向 / 颜色 / 容器…）。
 *   · 枚举表     —— 各白名单的取值（客户端与宿主共用这一份）。
 *
 * 两侧差异只有两处，且都在这里显式声明：
 *   · `CLIENT_ONLY`  —— 只存 localStorage，宿主**不收**（设备本地的抽帧/自定义画面记忆）。
 *   · 非对象输入      —— 宿主返回 `null`（调用方判空），客户端返回默认值对象。
 *
 * 客户端怎么拿到本文件：**构建期内联**（`scripts/build-client.mjs` 把本文件剥掉
 * `export` 后注入客户端 bundle 的工厂作用域，缺标记即构建失败）。所以本文件必须
 * **浏览器安全**：不得出现 import / require / Node API / 顶层副作用。
 */

// ── 枚举白名单（唯一真源）───────────────────────────────────────────────────
const RATING_VALUES = ['all', 'everyone', 'pg13', 'mature', 'unrated'];
const TYPE_VALUES = ['all', 'video', 'web', 'image', 'scene'];
const OBJECT_FIT_VALUES = ['cover', 'contain', 'center', 'fill'];
const AUDIO_SOURCE_VALUES = ['off', 'auto'];
const PICKER_LAYOUT_VALUES = ['classic', 'fixed'];
const ROPE_FORM_VALUES = ['maid', 'whale'];
const ROPE_SCALE_MIN = 0.5, ROPE_SCALE_MAX = 2.5;
const FONT_FAMILY_VALUES = ['inherit', 'Microsoft YaHei', 'KaiTi', 'SimSun', 'SimHei', 'STXingkai', 'monospace'];
/**
 * **系统字体族键**：`sys:<本机字体族名>`，与上面的内置族键同住一个值域。
 *
 * 为什么是"键"而不是直接把 CSS 栈存进去：栈（引号 + fallback 链）由客户端的
 * `fontFamilyStack` 解析（本文件不猜字体栈长什么样）；而本机字体清单是**宿主枚举**出来的
 * （`lib/routes/system-fonts.js`），所以这里**没有静态白名单** —— 名字自然不能查表。
 * 校验因此只回答一个问题：**这个值能不能安全进 CSS**。
 *   · 名字在 CSS 里由解析侧**加引号**使用（`"<名字>"`）⇒ 禁用能破坏字符串/规则的字符
 *     （`;{}<>` / 引号 / 反斜杠 / 控制符）与首尾空白，并限长；逗号、空格、连字符都合法。
 *   · 两端（宿主 / 客户端）共用本文件的消毒路径 ⇒ "存进去的"与"读出来的"不会分叉。
 */
const SYSTEM_FONT_KEY_PREFIX = 'sys:';
const SYSTEM_FONT_NAME_MAX = 64;
const SYSTEM_FONT_NAME_RE = new RegExp('^[^;{}<>"\'\\\\\\u0000-\\u001f\\u007f]{1,' + SYSTEM_FONT_NAME_MAX + '}$');
/** 非 `sys:` 的族值 = **历史** CSS 栈（F3 之前组件字体存的就是它）；同样消毒 + 限长。 */
const FAMILY_STACK_MAX = 80;
const FAMILY_UNSAFE_RE = /[;{}<>"'\\\u0000-\u001f\u007f]/g;

/** 族名 → `sys:` 键（不是合法名字时给空串，调用方据此丢弃）；已是键则原样返回。 */
function systemFontKeyOf(name) {
  const s = typeof name === 'string' ? name.trim() : '';
  if (!s) return '';
  if (isSystemFontKey(s)) return s;
  return SYSTEM_FONT_NAME_RE.test(s) ? SYSTEM_FONT_KEY_PREFIX + s : '';
}
function isSystemFontKey(v) {
  return typeof v === 'string'
    && v.startsWith(SYSTEM_FONT_KEY_PREFIX)
    && SYSTEM_FONT_NAME_RE.test(v.slice(SYSTEM_FONT_KEY_PREFIX.length));
}
/** `sys:` 键 → 族名（不是系统字键时给空串）。 */
function systemFontNameOf(key) {
  return isSystemFontKey(key) ? key.slice(SYSTEM_FONT_KEY_PREFIX.length) : '';
}
/**
 * 一个族键（内置 / `sys:`）的消毒。**带前缀但名字不合法一律作废**（空串），
 * 不"修好它" —— 把 `sys:a;b` 修成 `sys:ab` 会变成另一个字体，那是无声改值。
 */
function sanitizeFamilyKey(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (!s) return '';
  if (s.startsWith(SYSTEM_FONT_KEY_PREFIX)) return isSystemFontKey(s) ? s : '';
  return FONT_FAMILY_VALUES.includes(s) ? s : '';
}
/**
 * 组件字体的族值（值域更宽：**历史 CSS 栈**也在其中，见上）。
 * 同样地：带 `sys:` 前缀却不合法 ⇒ 作废，不修剪成另一个键。
 */
function sanitizeFamilyValue(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (!s) return '';
  if (s.startsWith(SYSTEM_FONT_KEY_PREFIX)) return isSystemFontKey(s) ? s : '';
  return s.replace(FAMILY_UNSAFE_RE, '').trim().slice(0, FAMILY_STACK_MAX);
}
// 帧率上限（抽帧转码）的档位。设计口径：**默认无限制**；上限存在的唯一目的是压 GPU 解码
// 占用（Video Decode 随帧率上升，是壁纸里最大的一块）。所以只留真正省得下解码量的档：
//   0  = 无限制（缺省）；
//   60 = 把 120fps 源砍半（4K120 这类素材）；
//   30 = 把 60/50fps 源砍半（WE 视频壁纸的主流档位）。
// 已退役：48（没有对应素材群体，60→48 只省两成，不值得一次整片重编码）、
// 24（多数壁纸明显发顿，省下的解码量却与 30 相差不大）。存量 48/24 由枚举值域
// **clamp 回缺省 0（无限制）** —— 与"默认无限制"同一口径，不需要迁移代码。
const FPS_CAP_VALUES = [0, 60, 30];
const SCENE_LIVE_FPS_VALUES = [15, 30, 60];
const SWITCH_TRANSITION_VALUES = ['cut', 'fade', 'push', 'wipe', 'iris', 'zoom', 'bars'];
const SWITCH_DIRS = ['left', 'right', 'up', 'down'];
const SWITCH_SPEED_VALUES = ['fast', 'normal', 'slow'];
// 适配目标（见 DEFAULTS.adapterTarget 的语义注释）：auto = 自动检测，
// 其余三个是手选覆盖，与宿主按请求观测出来的三档同名同字面量。
const ADAPTER_TARGET_VALUES = ['auto', 'browser', 'desktop-community', 'desktop-official'];
// 硬件资源监控柱状图（「扩展」页签的第一个模块）的配色档：
//   accent   = 跟随「外观」页签的配色（每根柱子取同一个色相的不同明度，最省事也最协调）
//   spectrum = 每条序列用**用户自己为它选的颜色**（`metricsColor*` 五键，默认就是下面那五个
//              内置色相 ⇒ 语义换了、画面没换，多行柱子仍然最好分辨）
//   mono     = 全部同一前景色，只靠亮度区分（灰度/低饱和壁纸上最不抢画面）
const METRICS_COLOR_MODE_VALUES = ['accent', 'spectrum', 'mono'];
// 柱状图叠到壁纸上的混合模式（= CSS `mix-blend-mode` 的字面量，面板里给中文名）：
//   auto 是**唯一**的特殊值：按壁纸明暗自动切换（亮 → multiply 正片叠底，暗 → overlay 叠加），
//   判据是画布层采样壁纸**下半部分**的亮度、并还原本插件自己的效果之后的**实际显示亮度**
//   （背景亮度 / 对比度、壁纸透明度的淡出底色、暗化 scrim —— 见 src/metrics-layer.js 的
//   metricsDisplayLuma）—— 采不到（网页 / 场景壁纸是 iframe、跨源污染、还没解码）就退回
//   **上一次手选的档**（见 metricsResolveBlend。
const METRICS_BLEND_VALUES = ['auto', 'normal', 'multiply', 'overlay', 'screen', 'soft-light', 'darken', 'lighten'];

// 点击效果与拖尾效果（「扩展」页签的第二个模块）：
//   点击样式 —— ripple = 从落点扩散的圆环；spark = 向四周飞散的亮点；both = 两者一起。
const FX_CLICK_STYLE_VALUES = ['ripple', 'spark', 'both'];
//   拖尾样式 —— comet = 一条渐隐的光带（逐段收细）；dust = 留在原地的亮点（星尘）。
const FX_TRAIL_STYLE_VALUES = ['comet', 'dust'];
//   配色档 —— accent = 跟随「外观」页签的配色；rainbow = 每次效果的色相都不一样；
//   custom = 用 `fxColor` 那一个颜色。画布层按**每个效果实例**取色（同一次点击/同一条拖尾
//   是一种颜色），所以 rainbow 在时间上也是彩的。
const FX_COLOR_MODE_VALUES = ['accent', 'rainbow', 'custom'];
//   混合模式（= CSS `mix-blend-mode` 的字面量，面板里给中文名）：这一层是**发光**装饰，
//   默认 screen（滤色）—— 它只让画面变亮，暗背景上最像霓虹；normal / overlay / multiply /
//   lighten 是给"想让它更像实体贴纸"的场合留的手选档（这里没有 auto：判明暗要采样壁纸，
//   而本模块的画布层刻意不读壁纸像素 —— 一条常驻的光效层不值得每两秒去 drawImage 一次）。
const FX_BLEND_VALUES = ['screen', 'normal', 'overlay', 'multiply', 'lighten'];

// ── 默认值：**唯一定义处**（每个键的语义写在注释里）──────────────────────────
/** 玻璃釉色的出厂默认（浅色主题下的白釉）。单一字面量，避免多处手抄。 */
const GLASS_COLOR_DEFAULT = '#ffffff';

/**
 * 子 UI 玻璃登记表 —— **「玻璃 UI」节里那些子控件的单一真源**。
 *
 * 用途：面板的「子 UI 独立配置」层按这张表逐项渲染；每个子项的**是否用自己那套釉层参数**
 * 记在 `glassMode[<id>]`（`'inherit' | 'custom'`，与侧栏 / 内容面同一机制，见 wip §3 / §4.12）。
 * ⚠️ 曾经的 `glassChildren`（每项"要不要玻璃"）与 `glassOverrides`（手抄的能力表）**都已删除**：
 * 前者随"关 ⇒ 回原生"那一层退役（§10.20），后者被"注册表 `params` ↔ 接线点"的对账取代（§10.17）。
 *
 * ⚠️ 为什么是"登记表 + 生成"而不是"手写四套键"：
 *   每个子项都要有形态相同的一组参数键（颜色 / 透明度 / 模糊 / 保真度）。手抄四份
 *   必然漂（本仓的实测结论）。所以 `params` 只写**参数名与量程**，键名由
 *   `childGlassKey()` 统一生成、量程与 DEFAULTS 也从这里取。
 *
 * ⚠️ `id` 必须与 `test/verify-glass-surfaces.mjs` 的 `SURFACES[].overrideKeys` 对得上 ——
 *   守卫第 ④ 组按 `glassOverrides` 的**面名**做双向对账，写错面名会被判"永远读 undefined"。
 *
 * ⚠️ **不含侧栏**：dsh-better-sidebar 侧栏有它**自己早有的一套键**
 *   （`sidebarBlur` / `sidebarAlpha` / `sidebarColor` / `sidebarContent*`），
 *   按 D2 复用既有键、不新建平行键；它的开关在「窗口与侧栏」节里
 *   （因为它依赖 `sidebarPresent`，与本次重构无关）。
 */
/**
 * 子 UI 玻璃登记表 —— **「玻璃 UI」节里那些子控件的单一真源**。
 *
 * ⚠️ **不含「左侧栏玻璃」**（用户口径）：左侧栏的"独立配置"**耦合在「左侧栏液态玻璃」**上
 *   （见 `src/panel-tabs.js` 的「细节」节）—— 因为左侧栏的"关"是**恢复背景**（那一列回到
 *   壁纸原样），与这里"关 = 回到原生不透明纯色"是**不同语义**，所以它不参与本表。
 *
 * ⚠️ **不含侧栏**：dsh-better-sidebar 侧栏有它**自己早有的一套键**
 *   （`sidebarBlur` / `sidebarAlpha` / `sidebarColor` / `sidebarContent*`），
 *   按 D2 复用既有键、不新建平行键；它的开关仍在「窗口与侧栏」节里。
 */
const GLASS_CHILDREN = [
  {
    id: 'settingsWindow', label: '设置窗口玻璃',
    hint: '整个设置窗口（含全部原生分区）',
    // ⚠️ **不含 `fidelity`**：这一面用的是**共享面纱声明**，而面纱形（F2a）与
    //    `--we-readability-floor` 的声明形（F1c）把地板锁在全局那对变量上 ⇒
    //    逐面保真度在"判据不变"的前提下**不可达**（见 wip §4.14）。
    //    给它一个接不通的旋钮，等于造第二个"开关是死的"。
    // ⚠️ **不含 `color`**（R3a，wip §10.12）：本面的 CSS 只读 `--we-settings-window-blur/-alpha`
    //    两个变量 ⇒ `settingsWindowColor` **无人读取**。注册表的 `params` 必须等于**真正接线**
    //    的那批，否则面板会渲染一个死旋钮（这正是"能力表是手抄的"留下的坑）。
    params: { transparency: 100, blur: 60 },
  },
  {
    id: 'conversation', label: '对话框玻璃',
    hint: '输入卡片 / 消息气泡 / 工具弹卡',
    // ⚠️ 本子项**可以有 `fidelity`**：对话栏那一族有**自己的** `--we-chat-readability-*`
    //（上游为它单独拆过一把尺），而 F2a 的面纱形**明确接受** `--we-chat-` 前缀。
    // 另外**复用既有键**（D2：不新建平行键）：
    //   · fidelity → `chatGlassFidelity`（原「对话栏玻璃保真度」旋钮的存储键）
    // 用户口径：「对话框玻璃·独立配置」存在之后，独立的「对话栏玻璃保真度」不再需要 ——
    // 与其并存会变成"两个旋钮控同一件事"。所以它的键**留用**、旋钮**撤掉**。
    // ⚠️ **不含 `transparency` / `blur`**（R3a，wip §10.12）：本面接线的只有
    //    `--we-chat-glass-fidelity` 与 `--we-chat-surface-tint-*`（颜色）⇒ 那两个键无人读取。
    params: { color: 0, fidelity: 100 },
    keyOverrides: { fidelity: 'chatGlassFidelity' },
  },
  {
    id: 'floaters', label: '浮层玻璃',
    hint: '插件自己的更新提示 / 壁纸仓库抽屉',
    // ⚠️ 同 `settingsWindow`：共享面纱 ⇒ **不含 `fidelity`**（见 wip §4.14）；
    //    同理**不含 `color`**（R3a：本面只读 `--we-floaters-blur/-alpha`）。
    params: { transparency: 100, blur: 60 },
  },
  {
    // ⚠️ **乙类**：左侧栏的"关"是**恢复背景**（那一列回到壁纸原样），与其余子项
    // "关 = 回到原生不透明纯色"是不同语义（见 wip §2）。
    // 它留在登记表里的理由：需要 schema **生成它那三个键**（`leftSidebarBlur` /
    // `leftSidebarTransparency` / `leftSidebarColor`）并把它们纳入 DEFAULTS/KINDS。
    // 但它**不进「子 UI 玻璃」那一层**（`panelOff`），因为：
    //   · 它已有自己的总开关 `leftSidebarGlass`（「左侧栏液态玻璃」）——两个开关控一件事；
    //   · 它的"独立配置"耦合在「左侧栏液态玻璃」下面（见 panel-tabs.js 的「细节」节）。
    id: 'leftSidebar', label: '左侧栏玻璃',
    hint: '宿主原生左栏（会话列表 / 工作区那一列）',
    panelOff: true,
    // ⚠️ R3a（wip §10.12）：去掉 `color` —— 本面只读 `--we-left-sidebar-blur/-alpha`；
    //    面板原先还渲染了「玻璃保真度」一行，那连 schema 键都不存在（`leftSidebarFidelity`）
    //    ⇒ 那一节本来是"四件套"，其中**两个是死的**。现在与接线逐参数一致：两件。
    params: { transparency: 100, blur: 60 },
  },
];

/**
 * 子 UI 的「独立值」键名。**单一生成点**，且尊重 `keyOverrides`（D2 的"复用既有键"）。
 *
 * 为什么要有 keyOverrides：某些子项的参数**早就有自己的键**了（例如对话栏的保真度键
 * `chatGlassFidelity`，来自上游那个已被本次重构撤掉旋钮的同名功能）。按 D2 必须**复用**
 * 它，而不是新建 `conversationFidelity` —— 否则同一件事有两个键，又会漂。
 */
const GLASS_CHILD_BY_ID = Object.fromEntries(GLASS_CHILDREN.map((c) => [c.id, c]));
const childGlassKey = (id, param) => {
  const ov = GLASS_CHILD_BY_ID[id] && GLASS_CHILD_BY_ID[id].keyOverrides;
  if (ov && ov[param]) return ov[param];
  return id + param.charAt(0).toUpperCase() + param.slice(1);
};

/**
 * 玻璃预设（`glass-presets/<id>.json`）的**键白名单与消毒**。
 *
 * 预设 = 玻璃子系统的一份**完整快照**（不是稀疏补丁）：应用一份预设 ⇒ 这批键全部变成
 * 预设里的值。快照语义是刻意的 —— "切预设"必须是**可预测的**（同一份预设永远得到同一个
 * 观感），"应用 = 只改预设里写了的键"会让结果取决于应用时刻的其它键，等于不可判定。
 * 缺键由 `sanitizeGlassPresetValues` 用玻璃键的默认值补齐 ⇒ 存盘的每一份都是完整的。
 *
 * 键集**单一来源**：固定键（全局四件套 + 各面的显示开关与侧栏族）+ `GLASS_CHILDREN`
 * 登记表生成的子项独立键（尊重 `keyOverrides`）—— 与面板渲染、KINDS/DEFAULTS 同源，
 * 登记表加了参数这里自动跟上，不会漂。
 */
const GLASS_PRESET_SCHEMA_TAG = 'dsh-we/glass-preset@1';
// 隐藏出厂预设的墓碑标记（落在用户层 glass-presets/<id>.json，遮住随包层）；
// 恢复 = 删墓碑。见 lib/routes/presets.js 的删除三分语义。
const GLASS_PRESET_TOMBSTONE_TAG = 'dsh-we/glass-preset-tombstone@1';
const GLASS_PRESET_FIXED_KEYS = [
  // 全局四件套 + 模式映射（各面「读自己 / 跟全局」）
  'glassColor', 'glassAlpha', 'blur', 'glassFidelity', 'glassMode',
  // 两个独立的显示开关（乙类 / 思考块；语义见 src/glass.js 的退役说明）
  'leftSidebarGlass', 'thinkingGlass', 'capsuleBlur', 'capsuleColor',
  // dsh-better-sidebar 侧栏族（与全局玻璃同一套语义的独立键组）
  'sidebarGlass', 'sidebarFullClear', 'sidebarFollowGlobal',
  'sidebarBlur', 'sidebarAlpha', 'sidebarColor', 'sidebarContentAlpha', 'sidebarContentColor',
];
const GLASS_PRESET_KEYS = [...new Set([
  ...GLASS_PRESET_FIXED_KEYS,
  ...GLASS_CHILDREN.flatMap((c) => Object.keys(c.params).map((p) => childGlassKey(c.id, p))),
])];
/**
 * 把任意输入规范成**完整的玻璃键快照**：只收白名单键、逐键过 KINDS 同一套校验
 *（委托 `sanitizeFromSchema` —— 不复述任何 kind 语义）、缺键补玻璃键默认值。
 * 两侧共用（宿主落盘前、客户端保存前都过它）⇒ 存储里的形状只有一个。
 */
function sanitizeGlassPresetValues(raw) {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  // ⚠️ 预设正文是**当前形状**的快照，不是历史存档 —— 必须显式盖上当前版本号再委托：
  //    `sanitizeFromSchema` 入口会跑 `migrateSettings`，而那函数对"没有版本号的档"一律按
  //    旧刻度做 v4 换算（glassAlpha ×100/60 等）—— 不盖版本号，快照里已在新刻度上的值
  //    会被当成旧刻度整批改写（实测 70 → 100）。盖了它，迁移按"≥ 当前 ⇒ 原样返回"短路。
  const full = sanitizeFromSchema(Object.assign({}, src, { settingsVersion: SETTINGS_VERSION }), 'host');
  const out = {};
  for (const key of GLASS_PRESET_KEYS) out[key] = full[key];
  return out;
}
/** 预设 id 的白名单与字体集 id **同一条**（单段 `[A-Za-z0-9_-]{1,64}`）—— 路径安全同源。 */
const isGlassPresetId = isFontSetId;



/**
 * `glassMode` 的**权威默认值**：**每个面都是 `'inherit'`（跟随全局）**。
 *
 * ⚠️ 这里曾经是"既有面（`sidebar` / `sidebarContent`）默认**独立**"，理由是它们从 P2 起就读自己的键。
 * 那个理由**现在不成立**，而且它解释不了用户实测的现象：
 *   · 用户口径是"**全局的玻璃使用同一套配置语义**" ⇒ 默认必须是**继承全局**；独立是用户
 *     **显式按下**「独立配置」之后的事。否则"全局参数"根本不是全局的。
 *   · §4.25 修好默认值机制之前 `glassOverrides` 恒空 ⇒ 这个默认值**从未真正生效过**
 *     （那时侧栏其实一直在跟全局）⇒ 没有任何"用户真正体验过的既有状态"需要保。
 *   · 用户实测：「子 UI 玻璃」关闭时全局「玻璃透明度」完全失效、「雾化」对右侧栏无效 ——
 *     根因就是侧栏默认"独立"⇒ 读自己的 `sidebarBlur` / `sidebarAlpha`（见 wip §10.3）。
 * ⇒ 全部 **`'inherit'`**；`sidebar` / `sidebarContent` 与其余面**一视同仁**（这正是已授权的
 *   "允许侧栏观感发生一次语义迁移"）。旧存档由 `settingsVersion` 迁移接管（见 §10.16 / §10.17）。
 */
const GLASS_MODE_DEFAULTS = Object.fromEntries([
  ['sidebar', 'inherit'], ['sidebarContent', 'inherit'],   // 既有面：语义迁移后同样默认跟随全局
  ...GLASS_CHILDREN.filter((c) => !c.panelOff).map((c) => [c.id, 'inherit']),
]);

/**
 * 设置形状的**当前版本**（R3b 引入，wip §10.16）。见 KINDS.settingsVersion 与 migrateSettings。
 * 变动默认语义 / 存储形状时 +1，并在 `migrateSettings` 里加一档。
 */
const SETTINGS_VERSION = 5;

const DEFAULTS = {
  scrim: 0.25,
  border: 0.35,
  blur: 16,
  wallpaperBlur: 0,
  // Background knobs (%, 100 = untouched): brightness / contrast / saturate of
  // the wallpaper media filter. Ranges mirror the readability lab.
  backgroundBrightness: 100,
  backgroundContrast: 100,
  backgroundSaturate: 100,
  // 壁纸透明度（#82，0–90%，0 = 不动）：媒体叶子的 element opacity，越大越透
  // （与本插件其他「透明度」滑块同语义）。淡出时壁纸融向**原生外观**（浅色纯白 /
  // 深色纯黑）—— IDEA 背景图式「看得见但不喧宾夺主」。作用在 .we-layer 的媒体
  // 叶子（视频/图片/网页/画布统一生效），层本身垫这层原生底色以保住玻璃模糊；
  // 暗化（scrim）叠在壁纸之上，建议先降到 0 再调本滑块。
  wallpaperOpacity: 0,
  rotationEnabled: false,
  rotationInterval: 30,
  // ── 切换过场（手动点选与自动轮播共用）────────────────────────────────
  // 默认 **硬切**：先上零成本、零风险的切换，等把「最帅的」讨论定下来再改默认
  // （改默认只需要动这一个值 + 一条断言）。可选：交叉淡化 / 推移 / 擦除 / 光圈 /
  // 缩放 / 条带。allTransitions 见 SWITCH_TRANSITIONS。
  switchTransition: "cut",
  // 方向（只对方向型转场有意义：推移 / 擦除 / 条带）。left = 画面整体向左移动，
  // 亦即新画面从右侧进入。
  switchTransitionDir: "left",
  // 时长档：每类型自带基准毫秒 × 本乘子（SWITCH_SPEEDS）。默认 normal。
  switchTransitionSpeed: "normal",
  rotationGroupId: "",
  rotationGroups: [],
  rotationSeeded: false,
  // Soft-delete: ids of wallpapers the user hid (localStorage only, no file
  // changes). Hidden wallpapers leave the normal list + rotation candidates
  // but keep playing if already active; they reappear on restore.
  hiddenIds: [],
  // Video playback speed (0.5x–2x, applied via native playbackRate).
  playbackRate: 1,
  // 解码帧率上限（fps；0 = 无限制）：对源帧率高于上限的视频壁纸，host 一次性
  // ffmpeg 重编码为上限帧率的"抽帧版"（4K120→4K60，时间线保持 1.0x 正常速度，
  // 解码占用随帧率线性下降）。与倍速完全解耦 —— 倍速照常叠加在抽帧版上。
  // 无 ffmpeg 或转码失败时自动回退原片（transcodeState: "fallback"）。
  fpsCap: 0,
  // Scene 壁纸的出图 URL（供页面刷新 / 切换出图来源时重挂那一帧）。
  sceneFrameUrl: null,
  // 场景实时渲染（WebWallGL live WebGL）：scene.pkg 壁纸由 vendored WebWallGL
  // 渲染页实时渲染（粒子/脚本/视差/包内音频），默认开启；加载失败或运行
  // 失联时按壁纸记忆失败并自动降级回 sceneVideo → 出图来源链（见
  // sceneLiveFailures / startLiveWatch）。帧率上限是渲染 fps，与视频壁纸的
  // 抽帧转码（解码 fps）互不相干。
  sceneLive: true,
  sceneLiveFps: 30,
  // 实时渲染的**启动等待上限**（秒）：只在「重启恢复上次壁纸」时生效（用户手动切换不等待）。
  // 延迟期**照常开始加载**（iframe 一赋 src 就在拉 pkg / 解码纹理 / 编译 shader —— 让首帧先
  // 热起来才是这一档存在的理由），只是先显示占位图；**首帧一就绪就立刻换上**，到上限仍未
  // 出帧也换上。0 = 不等待（立即挂载）。
  liveBootDelay: 3,
  // 系统音频反应（频谱来源）：auto = 宿主有采集能力就用（macOS 走 CoreAudio
  // Process Tap，首次需一次性「音频录制」授权；Linux/Windows 走 ffmpeg +
  // monitor/虚拟设备）。**常开**（kind 'const'：读写一律默认值，面板不
  // 提供开关）；整体关闭仍可用宿主环境变量 `DSH_WE_MEDIA_NO_AUDIO=1`（见
  // lib/routes/now-playing.js 的启动决策）。缺失/未授权时自动回落。
  audioSource: "auto",
  // 媒体集成（Now Playing）：把系统正在播放的歌名/歌手/专辑/封面/进度推给壁纸的
  // wallpaperMediaIntegration 监听器。数据由宿主侧的媒体后端提供（首选
  // media-bridge 中间件：macOS MediaRemote / Windows GSMTC / Linux MPRIS，
  // 三平台都内置；取不到时宿主自动回落到内置实现）。
  // **常开**（kind 'const'，面板不提供开关）。
  mediaIntegration: true,
  // 适配目标：插件跑在哪种宿主形态里。`auto` = 自动检测 —— 宿主按请求观测
  //（能力头 x-dsh-desktop-renderer ⇒ 有栅栏的桌面端；UA 带 Electron/ ⇒ 桌面壳；
  // 两者皆无 ⇒ 原生浏览器），另三个字面量供手选覆盖，**手选优先于观测**。
  // 手选是检测不准时的自救，同时直接改行为：
  //   · 手选任一桌面目标 ⇒ 网页壁纸载荷恒走独立媒体源（有能力头栅栏也照走）；
  //   · 手选浏览器 ⇒ 恒走应用源；在带栅栏的桌面端上这会让网页壁纸 403，
  //     面板会给出这条警示。
  // 影响面四处：媒体源/能力头、外壳 CSS 门控、遮挡暂停的失焦档、面板文案与可用性。
  adapterTarget: 'auto',
  // 在线歌词：本地（音频同目录 .lrc / 已缓存）找不到时向 lrclib.net 查询一次
  //（该请求外发歌名 / 歌手 / 专辑 —— 已确认作为默认行为接入）。**常开**
  //（kind 'const'，默认 true，面板不提供开关）；本地歌词优先的口径不变。
  mediaLyricsOnline: true,
  // 用户改过的壁纸属性（「壁纸属性」面板）：{ [token]: { [属性名]: 值 } }。
  // token = base64url(入口文件绝对路径)，与 host 侧 /props 同一套键。
  userProps: {},
  // 遮挡暂停（借鉴 Wallpaper Engine 的「被遮挡时暂停」——桌面端大部分时间
  // GPU≈0 主因就是它）：
  // - pauseOnHidden：页面隐藏（窗口最小化 / 切到其它标签页）时暂停视频。
  //   浏览器对后台页的节流并不保证解码停止，显式 pause 让解码引擎直接归零。
  // - pauseOnBlur：窗口失焦（切到其它应用，壁纸很可能被遮挡）时暂停。
  //   浏览器无法直接探测"被窗口遮挡"，失焦是最接近的代理信号。
  // 恢复可见 / 聚焦后，若用户未手动暂停则自动继续（同步 effective 播放态）。
  pauseOnHidden: true,
  pauseOnBlur: false,
  // 使用电池供电时暂停（类似 WE 的电池优化）：navigator.getBattery 判定
  // 是否在电池上（!charging），不支持的浏览器自动无操作。
  pauseOnBattery: false,
  // Horizontal mirror (CSS scaleX(-1)) — pure compositor, no main-thread cost.
  flip: false,
  // Fit mode for CUSTOM-uploaded wallpapers only (WE wallpapers keep cover):
  // 覆盖=cover · 填充=contain · 居中=center · 拉伸=fill (one object-fit var).
  objectFit: "cover",
  // Content-rating filter, reproducing Wallpaper Engine's own rating taxonomy
  // (project.json `contentrating`: "Everyone" / "PG13" / "Mature" — WE's
  // workshop tags G / PG13 / R; projects without the field are "unrated").
  // "everyone" is the default, matching WE's conservative first-run stance.
  contentRatingFilter: "everyone",
  // Wallpaper-type filter (all / video / web / image / scene). "all" disables it.
  typeFilter: "all",
  // Thumbnail-card style: "classic" (WE's original aspect-ratio 16/9 cards —
  // the CD-like look the author liked; can overlap in older browsers) or
  // "fixed" (fixed-height cards that never overlap). The vinyl
  // record next to the selection is shown in BOTH styles (here + modal head).
  pickerLayout: "fixed",
  // Edge 兼容渲染：Edge（且仅 Edge）会在任何"可见的 <video>"上绘制浏览器
  // 自带的「下载 / 投屏」悬浮工具栏且无官方开关，故默认在 Edge 中把视频壁纸
  // 由 canvas 渲染（见 IS_EDGE / weStartDraw）；关闭后所有浏览器一律使用
  // 原生 <video>（Edge 上悬浮栏会重新出现，属预期）。
  edgeCompat: true,
  // Settings-page liquid-glass theming:
  // - accent: the plugin's own accent color (#rrggbb), written to --we-accent
  //   and consumed by buttons/sliders/selected cards/badges/glass highlights —
  //   independent of the shell's theme brand token.
  // - glassAlpha: glass-surface transparency in % (0–60, step 5), written to
  //   --we-glass-alpha and used by the settings window, settings card, composer
  //   card, bubbles and sidebar panels. Higher = MORE transparent (clearer
  //   wallpaper shows through), lower = closer to solid.
  // - glassColor: the GLASS BASE COLOR of the settings window (#rrggbb),
  //   written to --we-glass-color. Defaults keep the stock look (white glass
  //   in light mode, deep navy in dark); once the user picks a color BOTH
  //   themes use it, so the window glass can be tinted to taste.
  // - glassFidelity: 玻璃保真度 in % (0–100, step 5), default 100 = the full
  //   readability red line (现状): the glass color is brightness-clamped per
  //   theme so body text keeps ≥4.5:1 on the worst-case wallpaper. Lowering it
  //   lerps the tint linearly toward the raw user color (monotone hue-fidelity
  //   recovery, no darker/lighter-than-default midpoints) while the floor-layer
  //   weight thins out by the same factor (READABILITY_FLOOR × fidelity) — text
  //   readability on extreme wallpapers gives way. Plumbing: effects.js injects
  //   --we-glass-fidelity and passes the same scalar to weClampSurfaceColor;
  //   styles.js composes --we-readability-floor = floor constant × fidelity.
  // - chatGlassFidelity: 对话栏玻璃保真度 in % (0–100, step 5), default 100.
  //   独立于 glassFidelity 的第二把尺子，只作用对话栏的**框架**玻璃面（消息气泡 /
  //   输入卡片含工具弹卡）。正文里的 markdown 内容面（代码块 / 行内代码 / 引用等）
  //   刻意不跟本旋钮 —— 它们与侧边栏一起跟随 glassFidelity（用户口径：代码块不和
  //   输入框一起）。Plumbing: effects.js injects --we-chat-glass-fidelity + a second
  //   pair of clamped tints (--we-chat-surface-tint-*) and styles.js composes
  //   --we-chat-readability-floor = floor constant × chat fidelity, consumed by
  //   exactly the bubble/input token declarations.
  accent: "#4f8cff",
  glassAlpha: 20,
  glassColor: GLASS_COLOR_DEFAULT,
  glassFidelity: 100,
  chatGlassFidelity: 100,
  // - capsuleBlur：文字胶囊一族的雾化半径（px，0–60，默认 8）。胶囊 = 行内代码 /
  //   新会话 / 「加载更早历史」「回到底部」导航按钮（消费 --we-inline-code-blur 的
  //   那批面，全部挂在 data-we-thinking-glass 门下）。#134 落地时它是写死的 CSS
  //   兜底值（无生产者、无设置键 ⇒ 用户实测"调不了"，2026-10-04 接成旋钮）；
  //   默认 8 = 原观感逐位不变。刻度与模糊类同一把（D2：0–60px）。
  capsuleBlur: 8,
  // - capsuleColor：胶囊族雾底的釉色（#rrggbb，默认白 = 原观感）。胶囊 = 行内代码 /
  //   新会话 / 导航按钮 / 聊天滚动条拇指（消费 --we-capsule-tint-rgb 的那批面）。
  //   2026-10-04 前它们是写死的 10% 白（--we-inline-code-alpha 管浓度、无色相旋钮）；
  //   接成旋钮后浓度档不变（0.10），只放色相 —— 与思考玻璃同族，滑杆/色板只在
  //   该开关打开时渲染。刻意**不过** weClampSurfaceColor：10% 雾底不是正文面，
  //   不参与可读性下限（钳了反而改变原观感）。
  capsuleColor: '#ffffff',
  // 左侧栏液态玻璃（默认关）：原生**左栏**（会话列表 / 工作区那一列）在壁纸下本来就
  // 是"透明的洞"—— --dsw-specific-sidebar-fill 被本插件置 transparent，那一列因此
  // 直接透出**原样**壁纸，既没有霜也没有本套玻璃参数。打开后左栏拿到与其余面板
  // **同一张配方表**：玻璃颜色 @ 玻璃透明度 压在可读性下限之上 + 雾化（--we-blur）
  // + 边框（--dsw-alias-border-l3 那条竖分割线）+ 配色（accent 高亮映射，作用于
  // 选中/悬停行、徽标与焦点环）。默认关 = 今天的样子，逐字节不变。
  // ⚠️ 与 sidebarGlass（dsh-better-sidebar 那套「侧栏液态玻璃」）的分工：
  //    那个管第三方侧栏插件自己的面板（默认**跟随全局**，见 sidebarFollowGlobal；
  //    关掉跟随才有自己的一套独立旋钮）；本键只管**宿主原生左栏**，始终只跟随
  //    「主题 / 细节」两节里的全局参数。⇒ 跟随态下两侧栏是同一条配方。
  leftSidebarGlass: false,
  // 思考块液态玻璃（默认关）：宿主思考条 / 推理面在壁纸下会画出不透明黑底，
  // 全玻璃模式下显得割裂。默认关 = 保持黑底方便阅读（作者口径）；打开后
  // 思考触发条磨砂、VCP 推理面透明，跟会话玻璃对齐。
  thinkingGlass: false,
  // 「玻璃 UI」各面的**模式**（R3b-ii：三键收成两态里的"态"之一）：
  //   · `'inherit'`（默认，**每个面都是它**）= 该面的每个参数都读**全局**键
  //   · `'custom'`                            = 读该面**自己**的键（用户显式打开「独立配置」后）
  // ⚠️ 曾经的 `glassOverrides`（"哪些面的哪些参数有能力读自己的值"）**已删除**：那个能力现在
  //    由**注册表与接线共同保证** —— 注册表的 `params` 必须逐参数等于 `glassValue(面, 参数, …)`
  //    的调用点（守卫第 ④ 组），而写出的每个按面变量必须被 CSS 真的读到（第 ⑬ 组）。
  //    手抄一张能力表 = 多一个会漂的副本（§4.25 表恒空、§10.12 五个死旋钮，都是它的教训）。
  glassMode: GLASS_MODE_DEFAULTS,
  // 形状版本（R3b）：随 settings 持久化，供下一次读档时的迁移判档用。见 KINDS.settingsVersion。
  settingsVersion: SETTINGS_VERSION,
  // 子 UI 玻璃（默认**全开**）：用户口径 —— 关掉某一项意味着**那个 UI 回到原生
  // 不透明纯色块**（全关 = 整个界面都是原生黑白纯色）。所以"开"才对应现状观感。
  // ⚠️ 因此这里**不是空对象**：登记的每个子项都默认 true。键集由 GLASS_CHILDREN 生成。
  // 各子 UI 的独立值：**默认不启用**（没开"独立配置" ⇒ 一律跟随全局）。
  // 但键本身必须存在且有合理默认，否则用户第一次打开"独立配置"会读到 undefined。
  // 口径：这些键是"独立配置打开那一刻的起点"，默认与对应全局键同值。
  // ⚠️ 键名与量程由 GLASS_CHILDREN 生成（单一真源），不在这里手写。
  ...Object.fromEntries(GLASS_CHILDREN.flatMap((c) => Object.entries(c.params).map(([p, fallback]) => [
    childGlassKey(c.id, p),
    p === 'color' ? GLASS_COLOR_DEFAULT : p === 'fidelity' ? 100 : fallback,
  ]))),
  // dsh-better-sidebar 液态玻璃：与设置窗口玻璃同级的一套「细节自由」控制，
  // 独立于会话玻璃（玻璃 / 玻璃透明度）——侧栏想多透 / 多糊 / 换个底色都行：
  // - sidebarGlass：总开关，关闭后侧栏恢复原生外观（不透明 / 不模糊）；
  // - sidebarBlur：侧栏专用 backdrop 模糊半径（px，0 = 关闭毛玻璃）；
  // - sidebarAlpha：侧栏玻璃透明度（%），语义与玻璃透明度一致（越大越透）。
  //   默认 120（映射后白罩 ≈16.3%；旧默认 12 ≈35.9%，面板明显发亮（#56 实测）：
  //   已存配置经 sanitize 只钳范围不覆盖，故仅影响新用户开箱观感；编辑器/终端
  //   内容面有独立近不透明底色兜底，文字可读性不受影响。
  // - sidebarColor：侧栏玻璃基底色调（#rrggbb），默认白色，双主题统一生效。
  sidebarGlass: true,
  // 侧栏全透明（默认关，issue #137）：壁纸激活时把插件画在侧栏上的那层底**整块撤掉** ——
  // 可读性下限（浅 0.45 / 深 0.59 的 color-mix 地板）、色染（--we-sidebar-tint）与釉光
  //（sheen 渐变 + 发丝高亮）全部归零，壁纸原样透出、文字直接压在壁纸上；玻璃关着时
  // 右栏那条原生不透明兜底（读插件面板色的那条）也改画 transparent。
  // 语义边界：只撤「底色层」—— 模糊 / 饱和仍由侧栏模糊与全局雾化旋钮管（想全清晰就
  // 把模糊调 0）；只在壁纸激活时生效（无壁纸时侧栏压着的是聊天界面，全透不可读）。
  // 默认关 = 可读性下限照旧兜底（最坏壁纸像素下正文 ≥4.5:1 的判据只对默认态负责 ——
  // 这是 issue 里用户明确要求「主动放弃下限换全透」的显式开关，不是改默认行为）。
  sidebarFullClear: false,
  // 侧栏玻璃**跟随全局**（默认开）：打开时上面那三个旋钮不生效，侧栏的模糊 / 透明度 /
  // 底色全部取自全局玻璃三件套（玻璃模糊 --we-blur、玻璃透明度 --we-glass-alpha、
  // 玻璃颜色经按主题钳制后的 --we-follow-tint）——于是侧栏与原生左栏、与其余面板
  // 走的是**同一条配方**（两侧栏不一致的现场：左栏中性 63% / 10px，右栏青色 76% / 37px）。
  // 关闭后恢复下面那套独立旋钮（想给侧栏单独换色 / 加糊的用法仍然在）。
  sidebarFollowGlobal: true,
  sidebarBlur: 16,
  sidebarAlpha: 60,
  sidebarColor: "#ffffff",
  // 内容面（编辑器/终端）近不透明玻璃底的细调——既有固定调色板（语法高亮/
  // ANSI）为不透明底设计，全透明毛玻璃下注释灰不可读，全不透明又失去玻璃感：
  // - sidebarContentAlpha：内容面透明度（%），越大越透（映射到底色不透明度
  //   100%→20%；默认 30 → 70% 不透明，亮/暗主题实测显示均合理，玻璃感与
  //   注释可读性平衡）；
  // - sidebarContentColor：内容面底色（#rrggbb），空 = 跟随主题面板色
  //   (--dsw-alias-bg-layer-1)，选定后双主题统一使用该色。
  sidebarContentAlpha: 38,
  sidebarContentColor: "",
  // Persisted: show the chat-interface mascot pull-cord (rope dock).
  ropeShown: true,
  // Persisted: which mascot artwork + how big. ropeForm ∈ {maid, whale};
  // ropeScale multiplies the form's base box (0.5×–2.5×).
  ropeForm: "maid",
  ropeScale: 1,
  // Persisted "what's new" notice: the last version the user dismissed. Stored
  // with the other settings (host file, port-independent) so it survives DSH
  // Desktop's random --port restarts and never re-shows after being closed.
  noticeSeen: "",
  // ── 字体自定义（#57 精简回归版）：仅字体颜色 / 字重 / 字体族 ──
  // - fontCustom：总开关。关闭 = 全部恢复 dsh 原生字体外观（清空注入的变量与
  //   样式表，即「恢复默认」）；开启后下方三项才生效。默认关闭——PR #57 全局
  //   染色的开箱观感不佳，默认不给用户任何覆盖。
  // - fontColor / fontWeight / fontFamily：应用范围与报错红字保护见
  //   applyFontStyles()（<style id="we-font-patch">）。
  fontCustom: false,
  // 场景壁纸静态帧生成档位记忆：{ [wallpaperId]: 0 或 4 }（出图来源）。
  // 档位进入 scene-frame 请求的 ?v= 参数与宿主缓存键，各档互不覆盖。
  frameVariants: {},
  // 场景实时渲染失败记忆：{ [wallpaperId]: true }。心跳判定失败（首帧超时/
  // 运行期失联）后写入，该壁纸此后走降级链（sceneVideo → 出图来源）；「场景实时渲染」开关重开时
  // 清空全部（显式重试入口）。
  sceneLiveFailures: {},
  // 自定义画面（截屏导入）状态记忆：{ [wallpaperId]: true }。
  customFrames: {},
  // 输入光标颜色（#83，空 = 跟随 dsh 原生）：壁纸透过玻璃输入框直贴光标，
  // 光标色与壁纸相近时会「隐形」。caret-color 经独立 <style id="we-caret-patch">
  // 以 !important 注入 textarea / input / contenteditable，与字体自定义
  // （fontCustom）互不依赖 —— 只想要光标可见时无需打开全局字体染色。
  caretColor: "",
  // ── 壁纸音轨（壁纸引擎视频自带的声音）────────────────────────────────
  // 音量 0–1，0 = 静音。原版把视频壁纸一律 muted，这里把静音变成「音量 0」
  // 这一特例，并补上一个可记忆的总开关。
  videoVolume: 0,
  // 音轨总开关：false = 静音但保留 videoVolume 数值（关掉再打开能恢复原音量）。
  videoAudioEnabled: true,
  // 角色色（F1）：内部**始终**存 {light,dark} 两套，缺一即丢该角色。
  themeColors: {},
  themeDarkSeparate: false,
  // 主题随壁纸（按当前壁纸自动切全局深/浅）：**默认关** —— 不按壁纸自动改深浅主题。
  // 开着时才取色、判决、写 `theme` 服务（见 src/theme-follow.js 的开关门）；关着时那个
  // 功能整体不生效，连它留下的让位标记 / 状态行也一并清掉（不清会让"关→开"静默不生效）。
  themeFollow: false,
  // 排版偏移（F2）：{ 角色: px }；空 = 完全不接管排版。
  themeSize: {},
  // 角色字重（G4）：{ 角色: 100–900 }；空 = 官方字重。
  themeWeight: {},
  // 角色字族（G4）：{ 角色: 族键 }；空 = 官方字族。
  themeFamily: {},
  // **全局字族**（本机字体 / 内置族的"默认字体"）：空 = 跟随 DSH。
  // 它是**默认**而不是强制：角色级（themeFamily）与组件级（componentFonts）仍可单独覆盖
  // —— DSH 的字族层次（标题/正文/代码/表格）不会被一个全局值压平。
  globalFamily: '',
  // 组件级字体（G3/G4）：{ 组件前缀: { size?, weight?, family? } }；空 = 全部官方值。
  // `family` 自本版起存**族键**（内置键或 `sys:` 键）；F3 之前存的是 CSS 栈，仍照旧可用
  // （解析侧两条都认，见 src/client.js 的 fontFamilyStack）—— 老字体集不必迁移。
  componentFonts: {},
  // 面板视图开关（G4「高级字体设置」子分支）：defaults-only ⇒ 不进白名单、不持久化。
  fontAdvanced: false,
  // 面板视图开关（与「字体集」子分支同款）：defaults-only。
  fontSetOpen: false,
  // 面板视图开关（F2「只看改过的」）：defaults-only ⇒ 不进白名单、不持久化。
  // **默认开**：排版角色表有十几行，多数用户只改其中两三行 —— 一进来就铺满全表，反而看不出
  // "我到底改了哪些"。筛完是空的时候面板有专门一行提示（不是"表格坏了"）。
  themeTypeOnly: true,
  // ── 「扩展」页签 · 硬件资源监控柱状图（第一个扩展模块）────────────────────────
  // 柱状图叠在壁纸层之上：**一条序列一行**、自上而下拼接，行内是一串随时间**步进**的
  // 荧光柱；整块在屏幕下方**水平居中**、四边留白（屏上表现由 src/metrics-layer.js 画，
  // 参数控件在「扩展」页签的该模块岛里）。全部为**外观参数**，不含指标来源本身。
  // 这一组默认值不是出厂拍脑袋值：**总开关默认开**，形状与观感按维护者实际调好的那套参数
  // 固化（高度 262 / 垂直偏移 286 / 柱宽 13 / 行间隔 25 / 阈值 82 / 不透明度 100 / 极黑档 30 /
  // 荧光 100 / 描边 1）—— 新装或被重置之后直接就是这个观感，无需再逐个拖一遍。
  metricsEnabled: false,   // 模块总开关（**默认关**，2026-10-04 用户口径：扩展三模块出厂全关、按需开启）
  metricsHeight: 262,      // 柱状图区总高度（px，全部行 + 行间隔都在里面）
  metricsOffsetX: 0,       // 水平偏移（px，正 = 向右）；在"居中"的基础上整块挪，挪到屏外会被钳回
  metricsOffsetY: 286,     // 垂直偏移（px，正 = 向上）；底边本来离屏下缘 20px，负值往下（仍钳在留白内）
  metricsBarWidth: 13,     // 柱宽（px，一格 = 一次采样）；宽度 = 格数 × 柱距，整块居中
  metricsBarGap: 2,        // 柱间距（px，同一行里相邻两根柱子之间的缝）
  metricsStackGap: 25,     // 各行之间的纵向间隔（px）—— 加一条序列，大家都矮一点
  metricsThreshold: 82,    // 标红阈值（占各指标满格的 %，0 = 关掉标红）
  metricsGuides: true,     // 细白横线：每行 50% 高度一条 + 每两行之间一条（单独一层画，见 src/metrics-layer.js）
  metricsOpacity: 100,     // 柱状图整体不透明度（%）；1.00 = 不遮壁纸，看壁纸内容时可调低
  metricsBlend: 'auto',    // 与壁纸的混合模式，见 METRICS_BLEND_VALUES（auto = 按壁纸明暗自动切）
  // 极黑档的柱层不透明度（%）：auto 判定"这一段是极黑背景"时，柱层的不透明度再乘这个比例
  // （100% = 不减，等于把这条极黑规则关掉）。只在 `metricsBlend: 'auto'` 下
  // 有意义 —— 它的控件也只在那时出现在扩展岛里。
  metricsDeepOpacity: 30,
  metricsLineWidth: 1,     // 描边宽度（px，步进 0.5；只在关掉"实心柱"时看得见）
  metricsGlow: 100,        // 荧光强度（0 = 无辉光，只留实心柱）
  metricsSmooth: 60,       // 平滑（0 = 原始值；越高柱高越不抖）
  metricsWindow: 60,       // 时间窗（秒）—— 横轴铺满这一段历史，越大柱子越细越密
  metricsFill: true,       // 实心柱（关掉只画柱子轮廓）
  metricsColorMode: 'accent', // 配色档，见 METRICS_COLOR_MODE_VALUES
  // 五条序列各自的颜色（只在 `spectrum`「分色」档生效）：默认值 = 原来那五个内置色相，
  // 于是"分色"从"固定色相"变成"你自己定的色相"时，画面逐像素不变。
  metricsColorCpu: '#4f8cff',
  metricsColorMem: '#35d07f',
  metricsColorGpu: '#ff5c8a',
  metricsColorNet: '#ffb020',
  metricsColorDisk: '#a06bff',
  metricsLabels: true,     // 每行居中画出该序列的名称（英文缩写，见 src/metrics-layer.js 的 tag）
  metricsShowCpu: true,    // 五条序列各自的显隐（不可用的指标画不出来，但开关留着不算错）
  metricsShowMem: true,
  metricsShowGpu: true,    // 无 GPU 计数器的机器上读不到，模块岛会自动只列可用的那几条
  metricsShowNet: false,
  metricsShowDisk: false,
  // ── 「扩展」页签 · 点击效果与拖尾效果（第二个扩展模块）────────────────────────
  // 两种"跟随光标"的光效（屏上表现由 src/fx-layer.js 画，参数控件在「扩展」页签的该模块
  // 岛里）：点击时在落点炸开一圈涟漪 / 一簇星火，光标划过时留下一条会自行淡完的拖尾。
  // 整层是 body 级固定浮层、画在柱状图之下、界面之下，且 `pointer-events: none` —— 它只是
  // 装饰，不接管任何输入（点击仍落在原来的控件上）。与上面那块柱状图是**两个独立模块**，
  // 各有各的总开关：关掉柱状图不影响光效，反之亦然。
  fxEnabled: false,        // 模块总开关（默认关：它只在"有人动光标"时才看得见）
  fxClick: true,           // 点击效果（子开关：关掉只留拖尾）
  fxClickStyle: 'ripple',  // 点击样式，见 FX_CLICK_STYLE_VALUES
  fxClickSize: 140,        // 点击效果的半径（px）：涟漪扩到多远 / 星火飞多远
  fxClickGlow: 60,         // 点击效果的光晕（%，0 = 只留干净的圆环与亮点）
  fxTrail: true,           // 拖尾效果（子开关：关掉只留点击）
  fxTrailStyle: 'comet',   // 拖尾样式，见 FX_TRAIL_STYLE_VALUES
  fxTrailLength: 420,      // 拖尾的记忆时长（ms）—— 光标停住后轨迹在这段时间里淡完
  fxTrailWidth: 3,         // 拖尾粗细（px）
  fxTrailGlow: 60,         // 拖尾的光晕（%）
  fxOpacity: 85,           // 整层不透明度（%）
  fxBlend: 'screen',       // 与壁纸的混合模式，见 FX_BLEND_VALUES（默认滤色 = 发光叠加）
  fxColorMode: 'accent',   // 配色档，见 FX_COLOR_MODE_VALUES
  fxColor: '#4f8cff',      // 自定义颜色（只在 fxColorMode 为 custom 时生效）

  // ── 「扩展」页签 · 3D 效果（第三个扩展模块）──────────────────────────────────
  // 光标移动时，把**壁纸层、吉祥物、柱状图的三层宿主**按"关于屏幕中心对称"的方向挪一小段
  // （视差纵深）。屏上表现由 src/parallax-layer.js 每帧写 body 上的两个像素步长变量，各层
  // 乘自己的百分比（见 src/styles.js 的视差段）；参数控件在「扩展」页签的该模块岛里。
  // 缓动距离的单位是**最长对角线的百分比**（用户口径）：光标走完一整条对角线时，该层挪
  // pct% 个对角线。方向与光标相反（中心对称），常量见 parallax-layer 的 PARALLAX_DIRECTION。
  parallaxEnabled: false,  // 模块总开关（默认关：它只在"有人动光标"时才看得见）
  parallaxBg: 1,           // 壁纸层的缓动距离（% 对角线，默认 1）—— 壁纸同时放大 1+pct% 以免露边
  parallaxMetrics: 1,      // 柱状图**图表层**的缓动距离（%）：名称层 = 该值 +1、标尺层 = 该值 +2
  parallaxMascot: true,    // 吉祥物挂件是否跟着挪（与壁纸同一个距离；默认开）
  parallaxSmooth: 85,      // 缓动平滑（%）：0 = 立刻跟手，越大越柔和（跟得越慢）

  // ── 「头像」页签 · 消息头像（给助手与用户消息各挂一个头像）────────────────────
  // 屏上表现由 src/avatar-layer.js 注入一张样式表实现：助手头像挂每条回复的左侧、
  // 用户头像挂每条消息的右侧，用 CSS 伪元素（::before）画，不动 dsh 原生的 markdown /
  // 推理折叠 / 反馈 / 统计任何结构。参数控件在「头像」页签（渲染器 src/picker-avatar.js）。
  avatarEnabled: false,      // 模块总开关（默认关：装了也不该突然改变别人的聊天界面）
  avatarSize: 42,            // 头像直径（px）
  avatarGap: 12,             // 头像与正文的间距（px）
  avatarRadius: 0,           // 圆角（px）：0 = 方形，拉满一半 = 胶囊，拉满 = 正圆
  avatarLeftInset: 0,        // 助手头像离左边框的偏移（px；padding 不是定位基准，只能改 left）
  avatarRightInset: 0,       // 用户头像离右边框的偏移（px；同上，只能改 right）
  avatarAssistant: '',       // 助手头像（data URI；空串 = 用运行时生成的灰白剪影占位）
  avatarUser: '',            // 用户头像（data URI；空串 = 同上）
};

// 只做默认值、既不 sanitize 也不持久化的键（纯展示态字段）。
const DEFAULTS_ONLY = ['rotationInterval', 'sceneFrameUrl', 'themeTypeOnly', 'fontAdvanced', 'fontSetOpen'];
/**
 * `DEFAULTS_ONLY` 那几个键的默认值。
 *
 * **为什么必须单独给一份**：它们不在持久化白名单里 ⇒ 客户端的 `readPersisted()` **不提供**它们、
 * 缓存里也没有 ⇒ 若初始化时不显式铺一层，`selection.<key>` 就是 `undefined`。默认值为 `false` 的
 * 键（`fontAdvanced` / `fontSetOpen`）靠"undefined 也假"侥幸正确，**默认值为 `true` 的键（如
 * `themeTypeOnly`）会静默失效** —— 代码声称默认开、界面上却是关的。
 */
function panelDefaults() {
  const out = {};
  for (const key of DEFAULTS_ONLY) out[key] = DEFAULTS[key];
  return out;
}
// 客户端独占：客户端会写进 localStorage，但**宿主不收**（设备本地记忆）。
const CLIENT_ONLY = ['frameVariants', 'customFrames'];

/**
 * 每个键的校验元数据。kind 的语义：
 *   num       数值钳制（min/max 可为字面量或常量名）；越界/非数 → 默认值
 *   enum      白名单取值；不在表内 → 默认值
 *   boolTrue  `v !== false`（默认 true）
 *   boolFalse `v === true`（默认 false）
 *   const     固定为默认值：忽略存储与输入（**常开键**——UI 无开关、行为常开，
 *             老配置里的关闭值在读取那一刻被默认值取代；键仍留在白名单里，
 *             因为运行时两侧还要读它，serialize 也照常带它）
 *   hex       `#rrggbb`（大小写不敏感）；不合法 → 默认值
 *   str       非字符串 → ''（默认值）
 *   strArray  数组 → 只留非空字符串
 *   map       普通对象 → 浅拷贝（非对象/数组 → {}）
 *   props     壁纸属性：只收标量值 + 字符串长度上限（宿主原有的严格口径，两侧统一）
 *   failures  实时渲染失败记忆：值只收 true | 'timeout' | 'stall'
 *   groups    轮播列表：逐组规范化（name/interval/order/wallpaperIds）
 *
 * ⚠️ 这张表同时是**字体集**的 kind 表：F3 的六个字体键（`FONTSET_KEYS`）也在这里 ——
 * 它们**不在** settings 的持久化白名单里（见 `sanitizeFromSchema` / `serializeSettings`），
 * 但 `sanitizeFontset` 按这张表消毒，两处因此共用一条路径。
 */
const KINDS = {
  id: { kind: 'str' },
  scrim: { kind: 'num', min: 0, max: 1 },
  border: { kind: 'num', min: 0, max: 1 },
  blur: { kind: 'num', min: 0, max: 60 },
  wallpaperBlur: { kind: 'num', min: 0, max: 60 },
  backgroundBrightness: { kind: 'num', min: 40, max: 160 },
  backgroundContrast: { kind: 'num', min: 40, max: 200 },
  backgroundSaturate: { kind: 'num', min: 0, max: 200 },
  wallpaperOpacity: { kind: 'num', min: 0, max: 90 },
  switchTransition: { kind: 'enum', values: SWITCH_TRANSITION_VALUES },
  switchTransitionDir: { kind: 'enum', values: SWITCH_DIRS },
  switchTransitionSpeed: { kind: 'enum', values: SWITCH_SPEED_VALUES },
  rotationEnabled: { kind: 'boolFalse' },
  rotationGroupId: { kind: 'str' },
  rotationGroups: { kind: 'groups' },
  rotationSeeded: { kind: 'boolFalse' },
  hiddenIds: { kind: 'strArray' },
  playbackRate: { kind: 'num', min: 0.5, max: 2 },
  videoVolume: { kind: 'num', min: 0, max: 1 },
  videoAudioEnabled: { kind: 'boolTrue' },
  fpsCap: { kind: 'enum', values: FPS_CAP_VALUES },
  sceneLive: { kind: 'boolTrue' },
  sceneLiveFps: { kind: 'enum', values: SCENE_LIVE_FPS_VALUES },
  liveBootDelay: { kind: 'num', min: 0, max: 30 },
  audioSource: { kind: 'const' },
  adapterTarget: { kind: 'enum', values: ADAPTER_TARGET_VALUES },
  mediaIntegration: { kind: 'const' },
  mediaLyricsOnline: { kind: 'const' },
  userProps: { kind: 'props' },
  pauseOnHidden: { kind: 'boolTrue' },
  pauseOnBlur: { kind: 'boolFalse' },
  pauseOnBattery: { kind: 'boolFalse' },
  flip: { kind: 'boolFalse' },
  objectFit: { kind: 'enum', values: OBJECT_FIT_VALUES },
  contentRatingFilter: { kind: 'enum', values: RATING_VALUES },
  typeFilter: { kind: 'enum', values: TYPE_VALUES },
  pickerLayout: { kind: 'enum', values: PICKER_LAYOUT_VALUES },
  edgeCompat: { kind: 'boolTrue' },
  accent: { kind: 'hex' },
  glassAlpha: { kind: 'num', min: 0, max: 100 },
  glassColor: { kind: 'hex' },
  glassFidelity: { kind: 'num', min: 0, max: 100 },
  // 胶囊雾化（模糊类同一把刻度，见 DEFAULTS.capsuleBlur）
  capsuleBlur: { kind: 'num', min: 0, max: 60 },
  // 胶囊釉色（hex；见 DEFAULTS.capsuleColor）
  capsuleColor: { kind: 'hex' },
  chatGlassFidelity: { kind: 'num', min: 0, max: 100 },
  leftSidebarGlass: { kind: 'boolFalse' },
  thinkingGlass: { kind: 'boolFalse' },
  // ── 设置形状的版本标记（R3b，wip §10.16 / §10.17）──────────────────────────────
  // 为什么现在需要它（§7.1 曾判"不需要" —— 这里**推翻那个前提**）：本次改动**改变了默认语义**
  //（`glassIndependent` 从"既有面默认开"变成"全部默认跟随全局"）。旧存档里那两条
  // `sidebar: true` / `sidebarContent: true` 是**旧默认的残留**，不是用户的选择
  //（修好默认值机制之前它们从未生效过）⇒ 必须靠版本号把旧档认出来并**丢弃**旧值。
  // 它随 settings 一起持久化（`const` ⇒ 写回的就是当前版本），所以只需要迁移一次。
  settingsVersion: { kind: 'const' },
  // 「玻璃 UI」各面的**模式**（面 → `'inherit' | 'custom'`）。R3b-ii 起取代布尔开关：
  // 布尔只能表达"开/关"，而这里真正要表达的是"**读全局** 还是 **读自己**"这两态（见 DEFAULTS）。
  glassMode: { kind: 'modeMap' },
  // 各子 UI 的**独立值**键：键名由 `childGlassKey()` 生成、默认值取自 GLASS_CHILDREN.params。
  // ⚠️ 这里**生成**而不是手写四套：手抄必然漂（本仓实测结论）。
  ...Object.fromEntries(GLASS_CHILDREN.flatMap((c) => Object.entries(c.params).map(([p, max]) => {
    const key = childGlassKey(c.id, p);
    if (p === 'color') return [key, { kind: 'hex' }];
    if (p === 'fidelity') return [key, { kind: 'num', min: 0, max: 100 }];
    return [key, { kind: 'num', min: 0, max }];
  }))),
  sidebarGlass: { kind: 'boolTrue' },
  sidebarFullClear: { kind: 'boolFalse' },
  sidebarFollowGlobal: { kind: 'boolTrue' },
  sidebarBlur: { kind: 'num', min: 0, max: 60 },
  sidebarAlpha: { kind: 'num', min: 0, max: 100 },
  sidebarColor: { kind: 'hex' },
  sidebarContentAlpha: { kind: 'num', min: 0, max: 100 },
  sidebarContentColor: { kind: 'hex' },
  ropeShown: { kind: 'boolTrue' },
  ropeForm: { kind: 'enum', values: ROPE_FORM_VALUES },
  ropeScale: { kind: 'num', min: ROPE_SCALE_MIN, max: ROPE_SCALE_MAX },
  noticeSeen: { kind: 'str' },
  fontCustom: { kind: 'boolFalse' },
  frameVariants: { kind: 'map' },
  sceneLiveFailures: { kind: 'failures' },
  customFrames: { kind: 'map' },
  caretColor: { kind: 'hex' },
  // F1：文字颜色角色（空 = 完全不接管，保留 DSH 原生层次）。
  themeColors: { kind: 'themeColors' },
  // F1：面板开关「深色单独设置」。关 = 只给一个色（写进两套）；仅影响面板，不改存储形态。
  themeDarkSeparate: { kind: 'boolFalse' },
  // 主题随壁纸：**默认关**（关 = 不按壁纸自动改深浅主题）。语义见 DEFAULTS.themeFollow。
  themeFollow: { kind: 'boolFalse' },
  // F2/G4：排版角色**字号绝对值**（px，整数 8–48；空 = 用 DSH 官方值）。
  themeSize: { kind: 'typeSizes' },
  // G4：角色级字重（100–900；空 = DSH 官方字重）。
  themeWeight: { kind: 'typeWeights' },
  // G4：角色级字族（族键，见 FONT_FAMILY_VALUES / SYSTEM_FONT_KEY_PREFIX；空 = DSH 官方字族）。
  themeFamily: { kind: 'typeFamily' },
  // 全局字族（族键；空 = 跟随 DSH）。校验只管"能不能安全进 CSS" —— 本机字体没有静态白名单。
  globalFamily: { kind: 'familyKey' },
  // G3/G4：组件级字体（字号/字重/字族；空 = 官方值）。
  componentFonts: { kind: 'componentFonts' },
  // 「扩展」页签 · 硬件资源监控柱状图的外观参数（语义见 DEFAULTS 同名键的注释）。
  // 范围都取"能看但不过分"的一档：柱状图区最高 320px（再高就压住半个画面）、
  // 时间窗最长 240s（再长就只剩一排细线），柱宽 1..16px、柱间距 0..16px、行间隔 0..40px。
  // 位置偏移 ±400px：够把这块装饰从"居中"挪到画面任意一侧，又不足以让它彻底离屏。
  // 总开关的 kind 编着"缺省时的取值"：`boolFalse` = `v === true`（缺值归 false），`boolTrue` =
  // `v !== false`（缺值归 true）⇒ 这一版把总开关改成**默认开**，kind 也必须跟着从 boolFalse 换成
  // boolTrue，否则 DEFAULTS 里那个 true 会被 sanitize 抹回 false（判据会当场判红）。
  metricsEnabled: { kind: 'boolFalse' },
  metricsHeight: { kind: 'num', min: 40, max: 320 },
  metricsOffsetX: { kind: 'num', min: -400, max: 400 },
  metricsOffsetY: { kind: 'num', min: -400, max: 400 },
  metricsBarWidth: { kind: 'num', min: 1, max: 16 },
  metricsBarGap: { kind: 'num', min: 0, max: 16 },
  metricsStackGap: { kind: 'num', min: 0, max: 40 },
  metricsThreshold: { kind: 'num', min: 0, max: 100 },
  metricsGuides: { kind: 'boolTrue' },
  metricsOpacity: { kind: 'num', min: 10, max: 100 },
  metricsBlend: { kind: 'enum', values: METRICS_BLEND_VALUES },
  metricsDeepOpacity: { kind: 'num', min: 10, max: 100 },
  metricsLineWidth: { kind: 'num', min: 1, max: 5 },
  metricsGlow: { kind: 'num', min: 0, max: 100 },
  metricsSmooth: { kind: 'num', min: 0, max: 100 },
  metricsWindow: { kind: 'num', min: 20, max: 240 },
  metricsFill: { kind: 'boolTrue' },
  metricsColorMode: { kind: 'enum', values: METRICS_COLOR_MODE_VALUES },
  metricsColorCpu: { kind: 'hex' },
  metricsColorMem: { kind: 'hex' },
  metricsColorGpu: { kind: 'hex' },
  metricsColorNet: { kind: 'hex' },
  metricsColorDisk: { kind: 'hex' },
  metricsLabels: { kind: 'boolTrue' },
  metricsShowCpu: { kind: 'boolTrue' },
  metricsShowMem: { kind: 'boolTrue' },
  metricsShowGpu: { kind: 'boolTrue' },
  metricsShowNet: { kind: 'boolFalse' },
  metricsShowDisk: { kind: 'boolFalse' },
  // 「扩展」页签 · 点击效果与拖尾效果的外观参数（语义见 DEFAULTS 同名键的注释）。
  // 范围取"看得见又不过分"的一档：半径 40..400px（再大就糊满一屏）、记忆时长 80..2000ms
  // （再长屏幕上就摊着一团线）、粗细 1..12px、两种光晕 0..100%、不透明度 10..100%。
  fxEnabled: { kind: 'boolFalse' },
  fxClick: { kind: 'boolTrue' },
  fxClickStyle: { kind: 'enum', values: FX_CLICK_STYLE_VALUES },
  fxClickSize: { kind: 'num', min: 40, max: 400 },
  fxClickGlow: { kind: 'num', min: 0, max: 100 },
  fxTrail: { kind: 'boolTrue' },
  fxTrailStyle: { kind: 'enum', values: FX_TRAIL_STYLE_VALUES },
  fxTrailLength: { kind: 'num', min: 80, max: 2000 },
  fxTrailWidth: { kind: 'num', min: 1, max: 12 },
  fxTrailGlow: { kind: 'num', min: 0, max: 100 },
  fxOpacity: { kind: 'num', min: 10, max: 100 },
  fxBlend: { kind: 'enum', values: FX_BLEND_VALUES },
  fxColorMode: { kind: 'enum', values: FX_COLOR_MODE_VALUES },
  fxColor: { kind: 'hex' },
  // 「扩展」页签 · 3D 效果的参数（语义见 DEFAULTS 同名键的注释）。范围按"挪得动、又不会把
  // 壁纸放大到糊"取：壁纸 0..10%（它同时决定壁纸为补边额外放大的倍数 1+pct/100 ⇒ 10% 时
  // 放大 1.1）、图表 0..20%（名称层 / 标尺层各自再 +1 / +2 ⇒ 上限 22）、平滑 0..98%
  // （100% 就等于永远不动，留 2% 的余量）。
  parallaxEnabled: { kind: 'boolFalse' },
  parallaxBg: { kind: 'num', min: 0, max: 10 },
  parallaxMetrics: { kind: 'num', min: 0, max: 20 },
  parallaxMascot: { kind: 'boolTrue' },
  parallaxSmooth: { kind: 'num', min: 0, max: 98 },
  // 「头像」页签 · 消息头像的参数（语义见 DEFAULTS 同名键的注释）。范围按"看得清、又不挤掉
  // 正文"取：直径 20..72px（再大就跟正文字号差不多了）、间距与圆角 0..48px（圆角拉到直径
  // 一半就是胶囊、拉满 48 在 42px 直径时已是正圆）、贴边偏移 0..32px。头像本体是 data URI，
  // 走 `str` 原样透传（sanitize 不截断、不校验前缀），空串表示"用灰白默认占位"。
  avatarEnabled: { kind: 'boolFalse' },
  avatarSize: { kind: 'num', min: 20, max: 72 },
  avatarGap: { kind: 'num', min: 0, max: 40 },
  avatarRadius: { kind: 'num', min: 0, max: 48 },
  avatarLeftInset: { kind: 'num', min: 0, max: 32 },
  avatarRightInset: { kind: 'num', min: 0, max: 32 },
  avatarAssistant: { kind: 'str' },
  avatarUser: { kind: 'str' },
};

const HEX_RE = /^#[0-9a-f]{6}$/i;

// F1 开放的 5 个文字颜色角色（**只做校验白名单**；令牌映射与 UI 名在 src/font/color-roles.js）。
// 为什么这里要再写一份：宿主也 import 本文件，而 theme-layer.js 只进浏览器包 —— 两份必须一致，
// 由 test/verify-theme-layer.mjs 断言（有守卫的重复，好过拿不到的共享）。
const THEME_COLOR_ROLE_IDS = ["primary", "secondary", "tertiary", "caption", "dimmed"];

/** 角色色：只留已知角色，且每个角色必须同时有合法的 light 与 dark。 */
function readThemeColors(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const role of THEME_COLOR_ROLE_IDS) {
    const v = raw[role];
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const light = typeof v.light === 'string' && HEX_RE.test(v.light.trim()) ? v.light.trim() : null;
    const dark = typeof v.dark === 'string' && HEX_RE.test(v.dark.trim()) ? v.dark.trim() : null;
    // 缺一套就整角色丢弃：服务要求成对，落单的那套在另一配色下会不可读。
    if (light && dark) out[role] = { light, dark };
  }
  return out;
}

// F2 开放的排版角色（**只做校验白名单**；令牌名与基准表达式在 src/font/typography.js）。
// 与颜色角色同理：宿主也 import 本文件，而 theme-typography.js 只进浏览器包 ——
// 两份必须一致，由 test/verify-theme-layer.mjs 断言。
const THEME_TYPE_ROLE_IDS = ["markdown-h1", "markdown-h2", "markdown-h3", "markdown-h4",
  "markdown-base", "markdown-small", "markdown-code", "markdown-code-block",
  "markdown-table", "markdown-table-head", "xs-13", "xxs-12"];
// 偏移范围与 src/font/typography.js 的 THEME_SIZE_MIN/THEME_SIZE_MAX 必须一致（由守卫断言 ——
// 两份不能共用一个绑定：宿主只 import 本文件，而那个模块只进浏览器包）。

/** 字号（绝对值 px）：只留已知角色、只留 8–48 的整数（未设置 = 用 DSH 官方值）。 */
function readTypeSizes(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const role of THEME_TYPE_ROLE_IDS) {
    const v = raw[role];
    if (typeof v !== 'number' || !Number.isInteger(v) || v === 0) continue;
    if (v < 8 || v > 48) continue;
    out[role] = v;
  }
  return out;
}

/**
 * 角色字重（G4 字重两条路径之"角色级"）：只留已知角色、只留 100–900 的整数步进。
 * 与字号偏移同理 —— 不设置 = 用 DSH 官方字重（组合式里的字面量前缀）。
 */
function readTypeWeights(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const role of THEME_TYPE_ROLE_IDS) {
    const v = raw[role];
    if (typeof v !== 'number' || !Number.isInteger(v)) continue;
    if (v < 100 || v > 900) continue;
    out[role] = v;
  }
  return out;
}

/**
 * 角色字族（G4 字族细化）：只留已知角色、只留**族键**（内置键或 `sys:<本机字体>`）。
 * 存**族键**而不是 CSS 栈 —— 栈（含中文 fallback 链）由客户端 fontFamilyStack 解析，
 * 宿主不必知道字体栈长什么样（同一份键在两侧的含义一致）。
 */
function readTypeFamily(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const role of THEME_TYPE_ROLE_IDS) {
    const key = sanitizeFamilyKey(raw[role]);
    if (!key) continue;
    out[role] = key;
  }
  return out;
}

// G4/G3 开放的**组件**白名单：这里是**设置键**（= 面板一行 = 持久化字段名），
// 与 CSS-module 的**模块名**不是一回事（id→模块名 / 钩子 / route 见 src/font/components.js）。
// 键名刻意保持稳定（`table` 不随模块名改成 `tableScroll`）⇒ 老设置零迁移。
// 与颜色/排版角色同理：宿主也 import 本文件，而 components.js 只进浏览器包 ——
// 两份必须一致，由 test/verify-component-fonts.mjs 断言。
const COMPONENT_FONT_KEYS = ["markdown", "codeBlock", "terminal", "table"];
const COMPONENT_FONT_SIZE_MIN = 6, COMPONENT_FONT_SIZE_MAX = 40;
const COMPONENT_FONT_WEIGHT_MIN = 100, COMPONENT_FONT_WEIGHT_MAX = 900;

/**
 * 组件字体：只留已知组件，只留三项（字号/字重/字族），且**值必须能安全进 CSS**。
 * 字族是唯一进 CSS 的字符串 ⇒ 走共享的 `sanitizeFamilyValue`（`sys:` 键 / 历史 CSS 栈
 * 两条形态都在它那里消毒）。宁可丢一个值，也不让设置文件里的字符串变成任意 CSS 注入。
 */
function readComponentFonts(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const key of COMPONENT_FONT_KEYS) {
    const v = raw[key];
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const one = {};
    if (typeof v.size === 'number' && Number.isInteger(v.size)
      && v.size >= COMPONENT_FONT_SIZE_MIN && v.size <= COMPONENT_FONT_SIZE_MAX) one.size = v.size;
    if (typeof v.weight === 'number' && Number.isInteger(v.weight)
      && v.weight >= COMPONENT_FONT_WEIGHT_MIN && v.weight <= COMPONENT_FONT_WEIGHT_MAX) one.weight = v.weight;
    const family = sanitizeFamilyValue(v.family);
    if (family) one.family = family;
    if (Object.keys(one).length) out[key] = one;
  }
  return out;
}

function clampNum(v, lo, hi, fallback) {
  return typeof v === 'number' && v >= lo && v <= hi ? v : fallback;
}

/** 轮播列表规范化（客户端与宿主同一套：两边只有默认间隔的来源不同）。 */
function readRotationGroups(raw, fallbackInterval) {
  if (!Array.isArray(raw)) return [];
  const groups = [];
  for (const g of raw) {
    if (!g || typeof g !== 'object') continue;
    const id = typeof g.id === 'string' && g.id ? g.id : '';
    if (!id) continue;
    groups.push({
      id,
      name: typeof g.name === 'string' && g.name.trim() ? g.name.trim() : '轮播列表',
      interval: clampNum(g.interval, 1, 1440, fallbackInterval),
      order: g.order === 'random' ? 'random' : 'sequence',
      wallpaperIds: Array.isArray(g.wallpaperIds)
        ? g.wallpaperIds.filter((x) => typeof x === 'string' && x)
        : [],
    });
  }
  return groups;
}
/**
 * **模式映射**（一层：面 → `'inherit' | 'custom'`）—— 用于 `glassMode`（R3b-ii 起，
 * 取代了当年的布尔映射 `glassChildren` / `glassIndependent`）。
 *
 * ⚠️ 纪律三条，全是**实测教训**（见 wip §4.25 与 §10.23）：
 *   **① 缺省键取默认值**：`def` 是权威起点，不是"没这个键就空"。当年的布尔映射把 `def` 丢掉，
 *      于是两张默认表成了**死代码**（真实会话里恒为 `{}`）⇒ 表现为"控件在、开关滑杆动了没反应"。
 *      **`def` 必须从 `readOne` 传进来** —— 这是本函数存在的前提。
 *   **② 显式值一律保留**（`'custom'` 与 `'inherit'` 都要能存住）。
 *   **③ 非法取值一概忽略**（含旧版的布尔 `true`）：旧布尔由 `migrateSettings` 在消毒**之前**
 *      转换，所以到这里只剩字符串。
 */
function readModeMap(raw, def) {
  const base = (def && typeof def === 'object' && !Array.isArray(def)) ? Object.assign({}, def) : {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k !== 'string' || !k || k.length > 64) continue;
    if (v === 'inherit' || v === 'custom') base[k] = v;
  }
  return base;
}

/** 壁纸属性：只收标量值，字符串限长（防设置文件被灌爆）。 */
function readUserProps(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k !== 'string' || !k || !v || typeof v !== 'object' || Array.isArray(v)) continue;
    const inner = {};
    for (const [n, val] of Object.entries(v)) {
      if (typeof n !== 'string' || !n) continue;
      if (typeof val === 'string') inner[n] = val.slice(0, 2000);
      else if (typeof val === 'number' || typeof val === 'boolean') inner[n] = val;
    }
    out[k] = inner;
  }
  return out;
}

/** 实时渲染失败记忆：值只收 true（兼容旧值）与两个已知原因。 */
function readLiveFailures(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k === 'string' && k && (v === true || v === 'timeout' || v === 'stall')) out[k] = v;
  }
  return out;
}

/** 单个键的取值（`def` 已在调用处按 key 取好）。 */
function readOne(meta, raw, key, def) {
  const v = raw ? raw[key] : undefined;
  switch (meta.kind) {
    case 'num': {
      const lo = typeof meta.min === 'string' ? CONSTS[meta.min] : meta.min;
      const hi = typeof meta.max === 'string' ? CONSTS[meta.max] : meta.max;
      return clampNum(v, lo, hi, def);
    }
    case 'enum': return meta.values.includes(v) ? v : def;
    case 'boolTrue': return v !== false;
    case 'boolFalse': return v === true;
    case 'const': return def;
    case 'hex': return typeof v === 'string' && HEX_RE.test(v) ? v : def;
    case 'themeColors': return readThemeColors(v);
    case 'typeSizes': return readTypeSizes(v);
    case 'typeWeights': return readTypeWeights(v);
    case 'typeFamily': return readTypeFamily(v);
    case 'familyKey': return sanitizeFamilyKey(v) || def;
    case 'componentFonts': return readComponentFonts(v);
    case 'str': return typeof v === 'string' ? v : def;
    case 'strArray': return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : def;
    case 'map': return (v && typeof v === 'object' && !Array.isArray(v)) ? Object.assign({}, v) : {};
    // ⚠️ `def` **必须**传进去（见 readModeMap 头注释）：丢掉它等于把这个键的默认值变成
    //    死代码 —— 真实会话里恒为 `{}`，那就是"控件在、开关滑杆动了没反应"的根因（wip §4.25）。
    case 'modeMap': return readModeMap(v, def);
    case 'props': return readUserProps(v);
    case 'failures': return readLiveFailures(v);
    case 'groups': return readRotationGroups(v, DEFAULTS.rotationInterval);
    default: throw new Error('settings-schema: 未知 kind ' + meta.kind + '（键 ' + key + '）');
  }
}

/** kind 里用常量名表达 min/max（如 ropeScale）时的解析表。 */
const CONSTS = { ROPE_SCALE_MIN, ROPE_SCALE_MAX };

// ── F3：字体集（`fontsets/<id>.json`）的共享内核 ──────────────────────────────
/**
 * 字体集**正文**的键集 = 全部持久化字体键（**不含** `fontCustom`：总开关留在 settings 里）。
 * 宿主写文件、读文件、导入导出与校验都用这一份 ⇒ 不会出现两份清单。
 * 依赖：每个键都必须在 `KINDS` 里（`sanitizeFontset` 按它的 kind 消毒）—— 由守卫钉住。
 * ⚠️ **加键是加性的**：老文件缺这个键 ⇒ 消毒时回落默认值（空），无需迁移；因此
 * `FONTSET_SCHEMA_VERSION` 不随加键升 —— 升版本会让**所有**已导出的 `.json` 变成"读不懂"。
 */
const FONTSET_KEYS = ['themeColors', 'themeDarkSeparate', 'themeSize', 'themeWeight', 'themeFamily', 'globalFamily', 'componentFonts'];

/** 字体集文件的 `$schema` 版本。读不懂的版本一律**拒绝并说明**，不猜、不静默降级。 */
const FONTSET_SCHEMA_VERSION = 1;
const FONTSET_SCHEMA_TAG = 'dsh-we/fontset@' + FONTSET_SCHEMA_VERSION;

/**
 * 一次性迁移产物的 id（落在**用户层**）。客户端在活动 id 还未知时也拿它当写目标
 * ⇒ 两端必须同一个字面量（这里就是那份单一真源）。
 * ⚠️ 随包预设**不许**用这个名字：同 id 时用户层胜，那份随包预设会被永久遮住。
 */
const FONTSET_MIGRATED_ID = 'default';

/**
 * 字体集 id 的形状：只允许**单段**文件名安全字符（路径分隔符与 `..` 进不来，因为 `.` 不在表内）。
 * `FONTSET_RESERVED_IDS` 是保留段：它们与子资源路径同名，当 id 用会让路由分派歧义
 * ⇒ 一律不许。
 */
const FONTSET_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const FONTSET_RESERVED_IDS = ['import', 'export'];
function isFontSetId(v) {
  return typeof v === 'string' && FONTSET_ID_RE.test(v) && !FONTSET_RESERVED_IDS.includes(v);
}

/**
 * 规范化一份字体集正文（未信任输入：磁盘上的文件 / 导入的文件 / PUT 上来的 body）。
 * 逐键走 `readOne` —— 与 settings **共用同一条消毒路径**，避免"同一个键两套宽严口径"
 * （那种分叉会让"存进去的"与"读出来的"悄悄不同）。缺键回落默认值；非对象视作空集
 * （形状与版本由调用方判，见 lib/routes/fontsets.js）。
 */
function sanitizeFontset(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const key of FONTSET_KEYS) out[key] = readOne(KINDS[key], src, key, DEFAULTS[key]);
  return out;
}

/** 默认值集合（含只做默认值的键）。 */
function settingsDefaults() {
  return Object.assign({}, DEFAULTS);
}

/**
 * 按 schema 规范化一份设置。
 *
 * ⚠️ **字体键（`FONTSET_KEYS`）不在这里**：它们住 `fontsets/<id>.json`（D1），
 * 不进 settings blob。但它们的 kind 元数据**仍留在 `KINDS` 里** —— `sanitizeFontset`
 * 要按同一份 kind 消毒（一条消毒路径，两处宽严不会分叉）。所以：
 *   · **settings 的持久化白名单 = `KINDS` − `FONTSET_KEYS`**（下面两处 `continue` 就是这条）；
 *   · **字体集正文的键集 = `FONTSET_KEYS`**（`sanitizeFontset`）。
 * @param raw 未信任的输入（localStorage 缓存 / PUT 上来的 JSON）
 * @param side 'client' | 'host' —— 宿主侧不收 CLIENT_ONLY 的键
 */
/**
 * 设置形状的**一次性迁移**（R3b，wip §10.16 / §10.17）。按 `settingsVersion` 分档：
 *   · **v1 → v2**（没有版本号 = 引入版本号之前的档）：**丢弃**旧的 `glassIndependent`。
 *     那两条 `sidebar: true` / `sidebarContent: true` 是**旧默认值的残留**，不是用户的选择 ——
 *     §4.25 修好默认值机制之前 `glassOverrides` 恒空 ⇒ 独立档**从未真正生效过**。
 *     留着它等于让"全局参数对侧栏无效"这个已被判定为缺陷的行为**永久留在老用户身上**。
 *   · **v2 → v3**：布尔开关 `glassIndependent` 改名并改形为 `glassMode`（`'inherit' | 'custom'`）。
 *     这时 `true` **只可能**来自用户的显式操作（v2 的默认已全是 `false`）⇒ **翻译成 `'custom'`
 *     保留下来**（与 v1 的"残留"不同：这一次丢的是用户的真实选择，不能丢）。
 *   · **v3 → v4**：**刻度换算**（R4 量纲统一）。各面共用规范刻度（模糊 0–60 px · 透明度 0–100 %）
 *     之后，旧数值必须换到新刻度上，否则同一个数字会指向另一个位置（观感全变）。
 *     换算法按参数的**性质**分两类 —— 这是本档最容易做错的地方：
 *       · **位置量（有曲线）**：透明度那几项。按**占比**换算（`×新上界/旧上界`），于是
 *         "归一化位置"不变 ⇒ 观感逐点不变（曲线在 glass.js / effects.js 里同步改分母）。
 *       · **直接量（无曲线）**：`sidebarBlur` 直接就是 px（`--we-sidebar-blur: <x>px`）。
 *         对它换算**会改观感**（16px 变成 4.8px）⇒ 只**钳制**到新上界 60，不乘系数。
 *         代价：旧值 > 60 的用户（0–200 档的最上段）会被钳到 60px —— 那是刻度的真实上限，
 *         而且背景模糊在 60px 以上早已观感饱和。
 *   · 版本号 ≥ 当前 ⇒ **原样返回**：迁移是一次性动作，不是每次读档都跑的逻辑（幂等）。
 * ⚠️ 只在**两侧共用**的消毒入口调用 ⇒ 宿主与客户端不会各迁一次，也不会只迁一边。
 */
function migrateSettings(raw) {
  const v = Number(raw && raw.settingsVersion);
  if (Number.isFinite(v) && v >= SETTINGS_VERSION) return raw;
  const out = Object.assign({}, raw);
  const legacy = out.glassIndependent;
  if (v >= 2 && legacy && typeof legacy === 'object') {
    const mode = Object.assign({}, GLASS_MODE_DEFAULTS);
    for (const [k, on] of Object.entries(legacy)) if (on === true) mode[k] = 'custom';
    out.glassMode = mode;
  }
  delete out.glassIndependent;      // v1 的残留 / v2 的布尔开关，到这里都退出历史
  delete out.glassOverrides;        // v<当前 的档里可能还留着那张能力表（已删除的键）
  // ── v → v5：「要不要玻璃」这一层**退役**（用户口径：关并不能如预期回到原生纯色，
  //    而要做到"关得像样"得连令牌层一起回退 ⇒ 删掉这一层）。旧档里那两类键直接丢弃：
  //      · `glassWindow`（「设置窗口液态玻璃」）—— 功能由「设置窗口玻璃·独立配置」接管，
  //        行为与"开启时"一致（本面恒挂门控属性）；
  //      · `glassChildren`（每个子面"要不要玻璃"）—— 恒为"要"，不再是用户可选项。
  delete out.glassWindow;
  delete out.glassChildren;
  // ── v → v4：刻度换算（从任何更早的档来都要做 —— 它们的数值都在旧刻度上）──────────
  const asNum = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);
  const rescale = (key, factor, max) => {
    const x = asNum(out[key]);
    if (x === null) return;
    out[key] = Math.min(max, Math.round(x * factor));
  };
  rescale('glassAlpha', 100 / 60, 100);            // 0–60  → 0–100（位置量）
  rescale('sidebarAlpha', 1 / 2, 100);             // 0–200 → 0–100（位置量）
  rescale('sidebarContentAlpha', 100 / 80, 100);   // 0–80  → 0–100（位置量）
  // 三个「子项独立值」的透明度键与全局同刻度（旧档里它们也是 0–60）
  for (const k of ['settingsWindowTransparency', 'floatersTransparency', 'leftSidebarTransparency']) {
    rescale(k, 100 / 60, 100);
  }
  // 模糊：**只钳制不换算**（它直接就是 px，理由见上）
  const sb = asNum(out.sidebarBlur);
  if (sb !== null) out.sidebarBlur = Math.min(60, Math.round(sb));
  return out;
}

function sanitizeFromSchema(raw, side) {
  if (!raw || typeof raw !== 'object') {
    // 宿主由调用方判空；客户端回落到默认值（两侧同一套判据的客户端半边）
    return side === 'host' ? null : Object.assign({ id: '' }, DEFAULTS);
  }
  const src = migrateSettings(raw);
  const out = {};
  for (const [key, meta] of Object.entries(KINDS)) {
    if (side === 'host' && CLIENT_ONLY.includes(key)) continue;
    if (FONTSET_KEYS.includes(key)) continue; // D1：字体值住字体集文件，不住 settings blob
    const def = key === 'id' ? '' : DEFAULTS[key];
    out[key] = readOne(meta, src, key, def);
  }
  return out;
}

/** 持久化的白名单（客户端 PUT / localStorage 只带这些键；id 在前，保持既有形状）。 */
function serializeSettings(sel) {
  const s = sel && typeof sel === 'object' ? sel : {};
  const out = { id: typeof s.id === 'string' ? s.id : '' };
  for (const key of Object.keys(KINDS)) {
    if (key === 'id') continue;
    if (FONTSET_KEYS.includes(key)) continue; // D1：同上 —— 字体值走字体集通道
    out[key] = s[key];
  }
  return out;
}

export {
  DEFAULTS, KINDS, DEFAULTS_ONLY, CLIENT_ONLY, THEME_COLOR_ROLE_IDS, THEME_TYPE_ROLE_IDS,
  COMPONENT_FONT_KEYS,
  FONTSET_KEYS, FONTSET_SCHEMA_VERSION, FONTSET_SCHEMA_TAG, FONTSET_ID_RE, FONTSET_RESERVED_IDS,
  FONTSET_MIGRATED_ID, isFontSetId, sanitizeFontset,
  RATING_VALUES, TYPE_VALUES, OBJECT_FIT_VALUES, AUDIO_SOURCE_VALUES, PICKER_LAYOUT_VALUES,
  ADAPTER_TARGET_VALUES, METRICS_COLOR_MODE_VALUES, METRICS_BLEND_VALUES,
  FX_CLICK_STYLE_VALUES, FX_TRAIL_STYLE_VALUES, FX_COLOR_MODE_VALUES, FX_BLEND_VALUES,
  ROPE_FORM_VALUES, ROPE_SCALE_MIN, ROPE_SCALE_MAX, FONT_FAMILY_VALUES,
  SYSTEM_FONT_KEY_PREFIX, SYSTEM_FONT_NAME_MAX, systemFontKeyOf, isSystemFontKey,
  systemFontNameOf, sanitizeFamilyKey, sanitizeFamilyValue,
  FPS_CAP_VALUES, SCENE_LIVE_FPS_VALUES,
  SWITCH_TRANSITION_VALUES, SWITCH_DIRS, SWITCH_SPEED_VALUES,
  clampNum, readRotationGroups,
  settingsDefaults, sanitizeFromSchema, serializeSettings, panelDefaults,
  // 子 UI 玻璃登记表（面板按它渲染「子 UI 玻璃 / 子 UI 独立配置」两级；守卫按 id 对账）
  GLASS_CHILDREN, childGlassKey, GLASS_MODE_DEFAULTS,
  // 玻璃预设（快照键白名单 + 完整快照消毒；id 白名单与字体集同一条）
  GLASS_PRESET_SCHEMA_TAG, GLASS_PRESET_TOMBSTONE_TAG, GLASS_PRESET_KEYS,
  sanitizeGlassPresetValues, isGlassPresetId,
};
