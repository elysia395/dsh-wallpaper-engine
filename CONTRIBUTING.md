# Contributing / 参与贡献

Thanks for helping improve `dsh-wallpaper-engine`. Please keep each pull request focused on one clear problem and include the platform and verification results in its description.

感谢你参与改进 `dsh-wallpaper-engine`。请让每个 Pull Request 聚焦一个明确问题，并在说明中写清适用平台和验证结果。

> Issue triage and claim approval / 问题分诊、认领申请与审批：见下文「Approval before opening a PR」与「Issue triage & labels」两节。

## PR titles: plain language, professional body / PR 标题讲人话，正文专业

**This rule applies to everyone — human contributors and AI assistants alike.** The PR title is the first thing a reviewer sees. Write it so someone who does not know this code can tell **what changed, where, and what problem it solves**. Implementation details, terminology and test notes belong in the PR **body**, not the title. Background and the full rationale: [#323](https://github.com/elysia395/dsh-wallpaper-engine/issues/323) — the issue stays open on purpose, as a human-facing reminder.

- Recommended shape: `type: scope/feature — what changed, what problem it solves` (types such as 修复 / 新增 / 优化 / 重构).
- Bad: `refactor: optimize data flow abstraction`, `chore: enhance maintainability`, or any title that only says “优化性能 / 提升体验 / 增强稳定性 / 改进代码质量”.
- Use concrete words instead of AI-flavoured abstraction, and avoid abbreviations the reader has to decode.

| Don't | Do |
| --- | --- |
| `refactor: optimize data flow abstraction` | `重构：把订单数据同步逻辑拆成独立模块，方便以后改` |
| `feat: implement idempotent retry mechanism` | `新增：提交失败后自动重试，避免重复创建订单` |
| `perf: improve rendering pipeline` | `优化：减少列表页重复渲染，滚动更流畅` |
| `chore: enhance maintainability` | `整理：拆分工具函数，降低后续修改难度` |

**AI assistants:** before you run `gh pr create` or open a PR, rewrite the title to satisfy this rule. Do not pass a tool-generated, commit-message or plan-style title through unchanged; if depth is needed, put it in the body and keep the title a plain-language summary.

**PR 标题是第一眼信息。** 请让不熟悉这段代码的人也能从标题看出**改哪里、做了什么、解决什么问题**；实现方案、术语和测试说明写进 PR **正文**，不要塞进标题。规则同样适用于 AI 助手：自动生成 PR 时，若标题只有“优化架构 / 提升可维护性 / 重构抽象层”这类空泛说法，必须先改成人话再提交。（完整说明与正反例见 [#323](https://github.com/elysia395/dsh-wallpaper-engine/issues/323)；该 issue 保持 open，作为给真人用户的视觉提示。）

- 推荐结构：`类型：范围/功能，做了什么，解决什么问题`（类型如 修复 / 新增 / 优化 / 重构）。
- 不要只写没有具体范围的空泛结果（“优化性能”“提升体验”“增强稳定性”“改进代码质量”），也不要堆缩写和 AI 黑话。
- 标题说人话，正文可以专业：**「PR 正文可以专业，PR 标题必须说人话。」**

提交前自查：不懂这段代码的人能不能大致看懂这次改了什么？标题有没有写清具体模块、功能或用户场景？技术细节是不是都放进了正文？

## Approval before opening a PR / 先批准认领，再开 PR

**External contributors must request an issue and receive maintainer approval before creating a PR. Direct PRs, including drafts, are not allowed.** Only the repository owner and collaborators whose current GitHub API permission is `write`, `maintain` or `admin` are exempt from this issue-claim gate. Permissions are checked live on every evaluation; a `contributor` badge, `author_association`, past contributions, or `read` / `triage` access is not an exemption. There is no `claim:exempt` or other label-based exemption. This exemption does not bypass code CI.

- Wait for a maintainer to accept an open issue with `status:accepted` and remove `status:needs-triage` / `status:declined`. Comment `/assign` on that issue yourself: this is a request, **not immediate assignment**. Wait for a maintainer to comment `/approve @login` on the same issue and for the bot to assign you. A maintainer may instead assign you through GitHub UI, but only with your prior valid `/assign` record in that issue. Acceptance alone is not claim approval.
- Your own `/unassign` cancels a pending request or releases your claim. Maintainers may use `/unassign @login` to cancel/release for that person, or `/unassign` without arguments to release all current assignees.
- Put at least one standalone `Fixes #123` or `Refs #123` line in the PR body, one issue per line; multiple lines are supported. Full same-repository issue URLs (for example `Fixes https://github.com/elysia395/dsh-wallpaper-engine/issues/123`) and qualified references (`Refs elysia395/dsh-wallpaper-engine#123`) are also accepted. Bare `#123`, inline text such as `Issue: Fixes #123`, other repositories, titles and PR comments do not satisfy this requirement.
- Every referenced issue must currently be open, have `status:accepted`, have neither `status:needs-triage` nor `status:declined`, and list the PR author as an assignee. Trusted acceptance, your request, maintainer approval and actual assignment must all be strictly earlier than `PR.created_at`, with the request preceding approval/assignment. The gate verifies GitHub comment/timeline evidence, not just current labels or self-reported permission. Late acceptance, claiming or approval cannot qualify the original PR; editing it, marking it ready or reopening it does not reset creation time. Complete the process, then open a new PR.
- The trusted `pull_request_target` gate must explain and close confirmed noncompliant PRs, including drafts and reopened PRs, and fail the fixed-name `issue-claim-policy` Check Run on the PR's head SHA. Compliant or permission-exempt PRs pass that check. API failures that prevent reliable permission or history retrieval fail the check without automatically closing the PR; a complete history confirming no prior approval is a policy violation, not an API error. The trusted workflow must not check out or execute PR head code with write privileges.
- Issue state, acceptance-label or assignment changes revalidate all linked open PRs. Bot `/approve` and `/unassign` actions must explicitly refresh linked PRs in the same run instead of relying on bot-generated events to trigger another workflow.
- This is the required automation contract, not a claim that documentation deploys it. The approval and PR-gate workflows must land on default branch `main`; maintainers must preserve the existing Required checks and append `issue-claim-policy`, without replacing or migrating code CI check names here. Merge requires **existing code CI + `issue-claim-policy`**. GitHub cannot prevent access to the PR creation page, so enforcement is post-creation closure plus a required check.

**外部贡献者必须先在 issue 申请，获得维护者批准并成为 assignee，才能创建 PR；不能直接开 PR，draft 也不例外。** 只有仓库 owner，以及 GitHub API 实时确认具有 `write` / `maintain` / `admin` 权限的协作者，豁免这一 issue 认领门禁。每次校验都实时查权限；`contributor` 徽章、`author_association`、历史贡献或 `read` / `triage` 权限不算豁免。不设 `claim:exempt` 或其他标签例外，认领豁免也不豁免代码 CI。

- 等维护者在 open issue 添加 `status:accepted`，并移除 `status:needs-triage` / `status:declined`。本人在该 issue 评论 `/assign`，这只是申请，**不会立刻分配**。等维护者在同一 issue 评论 `/approve @login` 并由机器人完成指派；也可由维护者通过 GitHub UI 手动指派，但同一 issue 必须已有本人事前的有效 `/assign` 记录。受理不等于批准认领。
- 本人 `/unassign` 取消待批申请或释放自己的认领。维护者可 `/unassign @login` 取消指定申请或释放指定认领，无参 `/unassign` 则释放当前所有 assignee。
- PR 正文至少填写一条独立行 `Fixes #123` 或 `Refs #123`，每个 issue 一行，支持多条；也支持同仓库完整 issues URL（如 `Fixes https://github.com/elysia395/dsh-wallpaper-engine/issues/123`）或限定仓库引用（如 `Refs elysia395/dsh-wallpaper-engine#123`）。裸 `#123`、`关联 issue：Fixes #123` 这样的行内文字、其他仓库引用、标题或 PR 评论都不算。
- 每个关联 issue 当前都必须 open、带 `status:accepted`、无 `status:needs-triage` / `status:declined`，且 PR 作者是 assignee。可信受理、本人申请、维护者批准及实际分配必须全部严格早于 `PR.created_at`，申请须先于审批/分配。校验依 GitHub 评论与时间线证据，不只看当前标签或正文自报的授权。事后补受理、认领或审批不能让原 PR 合格；编辑、转为 ready 或重新打开都不重置创建时间。补齐流程后需重新创建 PR。
- 可信 `pull_request_target` 门禁须对已确认不合规的 PR 自动解释并关闭，包括 draft 和 reopened，并在 PR 的 head SHA 写入固定名 `issue-claim-policy` Check Run `failure`；合规或实时权限豁免时该检查通过。API 故障导致无法可靠取得权限或历史数据时仅判失败，不自动误关；完整历史确认没有事前批准的，仍是违规，不是 API 故障。可信工作流不能带写权限检出或执行 PR head 代码。
- issue 开闭、受理相关标签或分配变化时，重验所有关联开放 PR；机器人 `/approve` / `/unassign` 必须在当前运行中主动刷新，不能依赖机器人产生的事件再触发工作流。
- 上述是必须落实的自动化契约，不代表修改文档就已部署。审批及 PR 门禁工作流必须先合入默认分支 `main`；维护者须保留现有 Required checks 并追加 `issue-claim-policy`，不在此流程中替换或迁移代码 CI 检查名。合并要求为**现有代码 CI + `issue-claim-policy`**。GitHub 无法预先禁用 PR 创建页，因此采用创建后自动关闭与必过检查阻断合并。

## Issue triage & labels / Issue 分诊与标签

The claim gate above is the executable contract; this section keeps the triage/label bookkeeping. Enforcement lives in `.github/workflows/issue-claim*.yml` — changing this prose does not deploy the gate.

| Label | Meaning | Who sets it |
|---|---|---|
| `status:needs-triage` | New issue, not looked at yet — the initial state (template adds it) | template |
| `status:accepted` | Maintainer confirmed it is worth doing; **claims start here** | maintainer |
| `status:declined` | Won't do / out of scope (with a one-line reason) | maintainer |
| `area:client` | Browser half (`src/**`, rendering / panels / glass) | anyone |
| `area:host` | Host half (`lib/**`: routes, scan, media pipeline, config) | anyone |
| `area:glass-ui` | Liquid glass / appearance / fonts / mascot | anyone |
| `area:webwallgl` | Scene / web wallpaper renderer and media bridge | anyone |
| `area:ci-docs` | CI, guards, docs, release chain | anyone |

GitHub defaults (`bug` / `enhancement` / `documentation` / `good first issue` / `help wanted` / `question` / `duplicate` / `invalid` / `wontfix` / `accessibility`) keep their usual meaning. `good first issue` is only added to **accepted** issues with a confirmed small scope — it is a promise to new contributors.

**Maintainer triage (weekly or on demand)**：读 `status:needs-triage` → 可复现/有价值的加 `status:accepted`、移除 `needs-triage`/`declined`、打 `area:*`（范围小再加 `good first issue`）；不做的标 `status:declined` 并写明原因后关闭 → 审阅 `/assign` 申请并按上文批准/指派 → 已受理但长期无人认领且影响面大的，挂维护者计划或 milestone。

**认领时限与回收**：认领后 **14 天**无进展且无留言说明，维护者可在该 issue 留言 @ 认领人后改派或释放。`/assign` 只是申请、不会立刻分配；本人 `/unassign` 取消申请或释放认领；维护者 `/unassign @login` 取消指定人，无参 `/unassign` 释放当前全部 assignee。

**自动门禁的部署边界**：可信 `pull_request_target` 工作流必须先合入默认分支 `main` 才生效；Ruleset 保留 `ci/result` 并追加 `issue-claim-policy`，合并要求统一为「现有代码 CI + `issue-claim-policy`」。GitHub 不能预先禁用 PR 创建页，因此执行方式是**创建后自动解释并关闭 + 必过检查阻断合并**。完整时间判据、违规关闭语义与 API 故障处理见上文 Approval 节。

## Choose the target branch / 选择目标分支

All changes target `main`. The plugin is **one natively cross-platform tree** (Windows / WSL / macOS / Linux) with no platform branch — a platform-specific change must not regress the others.

所有改动都提交到 `main`。本插件是**一份原生跨平台代码**（Windows / WSL / macOS / Linux），没有平台分支 —— 平台专属改动不得让其它平台回退。

## Build from the canonical source / 从唯一源码构建

- `src/client.js` is the canonical browser source. Edit it, then run `npm run build` to regenerate `lib/client.js`.
- `lib/client.js` is generated at build time and **not tracked in git** (v1.4): `npm run build` produces it locally; `prepack` produces it inside npm / Release tarballs. Do not edit it by hand.
- Host-side changes live directly in `lib/index.js` and the other `lib/*.js` host modules.
- Restart DSH after host-side edits: `lib/*.js` is loaded at startup and is never hot-updated in a running instance.
- Install a local dev build with the application **fully closed**, using the complete source installer below. Linking only the main package is insufficient.
- Use the Node.js version your DSH profile requires; this repository declares `engines.node` in `package.json`.

- `src/client.js` 是浏览器端唯一源码。修改后运行 `npm run build` 重新生成 `lib/client.js`。
- `lib/client.js` 是构建期产物、**不入库**（v1.4 起）：本地跑 `npm run build` 生成；npm 包与 Release tgz 里由 `prepack` 在打包时现场构建。请勿手改。
- 宿主端代码直接位于 `lib/index.js` 和其他 `lib/*.js` 模块中。
- 改完宿主端代码需**重启 DSH**：`lib/*.js` 在启动时加载，运行中的实例不会热更新。
- 安装本地 dev 构建请**先完全关闭应用**，使用下文的完整源码安装器；只链接主包不能部署完整套件。
- 请使用你的 DSH profile 要求的 Node.js 版本；本仓在 `package.json` 的 `engines.node` 里声明。

### What `lib/client.js` actually is / `lib/client.js` 到底是什么

- **Anatomy**: `lib/client.js` = the `src/client.js` body **+ every module listed in `INLINE_MODULES`** (`scripts/build-client.mjs`), all inlined into a single `factory(require)` scope. `npm run build` prints that inlined list — **read the count off that list, never from prose here** (a hardcoded number in this file has already gone stale once). Most of the file's lines therefore come from `src/**`, not from `client.js` itself — it *looks* like a monolith but is a flattened repository slice.
- **Why inlining**: the browser half has **no local-module resolver** — the loader's `require` resolves only external packages, so `import './panel-tabs.js'` cannot work at runtime. Everything split out of `src/client.js` for readability is inlined back as a prelude in the same scope. Each entry declares `markers`, and a missing marker is a **hard build failure** — that is what stops the split from silently going empty. The output must also parse (`new Script(...)`) before it is written.
- **Its role**: `package.json` exposes it as `exports["./client"]` with `dsh.client.immediately: true`; the DSH client loader fetches it from package metadata (no host route serves it). It is **built, never tracked** (v1.4): npm / Release tarballs get it from `prepack` at packaging time, and a `link:` dev checkout gets it from `npm run build`. The supported paths are the complete source installer below and, after all packages are published, the npm package name or complete Release set. A raw `github:` install does not build the clients or register all subpackages and is **not supported**.
- **Rule 1 — rebuild before verifying**: any `src/**` change requires `npm run build` before `verify` / packaging (there is no committed artifact left to forget). CI rebuilds and then asserts the artifact is **not tracked**; the **local chain asserts freshness** via `test/verify-client-sync.mjs`: it rebuilds, compares byte-for-byte, and restores the file — so a stale artifact fails **before you push**.
- **Rule 2**: never hand-edit `lib/client.js`; the next build overwrites it.
- **Rule 3 — the artifact is a contract**: several guards test the **built** file (`verify-readability`, `verify-softrender`, `verify-client`), and some extract the stylesheet from it by a line-leading anchor. That is why `src/styles.js` forbids backticks and literal copies of its own declaration in its comments — one stray backtick once made `verify-host-paint-scope` report "bare backticks: 489".
- **Trap — comments in `src/**` ship to users**: prefer the *measurement command* over a number that drifts (two module headers once cited `src/client.js` as "9,500 lines" — both are fixed now; don't write one back).
- **Don't shrink it as if it were a monolith**: its size is the size of `src/**`. The lever is the sources.

- **构成**：`lib/client.js` = `src/client.js` 正文 **+ `INLINE_MODULES` 里的每一个模块**（见 `scripts/build-client.mjs`），全部内联进**同一个** `factory(require)` 作用域。`npm run build` 会把内联清单打印出来 —— **条数只许从那份清单现读，不要写进本文件**（这里写死过一次，已经漂了）。**它的大部分行来自 `src/**` 而不是 `client.js` 自己**（占比同样按那份清单复算，勿记死数）—— 看着像巨石，实为"压平的仓库切片"。
- **为什么必须内联**：浏览器半边**没有本地模块解析器** —— loader 的 `require` 只解析外部包，`import './panel-tabs.js'` 在运行时根本不成立。凡为可读性拆出去的代码，都在构建期作为 prelude 内联回同一作用域。每项都带 `markers`，**缺任何一个都构建硬失败** —— 这正是"拆分不会悄悄变空"的保证；产物还必须能通过 `new Script(...)` 解析才会被写出。
- **它的身份**：`package.json` 用 `exports["./client"]` + `dsh.client.immediately: true` 暴露它，DSH 客户端加载器按**包元数据**取（宿主侧没有任何路由发它）。它**构建、但不入库**（v1.4 起）：npm 包与 Release tgz 由 `prepack` 在打包时生成；`link:` 开发检出由 `npm run build` 生成。支持下文的**完整源码安装器**；整套包正式发布后也支持 **npm 包名 / 完整 Release 集合**。裸 `github:` 直装不构建客户端，也不会登记全部子包，**不支持**。
- **铁律一 —— 先重建再验证**：改任何 `src/**` 都要在 `verify` / 打包前 `npm run build`（已无"产物忘了提交"这回事）。CI 重建后判**产物不入库**；**本地链同样判新鲜度**：`test/verify-client-sync.mjs` 会重建、逐字节比对、并把文件**还原**（守卫不改工作树）⇒ 产物过期会在 **push 之前**就红。
- **铁律二**：绝不手改 `lib/client.js`，下一次构建会抹掉。
- **铁律三 —— 产物即契约**：多个守卫跑的是**产物**（`verify-readability`、`verify-softrender`、`verify-client`），另有一些**按行首锚点从产物里**取样式表。这就是 `src/styles.js` 禁止在自己注释里写反引号、也禁止复述那条声明语句的原因（实测踩到过：`verify-host-paint-scope` 报"裸反引号 489"）。
- **陷阱 —— `src/**` 的注释会随包发给用户**：涉及行数 / 体积这类会漂的量，写**复算命令**而不是写数字（曾有两处模块头注释把 `src/client.js` 说成"9,500 行"，现已修掉 —— 别再写回去）。
- **不要把它当巨石来"治理"**：它的体积就是 `src/**` 的体积，杠杆在源文件。

## Install a local dev build / 从本地源码安装（开发者）

> **Gray-test checkouts:** when a change has not reached upstream, download the current gray-test repository and branch, not the upstream `main` shown in the clone examples below.
>
> **灰测源码**：未合入上游的改动，请从当前灰测仓库及分支下载，不要用下面示例中的上游 `main` 代替灰测源码。

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

### 2. Install the complete source set / 安装完整源码套件

Requires Node.js and a DSH kernel within the ranges declared in `package.json`'s `engines` (the 0.2 line qualifies), plus pnpm. Enter the checkout directory and completely close the target application. Use the target host's actual DSH data directory, not an assumed `~/.dsh`.

要求 Node.js 与 DSH 内核都落在 `package.json` 的 `engines` 声明内（0.2 线可装），另需 pnpm。进入插件目录，先完全退出目标宿主，并确认该宿主实际使用的 DSH 数据目录。

```sh
node scripts/install-source.mjs --profile desktop --dsh-home "<目标 DSH 数据目录>" --app-closed
```

Use `web` for the web profile. Add `--dry-run` to inspect the target without changing it. Desktop profiles require the carrier CLI installed by the desktop host; the standalone npm CLI rejects `desktop`. For web profiles without `dsh` on PATH, pass `--dsh-cli "<DSH CLI lib/bin.js>"`.

网页宿主使用 `--profile web`。先加 `--dry-run` 可只核对目标。桌面 profile 必须使用桌面宿主安装的 carrier CLI；独立 npm CLI 不允许管理 `desktop`。网页版找不到 `dsh` 命令时，可传入 `--dsh-cli "<DSH CLI 的 lib/bin.js 路径>"`。

The installer runs `npm ci`, builds the clients, and registers all nine packages as persistent `link:` dependencies. Only the main bundle remains selected; it owns the complete patch, so selecting the child bundles as well duplicates their rows. Other bundle selections and row-level settings remain unchanged.

脚本安装仓库依赖、构建客户端，通过 DSH 将主包和 8 个子包登记为持久 `link:` 依赖。只保留主包 bundle 选择，避免子包 patch 重复插入行；其他 bundle 选择和现有行级开关不变。不要只链接主包，也不要把临时 junction 工具当成正式安装流程。

For an update, close the host, update the entire checkout, and rerun the same command. Keep the source directory in place while installed.

更新时先关闭宿主，更新整个源码目录，再重跑同一命令。安装后不要移动或删除源码目录。

### Release set / 发布集

```sh
npm run pack:release
```

This builds clients and creates nine tarballs plus `release-set.json` under a unique `.test-cache/release/set-*` directory. The staged main manifest lists each of the eight child packages at its exact real version, with no pet or Electron dependency. Publish children first and the main package last, following `publishOrder`. This command never publishes anything. A raw root `npm pack` uses the development manifest, not the complete release set. Do not publish a test version without explicit approval.

该命令构建客户端，在独立的 `.test-cache/release/set-*` 目录生成九个 tarball 和 `release-set.json`。发布形态主包将八个子包的真实精确版本列为运行依赖，不包含 pet 或 Electron。正式发布按 `publishOrder` 先子包、后主包。此命令不执行发布；源码根目录直接 `npm pack` 仍是开发清单，不能当成完整发布集。灰测阶段未经明确批准，不要发布 npm。

The full procedure — npm channel, GitHub Release assets, post-publish self-checks, mirror sync and rollback — is in [`docs/RELEASING.md`](docs/RELEASING.md). Two rules are not negotiable: every child package must be on the registry at the same version before the main package is usable (`pnpm add` resolves the eight exact versions from the registry, so a main-only release fails with `ERR_PNPM_FETCH_404`), and a GitHub Release must carry all nine tarballs plus `release-set.json` — a main-only Release is an uninstallable package. For the offline release set use `npm run install:release -- --set <dir> --profile <name> --dsh-home <dir> --app-closed`, which pins the eight children to the sibling tarballs through profile `overrides`; never hand the desktop installer a single main tarball.

完整发布流程（npm 通道、GitHub Release 资产、发布后自证、镜像同步与回滚）见 [`docs/RELEASING.md`](docs/RELEASING.md)。两条规则不可让：主包可用的前提是八个子包已在同一版本上公开（主包把八个**精确版本**声明为运行依赖，只发主包会让用户的 `pnpm add` 以 `ERR_PNPM_FETCH_404` 失败）；GitHub Release 必须挂**九个 tarball + `release-set.json`**，只挂主包的 Release 是一个装不上的包。离线安装发布集用 `npm run install:release -- --set <目录> --profile <name> --dsh-home <目录> --app-closed`（它把八个子包钉到同目录 tarball 的 `overrides` 写进 profile），不要把单个主包 tarball 交给桌面安装器。

On Windows, use a current patched Node.js release for packaging, and ensure npm uses the same Node.js runtime. Take the supported Node range from `package.json`'s `engines`, and CI's Node version from `setup-node` in the workflows — do not pin a version here.

Windows 打包请使用已更新补丁版本的 Node.js，并确认 npm 使用同一套 Node.js 运行时；支持范围以 `package.json` 的 `engines` 为准，CI 的 Node 版本以工作流里的 `setup-node` 为准，不要照抄本文件的版本号。

### 3. Restart / 重启确认

Then restart `dsh web`. The host plugin becomes a bundle layer and the client plugin auto-loads (`dsh.client.immediately: true`).

然后重启 `dsh web`。host 端会成为 bundle 层，client 端会自动加载（`dsh.client.immediately: true`）。

If Steam is installed in a non-standard location, the host auto-detects it via `libraryfolders.vdf` — nothing further is required. / 如果 Steam 装在非标准位置，host 会通过 `libraryfolders.vdf` 自动探测，无需额外配置。

> **注意 profile 与「应用必须先关闭」**：上面的示例用 `--profile desktop`，需要桌面宿主的 carrier CLI；若目标是网页端，请改成 `--profile web`。安装前务必**先完全关闭目标应用**（应用运行期间安装会停在 `startup-unconfirmed`，恢复状态会在下次启动时自动回滚）。

## Verify before opening a PR / 提交 PR 前验证

先按本次 PR 的**完整差异**选择验证路径，不只看最后一笔提交：

- **纯文档（`docs`）**：README、贡献指南和明确白名单内的普通 Markdown，运行轻量文档检查。不安装产品依赖，不构建，不跑全仓静态检查或运行时测试。
- **文档展示素材（`docs-assets`）**：仅文档使用的图片和排版源稿，增加图片与引用检查；影响排版时补桌面 / 手机预览。运行时素材不属于此类。
- **完整验证（`full`）**：任意代码、schema、依赖、包清单、测试、CI、生成契约文档或未知路径。与文档混改仍选此路径；无法完整取得差异时全量或阻断，不能默认文档。

For documentation-only changes, use the dedicated lightweight document check. Mixed code, dependencies, CI, generated contracts and unknown paths retain full verification. `verify:docs` is repository housekeeping, **not** the documentation fast path.

完整路径继续执行：

```sh
npm ci              # 本地安装工具链；CI 使用受控安装参数
npm run verify:all  # = build + verify（硬档）+ verify:docs（软档）+ smoke
```

`verify:all` 的含义不变。分类不会豁免代码改动，也不把此前门禁失败或未执行项变为通过。

**提交前必须全绿的是硬档**（`npm run verify`：真机行为 / 发布面 / 平台契约 / 打包面）。
软档（`npm run verify:docs`：仓库内务 —— 模块布局 / 可达性 / 退役线 / 声明孤儿）
**照跑、照打印结论，但不拦 PR** —— 判据一字未改，退出码由 `test/warn-only.mjs` 降级为警告
（原码打在 `[warn-only] 软档守卫原退出码 = N` 行上）。
> **两档各含哪些守卫、分档判据是什么，只在 [`docs/DEV-GUIDE.md`](docs/DEV-GUIDE.md) §4.2 定义一处**
> —— 这里刻意不列清单（此前抄过一份，删掉两条守卫后就过时了，正说明为什么不该抄）。

`.github/workflows/verify.yml` 三个阶段：`changes` 作业先用 `node scripts/ci-routing.mjs check` 分类——PR 事件取 merge-base 完整 PR 差异（`--base-mode merge-base`），push 事件取 `before → after` 原样差异（`--base-mode exact`：force-push 后 before 不一定是 after 的祖先，merge-base 会漏算 before 独有的代码删除），workflow_dispatch 无事件边界 ⇒ `github.sha → github.sha` 空差异 ⇒ 分类器保守完整验证；差异取不全 ⇒ fail-closed 全量，绝不误判文档。纯文档路径由 `docs` 作业对**同一差异、同一模式档**再跑一次 `node scripts/ci-routing.mjs docs`（文档引用 / 冲突标记 / 素材类型检查；差异里混入代码或未知路径 ⇒ 退出码 3 明确拒绝，不以假成功放行；其 checkout 显式指向 head 提交，保证被审计的树就是被分类的树）。**判定脚本（分类器 / docs 审计 / 汇总器）一律从 base 分支取，不执行 PR 树里的同名文件**（信任边界：判据不能由被审计的 PR 提供）。完整路径保留 Windows / Ubuntu 两个平台、静态门禁、构建、运行守卫、媒体桥与冒烟；仓库内务（`verify:docs`）已移到 `.github/workflows/housekeeping.yml` 每周定时 + 手动，不在 PR 必过链里。固定 `ci/result` 汇总在 `if: always()` 下核验所选作业确实成功：取消、失败、缺结果或意外跳过不能放行；Ruleset 的 Required checks 当前为 `ci/result` + `issue-claim-policy`（见本文「Issue triage & labels」节）。

完整路径还检查产物不入库（`git ls-files -- lib/client.js docs/images` 必须为空），并扫描被跟踪文件的尾随空白与冲突标记。产物同步仍由 `test/verify-client-sync.mjs` 真跑构建逐字节检查。

CI 完整路径使用 `npm ci --omit=peer --ignore-scripts --no-audit --no-fund` 安装依赖，随后运行静态检查。build / verify / smoke 仍只直接引用 `node:` 内置模块及仓库相对路径，P5 的零裸依赖判据不变。文档快通道无需这一步安装。

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
- The PR title is a plain-language summary of what changed and why (see **PR titles** above); technical depth lives in the body.
- External contributors completed issue acceptance, their own `/assign`, maintainer approval and assignment before PR creation; every linked issue remains eligible, and the body uses standalone `Fixes` / `Refs` lines. Only live owner / `write` / `maintain` / `admin` permission exempts this gate.
- Existing code CI and `issue-claim-policy` are green; late claiming requires a new PR, not reopening the original.
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
- PR 标题是「改了什么、解决什么问题」的人话简述（见上面的 **PR 标题讲人话** 一节）；技术细节放在正文。
- 外部贡献者已在 PR 创建前完成 issue 受理、本人 `/assign`、维护者批准及指派；每个关联 issue 仍合规，正文使用独立行 `Fixes` / `Refs`。仅实时 owner / `write` / `maintain` / `admin` 权限豁免此门禁。
- 现有代码 CI 与 `issue-claim-policy` 均通过；事后补认领需新开 PR，不能重新打开原 PR。
- 修改 `src/client.js` 时已先 `npm run build` 重建（产物不入库，无需提交）。
- 现有平台行为已保留，或正文已解释有意变更。
- 构建与验证命令全部通过。
- 新增的开发面文件放在**约定位置**：守门与冒烟在 `test/`，手动诊断/分析/生成工具在 `test/tools/`，
  构建与发布期脚本在 `scripts/`（见 `docs/CODE-STRUCTURE.md` §4）；新守卫还要挂对链
  （硬档 `npm run verify` vs 软档 `npm run verify:docs`，见 `docs/DEV-GUIDE.md`）。
- PR 不含凭据、本地媒体、生成缓存或无关清理。
- 包元数据仍然属实：`engines.dsh` 与三份 README / `UPGRADING` 同口径；README 里"包里带什么"与真实
  tarball 一致；构建与发布期脚本没有往 stdout 写信息性文字（各自为什么重要见上面的 **发布** 节）。
