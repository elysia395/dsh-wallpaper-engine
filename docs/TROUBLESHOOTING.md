# 排障 / Troubleshooting

> 本文件承接原先放在 README 首页的**安装失败排查**。README 只保留一行链接。
> 面向新手的常见问题见 [`../README.beginner.md`](../README.beginner.md) 的 FAQ；
> 功能边界见 `../README.md` 的「已知限制」；升级顺序问题见 [`UPGRADING.md`](./UPGRADING.md)。

## 中文

### 安装失败：`ERR_PNPM_UNEXPECTED_VIRTUAL_STORE`

`dsh plugin --profile web add ...` 会把命令转发给 **pnpm**。如果你遇到下面的错误：

```text
[ERR_PNPM_UNEXPECTED_VIRTUAL_STORE] Unexpected virtual store location
dsh: pnpm failed in profile directory C:\Users\xxx\.dsh-desktop\profiles\web
```

**这不是插件本身的问题**（换任何一个插件安装都会失败），而是该 profile 目录的 pnpm 依赖状态失效了：
pnpm 在 `node_modules\.modules.yaml` 里记录了安装时的虚拟存储位置（绝对路径），一旦 profile 目录被
**移动 / 复制 / 备份恢复**过，或 pnpm 版本 / `virtual-store-dir` 配置发生变化，记录值与当前路径不一致，
pnpm 就会拒绝继续安装任何插件。

**修复（Windows PowerShell）：**

```powershell
# 1) 先退出 DSH 桌面端
# 2) 删除该 profile 的依赖目录（只删 node_modules 即可，配置/已装插件名不会丢）
Remove-Item "$env:USERPROFILE\.dsh-desktop\profiles\web\node_modules" -Recurse -Force
# 3) 重新安装本插件
dsh plugin --profile web add dsh-plugin-wallpaper-engine
```

> 只删除 `node_modules\.modules.yaml` 一个文件也能修复（pnpm 会自动重建并继续），删除整个
> `node_modules` 更彻底。如果 `.dsh-desktop` 被 OneDrive / 云同步 / 迁移工具动过，建议把它加入同步排除，避免复发。

### 安装失败：`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`

```text
[ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED] ... The git-hosted package "dsh-plugin-wallpaper-engine@0.6.8"
needs to execute build scripts but is not in the "allowBuilds" allowlist.
```

**说明你用了 `github:` 形式的安装命令**（例如 `dsh plugin --profile web add github:elysia395/dsh-wallpaper-engine`）。
pnpm 11 出于供应链安全，默认拒绝从 git 安装的包执行构建脚本，而本插件的 git checkout 需要 `prepare`
脚本构建 client，因此 `github:` 直装必然失败。请改用 **npm 包名**安装（npm 发布包已预构建，无需安装时编译）：

```sh
dsh plugin --profile web add dsh-plugin-wallpaper-engine
```

> 如果你的插件中心（dsh-plugin-hub）生成的是 `github:` 命令，请把它升级到 **v1.4.1+**——新版会自动反查
> npm 包名并切到 npm 通道。

### 症状 → 先看哪里

| 症状 | 先检查 |
|---|---|
| 选择壁纸弹窗是空的 | WE 是否装好并下载过壁纸；重启一次 `dsh web`（详见 [`../README.beginner.md`](../README.beginner.md) FAQ 1） |
| 视频壁纸黑屏 / 冻在首帧 | 卡片上的播放按钮与提示文案：显示「播放」即未真正播放，点它重试；提示无法解码则换 **H.264** 编码的 MP4 |
| 自己上传的壁纸看不到 | 弹窗上方的**内容分级**筛选（默认 Everyone；未标注分级的自上传内容按 Everyone 处理） |
| 场景壁纸是静止画面 | 预期行为：场景渲染器输出的是完整场景**静态帧**；渲染失败会回退主纹理 / 工坊预览图（见 [`HOW-IT-WORKS.md`](./HOW-IT-WORKS.md)） |
| 帧率上限没效果 | 需要 ffmpeg 与 NVIDIA NVENC；无 ffmpeg / 无 N 卡时该功能自动关闭（见 `../README.md` 的「已知限制」） |
| 设置改完重启又变回去 | v0.4.0 起设置存宿主端文件；确认 `~/.dsh-wallpaper-engine/config.json` 可写、且未回滚到旧版本 |

---

## English

### Install failure: `ERR_PNPM_UNEXPECTED_VIRTUAL_STORE`

`dsh plugin --profile web add ...` forwards the command to **pnpm**. If you see this error:

```text
[ERR_PNPM_UNEXPECTED_VIRTUAL_STORE] Unexpected virtual store location
dsh: pnpm failed in profile directory C:\Users\xxx\.dsh-desktop\profiles\web
```

**This is not a problem with the plugin itself** (any plugin would fail the same way) — the pnpm
dependency state of that profile directory has gone stale. pnpm stores the virtual-store path
(an absolute path) in `node_modules\.modules.yaml`; if the profile directory was **moved / copied /
restored from a backup**, or the pnpm version / `virtual-store-dir` config changed, the recorded path
no longer matches, so pnpm refuses to install anything into that profile.

**Fix (Windows PowerShell):**

```powershell
# 1) Quit the DSH desktop app first
# 2) Remove the profile's dependency directory (only node_modules — config / installed plugin names are kept)
Remove-Item "$env:USERPROFILE\.dsh-desktop\profiles\web\node_modules" -Recurse -Force
# 3) Reinstall this plugin
dsh plugin --profile web add dsh-plugin-wallpaper-engine
```

> Deleting just `node_modules\.modules.yaml` also works (pnpm recreates it and continues); removing
> the whole `node_modules` is more thorough. If `.dsh-desktop` is touched by OneDrive / cloud sync /
> migration tools, add it to the sync exclusion list to avoid a recurrence.

### Install failure: `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`

```text
[ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED] ... The git-hosted package "dsh-plugin-wallpaper-engine@0.6.8"
needs to execute build scripts but is not in the "allowBuilds" allowlist.
```

**You used a `github:` install form** (e.g. `dsh plugin --profile web add github:elysia395/dsh-wallpaper-engine`).
pnpm 11 blocks build scripts of git-hosted packages by default for supply-chain safety, and this
plugin's git checkout needs the `prepare` script to build the client — so `github:` direct installs
always fail. Use the **npm package name** instead (the published npm package is pre-built, no
compile-time build needed):

```sh
dsh plugin --profile web add dsh-plugin-wallpaper-engine
```

> If your plugin hub (dsh-plugin-hub) generated a `github:` command, upgrade it to **v1.4.1+** — the
> new version auto-resolves the npm package name and switches to the npm channel.

### Symptom → where to look first

| Symptom | Check first |
|---|---|
| The wallpaper picker is empty | Wallpaper Engine installed with at least one wallpaper; restart `dsh web` (see [`../README.beginner.md`](../README.beginner.md), FAQ 1 — Chinese) |
| Video wallpaper is black / frozen | The card's play button and message: 「播放」 means it is not actually playing — click to retry; an "cannot decode" hint means re-export as **H.264** MP4 |
| A custom upload is not visible | The **content rating** filter above the grid (defaults to Everyone; unrated uploads count as Everyone) |
| Scene wallpaper shows a still image | Expected: the renderer outputs a full-scene **static frame**; failures fall back to the main texture / workshop preview (see [`HOW-IT-WORKS.md`](./HOW-IT-WORKS.md)) |
| The frame-rate cap does nothing | It needs ffmpeg + NVIDIA NVENC; without either, the feature disables itself (see 「Limitations」 in `../README.en.md`) |
| Settings revert after a restart | Since v0.4.0 settings live in a host file — check `~/.dsh-wallpaper-engine/config.json` is writable and that you did not roll back to an older version |
