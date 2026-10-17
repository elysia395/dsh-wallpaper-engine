# TEST-ANCHORING —— 判据锚定审计（task-8）

<!-- status-banner: code-is-truth -->
> **状态：历史记录（不反映现行实现）。** 第二期 task-8（判据锚定审计）的交付物，已收口：
> 每条判据「守哪个不变量」已回到守卫自身（`test/**`），可信度复核见
> [`./TEST-CREDIBILITY-AUDIT.md`](./TEST-CREDIBILITY-AUDIT.md)。
> 其中 §8.3 记的 `verify-bundle-rows` **有意脱链**的理由，现由该守卫自己的注释与
> `.github/workflows/verify.yml` 持有（本文只作历史）。

> **哈希说明（squash 后）**：本文件中的短哈希是 **squash 前历史哈希**。追版本第二期收口已把
> `c43a936..352467a` 的 **108 笔**压缩为一笔（父 = `c43a936`，树内容逐字未变），该提交以 tag `catchup-2nd` 标注。
> 原文可由分支 `backup/pre-squash-20261014` 取得；逐条对应见该提交正文附录。
> 新增引用请优先使用 tag `catchup-2nd`。


> 目标（用户口径）：**每个测试点都有意义** —— 有判别力、不依赖单一来源、不写死会漂的数字。
> 本文是审计账：逐条列出"保留 / 改造 / 替换"及理由、新增锚点与它们的负对照、真源工具的用法，
> 以及**不在本任务写作用域内**的同类残留（交给对应 owner）。
>
> 分支 `refactor/p0-library-ize`；全部改动**本地提交、未 push**。

---

## 0. TL;DR

本分支判据里的腐化分**四类**，本轮的处置：

| 腐化类 | 本轮的形态（实测） | 处置 |
|---|---|---|
| **写死数字** | 内核键 95/96/89/87（主判据与负对照各写一份，内核长到 98 时**一起假红**）；`MIN_SRC_FILES=30`；inject 的 21/40/20；route-ownership 的 ≥2/≥4/≥15；settings 的 `132` 与 `HOST_KEY_COUNT+2`；bundle-rows 的"并集 42 条" | **契约**（写明并单点声明）或**快照**（改现算 / 改跨真源对账）；逐条判定见 §2，bundle-rows 那例见 §8 |
| **静默回落** | `COMPONENT_GATE_ALIASES \|\| []`；`declaredKeySet['about-notice'] \|\| []`；解析失败仍拿空串/默认值继续比对 | 一律改**缺锚即红**（0 处 / 多处都红）；见 §2 的"改造"行 |
| **扫描面写死** | 只读 `lib/index.js` 抠 `BASE`、只读 `lib/routes/settings.js`、`src/panel-tabs.js` 当负对照注入点、`lib/media/frame-store.js` 三文件扫描面 | 新增真源定位器 `test/tools/source-locator.mjs`，按**符号**定位并把"守卫↔模块"映射跟着扩展（G 类）；见 §1 |
| **扫描面太脏**（上面那一类的**镜像面**） | 以仓库根为面 + 平凡目录黑名单 ⇒ 仓库里**另一份副本**（嵌套 worktree `.integration-notes/scratch/head-wt/**` 1210 文件、gitignore 的本地目录）一起进面 ⇒ 每个名字都能在副本里读到 ⇒ **本机恒绿、CI 才红（假绿）** | 新增唯一口径 `test/tools/repo-face.mjs`（嵌套仓库一律不扫 + gitignore 名单不扫 + `git ls-files` 独立对账）；见 §11 |
| **绿了挂住** | 判据只在失败路径 `process.exit(1)`，成功路径靠"事件循环自然排空"，而脚本持着未释放句柄（宿主包 app/fiber、server、setInterval、子进程）⇒ **绿了永远不返回**（红的时候反而立刻退出）。实测：`verify-bundle-rows.mjs` 绿后跑 10 分钟不结束 | 显式 `process.exit(0)` 或"明确释放句柄 + 写明依据"；普查与清单见 §10 |

被判据**删除**的条目：**0 条**。所有被替换的内部分段都在 §4 逐条写明"原本守什么、由哪条接手"。

新增/改造统计：新增工具 1 个（`source-locator.mjs`，含 11 条自检）、新增判据 21 条、新增负对照 34 条；
另（task-13 补记）新增判据 5 条（`/upload-dir` 行为面）+ 3 条负对照、`verify-bundle-rows` 新增 5 条负对照。

---

## 1. 真源定位工具 `test/tools/source-locator.mjs`

### 用法（CLI）

```
node test/tools/source-locator.mjs BASE                 # 符号 → 唯一声明处（唯一才 exit 0）
node test/tools/source-locator.mjs BASE --in lib        # 收窄到 lib/**（同一名字在宿主/客户端各一份时必给）
node test/tools/source-locator.mjs --file settings.js   # 文件：完整相对路径或唯一 basename
node test/tools/source-locator.mjs --calls registerSettingsRoutes   # 唯一调用点
node test/tools/source-locator.mjs --selftest           # 工具自身的 11 条正/负对照
```

实测（本仓当前树）：

```
COMPONENT_VISIBILITY  ⇒ lib/components/visibility.js:60
renderWallpaperTab    ⇒ src/panel-tabs.js:63        （lib/client.js 是生成物，被排除）
LIVE_FRAME_KEY_VERSION⇒ lib/media/frame-store.js:51 （工厂作用域内的缩进声明，仍算真源）
bodyReader            ⇒ lib/http-body.js:67
BASE --in lib         ⇒ lib/host-boot.js:34         （不带 --in 会报 2 处：lib/ 与 src/ 各一份）
BASE（不带 --in）      ⇒ ✗ 2 处声明，列出候选，exit 1
```

### API（判据里怎么用）

```js
import { locate, locateFile, locateCallSites, moduleFace } from './tools/source-locator.mjs';

const r = locate('COMPONENT_VISIBILITY');           // { ok, hit:{rel,line,kind,text}, hits, detail }
check('锚点：…唯一声明（0 处 / 多处即红）', r.ok, r.detail);
const REL = r.ok ? r.hit.rel : null;               // ⚠️ 不要写 `|| '旧路径'`（那就是静默回落）
```

- **`ok: false` 的两种含义**：命中 0 处（符号被改名 / 搬出扫描面 / 删除）或多处（出现第二份真源）。
  两种都必须**报红**，绝不允许调用方猜哪一处是对的 —— 需要收窄就用 `{ in: 'lib' }` 显式说。
- 三条硬口径（各有负对照）：① 先剥注释；② 只认真实声明语句（缩进**不**作为过滤条件 ——
  本仓 `src/panel-tabs.js` / `lib/media/frame-store.js` 的真锚点都在缩进层）；③ 生成物
  （`lib/client.js` 的内联副本）不算真源，否则 `src/**` 的每个符号都会"命中两处"而恒红。

### 与"守卫 ↔ 模块"映射的配合（G 类）

`guard-targets.mjs` 新增 **G 类写法**：判据里写 `locate('X')` / `locateFile('f')` /
`locateCallSites('X')` 而不是字面量路径时，映射仍能算出"这条守卫读了哪个模块"。
没有这一步，"把写死路径改成符号锚点"会让那些模块的守卫覆盖**静默消失**
（实测：`verify-component-face` 先用变量实参 `locate(symbol)`，guard-map 立刻报
"零目标且未登记"）。四条边界有负对照：只跟 `./tools/source-locator.mjs` 这一个库、
实参必须是字面量、只认裸调用、**锚点解析不到 ⇒ 零命中**（不是万能豁免）。

---

## 2. 逐条审计清单

判定口径：
- **保留**＝它守的是不变量（或是有意写明的棘轮/契约），且负对照调同一份判据；
- **改造**＝原形态有腐化（恒真、静默回落、快照数字、写死路径）但**不变量本身仍在**，改锚点/改现算；
- **替换**＝原表达式无判别力，整段换成更有判别力的判据（见 §4 的"谁接手"）。

### 2.1 `test/verify-component-visibility.mjs`

| 判据点 | 判定 | 理由 / 新形态 |
|---|---|---|
| `DECL_REL` / `INVENTORY_ROUTE_REL` / `PATCH_REL` / NC-2 的 `src/panel-tabs.js` | **改造** | 4 处写死路径 → `locate('COMPONENT_VISIBILITY' / 'registerInventoryRoutes' / 'renderWallpaperTab')` + `locateFile('cordis.patch.yml')`（0 处/多处即红） |
| `MIN_SRC_FILES = 30` | **替换** | 快照地板 → `srcSources().size === moduleFace() 的 src/**.js 数`（少扫/多扫都点名）+ 窄化负对照 |
| `COMPONENT_GATE_ALIASES \|\| []`（`Array.isArray(...) ? ... : []`） | **改造** | 静默回落 → 缺锚即红 + 新增 `aliasViolations()`（见 §3） |
| 负对照 1 的抹除面（别名是否也抹） | **改造** | 新增自检：`抹掉的调用点数 == 判据扫到的调用点数`（含别名）。原注释自认踩过"抹 4 处却只报 4/5" |
| `SCOPE` / `OUT_OF_SCOPE` 棘轮 | **保留** | 有意写成棘轮：范围扩大/缩小必须显式改判据（文件头已写明理由） |
| `gateSemantics` 的 10 条失效口径夹具 + 两个方向变异体 | **保留** | 都是"方向"判据（整块读不到 ⇒ 按可用渲染；对象内只有 `started` 算可用），变异体走同一夹具函数 |
| `builtin` 三行夹具与"键集 = 内建组件行面" | **保留** | 夹具自洽且有判别力：状态面若改按 `declared` 出行，键集立刻不符（另配"合成全 missing"负对照） |
| `--prove-teeth` 出口 | **保留** | 把负对照的红打出来当牙齿证据，正确时 exit 0 |

### 2.2 `test/verify-component-face.mjs`

| 判据点 | 判定 | 理由 / 新形态 |
|---|---|---|
| `face.total === 95 && internal === 88` + 负对照 `96/89/87` | **改造** | 数字是**契约**（内核分级面），但**唯一真源 = 文件头那一行**「合计 98 / 稳定面 15 / 稳定面 ∩ 内核 7 / 内部面 91」，判据解析它并要求四项全对；解析不到 ⇒ 缺锚即红 |
| 负对照 `widened` 写死 `'ABOUT_DIR'` | **改造** | 键名从 `face.internal[0]` **实跑取**（键不在内核里时判据自报"内部面为空"，而不是静默不改变异） |
| ③ 负对照基准 `declaredKeySet['about-notice'] \|\| []` | **改造** | 基准改 `components[0]` 的真实声明集 + 先断言非空；多一键/少一键/恰好相等三方向都跑 |
| ② 覆盖面 `components.length >= 2` / `routeRels.length >= 15` | **替换** | 快照 → 对账 `routeModuleCandidates()`（少扫/多扫点名）与 `COMPONENT_MODULES`（双向） |
| ⑤ 负对照 `withinBudget(21,20) === false` | **替换** | 纯算术复述 → 抽出 `internalExposure()` 聚合，合成超预算组件/恰好等于预算组件各一条走同一聚合 |
| `VIEW_INTERNAL_BUDGET = 20` / `ENTRY_INTERNAL_BUDGET = 11` | **保留** | 只减不增的**合同棘轮**，文件头写明"按实测加、不预留"；改名不再宣称"现状 20/11"而是打出实测值 |
| 三个模块路径（门面/内核/会话） | **改造** | 写死 → `locate('hostKernel' / 'KERNEL_STABLE_FACE' / 'COMPONENT_VIEW_KEYS')` |
| `lib/components` / `lib/routes` 目录枚举 | **保留** | 目录本身就是被裁决的契约（M9 的作用域），不是"单一来源依赖" |
| KERNEL_STABLE_FACE 无重复、④ 姿势与 teardown 同序 | **保留** | 不变量，负对照/正对照都有 |

### 2.3 `test/verify-settings-namespaces.mjs`

| 判据点 | 判定 | 理由 / 新形态 |
|---|---|---|
| ①「7 个组件簇名与计数逐条相符」的 `countMismatch` | **替换** | `EXPECT_COUNTS` 从 `NS` 现算再与 `NS` 比 ⇒ **恒真（假绿）**。换成 `namespaceContractProblems()`：簇名/顺序 == `NAMESPACE_ORDER`（URL 段契约）+ 无空簇 + **逐簇计数 == 反查表计数** + 键的反查归属 == 所在簇 |
| 判据名里的 `132`（⑤ 两处、⑧ 一处、文件头散文） | **改造** | 现算 `HOST_KEY_COUNT`（已 133）；散文不再写死键数，并写明"键数不写死"的理由（task-14 三次变异探针） |
| ⑤ 期望 `HOST_KEY_COUNT + 2` | **改造** | 现算：`+ fontExtraKeys.length`（夹具比老存档多出的内联字体键） |
| `const BASE = '/wallpaper-engine'` | **改造** | → `locate('BASE', { in: 'lib' })` 后从唯一声明现抠字面量（缺锚即红，不回落默认前缀） |
| 门面 `lib/index.js` | **改造** | → `locateCallSites('registerSettingsRoutes')` 的唯一调用点 |
| 路由模块 `lib/routes/settings.js` | **改造** | → `locate('registerSettingsRoutes')` 的声明处 |
| 客户端实现 `src/persistence.js` | **改造** | → `locate('flushPersist')` 的声明处 |
| ① 逐键对账、`settingsNamespaceOf` 反查、例外三类（CLIENT_ONLY / DEFAULTS_ONLY / FONTSET_KEYS）、②③④⑤⑦⑧ 行为判据 | **保留** | 都是行为级/逐键级不变量，负对照齐（本轮只删掉了其中那条恒真的计数式） |
| ⑥ 「行首形态」负对照 | **改造** | 补正方向（合法行首 ⇒ `true`），堵"判据恒假也过" |

### 2.4 `test/verify-inject-contracts.mjs`

| 判据点 | 判定 | 理由 / 新形态 |
|---|---|---|
| `modules.length >= 21 && withDecl >= 21 && declaredKeys >= 40` | **替换** | 快照：上游加一族 ⇒ 假绿、合并一族 ⇒ 假红。改为**跨解析器面相等**（`buildIndex()`）+「每族都有声明面、每族 ≥1 键」 |
| `sites.length >= 20` | **替换** | 同族快照 → 调用点面 == `rowRegistrationCounts()`（独立按行首扫描）的面 |
| `m8Clean` 里重复的 `>= 21 / >= 20` | **改造** | 去数字，改为 `withDecl === modules.length && modules.length > 0 && sites.length > 0 && orphans.length === 0` |
| nc1–nc8 负对照、`parseModuleContract` 的四种形态、模板插值趟、影子形参排除 | **保留** | 全部调生产同一份函数；本仓实测过的坑都点名写在注释里 |
| M8 = 100% 口径（无豁免账本） | **保留** | 契约；`--dump` 出口保留 |

### 2.5 `test/verify-route-ownership.mjs`

| 判据点 | 判定 | 理由 / 新形态 |
|---|---|---|
| `COMPONENT_MODULES.length >= 2` | **替换** | → `rowEntryGaps()`：patch 的每个组件行都必须映射到磁盘上真实存在的入口且出现在清单里 |
| `componentFiles.length >= 4` | **替换** | → `uncoveredMembers()`：磁盘组件文件面必须包含全部行入口 |
| `routeFiles.length >= 15` | **替换** | → `uncoveredMembers()`：`buildIndex()` 认作路由族的 `lib/routes/` 文件必须都在本守卫候选面内 |
| M10 = 0（两条负对照：合成 + 真实输入改写）、`files` 覆盖、孤儿/无入口 | **保留** | 都是归属唯一性的不变量，负对照调同一份函数 |

### 2.6 `test/verify-guard-map.mjs` + `test/tools/guard-targets.mjs`

| 判据点 | 判定 | 理由 / 新形态 |
|---|---|---|
| ① 零覆盖与 ⑤ 零目标的两条负对照 | **替换** | 原形态是把判据**重写一遍**的恒真式（`['zzz'].filter(m => !allowed.has(m)).length === 1`）⇒ 判据一改它不会跟着红（假牙）。抽出 5 个判据函数，生产与负对照共用；新增 6 条负对照（含"过期登记该删""理由过短"） |
| `MIN_REASON_CHARS = 10` | **保留** | 形状不变量（"理由必须是一句人话"），单点命名，不再是散落的魔数 |
| ③ 覆盖面地板（≥40 模块 / ≥20 守卫） | **保留** | 反空转地板：拦的是"扫描面塌陷"，量级宽松（现状 155/80），不会随实现合法增减而假红；注释已写明 |
| ⑤ 元守卫表 / ① 零覆盖例外表 | **改造** | 删掉 5 条已失效的 stale 登记（`mascot-avatar/avatar.js`、`mascot.js`、`media-dirs.js`、`transcode.js`、`video-preview.js` —— 已由其它守卫覆盖）；按"只许缩小"纪律 |
| ⑥/⑥b/⑥c 派生判据自检 | **保留** | 已有 20+ 条负对照，本轮只新增 ⑥d |
| G 类（`locate` / `locateFile` / `locateCallSites`） | **新增** | 见 §1；`docs/GUARD-MAP.md` 为生成物，改扫描面后必须 `--write` 重算 |

### 2.7 `lib/components/visibility.js` 的散文 vs 判据（审计发现）

`COMPONENT_GATE_ALIASES` 的注释写着「判据强制：`GATE.file` 里必须存在
`<injectedBy>(<GATE.symbol>)` 的注入调用」——但**全仓没有一条判据读 `injectedBy`**（grep 零命中）。
别名只要写进数组就自动被当"第二个调用名"认账，哪怕它没声明、零处调用、注入点被删
（= 绕过 gate 的自由补丁）。本轮把散文承诺变成机器判据（§3 的 `aliasViolations`），
两条别名（`avatarComponentVisible` / `weComponentVisibleOf`）现在真的被钉住。

---

## 3. 新增锚点与负对照总表

| 文件 | 新增锚点 | 它守的不变量 | 配套负对照 |
|---|---|---|---|
| `test/tools/source-locator.mjs` | `locate` / `locateFile` / `locateCallSites` / `moduleFace` / `isGeneratedBundle` | 符号/文件/调用点**唯一**命中才返回路径；0 处或多处都判红（缺锚即红） | `--selftest` 11 条：唯一/多处/零处/注释内/缩进作用域/生成物副本/`in` 作用域/多声明符/空名/调用点定义处与多处；**并已挂到守卫链**（`verify-guard-map.mjs` ⑥e 收账，另配"注入假失败 ⇒ bad=1"的收账负对照），不由人手跑 CLI 才验证 |
| `test/tools/guard-targets.mjs` | G 类解析（真源定位读） | 判据用符号锚点后，守卫↔模块映射仍算出覆盖；解析不到 ⇒ 零命中 | `verify-guard-map.mjs` ⑥d 11 条（含跨库同名、变量实参、成员访问、注释、只 import 不调用、锚点表外零命中） |
| `verify-component-visibility.mjs` | `aliasViolations()`：别名的 ①形状 ②file 在扫描面 ③真的声明 ④真的被调用 ⑤`GATE.file` 里有注入点 | "别名必须从规范 gate 注入而来"（散文承诺 → 机器判据）；死词汇即红 | 4 条：零处调用的死别名、file 不在扫描面、**删掉注入行**、别名未声明 |
| 同上 | `aliasSites > 0` | 别名词汇真的被扫到（负对照 1 的口径不悄悄变窄） | 抹除数 == 扫到的调用点数（含别名） |
| 同上 | 扫描面 == `source-locator` 枚举真源 | 扫描面窄化（漏子目录/过滤写错）即红 | 窄化一个文件 ⇒ 同一条等式判红（实测 72 ≠ 73） |
| `verify-component-face.mjs` | 文件头**合同行**「合计 N / 稳定面 N / 稳定面 ∩ 内核 N / 内部面 N」为唯一真源 + `faceAgreement()` | 内核分级面的契约数字与实际内核一致；散文/判据不再各写一份 | ①a 多一个内核键（期望从实跑+合同现算）①b 升面键从 `face.internal[0]` 实跑取 ①c 合同行被删/数字被改 |
| 同上 | `internalExposure()` 聚合 | 内部面暴露预算（只减不增） | 合成超预算组件（21/12）经同一聚合判红 + 恰好等于预算的正对照 |
| 同上 | ② 扫描面 == `routeModuleCandidates()`；组件目录 ⇄ `COMPONENT_MODULES` 双向 | 路由族/组件行的扫描面不窄化 | 漏扫/多扫都会在 detail 点名 |
| `verify-settings-namespaces.mjs` | `namespaceContractProblems()` | 簇名/顺序 == `NAMESPACE_ORDER`（URL 段契约）+ 无空簇 + 簇计数 == 反查表计数 + 归属一致 | ①a 顺序被换 ①b 空簇 ①c 漏登记一个键 ①d 归属不符 + 合法合成表的正对照 |
| 同上 | `BASE` 从 `locate('BASE', {in:'lib'})` 现抠 | 判据不手抄宿主路由前缀 | 缺锚即红（抠不到字面量 ⇒ 红，不回落默认值） |
| 同上 | `locateCallSites` / `locate` / `locate('flushPersist')` | 门面、路由模块、客户端实现按符号定位 | 0 处 / 多处即红；工具自检兜底 |
| `verify-inject-contracts.mjs` | `missingFrom()` + 两处跨真源对账 | 本守卫的模块面/函数面/调用点面 == 独立解析器的面（两个解析器不许互相矛盾） | 两个方向各一条（漏成员 / 多成员） |
| `verify-route-ownership.mjs` | `rowEntryGaps()` / `uncoveredMembers()` | patch 行 ↔ 入口文件 ↔ 组件文件面 ↔ `buildIndex()` 路由族文件面 四者覆盖一致 | `rowEntryGaps` 三方向 + `uncoveredMembers` 两条 |
| `verify-guard-map.mjs` | 5 个判据函数（零覆盖 3 + 零目标 3 复用） | 例外表只许缩小、每条有理由；未登记项必须现身 | 6 条（未登记模块 / 过期登记 / 空理由 / 零目标新守卫 / 过期元守卫 / 元守卫理由过短） |

**负对照的通用形态**（本仓约定，照抄）：生产扫描与负对照调**同一个函数**，输入不同而已。
"断言 `X != Y`"这种同源比较不算对照。

---

## 4. 被替换的判据：原本守什么 → 谁接手（删除 0 条）

| 被替换的表达式 | 原本想守什么 | 为什么没判别力 | 接手者 |
|---|---|---|---|
| `EXPECT_COUNTS` / `countMismatch`（settings ①） | 每簇键数与该版裁决文一致 | 期望值从被测对象现算 ⇒ **恒真**；数字本身还会漂 | `namespaceContractProblems()`：簇名/顺序契约 + 计数 == 反查表 + 无空簇 |
| `MIN_SRC_FILES = 30`（visibility ①） | 扫描面别为空 | 快照；窄化到 30 以内也算"够" | `srcSources().size == source-locator 的 src 枚举数`（+ 窄化负对照） |
| `face.total === 95` 等（face ①） | 内核分级面 = 文件头散文 | 判据与负对照各写一份快照 ⇒ 一起假红 | 文件头合同行（唯一真源）+ `faceAgreement()` + 派生负对照 |
| `widened` 用 `'ABOUT_DIR'`（face ①） | 升面要看得见 | 键可能不在内核里 ⇒ 变异无效（假牙） | `face.internal[0]`（实跑取） |
| `declaredKeySet['about-notice'] \|\| []`（face ③） | 声明↔消费双向对账 | 基准静默变空 ⇒ "非空 ≠ 空"恒真 | 基准取 `components[0]` + 非空断言；多/少/恰好三方向 |
| `withinBudget(21,20)`（face ⑤） | 预算不是恒真 | 只复述预算表；聚合函数写错也绿 | 合成超预算组件走 `internalExposure()` |
| `>= 21 / >= 40 / >= 20`（inject） | 解析器别静默返回空表 | 快照两头都错（加一族假绿 / 合并一族假红） | `missingFrom()` 对账 `buildIndex()` 与 `rowRegistrationCounts()` |
| `>= 2 / >= 4 / >= 15`（route-ownership） | 扫描面别为空 | 同上 | `rowEntryGaps()` / `uncoveredMembers()` |
| 零覆盖/零目标的两条恒真负对照（guard-map） | 负对照要能红 | 把判据重写一遍 ⇒ 判据一改不会跟着红 | 5 个判据函数 + 6 条新负对照 |
| `COMPONENT_GATE_ALIASES \|\| []`（visibility） | 认得"第二个调用名" | 表被搬走 ⇒ 词汇消失而判据照绿 | 缺锚即红 + `aliasViolations()` |
| `HOST_KEY_COUNT + 2`（settings ⑤） | 内联字体键仍在响应里 | 夹具多/少一个键就假红 | `+ fontExtraKeys.length` |
| 判据名里的 `132` | 提醒键数 | 与实现无关的散文数字 | 现算 `HOST_KEY_COUNT`；散文改为不写死 |

---

## 5. 同类残留（**不在本任务写作用域内**，交给对应 owner）

命令口径：`grep -n "|| \[\])[01] || ''" test/verify-*.mjs` —— 全仓 26 处"解析失败仍继续"形态。
其中已具备"缺锚即红"配对的（本轮抽查确认，**不用改**）：

- `test/verify-scene.mjs:270-277`（`LIVE_FRAME_KEY_VERSION`）：`check('…缺锚即红，不许回落默认值')`
  已存在 ⇒ 搬家时是**红**而不是静默。**可选加固**：把
  `['lib/media/frame-store.js','lib/index.js','lib/kernel/host-kernel.js']` 这个三文件扫描面
  换成 `locate('LIVE_FRAME_KEY_VERSION')`（一行的改动，`verify-scene.mjs` 不在本任务范围）。
- `test/verify-contracts.mjs:139-145`（`baseOf`）：`Boolean(a) && Boolean(b)` 已挡住静默；
  **可选加固**：`lib/index.js` / `lib/host-boot.js` / `lib/kernel/host-kernel.js` / `lib/upload-dir.js`
  这几处写死读点（`:130`、`:133`、`:134`、`:257`）改 `locate(...)`，
  `bodyReader` 的 import 断言（`:240`、`:261`）与 `verify-body-caps.mjs:233` 同理。

未逐条判定的其余 20 余处（`verify-about.mjs:83/540-542`、`verify-client.mjs:1714/1725/2028-2029/2192`、
`verify-fontset.mjs:1197/1385`、`verify-readability.mjs:867`、`verify-scene.mjs:540/751`、
`verify-scene-live*.mjs` 等）：形态相同 —— **建议**对应 owner 逐条确认"该处 `|| ''` 后面是否有一条
非空断言"；没有的就是"缺锚时拿空串比对"，按本轮的形态改成缺锚即红。

> 本任务被禁改的文件（`verify-cache-dir.mjs` / `verify-scene-live*.mjs` / `verify-logging.mjs`）
> 一个都没碰。

---

## 6. 验证证据

| 命令 | 结果 |
|---|---|
| `node test/tools/source-locator.mjs --selftest` | exit 0（11 条） |
| `node test/verify-component-visibility.mjs`（含 `--prove-teeth`） | exit 0 |
| `node test/verify-component-face.mjs` | exit 0（**改造前 exit 1，3 红**：内核 95→98 后主判据与负对照一起假红） |
| `node test/verify-settings-namespaces.mjs` | exit 0 |
| `node test/verify-inject-contracts.mjs` | exit 0（M8=100%，22 族 / 22 调用点） |
| `node test/verify-route-ownership.mjs` | exit 0（M10=0） |
| `node test/verify-guard-map.mjs` | exit 0（**改造前 exit 1，2 红**：5 条 stale 例外 + 生成物过期）；⑥d 11 条 + ⑥e 2 条新增负对照全过 |
| `node test/run-guards.mjs docs` | exit 0（6/6 步） |
| `node test/tools/guard-targets.mjs --write` | 生成物重算后逐字一致（`docs/GUARD-MAP.md`） |

本地提交（**未 push**）：

| commit | 内容 |
|---|---|
| `1e0723f` | source-locator（新）+ guard-targets G 类 + guard-map 负对照有牙 + 5 条 stale 例外清理 + 生成物重算 |
| `281e705`（**被他人提交扫入**） | verify-component-face 的合同行/派生负对照/符号锚点（提交信息见本文件 §2.2 与 §4） |
| `98ddcfb` | verify-component-visibility：`injectedBy` 别名判据（散文承诺的缺口）+ 扫描面真源对账 |
| `0ae8a74` | verify-settings-namespaces：去恒真判据 + 写死数字/路径改现算与真源锚点；G 类补 `locateCallSites` |
| `7e9baac` | inject-contracts 与 route-ownership 的写死地板数改跨真源覆盖对账 |
| `d654381` | 重算 `docs/GUARD-MAP.md`（他人把 `verify-child-kill` 的字面量改读真源后映射变化） |

---

## 7. 纪律与已知限制

1. **提交被扫入**：`test/verify-component-face.mjs` 的改动被 `281e705`（他人的 `verify-picker-model` 提交）
   一起提交，本任务为该块准备的提交信息未进历史。内容无损失，账目在本文件 §2.2/§4 补全；
   落盘的提交信息留在 `.test-cache/test-audit-msg.txt`。全员已改为 `git add <显式文件>`。
2. **`docs/GUARD-MAP.md` 是生成物**：任何守卫新增/删除对模块的引用（字面量或 `locate(...)`）
   都会让 `verify-guard-map` 的"逐字一致"变红 ⇒ 改完跑 `node test/tools/guard-targets.mjs --write`。
   本任务期间因他人改动重算过一次。
3. **合同数字需要显式决策**：`verify-component-face.mjs` 文件头那一行、`NAMESPACE_ORDER`、
   `VIEW_INTERNAL_BUDGET` / `ENTRY_INTERNAL_BUDGET`、`SCOPE` 都是**有意写死的契约**。
   改它们 = 一次可见的决策（判据会红着要求你同时改散文/契约），不是"忘了现算"。
4. **`source-locator` 的代价**：不作作用域过滤时，同一名字在宿主与客户端各有一份（如 `BASE`）
   会判红 —— 这是有意的（工具不替调用方猜），调用方用 `{ in: 'lib' }` 显式收窄。
   另外函数体内的同名局部也算一处，所以锚点请用**有辨识度的名字**。

---

## 8. 补记（task-13 裁决）：「写死计数快照」又出现一例 —— `verify-bundle-rows.mjs` 的 `并集 42 条`

### 8.1 现象与取证（裁决要求"先取证不猜"）

`test/verify-bundle-rows.mjs` ⑥ 段那条 `check('合成 N 行：并集 42 条且跨行无重复 (kind, path)',
registered.length === 42 …)` 实测 **43**。取证结果：

| 取证项 | 结果 |
|---|---|
| 42 快照的来历 | `git log -S "registered.length === 42"` ⇒ **只在 `033c4b3`（P2-1 组件化首件，2026-10-12）写过一次**，此后再没人更新 |
| 快照那一刻的路由面 | `git show 033c4b3:docs/ROUTE-INDEX.md` 表行数 = **42**；HEAD = **43** |
| "多出来的那一条" | 路由**路径集差集**：新增 **`/occlusion`**（唯一一条，消失 0 条）。声明处 `lib/routes/occlusion.js:52`（`path: ${BASE}/occlusion`），调用点 `lib/index.js:302`（`registerOcclusionRoutes(webServer, {…})`） |
| 实跑逐条归属（临时探针，用完即删） | 门面 **34** 条 · about-notice **2** · mascot-avatar **2** · media-bridge **5** ⇒ 跨源期望 34+2+2+5 = **43**；实测并集 **43**；跨行 `(kind,path)` **零重复** |
| 有无孤儿 / 多注册 | 无。每一条都能追到"某个 bundle 行调用的某个路由族的某条路由" |

⇒ 判定 **(a) 合法新增**：数字是 P2-1 那一刻的快照，之后 `/occlusion` 这条**真**路由加进来，判据恒红。
**不是**重复注册，也不是归一化差异（差集只有一条具名新路由）。

### 8.2 修法（跨源对账，不再写数字）

- 断言改为 `registered.length === Σ_{行 ∈ MAIN_MODULES} rowRegistrationCounts(行).expected`
  （单点真源 = 那张行清单 × 那份族表），并**保留**「跨行无重复 `(kind, path)`」为独立判据。
- 顺带把**门面**的 34 条纳入对账（原先只有组件行逐行对账，门面只被总数隐性约束）。
- 判据本体抽成 `unionReconciliation(observed, rowExpected, dupes)`，**生产与 5 条负对照共用**：
  某行声明数 +1 / **去掉一整行** / 调用点解析不到路由族 / 跨行重复 ⇒ 各判红；一致 ⇒ 0 问题。
- ⚠️ 副产物：本判据对"行内直接字面量注册"也会红（那属于"路由必须住在路由族里"的契约变化），
  须作者显式处理 —— 可见性变化，不是放宽。

### 8.3 为什么它能"长期无人看见"（两条叠加）

1. **有意不在链上**（Lead 裁定，2026 本轮）：`run-guards.mjs` 的 `MANIFEST` 没有它、`package.json`
   不引用它、`verify.yml` 不跑它。**不挂链的理由**：它 `import`（动态 import 路径）宿主 peer 包
   `@deepseek-ai/cordis`（`node_modules/@deepseek-ai/cordis/lib/index.js`），而 CI 的守卫作业是
   `npm ci --omit=peer`（该包**不装**）；且 `test/verify-package-files.mjs` 的 **P5** 把
   "链上脚本零裸包依赖"写成硬判据 —— 挂链会撞 P5，或逼人去改 P5 这条纪律。
   它属**宿主集成**性质（与 `verify:bridge` / e2e 同类）：**保持独立**。
   · 它守什么：**43 条注册的跨源对账**（门面 34 + about-notice 2 + mascot-avatar 2 + media-bridge 5）
     + 跨行 `(kind, path)` 无重复 —— 见 §8.2 的 `unionReconciliation`。
   · 复算：`node test/verify-bundle-rows.mjs`（≈2.9s，exit 0）。
2. **绿了不退出**（更坏，已修）：文件末尾只有失败路径的 `process.exit(1)`，成功路径**裸落**到文件尾；
   ⑧c 会 import 真 cordis，其事件循环句柄让进程**挂住不返回**（实测绿后 10 分钟不结束、红时反而立刻退出）。
   已补 `process.exit(0);` + 注释 ⇒ 现在 ≈**2.9s** 返回、exit 0。这类失效已单列为第四类腐化，见 §10。

### 8.4 复算命令

```bash
node test/verify-bundle-rows.mjs                                        # 全绿（exit 0，≈3s）；含跨源对账 + 5 条负对照
git log -S "registered.length === 42" -- test/verify-bundle-rows.mjs    # 快照只写过 1 次（033c4b3）
git show 033c4b3:docs/ROUTE-INDEX.md | grep -c '^| [0-9]'              # 快照那一刻 42 条
grep -c '^| [0-9]' docs/ROUTE-INDEX.md                                 # 现在 43 条
node test/tools/host-route-index.mjs --json                            # 行清单 × 族表（跨源期望值的真源）
```

---

## 9. 补记（task-13 裁决）：两条**零覆盖**的 lib bug 现在有人守

背景：静态门禁抓到 `lib/upload-dir.js` 的两条真 bug（chain-runner 按最小改法修），但判据侧是空的
—— `test/verify-scene-live.mjs` 只钉了 `/upload-dir` 的 405。新增判据落在**已在链上**的
`test/verify-upload-store.mjs` Ⅰ 段（真门面 `apply()` + 真路由 handler + 假 req/res）：

| bug（修前形态） | 新判据（行为面） | 负对照（同一条判据） |
|---|---|---|
| kit 按**无参**调 `ensureDir()`（内核注入的是收目录的 `ensureDirOnce`）⇒ `POST /upload-dir` 500 `ensureUploadDir is not a function` | Ⅰ2：200 + `{uploadDir,migrated,skipped,same}` 且**目标目录真的存在** | ①注入恒真 no-op 的 `ensureDir` ⇒ 判红；②源码变异回 `ensureDir()` 丢参形态 ⇒ 判红（HTTP 500 / 目录不存在） |
| `setUploadDir` 末尾**丢了 `writeConfig`**（上游自己持久化 `cfg.uploadDir`）⇒ 改完重启回落 | Ⅰ3：`config.json.uploadDir == 新目录` **且**新 apply/kernel 实例把同一目录认成当前目录（`same === true` —— 只可能来自"从 config 读到了新目录"） | 源码变异去掉 `writeConfig(cfg);` ⇒ 判红（config 仍是旧目录 + 重载不认新目录） |

覆盖面前后：`verify-upload-store.mjs` 判据 12→33 条、变异体 6→14 条（地板 12/6 未动）。

---

## 10. 补记（task-13 裁定 2）：第四类腐化「**绿了挂住**」的普查与处置

### 10.1 形态与为什么它比"红"和"不在链上"更坏

**定义**：判据只在**失败**路径调用 `process.exit(1)`（或只设 `process.exitCode`），**成功**路径
"裸落"到文件尾、依赖事件循环自然排空；而脚本持有一个**未释放/未等退出**的句柄 ⇒
**绿了永远不返回**（红的时候反而立刻退出，所以调试时看不见）。

三重坏处：① 跑的人以为卡死，重复跑 / 手动 kill，于是没人再跑它；② 在 CI 里这一步**永不完成**
（只能靠 job 超时兜底，且超时看起来像"环境问题"）；③ 与"零覆盖"叠加时彻底不可见 ——
既没进链、进了链也不返回。实测样本：`test/verify-bundle-rows.mjs` 绿后跑 10 分钟不结束（§8.3）。

### 10.2 普查口径（复算方式）

- 扫描面：`test/**/*.mjs`（81 个守卫 + 工具脚本）。
- **先剥注释 + 中和字符串/模板/正则再认句柄** —— 否则夹具文本全是假阳性。第一遍扫描就踩了：
  `test/verify-contracts.mjs` 的 `spawn(b, ['--headless=new', …])` 是**判据夹具字符串**、
  `test/verify-scene-live.mjs` 的 `@deepseek-ai` 只在**注释**里、`test/compat-harness-surfaces.mjs`
  实为 `process.exit(failed ? 1 : 0)`（显式退出，被粗糙正则漏判）。
- 句柄类别 × 配对的释放形态：`@deepseek-ai/*` app/fiber ↔ `.stop()/.dispose()/close()`；
  `setInterval` ↔ `clearInterval`；`createServer/.listen` ↔ `.close()`；
  `spawn`（异步）↔ `await`/`.unref()`/`on('close')`/`.kill()`；`WebSocket` ↔ `.close()`；
  `http.request` ↔ `.end()/.abort()/.destroy()`。
- 判定：**有未配对句柄** 且（无 `process.exit()` 或只在失败路径）⇒ 风险。
- 近似复算命令（粗筛，需再按上面的中和口径人工过一遍）：
  ```bash
  grep -l 'process\.exit(1)' test/**/*.mjs | xargs grep -L 'process\.exit(0)'   # "只在失败时退出"的文件面
  grep -nE 'setInterval\(|createServer\(|\.listen\(|@deepseek-ai/|spawn\(' <候选文件>   # 再逐条看释放配对
  node test/verify-bundle-rows.mjs     # 已修样本：≈2.9s 返回、exit 0（此前绿了不返回）
  ```

### 10.3 清单（7 个有真实句柄的文件 → 处置）

| 文件 | 链上? | 未释放句柄? | 处置 | 依据 |
|---|---|---|---|---|
| `test/verify-media-bridge.mjs` | **链上** | 探针子进程，**有释放** | 无需改（已报 Lead：链上没有此风险） | 所有终止路径 `process.exit(outcome.code)`（:579/:596）；探针 `p.kill('SIGKILL')`（:157）；72/72 实测退出 |
| `test/verify-bridge-ci.mjs` | 非链 | 无（子进程 close 即退） | 无需改 | `child.on('close', …) → decide() → process.exit(code)`（:132/:140） |
| `test/tools/diagnose-web-blank.mjs` | 非链（诊断） | 显式退出 | 无需改 | 浏览器 `child.kill('SIGKILL')`（:202）+ `process.exit(0)`（:248） |
| `test/tools/fx-perf-rig.mjs` | 非链（装置） | 有释放 | 不改，记档 | `finally { child.kill(); server.close(); }`（:186-187） |
| `test/compat-harness-live.mjs` | 非链（harness-compat CI） | 有释放 + 残余路径 | 不改，记档 | 正常路径 `await killTree(h.child)` 等子进程真退出（:142-150/:332）后才置 `process.exitCode`；**残余风险**：`main()` 中途抛异常会绕过 `killTree` ⇒ 可能挂住（本地无 harness 无法复跑，不盲改；建议 owner 用 try/finally 包住检查段） |
| `test/compat-harness-pages.mjs` | 非链（同上） | 同左 | 同左 | `killTree(browser/harness)`（:325-326/:798-799） |
| **`test/e2e-web-media-origin.mjs`** | 非链（手动 / `verify:e2e`） | **是（成功路径靠自然排空）** | **已修：补 `process.exit(0)`** | 两个 Chromium 子进程 `kill()` 后不 `await`、`appServer.close()` 不主动断 keep-alive、宿主 media origin 的 loopback 监听由 `dispose()` 收 ⇒ 任何一处没排空即"绿了不返回" |

其余 38 个"有 `exit(1)` 无 `exit(0)`"的文件**无句柄**（只 import `node:fs/path/url`，I/O 全是 await）
⇒ 天然排空。抽测 10 个（`audit-fixture-coverage` / `m2-facade-code-share` / `verify-softrender` /
`verify-wallpaper-scan` / `verify-settings-schema-exports` / `verify-readability` /
`repro-sidebar-props` / `verify-route-families` / `verify-dead-declarations` / `verify-package-publish`）
全部 **0.1–6.0s 返回、exit 0**。

**链上结论（Lead 要求"发现链上有风险立刻报"）**：链上 71 个成员里，`verify-media-bridge.mjs`
是有真实子进程的那一个，它**所有终止路径都显式 `process.exit`** 且探针有 kill ⇒ 无此风险；
`verify-contracts.mjs` / `verify-scene-live.mjs` 的初筛命中是**夹具字符串 / 注释**的假阳性。
实测佐证：`run-guards all` 72 步能在正常时长内跑完（若有成员挂住，runner 的 `spawnSync` 会一起挂）。

---

## 11. 补记：**脏扫描面 ⇒ 假绿**（"扫描面写死"的**镜像面**）

### 11.1 现象

`test/verify-settings-schema-exports.mjs` 的**消费者面**原先用 `listFiles(ROOT, CODE_EXT) + SKIP_DIRS`
现算。但本仓根下嵌着**另一个完整 git worktree**：`.integration-notes/scratch/head-wt/**`（实测
**1210** 个代码文件，里面还带 `.git`），而 `.integration-notes/` 只是被 `.gitignore` 忽略 ——
`SKIP_DIRS` 里没有它。后果：

| 口径 | 消费者面 | 主判据 |
|---|---|---|
| 旧口径（`listFiles(ROOT)+SKIP_DIRS`） | **1478** 个文件 | **恒绿**（每个导出名都能在"另一份副本"里被读到） |
| 修好的口径（`repo-face.listFace`） | **264** 个文件（= 干净检出 263 + 本地 `lib/client.js`） | 真跑 |

⇒ 本机怎么跑都是绿的，**CI 才报出真实的 8 个零消费者导出**（那 8 条本身是真的，已由
chain-runner 在 `a8d4e298` 按"只被本文件用 ⇒ 去 export"修掉）。

**与 §2/§3「扫描面写死」的关系**：那一族是**面太窄**（漏报 ⇒ 假红/漏判）；这一族是
**面太脏**（多出副本 ⇒ **假绿**）。后者更危险：本机看不见、CI 才红，且"本机绿"会让人以为
判据没问题。

### 11.2 修法（`test/tools/repo-face.mjs`，唯一口径）

两条**独立**机制，都要：

1. **嵌套仓库一律不扫**：目录里出现 `.git`（目录，或 linked worktree 的 `.git` **文件**）⇒
   那是"另一份工作副本"，不是本仓源码面。
2. **gitignore 的本地目录按名单不扫**：`DEFAULT_SKIP`（相对路径前缀）= `.integration-notes`、
   `_refs`、`scripts/out|reverse|core|anim|lwe-ref`、`.zcode`、`.v2c`、`.video_agent`、
   `.git.bak-broken`、`.playwright-mcp` —— **每条都对应 `.gitignore` 里的一条**，加条目要写理由
   （不许把不确定的都塞进来：那会让面变窄，是另一种腐化）。

**独立真源对账**：`gitTrackedFiles()`（`git ls-files`）+ `diffFace()`：
走出来的面里出现"未被 git 跟踪"的文件（除 `allowedExtra` 逐条说明的，如构建产物 `lib/client.js`）
或漏掉"被 git 跟踪的代码文件"都判红；git 不可用 / 沙箱禁子进程（EPERM）时报**具名 SKIP**，
**不许静默当成一致**。

**已普查**：`test/**` 里以**仓库根**为扫描面的递归遍历只有这一处
（其余 walker 的根是 `lib` / `src` / `scripts` / `test` / 子目录 ⇒ 嵌在 `.integration-notes` 下的
副本进不来；`test/tools/source-locator.mjs` 的 `moduleFace()` 与 `guard-targets.moduleSurface()`
的根也是 `lib`+`src`，同样安全）。相邻但**未改**的一条见 §11.4。

### 11.3 负对照（证明修法是承重的）

在 `verify-settings-schema-exports.mjs` 里，正判据与负对照都调**同一份** `listFace` / `diffFace` / `judge`：

| 负对照 | 做法 | 结果 |
|---|---|---|
| ⑪ 嵌套 worktree | 在**仓库根下**造 `zz-dirty-face-nested/.git/` + `lib/dup.js`（含 `console.log(SYNTH_EXPORT)`） | 修好的面**不含**它；未修口径（`skipNestedRepos:false, skip:[]`）**含**它 |
| ⑫ gitignore 的本地目录 | 在 `.integration-notes/scratch/dirty-face-nc/lib/dup.js` 造同名引用 | 同上（修好的面不含 / 未修口径含） |
| 假绿复现 | 把⑪那份副本当消费者喂给 `judge` | **判绿（假绿复现）**；同一模块喂干净面 ⇒ 判红 |
| diffFace 两个方向 | 合成"多一个未跟踪文件" / "漏一个被跟踪文件" | 都判红；`allowedExtra` 里的产物不算多 |
| 旧口径更脏 | 在**当前树**上跑 `listFilesNaive(ROOT)` | **1478** vs 修好的面 **264**（差 1214 = 本机副本） |

两条探针建在**临时路径**里并在 `finally` 里删除（跑完 `Test-Path` 确认为 False）。

### 11.4 相邻发现（Lead 已批准并修复）

`.integration-notes/**` 里的文件**会被 ESLint 扫到**：本地 lint 面 **1470** 个文件 vs CI 约 **260**
（其中 `.integration-notes/scratch/p2-4v/nc-out32/*.mjs` 产生 14 条 `(fatal) Parsing error`）。
原因是 `eslint.config.mjs` 的全局 `ignores` 里没有 `.integration-notes/**`（有 `.test-cache/**`、
`node_modules/**`、`assets/**`、`lib/client.js`）。

**已修**：全局 `ignores` 加 `.integration-notes/**`（对应 `.gitignore` 的 `/.integration-notes/`）。
实测（**落盘口径**：`verify-static.mjs` 在本机跑不动（`execFileSync` 抓管道 ⇒ 沙箱 EPERM），
改用 `node node_modules/eslint/bin/eslint.js . -f json`）：

| 读数 | 加 ignores 前 | 加 ignores 后 |
|---|---|---|
| lint 面文件数 | 1470 | **265** |
| `eslint lib src scripts test`（CI 的 260 量级） | — | **260 文件 / 0 违规** |
| 6 条 CI 规则的计数 | 散在 `.integration-notes/**` 的副本里（另有 14 条 fatal） | **全 0** |

**结论**：CI 面本来就没有该目录 ⇒ **CI 结论不变**；变的是"本机读数终于等于 CI 读数"。
棘轮基线是空的（`byRule:{}` / `byCode:{}`），计数下降不可能触发；本地面数 265 远高于任何下界，
**未出现"掉到基线以下"**，无需回退。

### 11.5 复算命令

```bash
node test/verify-settings-schema-exports.mjs        # 22 条全绿；含 ⑪/⑫/假绿复现/diffFace 两方向
node .test-cache/face-vs-git.mjs                    # （一次性对照脚本）走出来的面 vs git ls-files
git ls-files | wc -l                                # 407（其中代码 262；干净检出消费者面 = 263）
git worktree list                                   # 能看到 .test-cache/ci-sim 这类嵌套 worktree
```

**纪律（Lead 口径）**：验证这类判据要在**干净检出**（`git worktree add .test-cache/clean-wt HEAD`）
或 `git ls-files` 口径下做 —— 在"脏"工作树里跑绿**不能**证明判据有牙（§11.1 就是反例）。

---

## 12. 补记：**只在失败结局才存在的证据被无条件要求 ⇒ 健康路径上恒红**

### 12.1 现象（CI 第 9 步 `verify:bridge --provision` 唯一红）

```
✗ 握手失败会换 spawn 姿势重试（失败行逐次点名姿势与耗时，两次之和 ≤ 总预算）
  — （没有失败行 —— 说明没走到这条结局）
… 生产路径本次 = verdict regression / code 1
```

### 12.2 根因（取证）

- 判据读 `bootLogs` 里的**最终失败行**（`中间件启动失败：…`）派生 `attempted`，并**无条件**
  要求"≥2 次尝试 + ≥2 种姿势 + 换姿势行"。
- 而"最终失败行"**只在引导彻底失败时才存在**：中间件若在 CI 上握手成功（第一姿势就成，或换姿势后成），
  `bootLogs` 里只有成功行（后者外加一条换姿势行）⇒ `failLine` 为空 ⇒ `attempted=0` ⇒ **恒红**。
- 判据自己的注释写明了正确口径（"只在'产物在位但握手没成'的分支里断言（OK 路径上不会出现失败行）"），
  **但代码没照做**：它被放在"产物在位"的分支里，而不是"握手没成"的子分支。
- `verdict regression / code 1` 是**后果不是原因**：`resolveOutcome()` 把"任一条判据红"折成
  regression/1（唯一失败来源不是环境 ⇒ 不给 code 3）。
- **实现侧没有行为变更**：本机实跑（沙箱里 spawn 必 EPERM ⇒ 天然"握手失败"）确实产生
  `中间件握手失败（姿势=detached…）⇒ 换 spawn 姿势重试：detached → plain` 与
  `尝试 1/2：detached 1ms 存活=false …；尝试 2/2：plain 1ms 存活=false …` ⇒ 换姿势重试仍在工作。

### 12.3 修法（判据侧；语义不删不放宽，改成按**结局**分派 + 确定性夹具）

- 抽出纯函数 `judgeBootRetry({ ready, logs })`（生产与全部负对照共用）：
  · **失败结局**（`ready=false`）：失败行必须在位，且逐次点名 ≥2 种姿势（带耗时/存活位）、有换姿势行
    ⇒ 与**原判据逐字同语义**（把重试短路 ⇒ 只剩一次尝试 ⇒ 红）；
  · **就绪结局**（`ready=true`）：**成功行**必须在位；**若**中途换过姿势，换姿势行必须齐形
    （两种**不同**姿势 + 耗时）⇒ "换姿势"不许退化成同姿势空转或不记账。原判据在这一结局上恒红，
    所以这一支是"把它从恒红改成有判别力"。
- **确定性夹具**（补上"不再依赖 CI 抖动"）：坏产物（假 ELF，4MB）必然握不上手 ⇒
  那一段现在**记日志**并喂同一条 `judgeBootRetry`。于是"重试被短路 / 换姿势行丢了"在**每一次**
  运行（本机与 CI、有产物与没产物）都会红 —— 这正是"负对照必须真的被走到"。

### 12.4 负对照（7 条，全部调同一份 `judgeBootRetry`）

| 输入 | 期望 |
|---|---|
| 就绪 + 成功行（**CI 上真实形态**，无失败行） | 放行（原先在此恒红） |
| 就绪 + 换姿势行齐形（detached → plain，1234ms） | 放行 |
| 就绪 + 同姿势空转（detached → detached） | 判红 |
| 就绪 + 成功行缺失 | 判红 |
| 失败 + 失败行（2 次尝试/2 种姿势）+ 换姿势行 | 放行（原语义） |
| 失败 + 只 1 次尝试 / 缺换姿势行（重试短路） | 判红（原牙齿） |
| 失败 + 没有失败行 | 判红（"没走到这条结局"不许当通过） |

⚠️ 写这组负对照时**当场抓到一处 off-by-one**：正则分组 `1=首姿势 2=耗时 3=存活位 4=换之前 5=换之后`，
我起初把 `to` 取成 `m[4]`，于是 `from === to` 恒真、"同姿势空转"检出**假通过**。
把组号改正后该条才真正区分得开 —— 负对照"必须实跑"的又一例证。

### 12.5 复算命令

```bash
node test/verify-media-bridge.mjs                    # 本机：无产物 ⇒ 环境跳过（code 3），但**确定性夹具**仍跑
node test/verify-media-bridge.mjs --provision         # CI 口径：下载产物后跑；就绪结局必须绿
node test/run-guards all                              # 72 步（media-bridge 是软档步，code 3 由 warn-only 降级）
grep -n "judgeBootRetry" test/verify-media-bridge.mjs # 判据本体 + 负对照 + 确定性夹具三处调用
```

---

## 13. 补记：CI「无尾随空白」步的**本机复算入口** + `GPU_FRAME_AREA_TOL` 两份拷贝的取证

### 13.1 `.github/workflows/verify.yml` 的格式步（为什么不是 `git diff --check`）

`git diff --check` 只看**未提交的 diff**，而 CI 全程不写被跟踪文件（`npm run build` 产物
`lib/client.js` 是 untracked/gitignore 的，`verify-client-sync` 跑完又把内容原样写回）
⇒ **工作树相对 HEAD 永远干净 ⇒ 该步恒空 = 没跑**。现在改为扫 **HEAD 树**（`git grep <rev>` 读树对象）：
① 与工作树 eol 转换无关；② 不依赖历史深度（浅克隆 / PR merge commit 下 `<base>`、`HEAD^` 都可能不存在）；
③ 检查的正是**评审者看到的那棵树**。

**本机复算**（CI 有 bash、本机没有 ⇒ 逐条跑下面三条 `git grep`；与 CI 的 `shell: bash` 块逐字一致）：

```bash
git grep -n -I -E ' +$' HEAD -- ':!*.md' ':!assets/**'                  # 行尾空格
git grep -n -I -E "$(printf '\t')+\$" HEAD -- ':!*.md' ':!assets/**'    # 行尾制表符
git grep -n -I -E '^(<<<<<<< |>>>>>>> )' HEAD                           # 冲突标记
```

⚠️ 三个**不这么写就会假阳性**的坑（都实测过）：
- 不用 `[[:space:]]`：本机 git 会把它命中到"以多字节字符结尾"的行（一次跑出 29 条假阳性，全是被误报的中文注释），只认**字面**空格/制表符；
- 冲突标记**不认** `=======`：Markdown 的 setext 标题下划线就是一行 `=======`（属内容）；
- 制表符那条用 `$(printf '\t')` 生成字面 tab，避免在 YAML 里塞不可见字符。

**实测读数与负对照记录**（`git grep` 退出码 0 = 有命中 = 该步红）：

| 口径 | 命中 | 含义 |
|---|---|---|
| `HEAD`（**修前**） | **2**：`test/verify-client.mjs:3982`、`test/verify-theme-layer.mjs:513` | 这一步**会红** ⇒ 证明它不是恒空（负对照） |
| 工作树 / 干净检出（**修后**） | **0** | 该步绿 |
| `assets/**` | **1821 行**，全部在 `assets/mascot/vector-960x1024.svg` | 豁免理由（绘图工具导出的路径数据，每行以空格结尾） |
| `*.md` | **0** | **预防性**豁免（Markdown 行尾两空格 = 硬换行） |
| 制表符（非 md / assets） | **0** | — |

处置是**修掉那 2 处**而不是把它们加进豁免名单（棘轮只许收紧）。

### 13.2 `GPU_FRAME_AREA_TOL`：两份拷贝是**同一个旋钮**（⇒ 钉相等，而非各自独立）

- 取证命令 `git log -S 'GPU_FRAME_AREA_TOL' --oneline` ⇒ 两份都由同一笔 `f788a337`
  （merge PR #206「GPU 抓帧缓存改『单主帧 + 面积升级制』」）引入。
- 两处上下文注释：宿主 `lib/kernel/host-kernel.js:94`「面积升级守卫的容差（上游 lib/index.js 取值）」；
  客户端 `src/live-layer-watch.js:643`「主帧升级判定的面积容差（**与宿主 GPU_FRAME_AREA_TOL 同值同义，
  两端独立部署**）」。
- 语义：守**同一条边界**的两侧 —— 客户端「主帧面积 ≥ 画布 ×(1−TOL) ⇒ 保留」、
  宿主「来帧面积 < 盘上主帧 ×(1−TOL) ⇒ 409」。
- 结论：**同一个旋钮的两份拷贝**（浏览器半边不能 import 宿主常量，只能复制）⇒ 判据钉"两侧相等"。
  漂开后果**不对称**：`tol_client > tol_host` ⇒ 客户端保留一张宿主会拒写的更小帧 ⇒
  用户长期看到偏小/偏糊的主帧，且再也不会被重新抓帧顶掉。
- 判据落点：`test/verify-scene-frame-master.mjs` 4h–4l（两侧各自现算锚点 + 同值 + 双向变异 +
  越界值 + 后果面错配）。**端到端负对照**：把 `src/live-layer-watch.js` 的 `0.05` 改成 `0.30`
  ⇒ 4i/4l 判红、exit 1；按字节还原后复绿（`git diff --numstat -- src/live-layer-watch.js` 为空）。
