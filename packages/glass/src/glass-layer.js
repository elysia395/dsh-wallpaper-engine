/**
 * glass-layer.js —— 玻璃**行为层**（ADR-0016 第三刀）：主包 `src/effects.js` 里那批玻璃段
 * 的承接收（原段逐字搬来），经 `registerLayerHooks('glass', { sync, dispose })` 挂进主包的
 * 既有节拍：主包 `subscribe(applyEffects)` 同一条 emit 链上，注册表把本层 sync 也 subscribe
 * 上（src/client.js 的 attachLayer）⇒ **每次设置变动本函数重跑一次**，与搬迁前 applyEffects
 * 里的执行时机逐位等价（订阅序：syncLayers → applyEffects → fx → parallax → glass）。
 *
 * 与 fx / parallax 的层同形：sync 无参、现读 `selection`（host 键是活绑定）。
 * sync 幂等 —— 全部写入都是"按当前 selection 重算"的 setProperty / setAttribute，
 * 迟到注册（attacher 立刻补接 + emit）与重复 emit 都安全。
 *
 * 输入（全部经主 bundle 的显式键集，见 packages/glass/src/client.js 的 GLASS_HOST_REQUIRED）：
 *   selection                    ← 设置 store（活绑定）
 *   skinYieldActive()            ← 皮肤让路态（src/client.js）
 *   weClampSurfaceColor(...)     ← 染色地板钳制（src/effects.js 顶层共享，与 verify-readability 同源）
 *   glassColorOf(...)            ← #159② 分主题取色（src/effects.js）
 *   GLASS_SATURATE / useLegacySaturateCoupling() ← 饱和耦合常量与 A/B 旧斜坡（src/client.js）
 * 兄弟文件（同工厂作用域，本包 client.build.json 的 inline[]）：
 *   glass.js（applyGlass / toRgbTriple）· glass-surfaces.js（经 glass-extra 间接）
 *   glass-extra.js（syncExtraGlassCss / disposeExtraGlassCss）
 *
 * detectSoftwareRender（#95）随之从主包 src/client.js 迁入：它是玻璃域的探测（软渲染 ⇒
 * backdrop-filter 被静默忽略），唯一消费者就是下面 sync 里的 data-we-glass-fallback 挂载，
 * 守卫（verify-softrender）按产物提取执行。
 */

// ── 软件光栅化探测 ─────────────────────────────────────────────────────────
// 某些第三方桌面外壳（增强 / 扩展窗口模式，通常是软件合成）里 `backdrop-filter`
// 被静默忽略：属性语法仍然被接受，所以 `@supports not (backdrop-filter: …)`
// 永远为真 —— 那条回退根本不会启用，玻璃面板就变成「过透」（全透）。因此这里做
// 运行时探测：真的去建一个 WebGL 上下文并读渲染器字符串，如果它是软件光栅器
// （或连上下文都建不出来），就把 body[data-we-glass-fallback] 挂上，让 CSS 用
// 既有的近不透明配方接管（见 CSS 里那一段）。
// 手动覆盖（用户排障 / 维护者无 GPU 环境复现）：
//   ?we-glassfallback=on|1  → 强制回退 · off|0 → 强制关闭 · 其他值 = 自动探测
// 只探测一次并缓存 —— 玻璃层 sync 每次设置变动都会读它。
// 全程 typeof 守卫 + try/catch：非浏览器 / 验证沙箱里绝不抛出，也绝不改变行为。
const SOFT_RENDER_RE = /swiftshader|software|llvmpipe|softpipe|microsoft basic render|angle \(software|stack-gl/i;
let softRenderFallback; // undefined = 未探测 · true = 软件/无 WebGL · false = 硬件
function detectSoftwareRender() {
  if (softRenderFallback !== undefined) return softRenderFallback;
  softRenderFallback = false;
  try {
    // 手动覆盖优先于一切探测（缓存最终决定）。
    if (typeof location !== "undefined" && location && typeof location.search === "string") {
      let raw = "";
      if (typeof URLSearchParams === "function") {
        raw = new URLSearchParams(location.search).get("we-glassfallback") || "";
      } else {
        const m = /[?&]we-glassfallback=([^&]*)/.exec(location.search);
        raw = m ? decodeURIComponent(m[1]) : "";
      }
      const flag = String(raw).toLowerCase();
      if (flag === "on" || flag === "1") return (softRenderFallback = true);
      if (flag === "off" || flag === "0") return (softRenderFallback = false);
    }
    if (typeof document === "undefined" || !document
        || typeof document.createElement !== "function") return softRenderFallback;
    const canvas = document.createElement("canvas");
    if (!canvas || typeof canvas.getContext !== "function") return (softRenderFallback = true);
    let gl = null;
    try { gl = canvas.getContext("webgl"); } catch { /* ignore */ }
    if (!gl) { try { gl = canvas.getContext("experimental-webgl"); } catch { /* ignore */ } }
    // 连 WebGL 上下文都拿不到 → 没有硬件合成，backdrop-filter 必定不生效。
    if (!gl) return (softRenderFallback = true);
    let renderer = "";
    let vendor = "";
    try {
      const dbg = typeof gl.getExtension === "function" && gl.getExtension("WEBGL_debug_renderer_info");
      if (dbg && typeof gl.getParameter === "function") {
        renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "";
        vendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || "";
      }
      // 没有调试扩展（或被隐私设置屏蔽）时退回公开的 RENDERER / VENDOR。
      if (!renderer && typeof gl.getParameter === "function" && gl.RENDERER !== undefined) {
        renderer = gl.getParameter(gl.RENDERER) || "";
      }
      // VENDOR 只是同一判定的第二个可读串（实测：本仓库自带的 supreium-headless-gl
      // 是软件光栅器，但 RENDERER 只报裸 "ANGLE"，软件线索只出现在 VENDOR="stack-gl"，
      // 且它不暴露 WEBGL_debug_renderer_info）—— 浏览器硬件链路不会因此误判。
      if (!vendor && typeof gl.getParameter === "function" && gl.VENDOR !== undefined) {
        vendor = gl.getParameter(gl.VENDOR) || "";
      }
    } catch { /* 读不到渲染器字符串：不判定为软件渲染 */ }
    softRenderFallback = SOFT_RENDER_RE.test(String(renderer) + " " + String(vendor));
    // 礼貌释放：只探测一次，但也不给页面永久占一个 WebGL 槽位。
    try {
      const lose = typeof gl.getExtension === "function" && gl.getExtension("WEBGL_lose_context");
      if (lose && typeof lose.loseContext === "function") lose.loseContext();
    } catch { /* ignore */ }
  } catch { /* 探测异常：保持 false（不改变既有行为） */ }
  return softRenderFallback;
}

// ── 标题栏容器锚点：运行时探针，不写死宿主构建哈希（#235）─────────────────────
// 宿主 AppFrame 是那条整页 grid 容器的类名（随机哈希前缀 + 固定 local 名 frame），前缀是
// CSS-module 的构建哈希：宿主每换一次构建就可能变一次。写进选择器 ⇒ 宿主一升级，标题栏
// 玻璃（含软件渲染回退两条）就静默失效；而两道硬门都还成立 ⇒ 现场表现是「开关怎么点都
// 没反应」。锚点只能依赖宿主稳定属性或本插件运行时打的标记（本块）。
// 探针随玻璃层 sync 重跑（幂等）：开 ⇒ 只给当前顶栏容器打 [data-we-titlebar-anchor]，
// 旧节点残留一并摘掉；关 / 让路（skinYield）⇒ 全部摘掉（不在宿主 DOM 上留本插件的属性）。
const WE_TITLEBAR_FRAME_CLASS = /(?:^|\s)[A-Za-z0-9_-]*_frame(?:\s|$)/;

function weIsTitlebarFrame(el) {
  return !!(el && el.nodeType === 1 && typeof el.className === "string"
    && WE_TITLEBAR_FRAME_CLASS.test(el.className));
}

function findTitlebarFrame() {
  // ① 座位祖先链：顶栏容器是整页 grid 的根，侧栏列一定落在它里面（布局事实，与类名无关）。
  const seat = document.querySelector('[data-slot="sidebar"]');
  for (let el = seat && seat.parentElement; el && el !== document.body; el = el.parentElement) {
    if (weIsTitlebarFrame(el)) return el;
  }
  // ② 座位缺席时：扫所有 div，取「含侧栏或对话列」的那个 —— 仍只认宿主语义属性。
  for (const el of document.querySelectorAll("div[class]")) {
    if (weIsTitlebarFrame(el) && el.querySelector('[data-slot="sidebar"], [data-slot="conversation"]')) return el;
  }
  // ③ 语义座位全缺席时：只认单类名、_frame 收尾且宽度覆盖视口 70% 以上的元素。
  const viewport = (typeof window !== "undefined" && window && Number(window.innerWidth)) || 0;
  if (!viewport || !document.body || !document.body.children) return null;
  let best = null;
  let bestArea = 0;
  const consider = (el) => {
    if (!el || el.nodeType !== 1 || typeof el.className !== "string") return;
    if (!/^[A-Za-z0-9_-]+_frame$/.test(el.className)) return;
    const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    if (!rect || rect.width < viewport * 0.7) return;
    const area = rect.width * rect.height;
    if (area <= bestArea) return;
    best = el;
    bestArea = area;
  };
  for (const root of document.body.children) {
    consider(root);
    for (const child of root.children || []) consider(child);
  }
  return best;
}

/** 幂等：开 ⇒ 只给当前顶栏容器打标记（旧节点残留一并摘掉）；关 ⇒ 全部摘掉。 */
function syncTitlebarAnchor(on) {
  if (typeof document === "undefined" || !document
    || typeof document.querySelector !== "function"
    || typeof document.querySelectorAll !== "function") return;
  const frame = on ? findTitlebarFrame() : null;
  for (const el of document.querySelectorAll("[data-we-titlebar-anchor]")) {
    if (el !== frame) el.removeAttribute("data-we-titlebar-anchor");
  }
  if (frame && !frame.hasAttribute("data-we-titlebar-anchor")) {
    frame.setAttribute("data-we-titlebar-anchor", "");
  }
}

/**
 * 玻璃层 sync（ADR-0016 迁移）。
 * 主包 emit ⇒ 本函数重跑：全局玻璃量 → 染色地板 → applyGlass 逐面釉层 → 额外补雾化 →
 * 思考块门控 → 胶囊 → 侧栏跟随 → 软渲染钩子。
 */
function applyGlassLayer() {
  const s = document.body.style;
  // Glass blur strength in px (0 disables the frosted-glass effect).
  s.setProperty("--we-blur", selection.blur + "px");
  // iOS liquid glass: the backdrop "colour melt" (saturation) is a CONSTANT
  // material property, DECOUPLED from the blur radius — the 玻璃 slider now
  // drives ONE thing (frost depth, --we-blur). Rationale: --we-saturate amplifies
  // whatever chroma the backdrop still carries, and blur is what smears the
  // residual wallpaper text into that chroma; the coupled ramp therefore
  // magnified exactly the signal the owner reads as 荧光/彩色鬼影, worst at the
  // top of the slider where the amplification met the most smearing. A flat value
  // kills the runaway at high radii while keeping the "wet glass" chroma lift at
  // every radius. GLASS_SATURATE is deliberately BELOW the stylesheet's own 1.8
  // fallback (what applies before this variable is first written), so the
  // steady-state glass is milder than the pre-write default rather than stronger.
  //   blur px:     0      15     30     45     60
  //   old:       1.15   1.57   1.99   2.41   2.83   (1.15 + blur*0.028)
  //   new:       1.30   1.30   1.30   1.30   1.30   (constant; 6.1x less chroma
  //                                                  amplification at 60px)
  // ?we-saturate=legacy restores the old coupled ramp byte-for-byte (A/B
  // escape hatch, see useLegacySaturateCoupling).
  s.setProperty("--we-saturate", useLegacySaturateCoupling()
    ? String(1.15 + selection.blur * 0.028)
    : String(GLASS_SATURATE));
  s.setProperty("--we-glass-brightness", "1.04");
  // - --we-glass-alpha: white-overlay alpha of the glass surfaces. The 玻璃透明
  //   度 slider semantics: higher = MORE transparent (clearer wallpaper shows
  //   through), lower = closer to solid. 0% → ~0.25 (frosted, solid-ish),
  //   60% → ~0.10 (轻霜 —— 染色地板下限不再让颜色在拉满端消失，旧值 0.03 会让
  //   玻璃色份额塌到 ~1%、只剩主题底色 = 用户报的"拉满变黑/变白")。
  const glassAlpha = Math.max(0.10, 0.25 - (selection.glassAlpha / 100) * 0.15);
  s.setProperty("--we-glass-alpha", String(glassAlpha));
  // ── ⚠️ 这个变量**不许删**：它没有 CSS 消费者（配方早改读下面钳制出来的
  // `--we-surface-tint-light/dark`），但 `test/compat-harness-pages.mjs` 把它当**页面观察量**
  // 断言（`getComputedStyle(body)` 读它、要求非空 + DSH 的设置窗口 token 与之同源）。那个
  // harness 不在任何 npm 脚本里（要浏览器页面）⇒ 无法在此验证改动它的结局 —— 先删写入 = 静默
  // 破坏一个未经验证的观察者。正确顺序：先把 harness 的观察点改成 `--we-surface-tint-light`，
  // 再删这里的写入；在那之前它由守卫第 ⑭ 组的 `OBSERVED_ONLY` 登记表**显式豁免**。
  //   那行注释说明了它为何暂时不能删。这里写**浅色那一侧**：它是这个色板的"基准色"，
  //   而观察者只要求非空。（改分主题取色后它仍是标量 —— 观察量的形状没变。）
  s.setProperty("--we-glass-color", glassColorOf(selection, "light"));
  // - 玻璃保真度（0–100，默认 100 = 完整红线）：同一标量喂两处消费 —— styles.js
  //   的 --we-readability-floor（地板覆盖度）与 weClampSurfaceColor（釉色向原色
  //   的回退幅度）。两处必须同源，滑杆才是一个旋钮。
  const fidNum = Number(selection.glassFidelity);
  const glassFidelity = Number.isFinite(fidNum) ? Math.min(1, Math.max(0, fidNum / 100)) : 1;
  s.setProperty("--we-glass-fidelity", String(glassFidelity));
  // 宿主 Modal 遮罩浓度（#254）：0–100 ⇒ 0–1；CSS 侧按主题把 --dsw-alias-bg-mask-1
  // 的 alpha 乘上它（100 = 宿主原值浅 0.24 / 深 0.50，0 = 完全不遮）。
  const maskNum = Number(selection.settingsMaskStrength);
  const maskStrength = Number.isFinite(maskNum) ? Math.min(1, Math.max(0, maskNum / 100)) : 1;
  s.setProperty("--we-mask-strength", String(maskStrength));
  // - 染色地板：按主题把玻璃色钳制进可读亮度带，供样式表的
  //   --we-readability-base（地板层）与全部 frost 槽位消费 —— 对话框/侧栏等
  //   宿主表面由此拿到**用户的色相**而非主题白/黑，正文对比度判据不变。
  //   保真度 < 100 时釉色向原色线性回退（见 weClampSurfaceColor 第三参）。
  //   #159②：两侧各取自己那一半（glassColorOf），于是「深色单独设置」一开，
  //   同一份 settings 在浅/深两套配色下给出两个不同的釉色 —— 这正是本项的交付。
  const glassTintLight = glassColorOf(selection, "light");
  const glassTintDark = glassColorOf(selection, "dark");
  s.setProperty("--we-surface-tint-light", weClampSurfaceColor(glassTintLight, "light", glassFidelity));
  s.setProperty("--we-surface-tint-dark", weClampSurfaceColor(glassTintDark, "dark", glassFidelity));
  // RGB 三元组形式：给 rgba() 槽位用（消息气泡 / 输入框的白釉染色）。
  s.setProperty("--we-surface-tint-rgb-light", toRgbTriple(weClampSurfaceColor(glassTintLight, "light", glassFidelity)));
  s.setProperty("--we-surface-tint-rgb-dark", toRgbTriple(weClampSurfaceColor(glassTintDark, "dark", glassFidelity)));

  // ── 玻璃管线：取值解析 / 各面釉层变量 / 门控属性（glass.js）+ 运行期样式通道（glass-extra）。
  applyGlass(selection, s);
  // 额外补雾化的选择器（上游 #200）：玻璃面算完之后同步这条**运行期**样式通道。
  // 静态样式表是构建期常量（styles.js），而这份规则由设置拼出来 ⇒ 单独一个 <style>
  // 标签（见 glass-extra.js；空清单时它一条规则都不生成、标签也撤掉）。
  syncExtraGlassCss(selection);
  // 思考块液态玻璃：默认关，保持宿主黑底方便阅读。打开后 CSS 清掉思考条
  // 与推理面的实心底，切到会话同一套雾化。本门控仍在玻璃层就地写 ——
  // 它不是玻璃量，不进 applyGlass 的取值管线。
  // 让路态（皮肤中心互操作，见主包 src/client.js）：玻璃整族退场 —— 这里与下面 sidebar-follow
  // 是 applyGlass 之外仅剩的两处玻璃门控点，一并摘。
  const skinYield = typeof skinYieldActive === "function" && skinYieldActive();
  // 三挡的第二半：正文原生挡（thinkingNative）。它**赢过**玻璃挡 —— 开着时不挂
  // data-we-thinking-glass（互斥在门控层保证，UI 的三挡分段只是维持两键一致）。
  // 原生挡的 CSS 语义见样式表「正文原生挡」块：正文子树（气泡 / markdown 家族）
  // 令牌退回宿主原生值，画布与输入框不碰。
  if (selection.thinkingNative && !skinYield) document.body.setAttribute("data-we-thinking-native", "on");
  else document.body.removeAttribute("data-we-thinking-native");
  if (selection.thinkingGlass && !selection.thinkingNative && !skinYield) document.body.setAttribute("data-we-thinking-glass", "on");
  else document.body.removeAttribute("data-we-thinking-glass");
  // 标题栏容器锚点（#235）：顶栏玻璃那一族 CSS 只认 [data-we-titlebar-anchor]，不再写死宿主
  // 构建哈希 —— 探针判据与理由见本文件 findTitlebarFrame 的注释。关掉标题栏玻璃 / 皮肤让路
  // = 这一面整组不生效，标记也一并摘掉（`&& !skinYield` 正是让路早退路径的摘锚点）。
  syncTitlebarAnchor(selection.titlebarGlass === true && !skinYield);
  // 文字胶囊一族的雾化（新会话 / 「加载更早历史」「回到底部」；行内代码胶囊已不带霜）：
  // #134 落地时是写死的 8px CSS 兜底（--we-inline-code-blur 无生产者 ⇒ 用户实测"调不了"），
  // 现在接成旋钮（capsuleBlur，默认 8 = 原观感）。与上面的门控属性同处声明 ——
  // 这族变量只被 data-we-thinking-glass 门下的规则消费（样式表 ⑥ 条）。
  const capBlurNum = Number(selection.capsuleBlur);
  s.setProperty("--we-inline-code-blur", String(Number.isFinite(capBlurNum) ? capBlurNum : 8) + "px");
  // 胶囊釉色：三元组形式给 rgba() 槽位（fill 令牌 + 滚动条拇指）。刻意不过
  // weClampSurfaceColor —— 10% 雾底不是正文面，不进可读性下限（理由见 schema）。
  s.setProperty("--we-capsule-tint-rgb", toRgbTriple(
    /^#[0-9a-f]{6}$/i.test(String(selection.capsuleColor)) ? selection.capsuleColor : "#ffffff"));

  // dsh-better-sidebar 液态玻璃：一套独立于会话玻璃的细粒度控制（侧栏模糊 /
  // 侧栏透明度 / 侧栏玻璃颜色 + 总开关）。变量只作用于 [data-dsh-better-sidebar]
  // 子树（CSS 见样式表），关闭总开关时侧栏恢复原生外观。
  // 跟随全局（sidebarFollowGlobal，默认开）：把侧栏那一套变量**指向**全局玻璃三件套。
  // var() 是惰性替换 ⇒ 这里写进去的是引用而不是拷贝：改「玻璃 / 玻璃透明度」两侧栏一起变。
  // 色相那一份走样式表里的 --we-follow-tint（按主题取钳制后的玻璃色）—— 不能在这里写死，
  // 内联值会盖掉"按主题"这件事。
  // ⚠️ 合并 #132 口径：跟随关着时**不覆盖** —— 按面值由 applyGlass 的 glassValue 单一
  //    取值路径供给（inherit→全局键 / custom→「独立配置」自己的键）；/200 刻度这类旧曲线
  //    早已随规范刻度退役，不许再回来。UI 上跟随开着时「独立配置」收起，
  //    两套机制不会同时生效。
  if (selection.sidebarFollowGlobal) {
    s.setProperty("--we-sidebar-blur", "var(--we-blur)");
    s.setProperty("--we-sidebar-saturate", "var(--we-saturate)");
    s.setProperty("--we-sidebar-tint", "calc(var(--we-glass-alpha) * 100%)");
    s.setProperty("--we-sidebar-color", "var(--we-follow-tint)");
    s.setProperty("--we-sidebar-sheen", "1");
  }
  // 跟随态另挂一个属性：样式表用它决定"侧栏的釉"取共享那一份还是侧栏专用那一份。
  if (selection.sidebarGlass && selection.sidebarFollowGlobal && !skinYield) document.body.setAttribute("data-we-sidebar-follow", "on");
  else document.body.removeAttribute("data-we-sidebar-follow");

  // 软件渲染钩子（#95，见本文件头部 detectSoftwareRender）：@supports 只做语法检查，软件
  // 合成下 backdrop-filter 被静默忽略时它依然为真，所以近不透明回退必须靠运行时
  // 探测来挂载。命中时 CSS（body[data-we-glass-fallback]）让面板/侧栏/内容面/
  // 弹层改用与 @supports 回退完全相同的配方，并显式 backdrop-filter: none。
  if (detectSoftwareRender()) document.body.setAttribute("data-we-glass-fallback", "1");
  else document.body.removeAttribute("data-we-glass-fallback");
}

/**
 * 玻璃层 dispose（ADR-0016 迁移）。
 * 主包拆卸期对本层调用（attachLayer 的 unsubscribe 对面），卸载 / 禁用后 DOM 上不留玻璃态。
 */
function disposeGlassLayer() {
  const s = document.body.style;
  s.removeProperty("--we-blur");
  s.removeProperty("--we-saturate");
  s.removeProperty("--we-glass-brightness");
  s.removeProperty("--we-glass-alpha");
  s.removeProperty("--we-glass-color");
  s.removeProperty("--we-mask-strength");
  s.removeProperty("--we-surface-tint-light");
  s.removeProperty("--we-surface-tint-dark");
  s.removeProperty("--we-surface-tint-rgb-light");
  s.removeProperty("--we-surface-tint-rgb-dark");
  document.body.removeAttribute("data-we-glass-window");
  // 页面玻璃总锚点（glass.js 恒挂）：漏撤 ⇒ 插件禁用 / HMR 卸载后整页的玻璃
  // 令牌映射与对话栏那一族规则照旧生效（"插件已卸载，玻璃还在"）。与下面三个同批。
  document.body.removeAttribute("data-we-glass-page");
  document.body.removeAttribute("data-we-left-sidebar");
  // 侧边栏四角圆角 / 直角（glass.js 的 applyGlass 写出）：同批清理 —— 漏撤 ⇒ 插件
  // 卸载 / 禁用后宿主侧栏仍停在上次的圆角上（"插件没了，侧栏还是圆的"）。
  document.body.removeAttribute("data-we-left-sidebar-radius");
  document.body.removeAttribute("data-we-right-sidebar-radius");
  document.body.removeAttribute("data-we-left-sidebar-square");
  document.body.removeAttribute("data-we-right-sidebar-square");
  s.removeProperty("--we-left-sidebar-radius");
  s.removeProperty("--we-right-sidebar-radius");
  // 标题栏液态玻璃门（与上面那个同批）：漏撤 ⇒ 插件卸载 / 禁用后，顶栏仍挂着玻璃底与
  // 雾化层，而壳层自己的不透明底色被压住 —— 表现为"插件没了，标题栏还是玻璃的"。
  document.body.removeAttribute("data-we-titlebar-glass");
  // 标题栏容器的锚点标记（#235，挂在**宿主元素**上而非 body）：同批摘掉 —— 它是本插件
  // 打到宿主 DOM 上的属性，插件禁用 / HMR 卸载后不能留在页面上。
  if (typeof document !== "undefined" && document
      && typeof document.querySelectorAll === "function") {
    for (const el of document.querySelectorAll("[data-we-titlebar-anchor]")) el.removeAttribute("data-we-titlebar-anchor");
  }
  // 思考块液态玻璃门（PR #130 引入）：同批的卸载残留口径 —— 漏撤 ⇒ 插件卸载后
  // 宿主思考条的规则组照旧生效。合并 #132 时补上（第 ⑨ 组清理对称判据的要求）。
  // 三挡的另一半（对话区原生挡）同批：漏撤 ⇒ 卸载后对话区令牌仍被钉回原生值。
  document.body.removeAttribute("data-we-thinking-glass");
  document.body.removeAttribute("data-we-thinking-native");
  // ⚠️ W5 新增的三个门控属性**也必须在这里撤掉**（与上面两个同批）：
  //    漏掉它们 ⇒ 插件被禁用 / HMR 卸载后，宿主 DOM 上仍留着 `data-we-glass-chat` /
  //    `data-we-glass-floaters`，而挂在这些属性上的规则组**照旧生效** ——
  //    表现为"插件已卸载，但玻璃还在"。这类残留只有卸载路径才暴露，日常切换看不出来。
  document.body.removeAttribute("data-we-glass-chat");
  document.body.removeAttribute("data-we-glass-floaters");
  document.body.removeAttribute("data-we-sidebar-follow");
  s.removeProperty("--we-sidebar-blur");
  s.removeProperty("--we-sidebar-saturate");
  s.removeProperty("--we-sidebar-sheen");
  s.removeProperty("--we-sidebar-color");
  s.removeProperty("--we-sidebar-tint");
  document.body.removeAttribute("data-we-sidebar-glass");
  document.body.removeAttribute("data-we-sidebar-fullclear");
  // #277：第三方表面实底底板门（与 glass.js 的 applyGlass 成对；漏撤 ⇒ 插件卸载后
  // 第三方插件的弹窗 / 框架层 / 吸顶条仍被拍成实底，宿主原生观感回不去）。
  document.body.removeAttribute("data-we-floater-solid");
  document.body.removeAttribute("data-we-glass-fallback"); // #95 软件渲染回退钩子随层注销
  s.removeProperty("--we-content-surface-alpha");
  s.removeProperty("--we-content-surface-color");
  // ⚠️ W2–W4 新增的**按面釉层变量**同样要撤（否则卸载后残留的变量值会继续被
  //    那几条规则读到 —— 与属性残留是同一类问题）。逐面列出，不用循环：
  //    它们分散在三个面、名字不同，显式列出比"一个前缀循环"更不容易漏。
  for (const v of [
    "--we-settings-window-blur", "--we-settings-window-alpha",
    "--we-left-sidebar-blur", "--we-left-sidebar-alpha",
    "--we-titlebar-blur", "--we-titlebar-alpha",
    "--we-floaters-blur", "--we-floaters-alpha",
    // ⚠️ 对话栏那一族（`--we-chat-*`）**提交态就没在撤** —— 既有缺陷，本次一并补上：
    //    它们是对话栏专属釉层变量，卸载后残留同样会被那几条规则读到。
    //    （判据"清理对称性"把这一组和上面 6 个一起抓了出来。）
    "--we-chat-glass-fidelity", "--we-chat-surface-tint-light", "--we-chat-surface-tint-dark",
    "--we-chat-surface-tint-rgb-light", "--we-chat-surface-tint-rgb-dark",
  ]) s.removeProperty(v);
  // 额外补雾化通道（#200）：这一份是**运行期生成的** <style>，不在静态样式表里 ⇒
  // 必须显式撤标签（与上面那批 body 属性 / 变量成对，理由同"清理对称性"）。
  disposeExtraGlassCss();
}

export { applyGlassLayer, disposeGlassLayer, detectSoftwareRender };
