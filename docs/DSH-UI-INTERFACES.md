# DSH UI 接口核查（我们去依赖了什么）

> 这份文档回答一个问题：**本插件（dsh-wallpaper-engine）依赖的 DSH UI 接口，到底是宿主刻意提供的稳定契约，
> 还是我们顺手拧上的内部实现？** 结论按"接口 → 是否存在 → 归属 → 稳定性 → 影响面"记账，便于将来升级前复核。
>
> **只读核查**：全程不改 DSH 本体。文档记录的是**某一次**核查的结论；DSH 升级后应当**重跑复算**（见下）。

## 0. 复算方法（不依赖任何本机专用路径）

DSH 桌面端把整份客户端 + node 宿主打进 `resources/app.asar`（Electron 的明文容器：头部是一段 JSON 文件索引，
后面是各文件内容拼接）。于是**任何接口都能定位到"真源码里的哪个文件、哪个包"**，步骤：

1. 读头部拿到文件表：`jsonLen = buf.readUInt32LE(12)`，`JSON.parse(buf.slice(16, 16 + jsonLen))`，
   递归 `files` 收集 `{ path, offset, size }` 并按 offset 排序 ⇒ 得到"偏移 → 路径"索引；
2. 用 `buf.indexOf(needle)` 在全量字节里找接口名 ⇒ 命中处按索引反查**归属包**
   （路径里的 `node_modules/((?:@[^/]+/)?[^/]+)`）；
3. 类名这类"构建哈希 + 后缀"的接口，不要用裸子串下结论 —— 要读**CSS-module 映射表**
   （形如 `{ "body": "<hash>_body", … }`）里的后缀全集再比对，否则会把"映射表里出现过"误判成"选择器会命中"。

⚠️ 两条踩过的坑：① 打包后的 JSX 里属性写成 **`"data-slot": 值`**（键带引号），搜 `data-slot="` 会漏；
② 值的**归属**要看是宿主写的字面量，还是**运行期由插件注册名决定的变量**（后者在产物里查不到值）。

## 1. 接口不止一层（这本身就是一条结论）

| 层 | 在哪 | 例子 | 我们能查到吗 |
|---|---|---|---|
| **客户端产物** | `app.asar` 里的 `dsh-client-ui-*` 包（浏览器半边） | `data-slot` 槽出口、`--dsw-*` 设计令牌、宿主组件的 CSS-module 后缀 | ✅ 直读 asar |
| **node 宿主 / CLI** | 同一个 `app.asar` 里的 `dsh/*`（`dsh-api-*` / `dsh-host*` / `dsh-plugin*` / `dsh-settings` …） | 插件清单与加载、设置持久化、路由、**URL 查询参数** | ✅ 直读 asar |
| **桌面壳** | 由桌面端进程传给页面（**不在客户端产物里**） | `?dsh-desktop-mode=` / `?dsh-desktop-mica=`（本插件据此判定"壳模式"） | ⚠️ 只能在 node 侧/壳侧查 |
| **第三方插件** | 各自的包 | `data-dsh-better-sidebar`、`.dsh-browser-seat-wrap` | ❌ **不在 DSH 里**（0 命中） |

> ⇒ 一张台账必须**按层**记，否则很容易把"第三方插件的私有属性"当成"DSH 的接口"来赌稳定性。

## 2. 台账（截至本次核查；DSH = 0.2.0-rc.2）

### 2.1 设计令牌（`--dsw-*`）——**目前唯一"完全对上"的一类**

本插件 CSS 里提到的 `--dsw-*` 令牌**全部存在于 DSH**（复算：从 `src/styles.js` 抽出 `--dsw-[a-z0-9-]+` 后逐个
在 asar 里 probe）。而且能查到**归属包** ⇒ 它们是宿主自己的契约面，例如：

| 令牌 | 归属（示例） | 本插件怎么用 |
|---|---|---|
| `--dsw-alias-bg-layer-1/2/3` | `dsh-client-ui-theme` 定义、多个消费 | 接管它做面板玻璃（设置窗口 / 侧栏 / 内容面） |
| `--dsw-specific-input-major` / `--dsw-specific-bubble` | `dsh-client-ui-chat` 等 | 输入卡片 / 消息气泡的透明底 |
| `--dsw-alias-turn-trigger-bg`（+ `-hover`） | `dsh-client-ui-chat` + `-theme` | 思考触发条的**专属底色**（本插件接管，见 §3） |
| `--dsw-static-neutral-bluish-*` | `dsh-client-ui-theme` | 浅/深底色的取值来源 |

**稳定性判定：高。** 令牌是宿主"给主题用的公开面"，改名会比改类名慎重得多；但**语义**（某令牌代表哪一层）
仍可能被宿主重新分配 ⇒ 只对"值"稳定，不对"观感"作保。

### 2.2 DOM 锚点（数据属性）——**分三档**

| 锚点 | DSH 里 | 归属 | 判定 |
|---|---|---|---|
| `data-composer-card` | ✅ | `dsh-client-ui-conversation` 等 | 源码作者写的属性（会话根），**稳**（但注意它不是"气泡"） |
| `data-question-key` / `data-plan-review-key` / `data-approval-key` | ✅ | `dsh-client-ui-user-questions` / `-approval` / `-conversation` | 工具弹卡的**容器**属性，稳 |
| `data-turn-trigger` | ✅ | `dsh-client-ui-chat`（`TurnTriggerNodeView`） | 思考触发条的锚点，稳 |
| `data-sidebar-right-panel` / `data-sidebar-right-open` | ✅ | `dsh-client-ui-sidebar-right` | **既有**右栏适配的落点，稳（上游曾改过隐藏机制，见 `test/compat-harness-surfaces.mjs` 的活判据） |
| `data-slot`（**值由宿主槽注册表决定**） | ✅ 属性存在；`settings.section` ✅ | `dsh-client-ui-renderer` 写出口 | **这是"槽出口"，不是普通属性** —— 见 §3 |
| `data-dsh-desktop-mode` | ❌ 客户端产物 0 命中 | 桌面壳的 **URL 查询参数**，由本插件的 `src/adapter.js` 写到 body | **不是 DSH 客户端接口**（见 §3） |
| `data-dsh-better-sidebar` / `.dsh-browser-seat-wrap` | ❌ 0 命中 | **第三方插件**（better-sidebar / dsh-webui） | 不在 DSH 保证范围内 |

### 2.3 类名后缀（`[class*="_x"]`）——**一半是第三方的**

宿主组件的类名是 **构建哈希 + 后缀**（如 `oE-XyW_root`）⇒ 只能按后缀约定匹配。
复算：从产物里抽 CSS-module 映射表的**后缀全集**，再比对本插件用到的后缀：

| 本插件用的后缀 | 在 DSH 里 | 说明 |
|---|---|---|
| `_bubble` / `_card` / `_panel` / `_editorHeader` | ✅ 存在 | 会话 / 卡片族用得上 |
| `_boundaryError` / `_browserBar` / `_explorerHeader` / `_gitHeader` / `_pane` / `_paneCard` / `_tabBar` / `_terminalWrap` | ❌ 不存在 | 这些是 **dsh-better-sidebar 的类名**（第三方）⇒ 只能随该插件漂移 |

**稳定性判定：低。** 即使后缀存在，哈希前缀每次宿主重建都会变；后缀本身也不是契约（宿主可以把 `_panel` 改名）。
⇒ 这类锚点只能当"尽力而为的兜底"，**不能**把用户可见功能挂在它上面。

### 2.4 node 侧（宿主 / 插件清单 / 服务注入）

| 接口 | 我们怎么用 | 宿主侧证据 | 判定 |
|---|---|---|---|
| `package.json` 的 **`dsh.bundle.patch`** | 指向 `./cordis.patch.yml`，由它插入插件条目 | 宿主文档（`host-plugin.md`）："A **bundle** is a package whose `package.json` declares `dsh.bundle.patch`; the YAML patch inserts plugin entries" | **官方机制**，稳 |
| **`dsh.client.platform` / `.immediately` / `.inject`** | 声明 `platform: "web"`、`immediately: true`、`inject: ["@deepseek-ai/dsh-client-runtime"]` | 宿主文档（`ui-plugin.md`）：`dsh.client` 段就这三项 + `./client` 导出；`practices.md` 另说 `dsh.client.inject` 条目**"only order activation"**，且 **"They change without notice"** | **明确不保证稳定**（但我们只用它排序激活 ⇒ 风险有限） |
| `dsh.client.external` | **未使用** | 同一文档：非基线的运行时 import 要在这里声明 | 与我们无关（客户端半边没有外部 import） |
| `exports["./client"]` | 导出 `lib/client.js` | 宿主文档：浏览器产物注册一个 **id 等于包名的 lazy factory**；React 由浏览器模块表提供 | 我们符合（有 `./client` 导出 ✓） |
| **peer 包** | `@deepseek-ai/cordis` ^4.0.1 · `dsh-client-runtime` ≥0.2.0-rc.1 · `dsh-client-ui-slots` ≥0.2.0-rc.1 · `dsh-host-webserver` ≥0.2.0-rc.1 · `react` ^18.2.0 | 已装：cordis **4.0.4** ✓ · slots **0.2.0-rc.2** ✓ · host-webserver **0.2.0-rc.2** ✓ | 版本都满足；⚠️ `dsh-client-runtime` / `react` 在产物里**找不到同名磁盘包** ⇒ 它们是**客户端模块表里的运行时 id**（文档："React comes from the browser module table"），我们声明它是**激活排序**用途 |
| **cordis 服务注入** | `ctx.effect` / `ctx.on`（注册即清理，官方要求的形状）· `ctx.slots` · `ctx.webServer` · `ctx.logger` · `ctx.locale` | 宿主文档（`ui-plugin.md` / `practices.md`）："register styles, timers, listeners… inside `apply` with `ctx.effect`/`ctx.on` and return their cleanup functions" | **官方机制**，稳 |

⚠️ 统计口径的一个坑：`lib/**` 里还有 `ctx.canvas` / `ctx.drawImage` / `ctx.getImageData` / `ctx.fit` ——
那些是**我们自己的渲染上下文**（canvas 2D / 内部渲染 ctx），不是 cordis 注入面。审计时别把两者混成一类。

## 3. 与预想不同的几条（本次核查的主要产出）

### 3.1 DSH 有一套**正式的、带文档的槽系统**，而我们钉的是"渲染后的 DOM"

- 包：`@deepseek-ai/dsh-client-ui-slots`（纯核心：注册表 / 类型推导 / store 席位）+ `dsh-client-ui-renderer`（渲染器）；
- **asar 里就带中文文档**（`dsh-client-ui-slots/README.zh.md`）：四种 kind —— `single` / `list` / `keyed` / `chain`；
  插件用 `ctx.slots.registerFactory()` 注册，父级声明 slot；渲染器往出口写 `data-slot={slotKey}`；
- 宿主真实槽名（从产物里的点号字符串字面量抽，示例）：`settings.section`、`conversation.chat.node`、
  `conversation.composer`、`conversation.input.dock`、`sidebar.right.pane.tab`、`shell.overlay`、`tool.call.toolview` …
- ⇒ **本插件的接法是"注入 + 给渲染结果上色"**：我们**用**了槽系统（`ctx.slots.inject("settings.section", …)`
  与 `ctx.slots.inject("sidebar.right.pane.tab", …)`，随后 `ctx.slots.register(…)`），
  宿主把注册内容渲染进那个槽出口，我们的 CSS 再对**同一个出口**（`[data-slot="…"]`）上色 ——
  这条链是自洽的：**锚点对着的是我们自己注册的槽**。
  ⚠️ 订正：本文件早期版本写过"我们没注册进任何槽"，那是错的（只看了 CSS 侧就下了结论）。

**怎么拿到权威槽名**（复算）：槽名在 TS 里是类型（运行期被擦除），所以**调用点的字符串字面量才是权威** ——
在产物里抽 `renderSlot("…")` / `renderSlotChain("…")` / `entriesOf("…")` / `slotKey: "…"` /
`registerSlot("…")` / `slots.register("…")` 这几种形状。⚠️ 别用"点号命名的字符串"启发式（会把非槽名也算进来）。

**本插件依赖的两个槽名，都已确认是宿主定义的**：

| 我们钉的 `data-slot` | 是否真实槽名 | 用在哪 |
|---|---|---|
| `settings.section` | ✅ 是 | 设置窗口玻璃（`[data-slot="settings.section"]`） |
| `sidebar` | ✅ 是 | 左侧栏覆盖（`div:has(> [data-slot="sidebar"])`） |

（顺带排除了一个猜法：**没有** `settings.sidebar` 这种名字 —— 设置窗口那一族是 `settings.*`，
左栏那一族是 `sidebar.*`，两者不同前缀。）

**⚠️ 槽名清单是"会漂的枚举"** ⇒ 本文**不抄全量**（复算：按上面的形状扫一遍已装产物）。
宿主提供的槽远多于我们用的两个（例如 `root` / `main.conversation` / `shell.overlay` /
`conversation.composer` / `conversation.input.dock` / `tool.call.toolview` / `sidebar.right.tab.*` …）——
它们是**插件注册 UI 的正式入口**，本插件目前只用 CSS 覆盖，不需要注册；将来若要做"真正插进去"的功能
（而不是给已有界面换皮），应当先看这份清单里有没有现成的槽。

### 3.2 `data-dsh-desktop-mode` 不是客户端接口，是**桌面壳的 URL 参数**（而且我们不只是消费者）

复算结论（三层合起来才拼得全）：

1. **壳侧**：桌面壳把它作为查询参数挂上页面 —— `url.searchParams.set("dsh-desktop-mode", mode)`
   （出处：桌面壳自己的 `index.js`；本机这一半**不在**上文审计的那个产物里，而在另一处安装中 ⇒ 复算要按
   "壳安装目录"再查一遍）；
2. **客户端产物侧**：0 命中（所以"客户端产物里没有"**不等于**"这条接口不存在"）；
3. **页面侧**：本插件 `src/adapter.js` 从 `window.location.search` 读 `dsh-desktop-mode` /
   `dsh-desktop-mica`，再写到 `document.body` 上，CSS 才按它分档。

⚠️ **反直觉的一点**：桌面壳自己的客户端 CSS **读** body 上的 `[data-dsh-desktop-mode="extended"|"advanced"]`，
但壳**自己并不写**这个属性 ⇒ 本插件写上去的那一下，同时也在**替壳的样式兜底**。
⇒ 这条接口的"提供方"不止一方，改它要**两边一起看**（我们写、壳读），不能只按"我们在消费宿主接口"来推理。

**影响面**：`src/styles.js` 里按壳模式分档的那几条规则；以及"壳模式"这个前置条件本身。

### 3.3 我们是**三层混用**的：宿主槽出口 + 设计令牌 + 第三方私有类名

这三类稳定性差一个量级，但它们在 `src/styles.js` 里长得一样（都是选择器）。
清账的价值就在这里：**升级前只需要重点复核低稳定度的那一类**。

### 3.4 宿主**自带权威文档**（这是本次核查最大的收获）

asar 里带着宿主自己的插件编写文档：`@deepseek-ai/dsh-agent-preset/references/` 下 **7 份**
（`packages.md` 可加载包总表 · `host-plugin.md` bundle 与宿主插件 · `ui-plugin.md` **Web 页里的 UI 插件** ·
`practices.md` 插件实践 · `user-actions.md` · `mcp-bundle.md` · `verification.md`）。
复算：按路径 `**/references/*.md` 从产物里抽（这几份是**宿主的**文档，不入本仓 —— 需要时按 §0 的方法自己抽出来读）。

与我们直接相关的三条**官方口径**（原文引用，出自 `ui-plugin.md` / `practices.md`）：

1. **主题令牌是官方路线**："Plugin UI is part of the Harness UI… a plugin **uses the host's theme tokens,
   locale, and layout patterns**"；"Style with the theme tokens that `cordis_inspect_query` `Theme` lists
   (`--dsw-alias-*`); **literal colors are for artwork only**"。
   ⇒ 本插件大量接管 / 消费 `--dsw-alias-*` 与 `--dsw-specific-*`（**52 个全部存在**，见 §2.1）**正落在官方路线上**；
   我们那些字面量 `rgba(255,255,255,…)`（釉面高光）属于"artwork"，也在允许范围内。
   ⚠️ 宿主还提供一个**查询令牌清单的服务** `cordis_inspect_query`（`Theme`）—— 比我们"按字节翻产物"更正的做法，
   将来要补令牌应当先问它。
2. **UI 应当经槽提交**："Contribute through slots: `ctx.slots.inject(ownerKey, () => ctx.slots.register(...))`"。
   ⇒ 我们的两个注册点就是这个形状（见 §3.1）。
3. **不要靠读 DOM 来估位置**："**Do not read another plugin's DOM, stylesheet, or component source to estimate
   placement; choose a slot that already allocates space.**"
   ⇒ 这条我们要**分清适用边界**：它管的是**新增 UI 的落点**（我们新增的界面正是走槽的 ✓）；
   而**给宿主已有界面换皮**（本插件的主要工作：把玻璃配方套到设置窗口 / 输入卡片 / 侧栏…）
   **不在文档覆盖范围内** —— 没有官方接口能"给已有面换材质"，所以我们只能钉数据属性与令牌（§2.2/§2.3）。
   ⇒ 结论：**换皮这条路是官方文档之外的**，因此它的接口脆性是我们自己承担的（这就是 §2.3 要分档记账的理由）。

⚠️ 一条**边界案例**（如实记录）：本插件的场景渲染页由宿主路由提供、并被嵌进页面（不是"插件 UI 页"，
而是渲染面）。`practices.md` 明确不建议"宿主提供 HTML 页 + iframe 嵌"这种做法 —— 我们这么做的理由与
代价记在 [`adr/0005`](./adr/0005-media-loopback-origin.md)（媒体由宿主自建的独立 loopback 源提供），
属于**有意的例外**，不是漏看了规则。

## 4. 状态与待办

1. ~~确认 `[data-slot="sidebar"]` 的槽名归属~~ ✅ **已确认**（`sidebar` 是宿主真实槽名；`settings.section` 同样确认）——
   见 §3.1 的复算方法；
2. ✅ **接口棘轮已落地**（下面 §5）；node 侧宿主接口清单（插件清单 / 设置持久化 / 路由 / URL 参数）**待做**；
3. 台账随 DSH 升级**重跑复算**（§0），把结论差异记进本文件。

## 5. 机器判据：接口棘轮（已落地）

`test/compat-harness-surfaces.mjs` 原来只做两件事：**面清单棘轮**（有哪些 `dsh-client-ui-*` 面）
与 **sidebar 活判据**（某个面的锚点还在不在）。它们回答不了"**我们钉的那个令牌 / 槽名还在不在**" ——
而本插件钉的接口散在 `src/**` 里。本次加了**第 ③ 组：接口棘轮**：

- **依赖清单从我们自己的源码抽**（不手抄 ⇒ 不会与实现漂移）：`--dsw-*` 令牌 · `[data-*]` 属性 ·
  `[class*="_x"]` 后缀 · `data-slot` 的取值（槽名）；
- 逐条在**已装 harness 的 UI 表面包**里找（设计令牌由 `dsh-client-ui-theme` 定义、各面包消费 ⇒ 这一层足够）；
- **槽名按调用形状判定**（`renderSlot("x")` / `entriesOf("x")` / `slotKey: "x"` …）——
  值本身在多处出现，裸子串会把普通字符串误判成槽；
- **第三方接口走台账豁免**（`test/fixtures/harness-ui-surfaces.json` 的 `interfaces.exempt`，每条必须写理由）：
  目前是 better-sidebar 的私有属性与八个类名后缀、以及桌面壳的 `data-dsh-desktop-mode`；
- 两类**不能进清单**的东西（否则是假红）：我们自己写的属性（`data-we-*` / `data-webwallgl-gl` /
  `data-plugin-css`）、以及**动态拼名**的前缀（源码里写成 `--dsw-font-${x}`）与注释里引用的写法。

**怎么本地跑**（CI 上由 `harness-compat.yml` 装好目标版本 harness 后跑）：

```bash
# ① 有真 harness 时：直接指过去（需要 @deepseek-ai/dsh 的包目录）
DSH_WE_HARNESS_ROOT=<...>/node_modules/@deepseek-ai/dsh node test/compat-harness-surfaces.mjs
# ② 没有真 harness 时：搭一个"假根"——建 <root>/package.json 与 <root>/node_modules/dsh-client-ui-* 目录，
#    把依赖清单里的接口字符串写进其中一两个 .js 即可（本次就是这么验的：正测全绿；从假根里删掉
#    一个令牌 ⇒ 该条变红并报出名字，证明判据有牙）。
```

⚠️ 与 §3.3 同一口径：**棘轮只保证"接口名还在"，不保证"语义没变"** —— 令牌被重新分配给别的层、
槽名的含义改变，机器判不出来，仍要靠人复核（本文就是那份复核记录）。
