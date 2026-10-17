/**
 * styles-chrome.js —— 样式域模块 **CHROME**（原 src/styles.js 第 1623–1915 行，共 293 行）。
 *
 * 内容：原生窗口与浮层 —— 统一控件 token · 原生设置整窗玻璃 · 插件源浮层 · DSH corner-shape 兼容(#74)。
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
const CSS_CHROME = `    /* ── 统一控件 token：一套高度/圆角/墨色词汇贯穿全部控件 ──
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
     模糊半径读「浮层玻璃」这条子项的私有量 --we-floaters-blur（src/glass.js:301 无条件接线，
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
`;

export { CSS_CHROME };
