/**
 * styles-shell.js —— 样式域模块 **SHELL**（原 src/styles.js 第 593–1134 行，共 542 行）。
 *
 * 内容：宿主外壳 —— iOS liquid glass · 思考触发条 · 输入座位 · composer card · 轨迹霜 · 吸顶条 · 正文原生挡 · 原生左栏底 · 外壳画布底。
 *
 * 拼装契约（样式族 9 个模块共享，组装点见 src/styles.js）：
 *   · 构建期按 INLINE_MODULES 顺序把族内文件**原样内联进同一工厂作用域**，模块之间不 import，靠扁平符号协作
 *     （见 docs/CODE-STRUCTURE.md §3）；
 *   · 本段模板的开引号紧跟本段首行（不另起一行）；段间那一个换行由上一段的收尾换行提供；
 *     本段自身以换行收尾（下一段接着写）；
 *   · 组装点按 BASE → SHELL → SIDEBAR → CHROME → SETTINGS → PANEL → QUICK → EXT 相加 ⇒ 拼出的 CSS 与原单模板
 *     **逐字节相同**（分割前 sha256 前缀 3b6c41dc7dcab44bf5c57f4 · 262306 B）。
 *
 * ⚠️ 本文件（注释与正文）不得出现裸反引号，也不得复述任何样式表声明语句的字面量：守卫按行首的域模板
 *    声明从**产物**里抽取模板，散文里出现同样的字面量或反引号会把锚点带偏。
 *
 * 契约：需要的外界**无**；对外提供本域的样式表常量。不变量：浏览器安全（无 import / require / Node API）、
 * 不得有顶层可执行语句去读宿主状态（内联位置早于 client.js 正文）、整体是**纯数据**。
 */
const CSS_SHELL = `  /* ── iOS liquid glass ──────────────────────────────────────────────────────
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
  /* Inline capsules: ten-percent white mist and independent 8px frost.
     Host padding/radius and text colour stay intact; fences are excluded. */
  body[data-we-glass-page][data-we-thinking-glass] [data-chat-flow] :not(pre) > code,
  body[data-we-glass-page][data-we-thinking-glass] [data-vcp-rawhtml] :not(pre) > code {
    background: var(--dsw-alias-markdown-inline-code) !important;
    background-image: none !important;
    -webkit-backdrop-filter: blur(var(--we-inline-code-blur, 8px)) saturate(var(--we-saturate, 1.3)) brightness(var(--we-glass-brightness, 1.04));
    backdrop-filter: blur(var(--we-inline-code-blur, 8px)) saturate(var(--we-saturate, 1.3)) brightness(var(--we-glass-brightness, 1.04));
    border-color: rgba(255, 255, 255, 0.14) !important;
  }
  /* #197: the host renders the reasoning body with Markdown's compact variant,
     where the inline-code chip is display:inline. A backdrop-filter carrier that
     breaks across line boxes paints the union of every line box, so the capsule
     frost grows into one full-column bar over the plain text sharing those lines.
     Drop only the blur here — the host's box-decoration-break: clone keeps the
     fill sliced per line box, and fences stay excluded by :not(pre).
     Two anchors carry this: the semantic data-variant="think" the host writes on
     the reasoning root, and the _thinkBody class suffix. The suffix is a build
     hash half — DSH-UI-INTERFACES.md rates it low-stability and forbids hanging
     user-visible behaviour on it alone — so the semantic attribute is the load
     bearing one and the suffix is the fallback. The old data-vcp-* names stay
     for older host lines.
     [data-chat-flow] is carried too: it puts this rule at 0-4-3 against the
     0-3-3 original, so the order of the two blocks stops being load bearing
     (both are !important and equally specific without it). Coverage does not
     shrink: the only host element with data-variant="think" is the reasoning row
     inside the chat flow column. */
  body[data-we-glass-page][data-we-thinking-glass] [data-chat-flow] :is([data-variant="think"], [class*="_thinkBody"], [data-vcp-reasoning-body], [data-vcp-reasoning]) :not(pre) > code {
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
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
    border-color: rgba(255, 255, 255, 0.14) !important;
    -webkit-backdrop-filter: blur(var(--we-inline-code-blur, 8px)) saturate(var(--we-saturate, 1.3)) brightness(var(--we-glass-brightness, 1.04));
    backdrop-filter: blur(var(--we-inline-code-blur, 8px)) saturate(var(--we-saturate, 1.3)) brightness(var(--we-glass-brightness, 1.04));
  }
  body[data-we-glass-page][data-we-thinking-glass] [data-slot="sidebar"] :not([class*="_collapsed"]) > button[class*="_newSession"]:hover {
    background: color-mix(in srgb, var(--we-capsule-glass-fill) 96%, white) !important;
  }
  body[data-we-glass-fallback][data-we-glass-page][data-we-thinking-glass] [data-slot="sidebar"] :not([class*="_collapsed"]) > button[class*="_newSession"],
  body[data-we-glass-fallback][data-we-glass-page][data-we-thinking-glass] [data-chat-flow] :not(pre) > code,
  body[data-we-glass-fallback][data-we-glass-page][data-we-thinking-glass] [data-vcp-rawhtml] :not(pre) > code,
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
     ⚠️ 门控属性由 effects.js 写/撤（thinkingNative，赢过 thinkingGlass 的互斥见那边）；
     皮肤让路态整族摘门控时随 effects.js 同批摘除。 */
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

  /* ── 原生左栏在 extended/advanced 窗口模式下的不透明底 ─────────────────────
     harness 的壳层样式表带一条模式门控规则：mode 为 extended/advanced 且
     material=off 时，ASIDE.dshDesktopSidebarSurface（原生左栏 surface）被刷成
     不透明的 var(--dsw-alias-bg-layer-1)，并经继承的 --dsw-specific-sidebar-fill
     变量传给内层（兼容模式无此规则，左栏直接透出壁纸）。壁纸激活时恢复透明，
     让两种模式观感一致；壳层关闭壁纸时原生不透明底照旧。
     门控到 [data-we-adapter^="desktop-"]：壳层属性 + 适配目标两腿都成立才画，
     浏览器形态即使页面带着同名属性也不吃这条。 */
  body[data-we-adapter^="desktop-"][data-we-wallpaper][data-dsh-desktop-mode="extended"] .dshDesktopSidebarSurface,
  body[data-we-adapter^="desktop-"][data-we-wallpaper][data-dsh-desktop-mode="advanced"] .dshDesktopSidebarSurface {
    /* !important 必需：宿主的模式门控规则在层叠里赢过本表的非 important 声明
       （实测 var 被压回 #232324），important 才能让 fill 变量真正翻转。 */
    --dsw-specific-sidebar-fill: transparent !important;
    background: transparent !important;
  }

  /* ── 外壳画布底 ───────────────────────────────────────────────────────────
     壳层有一条**模式门控**规则把 .dshDesktopFrame（整窗 grid 容器）刷成
     var(--dsh-desktop-frame-fill)：Windows 上 material 只能是 off ⇒ 该变量 =
     var(--dsw-alias-bg-layer-1)（不透明）⇒ 挂在 body 上的 z-index:-1 壁纸层被整片盖住
     （用户看到「壁纸没生效 / 像没选壁纸」；.dshDesktopFrame 位于 #root 的自成层叠上下文内）。
     ⚠️ **不加模式门控**：兼容模式的基线样式是 transparent（这条规则因此是无操作），而模式名
     与门控集合由壳层自己演进 —— 只认 "extended" 的那一版会在壳层给别的模式也加底色后整片盖住
     壁纸。壁纸激活时一律清底，是对模式名漂移免疫的写法。
     ⚠️ 这条选择器里的 .dshDesktopFrame 与 --dsh-desktop-frame-fill 在**当前 DSH Desktop
     里都不存在**（对 app.asar 全量字面扫描命中 0 次）—— 规则保留为无害的兼容项：万一某个
     形态仍有这个类名，它要的正是"清画布"。Windows 形态真正要让开的是
     --dsw-specific-sidebar-fill（已由上面那条在壁纸激活时置 transparent，顶栏伪元素读的正是它）。
     主内容区读 --dsw-alias-bg-base，本表已在 body[data-we-wallpaper] 上置 transparent，无需再写。
     同样门控到 [data-we-adapter^="desktop-"]（理由见上一条规则）。 */
  body[data-we-adapter^="desktop-"][data-we-wallpaper] .dshDesktopFrame {
    background: transparent !important;
  }

`;

export { CSS_SHELL };
