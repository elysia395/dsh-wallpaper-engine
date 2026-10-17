/**
 * styles-settings.js —— 样式域模块 **SETTINGS**（原 src/styles.js 第 1916–2167 行，共 252 行）。
 *
 * 内容：设置行与导航 —— 预设方案圆角表格 · 原生下拉弹层 · 视觉分组 divider · 可折叠节头 · 侧栏窄栏兜底 · 页签栏分段式 · 统一设置行 32px。
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
const CSS_SETTINGS = `  /* ── 预设方案：两行四列的圆角表格（用户口径）──────────────────────────────
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
  /* ── #164：原生下拉的弹层选项行必须显式上「不透明底 + 与底成对比的墨」（用户报告：
     下拉全是「底色与字同色」）──Chromium 的弹层是一份独立文档：画布只在 select 自身
     背景**不透明**时才取它的底色，而我们的 select 是透明玻璃底 ⇒ 弹层落到默认**浅色**
     画布；选项文字却继承 select 的墨色 ⇒ 深色主题（浅字）落浅底、用户把"正文"角色设成
     浅色时同样白字白底。Chromium 弹层按 option 的**已解析**计算样式逐行绘制（var 在
     页面内已解析，弹层文档照抄结果），所以修法就是在 option 上钉死这一对。
     ⚠️ 这一条是**全局**的（不止我们的 picker）：宿主其他原生下拉的弹层是同一个洞，
     行色统一成「主题默认配对」——未自定义墨色时应无视觉差异。刻意用元素选择器而不挂
     宿主 CSS-module 哈希类名（本仓红线），宿主升级后自动续效。 */
  select option {
    background-color: var(--we-popup-row-bg, #ffffff);
    color: var(--we-popup-row-ink, #1f2328);
  }
  /* 分组下拉（optgroup）的分组标签走的是同一个机制：只钉 option 会把它漏在「select 墨色
     × 默认画布」那一档里 ⇒ 同一个洞。这条与上面那条同对令牌、同作用域深度。 */
  select optgroup {
    background-color: var(--we-popup-row-bg, #ffffff);
    color: var(--we-popup-row-ink, #1f2328);
  }
  /* 选中行单钉：UA 用 Highlight 蓝画 option:checked，不吃上面那对行令牌。填充读
     --we-accent-src 而**不是** --we-accent —— 设置窗那个作用域块末尾把 --we-accent 主动
     掐成 initial、块内既有消费一律走 -src，而 #164 的复现入口恰在窗内：读 --we-accent
     会恒落到兜底色，既与用户配色脱钩、又与**跟随用户的**墨色错配。墨读
     --we-popup-row-checked-ink，由 effects.js 的 weCheckedRowInk 按**实算对比度取大**
     在纯黑 / 纯白之间下发（刻意不沿用按钮那条 0.45 阈值：中亮度 accent 上白字只有
     2.1–4.58:1，同区间黑字恒更优；两支取大的全局下界 = 等点 L≈0.1791 处的 4.58:1）。
     这里的兜底 #000000 **必须等于 JS 对缺省填充的判决**：兜底只在 accent 解析不出来、
     JS 没写值时才可达，而那一档填充同时落回缺省 #4f8cff —— 对 #4f8cff（L≈0.29 > 等点
     0.1791）择优给出的正是纯黑。曾经这里写死 #0f1115 而填充侧是 #4f8cff：那个组合虽然
     恰好 5.87:1，但它是**手抄的巧合**，不是同一套择优逻辑（暗臂一漂就再也对不上）。
     F10c 把"兜底墨 === weCheckedRowInk(兜底填充)"钉成判据，防止再手抄。选中态仍是
     「另一种底色」，可辨识。 */
  select option:checked {
    background-color: var(--we-accent-src, #4f8cff);
    color: var(--we-popup-row-checked-ink, #000000);
  }
  /* 自家 picker 子树上再钉一遍（同一对令牌）：这条特异性更高，宿主若有以类名压 option
     的规则也盖得过去。作用域同时钉类名（.we-picker__select —— 侧栏/抽屉的 select 不在
     .we-picker 子树内，靠类名够到）与后代选择器（设置窗内一切 select，含属性面板）。 */
  .we-picker select option, .we-picker__select option {
    background-color: var(--we-popup-row-bg, #ffffff);
    color: var(--we-popup-row-ink, #1f2328);
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
       「找路」层级倒挂（用户口径：红圈那批标题要一眼跳出来）。 */
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
  /* 禁用态的一整行（「全局 UI 配色」的「全局配色」行：开了「UI 配色自定义」后不由它说了算）。
     ⚠️ 只做「看得出失效 + 点不动」，**不隐藏** —— 用户口径是"禁用"，且留着这一行才读得懂
     "此刻是谁在决定颜色"。pointer-events:none 同时挡掉色板与取色器；渲染器那边也给了空
     处理器 —— 两道都有，样式万一挂了也不至于写脏配置。 */
  .we-picker__ctl--disabled { opacity: 0.45; pointer-events: none; }
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

`;

export { CSS_SETTINGS };
