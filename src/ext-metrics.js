/**
 * ext-metrics.js — 「扩展」页签**一号模块**（硬件资源监控柱状图）的扩展岛。
 *
 * ══ 它是什么 ══════════════════════════════════════════════════════════════════
 * 一个**模块描述符**（形状 `{ id, title, desc?, render? }`，契约写在 src/panel-tabs.js 的
 * `extensionModules()` 上方）：panel-tabs 只负责把它排在「扩展」页签里，具体的控件与文案
 * 全在本文件。柱状图本体在 `src/metrics-layer.js`（画布层），设置项的真源在
 * `lib/settings-schema.js` 的 29 个 `metrics*` 键。
 *
 * 契约：
 *   需要的外界：`ctx`（由 `src/client.js` 在 `renderExtensionsTab({...})` 的调用点组装）——
 *     `sel` + 一组具名 `on*` 处理器；扁平可用的渲染助手 `React` / `weT` / `switchRow` /
 *     `SliderRow` / `ctlText` / `swatchRow`（后五个住在 `src/client.js` 正文，函数体内调用没问题）。
 *   对外提供：`METRICS_EXTENSION_MODULE`（注册表项）。
 *
 * 不变量：
 *   · **模块不得自己写设置 / 发通知 / 持有状态**（panel-tabs 的注册表契约）：本文件里
 *     没有 `setSetting`、没有 `emit(`、没有 `selection`，一个动作一个 `on*` 处理器 ——
 *     形状与别的渲染器一致，越界的四种形态由 test/verify-client.mjs 的接缝判据钉住。
 *   · **只从一个参数取外界**：`renderMetricsIsland(ctx)`，函数体第一行解构。
 *   · 参数的可调范围与默认值**不在这里写死**：`SliderRow` 的 min/max/step 与设置白名单
 *     的 KINDS 一致（改范围要同时看 lib/settings-schema.js —— 那份是唯一真源）；
 *     混合模式的下拉档位直接读那份的 `METRICS_BLEND_VALUES`（只有中文名住在本文件）。
 *   · 关掉总开关时只画总开关 + 一句说明（避免"关着还能拖参数"的错觉）；序列的显隐开关
 *     与宿主实际拿得到的指标是两回事：宿主拿不到的那条**不会画**，开关留着不算错。
 *
 * 控件顺序按「先定位置与形状、再定观感、最后定画什么」排：高度 / 水平偏移 / 垂直偏移（整块的
 * 位置与大小）→ 柱宽 / 柱间距 / 行间隔（柱形）→ 阈值 / 细白横线（标尺）→ 不透明度 / 混合模式
 * （自动档下再跟极黑柱不透明度）/ 荧光 / 平滑 / 时间窗（观感）→ 实心柱 / 描边宽度 / 配色
 * （「分色」档下再跟五条序列的取色器）→ 序列名称（压在柱子上那行字）→ 五条序列的显隐。
 */

/** 配色档（与 lib/settings-schema.js 的 METRICS_COLOR_MODE_VALUES 逐字对齐）。
 *  文案写成 **getter**：既让 `weT(...)` 是这些字面量的"最内层调用帧"（test/verify-i18n.mjs
 *  的判据 ① 认这个形态），又保证取译文发生在**渲染时** —— 直接写 `label: "…"` 会被判成
 *  裸中文，写成顶层 `weT("…")` 又会撞内联后的 TDZ（见 docs/CODE-STRUCTURE.md 的模块纪律）。 */
const METRICS_COLOR_MODES = [
  { id: 'accent', get label() { return weT("跟随主题色"); }, get hint() { return weT("每根柱子都用外观里的主题色"); } },
  { id: 'spectrum', get label() { return weT("分色"); }, get hint() { return weT("每条序列用下面为它选的颜色"); } },
  { id: 'mono', get label() { return weT("单色"); }, get hint() { return weT("同色，靠亮度区分"); } },
];

/** 混合模式的档位中文名（键 = lib/settings-schema.js 的 `METRICS_BLEND_VALUES` 的**原值**）。
 *  档位本身直接读那份常量（唯一真源），这里只放"值 → 屏上文字"的映射；
 *  同一条 getter 理由（见配色档注释）。`auto` 的说明见下面那句 hint。 */
const METRICS_BLEND_LABELS = {
  get auto() { return weT("自动"); },
  get normal() { return weT("正常"); },
  get multiply() { return weT("正片叠底"); },
  get overlay() { return weT("叠加"); },
  get screen() { return weT("滤色"); },
  get 'soft-light'() { return weT("柔光"); },
  get darken() { return weT("变暗"); },
  get lighten() { return weT("变亮"); },
};

/**
 * 扩展岛：总开关 → 位置与大小（高度 / 水平偏移 / 垂直偏移）→ 柱形（柱宽 / 柱间距 / 行间隔）→
 * 阈值 / 细白横线 → 观感（不透明度 / 混合模式 + 自动档下的极黑柱不透明度 / 荧光 / 平滑 / 时间窗）
 * → 柱形与配色（+ 分色档下的五条取色器）→ 序列名称 → 五条序列的显隐。
 * @param {{sel:object}} ctx 见文件头契约
 */
function renderMetricsIsland(ctx) {
  const { sel, onMetricsEnabled, onMetricsHeight, onMetricsOffsetX, onMetricsOffsetY,
    onMetricsBarWidth, onMetricsBarGap,
    onMetricsStackGap, onMetricsThreshold, onMetricsOpacity, onMetricsLineWidth, onMetricsGlow,
    onMetricsSmooth, onMetricsWindow, onMetricsFill, onMetricsColorMode, onMetricsLabels,
    onMetricsGuides, onMetricsBlend, onMetricsDeepOpacity, onMetricsColor,
    onMetricsSeries } = ctx;
  const on = sel.metricsEnabled === true;
  // 混合模式的**有效值**：非法/缺失一律按 `auto`（与下面那个 select 的 value 同一条规则，只算一次）。
  // 极黑档的倍率只在自动档下有意义 ⇒ 那一行跟着它显隐（手选任何档时它消失，免得让人以为还有用）。
  const blendMode = METRICS_BLEND_VALUES.indexOf(sel.metricsBlend) >= 0 ? sel.metricsBlend : "auto";
  return React.createElement(React.Fragment, null,
    switchRow(weT("启用资源柱状图"), on, onMetricsEnabled, { key: "metrics-on" }),
    React.createElement("span", { className: "we-picker__hint", key: "metrics-what" },
      weT("在屏幕下方居中叠加随时间流动的荧光柱状图：只有柱子，没有刻度、表头与坐标轴")),
    on && SliderRow(weT("高度"), 40, 320, 1, sel.metricsHeight, onMetricsHeight, "px", "metrics-height"),
    // 位置（用户口径："允许设置其位置（左右、上下偏移）"）：在"居中 + 四边留白"的基础上整块挪。
    // 负值是常态（左 / 下），所以三个范围都对称给到 ±400；越界由画布层钳回留白内。
    on && SliderRow(weT("水平偏移"), -400, 400, 1, sel.metricsOffsetX, onMetricsOffsetX, "px", "metrics-off-x",
      { tooltip: weT("正值向右，负值向左") }),
    on && SliderRow(weT("垂直偏移"), -400, 400, 1, sel.metricsOffsetY, onMetricsOffsetY, "px", "metrics-off-y",
      { tooltip: weT("正值向上，负值向下") }),
    on && SliderRow(weT("柱宽"), 1, 16, 1, sel.metricsBarWidth, onMetricsBarWidth, "px", "metrics-bar-w"),
    on && SliderRow(weT("柱间距"), 0, 16, 1, sel.metricsBarGap, onMetricsBarGap, "px", "metrics-bar-gap"),
    on && SliderRow(weT("指标间隔"), 0, 40, 1, sel.metricsStackGap, onMetricsStackGap, "px", "metrics-gap"),
    on && SliderRow(weT("阈值"), 0, 100, 1, sel.metricsThreshold, onMetricsThreshold, "%", "metrics-threshold"),
    on && React.createElement("span", { className: "we-picker__hint", key: "metrics-threshold-hint" },
      weT("按各指标满格的比例算，超过就标红（0 = 不标红）")),
    // 细白横线：纯粹是标尺（每行 50% 高度一条 + 每两行之间一条），画在**单独一层**里 ——
    // 以后做"随光标位置响应的 3D 纵深"时它要能跟柱子分开动（见 src/metrics-layer.js 文件头）。
    on && switchRow(weT("细白横线"), sel.metricsGuides !== false, onMetricsGuides,
      { key: "metrics-guides", hint: weT("每行 50% 高度一条、每两行之间一条（单独一层画，不跟随柱子的混合模式）") }),
    on && SliderRow(weT("不透明度"), 10, 100, 1, sel.metricsOpacity, onMetricsOpacity, "%", "metrics-opacity"),
    // 混合模式：8 档平铺会挤成一团（.we-picker__seg 是等分宽度的）⇒ 用下拉，与「适配目标」同一形态。
    on && React.createElement("div", { className: "we-picker__ctl", key: "metrics-blend" },
      ctlText(weT("混合模式"), weT("与壁纸的融合方式：自动会按壁纸明暗切换（亮背景用正片叠底、暗背景用叠加、极黑背景用变亮并把柱子透明度按下面的设置压低）；采不到壁纸画面时退回上一次手选的档")),
      React.createElement("select", {
        className: "we-picker__select",
        "aria-label": weT("混合模式"),
        value: blendMode,
        onChange: onMetricsBlend,
      },
        METRICS_BLEND_VALUES.map((v) =>
          React.createElement("option", { key: v, value: v }, METRICS_BLEND_LABELS[v]),
        ),
      ),
    ),
    // 极黑档的倍率（用户口径："该值也允许自定义"）：**只在自动档出现** —— 别的档根本不会判极黑。
    on && blendMode === 'auto' && SliderRow(weT("极黑柱不透明度"), 10, 100, 1, sel.metricsDeepOpacity,
      onMetricsDeepOpacity, "%", "metrics-deep-opacity",
      { tooltip: weT("自动档判定为极黑背景时，柱子只剩这个不透明度（100% = 不减）") }),
    on && SliderRow(weT("荧光强度"), 0, 100, 1, sel.metricsGlow, onMetricsGlow, "%", "metrics-glow"),
    on && SliderRow(weT("平滑"), 0, 100, 1, sel.metricsSmooth, onMetricsSmooth, "%", "metrics-smooth"),
    on && SliderRow(weT("时间窗"), 20, 240, 10, sel.metricsWindow, onMetricsWindow, "s", "metrics-window"),
    on && switchRow(weT("实心柱"), sel.metricsFill === true, onMetricsFill,
      { key: "metrics-fill", hint: weT("关掉只画柱子的轮廓") }),
    on && SliderRow(weT("描边宽度"), 1, 5, 0.5, sel.metricsLineWidth, onMetricsLineWidth, "px", "metrics-line"),
    on && React.createElement("div", { className: "we-picker__ctl", key: "metrics-color-mode" },
      ctlText(weT("柱配色"), weT("柱子的取色方式")),
      React.createElement("div", { className: "we-picker__seg" },
        METRICS_COLOR_MODES.map((m) =>
          React.createElement("button", {
            key: m.id,
            className: "we-picker__btn we-picker__rate" + (sel.metricsColorMode === m.id ? " we-picker__rate--active" : ""),
            type: "button",
            title: m.hint,
            onClick: () => onMetricsColorMode(m.id),
          }, m.label),
        ),
      ),
    ),
    // 五条序列各自的颜色：**只在「分色」档出现**（别的档一根柱子用什么色由主题/亮度决定，
    // 在这里放五个取色器只会让人以为它们总是生效）。预设圆点就是原来的出厂色相 ⇒ 逐像素不变。
    on && sel.metricsColorMode === 'spectrum' && METRICS_SERIES.map((s) =>
      swatchRow(weT("{label}颜色", { label: s.label }), METRICS_SERIES.map((d) => d.hue), sel[s.colorKey],
        (v, live) => onMetricsColor(s.colorKey, v, live),
        { key: "metrics-color-" + s.id, colorValue: s.hue }),
    ),
    on && switchRow(weT("序列名称"), sel.metricsLabels !== false, onMetricsLabels,
      { key: "metrics-labels", hint: weT("在每行居中用「外观」里设置的字体画出该行名称（英文缩写，加粗、上深下浅渐变、与行等高）") }),
    on && METRICS_SERIES.map((s) =>
      switchRow(s.label, sel[s.key] === true, (e) => onMetricsSeries(s.key, e.target.checked),
        { key: "metrics-series-" + s.id }),
    ),
    on && React.createElement("span", { className: "we-picker__hint", key: "metrics-avail" },
      weT("宿主取不到的指标不会画出来（例如没有 N 卡、或没有性能计数器权限时）")),
  );
}

/** 「扩展」页签的一号模块（注册表项；`id` 是 React key，改它会让面板重挂一次）。
 *  `title` / `desc` 与上面的配色档同一条理由写成 getter（见那份注释）。 */
const METRICS_EXTENSION_MODULE = {
  id: 'metrics',
  get title() { return weT("硬件资源监控柱状图"); },
  get desc() { return weT("屏幕底部的实时资源柱状图（CPU / 内存 / 显卡 / 网络 / 磁盘）"); },
  render: renderMetricsIsland,
};

export { METRICS_EXTENSION_MODULE, renderMetricsIsland };
