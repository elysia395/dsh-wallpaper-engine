# 第二轮文档 / 注释腐化检查（task-11 · 基线 `5201451`）

<!-- status-banner: code-is-truth -->
> **状态：历史记录（不反映现行实现）。** 第二期第二轮文档 / 注释腐化复核的过程记录，已收口：
> 上一轮见 [`./DOC-DRIFT-REPORT.md`](./DOC-DRIFT-REPORT.md)，九项裁定见
> [`./UNWIRED-MODULES.md`](./UNWIRED-MODULES.md)，判据锚定见 [`./TEST-ANCHORING.md`](./TEST-ANCHORING.md)。

> 第二期大改（删 8 个文件 / 提取 `createUploadDirResolution` / `createConfigKit` 注入缝 /
> 发现族改上游两族拆分 / 新增 soft 档 `verify-undefined-refs` / reachability 转绿）之后的**复核**。
> 本轮结论：**该轮暴露的框架类腐化绝大多数已被当期 owner 就地修好**；本轮再修 **8 处死路径 +
> 3 处过时框架 + 1 处清单缺项**，并给出未改清单与理由。
> 上一轮的账在 [`DOC-DRIFT-REPORT.md`](./DOC-DRIFT-REPORT.md)、九项裁定在
> [`UNWIRED-MODULES.md`](./UNWIRED-MODULES.md)、判据锚定在 [`TEST-ANCHORING.md`](./TEST-ANCHORING.md)。

## 0. 范围、口径与豁免

- **扫的面**：`docs/**`（不含 `docs/archive/**`、两份 `CHANGELOG.md`、生成物 `ROUTE-INDEX.md` /
  `GUARD-MAP.md`、Lead 的 `BUNDLE-SPLIT.md`）+ 三份根 `README*.md` + `lib/**` + `src/**`（注释）。
- **三条口径**（都是本仓踩过的坑）：
  1. **token 边界**：正则写成 `\.js\b` 一类，扩展名后必须是非标识符字符 —— 否则 `.js` 会命中
     `.json` 的**前缀**（首轮因此多报 60 余条假阳性）。
  2. **git 对象引用不计**：`origin/main:<path>` / `d561f5f^:<path>` 用 `git show` 可解析，
     是**历史对象**不是工作树路径 ⇒ 本轮**不许改**（`ARCHITECTURE-SPLIT.md` §4 左列就是它）。
  3. **生成物不算腐化**：`lib/client.js` 按需由 `npm run build` 产出；它"不在盘上"时
     docs 里的引用**不是**死路径 —— 扫描时整体排除。
- **豁免面**：`docs/archive/**` 与历史 `CHANGELOG`（[`adr/0006`](../../adr/0006-comment-discipline-as-written-convention.md)
  「历史文档不追溯，改了是伪造记录」）；4 份 wip 报告头部刚加的「哈希说明」原样保留。

## 1. 已改：死路径（组件行 / 内核化之后指错落点）

| 位置（改前行号） | 旧陈述为何失真 | 新陈述 & 事实来源 |
|---|---|---|
| `lib/settings-schema.js:202,1380` | "路由会清掉同族旧文件，见 `lib/routes/mascot.js`" —— 该路由已随组件行出户，工作树上不存在 | `lib/components/mascot-avatar/mascot.js`（`lib/index.js` 的 `applyComponent` 表 + `cordis.patch.yml` 行名） |
| `lib/settings-schema.js:535` | "`lib/routes/now-playing.js` 的启动决策" —— 同上（媒体状态族整族在 `lib/components/media-bridge/`） | `lib/components/media-bridge/now-playing.js` |
| `lib/pkg-read.js:282` | "见 `lib/scene-probe.js:77`" —— scene 探测已搬进 `lib/media/`，且**写死行号**必然再腐 | 改成不写死行号的 `lib/media/scene-probe.js` 的 `readPkgEntry` 消费点（扫到 `readPkgEntry` 就在该文件 `:78` 调用） |
| `src/about-assets.js:7,20` | "见 `lib/routes/about-qr.js`" —— 该路由已出户 | `lib/components/about-notice/about-qr.js` |
| `src/avatar-layer.js:131` | "见 `lib/routes/avatar.js` 的不变量 ④" | `lib/components/mascot-avatar/avatar.js` |
| `src/ext-avatar.js:9` | "经 `lib/routes/avatar.js` 读写" | 同上 |
| `src/panel-tabs.js:374` | "见 `lib/routes/github-stars.js`" —— 已出户（`git diff --name-status origin/main -- lib` 的 `R` 记录） | `lib/components/about-notice/github-stars.js` |

复算命令（改后应为 0 命中）：

```sh
git grep -nE 'lib/routes/(now-playing|avatar|mascot|about-qr|github-stars)\.js\b' -- lib src
```

## 2. 已改：过时的"未接线 / 孤儿 / reachability 红"框架

| 位置 | 旧陈述为何失真 | 新陈述 & 事实来源 |
|---|---|---|
| `docs/CODE-STRUCTURE.md` §2 宿主套件条目 | "**哪些是活的以 §2.2 表和 `verify-reachability` 为准**（上游同名文件的副本另有其人）" —— 副本已**全部删除**，不再是"另有其人" | "上游同名副本已全部清掉，该守卫现在是 0 不可达 / 0 行"（`node test/verify-reachability.mjs` 输出） |
| `docs/CODE-STRUCTURE.md` §2.2 后的 ⚠️ 块 | "上游同名文件里有一批**已不在 import 图上**的副本…真源与孤儿由 `verify-reachability` 现算（棘轮：只许收紧）" —— 现在一个副本都不剩，且该守卫是 **0/0** | "曾有 9 个副本长期不在 import 图上却留在发布面；**已逐个删掉或移回真源**（现在一个都不剩）⇒ 0 不可达 / 0 行（棘轮基线未动，绿是清干净换来的）" |
| `docs/ARCHITECTURE-SPLIT.md` §5「不属于差异的一件事」 | "未修：`lib/we-assets.js` 的注释" —— 该注释**已在上一轮修掉**（`773e9f1`） | "两处都已修：LINUX-OCCLUSION 与 `lib/we-assets.js` 的 `WEBWALLGL_DIR` 注释"（`git grep vendored lib/we-assets.js` = 0） |
| `docs/ARCHITECTURE-SPLIT.md` §7「已知缺口」里的 `lib/we-assets.js` 条目 | 同上：作为"仍写 vendored 渲染页"的未收口项挂着 | 改成 ~~删除线~~ + "**已修**"（事实：注释现在写"本仓的渲染页适配层，引擎本体走 npm `webwallgl`"） |
| `docs/archive/wip/DOC-DRIFT-REPORT.md` §4 首条 | "**现在判红**（exit 1）" —— 现在是绿的 | 改成"**当时判红**（第二期已转绿 0/0，见 §7）"，并加一行"下表是当时的判读" |
| 同上 §4 表 `steam-discovery` / `wallpaper-scan` 两行 | "现在的真源 = `lib/we-discovery.js`" —— 方向反了：第二期按上游两族拆分**取回了这两个文件本身**，合并版 `we-discovery.js` 已删 | "**原样取回**（不再是上游副本）：真源就是 `lib/steam-discovery.js` + `lib/wallpaper-scan.js` 两族" |
| 同上 §2 表首行 + 新增 §7 | 同上（"活的是 `lib/we-discovery.js`"） | 那句改成"当时活的是…"，并新增 §7「第二期收口后的状态」：reachability 转绿、新增 soft 档 `verify-undefined-refs`、例外表收到 1 条，逐项见 `UNWIRED-MODULES.md` §14/§16 |

## 3. 已改：清单缺项与写死数字

| 位置 | 旧陈述为何失真 | 新陈述 & 事实来源 |
|---|---|---|
| `docs/DEV-GUIDE.md` §4.2 软档行的清单 | 列了"模块布局 / 可达性 / 退役线 / 声明孤儿 / 守卫映射"，**漏掉本轮新增的 `verify-undefined-refs`**（同文件 §4.1 的 `npm run verify:docs` 一行已经列了它 ⇒ 同文档自相矛盾） | 补「**未定义引用**」与「守卫链」；清单真源照旧写明是 `test/run-guards.mjs`（**不抄步数**） |
| `docs/DEV-GUIDE.md` §4.2 末尾那句 | "**留下的四条**都读代码：模块边界、可达性棘轮、退役线、声明孤儿" —— 软档现在还有未定义引用与两张派生映射，"四条"会被读成总数 | "留下的**软档全都读代码**：…以及后来新增的未定义引用与两张派生映射（守卫映射 / 守卫链）" |

**关于守卫步数**：本轮**没有**把"71 → 72 步"写进任何常青文档 —— 步数与清单的真源是
`test/run-guards.mjs`（`node test/run-guards.mjs all` 的收尾行实测报 **72 步**），
照 [`adr/0006`](../../adr/0006-comment-discipline-as-written-convention.md) D2 只给复算命令。

## 4. 判据承诺核对（任务第 5 项：散文承诺了判据、判据不存在）

做法：把 `lib/**` + `src/**` 注释里被点名的守卫名**全部抽出来**，逐个查盘 + 抽检具体承诺。

- **37 个被点名的 `test/verify-*.mjs` 全部存在**（零"承诺了不存在的判据"）。
- 抽检三条最具体的承诺，都在守卫里真实实现（不是空壳）：
  · `verify-component-face` "组件视图缺键即抛 / 声明了没人给两个方向都红" —— 守卫文件头 `:21-22`
    与 `check` 面一致；
  · `verify-bundle-rows` ⑧c "`apply` 交回的 teardown 也要交给 fiber" —— 在 `:914` 起有独立一节，
    并带"入口 `apply` 体里必须出现 `handOffTeardown(`"的文本兜底（`:990-998`）；
  · `verify-logging` N7③ "客户端前缀 / 宿主注册前缀 / 渲染页引用三者对齐" —— 上一轮已实测其四条负对照。
- 结论：这一维度**本轮 0 发现**（上一轮在 `COMPONENT_GATE_ALIASES.injectedBy` 抓到的那类，
  已由 `TEST-ANCHORING.md` §17 的表接管）。

## 5. 未改（附原因）

| 未改的东西 | 为什么 |
|---|---|
| `docs/archive/**`、`docs/CHANGELOG.md`、`docs/en/CHANGELOG.md` 里的旧路径/旧数字 | [`adr/0006`](../../adr/0006-comment-discipline-as-written-convention.md)：账本描述"当时如何"，改了是伪造记录 |
| `docs/archive/wip/UNWIRED-MODULES.md`（49 处旧文件路径） | 它是**九项裁定的证据底稿**：那些路径正是被审计对象（"孤儿 vs 活侧"），去掉就没法复核；头部「哈希说明」按纪律保留 |
| `docs/archive/wip/DOC-DRIFT-REPORT.md` 里的旧路径引用（除已改的判定句） | 同上：那是"引旧路径作证据"的一列，且文件头已加"读作第一轮判读"的指引 |
| `docs/wip/BUNDLE-SPLIT.md`（映射表里 `lib/we-discovery.js` / `lib/asset-paths.js` 等） | 归 Lead 维护的活手册；其内容是该轮**迁移计划**的当时快照 |
| `docs/wip/{COEXISTENCE-AUDIT,ISSUE-AUDIT-148PLUS,LINUX-OCCLUSION}.md` 的命中 | **假阳性**：`scripts/tmp-token-gate-scope.mjs` 原是 `.integration-notes/scratch-scripts/…` 的子串；`lib/Modal.module.css` / `lib/markdown/*.module.css` / `lib/Tooltip.module.css` 是**宿主 harness 包内**路径；`src/first-run.js` / `src/main.js` / `scripts/prepare-dependencies.mjs` 是**父仓 `dsh-my-ui`** 的相对路径；`test/ar01s03.html` / `docs/doc-org…html` / `docs/book/Xwayland.html` 是 URL 片段 |
| `lib/routes/we-assets.js:36,60` / `lib/we-assets.js:47` 的 `src/local-assets.ts` | 指**上游 WebWallGL 渲染器仓**的同名端点契约（原文写明"契约对齐上游 renderer/src/local-assets.ts"），不是本仓文件 |
| `src/font/components.js:62-75` 的 `lib/markdown/*.module.css` 等 | 同上：**宿主 UI 包内**的 CSS 编译名（我们是按类名后缀去认它），非本仓文件 |
| `docs/DEV-GUIDE.md:166` 的 `src/your-module.js` | "加一个浏览器端模块"的**占位示例名** |
| 各处 `lib/we-discovery.js` / `lib/cache-prune.js` / `lib/asset-paths.js` 的**"已删/已收口"指称** | 它们是**显式的历史陈述**（"…已删"、"~~…~~ 已收口"），不是指向现址的路径陈述；`ARCHITECTURE-SPLIT` §4 左列则是 `origin/main:` 形式 |

## 6. 验证证据（全 exit 0）

| 判据 | 结果 |
|---|---|
| `node test/run-guards.mjs docs`（易腐化面） | `✓ docs 全部 7 步执行完毕`，exit 0 |
| `node test/verify-module-layout.mjs` | `ALL MODULE LAYOUT CHECKS PASSED`（⑧ 26 个工具/compat 全被点名），exit 0 |
| `node test/run-guards.mjs all`（整链） | `✓ all 全部 72 步执行完毕`，exit 0 |
| `npm run build` | exit 0（本轮改了 `src/**` 与 `lib/settings-schema.js` 的**注释**，产物按规矩重建） |
| `git diff -U0 -- lib src` 自查 | 8 处改动**全部落在注释行**（`/** */` 与 `//`），零可执行语句 |
| 死路径重扫 | 7 处死路径全部消失；剩余 113 条按 §5 逐类归因（历史指称 / 账本证据 / 假阳性 / 占位） |

> `verify-static`（ESLint + tsc）在本机不可判定（eslint 安装态损坏 + 沙箱管道限制），
> 按任务说明**未**当作可依赖的网 —— 本轮的注释改动也不引入需要它兜的风险（纯路径文本）。

## 7. 给 Lead 的两条提示

1. **"零死路径陈述"要不要覆盖 wip 记录**：`UNWIRED-MODULES.md` / `DOC-DRIFT-REPORT.md` 里成片的
   旧路径是**审计证据**，按 ADR-0006 属于"账本"性质。若你要的是连账本也改写，需要一次
   "历史化改写"决策（我建议保留，并把"现状以 `DOC-ROT-REPORT-2.md` 为准"的指引当作边界）。
2. **`lib/we-assets.js` 的注释已在上一轮修好**，本轮只更新了引用它的文档；如果后续还有人照
   `ARCHITECTURE-SPLIT.md` §7 的旧条目去"修注释"，会白跑一趟 —— 已改成删除线 + 已修。
