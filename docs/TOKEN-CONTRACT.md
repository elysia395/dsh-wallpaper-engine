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
| `--dsw-specific-bubble` | packages/glass/src/glass-css.js:977 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-block` | packages/glass/src/glass-css.js:978 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-block-banner` | packages/glass/src/glass-css.js:979 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-inline-code` | packages/glass/src/glass-css.js:980 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-tag` | packages/glass/src/glass-css.js:981 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-segment-unselected` | packages/glass/src/glass-css.js:982 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-segment-selected` | packages/glass/src/glass-css.js:983 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-citation` | packages/glass/src/glass-css.js:984 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-placeholder` | packages/glass/src/glass-css.js:985 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-specific-bubble` | packages/glass/src/glass-css.js:991 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-block` | packages/glass/src/glass-css.js:992 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-block-banner` | packages/glass/src/glass-css.js:993 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-inline-code` | packages/glass/src/glass-css.js:994 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-tag` | packages/glass/src/glass-css.js:995 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-segment-unselected` | packages/glass/src/glass-css.js:996 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-segment-selected` | packages/glass/src/glass-css.js:997 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-citation` | packages/glass/src/glass-css.js:998 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-placeholder` | packages/glass/src/glass-css.js:999 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |

## 全量令牌表

| 令牌 | 条数 | 门控 | 行号 | 消费者注记 |
|---|---|---|---|---|
| `--dsw-alias-bg-base` | 2 | 壁纸(2) | src/styles/base.js:212, src/styles/base.js:215 | 页面基底 —— 壁纸可见性的关键前提（transparent） |
| `--dsw-alias-bg-layer-1` | 19 | 玻璃(18) + 无门控(1) | src/styles/base.js:61, src/styles/panel.js:384, src/styles/panel.js:397, packages/glass/src/glass-css.js:136, packages/glass/src/glass-css.js:239, packages/glass/src/glass-css.js:337, packages/glass/src/glass-css.js:1493, packages/glass/src/glass-css.js:1564, packages/glass/src/glass-css.js:1575, packages/glass/src/glass-css.js:1600, packages/glass/src/glass-css.js:1605, packages/glass/src/glass-css.js:1614, packages/glass/src/glass-css.js:1705, packages/glass/src/glass-css.js:1710, packages/glass/src/glass-css.js:1780, packages/glass/src/glass-css.js:1789, packages/glass/src/glass-css.js:1800, packages/glass/src/glass-css.js:1985, packages/glass/src/glass-css.js:1990 | 面板层次 1（宿主对话框/侧栏底）；better-sidebar 亦按它上色 |
| `--dsw-alias-bg-layer-2` | 17 | 玻璃(17) | src/styles/panel.js:387, src/styles/panel.js:400, packages/glass/src/glass-css.js:139, packages/glass/src/glass-css.js:242, packages/glass/src/glass-css.js:338, packages/glass/src/glass-css.js:810, packages/glass/src/glass-css.js:1496, packages/glass/src/glass-css.js:1565, packages/glass/src/glass-css.js:1578, packages/glass/src/glass-css.js:1601, packages/glass/src/glass-css.js:1606, packages/glass/src/glass-css.js:1615, packages/glass/src/glass-css.js:1781, packages/glass/src/glass-css.js:1790, packages/glass/src/glass-css.js:1801, packages/glass/src/glass-css.js:1986, packages/glass/src/glass-css.js:1991 | 面板层次 2 |
| `--dsw-alias-bg-layer-3` | 16 | 玻璃(16) | src/styles/panel.js:390, src/styles/panel.js:403, packages/glass/src/glass-css.js:142, packages/glass/src/glass-css.js:245, packages/glass/src/glass-css.js:339, packages/glass/src/glass-css.js:1499, packages/glass/src/glass-css.js:1566, packages/glass/src/glass-css.js:1581, packages/glass/src/glass-css.js:1602, packages/glass/src/glass-css.js:1607, packages/glass/src/glass-css.js:1616, packages/glass/src/glass-css.js:1782, packages/glass/src/glass-css.js:1791, packages/glass/src/glass-css.js:1802, packages/glass/src/glass-css.js:1987, packages/glass/src/glass-css.js:1992 | 面板层次 3 |
| `--dsw-alias-bg-mask-1` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:238, packages/glass/src/glass-css.js:438 |  |
| `--dsw-alias-bg-module-platform` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:157, packages/glass/src/glass-css.js:255 |  |
| `--dsw-alias-bg-multi-select` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:160, packages/glass/src/glass-css.js:258 |  |
| `--dsw-alias-bg-overlay` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:154, packages/glass/src/glass-css.js:252 | 弹层/浮出层底（issue #71 全表面玻璃） |
| `--dsw-alias-border-l1` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:218, packages/glass/src/glass-css.js:304 | 边框强调 L1（「边框」滑条） |
| `--dsw-alias-border-l2` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:219, packages/glass/src/glass-css.js:305 | 边框强调 L2 |
| `--dsw-alias-border-l2-darkmode-thin` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:220, packages/glass/src/glass-css.js:306 | 深色细边框 |
| `--dsw-alias-border-l3` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:222, packages/glass/src/glass-css.js:308, packages/glass/src/glass-css.js:1042 |  |
| `--dsw-alias-border-l4` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:223, packages/glass/src/glass-css.js:309 |  |
| `--dsw-alias-brand-primary` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:1050, packages/glass/src/glass-css.js:1234, packages/glass/src/glass-css.js:1512 |  |
| `--dsw-alias-brand-text` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:1051, packages/glass/src/glass-css.js:1235, packages/glass/src/glass-css.js:1513 |  |
| `--dsw-alias-button-elevated-fill` | 5 | 玻璃(5) | packages/glass/src/glass-css.js:145, packages/glass/src/glass-css.js:248, packages/glass/src/glass-css.js:1567, packages/glass/src/glass-css.js:1617, packages/glass/src/glass-css.js:1803 | 抬高按钮实色（侧栏「新建会话」等） |
| `--dsw-alias-button-floating-fill` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:163, packages/glass/src/glass-css.js:261, packages/glass/src/glass-css.js:812 |  |
| `--dsw-alias-button-floating-hover` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:813 |  |
| `--dsw-alias-button-ghost-active-fill` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:166, packages/glass/src/glass-css.js:264 |  |
| `--dsw-alias-button-info-fill` | 1 | UI 配色(1) | src/styles/base.js:381 |  |
| `--dsw-alias-button-info-hover` | 1 | UI 配色(1) | src/styles/base.js:382 |  |
| `--dsw-alias-button-primary-dimmed` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:1516 |  |
| `--dsw-alias-button-primary-fill` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:1514 |  |
| `--dsw-alias-button-primary-hover` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:1515 |  |
| `--dsw-alias-button-tool-bar-fill` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:169, packages/glass/src/glass-css.js:267 |  |
| `--dsw-alias-interactive-bg-active` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:172, packages/glass/src/glass-css.js:270 |  |
| `--dsw-alias-interactive-bg-hover` | 6 | 玻璃(6) | packages/glass/src/glass-css.js:811, packages/glass/src/glass-css.js:1047, packages/glass/src/glass-css.js:1082, packages/glass/src/glass-css.js:1231, packages/glass/src/glass-css.js:1269, packages/glass/src/glass-css.js:1505 |  |
| `--dsw-alias-interactive-bg-hover-accent` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:1048, packages/glass/src/glass-css.js:1232, packages/glass/src/glass-css.js:1506 |  |
| `--dsw-alias-interactive-bg-hover-solid` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:175, packages/glass/src/glass-css.js:273 |  |
| `--dsw-alias-label-caption` | 1 | 玻璃(1) | src/styles/base.js:313 |  |
| `--dsw-alias-label-deep-diving` | 2 | UI 配色(2) | src/styles/base.js:350, src/styles/base.js:368 |  |
| `--dsw-alias-label-deep-diving-shimmer` | 2 | UI 配色(2) | src/styles/base.js:352, src/styles/base.js:369 |  |
| `--dsw-alias-label-dimmed` | 1 | 玻璃(1) | src/styles/base.js:314 |  |
| `--dsw-alias-label-primary` | 1 | 玻璃(1) | src/styles/base.js:309 | 正文灰阶（壁纸激活时压暗提对比） |
| `--dsw-alias-label-primary-dimmed` | 1 | 玻璃(1) | src/styles/base.js:310 |  |
| `--dsw-alias-label-primary-foreground` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:1523 |  |
| `--dsw-alias-label-secondary` | 1 | 玻璃(1) | src/styles/base.js:311 | 次要文字灰阶 |
| `--dsw-alias-label-tertiary` | 1 | 玻璃(1) | src/styles/base.js:312 |  |
| `--dsw-alias-link` | 3 | UI 配色(3) | src/styles/base.js:349, src/styles/base.js:367, src/styles/base.js:387 |  |
| `--dsw-alias-markdown-citation` | 4 | 玻璃(2) + 无门控(2) | packages/glass/src/glass-css.js:178, packages/glass/src/glass-css.js:276, packages/glass/src/glass-css.js:984, packages/glass/src/glass-css.js:998 |  |
| `--dsw-alias-markdown-code-block` | 6 | 玻璃(4) + 无门控(2) | packages/glass/src/glass-css.js:196, packages/glass/src/glass-css.js:286, packages/glass/src/glass-css.js:844, packages/glass/src/glass-css.js:978, packages/glass/src/glass-css.js:992, packages/glass/src/glass-css.js:1620 | markdown 代码块底 |
| `--dsw-alias-markdown-code-block-banner` | 6 | 玻璃(4) + 无门控(2) | packages/glass/src/glass-css.js:199, packages/glass/src/glass-css.js:289, packages/glass/src/glass-css.js:845, packages/glass/src/glass-css.js:979, packages/glass/src/glass-css.js:993, packages/glass/src/glass-css.js:1621 | markdown 代码条幅底 |
| `--dsw-alias-markdown-code-segment-selected` | 5 | 玻璃(3) + 无门控(2) | packages/glass/src/glass-css.js:213, packages/glass/src/glass-css.js:301, packages/glass/src/glass-css.js:983, packages/glass/src/glass-css.js:997, packages/glass/src/glass-css.js:1625 | 代码卡分段（选中） |
| `--dsw-alias-markdown-code-segment-unselected` | 5 | 玻璃(3) + 无门控(2) | packages/glass/src/glass-css.js:208, packages/glass/src/glass-css.js:298, packages/glass/src/glass-css.js:982, packages/glass/src/glass-css.js:996, packages/glass/src/glass-css.js:1624 | 代码卡分段（未选中） |
| `--dsw-alias-markdown-inline-code` | 6 | 玻璃(4) + 无门控(2) | packages/glass/src/glass-css.js:202, packages/glass/src/glass-css.js:292, packages/glass/src/glass-css.js:723, packages/glass/src/glass-css.js:980, packages/glass/src/glass-css.js:994, packages/glass/src/glass-css.js:1622 | 行内代码底 |
| `--dsw-alias-markdown-placeholder` | 4 | 玻璃(2) + 无门控(2) | packages/glass/src/glass-css.js:181, packages/glass/src/glass-css.js:279, packages/glass/src/glass-css.js:985, packages/glass/src/glass-css.js:999 |  |
| `--dsw-alias-markdown-tag` | 5 | 玻璃(3) + 无门控(2) | packages/glass/src/glass-css.js:205, packages/glass/src/glass-css.js:295, packages/glass/src/glass-css.js:981, packages/glass/src/glass-css.js:995, packages/glass/src/glass-css.js:1623 | markdown 标签底 |
| `--dsw-alias-scrollbar-bg-l1` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:452, packages/glass/src/glass-css.js:463 |  |
| `--dsw-alias-scrollbar-bg-l2` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:453, packages/glass/src/glass-css.js:464 |  |
| `--dsw-alias-scrollbar-hover-l1` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:454, packages/glass/src/glass-css.js:465 |  |
| `--dsw-alias-scrollbar-hover-l2` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:455, packages/glass/src/glass-css.js:466 |  |
| `--dsw-alias-state-business-primary` | 5 | 玻璃(3) + UI 配色(2) | src/styles/base.js:353, src/styles/base.js:370, packages/glass/src/glass-css.js:1049, packages/glass/src/glass-css.js:1233, packages/glass/src/glass-css.js:1517 |  |
| `--dsw-alias-turn-trigger-bg` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:605, packages/glass/src/glass-css.js:615, packages/glass/src/glass-css.js:1814 |  |
| `--dsw-alias-turn-trigger-bg-hover` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:608, packages/glass/src/glass-css.js:618, packages/glass/src/glass-css.js:1815 |  |
| `--dsw-mask-blur` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:439 |  |
| `--dsw-specific-bubble` | 4 | 玻璃(2) + 无门控(2) | packages/glass/src/glass-css.js:407, packages/glass/src/glass-css.js:417, packages/glass/src/glass-css.js:977, packages/glass/src/glass-css.js:991 |  |
| `--dsw-specific-input-major` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:404, packages/glass/src/glass-css.js:414 |  |
| `--dsw-specific-selector` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:1804 |  |
| `--dsw-specific-sidebar-fill` | 4 | 玻璃(3) + 壁纸(1) | src/styles/base.js:218, src/styles/base.js:221, src/styles/shell.js:40, packages/glass/src/glass-css.js:372 | 侧栏填充（宿主 Mica/深色主题各有一份） |
| `--dsw-specific-sidebar-nav-item-active` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:1503, packages/glass/src/glass-css.js:1584 |  |
| `--dsw-specific-sidebar-nav-item-hover` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:1504, packages/glass/src/glass-css.js:1585 |  |
