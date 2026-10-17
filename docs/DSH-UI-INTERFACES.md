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
| `--dsw-mask-blur` | `dsh-client-ui-theme`（在**裸 `body`** 上定义，默认 `none`）→ 消费方 `dsh-client-ui-primitives` 的 Modal 遮罩（`.mask{backdrop-filter:var(--dsw-mask-blur)}`） | 宿主**自己的**浮层模糊通道：在 `body[data-we-glass-page]` 上重声明一次，就能一次覆盖该通道上的所有宿主浮层（#156① 的修法）。⚠️ 调用方若显式传 `backdropBlur=false`，遮罩上会带**行内** `backdropFilter:none`，那条能压过非 `!important` 的样式表规则 |
| `--dsw-alias-markdown-code-block-banner` | `dsh-client-ui-primitives`（声明在 `.md-code-block` 根上，`.banner` 消费） | 代码块吸顶条的内层底色。⚠️ 真正的吸顶载体是**外层 `.bannerWrap`**，它的底板读 `--dsw-alias-bg-base`（被本插件置成 `transparent`）⇒ 光改这个令牌铺不出板（#156④） |
| `--dsw-alias-scrollbar-bg-l1/l2` · `--dsw-alias-scrollbar-hover-l1/l2` | `dsh-client-ui-theme`（主题块里定义成静态中性色；`body` 上的滚动条基座把它们接成 `--dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l1)` 等） | 滚动条拇指色（#157）。**关键结构性事实**：宿主另有约 17 处局部重声明，写的都是 `--dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2)` 这一层**间接**（`agent-preset` / `conversation` ×3 / `plugin-manager` / `input-trigger` / `primitives` 等）⇒ 在 `body[data-we-glass-page]` 上换掉这四个**底层** `--dsw-*` 令牌，全部局部重声明都会解析到本插件的值（自定义属性按**元素**解析，不是按声明处），一处覆盖全应用、不需要逐锚点补。⚠️ `--dsh-scrollbar-*` 是宿主自己那一层（宽度 / 边框 / 轨道留白），**不在**接口棘轮的抽取口径里（`test/compat-harness-surfaces.mjs` 的正则只收 `--dsw-`） |

**稳定性判定：高。** 令牌是宿主"给主题用的公开面"，改名会比改类名慎重得多；但**语义**（某令牌代表哪一层）
仍可能被宿主重新分配 ⇒ 只对"值"稳定，不对"观感"作保。

### 2.2 DOM 锚点（数据属性）——**分三档**

| 锚点 | DSH 里 | 归属 | 判定 |
|---|---|---|---|
| `data-composer-card` | ✅ | `dsh-client-ui-conversation` 等 | 源码作者写的属性（会话根），**稳**（但注意它不是"气泡" —— 气泡的锚点是 `data-chat-flow-kind`，见下） |
| `data-chat-flow-kind`（+ `data-chat-*` 一族） | ✅ | `dsh-client-ui-schedule` | 聊天流条目盒子上的**语义化**锚点；取值来自节点种类（`user` / `steering` / `context` / `turn-trigger` / `turn-process` / `assistant-text` …）⇒ `user` / `steering` 即用户气泡那一行，**稳**（类名是构建哈希，只能兜底） |
| `data-question-key` / `data-plan-review-key` / `data-approval-key` | ✅ | `dsh-client-ui-user-questions` / `-approval` / `-conversation` | 工具弹卡的**容器**属性，稳 |
| `data-turn-trigger` | ✅ | `dsh-client-ui-chat`（`TurnTriggerNodeView`） | 思考触发条的锚点，稳 |
| `data-composer-seat`（+ `data-conversation-region="composer"`、`data-content-phase`、`data-phase`） | ✅ | `dsh-client-ui-conversation` | 输入**座位**（sticky 底板）的锚点，稳。⚠️ 它和 `[data-chat-flow]` **不在同一棵子树**里（座位是 ChatView 那一列在 `[data-conversation-scroll]` 里的兄弟）⇒ 会话流作用域在这一面用不了（#156③）。**插件当前不使用这个锚点**：#156③ 曾在座位上补一块底板，用户口径先后两次否定（先是「很高的灰色遮罩条」，收窄成贴底一条后仍嫌多余）⇒ 令牌与规则**整条撤回**（见 148+ 审计 §10）。宿主里这个锚点仍在，将来重开这一面可直接取用本行的宿主事实 |
| `data-composer-stats`（+ `data-composer-card` / `data-composer-input` … 一族） | ✅ | `dsh-client-ui-chat` | 底部统计行 / 输入卡片的锚点，稳 |
| `data-install-registry` | ✅ | `dsh-client-ui-plugin-manager` | 插件源浮层：写在 `<fieldset>` 上、portal 到 `document.body` ⇒ **body 的直接子节点**（不在 `[data-chat-flow]` 里，也不走宿主的半透明菜单通道 `[data-menu-material]`）（#156②） |
| `data-code-block-banner` | ✅ | `dsh-client-ui-primitives`（`CodeBlock` 的 `.banner`） | 代码块吸顶条的内层行；**吸收顶的是它的父 `.bannerWrap`**（只有哈希类、没有 data-*）⇒ 用 `.md-code-block > :has(> [data-code-block-banner])` 认父（#156④） |
| `data-sidebar-right-panel` / `data-sidebar-right-open` | ✅ | `dsh-client-ui-sidebar-right` | **既有**右栏适配的落点，稳（上游曾改过隐藏机制，见 `test/compat-harness-surfaces.mjs` 的活判据） |
| `data-slot`（**值由宿主槽注册表决定**） | ✅ 属性存在；`settings.section` ✅ | `dsh-client-ui-renderer` 写出口 | **这是"槽出口"，不是普通属性** —— 见 §3；出口自己写死 `display: contents`（**不生成盒子**），**不能**拿它当位移 / 定位的落点 —— 见 §3.5 |
| `data-windows-titlebar`（在 `html` 上） | ✅ 桌面壳写 | **桌面壳**（不在客户端产物里） | Windows 标题栏形态门：壳把窗口切到"自绘标题栏"布局（顶栏高度进 CSS 变量 `--dsh-windows-titlebar-height`）时挂在 `html` 上。本插件抄左栏那条玻璃规则时用它当**形态门**，与 `data-we-adapter^="desktop-"` 两道门同时成立才生效 |
| `data-dsh-desktop-mode` | ❌ 客户端产物 0 命中 | 桌面壳的 **URL 查询参数**，由本插件的 `src/adapter.js` 写到 body | **不是 DSH 客户端接口**（见 §3） |
| `data-dsh-better-sidebar` / `.dsh-browser-seat-wrap` | ❌ 0 命中 | **第三方插件**（better-sidebar / dsh-webui） | 不在 DSH 保证范围内 |

### 2.3 类名后缀（`[class*="_x"]`）——**一半是第三方的**

宿主组件的类名是 **构建哈希 + 后缀**（如 `oE-XyW_root`）⇒ 只能按后缀约定匹配。
复算：从产物里抽 CSS-module 映射表的**后缀全集**，再比对本插件用到的后缀：

| 本插件用的后缀 | 在 DSH 里 | 说明 |
|---|---|---|
| `_bubble` / `_card` / `_panel` / `_editorHeader` | ✅ 存在 | 会话 / 卡片族用得上。**但 `_bubble` 不是"聊天气泡专属后缀"** —— 见下面那条 |
| `_boundaryError` / `_browserBar` / `_explorerHeader` / `_gitHeader` / `_pane` / `_paneCard` / `_tabBar` / `_terminalWrap` | ❌ 不存在 | 这些是 **dsh-better-sidebar 的类名**（第三方）⇒ 只能随该插件漂移 |
| `pI_x6G`（写成 `div[class*="pI_x6G_frame"]`） | ✅ **完整哈希子串**（实测命中） | 不是后缀 —— 见下面那条 |

**⚠️ 还有第三种形态：拿完整哈希名当子串**（`div[class*="pI_x6G_frame"]`，标题栏玻璃用）。它是
`oE-XyW_root` 那种"哈希 + 后缀"里的**整串**（`<hash>_frame`）⇒ 比后缀更窄、更不会误伤，但**每次宿主重建
哈希都会漂**，最坏结果是"这一块不生效"（锚点失配不会误伤别的元素）。**棘轮有盲区**：
`test/compat-harness-surfaces.mjs` 的抽取正则只收 `[class*="_xxx"]` 这种**下划线开头**的后缀 ⇒
`class*="pI_x6G_frame"` 抓不到，`test/fixtures/harness-ui-surfaces.json` 里也就没有它；目前只有
`test/verify-glass-surfaces.mjs` 的 `anchors: ['[data-windows-titlebar]']` 单独兜一层。

**⚠️ 后缀会撞车：`_bubble` 同时是宿主 Tooltip 的类名**（`dsh-client-ui-primitives` 的
`Tooltip.module.css`，编译名 `_bubble_<hash>`）。Tooltip 是 `position:fixed` + portal 到 body 的
浮层、**不在 `[data-chat-flow]` 里**，于是任何"按 `_bubble` 后缀刷气泡玻璃"的规则都会顺手把它刷成
半透明浅底 —— 而它的文字是近白色 ⇒ 几乎不可读（#161 的根因）。
⇒ 认气泡**不能只看类名后缀**，必须带一个与 DOM 位置无关的排除式：`[class*="_bubble"]:not([role="tooltip"])`
（`role="tooltip"` 是该气泡元素上宿主写死的 ARIA 属性；用 `[data-chat-flow]` 作用域也行，但那条依赖
"tooltip 一定在流外"这个未被产物证实的假设）。语义化锚点（`data-chat-flow-kind`）是更稳的第一选择。

**稳定性判定：低。** 即使后缀存在，哈希前缀每次宿主重建都会变；后缀本身也不是契约（宿主可以把 `_panel` 改名），
**而且后缀不是唯一的**（上面那条撞车就是后果）。
⇒ 这类锚点只能当"尽力而为的兜底"，**不能**把用户可见功能挂在它上面。

### 2.4 node 侧（宿主 / 插件清单 / 服务注入）

| 接口 | 我们怎么用 | 宿主侧证据 | 判定 |
|---|---|---|---|
| `package.json` 的 **`dsh.bundle.patch`** | 指向 `./cordis.patch.yml`，由它插入插件条目 | 宿主文档（`host-plugin.md`）："A **bundle** is a package whose `package.json` declares `dsh.bundle.patch`; the YAML patch inserts plugin entries" | **官方机制**，稳 |
| **`dsh.client.platform` / `.immediately` / `.inject`** | 声明 `platform: "web"`、`immediately: true`、`inject: ["@deepseek-ai/dsh-client-runtime"]` | 宿主文档（`ui-plugin.md`）：`dsh.client` 段就这三项 + `./client` 导出；`practices.md` 另说 `dsh.client.inject` 条目**"only order activation"**，且 **"They change without notice"** | **明确不保证稳定**（但我们只用它排序激活 ⇒ 风险有限） |
| `dsh.client.external` | **未使用** | 同一文档：非基线的运行时 import 要在这里声明 | 与我们无关（客户端半边没有外部 import） |
| `exports["./client"]` | 导出 `lib/client.js` | 宿主文档：浏览器产物注册一个 **id 等于包名的 lazy factory**；React 由浏览器模块表提供 | 我们符合（有 `./client` 导出 ✓） |
| **peer 包** | `@deepseek-ai/cordis` ^4.0.1 · `dsh-client-runtime` ≥0.1.5-rc.1 · `dsh-client-ui-slots` ≥0.1.5-rc.1 · `dsh-host-webserver` ≥0.1.5-rc.1 · `react` ^18.2.0（v1.3.0 起三个 `dsh-*` peer 为 ≥0.1.5-rc.1，与 `engines.dsh` 同串——发布前徽章复核后对齐，约束等价） | 已装：cordis **4.0.4** ✓ · slots **0.2.0-rc.2** ✓ · host-webserver **0.2.0-rc.2** ✓ | 版本都满足；⚠️ `dsh-client-runtime` / `react` 在产物里**找不到同名磁盘包** ⇒ 它们是**客户端模块表里的运行时 id**（文档："React comes from the browser module table"），我们声明它是**激活排序**用途 |
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
| `sidebar` | ✅ 是 | 左侧栏液态玻璃（`div:has(> [data-slot="sidebar"])`；开关键 `leftSidebarGlass`） |

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

### 3.5 槽出口**不生成盒子**，而会话文本区与用户气泡各有自己的盒子（同一次核查的补算）

补算动机：本插件「3D 效果」的**界面跟随**最初只动输入卡片 —— 复算后才发现是"动错了元素"。三条已核实的锚点：

- **槽出口没有盒子。** 宿主槽渲染器（`dsh-client-ui-settings-account/lib/client.js` 的 `SlotOutlet`）给**每个**出口
  写死 `const ANCHOR_STYLE = { display: "contents" };`（注释原文：*`display:contents` keeps the wrapper out of
  layout (grid/flex parents see the slot's own children), so the anchor is purely addressable surface.
  Module-level constant — a stable reference so the wrapper never diffs its style prop.*），渲染形如
  `jsx("div", { "data-slot": slotKey, style: ANCHOR_STYLE, … })`。
  ⇒ 出口是**"可寻址的面"，不是"能动的盒子"**：`display: contents` 的元素不生成盒子，往它身上写
  `transform` / `translate` 屏上**零效果**。要动，得动**最近的有盒子的祖先**（本插件落在
  `parallaxGroupBox()` 上，最多往上 3 层）。这条同时解释了 §3.1 的"给宿主已有面换皮"为什么只能钉出口属性。
- **会话文本区的盒子是 `.…_viewArea`。** 会话骨架（`dsh-client-ui-conversation` 一族）：
  `div[data-conversation-content][data-conversation-region="chat"]`（类后缀 `_body`）>
  `div[data-conversation-scroll]`（后缀 `_scrollBody`，`overflow-y:auto`）> [`conversation.session` 出口（`display:contents`）] >
  `div`（后缀 `_viewArea`）> [`conversation.view` 出口（`display:contents`）] > `…_root`。
  输入卡片（`[data-composer-card]`）是 `Views` 的**兄弟**、同在 scrollBody 里
  ⇒ 动 `_viewArea` 只挪会话文字，不会连带输入卡片。`[data-conversation-scroll]` 是**宿主自己**写的标记
  （本插件"侧栏滚动"那条 CSS 已在用它）。`overflow-y:auto` 这一条是**双向**的坑：
  规范规定一轴不是 `visible` 时另一轴的 `visible` 计算成 `auto` ⇒ 这个容器的 `overflow-x` 实际也是
  `auto`。本插件界面跟随把**容器里面**的真实元素往右推出它的 inline-end（用户光标在左半边时）就会长出
  一条**横向滚动条**；它占掉约一条滚动条高的 scrollport，sticky 的输入卡片只能跟着上移 —— 现象正是
  "输入框底部出现一个黑条、把输入框顶上去"，而光标跨过屏幕中线、位移换向时滚动条出没 ⇒ 文本区与输入框
  一起抖（本插件早先那条设备像素量化迟滞只是次要项）。⇒ 视差段给这个容器**封了横轴**
  （`body[data-we-parallax="on"] [data-conversation-scroll] { overflow-x: hidden; }`）：会话内容本来就不
  横滚（长 token / 宽代码块都在自己的框里滚）；封轴比 `::-webkit-scrollbar:horizontal { display: none }`
  稳 —— 后者会把该元素切到自定义滚动条、连纵向滚动条的外观一起改。
- **用户气泡的稳定锚点是 `data-chat-flow-kind`。** 每个聊天流条目的盒子同时挂着
  `data-chat-anchor-key` / `data-chat-flow-key` / `data-chat-paging-anchor` / `data-chat-node-key` /
  `data-chat-group-part` / **`data-chat-flow-kind`** / `data-chat-turn` / `data-turn-process-member` …；
  `data-chat-flow-kind` 的值来自节点种类（`user` / `steering` / `context` / `turn-trigger` / `turn-process` /
  `assistant-text` …）⇒ **`[data-chat-flow-kind="user"]`（+ `"steering"`）就是用户气泡那一行的锚点**，
  而 `…_userRow` / `…_bubble` 这类类名是构建哈希、只能兜底。
- **左栏那一列不能拿 `translate` 动**（"能量形态"的边界，与上面三条同批核实）。`[data-slot="sidebar"]` 出口的
  **直接父元素**就是左侧栏那一列（本插件自己的 CSS 也这么指它：`div:has(> [data-slot="sidebar"])`，见
  `src/styles.js` 的液态玻璃那一段），而 Windows 标题栏模式下宿主把「收起侧边栏」按钮做成 `position: fixed`
  钉在标题栏左上角（逐字证据：`[data-windows-titlebar] ._2H3hWW_toggle{top:calc((var(--dsh-windows-titlebar-height)
  - 28px) / 2);z-index:30;-webkit-app-region:no-drag;position:fixed;left:12px}`，出自 asar 内
  `@deepseek-ai/dsh-desktop-host/node_modules/koffi/doc/composites.md`）—— 那个按钮就是这一列的后代
  ⇒ 给这一列写任何 `transform` / `translate` 都会让它成为按钮的**包含块**，按钮整体下移一个标题栏高
  （同一类事故见 `docs/CHANGELOG.md` 的 #131；本插件给这一列画玻璃走的是 `::before`，
  见 `src/styles.js` 里那段注释）。
  ⇒ 要动左栏只能走**相对定位**（`position: relative` + `left` / `top`）：它**不**建立包含块，就不会换掉任何
  fixed 后代的锚点。本插件「3D 效果」的界面跟随正是这么做的（`parallaxGroupOffsets()` 里左栏是唯一的相对偏移档）。

### 3.6 想"自动认到别的插件注册的前端元素组"，只能扫 DOM，不能靠槽注册表（同一次核查的第三批补算）

补算动机：要求让别的插件注册的前端元素组也参与缓动（面板里逐组可调、设 0 = 该组不缓动；
⚠️ 这一路有**独立的开关 `parallaxPlugin`、默认关**，见下面本节的
结论段与 `HOW-IT-WORKS.md`）。先查的是"运行期能不能问槽注册表"，逐条核实后**否掉**了这条路：

- **注册表在运行期确实可问，但问不出"归属"。** asar 内 `@deepseek-ai/dsh-client-ui-renderer/lib/client.js` 里
  `var SlotRegistry = class extends Service`（`super(ctx, "slots")`）把服务面方法直接转发给 `SlotCore`：
  `entries` / `entriesOfSlot` / `snapshot` / `spec` / `subscribe(key, fn)` / `getVersion`（外加 `register` /
  `registerFactory` / `inject`）⇒ 插件运行期可以调 `ctx.slots.snapshot()` 拿到 `{ name, kind, scope, declaredBy,
  occupants: [{ registrant, key, id, order, priority, active }], children }` 这棵树。**但**注册时的 `registrant`
  默认值就是 `options.registrant ?? this.ctx.fiber?.name`，宿主骨架与第三方 bundle 的 fiber 名**都是 `mf`**
  ⇒ 实况里 `settings.section` 那 10 个占用者（宿主五页 + `bili` / `better-sidebar` / `wallpaper-engine` /
  `market` / `cost-meter`）**registrant 全是 `mf`**，认不出谁是宿主、谁是插件。能带身份的只有占用者自己的
  `key` / `id`（常是包名或 section id），而那是**别的插件的自由命名**，不是接口。
- **子槽的注册不会向上冒泡。** `subscribe(key, fn)` 是按 key 订阅、microtask 批量；`snapshot()` 不给 root 时
  返回的只是**顶层槽 + factories** ⇒ 订阅 `'root'` 察觉不到某个已挂载插件后来又声明了一个子槽。
- **宿主自己的文档也把槽信息定位成"开发期工具"**：asar 内
  `@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/references/ui-plugin.md` 写的是"follow the
  selected slot's props and options from `Slots.listSubTree`"（即 Inspect），并明确要求
  "Do not read another plugin's DOM, stylesheet, or component source to estimate placement; choose a slot that
  already allocates space."

⇒ 本插件的选择是**认 DOM 的槽出口**（本插件本来就在钉 `[data-slot="…"]`，见 §2.2 / §3.1）：行为层扫
`document.querySelectorAll('[data-slot]')`，跳掉整帧容器（`root` / `main` / `rightbar`）、原生三组的出口本身
（`conversation.view` / `sidebar` / `main.conversation`）与设置、插件管理那几块子树
（前缀 `settings.` / `plugins.` / `shell.` 与子树 `settings.section` / `plugins.bundle.config`），把剩下的出口
**当成"别的插件的前端元素组"**；位移落在出口的**元素子节点**上（§3.5：出口自己 `display: contents`、没有
盒子），距离按槽键存进 `parallaxPluginDepths`（缺键 = 缺省 1%、显式 0 = 这一组不缓动）。**还有第二道筛
（`parallaxPluginEffectiveGroups()`）**：锚点落在**原生四组**（`[data-composer-card]` /
`[data-slot="conversation.view"]` / `[data-slot="sidebar"]` / `[data-chat-flow-kind="user"|"steering"]`）的盒子
里、或落在**另一个已认到的插件组**里的，一律不算 —— 外层组的位移本来就会把它带着走，它自己再写一次就是
两段位移叠起来（重扫那一步"组里套组只留最外侧"的同一条）。⚠️ 第一道筛**只在「界面元素跟随」开着**时才这么
算：关着时那四组的系数恒为 0、压根不是候选，拿它们去挡插件组会让"只开插件前端"变成一个拖了不动的空开关。
这一路**由它自己的开关 `parallaxPlugin` 看着**（独立于 `parallaxUi`、**默认关** —— 它挪的是
别的插件画出来的真实界面）：关着时层**连扫都不扫**（不是把系数算成 0，而是连 `querySelectorAll('[data-slot]')`
与那道 fixed 后代子树判定都不跑）、面板那一卡只有开关，那张距离表原样留着、开关一开照旧生效。
**面板那一栏与屏上同源**：`parallaxDiscoveredGroups()` 与 `parallaxTargetsRefresh()` 共用同一个
`parallaxPluginEffectiveGroups()` ⇒ 列出来的每一个槽键都有落点；面板回显另按层里那对常量
（`PARALLAX_GROUP_DEPTH_MIN` / `_MAX`）钳一次范围，存档里的越界值不会显示成域外的数。**已知代价**：① 运行期
分不清归属 ⇒ 宿主自己的界面槽也会出现在「插件前端」那一栏里，用户把它设 0 即可（面板里每一行就是一个真实
槽键，认得出来源的人能自己判断）；② 组里有 `position: fixed` 后代时**整组不动**（层的写法是"宁可不动"：
`translate` 会让该组变成那些后代的包含块，见 §3.5 与 #89 那条）—— 这一条要遍历子树、只在帧外做，面板不筛，
改成写进每一行的 tooltip 与那一卡上方那句说明里（认到槽位时显示的那一句 hint —— 它同时也说明"槽名就是身份"）。

⚠️ **§3.5 这四条**都属于 §2.3 说的"低稳定度那一类"：主机重建后**属性名**多半还在，但 `_viewArea` 这类后缀随时可改
⇒ 机器判据只能证明"名字还在"（§5），语义仍要靠人复核。最后一条性质不同：它约束的是**我们该用哪种 CSS 形态**
（不许 `transform`），而不是"宿主某个名字还在不在"。

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
