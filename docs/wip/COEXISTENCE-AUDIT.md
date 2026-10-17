# 共存审计与玻璃/壁纸解耦计划（原始记录）

> **状态**：进行中（住 `wip/` 的活计划，按 [`docs/README.md`](../README.md) §目录的寿命规则收口后归档）。
> 本文是 2026-10-09 交付的共存审计原始记录 + 重构计划（S1–S8 分批落地）。
> **第一批已随本分支落地**：S2 令牌契约 → [`../TOKEN-CONTRACT.md`](../TOKEN-CONTRACT.md)（生成物）+ `test/verify-token-contract.mjs`；
> S8 共存文档 → [`../COEXISTENCE.md`](../COEXISTENCE.md) + [`../adr/0010-glass-off-revisit-four-states.md`](../adr/0010-glass-off-revisit-four-states.md)。
>
> **2026-10-14 逐批复核（本机复算）**：
>
> | 批次 | 状态 | 证据 / 复算 |
> |---|---|---|
> | S1 玻璃主开关 / 共存四态 | **未落地** | schema 里没有四态键（`glass-only` / `wallpaper-only` / `off` 在 `lib/settings-schema.js` + `src/**` 命中 0）；ADR-0010 已定案（实施分三批、主开关最后） |
> | S2 令牌契约文件化 + 漂移守卫 | **已落地** | [`../TOKEN-CONTRACT.md`](../TOKEN-CONTRACT.md) + `test/verify-token-contract.mjs` |
> | S3 让路协议通用化（属性级 opt-out + 对外信号） | **未落地** | [`../COEXISTENCE.md`](../COEXISTENCE.md) 自己写明"属性级 opt-out 在计划中（ADR-0010 D3）" |
> | S4 共存自诊断 + 一键降级到"仅壁纸" | **未落地** | `src/**` 无"仅壁纸"入口 |
> | S5 第三方面契约集中化（一个映射表 + 版本漂移测试） | **疑似已随 S2 落地** | 同上行（映射表 = 契约生成物）；请 owner 确认后改本行 |
> | S6 包含块预检常开（不依赖视差开关） | **未核对** | 该坑的解释在 `src/glass-extra.js` / `src/parallax-layer.js` 的注释里，但"常开预检"本身未见 |
> | S7 卸载健壮性（逐步 try/catch + 幂等 + 单一属性表） | **未核对** | 需 owner 逐条过 |
> | S8 共存文档 | **已落地** | [`../COEXISTENCE.md`](../COEXISTENCE.md) + [`../adr/0010`](../adr/0010-glass-off-revisit-four-states.md) |
>
> ⇒ **结论：不能归档**（S1 / S3 / S4 未落地）。本文继续住 `wip/`；S1 / S3 / S4 的落地口径在
> [`../adr/0010`](../adr/0010-glass-off-revisit-four-states.md)，落地后按寿命规则整体归档。
>
> ⚠️ **数字与行号以复算为准**：本文的聚合数与部分 `file:line` 出自审计当时的工具口径与代码状态
> （核对结论：`verify-client` / `verify-glass-surfaces` 的行号锚对应 f73f6f1 一带，`styles.js` 的行号对应更早状态，
> 聚合数在本仓任何提交上都无法用同口径复现）。本仓的复算真源是
> [`../TOKEN-CONTRACT.md`](../TOKEN-CONTRACT.md)（`node test/tools/token-contract.mjs --stats`）——
> **"无门控改写只剩封闭白名单"这一核心结论两边一致**；其余数字一律以契约生成物为准，本文数字不作准。

---

# 混搭 UI 插件共存审计 · 玻璃/壁纸解耦可行性

审计对象：`D:\dsh-wallpaper-engine`（v1.3.1，branch main）。
方法：全库 grep + 逐文件读 + 令牌门控量化脚本 + 4 路子代理审计（其中 2 路静默失败，结论已在本仓内自行复核）。
本文件是**审计记录**，不是已落地的改动；除本文件与 `scratch-scripts/tmp-token-gate-scope.mjs` 外未改任何代码。

---

## 结论（先看这一段）

**问题一：混搭出事不是偶发，是四条确定性机制叠加的结果。**
我们对外只有**一条**中介协议（给 web-all 皮肤插件的单向让路），其余交互全靠"我们不改别人"的自觉。最要命的是第一条：

> 我们把宿主的设计令牌 `--dsw-alias-*` 整层改写成玻璃配方（35 个别名 token）。而 DSH 官方给插件作者的规范就是"用 `--dsw-alias-*` 上色"。**⇒ 任何按规范写的第三方 UI 插件，都会自动继承我们的玻璃**——我们不知道它存在，它不知道我们存在，用户也关不掉这一层。

**问题二：玻璃与壁纸的完全解耦——可行，而且比 `docs/adr/0008` 记录的乐观得多。**
- 「关壁纸、留玻璃」**今天就已经支持**，并且有守卫钉着（`test/verify-client.mjs:2203-2210`）。
- 「关玻璃、留壁纸」的**渲染层已经具备 78% 的免费回退**：135 条宿主令牌声明里 105 条挂在我们自己的门控属性下，只要不挂属性就整组不匹配。ADR-0008 当年放弃的理由（"不挂门控的令牌改写壁纸激活即生效 ⇒ 关出来是半玻璃"）**只对 19/135 条成立，其中 18 条已经在 `data-we-thinking-native`（思考块自己的开关）后面**，剩下 1 条在插件自有 DOM 元素上。
- 所以真正缺的不是架构，是一个主开关 + 一批守卫改写。**成本重心在守卫和文档契约，不在实现。**

---

## 一、混搭为什么会出事：6 类机制

### M1 令牌层接管 —— 最大的隐式耦合面（唯一的"看不见的耦合"）

- 量化（`node .integration-notes/scratch-scripts/tmp-token-gate-scope.mjs src/styles.js`）：
  **135 条真实 `--dsw-*` 声明 / 46 个不同 token**。其中挂在 `data-we-glass-*` 下 **105 条 / 38 个**，只挂 `data-we-wallpaper` **11 条 / 8 个**，两者都不挂 **19 条 / 10 个**（18 条在 `body[data-we-thinking-native]` 下，1 条在 `.we-layer` 上）。
- 被改写的高危别名（`src/styles.js:236-259`）：`--dsw-alias-bg-layer-1/-2/-3`（面板层次）、`--dsw-alias-button-elevated-fill`、`--dsw-alias-bg-overlay`、`--dsw-alias-markdown-*`、`--dsw-alias-interactive-bg-*`、`--dsw-specific-input-major` …
- 为什么是"耦合"而不是"隐患"：`docs/DSH-UI-INTERFACES.md` §3.4 引用宿主自己的 `references/practices.md`——**"用 theme token（`--dsw-alias-*`）上色，字面色只用于美术"**。按规范写的第三方插件 100% 消费这些 token，于是**自动继承玻璃**：我们看不见它、关不掉它、对方作者不知道。
- **历史先例已经发生过一次**：`docs/CHANGELOG.md:1420`（v0.7.2）——harness 0.1.5 的原生右侧栏画 `--dsw-alias-bg-base`，正是我们在壁纸激活时置为 `transparent` 的那个 token，而原生面板自带无毛玻璃 ⇒ better-sidebar 0.19 之后整个右列全透。当时的修法是把原生右栏**收进**「侧栏液态玻璃」，而不是让令牌可退。
- 设计上其实**已经正交**（`src/styles.js:226-235`：「页面玻璃总锚点 `data-we-glass-page`——**与有没有壁纸无关**」「壁纸只是玻璃的**背景来源**之一」），但正交的是**锚点**，不是**可见性**：第三方插件读 token 拿到的是玻璃配方，不是"玻璃开/关"这个状态。

### M2 第三方私有实现细节被硬编码

- `[data-dsh-better-sidebar]`（对方自己挂的根属性，`src/styles.js:1177-1179`）+ **10 个私有类名后缀**：`_boundaryError` / `_panel` / `_pane` / `_tabBar` / `_paneCard` / `_editorHeader` / `_explorerHeader` / `_gitHeader` / `_browserBar` / `_terminalWrap`。
- 这套选择器在 `src/styles.js` 里**重复了 4~5 遍**（`:1195-1225` 亮色、`:1230-1243` 暗色、`:1252-1261` 媒体/兜底、`:2901-2910` `data-we-glass-fallback` 下，另加 `:1370-1371` / `:2957-2958` 的 `.cm-editor` / `.xterm`，以及 `:3215-3230` 的 `[data-we-sidebar-fullclear]` 版本）。
- `docs/DSH-UI-INTERFACES.md:73` 自己承认「**只能随该插件漂移**」；`:152`「我们是**三层混用**的：宿主槽出口 + 设计令牌 + 第三方私有类名」。仓库已有 ledger 机制（`test/fixtures/harness-ui-surfaces.json` 的 `interfaces.exempt`）给它们**豁免**，也就是**主动选择不设防**。
- `docs/CODE-STRUCTURE.md:479`：非 `@deepseek-ai/*` 依赖（如 dsh-better-sidebar）**无法写进 package.json**，只存在于散文里——"改一处就要改全部"。

### M3 跨插件的投递接缝，没有守卫能兜

- `@linxin666/dsh-ssh` 的终端字体：xterm 只在**构造那一刻**读 `--dsh-ssh-terminal-font`，所以必须写成 body 上的**内联具体字体串**（`src/font/apply.js:130-175`）。ADR-0009 自己写明了代价（`docs/adr/0009-system-fonts-from-the-os.md:97`）：
  > 「多了一条**依赖第三方插件内部接缝**的投递路径。它没有守卫能兜……`dsh-ssh` 改钩子名 / 改读取位置，这条会**静默失效**。」
- 同类的双边契约还有一条（`lib/index.js:641-653`，issue #51）：皮肤中心在**出文档之前**读 `<dataDir>/config.json` 的 `settings.id`；环境变量名 `DSH_WE_DATA_DIR`、文件名 `config.json`、键名 `settings.id` **三样都是双边契约**，任一侧单独改就把首屏预判打回"皮肤先闪一下"。
- 这两条是**唯一有文字记录的**接缝，其余第三方交互（谁先写 body 属性、谁先注入 `<style>`）完全没有约定。

### M4 共存只有一个"让路"协议，且只覆盖一个插件

- 形状（`src/client.js:372-401`）：只读 `html[data-dsh-skin]`（MutationObserver，`src/client.js:532`），**"信号只有一条腿，只读、绝不写对方任何状态"**；进入让路 = 清壁纸 + **整族摘掉玻璃门控**（`src/client.js:419`）+ 停轮换；退出 = 持续缺席后恢复。两条自我约束（不写对方状态、让路态里主题层一个字节都不写，`src/theme-follow.js:65,91,259,301,336,342,414,431`）。
- 这是本仓**唯一一次**认真设计过的跨插件协议，而且做得很对。但它的**方向是单向的**：我们在别人要上台时让路；**没有人能让我们让路**（没有属性级 opt-out），而且它只认 `data-dsh-skin` 这一个信号——皮肤中心之外的任何 UI 插件都看不见它。
- 副作用：整个"让路态"是**内部变量**，第三方插件无法窥知，也无法主动协商。

### M5 包含块劫持（已经踩过两次，且是"跨插件才触发"的类型）

CSS 规范：非 `none` 的 `backdrop-filter`，或任何 `transform`/`translate`，会让该元素成为**其后代 `position: fixed` 元素的包含块**。

- **#89**：`@dsh-external/dsh-webui` 把「AI 浏览器」座位挂在输入卡片内部，我们在卡片上画 blur ⇒ 座位不再相对视口定位、多出数百 px 幽灵溢出（`docs/CHANGELOG.md:1405`、`src/parallax-layer.js:34-39`）。
- **#131**：宿主在 Windows 标题栏模式下把「收起/展开侧边栏」按钮设成 `position: fixed`，我们把 blur 画在列自身 ⇒ 按钮按整列定位，掉了整整一个标题栏高度（`src/styles.js:968-975`、`:1072`）。
- 现有缓解是**正确的**：blur 改由无后代的 `::before` 承载（`src/styles.js:640-661`、`:1123`），视差组改用 `position: relative` + `left/top`（相对定位**不是**包含块），并加了 `parallaxGroupBlocked()`（`src/parallax-layer.js:655-668`，扫组内有没有 `position: fixed` 后代，有则整组不动，`parallaxTargetUnset()` 静止时连 `translate` 属性都摘掉）。
- 但：**这个扫描只在视差开启时跑，而 `parallaxEnabled` 默认 false**；且扫描上限 `src/parallax-layer.js:205` 超限后**照动**（明确写了"认作没验完"）。

### M6 配置面随插件组合变形 + 卸载残留

- 设置页的**结构**取决于装了谁：侧栏玻璃那一整节只在宿主报告 better-sidebar 存在时才渲染（`src/glass-panel.js:375,436-441`；`src/persistence.js:163`；`lib/routes/settings.js:58`；`selection.sidebarPresent`）。用户看到的设置页因别人的插件而不同，**文档里一个字都没提**（`docs/UPGRADING.md:118-119` 只记录了旧版「窗口与侧栏」在没有它不是"一个只有标题的空节"）。
- 卸载闭包 **无守卫**（`src/client.js:5516-5585`）：任何一步抛错（如 `:5535 disposePreparedMedia()`、`:5557 retireFadingLayer()`）都会跳过 `:5577 clearEffects()` ⇒ 整族 `data-we-glass-*`、`--we-*` 变量、`--we-caption-active`、`--we-wallpaper-underlay` 留在页面上，而且 `:5581-5585` 会剩下一份重复样式表。（对照：宿主侧对 disposer 是 `try { d(); } catch {}`，`lib/index.js:3134`——客户端没有镜像这个纪律。）
- 有意保留的残留：`clearEffects()` **不摘** `data-we-wallpaper`（那是 `setWallpaperActive(false)` 的活，`src/live-layer.js:2024-2026`）；样式表按 `cssTag.dataset.pluginCssGen === CSS_GEN` 生成守卫（`src/client.js:5583`），HMR 后旧 bundle 的 `<style>` 会留在 `<head>`；`themeFollowRelease()` **不在卸载路径上**（只在 `src/media-prep.js:463`），所以壁纸写过的宿主主题在插件卸载后继续存在（`src/theme-follow.js:8-9` 明确这是设计："不回滚已经写下的主题"）。

---

## 二、可以做的策略（按 收益/代价 排序）

| # | 策略 | 治哪一类 | 代价 | 优先 |
|---|---|---|---|---|
| S1 | **玻璃主开关 / 共存四态** | M1 M6 + 问题二 | 中（守卫重） | P0 |
| S2 | **令牌契约文件化 + 漂移守卫** | M1 M2 M3 | 低 | P0 |
| S3 | **让路协议通用化（属性级 opt-out + 对外信号）** | M1 M4 | 低 | P0 |
| S4 | **共存自诊断 + 一键降级到"仅壁纸"** | 全部（把静默变可见） | 中 | P1 |
| S5 | **第三方面契约集中化（一个映射表 + 版本漂移测试）** | M2 M3 | 低 | P1 |
| S6 | **包含块预检常开（不依赖视差开关）** | M5 | 低 | P1 |
| S7 | **卸载健壮性（逐步 try/catch + 幂等 + 单一属性表）** | M6 | 低 | P1 |
| S8 | **共存文档（冲突矩阵 + 补上"玻璃关不掉"的真相）** | 全部（用户自救） | 低 | P0 |

### S1 玻璃主开关 / 共存四态（P0，直接回答问题二）

不要做成两个独立布尔（会组合爆炸且和门控正交语义打架），而是**一个模式键**，四种态正好对应混搭场景里用户真正要的东西：

| 模式 | 玻璃釉层 | 页面透出壁纸 | 今天 | 说明 |
|---|---|---|---|---|
| `full` | 开 | 开 | ✅ 默认 | 玻璃 + 壁纸 |
| `glass-only` | 开 | 关 | ✅ 已支持且有守卫 | 关壁纸（清除选择即可），玻璃留在原生底色之上 |
| `wallpaper-only` | 关 | 开 | ❌ 缺主开关 | `verification` 见 §三：**渲染层已就绪** |
| `off`（让路） | 关 | 关 | ✅ 已有实现 | 就是 `enterSkinYield`（`src/client.js:407-419`） |

`off` 这一态已经存在，等于第四态的实现早就写好了——**只差把它从"给 web-all 的内部自动行为"提升为"用户/第三方可声明的状态"**。

实施清单：
1. `lib/settings-schema.js` 加键（注意：这是**唯一允许的共享内核**，改它要重新 `pnpm build` 生成 `lib/client.js`）+ KINDS + sanitize + 迁移。
2. **门控属性挂载收成一个来源**：`src/glass.js:34`、`:46`、`:143`、`:148`、`:267`；`src/effects.js:480`；`src/effects.js:348-351`/`:382` 的抑制表——今天**同一族属性有三份副本**，必须先合一，否则开关一定会漏面。
3. CSS **不用改**（105 条声明已经天然随门控回退）；确认 19 条残留：18 条 `data-we-thinking-native`（思考块自己的开关，本来就该这样）+ 1 条 `.we-layer`（插件自有元素）。
4. UI：设置页 + 快捷面板放一个模式选择 + i18n。
5. **守卫改写**（真正的工作量，见 §三.5）。

### S2 令牌契约文件化 + 漂移守卫（P0，最便宜的止损）

把"我们改写了哪些公共 token、在哪个门控下、值怎么算"变成**生成物 + 守卫**，形状照抄已有的 `docs/ROUTE-INDEX.md`（`node test/tools/host-route-index.mjs --write` + `test/verify-route-index.mjs`）：

- 生成 `docs/TOKEN-CONTRACT.md`（46 个 token × 门控归属 × 消费者说明），守卫 `test/verify-token-contract.mjs` 在令牌集合变化时报红。
- 与已有 ledger（`test/fixtures/harness-ui-surfaces.json` 的 `interfaces.exempt` + `docs/DSH-UI-INTERFACES.md` §2.3/§2.5 要求"豁免必须写理由"）**合并成一份对外契约总表**：我们改谁的 token、读谁的属性/私有类名、读谁的配置文件——每条都要有漂移守卫或明确的"无守卫可兜"标注。
- 好处：新第三方插件出问题时，第一次能**在仓库内定位到"这是不是我们改的那个 token"**，而不是像现在每次靠人肉排查。

### S3 让路协议通用化（P0，把单插件协议变成 API）

三条都是**只读信号、不写对方状态**，与现有 web-all 协议的自我约束同形，风险低：

- a. **对外广播我们的状态**：让路态时把 `data-we-yield="skin"`（或复用已有内部态）挂到 `<html>`。今天这是内部变量，第三方看不见，也就无法配合我们。
- b. **属性级 opt-out（最需要的单向闸门）**：读 `html[data-we-glass-skip="settings,sidebar"]`，任何插件**或用户**都能声明"这几个面别接管"，我们整族摘掉。这一条直接消灭 M1 里"看不见的耦合"——受影响方第一次有了自救手段。
- c. **信号源从 1 个扩到 N 个**：现有只认 `data-dsh-skin`；加通用 `html[data-ui-skin]` 约定并写进文档。

### S4 共存自诊断 + 一键降级（P1）

- **自我属性守恒守卫**：`src/client.js:532` 今天只观察 `data-dsh-skin`。再挂一个 `body` 属性观察器，比对"我们刚写的值"与"当前值"——不一致就说明**有别的插件在改我们的门控属性**，记一条 diag 并给"重新接管 / 切到仅壁纸模式"的按钮。这是把"混搭导致的意外"从静默变成可见的最小实现。
- 在 `lib/routes/diag.js` 出一节「共存诊断」：已装插件清单（`lib/index.js:1012-1027` 已经在遍历 cordis loader 条目树，扩成枚举所有插件很便宜）、当前活跃面、被改写/被摘除的门控属性、当前模式。
- 顺手把 `src/client.js:5516-5585` 的残留做成一键清理。

### S5 第三方面契约集中化（P1）

- 建立 `src/third-party/*.js` 作为**唯一**的第三方名字来源（属性名、私有类名后缀、钩子名、配置文件名），`src/styles.js` 的 4~5 处重复块由它生成。
- 为每份契约加**版本漂移测试**：在测试里对 better-sidebar / dsh-ssh 的产物 grep 那几个后缀与钩子名，缺失即红。这正是 ADR-0009 说的"没有守卫能兜"的补法——**把静默失效变成测试失败**。
- dsh-ssh 那条投递路径至少补一条运行时自检（写了但读不到时进 diag）。

### S6 包含块预检常开（P1）

- 把 `parallaxGroupBlocked()` 的 `position: fixed` 后代扫描抽成独立工具，在启动后（不在每帧）对玻璃载体（输入卡片、左侧栏、标题栏）跑一次，结果进 diag + console 警告，**不改行为**（`::before` 缓解已在）。这样新装的第三方插件把 fixed 座位挂进卡片时，用户能拿到一句人话，而不是"按钮错位"。
- 同时把 `src/parallax-layer.js:205` 的"超限照动"在 diag 里标记为"未验完"。

### S7 卸载健壮性（P1）

- 卸载闭包逐步 `try/catch`（镜像 `lib/index.js:3134` 的宿主纪律），保证 `clearEffects()` / `setWallpaperActive(false)` 一定跑到；重复卸载幂等。
- 把三份属性清单合成一个导出常量（同 S1.2）。
- `themeFollowRelease()` 是否进卸载路径需要一次产品决策（当前 `src/theme-follow.js:8-9` 明确不回滚）；至少要在 diag 里明示"主题是插件写的、卸载后仍在"。

### S8 共存文档（P0，最便宜、用户自救靠它）

新增 `docs/COEXISTENCE.md`，内容：
1. **冲突矩阵**：症状 → 嫌疑机制（token 接管 / 私有类名 / 包含块 / 让路信号）→ 用户可做的三步自查（关哪一面、看 diag、看是不是别的插件也画了同一面）。
2. **"设置页为什么和别人的不一样"**：明说侧栏那节依赖 better-sidebar 存在。
3. 补上被藏起来的真相：**目前玻璃关不掉**（ADR-0008 的结论只活在 ADR + 一个"未发布"的 UPGRADING 段里），以及「关某一面」得到的是**半玻璃**。
4. `docs/adr/0010-*` 修订 ADR-0008 的"放弃关闭玻璃"结论（依据：§三.3 的量化）。
5. 修文档缺口：`README.md:283` 的"关闭「侧栏液态玻璃」会连同编辑器/终端内容面一起恢复原生样式"与 ADR-0008 的半玻璃结论**互相矛盾**；`README.beginner.md:64-79` 只有"关掉壁纸"没有"关掉玻璃"；`docs/TROUBLESHOOTING.md:148` 还引用四个已退役的设置键（`sceneFrameRender`/`scenePrewarmScope`/`sceneLossyRoute`/`sceneGpuAccel`，本分支零命中）；`docs/UPGRADING.md:76-78` 的 `dsh-desktop ≥ 2.0.14` 已过期。

---

## 三、玻璃 / 壁纸完全解耦、各自能关：可行性判定

### 3.1 已经解耦的部分（有证据）

| 维度 | 状态 | 证据 |
|---|---|---|
| CSS 锚点 | 完全分开 | 玻璃 `body[data-we-glass-page]`（`src/styles.js:235`），壁纸 `body[data-we-wallpaper]`（`:221`）；**只有** `src/styles.js:3215-3230` 同时需要两个 |
| DOM | 玻璃零引用壁纸节点 | `src/glass.js:16`「本文件**不读** `selection` 以外的状态」；全文唯一提到壁纸的是 `:42` 的注释 |
| 存储在 | 键集合互斥 | 一个 `selection` 对象（`src/client.js:195`）但键不交叠；玻璃预设是纯玻璃快照（`lib/settings-schema.js:306-318`），写不到壁纸键 |
| 壁纸关掉 | 已支持且有守卫 | `src/media-prep.js:440-466` 清除分支不碰任何 `data-we-glass-*`；`test/verify-client.mjs:2203-2210` 断言"无壁纸时页面玻璃锚点仍须在" |
| 主题跟随 | 有真正的 off 语义 | `src/theme-follow.js:5-9`（关=不评估、不判决、不写、不留痕） |
| 每面玻璃 | 真的能摘自己那面 | `sidebarGlass` / `titlebarGlass` / `leftSidebarGlass` / `thinkingGlass`（`lib/settings-schema.js:541,552,560,566,597`） |

### 3.2 真阻塞项（要动的地方）

1. **玻璃没有自己的驱动**：`src/effects.js:337 applyGlass(selection, s);` 是唯一调用点，藏在壁纸/全局那一趟里。玻璃要能单独跑，得把驱动从 `applyEffects` 里拆出来（或让 `applyEffects` 无条件跑而门控在 `glass.js` 内决定）。
2. **一次订阅、一次卸载**：`src/client.js:5368-5369` 两个 subscribe 在同一个 `ctx.effect` 里，`:5577-5578` 也是一串；半边无法单独卸载。
3. **`lib/settings-schema.js` 里没有主开关**：`enabled` / `master` / `disable` 在 DEFAULTS（`:366-789`）和 KINDS（`:828-991`）里都不存在；`url`/`type`/`id` 根本不是 schema 键（壁纸选择只活在客户端 `selection`）。唯一的 `master` 概念是 `GLASS_CHILDREN`（`:225`，`master: 'thinkingGlass'`）。
4. **卸载序列无守卫**（`src/client.js:5516-5585`）。
5. **主题写入不回滚且卸载不释放**（`src/theme-follow.js:8-9`、`:274`）。
6. **让路态残留**：`skinYieldRestoreId` / `skinYieldRestoreRotation` 是**故意**持久化到宿主 config 的（跨重启要认得让路态），但没有 UI 能清。

### 3.3 关键量测：ADR-0008 的"放弃理由"只剩 19/135

ADR-0008 `:87-97` 的原话是：

> 「**放弃：关闭某一面即"回原生纯色"**……那些面上还有一批**不挂门控**的令牌改写（**壁纸激活即生效**），'关'得到的是半玻璃……若要把'恒挂'的门控属性改回可关：需要先让**令牌层**也能整组回退。」

今天的量化结果：**105/135 条声明已经挂在门控属性下**（外加 11 条挂壁纸门控，本来就该跟着壁纸走），真正"不挂门控"的只有 **19 条**：
- 18 条在 `body[data-we-thinking-native]`（`src/styles.js:796-818`）——这是**思考块自己的开关**，是"有名字、可关、语义正确"的门控，不是漏网的；
- 1 条 `src/styles.js:96` 的 `.we-layer` —— 挂在**插件自有 DOM 元素**上，元素在才生效，卸载即消失。

**⇒ 令牌层其实"整组回退"这件事已经成立。** 更有力的证据：仓库**自己的兼容性 harness 已经在测这个回退**——`test/compat-harness-pages.mjs:598-657` 明确写着"`body[data-we-glass-page]` 上的令牌映射去掉，after 侧就退回原生实色 ⇒ 本条变红"，并在 `:655` 真的执行 `document.body.removeAttribute('data-we-glass-page')`，`:657` 在 finally 里挂回去。

**唯一必须保留的共享责任**是 `--dsw-alias-bg-base: transparent`（`src/styles.js:222` / `:343`）——壁纸要能看见，页面就必须透。但它**已经归壁纸半边**（挂在 `body[data-we-wallpaper]` 下），不是玻璃在借用。**这是解耦能干净落地的关键前提，而且是既成事实。**

### 3.4 判定

- 「关壁纸、留玻璃」：**可以，今天就行**。
- 「关玻璃、留壁纸」：**可以。** 渲染层免费（按 §3.3），实现改动集中在 S1 清单的 1/2/4 三项，**CSS 不需要改**。
- 「两边都关」：可以，且实现已经存在（skin-yield 路径），只需把它变成可声明的第四态。
- **代价的真正形态不是"实现复杂度"，而是"契约与守卫的维护面"**：ADR-0008 写"复杂度远超收益"的体感是对的，但它来自守卫，而不是来自代码。把这个判断讲清楚，是这次审计最有价值的一条——**当年那条"先让令牌层整组回退"的前置条件，今天已经满足了。**

### 3.5 会变红的守卫（改主开关时必然要面对）

| 文件 | 位置 | 钉住的东西 |
|---|---|---|
| `test/verify-glass-surfaces.mjs` | `:1633-1661` | 「**恒挂**（'要不要玻璃'那一层已退役）：设置窗口 / 对话栏 / 插件浮层 —— 任何输入下都必须在」，`:1648` 断言"未挂 ⇒ 必须恒挂"，`:1657` 还要"**无摘除分支**" |
| `test/verify-client.mjs` | `:246-274` | 整页玻璃令牌映射必须在 `body[data-we-glass-page]` 上，且代码里 `setAttribute` / `removeAttribute` 都要有 |
| `test/verify-client.mjs` | `:2203-2210` | **无壁纸时页面玻璃锚点仍须在**（"wallpaper off, glass stays"这半边今天就是靠它钉住的） |
| `test/verify-client.mjs` | `:3650` / `:3680` | `glass.js` 内部 `setAttribute("data-we-glass-page")` 的顺序契约 |
| `test/verify-readability.mjs` | `:216,331-334,345-352,405-406,448-460,481,505,514` | 20+ 处把规则形状锚在 `body[data-we-glass-page]` 上（可读性地板配方必须逐字保持） |
| `test/verify-glass-compositing.mjs` | `:557,780-799` | 扫描面钉在 `data-we-glass-page`（`:782` 说明理由） |
| `test/compat-harness-pages.mjs` | `:598-657` | **已经在测回退**（见 §3.3），是这次改动最有利的先例 |

---

## 四、建议落地顺序

**第一批（文档 + 零风险，1 天内）**
S8 共存文档 + ADR-0010 修订 + 修 README/TROUBLESHOOTING 的矛盾与过期；S2 令牌契约生成物与守卫。

**第二批（协议与可见性，不动渲染）**
S3 属性级 opt-out + 对外让路信号；S4 自我属性守恒守卫 + diag 共存节；S7 卸载 try/catch + 属性清单合一。

**第三批（真正的开关）**
S1 玻璃主开关/四态（含守卫改写）；S5 第三方契约集中化 + 漂移测试；S6 包含块预检常开。

**顺序理由**：S8/S2 让"混搭"第一次变成**可诊断**的问题；S3/S4 给受影响方一条自救路径；做到这一步，即使 S1 拖后，用户的"意外情况"也已经从"静默损坏"降级为"看得见、说得清、能绕过"。S1 是收益最大的一步，但它是唯一会大面积动守卫的一步，放在有了诊断与 opt-out 之后做，回滚面最小。

---

## 附：审计方法与产物

- 量化脚本：`.integration-notes/scratch-scripts/tmp-token-gate-scope.mjs`（花括号栈 CSS 解析器，只计真实声明、排除 `var(--dsw-…)` 回退读取）。运行：`node .integration-notes/scratch-scripts/tmp-token-gate-scope.mjs src/styles.js`。
- 覆盖范围：`src/**`（41 个模块）、`lib/**`（宿主 facade/路由/schema/serve/媒体监督）、`test/**` 的守卫与兼容 harness、`docs/**` 全部（含决策记录、归档区与 `wip/`）、三份 README。
- 子代理审计 4 路，其中「开关矩阵」「第三方危险清单」两路**静默失败无产出**（教训：本仓这种需要精确 `file:line` 的审计要自己做，不要外包）；「文档审计」「耦合地图」两路有效，其结论已并入本文件。
