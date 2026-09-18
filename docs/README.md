# docs — 决策与用户文档

本项目采用**「代码即真相」**文档模式（2026-08-30 起）：渲染 / 逆向 / 根因知识直接内联在
对应实现文件的代码注释中（sf 标记），docs/ 只保留决策与用户文档。

## 用户文档（中英双语，中文在前）

| 文档 | 内容 |
|---|---|
| [UPGRADING.md](./UPGRADING.md) | **升级指南**——前置条件（内核 / better-sidebar 版本要求）、兼容矩阵、正确更新顺序与「顺序反了怎么恢复」 |
| [CHANGELOG.md](./CHANGELOG.md) | **变更记录**——逐版本功能与修复（新版在前） |
| [HOW-IT-WORKS.md](./HOW-IT-WORKS.md) | **工作原理**——场景渲染器、宿主 / 客户端分工、全部 HTTP 路由表 |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | **排障**——安装失败排查（pnpm / `github:` 直装）与「症状 → 先看哪里」速查 |

**分层约定（2026-09 起）**：门面 `README.md` / `README.en.md` 只放**不随版本变化、且新访客决策必需**的事实
（定位、支持的壁纸类型、安装、使用手册、已知限制）；任何**带版本号 / issue 号 / 性能数字 / 排障步骤 /
实现细节**的内容一律进上表或 `CHANGELOG.md` —— 避免首页随版本迭代腐烂（本次拆分即源于 README 里
7 处 `localStorage` 陈述在 v0.4.0 后集体失真）。

## 工程文档

| 文档 | 内容 |
|---|---|
| [RENDERER-FEASIBILITY.md](./RENDERER-FEASIBILITY.md) | 渲染器三路线可行性 + 方向决策 + §7 重构执行记录（唯一决策文档） |
| [SCENE-ANIMATION-HANDOFF.md](./SCENE-ANIMATION-HANDOFF.md) | **场景动画交接手记**——放弃背景、技术要点、已删资产清单、三条未来实现路线（供未来实现者） |
| [ROBUSTNESS-AUDIT.md](./ROBUSTNESS-AUDIT.md) | **健壮性审计记录**——发布包完整性/编码/跨平台/运行时容错/依赖兼容审计结果与重跑方法 |
| [awesome-dsh-plugin-pr-guide.md](./awesome-dsh-plugin-pr-guide.md) | 向 awesome-dsh-plugin 收录目录提交的一次性发布指南（应作者要求保留原版，直接从 awesome-dsh-plugin 仓库复制，勿改） |

- 活的现状/TODO：仓库根 `TODO.md`（**当前未入库**，按需本地维护；含关键事实备忘、回归场景集、sceneVideo 修复记录）。
- 开发/发布指南：仓库根 `CONTRIBUTING.md`（从本地源码安装、构建验证、热挂载/编码铁律；收录提交速查见其附录，完整版见上表原版指南）。
- 用户门面：仓库根 `README.md` / `README.en.md` / `README.beginner.md`（小白向）。
- `images/`：README 引用的截图。

已溶解文档（2026-08-30，代码即真相）：
- WE-REVERSE.md / WE-REVERSE-CAMERA-MATH.md → camera.js / image.js / puppet.js / scene/transform.js / scene/animation.js 等注释
- RENDERER-OFFICIAL-STRUCTURE.md → effects/registry.js / materials/compile.js 注释 + FEASIBILITY §6 结论
- RENDER-ISSUES-ANALYSIS.md / REFACTOR-ROUND-2026-08-28.md → 代码 sf 标记 + TODO.md
- REFACTOR-STATIC-FRAME.md → FEASIBILITY §7
- dev-notes-bom-and-dsh-boot.md → CONTRIBUTING.md
- HOOK-PROGRESS.md / V6-DUMP-ANALYSIS.md / EYE-PREDICTION.md / FIX-PLAN-AMYA.md /
  AMYA-CAMERA-ANALYSIS.md / RENDER-ISSUES-PROGRESS.md → 废弃方向，删除（重构前备份可找回）
