/**
 * glass.js — **玻璃后端的唯一落点**：取值解析 + 各面釉层变量 + 门控属性。
 *
 * 为什么单开一个文件：它的**输入输出是封闭的** —— 只需要 `selection` 与
 * `document.body.style`，外加两个纯函数（`weClampSurfaceColor` 顶层共享、`toRgbTriple` 本文件）。
 * 于是 ⑪/⑫/⑬ 三组守卫读的"写了什么"有了**单一归属**。
 *
 * 契约（三条，都是实测换来的，推导过程属历史，见 CHANGELOG 与 git 历史）：
 *   ① **每档都算出值并写出**（`applyGlass` 里没有任何 `removeProperty`）——"不写"永远不等于
 *      "撤销"：CSS 的 `var(--x, 兜底)` 只在 `--x` **未定义**时取兜底，而写到 body 上的变量
 *      一直是"已定义"的。
 *   ② **门控属性恒挂**（`data-we-glass-page` / `-chat` / `-window` / `-floaters` **不可关**；`data-we-left-sidebar`、
 *      `data-we-titlebar-glass`、`data-we-sidebar-glass`），与"用谁的值"**正交**：关掉只是让那组规则整组不匹配。
 *   ③ **读谁只在这里决定**：`glassValue(面, 参数, 自己的键, 全局的键)`；UI 只翻开关，不动接线。
 *
 * ⚠️ 本文件**不读** `selection` 以外的状态。`norm` / `denorm` / `toRgbTriple` 是本文件内的
 *    工具；`weClampSurfaceColor` 由 `src/effects.js` 顶层提供（构建期内联进**同一个工厂作用域**，
 *    所以这里直接调用即可，不需要 import 语法）。
 */

// RGB 三元组：给 rgba() 槽位用（消息气泡 / 输入框的白釉染色）。
// ⚠️ 下标 [0,2,4] —— 6 位 hex 不带 '#'，[1,3,5] 是带 '#' 时代的错位写法。
// （本函数同时服务 `effects.js` 的全局 `--we-surface-tint-rgb-*`，所以放在顶层而不是 applyGlass 里。）
const toRgbTriple = (hex) => {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || ""));
  return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).join(", ") : "255, 255, 255";
};

/** 每次 applyEffects 调用一次：把每个玻璃面的值算出来并写出，再挂/摘门控属性。 */
function applyGlass(selection, s) {
  // ── 「皮肤在台上」的让路态：整族门控摘掉、本函数一概不挂（互操作块见 src/client.js）──
  // 这里是唯一会整族摘门控的路径。
  if (typeof skinYieldActive === "function" && skinYieldActive()) {
    for (const attr of ["data-we-glass-page", "data-we-glass-chat", "data-we-glass-window",
      "data-we-left-sidebar", "data-we-titlebar-glass", "data-we-sidebar-glass", "data-we-sidebar-fullclear", "data-we-glass-floaters"]) {
      document.body.removeAttribute(attr);
    }
    return;
  }
  // ── 页面玻璃总锚点：**恒挂**（插件在跑 = 玻璃在算值 ⇒ 配方该生效）───────────────
  // styles.js 里全部"整页接管"的玻璃规则（表面令牌映射 / 对话栏 / 轨迹 / 左栏 /
  // 右栏面板 / 两档回退）都挂在这个属性下 —— 它与 `data-we-wallpaper`（壁纸层在场、
  // 页面让开）**正交**：壁纸只是玻璃的背景来源之一，不是玻璃的前提 —— 否则不设壁纸时
  // 玻璃参数全是死旋钮（用户报障：「页面玻璃效果只有设置壁纸后才生效」）。卸载路径在
  // effects.js 的 clearEffects 成对撤除（与 -chat / -window / -floaters 同批）。
  document.body.setAttribute("data-we-glass-page", "on");
  // ── 玻璃面 × 参数的取值解析（**两态**，由 `glassMode` 说读谁）────────────────────
  //
  // 模型：每个玻璃面的每个参数只有**一个**取值来源 ——
  //   · 该面处于 `'custom'` ⇒ 读它**自己**的键
  //   · 否则（`'inherit'`，**默认**）⇒ 读**全局**键
  // 所以"继承"与"独立"不是两条并行的接线，而是同一条线上的两个来源。
  //
  // ⚠️ **必须定义在第一个使用点之前**（本函数内 `const` 有 TDZ）：否则会直接抛
  //   `Cannot access 'glassValue' before initialization`。
  //
  // ⚠️ 解析发生在**此处（JS）**、不是靠 CSS 变量缺省值：侧栏那条 CSS 用
  //   color-mix(var(--we-sidebar-color) … var(--we-sidebar-tint) …)，变量一旦缺失整条
  //   声明会被丢弃（侧栏变全透明），所以回退路径必须是"写另一个值"，不是"不写"。
  //
  // ⚠️ **只有这里**决定"读全局还是读自己"；UI 开关只需翻 `glassMode`，不需要再动接线。
  //
  // ⚠️ `param` 仍然要传：它是**声明**而非运行期分支 —— 守卫第 ④ 组拿这些调用点与注册表的
  //   `params` 逐参数对账（"注册表声明了却没接线"= 死旋钮）。能力由这条对账 + 第 ⑬ 组
  //   "写了必须被 CSS 读到"共同保证，不靠手抄的能力表。
  const glassModeOn = (surface) => {
    const rec = selection.glassMode;
    return !!(rec && typeof rec === 'object' && rec[surface] === 'custom');
  };
  /** 面 × 参数 → 取值：**模式是 custom** 读 profile，否则读全局。 */
  const glassValue = (surface, param, profileValue, globalValue) =>
    (glassModeOn(surface) ? profileValue : globalValue);

  // ── 设置窗口这个玻璃面的**按面**釉层变量 ────────────────────────────────────────
  // 该面的 CSS 现在读 `var(--we-settings-window-<x>, <原全局表达式>)`（见 styles.js 的
  // 「设置窗口」4 条规则）⇒ 这一组变量就是它的来源，"读全局还是读自己"由 `glassValue` 决定。
  //
  // ⚠️ **两项能做到，两项做不到**（取证结论）：
  //   ✅ 模糊 / 透明度 —— 判据对它们要么无锚定，要么是**子串判定**
  //      （G5 的 `readsBoth` 只要求 `var(--we-blur` 出现，内层兜底保留了它）。
  //   ❌ 保真度与下限覆盖度 —— F2a 的面纱形要求声明**以** `var(--we-readability-base)`
  //      开头，且 F1c 要求 `body{}` 里那条 floor 声明原样在 ⇒ 这一面的地板永远来自全局。
  //      所以本面**没有** `settingsWindowFidelity`（给了也接不通）。
  //   ⚪ 饱和度 / 亮度 —— 它们**不是可配置参数**（全局 `--we-saturate` 是常量
  //      `GLASS_SATURATE`、brightness 在设置窗口被钉在 1.04）⇒ 不纳入逐面独立，
  //      否则会给用户一个登记表里不存在的旋钮。
  //
  // ── **单一解析 + 无条件写入** ────────────────────────────────────────────────
  // 原则：**"不写"永远不等于"撤销"** —— CSS 的 `var(--we-x, 兜底)` 只在 `--we-x`
  // **未定义**时才取兜底，而变量一旦被写到 `document.body.style` 上，它就一直是"已定义"的
  //（实测：关掉独立配置后旧值继续生效，用户看到的是"没接受全局配置"）。
  // ⇒ 每档都算出正确的值并写出：独立档 = 本面的键，跟随档 = 全局的键（由 `glassValue` 决定
  //   读谁）。"该撤没撤"于是**在结构上无法发生**。
  // ⚠️ 跟随档写出的值 == CSS 兜底本来会取到的值
  //   （`--we-blur` 就是 `blur + "px"`；`--we-glass-alpha` 与本面的 alpha 曲线同形），
  //   等价性由 `.test-cache/r1-equivalence.mjs` 的"有效取值零差异"守着。
  // "要不要玻璃"仍由**门控属性**管（层叠机制），与"用谁的值"正交。
  {
    // 本面的透明度曲线：与全局**同形**（滑杆 0–100 → 0.25…0.10，数值越大越透）。
    const pct = Number(glassValue("settingsWindow", "transparency", selection.settingsWindowTransparency, selection.glassAlpha)) || 0;
    s.setProperty("--we-settings-window-blur",
      glassValue("settingsWindow", "blur", selection.settingsWindowBlur, selection.blur) + "px");
    s.setProperty("--we-settings-window-alpha", String(Math.max(0.10, 0.25 - pct / 100 * 0.15)));
  }

  // - 对话栏玻璃保真度：并入「对话框玻璃·独立配置」—— 两个旋钮控同一件事，只留一个（用户口径）。
  //   存储键**复用** `chatGlassFidelity`（不新建平行键），所以老配置的值不丢。
  //   ⚠️ 取值的"读谁"判定经 `glassValue`：开了「对话框玻璃·独立配置」才读它自己的键，
  //   否则**继承全局**的 `glassFidelity`。
  //   只喂对话栏的**框架**玻璃面（气泡 / 输入卡片含工具弹卡 —— styles.js 里消费
  //   --we-chat-readability-* 的那批声明）。正文里的 markdown 内容面（代码块 / 行内代码 /
  //   引用等）刻意**不**跟本档：内容渲染面与侧边栏一起跟全局保真度（用户口径：代码块不和
  //   输入框一起）。tint 钳制与地板权重都按本档单独算（同源不变量）。
  const chatFidRaw = glassValue("conversation", "fidelity", selection.chatGlassFidelity, selection.glassFidelity);
  const chatFidNum = Number(chatFidRaw);
  const chatGlassFidelity = Number.isFinite(chatFidNum) ? Math.min(1, Math.max(0, chatFidNum / 100)) : 1;
  s.setProperty("--we-chat-glass-fidelity", String(chatGlassFidelity));
  // 釉色也按同一判定：开了独立配置就用它**自己**的颜色，否则用全局玻璃色。
  // #159②：全局那一侧**分主题取** —— 「玻璃颜色」存的是 `{light, dark}` 一对（见
  // lib/settings-schema.js 的 readGlassColors），这里按主题各取一半；`conversationColor`
  // 是「对话栏玻璃·独立配置」的单值，不分主题（与保真度那条同构）。
  const chatColorLight = glassValue("conversation", "color", selection.conversationColor, glassColorOf(selection, "light"));
  const chatColorDark = glassValue("conversation", "color", selection.conversationColor, glassColorOf(selection, "dark"));
  s.setProperty("--we-chat-surface-tint-light", weClampSurfaceColor(chatColorLight, "light", chatGlassFidelity));
  s.setProperty("--we-chat-surface-tint-dark", weClampSurfaceColor(chatColorDark, "dark", chatGlassFidelity));
  s.setProperty("--we-chat-surface-tint-rgb-light", toRgbTriple(weClampSurfaceColor(chatColorLight, "light", chatGlassFidelity)));
  s.setProperty("--we-chat-surface-tint-rgb-dark", toRgbTriple(weClampSurfaceColor(chatColorDark, "dark", chatGlassFidelity)));

  // ── 思考触发条的**按面**釉层变量 ──────────────────────────────────────────────
  // 该面的 CSS 读 `var(--we-thinking-trigger-<x>, <原全局表达式>)`（styles.js 里那条
  // **接管宿主令牌**的规则）⇒ 这一组变量就是它的来源，"读全局还是读自己"由 `glassValue` 决定。
  // ⚠️ 只写**两项**（模糊 / 透明度）：与 `settingsWindow` / `floaters` 同一口径 ——
  //    共享面纱 ⇒ 保真度不可达；本面的 CSS 不消费颜色 ⇒ 不给 `color`。
  // ⚠️ 曲线与其余面**同形**（0–60 / 0–100 一把刻度）：透明度是位置量，越大越透。
  {
    const pct = Number(glassValue("thinkingTrigger", "transparency", selection.thinkingTriggerTransparency, selection.glassAlpha)) || 0;
    s.setProperty("--we-thinking-trigger-blur",
      String(glassValue("thinkingTrigger", "blur", selection.thinkingTriggerBlur, selection.blur)) + "px");
    s.setProperty("--we-thinking-trigger-alpha", String(Math.max(0.10, 0.25 - pct / 100 * 0.15)));
  }
  // ── 没有「要不要玻璃」这个选项（用户口径）────────────────────────────────────
  // 不能靠"关掉就摘属性"回到原生：这些面上还有一批**不挂门控**的令牌改写（壁纸激活即生效），
  // 关掉只得到半玻璃而非原生纯色，要做到"关得像样"得连令牌层一起回退，复杂度远超收益。
  // ⇒ 本面**恒挂**门控属性；每个子面唯一的开关是「独立配置」（读自己 vs 跟全局）。
  //   属性保留是因为 CSS 侧的门控是**证书式**的（守卫 ⑨/⑬ 靠它判断"哪些规则画玻璃"），
  //   删属性要动几十条选择器并把两条判据的前提改掉。
  document.body.setAttribute("data-we-glass-chat", "on");

  // 「设置窗口液态玻璃」这个**显示开关**同样不提供（用户口径）：功能由「设置窗口玻璃·独立配置」
  // 接管，行为与开启时逐位一致（本面恒挂门控属性）—— "...都能到原生"的语义重叠随之消失。
  // ── 同 `data-we-glass-chat`：本面**恒挂**门控属性 ──────────────────────────────
  document.body.setAttribute("data-we-glass-window", "on");

  // 左侧栏液态玻璃：原生左栏（会话列表 / 工作区那一列）默认只是"透明的洞"——壁纸原样
  // 透出，没有霜、也不吃玻璃参数。打开后 CSS 给那一列刷上与其余面板同一张配方表
  // （配色 / 玻璃颜色 / 玻璃透明度 / 雾化 / 边框），关掉即逐字节恢复。
  // 变量与开关节点的落点同玻璃窗口：body 属性 + 样式表规则，切换不需要重建任何东西。
  if (selection.leftSidebarGlass) document.body.setAttribute("data-we-left-sidebar", "on");
  else document.body.removeAttribute("data-we-left-sidebar");

  // ── 侧边栏四角圆角 / 直角（外观 → 侧边栏圆角）────────────────────────────────
  // 与玻璃无关的一对属性 + 一个变量（CSS 见 styles.js 同名块）：左栏锚点 = 座位出口的
  // **父元素**（出口带 display:contents、不生成盒子），右栏锚点必须带
  // [data-sidebar-right-open]（容器收起时仍挂在布局里，裸锚会给收起态留一块板子）。
  // 默认（统一档 'native'、四角都不直角）时**一个属性都不挂** ⇒ 规则不生效、逐字节等于今天。
  {
    const px = (v) => (v === "6" || v === "12" || v === "20") ? v + "px" : "";
    const tokens = (tl, tr, br, bl) => [tl && "tl", tr && "tr", br && "br", bl && "bl"].filter(Boolean).join(" ");
    const leftR = px(selection.leftSidebarCornerRadius);
    const rightR = px(selection.rightSidebarCornerRadius);
    if (leftR) { s.setProperty("--we-left-sidebar-radius", leftR); document.body.setAttribute("data-we-left-sidebar-radius", "on"); }
    else document.body.removeAttribute("data-we-left-sidebar-radius");
    if (rightR) { s.setProperty("--we-right-sidebar-radius", rightR); document.body.setAttribute("data-we-right-sidebar-radius", "on"); }
    else document.body.removeAttribute("data-we-right-sidebar-radius");
    const leftSq = tokens(selection.leftSidebarSquareTL, selection.leftSidebarSquareTR, selection.leftSidebarSquareBR, selection.leftSidebarSquareBL);
    const rightSq = tokens(selection.rightSidebarSquareTL, selection.rightSidebarSquareTR, selection.rightSidebarSquareBR, selection.rightSidebarSquareBL);
    if (leftSq) document.body.setAttribute("data-we-left-sidebar-square", leftSq);
    else document.body.removeAttribute("data-we-left-sidebar-square");
    if (rightSq) document.body.setAttribute("data-we-right-sidebar-square", rightSq);
    else document.body.removeAttribute("data-we-right-sidebar-square");
  }

  // ── 左侧栏的**按面**釉层变量 ─────────────────────────────────────────────────
  // 该面的 CSS 读 `var(--we-left-sidebar-<x>, <原全局表达式>)`（styles.js 的
  // 「左侧栏液态玻璃」规则）⇒ 这一组变量就是它的来源。
  //
  // ⚠️ 门控与「玻璃 UI」的子项**不同**（这是乙类的特征）：
  //   · 子项：`glassMode[面] === 'custom'`（"独立配置"开关）
  //   · 本面：它**自身**就是那个"独立配置" —— 没开 `leftSidebarGlass`（左侧栏液态玻璃）时它
  //     连玻璃都不吃；开了就是"用自己那套覆盖全局"。所以门控是
  //     `glassMode.leftSidebar === 'custom'`（耦合在「左侧栏液态玻璃」下的那个开关）。
  //
  // ⚠️ 只写**两项**（模糊 / 透明度）：`--we-saturate` / `--we-glass-brightness` 不是可配置
  //    参数（常量）、`--we-surface-tint-*` 是 E2 配方文本、`--we-readability-*` 被判据锁定
  //     ⇒ 其余项逐面独立在"判据不变"下不可达。
  // ── 同上，**无条件写入** ────────────────────────────────────────────────────
  // 本面的"要不要玻璃"是 `leftSidebarGlass`（门控属性），与"用谁的值"正交 ⇒
  // 值这一侧不看任何开关，恒写出解析结果。
  {
    const pct = Number(glassValue("leftSidebar", "transparency", selection.leftSidebarTransparency, selection.glassAlpha)) || 0;
    s.setProperty("--we-left-sidebar-blur",
      String(glassValue("leftSidebar", "blur", selection.leftSidebarBlur, selection.blur)) + "px");
    s.setProperty("--we-left-sidebar-alpha", String(Math.max(0.10, 0.25 - pct / 100 * 0.15)));
  }

  // 标题栏液态玻璃：壳层顶栏（AppFrame 那个 grid 容器，锚点是 `div[class*="pI_x6G_frame"]`
  // 这个**构建哈希子串** —— `.dshDesktopFrameTitlebar` 在当前 app.asar 命中 0 次，
  // 见 styles.js 的「标题栏液态玻璃」注释）默认只是那条不透明的底色（上面 styles.js 的
  // 「外壳画布底」把外壳画布清成 transparent 之后，这一层是唯一必须保留底色的面）。
  // 打开后 CSS 把它换成**与其余面板同一张配方表**，且与左侧栏那条**逐条同形**
  // （唯一差别是锚点；**不画**底分割线，理由见 styles.js）。
  // 变量与开关节点的落点同玻璃窗口：body 属性 + 样式表规则，切换不需要重建任何东西。
  if (selection.titlebarGlass) document.body.setAttribute("data-we-titlebar-glass", "on");
  else document.body.removeAttribute("data-we-titlebar-glass");

  // ── 标题栏的**按面**釉层变量 ───────────────────────────────────────────────────
  // 该面的 CSS 读 `var(--we-titlebar-<x>, …)`（styles.js 的「标题栏液态玻璃」规则）
  // ⇒ 这一组变量就是它的来源。
  //
  // ⚠️ 门控与左侧栏**完全同形**（同是乙类）：
  //   · 侧栏：门控属性 = `leftSidebarGlass`（`data-we-left-sidebar`），
  //     "用谁的值" = `glassMode.leftSidebar`（「左侧栏玻璃·独立配置」）。
  //   · 本面：门控属性 = `titlebarGlass`（`data-we-titlebar-glass`），
  //     "用谁的值" = `glassMode.titlebar`（「标题栏玻璃·独立配置」）。
  //
  // ⚠️ 只写**两项**（模糊 / 透明度）：`--we-saturate` / `--we-glass-brightness` 不是可配置
  //    参数（常量）、`--we-surface-tint-*` 是 E2 配方文本、`--we-readability-*` 被判据锁定
  //     ⇒ 其余项逐面独立在"判据不变"下不可达。
  // ── 同上，**无条件写入** ────────────────────────────────────────────────────
  // 本面的"要不要玻璃"是 `titlebarGlass`（门控属性），与"用谁的值"正交 ⇒
  // 值这一侧不看任何开关，恒写出解析结果。
  // ⚠️ **曲线逐字照抄左栏**（`0.25 − pct/100 × 0.15`，下限 0.10）：两条面共用同一把观感
  //    刻度，用户把左侧栏调到满意的透明度时，标题栏**同一数值**必然是同一观感 ——
  //    这正是"标题栏与左侧栏不要有色差"在取值侧的保证。
  {
    const pct = Number(glassValue("titlebar", "transparency", selection.titlebarTransparency, selection.glassAlpha)) || 0;
    s.setProperty("--we-titlebar-blur",
      String(glassValue("titlebar", "blur", selection.titlebarBlur, selection.blur)) + "px");
    s.setProperty("--we-titlebar-alpha", String(Math.max(0.10, 0.25 - pct / 100 * 0.15)));
  }

  // dsh-better-sidebar 液态玻璃：一套独立于会话玻璃的细粒度控制（侧栏模糊 /
  // 侧栏透明度 / 侧栏玻璃颜色 + 总开关）。变量只作用于 [data-dsh-better-sidebar]
  // 子树（CSS 见下），关闭总开关时侧栏恢复原生外观。
  // 每个参数都经 `glassValue` 解析 —— 默认档（`glassMode.sidebar === 'inherit'`）取
  // **侧栏自己的键**；把某一项关掉才会回落到全局那一个键。
  // ── 量纲统一 ────────────────────────────────────────────────────────────────
  // 各面现在共用**同一把规范刻度**：
  //   · 模糊 **0–60 px**（与全局雾化一致）—— 直接当 px 用，**无曲线**
  //   · 透明度 **0–100 %**             —— 位置量，各面用自己的**表达曲线**映到观感
  // 于是"继承"就是"读另一个键的那个数字"，**不需要归一化**（没有 `norm` / `denorm` 这对工具）。
  //
  // ⚠️ 这是一次**有意的存储刻度迁移**（用户已授权）：旧档由 `settingsVersion` 4 换算到新刻度
  //   （见 settings-schema.js 的 migrateSettings），使观感**逐点不变**。换算分两类，别搞混：
  //   位置量按**占比**换算；**模糊类是直接量，只钳制不换算**（对它换算等于改观感）。
  // ⚠️ 曲线的分母必须与 KINDS 的上界一致 —— 那是"同一个数字 = 同一个位置"的唯一保证。
  // 侧栏模糊：本面量程 0–60（与全局雾化同刻度）。
  const sidebarBlur = Number(glassValue("sidebar", "blur", selection.sidebarBlur, selection.blur)) || 0;
  s.setProperty("--we-sidebar-blur", sidebarBlur + "px");
  // 上界就是 60 ⇒ 饱和度补偿项无需 `Math.min(x, 60)` 钳制（钳制是冗余的）。
  s.setProperty("--we-sidebar-saturate", String(1.15 + sidebarBlur * 0.028));
  // 侧栏透明度：本面量程 0–100。语义"越大越透"。
  const sidebarAlphaPct = Number(glassValue("sidebar", "transparency", selection.sidebarAlpha, selection.glassAlpha)) || 0;
  const sidebarAlpha = Math.max(0.015, 0.32 - (sidebarAlphaPct / 100) * 0.305);
  // ⚠️ 这里**不写** `--we-sidebar-alpha`：它是死变量（实测：整份样式表里
  //   精确出现 1 次、且那次在注释里，没有任何 CSS 消费者）。真正接线的是它的两个下游
  //   派生物 —— `--we-sidebar-sheen`（釉光，12 处消费）与 `--we-sidebar-tint`
  //   （染色权重，6 处）—— 两者都在下面写出。
  s.setProperty("--we-sidebar-sheen", String(Math.min(1, sidebarAlpha / 0.2236)));
  // #159②：这里**只取浅色那一侧**，侧栏不做深浅分离（有意取舍）——
  // 侧栏的消费者把颜色混进**主题解析出来的底**上（color-mix … var(--we-readability-base)），
  // 规则里没有 data-ds-dark-theme 孪生；要分两套得给那批声明加暗色孪生，而 --we-sidebar-color
  // 是 body 行内样式、样式表重声明压不过它。等侧栏有了暗色孪生再把这一半也分主题。
  s.setProperty("--we-sidebar-color", glassValue("sidebar", "color", selection.sidebarColor, glassColorOf(selection, "light")));
  // 侧栏玻璃颜色的混入强度（%）：**独立于 alpha 的可见性曲线** —— alpha 在高透档
  // 趋近 0，混色若跟着 alpha 走，颜色滑杆在最高档就等于失效（低于可感知阈值）。
  // 因此随透明度滑杆线性映射 20%–48%：最透档也有可感知色染，往实调颜色越来越浓。
  const sidebarTint = 20 + (100 - Math.min(Math.max(sidebarAlphaPct, 0), 100)) / 100 * 28;
  s.setProperty("--we-sidebar-tint", sidebarTint.toFixed(1) + "%");
  if (selection.sidebarGlass) document.body.setAttribute("data-we-sidebar-glass", "on");
  else document.body.removeAttribute("data-we-sidebar-glass");
  // 侧栏全透明（issue #137）：独立于「要不要玻璃」的第三态门控 —— 玻璃开着时它把
  // 地板/色染/釉光三组变量在侧栏子树里就地归零，玻璃关着时它接管右栏那条原生
  // 不透明兜底。与 data-we-sidebar-glass 一样是"值与门正交"的属性；配对的卸载
  // 撤除在 effects.js 的 clearEffects（漏撤 ⇒ 插件卸载后规则组照旧生效）。
  if (selection.sidebarFullClear) document.body.setAttribute("data-we-sidebar-fullclear", "on");
  else document.body.removeAttribute("data-we-sidebar-fullclear");

  // ── 插件自身浮层的**按面**釉层变量 ───────────────────────────────────────────
  // 该面的 CSS 现在读 `var(--we-floaters-<x>, <原全局表达式>)`（styles.js 的
  // `.we-update-notice` 与 `.we-repo-panel--open` 两条规则）⇒ 这一组变量就是它的来源。
  // 涉及两处玻璃面：**更新提示**（自己一块面板）与**壁纸仓库抽屉**（打开态才画玻璃）。
  //
  // ⚠️ 只写**两项**（模糊 / 透明度）：`--we-saturate` / `--we-glass-brightness` 不是可配置
  //    参数（常量）、`--we-surface-tint-*` 是 E2 配方文本、`--we-readability-*` 被判据锁定
  //    ⇒ 其余项逐面独立在"判据不变"下不可达。
  document.body.setAttribute("data-we-glass-floaters", "on");
  // ── **无条件写入** ───────────────────────────────────────────────────────────
  {
    const pct = Number(glassValue("floaters", "transparency", selection.floatersTransparency, selection.glassAlpha)) || 0;
    s.setProperty("--we-floaters-blur",
      String(glassValue("floaters", "blur", selection.floatersBlur, selection.blur)) + "px");
    s.setProperty("--we-floaters-alpha", String(Math.max(0.10, 0.25 - pct / 100 * 0.15)));
  }
  // 内容面（编辑器/终端）近不透明玻璃底：透明度滑块 **0–100** → 不透明度 100%–20%
  // （越大越透，与玻璃透明度同语义；低于 ~40% 不透明度注释可读性会再次变差，
  // 留给用户自行权衡）；底色空 = 跟随主题面板色，选定后自定义。
  // 注意 color-mix 的百分比槽位要求带单位的 token —— 变量值必须含 "%"，
  // 否则整个 color-mix 失效、底色规则被丢弃（编辑器回退到纯透明毛玻璃）。
  // ⚠️ 本面与全局**同刻度** ⇒ 既不需要归一化、也不需要各写一套量程：
  //    映射是"整段 0–100 → 100%–20%"，即 `100 − pct × 0.8`（pct=100 ⇒ 20%）。
  const contentAlphaPct = Number(glassValue("sidebarContent", "transparency", selection.sidebarContentAlpha, selection.glassAlpha)) || 0;
  s.setProperty("--we-content-surface-alpha", Math.max(20, 100 - contentAlphaPct * 0.8) + "%");
  // 内容面底色：自有键为**空**时表示"跟随主题面板色"（由 CSS 的 var 兜底表达），
  // 所以这里保留既有的 set/remove 语义，只把来源经解析器选过一遍。
  const contentColor = glassValue("sidebarContent", "color", selection.sidebarContentColor, "");
  if (contentColor) s.setProperty("--we-content-surface-color", contentColor);
  else s.removeProperty("--we-content-surface-color");
}

export { applyGlass, toRgbTriple };
