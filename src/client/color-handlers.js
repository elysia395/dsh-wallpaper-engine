/**
 * color-handlers.js — UI 配色与玻璃颜色参数处理器，从 `src/client.js` 按族搬出，函数体逐字未改。
 *
 * 口径：本段按序含：全局 UI 配色的自定义开关/元素色、玻璃颜色（明暗分离/透明度/遮罩浓度/保真度/釉光/表面策略/补雾化选择器）、对话玻璃保真度与主题随壁纸开关。
 *
 * 契约：
 *   1) 本文件不 import —— 构建期由 scripts/build-client.mjs 内联在正文之前，与正文同处一个扁平作用域；
 *      函数体引用的 selection / setSetting / setTransient / emit / weT 等自由名由正文与其它内联模块提供。
 *   2) 搬移只改了"声明住哪"：正文逐字节来自拆前的 src/client.js 对应区间。
 *   3) 顶层只有函数声明：不读正文的 const、不挂监听 ⇒ 无 TDZ 风险。
 */
// 「UI 配色自定义」总开关：与 fontCustom 同形（默认关）。开启后「全局配色」不再生效、改由
// 五个元素键分别决定（面板那一行会被禁用，见 panel-tabs 的 renderAppearanceUiColorSection）。
const onToggleUiColorCustom = (v) => {
  setSetting("uiColorCustom", !!v);
  applyEffects();
  emit();
};
// 五个元素各自的颜色。⚠️ 空串 = **跟随「全局配色」**（不是"回宿主原生"）—— effects.js 里
// `selection[k] || selection.accent` 就是这条语义的实现处；面板的「跟随」按钮写空串。
const onUiColorElement = (field, hex, live) => {
  if (hex !== "" && !/^#[0-9a-f]{6}$/i.test(hex)) return;
  if (UI_COLOR_KEYS.indexOf(field) < 0) return; // 只认那五个键（渲染器传错名字时不静默写脏）
  commitLiveSetting(field, hex, live);
};
// #159②：玻璃颜色**内部永远是一对** `{light, dark}`（见 lib/settings-schema.js 的 readGlassColors）。
// 色板行只写"当前在设的那一侧"；开关关着时两侧写同一个色 —— 与颜色角色的 onThemeColor 同构。
// 读那一对用 `panelGlassPair`（家在 lib/settings-schema.js，ADR-0016 第二刀归位；**自带归一、不引用工厂作用域里的兄弟**，
// 因为 test/verify-scene-live.mjs 把 glass-panel.js 当真模块 import；这里不另存一份口径，
// 免得"读的一侧"和"画的一侧"漂开（走到这儿的值可能仍是标量：老预设定档直传 / 台架 selection）。
const onGlassColor = (mode, hex, live) => {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
  const cur = panelGlassPair(selection);
  // 缺的那一侧用本次选的色补上 —— **绝不写半对**：半对在另一配色下会退化成兜底色，
  // 用户的观感就是"没染上"（readGlassColors 也会把它补回另一侧，但那要等下一次 sanitize）。
  const next = { light: cur.light || hex, dark: cur.dark || hex };
  if (selection.glassDarkSeparate === true) next[mode === "dark" ? "dark" : "light"] = hex;
  else { next.light = hex; next.dark = hex; }
  commitLiveSetting("glassColor", next, live);
};
// 「深色单独设置」开关（玻璃色那一行）：关掉时把两侧**收敛到浅色那一侧** —— 这就是"一个颜色
// 同时用于两套"的字面含义。不做收敛的话，关掉后深色还留着上一次的深色值，再打开会突然跳回旧值。
// 与 onThemeDarkSeparate（字体角色那一个）同构：开关本身不改任何渲染，只是面板的显隐 + 写入口径。
const onGlassDarkSeparate = (v) => {
  const on = v === true;
  setSetting("glassDarkSeparate", on);
  if (!on) {
    const cur = panelGlassPair(selection);
    const light = cur.light || cur.dark;
    if (light) setSetting("glassColor", { light, dark: light });
  }
  applyEffects(); emit();
};
const onGlassAlpha = (pct, live) =>
  commitLiveSetting("glassAlpha", clampNum(pct, ...schemaRange("glassAlpha"), DEFAULTS.glassAlpha), live);
// 遮罩浓度（#254）：只折算宿主 Modal 遮罩 token 的 alpha（玻璃层写 --we-mask-strength）。
const onGlassMaskStrength = (pct, live) =>
  commitLiveSetting("settingsMaskStrength", clampNum(pct, ...schemaRange("settingsMaskStrength"), DEFAULTS.settingsMaskStrength), live);
// 玻璃保真度（默认 100 = 完整可读性红线）：唯一的「颜色 vs 可读」权衡旋钮，
// 数学入口在 effects.js 的 weClampSurfaceColor 第三参 + --we-glass-fidelity。
const onGlassFidelity = (pct, live) =>
  commitLiveSetting("glassFidelity", clampNum(pct, ...schemaRange("glassFidelity"), DEFAULTS.glassFidelity), live);
// 镜面高光强度（#404，默认 100 = 现状）：0 = 主块三档与侧栏派生档的釉光全部归零，
// 只保留底与霜；100 = 与接线前逐值相同。落地在 glass-layer.js 的 --we-sheen-scale。
const onGlassSheenStrength = (pct, live) =>
  commitLiveSetting("glassSheenStrength", clampNum(pct, ...schemaRange("glassSheenStrength"), DEFAULTS.glassSheenStrength), live);
// 额外补雾化的选择器（#200）：值是一串 CSS 选择器（逗号 / 换行分隔，最多 8 条）。
// 消毒只走 settings-schema 的 sanitizeExtraGlassSelectors —— 读侧（sanitizeFromSchema）
// 与本模块生成侧（glass-extra.js）**共用同一份**判据，所以用户敲到一半的非法串既不会进
// 规则、也不会被"修剪"成另一个选择器。**不做防抖**：只有清单真的变了才会重写 <style>
// （glass-extra 里那句内容比对），且一次只写一条文本节点，代价与拖滑杆同量级。
const onGlassSurfacePolicy = (id, policy) => {
  if (!["left-sidebar", "right-sidebar", "settings-window", "content", "declared", "extra"].includes(id)
    || !["auto", "native"].includes(policy)) return;
  setSetting("glassSurfacePolicy", { ...selection.glassSurfacePolicy, [id]: policy });
  applyEffects(); emit();
};
const onExtraGlassSelectors = (text) => {
  setSetting("extraGlassSelectors", text == null ? "" : String(text));
  applyEffects();
  emit();
};
// 对话栏玻璃保真度（默认 100）：独立于全局的第二把尺子，只作用对话栏玻璃面
// （气泡 / 输入卡片 / 对话内 markdown 家族 —— styles.js 消费 --we-chat-readability-*）。
const onChatGlassFidelity = (pct, live) =>
  commitLiveSetting("chatGlassFidelity", clampNum(pct, ...schemaRange("chatGlassFidelity"), DEFAULTS.chatGlassFidelity), live);
// 主题随壁纸（**默认关**）：开关本身只写设置；**打开时**立刻按当前壁纸补判一次，
// 不等下一次换壁纸（补判走与换壁纸同一条入口；关时那条入口整体空转，不写主题）。
const onToggleThemeFollow = (v) => {
  setSetting("themeFollow", !!v); themeFollowOnWallpaper(selection); emit();
};
