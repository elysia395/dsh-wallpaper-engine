/**
 * styles.js —— 样式族**组装点**（纯数据；构建期内联进 lib/client.js 的工厂作用域）。
 *
 * 主包域模块：styles/base.js · styles/shell.js · styles/chrome.js · styles/settings.js ·
 * styles/panel.js · styles/quick.js · styles/ext.js（7 个；每个模块文件头有同一份拼装契约）。
 * ADR-0016 第四刀起玻璃段住 packages/glass/src/glass-css.js（CSS_GLASS），由玻璃包自注入，
 * 不进本组装式；可读性下限常量（READABILITY_FLOOR / READABILITY_FLOOR_DARK）也住该文件。
 * 它不参与任何控制流，只被样式注入代码读一次（本文件底部的组装常量 → 注入处的 textContent 赋值）。
 *
 * 拼装契约：各域模板按 INLINE_MODULES 顺序相加 ⇒ 主包样式表；与玻璃包 CSS_GLASS 是**双工件**
 * （守卫按「主包产物 + 玻璃产物」拼接读取，顺序 = 运行时注入序）。
 *
 * ⚠️ 样式表模板的插值常量必须与消费它的 CSS 同文件；本文件只导出自己声明的 CSS。
 *    客户端半边的 export 块按文件解析，导出名必须在该文件里有绑定（否则静态门禁 fatal）。
 *
 * ⚠️ 本文件的注释里不得出现反引号，也不得复述样式表声明语句的字面量：样式表模板由若干守卫从**产物**里
 *    按"行首的域模板声明"取出来，散文里出现同样的字面量或裸反引号会把锚点带偏（**实测**：
 *    verify-host-paint-scope 的 H0 曾报"裸反引号 489"）。
 *
 * 契约：需要的外界**无**；对外提供样式表常量与两个可读性下限。
 * 不变量：
 *   · 浏览器安全（无 import / require / Node API），且**不得有顶层可执行语句**去读宿主状态 ——
 *     它被内联到 bundle 顶部（早于 client.js 正文）。顶层样式表常量是**纯数据**，
 *     插值只引用样式族自己的常量 ⇒ 不触发 TDZ。
 *   · 这是**纯数据**：逻辑（何时注入、何时移除、代际标记）留在 src/client.js。
 */
const CSS = CSS_BASE + CSS_SHELL + CSS_CHROME + CSS_SETTINGS + CSS_PANEL + CSS_QUICK + CSS_EXT;

export { CSS };
