<div align="center">

<img src="icon.png" alt="DSH Wallpaper Engine 项目图标" width="96" height="96">

# DSH Wallpaper Engine

**把喜欢的壁纸，带进每一次对话。**

Wallpaper Engine 实时壁纸 · 液态玻璃 · 自定义外观 · Windows / macOS / Linux

[![GitHub Release](https://img.shields.io/github/v/release/elysia395/dsh-wallpaper-engine?style=for-the-badge&logo=github&label=Release&color=27866b)](https://github.com/elysia395/dsh-wallpaper-engine/releases/latest)
[![npm Version](https://img.shields.io/npm/v/dsh-plugin-wallpaper-engine?style=for-the-badge&logo=npm&label=npm&color=cb3837)](https://www.npmjs.com/package/dsh-plugin-wallpaper-engine)
[![npm Downloads](https://img.shields.io/npm/dm/dsh-plugin-wallpaper-engine?style=for-the-badge&logo=npm&label=Downloads%2Fmonth&color=27866b)](https://www.npmjs.com/package/dsh-plugin-wallpaper-engine)
[![GitHub Stars](https://img.shields.io/github/stars/elysia395/dsh-wallpaper-engine?style=for-the-badge&logo=github&label=Stars&color=d4a72c)](https://github.com/elysia395/dsh-wallpaper-engine/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/elysia395/dsh-wallpaper-engine?style=for-the-badge&logo=github&label=Forks&color=4385be)](https://github.com/elysia395/dsh-wallpaper-engine/forks)

[![CI](https://img.shields.io/github/actions/workflow/status/elysia395/dsh-wallpaper-engine/verify.yml?branch=main&style=flat-square&logo=githubactions&label=CI)](https://github.com/elysia395/dsh-wallpaper-engine/actions/workflows/verify.yml)
[![Contributors](https://img.shields.io/github/contributors/elysia395/dsh-wallpaper-engine?style=flat-square&logo=github&label=Contributors)](https://github.com/elysia395/dsh-wallpaper-engine/graphs/contributors)
[![License](https://img.shields.io/github/license/elysia395/dsh-wallpaper-engine?style=flat-square&label=License&color=4385be)](https://github.com/elysia395/dsh-wallpaper-engine/blob/main/LICENSE)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-5fa04e?style=flat-square&logo=nodedotjs&logoColor=white)
![Platforms](https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux-4385be?style=flat-square)

[中文](README.md) · [English](README.en.md) · [新手指南](README.beginner.md) · [安装](#安装) · [更新记录](https://github.com/elysia395/dsh-wallpaper-engine/blob/main/docs/CHANGELOG.md) · [反馈问题](https://github.com/elysia395/dsh-wallpaper-engine/issues) · [支持与赞赏](#支持与赞赏)

</div>

一个 DSH 插件，把本机 **Wallpaper Engine** 的场景、网页与视频壁纸放到对话界面后方，再配上液态玻璃、字体、吉祥物与可分享的外观预设。不向 agent 注册工具或注入提示文本，**不增加模型 token 开销**。

![主界面效果展示](https://github.com/elysia395/dsh-wallpaper-engine/releases/download/media-v1/main-interface.gif)

> 上方版本、下载量、Stars、Forks、贡献者数量与 CI 状态由 Shields.io 动态获取，受服务缓存影响，并非秒级实时；平台与 Node.js 徽章是兼容信息。没有手填测试通过数量或第三方榜单排名。

## 可选桌宠联动

本分支新增与 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 的可选联动：侧栏后拉、跳抓吉祥物、踢侧栏后原生弹飞、张嘴哈气抖屏四条逻辑。桥接运行时、安装器、必要素材和回归均收在完整的 [pet-link 子包](packages/pet-link/README.md)，不是依赖开发者本机目录的外置脚本。

**不硬依赖、不自动安装 dsh-pet。** 没有桌宠或不满足联动资格时，仍使用 wallpaper 吉祥物的原生行为。按 **`Ctrl+Shift+D`** 打开可拖动维护面板：四页参数与气泡时间节点独立，支持当前页重置、全部重置、JSON 导出；无资格时保留维护能力但禁用试跑。

首次体验需显式运行严格指纹安装器，它会备份并修改受支持的 `dsh-pet@0.3.6`；请先阅读[安装风险、体验与热插拔边界](packages/pet-link/README.md)。当前是跨插件作者评审入口，不代表桌宠上游已提供稳定官方控制 API。

## 快速开始

```sh
dsh plugin --profile web add dsh-plugin-wallpaper-engine
```

重启 `dsh web`，打开 **设置 → Wallpaper Engine → 壁纸库**，选择一张壁纸即可。

**前置条件**：DSH 内核 `>=0.1.5-rc.1`；Node.js `>=18`。桌面端用户优先通过应用内插件市场安装，命令行安装时使用对应的 `desktop` profile。`dsh-better-sidebar` 是可选配套插件，不是必装依赖。

没用过命令行？从 [新手指南](README.beginner.md) 开始。

## 目录

<table>
  <tr>
    <td width="64%" valign="middle">
      <ul>
        <li><a href="#能做什么">能做什么</a> · <a href="#支持哪些壁纸类型">支持哪些壁纸类型</a> · <a href="#安装">安装</a> · <a href="#使用">使用</a></li>
        <li><a href="#配置与数据">配置与数据</a> · <a href="#兼容与限制">兼容与限制</a> · <a href="#开发与贡献">开发与贡献</a></li>
        <li><a href="#联系方式">联系方式</a> · <a href="#致谢">致谢</a> · <a href="#支持与赞赏">支持与赞赏</a> · <a href="#star-history">Star History</a></li>
      </ul>
    </td>
    <td width="36%" align="center" valign="middle">
      <a href="https://github.com/elysia395/dsh-wallpaper-engine/blob/main/assets/about/sponsor-fish.png">
        <img src="https://raw.githubusercontent.com/elysia395/dsh-wallpaper-engine/main/assets/about/sponsor-fish.png" alt="生鱼的微信赞赏码；点击查看原图" width="320">
      </a>
      <br><strong>生鱼的赞赏码</strong>
      <br><sub>“大肥鱼的白饭告急，收到的赞赏将统统用于本插件的维护与更新”</sub>
      <br><sub>自愿赞赏 · 不影响安装与使用</sub>
    </td>
  </tr>
</table>

## 能做什么

| 方向 | 能力 |
|---|---|
| 实时壁纸 | 内置 **WebWallGL** 渲染 Scene / Web 壁纸，支持粒子、puppet 骨骼、SceneScript、鼠标交互与音频反应；视频直接播放 |
| 液态玻璃 | 设置窗口、对话区与侧边栏玻璃效果，支持配色、透明度、雾化、边框与独立侧栏参数 |
| 外观预设 | 整套配置快照，字体、吉祥物与头像资产可按需携带；支持 JSON 导出、导入与分享 |
| 字体与配色 | 按颜色角色、排版角色和组件细调字体；支持系统字体、终端字体、字体集与独立光标颜色 |
| 吉祥物 | **10 只内置立绘 + 自定义导入**，通过 3D 圆环选择；拉绳展开壁纸仓库抽屉 |
| 壁纸库 | 内容分级与类型筛选、批量隐藏与恢复、自定义图片 / 视频上传、WE 项目目录收录、自动轮播 |
| 播放与降载 | 帧率上限、转码缓存、倍速、水平翻转、切换过场、遮挡暂停与可迁移的缓存目录 |
| 音乐联动 | 系统输出回环频谱、Now Playing 歌曲信息与封面；在线歌词按需启用 |
| 扩展效果 | 可选的会话头像、点击 / 拖尾特效、壁纸与界面视差；不需要的效果可关闭 |
| 宿主适配 | Windows / macOS / Linux 共用同一个 npm 包；界面跟随 DSH 的语言设置 |

场景渲染失败时会逐级降级，首帧准备期间使用可用的预览图。不同壁纸使用的资源与脚本不同，**不能保证每张工坊壁纸都与 Wallpaper Engine 本体完全一致**。渲染与降级规则见 [工作原理](https://github.com/elysia395/dsh-wallpaper-engine/blob/main/docs/HOW-IT-WORKS.md)。

## 支持哪些壁纸类型

| 类型 | 在 DSH 中的路径 | 支持情况 |
|---|---|---|
| **Scene（场景）** | 内置 WebWallGL 实时 WebGL 渲染；失败按降级链回退 | 支持，不需要 WE 在后台运行 |
| **Web（网页）** | 网页挂载、WE API 注入与沙箱隔离 | 支持；效果取决于网页及浏览器能力 |
| **Video（视频）** | 浏览器播放，配合转码、帧率上限与暂停控制 | 支持 |
| **Application（应用）** | 需要启动第三方可执行程序 | **不支持**，不进入壁纸库与轮播候选 |
| **自定义图片 / 视频** | 上传本地 JPG / PNG / MP4 | 支持，文件保存在本机 |

## 安装

### 普通用户

浏览器版安装或更新：

```sh
dsh plugin --profile web add dsh-plugin-wallpaper-engine
```

桌面版通过应用内插件市场安装；使用 CLI 时：

```sh
dsh plugin --profile desktop add dsh-plugin-wallpaper-engine
```

安装或更新后，**重启对应宿主**。桌面版需要完全退出应用后重新打开，而不只是刷新页面。

版本要求以 npm 包声明和 [升级指南](https://github.com/elysia395/dsh-wallpaper-engine/blob/main/docs/UPGRADING.md) 为准。历史桌面端版本号与 DSH 内核版本号不是同一个概念，不要混用。

### macOS / Linux

三平台使用同一个包。系统媒体链路分别使用 Windows 的 GSMTC、macOS 的 MediaRemote、Linux 的 MPRIS。

macOS 没有 Wallpaper Engine 官方客户端。可以上传图片 / 视频，或把「自定义壁纸 → 存储位置」指向包含 WE 项目的目录。含 `project.json` 与场景包、网页入口或视频的项目会按对应类型收录；这些项目目录只读，不参与上传文件的删除操作。

### 安装失败

`ERR_PNPM_UNEXPECTED_VIRTUAL_STORE` 等安装错误的处理见 [故障排查](https://github.com/elysia395/dsh-wallpaper-engine/blob/main/docs/TROUBLESHOOTING.md)。

## 使用

1. 打开 **设置 → Wallpaper Engine**，或向下拉聊天顶部的吉祥物拉绳，展开「壁纸仓库」抽屉。
2. 在「壁纸库」中点 **选择壁纸**，进入页内库视图。它不是额外的模态弹窗。
3. 通过缩略图选择壁纸，按需调整播放与外观。修改即时生效并保存到宿主端。
4. 暂停 / 播放控制视频；清除当前壁纸不会删除原文件。

![设置界面功能展示](https://github.com/elysia395/dsh-wallpaper-engine/releases/download/media-v1/settings-ui.gif)

### 六个设置页签

| 页签 | 主要内容 |
|---|---|
| **壁纸库** | 壁纸选择、筛选、自定义上传与轮播列表 |
| **外观** | 主题预设、配色、玻璃、侧边栏圆角、全局 UI 配色与字体 |
| **播放** | 画面滤镜、取景、倍速、过场、音频与媒体联动 |
| **系统** | 吉祥物、宿主适配、遮挡暂停、缓存与高级选项 |
| **扩展** | 会话头像、点击与拖尾、3D 视差等可选效果 |
| **关于** | 项目入口、Star 数、交流群与贡献者信息 |

### 壁纸库与自动轮播

- **筛选**：按内容分级与类型过滤；筛选同时作用于库视图与轮播候选。
- **隐藏 / 恢复**：只改变列表，不删除源文件。支持批量隐藏与恢复；隐藏当前壁纸不会中断播放。
- **自动轮播**：创建列表，选择壁纸并设置间隔与顺序 / 随机播放。至少需要两张可播放壁纸。
- **准备后切换**：下一张准备完成后再交接；失败候选自动跳过。可选择硬切、淡化、推移等过场，系统「减少动态效果」开启时使用硬切。
- **壁纸属性**：Scene / Web 壁纸可显示作者定义的颜色、开关、滑块等属性，按壁纸保存，并可恢复默认。

![壁纸库与壁纸仓库](https://github.com/elysia395/dsh-wallpaper-engine/releases/download/media-v1/wallpaper-library.gif)

> 演示素材保留历史界面；当前交互以安装版本为准，壁纸选择在页内库视图完成。

### 液态玻璃、字体与预设

- 设置窗口玻璃当前恒开；可调整颜色、透明度和雾化，没有恢复原生纯色的总开关。
- **额外补雾化的选择器**：第三方插件面板自身没有 `backdrop-filter`，全局「雾化」到不了它们 —— 在这里填它们的 CSS 选择器即可补上毛玻璃（逗号或换行分隔，最多 8 条、每条最多 120 字；超长的单条与超出 8 条的都**整条丢弃**，绝不截断成半截选择器；目标元素需自己已定位 `fixed` / `absolute`，载体挂在它的 `::before` 上，所以不影响面板内部的定位弹层。留空 = 关；[#200](https://github.com/elysia395/dsh-wallpaper-engine/issues/200)）。
- 设置页与侧栏均可调整外观，各节支持折叠；侧栏的圆角、全局 UI 配色与全局字体默认收起。
- **主题随壁纸默认关闭**。开启后才按作者配色与画面取色切换深浅主题；本张壁纸下手动改过主题后，自动切换会让位。
- 字体支持按角色 / 组件细调、系统字体枚举与字体集管理。终端里的 Nerd Font 图标需要对应字体。
- 「主题预设」保存的是整套配置，不只是玻璃参数。导入只加入列表，不立即应用；分享时可选择携带字体、吉祥物和头像。
- **套用预设前注意覆盖范围**：预设可能更换或清除自定义资产。保存、导出与套用前，阅读对应确认提示。

默认值、枚举与取值范围以 [设置 schema](https://github.com/elysia395/dsh-wallpaper-engine/blob/main/lib/settings-schema.js) 和当前控件为准，避免在文档中维护一套容易过时的数值。

### 吉祥物与扩展

3D 转盘提供 **Deepseek_Pro、菲比啾比** 与 **Claude、DeepSeek、Gemini、GPT、GLM、Grok、Kimi、Qwen**，默认形态是 **DeepSeek**。支持拖动、方向键与圆点导航，也可导入自己的立绘；自定义生效后仍可选择内置项，但切回前会要求确认清除自定义立绘。

「小女仆」不在内置转盘中，由「作者自用」预设携带。会话头像、点击 / 拖尾与 3D 视差在「扩展」中按需启用。

### 播放、省电与音乐联动

- 画面可调模糊、亮度、对比度、饱和度、透明度、暗化与取景。视频支持倍速与翻转。
- 帧率上限由 ffmpeg 转码生成缓存：先播放原片，完成后切换；优先使用可用的硬件编码器，失败回退原片或软件编码。
- 遮挡暂停覆盖视频解码和场景实时渲染；窗口失焦暂停只在原生浏览器适配目标下提供，纯网页 iframe 不受同样的暂停控制。
- 系统音频反应采集的是**输出回环，不是麦克风**。媒体中间件按需下载并校验，不可用时回退内置实现。
- Now Playing 提供歌名、歌手、专辑、封面与播放进度；支持这些 WE API 的壁纸可显示它们。
- **在线歌词默认关闭**。开启后，本地歌词不可用时才向 [LRCLIB](https://lrclib.net) 查询，请求会发送歌名、歌手和专辑。

## 配置与数据

全部设置保存在宿主端 `~/.dsh-wallpaper-engine/config.json`，不依赖浏览器端口。重启、换端口或清浏览器数据不影响这份配置；旧 localStorage 配置可自动迁移。

| 数据 | 默认位置 | 调整入口 |
|---|---|---|
| 设置与插件数据 | `~/.dsh-wallpaper-engine/` | 环境变量 `DSH_WE_DATA_DIR` |
| 可再生成缓存 | `~/.dsh-wallpaper-engine/cache/` | 系统 → 高级 → 缓存位置；或 `DSH_WE_CACHE_DIR` |
| 上传的壁纸 | `~/.dsh-wallpaper-engine/uploads/` | 壁纸库 → 自定义壁纸 → 存储位置；或 `DSH_WE_UPLOAD_DIR` |
| 按需下载的运行时 | 数据目录下的 `bin/` 等子目录 | 由插件管理 |

修改缓存 / 上传位置时会迁移对应的插件文件，不移动目标目录中不认识的文件。环境变量优先于面板中的路径设置。

常用环境变量：

| 变量 | 用途 |
|---|---|
| `DSH_WE_DATA_DIR` | 覆盖整个数据目录 |
| `DSH_WE_CACHE_DIR` / `DSH_WE_UPLOAD_DIR` | 覆盖缓存 / 上传目录 |
| `DSH_WE_STEAM_ROOT` | 指定 Steam 根目录，支持多个候选 |
| `DSH_WE_ASSETS_DIR` | 覆盖 WE 官方资源路径 |
| `DSH_WE_FFMPEG` / `DSH_WE_FFMPEG_URL` | 指定 ffmpeg 文件 / 下载源 |
| `DSH_WE_TRANSCODE_TIMEOUT_MS` | 单次转码的超时预算 |
| `DSH_WE_MEDIA_BRIDGE` / `DSH_WE_MEDIA_BRIDGE_URL` | 指定媒体中间件文件 / 下载源 |
| `DSH_WE_MEDIA_BRIDGE_TAG` / `DSH_WE_MEDIA_BRIDGE_SHA256` | 指定中间件版本与校验值；自定义版本必须给出 SHA-256 |
| `DSH_WE_MEDIA_LEGACY` | `=1`，强制使用内置媒体实现 |
| `DSH_WE_MEDIA_NO_AUDIO` | `=1`，只读取媒体信息，不采集系统音频 |
| `DSH_WE_MEDIA_PROVIDER` | `=mock`，使用模拟播放器联调 |
| `DSH_WE_MEDIA_IDLE_MS` / `DSH_WE_MEDIA_DEBUG` | 中间件空闲回收时间 / 调试日志 |

插件不向模型注册工具，不上传你的壁纸；但下载运行时、查询仓库 Stars 和主动开启在线歌词会访问外部服务。它不是「完全离线」插件。

## 兼容与限制

- **三平台可安装不等于 WE 官方三平台可用**。没有 WE 客户端的平台通过项目目录或自定义上传使用壁纸。
- 场景渲染依赖浏览器的 WebGL 能力和显卡驱动。失败会降级，复杂工坊项目可能存在兼容差异。
- Application 壁纸不支持，插件不会为此启动第三方程序。
- ffmpeg 不可获取时，转码 / 帧率上限不可用，但视频仍可按原片播放。
- 桌面壳最小化 / 还原仍可能出现短暂白帧；窗口底板属于宿主能力，插件不能完全消除。
- `dsh-better-sidebar` 可选；插件为它的侧栏提供独立玻璃参数与字体适配。不支持 `backdrop-filter` 的浏览器回退实色。
- 与其他皮肤同时启用时，查看 [共存说明](https://github.com/elysia395/dsh-wallpaper-engine/blob/main/docs/COEXISTENCE.md)，避免让多个插件同时接管同一表面。

![侧栏玻璃与字体适配](https://github.com/elysia395/dsh-wallpaper-engine/releases/download/media-v1/better-sidebar-font.png)

## 开发与贡献

欢迎提交 Bug 复现、平台兼容反馈、文档修正和功能 PR。反馈时请附宿主 / 插件版本、操作系统、壁纸类型、复现步骤与相关日志；不要附带 API Key 等凭据。

本地安装、构建、验证与客户端产物规则见 [贡献指南](https://github.com/elysia395/dsh-wallpaper-engine/blob/main/CONTRIBUTING.md)。宿主端改动需要重启 DSH；客户端产物由构建脚本生成，不要手工编辑生成文件。

- [更新记录](https://github.com/elysia395/dsh-wallpaper-engine/blob/main/docs/CHANGELOG.md)
- [升级指南](https://github.com/elysia395/dsh-wallpaper-engine/blob/main/docs/UPGRADING.md)
- [工作原理](https://github.com/elysia395/dsh-wallpaper-engine/blob/main/docs/HOW-IT-WORKS.md)
- [故障排查](https://github.com/elysia395/dsh-wallpaper-engine/blob/main/docs/TROUBLESHOOTING.md)

> npm 包不包含 `docs/`。上面的技术资料使用源码仓库地址、演示图使用 Release 资产地址（`media-v1`），避免在 npm 页面中出现无效的相对路径。

## 联系方式

Bug 与功能建议优先提交到 [GitHub Issues](https://github.com/elysia395/dsh-wallpaper-engine/issues)，方便追踪与复现。交流也可以加入以下群组；插件「关于」页使用同一份二维码。

| QQ 群 | 抖音群 |
|---|---|
| <img src="lib/about/qq-group.png" alt="QQ 群二维码" width="260"> | <img src="lib/about/douyin-group.png" alt="抖音群二维码" width="260"> |
| **DSHWE \| LLM 讨论群** | **dshwe 交流 2 群**（群号 917001335502） |

## 致谢

感谢所有提交代码、维护文档、反馈问题和帮助验证的朋友。以下按贡献方向整理，不按提交数量排名；历史方案的贡献同样保留。

### 项目维护与核心建设

| 贡献者 | 贡献 |
|---|---|
| [elysia395](https://github.com/elysia395) | 项目发起与维护、版本发布、预设策展、公告与社区维护 |
| [YV3507](https://github.com/YV3507) | 早期场景渲染与静态帧修复、液态玻璃令牌、实时帧链路、架构重构、文档与回归守卫；整合社区 PR（含 [#181](https://github.com/elysia395/dsh-wallpaper-engine/pull/181)） |
| [oneincase](https://github.com/oneincase) | [WebWallGL](https://github.com/oneincase/webwallgl) 与 [media-bridge](https://github.com/oneincase/media-bridge) 作者；实时渲染、三平台媒体链路、壁纸属性及合成 / 性能修复（[#103](https://github.com/elysia395/dsh-wallpaper-engine/pull/103)、[#104](https://github.com/elysia395/dsh-wallpaper-engine/pull/104)、[#165](https://github.com/elysia395/dsh-wallpaper-engine/pull/165)） |
| [yuxilao](https://github.com/yuxilao) | Linux scene-gl 实时渲染探索、性能优化、轮换交接、GPU 帧回填与官方资源路径（[#65](https://github.com/elysia395/dsh-wallpaper-engine/pull/65)、[#108](https://github.com/elysia395/dsh-wallpaper-engine/pull/108)） |
| [Jerry / ruijiaang-lab](https://github.com/ruijiaang-lab) | 早期 macOS / WaifuX 支持、工坊目录扫描、缩略图兜底、上游移植与贡献路径文档（[#44](https://github.com/elysia395/dsh-wallpaper-engine/pull/44)、[#45](https://github.com/elysia395/dsh-wallpaper-engine/pull/45)、[#52](https://github.com/elysia395/dsh-wallpaper-engine/pull/52)、[#54](https://github.com/elysia395/dsh-wallpaper-engine/pull/54)） |

### 社区功能与修复

| 贡献者 | 贡献 |
|---|---|
| [Fish-under-sea](https://github.com/Fish-under-sea) | 整机预设快照、资产携带与导出 / 导入；吉祥物 3D 转盘、外观分节与折叠（[#173](https://github.com/elysia395/dsh-wallpaper-engine/pull/173)、[#180](https://github.com/elysia395/dsh-wallpaper-engine/pull/180)） |
| [WTStarMark](https://github.com/WTStarMark) | 侧边栏圆角与独立角控制；大型壁纸库 JSON 应答的协商式 gzip（[#177](https://github.com/elysia395/dsh-wallpaper-engine/pull/177)、[#183](https://github.com/elysia395/dsh-wallpaper-engine/pull/183)） |
| [levodoubt](https://github.com/levodoubt) | 扩展模块基础、点击与拖尾、3D 视差，以及逐区域界面跟随（[#135](https://github.com/elysia395/dsh-wallpaper-engine/pull/135)、[#144](https://github.com/elysia395/dsh-wallpaper-engine/pull/144)） |
| [Willhamster](https://github.com/Willhamster) | 标题栏液态玻璃与相关回归验证（[#145](https://github.com/elysia395/dsh-wallpaper-engine/pull/145)） |
| [383891598](https://github.com/383891598) | 扩展思考区玻璃效果、Windows 窗口控制区黑底修复（[#134](https://github.com/elysia395/dsh-wallpaper-engine/pull/134)） |
| [SiriLee](https://github.com/SiriLee) | 亮度 / 对比度 / 饱和度调节、吉祥物拉绳开关、WSL 下 Steam 根目录探测 |
| [libiwolve](https://github.com/libiwolve) | 内容分级与壁纸类型过滤 |
| [0-007pro](https://github.com/0-007pro) | 基于播放列表的自动轮播 |
| [jujubaoj646-star](https://github.com/jujubaoj646-star) | 字体与气泡样式自定义面板 |
| [xiahou001](https://github.com/xiahou001) | 壁纸音轨音量控制 |
| [wilianyichen](https://github.com/wilianyichen) | MP4 按需缩略图、自上传壁纸内容分级 |
| [hecoococ](https://github.com/hecoococ) | 侧栏玻璃与活动壁纸解耦 |
| [ShamSky88](https://github.com/ShamSky88) | 输入框玻璃模糊与固定定位修复 |
| [Rekk0](https://github.com/Rekk0) | 玻璃透明度令牌化、通过注册表定位 Steam |
| [Y1X1n](https://github.com/Y1X1n) | 新手使用指南 |
| [wwexplorer](https://github.com/wwexplorer) | 壁纸水平 / 垂直 / 缩放取景与直接数值输入 |

完整、持续更新的代码贡献记录见 [GitHub Contributors](https://github.com/elysia395/dsh-wallpaper-engine/graphs/contributors) 与 [已合并 PR](https://github.com/elysia395/dsh-wallpaper-engine/pulls?q=is%3Apr+is%3Amerged)。也感谢没有代码提交、但通过 Issues、交流群和真机验证帮助项目的朋友。

本项目基于 [MIT License](https://github.com/elysia395/dsh-wallpaper-engine/blob/main/LICENSE) 开源。感谢 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) 提供插件宿主，以及 WebWallGL、media-bridge 等上游项目提供基础能力。Wallpaper Engine 与工坊壁纸的版权归各自权利人，本插件不是 Wallpaper Engine 官方产品。

## 支持与赞赏

项目保持开源，赞赏完全自愿，不影响安装、使用或问题反馈。给仓库点 Star、提交可复现的 Issue、补充文档与参与测试，同样是在支持项目。

**生鱼的赞赏码**：赞赏用于本插件的维护与更新。以下是生鱼个人的赞赏入口，不代表全部贡献者的收款账户。

> “大肥鱼的白饭告急，收到的赞赏将统统用于本插件的维护与更新”

赞赏码展示在 [目录](#目录) 右侧，点击图片可查看原图。感谢每一份支持。

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=elysia395/dsh-wallpaper-engine&type=Date)](https://star-history.com/#elysia395/dsh-wallpaper-engine&Date)
