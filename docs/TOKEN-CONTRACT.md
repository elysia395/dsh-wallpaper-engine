# `--dsw-*` 令牌契约（自动生成，勿手改）

> 生成：`node test/tools/token-contract.mjs --write`；核对：`node test/verify-token-contract.mjs`
> （守卫在契约与代码不一致时失败 —— 令牌集合因此不会烂掉）。
>
> **口径**：只计 `src/styles.js` CSS 模板里**属性位**的 `--dsw-*` 声明（值里的
> `var(--dsw-…)` 是读不是写，不计）；门控归属按花括号栈上的**选择器链**判定。
> **玻璃** = 链上有 `[data-we-glass-*]`；**壁纸** = 只有 `[data-we-wallpaper]`；
> **无门控** = 两者都不挂（共存审计 M1 的全部暴露面 —— 白名单见下表，新增一条守卫即红）。
> JS 侧的令牌写入（`src/font/apply.js` 的 label 族等）不在本契约口径内，见 `docs/DSH-UI-INTERFACES.md`。

共 **173** 条声明 / **59** 个不同令牌。门控归属：
玻璃 **142** 条 · 壁纸 **12** 条 · 无门控 **19** 条。

## 无门控声明（白名单 —— M1 的全部暴露面）

除下列两处封闭白名单外，**任何新的无门控 `--dsw-*` 声明都会让 `verify-token-contract` 变红**
（按宿主规范消费 token 的第三方插件无法区分「玻璃开/关」，只能拿到配方本身 —— 见 `docs/COEXISTENCE.md`）。

| 令牌 | 行 | 选择器链 | 归属 |
|---|---|---|---|
| `--dsw-alias-bg-layer-1` | styles.js:96 | `.we-layer` | .we-layer（插件自有元素，卸载即消失） |
| `--dsw-specific-bubble` | styles.js:1089 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-block` | styles.js:1090 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-block-banner` | styles.js:1091 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-inline-code` | styles.js:1092 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-tag` | styles.js:1093 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-segment-unselected` | styles.js:1094 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-segment-selected` | styles.js:1095 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-citation` | styles.js:1096 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-placeholder` | styles.js:1097 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-specific-bubble` | styles.js:1103 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-block` | styles.js:1104 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-block-banner` | styles.js:1105 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-inline-code` | styles.js:1106 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-tag` | styles.js:1107 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-segment-unselected` | styles.js:1108 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-segment-selected` | styles.js:1109 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-citation` | styles.js:1110 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-placeholder` | styles.js:1111 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |

## 全量令牌表

| 令牌 | 条数 | 门控 | 行号 | 消费者注记 |
|---|---|---|---|---|
| `--dsw-alias-bg-base` | 2 | 壁纸(2) | 222, 343 | 页面基底 —— 壁纸可见性的关键前提（transparent） |
| `--dsw-alias-bg-layer-1` | 11 | 玻璃(10) + 无门控(1) | 96, 248, 366, 1683, 1744, 1766, 1771, 1780, 3463, 3470, 3481 | 面板层次 1（宿主对话框/侧栏底）；better-sidebar 亦按它上色 |
| `--dsw-alias-bg-layer-2` | 11 | 玻璃(11) | 251, 369, 920, 1686, 1747, 1767, 1772, 1781, 3464, 3471, 3482 | 面板层次 2 |
| `--dsw-alias-bg-layer-3` | 10 | 玻璃(10) | 254, 372, 1689, 1750, 1768, 1773, 1782, 3465, 3472, 3483 | 面板层次 3 |
| `--dsw-alias-bg-module-platform` | 2 | 玻璃(2) | 269, 382 |  |
| `--dsw-alias-bg-multi-select` | 2 | 玻璃(2) | 272, 385 |  |
| `--dsw-alias-bg-overlay` | 2 | 玻璃(2) | 266, 379 | 弹层/浮出层底（issue #71 全表面玻璃） |
| `--dsw-alias-border-l1` | 2 | 玻璃(2) | 330, 431 | 边框强调 L1（「边框」滑条） |
| `--dsw-alias-border-l2` | 2 | 玻璃(2) | 331, 432 | 边框强调 L2 |
| `--dsw-alias-border-l2-darkmode-thin` | 2 | 玻璃(2) | 332, 433 | 深色细边框 |
| `--dsw-alias-border-l3` | 1 | 玻璃(1) | 1197 |  |
| `--dsw-alias-brand-primary` | 3 | 玻璃(3) | 1205, 1365, 1702 |  |
| `--dsw-alias-brand-text` | 3 | 玻璃(3) | 1206, 1366, 1703 |  |
| `--dsw-alias-button-elevated-fill` | 4 | 玻璃(4) | 257, 375, 1783, 3484 | 抬高按钮实色（侧栏「新建会话」等） |
| `--dsw-alias-button-floating-fill` | 3 | 玻璃(3) | 275, 388, 922 |  |
| `--dsw-alias-button-floating-hover` | 1 | 玻璃(1) | 923 |  |
| `--dsw-alias-button-ghost-active-fill` | 2 | 玻璃(2) | 278, 391 |  |
| `--dsw-alias-button-info-fill` | 1 | 玻璃(1) | 524 |  |
| `--dsw-alias-button-info-hover` | 1 | 玻璃(1) | 525 |  |
| `--dsw-alias-button-primary-dimmed` | 1 | 玻璃(1) | 1706 |  |
| `--dsw-alias-button-primary-fill` | 1 | 玻璃(1) | 1704 |  |
| `--dsw-alias-button-primary-hover` | 1 | 玻璃(1) | 1705 |  |
| `--dsw-alias-button-tool-bar-fill` | 2 | 玻璃(2) | 281, 394 |  |
| `--dsw-alias-interactive-bg-active` | 2 | 玻璃(2) | 284, 397 |  |
| `--dsw-alias-interactive-bg-hover` | 6 | 玻璃(6) | 921, 1202, 1233, 1362, 1400, 1695 |  |
| `--dsw-alias-interactive-bg-hover-accent` | 3 | 玻璃(3) | 1203, 1363, 1696 |  |
| `--dsw-alias-interactive-bg-hover-solid` | 2 | 玻璃(2) | 287, 400 |  |
| `--dsw-alias-label-caption` | 1 | 壁纸(1) | 464 |  |
| `--dsw-alias-label-deep-diving` | 2 | 玻璃(2) | 499, 511 |  |
| `--dsw-alias-label-deep-diving-shimmer` | 2 | 玻璃(2) | 501, 512 |  |
| `--dsw-alias-label-dimmed` | 1 | 壁纸(1) | 465 |  |
| `--dsw-alias-label-primary` | 1 | 壁纸(1) | 460 | 正文灰阶（壁纸激活时压暗提对比） |
| `--dsw-alias-label-primary-dimmed` | 1 | 壁纸(1) | 461 |  |
| `--dsw-alias-label-primary-foreground` | 1 | 玻璃(1) | 1713 |  |
| `--dsw-alias-label-secondary` | 1 | 壁纸(1) | 462 | 次要文字灰阶 |
| `--dsw-alias-label-tertiary` | 1 | 壁纸(1) | 463 |  |
| `--dsw-alias-link` | 3 | 玻璃(3) | 498, 510, 530 |  |
| `--dsw-alias-markdown-citation` | 4 | 玻璃(2) + 无门控(2) | 290, 403, 1096, 1110 |  |
| `--dsw-alias-markdown-code-block` | 6 | 玻璃(4) + 无门控(2) | 308, 413, 956, 1090, 1104, 1786 | markdown 代码块底 |
| `--dsw-alias-markdown-code-block-banner` | 6 | 玻璃(4) + 无门控(2) | 311, 416, 957, 1091, 1105, 1787 | markdown 代码条幅底 |
| `--dsw-alias-markdown-code-segment-selected` | 5 | 玻璃(3) + 无门控(2) | 325, 428, 1095, 1109, 1791 | 代码卡分段（选中） |
| `--dsw-alias-markdown-code-segment-unselected` | 5 | 玻璃(3) + 无门控(2) | 320, 425, 1094, 1108, 1790 | 代码卡分段（未选中） |
| `--dsw-alias-markdown-inline-code` | 6 | 玻璃(4) + 无门控(2) | 314, 419, 883, 1092, 1106, 1788 | 行内代码底 |
| `--dsw-alias-markdown-placeholder` | 4 | 玻璃(2) + 无门控(2) | 293, 406, 1097, 1111 |  |
| `--dsw-alias-markdown-tag` | 5 | 玻璃(3) + 无门控(2) | 317, 422, 1093, 1107, 1789 | markdown 标签底 |
| `--dsw-alias-scrollbar-bg-l1` | 2 | 玻璃(2) | 680, 691 |  |
| `--dsw-alias-scrollbar-bg-l2` | 2 | 玻璃(2) | 681, 692 |  |
| `--dsw-alias-scrollbar-hover-l1` | 2 | 玻璃(2) | 682, 693 |  |
| `--dsw-alias-scrollbar-hover-l2` | 2 | 玻璃(2) | 683, 694 |  |
| `--dsw-alias-state-business-primary` | 5 | 玻璃(5) | 502, 513, 1204, 1364, 1707 |  |
| `--dsw-alias-turn-trigger-bg` | 3 | 玻璃(3) | 765, 775, 3495 |  |
| `--dsw-alias-turn-trigger-bg-hover` | 3 | 玻璃(3) | 768, 778, 3496 |  |
| `--dsw-mask-blur` | 1 | 玻璃(1) | 667 |  |
| `--dsw-specific-bubble` | 4 | 玻璃(2) + 无门控(2) | 638, 648, 1089, 1103 |  |
| `--dsw-specific-input-major` | 2 | 玻璃(2) | 635, 645 |  |
| `--dsw-specific-selector` | 1 | 玻璃(1) | 3485 |  |
| `--dsw-specific-sidebar-fill` | 4 | 壁纸(4) | 223, 344, 449, 1126 | 侧栏填充（宿主 Mica/深色主题各有一份） |
| `--dsw-specific-sidebar-nav-item-active` | 2 | 玻璃(2) | 1693, 1753 |  |
| `--dsw-specific-sidebar-nav-item-hover` | 2 | 玻璃(2) | 1694, 1754 |  |
