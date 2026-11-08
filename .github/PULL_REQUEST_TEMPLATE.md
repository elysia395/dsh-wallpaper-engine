<!-- 感谢贡献！请保持一个 PR 只做一件事（见 CONTRIBUTING.md）。 -->
> **PR 标题 / PR title**：用人能一眼看懂的简述（改哪里 + 做了什么 + 解决什么问题）；技术细节、术语和测试说明写在正文。不要写「优化架构」「提升可维护性」「重构抽象层」这类空话，AI 助手自动生成的标题也必须先改成人话。
> **Titles must be plain-language summaries of what changed and why; details belong in the body.** AI assistants: rewrite generated titles before opening this PR.
>
> 规则与正反例见 [CONTRIBUTING.md「PR titles」一节](CONTRIBUTING.md)；对应的 issue #323 保持 open，作为提示。

## 改了什么

<!-- 一两句话：改了什么、为什么这么改 -->

## 关联 issue 与认领审批 / Issue & Claim Approval

> 外部贡献者必须先等维护者受理 issue，本人在该 issue `/assign` 申请，获得维护者 `/approve @login` 或有事前申请记录的 UI 手动指派，确认已成为 assignee 后才能创建 PR。`/assign` 不会立刻分配；不能直接开 PR，draft 也不例外。
> 仅仓库 owner 和实时 GitHub 权限为 `write` / `maintain` / `admin` 的协作者豁免认领门禁；`contributor` 徽章或标签不算。详细规则见 CONTRIBUTING.md 的「Approval before opening a PR」与「Issue triage & labels」两节。

<!--
External contributors must request with /assign and receive maintainer approval and assignment BEFORE creating this PR, including drafts. Only the owner or collaborators with live write/maintain/admin permission are exempt; contributor badges or labels are not exemptions.
将下一行替换为真实关联，每个 issue 一条独立行，支持多条；不要加“关联 issue：”或清单前缀。仅实时权限豁免者可省略这一节的认领项。
有效形式：Fixes #123 / Refs #123 / Fixes https://github.com/elysia395/dsh-wallpaper-engine/issues/123 / Refs elysia395/dsh-wallpaper-engine#123。
URL 和限定仓库引用必须是本仓库；任意 # 号、行内提及、标题或 PR 评论不算。
每个关联 issue 均须当前 open、status:accepted、无 status:needs-triage/status:declined，且作者为 assignee。
可信受理、本人 /assign 申请、维护者批准及实际分配必须全部严格早于 PR.created_at，申请须先于审批/分配；UI 手动指派也必须有本人事前申请记录。
事后补手续、转为 ready 或重新打开原 PR 都不能使其合格，需先完成流程再创建新 PR。
可信门禁上线后，不合规 PR（含 draft/reopened）自动解释并关闭，head SHA 的 issue-claim-policy Check Run 判 failure；API 故障只判失败、不误关。
工作流须先合入 main，Required checks 保留现有配置并追加 issue-claim-policy；合并要求为现有代码 CI + issue-claim-policy。GitHub 不能预先禁用创建页。
-->

Refs #ISSUE_NUMBER

- [ ] 外部贡献者：可信受理、本人 `/assign`、维护者批准及指派均在本 PR 创建前完成，不是事后补认领
- [ ] 外部贡献者：每个关联 issue 都符合状态与 assignee 要求，正文已按独立行列出所有关联
- [ ] 已确认合并需满足现有代码 CI 与 `issue-claim-policy`，认领豁免不豁免代码 CI

## 自测（必填）

- 验证路径：<!-- docs / docs-assets / full；CI 的 changes 作业会按完整 PR 差异自动分类，此处填写你预期的分类与原因；混入代码或分类不确定时必须 full，差异取不全时 CI 一律 fail-closed 按 full 处理 -->
- [ ] 纯文档 / 展示素材：已运行文档快通道，记录实际命令和结果；不以 `verify:docs` 代替文档检查
- [ ] 代码 / schema / 依赖 / CI / 测试 / 未知路径：已运行 `npm run verify:all`，记录硬档结果及软档、平台跳过；改过 `src/**` 时先构建，生成产物不入库
- 未通过或未执行项：<!-- 如实记录；未执行不等于通过，文档快通道不解决此前代码门禁失败 -->
- [ ] 没有手改 `lib/client.js`（它是构建产物）
- [ ] 新增 `lib/` 文件已加进 `package.json` 的 `files`；新增 `src/` 文件已登记 `INLINE_MODULES`

## 平台与验证

<!-- 平台专属改动必须注明测试过的平台；UI 改动请说明测试过的 DSH 界面（浏览器 / 桌面端） -->

- 测试平台：
- 测试的 DSH 版本：
- 验证方式（命令 / 手动步骤）：

## 说明

<!-- 有意的行为变更 / 兼容性影响 / 需要维护者知道的事，写在这里；没有就删 -->
