/**
 * effects.js — 把设置**应用到 DOM**（CSS 变量、内联样式、光标、scrim）。
 *
 * 为什么单独一个文件：这是"设置 → 界面"的落地层，同一层里同时有 scrim 即时性优化、
 * 玻璃/雾化合成、光标注入、壁纸淡出底色选择四件事（**字体自定义不在这里**，见
 * src/font/apply.js）。它与设置表、求值器一样属于"看得懂的单元"，放在这里就不必在
 * client.js 那一大片正文里定位。
 *
 * 契约（本文件是客户端程序的一部分，构建期由 scripts/build-client.mjs 内联进 bundle 的
 * 工厂作用域，因此"外部作用域"= 同一 prelude / src/client.js 的顶层。依赖是**机械清点**
 * 出来的，不是印象）：
 *   selection                    ← 设置/选中项的唯一 store（顶层 const，定义于 client.js 前部）
 *   SCRIM_ID                     ← scrim 元素的固定 id（顶层 const）
 *   GLASS_SATURATE               ← 玻璃饱和度耦合常量（顶层 const）
 *   syncSceneAudio(selLike)      ← 场景音轨同步（顶层 function）
 *   detectMicaSupport()          ← 惰性探针：Mica 支持
 *   detectSoftwareRender()       ← 惰性探针：软件渲染回退
 *   adapterCaps()                ← src/adapter.js（适配目标能力矩阵 → body 属性）
 *   useLegacySaturateCoupling()  ← 惰性探针：`?we-saturate=legacy` 那条旧耦合斜坡是否生效
 *   applyComponentFonts()        ← src/font/apply.js（字体：组件作用域）
 *   removeComponentFonts()       ← 同上
 *   snapshotHostFontDefaults()   ← 同上（宿主角色色快照）
 *   removeFontStyles()           ← 同上
 * 提供的入口：applyEffects() / clearEffects()（client.js 各有一处调用；其余 apply* / remove*
 * 助手仅本文件内部使用，导出是为了让守卫能单独取用）。
 *
 * 不变量：
 *   · **`applyEffects()` 只读 `selection`、不写它** —— 写设置是 UI 处理器与 apply(ctx) 的事，
 *     本文件只负责呈现。
 *   · **唯一例外是 `clearEffects()`**（卸载 / 清空壁纸那条路）：它把"当前壁纸的播放态"复位成
 *     空态（`videoPlaying` / `videoError` / `blockedNote` / `sceneAudioUrl` / `sceneHasAudio`），
 *     否则禁用插件后屏上会留着上一张壁纸的播放错误与被过滤提示（#84）。它同样**不写任何设置、
 *     不落盘** —— 这条边界是"呈现层不拥有设置"，不是"呈现层不碰 selection"。判据只许按
 *     "`applyEffects` 的函数体里没有对 selection 的赋值"来写，别写成"本文件不写 selection"。
 *   · 内联样式只写自己拥有的属性（`--we-*` 与少数原生属性），清理时必须成对（clearEffects）。
 *   · scrim 的"内联写 + 强制 reflow"只在值**真的变化**时跑（lastScrimCss 记忆）——
 *     每次 emit 都跑会变成 forced synchronous layout 风暴（滑块每格两次 + 500ms 转码轮询）。
 *   · 本文件必须保持浏览器安全（无 import / require / Node API），且**不得有顶层可执行语句**
 *     —— 它会被内联到 bundle 顶部（早于 client.js 正文），顶层读 body 里的 const 会撞 TDZ。
 */

// Scrim immediacy tracking: the inline-write + forced reflow below only runs
// when the scrim value ACTUALLY changed. It used to run unconditionally on
// every emit — i.e. twice per slider tick (handler + subscribed applyEffects)
// and on every 500ms transcode poll — a forced synchronous layout storm.
let lastScrimCss = "";
// 壁纸淡出底色的**缓存**（拖动期用；见 applyEffects 的 live 说明）。空串 = 还没算过 /
// 已失效（壁纸透明度归零时清掉）。
let lastFadeBg = "";

// ── 输入光标颜色注入（#83）──────────────────────────────────────────────────
// <style id="we-caret-patch"> 把 body 上的 --we-caret-color 应用到所有文本
// 输入位（textarea / input / contenteditable）。caret-color 可继承，覆盖到
// contenteditable 的子节点无需逐个枚举；!important 压过宿主可能存在的显式
// caret-color 声明。只在用户选了颜色时注入 —— 未设置时连规则都不进 DOM，
// 光标保持 dsh 原生表现（auto 会随主题自动调整，是最不碍事的默认）。
// 与字体自定义（fontCustom）互不依赖：字体染色关闭时本样式照常生效，反之
// 字体开启而光标未设置时也不注入（fontCustom 的 color 不写 caret-color，
// 两者不冲突）。
function applyCaretStyles() {
  try {
    let st = document.getElementById("we-caret-patch");
    if (!st) {
      st = document.createElement("style");
      st.id = "we-caret-patch";
      (document.head || document.documentElement).appendChild(st);
    }
    st.textContent = [
      'body textarea,',
      'body input,',
      'body [contenteditable="true"],',
      'body [contenteditable="plaintext-only"],',
      'body [contenteditable=""] {',
      '  caret-color: var(--we-caret-color) !important;',
      '}',
    ].join('\n');
  } catch { /* ignore */ }
}

function removeCaretStyles() {
  const st = document.getElementById("we-caret-patch");
  if (st) st.remove();
}

// 壁纸淡出底色 = **原生外观**（浅色纯白 / 深色纯黑）。这是「壁纸透明度」拉高时
// 应该露出来的那一层：垫在 .we-layer 上让透明化壁纸的合成像素保持不透明（见
// applyEffects 内 --we-wallpaper-opacity 注释：透明 backdrop 会让 backdrop-filter
// 失效）。
// ⚠️ 刻意**不**用 --dsw-alias-bg-layer-1：那是面板底色（深色下是深蓝灰），淡出后
// 会留下一块与原生外观不符的主题色（用户反馈：期望露出纯黑 / 纯白）。
// 外壳自己的「页面基色」token 若可用就尊重它（没有壁纸时页面本来就是这个颜色）；
// 插件在壁纸激活时把它置为 transparent，因此正常路径就是下面的纯黑 / 纯白。
function resolveWallpaperFadeBg() {
  try {
    const t = getComputedStyle(document.body).getPropertyValue("--dsw-alias-bg-base").trim();
    if (t && t !== "transparent" && t !== "rgba(0, 0, 0, 0)" && t !== "#00000000") return t;
  } catch { /* ignore */ }
  try {
    return document.body.hasAttribute("data-ds-dark-theme") ? "#000000" : "#ffffff";
  } catch { return "#000000"; }
}

// ── accent 墨色：任意用户配色上的可读前景（黑/白）────────────────────────────
// issue #127：宿主的 primary 控件契约是「填充 × label-primary-foreground 反色墨」
//（dsh-client-ui-primitives/Button.module.css，两值都随主题翻转、永远互为反色）。
// 我们把填充重映射成**任意亮度**的用户配色后，主题静态墨色不再保证可读 ——
// 浅色配色（黄）× 浅色主题墨（白）≈ 1.5:1，小字号下就是「文字与背景同色」。
// 这里按 WCAG 相对亮度选边：亮 accent 配宿主深墨（#0f1115，与主题静态值同源），
// 暗 accent 配白。纯函数；阈值取 0.45（黑/白两臂在常用配色上都拿到 ≥3:1，
// 深墨臂在黄上实测 ~11:1）。verify-readability 从 bundle 抽函数复算时不受影响。
function weAccentInk(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || ""));
  if (!m) return "#ffffff";
  const s2l = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const rgb = [0, 2, 4].map((i) => s2l(parseInt(m[1].slice(i, i + 2), 16)));
  const lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  return lum > 0.45 ? "#0f1115" : "#ffffff";
}

// ── 染色地板：可读性底色 = 玻璃色经亮度钳制（色相跟随用户） ──────────────────
// 地板色是**玻璃色经亮度钳制后的版本** —— 深色主题过亮就压暗、浅色主题过暗就提亮，
// 色相交给用户；对比度判据与 #82 同一条网格（正文 vs 表面合成到最坏背衬 ≥4.5:1）。
// 主题白/黑（浅 #ffffff / 深 #0d1524）只在**用户没给玻璃色**时当地板缺省值用。
// 钳制口径与 verify-readability 同款、**不含层权重**：
//   深色最坏 = color·(F + 0.10·0.4·(1−F)) + 白·(1 − (F + 0.10·0.4·(1−F)))  （白背衬、最透档，
//   0.4 = 深色主题的 frost 层因子 —— 与浅色不同，深色的玻璃色份额要先乘 0.4）
//   浅色最坏 = color·(F + 0.10·(1−F))                               （黑背衬、同 alpha）
// 其中 0.10 = 玻璃透明度滑杆拉满后的 --we-glass-alpha（见 applyEffects 的曲线），
// 两处数字必须同步改。纯函数：verify-readability 会从 bundle 里抽出本函数复算网格。
//
// 第三参 fidelity（0–1，缺省 1 = 完整红线）：玻璃保真度滑杆（glassFidelity）
// 的数学入口。语义是**两段式**：先用满档地板跑一遍完整红线的钳制（= f=1 的现状，
// 逐位），再把结果向用户原色线性回退 —— f=1 逐位现状、f=0 原色直出，中间档单调，
// 不存在「降保真度反而更黑/更白」的悬崖。地板层覆盖度的减薄在 styles.js
//（--we-readability-floor = 常量 × --we-glass-fidelity），两处同一滑杆、各管一半：
// 这里管釉色本身的回退，那里管地板覆盖度。两处的组合效果（合成对比度随保真度
// 单调下降）由 verify-readability C0f 钉住。
function weClampSurfaceColor(hex, theme, fidelity) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || ""));
  if (!m) return theme === "dark" ? "#0d1524" : "#ffffff";
  const fidNum = Number(fidelity);
  const f = (fidelity === undefined || fidelity === null) ? 1
    : (Number.isFinite(fidNum) ? Math.min(1, Math.max(0, fidNum)) : 1);
  const rgb = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  const s2l = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * s2l(c[0]) + 0.7152 * s2l(c[1]) + 0.0722 * s2l(c[2]);
  // ── 第一段：完整红线的钳制 ────────────────────────────────────────────────
  // 地板权重用**满档常量**（不是减薄后的值）：这一步回答的是「这个颜色在完整
  // 地板下能不能直出」，与保真度无关 —— 保真度只影响下一步的回退幅度。
  const F = theme === "dark" ? 0.59 : 0.45;
  // 最坏 alpha：最透档（滑杆 60 → --we-glass-alpha 0.10）× 深色主题的 0.4 层因子
  //（与样式表深色 composer 卡的 rgba(255,255,255, calc(--we-glass-alpha * 0.4)) 同源）。
  const darkFactor = theme === "dark" ? 0.4 : 1;
  const aMin = F + 0.10 * darkFactor * (1 - F);
  // 钳制目标 4.6 而非 4.5：二分结果要**四舍五入回 hex**（每通道 1/255 量化），
  // 卡着 4.5 收敛的色经量化后会掉到 4.4997 被守卫判红 —— 留 0.1 的舍入余量。
  const passes = (c) => {
    const comp = c.map((v) => v * aMin + (theme === "dark" ? 255 : 0) * (1 - aMin));
    const contrast = theme === "dark"
      ? 1.05 / (lum(comp) + 0.05)
      : (lum(comp) + 0.05) / 0.05;
    return contrast >= 4.6;
  };
  const toHex = (c) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  let clamped = rgb;
  if (!passes(rgb)) {
    const target = theme === "dark" ? [0, 0, 0] : [255, 255, 255];
    let lo = 0;  // 不合格端
    let hi = 1;  // 合格端（纯黑/纯白必过：深色 5.79:1、浅色 4.67:1）
    for (let i = 0; i < 12; i++) {
      const t = (lo + hi) / 2;
      const c = rgb.map((v, j) => v * (1 - t) + target[j] * t);
      if (passes(c)) hi = t; else lo = t;
    }
    clamped = rgb.map((v, j) => v * (1 - hi) + target[j] * hi);
  }
  // ── 第二段：向用户原色线性回退 ────────────────────────────────────────────
  // f=1 → 完整钳制色（现状逐位）；f=0 → 原色。逐通道线性 ⇒ 色相保真随档位单调
  // 改善，中间档严格夹在两端之间（verify-readability C0f 钉死单调性与夹逼）。
  if (f >= 1) return toHex(clamped);
  return toHex(clamped.map((v, j) => v * f + rgb[j] * (1 - f)));
}

function applyEffects(opts) {
  // `live` = 拖动期的每一格（色板 / 滑块）。那些格子里只有"与本次改动相关的那几个样式"
  // 需要更新，而下面几步与拖动无关却都不便宜 ⇒ 拖动期跳过、抬手那一次（无 opts）照跑：
  //   · 字体样式表（snapshotHostFontDefaults + applyComponentFonts / removeFont*）
  //   · 场景音频互斥（syncSceneAudio —— 音量滑块自己在处理器里同步，见 onVideoVolume）
  //   · 壁纸淡出底色里的**强制同步样式计算**（getComputedStyle ⇒ 整页 style recalc；
  //     拖动期沿用缓存值，它只随主题 / 宿主页面基色 / 有无壁纸变）
  //   · scrim 的强制回流（拖动期每格都在重写，回流留给抬手那一次）
  // 语义仍是同一个函数、同一份真源：样式变量照旧**全量**写，只是不重跑无关的重活。
  const live = Boolean(opts && opts.live);
  const s = document.body.style;
  s.setProperty("--we-scrim-color", "rgba(0,0,0," + selection.scrim + ")");
  // Border emphasis: the border tokens are low-alpha hairlines; raise their
  // alpha via a neutral gray so both light and dark themes stay legible.
  s.setProperty("--we-border-alpha", String(selection.border));
  // Glass blur strength in px (0 disables the frosted-glass effect).
  s.setProperty("--we-blur", selection.blur + "px");
  // iOS liquid glass: the backdrop "colour melt" (saturation) is a CONSTANT
  // material property, DECOUPLED from the blur radius — the 玻璃 slider now
  // drives ONE thing (frost depth, --we-blur) instead of two semantically
  // unrelated ones. Rationale: --we-saturate amplifies whatever chroma the
  // backdrop still carries, and blur is what smears the residual wallpaper text
  // into that chroma. The old coupled ramp therefore magnified exactly the
  // signal the owner reads as 荧光/彩色鬼影 (a fluorescent colour ghost) instead
  // of a neutral haze, worst at the top of the slider where the amplification
  // met the most smearing. A flat value kills the runaway at high radii while
  // keeping the "wet glass" chroma lift at every radius. GLASS_SATURATE is
  // deliberately BELOW the stylesheet's own 1.8 fallback (what applies before
  // this variable is first written), so the steady-state glass is milder than
  // the pre-write default rather than stronger.
  //   blur px:     0      15     30     45     60
  //   old:       1.15   1.57   1.99   2.41   2.83   (1.15 + blur*0.028)
  //   new:       1.30   1.30   1.30   1.30   1.30   (constant; 6.1x less chroma
  //                                                  amplification at 60px)
  // ?we-saturate=legacy restores the old coupled ramp byte-for-byte (A/B
  // escape hatch, see useLegacySaturateCoupling).
  s.setProperty("--we-saturate", useLegacySaturateCoupling()
    ? String(1.15 + selection.blur * 0.028)
    : String(GLASS_SATURATE));
  s.setProperty("--we-glass-brightness", "1.04");
  // ── R4 死码清理：这里曾写 `--we-wallpaper-blur` / `--we-wallpaper-scale` /
  //   `--we-wallpaper-flip` 三个变量 —— 整份样式表**没有任何 var() 消费者**
  //   （模糊真的落在下面的 `--we-media-filter` 上，scale+flip 真的落在
  //   `--we-wallpaper-transform` 上）。三个都是那次重构留下的中间量，已删
  //   （守卫第 ⑭ 组："经 setProperty 写出的变量必须有人读"）。
  // Background media filter: blur() plus the brightness/contrast/saturate
  // knobs, omitting untouched terms. Kept "none" while every knob is at its
  // default (see .we-media above) so no offscreen filter layer is forced on
  // the wallpaper video/canvas.
  const filterTerms = [];
  if (selection.wallpaperBlur > 0) filterTerms.push("blur(" + selection.wallpaperBlur + "px)");
  if (selection.backgroundBrightness !== 100) filterTerms.push("brightness(" + selection.backgroundBrightness + "%)");
  if (selection.backgroundContrast !== 100) filterTerms.push("contrast(" + selection.backgroundContrast + "%)");
  if (selection.backgroundSaturate !== 100) filterTerms.push("saturate(" + selection.backgroundSaturate + "%)");
  s.setProperty("--we-media-filter", filterTerms.length ? filterTerms.join(" ") : "none");
  // Compensate for the fringe the blur reveals by scaling the layer up.
  const scale = (1 + selection.wallpaperBlur * 0.006).toFixed(4);
  // Single transform var, "none" when identity (no blur, no flip): an identity
  // scale(1) scaleX(1) still forces the full-screen wallpaper <video> onto a
  // transform compositing layer at default — one less always-on layer for the
  // kiosk window to glitch on (the previous anti-flicker pass left this).
  s.setProperty("--we-wallpaper-transform",
    (selection.wallpaperBlur > 0 || selection.flip)
      ? ("scale(" + scale + ") scaleX(" + (selection.flip ? "-1" : "1") + ")")
      : "none");
  // Fit mode for the current wallpaper (consumed by .we-media--fit).
  s.setProperty("--we-object-fit", selection.objectFit);
  // 壁纸透明度（#82）：越大越透 —— 0% 时不设变量，保持 identity opacity
  // （Blink 对 opacity:1 不建合成层，设置了反而给 kiosk 窗口多一层常驻合成）。
  // 渲染引擎约束（实测）：DSH 页面底色是透明的，壁纸层一旦整体
  // 半透明，玻璃表面 backdrop-filter 的取样背景出现大面积透明像素，本
  // Electron 合成器在该背景上不再有效模糊 —— 玻璃后文字透出（composer 区
  // 高频能量 +90%）。修复：透明生效时给 .we-layer 垫主题实色（--we-wallpaper-
  // fade-bg），opacity 移到 .we-media 叶子 —— layer 合成像素保持不透明
  // （壁纸向页面底色淡出，语义不变），玻璃模糊恢复（实测锐度回到基线）。
  // 暗化（scrim）叠在壁纸之上：淡出壁纸时它会同时压暗页面底色。
  if (selection.wallpaperOpacity > 0) {
    s.setProperty("--we-wallpaper-opacity", String((100 - selection.wallpaperOpacity) / 100));
    // 拖动期沿用缓存（见函数头的 live 说明）：resolveWallpaperFadeBg 里那次
    // getComputedStyle 是**强制同步样式计算**，每格一次会把拖动拖垮。
    if (!live || !lastFadeBg) lastFadeBg = resolveWallpaperFadeBg();
    s.setProperty("--we-wallpaper-fade-bg", lastFadeBg);
  } else {
    s.removeProperty("--we-wallpaper-opacity");
    s.removeProperty("--we-wallpaper-fade-bg");
    lastFadeBg = "";
  }

  // Settings-page liquid-glass theming:
  // - --we-accent: plugin-owned accent color; every fallback below that used
  //   the shell's brand token (var(--dsw-alias-brand-primary, #4f8cff)) now
  //   reads --we-accent first, so the 配色 control restyles the whole picker
  //   and glass highlights without touching the shell theme.
  // - ⚠️ 设置窗内部**不吃** body 这份 --we-accent（styles.js 的整窗规则把它
  //   `initial` 掉，见那里的 issue #127 注释）—— 第三方 settings 分区若拿
  //   var(--we-accent) 当文字色、又恰好落在我们重映射成 accent 的填充上，
  //   文字与底就逐像素同色（黄底黄字）。窗内消费一律改读 --we-accent-src，
  //   由 .we-picker 根重新别名；body 这份只服务窗外的消费者（快捷面板 / 拉绳）。
  s.setProperty("--we-accent", selection.accent);
  s.setProperty("--we-accent-src", selection.accent);
  // - --we-accent-ink: accent 上的可读墨色（黑/白，按 WCAG 相对亮度选边）——
  //   宿主设计系统的契约是「primary 填充 × label-primary-foreground 反色墨」
  //   （见 dsh-client-ui-primitives Button.module.css），填充被重映射成任意
  //   用户配色后，主题静态墨色不再保证可读（浅色配色 × 浅色主题墨 = 白底黄钮）。
  //   .we-picker__btn--primary 与整窗映射消费它。
  s.setProperty("--we-accent-ink", weAccentInk(selection.accent));
  // - --we-glass-alpha: white-overlay alpha of the glass surfaces. The 玻璃透明
  //   度 slider semantics: higher = MORE transparent (clearer wallpaper shows
  //   through), lower = closer to solid. 0% → ~0.25 (frosted, solid-ish),
  //   60% → ~0.10 (轻霜 —— 染色地板下限不再让颜色在拉满端消失，旧值 0.03 会让
  //   玻璃色份额塌到 ~1%、只剩主题底色 = 用户报的"拉满变黑/变白")。
  const glassAlpha = Math.max(0.10, 0.25 - (selection.glassAlpha / 100) * 0.15);
  s.setProperty("--we-glass-alpha", String(glassAlpha));
  // ── R4：这个变量**曾被列入死码清理**，最后决定**保留**（wip §10.18）─────────────
  // 它确实没有 CSS 消费者（配方早改读下面钳制出来的 `--we-surface-tint-light/dark`），
  // 但 `test/compat-harness-pages.mjs` 把它当**页面观察量**断言（`getComputedStyle(body)`
  // 读它、并要求非空 + DSH 的设置窗口 token 与之同源）。那个 harness 不在任何 npm 脚本里
  // （要浏览器页面），所以我**无法在此验证**改动它之后的结局 —— 先删写入 = 静默破坏一个
  // 未经验证的观察者。正确顺序是：先把 harness 的观察点改成 `--we-surface-tint-light`，
  // 再删这里的写入。在那之前它由守卫第 ⑭ 组的 `OBSERVED_ONLY` 登记表**显式豁免**。
  s.setProperty("--we-glass-color", selection.glassColor);
  // - 玻璃保真度（0–100，默认 100 = 完整红线）：同一标量喂两处消费 —— styles.js
  //   的 --we-readability-floor（地板覆盖度）与 weClampSurfaceColor（釉色向原色
  //   的回退幅度）。两处必须同源，滑杆才是一个旋钮。
  const fidNum = Number(selection.glassFidelity);
  const glassFidelity = Number.isFinite(fidNum) ? Math.min(1, Math.max(0, fidNum / 100)) : 1;
  s.setProperty("--we-glass-fidelity", String(glassFidelity));
  // - 染色地板：按主题把玻璃色钳制进可读亮度带，供样式表的
  //   --we-readability-base（地板层）与全部 frost 槽位消费 —— 对话框/侧栏等
  //   宿主表面由此拿到**用户的色相**而非主题白/黑，正文对比度判据不变。
  //   保真度 < 100 时釉色向原色线性回退（见 weClampSurfaceColor 第三参）。
  s.setProperty("--we-surface-tint-light", weClampSurfaceColor(selection.glassColor, "light", glassFidelity));
  s.setProperty("--we-surface-tint-dark", weClampSurfaceColor(selection.glassColor, "dark", glassFidelity));
  // RGB 三元组形式：给 rgba() 槽位用（消息气泡 / 输入框的白釉染色）。
  s.setProperty("--we-surface-tint-rgb-light", toRgbTriple(weClampSurfaceColor(selection.glassColor, "light", glassFidelity)));
  s.setProperty("--we-surface-tint-rgb-dark", toRgbTriple(weClampSurfaceColor(selection.glassColor, "dark", glassFidelity)));

  // ── 玻璃管线已抽到 src/glass.js（wip §10.13）：取值解析 / 各面釉层变量 / 门控属性 ──
  //    这里只留**一行调用**；本文件继续负责全局玻璃量（--we-glass-* / --we-surface-tint-*）
  //    与其余非玻璃效果（accent / 可读性 / 光标 / 壁纸 / 字体）。
  applyGlass(selection, s);

  // 适配目标钩子（src/adapter.js）：把最终目标挂到 <body>，外壳材质类选择器
  // 一律经 [data-we-adapter^="desktop-"] 门控 —— 原生浏览器形态永远不吃桌面壳
  // 的材质规则。取值恒为三档之一（auto 在 resolve 里已被消解），手选改动后
  // 下一次 applyEffects 就换值；与其它 body 钩子一样成对清理。
  document.body.setAttribute("data-we-adapter", adapterCaps().target);

  // 左侧工作区（增强模式）的 Mica 能力钩子（#73，见 detectMicaSupport）：Windows
  // 上无 Mica（Win10 / build < 22621 / 探测不到）时挂 data-we-mica="off"，CSS 用
  // 插件自己的近不透明玻璃面接管 .dshDesktopSidebarSurface，替代对系统材质的依赖；
  // 支持或不适用（非 Windows）时移除，保持原生。探测结果缓存，这里只做同步读写。
  if (detectMicaSupport() === false) document.body.setAttribute("data-we-mica", "off");
  else document.body.removeAttribute("data-we-mica");

  // 软件渲染钩子（#95，见 detectSoftwareRender）：@supports 只做语法检查，软件
  // 合成下 backdrop-filter 被静默忽略时它依然为真，所以近不透明回退必须靠运行时
  // 探测来挂载。命中时 CSS（body[data-we-glass-fallback]）让面板/侧栏/内容面/
  // 弹层改用与 @supports 回退完全相同的配方，并显式 backdrop-filter: none。
  if (detectSoftwareRender()) document.body.setAttribute("data-we-glass-fallback", "1");
  else document.body.removeAttribute("data-we-glass-fallback");

  if (!live) {
    // 字体自定义：**已无任何全局字体配置** —— 只剩「按角色」（颜色/排版/字重/字族，见
    // src/font/color-roles.js 与 typography.js）与「按组件」（src/font/components.js）
    // 两套作用域覆盖。这里只做两件事：取一次宿主角色色快照（面板要显示「当前默认色」）、
    // 同步组件样式表（没配就当没有，清空样式表）。
    if (selection.fontCustom) {
      snapshotHostFontDefaults();
      applyComponentFonts();
    } else {
      removeFontStyles();
      removeComponentFonts();
    }
  }

  // 输入光标颜色（#83）：空 = 跟随 dsh 原生（清空变量 + 不注入样式表）；
  // 选定颜色后经 we-caret-patch 以 !important 覆盖所有文本输入位。与壁纸
  // 是否启用无关 —— 这是独立的可读性设置，壁纸关掉后依然生效。
  if (selection.caretColor) {
    s.setProperty("--we-caret-color", selection.caretColor);
    applyCaretStyles();
  } else {
    s.removeProperty("--we-caret-color");
    removeCaretStyles();
  }
  // 壁纸音轨随设置变化即时生效（音量滑块/总开关），场景包内音频同理。拖动期跳过：
  // 音量滑块自己在处理器里同步（onVideoVolume），其余字段与它无关。
  if (!live) syncSceneAudio(selection);

  // Scrim immediacy: some composited/kiosk environments do not repaint a
  // z-index:-1 layer promptly when only an inherited CSS variable changes.
  // Write the resolved color DIRECTLY onto the scrim element's inline style and
  // then force a synchronous layout — but ONLY when the value changed (see
  // lastScrimCss above), and NOT while dragging (拖动期每格都在重写，回流留给抬手)。
  const scrimCss = "rgba(0,0,0," + selection.scrim + ")";
  if (scrimCss !== lastScrimCss) {
    lastScrimCss = scrimCss;
    const scrim = document.getElementById(SCRIM_ID);
    if (scrim) {
      scrim.style.background = scrimCss;
    }
    // Force reflow so a stalled compositor picks up the new value immediately.
    if (!live && document.body) {
      void document.body.offsetHeight;
    }
  }
}

function clearEffects() {
  const s = document.body.style;
  lastFadeBg = "";
  s.removeProperty("--we-scrim-color");
  s.removeProperty("--we-border-alpha");
  s.removeProperty("--we-blur");
  s.removeProperty("--we-saturate");
  s.removeProperty("--we-glass-brightness");
  s.removeProperty("--we-media-filter");
  s.removeProperty("--we-object-fit");
  s.removeProperty("--we-wallpaper-opacity");
  s.removeProperty("--we-wallpaper-fade-bg");
  s.removeProperty("--we-accent");
  s.removeProperty("--we-accent-src");
  s.removeProperty("--we-accent-ink");
  s.removeProperty("--we-glass-alpha");
  s.removeProperty("--we-glass-color");
  s.removeProperty("--we-surface-tint-light");
  s.removeProperty("--we-surface-tint-dark");
  s.removeProperty("--we-surface-tint-rgb-light");
  s.removeProperty("--we-surface-tint-rgb-dark");
  document.body.removeAttribute("data-we-glass-window");
  document.body.removeAttribute("data-we-left-sidebar");
  // ⚠️ W5 新增的三个门控属性**也必须在这里撤掉**（与上面两个同批）：
  //    漏掉它们 ⇒ 插件被禁用 / HMR 卸载后，宿主 DOM 上仍留着 `data-we-glass-chat` /
  //    `data-we-glass-floaters`，而挂在这些属性上的规则组**照旧生效** ——
  //    表现为"插件已卸载，但玻璃还在"。这类残留只有卸载路径才暴露，日常切换看不出来。
  document.body.removeAttribute("data-we-glass-chat");
  document.body.removeAttribute("data-we-glass-floaters");
  s.removeProperty("--we-sidebar-blur");
  s.removeProperty("--we-sidebar-saturate");
  s.removeProperty("--we-sidebar-sheen");
  s.removeProperty("--we-sidebar-color");
  s.removeProperty("--we-sidebar-tint");
  document.body.removeAttribute("data-we-sidebar-glass");
  document.body.removeAttribute("data-we-adapter"); // 适配目标钩子随 fiber 注销
  document.body.removeAttribute("data-we-mica"); // #73 Mica 能力钩子随 fiber 注销
  document.body.removeAttribute("data-we-glass-fallback"); // #95 软件渲染回退钩子同上
  s.removeProperty("--we-content-surface-alpha");
  s.removeProperty("--we-content-surface-color");
  // ⚠️ W2–W4 新增的**按面釉层变量**同样要撤（否则卸载后残留的变量值会继续被
  //    那几条规则读到 —— 与属性残留是同一类问题）。逐面列出，不用循环：
  //    它们分散在三个面、名字不同，显式列出比"一个前缀循环"更不容易漏。
  for (const v of [
    "--we-settings-window-blur", "--we-settings-window-alpha",
    "--we-left-sidebar-blur", "--we-left-sidebar-alpha",
    "--we-floaters-blur", "--we-floaters-alpha",
    // ⚠️ 对话栏那一族（`--we-chat-*`）**提交态就没在撤** —— 既有缺陷，本次一并补上：
    //    它们是对话栏专属釉层变量，卸载后残留同样会被那几条规则读到。
    //    （判据"清理对称性"把这一组和上面 6 个一起抓了出来。）
    "--we-chat-glass-fidelity", "--we-chat-surface-tint-light", "--we-chat-surface-tint-dark",
    "--we-chat-surface-tint-rgb-light", "--we-chat-surface-tint-rgb-dark",
  ]) s.removeProperty(v);
  // 画布兜底色写在根元素上（见 src/live-layer.js 的 refreshUnderlayColor）：它不在
  // body 的变量表里，必须显式撤掉 —— 否则禁用插件后根元素会一直带着上一张壁纸的颜色。
  clearUnderlayColor();
  removeFontStyles();
  s.removeProperty("--we-caret-color");
  removeCaretStyles();
  selection.sceneAudioUrl = null;
  selection.sceneHasAudio = false;
  syncSceneAudio(selection);
  const scrim = document.getElementById(SCRIM_ID);
  if (scrim) scrim.style.background = "";
  lastScrimCss = "";
  // 插件卸载（禁用 / HMR）后不该留下上一张壁纸的播放错误 / 被过滤提示（#84）。
  selection.videoPlaying = true;
  selection.videoError = "";
  selection.blockedNote = "";
}
export {
  applyEffects, clearEffects,
  applyCaretStyles, removeCaretStyles, resolveWallpaperFadeBg,
};
