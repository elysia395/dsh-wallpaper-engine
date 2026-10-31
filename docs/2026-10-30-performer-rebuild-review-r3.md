# performer-rebuild 终审报告（T13 / 第四轮）— F1/F2 修复验证 + 全量回归

> 复审人：qa-ds（AgentTeams `pet-link-performer-rebuild` · T13 · 终审/独立复审）
> 日期：2026-10-30　（attempt 3 · 复跑定稿）
> 蓝本：`_reference/legacy-pet-link-138k.js`（2581 行，只读）
> 复审对象：`packages/pet-link/src/pet-link/*`（linked-shared / linked-egg1 / panel-params …）、`src/pet-link.js`、产物 `packages/pet-link/lib/client.pet-link.js`
> 契约：**不改实现 / 不碰主包 / 不重打包 / 不部署**（本报告只写这一个文档；复审方未重建产物）

---

## 0. 结论（二态）

- **F2（T11）：已关闭。** egg1 回弹确为三阶段（open240→等边沿接触→fling→close180→等回位→reopen300），接触锚点 **370/640**（≠踢腿 425/640），「弹飞启动延迟」参数已恢复且真消费。
- **F1（T12）：已关闭。** `bubbleTiming` 由面板可设 → 排播真消费（`createBubbleRun` 按 `{action,edge,offsetMs}` 触发 show/hide；起点/终点锚点、duration 隐藏各有断言），非"能编辑不生效"中间态。

**回归全绿**：7 个 pet-link 判据 + `verify-pet-link` 全 smoke + `verify-i18n`(49) 全 exit 0；**`node test/run-guards.mjs verify` = 93/93 exit 0（109 tests）**；主包 `src/` 零改动；产物已重建并与源码同步（`verify-client-sync` PASS）。

> 前次（attempt 2）曾因「产物未随 T11/T12 重建」判 needs_revision；本轮产物已重建（见 §4），该阻塞已解除。

---

## 1. F2（T11）egg1 回弹三阶段 —— **已关闭**

| 验收线 | 证据（新版 file:line / 命令） | 结论 |
|---|---|---|
| 三阶段：open240 → 等接触 → fling → close180 → 等回位 → reopen300 | `linked-egg1.js:52-81 rebound()`：`move(true,240)`(L62) → `waitFor(edge≤contact+1)`(L64) → `startThrow`起飞(L68) → `move(false,180)`(L70) → `waitFor(edge≥initialEdge-1)`(L71) → `move(true,300)`(L74) → `wait(300)`(L75)。逐字对应蓝本 `petLinkEggRebound` L1447-1461。 | 已关闭 |
| 接触锚点 = **370/640**（躯干），非踢腿 425/640 | `linked-egg1.js:57 contact = rect.left+rect.width*(370/640)`；踢腿位仍用 `425/640`（`linked-egg1.js:85`）。 | 已关闭 |
| 「弹飞启动延迟」参数**已恢复且真消费** | 面板 `panel-params.js:82`（弹飞位移组「弹飞启动延迟（毫秒）」）；默认 `constants.js:79`=**0**（=蓝本 L2492/L1425 默认 0）；消费 `linked-egg1.js:33/53 tune→wait`。coverage 机判该键在 49 个消费键内。 | 已关闭 |
| 不是「多调了两次 API」 | `rebound()` 由边沿读数驱动（`waitFor` 轮询 `edgeX`，缺读数按阶段时长兜底）；夹具用「介于 370/640 与 425/640 之间」的 missEdge 区分：错用 425/640 会立即起飞，实测 miss 时 `flingDelay>1000ms`。 | 已关闭 |

行为夹具 `test/verify-pet-egg.mjs` §5.5（:390-446）PASS：`rb.length≥3` 且 `[true,240]/[false,180]/[true,300]`、fling 夹在展开与收起之间、close→reopen 时序、`contact425−contact370>10` 且 missEdge 命中 370 兜底、`delay+300ms→起飞后移≈300ms`。`node test/verify-pet-egg.mjs` exit 0。

---

## 2. F1（T12）bubbleTiming 面板钩子 —— **已关闭（真消费）**

实现证据（`linked-shared.js`，蓝本 `petLinkCreateBubbleTimeline` L1870-2012 等价物）：
- 规则来源：`bubbleRules()` = `state.bubbleTiming[specId]`（面板覆盖）＋ `PETLINK_BUBBLE_DEFAULTS`（`:226-231`）。
- 工厂默认与蓝本逐字一致：`linked-shared.js:43-59` ≡ 蓝本 `PET_BUBBLE_DEFAULTS` L1824-1840（sidebar show pull/7000·hide duration/5000；egg1Angry show eggKick/0·hide duration/5000；egg1Land show eggFlung/0·hide duration/15000；egg2 hide duration/5000）。
- 节点求值：`timeOf()`（`:271-282`）——`default` 不求值、`duration` 取 `track.at+offset`、其余取段节点 `start/endWall+offset`（正偏移等真实锚点、负偏移可预测），同蓝本 L1917-1926。
- 段推进真接入：`playSegment` 的 `segmentBegin/Update/End` → `bubbleRun.segment*`（`:593/:605/:619`），`pump()` 每 tick `now>=target` 触发真 show/hide；编排层 `linked.js:67 beginBubbles / :84 pumpBubbles / :103,:184 endBubbles`。
- 旧 `showBubble/hideBubble` 降级为 `defaultShow/defaultHide` 语义（`:316-324, 348-377`）。

行为夹具 `test/verify-pet-linked.mjs` PASS：§7（起点 offset 500→≈500ms、1500→≈1500ms；终点 −500→≈D−500、−1500→≈D−1500，改 offset 出现时刻平移≈1000ms）；§8（duration 隐藏 offset 500/1500→显示后 ≈500/1500ms 隐藏）。`node test/verify-pet-linked.mjs` exit 0。

---

## 3. 回归矩阵（本轮实测）

| 项 | 结果 |
|---|---|
| `verify-pet-linked` | **exit 0**（含 §7/§8 气泡时间节点夹具） |
| `verify-pet-mascot` | **exit 0** |
| `verify-pet-egg` | **exit 0**（含 §5.5 F2 三阶段回弹） |
| `verify-pet-panel` | **exit 0**（含 T14 duration+offset300000 可存/回读） |
| `verify-pet-extension-card` | **exit 0** |
| `verify-pet-optional-probe` | **exit 0** |
| `verify-pet-tuner-coverage` | **exit 0；49/49**（「参数真源：49 key / 已消费 49 / ✓ 全部 49 个旋钮都有排播消费者」；分母已随 T11 恢复键 48→49） |
| `verify-pet-link.mjs`（完整 smoke） | **exit 0** |
| `verify-i18n` | **exit 0 / PASSED(49)**（T11 恢复字段的漏译已补） |
| **`node test/run-guards.mjs verify`** | **exit 0；「✓ verify 全部 93 步执行完毕」tests 109 / pass 109 / fail 0** |
| 主包 `src/` 零改动 | **✓**（`git status --porcelain -- src/` = 0 行） |

> 说明：第 25 步 `verify-glass-runtime` 本轮**正常执行并通过**（无 `ACCESS_VIOLATION`）；本轮全链一次跑通 93/93。第 26 步 `verify-glass-runtime-browser` 属既有软档（warn-only，降级不拦），非失败。

---

## 4. 产物状态（`packages/pet-link/lib/client.pet-link.js`）

| 项 | 值 |
|---|---|
| 大小 | 169277 B = **165.31 KB** |
| sha256 | `828530d0c344b098384e047975b4270c6bd9f835f7488b565d820224c4e20a38` |
| 内含 F1/F2 标记 | `createBubbleRun`×2、`beginBubbles`×3、`egg1FlingStartDelay`×5、`Fling start delay`×1 |
| `verify-client-sync`（产物 vs 按当前 src 重建，LF 比较） | **PASS**（`828530d0c344 · 169277 B`，与重建一致） |

- 「产物重打包」现状：**已重建**（由交付方为把 T11/T12 修复同步进产物而重建；理由充分——否则 `verify-client-sync` 会判产物过期、强制 verify 链短路，如 attempt 2 所见）。产物为 gitignore 构建输出（`git ls-files` = 0），非 release 打包。
- 「对当前 src 与产物各验一次」：**src 侧** —— 7 个 fixture + smoke 全绿（fixture 直接加载 src）；**产物侧** —— `verify-client-sync` PASS 证明产物字节 == 当前 src 的构建结果，即产物含与 src 相同的 F1/F2 逻辑；标记计数亦证实。两侧一致。

---

## 5. T8 三条 low 的现状（未处理 + 归属）

| 编号 | 内容 | 现状 | 归属 |
|---|---|---|---|
| low-1 | `walkMinMs`/`walkMaxMs` 孤儿默认键 | **未处理**：`constants.js:89` 仍在，`tune` 消费=0 | shared/constants（T5，performer-a） |
| low-2 | `followEdge` 目标中心 clamp（`[half,W-half]`，蓝本无、新增护栏） | **未处理（保持原样）**：`linked-shared.js:504` 仍在；行为良性 | shared（T5） |
| low-3 | `linked-shared.js:531` 注释仍称「mascot 内联 ropeAt 直接用 releaseAtMs…会拉一半就回弹」 | **未处理（过时注释仍在）** | shared 注释（T5） |

三条均非本轮阻塞项，留下轮清理。

---

## 6. 复现命令

`repo-dsh-wallpaper-engine` 目录下：

```powershell
# F1/F2 逐条判据（直接加载 src）
node test/verify-pet-linked.mjs     # §7 起点/终点锚点 + §8 duration → PASS
node test/verify-pet-mascot.mjs
node test/verify-pet-egg.mjs        # §5.5 F2 三阶段回弹(370/640+延迟)
node test/verify-pet-panel.mjs
node test/verify-pet-extension-card.mjs
node test/verify-pet-optional-probe.mjs
node test/verify-pet-tuner-coverage.mjs   # → 全部 49 个旋钮都有排播消费者
node test/verify-pet-link.mjs
node test/verify-i18n.mjs                 # → PASSED (49)

# 全链
node test/run-guards.mjs verify           # → ✓ verify 全部 93 步执行完毕（109 tests）

# 产物与源码同步 + 标记
node test/verify-client-sync.mjs          # → CLIENT SYNC CHECKS PASSED
node -e "const s=require('fs').readFileSync('packages/pet-link/lib/client.pet-link.js','latin1');for(const p of ['createBubbleRun','beginBubbles','egg1FlingStartDelay','Fling start delay'])console.log(p,s.split(p).length-1)"

# 主包零改动
git status --porcelain -- src/            # 期望空
```
