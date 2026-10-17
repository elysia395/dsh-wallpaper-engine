# 文档 / 注释漂移同步报告（task-7 · docs-comment-sync）

<!-- status-banner: code-is-truth -->
> **状态：历史记录（不反映现行实现）。** 第二期 task-7（文档 / 注释漂移同步）的过程记录，已收口：
> 后续两轮见 [`./DOC-ROT-REPORT-2.md`](./DOC-ROT-REPORT-2.md)（§7 是本文的复核结论）与
> [`./DOC-ROT-REPORT-3.md`](./DOC-ROT-REPORT-3.md)；判据锚定见 [`./TEST-ANCHORING.md`](./TEST-ANCHORING.md)。
> 正文里的短哈希是**当时那条线**上的（哈希说明见手册 [`../wip/BUNDLE-SPLIT.md`](../../wip/BUNDLE-SPLIT.md) 头部）。

> **哈希说明（squash 后）**：本文件中的短哈希是 **squash 前历史哈希**。追版本第二期收口已把
> `c43a936..352467a` 的 **108 笔**压缩为一笔（父 = `c43a936`，树内容逐字未变），该提交以 tag `catchup-2nd` 标注。
> 原文可由分支 `backup/pre-squash-20261014` 取得；逐条对应见该提交正文附录。
> 新增引用请优先使用 tag `catchup-2nd`。


> **这份报告是 work item 的过程记录，不是台账**（`docs/README.md` §目录的寿命规则：过程记录住 `wip/`，
> 结论进它该住的地方）。本轮结论的落点：结构 → [`docs/ARCHITECTURE-SPLIT.md`](../../ARCHITECTURE-SPLIT.md)
> 与 [`CODE-STRUCTURE.md`](../../CODE-STRUCTURE.md)；纪律 → 不新增散文判据
> （[`adr/0007`](../../adr/0007-machine-checks-target-code-not-prose.md)）。

## 0. 范围与判据口径

- **扫的面**：`docs/**`（**不含** `docs/wip/BUNDLE-SPLIT.md` —— 归 Lead）与 `README.md`；
  顺带把 `README.en.md` / `README.beginner.md` 也过了一遍（结论：零死路径，未改）。
- **不动的**：`docs/ROUTE-INDEX.md` 与 `docs/GUARD-MAP.md` 是**生成物**，由生成器重算（Lead 收口）。
- **"漂移"的判据**（两类，逐条都要指出证据）：
  1. **指向已不存在文件的路径陈述**；
  2. **断言已不成立的结构描述**（文件还在，但"谁是谁、住在哪、由谁注入"已变）。
- **机器口径**：内联脚本对每份文档抽 `lib|src|test|scripts/**` 形态的路径引用，
  按"仓库根相对"与"相对该文档"两种解析各试一次，**两边都不存在**才算死路径。
  ⚠️ 口径细节两条：① 正则的扩展名后必须是非标识符字符 —— 否则 `.js` 会命中 `.json` 的**前缀**，
  把 `test/fixtures/harness-ui-surfaces.json` 误判成死路径（首轮扫描因此多报 60 余条假阳性）；
  ② **`origin/main:<path>` / `d561f5f^:<path>` 这类 git 对象引用不计**（前一个字符就是 `:` 的 ref 前缀）
  —— 它们指向历史对象、`git show` 可解析，不是工作树上的现址
  （`ARCHITECTURE-SPLIT.md` 的「上游位置」一列正是这个形态）。
- **改法优先级**（照 [`adr/0006`](../../adr/0006-comment-discipline-as-written-convention.md) D2 与
  [`adr/0007`](../../adr/0007-machine-checks-target-code-not-prose.md)）：**能写成"由 X 定义 / 以现算为准"
  就不写死路径**；必须写路径时，写**在 import 图上的真源**。

## 1. 代码注释：只改注释，零可执行语句

`git diff -U0` 逐行核对：两文件共 4 个 hunk，**全部落在 `/** */` 与 `//` 内**。
这批失真的共同成因是：媒体状态族**逐字搬**出户到 `lib/components/media-bridge/` 后，
注释里的"门面"没有随之改名 —— 而"门面"在本仓特指 `lib/index.js`。

| 位置 | 旧陈述为何失真 | 新陈述的事实来源 |
|---|---|---|
| `lib/components/media-bridge/now-playing.js:6` | "这**四条**路由共用…懒启动后端"，而同一句上面刚列出**五**条路由 | 该文件 5 个 `webServer.register` 调用；其中 `/media-control` 明确"不触发懒启动"（同文件 `:34` 的注释）⇒ 改为"五条里**取数的四条**" |
| `…/now-playing.js:14` | `appendDiagLine` 标"经**门面**注入" —— 本组件行不经门面 | `lib/components/media-bridge/index.js:93` 从 `createComponentSession()` 解构出 `appendDiagLine`；主包各族才是门面注入 |
| `…/now-playing.js:58` | "由**门面**自动回落到 legacy.js" —— 门面早已不持有媒体后端（同文件 `lib/index.js` 的 `3c-5` 段：整族随组件出户） | 回落判据在 `lib/components/media-bridge/backend.js:62` 的 `fallBackTo()`，由 `:35` 的 `createMediaBackend()` 持有 |
| `…/legacy.js:7` | "…时，**门面**（backend.js）自动切回这里" —— 括号里指的是"媒体后端**门面**"，但与插件门面同词，出户后极易误读成 `lib/index.js` | `backend.js:2` 自述"媒体桥的**媒体后端门面**"；`fallBackTo()` 在 `backend.js:62` ⇒ 改成"**媒体后端门面**（backend.js 的 `createMediaBackend()`）" |
| `…/legacy.js:154` | `@param audio` 标"由**门面**在构造时传入" | `backend.js:51-53` 的 `legacyBackend()` 按需构造并传 `audio`；值来自路由族 `ensureMedia()` 每次现读设置（`now-playing.js:71-83`） |

## 2. 文档：改了哪些漂移

| 文件 | 漂移种类 | 旧陈述为何失真 | 新陈述 / 事实来源 |
|---|---|---|---|
| `docs/CODE-STRUCTURE.md` §2 | 结构描述过时 | 只列"路由族 / 宿主侧套件 / 共享管道"**三类**，完全没有 `lib/kernel/*` 与 `lib/components/*` —— 而这两层（本分支 P1/P2 的产物）正是宿主半边的主体 | 改为五类（内核 / 路由族 / 组件行 / 套件 / 共享管道），并补"组件浏览器可见面单一真源 = `lib/components/visibility.js`"；真源与判据逐条点名 |
| 同上 §2 mermaid | 结构描述过时 | 画着 `lib/media/*.js` = "**媒体源**：生命周期 + 按需下载" —— 那正是已出户的媒体桥；`lib/media/` 现在只剩**内核媒体** | 删该节点，补 `lib/host-boot.js` / `lib/kernel/*` / `lib/components/<组件>/` 三个节点与真实边（组件 → host-boot，组件与路由族 → http-body） |
| 同上 §2.2 表 | **指到已不在 import 图上的同名副本** | 表里 5 行点名 `lib/media-probe.js` / `lib/wallpaper-scan.js` / `lib/cache-prune.js` / `lib/config-store.js` / `lib/scene-probe.js`，其中 4 个上游同名文件**已不在 import 图上**（当时活的是 `lib/media/mp4-probe.js` / `lib/we-discovery.js` / `lib/startup-sweep.js` + 各套件 sweep / `lib/kernel/config.js` / `lib/media/scene-probe.js`；**第二期后 `lib/we-discovery.js` 本身已被"上游两族拆分"取代**，见 §4 与该表的更新） | 逐行改到内核**真正 import** 的那个文件（`lib/kernel/host-kernel.js` / `host-session.js` 的 import 面）；并加 ⚠️"哪些是活的以 `node test/verify-reachability.mjs` 现算" |
| 同上 §2.2 表后段 | 机制归属失真 | "三个目录…都由**门面**注入…留在门面才看得住" | 路径访问器住 `lib/kernel/data-dir.js`，由内核装配时注入；锚点是 `test/verify-cache-dir.mjs` 的**读点**（该守卫已按真源改读点，见 chain-runner 的 `b40e7e5`） |
| 同上 §2.3 | 结构描述过时 | "共享可变状态…**门面仍持有一组闭包状态**"、"目录解析器 `pluginDataDir()`/`configPath()`/`cacheBaseDir()`/`repoSlugFromPkg()` 在门面"、"套件在**门面模块作用域**建好" —— 这三句在 P1 内核化后全错 | 会话段住 `lib/kernel/host-session.js`；`BASE`/`PLUGIN_NAME`/`repoSlugFromPkg` 住 `lib/host-boot.js`（`lib/index.js:65-72` 的注释与 `host-boot.js:34`）；目录解析器住 `lib/kernel/data-dir.js`（`host-kernel.js:63` 的 import）；套件在 `lib/kernel/host-kernel.js` 模块加载期建 |
| 同上 §3.2 | 结构描述过时 | `lib/webwallgl/` 被称"**vendored** 渲染页" | `d561f5f` 已把引擎改为 npm 运行期依赖 `webwallgl@^3`、删掉 vendored 副本与 `test/tools/sync-webwallgl.mjs` / `lib/webwallgl/.upstream.json`（该提交**已在上游**）⇒ 改称"渲染页适配层，引擎本体走 npm" |
| 同上 §4 第 3 条 | 结构描述过时 | 子目录现状只写 `lib/media/`、`lib/routes/` | 补 `lib/kernel/`、`lib/components/<组件>/`；并加一条"属于组件行的实现别放进 `lib/routes/`" |
| 同上 §4 第 6 条 · §7 真源表 2 行 | **死路径** | `lib/routes/about-qr.js` / `lib/routes/github-stars.js` 已不存在 | `lib/components/about-notice/about-qr.js` / `github-stars.js`（`git diff --name-status origin/main` 的 `R` 记录） |
| 同上 §4.1 扩展点 | 结构描述过时 | "一条宿主路由 → `lib/routes/<族>.js`"，组件行没有落点 | 补组件行落点与 `verify-route-ownership` |
| `docs/DEV-GUIDE.md` §1 落点 | 结构描述过时 | 同上：加路由只有 `lib/routes/<族>.js` 一个答案 | 补"属于组件行 ⇒ `lib/components/<组件>/<族>.js` 并由该行入口装配"（指向 `ARCHITECTURE-SPLIT.md`） |
| 同上 §1 同步清单 | 结构描述过时 | "在 `lib/index.js` 里把依赖传进 context"是唯一的注入点说法 | 补组件行入口，并点明 `DEPS` ↔ 调用点实参**双向对账**（`verify-inject-contracts`）——这是本分支新增的强制项 |
| 同上"读请求体"段 | **死指路（真源写错）** | "上限常量真源在 `lib/index.js`" —— 常量已搬进收体器旁边 | `lib/http-body.js`（`lib/index.js:162-163` 自己写着"定义已搬进 `lib/http-body.js`"） |
| 同上 §4.x「ESLint 抓到的真缺陷」 | **死路径** | `lib/routes/now-playing.js` 已不存在 | `lib/components/media-bridge/now-playing.js`（该族现址） |
| `docs/adr/0011-preset-full-snapshot.md` L134/136/214 | **死路径** ×4 | "复用 `lib/routes/mascot.js` / `lib/routes/avatar.js` 的落盘语义" —— 两条路由已随组件出户 | `lib/components/mascot-avatar/mascot.js` / `avatar.js`（ADR-0011 的 D4/D5 仍现行，指针必须解析得到） |
| `docs/wip/LINUX-OCCLUSION.md` L119 | **死路径** | 引 `lib/routes/now-playing.js` 作同族先例 | `lib/components/media-bridge/now-playing.js` |
| 同上 L53 | **死路径** | "上游同步后（`lib/webwallgl/.upstream.json` 变更）" —— 该文件已随 npm 化删除 | 版本真源 `package.json` 的 `dependencies.webwallgl`（`^3.0.0`，`d561f5f` 起） |
| `docs/README.md` §规范与参考 | 缺登记 | 本分支的"门面重写"没有在索引里被点名（`docs/**` 无任何记录 —— 这正是 task-7 要补的缺口） | 新增 [`ARCHITECTURE-SPLIT.md`](../../ARCHITECTURE-SPLIT.md) 一行 |
| `docs/ARCHITECTURE-SPLIT.md` | **新增**（补缺口） | — | 三段形态 / 门面剩什么 / 搬家账 / 与上游差异 / 迁移路径 / 已知缺口；左列的"上游位置"一律写成 **git 对象引用 `origin/main:<path>`**（`git show` 可解析），不冒充工作树上的现址 |

## 3. 未改（附原因）—— **不做无判别力的批量替换**

| 未改的东西 | 条数 | 原因 |
|---|---|---|
| `docs/archive/**` | 62 | [`adr/0006`](../../adr/0006-comment-discipline-as-written-convention.md) 的 Consequences 明写"**历史文档不追溯**：`archive/**` 与 `CHANGELOG.md` 里的数值保持原样。它们是账本，描述'当时如何'，改了反而是伪造记录"；`docs/archive/**` 顶部也带"不反映现行实现"的状态横幅 |
| `docs/CHANGELOG.md` + `docs/en/CHANGELOG.md` | 25 + 25 | 同上（账本）。其中多条**是搬家本身**的记录（例："`lib/components/media-bridge/` 收 `lib/routes/now-playing.js`（逐字）"）—— 那些旧路径是**搬运的源**，改掉就把记录改错了 |
| `docs/wip/COEXISTENCE-AUDIT.md` L20/42/243 | 4 | 顶部已声明"本文件是审计记录…数字与行号以复算为准"；且这 4 处**不是入库路径** —— 原文是 `.integration-notes/scratch-scripts/tmp-token-gate-scope.mjs`，扫描器只从 `scratch-scripts/` 起匹配到子串。**假阳性，未改** |
| `docs/wip/ISSUE-AUDIT-148PLUS.md` L115/141/288/211 | 4 | 前三处是**宿主 harness 包内**路径（`@deepseek-ai/dsh-client-ui-primitives/lib/{Modal,markdown/CodeBlock,Tooltip}.module.css`），不是本仓文件；末一处是被 npm 化替换掉的旧 vendored 产物名（历史取证）。**非本仓漂移，未改** |
| `docs/wip/LINUX-OCCLUSION.md` L181/182/190/192/315 | 6 | 前 5 处是**父仓 `dsh-my-ui`** 的路径（原文已写明"证据：`dsh-my-ui/scripts/prepare-dependencies.mjs`"），末一处是 URL 里的 `…/latest/ar01s03.html` 被 `test/` 前缀误匹配。**假阳性，未改** |
| `docs/DEV-GUIDE.md` L166 `src/your-module.js` | 1 | 是"加一个浏览器端模块"的**占位示例名**，不是真路径 |
| `docs/adr/*` 中描述**历史决策过程**的句子 | — | ADR 正文是决策记录；只把**仍现行**的指针改到真源（见 §2）。已 `Superseded`/已归档的正文一个字不动（`adr/README.md`：改旧 ADR 等于伪造决策记录） |
| `docs/ROUTE-INDEX.md` / `docs/GUARD-MAP.md` | — | 生成物。**需要重算**的情形已由 Lead / chain-runner 收口（`ROUTE-INDEX` 由 `c9bd23d` 重算） |
| `docs/wip/BUNDLE-SPLIT.md` | — | 归 Lead（本任务明确排除） |

| `docs/archive/wip/DOC-DRIFT-REPORT.md` **本文** | 16 | 逐条**引用旧路径作为证据**（"旧陈述为何失真"一列）—— 那是本报告的本职，不是现状断言 |

**残留死路径的机器口径合计 = 143**（`docs/**` + 三份 README，不含两个生成物与 `BUNDLE-SPLIT.md`；
git 对象引用已按 §0 口径②从扫描里排除）：
**112 在历史账本**（`archive/**` 62 + 两份 `CHANGELOG` 50，ADR-0006 豁免）；
**31 在非账本文档**，逐条都有着落 ——
**16 在本报告自身**（引用旧路径作证据）、**14 是假阳性**（COEXISTENCE-AUDIT 4 原是
`.integration-notes/scratch-scripts/…` 的子串；ISSUE-AUDIT-148PLUS 4 是宿主 harness 包内 css 路径与旧
vendored 产物名；LINUX-OCCLUSION 6 是父仓 `dsh-my-ui` 的相对路径与 URL 里的 `latest/ar01s03.html`）、
**1 是占位示例**（`src/your-module.js`）。**活跃常青文档（`docs/` 顶层 + `docs/adr/` + `README*.md`）零死路径。**

## 4. 范围外发现（当时交给对应线；其中第 2/3/4 条已按 Lead 授权在 §6 收尾）

1. **`node test/verify-reachability.mjs` 当时判红**（exit 1；**第二期已转绿 0 不可达 / 0 行，见 §7**）：
   9 个文件 / 2068 行**不在 import 图上**却仍在发布面（`files` 收 `lib/**`）。清单与谁接替了谁：
（下表是**当时**的判读；第二期收口后各项都已处置，逐项见 §7 指向的两份文件）

   | 不可达文件 | 行数 | 现在的真源 |
   |---|---|---|
   | `lib/asset-paths.js` | 189 | 目录族 → `lib/media/media-dirs.js`；上传目录解析 → `lib/upload-dir.js` 的 `createUploadDirResolution()`（**已落地**：原先内联在 `lib/kernel/host-kernel.js` 工厂体内，G-A1 提取成叶子导出） |
   | `lib/cache-prune.js` | 131 | 清扫本体 → `lib/media/transcode.js`（`sweepTranscodeArtifacts` / `sweepCustomFrameTmp`）与 `lib/media/video-preview.js`（`pruneVideoPreviewCache` / `pruneCacheDirBySize`）的返回面；时点编排 → `lib/startup-sweep.js`（**已落地**：判据改两源适配器，副本已删） |
   | `lib/config-store.js` | 132 | `lib/kernel/config.js` |
   | `lib/host-diag.js` | 130 | 待确认（`lib/diag-trace.js` + `lib/routes/diag.js` 承接了诊断面） |
   | `lib/media-probe.js` | 187 | `lib/media/mp4-probe.js` |
   | `lib/steam-discovery.js` | 266 | **原样取回**（不再是"上游副本"）：第二期按上游两族拆分接线，它本身就是真源之一 |
   | `lib/transcode.js` | 638 | `lib/media/transcode.js` |
   | `lib/video-preview.js` | 110 | `lib/media/video-preview.js` |
   | `lib/wallpaper-scan.js` | 285 | **原样取回**（同上）：真源是 `lib/steam-discovery.js` + `lib/wallpaper-scan.js` 两族（合并版 `lib/we-discovery.js` 已删） |

   影响两条：① 发布面凭空多带 ~2000 行死码；② **文档/注释若照旧文件名指路，就指到死副本** ——
   这正是 §2 里 `CODE-STRUCTURE` §2.2 那 5 行必须改的原因。处置（删副本 / 接线 / 收紧棘轮基线）属守卫与发布面那条线。
2. ~~**`lib/asset-paths.js` 的注释仍在撒谎**~~ —— **本任务已修**（Lead 授权范围外补做，见 §6）：
   `lib/upload-dir.js:5,10,57` 与 `lib/kernel/host-kernel.js:204` 已改指"内核构造点就地实现"。
3. ~~**`lib/we-assets.js:19` 注释**~~ —— **本任务已修**（同上）：改指 npm 依赖 `webwallgl` + `WEBWALLGL_PKG_DIR`。
4. **ADR 编号撞车 —— Lead 已裁决：上游 `0012` 胜出**。处置与残留（详见 §6）：
   `docs/adr/0012-bundle-multi-component-rows.md` → **`0013-bundle-multi-component-rows.md`**，
   索引与跨文件引用同步；`docs/archive/**` 与两份 `CHANGELOG` 里的 `ADR-0012` 作为**当时编号**保持原样
   （`adr/0006`：历史文档不追溯），归档目录顶部补了映射说明。
   **在飞未改**（按 Lead 的安全协议跳过 dirty 文件）：`test/verify-inject-contracts.mjs:3`、
   `test/verify-route-ownership.mjs:3` 各 1 处（当时 dirty，归其 owner 收口）；
   `docs/wip/BUNDLE-SPLIT.md`（归 Lead，其手册里的"ADR-0012 为唯一正本"表述由 Lead 维护）。

## 6. 收尾三批（Lead 追加授权）

### 6.1 ADR 重编号 0012 → 0013（"上游编号胜出"）

- `git mv docs/adr/0012-bundle-multi-component-rows.md docs/adr/0013-bundle-multi-component-rows.md`；
  文件头补 `**Renumbered**: 0012 → 0013` 并把 `Supersedes` 行的旧编号显式标成"旧 0013–0016"，避免与自身新号混淆。
- 引用面（**只改散文/注释行**）：`docs/ARCHITECTURE-SPLIT.md` · `docs/CODE-STRUCTURE.md`（仅组件行那条；
  **同文件里 `adr/0012-artifact-untracking` 那条保持 0012**）· `docs/HOW-IT-WORKS.md` · `docs/README.md` ·
  `docs/archive/wip/COMPONENT-TOGGLE-REPORT.md` · `lib/{index.js,kernel/component-session.js,routes/*.js,components/**}` ·
  `src/{client.js,panel-tabs.js,avatar-layer.js}` · `test/{verify-component-visibility,verify-scene-live,verify-scene}.mjs`。
- 两份索引：`docs/adr/README.md` §索引 新增 0013 行（0012 行保留）；`docs/README.md` 的 ADR 表
  原 `0012` 行改标 `0013`，并**补上原先漏掉的 `0012-artifact-untracking` 行**。
- 归档目录：`docs/archive/adr/**` 只改**指向现行版的指针行**（`现行版本 = ADR-0013`）与顶部映射说明；
  归档件正文里作为**当时编号**的 `ADR-0012` 一个字未动（ADR-0006 不追溯）。
- 产物：`src/**` 的注释变了 ⇒ `npm run build` 重新生成 `lib/client.js`（生成物不入库，
  由 `verify-client-sync` 真跑构建逐字节判）。
- **跳过清单（dirty / 归属）**：`test/verify-inject-contracts.mjs`（dirty，1 处）、
  `test/verify-route-ownership.mjs`（dirty，1 处）、`docs/wip/BUNDLE-SPLIT.md`（归 Lead，5 处）、
  `docs/ROUTE-INDEX.md`（归 Lead，生成物，无该引用）。

### 6.2 三条 lib 注释漂移（范围外，仅注释）

`lib/upload-dir.js`（文件头 + 注入契约 + `@param`）· `lib/kernel/host-kernel.js`（上传目录段）·
`lib/we-assets.js`（`WEBWALLGL_DIR`）—— 旧陈述都称"由 `lib/asset-paths.js` 的 kit 提供"或
"vendored 渲染页由 `sync-webwallgl` 构建"，事实是：`lib/asset-paths.js` **已删**（上传目录解析
→ `lib/upload-dir.js` 的 `createUploadDirResolution()`，G-A1 起；目录族 / WE 素材族 →
`lib/media/media-dirs.js` / `lib/we-assets.js`），vendored 副本与同步工具已随 `d561f5f` 的 npm 化删除。
改法：只改注释行（`git diff -U0` 逐行核对）。

### 6.3 清掉 `verify-module-layout` ⑧ 的 1 红（Lead 指出）

⑧ 要求"每个 `test/tools/*.mjs` 与 `test/compat-*.mjs` 都在 zh 的 DEV-GUIDE 里被点名"，
未点名的是 `child-out.mjs` / `m2-facade-code-share.mjs` / `source-locator.mjs`。
补法与依据（三个文件**都是新工具、不是散文改动**，所以补文档是唯一正解）：

| 工具 | 一句话（依据 = 各自文件头） | 归属 |
|---|---|---|
| `child-out.mjs` | 拿子进程输出的**唯一**方式：受限环境禁管道（`execFileSync`/`spawnSync` 默认 pipe ⇒ `EPERM`），判据读 runner 输出会**假红** ⇒ 收敛成 `runNodeCaptured()`（stdout 落 `.test-cache` 再读回）/ `runNodeStatus()`（只要退出码） | 被 `verify-package-files.mjs` import（守卫的库） |
| `source-locator.mjs` | **真源定位器**：符号/文件名 → 唯一声明处；0 处（改名/删除）或多处（第二份真源）即红 ⇒ 判据能写"缺锚即红"而非兜底 | 被 `guard-targets.mjs` 消费，`--selftest` 由 `verify-guard-map` ⑥e 挂上链 |
| `m2-facade-code-share.mjs` | 门面「非装配代码占比」（M2 口径）复算：顶层语句分 `assembly`（`ctx.` / `registerXxxRoutes(`）/ `code` / `other`，报 `nonAssemblyShare`；段窗走**内容锚点**，锚点全缺即非 0 退出 | 纯手动工具（无消费者） |

同时把前两个补进 §4.6 末尾那句"**同时是守卫的库**"点名表（改它们等于改判据）。

## 5. 验证证据

| 判据 | 结果 |
|---|---|
| `node --check lib/components/media-bridge/now-playing.js` | exit 0 |
| `node --check lib/components/media-bridge/legacy.js` | exit 0 |
| `node test/verify-logging.mjs`（检查门面接线形态） | `ALL LOGGING CHECKS PASSED`，exit 0 |
| `node test/verify-inject-contracts.mjs`（声明面 ↔ 消费面 ↔ 调用点三方对账） | `M8=100% (22/22 families · 声明键 207)`，exit 0 |
| `git diff -U0` 自查 | 2 文件 4 hunk，**全部在注释内**，零可执行语句改动 |
| 死路径重扫 | 见 §3 口径与合计（改动目标文件已全部不在命中清单里） |
| `node test/run-guards.mjs docs`（ADR 重编号批） | `docs 全部 6 步执行完毕`，exit 0 |
| `node test/verify-client-sync.mjs`（`src/**` 注释改动后重建产物） | `CLIENT SYNC CHECKS PASSED (5)`，exit 0（`npm run build` 亦 exit 0） |
| `node test/verify-component-visibility.mjs` | `ALL COMPONENT VISIBILITY CHECKS PASSED`，exit 0 |
| `node test/verify-module-layout.mjs`（收尾批：§4.6 点名三个工具） | `ALL MODULE LAYOUT CHECKS PASSED` —— ⑧「26 个都被点名」，exit 0（**原 1 红已清零**） |
| 重编号的改动面自查 | 49 文件里**非 `0012/0013` 的改动行逐条可解释**（只有新写的说明句与索引新增行）：无任何可执行语句、无行尾/编码变更 |
| `git grep 'ADR-0012'` 残留 | 只剩 4 类**合法**处：`0012-artifact-untracking` 自身 · `adr/0003` 的 `Amended by ADR-0012`（指产物出库那份）· `archive/**` 与两份 `CHANGELOG` 正文（当时编号）· Lead 维护的 `docs/wip/BUNDLE-SPLIT.md` |
| `src/client.js` 的 `node --check` | **有意失败**（它是构建期内联的**工厂体片段**，顶层 `return` 本就非法）⇒ 该文件的证据取 `npm run build` exit 0 + `verify-client-sync` 5/5，而不是 `--check` |

> 本报告**不新增**任何机器判据（散文类判据按 [`adr/0006`](../../adr/0006-comment-discipline-as-written-convention.md) /
> [`adr/0007`](../../adr/0007-machine-checks-target-code-not-prose.md) 不设）；上面的扫描脚本是一次性工具，
> **不入库、不留在 `scripts/` 或 `test/tools/`**（`CODE-STRUCTURE.md` §4 反例第 5 条）。

## 7. 第二期收口后的状态（本轮复核，基线 `5201451`）

§4 那张"范围外发现"表是**第一轮的判读**。第二期把这 9 项全部收口（删副本 / 移回真源）：

- `node test/verify-reachability.mjs`：**由红转绿**（0 不可达 / 0 行，`BASELINE` 未动 —— 绿是清干净换来的）；
- 守卫链新增一条 soft 档 `verify-undefined-refs`（**步数与清单的真源永远是 `test/run-guards.mjs`**，
  不在这里抄数）；
- guard-map 的零覆盖例外表收到 **1 条**（复算：`node test/verify-guard-map.mjs` 的 ①② 输出）。

逐项处置与证据在 [`UNWIRED-MODULES.md`](./UNWIRED-MODULES.md) §14/§16；本轮（第二期后）的复核结论在
[`DOC-ROT-REPORT-2.md`](./DOC-ROT-REPORT-2.md)。

> ⚠️ 本文件里凡是"未接线 / 不在 import 图上 / reachability 现红 / 9 个孤儿"的措辞，
> 一律读作**第一轮当时的判读**；**现状**以 `DOC-ROT-REPORT-2.md` 与它给出的复算命令为准。
