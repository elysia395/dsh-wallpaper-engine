/**
 * glass-extra.js — 「额外补雾化的选择器」（上游）的唯一落点。
 *
 * 为什么单开一个文件：本插件的注入样式表是**构建期常量**（主包 7 个样式域模块，纯数据、零分支），
 * 而这一段是**运行期由设置拼出来的** —— 两者的注入路径与归属都不同。混在一起会让
 * "样式表是纯数据"这条契约失效（守卫也从那份常量里按行首锚点取样式表）。
 *
 * 为什么用 `::before` 载体（照抄 glass-css.js 左侧栏那条**已验证**的形态）：伪元素**没有后代**
 * ⇒ 不会成为 `position: fixed` 后代的包含块。本仓 坑正在这里：在元素**自身**上加
 * backdrop-filter 会让它内部那些定位弹层改锚 —— 而第三方插件的面板里恰好常挂定位弹层
 * （codearts 的徽标弹层就是挂在按钮上的 `position: absolute`）。
 *
 * 契约：
 *   · `weExtraGlassCss(selection)` —— 纯函数：清单 → CSS 文本（空清单 ⇒ 空串）；
 *   · `syncExtraGlassCss(selection)` —— 唯一的写入口（内容没变就不碰 DOM，与 client.js
 *     的 `ensurePluginCss` 同一手法）；
 *   · `disposeExtraGlassCss()` —— 卸载路径（由玻璃行为层的 `disposeGlassLayer` 成对调用）。
 * 消毒：**只**走 settings-schema 的 `sanitizeExtraGlassSelectors`（白名单 + 限条数 + 限长），
 * 这里**不另写一套** —— 存进去的与拼进规则的共用同一份判据，两端不会分叉。
 *
 * ⚠️ 本文件不得出现反引号（本仓守卫会在产物里做裸反引号计数）：字符串一律用双引号。
 */

/** 本通道自己的 <style> 标记（与主样式表的 styles-v3 并列，互不覆盖）。 */
const EXTRA_GLASS_TAG_ID = "dsh-wallpaper-engine/extra-glass";

/**
 * 清单 → 规则文本。**空清单返回空串**（=一条规则都不生成 ⇒ 与未接本功能时逐字节一致）。
 *
 * 每个选择器生成 **4 条规则**（2 档主题 × 正常/软渲两档所有权）：
 *   · 浅色正常档 = 霜（backdrop-filter 读全局 --we-blur 滑杆）+ 完整两段 color-mix 底色
 *     （glass-css 设置窗同一张配方表：tint×alpha 段 + (1 - readability-floor) 地板段）；
 *   · 深色正常档 = 只覆盖底色（tint-dark），霜从浅色规则**级联**（两档同时匹配同一 ::before，
 *     深色规则特异性更高 ⇒ 底色深色赢、霜无人覆盖照旧）；
 *   · 软渲两档（resolver 打 data-we-surface-runtime="extra-fallback" 时才匹配）= 无霜、
 *     不透明可读底色（tint 满量，形态同 glass-css 的 @supports 回退别名），浅色档显式
 *     backdrop-filter:none，深色档靠级联继承 none —— 软渲环境不保留也不会生效的模糊。
 *
 * 组前缀（四把门）：
 *   · `data-we-glass-page`：与其余玻璃规则同一道"玻璃在算值"闸门（皮肤让路态下整族摘属性，
 *     本通道跟着一起失效 —— 不留"别人让路了、这层还在画"的半截状态）；
 *   · 正常档 `:not([data-we-glass-fallback])` / 软渲档 `[data-we-glass-fallback]`：
 *     与 #95 同政策 —— 不会生效的 backdrop-filter 不留在软渲环境里白付合成代价，
 *     但底色可读性仍由 extra-fallback 规则兜住（不是整组裸奔）；
 *   · `body[data-ds-dark-theme]`：深色配方分叉（tint/base/floor 全套换深色值）。
 */
function weExtraGlassCss(selection) {
  const list = typeof sanitizeExtraGlassSelectors === "function"
    ? sanitizeExtraGlassSelectors(selection && selection.extraGlassSelectors)
    : "";
  if (!list) return "";
  const gate = "body[data-we-glass-page]:not([data-we-glass-fallback]) ";
  const darkGate = "body[data-ds-dark-theme][data-we-glass-page]:not([data-we-glass-fallback]) ";
  const softGate = "body[data-we-glass-page][data-we-glass-fallback] ";
  const softDarkGate = "body[data-ds-dark-theme][data-we-glass-page][data-we-glass-fallback] ";
  const base = " content: \"\"; position: absolute; inset: 0; border-radius: inherit;"
    + " z-index: -1; pointer-events: none;";
  // 霜只在浅色正常档声明一次（深色/软渲靠级联）⇒ 产物里 blur( 恒为每前缀一份。
  const frost = " -webkit-backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8))"
    + " brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);"
    + " backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8))"
    + " brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);";
  // 完整两段配方：地板段 readability-floor + tint 段（权重 0.9 与 chrome 设置窗 layer-1 同值）。
  const mixLight = " background-color: color-mix(in srgb, var(--we-readability-base, #ffffff)"
    + " calc(var(--we-readability-floor, 0.45) * 100%),"
    + " color-mix(in srgb, var(--we-surface-tint-light, #ffffff)"
    + " calc(var(--we-settings-window-alpha, 0.15) * 0.9 * 100%), transparent)"
    + " calc((1 - var(--we-readability-floor, 0.45)) * 100%));";
  const mixDark = " background-color: color-mix(in srgb, var(--we-readability-base, #0d1524)"
    + " calc(var(--we-readability-floor, 0.59) * 100%),"
    + " color-mix(in srgb, var(--we-surface-tint-dark, #0d1524)"
    + " calc(var(--we-settings-window-alpha, 0.15) * 0.9 * 100%), transparent)"
    + " calc((1 - var(--we-readability-floor, 0.59)) * 100%));";
  // 软渲回退底色 = tint 满量（glass-css @supports 回退同形态），恒不透明、恒可读。
  const opaqueLight = " -webkit-backdrop-filter: none; backdrop-filter: none;"
    + " background-color: var(--we-surface-tint-light, #ffffff);";
  const opaqueDark = " background-color: var(--we-surface-tint-dark, #0d1524);";
  // 拼接处的**前置不变量**：list 由 sanitizeExtraGlassSelectors 产出，只可能是"整条白名单
  // 选择器 + ', ' 分隔"（逗号不在单条白名单里，所以 ", " 只可能是分隔符）⇒ 这里按 ", " 拆出来
  // 的每一段都是**完整**选择器，不存在半截（总量上限与"超限整体作废"见 lib/settings-schema.js
  // 的 EXTRA_GLASS_SELECTORS_MAX 注释：旧版 400 字上限的 slice 会在这里切出半截选择器）。
  const ownExtra = ":where([data-we-surface-runtime=\"extra\"])::before {";
  const ownFallback = ":where([data-we-surface-runtime=\"extra-fallback\"])::before {";
  const rules = [];
  for (const sel of list.split(", ")) {
    rules.push(
      gate + sel + ownExtra + base + frost + mixLight + " }",
      darkGate + sel + ownExtra + base + mixDark + " }",
      softGate + sel + ownFallback + base + opaqueLight + " }",
      softDarkGate + sel + ownFallback + base + opaqueDark + " }",
    );
  }
  // ⚠️ 这条注释**只许用 ASCII**：它落在 JS 字符串字面量里（不是 styles.js 的模板），
  //    i18n 判据要求"字符串里的中文必须包 weT(...)"—— 生成出来的 CSS 注释不是 UI 文案，
  //    塞中文只会让守卫判红（实测踩过：`每条中文都进了 weT` 报 packages/glass/src/glass-extra.js 那一行）。
  return "/* extra frost targets for user-named selectors (upstream #200) */\n" + rules.join("\n") + "\n";
}

/** 把生成结果同步进本通道自己的 <style>（清单为空 ⇒ 撤掉那个标签）。 */
function syncExtraGlassCss(selection) {
  if (typeof syncGlassSurfaces === "function") syncGlassSurfaces(selection);
  if (typeof document === "undefined") return;
  const css = weExtraGlassCss(selection);
  let tag = document.querySelector("style[data-plugin-css=" + JSON.stringify(EXTRA_GLASS_TAG_ID) + "]");
  if (!css) {
    if (tag) tag.remove();
    return;
  }
  if (tag === null) {
    tag = document.createElement("style");
    tag.dataset.plugin = "dsh-wallpaper-engine";
    tag.dataset.pluginCss = EXTRA_GLASS_TAG_ID;
    document.head.appendChild(tag);
  }
  // 内容没变就不碰 DOM：设置面板每敲一个字符都会走到这里，无脑重写会让<style>整篇重算。
  if (tag.textContent !== css) tag.textContent = css;
}

/** 卸载：移除本通道的 <style>（fiber cleanup 与 glass-layer 的 disposeExtraGlassCss 成对调用）。 */
function disposeExtraGlassCss() {
  if (typeof disposeGlassSurfaces === "function") disposeGlassSurfaces();
  if (typeof document === "undefined") return;
  const tag = document.querySelector("style[data-plugin-css=" + JSON.stringify(EXTRA_GLASS_TAG_ID) + "]");
  if (tag) tag.remove();
}

export { weExtraGlassCss, syncExtraGlassCss, disposeExtraGlassCss };
