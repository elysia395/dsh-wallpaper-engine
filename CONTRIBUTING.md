# Contributing / 参与贡献

Thanks for helping improve `dsh-wallpaper-engine`. Please keep each pull request focused on one clear problem and include the platform and verification results in its description.

感谢你参与改进 `dsh-wallpaper-engine`。请让每个 Pull Request 聚焦一个明确问题，并在说明中写清适用平台和验证结果。

> 问题如何分诊（标签）与认领（`/assign`）：见 [`docs/TRIAGE.md`](docs/TRIAGE.md)。

## Choose the target branch / 选择目标分支

All changes target `main`. The plugin is **one natively cross-platform tree** (Windows / WSL / macOS / Linux) with no platform branch — a platform-specific change must not regress the others.

所有改动都提交到 `main`。本插件是**一份原生跨平台代码**（Windows / WSL / macOS / Linux），没有平台分支 —— 平台专属改动不得让其它平台回退。

## Build from the canonical source / 从唯一源码构建

- `src/client.js` is the canonical browser source. Edit it, then run `npm run build` to regenerate `lib/client.js`.
- `lib/client.js` is generated at build time and **not tracked in git** (v1.4): `npm run build` produces it locally; `prepack` produces it inside npm / Release tarballs. Do not edit it by hand.
- Host-side changes live directly in `lib/index.js` and the other `lib/*.js` host modules.
- Restart DSH after host-side edits: `lib/*.js` is loaded at startup and is never hot-updated in a running instance.
- Install a local dev build with the application **fully closed** (`dsh plugin --profile desktop add link:<path>`), then start it. Installing while the app is running leaves the plugin in `startup-unconfirmed`, which the recovery state rolls back on the next start.
- Use the Node.js version your DSH profile requires; this repository declares `engines.node` in `package.json`.

- `src/client.js` 是浏览器端唯一源码。修改后运行 `npm run build` 重新生成 `lib/client.js`。
- `lib/client.js` 是构建期产物、**不入库**（v1.4 起）：本地跑 `npm run build` 生成；npm 包与 Release tgz 里由 `prepack` 在打包时现场构建。请勿手改。
- 宿主端代码直接位于 `lib/index.js` 和其他 `lib/*.js` 模块中。
- 改完宿主端代码需**重启 DSH**：`lib/*.js` 在启动时加载，运行中的实例不会热更新。
- 安装本地 dev 构建请**先完全关闭应用**（`dsh plugin --profile desktop add link:<path>`）再启动；应用运行期间安装会停在 `startup-unconfirmed`，恢复状态会在下次启动时自动回滚。
- 请使用你的 DSH profile 要求的 Node.js 版本；本仓在 `package.json` 的 `engines.node` 里声明。

### What `lib/client.js` actually is / `lib/client.js` 到底是什么

- **Anatomy**: `lib/client.js` = the `src/client.js` body **+ every module listed in `INLINE_MODULES`** (`scripts/build-client.mjs`), all inlined into a single `factory(require)` scope. `npm run build` prints that inlined list — **read the count off that list, never from prose here** (a hardcoded number in this file has already gone stale once). Most of the file's lines therefore come from `src/**`, not from `client.js` itself — it *looks* like a monolith but is a flattened repository slice.
- **Why inlining**: the browser half has **no local-module resolver** — the loader's `require` resolves only external packages, so `import './panel-tabs.js'` cannot work at runtime. Everything split out of `src/client.js` for readability is inlined back as a prelude in the same scope. Each entry declares `markers`, and a missing marker is a **hard build failure** — that is what stops the split from silently going empty. The output must also parse (`new Script(...)`) before it is written.
- **Its role**: `package.json` exposes it as `exports["./client"]` with `dsh.client.immediately: true`; the DSH client loader fetches it from package metadata (no host route serves it). It is **built, never tracked** (v1.4): npm / Release tarballs get it from `prepack` at packaging time, and a `link:` dev checkout gets it from `npm run build`. The supported install paths are therefore the npm package name and the Release tarball — a raw `github:` install does not build it and is **not supported**.
- **Rule 1 — rebuild before verifying**: any `src/**` change requires `npm run build` before `verify` / packaging (there is no committed artifact left to forget). CI rebuilds and then asserts the artifact is **not tracked**; the **local chain asserts freshness** via `test/verify-client-sync.mjs`: it rebuilds, compares byte-for-byte, and restores the file — so a stale artifact fails **before you push**.
- **Rule 2**: never hand-edit `lib/client.js`; the next build overwrites it.
- **Rule 3 — the artifact is a contract**: several guards test the **built** file (`verify-readability`, `verify-softrender`, `verify-client`), and some extract the stylesheet from it by a line-leading anchor. That is why `src/styles.js` forbids backticks and literal copies of its own declaration in its comments — one stray backtick once made `verify-host-paint-scope` report "bare backticks: 489".
- **Trap — comments in `src/**` ship to users**: prefer the *measurement command* over a number that drifts (two module headers once cited `src/client.js` as "9,500 lines" — both are fixed now; don't write one back).
- **Don't shrink it as if it were a monolith**: its size is the size of `src/**`. The lever is the sources.

- **构成**：`lib/client.js` = `src/client.js` 正文 **+ `INLINE_MODULES` 里的每一个模块**（见 `scripts/build-client.mjs`），全部内联进**同一个** `factory(require)` 作用域。`npm run build` 会把内联清单打印出来 —— **条数只许从那份清单现读，不要写进本文件**（这里写死过一次，已经漂了）。**它的大部分行来自 `src/**` 而不是 `client.js` 自己**（占比同样按那份清单复算，勿记死数）—— 看着像巨石，实为"压平的仓库切片"。
- **为什么必须内联**：浏览器半边**没有本地模块解析器** —— loader 的 `require` 只解析外部包，`import './panel-tabs.js'` 在运行时根本不成立。凡为可读性拆出去的代码，都在构建期作为 prelude 内联回同一作用域。每项都带 `markers`，**缺任何一个都构建硬失败** —— 这正是"拆分不会悄悄变空"的保证；产物还必须能通过 `new Script(...)` 解析才会被写出。
- **它的身份**：`package.json` 用 `exports["./client"]` + `dsh.client.immediately: true` 暴露它，DSH 客户端加载器按**包元数据**取（宿主侧没有任何路由发它）。它**构建、但不入库**（v1.4 起）：npm 包与 Release tgz 由 `prepack` 在打包时生成；`link:` 开发检出由 `npm run build` 生成。支持的安装路径因此是 **npm 包名 / Release tgz**；裸 `github:` 直装不构建产物，**不再支持**。
- **铁律一 —— 先重建再验证**：改任何 `src/**` 都要在 `verify` / 打包前 `npm run build`（已无"产物忘了提交"这回事）。CI 重建后判**产物不入库**；**本地链同样判新鲜度**：`test/verify-client-sync.mjs` 会重建、逐字节比对、并把文件**还原**（守卫不改工作树）⇒ 产物过期会在 **push 之前**就红。
- **铁律二**：绝不手改 `lib/client.js`，下一次构建会抹掉。
- **铁律三 —— 产物即契约**：多个守卫跑的是**产物**（`verify-readability`、`verify-softrender`、`verify-client`），另有一些**按行首锚点从产物里**取样式表。这就是 `src/styles.js` 禁止在自己注释里写反引号、也禁止复述那条声明语句的原因（实测踩到过：`verify-host-paint-scope` 报"裸反引号 489"）。
- **陷阱 —— `src/**` 的注释会随包发给用户**：涉及行数 / 体积这类会漂的量，写**复算命令**而不是写数字（曾有两处模块头注释把 `src/client.js` 说成"9,500 行"，现已修掉 —— 别再写回去）。
- **不要把它当巨石来"治理"**：它的体积就是 `src/**` 的体积，杠杆在源文件。

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

## Verify before opening a PR / 提交 PR 前验证

```sh
npm ci              # 本地取工具链（CI 不装依赖，见下）
npm run verify:all  # = build + verify（硬档）+ verify:docs（软档）+ smoke
```

**提交前必须全绿的是硬档**（`npm run verify`：真机行为 / 发布面 / 平台契约 / 打包面）。
软档（`npm run verify:docs`：仓库内务 —— 模块布局 / 可达性 / 退役线 / 声明孤儿）
**照跑、照打印结论，但不拦 PR** —— 判据一字未改，退出码由 `test/warn-only.mjs` 降级为警告
（原码打在 `[warn-only] 软档守卫原退出码 = N` 行上）。
> **两档各含哪些守卫、分档判据是什么，只在 [`docs/DEV-GUIDE.md`](docs/DEV-GUIDE.md) §4.2 定义一处**
> —— 这里刻意不列清单（此前抄过一份，删掉两条守卫后就过时了，正说明为什么不该抄）。

`.github/workflows/verify.yml` 在每次 push / PR 上跑同一套，并额外断言两件事：产物不入库（`git ls-files -- lib/client.js docs/images` 必须为空；新鲜度由本地链首条 `test/verify-client-sync.mjs` 真跑构建逐字节判），
以及 `git diff --check` 无尾随空白 / 冲突标记。

> CI **故意不执行 `npm ci`**：build / verify / smoke 只用 `node:` 内置模块与相对路径，
> 整条链对 registry 与 peer 解析完全免疫 —— 这条不变量由 `test/verify-package-files.mjs`
> 的 P5 断言钉住。本地开发仍需 `npm ci` 取工具链。

### Harness compatibility CI / harness 适配 CI（基线制）

- `.github/workflows/harness-compat.yml`：**只按需运行** —— 触发面只有手动派发
  （`gh workflow run harness-compat.yml [-f harness_version=<版本>] [-f force=true]`，不挂
  schedule / push）。目标对（harness 版本 × 插件 commit）**已被基线覆盖则秒过**；
  否则安装该 harness → link 本插件进**隔离 profile** → 启动 `dsh --profile web` 探活
  （宿主路由 / 落盘诊断 / 日志判据，见 `test/compat-harness-live.mjs`）→ `npm run verify:all`。
- **全绿才入基线**：`.github/harness-baseline.json` 只由该工作流在全绿后自动提交；
  任何一步失败 ⇒ 工作流红、基线保持上一个全绿对；失败的目标对**不会自动重试**，下次派发时再跑。
- **第三方边界**：该工作流不跑 `verify:bridge` / `verify:e2e`；探活期间 `DSH_WE_MEDIA_LEGACY=1`
  且只打 diag 族路由 ⇒ 媒体桥 / ffmpeg 全程不被拉起（媒体桥端到端仍由 `verify.yml` 覆盖）。
- **UI 面清单棘轮**（`test/compat-harness-surfaces.mjs`）：已装 harness 的 `dsh-client-ui-*`
  表面与提交清单 `test/fixtures/harness-ui-surfaces.json` 做差，**新表面未登记即红** ——
  盖不盖由人裁定、裁定必须落盘；另对 `dsh-client-ui-sidebar-right` 真源码断言属性锚点与
  隐藏机制 allowlist（#107 型回归的活判据）。
- **逐页 DOM/样式断言**（`test/compat-harness-pages.mjs`，档位 2）：零依赖 CDP 驱动无头
  浏览器进真 harness 走首页 → 会话页 → 设置页，对**计算样式**下判据（设置窗口玻璃的
  backdrop / sheen 渐变 / token 接管 + 五分区逐页走查 + 零插件错误）；`--dump` 是探查模式。
- 本地复跑：`node test/compat-harness-live.mjs`（需要 PATH 上有 `dsh` CLI 与网络；
  profile 与插件数据都落在隔离目录，不碰真实 `~/.dsh`，可与 DSH Desktop 并存）。

- `.github/workflows/harness-compat.yml` runs **on demand only** — its sole trigger is manual
  dispatch (`gh workflow run harness-compat.yml [-f harness_version=<ver>] [-f force=true]`; no
  schedule or push trigger). A target pair (harness version × plugin commit) already in the baseline
  skips in seconds; otherwise it installs that harness, links this plugin into an isolated profile,
  boots `dsh --profile web` and probes it (`test/compat-harness-live.mjs`), then runs `npm run verify:all`.
- **Only a fully green run becomes the baseline**: `.github/harness-baseline.json` is written solely by
  that workflow after everything passes. Any failure turns the run red and leaves the previous green pair
  as the baseline; a failed target is **not retried automatically** — it runs again on the next dispatch.
- **Third-party boundary**: the workflow never runs `verify:bridge` / `verify:e2e`; the live probe sets
  `DSH_WE_MEDIA_LEGACY=1` and only touches diag-family routes, so the media bridge / ffmpeg are never
  started (bridge end-to-end stays covered by `verify.yml`).
- **UI surface inventory ratchet** (`test/compat-harness-surfaces.mjs`): the installed harness's
  `dsh-client-ui-*` surfaces are diffed against the committed inventory
  `test/fixtures/harness-ui-surfaces.json` — **an unregistered new surface turns the run red** (whether
  to cover it is a human adjudication, and the adjudication must land in that file); it also asserts the
  attribute anchors and hide-mechanism allowlist against the *installed* `dsh-client-ui-sidebar-right`
  source (the live form of the #107-class check).
- **Per-page DOM/style assertions** (`test/compat-harness-pages.mjs`, tier 2): a zero-dependency CDP
  client drives a headless browser through home → conversation → settings and asserts on **computed
  styles** (the settings-window glass: backdrop, sheen gradient, token takeover; plus a five-section
  walk with plugin styles present and zero plugin errors). `--dump` is the exploration mode.
- Reproduce locally with `node test/compat-harness-live.mjs` (needs the `dsh` CLI on PATH and network;
  profile and plugin data go to an isolated directory, so your real `~/.dsh` stays untouched and it can
  coexist with DSH Desktop).


For UI changes, also describe the real DSH surface you tested, including browser or DSH Desktop mode. For platform-specific changes, call out the source layout used in the test—for example a Steam Wallpaper Engine library, a WSL mount, or a storage folder holding WE project directories.

UI 改动还应说明实际测试过的 DSH 界面、浏览器或 DSH Desktop 模式。平台专属改动请注明测试数据来源，例如 Steam 的 Wallpaper Engine 库、WSL 挂载，或存储位置里的 WE 项目目录。

## Release / 发布

- **Publishing is the maintainer's job** (`elysia395/dsh-wallpaper-engine`): releases go to npm and GitHub Releases from this repository, at the maintainer's discretion (no automated publish pipeline).
- What the guard chain protects is the **publish surface**, via `test/verify-package-publish.mjs` inside `npm run verify`: the reachable closure of `lib/index.js` must be covered by `files`, no dev directories may leak into the package, published text must not carry another machine's home path, every `dependencies` entry must actually be loaded by reachable code, and no install-time script may reference a file that `files` does not ship.
- Check the surface locally at any time with `npm pack --dry-run`（它给出的条目数会比守卫的清单多 `package.json` + `LICENSE`）。
- **`engines.dsh` is the machine-readable copy of the host requirement.** The plugin market (and DSH's own plugin manager) reads it straight out of the published manifest — the catalog is not involved — and displays it on the plugin card, using it to flag a mismatch with the running host. It must therefore agree with the prose in the READMEs and `docs/UPGRADING.md`; changing one means changing all three. `dsh-better-sidebar` **cannot** be expressed there (it is not a `@deepseek-ai/*` peer) and lives only in that prose.
- **Nothing in `scripts/prepare.mjs` or `scripts/build-client.mjs` may write informational text to stdout.** `prepack` runs during `npm pack` / `npm publish`, so anything it prints lands in their stdout — and `--json` requires stdout to hold nothing but JSON (measured: `built …` was enough to make `npm pack --dry-run --json` unparseable). Progress goes to stderr.
- **Keep the READMEs' statement about what the package ships true to the tarball.** They say the npm package does not ship `docs/`, which is a real consequence for readers (those links do not resolve on npm or in the market). Stating that it ships "only the READMEs" was false — the package carries `lib/**` and `cordis.patch.yml` — and the market shows that text on the plugin's page. Verify against the real thing (`npm pack --dry-run`, or the published tarball), not against the `files` array by eye.

- **发布由维护者执行**（`elysia395/dsh-wallpaper-engine`）：npm 与 GitHub Releases 都由本仓发布，节奏由维护者掌握（没有自动化发布流水线）。
- 守卫链守的是**发布面**，由 `npm run verify` 里的 `test/verify-package-publish.mjs` 负责：`lib/index.js` 的可达闭包必须被 `files` 覆盖、不得泄漏开发目录、发布文本不得带别的机器的家目录路径、`dependencies` 每条都必须被可达代码加载、安装期脚本不得引用未随包发布的文件。
- 随时可以用 `npm pack --dry-run` 核对发布面（它的条目数会比守卫清单多 `package.json` 与 `LICENSE`）。
- **`engines.dsh` 是宿主要求的机读副本。** 插件市场（以及 DSH 自己的插件管理 UI）是**从已发布的 manifest 直接读它**的——目录那边不参与——然后显示在插件卡片上，并用它与运行中的宿主比对、标记不匹配。所以它必须与三份 README 及 `docs/UPGRADING.md` 里的散文**同口径**：改一处就要改全部。`dsh-better-sidebar` **无法**在这里表达（它不是 `@deepseek-ai/*` peer），只能留在那段散文里。
- **`scripts/prepare.mjs` 与 `scripts/build-client.mjs` 都不许往 stdout 写信息性文字。** `prepack` 会在 `npm pack` / `npm publish` 期间跑，它打印的东西会落进这两条命令的 stdout——而 `--json` 要求 stdout 上**只有 JSON**（实测：仅仅一行 `built …` 就让 `npm pack --dry-run --json` 无法解析）。进度信息一律走 stderr。
- **三份 README 里"包里到底带什么"这句话必须与真实 tarball 一致。** 它们说 npm 包不带 `docs/`，这对读者是有真实后果的（那些链接在 npm 与市场里点不开）。而写成"只带三份 README"是**错的**——包里带的是 `lib/**` 与 `cordis.patch.yml`——且市场会把这句话展示在插件页上。核对要以真东西为准（`npm pack --dry-run`，或已发布的 tarball），不要凭眼睛看 `files` 数组。

## Pull request checklist / PR 检查清单

- The PR targets `main`.
- `src/client.js` changes were rebuilt (`npm run build`) before running verification (the artifact is not tracked).
- Existing platform behavior is preserved or the intentional change is explained.
- Build and verification commands pass.
- New dev-face files go where the layout says: guards and smoke tests in `test/`, manual
  diagnostics/analysis/generators in `test/tools/`, build- and publish-time scripts in `scripts/`
  (see `docs/CODE-STRUCTURE.md` §4). A new guard also has to sit in the right chain
  (`npm run verify` vs `npm run verify:docs`) — see `docs/DEV-GUIDE.md`.
- The PR contains no credentials, local media, generated caches, or unrelated cleanup.
- Package metadata is still true: `engines.dsh` agrees with the READMEs / `UPGRADING`, the READMEs'
  statement about what the package ships matches the tarball, and no build/publish script writes
  informational text to stdout (see **Release** for why each one matters).

- PR 目标分支为 `main`。
- 修改 `src/client.js` 时已先 `npm run build` 重建（产物不入库，无需提交）。
- 现有平台行为已保留，或正文已解释有意变更。
- 构建与验证命令全部通过。
- 新增的开发面文件放在**约定位置**：守门与冒烟在 `test/`，手动诊断/分析/生成工具在 `test/tools/`，
  构建与发布期脚本在 `scripts/`（见 `docs/CODE-STRUCTURE.md` §4）；新守卫还要挂对链
  （硬档 `npm run verify` vs 软档 `npm run verify:docs`，见 `docs/DEV-GUIDE.md`）。
- PR 不含凭据、本地媒体、生成缓存或无关清理。
- 包元数据仍然属实：`engines.dsh` 与三份 README / `UPGRADING` 同口径；README 里"包里带什么"与真实
  tarball 一致；构建与发布期脚本没有往 stdout 写信息性文字（各自为什么重要见上面的 **发布** 节）。
