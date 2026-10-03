/**
 * metrics-layer.js — 「硬件资源监控柱状图」的**画布层**：屏幕下方居中的那几行随时间步进的荧光柱。
 *
 * ══ 为什么是这样一个角色 ══════════════════════════════════════════════════════
 * 它是**基座模块**（见 docs/CODE-STRUCTURE.md §3.1）：不吃 ctx、直接读扁平设置 store
 * `selection`，和 `video-layer` / `effects` 同层 —— 因为它的驱动源不是某次渲染，而是
 * 一个 rAF 循环（采样节奏 1 Hz 挂在同一帧上）。渲染器给它传 ctx 反而要把每个设置项
 * 穿一遍，且拖动滑块时的"即时反馈"会多绕一圈 emit。
 *
 * 数据来自宿主采样器（`lib/metrics.js` ← `GET ${BASE}/metrics`）：每条序列是一串
 * 已经归一化好的百分比/字节数，**时间窗与采样节奏都由宿主定**（`intervalMs`）。
 * 本层只做三件事：拉、存（本地的环形副本）、画。
 *
 * ══ 布局（用户口径）══════════════════════════════════════════════════════════
 *   · **一条序列 = 一行**（band）：行内是一串等宽的柱子，一格一次采样 ⇒ **步进柱状图**，
 *     整点换一格、不再有亚采样的连续滑动。
 *   · **居中且四边留白**：整块默认水平居中（不是贴住右缘）、底边离屏幕下缘 `METRICS_EDGE` px，
 *     高度也钳到 `视口高 − 2 × METRICS_EDGE` ⇒ 四边都不贴屏 —— 这是一块装饰，贴边反而像
 *     "窗口的一部分"。留白是**常量**（不是设置项）：它服务的是观感，不该再多一个旋钮。
 *     在居中的基础上，位置还能被 `metricsOffsetX` / `metricsOffsetY`（px，可负）**整体挪**
 *     （用户口径："允许设置其位置"）；挪出屏外会被钳回留白之内 —— 偏移是微调，不该能把
 *     装饰挪丢。
 *   · **上下拼接**：行按 `METRICS_SERIES` 的顺序自上而下排，行与行之间留
 *     `metricsStackGap` px；行高 = (总高 − 全部间隔) / 行数 ⇒ 加一条序列，大家都矮一点。
 *   · **长宽可自定义**：高 `metricsHeight`（px，整块高度），宽 `metricsBarWidth`（px，一格
 *     的宽度），行内柱子之间留 `metricsBarGap` px（"图柱之间要有间隔"，用户口径）。
 *     整块宽度 = 格数 × 柱宽 + 全部柱间距（**最少两格、最多一屏减两侧留白**）——
 *     "想看多久的历史"由时间窗定，"每格多粗 / 隔多远"由柱宽与柱间距定。
 *   · **只画柱子**（没有刻度、表头、坐标轴、网格），整块不透明度走 `metricsOpacity`；
 *     另有一层**序列名称**（`metricsLabels`）：每行居中、加粗、与那一行等高，字体与文字色
 *     都取「外观」页签里那套设置（见 metricsRowLabel / metricsLabelStyle），字面是**英文
 *     缩写**（CPU / RAM / GPU / NET / DISK，见 METRICS_SERIES.tag —— 这是屏上的标注，不随
 *     界面语言变），并且**从上到下渐变**：上部 `METRICS_LABEL_ALPHA`、下部全透明。
 *     名称画在**独立的一层**上（`METRICS_LABEL_HOST_ID`，不参与混合）：主题字色接近纯白，
 *     留在参与混合的柱层里会被正片叠底乘没（用户口径"标注文字难以辨别"）；字色的**亮度**
 *     另外钳进 20%–80%（`METRICS_INK_MIN` / `METRICS_INK_MAX`，见 metricsClampInk）。
 *   · **阈值**：比值超过 `metricsThreshold`(%) 的柱子换成告警红（0 = 关闭），只改颜色、不改几何。
 *   · **颜色**：跟随主题色（`accent`）/ 每条序列用**自己在面板里选的颜色**（`spectrum`，见
 *     `metricsColor*` 五键，默认 = 原来的固定色相）/ 单色（`mono`，往白里提一档区分行）。
 *   · **与壁纸的混合**（`metricsBlend`，用户口径："亮背景用正片叠底，暗背景用叠加"）：
 *     值是 CSS `mix-blend-mode` 的字面量。`auto` 由本层**采样壁纸像素**逐段判明暗（亮 →
 *     `multiply`、暗 → `overlay`、**极黑 → `lighten` 且柱层不透明度 ×`metricsDeepOpacity`**，
 *     见 METRICS_LUMA_DEEP —— 黑底上只有"变亮"能让柱子原色直出，但全量变亮会糊成一条光带）
 *     —— `mix-blend-mode` 是元素级的、做不到逐像素换档，所以
 *     把整块横着切成若干段（≤ `METRICS_BAND_MAX`），**每段按它自己背后那截画面定档**
 *     （用户口径："自动识别背景亮度大于/小于 50% 的区域"）；段边界按柱子分组（见 metricsBands），
 *     永远不会把一根柱子切成两半。某段采不到（网页 / 场景壁纸是 iframe、跨源）就退回上一次
 *     手选的档。**所以柱层是"一段一个宿主"**（手动档恒 1 段）。
 *     ⚠️ 判据用的是**实际显示亮度**而不是壁纸原图的亮度：探针读到的是原图像素（`drawImage`
 *     不吃 CSS filter、也看不见暗化层），而用户看到的是"原图 × 本插件自己的效果" ——
 *     中间隔着 `backgroundBrightness/Contrast`、`wallpaperOpacity`（+ 淡出底色）与暗化 `scrim`，
 *     全部由 `metricsDisplayLuma` 逐步还原（用户口径："先获取当前插件中设置的相关值，基于这些
 *     值计算出该区域背景的实际显示亮度，再基于此亮度判断亮暗区"）。
 *   · **细白横线**（`metricsGuides`）：每行 50% 高度一条 + 每两行之间一条 —— 它们是**标尺**，
 *     与柱子/行名**分层绘制**（各自一个宿主 + 各自一张画布 + 各自一份签名），所以：
 *     ① 柱层每秒钟换一帧、名称层与标尺层只在几何/字色变时才重画；② 名称层与标尺层都不跟随
 *     柱层的混合模式（正片叠底会把白线白字乘没 —— 白线对亮/暗背景都要看得见）；
 *     ③ 以后要做"随光标位置响应的 3D 纵深"时，三层可以各自 transform（这正是用户提的
 *     "把标注文字/图柱和细白横线解耦"）。
 *     DOM 顺序恒为 柱层各段 → 名称层 → 标尺层。
 *
 * 契约：
 *   需要的外界：`selection`（设置 store，只读）、`apiJson`（唯一网络出入口）。
 *   对外提供：`syncMetricsLayer()`（设置变了 / 壁纸层变了就调一次）、
 *             `disposeMetricsLayer()`（卸载清理）。
 *   设置项（`metrics*`，真源 lib/settings-schema.js）：启用 / 高度 / 水平偏移 / 垂直偏移 /
 *   柱宽 / 柱间距 / 行间隔 / 阈值 / 细白横线 / 不透明度 / 混合模式 / 描边宽度 / 荧光 / 平滑 /
 *   时间窗 / 实心 / 配色档 / 五条序列的颜色 / 序列名称 / 五条序列的显隐。
 *
 * 不变量：
 *   · **只读 `selection`**：一个字节都不写（裸写棘轮只留给 media-prep / effects / live-layer）。
 *     拖动滑块时的即时反馈靠"每帧重读设置 + 画前比一次签名"，不靠写回。
 *   · **零顶层可执行语句**：本文件的顶层只有声明 —— 读 `selection` 的语句一律在函数里
 *     （内联后 prelude 早于 `src/client.js` 正文求值，顶层读它必撞 TDZ）。
 *   · **挂了才活**：`metricsEnabled` 关掉、或五条序列全关、或没有壁纸层 ⇒ 立刻停
 *     rAF、把全部宿主都摘掉（不留空节点、不留定时器）。宿主那边也因此 30 s 后自停采样。
 *   · **失败不响**：网络失败 / 宿主返回不可用 / 采样壁纸像素失败（跨源污染）⇒ 保持上一帧、
 *     不刷日志、不抛。它是装饰，不该因为它把 DSH 的控制台或设置流程弄脏。（宿主侧同样：
 *     PDH 腿失败只退场。`/?s=` 只带 cpu,mem 的请求不会把常驻 `typeperf` 拉起来。）
 *   · **画在壁纸之上、界面之下**：全部宿主都是 `position: fixed; z-index: -1`，水平居中、
 *     底边留 `METRICS_EDGE` px（left / bottom 每帧内联写下去），DOM 排在 scrim 之后 ⇒
 *     压过 scrim（-1 同层靠文档序）但仍在全部界面元素之下。⚠️ 这个"之后"是**每帧核对**的：
 *     scrim 是壁纸激活时才挂的，本层若先起就会被它罩住（见 metricsRaiseAboveScrim）。
 *     同层内的文档序恒为 柱层各段 → 名称层 → 标尺层（白线压在柱子与名称之上，用户口径
 *     "横在每个柱状图 50% 高度上"）；`pointer-events: none` + `-webkit-app-region: initial !important`
 *     （整屏 body 级浮层不得挖掉窗口拖拽区 —— 见 src/styles.js 的 .we-layer 注释与 upstream #120）。
 *   · **混合模式写在段宿主上**：`mix-blend-mode` 必须落在**整块**（或段的整块）那一层 ——
 *     落在画布上会被宿主的 stacking context 隔成"只在块内混合"（等于不生效）。宿主因此是
 *     "透明容器 + 混合 + 不透明度"，各张画布只负责自己那一段的像素。
 *   · **归一化口径固定**：每行用一个**固定满格值**（宿主下发的 `series[].scale`）把值折成
 *     0..1，不按当前数据自适应 —— 否则"变安静"和"变忙"看起来一样。柱高因此是"占满格的
 *     几成"，跨行可比、跨时刻可比。
 *   · **不做动态降级**：柱状图每秒才换一格，没有需要收敛的连续动画（旧的"减少动态效果"
 *     分支随曲线一起删掉了）。
 */

const METRICS_HOST_ID = 'we-metrics-layer';
/** 序列名称那一层的宿主（与柱层**分开**：名称是一整段文字，落在柱层里就会被分段切开）。 */
const METRICS_LABEL_HOST_ID = 'we-metrics-labels';
/** 细白横线那一层的宿主（与柱层**分开**：见文件头的"解耦"口径）。 */
const METRICS_GUIDE_HOST_ID = 'we-metrics-guides';
const METRICS_POLL_MS = 1000;
const METRICS_DPR_MAX = 2;
/** 颜色解析失败的兜底（= 默认主题色）。 */
const METRICS_FALLBACK_COLOR = '#4f8cff';
/** 超过阈值的柱子用的告警红（只换颜色，几何不变）。 */
const METRICS_HOT_COLOR = '#ff4d4f';
/** 细白横线的不透明度（常量、不是设置项：它只是标尺，多一个旋钮只会让人把它调丢）。 */
const METRICS_GUIDE_ALPHA = 0.35;
/** 柱宽与行/柱间隔的上限（与 lib/settings-schema.js 的 KINDS 对齐；画之前仍钳一次）。 */
const METRICS_BAR_W_MAX = 16;
const METRICS_GAP_MAX = 40;
const METRICS_BAR_GAP_MAX = 16;
/** 四边留白（px，常量）：整块居中、底边也不贴屏 —— 装饰贴边会让它看起来像窗口的一部分。 */
const METRICS_EDGE = 20;
/** 位置偏移的上限（px，正负都算）：与 lib/settings-schema.js 的 KINDS 对齐。 */
const METRICS_OFFSET_MAX = 400;
/** 序列名称的不透明度（用户口径 30%：压在被叠的柱子上，认得出来但不抢戏）。
 *  这是**渐变的上端**（下端恒为全透明，见 metricsRowLabel）。 */
const METRICS_LABEL_ALPHA = 0.3;
/** 低于这个行高就不画名称（字小到只剩噪点）；见 metricsRowLabel。 */
const METRICS_LABEL_MIN_PX = 8;
/** `metricsBlend: 'auto'` 的三档：亮背景压暗、暗背景提亮（用户口径的两个例子），
 *  外加**极黑背景**这一档（变亮 + 柱层按 `metricsDeepOpacity` 压低，见 METRICS_LUMA_DEEP）。 */
const METRICS_BLEND_LIGHT = 'multiply';
const METRICS_BLEND_DARK = 'overlay';
const METRICS_BLEND_NIGHT = 'lighten';
/** `auto` 判明暗的分界（平均相对亮度 0..1，sRGB 加权 —— 与 live-layer 的探针同一口径）。 */
const METRICS_LUMA_SPLIT = 0.5;
/** 「极黑背景」的上限：显示亮度低于它就按最黑的一档画。为什么要单开一档：
 *  纯黑底上正片叠底等于把柱子乘没（`multiply` × 0 = 0），叠加也只是勉强提亮，只有 `lighten`
 *  （逐通道取较大值）能让柱子**原色直出**；但全量的变亮在黑底上亮得发糊、整块糊成一条光带，
 *  所以同时把**柱层**的不透明度按 `metricsDeepOpacity` 压低（用户口径："对于极黑的背景，自动
 *  模式应使用'变亮' + 图柱透明度 -50% 的策略"，随后又要求那个 -50% **可自定义**）。
 *  阈值是观感取值（0..1）、不是物理量：默认的暗化还会把壁纸再压一截，极黑的壁纸显示亮度
 *  通常落在 0.1 以下；它必须**远低于** METRICS_LUMA_SPLIT，否则"暗档"就被它吃掉了。 */
const METRICS_LUMA_DEEP = 0.15;
/** 采样探针的**列数上限**（px）：探针是 `段数 × 1` 的一行像素（下一行给出理由），
 *  段数再多也不超过这个数 —— 只为判"这一段亮还是暗"，越小越便宜。 */
const METRICS_LUMA_SAMPLE_PX = 24;
/** 采样的节流（ms）：视频壁纸的亮度一直在变，但不值得每帧读一次像素。 */
const METRICS_LUMA_TTL_MS = 2000;
/** 自动档**分段判明暗**的段数上限（每段一个宿主 + 一种混合模式）。
 *  CSS 的 `mix-blend-mode` 是**元素级**的，做不到逐像素换档 ⇒ 把整块横着分成若干段，
 *  每段按**它自己背后那截壁纸**的亮度选档（用户口径："明区正片叠底、暗区叠加"）。
 *  段越多越贴合画面，但每段都得单独合成 ⇒ 8 段是观感与代价的折中。
 *  段边界**按柱子分组**（见 metricsBands），永远不会把一根柱子切成两半。 */
const METRICS_BAND_MAX = 8;
/** 标注文字的亮度上下限（用户口径 20%–80%）：字色仍由「外观」那套设置给，
 *  只把它的**亮度**钳进这个区间 —— 全白在正片叠底下会被乘没、全黑在暗背景的叠加下起不来。
 *  本层因此把名称画在**不参与混合**的独立一层上（见 METRICS_LABEL_HOST_ID）。 */
const METRICS_INK_MIN = 0.2;
const METRICS_INK_MAX = 0.8;

/**
 * 五条序列：`id` 与宿主 `lib/metrics.js` 的 SERIES 对齐，`key` 是它在 settings 里的
 * 显隐开关，`colorKey` 是**这条序列自己的颜色**（`metricsColor*`，只在「分色」档生效），
 * `hue` 是那个颜色的出厂值（= 用户还没进面板改过时的画面，也是取色器里的预设圆点），
 * `label` 是**面板开关的名字**（中英随界面语言，
 * 所以写成 **getter** —— `weT(...)` 因此是这些字面量的最内层调用帧（test/verify-i18n.mjs
 * 判据 ①），且取译文发生在**渲染时**；顶层 `weT(...)` 会撞内联后的 TDZ，直接写中文会被
 * 判裸中文）。
 * `tag` 是**屏上的标注文字**（画布层在 `metricsLabels` 打开时居中压在该行上）：固定英文
 * 缩写、纯 ASCII 常量，不随界面语言变（用户口径："使用英文标注，如 CPU、RAM、GPU"）——
 * 它是图形的一部分，跟壁纸一样不该被界面语言改写，所以**不进词表**。
 * 数组顺序 = 屏上自上而下的行序。
 */
const METRICS_SERIES = [
  { id: 'cpu', key: 'metricsShowCpu', colorKey: 'metricsColorCpu', hue: '#4f8cff', tag: 'CPU', get label() { return 'CPU'; } },
  { id: 'mem', key: 'metricsShowMem', colorKey: 'metricsColorMem', hue: '#35d07f', tag: 'RAM', get label() { return weT("内存"); } },
  { id: 'gpu', key: 'metricsShowGpu', colorKey: 'metricsColorGpu', hue: '#ff5c8a', tag: 'GPU', get label() { return weT("显卡"); } },
  { id: 'net', key: 'metricsShowNet', colorKey: 'metricsColorNet', hue: '#ffb020', tag: 'NET', get label() { return weT("网络"); } },
  { id: 'disk', key: 'metricsShowDisk', colorKey: 'metricsColorDisk', hue: '#a06bff', tag: 'DISK', get label() { return weT("磁盘"); } },
];

/** 画布层的运行时状态（全部是本模块私有的：没有一处来自 ctx）。 */
/** 柱层：**一段一条**（手动档恒为 1 段；自动档按壁纸明暗分段，见 METRICS_BAND_MAX）——
 *  每条 = 一个宿主 + 一张画布 + 一份重绘签名（`left` / `right` 是它在整块里的像素区间）。 */
let metricsHosts = [];
/** 序列名称那一层（不参与混合：见 METRICS_INK_MIN 的注释）。 */
let metricsLabelHost = null;
let metricsLabelCanvas = null;
let metricsLabelKey = '';
/** 细白横线那一层（与柱层分开，见文件头"解耦"口径）。 */
let metricsGuideHost = null;
let metricsGuideCanvas = null;
let metricsGuideKey = '';
let metricsFetchedAt = 0;
let metricsRaf = 0;
let metricsData = null;
let metricsDataAt = 0;
let metricsIntervalMs = METRICS_POLL_MS;
let metricsLastW = 0;
let metricsLastH = 0;
let metricsPaintKey = '';
let metricsAccent = '';
let metricsLabel = null;
/** `metricsBlend: 'auto'` 的最近一次判定结果；也是"采不到就退回"的那一档（初值 = 暗背景档）。 */
let metricsBlendLast = METRICS_BLEND_DARK;
/** 采样壁纸明暗的缓存：`metricsLumaRead` 为真表示"采过了"。
 *  `metricsLumaRaw` 是**壁纸自己的**平均亮度（按段，null = 那一段采不到），
 *  `metricsLuma` 是同一份数据过完 `metricsDisplayLuma`（本插件自己的滤镜 / 暗化 / 壁纸透明度）
 *  之后的**实际显示亮度** —— 判明暗用的是后者（用户口径：见 metricsDisplayLuma）。
 *  `metricsLumaKey` 是缓存对应的段数 + 整块位置（见 metricsLumaKeyOf），键变了就得重采；
 *  `metricsLumaSig` 是那份"显示亮度"对应的设置签名，设置一动（哪怕还没到 TTL）就重算。 */
let metricsLuma = null;
let metricsLumaRaw = null;
let metricsLumaKey = '';
let metricsLumaSig = '';
let metricsLumaAt = 0;
let metricsLumaRead = false;
/** 壁纸淡出底色（`--we-wallpaper-fade-bg`：浅色纯白 / 深色纯黑）的亮度 —— 只在采样时解析一次
 *  （`getComputedStyle` 是强制同步样式计算，别每帧跑），见 metricsFadeBaseLuma。 */
let metricsFadeLuma = 0;
/** 采样探针画布（只造一次；`auto` 档判明暗用）。 */
let metricsProbe = null;

/** 单调时钟（采样节奏的闸门用它；`performance.now()` 缺席时退到 `Date.now()`）。 */
function metricsNow() {
  return window.performance && window.performance.now ? window.performance.now() : Date.now();
}

/** 数字入域（设置项的值来自 store，理论上已被 sanitize，但画之前仍钳一次）。 */
function metricsClamp(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return n < lo ? lo : n > hi ? hi : n;
}

/** `#rgb` / `#rrggbb` / `rgb()` → {r,g,b}；认不出来返回 null。 */
function metricsParseColor(text) {
  const s = String(text || '').trim();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (m) {
    const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s);
  if (rgb) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  return null;
}

/** `rgb(...)` / `rgba(...)` 字符串（画布用，带 alpha）。 */
function metricsRgba(color, alpha) {
  const c = metricsParseColor(color) || metricsParseColor(METRICS_FALLBACK_COLOR);
  const a = Math.max(0, Math.min(1, alpha));
  return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
}

/** 往白里混一点（单色档靠亮度区分各行）。 */
function metricsLighten(color, amount) {
  const c = metricsParseColor(color) || metricsParseColor(METRICS_FALLBACK_COLOR);
  const t = Math.max(0, Math.min(1, amount));
  const mix = (v) => Math.round(v + (255 - v) * t);
  return 'rgb(' + mix(c.r) + ',' + mix(c.g) + ',' + mix(c.b) + ')';
}

/** {r,g,b}(0..255) → {h: 0..360, s: 0..1, l: 0..1}。 */
function metricsToHsl(c) {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l: l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s: s, l: l };
}

/** {h,s,l} → `rgb(...)`（画布用）。 */
function metricsFromHsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = l - c / 2;
  return 'rgb(' + Math.round((r + m) * 255) + ',' + Math.round((g + m) * 255)
    + ',' + Math.round((b + m) * 255) + ')';
}

/**
 * 标注文字的亮度钳制（用户口径：亮度限制在 20%–80%）。
 * 色相与饱和度原样保留、只把 HLS 的 l 钳进区间 —— 全白 ⇒ 80% 的灰、全黑 ⇒ 20% 的灰，
 * 于是同一个字色在亮背景（正片叠底）与暗背景（叠加）下都还看得出来。
 * 认不出来的颜色原样返回（调用处自己决定要不要画）。
 */
function metricsClampInk(color) {
  const c = metricsParseColor(color);
  if (!c) return color;
  const hsl = metricsToHsl(c);
  const l = Math.min(METRICS_INK_MAX, Math.max(METRICS_INK_MIN, hsl.l));
  if (l === hsl.l) return color;
  return metricsFromHsl(hsl.h, hsl.s, l);
}

/** 主题色：优先读运行时令牌 `--we-accent`（applyEffects 写的），读不到才用兜底。 */
function metricsResolveAccent() {
  if (metricsAccent) return metricsAccent;
  try {
    const v = window.getComputedStyle(document.body).getPropertyValue('--we-accent');
    metricsAccent = (v && v.trim()) || METRICS_FALLBACK_COLOR;
  } catch (e) {
    metricsAccent = METRICS_FALLBACK_COLOR;
  }
  return metricsAccent;
}

/**
 * 序列名称用的字族与文字色（用户口径："使用壁纸插件中设置的字体…字的颜色也与壁纸插件中
 * 设置的字体颜色相同"）。那套设置**不是**本模块自己的键，而是字体系统写进 DSH 令牌层的结果
 * （见 src/font/typography.js 写 `--dsw-font-<角色>-font-family`、src/font/color-roles.js 写
 * `--dsw-alias-label-*`）⇒ 读 computed 自定义属性就是读"用户当前看到的那套字体"。
 * 先按最像"正文"的角色取，再退到 DSH 基础字族与 body 的 computed 字色；**取不到就返回空色**，
 * 调用处会因此整段不画名称 —— 它是装饰，不值得为它猜一个颜色（浅色主题下猜白等于看不见）。
 * 结果缓存（读 computed 是布局相关操作），syncMetricsLayer 里作废。
 */
function metricsLabelStyle() {
  if (metricsLabel) return metricsLabel;
  let family = '';
  let color = '';
  try {
    const cs = window.getComputedStyle(document.body);
    family = (cs.getPropertyValue('--dsw-font-markdown-base-font-family') || '').trim()
      || (cs.getPropertyValue('--dsw-font-family') || '').trim()
      || cs.fontFamily || '';
    color = (cs.getPropertyValue('--dsw-alias-label-primary') || '').trim() || cs.color || '';
  } catch (e) { /* 取不到就留空：下面按"能不画就不画"处理 */ }
  metricsLabel = {
    family: family || 'system-ui, sans-serif',
    color: metricsParseColor(color) ? color : '',
  };
  return metricsLabel;
}

/** 当前该请求哪几条序列（显隐 + 顺序都来自设置）。 */
function metricsWanted() {
  const ids = [];
  for (const s of METRICS_SERIES) {
    if (selection[s.key]) ids.push(s.id);
  }
  return ids;
}

/**
 * 手选的档：`metricsBlend` 不是 `auto` 且认得出来就返回它，并记进 `metricsBlendLast`
 * （= "上一次手选的档"，采不到时的兜底就是它）；`auto` 返回 null。
 */
function metricsManualBlend() {
  const want = String(selection.metricsBlend || 'auto');
  if (want !== 'auto' && METRICS_BLEND_VALUES.indexOf(want) >= 0) {
    metricsBlendLast = want;
    return want;
  }
  return null;
}

/** 亮度 → 档：亮 → 正片叠底（把亮壁纸压暗，柱子才不会糊成一片）、暗 → 叠加（往亮里推）、
 *  极黑 → 变亮 + 柱层按 `metricsDeepOpacity` 压低（`dim`）。传进来的是**实际显示亮度**
 *  （metricsSampleLuma 已过 metricsDisplayLuma），不是原图亮度。
 *  返回 `{ mode, dim }` 而不是裸字符串：`dim` 只由**这条极黑规则**产生 —— 手选「变亮」是用户
 *  自己的选择，不该被顺手压低（所以判据不能拿 `mode === 'lighten'` 当"极黑档"的开关）。 */
function metricsBlendForLuma(luma) {
  if (luma < METRICS_LUMA_DEEP) return { mode: METRICS_BLEND_NIGHT, dim: true };
  return { mode: luma > METRICS_LUMA_SPLIT ? METRICS_BLEND_LIGHT : METRICS_BLEND_DARK, dim: false };
}

/** 采不到时的兜底档（= 上一次手选的档）：**永远不压低**（它不是极黑判定的产物）。 */
function metricsBlendFallback() {
  return { mode: metricsBlendLast, dim: false };
}

/** 整块一档：按整块背后的平均亮度判；采不到退回上一次手选的档。 */
function metricsResolveBlend(fracX, fracW) {
  const bands = metricsSampleLuma(1, fracX, fracW);
  const luma = bands && bands.length ? bands[0] : null;
  return luma == null ? metricsBlendFallback() : metricsBlendForLuma(luma);
}

/**
 * 这一帧的**分段**混合方案：返回长度 = 段数的数组，第 i 项是第 i 段该用的档
 * （`{ mode, dim }`，`dim` = 极黑档的"柱层按 `metricsDeepOpacity` 压低"）。
 *   · 手动档 ⇒ 只一段（整块一个档，且不压低 —— 手选的档照原样画）；
 *   · 自动档 ⇒ **每段按它自己背后那截壁纸的亮度**分别定档 —— 这就是用户要的
 *     "明区正片叠底、暗区叠加"（`mix-blend-mode` 是元素级的，逐像素换档做不到，
 *     所以用分段近似，段数与段边界见 METRICS_BAND_MAX / metricsBands）；
 *   · 某段采不到（网页 / 场景壁纸是 iframe、跨源污染、视频还没解出帧）⇒ 那段退回
 *     `metricsBlendLast`（初值 = 暗背景档；暗色是 DSH 的默认观感）。
 * `fracX` / `fracW` 是整块在视口里的水平位置与宽度占比 —— 采的必须是**柱子背后那截**画面。
 */
function metricsBlendPlan(segCount, fracX, fracW) {
  const manual = metricsManualBlend();
  if (manual) return [{ mode: manual, dim: false }];
  const n = Math.max(1, Math.round(segCount));
  if (n <= 1) return [metricsResolveBlend(fracX, fracW)];
  const bands = metricsSampleLuma(n, fracX, fracW);
  if (!bands || !bands.length) return [metricsBlendFallback()];
  return bands.map((l) => (l == null ? metricsBlendFallback() : metricsBlendForLuma(l)));
}

/**
 * 壁纸的媒体叶子：**最后一个在屏上的** `.we-layer` 里的 `.we-media`。
 * 切场期间屏上会有两三层（`--staging` / `--pending` / `--switch-out`）⇒ 取最后一个 = 正在演的那个；
 * 一层都没有（还没铺壁纸）就返回 null。
 */
function metricsBackdropLeaf() {
  try {
    const layers = document.querySelectorAll('.we-layer');
    for (let i = layers.length - 1; i >= 0; i -= 1) {
      const el = layers[i];
      const cls = typeof el.className === 'string' ? el.className : '';
      if (cls.indexOf('--staging') >= 0 || cls.indexOf('--pending') >= 0 || cls.indexOf('--switch-out') >= 0) continue;
      const leaf = el.querySelector('.we-media');
      if (leaf) return leaf;
    }
  } catch (e) { /* 取不到就当没有壁纸：走"退回上一次手选的档" */ }
  return null;
}

/**
 * 壁纸淡出底色（`.we-layer` 垫的那层 `--we-wallpaper-fade-bg`：浅色纯白 / 深色纯黑）的相对亮度。
 * 「壁纸透明度」拉高时媒体叶子是半透明的，剩下那一部分就是它 —— 不算进来，半透明的亮壁纸
 * 会被判成暗背景、档就选反了。只在采样时调用（`getComputedStyle` 是强制同步样式计算，
 * 不能每帧跑）；值可能不是 `#rrggbb`（外壳基色 token 允许任意 CSS 颜色格式）⇒ 认不出就按
 * 主题属性兜底（深色 = 纯黑，与 src/effects.js 的 resolveWallpaperFadeBg 同口径）。
 */
function metricsFadeBaseLuma() {
  try {
    const t = getComputedStyle(document.body).getPropertyValue('--we-wallpaper-fade-bg').trim();
    const c = t ? metricsParseColor(t) : null;
    if (c) return (c.r * 299 + c.g * 587 + c.b * 114) / 1000 / 255;
  } catch (e) { /* 取不到就走下面的主题兜底 */ }
  try {
    return document.body.hasAttribute('data-ds-dark-theme') ? 0 : 1;
  } catch (e) { return 0; }
}

/**
 * 壁纸的**实际显示亮度**（0..1）—— `auto` 档判明暗用的就是它，不是原图亮度。
 * 探针读到的是壁纸**原图**的像素（`drawImage` 不吃 CSS filter，也看不见盖在上面的暗化层），
 * 而用户看到的是"原图 × 本插件自己的效果"。不还原这一步，判据就会选反档：一张 0.62 的亮壁纸
 * 被 0.25 的暗化压到 0.47（其实已经是暗背景），却仍按"亮"走正片叠底 ⇒ 柱子 = 柱色 × 0.47，
 * 糊在背景里（用户反馈："难以辨别……在亮背景上生效正片叠底后再被背景插件的暗化等效果加暗"）。
 * 按 src/effects.js 的下发顺序逐步还原：
 *   ① 媒体叶子的 CSS filter：`brightness()` 是乘法、`contrast()` 绕 0.5 拉伸
 *      （`blur()` / `saturate()` 基本不动平均亮度，略去）；
 *   ② 「壁纸透明度」（#82）：叶子 opacity = (100 − v)/100，其余像素是淡出底色（见上）；
 *   ③ 暗化 scrim：黑色叠层，剩下的乘 `(1 − scrim)`。
 * 默认档（`backgroundBrightness/Contrast` = 100、`wallpaperOpacity` = 0）下只剩 ③ 一步。
 */
function metricsDisplayLuma(raw) {
  if (raw == null) return null;
  let v = raw * (metricsClamp(selection.backgroundBrightness, 40, 160, 100) / 100);
  const contrast = metricsClamp(selection.backgroundContrast, 40, 200, 100) / 100;
  if (contrast !== 1) v = (v - 0.5) * contrast + 0.5;
  v = metricsClamp(v, 0, 1, 0);
  const leafOpacity = (100 - metricsClamp(selection.wallpaperOpacity, 0, 90, 0)) / 100;
  if (leafOpacity < 1) v = v * leafOpacity + metricsFadeLuma * (1 - leafOpacity);
  const scrim = metricsClamp(selection.scrim, 0, 1, 0.25);
  if (scrim > 0) v *= 1 - scrim;
  return metricsClamp(v, 0, 1, 0);
}

/** 上面那一步依赖的设置签名：这些值一动就重算"显示亮度"，不必等采样的 TTL 到点。 */
function metricsDisplaySig() {
  return [
    metricsClamp(selection.backgroundBrightness, 40, 160, 100),
    metricsClamp(selection.backgroundContrast, 40, 200, 100),
    metricsClamp(selection.wallpaperOpacity, 0, 90, 0),
    metricsClamp(selection.scrim, 0, 1, 0.25),
    Math.round(metricsFadeLuma * 100),
  ].join(':');
}

/**
 * 带 TTL 的亮度缓存（读像素要 drawImage + getImageData，别每帧做）。
 * 返回值是**按段的数组**（长度 = n；元素 0..1，null = 那一段采不到），元素是**实际显示亮度**
 * （原图亮度过完 metricsDisplayLuma）；缓存键 `metricsLumaKey` 里带着段数与整块的水平位置 /
 * 宽度占比 —— 段数或整块挪了位就重采。
 */
function metricsSampleLuma(n, fracX, fracW) {
  const count = Math.max(1, Math.round(n));
  const key = metricsLumaKeyOf(count, fracX, fracW);
  const now = metricsNow();
  if (metricsLumaRead && metricsLumaKey === key && now - metricsLumaAt < METRICS_LUMA_TTL_MS) {
    // 缓存命中：不重读像素，但"显示亮度"依赖的设置可能刚被拖过 —— 纯算术，重算一遍。
    const sig = metricsDisplaySig();
    if (sig !== metricsLumaSig) {
      metricsLumaSig = sig;
      metricsLuma = metricsLumaRaw ? metricsLumaRaw.map(metricsDisplayLuma) : metricsLumaRaw;
    }
    return metricsLuma;
  }
  metricsLumaRead = true;
  metricsLumaAt = now;
  metricsLumaKey = key;
  metricsFadeLuma = metricsFadeBaseLuma();
  metricsLumaRaw = metricsReadLuma(count, fracX, fracW);
  metricsLumaSig = metricsDisplaySig();
  metricsLuma = metricsLumaRaw ? metricsLumaRaw.map(metricsDisplayLuma) : metricsLumaRaw;
  return metricsLuma;
}

/** 亮度缓存的键：段数 + 量化过的水平位置/宽度（量化是为了别让一像素的抖动打穿缓存）。 */
function metricsLumaKeyOf(n, fracX, fracW) {
  const q = (v) => Math.round((Number(v) || 0) * 200);
  return n + '@' + q(fracX) + ':' + q(fracW);
}

/**
 * 真的读一次：把壁纸画面**下半部分的、柱子背后那一截**缩到 `n × 1` 的探针画布上，
 * 每个像素就是屏上那一段的平均相对亮度（`(r*299+g*587+b*114)/1000`，与 src/live-layer.js
 * 的探针同一口径）再归一化到 0..1；采不到的段是 null（iframe 壁纸 / 视频还没解出帧 / 跨源污染）。
 * 读到的是**壁纸原图**的亮度：`drawImage` 不经过 CSS filter，也看不到盖在上面的暗化层 ——
 * 判明暗要的是"实际显示亮度"，由 metricsDisplayLuma 接着算（别在这里算，缓存得按原图存）。
 * 只取下半屏：柱子画在屏幕下方，真正压在它背后的是那半张画面；
 * 只取 `fracX`–`fracX + fracW` 那一横条：柱子只占屏幕中间一段，取全宽会把别处的明暗算进来。
 */
function metricsReadLuma(n, fracX, fracW) {
  const leaf = metricsBackdropLeaf();
  if (!leaf) return null;
  const tag = String(leaf.tagName || '').toUpperCase();
  if (tag !== 'VIDEO' && tag !== 'IMG') return null; // 网页 / 场景壁纸是 iframe：采不到像素
  if (tag === 'VIDEO' && !(leaf.readyState >= 2)) return null; // 还没解出第一帧
  try {
    const w = Number(leaf.videoWidth || leaf.naturalWidth || 0);
    const h = Number(leaf.videoHeight || leaf.naturalHeight || 0);
    if (!(w > 0) || !(h > 0)) return null;
    // 一列一段：段数由几何定（≤ METRICS_BAND_MAX），这里再上一道上限把探针钉死在
    // METRICS_LUMA_SAMPLE_PX 列以内（段数上限若哪天调大，探针也不会跟着变宽）。
    const count = Math.max(1, Math.min(METRICS_LUMA_SAMPLE_PX, Math.round(n)));
    const col = Math.max(0, Math.min(1, Number(fracX) || 0));
    const span = Math.max(0.001, Math.min(1 - col, Number(fracW) || 0));
    const sx = Math.min(w - 1, col * w);
    const sw = Math.max(1, Math.min(w - sx, span * w));
    if (!metricsProbe) metricsProbe = document.createElement('canvas');
    metricsProbe.width = count;
    metricsProbe.height = 1;
    const pg = metricsProbe.getContext('2d', { willReadFrequently: true });
    if (!pg) return null;
    pg.clearRect(0, 0, count, 1);
    pg.drawImage(leaf, sx, h / 2, sw, h / 2, 0, 0, count, 1);
    const data = pg.getImageData(0, 0, count, 1).data;
    const out = [];
    for (let i = 0; i < count; i += 1) {
      const o = i * 4;
      if (data[o + 3] < 8) { out.push(null); continue; } // 透明像素不算（画不出内容 ≠ 画面是黑的）
      out.push((data[o] * 299 + data[o + 1] * 587 + data[o + 2] * 114) / 1000 / 255);
    }
    return out;
  } catch (e) {
    return null; // 跨源污染等：当作采不到，退回手动档
  }
}

/** 造**名称层**与**标尺层**两个宿主（柱层的段宿主由 metricsSyncHosts 按需建）。
 *  三层各管一件事：柱层参与混合、名称层**不**参与（亮度已钳在 20%–80%）、标尺层恒 normal。已存在就不动。 */
function metricsEnsureHost() {
  if (metricsLabelHost && metricsLabelHost.isConnected && metricsGuideHost && metricsGuideHost.isConnected) return;
  metricsLabelHost = document.createElement('div');
  metricsLabelHost.id = METRICS_LABEL_HOST_ID;
  metricsLabelHost.className = 'we-metrics we-metrics--labels';
  metricsLabelHost.setAttribute('aria-hidden', 'true');
  metricsLabelCanvas = document.createElement('canvas');
  metricsLabelCanvas.className = 'we-metrics__canvas';
  metricsLabelHost.appendChild(metricsLabelCanvas);
  document.body.appendChild(metricsLabelHost);
  // 细白横线**单独一个宿主**（DOM 排在柱层与名称层之后：同 z-index 靠文档序压在上面）：
  // ① 柱层每秒换帧时它不用跟着重画；② 它不跟随柱层的混合模式（正片叠底会把白线乘没）；
  // ③ 以后做"随光标位置响应的 3D 纵深"时各层可以各自 transform（用户口径的"解耦"）。
  metricsGuideHost = document.createElement('div');
  metricsGuideHost.id = METRICS_GUIDE_HOST_ID;
  metricsGuideHost.className = 'we-metrics we-metrics--guides';
  metricsGuideHost.setAttribute('aria-hidden', 'true');
  metricsGuideCanvas = document.createElement('canvas');
  metricsGuideCanvas.className = 'we-metrics__canvas';
  metricsGuideHost.appendChild(metricsGuideCanvas);
  document.body.appendChild(metricsGuideHost);
  metricsLastW = 0;
  metricsLastH = 0;
  metricsPaintKey = '';
  metricsGuideKey = '';
  metricsLabelKey = '';
}

/**
 * 三族宿主必须画在**暗化层之上**：`.we-metrics` 与 `.we-scrim` 都是 `z-index: -1` 的 body 级
 * 浮层 —— 同 z-index 靠文档序分上下，而 scrim 是**壁纸激活时**才挂上去的。本层若先起
 * （开机就开着扩展、壁纸几秒后才铺上），scrim 会后插 ⇒ 整块被那层黑罩住（用户反馈：
 * "在亮背景上生效正片叠底后再被背景插件的暗化等效果加暗"）。这里把三族按原顺序搬到 scrim
 * 之后；没被压住时一次 DOM 都不动（每帧只花一次 querySelector + compareDocumentPosition）。
 */
function metricsRaiseAboveScrim() {
  const first = metricsHosts.length ? metricsHosts[0].host : metricsLabelHost;
  if (!first || !first.parentNode) return;
  let scrim = null;
  try { scrim = document.querySelector('.we-scrim'); } catch (e) { return; }
  if (!scrim || !scrim.parentNode) return;
  // DOM 位序掩码：2 = preceding（"first 排在 scrim 之前"）⇒ scrim 压着我们，得搬。
  if (!(scrim.compareDocumentPosition(first) & 2)) return;
  let anchor = scrim;
  const list = metricsHosts.map((band) => band.host).concat([metricsLabelHost, metricsGuideHost]);
  for (const el of list) {
    if (!el) continue;
    anchor.parentNode.insertBefore(el, anchor.nextSibling);
    anchor = el;
  }
}

/**
 * 把柱层的**段宿主**数量对齐到 n（段数只由几何决定，见 metricsBands ⇒ DOM 不会每帧重建）。
 * DOM 顺序统一重排成 柱层各段 → 名称层 → 标尺层：同 `z-index` 下靠文档序决定谁压谁，
 * 白线必须永远在最上、名称在柱子之上（用户口径："标注文字/图柱和细白横线解耦"）。
 */
function metricsSyncHosts(n) {
  const want = Math.max(1, Math.round(n) || 1);
  metricsRaiseAboveScrim();
  if (metricsHosts.length === want) return;
  while (metricsHosts.length > want) {
    const band = metricsHosts.pop();
    if (band.host && band.host.parentNode) band.host.parentNode.removeChild(band.host);
  }
  while (metricsHosts.length < want) {
    const index = metricsHosts.length;
    const host = document.createElement('div');
    host.id = index === 0 ? METRICS_HOST_ID : METRICS_HOST_ID + '-' + (index + 1);
    host.className = 'we-metrics';
    host.setAttribute('aria-hidden', 'true');
    const canvas = document.createElement('canvas');
    canvas.className = 'we-metrics__canvas';
    host.appendChild(canvas);
    metricsHosts.push({ host: host, canvas: canvas, key: '', left: 0, right: 0, mode: '' });
  }
  for (const band of metricsHosts) document.body.appendChild(band.host);
  if (metricsLabelHost) document.body.appendChild(metricsLabelHost);
  if (metricsGuideHost) document.body.appendChild(metricsGuideHost);
  metricsPaintKey = '';
  metricsLastW = 0;
  metricsLastH = 0;
}

/** 摘掉全部宿主节点（停用时不留空节点）。 */
function metricsRemoveHost() {
  for (const band of metricsHosts) {
    if (band.host && band.host.parentNode) band.host.parentNode.removeChild(band.host);
  }
  metricsHosts = [];
  if (metricsLabelHost && metricsLabelHost.parentNode) metricsLabelHost.parentNode.removeChild(metricsLabelHost);
  if (metricsGuideHost && metricsGuideHost.parentNode) metricsGuideHost.parentNode.removeChild(metricsGuideHost);
  metricsLabelHost = null;
  metricsLabelCanvas = null;
  metricsGuideHost = null;
  metricsGuideCanvas = null;
  metricsLastW = 0;
  metricsLastH = 0;
  metricsPaintKey = '';
  metricsGuideKey = '';
  metricsLabelKey = '';
}

/**
 * 拉一次数据。**永不 reject**：它是装饰，拉不到就保持上一帧 —— 宿主重启、
 * 路由 404、宿主判定"没这条腿"都不该在浏览器里留一个 unhandled rejection。
 */
async function metricsFetch() {
  if (document.hidden) return; // 页面不可见时不采样：宿主那边闲置自停会接手
  const ids = metricsWanted();
  if (!ids.length) return;
  const n = Math.round(metricsClamp(selection.metricsWindow, 20, 240, 60));
  try {
    const res = await apiJson('/metrics?n=' + n + '&s=' + ids.join(','));
    if (!res || !res.ok || !res.data || !res.data.ok) return;
    metricsData = res.data;
    metricsDataAt = metricsNow();
    if (Number.isFinite(res.data.intervalMs) && res.data.intervalMs > 0) metricsIntervalMs = res.data.intervalMs;
  } catch (e) {
    /* 拉不到就保持上一帧：装饰层不该有失败面 */
  }
}

/** 到点才拉（1 Hz）：rAF 每帧都跑，采样节奏靠这个闸门压住。 */
function metricsMaybeFetch() {
  const now = metricsNow();
  if (now - metricsFetchedAt < METRICS_POLL_MS) return;
  metricsFetchedAt = now;
  metricsFetch();
}

/**
 * 几何：一格多宽（`metricsBarWidth`）、格与格之间隔多远（`metricsBarGap`）与整块多宽。
 * 格数由**时间窗 ÷ 采样间隔**换算（1 Hz 采样时就是"秒数 = 格数"），于是"想留多久的历史"、
 * "每格多粗"、"隔多远"是三个独立的旋钮 —— 这正是用户要的"长宽可自定义 + 图柱之间要有间隔"。
 * 整块 = 格数 × 柱宽 + 全部柱间距，并钳在"视口 − 两侧留白"内（钳到装不下就少画几格）。
 */
function metricsBox() {
  const barW = Math.max(1, Math.round(metricsClamp(selection.metricsBarWidth, 1, METRICS_BAR_W_MAX, 4)));
  const barGap = Math.max(0, Math.round(metricsClamp(selection.metricsBarGap, 0, METRICS_BAR_GAP_MAX, 2)));
  const win = metricsClamp(selection.metricsWindow, 20, 240, 60);
  const stepMs = metricsIntervalMs > 0 ? metricsIntervalMs : METRICS_POLL_MS;
  const slots = Math.max(2, Math.round((win * 1000) / stepMs));
  const viewport = Math.max(1, Math.round(window.innerWidth || 1));
  const avail = Math.max(barW, viewport - METRICS_EDGE * 2);
  const pitch = barW + barGap;
  let n = slots;
  if (n * barW + (n - 1) * barGap > avail) n = Math.max(2, Math.floor((avail + barGap) / pitch));
  const width = Math.min(avail, Math.max(barW, n * barW + (n - 1) * barGap));
  return { barW: barW, barGap: barGap, width: width };
}

/**
 * 起绘制循环（幂等）。**唯一的驱动是 rAF**：刻意不用 `setInterval` —— 两个定时器
 * 意味着两套"谁先醒"的时序，而 rAF 天然在页面不可见时停摆（宿主那边闲置自停接手），
 * 采样节奏也就自动跟着可见性走。没有 rAF 的环境（无头/测试沙箱）**连 DOM 都不建**：
 * 这一层是装饰，宁可不画，也不要在没有帧时钟的地方留半截状态。
 */
function metricsStart() {
  if (typeof requestAnimationFrame !== "function") return;
  metricsEnsureHost();
  metricsFetchedAt = 0; // 首帧立刻拉一次，别等满一个采样周期
  if (!metricsRaf) metricsRaf = requestAnimationFrame(metricsFrame);
}

/** 全停（rAF 与 DOM 全收掉）。 */
function metricsStop() {
  if (metricsRaf) {
    try { if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(metricsRaf); } catch { /* 已卸载 */ }
    metricsRaf = 0;
  }
  metricsRemoveHost();
  metricsData = null;
  metricsFetchedAt = 0;
}

/**
 * 设置变了 / 壁纸层变了就调一次（由 `src/client.js` 的 `subscribe(syncMetricsLayer)` 驱动）。
 * 它只决定"该不该活"，不碰具体参数 —— 那些每帧现读，于是拖动滑块**不需要** emit 就能看到反馈。
 */
function syncMetricsLayer() {
  metricsAccent = ''; // 主题色可能刚被 applyEffects 改过：作废缓存
  metricsLabel = null; // 「外观」里的字族/字色同理（metricsLabelStyle 缓存了 computed 值）
  metricsLumaRead = false; // 壁纸可能刚换：明暗要重采
  metricsLuma = null;
  metricsLumaRaw = null;
  if (!selection.metricsEnabled || !metricsWanted().length) {
    metricsStop();
    return;
  }
  metricsStart();
}

/** 卸载：本模块拥有的一切都收掉。 */
function disposeMetricsLayer() {
  metricsStop();
  metricsAccent = '';
  metricsLabel = null;
  metricsLumaRead = false;
  metricsLuma = null;
  metricsLumaRaw = null;
}

/**
 * 画前签名：把这一帧真正影响像素的东西拼成一串。
 * 柱子每秒才换一格 ⇒ 签名不变就**不重画**（透明装饰层不该每秒烧 60 次 clear + fill）；
 * 采样到达（`metricsDataAt` 变）、尺寸变、拖滑块（参数变）都会换签名，于是必然重画。
 */
function metricsPaintId(width, height, barW, plan) {
  const style = metricsLabelStyle();
  return [
    metricsDataAt, width, height, barW,
    Math.round(metricsClamp(selection.metricsOffsetX, -METRICS_OFFSET_MAX, METRICS_OFFSET_MAX, 0)),
    Math.round(metricsClamp(selection.metricsOffsetY, -METRICS_OFFSET_MAX, METRICS_OFFSET_MAX, 0)),
    Math.round(metricsClamp(selection.metricsBarGap, 0, METRICS_BAR_GAP_MAX, 2)),
    Math.round(metricsClamp(selection.metricsStackGap, 0, METRICS_GAP_MAX, 4)),
    Math.round(metricsClamp(selection.metricsThreshold, 0, 100, 80)),
    Math.round(metricsClamp(selection.metricsGlow, 0, 100, 60)),
    Math.round(metricsClamp(selection.metricsSmooth, 0, 100, 60)),
    metricsClamp(selection.metricsLineWidth, 1, 5, 2),
    selection.metricsFill !== false ? 1 : 0,
    selection.metricsLabels !== false ? 1 : 0,
    selection.metricsColorMode || 'accent',
    metricsResolveAccent(),
    // 混合模式（分段结果一并入签名：壁纸某一段的明暗翻了，那一段就该跟着换档重画；
    // 极黑档的 `dim` 也入签名 —— 它换的是柱层不透明度，同样影响像素）
    plan.map((p) => p.mode + (p.dim ? '*' : '')).join(','),
    // 五条序列各自的颜色（只有「分色」档用得上，但一并入签名：改颜色必然重画一次）
    selection.metricsColorCpu || '', selection.metricsColorMem || '', selection.metricsColorGpu || '',
    selection.metricsColorNet || '', selection.metricsColorDisk || '',
    style.family,
    style.color,
    metricsWanted().join(','),
  ].join('|');
}

/** 细白横线那一层的签名：只含几何（**不含 `metricsDataAt`** ⇒ 柱子每秒换帧时白线不重画）。 */
function metricsGuideId(width, height, barW, layout) {
  return [
    width, height, barW, layout.rowGap,
    layout.rows.length,
    Math.round(layout.bandH * 100),
  ].join('|');
}

/** 名称层的签名：几何 + 行名 + 字族/字色（**不含 `metricsDataAt`** ⇒ 柱子换帧时名称不重画）。 */
function metricsLabelId(width, height, layout) {
  const style = metricsLabelStyle();
  return [
    width, height, Math.round(layout.bandH * 100), layout.rows.length,
    layout.rows.map((r) => String(r.def.tag || '')).join(','),
    style.family, style.color,
  ].join('|');
}

/** 自动档最多能切几段：段宽不该比一格（柱宽 + 柱间距）还窄 —— 比一格还窄就分不出"哪根柱子在哪段"。 */
function metricsSegMax(width, pitch) {
  const p = Math.max(1, Math.round(pitch) || 1);
  return Math.max(1, Math.min(METRICS_BAND_MAX, Math.max(1, Math.floor((Math.max(0, width) || 0) / p))));
}

/**
 * 柱层的**分段几何**：把整块横着切成 `max` 段以内、每段装若干整根柱子。
 * 切点恒取"柱间距的中点"（`width - barsRight * pitch + gap / 2`）—— 每一行都把柱子摆在
 * "锚定右缘的同一个 pitch 网格"上（见 metricsPaintBars 的右对齐口径），所以**无论哪一行、
 * 这一行有几根柱子**，切点都落在柱与柱之间的缝里，永远不会把一根柱子切成两半。
 * 最左那段一律从 0 起（含块左侧的空白余量）；返回**从左往右**的 `{left, right}` 区间。
 */
function metricsBands(width, count, pitch, gap, max) {
  const bars = Math.max(1, Math.round(count) || 1);
  const n = Math.max(1, Math.min(Math.round(max) || 1, bars));
  const p = Math.max(1, Math.round(pitch) || 1);
  const g = Math.max(0, Math.round(gap) || 0);
  const blockW = Math.max(1, Math.round(width) || 1);
  const per = Math.max(1, Math.ceil(bars / n));
  const bands = [];
  let index = 0;
  let right = blockW;
  while (index < bars && bands.length < n - 1) {
    index += Math.min(per, bars - index);
    const left = Math.max(0, Math.round(blockW - index * p + g / 2));
    if (left >= right) break; // 段被挤没了（块太窄）：剩下的都归最后一段
    bands.push({ left: left, right: right });
    right = left;
  }
  bands.push({ left: 0, right: right });
  bands.reverse();
  return bands;
}

/** 一帧：按当前设置重算几何 → 该画才画（采样也挂在这一帧上，见 metricsMaybeFetch）。 */
function metricsFrame() {
  metricsRaf = typeof requestAnimationFrame === "function" ? requestAnimationFrame(metricsFrame) : 0;
  metricsMaybeFetch();
  // ⚠️ 这条守卫**只能**判数据，不能把"宿主还没建"也算进去：柱层的段宿主是**本帧稍后**由
  // metricsSyncHosts 按几何建的 —— 写成 `!metricsHosts.length || !metricsData` 会死锁：
  // 首帧宿主为空 ⇒ 每帧都在建宿主之前 return ⇒ 宿主永远建不出来，三层全空（"扩展未显示"
  // 这个 bug 就是这么来的）。名称层 / 标尺层在 metricsStart 里就建好了，与这条守卫无关。
  if (!metricsData) return;
  const viewportH = Math.max(1, Math.round(window.innerHeight || 1));
  const viewportW = Math.max(1, Math.round(window.innerWidth || 1));
  // 高度既受设置限制，也受"四边留白"限制（上边离屏顶也不得少于留白）。
  const height = Math.min(Math.round(metricsClamp(selection.metricsHeight, 40, 320, 120)),
    Math.max(40, viewportH - METRICS_EDGE * 2));
  const box = metricsBox();
  const dpr = Math.min(window.devicePixelRatio || 1, METRICS_DPR_MAX);
  const layout = metricsLayout(height);
  // 位置：默认水平居中、底边留白；再叠加用户设的偏移（`metricsOffsetX/Y`，正值向右 / 向上），
  // 最后钳回留白之内 —— 偏移是微调，不该能把这块装饰挪出屏外或挪到界面下面看不见。
  // 写内联而不是 CSS —— 宽高本来就随设置现算，位置跟它们是一体的；CSS 里只留"内联还没写
  // 下去"那一瞬的兜底。柱层各段、名称层、标尺层**同位置、同尺寸、同不透明度**，各画各的。
  const offX = Math.round(metricsClamp(selection.metricsOffsetX, -METRICS_OFFSET_MAX, METRICS_OFFSET_MAX, 0));
  const offY = Math.round(metricsClamp(selection.metricsOffsetY, -METRICS_OFFSET_MAX, METRICS_OFFSET_MAX, 0));
  const centeredX = Math.round((viewportW - box.width) / 2);
  const maxX = Math.max(METRICS_EDGE, viewportW - box.width - METRICS_EDGE);
  const leftNum = Math.min(maxX, Math.max(METRICS_EDGE, centeredX + offX));
  const left = leftNum + 'px';
  const maxBottom = Math.max(METRICS_EDGE, viewportH - height - METRICS_EDGE);
  const bottom = Math.min(maxBottom, Math.max(METRICS_EDGE, METRICS_EDGE + offY)) + 'px';
  const opacity = String(metricsClamp(selection.metricsOpacity, 10, 100, 85) / 100);
  // 极黑档的柱层不透明度（用户口径"图柱透明度 -50%"，倍率本身可调 = `metricsDeepOpacity`，
  // 默认 50% ⇒ 减半）：只有**自动档判成极黑**的那几段用它；名称层与标尺层照旧用原值 ——
  // 它们混合恒为 normal，压低了只是把白线白字变成灰的。
  const deepAlpha = metricsClamp(selection.metricsDeepOpacity, 10, 100, 50) / 100;
  const deepOpacity = String(Number(opacity) * deepAlpha);
  const pitch = box.barW + box.barGap;
  const barCount = Math.max(1, Math.floor((box.width + box.barGap) / pitch));
  // 自动档的分段判明暗：段数只由几何决定（手动档恒 1 段 ⇒ DOM 不会每帧重建），
  // 采样要对着**柱子背后那一横条**画面（fracX / fracW 是整块在视口里的位置与宽度占比）。
  const plan = metricsBlendPlan(metricsSegMax(box.width, pitch),
    leftNum / viewportW, box.width / viewportW);
  const bands = metricsBands(box.width, barCount, pitch, box.barGap, plan.length);
  metricsSyncHosts(bands.length);
  const id = metricsPaintId(box.width, height, box.barW, plan);
  for (let i = 0; i < bands.length; i += 1) {
    const band = metricsHosts[i];
    const seg = bands[i];
    const segW = Math.max(1, seg.right - seg.left);
    // 这一段的档（`dim` = 极黑档 ⇒ 柱层不透明度按 metricsDeepOpacity 压低；手选「变亮」不带 dim，用户自己选的档不砍）
    const entry = plan[Math.min(i, plan.length - 1)] || metricsBlendFallback();
    const mode = entry.mode;
    if (metricsSizeCanvas(band.canvas, segW, height, dpr)) band.key = '';
    band.host.style.left = (leftNum + seg.left) + 'px';
    band.host.style.bottom = bottom;
    band.host.style.width = segW + 'px';
    band.host.style.height = height + 'px';
    band.host.style.opacity = entry.dim ? deepOpacity : opacity;
    // 混合模式**必须写在段宿主这一层**：写在画布上只会跟宿主自己的 stacking context 混合（= 不生效）。
    metricsNodeStyle(band.host, 'mix-blend-mode', mode);
    const bandId = id + '|' + seg.left + '|' + seg.right + '|' + mode;
    if (bandId === band.key) continue;
    band.key = bandId;
    const g = band.canvas.getContext('2d');
    if (!g) continue;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, segW, height);
    // 柱子仍按**整块**的坐标画（右对齐网格与整块宽度绑定），画到段外的自然被画布裁掉。
    g.translate(-seg.left, 0);
    metricsPaintBars(g, box.width, height, layout, box.barW, box.barGap);
  }
  metricsLastW = box.width;
  metricsLastH = height;
  // 名称层：整块一层、**不参与混合**（正片叠底再也吃不掉它），只画行名。
  if (metricsLabelHost && metricsLabelCanvas) {
    if (metricsSizeCanvas(metricsLabelCanvas, box.width, height, dpr)) metricsLabelKey = '';
    metricsLabelHost.style.left = left;
    metricsLabelHost.style.bottom = bottom;
    metricsLabelHost.style.width = box.width + 'px';
    metricsLabelHost.style.height = height + 'px';
    metricsLabelHost.style.opacity = opacity;
    metricsNodeStyle(metricsLabelHost, 'mix-blend-mode', 'normal');
    metricsPaintLabelsOnce(box.width, height, layout, dpr);
  }
  if (metricsGuideHost && metricsGuideCanvas) {
    // ⚠️ 标尺层也必须**自己**把画布归位：`<canvas>` 的默认位图是 300×150，只靠 CSS 拉到
    // 整块大小的话，画在 300 以外的部分全被裁掉、纵向还会被拉伸（用户反馈："白色横条没显示完全"）。
    if (metricsSizeCanvas(metricsGuideCanvas, box.width, height, dpr)) metricsGuideKey = '';
    metricsGuideHost.style.left = left;
    metricsGuideHost.style.bottom = bottom;
    metricsGuideHost.style.width = box.width + 'px';
    metricsGuideHost.style.height = height + 'px';
    metricsGuideHost.style.opacity = opacity;
    // 标尺层恒为 normal：正片叠底会把白线乘没（见文件头）。
    metricsNodeStyle(metricsGuideHost, 'mix-blend-mode', 'normal');
  }
  metricsPaintGuidesOnce(box.width, height, box.barW, layout, dpr);
}

/** 两张画布按 dpr 归位（尺寸本来就没变就返回 false，省一次 clear + 重画）。 */
function metricsSizeCanvas(canvas, width, height, dpr) {
  if (!canvas) return false;
  const w = Math.round(width * dpr);
  const h = Math.round(height * dpr);
  if (canvas.width === w && canvas.height === h) return false;
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  return true;
}

/** 只在真的变了的时候给某个宿主写一条内联样式（`mix-blend-mode` 这类写入会触发合成层重建，别每帧无脑赋值）。 */
function metricsNodeStyle(el, prop, value) {
  if (!el || !el.style) return;
  if (el.style.getPropertyValue(prop) === value) return;
  el.style.setProperty(prop, value);
}

/**
 * 布局：该画哪些行（一条序列一行）、每行多高、行间留多少 —— **柱层与标尺层共用同一份**，
 * 于是"柱子画在哪、白线横在哪"永远对得上（两者解耦的是绘制与重绘时机，不是几何口径）。
 * 行 = 设置里开着、且宿主真的拿得出数据的那几条（顺序即 METRICS_SERIES 的顺序 = 屏上自上而下）；
 * `bandBottom` 是该行的基线（柱子的下端 = 这一行的底）。
 */
function metricsLayout(height) {
  const list = (metricsData && metricsData.series) || [];
  const avail = (metricsData && metricsData.avail) || {};
  const wanted = metricsWanted();
  const rows = [];
  for (const s of list) {
    if (wanted.indexOf(s.id) < 0 || avail[s.id] === false) continue;
    const def = METRICS_SERIES.find((d) => d.id === s.id);
    if (!def || !(s.values || []).length) continue;
    rows.push({ s: s, def: def, bandBottom: 0 });
  }
  const rowGap = Math.max(0, Math.round(metricsClamp(selection.metricsStackGap, 0, METRICS_GAP_MAX, 4)));
  const bandH = rows.length ? Math.max(1, (height - rowGap * (rows.length - 1)) / rows.length) : 0;
  for (let ri = 0; ri < rows.length; ri += 1) {
    rows[ri].bandBottom = Math.round(ri * (bandH + rowGap) + bandH);
  }
  return { rows: rows, bandH: bandH, rowGap: rowGap };
}

/** 这条序列在「分色」档用的颜色：用户在面板里选的那个（设坏了 / 没设过就退回出厂色相）。 */
function metricsSeriesColor(def) {
  const raw = String(selection[def.colorKey] || '').trim();
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw : def.hue;
}

/**
 * 柱层：**一条序列一行、自上而下拼接**，每行一串右对齐的等宽柱子。
 * 行名**不在这一层**（见 metricsPaintLabels）：这一层要参与混合（正片叠底会吃掉白字），
 * 行名搬到不参与混合的名称层上。空值（宿主取不到该指标）= 那一格不画，不是 0。
 */
function metricsPaintBars(g, width, height, layout, barW, barGap) {
  const rows = layout.rows;
  if (!rows.length) return;
  const mode = selection.metricsColorMode || 'accent';
  const accent = metricsResolveAccent();
  const outline = metricsClamp(selection.metricsLineWidth, 1, 5, 2);
  const glow = metricsClamp(selection.metricsGlow, 0, 100, 60);
  const smooth = metricsClamp(selection.metricsSmooth, 0, 100, 60);
  const solid = selection.metricsFill !== false;
  const bandH = layout.bandH;
  const barGapPx = Math.max(0, Math.round(barGap));
  const threshold = metricsClamp(selection.metricsThreshold, 0, 100, 80); // 0 = 关闭阈值
  // 一格占的横向距离 = 柱宽 + 柱间距；最后一个间隔不占地方 ⇒ 宽度反推格数时先补回来。
  const pitch = barW + barGapPx;
  const maxBars = Math.max(1, Math.floor((width + barGapPx) / pitch));
  for (let ri = 0; ri < rows.length; ri += 1) {
    const s = rows[ri].s;
    const bottom = rows[ri].bandBottom;
    const values = s.values;
    const scale = Number.isFinite(s.scale) && s.scale > 0 ? s.scale : 100;
    // 颜色：跟随主题色 / 每条序列**自己在面板里选的颜色**（单色档再往白里提一档，靠亮度区分各行）。
    const color = mode === 'spectrum' ? metricsSeriesColor(rows[ri].def)
      : mode === 'mono' ? metricsLighten(accent, ri * 0.16)
      : accent;
    // 平滑：值的滑动平均（0 = 原始值，100 = 窗口 7 点）—— 只让柱高别抖，不改变取值口径。
    const k = Math.max(1, Math.round(((100 - smooth) / 100) * 6) + 1);
    const count = Math.min(values.length, maxBars);
    const from = values.length - count;
    const normal = [];
    const hot = [];
    for (let i = 0; i < count; i += 1) {
      const idx = from + i;
      let acc = 0;
      let cnt = 0;
      for (let j = Math.max(0, idx - k + 1); j <= idx; j += 1) {
        const v = values[j];
        if (typeof v === 'number' && Number.isFinite(v)) {
          acc += v;
          cnt += 1;
        }
      }
      if (!cnt) continue;
      const ratio = Math.max(0, Math.min(1, (acc / cnt) / scale));
      const h = Math.max(1, Math.round(ratio * bandH));
      // 右对齐：最右那根贴着块右缘，往左每格退一个 pitch（柱之间因此恒有 barGap 的缝）。
      const rect = [width - (count - i) * pitch + barGapPx, bottom - h, barW, h];
      if (threshold > 0 && ratio * 100 > threshold) hot.push(rect); else normal.push(rect);
    }
    // 同一档一次成图：荧光（shadowBlur）只在整批上打一次，避免每根柱子各来一次模糊。
    metricsBars(g, normal, color, solid, outline, glow);
    metricsBars(g, hot, METRICS_HOT_COLOR, solid, outline, glow);
  }
}

/**
 * 名称层：只有"几何 / 行名 / 字族字色"变了才重画（签名里**没有数据时间戳** ⇒
 * 柱子每秒换帧时这几行字一动不动）。关掉开关时把这一层擦一次。
 */
function metricsPaintLabelsOnce(width, height, layout, dpr) {
  if (!metricsLabelCanvas) return;
  const show = selection.metricsLabels !== false && layout.rows.length > 0;
  if (!show) {
    if (!metricsLabelKey) return;
    metricsLabelKey = '';
    const g = metricsLabelCanvas.getContext('2d');
    if (g) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, metricsLabelCanvas.width, metricsLabelCanvas.height);
    }
    return;
  }
  const id = metricsLabelId(width, height, layout);
  if (id === metricsLabelKey) return;
  metricsLabelKey = id;
  const g = metricsLabelCanvas.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, width, height);
  metricsPaintLabels(g, width, height, layout);
}

/**
 * 名称本体：**一条序列一行、块水平居中**压在该行上（用户口径："每条柱状图居中位置……标明该条名称"）。
 * 字面取 `def.tag`（英文缩写）而不是 `def.label` —— 面板开关的名字随界面语言变，屏上的标注不变
 * （见 METRICS_SERIES 的注释）。
 */
function metricsPaintLabels(g, width, height, layout) {
  const rows = layout.rows;
  if (!rows.length) return;
  for (let ri = 0; ri < rows.length; ri += 1) {
    metricsRowLabel(g, String(rows[ri].def.tag || rows[ri].def.label || ''),
      width, rows[ri].bandBottom, layout.bandH);
  }
}

/**
 * 标尺层：只有几何变了才重画（`metricsGuideId` 里**没有数据时间戳** ⇒ 柱子每秒换帧时
 * 这几根白线一动不动、也不重新成图）。关掉开关时把这一层擦一次 —— 别把上一帧的白线留在屏上。
 */
function metricsPaintGuidesOnce(width, height, barW, layout, dpr) {
  if (!metricsGuideCanvas) return;
  // 没有行可画（或用户刚关掉）也是"该擦一次"的状态，所以两种情况合并成"没有内容"。
  const show = selection.metricsGuides !== false && layout.rows.length > 0;
  if (!show) {
    if (!metricsGuideKey) return;
    metricsGuideKey = '';
    const g = metricsGuideCanvas.getContext('2d');
    if (g) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, metricsGuideCanvas.width, metricsGuideCanvas.height);
    }
    return;
  }
  const id = metricsGuideId(width, height, barW, layout);
  if (id === metricsGuideKey) return;
  metricsGuideKey = id;
  const g = metricsGuideCanvas.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, width, height);
  metricsPaintGuides(g, width, height, layout);
}

/**
 * 细白横线本体（用户口径："横在每个柱状图 50% 高度上和每两个柱状图之间"）：
 *   · 每行**行内 50% 高度**一条；
 *   · **每两行之间**一条（行距为 0 时与上面那条重合，跳过）。
 * 横贯整块宽度、恒定不透明度（`METRICS_GUIDE_ALPHA`）、画在**单独一层**：
 * 它不跟随柱层的混合模式 —— 白线在亮背景（正片叠底）和暗背景（叠加）下都要看得见。
 * 用 1px 高的实心矩形而不是 `stroke`：不受 transform 缩放影响，dpr > 1 时也不会糊成两根灰线。
 */
function metricsPaintGuides(g, width, height, layout) {
  const rows = layout.rows;
  if (!rows.length) return;
  const bandH = layout.bandH;
  const rowGap = layout.rowGap;
  g.fillStyle = 'rgba(255,255,255,' + METRICS_GUIDE_ALPHA + ')';
  for (let ri = 0; ri < rows.length; ri += 1) {
    g.fillRect(0, Math.round(rows[ri].bandBottom - bandH / 2), width, 1);
    if (ri < rows.length - 1 && rowGap > 0) {
      g.fillRect(0, Math.round(rows[ri].bandBottom + rowGap / 2), width, 1);
    }
  }
}

/**
 * 一行的名称（用户口径："每条柱状图居中位置使用壁纸插件中设置的字体（加粗）标明该条名称，
 * 字的颜色也与壁纸插件中设置的字体颜色相同，……与柱状图等高"；
 * 后续口径："我希望标注文字上下渐变，上部是默认颜色，下部是透明，均匀渐变"）。
 *   · 文字：`METRICS_SERIES[].tag`（CPU / RAM / GPU / NET / DISK，英文缩写，纯 ASCII 常量）；
 *   · 位置：块**水平居中**、纵向对齐这一行的中点（`bottom - bandH / 2`）；
 *   · 字号：取行高（`bandH`）—— "与柱状图等高"，再乘一个肉眼更协调的系数；
 *   · 字族/字色：`metricsLabelStyle()`（=「外观」里那套设置落到 DSH 令牌后的结果），
 *     再过一道 `metricsClampInk` 把**亮度钳进 20%–80%**（用户口径）—— 主题字色是接近纯白的，
 *     直接画会在正片叠底下被乘没；
 *   · 透明度：**竖向渐变** —— 字的上缘 `METRICS_LABEL_ALPHA`、下缘全透明（线性、均匀）。
 *     渐变跨度取**字自身的行框**（中点 ± 半个字号）而不是整行 band，这样"渐变跑完"发生在
 *     字的底部：同一块画布上多行字看起来是同一套渐变，而不是行高越大越淡。
 *   · 行太矮（< METRICS_LABEL_MIN_PX）或取不到字色就**不画** —— 它是装饰，宁可没有也不要噪点。
 */
function metricsRowLabel(g, text, width, bottom, bandH) {
  const size = Math.floor(bandH * 0.9);
  if (size < METRICS_LABEL_MIN_PX) return;
  const style = metricsLabelStyle();
  if (!style.color) return;
  const ink = metricsClampInk(style.color);
  const cy = Math.round(bottom - bandH / 2);
  const top = cy - size / 2;
  const grad = g.createLinearGradient(0, top, 0, top + size);
  grad.addColorStop(0, metricsRgba(ink, METRICS_LABEL_ALPHA));
  grad.addColorStop(1, metricsRgba(ink, 0));
  g.save();
  g.fillStyle = grad;
  g.font = '700 ' + size + 'px ' + style.family;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, Math.round(width / 2), cy);
  g.restore();
}

/** 一批等宽的矩形画一次（实心 = fill，否则只描边）；`glow` > 0 时整批共用一次辉光。 */
function metricsBars(g, rects, color, solid, outline, glow) {
  if (!rects.length) return;
  g.save();
  g.beginPath();
  for (const r of rects) g.rect(r[0], r[1], r[2], r[3]);
  if (glow > 0) {
    g.shadowBlur = (glow / 100) * 12;
    g.shadowColor = metricsRgba(color, 0.75);
  }
  if (solid) {
    g.fillStyle = color;
    g.fill();
  } else {
    g.strokeStyle = color;
    g.lineWidth = outline;
    g.stroke();
  }
  g.restore();
}

export { METRICS_SERIES, syncMetricsLayer, disposeMetricsLayer };
