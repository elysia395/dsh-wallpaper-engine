/**
 * styles.js —— 样式族**组装点** + 可读性下限的对外出口（纯数据；构建期内联进 lib/client.js 的工厂作用域）。
 *
 * 为什么单独一个文件：这是全仓最大的一块**纯数据**（3,682 行 CSS、**零分支**）。它原先是本文件里的**一个**
 * 模板常量；按视觉域切成 8 个域模块后，定位"某段规则从哪开始"不再需要在一大片 CSS 里翻找 —— 域模块与
 * 来源行号：styles-base.js · styles-shell.js · styles-sidebar.js · styles-chrome.js · styles-settings.js ·
 * styles-panel.js · styles-quick.js · styles-ext.js（切段边界 = 原有分区注释，规则一字未改）。
 * 它不参与任何控制流，只被样式注入代码读一次（本文件底部的组装常量 → 注入处的 textContent 赋值）。
 *
 * 拼装契约（与 8 个域模块共享，域模块文件头有同一份）：各域模板按 INLINE_MODULES 顺序相加 ⇒ 拼出的 CSS
 * 与原单模板**逐字节相同**（分割前 sha256 前缀 3b6c41dc7dcab44bf5c57f4 · 262306 B）。
 *
 * ⚠️ 可读性下限（READABILITY_FLOOR / READABILITY_FLOOR_DARK）**必须和 CSS 同处一文件**：它们是样式表模板里
 *    的插值 —— 因此跟着消费它们的 CSS 留在 styles-base.js，并由 **styles-base.js 自己导出**；本文件的
 *    export 块只导出本文件真正声明的 CSS（客户端半边的 export 块按文件解析，导出名必须在该文件里有绑定，
 *    否则静态门禁把整份文件判成 fatal：实测 "Export 'READABILITY_FLOOR' is not defined"）。
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
const CSS = CSS_BASE + CSS_SHELL + CSS_SIDEBAR + CSS_CHROME + CSS_SETTINGS + CSS_PANEL + CSS_QUICK + CSS_EXT;

export { CSS };
