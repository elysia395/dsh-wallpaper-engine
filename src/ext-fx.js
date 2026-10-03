/**
 * ext-fx.js — 「扩展」页签**二号模块**（点击效果与拖尾效果）的扩展岛。
 *
 * ══ 它是什么 ══════════════════════════════════════════════════════════════════
 * 一个**模块描述符**（形状 `{ id, title, desc?, render? }`，契约写在 src/panel-tabs.js 的
 * `extensionModules()` 上方）：panel-tabs 只负责把它排在「扩展」页签里，具体的控件与文案
 * 全在本文件。光效本体在 `src/fx-layer.js`（画布层），设置项的真源在
 * `lib/settings-schema.js` 的 14 个 `fx*` 键。
 *
 * 契约：
 *   需要的外界：`ctx`（由 `src/client.js` 在 `renderExtensionsTab({...})` 的调用点组装）——
 *     `sel` + 一组具名 `on*` 处理器；扁平可用的渲染助手 `React` / `weT` / `switchRow` /
 *     `SliderRow` / `ctlText` / `swatchRow`（后五个住在 `src/client.js` 正文，函数体内调用没问题）。
 *   对外提供：`FX_EXTENSION_MODULE`（注册表项）。
 *
 * 不变量：
 *   · **模块不得自己写设置 / 发通知 / 持有状态**（panel-tabs 的注册表契约）：本文件里
 *     没有 `setSetting`、没有 `emit(`、没有 `selection`，一个动作一个 `on*` 处理器 ——
 *     形状与别的渲染器一致，越界的四种形态由 test/verify-client.mjs 的接缝判据钉住。
 *   · **只从一个参数取外界**：`renderFxIsland(ctx)`，函数体第一行解构。
 *   · 参数的可调范围与默认值**不在这里写死**：`SliderRow` 的 min/max/step 与设置白名单
 *     的 KINDS 一致（改范围要同时看 lib/settings-schema.js —— 那份是唯一真源）；
 *     三个档位表（点击样式 / 拖尾样式 / 配色）与混合模式的下拉档位直接读那份的
 *     `FX_*_VALUES`（只有中文名住在本文件）。
 *   · 关掉总开关时只画总开关 + 一句说明；关掉某一个子开关（点击 / 拖尾）时，**它自己那一
 *     串参数跟着收起来** —— "关掉了还能拖它的参数"是上一块柱状图刻意没做的错觉，这里照办。
 */

/** 点击样式（与 lib/settings-schema.js 的 FX_CLICK_STYLE_VALUES 逐字对齐）。
 *  文案写成 **getter**：既让 `weT(...)` 是这些字面量的"最内层调用帧"（test/verify-i18n.mjs
 *  的判据 ① 认这个形态），又保证取译文发生在**渲染时** —— 直接写 `label: "…"` 会被判成
 *  裸中文，写成顶层 `weT("…")` 又会撞内联后的 TDZ（见 docs/CODE-STRUCTURE.md 的模块纪律）。 */
const FX_CLICK_STYLES = [
  { id: 'ripple', get label() { return weT("涟漪"); }, get hint() { return weT("从点击处扩散的圆环"); } },
  { id: 'spark', get label() { return weT("星火"); }, get hint() { return weT("向四周飞散的亮点"); } },
  { id: 'both', get label() { return weT("两者"); }, get hint() { return weT("圆环与星火一起"); } },
];

/** 拖尾样式（与 lib/settings-schema.js 的 FX_TRAIL_STYLE_VALUES 逐字对齐）。 */
const FX_TRAIL_STYLES = [
  { id: 'comet', get label() { return weT("彗尾"); }, get hint() { return weT("一条渐隐的光带"); } },
  { id: 'dust', get label() { return weT("星尘"); }, get hint() { return weT("留在原地的亮点"); } },
];

/** 配色档（与 lib/settings-schema.js 的 FX_COLOR_MODE_VALUES 逐字对齐）。 */
const FX_COLOR_MODES = [
  { id: 'accent', get label() { return weT("跟随主题色"); }, get hint() { return weT("用「外观」里选的配色"); } },
  { id: 'rainbow', get label() { return weT("彩虹"); }, get hint() { return weT("每次效果的色相都不一样"); } },
  { id: 'custom', get label() { return weT("自定义"); }, get hint() { return weT("用下面选的那一个颜色"); } },
];

/** 混合模式的档位中文名（键 = lib/settings-schema.js 的 `FX_BLEND_VALUES` 的**原值**）。
 *  档位本身直接读那份常量（唯一真源），这里只放"值 → 屏上文字"的映射；
 *  同一条 getter 理由（见上面配色档注释）。 */
const FX_BLEND_LABELS = {
  get screen() { return weT("滤色"); },
  get normal() { return weT("正常"); },
  get overlay() { return weT("叠加"); },
  get multiply() { return weT("正片叠底"); },
  get lighten() { return weT("变亮"); },
};

/** 自定义配色的预设圆点：一个中性蓝 + 五条"霓虹"色 + 白（白在最右，它是最亮的一档）。 */
const FX_COLOR_PRESETS = ['#4f8cff', '#35d07f', '#ff5c8a', '#ffb020', '#a06bff', '#22c7d6', '#ffffff'];

/** 一段三选一（点击样式 / 拖尾样式 / 效果配色）：与柱状图的「柱配色」同一形态（等分按钮 + 悬停说明）。 */
function fxSegRow(key, label, hint, items, value, onPick) {
  return React.createElement("div", { className: "we-picker__ctl", key: key },
    ctlText(label, hint),
    React.createElement("div", { className: "we-picker__seg" },
      items.map((m) =>
        React.createElement("button", {
          key: m.id,
          className: "we-picker__btn we-picker__rate" + (value === m.id ? " we-picker__rate--active" : ""),
          type: "button",
          title: m.hint,
          onClick: () => onPick(m.id),
        }, m.label),
      ),
    ),
  );
}

/** 一档下拉（混合模式共 5 档，平铺会挤成一团）：与柱状图的「混合模式」同一形态。 */
function fxSelectRow(key, label, hint, values, labels, value, onChange) {
  return React.createElement("div", { className: "we-picker__ctl", key: key },
    ctlText(label, hint),
    React.createElement("select", {
      className: "we-picker__select",
      "aria-label": label,
      value: values.indexOf(value) >= 0 ? value : values[0],
      onChange: onChange,
    },
      values.map((v) => React.createElement("option", { key: v, value: v }, labels[v])),
    ),
  );
}

/**
 * 扩展岛：总开关 → 点击效果（开关 / 样式 / 半径 / 光晕）→ 拖尾效果（开关 / 样式 / 时长 /
 * 粗细 / 光晕）→ 整层观感（不透明度 / 混合模式）→ 配色（档位 + 自定义档下的取色器）。
 * @param {{sel:object}} ctx 见文件头契约
 */
function renderFxIsland(ctx) {
  const { sel, onFxEnabled, onFxClick, onFxClickStyle, onFxClickSize, onFxClickGlow,
    onFxTrail, onFxTrailStyle, onFxTrailLength, onFxTrailWidth, onFxTrailGlow,
    onFxOpacity, onFxBlend, onFxColorMode, onFxColor } = ctx;
  const on = sel.fxEnabled === true;
  const click = on && sel.fxClick !== false;
  const trail = on && sel.fxTrail !== false;
  return React.createElement(React.Fragment, null,
    switchRow(weT("启用点击与拖尾效果"), on, onFxEnabled, { key: "fx-on" }),
    React.createElement("span", { className: "we-picker__hint", key: "fx-what" },
      weT("在壁纸之上叠加随光标响应的点击与拖尾效果：整层在界面之后，不会挡到任何控件")),
    on && switchRow(weT("点击效果"), click, onFxClick,
      { key: "fx-click", hint: weT("在点击处炸开一圈光效") }),
    click && fxSegRow("fx-click-style", weT("点击样式"), weT("点击时炸开的样子"),
      FX_CLICK_STYLES, sel.fxClickStyle, onFxClickStyle),
    click && SliderRow(weT("半径"), 40, 400, 10, sel.fxClickSize, onFxClickSize, "px", "fx-click-size"),
    click && SliderRow(weT("点击光晕"), 0, 100, 1, sel.fxClickGlow, onFxClickGlow, "%", "fx-click-glow"),
    on && switchRow(weT("拖尾效果"), trail, onFxTrail,
      { key: "fx-trail", hint: weT("光标划过时留下会淡出的轨迹") }),
    trail && fxSegRow("fx-trail-style", weT("拖尾样式"), weT("轨迹的样子"),
      FX_TRAIL_STYLES, sel.fxTrailStyle, onFxTrailStyle),
    trail && SliderRow(weT("拖尾时长"), 80, 2000, 20, sel.fxTrailLength, onFxTrailLength, "ms", "fx-trail-life",
      { tooltip: weT("光标停下后，轨迹在这段时间里淡完") }),
    trail && SliderRow(weT("拖尾粗细"), 1, 12, 1, sel.fxTrailWidth, onFxTrailWidth, "px", "fx-trail-width"),
    trail && SliderRow(weT("拖尾光晕"), 0, 100, 1, sel.fxTrailGlow, onFxTrailGlow, "%", "fx-trail-glow"),
    on && SliderRow(weT("不透明度"), 10, 100, 1, sel.fxOpacity, onFxOpacity, "%", "fx-opacity"),
    on && fxSelectRow("fx-blend", weT("混合模式"),
      weT("与壁纸的融合方式：默认的滤色只让画面变亮、最像霓虹；想让它更像实体贴纸就换手选档"),
      FX_BLEND_VALUES, FX_BLEND_LABELS, sel.fxBlend, onFxBlend),
    on && fxSegRow("fx-color-mode", weT("效果配色"), weT("光效的取色方式"),
      FX_COLOR_MODES, sel.fxColorMode, onFxColorMode),
    // 取色器**只在「自定义」档出现**（别的档颜色由主题或色相决定，摆在这里会让人以为它总是生效）。
    on && sel.fxColorMode === 'custom' && swatchRow(weT("自定义颜色"), FX_COLOR_PRESETS, sel.fxColor,
      (v, live) => onFxColor(v, live), { key: "fx-color", colorValue: sel.fxColor }),
  );
}

/** 「扩展」页签的二号模块（注册表项；`id` 是 React key，改它会让面板重挂一次）。
 *  `title` / `desc` 与上面的档位表同一条理由写成 getter（见那份注释）。 */
const FX_EXTENSION_MODULE = {
  id: 'fx',
  get title() { return weT("点击效果与拖尾效果"); },
  get desc() { return weT("在壁纸之上叠加随光标响应的点击与拖尾效果：整层在界面之后，不会挡到任何控件"); },
  render: renderFxIsland,
};

export { FX_EXTENSION_MODULE, renderFxIsland };
