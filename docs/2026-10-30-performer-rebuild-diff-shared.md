# T5 · 真蓝本对照校正：shared 层 + sidebar

> 蓝本：`_reference/legacy-pet-link-138k.js`（真·内置 pet 版 138.2 KB，只读）。
> 新实现：`packages/pet-link/src/pet-link/{constants,linked-shared,linked-sidebar}.js`。
> 本文档逐块给出「旧版怎么做 / 新版怎么做 / 差异 / 处置」，每行都有处置结论；默认值另附全表。
> 处置图例：**对齐**＝按蓝本实现；**有意替换**＝换机制但行为等价/更好，写明理由；**补齐**＝本次新增缺口；**待他文件**＝需别的分区文件（mascot/egg1/egg2/linked.js）owner 接线，本 T5 硬约束不改。

---

## 0. 本次落地改动（代码）

| 文件 | 改动 |
| --- | --- |
| `constants.js` | `PETLINK_DEFAULTS` 全表按蓝本 `PET_TUNE_DEFAULTS` 逐键校正（见 §1）。 |
| `linked-shared.js` | ① `followEdge` 收尾补回 `openSettled` 门 + 250ms 量测节流（`PETLINK_FOLLOW_MEASURE_MS`），`maxMs` 去掉误加的 `pullMs`；② 新增 `ropeSegmentAt/ropeTimeline`（`releaseAt=max(grab+pull, releaseAtMs)` 夹紧语义）；③ `moveTo` 引入 `easeInOutQuad`；④ `edgeTarget` 增可选 `anchorRatio`；⑤ `returnHome` 增可选 `msOverride`。 |
| `linked-sidebar.js` | `openLead` 起手点/展开时长对齐旧版（`openAtMs=openDelay−openLead`、`openDurMs=slowOpenMs+openLead`），并把 `openState` 传给 `followEdge` 判 `openSettled`；`maxMs` 不带 `pullMs`。 |
| `test/verify-pet-linked.mjs` | 追加「共享层行为夹具」（non-coverage：改参数→输出变）。 |

> 说明：`constants.js` 属 shared/constants 数据域；captain 于 T5 明确把「默认值全表」并入本任务范围，故一并校正。

---

## 1. 默认值全表（`PETLINK_DEFAULTS` vs 蓝本 `PET_TUNE_DEFAULTS` legacy:2452-2503）

「修正后」为本次落盘值。`—` 表示蓝本无该键（新版新增，保留并说明）。

| key | 修正前 | 修正后 | 蓝本 | 依据(蓝本行) | 处置 |
| --- | --- | --- | --- | --- | --- |
| sidebarWalkMs | 5167 | 5167 | 5167 | L69/2454 | 对齐 |
| braceMs | 1000 | 1000 | 1000 | L71/2455 | 对齐 |
| pullMs | 10125 | 10125 | 10125 | L73/2456 | 对齐 |
| slowOpenMs | 8125 | 8125 | 8125 | L74/2457 | 对齐 |
| edgeGapPx | 0 | **-15** | -15 | L319/2467 | 对齐 |
| openLeadMs | 0 | 0 | 0 | L77/2468 | 对齐 |
| openDelayMs | 500 | 500 | 500 | L79/2469 | 对齐 |
| segGapMs | 0 | 0 | 0 | L88/2470 | 对齐 |
| handRightRatio | 0.4875 | **0.5703** | 0.5703 | L310/2466 | 对齐（贴边跑偏的根因之一） |
| followGraceMs | 120 | **200** | 200 | L266/2471 | 对齐 |
| followSpeed | 900 | **3200** | 3200 | L245/2472 | 对齐（旧版按 px/s、防掉帧落后） |
| followStillMs | 120 | **140** | 140 | L247/2473 | 对齐 |
| followStillEps | 0.5 | 0.5 | 0.5 | L918/2474 | 对齐 |
| bubbleMs | 3000 | 3000 | 3000 | L100/2458 | 对齐 |
| bubbleWindowMs | 4000 | 4000 | 4000 | L106/2459 | 对齐 |
| bubbleDurationMs | 3000 | 3000 | — | （内部量） | 保留：内部量，非面板键 |
| lockHeartbeatMs | 20000 | 20000 | 20000 | L111/2460 | 对齐 |
| holdMaxMs | 180000 | 180000 | 180000 | L279/2461 | 对齐 |
| eggAt | 3 | 3 | 3 | L173/2462 | 对齐 |
| mascotGrabAtMs | 2500 | 2500 | 2500 | L182/2463 | 对齐 |
| returnWalkMinPx | 8 | **40** | 40 | L224/2465 | 对齐 |
| mascotWalkMs | 0 | 0 | 0 | L2475 | 对齐 |
| mascotTumbleMs | 8000 | 8000 | 8000 | L2476 | 对齐 |
| mascotOpenAtMs | 2500 | 2500 | 2500 | L2477 | 对齐 |
| mascotRopeDownPx | 40 | 40 | 40 | L235/2478 | 对齐 |
| mascotRopePullMs | 900 | **800** | 800 | L236/2479 | 对齐 |
| mascotRopeBackMs | 600 | **260** | 260 | L237/2480 | 对齐 |
| mascotRopePullEase | 1 | 1 | 1 | L2484 | 对齐 |
| mascotRopeBackEase | 1 | **2** | 2 | L2485 | 对齐 |
| mascotReleaseAtMs | 2920 | 2920 | 2920 | L2481 | 对齐 |
| mascotDropPx | 0 | **90** | 90 | L2482 | 对齐（默认不显下落的根因） |
| mascotDropMs | 400 | **520** | 520 | L2483 | 对齐 |
| egg1EdgeGapPx | 0 | 0 | 0 | L2486 | 对齐 |
| egg1WalkMs | 5167 | **0** | 0（0=auto） | L2487 | 对齐 |
| egg1LeadMs | 600 | 600 | 600 | L186/2488 | 对齐 |
| egg1KickMs | 5167 | 5167 | 5167 | L2489 | 对齐 |
| egg1FlungMs | 10125 | 10125 | 10125 | L2490 | 对齐 |
| egg1LandMs | 5167 | 5167 | 5167 | L2491 | 对齐 |
| egg1FlingPx | 520 | **420** | 420 | L249/2493 | 对齐 |
| egg1FlingMs | 700 | **520** | 520 | L250/2494 | 对齐 |
| egg1FlingPower | 1 | 1 | — | （新面板力度倍数） | 保留：旧版无此键，默认 1 与旧式逐字等价 |
| egg1PostLandMs | 600 | 600 | 600 | L2495 | 对齐 |
| egg2LeadMs | 600 | 600 | 600 | L2496 | 对齐 |
| egg2HissMs | 5167 | 5167 | 5167 | L2497 | 对齐 |
| egg2ShakeAtMs | 1200 | **1750** | 1750 | L2498 | 对齐 |
| egg2ShakePx | 0 | **8** | 8 | L2499 | 对齐 |
| egg2ShakeHz | 8 | **12** | 12 | L2500 | 对齐 |
| egg2OpenAtPct | 35 | 35 | 35 | L2501 | 对齐 |
| egg2OpenEase | 1 | **2** | 2 | L2502 | 对齐 |
| walkMinMs | 400 | **420** | 420 | L230 | 对齐（内部量） |
| walkMaxMs | 6000 | **2600** | 2600 | L231 | 对齐（内部量） |
| eggBubbleLeadMs（旧键） | — | — | 600 | L2488/2496 | 旧版别名键：新版拆成 egg1LeadMs/egg2LeadMs（均 600），不再保留别名 |
| `egg1FlingDelayMs`（旧键） | — | — | 0 | L2492 | 旧版「弹飞启动延迟」死参数（排播零消费）：新版已删，不留骗人旋钮 |

---

## 2. 贴边几何

| 项 | 旧版怎么做 | 新版怎么做 | 差异 | 处置 |
| --- | --- | --- | --- | --- |
| `PET_BODY_LEFT_RATIO=0.3125` / `PET_BODY_RIGHT_RATIO=0.6875`（L291-292） | 身体命中框 `.dsh-pet-hit` 实测；取不到按画布×比例推。用于 `petLinkBodyRightOffset`。 | 新版不再单独量身体框，直接用根 rect 宽度 × `handRightRatio` 换算。 | 旧版多一层"身体→手"的留白修正（`BODY_RIGHT − HAND`）。 | **有意替换**：代数上 `center = edge − size×(handRatio−0.5)` 与旧版 `centerForHandRight` 展开式**逐字等价**；新的 `link.getRoot` 只暴露根 rect，无 `.dsh-pet-hit` 量测面，故用等价式。理由：协议层不提供命中框。 |
| `PET_HAND_RIGHT_RATIO=0.5703`（L310） | 手/肤色检出实测取"抓握帧"值 0.5703。 | 默认值曾误为 0.4875（<0.5 ⇒ 目标中心跑到边缘右侧，方向反）。 | **默认值错**。 | **对齐**：`constants.js` 改回 0.5703；公式不变。 |
| `PET_EDGE_GAP_PX=-15`（L319） | 手右边缘贴到 `W−(−15)=W+15`（压过边缘 15px）。 | 默认 0。 | 默认值错。 | **对齐**：改回 -15。 |
| `petLinkPetRect()`（L778-785） | `document.querySelector('.dsh-pet-root')` 取 rect。 | `det.link.getRoot(petId).getBoundingClientRect()`。 | 取元素方式不同，都返回视口 rect。 | **有意替换**：新版不 `document.querySelector`（多宠物不选错、可脱浏览器单测），语义等价。 |

---

## 3. 跟随与静止判定

| 项 | 旧版 | 新版（T5 前） | 差异 | 处置 |
| --- | --- | --- | --- | --- |
| `PET_FOLLOW_MAX_SPEED=3200`（L245） | px/s；`maxStep = speed×dt`，与帧率解耦。 | 同式，但默认 900。 | 默认值错（慢 3.5×）。 | **对齐**：默认 3200；机制本来就对。 |
| `PET_FOLLOW_STILL_MS=140`（L247） | 用时间不用帧数。 | 同式，默认 120。 | 默认值错。 | **对齐**：140。 |
| `PET_FOLLOW_STILL_EPS=0.5`（L918） | 边缘相邻读数差 < 0.5px 视为未动。 | 0.5。 | 无。 | 对齐。 |
| `PET_FOLLOW_GRACE_MS=200`（L266） | 起手宽限，期间不判静止（防"面板还没动就判完成"）。 | 默认 120。 | 默认值错。 | **对齐**：200。 |
| `PET_FOLLOW_MEASURE_MS=250`（L269） | 边缘每帧读；宠物 rect 基准按 250ms 节流重测（防每帧 getBoundingClientRect 强制布局掉帧）。 | T1 新版**每帧**重测 rect，且**无 openSettled 门**。 | 性能退化 + 收尾判据缺失。 | **补齐**：`linked-shared.js` 新增 `PETLINK_FOLLOW_MEASURE_MS=250`，宠物基准节流、边缘仍逐帧读。 |

### 重点①：`followEdge` 收尾判据（复审点名）

旧版（L2133-2185）收尾 = **四条件全满足**：

1. `openSettled`：侧栏展开流程（`openRun`）已 resolve；未 settled 时**每帧重置** `stillSince`；
2. `now − t0 ≥ followGraceMs`；
3. `now − stillSince ≥ followStillMs`（边缘在 `followStillEps` 内持续不动）；
4. `|wantOff − offset.x| ≤ followStillEps`（**先追上目标**才允许收尾，限速时不半路停）。

且 `maxMs = slowOpenMs + openLead + openDelay + 2500`（**不含 pullMs**）。

T1 新版问题：**漏了 `openSettled` 门**，且 `maxMs` 误加 `pullMs`；虽然已有 grace/still/eps，但缺 openSettled 会在"展开尚未起步"时先判静止（正是用户报的"没有往后同步位移"）。

T5 处置：**对齐**。`followEdge` 接收 `options.openState={opened,at,ms}`，`openSettled()` ＝ `opened && now−at ≥ ms`；未 settled 时每帧重置 `stillSince`；收尾四条件与旧版逐字一致；`maxMs` 去 `pullMs`。侧栏分区在起手展开时写 `openState`（见 §5）。

---

## 4. 落位收尾（`PET_SETTLE_STILL_MS` / `PET_SETTLE_MAX_MS`）

| 项 | 旧版 | 新版 | 差异 | 处置 |
| --- | --- | --- | --- | --- |
| `PET_SETTLE_STILL_MS=220` / `PET_SETTLE_MAX_MS=2600`（L274-275） | `petLinkWaitSettled`：观测**我方 transform 偏移**连续静止 220ms 判稳定，2600ms 硬上限。用于 egg1 被弹飞后"等真正落定再演落地"。 | 新版用 `settleThrow`：等 `link.getNativeThrow(id).active===false`（原生物理权威信号）+ 30s 上限。 | 观测对象不同：旧版观测我方 transform（因为宿主物理它看不到）；新版 `link` 直接暴露原生抛掷句柄。 | **有意替换**：`getNativeThrow().active` 是**权威**落定信号，比"观测 transform 是否抖"更准；旧版之所以只能观测，是因为当年拿不到物理句柄。保留 `SETTLE_*` 语义等价（"等真的停"+"硬上限"），换成权威信号。理由：新协议能力更强。 |

---

## 5. 侧栏节奏（sidebar）

| 项 | 旧版 | 新版 | 差异 | 处置 |
| --- | --- | --- | --- | --- |
| `PET_SIDEBAR_WALK_MS=5167`（L69） | 去程整段走路时长。 | `walkTo(..., tune('sidebarWalkMs'))`。 | 无。 | 对齐。 |
| `PET_BRACE_MS=1000`（L71） | 预备段只演 braceMs（不等完整素材）。 | `playSegment('brace', limit=braceMs)`。 | 无。 | 对齐。 |
| `PET_PULL_MS=10125`（L73） | 后拉段真实时长，用来掐表。 | `playSegment('pull', limit=pullMs)`。 | 无。 | 对齐。 |
| `PET_SLOW_OPEN_MS=8125`（L74） | 侧栏缓慢展开时长。 | `beginPull(openDurMs)`，`openDurMs=slowOpenMs+openLead`。 | T1 用 `slowOpenMs` 未加 openLead。 | **对齐**：展开时长同步 +openLead（保证展开结束时点不因提前起手而提前）。 |
| `PET_OPEN_LEAD_MS=0`（L77） | 展开起手相对**后拉起点**提前 `openLead`（旧版：brace 尾段起手 + openDelay，换算到后拉起点 = `openDelay − openLead`）。 | T1 用 `openAtMs = openDelay − openLead` 但展开时长未 +openLead。 | 起手时刻已对，结束时刻偏早。 | **对齐**：`openAtMs` 保持，`openDurMs` 补 openLead。 |
| `PET_OPEN_DELAY_MS=500`（L79） | 仅推迟展开起手。 | `openAtMs=max(0,openDelay−openLead)`。 | 无（与旧版换算一致）。 | 对齐。 |
| `PET_SEG_GAP_MS=0`（L88） | 段间最小间隙（仅对 hold:0 段生效，默认 0=立刻切）。 | `gap(logic)`：`segGapMs>0` 才真等，否则立即。 | 无。 | 对齐。 |
| 后拉期间贴边 | 走位到位后才起 follow，与 pull/open 并发；`openSettled` 门。 | 同结构（`Promise.allSettled([pullP,openP,followP])`），T5 补 `openState`。 | T1 缺 openState。 | **对齐**（见 §3 重点①）。 |

---

## 6. 位移与朝向函数

| 函数 | 旧版 | 新版 | 差异 | 处置 |
| --- | --- | --- | --- | --- |
| `petLinkGlide(rect,toX,toY,ms,alive)`（L856-885） | 写 `root.style.transform=translate(...)`；easeInOutQuad；基准每次现算减 offset。 | `moveTo` 写 `link.adoptPosition` 绝对中心；T1 为**线性**插值。 | 写位通道 + 缓动曲线。 | **有意替换**（写位）：`adoptPosition` 是协议认可的写位入口（dsh-pet 拥有 inset，旧版只能叠 transform）。**补齐**（缓动）：`moveTo` 引入 `petLinkEaseInOutQuad` 对齐旧曲线。 |
| `petLinkReturnHomeWalk(ms,alive,home,onStart)`（L197-221） | 若 `|dx|>PET_RETURN_WALK_MIN_PX(40)` 播走路段（方向按左右），`duration=max(ms, PET_HOLD[walkKey])`，再 glide，finish，handoff。 | `returnHome`：`|dx|>returnWalkMinPx` 走 walkTo 否则 moveTo；时长 `sidebarWalkMs`（新增可选 `msOverride`）。 | 旧版回程时长按走路素材（≥5167）；新版统一 `sidebarWalkMs`（同 5167），新增 600ms 覆盖能力供 egg1。 | **对齐 + 补齐**：阈值/方向一致；`returnWalkMinPx` 默认改回 40；新增 `msOverride`（彩蛋一回程 600ms，见 §7）。 |
| `petLinkArmFacing()`（L360-410） | 联动期间每 `PET_FACING_TICK_MS(100)` 剥掉视频层 `scaleX(-1)`，收尾按 `data-facing` 还原。 | 新版不起定时器、不碰视频层；朝向由 `rt.playAnim(petId,name,facing)` 下发，`facing()` 从 `pose`/`data-facing` 读。 | 旧版对抗宿主随机链的镜像 bug；新版把朝向交给播放协议。 | **有意不移植**：理由＝新 `link` 协议在 `/anim` 里接收 `facing` 并由宿主渲染侧负责，视频层 `scaleX` 属宿主内部实现；我方不再直接改宿主 DOM（更干净、无定时复写）。若真机仍见镜像，应查协议 `facing` 传递，而非在 shared 层重加 `scaleX` 剥离。 |
| `petLinkPetRect()` | 见 §2。 | 见 §2。 | — | 有意替换（等价）。 |

---

## 7. 重点②：`ropeAt` 分段边界（复审点名）

旧版（`petLinkMascotPlaybackMotion` L1277-1307 / `petLinkRunMascotMotion` L1349-1361）：

```
releaseAt = max(grabAtMs + pullMs, mascotReleaseAtMs)          // ← 夹紧
ms < grabAt            : 0
grabAt ≤ ms < releaseAt: downPx × pullEase(min(1,(ms−grabAt)/pullMs))
ms ≥ releaseAt         : downPx × (1 − backEase(min(1,(ms−releaseAt)/backMs)))
endAt = max(openAt, releaseAt+backMs, releaseAt+(dropPx>0?dropMs:0))
```

关键边界：**`releaseAt` 必须夹紧到 `grabAt+pullMs`**。若面板把 `mascotReleaseAtMs`（默认 2920）设得比 `grabAt+pullMs`（默认 2500+800=3300）小，旧版**仍先拉满 pullMs 再回弹**（`releaseAt=3300`）。

新版（T1 `linked-mascot.js` 内联 `ropeAt`）曾直接用 `tune('mascotReleaseAtMs')` 当分界 ⇒ 会"拉到一半就回弹"。

T5 处置：**对齐 + 补齐**。`linked-shared.js` 新增规范实现：

- `ropeSegmentAt(ms, cfg)`：用夹紧后的 `releaseAt`，`pullEase/backEase` 可注入；分段边界与旧版逐字一致；
- `ropeTimeline(cfg)`：返回夹紧后的 `{grabAtMs,releaseAtMs,pullMs,backMs,endAt}`（`endAt` 同旧式）。

> 注：`linked-mascot.js` 内联 `ropeAt` 已在 T6 由 performer-b 按同一夹紧式对齐（`releaseAt=max(grab+pull,tune)`）。本 T5 的 `ropeSegmentAt` 是**可复用规范实现 + 夹具证据**；按 T5 硬约束未改 mascot 文件。
> 另：旧版**没有** `PET_ROPE_PULL_EASE` 这一常量名——缓动来自面板 ease 索引（0 匀速 / 1 缓入缓出 / 2 缓出），`mascotRopePullEase/BackEase` 存的是索引，切勿按名字硬套成"常量"。新版 `mascotRopeEase(index)` 已按索引映射。

---

## 8. 「旧版有、新版没有」的能力清单

| 能力 | 旧版位置 | 新版现状 | 处置 |
| --- | --- | --- | --- |
| 朝向镜像剥离 `petLinkArmFacing` | L360-410 | 无（交给 `playAnim(facing)`） | **有意不移植**（理由见 §6）。 |
| `petLinkWaitSettled`（观测 transform 稳定） | L1498-1520 | `settleThrow`（原生句柄权威信号） | **有意替换**（理由见 §4）。 |
| 绳子下拉/回弹缓动（ease 索引 + CSS timing / clip 时间） | L1204-1238、L1306-1307 | mascot 内联按 clip 时间 + `mascotRopeEase(index)` | 对齐（缓动是旧版既有能力，非新增）。shared 提供 `ropeSegmentAt` 规范式。 |
| 全屏抖动 `petLinkEggHissMotion` | L986-1067 | egg2 用 `documentElement.animate` WAAPI（T7 已实现） | 对齐（抖动是旧版既有能力，非新增；`egg2Shake*` 默认已改回 8/12/1750）。 |
| 彩蛋计数 far/near 双独立、第 N 次进、触发即清零 | L416、L2347-2356 | 编排层 `tap()`：`farCount/nearCount` 独立、`>=eggAt` 进、进前清零 | 对齐（shared 不插手计数；语义保持一致）。 |
| 彩蛋一踢腿锚点（`anchor(425/640≈0.664)`） | L2028-2029 | `edgeTarget` 用 `handRightRatio` | **补齐能力**：`edgeTarget(det,logic,gapPx,anchorRatio?)` 增可选锚点比例；**待 egg1 文件** owner 传 `425/640`（T5 硬约束不改 egg1）。 |
| 彩蛋一回程固定 600ms | L2303 `petLinkEggReturnHome(600,…)` | `returnHome` 统一 `sidebarWalkMs` | **补齐能力**：`returnHome(det,home,alive,msOverride?)`；**待编排层**（`linked.js`）对 egg1 传 600。 |
| 吉祥物走位手位锚点 `petLinkMascotStand`（原片 312/36） | L1241-1256 | mascot 走「绳中心 x」 | **待 mascot 文件**：需把「手」对准绳（属 mascot 分区）；shared 未涉。 |
| 下落落点绝对锚点（`landingBase.y+dropPx`） | L1259-1266、L1316-1317 | mascot 用「当前中心 + dropPx」相对位移 | **待 mascot 文件**：位移量/时长一致，落点差一个平移；属 mascot 分区。 |
| 弹飞启动延迟死参数 `egg1FlingDelayMs` | L2492 | 已删除 | **有意不移植**：旧版排播零消费的死旋钮，保留即骗人。 |

---

## 9. 行为级夹具（非 coverage）

`test/verify-pet-linked.mjs` 第 6 段「共享层行为夹具」直接构造 `createLinkedKit` 并断言：

1. **followEdge 收尾**：边缘先移动后静止 → 只有「边缘静止 + 累计 `followStillMs` + 追到目标」后才收尾；最终中心贴合 `edge − gap − size×(ratio−0.5)`；逐帧写 `adoptPosition`。
2. **openSettled 门**：`openState.ms=600` 时，收尾不得早于 600ms（证明 T1 漏掉的门已补回）。
3. **followStillMs 灵敏度**：改大 ⇒ 收尾更晚（参数真消费）。
4. **edgeGapPx / handRightRatio 灵敏度**：改参数 ⇒ 目标按 `Δgap` / `size×Δratio` 平移（几何真消费）。
5. **ropeSegmentAt 夹紧分段**：`releaseAt=max(grab+pull,releaseAtMs)`；`ms=3000` 仍在下拉（而非按 2920 提前回弹）；`downPx`/`pullEase` 改 ⇒ 输出按预期变。

> 这些夹具用**显式 tuning 覆盖**驱动，不依赖 `PETLINK_DEFAULTS` 的具体数值，故默认值再调整也不会让夹具变成"恒真"。
