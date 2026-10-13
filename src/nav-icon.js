/**
 * nav-icon.js — 「壁纸引擎」SVG 图标 + 设置导航图标补丁。
 *
 * 为什么单独一个文件：图标有两张消费面 —— ① 设置对话框左 nav（DOM 补丁，官方
 * `settings.section` 注册只收 id/order/label，图标是 shell 里 `navIcon(id)` 的硬编码
 * 映射，未知 section 一律给兜底齿轮，想换只能 DOM 替换）；② 官方右侧栏的 guide
 * 卡片（React 上下文，`icon: ComponentType<IconProps>`）。一个管 DOM 一个管 React，
 * 放在哪个面板渲染器里都别扭，独立成模块，图标的**几何**只在这里维护一份。
 *
 * 契约（构建期由 scripts/build-client.mjs 内联进 bundle 的工厂作用域，"外部作用域" =
 * 同一 prelude / src/client.js 的顶层）：
 *   · `WE_ICON_PARTS` 是图标几何的**唯一真源**（零件表）；`renderWeIcon`（React 元素）
 *     与 `weIconSvgString`（DOM innerHTML 字符串）都由它现算 —— 改图标只动那张表；
 *     颜色不进零件表，两 face 各自定（React 面固定家族色、DOM 面跟随文本色，见下）。
 *   · `renderWeIcon` 在**调用时**才读 React（同 panel-tabs.js 的口径）：本模块被内联到
 *     prelude，而 `const React = require("react")` 在 client.js 正文顶部，顶层读会撞 TDZ。
 *   · `installWeNavIcon()` 是纯 DOM 补丁：失败（结构变了 / 找不到按钮）的语义是
 *     **保留官方兜底齿轮**，绝不抛、绝不反复重试。返回 disposer（或 null = 没装上）。
 *   · 本文件必须保持浏览器安全（无 import / require / Node API），且**不得有顶层可执行语句**
 *     读 client.js 的 const（会被内联到 bundle 顶部，撞 TDZ）。
 */

// ── 图标几何（唯一真源）──────────────────────────────────────────────────────
// 设计：画框 + 太阳 + 山峦（壁纸 = 一张画），线条风格对齐官方图标族（16px 网格、
// 描边、圆角线帽线接）。描边宽度 1.4：nav 里 16px 实渲染时 1.5 偏糊、1.25 偏弱，
// 1.4 与官方 OutlineMedium 族视觉重量最接近。
// 颜色分两 face：React 面（右侧栏 guide 卡片）用**固定家族色** WE_ICON_GUIDE_INK ——
// 官方 guide artwork 全是固定调色板（Files 琥珀 #FFBC4D、Terminal #679EFE、
// Browser #539CFA，36 网格），跟随文本色会拿到容器的灰墨（--dsw-alias-label-secondary）
// 而显灰；#A797FC 取自官方 PluginArtworkLoop 的紫，与琥珀/蓝两个邻居错开色相。
// DOM 面（设置 nav 补丁）保持 currentColor —— 官方设置 nav 就是单色线条图标族。
const WE_ICON_GUIDE_INK = "#A797FC";
const WE_ICON_PARTS = [
  ["rect", { x: "1.7", y: "2.7", width: "12.6", height: "10.6", rx: "2.2" }],
  ["circle", { cx: "5.4", cy: "6.1", r: "1.05" }],
  ["path", { d: "M2.2 11.5l3-2.8 2.2 1.7 2.8-3 3.6 3.9" }],
];
const WE_ICON_VIEW_BOX = "0 0 16 16";

/** React 版图标（官方侧栏 guide 卡片等 React 上下文）：IconProps 形态（size / className）。 */
function renderWeIcon(props) {
  const size = (props && Number(props.size)) || 16;
  return React.createElement("svg", {
    viewBox: WE_ICON_VIEW_BOX,
    width: size,
    height: size,
    fill: "none",
    stroke: WE_ICON_GUIDE_INK,
    "stroke-width": "1.4",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    className: (props && props.className) || undefined,
    "aria-hidden": "true",
    focusable: "false",
  }, WE_ICON_PARTS.map(([tag, attrs]) => React.createElement(tag, attrs)));
}

/** 字符串版图标（DOM 补丁的 innerHTML 用）。 */
function weIconSvgString(size) {
  const attrs = 'viewBox="' + WE_ICON_VIEW_BOX + '" width="' + size + '" height="' + size
    + '" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"'
    + ' stroke-linejoin="round" aria-hidden="true" focusable="false"';
  const inner = WE_ICON_PARTS.map(([tag, attrs2]) => "<" + tag + " "
    + Object.keys(attrs2).map((k) => k + '="' + attrs2[k] + '"').join(" ") + "/>").join("");
  return "<svg " + attrs + ">" + inner + "</svg>";
}

// ── 设置导航图标补丁 ─────────────────────────────────────────────────────────
// 官方设置对话框的 nav 是 body 直接传送门（createPortal(..., document.body)），
// nav 按钮 = [图标元素, label 文本]。补丁在 overlay 挂进 body 时找到文本恰为
// 本插件 nav label 的按钮，把第一个子元素（那个 `<svg>` 兜底齿轮）换成**同为 `<svg>`**
// 的我们的图标 —— class 照抄是为了继承 shell 的 flex/尺寸约束（hash 类名会变，但抄的
// 是**那个元素**当前的 class，不是写死的 hash）；换 svg 而不是包 span 的理由（基线）
// 与取 class 必须走 getAttribute 的理由（SVGAnimatedString），见下面替换块里的注释。
// label 文本是我们自己注册的，是最稳定的锚 ——
// 它**随语言变**（en 下是 "Wallpaper Engine"）⇒ 匹配时现取 `weT("壁纸引擎")`；
// 语言切换后由 weOnLocaleChange 重放一次（已是本图标则跳过，见 data-we-nav-icon）。
function installWeNavIcon() {
  if (typeof document === "undefined" || !document.body) return null;
  if (typeof MutationObserver !== "function") return null;
  let patched = new WeakSet();
  const patchIn = (root) => {
    if (!root || typeof root.querySelectorAll !== "function") return;
    let buttons;
    try { buttons = root.querySelectorAll("nav button"); } catch { return; }
    const want = weT("壁纸引擎");
    for (const btn of buttons) {
      try {
        if (patched.has(btn)) continue;
        if ((btn.textContent || "").trim() !== want) continue;
        const iconEl = btn.firstElementChild;
        // 结构异常（没有独立图标子元素）= 放弃这枚按钮，保齿轮。
        if (!iconEl || iconEl === btn.lastElementChild && btn.childElementCount < 2) continue;
        // 已经是我们的图标（语言切换触发的重放）⇒ 只登记、不重复替换。
        try { if (iconEl.getAttribute("data-we-nav-icon") === "1") { patched.add(btn); continue; } } catch { /* ignore */ }
        // ── issue #194①：替换件必须**本身是 `<svg>`**，不能包一层 `<span>` ──────────
        // 官方那格的图标就是那个 svg（shell 的 `navIcon(id)` 直接渲染 `<svg className=navIcon>`），
        // 于是它是 navCell 的**直接 flex 项** ⇒ 被块化（display 不再是 inline）、由
        // `align-items:center` 精确居中。我们若包一层 span：span 自己居中没问题，但里面的
        // svg 是**行内级**，坐落在这个 span 的**行盒基线**上，继承来的 `line-height:22px`
        // 会在 svg 底下留出降部空隙 ⇒ 图标整体被顶高约 2px，肉眼就是"图标比文字高、没上下居中"。
        // 直接换 svg ⇒ 与官方逐字同一个盒模型（宽度/高度属性我们自己给 16）。
        // ⚠️ 类名必须经 `getAttribute("class")` 取：`SVGElement.className` 是
        // **SVGAnimatedString 对象**（不是字符串），`span.className = iconEl.className`
        // 会先被字符串化成 `"[object SVGAnimatedString]"` ⇒ 类名整份丢失，
        // 连 shell 的 `flex:none` 一起丢（本注释上一版就是这么写的，是本 issue 的第二半根因）。
        const holder = document.createElement("div");
        holder.innerHTML = weIconSvgString(16);
        const icon = holder.firstElementChild;
        if (!icon) continue;                 // innerHTML 被拒 / 结构异常：这条按钮保齿轮
        const cls = iconEl.getAttribute ? iconEl.getAttribute("class") : "";
        if (cls) icon.setAttribute("class", cls);
        icon.setAttribute("data-we-nav-icon", "1");
        btn.replaceChild(icon, iconEl);
        patched.add(btn);
      } catch { /* 单个按钮失败不影响其它 */ }
    }
  };
  // 设置对话框可能已开着（HMR / 插件热重载）：先补一次现况。
  patchIn(document.body);
  // overlay 是 body 的**直接**子节点 ⇒ 只盯 body 的一层 childList，不为子树变动买单。
  const obs = new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (n && n.nodeType === 1) { patchIn(n); }
      }
    }
  });
  try { obs.observe(document.body, { childList: true }); } catch { return null; }
  // 语言切换：注册的 label 换了文字，nav 行要按新 label 重新认一次。
  const offLocale = weOnLocaleChange(() => {
    patched = new WeakSet();
    patchIn(document.body);
  });
  return () => {
    try { obs.disconnect(); } catch { /* ignore */ }
    try { offLocale(); } catch { /* ignore */ }
  };
}

export {
  renderWeIcon,
  installWeNavIcon,
};
