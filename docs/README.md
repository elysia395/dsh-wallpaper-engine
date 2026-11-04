# docs — 决策与用户文档

> **English**: 用户向文档的英本在 [`en/`](./en/)（`adr/` 与维护者向文档**有意不译**）；英文门面在仓库根 [`README.en.md`](../README.en.md)。
>
> 本项目采用**「代码即真相」**文档模式：渲染 / 逆向 / 根因知识直接内联在对应实现文件的代码注释里。
> `docs/` 只保留**决策**（含验收判据）、**规范**与**用户文档**；实现机制不在这里。

## 语言结构（新增文档前先读这一节）

- **中文在 `docs/` 根，英文在 `docs/en/`，basename 相同** —— 这样"某文档有没有英文版"是**目录级可枚举事实**，
  改一份时对应文件一眼可见（后缀式命名要靠逐个文件猜，也容易漂成 `X-en-v2.md` 这类形态）。
- **每份同名文档顶部都有语言切换链接**；改任一侧请**同步另一侧**（文档头已写明）。
- **例外（有意不译）**：`adr/`（决策记录，中文为权威版本）、`ROUTE-INDEX.md`、`GUARD-MAP.md` 与 `TOKEN-CONTRACT.md`（生成物）、
  `archive/`（历史记录）；`CHANGELOG.md` 的英文版在 [`en/CHANGELOG.md`](./en/CHANGELOG.md)。
- **维护者向文档只留中文**：`CODE-STRUCTURE.md` / `DEV-GUIDE.md` 等 —— 读者是维护者本人，
  双语只是双份维护成本。面向用户的 `README` / `UPGRADING` / `HOW-IT-WORKS` / `TROUBLESHOOTING` / `CHANGELOG` 仍中英成对
  （「共存」不再是独立文档，作为 `HOW-IT-WORKS` 的一节随中英两份同步）。

## 目录的寿命规则（新增文档前先读这一节）

| 类别 | 放哪 | 判据 |
|---|---|---|
| **常青** —— 用户文档 / 规范 / 参考 | `docs/` 根 | 描述**当前**行为或长期约定，随版本更新而不是随工作项结束 |
| **历史** —— 已退役 / 已完成 | `docs/archive/` | 只作为记录存在，**不反映现行实现**；顶部必须有状态横幅 |

**`docs/wip/` 的门槛**：它只放**还没做成事实的东西**；
完成即移入 `docs/archive/wip/`，并且**不许出现"唯一的进度真源"这类台账** —— 需要看守的东西一律写成守卫
（判据边界见 [`adr/0007`](./adr/0007-machine-checks-target-code-not-prose.md)，文档原则见 [`adr/0017`](./adr/0017-code-is-truth-docs-reference-source.md)），账本自己会漂、且漂了不会变红。
过程记录**先把结论写进它该住的地方**（机制 → 实现文件的头注释；判据 → `test/`；取舍 → `adr/`），写不进去的才留在 `wip/`。

## 写作原则（ADR-0017：代码即真相）

- **源码是唯一真相。** 解释机制时引用 `路径:符号` / 文件头注释 / 复算命令，**不复制源码、清单、默认值、条数、行数**；文档里出现会随代码漂的值，按"文档待修"处理，不是维护承诺。
- **文档只留三类内容：** 决策与代价（`adr/`）、用户可见行为的解释（README / UPGRADING / TROUBLESHOOTING / HOW-IT-WORKS 等）、由工具生成并逐字节校验的契约索引（`ROUTE-INDEX.md` / `GUARD-MAP.md` / `TOKEN-CONTRACT.md`）。人工快照/名册/进度账本不是必维护项。
- **不做文档类门禁与文档审阅。** 文档改动只走 docs 快通道的轻量检查（冲突标记 / 断链 / 素材），不要求与代码同 PR 更新，不因"文档没同步"阻塞合并；评审可建议，但不是规则。
- **冲突时以代码为准。** 看到文档与代码不一致就顺手修；历史归档与 `CHANGELOG.md` 是账本，不追溯改写。
- **删减优先于维护。** 主要是源码副本且已漂移的文档，优先删除/归档，只留指向源码的索引，不为它新增守卫。

## 用户文档（中英双语，中文在前）

| 文档 | 内容 |
|---|---|
| [UPGRADING.md](./UPGRADING.md) | **升级指南** —— 前置条件、兼容矩阵、正确更新顺序与「顺序反了怎么恢复」 |
| [CHANGELOG.md](./CHANGELOG.md) | **变更记录** —— 逐版本功能与修复（新版在前）。**英文版在 [`en/CHANGELOG.md`](./en/CHANGELOG.md)**（与其它文档同布局：basename 相同、顶部互换链接） |
| [HOW-IT-WORKS.md](./HOW-IT-WORKS.md) | **工作原理** —— 出图来源链（实时渲染 → 内嵌 MP4 → 实时抓帧 → 自定义画面 → 空态）、宿主 / 客户端分工、**字体集通道**、遮挡暂停与客户端异常留痕、路由族总览（路径表见 [`ROUTE-INDEX.md`](./ROUTE-INDEX.md)）；**含「共存」一节**（玻璃表面与其它 UI 插件、逐面回退、插件作者声明与排查） |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | **排障** —— 安装失败排查与「症状 → 先看哪里」速查 |

**分层约定**：门面 `README.md` / `README.en.md` 只放**不随版本变化、且新访客决策必需**的事实；
任何**带版本号 / issue 号 / 性能数字 / 排障步骤 / 实现细节**的内容一律进上表或 `CHANGELOG.md`
（起因：首页曾有一批 `localStorage` 陈述在某次持久化改造后**集体失真** —— 这正是 ADR-0017"文档不复制会漂的事实"的由来）。

## 规范与参考（常青，中文）

| 文档 | 内容 |
|---|---|
| [CODE-STRUCTURE.md](./CODE-STRUCTURE.md) | **唯一的代码结构手册** —— `lib/` 与 `src/` 的分工规范、目录约定与准入门槛、两个半边与路由族、构建期内联、启停生命周期、数据流、**状态真源清单**、层间边界表、在册守卫；**§2.4 与上游形态的差异与迁移**、**§3.3 字体子系统**也并入本文 |
| [SUBPACKAGE-GRAPH.md](./SUBPACKAGE-GRAPH.md) | **子包依赖图（人工维护速查，可能滞后；以代码与守卫为准）** —— 行树（组件行 vs 独立子包行）、**两张平面**的 Mermaid 图、允许/禁止边表；规范条款在 [`adr/0014`](./adr/0014-subpackage-contract.md)，登记点与条数由守卫现算 |
| [DEV-GUIDE.md](./DEV-GUIDE.md) | **二次开发指南** —— "怎么加一个 X" 的配方（加路由 / 加设置项 / 加浏览器端代码）；**§4 是验证与测试**：三层结构、两档判据、运行矩阵、覆盖范围、`test/tools/` 清单、写判据的十条约定 |
| [DSH-UI-INTERFACES.md](./DSH-UI-INTERFACES.md) | **我们去依赖了 DSH 的哪些 UI 接口** —— 按"客户端产物 / node 宿主 / 桌面壳 / 第三方插件"四层记账：哪些是宿主刻意提供的稳定契约（设计令牌、源码作者写的数据属性）、哪些是构建哈希或第三方私有类名、哪些**与预想不同**（宿主有正式的槽系统而我们钉渲染后的 DOM；`data-dsh-desktop-mode` 其实是桌面壳的 URL 参数）。含**复算方法**（asar 直读 + 偏移→包索引），升级前照它重跑 |
| [RELEASING.md](./RELEASING.md) | **发布** —— 九包发布集（主包 + 八个子包版本锁步）、两条通道（npm / GitHub Release）共用同一份产物、发布顺序与"顺序反了怎么恢复"；发布集的硬闸是 `test/verify-release-set.mjs` |
| [ROUTE-INDEX.md](./ROUTE-INDEX.md) | 宿主路由的**生成索引**（由 `test/tools/host-route-index.mjs` 重算并逐字节比对 —— 手写必烂） |
| [GUARD-MAP.md](./GUARD-MAP.md) | **守卫 ↔ 模块的双向派生映射**（"改了某个模块该跑哪几条"）：守卫→模块、模块→守卫两张表，由 `test/tools/guard-targets.mjs` 从**守卫代码里**派生（`--write` 重算，逐字节比对；生成物，不手改） |
| [TOKEN-CONTRACT.md](./TOKEN-CONTRACT.md) | **`--dsw-*` 令牌契约的生成索引**（我们改写了哪些宿主设计令牌、各挂什么门控、无门控白名单）—— 由 `test/tools/token-contract.mjs` 重算并逐字节比对（`test/verify-token-contract.mjs` 守着，白名单封闭；生成物，不手改）—— 共存耦合面的账本，见 [`HOW-IT-WORKS.md`](./HOW-IT-WORKS.md) 的「共存」节 |

> **上表的英文镜像已撤除**（维护者向文档只留中文，理由见 §语言结构；`ROUTE-INDEX.md` / `GUARD-MAP.md` / `TOKEN-CONTRACT.md` 是生成物，同样只出中文）；用户向文档仍中英成对。

## 决策记录（`adr/`）

**只记取舍**：有备选方案、有人付了代价、后人可能想推翻的那个决定。机制与不变量**不进这里** ——
它们住在对应实现文件的头注释里（本仓的成文纪律：能写在代码旁的规则不单写文档）。

写新 ADR 前先读 [`adr/README.md`](./adr/README.md)：那里有该写什么 / 不该写什么、
头部格式、以及**为什么文档只引用源码而不复制数值**（与 ADR-0017 同口径）。

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
| [0013](./adr/0013-bundle-multi-component-rows.md) | **插件拆分**：终态 = **多包**（主包 + 子包，版本一致），单包多行是**起点**；核心目标 = **降复杂度 / 锚定模块边界 / 解耦合**三件并列；**行级开关 = 宿主路由 ＋ 该组件的浏览器可见面**（可见面由宿主行状态派生、双向对账、"宁可显示不可静默消失"）；**不做**每组件一格客户端开关 / 包内懒块 |
| [0014](./adr/0014-subpackage-contract.md) | **子包规范**：`packages/<pkg>` 独立子包行的成文契约（条款号 `S*`）—— 术语（独立子包行 vs 组件行、宿主/浏览器半边）、布局、清单契约、行与接线、**依赖方向（两张平面 + 禁止边）**、生命周期、开关与重启、发布形态、登记点；判据只加在**代码与磁盘**，**不新增任何 markdown 判据**；依赖图是人工维护的 Mermaid（[`SUBPACKAGE-GRAPH.md`](./SUBPACKAGE-GRAPH.md)） |
| [0015](./adr/0015-glass-surface-ownership.md) | **玻璃表面所有权统一**：统一背景所有权、安全装饰叶节点、未知面原生回退与外部模态让路；修订全局背景令牌泛化接管 |
| [0016](./adr/0016-glass-subpackage.md) | **玻璃子包**：液态玻璃抽离为独立子包行（`wallpaper-engine-glass`），设置面板 / 运行时 / CSS 逐刀出户；停用该行 ⇒ 除内容区壁纸外宿主回到原生外观（ADR-0010 D2 的 wallpaper-only 态转正） |
| [0017](./adr/0017-code-is-truth-docs-reference-source.md) | **代码即真相**：文档只引用源码位置与复算命令，不复制源码与清单；取消文档类门禁与「文档同步」审阅约束（取代 ADR-0006；原编号 0016，与 glass 子包撞号后让位顺延） |
| [0018](./adr/0018-focus-fence-trusted-gesture-window.md) | **元素级焦点围栏按「可信手势窗口」放行**，不做一刀切：网页壁纸不得周期性抢焦点，也不能整页禁掉焦点；机制与射程的真源是 `lib/we-focus-guard.js` 与 `src/focus-handback.js` 的文件头注释 |

## 已归档（`archive/`，只作记录）

归档件**不反映现行实现**，各件顶部有状态横幅；本文件不维护逐件清单与来源日期（清单会漂，按目录自身枚举即得，ADR-0017 D2/D5）。当前四组：

| 目录 | 是什么 |
|---|---|
| [`archive/adr/`](./archive/adr/README.md) | 拆分子插件重构的旧编号决策档案（旧件带旧编号 → 现行 `D*` 映射） |
| [`archive/audits/`](./archive/audits/) | 过程审计与实施计划（已收口；低价值过程记录已按 ADR-0017 D5 删除，内容留在 git 历史） |
| [`archive/wip/`](./archive/wip/) | 已收口工作项的过程记录（结论已分头落位：机制 → 文件头注释、判据 → `test/`、取舍 → `adr/`） |
| [`archive/specs/`](./archive/specs/) | 已落地的设计稿（官方 pet 桥接迁移） |

> ⚠️ **别把归档物和现行实现混起来**：场景 / 网页壁纸走本仓**内置且在用**的 WebWallGL 实时渲染器
> （`lib/webwallgl/`）—— 分工见 [`CODE-STRUCTURE.md`](./CODE-STRUCTURE.md)，行为见 [`HOW-IT-WORKS.md`](./HOW-IT-WORKS.md)。
> 三件一次性记录（`dev-notes-bom-and-dsh-boot.md` / `awesome-dsh-plugin-pr-guide.md` / `REFACTOR-ASSESSMENT.md`）留在 `archive/` 根下，
> 其中仍然生效的结论已离开它们（见各自文首）。

## 其它

- **没有活账本**：需要看守的东西一律是守卫（入口 [`DEV-GUIDE.md`](./DEV-GUIDE.md) §4 与 [`adr/0017`](./adr/0017-code-is-truth-docs-reference-source.md)）；历史评估只在 `archive/`。
- **尚在进行的工作**可临时住 `docs/wip/`（门槛与去向见 §目录的寿命规则；**里面放了哪些文件不写在这里** —— 按目录枚举即得）。本机专用临时待办不入库，也不被任何入库文档引用。
- 开发/发布：仓库根 `CONTRIBUTING.md`（含「`lib/client.js` 到底是什么」）；用户门面：`README.md` / `README.en.md` / `README.beginner.md`。
- `images/`：**已不是门面截图的来源** —— 展示图走 Release 外链（取舍见 [`adr/0012`](./adr/0012-artifact-untracking.md)），该目录在 `.gitignore` 内。
