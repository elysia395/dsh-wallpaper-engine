# Contributing / 参与贡献

Thanks for helping improve `dsh-wallpaper-engine`. Please keep each pull request focused on one clear problem and include the platform and verification results in its description.

感谢你参与改进 `dsh-wallpaper-engine`。请让每个 Pull Request 聚焦一个明确问题，并在说明中写清适用平台和验证结果。

## Choose the target branch / 选择目标分支

| Change / 改动 | Pull request base / PR 目标分支 |
|---|---|
| Windows, WSL, and shared cross-platform behavior / Windows、WSL 与跨平台公共功能 | `main` |
| macOS, WaifuX, loose-media discovery, and the macOS package / macOS、WaifuX、松散媒体扫描与 macOS 包 | `dsh-wallpaper-engine-mac` |

The macOS line is maintained by [Jerry (@ruijiaang-lab)](https://github.com/ruijiaang-lab). Keeping platform-specific work on the macOS branch lets the Windows-first `main` line and the WaifuX integration evolve without overwriting each other.

macOS 版本由 [Jerry（@ruijiaang-lab）](https://github.com/ruijiaang-lab)维护。将平台专属改动提交到 macOS 分支，可以避免 Windows-first `main` 与 WaifuX 适配在同步时互相覆盖。

## Build from the canonical source / 从唯一源码构建

- `src/client.js` is the canonical browser source. Edit it, then run `npm run build` to regenerate `lib/client.js`.
- `lib/client.js` is generated and tracked for distribution. Do not edit it by hand.
- Host-side changes live directly in `lib/index.js` and the other `lib/*.js` host modules.
- Restart DSH after host-side edits: `lib/*.js` is loaded at startup and is never hot-updated in a running instance.
- Install a local dev build with the application **fully closed** (`dsh plugin --profile desktop add link:<path>`), then start it. Installing while the app is running leaves the plugin in `startup-unconfirmed`, which the recovery state rolls back on the next start.
- Use the Node.js version required by the target branch and your DSH profile. The macOS package currently requires Node.js 24 or newer.

- `src/client.js` 是浏览器端唯一源码。修改后运行 `npm run build` 重新生成 `lib/client.js`。
- `lib/client.js` 是随包分发的构建产物，请勿手改。
- 宿主端代码直接位于 `lib/index.js` 和其他 `lib/*.js` 模块中。
- 改完宿主端代码需**重启 DSH**：`lib/*.js` 在启动时加载，运行中的实例不会热更新。
- 安装本地 dev 构建请**先完全关闭应用**（`dsh plugin --profile desktop add link:<path>`）再启动；应用运行期间安装会停在 `startup-unconfirmed`，恢复状态会在下次启动时自动回滚。
- 请使用目标分支与 DSH profile 要求的 Node.js 版本；当前 macOS 包要求 Node.js 24 或更高版本。

> **不要直接改 `lib/client.js` 做"热补丁"验证**——它只是构建产物，下次 `npm run build` 会整体覆盖，
> 补丁即丢失（2026-08-30 曾因此丢失 sceneVideo 健壮性修复）。任何行为改动先落 `src/client.js`。

## Install a local dev build / 从本地源码安装（开发者）

### 1. Get the code (`checkout`) / 取得源码

> *checkout* simply means "get a copy of the source code into a folder on your machine": click **Code → Download ZIP** on the GitHub page and unzip it, or clone it with Git:
>
> ```sh
> git clone https://github.com/elysia395/dsh-wallpaper-engine.git
> ```
>
> You then have a folder containing `package.json`, `lib/`, `src/` and `cordis.patch.yml` — called **the plugin folder** below.

> *checkout* 的意思很简单：把源代码下载 / 复制一份到你电脑的某个文件夹里。通常在这个 GitHub 页面点 **Code → Download ZIP** 下载并解压，或用 Git 克隆：
>
> ```sh
> git clone https://github.com/elysia395/dsh-wallpaper-engine.git
> ```
>
> 完成后你会得到一个包含 `package.json`、`lib/`、`src/`、`cordis.patch.yml` 的文件夹。下文把这个文件夹称作**插件文件夹**。

### 2. Install it using its folder path (`link:`) / 用文件夹路径安装（`link:`）

> `link:` tells `dsh` (which forwards the command to `pnpm`) to make a *link* to your local plugin folder instead of downloading a package from the internet — so edits + `npm run build` take effect without reinstalling.
>
> `link:` 表示：告诉 `dsh`（它会把命令转发给 pnpm）去**连接你本地那个插件文件夹**，而不是从网上下载一个包。好处是改完代码并重新构建后，改动能直接生效，不用反复重装。

Replace `<插件文件夹绝对路径>` with the **full path of your plugin folder** (the "address bar" path you see when you open that folder in Explorer / your file manager):

把命令里的 `<插件文件夹绝对路径>` **替换成你插件文件夹的完整路径**（就是资源管理器地址栏里显示的那串路径）：

```sh
dsh plugin --profile web add link:<插件文件夹绝对路径>
```

**Concrete example** —假设你的插件文件夹路径像 `D:\dev\dsh-wallpaper-engine` 这样：

```sh
dsh plugin --profile web add link:D:\dev\dsh-wallpaper-engine
```

You can also use a relative path if your shell is already in the folder's parent / 如果你已经 `cd` 到了插件文件夹的上一级，也可以用相对路径：

```sh
dsh plugin --profile web add link:./dsh-wallpaper-engine
```

> **Which exact path to fill in?** It must be the **folder that contains `package.json`** — not the path to `package.json` itself, and not any file inside. It is the same value you would paste into Explorer's address bar.
>
> **该填哪个确切的路径？** 必须是**包含 `package.json` 的那个文件夹**——不是 `package.json` 文件本身的路径，也不是它里面任何单个文件的路径。

> Why prefer `link:` over `file:`? `link:` creates a live link to your source folder, so edits to `src/client.js` + `npm run build` take effect without reinstalling; `file:` packs a static snapshot, which needs a re-add after every change. Both work for a first install.
>
> 为什么推荐 `link:` 而不用 `file:`？`link:` 是和你的源码文件夹**建立实时连接**，改完 `src/client.js` 并 `npm run build` 后直接生效，无需重装；`file:` 则是打包成一份静态快照，每次改动都要重新 add。首次安装两者都可以。

### 3. Restart / 重启确认

Then restart `dsh web`. The host plugin becomes a bundle layer and the client plugin auto-loads (`dsh.client.immediately: true`).

然后重启 `dsh web`。host 端会成为 bundle 层，client 端会自动加载（`dsh.client.immediately: true`）。

If Steam is installed in a non-standard location, the host auto-detects it via `libraryfolders.vdf` — nothing further is required. / 如果 Steam 装在非标准位置，host 会通过 `libraryfolders.vdf` 自动探测，无需额外配置。

> **注意 profile 与「应用必须先关闭」**：上面的示例用 `--profile web`；若目标是桌面端 profile，请改成 `--profile desktop`，并务必**先完全关闭应用**再安装（应用运行期间安装会停在 `startup-unconfirmed`，恢复状态会在下次启动时自动回滚，见上文「从唯一源码构建」）。

---

## Verify before opening a PR / 提交 PR 前验证

```sh
npm ci
npm run build
npm run verify
node scripts/verify-scene.mjs   # 场景静态帧路由自检（含缓存断言）
git diff --check
```

For UI changes, also describe the real DSH surface you tested, including browser or DSH Desktop mode. For platform-specific changes, call out the source layout used in the test—for example Wallpaper Engine, WSL, WaifuX, or loose media.

UI 改动还应说明实际测试过的 DSH 界面、浏览器或 DSH Desktop 模式。平台专属改动请注明测试数据来源，例如 Wallpaper Engine、WSL、WaifuX 或松散媒体文件。

## Pull request checklist / PR 检查清单

- The PR targets the correct branch for its platform.
- Source and generated client output are both included when `src/client.js` changes.
- Existing platform behavior is preserved or the intentional change is explained.
- Build and verification commands pass.
- The PR contains no credentials, local media, generated caches, or unrelated cleanup.

- PR 已选择正确的平台分支。
- 修改 `src/client.js` 时同时包含重新生成的客户端产物。
- 现有平台行为已保留，或正文已解释有意变更。
- 构建与验证命令全部通过。
- PR 不含凭据、本地媒体、生成缓存或无关清理。

---

## 开发备忘（部署生效机制 / 文件编码 / 排障路径）

### DSH 热挂载与生效规则

- DSH bundle patch 的**热挂载只支持纯 insert 行**；含配置/表达式行的改动**必须重启 DSH**。
- host 侧（`lib/index.js`、`lib/scene-renderer.js`、`lib/scene-render-worker.mjs` 等）是启动时
  加载的代码，**任何修改都要重启 DSH 才生效**；客户端（`src/client.js`）改动 `npm run build`
  后同样以重启为准。
- 渲染管线变更后必须 bump `lib/index.js` 的 `PIPELINE_VERSION`（`sf*` 缓存键前缀）+ 删旧缓存，否则旧帧
  命中导致 "修复不生效"；`scripts/verify-scene.mjs` 的断言前缀**从该常量推导**（脚本里勿写死字面量），
  因此 bump 后无需同步改动脚本。前缀值以 `lib/index.js` 的常量为唯一来源，文档不重复登记它。

### UTF-8 无 BOM 铁律

任何会被 Node/JSON 解析器读取的文件（`package.json`、配置 JSON）**必须 UTF-8 无 BOM**——
BOM（EF BB BF）会让 `JSON.parse` 直接抛错（2026-08-23 曾致 DSH Desktop 启动失败）。PowerShell
5.1 的 `Set-Content -Encoding UTF8` **默认带 BOM**，勿用；正确写法：

```powershell
[System.IO.File]::WriteAllText($path, $content, (New-Object System.Text.UTF8Encoding($false)))
# PS 7+ 可直接 Set-Content -Encoding utf8NoBOM
```

### 排障路径速查

- DSH Desktop 错误日志：`%APPDATA%\DSH Desktop\logs\dsh-<date>.error.log`
- 插件安装恢复状态：`%APPDATA%\DSH Desktop\plugin-install-recovery\state.json`
  （应用运行期间执行 CLI 安装 → `startup-unconfirmed` 自动回滚；正确流程：应用完全关闭 →
  `dsh plugin --profile <p> add link:<path>` → 重启确认 `verified`）
- 场景帧缓存：`%USERPROFILE%\.dsh-wallpaper-engine\cache\frames\`；抽帧转码缓存同目录 `transcodes/`。

---

## 附录：向 awesome-dsh-plugin 收录目录提交（一次性发布任务）

> 完整版指南：`docs/awesome-dsh-plugin-pr-guide.md`（应作者要求保留的原版，直接从
> awesome-dsh-plugin 仓库复制，勿改）。以下为速查。

> 目标仓库 `awesome-dsh-plugin/awesome-dsh-plugin`，fork：`elysia395/awesome-dsh-plugin`。
> 上游 README 由脚本生成**禁止手改**；一切改动只在 `data/plugins/` 下你的 YAML + 重新生成的 README。

**前置自检**（CI 必查）：仓库年龄 ≥1 天、commit ≥10、`package.json` 声明 `dsh.bundle`（仅
`dsh.client` 会被拒）、`cordis.patch.yml` 与 package.json 同目录、仓库打了 `dsh-plugin` topic、
description 只讲功能无营销词、主题类用 `category: theme`。CI 会**实际访问你的插件仓库**读取
manifest——提交时插件仓库必须公开可访问。

**YAML 条目**（`data/plugins/elysia395__dsh-wallpaper-engine.yml`）：

```yaml
url: https://github.com/elysia395/dsh-wallpaper-engine   # 无 .git 后缀
name: elysia395/dsh-wallpaper-engine
category: theme
description:
  en: '...'   # 必填，句号结尾；含 ": " 时整个字符串加单引号
  zh: '...'
```

**流程速查**：

```powershell
git remote add upstream https://github.com/awesome-dsh-plugin/awesome-dsh-plugin.git
git fetch upstream && git checkout main && git reset --hard upstream/main && git push -f origin main
git checkout -b add/dsh-wallpaper-engine
# → 新建 data/plugins/elysia395__dsh-wallpaper-engine.yml（上述模板）
npm ci && node scripts/generate-readme.mjs      # 重新生成 README.md / README.zh.md
git add data/plugins/elysia395__dsh-wallpaper-engine.yml README.md README.zh.md
git commit -m "Add dsh-plugin-wallpaper-engine to themes" && git push origin add/dsh-wallpaper-engine
gh repo edit elysia395/dsh-wallpaper-engine --add-topic dsh-plugin   # 若未打 topic
gh pr create --base main --head elysia395:add/dsh-wallpaper-engine --title "Add dsh-plugin-wallpaper-engine to themes"
```

**要点**：`git add` 前核对 `git status`（误改他人条目零容忍，曾打回）；CI 失败在同一分支继续
push 修复即可；维护者会人工核对代码与描述一致性（数字/API 名称须真实）与分类。可选增强：
`data/screenshots.json` 加 1-8 张 GitHub 托管截图；建议发布 npm（体验最好，跳过 allowBuilds
授权步骤）。
