# ADR —— 架构决策记录

> **本文回答一件事**：当初为什么这么选、代价是什么、后来有没有被推翻。
> **不回答**"现在代码怎么写" —— 那是源码注释的职责（本仓的成文纪律：能写在代码旁的规则不单写文档）。

## 什么该写成 ADR

只写**取舍**：有备选方案、有人付了代价、后来的人可能想推翻的那个决定。

| 该写 | 不该写 |
|---|---|
| 「为什么用 A 而不是 B」 | 「A 怎么实现的」（→ 文件头注释） |
| 「我们为此放弃了什么」 | 用法步骤（→ 开发指南） |
| 「什么情况下该重新考虑」 | 配置项清单（→ `lib/settings-schema.js`） |
| 被**取代/修订**的旧决定 | 任何现状数字（→ 见下「不写数值」） |

判据：**如果这段内容在实现重写后依然成立，它就是 ADR；如果会随代码一起变，它属于代码注释。**

## 不写数值

ADR 里**不写会随代码漂移的具体数值**（条数、行数、体积、耗时、默认值、阈值）。

理由：这些数字的真源在代码里（设置 → `lib/settings-schema.js`，路由 → `docs/ROUTE-INDEX.md` 由生成器复算）。
抄进 ADR 就多一个没人复算的副本 —— 本仓已有的实测教训是：**被机器守着的数字没漂，没被守的全漂了**
（见 `CHANGELOG` 与各文件头注释）。需要读者知道量级时，给**复算方式**而不是数字。

**例外**：ADR 头部的 `Date` 是决策发生的时间点，属账本性质、不描述现状，**保留**。

## 头部格式

```
# ADR-NNNN: 标题（中英）

- **Date**: YYYY-MM-DD          ← 决策日，不随代码漂
- **Status**: Accepted | Superseded by ADR-NNNN | Amended by ADR-NNNN | Rejected
- **Deciders**: <谁拍的>
- **Supersedes / Amends**: 相关 ADR（没有就删掉这一行）
```

`Status` 只有一条纪律：**决定被推翻时不要改写旧 ADR**，把它的 `Status` 改成 `Superseded by ADR-NNNN`，
然后新写一份说明为什么推翻。旧 ADR 的正文保持原样 —— 它是历史，改它就等于伪造决策记录。

## 正文骨架

```markdown
## Context      处境与约束（可测事实 + 证据锚点：符号名 / 文件路径，不写行号）
## Decision     选了什么（编号列 D1 / D2…，便于别处引用单条）
## Consequences 代价与收益；明确写出"我们放弃了什么"
## 重新考虑的触发线   什么条件下该回来推翻它
```

## 索引

| ADR | 决定 | 状态 |
|---|---|---|
| [0001](./0001-webwallgl-in-tree-live-renderer.md) | 用内嵌 WebWallGL 实时渲染场景壁纸，而不是转码或依赖 WE 在后台跑 | Accepted |
| [0002](./0002-settings-schema-single-source.md) | 设置的唯一真源收进一个共享文件，两端派生 | Accepted |
| [0003](./0003-build-time-module-inlining.md) | 浏览器半边拆分靠构建期内联，不用运行时模块 | Accepted |
| [0004](./0004-two-tier-guard-verification.md) | 守卫按"失败的含义"分硬/软两档 | Accepted |
| [0005](./0005-media-loopback-origin.md) | 媒体由宿主自建的独立 loopback 源提供 | Accepted |
| [0006](./0006-comment-discipline-as-written-convention.md) | 注释与文档纪律改为纯写作约定，撤掉文档类机器守卫 | Accepted |
| [0007](./0007-machine-checks-target-code-not-prose.md) | 机器判据只针对代码与磁盘，不针对散文（给出四问判定程序 + 保留/撤除清单） | Accepted |
| [0008](./0008-glass-config-two-state.md) | 玻璃配置收成"每面两态 + 一把刻度 + 门控分两类"；放弃按面变量间接层与"关即回原生纯色" | Accepted |
