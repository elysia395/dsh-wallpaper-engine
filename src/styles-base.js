/**
 * styles-base.js —— 样式域模块 **BASE**。
 *
 * 内容（ADR-0016 第四刀玻璃段出户后）—— 画布兜底底色 · 壁纸让位（页面基色 / 侧栏填充 / 宿主清底）·
 * 全局 UI 配色 · 面板色与弹层行配对。玻璃的令牌映射、markdown 底与可读性下限常量
 * 随玻璃包走（packages/glass/src/glass-css.js）。
 *
 * 拼装契约（样式族 7 个域模块共享，组装点见 src/styles.js）：
 *   · 构建期按 INLINE_MODULES 顺序把族内文件**原样内联进同一工厂作用域**，模块之间不 import，靠扁平符号协作
 *     （见 docs/CODE-STRUCTURE.md §3）；
 *   · 本段模板以**换行**开头（承接原单模板开引号后的那个换行）；其余 6 个域段的开引号紧跟该段首行，
 *     段间那一个换行由上一段的收尾换行提供；
 *   · 主包样式 = 7 个域模块按 BASE → SHELL → CHROME → SETTINGS → PANEL → QUICK → EXT 相加，
 *     组装点 = src/styles.js；玻璃 CSS 不在这条链上 —— 它住 packages/glass/src/glass-css.js
 *     （CSS_GLASS），由玻璃包自注入；两份样式表是**双工件**（守卫按「主包产物 + 玻璃产物」拼接读取）。
 *
 * ⚠️ 本文件（注释与正文）不得出现裸反引号，也不得复述任何样式表声明语句的字面量：守卫按行首的域模板
 *    声明从**产物**里抽取模板，散文里出现同样的字面量或反引号会把锚点带偏。
 *
 * 契约：需要的外界**无**；对外提供本域的样式表常量。不变量：浏览器安全（无 import / require / Node API）、
 * 不得有顶层可执行语句去读宿主状态（内联位置早于 client.js 正文）、整体是**纯数据**。
 */

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
  /* Picture wallpaper slideshow: the two crossfade layers stack over the base
     cover image inside .we-layer. Without this they would flow as block-level
     siblings and push each other down the page. */
  .we-layer .we-slide { position: absolute; inset: 0; }

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
     all columns share the same wallpaper+scrim background. 页面基色让位**只属于壁纸**：
     壁纸层挂在 body 的 z-index:-1 上，页面基色必须让开才看得见；无壁纸时保持宿主原色。
     ⚠️ 侧栏填充的让位**只属于玻璃**（ADR-0016 第四刀勘误）：玻璃的侧栏配方随玻璃行走后，
     产品口径（2026-10-29 修订）：侧栏填充只挂壁纸门——插件/玻璃行关闭时侧栏主体透明，
     壁纸从侧栏透出；玻璃行开启且左栏玻璃开关关闭时同样是透明洞，打开才由玻璃配方接管。
     ⚠️ !important 是**跨插件契约**，不是防御性写法：DSH 的主题 API 允许插件用
     ctx.theme.overrideTokens 给宿主上色，而宿主把合成后的令牌以**内联样式**写在
     <body> 上（DS Bot 的 Bot 模式就是这么做的）。内联声明在普通作者声明里压过一切，
     这两族规则若按普通声明写就整块失效 ⇒ 页面基色 / 侧栏填充保持不透明，壁纸层被盖死
     （现场症状：DS Bot 模式下壁纸完全不可见）。作者 !important 声明按层叠规则压过
     内联普通声明，因此壁纸在场期间页面背景令牌归本插件；壁纸退场后这些块不匹配，
     内联值原样生效 —— 单向接管，不读不写对方任何状态。
     ⚠️ 基色与侧栏填充都只挂壁纸门（浅深各一）；侧栏填充不再要求玻璃行开启。
     !important 必须都写：只补基色 ⇒ 侧栏填充仍输给内联值。 */
  body[data-we-wallpaper] {
    --dsw-alias-bg-base: transparent !important;
    --dsw-specific-sidebar-fill: transparent !important;
  }
  body[data-ds-dark-theme][data-we-wallpaper] {
    --dsw-alias-bg-base: transparent !important;
    --dsw-specific-sidebar-fill: transparent !important;
  }

  /* 壁纸仅清宿主挂载点的外壳；不得按类名子串清任意插件子树。 */
  body[data-we-wallpaper][data-we-adapter="browser"],
  body[data-we-wallpaper][data-we-adapter="browser"] > #root > [class*="_frame"]:not([data-we-surface-preserve]),
  body[data-we-wallpaper][data-we-adapter="browser"] > #root > [class*="_frame"]:not([data-we-surface-preserve]) > [class*="_root"]:not([data-we-surface-preserve]) {
    background: transparent !important;
  }

  /* 桌面壳 AppFrame 本体：宿主自己的 CSS 就用这个锚点给它上底（DSH NEXT 注入的
     html[data-next-material='off'] :has(> [data-shell-overlay])，以及官方 layout 的
     [data-windows-titlebar] ._frame { background: --dsw-specific-sidebar-fill }）。
     壁纸激活时与玻璃行无关地清掉 AppFrame 底：停玻璃行后 data-we-glass-page 被摘，
     sidebar-fill 恢复不透明，AppFrame 底会整片盖住 body 上 z-index:-2 的壁纸层
     （现场：关「液态玻璃」行后壁纸消失、音乐等其它插件不受影响）。
     [data-shell-overlay] 是 layout 包写在 AppFrame 直接子节点上的稳定锚点；
     这里只清 AppFrame **本体**的底、不碰任何令牌 —— 侧栏填充的让位由上面那组
     body[data-we-wallpaper] 规则负责（壁纸在场即 transparent，与玻璃行无关）⇒
     壁纸态下左栏 / 顶栏是透明洞、透出壁纸，不是原生实色；本规则只补「壳容器
     不读我们清过的令牌、只认自己刷的底」这一层。 */
  body[data-we-wallpaper] :has(> [data-shell-overlay]) {
    background: transparent !important;
  }

  /* Windows 桌面壳的 AppFrame 在 [data-windows-titlebar] 下把整块 frame 底刷成
     --dsw-specific-sidebar-fill（宿主 AppFrame.module.css 的实现事实）。壁纸在场时
     该 token 已由上面的壁纸门规则统一清成 transparent（产品口径 2026-10-29：壁纸在场
     即让位，与玻璃行无关），但壳容器会把自己那一层 frame 底**单独刷一遍**、不保证读
     我们清过的令牌 ⇒ 停玻璃行后 frame 底仍可能不透明，中栏虽读到 bg-base=transparent，
     父级 frame 底却盖住 body 上 z-index:-2 的壁纸层（现场：关「液态玻璃」行后壁纸
     整片消失、音乐不受影响；重开玻璃行即恢复）。
     这里只清 desktop 形态的壳容器、不改 --dsw-specific-sidebar-fill token ——
     壁纸态下左栏 / 顶栏是透明洞（透出壁纸），文字 / 边框 / 其余原生样式仍按宿主主题；
     玻璃行开启时叠加不变。 */
  body[data-we-adapter^="desktop-"][data-we-wallpaper] > #root,
  body[data-we-adapter^="desktop-"][data-we-wallpaper] > #root > [class*="_frame"]:not([data-we-surface-preserve]),
  body[data-we-adapter^="desktop-"][data-we-wallpaper] > #root > [class*="_frame"]:not([data-we-surface-preserve]) > [class*="_root"]:not([data-we-surface-preserve]) {
    background: transparent !important;
  }

  /* 右栏「全屏」= 内容面覆盖整个工作区：底层对话列**不应存在**（设计口径：不可见，
     不是靠模糊/半透明压住）。宿主自己不给全屏面板加不透明底，也不隐藏对话列；本插件
     的装饰叶是 z-index:-1 的固定层、只采样壁纸层 ⇒ 全屏面板若只靠 12%~ 的着色底
     （低「玻璃保真度」下就是这个值），对话文字会直接透出来与侧栏文字叠印 ——
     #150 修的是层级（面板 z=40 压过会话 z=1/7），修不了「底下还有东西」。
     锚点：宿主 slot 渲染器给每个出口盖 data-slot="<slotKey>"；对话列的容器
     data-slot="main.conversation" 承载 hero + 输入卡 + 对话流（client-ui-conversation）。
     全屏面板展开时（data-sidebar-right-open）整列 visibility:hidden —— 保留布局
     （不 unmount、不触发滚动恢复/焦点副作用），只是不画。收起 / push 态选择器
     不匹配，逐字节不变。与本插件开关无关：玻璃行开着时面板半透、关着时面板兜底
     底也可能缺失，两态都靠这条保证「面板下方没有对话信息」。 */
  body:has([data-sidebar-right-panel="fullscreen"][data-sidebar-right-open]) [data-slot="main.conversation"] {
    visibility: hidden !important;
  }



  /* ── Light-scheme text contrast boost ──────────────────────────────────────
     In light mode the grays (tertiary/caption/secondary) were tuned against a
     near-white page. Over a busy wallpaper + light scrim they lose contrast, so
     push the whole gray ramp darker while a wallpaper is active. Primary text
     is already near-black; we still pin it to pure black for max legibility.
     (Dark mode is untouched: its white-on-dark text already reads fine.) */
  /* ADR-0016 第四刀勘误：文字提亮也是「壁纸让位」的一部分（为了在壁纸上读清），
     改挂壁纸+玻璃页双门——停玻璃行时全部文字令牌回宿主原生值（用户口径：除内容区壁纸外
     其他所有还原为原生主题）。 */
  body[data-we-wallpaper][data-we-glass-page]:not([data-ds-dark-theme]) {
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
     ⚠️ 门控：本组映射挂 **data-we-ui-color**（主包 effects.js 恒挂；ADR-0016 第三刀勘误 ——
        历史上借用玻璃的 data-we-glass-page 门，玻璃运行时出户后停玻璃行会连坐本功能）。
     ⚠️ 本段在**模板字符串**里：注释内**不许出现反引号**（会把 CSS 字符串提前终止，
        build-client 报 "postfix operation" 一类的怪错）。示范令牌名时不加引号。 */
  body[data-we-ui-color] {
    --dsw-alias-link: var(--we-ui-link, #4f8cff);
    --dsw-alias-label-deep-diving: var(--we-ui-deep-diving, #4f8cff);
    /* 微光伴生色：由主色推出（往白里提一档），不新增设置键。 */
    --dsw-alias-label-deep-diving-shimmer: color-mix(in srgb, var(--we-ui-deep-diving, #4f8cff) 62%, #ffffff);
    --dsw-alias-state-business-primary: var(--we-ui-tab, #4f8cff);
  }
  /* 全局 UI 配色的**深色孪生块**：这一族在宿主里本来是**浅/深成对**的
     （link / label-deep-diving = 浅 #4176e6 / 深 #7aaaff，光标走 state-business-primary）。
     #239：早先这里与浅色块**逐字相同**（都直接吃 --we-ui-* 单一标量）⇒ 用户 accent 选暗色时，
     深色壁纸上这三处对比度掉到 ~1.1:1（链接文字 / 「深度求索中…」/ 插入光标几乎不可见）。
     现在按主题把**同一个用户色往白里提一档**：仍是用户配色（不是硬编码回宿主蓝），但保证深色底可读。
     浅色块保持不变（--we-ui-* 原值在浅底上即可读）。守卫 verify-glass-compositing 的 G9 钉
     「主题成对令牌禁止浅深同值」；它必须按本组自己的门 data-we-ui-color 扫描 —— 扫
     data-we-glass-page 会退化成空集对空集（静默假绿）。 */
  body[data-ds-dark-theme][data-we-ui-color] {
    --dsw-alias-link: color-mix(in srgb, var(--we-ui-link, #4f8cff) 45%, #ffffff);
    --dsw-alias-label-deep-diving: color-mix(in srgb, var(--we-ui-deep-diving, #4f8cff) 45%, #ffffff);
    --dsw-alias-label-deep-diving-shimmer: color-mix(in srgb, var(--we-ui-deep-diving, #4f8cff) 70%, #ffffff);
    --dsw-alias-state-business-primary: color-mix(in srgb, var(--we-ui-tab, #4f8cff) 45%, #ffffff);
  }
  /* 发送键：填充 + 悬停（悬停往黑压一档，与宿主原来的 fill→hover 明暗关系同向）。
     ⚠️ 作用域用 data-composer-seat（输入**座位**，宿主自带锚点）而**不是**
        data-composer-card：后者是 verify-glass-surfaces 的 W5 用来认「对话玻璃子面」的
        成员选择器（见那里 GATE 表 glass-child-conversation 的 member 正则），本条却是
        **纯配色**规则、不画任何釉层 —— 写上它会被那条守卫算成"该子面有一条无门控规则"，
        判红且判错（真正的失效模式是"关掉对话玻璃后还剩玻璃味"，与本条无关）。
        座位是输入卡的**祖先**（宿主：座位里就有 data-composer-card），覆盖范围等价、
        锚点同样是宿主的稳定 data-* 属性 ⇒ 不改产品行为，只避免被误归类。 */
  body[data-we-ui-color] [data-composer-seat] {
    --dsw-alias-button-info-fill: var(--we-ui-send, #4f8cff);
    --dsw-alias-button-info-hover: color-mix(in srgb, var(--we-ui-send, #4f8cff) 82%, #000000);
  }
  /* 文件图标（</>）：同令牌的第二处作用域 ⇒ 内层更近的祖先胜出，于是与「链接文字」分开可调。
     锚点对不上时（宿主改结构）本条不匹配，图标回落成「跟随链接文字」——**优雅降级**，不炸。 */
  body[data-we-ui-color] [data-presented-file] {
    --dsw-alias-link: var(--we-ui-file-icon, #4f8cff);
  }
  /* 插件自己的「不透明面板色」(solid panel colour)：宿主别名 --dsw-alias-bg-layer-*
     会被**改写成玻璃配方**（见上面 body[data-we-glass-page] 的令牌映射；壁纸不在场时
     也生效），
     但有几块面必须保持近不透明才对 —— 编辑器/终端的固定语法与 ANSI 配色、没有
     backdrop-filter 的插件模态框、壁纸层的垫底画面（垫底不能透明，见 buildLivePoster）。
     它们改读这个令牌，从而与别名映射解耦。取值直接取宿主静态调色板里**别名本身的来源**
     （浅色 neutral-bluish-00 / 深色 neutral-bluish-875），静态令牌缺席时退回字面量。 */
  body {
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
    --we-panel-color: var(--dsw-static-neutral-bluish-875, #1e1f26);
    /* #164 深色档：见浅色块的说明。缺省墨用深色主题惯用的浅字，未自定义时逐位还原现状。 */
    --we-popup-row-bg: var(--we-popup-row-bg-dark, var(--we-panel-color, #1e1f26));
    --we-popup-row-ink: var(--we-popup-row-ink-dark, var(--dsw-alias-label-primary, #e6e8eb));
  }


`;

export { CSS_BASE };
