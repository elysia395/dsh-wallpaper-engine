# 插件包重构手册 —— 多包拆分（主包 + 核心子插件 + 边缘子插件）

> **哈希说明（这条线被重写过两次，旧哈希多半已不在现行 `main` 上）**：本文件里的短哈希是**当时那条线上的**历史哈希。
> **现行线 = `main` @ HEAD**（复算：`git rev-parse --short HEAD`；本节写于 `ddfe63de`，2026-10-15 收口时点）：拆包那笔 squash `6385b62e`（父 = 上游 merge `a86923b7`）只是它的**祖先**，
> 其后还有追版本与多次上游 merge 若干笔 ⇒ **文中把 `6385b62e` 当"现行尖端"读的地方，一律以此行为准**
> （该哈希现在只用于指 §13.1 那次审查的对象）。本文件自身在本机工作树里可能另有未提交改动。
> 追版本第二期那一笔（108 笔压缩，父 = `c43a936`）以 tag `catchup-2nd` 标注，但**该 tag 只被
> `backup/main-pre-rebase-20261014` 包含，不是 `main` 的祖先**；`backup/pre-squash-20261014` 亦然。
> ⇒ **复核本文件的旧哈希前先切到对应备份分支**，不要在 `main` 上找。
> 复算：`git rev-parse --short HEAD` · `git log --oneline -1` · `git rev-list --count 6385b62e..HEAD` ·
> `git status --porcelain` · `git branch -a --contains catchup-2nd` ·
> `git merge-base --is-ancestor catchup-2nd HEAD`（预期非 0）。


> **本文是这条重构线的唯一执行口径**：目标架构、机制约束、包边界、通讯纪律、阶段计划、判据改造、发布流程。
> **决策正本** = [`adr/0013`](../adr/0013-bundle-multi-component-rows.md)（目标与判据、开关语义、明确不做的事）；
> 本文**只写"怎么做"**，与 ADR 重复的目标陈述一律改成指针。
> **写作纪律**（[`docs/README.md`](../README.md) §写作纪律）：不抄会漂的数值；证据锚点用**符号名 / 文件路径 / 复算命令**；
> 行号必漂，一律不写。**状态**：进行中（住 `docs/wip/`，收口与归档见 §7.5 的 P-E）。

**基线**：现行 `main` 相对 `origin/main` **behind 0**（复算：`git rev-list --left-right --count origin/main...HEAD`）。
**拆包起点** = **单包 + 4 个插件行**（`dsh-plugin-wallpaper-engine`，即 `cordis.patch.yml` 的那四条 `insert`）；
**现行形态**（2026-10-16：P-A 三子包 + P-F 三组件包出户）= **主包 + 6 个子包** = 3 个独立子包 `packages/{fx,parallax,fonts}` + 3 个已出户的组件包 `packages/{about-notice,mascot-avatar,media-bridge}`（复算：`git ls-files 'packages/*/package.json'`）⇒ patch 共**七条** `insert`
（1 条主行 + 3 条组件包行 + 3 条子包行；见 §7.1 的实况块与 §7.8）。
**目标形态** = **主包 + N 个子插件包**（版本一致、一次安装落地、代码各自成包、第三方代码除外）。

---

## 1. 目标架构

### 1.1 蓝图（用户口径，2026-10-14 重述）

| 包 | 职责 | 备注 |
|---|---|---|
| **主包** `dsh-plugin-wallpaper-engine` | 设置面板、配置文件、WE 壁纸获取、多平台识别与差异处理、**留给其它插件的钩子**、以及"大部分组件都依赖的基础模块" | 唯一被"一次安装"的名字 |
| **壁纸子插件** | WE 壁纸与自定义导入壁纸的**渲染**；壁纸库 + 播放-画面里的配置项、声音、省电 | 以现在的 `packages/media-bridge`（P-F 批 1c 出户，原 `lib/components/media-bridge`）为基础，**大改** |
| **UI 子插件** | 玻璃面板、侧边栏圆角等**前端 UI**；外观里的配置项 | **字体除外** |
| **字体系统子插件** | 字体集 / 排版 / 应用 | 已可自成一系；**目标形态 = 整个「字体自定义」配置类**（宿主半边 + 浏览器半边 + 外观页签字体节 + 字体键所有权），**定案 A**（2026-10-15，§7.8） |
| **点击与拖尾效果子插件** | `src/fx-layer.js` 一族 | 天然低耦合 |
| **3D 效果子插件** | `src/parallax-layer.js` 一族 | 天然低耦合 |

**目标档位**（谁定目标、谁定做法：ADR-0013 的正文章节与本文附录里每行决策的 `D*` 都按名字引用 —— 章节号会随文档重排而漂）：

| 档位 | 约束力 | 住所 | 例外条款 |
|---|---|---|---|
| **目标**（"做成什么样"） | 验收判据引它 | ADR-0013 §A 的 `D1`–`D5`；共享内置包的启停语义住 `D3`（路由整族不注册 + 可见面不渲染 + 失效口径） | 现行正文只有 `D3` 为**界面级开关**开了例外（`D3④` 把它严格限定在可见面） |
| **做法**（"怎么拆"） | 本文与 §14／附录 G 管 | 本文 §2–§12、§14 的 `D-*`、附录 G 的 `J1`–`J7` | 本轮细化的两条（开关档位 / 重启边界）都是**做法**档，不动 `D1`–`D5` |
| **非目标**（"明确不做"） | 不再反复讨论 | ADR-0013 §D 的 `D16`–`D19` | 改它要新 ADR（ADR-0013 §A `D5` 的后半句） |

> ⚠️ **两个编号系统不要混**：现行 ADR-0013 的决策是 `D1`–`D19`；本文 §14 的待决策是 `D-1`–`D-19`（`D-*` 为本文编号，与 ADR-0013 的 `D*` 不同体系；当前未结项见 §14 表头）；附录 G 的入选判据是 `J1`–`J7`；代码注释与测试里反复出现的 `P0` / `P1` / `P2-7` / `P2-8` / `P2-11` 是**上一轮那个编号体系**的完成记录（见附录 E 与 `CHANGELOG.md` / git 历史），**不是**本文的阶段名（本文的阶段是 `P-A`…`P-E`）。两者编号体系不同，别互相换算。
>
> **旧锚点 → 现落点**（只留仍然会被读到的；表中三处**已完成**、其判据各自在跑，所以"现落点"是判据文件而不是本文的待办节）：

| 旧编号（上一轮） | 现落点 |
|---|---|
| `P2-7` 契约收紧 | **已完成** ⇒ ADR-0013 的 `D12`（① 注入面收窄 / ② 路由族声明键集双向对账 / ③ 内部面不得直接解构），判据 `test/verify-inject-contracts.mjs` + `test/verify-component-face.mjs` |
| `P2-8` 实现归属入包 | **已完成** ⇒ ADR-0013 的 `D14`，判据 `test/verify-route-ownership.mjs` |
| `P2-11` 行级开关的界面语义（`D3` 落地） | **已完成** ⇒ 本文 §7.0 起步态；判据 `test/verify-component-visibility.mjs`（可见面声明 ↔ 实现双向对账） |

**两条必须写进目标的档位边界**（不写清就会被读成"这轮能热更代码"，而机制上做不到）：

1. **"不用重启"只承诺到"能力开关"这一档** —— 目标形态下每一行都必须能被**单独停用／恢复**，且**同一进程内生效**：宿主半边卸下（路由整族撤掉）、浏览器半边不渲染（`D3①`）。这是**验收条件**，由 `dsh-plugin-manager` 的开关 + `dsh-hmr` 的树重组提供，机制事实见 §4.2（`R3` / `R4`）与 §4.3（`U1`–`U6`）。
2. **"版本／代码变更"不在此列，必须重启** —— 改 `lib/**` / `src/**` 的**源码**、换 `webwallgl` 之类的依赖版本、改 `dsh.client` 清单、加／减行：全部要重启进程才生效（`U3` 模块缓存不清、`R3` HMR 只监听配置、§12 纪律 3 的升级流程）。**这一档不是"没做"，是机制上不成立** —— 见新增的 §11（用户可见的边界表），以及本轮细化的原因：把它当同一件事，就会在"开关能开、但代码还是旧的"时误判成修复无效。

**贯穿性约束**：
1. **实现代码搬进各自插件**（不是"目录搬、实现留主包"）；
2. **第三方代码除外** —— 引擎**已经是 npm 依赖**（`package.json` 的 `dependencies` 里有 `webwallgl`），
   仓库内 `lib/webwallgl/**` 只剩自家模板/宿主桥文件（复算：`git ls-files lib/webwallgl`）：
   **"不搬"= 不随子包走**，由主包持有依赖，并以 `WEBWALLGL_PKG_DIR` / `WEBWALLGL_DIR` 作注入键交给需要它的包
   （见 §9.4 的两种做法与取舍）；
3. **所有子包版本一致**（不追求独立发布）—— 这条把"发布面 ×N"的成本消掉（见 §4.1）；
4. **组件之间明确的通讯纪律**（见 §6）。

### 1.2 与现行 ADR 的关系

- 现行形态（单包多行）与 D3（关掉一行 ⇒ 路由不注册 ＋ 界面不渲染）**已经落地**，是本手册的**起点**；
- **本轮细化的两条（开关档位 / 重启边界）不改任何 `D*`**：它们只是把 `D3` 的**运行期实现**与"代码变更不在开关语义内"这两件事写成可判据、可验收的形态，见 §1.1 的两条档位边界与新增的 §11；
- 目标形态（多包）需要**修订 [`adr/0013`](../adr/0013-bundle-multi-component-rows.md) 的 D6 / D8 / D17**
  （"终态取单包多行" / "不做多包 monorepo" / "每组件一格客户端开关"三条的**前提**）。
  **2026-10-14 用户拍板：就地改写 ADR-0013 的 D6 与 D8 正文、D17 只改理由**（不新开 ADR）。修订理由**只有一条**：
  **降复杂度与解耦**（用户口径：独立发布不必要；版本一致更方便管理）。**"关掉即不下载"仍是非目标（D16）**，
  **每组件一格客户端开关仍不做**（理由改为"子包粒度 ≠ 组件行粒度"，见 ADR-0013 D17）。
- **子包契约另有正本**：`packages/<pkg>/` 的包面 / 行与接线 / 依赖方向 / 生命周期 / 开关与重启 / 发布形态的
  **规范条款**见 [`adr/0014`](../adr/0014-subpackage-contract.md)（S1–S10，**normative**）；每个包 × 每个登记点的
  现状矩阵见 [`docs/SUBPACKAGE-GRAPH.md`](../SUBPACKAGE-GRAPH.md)（**人工维护快照**，无判据）。
  与本文重复的规则一律**以 ADR-0014 为准**（本文只写"怎么做"）；它的边界 = **不设**任何针对 markdown 的机器判据（ADR-0007）。

---

## 2. 核心概念（先立起来，后面全依赖它们）

### 2.1 包边界 = 卸载边界（Cordis 原生，不是我们发明的）

Cordis 的级联只有**一个判据**：`name in fiber.inject`（`cordis/src/reflect.ts` 的 `notify()` → `_refresh()`）。
提供方消失时：消费者 `ACTIVE` → `_unload()` → `PENDING`（**park，不抛错**）；提供方的 disposer 会
**await 所有消费者卸完**才返回。恢复时 epoch 变化 ⇒ 消费者**重跑一遍 `apply`**。

**推论（写进纪律，不靠人记）**：
- 跨包依赖**必须**走 Cordis 服务（`ctx.provide` / `export const inject`）；
- **禁止**：`ctx.get(name, false)` 惰性取值后缓存、直接 `import` 另一个包的模块级导出、模块级共享单例
  —— 这三条在停用时**静默半挂**，没有任何告警（见 §5.2 的失败形态表）。

### 2.2 四个半边 + 一笔"可卸载性"账（每个子包都要自己回答"我占哪几个"）

| 半边 | 是什么 | 缺了会怎样 |
|---|---|---|
| **宿主实现** `lib/index.js` | 一个可调用的 `apply`（哪怕空） | **不可省**：Loader 行的目标必须是函数或 `{apply}`，否则装载期报错 |
| **宿主行** `cordis.patch.yml` 里的一行 | 让宿主知道"有这么一个插件" | 整包不存在（行级失败是**只打印、不中断启动**，见 §5.1） |
| **浏览器半边** `exports["./client"]` + `dsh.client` | 界面/样式/槽贡献 | **可选**（in-box 多数包没有 `dsh.client`，占比复算见附录 D）；缺了不影响宿主半边 |
| **行元数据** `exports` 三连 + `locale/` + `icon` | 插件管理器里的标题/描述/图标 | **静默降级**：显示裸 specifier |
| **可卸载性**（不是"半边"而是**每条半边都要交的账**） | 宿主半边把副作用注册进 `ctx.effect`、浏览器半边同样；定时器 / `window` / DOM / 原生句柄一个不留 | 症状**不是**报错，而是"关掉之后还在跑"：`U3`（模块缓存不清 ⇒ 模块顶层副作用不随停用消失）、`U8`（卸载彻底性 = 你注册了多少）、`U6`（客户端会回收 fiber 与 `style[data-plugin=<id>]`） |

**官方对"纯浏览器包"的写法**：**空宿主壳**。in-box 的 `dsh-client-ui-layout/lib/index.js` 全文
只有 `function apply() {}` 与一行注释 —— 这是被认可的形态，不是取巧。

**⚠️ 最容易漏的一条**：浏览器半边**只能由"活动的 Loader 行"发现**（`dsh-client-modules` 的
`processOne` 只遍历 `ctx.loader.entries()`，且要求 `entry.fiber && !entry.disabled`）。
⇒ **子包行必须被某个已选中的 bundle 的 patch 插入**；只把它写进 npm 依赖**不会**让它出现在浏览器里，
而且**没有任何判据会告诉你**。§7.6 的启动自检就是为这条设的。

### 2.3 "一次安装" = 主包的 patch 引用子包（唯一三通道都支持的语义）

| 语义 | 形态 | Web 一键装 | Agent 工具 | CLI |
|---|---|---|---|---|
| **A（采纳）** | 主包 `dependencies` 精确依赖子包；**主包自己的 patch** 用 `name: '<子包名>'` 插入子包行 | ✅ | ✅ | ✅ |
| B | 每个子包各是独立 bundle（各自 `dsh.bundle.patch`、各自进 `dsh.profile.bundles`） | ❌ `ambiguous-install` | ❌ 同左 | ✅ `dsh plugin add a b c` |

**为什么 A 三通道都行**：`installBundle` 只把**主包**写进 profile 的 `dependencies`；子包作为**传递依赖**
被 pnpm hoist 到 `profile/node_modules` 顶层，`resolveBundleDir` 用 `require.resolve.paths` 就能命中
（本机实证：`js-yaml` / `undici` / `zod` 都在顶层）。宿主还会**连带校验** patch 指向的每个包的
`peerDependencies`（`dsh-plugin-manager` 的 `bundleComponent*` 一族；`dsh-app-boot` 侧另有一道读取期兼容性校验）
—— 任一不匹配 ⇒ 整次安装被拒并回滚（含 `node_modules` 修复）。

**B 为什么不行**：`installBundle` 硬性要求"这次 `pnpm add` 恰好让 1 个包从无到有"（`installed.length === 1`），
多一个就 `ambiguous-install` 拒绝。⇒ **不采纳 B**。

### 2.4 开关的粒度与"开关动了什么"（三条机制事实，细化目标时以此为准）

| # | 事实 | 对目标的约束 |
|---|---|---|
| **粒度** | 开关的**作用对象是行**，写的是 profile 的 `cordis.patch.yml` 覆盖项（`R1`）；客户端 graph row 却是**包级**的，且子路径行不参与客户端扫描（`C1`） | 一行能开关 ≠ 一个功能能独立开关：**功能要独立开关，它所在的包必须自带浏览器半边**（`C2` 的静默 return null + §2.2 的"缺一半边"表）。把某族搬进子包时，**搬 UI 还是只搬宿主半边**，是一个必须表态的取舍（§5.3 / §6.1） |
| **作用域** | 停用一行 = 该行 fiber dispose；`entries()` 仍列它（`U1`）；**模块缓存不清**（`U3`） | "关掉再打开"重跑的是**同一份已加载模块**的 `apply`，不是重新读盘 ⇒ 目标里的"开关"只能承诺能力，不能承诺代码（§1.1 的第 2 条边界） |
| **可逆性** | 客户端走 `sync(graph)`：`loader.remove` → 等 `fiber.inertia` → prune 模块与样式（`U6`）；宿主侧跨包依赖是 park + 等消费者卸完（§2.1） | 每包都必须**自己**交拆除函数；**不得**在模块级起定时器 / 挂 `window`（`U3` / `U8`，风险表第 11 条）—— 否则"开关"会变成"泄漏" |

---

## 3. 行标识与兼容性（决策：零迁移代价）

**现状（必须原样保留）**：

| 行 id | 行 `name`（现为子路径 specifier） |
|---|---|
| `wallpaper-engine` | `dsh-plugin-wallpaper-engine` |
| `wallpaper-engine-about-notice` | `dsh-plugin-wallpaper-engine/about-notice` |
| `wallpaper-engine-mascot-avatar` | `dsh-plugin-wallpaper-engine/mascot-avatar` |
| `wallpaper-engine-media-bridge` | `dsh-plugin-wallpaper-engine/media-bridge` |

**开关机制的两条硬事实**（决定兼容策略）：
1. 开关写入 = `writePluginEnabled(filename, id, name, enabled)`：在 profile 的 `cordis.patch.yml` 里找
   **最后一条** `id` 相同、**且 `name` 相符**的非 `insert` 覆盖项，只改它的 `disabled`；找不到就追加一条。
   ⇒ **`id` 与 `name` 任一变了，老用户的开关记忆就丢**（覆盖项变成 warn-then-skip 的孤儿）。
2. 行自身带 `insert` 键的条目**不可通过 UI 开关**（`item.has('insert')` 直接跳过）—— 这是 `- insert:` 这个
   **YAML 语法**与"行上有个 `insert` 字段"的区别；我们插进 `- insert:` 列表里的行**没有** `insert` 键，
   **可以开关**（真机实证：profile patch 里的行开关覆盖项形如 `- id: <行 id>` + `disabled: false`；
   本机 desktop profile 里就有 `wallpaper-engine` 那一条 —— 见附录 D 的复算命令）。

**范围勘误（2026-10-16，实测 —— 不改上面两条硬事实，只缩它们的适用范围）**：上面两条只对**已发布过的行**成立。
已发布面**只有主行一行**：`npm view dsh-plugin-wallpaper-engine time --json`（`1.3.3` = `2026-10-15T09:27:18Z`）
＋ `npm pack dsh-plugin-wallpaper-engine@1.3.3` 解包后 `cordis.patch.yml` 里只有 `- id: wallpaper-engine`、
包内**没有** `lib/components/`；三个组件真名在 registry **全 E404**（复算见 §15.7）。
⇒ **三条组件行从未出现在任何发行物里 ⇒ 不存在"曾关过该组件"的用户**（用户口径，2026-10-16）
⇒ 本节"保留 `id` 与 `name`"**对它们不适用**：§15 的搬迁可以把行 `name` 直接改成**真实包名**
（`id` 仍按本节末尾"先把 id 定死"保持不变），**零迁移代价**成立。上面那张表里三行组件行的"现状（必须原样保留）"随之作废。

**✅ 已作废（2026-10-16）**：组件行**从未发布** ⇒ 无老用户 ⇒ 无兼容负担，本节上面那条"保留 `id` 与 `name`"对它们不再适用（§15.1 / §15.2 / §14 D-15）。
三行 `name` 已直接改为真名 `dsh-plugin-wallpaper-engine-<sub>`，`id` 冻结不变（见本节末尾"先把 `id` 定死"）；主包 `exports` 的 `./<c>` 子路径三连已随 P-F 出户删除，该兼容通路不再存在。
（原文的"老用户零迁移"论证与"新行才用真实包名不采纳"一句随之作废，别再按它推演。）

**新增子包**（字体 / 点击效果 / 3D / UI / 壁纸）用**真实包名**做行 `name`，且**先把 `id` 定死**（一旦发布不许改 id）。

---

## 4. 机制约束清单（**已逐条取证；实施时以此为准**）

取证方式：解析 `app.asar`（`headerSize = uint32LE@12`，`base = 16 + headerSize`）+ 阅读
`@deepseek-ai/{dsh-plugin-manager,dsh-app-boot,dsh-client-modules,dsh-client-hmr,cordis}` 的产物与 README。
抽取件与复算脚本见 §附录 D。

### 4.1 安装 / 分发

| # | 事实 | 对我们的约束 |
|---|---|---|
| I1 | Web / Agent 工具的安装面是**单 spec**；`installBundle` 要求"恰好 1 个新直接依赖" | 子包**不得**各自成为被单独安装的 bundle（语义 A） |
| I2 | CLI `dsh plugin add a b c` 是 `pnpm` 直通 + `reconcile()`：一次命令可落地 N 个并全部选入 bundles | 发布/升级流程的**唯一**多包通道；Web 装不了多包 |
| I3 | `bundledDependencies`、`workspace:`、真实 monorepo **都不被支持**（全 asar 零命中 / 显式拒绝） | 子包必须是**普通 npm 包**；主包用精确版本依赖它们 |
| I4 | patch 行 `name` 支持：裸包名 / 子路径 / `./`·`../`（相对 patch 文件）/ 绝对路径 / `file://` | 主包 patch 用**裸包名或子路径**引用子包即可 |
| I5 | 行级失败（包解析不到、`ERR_MODULE_NOT_FOUND`）**只影响那一行**，不中断启动、不报安装错 | 必须自己加**启动自检**（§7.6） |
| I6 | 宿主会连带校验 patch 指向的每个包的 `@deepseek-ai/dsh-*` peer；任一不合 ⇒ **整次安装被拒 + 回滚** | 子包的 peer range 必须与主包**逐字对齐** |
| I7 | 宿主无 `overrides` / `resolutions`，也不校验"包组版本一致" | 版本一致靠**我们的发布纪律**（精确版本 + 只在主包 `dependencies` 里出现） |
| I8 | 没有 `update_bundle`；更新已选 bundle 返回 `restart-required`；卸载**允许**部分变更 | 升级 = 卸载 + 重装 + **重启**；写进用户文档 |
| I9 | 服务路径 N 包 = N 次独立操作（无跨包事务）；CLI 单命令在 manifest/lockfile 层近似原子 | 升级走 CLI 单命令 |

### 4.2 行开关与热更新

| # | 事实 | 对我们的约束 |
|---|---|---|
| R1 | 开关只改 profile `cordis.patch.yml` 的覆盖项，**保留注释**、只改最后一条 `id`+`name` 匹配项 | 见 §3（保留 id 与 name） |
| R2 | 行不写 `disabled` ⇒ **默认开**；要"默认关"必须在 bundle 自己的 patch 里写 `disabled: true` | 新子包的默认值在这里定 |
| R3 | `hanging`: HMR 缺席时 `reload()` 直接返回 `[]`，结果记 `restart-required`；`dsh-hmr` 监听 profile 的 `package.json` + 两份 patch（**不含 bundle 自己的 patch**） | **改行后要重启/重载才生效**（现行 README 已写）；改 bundle 自己的 patch 需要重装 |
| R4 | profile manifest 的 `dsh.profile.patchReload`（本机 = `"live"`）控制行开关能否热生效 | 文档里要与 R3 一起讲清 |

### 4.3 卸载 / 停用语义

| # | 事实 | 对我们的约束 |
|---|---|---|
| U1 | 停用一行 ⇒ `Entry.disabled = true` ⇒ fiber dispose；`entries()` **仍列出**它（`entry.fiber` 已废） | 读 `entries()` 的代码要自己过滤 `disabled` |
| U2 | dispose 顺序 = **LIFO 启动、并发完成**（`Promise.all`），单个 disposer 异常**被吞**（只记日志） | 清理要有序时，别指望 dispose 顺序 |
| U3 | **模块缓存不清**（ESM `loadCache` / `require.cache`）：只有 HMR 的替换路径清 | **模块顶层副作用不随停用消失** —— 别在模块级起定时器/挂 window |
| U4 | 级联的唯一判据是 `inject` 声明面；`ctx.get(name,false)` 缓存的消费者**不被级联** | §2.1 的纪律 |
| U5 | 停用"被依赖的行"时：运行期是**安全 park + 提供方等消费者卸完**；但 `reconcileProfilePatches` 会把"新出现的 inactive 行"当失败**抛错**，插件管理器记 `application: 'failed'`，且**不回滚 YAML** | 关主包会**大声失败**（对"整族一起下去"是好事）；要用"停用主包"当正常操作时需重新评估 |
| U6 | 客户端侧启停走 `ClientEntries.sync(graph)`：`loader.remove` → 等 `fiber.inertia` → `prune` 模块与样式（`style[data-plugin=<id>]`） | 浏览器半边**可逆**、样式会回收 |
| U7 | 客户端侧代码替换走 `reload()`：**无回滚**；换 bootstrap 包被硬拒（`requires a page reload`）；**纯 JS import 的消费者不会跟着换** | 跨包协作只走 Cordis 服务（in-box 构建期 purity gate 就禁止跨插件 value import） |
| U8 | 卸载彻底性 = 你把副作用注册进 `ctx.effect` 的程度；window / DOM / 定时器 / 原生句柄**不在回收面** | 每个包都必须交拆除函数（本仓已有 `handOffTeardown`） |

### 4.4 客户端（浏览器半边）

| # | 事实 | 对我们的约束 |
|---|---|---|
| C1 | 一个包 = 一个客户端 graph row（`exactPackageSpecifier` → `nearestPackage` → `table.set(包名, …)`）；子路径行不参与扫描 | 子包要浏览器半边 ⇒ **自己是一个包**（不能靠主包的子路径） |
| C2 | 缺 `dsh.client` ⇒ **静默 return null**（连否定结论都被缓存）；声明了却缺 `exports["./client"]` ⇒ **抛错** | 四个半边缺一不可（§2.2） |
| C3 | 跨包模块只能 `require`：`seed 静态表 → loadCache → factories → throw`；静态表由外壳注入且**不可扩展** | 共享长命对象**没有**干净通道；`external` 是窄口逃生舱 |
| C4 | `external` 只做"排到消费者之前"；provider 缺席时**到达阶段静默跳过**，真用到才抛；in-box 71 个客户端包只有 5 个用它 | 默认用 `dsh.client.inject` 排顺序；`external` 要有明确理由 |
| C5 | `inject`（客户端）只影响到达顺序，缺席**完全静默** | 不能用它表达"必须有" |
| C6 | React / react-dom / cordis / slots / primitives / client-store 在静态表里共享（双 React 问题不存在） | 子包不要内联自己的 React |

### 4.5 设置与配置（现存单一真源的约束，不变）

| # | 事实 | 对我们的约束 |
|---|---|---|
| S1 | `lib/settings-schema.js` 是**宿主 import + 构建期内联**的**唯一共享内核**（`verify-module-layout` 的白名单只许一项） | 多客户端半边要么各内联一份（产物 ×N + 漂移），要么宿主下发，要么子包不碰 schema |
| S2 | `settingsVersion` 是**全局单计数器**，`migrateSettings` 在 `sanitizeFromSchema` 入口（幂等靠版本短路） | **迁移只能由持有 schema 的那一侧跑**；子包各带 schema ⇒ 版本号在包间来回摆动 + 对已换算值反复换算（数据损坏级） |
| S3 | `sanitizeFromSchema` 是**白名单**：不认识的键**静默丢弃** | 子包不认识别的包的键 ⇒ 一次写入抹掉别人的键（ADR-0002 记录的原始 bug 型） |
| S4 | 7 个设置簇（`core` / `appearance` / `mascot` / `fx` / `parallax` / `typeColor` / `media`）**不是按插件边界画的** | 见 §6.3 的三选一 |
| S5 | `config.json` 有 4 个根字段（`settings` / `fontSetId` / `uploadDir` / `cacheDir`），写串行化 = `enqueueConfigWrite` 的**模块级队列** | 队列必须**进程唯一**（§5.1 的共享内核问题） |
| S6 | `PROFILE_PRESET_KEYS` 横跨**全部设置簇**；预设资产段横跨字体 / 立绘 / 头像三族 | 预设是最硬的跨包面，见 §6.4 |

---

## 5. 三个必须先解决的架构问题

### 5.1 共享可变资源的"单例语义"（**正确性前提，不是偏好**）

以下三样**不是"能力"，是"进程内唯一实例"**，各包各带一份就错：

| 资源 | 现在住在哪 | 各带一份的后果 |
|---|---|---|
| 配置写队列 `configWriteQueue` / `atomicTmpSeq` | `lib/kernel/config.js`（工厂内 `let`） | 并发写同一份 `config.json`，读-改-写窗口重开 |
| 内核租约 `KERNEL_LEASES` + `transcodeKit.dispose()` | `lib/kernel/host-kernel.js`（模块级 `WeakMap`） | 要么**提前 dispose**（打断在途 ffmpeg），要么**永不 dispose**（子进程泄漏） |
| 媒体源 loopback（`createMediaOrigin`） | `createHostSession` 每次 apply 一份 | 多个 port，`/inventory` 报哪个不确定 |

**三条出路（必须选一条，且写进 ADR）**：
- **① 主包以 Service 形式提供**（`export default class extends Service`）：官方三种导出形态之一，宿主侧**全仓零先例**；
  代价 = 主包行从"纯插件"变成 provider，`verify-component-face` 的冻结契约（内核分级面的复算口径
  `KERNEL_STABLE_FACE` —— 该判据已改成**读真源现算**，不再写死数字）必须同步重算。
- **② 子包 `import` 主包的叶子模块**：形状最简单、今天就能做；代价 = 把内核内部面公开进 `files`，
  且撞 `verify-module-layout` 的"共享内核白名单只许一项"。
- **③ 把内核下沉成独立小包**（`dsh-plugin-we-core`）：边界最干净；代价 = 多一个发布面 + 新包名要进各守卫的顶层目录地板。

> **决策（2026-10-15，用户拍板 —— 取代 §14 的 D-4 与 D-8）**：**走 ①（主包以 Cordis Service 提供共享面）**。
> 为什么改：② 的叶子 import 是**模块图上的边** —— 关掉主包后子包仍握着**旧代 exports**（§5.2 反模式表第 2 行），
> 而 `inject` 是 Cordis **唯一**有级联语义的判据（`name in fiber.inject`）⇒ 只有 ① 能让 D-13 的 B
> 「关主包 = 关整族」有物理基础；② 的另一半代价（把内核内部面公开进 `files`、撞 `verify-module-layout` 的
> "共享内核白名单只许一项"）也随之消失。
> **落地形态**：服务名 `wallpaperEngineHost`（真源 = `lib/subpackage-boot.js` 的 `HOST_SERVICE_NAME`），
> 值 = `createSubpackageHost()` 的**冻结键面** `{ ids, keyNames, keys, handOff, schema, http }`（六键；P-F 起 `http` 内为 3 键）；
> **P-F 追加（2026-10-16，组件行统一）**：键表的取值分派由**四型**扩到**七型**
> （`const:` / `kernel:` / `schema:` / `http:` / `boot:` / `session:` / `data:`），并首次登记一个**组件行** id
> （`'about-notice'`，9 键；`http` 视图同时扩到 3 键 —— 多 `CONTROL_JSON_MAX_BYTES`，只有 media-bridge 需要）。
> 三型新源专为组件行而设：出户组件拿不到 `hostKernel`（ADR-0013 **D12** 不许直接解构内核内部面），
> 改为注入 `repoSlugFromPkg` / `runComponent` / `handOffTeardown`（`boot:`）、
> **已绑定 `hostKernel`** 的 `componentViewFrom` / `createComponentSession`（`session:`）、
> `pluginDataDir` / `configPath`（`data:`）—— 后两个**不在** `KERNEL_STABLE_FACE` 上，故不能走 `kernel:` 源。
> 主包 `apply()` 的**第一件事**是 `provideSubpackageHost(ctx)`（真宿主走 `ctx.provide` ⇒ 服务记在**主包自己的 fiber** 上）；
> 子包宿主半边 `export const inject = ['wallpaperEngineHost']` 且**零主包说明符**
> （`test/verify-subpackage-purity.mjs` 的 `ROOT_SPEC_ALLOW` 已收紧为零）。
> ① 的代价照付：`verify-component-face` 的分级面复算口径（§10.1 #4）已同步。

### 5.2 跨包通讯纪律（**写进判据，不靠人记**）

**允许**：
1. Cordis 服务（`ctx.provide` / `inject`）—— 唯一有级联语义的通道；
2. 宿主注入的**显式键集**（今天 `COMPONENT_VIEW_KEYS` / 路由族 `export const DEPS` 的形态）；
3. **纯数据**的跨包读（`/inventory` 的 `components` 面、`COMPONENT_VISIBILITY` 这类声明面）。

**禁止**（每条都有对应的失效形态）：
| 反模式 | 失效形态 |
|---|---|
| `ctx.get(name, false)` 后把值存进闭包 | 提供方停用 ⇒ **不级联**，子包拿旧引用继续跑 |
| 直接 `import` 另一个包的模块级导出 | 同上；且 HMR 后是**旧代 exports** |
| 模块级共享单例（跨包） | 停用不清（U3），且各包各一份（§5.1） |
| 跨包 `require` 长命对象 | 客户端 HMR 代际：消费者不跟着换（U7） |

### 5.3 客户端半边：拆到哪一层

**必须带客户端半边**：UI 子插件（玻璃/圆角）、字体子插件、点击拖尾效果、3D 效果（它们的实现在 `src/**`）。
**字体包今天不满足这条**（只交付宿主半边）：P-A 的裁决见 §7.1 实况块，目标形态与收口线见 §7.8（定案 A）。
**可以只有宿主半边**：以宿主路由/进程为主的功能（例如媒体桥的后端）。
**"纯浏览器包"用空宿主壳**（§2.2）。

**跨包共享的浏览器侧依赖**（今天 `selection` / `emit` / `i18n` / 共享零件表）**没有干净通道**：
- 走服务（要定义服务面与生命周期）；
- 或"值 + 回调"（子包只是渲染器，写权留主包）；
- **不要**用 `external` + `require` 传长命对象。

> **决策（2026-10-15，取代 §14 D-8）**：P-A 的三个子包走**Cordis Service**（§5.1 ①，即本节的允许清单第 1 条）——
> 主包 `ctx.provide('wallpaperEngineHost', …)`，子包 `inject` 后从 `ctx.wallpaperEngineHost` **只读**取用；
> 仍不做长命对象跨包 `require`。允许清单第 2 条的"宿主注入显式键集"降级为**包内**形态
> （组件门面 `c` 契约仍是它），**不再承担跨包通道**。

---

## 6. 需要产品/架构拍板的问题（**2026-10-16 复核：§6.1 / §6.2 / §6.3 / §6.5 均已定案；只剩 §6.4 按阶段前置**）

| 问题 | 状态 | 决策 / 期限 |
|---|---|---|
| §6.1 配置项归属（代码 / 状态） | **已定案（2026-10-16，用户口径）：A 代码归属** | **键与状态全部留主包唯一内核**（`lib/settings-schema.js` 不动）；随包走的是**渲染器 / 描述符**。读法与"面板结构 ⇄ 包结构解耦"原则见下方表态块；**代码注释里必须明文重述**（用户要求）。字体收口的层 2 就是它的第一个实例（§7.8） |
| §6.2 客户端半边怎么协作（服务面形状） | **已定案（2026-10-15，取代 10-14 口径）** | 跨包通道走 **Cordis Service**（§5.1 ①）：主包 `provide('wallpaperEngineHost', …)`、子包 `inject` 后只读取用；不做长命对象跨包 `require`；**包内**的组件门面仍走宿主注入显式键集（§5.2 允许清单第 2 条）。"provider 缺席"的期望 = 子包 fiber 因 `inject` **级联而 park**（D-13 B），不再是"注入键缺席" |
| §6.3 设置簇要不要按插件重画 | **已定案（2026-10-16，用户口径）：暂定维持现设置簇** | 分区表与对账口径**不动**（零存档迁移）；要守的原则是**配置面板结构与包结构解耦** —— 面板的簇 / 节按信息架构定，**不按包边界推导**。取 §6.1 A 后，"不重画"不再与单写者不变量冲突（写者仍只有主包内核）。首个真实客户仍是外观页签的字体节（§7.8 层 1） |
| §6.4 预设怎么跨包 | **阶段前置** | **P-D 之前必须表态**（与 §7.4 同批） |

### 6.1 "配置项归子插件" = 代码归属还是**状态归属**？

| 选项 | 形态 | 代价 |
|---|---|---|
| **A 代码归属** | 子包提供渲染器/描述符；`selection` / `setSetting` / `emit` / 持久化全留主包 | 最小改动；但"实现代码搬进插件"只剩目录归属 |
| **B 各注册 `settings.section`** | 每个子包 `ctx.slots.inject("settings.section", …)` | 零跨包依赖；但设置页会多出 N 行导航，主面板的页签胶囊/玻璃壳用不上 |
| **C 状态也分家** | 各包自持 store / 持久化 / 设置段 | 最贴蓝图；要拆 `selection`、`persistSelection`、`quick-panel` 与设置页共用的渲染器，并重写多条守卫 |

> **2026-10-16 表态（用户口径）：走 A 代码归属。** 为避免后面各按各的理解动手，这里把读法钉死：
> ① **真源与状态留主包**：`lib/settings-schema.js` 的键面 / 消毒 / `selection` / `setSetting` / `emit` /
>    持久化**全部不动**，键名与簇名一个都不改（⇒ **零存档迁移**）；
> ② **随包走的是"画这一节"的代码**：该配置类的**渲染器与描述符**落到 `packages/<pkg>/src/**`，
>    由包自己的浏览器半边出产物（§7.2 的包内配方 + §7.8 层 1）；
> ③ **子包不持有键、不另行持久化、不注册自己的 `settings.section`** —— 选项 B 仍不做；
> ④ **代码注释必须明文重述本条**（用户要求）：`lib/settings-schema.js` 的字体块头、`packages/fonts/**`
>    的入口、以及随包搬走的**每一个**渲染模块，都要写明"配置项真源与状态在主包（§6.1 = A 代码归属），
>    本包只提供渲染器 / 描述符"，防止下一个读代码的人按"包结构 = 面板结构"去理解；
> ⑤ **与 §6.3 的关系**：面板结构与包结构**解耦** —— 搬代码不搬分区。

### 6.2 客户端半边怎么协作（服务面形状）

若选 C，必须定服务名与形状（`weSettings` / `weKit` / …）、生命周期、以及**provider 缺席时的期望**
（park 是默认；`external` 会抛）。**这一条决定后面所有接缝的形态。**

### 6.3 设置簇要不要按插件重画？

- **重画**（`core.library` / `core.playback` / `appearance.glass` / `appearance.ui`…）：分区的命名空间表与
  `SETTINGS_NAMESPACE_NAMES` 要按新簇重排，分区对账的**口径**（键集逐键相等）随之重述，
  老客户端与老存档要语义映射；⚠️ 该判据里的键数**已经是现算**（从 `sanitizeFromSchema` 派生，
  复算：`node test/verify-settings-namespaces.mjs`）⇒ 重画要改的是**分区表与口径**，不是硬编码计数；
- **不重画**（两个包共用一个簇）：原写"单写者（M4=0）不变量立刻破功"—— 那句的前提是**状态也分家**（§6.1 的 C）。

> **2026-10-16 表态（用户口径）：暂定维持现设置簇。** 取 **A 代码归属**后，键与写者都还在主包内核
> ⇒ 上面那条"不重画就破功"的顾虑不成立。真正要守的不是"簇动不动"，而是
> **配置面板结构与包结构解耦**：面板怎么分簇 / 分节，按**信息架构**定（用户找得着、语义完整），
> 不按"这个键属于哪个包"定 —— 因此**拆包不产生分区重画，反过来分区也不构成拆包边界**。
> 将来若真要重画，走上面第一条路径（改分区表与口径 + 存档语义映射），与本轮拆包**解耦成两件事**。

### 6.4 预设（`PROFILE_PRESET_KEYS`，键集横跨全部设置簇 + 三族资产）怎么跨包？

它是唯一"路由不写设置却必须理解所有包的键"的落点（`sanitizePresetValues` / `installAssets`）。
三选一：主包聚合（子包把键注册进主包）/ 每包自带片段 + 宿主装配 / 拆成多个预设。

### 6.5 （附带，但**开关语义落地前必须先定**）主包被关掉时子包怎么办？

**机制事实（`U5`）**：停用"被依赖的行"时**运行期是安全的** —— 消费者 park、提供方等消费者卸完才返回（§2.1）；
但 `reconcileProfilePatches` 会把"新出现的 inactive 行"当失败**抛错**，插件管理器记 `application: 'failed'`，
且**不回滚 YAML**。⇒ 用户点一下主包开关，界面会**大声失败**，而 profile 里已经写着 `disabled`。

**为什么这条不能留到 P-D**：目标形态里"关掉某个组件"是**日常动作**，而"关掉整个插件"（主包那一行）是用户必然会试的第二步
（上一轮排查里我们就建议过"重开开关自救"）。两种可接受的用户可见语义**二选一，必须先表态**：

| 选项 | 形态 | 代价 |
|---|---|---|
| **A 不连坐** | 关主包不失败：子包按 `inject` 级联 park，界面照常打开（只剩子包自己的面） | 要在主包与子包之间把"共享能力"从硬 `inject` 里摘出来（撞 `J3` 无同进程强耦合 / `J5` 出入边少），并把 `reconcileProfilePatches` 的 failed 路径适配掉 |
| **B 明确连坐** | 关主包 = 关整族；界面必须**说清"整族已停用、重开主包恢复"**，`components.failed` 与"未启用"在 UI 上可区分（`D3③` 已经要求这条） | 用户多一步操作；但零新机制、语义诚实 |

> 无论选哪个，**都不能"什么都不做"**：现状是"用户看到 failed，profile 却已改" —— 这正是 `D3③` 的"失败必须可见"要防的形态。

> **2026-10-15 表态（用户口径）：走 B 明确连坐。** 理由：拆分后**大量组件在机制上就依赖主包**
> （配置模板逻辑、`applyComponent` 门面、§5.1 ② 定下的"子包 import 主包叶子模块"这条 value import 边），
> 所以"主包被关掉"与"整包被关掉"**行为一致**，A 的"不连坐"没有可实现的物理基础。
> **待细化（P-A 落 §7.6 开关往返判据之前必须定，仍算开口）**：主包行 inactive 时，由它的 patch 插入的
> 子包行要不要**一并撤走**（不清掉就会出现"主包已关、子包路由还在"的半死状态）；以及"整族已停用"这句
> 提示由谁渲染 —— 都在 `U5`（`reconcileProfilePatches` 抛错 + 记 `application:'failed'` + 不回滚 YAML）那条路径上。

> **2026-10-16 表态（本轮裁决，可再议）：上面两个残余开口这样落地** ——
> ① **不自动撤子包行**：三个子包的宿主半边都 `inject: ['wallpaperEngineHost']`，主包行一关 ⇒ provider 不在
>    ⇒ 子包 fiber 按 `inject` **级联 park**（`apply` 不跑、路由不注册）⇒ 文档担心的"主包已关、子包路由还在"
>    在机制上不成立；而"自动撤行"要主包去增删 profile 的行，撞 §2.4 的粒度事实与 `I8`（运行时不增删行），
>    代价大且与 park 语义重复。
> ② **"整族已停用"由主包行的状态面渲染**（复用 `D3③` 的"未启用 / 失败必须可区分"）：子包行显示
>    "因主包停用而搁置"，**不新增**跨包提示通道。
> ③ 对应判据归 §7.6 第 4 条的**整族实例**（随 P-C 落判据）；语义正本仍是 `D-13` 的 B 明确连坐。

---

## 7. 阶段计划

> **贯穿纪律**：① 每阶段先落**判据**、再改实现（ADR-0013 D12 的教训）；
> ② 每阶段独立提交、可单独 revert；③ 每阶段末跑 §7.7 的验收；④ **不许先放宽守卫再改**。

### 7.0 起步态（已达成，作为基线）

单包 + 4 行（**这是拆包起点**；现行形态 = 7 行，见文件头「基线」）；D3 的界面级开关语义已落地（状态面 `/inventory.components`、可见面声明 `lib/component-visibility.js`、
判据 `test/verify-component-visibility.mjs`）；守卫链 `node test/run-guards.mjs all` **全绿**
（步数与地板以 `test/run-guards.mjs` 与 `test/verify-package-files.mjs` 的 `CHAIN_FLOOR` 为准，本文不抄数）。
**度量口径见本文件末的附录 E；历史进度与追版本日志见 `CHANGELOG.md` 与 git 历史。**

> **"不用重启"这条在起点的 4 行上已经成立**：那 4 行（`wallpaper-engine` + 三个既有组件行）
> 在 profile 的 `patchReload: live` 下可**逐行热切**（`R4`；行开关的覆盖项形态见附录 D）。
> ⇒ 本轮重构对这条目标的**真实增量是"从 4 行到 N 行、且每行都还能这样切"**，不是"把热切做出来"。
> ✅ **已收口（2026-10-15）**：当时**零覆盖**的第 4 条判据（开关往返 / 停用零残留）已落成
> `test/verify-subpackage-toggle-roundtrip.mjs` 并挂**硬档**（连同 §7.6 的另三条 + 包面判据，见 §7.6）。

### 7.1 P-A 试点：三个小子包（**✅ 已落地 2026-10-15 · 落盘 `3842584e`**）

**目标**：把"多包 + 一次装 + 启动自检 + 跨包服务"这条链走通，**不动 `selection` / 设置面板**。

| 子包 | 搬什么 | 占哪几个半边 |
|---|---|---|
| 点击与拖尾效果 | `src/fx-layer.js`、`src/ext-fx.js`（`FX_EXTENSION_MODULE`） | 宿主空壳 + 浏览器半边 + 一条行 |
| 3D 效果 | `src/parallax-layer.js`、`src/ext-parallax.js`（`PARALLAX_EXTENSION_MODULE`） | 同上 |
| 字体系统 | 宿主侧 `lib/routes/{fontsets,system-fonts}.js`（P-A 只搬了这一半）；浏览器半边 `src/fontset-editor.js` + 外观页签字体节（P-C 2026-10-16 搬）；其余 `src/font/**`、`src/fontset-store.js`、`src/system-fonts.js` 仍留主包 ⇒ 落点见 **§7.8** | 宿主实现（已落）+ 浏览器半边（**已落 P-C 第一刀**）+ 一条行 |

**动作**：① 建三包，落点 = **同仓 `packages/<pkg>/`**（§8.1，2026-10-14 定案）；② 主包按**未发布期的开发形态**接线 =
`devDependencies` + `file:packages/<pkg>` 三条（**不是** `dependencies`：把未发布的包写进 `dependencies` 会让 `npm ci`
当场 404；发布期形态 = 发布后改成精确版本，见 §12 与 §10.1 #14）；
③ 主包 patch 里 `insert` 三行；④ 加启动自检与"行在 patch 里"的判据（§7.6）；
⑤ 把 `extensionModules()` 从**静态数组**改成"读注册表"（**首个跨包贡献点**，通道 = **Cordis Service**：子包 `inject: ['wallpaperEngineHost']`，见 §6.2 / §5.1 ①）。
**判据**：三包能被**逐行单独停用／恢复**，且界面/路由各自消失（复用 D3 的可见面判据 + §7.6 第 4 条的往返判据）。
⚠️ **字体包这半条在 P-A 落盘时并不成立**（只交付宿主半边 ⇒ 关掉该行只撤路由、界面还在）；
✅ **2026-10-16 P-C 第一刀之后已成立**（字体包自带浏览器半边与产物，见 §7.3 落地账）。
⚠️ **"复用主包子路径承载客户端半边"不成立**：客户端 graph row 是**包级**的、子路径行不参与扫描（`C1`），
所以"带浏览器半边"的子包必须**自己**是包：`exports["./client"]` + `dsh.client` 三件齐（`C2`），
且行 `name` 走**真实包名**或子路径两种形态都行（§2.4 的粒度事实）。主包不装子包时**大声报错**。

> **P-A 实况（2026-10-15 落盘，与上表第 3 行的差额）—— ⚠️ 已被 P-C 第一刀超越（2026-10-16）**：`packages/fonts` 实际只交付**宿主半边**
> （`lib/index.js` 120 行 + `lib/routes/fontsets.js` 415 + `lib/routes/system-fonts.js` 530）：
> **没有** `src/`、**没有** `dsh.client`、`exports` 里**没有** `'./client'`。
> 裁决理由：§7.1 自身写着"不动设置面板"，而字体配置面（外观页签字体节 + `selection` 驱动的浏览器通道）
> 就在设置面板里 ⇒ 声明 `dsh.client` 却没有 `exports['./client']` 会按 `C2` 抛错。
> **后果**：按 §7.6 第 2 条，本包今天**不在"浏览器半边在场"判据的范围内**
> （`verify-subpackage-client-half.mjs` 只对声明了 `dsh.client` 的包判红，它的信息行又只扫
> `packages/<pkg>/{src,lib}` —— 而字体浏览器半边住在主包 `src/**` ⇒ **连信息行都不出现**）。
> ⇒ 目标形态**不变**（定案 A），落点从 P-A 移到 **§7.8 的收口线**。

### 7.2 P-B 基础设施

- **构建**：`scripts/build-client.mjs` 从"单产物 + INLINE_MODULES"改成"**按包出产物**"（每包一个 `lib/client.<pkg>.js`），
  主包保留自己的半边；`verify-client-sync` 要覆盖 N 个产物。
- **守卫**：把单包硬假设参数化（见 §7.5）。
- **服务**：按 §5.1 选定的出路实现（② 或 ①）。**第一个真实客户就是字体收口**（§7.8 层 1）：
  字体浏览器半边依赖的 `selection`（字体一族 5 个文件引用，`fontset-store` 53 次）/ `weT` /
  `apiFetch`·`apiJson` / `applyEffects` / `hostFailureReason` / `createThemeLayer` 今天全在主包 ——
  注入键集按这份清单设计，别等搬的时候才发现缺键。
- **按包出产物不许写死两处**：构建**配方住在包内**（`packages/<pkg>/client.build.json`：`artifact` /
  `entry` / `inline[]`），构建器按目录发现、循环处理 ⇒ 新包只加一个配方文件、**不加分支**；
  字体包届时只加一条（包级 `src/client.js` + 包内 inline 表 ⇒ `lib/client.fonts.js`）。
- **纪律判据**：`external` / `inject` 的使用面、"无跨包 value import"。

> **落地账（2026-10-15；已提交 `be3717f7`）**——P-B 主体已落盘；**服务面不在此列**（§5.1 ① 已定，首个客户是 §7.8 层 1）：
> ① **包发现层** = `test/tools/packages.mjs`（新增）。真源 = 磁盘枚举（`packages/*`、`lib/components/*`）
> + 根 `cordis.patch.yml` 的行，**不写死名单**；导出 `discoverPackages` / `enumerateViolations`
> （**纯函数**：生产路径与全部负对照共用同一份判据，防"负对照自己实现了一遍判据"）/ `FLOORS` 地板
> （包数 / 产物数 / 行数，防静默缩水）；自带 `selftest`（11 条负对照）并**挂硬链**（`VERIFY_STEPS`）。
> ② **构建配方数据驱动** = `packages/<pkg>/client.build.json` 取代构建器里写死的 `SUBPACKAGE_BUILDS` 表；
> 产物**逐字节不变**，且"配方读不出 ⇒ 判红并点名该包"的牙保留。
> ③ **守卫参数化** = `verify-client-sync` 覆盖发现层的**全部**产物（含产物面地板与"每份产物差一字节都判红"
> 的负对照）；`test/tools/guard-targets.mjs` 的产物面改取发现层（`walk` **仍走磁盘通配、只增不减**，
> 另加"`packages/` 下每个目录都必须是登记在册的子包"的发散判据，硬牙落在 `verify-subpackage-manifests`）；
> `test/tools/host-route-index.mjs` 的包 / 行 / 路由面改读发现层，`docs/ROUTE-INDEX.md` **逐字节不变**。
> ④ `verify-subpackage-manifests` / `verify-scene-live` 原先从**构建器源码文本**里切那张写死的表，
> 现改读包内配方。
> **仍未落地**：三份生成物与 `scripts/prepare.mjs` 的口径（§10.1 #10 / #11，已表态）· `#1` 的其余面
> （`verify-bundle-rows` 仍有意脱链）· 子包独立发布形态（§12）。

### 7.3 P-C UI 子插件

玻璃面板（`src/glass.js` / `src/glass-panel.js` / `src/styles.js` 的 UI 部分）、侧栏圆角、外观里的 UI 配置项。
**前置**：§6.1 与 §6.3 已表态；§6.2 的服务面已定。
**首个真实客户 = 外观页签的字体节**（§7.8 层 1）：`src/panel-tabs-appearance.js`（578 行）今天是
"外观页签"一个文件，字体节（:54-420，约 367 行 = 63.5%）与玻璃 / 圆角节同文件、经 `src/panel-tabs.js:92` 挂载
⇒ **不先把它切成独立模块，字体半边就无法随包出产物**。这正是 §6.3「设置簇要不要按插件重画」的实例。

> **落地账 · P-C 第一刀（2026-10-16；已提交 `145806c3`）**：目标 = 让**字体系统成为第一个带界面的独立子包**。
> 已落：
> ① 字体节切成独立模块并搬进 `packages/fonts/src/appearance-font-section.js`（函数体逐字未改）；
> ② `src/fontset-editor.js` 整文件搬进 `packages/fonts/src/fontset-editor.js`（原文件已删）；
> ③ 新增包内浏览器入口 `packages/fonts/src/client.js` + 构建配方 `packages/fonts/client.build.json`，
>    产物 `packages/fonts/lib/client.fonts.js`，清单补 `exports['./client']` + `dsh.client`（与 fx / parallax 同形，S3.8）；
> ④ 跨包贡献面 = 主包 `src/extension-registry.js` 新增**面板节注册表**
>    （`weRegisterPanelSection` / `wePanelSectionsOf` / `weSetPanelSectionListener`，口径同既有两张表：
>    缺什么抛什么 / 注册期不读译文 / id 唯一），`src/panel-tabs.js` 的 `renderAppearanceTab` 改为
>    「五个内置节 + 注册表续接」；字体节**不写 `order`** ⇒ 仍排在第六位（屏上顺序逐项不变，判据钉住）；
> ⑤ 判据先行（D12）：§7.6 的包面判据扩到字体包**实例** —— client-half 的"必需有浏览器半边"清单、
>    purity 的 `src/` 面覆盖地板、toggle 的字体行实例（路由整族缺席 + 节只能经注册表显形）、
>    manifests 的 S3.4 / S10.2 对字体包真的生效（不再走 host-only 豁免）。
> **仍不搬**（§7.8 层 1 的"不搬"清单，理由 = 与主包其它半边在**求值期/运行期双向耦合**，
> 例如 `src/font/apply.js` 对 `src/font/components.js` 有 6 处真实调用）：
> `src/fontset-store.js`、`src/system-fonts.js`、`src/font/apply.js`、`src/font/typography.js`、
> `src/font/color-roles.js`、`src/font/components.js`。
> **本节仍未落**：玻璃面板 / 侧栏圆角（`packages/ui` 尚未建立）= P-C 的剩余面。

### 7.4 P-D 壁纸子插件（**最大的一块，最后做**）

以 `packages/media-bridge`（P-F 批 1c 2026-10-16 出户）为基础大改：WE 壁纸与自定义导入壁纸的渲染、壁纸库 + 播放-画面里的配置项、声音、省电。
**前置**：层的所有权（`LAYER_ID` / `SCRIM_ID` / iframe 的建立与退役）必须有唯一所有者，否则两个包各建层 = 撞单例 id。
**注意**：引擎已是 npm 依赖（§9.4 定案 = 主包持有、不随子包）；`lib/webwallgl/**` 如今只剩自家模板/桥文件。

### 7.5 P-E 收尾

文档（`CODE-STRUCTURE` / `HOW-IT-WORKS` / 三份 README / `CONTRIBUTING` / CHANGELOG 四段式）、生成物重算、本文件归档。

### 7.6 **新增判据（四条 + 一条包面判据）**

> **✅ 已收口（2026-10-15）**：下面五条**全部落盘并挂硬档**（`test/run-guards.mjs` 的 `VERIFY_STEPS`），
> 每条自带负对照与真源码变异测试。链成员 / 档位 / 步数以 `test/fixtures/verify-chain.json` 与
> `test/verify-package-files.mjs` 的 `CHAIN_FLOOR` 为准（本文不抄数）：
> ① `test/verify-subpackage-boot.mjs` · ② `test/verify-subpackage-client-half.mjs` · ③ `test/verify-subpackage-purity.mjs` ·
> ④ `test/verify-subpackage-toggle-roundtrip.mjs` · ⑤ `test/verify-subpackage-manifests.mjs`（**包面**：`packages/*/package.json`
> 与自带 patch 行、根 `exports` 三连对账；2026-10-15 **由 `docs` 软档组升 hard** —— 依据 ADR-0004 的分档判据与
> [`adr/0014`](../adr/0014-subpackage-contract.md) S3 的档位说明）。

1. **启动自检（宿主）**：主包 `apply` 里主动 resolve 每个子包与其行，失败**大声报错**
   （因为行级失败是静默的，I5）。
   ✅ **两条腿（2026-10-16 加固）**：① **仓库腿** —— `createRequire(import.meta.url)` 落在本仓
   `node_modules`，管的是"patch 行与主包 manifest 脱节"；② **宿主腿** ——
   `assertSubpackagesResolvableInHost()`：对**每个会装载本主包的 profile**按其 `cordis.yml` 旁解析裸包名，
   管的是"仓库里在、profile 侧缺链接"（仓库腿结构性看不见的那种）。判据 = `test/verify-subpackage-boot.mjs`
   的 ②b 段；落地账见 §15.2 末块。**探不到任何 profile（CI / 没装过 DSH）⇒ 静默退化**，
   `DSH_WE_SKIP_HOST_CHECK=1` 是唯一旁路。
2. **浏览器半边在场判据**：每个带 `dsh.client` 的子包，其**行必须被某个已选中的 bundle patch 插入**
   （C2 + §2.2 的那条静默失效）。
   ⚠️ **字体包今天不在本条范围内**（它没声明 `dsh.client`）—— 这是**已知的过渡态、不是覆盖**：
   `test/verify-subpackage-client-half.mjs` 只对声明了 `dsh.client` 的包判红，它的信息行也只扫
   `packages/<pkg>/{src,lib}`，而字体的浏览器半边住在主包 `src/**` ⇒ **连信息行都不出现**。
   收口（§7.8）后本条必须对字体包**真的生效**（正 / 负对照都要）。
3. **跨包纯度判据**：子包之间**没有** value import（in-box 靠构建期 gate，我们得自己写）；
   `external` / `inject` 的使用面要与声明一致。
4. **开关往返判据（新增；§7.0 那条"已成立、当时无判据"的补丁，✅ 2026-10-15 已落成 = 本节开头的 ④）**：对**每一行**做
   **关 → 开 → 再关**，每一步都要满足 ① 该行路由整族在场/缺席与声明一致（D3①）；
   ② 可见面按状态面渲染（复用 `verify-component-visibility` 的双向对账）；
   ③ **停用后零残留**：无模块级定时器 / 无人挂 `window` / 客户端无遗留 `style[data-plugin=…]` 与 DOM 节点
   （`U3` / `U6` / `U8`）；④ 这一关**只**动了它自己那一行（其余行的路由账与可见面逐条不变）。
   ⚠️ 判据要能区分**"开关生效"与"已重启"**：本条的期望口径是 **profile 已写入 `disabled` + 运行期状态面跟随**，
   不读源码 / 不要求重新 import（那是 §11 的另一档）。**负对照**：把某行 `apply` 的拆卸改成 `return` 而不注册
   `ctx.effect`，本条必须变红（否则它只是把"能显示状态"当成了"切干净"）。

### 7.7 每阶段验收（命令统一放附录 C）

### 7.8 字体系统收口（**定案 A**，2026-10-15，P-A 收口后复核；不阻塞 P-B）

**定案（用户口径）**：字体系统子插件的**目标形态 = 整个「字体自定义」配置类** —— 宿主半边 + 浏览器半边 +
外观页签的字体节 + 字体键的所有权（§1.1 的「已可自成一系」按此读）。**不必现在完成**：
落点挂在 P-B 的能力与 P-C / P-D 的表态之后，它**不阻塞** P-B 开工。

**P-A 实际交付（基线，已落盘）**：`packages/fonts` = 宿主半边 1065 行
（`lib/index.js` 120 + `lib/routes/fontsets.js` 415 + `lib/routes/system-fonts.js` 530），
无 `src/`、无 `dsh.client`、`exports` 无 `'./client'`，`dsh` 只有 `bundle.patch`。
**覆盖率的诚实读法**：按「整个字体自定义」计 ≈ 1065 / ~3700 ≈ **29%**，且搬走的是**没有界面的那一半**。

**缺口四块（量化基线）**：

| # | 缺的那一块 | 今天住哪 | 量 |
|---|---|---|---|
| 1 | 浏览器半边（字体集通道 + 应用层 + 系统字体枚举 + 编辑器 + 排版 / 颜色角色） | 主包 `src/**` | 7 文件 **1882 行**：`fontset-store` 539 · `font/components` 316 · `font/apply` 217 · `font/color-roles` 211 · `system-fonts` 210 · `fontset-editor` 206 · `font/typography` 183 |
| 2 | 外观页签的字体节（总开关 / 默认 + 终端字体 / 颜色角色 / 排版角色 / 组件字体 / 字体集预设） | `src/panel-tabs-appearance.js` :54-420，经 `src/panel-tabs.js:92` 挂载；两档都画（`PICKER_FONT_OPEN_KEY` / `QP_FONT_OPEN_KEY`） | **367 / 578 = 63.5%** |
| 3 | 配置类内核的字体面 | `lib/settings-schema.js`（S1 唯一共享内核） | 字体专属顶层块 **283 / 1969 = 14.4%**；另有字体键嵌在 `DEFAULTS` / `DEFAULTS_ONLY` / `KINDS` / `RESET_MODULES`·`RESET_TABS` / `sanitizePresetAssets` 里 |
| 4 | 宿主支撑面（活动字体集 id · 迁移护栏 · 预设里的 font 段 · 内置字体集数据 · 构建接线） | `lib/kernel/config.js` :176-237 · `lib/routes/presets.js` :140/:337/:397/:463 · `lib/fontsets/compact.json` + `lib/we-assets.js:34` · `scripts/build-client.mjs` 的 INLINE_MODULES（9 条字体族条目） | 见左列各行 |

**收口分三层（每层都有硬前置，别提前动）**：

1. **层 1 · 能力与面板节（P-B 提供能力，P-C 动手）**
   - P-B 侧：✅ **已落（2026-10-15）** —— 构建配方改住**包内** `packages/<pkg>/client.build.json`，
     构建器按目录发现、循环处理（"数据驱动 N 项"，§7.2）；
     注入键集按字体半边**真实依赖**设计（`selection` / `weT` / `apiFetch`·`apiJson` / `applyEffects` /
     `hostFailureReason` / `createThemeLayer`）；~~补**仓库根 self-link**（§8.1 追加条）~~
     —— ✅ **已作废（2026-10-15，跨包改走 ① Service）**：子包宿主半边不再裸名 import 主包，
     该前置连同 §8.1 的 self-link 一起消失（§10.1 #16）。
   - P-C 侧：✅ **第一刀已落（2026-10-16；已提交 `145806c3`）** —— 字体节已从 `src/panel-tabs-appearance.js`
     切成独立模块（`packages/fonts/src/appearance-font-section.js`，它就是 §6.3 的第一个实例），
     `packages/fonts` 已具备包级 `src/client.js` ⇒ `dsh.client` + `exports['./client']` +
     `lib/client.fonts.js` 三件齐（`C2`）；主 patch 的**行名不变**（§3）。落地明细见 §7.3 的落地账块。
2. **层 2 · 配置类键的所有权（§6.1 / D-6）—— ✅ 已表态（2026-10-16，用户口径）：A 代码归属**
   - 读法以 §6.1 的表态块为准：`lib/settings-schema.js` 的**键面与状态全留主包内核**（键名 / 簇名 /
     消毒 / `selection` / `setSetting` / `emit` / 持久化都不改 ⇒ **零存档迁移**）；随包走的是
     **"画这一节"的渲染器与描述符**，落 `packages/<pkg>/src/**`，由包自己的浏览器半边出产物；
   - ⇒ 本节旧措辞"取代码归属 ⇒ schema 按包切片段 + 主包聚合"**作废**：schema 一个片段都不切；
   - ⇒ 旧措辞"整个配置类里仍有一半属主包……必须在 §1.1 明写"也随之作废 —— 拆的是**渲染代码**，
     不是键的所有权（这正是本轮要避免的误解）；
   - ⚠️ **代码注释义务**（用户要求明文）：`lib/settings-schema.js` 的字体块头、`packages/fonts/**` 的入口、
     以及随包搬走的**每个**渲染模块，都要写"配置项真源与状态在主包（§6.1 = A 代码归属），本包只提供
     渲染器 / 描述符"；
   - 附带：`lib/fontsets/**` 与 `FONTSET_BUILTIN_DIR` 随包走（§9.1 已记），与键所有权无关。
3. **层 3 · 判据（先落判据再搬 —— ADR-0013 D12 的纪律）**
   - §7.6 第 2 条的字体实例：✅ **已落（2026-10-16）** —— `packages/fonts` 声明 `dsh.client` 后，
     `test/verify-subpackage-client-half.mjs` 已对它**真的生效**（必需清单 + 声明落点产物里必须有
     构建期 `require('<主包名>')`），且 purity 侧补了 `src/` 面覆盖地板（专治"零主包说明符判据
     在该包上真空为真"）；
   - §7.6 第 4 条的字体实例：✅ **已落（2026-10-16）** —— `test/verify-subpackage-toggle-roundtrip.mjs`
     新增字体行实例：关行 ⇒ 宿主路由整族缺席 + 关→开→再关零残留；且字体节**只能经面板节注册表显形**
     （初始无此节 / 注册后可见 / 订阅者被通知 / 注册期不读译文 / 节注册必须住在字体包产物里而不许被主包内联）。
     ~~"今天的现状是界面还在、通道 404"~~ —— 该现状已终结（界面随包走，关行即不再画）；
   - 预设面：字体集预设横跨"字体包 + 主包预设路由"（`lib/routes/presets.js` 的 `currentFontSegment`），
     其判据随 §6.4 / D-9 一起定 —— **仍未落**。

**过渡期必做的三件事（现在就做，不等收口）**：
1. ~~按 §5.3 的第二条出路**明说**：`packages/fonts` 当前只提供宿主路由、字体界面随主包、**不可单独开关**~~
   —— ✅ **已终结（2026-10-16，P-C 第一刀）**：字体包现在自带浏览器半边与产物 ⇒ **可单独开关**，
   §7.1 实况块里那句"不可独立开关"随之作废；
2. **包描述漂移**：✅ **已修（2026-10-15）** —— `packages/fonts/package.json:4` 与 `packages/fonts/locale/{en,zh}.json:4`
   原先都声称带 "the typography/colour-role browser half"，已改成"仅宿主半边、字体界面不住本包"；
3. ~~补 §8.1 追加条的**仓库根 self-link**，让字体包在仓内可跑。~~ ✅ **已作废（2026-10-15，① Service）** ——
   字体包宿主入口改从 `ctx.wallpaperEngineHost` 取用，仓内可直接跑（§10.1 #16）。

**复算入口**：`node test/verify-subpackage-client-half.mjs`（现覆盖 fx / parallax / **fonts** 三者）·
`node test/verify-subpackage-toggle-roundtrip.mjs`（含字体行实例）· `node test/verify-bundle-rows.mjs`（脱链手动）。
量化基线可复算：字体行数 = 对目标文件按 `font|Font|FONT|字体` 命中行计数；字体专属顶层块 = 对
`lib/settings-schema.js` 顶层声明切块后按名字匹配 `FONT` / `FONT_FAMILY` / `SYSTEM_FONT` /
`THEME_*_ROLE` / `COMPONENT_FONT` / `FONTSET_` / `isFontSetId` / `sanitizeFontset` / `sanitizeFamily*`。

### 7.9 P-F 组件行统一（**时机 A：独立机械提交，排在 P-D 之前**）

把三条**组件行**（`lib/components/<sub>/`，主包 patch 用**子路径名**引用）并进 `packages/<pkg>/`，
让"一组件 = 一包"与 P-A 的三个独立子包**同形** —— 这正是 ADR-0013 **D6 的终态**
（"原 D6 的形态（单包多行）是本次重构的**起点**、不是终态"，`docs/adr/0013-bundle-multi-component-rows.md:121-127`）。

- **时机（用户口径，2026-10-16）**：账① 作**一次独立的机械提交**，**排在 P-D 之前** —— §7.4 的 P-D 要
  "以 `packages/media-bridge` 为基础大改"（该格已由 P-F 批 1c 搬出），**先搬后改写只付一次路径成本**；反序要把那批实现与测试改两遍。
  **不与 P-D 合批**（机械搬迁与行为重写混在一个提交 ⇒ `bisect` / `revert` 失能）。
- **分批**：① 包边界 + 行名（行 `name` 改真名；机械、**零行为变化**，先行）→ ② 浏览器半边逐组件成产物
  （`about-notice` 先、`mascot-avatar` 后；`media-bridge` 今天**没有**浏览器半边 ⇒ 交给 P-D）。
- **前提已勘误**：三条组件行**从未发布**（已发布物只有主行）⇒ **不存在"曾关过该组件"的用户**，
  行 `name` 可直接改真名、**零迁移代价**（§15.1 / §3 的范围勘误）。
- **完整计划与须知见 §15**（三笔账的边界 / 落点硬约束 / 判红面 / 前置决策 / 复算入口）。

---

## 8. 落到仓库的形态

### 8.1 目录与包布局（**2026-10-14 定案：同仓 `packages/<pkg>/`**）

| 选项 | 形态 | 结论 |
|---|---|---|
| **同仓 `packages/<pkg>/`**（**采纳**） | 各自 `package.json` + `cordis.patch.yml`（若自己带行）+ `lib/` | 需要新的目录纪律；`host-route-index` / `guard-targets` / `verify-retired-lines` 的顶层目录假设都要登记（§10.1 #7/#8） |
| 同仓但不在 `packages/`（如 `sub/<pkg>/`） | 同上，换个名字 | 不采纳：私有名字只增加解释成本，换不来任何机制收益 |
| 多仓 | 每包独立仓库 | 不采纳：发布/同步成本高；**版本一致**靠人工对齐，与"方便管理"相反 |

> **注意**：`workspace:` / `bundledDependencies` / monorepo 的**安装语义不被 DSH 支持**（I3），
> 但"同仓多包 + 各自发布"在 npm 层是可行的 —— 我们要的只是**同仓开发**，不是 workspace 协议。
>
> ✅ **开发期解析 spike：2026-10-15 完成，结论已落**（原"未验证"闸门解除）。取证 = 直读
> `D:/DeepSeek Harness/resources/app.asar`（DSH 0.2.0-rc.2）+ 真 profile 目录上的解析探针 + 合成 profile 实证。
>
> 1. **`bareModuleBaseUrl` 在本版 DSH 里没有任何调用点传它**。全 asar 里该标识符只出现在
>    `@deepseek-ai/dsh-app-boot/lib/index.js`；`loader.builtins.include` 也只有这一处赋值；而**唯一**
>    import `boot` 的调用点是 `@deepseek-ai/dsh/lib/profile-boot`（desktop 与 web 都经 `runProfile` 走这里），
>    其调用是 `boot(NAME, rootConfig, readProfilePatches(…), async (hostCtx) => {…})` —— **4 个实参，
>    第 5 个 `bareModuleBaseUrl` 恒为 `undefined`** ⇒ 恒走 `Include` 分支，`HostResolvedRootInclude` 从不构造。
>    下文原话"裸包名 → `internal.import(name, bareModuleBaseUrl)`（installed-host base）"描述的是**那段分支的代码**，
>    但本版没有任何路径进入它 ⇒ **该参数是死参数**（`bareModuleBaseUrl` 的注释也写明"for closed packaged runtimes"）。
> 2. 因此**行名一律从 `<profile>/cordis.yml` 所在目录起算**（`rootConfig = join(profile.dir, 'cordis.yml')`；
>    `prepareProfilePatches(…, parentURL = dirname(absoluteConfigPath) + '/')`）—— **裸名与 `./…` 相对名同底**：
>    裸名 → `<profile>/node_modules/<name>`；相对名 → `<profile>/<相对路径>`。
> 3. **真机解析探针**（`createRequire('<profile>/cordis.yml')`，web profile）：
>    `dsh-plugin-wallpaper-engine` → `D:\dsh-wallpaper-engine\lib\index.js` ✓；
>    `dsh-plugin-wallpaper-engine/about-notice` ✓（**这就是现有 4 行今天真能工作的机制**）；
>    `dsh-plugin-wallpaper-engine-fx` → **MODULE_NOT_FOUND** ✗；
>    `dsh-plugin-wallpaper-engine/packages/fx/lib/index.js` → **ERR_PACKAGE_PATH_NOT_EXPORTED** ✗
>    （`exports` 是**封闭映射** ⇒ 经包名的深层路径一律走不通）；
>    `./packages/fx/lib/index.js` → 落到 `<profile>/packages/…`，**不存在** ✗。⇒ **原文那条备选口径（以及 §8.3 里
>    照抄它的注释）是错的，作废**。
> 4. **"`link:` 不装 dependencies"已由上游自己记账**：`<profile>/node_modules/.package-map.json` 里
>    `"link:D:/dsh-wallpaper-engine": {"url":"file:///D:/dsh-wallpaper-engine","dependencies":{}}`
>    —— **空依赖表**。⇒ 开发期 profile 的 `node_modules` **永远不会**自己出现子包真名。
> 5. **结论 / 开发期口径：行名不改（裸真名），改用开发期 junction**。在 `<profile>/node_modules/` 下为每个
>    子包建目录 junction：`dsh-plugin-wallpaper-engine-<pkg>` → `D:/dsh-wallpaper-engine/packages/<pkg>`，
>    与发布后 npm/pnpm 的 hoist 布局**同形** ⇒ **同一份 `cordis.patch.yml`（裸真名）开发期与发布期都成立**，
>    不需要"开发期行名 ↔ 发布期行名"两套。已实证：junction + `createRequire('<profile>/cordis.yml')` +
>    真 ESM `import()` 全通（脚本 `.integration-notes/scratch/spike-junction.mjs`）。
>    **备选（不推荐）**：开发期行名写 `./node_modules/dsh-plugin-wallpaper-engine/packages/<pkg>/lib/index.js`
>    —— 相对名确实绕开 `exports` 且经符号链接能到仓库，但**发布期该路径不存在**，会把 patch 劈成两套。
>    **代价照付**：junction 不在 profile 的 `.modules.yaml` / `.package-map.json` 里 ⇒ profile 侧
>    `pnpm install` 之后要重建（写成一条可重跑的脚本，别手点）。
> ⇒ **P-A 的"三行都在场"现在可以当成已成立**（前提：先按第 5 条建 junction）。
>
> ~~**追加（2026-10-15，P-A 落盘时的实测缺口）**：`scripts/dev-link-subpackages.mjs` 只建**子包真名**的 junction；
> 子包体内若以**裸名**引用主包（`dsh-plugin-wallpaper-engine`），Node 的**包内自引用**并不因此可用 ——
> 仍需要一条**仓库根 self-link**（`node_modules/dsh-plugin-wallpaper-engine` → 仓库根）。这条今天没建 ⇒
> `packages/fonts` 的宿主入口**在仓内不能直接跑**（`packages/fonts/lib/index.js:33` 自报同一件事）。
> 归属：P-B（§7.8 层 1 的第三件前置）。~~ ⇒ **✅ 已作废，被紧邻的下一条取代**（同一天，通道改走 ① Cordis Service）。
>
> **追加（2026-10-15，已消除）**：跨包通道改走 ① **Cordis Service**（§5.1）后，子包宿主半边**零主包说明符**
> （`test/verify-subpackage-purity.mjs` 的 `ROOT_SPEC_ALLOW` 已收紧为零）⇒ 这条 self-link 边不存在了：
> 根 `devDependencies` 的自链 `"dsh-plugin-wallpaper-engine": "file:."` 已删，`scripts/dev-link-subpackages.mjs`
> 的 `rootSelfLink()` 与 `--no-self-link` 同步删除；`file:packages/<pkg>` 三条**保留**。

### 8.2 每个子包的清单（照抄用）

```
<sub-pkg>/
├─ package.json        # name / version（与主包一致）/ description / icon / type:module
│                      # exports: '.' , './package.json' , './locale/*.json'（有浏览器半边再加 './client'）
│                      # dsh: { bundle: { patch: './cordis.patch.yml' } }（若自己带行）
│                      #     或  dsh: { client: { platform:'web', inject:[...] } }
├─ cordis.patch.yml    # 一条 insert 行（id 定死；默认开/关由 disabled 决定）
├─ icon.png            # 与清单同目录（宿主 iconOf 要求 realpath 不出目录）
├─ locale/{en,zh}.json # meta.title / meta.description（缺了显示裸 specifier）
└─ lib/
   ├─ index.js         # 宿主半边：至少 export function apply(){}（纯浏览器包用空壳）
   └─ client.<pkg>.js  # 浏览器半边（仅当声明了 dsh.client）
```

### 8.3 主包 patch 的变化（示例形态）

```yaml
- insert:
    - id: wallpaper-engine
      name: 'dsh-plugin-wallpaper-engine'
    # 既有组件行：id 与 name 一个字都不改（§3）
    - id: wallpaper-engine-about-notice
      name: 'dsh-plugin-wallpaper-engine/about-notice'
    # 新子包：行名 = 真实包名，**开发期与发布期同一份**（§8.1 spike 结论：本版 DSH 不传
    # bareModuleBaseUrl ⇒ 行名一律从 <profile>/cordis.yml 旁起算；开发期靠 §8.1 第 5 条的
    # junction 让这个名字出现在 profile/node_modules 里，不要改行名）
    - id: wallpaper-engine-fonts
      name: 'dsh-plugin-wallpaper-engine-fonts'
    - id: wallpaper-engine-fx
      name: 'dsh-plugin-wallpaper-engine-fx'
```

---

## 9. 边界与归属（逐族）

### 9.1 资源目录

| 资源 | 现状 | 破局点 |
|---|---|---|
| `lib/about/**` | `ABOUT_DIR` 由主包 `pluginRoot` 解析 | 若 about 组件出包 ⇒ 资源跟走或主包继续当宿主（作注入键） |
| `lib/fontsets/**` | `FONTSET_BUILTIN_DIR` 同上 | 字体子包出包时一并迁（**定案 A 的一部分**，见 §7.8 层 2） |
| `lib/glass-presets/**` | 内嵌立绘（`factory-author.json` 的 `assets.mascot.data`） | **跨 UI 与吉祥物两族**，归属要表态 |
| `lib/webwallgl/**` | **不再是 vendored 引擎**：引擎 = npm 依赖 `webwallgl`；仓库内只剩自家模板/桥文件，零 import，由 `WEBWALLGL_PKG_DIR` / `WEBWALLGL_DIR` 指向 | 见 §9.4 |
| `assets/**`（仓库根） | 源资产，**不进包** | 派生物目的地会按包变（两份 README 的流程要重指） |
| `lib/types/**` | 类型面，今天 = 主包 | 子包要不要类型面（`verify-types` 要按包循环） |

### 9.2 设置与配置

见 §4.5 / §6.3 / §6.4。**一句话**：schema 与迁移归主包；子包只消费结果（除非 §6.3 选了重画）。
字体收口的**层 2**（§7.8）就落在这个选择上。

### 9.3 三个既有组件行

| 行 | 目标 | 备注 |
|---|---|---|
| `about-notice` | 可作为**独立子包**（与 UI 相关）或并入 UI 子包 | 判定见 §6.1 |
| `mascot-avatar` | 同上（吉祥物/头像属 UI 面） | 与 `glass-presets` 的立绘资产交叉 |
| `media-bridge` | **改造成壁纸子插件**（用户口径） | 最大的一块；后端/进程能力天然是宿主半边 |

> **2026-10-16 追加**：这三行**统一成独立子包**（`lib/components/<sub>/` → `packages/<pkg>/`）的时机
> （**A = 排在 P-D 之前**）、分批与须知见 **§7.9 / §15**。表里"或并入 UI 子包"的候选不再取
> —— 统一后一并成为各自的包（`packages/ui` 仍未建立，见 §7.3 末行）；`media-bridge` 的**代码归属**搬移
> （§15 账①）与它**被改造成壁纸子插件**（§7.4 / P-D）是两件事，前者在前。

### 9.4 第三方代码（引擎 = npm 依赖 `webwallgl`）

**形态已变（2026-10 上游 npm 化）**：引擎不再是 vendored 副本 —— `package.json` 的 `dependencies` 里有 `webwallgl`，
仓库内 `lib/webwallgl/**` 只剩自家模板/宿主桥文件（复算：`git ls-files lib/webwallgl`；
取舍记录见 [`ARCHITECTURE-SPLIT.md`](../ARCHITECTURE-SPLIT.md) §5）。

| 做法 | 好处 | 代价 |
|---|---|---|
| **主包持有依赖、不随子包走**（**2026-10-14 定案**） | 依赖声明单点；CI 与守卫零改动；上游撞车面不变 | 装壁纸子包的人必装主包（体积不省） |
| 让壁纸子包自己声明 `dependencies: webwallgl` | 语义归属正确 | 引擎出现两个持有者 ⇒ 版本漂移与双实例风险（与 §12 纪律 7 同源） |

> **决策**：**留主包**（用户口径"第三方代码除外"已经允许；且它如今已不是"随包代码"而是**依赖**）。

---

## 10. 判据与工具改造（**按包循环这一步是主成本**）

### 10.1 单包硬假设的清单（按影响排序）

| # | 文件 / 判据 | 现假设 | 要改成 |
|---|---|---|---|
| 1 | `test/tools/host-route-index.mjs` | `PKG_MAIN` = 本包 `main`；**单份** patch；`<pkg>/<sub>` → `lib/components/<sub>/index.js` | **包清单 → 每包的 main + patch + 行**；**全部下游守卫的根，改它要最后验收** —— ✅ **已落（2026-10-15；已提交 `be3717f7`）**：包 / 行 / 路由面改读**包发现层** `test/tools/packages.mjs`，生成的 `docs/ROUTE-INDEX.md` 逐字节不变 |
| 2 | `test/verify-bundle-rows.mjs` ⚠️ **不在守卫链上**（有意脱链，两条理由都在该守卫自己的注释里：① 它 import 宿主 peer 包 `@deepseek-ai/cordis`，而 CI 是 `npm ci --omit=peer`；② `verify-package-files` 的 P5 明令链上脚本不许有裸包依赖） | 仓库根**恰好一份** patch；恰好一行裸包名；其余行 `startsWith(BARE + '/')` | 按包枚举；行命名空间断言按包重写；组件的"图标与包根字节相同"对独立包不成立。**改它时 CI 不会拦 ⇒ 每阶段必须手动跑 `node test/verify-bundle-rows.mjs`** |
| 3 | `test/verify-inject-contracts.mjs` | 扫描面按磁盘枚举派生；三条哨兵地板 = 模块数 / 声明键数 / 调用点数（**具体数字以该文件为准，本文不抄**） | 扫描面按包派生；三条哨兵按新结构重算（**最容易假绿的一处**） |
| 4 | `test/verify-component-face.mjs` | 组件目录固定在 `lib/components/`；内核分级面已**读真源现算**（`KERNEL_STABLE_FACE` / `lib/kernel/*`），数字不写死 | 目录集合按包；若走 §5.1 ①（Service）则分级面复算口径同步 |
| 5 | `test/verify-route-ownership.mjs` | `lib/components/<sub>/index.js` 硬路径；地板 `>=2` | 行→入口的解析改成"读各包 `exports`/`files`" |
| 6 | `test/verify-package-files.mjs` / `verify-package-publish.mjs` | **单份** `files` / `main` / `scripts`；链步地板 = `CHAIN_FLOOR`（`verify` / `docs` / `smoke` / `all` 四组，数字以该文件为准）；入口清单写死 | 参数化成"每包跑一次"或拆两套；地板表按包组重算 |
| 7 | `test/verify-retired-lines.mjs` | 扫描面地板按**顶层目录**计数（`lib`/`src`/`test`/`scripts`） | 新顶层目录要登记 |
| 8 | `test/tools/guard-targets.mjs` | `walk(src)+walk(lib)`；`ARTIFACT='lib/client.js'` | ✅ **已改（2026-10-15；已提交 `be3717f7`）**：产物面 = 发现层 `clientPackages`（N 份，非主包产物不再靠四条字面量规则各认一次）；`walk` **保持磁盘通配**（守卫的面只许涨、不许随包清单缩）＋"`packages/` 下每个目录都必须是登记在册的子包"发散判据 |
| 9 | `test/verify-module-layout.mjs` | 共享内核白名单**只许一项** | 若走 §5.1 出路 ② 要放宽并写理由 |
| 10 | 三份生成物（`ROUTE-INDEX` / `GUARD-MAP` / `TOKEN-CONTRACT`） | 逐字节对账、单份 | **已决（2026-10-15）：仓库一份**，不按包拆分。理由：这三份是**全仓视图**（全部路由 / 全部守卫×全部模块 / 全部 token），单份才谈得上逐字节对账；按包拆会把"跨包重复登记或漏登记"正好放进无人对账的缝里。子包的面已经通过**行 ⇄ 包 ⇄ 产物**进单份生成物（发现层已是它们的输入，见 #1 / #8） |
| 11 | `scripts/prepare.mjs`（`prepack`） | 源码与产物同包根、只有一份 | **已决（2026-10-15）：只挂主包**。理由：构建入口仍是主包的 `scripts/build-client.mjs`（配方虽住在包内，构建器只有一个）；子包 `files[]` **不含 `src/`** ⇒ 子包发布面里没有源码，`prepack` 无活可干。**前置**：子包独立发布时（§12）必须在打包前先跑一次主包构建，把 `packages/<pkg>/lib/client.<pkg>.js` 产出到盘上 —— 该条留到发布阶段收口 |
| 12 | 读 `package.json` 的 `test/` + `scripts/` 文件（复算：`Select-String -Path test\*.mjs,scripts\*.mjs -Pattern package\.json`） | 单包 | 同 #1（先做"包发现"层）—— ✅ **包发现层已落（2026-10-15；已提交 `be3717f7`）**：`test/tools/packages.mjs`；下游读 `package.json` 的判据（#1 / #8 / #10）按它取包面 |
| 13 | `test/verify-settings-schema-exports.mjs` 的**扫描面自检**（`gitViewDiff` + `allowedExtra`） | 只豁免**一个**产物 `lib/client.js` ⇒ P-A 的两个子包产物（`packages/<pkg>/lib/client.<pkg>.js`，被 `.gitignore` 排除）一律按"脏面"判红 | ✅ **已修（2026-10-15）**：豁免名单改成**从各包 `package.json` 的 `exports['./client']` 现算**，并加"逐条来自包清单（含 `dsh.client`）"自检 + "同族但不在名单里的产物名仍判红"负对照 |
| 14 | 根清单 `dependencies`（P-A 把三条子包依赖写进清单、**没动** `package-lock.json`） | 「清单改了 lock 必须同步」才是**能装**的声明 —— `npm ci` 把清单当理想树去 registry 解析；未发布的包锁不出来 | ✅ **已修（2026-10-15）**：① 子包未发布期间**不写进 `dependencies`**，改用 `devDependencies` + `file:packages/<pkg>` 开发期链接（`npm ci` **不 omit dev** ⇒ 干净检出装出链接；dev 不进发布清单 ⇒ 用户侧看不到 `file:` 规格；发布形态仍按 §12 第 1 条）；② `test/verify-package-publish.mjs` 新增 ⑧「根清单 ⇄ `package-lock.json` 同步」判据（含覆盖面自检 + 五种漂移负对照）—— 实测把 `3842584e` 的清单放回去，⑧ 立刻红并点出三条 `锁里缺 …@1.3.3` |
| 15 | 三条子包依赖从清单删掉后，**运行期**的启动自检在干净检出里红（`lib/subpackage-boot.js:226`「子包启动自检失败：3 个子包行解析不到」），CI `verify` 第 7 步（`test/verify-scene.mjs`）短路 | dev 期子包必须**装得进 `node_modules`**：`devDependencies` + `file:packages/<pkg>`（见 #14） |
| 16 | 三个子包的宿主半边都 `import 'dsh-plugin-wallpaper-engine/subpackage-boot.js'`（`packages/fx/lib/index.js:22` / `packages/parallax/lib/index.js:23` / `packages/fonts/lib/index.js:40`）⇒ 干净检出里**主包自己也不在 `node_modules`**：第 32 步（`test/verify-route-index.mjs` ⑤ 真跑 `apply()`）当场 `ERR_MODULE_NOT_FOUND: Cannot find package 'dsh-plugin-wallpaper-engine' imported from packages/fonts/lib/index.js` | ✅ **已消除（2026-10-15，跨包改走 ① Cordis Service）**：子包宿主半边**零主包说明符** ⇒ 这条解析边不存在了 ⇒ 根 `devDependencies` 的 `"dsh-plugin-wallpaper-engine": "file:."` **自链已删**，`scripts/dev-link-subpackages.mjs` 的 `rootSelfLink()` 与 `--no-self-link` 开关同步删除。子包真名的 `file:packages/<pkg>` 链接**保留**（#15 的"dev 期子包必须装得进 `node_modules`"仍在） |

### 10.2 顺序纪律

1. **先落"包发现"层**（枚举本仓有哪些包：读各包 `package.json` 的 `dsh.bundle` / `dsh.client`）——✅ **已落（2026-10-15；已提交 `be3717f7`）**：`test/tools/packages.mjs`（真源 = 磁盘 + 根 patch 行、不写死名单；带 `FLOORS` 地板与 11 条负对照，自检挂硬链）；
2. 再改 **#1**（数据驱动的根）；
3. 然后逐个改下游守卫，**每改一个都要证明"牙还在"**（负对照 + 变异测试）；
4. 生成物用 `--write` 重算，禁手改；
5. **靠 `git ls-files` 对账的自检必须在 git 可用的环境里跑过一次**：DSH 沙箱禁子进程时 `repo-face.mjs` 报**具名 SKIP**
   （`fatal:EPERM`）⇒ 本机全绿**不等于** CI 全绿。实测代价：P-A 落地后本机 82/82 绿，提权后第 63 步立刻红
   （CI `verify.yml` 先 `npm run build` 再 `npm run verify` ⇒ 产物一定在场），即 §10.1 #13 那一处。
6. **改根清单必须同一次提交重算锁文件**：`dependencies` / `devDependencies` / `peerDependencies` 任何一格与 `package-lock.json` 根条目漂移，`npm ci` 就会拿清单去 registry 解析 ⇒ 未发布的包当场 404（P-A 实测：`3842584e` 本机 82/82 全绿、CI 的 install 步两条腿同时红）。判据在 `test/verify-package-publish.mjs` ⑧。子包未发布期间**不写进 `dependencies`**，改用 `devDependencies` + `file:packages/<pkg>`（§10.1 #14）；主包自链 `file:.` **已删**（§10.1 #16 / §8.1 的 2026-10-15 追加）。
7. **彩排副本必须建在仓库树之外**：Node 解析 `node_modules` 是**逐级向上**的 ⇒ 副本若嵌在仓库里（如 `.integration-notes/scratch/`），会命中仓库自己的 `node_modules`（含 `scripts/dev-link-subpackages.mjs` 建的链接）⇒ verify **假绿**。实测代价：第一轮彩排 `npm ci`/`build`/`verify`/`smoke` 全 0，把同一份内容 `git archive` 到 `%TEMP%` 后立刻逐字复现 CI 的 `✗ [7/67]`。

---

## 11. 开关 vs 重启（用户可见的边界表 —— §1.1 那两条档位边界的落地账）

> **为什么单独一节**：这两档被混成"开关一下就好了"时，用户会在真的需要重启的场景里反复开关、并且相信它已经生效
> （实测代价：一次"客户端已更新、宿主还是旧的"被读成"修复完全无效"）。下表是**唯一**口径；
> 用户文档（`README` / `TROUBLESHOOTING`）叙述这件事时以它为准。

| 用户想做的事 | 属于哪一档 | 动作 | 机制依据 |
|---|---|---|---|
| 关掉 / 打开某个组件 | **能力开关** | 插件管理器里那**一行**的开关，立即生效，**不重启、不刷页面** | `R1` / `R4` + `U1` / `U6` |
| 关掉 / 打开整个插件 | **能力开关**（= 主包那一行） | 同上；但要先定 §6.5 的语义（现状会报 `failed`） | `U5` |
| 改某个组件的配置（`config`） | **配置变更** | 走插件管理器的配置页保存，由 loader 就地/重挂提交 | `R3` 的配置侧 |
| 改了 `lib/**` / `src/**` 的**源码** | **版本/代码变更** | **重启进程**（或开发态接 HMR 监视面，见 §8.1 的待验项） | `U3`（模块缓存不清）+ `R3`（HMR 只监听配置） |
| 换 `webwallgl` 之类的依赖版本 | **版本/代码变更** | **重启**（先按 §12 的发布纪律装卸） | `I8`（无 `update_bundle`，返回 `restart-required`） |
| 改了 `dsh.client` 清单 / 增删行 | **组合变更** | **重启**；bundle 自带 patch 的改动还要**重装** | `R3`（监听面不含 bundle 自带 patch） |

**两条写死给用户的话**：
1. **"开关 = 能力，不 = 版本"** —— 开关只决定"这份已加载的代码参不参与"，它**不会**把磁盘上的新代码拉进来；
2. **别用开关当"更新按钮"** —— 看到"开关能开、功能还是旧的"时，正确动作是重启，而不是反复开关。

---

## 12. 发布与升级流程（版本一致）

1. **版本**：主包与所有子包**同号**（同一个 `version`）；主包以**精确版本**依赖子包（不用 `^`）——⚠️ 这是**发布形态**：子包发布到 npm **之前**不许把这行写进主包 `dependencies`（未发布的包锁不出来 ⇒ 干净检出 `npm ci` 直接 E404，见 §10.1 #14 / §13 #15）。**开发期形态**（子包未发布，且仓库要能干净检出后自举）＝ 三个子包装在根 `devDependencies` 里用 `file:packages/<pkg>` 链接（`npm ci` 不 omit dev ⇒ 装得出 `node_modules` 链接；devDeps 不进发布清单 ⇒ 用户侧看不到 `file:` 规格），~~另加主包**自链** `"dsh-plugin-wallpaper-engine": "file:."`~~（三个子包的宿主半边曾从主包 `import` 冻结键表；2026-10-15 改走 ① Service 后**自链已删**，见 §10.1 #16）；两种形态都得**同一次提交重算 `package-lock.json`**；
2. **安装**：用户只装主包一个名字（Web / 工具 / CLI 都行）；
3. **升级**：`dsh plugin add <主包>@<新版本>` + **重启**（无 `update_bundle`，I8）；
   或 `dsh plugin --profile <p> remove <主包>` 后重装；
4. **禁止**：把子包名单独写进 profile 的 `dependencies`（会产生两个副本/双实例，I7）；
5. **发布检查表**：① 各子包 `peerDependencies` 与主包**逐字对齐**（I6，否则整次安装被拒）；
   ② 三份生成物已重算；③ `npm run verify:all` 全绿；④ 本地真机走一遍"装 → 开 → 关一行 → 重启 → 卸载"；
   ⑤ **顺序**：先发布三个子包（与主包同号）→ 再把三条精确版本加回主包 `dependencies`、**同一次提交**把 `devDependencies` 里的三条 `file:` 规格删掉（发布物不带 `file:`；主包自链已于 2026-10-15 删除）、并**重算 `package-lock.json`** → 最后发布主包。顺序反了 ⇒ 干净检出与用户侧安装都在 install 步 404。

---

## 13. 风险登记册

| # | 风险 | 缓解 |
|---|---|---|
| 1 | **行级失败静默**（子包没落地 ⇒ 那一行悄悄消失） | §7.6 的启动自检 |
| 2 | **浏览器半边静默不存在**（行不在任何 bundle patch 里） | §7.6 的在场判据 |
| 3 | **共享内核各一份**（写队列 / 租约 / 媒体源） | §5.1 **已定案（2026-10-15）：走 ①**（主包 `provide('wallpaperEngineHost', …)`，子包 `inject`） |
| 4 | **跨包耦合静默半挂**（`ctx.get` 缓存 / import / 单例） | §5.2 的禁止清单 + 纯度判据 |
| 5 | **守卫静默失去覆盖**（扫描面按路径钉死） | §10.2 顺序纪律 + 每改一条证"牙还在" |
| 6 | **设置键被别的包抹掉**（白名单消毒） | schema 归主包；子包只消费结果 |
| 7 | **版本不一致 ⇒ 双实例** | §12 的发布纪律（精确版本 + 单一出现点） |
| 8 | **`selection` 拆分的连锁**（`quick-panel` 与设置页共用渲染器、`emit` 总线） | §6.1 先表态；试点阶段不碰 |
| 9 | **层/iframe 单例 id 撞车** | §7.4 的所有权唯一化 |
| 10 | 上游 #195 / #196 撞车 | 见 §附录 B |
| 11 | 模块顶层副作用不随停用消失（U3） | 纪律：包内不得在模块级起定时器/挂 window |
| 12 | 停用被依赖的行 ⇒ 管理器报 failed 且不回滚 YAML（U5） | 用户文档讲清；或避免让共享能力走硬 `inject` |
| 13 | **把"开关"当"更新"用**（开关只改配置与在场性，不重读源码、不换依赖版本 ⇒ "开关能开、功能还是旧的"被读成修复无效） | §1.1 的两条档位边界 + **§11 的边界表**（用户文档以此为准）；验收里用 §7.6 第 4 条把"开关生效"与"已重启"分开 |
| 14 | **子包只有宿主半边、UI 留在主包** ⇒ 关掉该行只撤路由、**界面还在**（`C1` 子路径行不参与客户端扫描） | §2.4 的粒度事实 + §5.3 的表态：带 UI 的功能族要么自带客户端半边，要么明说它不可单独开关。~~**本风险当前就是实况**：`packages/fonts` 只有宿主半边~~ ✅ **已消解（2026-10-16，P-C 第一刀）**：fonts 已自带浏览器半边与产物 ⇒ 关行即不再画字体节（§7.3 落地账 / §7.8 层 3）。本仓今天**没有**"只有宿主半边却带 UI"的包；该形态本身仍合法（宿主侧功能为主的包） |
| 15 | **清单声明了装不上的依赖**（子包尚未发布到 npm 期间，主包 `dependencies` 写了它们）⇒ 干净检出 `npm ci` 在 **install 步**就 E404、CI 两条腿同时红；本机因 `node_modules` 早已存在而完全看不见（同 §10.2 第 5 条的"本机 ≠ CI"） | 子包未发布期间**不写进 `dependencies`**，改为 `devDependencies` + `file:packages/<pkg>`（`npm ci` 装得出链接、dev 不进发布清单，§12 第 1 条 / §10.1 #14）；`verify-package-publish` ⑧ 的清单⇄锁同步判据（漂移 ⇒ 提交前就红）。**修完仍会红两处**：删声明后运行期启动自检在第 7 步红（§10.1 #15）、主包自链缺失在第 32 步红（§10.1 #16）—— 两处都已按开发期形态修好（`3f6c9109` + 本次） |
| 16 | **子包宿主半边要从主包 `import`**（`dsh-plugin-wallpaper-engine/subpackage-boot.js`，fx/parallax/fonts 三处）：干净检出里主包不在自己的 `node_modules`（npm 不会把根包自链），解析逐级向上 ⇒ `ERR_MODULE_NOT_FOUND`。本机因 `scripts/dev-link-subpackages.mjs` 建过链接而完全看不见（同 §10.2 第 5 条） | ✅ **已消除（2026-10-15，跨包改走 ① Cordis Service）**：三处裸名 import 全部改为 `inject: ['wallpaperEngineHost']` + `ctx.wallpaperEngineHost` ⇒ 根 `devDependencies` 的自链已删、`rootSelfLink()` / `--no-self-link` 同步删除。历史缓解（自链 `"file:."`，npm 装成指向仓库根的 junction，探针 `%TEMP%\selflink-probe`）不再需要 |

### 13.1 拆包整线（`6385b62e`）审查的**未完成项**

来源：拆包提交 `6385b62e` 的一次全量审查（内核/子包/路由媒体/网络面/打包判据五路 + 逐条复核）。
该轮**已修**的实害与本节的复算入口不重复记录；下表保留九条作为**台账**（行内注明当前状态：
✅ 已消解 / 未注明 = 仍未消解），供后续分批收口。

| # | 未完成项 | 位置 | 为什么留到现在 |
|---|---|---|---|
| R-1 | **注册记账缺口（2026-10-16 复核：原前提被实证推翻，真实缺陷在别处，已修）**：文档原先说"`disposers.push(webServer.register({…}))` 抛错时那条路由已进宿主路由表" —— **不成立**：真宿主 `WebServer.register` 的判重（`table.has(route.path)` 抛 `duplicate … route`）发生在 `table.set` **之前** ⇒ 抛错时路由表逐字节未变，这个单表达式**没有可失败的中间态**，"已成功部分"是空集 ⇒ 那 22 文件 42 处**全部安全，零改动**。R-1 的真实形态在**主包 `apply()` 的交接**：`handOffTeardown(ctx, dispose)` 原在最后一行 ⇒ 中途任何一处抛错（最现实：上次装载残留撞 `duplicate … route`）⇒ 该行永不执行、`ctx.effect` **从未登记** ⇒ fiber 卸载不回滚、前序各族已注册成功的路由**全部残留**（实测 31 条）。**已修**：交接挪到任何注册之前、末尾 `return teardown`（口径见 ADR-0013 D15 / ADR-0014 S6.2「先登记兜底再注册」） | 22 个文件共 42 处（复算：`git grep -c "disposers.push(webServer.register" -- lib packages \| wc -l` = 22 文件；把 `-c` 换成 `-h` 再 `wc -l` = 42 处；含 P-F 已出户的组件路由族 7 文件 / 11 处）——引用这些数字**是为了记录"已判定安全"的覆盖面**，不是待修项 | 修复账：带牙负对照（真实旧码 vs 工作树，同一抛错点、31 条已注册在前）残留 **31 → 0**，old/new 注册序列 32/32 条逐条同序逐字节相等；"族内单条注册留残留"在真宿主上**不可复现**，故未做 42 处族级 `try/catch`（判为净噪音） |
| R-2 | `components` 字段把组件 `apply` 抛错**原文**回给客户端（可能含绝对路径） | `lib/routes/diag.js`、`lib/routes/inventory.js`（经 `lib/host-boot.js` 的 `markComponentFailed`） | 本提交新增的唯一暴露面，属低危信息暴露 |
| R-3 | **已消解（2026-10-16，P-F 组件行统一）**：提交信息声称"跨包只走 Cordis 服务，**禁模块级单例与直接 import**"与实现不符：组件入口直取 `../../host-boot.js`、`../../kernel/*`、`../../http-body.js`、`../../json-response.js`，并复用模块级 `hostKernel` 单例与三本模块级可变账本 | `packages/<pkg>/lib/index.js`（`lib/components/` 目录已删除） | 三格入口已改走 `ctx.wallpaperEngineHost` 服务面（经 `host.keys()` / `componentViewFrom()` 取依赖），`packages/**` 里对主包模块的直接 import 命中数为 0（复算：`git grep -n "\.\./\.\./host-boot" -- packages` = 0、`git grep -n "\.\./\.\./kernel/" -- packages` = 0）；`test/verify-subpackage-purity.mjs` 的源码面零主包说明符判据已对它生效（唯一放行点 = 客户端产物里的 host require，见该文件 `isClientArtifact` 一支）⇒ 与 §5.1 的①和提交信息现已一致 |
| R-4 | **已消解（2026-10-16）**：链的顺序/档位曾只在**软档** `verify-guard-chain` 钉，而 CI 的 `verify:docs` 步是 `continue-on-error` ⇒ 交换链上头两步时硬档全绿 | `test/run-guards.mjs`（升档）、`.github/workflows/verify.yml`（**未改**） | 按 ADR-0004 把该步从 `DOCS_STEPS` 移进 `VERIFY_STEPS` 末尾（硬档，`npm run verify` 在 CI 上 fail-closed）⇒ "链的形状"回到硬档门禁。负对照实测：把 `test/run-guards.mjs` 头两条 `step('test/verify-…')` 交换后，该步 exit 1 并指名顺序差，随后逐字节还原。CI 侧不改文件（升档即达意，无需新步骤） |
| R-5 | **已消解（2026-10-16）**：新建判据**未挂链**时无硬档拦得住；`OFF_CHAIN_WHY` 只存在于文档、代码里没有 | `test/tools/guard-chain.mjs`、`test/verify-guard-chain.mjs` | 豁免表进代码：`test/tools/guard-chain.mjs` 新增 `OFF_CHAIN_WHY`（7 条各自写明为什么不能挂链）+ `OFF_CHAIN_FLOOR`（守卫面地板，防"面变空 ⇒ 判据永真"）+ 纯函数 `offChainDiff`；`test/verify-guard-chain.mjs` 判据 ⑤ 判「守卫面上每个文件要么在链上、要么有一条非空理由」，并把它自己判红过：task-11 的新判据一落盘、未挂链，判据 ⑤ 立刻指名 `test/verify-ci-steps.mjs`。5 条负对照（脱链无理由 / 空理由 / 豁免过期 / 豁免悬空 / 正对照放行）与正判据共用同一个纯函数 |
| R-6 | `verify-route-ownership` 的"孤儿"面曾漏组件目录（本轮已补），但"认不出入口"的候选面仍只在 `lib/routes/` | `test/verify-route-ownership.mjs` | 有意保留（组件里的 `index.js`/`supervisor.js` 不是路由族，扩过去会误报），留作记录 |
| R-7 | **已消解（2026-10-16）**：CI 步骤表**自身无判据**：删掉 `verify:static` 或 `verify:bridge` 步不会让任何判据变红 | `.github/workflows/verify.yml`（**未改**）、新增 `test/verify-ci-steps.mjs` + `test/tools/ci-workflow.mjs` | 新增"CI 步骤表"判据（行扫描解析，刻意不引 YAML 库以满足链上零裸依赖）：7 条正判据（步骤数地板 / `npm run` 序列恰好 `verify:static → build → verify → verify:bridge → smoke → verify:docs` / 每个脚本名真实存在 / `continue-on-error` 只允许且必须出现在 `verify:docs` / 存在带 `git ls-files` 的 bash 产物出库步 / `npm ci …` 在首个 `npm run` 之前）+ 11 条负对照（变异文本喂回同一个纯函数，含"一步内偷串第二条 npm run"）+ 镜像根真源变异（镜像里真删 `verify:static` ⇒ 入口 exit 1）。已挂号硬档（`test/run-guards.mjs` ⑨） |
| R-8 | 三条[既有]暴露面（**早于本提交**，未被本提交放大）：① `GET /cache-dir/browse?path=<任意绝对路径>` 无目录围栏、无参时回 `homedir()`；② `/api/local-assets` 注册在 harness `/api` 命名空间内，因"最长 prefix 胜"绕过 harness 的 `isTrustedApiRequest`+BrowserAuth，并回 WE 安装绝对路径；③ 围栏 403 把请求路径**原文反射**进 body 且无 `Content-Type`/`nosniff` | `lib/routes/cache-dir.js`、`lib/routes/we-assets.js`、`lib/routes/scene-serve.js`、`lib/serve.js` | 不属于"拆包引入的回归"，但建议单独立项（①②的处置优先级高于③） |
| R-9 | 升级回归已修但**判据面**仍薄：旧版 faststart 副本的第二清扫根靠 `test/verify-mp4-vfs.mjs` 的 G 节（真跑 `createHostSession`）钉住；同类"从内核对象解构出 `undefined`"的形态**没有通用判据**（`verify-undefined-refs` 只认 node 内置/宿主 API 名） | `lib/kernel/host-session.js`、`test/verify-undefined-refs.mjs` | G 节只覆盖这一条接线；通用形态需要另一个判据（"内核键面 ↔ 解构面双向对账"） |

> **2026-10-16 复核：本节 R-1 / R-3 / R-4 / R-5 / R-7 已消解，R-2 / R-6 / R-8 / R-9 仍未消解。**
> 本轮的四处收口都属"门禁自身的门禁"（R-1 的交接位置、R-4/R-5 的链形状与脱链理由、R-7 的 CI 步骤表），
> 与业务侧拆包不同族；R-1 的实测数字已按复算命令更正（见上表）。
>
> **复算入口**：`node test/run-guards.mjs all`（步数见 `test/verify-package-files.mjs` 的 `CHAIN_FLOOR`，本文不抄数）·`node test/verify-host-teardown.mjs`（R-1）·
> `node test/verify-guard-chain.mjs`（R-4/R-5）·`node test/verify-ci-steps.mjs`（R-7）·`node test/verify-inject-contracts.mjs`·
> `node test/verify-route-ownership.mjs`·`node test/verify-mp4-vfs.mjs`（G 节）·`node test/verify-types.mjs`（P6b）。
> **注意**：R-1 与 R-8 的复现需要真跑（前者构造一次 `register()` 抛错，后者构造一条带 `..`/盘符的请求），
> 不能只看 `git grep` 就下结论。

---

## 14. 待决策清单（**2026-10-16 复核：开工闸门项 `D-6` / `D-7` / `D-13` 全部定案；`D-9`（P-D 前置）与 `D-17`–`D-19`（P-F 组件行统一的**剩余**前置；`D-15` / `D-16` 已定案见下表）待定**）

| # | 决策 | 状态 |
|---|---|---|
| D-1 | 目标形态 | **多包**（主包 + 子包，版本一致）。**已就地改写 ADR-0013 的 D6 / D8**（§1.2） |
| D-2 | 行标识兼容 | **保留老行 id 与 name**（零迁移，§3；**仅指已发布的主行** —— 组件行从未发布，见 §3 的"已作废"块与 §15.1） |
| D-3 | "一次安装"语义 | **A：主包 patch 引用子包**（三通道可用，§2.3） |
| D-4 | 共享内核怎么给子包 | **已被取代（2026-10-15）**：① Service 定案（§5.1）；原"② 叶子 import（先）"作废，理由 = 叶子 import 是模块图上的边、`inject` 才是 Cordis 的级联判据 |
| D-5 | 第三方代码 | **主包持有 npm 依赖 `webwallgl`、不随子包**（§9.4；形态已随上游 npm 化更新） |
| D-6 | 配置项 = 代码归属还是状态归属 | ✅ **已定案（2026-10-16，用户口径）：A 代码归属** —— 键与状态留主包唯一内核，随包走渲染器 / 描述符，代码注释必须明文重述；面板结构与包结构解耦（§6.1 表态块 / §7.3） |
| D-7 | 设置簇要不要按插件重画 | ✅ **已定案（2026-10-16，用户口径）：暂定维持现设置簇** —— 分区表与对账口径不动（零存档迁移）；原则 = 面板结构与包结构解耦，将来重画与本轮拆包是两件事（§6.3 表态块） |
| D-8 | 跨包贡献 / 服务面形状 | **已被取代（2026-10-15）**：跨包通道 = **Cordis Service**（§5.1 ①，服务名 `wallpaperEngineHost`）；"宿主注入显式键集"降级为**包内**形态（组件门面 `c` 契约） |
| D-9 | 预设怎么跨包 | **阶段前置：P-D 之前必须表态**（§6.4 / §7.4） |
| D-10 | 目录布局 | **定案（2026-10-14）：同仓 `packages/<pkg>/`**（§8.1；不用 workspace 协议） |
| D-11 | 从哪个子包开始 | **建议三个小包试点**（§7.1） |
| D-12 | **开关档位 / 重启边界**（"不用重启"的射程） | **已定案（本轮细化）**：开关只承诺**能力**（同行切换宿主半边 + 浏览器可见面，§1.1 边界 1、§11）；**代码 / 版本 / 清单 / 增删行一律重启**（`U3` / `R3` / `I8`，§1.1 边界 2）。判据 = §7.6 第 4 条 |
| D-13 | **主包被关掉时的用户可见语义**（§6.5） | ✅ **已定案（2026-10-15，用户口径）：B 明确连坐** —— 主包被关掉 = 整包被关掉，理由是大批组件在机制上依赖主包（配置模板逻辑 / `applyComponent` 门面 / §5.1 ② 的子包→主包 value import），见 §6.5 的表态块。**残余开口** ✅ **已裁决（2026-10-16）**：不自动撤子包行（`inject: ['wallpaperEngineHost']` 级联 park 已覆盖"半死状态"，自动撤行撞 §2.4 / `I8`）；"整族已停用"由主包行状态面渲染（复用 D3③）；判据归 §7.6 第 4 条整族实例 —— 见 §6.5 的 2026-10-16 裁决块 |
| D-14 | **字体系统子插件的收口形态** | **定案（2026-10-15，用户口径 A）：目标 = 整个「字体自定义」配置类**（宿主半边 + 浏览器半边 + 外观页签字体节 + 字体键所有权）；**不必现在完成** —— 收口线 = P-B 的能力 + P-C（§6.1 / §6.3 表态）+ P-D（§6.4 预设）之后，见 §7.8 |
| D-15 | **组件行统一后的行名** | ✅ **已定案（2026-10-16，用户口径）：组件行从未发布 ⇒ 沿用清单里已有的真名 `dsh-plugin-wallpaper-engine-<sub>` 做行 `name`，`id` 不变，零迁移**（§15.1 / §3 范围勘误） |
| D-16 | `visibility.js`（97 行）归属 | ✅ **已定案并落地（2026-10-16）**：移到 `lib/component-visibility.js`（顶层语义名，与 `lib/inventory.js` 同族），`lib/components/` 目录删除；`lib/index.js` 的再导出位置不变（§15.6 P-F-2） |
| D-17 | 组件浏览器半边是否本轮搬进包 | 待定（§15.6 P-F-3；建议拆 2a `about-notice` / 2b `mascot-avatar` 两批，`media-bridge` 交 P-D） |
| D-18 | **统一后的发布形态排期** | 待定（§15.6 P-F-4；统一 ⇒ 主包必须**精确依赖**这 3 个包 ⇒ ADR-0014 `S8.2`「发布形态尚未执行过」由"没做过"变"必须做"，§12 的发布顺序要排期） |
| D-19 | ADR 术语二分与触发线 | 待定（§15.6 P-F-5；ADR-0014 `S1.1` 的"组件行 / 子包"二分可删、ADR-0014 前言"问题 1 / 问题 2"结案、ADR-0013 §重新考虑的触发线是否补说明） |

### 14.1 源码注释里的阶段号 `P2-*`（`P2-7A`）—— **暂保持现状（2026-10-15 用户裁决）**

- **事实**：`lib/**` 与 `packages/**` 的注释里有一批 `（P2-7A / ADR-0013 D12）` 形态的标签。复算：`git grep -n 'P2-7A' -- lib packages`（2026-10-15 = `lib/**` 21 处：`lib/routes/*` 15 + `lib/kernel/component-session.js` 1 + `lib/components/**` 5；`packages/fonts/lib/routes/*` 2 处）。
- **它是什么**：`P2-*` 是**历史重构阶段号**（`P2-7` = 契约收紧 / 路由族注入契约声明制，见 `docs/CHANGELOG.md`），**不是条款号** —— 全仓没有 `P2-7A` 的条款正文。同一行里的 `ADR-0013 D12` 才是可查的稳定条款（已具名）。
- **为什么不改引 `S*`**：没有对应条款可引，硬套等于伪造条款号；整条删掉又会丢「这批注释是哪一轮立的」这层历史锚点。
- **裁决**：**暂保持现状，不逐个改**。第二条理由：它是全仓惯例（上面 23 处里 21 处住主包），只改其中几处会让同一惯例出现两种写法。
- **与 ADR-0014 S9.1 的关系**：`docs/adr/0014-subpackage-contract.md` 的 §现状偏差表已把这类阶段号（连同 `mNNNNN` 消息引用）**排除在 S9.1 计数之外** —— S9.1 管的是「引用 `docs/wip/**` 这类会腐化的位置」，阶段号不属于该类（它只指向历史轮次，不指向任何会改的文件）。
- **复核触发线**：只有把「统一阶段号命名」单独立项时才动，且必须**全仓一单**（候选做法：全删阶段号只留 `ADR-0013 D*`，或整批保留作历史锚点）；**不要在子包拆分的其余收口里零散改**。

---

## 15. 组件行统一（`lib/components/<sub>/` → `packages/<pkg>/`）：计划与须知

> **本节是 §7.9（P-F）的开工手册**：时机按 **A**（账① 一次独立机械提交，排在 P-D 之前）；
> 须知是搬迁时的**硬约束**与**静默陷阱**。**批 1 / 批 2a / 批 1c 已开工**：`about-notice`（2026-10-16）、
> `mascot-avatar`（2026-10-16，批 2a）与 `media-bridge`（2026-10-16，批 1c）均已出户
> （见 §15.2 的三份落地账）⇒ **账①（包边界）在三格上全部落完**，`lib/components/` 目录已删除（`visibility.js` → `lib/component-visibility.js`）；
> 未做的是 **账③**（组件的浏览器半边独立成产物）。
> 本节所有路径与行号都是 2026-10-16 的实测读数；数值一律给复算命令（`docs/README.md` 写作纪律 4）。

### 15.1 前提勘误：组件行**从未发布** ⇒ 零迁移代价

- **实测**：已发布面**只有主行一行** —— `npm view dsh-plugin-wallpaper-engine time --json` 显示
  `1.3.3` 发布于 `2026-10-15T09:27:18Z`；`npm pack dsh-plugin-wallpaper-engine@1.3.3` 解包后
  `cordis.patch.yml` 里只有 `- id: wallpaper-engine`（唯一 `- insert:` 块内），且包内**没有** `lib/components/`。
- 三条组件行今天用**子路径名**引用，但这三个**真包名**（`dsh-plugin-wallpaper-engine-<sub>`）在 registry **全部 E404**
  ［复算：`npm view <name> version`］⇒ 它们从未被发布，也从未被 `node_modules` 解析过。
- ⇒ **不存在"曾关过该组件"的用户**（用户口径，2026-10-16）：§3 的"保留 `id` 与 `name`"
  （`writePluginEnabled(filename, id, name, enabled)` 按 **id+name** 匹配覆盖项）**对这一族不适用**。
  搬迁时行 `name` 直接改成**真实包名**、`id` 保持（§3 末尾"先把 `id` 定死"），**零迁移代价**成立。
  本节因此**不再有"迁移逻辑"这笔账**（原分析里的账②作废，见 §15.2 表）。

### 15.2 三笔可分离的账（账②已作废）

| 账 | 做什么 | 行为变化 | 顺序 |
|---|---|---|---|
| ① **包边界与代码归属**（**含一步接线**） | 步 0 接线：组件入口改走宿主服务面（`inject: ['webServer','wallpaperEngineHost']` + `ctx.wallpaperEngineHost.keys(id, ctx)`），主包服务面加组件所需的键/源型，主包门面以**裸包名** import 出户组件并加 `devDependencies` `file:` 条目 + 重算 lock；批 1 搬迁：`lib/components/<sub>/**`（源码 + 清单 + 图标 + locale）搬进 `packages/<pkg>/lib/**`，主包 `exports` 子路径三连与 `files` 里的 `lib/components/` 收紧 | **纯搬移部分无**（ADR-0013 D14 `:165-167`：`"归属搬移不是行为改动"`）；**接线部分是行为等价的重写**（组件不再直接 import 主包模块，改由服务面注入同一批绑定） | 先行（步 0 → 批 1）；**三格已全部落完**（批 1 `about-notice` / 批 2a `mascot-avatar` / 批 1c `media-bridge`，2026-10-16） |
| ~~② 行名迁移~~ | ~~改为真名 + 保留子路径兼容~~ | **作废**（§15.1：无老用户 ⇒ 无兼容负担） | —— |
| ③ **浏览器半边独立成产物** | 主包 `src/**` 里的组件 UI 搬进各自包：`src/**` + `client.build.json` + 产物 `lib/client.<pkg>.js` + 面板节注册（模板 = P-C 第一刀 `packages/fonts`，§7.3 落地账） | **有**：组件行变成**包级**客户端 graph row ⇒ 关行即不再下载 / 不再绘制 | 批 2（逐组件） |

- ③ 的**副作用必须是知情选择**：ADR-0013 **D16 / D17**（`:192-197`）明确"不做浏览器侧关掉即不下载 /
  不做每组件一格开关"，但把浏览器半边搬进包 ⇒ 客户端 graph row 天然是**包级**的，等于**顺带拿到**这两件事的一半。
  同时它把"关一行会不会留下界面"从"不可能"变成"必须判"（§13 #14 的形态：要么自带半边，要么明说不可单独开关）。
- 三条组件 `package.json` 的 `name` **今天已经是真包名**（`dsh-plugin-wallpaper-engine-<sub>`）。**批 1c 收口后**
  这句话的"半分片"部分已不成立：三格都住 `packages/<pkg>/`、都有自带 `cordis.patch.yml` 与主包 patch 的**真名行**、
  都由根 `devDependencies` 的 `file:` 链接被 `node_modules` 解析（开发期形态，§8.1）；**仍未做**的是**发布形态**
  （`dependencies` 精确版本 + 真发布，§12 / `D-18`）—— 所以准确说法是"**已出户的组件包，未发布**"。

> **落地账 · P-F 批 1 试点（`about-notice`，2026-10-16，已提交 `844168ff`）**
> - **步 0 接线**：`lib/subpackage-boot.js` 取值分派扩到七型（`boot:` / `session:` / `data:` 三型为本轮新增）、
>   `HTTP_VIEW` 增 `CONTROL_JSON_MAX_BYTES`、新增 `HOST_VIEW` / `SESSION_VIEW` / `DATA_VIEW`，
>   键表登记 `'about-notice'`（9 键）；组件入口 `export const inject = ['webServer', 'wallpaperEngineHost']`
>   并**只**从 `ctx.wallpaperEngineHost` 取依赖（零主包说明符，`verify-subpackage-purity.mjs` 自动发现即判）。
> - **搬迁**：`packages/about-notice/{package.json, cordis.patch.yml, icon.png, locale/{en,zh}.json, lib/index.js, lib/routes/{about-qr.js, github-stars.js}}`；
>   两条路由族不再 import 主包 `lib/json-response.js`，应答通道改由调用点注入的 `http.sendJson` 提供。
> - **主包侧**：根 `cordis.patch.yml` 该行 `name` 改真名（`id` 不动）；根 `package.json` 删掉 `./about-notice` 三连
>   `exports`、`devDependencies` 加 `file:packages/about-notice` 并重算 `package-lock.json`；
>   `lib/index.js` 门面改**裸包名**静态 import（注释写明"这是**宿主装载面**、不是跨包通道"），
>   `applyComponent()` 的依赖面改为**迁移窗口三元式**（出户的取冻结键表、未出户的沿用旧字面量；三格全出户后连字面量一起删）；
>   `lib/host-boot.js` 的 `ComponentDeps` typedef 放宽为"四条具名键**可选** + 开放记录"（如实描述两种形状）。
> - **判据随之重定基**：`verify-subpackage-manifests` / `verify-inject-contracts` / `verify-component-visibility` /
>   `verify-component-face` / `verify-bundle-rows` / `verify-about` / `verify-subpackage-boot` /
>   `verify-subpackage-toggle-roundtrip` / `verify-guard-map` / `test/tools/host-route-index.mjs` 的组件口径；
>   两份生成物重算（`docs/ROUTE-INDEX.md`、`docs/GUARD-MAP.md`）。
> - **读数**：`verify` 72/72 · `docs` 6/6 · `smoke` 6/6 · `npm run verify:static` ALL PASSED。
> - **仍未做**：`mascot-avatar`、`media-bridge`（后者须排在 P-D 之前）；账③（浏览器半边）未动。
> - **提交**：`844168ff`（2026-10-16，已推送；CI run 38898113569 两腿绿）。

> **落地账 · P-F 批 2a（`mascot-avatar`，2026-10-16，已提交 `17221f1b`）**
> - **搬迁**：`packages/mascot-avatar/{package.json, cordis.patch.yml, icon.png, locale/{en,zh}.json,
>   lib/index.js, lib/routes/{avatar.js, mascot.js}}`；`lib/components/mascot-avatar/` 已删 ——
>   `lib/components/` 当时只剩 `media-bridge/` 与松散的 `visibility.js`（随后两批已把该目录清空）。
> - **步 0 接线复用批 1 的服务面**：键表登记 `'mascot-avatar'`（**6 键**：`base` / `pluginName` /
>   `componentViewFrom` / `createComponentSession` / `runComponent` / `handOffTeardown`；它不用
>   `log` / `pluginDataDir` / `configPath` / `repoSlugFromPkg` / `CONTROL_JSON_MAX_BYTES`）；
>   两条路由族同批 1 改法（删主包 import、`DEPS` 增 `http`、应答走 `http.sendJson`、收体走 `http.bodyReader`）。
> - **⚠️ 顺带修掉的一处隐疾（批 1 遗留）**：`applyComponent()` 这条**门面装载路径**的依赖面原先只有
>   `subpackageKeys()`，而组件入口给路由族的 deps 里还有 `http`（`host.http`）⇒ 经门面 boot 时路由族
>   拿不到应答通道，`/avatar` `/mascot` 全 500（`verify-scene` 14 条红）。修法：门面把 `httpView`
>   （`lib/subpackage-boot.js` 导出，与组件入口那份**同一对象**）一起拼进依赖面。
>   **教训**：出户组件的依赖面有**两条装载路径**（cordis 行 / 门面 `applyComponent`），任何一方少键都只在
>   走那条路时才红 —— 批 1 的 `about-notice` 当时就有同一处隐疾，只是没有守卫走那条路打到它。
> - **判据重定基**：`verify-contracts`（头像/立绘两条族的读点与 `http.sendJson` 别名正则）、
>   `verify-guard-map`（零覆盖例外键改 `packages/mascot-avatar/lib/index.js`）、
>   `verify-settings-schema-exports`（公开入口地板按出户进度收缩：`>= 4` → `>= 2`）。
> - **生成物重算**：`docs/ROUTE-INDEX.md`（43 条路由 · `/mascot` `/avatar` 归到新落点）、`docs/GUARD-MAP.md`。
> - **读数**：`verify` 72/72 · `docs` 6/6 · `smoke` 6/6 · `all` 85/85 · `npm run verify:static` ALL PASSED
>   （`lib/client.js` 未被 build 改动）。
> - **仍未做**：`media-bridge`（须排在 P-D 之前）；账③（组件浏览器半边）未动。

> **落地账 · P-F 批 1c（`media-bridge`，2026-10-16，已提交 `6dfb431d`）**
> - **搬迁**：`packages/media-bridge/{package.json, cordis.patch.yml, icon.png, locale/{en,zh}.json,
>   lib/{index.js, backend.js, legacy.js, provision.js, supervisor.js, audio-tap.swift},
>   lib/routes/now-playing.js}`；`lib/components/media-bridge/` 已删 —— **`lib/components/` 当时只剩松散的
>   `visibility.js`（无子目录）⇒ 账①（包边界）在三格上全部落完**（该目录随后删除，见 §15.6 P-F-2 / D-16）。
> - **两处 `..` 级数修正（本批唯一"非逐字搬移"）**：`lib/legacy.js` 的 `TAP_SWIFT` 由 `SELF_DIR,'..','..'`
>   改 `SELF_DIR`（`audio-tap.swift` 同批随包走：主包 `lib/audio-tap.swift` → 包内 `lib/audio-tap.swift`，
>   根清单 `files` 里的 `"lib/audio-tap.swift"` 随之删除）；`lib/provision.js` 的 `PLUGIN_ROOT` 由
>   `SELF_DIR,'..','..','..'` 改 `SELF_DIR,'..'`（= **本包根**：开发期 `packages/media-bridge/`、安装期
>   `<profile>/node_modules/<pkg>/` —— 主包与子包在安装形态下是两个目录，旧级数会指到主包上）。
> - **键表登记 `'media-bridge'`（8 键）**：`base` / `pluginName`（`const:`）、`configPath`（`data:`）、
>   `CONTROL_JSON_MAX_BYTES`（`http:`）、`componentViewFrom` / `createComponentSession`（`session:`）、
>   `runComponent` / `handOffTeardown`（`boot:`）—— 唯一同时要 `configPath` 与 `CONTROL_JSON_MAX_BYTES` 的格子
>   （两者都不在 `KERNEL_STABLE_FACE` 上、也不在 `hostKernel` 返回对象里 ⇒ 只能由 `data:` / `http:` 源型供给）。
>   路由族改经注入面（`DEPS` 增 `http`、`http.sendJson` / `http.bodyReader`），与另两格同形。
> - **"组件行"类别退役（三格全出户后）**：`verify-route-ownership`（声明面驱动 + 出户包 `walkFiles` +
>   每条出户包 `files` 覆盖）、`verify-route-index`（⑤ 段改声明面 + 子包循环跳过已出户组件）、
>   `verify-subpackage-manifests`（子路径分支改"0 条 = 已统一"，负对照改用**合成夹具**继续喂
>   `manifestViolations`）、`verify-child-kill`（扫描面加 `packages/*/lib/**`，files 地板 60→80）、
>   `verify-scene-live`（返回媒体源候选面 + 顺带修掉一处**既有潜伏 bug**：`mediaSrcPath` 回落到自身导致
>   `RangeError: Maximum call stack size exceeded`）、`test/tools/packages.mjs` selftest（发现层不再有
>   `kind==='subpath'` ⇒ `subNoClient` 改从任意 kind 找；⑥ 负对照断言"改名 ⇒ 行认领整条因果链"）、
>   `verify-guard-map`（删掉 `verify-route-ownership` 的元守卫例外 —— 它现在**直读**模块了）。
> - **生成物重算**：`docs/ROUTE-INDEX.md`（五条媒体路由归 `packages/media-bridge/lib/routes/now-playing.js`）、
>   `docs/GUARD-MAP.md`（模块 159 · 守卫 88 · 零覆盖 5）。
> - **读数**：`verify` 72/72 · `docs` 6/6 · `smoke` 6/6 · `all` 85/85 · `npm run verify:static` ALL PASSED
>   （ESLint 283 文件 / 0 规则超限 · tsc 0；`lib/client.js` 未被 build 改动）。
>   **注**：`verify:static` 必须在宿主 `pwsh` 跑（沙箱下 ESLint 的 `spawnSync` 管道报 `EPERM`，是环境边界不是回归）。
> - **仍未做**：账③（组件浏览器半边独立成产物：`about-notice` 35 行 → `mascot-avatar` 1542 行 →
>   `media-bridge` 交给 P-D）；`visibility.js` 归属**已结案**（§14 `D-16`）；发布形态排期（`D-18`）。

> **落地账 · 自检加固：宿主根腿（2026-10-16；随本笔提交入库）**
> - **起因（真机事故）**：三条组件行的 `name` 改成裸真名后，profile 侧没人重跑
>   `scripts/dev-link-subpackages.mjs` ⇒ 宿主按裸包名从 `<profile>/cordis.yml` 旁解析（§8.1 spike）失败，
>   三行 `failed to import`（UI 只给一行 warning）；而主包自检的解析根是**本仓** `node_modules`
>   （开发期 `file:packages/*` 自链恒在）⇒ 报"自检通过"。**这是 §7.6① 只有一条腿的结构性盲点**，
>   不是某一行配置写错。
> - **改动**：`lib/subpackage-boot.js` 新增 `dshHomePath()` / `hostRoots()` /
>   `assertSubpackagesResolvableInHost(rows, { mainName, env, resolveInRoot })`（导出），文件头"四个面"→"五个面"；
>   `lib/index.js` 的 0b 段拆出 `rootManifest` / `subpackageRows` 两个常量并**两条腿都调用**（`provide` 仍最前）。
>   解析根 = 每个"会装载本主包的 profile"（`<DSH_HOME>/profiles/<名>` 且含 `package.json` 与
>   `node_modules/<主包名>`）的 `cordis.yml` 旁；探不到任何根（CI / 没装过 DSH 的机器）⇒ **静默退化**；
>   `DSH_WE_SKIP_HOST_CHECK=1` 是唯一旁路（用于确知环境特殊时恢复启动）。
> - **判据**：`test/verify-subpackage-boot.mjs` 新增 ②b 段（合成 `$DSH_HOME` 的发现口径正/负两态、
>   默认解析根真 fs 正/负两态、两条腿的接线与顺序、旁路开关、真源码变异体），并同步扩了文件头的判据口径。
> - **读数（2026-10-16 实测，复算见下）**：`node test/verify-subpackage-boot.mjs` = ALL PASSED（34 条）；
>   `node test/run-guards.mjs all` = 全部 86 步 exit 0；真机探针 = 装载根 `["desktop","web"]`、六行全解析、
>   人造缺行立刻抛错并指认 profile 名 + 包名。
> - **复算**：`node test/verify-subpackage-boot.mjs`；人造缺行探针见本块（`env.DSH_HOME` 指向合成 home）。

### 15.3 时机（A）与分批

| 选项 | 内容 | 判定 |
|---|---|---|
| **A（取）** | ① 作**独立机械提交** → P-D → ③ | §7.4 的 P-D 要"**以 `packages/media-bridge` 为基础大改**"：先搬后改写**只付一次路径成本**；反序要让 media-bridge 的实现与其测试改两遍 |
| B | 与 P-D 合批 | **不取**：机械搬迁与行为重写混进一个提交 ⇒ `bisect` / `revert` 失能、review 噪声吞掉机械改动 |
| C | 排在 P-D 之后 | **不取**：二次改动（P-D 在旧路径上动刀）+ 双位置术语债继续付 |

分批（每批独立提交、独立验收）：

1. **批 1（账①，机械）** —— 实际按**逐组件**落（一次一格，守卫与生成物每格重定基一次）：
   1a `about-notice`（2026-10-16，已提交 `844168ff`）、1b `mascot-avatar`（2026-10-16，已提交 `17221f1b`）、
   1c `media-bridge`（2026-10-16，已提交 `6dfb431d`，含 D-16 `lib/visibility.js` → `lib/component-visibility.js` 归位）。每格 = 该组件并进 `packages/<pkg>/lib/**` + 主包 patch 该行 `name` 改真名
   + 主包 `files` / `exports` 收紧 + 判据与工具重定基（§15.5）+ 两份生成物重算 + 文档散文面同批改
   （含本文件 §3 / §9.3 / §10.1）。**三格落完 ⇒ 批 1 收口**（`lib/components/` 目录随后删除，`visibility.js` → `lib/component-visibility.js`）。
2. **批 2a**：`about-notice` 浏览器半边（今天只有 `src/about-assets.js` —— 最小的试验田）。
3. **批 2b**：`mascot-avatar` 浏览器半边（`src/avatar-import.js` / `avatar-layer.js` / `ext-avatar.js` / `panel-tabs-mascot.js`）。
4. **`media-bridge` 的浏览器半边不单列**：它今天**没有**浏览器半边（`lib/types/index.d.ts:166` 明写
   "media-bridge is deliberately absent"）⇒ 交给 P-D。

### 15.4 落点硬约束（照做，否则是静默事故）

1. **必须落 `packages/<pkg>/lib/**`**：`test/tools/guard-targets.mjs:128-136` 的 `moduleSurface()` = `walk(src)` +
   `walk(lib)` + 每个 `packages/<pkg>/{src,lib}`（`:112-118` 的 `packageDirs()` 只认 `packages/` 下的直接子目录）。
   若按今天的 `main: "index.js"` 把 12 个 `.js` 落在**包根**，整片掉出模块面 ⇒ **守卫静默失去覆盖率**
   （`:124-126` 的注释警告的就是这件事）。落 `lib/**` 则模块数不变，只需重算 `docs/GUARD-MAP.md`。
2. **路由族必须落 `packages/<pkg>/lib/routes/<族>.js`**：`test/tools/host-route-index.mjs:187-211` 的候选面只有三层
   （`lib/routes/*.js`、`packages/<p>/lib/routes/*.js`、`lib/components/<c>/` 的直接子文件）。落别处 ⇒
   `docs/ROUTE-INDEX.md` **静默少行、不报错**（`:52-60` 的路由行与 `:91-95` 的模块行）。
3. **新包补齐 ADR-0014 `S2.1` 六件**（`package.json` / `cordis.patch.yml` / `icon.png` / `locale/{en,zh}.json` / `lib/` + 自产产物）；
   自带 patch 与主包 patch 里那一行**逐字一致**（`S4.2`）；清单补 `dsh.bundle.patch`；
   有浏览器半边时按 `S10.2` 补 `dsh.client` + `exports['./client']` + 包内 `client.build.json`（两向齐，缺一判红）。
4. **`visibility.js`（97 行）归属 —— ✅ 已拍板并落地（2026-10-16）**：它不属于任何组件（其注释显式排除 media-bridge），
   今天由 `lib/index.js` 再导出。候选：留主包内核面（如 `lib/kernel/`）并保持再导出位置，或改成"包自带可见面声明"（待 P-D）。
5. **`test/tools/source-locator.mjs:101-104` 的 `moduleFace()` 只枚举 `lib/**` + `src/**`**（不含 `packages/`）⇒
   搬走的文件掉出 `locate()` 的符号面。今天**不红**，属静默弱点：要么扩面，要么**显式记一条理由**
   （`test/verify-guard-chain.mjs` 的 `OFF_CHAIN_WHY` 是同类判例）。
6. **三条组件守卫重定基**（真源从 `lib/components/` 换到包面，判据本身要留着）：
   `test/verify-route-ownership.mjs`（M10「实现归属唯一」`:274-277`）、`test/verify-component-face.mjs`（M9）、
   `test/verify-component-visibility.mjs`（D3 可见面双向对账）。
7. **`test/verify-subpackage-manifests.mjs` 的 subpath 分支**是"组件行"形态的唯一守卫；搬完后
   `subs.length >= 1`（`:237`）那一支会空。**建议保留成反向断言**（"禁止再出现子路径组件行"）而不是删掉 ——
   否则双位置结构将来可以无声漂回。
8. **`lib/subpackage-boot.js` 的 `assertSubpackagesResolvable()` 失败文案**说"检查主包 `package.json` 的 dependencies 是否精确依赖"，
   而开发期形态实际是 `devDependencies` + `file:packages/<pkg>`（发布形态未执行，ADR-0014 `S8.2`）⇒ 顺手改成两态口径。
   ✅ **已处置（2026-10-16）**：文案已改两态；**更进（同日）** —— 只改文案救不了真机事故，因为那段文案属于
   **仓库腿**，而三条组件行失败在**宿主侧**（profile 缺 junction）⇒ 新增宿主腿
   `assertSubpackagesResolvableInHost()`（§7.6① 第 1 条 / §15.2 末块落地账）。

### 15.5 判红面（同批必改）与自动适应（不用改）

**必红**（判据 / 工具 / 硬编码路径；Lead 普查 2026-10-16 实测）：

- **守卫**：`test/verify-route-ownership.mjs:170-171,173,183,221-234,274-277`、
  `test/verify-component-face.mjs:194-202,209-215,294`、`test/verify-component-visibility.mjs:103-108,409,433,458,459-464`、
  `test/verify-subpackage-manifests.mjs:71,145,148,179-196,233-237,247`、`test/verify-guard-map.mjs:82,142`。
- **硬编码 `readFile` / 静态 `import`**：`test/verify-about.mjs:66,117,123,129,319,321`、
  `test/verify-media-bridge.mjs:57,61,62`、`test/e2e-web-media-origin.mjs:81`、
  `test/verify-cache-dir.mjs:297,298,328`（双候选）、`test/verify-child-kill.mjs:211`、
  `test/verify-contracts.mjs:73-74,227,259`、`test/verify-scene-live.mjs:343-350,2185-2189,2474-2481,2503,2511,2566`
  （`:2511` 会直接抛 `ENOENT`）、`test/verify-bundle-rows.mjs:870`（行数账）。
- **源码接线**：`lib/index.js:99,100,102`（三个静态 import）、`:109`（`visibility` 再导出）、`:460/:465/:525`
  （`applyComponent` 分发与 `componentImpls()` 表）；`lib/kernel/component-session.js:98,106`；
  `test/verify-retired-lines.mjs` 的扫描面地板（§10.1 #7）；`package.json`（`exports`、`files`、`devDependencies`）。
- **生成物**（禁手改）：`docs/ROUTE-INDEX.md`（`node test/tools/host-route-index.mjs --write`）、
  `docs/GUARD-MAP.md`（`node test/tools/guard-targets.mjs --write`）；逐字对账在
  `test/verify-route-index.mjs:37-38` / `test/verify-guard-map.mjs:167` / `test/verify-types.mjs:27,308`。
- **文档散文面**（把"组件行 = `lib/components/`"写成契约）：`docs/ARCHITECTURE-SPLIT.md`、`docs/SUBPACKAGE-GRAPH.md`、
  `docs/CODE-STRUCTURE.md`、`docs/HOW-IT-WORKS.md`、`docs/DEV-GUIDE.md`、`docs/adr/0011`、`docs/adr/0013`、
  `docs/adr/0014`、`README.en.md`、`assets/about/README.md`、`lib/about/README.md`、本文件；
  账本类（中英文 `CHANGELOG.md`、以及归档的旧手册）**不改**（`docs/README.md` 写作纪律 4）。

**自动适应**（读发现层或按名字走，不用改）：`test/verify-scene.mjs:195,201`、
`test/verify-subpackage-toggle-roundtrip.mjs:88-95`、`test/tools/packages.mjs:191-209,219-240,308-309,311-318`、
`test/tools/host-route-index.mjs:290-297,307-317,340-346`、`test/verify-package-files.mjs:140-152`、
`scripts/dev-link-subpackages.mjs:34-37`；批 2 让组件包进构建循环（配方住包内 `client.build.json`，
构建器入口仍是主包的 `scripts/build-client.mjs`，§10.1 #11）。

**`test/tools/packages.mjs:53` 的 `FLOORS` 为什么不用改**：三项都数"包"、不数目录类型 ——
`packages: 6`（主包不计入）搬完仍是 3+3、`rows: 7`（行数不变）；
`clientArtifacts` 已从 3 **抬到 4**（P-F 批 1c：`main+fonts+fx+parallax` 四份产物，且
`test/verify-client-sync.mjs` 直接 import 这**同一个常量** ⇒ 两处不会再一高一低）。
前提是搬走的目录**仍自带直接位于其下的 `package.json`**（`:219-240` 只认直接子目录）。

**批 1c 实测（三格全出户 ⇒ 上表的"必红"逐条已处置）**：`verify-route-ownership` / `verify-route-index` /
`verify-component-face` / `verify-component-visibility` / `verify-subpackage-manifests` 全部改成**声明面驱动**
（`COMPONENT_VIEW_KEYS` 的键现算 + 双形态落点解析），`test/tools/packages.mjs` 的 selftest 与
`verify-guard-map` 的例外表随形态变化重定基；`lib/component-visibility.js` 仍是主包文件（不在任何包内）。

### 15.6 前置决策（开工前拍板）

| # | 决策 | 建议 |
|---|---|---|
| P-F-1 | 三个包的**包名** | 沿用清单里已有的真名（`dsh-plugin-wallpaper-engine-<sub>`）；`id` 不变（§15.1） |
| P-F-2 | `visibility.js` 归属 | ✅ **已定案并落地（2026-10-16）**：移到 `lib/component-visibility.js`（顶层语义名），`lib/components/` 目录删除，`lib/index.js` 再导出位置不变 → §14 D-16 |
| P-F-3 | 账③ 是否本轮 | 拆 2a / 2b 两批；`media-bridge` 交 P-D → 落 §14 D-17 |
| P-F-4 | **发布形态排期** | 统一后主包必须**精确依赖**这 3 个包 ⇒ ADR-0014 `S8.2`「发布形态尚未执行过」由"没做过"变"必须做"；按 §12 顺序（先发子包 → 主包 `dependencies` 加精确版本 + 删 `devDependencies` 的 `file:` + 重算 lock → 再发主包）。**可先只落开发期形态**（`devDependencies` + `file:packages/<pkg>`）→ 落 §14 D-18 |
| P-F-5 | ADR 动作 | ADR-0014 `S1.1` 的"组件行 / 子包"术语二分可删（统一后只剩一种）；ADR-0014 前言"问题 1 / 问题 2"结案；ADR-0013 §重新考虑的触发线是否补"组件级 `dsh.client` 的前提已变"→ 落 §14 D-19 |
| P-F-6 | `lib/subpackage-boot.js` 的 `assertSubpackagesResolvable()` 失败文案 | ✅ **已落地（2026-10-16）**：文案已改两态口径 —— 开发期 `devDependencies` + `file:packages/<pkg>` 链接 / 发布期 `dependencies` 精确版本。**同日追加**：文案讲的是**仓库侧**形态，真机事故失败在**宿主侧**（profile 缺 junction）⇒ 同批加了宿主腿 `assertSubpackagesResolvableInHost()`（§7.6① 第 1 条；判据 `test/verify-subpackage-boot.mjs` ②b 段） |
| P-F-7 | **门面路径 `applyComponent()` 保留还是退役** | **取保留**（已按此落地）：它今天在 `lib/**` 里**没有运行期调用者**，承重面是"声明面 + 守卫/fixture"；退役要连带改写 `verify-bundle-rows` 的 ⑥/⑧、`host-route-index` 的 `c` 面推导与 `componentProbe` 语义。代价：主包必须以**裸包名** import 出户组件 ⇒ 主包 → 子包的 value import，需要在 ADR-0014 `S5.3` / `D2` 的禁止清单里写明**例外口径**：「这是**宿主装载面**，不是跨包通道」（发布形态下正是 §12 的"主包精确依赖子包"） |
| P-F-8 | **守卫里的"组件行"类别整体退役还是保类别重定基** | **已按"整体退役"落地（批 1c，三格全出户后）**：守卫改由 `COMPONENT_VIEW_KEYS` **声明面**驱动（"是不是组件"不再由落点目录回答），`host-route-index` 的 `kind === 'subpath'` 在本仓成为空集（预期形态）；`verify-subpackage-manifests` 的 subpath 分支改成「**0 条 = 已统一**」+ 用**合成夹具**继续喂 `manifestViolations()`（判据的牙不随用例消失）。**未删**的残留：`name/rule-subpath` 那支判据代码仍在 `test/tools/packages.mjs`（无生产用例，留给将来又按旧形态登记的情形） |

### 15.7 复算入口

```powershell
npm view dsh-plugin-wallpaper-engine time --json            # 已发布版本与时间（1.3.3 = 2026-10-15T09:27:18Z）
npm pack dsh-plugin-wallpaper-engine@1.3.3                   # 解包后：patch 只有一行、无 lib/components/
npm view dsh-plugin-wallpaper-engine-about-notice version    # 期望 E404（mascot-avatar / media-bridge 同）
git grep -n "lib/components" -- lib src test scripts package.json   # 引用面（lib/client.js 是构建产物，须排除）
node test/tools/packages.mjs            # 包 / 行 / 产物发现层（带地板与负对照）
node test/tools/guard-targets.mjs       # 模块面（复算守卫覆盖率）
node test/verify-bundle-rows.mjs        # ⚠️ 脱链判据：行命名空间对账（CI 不跑，必须手跑）
node test/run-guards.mjs all            # 硬档 + 软档 + docs + smoke；必须 exit 0
```

---

## 附录 A —— 现行形态的资产清单（拆包时要逐项归属）

> **不抄条数**：每一项的规模都以**符号名 + 复算命令**给（`docs/README.md` §写作纪律 4）——
> 这份清单在 2026-10-14 复核时已有若干条漂了（路由族数 / `files` 条数 / 内联模块数），
> 故本节只留符号名与类别。

- **宿主半边**：`lib/index.js`（门面）、`lib/kernel/*`（内核 / 会话 / 组件视图）、`lib/routes/*`（路由族，
  条数以生成物 `docs/ROUTE-INDEX.md` 为准）、`lib/media/*`（内核媒体文件）、
  `lib/*.js`（serve / inventory / faststart / upload-store / upload-dir / cache-dir / fs-paths / pkg-read /
  scene-manifest / shim-seed / diag-trace / http-lifecycle / http-body / json-response / wallpaper-scan /
  steam-discovery / we-assets / we-props / we-focus-guard / media-origin / mp4-vfs / startup-sweep / host-boot /
  log / notice …）、`packages/<pkg>/**`（六个独立子包：三格组件行 `about-notice` / `mascot-avatar` / `media-bridge` + `fonts` / `fx` / `parallax`；`lib/components/` 已随 `6dfb431d` 删除）、`lib/webwallgl/*`（自家模板 / 宿主桥，**不是引擎**）。
- **浏览器半边**：`src/**` 的构建期内联模块（清单的**唯一真源** = `scripts/build-client.mjs` 的 `INLINE_MODULES`）
  → 单产物 `lib/client.js`（生成物，不入库）。
- **资产**：`lib/about/**`、`lib/fontsets/**`、`lib/glass-presets/**`、`lib/types/**`；仓库根 `assets/**`（不进包）。
- **发布面**：`package.json` 的 `files`（逐文件白名单）/ `exports`（主入口 + `./client` + `./subpackage-boot.js` + patch + package.json；**组件三连已随 P-F 出户**，见各 `packages/<pkg>/package.json`）/
  `peerDependencies`（宿主 `@deepseek-ai/*` 的兼容锚）—— 逐条以该文件为准。

## 附录 B —— 上游撞车面（复算：`git merge-tree --write-tree --name-only HEAD <PR>`）

| PR | 触面 | 状态（2026-10-14 复核） |
|---|---|---|
| #195 | `lib/index.js` / `lib/routes/scene-serve.js` / `package.json` / `lib/client.js` / `src/client.js` / 引擎侧曝光打点 / 新增 `lib/occlusion/**` | **已落地**（`93594227`，是 HEAD 的祖先）⇒ 撞车面已收进本线 |
| #196 | 同上 + **删 `lib/webwallgl/**`**（引擎 vendored 副本）+ 生成物 + 多条守卫 | **已落地**（`b8174983`，是 HEAD 的祖先）⇒ 引擎已 npm 化，见 §9.4 |

**纪律**：① 不碰 PR 独占面；② 生成物一律重算；③ `package.json` 只做并集（多包化会重排 `files`/`exports`，
与"不重排"冲突）；④ 每阶段复核冲突面是否变大。

**⑤ 开工闸门（原纪律 ③）已解除**：原定"多包化必须在 #195 / #196 落地合入之后再开"，两笔现已合入。
复算：`git merge-base --is-ancestor 93594227 HEAD` 与 `git merge-base --is-ancestor b8174983 HEAD`（均 exit 0）。

## 附录 C —— 验收命令

```powershell
npm run build                      # 重建产物（多包后：多个产物）
npm run verify:all                 # 硬档 + 软档 + docs + smoke；必须 exit 0
node test/run-guards.mjs all       # 上面那条的真源（分组与步数以 test/run-guards.mjs 为准）
node test/run-guards.mjs docs      # 文档档单独跑（**全部 soft，经 warn-only 降级 ⇒ 红不拦 PR，必须自己看输出**）
node test/verify-component-visibility.mjs    # D3 的可见面双向对账
node test/verify-bundle-rows.mjs   # ⚠️ 脱链判据：行命名空间 / 路由账对账（CI 不跑，必须手动）
node test/tools/host-route-index.mjs         # 路由与行清单（现算）
node test/tools/guard-targets.mjs --write    # 生成物重算（禁手改）
node test/verify-subpackage-client-half.mjs  # §7.8：字体收口后这条必须真的管到字体包（字体已收口 2026-10-16 P-C 第一刀：本条现覆盖 fx / parallax / fonts 三者；fonts 另在必被覆盖棘轮清单 REQUIRED_CLIENT_HALF）
# §7.6 第 4 条（开关往返 / 停用零残留）的**手工**部分：在插件管理器里对**某一行的开关**做关→开→再关，
# 然后复算该行在 profile 覆盖项里的落点（把 <profile> 换成 desktop/web）：
#   Get-Content "$env:USERPROFILE\.dsh\profiles\<profile>\cordis.patch.yml" | Select-String 'wallpaper-engine'
# 期望：出现 `- id: <行 id>` + `disabled: true|false`（形态见附录 D）。⚠️ 这一档**只**证明"行开关生效"；
# §11 表里那些需要重启的动作，本命令**证明不了** —— 别把它当"改完代码已生效"。
git status --porcelain             # 期望：只剩本阶段预期改动
```

## 附录 D —— 本手册的机制取证（复算入口）

- **asar 读取**：头 16 字节；`headerSize = uint32LE@12`；`base = 16 + headerSize`；按 JSON 的 `offset/size` 直读。
  条目总数 / 包数 / 有 `dsh.client` 的包数**都随上游漂** ⇒ 不抄数，读出来现算（条目数 = 目录树叶节点数；
  `@deepseek-ai/*` 包数 = 这些叶节点 path 去重后的**父包**个数；有 `dsh.client` 的 = 其 `package.json` 里
  `dsh.client` 非空。2026-10-14 复核时它们是 12967 / 297 / 72，本行只是**当时的读数**，不是不变量）。
- **关键包**：`@deepseek-ai/dsh-app-boot`（profile / bundle / patch / 兼容性）、
  `@deepseek-ai/dsh-plugin-manager`（安装 / 开关 / `reconcile`；`ambiguous-install` 与 `bundleComponent*` 都住这里）、
  `@deepseek-ai/dsh-client-modules`（客户端 graph / 物化 / prune）、
  `@deepseek-ai/dsh-client-hmr`（重建 / 级联）、`@deepseek-ai/cordis`（fiber / reflect 级联）。
- **本机真机事实**：`$DSH_HOME/profiles/<name>/{package.json,cordis.patch.yml,pnpm-workspace.yaml,node_modules}`；
  profile 用 `nodeLinker: hoisted`；行开关的覆盖项形如 `- id: <行 id>` + `disabled: false`
  （本机 desktop profile 里能看到 `wallpaper-engine` 那一条 ⇒ 行开关有效；
  **具体哪条随用户的开关操作变，别当不变量**）。
  复算：`Get-Content "$env:USERPROFILE\.dsh\profiles\<p>\cordis.patch.yml" | Select-String 'wallpaper-engine'`。

## 附录 E —— 度量口径 M1–M10（**现行契约**）

**度量（成功判据）**：M1 门面体量 · M2 门面非装配占比 · M3 浏览器半边体量 ·
M4 跨组件共享读改写路径的设置键数（目标 0）· M5 守卫硬编码路径 / 清单条数（**加一个组件行不改工具**）·
M6 一族的文件归属唯一性 · M7 新人定位成本 · **M8 边界可声明率**（目标 100%）·
**M9 跨模块隐式共享面**（目标 0）· **M10 实现归属唯一性**（目标 0）——
**目标值是契约；"当时是多少"属历史**（见 `CHANGELOG.md` 与 git 历史）。

**口径**：不改善 M1–M10 任何一项的工作一律不做（唯一例外 = ADR-0013 D3）；**可开关本身不加分**。

**复算入口**：M1 / M2 = `node test/tools/m2-facade-code-share.mjs`；M5 = `test/verify-bundle-rows.mjs`；
M8 = `test/verify-inject-contracts.mjs`；M9 = `test/verify-component-face.mjs`；M10 = `test/verify-route-ownership.mjs`；
M3 = 构建产物 `lib/client.js` 的体积（`npm run build` 后量）。
## 附录 G —— 候选入选判据 J1–J7（**从旧文原文恢复**）

> **用途**：判定"一个功能族凭什么独立成包 / 独立成行"。本手册改写时漏带这七条，
> 导致 §7 的候选讨论（以及本仓 `TODO.md` 的"J1–J7 全过者"）引用了一个没有定义的记号 —— 现原文补回。
> 历史原件：`git show 5707d358:docs/wip/BUNDLE-SPLIT.md`。**J6 的前提（设置分区）与 J7 的前提（契约收紧）
> 都已由已完成的 P1 / P2-7 兑现**，判据本身照旧。

| # | 判据 | 反例（为什么不独立） |
|---|---|---|
| J1 | **贡献面自洽**：有自己的 HTTP 路由族（或完全不占路由）与自己的设置键簇 | `/media` 挂在媒体字节实现上（跨簇） |
| J2 | **状态自持**：自己的磁盘载体（目录 / 文件）或自己的 `config.json` 根字段 | 只有 `settings` 段里的一堆键 ⇒ 见 J6 |
| J3 | **无同进程强耦合**：不依赖别的簇的内存注册表、不共享单例缓冲 | `/diag` 环形缓冲必须与媒体源同进程（只有一个 `/diag-log`） |
| J4 | **可缺省**：关掉它，其余功能**没有可见缺失**（不是"降级"而是"不存在"） | `/inventory` 是所有簇的真源 ⇒ 关不掉 |
| J5 | **出入边少**：`import` 面自足（理想：≤ 2 个内核模块） | `lib/routes/presets.js` 需要一批注入点，横跨三簇 |
| J6 | **设置可切分**：它的键能整簇搬进自己的命名空间，且不与别的簇共享同一个**读改写**路径 | 全部键同段、`PUT /settings` 整段覆盖 ⇒ **P1 之前对谁都不成立**（P1 已兑现） |
| J7 | **依赖面可声明**：它需要的东西能写成一份**显式键集**（注入面），不靠共享可变状态、不靠直接解构内核对象 | 只有靠门面的会话状态 / `const { … } = hostKernel` 的隐式共享才跑得起来 ⇒ 先做契约收紧（P2-7，已完成） |
