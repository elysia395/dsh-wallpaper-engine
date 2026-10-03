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
  // - glassWindow: master switch for the WHOLE native settings window — when
  //   on, the dialog (nav + every native section: General/Models/Plugins/…)
  //   becomes liquid glass with the accent + transparency above; off restores
  //   the shell's stock look.
  accent: "#4f8cff",
  glassAlpha: 12,
  glassColor: "#ffffff",
  glassFidelity: 100,
  chatGlassFidelity: 100,
  glassWindow: true,
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
  // 思考玻璃默认关：开启后思考区/文件卡清底，重点胶囊与指定聊天结果使用玻璃。
  thinkingGlass: false,
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
  sidebarAlpha: 120,
  sidebarColor: "#ffffff",
  // 内容面（编辑器/终端）近不透明玻璃底的细调——既有固定调色板（语法高亮/
  // ANSI）为不透明底设计，全透明毛玻璃下注释灰不可读，全不透明又失去玻璃感：
  // - sidebarContentAlpha：内容面透明度（%），越大越透（映射到底色不透明度
  //   100%→20%；默认 30 → 70% 不透明，亮/暗主题实测显示均合理，玻璃感与
  //   注释可读性平衡）；
  // - sidebarContentColor：内容面底色（#rrggbb），空 = 跟随主题面板色
  //   (--dsw-alias-bg-layer-1)，选定后双主题统一使用该色。
  sidebarContentAlpha: 30,
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
  glassAlpha: { kind: 'num', min: 0, max: 60 },
  glassColor: { kind: 'hex' },
  glassFidelity: { kind: 'num', min: 0, max: 100 },
  chatGlassFidelity: { kind: 'num', min: 0, max: 100 },
  glassWindow: { kind: 'boolTrue' },
  leftSidebarGlass: { kind: 'boolFalse' },
  thinkingGlass: { kind: 'boolFalse' },
  sidebarGlass: { kind: 'boolTrue' },
  sidebarBlur: { kind: 'num', min: 0, max: 200 },
  sidebarAlpha: { kind: 'num', min: 0, max: 200 },
  sidebarColor: { kind: 'hex' },
  sidebarContentAlpha: { kind: 'num', min: 0, max: 80 },
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
function sanitizeFromSchema(raw, side) {
  if (!raw || typeof raw !== 'object') {
    // 宿主由调用方判空；客户端回落到默认值（两侧同一套判据的客户端半边）
    return side === 'host' ? null : Object.assign({ id: '' }, DEFAULTS);
  }
  const out = {};
  for (const [key, meta] of Object.entries(KINDS)) {
    if (side === 'host' && CLIENT_ONLY.includes(key)) continue;
    if (FONTSET_KEYS.includes(key)) continue; // D1：字体值住字体集文件，不住 settings blob
    const def = key === 'id' ? '' : DEFAULTS[key];
    out[key] = readOne(meta, raw, key, def);
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
};
