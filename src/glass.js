/**
 * glass.js — **玻璃后端的唯一落点**：取值解析 + 各面釉层变量 + 门控属性。
 *
 * 为什么单开一个文件（wip §10.13）：这一段原在 `src/effects.js` 里夹在 accent / 可读性 /
 * 光标 / 壁纸 / 字体之间，而它的**输入输出是封闭的** —— 只需要 `selection` 与
 * `document.body.style`，外加两个纯函数（`weClampSurfaceColor` 顶层共享、`toRgbTriple` 本文件）。
 * 抽出来之后：⑪/⑫/⑬ 三组守卫读的"写了什么"有了**单一归属**（不必再在 700 行文件里切片段），
 * 下一步（R3b）"三键收成两态 + 迁移"的改动也**只落在这个文件里**。
 *
 * 契约（三条，都是实测换来的，详见 docs/archive/wip/GLASS-CONFIG-REFACTOR.md §10.10–§10.12）：
 *   ① **每档都算出值并写出**（`applyGlass` 里没有任何 `removeProperty`）——"不写"永远不等于
 *      "撤销"：CSS 的 `var(--x, 兜底)` 只在 `--x` **未定义**时取兜底，而写到 body 上的变量
 *      一直是"已定义"的（§4.26 的病根）。
 *   ② **门控属性恒挂**（`data-we-glass-window/-chat/-floaters` 三者在 §10.20 之后不再可关；`data-we-left-sidebar`、
 *      `data-we-sidebar-glass`），与"用谁的值"**正交**：关掉只是让那组规则整组不匹配。
 *   ③ **读谁只在这里决定**：`glassValue(面, 参数, 自己的键, 全局的键)`；UI 只翻开关，不动接线。
 *
 * ⚠️ 本文件**不读** `selection` 以外的状态。`norm` / `denorm` / `toRgbTriple` 是本文件内的
 *    工具；`weClampSurfaceColor` 由 `src/effects.js` 顶层提供（构建期内联进**同一个工厂作用域**，
 *    所以这里直接调用即可，不需要 import 语法）。
 */

// RGB 三元组：给 rgba() 槽位用（消息气泡 / 输入框的白釉染色）。
// ⚠️ 下标 [0,2,4] —— 6 位 hex 不带 '#'，[1,3,5] 是带 '#' 时代的错位写法。
// （本函数同时服务 `effects.js` 的全局 `--we-surface-tint-rgb-*`，所以放在顶层而不是 applyGlass 里。）
// ⚠️ 下标 [0,2,4] —— 6 位 hex 不带 '#'，[1,3,5] 是带 '#' 时代的错位写法。
const toRgbTriple = (hex) => {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || ""));
  return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).join(", ") : "255, 255, 255";
};

/** 每次 applyEffects 调用一次：把每个玻璃面的值算出来并写出，再挂/摘门控属性。 */
function applyGlass(selection, s) {
  // ── 玻璃面 × 参数的取值解析（R3b-ii 起：**两态**，由 `glassMode` 说读谁）────────────
  //
  // 模型：每个玻璃面的每个参数只有**一个**取值来源 ——
  //   · 该面处于 `'custom'` ⇒ 读它**自己**的键
  //   · 否则（`'inherit'`，**默认**）⇒ 读**全局**键
  // 所以"继承"与"独立"不是两条并行的接线，而是同一条线上的两个来源。
  //
  // ⚠️ **必须定义在第一个使用点之前**（本函数内 `const` 有 TDZ）：否则会直接抛
  //   `Cannot access 'glassValue' before initialization`（§4.24 那个真实事故）。
  //
  // ⚠️ 解析发生在**此处（JS）**、不是靠 CSS 变量缺省值：侧栏那条 CSS 用
  //   color-mix(var(--we-sidebar-color) … var(--we-sidebar-tint) …)，变量一旦缺失整条
  //   声明会被丢弃（侧栏变全透明），所以回退路径必须是"写另一个值"，不是"不写"。
  //
  // ⚠️ **只有这里**决定"读全局还是读自己"；UI 开关只需翻 `glassMode`，不需要再动接线。
  //
  // ⚠️ `param` 仍然要传：它不再是运行期分支条件，而是**声明** —— 守卫第 ④ 组拿这些调用点
  //   与注册表的 `params` 逐参数对账（"注册表声明了却没接线"= 死旋钮）。原先那张能力表
  //   `glassOverrides` 已删除（R3b-ii）：能力现在由这条对账 + 第 ⑬ 组"写了必须被 CSS 读到"
  //   共同保证，不再手抄。
  const glassModeOn = (surface) => {
    const rec = selection.glassMode;
    return !!(rec && typeof rec === 'object' && rec[surface] === 'custom');
  };
  /** 面 × 参数 → 取值：**模式是 custom** 读 profile，否则读全局。 */
  const glassValue = (surface, param, profileValue, globalValue) =>
    (glassModeOn(surface) ? profileValue : globalValue);

  // ── 设置窗口这个玻璃面的**按面**釉层变量（W2 接线，2025 起）────────────────────
  // 该面的 CSS 现在读 `var(--we-settings-window-<x>, <原全局表达式>)`（见 styles.js 的
  // 「设置窗口」4 条规则）⇒ 这一组变量就是它的来源，"读全局还是读自己"由 `glassValue` 决定。
  //
  // ⚠️ **两项能做到，两项做不到**（§4.14 的取证结论）：
  //   ✅ 模糊 / 透明度 —— 判据对它们要么无锚定，要么是**子串判定**
  //      （G5 的 `readsBoth` 只要求 `var(--we-blur` 出现，内层兜底保留了它）。
  //   ❌ 保真度与下限覆盖度 —— F2a 的面纱形要求声明**以** `var(--we-readability-base)`
  //      开头，且 F1c 要求 `body{}` 里那条 floor 声明原样在 ⇒ 这一面的地板永远来自全局。
  //      所以本面**没有** `settingsWindowFidelity`（给了也接不通）。
  //   ⚪ 饱和度 / 亮度 —— 它们**不是可配置参数**（全局 `--we-saturate` 是常量
  //      `GLASS_SATURATE`、brightness 在设置窗口被钉在 1.04）⇒ 不纳入逐面独立，
  //      否则会给用户一个登记表里不存在的旋钮。
  //
  // ── R1：**单一解析 + 无条件写入**（wip §10.10）────────────────────────────────
  // 原则：**"不写"永远不等于"撤销"** —— CSS 的 `var(--we-x, 兜底)` 只在 `--we-x`
  // **未定义**时才取兜底，而变量一旦被写到 `document.body.style` 上，它就一直是"已定义"的
  //（§4.26 实测：关掉独立配置后旧值继续生效，用户看到的是"没接受全局配置"）。
  // ⇒ 不再用"写 / 撤"两态，而是**每档都算出正确的值并写出**：独立档 = 本面的键，
  //   跟随档 = 全局的键（由 `glassValue` 决定读谁）。"该撤没撤"于是**在结构上无法发生**。
  // ⚠️ 这是**逐字等价**的重写（不是改语义）：跟随档写出的值 == CSS 兜底本来会取到的值
  //   （`--we-blur` 就是 `blur + "px"`；`--we-glass-alpha` 与本面的 alpha 曲线同形），
  //   等价性由 `.test-cache/r1-equivalence.mjs` 的"有效取值零差异"守着。
  // "要不要玻璃"仍由**门控属性**管（§4.21 的层叠机制），与"用谁的值"正交。
  {
    // 本面的透明度曲线：与全局**同形**（0–60 → 0.25…0.10，越大越透）。
    const pct = Number(glassValue("settingsWindow", "transparency", selection.settingsWindowTransparency, selection.glassAlpha)) || 0;
    s.setProperty("--we-settings-window-blur",
      glassValue("settingsWindow", "blur", selection.settingsWindowBlur, selection.blur) + "px");
    s.setProperty("--we-settings-window-alpha", String(Math.max(0.10, 0.25 - pct / 100 * 0.15)));
  }

  // - 对话栏玻璃保真度：**已并入「对话框玻璃·独立配置」**（用户口径：那个开关存在之后，
  //   独立的「对话栏玻璃保真度」旋钮就多余了 —— 两个旋钮控同一件事）。
  //   存储键**复用** `chatGlassFidelity`（D2：不新建平行键），所以老配置的值不丢。
  //   ⚠️ 取值的"读谁"判定经 `glassValue`：开了「对话框玻璃·独立配置」才读它自己的键，
  //   否则**继承全局**的 `glassFidelity` —— 这就是本次接线的核心。
  //   只喂对话栏的**框架**玻璃面（气泡 / 输入卡片含工具弹卡 —— styles.js 里消费
  //   --we-chat-readability-* 的那批声明）。正文里的 markdown 内容面（代码块 / 行内代码 /
  //   引用等）刻意**不**跟本档：内容渲染面与侧边栏一起跟全局保真度（用户口径：代码块不和
  //   输入框一起）。tint 钳制与地板权重都按本档单独算（§3.2 的同源不变量）。
  const chatFidRaw = glassValue("conversation", "fidelity", selection.chatGlassFidelity, selection.glassFidelity);
  const chatFidNum = Number(chatFidRaw);
  const chatGlassFidelity = Number.isFinite(chatFidNum) ? Math.min(1, Math.max(0, chatFidNum / 100)) : 1;
  s.setProperty("--we-chat-glass-fidelity", String(chatGlassFidelity));
  // 釉色也按同一判定：开了独立配置就用它**自己**的颜色，否则用全局玻璃色。
  const chatColor = glassValue("conversation", "color", selection.conversationColor, selection.glassColor);
  s.setProperty("--we-chat-surface-tint-light", weClampSurfaceColor(chatColor, "light", chatGlassFidelity));
  s.setProperty("--we-chat-surface-tint-dark", weClampSurfaceColor(chatColor, "dark", chatGlassFidelity));
  s.setProperty("--we-chat-surface-tint-rgb-light", toRgbTriple(weClampSurfaceColor(chatColor, "light", chatGlassFidelity)));
  s.setProperty("--we-chat-surface-tint-rgb-dark", toRgbTriple(weClampSurfaceColor(chatColor, "dark", chatGlassFidelity)));

  // ── 思考触发条的**按面**釉层变量（新增面，见 wip §10.27）──────────────────────
  // 该面的 CSS 读 `var(--we-thinking-trigger-<x>, <原全局表达式>)`（styles.js 里那条
  // **接管宿主令牌**的规则）⇒ 这一组变量就是它的来源，"读全局还是读自己"由 `glassValue` 决定。
  // ⚠️ 只写**两项**（模糊 / 透明度）：与 `settingsWindow` / `floaters` 同一口径 ——
  //    共享面纱 ⇒ 保真度不可达（§4.14）；本面的 CSS 不消费颜色 ⇒ 不给 `color`（R3a）。
  // ⚠️ 曲线与其余面**同形**（0–60/0–100 一把刻度，R4）：透明度是位置量，越大越透。
  {
    const pct = Number(glassValue("thinkingTrigger", "transparency", selection.thinkingTriggerTransparency, selection.glassAlpha)) || 0;
    s.setProperty("--we-thinking-trigger-blur",
      String(glassValue("thinkingTrigger", "blur", selection.thinkingTriggerBlur, selection.blur)) + "px");
    s.setProperty("--we-thinking-trigger-alpha", String(Math.max(0.10, 0.25 - pct / 100 * 0.15)));
  }
  // ── 「要不要玻璃」这一层已**退役**（用户口径，wip §10.20）──────────────────────
  // 原设计：这一项关 ⇒ 摘掉门控属性 ⇒ CSS 那组规则整组不匹配 ⇒ "回到原生不透明纯色"。
  // 实测**并没有如愿恢复原生**：这些面上还有一批**不挂门控**的令牌改写（壁纸激活即生效），
  // 所以"关"得到的是半玻璃外观而不是原生纯色；要做到"关得像样"得连令牌层一起回退 ——
  // 实现复杂度远超收益 ⇒ **删掉这一层**（连同面板上的开关）。
  // ⇒ 本面**恒挂**门控属性："要不要玻璃"不再是用户可选项；每个子面留下的唯一开关是
  //   「独立配置」（读自己 vs 跟全局）。属性本身保留，因为 CSS 侧的门控是**证书式**的
  //   （守卫 ⑨/⑬ 靠它判断"哪些规则画玻璃"），删属性要动几十条选择器并把两条判据的前提改掉。
  document.body.setAttribute("data-we-glass-chat", "on");

  // 「设置窗口液态玻璃」这个**显示开关也已退役**（用户口径）：它的功能由
  // 「设置窗口玻璃·独立配置」接管，行为与**开启时**逐位一致（本面恒挂门控属性）。
  // ⇒ 本面的语义重叠（§4.21 记的那两个开关都能到"原生"）随之消失。
  // ── 「要不要玻璃」这一层已**退役**（用户口径，wip §10.20）──────────────────────
  // 原设计：这一项关 ⇒ 摘掉门控属性 ⇒ CSS 那组规则整组不匹配 ⇒ "回到原生不透明纯色"。
  // 实测**并没有如愿恢复原生**：这些面上还有一批**不挂门控**的令牌改写（壁纸激活即生效），
  // 所以"关"得到的是半玻璃外观而不是原生纯色；要做到"关得像样"得连令牌层一起回退 ——
  // 实现复杂度远超收益 ⇒ **删掉这一层**（连同面板上的开关）。
  // ⇒ 本面**恒挂**门控属性："要不要玻璃"不再是用户可选项；每个子面留下的唯一开关是
  //   「独立配置」（读自己 vs 跟全局）。属性本身保留，因为 CSS 侧的门控是**证书式**的
  //   （守卫 ⑨/⑬ 靠它判断"哪些规则画玻璃"），删属性要动几十条选择器并把两条判据的前提改掉。
  document.body.setAttribute("data-we-glass-window", "on");

  // 左侧栏覆盖：原生左栏（会话列表 / 工作区那一列）默认只是"透明的洞"——壁纸原样
  // 透出，没有霜、也不吃玻璃参数。打开后 CSS 给那一列刷上与其余面板同一张配方表
  // （配色 / 玻璃颜色 / 玻璃透明度 / 雾化 / 边框），关掉即逐字节恢复。
  // 变量与开关节点的落点同玻璃窗口：body 属性 + 样式表规则，切换不需要重建任何东西。
  if (selection.leftSidebarGlass) document.body.setAttribute("data-we-left-sidebar", "on");
  else document.body.removeAttribute("data-we-left-sidebar");

  // ── 左侧栏的**按面**釉层变量（W3 接线）────────────────────────────────────────
  // 该面的 CSS 现在读 `var(--we-left-sidebar-<x>, <原全局表达式>)`（styles.js 的
  // 「左侧栏覆盖」规则）⇒ 这一组变量就是它的来源。
  //
  // ⚠️ 门控与「玻璃 UI」的子项**不同**（这是乙类的特征，见 wip §2）：
  //   · 子项：`glassMode[面] === 'custom'`（"独立配置"开关）
  //   · 本面：它**自身**就是那个"独立配置" —— 没开 `leftSidebarGlass`（左侧栏覆盖）时它
  //     连玻璃都不吃；开了就是"用自己那套覆盖全局"。所以门控是
  //     `glassMode.leftSidebar === 'custom'`（耦合在「左侧栏覆盖」下的那个开关）。
  //
  // ⚠️ 只写**两项**（模糊 / 透明度）：`--we-saturate` / `--we-glass-brightness` 不是可配置
  //    参数（常量）、`--we-surface-tint-*` 是 E2 配方文本、`--we-readability-*` 被判据锁定
  //     ⇒ 其余项逐面独立在"判据不变"下不可达（§4.14）。
  // ── R1：同上，**无条件写入**（wip §10.10）─────────────────────────────────────
  // 本面的"要不要玻璃"是 `leftSidebarGlass`（门控属性），与"用谁的值"正交 ⇒
  // 值这一侧不再看任何开关，恒写出解析结果。
  {
    const pct = Number(glassValue("leftSidebar", "transparency", selection.leftSidebarTransparency, selection.glassAlpha)) || 0;
    s.setProperty("--we-left-sidebar-blur",
      String(glassValue("leftSidebar", "blur", selection.leftSidebarBlur, selection.blur)) + "px");
    s.setProperty("--we-left-sidebar-alpha", String(Math.max(0.10, 0.25 - pct / 100 * 0.15)));
  }

  // dsh-better-sidebar 液态玻璃：一套独立于会话玻璃的细粒度控制（侧栏模糊 /
  // 侧栏透明度 / 侧栏玻璃颜色 + 总开关）。变量只作用于 [data-dsh-better-sidebar]
  // 子树（CSS 见下），关闭总开关时侧栏恢复原生外观。
  // R3b-ii：每个参数都经 glassValue 解析 —— 默认档（`glassMode.sidebar === 'inherit'`）取
  // **侧栏自己的键**，即与重构前逐字节相同；把某一项关掉才会回落到全局那一个键。
  // ── 量纲统一（R4，wip §10.19）────────────────────────────────────────────────
  // 各面现在共用**同一把规范刻度**：
  //   · 模糊 **0–60 px**（与全局雾化一致）—— 直接当 px 用，**无曲线**
  //   · 透明度 **0–100 %**             —— 位置量，各面用自己的**表达曲线**映到观感
  // 于是"继承"就是"读另一个键的那个数字"，**不需要归一化** —— `norm` / `denorm` 这一对已删除。
  //
  // ⚠️ 这是一次**有意的存储刻度迁移**（用户已授权）：旧档由 `settingsVersion` 4 换算到新刻度
  //   （见 settings-schema.js 的 migrateSettings），使观感**逐点不变**。换算分两类，别搞混：
  //   位置量按**占比**换算；**模糊类是直接量，只钳制不换算**（对它换算等于改观感）。
  // ⚠️ 曲线的分母必须与 KINDS 的上界一致 —— 那是"同一个数字 = 同一个位置"的唯一保证。
  // 侧栏模糊：本面量程 0–60（与全局雾化同刻度）。
  const sidebarBlur = Number(glassValue("sidebar", "blur", selection.sidebarBlur, selection.blur)) || 0;
  s.setProperty("--we-sidebar-blur", sidebarBlur + "px");
  // 饱和度补偿项原本要 `Math.min(x, 60)` 钳制（旧上界 0–200）；现在上界就是 60 ⇒ 钳制是冗余的。
  s.setProperty("--we-sidebar-saturate", String(1.15 + sidebarBlur * 0.028));
  // 侧栏透明度：本面量程 0–100。语义"越大越透"。
  const sidebarAlphaPct = Number(glassValue("sidebar", "transparency", selection.sidebarAlpha, selection.glassAlpha)) || 0;
  const sidebarAlpha = Math.max(0.015, 0.32 - (sidebarAlphaPct / 100) * 0.305);
  // ⚠️ 这里**不再写** `--we-sidebar-alpha`：它是死变量（P0 的登记表实测：整份样式表里
  //   精确出现 1 次、且那次在注释里，没有任何 CSS 消费者）。它的两个下游派生物 ——
  //   `--we-sidebar-sheen`（釉光，12 处消费）与 `--we-sidebar-tint`（染色权重，6 处）——
  //   才是真正接线的，两者都在下面照旧写出。删掉它原本那条 `removeProperty` 同批撤除。
  s.setProperty("--we-sidebar-sheen", String(Math.min(1, sidebarAlpha / 0.2236)));
  s.setProperty("--we-sidebar-color", glassValue("sidebar", "color", selection.sidebarColor, selection.glassColor));
  // 侧栏玻璃颜色的混入强度（%）：**独立于 alpha 的可见性曲线** —— alpha 在高透档
  // 趋近 0，混色若跟着 alpha 走，颜色滑杆在最高档就等于失效（低于可感知阈值）。
  // 因此随透明度滑杆线性映射 20%–48%：最透档也有可感知色染，往实调颜色越来越浓。
  const sidebarTint = 20 + (100 - Math.min(Math.max(sidebarAlphaPct, 0), 100)) / 100 * 28;
  s.setProperty("--we-sidebar-tint", sidebarTint.toFixed(1) + "%");
  if (selection.sidebarGlass) document.body.setAttribute("data-we-sidebar-glass", "on");
  else document.body.removeAttribute("data-we-sidebar-glass");

  // ── 插件自身浮层的**按面**釉层变量（W4 接线）────────────────────────────────
  // 该面的 CSS 现在读 `var(--we-floaters-<x>, <原全局表达式>)`（styles.js 的
  // `.we-update-notice` 与 `.we-repo-panel--open` 两条规则）⇒ 这一组变量就是它的来源。
  // 涉及两处玻璃面：**更新提示**（自己一块面板）与**壁纸仓库抽屉**（打开态才画玻璃）。
  //
  // ⚠️ 只写**两项**（模糊 / 透明度）：`--we-saturate` / `--we-glass-brightness` 不是可配置
  //    参数（常量）、`--we-surface-tint-*` 是 E2 配方文本、`--we-readability-*` 被判据锁定
  //    ⇒ 其余项逐面独立在"判据不变"下不可达（§4.14）。
  document.body.setAttribute("data-we-glass-floaters", "on");
  // ── R1：**无条件写入**（wip §10.10）───────────────────────────────────────────
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
  // ⚠️ 本面与全局**同刻度**（R4 统一之后）⇒ 既不需要归一化、也不需要各写一套量程：
  //    映射是"整段 0–100 → 100%–20%"，即 `100 − pct × 0.8`（pct=100 ⇒ 20%，与旧档下限一致）。
  const contentAlphaPct = Number(glassValue("sidebarContent", "transparency", selection.sidebarContentAlpha, selection.glassAlpha)) || 0;
  s.setProperty("--we-content-surface-alpha", Math.max(20, 100 - contentAlphaPct * 0.8) + "%");
  // 内容面底色：自有键为**空**时表示"跟随主题面板色"（由 CSS 的 var 兜底表达），
  // 所以这里保留既有的 set/remove 语义，只把来源经解析器选过一遍。
  const contentColor = glassValue("sidebarContent", "color", selection.sidebarContentColor, "");
  if (contentColor) s.setProperty("--we-content-surface-color", contentColor);
  else s.removeProperty("--we-content-surface-color");
}

export { applyGlass, toRgbTriple };
