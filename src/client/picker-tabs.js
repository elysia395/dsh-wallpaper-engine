/**
 * picker-tabs.js — 可见页签表与页签记忆，从 `src/client.js` 按族搬出，函数体逐字未改。
 *
 * 契约：
 *   1) 本文件不 import —— 构建期由 scripts/build-client.mjs 内联在正文之前，与正文同处一个扁平作用域；
 *      函数体引用的 selection / setSetting / setTransient / emit / weT / React 等自由名由正文与其它内联模块提供。
 *   2) 搬移只改了"声明住哪"：正文与拆前 src/client.js 的 1810–1849 行逐字节相同。
 *   3) 顶层状态只有字面量（若有）：不读正文的 const、不挂监听 ⇒ 无 TDZ 风险。
 */
// ── 可见页签表（ADR-0013 D3① 的"页签安全" + P-D S5e 的 D-6(b) 收口）──────────
// 口径：**整页**都归某个子包浏览器半边的页签，只有在那一半真的在台上时才进导航。为什么必须
// gate：页签内容全部来自面板节注册表（`wePanelSectionsOf`）；子包浏览器半边缺席时注册表里
// 没有那个 panelId 的节，页签会渲染成一块**空白面板** —— 没有报错、也没有空态提示，用户只
// 看到"点进去什么都没有"。所以"可见"不能是静态表，必须是**注册表现存性**的现算。
//
// 为什么用注册表现存性当"dsh.client 存在性"的可观测代理：浏览器侧拿不到构建期的 dsh.client
// 元数据（那是宿主/打包器的信息），但它能看见**注册表里有没有这个 panelId 的节** —— 节是
// 子包浏览器半边在求值时登记的，缺席 ⇒ 零节。这个代理不需要第二套"谁在场"的探测通道，也不
// 会像 DOM/全局探测那样被加载时序骗过去。
//
// ⚠️ **不要**在这里接一张"组件名 → 页签"的表：那是浏览器侧的第二份可见面映射，D3② 明文禁止
// （判据见 test/verify-component-visibility.mjs 的双向对账）。`TAB_SECTION_OWNER` 只写
// "页签 id → 面板节注册表 id"（同一套 id 空间），不写组件名。将来某页整页归新子包时**只改
// TAB_SECTION_OWNER 一行**，其余页签没有 owner ⇒ 恒可见。
const TAB_SECTION_OWNER = { library: "library" };
// 每次渲染现算、**不缓存**注册表快照：注册表是子包浏览器半边求值时写入的，可能晚于首次渲染
// （求值 → 注册 → 监听器触发重画），缓存会把"晚到"永久判成"缺席"。
function visiblePickerTabs() {
  return PICKER_TABS.filter((t) => {
    const owner = TAB_SECTION_OWNER[t.id];
    if (!owner) return true;
    return wePanelSectionsOf(owner).length > 0;
  });
}
// 生效页签 = 存着的那个（旧 id 迁移 + `PICKER_TABS` 校验照旧）若不在可见表里 ⇒ 回落第一个可见。
// 空表（一个可见页签都没有）理论上不可达；真出现也不把 activeTab 设成空值，退回存着的 id。
function resolvePickerTab(id) {
  const tabs = visiblePickerTabs();
  if (tabs.some((t) => t.id === id)) return id;
  return tabs.length ? tabs[0].id : id;
}
function readSavedPickerTab() {
  try {
    let v = localStorage.getItem(PICKER_TAB_KEY);
    if (v && PICKER_TAB_LEGACY[v]) v = PICKER_TAB_LEGACY[v];
    if (v && PICKER_TABS.some((t) => t.id === v)) return v;
  } catch { /* ignore */ }
  return "library";
}
