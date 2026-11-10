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

共 **198** 条声明 / **60** 个不同令牌。门控归属：
玻璃 **165** 条 · UI 配色 **11** 条 · 壁纸 **3** 条 · 无门控 **19** 条。

## 无门控声明（白名单 —— M1 的全部暴露面）

除下列封闭白名单外，**任何新的无门控 `--dsw-*` 声明都会让 `verify-token-contract` 变红**
（白名单 = `body[data-we-thinking-native]` 思考块自带开关 + 插件自有 bare roots 封闭集
`{.we-layer, .we-picker, .we-picker__modal, .we-qp}` —— 整条选择器链必须是纯逗号列表、
每段 trim 后精确命中集合成员，不认 `.we-*` 前缀/子串，拒未知根/混组；
按宿主规范消费 token 的第三方插件无法区分「玻璃开/关」，只能拿到配方本身 —— 见 `docs/HOW-IT-WORKS.md` §共存）。

| 令牌 | 行 | 选择器链 | 归属 |
|---|---|---|---|
| `--dsw-alias-bg-layer-1` | src/styles/base.js:61 | `.we-layer` | .we-layer（插件自有元素，卸载即消失） |
| `--dsw-specific-bubble` | packages/glass/src/glass-css.js:965 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-block` | packages/glass/src/glass-css.js:966 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-block-banner` | packages/glass/src/glass-css.js:967 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-inline-code` | packages/glass/src/glass-css.js:968 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-tag` | packages/glass/src/glass-css.js:969 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-segment-unselected` | packages/glass/src/glass-css.js:970 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-segment-selected` | packages/glass/src/glass-css.js:971 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-citation` | packages/glass/src/glass-css.js:972 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-placeholder` | packages/glass/src/glass-css.js:973 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-specific-bubble` | packages/glass/src/glass-css.js:979 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-block` | packages/glass/src/glass-css.js:980 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-block-banner` | packages/glass/src/glass-css.js:981 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-inline-code` | packages/glass/src/glass-css.js:982 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-tag` | packages/glass/src/glass-css.js:983 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-segment-unselected` | packages/glass/src/glass-css.js:984 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-segment-selected` | packages/glass/src/glass-css.js:985 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-citation` | packages/glass/src/glass-css.js:986 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-placeholder` | packages/glass/src/glass-css.js:987 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |

## 全量令牌表

| 令牌 | 条数 | 门控 | 行号 | 消费者注记 |
|---|---|---|---|---|
| `--dsw-alias-bg-base` | 2 | 壁纸(2) | src/styles/base.js:212, src/styles/base.js:215 | 页面基底 —— 壁纸可见性的关键前提（transparent） |
| `--dsw-alias-bg-layer-1` | 19 | 玻璃(18) + 无门控(1) | src/styles/base.js:61, src/styles/panel.js:384, src/styles/panel.js:397, packages/glass/src/glass-css.js:136, packages/glass/src/glass-css.js:237, packages/glass/src/glass-css.js:335, packages/glass/src/glass-css.js:1481, packages/glass/src/glass-css.js:1552, packages/glass/src/glass-css.js:1563, packages/glass/src/glass-css.js:1588, packages/glass/src/glass-css.js:1593, packages/glass/src/glass-css.js:1602, packages/glass/src/glass-css.js:1693, packages/glass/src/glass-css.js:1698, packages/glass/src/glass-css.js:1768, packages/glass/src/glass-css.js:1777, packages/glass/src/glass-css.js:1788, packages/glass/src/glass-css.js:1973, packages/glass/src/glass-css.js:1978 | 面板层次 1（宿主对话框/侧栏底）；better-sidebar 亦按它上色 |
| `--dsw-alias-bg-layer-2` | 17 | 玻璃(17) | src/styles/panel.js:387, src/styles/panel.js:400, packages/glass/src/glass-css.js:139, packages/glass/src/glass-css.js:240, packages/glass/src/glass-css.js:336, packages/glass/src/glass-css.js:798, packages/glass/src/glass-css.js:1484, packages/glass/src/glass-css.js:1553, packages/glass/src/glass-css.js:1566, packages/glass/src/glass-css.js:1589, packages/glass/src/glass-css.js:1594, packages/glass/src/glass-css.js:1603, packages/glass/src/glass-css.js:1769, packages/glass/src/glass-css.js:1778, packages/glass/src/glass-css.js:1789, packages/glass/src/glass-css.js:1974, packages/glass/src/glass-css.js:1979 | 面板层次 2 |
| `--dsw-alias-bg-layer-3` | 16 | 玻璃(16) | src/styles/panel.js:390, src/styles/panel.js:403, packages/glass/src/glass-css.js:142, packages/glass/src/glass-css.js:243, packages/glass/src/glass-css.js:337, packages/glass/src/glass-css.js:1487, packages/glass/src/glass-css.js:1554, packages/glass/src/glass-css.js:1569, packages/glass/src/glass-css.js:1590, packages/glass/src/glass-css.js:1595, packages/glass/src/glass-css.js:1604, packages/glass/src/glass-css.js:1770, packages/glass/src/glass-css.js:1779, packages/glass/src/glass-css.js:1790, packages/glass/src/glass-css.js:1975, packages/glass/src/glass-css.js:1980 | 面板层次 3 |
| `--dsw-alias-bg-module-platform` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:157, packages/glass/src/glass-css.js:253 |  |
| `--dsw-alias-bg-multi-select` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:160, packages/glass/src/glass-css.js:256 |  |
| `--dsw-alias-bg-overlay` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:154, packages/glass/src/glass-css.js:250 | 弹层/浮出层底（issue #71 全表面玻璃） |
| `--dsw-alias-border-l1` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:218, packages/glass/src/glass-css.js:302 | 边框强调 L1（「边框」滑条） |
| `--dsw-alias-border-l2` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:219, packages/glass/src/glass-css.js:303 | 边框强调 L2 |
| `--dsw-alias-border-l2-darkmode-thin` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:220, packages/glass/src/glass-css.js:304 | 深色细边框 |
| `--dsw-alias-border-l3` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:222, packages/glass/src/glass-css.js:306, packages/glass/src/glass-css.js:1030 |  |
| `--dsw-alias-border-l4` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:223, packages/glass/src/glass-css.js:307 |  |
| `--dsw-alias-brand-primary` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:1038, packages/glass/src/glass-css.js:1222, packages/glass/src/glass-css.js:1500 |  |
| `--dsw-alias-brand-text` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:1039, packages/glass/src/glass-css.js:1223, packages/glass/src/glass-css.js:1501 |  |
| `--dsw-alias-button-elevated-fill` | 5 | 玻璃(5) | packages/glass/src/glass-css.js:145, packages/glass/src/glass-css.js:246, packages/glass/src/glass-css.js:1555, packages/glass/src/glass-css.js:1605, packages/glass/src/glass-css.js:1791 | 抬高按钮实色（侧栏「新建会话」等） |
| `--dsw-alias-button-floating-fill` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:163, packages/glass/src/glass-css.js:259, packages/glass/src/glass-css.js:800 |  |
| `--dsw-alias-button-floating-hover` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:801 |  |
| `--dsw-alias-button-ghost-active-fill` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:166, packages/glass/src/glass-css.js:262 |  |
| `--dsw-alias-button-info-fill` | 1 | UI 配色(1) | src/styles/base.js:381 |  |
| `--dsw-alias-button-info-hover` | 1 | UI 配色(1) | src/styles/base.js:382 |  |
| `--dsw-alias-button-primary-dimmed` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:1504 |  |
| `--dsw-alias-button-primary-fill` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:1502 |  |
| `--dsw-alias-button-primary-hover` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:1503 |  |
| `--dsw-alias-button-tool-bar-fill` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:169, packages/glass/src/glass-css.js:265 |  |
| `--dsw-alias-interactive-bg-active` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:172, packages/glass/src/glass-css.js:268 |  |
| `--dsw-alias-interactive-bg-hover` | 6 | 玻璃(6) | packages/glass/src/glass-css.js:799, packages/glass/src/glass-css.js:1035, packages/glass/src/glass-css.js:1070, packages/glass/src/glass-css.js:1219, packages/glass/src/glass-css.js:1257, packages/glass/src/glass-css.js:1493 |  |
| `--dsw-alias-interactive-bg-hover-accent` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:1036, packages/glass/src/glass-css.js:1220, packages/glass/src/glass-css.js:1494 |  |
| `--dsw-alias-interactive-bg-hover-solid` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:175, packages/glass/src/glass-css.js:271 |  |
| `--dsw-alias-label-caption` | 1 | 玻璃(1) | src/styles/base.js:313 |  |
| `--dsw-alias-label-deep-diving` | 2 | UI 配色(2) | src/styles/base.js:350, src/styles/base.js:368 |  |
| `--dsw-alias-label-deep-diving-shimmer` | 2 | UI 配色(2) | src/styles/base.js:352, src/styles/base.js:369 |  |
| `--dsw-alias-label-dimmed` | 1 | 玻璃(1) | src/styles/base.js:314 |  |
| `--dsw-alias-label-primary` | 1 | 玻璃(1) | src/styles/base.js:309 | 正文灰阶（壁纸激活时压暗提对比） |
| `--dsw-alias-label-primary-dimmed` | 1 | 玻璃(1) | src/styles/base.js:310 |  |
| `--dsw-alias-label-primary-foreground` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:1511 |  |
| `--dsw-alias-label-secondary` | 1 | 玻璃(1) | src/styles/base.js:311 | 次要文字灰阶 |
| `--dsw-alias-label-tertiary` | 1 | 玻璃(1) | src/styles/base.js:312 |  |
| `--dsw-alias-link` | 3 | UI 配色(3) | src/styles/base.js:349, src/styles/base.js:367, src/styles/base.js:387 |  |
| `--dsw-alias-markdown-citation` | 4 | 玻璃(2) + 无门控(2) | packages/glass/src/glass-css.js:178, packages/glass/src/glass-css.js:274, packages/glass/src/glass-css.js:972, packages/glass/src/glass-css.js:986 |  |
| `--dsw-alias-markdown-code-block` | 6 | 玻璃(4) + 无门控(2) | packages/glass/src/glass-css.js:196, packages/glass/src/glass-css.js:284, packages/glass/src/glass-css.js:832, packages/glass/src/glass-css.js:966, packages/glass/src/glass-css.js:980, packages/glass/src/glass-css.js:1608 | markdown 代码块底 |
| `--dsw-alias-markdown-code-block-banner` | 6 | 玻璃(4) + 无门控(2) | packages/glass/src/glass-css.js:199, packages/glass/src/glass-css.js:287, packages/glass/src/glass-css.js:833, packages/glass/src/glass-css.js:967, packages/glass/src/glass-css.js:981, packages/glass/src/glass-css.js:1609 | markdown 代码条幅底 |
| `--dsw-alias-markdown-code-segment-selected` | 5 | 玻璃(3) + 无门控(2) | packages/glass/src/glass-css.js:213, packages/glass/src/glass-css.js:299, packages/glass/src/glass-css.js:971, packages/glass/src/glass-css.js:985, packages/glass/src/glass-css.js:1613 | 代码卡分段（选中） |
| `--dsw-alias-markdown-code-segment-unselected` | 5 | 玻璃(3) + 无门控(2) | packages/glass/src/glass-css.js:208, packages/glass/src/glass-css.js:296, packages/glass/src/glass-css.js:970, packages/glass/src/glass-css.js:984, packages/glass/src/glass-css.js:1612 | 代码卡分段（未选中） |
| `--dsw-alias-markdown-inline-code` | 6 | 玻璃(4) + 无门控(2) | packages/glass/src/glass-css.js:202, packages/glass/src/glass-css.js:290, packages/glass/src/glass-css.js:711, packages/glass/src/glass-css.js:968, packages/glass/src/glass-css.js:982, packages/glass/src/glass-css.js:1610 | 行内代码底 |
| `--dsw-alias-markdown-placeholder` | 4 | 玻璃(2) + 无门控(2) | packages/glass/src/glass-css.js:181, packages/glass/src/glass-css.js:277, packages/glass/src/glass-css.js:973, packages/glass/src/glass-css.js:987 |  |
| `--dsw-alias-markdown-tag` | 5 | 玻璃(3) + 无门控(2) | packages/glass/src/glass-css.js:205, packages/glass/src/glass-css.js:293, packages/glass/src/glass-css.js:969, packages/glass/src/glass-css.js:983, packages/glass/src/glass-css.js:1611 | markdown 标签底 |
| `--dsw-alias-scrollbar-bg-l1` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:447, packages/glass/src/glass-css.js:458 |  |
| `--dsw-alias-scrollbar-bg-l2` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:448, packages/glass/src/glass-css.js:459 |  |
| `--dsw-alias-scrollbar-hover-l1` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:449, packages/glass/src/glass-css.js:460 |  |
| `--dsw-alias-scrollbar-hover-l2` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:450, packages/glass/src/glass-css.js:461 |  |
| `--dsw-alias-state-business-primary` | 5 | 玻璃(3) + UI 配色(2) | src/styles/base.js:353, src/styles/base.js:370, packages/glass/src/glass-css.js:1037, packages/glass/src/glass-css.js:1221, packages/glass/src/glass-css.js:1505 |  |
| `--dsw-alias-turn-trigger-bg` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:593, packages/glass/src/glass-css.js:603, packages/glass/src/glass-css.js:1802 |  |
| `--dsw-alias-turn-trigger-bg-hover` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:596, packages/glass/src/glass-css.js:606, packages/glass/src/glass-css.js:1803 |  |
| `--dsw-mask-blur` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:434 |  |
| `--dsw-specific-bubble` | 4 | 玻璃(2) + 无门控(2) | packages/glass/src/glass-css.js:405, packages/glass/src/glass-css.js:415, packages/glass/src/glass-css.js:965, packages/glass/src/glass-css.js:979 |  |
| `--dsw-specific-input-major` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:402, packages/glass/src/glass-css.js:412 |  |
| `--dsw-specific-selector` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:1792 |  |
| `--dsw-specific-sidebar-fill` | 4 | 玻璃(3) + 壁纸(1) | src/styles/base.js:218, src/styles/base.js:221, src/styles/shell.js:40, packages/glass/src/glass-css.js:370 | 侧栏填充（宿主 Mica/深色主题各有一份） |
| `--dsw-specific-sidebar-nav-item-active` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:1491, packages/glass/src/glass-css.js:1572 |  |
| `--dsw-specific-sidebar-nav-item-hover` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:1492, packages/glass/src/glass-css.js:1573 |  |
