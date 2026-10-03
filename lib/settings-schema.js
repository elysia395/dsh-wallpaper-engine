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
 * ⚠️ **不含「左侧栏玻璃」**（用户口径）：左侧栏的"独立配置"**耦合在「左侧栏覆盖」**上
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
    // 思考触发条：对话里「思考过程」那一行的入口条（宿主 DOM 锚点 `section[data-turn-trigger]`）。
    // 2026-10 起它**也吃玻璃**（此前是宿主的不透明代码块底色），本项给它自己的独立配置。
    id: 'thinkingTrigger', label: '思考触发条玻璃',
    hint: '对话里「思考过程」那一行的入口条',
    // ⚠️ 与 `settingsWindow` / `floaters` 同：**共享面纱** ⇒ 不含 `fidelity`（F2a 的面纱形
    //    与 F1c 的 floor 声明形把地板锁在全局那一对变量上，见 wip §4.14）；本面的 CSS
    //    只消费 `--we-thinking-trigger-blur` / `-alpha` 两个变量 ⇒ 同理**不含 `color`**
    //    （R3a 的教训：注册表 `params` 必须等于**真正接线**的那批，否则面板渲染死旋钮）。
    params: { transparency: 100, blur: 60 },
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
    //   · 它已有自己的总开关 `leftSidebarGlass`（「左侧栏覆盖」）——两个开关控一件事；
    //   · 它的"独立配置"耦合在「左侧栏覆盖」下面（见 panel-tabs.js 的「细节」节）。
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
  // 左侧栏覆盖（默认关）：原生**左栏**（会话列表 / 工作区那一列）在壁纸下本来就
  // 是"透明的洞"—— --dsw-specific-sidebar-fill 被本插件置 transparent，那一列因此
  // 直接透出**原样**壁纸，既没有霜也没有本套玻璃参数。打开后左栏拿到与其余面板
  // **同一张配方表**：玻璃颜色 @ 玻璃透明度 压在可读性下限之上 + 雾化（--we-blur）
  // + 边框（--dsw-alias-border-l3 那条竖分割线）+ 配色（accent 高亮映射，作用于
  // 选中/悬停行、徽标与焦点环）。默认关 = 今天的样子，逐字节不变。
  // ⚠️ 与 sidebarGlass（dsh-better-sidebar 那套「侧栏液态玻璃」）不是一回事：
  //    那个管第三方侧栏插件自己的面板，且有一套独立旋钮；本键只管**宿主原生左栏**，
  //    且只跟随「主题 / 细节」两节里的全局参数。
  leftSidebarGlass: false,
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
  // 组件级字体（G3/G4）：{ 组件前缀: { size?, weight?, family? } }；空 = 全部官方值。
  componentFonts: {},
  // 面板视图开关（G4「高级字体设置」子分支）：defaults-only ⇒ 不进白名单、不持久化。
  fontAdvanced: false,
  // 面板视图开关（与「字体集」子分支同款）：defaults-only。
  fontSetOpen: false,
  // 面板视图开关（F2「只看改过的」）：defaults-only ⇒ 不进白名单、不持久化。
  // **默认开**：排版角色表有十几行，多数用户只改其中两三行 —— 一进来就铺满全表，反而看不出
  // "我到底改了哪些"。筛完是空的时候面板有专门一行提示（不是"表格坏了"）。
  themeTypeOnly: true,
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
  chatGlassFidelity: { kind: 'num', min: 0, max: 100 },
  leftSidebarGlass: { kind: 'boolFalse' },
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
  // G4：角色级字族（族键，见 FONT_FAMILY_VALUES；空 = DSH 官方字族）。
  themeFamily: { kind: 'typeFamily' },
  // G3/G4：组件级字体（字号/字重/字族；空 = 官方值）。
  componentFonts: { kind: 'componentFonts' },
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
 * 角色字族（G4 字族细化）：只留已知角色、只留 FONT_FAMILY_VALUES 里的族键。
 * 存**族键**而不是 CSS 栈 —— 栈（含中文 fallback 链）由客户端 fontFamilyStack 解析，
 * 宿主不必知道字体栈长什么样（同一份键在两侧的含义一致）。
 */
function readTypeFamily(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const role of THEME_TYPE_ROLE_IDS) {
    const v = raw[role];
    if (typeof v !== 'string' || !v) continue;
    if (!FONT_FAMILY_VALUES.includes(v)) continue;
    out[role] = v;
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
 * 字族是唯一进 CSS 的字符串 ⇒ 必须消毒：去掉能破坏规则结构的字符（`;{}<>` 与引号/反斜杠），
 * 并限长。宁可丢一个值，也不让设置文件里的字符串变成任意 CSS 注入。
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
    if (typeof v.family === 'string') {
      const clean = v.family.replace(/[;{}<>"'\\]/g, '').trim().slice(0, 60);
      if (clean) one.family = clean;
    }
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
 * 字体集**正文**的键集 = 六个持久化字体键（**不含** `fontCustom`：总开关留在 settings 里）。
 * 宿主写文件、读文件、导入导出与校验都用这一份 ⇒ 不会出现两份清单。
 * 依赖：每个键都必须在 `KINDS` 里（`sanitizeFontset` 按它的 kind 消毒）—— 由守卫钉住。
 */
const FONTSET_KEYS = ['themeColors', 'themeDarkSeparate', 'themeSize', 'themeWeight', 'themeFamily', 'componentFonts'];

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
  ADAPTER_TARGET_VALUES,
  ROPE_FORM_VALUES, ROPE_SCALE_MIN, ROPE_SCALE_MAX, FONT_FAMILY_VALUES,
  FPS_CAP_VALUES, SCENE_LIVE_FPS_VALUES,
  SWITCH_TRANSITION_VALUES, SWITCH_DIRS, SWITCH_SPEED_VALUES,
  clampNum, readRotationGroups,
  settingsDefaults, sanitizeFromSchema, serializeSettings, panelDefaults,
  // 子 UI 玻璃登记表（面板按它渲染「子 UI 玻璃 / 子 UI 独立配置」两级；守卫按 id 对账）
  GLASS_CHILDREN, childGlassKey, GLASS_MODE_DEFAULTS,
};
