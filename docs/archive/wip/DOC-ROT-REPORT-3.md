# 第三轮文档 / 注释腐化检查（对抗性复核）

<!-- status-banner: code-is-truth -->
> **状态：历史记录（不反映现行实现）。** 第三轮（对抗性）文档 / 注释腐化复核的过程记录，已收口：
> 它按 Lead 指示改掉的 R1-R4 已随整线 squash 入库；本轮口径与结论见
> [`./TEST-CREDIBILITY-AUDIT.md`](./TEST-CREDIBILITY-AUDIT.md)。

> **基线**：`main` = `cd5deaff`（CI 判绿于 `2d650f5f`，其后只有一笔 TS 收尾）。
> **两个阶段**：① 只读复核（本报告 §0–§4 的全部证据都是这一阶段取的）；
> ② 按 Lead 指示把 R1–R4 改掉 —— **改动留在工作树、未 commit、未 push**（见 §5 的处置表）。
> 口径沿用前两轮，并按本轮要求把五类对抗性检查项（①计数 ②注释承诺 vs 代码 ③已删实体 ④命令类 ⑤生成物）
> 逐项给结论。**宁缺毋滥**：只列有 `file:line` 或命令输出作证据的条目，无法裁决的标 **待验证**。
> 另外按 Lead 要求补记**第六类失效形态**（散文与判据自身口径脱钩 ⇒ 判据恒绿而散文腐烂，见 §6）。

## 0. 范围、口径、豁免

- **扫的面**：活跃文档 = `docs/*.md` + `docs/adr/*.md` + `docs/en/*.md` + 三份根 `README*`；
  代码注释 = `lib/**` + `src/**`（`lib/client.js` 除外）；生成物单独用守卫核查。
- **口径**：token 边界（`\.js(?![A-Za-z0-9])`，避免命中 `verify-chain.json`）；`origin/main:<path>` /
> `d561f5f^:<path>` 是 **git 对象引用**（`git show` 可解析）⇒ 不计死路径、不改；`lib/client.js` 是构建产物
> ⇒ "不在盘上"不算腐化。
- **豁免（不追溯）**：`docs/archive/**`、`docs/CHANGELOG.md`、`docs/en/CHANGELOG.md`、`docs/wip/**`
> （过程记录 / 账本；4 份 wip 头部的「哈希说明」原样保留）。

## 1. 真腐化（有证据；**已按 Lead 指示修好 —— 改动在工作树，未 commit**，处置见 §5）

> **处置口径**：R1/R4 按 ADR-0006 D2 改写成**不写死数字**的"以 X 判据为准"；R2 补名册行；R3 用同源真值改写。
> 下面各条保留的是**复核阶段**的原始证据（行号 = 改前）。

### R1｜[高] `lib/kernel/host-kernel.js` 的内核契约散文仍是 **95 / 88**，真值是 **98 / 91**

- **位置（5 处）**：
  - `lib/kernel/host-kernel.js:20` —— "返回契约（… → 平坦对象，**95** 个字段）"
  - `lib/kernel/host-kernel.js:22` —— "…现算 —— 合计 **95** / 稳定面 ∩ 内核 7 / 内部面 **88**。）"
  - `lib/kernel/host-kernel.js:36` —— "**内部面（internal face，88 项）**"
  - `lib/kernel/host-kernel.js:40` —— "（口径：**95** = 内核产出的 7 项稳定面 + **88** 项内部面…）"
  - `lib/kernel/host-kernel.js:127` —— "（**95** 字段口径）"
- **为何失真**：本期把内核分级面扩到 98，**守卫侧的合同行同步改了，这 5 行散文没改**。
  证据（合同数字的唯一真源 = 守卫自己的文件头那一行）：
  - `test/verify-component-face.mjs:15` = 「合计 98 / 稳定面 15 / 稳定面 ∩ 内核 7 / 内部面 91」；
  - `node test/verify-component-face.mjs` 输出：
    `✓ 锚点：门面导出 hostKernel 对象（缺锚即红） — 98 个键`
    `✓ 内核实跑分级 == 文件头合同数字（合计 / 稳定面 / 稳定面 ∩ 内核 / 内部面 四项全对） — 合计 98 / 稳定面 15 / 稳定面 ∩ 内核 7 / 内部面 91`
  - 反证 95 是**上一期**的数：`docs/archive/wip/TEST-ANCHORING.md:110` 记录"合同数字…**唯一真源 = 文件头那一行**「合计 98 …」"，
    且把旧的 `95/96/89/87` 列为被改造的腐化点；`docs/wip/BUNDLE-SPLIT.md:623` 的"内核仍 **95 键**"是更早的账本。
- **建议 patch**（只改注释，零可执行语句）：`:20` 95→98；`:22` 95→98、88→91；`:36` 88→91；`:40` 95→98、88→91；
  `:127` 95→98。并在 `:22` 那句后补一句"数字的唯一真源 = `test/verify-component-face.mjs` 文件头那一行"
  （否则这里永远是一份会漂的第二副本，[`adr/0006`](../../adr/0006-comment-discipline-as-written-convention.md) D2）。
- **为什么危险**：这是内核**冻结契约**的读者入口，内部面键数错会让"该不该升稳定面"的判断错位；
  而守卫只与自己的文件头对账 ⇒ **散文错了不会红**。

### R2｜[高·当前真实红] `test/tools/repo-face.mjs` 未在 DEV-GUIDE 点名 ⇒ `verify-module-layout` ⑧ 判红

- **位置**：`docs/DEV-GUIDE.md` §4.6 工具名册（`repo-face.mjs` 按字母序应插在 **L363**（`regen-golden.mjs` 行）之后）。
- **证据**：
  - `node test/verify-module-layout.mjs` →
    `✗ 每个 test/tools/*.mjs 与 test/compat-*.mjs 都在 zh 的 DEV-GUIDE 里点名 — 未点名：repo-face.mjs`
    `MODULE LAYOUT CHECKS FAILED — 1 failed`（该组还打印"25 工具 / 3 compat"的覆盖面）
  - `git grep -n repo-face -- docs/DEV-GUIDE.md` = **0 命中**；
  - 工具确实存在且被消费：`test/tools/repo-face.mjs`、`test/verify-settings-schema-exports.mjs:102`
    `import { listFace, gitViewDiff, diffFace } from './tools/repo-face.mjs'`。
- **为何失真**：`5d555af1` 新增了它（"脏扫描面 ⇒ 假绿"的修法），但只写进 `docs/archive/wip/TEST-ANCHORING.md` §11/§12（账本），
  没进**活跃**的 §4.6 名册 ⇒ ⑧ 直接判红。
- **该红在 CI 判绿的那一笔也在**（所以它不是本轮引入的）：
  `git show 2d650f5f:docs/DEV-GUIDE.md | Select-String repo-face` ⇒ 0 命中；`git cat-file -e 2d650f5f:test/tools/repo-face.mjs` ⇒ 成功。
  它是 **soft 档**（runner 经 `test/warn-only.mjs` 起）⇒ 不阻断 CI，但结论是"当前有 1 条软档红"。
- **建议 patch**（§4.6 插一行）：
  `| \`repo-face.mjs\` | **仓库扫描面的唯一口径**：以仓库根 / \`lib\` / \`src\` 为面，但**嵌套仓库与 \`.gitignore\` 名单一律不扫**，并与 \`git ls-files\` 独立对账（防"仓库里还有另一份副本 ⇒ 本机假绿"）。被 \`verify-settings-schema-exports\` 等消费 | 守卫 \`import\` 消费，无 CLI |`
  另外 `docs/DEV-GUIDE.md:375` 那句"**同时是守卫的库**"的名册按同一口径应加上 `repo-face.mjs`（它是被守卫 import 的口径库）。

### R3｜[中] `docs/DEV-GUIDE.md:460` 的判据计数与实测不符

- **旧陈述**："另加地板、死路径、`all` = 四段有序拼接三组派生判据，**共 14 条 + 8 条负对照**。"
- **实测**：`node test/verify-guard-chain.mjs` 的 `✓` 行 = **14** 条，其中 `✓ 负对照` = **8** 条
  （命令：`node test/verify-guard-chain.mjs 2>&1 | Select-String '✓'` 计数 = 14；`| Select-String '✓ *负对照'` = 8）。
  ⇒ 总数是 **14（含 8 条负对照）**，写成"14 条 + 8 条"会被读成 22 条。
- **建议 patch**：`共 14 条（其中 8 条是负对照）`。

### R4｜[中·**待验证**] `lib/settings-schema.js:1917` 的"（132 键之一）"是否该是 133

- **位置**：`lib/settings-schema.js:1206`（"…恰好等于「所有页签的并集」（**132 键**）"）与
  `lib/settings-schema.js:1917`（"它仍属宿主持久白名单（**132 键之一**）"，指 `settingsVersion` = meta 键）。
- **守卫自报**：`node test/verify-settings-namespaces.mjs` →
  `✓ ① 宿主持久键无一遗漏 / 无一重复登记 … — 133 键：core:28 appearance:54 mascot:12 fx:14 parallax:11 typeColor:9 media:4 + meta 1`
- **分析**：组件簇合计 28+54+12+14+11+9+4 = **132**，加 `meta` 1 = **133**；而 `:1917` 说的 `settingsVersion`
  正是 **meta** 那一个 ⇒ 按守卫口径它是第 133 个键，原文写"132 键之一"。
- **两种读法（我不下判）**：
  (a) 作者指的是"132 个组件簇宿主键**之外**的 meta 键" ⇒ 文字应改成"宿主白名单 133 键里的 meta 那一个"；
  (b) 白名单真值就是 132、`meta` 由守卫另算 ⇒ 那 `:1917` 与守卫 ① 的口径需要显式对齐。
- **已按 Lead 指示处置（未提交）**：不猜意图、也**不把 132 改成 133** —— `lib/settings-schema.js:1917-1918` 改成
  "它仍属宿主持久白名单，所以对账时要算进 `meta`（**白名单键数由 `test/verify-settings-namespaces.mjs` 现算 —— 此处不抄数字**）"。
  **原口径差 1 的来源仍待作者确认**（组件簇 132 + meta 1 = 133；原文说 meta 是"132 键之一"）——
  确认后若要保留数字，应只保留在守卫那一侧，散文继续用指针。
- 同文件 `:1206` 的"（132 键）"**未动**：那句讲的是"模块并集 == 页签并集"，很可能正是**不含 meta 的 132**
  （`verify-settings-namespaces` 的分簇明细 `core:28 appearance:54 mascot:12 fx:14 parallax:11 typeColor:9 media:4` 相加 = 132），
  属同一处待确认口径，不擅自改。

## 2. 建议（**不是腐化**，只是读者会遇到"无处可查"）

- **S1**：`docs/DEV-GUIDE.md` §4.9（L516-543）有"`include` 边界"表，但**没有 ignores 清单**；
  本期新增了一条**全局 ignore** `.integration-notes/**`（`eslint.config.mjs:83-86`，理由在其 `:79-82`：
  忽略它会把本机 lint 面从 ~260 撑到 ~1470 ⇒ 本机读数与 CI 不一致；同一族的"脏扫描面"由 `repo-face.mjs`
  的 git 视角口径解决，细节在 `docs/archive/wip/TEST-ANCHORING.md` §12）。
  → 建议在 §4.9 加**一行指针**（不含数字），说明"本机与 CI 的面差异来自 ignores，真源 = `eslint.config.mjs`"。
  本轮**未**把它列为腐化：现有句子没有说错，缺的是新增事实的落点。

## 3. 未改 / 待验证清单

| 项 | 处置 | 理由 |
|---|---|---|
| `docs/wip/BUNDLE-SPLIT.md:623`（"内核仍 **95 键**"）、`docs/archive/wip/TEST-ANCHORING.md:110` | **未改** | wip 账本，且二者恰好互为佐证：95 = 上一期、98 = 本期 ⇒ 反过来证明 R1 是真腐化 |
| `docs/README.md:156` / `docs/en/README.md:183` 的 "`test/` 的 72 个 `.mjs`（顶层 57 + `test/tools/` 15）" | **未改（待你裁决）** | 那是**归档审计件当时的规模**（实测现状：`test/*.mjs` 顶层 85、`test/tools/` 25），属账本引用；若要活跃索引与真源严格一致，建议改成"当时的规模（真源 = 该归档件自身）" |
| R4 的 132 / 133 | **待验证** | 需要该段作者确认意图，见 §1 R4 |
| `docs/archive/**`、两份 `CHANGELOG`、`docs/wip/**` 的旧路径与旧数字 | **未改** | ADR-0006「历史文档不追溯」 |
| `docs/ARCHITECTURE-SPLIT.md:91,93,167` 的 `lib/we-discovery.js` / `lib/cache-prune.js` / `lib/asset-paths.js` | **未改** | 都是**显式的历史指称**（"P0 的合并版…已删"、"~~…~~ 已收口"），不是指向现址的路径陈述 |

## 4. 我确认**没有腐化**的维度（含命令与依据）

1. **死路径** —— 活跃文档 29 命中 = `CHANGELOG.md` 25（豁免）+ `ARCHITECTURE-SPLIT.md` 3（显式"已删/已收口"）+
   `DEV-GUIDE.md:166` `src/your-module.js`（占位示例）⇒ **0 真腐化**。
   `lib/src` 注释 11 命中同属已知类：`host-kernel.js:164,217`、`upload-dir.js:5,6`（"上游那份同名副本已删"）、
   `we-assets.js:47` 与 `routes/we-assets.js:36,60` 的 `src/local-assets.ts`（**上游 WebWallGL 渲染器仓**的端点契约）、
   `src/font/components.js:62-75`（**宿主 UI 包**的 CSS 编译名）。
2. **生成物与文档一致（第 ⑤ 项）** —— `node test/verify-route-index.mjs` / `verify-guard-map.mjs` /
   `verify-token-contract.mjs` / `verify-guard-chain.mjs` 全 `PASSED`；`docs/GUARD-MAP.md:8`（147 模块 / 81 守卫）
   与守卫自报一致；`ARCHITECTURE-SPLIT.md:159,160` 的"0 不可达 / 0 行""例外表 1 条"分别被
   `verify-reachability`（ALL PASSED）与 `verify-guard-map`（"1 个零覆盖，全部已登记"）证实；
   `docs/ROUTE-INDEX.md` 表体 43 行与生成器一致。
3. **命令类陈述（第 ④ 项）** —— 活跃文档抽出 **46 条** distinct 命令：`node test/**` 目标文件与
   `npm run <script>` **全部存在**（package.json 实测）；命令后的**每个 `--flag` 都在目标文件里出现**（0 不匹配）。
   ⚠️ 唯一"缺脚本"是我提取正则的假阳性：`npm run verify:e` 实为 `verify:e2e`（正则 `[a-z:]+` 不吃数字），该脚本存在。
4. **注释承诺 vs 代码（第 ② 项）** —— `lib/**`+`src/**` 注释点名的守卫 **37 个全部存在**；
   本期两处口径变更的注释与实现一致：`test/tools/repo-face.mjs` 文件头（"唯一口径 = git 视角 + `git ls-files` 独立对账"）
   ↔ `test/verify-settings-schema-exports.mjs:18,102` 真这么 import 使用；`eslint.config.mjs:79-82` 的 ignore 理由
   与 `verify-static` 的 `filesLinted` 地板（`DEV-GUIDE.md:526`）方向一致。
5. **已删实体（第 ③ 项）** —— 本期去掉的导出 `markComponent{Loaded,Started,Failed}`（host-boot）、
   `PROTOCOL_VERSION` / `SPECTRUM_INTERVAL_MS` / `IDLE_STOP_MS` / `BANDS`（supervisor）、
   `MP4_VFS_MAX_MOOV_BYTES`（mp4-vfs）、`UPLOAD_FILE_RE`（模块级）在**活跃文档里 0 处**声称它们是导出/公共面。
   `host-boot.js:69` 那句"本 Set 只被 `markComponentLoaded()` 写、被探针读"在去 export 后**仍成立**
   （三者现为模块内函数，Set 仍导出 ⇒ 探针可读）。
6. **计数（第 ① 项，逐条实测）** —— 链步数 `--list` 实测 verify **58** / docs **7** / smoke **6** / all **72**
   （活跃文档不写死，只指 `test/run-guards.mjs`）；例外表 **1 条**；reachability **0/0**；
   `FONTSET_KEYS` = **7** ↔ `adr/0011-preset-full-snapshot.md:89`"（7 键）"；
   `src/styles-base.js` 的 U+3000 = **13** ↔ `DEV-GUIDE.md:566`"13 个"；
   §4.6 工具面实测 **25 tools + 3 compat**（该节不写总数，逐行点名 ⇒ 无写死风险）。
7. **ADR 自指指针** —— `adr/0013` 的"触发线第 5 条""非目标第 3 条"等自指在本轮抽查中未发现断链。

## 5. 处置（按 Lead 指示修好；**改动留在工作树，未 commit / 未 push**）

| 条 | 动了哪些文件:行 | 改法 | 验证 |
|---|---|---|---|
| R2（真实红） | `docs/DEV-GUIDE.md` §4.6 新增 `repo-face.mjs` 行（行文依据该工具**自己的文件头**：嵌套仓库不扫 / `DEFAULT_SKIP` 名单不扫 / `git ls-files` 独立对账 / `allowedExtra` 逐条说明）+ L375 的"同时是守卫的库"名册补 `repo-face.mjs` | 补名册（不改判据） | `node test/verify-module-layout.mjs` → `✓ …都在 zh 的 DEV-GUIDE 里点名 — 28 个都被点名` + `ALL MODULE LAYOUT CHECKS PASSED`，**exit 0** |
| R1 | `lib/kernel/host-kernel.js:20,22,24,36,40,127`（**纯注释**） | 去掉 5 处易腐数字（95/88/15 项），改成"口径与实测由 `test/verify-component-face.mjs` ① 现算，**只有那条判据的文件头持有合同数字**" | `git diff -U0 -- lib/kernel/host-kernel.js` 全部落在 `/** */` 内 |
| R3 | `docs/DEV-GUIDE.md` L461（原 460） | "共 14 条 + 8 条负对照" → "**共 14 条判据，其中 8 条是负对照**（条数由该守卫的 `✓` / `✓ 负对照` 行现报）" | 同源真值 = `verify-guard-chain` 的 ✓ 计数 14 / `✓ 负对照` 8 |
| R4 | `lib/settings-schema.js:1917-1918`（**纯注释**） | 去掉"（132 键之一）"，改成"仍属宿主持白名单…（键数由 `test/verify-settings-namespaces.mjs` 现算 —— 此处不抄数字）"；`:1206` 的"（132 键）"未动（属同一处待作者确认口径） | `git diff -U0 -- lib/settings-schema.js` 全在注释内 |

**总验证**：`node test/run-guards.mjs all` → `✓ all 全部 72 步执行完毕`，**exit 0**；
软档降级标记 **0 条**（`原退出码` 出现 0 次）、硬档 `✗` **0 条**；
`git status --short` = 只含 `docs/DEV-GUIDE.md`、`lib/kernel/host-kernel.js`、`lib/settings-schema.js` + 本报告。

## 6. 第六类失效形态：散文与判据自身口径脱钩 ⇒ 判据恒绿而散文腐烂

- **现象（本例）**：`lib/kernel/host-kernel.js` 的内核返回契约散文写着"95 个字段 / 内部面 88"，
  而合同真值早已是 **98 / 稳定面 15 / 稳定面 ∩ 内核 7 / 内部面 91**。
  更关键的是：**判据（`test/verify-component-face.mjs` ①）自己就是绿的** —— 它按设计只与**自己文件头那一行**
  对账（`test/verify-component-face.mjs:13-15`、`:93`"合同数字**唯一真源** = 本文件头那一行（缺锚即红）"），
  于是"实现 ↔ 判据文件头"永远一致，而**第三份副本**（内核文件头的散文）没有任何机器在看。
- **为什么现有网抓不到**：
  ① 这类数字**不是**"写的数值要复算"型（ADR-0006 §D2 针对的是散文里的数值——它靠**约定**，无守卫，本 ADR 自己承认）；
  ② 唯一会读它们的判据把真源**内定在自己身上**（这是对的：合同必须单点），代价是**任何别处的拷贝都失去覆盖**；
  ③ 守卫的失败信号是"实跑 ≠ 合同行"，而散文不参与这条等式 ⇒ 散文腐烂**不可能**让它变红；
  ④ 死路径类扫描也抓不到（路径是对的，只是数字旧了）。
- **可复算命令**（把"散文 vs 合同"的差异显式打出来，本仓现状 = 0 命中）：
  ```sh
  node test/verify-component-face.mjs                       # 合同：合计 98 / 稳定面 15 / 稳定面 ∩ 内核 7 / 内部面 91
  git grep -nE '9[0-9] (个字段|字段口径)|合计 [0-9]+ / 稳定面' -- lib src   # 散文里是否还有第二份合同数字
  ```
- **写法纪律（本轮按它改的）**：
  1. **数字只许住在判据那一侧**：合同/门槛/基线这类会被判据点名的数字，**唯一真源 = 那条判据的文件头**（本仓既有形态）；
     实现文件的散文一律写"**以 X 判据的口径为准**"，不复制数字。
  2. 判据若需要"人可读的契约摘要"，用**符号**（`KERNEL_STABLE_FACE`、`COMPONENT_VIEW_KEYS`、`INLINE_MODULES`）或**复算命令**，
     不写"合计 N"。
  3. **升级既有散文时先问"这里是不是第二次抄"**：是 ⇒ 删数字留指针；无法判断意图 ⇒ 标 **待验证**、别猜（本轮 R4 就是照这条处置的）。
  4. 这类腐化**不该配新判据**（[`adr/0007`](../../adr/0007-machine-checks-target-code-not-prose.md) 四问：判定对象是措辞 ⇒ 不加），
     该做的是把数字**移出散文**——让"没有第二份拷贝"这件事由结构保证，而不是由一条判据去盯句子。

## 7. 本轮动作与复算入口

- **动作**：阶段①只读（全部 `git grep` / `git show` / `node test/...`；死路径扫描是一次性内联 PowerShell，不入库）；
  阶段②只改散文/注释（4 条处置见 §5），**未 commit、未 push**、未改任何可执行语句。
- **关键复算命令**：
  ```sh
  node test/run-guards.mjs verify --list        # 58
  node test/run-guards.mjs docs   --list        # 7
  node test/run-guards.mjs all    --list        # 72
  node test/verify-component-face.mjs           # 合同 98 / 15 / 7 / 91
  node test/verify-module-layout.mjs            # 处置后 exit 0（28 个都被点名）
  node test/verify-guard-chain.mjs              # ✓ 14 条（含 8 条负对照）
  node test/verify-settings-namespaces.mjs      # 宿主持久键 133（132 + meta）
  node test/verify-reachability.mjs             # ALL PASSED（0/0）
  ```
