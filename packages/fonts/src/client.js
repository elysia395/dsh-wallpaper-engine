/**
 * client.js — 字体子包的**浏览器半边**入口：外观页签第六节「全局字体」的渲染器 + 字体集编辑器。
 *
 * ⚠️ 归属（务必先读）：用户口径 **§6.1 = A「代码归属，不是状态归属」**（正本 = ADR-0013 **D20**）。
 *    随包走的是**渲染器与描述符**；字体的**键、默认值、kind、消毒、持久化**仍在主包
 *    `lib/settings-schema.js`（`FONTSET_KEYS` 单点定义）与 `fontsets/<id>.json`
 *    ⇒ 本包**不持键、不持久化、不注册 `settings.section`**；值一律经主包构造的渲染 ctx
 *    或下面的 host 显式键集拿到。
 *
 * ## 构建期形状（与 packages/fx/src/client.js 逐条同形）
 *   · 产物 = packages/fonts/lib/client.fonts.js，id = 子包真实包名 dsh-plugin-wallpaper-engine-fonts
 *     （与宿主 graph row 逐字相等）；入口 = 本文件，正文只取**首个块注释之后**的内容。
 *   · 本包的 INLINE_MODULES（client.build.json 的 inline[]）内联在正文之前 ⇒ 兄弟文件与入口落在
 *     **同一个工厂作用域**：互相按裸名引用，不 import、不 require、不许 `...host` 展开、不许动态键。
 *   · 唯一例外 = 产物里由构建循环 outline 在正文与内联件之前发出的那一行
 *     `const host = require('<主包名>');`（BUNDLE-SPLIT §5.1 ②）。源码面写 require 会被
 *     test/verify-subpackage-purity.mjs 判红（只放行产物、只放行主包名出现在本包 lib/client*.js 里）。
 *
 * ## 消费侧契约（唯一跨包通道 = 主 bundle 的显式键集，ADR-0014 S5.1 / S5.4）
 * 下面的 FONTS_HOST_REQUIRED 与主包 `src/client.js` 的 HOST_BRIDGE_BINDINGS 字体段**逐键一致**
 * （缺键大声抛，不许静默 undefined）。键集的依据 = 两个已搬文件的**自由标识符**逐个点名，
 * 取证脚本 `.integration-notes/scratch/fonts-host-keys.mjs`；逐键清单另见
 * `.integration-notes/p-c-contract.md` §5（那面是唯一真源，本注释是它的副本）：
 *   packages/fonts/src/appearance-font-section.js（原 src/panel-tabs-appearance.js:54-420）
 *     React×77 · weT×70 · ctlText×8 · switchRow×5 · sectionHead×1 · moduleResetButton×1
 *     · FONT_FAMILY_LABELS×2 · fontFamilyKeyOf×3 · filterUsableSystemFonts×2 · systemFontKeyOf×1
 *     · systemFontNameOf×1 · sanitizeFamilyKey×2 · THEME_COLOR_ROLES×1 · THEME_TYPE_ROLES×2
 *     · THEME_SIZE_MIN×1 · THEME_SIZE_MAX×1 · COMPONENT_FONT_TARGETS×1 · componentFontDefaults×2
 *   packages/fonts/src/fontset-editor.js（原 src/fontset-editor.js）
 *     weT×35 · React×29 · ctlText×1
 *   ⇒ 并集 18 键，再加贡献面 `registerPanelSection`（主包 src/extension-registry.js 的收件箱）= 19 键。
 *   ⚠️ 每多一个键就是多一条没人维护的隐式契约（ADR-0014 S5.2）⇒ 清单之外一个都**不**解构。
 *
 * ## 每渲染才存在的值走 ctx，不走键集（契约 §2.1）
 * 渲染器需要的一切"这次渲染才存在"的值与意图回调（sel / fontSet / fontOpen / onToggleFontSection /
 * onThemeFamily …）仍由主包在**渲染处**构造 ctx 传进来：本包不缓存它们、不自建订阅、不自起定时器
 * （ADR-0014 S6.3），配置键与状态全留主包（ADR-0013 D20）。
 */

/**
 * 缺键**大声失败**（ADR-0014 S5.1 / S5.4 显式键集 + ADR-0013 D3③「宁可显示、不可静默消失」）。
 * 主包被关 ⇒ 本 bundle 根本不会被 require（ADR-0014 S7.2 连坐）；能走到这里却缺键 = 键集与申报表脱钩。
 */
const FONTS_HOST_REQUIRED = [
  // 内核与渲染助手（主 bundle 的共享零件表）
  'React', 'weT', 'ctlText', 'switchRow', 'sectionHead', 'moduleResetButton',
  // 字族与主题数据表 / 取值器（产地在留在主包的文件里）
  'FONT_FAMILY_LABELS', 'fontFamilyKeyOf', 'filterUsableSystemFonts', 'systemFontKeyOf',
  'systemFontNameOf', 'sanitizeFamilyKey',
  'THEME_COLOR_ROLES', 'THEME_TYPE_ROLES', 'THEME_SIZE_MIN', 'THEME_SIZE_MAX',
  'COMPONENT_FONT_TARGETS', 'componentFontDefaults',
  // 贡献面（主 bundle 的收件箱：值 + 回调，写权留主包）
  'registerPanelSection',
];
for (const key of FONTS_HOST_REQUIRED) {
  if (!(key in host)) {
    throw new Error('[wallpaper-engine-fonts] 主 bundle 键集缺少 "' + key
      + '"（ADR-0014 S5.1 / S5.4 显式键集：要么补键，要么改申报表，不许静默 undefined）');
  }
}
const {
  React, weT, ctlText, switchRow, sectionHead, moduleResetButton,
  FONT_FAMILY_LABELS, fontFamilyKeyOf, filterUsableSystemFonts, systemFontKeyOf,
  systemFontNameOf, sanitizeFamilyKey,
  THEME_COLOR_ROLES, THEME_TYPE_ROLES, THEME_SIZE_MIN, THEME_SIZE_MAX,
  COMPONENT_FONT_TARGETS, componentFontDefaults,
  registerPanelSection,
} = host;

/* ===== 唯一的跨包登记：外观页签第六节「全局字体」===== */

// 主包 src/panel-tabs.js 的 `renderAppearanceTab(ctx)` 画完五个内置节之后，按注册表续接本包登记的节
// （`wePanelSectionsOf('appearance')`，见 src/extension-registry.js）。两个硬口径：
//   ① `title` 必须是 **getter**：注册发生在 bundle 求值期，那时 i18n 表/`weT` 都还没到位，
//      注册期读词会把 `weT` 拉到求值期（fx/parallax 的 `title` getter 同款理由）。
//   ② 不写 `order` ⇒ 落到默认位 100，排在**所有显式 order 的节之后**：今天屏上就是这个位置
//      （五个内置节都在本节的上面）。搬包**不改变屏上顺序**，顺序判据见 src/panel-tabs.js。
registerPanelSection('appearance', 'fonts', {
  id: 'fonts',
  get title() { return weT("全局字体"); },
  render: renderAppearanceFontSection,
});
