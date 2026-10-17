# 测试系统可信度审计（对抗性）—— A 可见性 / B 假绿 / C 有效性 / D 必要性

<!-- status-banner: code-is-truth -->
> **状态：历史记录（不反映现行实现）。** 第二期 task-8 的对抗性审计（A 可见性 / B 假绿 / C 有效性 / D 必要性），
> 已收口：它点名「脱链」的 4 条判据已回到守卫链上，修复落地账见 §附录 R，
> 判据锚定见 [`./TEST-ANCHORING.md`](./TEST-ANCHORING.md)。
> ⚠️ 文末**待验证清单**（只能由 CI / 完整工具链验的项）**仍未在本机复核**，读它按「未经核对的记录」对待。

> **审计对象**：分支 `main`、HEAD `cd5deaff`（`fix(类型): 清掉 IDE 面板最后 3 处 TS 报错…`）。
> 所有读数锚定 **HEAD 的干净副本**（`git archive HEAD | tar -x -C .test-cache/audit`，409 个文件），
> 因为会话期间**其他队友在并发改同一棵工作树**（会话结束时 `git status` = `M docs/DEV-GUIDE.md`、
> `M lib/kernel/host-kernel.js`、`M lib/settings-schema.js`，另有未跟踪 `docs/archive/wip/DOC-ROT-REPORT-3.md`）。
> 凡涉及"当前工作树"的读数，文中**逐条标注**是「HEAD 副本」还是「工作树」。
>
> **本审计未修改任何被跟踪文件、未 commit / push / reset / rebase / amend。**
> 全部写操作只在 `.test-cache/**`（gitignored）：副本树、探针脚本、日志。
>
> **口径**：未运行 = 未验证；未覆盖 = 未知，不是通过；绿色 ≠ 正确。每条结论附 file:line / 命令 / 输出；
> 拿不到证据的一律写「**待验证**」并说明只能由谁验证。

---

## 0. 执行摘要（按严重度，10 条）

| # | 结论 | 一句话证据 |
|---|---|---|
| **S1** | **HEAD 上有一条判据是红的，而 `npm run verify:all` 与 CI 都是绿的** —— docs 档 7 条**全部软档**（经 `warn-only` 降级）+ CI 该步再叠一层 `continue-on-error`。实测 `verify-module-layout.mjs` 在 HEAD 副本里 `exit 1`，在同一棵工作树（队友刚补了文档）里 `exit 0`。 | `verify-all.log` 步 [60/72] 打出 `[warn-only] 软档守卫原退出码 = 1`；HEAD 副本 `node test/verify-module-layout.mjs` → `✗ …未点名：repo-face.mjs` / `exit 1`；`.github/workflows/verify.yml:107-109` |
| **S2** | **4 条强判据静默脱链**（`verify-inject-contracts` / `verify-component-face` / `verify-route-ownership` / `verify-settings-namespaces`）+ `js-text selftest`：本分支侧 47 步的 `&&` 链里有（`3ed09abb`），「追版本」合并（`c43a9361`）整条取了上游链 ⇒ 静默消失。而链的"防削空"地板只有 **24 硬档**（实测 57）⇒ **删掉 33 步仍全绿**。 | 集合差 + `git show 3ed09abb/c43a9361:package.json`（见 §A2）；`floor-probe.mjs` 输出"删尾部 33 步 ⇒ floorDiff=通过"；`test/tools/guard-chain.mjs:34` |
| **S3** | **CI 的 media-bridge 闸门接线在 HEAD 上丢了**：`verify:bridge` 与 `verify:bridge:strict` **两条脚本逐字相同**、都指向 raw 自检；`test/verify-bridge-ci.mjs`（140 行 fail-closed 包装器）**无任何入口**。CI 注释描述的"降级/严格"行为与实现不符。**与 S2 同一笔合并（`c43a9361`）同一根因。** | `package.json:130-131`；`git show 3ed09abb/c43a9361:package.json`；`DSH_VERIFY_BRIDGE_CHILD` 全仓只有 `verify-bridge-ci.mjs` 自己引用 |
| **S4** | **"无尾随空白"这条格式守卫是空的**：`git diff --check` 只看**未提交的 diff**，而 CI 全程不写任何被跟踪文件 ⇒ 恒空。实测 HEAD 上仍有 **2 处被跟踪文件带行尾空白**而 CI 绿；`.editorconfig` 却把它列为"真正的格式守卫"之一。 | `.github/workflows/verify.yml:124-125`、`.editorconfig:5-7`、`test/verify-client.mjs:3982`、`test/verify-theme-layer.mjs:513` |
| **S5** | **边界型常量的"死带"**：`GPU_FRAME_AREA_TOL` 只被两个**远离边界**的用例夹住（0.64 与 0.974）。反证实验：把常量 `0.05 → 0.30`（面积守卫强度弱化 **6 倍**）后，`verify-scene-frame-master.mjs` 仍 **18/18 绿、exit 0**。 | `test/verify-scene-frame-master.mjs:272-286`；`lib/kernel/host-kernel.js:93`；`lib/routes/scene-frame.js:250`；实验输出见 §B4 |
| **S6** | **golden 夹具 `client` 侧是一条 18 用例的死数据**：把它全部改坏（`blur→999`/`scrim→0.99`）后 `verify-client` 与 `verify-glass-surfaces` **双绿**，只有人工工具 `regen-golden` 报"提示、不计入退出码"。 | `test/fixtures/settings-sanitize-golden.json:2`（自述）、`test/verify-client.mjs:3774`、`test/tools/regen-golden.mjs:12-14,105`；实验见 §B3 |
| **S7** | **静默回落实例**：`verify-client-sync.mjs` 的「产物不入库」在 `git` 调用**因任何原因抛错**时都打印"不在 git 工作树里"并跳过（不计数、不影响红绿），而文件头写的是"判据两条，缺一不可"。本机实测命中（沙箱 EPERM）。 | `test/verify-client-sync.mjs:9,122-135`；日志步 [2] 的 `⚠ 不在 git 工作树里…` |
| **S8** | **判据矩阵里有 1 行逐字重复，而真正能区分分支顺序的那组输入缺失**：`envOnly=true + trustOk=true + probeVerdict='regression'` 实测返回 `environment/3`（不是 `regression/1`）。当前生产路径不可达（仅有潜在风险），但"四判词映射"这条判据的判别力比它宣称的窄。 | `test/verify-media-bridge.mjs:612-621`（:615 与 :619 同输入）、`:598-607`、`:473-486`；实验见 §B5 |
| **S9** | **工具自检大面积脱链**：`js-text(37 条)`、`i18n-scan`、`weT-shim`、`harness-compat-baseline(9 条)`、`audit-guard-teeth` 自检、`verify-inject-contracts` 内建 selftest **无任何门禁调用**。唯一在门上的是 `source-locator --selftest`（经**软档** `verify-guard-map` ⑥e）。 | `git grep selftest` 的调用点只有 `test/verify-guard-map.mjs:29,344`；其余 5 处只在各自文件的 CLI 分支里 |
| **S10** | **两个脚本与一个 workflow 从未被任何门禁碰过**：`scripts/occlusion-probe.mjs`、`scripts/harness-compat-baseline.mjs`（判据 0 命中）；`harness-compat.yml` **只有 `workflow_dispatch`**，其 3 个 compat 测试 + `verify:all` 在 push/PR 上不跑。 | 模块面（`guard-targets.moduleSurface`）只枚举 `src/**`+`lib/**`；`git grep -l occlusion-probe -- test` 为空；`.github/workflows/harness-compat.yml:12-13` |

**正面结论（同样有证据，避免"只报坏消息"）**：全仓 **没有** `|| true` / `allow_failure`（唯一 `continue-on-error` 就是 S1 那一处）；**没有** `.only/.skip/todo/pending`；`verify-token-contract`、`verify-windows-caption`、`verify-guard-map` ⑥b/⑥c/⑥d 这三处的"负对照调同一份判据函数"是**真牙**（逐条读过并抽测）；147 个模块里 **146 个有直读判据**，唯一零覆盖的 `lib/components/mascot-avatar/index.js` 在册且有理由。

---

## A 可见性

### A1 docs 档 7 条全软 + CI 再叠 `continue-on-error` ⇒ 一条红判据在 CI 里**结构上不可见**

**结论**：`verify:docs` 这一档（7 条判据）在任何路径上都无法让 CI 变红：组内每条 `tier: 'soft'` ⇒ 经 `test/warn-only.mjs` 降级退出 0；CI 该步又显式 `continue-on-error: true`。于是"红"只以一行 `[warn-only] 软档守卫原退出码 = 1` 出现在几千行日志中间，**没有 annotation、没有 step summary、没有任何聚合计数**。

**证据**
- `test/run-guards.mjs:160-170`：`DOCS_STEPS` = 7 条，全部 `step(..., 'soft')`。
- `test/run-guards.mjs:311-319`：`tier !== 'soft'` 才短路，"否则打印警告继续"。
- `test/warn-only.mjs:72-77`：非 0 退出码降级为警告，本入口 `process.exit(0)`。
- `.github/workflows/verify.yml:107-109`：`continue-on-error: true`。
- 实测（HEAD 干净副本）：`node test/verify-module-layout.mjs` → `✗ 每个 test/tools/*.mjs 与 test/compat-*.mjs 都在 zh 的 DEV-GUIDE 里点名 — 未点名：repo-face.mjs` / `MODULE LAYOUT CHECKS FAILED — 1 failed` / `exit 1`（见 §C1）。
- 实测（同一次 `verify:all`，工作树为 HEAD 时）：`[60/72] …` 后只有一行 `[warn-only] 软档守卫原退出码 = 1`；全链 `✓ all 全部 72 步执行完毕`、`exit 0`。
- `node test/run-guards.mjs all` 的 72 步构成：`verify` 58（硬 57 / 软 1）、`docs` 7（硬 0 / 软 7）、`smoke` 6（硬 6）、`build` 1 —— 命令与解析见附录 P1。

**反证实验**（证明红是真的、且被环境差异排除）
1. HEAD 干净副本（`git archive HEAD`）：`exit 1`。
2. 同一份文件在**当前工作树**：`exit 0`（因为队友 `docs-comment-sync` 恰好补了 `repo-face.mjs` 的文档行，见 `git diff docs/DEV-GUIDE.md`）。
⇒ 差异来源是**文档内容**、不是沙箱；即 HEAD（CI 判绿那一个 commit）上这条判据确实是红的。

**建议**：① 软档红的可见性至少做到"点名 + 聚合"，例如 `run-guards` 在组尾打印 `⚠ 软档 N 条红：<文件:原码>` 并对 CI 发 `::warning::`（一行/条），或在 CI 加 `$GITHUB_STEP_SUMMARY` 汇总；② 不要靠 `continue-on-error` 当"第二道保险"——它让 `warn-only` 自身的红（包装被改坏）也静默；③ 若认为"仓库内务"该拦住 PR，把该条升 `hard`，若认为不该，就要**有人真的会看到**（否则等于删掉）。
**风险**：加 annotation 会让 CI 出现警告噪声（当前 docs 档历史上可能常年有 1–2 条红），需同时定"软档红的上限/期限"。

### A2 4 条强判据**静默脱链**，而链的自检结构上看不见"少了一条"

**结论**：`test/run-guards.mjs` 的 MANIFEST（链的唯一真源）**不含** `verify-inject-contracts` / `verify-component-face` / `verify-route-ownership` / `verify-settings-namespaces`，也不含曾经在链末的 `test/tools/js-text.mjs selftest`。这 4 条判据（在 `docs/archive/wip/TEST-ANCHORING.md` §2.2–2.5 里逐条有"正判据 + 变异体/负对照"记录）在 HEAD 上仍存在、单跑 `exit 0`，但**已不在 PR 门禁上**。`verify-bundle-rows` 的脱链是**有意且已记档**的（`TEST-ANCHORING.md` §8.3），另外 4 条 + js-text selftest 在文档里找不到任何"脱链理由"。

**证据**
- 集合差（旧 `&&` 链 = `git show ddcbe4c0^:package.json` 的 `scripts.verify`，46 步；新链 = `node test/run-guards.mjs verify --list-json`，58 步）：

```
在旧链、不在新链：
  node test/verify-inject-contracts.mjs
  node test/verify-component-face.mjs
  node test/verify-settings-namespaces.mjs
  node test/verify-bundle-rows.mjs          ← 已记档的有意脱链（TEST-ANCHORING §8.3）
  node test/verify-route-ownership.mjs
  node test/tools/js-text.mjs selftest
在新链、不在旧链：18 条（D3 可见面 / occlusion / scene-probe / … 等新增）
```
- **丢失点已定位到具体提交**（可复算）：
  ```
  $ git show 3ed09abb:package.json   # 追版本合并 c43a9361 的第一父（本分支侧）
    steps=47 · verify-inject-contracts/component-face/route-ownership/settings-namespaces/js-text selftest ⇒ true（全在）
  $ git show c43a9361:package.json   # merge(追版本 轮1)：以上游下版本为基并入 123 笔
    "verify": "node test/run-guards.mjs verify"     ← 整条链取了上游那一侧
  $ git show ded5ef63^:package.json  # 收口 runner 那笔的父：那 6 条已经全 false
  ```
  ⇒ **合并时 package.json 取了上游的链，本地这 4 条判据 + js-text selftest 静默脱链，随后 `ded5ef63` 把缩短后的链冻成 fixture 的"新常态"。全程没有任何判据报警**（因为"链上该有谁"这个命题当时就不存在）。
- `test/run-guards.mjs:98-100` 的注释**自己写着这一类有多贵**："D3 判据此前**不在链里**，于是…它红了近 30 轮却没人跑到（守卫链的短路特性会让"链外的强判据"变成摆设）"。**同类失效在本轮重构里又发生了 4 次。**
- `test/verify-guard-chain.mjs:19-23` 的四条判据里，"防清单削空"只有 `② 每组硬档条数 ≥ 地板`。
- `test/tools/guard-chain.mjs:34`：`TIER_FLOOR = { verify: 24, docs: 0, smoke: 5, all: 29 }`。
- 单跑这 4 条（HEAD 副本，`exit 0`）：`ALL COMPONENT FACE CHECKS PASSED` / `ALL INJECT CONTRACT CHECKS PASSED (22/22 families, 207 声明键)` / `ALL ROUTE OWNERSHIP CHECKS PASSED (M10 = 0)` / `ALL SETTINGS NAMESPACE CHECKS PASSED` ⇒ **当前没有藏红**，失去的是"以后不再有这层保护"。
- `verify-guard-map.mjs` 只在 **⑤ 元守卫表** 里登记它们（`:103-104`）——那是"这条守卫不针对某个模块"的登记，**不是**"在链上"的登记。

**反证实验**（地板能拦住多少）
```
node .test-cache/audit/floor-probe.mjs
实测 verify 硬档步数 = 57  · 地板 = 24
删掉尾部  0 步 ⇒ 硬档 57 · floorDiff=通过（判据沉默）
删掉尾部 10 步 ⇒ 硬档 47 · floorDiff=通过（判据沉默）
删掉尾部 20 步 ⇒ 硬档 37 · floorDiff=通过（判据沉默）
删掉尾部 30 步 ⇒ 硬档 27 · floorDiff=通过（判据沉默）
删掉尾部 33 步 ⇒ 硬档 24 · floorDiff=通过（判据沉默）
删掉尾部 34 步 ⇒ 硬档 23 · floorDiff=报红 verify 硬档 23 条 < 地板 24 条
```
即：**58% 的硬档判据可以在机器全绿的前提下消失**（只要顺手跑一次 `--write-fixture`，见 B7）。`verify-package-files.mjs:286` 的 `CHAIN_FLOOR` 同样是 `{verify:24, docs:1, smoke:5, all:29}`，注释（`:284`）却声称"地板 = 本轮实测步数（删或改名即判红）" —— **声明与实现不符**（本轮实测是 58/7/6/72）。

**建议**
1. **把地板换成"具名白名单派生"**：新增一条判据——"磁盘上每个 `test/verify-*.mjs`、每个 `test/*-smoke.mjs` 必须**要么在链上**（按 `--list-json` 的 file 集合判），**要么在一张逐条有理由的 `OFF_CHAIN_WHY` 表里**（表只许缩小）。这正好是 `verify-guard-map.mjs` 的 `ZERO_COVERAGE_WHY` 形态，机制现成、成本低。
2. 同时把 `CHAIN_FLOOR` 改成"上一版链的步数下界"（或干脆用第 1 条的派生判据替代计数地板），否则注释里承诺的"删或改名即判红"永远不成立。
**删掉会失去什么**：若不加这条，下一次"把守卫挪出链"仍会全绿——已实测发生过 4 次。
**风险**：派生判据会把 `verify-bundle-rows`（有意脱链，理由=P5 零裸依赖冲突）拉红一次，需要在那张 `OFF_CHAIN_WHY` 里写下现成的理由（`TEST-ANCHORING.md` §8.3 已有原文可抄）。

### A3 CI 的 media-bridge 闸门：文档里是 fail-closed 包装器，实现里是 raw 自检

**结论**：`.github/workflows/verify.yml:88-97` 的注释完整描述了"由 `test/verify-bridge-ci.mjs` 按判词定红绿、只有 `码3 + verdict=environment` 降级为 `::warning::`、其余 fail-closed、严格口径用 `verify:bridge:strict`"。但 `package.json` 里 `verify:bridge` 与 `verify:bridge:strict` **都是** `node test/verify-media-bridge.mjs --provision`；包装器 `test/verify-bridge-ci.mjs` **没有任何调用点**。

**证据**
- `package.json:130-131`（逐字相同）：
  `"verify:bridge": "node test/verify-media-bridge.mjs --provision"` / `"verify:bridge:strict": "node test/verify-media-bridge.mjs --provision"`。
- **丢失点已定位**（与 §A2 是**同一笔合并、同一个根因**）：
  ```
  $ git show 3ed09abb:package.json          # 追版本合并 c43a9361 的第一父（本分支侧）
    verify:bridge        = "node test/verify-bridge-ci.mjs --provision"     ← 曾经指向包装器
    (test/verify-bridge-ci.mjs 在该 commit 就存在)
  $ git show c43a9361:package.json          # merge(追版本 轮1)
    verify:bridge        = "node test/verify-media-bridge.mjs --provision"
    verify:bridge:strict = "node test/verify-media-bridge.mjs --provision"  ← 两条都成了 raw 自检
  $ git show ddcbe4c0 -- package.json       # 该分支上的原始接线（原 commit 的意图）
    -"verify:bridge": "node test/verify-media-bridge.mjs --provision"
    +"verify:bridge": "node test/verify-bridge-ci.mjs --provision"
    +"verify:bridge:strict": "node test/verify-media-bridge.mjs --provision"
  ```
  ⇒ **合并取上游的 `package.json` 时，包装器接线与 §A2 那 4 条判据一起消失了；`test/verify-bridge-ci.mjs` 文件本身被保留下来，成为谁都不调用的孤儿。**
- `git grep -n "verify:bridge"` 的全部命中里，除 `package.json` 与注释外没有别处校验脚本内容；`test/verify-package-publish.mjs:292-298` 只把 `verify:bridge` / `verify:bridge:strict` 当作**脚本名**放进 `DEV_ONLY`（判"引用未随包文件"），**不校验它指向谁**。
- `test/verify-guard-map.mjs:105` 把 `verify-bridge-ci.mjs` 登记为"元守卫：管的是 CI 桥接面（工作流/脚本接线）"——但**没有任何判据在执行这句话**（它能"管"谁？它自己都不在链上）。
- `DSH_VERIFY_BRIDGE_CHILD`（包装器的负对照钩子）全仓只有 `test/verify-bridge-ci.mjs:30,39`；commit 正文声称的"**17 条 fail-closed 矩阵**"没有落成任何可重跑的判据。

**影响（分级）**
- 现在：CI 上 media-bridge 若判"环境差异"（`exit 3`），这一步会**红**（而不是按注释降级成 warning）⇒ 是**文档/实现不一致**，不是假绿；`verify:bridge:strict` 这个名字承诺的"三种结局都非 0"也**不成立**（它就是默认口径）。
- 一旦有人按注释把 `verify:bridge` 指回包装器，§B5 的 `resolveOutcome` 分支顺序问题就会**变成 live**（探针判 regression 也可能被降级为 environment ⇒ 在 CI 里变成"跳过"）。

**建议**：① 修复接线（`verify:bridge → test/verify-bridge-ci.mjs --provision`，`verify:bridge:strict → test/verify-media-bridge.mjs --provision`），并在 `verify-package-files.mjs` P5 的形态判据里**加一条**："`verify:bridge` 必须指向 `test/verify-bridge-ci.mjs`"（形态判据已有 `shapeError` 现成实现，扩展一行）；② 把包装器的 fail-closed 矩阵落成**常驻判据**（`DSH_VERIFY_BRIDGE_CHILD` 已备好注入点，用一个假子进程即可，不需要网络）；③ 若暂时不修，就把 `verify:bridge:strict` 删掉或改注释——现在它是个**名字骗人的重复脚本**。
**风险**：修接线会让 CI 在 runner 抖动时出现 `::warning::` 跳过（这正是该 commit 的初衷），需接受"environment 跳过会掩盖真回归"的残余风险（由 §B5 的建议补齐）。

### A4 条件跳过 / 平台限制 / env 开关：本机与 CI 各有多少步不跑

**本机（实测，`verify-all.log`，工作树=HEAD 的那个时点）**：72 步里

| 不跑的东西 | 位置 | 性质 |
|---|---|---|
| **整步** `verify-media-bridge`（58 步里的 1 条软档） | 步 [18/72] | `SKIP test/verify-media-bridge.mjs —— 本环境起不了子进程（带管道（协议通道））`（`warn-only.mjs:39-53` 的 `--probe-spawn` 探针命中） |
| `verify-scene` 1 条 | 步 [8] | `132 passed, 0 failed, 1 platform-skipped`（POSIX chmod 那半，win32 走不到） |
| `verify-scene-live` 1 条 | 步 [10] | `○ SKIP …文件链接 ⇒ 403 —— 本机不允许创建文件符号链接` |
| `verify-cache-prune` 2 条 | 步 [36] | `SKIP D6（目录 size 过小）` + `SKIP D11/D12（建不出软链）` |
| `verify-system-fonts` 1 条 | 步 [46] | `环境跳过：本进程所在的环境禁止建管道 stdio（spawn EPERM）` |
| `verify-steam-discovery` 2 条 | 步 [53] | linux/WSL 路径 + `STEAM_PROBE_TTL_MS` 过期路径 |
| `verify-client-sync` 1 条 | 步 [2] | 见 §S7（静默跳过，**连 `○` 行都没有**） |
| `verify-settings-schema-exports` 1 条自检 | 步 [59] | `✓ 自检：扫描面 == git 视角 — SKIP：取不到 git 视角（fatal:EPERM）`（**计成 ✓**，靠括号里的文字说明才看得出没跑） |

⇒ **本机：1 个整步 + 7 条具名环境/平台跳过 + 2 条"跳过但计入通过/只打一行文字"的项**。这些跳过的形态总体是**好**的（`warn-only.mjs`、`cache-prune`、`steam-discovery`、`system-fonts`、`component-fonts` 都明确写"这不是通过"），只有 `verify-client-sync` 与 `verify-settings-schema-exports` 两处是"跳过与通过同形"的残余。

**CI（本机无法复现，标「待验证」）**：`verify.yml` 双平台矩阵 + `--provision`。可推断的差异：`verify-media-bridge` 的 `--provision` 步骤会**真跑**；`ubuntu` 腿会补上 win32 走不到的那半（POSIX chmod / 软链 / linux 路径），而 `windows` 腿补上 ubuntu 走不到的那半；`verify-static` 只在 CI 真跑（本机 EPERM，见 §待验证）。**具体每条腿有多少 skip，需要 CI 原始日志——本机没有。**

> **顺手核到一处"注释里的实测数字已过时"**（说明 CI 注释不能当证据直接引用）：`.github/workflows/verify.yml:33` 写"本仓实测：**win32 上 5 条 platform-skipped**"；HEAD 上在本机（win32）实跑 `node test/verify-scene.mjs` = `132 passed, 0 failed, **1 platform-skipped**`；`git grep` 显示 `verify-scene.mjs` 现在只有 **1 个** `platformSkip()` 调用点（`:483`）。数字不是判据，但"平台矩阵非跑两条腿不可"的论证正是引它做证据的 ⇒ 论证的**当前**强度只剩 1 条。

### A5 "生成物 / 报告是否被合并或掩盖"

- 三份**生成物**都有逐字节对账判据，且都在链上（`docs/GUARD-MAP.md` → `verify-guard-map` ②【软档】；`docs/ROUTE-INDEX.md` → `verify-route-index`【硬档】；`docs/TOKEN-CONTRACT.md` → `verify-token-contract`【硬档】）。**这是本仓最扎实的一层**。
- 但 `docs/GUARD-MAP.md` 的对账是**软档**：`--write` 重算后即可全绿（无"只许缩小"约束），而它恰好是"哪个模块被哪条判据读"的**唯一地图**——地图烂掉不会拦 PR。
- 报告类文件（`docs/wip/*.md`、`docs/archive/**`）**没有任何机检**；本次审计报告同样不入库（按要求）。
- `verify-contracts.mjs:364-448` 会读 `.github/workflows/*.yml`（平台矩阵 + 工作流级表达式作用域），但**不校验 CI 每一步的 `run:` 指向的脚本存在/接线正确**（A3 就是这一层的缺口）。

### A6 SKIP 的形态统计（`skip/xfail/todo/only/ignore/pending`）

| 形态 | 数量 | 证据 |
|---|---|---|
| `.only(` / `.skip(` / `xit(` / `xdescribe` | **0** | `git grep -E "\.only\(|\.skip\(|xit\(|xdescribe"` 零命中 |
| `test.skip` / `todo` / `pending`（框架级） | **0** | 全仓自研 runner，无框架级 skip 概念 |
| `|| true` / `allow_failure` | **0** | `git grep` 仅在注释里命中 |
| `continue-on-error` | **1** | `.github/workflows/verify.yml:108`（docs 档） |
| 具名 `SKIP`/环境跳过（代码） | 48 个文件命中 `SKIP`/`跳过` 字样（含大量"用例名里的跳过"如"整拍跳过""跳过该钩子"），**真正的"本次不跑"出口**集中在：`warn-only.mjs`(2 处)、`verify-media-bridge`(`--allow-skip`)、`verify-static`(工具缺失 SKIP)、`compat-harness-pages`(`--allow-skip`)、`cache-prune`(D6/D11-D12)、`steam-discovery`(2)、`system-fonts`(1)、`scene-live`(1)、`client-sync`(1) | `grep -c SKIP test/**/*.mjs` 明细见附录 P8 |
| `--allow-skip` 出现点 | `verify-media-bridge.mjs:67,93,343,651,656`、`compat-harness-pages.mjs:63,222-244`、`test/run-guards.mjs:115`（媒体桥那一步）、`test/fixtures/verify-chain.json` | 链上唯一带 `--allow-skip` 的是媒体桥（软档），CI 另有 `--provision` 步骤补跑 |

---

## B 可信度（假绿）

> 本节全部结论都做了**反证实验**（改坏实现 / 强制失败 / 删断言 / 变常量 / 空输入），实验在 `.test-cache/audit/`（HEAD 的 `git archive` 副本）里做，**不动被跟踪文件**。

### B1 一条判据红而 CI 绿（最重的假绿形态）

见 §S1 / §C1。**机制**：软档降级 ×2（组内 `warn-only` + CI `continue-on-error`）⇒ "红"只剩日志里一行。**实验**：HEAD 副本 exit 1 / 工作树 exit 0（同一 commit 的内容差异只有文档那一行）。**这是"绿色 ≠ 正确"的直接实例，而且正在被 CI 判绿。**

### B2 链条"防削空"地板远低于实测（可删 33/57 硬档步）

见 §A2 的实验输出。**为什么它是假绿**：`verify-guard-chain` 的四条判据里，① 只防"与 fixture 不一致"、② 地板 24、③ 只防死路径、④ 只防 `all` 被改短 —— **没有一条**防"某条具名判据从链上消失"。fixture 是**快照**（`--write-fixture` 一跑就跟上），地板是**计数**。**实验**：`floorDiff` 对"删尾部 33 步"判通过。

### B3 golden 夹具 `client` 侧：18 用例的值没有任何判据

**证据（自述 + 代码）**
- `test/fixtures/settings-sanitize-golden.json:2`（note 原文）："**client 侧的值没有任何判据比对**：verify-client ④ 在活值上钉住 client == host，verify-glass-surfaces ⑥ 只用键集 ⇒ client 值与当前 schema 的差异是**提示**、不是失败。"
- `test/verify-client.mjs:3770-3794`：③ 只 `for (const c of golden.cases)` 比 `sanitizeFromSchema(c.input,'host')` vs `c.host`。
- `test/tools/regen-golden.mjs:101-120`：client 侧漂移只打印，`process.exit(hostDrift ? 1 : 0)`。
- `test/verify-glass-surfaces.mjs:820-899`：⑥ 只做 `keyGaps`（键集逐用例自洽）。

**反证实验**（HEAD 副本，实测逐字输出）
```
# 只改 client 侧：18 个用例 blur=999 / scrim=0.99（host 侧未动）
node -e "...if(c.client) { c.client.blur=999; c.client.scrim=0.99 }..."
  → 只改 client 侧：18 个用例 blur=999/scrim=0.99（host 侧未动）
  → host blur 取值： 16,60        ← 未动
  → client blur 取值： 999         ← 全坏
node test/verify-client.mjs          → ALL CLIENT CHECKS DONE      exit=0  ★ 假绿
node test/verify-glass-surfaces.mjs  → ALL GLASS SURFACE CHECKS PASSED exit=0  ★ 假绿
node test/tools/regen-golden.mjs     → client …：2 个键漂移 · ⇒ host 侧零漂移   exit=0（人工工具，不是门）
```
**结论**：夹具里 client 侧是**结构性死数据**（见 §D1）。**它现在与当前实现零漂移**（`regen-golden` 报 host/client 均无漂移），所以这不是"有 bug"，而是"这一半数据不承重、却要人维护"。

### B4 边界型常量存在"死带"（`GPU_FRAME_AREA_TOL`）

**被测不变量**（用户侧后果明确）：宿主 `PUT /scene-frame-cache` 的面积守卫——"小帧覆盖不掉大帧"，防多窗口/多视口互相把主帧降级（`test/verify-scene-frame-master.mjs:11-17` 记录了历史缺陷：60s 一轮永不收敛）。

**判据的夹点**：`test/verify-scene-frame-master.mjs`
- 4. 640×480 = 307,200 < 480,000 × 0.95 ⇒ 期望 **409**
- 5. 790×592 = 467,680 ≥ 480,000 × 0.95 ⇒ 期望 **200**
两点的面积比是 **0.64** 与 **0.974**，而阈值是 **0.95**（=`1-0.05`）。⇒ 判据只约束了"阈值落在 (0.64, 0.974) 区间内"，**没有一条用例逼近 0.95**。

**反证实验**（HEAD 副本，逐字输出）
```
mutation landed: 0.05 -> 0.30（面积守卫强度 6x 弱化）   [.test-cache/audit/lib/kernel/host-kernel.js:93]
node .test-cache/audit/test/verify-scene-frame-master.mjs
  ✓ 10b. 有签名无像素数据（<1KB/缺 IDAT）→ 415 — status=415
  MASTER FRAME PASSED (18 checks)     exit=0     ★ 假绿
```
守卫被弱化成"只有小于主帧 70% 才拒写"（用户侧后果：把窗口缩到 75% 就会把大主帧覆盖掉，历史缺陷回归），**判据全绿**。
**旁证**：`test/verify-scene.mjs:400-401` 的另一条面积守卫判据用的是同一族"明显更小"输入（同样不逼近边界）；`git grep` 全仓**没有任何判据读 `GPU_FRAME_AREA_TOL` 的数值**（只有 `verify-scene-frame-master.mjs:182` 的 `src.includes('GPU_FRAME_AREA_TOL')` 与 `verify-client.mjs:3241` 的符号存在性文本断言）。

**建议**：加**边界对**用例（阈值用真常量现算，不写 0.95）：`面积 = 0.96×主帧 ⇒ 200`、`面积 = 0.94×主帧 ⇒ 409`；并加"把 `GPU_FRAME_AREA_TOL` 变异成 0.30 ⇒ 该判据判红"的自证（同 `verify-token-contract` 的形态）。**删掉会失去什么**：没有它，面积守卫的"强度"是完全自由的（只被两个远点夹在 0.64–0.974 区间里）。

### B5 media-bridge 判词矩阵：1 行重复 + 1 组该覆盖的输入缺失

**证据**：`test/verify-media-bridge.mjs:612-621` 的 6 行合成输入里 **:615 与 :619 逐字相同**（`{failedCount:1, envOnly:true, probeVerdict:'environment', trustOk:true, blockedCount:0, allowSkip:false}` ⇒ 期望 `environment/3`）。矩阵**没有**覆盖"`envOnly` 与 `trustOk` 都成立、但探针判 `regression`"这一组——而它正是能区分 `:603`（envOnly 判据在前）与 `:605`（probeVerdict 判据在后）**顺序**的那组。

**反证实验**（逐字抽出 `resolveOutcome`，不重写实现；`.test-cache/audit/resolve-outcome-probe.mjs`）
```
码 0 全过                                        ⇒ verdict=ok code=0
环境差异（探针也说 environment）                  ⇒ verdict=environment code=3
★ 矩阵里没有的那组：envOnly=true + trustOk=true，但探针判 regression
                                                 ⇒ verdict=environment code=3    ← 应为 regression/1
真回归                                           ⇒ verdict=regression code=1
```
**当前是否可达**：**不可达** —— `channelSkipped` 只在 `:479-486` 的"探针**不是** regression 且产物可信"分支里被赋值（`:473` 先挡掉了 regression）。所以这是一个**潜在**漏洞（顺序耦合），不是现行假绿。
**建议**：把重复的那一行换成缺的那组输入，并写明期望（`regression/1`）——这样一改就把 `:603/:605` 的顺序钉死；若坚持"envOnly 优先"，那也要在判据里**显式**写出来（当前是把一个语义决定交给了两条 `if` 的相对顺序）。**删/改会失去什么**：不动的风险是"将来为了让别的用例好写而把 `channelSkipped` 赋值的分支重构走"时，fail-closed 会静默失效，而矩阵看不出来。

### B6 `verify-client-sync` 的「产物不入库」可被任何 `git` 故障静默跳过

**证据**：`test/verify-client-sync.mjs:122-135`
```js
const tracked = (() => { try { … execFileSync('git', ['ls-files', …], { encoding:'utf8' }) … }
                         catch { return null; } })();
if (tracked === null) { console.log('  ⚠ 不在 git 工作树里，跳过「产物不入库」判据（发布 tarball 场景）'); }
```
`catch` 是**无条件**的：缺 git 二进制 / 沙箱禁管道（本机 EPERM）/ 仓库损坏 / pathspec 写错，全都落到"发布 tarball 场景"这一句话上，且 **`passed`/`failed` 都不动**（`exit 0`）。文件头 `:9` 写的是"**判据两条，缺一不可**"。本机实测命中（日志步 [2]）。
**缓解**：CI 有等价步骤（`verify.yml:114-122` 用 `git ls-files` 判"产物不入库"），所以 CI 覆盖面还在；本机/受限环境这一条等于没有，且**看不出是环境还是真判据**。
**建议**：把 `tracked === null` 分成两类——"`git ls-files` 退出 0 但输出空"与"命令跑不起来"；后者按 `SKIP`（具名、且**计入一个"未执行"计数**，并在结尾打印 `CLIENT SYNC CHECKS PASSED (5, 1 not executed)`），或至少把 `exit 0` 改成只在"发布 tarball 场景"（可用 `existsSync(root+'/.git')` 判）才降级。**风险**：改严后本机会红/跳，需要在 CI 与干净检出上复验一次。

### B7 两个"无门"的重冻结通道（能一次性把红洗成绿）

| 通道 | 门 | 后果 |
|---|---|---|
| `node test/verify-guard-chain.mjs --write-fixture` | **无**（只是"显式动作"） | 链的任何改动（含删 33 步）都能被它冻成"新常态"；`verify-guard-chain` ① 随即全绿 |
| `node test/verify-static.mjs --write-baseline` | **无**（`verify-static.mjs:127,154-164` 直接按当前读数写盘，**可以调高**上限、**可以调低** `filesLinted`） | ESLint/tsc 棘轮可以一键放宽；基线与代码在同一提交里，无第二判据约束"基线只许变小" |
| `node test/tools/regen-golden.mjs --write --intend …` | **有**（`:66-68` 无 `--intend` 拒绝写入；`:123-131` 除声明键外有漂移即拒绝） | **这是本仓做得对的一处**，其余两处应对齐它 |
| `node test/tools/guard-targets.mjs --write` / `host-route-index.mjs --write` / `token-contract.mjs --write` | **无**（但生成物受逐字节对账，改动在 diff 里可见） | 可接受：生成物变化本身就是可见的 |

**建议**：给前两条加"意图声明"形态（`--write-fixture --intend <理由>` / `--write-baseline --intend <规则名>`，无声明即拒绝），或至少加一条判据："基线文件相对上一版**只许变小**"（用 `git show HEAD:<file>` 对账，实现成本低）。
**风险**：`--write-baseline` 目前是"改善后收紧"的正常路径，加门会影响日常操作——建议只对"变差"（新增规则 / 计数上升 / `filesLinted` 下降）设门。

### B8 其余假绿形态的普查结果（含正面结论）

| 形态 | 结论 | 证据 |
|---|---|---|
| 吞异常 | **44 个** `test/verify-*.mjs` 里共 **186 处**空/短 `catch` 块（`catch {}` / `catch { /* ignore */ }`），抽测的都是**收尾清理**（`rmSync` 清理、`close`、`kill`）且发生在主判据之后；**未发现**"把断言包在 try 里吞掉"。**例外**是 §B6 那一处（跳过整条判据） | `git grep -c -E 'catch\s*(\{[^}]*\}\|\([^)]*\)\s*\{\s*\})' -- 'test/verify-*.mjs'` → 44 文件 / 186 处；逐条抽测 `verify-media-bridge`/`verify-package-files`/`verify-client-sync` |
| 空集参数化 / 循环零次 | 抽查 8 条守卫均有"面板非空 / `passed≥地板` / 双向对账"防空转（`verify-scene-probe` 地板 15 实测 22；`verify-component-fonts` 地板 75 实测 77；6 条 smoke 的 `fontset-load-smoke` 结尾按 `failures` 计数） | 日志中 `覆盖面` / `地板` 行；`verify-media-bridge.mjs:634`、`fontset-load-smoke.mjs:684` |
| 恒真断言 | 3 处 `check(..., true, ...)`，逐条读过：`verify-settings-schema-exports.mjs:373`（自检分支里"跳过也计 ✓"——**是 B6 同族问题**，但同一行文字已写明 SKIP）、`compat-harness-live/pages.mjs:275/281`（"启动并输出 token URL"：前一行已 `assert(tokenHit)`，这条是记账，不是判据） | 逐条读原文 |
| 快照自动更新 | 见 B7 | — |
| 重试掩盖 flaky | 无测试级重试；唯一的"重试"是被测实现的重试（`media-bridge supervisor` 换姿势），且判据按**结局**分派（`judgeBootRetry`，TEST-ANCHORING §12.4 已修过 off-by-one） | `TEST-ANCHORING.md:526-552`；`verify-media-bridge.mjs:496-514` |
| 固定时间 / 随机 / 网络 / 顺序依赖 | 时间：多处 `await sleep(150)` + 预算（`media-bridge` 有 90s 引导预算、`smoke` 有 15–22s 预算，实测 `rotation-prepared-leak-smoke` 日志里出现 `liveFail · reason=timeout`，属夹具内正常路径）；随机：`Math.random()` 全仓 4 处——`rotation-prepared-leak-smoke.mjs:315`（**把 `Math.random` 桩掉**成可控序列）、`test/tools/child-out.mjs:25`（临时文件名）、`verify-presets.mjs:784,820`（注释 + 生成戳长度上界）；**没有"判据依赖随机取值"的形态**；网络：只在**非链**的 `compat-*` / `e2e-*` / `verify:bridge --provision` 那条（见 A4）；顺序：链序有依赖（`run-guards.mjs:90-92` 已写明"顺序=执行顺序，不得重排"），且 `verify-client-sync` 会重建产物供后续读 | `git grep -n 'Math\.random()'` 全 4 处已逐条读；`git grep -E "Date.now|setTimeout"` 在 `test/verify-*.mjs` 汇总 122 行 |
| 覆盖面地板过松 | `verify-guard-map` ③：模块 ≥40 / 守卫 ≥20（实测 147 / 81）；`verify-package-files` P5 `CHAIN_FLOOR`（见 B2）；`verify-static` 面地板 225（实测本机 265 / CI ~260） | 见 §D/§A 各条 |

---

## C 有效性（深挖个案 ≥5，含"最没判别力"的一条）

### C1 `verify-module-layout.mjs`（同时也是 S1 的当事者）——**本轮最没判别力的判据段，且它已经红了**

- **它保护什么**：⑧ 段（`:568-601`）"手动工具与适配层必须在 `docs/DEV-GUIDE.md` 里点名（不许有'没人知道的工具'）"。它读的是**文档文本里是否出现文件名**（`judge(doc, files) = files.filter(f => !doc.includes(f.replace('.mjs','')))`），判的是"枚举面完整性"，**措辞与内容完全不管**。
- **它当前的判别力**：HEAD 上 `✗ …未点名：repo-face.mjs`。这条**判据本身是有效的**（它抓到了真实问题：新工具没进文档），但它**对用户侧后果说不出任何东西**（既非真机行为、也非发布面、也非平台契约）——这正是它被放进软档的理由（ADR-0004），却也因此**在 CI 结构上不可见**（A1）。
- **失效形态**：`judge` 用 `doc.includes(文件名 stem)` 做子串匹配 ⇒
  ① 文档里只要**任何地方**出现 `repo-face`（哪怕在一句"这个工具已删除"的说明里）就算"点名"；
  ② 反向：把工具改名成更短的词（如 `face.mjs`）时，绝大多数文档都会"命中"（`includes` 不做词边界）——**假绿方向未被任何负对照覆盖**（`:600-602` 只有"合成未点名"与"已点名不算"两个方向，没有"子串误命中"方向）。
- **反证实验**：在副本里把 `docs/DEV-GUIDE.md` 里 `repo-face.mjs` 的那一行删掉 ⇒ 判据红（已由 HEAD 实测）；把 `repo-face` 改成只出现在一句否定句里 ⇒ 判据仍绿（可推证 `includes` 语义；**未跑**，标「待验证」，见待验证清单）。
- **建议**：① 升 hard 或至少让软档红可见（A1）；② 补负对照"工具名只出现在否定句/超串里仍算点名吗"——要么加词边界（`` `name.mjs` `` 反引号匹配），要么在注释里承认这是有意宽松。**删掉会失去什么**：新工具无人知道怎么跑（这是它当初存在的理由：实测 9 个工具里只有 1 个被点名）。

### C2 `verify-scene-frame-master.mjs`——行为面扎实，但边界不钉（见 §B4）

- **它保护什么**：多窗口同时实时渲染同一张壁纸时"主帧被小帧覆盖"的历史缺陷（60s 一轮永不收敛）。**这是用户可见的**（画面互相清写/降级）。
- **它做对的部分**：真 `apply()` + mock webServer + 真 PUT/HEAD/GET 字节流；`token` 取不到时**走 `else` 分支判红**（`:330-333`），不是静默跳过；有"等面积覆盖放行"与"小帧拒写"的正负两面。
- **它的判别力缺口**：面积阈值边界（B4，实测常量弱化 6 倍仍 18/18 绿）；`ar === 1.3333` 写死了 4 位小数的舍入（实现若改舍入位数会假红、而非判出真问题）；两处结构锚（`:181-184`）只查**符号名在场**，不查数值/表达式（`GPU_FRAME_AREA_TOL` 被声明成什么都能过）。
- **建议**：补边界对 + 常量变异自证（同 B4）；把 `ar` 断言改成"与 PNG 头现算出的比值一致（容差内）"。

### C3 `verify-client-sync.mjs`——"两条缺一不可"里有一条能整条消失（见 §B6）

- **它保护什么**：① 产物新鲜度（`src/**` 改了忘 `build` ⇒ 后面所有"读产物"的浏览器侧判据会在**旧代码**上全绿——这是本仓最危险的一类假绿，判据文本自己也点明了）；② 产物不入库。
- **做对的部分**：① 用"先读内存 → 跑构建 → 逐字节比 → 写回"的方式做到了"守卫不改工作树"；`stdio:'ignore'` + `timeout` 绕开沙箱管道限制并给构建加界；LF 归一化有正/负对照且**走同一个 `staleByLf`**（`:76,102,113-116`）。这是全仓"负对照长在主判据上"的样板之一。
- **缺口**：② 的静默跳过（B6）。另外 ② 的**负对照**（`:144` "本守卫自身被列出"）也在同一个 `else` 分支里 ⇒ 环境异常时**连负对照一起消失**，"判据有没有牙"这条元判据也随之不可见。
- **建议**：见 B6；把负对照移出 `else`（负对照只需要 git 能列出**一条确定被跟踪的路径**，可直接用 `readFileSync` 前的 `existsSync` 或 `git ls-files` 的替代口径）。

### C4 `verify-media-bridge.mjs` 的判词矩阵（见 §B5）

- **它保护什么**：把"环境跑不动"与"中间件回归"分开（CI 上"产物 sha256 正确、进程活着、hello 不回"与"协议回归"表现完全一样，而处置相反）。
- **做对的部分**：判词只出现一次（`:637-643`）、环境跳过**仍然计一条 ✗**（`:625-629` "跳过不与通过同形"）、覆盖面地板 21 条与产物无关恒在（`:634`）、`resolveOutcome` 是纯函数且生产与合成输入共用。
- **缺口**：矩阵 1 行重复 + 缺最能区分顺序的那组（B5）；`probeVerdict` 在 `envOnly` 成立时**不被读取**（顺序耦合）。
- **建议**：见 B5。

### C5 `verify-guard-chain.mjs`——快照棘轮：**只防漂、不防缩**（见 §A2 / §B2）

- **它保护什么**：链的形状（成员/顺序/档位/参数）→ "把某条守卫从链里删掉"必须是**可见动作**。它的文件头（`:14-17`）明确写出这正是它要补的洞。
- **判别力实测**：① 逐条一致：**有牙**（负对照 4 条走同一 `chainDiff`，实测扰动 fixture 都被判出）；② 地板：**基本无牙**（24 vs 57，删 33 步仍绿）；③ 死路径：有牙；④ `all` 组合：有牙。
- **结构性局限**：它比较的是"**当前链** vs **冻结的当前链**"，没有"上一版链"或"应有判据集合"这一参照 ⇒ fixture 一重冻结，缩水即成为新常态。
- **建议**：见 A2 的"具名白名单派生"。**这是本轮性价比最高的一处加固**（改动小、修的是已经发生过的失效类）。

### C6 `verify-token-contract.mjs`——正面对照：设计良好的判据长什么样

- ① 生成物逐字节对账（防漏重算）；**②b 独立人工锚点表**（`:91-142`，明确"不抄工具结果"，来源逐条写在 `why` 里）；③ 封闭白名单（新增无门控改写即红）；④ 解析口径 4 条规则各有负对照；⑤ 口径完整性（模板外不许出现 `--dsw-`）；⑥ 门控计数自洽 + **探针必须穿过主判据真正用的解析器**（`:245-271` 的注释记录了"拿全文本第一个 `(N)` 下手会落空"的踩坑）。
- 可供其他判据抄的两点：**"期望值不与被测对象同源"**（人工锚点表）与 **"探针要穿过主判据的解析器"**。

### C7 `verify-windows-caption.mjs`——复核结论：无逐条输出，但**结构上不可能空转**

- 它读 `lib/client.js` 的 `setWallpaperActive` 切片 + 真 DOM 桩，断言"激活门 / 插件自有唤醒标记 / 幂等 / 宿主主题改动不干扰"，并有 Control A（普通浏览器无唤醒标记）与 **Control B（源码变异：属性名加 `-typo` ⇒ 门判据必须判红）**（`:81-89`）。
- 风险点：**没有 `check` 计数、没有地板**，失败只以异常抛出（输出仅 `WINDOWS CAPTION SYNC CHECKS PASSED`）⇒ 在 `verify-all` 日志里它显示 `✓=0`（我的统计脚本对它的读数是 0），**评审者无法从日志看出它跑了几条**。但所有 `assert` 都在模块顶层无条件执行，删掉任一 `assert` 会立刻暴露在 diff 里，不属于"零次执行"类。
- **建议**（低优先级）：加一行 `console.log('checks=' + N)` 或统一到 `check()` 口径，便于日志审计。

---

## D 必要性（逐条：处置 + 删掉会失去什么）

### D1 `test/fixtures/settings-sanitize-golden.json` 的 `client` 侧 —— **重写或降级为"提示字段"**

- **现状**：18 个用例的 `client` 对象（与 host 同量级的键，`blur`/`scrim`/…）+ 零判据读值（§B3 实测）。
- **处置**：**重写为"双向棘轮"**（首选）——`verify-client.mjs` ③ 的循环改成两侧各比一次（host 已有"期望值不许与被测对象同源"的意图门 `--intend`，client 侧同用即可，成本约 5 行）；若认为 client 值已被 ④（活值 client==host）间接钉住，则**降级**：把 `client` 字段从夹具里移除，`regen-golden` 的 client 段改成"从活值现算报告"。
- **删掉会失去什么**：只失去"人跑 `regen-golden` 时的一行提示"（且该提示目前**从不计入退出码**，实际上没人会被它拦住）。**不会**失去任何门禁保护。
- **风险**：低。若选"重写"，要注意 client 侧键集与 host **不同**（`verify-glass-surfaces.mjs:831-834` 记录：`glassFidelity`/`chatGlassFidelity`/`themeFollow` 只在 host 侧；`rotationInterval`/`sceneFrameUrl` 只在非对象输入的 client 侧）⇒ 两侧循环必须各自独立判定，不能共用同一份期望。

### D2 `package.json` 的 `verify:bridge:strict` —— **删除或重新定义**

- **现状**：与 `verify:bridge` **逐字相同**（`:130-131`），而注释/包装器都把它当"三种结局都非 0 的严格口径"。
- **处置**：按 A3 修接线（`verify:bridge` → 包装器；`verify:bridge:strict` → raw 自检，即恢复 `ddcbe4c0` 的形态）。
- **删掉会失去什么**：若直接删 `verify:bridge:strict`，会失去"环境跳过时仍想看到非 0 的入口"（`docs/DEV-GUIDE.md` 与 `verify-bridge-ci.mjs:122` 都点名了它）。所以**建议修、不建议删**；只有在决定"不再有 environment 降级"时才可删。

### D3 `test/verify-media-bridge.mjs:612-621` 的重复矩阵行 —— **重写为缺失的那组**

- **现状**：第 2 行与第 6 行逐字相同（零新增判别力）；缺 `envOnly+trustOk+probeVerdict=regression`。
- **处置**：删一行、补一行（见 B5）。
- **删掉会失去什么**：失去"重复计数"本身没有价值；**补上**则获得对 `:603/:605` 顺序的锚定 ⇒ 净收益。

### D4 `test/tools/js-text.mjs selftest`（37 条）—— **接回链上**

- **现状**：旧 `&&` 链的最后一步就是 `node test/tools/js-text.mjs selftest`；MANIFEST 里没有（§A2）。它是**43 个守卫共用的 `stripComments` 等工具**的自检。
- **处置**：接回 `verify`（硬档）或 `docs`（软档）——注意它**不引入裸包依赖**（只 import `node:`），不会撞 P5；接回后需 `--write-fixture` 并写明理由。
- **删掉会失去什么**：37 条"朴素实现会吃掉真代码"的反面对照（本仓把"朴素块注释正则"列为**已实测**的失效类：`audit-guard-teeth.mjs:175-179`、`verify-i18n.mjs:224-226`），以及"共享工具被改坏"的第一道拦网。

### D5 `test/repro-sidebar-props.mjs` —— **保留但降级为具名工具（或接回链上）**

- **现状**：不在 MANIFEST、无 npm 脚本、CI 不跑；实测 `exit 0`、`0.14s`（很快）。它守的是 `verify-scene-live` **看不见**的一类（作用域错误：`renderUserPropsPanel` 曾是 `apply()` 里的闭包 ⇒ 真机整页空白，而替身台全绿 —— `test/repro-sidebar-props.mjs:5-12`）。
- **处置**：**接回 `smoke` 组**（它读 `lib/client.js`，链上首步 `verify-client-sync` 已保证产物新鲜，成本 0.14s）——这比"删"更符合"这条通道只有它看得见"的自我陈述；若不愿接链，至少把它登记进 `docs/DEV-GUIDE.md` 的手动工具表（它现在**已被** `module-layout` ⑧ 覆盖：`compat-*`/`test/tools/*` 之外的文件不在那张表的对账面里，所以严格说它连"被点名"都不要求）。
- **删掉会失去什么**：唯一一条"真产物 + 真 slots 注册链 + 真点击"的作用域面判据（`verify-scene-live` 会把自由变量替身化）。
- **风险**：接链后它对 `lib/client.js` 的构建形态敏感（`:20-24` 记录过上游写死绝对路径导致跑不起来的坑）。

### D6 `scripts/occlusion-probe.mjs` 与 `scripts/harness-compat-baseline.mjs` —— **补票，不要删**

- **现状**：模块面（`guard-targets.moduleSurface`：只枚举 `src/**`+`lib/**`，`test/tools/guard-targets.mjs:62-64`）**看不到 `scripts/**`**；`git grep -l occlusion-probe -- test` 为空 ⇒ 这两个脚本 0 判据命中。`harness-compat-baseline` 有 **9 条 selftest**（实跑 `exit 0`），但**只由 `.github/workflows/harness-compat.yml` 调 `check`/`record`，从不调 `selftest`**。
- **处置**：① 把 `harness-compat-baseline.mjs selftest` 加进 `harness-compat.yml` 的步骤（或 `verify:docs`）——它的逻辑（基线读写的"追尾"修复）恰好是**CI 自动提交基线**这条直推通道的判据；② `occlusion-probe.mjs` 若只是本机诊断装置，就在 DEV-GUIDE 里显式标注为"非判据工具"（现在它既没文档也没判据）。
- **删掉会失去什么**：删脚本会失去"人可手动复算"的能力；所以是**补票**而非删除。

### D7 `test/verify-bundle-rows.mjs`（有意脱链）—— **保留脱链状态，但要让它"可发现"**

- **现状**：`TEST-ANCHORING.md` §8.3 已裁定：它 `import` 宿主 peer `@deepseek-ai/cordis`，而 CI 是 `npm ci --omit=peer`，挂链会撞 `verify-package-files` P5 的"零裸包依赖"硬判据。实测（本次未跑，见待验证）其文档记载 ≈2.9s / exit 0。
- **处置**：**保留**脱链，但把它写进 A2 建议的那张 `OFF_CHAIN_WHY` 表（理由已有现成原文），使"脱链"与"被遗忘"在机器上可区分。
- **删掉会失去什么**：43 条注册的跨源对账 + 跨行 `(kind,path)` 无重复 + 真 cordis 往返。

### D8 其余候选（证据不足，**不**建议删）

| 候选 | 现状 | 为什么不建议删 |
|---|---|---|
| `verify-json-response` / `verify-body-caps` | 27 / 23 条判据，都读 HTTP 响应面 | 未做重复度实验（两条的判据名与读面不同），**标「待验证」**，不做无证据建议 |
| `verify-route-index` 与生成物 `docs/ROUTE-INDEX.md` | 生成物逐字节对账 | 这是防"生成物漂移"的机制，属保留 |
| `verify-retired-lines` / `verify-dead-declarations`（软档） | 退役线零残留、声明孤儿 | 抓的是真实失效类；软档不应等同于可删 |
| `test/tools/audit-*.mjs`（4 个） | 候选清单工具，0 命中断言（`audit-guard-teeth.mjs` 有内建 `selfFailed` 自检但不被任何门禁调用） | 它们是**人读**的普查工具（文件头自述"不是判据"）；处置应是"补一次 selftest 入链"或"显式标注为手动工具"，不是删除 |

---

## 盲区地图

**口径**：① "无测试入口"= 磁盘上存在、但没有任何默认执行路径（MANIFEST / CI / npm script）会跑到它；
② "零判据模块"= 没有任何 `test/**` 代码在源码/产物层碰过它（`guard-targets.moduleSurface` 的模块面 = `src/**` + `lib/**` 的 `.js/.mjs/.cjs`）。

### (1) 有测试文件、但**默认不跑**

| 文件 | 谁会跑 | 证据 | 备注 |
|---|---|---|---|
| `test/compat-harness-surfaces.mjs` | 只在 `workflow_dispatch` | `harness-compat.yml:12-13,96` | UI 面清单棘轮 + sidebar 源码活判据 |
| `test/compat-harness-live.mjs` | 同上（两条通道各一步） | `harness-compat.yml:101,110` | 唯一看得见 `peerDependencies` 在安装闭包解析的通道 |
| `test/compat-harness-pages.mjs` | 同上 | `harness-compat.yml:115` | 无头浏览器逐页 DOM/样式 |
| `test/e2e-web-media-origin.mjs` | 无（只有 `package.json:132` 的 `verify:e2e`，CI 不调） | `git grep verify:e2e` → 只有 package.json | 浏览器 + 中间件产物 |
| `test/verify-inject-contracts.mjs` | **无**（曾在本分支侧 47 步的旧 `&&` 链里，`3ed09abb`） | §A2 集合差；单跑 `exit 0` | 22 族 DEPS ↔ 消费面 ↔ 调用点三方对账（207 键） |
| `test/verify-component-face.mjs` | **无**（同上） | 同上 | 组件视图面分级 + 内部面预算棘轮 |
| `test/verify-route-ownership.mjs` | **无**（同上） | 同上 | M10 归属唯一性 |
| `test/verify-settings-namespaces.mjs` | **无**（同上） | 同上 | 7 簇命名空间 + 133 宿主键 + v5→v6 迁移 |
| `test/verify-bundle-rows.mjs` | 无（**有意**，已记档） | `TEST-ANCHORING.md:315-326` | 发布面行不变量 |
| `test/verify-bridge-ci.mjs` | **无**（且 `verify:bridge` 应指向它却指向别处） | §A3 | CI 桥接面红绿判定 |
| `test/repro-sidebar-props.mjs` | 无 | §D5 | 真产物作用域复现台（0.14s） |
| `test/tools/js-text.mjs` 的 `selftest`（37 条） | 无（曾在上游旧链末） | §A2/§D4 | 43 个守卫共用的剥注释器 |
| `test/tools/i18n-scan.mjs` / `weT-shim.mjs` 的 `selftest` | 无（只有 CLI 分支） | `i18n-scan.mjs:323`、`weT-shim.mjs:59` | 中文字面量扫描 / weT 桩 |
| `scripts/harness-compat-baseline.mjs` 的 `selftest`（9 条） | 无 | §D6 | 基线读写（CI 直推通道的逻辑） |
| `test/tools/audit-guard-teeth.mjs` 的 `selfFailed` 自检 | 无 | `audit-guard-teeth.mjs:334` | 普查工具自身的牙 |
| `test/tools/audit-fixture-coverage.mjs` / `audit-import-closure.mjs` / `audit-write-only-state.mjs` / `m2-facade-code-share.mjs` / `multi-source-mutants.mjs` / `branch-notify.mjs` / `analyze-host-apply.mjs` / `fx-perf-rig.mjs` / `underlay-pixel-rig.mjs` / `sidebar-props-scroll-rig.mjs` / `diagnose-web-blank.mjs` | 无（手动工具；部分被守卫 `import`，如 `multi-source-mutants`→`verify-asset-paths`/`verify-cache-prune`） | `git grep -l <tool> -- test` | 工具本身可能在链上被"用"，但其 CLI 自检不在门上 |
| `test/verify-static.mjs` | CI 步骤（不在 MANIFEST）；**本机跑不动** | `verify.yml:63-64`；本机实测 `FAIL | ESLint 跑得起来并产出 JSON | spawnSync … EPERM` | 静态棘轮 |

> `test/tools/*` 里真正在链上被 `import` 消费的：`js-text`、`guard-chain`、`guard-targets`、`src-scope`、`source-locator`、`i18n-scan`、`child-out`、`repo-face`、`assert-harness`、`token-contract`、`weT-shim`、`multi-source-mutants`、`host-route-index`。

### (2) 零判据模块（`src/**` + `lib/**`，147 个）

| 模块 | 状态 |
|---|---|
| `lib/components/mascot-avatar/index.js` | **唯一零直读覆盖**，已在 `verify-guard-map.mjs:80-83` 的 `ZERO_COVERAGE_WHY` 登记（理由：组件行入口，归属由 `verify-route-ownership` 的"行→入口"对账覆盖） |

- 其余 **146/147 都有直读判据**；`bundleOnly`（只有"隔产物 `lib/client.js`"这一条路径）的模块数 = **0**（实测，见附录 P12）。⇒ **模块级看不见的地方基本没有**，本仓这一层做得比预期好。
- 但要注意口径：模块面**只含 `src/**`+`lib/**` 的 `.js/.mjs/.cjs`**；因此 **`scripts/**`、`assets/**`、`docs/**`、`lib/*.swift`、`.github/**` 不在任何"零覆盖"统计里**（§S10 的 `occlusion-probe` / `harness-compat-baseline` 就是这么掉出去的）。

### (3) 明确"无测试入口"的功能面

| 面 | 覆盖情况 |
|---|---|
| 前端半边 `src/**`（73 个跟踪文件） | **全覆盖**，但多为"读产物 `lib/client.js` 切片再求值"（`bundleOnly=0` 说明也都有直读源码的判据）；`e2e-web-media-origin` 是唯一真浏览器面，**不在 CI** |
| 迁移 | `settingsVersion` v5→v6 迁移有判据（`verify-client.mjs:3827-3830`）；未发现其它迁移框架 |
| 定时/后台任务 | rotation：3 条 smoke；live frame：2 条 smoke；child-kill、focus handback（`verify-client.mjs:4819-4845`）有判据 ⇒ 有入口 |
| 打包/发布面 | `verify-package-files`（P1–P8）、`verify-package-publish`（⑥⑦）、`prepack` 字符串断言 |
| CI 接线本身 | **只有**平台矩阵与工作流级表达式（`verify-contracts.mjs:364-448`）；**步骤→脚本的接线无判据**（§A3 的直接后果） |
| 诊断/装置脚本 | `scripts/occlusion-probe.mjs`（0 判据）、`test/tools/diagnose-web-blank.mjs`（被 `verify-contracts` 读"无头启动参数"，非行为判据） |

---

## 待验证清单（只能由 CI / 完整工具链 / 未被本机允许的操作验证）

| # | 待验证项 | 为什么本机不能验 | 建议由谁验 | 具体怎么验 |
|---|---|---|---|---|
| V1 | `npm run verify:bridge`（`--provision`）的三种结局与"环境差异 ⇒ 是否降级" | 沙箱禁带管道 spawn（EPERM）；`--provision` 需联网下载产物 | CI（ubuntu+windows 两腿）/ 普通开发机 | 看 CI 第 9 步日志末行是否有 `[media-bridge] verdict=…`；两边都要看（S3 修好后应出现 `::warning title=media-bridge env-skip::`） |
| V2 | `test/verify-bridge-ci.mjs` 的 fail-closed 行为（含 `DSH_VERIFY_BRIDGE_CHILD` 负对照） | 该文件无任何入口，且它自己起子进程（本机 EPERM） | 完整工具链 | `DSH_VERIFY_BRIDGE_CHILD=<假子进程> node test/verify-bridge-ci.mjs`，覆盖 17 种组合（码 0/3/1、有/无判词、判词重复、被信号结束）——**建议落成常驻判据** |
| V3 | `npm run verify:static`（ESLint/tsc 棘轮） | `execFileSync` 抓管道在本沙箱 EPERM（实测 `FAIL | ESLint 跑得起来并产出 JSON | spawnSync … EPERM`） | CI | CI 第 3 步；本机替代读数已给：ESLint **265 文件 / 0 违规 / 0 fatal**（落盘口径）、tsc **0 error / exit 0** |
| V4 | `test/verify-bundle-rows.mjs` | 需 `@deepseek-ai/cordis`（peer，本机 `node_modules` 里有/无取决于安装） | 完整安装的机器 | `node test/verify-bundle-rows.mjs`（期望 ≈2.9s / exit 0），并复核"绿了不退出"是否真被 `process.exit(0)` 修好 |
| V5 | 三个 `compat-harness-*` + `e2e-web-media-origin` | 需网络、`dsh` CLI、Chromium 系浏览器、中间件产物 | 手动派发 `harness-compat.yml` / 本机完整环境 | `gh workflow run harness-compat.yml -f force=true` |
| V6 | CI 双平台各自的 skip 明细（POSIX 半 / win32 半） | 本机只有 win32 一条腿 | CI 两腿日志 | 对每条腿抓 `SKIP`/`platform-skipped`/`环境跳过`/`未执行` 行，按 §A4 的表做差 |
| V7 | `verify-module-layout` ⑧ 的"子串误命中"方向（工具名只出现在否定句里是否仍算点名） | 需在副本里改文档（**本次未做**，避免与队友并发改动混淆） | 本人/下轮 | 副本里把 `docs/DEV-GUIDE.md` 的 `repo-face` 全部替换成一句否定句，跑 `verify-module-layout`，期望：① 若按 `includes` 语义 ⇒ 绿（判据过宽） |
| V8 | `verify-scene` 的平台跳过对：`verify.yml:33` 声称"win32 上 **5** 条 platform-skipped"，而本机 win32 实测 **1** 条（`verify-scene.mjs` 只剩 1 个 `platformSkip()` 调用点 `:483`） | 本机 win32 只能看到一条腿；数字差异的原因（注释过时 vs 环境）需另一条腿 | CI 两腿日志 / `git log -S '5 条 platform-skipped'` | 抓 ubuntu 腿的 `platform-skipped`/`○` 行与 win32 腿对比；顺带确认这条注释数字该改成几 |

---

## 附：本次实际跑过的命令与关键输出（逐字摘）

**P1 链的形状**
```
$ for g in verify docs smoke all: node test/run-guards.mjs $g --list-json | <count>
verify steps=58  hard=57  soft=1
docs   steps=7   hard=0   soft=7      ← 任务书里的"docs 6 步"已过时
smoke  steps=6   hard=6   soft=0
all    steps=72  hard=64  soft=8
```

**P2 全链实跑（工作树当时 = HEAD）**
```
$ node test/run-guards.mjs all *> .test-cache/audit/verify-all.log
$ tail -3 .test-cache/audit/verify-all.log
FONTSET LOAD SMOKE PASSED
✓ all 全部 72 步执行完毕
[exit=0]
$ grep '软档守卫原退出码' .test-cache/audit/verify-all.log
[warn-only] 软档守卫原退出码 = 1 —— 已降级为警告，不决定本次红绿（判据未改；要它重新拦下改动，就 `node test/verify-module-layout.mjs` 直接跑）
```
逐步入数（✓/PASS 统计，节选）：`[3] verify-client ✓=39`、`[10] verify-scene-live ✓=678`、`[45] verify-presets ✓=225`、`[60] verify-module-layout ✓=43 ✗=1`、`[5] verify-windows-caption ✓=0 PASS=0`（只打一行 PASSED，见 C7）。

**P3 脱链的 4 条（HEAD 副本，单跑）**
```
$ node test/verify-component-face.mjs      → ALL COMPONENT FACE CHECKS PASSED            exit=0
$ node test/verify-inject-contracts.mjs    → ALL INJECT CONTRACT CHECKS PASSED
                                             M8=100% (22/22 families · 声明键 207 个)    exit=0
$ node test/verify-route-ownership.mjs     → ALL ROUTE OWNERSHIP CHECKS PASSED (M10 = 0)  exit=0
$ node test/verify-settings-namespaces.mjs → ALL SETTINGS NAMESPACE CHECKS PASSED         exit=0
$ node test/tools/js-text.mjs selftest     → js-text selftest PASSED (37)                 exit=0
```

**P4 地板实验**：见 §A2（`node .test-cache/audit/floor-probe.mjs`）。

**P5 面积守卫变异实验**（HEAD 副本）
```
$ (copy) node -e "…replace 'const GPU_FRAME_AREA_TOL = 0.05;' → '= 0.30;'…"
mutation landed: 0.05 -> 0.30（面积守卫强度 6x 弱化）
$ node .test-cache/audit/test/verify-scene-frame-master.mjs
  ✓ 10b. 有签名无像素数据（<1KB/缺 IDAT）→ 415 — status=415
MASTER FRAME PASSED (18 checks)
[exit=0]                      ★ 假绿：改坏实现不红
```

**P6 golden client 侧变异实验**（HEAD 副本）：见 §B3。

**P7 判词矩阵实验**：见 §B5（`resolve-outcome-probe.mjs`）。

**P8 可见性与吞失败普查**
```
$ git grep -n -E '\|\| true|continue-on-error|allow_failure|\|\| exit 0' -- .github scripts package.json
.github/workflows/verify.yml:108:        continue-on-error: true     ← 唯一一处（且只在注释里出现别的命中）
$ git grep -n -E "\.only\(|\.skip\(|xit\(|xdescribe"                    → 0 命中
$ grep -c -E '\bSKIP\b|跳过' test/*.mjs test/tools/*.mjs                → 48 个文件命中（明细见 §A6）
```

**P9 尾随空白**
```
$ (扫 298 个被跟踪的非 md 文本文件)
带行尾空白的行数: 2
test/verify-client.mjs:3982        （逐字：'  ' 两个空格的空行）
test/verify-theme-layer.mjs:513    （逐字：'…被拒', …' 行尾一个空格）
$ git diff --check   → 无输出 exit=0（干净树）
```

**P10 静态门禁两侧读数**
```
$ node test/verify-static.mjs
FAIL | ESLint 跑得起来并产出 JSON | spawnSync C:\nvm4w\nodejs\node.exe EPERM
1 CHECK(S) FAILED                                  [exit=1]（本机环境限制）
$ node node_modules/eslint/bin/eslint.js . -f json > .test-cache/audit/eslint.json
filesLinted=265 violations=0 fatal=0   byRule={}
$ node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json > .test-cache/audit/tsc.txt
tsc exit=0   errors: 0 {}
```

**P11 工具自检可达性**
```
$ git grep -n 'selftest' (test/**, .github/**)
调用点只有：test/verify-guard-map.mjs:29 import + :344 collect(locatorSelftest)   ← 唯一的"在门上"
其余 selftest 定义处的调用只来自各自 CLI 分支（i18n-scan.mjs:323 / js-text.mjs:466 / weT-shim.mjs:59 / source-locator.mjs:330）
$ node test/tools/js-text.mjs selftest                 → PASSED (37) exit=0
$ node test/tools/i18n-scan.mjs selftest               → selftest ok exit=0
$ node test/tools/weT-shim.mjs selftest                → selftest ok exit=0
$ node scripts/harness-compat-baseline.mjs selftest    → PASSED (9) exit=0
$ node test/tools/audit-guard-teeth.mjs                → 候选合计 47 处（工具，非判据）exit=0
```

**P12 覆盖统计（`guard-targets.buildMap`）**
```
模块面 147 · 守卫 81 · 零覆盖 1（lib/components/mascot-avatar/index.js，已登记）· 零目标守卫 12（全部已登记）
有直读判据的模块 146 / 只有"隔产物"这一条路径的模块 0 / 完全没被碰过的 1
```

**P13 仓库状态（会话结束时，**均为他人改动**）**
```
$ git status --porcelain=v1
 M docs/DEV-GUIDE.md            ← 队友 docs-comment-sync：补 repo-face.mjs 等文档行
 M lib/kernel/host-kernel.js    ← 队友（chain-runner/wiring-audit）
 M lib/settings-schema.js
?? docs/archive/wip/DOC-ROT-REPORT-3.md
$ git diff --check   → 无输出 exit=0
$ node test/verify-module-layout.mjs（工作树）→ ALL MODULE LAYOUT CHECKS PASSED exit=0
$ node .test-cache/audit/test/verify-module-layout.mjs（HEAD 副本）→ MODULE LAYOUT CHECKS FAILED — 1 failed exit=1
```

> **审计者声明**：以上全部读操作；写操作仅限 `.test-cache/**`（HEAD 副本树、2 个探针脚本、日志与 eslint/tsc 落盘文件）。
> 未提交、未 push、未改任何被跟踪文件；报告本身 `docs/archive/wip/TEST-CREDIBILITY-AUDIT.md` 按任务要求**不入库**。

---

## 附录 R：四条发现的**修复落地账**（Lead 裁定后由 test-audit 执行；仍未提交）

> 口径：只改工作树，未 commit / 未 push。改过的判据单跑 + 负对照实跑；`run-guards all` ⇒ **77 步 exit 0**。

### R5（面积守卫死带，对应 S5/B4）—— 判据侧补锚点 + 双向负对照

- 修：`test/verify-scene-frame-master.mjs` 18 → **30** 条。容差**从真源现算**
  （`locate('GPU_FRAME_AREA_TOL', { in: 'lib' })`；⚠️ 不限定半边会判多义，因为 src 还有一份同名拷贝），
  新增边界两侧 **±1%** 近邻用例：0.9400（752×600）→ **409**、0.9600（768×600）→ **200**。
- 负对照：容差弱化到 **0.30**（本报告的反证值）⇒ 边界下方那条观测会被同一条判据判红（弱化后观测 200
  vs 期望 409）；收紧到 **0.01** ⇒ 边界上方判红（409 vs 200）；缺锚即红。
- 附带证据：锚点是现算而非行号冻结 —— 同一符号主树 `host-kernel.js:95`、干净检出 `:93`，两处都命中。
- **取证结论（Lead 追加裁定：先判定 (a) 同源 还是 (b) 各自独立）**：(a) **同源**。
  `git log -S 'GPU_FRAME_AREA_TOL'` ⇒ 两份都由同一笔 `f788a337`（PR #206「单主帧 + 面积升级制」）引入；
  客户端那处注释逐字写着「**与宿主 GPU_FRAME_AREA_TOL 同值同义**，两端独立部署」；两者守同一条边界的
  两侧（客户端「面积 ≥ 画布×(1−TOL) ⇒ 保留」/ 宿主「< 盘上主帧×(1−TOL) ⇒ 409」）。
  ⇒ 已加「两侧相等」判据（4i）+ 双向变异（4j）+ 越界值（4k）+ **后果面**错配（4l：
  `tol_client=0.30` 时面积 451200 客户端保留、宿主 409）；**端到端负对照**：把
  `src/live-layer-watch.js` 的真实常量改成 0.30 ⇒ 4i/4l 判红、exit 1，按字节还原后复绿。

### R6（golden client 侧死数据，对应 S6/B3）—— 两侧各自逐用例比对值

- 修：`test/verify-client.mjs` ③ 对 **host / client 两侧**各逐用例比对（同一 `canon`）。归属写明：
  host = `lib/index.js sanitizeSettings`（整侧 null 用哨兵 `__null__`）、client = `src/client.js
  sanitizeSettings`（含 CLIENT_ONLY 键 `frameVariants`/`customFrames`，键集与 host 不同 ⇒ 两份独立比对）。
  配套：`regen-golden.mjs` 把 client 侧从"仅提示"改为同样棘轮（漂移 ⇒ exit 1）；夹具 `note` 与
  `verify-glass-surfaces` ⑥ 注释同步更正。
- 负对照（端到端，本报告 §B3 的同一实验）：夹具 `cases[0].client.blur` **16 → 999**
  ⇒ `verify-client` **exit 1**，报错即新判据并点名用例 `empty`；随后按字节还原
  （`git diff --numstat` 该夹具仅 `1 1` = 只改了 `note` 一行）。

### R4（`git diff --check` 恒空 + 2 处尾随空白，对应 S4）

- 修：去掉 `test/verify-client.mjs:3982`、`test/verify-theme-layer.mjs:513` 的行尾空白；
  `.github/workflows/verify.yml` 该步从 `git diff --check` 改为**扫 HEAD 树**
  （`git grep <rev>` 读树对象 ⇒ 与 eol 无关、不依赖历史深度、检查的正是评审者看到的那棵树）。
- 负对照记录：修前 `HEAD` 树 **2 命中**（⇒ 该步会红，证明不再是恒空）；修后工作树 / 干净检出 **0 命中**。
- 豁免两条并给出**证据来源**：`*.md`（Markdown 行尾两空格 = 硬换行；实测当前 **0 命中**，属预防性）、
  `assets/**`（实测 **1821 行**命中，全部在 `assets/mascot/vector-960x1024.svg`，是导出数据）。
  冲突标记只认 `<<<<<<<`/`>>>>>>>`（不认 `=======`：Markdown setext 标题下划线）。
- 本机复算入口与三条命令见 `docs/archive/wip/TEST-ANCHORING.md` §13（**未写进 `docs/DEV-GUIDE.md`**：该文件当时
  有他人的在途改动，避免写冲突；Lead 若要归到手册，一句话我就搬）。
- 处置取向：这 2 处是**修掉**而不是加进豁免名单（棘轮只许收紧）。

### R8（`resolveOutcome` 矩阵重复行 + 缺格，对应 S8/B5）

- 修：`test/verify-media-bridge.mjs` 把 `probeVerdict === 'regression'` 提到环境差异那条之前
  （**顺序即语义**，并写进注释）；矩阵补齐缺失那格（期望 **regression/1**）、删除逐字重复行（仍 6 行）。
- 负对照：键序对调 ⇒ 结论不变；把分支顺序换回去的**变异体** ⇒ 同一张矩阵判红，
  明细 `{…probeVerdict:'regression'…} ⇒ 期望 regression/1 实测 environment/3`。
