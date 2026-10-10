/**
 * styles.js — 插件注入的**整份样式表**（纯数据；构建期内联进 lib/client.js 的工厂作用域）。
 *
 * 为什么单独一个文件：这是全仓最大的一块**纯数据**（1,800+ 行 CSS、**零分支**），夹在
 * 若把它留在 src/client.js 里，在那一大片正文中定位"这段逻辑从哪开始"会极难。它不参与任何控制流，
 * 只被样式注入代码读一次（本文件底部那个样式表常量 → 注入处的 textContent 赋值）。
 *
 * ⚠️ 可读性下限（READABILITY_FLOOR / READABILITY_FLOOR_DARK）**必须和 CSS 同处一文件**：
 *    它们是样式表模板里的插值，且**只**在这里被使用 —— 一旦分开，"数值与样式表漂移"
 *    就重新变成可能。数值的来龙去脉见下面那段注释（test/verify-readability.mjs 复算同一张网格）。
 *
 * ⚠️ **本文件的注释里不得出现反引号，也不得复述下面那条样式表声明语句的字面量**：样式表模板
 *    由若干守卫从**产物**里按"行首的那条声明"取出来，散文里出现同样的字面量或裸反引号会把
 *    锚点带偏 —— 判据会读出整份 bundle（**实测**：verify-host-paint-scope 的 H0 报"裸反引号 489"）。
 *
 * 契约：需要的外界**无**；对外提供样式表常量与两个可读性下限。
 * 不变量：
 *   · 浏览器安全（无 import / require / Node API），且**不得有顶层可执行语句**去读宿主状态——
 *     它被内联到 bundle 顶部（早于 client.js 正文）。顶层样式表常量是**纯数据**，
 *     插值只引用本文件自己的常量 ⇒ 不触发 TDZ。
 *   · 这是**纯数据**：逻辑（何时注入、何时移除、代际标记）留在 src/client.js。
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

// ── Styles ──────────────────────────────────────────────────────────────────
const CSS = `
  /* Wallpaper layer: a fixed child of <body>, sunk BELOW the app frame.
     壁纸透明度（#82）作用在**媒体叶子**（.we-layer .we-media）上 —— 对
     <video>/<img>/<iframe>/canvas 四类媒体统一生效，也无需逐媒体处理
     fit/transform 的相互作用；层自身垫一层**原生底色**
     （--we-wallpaper-fade-bg，浅色纯白 / 深色纯黑）保持不透明合成（透明
     backdrop 会让玻璃 backdrop-filter 静默失效）。变量缺省 1。 */
  /* 垫底画面（.we-layer .we-live-poster，见 src/live-layer.js 的 buildLivePoster）用
     --dsw-alias-bg-layer-1 打底，且垫底必须是「一层安静的颜色」、不能透明；壁纸激活时
     该别名已被改写成玻璃配方 ⇒ 在壁纸层根上钉回插件自己的面板色，垫底语义不变。 */
  /* ⚠️ 拖拽区（upstream #120）：本层是**整屏**且直接挂在 body 上，而宿主前端在 darwin 下有一条
     把 body 下非 #root 直接子元素一律设成 no-drag 的规则 ⇒ Electron 会把这块矩形从窗口可拖区里
     **几何挖除**（与绘制顺序、z-index、pointer-events 都无关）。macOS 桌面壳没有原生标题栏，可拖
     几何全靠 Web 侧的 drag 行，于是顶栏整片失去可拖性。
     这里必须是 initial 而**不是 none**：Chromium 把关键字 none 归进 no-drag 模式，写 none 等于
     什么都没修（computed 仍是 no-drag）；initial 才是「不产生任何 region」。
     !important 用来压过那条带 id 选择器的宿主规则（本选择器特异性不够）。
     不要照抄到需要接指针的浮层（拉绳 / 选择器模态 / 仓库面板）—— 它们本来就该是 no-drag。 */
  /* ── 画布兜底色：壁纸的像素没送到屏上时，屏上还剩一层像它的颜色 ──────────────
     壁纸层是挂在 body 上、z-index:-2 的**普通元素** ⇒ 它的像素活在根帧的栅格里；
     整条合成链上"不依赖栅格、由合成器直接填充"的只有一样东西：**根元素的背景色**
     （画布背景）。而窗口 / 标签页的状态切换（最小化 → 任务栏缩略图 → 还原、被别的
     窗口遮挡、后台节流后回来）都可能让根帧拿不到那一层的已提交像素 —— 此时页面若
     什么都不画，露出的就是**窗口底板**（Electron 的 backgroundColor 缺省是 #FFF）
     与宿主 body 的纯白兜底，用户看到的就是「整块白」。
     所以壁纸激活期间给 html 一个不透明的**壁纸代表色**：掉层时退化成同色底，而不是白闪。
     取值与优先级见 src/live-layer.js 的 refreshUnderlayColor（画面占比最大色 →
     作者 / 面板配色 → 不设 = transparent）。
     ⚠️ 只写 html、不写 body：宿主在 darwin 下有一条
     html[data-platform=darwin] body { background: transparent }（给窗口材质让路）
     在层叠上赢过 body 侧的任何声明；
     而根元素背景本来就是画布背景的唯一来源，写在这里也最不容易被别的规则盖住。
     变量只在壁纸激活期间存在（applyEffects 写、clearEffects 删），缺省 transparent ⇒
     非壁纸状态照旧由 body 的背景传播画底，行为不变。 */
  html { background-color: var(--we-wallpaper-underlay, transparent); }

  .we-layer { position: fixed; inset: 0; z-index: -2; overflow: hidden; pointer-events: none; opacity: 1; background-color: var(--we-wallpaper-fade-bg, transparent); --dsw-alias-bg-layer-1: var(--we-panel-color, #101418); -webkit-app-region: initial !important; }
  /* 壁纸层取景（位置 / 缩放）：投影自 WE 壁纸属性面板的 水平 / 垂直 / 缩放
     （free alignment 的 alignmentx / alignmenty / alignmentz）。写的是**独立属性**
     translate / scale，**不是** transform —— 层切换过渡与 .we-layer--repaint
     都写 transform，独立属性与它叠加而不是互相清掉（与下面视差段同一条纪律）。
     变量缺省即恒等（不位移、不缩放）：等于默认值时 applyEffects **不写变量**，
     免得一条 translate: 0px 0px 把整屏 <video> 逼上常驻合成层。 */
  .we-layer {
    translate: var(--we-layer-x, 0px) var(--we-layer-y, 0px);
    scale: var(--we-layer-scale, 1);
  }
/* Blurring via CSS filter darkens/thins the edges, so the layer is scaled up
   (the scale term is folded into --we-wallpaper-transform, beside the flip) to hide
   the transparent fringe the blur would otherwise reveal at the viewport edges. */
  .we-layer .we-media {
    width: 100%; height: 100%; object-fit: cover; display: block;
    background: transparent; border: 0;
    /* 壁纸透明度（#82）作用于媒体叶子而非 .we-layer 整层：layer 垫**原生底色**
       （--we-wallpaper-fade-bg，浅色纯白 / 深色纯黑）保持不透明合成，避免透明
       backdrop 让玻璃 backdrop-filter 失效（见 applyEffects 注释）。 */
    opacity: var(--we-wallpaper-opacity, 1);
    /* Blur is applied ONLY when > 0 (see --we-media-filter in applyEffects):
       a permanent blur(0px) would still force an offscreen filter layer on
       the wallpaper <video>/canvas every frame — a known source of periodic
       compositing glitches (brief white flash) in Chromium. */
    filter: var(--we-media-filter, none);
    /* Single transform var — "none" at default so the full-screen <video> isn't
       forced onto a transform compositing layer; the blur-compensation scale and
       the mirror are composed in the SAME var when active. */
    transform: var(--we-wallpaper-transform, none);
    transform-origin: center;
  }
  /* The 适配 row sets the fit mode for the CURRENT wallpaper (any type);
     only .we-media--fit reads the variable (iframes have no object-fit). */
  .we-layer .we-media--fit { object-fit: var(--we-object-fit, cover); }

  /* Scene live render (WebWallGL): static frame underlay + renderer iframe.
     Both stack absolutely inside .we-layer; the iframe starts transparent and
     fades in on the first heartbeat frame (.we-live-on, startLiveWatch) so the
     load window and any live→frame degradation never flash. Fade composes with
     the wallpaper-opacity leaf var (#82) via calc instead of overwriting it.
     时长与 LIVE_FIRST_FADE_MS 同步（当前 1800ms）：手动切换壁纸时
     「GPU 静帧 → 实时动态帧」的缓慢过渡走的就是这条腿。 */
  .we-layer .we-live-poster {
    position: absolute; inset: 0; width: 100%; height: 100%;
    background-size: cover; background-position: center; background-repeat: no-repeat;
  }
  /* live 首帧点亮后，垫底实时帧必须**整块退场** —— 但必须**串行**：等 iframe
     淡入完成后再快收，不能与 iframe 同步双淡出。同步双淡出时两个半透明层互换，
     黑底会在过渡中点以 (1−f)(1−p)≈25% 的强度漏出来（层底是原生纯黑/纯白），
     用户实测可见「切换完成后整屏呼吸式变暗后恢复」—— 它违反了本仓「旧画面
     保持不透明垫底」的铁律。串行后 iframe 淡入期间的合成是
     f·live + (1−f)·实时帧，黑底永不参与；延迟 1.8s（与 LIVE_FIRST_FADE_MS
     同步）时 iframe 已到终态 —— a=1 时静态帧被完全不透明 iframe 盖住，0.3s
     快收完全不可见；a<1 时残余的 a(1−a) 静态帧鬼影（本规则存在的理由，见下）
     由这 0.3s 平滑收掉。
     ⚠️ 它在 DOM 里是 iframe 的**下层**，而「壁纸透明度」是把上层 iframe 变半透明
     —— 一个 0.1 的 alpha 会让静态帧以 a(1−a)≈0.09 的强度重新透出来：现象就是
     「壁纸透明度高时显现实时帧」，而预期是只该看到原生底色 + 淡出的实时画面。
     首帧确认前 / 降级回实时帧后本规则不匹配，垫底照旧负责盖住加载窗口。
     transition 写在**这条规则里**：状态翻转时按上式延迟快收，翻回（降级）时规则
     连同 transition 一起消失、立即恢复垫底；live 生效期间这里的 opacity 是字面量 0，
     与「壁纸透明度」滑块无关 —— 不会拖慢滑块手感。 */
  .we-layer:has(.we-live-iframe.we-live-on) .we-live-poster {
    opacity: 0;
    transition: opacity 0.3s ease 1.8s;
  }
  .we-layer .we-live-iframe {
    position: absolute; inset: 0; width: 100%; height: 100%;
    background: transparent;
    opacity: calc(var(--we-wallpaper-opacity, 1) * var(--we-live-fade, 0));
    transition: opacity 1.8s ease;
  }
  .we-layer .we-live-iframe.we-live-on { --we-live-fade: 1; }

  /* 切换过场（手动点选与自动轮播共用）：
     - staging：live 渲染页预载驻留层 —— opacity 0 但 in-DOM 且几何满视口，
       渲染页按正常分辨率初始化出首帧，就绪后 iframe 被移动进正式层；
     - switch：入场层的初态/终态由 startLayerTransition 用内联样式写入（每种过场
       的初态见 switchFrames），这里只提供**一条通用 transition**：transform /
       opacity / clip-path 都是合成器友好属性（mask/filter 在 <video> 与 live
       <iframe> 上会掉出合成层，故不用）。时长由内联 --we-switch-ms 决定
       （= 类型基准 × 速度档，见 SWITCH_TRANSITIONS / SWITCH_SPEEDS）。
     - switch-out：退场层（旧壁画）；只有需要它同时动起来的过场（推移 / 缩放）
       才会加这个类 —— 其余过场旧层保持不透明静止，垫在新层之下（玻璃
       backdrop-filter 依赖这层不透明背景，所以没有任何过场让中间态透明）。 */
  .we-layer--staging { opacity: 0; }
  /* 切层内容闸门：新层还没有画面时先不参与绘制（见 src/live-layer.js 的切层内容闸门），
     屏上留给旧层的像素。画面到位后这一类被摘掉（过场那条路由 startLayerTransition
     重写 className 完成同一件事）。与 --staging 的区别是"已经在文档里、只是先不画"。 */
  .we-layer--pending { opacity: 0; }
  .we-layer--switch {
    transition:
      transform var(--we-switch-ms, 700ms) var(--we-switch-ease, cubic-bezier(0.22, 0.61, 0.36, 1)),
      opacity var(--we-switch-ms, 700ms) var(--we-switch-ease, cubic-bezier(0.22, 0.61, 0.36, 1)),
      clip-path var(--we-switch-ms, 700ms) var(--we-switch-ease, cubic-bezier(0.22, 0.61, 0.36, 1));
    will-change: transform, opacity, clip-path;
  }
  /* 减少动态效果偏好：过场一律退化成即时切换（不覆盖用户选择，只是把动画关掉）。 */
  @media (prefers-reduced-motion: reduce) {
    .we-layer--switch { transition: none !important; }
  }
  /* 可见性恢复后的**一次性**复合成微推（见 src/live-layer.js 的 nudgeWallpaperRepaint）：
     只在这两帧里把壁纸层提成独立合成层，随后立刻撤掉 —— 让合成器重新提交这一层的像素，
     又不留常驻合成层（常驻一个 always-on 合成层正是本仓刻意避开的东西）。
     状态切换（最小化 → 还原）后屏上仍是白/旧帧时才由 JS 加上；层几何不变（整屏、fixed），
     提升只影响提交路径。 */
  .we-layer--repaint { will-change: transform; transform: translateZ(0); }

  /* Scrim: sits ABOVE the wallpaper (z-index -1 > -2, so it never depends on
     DOM insertion order — the wallpaper element is re-appended on wallpaper
     switch and could otherwise slide above the scrim). Below the UI. */
  .we-scrim {
    position: fixed; inset: 0; z-index: -1;
    pointer-events: none;
    /* 同 .we-layer：整屏 body 级浮层会把窗口可拖区整片挖掉（upstream #120）。
       必须 initial（不是 none）—— 见 .we-layer 上方那段注释。 */
    -webkit-app-region: initial !important;
    background: var(--we-scrim-color, rgba(0, 0, 0, 0.25));
  }

  /* While a wallpaper is active: make the app frame AND sidebar transparent so
     all columns share the same wallpaper+scrim background. 这两条**只**属于壁纸：
     壁纸层挂在 body 的 z-index:-1 上，页面基色 / 侧栏填充必须让开才看得见。
     无壁纸时它们保持宿主原色 —— 页面因此始终有一层不透明基色（玻璃面压在这层之上）。 */
  body[data-we-wallpaper] {
    --dsw-alias-bg-base: transparent;
    --dsw-specific-sidebar-fill: transparent;
  }

  /* ── 页面玻璃总锚点（data-we-glass-page）——**与有没有壁纸无关** ───────────────
     由 src/glass.js 恒挂（插件启用即挂，与 data-we-glass-chat / -window / -floaters
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
       同属下面「markdown 代码块 / 行内代码」那段映射 —— 裁定档案 harness-ui-surfaces.json 同源。 */
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
  }
  /* DSH rc.7+ injects the theme palette (design-platform.css) as a plugin-owned
     stylesheet appended to <head> AFTER this one, so in dark mode the shell's
     body[data-ds-dark-theme] rules (equal specificity 0,1,1, later in the
     document) win the cascade and repaint the app frame / sidebar / borders
     with their opaque dark colors — hiding the wallpaper behind them. Repeat
     the transparency + border-emphasis overrides under the higher-specificity
     dark selector (0,2,1) so the wallpaper always wins regardless of stylesheet
     order. */
  body[data-ds-dark-theme][data-we-wallpaper] {
    --dsw-alias-bg-base: transparent;
    --dsw-specific-sidebar-fill: transparent;
  }
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

  /* ── Light-scheme text contrast boost ──────────────────────────────────────
     In light mode the grays (tertiary/caption/secondary) were tuned against a
     near-white page. Over a busy wallpaper + light scrim they lose contrast, so
     push the whole gray ramp darker while a wallpaper is active. Primary text
     is already near-black; we still pin it to pure black for max legibility.
     (Dark mode is untouched: its white-on-dark text already reads fine.) */
  body[data-we-wallpaper]:not([data-ds-dark-theme]) {
    --dsw-alias-label-primary: rgb(0, 0, 0);
    --dsw-alias-label-primary-dimmed: rgb(10, 10, 12);
    --dsw-alias-label-secondary: rgb(40, 42, 46);
    --dsw-alias-label-tertiary: rgb(70, 73, 79);
    --dsw-alias-label-caption: rgb(110, 114, 120);
    --dsw-alias-label-dimmed: rgb(50, 52, 56);
  }

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
  /* 插件自己的「不透明面板色」(solid panel colour)：宿主别名 --dsw-alias-bg-layer-*
     会被**改写成玻璃配方**（见上面 body[data-we-glass-page] 的令牌映射；壁纸不在场时
     也生效），
     但有几块面必须保持近不透明才对 —— 编辑器/终端的固定语法与 ANSI 配色、没有
     backdrop-filter 的插件模态框、壁纸层的垫底画面（垫底不能透明，见 buildLivePoster）。
     它们改读这个令牌，从而与别名映射解耦。取值直接取宿主静态调色板里**别名本身的来源**
     （浅色 neutral-bluish-00 / 深色 neutral-bluish-875），静态令牌缺席时退回字面量。 */
  /* 染色地板：--we-readability-base 是玻璃色经亮度钳制后的按主题版本
     （effects.js 的 weClampSurfaceColor 计算、--we-surface-tint-* 注入）
     —— 色相跟随用户选择，亮度钳制保住 #82 的 ≥4.5:1 正文判据。缺省回落原值。
     玻璃保真度（glassFidelity，默认 100）：--we-readability-floor = floor 常量
     × --we-glass-fidelity（effects.js 注入 0–1，缺省 1 = 现状、任何旧设置文件
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
    --we-panel-color: var(--dsw-static-neutral-bluish-00, #ffffff);
  }
  body[data-ds-dark-theme] {
    --we-readability-floor-base: ${READABILITY_FLOOR_DARK};
    --we-readability-floor: calc(var(--we-readability-floor-base) * var(--we-glass-fidelity, 1));
    --we-readability-base: var(--we-surface-tint-dark, #0d1524);
    --we-chat-readability-floor: calc(var(--we-readability-floor-base) * var(--we-chat-glass-fidelity, 1));
    --we-chat-readability-base: var(--we-chat-surface-tint-dark, #0d1524);
    --we-follow-tint: var(--we-surface-tint-dark, #0d1524);
    --we-panel-sheen-a: 0.07; --we-panel-sheen-b: 0.02; --we-panel-sheen-c: 0.03;
    --we-panel-color: var(--dsw-static-neutral-bluish-875, #1e1f26);
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
       底色；浅色下取更暗一级的静态中性色，抵掉混色带来的提亮。 */
    --dsw-alias-scrollbar-bg-l1: color-mix(in srgb, var(--we-surface-tint-light, #ffffff) 40%, var(--dsw-static-neutral-300, #d4d4d4));
    --dsw-alias-scrollbar-bg-l2: color-mix(in srgb, var(--we-surface-tint-light, #ffffff) 40%, var(--dsw-static-neutral-300, #d4d4d4));
    --dsw-alias-scrollbar-hover-l1: color-mix(in srgb, var(--we-surface-tint-light, #ffffff) 40%, var(--dsw-static-neutral-400, #a2a4a6));
    --dsw-alias-scrollbar-hover-l2: color-mix(in srgb, var(--we-surface-tint-light, #ffffff) 40%, var(--dsw-static-neutral-400, #a2a4a6));
  }
  body[data-ds-dark-theme][data-we-glass-page] {
    --we-chat-glass-fill: rgba(var(--we-surface-tint-rgb-dark, 13, 21, 36), var(--we-glass-alpha, 0.15));
    --we-tool-glass-fill: rgba(var(--we-surface-tint-rgb-dark, 13, 21, 36), calc(var(--we-glass-alpha, 0.15) + 0.06));
    /* 滚动条（#157）：暗主题宿主取 neutral-700/600（静态）与 600/550（悬停），混色会把整体
       压暗，所以每档都往亮一级取，混完仍落在宿主原来的亮度台阶上（宿主 l2 与 hover-l1 同值，
       这里同样同值）。 */
    --dsw-alias-scrollbar-bg-l1: color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) 40%, var(--dsw-static-neutral-600, #545557));
    --dsw-alias-scrollbar-bg-l2: color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) 40%, var(--dsw-static-neutral-500, #7f8287));
    --dsw-alias-scrollbar-hover-l1: color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) 40%, var(--dsw-static-neutral-500, #7f8287));
    --dsw-alias-scrollbar-hover-l2: color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) 40%, var(--dsw-static-neutral-400, #a2a4a6));
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
     ⇒ **本文件所有 [class*="_bubble"] 规则都必须带这道豁免**（当前 :613 / :622 / :945 / :3166 四条），
     守卫：verify-readability「F2dN 每条 _bubble 规则都必须带 role="tooltip" 豁免」—— §11 A1-4：
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
  /* September 24 inline capsules: ten-percent white mist and independent 8px frost.
     Host padding/radius and text colour stay intact; fences are excluded. */
  body[data-we-glass-page][data-we-thinking-glass] [data-chat-flow] :not(pre) > code,
  body[data-we-glass-page][data-we-thinking-glass] [data-vcp-rawhtml] :not(pre) > code {
    background: var(--dsw-alias-markdown-inline-code) !important;
    background-image: none !important;
    -webkit-backdrop-filter: blur(var(--we-inline-code-blur, 8px)) saturate(var(--we-saturate, 1.3)) brightness(var(--we-glass-brightness, 1.04));
    backdrop-filter: blur(var(--we-inline-code-blur, 8px)) saturate(var(--we-saturate, 1.3)) brightness(var(--we-glass-brightness, 1.04));
    border-color: rgba(255, 255, 255, 0.14) !important;
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

     ── 修正（issue #131）：fixed 包含块 ─────────────────────────────────────
     CSS 规范：非 none 的 backdrop-filter 会让该元素成为**其后代 position:fixed 元素的
     包含块**。宿主在 Windows 标题栏模式下把「收起 / 展开侧边栏」按钮与收起态的「新建会话」
     按钮设成 position:fixed ⇒ 若 blur 画在列自身，它们改为相对这一列定位（列上边被
     [data-windows-titlebar] 的 padding-top 推下去，收起时列宽 0 又带 overflow:hidden）
     ⇒ 按钮被整块裁掉、展开按钮「不可见」。
     修法：玻璃配方里**只把 backdrop-filter 那一对声明**搬到本列的 ::before（伪元素没有
     后代，永不成为 fixed 的包含块），列自身加 position:relative（只影响 absolute 的包含块
     选择）与 z-index:0（把 ::before 的 z-index:-1 圈在列内）。
     底色 / 釉光 / 边框 / 令牌留在列上：模糊作用在「底色 + 壁纸」的合成结果上，与「先滤
     壁纸再压底色」数学等价（模糊与滤镜都是线性算子，而这一列底色是中性色）。 */
  body[data-we-glass-page][data-we-left-sidebar] div:has(> [data-slot="sidebar"]) {
    position: relative; /* 只为给下面 ::before 那条规则提供定位参照（不影响 fixed） */
    z-index: 0; /* 把 ::before 的 z-index:-1 圈在这一列内部 */
    background-color: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-light, #ffffff) calc(var(--we-left-sidebar-alpha) * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    /* 顶层白光釉：与设置窗口同一道镜面渐变。它同时**顶掉**壳层 darwin 那条
       「淡蓝渐变 + fill 混色」的左栏背景（background-image 是同一长属性）。 */
    background-image: linear-gradient(180deg,
      rgba(255, 255, 255, var(--we-panel-sheen-a)) 0%,
      rgba(255, 255, 255, var(--we-panel-sheen-b)) 38%,
      rgba(255, 255, 255, var(--we-panel-sheen-c)) 100%);
    /* 模糊不在这里：backdrop-filter 会把这列变成 fixed 后代的包含块（见上），
       已移交给本列 ::before 的那条规则。 */
    /* 边框：这一列**内部**的描边（「新建会话」按钮、焦点环等）读 --dsw-alias-border-l3 ——
       壁纸令牌映射只接管了 l1/l2，故「边框」滑杆只作用于这一列里面的描边（这一条**保留**）。
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
  /* 玻璃的模糊层（issue #131）：::before 铺满这一列、压在内容之下（z-index:-1，父级
     z-index:0 把它圈在列内），只负责 backdrop-filter。它没有后代 ⇒ 不会成为任何
     fixed 元素的包含块，宿主那两个 fixed 按钮（收起/展开侧边栏、收起态新建会话）于是
     继续相对视口定位。深浅两色共用这一条（模糊配方本身不随主题分叉）。 */
  body[data-we-glass-page][data-we-left-sidebar] div:has(> [data-slot="sidebar"])::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    -webkit-backdrop-filter: blur(var(--we-left-sidebar-blur)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
    backdrop-filter: blur(var(--we-left-sidebar-blur)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
  }
  /* 深色：同一张表、同一组层权重，只有玻璃色缺省与高亮mix 不同（与设置窗口深色那条同形）。 */
  body[data-ds-dark-theme][data-we-glass-page][data-we-left-sidebar] div:has(> [data-slot="sidebar"]) {
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
    body[data-we-glass-page][data-we-left-sidebar] div:has(> [data-slot="sidebar"]) {
      background-color: color-mix(in srgb, var(--we-surface-tint-light, #ffffff) 92%, transparent);
      background-image: none;
    }
    body[data-ds-dark-theme][data-we-glass-page][data-we-left-sidebar] div:has(> [data-slot="sidebar"]) {
      background-color: color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) 92%, transparent);
    }
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
     ⚠️ **锚点只用一条**：保留的 div[class*="pI_x6G_frame"] 是 CSS 模块哈希类名的**子串**
        匹配（哈希跨版本会漂，漂了的最坏结果是"本块不生效"，失败安全、绝不误伤；运行时实测
        n1=1 / n3=1）。两条硬门是 [data-windows-titlebar]（壳层写进 <html>，只在 Windows
        Electron 形态；实测 winTB=1）与 body[data-we-adapter^="desktop-"]（本插件自己挂；
        实测 ad=desktop-official）。教训两条：
        ⇒ 结论一：**绝不把"未经本引擎验证的选择器"与"已验证的"放进同一个逗号列表** —— CSS
          选择器列表一损俱损（一个不被接受，整条规则连同能命中的一起被丢弃，表现为"变量全对、
          背景与模糊都没算出来"，与"锚点没选对"的现象完全一样，极易误判）；要并存必须拆成
          两条独立规则（一条失效只丢它自己）。
        ⇒ 结论二：**嵌套 :has()**（:has() 里再套 :has()）本壳层的 Chromium 不接受（会抛异常）；
          左栏那条能用是因为它是**单层** :has(> [data-slot="sidebar"]) —— 别把左栏的经验外推。
        哈希漂移的兜底将来若要加，必须**另起一条规则**，不得并进逗号列表。
     ⚠️ **本块的结构分工**：底色 / 釉光 / accent 在下面这条 ::before；模糊在紧随其后的
        ::after —— 为什么必须分两层、绘制顺序、以及 issue #131 的 fixed 包含块，见那条规则的注释。
     ⚠️ **"不要有任何色差"是本块的第一约束**：底色的 color-mix 权重与五条 accent 映射与左侧栏
        **逐字相同**（判据 TB4）。釉光**刻意不同**（判据 TB4a）—— 停靠点是百分比，装进两个高度差
        27.8 倍的盒子会算出不同值，见 ::before 那条注释。两面都**不画分割线**（本面判据 TB6，
        左栏判据 S2）。⚠️ 任何调色改动都必须**同时**改这两块，否则色差立刻出现。
     ⚠️ **可覆盖性**：本块用 !important —— 壳层那条 :before 声明同特异度但写在别的样式表里，
        靠加载顺序取胜不可靠；伪元素只此一层，覆盖它没有副作用。 */
  html[data-windows-titlebar] body[data-we-glass-page][data-we-titlebar-glass][data-we-adapter^="desktop-"] div[class*="pI_x6G_frame"]::before {
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
  html[data-windows-titlebar] body[data-we-glass-page][data-we-titlebar-glass][data-we-adapter^="desktop-"] div[class*="pI_x6G_frame"]::after {
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
  html[data-windows-titlebar] body[data-ds-dark-theme][data-we-glass-page][data-we-titlebar-glass][data-we-adapter^="desktop-"] div[class*="pI_x6G_frame"]::before {
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
    html[data-windows-titlebar] body[data-we-glass-page][data-we-titlebar-glass][data-we-adapter^="desktop-"] div[class*="pI_x6G_frame"]::before {
      background: color-mix(in srgb, var(--we-surface-tint-light, #ffffff) 92%, transparent) !important;
    }
    html[data-windows-titlebar] body[data-ds-dark-theme][data-we-glass-page][data-we-titlebar-glass][data-we-adapter^="desktop-"] div[class*="pI_x6G_frame"]::before {
      background: color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) 92%, transparent) !important;
    }
    /* 模糊层整个不存在：本档不支持 backdrop-filter，留着 ::after 只会多一层
       什么都画不出来的绝对定位块（含 pointer-events:none 的空层）。 */
    html[data-windows-titlebar] body[data-we-glass-page][data-we-titlebar-glass][data-we-adapter^="desktop-"] div[class*="pI_x6G_frame"]::after {
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
  body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_boundaryError"],
  body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_panel"] {
    /* 侧栏面板同样承载文字 → 同一层可读性下限（--we-sidebar-tint 是这里的
       玻璃色权重，只在另一项上生效）。 */
    background-color: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-sidebar-color) var(--we-sidebar-tint), transparent) calc((1 - var(--we-readability-floor)) * 100%)) !important;
    /* Specular sheen + refraction highlights follow --we-sidebar-sheen
       (= min(1, alpha/0.2236)): at default (12%) and any MORE solid setting
       the sheen keeps the ORIGINAL design strength (0.14/0.04/0.01,
       0.32/0.08/0.06); only toward transparency does the white glaze fade,
       so 100% is truly near-transparent instead of pale white. */
    background-image: linear-gradient(180deg,
      rgba(255, 255, 255, var(--we-sidebar-sheen-a)),
      rgba(255, 255, 255, var(--we-sidebar-sheen-b)) 38%,
      rgba(255, 255, 255, var(--we-sidebar-sheen-c))) !important;
    -webkit-backdrop-filter: blur(var(--we-sidebar-blur)) saturate(var(--we-sidebar-saturate)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01) !important;
    backdrop-filter: blur(var(--we-sidebar-blur)) saturate(var(--we-sidebar-saturate)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01) !important;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, calc(var(--we-sidebar-sheen) * 0.32)),
      inset 0 -1px 0 rgba(255, 255, 255, calc(var(--we-sidebar-sheen) * 0.08)),
      inset 0 0 0 0.5px rgba(255, 255, 255, calc(var(--we-sidebar-sheen) * 0.06));
  }
  body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_pane"],
  body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_tabBar"],
  body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_paneCard"],
  body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_editorHeader"],
  body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_explorerHeader"],
  body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_gitHeader"],
  body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_browserBar"],
  body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_terminalWrap"] {
    background-color: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-sidebar-color) calc(var(--we-sidebar-tint) * 0.75), transparent) calc((1 - var(--we-readability-floor)) * 100%)) !important;
  }
  body[data-ds-dark-theme][data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_boundaryError"],
  body[data-ds-dark-theme][data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_panel"] {
    background-color: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-sidebar-color) calc(var(--we-sidebar-tint) * 0.65), transparent) calc((1 - var(--we-readability-floor)) * 100%)) !important;
  }
  body[data-ds-dark-theme][data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_pane"],
  body[data-ds-dark-theme][data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_tabBar"],
  body[data-ds-dark-theme][data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_paneCard"],
  body[data-ds-dark-theme][data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_editorHeader"],
  body[data-ds-dark-theme][data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_explorerHeader"],
  body[data-ds-dark-theme][data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_gitHeader"],
  body[data-ds-dark-theme][data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_browserBar"],
  body[data-ds-dark-theme][data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_terminalWrap"] {
    background-color: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-sidebar-color) calc(var(--we-sidebar-tint) * 0.5), transparent) calc((1 - var(--we-readability-floor)) * 100%)) !important;
  }
  /* No backdrop-filter support: fall back to near-opaque tinted surfaces so
     sidebar text never sits directly on a busy wallpaper (same policy as the
     settings-window glass). The tint still applies. */
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_boundaryError"],
    body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_panel"],
    body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_pane"],
    body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_tabBar"],
    body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_paneCard"],
    body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_editorHeader"],
    body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_explorerHeader"],
    body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_gitHeader"],
    body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_browserBar"],
    body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_terminalWrap"] {
      background-color: color-mix(in srgb, var(--we-sidebar-color) 92%, transparent) !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }
  }

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
  body[data-we-sidebar-glass] [data-sidebar-right-panel][data-sidebar-right-open] {
    background-color: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-sidebar-color) var(--we-sidebar-tint), transparent) calc((1 - var(--we-readability-floor)) * 100%)) !important;
    background-image: linear-gradient(180deg,
      rgba(255, 255, 255, var(--we-sidebar-sheen-a)),
      rgba(255, 255, 255, var(--we-sidebar-sheen-b)) 38%,
      rgba(255, 255, 255, var(--we-sidebar-sheen-c))) !important;
    -webkit-backdrop-filter: blur(var(--we-sidebar-blur)) saturate(var(--we-sidebar-saturate)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01) !important;
    backdrop-filter: blur(var(--we-sidebar-blur)) saturate(var(--we-sidebar-saturate)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01) !important;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, calc(var(--we-sidebar-sheen) * 0.32)),
      inset 0 -1px 0 rgba(255, 255, 255, calc(var(--we-sidebar-sheen) * 0.08)),
      inset 0 0 0 0.5px rgba(255, 255, 255, calc(var(--we-sidebar-sheen) * 0.06));
    z-index: var(--dsh-dockkit-dock-layer, 10);
  }
  body[data-ds-dark-theme][data-we-sidebar-glass] [data-sidebar-right-panel][data-sidebar-right-open] {
    background-color: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-sidebar-color) calc(var(--we-sidebar-tint) * 0.65), transparent) calc((1 - var(--we-readability-floor)) * 100%)) !important;
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
    body[data-we-sidebar-glass] [data-sidebar-right-panel][data-sidebar-right-open] {
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
  body[data-we-sidebar-glass] [data-dsh-better-sidebar] .cm-editor,
  body[data-we-sidebar-glass] [data-dsh-better-sidebar] .xterm,
  body[data-we-sidebar-glass] [data-sidebar-right-panel][data-sidebar-right-open] .cm-editor,
  body[data-we-sidebar-glass] [data-sidebar-right-panel][data-sidebar-right-open] .xterm {
    background-color: color-mix(in srgb, var(--we-content-surface-color, var(--we-panel-color, #1e1f26)) max(calc(var(--we-readability-floor) * 100%), var(--we-content-surface-alpha, 88%)), transparent) !important;
  }

  /* Picker chrome. */
  .we-picker {
    display: flex; flex-direction: column; gap: 14px;
    /* issue #127：设置窗整窗规则把 --we-accent 掐成 initial（不泄漏给窗内第三方
       分区）—— 我们的 picker 子树在这里从 body 的原件重新别名，消费面不变。 */
    --we-accent: var(--we-accent-src, #4f8cff);
    /* ── 统一控件 token：一套高度/圆角/墨色词汇贯穿全部控件 ──
       墨色走宿主主题 token（明暗主题都可读），强调色只用于选中态/激活态。 */
    --we-ui-h: 30px;
    --we-ui-radius: 8px;
    --we-ink: var(--dsw-alias-label-primary, inherit);
    --we-ink-2: var(--dsw-alias-label-secondary, rgba(128, 128, 128, 0.9));
    --we-ink-3: var(--dsw-alias-label-tertiary, rgba(128, 128, 128, 0.65));
  }
  .we-picker__select { max-width: 100%; }
  .we-picker__row { display: flex; gap: 8px; align-items: center; }
  /* 抽帧转码下载/转码进度条. */
  .we-picker__prog { gap: 8px; }
  .we-picker__prog-track {
    flex: 1; min-width: 0; height: 5px; border-radius: 3px;
    background: rgba(128, 128, 128, 0.3);
    overflow: hidden;
  }
  .we-picker__prog-bar {
    height: 100%; border-radius: 3px;
    background: var(--we-accent, #4f8cff);
    transition: width 0.4s ease;
  }
  /* First-level settings section wrapper (mirrors the skin-center's
     sectionList): the ul/li carry no default list styling. */
  .we-picker__section-list { margin: 0; padding: 0; list-style: none; }

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
  body[data-we-glass-window] [role="dialog"]:has([data-slot="settings.section"]) {
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
  /* Dark scheme: deep translucent base instead of white. The default glass
     color is deep navy; a user-picked 玻璃颜色 overrides it in both themes. */
  body[data-ds-dark-theme][data-we-glass-window] [role="dialog"]:has([data-slot="settings.section"]) {
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
    body[data-we-glass-window] [role="dialog"]:has([data-slot="settings.section"]) {
      --dsw-alias-bg-layer-1: var(--we-surface-tint-light, #ffffff);
      --dsw-alias-bg-layer-2: var(--we-surface-tint-light, #ffffff);
      --dsw-alias-bg-layer-3: var(--we-surface-tint-light, #ffffff);
    }
    body[data-ds-dark-theme][data-we-glass-window] [role="dialog"]:has([data-slot="settings.section"]) {
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
     模糊半径读「浮层玻璃」这条子项的私有量 --we-floaters-blur（src/glass.js:279 无条件接线，
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

  /* Section wrapper：融合官方设置页（官方分区没有外壳卡），内容直接落在设置对话框的面层上。
     注意类名与 DOM 结构是**契约**，守卫按结构断言 —— 拍平的是外观，不是这层壳的存在。 */
  .we-picker__card-shell { display: block; }
  /* Card header: name + count badge + description (mirrors skin-center). */
  .we-picker__card-head {
    display: flex; align-items: baseline; gap: 8px;
    padding-bottom: 10px; border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.22));
  }
  .we-picker__card-name {
    font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary, inherit);
  }
  .we-picker__card-badge {
    font-size: 11px; font-weight: 500; color: var(--dsw-alias-label-secondary, #6b7280);
  }
  .we-picker__card-desc {
    margin-left: auto; font-size: 12px; color: var(--dsw-alias-label-tertiary, #6b7280);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  /* 配色 swatches: circular preset buttons + native color picker. The active
     swatch gets an accent ring so the current choice is obvious at a glance. */
  /* ── DSH harness corner-shape 兼容（Issue #74）─────────────────────────────
     harness 的主题层给 * / ::before / ::after 统一加了
     corner-shape: superellipse(1.5)（方圆形角，@supports 包裹）。任何
     border-radius 圆形都会被渲染成圆角矩形——色板、黑胶唱片、滑杆圆点、
     开关滑块全部中招。这里对插件画的所有正圆/胶囊控件显式重置回
     corner-shape: round；harness 的规则是 * 选择器（特异度 0），类选择器
     天然胜出，无需 !important。不支持该属性的 harness 会忽略本声明。
     注意：::-moz-* 是 Firefox 专用伪元素，Chromium 视为非法选择器，而选择器
     列表中只要有一个非法项整条规则就会作废——因此 moz 伪元素必须单独成条。 */
  .we-picker__swatch,
  .we-picker__swatch--auto,
  .we-picker__swatch-custom input[type="color"],
  .we-picker__swatch-custom input[type="color"]::-webkit-color-swatch,
  .we-vinyl,
  .we-vinyl__cover,
  .we-vinyl__hole,
  .we-picker__slider::-webkit-slider-thumb,
  .we-picker__switch-thumb,
  .we-picker__switch-track,
  .we-picker__value {
    corner-shape: round;
  }
  .we-picker__slider::-moz-range-thumb { corner-shape: round; }
  .we-picker__accent-row { flex-wrap: wrap; }
  .we-picker__swatch {
    width: 22px; height: 22px; padding: 0; border-radius: 50%;
    border: 0;
    /* 内圈发丝环让深色圆点在浅玻璃上也有边界；去外描边、留给选中态。 */
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.55), 0 1px 3px rgba(0, 0, 0, 0.35);
    cursor: pointer;
    transition: transform var(--we-dur-fast, 120ms) var(--we-ease, ease), box-shadow var(--we-dur-fast, 120ms) var(--we-ease, ease);
  }
  .we-picker__swatch:hover { transform: scale(1.12); }
  .we-picker__swatch--active {
    /* 双环选中态：表面色间隔环 + accent 外环，比裸描边读得更清。 */
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.55),
      0 0 0 2px var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.2)),
      0 0 0 4px var(--we-accent, #4f8cff);
  }
  /* "跟随主题" auto swatch (内容面底色): no fill, split ring showing both
     themes so it reads as "use the theme panel color". */
  .we-picker__swatch--auto {
    font-size: 10px; line-height: 1; font-weight: 600;
    color: var(--dsw-alias-label-secondary, #666);
    background: linear-gradient(135deg, #2a2d35 0 50%, #f2f3f5 50% 100%);
    display: inline-flex; align-items: center; justify-content: center;
  }
  .we-picker__swatch-custom {
    display: inline-flex; align-items: center; gap: 4px; cursor: pointer;
  }
  .we-picker__swatch-custom input[type="color"] {
    width: 22px; height: 22px; padding: 0; border: 0; border-radius: 50%;
    background: transparent; cursor: pointer;
  }
  .we-picker__swatch-custom input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
  .we-picker__swatch-custom input[type="color"]::-webkit-color-swatch { border: 1px solid rgba(255, 255, 255, 0.6); border-radius: 50%; }

  /* 字体配置矩阵：把「字号 / 字重 / 字体」提到表头，一行一个角色/组件。
     三类控件固定在列上对齐，比每行重复三个无标签控件好扫读；
     th 用小字弱化色（--we-host-* 是宿主角色色快照，取不到时有兜底）。 */
  .we-picker__font-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 4px;
  }
  .we-picker__font-table th {
    font-weight: 400;
    text-align: left;
    padding: 4px 4px;
    font-size: 12px;
    color: var(--we-host-dsw-alias-label-tertiary, rgba(128, 128, 128, 0.75));
  }
  .we-picker__font-table td {
    padding: 2px 4px;
    vertical-align: middle;
  }
  /* 删除的"待确认"独占一行（跨两列）：问句在左、按钮在右，且**不改变上面那一行的宽度**。 */
  .we-picker__font-table .we-picker__fontset-confirm td {
    padding: 0 4px 6px;
  }
  .we-picker__font-table .we-picker__fontset-confirm .we-picker__hint {
    margin-right: 8px;
  }
  /* ── 预设方案：两行四列的圆角表格（用户口径）──────────────────────────────
     容器 = 圆角描边"表格"；每格 = 预设名（点击应用，占满）+ 右侧固定删除键。
     空位画成虚框占位 —— 上限 8（2×4）直接看得见。纯布局规则，不碰玻璃令牌。 */
  .we-picker__preset-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
    margin-top: 4px;
    padding: 6px;
    border: 1px solid var(--we-host-dsw-alias-label-tertiary, rgba(128, 128, 128, 0.28));
    border-radius: 10px;
  }
  .we-picker__preset-cell {
    display: flex;
    align-items: stretch;
    gap: 2px;
    min-width: 0;
  }
  .we-picker__preset-cell--armed {
    outline: 1px solid var(--we-host-dsw-alias-label-tertiary, rgba(128, 128, 128, 0.45));
    outline-offset: 1px;
    border-radius: 6px;
  }
  /* ⚠️ 故意用元素选择器而不是按钮类复合选择器：verify-fontset 的按钮盒完整性
     判据按"第一处按钮类规则"锚定，复合覆盖规则会抢到锚点（它只带布局增量、
     没有盒子全家桶）⇒ 判据当场假红。 */
  .we-picker__preset-cell > button {
    flex: 1;
    min-width: 0;
    justify-content: flex-start;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .we-picker__preset-cell > .we-picker__preset-del {
    flex: 0 0 auto;
  }
  .we-picker__preset-cell--empty {
    align-items: center;
    justify-content: center;
    border: 1px dashed var(--we-host-dsw-alias-label-tertiary, rgba(128, 128, 128, 0.30));
    border-radius: 6px;
    min-height: 26px;
  }
  .we-picker__preset-cell--empty .we-picker__hint {
    font-size: 11px;
  }
  /* 数字框按内容收纳：面板基础样式给 input 的左右内边距在这里制造了明显的空占位。 */
  .we-picker__font-table input[type="number"] {
    padding-left: 3px;
    padding-right: 3px;
  }
  /* 第 2 列起（字号/字重/字体）**按内容收缩**（width:1% + nowrap 是经典写法），
     余量全部归首列。否则 table{width:100%} 会把三列均匀拉宽，控件之间空出一大片。 */
  .we-picker__font-table th:nth-child(n + 2),
  .we-picker__font-table td:nth-child(n + 2) {
    width: 1%;
    white-space: nowrap;
  }
  /* 主开关说明已收进行内一句话 + tooltip（见 we-picker__ctl-hint）。 */

  /* Pagination bar under each paged grid (normal / hidden / group editor).
     Horizontally centered; as a direct child of the flex modal body it sinks
     to the bottom when the grid leaves free space (margin-top: auto). */
  .we-picker__pager {
    display: flex; gap: 10px; align-items: center; justify-content: center;
    margin-top: auto; padding-top: 8px; flex-wrap: wrap;
  }
  .we-picker__playlist-select { flex: 1; min-width: 0; }
  .we-picker__filter-row { flex-wrap: wrap; flex-shrink: 0; }
  .we-picker__filter-row .we-picker__playlist-select { flex: 1 1 130px; }
  .we-picker__rotation-interval { margin-left: auto; }
  /* Flat, uniform-height controls. Native <select> renders as a raised "3D"
     OS widget whose height can shift a pixel on hover; inside tightly packed
     rows that squeezes the neighbours and, with the cursor near a row edge,
     oscillates (hover → grow → shift → unhover → shrink → …). Strip the
     native chrome and PIN the height so no control's intrinsic size can move
     a row. */
  .we-picker__btn {
    /* 这枚类同时挂在 <button> 与 <a> 上（导出是普通链接，D2）。两种元素的 UA 默认不同，
       只写 height/padding 会让它们长得不一样 —— 四处差异逐条钉住：
         · display：<a> 默认 inline，而**行内盒忽略 height** ⇒ 那句 30px 对它无效；
           <button> 默认 inline-block。⇒ 两者都显式 inline-flex，居中也不再靠 line-height 猜。
         · box-sizing：<button> 默认 border-box、<a> 默认 content-box（同高差 2px 边框）。
         · font：<button> **不继承**字体（用 UA 自己那套），<a> 继承 ⇒ 同字号不同字体、宽度也不同。
         · text-decoration：<a> 默认带下划线。 */
    display: inline-flex; align-items: center; justify-content: center; vertical-align: middle;
    box-sizing: border-box; height: var(--we-ui-h, 30px); padding: 0 12px;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
    border-radius: var(--we-ui-radius, 8px); background: transparent;
    color: var(--we-ink, inherit); font: inherit; font-size: 0.82em; line-height: 1;
    text-decoration: none; white-space: nowrap; cursor: pointer;
  }
  }
  .we-picker__btn:hover { background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.12)); }
  .we-picker__btn:disabled { opacity: 0.45; cursor: default; }
  /* 音乐开关处于「开」时用 accent 色描边，一眼可辨但不抢主按钮。 */
  .we-picker__btn.is-on {
    border-color: var(--we-accent, var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35)));
    color: var(--we-accent, inherit);
  }
  .we-picker select {
    appearance: none; -webkit-appearance: none;
    height: var(--we-ui-h, 30px); padding: 0 8px;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
    border-radius: var(--we-ui-radius, 8px); background: transparent;
    color: var(--we-ink, inherit); font-size: 0.82em;
    cursor: pointer;
  }
  .we-picker select:hover { background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.12)); }
  .we-picker select:disabled { opacity: 0.45; cursor: default; }
  /* ── 原生下拉的弹层选项行必须显式上不透明底 + 玻璃墨色（用户报告：下拉全是「底色与
     字同色」）──Chromium 的弹层是一份独立文档：画布只在 select 自身背景**不透明**时才取
     它的底色，而我们的 select 是透明玻璃底 ⇒ 弹层落到默认**浅色**画布；选项文字却继承
     select 的玻璃墨色（深色主题=浅字）⇒ 浅字落浅底，整列不可读。修法 = 给 option 行
     显式上 --we-panel-color（不透明面板底，随主题翻转）+ --we-ink；Chromium 弹层按
     option 的**已解析**计算样式逐行绘制（var 在页面内已解析，弹层文档照抄结果），明暗
     两主题都对。作用域同时钉类名（.we-picker__select —— 侧栏/抽屉的 select 不在
     .we-picker 子树内，靠类名够到）与后代选择器（设置窗内一切 select，含属性面板）。 */
  .we-picker select option, .we-picker__select option {
    background-color: var(--we-panel-color, #ffffff);
    color: var(--we-ink, #1f2328);
  }
  .we-picker__hint { font-size: 0.8em; color: var(--we-ink-3, rgba(128, 128, 128, 0.75)); }
  /* 「当前壁纸实时帧」微缩预览：就是切换途中 / live 首帧前显示的那张静帧。
     固定 16:9 小图 + 细边框，居中放在控件行里（行已 --wrap，窄面板会自动折行）。 */
  .we-picker__frame-shot {
    display: block; width: 168px; height: 94.5px; object-fit: cover;
    border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.28));
    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.1));
  }
  /* 数字读数等宽：页码 / 计数 / fps / 百分比切换时不再跳动。 */
  .we-picker__pager .we-picker__hint, .we-picker__card-badge, .we-picker__value {
    font-variant-numeric: tabular-nums;
  }
  /* 统一焦点环：accent 色、2px、外偏移（a11y + 跟随配色）。 */
  .we-picker button:focus-visible, .we-picker select:focus-visible,
  .we-picker input:focus-visible, .we-picker [role="button"]:focus-visible,
  .we-picker__modal button:focus-visible, .we-picker__modal select:focus-visible,
  .we-picker__modal input:focus-visible, .we-picker__modal [role="button"]:focus-visible {
    outline: 2px solid var(--we-accent, #4f8cff);
    outline-offset: 2px;
  }
  /* Text inputs (搜索 / 路径 / 列表名称): match the flat control style. */
  .we-picker__text {
    height: var(--we-ui-h, 30px); padding: 0 8px;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
    border-radius: var(--we-ui-radius, 8px); background: transparent;
    color: var(--we-ink, inherit); font-size: 0.82em;
  }
  .we-picker__search { flex: 1 1 150px; min-width: 0; }
  .we-picker__error { font-size: 0.82em; opacity: 0.9; color: #e5534b; }
  .we-picker__note { font-size: 0.8em; opacity: 0.85; color: var(--we-accent, var(--dsw-alias-brand-primary, #4f8cff)); }

  /* ── Visual grouping: sections with a hairline divider + quiet label. ── */
  .we-picker__section { display: flex; flex-direction: column; gap: 10px; }
  .we-picker__section + .we-picker__section {
    border-top: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.22));
    padding-top: 12px;
  }
  .we-picker__section-head { display: flex; align-items: center; }
  .we-picker__section-label {
    /* 节标题必须**大于**行标签（ctl-label 0.88em）—— 0.72em 那版反而比正文小，
       「找路」层级倒挂（2026-10-09 用户口径：红圈那批标题要一眼跳出来）。 */
    font-size: 1.1em; font-weight: 600; letter-spacing: 0.04em;
    /* 分组标题是「找路」信息而非装饰：次级墨色保证暗玻璃上可读。 */
    color: var(--we-ink-2, rgba(128, 128, 128, 0.9));
  }
  /* ── 可折叠节头（侧栏「外观」页默认收起的整节，如「全局字体」）：
     整行可点（role=button + aria-expanded 挂在头上），箭头随开合旋转；
     旋转走 transform（合成器属性），150ms 只动这一枚小箭头。
     ⚠️ 不用负 margin 扩底色（侧栏 tabbody 是 overflow 容器，负 margin 会把
     scrollWidth 撑出横向滚动条 —— 实测 320 → 332）；左右 padding 收紧即可。 ── */
  .we-picker__section-head--toggle {
    cursor: pointer; user-select: none;
    border-radius: 6px; padding: 2px 4px;
    transition: background-color 0.15s ease;
  }
  .we-picker__section-head--toggle:hover {
    background: var(--we-hover-bg, rgba(128, 128, 128, 0.1));
  }
  .we-picker__section-head--toggle:focus-visible {
    outline: 2px solid var(--we-accent, #4f8cff); outline-offset: 1px;
  }
  .we-picker__section-caret {
    margin-left: auto; font-size: 0.72em;
    color: var(--we-ink-2, rgba(128, 128, 128, 0.9));
    transition: transform 0.15s ease;
  }
  .we-picker__section-caret.is-open { transform: rotate(180deg); }
  /* ── 侧栏窄栏兜底：展开「全局字体」后的排版角色表比栏宽，横向滚动而不是撑破面板。 ── */
  .we-qp__tabbody .we-picker__font-table { max-width: 100%; overflow-x: auto; }

  /* ── 页签栏（分段式）：玻璃轨道 + 滑动指示胶囊。窄抽屉里六枚等宽页签
     恰好放下两至三字标签；指示胶囊平移走 transform（合成器属性）。 ── */
  .we-tabs {
    position: relative; display: flex; flex: 0 0 auto;
    padding: 3px; border-radius: 10px;
    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.12));
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.22));
    overflow: hidden;
  }
  .we-tabs__pill {
    position: absolute; top: 3px; left: 3px; bottom: 3px;
    border-radius: 8px;
    background: var(--dsw-alias-bg-layer-3, rgba(255, 255, 255, 0.16));
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.12);
    transition: transform 220ms var(--we-ease, cubic-bezier(0.16, 1, 0.3, 1));
    will-change: transform;
  }
  .we-tabs__tab {
    position: relative; z-index: 1; flex: 1 1 0; min-width: 0;
    height: 28px; padding: 0 4px; border: 0; background: transparent;
    border-radius: 8px; cursor: pointer; white-space: nowrap;
    font-size: 12px; line-height: 1;
    color: var(--we-ink-2, rgba(128, 128, 128, 0.9));
    transition: color var(--we-dur-fast, 120ms) var(--we-ease, ease);
  }
  .we-tabs__tab:hover { color: var(--we-ink, inherit); }
  .we-tabs__tab--active { color: var(--we-ink, inherit); font-weight: 600; }
  /* 页签面板：淡入 + 轻微上移落定（reduced-motion 由全局媒体查询静止）。 */
  .we-tabpanel {
    display: flex; flex-direction: column; gap: 12px;
    animation: we-tab-in 180ms var(--we-ease, cubic-bezier(0.16, 1, 0.3, 1));
  }
  @keyframes we-tab-in {
    from { opacity: 0; transform: translateY(4px); }
  }

  /* ── 统一设置行：左「标签(+一句话说明)」、右控件；32px 触达高度。 ── */
  .we-picker__ctl {
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px; min-height: 32px;
  }
  .we-picker__ctl--wrap { flex-wrap: wrap; row-gap: 8px; }
  .we-picker__ctl-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .we-picker__ctl-label {
    font-size: 0.88em; color: var(--we-ink, inherit);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .we-picker__ctl-hint {
    font-size: 0.7em; color: var(--we-ink-3, rgba(128, 128, 128, 0.65));
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;
  }
  .we-picker__ctl-side { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
  .we-picker__swatches { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }

  /* ── 吉祥物形态卡片：立绘按基础尺寸固定渲染，「吉祥物大小」滑块只作用于主页面吉祥物。 ── */
  .we-picker__mascot-row { display: flex; gap: 10px; flex-wrap: wrap; }
  .we-picker__mascot-card {
    display: flex; flex-direction: column; align-items: center; gap: 6px;
    padding: 12px 16px 10px; min-width: 96px;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.28));
    border-radius: 12px; cursor: pointer;
    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.08));
    transition:
      border-color var(--we-dur-fast, 120ms) var(--we-ease, ease),
      background-color var(--we-dur-fast, 120ms) var(--we-ease, ease),
      box-shadow var(--we-dur-fast, 120ms) var(--we-ease, ease),
      transform var(--we-dur-fast, 120ms) var(--we-ease, ease);
  }
  .we-picker__mascot-card:hover { border-color: var(--dsw-alias-label-dimmed, rgba(128, 128, 128, 0.5)); }
  .we-picker__mascot-card:active { transform: scale(0.97); }
  .we-picker__mascot-card--active {
    border-color: var(--we-accent, #4f8cff);
    background: color-mix(in srgb, var(--we-accent, #4f8cff) 10%, transparent);
    box-shadow: 0 0 0 1px var(--we-accent, #4f8cff);
  }
  /* 禁用态（自定义立绘生效时两张内置卡）：要"看得出来点不动" —— 不淡化的禁用按钮
     和可点的长得一模一样，用户会当成坏了（点击无反应比灰掉更糟）。 */
  .we-picker__mascot-card:disabled { cursor: default; opacity: 0.45; }
  .we-picker__mascot-card:disabled:hover { border-color: var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.28)); }
  .we-picker__mascot-card:disabled:active { transform: none; }
  .we-picker__mascot-art { display: flex; align-items: flex-end; justify-content: center; }
  .we-picker__mascot-art img { display: block; width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
  .we-picker__mascot-name { font-size: 0.78em; color: var(--we-ink-2, rgba(128, 128, 128, 0.9)); }
  .we-picker__mascot-card--active .we-picker__mascot-name { color: var(--we-ink, inherit); }

  /* ── 效果页签空态：不摆一列无效滑块，引导去选壁纸。 ── */
  .we-picker__empty {
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    padding: 36px 16px; text-align: center;
  }
  .we-picker__empty-title { font-size: 0.95em; font-weight: 600; color: var(--we-ink, inherit); }

  /* ── Vinyl record (黑胶唱片): rotating disc with the selected wallpaper's
     cover as the label. Spins while the wallpaper is playing; pauses
     otherwise. Shown in both settings layouts and in the modal head. ── */
  .we-vinyl {
    position: relative; width: 128px; height: 128px; flex: 0 0 auto;
    border-radius: 50%;
    background:
      repeating-radial-gradient(circle at center, #191920 0 2px, #23232c 2px 4px);
    box-shadow:
      0 6px 18px rgba(0, 0, 0, 0.55),
      inset 0 0 0 1px rgba(255, 255, 255, 0.07);
    animation: we-vinyl-spin 8s linear infinite;
    animation-play-state: paused;
  }
  .we-vinyl--playing { animation-play-state: running; }
  .we-vinyl--sm { width: 56px; height: 56px; }
  .we-vinyl__cover {
    position: absolute; inset: 24%; border-radius: 50%; overflow: hidden;
    background: rgba(128, 128, 128, 0.25);
    border: 2px solid rgba(0, 0, 0, 0.85);
    box-shadow:
      0 0 0 2px rgba(255, 255, 255, 0.1),
      inset 0 0 8px rgba(0, 0, 0, 0.6);
  }
  .we-vinyl__cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .we-vinyl__empty {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    color: rgba(255, 255, 255, 0.45); font-size: 1.3em;
  }
  .we-vinyl__hole {
    position: absolute; left: 50%; top: 50%;
    width: 12px; height: 12px; margin: -6px 0 0 -6px;
    border-radius: 50%; background: #0b0b0e;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.9);
  }
  .we-vinyl--sm .we-vinyl__hole { width: 6px; height: 6px; margin: -3px 0 0 -3px; }
  @keyframes we-vinyl-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    .we-vinyl { animation: none; }
  }
  .we-picker__modal-head-left { display: flex; align-items: center; gap: 8px; min-width: 0; }

  /* ── Current-wallpaper card: thumbnail + title + type + primary action. ── */
  .we-picker__current {
    display: flex; align-items: center; gap: 10px;
    padding: 10px; border-radius: 12px;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.28));
    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.06));
  }
  .we-picker__current-thumb {
    width: 64px; height: 36px; flex: 0 0 auto;
    object-fit: cover; border-radius: 8px;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
    background: rgba(128, 128, 128, 0.14);
  }
  .we-picker__current-thumb--empty {
    display: flex; align-items: center; justify-content: center;
    font-size: 0.85em; opacity: 0.4;
  }
  .we-picker__current-info { flex: 1; min-width: 0; }
  .we-picker__current-title {
    font-size: 0.9em; font-weight: 500;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  /* 类型 + 播放态：宽卡片里是标题下的独立一行（普通块级）。 */
  .we-picker__current-meta { display: block; font-size: 0.75em; opacity: 0.55; margin-top: 2px; }
  /* 播放失败 / 选择被过滤排除的原因（#84）: 紧跟在 meta 行下的一句可读说明，
     这两种情况都表现为「壁纸一片空白且无从下手」，故必须可见但克制。 */
  .we-picker__current-error { font-size: 0.75em; opacity: 0.9; margin-top: 2px; color: #e5534b; }

  /* Primary action (选择壁纸): the ONE solid-accent control per view — accent
     is reserved for primary action + selection states, never decoration.
     墨色不写死 #fff：accent 可以是任意亮度（用户配色），亮 accent（黄）上的
     白字就是 issue #127 的「文字与背景同色」—— 按 accent 亮度选墨。 */
  .we-picker__btn--primary {
    color: var(--we-accent-ink, #fff);
    background: var(--we-accent, #4f8cff);
    border-color: transparent;
    font-weight: 600;
  }
  .we-picker__btn--primary:hover {
    background: color-mix(in srgb, var(--we-accent, #4f8cff) 86%, var(--we-accent-ink, #000));
    color: var(--we-accent-ink, #fff);
  }

  /* 壁纸属性入口已并入播放控制行（普通 .we-picker__btn，开着时 is-on）——
     专门的 --props 绿色次级按钮样式随之退役。 */
  .we-picker__btn--mini { padding: 2px 8px; font-size: 0.75em; }

  /* 主操作区（选择壁纸）：宽卡片里并排；抽屉里上下排列（间距 8px）。 */
  .we-picker__current-actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
  .we-picker__current-sub { min-width: 0; }

  /* ── 壁纸属性面板 ─────────────────────────────────────────────────────── */
  .we-picker__props {
    margin-top: 8px; padding: 10px; border-radius: 12px;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.28));
    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.06));
    display: flex; flex-direction: column; gap: 6px;
  }
  .we-picker__props-head { display: flex; align-items: center; gap: 8px; }
  .we-picker__props-title { font-size: 0.85em; font-weight: 600; }
  .we-picker__props-note { flex: 1; min-width: 0; font-size: 0.75em; opacity: 0.6; }
  .we-picker__props-hint { font-size: 0.75em; opacity: 0.85; color: #d29922; }
  .we-picker__props-section { font-size: 0.78em; opacity: 0.6; margin-top: 6px; }
  .we-picker__props-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .we-picker__props-label {
    flex: 1; min-width: 0; font-size: 0.8em;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .we-picker__props-dot { margin-left: 4px; color: #2ea043; font-weight: 700; }
  .we-picker__props-value { flex: 0 0 auto; min-width: 3.2em; text-align: right; font-size: 0.75em; opacity: 0.7; }
  .we-picker__props-check { flex: 0 0 auto; }
  .we-picker__props-color {
    flex: 0 0 auto; width: 46px; height: 22px; padding: 0; cursor: pointer;
    border-radius: 6px; background: transparent;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
  }
  .we-picker__props-select, .we-picker__props-text {
    flex: 0 1 52%; min-width: 0; font-size: 0.8em; padding: 3px 6px; border-radius: 8px;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
    background: var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.18)); color: inherit;
  }

  /* Refined range sliders: thin track + circular brand ring thumb. */
  .we-picker__slider {
    -webkit-appearance: none; appearance: none;
    flex: 1; height: 18px; background: transparent; cursor: pointer;
  }
  .we-picker__slider::-webkit-slider-runnable-track {
    height: 4px; border-radius: 2px;
    /* accent 填充段（0 → --we-fill）+ 灰色剩余段 */
    background: linear-gradient(to right,
      var(--we-accent, #4f8cff) var(--we-fill, 0%),
      var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.4)) var(--we-fill, 0%));
  }
  .we-picker__slider::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    width: 16px; height: 16px; margin-top: -6px; border-radius: 50%;
    background: #fff;
    border: 2px solid var(--we-accent, #4f8cff);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
    transition: transform var(--we-dur-fast, 120ms) var(--we-ease, ease);
  }
  .we-picker__slider:hover::-webkit-slider-thumb { transform: scale(1.12); }
  .we-picker__slider:active::-webkit-slider-thumb { transform: scale(1.2); }
  .we-picker__slider::-moz-range-track {
    height: 4px; border-radius: 2px;
    background: var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.4));
  }
  /* Firefox 的填充段走专用伪元素（不认 webkit 的渐变轨道方案）。 */
  .we-picker__slider::-moz-range-progress {
    height: 4px; border-radius: 2px;
    background: var(--we-accent, #4f8cff);
  }
  .we-picker__slider::-moz-range-thumb {
    width: 16px; height: 16px; border-radius: 50%;
    background: #fff;
    border: 2px solid var(--we-accent, #4f8cff);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  }
  /* （设置行的原生 checkbox 已全部换成胶囊开关 .we-picker__switch；壁纸属性面板的 bool 项仍是原生 checkbox。） */

  /* Sliding toggle switch (紧凑布局). Track + thumb slide left/right with a
     snappy 120ms transition; pinned accent so light themes stay readable. */
  .we-picker__switch {
    position: relative; display: inline-flex; cursor: pointer;
  }
  .we-picker__switch input {
    position: absolute; opacity: 0; width: 0; height: 0;
  }
  .we-picker__switch-track {
    position: relative; width: 36px; height: 20px; border-radius: 999px;
    background: var(--dsw-alias-bg-layer-3, rgba(128, 128, 128, 0.4));
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.25));
    box-sizing: border-box;
    transition: background-color 180ms var(--we-ease, ease), border-color 180ms var(--we-ease, ease);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.16);
  }
  .we-picker__switch:hover .we-picker__switch-track { border-color: var(--dsw-alias-label-dimmed, rgba(128, 128, 128, 0.5)); }
  /* 键盘焦点环：input 视觉隐藏但可聚焦，焦点环落在 track 上。 */
  .we-picker__switch input:focus-visible + .we-picker__switch-track {
    outline: 2px solid var(--we-accent, #4f8cff);
    outline-offset: 2px;
  }
  .we-picker__switch input:checked + .we-picker__switch-track {
    background: var(--we-accent, #4f8cff); /* 跟随「配色」设置，不再硬编码 */
  }
  .we-picker__switch-thumb {
    position: absolute; left: 2px; top: 2px;
    width: 14px; height: 14px; border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
    transition: transform 180ms var(--we-ease, ease);
  }
  .we-picker__switch input:checked + .we-picker__switch-track .we-picker__switch-thumb {
    transform: translateX(16px);
  }

  /* Custom chevron for the flat selects (appearance: none removed the native
     arrow; heights stay pinned at 26px so rows can never shift). */
  .we-picker select {
    background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M1 1l3 3 3-3' fill='none' stroke='%23888' stroke-width='1.4' stroke-linecap='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 8px center;
    padding-right: 24px;
  }

  /* Motion tokens: one shared ease (expo-out) + two durations. */
  .we-picker, .we-picker__modal {
    --we-ease: cubic-bezier(0.16, 1, 0.3, 1);
    --we-dur-fast: 120ms;
    --we-dur: 200ms;
  }
  /* Motion: state-only transitions (background/color/border/transform — never
     layout), token-driven; disabled entirely under prefers-reduced-motion. */
  .we-picker__btn, .we-picker select, .we-picker__card, .we-picker__editor-card,
  .we-picker__tab, .we-picker__rate, .we-picker__card-hide {
    transition:
      background-color var(--we-dur-fast, 120ms) var(--we-ease, ease),
      border-color var(--we-dur-fast, 120ms) var(--we-ease, ease),
      color var(--we-dur-fast, 120ms) var(--we-ease, ease),
      box-shadow var(--we-dur-fast, 120ms) var(--we-ease, ease),
      transform var(--we-dur-fast, 120ms) var(--we-ease, ease);
  }
  /* 按压反馈：点击即缩，松手回弹（transform = 合成器属性，不引发布局）。 */
  .we-picker__btn:active, .we-picker__rate:active, .we-picker__tab:active {
    transform: scale(0.96);
  }
  @media (prefers-reduced-motion: reduce) {
    .we-picker *, .we-picker__modal, .we-picker__modal * {
      transition: none !important;
      animation: none !important;
    }
  }
  .we-picker__slider-row { display: flex; align-items: center; gap: 10px; }
  .we-picker__label { min-width: 28px; flex: 0 0 auto; color: var(--we-ink, inherit); font-size: 0.88em; }
  /* 滑杆行左侧那个标签可能是**第三方自填的槽名**（别的插件注册进来的元素组，槽名就是 data-slot，
     见 src/parallax-layer.js 的插件组）：超长时不许把滑块与右侧数值挤出卡片 —— 可收缩 + 省略号。
     只作用于滑杆行内部，其它地方的 .we-picker__label（都是宿主自己的短标签）保持原样。 */
  .we-picker__slider-row .we-picker__label {
    flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .we-picker__value {
    min-width: 48px; text-align: right; flex: 0 0 auto;
    padding: 2px 8px; border-radius: 999px; font-size: 0.72em;
    background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.14));
    color: var(--we-ink-2, rgba(128, 128, 128, 0.9));
  }
  /* 可取数的数值区（SliderRow 的 numberEdit 行）：数值框与单位共用一个胶囊 ——
     框本身去边框/底色、宽度按内容、去掉 spinner，数值与单位同色同字号；
     键盘可达（回车 / 失焦提交）。 */
  .we-picker__value-input {
    width: 3.6em; min-width: 0; padding: 0 2px; margin: 0;
    border: 0; background: transparent; text-align: right;
    color: inherit; font: inherit; line-height: 1.2;
  }
  .we-picker__value-input:focus { outline: none; }
  .we-picker__value-input::-webkit-inner-spin-button,
  .we-picker__value-input::-webkit-outer-spin-button { -webkit-appearance: none; appearance: none; margin: 0; }
  .we-picker__value-unit { opacity: 0.9; }
  .we-picker__text { flex: 1; min-width: 0; }
  .we-picker__editor {
    display: flex; flex-direction: column; gap: 6px;
    padding: 8px;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
    border-radius: 8px;
  }
  /* Wallpaper thumbnail grid (main picker).
     Cards use a FIXED height + absolutely-positioned filling <img>, never
     aspect-ratio: some browsers (old Chromium/WebView) ignore aspect-ratio on
     cards and let percentage-height images resolve to their intrinsic size,
     which made previews bleed over the row above. inset:0 + overflow:hidden
     pins the image inside the card in every engine. */
  .we-picker__grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 8px; max-height: 280px; overflow-y: auto; padding: 2px;
    /* hover 放大（CD 架 scale 1.12）不得撑出水平滚动条：clip 裁掉溢出且不
       产生滚动条（hidden 仍可被程序滚动，clip 才是纯裁剪），scrollbar-gutter
       让垂直滚动条的出现/消失也不再挤压内容 —— 两者一起消除「hover 最后一列
       → 溢出 → 滚动条 → 宽度变化 → unhover → 回缩」的震荡循环。 */
    overflow-x: hidden; /* fallback：老旧内核不认识 clip 时的平替 */
    overflow-x: clip;
    scrollbar-gutter: stable;
  }
  .we-picker__card {
    position: relative; height: 92px; padding: 0; cursor: pointer;
    display: block; overflow: hidden;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
    border-radius: 8px;
    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.15));
  }
  .we-picker__card img {
    position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: cover; display: block;
    /* 加载淡入（onLoad 置 opacity:1）+ hover 微放大（合成器属性）。 */
    opacity: 0;
    transition:
      opacity var(--we-dur, 200ms) ease,
      transform 300ms var(--we-ease, ease);
  }
  /* hover 缩略图缓放大 —— 仅非 CD 架模式（CD 架是卡片整体 scale，叠加会双重放大）。 */
  .we-picker:not([data-we-cards="classic"]) .we-picker__card:hover img,
  .we-picker__modal:not([data-we-cards="classic"]) .we-picker__card:hover img {
    transform: scale(1.06);
  }
  /* 编辑器卡片 / 黑胶封面同样加载淡入。 */
  .we-picker__editor-card img, .we-vinyl__cover img {
    opacity: 0;
    transition: opacity var(--we-dur, 200ms) ease;
  }
  /* Classic — "CD 架" (CD-rack) card style: cards stack like CD jewel cases
     on a rack. Each row strongly overlaps the row ABOVE it (the lower card's
     top covers roughly half of the upper card's bottom — vertical only, never
     horizontal), with a soft drop shadow for shelf depth. Hovering scales the
     card up and brings it to the front. Opt-in via the 卡片样式 switch. The
     modal is PORTALLED onto <body>, so the attribute is scoped on BOTH the
     settings root and the modal element. The grid gets extra bottom padding
     so the last row's overlap is not clipped. */
  .we-picker[data-we-cards="classic"] .we-picker__grid,
  .we-picker__modal[data-we-cards="classic"] .we-picker__grid {
    /* Compact CD-rack columns: ~7 cards per row at modal width. 两侧留出
       8px 让位列：最左/最右列 hover 放大 12%（≈6px/侧）时在让位区内展开，
       不触碰溢出边界、不被 clip 裁掉。 */
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    padding: 2px 8px 42px;
  }
  .we-picker[data-we-cards="classic"] .we-picker__editor-grid,
  .we-picker__modal[data-we-cards="classic"] .we-picker__editor-grid {
    grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  }
  .we-picker[data-we-cards="classic"] .we-picker__card,
  .we-picker__modal[data-we-cards="classic"] .we-picker__card {
    position: relative; width: 100%; padding: 0; cursor: pointer;
    height: auto; aspect-ratio: 16 / 9; display: block; overflow: hidden;
    margin-bottom: -36px;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
    border-radius: 8px;
    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.15));
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
    transition: transform 120ms ease, box-shadow 120ms ease;
  }
  .we-picker[data-we-cards="classic"] .we-picker__card:hover,
  .we-picker__modal[data-we-cards="classic"] .we-picker__card:hover {
    transform: scale(1.12);
    z-index: 10;
    box-shadow: 0 14px 28px rgba(0, 0, 0, 0.5);
  }
  .we-picker[data-we-cards="classic"] .we-picker__card img,
  .we-picker__modal[data-we-cards="classic"] .we-picker__card img {
    position: static; width: 100%; height: 100%; object-fit: cover; display: block;
  }
  .we-picker[data-we-cards="classic"] .we-picker__editor-card,
  .we-picker__modal[data-we-cards="classic"] .we-picker__editor-card {
    position: relative; width: 100%; padding: 0; cursor: pointer;
    height: auto; aspect-ratio: 16 / 10; display: block; overflow: hidden;
    margin-bottom: -30px;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
    border-radius: 6px;
    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.15));
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
    transition: transform 120ms ease, box-shadow 120ms ease;
  }
  .we-picker[data-we-cards="classic"] .we-picker__editor-card:hover,
  .we-picker__modal[data-we-cards="classic"] .we-picker__editor-card:hover {
    transform: scale(1.1);
    z-index: 10;
    box-shadow: 0 12px 24px rgba(0, 0, 0, 0.5);
  }
  .we-picker[data-we-cards="classic"] .we-picker__editor-card img,
  .we-picker__modal[data-we-cards="classic"] .we-picker__editor-card img {
    position: static; width: 100%; height: 100%; object-fit: cover; display: block;
  }
  .we-picker__card--selected {
    outline: 2px solid var(--we-accent, #4f8cff);
    outline-offset: -2px;
    /* 选中即"发光"：accent 色柔光晕，比裸描边更读得出"当前"。 */
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--we-accent, #4f8cff) 45%, transparent),
      0 4px 16px color-mix(in srgb, var(--we-accent, #4f8cff) 30%, transparent);
  }
  .we-picker__card-close {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: 0.8em; color: var(--dsw-alias-label-secondary, #888);
  }
  .we-picker__card-title {
    position: absolute; left: 0; right: 0; bottom: 0; padding: 3px 6px;
    font-size: 0.7em; line-height: 1.2; color: #fff;
    background: linear-gradient(transparent, rgba(0, 0, 0, 0.7));
    text-overflow: ellipsis; white-space: nowrap; overflow: hidden;
  }
  /* Scene-wallpaper "实时帧" badge — top-right under the hide button.
     作用域钉在**缩略图卡片**里：卡头的可播放计数徽标（.we-picker__card-head 下）
     同名，不能被这条 absolute 角标规则盖掉（那一枚走 .we-picker__card-badge 的基样式，行内计数）。 */
  .we-picker__card .we-picker__card-badge {
    position: absolute; top: 4px; right: 4px; z-index: 1;
    padding: 1px 6px; font-size: 0.62em; line-height: 1.6;
    border-radius: 4px; color: #fff;
    background: rgba(30, 90, 160, 0.85);
  }
  .we-picker__card-placeholder {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: 0.72em; opacity: 0.55;
  }
  /* Per-card wallpaper-type badge (视频 / 网页 / 图片 / 场景) — top-left
     overlay, always visible (the type filter's own labels). In batch mode the
     selection checkbox (.we-picker__card-check) owns the same corner, so the
     badge is not rendered at all then. */
  .we-picker__card-type {
    position: absolute; top: 4px; left: 4px; z-index: 2;
    padding: 2px 7px; font-size: 0.68em; line-height: 1.5;
    border-radius: 4px; color: #fff;
    background: rgba(0, 0, 0, 0.6);
    pointer-events: none;
  }
  /* Per-card "hide" button (soft delete) — top-right overlay. 默认隐去，
     hover / 键盘聚焦（focus-within）时浮现：网格不常驻一层噪声按钮。 */
  .we-picker__card-hide {
    position: absolute; top: 4px; right: 4px; z-index: 2;
    padding: 2px 7px; font-size: 0.68em; line-height: 1.5;
    border: 0; border-radius: 4px; cursor: pointer;
    background: rgba(0, 0, 0, 0.6); color: #fff;
    opacity: 0;
  }
  .we-picker__card:hover .we-picker__card-hide,
  .we-picker__card:focus-within .we-picker__card-hide { opacity: 1; }
  .we-picker__card-hide:hover { background: rgba(190, 50, 50, 0.9); }
  /* Batch-mode selection check — top-left overlay. */
  .we-picker__card-check {
    position: absolute; top: 4px; left: 4px; z-index: 2;
    width: 18px; height: 18px; border-radius: 4px;
    background: rgba(0, 0, 0, 0.6); color: #fff;
    font-size: 12px; line-height: 18px; text-align: center;
  }
  /* 批量勾选高亮：独立的 --checked class（勾选 ≠ 当前播放的 --selected）。 */
  .we-picker__card--checked {
    outline: 2px solid var(--we-accent, #4f8cff);
    outline-offset: -2px;
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--we-accent, #4f8cff) 45%, transparent),
      0 4px 16px color-mix(in srgb, var(--we-accent, #4f8cff) 30%, transparent);
  }
  .we-picker__card--checked .we-picker__card-check {
    background: var(--we-accent, #4f8cff);
  }
  /* Hidden wallpapers view: dimmed cards. */
  .we-picker__card--hidden { opacity: 0.78; }
  .we-picker__card--hidden .we-picker__card-title {
    background: linear-gradient(transparent, rgba(0, 0, 0, 0.78));
  }
  /* Batch-action bar. */
  .we-picker__batch-bar {
    padding: 4px 6px; border-radius: 6px;
    border: 1px dashed var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
  }
  /* Current-wallpaper summary (replaces the inline grid in settings). */
  .we-picker__summary {
    flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-size: 0.85em; opacity: 0.85;
  }
  /* ── 壁纸库下钻视图 ────────────────────────────────────────────────────────
     116 个按层级/相邻关系绑定的 .we-picker__* 选择器不许漂，「modal」只剩类名。
     视觉上就是页签面板的就地内容：无自身边框/底色/阴影/滚动 —— 整页由设置对话框的
     内容列滚动。 */
  .we-picker__modal {
    display: flex; flex-direction: column; gap: 10px;
    /* 换入动画与页签一致（该节点在 pickerOpen 翻转时新挂载，动画自然会跑）。 */
    animation: we-tab-in 180ms var(--we-ease, cubic-bezier(0.16, 1, 0.3, 1));
  }
  .we-picker__modal-head {
    display: flex; align-items: center; justify-content: space-between;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.22));
  }
  .we-picker__modal-title { font-weight: 600; font-size: 0.95em; }
  .we-picker__modal-tabs { display: flex; gap: 6px; }
  .we-picker__tab {
    flex: 1; padding: 0; text-align: center; font-size: 0.82em; cursor: pointer;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
    border-radius: 6px; background: transparent;
    color: var(--dsw-alias-label-secondary, #888);
  }
  .we-picker__tab--active {
    background: var(--we-accent, #4f8cff);
    border-color: var(--we-accent, #4f8cff);
    /* 墨随 accent 亮度选（issue #127 同款：亮 accent 上写死白字不可读）。 */
    color: var(--we-accent-ink, #fff);
  }
  .we-picker__modal-body {
    display: flex; flex-direction: column; gap: 8px;
    /* 卡片 hover 放大的横向溢出裁切；纵向滚动交给设置页内容列（本层只裁横轴）。 */
    overflow-x: hidden; /* fallback：老旧内核不认识 clip 时的平替 */
    overflow-x: clip;
  }
  /* 网格高度放开（沿用弹框时代的规则：不设内部 280px 滚动，随内容生长）。 */
  .we-picker__modal-body .we-picker__grid { max-height: none; }
  /* 库视图虚拟滚动的占位行（picker-modal 的 renderVSpacer）：撑出未渲染部分的高度。
     网格里必须 grid-column 全跨整行，否则会占一个卡位把可见卡片挤错行。行高常量
     PICKER_CARD_H / PICKER_CARD_GAP 在 src/picker-modal.js 顶层，两边必须同步改。 */
  .we-picker__vspacer { width: 100%; pointer-events: none; }
  .we-picker__grid .we-picker__vspacer { grid-column: 1 / -1; }
  .we-picker__modal-foot { display: flex; align-items: center; justify-content: space-between; }
  /* Custom-upload section. */
  .we-picker__uploads {
    display: flex; flex-direction: column; gap: 6px;
    padding: 10px; border-radius: 10px;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.26));
    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.05));
  }
  .we-picker__file { flex: 1; min-width: 0; max-width: 260px; font-size: 0.8em; }
  .we-picker__uploads-list {
    display: flex; flex-direction: column; gap: 4px; max-height: 150px; overflow-y: auto;
  }
  .we-picker__uploads-item {
    display: flex; align-items: center; gap: 8px;
    padding: 3px 6px; border-radius: 6px;
    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.12));
  }
  .we-picker__uploads-name {
    flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-size: 0.82em;
  }
  .we-picker__uploads-path {
    flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-size: 0.8em; opacity: 0.85;
  }
  /* ── 目录浏览器（缓存位置「更改」弹出的面板）：宿主列目录，点行进入、地址栏可手输。
     只读既有令牌（本块不声明任何 --dsw-* 变量，令牌契约白名单不动）。 ── */
  .we-dirpick {
    display: flex; flex-direction: column; gap: 6px;
    padding: 8px; border-radius: 10px;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.26));
    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.05));
  }
  .we-dirpick__bar { display: flex; gap: 6px; }
  .we-dirpick__path { flex: 1; min-width: 0; font-size: 0.8em; }
  .we-dirpick__chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .we-dirpick__chip { height: 24px; padding: 0 10px; font-size: 0.78em; }
  .we-dirpick__list {
    display: flex; flex-direction: column; gap: 2px;
    max-height: 180px; overflow-y: auto;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.18));
    border-radius: 8px; padding: 3px;
  }
  .we-dirpick__item {
    /* **flex: none** 是这条规则里最重要的一句：列表是纵向 flex 容器且 max-height 180px，
       目录一多（D:\ 实测 119 项）默认的 flex-shrink 会把每行压到只剩上下 padding
       （8px 高），13px 的文字被 overflow:hidden 裁成一条细缝 —— 用户看到的正是
       「列表看着有内容、每一行却什么都读不到」。行高必须钉死为内容高。 */
    flex: none;
    display: block; width: 100%; text-align: left; cursor: pointer;
    padding: 4px 8px; border: 0; border-radius: 6px;
    /* 墨色**直接吃宿主系统令牌**（用户口径：跟随 DSH 的系统设置）—— 与同一面板里
       可见的 chips / 标签同族，条目永远跟面板其它文字同色，不单走一条会变黑的链。
       字体也用 font 简写从面板继承（button 的 UA 字体不继承，chips 同款做法）。 */
    color: var(--dsw-alias-label-primary, var(--we-ink, inherit));
    font: inherit; font-size: 0.82em;
    /* 行底淡染：任何令牌环境下「行」本身都找得到（文字若仍异常，行不会整体隐形）。 */
    background: rgba(128, 128, 128, 0.08);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .we-dirpick__item:hover { background: var(--we-hover-bg, rgba(128, 128, 128, 0.16)); }
  .we-dirpick__empty { font-size: 0.8em; opacity: 0.7; padding: 6px 8px; }
  .we-dirpick__foot { display: flex; align-items: center; gap: 6px; }
  .we-dirpick__sel {
    flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  /* Segmented-control family: the playback-rate control (video wallpapers only) and the
     frame-rate-cap tier row in the 效果 tab both wrap their buttons in .we-picker__seg. */
  .we-picker__seg { display: flex; gap: 4px; flex: 1; min-width: 0; }
  .we-picker__rate {
    flex: 1; height: var(--we-ui-h, 30px); padding: 0; text-align: center; font-size: 0.78em;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
    border-radius: var(--we-ui-radius, 8px); background: transparent; cursor: pointer;
    color: var(--we-ink-2, rgba(128, 128, 128, 0.9));
  }
  .we-picker__rate + .we-picker__rate { margin-left: 0; }
  .we-picker__rate--active {
    background: var(--we-accent, #4f8cff);
    border-color: var(--we-accent, #4f8cff);
    color: #fff;
  }
  /* Rotation group editor thumbnail grid. */
  .we-picker__editor-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 6px; max-height: 220px; overflow-y: auto; padding: 2px;
    /* 同主网格：CD 架 hover 放大不得撑出水平滚动条（防震荡）。 */
    overflow-x: hidden; /* fallback：老旧内核不认识 clip 时的平替 */
    overflow-x: clip;
    scrollbar-gutter: stable;
  }
  .we-picker__editor-card {
    position: relative; height: 80px; padding: 0; cursor: pointer;
    display: block; overflow: hidden;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
    border-radius: 6px;
    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.15));
  }
  .we-picker__editor-card img {
    position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: cover; display: block;
  }
  .we-picker__editor-card--checked {
    outline: 2px solid var(--we-accent, #4f8cff);
    outline-offset: -2px;
  }
  .we-picker__editor-check {
    position: absolute; top: 4px; left: 4px; width: 18px; height: 18px;
    border-radius: 4px; background: rgba(0, 0, 0, 0.55); color: #fff;
    font-size: 12px; line-height: 18px; text-align: center;
  }

  /* ── Rope dock: chibi pull-cord + glass repo drawer ────────────────────────
     The rope floats over the chat (fixed, body-child → immune to ancestor
     transforms/backdrop-filters, same policy as the picker modal). It snaps to
     the TOP edge on release (any horizontal spot); the settle class animates
     that snap via top/left (tiny element, release-only). Dragging removes the
     settle class so the rope follows the pointer 1:1. Pulling it DOWN draws
     out the repo panel, which descends from the top like a drawer. Z-order:
     repo panel 995 < rope 996 (the rope stays grabbable/clickable as the
     panel's handle while it is out) < repo modal scrim 1003 < repo modal 1004. ── */
  .we-rope {
    position: fixed;
    z-index: 996;
    width: 52px; height: 57px;
    box-sizing: border-box;
    cursor: grab;
    touch-action: none;              /* keep the pointer stream unbroken */
    user-select: none; -webkit-user-select: none;
    outline-offset: 2px;
  }
  .we-rope:focus-visible {
    outline: 2px solid var(--we-accent, #4f8cff);
    border-radius: 12px;
  }
  .we-rope--dragging { cursor: grabbing; }
  .we-rope--settle {
    transition:
      top 280ms var(--we-ease, cubic-bezier(0.16, 1, 0.3, 1)),
      left 280ms var(--we-ease, cubic-bezier(0.16, 1, 0.3, 1));
  }
  /* Art box holds the chibi <img>. The PNG is transparent-backed, and
     object-fit: contain keeps its aspect ratio (no stretch) inside the box.
     No CSS filter here: a permanent drop-shadow on a fixed element over the
     wallpaper forces a filter layer that Chromium re-rasterises on any repaint
     (click/typing) and can momentarily flash white. The chibi's own outline
     keeps it readable, so we skip the filter entirely. */
  .we-rope__art {
    width: 100%; height: 100%;
    transition: transform var(--we-dur-fast, 120ms) var(--we-ease, ease);
  }
  .we-rope:hover .we-rope__art { transform: scale(1.06); }
  .we-rope__art img {
    display: block; width: 100%; height: 100%;
    object-fit: contain;
    pointer-events: none; /* drag/capture stays on the .we-rope box */
  }

  /* One-time update notice — a floating glass toast (bottom-center) that tells
     immersive/kiosk-window users about the white flash and its one fix. High
     z-index so it sits above the chat; buttons reuse the flat picker style.
     底板跟着主题底色走（max(下限, 82%) 的衬底）：明主题白衬黑字、暗主题深蓝衬白字。 */
body[data-we-glass-floaters] .we-update-notice {
    position: fixed; left: 50%; bottom: 26px; z-index: 1100;
    transform: translateX(-50%);
    width: min(600px, 92vw);
    box-sizing: border-box;
    display: flex; flex-direction: column; gap: 10px;
    padding: 16px 18px; border-radius: 14px;
    background-color: color-mix(in srgb, var(--we-surface-tint-light, #ffffff) calc(var(--we-floaters-alpha) * 90%), var(--we-readability-base) calc(max(var(--we-readability-floor), 0.82) * 100%));
    background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.03) 40%, rgba(255, 255, 255, 0.01));
    -webkit-backdrop-filter: blur(var(--we-floaters-blur)) saturate(1.2);
    backdrop-filter: blur(var(--we-floaters-blur)) saturate(1.2);
    border: 1px solid rgba(255, 255, 255, 0.22);
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.18);
    color: inherit;
    animation: we-notice-in 240ms var(--we-ease, cubic-bezier(0.16, 1, 0.3, 1));
  }
  @keyframes we-notice-in { from { opacity: 0; transform: translate(-50%, 12px); } }
  .we-update-notice__title { font-weight: 600; font-size: 0.95em; }
  .we-update-notice__body { font-size: 0.82em; line-height: 1.5; opacity: 0.92; }
  .we-update-notice__body p { margin: 0 0 6px; }
  .we-update-notice__hint { font-size: 0.78em; opacity: 0.6; }
  .we-update-notice__btn { align-self: flex-end; }
  /* 公告配图：随包 JPEG，/about-qr 路由直出。方图不能全宽吃满 600px 面板（正文条目加起来
     已经很高，小窗口会顶出视口）——限高 26vh、宽度跟随、居中（用户口径：38vh 在 1080p 下
     ≈410px，几乎独占半屏，压到 26vh 给正文让位）。发丝边 + 投影让它贴着玻璃面板的既有语言，
     而不是一块浮贴的截图。 */
  .we-update-notice__art { display: block; margin: 0 auto; width: auto; max-width: 100%; max-height: 26vh; border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.22); box-shadow: 0 10px 26px rgba(0, 0, 0, 0.28); }
  .we-update-notice__art-cap { font-weight: 600; font-size: 0.85em; text-align: center; }
  /* 大字提示（用户口径）：用户总忽略公告 ⇒ 「侧边栏只是简略版」这一段用 16pt（≈21px，
     约正文两倍）放大喊话。pt 是绝对单位，不吃正文 0.82em 的缩放，行高单独给 1.45
     免得大字挤成一团。 */
  .we-update-notice__callout { font-size: 16pt; line-height: 1.45; }
  @media (prefers-reduced-motion: reduce) { .we-update-notice { animation: none !important; } }

  /* Glass library side drawer — docked right, 360px (capped at 92vw), full
     height, slides in from the right edge, inner body scrolls. Same liquid-glass
     recipe as the settings window: reads the very same --we-blur / --we-saturate /
     --we-glass-alpha / --we-surface-tint-light/dark / --we-glass-brightness knobs, so the
     玻璃 sliders in settings retint this panel live. Open/close = transform +
     opacity fade, token-driven; closed keeps visibility hidden (delayed so the
     fade-out finishes first) with pointer-events off. 只在低版本宿主使用 ——
     官方右侧栏已接管同一份内容（见 src/sidebar-right.js）。 */
body[data-we-glass-floaters] .we-repo-panel {
    position: fixed; top: 0; right: 0;
    width: 360px; max-width: 92vw;
    height: 100vh; height: 100dvh;
    z-index: 995;
    display: flex; flex-direction: column;
    padding: 14px;
    box-sizing: border-box;
    transform: translateX(102%);
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition:
      transform 640ms cubic-bezier(0.32, 0.72, 0.24, 1),
      opacity 480ms ease,
      visibility 0s linear 640ms;
  }
  /* The glass (backdrop-filter + tint + shadow) lives ONLY on the open state:
     while closed the panel is off-screen and must not allocate a full-viewport
     backdrop-filter compositing layer (a fixed, always-present backdrop-filter
     layer is a known Chromium white-flash-on-repaint source). */
body[data-we-glass-floaters] .we-repo-panel--open {
    border-left: 1px solid rgba(255, 255, 255, 0.22);
    /* 插件自己的抽屉同样是文字面 → 同一层可读性下限。 */
    background-color: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-light, #ffffff) calc(var(--we-floaters-alpha) * 72%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.05) 38%, rgba(255, 255, 255, 0.02));
    -webkit-backdrop-filter: blur(var(--we-floaters-blur)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
    backdrop-filter: blur(var(--we-floaters-blur)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
    box-shadow:
      inset 1px 0 0 rgba(255, 255, 255, var(--we-glass-highlight, 0.32)),
      inset 0 1px 0 rgba(255, 255, 255, 0.14),
      -18px 0 44px rgba(0, 0, 0, 0.22);
    transform: translateX(0);
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transition:
      transform 640ms cubic-bezier(0.32, 0.72, 0.24, 1),
      opacity 480ms ease,
      visibility 0s;
  }
body[data-we-glass-floaters] .we-repo-panel__head {
    display: flex; align-items: center; justify-content: space-between;
    gap: 8px; flex: 0 0 auto;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.22));
  }
  .we-repo-panel__title { font-weight: 600; font-size: 0.95em; white-space: nowrap; }
  /* Body: THE scroll container（内容 = QuickPanel 快捷播放面板）。 */
body[data-we-glass-floaters] .we-repo-panel__body {
    flex: 1; min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;   /* wheel doesn't bleed into the chat behind */
    scrollbar-gutter: stable;
    display: flex; flex-direction: column;
    padding-top: 10px;
  }

  /* ── 快捷播放面板（QuickPanel）：官方右侧栏 tab 与低版本抽屉共用同一份 ──
     控件全部复用 .we-picker__*（btn/select/switch/slider/ctl），这里只补布局与
     面板特有的零件；控件 token（高度/圆角/墨色）与设置面板同一份。 */
  .we-qp {
    --we-ui-h: 30px;
    --we-ui-radius: 8px;
    --we-ink: var(--dsw-alias-label-primary, inherit);
    --we-ink-2: var(--dsw-alias-label-secondary, rgba(128, 128, 128, 0.9));
    --we-ink-3: var(--dsw-alias-label-tertiary, rgba(128, 128, 128, 0.65));
    --we-ease: cubic-bezier(0.16, 1, 0.3, 1);
    --we-dur-fast: 120ms;
    display: flex; flex-direction: column; gap: 12px;
    font-size: 13px; color: var(--we-ink, inherit);
  }
  .we-qp--official { box-sizing: border-box; padding: 12px; }
  /* 官方侧栏的 tab 身体（P3OORG_tabBody）是固定高 + overflow:hidden —— 内容超高
     会被裁掉且任何祖先都不滚（宿主契约：每类 tab 自己管内部滚动）。所以：
     ① 面板限高 100% 自己兜底滚；② 常驻区（当前壁纸 / 轮播 / 页签栏 / 底栏）不滚，
     滚动只发生在页签内容区（.we-qp__tabbody）里 —— 快捷面板滚 100 行列表去够音量、
     或翻到播放页去够「下一张」都是不可用的。抽屉档（.we-repo-panel__body 已是滚动
     容器）不叠第二层滚。 */
  .we-qp--official { height: 100%; overflow-y: auto; overscroll-behavior: contain; }
  .we-qp--official .we-qp__current,
  .we-qp--official .we-qp__section,
  .we-qp--official .we-qp__tabs,
  .we-qp--official .we-qp__foot { flex: 0 0 auto; }
  /* 页签栏：复用设置页那套 .we-tabs（分段底 + 指示胶囊），这里只补宽度约束
     （.we-tabs 自己是 flex:0 0 auto，列向 flex 里要显式给满宽） */
  .we-qp__tabs { width: 100%; box-sizing: border-box; }
  /* 页签内容区：外观 / 播放两页在这里滚；壁纸页挂 --library，改由列表自己滚
     （viewbar 与声音组常驻，与改造前的形态一致）。 */
  .we-qp__tabbody { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
  .we-qp--official .we-qp__tabbody { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
  .we-qp--official .we-qp__tabbody--library { overflow: hidden; }
  /* ⚠️ 列表那节（.we-qp__library，flex: 1 1 auto）是**唯一**的弹性子节点；它的兄弟
     （声音组）由上面那条 .we-qp--official .we-qp__section 兜住，**不要再**在这里写
     .we-qp__tabbody--library > .we-qp__section —— 那会多一个类、特异性压过
     .we-qp__library（同为 0,2,0 时才靠源码顺序决胜），把列表压成内容高 ——
     列表里的 overflow-y:auto 就永远不触发（实测：侧栏列表滚不动）。判据在
     test/verify-scene-live.mjs「侧栏列表的滚动链」一段。 */
  .we-qp--official .we-qp__library { flex: 1 1 auto; min-height: 140px; }
  .we-qp--official .we-qp__list {
    flex: 1 1 auto; min-height: 0;
    overflow-y: auto; overscroll-behavior: contain;
    scrollbar-gutter: stable;
  }
  .we-qp__section {
    display: flex; flex-direction: column; gap: 8px;
    padding-top: 10px;
    border-top: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.22));
  }
  .we-qp__current { display: flex; align-items: center; gap: 10px; }
  /* 当前壁纸缩略图 = 一枚旋转圆盘（用户口径：圆形图片旋转、中心空心小圆）：预览图
     裁成整圆，播放时匀速自转、暂停停在原角度（复用设置页黑胶的 we-vinyl-spin 关键帧
     与 play-state 口径，--playing 由组件按 playbackLive 挂）。中心的孔用 radial mask
     **真挖穿**而不是叠色块 —— 面板是玻璃，只有镂空才能在深浅主题下都透出底色；孔缘
     一圈细描边把"空心"衬成唱片中孔，而不是图片裁坏了。 */
  /* ⚠️ 圆度：外缘用 clip-path: circle(50%) —— 它对图片外接盒做整圆裁切，外缘抗锯齿
     明显比 border-radius + overflow（"把方盒子裁圆"）干净，圆也更"正"。中心那个孔
     不能用 radial-gradient mask 挖穿：mask 会把元素提升到一个额外光栅层、**把外缘的
     抗锯齿一起弄糊**；孔改由 ::after 那枚"边框环"画（不叠色块，仍是玻璃能透出底色），
     于是这枚圆盘不需要 mask。 */
  .we-qp__thumb {
    position: relative; flex: none; width: 40px; height: 40px;
    aspect-ratio: 1 / 1; box-sizing: border-box;
    border-radius: 50%; overflow: hidden;
    clip-path: circle(50%);
    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.12));
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.22));
  }
  /* 中心孔：一枚描边圆环（不是色块 —— 面板是玻璃，只有留空才能透出底色）。 */
  .we-qp__thumb::after {
    content: ""; position: absolute; left: 50%; top: 50%;
    width: 11px; height: 11px; margin: -5.5px 0 0 -5.5px;
    border-radius: 50%;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.45));
  }
  .we-qp__thumb img, .we-qp__item-thumb img {
    width: 100%; height: 100%; object-fit: cover; display: block;
    opacity: 0; transition: opacity 0.2s ease;
  }
  .we-qp__thumb img {
    animation: we-vinyl-spin 14s linear infinite;
    animation-play-state: paused;
  }
  .we-qp__current--playing .we-qp__thumb img { animation-play-state: running; }
  @media (prefers-reduced-motion: reduce) {
    .we-qp__thumb img { animation: none; }
  }
  .we-qp__current-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .we-qp__title {
    font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .we-qp__meta {
    font-size: 0.82em; color: var(--we-ink-2, rgba(128, 128, 128, 0.9));
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .we-qp__current-actions { flex: none; display: flex; gap: 6px; }
  /* 壁纸属性入口：页签栏下方独占整行、文字居中、字号与页签标签一致。
     边框显式写在这里：宿主的中性描边令牌在这套玻璃面板上近乎不可见；
     颜色取该主题下的文字色（--we-ink：深色主题是浅字、浅色主题是深字）再混 40% 透明，
     于是两套主题都看得见，且始终与文字同色系而不是另一块灰。
     不认识 color-mix 时退回宿主那条中性描边。 */
  /* 高度：固定高 30px + 零纵向内边距会让文字贴边、整枚看着被压扁 ——
     这里改成由内容与 7px 上下内边距长出来，并显式解掉基类的 height。
     字号 12px = .we-tabs__tab 的字号（两处要一起改）。 */
  .we-qp__propsbtn {
    display: flex; width: 100%; box-sizing: border-box;
    justify-content: center; padding: 7px 12px;
    height: auto; line-height: 1.2;
    font-size: 12px;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
  }
  @supports (border-color: color-mix(in srgb, currentColor 40%, transparent)) {
    .we-qp__propsbtn {
      border-color: color-mix(in srgb, var(--we-ink, currentColor) 40%, transparent);
    }
  }
  .we-qp__propsbtn.is-on {
    border-color: color-mix(in srgb, var(--we-accent, currentColor) 55%, transparent);
  }
  /* 下钻打开时：面板直接占满内容区（**不再有返回按钮那一行** —— 用户口径：
     那一行多余；同一枚「收起壁纸属性」就在页签下面，收起路径并没有丢）。 */
  .we-qp__propsview { display: flex; flex-direction: column; min-width: 0; }
  .we-qp__propsview--drill { flex: 1 1 auto; min-height: 0; }
  /* 属性下钻的滚动：官方档的页签内容区是「固定高 + overflow:hidden」（宿主契约，见上面
     .we-qp--official 那段），壁纸档还挂 --library 特意不自己滚（滚动交给列表）。而属性
     下钻这一屏**没有列表** —— 面板必须自带滚动，否则属性多的壁纸下半截被裁掉、任何祖先
     都滚不动（用户实测：壁纸属性点开时显示不全）。抽屉档的滚动由 .we-repo-panel__body
     承担，这里不叠第二层滚，故只作用在 --official 档。 */
  .we-qp--official .we-qp__propsview--drill {
    overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable;
  }
  .we-qp__row { display: flex; align-items: center; gap: 8px; }
  .we-qp__group { flex: 1; min-width: 0; }
  .we-qp__search { width: 100%; box-sizing: border-box; }
  .we-qp__list { display: flex; flex-direction: column; gap: 2px; }
  /* 视图切换：搜索 + 分级筛选 + 类型筛选 + 列表/卡片，**确定性两行**。一行排下不可行 ——
     最窄官方右栏里第四个控件在结构上放不下（分级最短也要 ~70px，搜索框会被挤到不可用），
     而依赖 flex-wrap 假想尺寸的折行在中间宽度会碎出"只有页签折下去"的行。故搜索框独占
     首行（**封顶 300px**：用户口径，太长的搜索框没用还占地方；basis 钉 100% 强制换行），
     分级/类型/视图三个控件右对齐成第二行（分级 select 的 margin-left:auto 恰是第二行首项，
     把整组推到右侧）。 */
  .we-qp__viewbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .we-qp__viewbar .we-qp__search { flex: 1 1 100%; min-width: 0; max-width: 300px; width: auto; }
  .we-qp__viewbar .we-qp__rating { flex: none; max-width: 110px; margin-left: auto; }
  .we-qp__viewbar .we-qp__type { flex: none; max-width: 84px; }
  /* 列表 / 卡片：标签式切换 —— 复用 .we-tabs 的滑动胶囊做激活指示，但去掉分段底与
     描边（用户口径：不要默认背景）；页签收成内容宽（两枚都是两字，等宽成立，
     胶囊 (100%-6px)/2 的等分算式与 3px 内衬原样沿用）。 */
  .we-qp__viewtabs { flex: none; width: auto; background: transparent; border: 0; }
  .we-qp__viewtabs .we-tabs__tab { flex: 0 0 auto; padding: 0 10px; }
  /* 卡片网格：**最窄两列、向后自动加列**（auto-fill 铺最小 130px 的列轨，画满一行
     再换行）。130 的取法：两个「最窄形态」都必须恰为 2 列 —— 官方右栏最小 300px
     （宿主 clampWidth(rightbar, 300, …)，内容 276 ∈ (2×130+8, 3×130+16]）、抽屉固定
     360（内容 336 同样恰好 2 列）；再宽自动 3/4/5 列（约 430 → 3、570 → 4）。
     选中项 accent 描边 + 「当前」徽标。 */
  .we-qp__list--cards {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 8px; align-content: start;
  }
  .we-qp__list--cards .we-picker__hint { grid-column: 1 / -1; }
  /* 虚拟滚动的占位行（quick-panel 的 renderSpacer）：撑出未渲染部分的高度。列表档是
     flex 列里的普通块（flex:none 防被压缩），卡片档要 grid-column 全跨整行 —— 否则会
     占一个卡位，把可见卡片整体挤错一行。行高常量在 quick-panel 的 QP_ROW_H / QP_CARD_H，
     两边必须同步改。 */
  .we-qp__vspacer { flex: none; width: 100%; pointer-events: none; }
  .we-qp__list--cards .we-qp__vspacer { grid-column: 1 / -1; }
  .we-qp__card {
    position: relative; overflow: hidden; cursor: pointer;
    /* 固定卡高：网格轨道 sizing 对 aspect-ratio / 百分比 padding 都会塌成内容高
      （Chromium 实测：行轨道拿不到传递尺寸，卡片互相叠成细条），px 是唯一可靠形态；
      宽度随列自适应，画面 object-fit: cover 裁切。 */
    height: 92px; border-radius: 8px;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.22));
    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.12));
  }
  .we-qp__card img {
    position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: cover; display: block;
    opacity: 0; transition: opacity 0.2s ease;
  }
  .we-qp__card--current {
    border-color: color-mix(in srgb, var(--we-accent, #4f8cff) 60%, transparent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--we-accent, #4f8cff) 60%, transparent);
  }
  .we-qp__card-title {
    position: absolute; left: 0; right: 0; bottom: 0; padding: 14px 6px 4px;
    font-size: 0.78em; line-height: 1.2; color: #fff;
    background: linear-gradient(transparent, rgba(0, 0, 0, 0.72));
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .we-qp__card-type {
    position: absolute; top: 4px; left: 4px; padding: 1px 5px;
    font-size: 0.7em; line-height: 1.5; border-radius: 4px;
    color: #fff; background: rgba(0, 0, 0, 0.55);
  }
  .we-qp__card-badge {
    position: absolute; top: 4px; right: 4px; padding: 1px 5px;
    font-size: 0.7em; line-height: 1.5; border-radius: 4px; font-weight: 600;
    color: #fff; background: color-mix(in srgb, var(--we-accent, #4f8cff) 88%, transparent);
  }
  .we-qp__card-empty {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    font-size: 0.75em; color: var(--we-ink-3, rgba(128, 128, 128, 0.65));
  }
  .we-qp__item {
    display: flex; align-items: center; gap: 8px;
    min-height: 34px; padding: 2px 6px; border-radius: 8px; cursor: pointer;
    border: 1px solid transparent;
    transition: background-color var(--we-dur-fast, 120ms) var(--we-ease, ease);
  }
  .we-qp__item:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.12)); }
  .we-qp__item--current {
    border-color: color-mix(in srgb, var(--we-accent, #4f8cff) 45%, transparent);
    background: color-mix(in srgb, var(--we-accent, #4f8cff) 10%, transparent);
  }
  .we-qp__item-thumb {
    flex: none; width: 40px; height: 24px; border-radius: 4px; overflow: hidden;
    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.12));
  }
  .we-qp__item-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .we-qp__item-badge { flex: none; font-size: 0.78em; font-weight: 600; color: var(--we-accent, #4f8cff); }
  .we-qp__item-type { flex: none; font-size: 0.78em; color: var(--we-ink-3, rgba(128, 128, 128, 0.65)); }
  .we-qp__foot {
    display: flex; padding-top: 10px;
    border-top: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.22));
  }
  .we-qp__settings { flex: 1; }
  /* 焦点环与 .we-picker 同规格（accent 2px + 外偏移）。 */
  .we-qp button:focus-visible, .we-qp select:focus-visible,
  .we-qp input:focus-visible, .we-qp [role="option"]:focus-visible {
    outline: 2px solid var(--we-accent, #4f8cff);
    outline-offset: 2px;
  }
  /* No backdrop-filter support: near-opaque tinted surface, same policy as the
     settings-window/sidebar fallbacks, so panel text stays readable. */
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
body[data-we-glass-floaters] .we-repo-panel {
      background-color: color-mix(in srgb, var(--we-surface-tint-light, #ffffff) 92%, transparent);
      backdrop-filter: none; -webkit-backdrop-filter: none;
    }
  }

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
  body[data-we-glass-fallback][data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_boundaryError"],
  body[data-we-glass-fallback][data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_panel"],
  body[data-we-glass-fallback][data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_pane"],
  body[data-we-glass-fallback][data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_tabBar"],
  body[data-we-glass-fallback][data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_paneCard"],
  body[data-we-glass-fallback][data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_editorHeader"],
  body[data-we-glass-fallback][data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_explorerHeader"],
  body[data-we-glass-fallback][data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_gitHeader"],
  body[data-we-glass-fallback][data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_browserBar"],
  body[data-we-glass-fallback][data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_terminalWrap"] {
    background-color: color-mix(in srgb, var(--we-sidebar-color) 92%, transparent) !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
  body[data-we-glass-fallback][data-we-sidebar-glass] [data-sidebar-right-panel][data-sidebar-right-open] {
    background-color: color-mix(in srgb, var(--we-sidebar-color) 92%, transparent) !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
  /* 左侧栏液态玻璃（leftSidebarGlass）：软件光栅器下模糊被静默忽略 ⇒ 与上面各条同一配方，
     钉成 92% 近不透明玻璃并把不会生效的 backdrop-filter 显式关掉。深色那条多一层
     [data-ds-dark-theme]，与浅色声明同特异度时后写者赢（顺序即优先级）。 */
  body[data-we-glass-fallback][data-we-glass-page][data-we-left-sidebar] div:has(> [data-slot="sidebar"]) {
    background-color: color-mix(in srgb, var(--we-surface-tint-light, #ffffff) 92%, transparent) !important;
    background-image: none !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
  /* issue #131：模糊已搬到列自身的 ::before 上；软件光栅器下同样要显式关掉
     （同一政策：不会生效的 backdrop-filter 不留着）。一条覆盖深浅两色。 */
  body[data-we-glass-fallback][data-we-glass-page][data-we-left-sidebar] div:has(> [data-slot="sidebar"])::before {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
  body[data-ds-dark-theme][data-we-glass-fallback][data-we-glass-page][data-we-left-sidebar] div:has(> [data-slot="sidebar"]) {
    background-color: color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) 92%, transparent) !important;
  }
  /* 标题栏液态玻璃（titlebarGlass）：与上面左栏那两条**同一政策** —— 软件光栅器下模糊被
     静默忽略，钉成 92% 近不透明玻璃并把不会生效的 backdrop-filter 显式关掉；深色那条多
     一层 [data-ds-dark-theme]，与浅色声明同特异度时后写者赢（顺序即优先级）。
     ⚠️ 锚点与主块同口径（含 html[data-windows-titlebar] 那道门）：软件渲染时壁纸层
        往往没走 GPU 合成，这条是那批形态唯一的兜底。 */
  html[data-windows-titlebar] body[data-we-glass-fallback][data-we-glass-page][data-we-titlebar-glass][data-we-adapter^="desktop-"] div[class*="pI_x6G_frame"]::before {
    background: color-mix(in srgb, var(--we-surface-tint-light, #ffffff) 92%, transparent) !important;
  }
  /* ⚠️ 模糊现在住在 ::after 上（见主块的两条规则）⇒ 软件光栅器下要关的是**它**，
     不是 ::before —— 关错对象就等于没关（不留不会生效的声明）。 */
  html[data-windows-titlebar] body[data-we-glass-fallback][data-we-glass-page][data-we-titlebar-glass][data-we-adapter^="desktop-"] div[class*="pI_x6G_frame"]::after {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
  html[data-windows-titlebar] body[data-ds-dark-theme][data-we-glass-fallback][data-we-glass-page][data-we-titlebar-glass][data-we-adapter^="desktop-"] div[class*="pI_x6G_frame"]::before {
    background: color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) 92%, transparent) !important;
  }
  /* 内容面（编辑器/终端）本来就是近不透明底板（--we-content-surface-alpha，默认
     88%），这里把同一条声明再挂一遍，让软件渲染下三块侧栏区域落在同一个规则块里。 */
  body[data-we-glass-fallback][data-we-sidebar-glass] [data-dsh-better-sidebar] .cm-editor,
  body[data-we-glass-fallback][data-we-sidebar-glass] [data-dsh-better-sidebar] .xterm,
  body[data-we-glass-fallback][data-we-sidebar-glass] [data-sidebar-right-panel][data-sidebar-right-open] .cm-editor,
  body[data-we-glass-fallback][data-we-sidebar-glass] [data-sidebar-right-panel][data-sidebar-right-open] .xterm {
    background-color: color-mix(in srgb, var(--we-content-surface-color, var(--we-panel-color, #1e1f26)) max(calc(var(--we-readability-floor) * 100%), var(--we-content-surface-alpha, 88%)), transparent) !important;
  }
  /* 设置窗口：把三层面板 token 钉回实色（@supports 回退里的同一条 token 覆写），
     并显式关掉不会生效的 backdrop-filter。 */
  body[data-we-glass-fallback][data-we-glass-window] [role="dialog"]:has([data-slot="settings.section"]) {
    --dsw-alias-bg-layer-1: var(--we-surface-tint-light, #ffffff);
    --dsw-alias-bg-layer-2: var(--we-surface-tint-light, #ffffff);
    --dsw-alias-bg-layer-3: var(--we-surface-tint-light, #ffffff);
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
  body[data-ds-dark-theme][data-we-glass-fallback][data-we-glass-window] [role="dialog"]:has([data-slot="settings.section"]) {
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

  /* ── 「关于」页签：静态页（简介 / 致谢 / 仓库 / 交流群二维码）──
     排版口径与设置行一致：正文走主题墨色 token（不新造颜色），只有二维码卡片
     自带一层极薄的玻璃底衬 —— 码图本身是**不透明白底 PNG**，深色主题下若直接
     贴在玻璃上会像一块补丁，故给它圆角 + 边框 + 一点呼吸空间。 */
  .we-about__lead { display: flex; flex-direction: column; gap: 8px; }
  .we-about__lead-title { font-size: 0.95em; font-weight: 600; color: var(--we-ink, inherit); }
  .we-about__p { margin: 0; font-size: 0.82em; line-height: 1.65; color: var(--we-ink-2, rgba(128, 128, 128, 0.9)); }
  .we-about__credits { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; }
  .we-about__credit { font-size: 0.8em; line-height: 1.6; color: var(--we-ink-2, rgba(128, 128, 128, 0.9)); }
  .we-about__star-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
  .we-about__star { font-size: 0.85em; font-weight: 600; }
  /* 实时 star 数（宿主代取）：跟着按钮同一行，数字用等宽数字位避免跳数时抖动。 */
  .we-about__stars {
    font-size: 0.85em; font-weight: 600; color: var(--we-ink, inherit);
    font-variant-numeric: tabular-nums;
  }
  /* 仓库地址：可选中、可整段复制的裸文本（外链唤起与否不由插件说了算 ⇒ 留兜底）。 */
  .we-about__url-row { display: flex; flex-direction: column; gap: 4px; }
  .we-about__url {
    display: block; padding: 6px 8px; border-radius: var(--we-ui-radius, 8px);
    border: 1px dashed var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.08));
    font-size: 0.75em; line-height: 1.4; color: var(--we-ink-2, rgba(128, 128, 128, 0.9));
    user-select: text; word-break: break-all;
  }
  /* 两张二维码并排（各 240px 起），容器不够宽就换行堆叠 —— 抽屉那种窄壳里
     一张一行，码图反而更大（扫码成功率优先于"排得整齐"）。 */
  .we-about__qr-row { display: flex; flex-wrap: wrap; gap: 12px; }
  .we-about__qr {
    flex: 1 1 240px; min-width: 0; margin: 0;
    display: flex; flex-direction: column; align-items: center; gap: 6px;
    padding: 10px 10px 8px;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.28));
    border-radius: 12px; background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.08));
  }
  .we-about__qr-title { font-size: 0.78em; color: var(--we-ink, inherit); text-align: center; }
  .we-about__qr-img {
    display: block; width: 100%; height: auto; max-width: 320px;
    /* 码图自带白底：圆角 + 白底让它在深色主题里也读得出边界。 */
    border-radius: 10px; background: #fff;
  }
  .we-about__qr-hint { font-size: 0.7em; color: var(--we-ink-3, rgba(128, 128, 128, 0.65)); text-align: center; }
  .we-about__foot { text-align: center; }

  /* ── 「扩展」页签：模块槽位（注册表见 panel-tabs.js 的 extensionModules()）──
     每个模块一张卡：极薄的玻璃底衬 + 圆角，与「关于」页的二维码卡同一口径
     （不新造颜色，只取主题墨色 / 边框 token）。表里一张模块都没有时只画空态，
     所以下面这几条在没有模块的版本里没有渲染对象。 */
  .we-ext { display: flex; flex-direction: column; gap: 10px; }
  .we-ext__module {
    display: flex; flex-direction: column; gap: 6px; padding: 10px;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.28));
    border-radius: 12px; background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.08));
  }
  .we-ext__module-head { display: flex; align-items: center; gap: 8px; }
  .we-ext__module-title { font-size: 0.85em; font-weight: 600; color: var(--we-ink, inherit); }

  /* ── 「扩展」页签一号模块：自定义会话头像（装饰层见 src/avatar-layer.js）──
     这一层是**宿主会话 DOM 的补丁**：给三类消息行（data-chat-flow-kind = user / steering /
     assistant-step）在最前面插一个 .we-avatar，行本身改横向 flex ⇒ 头像与消息并排；
     用户行反过来（row-reverse）⇒ 先插的那个节点落在最右，于是"你的消息在右、助手在左"。
     关掉开关时节点与属性都被装饰层撤掉 ⇒ 屏上一点痕迹都没有（下面每条规则都挂在开关属性下，
     与思考块玻璃 / 视差同一条门控纪律）。
     尺寸与圆角来自 body 上的两个变量（装饰层按设置写）⇒ 拖滑块只是**变量替换**，不重建节点；
     头像是**一个圆脸**（没导入图就画内置的默认头像 SVG），宽度固定为边长 ⇒ 长消息不会被挤。
     ⚠️ **没有自定义名字行**（用户口径）：这里不要再加名字。

     ⚠️⚠️ 内容那一格必须**穿透槽出口锚点**（issue #154）：宿主把节点渲染包在
     div[data-slot="conversation.chat.node"] 里，并给它写死内联 style="display: contents"
     （宿主 renderer 的 ANCHOR_STYLE，注释明说要让 flex/grid 父级"看见槽自己的孩子"）⇒ 这层
     **没有盒子**：它既不是 flex item，也不接受 flex 属性。所以只写 > :not(.we-avatar) 是
     **打在空气上**——真正成为 flex item 的是锚点的孩子（助手消息的内容根 div.v5IAXa_root），
     它会退回默认 flex: 0 1 auto、主轴尺寸按自身 max-content 算，不再"填满行"；而宿主给
     **收起**状态的思考行写死 contain: size layout（固有尺寸 = 0）⇒ 一行可见内容只剩
     "思考"折叠行时 max-content = 0 ⇒ 该 item 宽 0px，整条消息连着入口一起消失（展开时
     contain:size 失效才可见，再收起又归零 = "关掉后找不到重新打开位置"）。
     故两条选择器都写：直挂内容 + 锚点后面那一层；flex-grow: 1 是这里的要害
     （固有宽为 0 的内容也靠 grow 撑满行）。判据见 test/verify-scene-live.mjs（头像段 CSS 钉法
     + 假 DOM 照宿主真实形态造锚点）。**这一段不许出现反引号**：整套样式文本是被塞进产物里的
     模板字符串，一个反引号就能把 JS 拼断（build-client 会当场报"产物语法错误"）。 */
  body[data-we-avatar="on"] [data-we-avatar-row] { display: flex; align-items: flex-start; gap: 8px; }
  body[data-we-avatar="on"] [data-we-avatar-row="user"] { flex-direction: row-reverse; }
  body[data-we-avatar="on"] [data-we-avatar-row] > :not(.we-avatar),
  body[data-we-avatar="on"] [data-we-avatar-row] > [data-slot] > :not(.we-avatar) { flex: 1 1 auto; min-width: 0; }
  .we-avatar {
    box-sizing: border-box; flex: 0 0 auto; display: flex; align-items: center; justify-content: center;
    width: var(--we-avatar-size, 40px); height: var(--we-avatar-size, 40px);
    border-radius: calc(var(--we-avatar-round, 100) * 0.5%);
    overflow: hidden;
    color: var(--dsw-alias-label-secondary, currentColor);
    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.16));
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.28));
  }
  .we-avatar__img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .we-avatar__glyph { display: flex; align-items: center; justify-content: center; }
  .we-avatar__glyph svg { width: 62%; height: 62%; }
  /* 面板里的预览：固定框（不随滑块长高），里头那张脸按当前大小 / 圆角现画。
     预览用的是自己的一对类名（不是 .we-avatar）—— 那些节点由装饰层建在会话里，
     面板这一份是 React 画的，两边共用的是"零件表与 URL"而不是 DOM 结构。 */
  .we-avatar-preview {
    box-sizing: border-box; flex: 0 0 auto; display: flex; align-items: center; justify-content: center;
    border: 1px dashed var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.28));
    border-radius: 10px;
  }
  .we-avatar-preview__face {
    box-sizing: border-box; display: flex; align-items: center; justify-content: center;
    overflow: hidden;
    color: var(--dsw-alias-label-secondary, currentColor);
    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.16));
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.28));
  }
  .we-avatar-preview__img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .we-avatar-preview__glyph { display: flex; align-items: center; justify-content: center; }
  .we-avatar-preview__glyph svg { width: 62%; height: 62%; }
  .we-avatar-error { font-size: 0.82em; opacity: 0.9; color: #e5534b; }
  /* 自定义立绘那一格（「系统」页签 · 聊天吉祥物）：与形态卡片同一个画框口径 ——
     固定尺寸的透明底小舞台，图各自按自己的宽高比 contain 进去。未导入时画一句
     「未导入」占位（虚线框），导入后画的是**用户那张图**（与主页面那只同一份盒）。 */
  /* 卡片排里的「清除」：与卡片同排但**不拉伸**（flex 行默认 stretch，按钮会被拉成
     与卡片一样高）。 */
  .we-picker__mascot-clear { align-self: center; }
  .we-picker__mascot-custom-art {
    display: flex; align-items: center; justify-content: center;
    border: 1px dashed var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.28)); border-radius: 10px;
  }
  .we-picker__mascot-custom-art img { display: block; width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
  .we-picker__mascot-empty {
    display: flex; align-items: center; justify-content: center;
    font-size: 1.2em; line-height: 1; color: var(--dsw-alias-label-tertiary, rgba(128, 128, 128, 0.8));
  }

  /* ── 「扩展」二号模块：点击效果与拖尾效果（画布层见 src/fx-layer.js）──
     与 .we-layer / .we-scrim 同族：body 级的整屏浮层 ⇒ 同样必须
     pointer-events: none; -webkit-app-region: initial !important（同族的硬要求，
     见 test/verify-host-paint-scope.mjs H3）。
     z-index -1、靠文档序压在暗化层之上（见 src/fx-layer.js 的 fxPlace），
     所以这一层是"壁纸之上、暗化层之上、全部界面之下"。
     宽高恒为整屏：点击/拖尾的坐标直接取指针的视口坐标，不用做偏移换算。
     opacity（不透明度）与 mix-blend-mode（混合模式）由画布层按设置内联写在宿主上 ——
     写在画布上只跟宿主自己的 stacking context 混合 = 不生效，这里两者都不写死。
     body 上没有壁纸层标记时整层不画（连空画布都不留）。 */
  .we-fx { display: none; }
  body[data-we-wallpaper="on"] .we-fx {
    display: block;
    position: fixed; left: 0; top: 0; width: 100%; height: 100%;
    z-index: -1; overflow: hidden;
    pointer-events: none; -webkit-app-region: initial !important;
  }
  .we-fx__canvas { display: block; width: 100%; height: 100%; }

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
     保留：backdrop-filter 照旧 —— 模糊 / 饱和仍由侧栏模糊与全局雾化旋钮管（要彻底
     清晰就把模糊调 0）；内容面（编辑器 / 终端底板）不归本开关管，仍有自己的透明度
     旋钮。只在壁纸下生效：无壁纸时侧栏压着的是聊天界面，全透不可读。 */
  body[data-we-wallpaper][data-we-sidebar-fullclear] [data-dsh-better-sidebar],
  body[data-we-wallpaper][data-we-sidebar-fullclear] [data-sidebar-right-panel][data-sidebar-right-open] {
    --we-readability-floor: 0;
    --we-sidebar-tint: 0%;
    --we-sidebar-color: transparent;
    --we-sidebar-sheen: 0;
    --we-sidebar-sheen-a: 0;
    --we-sidebar-sheen-b: 0;
    --we-sidebar-sheen-c: 0;
  }
  body[data-we-wallpaper][data-we-sidebar-fullclear] [data-sidebar-right-panel][data-sidebar-right-open] {
    background-color: transparent !important;
    background-image: none !important;
  }
  body[data-we-wallpaper][data-we-sidebar-fullclear][data-we-left-sidebar] div:has(> [data-slot="sidebar"]),
  body[data-ds-dark-theme][data-we-wallpaper][data-we-sidebar-fullclear][data-we-left-sidebar] div:has(> [data-slot="sidebar"]) {
    background-color: transparent !important;
    background-image: none !important;
  }

  /* ── 「扩展」三号模块：3D 效果（视差；行为层见 src/parallax-layer.js）──
     这一层与前面几层刚好相反：**它一个 DOM 节点都不建**。位移由行为层每帧**直接写进
     .we-layer / .we-rope 自己的** translate（CSS 独立属性）—— 每帧一个自定义属性都不写，
     因为自定义属性是继承的，写一次就会让整棵子树重算样式。所以样式表这边只剩两件事：
     ① body 上的一个"壁纸补边系数"（只在设置变了时写一次）算出 .we-layer 的**静态**放大 ——
        壁纸层正好是视口大小，横向最大位移 = 系数/100 × 整屏宽（系数 = 光标在屏幕角上时挪几个百分点的对角线
         ⇒ 2 × 系数/100 × 半屏宽 = 系数/100 × 屏宽），放大 1 + 系数/50 恰好补上这点余量；
     ② 一个总开关属性 data-we-parallax：只有它在时**下面那条**补边规则才命中；关掉 ⇒ 屏上一点
        痕迹都没有（位移由行为层 removeProperty 收干净）。
     这么写有两个好处：① 不新增节点 ⇒ 不参与 stacking、不会被别的层顺手清掉；
     ② 关掉总开关时连属性都不在 ⇒ 补边与位移一起消失。
     硬约束：**只能用 CSS 独立属性 translate / scale，不能用 transform** —— 壁纸层的过场
     （src/live-layer.js 的 resetLayerSwitchStyles）与 .we-layer--repaint 会内联写 / 清
     transform，独立属性才与它们叠加，而不是互相覆盖。
     系数口径：**光标贴在屏幕角上时，该层挪"它那个系数"个百分点的最长对角线**
     （推导见行为层文件头）；系数由行为层乘进位移里（壁纸走 parallaxBg、吉祥物走
     parallaxMascot、界面四组各走自己的 parallaxUi*Depth）。
     兜底是 0：变量还没写上时放大倍数为 1（例如刚开开关、第一帧还没跑）。
     **点击与拖尾那一层刻意不参与**（用户口径：特效不跟着偏移）。 */
  body[data-we-parallax="on"] .we-layer {
    scale: calc(1 + var(--we-parallax-bg, 0) / 50);
  }
  /* 只有"正在动的那几帧"才把它们提成独立合成层：提上去之后每帧只是挪现成的纹理，
     合成器直接做，不必把满屏壁纸重绘一遍。类由行为层在起帧时加上、到位收工与关掉总开关时
     摘掉 —— 本仓刻意不留**常驻**合成层（见 .we-layer--repaint 的两帧微推）。
     只提示 translate：scale 是静态的，不提它就不会被冻结栅格化倍率。 */
  body[data-we-parallax="on"] .we-parallax--moving { will-change: translate; }
  /* 界面跟随那一组挪的是会话滚动容器**里面**的真实元素（见 src/parallax-layer.js 的
     PARALLAX_GROUP_SELECTOR），于是多出一个副作用：横向位移一旦越出 scroller 的 inline-end，
     宿主写在它身上的 overflow-y: auto 会把这一轴的 overflow-x: visible 当 auto 用（规范：一轴
     不是 visible 时另一轴的 visible 计算成 auto）⇒ 长出一条**横向滚动条**。它占掉约一条滚动条高的
     scrollport——sticky 的输入卡片只能跟着上移，于是"输入框底部出现一个黑条，把输入框顶上去"；
     光标跨过屏幕中线时位移换向 ⇒ 滚动条出没 ⇒ 输入框与文本区一起抖。
     会话内容本来就不横滚（长 token / 宽代码块都在自己的框里滚）⇒ 开着视差时直接封掉这一轴：
     滚动条连出现的机会都没有，scrollport 高度一动不动，位移照旧。
     用 hidden 而不是 clip：两者都只裁不滚，hidden 的支持面更广（clip 是 CSS Overflow 3）。 */
  body[data-we-parallax="on"] [data-conversation-scroll] { overflow-x: hidden; }
`;

export { READABILITY_FLOOR, READABILITY_FLOOR_DARK, CSS };
