# `--dsw-*` 令牌契约（自动生成，勿手改）

> 生成：`node test/tools/token-contract.mjs --write`；核对：`node test/verify-token-contract.mjs`
> （守卫在契约与代码不一致时失败 —— 令牌集合因此不会烂掉）。
>
> **口径**：只计样式族（`src/styles/base.js` … `src/styles/ext.js` 的 8 个域模板）里**属性位**的
> `--dsw-*` 声明（值里的 `var(--dsw-…)` 是读不是写，不计）；门控归属按花括号栈上的**选择器链**判定。
> **玻璃** = 链上有 `[data-we-glass-*]`；**UI 配色** = 链上有 `[data-we-ui-color]`（主包自有门，ADR-0016）；
> **壁纸** = 只有 `[data-we-wallpaper]`；
> **无门控** = 两者都不挂（共存审计 M1 的全部暴露面 —— 白名单见下表，新增一条守卫即红）。
> JS 侧的令牌写入（`src/font/apply.js` 的 label 族等）不在本契约口径内，见 `docs/CODE-STRUCTURE.md` §13。

共 **200** 条声明 / **61** 个不同令牌。门控归属：
玻璃 **167** 条 · UI 配色 **11** 条 · 壁纸 **3** 条 · 无门控 **19** 条。

## 无门控声明（白名单 —— M1 的全部暴露面）

除下列封闭白名单外，**任何新的无门控 `--dsw-*` 声明都会让 `verify-token-contract` 变红**
（白名单 = `body[data-we-thinking-native]` 思考块自带开关 + 插件自有 bare roots 封闭集
`{.we-layer, .we-picker, .we-picker__modal, .we-qp}` —— 整条选择器链必须是纯逗号列表、
每段 trim 后精确命中集合成员，不认 `.we-*` 前缀/子串，拒未知根/混组；
按宿主规范消费 token 的第三方插件无法区分「玻璃开/关」，只能拿到配方本身 —— 见 `docs/HOW-IT-WORKS.md` §共存）。

| 令牌 | 行 | 选择器链 | 归属 |
|---|---|---|---|
| `--dsw-alias-bg-layer-1` | src/styles/base.js:61 | `.we-layer` | .we-layer（插件自有元素，卸载即消失） |
| `--dsw-specific-bubble` | packages/glass/src/glass-css.js:1027 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-block` | packages/glass/src/glass-css.js:1028 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-block-banner` | packages/glass/src/glass-css.js:1029 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-inline-code` | packages/glass/src/glass-css.js:1030 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-tag` | packages/glass/src/glass-css.js:1031 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-segment-unselected` | packages/glass/src/glass-css.js:1032 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-segment-selected` | packages/glass/src/glass-css.js:1033 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-citation` | packages/glass/src/glass-css.js:1034 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-placeholder` | packages/glass/src/glass-css.js:1035 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-specific-bubble` | packages/glass/src/glass-css.js:1041 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-block` | packages/glass/src/glass-css.js:1042 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-block-banner` | packages/glass/src/glass-css.js:1043 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-inline-code` | packages/glass/src/glass-css.js:1044 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-tag` | packages/glass/src/glass-css.js:1045 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-segment-unselected` | packages/glass/src/glass-css.js:1046 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-segment-selected` | packages/glass/src/glass-css.js:1047 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-citation` | packages/glass/src/glass-css.js:1048 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-placeholder` | packages/glass/src/glass-css.js:1049 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |

## 全量令牌表

| 令牌 | 条数 | 门控 | 行号 | 消费者注记 |
|---|---|---|---|---|
| `--dsw-alias-bg-base` | 2 | 壁纸(2) | src/styles/base.js:212, src/styles/base.js:215 | 页面基底 —— 壁纸可见性的关键前提（transparent） |
| `--dsw-alias-bg-layer-1` | 19 | 玻璃(18) + 无门控(1) | src/styles/base.js:61, src/styles/panel.js:384, src/styles/panel.js:397, packages/glass/src/glass-css.js:136, packages/glass/src/glass-css.js:239, packages/glass/src/glass-css.js:337, packages/glass/src/glass-css.js:1543, packages/glass/src/glass-css.js:1614, packages/glass/src/glass-css.js:1625, packages/glass/src/glass-css.js:1650, packages/glass/src/glass-css.js:1655, packages/glass/src/glass-css.js:1664, packages/glass/src/glass-css.js:1755, packages/glass/src/glass-css.js:1760, packages/glass/src/glass-css.js:1830, packages/glass/src/glass-css.js:1839, packages/glass/src/glass-css.js:1850, packages/glass/src/glass-css.js:2035, packages/glass/src/glass-css.js:2040 | 面板层次 1（宿主对话框/侧栏底）；better-sidebar 亦按它上色 |
| `--dsw-alias-bg-layer-2` | 17 | 玻璃(17) | src/styles/panel.js:387, src/styles/panel.js:400, packages/glass/src/glass-css.js:139, packages/glass/src/glass-css.js:242, packages/glass/src/glass-css.js:338, packages/glass/src/glass-css.js:860, packages/glass/src/glass-css.js:1546, packages/glass/src/glass-css.js:1615, packages/glass/src/glass-css.js:1628, packages/glass/src/glass-css.js:1651, packages/glass/src/glass-css.js:1656, packages/glass/src/glass-css.js:1665, packages/glass/src/glass-css.js:1831, packages/glass/src/glass-css.js:1840, packages/glass/src/glass-css.js:1851, packages/glass/src/glass-css.js:2036, packages/glass/src/glass-css.js:2041 | 面板层次 2 |
| `--dsw-alias-bg-layer-3` | 16 | 玻璃(16) | src/styles/panel.js:390, src/styles/panel.js:403, packages/glass/src/glass-css.js:142, packages/glass/src/glass-css.js:245, packages/glass/src/glass-css.js:339, packages/glass/src/glass-css.js:1549, packages/glass/src/glass-css.js:1616, packages/glass/src/glass-css.js:1631, packages/glass/src/glass-css.js:1652, packages/glass/src/glass-css.js:1657, packages/glass/src/glass-css.js:1666, packages/glass/src/glass-css.js:1832, packages/glass/src/glass-css.js:1841, packages/glass/src/glass-css.js:1852, packages/glass/src/glass-css.js:2037, packages/glass/src/glass-css.js:2042 | 面板层次 3 |
| `--dsw-alias-bg-mask-1` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:238, packages/glass/src/glass-css.js:488 |  |
| `--dsw-alias-bg-module-platform` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:157, packages/glass/src/glass-css.js:255 |  |
| `--dsw-alias-bg-multi-select` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:160, packages/glass/src/glass-css.js:258 |  |
| `--dsw-alias-bg-overlay` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:154, packages/glass/src/glass-css.js:252 | 弹层/浮出层底（issue #71 全表面玻璃） |
| `--dsw-alias-border-l1` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:218, packages/glass/src/glass-css.js:304 | 边框强调 L1（「边框」滑条） |
| `--dsw-alias-border-l2` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:219, packages/glass/src/glass-css.js:305 | 边框强调 L2 |
| `--dsw-alias-border-l2-darkmode-thin` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:220, packages/glass/src/glass-css.js:306 | 深色细边框 |
| `--dsw-alias-border-l3` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:222, packages/glass/src/glass-css.js:308, packages/glass/src/glass-css.js:1092 |  |
| `--dsw-alias-border-l4` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:223, packages/glass/src/glass-css.js:309 |  |
| `--dsw-alias-brand-primary` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:1100, packages/glass/src/glass-css.js:1284, packages/glass/src/glass-css.js:1562 |  |
| `--dsw-alias-brand-text` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:1101, packages/glass/src/glass-css.js:1285, packages/glass/src/glass-css.js:1563 |  |
| `--dsw-alias-button-elevated-fill` | 5 | 玻璃(5) | packages/glass/src/glass-css.js:145, packages/glass/src/glass-css.js:248, packages/glass/src/glass-css.js:1617, packages/glass/src/glass-css.js:1667, packages/glass/src/glass-css.js:1853 | 抬高按钮实色（侧栏「新建会话」等） |
| `--dsw-alias-button-floating-fill` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:163, packages/glass/src/glass-css.js:261, packages/glass/src/glass-css.js:862 |  |
| `--dsw-alias-button-floating-hover` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:863 |  |
| `--dsw-alias-button-ghost-active-fill` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:166, packages/glass/src/glass-css.js:264 |  |
| `--dsw-alias-button-info-fill` | 1 | UI 配色(1) | src/styles/base.js:405 |  |
| `--dsw-alias-button-info-hover` | 1 | UI 配色(1) | src/styles/base.js:406 |  |
| `--dsw-alias-button-primary-dimmed` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:1566 |  |
| `--dsw-alias-button-primary-fill` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:1564 |  |
| `--dsw-alias-button-primary-hover` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:1565 |  |
| `--dsw-alias-button-tool-bar-fill` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:169, packages/glass/src/glass-css.js:267 |  |
| `--dsw-alias-interactive-bg-active` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:172, packages/glass/src/glass-css.js:270 |  |
| `--dsw-alias-interactive-bg-hover` | 6 | 玻璃(6) | packages/glass/src/glass-css.js:861, packages/glass/src/glass-css.js:1097, packages/glass/src/glass-css.js:1132, packages/glass/src/glass-css.js:1281, packages/glass/src/glass-css.js:1319, packages/glass/src/glass-css.js:1555 |  |
| `--dsw-alias-interactive-bg-hover-accent` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:1098, packages/glass/src/glass-css.js:1282, packages/glass/src/glass-css.js:1556 |  |
| `--dsw-alias-interactive-bg-hover-solid` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:175, packages/glass/src/glass-css.js:273 |  |
| `--dsw-alias-label-caption` | 1 | 玻璃(1) | src/styles/base.js:337 |  |
| `--dsw-alias-label-deep-diving` | 2 | UI 配色(2) | src/styles/base.js:374, src/styles/base.js:392 |  |
| `--dsw-alias-label-deep-diving-shimmer` | 2 | UI 配色(2) | src/styles/base.js:376, src/styles/base.js:393 |  |
| `--dsw-alias-label-dimmed` | 1 | 玻璃(1) | src/styles/base.js:338 |  |
| `--dsw-alias-label-primary` | 1 | 玻璃(1) | src/styles/base.js:333 | 正文灰阶（壁纸激活时压暗提对比） |
| `--dsw-alias-label-primary-dimmed` | 1 | 玻璃(1) | src/styles/base.js:334 |  |
| `--dsw-alias-label-primary-foreground` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:1573 |  |
| `--dsw-alias-label-secondary` | 1 | 玻璃(1) | src/styles/base.js:335 | 次要文字灰阶 |
| `--dsw-alias-label-tertiary` | 1 | 玻璃(1) | src/styles/base.js:336 |  |
| `--dsw-alias-link` | 3 | UI 配色(3) | src/styles/base.js:373, src/styles/base.js:391, src/styles/base.js:411 |  |
| `--dsw-alias-markdown-citation` | 4 | 玻璃(2) + 无门控(2) | packages/glass/src/glass-css.js:178, packages/glass/src/glass-css.js:276, packages/glass/src/glass-css.js:1034, packages/glass/src/glass-css.js:1048 |  |
| `--dsw-alias-markdown-code-block` | 6 | 玻璃(4) + 无门控(2) | packages/glass/src/glass-css.js:196, packages/glass/src/glass-css.js:286, packages/glass/src/glass-css.js:894, packages/glass/src/glass-css.js:1028, packages/glass/src/glass-css.js:1042, packages/glass/src/glass-css.js:1670 | markdown 代码块底 |
| `--dsw-alias-markdown-code-block-banner` | 6 | 玻璃(4) + 无门控(2) | packages/glass/src/glass-css.js:199, packages/glass/src/glass-css.js:289, packages/glass/src/glass-css.js:895, packages/glass/src/glass-css.js:1029, packages/glass/src/glass-css.js:1043, packages/glass/src/glass-css.js:1671 | markdown 代码条幅底 |
| `--dsw-alias-markdown-code-segment-selected` | 5 | 玻璃(3) + 无门控(2) | packages/glass/src/glass-css.js:213, packages/glass/src/glass-css.js:301, packages/glass/src/glass-css.js:1033, packages/glass/src/glass-css.js:1047, packages/glass/src/glass-css.js:1675 | 代码卡分段（选中） |
| `--dsw-alias-markdown-code-segment-unselected` | 5 | 玻璃(3) + 无门控(2) | packages/glass/src/glass-css.js:208, packages/glass/src/glass-css.js:298, packages/glass/src/glass-css.js:1032, packages/glass/src/glass-css.js:1046, packages/glass/src/glass-css.js:1674 | 代码卡分段（未选中） |
| `--dsw-alias-markdown-inline-code` | 6 | 玻璃(4) + 无门控(2) | packages/glass/src/glass-css.js:202, packages/glass/src/glass-css.js:292, packages/glass/src/glass-css.js:773, packages/glass/src/glass-css.js:1030, packages/glass/src/glass-css.js:1044, packages/glass/src/glass-css.js:1672 | 行内代码底 |
| `--dsw-alias-markdown-placeholder` | 4 | 玻璃(2) + 无门控(2) | packages/glass/src/glass-css.js:181, packages/glass/src/glass-css.js:279, packages/glass/src/glass-css.js:1035, packages/glass/src/glass-css.js:1049 |  |
| `--dsw-alias-markdown-tag` | 5 | 玻璃(3) + 无门控(2) | packages/glass/src/glass-css.js:205, packages/glass/src/glass-css.js:295, packages/glass/src/glass-css.js:1031, packages/glass/src/glass-css.js:1045, packages/glass/src/glass-css.js:1673 | markdown 标签底 |
| `--dsw-alias-scrollbar-bg-l1` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:502, packages/glass/src/glass-css.js:513 |  |
| `--dsw-alias-scrollbar-bg-l2` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:503, packages/glass/src/glass-css.js:514 |  |
| `--dsw-alias-scrollbar-hover-l1` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:504, packages/glass/src/glass-css.js:515 |  |
| `--dsw-alias-scrollbar-hover-l2` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:505, packages/glass/src/glass-css.js:516 |  |
| `--dsw-alias-state-business-primary` | 5 | 玻璃(3) + UI 配色(2) | src/styles/base.js:377, src/styles/base.js:394, packages/glass/src/glass-css.js:1099, packages/glass/src/glass-css.js:1283, packages/glass/src/glass-css.js:1567 |  |
| `--dsw-alias-turn-trigger-bg` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:655, packages/glass/src/glass-css.js:665, packages/glass/src/glass-css.js:1864 |  |
| `--dsw-alias-turn-trigger-bg-hover` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:658, packages/glass/src/glass-css.js:668, packages/glass/src/glass-css.js:1865 |  |
| `--dsw-mask-blur` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:489 |  |
| `--dsw-specific-bubble` | 4 | 玻璃(2) + 无门控(2) | packages/glass/src/glass-css.js:457, packages/glass/src/glass-css.js:467, packages/glass/src/glass-css.js:1027, packages/glass/src/glass-css.js:1041 |  |
| `--dsw-specific-input-major` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:454, packages/glass/src/glass-css.js:464 |  |
| `--dsw-specific-selector` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:1854 |  |
| `--dsw-specific-sidebar-fill` | 4 | 玻璃(3) + 壁纸(1) | src/styles/base.js:218, src/styles/base.js:221, src/styles/shell.js:40, packages/glass/src/glass-css.js:422 | 侧栏填充（宿主 Mica/深色主题各有一份） |
| `--dsw-specific-sidebar-nav-item-active` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:1553, packages/glass/src/glass-css.js:1634 |  |
| `--dsw-specific-sidebar-nav-item-hover` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:1554, packages/glass/src/glass-css.js:1635 |  |
