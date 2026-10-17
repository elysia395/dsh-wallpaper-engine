/**
 * effects.js — 把设置**应用到 DOM**（CSS 变量、内联样式、光标、scrim）。
 *
 * 为什么单独一个文件：这是"设置 → 界面"的落地层，同一层里同时有 scrim 即时性优化、
 * 玻璃/雾化合成、光标注入、壁纸淡出底色选择四件事（**字体自定义不在这里**，见
 * src/font/apply.js）；抽成单元就不必在 client.js 那一大片正文里定位。
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
// when the scrim value ACTUALLY changed. Running it unconditionally on every
// emit — twice per slider tick (handler + subscribed applyEffects) and on every
// 500ms transcode poll — would be a forced synchronous layout storm.
let lastScrimCss = "";
// 壁纸淡出底色的**缓存**（拖动期用；见 applyEffects 的 live 说明）。空串 = 还没算过 /
// 已失效（壁纸透明度归零时清掉）。
let lastFadeBg = "";
// #159①：让上面那份缓存在宿主切深浅主题时失效的观察者（见 armFadeBgThemeWatch）。
let fadeBgThemeWatch = null;

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

// 把一个**新解析出来的**淡出底色写回 body（唯一的写点，observer 与 applyEffects 共用；
// 拖动期由调用方自己拿缓存，见 applyEffects 的 live 分支）。
// 只在「壁纸透明度 > 0」时真的有值 —— 关着时这个变量整份撤掉（identity opacity）。
// 返回值 = 本次写下的值（'' = 没在用这条通道，调用方不必再看）。
function writeWallpaperFadeBg() {
  const using = Number(selection.wallpaperOpacity) > 0;
  lastFadeBg = using ? resolveWallpaperFadeBg() : "";
  if (using) document.body.style.setProperty("--we-wallpaper-fade-bg", lastFadeBg);
  return lastFadeBg;
}

// ── #159① + #194②：宿主切深浅主题 ⇒ 失效缓存**并当场重算** ─────────────────────
// 事故（#159①）：`lastFadeBg` 只在 applyEffects 里重算，而宿主切主题（翻转 body 的
// `data-ds-dark-theme`）**不会**调用我们；本仓唯一的主题订阅在 src/theme-follow.js，
// 由 `themeFollow` 开关门控、默认关 ⇒ 缓存会一直停在旧主题的底色上。它的消费者是
// `.we-layer` 那块 z-index −2 的衬底（给 backdrop-filter 提供底色）⇒ 过期值会给
// **每一面玻璃**上色（浅色主题配深色衬底 = 整页发灰）。
// ⚠️ **#194② 起这里改成"失效 + 当场重算"**。只失效是 #159① 当时的取舍（"把重算留给
//    下一次 applyEffects"），而用户实测的口径正是它的症状：切深浅色后**只有插件自己的
//    浮层**（我们的 React 面板 / 设置窗口，取色全走 CSS 的深浅孪生 ⇒ 随class翻转即时生效）
//    跟上，**主页面不动** —— 因为主页面那层玻璃等的是 `.we-layer` 的底色，而它要等到
//    用户"点进设置随便切一个项目"（⇒ 一次 applyEffects）才重算。
//    根因是**职责错位**而不是性能：这条通道的值是本插件里**唯一**由 JS 写出、且随主题变的
//    标量（其余随主题变的东西在 styles.js 里都有 `body[data-ds-dark-theme]` 孪生，浏览器
//    自己换），所以"等下一次 applyEffects"在语义上就是"等用户想起来动一下设置"。
// 与 theme-follow 的分工不变（沿用 #159① 的边界）：theme-follow 决定**用哪一套主题**
//   （写 theme 服务），这里只负责**主题已经变了之后跟上**，不回写主题、也不审批主题。
//   ⇒ 不调用整个 applyEffects：它含与主题无关的重活（字体样式表 / 场景音频 / 强制样式
//   计算），而本通道只需要那一个变量。
// 幂等：observer 只挂一次；环境里没有 MutationObserver（Node 沙箱 / 极老宿主）时
// 静默退化成"没有这条跟随通道"，不抛错、不改变既有行为。
function armFadeBgThemeWatch() {
  if (fadeBgThemeWatch || typeof MutationObserver !== "function") return;
  try {
    fadeBgThemeWatch = new MutationObserver(() => {
      lastFadeBg = "";   // ① 失效（#159①：防止拖动档继续拿旧值）
      // ② 当场重算并写回（#194②）。观察者回调里抛错会冒到宿主 ⇒ 自己收干净；
      //    重算失败也只是"这一次没跟上"，绝不动已经写在 body 上的值。
      try {
        if (writeWallpaperFadeBg() && document.body) {
          // 写值本身不保证合成器立刻重画 .we-layer 那块 z-index −2 的衬底（它正是
          // **主页面**那层玻璃的取样背景；插件自己的浮层另成一叠、自己就重画了 —— 这就是
          // "浮层先变、主页面不动"里主页面那一半）。与 scrim 那条"写完强制回流"同一个
          // 已知病灶与同一味药：读一次 offsetHeight，逼出同步样式/布局 ⇒ 重绘。
          void document.body.offsetHeight;
        }
      } catch { /* 跟随是增强：失败保持既有值 */ }
    });
    fadeBgThemeWatch.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });
  } catch {
    // 观察者建不起来（假 DOM 没有 observe / body 不在）⇒ 不留半个句柄。
    try { if (fadeBgThemeWatch) fadeBgThemeWatch.disconnect(); } catch { /* ignore */ }
    fadeBgThemeWatch = null;
  }
}
// 与 arm 成对（clearEffects / 壁纸透明度归零时调用）：断开并丢句柄。
function disarmFadeBgThemeWatch() {
  if (!fadeBgThemeWatch) return;
  try { fadeBgThemeWatch.disconnect(); } catch { /* ignore */ }
  fadeBgThemeWatch = null;
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

// ── #164：选中行的墨（accent 填充 × 与填充成对比的墨）────────────────────────
// 选中行不能吃 --we-popup-row-* 那一对（那对是"行底 vs 正文墨"，语义不同），也**不能
// 直接吃 --we-accent-ink**：后者的 0.45 阈值是宿主按钮沿用下来的口径，在**中亮度**
// accent 上会选到白字 —— 相对亮度 0.1783–0.45 区间白字只有 2.1–4.58:1，而同区间黑字
// **恒优于**白字（两臂对比度的等点就是 L≈0.1791）。
// 两支候选取**纯白 / 纯黑**并按**实算对比度取大**：两支的等点即 0.1791，也就是"更可读
// 那支"在全体 accent 上的**最差点**（两支在该点各 4.58:1）⇒ 这条选择本身就带一个
// ≥4.58:1 的全局下界，不需要再靠采样面兜。**深墨候选不再沿用 #0f1115**：它在同一个
// 等点上只有 ≈4.35:1（`#de3c42` 实测 4.347:1、灰阶 `#797979` 4.353:1），旧版"白 vs
// #0f1115 取大"因此过不了 4.5 红线 —— 视觉语言换来的是判据缺口，故改成纯黑。
// 纯函数、无 DOM：verify-readability 从产物里抽出来复算连续网格（F10）。
function weCheckedRowInk(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || ""));
  if (!m) return null;
  const s2l = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * s2l(c[0]) + 0.7152 * s2l(c[1]) + 0.0722 * s2l(c[2]);
  const contrast = (a, b) => (a > b ? (a + 0.05) / (b + 0.05) : (b + 0.05) / (a + 0.05));
  const accLum = lum([0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)));
  return contrast(1, accLum) >= contrast(0, accLum) ? "#ffffff" : "#000000";
}

// ── #164：原生 <select> 弹层的行配对（不透明底 × 与底成对比的墨）───────────────
// Chromium 的原生下拉弹层是**独立文档**：画布只在 select 自身背景不透明时才取它的
// 底色，否则落回默认浅色画布；而选项文字**继承** select 的 color。本插件把宿主底色
// 改成玻璃、又允许用户把 `--dsw-alias-label-primary`（"正文"角色）改成任意色 ⇒
// 弹层会落成「浅字浅底」（深色主题默认浅字）或「白字白底」（浅色主题 + 用户设浅墨）。
// 弹层里画不出玻璃（独立文档、无壁纸透出），所以只能让每行 option **自带**一对
// 不透明底 + 对比墨。这对值必须**按有效墨色派生**：只随主题翻转救不了自定义浅墨那一档
// —— 浅色主题下主题默认的浅底正好就是白字白底。
//
// 口径：行底从该墨色的**自然侧**起步 —— 墨偏暗 ⇒ 浅行底、墨偏亮 ⇒ 深行底 —— 再向
// 纯黑 / 纯白二分钳制到与墨色 ≥4.6:1（0.1 与 weClampSurfaceColor 同源的舍入余量，
// 因为结果要四舍五入回 hex）。起点就是主题默认面板色（浅 #ffffff / 深 #1e1f26，
// **与 styles.js 的 --we-panel-color 两处数字必须同步改**）⇒ 用户没自定义墨色时
// 逐位还原现状（浅主题 #ffffff 配宿主深墨、深主题 #1e1f26 配宿主浅墨，两者本就在
// 13:1 以上，钳制步长为 0）。
//
// 分界取 0.1791：白 / 黑两臂的对比度在相对亮度 0.1791 处相等（各 4.58:1），所以
// "墨亮于它走深底、暗于它走浅底"这个选择**保证至少一臂可达**。两臂都不足 4.6 的
// 墨色存在（相对亮度落在 0.1783–0.1800 的窄带里，两臂上限都只有 4.58），此时退回
// **对比度更高的那一臂的纯黑 / 纯白**：达不到红线但仍然是最优解，且不会因为"钳制
// 无解"而把行底留成与墨同色。纯函数、无 DOM：verify-readability 从产物里抽出来复算网格。
function wePopupRowPair(inkHex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(inkHex || ""));
  if (!m) return null;
  const s2l = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * s2l(c[0]) + 0.7152 * s2l(c[1]) + 0.0722 * s2l(c[2]);
  const contrast = (a, b) => (a > b ? (a + 0.05) / (b + 0.05) : (b + 0.05) / (a + 0.05));
  const toHex = (c) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  const ink = "#" + m[1].toLowerCase();
  const inkLum = lum([0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)));
  const PIVOT = 0.1791;
  const arms = inkLum > PIVOT
    ? [[[0x1e, 0x1f, 0x26], [0, 0, 0]], [[0xff, 0xff, 0xff], [0xff, 0xff, 0xff]]]
    : [[[0xff, 0xff, 0xff], [0xff, 0xff, 0xff]], [[0x1e, 0x1f, 0x26], [0, 0, 0]]];
  let best = null;
  for (const [base, extreme] of arms) {
    const baseLum = lum(base);
    if (contrast(baseLum, inkLum) >= 4.6) return { bg: toHex(base), ink };
    if (contrast(lum(extreme), inkLum) < 4.6) {
      if (!best || contrast(lum(extreme), inkLum) > best.c) {
        best = { c: contrast(lum(extreme), inkLum), bg: toHex(extreme) };
      }
      continue;
    }
    let lo = 0;  // 不合格端
    let hi = 1;  // 合格端
    for (let i = 0; i < 12; i++) {
      const t = (lo + hi) / 2;
      const c = base.map((v, j) => v * (1 - t) + extreme[j] * t);
      if (contrast(lum(c), inkLum) >= 4.6) hi = t; else lo = t;
    }
    return { bg: toHex(base.map((v, j) => v * (1 - hi) + extreme[j] * hi)), ink };
  }
  return { bg: best.bg, ink };
}

// ── 染色地板：可读性底色 = 玻璃色经亮度钳制（色相跟随用户） ──────────────────
// 地板色是**玻璃色经亮度钳制后的版本** —— 深色主题过亮就压暗、浅色主题过暗就提亮，
// 色相交给用户；对比度判据与 #82 同一条网格（正文 vs 表面合成到最坏背衬 ≥4.5:1）。
// 主题白/黑（浅 #ffffff / 深 #0d1524）只在**用户没给玻璃色**时当地板缺省值用。
// 钳制口径与 verify-readability 同款、**不含层权重**：
//   深色最坏 = color·(F + 0.10·0.4·(1−F)) + 白·(1 − (F + 0.10·0.4·(1−F)))  （白背衬、最透档，
//   0.4 = 深色主题的 frost 层因子 —— 与浅色不同，深色的玻璃色份额要先乘 0.4）
//   浅色最坏 = color·(F + 0.10·(1−F))                               （黑背衬、同 alpha）
// 其中 0.10 = 玻璃透明度滑杆**拉到 100**（满档）后的 --we-glass-alpha（见 applyEffects 的曲线），
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
  // 最坏 alpha：最透档（滑杆 100 → --we-glass-alpha 0.10）× 深色主题的 0.4 层因子
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

/**
 * 按主题取「玻璃颜色」（#159② 分主题玻璃色）。
 *
 * 存储形态永远是一对 `{light, dark}`（见 lib/settings-schema.js 的 readGlassColors），但开关
 * 「深色单独设置」关着时两侧同值（面板就是那么写的）⇒ 取色只要按主题挑一侧。这里**刻意再兜一层**：
 * 走到这儿的值不保证来自 schema —— 老预设定档直传、`test/verify-client.mjs` 的台架 selection
 * 就是标量 `'#ffffff'`。返回空串 = "没有可用的颜色"，让 weClampSurfaceColor 落到它**按主题**的
 * 兜底常量（深色 #0d1524 / 浅色 #ffffff）上 —— 比在这里再抄一份主题常量更稳，也就不会与钳制函数漂。
 *
 * ⚠️ 不许在这里引用 lib/settings-schema.js 的任何常量：`test/verify-client.mjs` 用
 * `with(__scope)` + Proxy 跑本文件，未知名只会拿到记录替身 ⇒ 拿不到真值。
 */
function glassColorOf(selection, theme) {
  const raw = selection && selection.glassColor;
  if (typeof raw === "string") return raw;
  if (!raw || typeof raw !== "object") return "";
  const own = theme === "dark" ? raw.dark : raw.light;
  if (typeof own === "string") return own;
  // 缺这一侧就借另一侧 —— 宁可用错一半的色相，也不要整个染色消失。
  const other = theme === "dark" ? raw.light : raw.dark;
  return typeof other === "string" ? other : "";
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
  // drives ONE thing (frost depth, --we-blur). Rationale: --we-saturate amplifies
  // whatever chroma the backdrop still carries, and blur is what smears the
  // residual wallpaper text into that chroma; the coupled ramp therefore
  // magnified exactly the signal the owner reads as 荧光/彩色鬼影, worst at the
  // top of the slider where the amplification met the most smearing. A flat value
  // kills the runaway at high radii while keeping the "wet glass" chroma lift at
  // every radius. GLASS_SATURATE is deliberately BELOW the stylesheet's own 1.8
  // fallback (what applies before this variable is first written), so the
  // steady-state glass is milder than the pre-write default rather than stronger.
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
  // ── ⚠️ 这三个变量**不许写**：`--we-wallpaper-blur` / `--we-wallpaper-scale` /
  //   `--we-wallpaper-flip` 整份样式表**没有任何 var() 消费者**（模糊真的落在下面的
  //   `--we-media-filter` 上，scale+flip 真的落在 `--we-wallpaper-transform` 上）。
  //   守卫第 ⑭ 组："经 setProperty 写出的变量必须有人读"。
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
  // kiosk window to glitch on.
  s.setProperty("--we-wallpaper-transform",
    (selection.wallpaperBlur > 0 || selection.flip)
      ? ("scale(" + scale + ") scaleX(" + (selection.flip ? "-1" : "1") + ")")
      : "none");
  // Fit mode for the current wallpaper (consumed by .we-media--fit).
  s.setProperty("--we-object-fit", selection.objectFit);
  // 壁纸层取景（位置 / 缩放，对应 WE 的 水平 / 垂直 / 缩放）：0..100 映射到层自身
  // 尺寸的 -25%..+25%（50 = 居中），缩放 100 = 100%。
  // ⚠️ 等于默认值时**不写变量**：`translate: 0px 0px` / `scale: 1` 同样是一条真实声明，
  // 会把整屏壁纸 <video> 逼上一个常驻合成层（与 --we-wallpaper-transform 回落 "none" 同因）。
  {
    const lpx = Number(selection.layerPositionX);
    const lpy = Number(selection.layerPositionY);
    const lsc = Number(selection.layerScale);
    const offX = Number.isFinite(lpx) && lpx !== 50;
    const offY = Number.isFinite(lpy) && lpy !== 50;
    const zoomed = Number.isFinite(lsc) && lsc !== 100;
    if (offX) s.setProperty("--we-layer-x", ((lpx - 50) / 2).toFixed(4) + "%");
    else s.removeProperty("--we-layer-x");
    if (offY) s.setProperty("--we-layer-y", ((lpy - 50) / 2).toFixed(4) + "%");
    else s.removeProperty("--we-layer-y");
    if (zoomed) s.setProperty("--we-layer-scale", String(lsc / 100));
    else s.removeProperty("--we-layer-scale");
  }
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
    // 缓存会在宿主切深浅主题时由 armFadeBgThemeWatch 的观察者**当场刷新**（#159① +
    // #194②）；观察者只挂一次，挂在"这个变量真的在用"的分支里。
    armFadeBgThemeWatch();
    if (live && lastFadeBg) s.setProperty("--we-wallpaper-fade-bg", lastFadeBg);
    else writeWallpaperFadeBg();
  } else {
    s.removeProperty("--we-wallpaper-opacity");
    s.removeProperty("--we-wallpaper-fade-bg");
    disarmFadeBgThemeWatch();
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
  // ── 全局 UI 配色（用户口径）：把宿主界面里那几处「蓝色元素」接进调色板 ──
  // 空串 = 跟随「全局配色」（accent）⇒ 打开「UI 配色自定义」那一刻观感零变化，随后逐项微调。
  // ⚠️ 这五个变量**恒定义**（不随总开关消失）：关着自定义时这几处照样跟 accent —— 用户口径
  //    是「全局配色用于直接调整全部」。总开关只决定**面板显示哪几行**与「全局配色」可否点击。
  // 令牌 → 宿主消费者的实证（DSH 产物 CSS，不是推断）见 lib/settings-schema.js 的 DEFAULTS
  // 注释与 src/styles.js 的「全局 UI 配色」段。
  const uiColor = (key) => selection[key] || selection.accent;
  s.setProperty("--we-ui-send", uiColor("uiColorSend"));
  s.setProperty("--we-ui-link", uiColor("uiColorLink"));
  s.setProperty("--we-ui-file-icon", uiColor("uiColorFileIcon"));
  s.setProperty("--we-ui-tab", uiColor("uiColorTab"));
  s.setProperty("--we-ui-deep-diving", uiColor("uiColorDeepDiving"));
  // - --we-glass-alpha: white-overlay alpha of the glass surfaces. The 玻璃透明
  //   度 slider semantics: higher = MORE transparent (clearer wallpaper shows
  //   through), lower = closer to solid. 0% → ~0.25 (frosted, solid-ish),
  //   60% → ~0.10 (轻霜 —— 染色地板下限不再让颜色在拉满端消失，旧值 0.03 会让
  //   玻璃色份额塌到 ~1%、只剩主题底色 = 用户报的"拉满变黑/变白")。
  const glassAlpha = Math.max(0.10, 0.25 - (selection.glassAlpha / 100) * 0.15);
  s.setProperty("--we-glass-alpha", String(glassAlpha));
  // ── ⚠️ 这个变量**不许删**：它没有 CSS 消费者（配方早改读下面钳制出来的
  // `--we-surface-tint-light/dark`），但 `test/compat-harness-pages.mjs` 把它当**页面观察量**
  // 断言（`getComputedStyle(body)` 读它、要求非空 + DSH 的设置窗口 token 与之同源）。那个
  // harness 不在任何 npm 脚本里（要浏览器页面）⇒ 无法在此验证改动它的结局 —— 先删写入 = 静默
  // 破坏一个未经验证的观察者。正确顺序：先把 harness 的观察点改成 `--we-surface-tint-light`，
  // 再删这里的写入；在那之前它由守卫第 ⑭ 组的 `OBSERVED_ONLY` 登记表**显式豁免**。
  //   那行注释说明了它为何暂时不能删。这里写**浅色那一侧**：它是这个色板的"基准色"，
  //   而观察者只要求非空。（改分主题取色后它仍是标量 —— 观察量的形状没变。）
  s.setProperty("--we-glass-color", glassColorOf(selection, "light"));
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
  //   #159②：两侧各取自己那一半（glassColorOf），于是「深色单独设置」一开，
  //   同一份 settings 在浅/深两套配色下给出两个不同的釉色 —— 这正是本项的交付。
  const glassTintLight = glassColorOf(selection, "light");
  const glassTintDark = glassColorOf(selection, "dark");
  s.setProperty("--we-surface-tint-light", weClampSurfaceColor(glassTintLight, "light", glassFidelity));
  s.setProperty("--we-surface-tint-dark", weClampSurfaceColor(glassTintDark, "dark", glassFidelity));
  // - #164：原生 <select> 弹层的行配对。**只在用户自定义了「正文」墨色时写**：
  //   没自定义时样式表的缺省就是主题默认配对（逐位还原现状），不写比写更不容易漂。
  //   两档同时写、由样式表按主题挑 —— 与上面的 --we-surface-tint-* 同法，省掉一个
  //   主题观察者（宿主翻 data-ds-dark-theme 不会调我们，见 armFadeBgThemeWatch 的注释）。
  //   两边都不成立时**摘掉**而不是写空串：var(--x, fallback) 要能落回缺省。
  //   门控跟 theme layer 同一把开关（fontCustom）—— 关掉时颜色层不接管，墨色仍是
  //   宿主原生值，此时派生反而是多余的一层。
  const popupInk = (selection.fontCustom && selection.themeColors && selection.themeColors.primary)
    ? selection.themeColors.primary : null;
  for (const theme of ["light", "dark"]) {
    const suffix = theme === "dark" ? "-dark" : "-light";
    const pair = wePopupRowPair(popupInk ? popupInk[theme] : "");
    if (pair) {
      s.setProperty("--we-popup-row-bg" + suffix, pair.bg);
      s.setProperty("--we-popup-row-ink" + suffix, pair.ink);
    } else {
      s.removeProperty("--we-popup-row-bg" + suffix);
      s.removeProperty("--we-popup-row-ink" + suffix);
    }
  }
  // - #164：选中行的墨（单档，accent 不随主题分叉）。**刻意不进门控**：它修的是
  //   "accent 填充上的字能不能读"，与用户有没有自定义正文墨色无关；而且 issue 的复现
  //   入口（设置 → 模型 → 提供商）恰在**设置窗**内 —— 那个作用域块末尾把 --we-accent
  //   主动掐成 initial，块内既有消费一律改读 --we-accent-src（见 styles.js 设置窗块
  //   的注释）。所以填充侧读 runtime 写的 --we-accent-src，墨侧由这里按对比度取大下发。
  //   不成立时摘掉，让样式表缺省落回来（缺省即默认 accent 上更可读的那一边）。
  const checkedInk = weCheckedRowInk(selection.accent);
  if (checkedInk) s.setProperty("--we-popup-row-checked-ink", checkedInk);
  else s.removeProperty("--we-popup-row-checked-ink");
  // RGB 三元组形式：给 rgba() 槽位用（消息气泡 / 输入框的白釉染色）。
  s.setProperty("--we-surface-tint-rgb-light", toRgbTriple(weClampSurfaceColor(glassTintLight, "light", glassFidelity)));
  s.setProperty("--we-surface-tint-rgb-dark", toRgbTriple(weClampSurfaceColor(glassTintDark, "dark", glassFidelity)));

  // ── 玻璃管线在 src/glass.js：取值解析 / 各面釉层变量 / 门控属性；这里只留
  //    **一行调用**。本文件继续负责全局玻璃量（--we-glass-* / --we-surface-tint-*）与其余
  //    非玻璃效果（accent / 可读性 / 光标 / 壁纸 / 字体）。
  applyGlass(selection, s);
  // 额外补雾化的选择器（上游 #200）：玻璃面算完之后同步这条**运行期**样式通道。
  // 静态样式表是构建期常量（styles.js），而这份规则由设置拼出来 ⇒ 单独一个 <style>
  // 标签（见 src/glass-extra.js；空清单时它一条规则都不生成、标签也撤掉）。
  syncExtraGlassCss(selection);
  // 思考块液态玻璃：默认关，保持宿主黑底方便阅读。打开后 CSS 清掉思考条
  // 与推理面的实心底，切到会话同一套雾化。本门控仍在 applyEffects 就地写 ——
  // 它不是玻璃量，不进 applyGlass 的取值管线。
  // 让路态（皮肤中心互操作，见 src/client.js）：玻璃整族退场 —— 这里与下面 sidebar-follow
  // 是 applyGlass 之外仅剩的两处玻璃门控点，一并摘。
  const skinYield = typeof skinYieldActive === "function" && skinYieldActive();
  // 三挡的第二半：正文原生挡（thinkingNative）。它**赢过**玻璃挡 —— 开着时不挂
  // data-we-thinking-glass（互斥在门控层保证，UI 的三挡分段只是维持两键一致）。
  // 原生挡的 CSS 语义见 styles.js「正文原生挡」块：正文子树（气泡 / markdown 家族）
  // 令牌退回宿主原生值，画布与输入框不碰。
  if (selection.thinkingNative && !skinYield) document.body.setAttribute("data-we-thinking-native", "on");
  else document.body.removeAttribute("data-we-thinking-native");
  if (selection.thinkingGlass && !selection.thinkingNative && !skinYield) document.body.setAttribute("data-we-thinking-glass", "on");
  else document.body.removeAttribute("data-we-thinking-glass");
  // 文字胶囊一族的雾化（行内代码 / 新会话 / 「加载更早历史」「回到底部」）：
  // #134 落地时是写死的 8px CSS 兜底（--we-inline-code-blur 无生产者 ⇒ 用户实测"调不了"），
  // 现在接成旋钮（capsuleBlur，默认 8 = 原观感）。与上面的门控属性同处声明 ——
  // 这族变量只被 data-we-thinking-glass 门下的规则消费（styles.js ⑥ 条）。
  const capBlurNum = Number(selection.capsuleBlur);
  s.setProperty("--we-inline-code-blur", String(Number.isFinite(capBlurNum) ? capBlurNum : 8) + "px");
  // 胶囊釉色：三元组形式给 rgba() 槽位（fill 令牌 + 滚动条拇指）。刻意不过
  // weClampSurfaceColor —— 10% 雾底不是正文面，不进可读性下限（理由见 schema）。
  s.setProperty("--we-capsule-tint-rgb", toRgbTriple(
    /^#[0-9a-f]{6}$/i.test(String(selection.capsuleColor)) ? selection.capsuleColor : "#ffffff"));

  // dsh-better-sidebar 液态玻璃：一套独立于会话玻璃的细粒度控制（侧栏模糊 /
  // 侧栏透明度 / 侧栏玻璃颜色 + 总开关）。变量只作用于 [data-dsh-better-sidebar]
  // 子树（CSS 见下），关闭总开关时侧栏恢复原生外观。
  // 跟随全局（sidebarFollowGlobal，默认开）：把侧栏那一套变量**指向**全局玻璃三件套。
  // var() 是惰性替换 ⇒ 这里写进去的是引用而不是拷贝：改「玻璃 / 玻璃透明度」两侧栏一起变。
  // 色相那一份走样式表里的 --we-follow-tint（按主题取钳制后的玻璃色）—— 不能在这里写死，
  // 内联值会盖掉"按主题"这件事。
  // ⚠️ 合并 #132 口径：跟随关着时**不覆盖** —— 按面值由 applyGlass 的 glassValue 单一
  //    取值路径供给（inherit→全局键 / custom→「独立配置」自己的键）；/200 刻度这类旧曲线
  //    早已随规范刻度退役，不许再回来。UI 上跟随开着时「独立配置」收起，
  //    两套机制不会同时生效。
  if (selection.sidebarFollowGlobal) {
    s.setProperty("--we-sidebar-blur", "var(--we-blur)");
    s.setProperty("--we-sidebar-saturate", "var(--we-saturate)");
    s.setProperty("--we-sidebar-tint", "calc(var(--we-glass-alpha) * 100%)");
    s.setProperty("--we-sidebar-color", "var(--we-follow-tint)");
    s.setProperty("--we-sidebar-sheen", "1");
  }
  // 跟随态另挂一个属性：样式表用它决定"侧栏的釉"取共享那一份还是侧栏专用那一份。
  if (selection.sidebarGlass && selection.sidebarFollowGlobal && !skinYield) document.body.setAttribute("data-we-sidebar-follow", "on");
  else document.body.removeAttribute("data-we-sidebar-follow");

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
  // #159①：主题观察者与缓存同生共死（与下面的内联属性成对清理）。
  disarmFadeBgThemeWatch();
  lastFadeBg = "";
  s.removeProperty("--we-scrim-color");
  s.removeProperty("--we-border-alpha");
  s.removeProperty("--we-blur");
  s.removeProperty("--we-saturate");
  s.removeProperty("--we-glass-brightness");
  s.removeProperty("--we-media-filter");
  s.removeProperty("--we-object-fit");
  // 壁纸层取景（与上面那组写入成对）：卸载 / 禁用后 DOM 上不留变量。
  s.removeProperty("--we-layer-x");
  s.removeProperty("--we-layer-y");
  s.removeProperty("--we-layer-scale");
  s.removeProperty("--we-wallpaper-opacity");
  s.removeProperty("--we-wallpaper-fade-bg");
  s.removeProperty("--we-accent");
  s.removeProperty("--we-accent-src");
  s.removeProperty("--we-accent-ink");
  s.removeProperty("--we-popup-row-checked-ink");
  // 全局 UI 配色（与上面那组写入成对）：卸载 / 禁用后 DOM 上不留变量。
  s.removeProperty("--we-ui-send");
  s.removeProperty("--we-ui-link");
  s.removeProperty("--we-ui-file-icon");
  s.removeProperty("--we-ui-tab");
  s.removeProperty("--we-ui-deep-diving");
  s.removeProperty("--we-glass-alpha");
  s.removeProperty("--we-glass-color");
  s.removeProperty("--we-surface-tint-light");
  s.removeProperty("--we-surface-tint-dark");
  s.removeProperty("--we-surface-tint-rgb-light");
  s.removeProperty("--we-surface-tint-rgb-dark");
  document.body.removeAttribute("data-we-glass-window");
  // 页面玻璃总锚点（src/glass.js 恒挂）：漏撤 ⇒ 插件禁用 / HMR 卸载后整页的玻璃
  // 令牌映射与对话栏那一族规则照旧生效（"插件已卸载，玻璃还在"）。与下面三个同批。
  document.body.removeAttribute("data-we-glass-page");
  document.body.removeAttribute("data-we-left-sidebar");
  // 侧边栏四角圆角 / 直角（src/glass.js 的 applyGlass 写出）：同批清理 —— 漏撤 ⇒ 插件
  // 卸载 / 禁用后宿主侧栏仍停在上次的圆角上（"插件没了，侧栏还是圆的"）。
  document.body.removeAttribute("data-we-left-sidebar-radius");
  document.body.removeAttribute("data-we-right-sidebar-radius");
  document.body.removeAttribute("data-we-left-sidebar-square");
  document.body.removeAttribute("data-we-right-sidebar-square");
  s.removeProperty("--we-left-sidebar-radius");
  s.removeProperty("--we-right-sidebar-radius");
  // 标题栏液态玻璃门（与上面那个同批）：漏撤 ⇒ 插件卸载 / 禁用后，顶栏仍挂着玻璃底与
  // 雾化层，而壳层自己的不透明底色被压住 —— 表现为"插件没了，标题栏还是玻璃的"。
  document.body.removeAttribute("data-we-titlebar-glass");
  // 思考块液态玻璃门（PR #130 引入）：同批的卸载残留口径 —— 漏撤 ⇒ 插件卸载后
  // 宿主思考条的规则组照旧生效。合并 #132 时补上（第 ⑨ 组清理对称判据的要求）。
  // 三挡的另一半（对话区原生挡）同批：漏撤 ⇒ 卸载后对话区令牌仍被钉回原生值。
  document.body.removeAttribute("data-we-thinking-glass");
  document.body.removeAttribute("data-we-thinking-native");
  // ⚠️ W5 新增的三个门控属性**也必须在这里撤掉**（与上面两个同批）：
  //    漏掉它们 ⇒ 插件被禁用 / HMR 卸载后，宿主 DOM 上仍留着 `data-we-glass-chat` /
  //    `data-we-glass-floaters`，而挂在这些属性上的规则组**照旧生效** ——
  //    表现为"插件已卸载，但玻璃还在"。这类残留只有卸载路径才暴露，日常切换看不出来。
  document.body.removeAttribute("data-we-glass-chat");
  document.body.removeAttribute("data-we-glass-floaters");
  document.body.removeAttribute("data-we-sidebar-follow");
  s.removeProperty("--we-sidebar-blur");
  s.removeProperty("--we-sidebar-saturate");
  s.removeProperty("--we-sidebar-sheen");
  s.removeProperty("--we-sidebar-color");
  s.removeProperty("--we-sidebar-tint");
  document.body.removeAttribute("data-we-sidebar-glass");
  document.body.removeAttribute("data-we-sidebar-fullclear");
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
    "--we-titlebar-blur", "--we-titlebar-alpha",
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
  // 额外补雾化通道（#200）：这一份是**运行期生成的** <style>，不在静态样式表里 ⇒
  // 必须显式撤标签（与上面那批 body 属性 / 变量成对，理由同"清理对称性"）。
  disposeExtraGlassCss();
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
};
