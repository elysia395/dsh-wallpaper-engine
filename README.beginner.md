# Wallpaper Engine 插件入门 / Beginner Guide

[中文完整版](README.md) · [English README](README.en.md) · [English below](#english)

> **版本说明**：本指南对应**源码部署**，不是 npm 上已发布的版本；npm 通道见 [README](README.md)。当前安装单位是**主包 + 八个子包，共九包**，不再内置 pet。

## 中文

### 它能做什么

把 Wallpaper Engine 的场景、网页和视频壁纸放到 DSH 聊天界面背后，再调整玻璃、字体、配色与吉祥物。没有 Wallpaper Engine 也能上传自己的 JPG / PNG / MP4。Application 类型需要运行第三方程序，本插件不支持。

界面美化不向 AI 注册工具或注入提示词，**不额外消耗模型 token**。壁纸保存在本机；运行时下载与仓库统计仍会联网。

### 安装前准备

- Windows、macOS 或 Linux 上能正常运行的 DSH。
- **DSH 内核**：安装门槛看 `package.json` 的 `engines.dsh`（0.2 线可装；桌面应用版本号与内核版本号不是一回事）。
- **Node.js（下限见 `package.json` 的 `engines.node`）、pnpm 和目标宿主的 DSH CLI**。
- 目标 DSH 的**数据目录**和 **profile**。网页版通常是 `web`；桌面版为 `desktop`。数据目录从目标应用确认，不要照猜 `~/.dsh`。
- 下载并解压本仓库的完整源码，不要只下载主包、某个子目录或临时链接。

Wallpaper Engine 只用于读取已有壁纸资源，不需要一直在后台运行。macOS 没有其官方客户端，可以用自定义上传或已有 WE 项目目录。

### 第一步：完整安装源码

1. 完全退出目标 DSH 应用，包括托盘进程。
2. 在解压后的插件目录打开终端，确认这里有 `package.json`。
3. 把命令里的占位目录换成目标 DSH 的真实数据目录，先预览：

```sh
node scripts/install-source.mjs --profile web --dsh-home "<目标 DSH 数据目录>" --dry-run
```

确认目标正确后安装：

```sh
node scripts/install-source.mjs --profile web --dsh-home "<目标 DSH 数据目录>" --app-closed
```

**桌面版不能只把 `web` 改成 `desktop` 就使用任意 CLI。** 它必须通过桌面宿主提供的 carrier CLI 管理；独立 npm 安装的 `dsh` 会拒绝桌面 profile。需要指定 CLI 时加 `--dsh-cli "<目标 CLI 的 lib/bin.js 路径>"`。不知道目标目录或 CLI 时，先查看 [完整安装说明](README.md#安装)，不要对猜测路径执行。

脚本会安装依赖、构建客户端并登记全部八条持久链接。完成后重启 DSH。**安装后保留源码目录，不要移动或删除它**；链接仍指向这里。

源码部署不要使用裸 `github:` 直装、临时子包链接工具，或只执行 npm 包名安装；npm 命令只提供已发布的版本。

### 第二步：选择壁纸

1. 打开 **设置 → Wallpaper Engine → 壁纸库**，或下拉顶部吉祥物拉绳打开抽屉。
2. 点「选择壁纸」，在**页内库视图**点选缩略图，不是额外的模态弹窗。
3. 通过返回退出库视图，按需调整外观与播放。设置即时生效，保存到宿主端。

| 想做什么 | 入口与说明 |
|---|---|
| 换壁纸 | 壁纸库 → 选择壁纸 |
| 上传图片 / 视频 | 壁纸库 → 自定义壁纸；支持 JPG / PNG / MP4 |
| 清除当前壁纸 | 当前壁纸的关闭 / 清除操作；不删除源文件 |
| 隐藏不喜欢的项目 | 库视图 → 隐藏；可恢复，不删除工坊文件 |
| 自动轮播 | 轮播列表 → 新建；至少选择两张可播放壁纸 |
| 改配色、玻璃或字体 | 外观；侧栏有独立参数，不是所有表面共用一根滑条 |
| 调亮度、取景、倍速或翻转 | 播放 → 效果 |
| 换吉祥物 | 系统 → 吉祥物；内置若干只（具体见设置页），也可导入 |
| 开会话头像、拖尾或视差 | 扩展；按需启用 |
| 移动缓存 | 系统 → 高级 → 缓存位置 |
| 移动自定义上传 | 壁纸库 → 自定义壁纸 → 存储位置 |

控件直接显示当前范围与数值。文字不清楚时先调整暗化、边框与玻璃底色；不要为了透明而让所有表面都不可读。**主题随壁纸默认关闭**，只有主动打开后才会自动切深浅色；本张壁纸下的手动主题选择优先。

### 可选：与官方 dsh-pet 联动

不需要桌宠也能完整使用壁纸。联动另装 [官方 dsh-pet](https://github.com/PC2005-cloud/dsh-pet)，Wallpaper **不捆绑、不自动安装，也不改写它的文件**。

1. 官方版本需提供同页位置 / 播放进度和公开控制接口，不能只看 `0.3.7` 版本号。
2. 将目标宠物设置为网页显示，并把 Wallpaper 吉祥物设为官方侧栏模式。
3. 按 **Ctrl+Shift+D** 打开调参面板，刷新并选择实际 petId，再试四条联动逻辑。

同一宠物在网页 / 桌面的动作按官方共享状态同步；联动气泡只在发起网页自绘，不会出现在桌面透明窗口，也不会清除官方气泡。未找到目标时原生侧栏操作仍可使用。位置采用官方原生运动，不保证视频缓冲时逐帧同步。完整官方宠物及桌面演出的真机视觉验收仍待补齐，详见 [联动说明](packages/pet-link/README.md)。

从旧内置版升级时，先退出宿主并停用旧内置行；旧依赖、数据与历史补丁不会自动清理。不要为了联动再次安装旧补丁工具。

### 更新与数据

更新时完全退出宿主，更新**整个源码目录**，重跑原安装命令，再启动 DSH。不要只替换某个生成文件。

一般壁纸设置保存在 `~/.dsh-wallpaper-engine/config.json`；缓存和上传默认也在该数据目录。环境变量可覆盖路径。清理浏览器不会删除这份宿主配置，但**pet 目标选择和运行时调参不全在这个文件里**，需要保留的调参请先导出 JSON。

更改缓存 / 上传目录会迁移已识别的插件文件，不搬走目标文件夹里无关的内容。不要把缓存当成上传原件：缓存可重建，自定义壁纸需要另行备份。

### 常见问题

**安装失败或说找不到子包？**
核对是否在完整仓库根目录、Node / DSH 版本是否达标、目标 home / profile / CLI 是否一致。重跑完整安装器，不要先往活动 profile 手工塞临时链接。保留脱敏日志，参考 [故障排查](docs/TROUBLESHOOTING.md)。

**壁纸库是空的？**
先检查内容分级 / 类型筛选，再确认 WE 下载过壁纸。Steam 未被识别时，可用 `DSH_WE_STEAM_ROOT` 指向含 `steamapps` 的 Steam 根目录。没有 WE 客户端就用上传，或将自定义存储位置指向已有 WE 项目目录。

**视频黑屏或不播放？**
先看当前壁纸卡片的错误原因，尝试播放或换片。浏览器无法解码时，使用 H.264 MP4。自上传项目也会受内容分级筛选影响。

**Scene 只有静态图？**
先等首帧。大场景要传输资源包；渲染失败后会降级为可用的预览图或实时帧。并非每个工坊项目都与原版引擎完全兼容。没有可用画面时会说明原因，不会伪造成功。

**文字不好读 / 想关玻璃？**
先调暗化、底色与边框。玻璃按表面管理，可在对应设置回退原生；未知插件表面不保证自动兼容，见 [共存说明](docs/HOW-IT-WORKS.md#共存玻璃表面与其他-ui-插件)。

**插件会把壁纸上传到网上吗？**
不会。壁纸在本机读取和保存。不过下载运行时、查询仓库数据会联网。系统频谱采集的是输出回环，不是麦克风。

### 项目与致谢

- 项目与贡献记录：[GitHub Contributors](https://github.com/elysia395/dsh-wallpaper-engine/graphs/contributors)。
- 感谢 **[PC2005-cloud / dsh-pet](https://github.com/PC2005-cloud/dsh-pet)** 的公开接口支持与联动讨论。
- 感谢 B 站 UP 主 **[ZipZipPipe](https://space.bilibili.com/4168597)** 创作的 **AI 娘二创形象**，为我们的新吉祥物提供形象基础。不是模型厂商官方形象；署名不改变角色与素材的权利归属。

其他贡献者、素材与授权见 [素材来源](assets/readme/SOURCES.md)。

## English

This guide covers a **source deployment**, not the published npm version. The current source suite is **one main package plus eight subpackages**, with no bundled pet.

### Prepare and install

You need a working **DSH kernel** within the ranges declared in `package.json`'s `engines` (the 0.2 line qualifies), plus **Node.js** (range: `engines.node`), pnpm, the target host's CLI, and its actual data-directory / profile identifiers. Wallpaper Engine is optional if you use custom images / videos. Application wallpapers are unsupported.

1. Download and extract the complete repository source; do not use only the main package, a subpackage or temporary links.
2. Fully close the target DSH host. Open a terminal in the folder containing `package.json`.
3. Replace the placeholder with that host's actual data directory, inspect the plan, then install:

```sh
node scripts/install-source.mjs --profile web --dsh-home "<target DSH data directory>" --dry-run
node scripts/install-source.mjs --profile web --dsh-home "<target DSH data directory>" --app-closed
```

Desktop profiles require `--profile desktop` **and the desktop carrier CLI**. A standalone npm `dsh` CLI refuses desktop management. Pass `--dsh-cli "<target CLI lib/bin.js>"` when needed; do not guess the data directory. See [installation details](README.en.md#install).

The installer builds clients and registers all eight persistent links. Restart DSH afterward. **Keep the source directory in place.** For updates, close DSH, update the whole checkout and rerun the same command. A raw `github:` install, temporary links or installing only the main package does not deploy this branch. npm-name installation applies only after the complete release set is published.

### Choose and adjust a wallpaper

Open **Settings → Wallpaper Engine → Library**, or pull the mascot cord. Choose a thumbnail in the **in-panel library**, not a modal dialog. Use Appearance for glass / fonts / colors, Playback for filters / speed / framing, System for mascots / cache paths, and Extensions for avatars / effects / parallax.

Use JPG / PNG / MP4 uploads without Wallpaper Engine. macOS has no official WE client; existing project directories can also be used. Scene compatibility depends on assets and WebGL; a preview may be shown while preparing or after rendering failure. Rotation needs at least two playable candidates. Hiding a library item does not delete its source.

**Theme-following is off by default.** Readability matters more than maximum transparency. Glass uses per-surface fallback rather than guaranteed compatibility with every third-party skin. System audio capture is output loopback, not the microphone.

### Optional official pet integration

Install official [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) separately, with same-page pose / playback-progress services and public control APIs. Version `0.3.7` alone does not identify those capabilities. Set the target to web display and Wallpaper's mascot to official-sidebar mode; open **Ctrl+Shift+D** to choose the actual petId and try the four routines.

The bridge does not modify official files. Pet actions follow the official shared state across displays; bridge bubbles appear **only in the initiating page** and never clear official bubbles. Missing targets fall back to the ordinary sidebar action. Native motion is not guaranteed to follow buffered video frame by frame. Full official-renderer and desktop visual acceptance is still outstanding. See the [integration guide](packages/pet-link/README.md).

Before upgrading a former bundled-pet setup, close DSH and disable its old bundled row. Old dependencies, data and patches are not automatically removed.

### Settings and troubleshooting

General wallpaper settings persist in `~/.dsh-wallpaper-engine/config.json`. Environment variables may override paths. Pet selection and runtime tuning have a separate lifecycle: export tuning JSON before refresh. Cache files can be regenerated; uploaded originals need their own backups.

For installation errors, verify the complete checkout, supported versions, and exact home / profile / CLI. For an empty library, check filters and Steam detection; `DSH_WE_STEAM_ROOT` points at the Steam root containing `steamapps`. For decoding errors, try H.264 MP4. See [troubleshooting](docs/TROUBLESHOOTING.md) and the [English README](README.en.md).

Wallpapers stay local, but runtime downloads and repository statistics access external services. The plugin registers no model tools or prompt text, so it adds no model token overhead.

### Credits

Official project and history: [GitHub Contributors](https://github.com/elysia395/dsh-wallpaper-engine/graphs/contributors). Thank you to **[PC2005-cloud / dsh-pet](https://github.com/PC2005-cloud/dsh-pet)** for the public integration APIs, and Bilibili creator **[ZipZipPipe](https://space.bilibili.com/4168597)** for the **AI-girl fan-character designs used as the basis for our new mascots**. These are not official model-vendor characters; attribution does not relicense artwork under MIT. See [asset sources](assets/readme/SOURCES.md).
