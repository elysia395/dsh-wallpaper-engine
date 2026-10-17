# docs — 决策与用户文档

> **English**: 用户向文档的英本在 [`en/`](./en/)（`adr/` 与维护者向文档**有意不译**）；英文门面在仓库根 [`README.en.md`](../README.en.md)。
> 原先的 `en/README.md`（维护者向索引的英文镜像）已按本节规则撤除。
>
> 本项目采用**「代码即真相」**文档模式：渲染 / 逆向 / 根因知识直接内联在对应实现文件的代码注释里。
> `docs/` 只保留**决策**（含验收判据）、**规范**与**用户文档**；实现机制不在这里。

## 语言结构（新增文档前先读这一节）

- **中文在 `docs/` 根，英文在 `docs/en/`，basename 相同** —— 这样"某文档有没有英文版"是**目录级可枚举事实**，
  改一份时对应文件一眼可见（后缀式命名要靠逐个文件猜，也容易漂成 `X-en-v2.md` 这类形态）。
- **每份同名文档顶部都有语言切换链接**；改任一侧请**同步另一侧**（文档头已写明）。
- **例外（有意不译）**：`adr/`（决策记录，中文为权威版本）、`ROUTE-INDEX.md` 与 `TOKEN-CONTRACT.md`（生成物）、
  `archive/`（历史记录 —— 原先单独列出的 `dev-notes-bom-and-dsh-boot.md` 与
  `awesome-dsh-plugin-pr-guide.md` 现已归入 `archive/`）。
  `CHANGELOG.md` **已经拆成中英两份**（英文在 `en/CHANGELOG.md`），不再属于例外。
- **维护者向文档只留中文**（2026-10 文档瘦身）：`CODE-STRUCTURE.md` / `DEV-GUIDE.md` /
  `FONT-SYSTEM.md` 的英文镜像已撤除 —— 读者是维护者本人，双语只是双份维护成本；
  面向用户的 `README` / `UPGRADING` / `HOW-IT-WORKS` / `TROUBLESHOOTING` / `COEXISTENCE` / `CHANGELOG` 仍中英成对。
  （先例：`en/UPGRADING.md` 早就写过"CHANGELOG (Chinese only)"。）

## 目录的寿命规则（新增文档前先读这一节）

| 类别 | 放哪 | 判据 |
|---|---|---|
| **常青** —— 用户文档 / 规范 / 参考 | `docs/` 根 | 描述**当前**行为或长期约定，随版本更新而不是随工作项结束 |
| **历史** —— 已退役 / 已完成 | `docs/archive/` | 只作为记录存在，**不反映现行实现**；顶部必须有状态横幅 |

**`docs/wip/` 的门槛**（2026-10 曾整体清空一次 —— 清空的是**当时的文件**，目录本身保留）：它只放**还没做成事实的东西**；
完成即移入 `docs/archive/wip/`，并且**不许出现"唯一的进度真源"这类台账** —— 需要看守的东西一律写成守卫
（见 §写作纪律 与 [`adr/0007`](./adr/0007-machine-checks-target-code-not-prose.md)），账本自己会漂、且漂了不会变红。
过程记录**先把结论写进它该住的地方**（机制 → 实现文件的头注释；判据 → `test/`；取舍 → `adr/`），写不进去的才留在 `wip/`。

## 写作纪律（**注释 / 守卫 / 文档**三处的共同底线）

> 本仓的成文纪律只有这几条 —— 它们的**家在这里**（入库），不借住在任何本机专用的文件里。
>
> **纪律靠约定，不靠守卫。** 这里此前挂着一批"机器判定"的文档类守卫，已按
> [`adr/0006`](./adr/0006-comment-discipline-as-written-convention.md) **撤除并已下线**
> （决策与执行都已落地 —— 那两条守散文的守卫不再在链上跑）：
> 写作纪律判断的是「读者会不会被误导」，把它降级成正则匹配只会让作者去躲词表，
> 而且守卫自身会腐化与自相矛盾。
> 因此下表第三列**只写"由什么兜住"**，且**没有就是没有** —— 不许用一条恒真的判据冒充覆盖。
>
> 撤除的**只**是文档 / 注释 / 账本散文类；守**代码**问题的守卫（可达性、退役线、声明孤儿、
> 模块布局）**保留**，且不因本次撤除而放松。
> **加一条判据前请过 [`adr/0007`](./adr/0007-machine-checks-target-code-not-prose.md) 的四问** ——
> 尤其第 4 问：判据里出现面向用户的文案字面量（`includes('某句中文')`）本身就是要修的信号，
> 出路是改成 `weT(...)` 可译键、或撤除。

| # | 规则 | 由什么兜住 |
|---|---|---|
| 1 | **注释写不变量，不写编年史** —— 日期、「曾经 / 旧实现」框定、实测症状与踩坑记录一律不进代码注释 | 无守卫（写作约定）。历史价值的内容进 `CHANGELOG.md` 或 git 历史 |
| 2 | **「实测 X ≈ Y」是出处，不是编年史** —— 给经验值与浏览器行为标出处的句子必须留，否则读者分不清「测出来的」与「猜的」 | 无守卫（写作约定）。出处**留在被实测的那个代码位置附近**，不搬进常青文档散文 |
| 3 | **能写在代码旁的规则不单写文档** —— 机制 / 不变量 / 契约写在**文件头**；文档只留决策、顺序、验收判据与证据锚点 | 无守卫（写作约定）；落点规范见 [`CODE-STRUCTURE.md`](./CODE-STRUCTURE.md) |
| 4 | **常青文档不写会漂的数值** —— 默认值 / 范围 / 枚举清单 / 条数 / 行数 / 体积 / 耗时阈值一律改为**符号引用**或**复算命令**。真源：设置 → `lib/settings-schema.js`，路由 → [`ROUTE-INDEX.md`](./ROUTE-INDEX.md) | 无守卫（写作约定，见 ADR-0006）。**例外**：`CHANGELOG.md` 与 `docs/archive/**` 是账本，其中数值**保持原样**，改了就是伪造记录 |
| 5 | **退役线只许缩小** —— 反向探针先于删除；基线只许收紧，删完清空即为「零残留」 | `test/verify-retired-lines.mjs` |
| 6 | **守卫判据只针对代码，不针对散文** —— 断言「源码里不再有 X」之前先剥注释 | [`DEV-GUIDE.md`](./DEV-GUIDE.md) §4.7 |
| 7 | **跳过不得与通过同形** —— 缺前置要么红，要么要求显式 `--allow-skip`；静默跳过等于悄悄失去覆盖 | `test/verify-media-bridge.mjs`（`--provision` / `--allow-skip`） |
| 8 | **决策进 ADR，机制进文件头** —— 有备选方案、有人付了代价的取舍写成 [`adr/`](./adr/)；"怎么实现的"写在对应实现文件的头注释 | 无守卫（写作约定）；格式见 [`adr/README.md`](./adr/README.md) |
| 9 | **活文档不引用归档件** —— 归档区只作记录；活文档（含 `docs/wip/` 与 `src/**`、`test/**` 的注释）**不出现**指向归档的路径或归档条目号。需要那条信息就把它**写进活文档**：机制 → 实现文件头、判据 → `test/`、取舍 → `adr/`、历史 → `CHANGELOG.md` 或 git 历史。**例外**：本文与 [`adr/README.md`](./adr/README.md)（两级索引要列归档件）、`CHANGELOG.md`（账本）、命令与 pathspec 里的路径 | 无守卫（写作约定）。复算：`git grep -n 'archive/' -- ':!docs/archive' ':!docs/README.md' ':!docs/adr/README.md' ':!docs/CHANGELOG.md' ':!docs/en/CHANGELOG.md'` |

**入库文档不得引用本机专用的未跟踪路径** —— 读者打不开的东西不要指向它。唯一豁免是 `docs/archive/`
（历史记录，顶部已声明不反映现行实现）与其取证线索。

## 用户文档（中英双语，中文在前）

| 文档 | 内容 |
|---|---|
| [UPGRADING.md](./UPGRADING.md) | **升级指南** —— 前置条件、兼容矩阵、正确更新顺序与「顺序反了怎么恢复」 |
| [CHANGELOG.md](./CHANGELOG.md) | **变更记录** —— 逐版本功能与修复（新版在前）。**英文版在 [`en/CHANGELOG.md`](./en/CHANGELOG.md)**（与其它文档同布局：basename 相同、顶部互换链接） |
| [HOW-IT-WORKS.md](./HOW-IT-WORKS.md) | **工作原理** —— 出图来源链（实时渲染 → 内嵌 MP4 → 实时抓帧 → 自定义画面 → 空态）、宿主 / 客户端分工、**字体集通道**、遮挡暂停与客户端异常留痕、HTTP 路由表 |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | **排障** —— 安装失败排查与「症状 → 先看哪里」速查 |
| [COEXISTENCE.md](./COEXISTENCE.md) | **共存** —— 与皮肤中心 / 侧栏插件 / 其它 UI 插件一起装时的冲突矩阵（症状 → 嫌疑机制 → 三步自查）、「玻璃关不掉」的真相与共存四态的目标形态 |

**分层约定**：门面 `README.md` / `README.en.md` 只放**不随版本变化、且新访客决策必需**的事实；
任何**带版本号 / issue 号 / 性能数字 / 排障步骤 / 实现细节**的内容一律进上表或 `CHANGELOG.md`
（起因：首页曾有一批 `localStorage` 陈述在某次持久化改造后**集体失真** —— 这正是本文 §写作纪律 4 的由来）。

## 规范与参考（常青，中文）

| 文档 | 内容 |
|---|---|
| [CODE-STRUCTURE.md](./CODE-STRUCTURE.md) | **代码结构与边界** —— 两份文档合并而成（原 `MODULE-LAYOUT.md` ⊕ `ARCHITECTURE.md`）：`lib/` 与 `src/` 的分工规范、目录约定与准入门槛、两个半边与路由族、构建期内联、启停生命周期、数据流、**状态真源清单**、层间边界表、在册守卫 |
| [ARCHITECTURE-SPLIT.md](./ARCHITECTURE-SPLIT.md) | **本分支的宿主半边形态：门面重写记录** —— "主包 + 组件行 + 内核化"三层各自是什么、门面现在只剩什么、能力分别搬去哪（组件目录 / 内核 / 叶子模块）、与上游单包形态的差异与迁移路径、组件行归属与开关的判据在哪 |
| [SUBPACKAGE-GRAPH.md](./SUBPACKAGE-GRAPH.md) | **子包依赖图（人工维护快照，无判据）** —— 行树（组件行 vs 独立子包行）、**两张平面**的 Mermaid 图、允许/禁止边表、登记点矩阵（每个包 × 每个登记点）；规范条款在 [`adr/0014`](./adr/0014-subpackage-contract.md)，本文只画现状，文头给复算命令 |
| [DEV-GUIDE.md](./DEV-GUIDE.md) | **二次开发指南** —— "怎么加一个 X"的配方（加路由 / 加设置项 / 加浏览器端代码）；**§4 是验证与测试**（原 `TEST-LAYOUT.md` 并入）：三层结构、两档判据、运行矩阵、覆盖范围、`test/tools/` 清单、写判据的八条约定 |
| [FONT-SYSTEM.md](./FONT-SYSTEM.md) | 字体系统的通道分工、不变量、扩展步骤、进浏览器包的约束 |
| [DSH-UI-INTERFACES.md](./DSH-UI-INTERFACES.md) | **我们去依赖了 DSH 的哪些 UI 接口** —— 按"客户端产物 / node 宿主 / 桌面壳 / 第三方插件"四层记账：哪些是宿主刻意提供的稳定契约（设计令牌、源码作者写的数据属性）、哪些是构建哈希或第三方私有类名、哪些**与预想不同**（宿主有正式的槽系统而我们钉渲染后的 DOM；`data-dsh-desktop-mode` 其实是桌面壳的 URL 参数）。含**复算方法**（asar 直读 + 偏移→包索引），升级前照它重跑 |
| [ROUTE-INDEX.md](./ROUTE-INDEX.md) | 宿主路由的**生成索引**（由 `test/tools/host-route-index.mjs` 重算并逐字节比对 —— 手写必烂） |
| [GUARD-MAP.md](./GUARD-MAP.md) | **守卫 ↔ 模块的双向派生映射**（"改了某个模块该跑哪几条"）：守卫→模块、模块→守卫两张表，由 `test/tools/guard-targets.mjs` 从**守卫代码里**派生（`--write` 重算，逐字节比对；生成物，不手改） |
| [TOKEN-CONTRACT.md](./TOKEN-CONTRACT.md) | **`--dsw-*` 令牌契约的生成索引**（我们改写了哪些宿主设计令牌、各挂什么门控、无门控白名单）—— 由 `test/tools/token-contract.mjs` 重算并逐字节比对（`test/verify-token-contract.mjs` 守着，白名单封闭；生成物，不手改）—— 共存耦合面的账本，见 [`COEXISTENCE.md`](./COEXISTENCE.md) |
| [TRIAGE.md](./TRIAGE.md) | **问题分诊与认领** —— 标签体系（`status:*` / `area:*`）、`/assign` 认领与失联回收、PR 与 issue 的关联要求；机器人实现 `.github/workflows/issue-claim.yml`，治理总纲见 issue [#212](https://github.com/elysia395/dsh-wallpaper-engine/issues/212) |

> **上表的英文镜像已撤除**（维护者向文档只留中文，理由见 §语言结构；`ROUTE-INDEX.md` / `GUARD-MAP.md` / `TOKEN-CONTRACT.md` 是生成物，同样只出中文）；用户向文档仍中英成对。

> 原先列在这里的两份已移入 `archive/`（见下文「已完成的审计…」之后的**其它归档**一节）：
> `dev-notes-bom-and-dsh-boot.md`（一次本机排查的过程记录，含当时的绝对路径）与
> `awesome-dsh-plugin-pr-guide.md`（一次性发布指南，当时的提交快照）。**两者都不描述现行实现。**

## 决策记录（`adr/`）

**只记取舍**：有备选方案、有人付了代价、后人可能想推翻的那个决定。机制与不变量**不进这里** ——
它们住在对应实现文件的头注释里（本仓的成文纪律：能写在代码旁的规则不单写文档）。

写新 ADR 前先读 [`adr/README.md`](./adr/README.md)：那里有该写什么 / 不该写什么、
头部格式、以及**为什么不写会漂的数值**（与本文 §写作纪律 同口径）。

| ADR | 决定 |
|---|---|
| [0001](./adr/0001-webwallgl-in-tree-live-renderer.md) | 场景壁纸用内嵌 WebWallGL **实时渲染**，而不是离线成帧 / 转码 / 依赖 WE 常驻 |
| [0002](./adr/0002-settings-schema-single-source.md) | 设置的**唯一真源**收进一个共享文件，宿主与客户端都从它派生 |
| [0003](./adr/0003-build-time-module-inlining.md) | 浏览器半边靠**构建期内联**拆分，不用运行时模块 |
| [0004](./adr/0004-two-tier-guard-verification.md) | 守卫按**失败的含义**分硬 / 软两档 |
| [0005](./adr/0005-media-loopback-origin.md) | 壁纸媒体由宿主自建的**独立 loopback 源**提供 |
| [0006](./adr/0006-comment-discipline-as-written-convention.md) | 注释与文档纪律改为**纯写作约定**，撤除文档类机器守卫 |
| [0007](./adr/0007-machine-checks-target-code-not-prose.md) | 机器判据**只针对代码与磁盘，不针对散文**（四问判定程序 + 保留 / 撤除清单） |
| [0008](./adr/0008-glass-config-two-state.md) | 玻璃配置收成**两态**（"要不要玻璃"整层退役；每面一个「独立配置」= `inherit` / `custom`）并定下**门控策略**：恒挂属性做 CSS 侧的证书，**简化配置 / 高级配置**按 `ctx.surface` 分档（D4） |
| [0009](./adr/0009-system-fonts-from-the-os.md) | 本机字体清单**由宿主问操作系统**（枚举 + 缓存，浏览器侧只当读者），而不是在进程内解析字体文件或从浏览器枚举；取不到权威来源就如实标 `approximate` |
| [0010](./adr/0010-glass-off-revisit-four-states.md) | **修订 ADR-0008 的「放弃关玻璃」**：令牌层整组回退的前置条件已成立（账本 [`TOKEN-CONTRACT.md`](./TOKEN-CONTRACT.md) + 封闭白名单守卫）；目标形态 = **一个模式键四态**（full / glass-only / wallpaper-only / off），实施分三批、主开关最后 |
| [0011](./adr/0011-preset-full-snapshot.md) | 预设从**玻璃子集快照**升为**整机配置快照**（键集由 `KINDS` 派生、资产按需携带、旧预设作废、新增导入导出） |
| [0012](./adr/0012-artifact-untracking.md) | 构建产物出库（`lib/client.js` 不入库，改由 build / prepack 现场构建）＋ README 展示图迁至 Release 资产外链；修订 ADR-0003 的 D6 |
| [0013](./adr/0013-bundle-multi-component-rows.md) | **插件拆分（现行唯一版本）**：终态 = **多包**（主包 + 子包，版本一致；D6/D8 于 2026-10-14 就地改写），单包多行是**起点**；核心目标 = **降复杂度 / 锚定模块边界 / 解耦合**三件并列；**行级开关 = 宿主路由 ＋ 该组件的浏览器可见面**（可见面由宿主行状态派生、双向对账、"宁可显示不可静默消失"）；**不做**每组件一格客户端开关 / 包内懒块。**旧 0012–0016（该决定的旧编号）已归档**到 [`archive/adr/`](./archive/adr/)；本决定**重编号 0012 → 0013**（让位给上游的 `0012-artifact-untracking`） |
| [0014](./adr/0014-subpackage-contract.md) | **子包规范**：`packages/<pkg>` 独立子包行的成文契约（条款号 `S*`）—— 术语（独立子包行 vs 组件行、宿主/浏览器半边）、布局、清单契约、行与接线、**依赖方向（两张平面 + 禁止边）**、生命周期、开关与重启、发布形态、登记点；判据只加在**代码与磁盘**，**不新增任何 markdown 判据**；依赖图是人工维护的 Mermaid（[`SUBPACKAGE-GRAPH.md`](./SUBPACKAGE-GRAPH.md)） |

## 已归档（`archive/`，只作记录）

### 已退役的渲染路线

**为什么归档**：这条**早期废弃**的路线（把场景离线渲染成 PNG）的实现已在独立仓库维护 ——
[`YV3507/we-static-frame`](https://github.com/YV3507/we-static-frame)。
本仓库**只保留历史记录**：下列文档**不反映现行实现**，也不再维护。
（归档的静态帧一支（`archive/static-frame/**`，含 evidence 脚本）**已按 v1.1.0 一节的预定整体删除** ——
该线迁往独立仓库后，长尾记录交给 git 历史。）

> ⚠️ **别把这条和现行实现混起来**：场景 / 网页壁纸走的是本仓**内置且在用**的 **WebWallGL** 实时渲染器
> （`lib/webwallgl/`，源自 [`oneincase/webwallgl`](https://github.com/oneincase/webwallgl)）。
> 它不是归档物：分工与边界见 [`CODE-STRUCTURE.md`](./CODE-STRUCTURE.md)，行为见
> [`HOW-IT-WORKS.md`](./HOW-IT-WORKS.md)。

| 文档 | 内容 |
|---|---|
| [scene-animation/SCENE-ANIMATION-HANDOFF.md](./archive/scene-animation/SCENE-ANIMATION-HANDOFF.md) | 场景动画交接手记（`/scene-anim` 已整体移除） |

### 已完成的审计、真机记录与工作项计划

| 文档 | 内容 |
|---|---|
| [adr/](./archive/adr/README.md) | **拆分子插件重构的决策档案**：`0012`–`0016` 五份（含旧版 0012）已按用户口径**合并**进现行的 [`adr/0013`](./adr/0013-bundle-multi-component-rows.md)，旧件只作记录、各带**旧编号 → 现行 `D*` 编号**的映射 |
| [wip/GLASS-CONFIG-REFACTOR.md](./archive/wip/GLASS-CONFIG-REFACTOR.md) | **玻璃配置重构（用户口径 → 审计 → 分期实施 → 收口，整体归档）** —— 现状测绘（§4 的实测取证）· 目标架构（§10.5）· 分期 R0–R4 与三轮实测修复（§10.9–§10.24）。**机制与不变量已留在 `src/glass.js` / `src/glass-panel.js` / `lib/settings-schema.js` 的文件头**，判据在 `test/verify-glass-surfaces.mjs`（每条带负对照；**组数与条数由该守卫自己报**，文档不抄），取舍与被证伪的方案在 [`adr/0008`](./adr/0008-glass-config-two-state.md) |
| [wip/OPEN-ITEMS.md](./archive/wip/OPEN-ITEMS.md) | **重构账本（主动部分已结项，整体归档）** —— §2 现状基线（上界棘轮）、§3.1–§3.3 现状锚点、§5 状态列、§7 触发线、§9.1 令牌层约束。归档时活着的内容已挪走：**行为缺口 → [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md)**，**令牌层约束 → 守卫**（`verify-readability` / `verify-glass-compositing`）。⚠️ **状态列从来没有机器兜底**（账本守卫随 [`adr/0006`](./adr/0006-comment-discipline-as-written-convention.md) 下线），读它按"未经核对的记录"对待 |
| [wip/POST-REFACTOR-AUDIT.md](./archive/wip/POST-REFACTOR-AUDIT.md) | **收官后审计（过程记录）** —— 2026-09-29 重构结项后的只读复核，**只收工程债**：宿主请求体上限 / 编码正确性 / 无界状态 / 中断泄漏 / 并发删产物、客户端启动链与状态拆除、注释与文档失真，以及**判据缺口**（为什么当时全绿却漏掉这些）。它开出的条目（账本的 P4 系列）**已全部收口** |
| [wip/SIDEBAR-TABS-DESIGN.md](./archive/wip/SIDEBAR-TABS-DESIGN.md) | **侧栏页签 + 类型筛选补「图片」的 UI 设计方案** —— 已随 v1.1.0 → v1.2.0 发布（v1.2.0 又加了「壁纸属性」入口与页内下钻）。含需求口径、实现取舍与文末的落地判据 |
| [REFACTOR-ASSESSMENT.md](./archive/REFACTOR-ASSESSMENT.md) | **重构与设计落实账本（历史半边）** —— 一次重构与设计落实的完整评估：决策（§1）、四组维护难度指标（§3）、风险清单（§4）、静态帧线移除后的形态（§6）、度量方法与复现（§8）、F 轨设计要点与 `V1–V10` 令牌层实测结论（§9）。**不反映现行实现** |
| [audits/ROBUSTNESS-AUDIT.md](./archive/audits/ROBUSTNESS-AUDIT.md) | 健壮性审计（已收口）—— 结论已归口为账本的 P3-1 … P3-22 |
| [audits/F0-THEME-SERVICE-CHECKLIST.md](./archive/audits/F0-THEME-SERVICE-CHECKLIST.md) | F0 真机确认（已关闭）—— 结论（`V1–V10` 约束）在账本 §9.1；原始证据在本地未跟踪目录 |
| [audits/P3-11-PLAN.md](./archive/audits/P3-11-PLAN.md) | `WallpaperPicker` 拆分的过程记录（**已完成**：模型 / 模态框 / 属性面板三块都搬走）—— 开工前的事实核对、先决断言清单与收口时的牙齿证明；结论在账本的 `P3-11` 行，判据在守卫本身 |
| [audits/LOGGING-PLAN.md](./archive/audits/LOGGING-PLAN.md) | 日志分级与提示通道的过程记录（**已完成**：G0 + P1–P5）—— 三档 `error` / `warn` / `info`（默认 `warn`）+ 一条独立的成功提示通道。**机制与不变量已留在 `lib/log.js` / `lib/notice.js` / `lib/routes/diag.js` 的文件头**，判据在 `test/verify-logging.mjs` |
| [audits/F3-PLAN.md](./archive/audits/F3-PLAN.md) | 字体集文件化的过程记录（**已完成**：阶段 0–4）—— 随包预设 · 两层存储 · 人工切换 · 导入导出。**机制与不变量已留在 `packages/fonts/lib/routes/fontsets.js` / `src/fontset-store.js` / `packages/fonts/src/fontset-editor.js` / `lib/settings-schema.js` 的文件头**，判据在 `test/verify-fontset.mjs` + `test/fontset-load-smoke.mjs` |
| [audits/TEST-ANTIPATTERN-AUDIT.md](./archive/audits/TEST-ANTIPATTERN-AUDIT.md) | **测试框架的反模式审计（逐条现状）** —— `test/` 的 72 个 `.mjs`（顶层 57 + `test/tools/` 15）与 2 份夹具按 A1–A4（面向结果编程）/ B1–B4（无意义测试）/ C1–C6（自欺欺人）三族口径逐条过了一遍：每条守什么、**牙齿**（`yes` / `no` / `partial`，即"产品真按它声称守护的方式回归时它会不会红"）如何、现址 `file:line` 在哪。**106 处发现已全部定案**（R 47 / H 33 / D 20 / 不改·声明 5 / 取消 2），未决 0 |
| [audits/TEST-ANTIPATTERN-FIX-PLAN.md](./archive/audits/TEST-ANTIPATTERN-FIX-PLAN.md) | 同一轮审计的**遗留与风险清单**（收口后重写为"现在还有什么问题"）—— 只剩仍未解决或本机证明不了的项（F4/F5 两个手动工具、harness 与 e2e 的覆盖空洞、M16 只剩正判据、设置夹具是漂移棘轮、`%TEMP%` 里删不掉的探针）+ 需要决定的事 + 复核命令。逐条现状在审计报告里，不在这里重复 |
| [wip/](./archive/wip/) 的**第二期收口批** | **追版本第二期（追链 / 文档注释同步 / 测试锚定）的过程记录整体归档**：`TEST-ANCHORING.md`（task-8 判据锚定）· `TEST-CREDIBILITY-AUDIT.md`（对抗性审计 + 修复落地账）· `UNWIRED-MODULES.md`（task-9 孤儿盘点）· `DOC-DRIFT-REPORT.md` + `DOC-ROT-REPORT-2.md` + `DOC-ROT-REPORT-3.md`（三轮文档 / 注释腐化复核）· `COMPONENT-TOGGLE-REPORT.md`（P2-11 开关语义实测取证）· `ISSUE-190-FX-PERF-DESIGN.md`（#190 光效层治理）· `ISSUE-AUDIT-148PLUS.md`（issue ≥148 核查；**残留 6 条未做项写在它的归档横幅里**）。各件的结论已分头落位：机制 → 实现文件头注释、判据 → `test/`、取舍 → [`adr/`](./adr/README.md) |

### 其它归档

| 文档 | 内容 |
|---|---|
| [dev-notes-bom-and-dsh-boot.md](./archive/dev-notes-bom-and-dsh-boot.md) | **BOM 与 DSH 热挂载的一次本机排查记录**（顶部有 `status-banner`）—— 含**当时那台机器的绝对路径**（读者打不开，仅作取证线索）。两条仍然生效的结论**已离开本文**：BOM 由 `verify-package-files` 的 P8 与 `DEV-GUIDE` §4.7 约定 7 承接；热挂载 / 重启语义在 `CONTRIBUTING.md` 与 `CODE-STRUCTURE.md` §1.1 |
| [awesome-dsh-plugin-pr-guide.md](./archive/awesome-dsh-plugin-pr-guide.md) | 向 awesome-dsh-plugin 收录目录提交的**一次性发布指南**（当时的提交快照，含当时的 commit 数与仓库状态）。按作者要求**保留原版、勿改** |

## 其它

- 现状 / 进度：**没有活账本**（2026-10 瘦身：重构账本整体归档）—— 需要看守的东西一律是守卫
  （入口 [`DEV-GUIDE.md`](./DEV-GUIDE.md) §4 与本文档 §写作纪律），历史评估在
  [`archive/REFACTOR-ASSESSMENT.md`](./archive/REFACTOR-ASSESSMENT.md) 与
  [`archive/wip/OPEN-ITEMS.md`](./archive/wip/OPEN-ITEMS.md)（**都不反映现行实现**）。
  **尚在进行的工作**的计划可临时住 `docs/wip/`（**保留目录**：它随工作项的开工与收口一进一出，
  门槛与去向见 §目录的寿命规则；**里面放了哪些文件不写在这里** —— 那是会漂的清单，按目录自身枚举即得）；
  最近一次收口的是 [`archive/wip/`](./archive/wip/) 的**第二期收口批**（8 份过程记录 + issue ≥148 核查，
  见上表最后一行）；再往前是
  [`archive/wip/GLASS-CONFIG-REFACTOR.md`](./archive/wip/GLASS-CONFIG-REFACTOR.md)
  （玻璃配置重构：R0–R4 + 三轮实测修复 + 收口，**已成历史**，结论已按上表分头落位）；
  再往前是 [`archive/wip/PLAN.md`](./archive/wip/PLAN.md)（`src/` 缺陷 · 注释审计 · 目录裁决 · 守卫重构）；
  **本机专用的临时待办不入库**，也不被任何入库文档引用 —— 读者打不开的东西不指向它。
- 开发/发布：仓库根 `CONTRIBUTING.md`（含「`lib/client.js` 到底是什么」）；用户门面：`README.md` / `README.en.md` / `README.beginner.md`。
- `images/`：**已不是门面截图的来源** —— 展示图走 Release 外链（取舍见 [`adr/0012`](./adr/0012-artifact-untracking.md)），
  该目录在 `.gitignore` 内、仓库里没有它（本地可能残留构建/截图产物，不入库）。
- **已溶解进代码**的文档（结论进注释）：`RENDERER-OFFICIAL-STRUCTURE.md`、`RENDER-ISSUES-ANALYSIS.md`、
  `REFACTOR-ROUND-2026-08-28.md`、`REFACTOR-STATIC-FRAME.md`；
  废弃方向（`HOOK-PROGRESS` / `V6-DUMP-ANALYSIS` / `EYE-PREDICTION` / `FIX-PLAN-AMYA` /
  `AMYA-CAMERA-ANALYSIS` / `RENDER-ISSUES-PROGRESS`）已删除。
