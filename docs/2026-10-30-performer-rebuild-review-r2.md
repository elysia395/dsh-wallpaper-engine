# performer-rebuild 第三轮复审报告（T8）— 基于真蓝本 138.2 KB 重做对齐表

> 复审人：qa-ds（AgentTeams `pet-link-performer-rebuild` · T8 · 独立复审）
> 日期：2026-10-30
> 蓝本：`_reference/legacy-pet-link-138k.js`（141551 B / **2581 行**，只读）
> 复审对象：`repo-dsh-wallpaper-engine/packages/pet-link/src/pet-link/*` 及装配层 `src/pet-link.js`，产物 `packages/pet-link/lib/client.pet-link.js`
> 契约：**不改实现 / 不碰主包 / 不重打包 / 不部署 / 蓝本只读**（本报告只写这一个文档文件）

---

## 0. 方法、口径与「作废上一份」

- **作废 T4 对齐表**：T4（`docs/2026-10-30-performer-rebuild-review.md` §3）以 16.5 KB `packages/pet-link/src/pet-link-performer.js` 当「旧版」，得出「旧版无缓动 / 无抖动 / 无逐帧跟随」等结论——已被 T6/T7 用真蓝本证伪。本报告**一律以真蓝本 2581 行为唯一「旧版」依据**。
- **每行必须有证据**：本报告每条结论都带 `蓝本行号` 或 `新版 file:line`；凡「旧版没有」类结论，必附 grep 全仓 0 命中或反证——否则不写。
- **独立性**：复审人与三个实现者同为 `group/deepseek`，故不采信「实现者说已对齐」，全部回到源码逐段核对。
- **判据绿 ≠ 移植真**：本报告第 3 节对 6 处旧版关键时序做**行为等价判断**（而非只跑判据），第 4 节另列判据未覆盖的缺口。

---

## 1. 旧版能力对齐表（重做 · 逐项：旧版 / 新版 / 结论）

处置图例：**已对齐**＝按蓝本等价实现；**有意替换**＝换机制但行为等价/更强，附理由；**仍缺失/缩水**＝行为不等价。

### 1.1 默认值全表（`_reference` `PET_TUNE_DEFAULTS` legacy:2452-2503 ↔ `constants.js` `PETLINK_DEFAULTS` :53-88）

| key | 蓝本值 | 蓝本行 | 新版值 | 新版行 | 结论 |
|---|---|---|---|---|---|
| sidebarWalkMs | 5167 | 2454/69 | 5167 | :56 | 已对齐 |
| braceMs | 1000 | 2455/71 | 1000 | :56 | 已对齐 |
| pullMs | 10125 | 2456 | 10125 | :56 | 已对齐 |
| slowOpenMs | 8125 | 2457 | 8125 | :56 | 已对齐 |
| edgeGapPx | −15 | 2467/319 | −15 | :57 | 已对齐 |
| openLeadMs | 0 | 2468 | 0 | :57 | 已对齐 |
| openDelayMs | 500 | 2469/79 | 500 | :57 | 已对齐 |
| segGapMs | 0 | 2470 | 0 | :57 | 已对齐 |
| handRightRatio | 0.5703 | 2466/310 | 0.5703 | :57 | 已对齐 |
| followGraceMs | 200 | 2471/266 | 200 | :59 | 已对齐 |
| followSpeed | 3200(px/s) | 2472/245 | 3200 | :59 | 已对齐 |
| followStillMs | 140 | 2473/247 | 140 | :59 | 已对齐 |
| followStillEps | 0.5 | 2474 | 0.5 | :59 | 已对齐 |
| bubbleMs | 3000 | 2458 | 3000 | :61 | 已对齐 |
| bubbleWindowMs | 4000 | 2459 | 4000 | :61 | 已对齐 |
| lockHeartbeatMs | 20000 | 2460 | 20000 | :63 | 已对齐 |
| holdMaxMs | 180000 | 2461 | 180000 | :63 | 已对齐 |
| eggAt | 3 | 2462 | 3 | :65 | 已对齐 |
| mascotGrabAtMs | 2500 | 2463/182 | 2500 | :65 | 已对齐 |
| mascotOpenAtMs | 2500 | 2477/182 | 2500 | :67 | 已对齐（默认与 grab 同刻） |
| eggBubbleLeadMs→egg1LeadMs/egg2LeadMs | 600 | 2488/2496/186 | 600 / 600 | :74/:83 | 已对齐（拆两键，值同） |
| returnWalkMinPx | 40 | 2465/224 | 40 | :65 | 已对齐 |
| mascotWalkMs | 0 | 2475 | 0 | :67 | 已对齐 |
| mascotTumbleMs | 8000 | 2476/125 | 8000 | :67 | 已对齐 |
| mascotRopeDownPx | 40 | 2478/235 | 40 | :69 | 已对齐 |
| mascotRopePullMs | 800 | 2479/236 | 800 | :69 | 已对齐 |
| mascotRopeBackMs | 260 | 2480/237 | 260 | :69 | 已对齐 |
| mascotRopePullEase | 1 | 2484 | 1 | :70 | 已对齐 |
| mascotRopeBackEase | 2 | 2485 | 2 | :70 | 已对齐 |
| mascotReleaseAtMs | 2920 | 2481 | 2920 | :72 | 已对齐 |
| mascotDropPx | 90 | 2482 | 90 | :72 | 已对齐 |
| mascotDropMs | 520 | 2483 | 520 | :72 | 已对齐 |
| egg1EdgeGapPx | 0 | 2486 | 0 | :74 | 已对齐 |
| egg1WalkMs | 0(auto) | 2487 | 0 | :74 | 已对齐 |
| egg1LeadMs | 600 | 2488/186 | 600 | :74 | 已对齐 |
| egg1KickMs | 5167 | 2489/126 | 5167 | :75 | 已对齐 |
| egg1FlungMs | 10125 | 2490/126 | 10125 | :75 | 已对齐 |
| egg1LandMs | 5167 | 2491/126 | 5167 | :75 | 已对齐 |
| egg1FlingPx | 420 | 2493/249 | 420 | :79 | 已对齐 |
| egg1FlingMs | 520 | 2494/250 | 520 | :79 | 已对齐 |
| egg1PostLandMs | 600 | 2495 | 600 | :81 | 已对齐 |
| egg2LeadMs | 600 | 2496 | 600 | :83 | 已对齐 |
| egg2HissMs | 5167 | 2497/127 | 5167 | :83 | 已对齐 |
| egg2ShakeAtMs | 1750 | 2498 | 1750 | :85 | 已对齐 |
| egg2ShakePx | 8 | 2499 | 8 | :85 | 已对齐 |
| egg2ShakeHz | 12 | 2500 | 12 | :85 | 已对齐 |
| egg2OpenAtPct | 35 | 2501 | 35 | :85 | 已对齐 |
| egg2OpenEase | 2 | 2502 | 2 | :85 | 已对齐 |
| egg1FlingPower | —（蓝本无） | — | 1（力度倍数，默认 1 时等价） | :79 | **有意替换**（新面板扩展键，旧版无；`speed×1` 逐字等价，见 1.5） |
| `egg1FlingDelayMs`（弹飞启动延迟） | 0 | 2492 | 已删除 | — | **有意不移植**（口径修正）：蓝本确实消费它——`petLinkEggRebound` 里作 rebound 前 delay（`await petLinkWait(delay)` L1425，默认 0）。新版把 `petLinkEggRebound` 整段简化为单次 `rebound(true,240)`（见 4-F2），该 delay 随段省略；默认 0 时无手感差异。它**不在 48 面板键内**，删除不构成死旋钮 |
| walkMinMs / walkMaxMs（内部量，非面板键） | 420/2600 | 230-231 | 420/2600 | :87 | **孤儿默认值**：蓝本 `petLinkWalkMs` 用它们 clamp，但因 `PET_HOLD.walk*(5167) > 2600`，auto 恒为 5167；新版直接恒 5167 —— 行为等价但两键在新版无消费者（见 4-F3） |

> 全表 47 个面板键 + 2 个内部键逐一核对：**默认值全部与真蓝本一致**（T5 §1 的校正已落盘，本报告独立复核 `constants.js:53-88` 与蓝本逐字相符）。

### 1.2 贴边几何与量测

| 能力 | 旧版（蓝本行号） | 新版（file:line） | 结论 |
|---|---|---|---|
| 宠物 rect | `petLinkPetRect()` `document.querySelector('.dsh-pet-root')` L778-785 | `rectOf` → `det.link.getRoot(petId).getBoundingClientRect()` linked-shared.js:78-85 | **有意替换**：协议暴露 getRoot，不再 querySelector（多宠不选错、可脱浏览器单测），等价 |
| 手右边缘贴边 | `centerForHandRight`：`center = edge − gap − size×(ratio−0.5)`（L840-856、L2165） | `edgeTarget` linked-shared.js:250-263；`followEdge` wantX :339 | 已对齐（代数逐字同式） |
| 身体命中框留白 | `PET_BODY_LEFT/RIGHT_RATIO` L291-292 多一层 BODY-HAND 修正 | 无（直接用根 rect 宽×handRatio） | **有意替换**：新协议无 `.dsh-pet-hit` 命中框，等价式已由 T5 §2 论证 |
| 跟随 rect 基准节流 250ms | `PET_FOLLOW_MEASURE_MS=250` L269，L2157-2162 | `PETLINK_FOLLOW_MEASURE_MS=250` linked-shared.js:25、:332-336 | 已对齐 |

### 1.3 跟随与静止判定（逻辑一「拉」）

| 能力 | 旧版（L2128-2185） | 新版（`followEdge` linked-shared.js:287-359） | 结论 |
|---|---|---|---|
| openSettled 门 | L2131-2132 / L2152-2156（未 settled 每帧重置 stillSince） | :300-305 / :327-330 | 已对齐 |
| followGraceMs 宽限 | L2152、L2174 | :288、:327、:348 | 已对齐 |
| 累计静止 followStillMs + eps | L2151-2156、L2175 | :289-290、:327-330、:348 | 已对齐 |
| 先追上目标才收尾 | L2176 `|wantOff−offset.x|≤eps` | :348 `|wantX−baseX|≤eps` | 已对齐 |
| 位移上限按 dt（px/s×秒） | L2167-2171 | :341-345 | 已对齐 |
| maxMs = slowOpen+openLead+openDelay+2500（不含 pullMs） | L2135 | :296-298 / linked-sidebar.js:63 | 已对齐 |
| **额外**：目标中心 clamp 到 [half, W−half] | 无（L2165 不 clamp） | :339-340 | **新增护栏**（见 4-F4，行为上仅在极端越界时生效，low） |

### 1.4 绳子分段与脱手下落（逻辑二）

| 能力 | 旧版（`petLinkMascotPlaybackMotion` L1269-1338） | 新版（linked-shared + linked-mascot） | 结论 |
|---|---|---|---|
| releaseAt 夹紧 | `releaseAt=max(grab+pull, mascotReleaseAtMs)` L1278 | `ropeTimeline` :394-406 / `ropeSegmentAt` :376-392；mascot 用 kit 版 linked-mascot.js:90-96 | 已对齐 |
| 绳子下拉/弹回缓动 | `ease(t,kind)` 0→t /1→t²(3−2t)/2→1−(1−t)³ L1286；L1305-1307 | `mascotRopeEase` linked-mascot.js:62-67；`ropeAt` :94-96 | 已对齐 |
| 绳子位移逐帧写 | `el.style.transform` 逐帧 L1308-1309 | `rt.rope.moveRope(px)`（写 CSS 变量）linked-mascot.js:118-120 | **有意替换**（写位通道：宿主拥有 transform，改写成 CSS 变量，页面内零请求），等价 |
| 脱手下落曲线 | easeInOutQuad `k=t<.5?2t²:1−(−2t+2)²/2` L1322-1324 | `petLinkEaseInOutQuad` linked-shared.js:28-30；`applyDrop` linked-mascot.js:132-143 | 已对齐 |
| 下落落点 | 绝对值 `landingBase.y+dropPx` L1315-1317 | `dropTarget = landingBase.y + dropPx` linked-mascot.js:111-116 | 已对齐 |
| 下落写位 | `petLinkState.offset` + `petLinkElStyleX` L1324-1325 | `det.link.adoptPosition(...)` :137-140 | **有意替换**（协议写位入口），等价 |
| 抓/开时刻分离 | grabAt(L1277/1303) 与 openAt(L1279/1311) 分别消费，默认同 2500 | linked-mascot.js:78-79、:147-153 | 已对齐 |
| 下落计时基准 | clip 时间 `progress(time,releaseAt,dropMs)` L1322 | 墙钟 `(rt.now()−dropStart)/dropMs` :134 | **微差**（见 4-F5，播放 1:1 时等价，low） |

### 1.5 彩蛋一（踢开并弹飞）

| 能力 | 旧版（L2245-2308 / L1399-1419） | 新版（linked-egg1.js） | 结论 |
|---|---|---|---|
| 踢腿站位锚点 | `edge−egg1EdgeGapPx−anchor(425/640)` L2028-2029 | `edgeTarget(gap=egg1EdgeGapPx, ratio=425/640)` :35 | 已对齐（T9 接线） |
| 段序列 | walk→eggLead→eggKick→**eggPause 120ms**→eggFlung→eggSettle→eggLand L2051-2052、2246-2292 | walk→lead(:40)→kick(:45)→**120ms**(:50)→flung(:56)→settle(:62)→land(:66) | 已对齐（含 120ms，T7 补） |
| 弹飞初速公式 | `speed=min(3200, Px*1000/max(100,Ms)); vx=−speed; vy=−min(1600,speed*.65)` L1404-1406 | `startThrow`：`speed=min(3200,(Px*1000)/ms)*power; vx=−speed; vy=−min(1600,speed*.65)` linked-shared.js:481-496 | 已对齐（power 默认 1 逐字等价；power 为新面板倍数） |
| 落定判定 | `petLinkWaitSettled` 观测 transform 静止 L1498-1520 | `settleThrow` 等 `getNativeThrow().active===false` | **有意替换**：原生物理句柄是权威落定信号（更强），等价 |
| 落地停留 | `egg1PostLandMs` L2291 | `wait(postLandMs)` :70 | 已对齐 |
| 回程 600ms | `petLinkEggReturnHome(600,…)` L2303 | `returnHome(...,600)` linked.js:82-84 | 已对齐（T5 提供 msOverride，编排层传 600） |
| **撞击回弹编排** | `petLinkEggRebound` L1421-1468：open 240→等边沿接触→**起弹→close 180→等回位→reopen 300** | 仅 `sidebarCall('rebound', true, 240)` 一次（linked-egg1.js:59），且 fling 与 rebound 同刻在段首 tick | **缩水**（见 4-F2，medium） |

### 1.6 彩蛋二（站立哈气）

| 能力 | 旧版（`petLinkEggHissMotion` L986-1067） | 新版（linked-egg2.js） | 结论 |
|---|---|---|---|
| 全屏抖动目标 | `document.documentElement` L1002/1030 | `document.documentElement` :50/62-66 | 已对齐 |
| 6 帧关键帧 + 纵向 0.625 | L1030-1034、L1029 | :62-66、:61 | 已对齐（振幅/0.625/composite:add/linear/Infinity 逐字） |
| 按 currentTime 控频 | `currentTime=(currentTime−shakeAt)*Hz*1000` L1048 | `(ms−shakeAtMs)*shakeHz` :100 | 已对齐 |
| overflow clip + 还原 | L1025-1028 / L1010-1013 | :56-59 / :71-75 | 已对齐 |
| prefers-reduced-motion | L1021-1024 | :48-49 | 已对齐 |
| 侧栏按进度 seek + 缓动 | `syncOpen().seek(eased)`，ease 三式 L1049-1056 | linked-egg2.js:98-112、`egg2OpenEaseFn` :20-25 | 已对齐 |
| 回收气泡 | `bubbles.defaultHide('egg2')` L2244 | `kit.hideBubble()` :117 | 已对齐 |

### 1.7 编排层 / 计数 / 气泡 / 占用 / 朝向

| 能力 | 旧版 | 新版 | 结论 |
|---|---|---|---|
| far/near 双独立计数、第 N 次、触发即清零 | L2347-2356 | linked.js:119-127（`farCount/nearCount`、`>=eggAt`、清零） | 已对齐 |
| 停留等侧栏关闭/上限 | `petLinkWaitSidebarClose`+holdMaxMs L2193-2199 | linked.js:74-79（`isOpen` 轮询至 holdMaxMs） | 已对齐 |
| 位置交接 handoff | `petLinkHandoffPosition` adopt+resetOffset L1093-1102 | 无显式 handoff | **有意替换**：新版全程 `adoptPosition` 绝对写位且持久，无 transform 偏移可 reset ⇒ 天然完成交接，等价 |
| 自绘气泡 + allowBubble 窗口 | 原生 `/broadcast` + `allowBubble(ms)` + `bubbleDuration` L1116-1184 | `createPetLinkBubble` bubble.js:38-88；`showBubble` linked-shared.js:188-212（`allowBubble(bubbleWindowMs)` + `canBubble` + 自绘） | **有意替换**（自绘覆盖层，不占用宠物原生三通道气泡），等价；`bubbleWindowMs` 真消费 |
| 朝向镜像剥离 | `petLinkArmFacing` 每 100ms 剥 `scaleX(-1)` L360-410 | 无；朝向由 `playAnim(petId,name,facing)` 下发 | **有意不移植**：facing 交给播放协议，宿主渲染侧负责，不再改宿主 DOM（理由见 T5 §6） |
| 独占锁 + 心跳续期 | `petLinkAnimLock` TTL 60s L1146-1159 | `acquireLease`/`renewLease`（`lockHeartbeatMs` 真续期、TTL=2×心跳）linked-shared.js:132-162 | **有意替换**：把固定 TTL 变面板可调心跳续期（更强），等价 |
| **气泡时间节点（bubbleTiming 自定义钩子）** | `petLinkBubbleTiming`/`setBubbleTiming` + `petLinkCreateBubbleTimeline`（show/hide 按 action/edge/offset 调度）L1841-2012 | 面板可设（`setBubbleTiming` pet-link.js:148-156、panel 编辑器 panel.js:190-241）但**排播零消费**（showBubble 只吃 `bubbleMs`） | **仍缺失/缩水**（见 4-F1，medium） |

---

## 2. 三处点名定性

### 2.1 followEdge 收尾判据 —— **已对齐（且判据有行为夹具）**

- 蓝本收尾 = 四条件全满足（L2174-2176）：`openSettled && now−t0≥followGraceMs && now−stillSince≥followStillMs && |wantOff−offset.x|≤eps`；未 `openSettled` 时每帧重置 `stillSince`（L2152-2156）。
- 新版 `followEdge`（linked-shared.js:287-359）逐条实现：`openSettled()` :300-305、重置静止计时 :327-330、四条件收尾 :348；`maxMs` 不含 pullMs :296-298、linked-sidebar.js:63。
- **行为夹具**（非 coverage）：`test/verify-pet-linked.mjs` §6(b) 用 `openState.ms=600` 证明 `openSettled` 未满足前不早收尾（:293-299）；§6(a/c/d) 证静止/到位/几何真消费。
- 结论：**已对齐**。T1 曾漏 `openSettled` 门、误加 pullMs，T5 已补回，本轮复核确认在位。

### 2.2 ropeAt 分段边界 —— **已对齐（夹紧式逐字一致）**

- 蓝本：`releaseAt=max(grabAt+pullMs, mascotReleaseAtMs)`（L1278）；`ms<grabAt→0`、`grabAt≤ms<releaseAt→down·pullEase`、`ms≥releaseAt→down·(1−backEase)`（L1303-1307）；`endAt=max(openAt,releaseAt+backMs,releaseAt+dropMs)`（L1282）。
- 新版 `ropeSegmentAt`（linked-shared.js:376-392）、`ropeTimeline`（:394-406）逐字实现夹紧与分段；mascot 实际调用 kit 版（linked-mascot.js:90-96），**不再内联裸用 releaseAtMs**。
- **行为夹具**：`test/verify-pet-linked.mjs` §6(e) 断言 `releaseAtMs=3300`、`ropeSegmentAt(3000)=25`（夹紧后 ms=3000 仍在下拉，而非按 2920 提前回弹）、3300 拉到底、3400 回弹（:332-344）；`verify-pet-mascot` 基线断言 `dropFirstClip≈max(grab+pull)=3300`（:249-251）。
- 结论：**已对齐**。

### 2.3 L1（`bubbleTiming` 面板钩子可设但排播不消费）—— **仍缺失（既未接回、也未标注预留）**

- 面板确实**对用户渲染**了「气泡时间节点」编辑器：`panel.js:190-241 buildBubbleEditor`，且 `:368` 对每个 spec 调用；改动经 `petLink.tuner.setBubbleTiming`（panel.js:218）落到 `state.bubbleTiming`。
- 但**排播消费面 0 命中**：`linked-shared.js` 全文 `grep bubbleTiming` = **0 命中**；气泡时长始终 `tune('bubbleMs')`（linked-shared.js:205）。构建产物 `lib/client.pet-link.js` 中 `petLinkCreateBubbleTimeline` = **0 命中**（蓝本消费者 L1869-2012 未移植）。
- 蓝本对应能力是**真消费**的：`petLinkBubbleTiming` 读规则、`petLinkCreateBubbleTimeline` 按 `show/hide` 的 `action/edge/offsetMs` 编排节点（L1841-2012）。
- **面板是否有「预留」标注**：`grep 预留|暂|未接入|不生效` 于 panel.js / pet-link.js / linked-shared.js = **0 处相关标注**（只有「联动暂不可用」状态文案）。即 **未在面板标注预留**。
- 结论：**L1 未处理**。这是「能设、能导出、能持久化，但排播不消费」的骗人旋钮，正是本项目要消灭的类别；且 T4 低估了影响面（T4 以为「仅影响导出 JSON」，实际面板对用户渲染了可编辑控件）。见 4-F1。

---

## 3. 六处旧版关键时序 · 等价性判断（移植真实性，不看判据绿）

| # | 时序 | 蓝本证据 | 新版证据 | 等价判定 |
|---|---|---|---|---|
| 1 | **侧栏后拉展开延迟** | `openLead=min(openLeadMs,braceMs)`、`openDelay`；`startOpen` 先 wait(openDelay) 再 slowOpen（L2085-2119）；超时 `slowOpenMs+extraMs`（L1683-1689） | `openAtMs=max(0,openDelay−openLead)`、`openDurMs=slowOpenMs+openLead`（linked-sidebar.js:36-41）；openP 墙钟 wait(openAtMs) 后 `beginPull(openDurMs)`（:57-60） | **等价**。默认(openLead=0) 与 openLead>0 两分支起止时刻均与蓝本代数一致（open 起 = braceEnd+openDelay−openLead，dur=slowOpenMs+openLead）。唯一差异：起手用墙钟而非等 pull 点播确认（linked-sidebar.js:55-56 已注理由：防短素材死锁，生产等价）→ 记为**有意替换**。 |
| 2 | **跟随静止确认** | openSettled+grace+still+到位四条件（L2174-2176） | followEdge 四条件逐字（linked-shared.js:327-348） | **等价**（见 2.1）。额外 clamp 目标（:339-340）仅在越界时生效，常规路径不触发（low）。 |
| 3 | **绳子回弹** | `down·(1−backEase((ms−releaseAt)/backMs))`、backEase∈{t,t²(3−2t),1−(1−t)³}（L1286/1307） | `ropeSegmentAt` 回弹段 `downPx*(1−backEase(p))`（linked-shared.js:390-391）+ `mascotRopeEase`（linked-mascot.js:62-67） | **等价**。曲线三档逐字；`verify-pet-mascot` ease0≠ease2 位置序列可区分（:318-335）。 |
| 4 | **脱手下落** | easeInOutQuad 逐帧写位，落点 landingBase.y+dropPx（L1322-1324、1315-1317） | `petLinkEaseInOutQuad`+applyDrop adoptPosition，落点 landingBase.y+dropPx（linked-mascot.js:132-143、111-116） | **等价**。曲线/落点/时长一致；计时由 clip→墙钟微差（4-F5，low）。 |
| 5 | **弹飞初速** | `speed=min(3200, Px*1000/max(100,Ms)); vx=−speed; vy=−min(1600,speed*.65)`（L1404-1406） | startThrow 同式 ×power（linked-shared.js:481-496） | **等价**（power 默认 1）。方向/上限/比例 0.65 逐字。 |
| 6 | **哈气抖动** | documentElement WAAPI 6帧/0.625/currentTime×Hz/clip/reduced-motion（L1021-1048） | linked-egg2.js:48-77、98-112 逐字 | **等价**。关键帧/频率/裁剪/无障碍门限全对齐。 |

**六处结论：全部等价**（#1 有一处已文档化的墙钟替换；#4 有一处低危计时基准微差）。无 high。

---

## 4. 额外发现（判据未覆盖 / 需决策）

### F1 ·【medium】`bubbleTiming` 自定义气泡时间节点「能设、排播不消费」（= L1 未处理）
- 证据：面板渲染编辑器 `panel.js:190-241`（:368 调用）、写 `state.bubbleTiming`（:218）；排播 `linked-shared.js` `grep bubbleTiming` = **0**，气泡时长恒 `tune('bubbleMs')`（:205）；构建产物 `petLinkCreateBubbleTimeline` = **0**；无「预留」标注。
- 影响：用户在面板里调整「出现/隐藏 · 动作节点 · 偏移」后，气泡时刻完全不变——正是本项目要消灭的骗人旋钮类别。蓝本此能力真消费（L1841-2012）。
- 复现：见 §6 的 L1 复现命令。
- 建议二选一（由 captain 定）：① 接回：在 `showBubble` 或其上层按 `state.bubbleTiming[id]` 的 show/hide 规则调度；或 ② 若确认本轮不做自定义节点，应在面板该区块显式标注「预留/暂不生效」并在 `DISPLAY_ONLY_WHY` 之外登记，避免骗人。

### F2 ·【medium】egg1「撞击→回弹→再展开」编排被简化为单次 `rebound(true,240)`
- 蓝本 `petLinkEggRebound`（L1421-1468）：`rebound(true,240)` → 轮询 `edgeX` 等到撞击点 `370/640` → **`petLinkFlingAway` 起飞** → `rebound(false,180)` 收回 → 等回位 → `rebound(true,300)` 完整展开。
- 新版（linked-egg1.js:56-62）：eggFlung 段首个 tick 立即 `startThrow` **且仅** `sidebarCall('rebound', true, 240)` 一次；无 close/reopen、无「等边沿接触再起飞」。
- 影响：侧栏「被弹回再展开」的撞击回弹观感缺失；弹飞与侧栏接触不同步。功能不崩（仍弹飞、侧栏仍开），属移植保真缩水。`verify-pet-egg` 未覆盖此段（只断言段时长/间距/锚点/回程）。
- 建议：如需 1:1，按蓝本三阶段 + `edgeX` 门已具备的 `sidebarCall('rebound')`/`sidebarCall('edgeX')` 接线补回。

### F3 ·【low】`walkMinMs` / `walkMaxMs` 为 `PETLINK_DEFAULTS` 孤儿键（= T4 L2，仍在）
- `constants.js:87` 有值，全仓 `grep tune('walkMinMs')` = 0。二者非 panel key（coverage 分母不含），不构成死旋钮；且蓝本因 `PET_HOLD.walk=5167>2600` 使 auto 恒 5167，本就无实effect。建议清理或注明。

### F4 ·【low / informational】`followEdge` 目标中心 clamp 到 [half, W−half]
- linked-shared.js:339-340 对 `wantX` 做边界 clamp，蓝本 L2165 无。属**新增护栏**（防宠物写出屏幕），常规路径（edge 合法且宠物在屏内）不触发，不改变手感。记录以示与蓝本非同字节。

### F5 ·【low】mascot 下落计时基准 clip→墙钟
- 蓝本 `progress(time,releaseAt,dropMs)` 用 clip 时间（L1322）；新版 `(rt.now()−dropStart)/dropMs`（linked-mascot.js:134）。播放 1:1 推进时等价；仅在卡帧时略有差异（旧版卡帧不前进、新版按墙钟推进）。可接受。

### F6 ·【low】注释/文档行号漂移（不影响运行）
- `linked-shared.js:367-368` 注释仍称「linked-mascot.js 的内联 ropeAt 直接用 releaseAtMs」——实际 mascot 已改用 `kit.ropeTimeline/ropeSegmentAt`（linked-mascot.js:90-96），注释过时。
- `docs/...-diff-egg.md` 引用 `startThrow L339-355`，实际 L481-496（编辑后漂移）。建议后续订正。

> 另核对：T4 的 L3（真蓝本不存在于工作区）已由本轮 `_reference/legacy-pet-link-138k.js` 消解；T4 §3「旧版无缓动/无抖动/无逐帧跟随」结论随之作废。

---

## 5. 回归矩阵（全部实测，命令见 §6）

| 判据 | 结果 | 证据 |
|---|---|---|
| `verify-pet-linked` | exit 0 | 尾部含「T5 共享层行为夹具：followEdge 收尾…+ ropeSegmentAt 夹紧分段」PASS |
| `verify-pet-mascot` | exit 0 | 「参数敏感度矩阵…」「缓动可区分（真蓝本曲线）…」「M5 抓绳互动（真蓝本对照·T9）…」PASS |
| `verify-pet-egg` | exit 0 | 「egg1…425/640…回程 600ms」「共享层 lockHeartbeatMs/bubbleWindowMs」「T10/T7 彩蛋…」PASS |
| `verify-pet-panel` | exit 0 | 「分组参数+缓动+持久化+导入导出+a11y+拖动+开关」PASS；EN 13 分组无中文残留 |
| `verify-pet-extension-card` | exit 0 | 「具名处理器…」「无契约违规…」「M7 设置页扩展卡片…」PASS |
| `verify-pet-optional-probe` | exit 0 | 「无 petApiDshwe→native」「有 petApiDshwe.link→linked」6 段 PASS |
| `verify-pet-tuner-coverage` | exit 0 | 参数真源 **48** 个 key，已消费 **48**，`✓ 全部 48 个旋钮都有排播消费者（无一死旋钮）` |
| `node test/run-guards.mjs verify` | exit 0 | `verify 全部 93 步执行完毕`，`tests 109 / pass 109 / fail 0` |
| 构建产物 | 未重建（硬约束不重打包） | `lib/client.pet-link.js` = 155932 B，含 `createLinkedPetProvider`/`followEdge`/`ropeSegmentAt`/`petLinkEggHissMotion`（与最新源码一致） |

> 计数说明：任务书提到「49 键」，但判据 `verify-pet-tuner-coverage.mjs` 从 `panel-params.js` 实测解析出 **48** 个 `key:'…'`（`:48` 处，脚本靠正则统计，无重复 key）。实际运行输出即为「参数真源：48 个 key / 已消费 48」。48/48 全消费是**机判真实**结论；「49」与本轮实测 48 的差异属任务书笔误/账面口径，不影响「零死旋钮」判定（以判据实跑为准）。

---

## 6. 复现命令

在 `repo-dsh-wallpaper-engine` 目录执行：

```powershell
# 0) 蓝本与新版定位
Select-String -Path ..\_reference\legacy-pet-link-138k.js -Pattern 'releaseAt = Math.max|function petLinkEggHissMotion|function petLinkMascotPlaybackMotion|petLinkBubbleTiming|petLinkCreateBubbleTimeline' | Select-Object LineNumber,Line

# 1) 目标判据
node test/verify-pet-linked.mjs
node test/verify-pet-mascot.mjs
node test/verify-pet-egg.mjs
node test/verify-pet-panel.mjs
node test/verify-pet-extension-card.mjs
node test/verify-pet-optional-probe.mjs
node test/verify-pet-tuner-coverage.mjs

# 2) 全量守护链（93 步 / 109 tests）
node test/run-guards.mjs verify

# 3) F1（L1）复现：bubbleTiming 面板可设、排播不消费
Select-String -Path packages\pet-link\src\pet-link\linked-shared.js -Pattern 'bubbleTiming'          # 期望 0 命中（排播不读）
Select-String -Path packages\pet-link\src\pet-link\linked-shared.js -Pattern "tune\('bubbleMs'\)"     # showBubble 唯一时长来源
Select-String -Path packages\pet-link\src\pet-link\panel.js -Pattern 'setBubbleTiming|buildBubbleEditor'  # 面板确实渲染编辑器
(Select-String -Path packages\pet-link\lib\client.pet-link.js -Pattern 'petLinkCreateBubbleTimeline' -AllMatches | Measure-Object).Count  # 期望 0

# 4) F2 复现：egg1 撞击回弹被简化
Select-String -Path packages\pet-link\src\pet-link\linked-egg1.js -Pattern "sidebarCall\('rebound'"   # 仅 1 处 rebound(true,240)
#   对照蓝本三阶段：
$r = Get-Content ..\_reference\legacy-pet-link-138k.js; $r[1421..1467]   # petLinkEggRebound：open240→等接触→fling→close180→等回位→reopen300

# 5) F3 复现：孤儿默认键
Select-String -Path packages\pet-link\src\pet-link\constants.js -Pattern 'walkMinMs|walkMaxMs'
(Select-String -Path packages\pet-link\src\pet-link\*.js -Pattern "tune\('walkMinMs'\)" | Measure-Object).Count   # 期望 0
```

---

## 7. 结论

- **重做的对齐表**（§1）逐项给出「旧版(蓝本行号) / 新版(file:line) / 结论」，默认值全表与真蓝本一致。
- **三处点名**：`followEdge` 收尾 —— **已对齐**（四条件逐字 + 行为夹具）；`ropeAt` 分段 —— **已对齐**（夹紧式逐字 + 夹具）；**L1 `bubbleTiming` —— 仍缺失**（面板渲染编辑器但排播零消费，且未标预留）。
- **六处关键时序**（侧栏展开延迟/跟随静止/绳子回弹/脱手下落/弹飞初速/哈气抖动）—— **全部等价**，无 high。
- **回归**：7 个目标判据 + `run-guards verify`（93 步 / 109 tests）**全绿**。
- **整体**：核心移植（48 旋钮真消费、followEdge/ropeAt、6 时序、彩蛋计数、睡醒/占用/气泡窗口）**忠实**；遗留两处需 captain 决策的 **medium**：**F1 `bubbleTiming`**（接回或标预留）、**F2 egg1 撞击回弹编排简化**。二者均**非阻塞主交付**（不发崩溃/不影响 48 旋钮），但按「不留骗人旋钮 / 1:1 移植」的项目标准应登记跟进。另有 3 条 low（孤儿默认键、clamp 护栏、注释漂移）。
