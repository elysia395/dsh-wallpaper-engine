/**
 * styles-base.js —— 样式域模块 **BASE**（原 src/styles.js 第 61–592 行，共 532 行）。
 *
 * 内容：基础面 —— 画布兜底底色 · 页面玻璃总锚点与表面令牌 · markdown 底（含深色档）· color-scheme 对比度 · 全局 UI 配色 · 文字面可读性下限。
 *
 * 本文件同时是 READABILITY_FLOOR / READABILITY_FLOOR_DARK 的宿主：原文件纪律要求「可读性下限常量必须和
 * 消费它的 CSS 同处一文件」（数值的来龙去脉见下方原注释），组装点仍对外导出这两个名字 ⇒ 消费侧读到的
 * 仍是同处一文件的数值。
 *
 * 拼装契约（样式族 9 个模块共享，组装点见 src/styles.js）：
 *   · 构建期按 INLINE_MODULES 顺序把族内文件**原样内联进同一工厂作用域**，模块之间不 import，靠扁平符号协作
 *     （见 docs/CODE-STRUCTURE.md §3）；
 *   · 本段模板以**换行**开头（承接原单模板开引号后的那个换行）；其余 7 个域段的开引号紧跟该段首行，
 *     段间那一个换行由上一段的收尾换行提供；
 *   · 组装点按 BASE → SHELL → SIDEBAR → CHROME → SETTINGS → PANEL → QUICK → EXT 相加 ⇒ 拼出的 CSS 与原单模板
 *     **逐字节相同**（分割前 sha256 前缀 3b6c41dc7dcab44bf5c57f4 · 262306 B）。
 *
 * ⚠️ 本文件（注释与正文）不得出现裸反引号，也不得复述任何样式表声明语句的字面量：守卫按行首的域模板
 *    声明从**产物**里抽取模板，散文里出现同样的字面量或反引号会把锚点带偏。
 *
 * 契约：需要的外界**无**；对外提供本域的样式表常量。不变量：浏览器安全（无 import / require / Node API）、
 * 不得有顶层可执行语句去读宿主状态（内联位置早于 client.js 正文）、整体是**纯数据**。
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
const CSS_BASE = `
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
  /* 兜底清底（原生浏览器形态）：上面两组「让开」只清 token（--dsw-alias-bg-base /
     --dsw-specific-sidebar-fill），前提是宿主主容器**读**这些 token —— 宿主新构建的
     主容器已自带实心底、不再消费它们（computed 为实心 rgb(10,10,10)）⇒ token 清底
     落空，body 的 z-index:-1 壁纸层被整片盖死（画面在播、控制台零报错）。
     这里直接清**宿主自身的容器类**兜底，与 token 清底互为保险：
       · 与"谁读哪个 token"解耦 —— 对宿主 token 消费链的版本漂移免疫（同 .dshDesktopFrame
         那条的写法：壁纸激活时一律清底，不赌宿主当前的消费实现）；
       · 只在壁纸在台（data-we-wallpaper）且**原生浏览器形态**（data-we-adapter=browser）
         生效 —— 桌面壳的窗口材质让开由既有规则自理，本组不参与；
       · 无壁纸时不生效：页面保持宿主原色（与"让开只让开、不设色"的口径一致）。
     宿主类名是 CSS-module 哈希（pI_x6G_frame 等），只能按后缀约定匹配 —— 与
     [class*="_bubble"] / [class*="_card"] 同一套做法。 */
  body[data-we-wallpaper][data-we-adapter="browser"],
  body[data-we-wallpaper][data-we-adapter="browser"] [class*="_frame"],
  body[data-we-wallpaper][data-we-adapter="browser"] [class*="_root"] {
    background: transparent !important;
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

  /* ── 全局 UI 配色：把宿主界面里那几处「蓝色元素」接进调色板 ────────────────────
     用户口径：「我给你图片里面这些蓝色的东西也要加入配色修改」——
     症状是它们**从来不跟着「配色」变**。

     根因（在 DSH 产物 CSS 里实证，不是推断）：本插件此前**一处都没改过**这几个令牌 ——
     button-info-fill / link / label-deep-diving 各 0 处；而 state-business-primary 虽有
     3 处，却只落在**设置对话框 / 左栏 / 右栏**的作用域里，主会话区不在其中 ⇒ 页面上的蓝
     全停在宿主原生色。

     令牌 → 宿主消费者（逐条实测自 DSH 产物 CSS）：
       · 发送键（输入区主按钮，34×34 圆）　button-info-fill（:hover 用 -info-hover）
             ⚠️ 它的箭头是宿主**写死的 color:#fff**（不是令牌）⇒ 只能改填充、改不了字形。
                故该项只提供色板里的中间调；若用户经取色器选到极浅色，白箭头会不可读 ——
                这是宿主契约的限制，已在面板 tooltip 里写明。
       · 链接文字　　　　　　　link
       · 文件图标（</> 那个）　　 link —— **与链接同令牌** ⇒ 靠 [data-presented-file] 作用域
             覆盖分开。该锚点是宿主自带的（span[data-presented-file] 包着 FileTypeIcon，
             实测自 dsh-client-ui-deliverables 的 JSX），不是猜模块哈希。
       · 会话页签 + 下划线　　state-business-primary（tabActive 与它的 :after）
       · 「深度求索中…」文字　label-deep-diving（-shimmer 是它的微光伴生）

     ⚠️ 变量**恒定义**（effects.js 里空值即 accent）⇒ 关着「UI 配色自定义」时这几处照样
        跟「全局配色」走 —— 那正是用户口径「全局配色用于直接调整全部」。不存在"关掉就不染"
        的档位，只有"这些行显不显示"。
     ⚠️ 页签那一项设在 body 级：state-business-primary 的消费者不止页签（还有焦点环与几处
        状态标记），它们一起跟色才自洽 —— 面板里的标签如实写作「页签 / 焦点环」。
     ⚠️ 锚点一律取宿主自带的 data-* 属性；本仓纪律：**不猜 CSS 模块哈希**。
     ⚠️ 本段在**模板字符串**里：注释内**不许出现反引号**（会把 CSS 字符串提前终止，
        build-client 报 "postfix operation" 一类的怪错）。示范令牌名时不加引号。 */
  body[data-we-glass-page] {
    --dsw-alias-link: var(--we-ui-link, #4f8cff);
    --dsw-alias-label-deep-diving: var(--we-ui-deep-diving, #4f8cff);
    /* 微光伴生色：由主色推出（往白里提一档），不新增设置键。 */
    --dsw-alias-label-deep-diving-shimmer: color-mix(in srgb, var(--we-ui-deep-diving, #4f8cff) 62%, #ffffff);
    --dsw-alias-state-business-primary: var(--we-ui-tab, #4f8cff);
  }
  /* 全局 UI 配色的**深色孪生块**：本组映射其实**与主题无关**（四个值全部来自 --we-ui-*，
     浅深两档取值逐字相同），单独写一份是**本仓约定**而非主题分叉 ——
     verify-glass-compositing 的 G8 要求「任何 alias 接管都必须在浅 / 深两个 body 级块里
     各出现一次」，它防的是"只改浅色、漏了深色孪生"那类漂移。缺了这一块 G8 会判红，
     而那个红是对的牙 —— 不为自己的功能把守卫放松。 */
  body[data-ds-dark-theme][data-we-glass-page] {
    --dsw-alias-link: var(--we-ui-link, #4f8cff);
    --dsw-alias-label-deep-diving: var(--we-ui-deep-diving, #4f8cff);
    --dsw-alias-label-deep-diving-shimmer: color-mix(in srgb, var(--we-ui-deep-diving, #4f8cff) 62%, #ffffff);
    --dsw-alias-state-business-primary: var(--we-ui-tab, #4f8cff);
  }
  /* 发送键：填充 + 悬停（悬停往黑压一档，与宿主原来的 fill→hover 明暗关系同向）。
     ⚠️ 作用域用 data-composer-seat（输入**座位**，宿主自带锚点）而**不是**
        data-composer-card：后者是 verify-glass-surfaces 的 W5 用来认「对话玻璃子面」的
        成员选择器（见那里 GATE 表 glass-child-conversation 的 member 正则），本条却是
        **纯配色**规则、不画任何釉层 —— 写上它会被那条守卫算成"该子面有一条无门控规则"，
        判红且判错（真正的失效模式是"关掉对话玻璃后还剩玻璃味"，与本条无关）。
        座位是输入卡的**祖先**（宿主：座位里就有 data-composer-card），覆盖范围等价、
        锚点同样是宿主的稳定 data-* 属性 ⇒ 不改产品行为，只避免被误归类。 */
  body[data-we-glass-page] [data-composer-seat] {
    --dsw-alias-button-info-fill: var(--we-ui-send, #4f8cff);
    --dsw-alias-button-info-hover: color-mix(in srgb, var(--we-ui-send, #4f8cff) 82%, #000000);
  }
  /* 文件图标（</>）：同令牌的第二处作用域 ⇒ 内层更近的祖先胜出，于是与「链接文字」分开可调。
     锚点对不上时（宿主改结构）本条不匹配，图标回落成「跟随链接文字」——**优雅降级**，不炸。 */
  body[data-we-glass-page] [data-presented-file] {
    --dsw-alias-link: var(--we-ui-file-icon, #4f8cff);
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
    /* ── #164：原生 select 弹层的行配对（不透明底 + 与底成对比的墨）────────────
       Chromium 的弹层是一份**独立文档**：画布只在 select 自身背景**不透明**时才取
       它的底色，否则落回默认浅色画布；而选项文字**继承** select 的墨色 —— 我们的
       select 是透明玻璃底、墨色又可以是用户自定义的任意色，于是"浅字浅底"。这两条
       缺省 = 主题默认配对（面板底色 + 宿主正文墨），未自定义墨色时逐位还原现状。
       用户把"正文"角色改成浅色时，effects.js 按对比度重算这一对并覆盖
       --we-popup-row-bg-light / -ink-light（深色档同理），两档都写、由这里按主题挑
       —— 与 --we-surface-tint-light / -dark 同法，省掉一个主题观察者。 */
    --we-popup-row-bg: var(--we-popup-row-bg-light, var(--we-panel-color, #ffffff));
    --we-popup-row-ink: var(--we-popup-row-ink-light, var(--dsw-alias-label-primary, #1f2328));
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
    /* #164 深色档：见浅色块的说明。缺省墨用深色主题惯用的浅字，未自定义时逐位还原现状。 */
    --we-popup-row-bg: var(--we-popup-row-bg-dark, var(--we-panel-color, #1e1f26));
    --we-popup-row-ink: var(--we-popup-row-ink-dark, var(--dsw-alias-label-primary, #e6e8eb));
  }

`;

export { CSS_BASE };
