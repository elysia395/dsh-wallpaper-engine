# ADR-0012: 构建产物出库（lib/client.js 不再入库）与展示图迁至 Release 资产（Artifact untracking）

- **Date**: 2026-10-14
- **Status**: Accepted
- **Deciders**: elysia395
- **Amends**: ADR-0003 的 D6（"产物入库、且永不手改"）

> 本 ADR 记取舍。机制细节在 `scripts/build-client.mjs`、`scripts/prepare.mjs` 与
> `test/verify-client-sync.mjs` 的文件头；操作口径在 `CONTRIBUTING.md`。

## Context

ADR-0003 D6 选择让 `lib/client.js` **入库**，理由：当时设想支持的安装路径
（`pnpm add github:…`、`link:`）都不跑构建，产物不在库里就没有客户端半边。

随后出现两件事：

1. **安装路径实际收敛到 npm 包与 Release tgz**（`github:` 直装在 pnpm 11 的
   allowBuilds 闸下本来就装不上，见 issue #141 与 ADR 系列的 `prepack` 决策），
   而这两条路径都会在打包时跑 `prepack` 现场构建 —— "库里必须有产物"的前提消失了。
2. **每次重建都留一份 2.6–4.5 MB 的新 blob**：`lib/client.js` 的历史版本累计
   占了 pack 的相当一部分（复算：`git rev-list --objects --all` 按路径聚合
   `git cat-file --batch-check` 的字节）。同一个仓库的 `docs/images/` 展示图
   （含一张 39 MB 的 GIF）历史累计更大。clone 越来越慢。

## Decision

- **D1 —— `lib/client.js` 不入库**：从跟踪中移除并加入忽略。三条路径各自现场构建：
  开发者 / CI 跑 `npm run build`；npm 包与 Release tgz 由 `prepack`（`scripts/prepare.mjs`）构建。
- **D2 —— 新鲜度判据从"git diff"改为"真跑构建逐字节比对 + `git ls-files` 判未跟踪"**：
  `test/verify-client-sync.mjs` 保留重建比对（本机 push 前就红），新增产物未跟踪断言；
  CI 的「产物与源码同步」步替换为「产物不入库」步。
- **D3 —— README 展示图迁至 GitHub Release 资产（`media-v1`，CDN 外链）**：
  仓库与历史不再保留展示图；`screenshots.json`（市场展示图清单）同步指向外链。
- **D4 —— 历史重写的产物面**：`git filter-repo --invert-paths --path docs/images --path lib/client.js`
  从**全部历史**剔除这两族路径（一次性动作，公告 + 冻结窗口后执行）。
- **D5 —— `github:` 直装明确不支持**：安装文档（README.beginner / TROUBLESHOOTING ×2 / CONTRIBUTING）
  统一改为"npm 包名 / Release tgz；开发者用 `link:` + `npm run build`"。

## Consequences

- **收益**：clone 体积与耗时显著下降（量级复算：`git rev-list --objects --all` 聚合）；
  仓库不再随每次客户端改动增肥；"产物与源码不同步"这一类错误从"可能漏提交"变成结构上不可能
  （产物根本不在库里）。
- **代价**：
  - 所有 commit SHA 变化（含全部 tag）——重写是一次性动作，fork / 打开中的 PR 需重新同步；
  - `github:` 直装的少数用户需要改走 npm / tgz（此前在 pnpm 11 下也不稳定）；
  - 展示图依赖 Release 资产可用性（GitHub 托管，可接受）；
  - `verify-client-sync` 的语义从"提交物与重建一致"改为"构建产物与重建一致且在库外"，
    老失败文案（"把产物一起提交"）作废。
- **我们放弃了什么**：放弃"clone 下来不构建就能 link 运行"的便利；放弃产物在 git 里的逐版本可追溯
  （历史版本仍可从备份 bundle 与 GitHub 旧历史获得，直到重写）。

## 重新考虑的触发线

- 若未来出现"必须支持离线 `github:` 直装且不允许构建"的新分发面；
- 若 GitHub 的 Release 资产不再适合托管展示图（例如外链被墙成为主要反馈）；
- 若 `prepack` 在某个包管理器下不可靠地跳过构建（届时把 D1 的构建挂点重新裁决）。
