# BUNDLE-SPLIT 账本（度量旧账 · 追版本日志 · 丢包裁决 · 团队分工）

<!-- status-banner: code-is-truth -->
> **状态：历史记录（不反映现行实现）。** 这是重构手册 [`BUNDLE-SPLIT.md`](../../wip/BUNDLE-SPLIT.md) 的
> **账本部分**：2026-10-14 按 [`docs/README.md`](../../README.md) §目录的寿命规则与 §写作纪律，
> 从活手册里**拆出来**（活文档里的台账会漂、且漂了不会变红）。
>
> **契约不在这里**：度量 M1–M10 的定义与口径仍留在活手册的**附录 E**；本文件只放
> "当时的进度 / 追版本轮次 / 丢包裁决 / 团队分工"这类**编年史**。
> 活手册**不再引用本文** —— 要找历史，走 `CHANGELOG.md` 与 git 历史。

## 附录 E —— 历史进度与度量口径（**旧 `BUNDLE-SPLIT.md` 的账本部分，原样保留**）

> 下面是本文件替换前那一版的**进度与度量**，仍有效：度量 M1–M10 的定义、复算命令、以及
> P0–P2-11 各阶段已完成的事实。**新的阶段计划在 §7**，两者编号体系不同（旧 P*, 新 P-A…P-E）。

**度量（成功判据，复算命令见旧文 §3 与本节末）**：M1 门面体量 · M2 门面非装配占比 · M3 浏览器半边体量 ·
M4 跨组件共享读改写路径的设置键数（目标 0）· M5 守卫硬编码路径/清单条数（**加一个组件行不改工具**）·
M6 一族的文件归属唯一性 · M7 新人定位成本 · **M8 边界可声明率（P2-7 后 100%）** ·
**M9 跨模块隐式共享面（P2-7 后 0）** · **M10 实现归属唯一性（P2-8 后 0）**。
**口径**：不改善 M1–M10 任何一项的工作一律不做（唯一例外 = ADR-0013 D3）；**可开关本身不加分**。

**已完成（旧编号 → 事实）**：
- **P0 库化**：门面纯搬移出 `lib/{routes,inventory,serve,faststart,...}`；门面 469 行、`apply()` 207 行。
- **P1 内核化 + 设置分区**：`lib/kernel/*`（host-kernel / host-session / component-session / config / data-dir）；
  设置引入 7 个组件簇 + `/settings/<ns>`（按段合并、单写者）。
- **P2-0…P2-6b 组件化**：`lib/components/{about-notice,mascot-avatar,media-bridge}` + 4 行 patch；
  拆环（`lib/host-boot.js`）、fiber teardown（`handOffTeardown`）、装载探针（`/diag-log` 的 `components`）。
- **P2-7 契约收紧（M8=100% / M9=0）**：路由族 `export const DEPS` + 组件视图面 `COMPONENT_VIEW_KEYS`；
  判据 `verify-inject-contracts.mjs` / `verify-component-face.mjs`。
- **P2-8 实现入包（M10=0）**：四个私有路由搬进组件目录；判据 `verify-route-ownership.mjs`。
- **P2-9 组件行清单数据驱动**：`host-route-index.mjs` 从 `package.json.main` + patch 行名 + 磁盘交叉派生（M5 两半达成）。
- **P2-10 媒体桥入包**：`lib/media/` 恰剩 6 个内核媒体文件（M6 成立）。
- **P2-11 行级开关的界面语义（D3 落地）**：`/inventory.components` 三态状态面（键集 = 代码内建面）、
  可见面声明单一真源 `lib/components/visibility.js`、gate 唯一实现 `weComponentVisible`、
  判据 `test/verify-component-visibility.mjs`（双向对账 + 失效口径真跑 + 负对照）。
- **ADR 合并**：`ADR-0012` 为唯一正本；旧 0013–0016 与旧版 0012 归档在 `docs/archive/adr/`。
  （该文件随后因与上游的 `0012-artifact-untracking` 撞号而**重编号为 0013**，见其头部的 `Renumbered`；
  本节按账本纪律保留当时的编号，**本文其余引用一律按现行 0013 写**。）

**旧文的其余章节**（§4 宿主机制基线、§5 仓库侧硬约束、§6 三方案对比、§7 候选清单、
§9 守卫改造清单、§10 风险与撞车台账）在本手册中分别由
**§2/§4/§6/§9/§7/§10/§12 与附录 B** 承接。
**§2 的 J1–J7 入选判据不在上述承接范围内** —— 它们是"一个功能族凭什么独立成包"的判据，
改写时漏带（导致 §7 的候选讨论引用了一个没有定义的记号），现**原文补进附录 G**；
历史原件可用 `git show 5707d358:docs/wip/BUNDLE-SPLIT.md` 取得。

---

## 附录 F —— 追版本（catch-up）日志与丢包裁决表

> 本分支（下下版本开端）追到上游下版本（`origin/main`）的执行记录。起点：落后 123 / 领先 42，合并基 `0e7c806`。
> 纪律：每轮以 `verify:all` 全绿 + 本地提交收口；**严禁 push**。

### F.1 轮次结果

| 轮 | 提交 | 做了什么 | 状态 |
|---|---|---|---|
| 1 | `c43a936` | `git merge origin/main`：32 个冲突逐条裁决（上游治理 / CI / 配置 / **产物出库**全采纳；本地语义层保留；生成物重算） | **behind 0**；`npm run build` exit 0 |
| 1b | `ee4de37` | 新增叶子模块 `lib/fs-paths.js`（`extOf` / `normalizeUserDir` / `moveFileP` —— 上游放在门面**私有**位置，抽出来避免 `内核→门面` 环边）；`src/panel-tabs.js` 取上游版（上游已拆成 `panel-tabs-*.js`，本地单文件版撞名 ⇒ 构建硬失败） | 构建 exit 0 |
| 1c | `7bd0597` | 命名空间贴回上游 `settings-schema.js`（新键 `extraGlassSelectors` 归 `appearance`）；`verify-settings-namespaces` 的 7 处**硬编码计数**改成从 schema 现算；`verify-client` 三处变异锚点按上游重构后的源码形态重锚 | `verify-settings-namespaces` **exit 0** |
| 2 | 本轮 | `verify-client` 全绿（变异③ 与窗口边界自洽 ⇒ 改为"自旋即被拦下"的记账形态）；守卫链 `[2/57] → [6/57]` | 链到 `[6/57] verify-scene` |

### F.2 丢包裁决表

上游这轮把巨石拆成**域模块**，其中若干与本分支 P0 库化的产物**同责**。
口径：**上游更细且带新守卫者取上游**（判据是"谁有机械覆盖"）。

| 本分支模块 | 上游对应 | 裁决 |
|---|---|---|
| `lib/upload-store.js`（本分支在此搬出 `moveFileP` / `normalizeUserDir`） | 上游同名文件**只有** `createUploadStoreKit`；上传常量与文件解析搬到 `lib/asset-paths.js` | **取上游**（`moveFileP`/`normalizeUserDir` 已迁 `lib/fs-paths.js`） |
| `lib/we-discovery.js` | `lib/wallpaper-scan.js` + `lib/steam-discovery.js` | **取上游**（待接线；上游有 `verify-wallpaper-scan` / `verify-steam-discovery`） |
| `lib/media/transcode.js` | `lib/transcode.js` | **取上游**（待接线） |
| `lib/media/mp4-probe.js` | `lib/media-probe.js` | **取上游**（待接线） |
| `lib/media/scene-probe.js` | `lib/scene-probe.js` | **取上游**（待接线） |
| `lib/media/video-preview.js` | `lib/video-preview.js` | **取上游**（待接线） |
| `lib/diag-trace.js` | `lib/host-diag.js` | 待逐函数比对 |
| `lib/cache-dir.js` | `lib/cache-prune.js` | 待逐函数比对 |
| — | `lib/config-store.js` / `lib/asset-paths.js` | **新增接线** |

### F.3 轮 2 定位到的缺口（下一轮从这里接）

**缺口 1（解释 `verify-scene` 成片 404）**：门面从 `hostKernel` 解构 **65 个键**，其中 3 个取不到值：

```
resolveUploadFile · setUploadDir · UPLOAD_MAX_BYTES
```

成因：上游把「上传目录常量 + 上传文件解析」从 `upload-store.js` 搬到 **`lib/asset-paths.js`**（`createAssetPathsKit`），
而本分支的 `lib/kernel/host-kernel.js` 与 `lib/routes/upload.js` 仍从 `upload-store.js` 的 kit 里解构这三个名字。
⇒ **修法**：接线 `lib/asset-paths.js`；或按上游实现把这三个名字补进叶子模块（与 `fs-paths.js` 同款做法）。

**缺口 2**：`verify-scene` 其余红点（`inventory` 缺 fixture 场景 / 头像系列 404 / `GPU_FRAME_MAX_BYTES = 0`）
—— 逐条判"接线缺"还是"判据锚点漂"（**不许放宽判据**）。

**缺口 3（产物出库连带面）**：8 条读 `lib/client.js` 的守卫需"先 `npm run build`"；当前由链首
`verify-client-sync` 现场重建满足，逐条复核后决定是否显式前置。

### F.4 轮 3 结果（缺口 1 已修）

| 项 | 结果 |
|---|---|
| 轮 3 提交 | `5c372db` |
| 缺口 1 | **已修**：新增叶子模块 `lib/upload-dir.js`（`createUploadDirKit` 工厂 + `UPLOAD_MAX_BYTES` + `UPLOAD_FILE_RE`），内核在模块加载期建一次 ⇒ 那 3 个键全部有值；内核仍 **95 键**（`verify-component-face` 的冻结契约不变） |
| `verify-scene` 帧上限判据 | 改按**真源**解析（常量已随 P0 库化搬到 `lib/media/frame-store.js`；判据原先绑死 `lib/index.js` ⇒ 搬家后静默退化成 0） |
| 守卫链 | 仍在 `[6/57] verify-scene` |

**轮 4 的裁决点（新增，必须表态）**：`verify-scene` 的 `/avatar` 系列 404 与 inventory fixture 的根因是
**路由族归属**：`/avatar` 与 `/mascot` 在本分支归**组件行** `mascot-avatar`（P2-2 的成果，由 `verify-route-ownership` 的 M10 钉住），
而上游那条判据按"**门面 `apply()` 之后 `/avatar` 就可用**"写（它那边是单包单行）。两种处置：

- **(a) 判据连组件一起 boot**（`applyComponent(..., 'mascot-avatar')` 之后再断言）—— 保住组件边界，但要改上游判据的 boot 段；
- **(b) 门面补注册这两族** —— 判据不用改，但**破坏 M10**（实现归属唯一性）与组件行语义。

### F.5 轮 4 结果（按 (a) 落地）

| 项 | 结果 |
|---|---|
| 轮 4 提交 | `b3e210e` |
| `/avatar` 系列 404（7 条） | **已绿**：夹具连组件一起 boot（`applyComponent(mockCtx, {}, 'mascot-avatar')`），判据判什么未改 |
| 帧上限判据 | 已按真源解析（常量住 `lib/media/frame-store.js`） |
| 扫描面分层 | `readHostHalf`（锚点面，含 `lib/kernel/**` 与 `lib/media/**`）与 `readKeyDerivationSurface`（计数面）分开 —— 混成一份会把派生点计数带偏（实测 3→4） |
| `verify-scene` | **8 红 → 3 红**（69 passed / 3 failed） |

**剩余 3 红（需语义裁决，不是锚点漂）**：

1. `inventory exposes the fixture scene frameUrl` —— fixture 场景没进 inventory；
2. **`P1-6 每种缓存各只有一个键派生点`**：本分支实测 `base64url` 派生点**全仓 8 处**（门面 + routes + kernel + media 面 4 处），
   上游口径是 **3**（帧 / 场景音频 / 场景视频）。两种可能：本分支的媒体探测族存在**重复派生**（真回归），
   或该口径要按"每种缓存一个"重述 —— **必须逐点核对后裁决，不许直接改数**；
3. `G 去重账本只以引用进 c`（声明位置/生命周期断言）。

**顺带确认的"丢包"信号**：上游 `lib/routes/scene-frame.js` 的依赖面是
`GPU_FRAME_AREA_TOL` / `GPU_FRAME_MAX_BYTES` / `GPU_WRITE_INFLIGHT`（带**面积升级守卫**），
而本分支该族用 `sceneFrameSlot` / `gpuFrameFileFor`（无 `GPU_FRAME_AREA_TOL`）⇒ 这一族是
**上游更细且带新语义**的样本，按附录 F.2 口径应在轮 5 取上游（需连带接线 `lib/media/frame-store.js` 的新接口）。

⇒ **建议 (a)**：与 ADR-0013 D14（实现入包、主包不留注册点）一致；改的是"夹具怎么 boot"，不是"判据判什么"。

### F.6 轮 5–6 结果

| 轮 | 提交 | 结果 |
|---|---|---|
| 5 | `71c9424` | `verify-scene` **3 红 → 1 红**（71 passed）。删掉**未被引用**的重复模块 `lib/scene-probe.js`（上游版副本；本分支用 `lib/media/scene-probe.js`）⇒ `P1-6 每种缓存一个键派生点` 自动转绿（**真重复实现**，不是口径问题）；`G 去重账本` 改按声明处判定（`SCENE_VIDEO_INFLIGHT` 随 P0 库化搬进 `lib/kernel/host-session.js`） |
| 6 | 无代码提交 | 用**临时插桩**（已还原，工作树零残留）把最后 1 红的三层逐点量清 |

**轮 6 的实测trace（三层各自的结果）**：

```
[TRACE] steamRootsFromEnv raw="…\.test-cache\scene-fixture\steamlib"     ← ① env 读到了
[TRACE] probeDirs env=[fixture]  all=[fixture, C:\Program Files (x86)\Steam, …]  ← ② 候选中含 fixture
[TRACE] owningLibraries=[fixture, E:\SteamLibrary]                        ← ③ fixture 库**已被认定归属**
[TRACE] scanRoots installDir=E:\SteamLibrary\steamapps\common\wallpaper_engine   ← ④ installDir 是本机真实安装
```

**结论（把范围钉死在枚举层）**：`scanRootsP(installDir, libraryDirs)` 的实现里
`for (const lib of libraryDirs)` **确实会把** `fixture/steamapps/workshop/content/431960` 推成扫描根，
而 `owningLibrariesP()` 也把 fixture 库算进 `libraryDirs` ⇒ **根是对的、库是对的**
⇒ 剩下的可能只在**枚举/解析层**（`enumerateWallpapersAsync` 对该根的条目筛选），
或 `pathExistsP` 对该根的判定（跨 `DSH_WE_STEAM_ROOT` 的 wslPath 归一）。

**轮 7 的下一步（直接从这里接）**：在 `enumerateWallpapersAsync` 的根循环里按根打点（哪些根进了循环、
每个根产出几条、被哪个条件刷掉），再决定是修筛选条件还是修路径归一；
若两轮内仍不能定位，则**按附录 F.2 采纳上游两族拆分**（`steam-discovery` +
`wallpaper-scan`）—— 上游那套在同一层算清 installDir 与 owningLibraries，不存在本条的分叉。


### F.7 轮 7 结果：结论反转（发现族无罪）

用**最小复现脚本**照 verify-scene 的 fixture 建合成库、直接调发现族（`.test-cache/probe-discovery.cjs`）：

```
env root        : …\.test-cache\probe-fixture\steamlib
installDir      : E:\SteamLibrary\steamapps\common\wallpaper_engine
owningLibraries : [probe-fixture, E:\SteamLibrary]
fixture 在 libs : true
枚举条目数      : 48
含 990002       : true          ← **发现族完全正常**
project.json 可读: Probe Scene
```

⇒ **发现族（root 推导 / 库归属 / 根枚举 / `readProjectP`）无罪**。
"零命中"只能出在**清单装配层**（`lib/inventory.js` 的 `createInventoryBuilder` → 条目筛选与
`hasFrame`/`frameUrl` 生成），或出在 fixture 与探针的差异上（测试用 `buildPkg` 造**真 pkg**，
探针用的是 4 字节假 pkg）。

**轮 8 的唯一待办（照此顺序，别再回到发现族）**：

1. 用**测试同款 fixture**（真 `buildPkg`）跑最小复现，确认装配层是否丢条目；
2. 在装配的条目筛选与 `hasFrame` 分支各打一条 trace，看 990002 被哪一条刷掉；
3. 判据口径不变（**不许放宽**）：要么修装配筛选，要么修 pkg 探测 —— 两者都不是判据问题。

> 方法论备注（值得复用）：本轮先用真值 trace 排除了"实现同源的三层"，再用最小复现把嫌疑面
> 从"发现族整体"压到"装配层"。两次都没有改判据 —— 这正是"先定位、再动手"的收益。

### F.9 轮 18–20：GL 引擎依赖 + shim 注入归属

**轮 18（依赖）**：`verify-scene-live` 的红点里有一类是"依赖未安装"。上游树里也**没有** `lib/webwallgl/engine/`
⇒ 引擎产物是**依赖安装后的构建产物**（判据自己的提示即 `CI: npm install before verify`）。处置：`npm install`。

> ⚠️ 沙箱细节：直接 `npm install` 失败（exit −4048），因为 npm 默认缓存 `C:\Users\…\npm-cache\_logs` 在
> **工作区之外**。改用 `npm install --cache .npm-cache` 成功 —— 这是把写入**收进允许范围**的合法做法。
> `.npm-cache` 与 `node_modules` 均已被 .gitignore 覆盖（`git check-ignore` 命中），`package-lock.json` 无变化。

**轮 19–20（shim 注入归属）**：`/wallpaper-engine/scene-files` 的 HTML 入口被判据要求带四段注入：

```
data-we-site-root="host"  → window.__weSiteRoot（**必须早于 shim**：shim 首次解析 URL 前要读到）
data-we-shim="host"       → __weShimInstalled / __weSetPaused（正文从 webwallgl 包的 shimSource 提取）
data-we-focus-guard="host"→ __weFocusGuard（**必须早于 seed**，晚于作者脚本等于没装）
data-we-seed="host"       → __weSeedProps / color0（严格沙箱下渲染页读不到 iframe，属性只能随 HTML 注入）
```

现状核对（两侧都查过）：

| 位置 | 状态 |
|---|---|
| `lib/routes/scene-serve.js`（**门面**注册的 `/scene-files`） | **无注入**（`data-we-shim` 等命中 = 0） |
| 上游 `lib/routes/scene-serve.js` | **也无注入**（命中 = 0） |
| `lib/serve.js` 的 `createServeKit` HTML 分支（460–491 行） | **有完整注入**（site-root → shim → focus-guard → seed，顺序正确） |

⇒ 结论：注入能力在本分支被收进 **serve 套件**（组件会话消费），而门面那条路由不再注入 ——
与第 4 轮 `/avatar` **同族**（上游按"单包单行、门面即宿主"写判据，本分支把能力搬进了会话/组件）。

**裁决（轮 20，倾向 (b)）**：把 `lib/serve.js` 460–491 那段注入**抽成一个导出的共享函数**
（入参：`html` / `token` / `readWebShim` / `buildSeedScript` / `BASE`），
让 **kit 的 HTML 分支**与**门面的 `scene-serve.js` HTML 分支**共用同一份实现。理由：

1. 判据同组的另两条（`engine/*` 的 revalidate 缓存、`engine/` 下编码 `../` ⇒ **403**）明显是
   **宿主级文件服务**语义，而 `/scene-files` 本身就是宿主路由 —— 三者同源，放一处更内聚；
2. 抽成共享函数符合本分支"**同一不变量只有一处构造点**"的既有纪律（否则两处注入会漂）。

**轮 21 执行清单**：

1. `lib/serve.js`：抽 `injectEntryHtml(...)` 并让原分支调用它（纯重构，行为不变 ⇒ 现有判据应保持全绿）；
2. `lib/routes/scene-serve.js`：HTML 分支调用同一函数；`DEPS` 补 `readWebShim` / `buildSeedScript`，
   门面调用点同步补两个实参（`verify-inject-contracts` 三方对账）；
3. 同文件：引擎文件 `Cache-Control` 改 **revalidate**（文件名不带哈希但内容随 `webwallgl` 升级变）；
   `engine/` 下编码型 `../` 逃逸回 **403**（当前 404 ⇒ 围栏判定在"找不到"之后）；
4. 复跑 `node test/verify-scene-live.mjs`，再推链 `[9/57]` 起。

### F.10 轮 21–27：注入/引擎/契约三条线收口 + 新域模块依赖盘点

**已收口（提交序列）**

| 轮 | 提交 | 结果 |
|---|---|---|
| 21 | `6b66a41` | 入口 HTML 四段注入抽成导出函数 `injectEntryHtml`（纯重构，`verify-scene` 保持 132/0 ⇒ 行为不变） |
| 23 | `d7af89b` | `readWebShim` 改为从 **webwallgl 包 bundle** 提取（npm 包不发 `web-shim.js`）；补全 **`WEBWALLGL_PKG_DIR`** 整链（该键全仓从未定义）⇒ 四条注入判据转绿 |
| 24 | `fa639d4` | `registerSceneServeRoutes` **调用点**补 `WEBWALLGL_PKG_DIR` ⇒ 引擎 404/no-store 与逃逸 403 两条转绿 |
| 25 | `fa17b30` | scene-serve 的 **DEPS** 补该键 ⇒ `verify-inject-contracts` 93% → 98% |
| 26 | `eca482c` | **接线 occlusion 族**（本仓早有 `lib/occlusion/**`，只差挂载）⇒ M8 = **100%**（22/22 族、22/22 调用点） |
| 27 | 无代码提交 | `now-playing` 试接后**回退**（见下） |

**三条反复出现的"静默退化"形态（本轮追版本的主要敌人）**

1. **键在"DEPS 声明 ↔ 门面解构 ↔ 调用点实参"三者之一漏掉** ⇒ 路由拿到 `undefined` ⇒ 要么走错分支（`!WEBWALLGL_PKG_DIR` ⇒ 404），要么参与算术得 **NaN**（`1 - GPU_FRAME_AREA_TOL` ⇒ 守卫恒 false）。出现 **3 次**。
2. **解构遮蔽模块级常量**：同名键在"kit 不提供它"的解构列表里 ⇒ 外层 const 被盖成 `undefined`。出现 **2 次**（`GPU_FRAME_AREA_TOL`、`WEBWALLGL_PKG_DIR`）。
3. **取源方式过时 + 静默 catch**：`readWebShim` 读一个 npm 包根本不发的文件 ⇒ 每次静默返回 `''` ⇒ 整条注入通道消失。同类还有判据侧 `|| 'sf'` 的默认值回落。

> **纪律**：改"键集"（DEPS / 解构 / 调用点）后，**必须单跑 `node test/verify-inject-contracts.mjs`** —— 守卫链会在前面短路，等链跑到它等于没跑。
> **纪律**：模块级常量**不要**出现在"同名键可能不存在"的解构列表里（解构取不到即得 `undefined` 并遮蔽外层，不报错）。

**轮 27 的接口盘点（新域模块接线的前置依赖）**

| 待接线 | 上游实现位置 | 依赖（本仓状态） |
|---|---|---|
| `now-playing` | `lib/routes/now-playing.js`（172 行） | ⚠️ import `../media/index.js` 的 **`createMediaBackend`** —— 本仓**没有** `lib/media/index.js` 这个 barrel（只有 `frame-store/media-dirs/mp4-probe/scene-probe/transcode/video-preview`）⇒ **需先移植上游媒体子系统**，不可单点硬接（已试，套件因 `ERR_MODULE_NOT_FOUND` 整个崩溃，故回退） |
| `/media-control` | 上游 `lib/media/legacy.js` | 同属媒体子系统 |
| `scene-files` 双挂载 | `handleSceneFiles` ×2（应用源 + 媒体源） | 处理器已有，只差第二处挂载 |
| 视频字节布局（服务期合成） | 媒体子系统 | 同属媒体子系统 |

⇒ **结论**：第 8 步剩余的 4 条红**全部汇聚到"上游媒体子系统（`lib/media/**` + `createMediaBackend`）尚未移植"**这一个根因上。它不是单点接线，而是一次**成族移植**（对应手册 F.2 里 `lib/media/*` 与上游 `lib/media-probe.js` / `transcode.js` 的丢包裁决）。轮 28 起按"成族移植"规划，而不是逐个洞补。

### F.11 追版本方法论（轮 8–60 总结）与剩余工作清单

#### 一、这条链真正的敌人：**五类"静默退化"**

| # | 形态 | 代表案例 | 为什么难查 |
|---|---|---|---|
| 1 | **键集三处之一漏传**（DEPS 声明 / 门面解构 / 调用点实参） | `GPU_FRAME_AREA_TOL`（`1 - undefined` = **NaN** ⇒ 面积守卫恒不生效）、`WEBWALLGL_PKG_DIR` | 不抛错、不判红；守卫"在位"却不再工作 |
| 2 | **解构遮蔽模块级常量** | `GPU_FRAME_AREA_TOL`、`WEBWALLGL_PKG_DIR`（各踩一次） | 解构取不到即 `undefined` 并**遮蔽**外层同名绑定，不报错 |
| 3 | **取源/解析写死上游坐标** | 判据读 `lib/index.js` 抠 `const BASE`、`LIVE_FRAME_KEY_VERSION`、`traceMediaRequests`、`scene-manifest.js`、`http-body.js` 的 specifier 深度…… | 实现搬家后判据**静默失配**：要么假红，要么拿默认值**假绿**（`|| 'sf'` 最典型） |
| 4 | **辅助逻辑写死坐标**（不只读取面） | 判据把 `'./scene-manifest.js'` 改写成绝对 URL 的**补丁步骤**落空 | 症状伪装成"缺夹具" |
| 5 | **失败静默 / 永不 settle** | 路由对失败回**空体 200**；`promisify(fs.promises.rename)` ⇒ promise **永不 settle** ⇒ 迁移挂死 | 前者让客户端以为成功，后者让请求永不回包 |

> 判据侧的对照纪律：**不许有默认值回落**（缺锚即红）。本轮把 `|| 'sf'` 改成"解析不到就判红"，
> 并给多处判据加了"非空转自检"（例如 verify-contracts 的"宿主代码里确实用到了有版本要求的 API
> — 推导出的下限 = 0"）。判据自己会喊"我现在什么都没在看"，这是最有效的防护。

#### 二、**判据即接口契约**（本轮反复验证的一条）

判据不只断言行为，它同时是"这个模块对外承诺什么"的**书面形式**：

- `avatar-layer.js` 的**导出面被钉死为四项** ⇒ 我新增一个导出就红；
- 模块输入一律走 **`globalThis`**（`selection` / `apiUrl` 同款）⇒ 注入也必须走全局，且**缺省方向取 true**
  （"未知 ⇒ 按可用渲染"：注入缺失只可能是接线疏漏，那种情况下把整个面板藏掉是更坏的失败）；
- 页签函数的**首行必须从 `ctx` 解构**、接线语句的**换行位置**都被正则钉住 ⇒ 形态也是契约。

⇒ 我在轮 41 按自己的偏好定接口（加导出 + 裸引用拼接作用域），红；轮 42 **先读契约再定接口**，全绿。

#### 三、"搬家"是一类**多面操作**（删/移一个实现要连带检查四处）

| 处 | 案例 |
|---|---|
| 判据的 import / 读取面 | `lib/scene-probe.js`、`const BASE` |
| `package.json.files` | `lib/scene-probe.js` 残留（npm 会静默少发） |
| 代码/文档里的**相对路径深度** | 组件行文件的 `../log.js` 应为 `../../log.js` |
| 封装面登记表（`DEV_ONLY` 等） | `verify:bridge:strict` |

#### 四、基础设施（本轮新增，供后续复用）

- `test/tools/child-out.mjs`：**拿子进程输出的唯一方式**。本会话沙箱禁子进程管道 ⇒ 默认 `pipe` 抛
  `EPERM`（踩过三次：`readChain` / occlusion 语法检查 / package-files 的 runner 探测）。
  `runNodeCaptured`（stdout 落文件再读回）与 `runNodeStatus`（只要退出码，不产生管道）。
- `COMPONENT_GATE_ALIASES`（`lib/components/visibility.js`）：登记"可单独 import 的模块通过注入拿同一 gate"
  的别名；**词汇扩展必须连"验证该词汇的负对照"一起扩展**（否则负对照自己变假红）。
- `mediaSrcPath` / `readAnyOf`：判据侧的"真源解析"雏形（组件行优先、`lib/media` 兜底、缺失不 ENOENT）。

#### 五、★本轮唯一的**用户可见真 bug**（判据跑到真路径才暴露）

`lib/fs-paths.js` 的 `moveFileP`：

```js
import { copyFile, rename, unlink } from 'node:fs/promises';   // 已是 Promise API
const renameP = promisify(rename);   // ❌ promisify 是回调式适配器：调 rename(src,dst,cb)，
                                     //    promises 版忽略第三参 ⇒ cb 永不触发 ⇒ promise 永不 settle
```

⇒ **缓存根 `setCacheDir` 与上传目录 `setUploadDir` 共用这条迁移链** ⇒ 用户改缓存/上传目录时
**插件挂住不回包**。潜伏至今的原因：此前判据里的迁移场景**从未真的搬过文件**（都是 `same` 或空目录）。

#### 六、剩余工作清单（交接）—— **2026-10-14 复核：已收口**

> 复算：`node test/run-guards.mjs all` **全绿**（步数与地板以 `test/run-guards.mjs` /
> `test/verify-package-files.mjs` 的 `CHAIN_FLOOR` 为准）；`test/tools/source-locator.mjs` 已落地并被
> `guard-targets.mjs` 消费；纪律文本已进 [`TRIAGE.md`](../../TRIAGE.md)。
> 下面 6 条按**当时**状态保留，**读作历史**。

1. **守卫链位置**：`[34/58] verify-cache-dir`。该判据已修 5 项（迁移挂死、三处读点、容错解析），
   余 **D1/D3** 两条（媒体三处缓存根写法 + 中间件跟缓存根走）与一处 **ENOENT**：
   `lib/routes/now-playing.js` ⇒ 应映射到 `lib/components/media-bridge/now-playing.js`（`readAnyOf` 同款）。
2. **链的其余 24 步**（`[35/58]`–`[58/58]`）全部**未跑**：docs 组与 smoke 组。
   按本轮方法逐步骤处理：先读检查式 → 判"归属（改读取面/口径/生成物）vs 真缺（补实现）"。
3. **仍未全绿的判据面**：无（本轮结束时的已知红点集中在上面第 1 条）。
4. **上游新域模块**：`lib/media/**`（`createMediaBackend` 等约 1585 行）尚未移植 —— 但注意
   轮 28 的发现：**本分支的 `lib/components/media-bridge/` 已完整实现这些路由与后端**，
   因此"要不要移植"取决于**要不要与上游媒体子系统同构**，而不是"缺功能"。
5. **待办工具（治本）**：`test/tools/source-locator.mjs` —— 按符号名在全仓定位**唯一真源**，
   让判据写"我要 `BASE`"而不是写路径。本轮共 12+ 次手工修读取面，若该工具在场可省大半。
6. **纪律落地**：把上面五类静默退化与"判据即契约"补进 `docs/TRIAGE.md` 或贡献指南（目前只在 wip 手册）。

### F.12 第二期：智能体团队分工与验收标准（Lead 记录）

第一期（轮 1–60）把基底追平（`behind origin/main = 0`）并把守卫链从 `[2/58]` 推到 `[34/58]`。
第二期引入团队并行处理三条线，**写作用域按文件级互斥**，避免同文件并发写。

**第二期结果（2026-10-14 复核）**：三条线都已交付且落位 —— 门面形态与迁移路径在
[`ARCHITECTURE-SPLIT.md`](../../ARCHITECTURE-SPLIT.md)，每个测试点"守哪个不变量"回到守卫自身（`test/**`），
链推到 `node test/run-guards.mjs all` **全绿**；点名"脱链"的 4 条判据
（`verify-inject-contracts` / `verify-component-face` / `verify-route-ownership` / `verify-settings-namespaces`）
**已回到链上**（唯一有意脱链者 = `verify-bundle-rows`，见 §10.1 #2）。过程记录属历史，见 `CHANGELOG.md` 与 git 历史。

| 线 | 任务 | 写作用域（互斥） | 验收标准 |
|---|---|---|---|
| **追链（关键路径）** | `task-6` chain-runner | `test/verify-cache-dir.mjs`、`test/verify-scene-live*.mjs`、`test/verify-package-*.mjs`、`test/tools/child-out.mjs`、`test/tools/host-route-index.mjs`、`lib/routes/**`、`lib/kernel/**`、`lib/fs-paths.js`、`lib/cache-dir.js` | 每步：该判据 exit 0 + `node test/run-guards.mjs verify` 位置前移；链路不得回退 |
| **文档/注释同步** | `task-7` docs-comment-sync | `docs/**`（**除本手册**）、`README.md`、`lib/index.js`、`lib/components/**`（**注释 only**） | 不再有指向已不存在文件的路径陈述；`docs/ARCHITECTURE-SPLIT.md` 记录门面重写与迁移路径；`verify-logging` / `verify-inject-contracts` 无回归 |
| **测试系统锚定** | `task-8` test-audit | `test/verify-{component-visibility,inject-contracts,settings-namespaces,guard-map,component-face,route-ownership}.mjs`、`test/tools/{source-locator,guard-targets}.mjs`、`test/fixtures/**`、`docs/wip/**`（过程记录，现已归档） | 每个测试点能说出"守哪个不变量"；写死数字裁定为契约或改现算；静默回落到"缺锚即红"；新锚点各配负对照；`verify-guard-map` 全绿 |

**共同纪律**（第一期教训的固化，三人一体适用）：
1. 判据是**接口契约的书面形式** —— 改实现前先读判据检查式；改接口形状要服从既有契约（导出面 / globalThis 输入 / 首行解构 / 换行形态都可能被钉住）。
2. 五类静默退化：键集三处漏传、解构遮蔽模块级常量、取源写死上游坐标、辅助逻辑写死坐标、失败静默与永不 settle。
3. 归属类 vs 真缺：先判"能力搬到哪去了"（本分支 `lib/components/**`、`lib/kernel/**`），只有两侧都搜不到才判"需移植上游"。
4. 生成物一律用生成器重算；沙箱下子进程输出走 `test/tools/child-out.mjs`；`lib/**` 除 log/notice 外零 `console.*`。
5. 本地提交、**严禁 push**；每笔提交写清"现象 → 根因 → 修法 → 验证证据"。

**Lead 保留范围**：本手册、`package.json`、`docs/adr/**`、最终验收（跑全链 + 关键行为判据 + 复核他人 diff）。
