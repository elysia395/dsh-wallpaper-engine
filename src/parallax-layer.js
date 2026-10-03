/**
 * parallax-layer.js — 「3D 效果」的**视差层**：光标移动时把壁纸 / 吉祥物 / 柱状图挪一小段。
 *
 * ══ 为什么是这样一个角色 ══════════════════════════════════════════════════════
 * 它是**基座模块**（见 docs/CODE-STRUCTURE.md §3.1）：不吃 ctx、直接读扁平设置 store
 * `selection`，和 `video-layer` / `effects` / `metrics-layer` / `fx-layer` 同层 —— 因为它的
 * 驱动源不是某次渲染，而是**输入事件**（pointermove）与一个 rAF 缓动循环。渲染器给它传 ctx
 * 反而要把每个设置项穿一遍，而"光标一动就有反应"这件事必须当场发生。
 *
 * ══ 它怎么动 ═════════════════════════════════════════════════════════════════
 *   · **单位量**：光标相对屏幕中心偏移 u = (光标 − 中心)，则该层的目标位移是
 *     `PARALLAX_DIRECTION × u × pct/100`（pct 是这个层的"缓动距离"）。
 *     光标走完整整一条**最长对角线**（Δu = 对角线 d）时，位移正好改变 `pct% × d` ——
 *     这就是用户口径里那个百分比的定义。方向 `PARALLAX_DIRECTION = -1`：**关于屏幕中心
 *     对称**（光标在右上，整块往左下走）。改成跟随光标只需把它写成 +1。
 *   · **缓动**：位移不直接等于目标，而是按 `parallaxSmooth` 每帧朝目标逼近一截
 *     （指数逼近；按真实 dt 折算 ⇒ 掉帧时跟手程度不变）⇒ 光标停下后影子还会飘一小段才归位。
 *   · **开销**（这一层整个长在输入路径上，省下来的都是手感）：位移步长只写在**要动的那几层
 *     自己**身上（自定义属性是继承的 —— 写在 body 上等于每帧让整棵文档树重算样式）；
 *     帧率封顶 60Hz（高刷屏隔帧跑，缓动本来就按 60fps 折算）；"到位"按**看得见的位移**判
 *     （屏上剩余量 < 0.25px，光标静下来 180ms 之后放宽到 1px）⇒ 一次手势的帧数大约减半；
 *     系数全 0 时一帧都不排；帧循环在跑的这段时间给那几层加一个类提成合成层（每帧只挪现成的
 *     纹理、不整屏重绘），到位收工立刻摘掉（本仓刻意不留常驻合成层）。视口尺寸只在 resize 时读。
 *   · **壁纸要补边**：位移最大为 `pct/100 × 视口宽 / 2`（横向）、`pct/100 × 视口高 / 2`（纵向），
 *     而 `.we-layer` 正好是视口大小 ⇒ 不补边就会在边上露出底色。所以壁纸层同时放大
 *     `1 + pct/100`（见 src/styles.js 的视差段）—— 恰好多出"最大位移 × 2"那点余量。
 *   · **各层各自的百分比**：壁纸走 `parallaxBg`；吉祥物跟着壁纸（`parallaxMascot` 可关）；
 *     柱状图的三层宿主以 `parallaxMetrics` 为基准 —— **柱层**用它、**名称层** +1%、
 *     **标尺层** +2%（用户口径："该扩展的其余组件以该值为基准逐加1%"）。分得越开，纵深越明显。
 *   · **点击与拖尾效果（`src/fx-layer.js` 那一层）刻意不参与**（用户口径第 3 条）：那层画的是"屏上的笔迹"，
 *     跟着挪会让落点与光效错位。
 *
 * 契约：
 *   需要的外界：`selection`（设置 store，只读）、`document.body`（写 5 个"各层系数"与一个开关
 *   属性）、还有**那几层元素自己**（`.we-layer` / `.we-rope` / `.we-metrics*`：写位移步长与
 *   临时的合成层提示）。
 *   对外提供：`syncParallaxLayer()`（设置变了就调一次）、`disposeParallaxLayer()`（卸载清理）。
 *   设置项（`parallax*`，真源 lib/settings-schema.js）：总开关 / 背景距离 / 图表距离 /
 *   吉祥物是否跟随 / 缓动平滑。
 *
 * 不变量：
 *   · **一个 DOM 节点都不建**：屏上那几层（壁纸 / 吉祥物 / 柱状图）本来就存在，本层只写 CSS
 *     变量 —— 5 个"各层系数"写在 `document.body` 上（只在设置变了时写一次），"位移步长"写在
 *     **要动的那几层自己**身上（每帧写，但作用域只有那几个元素），另加一个开关属性
 *     `data-we-parallax`。位移与配比全在 src/styles.js 的视差段里用 `calc()` 乘出来，
 *     于是**关掉时屏上一点痕迹都没有**（属性摘掉 ⇒ 那几条规则整段不命中，壁纸层连
 *     `translate` 都不带）。
 *     ⚠️ 位移**不能**写成 `transform`：`.we-layer` 的过场（层切换）与 `.we-layer--repaint`
 *     会内联写 / 清 `transform`（见 src/live-layer.js 的 resetLayerSwitchStyles）—— 用 CSS 的
 *     **独立属性** `translate` / `scale` 才与它们叠加而不互相清掉。
 *   · **只读 `selection`**：一个字节都不写（裸写棘轮只留给 media-prep / effects / live-layer）。
 *     拖动滑块时的即时反馈靠"每帧重读设置"，不靠写回。
 *   · **零顶层可执行语句**：本文件的顶层只有声明 —— 读 `selection` / 碰 `document` 的语句
 *     一律在函数里（内联后 prelude 早于 `src/client.js` 正文求值，顶层读它必撞 TDZ）。
 *   · **不接管输入**：只读 document 上的 pointermove / window 上的 resize（都 passive），
 *     一个事件都不拦；屏上也没有属于本层的元素。
 *   · **挂了才活、到位就停**：`parallaxEnabled` 关掉 ⇒ 立刻停 rAF、摘掉临时的合成层与变量、
 *     摘掉属性。帧循环是**收敛驱动**的：剩下的位移在屏上已经看不出来（口径见上面"开销"那条
 *     的两个阈值）就画完这帧收工（`parallaxRaf = 0`），下一次 pointermove 再用
 *     `parallaxKick()` 起一帧 —— 光标不动时零帧、零 CPU。
 *   · **没有 rAF 的环境连 DOM 都不碰**（无头/测试沙箱）：这一层是装饰，宁可不画，
 *     也不要在没有帧时钟的地方留半截状态。
 *   · 事件与变量都走幂等的 `parallaxBind()` / `parallaxUnbind()`，重复 sync 不会叠监听。
 */

/** 1 = 跟随光标，-1 = 关于屏幕中心对称（用户口径："沿中心对称方向缓动"）。改这一个数就能换向。 */
const PARALLAX_DIRECTION = -1;
/** 百分比是"最长对角线的百分之几"：壁纸 0..10（它同时决定补边放大的倍数 1 + pct/100）、
 *  图表 0..20（名称层 / 标尺层各再 +1 / +2 ⇒ 上限 22）、平滑 0..98（100% 等于永远不动）。 */
const PARALLAX_BG_MIN = 0;
const PARALLAX_BG_MAX = 10;
const PARALLAX_METRICS_MIN = 0;
const PARALLAX_METRICS_MAX = 20;
const PARALLAX_SMOOTH_MIN = 0;
const PARALLAX_SMOOTH_MAX = 98;
/** 名称层 / 标尺层相对**图表层**的加量（"其余组件以该值为基准逐加1%"）。 */
const PARALLAX_LABEL_STEP = 1;
const PARALLAX_GUIDE_STEP = 2;
/** 位移步长的最小"到位"距离（px / 每 1%）：兜底阈值，常态用的是下面按可见位移折算的那个。 */
const PARALLAX_SETTLE_PX = 0.02;
/** 缓动按 60fps 一帧折算；掉帧时最多按 64ms 补（再长就直接到位，别放大成一次跳跃）。
 *  帧率也按它封顶：高刷屏（120 / 144Hz）隔帧跑 —— 缓动本来就按 60fps 折算，
 *  多出来的那些帧只是白写一遍变量，屏上的位移一点没差。 */
const PARALLAX_FRAME_MS = 1000 / 60;
const PARALLAX_DT_MAX = 64;
const PARALLAX_MIN_FRAME_MS = PARALLAX_FRAME_MS * 0.75;
/** "到位"看的是**屏上还剩多少位移**：位移 = 步长 × 系数 ⇒ 剩余位移 = 剩余步长 × 最大系数。
 *  0.25px 已经在感知之外；光标静下来 180ms 之后放宽到 1px —— 尾巴上那十几帧一次收掉
 *  （抹平那一刻的位移不足 1px，看不出来）。 */
const PARALLAX_SETTLE_VISIBLE_PX = 0.25;
const PARALLAX_IDLE_MS = 180;
const PARALLAX_IDLE_VISIBLE_PX = 1;
/** 要动的那几层（与 src/styles.js 视差段的规则一一对应）：柱状图三个宿主都带 .we-metrics。 */
const PARALLAX_TARGET_SELECTOR = '.we-layer, .we-rope, .we-metrics';
/** 帧循环在跑的这段时间加在目标上的类（样式段只在开关属性下给它 will-change）—— 收工即摘。 */
const PARALLAX_MOVING_CLASS = 'we-parallax--moving';
/** 目标重扫间隔：壁纸层会换节点、柱状图宿主随行数与采样重建，所以帧里定期重扫一次。 */
const PARALLAX_TARGETS_MS = 250;
/** 光标在屏幕外 / 还没动过时的位移：读不到真实尺寸时的兜底中心，也是"零位移"的那一点。 */
const PARALLAX_BG_DEFAULT = 1;
const PARALLAX_METRICS_DEFAULT = 1;
const PARALLAX_SMOOTH_DEFAULT = 85;
/** 写进 body 的变量名（与 src/styles.js 的视差段逐字对应）：前两个是**每 1% 的像素步长**
 *  （写在**要动的那几层自己**身上，见 parallaxSteps —— 自定义属性是继承的，写在 body 上等于
 *  每帧让整棵文档树重算样式），其余五个是各层的百分比（只在设置变了时写一次）——
 *  真正的位移 = 步长 × 百分比，全在 CSS 的 calc() 里乘出来。 */
const PARALLAX_VAR_X = '--we-parallax-x';
const PARALLAX_VAR_Y = '--we-parallax-y';
const PARALLAX_VAR_BG = '--we-parallax-bg';
const PARALLAX_VAR_MASCOT = '--we-parallax-mascot';
const PARALLAX_VAR_METRICS = '--we-parallax-metrics';
const PARALLAX_VAR_LABELS = '--we-parallax-labels';
const PARALLAX_VAR_GUIDES = '--we-parallax-guides';
/** body 上的总开关属性：只有它在时那几条视差规则才命中（关掉 ⇒ 壁纸连 translate 都不带）。 */
const PARALLAX_ATTR = 'data-we-parallax';

let parallaxOn = false;
let parallaxBound = false;
let parallaxRaf = 0;
let parallaxX = 0;
let parallaxY = 0;
let parallaxSeen = false;
/** 当前步长（px / 每 1% 的百分比）与上一帧的时间戳、上一次写下去的变量快照。 */
let parallaxStepX = 0;
let parallaxStepY = 0;
let parallaxLastMs = 0;
let parallaxStepKey = '';
let parallaxRatioKey = '';
/** 视口尺寸（只在 resize / 起帧时读一次：帧里不再问 window，省掉每帧那次布局查询）。 */
let parallaxVw = 0;
let parallaxVh = 0;
/** 最近一次 pointermove 的时刻（判"光标静下来了"）与要动的那几层的记录（见 parallaxTargetsRefresh）。 */
let parallaxMoveMs = 0;
let parallaxTargets = [];
let parallaxTargetsMs = 0;

function parallaxNow() {
  return window.performance && typeof window.performance.now === 'function'
    ? window.performance.now() : Date.now();
}

function parallaxClamp(v, lo, hi, fallback) {
  const n = typeof v === 'number' && isFinite(v) ? v : Number(v);
  if (!isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * 设置快照（每帧现读 ⇒ 拖滑块不需要 emit 就能看到反馈）。
 * 数值范围是**常量**、与本文件外的白名单同值（改范围要同时看 lib/settings-schema.js ——
 * 那份是唯一真源）：本文件要能被单独 import（test/verify-scene-live.mjs 就是这么测的），
 * 引那份 schema 会在单文件环境里 ReferenceError。
 */
function parallaxSettings() {
  return {
    on: selection.parallaxEnabled === true,
    bg: parallaxClamp(selection.parallaxBg, PARALLAX_BG_MIN, PARALLAX_BG_MAX, PARALLAX_BG_DEFAULT),
    metrics: parallaxClamp(selection.parallaxMetrics, PARALLAX_METRICS_MIN, PARALLAX_METRICS_MAX,
      PARALLAX_METRICS_DEFAULT),
    mascot: selection.parallaxMascot !== false,
    smooth: parallaxClamp(selection.parallaxSmooth, PARALLAX_SMOOTH_MIN, PARALLAX_SMOOTH_MAX,
      PARALLAX_SMOOTH_DEFAULT),
  };
}

/** 写变量 / 属性的落点。没有 DOM 的环境（无头沙箱、SSR 探测）一律返回 null ⇒ 全链静默。 */
function parallaxBody() {
  if (typeof document === 'undefined' || !document || !document.body) return null;
  return document.body;
}

/** 写一条**元素级**的自定义属性（只在真的变了的时候写，比的是自己攒的快照，不读回 DOM）。
 *  两个能力都先探再调：挂载台（`test/verify-client.mjs`）的 style 只实现了 setProperty。 */
function parallaxVarOn(el, prop, value) {
  const style = el && el.style;
  if (!style || typeof style.setProperty !== 'function') return;
  if (typeof style.getPropertyValue === 'function' && style.getPropertyValue(prop) === value) return;
  style.setProperty(prop, value);
}

/** 视口尺寸：帧里要用（中心 = 视口 / 2），但只在起帧与 resize 时读一次 —— 每帧问 window 是白花的，
 *  而且"读窗口尺寸"和样式写入交错还有把布局刷出来的风险。 */
function parallaxReadViewport() {
  const win = typeof window === 'undefined' ? null : window;
  const w = win ? Math.round(Number(win.innerWidth)) : 0;
  const h = win ? Math.round(Number(win.innerHeight)) : 0;
  parallaxVw = isFinite(w) && w > 0 ? w : 0;
  parallaxVh = isFinite(h) && h > 0 ? h : 0;
}

/** 提合成层的提示（只提示 translate：scale 是静态的，不掺和栅格化倍率）。已经在身上时
 *  add 是空操作；壁纸层的过场会把类整条抹掉（`resetLayerSwitchStyles` 重置 className），
 *  所以帧里每次写步长都补一次。 */
function parallaxTargetLift(el, on) {
  const list = el && el.classList;
  if (!list) return;
  if (on) {
    if (typeof list.add === 'function') list.add(PARALLAX_MOVING_CLASS);
    return;
  }
  if (typeof list.remove === 'function') list.remove(PARALLAX_MOVING_CLASS);
}

/** 从一个目标身上收掉本层留下的一切（合成层提示 + 两个步长变量）。 */
function parallaxTargetClear(rec) {
  const el = rec && rec.el;
  if (!el) return;
  parallaxTargetLift(el, false);
  const style = el.style;
  if (style && typeof style.removeProperty === 'function') {
    try {
      style.removeProperty(PARALLAX_VAR_X);
      style.removeProperty(PARALLAX_VAR_Y);
    } catch (e) { /* 已卸载 */ }
  }
  rec.key = '';
}

function parallaxTargetsClear() {
  for (let i = 0; i < parallaxTargets.length; i += 1) parallaxTargetClear(parallaxTargets[i]);
  parallaxTargets = [];
  parallaxTargetsMs = 0;
}

/**
 * 重扫那几层（帧里每 PARALLAX_TARGETS_MS 一次，不是每帧）。走掉的**当场**把类与变量收干净，
 * 新来的补进记录并让下一帧整批重写一遍（新元素身上还没有步长）。
 */
function parallaxTargetsRefresh(now) {
  if (typeof document === 'undefined' || !document
    || typeof document.querySelectorAll !== 'function') return;
  const found = document.querySelectorAll(PARALLAX_TARGET_SELECTOR);
  const prev = parallaxTargets;
  const next = [];
  let fresh = false;
  for (let i = 0; i < found.length; i += 1) {
    const el = found[i];
    let rec = null;
    for (let j = 0; j < prev.length; j += 1) {
      if (prev[j].el === el) { rec = prev[j]; prev[j].kept = true; break; }
    }
    if (!rec) { rec = { el: el, key: '' }; fresh = true; }
    next.push(rec);
  }
  for (let j = 0; j < prev.length; j += 1) {
    if (prev[j].kept) { prev[j].kept = false; continue; }
    parallaxTargetClear(prev[j]);
  }
  parallaxTargets = next;
  parallaxTargetsMs = now;
  if (fresh) parallaxStepKey = '';
}

/** 收工：把合成层提示摘掉（本仓刻意不留常驻合成层）；步长变量留着，下次 pointermove 直接续上。 */
function parallaxTargetsSettle() {
  for (let i = 0; i < parallaxTargets.length; i += 1) parallaxTargetLift(parallaxTargets[i].el, false);
}

/** 各层的百分比（只在设置变了时写一次，落在 body 上）：位移 = 步长 × 这里的百分比。 */
function parallaxRatios(st) {
  const body = parallaxBody();
  if (!body) return;
  const mascot = st.mascot ? st.bg : 0;
  const key = [st.bg, mascot, st.metrics, st.metrics + PARALLAX_LABEL_STEP,
    st.metrics + PARALLAX_GUIDE_STEP].join('|');
  if (key === parallaxRatioKey) return;
  parallaxRatioKey = key;
  parallaxVarOn(body, PARALLAX_VAR_BG, String(st.bg));
  parallaxVarOn(body, PARALLAX_VAR_MASCOT, String(mascot));
  parallaxVarOn(body, PARALLAX_VAR_METRICS, String(st.metrics));
  parallaxVarOn(body, PARALLAX_VAR_LABELS, String(st.metrics + PARALLAX_LABEL_STEP));
  parallaxVarOn(body, PARALLAX_VAR_GUIDES, String(st.metrics + PARALLAX_GUIDE_STEP));
}

/** 把 5 个系数变量从 body 上收掉（停用后 body 上不留本层的任何痕迹）。 */
function parallaxRatioClear() {
  const body = parallaxBody();
  const style = body && body.style;
  if (!style || typeof style.removeProperty !== 'function') return;
  const props = [PARALLAX_VAR_BG, PARALLAX_VAR_MASCOT, PARALLAX_VAR_METRICS,
    PARALLAX_VAR_LABELS, PARALLAX_VAR_GUIDES];
  for (let i = 0; i < props.length; i += 1) {
    try { style.removeProperty(props[i]); } catch (e) { /* 已卸载 */ }
  }
}

/**
 * 每一步的像素步长（每帧写一次）：两位小数够用 —— 屏上的位移是"步长 × 百分比"，再细也看不出来。
 * **写在要动的那几层自己身上**，不写 body：自定义属性是继承的，写在 body 上等于每帧让整棵文档树
 * 重算样式（这条链路上最贵的一笔）；写在元素上，失效范围就只有那几个元素。
 */
function parallaxSteps() {
  if (!parallaxTargets.length) return;
  const key = parallaxStepX.toFixed(2) + '|' + parallaxStepY.toFixed(2);
  if (key === parallaxStepKey) return;
  parallaxStepKey = key;
  const x = parallaxStepX.toFixed(2) + 'px';
  const y = parallaxStepY.toFixed(2) + 'px';
  for (let i = 0; i < parallaxTargets.length; i += 1) {
    const rec = parallaxTargets[i];
    rec.key = key;
    parallaxTargetLift(rec.el, true);
    parallaxVarOn(rec.el, PARALLAX_VAR_X, x);
    parallaxVarOn(rec.el, PARALLAX_VAR_Y, y);
  }
}

/** 总开关属性：开了才让那几条视差规则命中（关掉时屏上不留任何痕迹）。 */
function parallaxAttr(on) {
  const body = parallaxBody();
  if (!body) return;
  if (on) {
    if (typeof body.setAttribute === 'function') body.setAttribute(PARALLAX_ATTR, 'on');
    return;
  }
  if (typeof body.removeAttribute === 'function') body.removeAttribute(PARALLAX_ATTR);
}

function parallaxOnPointerMove(e) {
  if (!parallaxOn) return;
  parallaxX = e.clientX;
  parallaxY = e.clientY;
  parallaxSeen = true;
  parallaxMoveMs = parallaxNow();
  parallaxKick();
}

/** 换窗口大小 ⇒ 中心跟着变（同一次光标位置的目标位移不同）：重读视口、再算一帧。 */
function parallaxOnResize() {
  if (!parallaxOn) return;
  parallaxReadViewport();
  parallaxKick();
}

function parallaxBind() {
  if (parallaxBound) return;
  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
  // passive：只读事件，绝不拦指针（屏上也没有属于本层的元素）。
  document.addEventListener('pointermove', parallaxOnPointerMove, { passive: true });
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('resize', parallaxOnResize, { passive: true });
  }
  parallaxBound = true;
}

function parallaxUnbind() {
  if (!parallaxBound) return;
  try {
    document.removeEventListener('pointermove', parallaxOnPointerMove);
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('resize', parallaxOnResize);
    }
  } catch (e) { /* 已卸载 */ }
  parallaxBound = false;
}

/** 起一帧（已经在跑就不重复排）：由 pointermove / resize 与自己的帧尾调用。 */
function parallaxKick() {
  if (parallaxRaf) return;
  if (typeof requestAnimationFrame !== 'function') return;
  parallaxRaf = requestAnimationFrame(parallaxFrame);
}

/**
 * 一帧：把步长朝目标逼近一截、写下去，没到位就再排一帧。
 * 目标只看"光标相对中心的偏移"与视口尺寸 —— 视口就是那条对角线的两端，光标走完对角线时
 * 位移正好改变 pct% 个对角线（用户口径的那个定义）。
 */
function parallaxFrame(ms) {
  parallaxRaf = 0;
  if (!parallaxOn) return;
  const st = parallaxSettings();
  if (!st.on) { parallaxStop(); return; }
  const now = typeof ms === 'number' ? ms : parallaxNow();
  // 帧率封顶：高刷屏上多出来的那些帧只重排、不写变量（缓动本来就按 60fps 折算）。
  if (parallaxLastMs && now - parallaxLastMs < PARALLAX_MIN_FRAME_MS) { parallaxKick(); return; }
  if (parallaxVw <= 0 || parallaxVh <= 0) parallaxReadViewport();
  if (!parallaxTargets.length || now - parallaxTargetsMs >= PARALLAX_TARGETS_MS) {
    parallaxTargetsRefresh(now);
  }
  const vw = parallaxVw > 0 ? parallaxVw : 1;
  const vh = parallaxVh > 0 ? parallaxVh : 1;
  const cx = parallaxSeen ? parallaxX : vw / 2;
  const cy = parallaxSeen ? parallaxY : vh / 2;
  const targetX = PARALLAX_DIRECTION * (cx - vw / 2) / 100;
  const targetY = PARALLAX_DIRECTION * (cy - vh / 2) / 100;
  // 一层都不动（系数全 0）⇒ 屏上什么都不会变：一次落位、收工，一帧都不多排。
  const pctMax = Math.max(st.bg, st.metrics + PARALLAX_GUIDE_STEP);
  if (pctMax <= 0) {
    parallaxStepX = targetX;
    parallaxStepY = targetY;
    parallaxSteps();
    parallaxTargetsSettle();
    return;
  }
  // 指数逼近：a = 每 16.7ms 吃掉剩余距离的比例（smooth=0 ⇒ a=1 ⇒ 直接落位，像贴在光标上）。
  const a = 1 - st.smooth / 100;
  const dt = parallaxLastMs ? Math.min(PARALLAX_DT_MAX, Math.max(1, now - parallaxLastMs))
    : PARALLAX_FRAME_MS;
  parallaxLastMs = now;
  const f = a <= 0 ? 1 : 1 - Math.pow(1 - a, dt / PARALLAX_FRAME_MS);
  parallaxStepX += (targetX - parallaxStepX) * f;
  parallaxStepY += (targetY - parallaxStepY) * f;
  // 到位判据按**屏上还剩多少位移**算（剩余步长 × 最大系数）；光标静下来一会儿之后放宽
  // —— 尾巴上那点位移早看不出来了，与其再画十几帧，不如一次抹平收工。
  const idle = parallaxMoveMs > 0 && now - parallaxMoveMs >= PARALLAX_IDLE_MS;
  const settle = Math.max(PARALLAX_SETTLE_PX,
    (idle ? PARALLAX_IDLE_VISIBLE_PX : PARALLAX_SETTLE_VISIBLE_PX) / pctMax);
  const doneX = Math.abs(targetX - parallaxStepX) <= settle;
  const doneY = Math.abs(targetY - parallaxStepY) <= settle;
  if (doneX) parallaxStepX = targetX;
  if (doneY) parallaxStepY = targetY;
  parallaxRatios(st);
  parallaxSteps();
  if (!doneX || !doneY) parallaxKick();
  else parallaxTargetsSettle();
}

/**
 * 起（幂等）。**没有 rAF 的环境连 DOM 都不碰**：这一层是装饰，宁可不画，
 * 也不要在没有帧时钟的地方留半截状态（无头/测试沙箱走的就是这条）。
 */
function parallaxStart() {
  if (typeof requestAnimationFrame !== 'function') return;
  parallaxOn = true;
  parallaxAttr(true);
  parallaxReadViewport();
  parallaxRatios(parallaxSettings());
  parallaxBind();
  parallaxKick();
}

/** 全停（rAF、事件、临时合成层、变量、开关属性）。 */
function parallaxStop() {
  parallaxOn = false;
  if (parallaxRaf) {
    try { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(parallaxRaf); } catch (e) { /* 已卸载 */ }
    parallaxRaf = 0;
  }
  parallaxUnbind();
  parallaxTargetsClear();
  parallaxRatioClear();
  parallaxStepX = 0;
  parallaxStepY = 0;
  parallaxSeen = false;
  parallaxLastMs = 0;
  parallaxMoveMs = 0;
  parallaxStepKey = '';
  parallaxRatioKey = '';
  parallaxVw = 0;
  parallaxVh = 0;
  parallaxAttr(false);
}

/**
 * 设置变了就调一次（由 `src/client.js` 的 `subscribe(syncParallaxLayer)` 驱动）。
 * 它只决定"该不该活"，不碰具体参数 —— 那些每帧现读。
 */
function syncParallaxLayer() {
  const st = parallaxSettings();
  if (!st.on) {
    parallaxStop();
    return;
  }
  parallaxStart();
}

/** 卸载：本模块拥有的一切都收掉（监听、rAF、变量、开关属性）。 */
function disposeParallaxLayer() {
  parallaxStop();
}

export { syncParallaxLayer, disposeParallaxLayer };
