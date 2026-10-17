/**
 * 节头（**可折叠**的统一构件）—— 面板各节的节头。
 *
 * 契约：
 *   · 纯渲染 + 意图回调，零状态、零副作用 ⇒ 与其余"只读 ctx"的渲染器同一条口径。
 *   · 抽成独立模块的**理由与 `src/glass-panel.js` 相同**：调用方横跨两个模块 ——
 *     `src/panel-tabs.js`（细节 / 侧边栏圆角 / 全局 UI 配色 / 全局字体）与
 *     `src/glass-panel.js`（玻璃 UI）。打包后两者同作用域、按名字直接调；
 *     而 `test/verify-scene-live.mjs` 是**按文件 import** 的替身（每个模块各有自己的作用域）
 *     ⇒ 它必须能 import 到**真实现**才不会把判据架在替身上（"判据测替身"是比红更糟的形态）。
 *   · 依赖：`React`（外层 client 作用域）+ 调用方传入的已翻译文案（`weT` 由调用方在呼叫点完成
 *     —— 本模块**不碰** weT，免得又多一个要注入的自由变量）。
 *
 * 用户口径（二次修订）：
 *   · **两档都支持隐藏**（设置页与侧边栏都能逐节点开关）；
 *   · 差别只在**默认值**：侧边栏把最后三节默认收起，设置页全部默认展开。
 *     ⇒ 默认值由**面板组件**算（`readQpOpen` / `readSavedPickerOpen` 的 default 参数）并作为
 *       `open` 传进来，本构件**不认识** surface、也不自己决定开合。
 *   · 因此这里**没有**"不可折叠"那条分支了（一度有过：设置页当时是纯标题；现在用户要求
 *     两档都能收）—— 少一个参数就少一种"两个面各写一半"的漂移可能。
 *
 * a11y：role=button + tabIndex + aria-expanded + Enter/Space 键；
 * caret 挂 `aria-hidden`（它是装饰，状态由 aria-expanded 承载）。
 *
 * @param {*} label 已翻译的节标签
 * @param {boolean} open 展开态（真值才画内容）
 * @param {() => void} [onToggle] 点击 / 键盘触发时调用
 * @param {*} [action] 可选的尾部动作节点（issue #192 的模块级 ↺）。渲染在 **caret 之后**、
 *   也就是整个节头的**最右端** —— 用户口径（二次修订）："全部放在后边，做成像主题
 *   那样子"。最初它排在标签之后、caret 之前，视觉上落在行中间（见下）。
 *   **调用方负责 `stopPropagation`** —— 本构件是折叠开关，不拦的话点动作会连带把这一节收起来
 *   （重置完看不到结果）。不传就与原来逐字节同形（既有判据不受影响）。
 *
 * ⚠️ 次序为什么会漂（别改回去）：`.we-picker__section-caret` 与 `.we-mod-reset` **都**靠
 * `margin-left: auto` 往右推，同一 flex 行里两个 auto 会把剩余空间**均分** ⇒ ↺ 停在行中间、
 * 而"主题"（那个节头没有 caret，只有一个 auto）的 ↺ 却贴在最右端 —— 同一批模块两种位置。
 * 现在 ↺ 排在 caret 之后、且由 CSS 让出 auto（见 styles.js 的相邻选择器），两者都靠右成组。
 */
function sectionHead(label, open, onToggle, action) {
  return React.createElement("div", {
    className: "we-picker__section-head we-picker__section-head--toggle",
    role: "button",
    tabIndex: 0,
    "aria-expanded": open ? "true" : "false",
    onClick: () => onToggle && onToggle(),
    onKeyDown: (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (onToggle) onToggle();
      }
    },
  },
    React.createElement("span", { className: "we-picker__section-label" }, label),
    React.createElement("span", {
      className: "we-picker__section-caret" + (open ? " is-open" : ""),
      "aria-hidden": "true",
    }, "▾"),
    // ↺ 排在 caret **之后** ⇒ 落在整个节头的最右端（原来"小绿点"那一列），
    // 与"主题"节头（没有 caret、↺ 独占最右）视觉对齐。
    action || null,
  );
}

export { sectionHead };
