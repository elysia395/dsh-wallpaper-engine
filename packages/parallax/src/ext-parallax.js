/**
 * ext-parallax.js — 「扩展」页签**三号模块**（3D 效果）的扩展岛。
 *
 * ══ 它是什么 ══════════════════════════════════════════════════════════════════
 * 一个**模块描述符**（形状 `{ id, title, desc?, render? }`，契约写在 src/panel-tabs.js 的
 * `extensionModules()` 上方）：panel-tabs 只负责把它排在「扩展」页签里，具体的控件与文案
 * 全在本文件。视差本体在 `src/parallax-layer.js`（只有变量与事件、不建 DOM），设置项的
 * 真源在 `lib/settings-schema.js` 的 11 个 `parallax*` 键。
 *
 * 契约：
 *   需要的外界：`ctx`（由 `src/client.js` 在 `renderExtensionsTab({...})` 的调用点组装）——
 *     `sel` + 一组具名 `on*` 处理器 + `parallaxPluginSlots`（认到的插件槽位名单）；扁平可用的
 *     渲染助手 `React` / `weT` / `switchRow` / `SliderRow`（后三个住在 `src/client.js` 正文，
 *     函数体内调用没问题）。
 *   对外提供：`PARALLAX_EXTENSION_MODULE`（注册表项）。
 *
 * 不变量：
 *   · **模块不得自己写设置 / 发通知 / 持有状态**（panel-tabs 的注册表契约）：本文件里
 *     不出现任何设置写入 / 通知发送 / `selection` 读取，一个动作一个 `on*` 处理器。
 *   · **只从一个参数取外界**：`renderParallaxIsland(ctx)`，函数体第一行解构。
 *   · 参数的可调范围与默认值**不在这里写死**：`SliderRow` 的 min/max/step 与设置白名单的
 *     KINDS 一致（改范围要同时看 lib/settings-schema.js —— 那份是唯一真源）。**例外是插件槽位
 *     那一档**：它不在 KINDS 里（`parallaxPluginDepths` 是 map 档，宿主不校验值）⇒ 那一档的
 *     缺省值直接读 `src/parallax-layer.js` 的 `PARALLAX_PLUGIN_DEFAULT`，回显的钳制范围也读层
 *     同一对常量 `PARALLAX_GROUP_DEPTH_MIN` / `PARALLAX_GROUP_DEPTH_MAX`，不另外抄数（层与面板
 *     必须对"没这一行时算多少 / 越界值算多少"给出同一个答案；单独 import 本文件的测试要给这
 *     三枚符号补替身，见 test/verify-scene-live.mjs 的岛那一段）。
 *   · 关掉总开关时只画总开关 + 一句说明（避免"关着还能拖参数"的错觉）；同理，某一类自己的
 *     开关关着时那一类只画它的开关（插件前端那一类关着时连槽位名单都不画 —— 层那时也确实
 *     一个组都不认，见 src/client.js 的 `parallaxPluginSlots`）。
 *   · 控件分三类（用户口径 m02697-③）：**背景**（壁纸 + 吉祥物）→ **原生前端**（界面整块 +
 *     四个区域距离）→ **插件前端**（运行期认到的、别的插件注册进来的元素组），全局的
 *     「缓动平滑」留在最后。分类标题自己拼 `we-picker__section*` 那三件套（同 src/panel-tabs.js
 *     的分组写法）。**三类各有自己的开关**（用户诉求 m03549："把插件前端也单独归类加开关"）：
 *     「吉祥物跟随」/「界面元素跟随」/「插件前端跟随」—— 插件那个**独立于界面跟随**（不是
 *     `ui &&`：只开它能动、只开界面跟随它不动）、默认关，因为它挪的是别的插件画出来的真实界面。
 *   · 所有距离的单位都是**同一条**（用户口径 m02697-①）：**最大位移 = 屏幕最长对角线的百分比**
 *     —— 光标贴到屏幕角上时，该层最多挪出对角线长度的百分之几。0 = 该层完全不动（用户口径
 *     m02697-③）。存档与面板从此同一个单位，不再有"面板说百分比、存档说倍率"的换算。
 *   · **方向不是设置项**：壁纸与吉祥物的口径是"关于屏幕中心对称"（光标在右上 ⇒ 整块往左下）、
 *     界面整块与壁纸**同向**（用户口径 m01371："希望输入框和背景同向运动" ⇒ 像镜头横移，近处
 *     多走一点），要换向改 src/parallax-layer.js 的 `PARALLAX_DIRECTION` / `PARALLAX_UI_SIGN`。
 *   · 界面那一组的距离**各自独立**（用户口径 m01915-①：「各个区域的缓动距离支持单独调节」的
 *     升级版）：总倍率 `parallaxUiDepth` 已退役（用户口径 m02697-①③），四个区域键就是四组各自
 *     的绝对距离。它动的是真实界面，所以默认关。
 */

/** 一张分组卡：标题 + 若干行（同 src/panel-tabs.js 里 `we-picker__section` 那三件套的写法）。 */
function parallaxSection(label, key, rows) {
  return React.createElement("div", { className: "we-picker__section", key: key },
    React.createElement("div", { className: "we-picker__section-head" },
      React.createElement("span", { className: "we-picker__section-label" }, label)),
    rows);
}

/** 插件槽位那一行的回显值：**没那一行**（或值不是数）时按层的缺省算，显式的 0 要留着显示成 0
 *  （0 = 这一组不缓动，与"没调过"是两件事）。越界值按层同一对常量钳制（见下面注释）。 */
function parallaxPluginPercent(v) {
  const n = Number(v);
  if (v === null || v === undefined || v === "" || !Number.isFinite(n)) return PARALLAX_PLUGIN_DEFAULT;
  // 与层同源钳制（公共钳位 `weClampTo`，见 src/we-base.js）⇒ 回显的数字就是真正生效的数字。
  // 触发面很窄：只有手改 settings.json / 跨版本 / 第三方往这个 map 里塞了越界值才会遇上；那时
  // 层按 [MIN, MAX] 生效，回显要是照原样显示 42% / -5% 就成了"滑杆拖到头、数值在说谎"。
  return Math.min(PARALLAX_GROUP_DEPTH_MAX, Math.max(PARALLAX_GROUP_DEPTH_MIN, n));
}

/**
 * 扩展岛：总开关 → 背景（距离 + 吉祥物开关）→ 原生前端（界面元素跟随 + 四个区域距离）
 * → 插件前端（自己的开关 + 认到的槽位各一行）→ 缓动平滑。
 * @param {{sel:object, parallaxPluginSlots?:string[]}} ctx 见文件头契约
 */
function renderParallaxIsland(ctx) {
  const { sel, onParallaxEnabled, onParallaxBg, onParallaxMascot, onParallaxUi, onParallaxPlugin,
    onParallaxUiChatDepth, onParallaxUiComposerDepth, onParallaxUiSidebarDepth,
    onParallaxUiBubbleDepth, onParallaxPluginDepth, parallaxPluginSlots, onParallaxSmooth } = ctx;
  const on = sel.parallaxEnabled === true;
  const ui = on && sel.parallaxUi === true;
  const pluginOn = on && sel.parallaxPlugin === true;
  const slots = pluginOn && Array.isArray(parallaxPluginSlots) ? parallaxPluginSlots : [];
  const depths = (sel.parallaxPluginDepths && typeof sel.parallaxPluginDepths === "object"
    && !Array.isArray(sel.parallaxPluginDepths)) ? sel.parallaxPluginDepths : {};
  return React.createElement(React.Fragment, null,
    switchRow(weT("启用 3D 效果"), on, onParallaxEnabled, { key: "parallax-on" }),
    React.createElement("span", { className: "we-picker__hint", key: "parallax-what" },
      weT("光标移动时，壁纸与吉祥物沿屏幕中心的对称方向轻轻偏移；界面整块默认不动（要一起动就打开下面的「界面元素跟随」）")),
    // ── 背景：壁纸那一层与挂在它上面的吉祥物 ──────────────────────────────
    on && parallaxSection(weT("背景"), "parallax-sec-bg", [
      // 距离的单位是**最长对角线的百分比**：光标贴到屏幕角上时，这一层最多挪 pct% 个对角线
      // （壁纸额外放大 1 + pct/50 补边，见 src/parallax-layer.js 文件头）。
      SliderRow(weT("背景缓动距离"), 0, 10, 0.1, sel.parallaxBg, onParallaxBg, "%", "parallax-bg",
        { tooltip: weT("光标贴到屏幕角时，壁纸挪动的距离占屏幕最长对角线的百分比（壁纸会同时放大同样多，免得边上露出底色）") }),
      switchRow(weT("吉祥物跟随"), sel.parallaxMascot !== false, onParallaxMascot,
        { key: "parallax-mascot", hint: weT("挂件也按「背景缓动距离」一起挪") }),
    ]),
    // ── 原生前端：宿主自己的界面整块 + 四个区域各自的绝对距离 ──────────────
    on && parallaxSection(weT("原生前端"), "parallax-sec-native", [
      switchRow(weT("界面元素跟随"), sel.parallaxUi === true, onParallaxUi,
        { key: "parallax-ui", hint: weT("输入卡片、会话文本区（连里面的用户气泡一起）与侧栏作为整块跟着挪：文字与底下的玻璃一起动") }),
      // 四个区域各自的**绝对**最大位移百分比（用户口径 m02697-①③）：存档与面板同一个单位，
      // 0 = 这一组完全不跟。用户气泡那一行是**叠加**在会话文本区之上的额外距离。
      ui && SliderRow(weT("会话文本区距离"), 0, 10, 0.1, sel.parallaxUiChatDepth, onParallaxUiChatDepth,
        "%", "parallax-ui-chat-depth",
        { tooltip: weT("长回复所在的整块文本区自己的最大位移：光标贴到屏幕角时它最多挪出屏幕最长对角线的百分之几（0 = 这一组完全不跟）") }),
      ui && SliderRow(weT("输入卡片距离"), 0, 10, 0.1, sel.parallaxUiComposerDepth, onParallaxUiComposerDepth,
        "%", "parallax-ui-composer-depth",
        { tooltip: weT("底部输入卡片自己的最大位移：默认比文本区大一点，看着更靠前、纵深更明显（0 = 这一组完全不跟）") }),
      ui && SliderRow(weT("侧栏距离"), 0, 10, 0.1, sel.parallaxUiSidebarDepth, onParallaxUiSidebarDepth,
        "%", "parallax-ui-sidebar-depth",
        { tooltip: weT("左侧栏自己的最大位移：它比文本区更靠后，想让它更沉就调小（0 = 这一组完全不跟）") }),
      ui && SliderRow(weT("用户气泡距离"), 0, 10, 0.1, sel.parallaxUiBubbleDepth, onParallaxUiBubbleDepth,
        "%", "parallax-ui-bubble-depth",
        { tooltip: weT("你的消息气泡在会话文本区之外「再多走」的一份距离：0 = 气泡只跟着文本区一起动，调大就比周围的回复更靠前") }),
    ]),
    // ── 插件前端：运行期认到的、别的插件注册进来的元素组（用户口径 m02697-②）────
    //    这一块有**自己的开关**（用户诉求 m03549：插件前端单独归类加开关）：独立于上面那个
    //    「界面元素跟随」、默认关 ⇒ 关着时这一张卡只有它自己的开关（同"关着还能拖参数"那条不变量）。
    on && parallaxSection(weT("插件前端"), "parallax-sec-plugin", [
      switchRow(weT("插件前端跟随"), sel.parallaxPlugin === true, onParallaxPlugin,
        { key: "parallax-plugin", hint: weT("别的插件注册进来的界面元素组（比如任务看板、市场面板）也跟着挪；默认关 —— 它动的是它们的真实界面") }),
      pluginOn && (slots.length
        ? React.createElement("span", { className: "we-picker__hint", key: "parallax-plugin-hint" },
          weT("下面是运行期认到的、由别的插件注册进来的前端元素组（槽名就是它的身份）：一行一个，0 = 这一组完全不跟。组里出现固定在屏幕上的元素（下拉、浮层一类）时，这一组整组都不跟"))
        : React.createElement("span", { className: "we-picker__hint", key: "parallax-plugin-hint-empty" },
          weT("还没认到别的插件注册的前端元素组：等它们的界面出现后，这里会自动多出对应的行"))),
      pluginOn && slots.map((slot) => SliderRow(slot, 0, 10, 0.1, parallaxPluginPercent(depths[slot]),
        (v, live) => onParallaxPluginDepth(slot, v, live), "%", "parallax-plugin-" + slot,
        { tooltip: weT("这一组自己的最大位移：光标贴到屏幕角时它最多挪出屏幕最长对角线的百分之几（0 = 这一组不缓动）。组里出现固定在屏幕上的元素（下拉、浮层一类）时，这一组整组都不跟") })),
    ]),
    on && SliderRow(weT("缓动平滑"), 0, 98, 1, sel.parallaxSmooth, onParallaxSmooth, "%", "parallax-smooth",
      { tooltip: weT("0 = 立刻跟手，越大越柔和（跟得越慢、停下后还会飘一小段才归位）") }),
  );
}

/** 「扩展」页签的三号模块（注册表项；`id` 是 React key，改它会让面板重挂一次）。
 *  `title` / `desc` 与另外两个模块同一条理由写成 getter（渲染时才取译文，见 panel-tabs 的契约）。 */
const PARALLAX_EXTENSION_MODULE = {
  id: 'parallax',
  // 屏上位置（与 avatar=1 / fx=2 对齐）：三份 bundle 的求值顺序不保证，
  // 「扩展」页签由 panel-tabs 的注册表按 (order, 注册序) 排序，不能靠注册先后。
  order: 3,
  // 模块级重置的分组名（issue #192）：键集住在 lib/settings-schema.js 的 RESET_GROUPS。
  resetGroup: 'parallax',
  get title() { return weT("3D 效果"); },
  get desc() { return weT("光标移动时，壁纸与吉祥物沿屏幕中心的对称方向轻轻偏移，界面整块则与壁纸同向轻挪（视差纵深）"); },
  render: renderParallaxIsland,
};

export { PARALLAX_EXTENSION_MODULE, renderParallaxIsland };
