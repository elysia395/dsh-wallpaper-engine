/**
 * client.js —— 玻璃子包的**浏览器半边**入口（ADR-0016 第二刀：设置面板节随包走）。
 *
 * ⚠️ 归属（与 packages/fonts/src/client.js 同一条，正本 = ADR-0013 D20 / ADR-0016 D3）：
 *    随包走的是**渲染器与描述符**；玻璃的**键、默认值、kind、消毒、迁移、持久化**仍在主包
 *    `lib/settings-schema.js`（GLASS_CHILDREN 登记表 + childGlassKey + RESET_MODULES.glass）⇒
 *    本包**不持键、不持久化**；值与意图回调一律经主包构造的渲染 ctx 或下面的 host 显式键集拿到。
 *    预设是整机快照（ADR-0011）：路由族与 preset-store 留主包，本包只画 `glassPresets` ctx 交给的卡片。
 *
 * ## 构建期形状（与 packages/fonts/src/client.js 逐条同形）
 *   · 产物 = packages/glass/lib/client.glass.js，id = 子包真实包名 dsh-plugin-wallpaper-engine-glass
 *     （与宿主 graph row 逐字相等）；入口 = 本文件，正文只取**首个块注释之后**的内容。
 *   · 本包的 INLINE_MODULES（client.build.json 的 inline[]）内联在正文之前 ⇒ 兄弟文件与入口落在
 *     **同一个工厂作用域**：互相按裸名引用，不 import、不 require、不许 `...host` 展开、不许动态键。
 *   · 唯一例外 = 产物里由构建循环 outline 发出的那一行 `const host = require('<主包名>');`（S5.2）。
 *
 * ## 消费侧契约（唯一跨包通道 = 主 bundle 的显式键集，ADR-0014 S5.1 / S5.4）
 * GLASS_HOST_REQUIRED 与主包 `src/client.js` 的 HOST_BRIDGE_BINDINGS 玻璃段**逐键一致**（缺键大声抛，
 * 不许静默 undefined）。键集依据 = 被搬文件（第二刀 glass-panel.js + 第三刀 glass.js /
 * glass-surfaces.js / glass-extra.js / glass-layer.js）的**自由标识符**逐个点名（fonts 同款 acorn 取证）：
 *   · 面板半边（第二刀）：React×65 · weT×176 · SliderRow×14 · switchRow×15 · swatchRow×6 · ctlText×5
 *     · sectionHead×2 · moduleResetButtonNode×1 · renderConfirmRow×1 · GLASS_CHILDREN×2
 *     · childGlassKey×1 · GLASS_COLOR_PRESETS×6 · ROPE_FORMS×2 · ROPE_FORM_VALUES×1 · panelGlassPair×1
 *     （panelGlassPair 原是 glass-panel 的本地副本；第二刀发现主包写路径也要它 ⇒ 归位
 *     lib/settings-schema.js 的显示口径，与 readGlassColors 同族，经桥接取同一份防漂移。）
 *   · 运行时半边（第三刀）：selection · skinYieldActive · weClampSurfaceColor · glassColorOf
 *     · sanitizeExtraGlassSelectors · GLASS_SATURATE · useLegacySaturateCoupling · apiUrl
 *     （apiUrl = 行状态轮询的同一源地址，见下方「行状态机」）
 *     （weClampSurfaceColor / glassColorOf 的家留主包 effects.js —— verify-readability 从主包
 *     产物抽它们复算 ⇒ 主包同作用域直取、本包经这里取同一份防漂移。）
 *   ⇒ 其中 React / weT / switchRow / SliderRow / swatchRow / ctlText / sectionHead /
 *   registerLayerHooks 是 fx / fonts 那半已要过的键，**复用、不重复登记**。
 *   ⚠️ 每多一个键就是多一条没人维护的隐式契约（ADR-0014 S5.2）⇒ 清单之外一个都**不**解构。
 *
 * ## 每渲染才存在的值走 ctx，不走键集（契约 §2.1）
 * sel / glassPresets / surfaceStatus / childIndependentOn / detailOpen / glassUiOpen / glassDetailOpen /
 * presetSectionOpen 与全部 on* 处理器仍由主包在**渲染处**构造 ctx 传进来（设置页 renderActiveTab
 * 与侧栏 quick-panel 两处，经 renderAppearanceTab 同一条路）；本包不缓存、不自建订阅（ADR-0014 S6.3）。
 */

/**
 * 缺键**大声失败**（ADR-0014 S5.1 / S5.4 显式键集 + ADR-0013 D3③「宁可显示、不可静默消失」）。
 * 主包被关 ⇒ 本 bundle 根本不会被 require（ADR-0014 S7.2 连坐）；能走到这里却缺键 = 键集与申报表脱钩。
 */
const GLASS_HOST_REQUIRED = [
  // 内核与渲染助手（主 bundle 的共享零件表；后四个与 fx / fonts 复用）
  'React', 'weT', 'SliderRow', 'switchRow', 'swatchRow', 'ctlText', 'sectionHead',
  // 玻璃域的产地数据 / 构件（留在主包的文件里；panelGlassPair 的家 = lib/settings-schema.js）
  'moduleResetButtonNode', 'renderConfirmRow',
  'GLASS_CHILDREN', 'childGlassKey', 'GLASS_COLOR_PRESETS', 'panelGlassPair',
  'ROPE_FORMS', 'ROPE_FORM_VALUES',
  // 运行时半边（第三刀）：store 活绑定 + 主包侧的纯函数内核与常量 + 状态路由轮询的同源地址
  'selection', 'skinYieldActive', 'weClampSurfaceColor', 'glassColorOf',
  'sanitizeExtraGlassSelectors', 'GLASS_SATURATE', 'useLegacySaturateCoupling', 'apiUrl',
  // 贡献面（主 bundle 的收件箱）：面板节 + 行为层 + 状态投影回传
  'registerPanelSection', 'registerLayerHooks', 'registerGlassStatus',
];
for (const key of GLASS_HOST_REQUIRED) {
  if (!(key in host)) {
    throw new Error('[wallpaper-engine-glass] 主 bundle 键集缺少 "' + key
      + '"（ADR-0014 S5.1 / S5.4 显式键集：要么补键，要么改申报表，不许静默 undefined）');
  }
}
const {
  React, weT, SliderRow, switchRow, swatchRow, ctlText, sectionHead,
  moduleResetButtonNode, renderConfirmRow,
  GLASS_CHILDREN, childGlassKey, GLASS_COLOR_PRESETS, panelGlassPair,
  ROPE_FORMS, ROPE_FORM_VALUES,
  selection, skinYieldActive, weClampSurfaceColor, glassColorOf,
  sanitizeExtraGlassSelectors, GLASS_SATURATE, useLegacySaturateCoupling, apiUrl,
  registerPanelSection, registerLayerHooks, registerGlassStatus,
} = host;

/* ===== 唯一的跨包登记：外观页签第三节「玻璃 UI」＋ 首节「主题预设」 ===== */

// 主包 src/panel-tabs.js 的 renderAppearanceTab 在「细节」之后调 renderAppearanceGlassSection ——
// 第二刀起那个名字在主包侧是一枚**注册表占位桩**（按 id 从 wePanelSectionsOf('appearance') 取
// 本描述符的 render），所以屏上位置（主题 → 细节 → 玻璃 UI → 侧栏圆角 → 全局 UI 配色 → 全局字体）
// **不变**；主包尾部的 registered 续接列表会排除自有内置位的本节（不双重渲染）。
// 两个硬口径（与 fonts 同款）：
//   ① `title` 必须是 **getter**：注册发生在 bundle 求值期，那时 i18n 表/`weT` 都还没到位；
//   ② 不写 `order`：本节的位置由主包的内置桩锚定，不参与注册表排序（fonts 落默认位 100 是
//      因为它在尾部；本节不同 —— 排序值没人读，写了反而误导）。
// 注册表为空（本行未装 / 被关）⇒ 主包占位桩返回 null ⇒ 缺的是这一节，不是这一页（D3①/D3③）。
/* ===== 玻璃样式表注入（ADR-0016 第四刀）===== */

// 与主包 ensurePluginCss 同款（src/client.js）：求值期把 CSS_GLASS 写进本包自己的
// <style data-plugin-css> 标签。时序保证层叠正确：loader 先求值主 bundle（它的 sheet 先进
// head），再求值本 bundle ⇒ 玻璃 sheet 排在后，与搬移前「玻璃配方压令牌映射、回退块压配方」
// 的相对顺序同构。同 id 旧标签按当前内容刷新（HMR / 重载不叠层）。
// 玻璃行停用 ⇒ 本 bundle 不被加载 ⇒ sheet 整体消失 + 门控属性无人写 ⇒ 宿主回原生。
function ensureGlassCss() {
  if (typeof document === "undefined") return null;
  const TAG = "dsh-wallpaper-engine/glass";
  let tag = document.querySelector("style[data-plugin-css=" + JSON.stringify(TAG) + "]");
  if (tag === null) {
    tag = document.createElement("style");
    tag.dataset.plugin = "dsh-wallpaper-engine";
    tag.dataset.pluginCss = TAG;
    (document.head || document.documentElement).appendChild(tag);
  }
  if (tag.textContent !== CSS_GLASS) tag.textContent = CSS_GLASS;
  return tag;
}
ensureGlassCss();

/* ===== 行状态机（ADR-0016：行级开关「即时生效」，无需重启宿主）===== */

// 桌面宿主的行开关不触发运行中页面的客户端重载 ⇒ 停用玻璃行后，本 bundle（样式表 + 行为层）
// 会留在内存里继续生效。宿主半边为此注册了 `glass-row` 状态路由（GET <base>/glass-row-state）：
// **路由的存在性 = 本行启用**（行停用 ⇒ fiber 被宿主 prune ⇒ 路由 404）。本状态机每 3 秒探测
// 一次，按结果自行挂载 / 中性化：
//   停用 ⇒ 撤样式表 + disposeGlassLayer()（门控属性与 --we-* 变量整族摘除）⇒ 宿主回原生，
//           设置节停渲染、状态投影清空；
//   重新启用 ⇒ 原样恢复（样式表回注 + sync 重跑）。
// 探测失败（宿主重启中 / 网络抖动）⇒ 保持现状等下一轮，不许抖动。页面隐藏时暂停轮询。
let glassRowDisabled = false;
let glassRowProbeBusy = false;
let glassRowMisses = 0; // 连续 404 计数（首启窗口：bundle 求值可早于行路由注册）

/**
 * 启用态的**现场哨兵**：玻璃样式表 + 四枚恒挂门控（applyGlass 无条件写出的那四枚）。
 * 任何一枚缺席 = 玻璃被本状态机以外的途径摘过 ⇒ 调和路径要补。
 *
 * 与下面 nudge / resync 那批（上游 9ea0d4e6）互补而非重叠：那批修的是「开关切换这次
 * 动作没走完」（提前提交状态 ⇒ 后续探测早退、永不重试）；这里修的是「**没有任何动作**，
 * 现场却被外部改掉」（宿主侧文档重建 / 别的 <style> 清理 / 行图重装窗口里的半次拆卸）——
 * 那种情况下 applyGlassRowState 根本不会被调用，状态位一直是 false、探测一直返回 200。
 * 实测：带外摘掉 sheet 后连续 45 轮 200 探测无一恢复，右栏与内容面整页裸壁纸，
 * 只有刷新页面才好（2026-10-30 PR #289 首启报障现场）。
 */
function glassRowSceneIntact() {
  if (typeof document === 'undefined' || !document.body) return true; // 无文档无从谈起：按完好，探测外层自会守
  // 让路态（skin yield）不是残缺：glass 为了让皮肤上台，会**主动**摘掉下面四枚门控
  // （packages/glass/src/glass.js 的 skinYieldActive 分支）。此时若照常判“缺门控 ⇒ 要补”，
  // 3s 调和会反复把门控写回去、和皮肤互相拆台；按“完好”返回，让让路态安静到退场。
  if (typeof skinYieldActive === 'function' && skinYieldActive()) return true;
  return !!document.querySelector('style[data-plugin-css="dsh-wallpaper-engine/glass"]')
    && document.body.hasAttribute('data-we-glass-page')
    && document.body.hasAttribute('data-we-glass-chat')
    && document.body.hasAttribute('data-we-glass-window')
    && document.body.hasAttribute('data-we-glass-floaters');
}

/**
 * 行开关不会重载页面：右栏的模糊由 `[data-we-surface-plate]` 的 backdrop-filter 承载，
 * 删除 / 回注样式表后 Chromium 可能沿用旧的滤镜纹理（右栏大面最明显，表现为一层
 * “损坏滤镜”，整页刷新才恢复）。这里对**插件自己的装饰叶**做两帧合成微推（与主包
 * nudgeWallpaperRepaint 同一手法）：will-change + translateZ 只维持两帧，最终样式不变。
 *
 * ⚠️ 绝不能把宿主右栏面板写进这个集合：`weSurfaceGeometry()` 从 target 自身开始检查
 * 静态 transform / will-change，哪怕两帧的 `translateZ(0)` 也会把 safeRoot 判死；
 * 更糟的是旧实现每次调用都重新捕获“原值”，多个补同步定时点重叠时会把上一步的
 * 临时 `translateZ(0)` 当成原值恢复，永久留下内联 transform ⇒ 关插件→开右栏→
 * 开插件后右栏退回 `--we-panel-color` 纯色，切走再切回仍纯色，只有整页刷新才恢复。
 * 这里推 `[data-sidebar-right-panel][data-sidebar-right-open]`（宿主可见载体）与
 * `[data-we-surface-plate]` / `[data-we-surface-root]`（本插件装饰叶），但宿主载体
 * 只在**合成微推的两帧内**带 `data-we-nudge` 标记；`weSurfaceGeometry()` 只对
 * “target 自身 + data-we-nudge”豁免静态 transform / will-change，其余祖先一律照旧。
 * 这样既保留修“损坏滤镜”所需的合成层重建，又不会让微推把 safeRoot 判死。
 * 单例会话合并重叠调用：原值只捕获一次，最后一次清理统一恢复。
 */
let glassNudgeSession = null;
let glassRightNudgePending = false;
let glassRightNudgeWatch = null;
let glassRightNudgeWatchTimer = 0;

/**
 * 行开关发生在右栏**关闭**状态时，启用瞬间没有可微推的宿主面板；等用户稍后打开右栏，
 * 如果不补一次合成层重建，仍可能看到旧滤镜纹理（“关闭又开启、未刷新”的偏色形态）。
 * 这里用短命 MutationObserver 等第一次可见 open 面板，补一次微推后立刻自拆；3s 探测
 * 再兜一层底，避免观察器被隐藏页/长会话拖住。
 */
function nudgePendingRightPanel() {
  if (!glassRightNudgePending || glassRowDisabled) return false;
  try {
    if (!document.querySelector('[data-sidebar-right-panel][data-sidebar-right-open]')) return false;
    glassRightNudgePending = false;
    stopPendingRightNudgeWatch();
    nudgeGlassPlateLayers();
    return true;
  } catch { return false; }
}

function stopPendingRightNudgeWatch() {
  try { if (glassRightNudgeWatch) glassRightNudgeWatch.disconnect(); } catch { /* ignore */ }
  glassRightNudgeWatch = null;
  if (glassRightNudgeWatchTimer) { clearTimeout(glassRightNudgeWatchTimer); glassRightNudgeWatchTimer = 0; }
}

function watchPendingRightPanel() {
  if (!glassRightNudgePending || glassRightNudgeWatch || typeof MutationObserver === 'undefined') return;
  if (nudgePendingRightPanel()) return;
  try {
    glassRightNudgeWatch = new MutationObserver(() => { nudgePendingRightPanel(); });
    glassRightNudgeWatch.observe(document.documentElement, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-sidebar-right-open', 'hidden'],
    });
    // 兜底：15s 后拆观察器；之后若才开右栏，由 3s 探测的 nudgePendingRightPanel 兜。
    glassRightNudgeWatchTimer = setTimeout(() => {
      glassRightNudgeWatchTimer = 0;
      if (glassRightNudgePending) stopPendingRightNudgeWatch();
    }, 15000);
  } catch { /* 没有 MutationObserver 时交给探测路径 */ }
}

/** 上一轮微推的清理若因页面隐藏 / 帧调度丢失，先按“我们自己的临时形态”还原，绝不把它
 *  当成宿主原值保存下来（否则宿主面板会永久停留在合成层，玻璃纹理可能持续发花）。 */
function clearStaleGlassNudge() {
  try {
    for (const el of document.querySelectorAll('[data-we-nudge]')) {
      el.removeAttribute('data-we-nudge');
      if (el.style.transform === 'translateZ(0)' && el.style.willChange === 'transform') {
        el.style.removeProperty('transform');
        el.style.removeProperty('will-change');
      }
    }
  } catch { /* ignore */ }
}

function nudgeGlassPlateLayers() {
  try {
    if (typeof document === 'undefined' || !document) return;
    // 先把旧实例/旧轮次留下的孤儿装饰根收掉，避免一次微推把 9 层 plate 一起推成
    // “饱和度/对比度爆表”；prune 是幂等的。
    if (typeof pruneGlassSurfaces === 'function') pruneGlassSurfaces();
    const nodes = document.querySelectorAll(
      '[data-sidebar-right-panel][data-sidebar-right-open], [data-we-surface-plate], [data-we-surface-root]');
    if (!nodes.length) return;
    if (glassNudgeSession === null) {
      clearStaleGlassNudge();
      glassNudgeSession = { before: new Map(), token: 0 };
    }
    const session = glassNudgeSession;
    for (const el of nodes) {
      if (!session.before.has(el)) {
        session.before.set(el, {
          transform: el.style.transform,
          willChange: el.style.willChange,
          nudge: el.hasAttribute('data-we-nudge'),
        });
      }
      el.setAttribute('data-we-nudge', 'on');
      el.style.setProperty('will-change', 'transform');
      el.style.setProperty('transform', 'translateZ(0)');
    }
    try { void document.body.getBoundingClientRect(); } catch { /* ignore */ }
    const token = ++session.token;
    let fallback = 0;
    const clear = () => {
      if (glassNudgeSession !== session || session.token !== token) return;
      if (fallback) clearTimeout(fallback);
      glassNudgeSession = null;
      for (const [el, prev] of session.before) {
        try {
          if (prev.willChange) el.style.setProperty('will-change', prev.willChange);
          else el.style.removeProperty('will-change');
          if (prev.transform) el.style.setProperty('transform', prev.transform);
          else el.style.removeProperty('transform');
          if (!prev.nudge) el.removeAttribute('data-we-nudge');
        } catch { /* ignore */ }
      }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(clear));
    // 双 rAF 在标签页隐藏/节流时可能迟迟不跑；兜底超时保证合成提示不会常驻。
    fallback = setTimeout(clear, 160);
  } catch { /* 合成微推失败不影响开关本身 */ }
}

let glassSurfaceResyncToken = 0;

/**
 * 行开关不重载页面：右栏可能在停用期间被打开/重排，回注样式时表面管理器量到的
 * 面板集合/几何可能还停在原生布局。启用后按几个时间点再对齐表面（幂等），
 * 保证“关插件→开右栏→开插件”这类顺序也能把右栏认领回玻璃面。
 */
function resyncGlassSurfacesAfterRowToggle() {
  const token = ++glassSurfaceResyncToken;
  for (const ms of [0, 120, 320, 700]) {
    setTimeout(() => {
      if (token !== glassSurfaceResyncToken || glassRowDisabled) return;
      try {
        if (typeof syncGlassSurfaces === 'function') syncGlassSurfaces(selection);
        nudgeGlassPlateLayers();
        nudgePendingRightPanel();
      } catch { /* 下一时间点/下一轮探测重试 */ }
    }, ms);
  }
}

function applyGlassRowState(disabled) {
  if (disabled === glassRowDisabled) {
    if (disabled) return; // 已是停用态：不重复撤（dispose 幂等，但没必要跑）
    // ── 启用态的调和（reconcile）─────────────────────────────────────────────
    // 状态位是 false ≠ 现场完好：样式表 / 门控可能被**本状态机以外**的途径摘走
    // （宿主侧文档重建 / 行图重装窗口里的半次拆卸 / 任何未知来源的 <style> 清理）。
    // PR #289 前玻璃 CSS 住主包 sheet（每次重挂 ensurePluginCss 都会重注 + 代际清理）
    // ⇒ 出户后本状态机是玻璃在页面里**唯一的管家**，只认"状态位没变"会把任何一次
    // 带外残缺变成**本页面余生的永久破损**（真机取证见 glassRowSceneIntact 的注释）。
    // 200 = 行活着的权威信号 ⇒ 就地核实、缺哪补哪；健康态这条路径**零写入**
    // （一个 querySelector + 四个 hasAttribute）。
    if (glassRowSceneIntact()) return;
    try {
      ensureGlassCss();
      applyGlassLayer();
      if (typeof syncGlassSurfaces === 'function') syncGlassSurfaces(selection);
    } catch { /* 调和失败不外抛：下一轮探测再对时。 */ }
    return;
  }
  // ⚠️ 不要提前写状态：一旦 apply/dispose 中途抛错（宿主右栏正在重排、表面管理器
  // 拿不到几何等），下面的 catch 会把错误吞掉；提前写状态会让后续 3s 探测直接
  // early-return、永不重试 —— 表现就是“开关后右栏一层坏滤镜，刷新才恢复”。
  // 成功走完再提交状态，失败保持原状态，下一轮探测会重新执行整段。
  try {
    if (disabled) {
      // 撤样式表 + 跑行为层的 dispose（门控属性 / --we-* 变量 / 额外补雾化标签成对收走）
      // ⇒ 宿主立即回到原生外观；sync 在停用期间是空操作，不会再写任何东西。
      glassRightNudgePending = false;
      stopPendingRightNudgeWatch();
      const tag = document.querySelector('style[data-plugin-css="dsh-wallpaper-engine/glass"]');
      glassSurfaceResyncToken += 1;
      if (tag) tag.remove();
      disposeGlassLayer();
      try { if (typeof disposeGlassSurfaces === 'function') disposeGlassSurfaces(); } catch { /* 已由 disposeGlassLayer 兜底 */ }
      nudgeGlassPlateLayers();
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => {
        if (glassRowDisabled) nudgeGlassPlateLayers();
      });
    } else {
      // 行开关不重载页面：启用前强制丢弃上一轮表面状态（可能残留旧装饰根/标记，
      // 或右栏是在停用期间才挂载的），再从干净状态重建一次。
      try { if (typeof disposeGlassSurfaces === 'function') disposeGlassSurfaces(); } catch { /* ignore */ }
      ensureGlassCss();
      applyGlassLayer();
      glassRightNudgePending = true;
      nudgeGlassPlateLayers();
      nudgePendingRightPanel();
      watchPendingRightPanel();
      resyncGlassSurfacesAfterRowToggle();
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => {
        if (glassRowDisabled) return;
        try { applyGlassLayer(); nudgeGlassPlateLayers(); nudgePendingRightPanel(); } catch { /* 下一轮探测仍会重试 */ }
      });
    }
    glassRowDisabled = disabled;
  } catch { /* 状态切换失败不抛出轮询外层：状态未提交，下一轮探测会重跑。 */ }
}

async function probeGlassRowState() {
  if (glassRowProbeBusy || typeof document === 'undefined') return;
  if (document.visibilityState === 'hidden') return; // 页面不可见时暂停轮询
  // 每轮探测都 prune 一次：HMR / 行重挂后的旧模块实例可能绕过本实例的清理路径，
  // 只留下自己的装饰根；多层同几何 plate 的 backdrop-filter 会叠加成偏色。
  try { if (typeof pruneGlassSurfaces === 'function') pruneGlassSurfaces(); } catch { /* 下一轮重试 */ }
  glassRowProbeBusy = true;
  try {
    const res = await fetch(apiUrl('/glass-row-state'), { cache: 'no-store', signal: AbortSignal.timeout(2500) });
    if (res.status === 200) {
      let enabled = true;
      try { enabled = (await res.json()).enabled === true; } catch { /* 应答体异常按启用处理 */ }
      glassRowMisses = 0;
      applyGlassRowState(!enabled);
      // 行开关不重载页面：若右栏是在停用期间才打开的，表面管理器可能还没收到
      // 对应 mutation（或首个几何不成立）。每轮探测对“可见但未认领”的右栏补一次
      // 对齐，避免用户必须刷新页面才能看到玻璃。
      if (!glassRowDisabled) {
        try {
          const right = document.querySelector('[data-sidebar-right-panel][data-sidebar-right-open]');
          // marker 在但装饰根/plate 不在 ⇒ 别的实例把根 prune 掉了，必须重新 sync
          // 让当前实例重建（refresh 会作废指向断开节点的 plate）。
          const missingLayers = !document.querySelector('[data-we-surface-root]')
            || !document.querySelector('[data-we-surface-plate="right-sidebar"]');
          if (right && (!right.hasAttribute('data-we-surface-runtime') || missingLayers)
              && typeof syncGlassSurfaces === 'function') syncGlassSurfaces(selection);
          nudgePendingRightPanel();
        } catch { /* 下一轮探测重试 */ }
      }
    } else if (res.status === 404) {
      // 首启竞态（PR #289 报障的另一条腿）：bundle 求值可能早于宿主行路由注册 ——
      // 路由要等行 fiber 激活才存在，而页面/求值不等它。单次 404 不判停用，
      // 连续两轮（≥3s）仍 404 才认停用 ⇒ 行真被 prune 时停用语义照常到达，
      // 注册晚一拍的启动窗口不再造成"先撤光玻璃、3 秒后又整页弹回"的闪烁。
      if (++glassRowMisses >= 2) applyGlassRowState(true);
    } else {
      // 非 404 的应答（5xx = 宿主重启中 / 其它异常）必须打断“连续”语义：
      // 404 → 5xx → 404 不是连续两次 404，不能据此判停用（#312 评审②）。
      glassRowMisses = 0;
    }
  } catch { glassRowMisses = 0; /* 本轮拿不到应答，同样不算连续 404；观感保持现状。 */ }
  finally { glassRowProbeBusy = false; }
}
/**
 * 探测 / 轮询 / 首帧补建的安装点。**必须在三处跨包登记之后调用**（见文件末尾）。
 * 整包「关闭 → 再开启」时宿主可能直接重新求值本 bundle；若先装轮询再登记，重求值会
 * 先撞主包的面板节重复注册守卫（src/extension-registry.js:139，“同一份 bundle 求值两次”）
 * 抛错，而多出来的 3s 探测与 visibilitychange 监听已经装上了 ⇒ 每重求值一次就多一路轮询。
 * 先登记后安装：抛错发生在安装之前，页面按原样保留本实例，定时器/监听不重复；
 * globalThis 哨兵再兜一层（万一两次求值都走完登记，也只保留一路）。
 * 哨兵与既有惯例一致：挂在 globalThis 上、带 try/catch（见 src/live-layer-pointer.js 的
 * __weFrameBytes、src/client.js 的 __weComponentVisible）。
 */
function startGlassRowPolling() {
  try {
    const g = typeof globalThis === 'object' && globalThis ? globalThis : null;
    if (g) {
      if (g.__weGlassRowPollingStarted) return;
      g.__weGlassRowPollingStarted = true;
    }
  } catch { /* 取不到 globalThis 时退回普通安装 */ }
  probeGlassRowState();
  setInterval(probeGlassRowState, 3000);
  // 整包「关闭 → 再开启」时宿主可能直接重新求值本 bundle（不一定走 applyGlassRowState
  // 的 disabled→enabled 分支）；首帧补一次与行开关同款的合成层重建，覆盖这条路径。
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      if (glassRowDisabled || typeof document === 'undefined') return;
      try {
        glassRightNudgePending = true;
        nudgeGlassPlateLayers();
        nudgePendingRightPanel();
        watchPendingRightPanel();
      } catch { /* ignore */ }
    });
  }
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') probeGlassRowState();
    });
  }
}

registerPanelSection('appearance', 'glass', {
  id: 'glass',
  get title() { return weT("玻璃 UI"); },
  render: (ctx) => (glassRowDisabled ? null : renderAppearanceGlassSection(ctx)),
});

/* ===== 跨包登记 #2：玻璃行为层（ADR-0016 第三刀）===== */

// 与 fx / parallax 同形（packages/fx/src/client.js 的 registerLayerHooks 那行）：sync 挂进
// 主包的 emit 订阅链（每次设置变动重跑，现读 selection 活绑定）、dispose 交主包拆卸期。
// applyGlassLayer / disposeGlassLayer 在本包 client.build.json 的 inline[] glass-layer.js 里
// （同工厂作用域，裸名可达）。sync 幂等：全量按当前 selection 重写，迟到注册由主包
// attacher 立刻补接 + emit 一次（见 src/client.js 的 weSetLayerAttacher）。
registerLayerHooks('glass', {
  // 行停用期间空操作（状态机已 dispose）。启用态每次 emit 先核一遍样式表：sheet 被
  // 带外摘走时，用户下一次任何设置变动都立刻补回，不必等行状态轮询的 3 秒节拍
  // （ensureGlassCss 幂等：同 id 且同内容 ⇒ 零写入）。
  sync: () => { if (!glassRowDisabled) { ensureGlassCss(); applyGlassLayer(); } },
  dispose: disposeGlassLayer,
});

/* ===== 跨包登记 #3：表面策略状态投影（回传主包）===== */

// 外观 ctx 的 surfaceStatus 组装点在主包（renderActiveTab），而 weGlassSurfaceStatus 的真实现
// 在本包 glass-surfaces.js ⇒ 与 petLink 的 registerPetLink 同款反向通道：求值期把只读投影
// 送回主包槽位（缺席 = 空列表，缺的是状态不是页面）。迟到登记的兜底：本包同一次求值里的
// registerLayerHooks 已触发注册表 listener ⇒ 主包 emit() 重画，状态自然补上。
registerGlassStatus({ status: () => (glassRowDisabled ? [] : weGlassSurfaceStatus()) });

/* ===== 行状态机安装点：三处跨包登记都成功之后才装探测/轮询 ===== */

// 顺序即语义：本文件上面的 registerPanelSection / registerLayerHooks / registerGlassStatus
// 在「同一份 bundle 被求值两次」时会由主包注册表抛错（src/extension-registry.js:139/:194）。
// 抛错时旧实例仍继续服务（视觉最终一致），且这次求值没有装上任何定时器/监听 ⇒ 不泄漏。
startGlassRowPolling();
