/**
 * transition-handlers.js — 切换过场（手动点选与自动轮播共用）的档位表与几何，从 `src/client.js`
 * 按族搬出，函数体逐字未改。
 *
 * 契约：
 *   1) 本文件不 import —— 构建期由 scripts/build-client.mjs 内联在正文之前，与正文同处一个扁平作用域；
 *      函数体引用的 weT / ROTATION_FADE_MS 等自由名由正文与其它内联模块提供。
 *   2) 搬移只改了"声明住哪"：正文来自拆前 src/client.js 的 1283–1328 行（逐字节相同）。
 *   3) 顶层只有字面量档位表与一个纯函数：不读正文的 const、不挂监听 ⇒ 无 TDZ 风险。
 */
// ── 切换过场（手动点选与自动轮播共用）──────────────────────────────────────
// 每种过场只动 transform / opacity / clip-path —— 全是合成器友好属性。（本插件在
// <video> 与 live <iframe> 上踩过 mask / filter 掉出合成层的坑，故一律不用。）
// 所有过场都守同一条铁律：**旧层保持不透明垫在新层之下**，新层在它之上入场 ——
// 玻璃的 backdrop-filter 采样到透明背景会静默失效（见 applyEffects 内注释），
// 所以这里没有「淡到黑再淡出」那种中间态透明的方案。
// ms = 基准毫秒 × 速度档乘子（SWITCH_SPEEDS）。基准在快档也不为 0，避免「点了没反应」。
// 交叉淡化时长（新层淡入 + 旧层宽限移除的基准）。必须**先于**档位表求值 ——
// 档位表的 fade 项在模块初始化时直接读它，放到正文会撞 TDZ（实测 ReferenceError）。
const ROTATION_FADE_MS = 1800;
const SWITCH_TRANSITIONS = [
  { id: "cut", get label() { return weT("硬切"); }, ms: 0 },
  { id: "fade", get label() { return weT("交叉淡化"); }, ms: ROTATION_FADE_MS },
  { id: "push", get label() { return weT("推移"); }, ms: 700 },
  { id: "wipe", get label() { return weT("擦除"); }, ms: 700 },
  { id: "iris", get label() { return weT("光圈"); }, ms: 800 },
  { id: "zoom", get label() { return weT("缩放"); }, ms: 900 },
  { id: "bars", get label() { return weT("条带"); }, ms: 800 },
  // 随机：真正换层那一刻才从非硬切池里抽一个；ms 只是面板代表值（按池内最长算）。
  { id: "random", get label() { return weT("随机"); }, ms: 0 },
];
const SWITCH_SPEEDS = [
  { id: "fast", get label() { return weT("快"); }, factor: 0.6 },
  { id: "normal", get label() { return weT("标准"); }, factor: 1 },
  { id: "slow", get label() { return weT("慢"); }, factor: 1.6 },
];
const SWITCH_DIR_LABELS = {
  get left() { return weT("左"); },
  get right() { return weT("右"); },
  get up() { return weT("上"); },
  get down() { return weT("下"); },
  get random() { return weT("随机"); },
};
// 只有方向型过场听 switchTransitionDir（条带用它决定竖条 / 横条）。
const SWITCH_DIRECTIONAL = ["push", "wipe", "bars"];
// 条带（百叶窗）：板数。横向过场时是 N 块横板，纵向时是 N 块竖板；板数决定缝的
// 密度 —— 5 块太粗、9 块以上在 4K 上偏碎，7 块实测最像百叶窗。点数恒定
// （4N+1），polygon() 才可插值 → 动画连续。
const SWITCH_BARS_TEETH = 7;

/** 当前生效的过场（类型 + 方向 + 实测算出的毫秒）。cut = 不动画。 */

/** 擦除的起始 inset：从新画面「进入」的那一侧长出来（left = 新画面自右进入）。 */
function wipeInset(dir) {
  if (dir === "right") return "inset(0 100% 0 0)";
  if (dir === "up") return "inset(100% 0 0 0)";
  if (dir === "down") return "inset(0 0 100% 0)";
  return "inset(0 0 0 100%)"; // left
}
