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
  - [4.5 怎么写一条新判据](#45-怎么写一条新判据最短路径--十条约定)
  - [4.6 `test/tools/` 清单](#46-testtools-清单都没有-ci-消费者)
  - [4.7 约定（十条，守卫会判）](#47-约定十条守卫会判)
  - [4.8 守卫链在哪（`test/run-guards.mjs`）](#48-守卫链在哪testrun-guardsmjs)
  - [4.9 静态门禁（`npm run verify:static`）](#49-静态门禁npm-run-verifystatic)
- [5. 改文件头注释（任何改动都要做）](#5-改文件头注释任何改动都要做)
- [6. 提交前的自查清单](#6-提交前的自查清单)

---

## 0. 开工前：命令与环境

```sh
npm ci                # 本地取工具链（CI 故意不装依赖，见 CONTRIBUTING.md）
npm run build         # 改过 src/** 之后必须跑：重新生成 lib/client.js
npm run verify        # 硬档（挡 PR）：真机行为 / 发布面 / 平台契约 / 打包面
npm run verify:docs   # 软档（只出声）：模块布局 / 可达性 / 退役线 / 声明孤儿 / 未定义引用
npm run verify:all    # = build + verify + verify:docs + smoke
npm run smoke         # 节点级行为冒烟
npm run lint          # 静态检查（ESLint；人读，见 §4.9）
npm run typecheck     # 类型检查（tsc；人读，见 §4.9）
npm run verify:static # 静态门禁（棘轮 + 负对照；CI 里是**独立步骤**，不在 verify 链上）
```

**链条每档分别有哪些守卫、失败意味着什么**，真源是 `test/run-guards.mjs` 的 `MANIFEST`
（有序清单 + 档位）—— `package.json` 的四个脚本只是指向它的**衬套**
（`verify` / `verify:docs` / `smoke` / `verify:all`），不再是字符串链条。**别把条数记在这里**
（会漂）。分档判据见本文 §4.2，清单结构与改法见 §4.8。

**改 `lib/**` 必须重启 DSH**；改 `src/**` 必须 `npm run build`。这两条不对称，是本仓最常见的操作失误。

---

## 1. 加一条宿主路由

**落点**：`lib/routes/<族>.js`；若这一族**属于某个组件行**（路由与浏览器可见面随行开关启停）
⇒ `packages/<组件>/lib/routes/<族>.js`（P-F 起组件行已全部出户，如 `packages/about-notice/`；
**必须落 `lib/routes/` 这一层**，否则 `docs/ROUTE-INDEX.md` 会静默少行），
由该行入口装配（归属判据见 [`ARCHITECTURE-SPLIT.md`](./ARCHITECTURE-SPLIT.md)）。只有当这一族**已经成规模**时才单独成文件，
否则就近放在已有的族里（准入条件见 `CODE-STRUCTURE.md` §4）。

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
| 门面 `lib/index.js` 里把依赖传进这个族的 context 对象（组件行 ⇒ `packages/<组件>/lib/index.js`，P-F 起组件行已全部出户） | 路由模块**不得继承**门面的 import（守卫 `verify-module-layout` 的『路由模块不得"继承" lib/index.js 的 import』会判）；族的 `DEPS` 声明与调用点实参键**双向对账**（守卫 `verify-inject-contracts`，少给 / 多给都算红） |
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

上限常量**从 context 取**（`c.CONTROL_JSON_MAX_BYTES`，小控制面 JSON 统一 64KB；**定义**在
`lib/http-body.js`（收体器旁边，单一真源），不变量写在 `lib/routes/upload.js` 文件头）。大载荷（上传 / 抓帧 / 自定义画面）走
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
| **`test/*-smoke.mjs`（冒烟）** | 节点级行为冒烟：轮换、实时帧回填与身份校验、字体集加载 | `npm run smoke`（在 `verify:all` 里） |
| **`test/e2e-*.mjs`（端到端）** | 真浏览器路径（需本机 Chromium 系浏览器） | `npm run verify:e2e`（不进 verify 链） |
| **`test/compat-*.mjs`（适配）** | 真 harness 集成面，三个入口：`compat-harness-live` —— 插件进真实 `@deepseek-ai/dsh` 并启动，断言宿主路由注册可达 / 落盘诊断出现探活标记 / 插件树无加载失败（自带 HOME 隔离与 `DSH_WE_MEDIA_LEGACY=1`，媒体桥等第三方全程不拉起）。**两条安装通道**：`--channel link`（默认，软链工作区）与 `--channel tarball`（先 `npm pack`、再把 **.tgz** 装进去）+ `--fresh` —— **tarball 通道是 `peerDependencies` 能否在安装闭包里解析的唯一判据**（软链不参与依赖解析，结构性地看不见这一类）；它还带"通道自证"（装进去的是真目录而非软链）与两条针对性的失败串断言（`peer validation failed` / `does not resolve from the installation closure`）。CI 里两条通道各跑一步；`compat-harness-surfaces` —— UI 面清单棘轮（已装 harness 的 `dsh-client-ui-*` 与 `test/fixtures/harness-ui-surfaces.json` 做差，**新表面未登记即红**）+ sidebar 源码活判据；`compat-harness-pages` —— 无头浏览器**逐页 DOM/样式断言**（零依赖 CDP 走计算样式探针；`--dump` 为探查模式） | `.github/workflows/harness-compat.yml`（需网络、`dsh` CLI 与 Chromium 系浏览器，不进 verify 链） |
| **`test/tools/`（工具）** | 诊断 / 分析 / 生成 —— **没有 CI 消费者**，靠手敲（清单见 §4.6） | 手动 |

### 4.2 两档：硬档挡 PR，软档只出声

判据多少不是问题，**所有判据共用同一种红**才是问题：一次文档排版改动与"发布面漏一个文件"
若共用同一条命令失败，改一行的合规成本就等于改发布面。因此按**失败的含义**分两档：

| 档 | 什么时候红 | 谁跑 | 清单 |
|---|---|---|---|
| **硬档** | 失败意味着**用户会撞上**：真机行为、发布面、平台契约、打包面 | `npm run verify`（在 `verify:all` 与 CI 里） | 真源是 `test/run-guards.mjs` 里 `tier: 'hard'` 的条目 —— **不在这里列清单**（删/加守卫都会让它过时，本仓真实发生过）。其中 `verify-media-bridge` 是**软档**条目且带 `probe: true`（经 `test/warn-only.mjs --probe-spawn`：环境起不了子进程时**点名式 SKIP**）；CI 的 `verify:bridge` 变体另有两道门（平凡调用探针 + 产物 sha256 可信度），只有都指向环境才允许记"环境跳过"并点名 |
| **软档** | 失败意味着**仓库内务 / 一次性清理的验收判据**不准了 —— 要人回来看，但不该拦住别人的改动 | `npm run verify:docs`（在 `verify:all` 与 CI 的一条 `continue-on-error` 步骤里） | 同样是 `test/run-guards.mjs` 的 `docs` 组（**步数与清单的真源都在那里**；含模块布局 / 可达性 / 退役线 / 声明孤儿 / **未定义引用** / 守卫映射 / 守卫链），每条 `tier: 'soft'` ⇒ runner 经 `test/warn-only.mjs` 起它 |

> **软档里只剩"守代码"的守卫。** 此前软档还有两条守**文档 / 注释散文**的守卫
> （`verify-comment-discipline` · `verify-ledger`），已随
> [`adr/0006`](./adr/0006-comment-discipline-as-written-convention.md) **整体下线**：
> 写作纪律改由约定承担 —— 它们守的是"作者该怎么写"，而这类判断一旦降级成正则匹配，
> 作者就会去躲词表，且守卫自身会腐化与自相矛盾（详见该 ADR）。
> 留下的软档**全都读代码**：模块边界、可达性棘轮、退役线、声明孤儿，以及后来新增的未定义引用
> 与两张派生映射（守卫映射 / 守卫链）—— 那里的失败是客观的。

软档**照跑、照打印 `✓/✗`**，只是退出码被 `test/warn-only.mjs` 这层包装降级：
原码打在末尾的 `[warn-only] 软档守卫原退出码 = N` 行上，`test/run-guards.mjs` 解析的就是那一行。
（早先这里还写着"并写进 `DSH_WARN_ONLY_EXIT`" —— **那是错的**：在自身进程里 `set` 的 env 传不给
父进程，全仓也没有任何读取点，该赋值已删。）
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
4. **不给归档文档加新判据** —— 归档件只作记录、不反映现行实现，不为它新增守卫。

**动机一句话**：根因是**所有判据共用同一种红** —— "用户会撞上"与"仓库内务失真"这两种失败长得一样，
合规成本就被最贵的那条判据决定；分档拆开了"谁决定红绿"，而 ADR-0006 进一步把"守散文"的那几条
**整条去掉**，而不是继续养着它们。

### 4.3 怎么跑（运行矩阵）

**真源是 `test/run-guards.mjs` 的 `MANIFEST`**（`package.json` 的四个脚本都只是
`node test/run-guards.mjs <组>` 的衬套）—— 下面是"什么时候跑哪条"，**不列条数**（会漂）。

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

### 4.5 怎么写一条新判据（最短路径 + 十条约定）

**最短路径**：

1. **决定放哪一层**（§4.1 + §4.7 约定 1）：行为 → 冒烟；真浏览器 → e2e；结构 → 守卫。
2. **正负对照成对**，且**共用同一个判据函数**（§4.7 约定 5）——这是最常写错的一条。
3. **先断言域非空**（且地板本身要写在 `if (x) { … }` **外面** —— 写进条件块里同样恒真），
   否则"零残留"这类判据会在空域上恒真。
4. **剥注释用字符串感知实现**（`test/tools/js-text.mjs`），别用朴素块注释正则。
5. **验证判据本身有效**：把判据中和成"永远说没问题"，负对照**必须变红**（§4.7 约定 8）。
6. 新工具 / `compat-*` 要在 §4.6 点名（守卫会判"不许有没人知道的工具"）。

**⚠️ 不要加"守散文"的守卫。** 判据若去正则匹配**文档里的措辞或数字**，它守的就是编辑而不是腐化：
句子一改写，判据就从"复算"退化成"守住那两句话"。这条边界由
[`adr/0006`](./adr/0006-comment-discipline-as-written-convention.md) 定死，`CODE-STRUCTURE.md` §6
还专门留了一张"已从本表撤除"的清单记载它。

**⚠️ 判据会腐烂，而腐烂有三种形态**（都实测发生过）：

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
| `assert-harness.mjs` | 两个大守卫（`test/verify-scene-live.mjs` / `test/verify-client.mjs`）共用的**判据工具**：计数打点 `createCheck()`、CRLF 归一 `normCrlf()`、取函数体 `fnNameBody()`（首个 `\n}`，朴素截断是契约）、配平大括号 `braceBody()`（跳过字符串 / 模板串 / 注释里的花括号）。**行为逐字节冻结**：迁移前后守卫的 PASS 数必须一致 | 守卫 `import` 消费，无 CLI |
| `audit-fixture-coverage.mjs` | **夹具是不是把被测行为中和掉了** | `node test/tools/audit-fixture-coverage.mjs` |
| `audit-guard-teeth.mjs` | 守卫"牙齿"普查 A–F（对照没被评估 / log 式伪判据 / 零引用判据 / 恒真 / 无红出口 / 朴素剥注释吃代码）—— **只给候选** | `node test/tools/audit-guard-teeth.mjs` |
| `audit-import-closure.mjs` | `lib/` 的**运行时导入闭包** vs `package.json` 的 `files`（缺文件 ⇒ registry 装上就崩） | `node test/tools/audit-import-closure.mjs` |
| `audit-write-only-state.mjs` | `test/**` 里**只被写、从不被读**的局部变量与对象字段（eslint 作用域 + AST 引用面）—— **只印候选、不判红、不登记进链**：四类结构性假阳（外部工具参数 / 断言期望值字面量 / 身份标记桩字段 / DOM 桩完整性字段）说明这条规则现在还不是机械可判的，文件头写了升级成守卫的前置条件 | `node test/tools/audit-write-only-state.mjs [--all]` |
| `branch-notify.mjs` | **分支级**"改了 store 却没通知" —— **只印候选供人读**：改动 `src/client.js` 的 store 处理器之后跑一遍，逐条判"这条路径该不该通知"（该通知 ⇒ 改代码；误报 ⇒ 属文件头「已知边界」那几类）。真正的判据是 `verify-client` ①h/①i（与本工具共用同一份实现） | `node test/tools/branch-notify.mjs audit` |
| `child-out.mjs` | **拿子进程输出的唯一方式**（本仓）：受限环境**禁子进程管道**，而 `execFileSync` / `spawnSync` 默认就是 pipe ⇒ `EPERM`，判据里"读 runner 的 `--list-json` / 检查子进程输出"会因此**假红**（看起来像链坏了）。收敛到这一处：`runNodeCaptured()` 把 stdout 落到 `.test-cache` 临时文件再读回，`runNodeStatus()` 只要退出码（`stdio: 'ignore'`，不建管道） | 守卫 `import` 消费（如 `test/verify-package-files.mjs`），无 CLI |
| `ci-workflow.mjs` | **CI 步骤表自身**的解析与判据（`test/verify-ci-steps.mjs` 用它，R-7）：刻意**零 import**（链上零裸依赖，也不引 YAML 库）⇒ 手写行扫描把 `.github/workflows/verify.yml` 折成步骤表，`auditCiWorkflow()` 判 `npm run` 序列恰好、脚本名真实存在、`continue-on-error` 只允许且必须出现在 `verify:docs`、存在带 `git ls-files` 的 bash 出库步、`npm ci …` 在首个 `npm run` 之前；**正判据与全部负对照共用这一个纯函数**（变异文本喂回它，真文件不动） | 守卫 `import` 消费，无 CLI |
| `diagnose-web-blank.mjs` | 网页壁纸「白屏」排查台（无头真浏览器） | `node test/tools/diagnose-web-blank.mjs` |
| `guard-chain.mjs` | **守卫链与冻结 fixture 的对账判据**（`test/verify-guard-chain.mjs` 用它）：把 `test/run-guards.mjs --list-json` 折成可比形状，逐条比成员 / 顺序 / 档位 / 参数，另有地板、死路径、组合三组派生判据 —— 抽出来是为了**正判据与负对照走同一段代码**（§4.7 约定 5） | `node test/verify-guard-chain.mjs [--write-fixture]` |
| `guard-targets.mjs` | **「哪个守卫管哪个模块」的派生映射**（从守卫**代码**里派生，不维护清单）：`--write` 重算生成物 `docs/GUARD-MAP.md`；改了某模块后查"该跑哪几条"就看它 | `node test/tools/guard-targets.mjs [--write] [--json]` |
| `host-route-index.mjs` | 生成 / 核对**宿主路由索引**（产出 `docs/ROUTE-INDEX.md`） | `node test/tools/host-route-index.mjs [--write]` |
| `i18n-scan.mjs` | 源码里的**中文字面量**扫描（判"进没进 `weT(...)`"；迁移与 `verify-i18n` 共用同一实现） | `node test/tools/i18n-scan.mjs [--json] [paths…]` · `selftest` |
| `js-text.mjs` | JS/TS 源码的**文本级**工具（字符串 / 正则感知的剥注释） | `node test/tools/js-text.mjs selftest` |
| `m2-facade-code-share.mjs` | **门面「非装配代码」占比（M2 口径）的复算**：逐字符扫描（跳过字符串 / 模板串 / 注释 / 正则）求出每行净括号增量 ⇒ 把**顶层语句**分成 `assembly`（体内出现 `ctx.` 或 `registerXxxRoutes(`）/ `code` / `other`，报 `nonAssemblyShare` 等四数。段窗走**内容锚点**（锚点全缺即非 0 退出 —— 宁可不算，也不输出一份可能误导的段表）；`--plan-legacy` 复现计划时代的硬编码段窗 | `node test/tools/m2-facade-code-share.mjs [文件] [--list] [--plan-legacy] [--self-check]` |
| `multi-source-mutants.mjs` | **多源变异体加载器**（守卫共用的基础设施）：一条负对照可能横跨多个模块，本工具按"源键 → 文件 / 工厂导出名"把 `[源键, find, replace]` 的编辑打在该源的文本上，并内置三件纪律 —— **命中自检**（锚点落空 / 空转编辑 / 未知源键 / 取不到工厂导出都即抛，防"变异体 = 原版 ⇒ 负对照假绿"）、源码先归一 LF（锚点写的是 `\n`）、相对说明符改写成绝对 `file:` URL（变异体住 `.test-cache/` 仍能 import 真源模块）。消费者：`verify-asset-paths` / `verify-cache-prune` | `import { makeMultiSourceMutants } from './tools/multi-source-mutants.mjs'`（库，无 CLI） |
| `regen-golden.mjs` | **设置 golden 夹具的漂移核对与重录**：逐侧列出与当前 `lib/settings-schema.js` 的差异（host 侧的值有判据管、client 侧没有），写入必须先声明意图（`--intend`）—— 防止把缺陷输出自动录成"期望" | `node test/tools/regen-golden.mjs [--write --intend <host\|client>:<键>]` |
| `repo-face.mjs` | **「仓库扫描面」的唯一口径**（本机脏面 ⇒ **假绿**）：判据自己 `listFiles + SKIP_DIRS` 现算面时，**本机多出来的副本**会一起进面（仓库里嵌着另一个完整 git worktree、被 `.gitignore` 忽略的本地目录）⇒ 本机恒绿、CI 才红（实测：消费者面本机 1483 个代码文件 vs 干净检出 263 个）。两条口径都要：① **嵌套仓库一律不扫**（任何目录里出现 `.git` —— 目录，或 linked worktree 的 `.git` 文件）；② **gitignore 的本地目录按 `DEFAULT_SKIP` 名单不扫**（名单是**实测**出来的，加条目要写理由，不许"把不确定的都塞进来"）。另有 `gitTrackedFiles()` / `gitViewDiff()` 拿 **`git ls-files` 当独立真源**对账：走出来的文件不在 git 视角 ⇒ 要么是被有意忽略的产物（`allowedExtra` 逐条说明）、要么判红；git 视角里的代码文件没被走到 ⇒ 面变窄 ⇒ 判红 | 守卫 `import` 消费（如 `test/verify-settings-schema-exports.mjs`），无 CLI |
| `sidebar-props-scroll-rig.mjs` | 侧栏「壁纸属性」下钻的**真浏览器滚动判定台**：属性多的壁纸能不能滚到底（官方壳的页签内容区固定高 + overflow:hidden，面板必须自带滚动） | `node test/tools/sidebar-props-scroll-rig.mjs [bundle.js] [label]` |
| `source-locator.mjs` | **真源定位器**：给符号名 / 文件名，回答"它**唯一的**声明处 / 落点在哪" —— 命中恰一处才 `ok`；命中 **0 处**（符号被重命名/删除）或 **多处**（出现第二份真源）都判红，判据因此能写"**缺锚即红**"而不是"找不到就用默认值兜底"。三条硬口径：先剥注释（共享 `js-text.mjs`，散文里的符号不算声明）、只认可缩进的真实声明语句（**缩进不作为"是不是顶层"的判据**，唯一性才是契约）、生成物 `lib/client.js` 不算真源（否则 `src/` 每个符号都"命中两处"而恒红） | `node test/tools/source-locator.mjs <符号\|文件> [--in lib\|src]` · `--selftest` |
| `src-scope.mjs` | **构建期内联族**（组装点 + 域模块）的按序读法：清单从 `scripts/build-client.mjs` 的 `INLINE_MODULES` 现算（单一真源），供守卫读"同族并集"：`parseInlineModules()` / `scopeFiles(prefix)` / `scopeText(prefix, sep?)`（API 已冻结，空族抛错防静默全绿） | 守卫 `import` 消费，无 CLI |
| `token-contract.mjs` | **`--dsw-*` 令牌契约的生成与核对**（共存审计 S2）：从 `src/styles.js` 的 CSS 模板现算「改写了哪些 token、在哪个门控下」，`--write` 重算生成物 `docs/TOKEN-CONTRACT.md`（守卫 `verify-token-contract` 逐字节比对） | `node test/tools/token-contract.mjs [--write] [--stats]` |
| `underlay-pixel-rig.mjs` | **画布兜底色**的真浏览器像素对照：壁纸的像素没送到屏上时，页面自己画的是什么颜色（掉层 → 白闪还是同色底） | `node test/tools/underlay-pixel-rig.mjs <bundle.js> [label]` |
| `fx-perf-rig.mjs` | **光效层帧耗时对照**（issue #190）：真浏览器里跑真的 `packages/fx/src/fx-layer.js`，灌固定指针轨迹 + 周期性点击，报帧间隔 mean / p50 / p95 / max。A/B 走两份 `fx-layer.js` | `node test/tools/fx-perf-rig.mjs <fx-layer.js> [label]` |
| `weT-shim.mjs` | 给**单独 import `src/**`** 的守卫装身份译文层（`weT(k) === k`，与 bundle 里中文态逐字一致） | `node test/tools/weT-shim.mjs` |

> 其中 `host-route-index.mjs` / `js-text.mjs` / `branch-notify.mjs` / `guard-chain.mjs` /
> `src-scope.mjs` / `assert-harness.mjs` / `child-out.mjs`（被 `verify-package-files` 直接 import）/
> `source-locator.mjs`（被 `guard-targets.mjs` 消费，其 `--selftest` 由 `verify-guard-map` ⑥e 挂上链）/
> `repo-face.mjs`（扫描面口径，被 `verify-settings-schema-exports` 等直接 import）
> **同时是守卫的库** ⇒ 改它们等于改判据，走 `npm run verify:all`。
> 另有 **`test/warn-only.mjs`**（不在本清单里）：两档共用的**入口包装** —— 降级退出码
> 与"本环境起不了子进程就显式 SKIP"。它自己不是判据，所以没有独立守卫覆盖它。

### 4.7 约定（十条，守卫会判）

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
9. **期望值不许与被测对象同源**：判据的期望值要么来自**独立来源**（规格、夹具、真跑产品、独立的第二实现），
   要么明确声明成**漂移棘轮** —— 只证明"没有无理由地变化"，不证明取值正确，且这句话要写进断言文案 /
   夹具的 `note` 里（范式：`test/fixtures/settings-sanitize-golden.json` 的 `note` 与
   `test/verify-client.mjs` 的漂移断言）。在测试里**重打一份产品算术 / 正则 / 文案**再拿它当期望，
   是约定 5 ② 的孪生形态：产品改了，两份一起改，判据永远绿。
10. **逃生门必须带覆盖面地板，且跳过不得与通过同形**：`--allow-skip` / 环境跳过 / `warn-only` 这类出口要
   同时满足两条 —— ① 真跑过多少条判据有个**下界**（前置不足 ⇒ 非零退出）；② 跳过在输出里**点名**
   （范式：`test/compat-harness-pages.mjs` 的 `SKIP_MIN_CHECKS`、
   `test/e2e-web-media-origin.mjs` 的 `PRE_BROWSER_MIN_CHECKS`、`test/warn-only.mjs` 的具名 SKIP）。

### 4.8 守卫链在哪（`test/run-guards.mjs`）

**链条的形状是一份数据，不是一行 `&&` 字符串。** 四组清单都写在 `test/run-guards.mjs` 的
`MANIFEST` 里（`verify` / `docs` / `smoke` 三个步骤表 + `all` 的组合），
`package.json` 的四个脚本各自只是一行 `node test/run-guards.mjs <组>` 的衬套。

**为什么**：旧写法里 `verify` 是 `package.json` 里一行 1.6KB、43 条 `&&` —— 想断言
"链里漏没漏某条守卫"只能去正则抠那行字符串，字符串一改判据就静默缩水。清单落成数据后，
`test/verify-package-files.mjs` 的 P5 直接读 `--list-json`。

**一条步骤的形状**（`step(file, args, tier, probe)`）：

| 字段 | 含义 |
|---|---|
| `file` | 仓库根相对的守卫路径 |
| `args` | 该守卫的命令行参数（逐字抄，如 `['--allow-skip']`） |
| `tier` | `'hard'`（挡 PR，失败即整组非零）/ `'soft'`（经 `test/warn-only.mjs` 降级，永不让组红） |
| `probe` | 软档专用：带 `--probe-spawn`（环境起不了子进程时**点名** SKIP） |

**加 / 删一条守卫**：改 `test/run-guards.mjs` 的对应步骤表 —— 一处改动，不是两处。
两个不变量：

- **顺序 = 执行顺序**，不得重排：链里有依赖前一步副作用的守卫（`verify-client-sync` 重建产物后
  `verify-client` 才读它）。
- **新守卫文件必须登记进清单**，否则它不进链、P5 也看不见它（与 §4.7 约定 4 的
  "从磁盘枚举、不靠名单"是**例外关系**：链是**有意的有序清单**，不是"域枚举"）。

**读清单（不执行）**：

```sh
node test/run-guards.mjs verify            # 跑 verify 组（缺省）
node test/run-guards.mjs verify --list     # 只打印该组的等价命令串（` && ` 连起来）
node test/run-guards.mjs verify --list-json # 机器可读的有序步骤表（P5 取源头）
```

**退出码语义**（与旧 `&&` 链逐条等价，别在 runner 里重写它）：
硬档步骤非 0 ⇒ 立即以**同一个退出码**退出（短路）；软档步骤非 0 ⇒ 打印
`⚠ … 已由 warn-only 降级` 后继续 —— 降级语义仍**只在** `test/warn-only.mjs` 一处定义。

⚠️ **runner 起软档时传的是"仓库根相对路径"，不是绝对路径**：`test/warn-only.mjs` 的契约就是
收相对路径并自己 `join(ROOT, target)`，喂绝对路径会被它拼成 `<ROOT>/<绝对路径>` ⇒ 每条软档都以
合成码 2 退出（全组变成"看着绿、其实一条没跑"）。**这个坑真实发生过**，所以 `runStep` 里两侧
刻意不一样：硬档直连 `node` 传绝对路径，软档传 `s.file`。

**链的形状由 `test/verify-guard-chain.mjs` 钉住**（软档，在 `docs` 组里）：它把 `--list-json`
折成可比形状，与**冻结在提交里的** `test/fixtures/verify-chain.json` 逐条比成员 / 顺序 / 档位 /
参数，另加地板、死路径、`all` = 四段有序拼接三组派生判据，**共 14 条判据，其中 8 条是负对照**
（条数与"其中几条是负对照"都由该守卫的 `✓` / `✓ 负对照` 行现报，别在这里抄数字）。
有意改链（加/删/换顺序/换档位）⇒ 必须 `node test/verify-guard-chain.mjs --write-fixture`
重冻结，**并与改动放进同一次提交**；只改链不重冻结会被它拦下（这正是它的用途：P5 只钉
"零裸包 + 条数不低于地板"，**允许**换掉一条守卫；它钉的是"链的成员与顺序逐字不变"）。

⚠️ **改"怎么跑"的东西时，`--list` 等价不等于执行等价。** 静态等价证明（比对 `--list` 渲染出的
命令串）只覆盖清单本身；`runStep` 的 argv、cwd、env、退出码解读都**不在** `--list` 里。本仓的
做法是两样都要：`--list` 逐字 diff **加上**至少一次真跑该组的端到端证据（上一条坑就是只有前者
时漏掉的）。

⚠️ **跨模块契约要两侧各钉一次。** 一处"约定俗成的形状"若只有一侧写判据，改另一侧就能悄悄失配。
样本：`lib/kernel/config.js` 的 `atomicTmpPath()` 产物必须让 `lib/media/transcode.js` 的
`sweepTranscodeArtifacts()`（`.tmp\d*$` 孤儿清扫）认出来 —— `test/verify-cache-prune.mjs` 钉清扫侧的行为，
`test/verify-config-store.mjs` 的
跨模块判据拿**真**清扫套件对钉（本进程 pid 的产物被留住、别的 pid 的同类产物被清掉）。任一侧改
形状，两侧都得红。

⚠️ **"派生键查表"要自带体检。** 判据里凡是用**派生出来的键**（如按组名拼 `<组>:<档>`）去查一张
地板 / 白名单表，键写错时查不到 ⇒ 判据静默失效（恒真、不报错）。样本：P5 的地板表键写成
`'verify:all'`、查表却按组名 `all` ⇒ 取到 `undefined`，地板整条失效。写这类表时另外加一条
"表的键集与主键集合逐一对齐"的体检。

⚠️ **变异体规格写扁了 ⇒ 变异体其实什么都没改。** 变异体常写成"若干 `[find, replace]` 二元组"，
若调用方把整组写成 `['find', 'replace']`（少一层数组），`for (const [f, r] of transforms)` 会把
**字符串按字符**解构（`f = 'i'`、`r = 'f'`）⇒ 只把源码里第一个 `i` 换成 `f`，行为不变，
而"变异体必须判红"的判据照样恒绿。样本：`test/verify-host-diag.mjs` 建守卫时的第一轮 9 条红。
对策不是"写的时候小心"，而是**加形状判据**：断言规格形状是 `[标签, [[find, replace], …]]`
（见该守卫的 H5），写扁立刻红。

⚠️ **"变异体没被判红"要先查夹具是否真进了那条分支。** 钉"轮转只留一代"时，夹具先把盘上文件
删掉、再让 kit 第一次写入 ⇒ 水位探测得 0，走的根本是"不轮转"那条分支，于是删掉 `rename`
的变异体照样绿。夹具要顺着**被测代码的分支条件**造：先播一个略低于上限的文件、让第一次写入
把内存水位推过上限，再删文件 ⇒ 第二次写入才真进 `rename` 分支。

⚠️ **"规格里写明的退化面"要与"实现里真能退化的面"逐条对齐。** 样本：`lib/upload-store.js` 的
`readUploadMeta()`，文件头不变量写"缺失 / 坏 JSON / 非对象 ⇒ `{}`"、守卫规格也把 `'[]'` 列进"非对象"，
而实现只判 `typeof o === 'object'` —— **数组在 JS 里 `typeof` 同样是 `'object'`** ⇒ `[]` 被当账本读入；
随后 `m[id] = {…}` 给数组加的是**非索引属性**、`JSON.stringify([])` 仍是 `"[]"` ⇒ 此后**每一次写盘都
静默丢掉**（`/upload` 的 sha256 去重永久失效）。做法：写规格时把"哪些输入算退化"逐条列全（含语言层面
最容易漏的 `[]`、`null`、`NaN`），再**逐条对着实现核**一遍，而不是"多想一遍"；这类缺口是"语言事实吃掉
规格"，光想是想不出来的。

⚠️ **变异体要落在真实的可观察差异上，不能只是"看起来更差"的写法。** 样本：给 `setUploadMeta` 提议的
变异体"把 `enqueueConfigWrite` 换成 `(fn) => fn()`"**抓不住任何东西** —— 该模块的"读整份 → 改一条 →
原子写回"三步是**同步**的，同一 tick 里顺序执行本来就不会交错，"绕过队列"并不制造交错。要有牙得换
**可数 / 可序**判据："每一次写都经过注入的队列（25 路并发 ⇒ 计数 25）"与"套件的写排在先前入队的慢任务
之后"（见 `test/verify-upload-store.mjs` 的 E1/E2；`bypass-queue` 变异体 ⇒ 计数 0、顺序里没有
`module-write`）。判据想不出"可观察后果"时，先怀疑判据本身，而不是换个更弱的变异体。

**清单漂了怎么发现**：runner 执行前先自检清单里每个 `file` 真实存在（不存在 ⇒ 退出码 2）；
`test/verify-package-files.mjs` 的 P5 从 `--list-json` 取有序清单与档位，钉住"链上零裸包依赖"
与"硬档条数不低于地板"。两侧的**逐字等价**由 `--list` 的渲染串与旧 `package.json` 字符串
做一次纯文本 diff 来证明（切链的那一次，结论记在该次提交的说明里）。

---

### 4.9 静态门禁（`npm run verify:static`）

**这一层补的是"结构性守卫看不见的那类错"**：拼错的名字、不存在的属性、重复声明、被解析器挡在门外的文件。
判据脚本 `test/verify-static.mjs`，配置 `eslint.config.mjs`（文件头写了两套半边的口径）与 `tsconfig.json`。

**它不是"零违规"，而是棘轮。** 50k 行历史代码一把修到零＝一场无法审查的改动（本仓铁律"不做无判别力的
批量文本替换"要挡的正是这个）。基线冻在 `test/fixtures/static-baseline.json`：

- **ESLint 按 `ruleId` 计数**（不按行/文件：规则级计数对"把代码挪到别的文件"稳定，行级基线一重构就碎）；
- **tsc 按错误码计数**；
- 另加**扫描面下限**（`filesLinted`）—— 只钉计数的话，往 `ignores` 加一条就能靠"少看文件"变绿。

**任一格上涨即红**；基线里**没有**的规则名，配额视为 0（新规则一条即红）。
有意收紧（修完一批后把地板压低）⇒ `node test/verify-static.mjs --write-baseline`，**并随同一次提交入库**。
读当前基线别抄进文档：直接开 `test/fixtures/static-baseline.json`。

**为什么是 CI 里的独立步骤、不并入 `verify` / `verify:all`**：链上保持零裸依赖是
`test/verify-package-files.mjs` 的 P5 断言（CI 用 `npm ci --omit=peer`），而这两个工具是 devDependencies。
把它塞进链里会为了"多跑一门检查"破坏一条真不变量。

**`include` 边界（刻意划的）**：

| 面 | 进不进 | 为什么 |
|---|---|---|
| `lib/**`、`scripts/**` | 进 | 真 ESM 模块，`no-undef`/属性名在这里有牙 |
| `src/**` | ESLint 进、**tsc 不进** | 扁平作用域片段（见 §3 与 `eslint.config.mjs` 头）：`no-undef`/`no-unused-vars` 系统性误报，关掉；tsc 单文件看必然"名字都不存在" |
| `test/**` | ESLint 进（求值手法豁免）、tsc 不进 | 守卫**故意**读畸形输入；`new Function`/`eval` 是判据手段本身 |
| `lib/webwallgl/**`、`lib/we-focus-guard.js` | 进，带浏览器全局 | 物理在发布面、运行期在页面里 |

**它已经抓到的真缺陷**（写在这里是为了说明"这一层值它占的 CI 分钟数"，不是编年史）：
`packages/media-bridge/lib/routes/now-playing.js` 里漏解构的常量（`POST` 带体必 `ReferenceError`）、
`src/client.js` 里两份同名函数（脚本语义下**后声明静默胜出**，删掉活的那份会让死的那份无声复活）、
守卫自身的块作用域越界引用与重复对象键、以及 `tsc` 报出的一批属性名错配。

⚠️ **行内 disable 指令引用的规则名，本身也是判据面的一部分**：`src/client.js` 曾有一处
`eslint-disable-next-line react-hooks/exhaustive-deps`，而本仓不装该插件 ⇒ ESLint 报
`Definition for rule ... was not found`（是**假错误**，但会占一格棘轮预算）。在配置里把该规则声明成
`off` **挡不住**它 —— 报错来自那条指令本身，只能改那一行。**该指令已随客户端半边的改动移除**，
这条口径留着是因为它会以同样形态复发：**写完行内 disable 要确认规则名真的存在**。

**`.editorconfig` 只管三件事**（`charset` / `end_of_line` / 尾随空白与末行换行）：
这是"编辑器别替人改文件"的约定。**格式化决策（缩进宽度、换行位置）刻意不写** —— 一次全局重排会让
review 失去意义；真正的格式守卫是无尾随空白那两条（CI 的 `git diff --check` 与 P8 的 BOM 扫描）。

---

### 4.10 清静态欠账时踩到的四个坑（都是实测，不是推测）

**① flat config 的豁免面必须排在最后。** `@eslint/js` 的 `js.configs.recommended.rules`
**包含** `no-irregular-whitespace`；`src/**` 那个配置块 spread 了它 ⇒ 任何写在**该块之前**的
`files` 豁免都会被**重新打开**（实测：`src/styles-base.js` 里 13 个 U+3000 照红）。而且
`npx eslint --print-config <file>` 显示的是合并后的选项，**看着像已生效** —— 唯一可信的判据是
对着那个文件**单跑** `npx eslint <file>`。本仓把形态级豁免集中放在 `eslint.config.mjs` 末尾的
「豁免面」段，那里的注释写明"必须排在最后"。

**② 对跑守卫的脚本必须同时比 `exit code` + 末行判词，且不得把 127/空输出判成相同。**
macOS 没有 GNU `timeout`：一次 28 文件的对跑全 `exit 127`，脚本却把"两边都 127、判词都空"判成
`SAME`（假绿的典型形态）。退出码 127/126 的含义是"根本没跑起来"，永远不是"跑过了"。

**③ 扁平作用域里的跨片段写入 ⇒ `prefer-const` 是假阳性，靠行内豁免而不是关规则。**
`src/**` 平铺进同一个 factory 作用域，写入点常在**另一个片段文件**里（如 `src/client.js` 的
`let fadingLayerNode` 由 `src/layer-core.js` 写），ESLint 逐文件看不见 ⇒ 硬改 `const` 是运行期
`TypeError`。约定：`// eslint-disable-next-line prefer-const -- 跨片段写入：<文件:行>`，
**不许**因为几条假阳性就把整块规则关掉（同规则在 `src/**` 真收掉过 20 条死 `let`）。

**④ 清完一批欠账要随手压低棘轮地板**：`node test/verify-static.mjs --write-baseline`
（它同时刷 `filesLinted` 扫描面下限）。留着旧地板等于白清 —— 棘轮只挡"涨"，不替你记"降"。

**欠账清零的判据**（本轮收口采用）：每条剩余违规要么**改掉**，要么**行内/形态级豁免 + 就地理由**
（形态级只给"形状本身就是契约"那类：`src/**` 的 `no-var`、页签首行的空解构）。整目录关规则
**不**算清零。

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

- [ ] 改过 `src/**` 吗？→ `npm run build` 先重建产物（产物不入库、无需提交），再跑 verify。
- [ ] 改过 `lib/**` 吗？→ 说明"需重启 DSH 生效"。
- [ ] 新增了 `lib/` 下的文件吗？→ 加进 `package.json` 的 `files`。
- [ ] 新增了 `src/**` 文件吗？→ 登记进 `INLINE_MODULES` 并给 `markers`。
- [ ] 新增了设置项吗？→ 只改 `lib/settings-schema.js`，没另写 UI 表。
- [ ] 新增了路由吗？→ `node test/tools/host-route-index.mjs --write` 重算索引。
- [ ] 新增了守卫吗？→ 正负对照成对；工具已进 §4.6；没有去守文档散文。
- [ ] 新增了 npm 脚本 / 新模块吗？→ **至少真跑一次 `npm run verify`**：新增脚本若引用了未随包发布的
  路径，`test/verify-package-publish.mjs` ⑦ 会红（命令里真有那类引用才需要登记进它的 `DEV_ONLY` 表，
  `lint` / `typecheck` 这种不需要）；新增 `lib/**` / `src/**` 文件会让 `verify-guard-map` ① 报
  "零覆盖"，先让守卫读到它再 `node test/tools/guard-targets.mjs --write`。这两条**不在**改动者的常规
  复跑清单里，只看单跑几条守卫会漏。
- [ ] 改过文档吗？→ **没有新增会漂的数值**（改成了符号引用或复算命令）。
- [ ] 写进文档的每个路径 / 每个符号名**都真实存在**（这条最常出错）。
- [ ] `npm run verify` 全绿；`npm run verify:docs` 的结论**没有比改动前更差**。
- [ ] `npm run verify:static` 全绿（动过 `lib/**`/`scripts/**`/`test/**` 时尤其要看：棘轮只能降不能升）。
