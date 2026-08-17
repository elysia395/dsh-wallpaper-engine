# dsh-plugin-wallpaper-engine

[English](README.md) | [中文](README.zh.md)

一个 DSH bundle，把你电脑上的 **Wallpaper Engine** 壁纸变成 **DSH 网页界面（`dsh web`）的背景**。

它会自动发现你本机的壁纸（macOS 读 WaifuX、Windows 读 Wallpaper Engine），列出你的壁纸，并把动态视频 / 图片渲染到 DSH 对话界面的后方，配以 **iOS 风格液态玻璃**效果。你可以在设置里挑选壁纸、用四个滑动条微调，也能随时暂停或关闭。

## 快速开始（新手从这里看，全程鼠标点击，不用命令行）

**macOS（用 WaifuX 壁纸）**

1. **装好 WaifuX 并登录**（用 Steam 账号登录），在 WaifuX 里下载你喜欢的壁纸——动态视频、静态图片都行
2. **在 DSH 里装本插件**：打开 DSH → **插件市场** → 搜索 `wallpaper` → 找到本插件 → 安装（mac 版包含 WaifuX 支持）
3. **选壁纸**：DSH → **设置 → 通用 → Wallpaper Engine** → 点开选择器选一张，聊天背景立刻变成它

不需要任何配置。插件会自动读取 WaifuX 的下载文件夹，**以后你在 WaifuX 里下载的新壁纸也会自动出现**，不用重装、不用设置。

**Windows（用 Wallpaper Engine 壁纸）**

1. 在 Steam 里装好 **Wallpaper Engine**，订阅你喜欢的壁纸（视频 / 网页壁纸）
2. 在 DSH 插件市场安装本插件（步骤同上）
3. 设置 → 通用 → Wallpaper Engine → 选壁纸

插件会自动发现 Steam 里的壁纸库，装在哪块盘都能找到。

**让文字更清楚**：选完壁纸后，下面有四个滑动条（模糊 / 暗化 / 边框 / 玻璃），都是拖一下立刻生效。如果聊天文字看不清，把 **暗化** 和 **边框** 调高一点就行。每张壁纸的明暗不一样，可以配合 DSH 的浅色 / 深色主题切换着试。

**壁纸没出现？** 两步排查：① 重启 DSH Desktop（换壁纸不用重启，**刚改完设置或刚下载完壁纸要重启一次**）；② 确认 WaifuX 用的是默认下载位置（没有改过下载目录）。

## 为什么只支持 Video 和 Web 壁纸？

Wallpaper Engine 的壁纸分四种类型：

| 类型 | 由谁渲染 | 能否搬到 DSH |
|---|---|---|
| **Scene（场景）** | Wallpaper Engine 自带的 3D 引擎 | ❌ 不能 — 原生 3D（`.obj`/着色器），只有 WE 能渲染 |
| **Video（视频）** | 就是一个 `.mp4` 文件 | ✅ 能 — 在 `<video>` 标签里播放 |
| **Web（网页）** | WE 内置的 Chromium 壳（`webwallpaper64.exe`）承载 HTML | ✅ 能 — 在 `<iframe>` 里加载 |
| **Application（应用）** | 注入的外部窗口 | ❌ 不能 |

这是 mineradio 以及所有第三方 Wallpaper Engine 集成方案都无法回避的同一限制：只有 *Video* 和 *Web* 两种壁纸可移植。Scene 壁纸仍会列在选择器里（标为 `[不可播放]`），让你知道自己有什么，但没办法拿来做动态背景。

## 工作原理

- **Host 端**（`lib/index.js`）：一个 Cordis 插件，负责
  1. 通过读取 Steam 的 `libraryfolders.vdf` 定位 Wallpaper Engine 安装位置（所以 Steam 装在非默认盘也能用）；
  2. 从 `projects/defaultprojects`、`projects/myprojects` 以及 `steamapps/workshop/content/431960/*` 枚举壁纸；
  3. 在 DSH webserver 上注册同源 HTTP 路由，让浏览器端直接获取数据和流式加载媒体：
     - `GET /wallpaper-engine/inventory` → 壁纸 JSON 列表
     - `GET /wallpaper-engine/media/<token>` → 视频 / HTML（支持 Range）
     - `GET /wallpaper-engine/preview/<token>` → 预览图
- **Client 端**（`lib/client.js`）：一个浏览器模块，拉取壁纸列表，把选中壁纸渲染到应用三列**后方**的固定图层，并在「设置 → General」里加一个「Wallpaper Engine」行（含选择器）。

## 安装（命令行，给需要手动安装的人）

> 新手用户不需要看这一节——用上面「快速开始」里的插件市场方式安装即可。

### 普通用户（安装已发布版本）

如果你只是想用这个插件，直接装 npm 上已发布的包即可：

```sh
dsh plugin --profile web add dsh-plugin-wallpaper-engine
```

装完重启 `dsh web`，打开 **设置 → General → Wallpaper Engine** 就能用。

### 开发者（运行你本地的一份代码）

**大多数读者可以跳过本节。** 只有当你打算自己改这个插件的代码时才需要。下面的步骤假定你已了解命令行、以及「仓库 / repository」是什么（一份用 Git 做版本管理的代码文件夹）。

**第 1 步：取得源码（checkout）**

> 这里 *checkout* 的意思很简单：就是「把源代码下载/复制一份到你电脑的某个文件夹里」。通常在这个 GitHub 页面点 **Code → Download ZIP** 下载并解压，或用 Git 克隆：
>
> ```sh
> git clone https://github.com/elysia395/dsh-wallpaper-engine.git
> ```
>
> 完成后你会得到一个包含 `package.json`、`lib/`、`src/`、`cordis.patch.yml` 的文件夹。下文把这个文件夹称作**插件文件夹**。

**第 2 步：用文件夹路径安装（link:）**

> 这里的 *`link:`* 表示：告诉 `dsh`（它会把命令转发给 pnpm）去**连接你本地那个插件文件夹**，而不是从网上下载一个包。好处是：你改完代码并重新构建后，改动能直接生效，不用反复重装。

把下面命令里的 `<插件文件夹绝对路径>` **替换成你插件文件夹的完整路径**（就是你在资源管理器/文件管理器里打开那个文件夹时，地址栏显示的那串路径）：

```sh
dsh plugin --profile web add link:<插件文件夹绝对路径>
```

**具体示例**——假设你的插件文件夹路径像 `D:\dev\dsh-wallpaper-engine` 这样：

```sh
dsh plugin --profile web add link:D:\dev\dsh-wallpaper-engine
```

如果你已经用命令行 `cd` 到了插件文件夹的上一级，也可以用相对路径：

```sh
dsh plugin --profile web add link:./dsh-wallpaper-engine
```

> **该填哪个确切的路径？** 必须是**包含 `package.json` 的那个文件夹**——不是 `package.json` 文件本身的路径，也不是它里面任何单个文件的路径。它就是你在资源管理器地址栏里打开那个文件夹时显示的那串路径。

> 为什么推荐 `link:` 而不用 `file:`？`link:` 是和你的源码文件夹**建立实时连接**，改完 `src/client.js` 并 `npm run build` 后直接生效，无需重装；`file:` 则是打包成一份静态快照，每次改动都要重新 add。首次安装两者都可以。

然后重启 `dsh web`。host 端会成为 bundle 层，client 端会自动加载（`dsh.client.immediately: true`）。

如果 Steam 装在非标准位置，host 会通过 `libraryfolders.vdf` 自动探测，无需额外配置。

## 使用

1. 打开 `dsh web`，进入 DSH 界面。
2. 打开 **设置 → General**，找到 **Wallpaper Engine** 行。
3. 在下拉框里选一个 Video 或 Web 壁纸，它会出现在界面后方。
4. 用 **暂停/播放** 暂停视频壁纸，用 **关闭** 清除壁纸。
   选择会保存在浏览器的 `localStorage`（键 `dsh-wallpaper-engine:selection`）中。

### 自动轮转

在壁纸选择器中先选择一个 Wallpaper Engine 播放列表，再勾选 **自动轮转**，插件只会在该播放列表内循环，不会把全部壁纸一股脑加入。可选间隔为 1、5、10、30、60 或 120 分钟；默认关闭。至少需要两张可播放的 Video/Web 壁纸，手动切换壁纸会重新计算下一次轮转时间；播放列表的随机/顺序设置也会被保留。Scene 和 Application 壁纸不能嵌入网页，会自动从轮转候选中剔除，但仍会显示在选择列表中并标记为 `[不可播放]`。

播放列表从 Wallpaper Engine 安装目录的 `config.json` 读取（优先使用保存的 `general.playlists`；没有保存列表时回退到当前显示器的活动列表）。

### 四个滑动条

壁纸激活后，四个滑动条可以微调它与界面的融合效果：

| 滑动条 | 作用 | 范围 | 默认 |
|---|---|---|---|
| **壁纸模糊** | 模糊壁纸本身 | 0–60 px | 0 |
| **暗化** | 加深壁纸与文字之间的遮罩 | 0–90 % | 25 % |
| **边框** | 提高边框 / 分割线的对比度 | 0–90 % | 35 % |
| **玻璃** | 玻璃面板（输入栏、气泡）的模糊半径 | 0–40 px | 24 |

> **浅色 / 深色模式的适配提醒** — 每张壁纸的色系和明暗差异很大，**没有哪一种模式能适配所有壁纸**。请在 DSH 的「浅色 / 深色」主题之间来回切换，找到适合当前壁纸的那一种。如果在偏亮或花纹复杂的壁纸上 **文字或分割线看不清**，就把 **暗化**、**边框** 两个滑动条调高（必要时再稍微加一点 **壁纸模糊**），直到看着舒服为止。四个滑动条都是即时生效的，**无需刷新页面**。

## 配置

本插件不会向模型暴露任何工具或提示文本，对 agent 零 token 开销。所有状态都是进程内 / 浏览器内的，不会写入任何持久化 DSH 设置。

## macOS

Wallpaper Engine 没有 macOS 客户端，所以 macOS 上本插件是**目录驱动**而非 Steam 驱动。它会扫描内容文件夹，把其中的 `.mp4`/`.webm`（视频）和 `.png`/`.jpg`/`.gif`/`.webp`（图片）文件都当作壁纸：

- **WaifuX**（macOS 上常用的壁纸软件）——它的下载目录会被默认扫描：`Wallpapers/`（静态图片）、`Media/`（动态视频），以及 **WaifuX 通过 steamcmd 下载的 Wallpaper Engine 工坊壁纸**（标准 Steam 目录，无需任何设置），在 WaifuX 里保存的壁纸**零配置**自动成为 DSH 背景。
- `~/Documents/dsh/we-content/`——手动放 loose 文件到这里即可用作背景。
- `DSH_WALLPAPER_ENGINE_CONTENT` 环境变量（冒号分隔的目录列表），或拷过来的 Wallpaper Engine 安装 / projects 目录树。

## 分支约定

- `main` — Windows 优先的上游主线。**macOS 相关改动不要提交到这里。**
- `dsh-wallpaper-engine-mac` — 上游仓库里的 macOS 分支（WaifuX 集成）。macOS 相关工作请基于此分支开发 / 把 PR 指向这个分支。
- [ruijiaang-lab fork](https://github.com/ruijiaang-lab/dsh-wallpaper-engine) 里的 `mac` 分支是持续维护的 macOS 分支（上游 PR 的源）。

## 已知限制

- Scene（原生 3D）和 Application 壁纸无法内嵌，选择器里会显示为 `[不可播放]`；它们的动态渲染仍是 Wallpaper Engine 在桌面上的工作。
- 浏览器需能自动播放静音 `<video>`（DSH 跑在 loopback，现代浏览器允许静音自动播放）。
- 媒体从你本机的 Wallpaper Engine 安装路径提供；host 只提供它已枚举过的文件，不会暴露任意文件系统。
- 选择器文案为中英混合（本 bundle 尚未接入 DSH 的 locale 命名空间）。

## 致谢

本插件是 [elysia395/dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine) 的 **macOS 扩展分支**。原项目（Windows / Wallpaper Engine 实现）由 **elysia395** 开发维护；本 fork 在其基础上新增 macOS 支持（WaifuX 集成、目录式发现），Windows 原有代码与上游功能均保留原作者署名与维护。

## 开发 / 重建

host 端（`lib/index.js`）是纯 ESM，无需构建。client 端（`lib/client.js`）是**编译产物**，由规范源文件 `src/client.js` 经 `scripts/build-client.mjs` 生成，输出 DSH 模块加载器要求的 `window.__ModuleLoader__.load({ id, factory })` 外壳（与盒内 client 包 `tsdown` 产出的形态一致）。

```sh
npm run build      # 从 src/client.js 重新生成 lib/client.js
npm run verify     # 物化生成的 bundle 并断言其导出
```

编辑 `src/client.js` 后运行 `npm run build`，不要手改 `lib/client.js`。`npm install`/`pnpm install` 会自动触发 `prepare` → `build`，因此全新 checkout 总是带最新的 `lib/client.js`。

host↔browser 的契约是同源 HTTP，两端可独立开发：改 host 后重启 `dsh web` 生效，改 client 则先 `npm run build` 再重启 `dsh web`。
