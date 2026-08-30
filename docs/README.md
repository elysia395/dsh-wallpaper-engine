# docs — 决策与用户文档

本项目采用**"代码即真相"**文档模式（2026-08-30 起）：渲染/逆向/根因知识直接内联在
对应实现文件的代码注释中（sf 标记），docs/ 只保留决策与用户文档。

| 文档 | 内容 |
|---|---|
| [RENDERER-FEASIBILITY.md](./RENDERER-FEASIBILITY.md) | 渲染器三路线可行性 + 方向决策 + §7 重构执行记录（唯一决策文档） |
| [SCENE-ANIMATION-HANDOFF.md](./SCENE-ANIMATION-HANDOFF.md) | **场景动画交接手记**——放弃背景、技术要点、已删资产清单、三条未来实现路线（供未来实现者） |
| [ROBUSTNESS-AUDIT.md](./ROBUSTNESS-AUDIT.md) | **健壮性审计记录**——发布包完整性/编码/跨平台/运行时容错/依赖兼容审计结果与重跑方法 |
| [awesome-dsh-plugin-pr-guide.md](./awesome-dsh-plugin-pr-guide.md) | 向 awesome-dsh-plugin 收录目录提交的一次性发布指南（应作者要求保留原版，直接从 awesome-dsh-plugin 仓库复制，勿改） |

- 活的现状/TODO：仓库根 `TODO.md`（含关键事实备忘、回归场景集、sceneVideo 修复记录）。
- 开发/发布指南：仓库根 `CONTRIBUTING.md`（构建验证、热挂载/编码铁律；收录提交速查见其附录，完整版见上表原版指南）。
- 用户文档：仓库根 `README.md` / `README.en.md` / `README.beginner.md`。
- `images/`：README 引用的截图。

已溶解文档（2026-08-30，代码即真相）：
- WE-REVERSE.md / WE-REVERSE-CAMERA-MATH.md → camera.js / image.js / puppet.js / scene/transform.js / scene/animation.js 等注释
- RENDERER-OFFICIAL-STRUCTURE.md → effects/registry.js / materials/compile.js 注释 + FEASIBILITY §6 结论
- RENDER-ISSUES-ANALYSIS.md / REFACTOR-ROUND-2026-08-28.md → 代码 sf 标记 + TODO.md
- REFACTOR-STATIC-FRAME.md → FEASIBILITY §7
- dev-notes-bom-and-dsh-boot.md → CONTRIBUTING.md
- HOOK-PROGRESS.md / V6-DUMP-ANALYSIS.md / EYE-PREDICTION.md / FIX-PLAN-AMYA.md /
  AMYA-CAMERA-ANALYSIS.md / RENDER-ISSUES-PROGRESS.md → 废弃方向，删除（重构前备份可找回）
