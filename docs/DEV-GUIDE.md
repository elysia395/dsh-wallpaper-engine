# 二次开发指南（Dev guide）

> **English**: `en/DEV-GUIDE.md`（**已随 2026-10 文档瘦身撤除**：维护者向文档只留中文，见 [`README.md`](./README.md) §语言结构）
>
> **本文是"怎么加一个 X"的配方**：每节给**落点、必须同步改的地方、以及改错了会怎样**。
> 结构性规则（新文件放哪、边界在哪、结构长什么样）在 [`CODE-STRUCTURE.md`](./CODE-STRUCTURE.md) —— 本文不重复，只引用。
> 为什么这么设计在 [`adr/`](./adr/)。
> §4 是**验证与测试**（原 `TEST-LAYOUT.md` 并入）：测试放哪、怎么跑、怎么写一条判据。

## 目录

- [0. 开工前：命令与环境](#0-开工前命令与环境)
- [1. 加一条宿主路由](#1-加一条宿主路由)
- [2. 加一个设置项](#2-加一个设置项)
- [3. 加一块浏览器端代码](#3-加一块浏览器端代码)
- [4. 验证与测试](#4-验证与测试)
  - [4.1 三层，各管一件事](#41-三层各管一件事)
  - [4.2 两档：硬档挡 PR，软档只出声](#42-两档硬档挡-pr软档只出声)
  - [4.3 怎么跑（运行矩阵）](#43-怎么跑运行矩阵)
  - [4.4 覆盖范围](#44-覆盖范围每层各自保证什么)
  - [4.5 怎么写一条新判据](#45-怎么写一条新判据最短路径--八条约定)
  - [4.6 `test/tools/` 清单](#46-testtools-清单都没有-ci-消费者)
  - [4.7 约定（八条）](#47-约定八条守卫会判)
- [5. 改文件头注释（任何改动都要做）](#5-改文件头注释任何改动都要做)
- [6. 提交前的自查清单](#6-提交前的自查清单)

---

## 0. 开工前：命令与环境

```sh
npm ci                # 本地取工具链（CI 故意不装依赖，见 CONTRIBUTING.md）
npm run build         # 改过 src/** 之后必须跑：重新生成 lib/client.js
npm run verify        # 硬档（挡 PR）：真机行为 / 发布面 / 平台契约 / 打包面
npm run verify:docs   # 软档（只出声）：模块布局 / 可达性 / 退役线 / 声明孤儿
npm run verify:all    # = build + verify + verify:docs + smoke
npm run smoke         # 节点级行为冒烟
```

**链条每档分别有哪些守卫、失败意味着什么**，真源是 `package.json` 的 `verify` / `verify:docs` /
`smoke` 三个脚本 —— **别把条数记在这里**（会漂）。分档判据见本文 §4.2。

**改 `lib/**` 必须重启 DSH**；改 `src/**` 必须 `npm run build`。这两条不对称，是本仓最常见的操作失误。

---

## 1. 加一条宿主路由

**落点**：`lib/routes/<族>.js`。只有当这一族**已经成规模**时才单独成文件，否则就近放在已有的族里
（准入条件见 `CODE-STRUCTURE.md` §4）。

**形状**（以诊断族为样板 —— 注册返回值必须推进 `disposers`，否则卸载 / HMR 后路由仍挂着）：

```js
export function registerDiagRoutes(webServer, c) {
  const { disposers, appendDiagLine, log, notice, base: BASE } = c;
  disposers.push(webServer.register({
    kind: 'exact',                 // 或 'prefix'
    path: `${BASE}/your-route`,
    handler: (req, res) => { /* … */ },
  }));
}
```

**必须同步改的地方**：

| 改什么 | 为什么 |
|---|---|
| `lib/index.js` 里把依赖传进这个族的 context 对象 | 路由模块**不得继承**门面的 import（守卫 `verify-module-layout` 的『路由模块不得"继承" lib/index.js 的 import』会判） |
| `package.json` 的 `files`（若新增了文件） | 留在 `lib/` 的一切都会被打进包；P1 会判 |
| 文档：**不用手写路径表** | 路由索引是生成物 |
| **收 body 的路由：上限 + 收完一次性解码** | 收 body 的路由见下面的"读请求体"一节；`verify-body-caps` 会从磁盘枚举判它 |

### 读请求体（POST/PUT 路由必须照这个形态写）

逐块累加却**不比较长度** ⇒ 异常大的请求把宿主堆无界撑大（默认只听 loopback，但 webserver 允许
`host: 0.0.0.0`）。逐块 `body += chunk` 再 `toString()` ⇒ 落在两个 TCP 分片之间的多字节码点被切成
`U+FFFD`，用户可见字符串（壁纸 id / 字体名 / 字体族）被**静默写坏**且客户端不知道。所以：

```js
const chunks = [];
let size = 0;
let tooLarge = false;
req.on('data', (chunk) => {
  if (tooLarge) return;
  size += chunk.length;                                   // 按**字节**计
  if (size > CONTROL_JSON_MAX_BYTES) { tooLarge = true; fail(413, { error: 'payload too large' }); return; }
  chunks.push(chunk);
});
req.on('end', () => {
  if (tooLarge) return;
  const body = Buffer.concat(chunks).toString('utf8');    // 只解码**一次**
  // …JSON.parse(body || '{}')…
});
```

上限常量**从 context 取**（`c.CONTROL_JSON_MAX_BYTES`，小控制面 JSON 统一 64KB；真源在
`lib/index.js`，不变量写在 `lib/routes/upload.js` 文件头）。大载荷（上传 / 抓帧 / 自定义画面）走
**流式落盘**那条腿，别整个缓冲在内存里。**判据**：`test/verify-body-caps.mjs` —— 新增一条
`req.on('data')` 会自动进扫描面，缺上限即红（"同族都有闸"不再是靠人记得抄的事）。

**改错了会怎样**：

- **忘了推进 `disposers`** ⇒ 卸载 / HMR 后路由仍挂着已释放的处理器。没有守卫能替你发现这一条，
  请按样板抄。
- **忘了 `files`** ⇒ 装上就崩（`ERR_MODULE_NOT_FOUND`），`verify-package-files` 会红。
- **在门面里直接写 handler** ⇒ 门面继续膨胀，那条『路由模块不得继承门面 import』的守卫会判。

**路由索引怎么更新**：

```sh
node test/tools/host-route-index.mjs --write   # 重算并写入 docs/ROUTE-INDEX.md
```

它是**生成物**：`test/verify-route-index.mjs` 会重算并逐字节比对，手改必红。
注意索引有一列是**「守卫提及」次数** —— 增删守卫会改变它，此时必须重算（这是**预期**行为，不是回归）。

---

## 2. 加一个设置项

**落点**：`lib/settings-schema.js` —— 它是设置的**唯一真源**，宿主与客户端都从它派生
（见 [`adr/0002`](./adr/0002-settings-schema-single-source.md)）。

**要做两件事，都在同一个文件里**：

1. 把一个默认值加进 `DEFAULTS`（只做默认值、不持久化的加进 `DEFAULTS_ONLY`）；
2. 把校验规则加进 `KINDS`（`num` 带 min/max、`enum` 带枚举表、`boolTrue` / `boolFalse` …）。

枚举白名单也定义在这个文件里（如 `FPS_CAP_VALUES`），**不要**在客户端或宿主各抄一份。

**必须记住的三件事**：

- **这个文件必须浏览器安全**：不得出现 `import` / `require` / Node API / 顶层副作用 ——
  它会被**构建期内联**给浏览器，且构建期逐条断言。
- **`min` / `max` 只在 `KINDS` 里定义一次**。如果滑条的实际可拖范围与 schema 范围不一致（本仓
  确有这种情形），**在实现处用常量**（如 `ROPE_SCALE_MIN` + `CONSTS` 解析表），不要在面板里写死数字。
- **不要另写一张 UI 表**：面板按真源渲染。抄一张表就是多一个会与真源脱钩的副本。

**改错了会怎样**：漏登记一个键 ⇒ 客户端设置被**静默丢弃**（症状是"改了没生效、重启回默认"）。
这是本仓历史上真实发生过的一类 bug，正是单一真源要消掉的东西。

**文档**：设置默认值与范围**一律不写进文档**，只写"见控件本身 / 见 `lib/settings-schema.js`"。

---

## 3. 加一块浏览器端代码

**落点**：`src/<语义名>.js`（默认平铺；建子目录有准入门槛，见 `CODE-STRUCTURE.md` §4）。

**两条硬约束**：

1. **必须登记进 `scripts/build-client.mjs` 的 `INLINE_MODULES`**，并给 `markers` 锚点：

```js
{
  file: 'src/your-module.js',
  why: '一句话说明它为什么独立成文件（给未来的自己看）',
  markers: ['const YOUR_EXPORT = ', 'function yourHelper('],   // 缺任一 ⇒ 构建硬失败
}
```

2. **模块内不得出现** `import` / `require(` / `export default` / `process.*` / `__dirname` / `__filename`
   —— 构建期逐条断言（且**先剥注释再判**）。

**改错了会怎样**：

- **忘了登记** ⇒ **不报错**，只是这个文件永远不进产物，调用点一到运行期就是 `ReferenceError`。
  这是本路线最危险的失效模式（本仓踩过一次）。
- **顶层读宿主状态** ⇒ 你的模块被注入在 bundle **顶部**（早于 `src/client.js` 正文），
  顶层读正文里的 `const` 会撞 **TDZ**。**若你的字符串/模板要引用另一个常量的值，把那个常量声明
  提到使用点之前**（本仓在 `src/live-layer.js` 的 `LIVE_FAIL_LABELS` 上踩过这个坑）。
- **名字与正文或别的模块冲突** ⇒ 构建期机器提取后断言，冲突即失败。

**模块头要写契约**：需要什么外界、对外提供什么。因为这一侧**没有 `import`**，契约注释是唯一的依赖说明。

**`src/**` 的注释会随包发给用户** ⇒ 涉及行数 / 体积这类会漂的量，写**复算命令**而不是写数字。

---

## 4. 验证与测试

> 本节由原 `TEST-LAYOUT.md` 并入：**"测试放哪 / 怎么跑 / 怎么写判据"本就是开发指南的一部分**，
> 拆成两份只会让"我该读哪份"变成额外决策。目录语义（`test/` 为何不进发布包）见
> [`CODE-STRUCTURE.md`](./CODE-STRUCTURE.md) §4。

### 4.1 三层，各管一件事

| 层 | 内容 | 谁跑 |
|---|---|---|
| **`test/*.mjs`（守门）** | `verify-*.mjs` —— 结构性守卫：断言**代码**与声明一致，**正负对照成对**（守散文的守卫已按 ADR-0006 撤除） | 见 §4.2「两档」 |
| **`test/*-smoke.mjs`（冒烟）** | 节点级行为冒烟：轮换、实时帧回填、身份校验 | `npm run smoke`（在 `verify:all` 里） |
| **`test/e2e-*.mjs`（端到端）** | 真浏览器路径（需本机 Chromium 系浏览器） | `npm run verify:e2e`（不进 verify 链） |
| **`test/compat-*.mjs`（适配）** | 真 harness 集成面，三个入口：`compat-harness-live` —— 插件进真实 `@deepseek-ai/dsh` 并启动，断言宿主路由注册可达 / 落盘诊断出现探活标记 / 插件树无加载失败（自带 HOME 隔离与 `DSH_WE_MEDIA_LEGACY=1`，媒体桥等第三方全程不拉起）。**两条安装通道**：`--channel link`（默认，软链工作区）与 `--channel tarball`（先 `npm pack`、再把 **.tgz** 装进去）+ `--fresh` —— **tarball 通道是 `peerDependencies` 能否在安装闭包里解析的唯一判据**（软链不参与依赖解析，结构性地看不见这一类）；它还带"通道自证"（装进去的是真目录而非软链）与两条针对性的失败串断言（`peer validation failed` / `does not resolve from the installation closure`）。CI 里两条通道各跑一步；`compat-harness-surfaces` —— UI 面清单棘轮（已装 harness 的 `dsh-client-ui-*` 与 `test/fixtures/harness-ui-surfaces.json` 做差，**新表面未登记即红**）+ sidebar 源码活判据；`compat-harness-pages` —— 无头浏览器**逐页 DOM/样式断言**（零依赖 CDP 走计算样式探针；`--dump` 为探查模式） | `.github/workflows/harness-compat.yml`（需网络、`dsh` CLI 与 Chromium 系浏览器，不进 verify 链） |
| **`test/tools/`（工具）** | 诊断 / 分析 / 生成 —— **没有 CI 消费者**，靠手敲（清单见 §4.6） | 手动 |

### 4.2 两档：硬档挡 PR，软档只出声

判据多少不是问题，**所有判据共用同一种红**才是问题：一次文档排版改动与"发布面漏一个文件"
若共用同一条命令失败，改一行的合规成本就等于改发布面。因此按**失败的含义**分两档：

| 档 | 什么时候红 | 谁跑 | 清单 |
|---|---|---|---|
| **硬档** | 失败意味着**用户会撞上**：真机行为、发布面、平台契约、打包面 | `npm run verify`（在 `verify:all` 与 CI 里） | 真源是 `package.json` 的 `verify` 脚本 —— **不在这里列清单**（删/加守卫都会让它过时，本仓真实发生过）。其中 `verify-media-bridge` 经 `test/warn-only.mjs --probe-spawn`：环境起不了子进程时**点名式 SKIP**；CI 的 `verify:bridge` 变体另有两道门（平凡调用探针 + 产物 sha256 可信度），只有都指向环境才允许记"环境跳过"并点名 |
| **软档** | 失败意味着**仓库内务 / 一次性清理的验收判据**不准了 —— 要人回来看，但不该拦住别人的改动 | `npm run verify:docs`（在 `verify:all` 与 CI 的一条 `continue-on-error` 步骤里） | 同样是 `package.json` 的 `verify:docs` 脚本（**步数与清单的真源都在那里**；含模块布局 / 可达性 / 退役线 / 声明孤儿 / **守卫映射**） |

> **软档里只剩"守代码"的守卫。** 此前软档还有两条守**文档 / 注释散文**的守卫
> （`verify-comment-discipline` · `verify-ledger`），已随
> [`adr/0006`](./adr/0006-comment-discipline-as-written-convention.md) **整体下线**：
> 写作纪律改由约定承担 —— 它们守的是"作者该怎么写"，而这类判断一旦降级成正则匹配，
> 作者就会去躲词表，且守卫自身会腐化与自相矛盾（详见该 ADR）。
> 留下的四条都读**代码**：模块边界、可达性棘轮、退役线、声明孤儿 —— 那里的失败是客观的。

软档**照跑、照打印 `✓/✗`**，只是退出码被 `test/warn-only.mjs` 这层包装降级：
原码打在末尾的 `[warn-only] 软档守卫原退出码 = N` 行上，并写进 `DSH_WARN_ONLY_EXIT`。
这不是"静默跳过"（跳过不得与通过同形，见 [`README.md`](./README.md) §写作纪律）—— 判据一字未改，
想让它重新拦下改动，直接 `node test/<守卫>.mjs` 跑它。
> 为什么是"跑子进程"而不是 `node --import …`：**实测** `npm run` 会把 `--import` 参数吞掉
> （npm 自己解析选项），于是降级没生效、链条当场断在第一条软档守卫上。

**分档的判据**（新守卫放哪一档，按这个问）：
1. 失败时用户会不会看到错的行为 / 拿到坏的包？会 ⇒ **硬档**。
2. 它守的是"规则本身的形式"（棘轮基线、模块边界、清理验收）？是 ⇒ **软档**。
3. 拿不准 ⇒ **软档**：硬档的门槛是"能说出用户侧后果"，说不出的先别挡人。

**明确不做的四件事**（免得下次重新讨论）：
1. **不加"守散文"的守卫** —— 写作纪律（注释措辞、文档排版、账本格式）由**约定**承担，
   不配机器判据。这条在 ADR-0006 之前是"不删守卫"，方向已反转：**该撤的已撤**，
   以后也不许以"防止腐化"为名把措辞词表加回来。判据边界：**读代码的守卫照留，读散文的守卫不加**。
2. **不改判据内容** —— 要改判据是另一件事（改完走 `npm run verify:all`），不搭这条的车。
3. **不动 harness-compat 工作流** —— `test/compat-*` 与 `harness-compat.yml` 保持原样：需网络与真浏览器，
   本来就不在 verify 链里，分档管不着它。
4. **不给归档文档加新判据** —— `docs/archive/**` 只作记录、不反映现行实现，不为它新增守卫。

**动机一句话**：根因是**所有判据共用同一种红** —— "用户会撞上"与"仓库内务失真"这两种失败长得一样，
合规成本就被最贵的那条判据决定；分档拆开了"谁决定红绿"，而 ADR-0006 进一步把"守散文"的那几条
**整条去掉**，而不是继续养着它们。

### 4.3 怎么跑（运行矩阵）

**真源是 `package.json` 的 scripts** —— 下面是"什么时候跑哪条"，**不列条数**（会漂）。

| 你的处境 | 跑什么 | 说明 |
|---|---|---|
| 日常改完一处，想知道有没有弄坏 | `npm run verify` | 硬档。**这是挡 PR 的那一档**，失败即用户会撞上 |
| 改过 `src/**` | `npm run build && npm run verify` | 产物必须重建；`verify-client-sync` 会判产物与源是否同步 |
| 改过文档 / 注释 / 结构 | `npm run verify:docs` | 软档，**只出声不拦人**。结论比"红绿"更重要的是别**变差** |
| 提交前 | `npm run verify:all` | = build + verify + verify:docs + smoke |
| 改了轮换 / 实时帧 / 字体集加载 | `npm run smoke` | 节点级行为冒烟，比结构守卫慢但比真机快 |
| 排查"这一条到底怎么说" | `node test/<守卫>.mjs` | 直接跑单个守卫，看它自己的 `✓/✗` 明细 |
| 需要真浏览器 | `npm run verify:e2e` / `node test/compat-*` | **不进 verify 链**（需 Chromium / 网络 / `dsh` CLI） |

**读结果的两个约定**：

- 输出里的 `PASS |` / `✓` 是判据行；**带 "negative control" 的行是在证明判据有牙**，
  它出现 `failed=` 之类字样是**标签文本**，不是失败 —— 看结尾的 `ALL … PASSED` / `… FAILED`。
- 软档的**原退出码**打在末尾 `[warn-only] 软档守卫原退出码 = N` 行上。想让某条软档守卫
  真的拦下改动，直接 `node test/<守卫>.mjs` 跑它（判据一字未改，只是没被降级）。

#### CI 跑**两条腿**（Windows + POSIX），不是因为"多跑一遍更保险"

守卫里有**平台条件分支**，而两半各在不同的平台上才有牙：

| 分支 | 只在哪个平台成立 | 为什么 |
|---|---|---|
| `verify-scene` 的 unlink 失败用例（500 `unlink-failed` / 帧仍在盘上 / 重试可用 …） | **POSIX** | 只有 POSIX 的 `chmod` 能阻止 unlink；Windows 上模式位基本被忽略 |
| 同一处 win32 那半（ENOENT 幂等） | Windows | 同上，反过来 |
| `verify-scene-live` 的目录链接 | 各按平台 | win32 建 junction、POSIX 建 dir |
| `verify-media-bridge` 的一处断言 | Windows | win32 专用 |

⇒ 只跑一个平台，**另一半零覆盖**，而 `verify-scene` 自己就会把它打印成
「来自 posix 分支的 5 条 … 在 win32 上没有任何覆盖 —— 这是覆盖差异，不是通过」。
所以"换平台会改变被断言的那一半"不是**不换平台**的理由，恰恰是**两个都要跑**的理由。
`verify.yml` 用 `strategy.matrix.os = [windows-latest, ubuntu-latest]` + `fail-fast: false`
（一条腿红了不该把另一条腿的结论藏起来），`concurrency.group` 里带 `matrix.os`
（语义唯一：一次新 push 取消的是**同一平台**的上一次 run，而不是让两条腿互相取消）。
这条"必须两平台"由 `test/verify-contracts.mjs` ④ 静态钉住 —— 谁把矩阵改回单平台就会红。

⚠️ **`concurrency` 必须挂在作业上，不能挂在工作流级**：`matrix` 只在作业上下文里存在，写在工作流级
时 GitHub 会把整个工作流文件判为无效 —— push 后 run **0 秒失败、`jobs=[]`**，页面只说
"This run likely failed because of a workflow file issue"（实测 2026-10-02，本地怎么跑都绿）。
`verify-contracts.mjs` **⑤** 静态钉住这条：`jobs:` 之前那段里不许出现 `matrix` / `strategy` /
`steps` / `needs` / `job` 这些作业作用域上下文（含负对照与反空转地板）。

### 4.4 覆盖范围（每层各自保证什么）

| 层 | 它保证的事 | 它**不**保证的事 |
|---|---|---|
| **硬档守卫** | 结构契约：路由索引与代码一致、发布面自洽、类型与实现同源、可读性下限、玻璃合成数学 | 真机观感、真实 GPU 行为 |
| **冒烟** | 节点级行为：轮换状态机、实时帧回填与身份校验、字体集加载 | 浏览器渲染结果 |
| **e2e** | 真浏览器里的端到端路径（媒体源、抓帧） | 跨平台差异（本仓是**一份跨平台代码**，跑在一台上不等于其它三台） |
| **compat** | 真 harness 集成面：宿主路由可达、UI 表面清单棘轮、逐页计算样式 | 不在 verify 链里 ⇒ **不会替你挡 PR** |
| **软档守卫** | 仓库内务：模块边界、可达性棘轮、退役线、声明孤儿 | 也不挡 PR（但**允许变差**是错的） |

⚠️ **平台覆盖是不对称的**：某些判据有 posix / win32 分支，跑在 Windows 上时 posix 那几条
**根本没有被执行**（输出会写"这是覆盖差异，不是通过"）。改动涉及平台分支时，别只看本机绿灯。

### 4.5 怎么写一条新判据（最短路径 + 八条约定）

**最短路径**：

1. **决定放哪一层**（§4.1 + §4.7 约定 1）：行为 → 冒烟；真浏览器 → e2e；结构 → 守卫。
2. **正负对照成对**，且**共用同一个判据函数**（§4.7 约定 5）——这是最常写错的一条。
3. **先断言域非空**，否则"零残留"这类判据会在空域上恒真。
4. **剥注释用字符串感知实现**（`test/tools/js-text.mjs`），别用朴素块注释正则。
5. **验证判据本身有效**：把判据中和成"永远说没问题"，负对照**必须变红**（§4.7 约定 8）。
6. 新工具 / `compat-*` 要在 §4.6 点名（守卫会判"不许有没人知道的工具"）。

**⚠️ 不要加"守散文"的守卫。** 判据若去正则匹配**文档里的措辞或数字**，它守的就是编辑而不是腐化：
句子一改写，判据就从"复算"退化成"守住那两句话"。这条边界由
[`adr/0006`](./adr/0006-comment-discipline-as-written-convention.md) 定死，`CODE-STRUCTURE.md` §6
还专门留了一张"已从本表撤除"的清单记载它。

**⚠️ 判据会腐烂，而腐烂有三种形态**（都实测发生过 —— 详见
[`archive/wip/GLASS-CONFIG-REFACTOR.md`](./archive/wip/GLASS-CONFIG-REFACTOR.md) §10.23）：

| 形态 | 表现 | 触发条件 |
|---|---|---|
| **读取目标过期** | **假绿** | 判据盯着一份已经没有相关代码的文件（代码被搬走 / 删掉之后，判据继续"全过"） |
| **输入过期** | **假红** | 判据 / 探针的**输入**还在用已删的键或旧形状，于是它测的不是现在的代码 |
| **引用过期** | **恒真** | 负对照里引用了已删的键：`canon(undefined)` 与任何对象都不等 ⇒ 断言永远成立 |

**防腐办法（一句话）**：**删键 / 搬代码时，把所有"提到它"的地方一起过一遍** ——
判据、探针、夹具、注释都算"提到"。另外两条具体的：
- **负对照里的每个引用都要随被删的键一起改**，否则它会从"有牙"退化成"摆设"；
- **别用 `includes('标签')` 判"某个控件在不在"** —— 别处的 tooltip 正文可能正好含那几个字，
  断言于是恒真（实测踩过）。用能**精确匹配标签**的查找（如 `findSliderRow` / `findCtlInput`）。

### 4.6 `test/tools/` 清单（都没有 CI 消费者）

| 工具 | 回答什么 | 怎么跑 |
|---|---|---|
| `analyze-host-apply.mjs` | 宿主 `apply(ctx)` 的拆分评估取证（路由数 / 按首段归组 / 巨石体量） | `node test/tools/analyze-host-apply.mjs` |
| `audit-fixture-coverage.mjs` | **夹具是不是把被测行为中和掉了** | `node test/tools/audit-fixture-coverage.mjs` |
| `audit-guard-teeth.mjs` | 守卫"牙齿"普查 A–F（对照没被评估 / log 式伪判据 / 零引用判据 / 恒真 / 无红出口 / 朴素剥注释吃代码）—— **只给候选** | `node test/tools/audit-guard-teeth.mjs` |
| `audit-import-closure.mjs` | `lib/` 的**运行时导入闭包** vs `package.json` 的 `files`（缺文件 ⇒ registry 装上就崩） | `node test/tools/audit-import-closure.mjs` |
| `branch-notify.mjs` | **分支级**"改了 store 却没通知" | `node test/tools/branch-notify.mjs audit` |
| `diagnose-web-blank.mjs` | 网页壁纸「白屏」排查台（无头真浏览器） | `node test/tools/diagnose-web-blank.mjs` |
| `guard-targets.mjs` | **「哪个守卫管哪个模块」的派生映射**（从守卫**代码**里派生，不维护清单）：`--write` 重算生成物 `docs/GUARD-MAP.md`；改了某模块后查"该跑哪几条"就看它 | `node test/tools/guard-targets.mjs [--write] [--json]` |
| `host-route-index.mjs` | 生成 / 核对**宿主路由索引**（产出 `docs/ROUTE-INDEX.md`） | `node test/tools/host-route-index.mjs [--write]` |
| `i18n-scan.mjs` | 源码里的**中文字面量**扫描（判"进没进 `weT(...)`"；迁移与 `verify-i18n` 共用同一实现） | `node test/tools/i18n-scan.mjs [--json] [paths…]` · `selftest` |
| `js-text.mjs` | JS/TS 源码的**文本级**工具（字符串 / 正则感知的剥注释） | `node test/tools/js-text.mjs selftest` |
| `sync-webwallgl.mjs` | 从本地 `webwallgl-github` 仓库构建 WebWallGL 渲染页（vendored 同步） | 见文件头 |
| `underlay-pixel-rig.mjs` | **画布兜底色**的真浏览器像素对照：壁纸的像素没送到屏上时，页面自己画的是什么颜色（掉层 → 白闪还是同色底） | `node test/tools/underlay-pixel-rig.mjs <bundle.js> [label]` |
| `weT-shim.mjs` | 给**单独 import `src/**`** 的守卫装身份译文层（`weT(k) === k`，与 bundle 里中文态逐字一致） | `node test/tools/weT-shim.mjs` |

> 其中 `host-route-index.mjs` / `js-text.mjs` / `branch-notify.mjs` **同时是守卫的库**
> ⇒ 改它们等于改判据，走 `npm run verify:all`。
> 另有 **`test/warn-only.mjs`**（不在本清单里）：两档共用的**入口包装** —— 降级退出码
> 与"本环境起不了子进程就显式 SKIP"。它自己不是判据，所以没有独立守卫覆盖它。

### 4.7 约定（八条，守卫会判）

1. **新写的守卫放 `test/`，手动工具放 `test/tools/`，harness 适配探活放 `test/compat-*`** —— 别放回
   `scripts/`：那里只留「用户与发布流程真的会跑」的脚本（`build-client.mjs` / `prepare.mjs` /
   CI 基线读写 `harness-compat-baseline.mjs`）。
2. **`test/tools/` 比 `test/` 深一层** ⇒ 用 `import.meta.url` 推仓库根时必须退**两层**
   （退一层会把根解析成 `test/`，症状是"文件没了"的 ENOENT）。`verify-module-layout` 有断言。
3. **守卫的判据先剥注释再判**：本目录里大量存在说明"夹具长什么样"的散文，而夹具本身就是
   合成的 `import … from '…'` 字符串 —— 不剥注释的判据会被自己的负对照绊倒。
4. **新守卫只按"域"判定，没有登记动作**：判据的域应当**从磁盘枚举**，而不是靠一张手工维护的
   名单 —— 名单漏一行只会让那个文件**静默脱离判据**。
   ⚠️ 唯独 `test/tools/*.mjs` 与 `test/compat-*.mjs` **仍要在 §4.6 点名**。
5. **负对照必须把变异输入喂进「同一条判据」**：判据只在**一侧**定义 —— 命名函数、
   或命名的正则常量 —— 正判据与负对照都调它。两种写法不算数：
   - ① **只断言某个常量 / 数组不含 X**：判据根本没被执行，判据空转时它照样绿；
   - ② **在对照里另抄一份判据**（复制正则、复制 `.every(...)`）：生产侧改了它也不会红。
6. **假 React 必须像 React 一样校验子节点**（每个替身的 `createElement` 都插了同一段 `assertChildren`）：
   对象不能作为子节点（React #31）。替身若默默收下，这类错**只能在真机上炸** —— 实测踩过：
   在 `React.createElement(...)` 的参数位置上写赋值表达式，表达式的值会变成一个子节点；
   表为空时看不出来，一旦筛出角色整块面板就崩，而当时所有判据全绿。
7. **`test/**` 里不要写 BOM**：`verify-fontset.mjs` 带 shebang，BOM 会让 `node` 在 `#!` 那行报
   `Invalid or unexpected token`。Windows PowerShell 的 `Set-Content -Encoding UTF8` 默认**带**
   BOM ⇒ 批量改写用 `[System.IO.File]::WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding($false)))`。
8. **怎么验证"判据本身有效"**：把判据**中和**成"永远说没问题"，对应的负对照**必须变红** ——
   此时正判据会照过（空转），所以负对照是唯一能抓这类失效的那条。

---

## 5. 改文件头注释（任何改动都要做）

**能写在代码旁的规则不单写文档。** 改行为时，同一次提交里要更新**对应文件的头注释**：

- **不变量**（必须 / 不得）—— 写进文件头；
- **契约**（需要什么外界、对外提供什么）—— 写进文件头，尤其 `src/**`（那一侧没有 `import`）；
- **实测出处**（"实测 X ≈ Y"）—— 留在**被实测的那个位置附近**，这样它是可核对的出处；
- **不要写**：日期、「曾经 / 旧实现」框定、踩坑复盘。

**决策**（有备选方案、有人付了代价的取舍）写进 [`adr/`](./adr/)，不写进文件头；
格式与"什么不该写"见 [`adr/README.md`](./adr/README.md)。

---

## 6. 提交前的自查清单

- [ ] 改过 `src/**` 吗？→ `npm run build`，并把 `lib/client.js` **同一个提交**带上。
- [ ] 改过 `lib/**` 吗？→ 说明"需重启 DSH 生效"。
- [ ] 新增了 `lib/` 下的文件吗？→ 加进 `package.json` 的 `files`。
- [ ] 新增了 `src/**` 文件吗？→ 登记进 `INLINE_MODULES` 并给 `markers`。
- [ ] 新增了设置项吗？→ 只改 `lib/settings-schema.js`，没另写 UI 表。
- [ ] 新增了路由吗？→ `node test/tools/host-route-index.mjs --write` 重算索引。
- [ ] 新增了守卫吗？→ 正负对照成对；工具已进 §4.6；没有去守文档散文。
- [ ] 改过文档吗？→ **没有新增会漂的数值**（改成了符号引用或复算命令）。
- [ ] 写进文档的每个路径 / 每个符号名**都真实存在**（这条最常出错）。
- [ ] `npm run verify` 全绿；`npm run verify:docs` 的结论**没有比改动前更差**。
