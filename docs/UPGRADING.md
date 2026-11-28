# 升级指南

> **English**: [`en/UPGRADING.md`](./en/UPGRADING.md)（与本文同源：改一处请同步另一处）


> 本文件收录**升级前置条件与版本兼容说明**。README 只保留一行提示 + 链接。
> 各版本修了什么见 [`CHANGELOG.md`](./CHANGELOG.md)；安装失败报错见 [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md)。


### 当前灰测分支的要求

当前套件要求 **Node.js >=22.12.0、DSH 0.2 内核（包括 0.2.0-rc.1/rc.2）**，不包含内置 pet 或 Electron。旧 DSH 0.1 内核不在当前支持范围。**版本下限以 `package.json` 的 `engines` 为准**（`engines.node` / `engines.dsh`）。

灰测更新请先完全退出宿主，更新整个源码目录，再按 [源码部署步骤](../README.md#快速开始) 重跑安装器。不要用 npm 包名命令获取尚未发布的改动。正式 npm 通道仅适用于九包完整发布之后。

旧版用户需先停用内置 pet bundle。安装器不自动移除旧 profile 的派生依赖或数据；通过目标宿主的包管理入口显式移除旧 `dsh-we-pet-builtin`。官方 pet 需另装具备 `petApi7340` 和公开控制接口的版本，旧文件补丁须恢复备份或重装官方包。未装官方 pet 不影响壁纸。

更老版本的升级台阶见 [`CHANGELOG.md`](./CHANGELOG.md)；当前版本的安装与升级只以本节的要求为准。

### 正确的更新顺序

1. **先把 DSH 内核更新到 `package.json` 的 `engines.dsh` 下限**（当前为 DSH 0.2 内核，含 0.2.0-rc.1/rc.2）：官方桌面端在「顶部导航栏 → 版本信息」检查更新，或到 [GitHub Releases](https://github.com/anywhere-labs/dsh-desktop/releases) 下载对应平台安装包；
2. **再更新本插件**：`dsh plugin --profile web add dsh-plugin-wallpaper-engine`（或插件市场里点更新）；
3. **dsh-better-sidebar 无版本要求**：装了的话建议顺手更到最新（`dsh plugin --profile web add dsh-better-sidebar@latest`）。

> 💡 同时建议把**其它 DSH 插件也一并更新**：旧版插件在新内核下可能直接加载失败
> （例如旧版 dsh-better-sidebar 会因 API 变更异常）。

### 更新后异常怎么办

把内核更到 `engines.dsh` 下限、dsh-better-sidebar 更新到最新即可恢复；**无需回滚本插件**。

### 升级提示

插件更新后会在界面里弹一次提示（每个新版本仅出现一次），漏看也没关系。

### 升级后会发生什么（帧缓存 / 实时渲染）

- **帧缓存会整体失效一次**：缓存键以管线版本打头（当前 `LIVE_FRAME_KEY_VERSION = 'lf2'`，真源见
  `lib/media/frame-store.js`），源码里抓帧 / 实时渲染逻辑一改就会升版 —— 升版后
  `~/.dsh-wallpaper-engine/cache/frames/` 里的旧产物**全部不再命中**，每张场景壁纸需要重新抓一次
  实时帧。**这是预期行为，不是回归**，旧文件也不会自动删除（可手动清 `cache/frames/` 回收磁盘）。
  该目录同时还存场景内嵌视频（`sv1_*.mp4`）与场景包内音频（`sa1_*`），各有自己的版本前缀。
- **新增实时渲染需要 WebGL2**：升级后场景 / 网页壁纸**默认走 WebWallGL 实时渲染**（「场景实时渲染」/
  「网页实时渲染」开关，默认开）。浏览器不支持 WebGL2、或显卡驱动异常时，渲染页首帧预算用尽后会
  **静默降级**回「内嵌 MP4 → 实时抓帧 → 自定义画面 → 空态」这条链（首帧之前垫的是**作者的预览图**，
  连它都取不到才诚实留空 —— 不会黑屏卡住）。（**松散 `scene.json` 目录也走实时渲染**：渲染器按
  `project.json` 的 `file` 后缀自判形态，不再需要整包 `scene.pkg`。）
- **实时渲染默认开**（`sceneLive`），升级后无需任何操作。

### 兼容性验证

- 实时渲染链路有离线验收（`test/verify-scene-live.mjs` 等，跑 `npm run verify`）。
- **守卫链由哪些步骤组成以 `test/run-guards.mjs` 的 `MANIFEST` 为准**（`package.json` 的 `verify` / `verify:docs` / `smoke` 只是指向该 runner 的衬套，`package.json` 的 `scripts` 不构成清单）。本文不列条数。
- **当前版本以 `package.json` 的 `version` 为准，已发布版本见 npm 包页 / GitHub Releases**。

---

### 设置持久化：改存宿主端文件（v0.4.0）

**你的全部设置（已选壁纸、配色、透明度、布局、轮播、隐藏、倍速/翻转等）从 v0.4.0 起保存在宿主端文件里，不再依赖浏览器 localStorage。**

- **存在哪里**：`~/.dsh-wallpaper-engine/config.json`（与「上传目录」「缓存位置」的配置是同一个文件）。
  Windows：`C:\Users\<你的用户名>\.dsh-wallpaper-engine\config.json`；WSL / Linux / macOS：`~/.dsh-wallpaper-engine/config.json`。
- **为什么改**：localStorage 按「地址 + 端口」隔离，而 **DSH Desktop 每次启动用随机端口** ⇒ 每次都是全新的存储空间，配置全部恢复默认（Web 端固定端口无此问题）。改存宿主端文件后与端口无关。
- **好处**：重启 / 换端口 / 清浏览器数据 / 换浏览器 / 无痕模式都不再丢失配置。
- **旧数据迁移**：老版本存在 localStorage 里的配置会在**首次启动时自动迁移**，无需手动操作。
- **行为变化**：同一台电脑上多个浏览器（如 Chrome 与 Edge）访问同一个 dsh 时**共享同一份配置**（此前各存各的）；回滚到旧版本仍会读 localStorage 里的缓存副本，配置不会丢。
- **读写**：每次修改自动写入（带防抖合并）；文件损坏时回退默认值且**不会覆盖**你的文件。

---

更早版本（≤ 1.3.x）的行为变化见 [`CHANGELOG.md`](./CHANGELOG.md)；本文只描述当前版本的升级要求。
