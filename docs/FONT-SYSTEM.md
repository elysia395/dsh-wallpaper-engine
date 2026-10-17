# src/font/ —— 字体系统（F / G 轨道）

> **English**: `en/FONT-SYSTEM.md`（**已随文档瘦身撤除**：维护者向文档以中文为准，见 [`README.md`](./README.md) §语言结构）
>
> **本文是索引，不是机制说明。** 字体系统的实现、不变量与取值口径住在
> [`src/font/`](../src/font/) 各文件的头注释里（本仓纪律：能写在代码旁的规则不单写文档）。
> 本文只回答两件事：**三个通道各是什么、以及改字体要动哪几个地方**。
> 决策与取舍见 [`adr/0002`](./adr/0002-settings-schema-single-source.md)（值的单一真源）。
> 官方令牌层约束（原 `V1–V10`）**由守卫执行，不靠散文**：白字保护与对比度见
> `test/verify-readability.mjs`，玻璃合成与令牌落点见 `test/verify-glass-compositing.mjs`。
> 那条约束的实测结论（F0 真机确认）由上面那些守卫的断言持有；历史记录见 [`CHANGELOG.md`](./CHANGELOG.md)。

这个目录是**字体系统的全部实现**。之所以单独成目录：字体有三个**互不相同的作用通道**，
如果不放在一起，改动时很容易用错通道（症状是"改了没反应"，且在真机上才看得出来）。

**目录里的文件分两类**：多数是**纯计算**（角色表 / 令牌 / 钩子生成，不碰 DOM），
`apply.js` 是**唯一碰 DOM 的那个**（宿主默认值快照 + 组件作用域样式表）。效果应用层
（`src/effects.js`）只调用它的入口，不再夹带任何字体实现。

## 三个通道（用哪个，取决于"字体从哪来"）

| 通道 | 代码 | 覆盖对象 | 机制 | 守卫 |
|---|---|---|---|---|
| ① **角色令牌** | [`color-roles.js`](../src/font/color-roles.js) · [`typography.js`](../src/font/typography.js) | DSH 的**角色**（正文 / 次要 / 弱化 / 标题 / 代码 / 表格…） | DSH `theme` 服务的 `overrideTokens`（body 内联，**免 `!important`**） | `test/verify-theme-layer.mjs` |
| ② **官方组件钩子** | [`components.js`](../src/font/components.js) 的 `DSL_FONT_HOOKS` | 代码块 / 终端 | 官方 `--dsl-*` 钩子，**作用域 = 该钩子在样式表里的定义点**（`scanHookScopes` 推导） | `test/verify-component-fonts.mjs` |
| ③ **模块名直接命中** | 同上，`COMPONENT_FONT_TARGETS` 的白名单项 | CSS-module 前缀可命中的组件 | `body [class*="_<模块名>_"]` 直接命中（**等特异性**，不用 `!important`） | 同上 |

> **①②③ 的机制、失效模式与不变量全部写在 [`components.js`](../src/font/components.js) 与
> [`apply.js`](../src/font/apply.js) 的文件头** —— 包括"为什么模块名必须实测"、
> "为什么 ② 不许按模块名生成作用域"、"为什么真实属性通道必须跳过 hooks 组件"。
> 改通道前先读那两份头注释；本文不重复它们。

**路由规则（用哪个通道，来自静态分析，不是偏好）**：字体的值来自 **DSH 角色令牌** ⇒ ①；
字体来自**后代元素上的 `font:` 简写** ⇒ 只有 ② 的钩子这条腿有效（在容器上写 `font-size` 无效，
简写压过继承）；字体是组件自己写死的声明且无 `font:` 简写 ⇒ ③。
每个目标的 `route` 字段（`tokens` / `hooks` / `props`）就是这条判断的落地，判据见 `components.js` 头注释。

## 值的真源在哪（与三个通道正交）

三个通道回答"**怎么把值投到页面上**"；值本身住在哪是另一件事：

- **真源 = `fontsets/<活动 id>.json`**：**随包层** `lib/fontsets/`（只读）+ **用户层**
  `<pluginDataDir>/fontsets/`，同 id **用户层胜**；改随包那份会**写时复制**成用户层的一份，
  删掉它即"恢复原样"。
- `config.json` 里只留根字段（活动字体集 id 与自定义项）—— **字体键不在 settings 的持久化
  白名单里**：它们由 `lib/settings-schema.js` 的 `FONTSET_KEYS` 定义 kind 元数据，
  客户端 [`src/fontset-store.js`](../src/fontset-store.js) 与宿主
  [`packages/fonts/lib/routes/fontsets.js`](../packages/fonts/lib/routes/fontsets.js) **共用同一份**做消毒。
  ⚠️ **加键是加性的**（老文件缺键 ⇒ 消毒时回落默认值，`FONTSET_SCHEMA_VERSION` 不随加键升 ——
  升版本会让所有已导出的 `.json` 变成"读不懂"）。
- **写回是设计的一部分**：面板里改任何一个字体项都只落到**当前这一套**；导入导出按整份 `.json` 走
  （导出用宿主响应头 + 普通链接 ⇒ 桌面端即系统"另存为"）。

## 字族的两类值与"全局"槽

字族（family）这一项与别的项不同：它的取值域**不是一张固定白名单**。

- **内置族键**：`FONT_FAMILY_VALUES` 里那几个（雅黑 / 楷体 / 宋体 / 黑体 / 行楷 / 等宽 / 默认），
  CSS 栈写死在客户端 `FONT_FAMILY_STACKS`。
- **本机字体键 `sys:<族名>`**：清单由**宿主枚举**（[`packages/fonts/lib/routes/system-fonts.js`](../packages/fonts/lib/routes/system-fonts.js)），
  客户端通道是 [`src/system-fonts.js`](../src/system-fonts.js)。为什么问操作系统而不是自己解析字体文件，
  见 [`adr/0009`](./adr/0009-system-fonts-from-the-os.md)。⚠️ **同一个字体可能有两个键**：macOS 上
  本地化名（`苹方-简`）与规范名（`PingFang SC`）**都在**清单里 —— 两条腿并行、名字取并集，
  这是刻意的（用户可能只认得其中一种；原生 `<select>` 的首字母跳转按**选项文本**匹配，
  合成一行反而两边都跳不到）。
   ⚠️ 而**系统列出的族名 ≠ 浏览器能匹配的族名**：系统保留字体（`Apple Color Emoji` / `Symbol` /
  `Zapf Dingbats`）与同一字体的另一种写法（`苹方-繁`）都可能取不到 —— 面板会**如实报出略过了几个**。
  ⇒ 客户端在**渲染下拉时**过一道 `filterUsableSystemFonts`（`src/system-fonts.js`：
  同名分别配 monospace / serif 量同一段拉丁文字，宽度相同才算能匹配），只把**真的能用**的名字
  摆出来；量不到（替身 DOM）时**原样放行**。
- **两类都只存"键"，不存 CSS 栈**：栈（引号 + fallback 链）由客户端的 `fontFamilyStack` 现拼
  —— 本机字体那条链是 `"<族名>", var(--we-host-font-family, <保底>)`，其中
  `--we-host-font-family` 是**开写之前**的 DSH 字族快照（`font/apply.js` 取）。
  历史值（F3 之前组件字体存的就是解析后的栈）解析侧照样认 ⇒ 老字体集零迁移。
- **全局字族槽**（`globalFamily`）是**默认**而不是强制：它写 DSH 的基准令牌
  `--dsw-font-family`，并**只**落在"本来就被接管"的角色上（用户改过该角色字号/字重）——
  见 `typography.js` 的 `buildTypePayload`。**挑一个全局字体不许改动任何角色的字号。**
  面板上「终端字体」那一行写的就是 `componentFonts.terminal.family` 这个键（两处入口、一份值）。
  **这一个键投到两个终端上**：① DSH 对话里的终端块 —— 官方 `--dsl-terminal-font` 钩子；
  ② 侧栏 / SSH 的终端面板（`@linxin666/dsh-ssh` 的 xterm）—— 它给**皮肤**留的
  `--dsh-ssh-terminal-font`（xterm 的字体只从选项来，普通 CSS 规则改不动）。
  ⚠️ 后者两个坑都要绕开：① **值必须是摊平过的具体字体列表**（不能含 `var()` —— 它会被当字符串
  交给 `fontFamily`），走 `fontFamilyStackConcrete`；② **投递时机**——那个插件**只在构造终端的那一刻**
  读该变量（之后只有它自己的设置变化才重读），而我们的权威值要等宿主异步回话 ⇒ 由
  `applyTerminalHostVar` 写成 **body 上的内联属性**，并在**正文顶层先抢跑一次**（用同步可读的
  本地缓存），抢在别的插件构造终端之前。

## 加一个新角色 / 新组件时要动的地方

**三处必须同时改**（守卫会要求它们一致）：

| 想加什么 | 改哪里 | 必须同步 |
|---|---|---|
| 排版角色 | `typography.js` 的 `THEME_TYPE_ROLES`（表达式**照抄 DSH**） | `lib/settings-schema.js` 的 `THEME_TYPE_ROLE_IDS`（两份必须一致） |
| 颜色角色 | `color-roles.js` 的 `THEME_COLOR_ROLES` | schema 的 `THEME_COLOR_ROLE_IDS` |
| 组件 | `components.js` 的 `COMPONENT_FONT_TARGETS`（`id` + **实测** `prefix` + `source` + `route`/`dslHooks`） | schema 的 `COMPONENT_FONT_KEYS`（比对的是 **id**，不是模块名） |

**加组件的三步**（细节与判据见 `components.js` 头注释）：

1. 在 `@deepseek-ai/dsh-client-ui-primitives` 的 `*.module.css` 里**实测**模块名，
   把那个文件路径填进 `source`（本机装了 DSH 时守卫会打开它核对 `prefix` 真的在里面）；
2. 加白名单项并**同步 schema 键**；
3. 想清 `route` —— 只有 `hooks` 那条腿能盖住"后代 `font:` 简写"的情形。

> ⚠️ 白名单**有条数上限**（棘轮），且 `source` 必须非空并以 `.module.css` 结尾 ——
> **上限与当前条数以守卫和 `COMPONENT_FONT_TARGETS` 为准，本文不写死它们**。

DSH 升级后**重取角色表**的命令写在 [`typography.js`](../src/font/typography.js) 文件头（跑一遍即可核对基准值有没有变）。

## 这些模块怎么进浏览器包

目录内模块都由 [`scripts/build-client.mjs`](../scripts/build-client.mjs) 的 `INLINE_MODULES`
**构建期内联**进 `lib/client.js`（浏览器半没有本地模块解析器，只能内联）。构建对每个模块断言
"浏览器安全 / 结构标记齐全 / 机器提取的注入名不与 `src/client.js` 重复"——**缺标记即构建失败**。

> ⚠️ **漏登记 `INLINE_MODULES` 不会报错**，只是那个文件永远不进产物（本仓真发生过：
> `src/api-client.js` 一度是孤儿）。`verify-component-fonts.mjs` 有一节就是按
> 「模块在位 + 已内联 + **不在**正文」三件套断言 `apply.js` 的 —— 抽模块时照抄这个形状。
> 目录语义与准入门槛见 [`CODE-STRUCTURE.md`](./CODE-STRUCTURE.md) §4。
