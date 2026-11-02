/**
 * styles-ext.js —— 样式域模块 **EXT**。
 *
 * 内容（ADR-0016 第四刀玻璃段出户后）：扩展与「关于」—— 「关于」页签 · 扩展页签模块槽位 · 一号头像 · 二号点击/拖尾 · 三号 3D 视差。软渲回退与侧栏全透明随玻璃包走。
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
const CSS_EXT = `
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

  /* ── 「扩展」页签 · 桌宠联动卡片（we-pet-link，包 pet-link/src/pet-link/extension-card.js）──
     分层口径：标题行 → 状态 → 模式 → 共存提示 → 进度条 → 失败块 → 主按钮 → 次按钮组
     → 分步进度 → 折叠诊断。容器 .we-ext__module 已给外框与 6px 行距，这里只管
     卡内各层的间距节奏（8px 主间距）与控件形态：开关贴行尾、主按钮通栏、
     次按钮并排（窄壳自动换行）。颜色不新造：全部取主题墨色 / 边框 / 面板令牌，
     进度条填充用按钮主色（accent 由宿主映射），失败块用与本仓既有的警示红。
     ⚠️ 本段注释不许出现反引号：整套样式文本是模板字符串，一个反引号就拼断 JS。 */
  /* 卡片容器：竖向排布 + 统一间距（此前根 class 无任何规则，卡内各块会贴在一起） */
  .we-pet-link__card {
    display: flex; flex-direction: column; gap: 8px; align-items: stretch;
  }
  /* ── 图文安装引导（下载器拆除后替代「下载并安装」按钮）────────────── */
  .we-pet-link__guide {
    display: flex; flex-direction: column; gap: 10px;
    margin-top: 4px; padding: 12px;
    border: 1px solid var(--we-border, rgba(255,255,255,.12));
    border-radius: 10px;
    background: var(--we-surface, rgba(255,255,255,.03));
  }
  .we-pet-link__guide-title {
    font-size: .82em; font-weight: 700; color: var(--we-ink, inherit);
  }
  .we-pet-link__guide-step { display: flex; flex-direction: column; gap: 6px; }
  .we-pet-link__guide-caption {
    font-size: .8em; font-weight: 600; color: var(--we-ink-dim, rgba(255,255,255,.78));
  }
  .we-pet-link__guide-shot {
    display: block; width: 100%; max-width: 420px; height: auto;
    border-radius: 8px; border: 1px solid var(--we-border, rgba(255,255,255,.1));
  }
  .we-pet-link__guide-shot--pending {
    display: flex; align-items: center; justify-content: center;
    min-height: 72px; max-width: 420px;
    font-size: .76em; color: var(--we-ink-dim, rgba(255,255,255,.5));
    border-style: dashed;
  }  .we-pet-link__guide-pkg {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    margin-top: 2px;
  }
  .we-pet-link__guide-code {
    padding: 5px 10px; border-radius: 7px;
    font: 600 .84em/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--we-accent, #4f8cff);
    background: rgba(79,140,255,.12);
    border: 1px solid rgba(79,140,255,.28);
    user-select: all;
  }
  .we-pet-link__guide-copy {
    padding: 5px 12px; border-radius: 7px; cursor: pointer;
    font-size: .78em; font-weight: 600;
    color: var(--we-ink, #fff);
    background: transparent;
    border: 1px solid var(--we-border, rgba(255,255,255,.22));
    transition: background .15s ease, border-color .15s ease;
  }
  .we-pet-link__guide-copy:hover {
    background: rgba(255,255,255,.08);
    border-color: var(--we-accent, #4f8cff);
  }
  .we-pet-link__guide-tip {
    font-size: .76em; line-height: 1.6;
    color: var(--we-ink-dim, rgba(255,255,255,.66));
  }
  .we-pet-link__guide-link {
    font-size: .76em; word-break: break-all;
    color: var(--we-accent, #4f8cff); text-decoration: none;
  }
  .we-pet-link__guide-link:hover { text-decoration: underline; }
  /* 口径说明（2026-11-02）：联动包是"基于上游快照的改编版"，不跟随上游发布节奏。
     常驻提示只做一行路标（.we-pet-link__note），完整说明放在安装引导面板内（.we-pet-link__guide-note），
     开关行保持与宿主设置行同款单行、不塞常驻小字。 */
  .we-pet-link__note {
    font-size: .74em; line-height: 1.5;
    color: var(--we-ink-dim, rgba(255,255,255,.55));
    overflow-wrap: anywhere;
  }
  .we-pet-link__guide-note {
    margin-top: 2px; padding-top: 7px;
    border-top: 1px dashed var(--we-border, rgba(255,255,255,.14));
    font-size: .76em; line-height: 1.65;
    color: var(--we-ink-dim, rgba(255,255,255,.66));
    overflow-wrap: anywhere;
  }

  /* 标题行与胶囊开关均直接用宿主款（.we-picker__ctl / .we-picker__ctl-label / .we-picker__switch），
     本文件不再自造同族样式 —— 字号/字重/轨道尺寸只留一处真源，避免"看起来像但不一样"。 */
  .we-pet-link__status {
    font-size: 0.78em; line-height: 1.55; color: var(--we-ink-2, rgba(128, 128, 128, 0.9));
    overflow-wrap: anywhere;
  }
  .we-pet-link__mode { font-size: 0.75em; line-height: 1.5; color: var(--dsw-alias-label-tertiary, rgba(128, 128, 128, 0.8)); overflow-wrap: anywhere; }
  .we-pet-link__coexist {
    padding: 6px 8px; border-radius: var(--we-ui-radius, 8px);
    border: 1px dashed var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
    font-size: 0.75em; line-height: 1.5; color: var(--we-ink-2, rgba(128, 128, 128, 0.9));
  }
  /* 卡片内进度条：只压一层 4px 轨道；done 后视图层整块不渲染（无节点 ⇒ 无空行）。 */
  .we-pet-link__progress { display: flex; flex-direction: column; gap: 4px; }
  .we-pet-link__progress-label {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    font-size: 0.72em; color: var(--dsw-alias-label-secondary, inherit);
    font-variant-numeric: tabular-nums;
  }
  .we-pet-link__progress-bar {
    position: relative; height: 4px; border-radius: 999px; overflow: hidden;
    background: var(--dsw-alias-bg-layer-3, rgba(128, 128, 128, 0.2));
  }
  .we-pet-link__progress-fill {
    height: 100%; border-radius: 999px;
    background: var(--dsw-alias-button-primary-fill, var(--we-accent, #4a7dff));
    transition: width 240ms linear;
  }
  /* total 未知（content-length 缺席）：细条往复扫动，等长意义下仍是"进行中"。
     动效只用 transform（合成器友好），prefers-reduced-motion 下退化为静态半格。 */
  .we-pet-link__progress-fill--indeterminate { width: 32%; animation: we-pet-link-sweep 1.2s linear infinite; }
  @keyframes we-pet-link-sweep {
    from { transform: translateX(-100%); }
    to { transform: translateX(412%); }
  }
  @media (prefers-reduced-motion: reduce) {
    .we-pet-link__progress-fill--indeterminate { animation: none; transform: none; }
  }
  /* 失败块：警示描边 + 可读底衬；官方地址是真正的链接行（可选中整段复制）。 */
  .we-pet-link__fail {
    display: flex; flex-direction: column; gap: 4px;
    padding: 8px; border-radius: var(--we-ui-radius, 8px);
    border: 1px solid color-mix(in srgb, #e5534b 55%, transparent);
    background: color-mix(in srgb, #e5534b 8%, transparent);
    font-size: 0.75em; line-height: 1.55; color: var(--we-ink-2, rgba(128, 128, 128, 0.9));
  }
  .we-pet-link__fail-title { font-weight: 600; color: #e5534b; overflow-wrap: anywhere; }
  .we-pet-link__fail-link {
    color: var(--dsw-alias-link, inherit); text-decoration: underline;
    overflow-wrap: anywhere; user-select: text;
  }
  /* 安装引导按钮：直接复用宿主主按钮款式（.we-picker__btn--primary：0.82em / 30px 行高 /
     实心 accent），这里只加"通栏宽度"这一条布局差异。 */
  .we-pet-link__install { width: 100%; box-sizing: border-box; }
  /* 次按钮组：并排（打开操控面板 / 测试一次），窄壳里自动换行；款式同样用 .we-picker__btn。 */
  .we-pet-link__actions { display: flex; flex-wrap: wrap; gap: 6px; }
  .we-pet-link__actions > .we-picker__btn { flex: 1 1 auto; min-width: 0; white-space: nowrap; }
  .we-pet-link__steps {
    margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 2px;
    font-size: 0.72em; line-height: 1.5; color: var(--we-ink-3, rgba(128, 128, 128, 0.65));
    font-variant-numeric: tabular-nums;
  }
  .we-pet-link__steps li[data-ok="false"] { color: #e5534b; }
  .we-pet-link__diag summary { font-size: 0.75em; cursor: pointer; color: var(--dsw-alias-label-tertiary, rgba(128, 128, 128, 0.8)); }
  .we-pet-link__diag pre {
    margin: 4px 0 0; padding: 6px; border-radius: var(--we-ui-radius, 8px);
    background: var(--dsw-alias-bg-layer-3, rgba(128, 128, 128, 0.12));
    font-size: 0.68em; line-height: 1.5; overflow: auto; max-height: 180px;
    color: var(--dsw-alias-label-secondary, inherit);
  }


  /* ── 「扩展」页签一号模块：自定义会话头像（装饰层见 src/avatar-layer.js）──
     这一层是**宿主会话 DOM 的补丁**：给三类消息行（data-chat-flow-kind = user / steering /
     assistant-step）补一个 .we-avatar，并把行改成**两列 grid** —— 一列头像、一列内容。
     助手行头像在第 1 列（左），用户行在第 2 列（右）⇒「你的消息在右、助手在左」。
     关掉开关时节点与属性都被装饰层撤掉 ⇒ 屏上一点痕迹都没有（下面每条规则都挂在开关属性下，
     与思考块玻璃 / 视差同一条门控纪律）。
     尺寸与圆角来自 body 上的两个变量（装饰层按设置写）⇒ 拖滑块只是**变量替换**，不重建节点；
     头像是**一个圆脸**（没导入图就画内置的默认头像 SVG），宽度固定为边长 ⇒ 长消息不会被挤。
     ⚠️ **没有自定义名字行**（用户口径）：这里不要再加名字。

     ⚠️ 为什么不是 flex 一行：表情 / 贴图是**第三方插件提到行首**的（dsh-meme 把
     「表情: 描述」换成 img 后插到行的第一个子节点）。flex 一行里"头像 | 图 | 正文"
     只能并排，图多时正文被挤到图的右边；用户要的是**正文先出完、表情另起一行**。
     grid 的两列给出"头像列 + 内容列"：所有非头像子项都落在内容列里，行内自然换行。

     ⚠️ 表情为什么由装饰层包一层 .we-avatar-media：grid 的每个直接子项会各占一行，
     三张表情若直接挂在行下就会**竖着排**。装饰层把行首的 IMG 收进一个横向 flex 容器，
     再按 order 排到正文后面：有正文 ⇒ 正文第 1 行、表情组第 2 行；没正文（内容根被
     第三方 display:none）⇒ 表情组自然落在第 1 行、紧跟头像，正是用户要的两种形态。

     ⚠️ 内容那一格必须**穿透槽出口锚点**（issue #154）：宿主把节点渲染包在
     div[data-slot="conversation.chat.node"] 里，并给它写死内联 style="display: contents"
     （宿主 renderer 的 ANCHOR_STYLE，注释明说要让 flex/grid 父级"看见槽自己的孩子"）⇒ 这层
     **没有盒子**：它既不是 grid item，也不接受 grid 属性。所以只写 > :not(.we-avatar) 是
     **打在空气上**——真正成为 grid item 的是锚点的孩子（助手消息的内容根 div.v5IAXa_root）。
     故两条选择器都写：直挂内容 + 锚点后面那一层；grid 的 minmax(0, 1fr) 列宽是这里的要害
     （固有宽为 0 的内容也靠列宽撑住，不会像 flex-grow 那样被 contain: size layout 压成 0）。
     判据见 test/verify-scene-live.mjs（头像段 CSS 钉法 + 假 DOM 照宿主真实形态造锚点）。
     **这一段不许出现反引号**：整套样式文本是被塞进产物里的模板字符串，一个反引号就能把 JS
     拼断（build-client 会当场报"产物语法错误"）。 */
  body[data-we-avatar="on"] [data-we-avatar-row] {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
    gap: 8px;
  }
  body[data-we-avatar="on"] [data-we-avatar-row="user"] { grid-template-columns: minmax(0, 1fr) auto; }
  body[data-we-avatar="on"] [data-we-avatar-row] > :not(.we-avatar):not([data-slot]),
  body[data-we-avatar="on"] [data-we-avatar-row] > [data-slot] > :not(.we-avatar) { grid-column: 2; min-width: 0; }
  body[data-we-avatar="on"] [data-we-avatar-row="user"] > :not(.we-avatar):not([data-slot]),
  body[data-we-avatar="on"] [data-we-avatar-row="user"] > [data-slot] > :not(.we-avatar) { grid-column: 1; }
  .we-avatar {
    box-sizing: border-box;
    order: -1;
    grid-column: 1;
    grid-row: 1;
    align-self: start;
    flex: 0 0 auto;
    display: flex; align-items: center; justify-content: center;
    width: var(--we-avatar-size, 40px); height: var(--we-avatar-size, 40px);
    border-radius: calc(var(--we-avatar-round, 100) * 0.5%);
    overflow: hidden;
    color: var(--dsw-alias-label-secondary, currentColor);
    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.16));
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.28));
  }
  /* 用户行头像在第 2 列（右）；助手行沿用上面的第 1 列（左）。一份 grid-column 同时定左右。 */
  body[data-we-avatar="on"] [data-we-avatar-row="user"] > .we-avatar { grid-column: 2; }
  /* 行首表情的横排容器（装饰层按需建）：order:1 让它排在正文后面。
     有正文 ⇒ 另起一行；没正文（内容根被第三方 display:none）⇒ 自然落在第 1 行、紧跟头像。
     用户行靠 justify-content:flex-end 整组贴右；图自己的 inline margin-left:auto 在横排里
     会把三张图撑开，故在容器内统一抹掉外边距（只作用于本层容器里的图）。 */
  .we-avatar-media {
    display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px;
    min-width: 0; order: 1;
  }
  body[data-we-avatar="on"] [data-we-avatar-row="user"] > .we-avatar-media { justify-content: flex-end; }
  .we-avatar-media > img { margin: 0 !important; }
  /* 没有可见正文时（内容根还在、只是空了或被藏了）：表情容器钉回第 1 行，紧跟头像，
     不能因为占位内容根仍在第 1 行就落到它下面。 */
  body[data-we-avatar="on"] [data-we-avatar-row][data-we-avatar-no-text] > .we-avatar-media,
  body[data-we-avatar="on"] [data-we-avatar-row][data-we-avatar-no-text] > img { grid-row: 1; }
  /* 兜底：图还没来得及被收进容器时，直接挂在行下也排到正文后面，不和正文并排。 */
  body[data-we-avatar="on"] [data-we-avatar-row] > img { order: 1; justify-self: start; }
  body[data-we-avatar="on"] [data-we-avatar-row="user"] > img { justify-self: end; }
  /* 头像图不接指针事件：dsh-meme 把聊天流里所有 img 都当表情（zoom-in 光标 + 点击放大），
     自定义头像图也会被它接管。这不改变任何视觉，只是让装饰节点不再被当成内容图。 */
  .we-avatar__img { display: block; width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
  .we-avatar__glyph { display: flex; align-items: center; justify-content: center; }
  .we-avatar__glyph svg { width: 62%; height: 62%; }
  /* 连续同侧消息的后续行（issue #191 问题 2）：头像**只显示在第一条**。
     ⚠️ 只做 visibility: hidden —— 节点始终留在 DOM 里（摘节点会踩 issue #154 的锚点塌陷）。
     助手侧的续行另外带 data-we-avatar-cont：该行退化成单列、列间距归零，隐藏的头像
     移出 grid 流（position:absolute），于是既不留 40px 空列、也不撑出 40px 行高，
     正文回到与折叠头同一条左边缘。用户侧不塌列（气泡本来就靠右）。 */
  .we-avatar--cont { visibility: hidden; }
  body[data-we-avatar="on"] [data-we-avatar-row="ai"][data-we-avatar-cont] {
    grid-template-columns: minmax(0, 1fr);
    column-gap: 0;
  }
  body[data-we-avatar="on"] [data-we-avatar-row="ai"][data-we-avatar-cont] > .we-avatar {
    position: absolute;
    visibility: hidden;
    pointer-events: none;
  }
  body[data-we-avatar="on"] [data-we-avatar-row="ai"][data-we-avatar-cont] > :not(.we-avatar):not([data-slot]),
  body[data-we-avatar="on"] [data-we-avatar-row="ai"][data-we-avatar-cont] > [data-slot] > :not(.we-avatar) { grid-column: 1; }
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
