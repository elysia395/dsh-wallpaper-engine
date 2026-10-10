# `--dsw-*` 令牌契约（自动生成，勿手改）

> 生成：`node test/tools/token-contract.mjs --write`；核对：`node test/verify-token-contract.mjs`
> （守卫在契约与代码不一致时失败 —— 令牌集合因此不会烂掉）。
>
> **口径**：只计 `src/styles.js` CSS 模板里**属性位**的 `--dsw-*` 声明（值里的
> `var(--dsw-…)` 是读不是写，不计）；门控归属按花括号栈上的**选择器链**判定。
> **玻璃** = 链上有 `[data-we-glass-*]`；**壁纸** = 只有 `[data-we-wallpaper]`；
> **无门控** = 两者都不挂（共存审计 M1 的全部暴露面 —— 白名单见下表，新增一条守卫即红）。
> JS 侧的令牌写入（`src/font/apply.js` 的 label 族等）不在本契约口径内，见 `docs/DSH-UI-INTERFACES.md`。

共 **162** 条声明 / **54** 个不同令牌。门控归属：
玻璃 **131** 条 · 壁纸 **12** 条 · 无门控 **19** 条。

## 无门控声明（白名单 —— M1 的全部暴露面）

除下列两处封闭白名单外，**任何新的无门控 `--dsw-*` 声明都会让 `verify-token-contract` 变红**
（按宿主规范消费 token 的第三方插件无法区分「玻璃开/关」，只能拿到配方本身 —— 见 `docs/COEXISTENCE.md`）。

| 令牌 | 行 | 选择器链 | 归属 |
|---|---|---|---|
| `--dsw-alias-bg-layer-1` | styles.js:96 | `.we-layer` | .we-layer（插件自有元素，卸载即消失） |
| `--dsw-specific-bubble` | styles.js:990 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-block` | styles.js:991 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-block-banner` | styles.js:992 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-inline-code` | styles.js:993 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-tag` | styles.js:994 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-segment-unselected` | styles.js:995 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-segment-selected` | styles.js:996 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-citation` | styles.js:997 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-placeholder` | styles.js:998 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-specific-bubble` | styles.js:1004 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-block` | styles.js:1005 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-block-banner` | styles.js:1006 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-inline-code` | styles.js:1007 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-tag` | styles.js:1008 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-segment-unselected` | styles.js:1009 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-segment-selected` | styles.js:1010 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-citation` | styles.js:1011 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-placeholder` | styles.js:1012 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |

## 全量令牌表

| 令牌 | 条数 | 门控 | 行号 | 消费者注记 |
|---|---|---|---|---|
| `--dsw-alias-bg-base` | 2 | 壁纸(2) | 222, 343 | 页面基底 —— 壁纸可见性的关键前提（transparent） |
| `--dsw-alias-bg-layer-1` | 11 | 玻璃(10) + 无门控(1) | 96, 248, 349, 1528, 1589, 1611, 1616, 1625, 3153, 3160, 3171 | 面板层次 1（宿主对话框/侧栏底）；better-sidebar 亦按它上色 |
| `--dsw-alias-bg-layer-2` | 11 | 玻璃(11) | 251, 352, 821, 1531, 1592, 1612, 1617, 1626, 3154, 3161, 3172 | 面板层次 2 |
| `--dsw-alias-bg-layer-3` | 10 | 玻璃(10) | 254, 355, 1534, 1595, 1613, 1618, 1627, 3155, 3162, 3173 | 面板层次 3 |
| `--dsw-alias-bg-module-platform` | 2 | 玻璃(2) | 269, 365 |  |
| `--dsw-alias-bg-multi-select` | 2 | 玻璃(2) | 272, 368 |  |
| `--dsw-alias-bg-overlay` | 2 | 玻璃(2) | 266, 362 | 弹层/浮出层底（issue #71 全表面玻璃） |
| `--dsw-alias-border-l1` | 2 | 玻璃(2) | 330, 414 | 边框强调 L1（「边框」滑条） |
| `--dsw-alias-border-l2` | 2 | 玻璃(2) | 331, 415 | 边框强调 L2 |
| `--dsw-alias-border-l2-darkmode-thin` | 2 | 玻璃(2) | 332, 416 | 深色细边框 |
| `--dsw-alias-border-l3` | 1 | 玻璃(1) | 1098 |  |
| `--dsw-alias-brand-primary` | 3 | 玻璃(3) | 1106, 1210, 1547 |  |
| `--dsw-alias-brand-text` | 3 | 玻璃(3) | 1107, 1211, 1548 |  |
| `--dsw-alias-button-elevated-fill` | 4 | 玻璃(4) | 257, 358, 1628, 3174 | 抬高按钮实色（侧栏「新建会话」等） |
| `--dsw-alias-button-floating-fill` | 3 | 玻璃(3) | 275, 371, 823 |  |
| `--dsw-alias-button-floating-hover` | 1 | 玻璃(1) | 824 |  |
| `--dsw-alias-button-ghost-active-fill` | 2 | 玻璃(2) | 278, 374 |  |
| `--dsw-alias-button-primary-dimmed` | 1 | 玻璃(1) | 1551 |  |
| `--dsw-alias-button-primary-fill` | 1 | 玻璃(1) | 1549 |  |
| `--dsw-alias-button-primary-hover` | 1 | 玻璃(1) | 1550 |  |
| `--dsw-alias-button-tool-bar-fill` | 2 | 玻璃(2) | 281, 377 |  |
| `--dsw-alias-interactive-bg-active` | 2 | 玻璃(2) | 284, 380 |  |
| `--dsw-alias-interactive-bg-hover` | 6 | 玻璃(6) | 822, 1103, 1131, 1207, 1245, 1540 |  |
| `--dsw-alias-interactive-bg-hover-accent` | 3 | 玻璃(3) | 1104, 1208, 1541 |  |
| `--dsw-alias-interactive-bg-hover-solid` | 2 | 玻璃(2) | 287, 383 |  |
| `--dsw-alias-label-caption` | 1 | 壁纸(1) | 447 |  |
| `--dsw-alias-label-dimmed` | 1 | 壁纸(1) | 448 |  |
| `--dsw-alias-label-primary` | 1 | 壁纸(1) | 443 | 正文灰阶（壁纸激活时压暗提对比） |
| `--dsw-alias-label-primary-dimmed` | 1 | 壁纸(1) | 444 |  |
| `--dsw-alias-label-primary-foreground` | 1 | 玻璃(1) | 1558 |  |
| `--dsw-alias-label-secondary` | 1 | 壁纸(1) | 445 | 次要文字灰阶 |
| `--dsw-alias-label-tertiary` | 1 | 壁纸(1) | 446 |  |
| `--dsw-alias-markdown-citation` | 4 | 玻璃(2) + 无门控(2) | 290, 386, 997, 1011 |  |
| `--dsw-alias-markdown-code-block` | 6 | 玻璃(4) + 无门控(2) | 308, 396, 857, 991, 1005, 1631 | markdown 代码块底 |
| `--dsw-alias-markdown-code-block-banner` | 6 | 玻璃(4) + 无门控(2) | 311, 399, 858, 992, 1006, 1632 | markdown 代码条幅底 |
| `--dsw-alias-markdown-code-segment-selected` | 5 | 玻璃(3) + 无门控(2) | 325, 411, 996, 1010, 1636 | 代码卡分段（选中） |
| `--dsw-alias-markdown-code-segment-unselected` | 5 | 玻璃(3) + 无门控(2) | 320, 408, 995, 1009, 1635 | 代码卡分段（未选中） |
| `--dsw-alias-markdown-inline-code` | 6 | 玻璃(4) + 无门控(2) | 314, 402, 784, 993, 1007, 1633 | 行内代码底 |
| `--dsw-alias-markdown-placeholder` | 4 | 玻璃(2) + 无门控(2) | 293, 389, 998, 1012 |  |
| `--dsw-alias-markdown-tag` | 5 | 玻璃(3) + 无门控(2) | 317, 405, 994, 1008, 1634 | markdown 标签底 |
| `--dsw-alias-scrollbar-bg-l1` | 2 | 玻璃(2) | 581, 592 |  |
| `--dsw-alias-scrollbar-bg-l2` | 2 | 玻璃(2) | 582, 593 |  |
| `--dsw-alias-scrollbar-hover-l1` | 2 | 玻璃(2) | 583, 594 |  |
| `--dsw-alias-scrollbar-hover-l2` | 2 | 玻璃(2) | 584, 595 |  |
| `--dsw-alias-state-business-primary` | 3 | 玻璃(3) | 1105, 1209, 1552 |  |
| `--dsw-alias-turn-trigger-bg` | 3 | 玻璃(3) | 666, 676, 3185 |  |
| `--dsw-alias-turn-trigger-bg-hover` | 3 | 玻璃(3) | 669, 679, 3186 |  |
| `--dsw-mask-blur` | 1 | 玻璃(1) | 572 |  |
| `--dsw-specific-bubble` | 4 | 玻璃(2) + 无门控(2) | 543, 553, 990, 1004 |  |
| `--dsw-specific-input-major` | 2 | 玻璃(2) | 540, 550 |  |
| `--dsw-specific-selector` | 1 | 玻璃(1) | 3175 |  |
| `--dsw-specific-sidebar-fill` | 4 | 壁纸(4) | 223, 344, 432, 1027 | 侧栏填充（宿主 Mica/深色主题各有一份） |
| `--dsw-specific-sidebar-nav-item-active` | 2 | 玻璃(2) | 1538, 1598 |  |
| `--dsw-specific-sidebar-nav-item-hover` | 2 | 玻璃(2) | 1539, 1599 |  |
