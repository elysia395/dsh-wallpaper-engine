/**
 * font/apply.js — 字体自定义的**落地点**（设置 → DOM）：宿主默认值快照 + 组件作用域样式表。
 *
 * 为什么单独一个文件：字体系统的其它三个模块都是**纯计算**（角色表 / 令牌 / 钩子生成），
 * 只有这里碰 DOM。独立出来，**效果应用层**（scrim / 玻璃 / 光标 / 淡出底色）
 * 就不夹带字体代码 —— 读一处就够。
 *
 * ══ 契约（本文件是客户端程序的一部分，构建期由 scripts/build-client.mjs 内联进 bundle 的
 * 工厂作用域，因此"外部作用域"= 同一 prelude / src/client.js 的顶层）══════════════════════
 * 需要的外界：
 *   COMPONENT_FONT_TARGETS   ← src/font/components.js（用组件总数判"命中集不全"）
 *   probeComponentTargets()  ← 同上（启动自探测）
 *   scanHookScopes()         ← 同上（扫样式表取每个 `--dsl-*` 钩子的**定义点**）
 *   componentScopeSelector() ← 同上（id → 作用域选择器；**id→作用域的映射只有那一处**）
 *   buildComponentCss()      ← 同上（tokens 通道：写真实属性）
 *   buildDslBlocks()         ← 同上（hooks 通道：写官方 --dsl-* 钩子）
 *   fontFamilyStack()        ← src/client.js（族键 → CSS 栈）。本文件把**解析函数**传进上面两个
 *                              纯计算函数 —— 族键的值域是共享内核的事，components.js 不认它。
 *   fontFamilyStackConcrete()← src/client.js（**摊平**版：给"值会被当字符串读走"的下游用 ——
 *                              xterm 把它当 `fontFamily` 字符串，不认 `var()`）
 *   selection                ← src/client.js 的设置/选中项 store（**只读**）
 * 对外提供：componentFontDefaults（面板显示默认值）/ snapshotHostFontDefaults /
 *          removeFontStyles / applyComponentFonts / removeComponentFonts /
 *          applyTerminalHostVar（dsh-ssh 终端面板那条钩子；**正文要在顶层先调它一次** —— 时机，见其注释）。
 *
 * 不变量：
 *   · **只读 selection、不写它** —— 写设置是 UI 处理器与 apply(ctx) 的事。
 *   · 只碰三处 DOM：`#we-font-scope` 这个 `<style>`、documentElement 上的 `--we-host-*`、
 *     以及 **body 上的一个内联属性 `--dsh-ssh-terminal-font`**（所有三处都必须能成对清除：
 *     `removeComponentFonts` / `removeFontStyles` / `applyTerminalHostVar` 的清除分支）。
 *   · 出错一律咽掉：字体自定义是增强，任何异常都不该影响主路径。
 *   · 本文件必须浏览器安全（无 import / require / Node API），且**不得有顶层可执行语句**
 *     —— 它被内联到 bundle 顶部（早于 client.js 正文），顶层读正文里的 const 会撞 TDZ。
 *   · 作用域选择器**只能**由 `componentScopeSelector(id)` 给出：这里不得自己拼模块名。
 */

// ── 宿主角色色快照（面板要显示「当前默认色」）──────────────────────────────
// 这个数组与 snapshotHostFontDefaults 只服务一件事：把**宿主此刻的角色色**记进 --we-host-*，
// 供面板显示「当前默认色」。它不注入任何规则，也没有"还原契约"
//（`[data-we-font-ignore]` 全仓没有消费者）。
// 白闪红线（v0.6.4 起）：不要引入 :has() 或祖先相关选择器 —— 祖先失效集会把点击/输入的
// 样式重算扩大到整棵 DOM，是 kiosk 窗口整屏刷白的点火条件。
const WE_HOST_TOKENS = [
  "--dsw-alias-label-primary",
  "--dsw-alias-label-secondary",
  "--dsw-alias-label-tertiary",
  "--dsw-alias-label-dimmed",
];

/**
 * **宿主字族快照**：本机字体（`sys:` 键）解析出的栈是 `"<族名>", var(--we-host-font-family, …)`
 * —— 也就是"选中的字体在前，DSH 原来那条字族链在后"。这条链必须**在我们写任何字族之前**
 * 取下来（写完再取就是自己），所以它跟着 `snapshotHostFontDefaults` 一起做（同一个
 * "已快照则跳过"的幂等门）。
 *
 * 为什么不在插件里写死一条 fallback 链：那条链是 DSH 的决定（中文/等宽的退路都在里面），
 * 抄一份到这里就会在下一次 DSH 调整时漏改。快照取不到（令牌不在 / 样式表读不到）时才用
 * `FONT_STACK_FALLBACK`（在 src/client.js）—— 那条只是"别让字掉成衬线体"的保底。
 */
const WE_HOST_FAMILY_TOKEN = "--we-host-font-family";
const WE_HOST_FAMILY_SOURCE = "--dsw-font-family";

/**
 * 组件级字体：把 `body [class*="_<模块名>_"]` 的覆盖写进 `#we-font-scope`。
 *
 * 分工：这里管的是**单个组件**（对话正文 / 代码块 / 终端 / 表格），不是全局角色。
 * 三条规矩来自静态分析（详见 src/font/components.js 文件头）：
 *   · 命中靠**启动自探测**（结果缓存；打包器改名 ⇒ 整条降级，不误伤）；
 *   · 字体来自后代 `font:` 简写的组件（代码块 / 终端）**只有官方 `--dsl-*` 钩子这条腿有效**；
 *   · 空配置 = 不生成任何规则（**官方值作初始值**）。
 * 探测结果缓存，但**可重试**：命中集不全时（组件后来才出现在页面上）超过 2s 就重探一次 ——
 * 既不必刷新页面，也不会每次输入都去读 computed 样式（那是布局抖动）。
 * UI 显示（componentFontDefaults）与 CSS 生成（applyComponentFonts）走同一份结果。
 */
let componentFontProbe = null;
let componentFontProbeAt = 0;
function componentFontAvailability() {
  const stale = componentFontProbe !== null
    && componentFontProbe.ids.length < COMPONENT_FONT_TARGETS.length
    && Date.now() - componentFontProbeAt > 2000;
  if (componentFontProbe === null || stale) {
    const ids = probeComponentTargets(document);
    // hooks 通道的作用域不靠模块名，而靠**钩子定义点**（扫样式表 ⇒ 精确到文件级哈希）。
    // 同一个模块名会被多个组件共用（代码块 / 终端都是 `.block`），只有定义点能区分它们。
    const hookScopes = scanHookScopes(document);
    // 顺带把"当前 DSH 默认值"读回来：面板直接显示它（而不是"官方"占位字样）——
    // 取该组件**精确作用域**里命中的第一个元素读 computed 的字号/字重/字族。探测只做一次。
    // 作用域选择器只能由 componentScopeSelector 给出（id→作用域的映射只有一处），
    // 这里不得自己拼模块名。
    const defaults = {};
    for (const id of ids) {
      try {
        const scope = componentScopeSelector(id, hookScopes);
        const el = scope ? document.querySelector(scope) : null;
        if (!el) continue;
        const cs = getComputedStyle(el);
        defaults[id] = {
          size: Math.round(parseFloat(cs.fontSize) || 0) || 0,
          weight: parseInt(cs.fontWeight, 10) || 0,
          family: cs.fontFamily || "",
        };
      } catch { /* 读不到就不显示默认值，不影响覆盖能力 */ }
    }
    componentFontProbeAt = Date.now();
    componentFontProbe = {
      ids,
      hookScopes,
      defaults,
      hasToken: (t) => {
        try { return getComputedStyle(document.body).getPropertyValue(t).trim() !== ""; } catch { return false; }
      },
    };
  }
  return componentFontProbe;
}
/** 面板显示用的"当前 DSH 默认值"（按组件）。 */
function componentFontDefaults() {
  return componentFontAvailability().defaults;
}
function fontScopeEl() {
  let st = document.getElementById("we-font-scope");
  if (!st) {
    st = document.createElement("style");
    st.id = "we-font-scope";
    (document.head || document.documentElement).appendChild(st);
  }
  return st;
}
/**
 * **dsh-ssh 终端面板的字体**：那个插件给皮肤留的官方钩子 `--dsh-ssh-terminal-font`。
 *
 * 为什么不能只靠普通 CSS：那个面板是 **xterm**，字体只从构造参数/选项来（它源码原话：
 * "a plain stylesheet rule cannot retarget it"）。它读的位置是 `getComputedStyle(document.body)`。
 *
 * ⚠️ **时机是这一条的全部要害**（现场症状："重启了还是口"）：那个插件**只在构造终端的那一刻**读
 * 这个变量，之后**只有它自己的设置变化**才重读（源码：`useEffect(…, [fontOverride])`）。而我们的
 * 样式表要等宿主把设置 / 字体集异步读回来才写得出来 —— 终端往往在那之前就建好了，于是它一辈子
 * 用着兜底字体。所以本函数有**两个调用点**：
 *   · **同步的早期一次**：`src/client.js` 正文在 store 建好之后立刻调（值来自 localStorage 里那份
 *     字体集缓存）—— 抢在别的插件构造终端之前；
 *   · **宿主回话之后**：`applyComponentFonts()` 里再写一遍权威值。
 * 写的是 **body 上的内联属性**（不是样式表规则）：内联优先级最高，它读到的就是我们写的那个值。
 * 值必须是**摊平的具体字体列表**（xterm 把它当 `fontFamily` 字符串用，`var()` 在里面不是函数）。
 */
function applyTerminalHostVar() {
  try {
    if (typeof document === "undefined" || !document.body || !document.body.style) return;
    const cfg = selection && selection.componentFonts && typeof selection.componentFonts === "object"
      ? selection.componentFonts : null;
    const key = cfg && cfg.terminal && typeof cfg.terminal.family === "string" ? cfg.terminal.family.trim() : "";
    const stack = selection && selection.fontCustom === true && key ? fontFamilyStackConcrete(key) : "";
    if (stack && stack !== "inherit") document.body.style.setProperty("--dsh-ssh-terminal-font", stack);
    else document.body.style.removeProperty("--dsh-ssh-terminal-font");
  } catch { /* 终端字体是增强：任何异常都不该影响主路径 */ }
}
function applyComponentFonts() {
  try {
    const cfg = selection.componentFonts && typeof selection.componentFonts === "object"
      ? selection.componentFonts : {};
    const { ids, hookScopes, hasToken } = componentFontAvailability();
    // 族值是**族键**（内置键或 `sys:` 本机字体键）⇒ 两条通道都要经 fontFamilyStack
    // 解析成 CSS 栈。解析函数由这里显式传进去：components.js 是纯计算，不认族键值域。
    const css = buildComponentCss(cfg, ids, fontFamilyStack)
      + buildDslBlocks(cfg, ids, hasToken, hookScopes, fontFamilyStack);
    const st = fontScopeEl();
    if (st.textContent !== css) st.textContent = css;
    // dsh-ssh 的终端面板不在上面这张样式表里（xterm 不吃 CSS 规则）—— 它走 body 上的内联变量。
    applyTerminalHostVar();
  } catch { /* 组件字体是增强：任何异常都不该影响主路径 */ }
}
function removeComponentFonts() {
  try {
    const st = document.getElementById("we-font-scope");
    if (st) st.textContent = "";
    applyTerminalHostVar(); // fontCustom 已关 ⇒ 这里会把它一并撤掉（让位给 dsh-ssh 自己的取值链）
  } catch { /* ignore */ }
}

function snapshotHostFontDefaults() {
  // 已快照则跳过；removeFontStyles 会清空，重开时再取。
  try {
    const es = document.documentElement.style;
    let need = false;
    for (const t of WE_HOST_TOKENS) {
      if (!es.getPropertyValue("--we-host-" + t.slice(2))) { need = true; break; }
    }
    if (!need && es.getPropertyValue(WE_HOST_FAMILY_TOKEN)) return;
    const bodyCs = getComputedStyle(document.body);
    for (const t of WE_HOST_TOKENS) {
      const v = bodyCs.getPropertyValue(t).trim();
      if (v) es.setProperty("--we-host-" + t.slice(2), v);
    }
    // 字族快照单独一门：**取到空值就当没取到**（写一个空的自定义属性会让
    // `var(--we-host-font-family, 兜底)` 解析成空 ⇒ 整条 font-family 变成坏声明）。
    if (!es.getPropertyValue(WE_HOST_FAMILY_TOKEN)) {
      const fam = bodyCs.getPropertyValue(WE_HOST_FAMILY_SOURCE).trim();
      if (fam) es.setProperty(WE_HOST_FAMILY_TOKEN, fam);
    }
  } catch { /* ignore */ }
}

function removeFontStyles() {
  // 全局字体配置已不存在 ⇒ 这里只清宿主快照（下次开启重新取；期间可能切了主题）。
  // 字族那份必须一起清：留着它，用户换主题/换 DSH 字号后新取的快照就永远不会生效。
  try {
    const es = document.documentElement.style;
    for (const t of WE_HOST_TOKENS) es.removeProperty("--we-host-" + t.slice(2));
    es.removeProperty(WE_HOST_FAMILY_TOKEN);
  } catch { /* ignore */ }
}

export {
  componentFontDefaults,
  applyComponentFonts, removeComponentFonts, snapshotHostFontDefaults, removeFontStyles,
  applyTerminalHostVar,
};
