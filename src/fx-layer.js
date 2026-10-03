/**
 * fx-layer.js — 「点击效果与拖尾效果」的**画布层**：壁纸之上那层随光标响应的光效。
 *
 * ══ 为什么是这样一个角色 ══════════════════════════════════════════════════════
 * 它是**基座模块**（见 docs/CODE-STRUCTURE.md §3.1）：不吃 ctx、直接读扁平设置 store
 * `selection`，和 `video-layer` / `effects` 同层 —— 因为它的驱动源不是某次渲染，而是
 * **输入事件**（pointermove / pointerdown）与一个 rAF 循环。渲染器给它传 ctx 反而要把每个
 * 设置项穿一遍，而"点了就有反应"这件事必须当场发生，等一次 emit 只会显得迟钝。
 *
 * ══ 它画什么 ═════════════════════════════════════════════════════════════════
 *   · **点击效果**（`fxClick`）：指针按下时，在落点炸开一圈光效 —— `ripple` 是两圈扩散的
 *     渐隐圆环、`spark` 是一簇向外飞散的亮点（各带一小段尾巴 + 中心一次白闪），
 *     `both` 是两者一起。半径走 `fxClickSize`、光晕走 `fxClickGlow`，寿命是常量
 *     `FX_CLICK_LIFE_MS`（一次点击 0.9 s 内画完 —— 再长就成了"屏上贴着个圈"）。
 *   · **拖尾效果**（`fxTrail`）：指针划过时按 `FX_TRAIL_STEP_PX` 采样落点，`comet` 把相邻
 *     两点连成一条按年龄收细、降透明度的圆头光带，`dust` 每隔 `FX_DUST_STEP_PX` 在途经处
 *     留下一个亮点（星尘）。**点的存活完全由时间决定**（超过 `fxTrailLength` ms 就剔除）⇒
 *     光标停住后轨迹会自己淡完，不需要任何"抬手"事件。
 *   · **配色**（`fxColorMode`）：`accent` 读运行时令牌 `--we-accent`（= 「外观」页签的配色）、
 *     `rainbow` 每个效果实例取一个不同色相且随时间流转、`custom` 用 `fxColor` 那一个颜色。
 *   · **观感**（`fxOpacity` / `fxBlend`）：整层不透明度与 `mix-blend-mode` 都写在**宿主元素**
 *     上（见不变量）。默认滤色，因为这一层是"发光"—— 它只让画面变亮，暗背景上最像霓虹。
 *
 * 契约：
 *   需要的外界：`selection`（设置 store，只读）。
 *   对外提供：`syncFxLayer()`（设置变了 / 壁纸层变了就调一次）、`disposeFxLayer()`（卸载清理）。
 *   设置项（`fx*`，真源 lib/settings-schema.js）：启用 / 点击开关与样式与半径与光晕 /
 *   拖尾开关与样式与时长与粗细与光晕 / 不透明度 / 混合模式 / 配色档与自定义色。
 *
 * 不变量：
 *   · **只读 `selection`**：一个字节都不写（裸写棘轮只留给 media-prep / effects / live-layer）。
 *     拖动滑块时的即时反馈靠"每帧重读设置"，不靠写回。
 *   · **零顶层可执行语句**：本文件的顶层只有声明 —— 读 `selection` 的语句一律在函数里
 *     （内联后 prelude 早于 `src/client.js` 正文求值，顶层读它必撞 TDZ）。
 *   · **不读壁纸像素**：柱状图那层要靠采样壁纸判明暗（它有两套混合档），本层**刻意不做** ——
 *     一条常驻的光效层不值得每两秒 `drawImage` 一次，`fxBlend` 因此只有手选档（见 schema 注释）。
 *   · **不接管输入**：宿主是 `pointer-events: none` 的浮层，事件只被**读**（document 上的
 *     pointerdown / pointermove，passive）；点在界面控件上（`FX_UI_SELECTOR`）不产生效果 ——
 *     光效是"在壁纸上点的"，不是在设置面板上点的。
 *   · **挂了才活、只在有内容时跑**：`fxEnabled` 关掉、或点击与拖尾两个子开关都关掉 ⇒ 立刻
 *     停 rAF、把宿主摘掉。**帧循环是内容驱动的**：没有活着的点/圈就画完这一帧收工
 *     （`fxRaf = 0`），下一次 pointer 事件再用 `fxKick()` 起一帧 —— 空闲时零帧、零 CPU。
 *   · **没有 rAF 的环境连 DOM 都不建**（无头/测试沙箱）：这一层是装饰，宁可不画，也不要在
 *     没有帧时钟的地方留半截状态。
 *   · ⚠️ 帧里**不许**用"宿主还没建"当早退条件：宿主是在 `fxStart()` 里建的，而帧由
 *     `requestAnimationFrame` 回调触发 —— 写成"没有宿主就 return"会退化成死锁
 *     （柱状图那层犯过一次：`!metricsHosts.length || !metricsData` ⇒ "扩展未显示"）。
 *     这里帧内只调一次幂等的 `fxEnsureHost()`（`isConnected` 就直接返回），永不早退。
 *   · **画在壁纸之上、柱状图与界面之下**：宿主是 `position: fixed; z-index: -1` 的 body 级
 *     浮层，DOM 序由 `fxPlace()` 每帧核对（柱状图三族与暗化层 `.we-scrim` 同是 `-1`，
 *     同层靠文档序分上下）⇒ 恒为 壁纸 → **本层** → 暗化层 → 柱状图 → 界面。
 *     `-webkit-app-region: initial !important` 与 `pointer-events: none` 是整屏浮层的硬要求
 *     （不得挖掉窗口拖拽区，见 src/styles.js 的 .we-layer 注释与 upstream #120）。
 */

const FX_HOST_ID = 'we-fx-layer';
const FX_DPR_MAX = 2;
/** 颜色解析失败的兜底（= 默认主题色，与柱状图那层同一个值）。 */
const FX_FALLBACK_COLOR = '#4f8cff';
/** 采样点的上限（一条拖尾最多记这么多点）：光标再快也不会把数组撑爆。 */
const FX_POINT_MAX = 96;
/** 同时活着的点击效果上限（连点/狂点时不至于越攒越多）。 */
const FX_CLICK_MAX = 24;
/** 一次点击效果的寿命（ms，常量不是设置项：它是"一击"的节奏，给旋钮只会被调坏）。 */
const FX_CLICK_LIFE_MS = 900;
/** 拖尾的采样间距（px）：相邻落点比这个还近就跳过 —— 否则慢速划过会堆一堆重叠的点。 */
const FX_TRAIL_STEP_PX = 3;
/** 星尘的落点间距（px）：每隔这么远留一个亮点（同一批采样点，画法不同）。 */
const FX_DUST_STEP_PX = 10;
/** 星火的条数（常量：密度是"炸开"的观感，与半径那个旋钮是两件事）。 */
const FX_SPARK_COUNT = 12;
/** 数值范围（与 lib/settings-schema.js 的 KINDS 对齐；画之前仍钳一次）。 */
const FX_CLICK_SIZE_MIN = 40;
const FX_CLICK_SIZE_MAX = 400;
const FX_TRAIL_MS_MIN = 80;
const FX_TRAIL_MS_MAX = 2000;
const FX_TRAIL_W_MIN = 1;
const FX_TRAIL_W_MAX = 12;
const FX_OPACITY_MIN = 10;
const FX_OPACITY_MAX = 100;
/** 点在这些元素上不算"在壁纸上点"（控件 / 面板 / 弹窗自己会响应点击）。 */
const FX_UI_SELECTOR = 'button, a, input, select, textarea, label, [role="button"], [contenteditable="true"], .we-picker, .we-modal';

let fxHost = null;
let fxCanvas = null;
let fxLastW = 0;
let fxLastH = 0;
let fxRaf = 0;
let fxOn = false;
let fxBound = false;
let fxAccent = '';
let fxSeed = 0;
let fxHue = 0;
/** 活着的拖尾点：{ x, y, t, hue }（`t` 是落点时刻，存活完全由它决定）。 */
let fxTrail = [];
/** 活着的点击效果：{ x, y, t0, seed, hue }。 */
let fxClicks = [];

/** 单调时钟（没有 performance 就退到 Date.now）；只用来算"这点多老了"。 */
function fxNow() {
  return window.performance && typeof window.performance.now === 'function'
    ? window.performance.now() : Date.now();
}

function fxClamp(v, lo, hi, fallback) {
  const n = typeof v === 'number' && isFinite(v) ? v : Number(v);
  if (!isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

/** 每个新效果实例取一个色相（rainbow 档用）：逐个错开，同屏几个效果颜色不撞。 */
function fxNextHue() {
  fxHue = (fxHue + 24) % 360;
  return fxHue;
}

/** 主题色：优先读运行时令牌 `--we-accent`（applyEffects 写的），读不到才用兜底。 */
function fxAccentColor() {
  if (fxAccent) return fxAccent;
  try {
    const v = window.getComputedStyle(document.body).getPropertyValue('--we-accent');
    fxAccent = (v && v.trim()) || FX_FALLBACK_COLOR;
  } catch (e) {
    fxAccent = FX_FALLBACK_COLOR;
  }
  return fxAccent;
}

/**
 * 设置快照（每帧现读 ⇒ 拖滑块不需要 emit 就能看到反馈）。
 * 档位取值刻意**只做字面量比较**、不引 lib/settings-schema.js 的值表：本文件要能被单独
 * import（test/verify-scene-live.mjs 就是这么测的）—— 引那份常量会在单文件环境里 ReferenceError。
 * 面板那侧相反：它读的就是 schema 的值表（唯一真源，见 src/ext-fx.js）。
 */
function fxSettings() {
  const on = selection.fxEnabled === true;
  const clickStyle = selection.fxClickStyle;
  const trailStyle = selection.fxTrailStyle;
  const colorMode = selection.fxColorMode;
  const color = selection.fxColor;
  return {
    on: on,
    click: selection.fxClick !== false,
    clickStyle: clickStyle === 'spark' || clickStyle === 'both' ? clickStyle : 'ripple',
    size: fxClamp(selection.fxClickSize, FX_CLICK_SIZE_MIN, FX_CLICK_SIZE_MAX, 140),
    clickGlow: fxClamp(selection.fxClickGlow, 0, 100, 60),
    trail: selection.fxTrail !== false,
    trailStyle: trailStyle === 'dust' ? 'dust' : 'comet',
    lifeMs: fxClamp(selection.fxTrailLength, FX_TRAIL_MS_MIN, FX_TRAIL_MS_MAX, 420),
    width: fxClamp(selection.fxTrailWidth, FX_TRAIL_W_MIN, FX_TRAIL_W_MAX, 3),
    trailGlow: fxClamp(selection.fxTrailGlow, 0, 100, 60),
    opacity: fxClamp(selection.fxOpacity, FX_OPACITY_MIN, FX_OPACITY_MAX, 85),
    // 混合模式是 CSS 字面量：非法值交给浏览器忽略，不做白名单（见文件头"不读壁纸像素"）。
    blend: typeof selection.fxBlend === 'string' && selection.fxBlend ? selection.fxBlend : 'screen',
    colorMode: colorMode === 'rainbow' || colorMode === 'custom' ? colorMode : 'accent',
    color: typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : FX_FALLBACK_COLOR,
  };
}

/** 建宿主（幂等）：一个 `div.we-fx` + 一张 `canvas.we-fx__canvas`，显隐全靠 CSS。 */
function fxEnsureHost() {
  if (fxHost && fxHost.isConnected) return;
  fxHost = document.createElement('div');
  fxHost.id = FX_HOST_ID;
  fxHost.className = 'we-fx';
  fxHost.setAttribute('aria-hidden', 'true');
  fxCanvas = document.createElement('canvas');
  fxCanvas.className = 'we-fx__canvas';
  fxHost.appendChild(fxCanvas);
  document.body.appendChild(fxHost);
  fxLastW = 0;
  fxLastH = 0;
  fxPlace();
}

/** 摘掉宿主（停用时不留空节点）。 */
function fxRemoveHost() {
  if (fxHost && fxHost.parentNode) fxHost.parentNode.removeChild(fxHost);
  fxHost = null;
  fxCanvas = null;
  fxLastW = 0;
  fxLastH = 0;
}

/**
 * 层级：本层与柱状图三族（`.we-metrics*`）、暗化层（`.we-scrim`）都是 `z-index: -1` 的 body 级
 * 浮层 —— 同 z-index 全靠**文档序**分上下。口径恒为：壁纸 → **本层** → 暗化层 → 柱状图 → 界面
 * （柱状图是"读数"、本层是"耍帅"，读数不该被光效晃掉；而光效必须压在暗化层之上，否则亮壁纸
 * 一旦被加暗，光效也跟着糊掉）。暗化层是**壁纸激活时**才挂的 ⇒ 这件事每帧核对一次，
 * 只用 `compareDocumentPosition` 判"位序对不对"，对了一次 DOM 都不动。
 */
function fxPlace() {
  if (!fxHost || !fxHost.parentNode) return;
  let metricsHost = null;
  let scrim = null;
  try {
    metricsHost = document.querySelector('.we-metrics');
    scrim = document.querySelector('.we-scrim');
  } catch (e) { return; }
  // DOM 位序掩码：2 = "另一方排在我前面"。
  if (metricsHost) {
    if (metricsHost.compareDocumentPosition(fxHost) & 2) return; // 已经排在柱状图之前
    if (metricsHost.parentNode) metricsHost.parentNode.insertBefore(fxHost, metricsHost);
    return;
  }
  if (!scrim || !scrim.parentNode) return;
  if (fxHost.compareDocumentPosition(scrim) & 2) return; // 已经排在暗化层之后
  scrim.parentNode.insertBefore(fxHost, scrim.nextSibling);
}

/** 画布按 dpr 归位（位图尺寸没变就返回 false，省一次 clear）。 */
function fxSizeCanvas(width, height, dpr) {
  if (!fxCanvas) return false;
  const w = Math.round(width * dpr);
  const h = Math.round(height * dpr);
  if (fxCanvas.width === w && fxCanvas.height === h) return false;
  fxCanvas.width = w;
  fxCanvas.height = h;
  fxCanvas.style.width = width + 'px';
  fxCanvas.style.height = height + 'px';
  return true;
}

/** 只在真的变了的时候写一条内联样式（`mix-blend-mode` 会触发合成层重建，别每帧无脑赋值）。 */
function fxNodeStyle(el, prop, value) {
  if (!el || !el.style) return;
  if (el.style.getPropertyValue(prop) === value) return;
  el.style.setProperty(prop, value);
}

/** 点在控件上就不算"在壁纸上点"（见 FX_UI_SELECTOR）。取不到 target 时按允许处理（宁可多画）。 */
function fxAllowClick(target) {
  if (!target || typeof target.closest !== 'function') return true;
  try { return !target.closest(FX_UI_SELECTOR); } catch (e) { return true; }
}

/** 压一个采样点（间距不够就跳过；超过上限丢最老的）。 */
function fxPushTrail(x, y) {
  const last = fxTrail.length ? fxTrail[fxTrail.length - 1] : null;
  if (last) {
    const dx = x - last.x;
    const dy = y - last.y;
    if (Math.sqrt(dx * dx + dy * dy) < FX_TRAIL_STEP_PX) return;
  }
  fxTrail.push({ x: x, y: y, t: fxNow(), hue: fxNextHue() });
  if (fxTrail.length > FX_POINT_MAX) fxTrail.splice(0, fxTrail.length - FX_POINT_MAX);
}

function fxOnPointerMove(e) {
  if (!fxOn) return;
  const st = fxSettings();
  if (!st.on || !st.trail) return;
  fxPushTrail(e.clientX, e.clientY);
  fxKick();
}

function fxOnPointerDown(e) {
  if (!fxOn) return;
  const st = fxSettings();
  if (!st.on || !st.click) return;
  if (!fxAllowClick(e.target)) return;
  fxSeed += 1;
  fxClicks.push({ x: e.clientX, y: e.clientY, t0: fxNow(), seed: fxSeed, hue: fxNextHue() });
  if (fxClicks.length > FX_CLICK_MAX) fxClicks.splice(0, fxClicks.length - FX_CLICK_MAX);
  fxKick();
}

function fxBind() {
  if (fxBound) return;
  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
  // passive：只读事件，绝不拦指针（本层也不吃 pointer-events）。
  document.addEventListener('pointermove', fxOnPointerMove, { passive: true });
  document.addEventListener('pointerdown', fxOnPointerDown, { passive: true });
  fxBound = true;
}

function fxUnbind() {
  if (!fxBound) return;
  try {
    document.removeEventListener('pointermove', fxOnPointerMove);
    document.removeEventListener('pointerdown', fxOnPointerDown);
  } catch (e) { /* 已卸载 */ }
  fxBound = false;
}

/** 起一帧（已经在跑就不重复排）：由 pointer 事件与自己的帧尾调用。 */
function fxKick() {
  if (fxRaf) return;
  if (typeof requestAnimationFrame !== 'function') return;
  fxRaf = requestAnimationFrame(fxFrame);
}

/**
 * 起（幂等）。**没有 rAF 的环境连 DOM 都不建**：这一层是装饰，宁可不画，
 * 也不要在没有帧时钟的地方留半截状态（无头/测试沙箱走的就是这条）。
 */
function fxStart() {
  if (typeof requestAnimationFrame !== 'function') return;
  fxOn = true;
  fxEnsureHost();
  fxBind();
  fxKick();
}

/** 全停（rAF、事件、DOM、攒下的点全收掉）。 */
function fxStop() {
  fxOn = false;
  if (fxRaf) {
    try { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(fxRaf); } catch (e) { /* 已卸载 */ }
    fxRaf = 0;
  }
  fxUnbind();
  fxRemoveHost();
  fxTrail = [];
  fxClicks = [];
  fxAccent = '';
}

/** 效果颜色：主题色 / 彩虹（每个实例一个色相，且随时间流转）/ 自定义。 */
function fxEffectColor(st, hue, now) {
  if (st.colorMode === 'custom') return st.color;
  if (st.colorMode === 'rainbow') {
    const h = (((hue + now / 12) % 360) + 360) % 360;
    return 'hsl(' + h.toFixed(1) + ', 92%, 66%)';
  }
  return fxAccentColor();
}

/** 星火的角度：均分一圈 + 按 seed 抖动（同一个 seed 每帧角度一致 ⇒ 不会原地乱抖）。 */
function fxSparkAngle(seed, i) {
  const noise = ((seed * 9301 + i * 49297) % 233280) / 233280;
  return (i / FX_SPARK_COUNT) * Math.PI * 2 + noise * 0.6;
}

/** 拖尾：`comet` 连成一条按年龄收细的光带；`dust` 按间距留下亮点。 */
function fxDrawTrail(g, now, st) {
  if (!st.trail || fxTrail.length < 2) return;
  const life = st.lifeMs;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (st.trailStyle === 'dust') {
    let acc = 0;
    for (let i = 1; i < fxTrail.length; i += 1) {
      const p = fxTrail[i];
      const prev = fxTrail[i - 1];
      acc += Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y);
      if (acc < FX_DUST_STEP_PX) continue;
      acc = 0;
      const f = 1 - (now - p.t) / life;
      if (f <= 0) continue;
      g.globalAlpha = Math.max(0, Math.min(1, f * f * 0.9));
      g.fillStyle = fxEffectColor(st, p.hue, now);
      g.shadowBlur = st.trailGlow * f * 0.4;
      g.shadowColor = g.fillStyle;
      g.beginPath();
      g.arc(p.x, p.y, Math.max(0.6, st.width * (0.45 + f * 0.75)), 0, Math.PI * 2);
      g.fill();
    }
    return;
  }
  for (let i = 1; i < fxTrail.length; i += 1) {
    const a = fxTrail[i - 1];
    const b = fxTrail[i];
    const f = 1 - (now - b.t) / life;
    if (f <= 0) continue;
    g.globalAlpha = Math.max(0, Math.min(1, f * f * 0.9));
    g.strokeStyle = fxEffectColor(st, b.hue, now);
    g.shadowColor = g.strokeStyle;
    g.shadowBlur = st.trailGlow * f * 0.35;
    g.lineWidth = Math.max(0.4, st.width * (0.25 + f * 0.75));
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
  }
}

/** 点击：`ripple` 两圈扩散的圆环 / `spark` 一簇飞散的亮点 + 中心一次白闪。 */
function fxDrawClicks(g, now, st) {
  if (!st.click) return;
  g.lineCap = 'round';
  for (let ci = 0; ci < fxClicks.length; ci += 1) {
    const c = fxClicks[ci];
    const p = Math.min(1, Math.max(0, (now - c.t0) / FX_CLICK_LIFE_MS));
    if (p >= 1) continue;
    const color = fxEffectColor(st, c.hue, now);
    if (st.clickStyle !== 'spark') {
      // 两圈：第二圈晚 18% 寿命起步（一圈太像"气泡"，两圈才有扩散的层次）。
      for (let k = 0; k < 2; k += 1) {
        const q = Math.min(1, p - k * 0.18);
        if (q <= 0) continue;
        const fade = (1 - q) * (1 - q);
        g.globalAlpha = 0.9 * fade;
        g.strokeStyle = color;
        g.shadowColor = color;
        g.shadowBlur = st.clickGlow * 0.4 * fade;
        g.lineWidth = Math.max(0.6, 3 * (1 - q));
        g.beginPath();
        g.arc(c.x, c.y, Math.max(0.5, st.size * (1 - Math.pow(1 - q, 3)) * (k ? 0.78 : 1)), 0, Math.PI * 2);
        g.stroke();
      }
    }
    if (st.clickStyle !== 'ripple') {
      const ease = 1 - Math.pow(1 - p, 3);
      const fade = (1 - p) * (1 - p);
      g.strokeStyle = color;
      g.shadowColor = color;
      g.shadowBlur = st.clickGlow * 0.35 * fade;
      g.lineWidth = Math.max(0.6, st.width * 0.7 * (1 - p));
      for (let i = 0; i < FX_SPARK_COUNT; i += 1) {
        const ang = fxSparkAngle(c.seed, i);
        // 每条飞多远略有差别（同一个 seed 定死）—— 等长会像一朵菊花，不等长才像火花。
        const reach = st.size * (0.45 + 0.55 * (((c.seed * 31 + i * 37) % 100) / 100)) * ease;
        const cos = Math.cos(ang);
        const sin = Math.sin(ang);
        g.globalAlpha = 0.9 * fade;
        g.beginPath();
        g.moveTo(c.x + cos * reach * 0.7, c.y + sin * reach * 0.7);
        g.lineTo(c.x + cos * reach, c.y + sin * reach);
        g.stroke();
      }
      const flash = Math.max(0, 1 - p * 3); // 中心那一下白闪只在前 1/3 寿命里
      if (flash > 0) {
        g.globalAlpha = 0.75 * flash;
        g.fillStyle = '#ffffff';
        g.shadowColor = color;
        g.shadowBlur = st.clickGlow * 0.5 * flash;
        g.beginPath();
        g.arc(c.x, c.y, Math.max(0.5, st.width * 1.6 * flash + 1), 0, Math.PI * 2);
        g.fill();
      }
    }
  }
}

/**
 * 一帧：老化的先剔、剩下的画、还有活着的就再排一帧。
 * ⚠️ 守卫只判"该不该画"（`fxOn` / `st.on`），**不判宿主在不在** —— 宿主由上面那行幂等的
 * `fxEnsureHost()` 保证（见文件头的死锁警告）。
 */
function fxFrame() {
  fxRaf = 0;
  const st = fxSettings();
  if (!fxOn || !st.on) return;
  fxEnsureHost();
  if (!fxCanvas) return; // 宿主被外力摘走了（不是"还没建"：上一行刚 ensure 过）
  const now = fxNow();
  const life = st.trail ? st.lifeMs : 0;
  fxTrail = fxTrail.filter((p) => now - p.t <= life);
  fxClicks = fxClicks.filter((c) => now - c.t0 <= FX_CLICK_LIFE_MS);
  const width = Math.max(1, Math.round(window.innerWidth || 1));
  const height = Math.max(1, Math.round(window.innerHeight || 1));
  const dpr = Math.min(window.devicePixelRatio || 1, FX_DPR_MAX);
  fxSizeCanvas(width, height, dpr);
  // 观感写在**宿主**上：`mix-blend-mode` 落在画布上只会跟宿主自己的 stacking context 混合
  // （等于不生效）—— 与柱状图那层同一条教训。
  fxNodeStyle(fxHost, 'mix-blend-mode', st.blend);
  fxNodeStyle(fxHost, 'opacity', String(st.opacity / 100));
  const g = fxCanvas.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, width, height);
  const active = fxClicks.length > 0 || fxTrail.length > 1;
  if (active) {
    // 'lighter' = 叠加发光：同一层里几段拖尾/几个圆环交叠处会更亮（霓虹感就来自这里）。
    g.globalCompositeOperation = 'lighter';
    fxDrawTrail(g, now, st);
    fxDrawClicks(g, now, st);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.shadowBlur = 0;
  }
  fxLastW = width;
  fxLastH = height;
  fxPlace();
  if (active) fxKick(); // 还有活着的点/圈 ⇒ 继续这一轮；画空了就自然收工（空闲零帧）
}

/**
 * 设置变了 / 壁纸层变了就调一次（由 `src/client.js` 的 `subscribe(syncFxLayer)` 驱动）。
 * 它只决定"该不该活"，不碰具体参数 —— 那些每帧现读。
 */
function syncFxLayer() {
  fxAccent = ''; // 主题色可能刚被 applyEffects 改过：作废缓存
  const st = fxSettings();
  if (!st.on || (!st.click && !st.trail)) {
    fxStop();
    return;
  }
  fxStart();
}

/** 卸载：本模块拥有的一切都收掉。 */
function disposeFxLayer() {
  fxStop();
  fxSeed = 0;
  fxHue = 0;
}

export { syncFxLayer, disposeFxLayer };
