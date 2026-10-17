# `--dsw-*` 令牌契约（自动生成，勿手改）

> 生成：`node test/tools/token-contract.mjs --write`；核对：`node test/verify-token-contract.mjs`
> （守卫在契约与代码不一致时失败 —— 令牌集合因此不会烂掉）。
>
> **口径**：只计样式族（`src/styles-base.js` … `src/styles-ext.js` 的 8 个域模板）里**属性位**的
> `--dsw-*` 声明（值里的 `var(--dsw-…)` 是读不是写，不计）；门控归属按花括号栈上的**选择器链**判定。
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
| `--dsw-alias-bg-layer-1` | src/styles-base.js:97 | `.we-layer` | .we-layer（插件自有元素，卸载即消失） |
| `--dsw-specific-bubble` | src/styles-shell.js:524 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-block` | src/styles-shell.js:525 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-block-banner` | src/styles-shell.js:526 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-inline-code` | src/styles-shell.js:527 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-tag` | src/styles-shell.js:528 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-segment-unselected` | src/styles-shell.js:529 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-segment-selected` | src/styles-shell.js:530 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-citation` | src/styles-shell.js:531 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-placeholder` | src/styles-shell.js:532 | `body[data-we-thinking-native] [data-chat-flow], body[data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-specific-bubble` | src/styles-shell.js:538 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-block` | src/styles-shell.js:539 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-block-banner` | src/styles-shell.js:540 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-inline-code` | src/styles-shell.js:541 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-tag` | src/styles-shell.js:542 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-segment-unselected` | src/styles-shell.js:543 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-code-segment-selected` | src/styles-shell.js:544 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-citation` | src/styles-shell.js:545 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |
| `--dsw-alias-markdown-placeholder` | src/styles-shell.js:546 | `body[data-ds-dark-theme][data-we-thinking-native] [data-chat-flow], body[data-ds-dark-theme][data-we-thinking-native] [data-vcp-rawhtml]` | thinking-native（思考块自带开关） |

## 全量令牌表

| 令牌 | 条数 | 门控 | 行号 | 消费者注记 |
|---|---|---|---|---|
| `--dsw-alias-bg-base` | 2 | 壁纸(2) | src/styles-base.js:228, src/styles-base.js:349 | 页面基底 —— 壁纸可见性的关键前提（transparent） |
| `--dsw-alias-bg-layer-1` | 11 | 玻璃(10) + 无门控(1) | src/styles-base.js:97, src/styles-base.js:254, src/styles-base.js:372, src/styles-chrome.js:67, src/styles-chrome.js:128, src/styles-chrome.js:150, src/styles-chrome.js:155, src/styles-chrome.js:164, src/styles-ext.js:97, src/styles-ext.js:104, src/styles-ext.js:115 | 面板层次 1（宿主对话框/侧栏底）；better-sidebar 亦按它上色 |
| `--dsw-alias-bg-layer-2` | 11 | 玻璃(11) | src/styles-base.js:257, src/styles-base.js:375, src/styles-shell.js:355, src/styles-chrome.js:70, src/styles-chrome.js:131, src/styles-chrome.js:151, src/styles-chrome.js:156, src/styles-chrome.js:165, src/styles-ext.js:98, src/styles-ext.js:105, src/styles-ext.js:116 | 面板层次 2 |
| `--dsw-alias-bg-layer-3` | 10 | 玻璃(10) | src/styles-base.js:260, src/styles-base.js:378, src/styles-chrome.js:73, src/styles-chrome.js:134, src/styles-chrome.js:152, src/styles-chrome.js:157, src/styles-chrome.js:166, src/styles-ext.js:99, src/styles-ext.js:106, src/styles-ext.js:117 | 面板层次 3 |
| `--dsw-alias-bg-module-platform` | 2 | 玻璃(2) | src/styles-base.js:275, src/styles-base.js:388 |  |
| `--dsw-alias-bg-multi-select` | 2 | 玻璃(2) | src/styles-base.js:278, src/styles-base.js:391 |  |
| `--dsw-alias-bg-overlay` | 2 | 玻璃(2) | src/styles-base.js:272, src/styles-base.js:385 | 弹层/浮出层底（issue #71 全表面玻璃） |
| `--dsw-alias-border-l1` | 2 | 玻璃(2) | src/styles-base.js:336, src/styles-base.js:437 | 边框强调 L1（「边框」滑条） |
| `--dsw-alias-border-l2` | 2 | 玻璃(2) | src/styles-base.js:337, src/styles-base.js:438 | 边框强调 L2 |
| `--dsw-alias-border-l2-darkmode-thin` | 2 | 玻璃(2) | src/styles-base.js:338, src/styles-base.js:439 | 深色细边框 |
| `--dsw-alias-border-l3` | 1 | 玻璃(1) | src/styles-sidebar.js:69 |  |
| `--dsw-alias-brand-primary` | 3 | 玻璃(3) | src/styles-sidebar.js:77, src/styles-sidebar.js:237, src/styles-chrome.js:86 |  |
| `--dsw-alias-brand-text` | 3 | 玻璃(3) | src/styles-sidebar.js:78, src/styles-sidebar.js:238, src/styles-chrome.js:87 |  |
| `--dsw-alias-button-elevated-fill` | 4 | 玻璃(4) | src/styles-base.js:263, src/styles-base.js:381, src/styles-chrome.js:167, src/styles-ext.js:118 | 抬高按钮实色（侧栏「新建会话」等） |
| `--dsw-alias-button-floating-fill` | 3 | 玻璃(3) | src/styles-base.js:281, src/styles-base.js:394, src/styles-shell.js:357 |  |
| `--dsw-alias-button-floating-hover` | 1 | 玻璃(1) | src/styles-shell.js:358 |  |
| `--dsw-alias-button-ghost-active-fill` | 2 | 玻璃(2) | src/styles-base.js:284, src/styles-base.js:397 |  |
| `--dsw-alias-button-info-fill` | 1 | 玻璃(1) | src/styles-base.js:530 |  |
| `--dsw-alias-button-info-hover` | 1 | 玻璃(1) | src/styles-base.js:531 |  |
| `--dsw-alias-button-primary-dimmed` | 1 | 玻璃(1) | src/styles-chrome.js:90 |  |
| `--dsw-alias-button-primary-fill` | 1 | 玻璃(1) | src/styles-chrome.js:88 |  |
| `--dsw-alias-button-primary-hover` | 1 | 玻璃(1) | src/styles-chrome.js:89 |  |
| `--dsw-alias-button-tool-bar-fill` | 2 | 玻璃(2) | src/styles-base.js:287, src/styles-base.js:400 |  |
| `--dsw-alias-interactive-bg-active` | 2 | 玻璃(2) | src/styles-base.js:290, src/styles-base.js:403 |  |
| `--dsw-alias-interactive-bg-hover` | 6 | 玻璃(6) | src/styles-shell.js:356, src/styles-sidebar.js:74, src/styles-sidebar.js:105, src/styles-sidebar.js:234, src/styles-sidebar.js:272, src/styles-chrome.js:79 |  |
| `--dsw-alias-interactive-bg-hover-accent` | 3 | 玻璃(3) | src/styles-sidebar.js:75, src/styles-sidebar.js:235, src/styles-chrome.js:80 |  |
| `--dsw-alias-interactive-bg-hover-solid` | 2 | 玻璃(2) | src/styles-base.js:293, src/styles-base.js:406 |  |
| `--dsw-alias-label-caption` | 1 | 壁纸(1) | src/styles-base.js:470 |  |
| `--dsw-alias-label-deep-diving` | 2 | 玻璃(2) | src/styles-base.js:505, src/styles-base.js:517 |  |
| `--dsw-alias-label-deep-diving-shimmer` | 2 | 玻璃(2) | src/styles-base.js:507, src/styles-base.js:518 |  |
| `--dsw-alias-label-dimmed` | 1 | 壁纸(1) | src/styles-base.js:471 |  |
| `--dsw-alias-label-primary` | 1 | 壁纸(1) | src/styles-base.js:466 | 正文灰阶（壁纸激活时压暗提对比） |
| `--dsw-alias-label-primary-dimmed` | 1 | 壁纸(1) | src/styles-base.js:467 |  |
| `--dsw-alias-label-primary-foreground` | 1 | 玻璃(1) | src/styles-chrome.js:97 |  |
| `--dsw-alias-label-secondary` | 1 | 壁纸(1) | src/styles-base.js:468 | 次要文字灰阶 |
| `--dsw-alias-label-tertiary` | 1 | 壁纸(1) | src/styles-base.js:469 |  |
| `--dsw-alias-link` | 3 | 玻璃(3) | src/styles-base.js:504, src/styles-base.js:516, src/styles-base.js:536 |  |
| `--dsw-alias-markdown-citation` | 4 | 玻璃(2) + 无门控(2) | src/styles-base.js:296, src/styles-base.js:409, src/styles-shell.js:531, src/styles-shell.js:545 |  |
| `--dsw-alias-markdown-code-block` | 6 | 玻璃(4) + 无门控(2) | src/styles-base.js:314, src/styles-base.js:419, src/styles-shell.js:391, src/styles-shell.js:525, src/styles-shell.js:539, src/styles-chrome.js:170 | markdown 代码块底 |
| `--dsw-alias-markdown-code-block-banner` | 6 | 玻璃(4) + 无门控(2) | src/styles-base.js:317, src/styles-base.js:422, src/styles-shell.js:392, src/styles-shell.js:526, src/styles-shell.js:540, src/styles-chrome.js:171 | markdown 代码条幅底 |
| `--dsw-alias-markdown-code-segment-selected` | 5 | 玻璃(3) + 无门控(2) | src/styles-base.js:331, src/styles-base.js:434, src/styles-shell.js:530, src/styles-shell.js:544, src/styles-chrome.js:175 | 代码卡分段（选中） |
| `--dsw-alias-markdown-code-segment-unselected` | 5 | 玻璃(3) + 无门控(2) | src/styles-base.js:326, src/styles-base.js:431, src/styles-shell.js:529, src/styles-shell.js:543, src/styles-chrome.js:174 | 代码卡分段（未选中） |
| `--dsw-alias-markdown-inline-code` | 6 | 玻璃(4) + 无门控(2) | src/styles-base.js:320, src/styles-base.js:425, src/styles-shell.js:297, src/styles-shell.js:527, src/styles-shell.js:541, src/styles-chrome.js:172 | 行内代码底 |
| `--dsw-alias-markdown-placeholder` | 4 | 玻璃(2) + 无门控(2) | src/styles-base.js:299, src/styles-base.js:412, src/styles-shell.js:532, src/styles-shell.js:546 |  |
| `--dsw-alias-markdown-tag` | 5 | 玻璃(3) + 无门控(2) | src/styles-base.js:323, src/styles-base.js:428, src/styles-shell.js:528, src/styles-shell.js:542, src/styles-chrome.js:173 | markdown 标签底 |
| `--dsw-alias-scrollbar-bg-l1` | 2 | 玻璃(2) | src/styles-shell.js:94, src/styles-shell.js:105 |  |
| `--dsw-alias-scrollbar-bg-l2` | 2 | 玻璃(2) | src/styles-shell.js:95, src/styles-shell.js:106 |  |
| `--dsw-alias-scrollbar-hover-l1` | 2 | 玻璃(2) | src/styles-shell.js:96, src/styles-shell.js:107 |  |
| `--dsw-alias-scrollbar-hover-l2` | 2 | 玻璃(2) | src/styles-shell.js:97, src/styles-shell.js:108 |  |
| `--dsw-alias-state-business-primary` | 5 | 玻璃(5) | src/styles-base.js:508, src/styles-base.js:519, src/styles-sidebar.js:76, src/styles-sidebar.js:236, src/styles-chrome.js:91 |  |
| `--dsw-alias-turn-trigger-bg` | 3 | 玻璃(3) | src/styles-shell.js:179, src/styles-shell.js:189, src/styles-ext.js:129 |  |
| `--dsw-alias-turn-trigger-bg-hover` | 3 | 玻璃(3) | src/styles-shell.js:182, src/styles-shell.js:192, src/styles-ext.js:130 |  |
| `--dsw-mask-blur` | 1 | 玻璃(1) | src/styles-shell.js:81 |  |
| `--dsw-specific-bubble` | 4 | 玻璃(2) + 无门控(2) | src/styles-shell.js:52, src/styles-shell.js:62, src/styles-shell.js:524, src/styles-shell.js:538 |  |
| `--dsw-specific-input-major` | 2 | 玻璃(2) | src/styles-shell.js:49, src/styles-shell.js:59 |  |
| `--dsw-specific-selector` | 1 | 玻璃(1) | src/styles-ext.js:119 |  |
| `--dsw-specific-sidebar-fill` | 4 | 壁纸(4) | src/styles-base.js:229, src/styles-base.js:350, src/styles-base.js:455, src/styles-shell.js:561 | 侧栏填充（宿主 Mica/深色主题各有一份） |
| `--dsw-specific-sidebar-nav-item-active` | 2 | 玻璃(2) | src/styles-chrome.js:77, src/styles-chrome.js:137 |  |
| `--dsw-specific-sidebar-nav-item-hover` | 2 | 玻璃(2) | src/styles-chrome.js:78, src/styles-chrome.js:138 |  |
