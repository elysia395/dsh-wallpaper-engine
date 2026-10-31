# T6 真蓝本对照校正：mascot（抓绳互动）

> 成员：performer-b（AgentTeams `pet-link-performer-rebuild` · T6）
> 日期：2026-10-30
> 蓝本：`_reference/legacy-pet-link-138k.js`（141551 B，只读，真 138KB 排播实现）
> 范围：`packages/pet-link/src/pet-link/linked-mascot.js`（仅此实现文件 + 本对照表；未动 sidebar / egg / 主包 / shared）
> 前提修正：T2 当时基于 16.5KB `pet-link-performer.js` 与推测实现；本表以真蓝本**逐段重校**，并更正 T4 复审报告 §3 #3/#4 的结论。

---

## 0. 结论（TL;DR）

1. **真蓝本确有缓动**：常量名不是 `PET_ROPE_PULL_EASE`（故直接搜 0 命中）。真实键是 `PET_TUNE_DEFAULTS` 里的 `mascotRopePullEase` / `mascotRopeBackEase`，实现在 `petLinkMascotPlaybackMotion` 的 `ease(t, kind)`（逐帧）与回落路径的 CSS `transition-timing-function`。T4 §3 #3「超出旧版（旧蓝本无缓动）」**应更正为「旧版已有，已对齐」**。
2. **真蓝本确有脱手下落**：`petLinkMascotPlaybackMotion` 在 `releaseAt` 后逐帧写 pet 偏移（页面内 transform，非物理、非 `throwNative`），缓动 easeInOutQuad。T4 §3 #4「超出旧版（旧蓝本无下落）」**应更正为「旧版已有，已对齐」**（新架构等价物 = `link.adoptPosition()` 逐帧写位）。
3. **抓绳时刻 vs 侧栏时刻**：蓝本 `mascotGrabAtMs` 与 `mascotOpenAtMs` 都默认 2500（`PET_MASCOT_GRAB_AT_MS`），即**默认同刻**；两键独立可调，且 legacy 平面 JSON 里 `mascotOpenAtMs` 缺省时**别名回落到 `mascotGrabAtMs`**（`legacy = { …, mascotOpenAtMs: 'mascotGrabAtMs' }`）。
4. **已修一处真差异**：蓝本 `releaseAt = max(grabAt + mascotRopePullMs, mascotReleaseAtMs)`；T2 版直接用了 `mascotReleaseAtMs`，会在下拉未完成时提前弹回。本次已按蓝本改为 max 钳位。
5. **顺带校正缓动曲线**：T2 用二次曲线；蓝本实为 `0→t` / `1→t·t·(3−2t)`（smoothstep）/ `2→1−(1−t)³`（三次缓出）。本次逐字对齐。
6. **遗留需 T5/共享层同步**：`constants.js` 的 5 个 mascot 默认值与真蓝本不一致（见 §4），本任务硬约束不改 shared/常量，已单独报 T5。行为夹具不依赖常量默认（自行覆盖），故本任务判据全绿。

---

## 1. 真蓝本真实实现定位（行号 = `_reference/legacy-pet-link-138k.js`）

| 位置 | 内容 |
|---|---|
| `PET_ROPE_PULL_DOWN = 40`（:235）/ `PET_ROPE_PULL_MS = 800`（:236）/ `PET_ROPE_BACK_MS = 260`（:237） | 绳子下拉距离与时长 |
| `PET_MASCOT_GRAB_AT_MS = 2500`（:182） | 「被抓握往下拖的关键帧」近似时刻；`mascotOpenAtMs` 默认值即它 |
| `petLinkMascotPlaybackMotion`（:1269-1338） | **有回执主路径**：逐帧读 `getPlayback` 求绳位移 + pet 偏移 |
| ↳ `releaseAt = Math.max(grabAt + pullMs, tune('mascotReleaseAtMs'))`（:1278） | 脱手时刻钳位 |
| ↳ `ease = (t, kind) => kind===0?t : kind===2?1−(1−t)³ : t·t·(3−2t)`（:1286） | 绳子三档缓动曲线 |
| ↳ 绳子：`y = down·ease(progress(time,grabAt,pullMs), pullEase)`（:1305-1306）；`y = down·(1−ease(progress(time,releaseAt,backMs), backEase))`（:1307） | 下拉 / 弹回 |
| ↳ 侧栏：`if (!opened && time>=openAt) petLinkSnapOpenSidebar()`（:1311） | 侧栏触发独立于绳子 |
| ↳ 下落：`time>=releaseAt` 后 `offset = {drop.x+dx·k, drop.y+dy·k}`，`k = t<.5?2t²:1−(−2t+2)²/2`（:1322-1325） | 逐帧页面内写位、easeInOutQuad |
| `petLinkPullRopeDown`（:1204-1238） | **无回执回落**：CSS transition，`['linear','ease-in-out','cubic-bezier(0.16,1,0.3,1)']`（:1213） |
| `petLinkMascotDrop`（:1259-1267） | 无回执回落：`petLinkGlide` 逐帧偏移 |
| `petLinkGlide`（:856-885） | 通用位移插值，easeInOutQuad（:873） |
| mascot 分支（:2200-2225） | 走位 → 跳抓主演出（并行 `petLinkRunMascotMotion`）→ 气泡 → 就地等待 |
| `PET_TUNE_DEFAULTS` mascot 段（:2463、2475-2485） | 12 键默认值真源 |
| legacy 别名（:2512） | `mascotOpenAtMs → mascotGrabAtMs` |

---

## 2. 「旧版怎么做 / 新版怎么做 / 差异 / 处置」对照表

| 键 / 能力 | 旧版（真蓝本） | 新版（本次 linked-mascot.js） | 差异 | 处置 |
|---|---|---|---|---|
| `mascotWalkMs` | `walkDuration = walkOverride || max(PET_HOLD.walkLeft, petLinkWalkMs(...))`（:2042-2045）；`PET_WALK_MAX_MS=2600 < 5167` ⇒ 自动恒 5167 | `walkRaw>0 ? walkRaw : PETLINK_HOLD.walkLeft`（:77） | 自动值等价（均 5167）；落点几何不同（见 §3-D） | 已对齐（数值）；落点记 low |
| `mascotTumbleMs` | `hold('mascotTumble') → petLinkHoldOf` 读该键作整段停留（:687-694、2049） | `playSegment(..., tumbleMs)` 限时（:129-147） | 语义一致（控制跳抓段时长） | 已对齐 |
| `mascotGrabAtMs` | `grabAt = tune('mascotGrabAtMs')`，绳子自此时起下拉（:1277、1303） | 同（:62、96-97） | 无 | 已对齐 |
| `mascotOpenAtMs` | `openAt = tune('mascotOpenAtMs')`，`time>=openAt` 弹侧栏（:1279、1311）；默认=grab 2500 | 同（:61、133-137） | 无（默认同刻、可独立调） | 已对齐 |
| `mascotRopeDownPx` | `down = tune('mascotRopeDownPx')`（:1281、1305-1307） | 同（:64、99-104） | 无 | 已对齐 |
| `mascotRopePullMs` | 下拉时长（:1277、1306） | 同（:66、97-99） | 默认值 900≠800（§4） | 实现对齐；默认待 T5 |
| `mascotRopeBackMs` | 弹回时长（:1279、1307） | 同（:67、102-103） | 默认值 600≠260（§4） | 实现对齐；默认待 T5 |
| `mascotRopePullEase` | `ease(t,kind)` 三档（:1286） | `mascotRopeEase` 同曲线（:40-45、91） | T2 曾用二次曲线，已改三次 | **已校正对齐** |
| `mascotRopeBackEase` | 同上（:1286、1307） | 同上（:92） | 默认值 1≠2（§4） | 实现对齐；默认待 T5 |
| `mascotReleaseAtMs` | `releaseAt = max(grab+pull, tune)`（:1278） | 同式（:74） | T2 漏了 max 钳位，已补 | **已校正对齐** |
| `mascotDropPx` | `distance = tune('mascotDropPx')`；target = landingBase.y + distance（:1280、1316） | `dropPx`，相对当前中心下落（:69、116-124） | 落点基准不同（见 §3-D）；默认值 0≠90（§4） | 减帧写位对齐；默认待 T5 |
| `mascotDropMs` | `dropMs = tune('mascotDropMs')`，逐帧 easeInOutQuad（:1280、1322） | 同（:70、117-123） | 默认值 400≠520（§4） | 实现对齐；默认待 T5 |

---

## 3. 三处重点核实（明确结论）

### A. 绳子位移 —— **旧版是「逐帧缓动 + CSS 过渡」两套，均带三档缓动，不是线性**

- **有回执主路径**（`petLinkMascotPlaybackMotion`）：每帧读 `getPlayback().currentTime`，`el.style.transitionProperty='none'` 后逐帧写 `transform`，曲线 `ease(t,kind)`（:1286）。
- **无回执回落**（`petLinkPullRopeDown`）：`transitionProperty='transform'` + `transitionDuration=pullMs/backMs` + `transitionTimingFunction=['linear','ease-in-out','cubic-bezier(0.16,1,0.3,1)'][ease]`（:1222-1232）。
- **结论**：「旧版线性」不成立；`PET_ROPE_PULL_EASE` 搜不到只是常量命名不同。新版对齐为 `mascotRopeEase`：`0→t` / `1→t·t·(3−2t)` / `2→1−(1−t)³`，逐帧 `rt.rope.moveRope(px)`（写 `--we-rope-pull` CSS 变量，页面内零请求）。**处置：保留缓动索引，曲线改为蓝本同源；不删除。**

### B. 脱手下落 —— **旧版是 adoptPosition 等价物（逐帧写页面内偏移），不是物理**

- 蓝本 `time>=releaseAt` 后 `petLinkState.offset = {x+dx·k, y+dy·k}` 并 `petLinkElStyleX(...)`（:1322-1325）——即逐帧写元素 `transform: translate()`，**没有** `throwNative` / 原生 release（`throwNative` 只用于彩蛋一弹飞 :1399-1416）。
- 曲线 = `easeInOutQuad`（`k = t<.5?2t²:1−(−2t+2)²/2`）。
- **新版等价实现**：`applyDrop()` 逐帧 `det.link.adoptPosition({x,y}, petId)`（页面内写位、零 HTTP），同样 easeInOutQuad，距离 `mascotDropPx`、时长 `mascotDropMs`。
- **结论：旧版不是物理，是逐帧页面内写位；新版 adoptPosition 等价。已对齐。** 唯一差异是落点基准（旧版 `landingBase.y + distance`，新版当前中心 + distance，因新架构无 `landingBase` 访问器；见 D）。

### C. 抓绳时刻 vs 侧栏时刻 —— **默认同刻，参数独立，legacy 别名绑定**

- 默认：`mascotGrabAtMs = 2500`（:2463），`mascotOpenAtMs = PET_MASCOT_GRAB_AT_MS = 2500`（:2477）。
- 触发：绳子自 `time>=grabAt` 起下拉（:1303）；侧栏自 `time>=openAt` 弹出（:1311）。二者读不同键，故**可分别调**；默认相等 ⇒ 同一帧发生（用户口径「侧栏弹出在这为吉祥物被抓握往下拖的关键帧」:174-181）。
- legacy 兼容：`mascotOpenAtMs` 在旧平面 JSON 缺省时**别名回落到 `mascotGrabAtMs`**（:2512）。
- **新版**：`grabAtMs` 与 `openAtMs` 分别 `tune`（:61-62），绳子下拉 vs 侧栏弹出分别触发；`releaseAt` 由 `grabAt+pull` 钳位。**已对齐（默认同刻、可独立调）。** 夹具 §5-①/② 分别证明「默认同刻」与「调开后可分离」。

### D. 已知几何差异（low，非本任务阻塞）

| 差异 | 旧版 | 新版 | 影响 / 处置 |
|---|---|---|---|
| 走位落点 | `petLinkMascotStand` 按素材手位锚点（原片 640×360 手位 312/36）把「手」对准绳（:1241-1256、2041） | 走到绳中心 x（`ropeX`）+ 当前中心 y（:76-81） | 身体中心对绳 vs 手对绳，观感差一个手位偏移；需共享层暴露手位锚点，属 T5/几何范畴，记 low |
| 下落落点基准 | `landingBase = {x:绳中心, y:绳下方 +120}`，target = landingBase.y + distance（:2038-2040、1315-1317） | 当前中心 + dropPx（相对） | 绝对锚点 vs 相对位移；位移量与时长一致，落点差一个平移量；记 low |

---

## 4. 默认值偏差清单（需 T5 / `constants.js` 同步，本任务不改 shared）

真蓝本 `PET_TUNE_DEFAULTS`（:2463、2475-2485） vs 新版 `constants.js`（`PETLINK_DEFAULTS`）：

| 键 | 真蓝本 | 新版 constants.js | 状态 |
|---|---|---|---|
| `mascotGrabAtMs` | 2500 | 2500 | ✅ |
| `mascotWalkMs` | 0 | 0 | ✅ |
| `mascotTumbleMs` | 8000 | 8000 | ✅ |
| `mascotOpenAtMs` | 2500 | 2500 | ✅ |
| `mascotRopeDownPx` | 40 | 40 | ✅ |
| `mascotRopePullMs` | **800** | **900** | ❌ 需改 800 |
| `mascotRopeBackMs` | **260** | **600** | ❌ 需改 260 |
| `mascotReleaseAtMs` | 2920 | 2920 | ✅ |
| `mascotDropPx` | **90** | **0** | ❌ 需改 90（否则默认「脱手下落」不显形） |
| `mascotDropMs` | **520** | **400** | ❌ 需改 520 |
| `mascotRopePullEase` | 1 | 1 | ✅ |
| `mascotRopeBackEase` | **2** | **1** | ❌ 需改 2 |

> 处置：`constants.js` 属共享数据层，按 T6 硬约束「不改 shared，向 T5 报」处理；已单独发消息给 `performer-a`（T5）。本任务夹具用 `REAL_DEFAULTS` 显式覆盖，故判据不依赖该表。

---

## 5. 行为夹具（`test/verify-pet-mascot.mjs`，真蓝本对照版）

| # | 证明 |
|---|---|
| ① 基线 | 真蓝本默认下：抓住与侧栏**同刻**（≤80ms）；`releaseAt` 被 `grab+pull=3300` 钳住（下落起点≈3300，非 2920）；绳子下拉≈40px 后弹回 0；脱手 adoptPosition 到 home+90；无逐帧 HTTP（playAnim≤4、getPlayback 逐帧远多） |
| ② 抓/开可分离 | `grabAt=1000, openAt=1800` ⇒ 绳子先动、侧栏后开，各自时刻吻合 |
| ③ 参数敏感度矩阵 | `ropeDownPx` 翻倍→绳位移翻倍；`dropPx` 翻倍→下落距离翻倍；`ropePullMs`↑→releaseAt 后移（下落起点后移）；`ropeBackMs`↑→绳归零更晚；`dropMs`↑→下落更久但终点不变；`tumbleMs=500`→段内事件不发生 |
| ④ 缓动可区分 | `mascotRopePullEase=0` vs `=2` 位置序列 `notDeepEqual`，且三次缓出恒≥匀速、多处严格更高（真蓝本曲线 `1−(1−t)³`） |

---

## 6. 复现命令

```powershell
cd repo-dsh-wallpaper-engine
node test/verify-pet-mascot.mjs            # 全绿（5 段 PASS）
node test/verify-pet-tuner-coverage.mjs    # 48/48 消费，0 死旋钮
node test/verify-pet-linked.mjs            # 四条排播回归全 PASS
node test/verify-pet-egg.mjs               # 彩蛋/共享层回归全 PASS
node test/verify-pet-panel.mjs             # M6 面板回归全 PASS
node scripts/build-client.mjs              # client.pet-link.js 构建通过
```

实测（2026-10-30）：上述命令全部 exit 0；`verify-pet-mascot` 5 段 PASS；coverage 48/48；build 产物 `packages/pet-link/lib/client.pet-link.js` 153800 B（inlined 含 linked-mascot.js）。

---

## 7. 本轮改动文件

- `packages/pet-link/src/pet-link/linked-mascot.js`（缓动曲线对齐真蓝本 / `releaseAt` max 钳位 / 下落 easeInOutQuad / 文档改真蓝本证据）
- `test/verify-pet-mascot.mjs`（真蓝本默认值 + 参数敏感度矩阵 + 同刻/钳位/缓动断言）
- `docs/2026-10-30-performer-rebuild-diff-mascot.md`（本表）

> 未改：`linked-shared.js` / `linked-sidebar.js` / `linked-egg*.js` / `constants.js` / 主包 / 产物不入库。默认值偏差已报 T5。
