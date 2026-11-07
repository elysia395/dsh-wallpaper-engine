/**
 * 跨包浏览器半边通道：宿主注入的**显式键集**（ADR-0014 §5.1 / §5.4）。
 *
 * 子包产物由 loader 用 `require("dsh-plugin-wallpaper-engine")` 取主 bundle 的导出面。
 * 这里挂的是**显式键集**，不是整个 module.exports：子包要什么就登记什么，多给一个键就是多
 * 一条没人维护的隐式契约。键集与各子包 src/client.js 里 `const { … } = host;` 的解构逐键对齐
 * （解构名单 = 申报键真源；子包产物里的 *_HOST_REQUIRED 由构建期从它派生，见 scripts/build-client.mjs
 * 的 deriveHostRequiredTable），判据见 test/verify-subpackage-client-half.mjs 的 D-7。
 *
 * 为什么单独成文件：这张表是**跨包契约**，改一个键要同时对账 6 处解构名单，还要过
 * verify-client 的键面断言；它原先埋在 6,696 行的 src/client.js 正文最深处，改键的人
 * 先要翻过整页渲染逻辑。搬到独立模块后，主 bundle 的行为**逐字不变**：构建器把本文件
 * 内联在正文之前，与正文同处一个工厂作用域（`var exports = module.exports;` 已在
 * prelude 之前就位），所以下面这些 getter 仍指向正文里的活绑定。
 *
 * 纪律（别退化）：
 *   · 一律用 **getter**：这些是活的模块级绑定（React / selection / 文案表在求值期才落地），
 *     值拷贝既会在求值期撞 TDZ，也会让子包拿到过期的引用。
 *   · 只登记**被点名的自由标识符**，不整包转发；每个键的"为什么"写在分段注释里。
 *   · `exports.hostBridgeKeys` 是给判据对账用的冻结清单，不是子包消费面。
 */

// 窄键常量（P-D S3b）：轮播节搬进子包半边后仍要回显「每 N 分钟」的默认间隔，但
// `DEFAULTS` 整张表**不进** host 键面 ⇒ 只给这一格显式绑定。真源仍是
// lib/settings-schema.js 的 DEFAULTS.rotationInterval（verify-client 有同源判据 + 负对照）。
// 顶层读 DEFAULTS ⇒ 本文件的内联位置必须排在 lib/settings-schema.js 之后（清单里在末尾）。
const ROTATION_INTERVAL_DEFAULT = DEFAULTS.rotationInterval;

const HOST_BRIDGE_BINDINGS = {
  selection: () => selection,
  weNow: () => weNow,
  weClampTo: () => weClampTo,
  weBody: () => weBody,
  weT: () => weT,
  React: () => React,
  switchRow: () => switchRow,
  SliderRow: () => SliderRow,
  ctlText: () => ctlText,
  swatchRow: () => swatchRow,
  FX_BLEND_VALUES: () => FX_BLEND_VALUES,
  // 两个注册入口（子包在上面的契约里要的就是这两个名字，不是 we* 前缀的内名）。
  registerExtensionModule: () => weRegisterExtensionModule,
  registerLayerHooks: () => weRegisterLayerHooks,
  // ── 字体半边（packages/fonts）的显式键集（ADR-0014 S5.1 / S5.4）──────────────────────
  // 来源 = 被搬渲染器里的**自由标识符**逐个点名（键集真源 = 本表；子包侧解构名单
  // 由 verify-subpackage-client-half 与本表对账，产物里的申报表由构建期派生）。
  // 判据：命中「留在主 bundle 的文件在工厂作用域声明」才在这里登记（0 个未归类）。
  // 反面同样严格：这里每多一个键就是多一条没人维护的隐式契约（多一个都不给）。
  // React / weT / ctlText / switchRow 是 fx 那半已经要过的四个键，fonts 复用它们、**不重复登记**
  // （重复键在对象字面量里是静默覆盖 —— `eslint no-dupe-keys` 会判红）。
  sectionHead: () => sectionHead,
  moduleResetButton: () => moduleResetButton,
  FONT_FAMILY_LABELS: () => FONT_FAMILY_LABELS,
  fontFamilyKeyOf: () => fontFamilyKeyOf,
  filterUsableSystemFonts: () => filterUsableSystemFonts,
  systemFontKeyOf: () => systemFontKeyOf,
  systemFontNameOf: () => systemFontNameOf,
  sanitizeFamilyKey: () => sanitizeFamilyKey,
  THEME_COLOR_ROLES: () => THEME_COLOR_ROLES,
  THEME_TYPE_ROLES: () => THEME_TYPE_ROLES,
  THEME_SIZE_MIN: () => THEME_SIZE_MIN,
  THEME_SIZE_MAX: () => THEME_SIZE_MAX,
  COMPONENT_FONT_TARGETS: () => COMPONENT_FONT_TARGETS,
  componentFontDefaults: () => componentFontDefaults,
  registerPanelSection: () => weRegisterPanelSection,
  // ── 桌宠联动半边（packages/pet-link）的显式键集 ─────────────────────────────────────
  // 来源 = 被搬文件里的**自由标识符**逐个点名（与 fonts 同一条纪律：只登记活绑定 getter）。
  // 反向（主包要**调**子包）只有一个键：registerPetLink = 登记槽 + 缓冲补做（见正文的门面）。
  // 反面同样严格：这里每多一个键就是多一条没人维护的隐式契约（多一个都不给）。
  apiUrl: () => apiUrl,
  apiFetch: () => apiFetch,
  wallSidebarOpen: () => wallSidebarOpen,
  wallSidebarClose: () => wallSidebarClose,
  wallSidebarToggle: () => wallSidebarToggle,
  registerPetLink: () => petLinkRegister,
  // ── 壁纸子包浏览器半边（packages/media-bridge）的显式键集 ────────────────────────────
  // 来源 = 被搬渲染器（packages/media-bridge/src/*.js）里的**自由标识符**逐个点名。
  // 动作体全留主包（ADR-0013 D20）：这里给的是活绑定 getter，不是值拷贝。
  changeUploadDir: () => changeUploadDir,
  changeWeAssetsDir: () => changeWeAssetsDir,
  uploadWallpaperFile: () => uploadWallpaperFile,
  removeUploadWallpaper: () => removeUploadWallpaper,
  renderConfirmRow: () => renderConfirmRow,
  switchTransitionOf: () => switchTransitionOf,
  SWITCH_TRANSITIONS: () => SWITCH_TRANSITIONS,
  SWITCH_DIRS: () => SWITCH_DIRS,
  SWITCH_DIR_LABELS: () => SWITCH_DIR_LABELS,
  SWITCH_SPEEDS: () => SWITCH_SPEEDS,
  groupWallpapers: () => groupWallpapers,
  startCreateGroup: () => startCreateGroup,
  startEditGroup: () => startEditGroup,
  saveEditingGroup: () => saveEditingGroup,
  cancelEditGroup: () => cancelEditGroup,
  importPlaylistIntoDraft: () => importPlaylistIntoDraft,
  Toggle: () => Toggle,
  rotationIntervalDefault: () => ROTATION_INTERVAL_DEFAULT,
  // 当前壁纸节：VinylRecord / vinylSpinVisible（本作用域）· liveFailReasonOf（src/live-layer.js，
  // 同一内联工厂作用域）。播放态 / 失败原因计算 / 动作体全留主包（ADR-0013 D20）。
  VinylRecord: () => VinylRecord,
  vinylSpinVisible: () => vinylSpinVisible,
  liveFailReasonOf: () => liveFailReasonOf,
  // 播放配置两节：FPS_CAP_VALUES（schema）· codecLabel（client-audio-playback）都在主 bundle 内。
  FPS_CAP_VALUES: () => FPS_CAP_VALUES,
  codecLabel: () => codecLabel,
  // ── 玻璃半边（packages/glass，ADR-0016 第二刀）的显式键集 ───────────────────────────
  // 来源 = packages/glass/src/glass-panel.js 与 glass-presets-panel.js 的**自由标识符**逐个点名（S3 起预设块在后者；键集真源 = 本表；
  // 子包侧解构名单由 verify-subpackage-client-half 与本表对账，产物里的申报表由构建期派生）。
  // React / weT / switchRow / SliderRow / swatchRow / ctlText / sectionHead / renderConfirmRow
  // 是 fx / fonts / media-bridge 已登记过的键，glass 复用、**不重复登记**。新增七键如下（另有 `apiUrl` 已在通用键段登记，玻璃行状态轮询依赖它）；
  // 反面同样严格：多一个键就是多一条没人维护的隐式契约（多一个都不给）。
  moduleResetButtonNode: () => moduleResetButtonNode,
  GLASS_CHILDREN: () => GLASS_CHILDREN,
  childGlassKey: () => childGlassKey,
  GLASS_COLOR_PRESETS: () => GLASS_COLOR_PRESETS,
  ROPE_FORMS: () => ROPE_FORMS,
  ROPE_FORM_VALUES: () => ROPE_FORM_VALUES,
  panelGlassPair: () => panelGlassPair,
  // 第三刀（运行时随包走）新增六键 + registerGlassStatus 一个登记入口（registerLayerHooks 是早已登记的键）：
  //   · skinYieldActive —— 让路态判定（applyGlass 门控与思考块/侧栏跟随共用）；
  //   · weClampSurfaceColor / glassColorOf —— 染色地板钳制与分主题取色（家留主包，子包经此共享）；
  //   · sanitizeExtraGlassSelectors —— #200 选择器消毒（settings-schema 具名导出）；
  //   · GLASS_SATURATE / useLegacySaturateCoupling —— 饱和耦合常量与 A/B 旧斜坡；
  //   · registerGlassStatus —— 表面状态投影登记（src/client.js 的 glassStatusRegister 门面）。
  skinYieldActive: () => skinYieldActive,
  weClampSurfaceColor: () => weClampSurfaceColor,
  glassColorOf: () => glassColorOf,
  sanitizeExtraGlassSelectors: () => sanitizeExtraGlassSelectors,
  GLASS_SATURATE: () => GLASS_SATURATE,
  useLegacySaturateCoupling: () => useLegacySaturateCoupling,
  registerGlassStatus: () => glassStatusRegister,
};
const HOST_BRIDGE_KEYS = Object.keys(HOST_BRIDGE_BINDINGS);
for (const bridgeKey of HOST_BRIDGE_KEYS) {
  Object.defineProperty(exports, bridgeKey, {
    enumerable: true, configurable: true, get: HOST_BRIDGE_BINDINGS[bridgeKey],
  });
}
// 键集本身也给出来（判据对账用；不是子包的消费面）。
exports.hostBridgeKeys = Object.freeze(HOST_BRIDGE_KEYS.slice());
