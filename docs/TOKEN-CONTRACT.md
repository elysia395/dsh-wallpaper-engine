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
| `--dsw-specific-bubble` | packages/glass/src/glass-css.js:1083 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-block` | packages/glass/src/glass-css.js:1084 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-block-banner` | packages/glass/src/glass-css.js:1085 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-inline-code` | packages/glass/src/glass-css.js:1086 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-tag` | packages/glass/src/glass-css.js:1087 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-segment-unselected` | packages/glass/src/glass-css.js:1088 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-segment-selected` | packages/glass/src/glass-css.js:1089 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-citation` | packages/glass/src/glass-css.js:1090 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-placeholder` | packages/glass/src/glass-css.js:1091 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-specific-bubble` | packages/glass/src/glass-css.js:1097 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-block` | packages/glass/src/glass-css.js:1098 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-block-banner` | packages/glass/src/glass-css.js:1099 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-inline-code` | packages/glass/src/glass-css.js:1100 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-tag` | packages/glass/src/glass-css.js:1101 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-segment-unselected` | packages/glass/src/glass-css.js:1102 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-segment-selected` | packages/glass/src/glass-css.js:1103 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-citation` | packages/glass/src/glass-css.js:1104 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-placeholder` | packages/glass/src/glass-css.js:1105 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |

## 全量令牌表

| 令牌 | 条数 | 门控 | 行号 | 消费者注记 |
|---|---|---|---|---|
| `--dsw-alias-bg-base` | 2 | 壁纸(2) | src/styles/base.js:212, src/styles/base.js:215 | 页面基底 —— 壁纸可见性的关键前提（transparent） |
| `--dsw-alias-bg-layer-1` | 19 | 玻璃(18) + 无门控(1) | src/styles/base.js:61, src/styles/panel.js:384, src/styles/panel.js:397, packages/glass/src/glass-css.js:144, packages/glass/src/glass-css.js:247, packages/glass/src/glass-css.js:345, packages/glass/src/glass-css.js:1599, packages/glass/src/glass-css.js:1670, packages/glass/src/glass-css.js:1681, packages/glass/src/glass-css.js:1706, packages/glass/src/glass-css.js:1711, packages/glass/src/glass-css.js:1720, packages/glass/src/glass-css.js:1811, packages/glass/src/glass-css.js:1816, packages/glass/src/glass-css.js:1886, packages/glass/src/glass-css.js:1895, packages/glass/src/glass-css.js:1906, packages/glass/src/glass-css.js:2102, packages/glass/src/glass-css.js:2107 | 面板层次 1（宿主对话框/侧栏底）；better-sidebar 亦按它上色 |
| `--dsw-alias-bg-layer-2` | 17 | 玻璃(17) | src/styles/panel.js:387, src/styles/panel.js:400, packages/glass/src/glass-css.js:147, packages/glass/src/glass-css.js:250, packages/glass/src/glass-css.js:346, packages/glass/src/glass-css.js:901, packages/glass/src/glass-css.js:1602, packages/glass/src/glass-css.js:1671, packages/glass/src/glass-css.js:1684, packages/glass/src/glass-css.js:1707, packages/glass/src/glass-css.js:1712, packages/glass/src/glass-css.js:1721, packages/glass/src/glass-css.js:1887, packages/glass/src/glass-css.js:1896, packages/glass/src/glass-css.js:1907, packages/glass/src/glass-css.js:2103, packages/glass/src/glass-css.js:2108 | 面板层次 2 |
| `--dsw-alias-bg-layer-3` | 16 | 玻璃(16) | src/styles/panel.js:390, src/styles/panel.js:403, packages/glass/src/glass-css.js:150, packages/glass/src/glass-css.js:253, packages/glass/src/glass-css.js:347, packages/glass/src/glass-css.js:1605, packages/glass/src/glass-css.js:1672, packages/glass/src/glass-css.js:1687, packages/glass/src/glass-css.js:1708, packages/glass/src/glass-css.js:1713, packages/glass/src/glass-css.js:1722, packages/glass/src/glass-css.js:1888, packages/glass/src/glass-css.js:1897, packages/glass/src/glass-css.js:1908, packages/glass/src/glass-css.js:2104, packages/glass/src/glass-css.js:2109 | 面板层次 3 |
| `--dsw-alias-bg-mask-1` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:246, packages/glass/src/glass-css.js:507 |  |
| `--dsw-alias-bg-module-platform` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:165, packages/glass/src/glass-css.js:263 |  |
| `--dsw-alias-bg-multi-select` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:168, packages/glass/src/glass-css.js:266 |  |
| `--dsw-alias-bg-overlay` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:162, packages/glass/src/glass-css.js:260 | 弹层/浮出层底（issue #71 全表面玻璃） |
| `--dsw-alias-border-l1` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:226, packages/glass/src/glass-css.js:312 | 边框强调 L1（「边框」滑条） |
| `--dsw-alias-border-l2` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:227, packages/glass/src/glass-css.js:313 | 边框强调 L2 |
| `--dsw-alias-border-l2-darkmode-thin` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:228, packages/glass/src/glass-css.js:314 | 深色细边框 |
| `--dsw-alias-border-l3` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:230, packages/glass/src/glass-css.js:316, packages/glass/src/glass-css.js:1148 |  |
| `--dsw-alias-border-l4` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:231, packages/glass/src/glass-css.js:317 |  |
| `--dsw-alias-brand-primary` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:1156, packages/glass/src/glass-css.js:1340, packages/glass/src/glass-css.js:1618 |  |
| `--dsw-alias-brand-text` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:1157, packages/glass/src/glass-css.js:1341, packages/glass/src/glass-css.js:1619 |  |
| `--dsw-alias-button-elevated-fill` | 5 | 玻璃(5) | packages/glass/src/glass-css.js:153, packages/glass/src/glass-css.js:256, packages/glass/src/glass-css.js:1673, packages/glass/src/glass-css.js:1723, packages/glass/src/glass-css.js:1909 | 抬高按钮实色（侧栏「新建会话」等） |
| `--dsw-alias-button-floating-fill` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:171, packages/glass/src/glass-css.js:269, packages/glass/src/glass-css.js:903 |  |
| `--dsw-alias-button-floating-hover` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:904 |  |
| `--dsw-alias-button-ghost-active-fill` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:174, packages/glass/src/glass-css.js:272 |  |
| `--dsw-alias-button-info-fill` | 1 | UI 配色(1) | src/styles/base.js:405 |  |
| `--dsw-alias-button-info-hover` | 1 | UI 配色(1) | src/styles/base.js:406 |  |
| `--dsw-alias-button-primary-dimmed` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:1622 |  |
| `--dsw-alias-button-primary-fill` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:1620 |  |
| `--dsw-alias-button-primary-hover` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:1621 |  |
| `--dsw-alias-button-tool-bar-fill` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:177, packages/glass/src/glass-css.js:275 |  |
| `--dsw-alias-interactive-bg-active` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:180, packages/glass/src/glass-css.js:278 |  |
| `--dsw-alias-interactive-bg-hover` | 6 | 玻璃(6) | packages/glass/src/glass-css.js:902, packages/glass/src/glass-css.js:1153, packages/glass/src/glass-css.js:1188, packages/glass/src/glass-css.js:1337, packages/glass/src/glass-css.js:1375, packages/glass/src/glass-css.js:1611 |  |
| `--dsw-alias-interactive-bg-hover-accent` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:1154, packages/glass/src/glass-css.js:1338, packages/glass/src/glass-css.js:1612 |  |
| `--dsw-alias-interactive-bg-hover-solid` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:183, packages/glass/src/glass-css.js:281 |  |
| `--dsw-alias-label-caption` | 1 | 玻璃(1) | src/styles/base.js:337 |  |
| `--dsw-alias-label-deep-diving` | 2 | UI 配色(2) | src/styles/base.js:374, src/styles/base.js:392 |  |
| `--dsw-alias-label-deep-diving-shimmer` | 2 | UI 配色(2) | src/styles/base.js:376, src/styles/base.js:393 |  |
| `--dsw-alias-label-dimmed` | 1 | 玻璃(1) | src/styles/base.js:338 |  |
| `--dsw-alias-label-primary` | 1 | 玻璃(1) | src/styles/base.js:333 | 正文灰阶（壁纸激活时压暗提对比） |
| `--dsw-alias-label-primary-dimmed` | 1 | 玻璃(1) | src/styles/base.js:334 |  |
| `--dsw-alias-label-primary-foreground` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:1629 |  |
| `--dsw-alias-label-secondary` | 1 | 玻璃(1) | src/styles/base.js:335 | 次要文字灰阶 |
| `--dsw-alias-label-tertiary` | 1 | 玻璃(1) | src/styles/base.js:336 |  |
| `--dsw-alias-link` | 3 | UI 配色(3) | src/styles/base.js:373, src/styles/base.js:391, src/styles/base.js:411 |  |
| `--dsw-alias-markdown-citation` | 4 | 玻璃(2) + 无门控(2) | packages/glass/src/glass-css.js:186, packages/glass/src/glass-css.js:284, packages/glass/src/glass-css.js:1090, packages/glass/src/glass-css.js:1104 |  |
| `--dsw-alias-markdown-code-block` | 6 | 玻璃(4) + 无门控(2) | packages/glass/src/glass-css.js:204, packages/glass/src/glass-css.js:294, packages/glass/src/glass-css.js:935, packages/glass/src/glass-css.js:1084, packages/glass/src/glass-css.js:1098, packages/glass/src/glass-css.js:1726 | markdown 代码块底 |
| `--dsw-alias-markdown-code-block-banner` | 6 | 玻璃(4) + 无门控(2) | packages/glass/src/glass-css.js:207, packages/glass/src/glass-css.js:297, packages/glass/src/glass-css.js:936, packages/glass/src/glass-css.js:1085, packages/glass/src/glass-css.js:1099, packages/glass/src/glass-css.js:1727 | markdown 代码条幅底 |
| `--dsw-alias-markdown-code-segment-selected` | 5 | 玻璃(3) + 无门控(2) | packages/glass/src/glass-css.js:221, packages/glass/src/glass-css.js:309, packages/glass/src/glass-css.js:1089, packages/glass/src/glass-css.js:1103, packages/glass/src/glass-css.js:1731 | 代码卡分段（选中） |
| `--dsw-alias-markdown-code-segment-unselected` | 5 | 玻璃(3) + 无门控(2) | packages/glass/src/glass-css.js:216, packages/glass/src/glass-css.js:306, packages/glass/src/glass-css.js:1088, packages/glass/src/glass-css.js:1102, packages/glass/src/glass-css.js:1730 | 代码卡分段（未选中） |
| `--dsw-alias-markdown-inline-code` | 6 | 玻璃(4) + 无门控(2) | packages/glass/src/glass-css.js:210, packages/glass/src/glass-css.js:300, packages/glass/src/glass-css.js:792, packages/glass/src/glass-css.js:1086, packages/glass/src/glass-css.js:1100, packages/glass/src/glass-css.js:1728 | 行内代码底 |
| `--dsw-alias-markdown-placeholder` | 4 | 玻璃(2) + 无门控(2) | packages/glass/src/glass-css.js:189, packages/glass/src/glass-css.js:287, packages/glass/src/glass-css.js:1091, packages/glass/src/glass-css.js:1105 |  |
| `--dsw-alias-markdown-tag` | 5 | 玻璃(3) + 无门控(2) | packages/glass/src/glass-css.js:213, packages/glass/src/glass-css.js:303, packages/glass/src/glass-css.js:1087, packages/glass/src/glass-css.js:1101, packages/glass/src/glass-css.js:1729 | markdown 标签底 |
| `--dsw-alias-scrollbar-bg-l1` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:521, packages/glass/src/glass-css.js:532 |  |
| `--dsw-alias-scrollbar-bg-l2` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:522, packages/glass/src/glass-css.js:533 |  |
| `--dsw-alias-scrollbar-hover-l1` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:523, packages/glass/src/glass-css.js:534 |  |
| `--dsw-alias-scrollbar-hover-l2` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:524, packages/glass/src/glass-css.js:535 |  |
| `--dsw-alias-state-business-primary` | 5 | 玻璃(3) + UI 配色(2) | src/styles/base.js:377, src/styles/base.js:394, packages/glass/src/glass-css.js:1155, packages/glass/src/glass-css.js:1339, packages/glass/src/glass-css.js:1623 |  |
| `--dsw-alias-turn-trigger-bg` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:674, packages/glass/src/glass-css.js:684, packages/glass/src/glass-css.js:1920 |  |
| `--dsw-alias-turn-trigger-bg-hover` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:677, packages/glass/src/glass-css.js:687, packages/glass/src/glass-css.js:1921 |  |
| `--dsw-mask-blur` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:508 |  |
| `--dsw-specific-bubble` | 4 | 玻璃(2) + 无门控(2) | packages/glass/src/glass-css.js:476, packages/glass/src/glass-css.js:486, packages/glass/src/glass-css.js:1083, packages/glass/src/glass-css.js:1097 |  |
| `--dsw-specific-input-major` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:473, packages/glass/src/glass-css.js:483 |  |
| `--dsw-specific-selector` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:1910 |  |
| `--dsw-specific-sidebar-fill` | 4 | 玻璃(3) + 壁纸(1) | src/styles/base.js:218, src/styles/base.js:221, src/styles/shell.js:40, packages/glass/src/glass-css.js:441 | 侧栏填充（宿主 Mica/深色主题各有一份） |
| `--dsw-specific-sidebar-nav-item-active` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:1609, packages/glass/src/glass-css.js:1690 |  |
| `--dsw-specific-sidebar-nav-item-hover` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:1610, packages/glass/src/glass-css.js:1691 |  |
