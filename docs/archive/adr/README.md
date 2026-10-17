# 归档：拆分子插件重构的决策档案（只作历史记录）

> **本目录不反映现行实现，也不参与现行决策。**
> 现行唯一版本 = [`docs/adr/0013-bundle-multi-component-rows.md`](../../adr/0013-bundle-multi-component-rows.md)。

## 为什么归档

拆分子插件这条线的目标在 2026-10-13 → 10-14 之间**改口三次**（单一目标 → 软目标 → 三件并列 → 界面级开关），
于是 `docs/adr/` 里出现了**五份互相 Amended / Superseded 的 ADR**：每读一条现行决定都要先顺着修订层走一遍链。
按用户口径（**「改口可追溯链恰恰是噪声」**）做了一次**合并重写**：把全部决策并成一份台账
（**现行 [`0013`](../../adr/0013-bundle-multi-component-rows.md)**；合并当时编号为 0012），
旧件整体下沉到本目录，**不再保留修订层**。

> ⚠️ **读归档件时的编号对照**：本目录正文里出现的 `ADR-0012` / `0012` 一律指**当年的"插件拆分"那一份**
> （合并重写的版本），它现在是 **[ADR-0013](../../adr/0013-bundle-multi-component-rows.md)** ——
> 原编号让位给了上游的 [`0012-artifact-untracking`](../../adr/0012-artifact-untracking.md)。
> 本目录里的 `[0012](./0012-bundle-multi-component-rows.md)` 这类**相对链接指向归档件自身**（旧版正文），
> 也有意保持不动（`adr/0006`：历史文档不追溯）。

## 归档清单（正文逐字未改，只加顶端状态横幅）

| 归档件 | 原身份 | 现行落点 |
|---|---|---|
| [0012](./0012-bundle-multi-component-rows.md) | ADR-0012 **旧版**（2026-10-13 立） | 现行 [`0013`](../../adr/0013-bundle-multi-component-rows.md) 的 D1–D11 · D16 · D17 |
| [0013](./0013-component-toggle-soft-goal-chunks.md) | 「关掉即不下载」的**机制事实**（`require.async` / `client.<name>.js` / 上游先例 / 块必须进 `files`） | 现行 `D16`（不做）＋ 现行 §Context 事实 7；粒度拆分进 `D3①` |
| [0014](./0014-goal-reanchor-and-contract-tightening.md) | 目标重锚：三件核心目标 + A 语义 + P2-7 / P2-8 立项 | `D1` · `D3①` · `D12` · `D14` · `D2` / `D3④` · `D6`–`D11` · `D16` |
| [0015](./0015-component-view-face.md) | 内核对外面分两级（稳定面 ∪ 具名视图面） | `D13`（并见 `D12①`） |
| [0016](./0016-component-toggle-ui-visibility.md) | 行级开关升为**界面级**（本仓最后一次改口） | `D3①`–`D3④` · `D4` · `D16` · `D17` |

每份归档件顶部的横幅里都有**该份逐条的旧编号 → 现行 `D*` 编号**映射；
`docs/CHANGELOG.md` / `docs/en/CHANGELOG.md` 里的历史条目**按账本纪律保持原样**（它们引用的是当时的编号）。
