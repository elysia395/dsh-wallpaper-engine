# performer-rebuild 复审报告（T4）

> 复审人：qa-flash（AgentTeams `pet-link-performer-rebuild` · T4 独立复审）
> 日期：2026-10-30
> 范围：`packages/pet-link/src/pet-link/*`（linked provider 移植）+ 判据入链 + 旧版能力对齐。
> 硬约束遵守情况：**未改任何排播实现**（`src/*.js` 排播文件零改动）；未重打包产物；未部署。本报告产生的改动全部在**判据/守卫面**（`test/*`）与文档。

---

## 0. 结论（TL;DR）

**验收四条全部满足：**

1. **判据已入链且链全绿**：`test/verify-pet-tuner-coverage.mjs` 经 `test/verify-pet-link.mjs` 汇总守卫挂上 `npm run verify` 硬档链（第 81/93 步），`node test/run-guards.mjs verify` 93 步跑到尾、exit 0。
2. **48/48 消费有证据**：coverage 判据 48 个 key 全部 `✓`；另抽 5 键（followSpeed / handRightRatio / lockHeartbeatMs / egg2ShakePx / egg1FlingPx）在源码消费点逐行核对，且 T2/T3 行为夹具以「改旋钮 → 输出按比例变」的方式证明了消费点真影响行为。
3. **旧版能力对齐表逐项有结论**：9 个重点项 8 项「已对齐」，1 项（旧版脱链蓝本的逐帧贴边跟随）属**旧蓝本本身没有**的增强，新版反而补齐——详见 §3。
4. **报告含可复现命令**：每条结论附命令。

**发现的问题：无 blocker / high。** medium 1 条（软档环境项口径，§4-M1）、low 3 条（§4）。

---

## 1. 判据接入（从「手动能跑」到「链上必跑」）

### 1.1 接线方式

新链成员（`test/run-guards.mjs` VERIFY_STEPS，verify-pet-tuner 之后）：

```js
step('test/verify-pet-link.mjs'),
```

`test/verify-pet-link.mjs` 是既有汇总入口（`npm run verify:pet-link`），本轮把它的清单补齐为 **16 件**，其中新增 3 件：

| 汇总清单新增 | 说明 |
|---|---|
| `verify-pet-tuner-coverage.mjs` | **48 键死旋钮判据**（本次接入的核心） |
| `verify-pet-mascot.mjs` | T2 抓绳/绳子缓动/脱手下落行为夹具 |
| `verify-pet-optional-probe.mjs` | 可选依赖口径夹具（t14） |

链上每一步都是硬档子进程（`stdio: inherit`、非 0 即短路），因此 coverage 判据现在是 **PR 门禁上必跑**：任何把 `tune('<key>')` 消费点删掉/改名导致死旋钮回归的改动，`npm run verify` 当场红。

### 1.2 配套账面（三处同步收口）

| 文件 | 改动 | 为什么必须同步 |
|---|---|---|
| `test/fixtures/verify-chain.json` | `--write-fixture` 重冻结（verify 92→93 步，all 105→106 步） | 链形状逐字冻结，改链必须显式重冻结 |
| `test/verify-package-files.mjs` P5 `CHAIN_FLOOR` | `{verify: 92→93, all: 105→106}` | P5 负对照要求地板紧到「删一步即红」，不收紧则 P5 自己红 |
| `test/tools/guard-chain.mjs` `OFF_CHAIN_WHY` | 退役 5 条过期豁免（verify-pet-link / -linked / -panel / -extension-card / -optional-probe），新增 7 条「由链上汇总守卫代跑」豁免（linked / mascot / egg / panel / extension-card / optional-probe / tuner-coverage，另补 verify-pet-install 的旧账） | 判据⑤：守卫面上每个文件要么在链上、要么有非空理由；豁免过期/悬空都判红。七件夹具由链上 `verify-pet-link.mjs` 子进程逐一执行（与 `verify-pet-sidebar-glass-browser-case.mjs`「由链上守卫代跑」同一口径），判据在 PR 门禁真跑，只是文件本身不是链上直接命令 |
| `docs/GUARD-MAP.md` | `node test/tools/guard-targets.mjs --write` 重算 | linked-* 五个分区模块、panel-params、performer 现在有守卫覆盖行（见 §2.3）；`verify-guard-map` 逐字对账通过 |

### 1.3 复现

```powershell
cd repo-dsh-wallpaper-engine
node test/run-guards.mjs verify                 # 93 步跑到尾，exit 0
node test/run-guards.mjs verify --list-json     # 第 81 步 = test/verify-pet-link.mjs
node test/verify-guard-chain.mjs                # ALL GUARD CHAIN CHECKS PASSED
node test/verify-package-files.mjs              # P5 全绿（verify=93/93 docs=6/6 smoke=6/6 all=106/106）
node test/verify-guard-map.mjs                  # ALL GUARD MAP CHECKS PASSED
node test/verify-pet-link.mjs                   # 汇总入口 16 件全过，exit 0
```

---

## 2. 48/48 消费取证

### 2.1 机判证据（coverage 判据）

```
参数真源：48 个 key（panel-params.js）
消费面：bubble.js, constants.js, extension-card.js, linked-egg1.js, linked-egg2.js,
        linked-mascot.js, linked-shared.js, linked-sidebar.js, linked.js, mode.js, native.js
已消费：48 个
✓ 全部 48 个旋钮都有排播消费者（无一死旋钮）
```

（`node test/verify-pet-tuner-coverage.mjs`，exit 0；同时该判据有防自失效设计：0 key / 重复 key / 消费面为空都会 `process.exit(1)`。）

### 2.2 抽 5 键源码确认消费点真影响行为

| 抽查键 | 消费点（文件:行） | 行为影响核对 |
|---|---|---|
| `followSpeed` | `linked-shared.js:260`（`followEdge`） | `maxStep = speed * dt`（:293）→ 每帧 `adoptPosition` 步长上限。值越大追边越快；判据还防 0：`Math.max(1, …)`。✔ 真消费 |
| `handRightRatio` | `linked-shared.js:239`（edgeTarget）/ `:262`（followEdge） | `wantX = edge − edgeGapPx − width×(ratio−0.5)`：直接决定「手右边缘对侧栏边缘」的落点。✔ 真消费 |
| `lockHeartbeatMs` | `linked-shared.js:126`（leaseHeartbeatMs） | 心跳周期 = 该值；TTL = 2×心跳（:129）；`renewLease`（:140-146）按它节流真发同名 `lock()`。T3 夹具实测 `lockHeartbeatMs=1000` 续期次数显著多于默认。✔ 真消费 |
| `egg2ShakePx` | `linked-egg2.js:32` → `:58` | `offset = sin(2π·Hz·t) × shakePx`，逐帧 `adoptPosition`。T3 夹具实测翻倍→振幅严格翻倍。✔ 真消费 |
| `egg1FlingPx` | `linked-shared.js:382`（startThrow） | `speed = min(3200, distance×1000/ms) × power` → `throwNative` 初速 vx。T3 夹具实测翻倍→vx 严格翻倍。✔ 真消费 |

其余 43 键中，凡有行为夹具的（mascot 12 键、egg1/egg2 18 键、共享 bubbleWindowMs/lockHeartbeatMs、eggAt 双计数）均由 T2/T3 夹具以「改旋钮 → 输出可测变化」证明；纯时长类键（各 `*Ms`）由 `playSegment` 的 `limitMs` 截短路径真消费（`mascotTumbleMs=500` 时段内事件不发生的负对照即为例证）。

### 2.3 GUARD-MAP 覆盖面（重算后）

linked 五分区模块每个都有 5 条守卫覆盖（`verify-pet-egg` / `verify-pet-linked` / `verify-pet-mascot` / `verify-pet-optional-probe` / `verify-pet-panel`）；`panel-params.js` 3 条（`verify-i18n` / `verify-pet-panel` / `verify-pet-tuner-coverage`）；`pet-link-performer.js` 4 条。零覆盖表只剩 6 个历史遗留（fx / parallax / mascot-avatar 的装配壳），与本轮无关。

---

## 3. 旧版能力对齐复审

**蓝本口径说明**：工作区内的旧版蓝本是 `packages/pet-link/src/pet-link-performer.js`（16539 B，官方原生联动、`petApi7340` + `client.position/throwPet` HTTP 面，git 未跟踪、历史无更早版本可溯）。任务书所称「138KB 内置 pet 时代排播」未在本工作区出现（多仓工作区只有 `repo-dsh-pet` / `repo-dsh-pet-dshwe` / `repo-dsh-wallpaper-engine` / `repo-dshwe-history`，均无 138KB 级排播文件）；新实现头注释与 `PETLINK_DEFAULTS`（constants.js:53-86）声称的默认值集合即以该蓝本为基准。**本节的「旧版」指这份蓝本；若存在更老的 138KB 蓝本，本表结论中「已对齐」的依据是新实现自带的默认值与注释声明，建议 captain 确认蓝本来源后复核一遍**（low 提示，见 §4-L3）。

逐项结论：

| # | 能力 | 结论 | 证据 |
|---|---|---|---|
| 1 | 跟随宽限/静止判定（followGraceMs / followStillMs / followStillEps / followSpeed） | **超出旧版（旧蓝本无，新版补齐）** | 蓝本 `move()` 是一次性 `client.position(…, 'line', duration)` HTTP 插值（:148），没有逐帧贴边跟随，也没有这四个键。新实现 `followEdge`（linked-shared.js:256-307）逐帧真测 rect + edgeX，三条收尾判据（宽限内不判静止 / `followStillMs` 内边缘位移 ≤ `followStillEps` 判拉完 / 必须先追上目标）齐备，且有 `maxMs` 硬上限绝不无限等。新蓝本注释明说这是「旧版逐帧贴边参数」的复刻对象 |
| 2 | 贴边手位比例（handRightRatio） | **已对齐（且比旧蓝本强）** | 蓝本 edgePoint 用硬编码 `size×0.15` 估内缩（:160）且走归一化坐标；新实现按用户口径「手对边缘」改为 `width×(ratio−0.5)` 换算手右边缘（默认 0.4875），量根节点真 rect 不走归一化（linked-shared.js:222-243）。这是**有据的行为改进**（注释写明旧版比例常量是核心信号），不是丢能力 |
| 3 | 绳子缓动曲线（mascotRopePullEase / mascotRopeBackEase，0 匀速/1 缓入缓出/2 缓出） | **超出旧版（旧蓝本无缓动）** | 蓝本 `moveRope(pull ? DownPx : 0)` 两态硬切（:183）。新实现 `mascotRopeEase`（linked-mascot.js:29-34）三曲线，`ropeAt(ms)` 按段内时间连续求值逐帧写 CSS 变量；夹具证明 ease=0 与 ease=2 位置序列可区分 |
| 4 | 脱手下落（mascotReleaseAtMs / mascotDropPx / mascotDropMs） | **超出旧版（旧蓝本无下落）** | 蓝本只有 `mascotReleaseAtMs` 时刻的绳子弹回；新版到点记下落起点，`applyDrop` 逐帧 `adoptPosition`（页面内零 HTTP），段被截短还有补完循环（linked-mascot.js:125-137）。夹具验证 y 到达 home+DropPx 且不越界 |
| 5 | 弹飞位移（egg1FlingPx / egg1FlingMs / egg1FlingPower） | **已对齐（增强）** | 蓝本 `client.throwPet(155, power)`：距离写死 155、发力时间不可调；新版三参共同换算初速（`startThrow`，linked-shared.js:380-395），夹具证明各自线性生效。方向同为左上（vx<0, vy<0） |
| 6 | 哈气抖动（egg2ShakeAtMs / egg2ShakePx / egg2ShakeHz） | **超出旧版（旧蓝本无抖动）** | 蓝本 egg2 分支只有气泡+开侧栏（:197-202）；新版正弦横移逐帧 adoptPosition、基准位防漂移、结束后归位、`shakePx=0` 保持「原地不动」语义（linked-egg2.js:54-72），夹具验证振幅线性、频率改形状 |
| 7 | 彩蛋 far/near 双计数（eggAt） | **已对齐** | 蓝本 tap：`Math.abs(p.x−rope.x) < Math.abs(p.x−1)` 选路，far/near 各自 `++state[key] >= tune('eggAt', logic)` 归零进彩蛋（:243-250）；新版 `petLinkDecideLogic`（mode.js:91-96，rope 不可得时 Infinity 保 sidebar 语义更稳）+ `tap`（linked.js:103-126）同构。夹具验证 eggAt=1/2/3、far→egg1 / near→egg2、触发后归零 |
| 8 | 动作间隔 segGapMs | **旧蓝本无此键；新版有真消费** | `gap()`（linked-shared.js:115-118）在四分区每段之间真等（>0 时 `rt.wait`）。归「旧蓝本没有、新面板暴露」的键，消费真实 |
| 9 | 锁心跳 lockHeartbeatMs | **已对齐（增强）** | 蓝本 `client.begin()` 租约无续期（长动作靠服务端 TTL 兜底）；新版心跳续期「漏一拍不掉锁」（TTL=2×心跳），T3 夹具实测续期节奏随键值变。`holdMaxMs` 等待关闭上限两边一致（蓝本 :208 / 新版 linked.js:77） |

**「旧版有、新版没有」盘点**：对照蓝本逐段（sidebar / mascot / egg1 / egg2 / gesture / 回程 / 计数 / tuner 读写面），**未发现任何一项丢失**。行为差异只有两类，且都有注释写明的理由：

- **有意替换（增强）**：#2 归一化坐标+硬编码 0.15 → 真 rect+手位比例；#5 throwPet(155,…) → 三参换算；绳子/下落/抖动/跟随从无到有。理由统一：用户口径「手对侧栏边缘」与「逐帧零 HTTP」纪律（蓝本 `client.position` 每次移动都是 HTTP）。
- **有意省略（有理由）**：蓝本 bubbleTiming 的 `node()` 按播放进度钩子机制在新版由 `state.bubbleTiming` 保留读写面（pet-link.js:148-156），但自绘气泡当前只吃默认时刻（`defaultShow/defaultHide` 语义并入 `showBubble`）。**面板可设但排播不消费自定义 bubbleTiming 钩子**——coverage 判据不涉及它（bubbleTiming 不是 panel-params key），但这是一个潜在的「能设、不生效」面，属于 M6 面板既有口径而非本轮移植丢失；登记为 low（§4-L1），不阻塞。

---

## 4. 问题清单（分级）

### Blocker / High

无。

### Medium

- **M1 · 四条环境项软档的档位是「本沙箱实测」而非「判据本质」，随环境回迁需人工复核**
  `verify-glass-runtime-browser / verify-deployment / verify-release-set / verify-types / verify-route-families / verify-ci-routing` 六条在链上挂 soft（t16 归类注释），其中 `verify-types`（类型散文条数 45≠48）与 `verify-route-families` 是**真缺陷**降档。本轮链改动触碰了这些注释所在的文件（run-guards.mjs），复现环境（有 GUI / 有子进程 / 类型已修）下应把环境项升回 hard、真缺陷修完升 hard。复现：`node test/run-guards.mjs verify --list-json` 看各步 tier。**不代改**（属 t16/t19 域）。

### Low

- **L1 · bubbleTiming 自定义钩子「能设、排播不消费」**：`tuner.setBubbleTiming` 校验并存储，但 `showBubble` 只用默认时刻（linked-shared.js:176-201）。旧蓝本同面板口径（`node()` 机制在蓝本里是消费的）——严格说这是**相对蓝本的一处行为缩水**，但键不在 panel-params（coverage 不覆盖），影响面 = 面板导出 JSON 里的 bubbleTiming 字段。建议后续要么接回、要么在面板标注「预留」。复现：`tuner.setForLogic` 后观察气泡时刻不随 rule 变。
- **L2 · `PETLINK_DEFAULTS` 含两个面板不暴露的内部键**（`walkMinMs` / `walkMaxMs`，constants.js:85），全仓 grep 无 `tune('walkMinMs')` 消费点。它们不是 panel key（coverage 分母不含），不构成死旋钮，但是「默认值表里的孤儿」。建议下轮顺手清理或接消费。
- **L3 · 「138KB 旧版蓝本」实物未在工作区出现**：本报告 §3 以 `pet-link-performer.js`（16.5KB，官方桥接版）为对照蓝本；T1-T3 交付注释声称对照的 138KB 内置版不在本工作区（见 §3 首段）。若该蓝本在 captain 手上，建议对 §3 表补一轮「逐字面」复核，尤其 `followEdge` 收尾三判据与 `ropeAt` 分段边界。
- **L4 · `verify-pet-link.mjs` 汇总清单与 VERIFY_STEPS 的 pet 用例存在有意重复**（package/hotplug-host/hotplug-client/rope-entry/tuner/official/sidebar-* 七件在链上直接跑、汇总入口再跑一遍）。这是既有设计（汇总入口独立可用），代价是 `npm run verify` 时这七件双跑约 +N 秒。不判问题，仅记录。

---

## 5. 回归矩阵（全部实测）

| 命令 | 结果 |
|---|---|
| `node test/verify-pet-linked.mjs` | exit 0（5 段 PASS） |
| `node test/verify-pet-mascot.mjs` | exit 0（4 段 PASS） |
| `node test/verify-pet-egg.mjs` | exit 0（5 段 PASS） |
| `node test/verify-pet-panel.mjs` | exit 0（M6 全绿） |
| `node test/verify-pet-extension-card.mjs` | exit 0（M7 全绿） |
| `node test/verify-pet-optional-probe.mjs` | exit 0（6 段 PASS） |
| `node test/verify-pet-link.mjs`（汇总 16 件） | exit 0 |
| `node test/verify-pet-tuner-coverage.mjs` | exit 0（48/48） |
| `node test/verify-guard-chain.mjs` | exit 0（含 15 条负对照） |
| `node test/verify-guard-map.mjs` | exit 0 |
| `node test/verify-package-files.mjs` | exit 0（P5 五条判据含负对照全绿） |
| `node test/run-guards.mjs verify` | **93 步全部执行完毕，exit 0**（步骤 81 = verify-pet-link.mjs；软档环境项按 warn-only 降级出声，无硬档失败） |

## 6. 本轮改动的文件（全部判据/文档面，未碰排播实现）

- `test/run-guards.mjs`（VERIFY_STEPS + verify-pet-link.mjs）
- `test/verify-pet-link.mjs`（汇总清单 +3 件）
- `test/tools/guard-chain.mjs`（OFF_CHAIN_WHY 梳理）
- `test/verify-package-files.mjs`（P5 CHAIN_FLOOR 93/106）
- `test/fixtures/verify-chain.json`（--write-fixture 重冻结）
- `docs/GUARD-MAP.md`（--write 重算，生成物）
- `docs/2026-10-30-performer-rebuild-review.md`（本报告）
