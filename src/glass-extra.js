/**
 * glass-extra.js — 「额外补雾化的选择器」（上游 issue #200）的唯一落点。
 *
 * 为什么单开一个文件：本插件的注入样式表是**构建期常量**（src/styles.js，纯数据、零分支），
 * 而这一段是**运行期由设置拼出来的** —— 两者的注入路径与归属都不同。混在一起会让
 * "样式表是纯数据"这条契约失效（守卫也从那份常量里按行首锚点取样式表）。
 *
 * 为什么用 `::before` 载体（照抄 styles.js 左侧栏那条**已验证**的形态）：伪元素**没有后代**
 * ⇒ 不会成为 `position: fixed` 后代的包含块。本仓 #89 的坑正在这里：在元素**自身**上加
 * backdrop-filter 会让它内部那些定位弹层改锚 —— 而第三方插件的面板里恰好常挂定位弹层
 * （codearts 的徽标弹层就是挂在按钮上的 `position: absolute`）。
 *
 * 契约：
 *   · `weExtraGlassCss(selection)` —— 纯函数：清单 → CSS 文本（空清单 ⇒ 空串）；
 *   · `syncExtraGlassCss(selection)` —— 唯一的写入口（内容没变就不碰 DOM，与 client.js
 *     的 `ensurePluginCss` 同一手法）；
 *   · `disposeExtraGlassCss()` —— 卸载路径（与 effects.js 的 `clearEffects` 成对）。
 * 消毒：**只**走 settings-schema 的 `sanitizeExtraGlassSelectors`（白名单 + 限条数 + 限长），
 * 这里**不另写一套** —— 存进去的与拼进规则的共用同一份判据，两端不会分叉。
 *
 * ⚠️ 本文件不得出现反引号（本仓守卫会在产物里做裸反引号计数）：字符串一律用双引号。
 */

/** 本通道自己的 <style> 标记（与主样式表的 styles-v3 并列，互不覆盖）。 */
const EXTRA_GLASS_TAG_ID = "dsh-wallpaper-engine/extra-glass";

/**
 * 清单 → 规则文本。**空清单返回空串**（= 一条规则都不生成 ⇒ 与未接本功能时逐字节一致）。
 *
 * 选择器只在**组前缀**下生效：`body[data-we-glass-page]:not([data-we-glass-fallback])`
 *   · `data-we-glass-page`：与其余玻璃规则同一道"玻璃在算值"闸门（皮肤让路态下整族摘属性，
 *     本通道跟着一起失效 —— 不留"别人让路了、这层还在画"的半截状态）；
 *   · `:not([data-we-glass-fallback])`：软件光栅档下整组不匹配（与 #95 同政策 ——
 *     不会生效的 backdrop-filter 不留着，也不在软渲环境里白付合成代价）。
 */
function weExtraGlassCss(selection) {
  const list = typeof sanitizeExtraGlassSelectors === "function"
    ? sanitizeExtraGlassSelectors(selection && selection.extraGlassSelectors)
    : "";
  if (!list) return "";
  const gate = "body[data-we-glass-page]:not([data-we-glass-fallback]) ";
  const body = " content: \"\"; position: absolute; inset: 0; border-radius: inherit;"
    + " z-index: -1; pointer-events: none;"
    + " -webkit-backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8))"
    + " brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);"
    + " backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8))"
    + " brightness(var(--we-glass-brightness, 1.04)) contrast(1.01); }";
  // 拼接处的**前置不变量**：list 由 sanitizeExtraGlassSelectors 产出，只可能是"整条白名单
  // 选择器 + ', ' 分隔"（逗号不在单条白名单里，所以 ", " 只可能是分隔符）⇒ 这里按 ", " 拆出来
  // 的每一段都是**完整**选择器，不存在半截（总量上限与"超限整体作废"见 lib/settings-schema.js
  // 的 EXTRA_GLASS_SELECTORS_MAX 注释：旧版 400 字上限的 slice 会在这里切出半截选择器）。
  const rules = list.split(", ").map((sel) => gate + sel + "::before {" + body);
  // ⚠️ 这条注释**只许用 ASCII**：它落在 JS 字符串字面量里（不是 styles.js 的模板），
  //    i18n 判据要求"字符串里的中文必须包 weT(...)"—— 生成出来的 CSS 注释不是 UI 文案，
  //    塞中文只会让守卫判红（实测踩过：`每条中文都进了 weT` 报 src/glass-extra.js 那一行）。
  return "/* extra frost targets for user-named selectors (upstream #200) */\n" + rules.join("\n") + "\n";
}

/** 把生成结果同步进本通道自己的 <style>（清单为空 ⇒ 撤掉那个标签）。 */
function syncExtraGlassCss(selection) {
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

/** 卸载：移除本通道的 <style>（fiber cleanup 与 clearEffects 成对调用）。 */
function disposeExtraGlassCss() {
  if (typeof document === "undefined") return;
  const tag = document.querySelector("style[data-plugin-css=" + JSON.stringify(EXTRA_GLASS_TAG_ID) + "]");
  if (tag) tag.remove();
}

export { weExtraGlassCss, syncExtraGlassCss, disposeExtraGlassCss };
