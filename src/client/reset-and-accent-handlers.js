/**
 * reset-and-accent-handlers.js — 重置（模块/页签/全局）与强调色处理器，从 `src/client.js` 按族搬出，函数体逐字未改。
 *
 * 口径：本段含 resetKeysToDefault 与 onResetModule / onResetTab / onResetAll，以及写强调色的 onAccent。
 *
 * 契约：
 *   1) 本文件不 import —— 构建期由 scripts/build-client.mjs 内联在正文之前，与正文同处一个扁平作用域；
 *      函数体引用的 selection / setSetting / setTransient / emit / weT 等自由名由正文与其它内联模块提供。
 *   2) 搬移只改了"声明住哪"：正文逐字节来自拆前的 src/client.js 对应区间。
 *   3) 顶层只有函数声明：不读正文的 const、不挂监听 ⇒ 无 TDZ 风险。
 */
// 键集一律取自 lib/settings-schema.js 的 `RESET_MODULES`（模块级）/ `RESET_TABS`（页签级）/
// `PROFILE_PRESET_KEYS`（全局）—— 都在那一侧定义，这一侧不手抄键表。
// ⚠️ 必须是**整批赋值 + 一次 persistSelection + 一次 emit**：逐键走 `setSetting` 会发 N 次
// debounce、N 次整棵面板重渲染（本仓"写必成对"纪律，同 src/settings/fontset-store.js 的注释）。
/**
 * 把给定的键整批写回默认值，返回真正改动的键数。
 * 只碰"确实有默认值"的键：缺默认值的键原样留着，免得把 `undefined` 写进 store ——
 * 那会被宿主 sanitize 折成默认值，看着像"重置生效了"，实际是绕了一圈的静默改写。
 */
function resetKeysToDefault(keys) {
  let touched = 0;
  for (let i = 0; i < keys.length; i += 1) {
    const k = keys[i];
    if (!Object.prototype.hasOwnProperty.call(DEFAULTS, k)) continue;
    if (selection[k] === DEFAULTS[k]) continue;
    selection[k] = DEFAULTS[k];
    touched += 1;
  }
  if (touched) persistSelection();
  return touched;
}
/**
 * 模块级重置（**无需确认**：单模块代价低 —— 用户口径见 issue #192）。
 * 覆盖**两处**的模块：扩展页签的三个（avatar / fx / parallax）与外观页签的六个
 * （theme / detail / glass / corners / uiColor / font）—— 同一个入口，键集由模块名查表。
 */
const onResetModule = (groupName) => {
  const keys = (typeof RESET_MODULES === "object" && RESET_MODULES && RESET_MODULES[groupName]) || [];
  if (!keys.length) return;
  resetKeysToDefault(keys);
  emit();
};
/**
 * 页签级重置（issue #192 用户口径：「每个选项卡后面加重置，重置指定选项卡」）。
 * 键集取自 `RESET_TABS`（schema 里手写并由守卫对账的完整划分）。
 * 走两步确认 ⇒ 这个函数只负责"确认之后真的做"，确认由面板用 armConfirm 上膛。
 */
const onResetTab = (tabId) => {
  const keys = (typeof RESET_TABS === "object" && RESET_TABS && RESET_TABS[tabId]) || [];
  resetKeysToDefault(keys);
  disarmConfirm(); // 确认行自己收掉（它内部会 emit）
};
/**
 * 全局重置（**必须二次确认**）：确认由面板走既有 `armConfirm` 两步确认构件完成
 * （`selection.armedConfirm` 是单值 ⇒ 结构上同一时刻只有一个动作待确认，见那段注释），
 * 这里只负责"确认之后真的做"。
 * 范围 = `PROFILE_PRESET_KEYS`（全部会持久化的设置键）；**不含导入的资产文件**
 * （头像图 / 吉祥物立绘 / 字体集住各自的目录，删不删是另一件事 —— 重置设置不该顺手删用户的图）。
 */
const onResetAll = () => {
  resetKeysToDefault(PROFILE_PRESET_KEYS);
  disarmConfirm(); // 确认行自己收掉（它内部会 emit）
};
// 配色 (accent color) + 玻璃透明度 (glass transparency) + 玻璃颜色 (glass base
// tint): applied instantly through applyEffects() (--we-accent /
// --we-glass-alpha / --we-surface-tint-light/dark), persisted so the settings page keeps
// its custom look across reloads.
const onAccent = (hex, live) => {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
  commitLiveSetting("accent", hex, live);
};
