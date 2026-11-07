/**
 * styles-chrome.js —— 样式域模块 **CHROME**。
 *
 * 内容（ADR-0016 第四刀玻璃段出户后）：统一控件 token · DSH corner-shape 兼容(#74)。整窗玻璃与插件源浮层随玻璃包走。
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
const CSS_CHROME = `  /* Picker chrome. */
  .we-picker {
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

  /* 统一运行器发放绘制资格，不通过共享令牌或任意后代清底。 */
  body[data-we-glass-page] :where([data-we-surface-runtime="settings-window"],[data-we-surface-runtime="declared"],[data-we-layout-runtime]) {
    background: transparent !important;
  }
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
`;

export { CSS_CHROME };
