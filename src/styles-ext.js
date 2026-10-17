/**
 * styles-ext.js —— 样式域模块 **EXT**（原 src/styles.js 第 3358–3742 行，共 385 行）。
 *
 * 内容：扩展与「关于」—— 「关于」页签 · 扩展页签模块槽位 · 一号头像 · 二号点击/拖尾 · 侧栏全透明(#137) · 三号 3D 视差。
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
const CSS_EXT = `  /* ── 软件渲染回退（upstream #95，运行时探测）───────────────────────────────
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
  /* 内容面（编辑器/终端）本来就是近不透明底板（--we-content-surface-alpha，兜底
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
  /* 模块级重置按钮（issue #192）↺：外观各节的节头与扩展模块头**共用同一枚**。
     margin-left: auto 把它推到行尾（两者都是 flex 行）。
     ⚠️ 与折叠三角同排时**必须让位**（见下面那条相邻选择器）：三角也靠 margin-left: auto
     推右，两个 auto 在同一 flex 行里会**均分**剩余空间 —— ↺ 于是停在行中间，而"主题"
     （那个节头没有 caret）的 ↺ 贴在最右端，同一批模块两种位置（用户报的正是
     这个）。现在的次序是 标签 → 三角 → ↺，三角吃掉剩余空间、↺ 紧跟其后贴在最右一列。
     ⚠️ 本段注释不许出现反引号：整套样式文本是模板字符串，一个反引号就拼断 JS。 */
  .we-mod-reset {
    margin-left: auto; flex: 0 0 auto;
    width: 24px; height: 24px; padding: 0; line-height: 1;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 1em; cursor: pointer;
    border-radius: 999px; corner-shape: round;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.28));
    background: transparent; color: var(--dsw-alias-label-secondary, inherit);
  }
  /* 有折叠三角同排 ⇒ 由三角独占那个 auto（它已是 margin-left: auto），↺ 只留一段间距。
     两者因此成组贴在行尾：…… [▾] [↺]。 */
  .we-picker__section-caret + .we-mod-reset { margin-left: 8px; }
  .we-mod-reset:hover { color: var(--dsw-alias-label-primary, inherit); }
  /* 破坏性动作的用色（「全部重置」）：与别的按钮同形，只在描边与文字上给警示色
     （不填底色 —— 填了在浅色主题下会压过旁边的说明文字）。 */
  .we-picker__btn--danger {
    border-color: color-mix(in srgb, #e5534b 55%, transparent);
    color: #e5534b;
  }
  /* 重置节的标题（页签级「重置本页」/ 全局「重置」）—— 与设置分组卡同字形，但用**独立类名**：
     它是**操作区**不是分组卡（语义更准），同时那些按"分组卡位置"取窗口的判据不会被它干扰
     （3D 效果那一页正好有三张分组卡 + 本节排在末尾，用同名类名会挤掉「背景」）。 */
  .we-picker__section-reset-label {
    font-size: 0.85em; font-weight: 600; color: var(--we-ink, inherit);
  }


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
  /* 连续同侧消息的后续行（issue #191 问题 2）：头像**只显示在第一条**。
     ⚠️ 只做 visibility: hidden —— 节点与它的框都还在，缩进对齐与 flex 几何逐字节不变。
     绝不写 display: none / 摘节点：那会让宿主 display:contents 锚点下的内容退回
     flex: 0 1 auto，收起的思考行固有宽为 0 ⇒ 整条消息连入口一起消失（issue #154）。 */
  .we-avatar--cont { visibility: hidden; }
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
  /* 上传裁切弹窗（issue #191 问题 1）：居中模态 + 方形取景框。
     取景框 overflow: hidden 是"框外不显示"的唯一手段；框内那张图由 client.js 现算的
     几何定位（left/top 负偏移），**不用 transform** —— transform 会建合成层，
     而这里每拖一下都改值（见 styles-base.js 里"不常驻合成层"那条纪律）。 */
  .we-crop {
    position: fixed; inset: 0; z-index: 40;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0, 0, 0, 0.45);
  }
  .we-crop__card {
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    padding: 16px; border-radius: 14px; corner-shape: round;
    background: var(--dsw-alias-bg-layer-1, #101418);
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.28));
    max-width: min(92vw, 360px);
  }
  .we-crop__title { font-size: 0.95em; font-weight: 600; color: var(--we-ink, inherit); }
  .we-crop__view {
    position: relative; overflow: hidden; flex: 0 0 auto;
    border-radius: 8px; corner-shape: round;
    background: rgba(128, 128, 128, 0.16);
    cursor: grab; touch-action: none;
  }
  .we-crop__img { position: absolute; display: block; pointer-events: none; user-select: none; }
  /* 框线：纯装饰（拖拽由整格接管），压在图上但吃不到指针。 */
  .we-crop__frame {
    position: absolute; inset: 0; pointer-events: none;
    border: 2px solid rgba(255, 255, 255, 0.85);
    border-radius: 8px; corner-shape: round;
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.35);
  }
  .we-crop__actions { display: flex; gap: 8px; align-self: stretch; justify-content: flex-end; }
  /* ⚠️ 这里曾有一条**未限定作用域**的 .we-picker__btn--primary 覆盖（PR #202 随裁切弹窗
     加入）：本意应只服务弹窗按钮，实际把**全局**主按钮的文字色改写成 accent，与实心 accent
     底逐像素同色 ⇒ v1.3.2 之后所有主按钮（选择壁纸 / 关于页 Star / 确认并导入…）文字隐形。
     已移除 —— 裁切弹窗的「确认并导入」用标准主按钮款式（styles-panel.js 那条）。
     今后若确需按钮变体：必须带作用域前缀（如 .we-crop__actions 后代），且 background /
     color / border 三类属性写全 —— 只改 color/border 会留下"同色隐形"这种半截状态。 */
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

  /* ── 「扩展」二号模块：点击效果与拖尾效果（画布层见 packages/fx/src/fx-layer.js）──
     与 .we-layer / .we-scrim 同族：body 级的整屏浮层 ⇒ 同样必须
     pointer-events: none; -webkit-app-region: initial !important（同族的硬要求，
     见 test/verify-host-paint-scope.mjs H3）。
     z-index -1、靠文档序压在暗化层之上（见 packages/fx/src/fx-layer.js 的 fxPlace），
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

  /* ── 「扩展」三号模块：3D 效果（视差；行为层见 packages/parallax/src/parallax-layer.js）──
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
  /* 界面跟随那一组挪的是会话滚动容器**里面**的真实元素（见 packages/parallax/src/parallax-layer.js 的
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

export { CSS_EXT };
