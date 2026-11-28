# 文档 / 注释审计（2026-11-28，重构后一轮）

> **状态：历史记录。** 本文记录一次针对性审计的**方法与当时的结论**，不反映现行实现；
> 现行口径仍以代码、`docs/CODE-STRUCTURE.md` 与对应 ADR 为准（[ADR-0017](../adr/0017-code-is-truth-docs-reference-source.md) D5）。
> 审计工具是**人工工具、不进 CI 链**：`node test/tools/audit-docs.mjs`。

## 1. 依据

- [ADR-0006](../adr/0006-comment-discipline-as-written-convention.md)：注释/文档纪律是**写作约定**，不配文档类机器守卫；常青文档不写会漂的数值（D2）；机制写在代码旁（D3）；实测出处留在代码旁（D4）；历史文档不追溯（Consequences）。
- [ADR-0007](../adr/0007-machine-checks-target-code-not-prose.md)：判据只针对代码/磁盘/生成物/运行结果。本文的**工具**不是判据 —— 它只打印候选，失败动作是「照建议改」，不是「改回某句话」。
- [ADR-0017](../adr/0017-code-is-truth-docs-reference-source.md)：代码即真相；文档引用源码位置（优先符号，不抄清单/数字）；生成物由生成器复算；账本（CHANGELOG / `changelog/` / `archive/` / `adr/`）不追溯改写。

## 2. 方法

`test/tools/audit-docs.mjs`（只读）扫四类对象并分类：

| 检查 | 对象 | 判据 |
|---|---|---|
| 路径存在性 | 现行文档 + 源码注释 + `packages/*`（含包内相对路径） | 引用的 `src/…`、`lib/…`、`packages/…` 是否在盘上 |
| 相对链接 | Markdown | `](./x.md)` 的目标是否存在 |
| 行号锚 | 现行文档 + 注释 | `file:123` 的文件存在、且行号不超过文件长度 |
| 会漂的数值 | 现行文档 | `N 行 / N 条 / N 个` 这类断言现状的计数 |
| 中英成对 | 用户文档 | `docs/X.md` 与 `docs/en/X.md` 是否成对 |

对象按**寿命**分类，只有前三类会被要求修：

- `current`（`docs/` 根、`docs/en/`、根 README/CONTRIBUTING/AGENTS）—— 发现即缺陷；
- `comment`（`src|lib|packages|scripts` 的注释；构建产物 `lib/client*.js` 除外）—— 发现即缺陷；
- `generated`（`ROUTE-INDEX` / `GUARD-MAP` / `TOKEN-CONTRACT`）—— 报给生成器，本次为 0；
- `ledger`（`CHANGELOG` / `changelog/` / `archive/` / `adr/`）—— **不追溯**，只统计。

## 3. 结论（审计时）

修复后，`current` 与 `comment` 两类**可执行项归零**；剩余条目全部落在账本类：

| 类别 | 可执行项（修前） | 可执行项（修后） | 账本类残留 |
|---|---|---|---|
| 失效路径 | 现行文档 22 · 注释 172 | **0** | 账本类残留（CHANGELOG / archive / adr 的历史地址）—— 数量见工具输出，本文不抄 |
| 断链 | 根文档 2 | **0** | 账本类残留（archive / changelog 内部链接）—— 同上 |
| 行号锚超界 | 0 | **0** | — |
| 会漂的数值 | 根文档 1 | **0** | — |
| 中英不成对 | 0 | **0** | — |

> 修前的计数是**首轮工具输出**（含当时的误报；后续给工具加了截断/占位/外部仓库/包内相对路径等口径，误报清零）。

## 4. 修了什么（按类型）

1. **目录重构后的新地址**：源码与子包注释里的 `src/host-bridge.js`、`src/extension-registry.js`、`src/we-base.js`、
   `src/fontset-store.js`、`src/system-fonts.js`、`src/preset-store.js`、`src/picker-props-panel.js`、
   `src/ext-perf.js`、`src/occlusion.js`、`src/video-layer.js` 等逐条改到 `src/core|extensions|settings|picker|wallpaper/`。
2. **旧文件名**：`src/client/{glass-toggle-handlers,reset-handlers,ui-color-handlers}.js` → 现名
   `settings-toggle-handlers.js` / `reset-and-accent-handlers.js` / `color-handlers.js`（`src/client/handlers/`）。
3. **过时的结构论证**：`CODE-STRUCTURE.md` §3.1 里「为什么不给这些族建目录」整表已失效 —— 改成
   「目录决策（2026-11-28 修订）」并指向 §3.4；§4 的「`src/` 默认平铺」改为「落点先问功能域」；§3.1 的助手清单不再抄成员。
4. **锚到行号改为锚到符号**：`lib/settings-schema.js:1581`、`src/settings/system-fonts.js:1-16`、
   `src/extension-registry.js:139/:194`、`src/ext-perf.js:399/:401` 一类改为「文件名 + 符号/文件头」。
5. **漂移的数值**：`wallpaper-uploads-section.js` 的「71 键」改为「键集真源，数量不抄」；`CONTRIBUTING.md` 不再引用具体行数。
6. **断链**：`CONTRIBUTING.md` 的 `./adr/0013`、`./adr/0014` 改为 `./docs/adr/…`。
7. **历史/外部引用**（不改，工具里逐条写理由）：`lib/components/…` 的迁移对照、`dsh-pet-dshwe` 自带 `assets/…`、
   父仓 `dsh-my-ui/…`、DSH CLI 的 `lib/bin.js`、`scripts/compare-bundle.mjs` 的自检夹具字符串。

## 5. 没有做什么

- **没有加文档类守卫**（ADR-0006/0007）：这是工具不是门禁；谁想复核就手动跑一次。
- **没有改写账本**：`CHANGELOG` / `changelog/` / `archive/` / `adr/` 里的旧路径与旧数字按 ADR-0017 D4 保留原文。
- **没有做「全面重写散文」**：只改**断言现状却已不成立**的句子与失效锚点；叙述风格与历史陈述不动。

## 6. 复算

```bash
node test/tools/audit-docs.mjs          # 人读摘要
node test/tools/audit-docs.mjs --json   # 机器可读（含每条 file:line）
```

工具里有一张**显式豁免表**（`IGNORE`），每条都写明「为什么它不是缺陷」。新增豁免要按 ADR-0007 第 1/2 问写清理由。
