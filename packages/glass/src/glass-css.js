/**
 * glass-css.js —— 玻璃样式表（ADR-0016 第四刀：玻璃 CSS 随包走）。
 *
 * 内容 = 原主包 styles 域模块（含已出户的 styles-sidebar.js）里的**全部玻璃段**，按原层叠顺序拼接：
 *   可读性下限常量 → 玻璃域 body 变量块（地板 / follow-tint / 釉光）→ 页面玻璃总锚点（--dsw-*
 *   令牌映射 + markdown 家族）→ mica 近不透明接管 → iOS 液态玻璃（对话区 / 思考块 / composer /
 *   轨迹 / 吸顶条 / 正文原生挡）→ 左栏 / 四角圆角 / 标题栏 / better-sidebar / 官方右栏 / 内容面 →
 *   declared 面 + 设置整窗玻璃 + 插件源浮层霜 → 软件渲染回退 → 侧栏全透明。
 * 模板内容 = CSS_GLASS；注入顺序（主包 sheet 之后）决定层叠关系，规则本身不再复制到主包。
 *
 * 注入（packages/glass/src/client.js）：求值期 ensureGlassCss() 写独立 <style data-plugin-css>
 * 标签。主 bundle 先求值、本包后求值 ⇒ 玻璃 sheet 排在主包 sheet **之后**，与搬移前的层叠关系
 * 同构（回退块压配方、配方压令牌映射的相对顺序不变）；玻璃行停用 ⇒ 本 bundle 不被加载 ⇒
 * 玻璃 sheet 整体消失 = 宿主回原生（ADR-0016 D2 的完整语义）。
 *
 * 拼装契约：本文件只有一个模板 CSS_GLASS（守卫的 cssBodyOf 按「主产物 + 玻璃产物」双工件
 * 拼接读取，顺序 = 本文件在玻璃包配方 inline[] 里的位置）。浏览器安全、纯数据、无顶层副作用
 * （注入动作在入口，不在这里）。
 */
// ── Text-surface readability floor (upstream #82) ───────────────────────────
// The wallpaper may be dimmed/blended so it "does not dominate", but TEXT MUST
// STAY READABLE. IDEA's background-image feature has ONE knob (image opacity)
// and still "just works" because the image always sits BEHIND the editor /
// tool-window surfaces, which keep a background of their own
// (https://www.jetbrains.com/help/idea/setting-background-image.html). This
// plugin lacked exactly that structural property: every text-bearing surface
// was painted as glass colour @ --we-glass-alpha, and in dark mode that alpha
// is additionally multiplied by 0.4 — worst case 0.03 × 0.4 = 0.012, i.e. no
// frost at all, so conversation text scrolling behind the composer read
// straight through.
//
// The floor is a THEME-BASE LAYER composited OVER that glass tint at a fixed
// weight no slider can lower: the tint's alpha only scales the other operand,
// so the effective coverage is floor + a·(1−floor) ≥ floor. Clamping the tint
// alpha itself with max() cannot work here — in dark mode the tint is a WHITE
// glaze, so over the brightest plausible wallpaper pixel the surface composites
// to white at ANY alpha and white body text keeps exactly 1.00:1 (the measured
// before row below). In light mode such a clamp would work but would have to
// sit at 0.44, above every alpha the slider can reach (max 0.25) — it would
// flatten the slider completely. The theme-base layer fixes both themes and
// keeps the slider alive above the floor.
//
// Both values come from measurement (test/verify-readability.mjs recomputes
// the same grid): 玻璃透明度 {0,15,30,45,60} × theme {light,dark} ×
// 壁纸透明度 {0,50,90}, theme text colour (light #000 / dark #fff) against the
// surface composited onto the worst-case backdrop (light: darkest plausible
// wallpaper pixel #000; dark: brightest #fff):
//   light  exact 0.44194 → 0.45   worst case 4.63:1  (bubble @ 玻璃透明度=60)
//   dark   exact 0.58136 → 0.59   worst case 4.63:1  (settings layer-3 @ 0)
// The floor is independent of 壁纸透明度: it never reads --we-wallpaper-opacity,
// which keeps affecting .we-layer only. Values are interpolated into the CSS
// below so the stylesheet and this comment can never drift apart.
const READABILITY_FLOOR = 0.45;
const READABILITY_FLOOR_DARK = 0.59;

const CSS_GLASS = `

  /* ── 文字面可读性下限 (text-surface readability floor, #82) ───────────────
     动机、IDEA 模型与 4.5:1 目标见 JS 的 READABILITY_FLOOR 注释（数值的唯一
     来源，下面用模板插值注入，二者不会漂移）。写法：每个承载文字的面都从
         <原玻璃色 @ 原 alpha>
     变成
         color-mix(in srgb, <主题底色> floor%, <原玻璃色 @ 原 alpha> (1-floor)%)
     —— color-mix 在预乘空间按权重插值，权重会乘上操作数自身的 alpha，
     所以这条声明恰好等于「主题底色 @floor 压在 原玻璃色 之上」：
         effective alpha = floor + a_glass × (1 − floor) ≥ floor
     玻璃透明度 与 暗主题的 ×0.4 只改 a_glass（另一项权重），floor 这一项
     固定不动 —— 下限因此不可能被滑杆削弱；floor 之上仍是原来的玻璃配方，
     只是压了一层主题底色（壁纸在亮/暗极端像素处不再吃掉文字）。
     --we-wallpaper-opacity 不参与本层：壁纸透明度仍只作用于 .we-layer。 */
  /* 染色地板：--we-readability-base 是玻璃色经亮度钳制后的按主题版本
     （effects.js 的 weClampSurfaceColor 计算、--we-surface-tint-* 注入）
     —— 色相跟随用户选择，亮度钳制保住 #82 的 ≥4.5:1 正文判据。缺省回落原值。
     玻璃保真度（glassFidelity，默认 100）：--we-readability-floor = floor 常量
     × --we-glass-fidelity（glass-layer.js 注入 0–1，缺省 1 = 现状、任何旧设置文件
     无此键时也不变）。拉低保真度 = 地板覆盖度同比例减薄 + 釉色向用户原色回退
     （回退在 effects.js 的 weClampSurfaceColor 第三参），颜色更贴用户原色、
     正文可读性让位 —— 这是唯一的权衡旋钮。 */
  body {
    --we-readability-floor-base: ${READABILITY_FLOOR};
    --we-readability-floor: calc(var(--we-readability-floor-base) * var(--we-glass-fidelity, 1));
    --we-readability-base: var(--we-surface-tint-light, #ffffff);
    /* 对话栏专属的一对（独立保真度旋钮 chatGlassFidelity）：**只**被对话栏的框架
       玻璃面消费 —— 气泡（--dsw-specific-bubble）与输入卡片（--dsw-specific-input-major，
       含读同一 token 的工具弹卡）。正文里的 markdown 内容面（代码块 / 行内代码 /
       标签 / 引用）**不**跟本旋钮：它们是内容渲染面，与侧边栏一起跟全局保真度
       （用户口径：代码块不和输入框一起）。缺省 1 = 与全局完全同值。 */
    --we-chat-readability-floor: calc(var(--we-readability-floor-base) * var(--we-chat-glass-fidelity, 1));
    --we-chat-readability-base: var(--we-chat-surface-tint-light, #ffffff);
    /* ⚠️ 这两条必须排在 --we-readability-base **之后**：verify-readability 的 F1c 按
       "floor 紧跟 base" 的正则取这两条声明（插在中间会让整条可读性网格读到 null）。
       侧栏「跟随全局」用的玻璃色：与其余面板**同一个**按主题钳制后的染色地板值 ——
       内联写死会盖掉"按主题"，所以由样式表给；effects 里只写 var(--we-follow-tint)。
       侧栏的釉（镜面渐变三档）也收在这里：原生左栏与 dsh-better-sidebar 两侧栏共用同一道，
       否则"跟随全局"之后两侧栏仍会差一层白釉。 */
    --we-follow-tint: var(--we-surface-tint-light, #ffffff);
    --we-panel-sheen-a: 0.10; --we-panel-sheen-b: 0.03; --we-panel-sheen-c: 0.05;
  }
  body[data-ds-dark-theme] {
    --we-readability-floor-base: ${READABILITY_FLOOR_DARK};
    --we-readability-floor: calc(var(--we-readability-floor-base) * var(--we-glass-fidelity, 1));
    --we-readability-base: var(--we-surface-tint-dark, #0d1524);
    --we-chat-readability-floor: calc(var(--we-readability-floor-base) * var(--we-chat-glass-fidelity, 1));
    --we-chat-readability-base: var(--we-chat-surface-tint-dark, #0d1524);
    --we-follow-tint: var(--we-surface-tint-dark, #0d1524);
    --we-panel-sheen-a: 0.07; --we-panel-sheen-b: 0.02; --we-panel-sheen-c: 0.03;
  }

  /* ── 页面玻璃总锚点（data-we-glass-page）——**与有没有壁纸无关** ───────────────
     由 packages/glass/src/glass.js 恒挂（插件启用即挂，与 data-we-glass-chat / -window / -floaters
     同族）。壁纸只是玻璃的**背景来源**之一，不是玻璃的前提：没有壁纸时玻璃面照旧
     拿到地板色 / 霜 / 釉光 / 发丝边，压在宿主自己的基色与内容之上（用户口径：
     「页面玻璃效果不设置壁纸也要生效」）。
     ⚠️ 本锚点**不**等于 data-we-wallpaper：后者是"页面让开、露出壁纸层"，前者是
     "玻璃配方生效"。两者正交 —— 壁纸在场时同时成立，无壁纸时只有本锚点。
     raise border alpha for visibility, and apply the frosted-glass effect to
     opaque surfaces. */
  body[data-we-glass-page] {
    /* ── 表面令牌（#80）——在**令牌源头**接管，不逐面补选择器 ────────────────────
       宿主的对话框 / 面板 / 抬高按钮面读的都是别名层：--dsw-alias-bg-layer-1/2/3 是
       面板梯度（浅色三层同为白；深色 bluish-875/850/800 逐层抬亮），
       --dsw-alias-button-elevated-fill 是「抬高按钮」的实色（侧栏「新建会话」、
       工作区重命名输入框 —— 上游 #71 报的那类没玻璃的按钮）。它们保持宿主实色时，
       壁纸既透不出来、也没有自己的模糊，只有设置窗口那三档被接管过。
       这里套用**与设置窗口同一张配方表**：主题底色压可读性下限 + --we-surface-tint-light/dark
       按 --we-glass-alpha 混合，三档沿用 0.9 / 1.0 / 1.1 的层权重，抬高按钮再高半档
       （深色主题下必须比 layer-3 更亮，否则按钮与容器压平成同一块玻璃）。于是
       玻璃透明度 / 玻璃颜色 对 harness 自带的面同样生效，无需知道任何 CSS 模块哈希。
       代码块家族（--dsw-alias-markdown-code-block(-banner)）与行内代码 / 标签 / 分段
       同属下面「markdown 代码块 / 行内代码」那段映射 —— 裁定档案 harness-ui-surfaces.json 同源。
       ⚠️ 作用域是**整个页面玻璃锚点**，不是聊天流：宿主自己的侧栏按钮、右栏页签栏、
       设置窗内的卡片都读这一族令牌。5cabb9e1 的「表面所有权」重构曾把这里收窄成
       :where([data-chat-flow])，这些面于是全部退回宿主实底（用户原话：「这些我用红色
       矩形框选的类型的组件的玻璃效果又丢失了」）。已恢复为页面级；第三方插件的可读性
       由每条 color-mix 里的 --we-readability-floor 兜住，不是"无下限透明"。 */
    --dsw-alias-bg-layer-1: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-light, #ffffff) calc(var(--we-glass-alpha, 0.5) * 0.9 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-bg-layer-2: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-light, #ffffff) calc(var(--we-glass-alpha, 0.5) * 1.0 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-bg-layer-3: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-light, #ffffff) calc(var(--we-glass-alpha, 0.5) * 1.1 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-button-elevated-fill: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-light, #ffffff) calc(var(--we-glass-alpha, 0.5) * 1.15 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    /* ── 全表面玻璃（issue #71 的 glass-patch.css 收编）─────────────────────────
       覆盖壳层**其余**能画出实色面的别名 token（浮起按钮、弹层、工具条、引用块、
       占位图…），治的是「个别面仍是突兀实色块」。层权重沿用那份补丁的角色分档，
       但**每条都包上可读性下限**（补丁的裸 rgba 在花壁纸上会把菜单文字直接露给
       壁纸 —— 与 #82 同一条教训）。语义状态色（button-info-fill 等）与 accent 系
       按补丁原文**保持原生**。 */
    --dsw-alias-bg-overlay: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-light, #ffffff) calc(var(--we-glass-alpha, 0.5) * 1.3 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-bg-module-platform: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-light, #ffffff) calc(var(--we-glass-alpha, 0.5) * 1.15 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-bg-multi-select: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-light, #ffffff) calc(var(--we-glass-alpha, 0.5) * 1.2 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-button-floating-fill: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-light, #ffffff) calc(var(--we-glass-alpha, 0.5) * 1.1 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-button-ghost-active-fill: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-light, #ffffff) calc(var(--we-glass-alpha, 0.5) * 0.9 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-button-tool-bar-fill: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-light, #ffffff) calc(var(--we-glass-alpha, 0.5) * 1.0 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-interactive-bg-active: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-light, #ffffff) calc(var(--we-glass-alpha, 0.5) * 0.9 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-interactive-bg-hover-solid: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-light, #ffffff) calc(var(--we-glass-alpha, 0.5) * 1.0 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-markdown-citation: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      rgba(var(--we-surface-tint-rgb-light, 255, 255, 255), calc(var(--we-glass-alpha, 0.15) * 0.9)) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-markdown-placeholder: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      rgba(var(--we-surface-tint-rgb-light, 255, 255, 255), calc(var(--we-glass-alpha, 0.15) * 1.1)) calc((1 - var(--we-readability-floor)) * 100%));
    /* ── markdown 代码块 / 行内代码（"重点文字"）的底：与气泡**同一张配方表** ──────────
       用户口径（现场要求）："代码块和重点文字背景也需要和对话框背景一样进行玻璃化覆盖"。
       把底**纳入同一条可读性下限**（不能只做透明化：代码块底是 shiki 固定配色的画布，
       直接透出壁纸会让注释 / 字符串掉到不可读的对比）：
       底 = 主题底色@下限 + 玻璃色@玻璃透明度，而 shiki 的**前景色一个都不动** ——
       玻璃感进来了，最坏情况的对比仍由下限兜住（与气泡 / 输入卡片逐字同一条公式；
       下限的数学与实测见 test/verify-readability.mjs 的文件头）。
       ⚠️ 宿主这几条别名不是层令牌的派生（实测是 --dsw-static-neutral-bluish-50/900
       这类**静态**调色板），"映射层令牌"那条路对它们无效，两者不重叠。
       层权重：**代码块与标题条 = 气泡那一档（0.8 / 0.4）**（用户要的就是"和对话框一样"）；
       **行内代码 / 标签 / 未选中的分段 = 高一档（1.0 / 0.5）** —— 小色块要"比底稍亮"
       才留得住"这是一枚 chip"的读法（与抬高按钮高半档同一条层权重规矩）。 */
    --dsw-alias-markdown-code-block: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      rgba(var(--we-surface-tint-rgb-light, 255, 255, 255), calc(var(--we-glass-alpha, 0.15) * 0.8)) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-markdown-code-block-banner: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      rgba(var(--we-surface-tint-rgb-light, 255, 255, 255), calc(var(--we-glass-alpha, 0.15) * 0.8)) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-markdown-inline-code: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      rgba(var(--we-surface-tint-rgb-light, 255, 255, 255), var(--we-glass-alpha, 0.15)) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-markdown-tag: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      rgba(var(--we-surface-tint-rgb-light, 255, 255, 255), var(--we-glass-alpha, 0.15)) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-markdown-code-segment-unselected: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      rgba(var(--we-surface-tint-rgb-light, 255, 255, 255), var(--we-glass-alpha, 0.15)) calc((1 - var(--we-readability-floor)) * 100%));
    /* 选中的分段（代码卡的多文件页签）：**再高一档（1.15，与抬高按钮同档）** ——
       选中态靠"比未选中的那枚更亮"读出来，而不是靠回到实色（实色在这张玻璃卡上像一块白板）。 */
    --dsw-alias-markdown-code-segment-selected: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      rgba(var(--we-surface-tint-rgb-light, 255, 255, 255), calc(var(--we-glass-alpha, 0.15) * 1.15)) calc((1 - var(--we-readability-floor)) * 100%));
    /* Border emphasis: neutral gray so it reads on both light and dark themes;
       alpha is driven by the "边框" slider through --we-border-alpha. */
    --dsw-alias-border-l1: rgba(180, 180, 180, var(--we-border-alpha, 0.35));
    --dsw-alias-border-l2: rgba(180, 180, 180, var(--we-border-alpha, 0.35));
    --dsw-alias-border-l2-darkmode-thin: rgba(180, 180, 180, var(--we-border-alpha, 0.35));
    /* #255④：l3/l4 此前没纳入「边框」滑杆（宿主用它们画次级/浮层描边）⇒ 滑杆只“管到一部分边框”。 */
    --dsw-alias-border-l3: rgba(180, 180, 180, var(--we-border-alpha, 0.35));
    --dsw-alias-border-l4: rgba(180, 180, 180, var(--we-border-alpha, 0.35));
  }
  /* DSH rc.7+ injects the theme palette (design-platform.css) as a plugin-owned
     stylesheet appended to <head> AFTER this one, so in dark mode the shell's
     body[data-ds-dark-theme] rules (equal specificity 0,1,1, later in the
     document) win the cascade and repaint the app frame / sidebar / borders
     with their opaque dark colors — hiding the wallpaper behind them. Repeat
     the transparency + border-emphasis overrides under the higher-specificity
     dark selector (0,2,1) so the wallpaper always wins regardless of stylesheet
     order. */

  /* 深色档的**页面玻璃**映射：与上面那块逐条同形（同一张配方表、同一组层权重），
     只有玻璃色的**缺省值**不同：深色玻璃底色是深海军蓝。 */
  body[data-ds-dark-theme][data-we-glass-page] {
    --dsw-alias-bg-layer-1: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) calc(var(--we-glass-alpha, 0.5) * 0.9 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-bg-layer-2: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) calc(var(--we-glass-alpha, 0.5) * 1.0 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-bg-layer-3: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) calc(var(--we-glass-alpha, 0.5) * 1.1 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-button-elevated-fill: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) calc(var(--we-glass-alpha, 0.5) * 1.15 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    /* 全表面玻璃的深色档（issue #71，与浅色逐条同形；层权重见浅色块的注释）。 */
    --dsw-alias-bg-overlay: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) calc(var(--we-glass-alpha, 0.5) * 1.3 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-bg-module-platform: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) calc(var(--we-glass-alpha, 0.5) * 1.15 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-bg-multi-select: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) calc(var(--we-glass-alpha, 0.5) * 1.2 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-button-floating-fill: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) calc(var(--we-glass-alpha, 0.5) * 1.1 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-button-ghost-active-fill: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) calc(var(--we-glass-alpha, 0.5) * 0.9 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-button-tool-bar-fill: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) calc(var(--we-glass-alpha, 0.5) * 1.0 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-interactive-bg-active: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) calc(var(--we-glass-alpha, 0.5) * 0.9 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-interactive-bg-hover-solid: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) calc(var(--we-glass-alpha, 0.5) * 1.0 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-markdown-citation: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      rgba(var(--we-surface-tint-rgb-dark, 13, 21, 36), calc(var(--we-glass-alpha, 0.15) * 0.9)) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-markdown-placeholder: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      rgba(var(--we-surface-tint-rgb-dark, 13, 21, 36), calc(var(--we-glass-alpha, 0.15) * 1.1)) calc((1 - var(--we-readability-floor)) * 100%));
    /* ── markdown 代码块家族的深色档 ──────────────────────────────────────────
       与浅色档逐条同形（公式 / 层权重逐字一致，只有 tint 换 --we-surface-tint-rgb-dark）：
       深色模式下宿主的静态黑画布会按级联赢回（浅色档 0,1,1 撞不过宿主
       body[data-ds-dark-theme] 的后置同权重规则），代码块整块黑底 ⇒ 必须在此逐条覆盖。 */
    --dsw-alias-markdown-code-block: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      rgba(var(--we-surface-tint-rgb-dark, 13, 21, 36), calc(var(--we-glass-alpha, 0.15) * 0.8)) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-markdown-code-block-banner: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      rgba(var(--we-surface-tint-rgb-dark, 13, 21, 36), calc(var(--we-glass-alpha, 0.15) * 0.8)) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-markdown-inline-code: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      rgba(var(--we-surface-tint-rgb-dark, 13, 21, 36), var(--we-glass-alpha, 0.15)) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-markdown-tag: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      rgba(var(--we-surface-tint-rgb-dark, 13, 21, 36), var(--we-glass-alpha, 0.15)) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-markdown-code-segment-unselected: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      rgba(var(--we-surface-tint-rgb-dark, 13, 21, 36), var(--we-glass-alpha, 0.15)) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-markdown-code-segment-selected: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      rgba(var(--we-surface-tint-rgb-dark, 13, 21, 36), calc(var(--we-glass-alpha, 0.15) * 1.15)) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-border-l1: rgba(180, 180, 180, var(--we-border-alpha, 0.35));
    --dsw-alias-border-l2: rgba(180, 180, 180, var(--we-border-alpha, 0.35));
    --dsw-alias-border-l2-darkmode-thin: rgba(180, 180, 180, var(--we-border-alpha, 0.35));
    /* #255④：l3/l4 此前没纳入「边框」滑杆（宿主用它们画次级/浮层描边）⇒ 滑杆只“管到一部分边框”。 */
    --dsw-alias-border-l3: rgba(180, 180, 180, var(--we-border-alpha, 0.35));
    --dsw-alias-border-l4: rgba(180, 180, 180, var(--we-border-alpha, 0.35));
  }
  /* ── 浮层不吃页面玻璃那张令牌映射（issue #161 的漏网形态）─────────────────────────
     上面两处在令牌源头把面板梯度改成「底色压可读性下限 + 玻璃色」的半透明配方：对面板
     正确（背后只有壁纸），对浮层错误 —— 浮层背后是界面自己的正文，任何 < 100% 的覆盖
     都会让底下那行字透上来，表现成「两行字叠在一起」的重影。#161 只豁免了气泡那几条
     填色规则、没豁免令牌映射，本组补的就是这道缺的豁免。
     判据不能只取 role（dsh-context 只在部分浮层实例上写 role：趋势图与耗时时间轴的
     tip 都没写）⇒ 同时认浮层的命名约定。子串匹配有意不区分大小写：宿主哈希类名是
     camelCase（KZf9OG_brokenTip），只匹配 -tip 会漏；误伤面（multiply 这类）的后果
     只是令牌在它上面被重声明，只有它真拿该令牌当底才有观感差异。
     底色取 --we-panel-color（主题感知），一条规则同时覆盖深浅两主题，且与浮层文字
     （宿主与第三方都读 --dsw-alias-label-primary）维持原生配对。不要改借宿主 Tooltip
     那对专用令牌 —— 那是「深底 + 固定近白字」，浅色主题下浮层会变成黑底黑字。 */
  body[data-we-glass-page] [role="tooltip"],
  body[data-we-glass-page] [role="menu"],
  body[data-we-glass-page] [role="listbox"],
  body[data-we-glass-page] [class*="tip" i],
  body[data-we-glass-page] [class*="hint" i],
  body[data-we-glass-page] [class*="float" i],
  body[data-we-glass-page] [class*="popover" i],
  body[data-we-glass-page] [class*="hovercard" i],
  body[data-we-glass-page] [class*="dropdown" i],
  body[data-we-glass-page] [class*="popup" i] {
    --dsw-alias-bg-layer-1: color-mix(in srgb, var(--we-panel-color, #1e1f26) 96%, transparent);
    --dsw-alias-bg-layer-2: color-mix(in srgb, var(--we-panel-color, #1e1f26) 96%, transparent);
  }
  /* 第二类漏网：既没有 role、类名也不含浮层约定词的面板浮层（dsh-market 的 .opPanel、
     @linxin666 插件管理器的更新面板）。判据取源码级属性优先（[data-update-panel]），
     CSS Module 名只作兜底（[class*="opPanel"]：哈希前缀随构建变，语义后缀才稳）。
     这里不给令牌、直接给不透明实底：三步探针证明选择器命中、该元素也是视觉容器，但
     令牌赋值在这两个元素上不落地（92% / 96%、带不带 !important 都试过）。浮层本来
     就不该玻璃化（#161 的口径），实底既满足可读性又少一层不确定性 —— 别把这两条
     「优化」回令牌或 alpha 写法，否则它们会重新变透。
     [data-install-registry]（插件源 fieldset）不放进本组：它属于「浮层玻璃」面的成员，
     W5 要求整面同锚点（data-we-glass-floaters），混进来会让 verify-glass-surfaces 判红；
     它的底色归 floaters 面那条既有规则管（见 lib/client.js 的 #156② 注释）。 */
  body[data-we-glass-page] [data-update-panel],
  body[data-we-glass-page] [class*="opPanel" i] {
    background-color: #ffffff !important;
  }
  body[data-ds-dark-theme][data-we-glass-page] [data-update-panel],
  body[data-ds-dark-theme][data-we-glass-page] [class*="opPanel" i] {
    background-color: #1e1f26 !important;
  }
  /* #73 增强模式 + Win10（无 Mica）：桌面外壳只在系统材质可用时让左侧工作区
     (.dshDesktopSidebarSurface) 保持透明（壁纸透出）；material 回退 off 时它改用
     --dsw-alias-bg-layer-1 实心绘制该区域，并把内部 sidebar 的
     --dsw-specific-sidebar-fill 也改成实心色 —— 壁纸在这里完全不生效，只剩一块与
     系统材质绑定的死底色。detectMicaSupport() 把「无 Mica」作为稳定钩子挂到
     body[data-we-mica="off"]，这里用插件自己的近不透明玻璃面接管该区域：配方与
     无 backdrop-filter 的内容面回退完全一致（主题面板色 + --we-content-surface-alpha，
     由「内容面透明度 / 内容面底色」控制，默认 70% 不透明，壁纸仍有一层微光），
     同时放行内部 fill token，让这块面重新与壁纸 + 暗化层同步。Mica 可用时该属性
     不存在，本规则不参与匹配，行为与今天逐字节相同。
     整条规则再经 [data-we-adapter^="desktop-"] 门控：壳层材质只可能是桌面壳的
     事，原生浏览器形态（body[data-we-adapter="browser"]）不参与匹配。 */
  body[data-we-adapter^="desktop-"][data-we-mica="off"][data-we-wallpaper] .dshDesktopSidebarSurface {
    --dsw-specific-sidebar-fill: transparent !important;
    background-color: color-mix(in srgb, var(--we-content-surface-color, var(--we-panel-color, #1e1f26)) max(calc(var(--we-readability-floor) * 100%), var(--we-content-surface-alpha, 88%)), transparent) !important;
  }
  /* ── iOS liquid glass ──────────────────────────────────────────────────────
     The opaque conversation surfaces become translucent glass. The recipe is
     Apple-like, not a plain blur:
       - LARGE-radius blur + a modest constant saturation + brightness/contrast
         lift, so the wallpaper colour melts into a soft glow instead of a gray
         smear (saturation is DECOUPLED from the blur radius — see GLASS_SATURATE
         in applyEffects — so a big radius no longer amplifies the residual
         wallpaper text into a colour ghost);
       - a top-weighted specular gradient (background-image) — the sheen is
         what makes the surface read as "wet glass", not a flat tint;
       - a light, low-alpha base (not a dark one) so the wallpaper shows through;
       - a 1px top refraction highlight + 0.5px hairline + soft elevation
         shadow for "thick glass";
       - --we-blur drives the blur radius (the 玻璃 slider's one job now) and
         --we-saturate is a flat material constant, so composer, bubbles AND the
         better-sidebar shell stay in one uniform liquid look at every radius.

     Transparency is driven through the design tokens the surfaces already read
     (--dsw-specific-input-major on the composer card, --dsw-specific-bubble on
     message bubbles) rather than through class selectors: CSS-module class
     names are build hashes and change whenever the shell frontend is rebuilt,
     which silently kills the effect. backdrop-filter cannot be expressed as a
     token, so the blur itself still needs an element selector — [data-composer-card]
     is authored in the shell source and survives rebuilds. Bubbles carry no such
     attribute, so they fall back to the module-CSS suffix convention; if that
     ever stops matching the bubble stays translucent, just without the blur.
     Both tokens carry text, so both go through the readability floor (the
     composer card AND the tool popups that read --dsw-specific-input-major). */
  body[data-we-glass-page] {
    --dsw-specific-input-major: color-mix(in srgb,
      var(--we-chat-readability-base) calc(var(--we-chat-readability-floor) * 100%),
      rgba(var(--we-chat-surface-tint-rgb-light, 255, 255, 255), var(--we-glass-alpha, 0.15)) calc((1 - var(--we-chat-readability-floor)) * 100%));
    --dsw-specific-bubble: color-mix(in srgb,
      var(--we-chat-readability-base) calc(var(--we-chat-readability-floor) * 100%),
      rgba(var(--we-chat-surface-tint-rgb-light, 255, 255, 255), calc(var(--we-glass-alpha, 0.15) * 0.8)) calc((1 - var(--we-chat-readability-floor)) * 100%));
  }
  body[data-ds-dark-theme][data-we-glass-page] {
    /* The ×0.4 / ×0.33 factors below only scale the TINT operand; the floor
       keeps its own weight, so the dark-theme undercut cannot happen. */
    --dsw-specific-input-major: color-mix(in srgb,
      var(--we-chat-readability-base) calc(var(--we-chat-readability-floor) * 100%),
      rgba(var(--we-chat-surface-tint-rgb-dark, 255, 255, 255), calc(var(--we-glass-alpha, 0.15) * 0.4)) calc((1 - var(--we-chat-readability-floor)) * 100%));
    --dsw-specific-bubble: color-mix(in srgb,
      var(--we-chat-readability-base) calc(var(--we-chat-readability-floor) * 100%),
      rgba(var(--we-chat-surface-tint-rgb-dark, 255, 255, 255), calc(var(--we-glass-alpha, 0.15) * 0.33)) calc((1 - var(--we-chat-readability-floor)) * 100%));
  }
  /* Chat glass is explicitly transparent: use the user's tint alpha once.
     Shared host tokens retain their floors for popups and other app surfaces. */
  body[data-we-glass-page] {
    --we-chat-glass-fill: rgba(var(--we-surface-tint-rgb-light, 255, 255, 255), var(--we-glass-alpha, 0.15));
    --we-capsule-glass-fill: rgba(var(--we-capsule-tint-rgb, 255, 255, 255), var(--we-inline-code-alpha, 0.10));
    --we-tool-glass-fill: rgba(var(--we-surface-tint-rgb-light, 255, 255, 255), calc(var(--we-glass-alpha, 0.15) + 0.06));
    /* 历史上这里还有一条 #156③ 的 --we-composer-seat-fill（输入座位底板）；该底板已按
       用户口径**整条撤回**（见下面 seat 那段的注释），令牌一并清掉 —— 不留死声明。
       它进了 test/verify-glass-surfaces.mjs 的 REAPED_VARS 名单，被重新消费即红。 */
    /* #156① 宿主 Modal 的遮罩本来就自己画 backdrop-filter: var(--dsw-mask-blur)，
       但主题把这条令牌定义成**裸 body** 上的 none（即宿主默认无霜）⇒ 玻璃面板背后是
       一张没被模糊的壁纸。这里在特异度更高的 body[data-we-glass-page] 上重声明它，
       宿主自己的遮罩规则就会取到插件的霜 —— 一次覆盖该通道上的**所有**宿主浮层
       （设置对话框、图片灯箱、各类 role=dialog 面板），不必逐个选择器补。
       这是宿主**自有**的模糊通道，不是去猜它的 CSS 模块哈希。 */
    --dsw-mask-blur: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
    /* #157 滚动条拇指并入插件取色：宿主把拇指色写成四个**静态中性色**
       （浅色 neutral-200/300、深色 neutral-700/600/550），与插件的玻璃色相无关，
       压在玻璃面板上就显得突兀。这里在 body[data-we-glass-page] 上重声明底层四个
       --dsw-alias-scrollbar-* 令牌 —— 宿主各处滚动容器的局部重声明写的都是
       var(--dsw-alias-scrollbar-bg-l2) 这一层间接（自定义属性按元素解析，不是按
       声明处解析），所以一次覆盖全应用，不需要逐个锚点补，也不碰任何类名哈希。
       色阶仍沿用宿主那一级（可视性不变），只把中性色的**色相**换成用户选的玻璃
       底色；浅色下取更暗一级的静态中性色，抵掉混色带来的提亮。
       ⚠️ 权重 40% → 65%：40% 玻璃色 + 60% 灰阶在**深色低饱和**玻璃色
       （如藏青 #0d1524）下色相被灰阶洗光 —— 拇指复算 ≈#525659，与宿主原生灰
       （neutral-600 #545557）不可分，观感等于退回 #157 修复前（用户实测报回归）。
       65% 让色相在任何玻璃色下都存活；亮度台阶仍由中性色锚定档决定，锚不变。 */
    --dsw-alias-scrollbar-bg-l1: color-mix(in srgb, var(--we-surface-tint-light, #ffffff) 65%, var(--dsw-static-neutral-300, #d4d4d4));
    --dsw-alias-scrollbar-bg-l2: color-mix(in srgb, var(--we-surface-tint-light, #ffffff) 65%, var(--dsw-static-neutral-300, #d4d4d4));
    --dsw-alias-scrollbar-hover-l1: color-mix(in srgb, var(--we-surface-tint-light, #ffffff) 65%, var(--dsw-static-neutral-400, #a2a4a6));
    --dsw-alias-scrollbar-hover-l2: color-mix(in srgb, var(--we-surface-tint-light, #ffffff) 65%, var(--dsw-static-neutral-400, #a2a4a6));
  }
  body[data-ds-dark-theme][data-we-glass-page] {
    --we-chat-glass-fill: rgba(var(--we-surface-tint-rgb-dark, 13, 21, 36), var(--we-glass-alpha, 0.15));
    --we-tool-glass-fill: rgba(var(--we-surface-tint-rgb-dark, 13, 21, 36), calc(var(--we-glass-alpha, 0.15) + 0.06));
    /* 滚动条（#157）：暗主题宿主取 neutral-700/600（静态）与 600/550（悬停），混色会把整体
       压暗，所以每档都往亮一级取，混完仍落在宿主原来的亮度台阶上（宿主 l2 与 hover-l1 同值，
       这里同样同值）。权重 65% 同浅色档（见上：深色低饱和玻璃色的色相存活）。 */
    --dsw-alias-scrollbar-bg-l1: color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) 65%, var(--dsw-static-neutral-600, #545557));
    --dsw-alias-scrollbar-bg-l2: color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) 65%, var(--dsw-static-neutral-500, #7f8287));
    --dsw-alias-scrollbar-hover-l1: color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) 65%, var(--dsw-static-neutral-500, #7f8287));
    --dsw-alias-scrollbar-hover-l2: color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) 65%, var(--dsw-static-neutral-400, #a2a4a6));
  }
  /* ⚠️ 这组「气泡直接读 --we-chat-glass-fill」是**思考玻璃功能的一部分**，必须挂
     [data-we-thinking-glass] 门 —— 否则默认态会改掉气泡的底色、并绕开「对话栏玻璃保真度」
     的令牌契约。关 = 逐字节现状。
     ⚠️ **输入框（[data-composer-card]）退出思考玻璃作用域**：输入卡不铺这层 fill 接管，
     开关开 = 输入框与关着时逐位相同（只受基础对话栏玻璃与「对话框玻璃·独立配置」管）。
     守卫：verify-glass-surfaces「思考玻璃门下不得出现 data-composer-card」。
     ⚠️ **宿主 Tooltip 也是 *_bubble**（issue #161）：宿主把悬浮提示的元素类名编译成
     _bubble_ + 哈希 + 序号（dsh-client-ui-primitives 的 Tooltip），与对话气泡共享
     [class*="_bubble"] 这个后缀约定，但它是**独立浮层**：底色读 --dsw-alias-tooltip-bg
     （浅色 #2c2c2e 实色，深色 #43454a），文字固定 --dsw-static-neutral-bluish-00（近白），
     且**位置不受 [data-chat-flow] 约束**（可能渲染在触发元素旁）。这层 fill 覆盖上去后
     深底变浅底、白字不变 ⇒ 白字压浅底（实测 1.07–1.13:1，见 #161）。
     判据取宿主自己写在气泡上的 role="tooltip"（全 asar 仅出现一次，就是这一处），
     它同时免疫类名哈希漂移与浮层 DOM 位置，比 [data-chat-flow] 作用域更可靠。
     ⇒ **本文件所有 [class*="_bubble"] 规则都必须带这道豁免**，
     守卫：verify-readability「F2dN 每条 _bubble 规则都必须带 role="tooltip" 豁免」——
     这条判据以前还接受"头里有 [data-chat-flow] 就放行"，于是把某条的 :not(...) 摘掉仍全绿；
     作用域（在对话流里）与豁免（不是宿主 Tooltip 那个 _bubble）是两件事，现在分别钉住。 */
  body[data-we-glass-page][data-we-thinking-glass] [class*="_bubble"]:not([role="tooltip"]) {
    background-color: var(--we-chat-glass-fill) !important;
  }
  /* ── 三挡的一半：「关」挡的交付物文件卡是**半透明**（用户实测回归）─────────────
     「思考块液态玻璃」三挡的产品语义是 **关 = 半透明 / 液态玻璃 = 磨砂玻璃 / 原生 = 实色**。
     气泡与输入框在「关」挡下本来就吃 --we-chat-glass-fill（下面那组里带
     :not([data-we-thinking-native]) 的规则），但**宿主交付物卡片（data-presented-file）漏了
     这一档**：它只在 data-we-thinking-glass 门下才被清成 transparent，于是「关」挡下保留
     宿主不透明的 --deliverable-fill（暗色主题 = --dsw-static-neutral-850）⇒ 屏上一块
     实心深色卡，与旁边半透明气泡不是同一种材质（用户原话："关闭挡位时应该是半透明的"）。
     这里补的就是缺的那一档：**同一份 chat 釉、不加霜**（"关" = 无磨砂）。
     · 液态玻璃挡不受影响：那条 background: transparent !important 在更后面（同权重后胜），
       仍然是既有的"清底"形态。
     · 原生挡不匹配（:not([data-we-thinking-native])）⇒ 卡片保持宿主实色，正是该挡的定义。
     · 宿主 hover 档（--deliverable-hover）在本挡会被 !important 压住、卡片悬停不变色 ——
       刻意的取舍：底色正确优先（材质一致性 + 可读性），悬停反馈由边框/光标承担。
     ⚠️ 本段不许出现反引号：整套样式文本是模板字符串（构建期拼接）。 */
  body[data-we-glass-chat][data-we-glass-page]:not([data-we-thinking-glass]):not([data-we-thinking-native]) [data-presented-file] {
    background-color: var(--we-chat-glass-fill) !important;
    background-image: none !important;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
  /* ⚠️ 正文原生挡（data-we-thinking-native，见文件下方「正文原生挡」块）：只有**气泡**
     这一条带 :not() —— 原生挡下气泡退出霜釉（正文原生 = 无玻璃装饰）；**输入卡与工具
     弹卡不豁免**（用户口径：输入对话框保留玻璃），照旧吃霜/釉。
     气泡这条还带第二道 :not([role="tooltip"])：这一组是**恒挂**的（默认就生效），
     不加豁免就会给宿主 Tooltip 抹上白釉 + 模糊（#161），详见上面那条注释。 */
  body[data-we-glass-chat][data-we-glass-page] [data-composer-card],
  body[data-we-glass-chat][data-we-glass-page]:not([data-we-thinking-native]) [class*="_bubble"]:not([role="tooltip"]),
  /* Interactive tool popup cards read the SAME --dsw-specific-input-major
     token as the composer (question / plan-review / approval), so they turn
     translucent along with it — but unlike the composer they had NO
     backdrop-filter, so at high transparency the popup's own text sits
     directly on the busy wallpaper → 文字重叠 (#66). Each popup renders its
     surface as a css-module *_card child of a STABLE, source-authored
     container attribute: [data-question-key] (ask_user_question),
     [data-plan-review-key] (plan review / exit_plan_mode panel) and
     [data-approval-key] (tool-permission approval card). We scope _card
     inside those containers instead of a broad [class*="_card"] (which would
     also blur nested *_cardBody / hovercard surfaces). */
  body[data-we-glass-chat][data-we-glass-page] [data-question-key] [class*="_card"],
  body[data-we-glass-chat][data-we-glass-page] [data-plan-review-key] [class*="_card"],
  body[data-we-glass-chat][data-we-glass-page] [data-approval-key] [class*="_card"] {
    /* Specular sheen: a top-weighted white gradient turns a flat translucent
       tint into "wet glass" — kept faint so the wallpaper stays 通透 (clear)
       instead of glaring. */
    background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.05) 38%, rgba(255, 255, 255, 0.02));
    -webkit-backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
    backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, var(--we-glass-highlight, 0.32)),
      inset 0 -1px 0 rgba(255, 255, 255, 0.08),
      inset 0 0 0 0.5px rgba(255, 255, 255, 0.08),
      0 12px 40px rgba(0, 0, 0, var(--we-glass-shadow, 0.12));
  }
  /* ── 思考触发条（TurnTriggerNodeView，DOM 锚点 section[data-turn-trigger]）──────────
     ⚠️ 门 = 上游 #134 的「思考块液态玻璃」（属性 data-we-thinking-glass，默认关）：这一面是它
     **门下的**一员 —— 开关关着时下面整组不生效（宿主令牌不被接管、模糊不挂）⇒ 「关 = 逐字节
     现状」。与推理面不同：推理面「清底 + 无霜」（见上面那组），触发条**不清底、吃玻璃**
     （用户口径：触发条要玻璃，不要纯透明），并给它自己的「独立配置」。
     宿主给它一个**专属底色令牌** --dsw-alias-turn-trigger-bg（回退到代码块底色）—— 我们接管它，
     于是宿主自己那条 background: 直接解析成玻璃（**不是**去改宿主的哈希类名）。
     ⚠️ 用**全局**那对可读性变量（--we-readability-base / -floor + --we-surface-tint-*）：
     这一面在登记表里是 tier: 'global'（内容块一类），而对话栏那对是**专属**给气泡/输入框的
     —— 判据 verify-readability 的 F2c 会按"消费点计数"当场判出用错（实测踩过一次）。
     配方与上面的 --dsw-alias-bg-layer-1 同形，层权重取 0.9。
     ⚠️ -hover 必须一起接管：宿主 :hover 会换用它（回退是 --dsw-alias-interactive-bg-hover
     那种不透明灰）⇒ 不接管的话鼠标一悬停就盖掉玻璃。这里给它**同一配方、权重略高**
     （1.15，仍远不到不透明）⇒ 既保住玻璃又保留"可点"的悬停反馈。 */
  body[data-we-thinking-glass][data-we-glass-page] {
    --dsw-alias-turn-trigger-bg: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-light, #ffffff) calc(var(--we-thinking-trigger-alpha, var(--we-glass-alpha, 0.5)) * 0.9 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-turn-trigger-bg-hover: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-light, #ffffff) calc(var(--we-thinking-trigger-alpha, var(--we-glass-alpha, 0.5)) * 1.15 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
  }
  /* 深色档同形，只是釉色改用深色那一支（--we-surface-tint-dark）。多一层属性选择器
     （0,3,1）才顶得掉上面那条浅色定义 —— 与文件里其余「深色孪生」的做法一致。 */
  body[data-ds-dark-theme][data-we-thinking-glass][data-we-glass-page] {
    --dsw-alias-turn-trigger-bg: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-dark, #000000) calc(var(--we-thinking-trigger-alpha, var(--we-glass-alpha, 0.5)) * 0.9 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-turn-trigger-bg-hover: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-dark, #000000) calc(var(--we-thinking-trigger-alpha, var(--we-glass-alpha, 0.5)) * 1.15 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
  }
  /* 模糊载体：宿主组件只有 header/body 两段文字，**不含** position:fixed 后代 ⇒ 模糊可以留在
     元素本身（与气泡 / 工具弹卡同形；不必像 [data-composer-card] 那样搬到 ::before）。
     底色走上面接管的 --dsw-alias-turn-trigger-bg（含 hover 档），所以这里只补
     "釉面高光 + 模糊" 两件事 —— 语法与上面那族逐字相同，读同一批 --we-* 变量。 */
  body[data-we-thinking-glass][data-we-glass-page] [data-turn-trigger] {
    background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.05) 38%, rgba(255, 255, 255, 0.02));
    -webkit-backdrop-filter: blur(var(--we-thinking-trigger-blur, var(--we-blur, 16px))) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
    backdrop-filter: blur(var(--we-thinking-trigger-blur, var(--we-blur, 16px))) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
  }
  /* ── 输入座位（composer seat）：**不铺底板**（#156③ 于启用后撤回）─────────────
     宿主把「输入卡 + dock 行（统计行 / 模型按钮 / ContextMeter）」一起装进
     [data-composer-seat] 这条**整宽**的 sticky 座位（实测 110–130px 高），并给它画一条
     「透明 → --dsw-alias-bg-base」的渐变当底板。宿主那块之所以看不出来，是因为它的
     颜色就是**页面底色**（原生不透明 ⇒ 与整页同色、天然隐形）；插件把
     --dsw-alias-bg-base 置成 transparent（好让壁纸透出来）之后，同一块面积就不再隐形
     ⇒ #156③ 曾在这里补一条插件配方（独立令牌 --we-composer-seat-fill），但**几何照抄
     宿主**（0px 渐显之后铺满整个座位）在壁纸上读成「一条很高的灰色遮罩条」（用户口径）；
     收窄成"只铺贴底 48px 的渐隐 + 按 70% 稀释"之后，用户仍认为那一条多余 ⇒ **整条撤回**，
     座位回到无底板（宿主那条渐变继续因为令牌被置成 transparent 而画不出东西）。
     代价（有意接受）：最下面那条 dock 带自己没有底色，直接压在壁纸上 —— 撤回后的用户
     口径优先于 #156③ 的"统计行需要底板"，而且这正是宿主原生模式下的观感（那边只是
     恰好与页面同色）。
     ⚠️ 撤回之后**不许**再把底板加回来：verify-glass-surfaces 第 ⑯ 组钉住"座位不铺任何
     背景、也不挂霜"，已清理的 --we-composer-seat-fill 同时进了同文件的 REAPED_VARS
     名单（被重新消费即红）。要重开这个话题，先回到用户口径确认，而不是回到 #156③ 的
     原文（它的"症状"在这个产品口径下不算症状）。
     ⚠️ 座位也**不许挂霜**：座位里就有 [data-composer-card]，而它内部有 position:fixed
     后代（AI 浏览器座位，#89，见下面那段）—— 在座位上挂 backdrop-filter 会把那些
     fixed 后代重新锚到座位上（掉约 522px）。输入卡自己那层 ::before 霜照旧。
     ⚠️ 锚点取宿主源码里写死的 data-composer-seat / data-conversation-region
     （conversation 包 composerSeat 的 JSX），不猜 CSS 模块哈希；[data-chat-flow] 在这
     一面**不可用**（座位是 ChatView 那一列的兄弟节点，不在会话流里）。 */
  /* ── composer card: the blur must not live on the card itself ─────────────
     [data-composer-card] contains position:fixed descendants: @dsh-external/
     dsh-webui mounts the "AI 浏览器" seat (.dsh-browser-seat-wrap) inside it with a
     hard-coded position:fixed. A non-none backdrop-filter makes the element a
     containing block for its fixed descendants, so that button stops being
     viewport-anchored and drops ~522px below the card. The seat then carries
     543px of phantom overflow, which becomes extra scrollable content in the
     conversation scroller: by the time you reach the bottom the sticky travel is
     already spent, so the composer is left stranded above it (#89).
     Hosting the blur on ::before fixes it — a pseudo-element has no DOM
     descendants, so it can never become a containing block. Same blur radius,
     same --we-* tokens, same inset/radius → visually identical.
     把模糊改由 ::before 伪元素承载：伪元素没有 DOM 后代，不会成为 fixed 后代的包含块。 */
  body[data-we-glass-chat][data-we-glass-page] [data-composer-card] {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
  body[data-we-glass-chat][data-we-glass-page] [data-composer-card]::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    z-index: -1;
    -webkit-backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
    backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
  }
  /* ⚠️ 用户口径：**输入框整族退出思考玻璃** ——「+」按钮回到宿主原样，
     --dsw-specific-selector 令牌不再被插件改写。
     守卫：verify-glass-surfaces「思考玻璃门下不得出现 data-composer-card / _add」。 */

  /* ── 轨迹（trajectory）视图的内容区：补**霜** ──────────────────────────────
     现场口径："轨迹内容区域也同样做玻璃化"。实测根因**不是**"没映射令牌"：轨迹模块的内容容器
     读的就是 --dsw-alias-bg-layer-1（.rkta1W_split / _overviewPreview / _programPanel 都是），
     而那条我们早就映射成玻璃配方了 —— 所以它其实**已经半透明**。真正缺的是**霜**：整个轨迹
     模块**一条 backdrop-filter 都没有**（实测 289 条规则里零条），于是它在花壁纸上只是
     "平涂的一层纱"，读起来就是"没玻璃化"（与侧栏面板当初那圈"黑框"同一类问题，只是这次缺霜不缺底）。
     这里**只补霜 + 镜面釉，不再叠一层底**：父层已经拿到玻璃配方，再叠一层会让两层下限相乘、
     越叠越不透明 —— 那正好把这次想要的那点通透又收回去。
     选择器只用**轨迹模块独有**的类名子串（实测 _tablePane / _overviewPreview / _programPanel
     全宿主只有轨迹模块在用；_details / _split 别的模块也有 ⇒ 不碰：宁可少盖一层，也不误伤别处）。
     CSS 模块哈希是构建产物，稳定的是 "_<类名>" 这半边（与 [class*="_bubble"] / [class*="_panel"]
     同一手法）。
     ⚠️ 实测该模块里没有 position:fixed ⇒ 在这些元素上加 backdrop-filter 不会让 fixed 后代改锚
     （#89 那类问题）；模糊挂在滚动区上与侧栏面板同一条政策。回退档不需要额外处理：那一条
     --dsw-alias-bg-layer-1 已经被钉回不透明面板色，底下不再是壁纸。 */
  body[data-we-glass-page] [class*="_tablePane"],
  body[data-we-glass-page] [class*="_overviewPreview"],
  body[data-we-glass-page] [class*="_programPanel"] {
    /* 与侧栏面板同一档镜面釉（比气泡那档再淡一点：这是大片内容区，太亮会发白）。 */
    background-image: linear-gradient(180deg,
      rgba(255, 255, 255, 0.14),
      rgba(255, 255, 255, 0.04) 38%,
      rgba(255, 255, 255, 0.01));
    -webkit-backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
    backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.32),
      inset 0 -1px 0 rgba(255, 255, 255, 0.08),
      inset 0 0 0 0.5px rgba(255, 255, 255, 0.06);
  }
  /* Note (anti-flicker): the composer/bubbles keep ONLY the backdrop-filter
     glass — no always-on transform/will-change/contain layers, which add
     compositing layers without stopping the white flash. The flash comes from a
     permanent CSS filter on the rope, so the rope must carry no filter. */

  /* Reasoning and file bars are fully clear; message fences and tool
     results use glass plates. Inner bodies never stack another background. */
  body[data-we-glass-page][data-we-thinking-glass] {
    --dsw-alias-markdown-inline-code: var(--we-capsule-glass-fill);
  }
  /* ⚠️ [data-turn-trigger]（思考触发条）**不在本组**：本仓把它做成了一个吃玻璃、可独立配置的
     面（见上面「思考触发条」那一节 —— 接管宿主专属令牌 + 模糊载体，同在 data-we-thinking-glass
     门下）。两者"门共用、这面例外" ⇒ 推理面清底、触发条吃玻璃。 */
  body[data-we-glass-page][data-we-thinking-glass] [data-vcp-reasoning],
  body[data-we-glass-page][data-we-thinking-glass] [data-changed-files],
  body[data-we-glass-page][data-we-thinking-glass] [data-presented-file] {
    background: transparent !important;
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
  }
  body[data-we-glass-page][data-we-thinking-glass] [data-chat-flow] .md-code-block,
  body[data-we-glass-page][data-we-thinking-glass] [data-vcp-rawhtml] > div > div:has(> pre > code):has(> div > button[title="复制代码"]) {
    background: var(--we-chat-glass-fill) !important;
    -webkit-backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
    backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
  }
  body[data-we-glass-page][data-we-thinking-glass] [data-vcp-reasoning-body] {
    background: transparent !important;
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
  }
  /* 行内胶囊：十成白雾，**不带自己的霜**。
     宿主的内边距 / 圆角 / 文字颜色原样保留；围栏（pre > code）不在范围内。

     霜是被有意去掉的：backdrop-filter 载体会把胶囊背后的壁纸**重新采样并
     重绘** —— 采样区越大、重绘结果被降采样得越厉害，壁纸自己的细节（终端
     文字、细线）就变成横贯胶囊的糊条，读起来像「代码文字被模糊了」。载体
     跨行盒时还会断裂（宿主的 compact 变体把 chip 渲染成 display:inline），
     画出的区域是所有行盒的外接矩形、糊成一条盖住同行普通文字的横板 ——
     那正是 #197 记下的症状。没有载体，胶囊就是一层薄雾铺在下面那层**已经
     糊过**的表面上：代码文字保持清晰，壁纸也不会被采样两次。

     雾底与边框都留着；saturate / brightness 带不出来 —— 它们是
     backdrop-filter 的函数，没有载体就没有可滤的背景。 */
  body[data-we-glass-page][data-we-thinking-glass] [data-chat-flow] :not(pre) > code,
  body[data-we-glass-page][data-we-thinking-glass] [data-vcp-rawhtml] :not(pre) > code {
    background: var(--dsw-alias-markdown-inline-code) !important;
    background-image: none !important;
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
    border-color: var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.14)) !important;
  }
  /* ── Markdown 表格 ───────────────────────────────────────────────────────
     两个各自的毛病，在纯色背景上都看不出来：
       ① 表格是承载文字的面，自己却没有面 —— 壁纸直接透过单元格画出来，
          于是单元格文字的对比度跟着那一行背后的壁纸亮度起伏；
       ② 宿主用 .5px 发丝线（--dsw-alias-border-l2/l3）画网格，表头行也没有
          任何强调 ⇒ 整张表读起来像一堆悬空的字。
     修法：表格拿到代码块同款的可读性下限底面（单元格文字不再随壁纸起
     伏），表头给一条中性灰的抬起带，两级边框都抬到 1px 并落在插件自己的边框
     族上（「边框」滑杆继续管 alpha；中性灰在浅色 / 深色两个主题下都读得出；
     封顶 0.8 是为了不让滑杆拉满时变成一条全不透明的硬线）。
     底面**直接写配方**而不读 --dsw-alias-markdown-code-block：那条令牌会被
     工具结果面的清底规则置成 transparent（那里不该叠第二层面），表格要是
     读了它，在工具结果体内就会退化成一张没有底的网格。
     锚点只用语义元素（table / th / td）+ 宿主写死的 [data-chat-flow] /
     [data-vcp-rawhtml]：宿主的表格类名带构建哈希，docs/CODE-STRUCTURE.md §13
     判其稳定性为低，不许把用户可见行为挂在它上面。
     这条规则不加霜 ⇒ 不需要 glass-fallback 的孪生规则（回退模式要同一张网格）。 */
  body[data-we-glass-page][data-we-thinking-glass] [data-chat-flow] table,
  body[data-we-glass-page][data-we-thinking-glass] [data-vcp-rawhtml] table {
    background: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-light, #ffffff) calc(var(--we-glass-alpha, 0.15) * 0.8 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%)) !important;
  }
  body[data-ds-dark-theme][data-we-glass-page][data-we-thinking-glass] [data-chat-flow] table,
  body[data-ds-dark-theme][data-we-glass-page][data-we-thinking-glass] [data-vcp-rawhtml] table {
    background: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) calc(var(--we-glass-alpha, 0.15) * 0.8 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%)) !important;
  }
  body[data-we-glass-page][data-we-thinking-glass] [data-chat-flow] table th,
  body[data-we-glass-page][data-we-thinking-glass] [data-vcp-rawhtml] table th {
    background-color: rgba(180, 180, 180, calc(var(--we-border-alpha, 0.35) * 0.45)) !important;
    border-bottom: 1px solid rgba(180, 180, 180, min(0.8, calc(var(--we-border-alpha, 0.35) * 1.7))) !important;
    color: var(--dsw-alias-label-primary) !important;
  }
  body[data-we-glass-page][data-we-thinking-glass] [data-chat-flow] table td,
  body[data-we-glass-page][data-we-thinking-glass] [data-vcp-rawhtml] table td {
    border-bottom: 1px solid rgba(180, 180, 180, calc(var(--we-border-alpha, 0.35) * 0.9)) !important;
  }
  /* The two chat navigation buttons reuse capsule mist and frost.
     Local fill tokens preserve native hover/disabled states and hit areas. */
  body[data-we-glass-page][data-we-thinking-glass] [data-dsh-navbar] > button[data-vlln-load-older],
  body[data-we-glass-page][data-we-thinking-glass] [data-slot="conversation.view"] button[class*="_toBottom"] {
    --dsw-alias-bg-layer-2: var(--we-capsule-glass-fill);
    --dsw-alias-interactive-bg-hover: color-mix(in srgb, var(--we-capsule-glass-fill) 96%, white);
    --dsw-alias-button-floating-fill: var(--we-capsule-glass-fill);
    --dsw-alias-button-floating-hover: color-mix(in srgb, var(--we-capsule-glass-fill) 96%, white);
    -webkit-backdrop-filter: blur(var(--we-inline-code-blur, 8px)) saturate(var(--we-saturate, 1.3)) brightness(var(--we-glass-brightness, 1.04));
    backdrop-filter: blur(var(--we-inline-code-blur, 8px)) saturate(var(--we-saturate, 1.3)) brightness(var(--we-glass-brightness, 1.04));
  }
  /* The sidebar's new-session button uses the same thin capsule glass.
     Scope the expanded button; keep its label, shortcut and collapsed state. */
  body[data-we-glass-page][data-we-thinking-glass] [data-slot="sidebar"] :not([class*="_collapsed"]) > button[class*="_newSession"] {
    background: var(--we-capsule-glass-fill) !important;
    border-color: var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.14)) !important;
    -webkit-backdrop-filter: blur(var(--we-inline-code-blur, 8px)) saturate(var(--we-saturate, 1.3)) brightness(var(--we-glass-brightness, 1.04));
    backdrop-filter: blur(var(--we-inline-code-blur, 8px)) saturate(var(--we-saturate, 1.3)) brightness(var(--we-glass-brightness, 1.04));
  }
  body[data-we-glass-page][data-we-thinking-glass] [data-slot="sidebar"] :not([class*="_collapsed"]) > button[class*="_newSession"]:hover {
    background: color-mix(in srgb, var(--we-capsule-glass-fill) 96%, white) !important;
  }
  body[data-we-glass-fallback][data-we-glass-page][data-we-thinking-glass] [data-slot="sidebar"] :not([class*="_collapsed"]) > button[class*="_newSession"],
  body[data-we-glass-fallback][data-we-glass-page][data-we-thinking-glass] [data-dsh-navbar] > button[data-vlln-load-older],
  body[data-we-glass-fallback][data-we-glass-page][data-we-thinking-glass] [data-slot="conversation.view"] button[class*="_toBottom"] {
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
  }
  /* Seven inline tool-result bodies: one plate, six percentage points
     more coverage than a bubble. Root-local tokens clear headers/copy buttons
     without touching diff line highlights, syntax colours or sidebar tools. */
  body[data-we-glass-page][data-we-thinking-glass] [data-chat-flow] [data-chat-flow-kind="context"] [data-context-injection-body],
  body[data-we-glass-page][data-we-thinking-glass] [data-chat-flow] [data-slot="tool.call.toolview"]:has([data-sample="bash"]) [data-terminal],
  body[data-we-glass-page][data-we-thinking-glass] [data-chat-flow] [data-slot="tool.call.toolview"] [data-tool="read"] [data-read],
  body[data-we-glass-page][data-we-thinking-glass] [data-chat-flow] [data-slot="tool.call.toolview"] [data-tool="grep"] [data-search="matches"],
  body[data-we-glass-page][data-we-thinking-glass] [data-chat-flow] [data-slot="tool.call.toolview"] [data-variant="others"] [class*="_ioCard"],
  body[data-we-glass-page][data-we-thinking-glass] [data-chat-flow] [data-slot="tool.call.toolview"] [data-tool="glob"] [data-search="paths"],
  body[data-we-glass-page][data-we-thinking-glass] [data-chat-flow] [data-slot="tool.call.toolview"] [data-tool="write"] [data-diff] {
    --dsw-alias-markdown-code-block: transparent;
    --dsw-alias-markdown-code-block-banner: transparent;
    --dsl-code-block-background: transparent;
    background-color: var(--we-tool-glass-fill) !important;
    background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.05) 38%, rgba(255, 255, 255, 0.02));
    -webkit-backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
    backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
  }
  body[data-we-glass-fallback][data-we-glass-page][data-we-thinking-glass] [data-chat-flow] [data-chat-flow-kind="context"] [data-context-injection-body],
  body[data-we-glass-fallback][data-we-glass-page][data-we-thinking-glass] [data-chat-flow] [data-slot="tool.call.toolview"]:has([data-sample="bash"]) [data-terminal],
  body[data-we-glass-fallback][data-we-glass-page][data-we-thinking-glass] [data-chat-flow] [data-slot="tool.call.toolview"] [data-tool="read"] [data-read],
  body[data-we-glass-fallback][data-we-glass-page][data-we-thinking-glass] [data-chat-flow] [data-slot="tool.call.toolview"] [data-tool="grep"] [data-search="matches"],
  body[data-we-glass-fallback][data-we-glass-page][data-we-thinking-glass] [data-chat-flow] [data-slot="tool.call.toolview"] [data-variant="others"] [class*="_ioCard"],
  body[data-we-glass-fallback][data-we-glass-page][data-we-thinking-glass] [data-chat-flow] [data-slot="tool.call.toolview"] [data-tool="glob"] [data-search="paths"],
  body[data-we-glass-fallback][data-we-glass-page][data-we-thinking-glass] [data-chat-flow] [data-slot="tool.call.toolview"] [data-tool="write"] [data-diff] {
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
  }

  /* Navbar history/message tips share one portal; native turn previews have
     their own root. Both reuse the tool plate without frosting child text. */
  body[data-we-glass-page][data-we-thinking-glass] > [data-vlln-preview],
  body[data-we-glass-page][data-we-thinking-glass] [data-slot="conversation.view"] [class*="_preview"]:has(> [class*="_previewPrompt"]) {
    background: var(--we-tool-glass-fill) !important;
    background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.05) 38%, rgba(255, 255, 255, 0.02)) !important;
    -webkit-backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
    backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
  }
  body[data-we-glass-fallback][data-we-glass-page][data-we-thinking-glass] > [data-vlln-preview],
  body[data-we-glass-fallback][data-we-glass-page][data-we-thinking-glass] [data-slot="conversation.view"] [class*="_preview"]:has(> [class*="_previewPrompt"]) {
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
  }
  /* Chromium's native scrollbar does not paint backdrop blur (stripe probe).
     Tint only this thumb, avoiding inherited tokens on nested scroll areas. */
  body[data-we-glass-page][data-we-thinking-glass] [data-conversation-scroll]::-webkit-scrollbar-thumb {
    background-color: rgba(var(--we-capsule-tint-rgb, 255, 255, 255), var(--we-inline-code-alpha, 0.10));
  }
  body[data-we-glass-page][data-we-thinking-glass] [data-conversation-scroll]::-webkit-scrollbar-thumb:hover,
  body[data-we-glass-page][data-we-thinking-glass] [data-conversation-scroll]::-webkit-scrollbar-thumb:active {
    background-color: rgba(255, 255, 255, calc(var(--we-inline-code-alpha, 0.10) + 0.04));
  }

  /* Native fences include assistant markdown, not just user bubbles. Keep
     Shiki token foregrounds and clear all host background painting nodes. */
  body[data-we-glass-page][data-we-thinking-glass] [data-chat-flow] .md-code-block {
    --dsl-code-block-background: transparent;
    --dsl-code-block-banner-background-color: transparent;
  }
  body[data-we-glass-page][data-we-thinking-glass] [data-chat-flow] .md-code-block > :has(> [data-code-block-banner]),
  body[data-we-glass-page][data-we-thinking-glass] [data-chat-flow] .md-code-block [data-code-block-banner],
  body[data-we-glass-page][data-we-thinking-glass] [data-chat-flow] .md-code-block pre,
  body[data-we-glass-page][data-we-thinking-glass] [data-chat-flow] .md-code-block pre > code {
    background: transparent !important;
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
  }
  /* ── 吸顶条（宿主 .bannerWrap）重铺底板（#156④）──────────────────────────────
     宿主 CodeBlock.module.css 里真正的 sticky 载体是 .bannerWrap
     （position: sticky; top: 0; z-index: 6），它的底板写成
     background-color: var(--dsw-alias-bg-base)；本插件把 --dsw-alias-bg-base 置成
     transparent（好让壁纸透出来），上面那条清底规则又给同一个载体写了
     background: transparent !important ⇒ 代码块一滚动，吸顶的 header / 复制按钮
     就直接压在正文上，连一块板都没有（症状④）。
     修法：在清底规则**之后**再声明一次 background-color + 霜（同特异度、同为
     !important、后写胜），配方与工具面同族、同样压可读性下限；几何（sticky/top/
     z-index/圆角）全部归宿主，一个字不改。
     ⚠️ 只重铺 sticky 载体，不动 .banner 内部的 --dsl-code-block-banner-background-color
     （那条仍是 transparent）：板只有一层，正文里不出现第二条吸顶带。
     判据锚点仍是 [data-code-block-banner]（宿主源码写死的属性，已在登记册
     「会话流面」那一行里认领），作用域留在 [data-chat-flow] 内。 */
  body[data-we-glass-page][data-we-thinking-glass] [data-chat-flow] .md-code-block > :has(> [data-code-block-banner]) {
    background-color: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-light, #ffffff) calc(var(--we-glass-alpha, 0.15) * 0.6 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%)) !important;
    -webkit-backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01) !important;
    backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01) !important;
  }
  body[data-ds-dark-theme][data-we-glass-page][data-we-thinking-glass] [data-chat-flow] .md-code-block > :has(> [data-code-block-banner]) {
    background-color: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) calc(var(--we-glass-alpha, 0.15) * 0.6 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%)) !important;
  }
  /* 无模糊内核：同一条「近不透明 + 摘霜」政策也要落到这条吸顶带上。 */
  body[data-we-glass-fallback][data-we-glass-page][data-we-thinking-glass] [data-chat-flow] .md-code-block > :has(> [data-code-block-banner]) {
    background-color: color-mix(in srgb, var(--we-readability-base) 92%, transparent) !important;
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
  }
  /* A user bubble already supplies the single glass plate and frost. */
  body[data-we-glass-page][data-we-thinking-glass] [data-chat-flow] [class*="_bubble"]:not([role="tooltip"]) .md-code-block {
    background: transparent !important;
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
  }
  /* VCP uses inline fixed colours; its plain text follows the theme once its
     opaque canvas is removed. Native Shiki foregrounds above stay untouched. */
  body[data-we-glass-page][data-we-thinking-glass] [data-vcp-rawhtml] > div > div:has(> pre > code):has(> div > button[title="复制代码"]) > pre {
    background: transparent !important;
    color: var(--dsw-alias-label-primary) !important;
  }
  body[data-we-glass-page][data-we-thinking-glass] [data-vcp-rawhtml] > div > div:has(> pre > code):has(> div > button[title="复制代码"]) > div {
    background: transparent !important;
    color: var(--dsw-alias-label-secondary) !important;
  }
  body[data-we-glass-page][data-we-thinking-glass] [data-vcp-rawhtml] > div > div:has(> pre > code):has(> div > button[title="复制代码"]) > div > button {
    color: inherit !important;
  }
  body[data-we-glass-page][data-we-thinking-glass] [data-changed-files] {
    --changes-fill: transparent;
    --changes-hover: rgba(255, 255, 255, 0.05);
  }
  body[data-we-glass-page][data-we-thinking-glass] [data-changed-files] > button {
    background: transparent !important;
  }

  /* ── 正文原生挡（「思考块液态玻璃」三挡之三：thinkingNative，默认关）────────────
     用户口径：**只有正文内容**（消息气泡 / 代码块与行内代码 / 标签 / 分段 / 引用等
     markdown 家族）恢复 DSH 原生不透明实色；**输入框与对话画布保留玻璃**（输入卡吃
     --dsw-specific-input-major 与霜釉照旧、画布 bg-base 照旧透明透壁纸）。作用域因此收成
     **正文子树**：锚点 [data-chat-flow]（消息流，气泡 / markdown / 工具结果都在其内）与
     [data-vcp-rawhtml]（VCP 直出块，可与 chat-flow 平级）—— 输入区的
     --dsw-specific-input-major、画布的 bg-base、霜/釉元素规则**全部不碰**（把整列都钉回原生
     会让 composerSeat 的渐变底衬拿到原生值、屏上出现"输入区一条黑楔"）。:not() 豁免只保留在
     气泡那条上（见上面那组）。
     原生值全部是宿主 --dsw-static-* 静态调色板的 var 引用（从
     @deepseek-ai/dsh-client-ui-theme 的 design-platform 串逐条提取，浅/深两主题
     各一套）；字面量兜底防宿主改令牌名 —— 缺了它令牌无值会退成透明，正好是
     原生挡的反面。
     ⚠️ 门控属性由 glass-layer.js 写/撤（thinkingNative，赢过 thinkingGlass 的互斥见那边）；
     皮肤让路态整族摘门控时随 glass-layer.js 同批摘除。 */
  body[data-we-thinking-native] [data-chat-flow],
  body[data-we-thinking-native] [data-vcp-rawhtml] {
    --dsw-specific-bubble: var(--dsw-static-deepseek-50, #edf3fe);
    --dsw-alias-markdown-code-block: var(--dsw-static-neutral-bluish-50, #f9fafb);
    --dsw-alias-markdown-code-block-banner: var(--dsw-static-neutral-bluish-50, #f9fafb);
    --dsw-alias-markdown-inline-code: var(--dsw-static-neutral-50, #fafafa);
    --dsw-alias-markdown-tag: var(--dsw-static-neutral-bluish-75, #f1f3f5);
    --dsw-alias-markdown-code-segment-unselected: var(--dsw-static-neutral-bluish-75, #f1f3f5);
    --dsw-alias-markdown-code-segment-selected: var(--dsw-static-neutral-bluish-00, #fff);
    --dsw-alias-markdown-citation: var(--dsw-static-neutral-bluish-100, #ebeef2);
    --dsw-alias-markdown-placeholder: var(--dsw-static-neutral-bluish-60, #f5f6f7);
  }
  /* 深色档同形（原生值取宿主深色主题那一套；多一层属性选择器顶掉浅色定义，
     与文件里其余「深色孪生」同一做法）。 */
  body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow],
  body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml] {
    --dsw-specific-bubble: var(--dsw-static-neutral-bluish-850, #2c2c2e);
    --dsw-alias-markdown-code-block: var(--dsw-static-neutral-bluish-900, #1b1b1c);
    --dsw-alias-markdown-code-block-banner: var(--dsw-static-neutral-bluish-850, #2c2c2e);
    --dsw-alias-markdown-inline-code: var(--dsw-static-neutral-800, #292929);
    --dsw-alias-markdown-tag: var(--dsw-static-neutral-bluish-850, #2c2c2e);
    --dsw-alias-markdown-code-segment-unselected: var(--dsw-static-neutral-bluish-900, #1b1b1c);
    --dsw-alias-markdown-code-segment-selected: var(--dsw-static-neutral-bluish-800, #353638);
    --dsw-alias-markdown-citation: var(--dsw-static-neutral-bluish-800, #353638);
    --dsw-alias-markdown-placeholder: var(--dsw-static-neutral-bluish-850, #2c2c2e);
  }
  /* ── 左侧栏液态玻璃（宿主原生左栏的玻璃接管，默认关）────────────────────────────
     原生左栏（会话列表 / 工作区那一列）在壁纸下只是**透明的洞**（本插件把
     --dsw-specific-sidebar-fill 置为 transparent），没有霜、没有底色 —— 主题那套
     「配色 / 玻璃颜色 / 玻璃透明度 / 雾化 / 边框」一个都到不了它。开关
     （body[data-we-left-sidebar]，设置键 leftSidebarGlass，默认关）给它挂上**与其余面板
     同一张配方表**：玻璃颜色（钳制后可读性底色）@ 玻璃透明度 压在可读性下限之上 +
     雾化（--we-blur）+ 边框（竖分割线）+ 配色（选中 / 悬停行、徽标、焦点环的高亮映射）。
     ⚠️ 门控是「页面玻璃锚点 + 本开关」两个：配方与有没有壁纸无关（无壁纸时这一列压着的
     是宿主自己的基色，同一张配方表照旧算出可读底色），壁纸在场只是让它重新"透出画面"。

     锚点：这一列**只有 CSS 模块哈希类名**（构建哈希，跨版本漂移，不得使用）。可钉的是
     **座位锚**：slot 渲染器给每个出口盖章 data-slot="<slotKey>"，左栏那个座位的出口
     div[data-slot="sidebar"] 正是这一列的**直接子元素** ⇒ 用 :has() 反向选中父元素。
     ⚠️ 不能把玻璃画在出口锚自己身上：它带 display:contents（座位渲染器的 ANCHOR_STYLE），
     **不生成盒子**，背景 / 模糊 / 边框全都画不出来。
     ⚠️ 子选择器（>）是刻意的：写宽一档会连带匹配到"任何祖先链里有该锚点"的元素。

     ── 兼容层：独立装饰载体 ─────────────────────────────────────────────
     旧版为负层伪元素给宿主列增加定位和 z-index:0，虽避开 fixed 包含块，仍会把
     第三方模态困在侧栏层叠上下文。现在只有管理器验证区域后才接管底色；模糊移到
     根级装饰叶节点，宿主列不新增定位、层叠或包含块。不安全区域不盖运行标记，保留原生。 */
  body[data-we-glass-page][data-we-left-sidebar] div:has(> [data-slot="sidebar"]):where([data-we-surface-runtime="left-sidebar"]) {
    /* 宿主列不再承担定位或层叠；模糊只由根级装饰叶节点承担。 */
    background-color: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-light, #ffffff) calc(var(--we-left-sidebar-alpha) * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    /* 顶层白光釉：与设置窗口同一道镜面渐变。它同时**顶掉**壳层 darwin 那条
       「淡蓝渐变 + fill 混色」的左栏背景（background-image 是同一长属性）。 */
    background-image: linear-gradient(180deg,
      rgba(255, 255, 255, var(--we-panel-sheen-a)) 0%,
      rgba(255, 255, 255, var(--we-panel-sheen-b)) 38%,
      rgba(255, 255, 255, var(--we-panel-sheen-c)) 100%);
    /* 模糊由根级装饰叶节点承担，不改变这一列的 fixed 包含块。 */
    /* 边框：这一列**内部**的描边（「新建会话」按钮、焦点环等）读 --dsw-alias-border-l3 ——
       #255④ 起壁纸令牌映射也接管 l1–l4（见上面两块映射），这里仍就地重声明 l3：让本列内的
       描边与「边框」滑杆同源、不依赖 body 上那块映射的级联位置（这一条**保留**）。
       ⚠️ 这一列**自己的竖分割线不画**（现场口径："左侧边栏右边框线不要显示，即使全局设置了
       边框拉到了90%"）：这一列已经是一整块玻璃，再画一条竖线就把它与会话区切成两半。
       ⚠️ 必须是**显式 none**，不能只是删掉那行声明：非 darwin 壳层自己有一条读
       --dsw-alias-border-l3 的边框，删声明会让它在别的平台上回来。判据见
       verify-glass-compositing 的 S2（含"种回发丝线即判红"的负对照）。 */
    --dsw-alias-border-l3: rgba(180, 180, 180, var(--we-border-alpha, 0.35));
    border-right: none;
    /* 配色：与设置窗口同一组 accent 映射（选中 / 悬停行 = interactive-bg-hover，
       业务状态点 = state-business-primary，链接与强调文字 = brand-*），
       作用域只在这一列 —— 自定义属性沿 DOM 继承，出不去这一列的子树。 */
    --dsw-alias-interactive-bg-hover: color-mix(in srgb, var(--we-accent, #4f8cff) 14%, transparent);
    --dsw-alias-interactive-bg-hover-accent: color-mix(in srgb, var(--we-accent, #4f8cff) 18%, transparent);
    --dsw-alias-state-business-primary: var(--we-accent, #4f8cff);
    --dsw-alias-brand-primary: var(--we-accent, #4f8cff);
    --dsw-alias-brand-text: var(--we-accent, #4f8cff);
  }
  /* 根级容器只含本插件的装饰叶节点，永远位于内容下方，不包裹宿主组件。 */
  [data-we-surface-root] {
    position: fixed;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    -webkit-app-region: initial !important;
  }
  [data-we-surface-plate] {
    position: absolute;
    pointer-events: none;
  }
  body[data-we-glass-page][data-we-left-sidebar] [data-we-surface-plate="left-sidebar"] {
    -webkit-backdrop-filter: blur(var(--we-left-sidebar-blur)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
    backdrop-filter: blur(var(--we-left-sidebar-blur)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
  }
  body[data-we-glass-page][data-we-sidebar-glass] [data-we-surface-plate="right-sidebar"] {
    -webkit-backdrop-filter: blur(var(--we-sidebar-blur)) saturate(var(--we-sidebar-saturate)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
    backdrop-filter: blur(var(--we-sidebar-blur)) saturate(var(--we-sidebar-saturate)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
  }
  /* 深色：同一张表、同一组层权重，只有玻璃色缺省与高亮mix 不同（与设置窗口深色那条同形）。 */
  body[data-ds-dark-theme][data-we-glass-page][data-we-left-sidebar] div:has(> [data-slot="sidebar"]):where([data-we-surface-runtime="left-sidebar"]) {
    background-color: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) calc(var(--we-left-sidebar-alpha) * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    background-image: linear-gradient(180deg,
      rgba(255, 255, 255, var(--we-panel-sheen-a)) 0%,
      rgba(255, 255, 255, var(--we-panel-sheen-b)) 38%,
      rgba(255, 255, 255, var(--we-panel-sheen-c)) 100%);
    --dsw-alias-interactive-bg-hover: color-mix(in srgb, var(--we-accent, #4f8cff) 14%, rgba(255, 255, 255, 0.04));
  }
  /* 无 backdrop-filter：同一政策 —— 近不透明玻璃，文字绝不直接落在壁纸上
     （模糊被关掉后，半透明 + 无霜等于把左侧栏文字放到花壁纸上）。 */
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    body[data-we-glass-page][data-we-left-sidebar] div:has(> [data-slot="sidebar"]):where([data-we-surface-runtime="left-sidebar"]) {
      background-color: color-mix(in srgb, var(--we-surface-tint-light, #ffffff) 92%, transparent);
      background-image: none;
    }
    body[data-ds-dark-theme][data-we-glass-page][data-we-left-sidebar] div:has(> [data-slot="sidebar"]):where([data-we-surface-runtime="left-sidebar"]) {
      background-color: color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) 92%, transparent);
    }
  }
  /* ── issue #272：窄视口（手机远程适配层 / 折叠抽屉）下的不依赖模糊的兜底 ─────────
     宿主在 <1100px 把侧栏折叠成抽屉、用 transform 做位移；此时装饰板的 backdrop-filter
     要么采样不到有效矩形、要么被祖先的 transform/filter 静默废掉 ⇒ 抽屉全透明、正文直接
     压在壁纸上。这里按「#95：文字绝不直接落在壁纸上」的同一政策给近不透明底（92%），
     并把不会生效的模糊显式关掉 —— 与软件光栅回退那组逐字同口径。
     ⚠️ 只影响窄视口；桌面布局（≥1100px）逐字节不变。 */
  @media (max-width: 1100px) {
    body[data-we-glass-page][data-we-left-sidebar] div:has(> [data-slot="sidebar"]):where([data-we-surface-runtime="left-sidebar"]) {
      background-color: color-mix(in srgb, var(--we-surface-tint-light, #ffffff) 92%, transparent) !important;
      background-image: none !important;
    }
    body[data-ds-dark-theme][data-we-glass-page][data-we-left-sidebar] div:has(> [data-slot="sidebar"]):where([data-we-surface-runtime="left-sidebar"]) {
      background-color: color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) 92%, transparent) !important;
    }
    body[data-we-glass-page] [data-we-surface-plate] {
      -webkit-backdrop-filter: none !important;
      backdrop-filter: none !important;
    }
  }

  /* ── 侧边栏四角圆角 / 直角（外观 → 侧边栏圆角）────────────────────────────────────
     左右两条侧栏各自一套：**统一档**（6 / 12 / 20 px）写 border-radius 简写，四角开关
     写 border-*-radius 长属性覆盖它。设置真源见 lib/settings-schema.js 的
     leftSidebarCornerRadius / rightSidebarCornerRadius 与两族 Square* 键；属性由
     glass.js 的 applyGlass 写出。

     ⚠️ **顺序即语义**：简写会一次性设置四个角 ⇒ 四角规则必须排在简写规则**之后**，
        否则被简写覆盖（dsh-myskin 的同款教训，见其 regions.ts 的 hoistShorthand）。
     ⚠️ 左栏锚点与「左侧栏液态玻璃」同一条：座位出口 div[data-slot="sidebar"] 带
        display:contents、**不生成盒子**，背景 / 圆角都画不出来 ⇒ 只能 :has() 反向选父元素。
     ⚠️ 右栏锚点**必须**带 [data-sidebar-right-open]：容器收起时仍挂在布局里（只把子元素
        visibility:hidden），裸锚会给收起态留一块板子（#107，与右栏玻璃同一条护栏）。
     ⚠️ 默认（统一档 = 跟随原生、四角都不直角）时 body 上没有任何属性 ⇒ 本块全部不生效，
        逐字节等于今天。
     ⚠️ 宿主原生左栏与右栏面板都**不带圆角**（*_sidebarCol 只有底色 + 右分割线；
        右栏面板的圆角长在内部 pane 上）⇒「圆角」靠统一档给 px 值才看得见。 */
  body[data-we-left-sidebar-radius] div:has(> [data-slot="sidebar"]) {
    border-radius: var(--we-left-sidebar-radius) !important;
  }
  body[data-we-left-sidebar-square~="tl"] div:has(> [data-slot="sidebar"]) { border-top-left-radius: 0 !important; }
  body[data-we-left-sidebar-square~="tr"] div:has(> [data-slot="sidebar"]) { border-top-right-radius: 0 !important; }
  body[data-we-left-sidebar-square~="br"] div:has(> [data-slot="sidebar"]) { border-bottom-right-radius: 0 !important; }
  body[data-we-left-sidebar-square~="bl"] div:has(> [data-slot="sidebar"]) { border-bottom-left-radius: 0 !important; }
  body[data-we-right-sidebar-radius] [data-sidebar-right-panel][data-sidebar-right-open] {
    border-radius: var(--we-right-sidebar-radius) !important;
  }
  body[data-we-right-sidebar-square~="tl"] [data-sidebar-right-panel][data-sidebar-right-open] { border-top-left-radius: 0 !important; }
  body[data-we-right-sidebar-square~="tr"] [data-sidebar-right-panel][data-sidebar-right-open] { border-top-right-radius: 0 !important; }
  body[data-we-right-sidebar-square~="br"] [data-sidebar-right-panel][data-sidebar-right-open] { border-bottom-right-radius: 0 !important; }
  body[data-we-right-sidebar-square~="bl"] [data-sidebar-right-panel][data-sidebar-right-open] { border-bottom-left-radius: 0 !important; }
  /* 圆角一开，右栏左边缘那条**竖直分割线**（dockkit 拖拽手柄的 ::before：0.5px 宽、
     top:0/bottom:0 全高）就成了"圆角旁边的一道直角"（用户实测截图）。修法 = 让它跟着
     圆角缩进：上面那个角是圆的 ⇒ 线从半径处开始；下面那个角是圆的 ⇒ 线到半径处结束；
     对应的角标了直角 ⇒ 那条边不动（线照旧顶到边）。
     ⚠️ **不再要求它住在面板里**（第一版按"面板内"限定，用户第二轮实测那条线仍在 ⇒ 它可能挂在
        面板的兄弟节点上）；仍然排除 pane 内部的 split 分割线（那是别的布局，缩进它会画错）。
     ⚠️ 手柄本体（可拖拽的命中区）不动，只是那条线变短 —— 拖拽能力一点没少。
     ⚠️ 兜底：--we-right-sidebar-radius 与门控属性由 glass.js 同批写出（零兜底读取）。 */
  body[data-we-right-sidebar-radius]:not([data-we-right-sidebar-square~="tl"]) [data-dockkit-divider]:not([data-dockkit-pane] *)::before {
    top: var(--we-right-sidebar-radius) !important;
  }
  body[data-we-right-sidebar-radius]:not([data-we-right-sidebar-square~="bl"]) [data-dockkit-divider]:not([data-dockkit-pane] *)::before {
    bottom: var(--we-right-sidebar-radius) !important;
  }
  /* 宿主第二处画同一条线的地方：**第一列 dock 的 tab host 上的 border-left**（0.5px、
     颜色同 --dsw-alias-border-l4，见前端包 _tabCell_[data-dockkit-host=dock][data-dockkit-column="0"]
     > ._tabHost_ 那条规则）。它画在那个元素**自己**的边上，不跟着面板的圆角走 ⇒ 圆角一开就是
     一道直角。锚点用"第一列 dock 的直接子元素"这个**结构事实**：宿主给它的是 CSS-module 哈希
     类名，不能当锚点（跨构建会漂）。 */
  body[data-we-right-sidebar-radius] [data-sidebar-right-panel][data-sidebar-right-open] [data-dockkit-host="dock"][data-dockkit-column="0"] > * {
    border-left: none !important;
  }

  /* ── 标题栏液态玻璃（壳层顶栏的玻璃接管，默认关）────────────────────────────────
     开关（body[data-we-titlebar-glass]，设置键 titlebarGlass，默认关）把顶栏改挂**与其余
     面板同一张配方表**，且与左侧栏那条**逐条同形**。

     ⚠️ **锚点**：Windows 形态的顶栏不是元素，而是 AppFrame 那条 grid 容器的**伪元素**
        （content 空、height = --dsh-windows-titlebar-height、app-region: drag、
        background = --dsw-specific-sidebar-fill）—— 它是顶栏唯一的那一层，也是"文字下方
        那块底"的全部来源 ⇒ 玻璃必须画在**这个伪元素**上，直接替换它的 background。
        壳层类名 .dshDesktopFrameTitlebar / .dshDesktopFrame / --dsh-desktop-frame-fill
        在当前 DSH Desktop 里**都不存在**（app.asar 字面扫描命中 0 次），不得用作锚点。
     ⚠️ **锚点为什么不用 [data-sidebar-collapsed]**：AppFrame 只在**收起**时才渲染该属性
        ⇒ 把条件属性写进选择器会让本块在默认展开态**恒不生效**。data-rightbar-* 同理。
     ⚠️ **锚点只用一条**：运行时锚点 [data-we-titlebar-anchor] 由玻璃层探针写在顶栏容器上
        （glass-layer.js 的 findTitlebarFrame：座位祖先链 → 含侧栏/对话列兜底 → ≥70% 视口的
        单类 *_frame 兜底），不看宿主构建哈希 ⇒ 宿主换构建也不会静默失效；运行时实测
        n1=1 / n3=1。两条硬门是 [data-windows-titlebar]（壳层写进 <html>，只在 Windows
        Electron 形态；实测 winTB=1）与 body[data-we-adapter^="desktop-"]（本插件自己挂；
        实测 ad=desktop-official）。教训两条：
        ⇒ 结论一：**绝不把"未经本引擎验证的选择器"与"已验证的"放进同一个逗号列表** —— CSS
          选择器列表一损俱损（一个不被接受，整条规则连同能命中的一起被丢弃，表现为"变量全对、
          背景与模糊都没算出来"，与"锚点没选对"的现象完全一样，极易误判）；要并存必须拆成
          两条独立规则（一条失效只丢它自己）。
        ⇒ 结论二：**嵌套 :has()**（:has() 里再套 :has()）本壳层的 Chromium 不接受（会抛异常）；
          左栏那条能用是因为它是**单层** :has(> [data-slot="sidebar"]) —— 别把左栏的经验外推。
        探针失效的兜底将来若要加，必须**另起一条规则**，不得并进逗号列表。
     ⚠️ **本块的结构分工**：底色 / 釉光 / accent 在下面这条 ::before；模糊在紧随其后的
        ::after —— 为什么必须分两层、绘制顺序、以及 issue #131 的 fixed 包含块，见那条规则的注释。
     ⚠️ **"不要有任何色差"是本块的第一约束**：底色的 color-mix 权重与五条 accent 映射与左侧栏
        **逐字相同**（判据 TB4）。釉光**刻意不同**（判据 TB4a）—— 停靠点是百分比，装进两个高度差
        27.8 倍的盒子会算出不同值，见 ::before 那条注释。两面都**不画分割线**（本面判据 TB6，
        左栏判据 S2）。⚠️ 任何调色改动都必须**同时**改这两块，否则色差立刻出现。
     ⚠️ **可覆盖性**：本块用 !important —— 壳层那条 :before 声明同特异度但写在别的样式表里，
        靠加载顺序取胜不可靠；伪元素只此一层，覆盖它没有副作用。 */
  html[data-windows-titlebar] body[data-we-glass-page][data-we-titlebar-glass][data-we-adapter^="desktop-"] [data-we-titlebar-anchor]::before {
    /* 底色：压掉壳层那条 background: var(--dsw-specific-sidebar-fill)，换成与左侧栏
       **逐条同形**的配方（只有面变量 --we-titlebar-alpha 替 --we-left-sidebar-alpha）。
       ⚠️ 必须写成 background-color + background-image 两条**分开的**声明（不是
       background 简写）——简写会把同名的 background-* 长属性一次性重置，而本块与
       左侧栏的"逐条同形"判据（verify-glass-compositing）正是按声明对声明比对的。 */
    background-color: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-light, #ffffff) calc(var(--we-titlebar-alpha) * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%)) !important;
    /* 顶层白光釉 —— **必须是恒定值，不能沿用左栏那条三段渐变**（实测）：
       渐变的停靠点是**百分比**（0% / 38% / 100%），同一条声明装进两个高度差 27.8 倍的
       盒子里会算出**完全不同**的白釉强度 ——
         · 标题栏 ::before 高 **40px**：0.10 →(15px) 0.03 →(40px) 0.05，整段均值 0.0495；
         · 侧栏列高 **1111.33px**：0.10 →(422px) 0.03，其顶部 40px 均值 0.0967。
       交界处台阶 = 0.10 − 0.05 = **0.05 白釉**，整段差 **0.047** ⇒ 肉眼可见的色差。
       而 TB4 判据比的是**声明文本**（两条逐字相同 ⇒ PASS），完全看不见这个 ——
       因为差异出在**盒子尺寸**上，不在配方上。"声明逐字相同 ⇒ 无色差"对**盒子相对**的
       声明（百分比停靠点）是**不成立**的，这条注释就是那个反例。
       修法：本面只用 sheen-a 一个停靠点（恒定 0.10）。左栏顶部 40px 实际是
       0.10 → 0.0934（只漂 0.0066，远低于感知阈值），所以恒定值与之等效。
       ⚠️ 判据见 verify-glass-compositing 的 TB4a（改回三段渐变会被判红）。 */
    background-image: linear-gradient(180deg,
      rgba(255, 255, 255, var(--we-panel-sheen-a)) 0%,
      rgba(255, 255, 255, var(--we-panel-sheen-a)) 100%) !important;
    /* ⚠️ 模糊**不在这里**，在紧随其后的 ::after 上（理由见那条规则的注释）。 */
    /* ⚠️ **不画底分割线**（现场口径）：左栏按 S2 判据是**显式 border-right: none**
       （"这一列已经是一整块玻璃，再画一条线就把它切成两半"）—— 同一条政策必须两面一致，
       否则那条线本身就是色差。
       ⚠️ 判据见 verify-glass-compositing 的 TB6（把线种回去会被判红）。 */
    /* 配色：与左栏**同一组** accent 映射（已由上方 CSS-ENGINE 判据验证逐条 SAME）。 */
    --dsw-alias-interactive-bg-hover: color-mix(in srgb, var(--we-accent, #4f8cff) 14%, transparent);
    --dsw-alias-interactive-bg-hover-accent: color-mix(in srgb, var(--we-accent, #4f8cff) 18%, transparent);
    --dsw-alias-state-business-primary: var(--we-accent, #4f8cff);
    --dsw-alias-brand-primary: var(--we-accent, #4f8cff);
    --dsw-alias-brand-text: var(--we-accent, #4f8cff);
  }
  /* ── 标题栏的**模糊层**：另起一个 ::after ─────────────────────────────────────
     为什么必须是两个伪元素：左栏是「底色在**元素**、模糊在其 ::before（绘制在底色**之上**）」
     ⇒ 结果 = F(壁纸 ⊕ 底色)，底色**经过** saturate(1.8) / brightness(1.04) 滤镜；若把底色
     与模糊写在**同一个** ::before 上 ⇒ 结果 = 底色 ⊕ F(壁纸)，底色**不经过**滤镜 ⇒ 两面在
     数值完全相同的情况下仍出色差。修法：底色留在壳层的 ::before（上一条规则），模糊另起
     ::after（::before 先、::after 后绘制 ⇒ ::after 的 backdrop 恰好**含** ::before 的底色，
     与左栏逐像素同构）。
     ⚠️ 几何必须与壳层那条 ::before 完全一致（inset:0 0 auto + 标题栏高度），否则两层错位露边。
     ⚠️ ::after 没有后代 ⇒ 永不成为 position:fixed 的包含块（issue #131 同一理由）；
        pointer-events:none ⇒ 不挡壳层 ::before 的 app-region 拖拽区，也不挡壳层 z-index:30 的固定按钮。
     ⚠️ 不写 z-index（保持 auto）：这样才能在 ::before **之上**按树序绘制；写成 -1 会掉到
        frame 底色之下，甚至跑到壁纸后面。 */
  html[data-windows-titlebar] body[data-we-glass-page][data-we-titlebar-glass][data-we-adapter^="desktop-"] [data-we-titlebar-anchor]::after {
    content: "";
    position: absolute;
    inset: 0 0 auto;
    height: var(--dsh-windows-titlebar-height, 40px);
    pointer-events: none;
    -webkit-backdrop-filter: blur(var(--we-titlebar-blur)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01) !important;
    backdrop-filter: blur(var(--we-titlebar-blur)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01) !important;
  }
  /* 深色：同一张表、同一组层权重，只有玻璃色缺省与高亮 mix 不同（与左栏深色那条同形）。
     ⚠️ 釉光必须**和浅色那条一样恒定**（单停靠点 sheen-a）：照抄左栏三段渐变就会重现
        那个"盒尺寸色差" —— 40px 与 1111px 两个盒子会算出不同白釉强度。
        TB4a 对深浅两条都跑。 */
  html[data-windows-titlebar] body[data-ds-dark-theme][data-we-glass-page][data-we-titlebar-glass][data-we-adapter^="desktop-"] [data-we-titlebar-anchor]::before {
    background-color: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) calc(var(--we-titlebar-alpha) * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%)) !important;
    background-image: linear-gradient(180deg,
      rgba(255, 255, 255, var(--we-panel-sheen-a)) 0%,
      rgba(255, 255, 255, var(--we-panel-sheen-a)) 100%) !important;
    --dsw-alias-interactive-bg-hover: color-mix(in srgb, var(--we-accent, #4f8cff) 14%, rgba(255, 255, 255, 0.04));
  }
  /* 无 backdrop-filter：同一政策 —— 近不透明玻璃，顶栏文字绝不直接落在壁纸上。 */
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    html[data-windows-titlebar] body[data-we-glass-page][data-we-titlebar-glass][data-we-adapter^="desktop-"] [data-we-titlebar-anchor]::before {
      background: color-mix(in srgb, var(--we-surface-tint-light, #ffffff) 92%, transparent) !important;
    }
    html[data-windows-titlebar] body[data-ds-dark-theme][data-we-glass-page][data-we-titlebar-glass][data-we-adapter^="desktop-"] [data-we-titlebar-anchor]::before {
      background: color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) 92%, transparent) !important;
    }
    /* 模糊层整个不存在：本档不支持 backdrop-filter，留着 ::after 只会多一层
       什么都画不出来的绝对定位块（含 pointer-events:none 的空层）。 */
    html[data-windows-titlebar] body[data-we-glass-page][data-we-titlebar-glass][data-we-adapter^="desktop-"] [data-we-titlebar-anchor]::after {
      content: none;
    }
  }
  /* 侧栏的釉取哪一份：跟随全局 ⇒ 与左栏同一道（--we-panel-sheen-*）；
     自定义 ⇒ "随透明度衰减"曲线（--we-sidebar-sheen）。两档都只定义变量，
     面板规则本身不必分叉。 */
  body[data-we-sidebar-follow] {
    --we-sidebar-sheen-a: var(--we-panel-sheen-a);
    --we-sidebar-sheen-b: var(--we-panel-sheen-b);
    --we-sidebar-sheen-c: var(--we-panel-sheen-c);
  }
  body[data-we-sidebar-glass]:not([data-we-sidebar-follow]) {
    --we-sidebar-sheen-a: calc(var(--we-sidebar-sheen) * 0.14);
    --we-sidebar-sheen-b: calc(var(--we-sidebar-sheen) * 0.04);
    --we-sidebar-sheen-c: calc(var(--we-sidebar-sheen) * 0.01);
  }

  /* ── dsh-better-sidebar glass ──────────────────────────────────────────────
     The sidebar shell is portalled onto <body> under a stable host attribute
     "data-dsh-better-sidebar" (set by the plugin's own mount code), so we can
     target the whole tree without depending on its CSS-module hashes. Its root
     panels read the opaque --dsw-alias-bg-layer-1 token (hence the "black
     frame") — give them the SAME clear liquid-glass recipe as the
     composer/bubbles (faint specular sheen + gentle frosted melt).
     Unlike the conversation surfaces, the sidebar glass is FULLY independent
     from the active wallpaper: it can tint and frost the stock DSH surface or
     any other background source without pretending a plugin wallpaper exists.
     The master switch body[data-we-sidebar-glass] (侧栏液态玻璃) gates the whole
     adaptation, and blur / saturation / transparency / base tint each have
     their own knob (--we-sidebar-blur / --we-sidebar-saturate /
     --we-sidebar-alpha / --we-sidebar-color, from 侧栏模糊 / 侧栏透明度 /
     侧栏玻璃颜色), so the sidebar can be blurrier, clearer, more transparent
     or tinted however you like without touching the 玻璃 / 玻璃透明度 sliders.
     Inner chrome surfaces that paint the same opaque tokens get a translucent
     base too; the blur lives on the root panels (one blur per shell). */
  /* 未知 better-sidebar 内部布局保留原生，官方停靠区域由统一表面管理识别。 */

  /* ── Official right sidebar ────────────────────────────────────────────────
     The right column lives in the NATIVE sidebar: better-sidebar registers its
     tabs into it and only keeps its own bottom dock. The native panel paints
     background: var(--dsw-alias-bg-base) — the EXACT token WE set to
     transparent while a wallpaper is active — so without adaptation the whole
     right column would be fully see-through with no frost. The panel is
     addressed via its stable data attributes
     (data-sidebar-right-panel="push"|"fullscreen"; CSS-module hashes like
     P3OORG_panel drift between harness builds and must not be used). The
     侧栏液态玻璃 master switch gates the SAME frosted recipe and the SAME
     侧栏模糊/透明度/玻璃颜色 knobs as the better-sidebar glass; with the
     switch off, the panel falls back to the theme's opaque layer colour so
     「关闭则恢复原生外观」keeps holding there too.

     Collapse mechanics (#107): the CONTAINER stays mounted with its full width
     (reserved for the slide animation, pointer-events:none) and only its
     CHILDREN hide via "visibility:hidden", gated on the
     "data-sidebar-right-open" attribute the host writes only while expanded.
     The container itself has no background of its own — so any plate we paint
     on the bare "[data-sidebar-right-panel]" selector stays VISIBLE over the
     wallpaper while the panel is closed (the 「右栏关了还是一块灰/玻璃」
     report). Every container-painting rule below is therefore scoped to
     "[data-sidebar-right-open]", plus an explicit closed-state clear so a
     stale painted background can never linger.
     ⚠️ 同类陷阱：凡是"宿主容器留在布局里、只靠子元素隐藏"的元素都不能无条件上色；
     护栏见 test/verify-host-paint-scope.mjs（另见 #91 的 body * { !important } 修复）。 */
  body[data-we-glass-page] [data-sidebar-right-panel][data-sidebar-right-open] {
    /* 侧栏玻璃总开关关闭时的兜底：面板必须**不透明**（否则文字直接压在壁纸上）。
       --dsw-alias-bg-layer-* 在壁纸下已被改写成玻璃配方 ⇒ 这里读插件自己的面板色。 */
    background-color: var(--we-panel-color, #1e1f26);
  }
  /* #150（dockkit 层级体系）：backdrop-filter 让本面板自成层叠
     上下文（z=auto 档）。宿主的层级设计是「面板内部的 dock 单元消费
     --dsh-dockkit-dock-layer（常态 10 / 右栏全屏 40）」——层叠上下文一成，这个 z
     被困在面板内部，整个面板作为原子跌回 z=auto，被会话列里宿主自己的更高层内容
     （hero 输入卡 z=1 / composerSeat z=7，同为根层叠上下文里的 flex 项）反压：
     push / 收起态没有空间重叠所以看不出来，唯独「右栏全屏」面板与对话列重叠时，
     输入卡与 hero 标题会穿透玻璃面板叠在侧栏上（issue #150 截图形态）。
     修法 = 玻璃开着时把面板本身抬到宿主为它设计的同一层——该 var 就声明在面板上，
     全屏时自动解析为 40，与内部 dock 单元原生取得的层完全一致；玻璃关着（主开关
     兜底只上不透明底色）与软件光栅回退档（backdrop-filter 显式 none）都不成层叠
     上下文，保持原生绘制顺序，无需此抬升。 */
  body[data-we-sidebar-glass] [data-sidebar-right-panel][data-sidebar-right-open]:where([data-we-surface-runtime="right-sidebar"]) {
    background-color: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-sidebar-color) var(--we-sidebar-tint), transparent) calc((1 - var(--we-readability-floor)) * 100%)) !important;
    background-image: linear-gradient(180deg,
      rgba(255, 255, 255, var(--we-sidebar-sheen-a)),
      rgba(255, 255, 255, var(--we-sidebar-sheen-b)) 38%,
      rgba(255, 255, 255, var(--we-sidebar-sheen-c))) !important;
    /* 模糊在独立叶节点，宿主 dock 内容仍按其原生层级绘制。
       #237：外沿描边不画（左栏玻璃也不画）—— 宿主 inset 三明治由
       body[data-we-sidebar-glass] 的 box-shadow:none 规则兜住。 */
  }
  body[data-ds-dark-theme][data-we-sidebar-glass] [data-sidebar-right-panel][data-sidebar-right-open]:where([data-we-surface-runtime="right-sidebar"]) {
    background-color: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-sidebar-color) calc(var(--we-sidebar-tint) * 0.65), transparent) calc((1 - var(--we-readability-floor)) * 100%)) !important;
  }
  /* fullscreen 是宿主明确声明的前景 dock 模式；只抬面板自身，不改共享祖先或第三方节点。 */
  body[data-we-glass-page] [data-sidebar-right-panel="fullscreen"][data-sidebar-right-open]:where([data-we-surface-runtime="right-sidebar"]) {
    z-index: var(--dsh-dockkit-dock-layer, 40);
  }
  /* ── issue #237：右侧栏不画外沿描边（与左栏玻璃同一政策）──────────────────
     旧「去边框」规则门控在圆角档上：圆角=跟随原生时整段不匹配。这里把门控搬到玻璃开关本身：
     只要右栏是玻璃面，就不再留宿主原生描边 / 竖线；关掉玻璃后宿主外观逐字节恢复。
     ⚠️ 面板那条沿用玻璃面自己的运行时锚点（:where([data-we-surface-runtime="right-sidebar"])）——
        没被表面管理认领的面不画玻璃，也就不清描边（保持原生外观）。 */
  body[data-we-sidebar-glass] [data-sidebar-right-panel][data-sidebar-right-open]:where([data-we-surface-runtime="right-sidebar"]) {
    box-shadow: none !important;
  }
  body[data-we-sidebar-glass] [data-dockkit-divider]:not([data-dockkit-pane] *)::before {
    border: none !important;
    background: none !important;
  }
  body[data-we-sidebar-glass] [data-dockkit-host="dock"][data-dockkit-column="0"],
  body[data-we-sidebar-glass] [data-dockkit-host="dock"][data-dockkit-column="0"] > * {
    border-left: none !important;
    box-shadow: none !important;
  }
  /* Closed state: the host's own container carries no background — keep ours
     off too, whatever the master-switch state (#107). */
  body[data-we-glass-page] [data-sidebar-right-panel]:not([data-sidebar-right-open]) {
    background: none !important;
    background-image: none !important;
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
    box-shadow: none !important;
  }
  /* No backdrop-filter support: near-opaque tinted plate, same policy as the
     better-sidebar glass above. */
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    body[data-we-sidebar-glass] [data-sidebar-right-panel][data-sidebar-right-open]:where([data-we-surface-runtime="right-sidebar"]) {
      background-color: color-mix(in srgb, var(--we-sidebar-color) 92%, transparent) !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }
  }

  /* ── dsh-better-sidebar CONTENT surfaces: near-opaque tinted glass ─────────
     The editor (CodeMirror) surface is transparent by design, and the terminal
     background reads --dsw-alias-bg-base — which we must keep transparent so
     the wallpaper shows through. Their fixed content palettes (syntax
     highlighting / ANSI colors) are designed for an OPAQUE backdrop (One
     Dark/Light, xterm themes): on the fully frosted composite the mid-gray
     comments etc. lose all contrast (实测注释灰 1.7–2.3:1，看不清).
     Fully opaque surfaces fix readability but kill the glass look. Balance:
     a NEAR-OPAQUE TINTED glass plate — the theme's opaque panel color
     (--dsw-alias-bg-layer-1) at 88% keeps the wallpaper glow bleeding through
     (still reads as glass) while the composite stays dark/light enough for the
     the designed content palettes. Tune via the 内容面透明度 / 内容面底色 controls
     (--we-content-surface-alpha / --we-content-surface-color; color empty =
     follow the theme panel color). The sidebar master switch gates these
     surfaces too, so turning it off restores the complete native sidebar even
     when a wallpaper remains active. .cm-editor / .xterm are library-global
     class names (stable across the sidebar's builds).
     The editor / preview tabs render inside the NATIVE right sidebar
     ([data-sidebar-right-panel]) — extend the same plate to content surfaces
     there, or 内容面透明度 / 内容面底色 stop responding for those tabs. */
  body[data-we-sidebar-glass] :where([data-we-surface-runtime="content"]) {
    background-color: color-mix(in srgb, var(--we-content-surface-color, var(--we-panel-color, #1e1f26)) max(calc(var(--we-readability-floor) * 100%), var(--we-content-surface-alpha, 88%)), transparent) !important;
  }
  /* 阅读文件页的**兜底底板**（同一张内容面配方）：表面策略系统在"认领失败"时会把
     data-we-surface-runtime 撤掉（preserve / hidden / 多实例不猜），那时这一页就完全
     没有底色 —— 而它是最需要稳定阅读底的一张。这条规则按**锚点**直接给底，
     与上面那条策略规则同配方、同可读性地板 ⇒ 两套都在时观感一致，策略接管时覆盖它。
     ⚠️ 只作用于打开态右栏（与官方右栏那组同一纪律，见上方 #107 的注释）。 */
  body[data-we-sidebar-glass] [data-sidebar-right-panel][data-sidebar-right-open] [data-document-preview] {
    background-color: color-mix(in srgb, var(--we-content-surface-color, var(--we-panel-color, #1e1f26)) max(calc(var(--we-readability-floor) * 100%), var(--we-content-surface-alpha, 88%)), transparent) !important;
  }

  body[data-we-glass-page] [data-we-surface-runtime="declared"]::before {
    content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none; border-radius: inherit;
    background-color: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-panel-color, #fff) calc(var(--we-glass-alpha, .15) * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    -webkit-backdrop-filter: blur(var(--we-blur, 14px));
    backdrop-filter: blur(var(--we-blur, 14px));
  }
  body[data-we-glass-fallback] [data-we-surface-runtime="declared"]::before {
    background: var(--we-panel-color, #fff); -webkit-backdrop-filter: none; backdrop-filter: none;
  }
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    body[data-we-glass-page] [data-we-surface-runtime="declared"]::before { background: var(--we-panel-color, #fff); }
  }

  /* ── WHOLE native settings window → liquid glass.
     Keyed on body[data-we-glass-window] —— 该属性由 applyGlass **恒挂**，**不**对应任何开关
     （「设置窗口液态玻璃」总开关与 glassWindow 键均已删除）；属性本身保留，
     因为它是 CSS 侧"这组规则画玻璃"的**证书**，守卫 ⑨/⑬ 靠它判断）。The settings dialog is the shell's
     div[role="dialog"] containing the settings.section outlet anchor
     (data-slot="settings.section" — stamped by the slot renderer, same anchor
     the skin-center's semantic layer uses). The dialog reads inherited shell
     tokens (panel background = --dsw-alias-bg-layer-2, nav active/hover =
     --dsw-specific-sidebar-nav-item-*, close hover = --dsw-alias-interactive-bg-hover,
     accents = --dsw-alias-brand-primary), so overriding those tokens ON the
     dialog element restyles the ENTIRE window — left nav, content header and
     every native section (General / Models / Plugins / …) — in one shot:
     translucent glass base + backdrop blur + specular sheen + inner highlight,
     with the accent color remapped to --we-accent (配色) and all surface alphas
     driven by --we-glass-alpha (玻璃透明度). Off = stock shell look. ── */
  /* ⚠️ 令牌声明必须在**对话框本体**上，不能只写在 ::before 装饰叶：
     ::before 没有子元素，声明在它上面的变量**没有任何后代能继承** ⇒ 窗内所有读
     --dsw-alias-bg-layer-* 的宿主卡片 / 页签 / 导航全部退回宿主实底（用户口径：
     「这些我用红色矩形框选中的组件玻璃效果又丢失了」）。变量只是继承值，不建立
     层叠上下文、不改盒模型，与 ADR-0015 D2 不冲突。
     会建立包含块/层叠上下文的那几样（backdrop-filter、底色、釉光、阴影）仍然只写在
     下面的 ::before 装饰叶上。 */
  body[data-we-glass-window] [role="dialog"]:has([data-slot="settings.section"]):where([data-we-surface-runtime="settings-window"]) {
    /* Glass surface alphas (light scheme): the base tint is --we-surface-tint-light/dark
       (玻璃颜色) mixed with transparent at the 玻璃透明度-driven alpha, so the
       whole window glass can be tinted to any color. Default (no custom color)
       = white glass, the stock look. 这三层同样是文字面（导航 + 原生分区），
       所以每层都压在可读性下限的主题底色之下。 */
    --dsw-alias-bg-layer-1: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-light, #ffffff) calc(var(--we-settings-window-alpha) * 0.9 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-bg-layer-2: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-light, #ffffff) calc(var(--we-settings-window-alpha) * 1.0 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-bg-layer-3: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-light, #ffffff) calc(var(--we-settings-window-alpha) * 1.1 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    /* Nav + interactive states tinted with the accent. */
    --dsw-specific-sidebar-nav-item-active: color-mix(in srgb, var(--we-accent-src, #4f8cff) 26%, rgba(255, 255, 255, 0.08));
    --dsw-specific-sidebar-nav-item-hover: color-mix(in srgb, var(--we-accent-src, #4f8cff) 13%, rgba(255, 255, 255, 0.05));
    --dsw-alias-interactive-bg-hover: color-mix(in srgb, var(--we-accent-src, #4f8cff) 14%, transparent);
    --dsw-alias-interactive-bg-hover-accent: color-mix(in srgb, var(--we-accent-src, #4f8cff) 18%, transparent);
    /* Whole-dialog accent remap: every native control (links, primary buttons,
       switches, active tabs, slider fills) follows the 配色 control.
       ⚠️ 块内消费一律读 --we-accent-src：本块末尾把 --we-accent 掐成 initial
      （issue #127），同名 var() 在**同一元素**上会解析成 guaranteed-invalid、
      全部塌进兜底蓝 —— src 是 body 上的原件，继承不受掐掉影响。 */
    --dsw-alias-brand-primary: var(--we-accent-src, #4f8cff);
    --dsw-alias-brand-text: var(--we-accent-src, #4f8cff);
    --dsw-alias-button-primary-fill: var(--we-accent-src, #4f8cff);
    --dsw-alias-button-primary-hover: color-mix(in srgb, var(--we-accent-src, #4f8cff) 88%, var(--we-accent-ink, #fff));
    --dsw-alias-button-primary-dimmed: color-mix(in srgb, var(--we-accent-src, #4f8cff) 22%, transparent);
    --dsw-alias-state-business-primary: var(--we-accent-src, #4f8cff);
    /* issue #127（文字与背景同色）：填充一旦变成**任意亮度**的用户配色，宿主的
       主题静态墨（label-primary-foreground：浅色主题 = 白、深色主题 = 近黑）就不再
       保证可读 —— primitives 的 primary 按钮契约是「填充 × 反色墨」成对翻转的。
       这里把墨一并按 accent 亮度重选（effects.js 的 weAccentInk）。
       hover 同理：混白对亮 accent 是把底往墨的反方向推，改为往墨色混。 */
    --dsw-alias-label-primary-foreground: var(--we-accent-ink, #fff);
    /* issue #127 的另一半：第三方 settings 分区若拿 var(--we-accent) 当**文字色**
       （无兜底），落在我们重映射成 accent 的填充上就是逐像素同色（黄底黄字 ——
       实测按钮内部 8250 像素全部是同一个 #FFCF4D）。--we-accent 是本插件的名字
       空间，不该泄漏给窗内第三方分区：在窗内把它掐掉（initial = guaranteed-invalid，
       var() 无兜底时回落继承色 = 它们在原生外观下的颜色）；我们自己的 picker 子树
       由 .we-picker 根重新别名（--we-accent-src），消费面不变。 */
    --we-accent: initial;
  }
  body[data-we-glass-window] [role="dialog"]:has([data-slot="settings.section"]):where([data-we-surface-runtime="settings-window"])::before {
    /* 滤镜 / 底色 / 釉光 / 阴影只属于装饰叶：它们会建立包含块与层叠上下文，
       不能落到窗口本体上（ADR-0015 D2）。 */
    content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none;
    border-radius: inherit;
    background-color: var(--dsw-alias-bg-layer-2);
    /* Frosted finish — the SAME recipe as the conversation surfaces (composer
       card / bubbles): the blur radius comes from the 玻璃 slider (--we-blur
       0–60px), the saturation melt is a flat material constant (--we-saturate,
       see the composer note above) and brightness is pinned — so the settings
       window glass tracks the conversation-bar blur range exactly. Plus a
       specular sheen + inner edge highlight + diffuse shadow (panel rounds at 24px). */
    -webkit-backdrop-filter: blur(var(--we-settings-window-blur)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
    backdrop-filter: blur(var(--we-settings-window-blur)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
    background-image: linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.1) 0%,
      rgba(255, 255, 255, 0.03) 38%,
      rgba(255, 255, 255, 0.05) 100%
    );
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.22),
      inset 0 0 0 1px rgba(255, 255, 255, 0.06),
      0 24px 80px rgba(0, 7, 18, 0.35);
  }
  /* 逐面策略「保留原生」（glassSurfacePolicy['settings-window'] = 'native'）：
     表面管理器不认领这个对话框 ⇒ 上面两条（带 :where 运行标记的）都不匹配。
     但页面级令牌映射仍在 body 上被继承 ⇒ 必须在这里把令牌钉回**不透明面板色**，
     否则「保留原生」会变成"没有霜、但底色仍然半透明"的半成品档。
     用插件自己的主题面板色（--we-panel-color：浅 #fff / 深 #1e1f26），
     与右侧栏主开关关闭时的兜底口径一致。 */
  body[data-we-glass-window] [role="dialog"]:has([data-slot="settings.section"]):not(:where([data-we-surface-runtime="settings-window"])) {
    --dsw-alias-bg-layer-1: var(--we-panel-color, #ffffff);
    --dsw-alias-bg-layer-2: var(--we-panel-color, #ffffff);
    --dsw-alias-bg-layer-3: var(--we-panel-color, #ffffff);
    --dsw-alias-button-elevated-fill: var(--we-panel-color, #ffffff);
  }
  /* Dark scheme: deep translucent base instead of white. The default glass
     color is deep navy; a user-picked 玻璃颜色 overrides it in both themes. */
  /* 深色令牌同样必须在**对话框本体**上（理由见上方浅色那条）：装饰叶上的变量
     没有后代可以继承 ⇒ 窗内卡片会退回宿主深色实底。釉光渐变留在下面的 ::before。 */
  body[data-ds-dark-theme][data-we-glass-window] [role="dialog"]:has([data-slot="settings.section"]):where([data-we-surface-runtime="settings-window"]) {
    /* 设置窗口的整块面板（导航 + 每个原生分区）都承载文字 → 同样过下限。 */
    --dsw-alias-bg-layer-1: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) calc(var(--we-settings-window-alpha) * 0.9 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-bg-layer-2: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) calc(var(--we-settings-window-alpha) * 1.0 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-alias-bg-layer-3: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) calc(var(--we-settings-window-alpha) * 1.1 * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    --dsw-specific-sidebar-nav-item-active: color-mix(in srgb, var(--we-accent-src, #4f8cff) 30%, rgba(255, 255, 255, 0.06));
    --dsw-specific-sidebar-nav-item-hover: color-mix(in srgb, var(--we-accent-src, #4f8cff) 14%, rgba(255, 255, 255, 0.04));
  }
  body[data-ds-dark-theme][data-we-glass-window] [role="dialog"]:has([data-slot="settings.section"]):where([data-we-surface-runtime="settings-window"])::before {
    background-image: linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.07) 0%,
      rgba(255, 255, 255, 0.02) 38%,
      rgba(255, 255, 255, 0.03) 100%
    );
  }
  /* No backdrop-filter support: fall back to near-opaque glass so text stays
     readable (same policy as the skin's patches.css). */
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    /* 回退档的令牌同样写在对话框本体（装饰叶没有继承者）。 */
    body[data-we-glass-window] [role="dialog"]:has([data-slot="settings.section"]):where([data-we-surface-runtime="settings-window"]) {
      --dsw-alias-bg-layer-1: var(--we-surface-tint-light, #ffffff);
      --dsw-alias-bg-layer-2: var(--we-surface-tint-light, #ffffff);
      --dsw-alias-bg-layer-3: var(--we-surface-tint-light, #ffffff);
    }
    body[data-ds-dark-theme][data-we-glass-window] [role="dialog"]:has([data-slot="settings.section"]):where([data-we-surface-runtime="settings-window"]) {
      --dsw-alias-bg-layer-1: var(--we-surface-tint-dark, #0d1524);
      --dsw-alias-bg-layer-2: var(--we-surface-tint-dark, #0d1524);
      --dsw-alias-bg-layer-3: var(--we-surface-tint-dark, #0d1524);
    }
    /* 同一个「无 backdrop-filter ⇒ 近不透明」政策也要覆盖**整窗**那层表面令牌：
       玻璃配方在没有模糊的内核上等于「半透明 + 无霜」，文字会直接落在壁纸上。
       浅色选择器写成与映射规则同特异度（0,1,1），深色那条 (0,2,1) 顶掉深色映射。 */
    body[data-we-glass-page],
    body[data-ds-dark-theme][data-we-glass-page] {
      --dsw-alias-bg-layer-1: var(--we-panel-color, #ffffff);
      --dsw-alias-bg-layer-2: var(--we-panel-color, #ffffff);
      --dsw-alias-bg-layer-3: var(--we-panel-color, #ffffff);
      --dsw-alias-button-elevated-fill: var(--we-panel-color, #ffffff);
      /* markdown 代码块 / 行内代码也在这张回退表里：没有模糊时半透明 = 文字直接压在
         花壁纸上，代码注释／字符串首当其冲（与上面 .cm-editor / .xterm 同一条政策）。 */
      --dsw-alias-markdown-code-block: var(--we-panel-color, #ffffff);
      --dsw-alias-markdown-code-block-banner: var(--we-panel-color, #ffffff);
      --dsw-alias-markdown-inline-code: var(--we-panel-color, #ffffff);
      --dsw-alias-markdown-tag: var(--we-panel-color, #ffffff);
      --dsw-alias-markdown-code-segment-unselected: var(--we-panel-color, #ffffff);
      --dsw-alias-markdown-code-segment-selected: var(--we-panel-color, #ffffff);
    }
  }

  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    body[data-we-glass-page],
    body[data-ds-dark-theme][data-we-glass-page] {
      --we-chat-glass-fill: color-mix(in srgb, var(--we-readability-base) 92%, transparent);
      --we-tool-glass-fill: var(--we-chat-glass-fill);
      --we-capsule-glass-fill: var(--we-chat-glass-fill);
    }
  }

  /* ── 插件源浮层（plugin-manager · 宿主自己的浮层）→ 补霜 ─────────────────────
     #156②：data-install-registry 是 dsh-client-ui-plugin-manager 写在 fieldset 上的
     源码级布尔属性（「插件源」注册表视图）。宿主把它 portal 到 body（是 body 的直接
     子节点，不在 [data-chat-flow] 里），宿主规则本身是实底色 --dsw-alias-bg-layer-2 +
     大阴影，**没有 backdrop-filter**，也不走宿主的半透明菜单通道 —— 那套菜单令牌声明在
     [data-menu-material] 元素选择器上，子树里裸读 var() 会在 computed-value 阶段整条失效。
     于是玻璃开着时它仍是一块不透明板。这里只补霜，底色仍归宿主（不重声明
     --dsw-alias-bg-layer-2，免得与注册表内部那些面板色打架）。
     模糊半径读「浮层玻璃」这条子项的私有量 --we-floaters-blur（glass.js 的浮层接线无条件写出，
     取不到时退回全局模糊），与 .we-update-notice / .we-repo-panel 同档。 */
  body[data-we-glass-floaters] [data-install-registry] {
    -webkit-backdrop-filter: blur(var(--we-floaters-blur)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
    backdrop-filter: blur(var(--we-floaters-blur)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
  }
  /* 无模糊内核：同一条「近不透明 / 摘霜」政策在这里也要收口，否则浮层是半透明无霜，
     文字直接压在壁纸上。 */
  body[data-we-glass-fallback][data-we-glass-floaters] [data-install-registry] {
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
  }

  /* 配色 swatches: circular preset buttons + native color picker. The active
     swatch gets an accent ring so the current choice is obvious at a glance. */
  /* ── 软件渲染回退（upstream #95，运行时探测）───────────────────────────────
     有些第三方桌面外壳（增强 / 扩展窗口模式，通常走软件合成）根本不执行
     backdrop-filter，但属性语法是认的 —— 所以上面那些
     @supports not ((backdrop-filter: blur(1px)) or (…)) 回退永远为真、永不启用，
     玻璃面板只剩全透明（「过透」）。detectSoftwareRender() 在运行时探测软件光栅器
     并把结果挂到 body[data-we-glass-fallback]，下面把同一批回退配方原样再挂一次：
     相同的 --we-* token、相同的 color-mix 近不透明声明（不新增任何 token /
     机制），只多一条显式的 backdrop-filter: none（语法检查通过时 @supports
     做不到这件事）。选择器与上面 @supports 回退逐条对应，并保留各自的总开关
     (data-we-sidebar-glass / data-we-glass-window)，所以关掉开关仍然是原生外观。
     输入框卡片按上游 #94 的 ::before 载体单独覆盖（见下方规则）。
     手动覆盖：?we-glassfallback=on|off（见 detectSoftwareRender）。 ── */
  body[data-we-glass-fallback][data-we-sidebar-glass] [data-sidebar-right-panel][data-sidebar-right-open]:where([data-we-surface-runtime="right-sidebar"]) {
    background-color: color-mix(in srgb, var(--we-sidebar-color) 92%, transparent) !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
  /* 左侧栏液态玻璃（leftSidebarGlass）：软件光栅器下模糊被静默忽略 ⇒ 与上面各条同一配方，
     钉成 92% 近不透明玻璃并把不会生效的 backdrop-filter 显式关掉。深色那条多一层
     [data-ds-dark-theme]，与浅色声明同特异度时后写者赢（顺序即优先级）。 */
  body[data-we-glass-fallback][data-we-glass-page][data-we-left-sidebar] div:has(> [data-slot="sidebar"]):where([data-we-surface-runtime="left-sidebar"]) {
    background-color: color-mix(in srgb, var(--we-surface-tint-light, #ffffff) 92%, transparent) !important;
    background-image: none !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
  /* issue #131：模糊已搬到列自身的 ::before 上；软件光栅器下同样要显式关掉
     （同一政策：不会生效的 backdrop-filter 不留着）。一条覆盖深浅两色。 */
  body[data-we-glass-fallback][data-we-glass-page][data-we-left-sidebar] [data-we-surface-plate="left-sidebar"] {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
  body[data-ds-dark-theme][data-we-glass-fallback][data-we-glass-page][data-we-left-sidebar] div:has(> [data-slot="sidebar"]):where([data-we-surface-runtime="left-sidebar"]) {
    background-color: color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) 92%, transparent) !important;
  }
  /* 标题栏液态玻璃（titlebarGlass）：与上面左栏那两条**同一政策** —— 软件光栅器下模糊被
     静默忽略，钉成 92% 近不透明玻璃并把不会生效的 backdrop-filter 显式关掉；深色那条多
     一层 [data-ds-dark-theme]，与浅色声明同特异度时后写者赢（顺序即优先级）。
     ⚠️ 锚点与主块同口径（含 html[data-windows-titlebar] 那道门）：软件渲染时壁纸层
        往往没走 GPU 合成，这条是那批形态唯一的兜底。 */
  html[data-windows-titlebar] body[data-we-glass-fallback][data-we-glass-page][data-we-titlebar-glass][data-we-adapter^="desktop-"] [data-we-titlebar-anchor]::before {
    background: color-mix(in srgb, var(--we-surface-tint-light, #ffffff) 92%, transparent) !important;
  }
  /* ⚠️ 模糊现在住在 ::after 上（见主块的两条规则）⇒ 软件光栅器下要关的是**它**，
     不是 ::before —— 关错对象就等于没关（不留不会生效的声明）。 */
  html[data-windows-titlebar] body[data-we-glass-fallback][data-we-glass-page][data-we-titlebar-glass][data-we-adapter^="desktop-"] [data-we-titlebar-anchor]::after {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
  html[data-windows-titlebar] body[data-ds-dark-theme][data-we-glass-fallback][data-we-glass-page][data-we-titlebar-glass][data-we-adapter^="desktop-"] [data-we-titlebar-anchor]::before {
    background: color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) 92%, transparent) !important;
  }
  body[data-we-glass-fallback][data-we-glass-page] [data-we-surface-plate] {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
  /* 内容面（编辑器/终端）本来就是近不透明底板（--we-content-surface-alpha，兜底
     88%），这里把同一条声明再挂一遍，让软件渲染下三块侧栏区域落在同一个规则块里。 */
  body[data-we-glass-fallback][data-we-sidebar-glass] :where([data-we-surface-runtime="content"]) {
    background-color: color-mix(in srgb, var(--we-content-surface-color, var(--we-panel-color, #1e1f26)) max(calc(var(--we-readability-floor) * 100%), var(--we-content-surface-alpha, 88%)), transparent) !important;
  }
  /* 设置窗口：把三层面板 token 钉回实色（@supports 回退里的同一条 token 覆写），
     并显式关掉不会生效的 backdrop-filter。
     ⚠️ 令牌写在**对话框本体**（装饰叶没有后代可继承），只有 backdrop-filter 那条
     落在 ::before 上 —— 它才是会建立包含块的那一半。 */
  body[data-we-glass-fallback][data-we-glass-window] [role="dialog"]:has([data-slot="settings.section"]):where([data-we-surface-runtime="settings-window"]) {
    --dsw-alias-bg-layer-1: var(--we-surface-tint-light, #ffffff);
    --dsw-alias-bg-layer-2: var(--we-surface-tint-light, #ffffff);
    --dsw-alias-bg-layer-3: var(--we-surface-tint-light, #ffffff);
  }
  body[data-we-glass-fallback][data-we-glass-window] [role="dialog"]:has([data-slot="settings.section"]):where([data-we-surface-runtime="settings-window"])::before {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
  body[data-ds-dark-theme][data-we-glass-fallback][data-we-glass-window] [role="dialog"]:has([data-slot="settings.section"]):where([data-we-surface-runtime="settings-window"]) {
    --dsw-alias-bg-layer-1: var(--we-surface-tint-dark, #0d1524);
    --dsw-alias-bg-layer-2: var(--we-surface-tint-dark, #0d1524);
    --dsw-alias-bg-layer-3: var(--we-surface-tint-dark, #0d1524);
  }
  /* 软件光栅器（data-we-glass-fallback）下同样把**整窗**的表面令牌钉回实色：
     玻璃配方在这一档等于「半透明 + 无霜」（模糊被下面的回退规则关掉），
     宿主的面板/对话框/按钮面必须回到不透明面板色，否则文字压在壁纸上。
     深色那条选择器多一层 (0,3,1)，才能顶掉 body[data-ds-dark-theme][data-we-glass-page]
     上的玻璃映射。 */
  body[data-we-glass-fallback][data-we-glass-page],
  body[data-ds-dark-theme][data-we-glass-fallback][data-we-glass-page] {
    --dsw-alias-bg-layer-1: var(--we-panel-color, #ffffff);
    --dsw-alias-bg-layer-2: var(--we-panel-color, #ffffff);
    --dsw-alias-bg-layer-3: var(--we-panel-color, #ffffff);
    --dsw-alias-button-elevated-fill: var(--we-panel-color, #ffffff);
    --dsw-specific-selector: var(--we-panel-color, #ffffff);
  }
  /* 思考触发条（本仓新增面，见上面「思考触发条」那一节）：它的底色**本来就**由宿主读那个
     专属令牌 ⇒ 回退档把令牌钉回不透明面板色（--we-panel-color 是主题感知的：浅 #ffffff /
     深 #1e1f26），模糊没了也不会"过透"。hover 档一并钉回同色 —— 与上面三个 layer 令牌在
     回退档统一成同一色的口径一致（降级档不保留悬停反馈，优先保可读）。
     ⚠️ 与主规则同门（data-we-thinking-glass）+ 多一层 fallback 属性：特异性 (0,3,1) 高于
     主规则的 (0,2,1)（深色档 (0,4,1) 高于深色主规则 (0,3,1)）⇒ 覆盖成立。 */
  body[data-we-glass-fallback][data-we-thinking-glass][data-we-glass-page],
  body[data-ds-dark-theme][data-we-glass-fallback][data-we-thinking-glass][data-we-glass-page] {
    --dsw-alias-turn-trigger-bg: var(--we-panel-color, #ffffff);
    --dsw-alias-turn-trigger-bg-hover: var(--we-panel-color, #ffffff);
  }
  /* 输入框卡片（issue #95 报「过透」的那块界面）：上游 #94 已把模糊从卡片本体搬到
     [data-composer-card]::before 载体（卡片上的 backdrop-filter 会成为 fixed 后代的
     包含块，#89）——载体上没有背景，卡片自身的底色只有 --we-glass-alpha（默认 15%），
     所以只关掉 backdrop-filter 仍然过透。这里让 ::before 自己变成近不透明底板：
     载体是同一块表面，模糊没了就由它兜住底色，配方与上面 .we-repo-panel 逐字相同
     （同一个 --we-surface-tint-light/dark / 92%，未新增 token 或机制）。 */
  body[data-we-glass-fallback][data-we-glass-page] [data-composer-card]::before {
    background-color: color-mix(in srgb, var(--we-surface-tint-light, #ffffff) 92%, transparent);
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
  /* A near-opaque canvas is only the no-frost fallback, never normal chat. */
  body[data-we-glass-fallback][data-we-glass-page],
  body[data-ds-dark-theme][data-we-glass-fallback][data-we-glass-page] {
    --we-chat-glass-fill: color-mix(in srgb, var(--we-readability-base) 92%, transparent);
    --we-tool-glass-fill: var(--we-chat-glass-fill);
    --we-capsule-glass-fill: var(--we-chat-glass-fill);
  }
  /* ⚠️ 这条与上面 92% 不透明的思考玻璃填充配套，挂同一道门 —— 否则关着思考玻璃的
     fallback 模式也会被摘掉气泡的 backdrop-filter。
     带 :not([role="tooltip"]) 与上面三条同办（#161）：宿主 Tooltip 从来不吃插件霜釉，
     清它不是修 bug 而是保持「一条规则只谈气泡」的可读性 + 让守卫按同一判据数。 */
  body[data-we-glass-fallback][data-we-glass-page][data-we-thinking-glass] [class*="_bubble"]:not([role="tooltip"]) {
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
  }
  body[data-we-glass-fallback][data-we-glass-page][data-we-thinking-glass] [data-turn-trigger],
  body[data-we-glass-fallback][data-we-glass-page][data-we-thinking-glass] [data-vcp-reasoning],
  body[data-we-glass-fallback][data-we-glass-page][data-we-thinking-glass] [data-changed-files],
  body[data-we-glass-fallback][data-we-glass-page][data-we-thinking-glass] [data-presented-file],
  body[data-we-glass-fallback][data-we-glass-page][data-we-thinking-glass] [data-chat-flow] .md-code-block,
  body[data-we-glass-fallback][data-we-glass-page][data-we-thinking-glass] [data-vcp-rawhtml] > div > div:has(> pre > code):has(> div > button[title="复制代码"]) {
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
  }
  /* 仓库抽屉：与 @supports 回退逐字相同的 92% 近不透明配方。 */
  body[data-we-glass-fallback] .we-repo-panel {
    background-color: color-mix(in srgb, var(--we-surface-tint-light, #ffffff) 92%, transparent);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
  /* 一次性通知：底色本身已经接近不透明（82% 深色底衬），不需要换配方，
     只把永远不生效的 backdrop-filter 关掉。 */
  body[data-we-glass-fallback] .we-update-notice {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
  @media (prefers-reduced-motion: reduce) {
    .we-rope--settle, .we-repo-panel { transition: none !important; }
  }

  /* ── 侧栏全透明（issue #137，设置键 sidebarFullClear，默认关）──────────────
     用户口径：其他面都能调透，唯独侧栏被可读性下限锁死 —— 地板（浅 0.45 / 深 0.59）
     以带 !important 的 color-mix 恒定掺入，侧栏透明度拉满也绕不过。本组规则在
     **壁纸激活**时把插件画在侧栏上的底色层整块撤掉，让用户主动放弃下限换全透：
       · 第一条按**容器**就地归零六个变量（地板 / 色染 / 釉光三组）：面板规则里的
         color-mix 与白釉渐变在元素上解析时取到的就是 0 ⇒ 玻璃开着时的全部侧栏上色
         规则（深浅两色、@supports 无霜兜底、软件渲染兜底 —— 这些都读这几个变量）
         一起透掉；**以后新增读这些变量的侧栏规则也自动被接管**。自定义属性沿 DOM
         继承 ⇒ 生效与规则书写顺序无关。
       · 右栏第二条与左列第三条是**显式接管**：玻璃关着时右栏兜底读插件面板色、左列
         的浅深与兜底写死 92% 釉色（都不走上面的变量）⇒ 把这两处的底色与釉光直接画
         透。落盘位置晚于全部既有侧栏规则 ⇒ 同特异度后写者赢（含软件渲染深色那档）。
     模糊：本组末尾那条规则把两片装饰叶的 backdrop-filter 显式关掉（issue #329）——
     1.4.2 起模糊已从面板搬到装饰叶（#291），装饰叶挂在 body > [data-we-surface-root]
     下、不在面板子树里，也不读上面归零的那七个变量（它读 --we-sidebar-blur /
     --we-sidebar-saturate / --we-glass-brightness，与归零集无交集）⇒ 旧口径「模糊
     仍由旋钮管」会让面板全透、壁纸仍被装饰叶糊着；「侧栏玻璃跟随全局」下侧栏模糊
     又被全局模糊覆盖、没法单独调 0，所以只能随本开关一起关。
     内容面（编辑器 / 终端底板）不归本开关管，仍有自己的透明度旋钮。只在壁纸下生效：
     无壁纸时侧栏压着的是聊天界面，全透不可读。 */
  body[data-we-wallpaper][data-we-sidebar-fullclear] [data-dsh-better-sidebar],
  body[data-we-wallpaper][data-we-sidebar-fullclear] [data-sidebar-right-panel][data-sidebar-right-open]:where([data-we-surface-runtime="right-sidebar"]) {
    --we-readability-floor: 0;
    --we-sidebar-tint: 0%;
    --we-sidebar-color: transparent;
    --we-sidebar-sheen: 0;
    --we-sidebar-sheen-a: 0;
    --we-sidebar-sheen-b: 0;
    --we-sidebar-sheen-c: 0;
  }
  body[data-we-wallpaper][data-we-sidebar-fullclear] [data-sidebar-right-panel][data-sidebar-right-open]:where([data-we-surface-runtime="right-sidebar"]) {
    background-color: transparent !important;
    background-image: none !important;
  }
  body[data-we-wallpaper][data-we-sidebar-fullclear][data-we-left-sidebar] div:has(> [data-slot="sidebar"]):where([data-we-surface-runtime="left-sidebar"]),
  body[data-ds-dark-theme][data-we-wallpaper][data-we-sidebar-fullclear][data-we-left-sidebar] div:has(> [data-slot="sidebar"]) {
    background-color: transparent !important;
    background-image: none !important;
  }
  /* #329：装饰叶的模糊随开关一起撤。门与上面两条装饰叶模糊规则（左 [data-we-left-sidebar]
     / 右 [data-we-sidebar-glass]）对齐，再叠壁纸门与全透明门；装饰叶不在面板子树里，
     只能按这个锚点清。 */
  body[data-we-wallpaper][data-we-sidebar-fullclear][data-we-glass-page][data-we-left-sidebar] [data-we-surface-plate="left-sidebar"],
  body[data-we-wallpaper][data-we-sidebar-fullclear][data-we-glass-page][data-we-sidebar-glass] [data-we-surface-plate="right-sidebar"] {
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
  }

  /* ── 第三方插件表面的实底底板（issue #277）──────────────────────────────────
     症状：装了带弹窗 / 自带框架页的第三方插件后，那些面是**半透明**的 ——
     背后的页面内容、兄弟弹窗一起透上来，叠成一团看不清。

     根因（真 Chromium 实测）：本插件把宿主的层令牌
     --dsw-alias-bg-layer-1/2/3、--dsw-alias-bg-base、--dsw-alias-bg-overlay
     **重映射成玻璃配方**（半透明 + 染色地板），而宿主自己的面各有专门规则把底补回来
     （设置窗 :has([data-slot])、插件管理器 [data-install-registry]、输入卡、气泡…）。
     第三方写的容器**一个都不匹配**这些锚点 ⇒ 它们读到的就是玻璃配方 ⇒
     「半透明且没有 backdrop-filter」= 后面的东西直接透出。

     实测（深色档，本包的 CSS_GLASS + 宿主令牌替身）：
       宿主设置窗                      α = 1.000（有专门规则）
       role="dialog" 第三方弹窗         α = 0.656、backdrop-filter: none
       tooltip / listbox               α = 0.675 / 0.662
       无 role 的 body 直系框架层        α = 0.656
       无 role 的 _header 吸顶条         α = 0.649
       宿主自己的确认框 / 审批卡 / 问答卡  α = 0.656~0.662（同一个洞的受害者）
       宿主设置窗**本体**                α = 0（玻璃画在 ::before 上，见下面的排除项）

     为什么只做 ARIA 这一层（#277 评论里的意见我采纳了一半，另一半**明确不做**）：
       评论指出「吸顶条 / 整页框架层不带 role，只认 ARIA 覆盖不到」—— 这是对的，
       真机实测也确认了（α≈0.65 仍透）。但那类面**没有稳定锚点**：宿主不给它们
       data-* 属性，第三方插件的类名又是哈希，唯一可用的识别方式是「body 直系」
       或「类名含 sticky/header」这类**结构猜测**。
       本仓纪律明确禁止猜哈希；而 structure-guess 会误伤宿主自己的框架层（那是壁纸
       该透出来的地方）。所以本 PR **只落地可被稳定识别的 ARIA 浮层**，
       并在 PR 正文里把「无 role 面」作为**已知边界**交给维护者裁决（要么宿主加锚点，
       要么明确接受这些面半透明）。
       这样做的好处：射程可验证、零误伤、不与 W5 的锚点门控纪律冲突。

     ⚠️ 实底只能靠「在浮层作用域里重声明层令牌」落地，**不能**直接涂
        background-color，更不能摘 backdrop-filter（用户截图回归：ContextMeter /
        Token 用量 / 会话统计 三个宿主锚定浮层都是 portal 到 body 的 role="dialog"，
        自带菜单材质 background: var(--dsw-specific-menu) + blur(40px) 的霜；
        一刀切涂底 + 摘霜会把它们刷成不透明板，用户口径就是「玻璃组件丢失」）。
        令牌重声明只影响读 --dsw-alias-bg-layer-* 的浮层（正是 #277 的受害者），
        读菜单材质令牌的浮层一个字节都不碰：它们的底与霜都是宿主自己的玻璃。

     ⚠️ 门控 = data-we-floater-solid（设置项 floaterSolidBase，默认开）。
        摘掉属性整组失效 ⇒ W5「关 ⇒ 回退干净」成立。
     ⚠️ 令牌值取 --we-readability-base（本包按主题钳制过的染色地板）⇒ 跟着主题与
        用户选的玻璃色走，不是硬编码另一种灰。
     ⚠️ 只重声明三层背景令牌，不碰 border / 圆角 / 阴影，也不碰霜。
     ⚠️ **必须显式排除宿主自己的对话框**（三个 :not）：
        设置窗在真实 DOM 里**就是** role="dialog" —— 它的玻璃画在 ::before（z-index:-1）上、
        本体透明。本组规则若命中本体，会给它涂一层不透明底把玻璃整个盖掉
        （实测：门开 ⇒ 设置窗完全不透，与"壁纸该透出来"直接冲突）。
        · :not([data-we-surface-runtime]) —— 本插件认领过的面（玻璃开着时都带这个标记），
          它们各有自己的底板规则，这里一个都不许碰。
        · :not([data-we-host-dialog]) —— 覆盖「保留原生」档：那一档 glass-surfaces.js
          会把 data-we-surface-runtime **摘掉**，只用上面那一个 :not 挡不住
          （实测：宿主面板色 rgb(30,31,38) 被改成 --we-readability-base）。
          这个标记由同一个运行时在识别设置窗时无条件打上，与玻璃开不开无关。
        · :not([class*="_dialog"]) —— 宿主 primitives 的 Modal（role="dialog" +
          CSS Module 语义后缀 _dialog：「添加插件」安装对话框、确认框、审批卡…
          首例见用户截图）。它们的遮罩**自己就画** backdrop-filter:
          var(--dsw-mask-blur)，而本包在 body 上把这条通道换成了模糊配方
          （见上面 #156① 那段）⇒ 卡片背后已经是模糊的页面，读层令牌就是半透明玻璃，
          没有"两行字叠在一起"的重影风险；1.4.2 发布版本来就是这种玻璃观感。
          本组最初一刀切实底化，用户口径是「添加插件界面玻璃丢失」。
          ⚠️ 用类名后缀而不是 aria-modal：宿主 Modal 的 dialog 类名恒定带 _dialog
          （Modal.module.css 的 .dialog），第三方浮层用 dshMarketOverlay /
          typeFilterPanel 这类名字，照旧命中实底。
        ⚠️ 不写 :has([data-slot="settings.section"]) 之类的宿主锚点排除：会被 ② 组判成
          "未登记的玻璃面"，且会让本组规则被算进 settings-window 面而使 W5 判红（都实测踩过）。
          三个排除项里两个 data-we-* 是本插件自己的标记，anchorsOf() 按前缀跳过，不参与枚举；
          class 子串不是 data-* 锚点，也不参与。 */
  body[data-we-glass-page][data-we-floater-solid] :where([role="dialog"], [aria-modal="true"]):not([class*="_dialog"]):not([data-we-surface-runtime]):not([data-we-host-dialog]) {
    --dsw-alias-bg-layer-1: var(--we-readability-base, #ffffff);
    --dsw-alias-bg-layer-2: var(--we-readability-base, #ffffff);
    --dsw-alias-bg-layer-3: var(--we-readability-base, #ffffff);
  }
  body[data-we-glass-page][data-we-floater-solid] :where([role="alertdialog"]):not([class*="_dialog"]):not([data-we-surface-runtime]):not([data-we-host-dialog]) {
    --dsw-alias-bg-layer-1: var(--we-readability-base, #ffffff);
    --dsw-alias-bg-layer-2: var(--we-readability-base, #ffffff);
    --dsw-alias-bg-layer-3: var(--we-readability-base, #ffffff);
  }
  /* #315：无 role 浮层的可声明实底（#277 的剩余边界第一步）。
     上面两条只认 ARIA 面；没有 role 的框架层 / 吸顶条 / 第三方容器没有稳定锚点，
     按类名或结构猜会误伤宿主自己的框架层（壁纸该透出来的地方），也会被对方改类名
     静默失效。这里给「用户显式声明过的额外选择器」一条确定出路：运行时在
     resolver 判定该面**只能退回原生**（无法安全玻璃化）时打上 data-we-solid-base，
     本规则据此补实底 —— 观感从「半透明且无霜」变成「实底可读」。
     ⚠️ 只认锚点：没被声明的面不匹配本规则；锚点由 glass-surfaces.js 的
        weSurfaceSolid/weSurfaceUnsolid 成对写入/还原，随退出枚举、退回可玻璃化档位、
        行级重挂与 dispose 一并清掉。
     ⚠️ 与上面一组同门（floaterSolidBase，默认开）：摘掉 body 门整组回退。
     ⚠️ 不写 background-image、不碰 border/圆角/阴影，保持与 #277 实底同一口径。 */
  body[data-we-glass-page][data-we-floater-solid] [data-we-solid-base]:not([data-we-host-dialog]) {
    background-color: var(--we-readability-base, #ffffff) !important;
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
  }

  /* ── 上下文占用环（ContextMeter）：轨道不得吃「边框」滑杆 ────────────────────
     症状（用户截图）：底栏上下文占用的小圈"总是像满了"，进度弧看不出来。
     根因：#255④ 把 --dsw-alias-border-l3 一起接进「边框」滑杆；宿主
     ContextMeter 的轨道圆环（circle class="*_track"）正是用它画的，进度弧
     （circle class="*_fill"）用 --dsw-alias-label-tertiary。用户配置 border=0.9 时
     轨道合成到 ~#a6a6a6，比弧（#979da6）还亮 ⇒ 整圈都像已占用。
     修法：轨道改由文字三档色稀释而来（与进度弧同源，恒比它淡），不新增令牌、
     不碰弧、也不改边框滑杆的其它消费者。锚点取 CSS Module 的语义后缀 _track
     （哈希前缀随构建变、后缀稳定；宿主里只有 ContextMeter 用 circle._track）。 */
  body[data-we-glass-page] circle[class*="_track"] {
    stroke: color-mix(in srgb, var(--dsw-alias-label-tertiary, #979da6) 32%, transparent);
  }

`;

export { CSS_GLASS };
