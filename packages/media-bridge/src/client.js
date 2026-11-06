/**
 * client.js — 壁纸子包的**浏览器半边**入口（P-D 阶段1：S3a–S3d 六节全部搬完 ——
 * 壁纸库四节（当前/过场/轮播/上传）+ 播放配置两节（倍速·帧率上限 / 适配·翻转））。
 *
 * ⚠️ 归属（务必先读）：用户口径 **§6.1 = A「代码归属，不是状态归属」**（正本 = ADR-0013 **D20**）。
 *    随包走的是**渲染器与描述符**；上传目录 / 官方资源目录 / 上传列表 / 确认令牌 / 过场与轮播的
 *    选择、列表、间隔、顺序这些键、默认值、持久化与动作体仍在主包（lib/settings-schema.js 与
 *    src/client.js）⇒ 本包**不持键、不持久化、不注册 settings.section**；值一律经主包构造的渲染
 *    ctx 或下面的 host 显式键集拿到。
 *
 * ## 构建期形状（与 packages/fonts/src/client.js 逐条同形）
 *   · 产物 = packages/media-bridge/lib/client.media-bridge.js，id = 子包真实包名
 *     dsh-plugin-wallpaper-engine-media-bridge（与宿主 graph row 逐字相等）；入口 = 本文件，
 *     正文只取**首个块注释之后**的内容。
 *   · 本包的 INLINE_MODULES（client.build.json 的 inline[]）内联在正文之前 ⇒ 兄弟文件与入口落在
 *     **同一个工厂作用域**：互相按裸名引用，不 import、不 require、不许 `...host` 展开、不许动态键。
 *   · 唯一例外 = 产物里由构建循环 outline 在正文与内联件之前发出的那一行
 *     `const host = require('dsh-plugin-wallpaper-engine');`（ADR-0014 S5.2）。
 *
 * ## 消费侧契约（唯一跨包通道 = 主 bundle 的显式键集，ADR-0014 S5.1 / S5.4）
 * 下面的解构名单与主包 `src/host-bridge.js` 的 HOST_BRIDGE_BINDINGS 壁纸段**逐键一致**（缺键大声抛，
 * 不许静默 undefined）；产物里的 WALLPAPER_SECTIONS_HOST_REQUIRED 由构建期从这份解构派生
 * （源码里是空表）。键集依据 = 被搬渲染器的**自由标识符**逐个点名：
 *   · 四节共享：React / weT；当前壁纸另要 VinylRecord / vinylSpinVisible / liveFailReasonOf；
 *     自定义壁纸另要 renderConfirmRow；切换过场另要 ctlText / switchTransitionOf /
 *     SWITCH_TRANSITIONS / SWITCH_DIRS / SWITCH_DIR_LABELS / SWITCH_SPEEDS；
 *     自动轮播另要 Toggle / groupWallpapers / startCreateGroup / startEditGroup /
 *     saveEditingGroup / cancelEditGroup / importPlaylistIntoDraft / rotationIntervalDefault；
 *     自定义壁纸另要 changeUploadDir / changeWeAssetsDir / uploadWallpaperFile /
 *     removeUploadWallpaper；
 *   · 贡献面：registerPanelSection。
 * `rotationIntervalDefault` 是**窄键**（P-D S3b）：轮播节要回显默认间隔，但整张 DEFAULTS 表
 * 不进 host 键面 ⇒ 只绑 `DEFAULTS.rotationInterval` 一格（同源判据见 verify-client）。
 */

/**
 * 缺键**大声失败**（ADR-0014 S5.1 / S5.4 显式键集 + ADR-0013 D3③「宁可显示、不可静默消失」）。
 * 主包被关 ⇒ 本 bundle 根本不会被 require（ADR-0014 S7.2 连坐）；能走到这里却缺键 = 键集与申报表脱钩。
 */
/** 由构建期填充：scripts/build-client.mjs 从下方 `} = host;` 的解构逐键派生本表
 * （源码留空表只为 eslint/typecheck 可读；产物里是一份生成好的键数组）。
 * 手工加键的正确顺序：① src/host-bridge.js 的 HOST_BRIDGE_BINDINGS ② 本文件的解构名单。 */
const WALLPAPER_SECTIONS_HOST_REQUIRED = [];
for (const key of WALLPAPER_SECTIONS_HOST_REQUIRED) {
  if (!(key in host)) {
    throw new Error('[wallpaper-engine-media-bridge] 主 bundle 键集缺少 "' + key
      + '"（ADR-0014 S5.1 / S5.4 显式键集：要么补键，要么改申报表，不许静默 undefined）');
  }
}
const {
  React, weT, ctlText, FPS_CAP_VALUES, codecLabel, switchRow,
  VinylRecord, vinylSpinVisible, liveFailReasonOf,
  switchTransitionOf, SWITCH_TRANSITIONS, SWITCH_DIRS, SWITCH_DIR_LABELS, SWITCH_SPEEDS,
  groupWallpapers, startCreateGroup, startEditGroup, saveEditingGroup, cancelEditGroup,
  importPlaylistIntoDraft, Toggle, rotationIntervalDefault,
  changeUploadDir, changeWeAssetsDir, uploadWallpaperFile, removeUploadWallpaper, renderConfirmRow,
  registerPanelSection,
} = host;

/* ===== 跨包登记：「壁纸库」页签第一/二/三/四节（全部走面板节注册表）===== */

// 主包 src/panel-tabs.js 的 `renderWallpaperTab(ctx)` 本身不再内置任何一节，只按注册表续接本包
// 登记的节（`wePanelSectionsOf('library')`，见 src/extension-registry.js）。三个硬口径：
//   ① `title` 必须是 **getter**：注册发生在 bundle 求值期，那时 i18n 表 / `weT` 都还没到位，
//      注册期读词会把 `weT` 拉到求值期（字体包 / fx / parallax 的 title getter 同款理由）。
//   ② order：current=10 / transition=20 / rotation=30 / uploads=40 —— 与搬前组装点里的调用序逐位
//      相同（S3c 起 current 也走注册表；主包组装点本身只画注册节，不再内置任何一节）。
//      顺序由 order 决定、不靠求值顺序。
//   ③ 注册表只登记、不持有状态：ctx 由主包在渲染处构造（一个键都不删），本包不缓存、不自订阅。
registerPanelSection('library', 'wallpaper-current', {
  id: 'wallpaper-current',
  get title() { return weT("当前壁纸"); },
  order: 10,
  render: renderWallpaperCurrentSection,
});
registerPanelSection('library', 'wallpaper-transition', {
  id: 'wallpaper-transition',
  get title() { return weT("切换过场"); },
  order: 20,
  render: renderWallpaperTransitionSection,
});
registerPanelSection('library', 'wallpaper-rotation', {
  id: 'wallpaper-rotation',
  get title() { return weT("自动轮播"); },
  order: 30,
  render: renderWallpaperRotationSection,
});
registerPanelSection('library', 'wallpaper-uploads', {
  id: 'wallpaper-uploads',
  get title() { return weT("自定义壁纸"); },
  order: 40,
  render: renderWallpaperUploadsSection,
});

/* ===== 跨包登记：「播放」页签的倍速/帧率上限、适配/翻转两节（P-D S3d）===== */

// 主包 src/panel-tabs.js 的 `renderEffectsTab(ctx)` 在三个内置节之后 append
// `wePanelSectionsOf('playback')` ⇒ 顺序仍由 order 决定（60 / 70），与搬前调用序逐位相同；
// 两节仍画在同一个「画面」节容器里（组装点把注册节放在内置节之后），视觉分组不变。
registerPanelSection('playback', 'wallpaper-playback-rate', {
  id: 'wallpaper-playback-rate',
  get title() { return weT("倍速"); },
  order: 60,
  render: renderEffectsPlaybackSection,
});
registerPanelSection('playback', 'wallpaper-fit', {
  id: 'wallpaper-fit',
  get title() { return weT("适配"); },
  order: 70,
  render: renderEffectsFitSection,
});
