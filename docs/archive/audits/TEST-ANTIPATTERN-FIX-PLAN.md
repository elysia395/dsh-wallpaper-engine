# 现在还有什么问题 / 遗留与风险

> 本文只记**尚未解决、仍有风险、需要人决定**的事：不记过程，也不重复逐条改法。
> 106 条发现的逐条现状（每条现在守什么、牙齿如何、`file:line` 证据）见 `docs/archive/audits/TEST-ANTIPATTERN-AUDIT.md`。
> 本文出现的 `file:line` 都在最终工作树上现场核对过。

## 0. 现状一句话

- 审计覆盖的 `test/` 全量（72 个 `.mjs` + 2 份夹具）共 **106 条**发现（95 条本体 + 11 条来自其余 6 个文件）**已全部定案并实施**：
  **R（重写）47 · H（加固）33 · D（删除）19 · 不改（裁决）/声明 5（L3、F4、F5、L52、M32）· 取消（未找到）2（L53、L55）**；待议（P）为 **0**。
- 5 处「不改·声明」的**声明的准确性**都做了处理：**L3** 就地标明"装置自检、不是产品判据"（`test/verify-client.mjs` 里 `neverDisconnected` 那两行之上）·
  **L52** 复核为**已是解决态**（`test/verify-softrender.mjs:214-220` 的 `provideURLSearchParams` 场景开关被 I1/I2/I3 真用 ⇒ 不动）·
  **M32** 重录工具入库 `test/tools/regen-golden.mjs`（写入必须先 `--intend` 声明意图）+ 夹具 `note` 与段注释按"哪一侧真被守着"改写 ·
  **F4** 只在 `docs/DEV-GUIDE.md` §4.6 写明"只印候选、何时跑、看到候选怎么处置"（**仍不加棘轮、仍不进 CI**）·
  **F5** 补了对齐判据（`test/verify-logging.mjs` 的 N7③，含 4 条负对照：`test/tools/sync-webwallgl.mjs` 的 `BASE_PATH`、产物绝对引用、宿主注册前缀三者必须一致）。
- 守卫全绿（在最终工作树上重跑实测）：`npm run verify` exit 0（44 个守卫）· `npm run verify:docs` exit 0（末尾 `ALL GUARD MAP CHECKS PASSED`）· `npm run smoke` exit 0。
- 改动面：`test/`（含 `test/fixtures/settings-sanitize-golden.json`）+ 两个生成物 `docs/GUARD-MAP.md`、`docs/ROUTE-INDEX.md`
  + 文档 `docs/README.md`、`docs/en/README.md`（登记这两份审计文档）、`docs/DEV-GUIDE.md`（§4.5 / §4.7 判定与写作约定）、
  `docs/CHANGELOG.md`、`docs/en/CHANGELOG.md`（v1.3.1 段各一条）；`src/`、`lib/`、`scripts/`、`package.json` **零改动**。
- 本批（5 处声明的**准确性**）另动：新增 `test/tools/regen-golden.mjs`（夹具重录闸门）、`test/verify-logging.mjs`（N7③ 前缀对齐判据 + 4 条负对照）、
  `test/fixtures/settings-sanitize-golden.json`（`note` 改写）、`test/verify-client.mjs`（③ 段注释 + L3 装置自检标注）、
  `docs/DEV-GUIDE.md` §4.6（`regen-golden.mjs` 新增行、`branch-notify.mjs` 行改写）、`docs/ROUTE-INDEX.md`（重算）、
  `docs/CHANGELOG.md` 与 `docs/en/CHANGELOG.md`（那条审计 bullet 补 ④「声明的准确性」）与这两份审计文档。
- 本地 CI（即 `.github/workflows/verify.yml` 的步骤序列）在最终工作树上实跑过一遍，逐步实测：
  `platform=0` · `build=0` · `verify=0` · **`verify:bridge=1`** · `smoke=0` · `verify:docs=0` ·
  `git diff --exit-code -- lib/client.js`=0（`npm run build` 幂等，跑完 `lib/client.js` 仍与 HEAD 逐字节一致）·
  `git diff --check`=0。**唯一非 0 的 `verify:bridge`（`node test/verify-media-bridge.mjs --provision`）是本机环境限制**，见 §1.2。
- **提交状态**：上一批（106 条定案）已提交为 `62a5dfc` 并推送 `fork/main`；fork 上的 `verify` run **38026813312** 两条腿（windows-latest / ubuntu-latest）
  **11 步全 success**，其中就含本机跑不了的 `verify:bridge` ⇒ 本机那次 exit 1 确认是沙箱限制而非回归。
  **本批（5 处声明的准确性）的改动尚未提交**：HEAD 仍是 `62a5dfc`，`git status --short` **10 项** —— 9 个已改（本文件、`TEST-ANTIPATTERN-AUDIT.md`、
  `docs/DEV-GUIDE.md`、`docs/ROUTE-INDEX.md`、`docs/CHANGELOG.md`、`docs/en/CHANGELOG.md`、`test/verify-client.mjs`、`test/verify-logging.mjs`、
  `test/fixtures/settings-sanitize-golden.json`）+ 1 个新增（`test/tools/regen-golden.mjs`）。`src/`、`lib/`、`scripts/`、`package.json` 仍**零内容改动**：`lib/client.js` 与 HEAD 逐字节一致
  （`git hash-object --no-filters` == `05870c0d4d56ba3819f43ccdbcaea1cf8b2d681c`）。

---

## 1. 仍未解决 / 仍有风险

### 1.1 两个"人读工具"（F4 已定案不加棘轮 / F5 已加对齐判据）

| 项 | 现状 | 仍然接受的风险 |
| --- | --- | --- |
| F4 `test/tools/branch-notify.mjs` | 正常路径**恒 exit 0**：只有 `audit` 之外的用法分支才 `process.exit(1)`（`test/tools/branch-notify.mjs:199-201`），末行只是打印候选（`:210`）；`package.json` 里没有任何调用；其 `pathNotifications` 被 `test/verify-client.mjs:14` import，**真判据在那边**（①h 处理器级 / ①i 分支级） | 已定案**不加棘轮、不进 CI**：它是手动排查工具。`test/tools/` 不在牙齿普查的扫描面内（那一族只枚举 `test/` 顶层的 `verify-*` / `*-smoke`）⇒ "恒 0 出口"这类形态在这套普查里**结构上看不见**，只能靠人记得它只印候选。处置流程写在 `docs/DEV-GUIDE.md` §4.6 |
| F5 `test/tools/sync-webwallgl.mjs` | `BASE_PATH = '/wallpaper-engine/scene-live'`（`:41`）现在**有对齐判据**：`test/verify-logging.mjs` 的 N7③ 把"rig 的 base / 产物 `lib/webwallgl/index.html` 里的绝对引用 / 宿主 `lib/routes/scene-serve.js` 注册的 `${BASE}/…` 前缀"三者钉在一起（4 条负对照：改 rig base、改产物引用、改宿主 `BASE`、字面量抠不到） | rig 仍是**纯手动 vendoring**（文件头写明手动同步、手工改动会被覆盖），且默认上游 `../webwallgl-github`（即 `D:\webwallgl-github`）在本机不存在 ⇒ 本机跑它仍以"缺上游"文案退出（环境缺失，不是缺陷）。另：判据只认**单引号字面量**形态的 `const BASE = '…'` / `const BASE_PATH = '…'`，上游若改用双引号或模板串，N7③ 会报"抠不到"（红，但属换代而非漏判） |

### 1.2 harness / e2e 一族的覆盖空洞

- **`test/compat-harness-surfaces.mjs` 的依赖名地板本机测不到（L41）**：`exemptHit`（`:212`）与被豁免项地板
  `tokens.length + attrs.length + suffixes.length + slots.length - exemptNames.size >= 20`（`:263`）都在「已装 harness」之后才跑，
  而本机 `node_modules/@deepseek-ai/` 下**没有 `dsh`**、`DSH_WE_HARNESS_ROOT` 也未设 ⇒ 守卫在 `:140-142` 就
  `HARNESS SURFACES FAILED` 退出，**这段代码在本机从未执行过**。
  - 影响：这条地板"是否既不空转也不误红"在本机无法验证；触发条件是"只有装了 harness 的机器才跑到"。
  - 建议：在有 harness 的环境跑一次，或用 `DSH_WE_HARNESS_ROOT` 指向一份真装好的包目录。
- **`test/e2e-web-media-origin.mjs` 的浏览器段本机跑不完**：能起 Edge，但中间件产物下载 `fetch failed` ⇒ 后端回落 legacy，该段大量红。
  它**不在** `npm run verify` 里（另设 `verify:e2e`）。
  - 仍可用的部分：浏览器前置判据与产品源码判据能真跑（抽屉主操作区、快速面板的计数）。
  - 建议：在能下到中间件产物的机器上跑完整段。
- **`test/verify-media-bridge.mjs` 在本环境无覆盖**：中间件 `ready` 始终 false，该守卫现在如实报
  `✗ 中间件就绪（握手通过、子进程在跑）`、exit 1（判据在 `:301`，退出码 `:480`）。本机根因有两层：产物没缓存时是下载
  `fetch failed`，产物已缓存（`.test-cache/verify-media-bridge/bin/`）时是 `spawn EPERM`。
  - 在 `npm run verify` 里它还是**软档**：`test/warn-only.mjs` 把守卫失败降级成警告并以 0 退出（见该文件 `:74` 打印的
    `软档守卫原退出码`）⇒ **它的红不改变 `npm run verify` 的红绿**；本沙箱起不了带管子进程时，它会先打印**具名 SKIP**
    （「这不是"通过"：该自检在本环境**没有覆盖**」）。
  - 建议：把它当"本机环境缺口"记账；真要跑这一族用 `verify:bridge`（带 `--provision`）。
  - **本地 CI 实测同一条根因**：`npm run verify:bridge` 在本沙箱 exit 1 —— 守卫自报 `失败：环境性失败：detached: spawn EPERM; plain: spawn EPERM`
    （受限模式不能开命名管道 ⇒ 带管道 stdio 的 `child_process.spawn` 一律 EPERM），同时印出"产物 = 可信、sha256 与发布产物一致"、
    记录"环境跳过（环境性失败）"并**点名本次该通道没有断言覆盖**；退出码仍 1（`test/verify-media-bridge.mjs:480` 只看 `failed`）。
    这条 CI 步骤要在 GitHub runner 上才真跑（那里 `spawn` 可用）—— fork 上 run **38026813312** 的第 7 步
    `verify:bridge —— media-bridge 端到端（带 --provision）` 实测 **success**（本机这次 exit 1 因此确认是沙箱限制）。
- **结构性问题**：`compat-harness-*` 与 e2e **都不在** `npm run verify` 的主链上，`.github/workflows/harness-compat.yml` 又只有
  `workflow_dispatch` 触发 ⇒ 这一族守卫**默认不随改动跑**，动到它们时必须手动跑一次。

### 1.3 M16：那条契约现在只有正判据

- 「每个 `kind` 在调用点恰好出现一次」这条契约只有正判据（`test/verify-logging.mjs:159` 起）撑着，没有配套的负对照。
- 风险：计数口径或抽取器哪天退化，不会有守卫报警。
- 建议：若要加固，补一条喂**变异调用点文本**、走同一个计数判据的负对照，而不是再回测一遍抽取器。

### 1.4 设置夹具是"漂移棘轮"，不是正确性判据

- `test/fixtures/settings-sanitize-golden.json` 的期望值录自**录制那一刻实现的实际输出**：只证明「输出**没有无理由地变化**」，
  **不证明取值本身正确**（该不该是这样看 `lib/settings-schema.js` 的 `DEFAULTS` / `KINDS` 与各键的设计意图）。这层定位现在写在
  夹具 `note`、`test/verify-client.mjs` 的 ③ 段注释与断言文案三处。
- 重录工具已入库：`test/tools/regen-golden.mjs`（默认只报告；`--write --intend <host|client>:<键>` 才写入，除声明键外的漂移会被
  **拒绝写入**，且脚本不碰 `note`）⇒ 旧口径"重生成脚本不在仓库里、只能人工比对 diff"已作废。
- **只有 host 侧的「值」被棘轮住**：`test/verify-client.mjs` 的 golden 段逐用例比对 `sanitizeFromSchema(input, 'host')`。
  夹具里 `client` 侧的值**没有任何判据比对**（④ 在活值上钉 client == host、⑥ 只用键集）⇒ **client 侧现在就有 3 个键与当前实现不一致**
  （`layerPositionX` / `layerPositionY` / `layerScale`，18/18 用例）而 `npm run verify` 全绿；工具会把它当提示报出来。
- 键的**存在性**由 `test/verify-glass-surfaces.mjs` 的 ⑥ 键集快照管，但它比的是**夹具自身逐用例的自洽** ⇒ 某个用例漏补键会红，
  **一个键在所有用例里都没补则抓不到**（那一类只有重录工具报）。
- 需要决定（可选）：是否把 ⑥ 升级成"活值联合键集 ⊆ 夹具联合键集"的对账（会当场暴露 client 侧那 3 键陈旧 ⇒ 要么重录、要么显式豁免）；
  或按每个键的**设计意图**把 client 侧也重录一遍。

### 1.5 记账口径

- 严重度以报告为准：**9 high / 37 medium / 60 low = 106**（逐条标签累加与报告 §7 的分组累加两处都成立）。

---

## 2. 需要你决定 / 环境限制

1. **是否提交**：上一批（106 条定案）已提交并推送（`62a5dfc` → `fork/main`，fork CI 全绿）；**本批 10 项**（见 §0 的提交状态）尚未提交 —— 要不要提交由你定。
2. ~~是否补 `docs/CHANGELOG.md` 条目~~ **已补**：`docs/CHANGELOG.md` 与 `docs/en/CHANGELOG.md` 的 `### v1.3.1（未发布）` / `### v1.3.1 (unreleased)`
   段各加一条（测试框架反模式审计与加固），并已按"改动一处同步另一处"的口径对齐；两份审计文档也已登记进 `docs/README.md` 与 `docs/en/README.md`。
3. **本机跑不了 CI 的一步**：`npm run verify:bridge` 在本沙箱恒 exit 1（`spawn EPERM`，见 §1.2）；GitHub runner 上**已实测通过**（fork 的 run 38026813312 第 7 步 success）。
4. **删不掉的临时产物**（都在真实 `%TEMP%`、不在仓库内；`Remove-Item` / `unlinkSync` 均 EPERM）：
   `dsh-body.mjs`、`dsh-find-bad.mjs`、`dsh-pristine-check\`、`x1-harness-probe\` ⇒ 需要有权限的会话代删。
5. **仓库内已清理**：`test/.tmp*` 计数 0，本地 CI 日志 `ci-local.log` 已删，无遗留探针。
6. **夹具 `client` 侧的值**：现在有 3 个键与当前实现不一致，但**不影响任何守卫的红绿**（只有重录工具会提示，见 §1.4）。
   要么接受"提示"，要么重录 client 侧；若给 ⑥ 加"活值联合键集 ⊆ 夹具联合键集"的对账，`npm run verify` 会**立刻红** —— 需要你决定取向。

---

## 3. 怎么复核现状

```powershell
npm run verify                       # 期望 exit 0（44 个守卫）
npm run verify:docs                  # 期望 exit 0，末尾 ALL GUARD MAP CHECKS PASSED
npm run smoke                        # 期望 exit 0
npm run build                        # 期望 exit 0；跑完 lib/client.js 内容仍与 HEAD 一致（只是 stat 变新）
npm run verify:bridge                # 本机期望 exit 1（spawn EPERM）—— 环境缺口，不是回归
git status --short                   # 期望 10 项（见 §0 的提交状态）；src/ lib/ scripts/ package.json 不应出现内容改动
node test/verify-media-bridge.mjs    # 本机期望 exit 1（缺中间件产物）—— 环境缺口，不是回归
node test/verify-fontset.mjs         # 期望 ALL FONTSET CHECKS PASSED (157)
node test/verify-logging.mjs         # 期望 exit 0；含 N7③ 的 rig/产物/宿主前缀对齐判据与 4 条负对照
node test/tools/regen-golden.mjs     # 期望 exit 0；会报 client 侧 3 个键漂移（提示，不影响红绿，见 §1.4）
```
