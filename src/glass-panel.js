/**
 * glass-panel.js — 「玻璃 UI」节的**渲染器**（纯渲染 + 显式 ctx）。
 *
 * 为什么单开一个文件（wip §10.13）：这一段原在 `src/panel-tabs.js`（1700+ 行、七个页签）里，
 * 而它与其余页签**只共享模块级纯助手** —— `React` / `SliderRow` / `switchRow` / `swatchRow` /
 * `weT` / `GLASS_COLOR_PRESETS` 都是**顶层声明**（`src/client.js` 等），构建期内联进同一工厂
 * 作用域 ⇒ 抽出来**不需要任何 ctx 传参样板**，`renderAppearanceTab` 照旧按名字调用即可。
 *
 * 契约（与 `src/panel-tabs.js` 文件头同一条，不在此重复解释）：
 *   · **只读** ctx —— 不得写 `selection` / ctx 别名指向的东西 / 模块级状态；
 *   · **动作经具名处理器** —— 写设置一律走 `on*`（由 `src/client.js` 提供），本文件只回答"画什么"；
 *   · 浏览器安全（无 import / require / Node API），且不得有顶层可执行语句读 client.js 的 const。
 *
 * 渲染源是**注册表驱动**的：`GLASS_CHILDREN`（`lib/settings-schema.js` 的登记表）+ `childGlassKey()`
 * 决定每个子项有哪些参数、叫什么 ⇒ 这里**不硬编码四项**（硬编码正是"面板渲染死旋钮"的来源，
 * 见 wip §10.12：四个子项曾多出 5 个没人读的键、左侧栏那节还多一行连 schema 键都不存在的滑杆）。
 */
/**
 * 「玻璃 UI」节 —— 全局四件套 + 每个子面的「独立配置」开关（高级配置）。
 *
 * 结构（wip §10.20 之后）：
 *   玻璃 UI
 *   ├─ 全局：玻璃颜色 · 玻璃透明度 · 雾化 · 玻璃保真度
 *   └─ 子 UI 独立配置（不进简化配置）
 *      └─ 每个子面一个开关：[独立配置] ⇒ 打开后展开它自己的参数行
 *
 * ⚠️ **没有"要不要玻璃"的开关**（用户口径）：原先是两级（「子 UI 玻璃」总开关 + 每项开关），
 *    实测那个"关"并**不能**如愿恢复原生黑/白纯色（那些面上还有一批不挂门控的令牌改写），
 *    而要做到"关得像样"得连令牌层一起回退 ⇒ 整层退役（见 `src/glass.js` 的退役说明）。
 *    所以这里剩下的**唯一**问题就是"读自己 还是 跟全局"。
 * ⚠️ 「左侧栏覆盖」**不在**本节的子项里：它的"关"是**恢复背景**（那列回到壁纸原样），
 *    语义不同 —— 它是乙类，独立成项留在「细节」，本节的 `panelOff` 过滤就是为它。
 */
function renderAppearanceGlassSection(ctx) {
  const {
    onBlur, onGlassAlpha, onGlassChildParam, onGlassColor, onGlassFidelity,
    onToggleChildIndependent, childIndependentOn, sel, surface,
    onLeftSidebarGlass, onSidebarAlpha, onSidebarBlur, onSidebarColor,
    onSidebarContentAlpha, onSidebarContentColor, onSidebarGlass,
  } = ctx;
  // ⚠️ **简化配置 vs 复杂配置的边界**（wip §3.4 的用户口径 + 本节 §10.22）：
  //   · **简化配置**（侧边栏那一档）= 全局四件套（颜色 / 透明度 / 雾化 / 保真度）；
  //   · **复杂配置**（设置菜单那一档）= 上述 + **每个子面的「独立配置」层**。
  // 判据是"这一层进不进简化配置"，不是"哪一档更好用"：独立配置是**逐面覆盖全局**的高级动作，
  // 只有设置菜单里才该出现。实测它曾同时出现在两档（用户实测：侧边栏里也有那三个开关）——
  // 那会让"简化配置"悄悄长出四个高级旋钮，与规划不符。
  const sidebarSurface = surface === "sidebar";
  const children = ((typeof GLASS_CHILDREN !== "undefined" && GLASS_CHILDREN) || [])
    // ⚠️ 排除 `panelOff` 的子项：乙类（左侧栏）**不进这一层** ——
    //    它已有自己的总开关「左侧栏覆盖」，而它的"独立配置"耦合在那一项下面
    //    （见本文件「细节」节）。它留在登记表里只为生成 schema 键。
    .filter((c) => !c.panelOff);
  // i18n 词表：**就地包 weT(...)** —— 不能用 `weT(cn.label)` 那种属性访问。
  // i18n 判据是**文本扫描**：它只认出现在 `weT(` 实参里的中文；属性访问看不见 ⇒
  // 词条会全成孤儿、文本也进不了"裸中文"检查。所以词表每一项都直接过 weT。
  // （放在渲染函数内而非模块级：weT 依赖当前语言，必须每次渲染重取。）
  // 两侧靠 `id` 对齐；下面有兜底把"漏了哪个 id"当场画出来（比静默无标签好）。
  // ⚠️ 只有 `hint`（子面的**身份**，挂在「独立配置」那一行上）与各参数文案 ∶
  //    原先还有一个 `label`（子面的开关标签）—— 那个开关随"要不要玻璃"一起退役，
  //    字段随之变成**死数据**，已删（对应的 4 条 i18n 词条也一并清掉，wip §10.23）。
  const CHILD_CN = {
    settingsWindow: {
      hint: weT("整个设置窗口（含全部原生分区）"),
      indep: weT("设置窗口玻璃·独立配置"), color: weT("设置窗口玻璃·玻璃颜色"),
      alpha: weT("设置窗口玻璃·玻璃透明度"), blur: weT("设置窗口玻璃·雾化"),
      fidelity: weT("设置窗口玻璃·玻璃保真度"),
    },
    conversation: {
      hint: weT("输入卡片 / 消息气泡 / 工具弹卡"),
      indep: weT("对话框玻璃·独立配置"), color: weT("对话框玻璃·玻璃颜色"),
      alpha: weT("对话框玻璃·玻璃透明度"), blur: weT("对话框玻璃·雾化"),
      fidelity: weT("对话框玻璃·玻璃保真度"),
    },
    leftSidebar: {
      hint: weT("宿主原生左栏（会话列表 / 工作区那一列）"),
      indep: weT("左侧栏玻璃·独立配置"), color: weT("左侧栏玻璃·玻璃颜色"),
      alpha: weT("左侧栏玻璃·玻璃透明度"), blur: weT("左侧栏玻璃·雾化"),
      fidelity: weT("左侧栏玻璃·玻璃保真度"),
    },
    floaters: {
      hint: weT("插件自己的更新提示 / 壁纸仓库抽屉"),
      indep: weT("浮层玻璃·独立配置"), color: weT("浮层玻璃·玻璃颜色"),
      alpha: weT("浮层玻璃·玻璃透明度"), blur: weT("浮层玻璃·雾化"),
      fidelity: weT("浮层玻璃·玻璃保真度"),
    },
    // ⚠️ 这一面只登记了 `transparency` / `blur` 两个参数（无 color / fidelity：共享面纱
    //    ⇒ 保真度不可达；本面 CSS 也不消费颜色）⇒ 标签只给**真正会渲染**的那几个，
    //    不留"参数不存在却有一份翻译"的死文案（R3a 的同一口径）。
    thinkingTrigger: {
      hint: weT("对话里「思考过程」那一行的入口条"),
      indep: weT("思考触发条玻璃·独立配置"),
      alpha: weT("思考触发条玻璃·玻璃透明度"), blur: weT("思考触发条玻璃·雾化"),
    },
  };
  // ⚠️ 用户口径（wip §10.20）：**"要不要玻璃"这一层退役了** ——
  //   原设计里每个子面先有一个「玻璃」开关（关 = 回到原生不透明纯色），实测那个"关"
  //   并不能如愿恢复原生（那些面上还有一批不挂门控的令牌改写，见 glass.js 的退役说明），
  //   而两级耦合（总开关 + 子开关）本身也让这一节很难读。
  // ⇒ 现在这一节**只剩一层**：每个子面一个「独立配置」开关 —— 它回答的是
  //   "读自己那套参数 还是 跟全局"。要不要玻璃是恒定的（恒要），不再是用户选项。
  const childRows = [];
  for (const c of children) {
    const cn = CHILD_CN[c.id];
    // 登记表与词表必须一一对应：漏一个就整项无标签（比 ReferenceError 更隐蔽）。
    if (!cn) { childRows.push(React.createElement("div", { className: "we-picker__hint", key: "gc-missing-" + c.id }, weT("内部错误：这个子界面缺少文案"))); continue; }
    // 每个子面**直接**一个「独立配置」开关（子面的名字进 `hint`，见词表的 cn.hint）。
    const indep = !!(childIndependentOn && childIndependentOn(c.id));
    childRows.push(switchRow(cn.indep, indep, (e) => onToggleChildIndependent(c.id, e.target.checked), {
      key: "gi-" + c.id,
      hint: cn.hint,
      tooltip: weT("打开后**紧接在本行下方**出现这一项自己的独立配置，**完全覆盖**上面的全局配置；关闭则回到继承全局"),
    }));
    // 独立配置关着 ⇒ 不显示它自己的参数行（默认就是关 ⇒ 默认跟随全局）
    if (!indep) continue;
    const P = (param) => childGlassKey(c.id, param);
    // ⚠️ 按登记表的 `params` 渲染，**不硬编码四项** —— 不是每个子项都拿得到全部参数。
    //    `fidelity` 只有 `conversation` 有：它的面纱有专属的 `--we-chat-readability-*`，
    //    而共享面纱的面受 F2a / F1c 约束、**逐面保真度不可达**（见 wip §4.14）。
    //    硬编码会让那两个面多出一个"点了没反应"的旋钮 —— 正是要消灭的那类死开关。
    if (c.params.blur !== undefined) {
      childRows.push(SliderRow(cn.blur, 0, 60, 1,
        sel[P("blur")], (v) => onGlassChildParam(c.id, "blur", v),
        sel[P("blur")] + "px", "gc-blur-" + c.id));
    }
    if (c.params.transparency !== undefined) {
      childRows.push(SliderRow(cn.alpha, 0, 100, 5,
        sel[P("transparency")], (v) => onGlassChildParam(c.id, "transparency", v),
        sel[P("transparency")] + "%", "gc-alpha-" + c.id));
    }
    if (c.params.fidelity !== undefined) {
      childRows.push(SliderRow(cn.fidelity, 0, 100, 5,
        sel[P("fidelity")], (v) => onGlassChildParam(c.id, "fidelity", v),
        sel[P("fidelity")] + "%", "gc-fid-" + c.id));
    }
    if (c.params.color !== undefined) {
      childRows.push(swatchRow(cn.color, GLASS_COLOR_PRESETS,
        sel[P("color")], (v) => onGlassChildParam(c.id, "color", v), { key: "gc-color-" + c.id }));
    }
  }
  return React.createElement(React.Fragment, null,
  React.createElement("div", { className: "we-picker__section" },
    React.createElement("div", { className: "we-picker__section-head" },
      React.createElement("span", { className: "we-picker__section-label" }, weT("玻璃 UI")),
    ),
    // ── 全局四件套 ──
    // 玻璃颜色: the settings-window glass BASE tint. Defaults keep the stock
    // look (white light / deep navy dark); picking any preset or a custom
    // color tints the whole window glass in BOTH themes.
    swatchRow(weT("玻璃颜色"), GLASS_COLOR_PRESETS, sel.glassColor, onGlassColor, { key: "glass-color" }),
    SliderRow(weT("玻璃透明度"), 0, 100, 5, sel.glassAlpha, onGlassAlpha, sel.glassAlpha + "%"),
    // 「雾化」= 原「玻璃」滑块：控制的只有**模糊半径**（雾面深度），饱和度是解耦的
    // 常量材料属性（见 GLASS_SATURATE）。
    // ⚠️ 覆盖面的实测口径（`.test-cache/blur-selectors.mjs` 复算，按规则头归面）：
    //    它喂的 `--we-blur` 被这些面消费 —— 对话栏一族（输入卡片 / 气泡 / 工具弹卡）、
    //    **左侧栏覆盖**（`data-we-left-sidebar` 那列的 `::before`）、**设置窗口**、
    //    插件自身浮层（更新提示 / 仓库面板）。
    //    而**侧栏**（dsh-better-sidebar 与右栏面板）走的是它**自己的** `--we-sidebar-blur`
    //    （由「侧栏模糊」管）—— 那才是唯一不吃本项的面。
    SliderRow(weT("雾化"), 0, 60, 1, sel.blur, onBlur, sel.blur + "px", "glass-frost", {
      tooltip: weT("玻璃面板（对话栏卡片、左侧栏、设置窗口、插件浮层）的模糊半径 —— 越大越像磨砂玻璃；色彩饱和度不随本滑块变化。侧栏有自己的「侧栏模糊」，不受本项影响"),
    }),
    // 玻璃保真度（默认 100 = 完整可读性红线）：唯一的「颜色 vs 可读」权衡旋钮。
    // 100 = 玻璃色经亮度钳制保正文 ≥4.5:1（深色压暗 / 浅色提亮的现状）；拉低 =
    // 釉色向用户原色线性回退（单调，中间档不会更黑/更白）+ 地板层覆盖度同比例
    // 减薄，正文在极端壁纸上可读性让位；0 = 原色直出不钳制。数学入口
    // weClampSurfaceColor 第三参 + --we-glass-fidelity。
    SliderRow(weT("玻璃保真度"), 0, 100, 5, sel.glassFidelity, onGlassFidelity, sel.glassFidelity + "%", "glass-fidelity", {
      tooltip: weT("100 = 完整可读性红线（默认）：自定义玻璃色经亮度钳制，正文对比度始终 ≥4.5:1 —— 深色主题下颜色被压暗、浅色主题下被提亮。拉低后颜色更贴你选的原色，但正文在极端明暗的壁纸上可能看不清；看不清字时把本项拉回 100，或按「看不清字三步」调节。"),
    }),
    // ⚠️ 这里原本有独立的「对话栏玻璃保真度」旋钮（`chatGlassFidelity`）。**已撤除**
    //    （用户口径）：既然有了「对话框玻璃·独立配置」，同一个"对话栏的保真度"就有两个
    //    入口了 —— 那是两个旋钮控同一件事。现在它**只**由「对话框玻璃·独立配置」下的
    //    「对话框玻璃·玻璃保真度」提供，存储键**复用** `chatGlassFidelity`（D2：不新建
    //    平行键），所以老配置的值不会丢。
    // ── 既有面的**显示开关**与它们的独立配置（原「窗口与侧栏」/「细节」两节并进本节，§10.25）──
    // ⚠️ 为什么并进来：原先这些控件住在「窗口与侧栏」节，而那节**只在宿主上报
    //    `sidebarPresent`（装了 dsh-better-sidebar）时才画得出内容** —— 没装的机器上它就是一个
    //    **只有标题的空节**。而「左侧栏覆盖」原先被刻意排除在「玻璃 UI」之外，理由是它与那节的
    //    "关 = 回原生纯色"（乙类语义）冲突；那一层已在 §10.20 整体退役 ⇒ **冲突消失**，
    //    这些面控件与其余玻璃配置放在一起在语义上更顺（用户口径）。
    // ⚠️ 门槛一个都没放松：`!sidebarSurface`（独立配置层属复杂配置）与 `sidebarPresent` /
    //    `sidebarGlass`（宿主能力与总开关）照旧，所以**简化配置那一档的内容与合并前逐行相同**。
    // 左侧栏覆盖（默认关）：宿主原生左栏在壁纸下只是「透明的洞」，打开后它走同一张配方表。
    // ⚠️ 它**不是**"要不要玻璃"那一类：它的「关」是**恢复背景**（那一列回到壁纸原样）——
    //    所以它是唯一保留的**显示开关**（乙类），与其余面"恒吃玻璃"不同。
    switchRow(weT("左侧栏覆盖"), sel.leftSidebarGlass === true, onLeftSidebarGlass, {
      key: "left-sidebar-glass",
      hint: weT("左侧栏也跟随玻璃配方（配色 / 玻璃颜色 / 透明度 / 雾化 / 边框）"),
      tooltip: weT("宿主原生左侧栏（会话列表 / 工作区那一列）默认直接透出壁纸、不吃玻璃参数。打开后它变成与其余界面同款的玻璃面板，跟随「配色 / 玻璃颜色 / 玻璃透明度 / 雾化 / 边框」；关闭即恢复原生观感。默认关。"),
    }),
    // ⚠️ 用户口径：「左侧栏玻璃·独立配置」**与「左侧栏覆盖」耦合** —— 覆盖关着时它不显示。
    sel.leftSidebarGlass === true && !sidebarSurface && switchRow(weT("左侧栏玻璃·独立配置"),
      !!(childIndependentOn && childIndependentOn("leftSidebar")),
      (e) => onToggleChildIndependent("leftSidebar", e.target.checked), {
      key: "left-sidebar-independent",
      hint: weT("用这一项自己的釉层参数覆盖全局"),
      tooltip: weT("打开后**紧接在本行下方**出现左侧栏自己的两项（玻璃透明度 / 雾化），**完全覆盖**「玻璃 UI」里的全局配置；关闭则回到继承全局。"),
    }),
    // 独立配置开着才出现它自己的两项（默认关 ⇒ 默认跟随全局）。
    // ⚠️ R3a（§10.12）：这里原本是"四件套"，其中**两个是死的** —— `leftSidebarFidelity` 连 schema
    //    键都不存在、`leftSidebarColor` 无人读取（本面 CSS 只读 `--we-left-sidebar-blur/-alpha`）。
    sel.leftSidebarGlass === true && !sidebarSurface && !!(childIndependentOn && childIndependentOn("leftSidebar")) && [
      SliderRow(weT("左侧栏玻璃·玻璃透明度"), 0, 100, 5,
        sel.leftSidebarTransparency, (v) => onGlassChildParam("leftSidebar", "transparency", v),
        sel.leftSidebarTransparency + "%", "ls-alpha"),
      SliderRow(weT("左侧栏玻璃·雾化"), 0, 60, 1,
        sel.leftSidebarBlur, (v) => onGlassChildParam("leftSidebar", "blur", v),
        sel.leftSidebarBlur + "px", "ls-blur"),
    ],
    // 侧栏玻璃（dsh-better-sidebar 适配）：总开关 + 专用模糊 / 透明度 / 玻璃基底色调，
    // 只作用于 dsh-better-sidebar 子树，不动会话玻璃的设置。仅在宿主检测到该插件时显示。
    !sidebarSurface && sel.sidebarPresent && switchRow(weT("侧栏液态玻璃"), sel.sidebarGlass, onSidebarGlass, {
      key: "sidebar-glass-toggle",
      hint: weT("dsh-better-sidebar 侧栏毛玻璃适配"),
      tooltip: weT("dsh-better-sidebar 侧栏（文件 / 终端 / Git 等面板）的毛玻璃适配；关闭则恢复其原生外观"),
    }),
    !sidebarSurface && sel.sidebarPresent && sel.sidebarGlass && [
      // 这两个面的「独立配置」层（§10.24 补的缺口）：`glassMode` 的唯一写入方是
      // `onToggleChildIndependent`，而 `sidebar` / `sidebarContent` 不在登记表里 ⇒ 没有这两个开关
      // 时它们的 mode 永远停在 `'inherit'` ⇒ 下面那 5 个滑块**全是死的**。判据见第 ⑧ 组的 mode 可达性。
      switchRow(weT("侧栏玻璃·独立配置"),
        !!(childIndependentOn && childIndependentOn("sidebar")),
        (e) => onToggleChildIndependent("sidebar", e.target.checked), {
          key: "sb-independent",
          hint: weT("用这一项自己的釉层参数覆盖全局"),
          tooltip: weT("打开后**紧接在本行下方**出现这一项自己的独立配置，**完全覆盖**上面的全局配置；关闭则回到继承全局"),
        }),
      !!(childIndependentOn && childIndependentOn("sidebar")) && [
        SliderRow(weT("侧栏模糊"), 0, 60, 1, sel.sidebarBlur, onSidebarBlur, sel.sidebarBlur + "px", "sb-blur"),
        SliderRow(weT("侧栏透明度"), 0, 100, 1, sel.sidebarAlpha, onSidebarAlpha, sel.sidebarAlpha + "%", "sb-alpha"),
        swatchRow(weT("侧栏玻璃颜色"), GLASS_COLOR_PRESETS, sel.sidebarColor, onSidebarColor, { key: "sb-color" }),
      ],
      // 内容面（编辑器 / 终端，即 dsh-better-sidebar 面板内的内容区）近不透明玻璃底。
      switchRow(weT("内容面玻璃·独立配置"),
        !!(childIndependentOn && childIndependentOn("sidebarContent")),
        (e) => onToggleChildIndependent("sidebarContent", e.target.checked), {
          key: "content-independent",
          hint: weT("用这一项自己的釉层参数覆盖全局"),
          tooltip: weT("打开后**紧接在本行下方**出现这一项自己的独立配置，**完全覆盖**上面的全局配置；关闭则回到继承全局"),
        }),
      !!(childIndependentOn && childIndependentOn("sidebarContent")) && [
        SliderRow(weT("内容面透明度"), 0, 100, 5, sel.sidebarContentAlpha, onSidebarContentAlpha, sel.sidebarContentAlpha + "%", "content-alpha"),
        swatchRow(weT("内容面底色"), GLASS_COLOR_PRESETS, sel.sidebarContentColor, onSidebarContentColor, {
          key: "content-color",
          auto: React.createElement("button", {
            key: "auto",
            className: "we-picker__swatch we-picker__swatch--auto" + (sel.sidebarContentColor === "" ? " we-picker__swatch--active" : ""),
            type: "button",
            title: weT("跟随主题面板色"),
            onClick: () => onSidebarContentColor(""),
            "aria-label": weT("内容面底色 跟随主题"),
          }, weT("主题")),
          colorValue: sel.sidebarContentColor || "#1e1f26",
        }),
      ],
    ],
    // ── 子 UI 独立配置（**复杂配置专属**：侧边栏那一档不画）──
    // 这一节现在是**一层**：每个子面一个「独立配置」开关 —— 开 = 用自己那套参数覆盖全局。
    // ⚠️ 这里**没有**「要不要玻璃」的开关（那一层已退役，见上）：所有子面恒吃玻璃。
    // ⚠️ `sidebarSurface` 的判据见函数开头：独立配置是逐面覆盖全局的高级动作，
    //    按规划只出现在设置菜单里 ⇒ 简化配置那一档**一行都不画**（只剩全局四件套）。
    ...(sidebarSurface ? [] : childRows),
  ),
  );
}

export { renderAppearanceGlassSection };
