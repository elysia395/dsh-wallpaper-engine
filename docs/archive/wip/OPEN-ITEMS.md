# 重构账本 · 未完成项与触发线（**活文档**）

<!-- status-banner: code-is-truth -->
> **状态：历史记录（不反映现行实现）。** 这是那一轮重构的账本，**主动部分已结项**，本文按
> [`docs/README.md`](../../README.md) §目录的寿命规则整体归档（"完成即整体移入 `docs/archive/`"）。
> 归档时把仍然活着的内容挪去了各自更合适的家：**行为缺口**（挂住时留旧层 / 裸 iframe /
> 首帧底色窗口）→ [`docs/TROUBLESHOOTING.md`](../../TROUBLESHOOTING.md) 的"已知行为边界"；
> **令牌层约束（§9.1 的 `V1–V10`）** → 由守卫执行（`test/verify-readability.mjs` /
> `test/verify-glass-compositing.mjs`）。§2 基线 / §5 状态列 / §7 触发线里的机器那半边，
> 现由棘轮与 `test/verify-route-families.mjs` 承担；**状态列从来没有机器兜底**
>（逐行核对的账本守卫已随 [`adr/0006`](../../adr/0006-comment-discipline-as-written-convention.md) 下线）。
> 下面正文原样保留，只作记录。

> **本文是唯一还活着的账本。** 它与
> [`docs/archive/REFACTOR-ASSESSMENT.md`](../archive/REFACTOR-ASSESSMENT.md)（**历史记录，不反映现行实现**）
> 由同一份「重构与设计落实账本」拆分而来。
>
> ⚠️ **状态列的机器核对已经没有了。** 本文此前由 `test/verify-ledger.mjs` 逐行核对"✅ 必须有证据、
> 未完成必须证据不全"，该守卫已随 [`adr/0006`](../adr/0006-comment-discipline-as-written-convention.md)
> **下线**（写作纪律改由约定承担）。因此从那一刻起：**§5 的状态列是一份人工维护的账本，
> 不再有机器兜底** —— 谎报状态不会变红。读它时请按"未经核对的记录"对待。
>
> ⚠️ **这条预言已经应验过一次，而且是它自己写的失败形态。** 本轮收口时实测到**四处失真**：
> P3-28 记着"未提交"而工作早已入库、P2-11 记着"监视器失效"而监视器已重建、§3.1 记着
> `panel-tabs.js` 仍是巨石而已拆完、本页原写着"46 已落地 / 1 未完成"这类会漂的数值。
> 四处都**不会变红** —— 所以：**动过代码之后，回头核对与本次改动相关的那几行**，
> 是这份文档唯一还生效的使用纪律（详见 CHANGELOG 的"账本真源修正"一节）。
>
> **还活着的部分**：§0 用法与状态图例 · §2 规模基线（上界棘轮）· §3.1–§3.3 现状锚点 ·
> §5 状态列 · §7 触发线（第 6、7 条）· §9.1 令牌层约束（`V1–V10`）。
>
> **程序状态：本轮重构的主动部分已结项。** P0–P3 与 F 轨的步骤都已落地；§5 里唯一**未完成**的是
> P4-13（收 body 管道收敛成一个 `readBody()`），P2-11 与 P4-19 是"已落地但等触发条件 / 有余项"。
> **进度条数不写在这里**（会漂，且 [ADR-0006](../adr/0006-comment-discipline-as-written-convention.md) D2 禁止）：
> 总数 `grep -c '^| P[0-9]' docs/archive/wip/OPEN-ITEMS.md`，未完成 `grep '^| P[0-9]' docs/archive/wip/OPEN-ITEMS.md | grep -c '⬜'`（本文件已随文档收敛归档 ⇒ 路径含 `archive/`）。
> **P2-11** 受 §7 第 6、7 条**触发线**管辖：实测路由按路径首段各自成族、最大族**未达 3 条**，
> 跨路由的"隔空故障"也未发生 ⇒ 按账本自己的规则**现在不该做**（继续拆只会增加间接层）。
> 触发线**现在由读代码的守卫看守**：`test/verify-route-families.mjs`（在 `npm run verify` 硬档链里，
> 过线即红；**红 = 该回来裁决**：拆族 或 改 §7-6 的线，处置方式写在它的文件头）。它正是照本页原先
> 指出的正确做法建的 —— 判据搬到**代码旁**，而不是把账本守卫装回来。当前读数：
> `node test/verify-route-families.mjs` ⇒ `ROUTE-FAMILY TRIGGER NOT FIRED (below the line)`。
>
> **结项后这份文档怎么用**：① **不再驱动主动的结构改动**（§5 里没有"过了线却没做"的项）；
> ② §5 的状态列**仍由人维护、不再有机器兜底**（失败形态已实测，见本页开头那条警告）；
> **唯一机器看守的**是 P2-11 的触发线（`verify-route-families`）；③ **新的结构性机会另起一份账本**
> （本文件的顺序与验收判据是为这一轮定的）；④ 该线**全部**收口后本文才整份移入 `archive/` ——
> 现在那一条是"等触发条件"，不是"已收口"。
>
> 写作纪律（不写实现细节 / 不写编年史 / 已完成项每条一句）住在 [`docs/README.md`](../README.md) §写作纪律。

---

## 0. 怎么用这份文档

**状态取值**：`⬜ 未开工` / `🟡 进行中` / `✅ 已落地` / `➖ 已作废`。

**「一步三交」**：每一步必须同时交出三样，缺一不算完成 —— 这条就是本文对"边重构边落实设计"的定义。

| # | 交什么 | 判定 |
|---|---|---|
| ① **结构** | 代码的移动 / 删除 / 抽取本身 | 从 `lib/index.js` / `lib/client.js` 出发的**可达闭包干净**（无悬空 import、无"删了文件守卫还引用") |
| ② **规则** | 该步落地的**不变量**写进代码旁注释 | 只描述"必须/不得"，不描述"曾经"（写作约定，无守卫；见 ADR-0006） |
| ③ **守卫** | 能机器判定的部分加断言，**正/负对照成对**，挂进 `npm run verify` | 负对照必须在场（判据要有牙） |

**执行铁律**：一次提交只切一刀 · `verify:all` 未绿不得提交 · 不做批量文本替换 · **删除先行、重写殿后** ·
**反向探针先于删除** · 守卫判据**先剥注释**再判 · 修复必须配一条能钉住它的守卫 · 只 `git add` 自己的文件。

> ⚠️ **进度标记只许住在 §0 的状态图例与 §5 的状态列** —— 别的节里再写一句"这一步还没做"，就是
> **第二份、无人核对的进度真源**：其余判据都只解析 §5，发现不了它，而它误导的正是"还要不要做、
> 能不能提交"这个判断本身。那条规则同样有守卫（§5 之外零标记 + 负对照）。

---

## 2. 当前基线（**只记指标与复算命令，不记数值**）

> [ADR-0006](../adr/0006-comment-discipline-as-written-convention.md) **D2**：常青文档不放会随代码变的
> 数字（规模 / 条数 / 行数 / 体积 / 阈值），一律改成**符号引用或复算命令**。
> 本节此前抄了十余个数值，**全部漂了**（逐条见 [`POST-REFACTOR-AUDIT.md`](./POST-REFACTOR-AUDIT.md) §5.2：
> 内联模块数、`lib/**` 扫描面、`apply` 行数与路由条数、`WallpaperPicker` 行数、守卫条数、共变耦合均值…）。
> 需要具体值时**当场跑**下面任一列；这里不再留副本。

| 指标 | 复算方式（唯一真源） |
|---|---|
| 浏览器正文行数（`src/client.js`） | `(Get-Content src/client.js).Count` —— ⚠️ PowerShell `Measure-Object -Line` **不计空行**，会少算 |
| 构建期内联模块**条数** | `npm run build` 打印的内联清单；真源是 `scripts/build-client.mjs` 的 `INLINE_MODULES` |
| 生成物 `lib/client.js` | 提交物（构造见 [ADR-0003](../adr/0003-build-time-module-inlining.md)）；判据 = **重建后 `git status --porcelain lib/client.js` 为空**，由 `test/verify-client-sync.mjs` 看守 |
| `lib/**` 扫描面（文件 / 行）、其中**运行时不可达**规模 | `node test/verify-reachability.mjs`（它自己打印这两个口径）；**棘轮基线 = 0 文件 / 0 行**，只许变小（机器看守，这条是**不变量**不是观测值） |
| 守卫 / 冒烟**条数与分档** | `package.json` 的 `scripts.verify` / `scripts["verify:docs"]` / `scripts.smoke`；分档理由见 [`docs/DEV-GUIDE.md`](../DEV-GUIDE.md) §4.2 |
| `apply(ctx)` 体量 / 分支代理 / 闭包状态 / 路由族分布 | `node test/tools/analyze-host-apply.mjs` |
| 路由条数与来源行 | [`docs/ROUTE-INDEX.md`](../ROUTE-INDEX.md)（**生成物**，`node test/tools/host-route-index.mjs --write` 重算） |
| 共变耦合（每次提交动几个文件） | `git log --pretty=format:'C%h' --name-only` 后按提交计文件数取均值 |
| 复制度 | 见 §8 的**方法**（归一化 + 滑动窗口）；⚠️ 必须写明**作用域**，且**排除生成物与 vendored**（见 §3.2） |

> 逐阶段的增量对照表（P0 后 / P1 后 / F1 后 / F2 后）已删除：那些数字只在当时有意义。

---

## 3. 四组维护难度指标（只留结论）

> §3.4 更新维护难度 / §3.5 `apply(ctx)` 拆分评估 / §3.6 P3 的来源已随历史半边归档 ——
> [`docs/archive/REFACTOR-ASSESSMENT.md`](../archive/REFACTOR-ASSESSMENT.md) §3。
> §3.1–§3.3 留在这里：它们是**现状锚点**（规模集中在哪里、复制度作用于哪个范围、耦合的性质）。
> **按 ADR-0006 D2，下面的数值一律换成复算命令**；此前账本守卫锚的就是这些数，该守卫已随 ADR-0006 下线。

### 3.1 复杂度：集中在 **2 个巨石**

| 巨石 | 复算 | 锚点 |
|---|---|---|
| `WallpaperPicker` 组件 | `(Get-Content src/client.js).Count` 配合它的起止行（`grep -n 'function WallpaperPicker'`） | `src/client.js`；模型 / 模态框 / 属性面板已抽到 `src/picker-*.js`，七个页签渲染器在 `src/panel-tabs.js`。⚠️ **本行原写"该文件本身仍是 5 个巨型渲染函数各数百行、是全仓最大的理解单元"——P4-19 之后已不成立**：`renderWallpaperTab` / `renderAppearanceTab` / `renderAdvancedTab` 现在各自只剩一张"按顺序组装各节"的清单（十几行），真正的画法按节住在 `render*Section` 里，每个节只解构自己用到的 ctx 字段。**复算**：`node test/verify-scene-live.mjs`（节顺序判据会打印每个页签的节序列；它同时是这些子渲染器的接缝守卫）或直接扫 `^  function render\w+\(ctx\) \{` 的体量。**唯一剩下的百行级渲染器是 `renderEffectsTab`**（只有一个节标签 ⇒ 拆它要先换锚，见 P4-19 行的余项） |
| `apply(ctx)` 宿主函数 | `node test/tools/analyze-host-apply.mjs`（打印体量 / 分支代理 / 闭包状态 / 路由族 / 族内巨石） | `lib/index.js`；已拆出 **8 个**族模块到 `lib/routes/`（`about-qr` / `diag` / `fontsets` / `github-stars` / `now-playing` / `scene-frame` / `scene-serve` / `upload`） |

⚠️ **复杂度的分布比总量更值得注意**：`lib/media/` 分层清楚。
**烂的是两个门面文件，不是整个仓库** —— 这决定了 P2 是"拆门面"而非"重写内核"。
⚠️ **`apply` 在"拆族"期间仍在变大**：拆出族模块不等于 `apply` 缩水 —— 新增路由继续写在里面。
判据以 `analyze-host-apply.mjs` 的现算值为准，别引用历史数字。

### 3.2 冗余度：文本重复很低，**结构重复只剩有意保留的那些**

- **文本级重复**（复算方法见 §8；**作用域与排除项必须写明**）：
  手写面（`src/**` + `lib/**` 不含生成物与 vendored）在 8 行与 20 行窗口下都是**不足 1%** 量级。
  ⚠️ **必须排除 `lib/client.js` 与 `lib/vendor|webwallgl`**：前者是生成物（把 `src/**` 又装了一遍），
  把两者算进去会把 `lib/**` 的重复率从"不足 1%"虚抬到十几个百分点 —— 那是**度量假象**，不是结构重复。
  本节曾据此写出"`lib/**` 是 103 簇 / 9.6%"的结论，方向是**反的**（见 `POST-REFACTOR-AUDIT` 同族条目）。
- **结构级重复**（**已全部结清**；有意保留的那条除外）：
  PKG/TEX 读取器两份且都在活路径上（**P3-17 已合并** —— 容器原语收口到唯一实现 `lib/pkg-read.js`，
  取更严格的一侧：带 `MAX_DECOMPRESSED_BYTES` 上限；`scene-manifest.js` 与 `lib/index.js` 都从它 import）·
  ~~jpeg-js vendored 副本 + 死依赖~~（死依赖 P0-2 已删；**自带副本与它的唯一消费者 P4-14 一起退役**，
  连那条 TEX→RGBA 解码链整体删净）·
  ~~设置键 4 处镜像~~（P1-5 ✅）· ~~缓存键两处构造~~（P1-6 ✅）。
  ⇒ **只剩"双媒体后端并存"，那是有意保留的设计选择**，不是待办。
- **"收 body"的管道**：曾八条路由各写一份（§审计 6.2）。**P4-13 已收敛**：
  **累加 · 字节计闸 · 一次解码**这三件事现在只有一份实现 `lib/http-body.js` 的 `bodyReader()`，
  9 个缓冲站点全部改走它；只剩**两处结构性豁免**（`/upload` 的 512MB 与 `/custom-frame`
  —— 它们边收边写 `.tmp` + 背压，**不许**把体缓冲进内存）。判据
  `test/verify-body-caps.mjs` 现在管四件事：内联收集器**必须**在回调体内有闸（逐站点名）·
  内联收集器数 **≤ 2** 的棘轮 · 共享读体器调用点 **≥ 9** 的地板 · 以及
  "调用点里被置位的标志必须在它之前声明过"（**这条补的是行为判据的盲区**：迁移时实测漏了
  三处 `let done/tooLarge` 声明，其中 `/we-assets-dir` 一处**没有任何用例往它 POST 过体**）。

### 3.3 耦合度：**一个真接缝 + 一堆全局变量**

**好**：跨端耦合是 **HTTP 协议**（宿主路由 ↔ 客户端所有宿主调用都经 `src/api-client.js` 一个出入口；
条数见 `docs/ROUTE-INDEX.md`），DSH 平台耦合面很小（`inject = ['webServer']` + `ctx.loader` 1 处）。
**坏**：客户端内部**无强制边界** —— 因为 `src/**` 被构建期拍平进**同一个工厂作用域**（[ADR-0003](../adr/0003-build-time-module-inlining.md)），
模块之间没有 `import`，全靠共享作用域协作：`selection` 被绝大多数模块直接读写，`emit()` 是**全局 store 广播**
而不是选择性接缝，另有一批模块级可变 `let` 彼此可见。**这不是本仓可以靠重构消掉的东西** ——
它由上游加载器"没有本地模块解析器"决定（ADR-0003 的重新考虑触发线①）。
**共变耦合**（能量化"改一次要动几处"）：复算命令见 §2 表。


---

## 5. 工作计划（**状态列是唯一进度真源**）

> **已完成项每条一句**：它的结构 / 规则 / 守卫三样东西的**展开形态在代码与守卫里**（模块头契约、`verify-*` 断言），
> 本文不复述。未完成项写清**验收判据**（怎么算做完）。

### P0 —— 立刻做（纯加固，零新增功能）

| # | 动作 | 状态 |
|---|---|---|
| P0-1 | `.github/workflows/verify.yml`：每次 push / PR 在 windows-latest 跑 build + verify + smoke，并断言产物同步与无尾随空白 | ✅ |
| P0-2 | 删死依赖 `jpeg-js`、lock 的 `js-yaml` 对齐 override、根目录吉祥物源资产**归档**（非删除）到 `assets/mascot/` | ✅ |
| P0-3 | 下线三条孤儿路由（`/scene-runtime` `/scene-manifest` `/scene-resource`）+ `lib/scene-player.js`（1,946 行）+ `inventory.sceneUrl` | ✅ |
| P0-4 | 退役行的**防蔓延**反向探针落地（`verify-retired-lines.mjs`，11 项含 4 条正负对照）；**不删任何静态帧代码** | ✅ |

### P1 —— 收敛单一真源 + 零耦合抽取

| # | 动作 | 状态 |
|---|---|---|
| P1-5 | 设置键收敛到唯一真源 `lib/settings-schema.js`，客户端与宿主两侧全部改为派生（行为由 18 例 golden 夹具钉住） | ✅ |
| P1-6 | 帧缓存键收敛到**单一构造点**（`sceneFrameSlot` 复用 `sceneFrameCacheKey`，不自带版本前缀；注释改写成不变量） | ✅ |
| P1-7 | 抽出 `src/we-cond.js`（条件求值器）与 `src/effects.js`（效果应用层）两个客户端模块 | ✅ |
| P1-8 | 账本自检守卫 `verify-ledger.mjs`：状态列机器可核，负对照**从账本自身推导** | ✅ |

### P2 —— 分批（一次一刀，每刀独立提交）

| # | 动作 | 状态 |
|---|---|---|
| P2-9 | `src/api-client.js` 成为宿主 API **唯一出入口**；客户端 13 个模块**零裸 `fetch`**（棘轮 26 → 0）；持久化层抽出为 `src/persistence.js` | ✅ |
| P2-10 | 六个页签抽出到 `src/panel-tabs.js`（**显式 ctx**）；store 写入收敛到 `setSetting` / `setTransient`（"赋值 + 落盘"手抄 50 → 0，页签零 `selection` 引用） | ✅ |
| P2-11 | 宿主 `apply(ctx)` **按路由族拆分**：第一族 `diag` 已落地 → `lib/routes/diag.js`（4 条注册）。**验收判据**：`lib/index.js` 内零 `webServer.register({`、索引逐字节一致、运行时注册条数 == 索引行数。剩余族按 §3.5 的固定动作推进，触发条件见 §7 第 6、7 条。**§7-6 实测（机器判据，已复评）**：`lib/index.js` 内 **13 条注册字面量展开为 14 条路由，14 个首段各不相同、最大组 1 < 3** ⇒ **没有任何族达到 ≥3 条**，按账本自己的规则**不拆**（待过线，或 §7-7 的跨路由隔空故障把优先级提上来）。**触发线原由机器看守**：`test/verify-ledger.mjs` 的 `P2-11` 证据①「§7-6 触发线未过：`lib/index.js` 内路由按路径首段归组、最大组 < 3」（某族长到 3 条它当场变红 ⇒ 回来裁决：拆族 或 改 §7-6 的线）+ 证据②「族模块与 `apply` 调用一一对应」（孤儿族模块 / 族数少于族数下限判红）。⚠️ **该守卫已随 ADR-0006 下线 —— 但这条监视器已经按 §7 第 6 条的复算方式重建为读代码的守卫**：`test/verify-route-families.mjs`（在 `npm run verify` 硬档链里；红 = 该回来裁决，处置方式写在它的文件头）。当前复算：`node test/verify-route-families.mjs` ⇒ `ROUTE-FAMILY TRIGGER NOT FIRED (below the line)`（36 条路由 / 最大族 2 < 3） | 🟡 6 族已落地；剩余族**未过触发线**（监视器已恢复为 `verify-route-families`，读数见左） |
| P2-12 | **静态帧线整体移除（5 阶段）**：删死树 48 文件 / 9,618 行 + 提取链 + 预热，键改名 `lf1`，客户端值域收缩为 `{0,4}`，术语收口。**可达性 0 / 0**。契约与仍在生效的裁定见 §6 | ✅ |

### P3 —— 未归口 / 未声明的需求（与 P2 并列，互不阻塞）

> P2 是"动手拆巨石"；P3 是**让已经写下的声明变成真的**。各条都远小于 P2 的一刀，可在 P2 之间插空做。

| # | 动作 | 状态 |
|---|---|---|
| P3-1 | 类型面与代码对齐：`lib/types/*.d.ts` 补 13 个字段与两个值导出，并新增 `verify-types.mjs` | ✅ |
| P3-2 | 产物同步性指标的表述更正为"重建后 `git status` 干净"（产物是**加载器包装 + 19 个内联模块**，与原文件不可能逐字节一致） | ✅ |
| P3-3 | 可达性守卫入库并挂链：`verify-reachability.mjs`，**不可达行数只许减少**（棘轮已收到 **0 文件 / 0 行**） | ✅ |
| P3-4 | 死 import 已删；`as-is` / `pruned` 两口径与两条"假活锚点"的建模写进脚本头与 §3.6/§8 | ✅ |
| P3-5 | `src/` 通用孤儿扫描（`verify-module-layout.mjs` ①）：除 `client.js` 外每个 `src/**/*.js` 必须已登记 `INLINE_MODULES` | ✅ |
| P3-6 | 依赖方向单向：`lib/**` 不得 import `src/**`（零容忍，同守卫 ②） | ✅ |
| P3-7 | 共享内核白名单（同守卫 ③）：允许被内联的 `lib/**` 只许来自显式清单（当前恰好 1 条） | ✅ |
| P3-8 | 注释纪律的域**从磁盘枚举**、判据是**全局零残留**（禁日期 + 禁编年史/复盘腔）；按文件封顶的登记表已删 | ✅ |
| P3-9 | 给 `P2-9` / `P2-10` / `P2-11` 补机器证据，消除"标 ✅ 却无可核产物" | ✅ |
| P3-10 | **本机待办不入库**，其写作纪律与取证配方却被入库文档 / 守卫指向（复算：指向**根**待办的 9 处；原记 17 处把**已入库**的 `docs/archive/static-frame/TODO.md` 也算进来了）。6 条写作纪律已收口到 [`docs/README.md`](../README.md) §写作纪律（其中 5 条本就住在守卫头部 / `TEST-LAYOUT`），并新增"常青入库文档不得引用本机专用路径"断言（正 / 负对照 + 豁免有据）。**验收判据**：常青面零引用 + 该断言入链 | ✅ |
| P3-11 | **客户端最后一个巨石**：`WallpaperPicker` —— 实测 `src/client.js` **2396–3428（1,033 行）**（原记的 3446 / 1,051 行把 3435–3441 的 `WallpaperPickerSection` 一并框进来了），体内**没有任何子组件**（101 处内联 `createElement`），六个页签渲染器早已搬去 `src/panel-tabs.js` ⇒ 留在 `client.js` 的只有**模态框那份网格**；出向 **84 个**跨边界名字（props 只传 `repoPanel`，**没有任何回调经 props**）⇒ 接缝成本高。**"体内最大嵌套单元仅 6 行"不可复现**（实测最大花括号深度 5、直方图 `{1:365,2:441,3:161,4:59,5:6}`、真正抬升一层的最长块 13 行、最长箭头体 36 行），但**结论方向成立**：真实形态是**宽而浅**（处理器区 469 行 / 45%，含 53 个 `on*`；顶层 return 是单条 281 行表达式 / 27%）。**计划见 [`P3-11-PLAN.md`](../archive/audits/P3-11-PLAN.md)**（已归档） —— 阶段 0 先补行为断言：实测 `verify-client.mjs` 有 **39 处"log 形式伪判据"**（`console.log('x (expect 1):', n === 1)`，占该文件判据约 24%）⇒ **已清零**（机械转换 35 + 人工 11；踩到三个坑：本文件 `assert` 是 strict ⇒ `sliderMax()` 的字符串要按 `'200'` 比；标签写 `expect 6` 但表达式含 `\|\|` 只转成了真值断言；三处"…: ok（N 例）"汇总行本身不判真假）并落地**必须为 0 的棘轮**（牙齿证明：插入一条新伪判据 ⇒ 红并报行号）；分页器整块已换成 11 条真断言 + 2 条负对照；**上传与目录编辑器**由新守卫 `test/verify-picker-upload.mjs`（531 行 / 44 条检查 = 23 正 + 21 负对照）覆盖，并已接进 `verify` 链 + 棘轮表 + 重生 `ROUTE-INDEX.md`（守卫提及列位移：`/inventory` 8→9 等 —— 索引与守卫必须同交）。**模态框 ESC/焦点陷阱的先决条件当初不满足**（挂载台没有 `activeElement`/`focus()`/键盘派发，`trapModalTab`、`modalInitialFocus` 零引用）⇒ **阶段 0b 已补**：挂载台补齐这三样语义与 `window.confirm`，Tab 陷阱 / 初始焦点 / ESC 三条判据都已落地（含负对照）；阶段 1 提纯状态机 `src/picker-model.js`（**连带搬走** `ratingOf`/`isPlayableType`/`isRotatableWallpaper`/`isHiddenWallpaper`/`isUploadedWallpaper`/`isDirWallpaper`，配**跨层对拍**）；阶段 2 只搬模态框 `src/picker-modal.js`（主风险 = **116 个 `.we-picker__*` 选择器的层级契约**，另有 e2e 里一份手抄 markup 镜像要同步）；阶段 3 属性面板。**明确不搬处理器区**：53 个 `on*` 是 ctx 的供给方，搬它等于把接缝从 2 条变成 60 条。**验收判据**：跨层对拍成立（模型算出的卡片数 == 渲染出的 `.we-picker__card` 数）；每个新文件进 `INLINE_MODULES`（why + markers）与 `verify-comment-discipline` 的 CEIL（基线 0）；`lib/client.js` 随 `src/**` 重建入库；关闭时补 `verify-ledger` 的 `P3-11` EVIDENCE（**已补** —— 修前该键不存在，所以这条的 `⬜` 当时不是机器可核的） | ✅ **阶段 0b ✅ + 阶段 1 ✅ + 阶段 2 ✅ + 阶段 3 ✅**：0b 把计划表的先决断言全部落地（分页器 / 搜索 / 类型筛选 / 批量勾选与批量隐藏 / 隐藏页与全部恢复 / 卡片头跨层对拍 / 库存错误态与重试 / 模态框 Tab 陷阱·初始焦点·ESC / 轮换列表编辑器全套 / 上传与目录编辑器另建守卫 44 条），并把 `verify-client` 里 **39 处"log 形式伪判据"清零**且设成**必须为 0** 的棘轮；阶段 1 把六个谓词 + 派生数据 + 分页提纯到 `src/picker-model.js`（170 行），`client.js` 净少 72 行，守卫 `test/verify-picker-model.mjs`（99 条，含跨层对拍 + "24 张 / 2 页"绝对锚点）；阶段 2 把模态框整块渲染搬到 `src/picker-modal.js`（271 行，`client.js` 再净少 207 行），**验收证据**：搬迁前后**类名多重集与 HEAD 零差异**（360 次 / 114 类名）、标记清单该走的走了该留的留了、模块里 0 处 `selection`/`emit`/`setSetting`/`import`、**顶层无可执行语句**、**11 个过渡回调仍定义在 `client.js`**（模块内 `on*` 定义数 0）、`verify-client` 的"标记等价"判据（三态 golden + 3 负对照含"只挪一层" + 字面量绝对锚点 160）**牙齿证明成立**（改一处搬过去的标记 ⇒ 判据红）、`verify` 26 条 + `smoke` 全绿、产物逐字节同步。**阶段 3 完成**：属性面板整块渲染搬到 `src/picker-props-panel.js`（144 行含契约头；`client.js` 只留一层组装适配、净少 94 行，`userProps` 的读写助手与面板状态**一行没搬**）。**先做可达性**——原来的阻碍（面板在挂载台里渲染不出来）由新守卫 `test/verify-picker-props.mjs`（734 行 / 61 条 = 44 正 + 17 负对照）解决：夹具给一张带 `propsUrl` 的网页壁纸 + 可控 `/props/<token>` 应答（在途 / 成功 / 非 2xx / 2xx 但体说 not-ok 四态）；断言覆盖入口三态（网页壁纸出按钮，图片壁纸与**无 `propsUrl` 的场景**都不出）、面板真的渲染出来（头部 + 6 行绝对锚点 + 分组标题不占行）、每个 ptype 的控件分支（bool/color/slider/combo/file/textinput + 兜底）、`condition` 显隐、改动落盘（`userProps` 按 token 存 / 滑块拖动中不重渲染 / 「恢复默认」清覆盖）、两条失败腿的文案，以及**标记等价**（27 令牌 golden + 6 条负对照含"只挪一层"）。**牙齿证明（产品侧，经 `DSH_MUT_LIB` 变异产物）**：① 多加一个类名 ⇒ golden + 绝对锚点红；② **只把提示行挪一层（长度不变）⇒ 只有 golden 红**（层级漂移正是 CSS 层级选择器关心的那类改动）；③ 让属性定义永不重拉 ⇒ 「真的发出一次 `/props` 请求」立即红（证明可达性判据挂在真实路径上）；④ 把失败文案短路 ⇒ 失败腿判据红（面板会改口说"没有用户属性"，正是要拦的静默说谎）；⑤ 在模块里写一句 `selection.id` ⇒ `verify-client` 的接缝判据报"属性面板渲染器不得直接读写 selection（当前 1 处）"。登记三处齐全（`INLINE_MODULES` + CEIL 基线 0 + `verify` 链 26→27），`ROUTE-INDEX.md` 随之重生（`/props` 提及 2→3），`verify` + `smoke` 全绿、产物逐字节同步。**闭环**：`verify-ledger.mjs` 补上 `P3-11` EVIDENCE（该键原先不存在，所以这条此前不是机器可核的），计划文件整体移入 `docs/archive/audits/` |
| P3-12 | 补 `engines`（`>=18`，= 代码真实下限） + `verify-contracts.mjs` ① | ✅ |
| P3-13 | 挂链缺失的守卫、缺前置改为**默认红**或显式 `--allow-skip`（不再与"通过"同形）；CI 另起一步 `npm run verify:bridge`（带 `--provision`，失败即红）⇒ media-bridge 端到端在 CI 有覆盖。**本机"证明不了"只对了一半**：下载那一半是错的（`provision.js` 用 `fetch` 下得下来且校验 sha256 + 体积下限），只有**受限沙箱**里带管道的 spawn 是 EPERM；放开那道边界后本机 **30 通过 / 0 失败** ⇒ 这条可以本机调试。引导预算已改成可覆盖（`DSH_WE_MEDIA_BOOT_MS`，现场默认仍 25s），失败行带子进程 stderr | ✅ |
| P3-14 | 四处"过滤集变空即恒真"的判据补下限或改成单独计数（theme-layer G2 / softrender 两个 gate / package-files P5 / scene 平台跳过） | ✅ |
| P3-15 | 修"断言被写法或环境短路"：F 轨解析、"每个 EVIDENCE 键都必须被查到"、去掉 `\|\| typeof fetch` 逃生口、退役键扫描扩面、`apply` 抛错改硬断言 —— **五项逐条核过并各自挂了机器证据**（见 `verify-ledger` 的 `P3-15`：F 轨 ID 能被账本解析、逃生口已拆成两条无门断言、退役键扫描覆盖 5 个归属文件、`apply` 抛错是 `assert.equal`），状态由账本守卫的"证据全成立 ⇒ 该翻"逼正 | ✅ |
| P3-16 | 替换**恒真式负对照**（名不副实）：route-index / retired-lines / theme-layer / softrender / package-files 已修；两个残留文件已**逐条审计 18 条对照** —— 实测只有 **2 条真恒真**（`verify-component-fonts` 里"只断言常量 / 数组不含 X"），另有 4 条是**判据副本**（对照里另抄一份判据 ⇒ 生产侧改了也不会红），其余本就有牙。判据已抽成命名函数 / 命名正则、正负共用；形态规则写进 `docs/DEV-GUIDE.md` §4.7（当时名为 `docs/TEST-LAYOUT.md`）约定 5。**验收判据**：把判据中和成"永远说没问题" ⇒ 对应负对照必须变红（实测两条全红，而正判据此时照过 = 空转） | ✅ |
| P3-17 | ✅ **已合并**（P3-17 那一刀）：容器/压缩原语搬进唯一实现 `lib/pkg-read.js`（270 行），取更严格的一侧（带 `MAX_DECOMPRESSED_BYTES` 上限）；`pkg-extract` 850→644、`scene-manifest` 511→254。详见下方原判据。⚠️ **该刀只做到"原语唯一"，被合并的那份文件后来整体退役**（P4-14：它的 TEX 解码链已无调用者）⇒ 今天容器知识的唯一实现就是 `lib/pkg-read.js` |
| P3-17（原判据留档） | **同一套 PKG/TEX 读取器两份实现、且两份都在活路径上**（当时的 `lib/pkg-extract.js` ↔ `lib/scene-manifest.js`），不受信输入的分配上限**只加在副本上** ⇒ 同一 `scene.pkg` 在 `/scene-video` 被拒、在 `/scene-audio` 却能驱动 ~2GiB 分配；没有任何守卫比较两份。**验收判据**：导出点唯一 + 上限常量唯一 + 同一夹具对两条路由给出一致裁决 | ✅ |
| P3-18 | 删掉 `lib/index.js` 的死 `readPkg` import（不再为它新建第 3 份、语义不同的 PKG 解析器） | ✅ |
| P3-19 | 收窄 P2-12 的机器退出条件（`lib/scene-manifest.js` 必须**存活**，它仍是 `/scene-video` 与库存视频探测的活依赖），并新增两条"活依赖存活"断言 | ✅ |
| P3-20 | 复制度结论写明**作用域**（`src/**` 与 `lib/**` 差别极大，单边结论不得当全仓不变量） | ✅ |
| P3-21 | 跨半边词汇表（`BASE`、上传 / 自定义画面 MIME）由 `verify-contracts.mjs` ② **读两边源码**比对（不是 import 一边的自证） | ✅ |
| P3-22 | ✅ **已修**：病灶是 `verify-scene.mjs` 真 socket 的 **33MB 超限 PUT** —— 413 路径本身会 `res.end()` 后立刻 `req.destroy()`（设计如此），而 33MB 请求体远没写完 ⇒ 客户端可能先拿到 ECONNRESET。按验收判据改为**接受两种合法结果**（413 / 连接被主动掐断），并**保留"恰好 limit+1"那条**（超限块即最后一块、无竞态）把精确 413 语义钉死；判据仍有牙：服务端若不拒绝，拿到的是 200 而不是 0 | ✅ |
| P3-23 | **夹具把被测行为中和掉**（零覆盖类，后续新增）：实例 —— 所有冒烟都把 `liveBootDelay` 钉成 0，于是"启动等待"路径**零覆盖**，它的两个缺陷（延迟期切走不释放 / 挂载后不武装心跳）只能靠用户反馈发现。交付**只给候选、不下判决**的手动工具 `test/tools/audit-fixture-coverage.mjs`（行为面与数据面分开；自带"必须抓到 `liveBootDelay`"的自检；三个已知局限写在工具头）。**验收判据**：A/B 两族候选**逐条**给出"已有守卫覆盖 / 待补"的结论，待补的落成能失败的守卫 | ✅ A 类 5 个 + B 类 2 个**全部裁定并落成守卫**（都在 `rotation-prepared-leak-smoke`）：`liveBootDelay`（Q1–Q3）· `videoVolume`（R1/R1b/R1c）· `rotationEnabled`（R2）· `rotationGroupId`（R3/R3b）· `pauseOnBlur`（R4/R4b）· `sceneLive`（R5）· `playbackRate`（R6）。**`pauseOnBlur` 的缺口比"没写用例"更深**：挂载台把 `hasFocus` 硬编码为 `() => true`，且 `play()/pause()` 不同步真 DOM 的 `paused` ⇒ 两个分支都不可达 —— 故一并修了**挂载台保真**（不修的话"夺回焦点自动恢复"永远走不到 `play()`，与真机分叉）。**牙齿实证四组**：中和 `weAudioVolume` / `syncRotationTimer` 的早退 / `pauseOnBlur` 那一档 / `liveRenderEnabled` + **两处** `playbackRate` ⇒ 每次**恰好**对应断言变红、其余不受影响（`playbackRate` 有两处落地：只中和一处**不红** —— 判据测的是"结果"而非"某处实现"，这正是想要的） |
| P3-24 | **harness 适配 CI（基线制）**：`harness-compat.yml` **只按需运行** —— 触发面只有 `workflow_dispatch`（不挂 schedule / push；派发 `gh workflow run harness-compat.yml [-f harness_version=<版本>] [-f force=true]`），目标对（harness 版本 × 插件 commit）已入基线则秒过；否则装该 harness → 隔离 profile link 本插件 → 起真 harness 探活（`test/compat-harness-live.mjs`：路由 204 / 落盘标记 / 环形缓冲回读 / 日志无 `plugin tree failed to load`）→ `verify:all`。**全绿才写 `.github/harness-baseline.json` 并自动提交**；任一步失败 ⇒ 红且基线保持上一个全绿对，未入基线的目标保持未入账、下次派发时再试（**不自动重试**）。**第三方边界**：不跑 `verify:bridge` / `verify:e2e`，探活 `DSH_WE_MEDIA_LEGACY=1` 只打 diag 族路由。**验收判据**：工作流触发面只有 `workflow_dispatch`（无 schedule / push）、跑 `verify:all` 且不含 `verify:bridge`；探活/基线两脚本在册（见 `verify-ledger` 的 `P3-24` 四条证据） | ✅ |
| P3-25 | **harness UI 面清单棘轮 + sidebar 源码活判据**（回答「harness 新增页面、美化没盖住能查出来吗」：纯插件自指断言查不出，必须把 harness 侧事实拉进判据）。compat CI 枚举已装 harness 的 `dsh-client-ui-*` 包集，与提交清单 `test/fixtures/harness-ui-surfaces.json`（**52 项裁定**：按 0.1.7-rc.2 latest 播种，sidebar-right=covered、其余 native）做差 ⇒ **新表面未登记即红**：机器只判「新东西出现」，盖不盖由人裁定、裁定必须落盘（改名以「新名未登记」被抓，纯删除不拦；包内新增页面查不出，归下一档页面级快照）。并对**实际安装的** `dsh-client-ui-sidebar-right` 源码断言 `data-sidebar-right-panel` / `data-sidebar-right-open` 两个属性锚点与隐藏机制 allowlist（translate 滑出 / visibility 切换 —— 上游 #107 从注释里的散文引用变成活判据；实测 0.1.7 已无 `translate(100%)`、只剩 visibility，**allowlist 缺一腿就会对基线目标误报红**）。**验收判据**：脚本 / 清单 / 工作流接线三处在册（见 `verify-ledger` 的 `P3-25` 四条证据） | ✅ |
| P3-26 | **逐页 DOM/样式断言（档位 2）**：`test/compat-harness-pages.mjs` 用零依赖 CDP（Node ≥22 全局 WebSocket + `Runtime.evaluate`）驱动无头浏览器进真 harness，走三页下**计算样式**判据：① 首页 —— 插件 client 活着（105KB 主样式 + body 玻璃锚点 + `--we-*` 变量 + 拉绳）；② 会话页 —— 结构化消掉启动弹窗（单按钮 dialog / 跳过型白名单 + `--lang=zh-CN` 钉文案）→ 点「新建会话」→ `main.conversation`+`rightbar` **slot 锚点**挂出（第二页可达）；③ 设置页 —— `:has([data-slot="settings.section"])` 锚点 + **玻璃计算样式按渲染模式取期望**（正常态 = backdrop blur；软件渲染回退态 `data-we-glass-fallback=1` = 显式 none + 平板底 —— 回退是产品在无 GPU 环境的**正确行为**，上游 CI 首跑曾把正确回退判成红，判据已分模式并带 `?we-glassfallback=` 演练钮双态实测）+ 两条模式无关判据（独有 sheen 渐变两档 / `--dsw-alias-bg-layer-1` 被我们接管）+ 五分区逐页走查（每页 dialog 在 + 我们样式在 + 零插件错误）。**牙齿证明**：把锚点选择器改名重编译 ⇒ **恰好玻璃三条变红**（`backdrop=none` / `bg=none` / `layer1=#232324` = harness 原生默认，证明判据挂在「美化是否生效」上），还原后 18/18 绿。右栏 panel 由 harness 内部状态门控 ⇒ **在场才判**、缺席仅记信息（包级 + 页面级两条线已覆盖）。**验收判据**：脚本 / 棘轮表 / 工作流接线三处在册（见 `verify-ledger` 的 `P3-26` 三条证据） | ✅ |


| P3-27 | **本 fork 的硬化刀（10 个提交，已随"追版本"合并上游）**：① 剥注释统一到**字符串感知**实现（`test/tools/js-text.mjs`，16 处迁移）+ 规则 ⑦（禁朴素正则、白名单只许缩小）；② **store 写入契约两侧补齐** —— 瞬态字段经 `setTransient`（属主零裸写 ①d + 跨模块上界棘轮 ①e）、持久化字段必须与落盘配对（①g；并修掉"导入自定义画面在无 `sceneFrameUrl` 时不落盘"那处**真实漏洞**）；③ "改了 store 却不通知"钉到**处理器级**（①h）与**分支级**（①i，与 `test/tools/branch-notify.mjs` 同源），扫描面**派生**自 `INLINE_MODULES`（新模块自动进面）；④ 工具清单进 `docs/DEV-GUIDE.md` §4.6（当时名为 `docs/TEST-LAYOUT.md`）+ 规则 ⑧；⑤ `harness-compat-baseline.mjs` 的**"追尾"修复**（按**内容身份** `plugin.revision` 判重 ⇒ 基线提交不再把插件 commit 推着走，与上游的"推送竞态"修法互补）。**验收判据**：见 `verify-ledger` 的 `P3-27` 五条证据 | ✅ |
| P3-28 | **场景载荷改走自建源 + `/scene-files` 围栏补第二层**：① 场景渲染页的 `mediaBase` 由**宿主**给出（`inventory.sceneMediaBase`，按"库里真有 `sceneLive` 的场景"门控、失败落空串），客户端不再自己拼 `location.origin`；② **媒体源接住根路径 `/diag`**（渲染页信标打 `{mediaBase origin}/diag`，否则场景首帧超时时告警 404 静默丢失），走诊断族**同一个** `handleDiag`（经出参 `onHandleDiag` 交付，保持调用点的语句形态以免被判成孤儿族模块）；③ `/scene-files` 的目录围栏补第二层 —— `lstatSync` 拒链接 + **`realpathSync.native`** 包含性比对（JS 版 realpathSync 在 Windows 上不解析 junction），且该层 **fail-closed**。**验收判据**：`test/verify-scene-live.mjs` 的 4 条新判据（含 3 条负对照 / 平台跳过显式记账）转绿 + `verify:all` 全绿 | ✅ **已入库并复验**（这一刀当时留在工作区，随 P4-1…P4-16 的汇总提交一起入库；`verify:all` 全绿）。**复算命令**（本行原写"未提交"，是对着工作区写的、后来失真）：`grep -n 'realpathSync.native' lib/index.js`（第二层围栏）· `grep -n 'sceneMediaBase\|onHandleDiag' lib/index.js`（宿主给媒体源 / 诊断族共用 handler）· `node test/verify-scene-live.mjs` 的「目录围栏的第二层」一节（含"同目录普通文件照旧 200"的反空转负对照与"链接建不出来就记账"的平台跳过） |

### P4 —— 上一轮**只读审计**欠账的收口（条目出自 [`POST-REFACTOR-AUDIT.md`](./POST-REFACTOR-AUDIT.md)）

> 这一块**不是新计划**：审计（基线 `1ff0887`）列出的欠账，在随后 45 个提交里几乎全未修 —— 现逐条收口。
> 每条都按本账本 §0 的「一步三交」交付（结构 / 规则写进代码旁 / 守卫）。
> **仍未做的**留在下面并写明原因，不许读成"这类问题都没了"。

| # | 动作 | 状态 |
|---|---|---|
| P4-1 | **收 body 必须有上限**：`/remove` `/upload-dir` `/we-assets-dir` `/media-control` 四条补上限；判据**从磁盘枚举**每个 `req.on('data')` 站点（`test/verify-body-caps.mjs`，8 条正负对照 + 覆盖面地板 + 牙齿实证）。不变量写在 `lib/routes/upload.js` 文件头；调用形与上限常量见 `docs/DEV-GUIDE.md` 的"读请求体"一节 | ✅ |
| P4-2 | **逐块解码 ⇒ U+FFFD**：六处（`/settings` `/fontsets` `/remove` `/upload-dir` `/we-assets-dir` `/media-control`）改为边收边计字节、收完只解码一次 | ✅ |
| P4-3 | **`reqLogSeen` 加硬上界**（`REQ_LOG_SEEN_MAX` + 插入序淘汰）；去重与上界冲突时上界优先（重复诊断行可接受，内存有界是硬要求） | ✅ |
| P4-4 | **`/custom-frame` 中途放弃收口**（`req.once('close')` + `completed`/`tmpCleaned`）+ **只清够旧 `.tmp`** 的启动清扫 | ✅ |
| P4-5 | **转码临时文件唯一化**（`atomicTmpPath`）修掉"删兄弟任务产物"；**连带修**清扫器的本进程保护判据（原只认 `.tmp<pid>` 结尾，改名后会静默失效） | ✅ |
| P4-6 | **`uploads/.meta.json` 读-改-写串行化**（进 `enqueueConfigWrite`；两处调用点改为等落盘再应答，保持"响应即已持久化"） | ✅ |
| P4-7 | **启动链终止 `.catch`** + 迁移分支的 `localStorage` 读收进守卫（`readPersistedRaw()`） | ✅ |
| P4-8 | **音乐开关高亮反了**：改为与按钮自身状态（也就是文案判据）逐字同一个；**有意不采用**"开着且有音量才亮"（会让出厂默认下点击无任何视觉反馈） | ✅ |
| P4-9 | **恢复路由族触发线的监视器**为读代码的守卫 `test/verify-route-families.mjs`（账本守卫下线后 §7-6 一度无人看守；处置方式写在文件头） | ✅ |
| P4-10 | **`verify-scene` 的悬空锚点**：`sceneFrameSlotFile` 全仓不存在 ⇒ 判据在扫全文却报绿；改为按下一个顶层函数取边界 + **缺锚即红** + 负对照 | ✅ |
| P4-11 | **文档/注释与实现矛盾的九处**（`theme-follow` 阈值 · `effects` "只读" · 轮换间隔 · 已删除的"预热写盘"不变量 · `live-layer` 编年史注释 · `CONTRIBUTING` 的模块数 · `HOW-IT-WORKS` 的 §9.5 引用 · 死夹具 `fontSetNewName`/`newName` · `en/TROUBLESHOOTING` 缺整节）+ **账本数字按 ADR-0006 D2 退场** | ✅ |
| P4-12 | **账本 §3.2 的复制率结论方向是反的**：那 9.6% 是生成物 `lib/client.js` 把 `src/**` 又装了一遍造成的**度量假象**；已更正并写明"必须排除生成物与 vendored + 必须写明作用域" | ✅ |
| P4-13 | ✅ **已完成**：`verify-body-caps` 的"八条路由各写一份收 body 管道"收敛成一个共享读体器。**做法（先补判据再搬）**：① 新建 `lib/http-body.js` 的 `bodyReader(req, { maxBytes, shouldStop?, onOverflow? })` —— 它只吃**真正重复的那三件事**（累加 / 按累计字节计闸 / `Buffer.concat` 后只解码一次），应答 · 超时 · 断开收口仍留在各调用点（各站策略不同，抽象进来只会把差异藏进参数）；② 分类实测：**11 个收集器 = 9 个"缓冲"站点 + 2 个"流式落盘"站点**（`/upload` 512MB、`/custom-frame` 边收边写 + 背压）⇒ 后者是**结构性豁免**（不许把体缓冲进内存），不是待迁移项；③ 9 个站点逐个改走 `bodyReader`（`index.js` ×3 · `routes/upload.js` ×2 · `routes/scene-frame.js` ×1 · `routes/diag.js` · `routes/fontsets.js` · `routes/now-playing.js`）；④ 判据从"每个站点都要有闸"升级为**四条**：内联收集器必须有闸（逐站点名，流式那两处也在这里被点名）· 内联收集器数 **≤ 2** 的棘轮 · 共享读体器调用点 **≥ 9** 的地板 · 每个 `X.onData` 必须真的来自同文件的 `bodyReader(...)`（`foo.onData` 蒙混不过去）。**判据与实现同交**：`verify-scene` 三条"体积判定与用例一致"的 `needle` 从 `size > X` 改指 `maxBytes: X`（同一个事实、新位置，不是放宽）。⚠️ **迁移过程实测踩中一条真 bug 族**：把 `let done/tooLarge = false` 从内联回调里挪走时**漏声明三处**，`shouldStop`/`onOverflow` 是闭包 ⇒ 一收体就 ReferenceError；行为判据只抓到其中 `/client-diag` 一处，**`/we-assets-dir` 那处没有任何用例往它 POST 过体**（行为判据的盲区）⇒ 为此补了第五条判据"调用点里被置位的标志必须在它之前声明过"（只认 `NAME = true\|false\|数字` 的布尔/计数标志形态，字符串里的 `charset=utf-8` 不误判），**牙齿实证**：去掉一处声明 ⇒ 红并点名 `lib/index.js:tooLarge` | ✅ |
| P4-14 | **`lib/pkg-extract.js` 整体退役 + vendored `jpeg-js` 删除**（审计 §6.1）。实测：从**唯一活入口** `parseTex` 出发，**430 / 645 行**不可达（`decodeTex` 及其全部解码助手 · `decodePngPayload` · `extractTexVideoMp4` · `PNG_GATE_MAX_PIXELS`）；该模块对宿主的**全部**价值只是 re-export `parsePkg` / `readPkgEntry`，而那两个的实现本来就在 `lib/pkg-read.js`。两处 `await import('./pkg-extract.js')` 改指 `./pkg-read.js`，`package.json` 的 `files` 删掉 `lib/pkg-extract.js` 与 `lib/vendor/`。⚠️ **审计那句"`decodeTex` 仍被 `scene-manifest.js` 使用 ⇒ 别误删"是错的**：那处是**注释**（`scene-manifest.js:25`），该文件从头到尾 import 的是 `./pkg-read.js` —— 把注释当调用读。当年真正钉住它的是账本守卫里一条"活依赖存活"断言（检查字符串 `function extractTexVideoMp4(` 存在），该守卫随 ADR-0006 下线后阻碍才消失。**判据**：`test/verify-retired-lines.mjs` ④（退役词在扫描面零残留 + 文件/`files`/副本三条存在性断言 + 负对照）——按"反向探针先于删除"**先加探针、让它红着列出 10 个待清点、再删** | ✅ |
| P4-15 | **`src/panel-tabs.js` 兑现自己的模块头契约**（审计 §6.3）。实测越界不在"写 selection"（那条一直是零），而在判据**看不见**的两类：① 直接 `emit()`（4 个渲染器共 22 处）；② 改写**模块级状态**（`propsPanelOpen = !…` / `pickerFocusPending` / `pickerOpener = el`）与 **ctx 别名指向的东西**（`editing.name/interval/order =`，而 `editing` 就是 `selection.editing`）—— 后者连 `selection.` 字面量都不含，所以那条"只数字面量"的判据一直放行。**为什么审计说它是"真接缝缺口"**：同一刀拆出去的 `picker-modal.js` / `picker-props-panel.js` 早就在严口径下（`selection` 零引用 + `emit(` 零调用），只有本文件不在那张表里。**做法**：把 26 处内联"写 + 通知"抽成 `src/client.js` 的**具名处理器**（`onTogglePropsPanel` / `openPicker` / `on*EditDraft` / `onToggleSceneLive`（五件副作用一起）/ `onFpsCap` / `onObjectFit`（含 Edge canvas 重绘）/ `onToggleLiveDiag` …），经 ctx 传入；页签只剩 `onClick: onFoo`。**判据**：把 `panel-tabs.js` 加进 `verify-client` 的 `RENDERERS`（与另两个渲染器同口径），并新增一条**别名/模块状态改写**判据（赋值 + 成员赋值 + 原地变更三类形态，纯读取与注释提及不误伤）。**牙齿实证**：三类各注入一次 ⇒ 各自红且**点名**（`propsPanelOpen` / `editing` / `不得自己发通知`），还原后 `verify-client-sync` 重建**逐字节一致**。**连带**：`verify-scene-live` 三条"面板 → live"跨文件接线判据随调用点迁移而更新（**两端都钉**：处理器真的做 + 面板确实引用），侧栏 ctx 覆盖名单与真渲染挂载台同步扩面 | ✅ |
| P4-16 | **`sceneFrameSlot` 只留唯一产物**（审计 §6.4）。删掉**零消费者**的三个路径字段 `pngPath`/`jpgPath`/`gifPath`（静态帧提取线遗留）与 `dir`，以及**从没有活调用点会传**的 `_vN` 档位后缀 ⇒ 返回收敛为 `{ key, gpuPath }`（`key` 是 PUT 的写去重锁键，仍在用）。**连带修掉那次白工**：档 4（用户 pin 的自定义封面，**豁免**抓帧）此前仍会 `sceneFrameSlot(abs, 4)` 解析一次槽位 —— 做一次 `statSync` + `ensureFrameCacheDir()`，而产出的路径**永远不会被读**（`gpuFrameFileFor` 对档 4 早就 `return null`）。现在豁免在**调用方**判定（`variant === 4 ? null : gpuFrameFileFor(sceneFrameSlot(abs))`）⇒ 档 4 连槽位都不解析；`gpuFrameFileFor` 同时去掉 `variant` 参数与那条只对 1/2/3 生效、而值域是 `{0,4}` 的死分支。**判据**（`test/verify-scene.mjs`）：死字段在 `lib/` 零残留（**先剥注释再判** —— 解释"为什么删"的注释必须能点名它们）+ **返回恰好两个字段**（按数量判，不按名字：`dir` 在本函数里合法地作为局部变量存在）+ 无档位参数/无 `_v` + 豁免点不解析槽位，四条各带对照；**牙齿实证**：重加 `dir`+`pngPath` ⇒ 红且点名，只重加 `dir` ⇒ 红报 `fields=3` | ✅ |
| P4-17 | **发布产物被真实安装器装一遍**（审计 §7.6；这是审计 §1 里唯一"两条修法都没做"的一条）。**问题**：CI 只跑 `dsh plugin add link:<ROOT>`（软链工作区），而 `verify-package-publish` 只核发布面的**声明**（`files` / 可达闭包 / `dependencies`）⇒ "装 tarball 才会暴露"的那一类全仓零断言。**为什么软链看不见**：软链**不参与依赖解析** ⇒ `peerDependencies` 能否在**安装闭包**里解析，结构性地不在那条通道的视野里。一次用户回执实测过代价：`Packages: +1`（只装了插件自己）→ `generation … already exists, reusing` → `generation peer validation failed: @deepseek-ai/dsh-client-runtime does not resolve from the installation closure`。**做法**（审计的修法② —— 把宿主提供的三个 `@deepseek-ai/dsh-*` peer 标成 `optional` —— 早已落地）：给 `compat-harness-live.mjs` 加**第二条安装通道** `--channel tarball`（先 `npm pack` 再装 .tgz，`--fresh` 隔离 HOME），于是原有的全链路判据（路由可达 / 落盘标记 / 环形缓冲 / 进程存活 / 无插件树加载失败）**一并覆盖发布产物**；另加三条只属于该通道的判据：**通道自证**（装进去的是**真目录**而非软链 ⇒ 证明跑的确实是包装产物）与两条针对性失败串（`peer validation failed` / `does not resolve from the installation closure`）。**CI 两条通道各跑一步**。⚠️ 本机**跑不了**这条通道：沙箱禁带管道的 spawn（连第一步"HOME 隔离对子进程生效"都会以 EPERM 失败）且本机无 `dsh` —— 但**它是响亮地红的、不是静默跳过**（那正是本账本 §0 要求的失败形态）。本机可验的一半已验：`npm pack` 在**工作区本地 cache** 下成功产出唯一 tarball（1.5MB / 39 文件），因此打包步骤不依赖网络也不污染全局 cache | ✅ |
| P4-18 | **CI 加 POSIX 腿**（审计 §8）。**问题**：两个 workflow 都只有 `windows-latest`，而守卫里有**平台条件分支** —— 最实的一条是 `verify-scene` 的 unlink 失败用例：**只有 POSIX 的 `chmod` 能阻止 unlink**（Windows 上模式位基本被忽略）⇒ POSIX 那半（500 `unlink-failed` / 帧仍在盘上 / 重试可用 …）在 win32 上**不执行**，而 win32 那半（ENOENT 幂等）在 POSIX 上不执行；另有 `verify-scene-live` 的 junction/dir 分支与 `verify-media-bridge` 的 win32 专用断言。**判据自己早就把这件事喊出来了**："来自 posix 分支的 5 条 … 在 win32 上没有任何覆盖 —— 这是覆盖差异，不是通过"。**做法**：`verify.yml` 改成 `strategy.matrix.os = [windows-latest, ubuntu-latest]` + `fail-fast: false`（一条腿红了不该把另一条腿的结论藏起来），`concurrency.group` 带上 `matrix.os`（语义唯一：新 push 取消的是**同一平台**的上一次 run）；首步打印 `process.platform` 便于读日志。**`verify:bridge` 两条腿都跑** —— `lib/media/provision.js` 早已声明 linux 资产（`media-bridge-linux-x64-musl` 等，含 sha256），因此不是"没有产物可下"；该步自带"环境跳过"的第三结局，失败即真回归。**判据**：`test/verify-contracts.mjs` 新增 ④ —— 从 workflow 源码解析它**实际会跑的 runner 集合**（同时认 `runs-on: <字面量>` 与 `runs-on: ${{ matrix.os }}` + `os: [...]` 两种形态），断言必须同时含 windows 与 ubuntu/linux；三条负对照分别覆盖字面量单平台、矩阵单平台、以及"矩阵形态必须被解析出全部平台"（否则主判据会假绿）。**牙齿实证**：把 `verify.yml` 改回 windows-only ⇒ 红并点名 `runners=windows-latest`；还原 ⇒ 绿 | ✅ |

| P4-19 | **`src/panel-tabs.js` 的巨型渲染器拆分**（P4-15 的另一半）。**做了什么**：先把"节顺序"变成**行为**判据（见下），再按节把两个最大的渲染器切成"一节一个子渲染器"、父函数只剩组装清单：`renderWallpaperTab` **458 → 16 行**（四个节 102 / 61 / 149 / 162）· `renderAdvancedTab` **111 → 16 行**（五个节 18 / 18 / 44 / 25 / 25）。**为什么先做判据**：这一步是纯搬动、**没有不变量可钉**，而搬动最容易出的事是"漏一节 / 改顺序 / 复制一节"——原先**一条判据都看不见**（`renderWallpaperTab` 与 `renderAdvancedTab` 此前**零行为覆盖**，只有源码锚点）。于是先补**真渲染挂载台**：用真渲染器 + 最小替身渲染这两个页签，抽出树里 `we-picker__section-label` 的**有序**序列 ⇒ 节顺序成为对任何重构都不变的行为判据（顺带钉住"实时渲染诊断"那一节的**门**：视频壁纸不画、场景壁纸画在最后）。**同一轮抓到的两个真问题**：① `...INTERVALS.map(...)` 的**展开写法**让派生正则把它当成成员访问 ⇒ `INTERVALS` 没被解构，某个分支一执行就 ReferenceError（渲染挂载台当场抓到）；为此补了第二条**静态**判据"每个节函数用到的 ctx 字段都必须解构"（以该页签的 ctx 字段全集为词表、先剥注释、展开写法算用到、对象键不算），**牙齿实证**：把 `INTERVALS` 去掉 ⇒ 两条判据各自变红并点名。② 写这条静态判据时自己踩了 **CRLF 切片**的坑（边界串是裸 `\n`，在 CRLF 上匹配不到 ⇒ `indexOf` 回 −1 ⇒ 切片吃到文件尾、把别人的解构也算进来 ⇒ 整个词表被报成"漏解构"）；已在判据里归一成 LF 并写明为什么。**剩余（有意留下）**：`renderAppearanceFontSection`(231) / `renderWallpaperUploadsSection`(162) / `renderWallpaperRotationSection`(149) / `renderAboutTab`(123) 仍是较大的单元，可再分一层（它们各自的节/块已有判据可钉）。**第三轮（同法 + 换锚）**：`renderEffectsTab`（270，**只有一个节标签** ⇒ 节顺序钉不住内部结构）——先给它造**更细的锚**：把 `SliderRow`/`switchRow`/`ctlText` 的标签**从替身里放回树里**（原先 `noop` 把它们吞成 null），于是"**控件标签的有序序列**"成为可判的行为事实：效果页设置档 10 个标签、侧栏档 9 个（少了 `帧率上限`，正是那条侧栏豁免）、外观页设置档 7 个 / 侧栏档 5 个。锚立住后按块拆成五个子渲染器（12 / 42 / 80 / 78 / 21 行），父函数只留"空态提前返回 + 唯一的节外壳 + 五块组装"。**连带修正一处判据口径**：`verify-scene-live` 的"侧栏 ctx 要覆盖渲染器全部字段"原先只读 `render*Tab` 那一层的解构 —— 字段搬进 `render*Section` 后它读到空集而变红（**红得对，是口径没跟上代码**），改为连节函数一起收 **第二轮（同法）**：先给 `renderAppearanceTab` / `renderEffectsTab` 补**同款节顺序期望**（ctx 由渲染器**自己的解构行**驱动：除 `fontSet` / `surface` / `sel` 外全是处理器 ⇒ "要什么"仍由源码说了算），顺带把两条此前只有源码串的**门**变成行为断言（外观页侧栏档 `!sidebarSurface` 包住的三节不画；效果页 `!sel.id` 走空态提前返回），再拆 `renderAppearanceTab`：**350 → 10 行**（五节 38 / 22 / 231 / 27 / 54）。同族**第三个** bug 又在这一轮现形：注入的前导局部量**自身的依赖**没进该节解构（`const sidebarSurface = surface === "sidebar";` ⇒ `surface is not defined`），渲染挂载台当场抓到、3 处一次修好。⚠️ 这条 bug 族（"派生出的名字没带上它的输入"）到目前已出现三次（`...INTERVALS`、CRLF 切片、注入局部量的依赖）—— 三处都是**渲染挂载台**先抓到，静态判据只能覆盖其中第一类 | 🟡  **第五轮（覆盖面收口）**：不再继续拆大小，转而补**行为覆盖** —— 三种锚（标签 / 类名 / 文本，各配正负对照）+ 门的两侧（`wantClasses` / `rejectClasses`）+ 覆盖面地板（用例数 / 带期望条数 / `want`）+ 一条"守卫的守卫"（锚调用与 `sameSeq` 必须被 `if (t.<字段>)` 包住；**缺守卫时是"崩"而非"判红"**）。用例 3 → **18 档**，补掉 5 处真实缺口（挂载台缺实时渲染组替身 · `FRAME_VARIANTS` 空数组让场景档分支不可达 · 转码行漏 `transcodeState` 门 · 两处判据缺守卫）。**结论**：剩余的 100–230 行节**有意不再拆** —— 全仓最大的理解单元已不在 panel-tabs（`apply(ctx)` 1441 行 / `WallpaperPicker` 734 行），而这些节现在**每个都有行为锚**（拆是纯可读性收益，风险与判据 churn 却照旧）。故本项按"有理由的结项"处理。 |

> 它要动的东西**正好落在重构的接缝上**：设置模型（P1-5）、效果/样式应用层（P1-7）、面板结构（P2-10）、宿主文件通道（P2-9）。
> 设计与不变量已收口在 [`docs/FONT-SYSTEM.md`](../FONT-SYSTEM.md)（三个通道、扩展步骤；不变量在 `src/font/` 各文件头），本文不重复。

| # | 动作 | 状态 |
|---|---|---|
| F0 | `theme` 服务的真机确认（主路径成立 + 两处旧结论被推翻）→ 结论并入 §9.1 的 V1–V10；记录保留在 F0 清单 | ✅ |
| F1 | 颜色角色令牌层 `src/font/color-roles.js` + 设置 `themeColors` / `themeDarkSeparate`（首期只做颜色，5 个角色） | ✅ |
| F2 | 排版角色 `src/font/typography.js` + 设置 `themeType`（只追加偏移、不重写 DSH 表达式、不碰字重字族） | ✅ |
| F3 | **字体集文件化**（**已完成**，四项需求全部落地）：**随包预设** —— `lib/fontsets/` 随包发布、**两层存储**（同 id 用户层胜、写时复制：改发布物那份会自动存成用户层的一份））· **导入导出** —— 宿主响应头导出 + `/fontsets/import` 导入，客户端三道本地预检各给可判定文案 · **人工切换** —— `activate` 是唯一改指针的写原语（将来的条件自动切换是**策略层**、必须调它；**激活必须把那份值读回来采用、并把清单一起更新**（`loadFontSet` 同时承担这两件事 —— 少了清单那一句，新建/切换后界面会留着旧列表，要刷新才好） —— 只挪指针界面不会变）。**语义（真机反馈后定）**：字体集是「字体自定义」的**附属**（总开关关掉即整块收起）· 「使用中」= **值仍与采纳时一致**（手动改过 ⇒ 换标「已改」），`activeId`（指针）只做能力判定 · 「只看改过的」**默认开**且"恢复默认"不动它（视图状态不归重置管）。三条决策：D1 字体值退出 settings blob（`config.json` 只留 `{ fontSetId, fontCustom }`）· D2 导出走宿主响应头 · D3 写时复制。过程记录见 [`archive/audits/F3-PLAN.md`](../archive/audits/F3-PLAN.md)；机制与不变量在 `lib/routes/fontsets.js` / `src/fontset-store.js` / `src/fontset-editor.js` / `lib/settings-schema.js` 的文件头；判据在 `verify-fontset`（125 条）+ `fontset-load-smoke`。⚠️ 真机确认仍在根 `TODO`（字号/字重/字族是否分别生效等 Node 守卫覆盖不到的行为）| ✅ |
| G1 | 删掉 legacy「字体颜色」通路（四条 `!important` 折叠 + 全局墨色覆盖 + schema 键），改为写进 5 个角色 | ✅ |
| G2 | 面板显示 DSH **官方默认值**（单一真源在角色表；"初始值 = 官方值、清空即回官方"） | ✅ |
| G3 | 官方 `--dsl-*` 组件钩子通道，作用域 = **钩子在样式表里的定义点**（不按模块名） | ✅ |
| G4 | 组件字体通道 `src/font/components.js`：4 个组件，`id`（设置键，稳定）与 `prefix`（实测模块名）分离 + 启动自探测 + 泛模块名按 `route` 限定 | ✅ |

---

## 6. 静态帧线移除后的形态

已随 P2-12 执行完毕（可达性 0 / 0）。契约与仍在生效的裁定整体归档在
[`docs/archive/REFACTOR-ASSESSMENT.md`](../archive/REFACTOR-ASSESSMENT.md) §6。

---

## 7. 升级为「立即结构性重构」的触发条件

出现任一条，§1 的结论作废，改为立刻做结构性重构：

1. **单次改动的文件数持续 ≥5** —— **该线已越过**（复算命令见 §2 表的"共变耦合"一行）⇒ 因此 P1-5（设置键单一真源）优先于任何抽取。
2. **守卫因文本判据脆弱导致假失败明显增多** —— 改为结构性/行为断言。
3. **要正式支持第二平台或第二渲染后端** —— 届时 `src/client.js` 的隐式边界会成为硬阻塞。
4. **单次会话上下文已无法容纳读懂 `apply(ctx)` 或 `WallpaperPicker`** —— 当前已处于临界。
5. **出现一次无法定位原因的生产级回归** —— 说明守卫的覆盖结构已失效，先补覆盖再谈结构。
6. **宿主某个路由族长到 ≥3 条路由**，或**一次改动要同时动 ≥3 条共享可变状态的路由** ⇒ 按族单独拆（先做 §3.5 的三条前置）。
   判定：`node test/tools/analyze-host-apply.mjs` 的第 ② 组数（它按路径首段归组并打印每族条数）。
   ✅ **已对 `diag` 族成立过**（4 条路由）⇒ P2-11 的第一刀就是这么做的。
   **判据入口（读代码的守卫）**：`test/verify-route-families.mjs` —— 某个首段族长到 ≥3 条即**变红**，
   提示回来裁决"拆族 或 改这一条线"。⚠️ **不要再把账本守卫装回来**：原先那条挂在 `verify-ledger.mjs` 上，
   已随 [ADR-0006](../adr/0006-comment-discipline-as-written-convention.md) 下线（它的代价一节记明了
   "这个监视器失效"）；恢复监视的正确做法是把判据搬进**读代码**的守卫，而不是让账本自证。
   ⚠️ 判定看的是**注册条数**，而"族"的另一种形态是**一个 `prefix` 注册下挂多个端点**（`scene-serve` 3 条注册 = 4 个端点 / `fontsets` 1 条注册 = 7 个端点）⇒ 新族**一律直接写成模块**，别先塞进 `apply` 等它"长到 3 条"。
   ⚠️ **适用范围（2026-10-30 / t20 裁决，FAMILY_TRIGGER 仍为 3）**：本条只管**尚未模块化**的路由（`apply`/行入口里内联注册的那些）。已经住进 `register<族>Routes` 族模块（`lib/routes/*.js` 或 `packages/*/lib/routes/*.js`）的路由**不计入**触发线 —— 因为本条的固定动作「抽成 `lib/routes/<族>.js`」对它们**已经完成**，没有可拆的东西；再计入是度量错位（M4 的 pet-link 三条安装路由即此情形：已在 `packages/pet-link/lib/routes/pet-install.js`，由 `verify-route-index`/`verify-inject-contracts` 单独把关）。判据实现见 `test/verify-route-families.mjs`：只对 `src` 不在 `routeModuleFiles()` 里的路由按首段归组计数，未模块化族到 3 条仍会**当场红**。
7. **出现一次跨路由状态的"隔空故障"** ⇒ 说明那批共享可变闭包状态已从"读起来长"变成"真的会坏"，此时 P2-11 升级为**立即做**（条数用 `analyze-host-apply.mjs` 现算）。
   （本线是**事件型**：出现一次才触发，机器判不了；能被机器看守的是第 6 条的"族到 ≥3 条"半边，见其判据入口。）
   ⚠️ 拆 `media` 族前先记住匹配语义（`exact` 与 `prefix` 是两张表，prefix 表**最长前缀胜出**且必须落在路径边界上）⇒ 族内与族间的相对注册顺序都不影响匹配。

### 7.1 已登记、暂不修的行为缺口

两条都**不**驱动结构性改动：登记在这里是为了让它们别从记忆里消失。真要动时按下面的现象与代价
重新裁决，判据面另开（这一节不是进度真源，只记现象）。

- **帧请求"挂住"时旧层一直留在屏上。** 切层内容闸门只在"这一层有画面"或"这一级判失败"时放行；
  请求**挂住**（既不成功也不失败）时新层一直待显影，屏上是旧壁纸。这是"宁留旧画面也不露底色"
  这条取舍的直接代价，用户侧的形态是"点了没反应、设置里显示的与屏上不是同一张"。
  ✅ **有界那一半已经落地**（视频档，2026-10-02）：预算到期从"放行"改成**停滞判据** —— 每 1200ms
  复查一次，只有屏上真有东西才放行；到 15 秒仍无画面就**继续留旧壁纸**并记一条 `video-stall` warn。
  ❌ **"超时后放行到主题色兜底"这条被明确否决**：那正是"纯色帧"那个 bug 的形态（闸门在
  `readyState=0` 时被预算放行 ⇒ 用户盯着整块底色 1–2 秒），实测读数见 CHANGELOG 未发布段第 1 条。
  所以"挂住"的代价从此是**有界的留旧**，不是露底色。
- **页面刚加载后第一张壁纸的底色窗口（`gate-none`，实测 ~150–230ms）。** 那时**没有旧层可守**，
  闸门压根没武装 ⇒ 首帧到位前屏上是层底色。真机读数：同一张 iris2（729MB）在"刚加载后的第一张"
  这条路上 `loadedmetadata` 只要 149–233ms（切换那条路当时是 1668–3340ms，已由 faststart 变体修掉）。
  **待定（用户已决定暂搁置）**：做法是给视频档一个**真静帧**当门面（复用已有的抽帧路径），
  而不是等 `<video>` 的第一帧。
- **无法回答"这个字符到底哪个已装字体能显示"（缺字检测：没做）。** 现场反馈里有"部分特殊文字显示成口"，而排查这类问题需要的是：给定一个码位，列出**本机能真正画出它**的字体族（只靠"名字在不在清单里"判不出来 —— 有的字体在 cmap 里认领了码位却只画一个方框）。**手法已经有了**（写这份诊断时用过，未落成代码）：
  ① 用 canvas 画该字符取像素指纹，与**同一字体画未分配码位**（U+10FFFE ⇒ 只能是 `.notdef` 口）的指纹比 —— 相同即"这个字体只是画了个口"；
  ② 对每个候选族名跑一遍，就能得到"哪些字体真能画它"。
  真要落成功能时的形态待定：面板里一个"检测字符"入口？还是选完字体自动提示覆盖率？
  **待定**：目前只把它当排查手段（`adr/0008` 的修复只解决了"选了没反应"那一半）。
- **裸 iframe（web 旧链）不在切层闸门的覆盖内。** 闸门认 `iframe.we-live-iframe` 的 `we-live-on`，
  裸 `iframe.we-iframe` 落到"不拦"，于是切到旧链 web 壁纸时有一小段白/空。
  **这一档可以覆盖**：iframe 元素自己的 `load` / `error` 跨域也会触发（同一份代码在
  `prepareWebProbe` 里就是这么用的），缺的只是把这两个信号接进闸门的信号表 —— 没做，不是做不到。
- **本机字体清单里 Windows / Linux 那两条权威来源没有真机验证。** macOS 那条（`system_profiler`）
  在本机实测过（含本地化族名、私有族过滤与冷/热耗时），而 Windows 的 PowerShell
  `InstalledFontCollection`、以及 Windows 注册表 / Linux `fc-list` 那两条腿**只经过合成夹具**
  （`verify-system-fonts` 的解析判据 + 注入替身）—— 真机上工具名、参数与输出形态对不对，没人验过。
  **待定**：在一台真 Windows / Linux 上跑一次 `GET /wallpaper-engine/system-fonts`，核对 `source`
  是 `powershell-fonts` / `registry` / `fc-list` 而**不是** `file-names`（落进后者说明权威那条腿没通，
  清单质量降级成"按文件名推测"）。决策与代价见 [`adr/0009`](../adr/0009-system-fonts-from-the-os.md)。

---

## 9. 并行轨道 F（**只有 §9.1 的约束仍活着**）

> §9.5 数据与文件 / §9.6 红线 / §9.7 已执行的决定已随历史半边归档 ——
> [`docs/archive/REFACTOR-ASSESSMENT.md`](../archive/REFACTOR-ASSESSMENT.md) §9。
> §9.1 留在这里：`V1–V10` 是**实现必须继续满足**的约束（此前由账本守卫的 `F0` 证据读它的首尾两行核对；**该守卫已下线**，约束本身不变，但不再有机器兜底）。
### 9.1 官方令牌层（F0 实测结论 —— **实现必须继续满足**）

官方扩展面是客户端 Cordis 服务 `theme`（入口 `ctx.get("theme")`，`overrideTokens(source, {令牌:{light,dark}})`）；
presenter 把快照写进 `body` 内联样式 ⇒ 内联胜过主题样式表 ⇒ 不需要 `!important`、不用 DOM 选择器、
不碰白闪路径；同 source 再调 = **替换**该层。**F0/F1 已关闭**，实现收口在 `src/font/`（三个纯计算文件 +
唯一碰 DOM 的 `apply.js`）；通道分工 / 扩展步骤见 [`docs/FONT-SYSTEM.md`](../FONT-SYSTEM.md)，不变量在其指向的代码文件头。

**F0 真机实测结论**（`V1–V10` 是**约束**，不是编年史）：

| # | 结论 | 对实现的影响 |
|---|---|---|
| V1 | 入口**只能是 `ctx.get("theme")`**：`ctx.theme` 裸访问抛错 | **不改 `inject`**（加进去会在服务缺失时 park 整个插件） |
| V2 | `ctx.get` 是**启动竞态**（同实例实测 3ms 可用 / 7ms 不可用） | 必须**延迟 + 轮询**；同步取一次就定论 = 真机静默失效 |
| V3 | 写入**即刻走 `body` 内联** | 免 `!important`、免 DOM 选择器、不碰白闪路径 |
| V4 | `dispose()` **干净还原**（内联摘净，计算值回落样式表） | `fontCustom` 关 = **真·回到原生** |
| V5 | 一层注册**一次**即可**随配色自动换值** | **不要**监听配色变化重注册 |
| V6 | 快照里**没有令牌表**（`active.tokens` = 0）而样式表里 `--dsw-*` / `--dsh-content-*` = **377** 条 | 令牌清单与取值的权威来源是**样式表扫描 + `getComputedStyle`** |
| V7 | body 上 23 个内联自定义属性里 **0 个 `--dsw-*`** | 「令牌走内联」此前并未发生 ⇒ 我们是**唯一**往 body 写 `--dsw-*` 的层 |
| V8 | 裸字符串**抛错**；未知令牌**不抛也不生效**；同 source 再调 = **替换** | 必须自己按 **377 条白名单**校验令牌名 —— 写错不报错，只静默无效 |
| V9 | `client-diag` 的 `detail` 两端各截断 **300 字符** | "把令牌清单写进 live 诊断日志"需另开通道或只记紧凑摘要 |
| V10 | `--dsw-alias-label-*` 共 **10** 个角色；排版类令牌 **184** 条 | 首期只做颜色是对的；F2 面对的是 184 条排版令牌 |

> 原始证据（探针代码、两套配色的 377 条取值、逐条实测表）是**本地未跟踪**的
> 本机未跟踪的取证脚本目录（不入库）与 `~/.dsh-wallpaper-engine/diag/http.jsonl`；需要时按那份记录复跑。
