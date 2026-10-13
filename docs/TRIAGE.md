# 问题分诊与认领（Triage & self-claim）

> 本文面向**贡献者与维护者**，说明 issue 从提出到被认领、到 PR 收口的流程与机器判据。
> 治理总纲（历史瘦身 / 分支保护 / 标签体系的来龙去脉）：issue [#212](https://github.com/elysia395/dsh-wallpaper-engine/issues/212)。

## 标签体系

| 标签 | 含义 | 谁打 |
|---|---|---|
| `status:needs-triage` | 刚提出、还没人看过 —— **新 issue 的初始状态**（模板自动带上） | 模板自动 |
| `status:accepted` | 维护者已确认"这是个值得做的事"；**认领从这里开始** | 维护者 |
| `status:declined` | 明确不做/不是本仓范围（会写一句原因） | 维护者 |
| `area:client` | 浏览器半边（`src/**` 与渲染 / 面板 / 玻璃） | 任何人 |
| `area:host` | 宿主半边（`lib/**`：路由、扫描、媒体管线、配置） | 任何人 |
| `area:glass-ui` | 液态玻璃 / 外观 / 字体 / 吉祥物 | 任何人 |
| `area:webwallgl` | 场景 / 网页壁纸渲染引擎与媒体桥 | 任何人 |
| `area:ci-docs` | CI、守卫、文档、发布链路 | 任何人 |

沿用 GitHub 默认标签：`bug` / `enhancement` / `documentation` / `good first issue` /
`help wanted` / `question` / `duplicate` / `invalid` / `wontfix` / `accessibility`。
`good first issue` 只在**已受理**且确认范围小的时候加 —— 它是给新贡献者的承诺。

## 认领（自动，评论命令）

- 在**已受理**（带 `status:accepted`）的 issue 下评论 `/assign`：
  机器人把你指派为该 issue 的 assignee，并回一条确认。
- 已被别人认领时评论 `/assign`：机器人会回复当前认领人，**不会**重复指派 —— 想接力请先与认领人沟通。
- issue 还没受理时评论 `/assign`：机器人提示先等维护者受理（受理后 `status:accepted`，再认领）。
- 认领人自己（或维护者）评论 `/unassign` 释放；维护者也可以直接在 GitHub UI 上指派人。
- 失联处理：认领后 **14 天**无进展、且无留言说明的，维护者可以改派或释放
  （会先在该 issue 里留言 @ 认领人）。

> 机器人实现：`.github/workflows/issue-claim.yml`（`issue_comment` 事件 + `actions/github-script`）。
> 注意工作流只认**默认分支（main）**上的版本；改动它需要先合入 main 再测。

## 维护者分诊动作（每周一次或按需）

1. 打开 `status:needs-triage` 列表，逐条读；
2. 判断：能复现/有价值的 → 改 `status:accepted` + 打 `area:*`（+ 合适的 `good first issue`）；
   不做的 → `status:declined` 写一句原因后关闭；
3. 已受理但长期无人认领且影响面大的，挂到维护者自己的计划里（或进 milestone）。

## 贡献者路径（从 issue 到合并）

1. 找到 `status:accepted` 的 issue，评论 `/assign`（或先与维护者确认）；
2. 按 [`CONTRIBUTING.md`](../CONTRIBUTING.md) 准备本地环境：**`npm ci` → 改 `src/**` →
   `npm run build`**（产物不入库，重建后无需提交）→ `npm run verify:all`；
3. 从**新 main** 开分支、发 PR（PR 模板里有清单）；
4. `main` 分支保护要求 PR + 双平台 CI（`verify (windows-latest)` / `verify (ubuntu-latest)`）
   全绿才可合并（见仓库 Ruleset）。

## 与 PR 的关系

- PR 请**引用 issue 号**（`Fixes #123` / `Refs #123`），合并后自动关联；
- 一个 PR 只做一件事（CONTRIBUTING 的既有要求）；大改动先开 issue 讨论再动手。

---

> English summary: accepted issues can be claimed by commenting `/assign` (a bot assigns you);
> `/unassign` releases. Labels: `status:*` (needs-triage / accepted / declined) and `area:*`.
> PRs require the two-platform `verify` CI and a PR (main is protected). See the tables above.
