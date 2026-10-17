# 工作原理

> **English**: [`en/HOW-IT-WORKS.md`](./en/HOW-IT-WORKS.md)（与本文同源：改一处请同步另一处）
>
> 本文讲**用户可见行为**（"为什么这么渲染、失败时怎么样"）。**代码结构**在 [`CODE-STRUCTURE.md`](./CODE-STRUCTURE.md)，
> **为什么这么设计**在 [`adr/`](./adr/)。**不写会漂的数值** —— 条数 / 体积 / 耗时阈值一律指向实现或给复算方式
> （见 [`README.md`](./README.md) §写作纪律 4）。

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
  `liveFirstFrameBudget()`（`src/live-layer.js`）按**包大小**现算，并有上限；
  而且宿主侧有一本**载荷账本**（客户端轮询
  `GET /wallpaper-engine/scene-payload-progress?token=…`，见 [`ROUTE-INDEX.md`](./ROUTE-INDEX.md)），
  字节还在涨就每拍重置计时 ——
  "正在下载"不再被算成"渲染不出来"。**隐藏 / 未播放的实例根本不拉载荷**（建层时延迟赋 `src`、
  切到后台时把 `src` 摘成 `about:blank` 中止在飞请求），因为这种实例既出不了帧（Chromium 冻结隐藏页
  的 rAF），又会和**看得见**的那个实例抢带宽与解码器。
  **首帧确实没出来时还要分因**：账本说"传过但没传完"⇒ 只记**会话内**软失败（不写所有窗口共用的
  失败记忆），冷却后自动重试且次数有上限（两个值都是 `src/live-layer.js` 的常量
  `LIVE_TRANSFER_RETRY_DELAY_MS` / `LIVE_TRANSFER_RETRY_LIMIT`）；只有渲染页真的不出帧 / 运行期失联才落盘记忆。
- **出图来源（唯一权威顺序，代码在 `lib/routes/scene-frame.js`）**：
  ① 实时渲染 iframe → ② 场景**作者内嵌 MP4**（`sceneVideo`，硬件解码 `<video>`）→ ③ **实时抓帧**
  （`<key>_gpu.png`，live 渲染页首帧确认后由客户端回填）→ ④ **自定义画面**（用户导入的截屏）
  → ⑤ **空态**（404 + 可判定原因）。
  **首帧之前不留黑屏**：垫底画面按 **实时抓帧 → 作者随包发布的工程预览图 → 主题色** 取
  （`buildLivePoster`）—— 新壁纸**第一次**激活时抓帧还不存在（要等这一轮 live 回填），先由作者的
  预览图占位，live 首帧一到即被顶掉。预览图只是占位，**不会被当成"这张壁纸的出图"**。
  关掉实时渲染不会改变 ①②；`?v=4` 是"强制自定义画面"（**豁免**抓帧：显式 pin 的来源不被一张抓帧顶掉），
  `?v=1/2/3` 已退役、一律 clamp 到 0。
- **为什么没有 CPU 兜底出图（P2-12 的设计决定）**：0.6–0.7.x 曾用「离线场景渲染器 / 主纹理提取 /
  工坊预览图」三级兜底。它们的共同缺陷是**能"成功"产出一张劣质图**：绕过质量门禁、把糊帧写进缓存、
  让"这张壁纸没有可用画面"这个**可判定事实**退化成一张看似正常的画面 —— 用户看到的是"壁纸糊了"，
  而不是"它没有画面"。整条线（渲染器 + 提取链 + 合成器，约 1 万行）已随 P2-12 删除；现在的契约是
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

> **载荷来源（独立媒体源）**：**网页壁纸的入口 HTML 与全部子资源**，以及**场景壁纸的 `scene.pkg`
> （本机实测到 **336MB**；文档早先写的"常 70–90MB"已过时）**，都由宿主**自建的独立 loopback 媒体源**
> （`127.0.0.1` 上的随机端口，见
> `GET /wallpaper-engine/media-origin`）提供，**不走**插件的 HTTP 路由（媒体源不可用时才回落应用源）。
> 原因：DSH Desktop 给每条插件路由都套了能力头栅栏（`x-dsh-desktop-renderer`，只注入给同源 frame 发出的
> 请求），而严格沙箱 iframe 是不透明源、永远拿不到这个头 —— 壁纸入口会一律 `403 Forbidden`（表现：预览图
> 先正常、随后整块黑）。媒体源不经过该栅栏，第三方 HTML 也因此连宿主 origin 都不沾边，沙箱之外又多一层隔离。
> **场景壁纸走它则是为了载荷速度**：大 `scene.pkg` 走应用源那条路挤不过首帧预算（还要买纹理解码与
> shader 编译），故宿主把它的载荷**无条件**指向媒体源。
> **`scene.pkg` 还可重验证缓存**：响应带 `ETag`（size+mtime）+ `Last-Modified`，条件请求命中即 `304` 无体 ——
> 几百 MB 的包每次重建 live 层都重读一遍盘，靠这一条消掉（入口 HTML 仍 `no-store`：它带注入的 shim 与属性种子）。
>
> **这个第二监听什么时候真的起**（适配器模式，设置在「高级 → 适配」）：**场景载荷与适配器形态无关** ——
> 它要独立源的理由是**带宽**，浏览器形态同样成立，所以 `inventory.sceneMediaBase` 不再因"观测到浏览器"
> 而落空串（旧写法在原生浏览器下恒为空 ⇒ 大包必然走那条会饿死的路，2026-09 修）。**网页壁纸**那一条
> 仍按能力头门控（栅栏只在桌面壳里）：宿主按请求观测**能力头**与**UA 里的 `Electron/`**，观测到任一即为
> 桌面形态、照常起媒体源；两者皆无（**原生浏览器**）时没有栅栏，网页载荷直接走应用源的**相对路径** ——
> 同一段挂载处理函数服务两处，形态差异只体现在 URL 上。媒体源是**按需懒启动**的：库里有网页壁纸、
> 或库里有**可实时渲染的场景**（`sceneLive`）时才起；场景那个源经
> `inventory.sceneMediaBase` 下发给客户端（**空串 = 起不来 ⇒ 回落应用源**，见客户端层键里带这一格：
> 宿主把它端出来之后会重建一次渲染页）。手选适配目标
> 可强制任一方向；`GET /wallpaper-engine/media-origin`
> 是显式探测，按需起、不经过这条门控。

> **帧率上限与「卡」的排查**：网页壁纸的 rAF 上限由 shim 按**跳帧**实现 —— 每帧都与显示器 vsync 对齐、
> 只把第 n 帧交给壁纸（`setTimeout` 定时器式实现会产生 17/33/50ms 抖动，观感更差）。实时渲染期间每 5 秒
> 往诊断文件写一条 `live-fps`：`ui=` 整页帧率、`web=` 壁纸自身帧率、`rnd=` 渲染页帧率、`cap=` 当前上限 ——
> 「限了 30 还是卡」时先看这条：只有 `web` 低＝壁纸自己的开销；`ui` 也低＝整页代价（例如侧栏液态玻璃的
> `backdrop-filter` 每帧重采样壁纸，可先把模糊调小验证）。

> **已知边界**：作者脚本的 `fetch`/`XHR` 在 opaque origin 下携带 `Origin: null`（宿主已返回
> `Access-Control-Allow-Origin: *`，常规资源可用）；`wallpaperMediaIntegration`（系统 Now Playing /
> 歌曲封面）已提供数据源；CSS `:hover` 等由浏览器 hit-test 驱动的交互不受外部指针注入影响（与上游文档一致）。

### 宿主 / 客户端分工

- **Host 端**（`lib/index.js` 门面 + `lib/kernel/` 内核 + 各组件包 `packages/<组件名>/lib/`（P-F 组件行统一：三格 2026-10-16 全部出户；`visibility.js` 随后移到 `lib/component-visibility.js`，`lib/components/` 目录已删除）+ 跨组件共享的 `lib/routes/*.js`）：bundle patch 里的**多行** —— 门面一行 + 每个组件各一行，每行都是宿主眼里的独立 plugin / fiber。**开关口径 = A 语义（宿主行级）**：停用某个组件行 ⇒ 该组件的宿主路由**整族不注册**（浏览器侧仍随整包加载，「关掉即不下载」是**非目标 N5**，见 [`adr/0013`](adr/0013-bundle-multi-component-rows.md)）。它负责
  1. 先定出 **Steam 根**（`DSH_WE_STEAM_ROOT` 显式覆盖 → 注册表 → 常见安装目录 → WSL 的 `/mnt`；显式覆盖排在最前，且列出的根没命中时会继续往后找），再从 `libraryfolders.vdf` 取库列表，最后在各库与默认位置里找 Wallpaper Engine（所以 Steam 装在非默认盘也能用）。**"已安装"的判据是标记文件、不是某一个 exe 的位置**：经典布局看顶层 `wallpaper32.exe` / `wallpaper64.exe`，当前版本把 exe 放进 `distribution\`（旁边有稳定的 `version.json`），两种都认；无论命中哪个标记，返回的始终是**安装根**（`projects/` 与 `config.json` 所在处，因为 portable 项目扫描与 WE 播放列表都挂在这层）。Steam 库的判据同理只认**真正会被扫描的那个目录** `<库>/steamapps/workshop/content/431960`，不以安装夹是否存在为准；
  2. 从 `projects/defaultprojects`、`projects/myprojects` 以及 `steamapps/workshop/content/431960/*` 枚举壁纸；
  3. 在 DSH webserver 上注册同源 HTTP 路由，让浏览器端直接获取数据和流式加载媒体。按职责分五族：
     **素材** · **转码** · **实时渲染** · **出图与抓帧** · **设置与系统**。
     **组件私有的族随组件目录走、注册点在组件行入口**（`packages/about-notice/lib/` 的二维码与 star 数 ——
     P-F 2026-10-16 出户，原 `lib/components/about-notice/`；
     `packages/mascot-avatar/lib/` 的立绘与头像 —— 同样 P-F 2026-10-16 出户，原 `lib/components/mascot-avatar/`；
     `packages/media-bridge/lib/routes/now-playing.js` 的五条媒体路由 —— P-F 批 1c 2026-10-16 出户，
     原 `lib/components/media-bridge/now-playing.js`），`lib/routes/` 只留**跨组件共享**的族。
     **权威清单（含每条路由的名称、来源行、注册形态与 context 契约）见 [`ROUTE-INDEX.md`](./ROUTE-INDEX.md)** ——
     本文件不手写路径表，也不写条数（手写的必烂，且除生成物外没人复算它）。
- **Client 端**（`lib/client.js`）：一个浏览器模块，拉取壁纸列表，把选中壁纸渲染到应用三列**后方**的固定图层；在「设置」里注册一级设置页「**壁纸引擎**」——六个页签（壁纸库 / 外观 / 播放 / 系统 / 扩展 / 关于），「选择壁纸」是页内下钻的库视图（无弹框），含隐藏 / 恢复、过场 / 倍速 / 翻转、配色 / 透明度、字体自定义与自定义壁纸管理（整页的玻璃配方与**有没有壁纸无关**：锚点是 `body` 上的 `data-we-glass-page`，由 `src/glass.js` 的 `applyGlass` 恒挂（插件在跑就挂）、`src/effects.js` 的 `clearEffects` 成对撤除；壁纸只是玻璃的**背景来源**之一，`data-we-wallpaper` 只管"页面让开、露出壁纸层"那两条（页面基色 / 侧栏填充置透明））（「外观」页的**「左侧栏液态玻璃」默认关**：关着时宿主原生左栏只是"透明的洞"—— `--dsw-specific-sidebar-fill` 被置 transparent、壁纸原样透出；打开后那一列也走同一张玻璃配方，锚点是座位出口 `[data-slot="sidebar"]` 的**父元素**（出口自己 `display:contents` 不生成盒子），见 `src/styles.js` 的「左侧栏液态玻璃」段）（「扩展」是后加的**模块容器**：登记表由 `src/panel-tabs.js` 的 `extensionModules()` **惰性**给出（顶层不直接引用兄弟模块的符号 —— 否则单独 import 这个源文件时会 ReferenceError）；表里还有**「点击效果与拖尾效果」**：描述符 `packages/fx/src/ext-fx.js`（扩展岛：总开关 + 点击 / 拖尾两个子开关与它们的样式、尺寸、光晕、时长、粗细、不透明度、混合模式、配色），画布层 `packages/fx/src/fx-layer.js`（**纯客户端、零宿主**）—— 它只 passive 监听 `document` 的 pointermove / pointerdown（宿主是 `pointer-events: none` 的浮层 ⇒ 不接管输入；落在 `button, a, input, select, textarea, label, [role="button"], [contenteditable="true"], .we-picker, .we-modal` 命中的界面控件上的点击直接丢掉，免得"点按钮顺便炸一圈"），用一个**内容驱动**的 rAF 循环画进 body 级画布 `.we-fx`（`z-index: -1`，靠文档序压在壁纸与 `scrim` 之上（仍在全部界面之下）—— 每帧用 `compareDocumentPosition` 核对一次、被盖住就插到 `scrim` 之后）；点击画两圈扩散的圆环（第二圈晚 18% 寿命起步）或一簇**不等长**的飞散亮点 + 中心一次白闪，拖尾要么按时间把一条圆头光带逐段收细、要么按固定步距把亮点留在原地，两者都按年龄降 alpha、龄满即除（指针停住也照淡），没有内容时循环自行收工（空闲零帧）；这一层**刻意不读壁纸像素**（所以没有「自动」档），不透明度与混合模式写在**宿主元素**上（写在画布上只会跟宿主自己的层叠上下文混合），层内用 `lighter` 叠加、颜色可跟主题色 / 彩虹（每个实例一个色相、还随时间流转）/ 自定义；表里还有**「3D 效果」**：行为层 `packages/parallax/src/parallax-layer.js` + 描述符 `packages/parallax/src/ext-parallax.js` —— 它与前面那个模块相反，**一个 DOM 节点都不建**：只 passive 监听 `document` 的 pointermove / `window` 的 resize（外加一条 `visibilitychange`），把光标偏离屏幕中心的量换算成位移，每帧把**算完的最终位移**直接写进**要动的那几层自己**身上的 **CSS 独立属性 `translate`**（两位小数；值没变就不写）—— 位移**不走自定义属性**：自定义属性是继承的，写下去等于让整棵子树重算样式；body 上只剩一个"壁纸补边系数" `--we-parallax-bg`（只在设置变了时写一次，喂 `src/styles.js` 视差段那条静态 `scale: calc(1 + 系数 / 50)`，也就是壁纸额外放大 `1 + pct/50` 补边）；**百分比的口径 = 这一层能达到的最大位移占屏幕最长对角线的 p%**（光标贴到屏幕角上时 |位移| 恰好 = p% × 对角线）⇒ 每帧的算式是 `位移 = 2 × pct/100 ×（光标 − 屏幕中心）`，层里写作 `PARALLAX_STEP_DIV = 50`。壁纸与吉祥物各乘自己的百分比（默认壁纸 1%，吉祥物跟壁纸同值）；界面（输入卡片 / 会话文本区（连里面的用户气泡一起）/ 侧栏）由子开关 `parallaxUi`（默认关）另管，四个区域**各存自己的绝对百分比**（`parallaxUiChatDepth` / `parallaxUiComposerDepth` / `parallaxUiSidebarDepth` / `parallaxUiBubbleDepth`，KINDS `num 0..10`、步长 0.1、出厂 1.2 / 1.8 / 1.6 / 1.4（那四档是实际调好的那一组；真源 = `lib/settings-schema.js`））：老口径那枚总倍率 `parallaxUiDepth` 连同"面板 ×100、存档 ÷100"整条退役 —— 面板与存档从此**同一个单位**，某一块设 0 就是这一块不缓动，气泡那一路的位移**叠**在文本区之上（且只给最近 24 条；`PARALLAX_UI_SIGN = 1` 让界面与壁纸**同向** ⇒ 近处的界面比远处的壁纸多走一点，像镜头横移）；**别的插件注册的前端元素组**由**自己的开关** `parallaxPlugin` 另管（**独立于 `parallaxUi`、默认关** —— 它动的是别的插件画出来的真实界面）：关着时层**连扫都不扫**（不是系数算成 0）、面板那一卡只有开关；开着时才扫宿主槽出口 `[data-slot]`（出口自己 `display: contents`、不生成盒子 ⇒ 位移落在它的**元素子节点**上），跳掉整帧容器 / 原生三组的出口本身 / 设置与插件管理那几块子树，再过一道 `parallaxPluginEffectiveGroups()`：落在**原生四组盒子**里、或落在**另一个认到的插件组**里的出口不算（⚠️ 这道只在「界面元素跟随」**开着**时才算 —— 关着时那四组压根不是候选），距离住 `parallaxPluginDepths`（槽键 → %，`map` 档），**缺键 = 缺省 1%、显式 0 = 这一组不缓动**（那张表只在开关开着时才算数）；面板那张名单由层里的 `parallaxDiscoveredGroups()` 经 `ctx` 交给扩展岛（**与屏上同源**：它和重扫共用同一个 `parallaxPluginEffectiveGroups()` ⇒ 认到几个画几行、每一行都有落点；唯一例外 = 组里有 `position: fixed` 后代时整组不动，写进那一行的 tooltip），面板把它与背景 / 原生前端分成三张卡（「背景」/「原生前端」/「插件前端」），壁纸与吉祥物那一路方向取负 ⇒ **关于屏幕中心对称**（光标在右上 ⇒ 整块往左下），缓动是按帧时长做的指数逼近（跟手程度 = `parallaxSmooth`，0 = 立刻跟手），追上目标就收工（空闲零帧），页面不可见时一帧都不排；用**独立属性 `translate` / `scale`** 而不是 `transform` —— 壁纸过场的 `resetLayerSwitchStyles` 会内联写 / 清 `transform`，独立属性才与它叠加；帧里零测量（视口只在起帧 / resize 读、目标重扫同样在帧外），`localStorage.weParallaxDebug = '1'` 可开一份帧自检（每帧回调耗时 / 写入次数 / 帧间隔的 p50·p95·max 与长帧计数，收工打一行并挂 `window.__weParallaxStats`）；**点击与拖尾那一层刻意不参与**（用户口径）；界面那一组挪的是会话滚动容器**里面**的真实元素 ⇒ 视差段顺手给那个容器封了横轴（`body[data-we-parallax="on"] [data-conversation-scroll] { overflow-x: hidden; }`）：不封的话，横向位移一越出它的 inline-end，宿主写的 `overflow-y: auto` 就会让另一轴也长出滚动条，一条横向滚动条占掉 scrollport、把 sticky 的输入卡片整个顶上去；界面整块跟着动是**另一个子开关**（`parallaxUi`，默认关）—— 宿主槽出口（`[data-slot=…]`）自己写死 `display: contents`、**不生成盒子** ⇒ 位移落在**锚点自己（自己就有盒子就用自己）或最近的有盒子的祖先**上（`parallaxGroupBox()`，最多往上 3 层），否则写上去屏上一点不动；它的位移**量化到整设备像素**（免得文字被推到半像素上发虚），而且量化带**迟滞**（缓动尾巴会在零点附近来回，已经写下的那一整像素就保留着，直到越过迟滞带才改 —— 少了这一层，界面会在两帧之间 0↔1 设备像素地翻来翻去，看着正是"经过中线时发抖"）；归零时把 `translate` **整条摘掉**（属性在就成立包含块，会改变固定后代的参照）；组内出现任何 `position: fixed` 后代就整组不动、嵌套的组只取最外侧那一个（**用户气泡是例外**：它长在会话文本区盒子里，位移故意叠上去）；**左栏是唯一例外形态**：它写的是**相对定位**（`position: relative` + `left`/`top`），**绝不写 `translate`** —— Windows 标题栏模式下宿主把「收起侧边栏」按钮做成那一列里的 `position: fixed` 后代，给那一列任何 `transform` 都会让它变成按钮的**包含块**、把按钮整体压下一个标题栏的高度（#131 那类事故）；相对定位不产生包含块，所以左栏既安全、也**不吃**上面那条 fixed 后代判定；表为空就画空态 —— 后续功能只往表里加一项，页签本身不用再改）（「关于」不读面板状态：简介 / 仓库与 Star / 交流群二维码 / 致谢，两张码是随包 PNG（`lib/about/`，经路由 `/about-qr/<文件名>` 直出），那行 star 数由宿主代取 GitHub API（`packages/about-notice/lib/routes/github-stars.js`，本插件唯一一条出站请求，带缓存））；另带**快捷播放面板**：常驻区（当前壁纸 + 轮播）在三档页签下都显示，页签为**壁纸 / 外观 / 播放** —— 壁纸页是列表快切（搜索 / 类型筛选 / 列表·卡片两种视图）与声音；外观 / 播放两页与设置页同名页签**共用同一批渲染器**（侧栏档只画**简化配置**：全局四件套与各面总开关；**预设方案**、每个面的「独立配置」层及其子项、思考块门下的细调行属**高级配置**、只在设置页画 —— ADR-0008 D4；播放页另少画出图来源 / 实时帧 / 帧率上限这些设置页专属分组），两处因此永远是同一份状态；底栏那颗入口按钮随页签深链到设置页的对应页签 —— harness ≥0.1.5 融进官方右侧栏的「壁纸」tab，低版本宿主走吉祥物拉出的右滑抽屉。
- **自定义壁纸存储**：上传的文件写入插件管理的本地目录（默认 `~/.dsh-wallpaper-engine/uploads`，可在设置里改到任意盘符），经同一套 `/media`、`/preview` 路由服务（视频缩略图另走 `/video-preview`）——与 WE 媒体走完全相同的管道，天然跨重启持久、无浏览器配额限制。

> 开发相关（构建产物、热挂载规则、缓存键前缀）见 [`../CONTRIBUTING.md`](../CONTRIBUTING.md)。

### 字体集：一整套外观住在哪

字体自定义以**一套**为单位（「字体集」）。它**不是** settings 里的一堆键，而是**文件**：

- **两层存储**：随包层 `lib/fontsets/<id>.json`（只读）+ 用户层 `<pluginDataDir>/fontsets/<id>.json`；
  同 id **用户层胜**。改随包那份会**写时复制**成用户层的一份，删掉它 = 「恢复原样」（随包那份
  重新可见）。`config.json` 只留根字段 `{ fontSetId, fontCustom }` —— 字体键不在 settings 的
  持久化白名单里（唯一真源是 `lib/settings-schema.js`，客户端与宿主共用同一份 kind 消毒）。
- **谁负责什么**：宿主 `packages/fonts/lib/routes/fontsets.js` 一个 `prefix` 注册挂七个端点（列表 / 读 / 写 / 删 /
  激活 / 导入 / 导出）；客户端 `src/fontset-store.js` 是**另一条**通道（与设置平行：真源不同、键集不同、
  失败语义也不同 —— 字体集读不出来必须**整套不采用**）；`packages/fonts/src/fontset-editor.js` 是纯渲染面板。
- **切换只有一条写原语**：`POST …/activate` 改指针，改完客户端**必须把它那份值读回来采用**（只挪指针
  界面不会变）。"使用中"的判据是**值仍与采纳时一致**，指针另作能力判定（活动集不可删）。
- **导入导出**：导出走宿主响应头 + 普通链接（桌面端 = 系统「另存为」），导入前按文件里的 `$schema`
  预检并给出具体原因。取舍记录见 [`adr/0011`](./adr/0011-preset-full-snapshot.md)（导入导出随「整机配置快照」引入）。

### 本机字体清单：问操作系统，然后缓存

「默认字体（全局）」与「终端字体」的下拉里，除了内置族键还有**本机已安装字体**。这份清单**不是**
插件自己读字体文件得来的，而是**问操作系统**（macOS 上**两条腿并行**：`system_profiler` 出**本地化**
族名、CoreText 出**规范（英文）**族名，名字取并集 —— 所以 `苹方-简` 与 `PingFang SC` 都能选到；
Windows PowerShell 的 `InstalledFontCollection` / Linux `fc-list`）；都拿不到时按**字体文件名**推，并**如实标"推测"**
（面板会写出来）。一次扫描很贵（macOS 秒级到十秒级）⇒ 双层缓存 + 过期**先回旧值**再后台重扫 +
面板上的「重新扫描」；**启动期不扫**（第一次真的用到才触发）。
⚠️ **系统列出的族名不等于浏览器能匹配的族名**（`Apple Color Emoji` / `Symbol` / `Zapf Dingbats` 这类**系统保留字体**，以及 `苹方-繁` 这类同一字体的另一种写法，都可能取不到）—— 面板渲染时会探一次「这个名字在本浏览器里到底能不能用」，把用不了的略掉并**如实写出略过了几个**，免得「选了没反应」被当成功能坏了。决策与代价见
[ADR-0009](./adr/0009-system-fonts-from-the-os.md)，机制不变量在 `packages/fonts/lib/routes/system-fonts.js` 与
`src/system-fonts.js` 的文件头。

### 抓帧几何校验（视口宽高比）

抓帧是「抓帧那一刻渲染页视口的构图」—— 渲染器按画布比取景（与场景设计比 2% 内 → 整张设计上屏，
否则按画布比 cover 裁切），而静态帧上屏时还要再经 CSS `object-fit: cover`。所以**在别的窗口 / 旧会话
抓的帧**拿到当前窗口上屏会被再裁一次：实测一张 1440×960（3:2）的帧在 2488×1376 视口里只显示场景设计
宽度的 84.5%（对 CPU 帧做最佳匹配拟合得到），人物比 live 大约 19% 且四周被切。因此宿主在
`HEAD /scene-frame/<token>` 上附带 `X-WE-GPU-W/H/AR`（读 PNG 的 IHDR，纯文件头，不触发提取），客户端
拿它与当前视口比对照：相对差 > 2%（与渲染器自己的 fit 容差同口径）或几何未知（旧宿主 / 文件读不出）→
**先抓帧过内容门禁，再清槽、再 PUT**（清槽在抓帧之后：抓帧失败时留下空槽会退回 CPU 帧，比留一张旧构图
的帧更糟），落地后就地重挂屏上静帧并记 `gpu-frame-stale` / `gpu-frame-recaptured` 诊断行。旧帧因此会在
下次挂载 / 轮换时自愈，不必手动清理。

### 空帧门禁与清除通道

体积阈值不可靠（headless 实测全黑 PNG：960×540≈12KB、1080p≈44KB、4K≈165KB，都远超固定字节闸），
因此抓帧前会把 canvas 降采样到 `LIVE_FRAME_SAMPLE` 见方看亮度分布 —— 近全黑或几乎无对比度判为
「还没渲染出画面」，直接放弃回填（保留 CPU 帧），另加分辨率相关的体积地板。
**四个阈值与采样边长都由 `src/live-layer.js` 的常量给出**（`LIVE_FRAME_SAMPLE` · `LIVE_FRAME_LIT_RATIO` ·
`LIVE_FRAME_MIN_VARIANCE` · `LIVE_FRAME_BYTES_PER_PX`），本文不抄它们的数值 —— 它们是**可调参数**，
抄进来就会与实现脱钩。抓到不满意的一帧时，在
**设置 → 效果 → 画面 → 「实时帧」**里有三个入口：**微缩预览**（就是切换途中 / live 首帧前显示的那张静帧，
与层里正在用的 URL 同源 —— 附像素尺寸）、**「重新截」**（按**当前**画面重抓一张并替换缓存；抓不到就原样
保留，原因显示在行内）、**「清除 GPU 帧」**（等价于 `DELETE /wallpaper-engine/scene-frame-cache/<token>`，
或 `POST …?clear=1` —— 删后 HEAD 回到 `X-WE-GPU: 0`、当前档位立即生效、下次 live 会重新抓取）。

> **这一行不受「场景实时渲染」开关影响**：那张实时帧正是切换壁纸途中与 live 首帧之前屏幕上显示的画面，
> 构图不对（黑帧 / 旧视口 / 切走瞬间抓的）时用户必须能**立刻重抓**，而不是先关掉实时渲染再回来。同理
> **「自定义画面」也一直显示**（导入截图与实时渲染互不干扰）。只有**「出图来源」**（换抓帧档位）在
> 实时渲染生效时隐藏 —— 那时换档位不会生效，摆出来只会误导。

### 遮挡暂停：判定**不只靠事件**

「最小化 / 切页时暂停」「窗口失焦时暂停」「电池供电时暂停」三项（设置 → 效果 → 省电）都由
`occlusionReason()` 一处判定，再经 `emit()` → `syncLayers()` 落到视频的 play/pause。判定最初只由
`visibilitychange` / `blur` / `focus` 事件驱动 —— 这有一个**原生模态**造成的漏洞：`window.confirm` /
`alert` 会把焦点交给它自己的窗口，而**回来时的 `focus` 事件不保证送达**。于是判定永久停在
「窗口失焦」：壁纸停住、判定也不会再变（真机形态是"确认弹窗之后壁纸不播了、只剩重载能救"）。

现在事件之外还有一次**低频复核**（`OCCLUSION_RECHECK_MS = 3000`）：只在判定**变了**的时候
`emit()` 并写一行 `play-state … occlusion-recheck` 诊断 —— 所以常态零代价，而"事件丢了、复核补上"
这件事在诊断缓冲里看得见（这是事后排查唯一能依赖的痕迹）。

> 破坏性操作的确认因此**不用原生对话框**：字体集的删除走**面板内**确认（点一次"待确认"、再点"确认"）。
> **这条迁移已经做完**：`src/**` 的**代码**里 `window.confirm` 一处都没有，只剩解释"为什么禁用"的注释。
> 终态由 `test/verify-fontset.mjs` 的棘轮按 **0** 钉住（它只扫破坏性动作族所在的那几个文件 ——
> 想扩面就改那条棘轮的文件清单，别把条数写进文档）。

### 主题随壁纸：取色链与让位规则

换壁纸后插件决定全局深 / 浅（`src/theme-follow.js`）—— 由**「主题随壁纸」开关**控制，
在 `lib/settings-schema.js` 里**默认关**（关 = 本节的整条取色链都不跑）。开关打开后按优先级取色：

1. **壁纸自己声明的配色** —— `project.json` 的 `general.properties.schemecolor.value`（0–1 浮点三元组；
   WE 编辑器里它的 `text` 就是 `ui_browse_properties_scheme_color`）。宿主 inventory 已把它转成
   `rgb()` 发过来（`schemeColor`）；你在「壁纸属性」面板里改过的**覆盖值优先**于作者值。
   **实测本机库里绝大多数壁纸都带这条属性** ⇒ 大多数壁纸根本不需要图像处理。
   **恰好 `0 0 0` 的作者值视作"没填"**（WE 新建工程的默认值，在本机库里占相当比例）⇒ 退回 ②；
   面板里显式填的纯黑照用。
   > 命中比例**不写进本文**：它随"你装了哪些壁纸"变化，是**每个用户不同**的数字。
   > 需要复算时按 `schemeColor` 字段统计即可（口径见宿主 `buildInventory`）。
2. **画面占比最大色** —— 仅在 ① 缺席时跑：把画面缩到 `LIVE_FRAME_SAMPLE` 见方，按 **4 bit/通道**
   量化后取众数桶（量化口径与桶数以 `src/theme-follow.js` 的取色实现为准；
   同一条下采样先例见 `liveFrameLooksUsable`）。
   **两个来源合议**：作者 的 `preview` 与真实渲染帧（场景在实时渲染抓帧那一刻顺手取色，
   复用同一次 `LIVE_FRAME_SAMPLE` 采样；网页用 `__wp.capture` 的那张）各判一次，**不一致时取深色**，
   只有两条腿都说是浅色才用浅色（抓帧可能落在画面还没稳定的时刻）。两者都不参与 ①。画面若有绝对 URL 则用 `crossOrigin="anonymous"`（媒体源自带
   `Access-Control-Allow-Origin: *`），画进 canvas 不会被污染。
3. **两条都拿不到 ⇒ 保持当前主题**，不切也不抖。

判定：WCAG 相对亮度（与 `test/verify-readability.mjs` 同一套系数），阈值 **0.40** —— 语义是
"**明显偏亮**才配浅色界面"（不取中灰 0.2159：本机库作者配色的亮度中位数就是 0.214，阈值切在
分布最密处会让饱和中间调被判浅，而人眼看它是深的）。

写入走宿主的客户端 Cordis 服务 `theme`（`setTheme('dark' | 'light')`，官方端与社区端同一套 API），
且与我们的令牌层用的是**同一个句柄**（都来自那次 `ctx.get('theme')` 轮询；刻意不声明 `inject`，
理由见 src/client.js 主题层那段）。三条自我约束写在模块头：**结论与当前偏好相同就不写**
（`setTheme` 会把偏好落进 profile 的 `cordis.patch.yml`）、**你手动改过就让位**（同一张壁纸重复评估
也不抢回来，换下一张恢复）、**宿主没有主题服务则整体不生效**。

### 客户端异常也留痕（`client-error`）

面板是 React 渲染的，一次渲染期异常会让整块界面白掉，而**这台机器打不开 DevTools** ⇒ 诊断缓冲里
什么都没有、只剩"UI 崩了"这句转述。因此客户端挂了两个监听器（`error` / `unhandledrejection`），
把异常的消息与栈前三行写进同一条诊断通道（`[we-live …] client-error · …`，级别 `error`，随 fiber 注销）。
标签是 `client-error`：排查时先 `Select-String 'client-error' diag/http.jsonl`，有栈就能直接定位。

### 测试

`npm run verify`（含 client / 转码 / 播放控制 / scene / scene-live 等）+ `npm run smoke`
（轮换、实时帧回填与身份校验、字体集加载等节点级冒烟）—— 所有断言都有
失败通道（不通过即非零退出），`npm run verify:all` = 构建 + 两套全跑 + 软档。
**链上有多少条别写在这里**：真源是 `package.json` 的 `verify` / `smoke` / `verify:docs` 三个脚本，
读它们即得 —— 写死一个数字就会漂。
