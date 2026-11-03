# `--dsw-*` 令牌契约（自动生成，勿手改）

> 生成：`node test/tools/token-contract.mjs --write`；核对：`node test/verify-token-contract.mjs`
> （守卫在契约与代码不一致时失败 —— 令牌集合因此不会烂掉）。
>
> **口径**：只计样式族（`src/styles-base.js` … `src/styles-ext.js` 的 8 个域模板）里**属性位**的
> `--dsw-*` 声明（值里的 `var(--dsw-…)` 是读不是写，不计）；门控归属按花括号栈上的**选择器链**判定。
> **玻璃** = 链上有 `[data-we-glass-*]`；**UI 配色** = 链上有 `[data-we-ui-color]`（主包自有门，ADR-0016）；
> **壁纸** = 只有 `[data-we-wallpaper]`；
> **无门控** = 两者都不挂（共存审计 M1 的全部暴露面 —— 白名单见下表，新增一条守卫即红）。
> JS 侧的令牌写入（`src/font/apply.js` 的 label 族等）不在本契约口径内，见 `docs/DSH-UI-INTERFACES.md`。

共 **189** 条声明 / **60** 个不同令牌。门控归属：
玻璃 **153** 条 · UI 配色 **11** 条 · 壁纸 **6** 条 · 无门控 **19** 条。

## 无门控声明（白名单 —— M1 的全部暴露面）

除下列封闭白名单外，**任何新的无门控 `--dsw-*` 声明都会让 `verify-token-contract` 变红**
（白名单 = `body[data-we-thinking-native]` 思考块自带开关 + 插件自有 bare roots 封闭集
`{.we-layer, .we-picker, .we-picker__modal, .we-qp}` —— 整条选择器链必须是纯逗号列表、
每段 trim 后精确命中集合成员，不认 `.we-*` 前缀/子串，拒未知根/混组；
按宿主规范消费 token 的第三方插件无法区分「玻璃开/关」，只能拿到配方本身 —— 见 `docs/HOW-IT-WORKS.md` §共存）。

| 令牌 | 行 | 选择器链 | 归属 |
|---|---|---|---|
| `--dsw-alias-bg-layer-1` | src/styles-base.js:61 | `.we-layer` | .we-layer（插件自有元素，卸载即消失） |
| `--dsw-specific-bubble` | packages/glass/src/glass-css.js:892 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-block` | packages/glass/src/glass-css.js:893 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-block-banner` | packages/glass/src/glass-css.js:894 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-inline-code` | packages/glass/src/glass-css.js:895 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-tag` | packages/glass/src/glass-css.js:896 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-segment-unselected` | packages/glass/src/glass-css.js:897 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-segment-selected` | packages/glass/src/glass-css.js:898 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-citation` | packages/glass/src/glass-css.js:899 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-placeholder` | packages/glass/src/glass-css.js:900 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-specific-bubble` | packages/glass/src/glass-css.js:906 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-block` | packages/glass/src/glass-css.js:907 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-block-banner` | packages/glass/src/glass-css.js:908 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-inline-code` | packages/glass/src/glass-css.js:909 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-tag` | packages/glass/src/glass-css.js:910 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-segment-unselected` | packages/glass/src/glass-css.js:911 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-segment-selected` | packages/glass/src/glass-css.js:912 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-citation` | packages/glass/src/glass-css.js:913 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-placeholder` | packages/glass/src/glass-css.js:914 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |

## 全量令牌表

| 令牌 | 条数 | 门控 | 行号 | 消费者注记 |
|---|---|---|---|---|
| `--dsw-alias-bg-base` | 2 | 壁纸(2) | src/styles-base.js:202, src/styles-base.js:206 | 页面基底 —— 壁纸可见性的关键前提（transparent） |
| `--dsw-alias-bg-layer-1` | 15 | 玻璃(14) + 无门控(1) | src/styles-base.js:61, src/styles-panel.js:384, src/styles-panel.js:397, packages/glass/src/glass-css.js:136, packages/glass/src/glass-css.js:237, packages/glass/src/glass-css.js:331, packages/glass/src/glass-css.js:1408, packages/glass/src/glass-css.js:1479, packages/glass/src/glass-css.js:1490, packages/glass/src/glass-css.js:1515, packages/glass/src/glass-css.js:1520, packages/glass/src/glass-css.js:1529, packages/glass/src/glass-css.js:1660, packages/glass/src/glass-css.js:1669, packages/glass/src/glass-css.js:1680 | 面板层次 1（宿主对话框/侧栏底）；better-sidebar 亦按它上色 |
| `--dsw-alias-bg-layer-2` | 15 | 玻璃(15) | src/styles-panel.js:387, src/styles-panel.js:400, packages/glass/src/glass-css.js:139, packages/glass/src/glass-css.js:240, packages/glass/src/glass-css.js:332, packages/glass/src/glass-css.js:723, packages/glass/src/glass-css.js:1411, packages/glass/src/glass-css.js:1480, packages/glass/src/glass-css.js:1493, packages/glass/src/glass-css.js:1516, packages/glass/src/glass-css.js:1521, packages/glass/src/glass-css.js:1530, packages/glass/src/glass-css.js:1661, packages/glass/src/glass-css.js:1670, packages/glass/src/glass-css.js:1681 | 面板层次 2 |
| `--dsw-alias-bg-layer-3` | 13 | 玻璃(13) | src/styles-panel.js:390, src/styles-panel.js:403, packages/glass/src/glass-css.js:142, packages/glass/src/glass-css.js:243, packages/glass/src/glass-css.js:1414, packages/glass/src/glass-css.js:1481, packages/glass/src/glass-css.js:1496, packages/glass/src/glass-css.js:1517, packages/glass/src/glass-css.js:1522, packages/glass/src/glass-css.js:1531, packages/glass/src/glass-css.js:1662, packages/glass/src/glass-css.js:1671, packages/glass/src/glass-css.js:1682 | 面板层次 3 |
| `--dsw-alias-bg-module-platform` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:157, packages/glass/src/glass-css.js:253 |  |
| `--dsw-alias-bg-multi-select` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:160, packages/glass/src/glass-css.js:256 |  |
| `--dsw-alias-bg-overlay` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:154, packages/glass/src/glass-css.js:250 | 弹层/浮出层底（issue #71 全表面玻璃） |
| `--dsw-alias-border-l1` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:218, packages/glass/src/glass-css.js:302 | 边框强调 L1（「边框」滑条） |
| `--dsw-alias-border-l2` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:219, packages/glass/src/glass-css.js:303 | 边框强调 L2 |
| `--dsw-alias-border-l2-darkmode-thin` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:220, packages/glass/src/glass-css.js:304 | 深色细边框 |
| `--dsw-alias-border-l3` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:222, packages/glass/src/glass-css.js:306, packages/glass/src/glass-css.js:957 |  |
| `--dsw-alias-border-l4` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:223, packages/glass/src/glass-css.js:307 |  |
| `--dsw-alias-brand-primary` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:965, packages/glass/src/glass-css.js:1149, packages/glass/src/glass-css.js:1427 |  |
| `--dsw-alias-brand-text` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:966, packages/glass/src/glass-css.js:1150, packages/glass/src/glass-css.js:1428 |  |
| `--dsw-alias-button-elevated-fill` | 5 | 玻璃(5) | packages/glass/src/glass-css.js:145, packages/glass/src/glass-css.js:246, packages/glass/src/glass-css.js:1482, packages/glass/src/glass-css.js:1532, packages/glass/src/glass-css.js:1683 | 抬高按钮实色（侧栏「新建会话」等） |
| `--dsw-alias-button-floating-fill` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:163, packages/glass/src/glass-css.js:259, packages/glass/src/glass-css.js:725 |  |
| `--dsw-alias-button-floating-hover` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:726 |  |
| `--dsw-alias-button-ghost-active-fill` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:166, packages/glass/src/glass-css.js:262 |  |
| `--dsw-alias-button-info-fill` | 1 | UI 配色(1) | src/styles-base.js:344 |  |
| `--dsw-alias-button-info-hover` | 1 | UI 配色(1) | src/styles-base.js:345 |  |
| `--dsw-alias-button-primary-dimmed` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:1431 |  |
| `--dsw-alias-button-primary-fill` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:1429 |  |
| `--dsw-alias-button-primary-hover` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:1430 |  |
| `--dsw-alias-button-tool-bar-fill` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:169, packages/glass/src/glass-css.js:265 |  |
| `--dsw-alias-interactive-bg-active` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:172, packages/glass/src/glass-css.js:268 |  |
| `--dsw-alias-interactive-bg-hover` | 6 | 玻璃(6) | packages/glass/src/glass-css.js:724, packages/glass/src/glass-css.js:962, packages/glass/src/glass-css.js:997, packages/glass/src/glass-css.js:1146, packages/glass/src/glass-css.js:1184, packages/glass/src/glass-css.js:1420 |  |
| `--dsw-alias-interactive-bg-hover-accent` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:963, packages/glass/src/glass-css.js:1147, packages/glass/src/glass-css.js:1421 |  |
| `--dsw-alias-interactive-bg-hover-solid` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:175, packages/glass/src/glass-css.js:271 |  |
| `--dsw-alias-label-caption` | 1 | 玻璃(1) | src/styles-base.js:279 |  |
| `--dsw-alias-label-deep-diving` | 2 | UI 配色(2) | src/styles-base.js:316, src/styles-base.js:331 |  |
| `--dsw-alias-label-deep-diving-shimmer` | 2 | UI 配色(2) | src/styles-base.js:318, src/styles-base.js:332 |  |
| `--dsw-alias-label-dimmed` | 1 | 玻璃(1) | src/styles-base.js:280 |  |
| `--dsw-alias-label-primary` | 1 | 玻璃(1) | src/styles-base.js:275 | 正文灰阶（壁纸激活时压暗提对比） |
| `--dsw-alias-label-primary-dimmed` | 1 | 玻璃(1) | src/styles-base.js:276 |  |
| `--dsw-alias-label-primary-foreground` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:1438 |  |
| `--dsw-alias-label-secondary` | 1 | 玻璃(1) | src/styles-base.js:277 | 次要文字灰阶 |
| `--dsw-alias-label-tertiary` | 1 | 玻璃(1) | src/styles-base.js:278 |  |
| `--dsw-alias-link` | 3 | UI 配色(3) | src/styles-base.js:315, src/styles-base.js:330, src/styles-base.js:350 |  |
| `--dsw-alias-markdown-citation` | 4 | 玻璃(2) + 无门控(2) | packages/glass/src/glass-css.js:178, packages/glass/src/glass-css.js:274, packages/glass/src/glass-css.js:899, packages/glass/src/glass-css.js:913 |  |
| `--dsw-alias-markdown-code-block` | 6 | 玻璃(4) + 无门控(2) | packages/glass/src/glass-css.js:196, packages/glass/src/glass-css.js:284, packages/glass/src/glass-css.js:759, packages/glass/src/glass-css.js:893, packages/glass/src/glass-css.js:907, packages/glass/src/glass-css.js:1535 | markdown 代码块底 |
| `--dsw-alias-markdown-code-block-banner` | 6 | 玻璃(4) + 无门控(2) | packages/glass/src/glass-css.js:199, packages/glass/src/glass-css.js:287, packages/glass/src/glass-css.js:760, packages/glass/src/glass-css.js:894, packages/glass/src/glass-css.js:908, packages/glass/src/glass-css.js:1536 | markdown 代码条幅底 |
| `--dsw-alias-markdown-code-segment-selected` | 5 | 玻璃(3) + 无门控(2) | packages/glass/src/glass-css.js:213, packages/glass/src/glass-css.js:299, packages/glass/src/glass-css.js:898, packages/glass/src/glass-css.js:912, packages/glass/src/glass-css.js:1540 | 代码卡分段（选中） |
| `--dsw-alias-markdown-code-segment-unselected` | 5 | 玻璃(3) + 无门控(2) | packages/glass/src/glass-css.js:208, packages/glass/src/glass-css.js:296, packages/glass/src/glass-css.js:897, packages/glass/src/glass-css.js:911, packages/glass/src/glass-css.js:1539 | 代码卡分段（未选中） |
| `--dsw-alias-markdown-inline-code` | 6 | 玻璃(4) + 无门控(2) | packages/glass/src/glass-css.js:202, packages/glass/src/glass-css.js:290, packages/glass/src/glass-css.js:665, packages/glass/src/glass-css.js:895, packages/glass/src/glass-css.js:909, packages/glass/src/glass-css.js:1537 | 行内代码底 |
| `--dsw-alias-markdown-placeholder` | 4 | 玻璃(2) + 无门控(2) | packages/glass/src/glass-css.js:181, packages/glass/src/glass-css.js:277, packages/glass/src/glass-css.js:900, packages/glass/src/glass-css.js:914 |  |
| `--dsw-alias-markdown-tag` | 5 | 玻璃(3) + 无门控(2) | packages/glass/src/glass-css.js:205, packages/glass/src/glass-css.js:293, packages/glass/src/glass-css.js:896, packages/glass/src/glass-css.js:910, packages/glass/src/glass-css.js:1538 | markdown 标签底 |
| `--dsw-alias-scrollbar-bg-l1` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:442, packages/glass/src/glass-css.js:453 |  |
| `--dsw-alias-scrollbar-bg-l2` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:443, packages/glass/src/glass-css.js:454 |  |
| `--dsw-alias-scrollbar-hover-l1` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:444, packages/glass/src/glass-css.js:455 |  |
| `--dsw-alias-scrollbar-hover-l2` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:445, packages/glass/src/glass-css.js:456 |  |
| `--dsw-alias-state-business-primary` | 5 | 玻璃(3) + UI 配色(2) | src/styles-base.js:319, src/styles-base.js:333, packages/glass/src/glass-css.js:964, packages/glass/src/glass-css.js:1148, packages/glass/src/glass-css.js:1432 |  |
| `--dsw-alias-turn-trigger-bg` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:547, packages/glass/src/glass-css.js:557, packages/glass/src/glass-css.js:1694 |  |
| `--dsw-alias-turn-trigger-bg-hover` | 3 | 玻璃(3) | packages/glass/src/glass-css.js:550, packages/glass/src/glass-css.js:560, packages/glass/src/glass-css.js:1695 |  |
| `--dsw-mask-blur` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:429 |  |
| `--dsw-specific-bubble` | 4 | 玻璃(2) + 无门控(2) | packages/glass/src/glass-css.js:400, packages/glass/src/glass-css.js:410, packages/glass/src/glass-css.js:892, packages/glass/src/glass-css.js:906 |  |
| `--dsw-specific-input-major` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:397, packages/glass/src/glass-css.js:407 |  |
| `--dsw-specific-selector` | 1 | 玻璃(1) | packages/glass/src/glass-css.js:1684 |  |
| `--dsw-specific-sidebar-fill` | 4 | 壁纸(4) | src/styles-base.js:203, src/styles-base.js:207, src/styles-shell.js:38, packages/glass/src/glass-css.js:365 | 侧栏填充（宿主 Mica/深色主题各有一份） |
| `--dsw-specific-sidebar-nav-item-active` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:1418, packages/glass/src/glass-css.js:1499 |  |
| `--dsw-specific-sidebar-nav-item-hover` | 2 | 玻璃(2) | packages/glass/src/glass-css.js:1419, packages/glass/src/glass-css.js:1500 |  |
