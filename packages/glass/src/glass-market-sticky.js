/**
 * glass-market-sticky.js — 插件市场（dsh-market）吸顶条的「下层内容裁切」。
 *
 * ## 它解决什么
 * 玻璃把宿主的层令牌换成半透明之后，第三方插件市场的吸顶行（搜索框 + 分类 pill）**仍然是
 * 半透明**：卡片墙从它底下滚过去时，卡片文字直接透上来与搜索框叠在一起 —— 用户报障的
 * 「吸顶的搜索/分类条在自定义主题下会盖住卡片文字」。给吸顶行补实底是最直觉的修法，但
 * 那样搜索条自己就不再是玻璃了（与「壁纸透出来」的整体观感打架）。这里换一条路：
 * **把那层内容在吸顶行下沿裁掉** —— 吸顶行照旧半透明，它下面没有东西可透，于是看起来
 * 是一块干净的玻璃；卡片则在切口处消失（渐隐带里一路淡出，像溶进壁纸）。
 *
 * ## 为什么不是纯 CSS
 * 「切口恒贴吸顶行下沿」要求每帧拿到 getBoundingClientRect().bottom（吸顶行高会随分类
 * 换行、筛选说明出现而变化），并把裁切位置写进**滚动的那个后代** —— 纯 CSS 只能裁滚动容器
 * 自己（那样搜索/分类条会被一起裁掉），或者要求宿主把 chrome 移出滚动容器（改不动宿主）。
 *
 * ## 为什么用 mask 而不是 clip-path
 * 用户实测两版：硬切口（clip-path: inset）能修好叠字，但切口是一条生硬的直边；换成
 * mask-image 的线性渐变后「整体更好」（卡片在 ~26px 里淡出，接口不显眼）。代价记在下面。
 *
 * ## 结构锚点（为什么这么写选择器）
 * 市场根节点带稳定属性 data-dsh-market-root（跨构建不变）；里面的类名是 CSS Module 哈希
 * （实测 nUhMVa_stickyHead 这种，前缀随构建变）⇒ 只用**可读词**做 * 通配兜底：
 * 吸顶行 = _stickyHead / _head / _cats 里 position 为 sticky/fixed 的那些；
 * 要裁的层 = _masonry / _loadMore / _recentBlock / _recentRow（只裁最外层，且不在吸顶行子树里）。
 * ⚠️ _head 会同时匹配到 _stickyHead，所以「哪个才是吸顶层」必须由 position 判定，
 *    不能只靠类名（否则 band 会取到顶栏那行的 bottom，切口出现在页面最上面）。
 *
 * ## 谁在驱动
 * 门与值都来自 body 属性 data-we-market-sticky（glass.js 按 marketStickyClip /
 * marketStickyFade 写）：**属性在不在 = 开不开**，属性值 = 渐隐带宽度 px（0 = 硬切口，
 * 所以不能拿值当门）。本文件**不读 settings** —— 「读谁只在这里决定」的契约在 glass.js。
 * 生命周期：applyGlassLayer 调 sync、disposeGlassLayer 调 stop（成对；漏 stop ⇒ 插件卸载后
 * 宿主 DOM 上留下我们不认识的 mask，而且没人再改回去）。
 *
 * ## 已知代价（用户侧已实测接受）
 * · mask 让元素成为**渲染组**：它后代的 backdrop-filter 采样被限制在组内（clip-path 无此
 *   副作用）。市场卡片里没有玻璃面，暂时无感 —— 但这是这条路的固有代价，不是遗漏。
 * · 长列表上 mask 比 clip-path 多一次离屏合成；卡顿就说明该退回 clip-path（改这里的写法即可）。
 * · 渐隐带里滚过的文字会一路虚到 0，嫌虚就把 fade 调小（12–16 更接近硬切口的手感）。
 *
 * ## 踩过的坑：还原判断不能用「我们写下去的原串」
 * 第一版把 mask 原串记进 rec.written，还原时比对 el.style.getPropertyValue("mask-image")
 * !== rec.written ⇒ 以为「别人改过这一格」，于是**永远不还原**。Chrome 会规范化：省掉
 * "to bottom"、把 rgba(0,0,0,1) 写成 rgb(0,0,0)。用户实测：往下滚再滚回顶部后，卡片墙
 * 顶部留了一条 73.5px 的渐隐带（探针里 mask 仍是 linear-gradient(rgba(0, 0, 0, 0) 73.5px,
 * rgb(0, 0, 0) 99.5px)，而那一刻 band 只有 352、masonry 顶在 506 ⇒ 本该 cut<0 已还原 ——
 * 它停在「最近收录」正下方，看起来就像「最近收录把下面挖掉一块」。
 * 现在一律记录**读回来的序列化值**（marketStickyRead），比较也用读回值。
 *
 * ## 刷新节拍
 * scroll（**capture**：scroll 不冒泡，只有捕获能收到内层滚动容器的滚动）+ resize 触发
 * rAF 合帧；另有 400ms 的兜底轮询，管「没有滚动但几何变了」的两种情形（切换市场页签、
 * 卡片/图片加载后长高）。刻意**不用**全局 MutationObserver：宿主页面在对话流式渲染时
 * 每帧都有大量 DOM 变更，全局 subtree observer 的回调开销远大于 4 次/秒的几何取样。
 */

/** body 门控属性（glass.js 写、这里只读）。 */
const MARKET_STICKY_ATTR = "data-we-market-sticky";
/** 市场根节点（唯一跨构建稳定的锚点）。 */
const MARKET_ROOT_SELECTOR = "[data-dsh-market-root]";
/** 候选吸顶行：可读词兜底，真正的判定是 position: sticky / fixed。 */
const MARKET_STICKY_SELECTOR = '[class*="_stickyHead"], [class*="_head"], [class*="_cats"]';
/** 会被吸顶行盖住的层：卡片墙 / 加载更多 / 「最近收录」那一块。 */
const MARKET_SCROLL_SELECTOR = '[class*="_masonry"], [class*="_loadMore"], [class*="_recentBlock"], [class*="_recentRow"], [class*="_recentShow"]';
/** 兜底轮询间隔（几何变化但没有滚动事件时的唯一发现途径）。 */
const MARKET_STICKY_POLL_MS = 400;

/**
 * 读内联样式的安全壳：单测夹具里的假 style 可能只有 setProperty / removeProperty
 * （verify-client 的假 DOM 就是这样），直接调 getPropertyValue 会当场 TypeError。
 */
function marketStickyRead(el, prop) {
  try {
    if (el.style && typeof el.style.getPropertyValue === "function") return el.style.getPropertyValue(prop);
  } catch (err) { /* 读不到就当没有 */ }
  return "";
}

function marketStickyPriority(el, prop) {
  try {
    if (el.style && typeof el.style.getPropertyPriority === "function") return el.style.getPropertyPriority(prop);
  } catch (err) { /* 同上 */ }
  return "";
}

let marketStickyRunning = false;
let marketStickyTimer = 0;
let marketStickyRaf = 0;
/** 我们写过样式的元素（WeakMap：元素被卸载即随之回收，不阻止 GC）。 */
const marketStickyWritten = new WeakMap();
/** 当前被写过的元素（WeakMap 不可遍历 ⇒ 另存一份，用于「本轮没见到就还回去」）。 */
let marketStickyTargets = new Set();

/**
 * 门控判定：属性在不在（0 也是有效值，所以不能拿值当门）。
 * ⚠️ 这里**不用** body.hasAttribute：宿主 / 单测夹具里的 document 可能只实现了 getAttribute
 * （verify-client 的假 DOM 就是这样，缺方法会当场 TypeError 把整个 inject 打断）。
 */
function marketStickyEnabled() {
  const body = typeof document !== "undefined" ? document.body : null;
  if (!body) return false;
  if (typeof body.hasAttribute === "function") return body.hasAttribute(MARKET_STICKY_ATTR);
  if (typeof body.getAttribute === "function") return body.getAttribute(MARKET_STICKY_ATTR) !== null;
  return false;
}

/** 渐隐带宽（px）：属性值即像素数；读不到就给 26（与设置默认值一致）。 */
function marketStickyFade() {
  const raw = Number(document.body.getAttribute(MARKET_STICKY_ATTR));
  if (!Number.isFinite(raw)) return 26;
  return Math.max(0, Math.min(60, raw));
}

/** 把某个元素上的 mask 还回我们接手前的样子（只还自己写过的值）。 */
function marketStickyRestoreOne(el) {
  const rec = marketStickyWritten.get(el);
  if (!rec) return;
  marketStickyWritten.delete(el);
  marketStickyTargets.delete(el);
  // 别人在这期间改过这一格 ⇒ 不动（与 src/client/rope-dock.js 写宿主内联样式的收法同款）。
  // ⚠️ 比较的是「浏览器读回来的值」，不是我们写下去的原串 —— 见 marketStickyPaint 里的注释。
  const cur = marketStickyRead(el, "mask-image");
  if (cur !== "" && cur !== rec.written) return;
  el.style.removeProperty("mask-image");
  el.style.removeProperty("-webkit-mask-image");
  if (rec.beforeMask) el.style.setProperty("mask-image", rec.beforeMask, rec.beforeMaskPriority);
  if (rec.beforeWebkit) el.style.setProperty("-webkit-mask-image", rec.beforeWebkit, rec.beforeWebkitPriority);
}

/** 全部还回去（关掉开关 / 换页签 / 卸载）。 */
function marketStickyRestoreAll() {
  for (const el of Array.from(marketStickyTargets)) marketStickyRestoreOne(el);
  marketStickyTargets = new Set();
}

/** 写一格的 mask（值没变就不写：内联样式赋值会触发样式重算）。 */
function marketStickyPaint(el, cut, fade, height) {
  let mask;
  if (cut >= height) {
    // 整块都在吸顶行上面 ⇒ 全遮（不会有「半格可见」的闪边）。
    mask = "linear-gradient(to bottom, rgba(0, 0, 0, 0) 0px, rgba(0, 0, 0, 0) 100%)";
  } else if (fade <= 0) {
    // 硬切口：渐变在同一个位置从透明跳到实心，等价于 clip-path 但仍是 mask 通道。
    mask = "linear-gradient(to bottom, rgba(0, 0, 0, 0) " + cut + "px, rgba(0, 0, 0, 1) " + cut + "px)";
  } else {
    // 不收尾（不写末停靠点）= 末色一路延续到底，切口以下完全可见。
    mask = "linear-gradient(to bottom, rgba(0, 0, 0, 0) " + cut + "px, rgba(0, 0, 0, 1) "
      + (cut + fade) + "px)";
  }
  let rec = marketStickyWritten.get(el);
  if (rec === undefined) {
    rec = {
      beforeMask: marketStickyRead(el, "mask-image"),
      beforeWebkit: marketStickyRead(el, "-webkit-mask-image"),
      beforeMaskPriority: marketStickyPriority(el, "mask-image"),
      beforeWebkitPriority: marketStickyPriority(el, "-webkit-mask-image"),
      written: "",
    };
    marketStickyWritten.set(el, rec);
    marketStickyTargets.add(el);
  }
  if (rec.written === mask) return;
  el.style.setProperty("-webkit-mask-image", mask);
  el.style.setProperty("mask-image", mask);
  // ⚠️ 记**读回来的序列化值**，不要记上面那个原串：Chrome 会把 "to bottom" 省掉、把
  // rgba(0,0,0,1) 规范成 rgb(0,0,0)，于是 getPropertyValue 永远 !== 原串 ⇒ 还原判断
  // 「别人改过这一格」恒成立，mask 永远撕不掉。后果是滚动回顶部后卡片墙顶部仍留一条
  // 渐隐带（用户报的「最近收录下方一块缺失区域」就是这个：73.5px 的切口停在原地）。
  rec.written = marketStickyRead(el, "mask-image") || mask;
}

/** 吸顶行的下沿（视口坐标里的 band）：取所有 sticky/fixed 候选里最靠下的那条。 */
function marketStickyBand(root) {
  let band = -Infinity;
  for (const el of root.querySelectorAll(MARKET_STICKY_SELECTOR)) {
    const position = getComputedStyle(el).position;
    if (position !== "sticky" && position !== "fixed" && position !== "-webkit-sticky") continue;
    const bottom = el.getBoundingClientRect().bottom;
    if (bottom > band) band = bottom;
  }
  if (Number.isFinite(band)) return band;
  // 兜底：可读词没命中（宿主改了命名）⇒ 退到 stickyHead 本身；它不在视口内也没关系，
  // rect 照样给出它当前的位置（吸顶态就是贴在滚动容器顶部）。
  const head = root.querySelector('[class*="_stickyHead"]');
  return head ? head.getBoundingClientRect().bottom : null;
}

/** 一帧的完整同步：找根 → 量 band → 逐层写 mask → 还掉本轮没见到的。 */
function marketStickySync() {
  marketStickyRaf = 0;
  if (typeof document === "undefined" || !document.body) return;
  const active = marketStickyEnabled() && document.visibilityState !== "hidden";
  // 假 DOM（单测夹具）可能没有 querySelector ⇒ 取不到根就当作"页面里没有市场"。
  const root = active && typeof document.querySelector === "function"
    ? document.querySelector(MARKET_ROOT_SELECTOR) : null;
  if (root === null) {
    marketStickyRestoreAll();
    return;
  }
  const band = marketStickyBand(root);
  if (band === null) {
    marketStickyRestoreAll();
    return;
  }
  const fade = marketStickyFade();
  const seen = new Set();
  for (const el of root.querySelectorAll(MARKET_SCROLL_SELECTOR)) {
    // 吸顶行自己（或它的子树）永远不裁 —— 那正是要保住的那一层。
    if (el.closest(MARKET_STICKY_SELECTOR) !== null) continue;
    // 只裁最外层：_masonryCol 的类名同样含 _masonry、_recentRow 含在 _recentBlock 里，
    // 父元素已经 mask 过一遍，子元素再叠同位置的切口只会多一次离屏合成；更糟的是父元素
    // 先被还原后，子元素会留下一个独立的洞（用户看到的「缺一块」也可能来自这里）。
    let nested = false;
    for (let up = el.parentElement; up !== null && up !== root; up = up.parentElement) {
      if (typeof up.matches === "function" && up.matches(MARKET_SCROLL_SELECTOR)) { nested = true; break; }
    }
    if (nested) { marketStickyRestoreOne(el); continue; }
    seen.add(el);
    const rect = el.getBoundingClientRect();
    if (rect.height <= 0) { marketStickyRestoreOne(el); continue; }
    const cut = band - rect.top;
    if (cut <= 0.5) { marketStickyRestoreOne(el); continue; }
    marketStickyPaint(el, Math.round(cut * 2) / 2, fade, rect.height);
  }
  for (const el of Array.from(marketStickyTargets)) {
    if (!seen.has(el)) marketStickyRestoreOne(el);
  }
}

function marketStickyRequest() {
  if (marketStickyRaf) return;
  if (typeof requestAnimationFrame !== "function") { marketStickySync(); return; }
  marketStickyRaf = requestAnimationFrame(() => marketStickySync());
}

/**
 * 开（或续命）这份行为：applyGlassLayer 每次重跑都会调到这里 ⇒ 「开关打开」不需要额外的
 * 属性观察器，下一次 emit 就会把监听器装上。
 */
function syncMarketStickyClip() {
  if (typeof document === "undefined" || typeof window === "undefined" || !document.body) return;
  if (!marketStickyEnabled()) { stopMarketStickyClip(); return; }
  // 假 DOM / 极端环境：没有 addEventListener 就没法按滚动刷新，宁可不装。
  if (typeof window.addEventListener !== "function") return;
  if (marketStickyRunning) { marketStickyRequest(); return; }
  marketStickyRunning = true;
  // capture 必需：scroll 不冒泡，内层滚动容器（市场的 _body）的滚动只有捕获阶段收得到。
  window.addEventListener("scroll", marketStickyRequest, { capture: true, passive: true });
  window.addEventListener("resize", marketStickyRequest, { passive: true });
  document.addEventListener("visibilitychange", marketStickyRequest);
  if (typeof window.setInterval === "function") {
    marketStickyTimer = window.setInterval(marketStickyRequest, MARKET_STICKY_POLL_MS);
  }
  marketStickyRequest();
}

/** 关：摘监听 + 把写过的 mask 全部还回去（幂等；dispose 与「开关关掉」共用）。 */
function stopMarketStickyClip() {
  if (!marketStickyRunning) { marketStickyRestoreAll(); return; }
  marketStickyRunning = false;
  if (typeof window !== "undefined") {
    window.removeEventListener("scroll", marketStickyRequest, { capture: true });
    window.removeEventListener("resize", marketStickyRequest);
    if (marketStickyTimer && typeof window.clearInterval === "function") window.clearInterval(marketStickyTimer);
  }
  if (marketStickyTimer) marketStickyTimer = 0;
  if (marketStickyRaf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(marketStickyRaf);
  marketStickyRaf = 0;
  if (typeof document !== "undefined") document.removeEventListener("visibilitychange", marketStickyRequest);
  marketStickyRestoreAll();
}
