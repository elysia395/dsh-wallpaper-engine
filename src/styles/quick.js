/**
 * styles-quick.js —— 样式域模块 **QUICK**。
 *
 * 内容：Rope dock 与快捷播放面板 QuickPanel（含软件渲染回退，upstream #95）。
 *
 * 拼装契约（样式族 7 个域模块共享，组装点见 src/styles.js）：
 *   · 构建期按 INLINE_MODULES 顺序把族内文件**原样内联进同一工厂作用域**，模块之间不 import，靠扁平符号协作
 *     （见 docs/CODE-STRUCTURE.md §3）；
 *   · 本段模板的开引号紧跟本段首行（不另起一行）；段间那一个换行由上一段的收尾换行提供；
 *     本段自身以换行收尾（下一段接着写）；
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
const CSS_QUICK = `  /* ── Rope dock: chibi pull-cord + glass repo drawer ────────────────────────
     The rope floats over the chat (fixed, body-child → immune to ancestor
     transforms/backdrop-filters, same policy as the picker modal). It snaps to
     the TOP edge on release (any horizontal spot); the settle class animates
     that snap via top/left (tiny element, release-only). Dragging removes the
     settle class so the rope follows the pointer 1:1. Pulling it DOWN draws
     out the repo panel, which descends from the top like a drawer. Z-order:
     repo panel 995 < rope 996 (the rope stays grabbable/clickable as the
     panel's handle while it is out). ── */
  body[data-we-modal-blocked] :is(.we-rope,.we-repo-panel,.we-update-notice) {
    visibility: hidden !important; pointer-events: none !important;
  }
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
/* ADR-0016 第四刀：基础层**无门**（几何 + 面板色实底）—— 玻璃行停用时公告仍是
   一块可读的实底浮层，而不是裸文本叠在壁纸上；玻璃皮（门内）叠加时以玻璃配方覆盖底色。 */
.we-update-notice {
    position: fixed; left: 50%; bottom: 26px; z-index: 1100;
    transform: translateX(-50%);
    width: min(600px, 92vw);
    /* 条目增多后（6 条 16pt 大字）总高会顶出矮视口 ⇒ 面板自身限高 + 正文区滚动。
       max-height 用 dvh（移动端地址栏伸缩时 vh 会虚高），并给「知道了」留出底部空间：
       按钮在滚动容器**之外**，永远可点 —— 内容再长也不会把关闭键挤出屏幕。
       ⚠️ 本段在模板字符串里：注释里的反引号会**提前闭合模板**（实测：后面整片 CSS
       变成 JS 代码，i18n 守卫当场判成裸中文）。写 CSS 属性名一律不加反引号。 */
    max-height: min(78dvh, 720px);
    box-sizing: border-box;
    display: flex; flex-direction: column; gap: 10px;
    padding: 16px 18px; border-radius: 14px;
    background-color: var(--we-panel-color, #ffffff);
    border: 1px solid rgba(128, 128, 128, 0.28);
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.4);
    color: inherit;
    animation: we-notice-in 240ms var(--we-ease, cubic-bezier(0.16, 1, 0.3, 1));
  }
  /* 玻璃皮（data-we-glass-floaters 门内）：底色换玻璃配方、加雾化与玻璃描边。
     依赖的按面变量（--we-floaters-*）由玻璃包行为层写出（ADR-0016 第三刀），
     门在则变量必在（零兜底契约不变）；玻璃行停用 ⇒ 门失效 ⇒ 上面那条基础层兜住。 */
  body[data-we-glass-floaters] .we-update-notice {
    background-color: color-mix(in srgb, var(--we-surface-tint-light, #ffffff) calc(var(--we-floaters-alpha) * 90%), var(--we-readability-base) calc(max(var(--we-readability-floor), 0.82) * 100%));
    background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.03) 40%, rgba(255, 255, 255, 0.01));
    -webkit-backdrop-filter: blur(var(--we-floaters-blur)) saturate(1.2);
    backdrop-filter: blur(var(--we-floaters-blur)) saturate(1.2);
    border-color: var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.22));
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.18);
  }
  @keyframes we-notice-in { from { opacity: 0; transform: translate(-50%, 12px); } }
  .we-update-notice__title { font-weight: 600; font-size: 0.95em; flex: 0 0 auto; }
  /* 正文区是**唯一**可滚动的那一块（面板限高后条目再多也不顶出屏幕）；min-height: 0
     是 flex 子项能真正缩小/滚动的前提 —— 少了它 overflow-y: auto 永远不触发
     （与侧栏列表那处踩过的坑同形）。配图在正文区里一起滚。 */
  .we-update-notice__body { font-size: 0.82em; line-height: 1.5; opacity: 0.92; overflow-y: auto; min-height: 0; overscroll-behavior: contain; }
  .we-update-notice__body p { margin: 0 0 6px; }
  .we-update-notice__hint { font-size: 0.78em; opacity: 0.6; }
  .we-update-notice__btn { align-self: flex-end; }
  /* 公告配图：随包 JPEG，/about-qr 路由直出。方图不能全宽吃满 600px 面板（正文条目加起来
     已经很高，小窗口会顶出视口）——限高 26vh、宽度跟随、居中（用户口径：38vh 在 1080p 下
     ≈410px，几乎独占半屏，压到 26vh 给正文让位）。发丝边 + 投影让它贴着玻璃面板的既有语言，
     而不是一块浮贴的截图。 */
  .we-update-notice__art { display: block; margin: 0 auto; width: auto; max-width: 100%; max-height: 26vh; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.22)); box-shadow: 0 10px 26px rgba(0, 0, 0, 0.28);
    /* 面板限高后允许配图先让位（min-height: 0 是 img 能在 flex 里缩小的前提：
       img 的固有尺寸会当 min-content，不给 0 就永远不缩）；正文区随后才滚动。 */
    flex: 0 1 auto; min-height: 0; }
  .we-update-notice__art-cap { font-weight: 600; font-size: 0.85em; text-align: center; flex: 0 0 auto; }
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
/* ADR-0016 第四刀：抽屉本体**无门**（几何/关闭态/面板色底）—— 玻璃行停用时抽屉
   仍是一块可用的实底滑出面板；玻璃皮只留在 --open 态那条门内规则里。 */
.we-repo-panel {
    position: fixed; top: 0; right: 0;
    width: 360px; max-width: 92vw;
    height: 100vh; height: 100dvh;
    z-index: 995;
    display: flex; flex-direction: column;
    padding: 14px;
    box-sizing: border-box;
    background-color: var(--we-panel-color, #1e1f26);
    transform: translateX(102%);
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition:
      transform 640ms cubic-bezier(0.32, 0.72, 0.24, 1),
      opacity 480ms ease,
      visibility 0s linear 640ms;
  }
  /* Native caption buttons overlay the top edge; inset the whole drawer content. */
  html[data-windows-titlebar] .we-repo-panel {
    padding-top: calc(14px + var(--dsh-windows-titlebar-height, 40px));
  }
  /* The glass (backdrop-filter + tint + shadow) lives ONLY on the open state:
     while closed the panel is off-screen and must not allocate a full-viewport
     backdrop-filter compositing layer (a fixed, always-present backdrop-filter
     layer is a known Chromium white-flash-on-repaint source). */
/* 打开态的**布局与可见性**无门（玻璃行停用时抽屉照常开合）；背景保留基础层
   的面板色实底。玻璃皮单独留在下面的门内规则。 */
.we-repo-panel--open {
    border-left: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.22));
    transform: translateX(0);
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transition:
      transform 640ms cubic-bezier(0.32, 0.72, 0.24, 1),
      opacity 480ms ease,
      visibility 0s;
  }
  /* 玻璃皮（门内）：可读性下限配方 + 雾化 + 玻璃描边（变量由玻璃包行为层写出）。 */
  body[data-we-glass-floaters] .we-repo-panel--open {
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
  }
.we-repo-panel__head {
    display: flex; align-items: center; justify-content: space-between;
    gap: 8px; flex: 0 0 auto;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.22));
  }
  .we-repo-panel__title { font-weight: 600; font-size: 0.95em; white-space: nowrap; }
  /* Body: THE scroll container（内容 = QuickPanel 快捷播放面板）。 */
.we-repo-panel__body {
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
  /* 控制行允许**整组折行**（flex-wrap）：官方右栏最窄 276px，三枚按钮（暂停/刷新/清除）＋
     圆盘＋间距已接近满宽，再加内容就会溢出。窄到放不下时按钮组整体落到第二行、靠右对齐
     （.we-qp__current-actions 的 margin-left: auto；info 列独占首行）；宽容器里三枚仍同行。
     不用按钮各自的 flex-wrap —— 那会碎出 3+1 之类的歪行。 */
  .we-qp__current { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
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
  /* 控制行允许**整组折行**：官方右栏最窄 276px，三枚按钮（暂停/刷新/清除）加上圆盘与间距
     已接近满宽，再加内容就会超宽。窄到放不下时按钮组整体落到第二行、靠右对齐（info 列独占
     首行）；宽容器里三枚仍同行。不用按钮各自的 flex-wrap —— 那会碎出 3+1 之类的歪行。
     margin-left: auto 只在折行的第二行生效（单行时 info 的 flex:1 已经吃掉全部余量）。 */
  .we-qp__current-actions { flex: none; display: flex; gap: 6px; margin-left: auto; }
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
  /* 视图切换：搜索 + 分级勾选 + 类型筛选 + 列表/卡片，**确定性两行**。一行排下不可行 ——
     最窄官方右栏里第四个控件在结构上放不下，而依赖 flex-wrap 假想尺寸的折行在中间宽度会
     碎出"只有页签折下去"的行。故搜索框独占首行（**封顶 300px**：用户口径，太长的搜索框
     没用还占地方；basis 钉 100% 强制换行），分级下拉/类型/视图三个控件右对齐成第二行
     （分级下拉的 margin-left:auto 恰是第二行首项，把它推到右侧）。 */
  .we-qp__viewbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .we-qp__viewbar .we-qp__search { flex: 1 1 100%; min-width: 0; max-width: 300px; width: auto; }
  /* 内容分级：下拉 + 多档勾选（与壁纸选择器同款设计；用户口径 2026-10-30 ——
     四枚胶囊在快捷面板里同样观感差）。候选框的限宽/省略在 .we-picker__rating-*
     里统一定义，这里只把按钮尺寸收进本面板的密度。 */
  /* 两个下拉共用同一套面板密度（字号 / 高度 / 内距 / 圆角）—— 之前只有分级按钮
     带了 we-qp__rating-btn 覆盖，类型按钮落回设置页的 30px / 12px，于是同排两个
     控件字号与框高不一致；宽度仍各自不同（摘要字数不同）。
     ⚠️ 模板字符串里禁止出现裸反引号（会把 CSS 模板提前终止；verify-glass-surfaces 有判据）。 */
  .we-qp__rating-menu { margin-left: auto; max-width: 210px; }
  /* 宽度按用户口径收到原来的 ~60%（2026-10-31）：108px→70px、96px→54px；同时把内距
     与图标间距压紧，「内容分级」四字（11px×4=44px）在 70px 里仍能完整显示（已算：
     10px 内距 ×2 + 44 + 4 间距 + 9 图标 + 2 边框 = 69px ≤ 70px），不触发省略号。 */
  .we-qp__rating-btn,
  .we-qp__type-btn { height: 26px; padding: 0 5px; gap: 4px; font-size: 11px; border-radius: 7px; }
  .we-qp__rating-btn { width: 70px; }
  .we-qp__type-btn { width: 54px; }
  .we-qp__viewbar .we-picker__rating-caret { font-size: 9px; }
  .we-qp__viewbar .we-qp__type-menu { flex: none; }
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

`;

export { CSS_QUICK };
