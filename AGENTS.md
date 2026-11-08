# Agent instructions / 给 AI 助手的说明

本文件只放一条硬规则：**创建 PR 时，标题必须讲人话。** 其余贡献规则见 `CONTRIBUTING.md`。

This file carries one hard rule for AI assistants: **when you open a pull request, the title must be plain language.** All other contribution rules live in `CONTRIBUTING.md`.

## PR 标题讲人话，正文专业 / Plain-language title, professional body

标题是评审第一眼看到的信息。请让**不熟悉这段代码的人**也能从标题看出：

- 改哪里（模块 / 功能 / 页面）
- 做了什么
- 解决什么问题

实现方案、术语、原理和测试说明写进 **PR 正文**，不要塞进标题。

Titles are the reviewer's first signal. Make them readable to someone who does not know this codebase: say **what changed, where, and what problem it solves**. Implementation details, jargon and test notes belong in the **PR body**.

### 硬性要求 / Hard requirements

1. 不要只写空泛结果：`优化性能`、`提升体验`、`增强稳定性`、`改进代码质量`、`优化架构`、`重构抽象层`、`提升可维护性`。
2. 不要直接使用 commit message、计划标题或工具自动生成的标题；**提交前必须重写成人话**。
3. 推荐结构：`类型：范围/功能，做了什么，解决什么问题`（类型如 修复 / 新增 / 优化 / 重构）。
4. 技术深度放正文，标题保持一眼能懂。

1. Never a bare result phrase such as “optimize performance”, “improve UX”, “enhance maintainability”, “refactor the abstraction layer”.
2. Do not reuse a commit message, plan heading or tool-generated title as-is — **rewrite it before opening the PR**.
3. Recommended shape: `type: scope/feature — what changed, what problem it solves`.
4. Keep the technical depth in the body; the title stays instantly understandable.

### 正反例 / Examples

| 不要 / Don't | 要 / Do |
| --- | --- |
| `refactor: optimize data flow abstraction` | `重构：把订单数据同步逻辑拆成独立模块，方便以后改` |
| `feat: implement idempotent retry mechanism` | `新增：提交失败后自动重试，避免重复创建订单` |
| `perf: improve rendering pipeline` | `优化：减少列表页重复渲染，滚动更流畅` |
| `chore: enhance maintainability` | `整理：拆分工具函数，降低后续修改难度` |

规则原文与更多背景：`CONTRIBUTING.md` 的「PR titles」一节；issue [#323](https://github.com/elysia395/dsh-wallpaper-engine/issues/323) 保持 open，作为给真人用户的视觉提示。

Source of truth and rationale: the “PR titles” section in `CONTRIBUTING.md`; issue [#323](https://github.com/elysia395/dsh-wallpaper-engine/issues/323) is intentionally kept open as a human-facing reminder.
