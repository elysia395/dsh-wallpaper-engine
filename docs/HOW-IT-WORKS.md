# 工作原理

> **English**: [`en/HOW-IT-WORKS.md`](./en/HOW-IT-WORKS.md)（与本文同源：改一处请同步另一处）
>
> 本文讲**用户可见行为**（"为什么这么渲染、失败时怎么样"）。**代码结构**在 [`CODE-STRUCTURE.md`](./CODE-STRUCTURE.md)，
> **为什么这么设计**在 [`adr/`](./adr/)。**不写会漂的数值** —— 条数 / 体积 / 耗时阈值一律指向实现或给复算方式
> （见 [`adr/0017`](./adr/0017-code-is-truth-docs-reference-source.md) D1）。

### 场景 / 网页壁纸的默认形态：WebWallGL 实时渲染

**scene 与 web 壁纸默认走实时渲染**（设置项 `sceneLive`，UI 文案「场景实时渲染」/「网页实时渲染」，
默认开）——渲染器是 **npm 依赖 `webwallgl`（版本钉在 `package.json`）的引擎** 加上本仓 `lib/webwallgl/` 的适配页
（`index.html` + `renderer.js`），引擎文件由宿主运行期直接从 `node_modules/webwallgl` 供给（挂在 `engine/` 下），
由宿主以 `/wallpaper-engine/scene-live/` 为 base 挂载（资源引用按该前缀解析），壁纸自身的文件
（`scene.pkg` / 网页项目文件）经 `/wallpaper-engine/scene-files/` 供给（**路径不变，变的是 origin**：
场景那份与网页那份都由自建媒体源提供，见下方「载荷来源」）。网页壁纸由宿主在返回的
HTML 里注入 WE API shim（运行期从 `webwallgl` 包的 `webwallgl.mjs` 中提取）与 `project.json` 的属性 seed ——
严格沙箱下渲染页够不到壁纸 iframe，shim 必须随文档一起到达。

- **何时不走实时渲染**：壁纸开关被关掉，或该壁纸已被记入**失败记忆**（首帧超时；或运行期**持续无帧**——
  心跳每秒一拍，先到 `LIVE_STALL_TICKS` 拍时自动 `resume` 自救一次，再到它的两倍仍无帧才判 `stall`）。
  此时按下面的**出图来源链**出图（允许诚实地留空）。
  ⚠️ **松散 `scene.json` 目录不是"不走实时渲染"的理由**：内置 WebWallGL 原生支持松散形态，
  站点根两种形态一致，形态判定交给渲染器（`project.json` 的 `file` 后缀）；host 只认"是不是场景"。
  重新打开开关会清空失败记忆（显式重试入口）。
  **首帧超时不是一个固定墙钟**：首帧**必须等整包到齐**，所以预算由
  `liveFirstFrameBudget()`（`src/live-layer/probe.js`）按**包大小**现算，并有上限；
  而且宿主侧有一本**载荷账本**（客户端轮询
  `GET /wallpaper-engine/scene-payload-progress?token=…`，见 [`ROUTE-INDEX.md`](./ROUTE-INDEX.md)），
  字节还在涨就每拍重置计时 ——
  "正在下载"不再被算成"渲染不出来"。**隐藏 / 未播放的实例根本不拉载荷**（建层时延迟赋 `src`、
  切到后台时把 `src` 摘成 `about:blank` 中止在飞请求），因为这种实例既出不了帧（Chromium 冻结隐藏页
  的 rAF），又会和**看得见**的那个实例抢带宽与解码器。
  **首帧确实没出来时还要分因**：账本说"传过但没传完"⇒ 只记**会话内**软失败（不写所有窗口共用的
  失败记忆），冷却后自动重试且次数有上限（两个值都是 `src/live-layer/watch.js` 的常量
  `LIVE_TRANSFER_RETRY_DELAY_MS` / `LIVE_TRANSFER_RETRY_LIMIT`）；只有渲染页真的不出帧 / 运行期失联才落盘记忆。
- **出图来源（唯一权威顺序，代码在 `packages/media-bridge/lib/routes/scene-frame.js`）**：
  ① 实时渲染 iframe → ② 场景**作者内嵌 MP4**（`sceneVideo`，硬件解码 `<video>`）→ ③ **实时抓帧**
  （`<key>_gpu.png`，live 渲染页首帧确认后由客户端回填）→ ④ **自定义画面**（用户导入的截屏）
  → ⑤ **空态**（404 + 可判定原因）。
  **首帧之前不留黑屏**：垫底画面按 **实时抓帧 → 作者随包发布的工程预览图 → 主题色** 取
  （`buildLivePoster`）—— 新壁纸**第一次**激活时抓帧还不存在（要等这一轮 live 回填），先由作者的
  预览图占位，live 首帧一到即被顶掉。预览图只是占位，**不会被当成"这张壁纸的出图"**。
  关掉实时渲染不会改变 ①②；`?v=4` 是"强制自定义画面"（**豁免**抓帧：显式 pin 的来源不被一张抓帧顶掉），
  `?v=1/2/3` 已退役、一律 clamp 到 0。
- **为什么没有 CPU 兜底出图**：任何"猜"出来的图都有同一个缺陷 —— **能"成功"产出一张劣质图**：
  绕过质量门禁、把糊帧写进缓存、让"这张壁纸没有可用画面"这个**可判定事实**退化成一张看似正常的画面，
  用户看到的是"壁纸糊了"，而不是"它没有画面"。所以服务端的契约是
  **要么给真画面、要么明确留空**（状态行给出可判定原因）。
  ⚠️ **这条裁定管的是服务端"出图"**：`/scene-frame` 不会产出猜来的图。而客户端在**首帧前 / 空帧时
  的占位**仍会用**作者随包发布的预览图**（那是作者自己的图，不是本插件合成的）—— 它只顶到 live 首帧
  或用户导入的自定义画面出现为止。
- **帧率**：`实时渲染帧率`（15 / 30 / 60 fps）经 iframe query 下发，改档会重建图层。
- 护栏：`test/verify-scene-live.mjs`（实时链）、`test/verify-scene.mjs`（出图来源链 + 抓帧缓存）。

### 场景渲染：怎么工作的

场景由**内置的 WebWallGL 引擎**实时渲染（引擎本体走 npm 依赖 `webwallgl`，`lib/webwallgl/` 只放本仓的渲染页适配层，见上文；它自己解析 `scene.pkg` / 松散
`scene.json`、重放对象树 / 纹理 / 粒子 / shader，并优先走 GPU、无 GPU 时熔断回软渲染）：
在 WebGL2 里解析对象树，实时渲染全部 image 层（waterwaves / waterripple 等 shader 效果按 HLSL 转译后
在 GPU 执行）、puppet 骨骼模型、粒子系统与文本对象，并执行场景自带的 SceneScript —— 鼠标移动会驱动
视差 / 光标交互，包内音频（BGM / 音效）随「音量 / 壁纸音轨」设置播放并驱动音频反应效果。

选择器里场景卡片的**类型**徽标是「场景」；`/scene-live` + `/scene-files` 是它的数据面。宿主侧的契约
只有两条：**把场景文件按需喂给渲染页**，以及**把渲染页抓回来的帧收好**（③ 实时抓帧）。

### 网页壁纸：实现细节与已知边界

**网页壁纸**同样走 WebWallGL：宿主把 **WE API shim**（`wallpaperRegisterAudioListener` /
`wallpaperPropertyListener` / 媒体监听等，取自 `webwallgl` 包内的 shim，由 `/scene-files` 注入入口 HTML）
交给渲染页加载 —— 依赖 WE API 的工坊网页壁纸（音频可视化、属性驱动、鼠标跟随等）因此能真正跑起来，
不再是一片空白或报错。**安全**：壁纸 iframe 强制 `sandbox="allow-scripts"`（严格沙箱），第三方 HTML
拿不到 DSH 的 origin（无法冒用宿主身份调宿主 API / 读宿主存储）；跨源控制与指针注入经渲染页的
`postMessage` 通道下发。加载失败或运行失联时按壁纸记忆并自动退回旧的兼容 iframe（裸 HTML，无 WE API）。

> **载荷来源（独立媒体源）**：**网页壁纸的入口 HTML 与全部子资源**，以及**场景壁纸的 `scene.pkg`**，
> 都由宿主自建的**独立 loopback 媒体源**（`GET /wallpaper-engine/media-origin`）提供，不走插件的 HTTP 路由
> （媒体源不可用时才回落应用源）。原因：插件路由套了能力头栅栏（只注入给同源 frame 的请求），而严格沙箱
> iframe 是不透明源、拿不到这个头 ⇒ 壁纸入口会一律 `403`；媒体源绕过栅栏，也让第三方 HTML 不沾宿主 origin。
> 场景载荷还为了**速度**（大包挤不过首帧预算），且 `scene.pkg` 带 `ETag` 可 304 复用。
> 媒体源**按需懒启动**：库里有网页壁纸或可实时渲染的场景时才起；设备形态判定、回落与探测的完整规则见
> [`CODE-STRUCTURE.md`](./CODE-STRUCTURE.md) §10。
> **帧率上限与「卡」的排查**：网页壁纸的 rAF 上限由 shim 按**跳帧**实现 —— 每帧都与显示器 vsync 对齐、
> 只把第 n 帧交给壁纸（`setTimeout` 定时器式实现会产生 17/33/50ms 抖动，观感更差）。实时渲染期间每 5 秒
> 往诊断文件写一条 `live-fps`：`ui=` 整页帧率、`web=` 壁纸自身帧率、`rnd=` 渲染页帧率、`cap=` 当前上限 ——
> 「限了 30 还是卡」时先看这条：只有 `web` 低＝壁纸自己的开销；`ui` 也低＝整页代价（例如侧栏液态玻璃的
> `backdrop-filter` 每帧重采样壁纸，可先把模糊调小验证）。

> **已知边界**：作者脚本的 `fetch`/`XHR` 在 opaque origin 下携带 `Origin: null`（宿主已返回
> `Access-Control-Allow-Origin: *`，常规资源可用）；`wallpaperMediaIntegration`（系统 Now Playing /
> 歌曲封面）已提供数据源；CSS `:hover` 等由浏览器 hit-test 驱动的交互不受外部指针注入影响（与上游文档一致）。

### 宿主 / 客户端分工

- **Host 端**：先定 Steam 根（`DSH_WE_STEAM_ROOT` 显式覆盖 → 注册表 → 常见安装目录 → WSL `/mnt`），
  从 `libraryfolders.vdf` 取库，按**标记文件**认定安装根（经典布局的 `wallpaper32.exe` / `wallpaper64.exe`，
  或新版 `distribution/` 下的 `version.json`），再枚举 `projects/defaultprojects`、`projects/myprojects`
  与 `steamapps/workshop/content/431960/*`。行 / 组件 / 路由族 / 子包契约见
  [`CODE-STRUCTURE.md`](./CODE-STRUCTURE.md) §1–§3，路由的权威清单是 [`ROUTE-INDEX.md`](./ROUTE-INDEX.md)
  （本文件不手写路径表，也不写条数）。
- **Client 端**：拉取壁纸列表，把选中壁纸渲染到三列**后方**的固定图层；在设置里注册一级设置页
  「**壁纸引擎**」——页签（壁纸库 / 外观 / 播放 / 系统 / 扩展 / 关于），「选择壁纸」是页内下钻的库视图。
  - 整页玻璃与壁纸**解耦**：锚点 `data-we-glass-page` 由玻璃行恒挂；壁纸只是玻璃的**背景来源**之一。
  - 「左侧栏液态玻璃」默认关：关着时左栏是**透明的洞**，打开后那一列也走同一张玻璃配方。
  - 「扩展」页是模块容器：**点击 / 拖尾**（`packages/fx`）与 **3D 视差**（`packages/parallax`）都是独立扩展岛，
    画什么、怎么画写在各自模块头注释；`parallaxPlugin`（跟随别的插件的前端元素组）**默认关**。
  - 「关于」页两张二维码是随包 PNG（`lib/about/`），Star 数由宿主代取 GitHub API（带缓存）。
  - 快捷播放面板与设置页**共用同一批渲染器**；侧栏档只画简化配置（预设与逐面细调只在设置页）。
### 字体集：一整套外观住在哪

字体自定义以**一套**（「字体集」）为单位，存成**文件**而不是散在 settings 键里：

- **两层存储**：随包 `lib/fontsets/<id>.json`（只读）+ 用户 `<pluginDataDir>/fontsets/<id>.json`；
  同 id **用户层胜**。改随包那份会**写时复制**成用户层，删掉它 = 「恢复原样」。
- **切换只有一条写原语**：`POST …/activate` 改指针，改完客户端必须把它那份值读回来采用；
  「使用中」的判据是**值仍与采纳时一致**。
- **导入导出**：导出走宿主响应头 + 普通链接；导入前按文件里的 `$schema` 预检并给出具体原因。

端点族、键真源与失败语义见 [`CODE-STRUCTURE.md`](./CODE-STRUCTURE.md) §3.3 / §7；取舍记录见
[`adr/0011`](./adr/0011-preset-full-snapshot.md)。
### 本机字体清单：问操作系统，然后缓存

下拉里的**本机已安装字体**是**问操作系统**得来的（macOS 双名并集、Windows `InstalledFontCollection`、
Linux `fc-list`；都拿不到时按字体文件名推，并如实标「推测」）。一次扫描很贵 ⇒ 双层缓存 + 过期**先回旧值**
再后台重扫 + 面板「重新扫描」；**启动期不扫**。

⚠️ **系统列出的族名不等于浏览器能匹配的族名**（系统保留字体、同一字体的另一种写法都可能取不到）——
面板渲染时会实测一次，把用不了的略掉并**如实写出略过了几个**。机制与不变量在
`packages/fonts/lib/routes/system-fonts.js` 与 `src/system-fonts.js` 的文件头；决策与代价见
[ADR-0009](./adr/0009-system-fonts-from-the-os.md)。
### 抓帧几何与空帧门禁

抓帧是「抓帧那一刻渲染页视口的构图」；**别的窗口 / 旧会话抓的帧**拿到当前窗口上屏会被 `object-fit: cover`
再裁一次。宿主在 `HEAD /scene-frame/<token>` 上附带 `X-WE-GPU-W/H/AR`（读 PNG 的 IHDR，纯文件头），
客户端拿它与当前视口比对：差 > 2% 或几何未知（旧宿主 / 读不出）⇒ **先抓帧过内容门禁，再清槽、再 PUT**
（清槽在抓帧之后：抓帧失败留空槽比留旧构图更糟），落地后就地重挂并记 `gpu-frame-stale` /
`gpu-frame-recaptured` 诊断行。旧帧因此会在下次挂载 / 轮换时自愈。

**体积阈值不可靠**（全黑 PNG 在 1080p 就约 44KB），所以抓帧前会把 canvas 降采样看亮度分布：
近全黑或几乎无对比度即判「还没渲染出画面」，放弃回填，另加分辨率相关的体积地板。

**不满意时**：设置 → 效果 → 画面 → 「实时帧」有**微缩预览**、「**重新截**」、「**清除 GPU 帧**」
（等价 `DELETE /wallpaper-engine/scene-frame-cache/<token>`）。这一行**不受「场景实时渲染」开关影响**，
「自定义画面」也一直显示；只有「出图来源」在实时渲染生效时隐藏。

采样与阈值常量在 `src/live-layer/watch.js`；几何换算与门禁实现见
[`CODE-STRUCTURE.md`](./CODE-STRUCTURE.md) §10。
### 遮挡暂停：判定**不只靠事件**

「最小化 / 切页时暂停」「窗口失焦时暂停」「电池供电时暂停」三项（设置 → 效果 → 省电）都由
`occlusionReason()` 一处判定，再经 `emit()` → `syncLayers()` 落到视频的 play/pause。只靠
`visibilitychange` / `blur` / `focus` 事件驱动有一个**原生模态**造成的漏洞：`window.confirm` /
`alert` 会把焦点交给它自己的窗口，而**回来时的 `focus` 事件不保证送达**。于是判定永久停在
「窗口失焦」：壁纸停住、判定也不会再变（真机形态是"确认弹窗之后壁纸不播了、只剩重载能救"）。

事件之外还有一次**低频复核**（`OCCLUSION_RECHECK_MS`，见 `src/client.js`）：只在判定**变了**的时候
`emit()` 并写一行 `play-state … occlusion-recheck` 诊断 —— 所以常态零代价，而"事件丢了、复核补上"
这件事在诊断缓冲里看得见（这是事后排查唯一能依赖的痕迹）。

> 破坏性操作的确认因此**不用原生对话框**：字体集的删除走**面板内**确认（点一次"待确认"、再点"确认"）。
> **`src/**` 里没有 `window.confirm`**，只剩解释"为什么禁用"的注释。
> 终态由 `test/verify-fontset.mjs` 的棘轮钉住（它只扫破坏性动作族所在的那几个文件 ——
> 想扩面就改那条棘轮的文件清单，别把条数写进文档）。

### 主题随壁纸：取色链与让位规则

换壁纸后是否切深浅由**「主题随壁纸」开关**控制（`lib/settings-schema.js` 里**默认关**；关 = 整条链不跑）。
打开后按优先级取色：

1. **壁纸自己声明的配色** —— `project.json` 的 `general.properties.schemecolor.value`；你在「壁纸属性」
   面板里改过的**覆盖值优先**；作者值恰好 `0 0 0` 视作"没填"（面板里显式填的纯黑照用）。
2. **画面占比最大色** —— 仅在 ① 缺席时跑：把画面缩到 `LIVE_FRAME_SAMPLE` 见方、按 4bit/通道量化取众数桶；
   作者的 `preview` 与真实渲染帧**各判一次**，不一致时取**深色**（两条腿都说浅才用浅）。
3. **两条都拿不到 ⇒ 保持当前主题**，不切也不抖。

判定用 WCAG 相对亮度，阈值取**"明显偏亮"**那一档（刻意不取中灰）。写入走宿主 `theme` 服务；自我约束：
**结论与偏好相同就不写**、**你手动改过就让位**、**宿主没有主题服务则整体不生效**。

阈值常量与实现见 `src/theme-follow.js` 的文件头与 `THEME_FOLLOW_LIGHT_ABOVE`。
### 共存：玻璃表面与其他 UI 插件

#### 接管边界

壁纸与玻璃独立：关闭壁纸不会关闭玻璃。皮肤中心的公开标记 `html[data-dsh-skin]` 仍使本插件整体让路，离场后恢复。

壁纸在场时，页面让开所需的 `--dsw-alias-bg-base` 与 `--dsw-specific-sidebar-fill` 以**作者 `!important`** 声明（`src/styles/base.js` 的 `body[data-we-wallpaper]` 与深色档两块）。这是**跨插件契约**，不是防御性写法：DSH 的主题 API 允许插件（如 DS Bot 的 Bot 模式）用 `ctx.theme.overrideTokens` 给宿主上色，宿主把令牌以**内联样式**写在 `<body>` 上；普通作者声明必输给内联声明，壁纸层就会被不透明页面基色盖住（[#282](https://github.com/elysia395/dsh-wallpaper-engine/issues/282)，与 [#279](https://github.com/elysia395/dsh-wallpaper-engine/issues/279) 同属「其他插件盖住壁纸」一类）。`!important` 只在壁纸门内生效，壁纸退场后本插件不再声明，宿主内联值原样生效 —— 单向接管，不读不写其他插件的状态。需要自带背板的第三方面板请用自己的底色声明或 `data-we-surface-preserve`，不要改写这两枚页面背景令牌。

玻璃的**页面级背景层令牌映射**（`--dsw-alias-bg-layer-1/2/3`、`--dsw-alias-button-elevated-fill`、`--dsw-alias-bg-overlay` 等）作用在 `body[data-we-glass-page]` 上，对**整页**生效：宿主自己的侧栏按钮、右栏页签栏、设置窗内的卡片都读这一族令牌，只把它传给聊天流会让这些面退回宿主实底。每条映射都带可读性下限（`--we-readability-floor`），不是无下限透明。设置窗口、侧栏和声明式表面的**霜与底色**仍由统一运行管理器按面认领；未知第三方面板的**自有底色声明**、按钮语义色、编辑器语法色和终端 ANSI 色不被改写。

| 表面 | 接管方式 | 不满足条件时 |
|---|---|---|
| 宿主左右栏 | 校验几何后，在页面底层放独立装饰叶节点 | 保留原生；不修改祖先定位或提高层级 |
| 设置窗口 | 借用窗口已有的定位和层叠上下文，在空闲 `::before` 绘制 | 已有模糊、伪元素被占用或结构不安全时保留原生 |
| 右栏 CodeMirror / xterm | 仅认领展开右栏内的已知内容画布 | 单面原生、preserve 或侧栏关闭时撤销 |
| 第三方声明面 | 显式声明并通过载体安全检查后绘制 | 未声明或不安全时不猜测布局 |
| 额外选择器 | 仅为空闲且已有定位、层叠上下文的目标补雾化 | 不制造新上下文，不强清内容底色 |

宿主最外层为壁纸让开的规则不等于玻璃接管。共存边界也不意味着任意第三方插件已经过完整视觉验证。

#### 逐面回退

在外观设置的「玻璃兼容」中，每面可选「自动适配」或「保留原生」。对应设置键为 `glassSurfacePolicy`，策略覆盖绘制资格，不改变 `glassMode` 原有的继承 / 独立参数语义。缺失策略按自动处理；策略随设置与整机预设保存、导入和导出。

可配置面：`left-sidebar`、`right-sidebar`、`settings-window`、`content`、`declared`、`extra`。高级区域显示当前认领记录的 `id / mode / reason`，不采集插件文本或任意样式值。该列表是面板渲染时的快照，不是所有插件的兼容认证。

这里仍不是「关闭所有玻璃」总开关。聊天、标题栏和其他原有独立玻璃门控不由这张策略表统一关闭。总开关的历史决策见 [ADR-0010](./adr/0010-glass-off-revisit-four-states.md)。

#### 插件作者声明

```html
<section data-we-surface="v1" style="position:relative;z-index:1">
  <div data-we-surface-layout>允许撤去底色的布局容器</div>
  <div data-we-surface-preserve>必须保留的原生内容</div>
</section>
```

- `data-we-surface="v1"`：请求适配，不保证接管。不要仅为接入玻璃给共享祖先新增层叠上下文；示例只适用于本来已有该定位结构的面。
- `data-we-surface-layout`：在已认领声明面内允许清底。不会穿过嵌套声明面的所有权边界。
- `data-we-surface-preserve`：该节点及其后代拒绝玻璃接管，优先于内建适配器与额外选择器。
- `data-we-surface-runtime`、`data-we-layout-runtime` 等运行标记属于内部实现，第三方不要设置或依赖。

不移动第三方节点，不改变第三方 `z-index`，不利用 top layer 抢层。外部可见模态在场时，WE 拉绳、仓库抽屉、更新公告和自动引导暂时隐藏；普通非模态 `role="dialog"` 不触发让路。

#### 排查

| 症状 | 检查 |
|---|---|
| 某面仍有实底 | 查看对应策略和运行原因；未知内容保留实底可能是安全回退，不代表失效 |
| 额外雾化不生效 | 检查目标本来是否有定位和非 auto 层级，是否已有模糊 / `::before`，以及 preserve 声明 |
| 弹层被覆盖或 fixed 偏移 | 对照关闭 WE 时的矩形与实际命中；检查宿主或其他插件的 transform、filter、contain、层叠祖先，不要盲目提高层级 |
| 侧栏收起后出现残底 | 记录侧栏模式、策略和运行原因；正常收起应撤销所有权与装饰叶节点 |
| 关皮肤中心后未恢复 | 等待让路观察完成；持续异常请附宿主与插件版本、步骤和诊断 |

#### 验证与边界

`node test/verify-glass-runtime-browser.mjs` 使用真实构建中的 CSS 与运行器，在独立 Chromium 实例检查深浅主题、窄屏、命中、焦点、fixed 几何、绘制像素、回退和清理。缺少浏览器时必须通过 `WE_TEST_BROWSER` 指定可执行文件，不会静默跳过。回归接入 `npm run verify`。

这些是隔离宿主结构夹具，不等同于每个第三方插件的真实窗口验收，也不证明原生崩溃或长期稳定性已修复。未测平台和独立审查状态须另行列出。

更多说明：[表面层决策](./adr/0015-glass-surface-ownership.md)、[令牌账本](./TOKEN-CONTRACT.md)、[一般排障](./TROUBLESHOOTING.md)。

#### 玻璃行停用：侧栏主体透明，其余界面回原生

自 `packages/glass`（[ADR-0016](./adr/0016-glass-subpackage.md)）起，玻璃效果是**独立插件行**（`wallpaper-engine-glass`），可在插件管理器单独停用：

- **行启用**（默认）：与既有版本观感逐字节一致 —— 包括 better-sidebar 读 `--dsw-alias-bg-layer-1` 的着色（玻璃的令牌映射照常生效）。
- **行停用**：玻璃样式表与行为层整体退场，`data-we-glass-*` 门控属性无人写 ⇒ 全部玻璃配方失效，宿主回到原生主题。better-sidebar / parallax / 官方 pet 联动不受影响（它们读到的是宿主原生令牌值 —— 这本来就是无玻璃时宿主的默认）；壁纸域的让位规则（画布兜底 / 宿主清底 / 侧栏填充）留在主包 —— **左右侧栏主体保持透明（壁纸从侧栏透出）**；其余界面回宿主原生主题，壁纸功能不随玻璃行停用而受损。左栏玻璃开关本身仍只管「透明 ⇄ 玻璃」：关着是透明洞，打开才换玻璃配方。
- **主包行停用**：玻璃行随服务面级联停靠（[ADR-0014](./adr/0014-subpackage-contract.md) S7.2），整族退场。

**运行中停用 / 启用即时生效、无需重启宿主**：桌面宿主的行开关不触发已加载页面的客户端重载，所以玻璃 bundle 自带一条自观测通道 —— 它每 3 秒探测一次 `GET <base>/glass-row-state`（页面隐藏时暂停、恢复可见立即探测），**路由存在 = 本行启用**（行停用 ⇒ 宿主 prune 该行 fiber ⇒ 404）。探测到 404 后，浏览器半边撤掉自己的玻璃样式表、跑行为层 `disposeGlassLayer()`（`data-we-glass-*` 门控属性与 `--we-*` 变量整族摘除）、停下设置节渲染并清空表面状态投影；重新启用则原样恢复（样式表回注 + `sync` 重跑）。所以停用后**左右侧栏主体保持透明、其余界面回仓原生外观**；单次探测失败保持现状，不因网络抖动翻转观感。

### 客户端异常也留痕（`client-error`）

面板是 React 渲染的，一次渲染期异常会让整块界面白掉，而**这台机器打不开 DevTools** ⇒ 诊断缓冲里
什么都没有、只剩"UI 崩了"这句转述。因此客户端挂了两个监听器（`error` / `unhandledrejection`），
把异常的消息与栈前三行写进同一条诊断通道（`[we-live …] client-error · …`，级别 `error`，随 fiber 注销）。
标签是 `client-error`：排查时先 `Select-String 'client-error' diag/http.jsonl`，有栈就能直接定位。

### 测试

`npm run verify`（含 client / 转码 / 播放控制 / scene / scene-live 等）+ `npm run smoke`（轮换、实时帧回填、
字体集加载等节点级冒烟）；`npm run verify:all` = 构建 + 两套全跑 + 软档。**链上条数别写在这里** —— 真源是
`test/run-guards.mjs` 的 `MANIFEST`，写死一个数字就会漂。
