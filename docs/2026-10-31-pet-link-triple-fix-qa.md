# pet-link 三处缺陷修复 · QA 交叉验证报告

- **日期**：2026-10-31
- **验证人**：glm-eng2（t4，attempt 3ee5e1fc）
- **性质**：只读交叉验证——读代码 + 跑命令，不采信实现者自述；未改动任何实现文件
- **范围**：t1（PET 锁/冻结只拦自主 + surface 钩子）、t2（WE 热锁时序分阶段）、t3（WE surface 动态取值）

## 结论

**三处改动的验收全部真达成，无 blocker/high 发现。** 全量回归绿（WE 93/93；PET 目标单测 60/60、tsc 0 错）。

| 任务 | 源码核对 | 单测/断言真跑 | 产物同步 | 结论 |
|---|---|---|---|---|
| t1 PET 冻结放行外部点播 | ✅ | ✅ 60/60 | ✅ lib/client.js | 达成 |
| t1 PET surface 三态 | ✅ | ✅（含专项） | ✅ lib/types | 达成 |
| t2 WE 热锁时序分阶段 | ✅ | ✅ 可执行断言真跑 | ✅ client.pet-link.js | 达成 |
| t3 WE surface 动态取值 | ✅ | ✅（含专项） | ✅ client.pet-link.js | 达成 |

## 逐项证据

### t1-① 冻结只拦自主动画、放行外部点播

源码（repo-dsh-pet-dshwe/src/client/pet/animation/animation.ts）：

- 换源带来源标注：`AnimSource = 'external' | 'auto'`（:34），`switchTo` 缺省按「带点播编号 = external」推断（:151）。
- **上锁不吞外部动作**：`setFrozen(true)` 只在 `frontSource === 'auto'` 时 pause 前台并回 `cancelled`（:314-318）——外部点播演到一半上锁，既不暂停也不回 cancelled。
- **冻结期到达的自主换源不偷偷开演**：`onReady` 里 `if (frozen && src === 'auto') { pending = null; el.pause(); return; }`（:230-234）——不升前台、不开播；external 照常推进。
- 冻结期播完不推进自主链（handleEnded :278 回 ignore），但外部点播的 ended 回执照常（:269-273）。

单测（animation.test.ts，真跑通过）：

- 「冻结不会暂停正在播的外部点播，也不回 cancelled」（:298）
- 「冻结期间外部点播仍能连续换源、每段都真正开播」（:317，断言两段都 playCalls=1 且前台翻页）
- 「冻结期间到达的自主换源不升前台、不开播」（:338）
- 「冻结仍拦自主候选：pickNext 不掷骰、不换源」（:350）

### t1-② surface 三态（both→web / 单端→那端 / 缺省→web）

源码（src/client/pet/card/link-control.ts）：

- `resolveSurface(display)`：仅 `'desktop'` → `'desktop'`，`both`/`web`/其余 → `'web'`（:48-51）——与用户规则「both 时只操控 web」一致。
- 控制器 `get surface()` 每次读最新 `deps.display?.()`（:289-291），设置页改 display 立即生效。
- 门面（src/client/link.ts:115-117）：无控制器时 `?? 'web'` 回落。

单测（link-control.test.ts「surface 显示端解析（任务三）」组，真跑通过）：`both / web → web；desktop → desktop；取不到 → web` + `控制器 surface 实时跟随配置`。

类型声明已同步：`lib/types/client/link.d.ts:39` `readonly surface: DisplaySurface`；`link-control.d.ts:174`（surface）与 `:41`（resolveSurface）；`animation.d.ts:8/50`（AnimSource 与 AnimSource 版 switchTo）。

### t2 热锁时序分阶段（动作锁 / 等关闭放 / 回程锁 / 结束释放）

源码（repo-dsh-wallpaper-engine/packages/pet-link/src/pet-link/linked.js）：

- 动作段持锁：`run()` 入口 `acquireLease`（:46），每个 `playAnim` 下发都在持锁下。
- 等关闭放开：sidebar/mascot 进入 waiting 阶段即 `releaseLease(det)` 并记 `releasedForWait`（:80-90）——等待期用户可自由拖/点宠物。
- 放开后不悄悄续回：`renewLease` 首行 `if (!lease) return false`（linked-shared.js:272），lease 已清空则心跳不再续期。
- 回程重锁：仅 `releasedForWait` 为真才重新 `acquireLease`（:97）——egg1/egg2 无等待段全程持锁、不重复 `lock()`（避免 preserveBubble=false 重入清气泡，注释 :93-94 写明理由）。
- 结束完全释放：`finally` 无条件 `releaseLease`（:115），幂等，异常路径也不把锁留在外面。

**可执行断言（不是只改注释）**——verify-pet-linked.mjs 第 9 组（:524-573）真跑通过：

- sidebar/mascot：租约事件流 `deepEqual ['lock','unlock','lock','unlock']`（四段缺一即红）；等待期 ≥200ms 真实存在且中段 `lockedAt === false`；回程每次 `adoptPosition` 写入都 `locked === true`；结束 `isLocked() === false`。
- egg1/egg2：事件流 `['lock','unlock']`（全程持锁到底再释放），动作段全部持锁。

实现靠 harness 的 `lockEvents` 事件流（每次 lock/unlock 记 `{at, op}`）与 `playAnim`/`adoptPosition` 调用时记录的 `locked` 快照断言——判据挂在行为上，删实现必红。

### t3 /anim·/broadcast·/wake 的 surface 动态取值

源码（repo-dsh-wallpaper-engine/packages/pet-link/src/client.js）：

- `petLinkSurface()`（:127-134）读 `probePetApi()?.link?.surface`，仅 `'desktop'` 收窄、其余（缺失/非法）回落 `'web'`。
- `/anim`（:196）与 `/broadcast`（:224）都拼 `'&surface=' + petLinkSurface()`。
- `/wake` 不带 surface——**属实且正确**：dshwe 侧 `sleep.ts:27` 的 `requirePet` 未开 surface 档（对比 `requirePet(params, cfg, { surface: true })` 的用法），带参数虽不致错但无契约依据，注释（client.js:205）与实现一致。
- mode.js:73：surface 给了非法值（非 web/desktop）判 `runtime-too-old` 降级 native；旧运行时无该字段不判过旧。方法清单 `PETLINK_LINK_METHODS`（constants.js:116-121）不含 surface——它是数据字段不是方法，单独校验取值即可，合理。
- desktop 写位端点**真实存在**：repo-dsh-pet-dshwe/src/host/routes/motion.ts:73-104（`POST /position`，`surfaceBlocked` 校验 surface 必填）。链路：`writePosition` 按 `surfaceOf` 分流（linked-shared.js:202-208）→ `rt.positionDesktop` → `petLinkDesktopPosition`（client.js:142-172，60ms 节流 + 末尾补发，x/y 按视口归一化）。

断言（真跑通过）：

- pet-link-anim-request.mjs 第 6 组：`link.surface='desktop'` 时 `/anim`、`/broadcast` 的 URL 都带 `surface=desktop`；`undefined/null/'both'/'any'/'web '/''/42` 七种取值全部回落 `surface=web`。
- verify-pet-linked.mjs 第 10 组：`writePosition` 在 web/缺省 → 只写 `adoptPosition`；desktop → 只触发 `positionDesktop`（不碰页面内 adoptPosition）；非法 `'both'` 回落 web。

## 复现命令

PET 仓（repo-dsh-pet-dshwe）：

```powershell
# 目标单测（沙箱禁子进程时必须加 --test-isolation=none，否则 node --test 起子进程 EPERM）
node --experimental-strip-types --import ./scripts/test-register.mjs --test --test-isolation=none "src/client/pet/animation/animation.test.ts" "src/client/pet/card/link-control.test.ts" "src/client/link.test.ts"
# → tests 60 / pass 60 / fail 0

npx tsc --noEmit   # → 0 错（TSC_EXIT=0）

# 产物锚点核对
Select-String -Path lib/client.js -Pattern 'frontSource','resolveSurface','get surface\(\)','frozen && src === .auto.'
# lib/client.js 581942 bytes @2026-10-31 03:14:31
```

WE 仓（repo-dsh-wallpaper-engine）：

```powershell
node test/run-guards.mjs verify          # → ✓ verify 全部 93 步执行完毕，EXIT=0
node test/verify-pet-linked.mjs          # → 含「PASS T2 热锁时序」「PASS t3 surface 分流写位」
node test/verify-pet-egg.mjs             # → PASS
node test/verify-pet-mascot.mjs          # → PASS
node test/verify-pet-panel.mjs           # → PASS
node test/verify-pet-tuner-coverage.mjs  # → 全部 50 个旋钮都有排播消费者
node test/pet-link-anim-request.mjs      # → 含「PASS surface 动态取值」
```

## 环境备注（非缺陷）

- PET 仓 `npm test`（node --test 默认子进程隔离）在本沙箱因 spawn EPERM 起不来；加 `--test-isolation=none` 单进程跑全部通过。与 t1 自述的「23 条失败均为沙箱 spawn EPERM」一致，属环境限制，测试本体无缺陷。
- WE 仓 verify 链在 t3 收尾时重建过 docs/ROUTE-INDEX.md（45→49 条，入账先前尝试遗留的 pet-install 路由）；本轮 QA 重跑 93 步无短路。
