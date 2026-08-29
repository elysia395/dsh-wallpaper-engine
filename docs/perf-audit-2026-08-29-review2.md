# perf-audit-2026-08-29 二次评审报告

> 评审日期：2026-08-29（审计报告同日，HEAD=01a0262）
> 评审对象：`docs/perf-audit-2026-08-29.md`（下称「报告」）
> 方法：4 路独立子代理对报告全部 P0/P1 及抽样 P2/P3/§5 防御项逐行重读当前代码 + 主评审人对 P0-1/2/3/6、P2-10、bundle 数据亲验。
> 评审基准树：当前工作树（= HEAD `01a0262`，lib/ 与 src/ 干净）。

---

## 1. 总体判定

**报告作为修复依据：可靠，但已成「历史快照」，使用前必须做当前树对齐。**

- 逐条复核统计：**45 条结论中 38 条完全确认、7 条部分确认、0 条方向性推翻**。
  机制描述（双重 LZ4 解压、分配风暴、no-store 链、帧时环无消费方、backdrop 4 段链等）全部与代码对上；数字估算（3000 万分配/帧、12 次 Math 调用、guard 2000、权重和 0.999999、saturate=1.15@blur0、200px 侧栏上限等）逐项命中。
- **时效性问题是本次评审的最重要发现**：报告行号与 `4cb5a83^`（审计时工作树）逐字吻合；报告完成后当天，两个修复提交先后落地——
  - `4cb5a83 fix(host): 集成层 H-02..14 + P-03/06/07/10/11/12/14/15`（index.js +473 行）
  - `01a0262 fix(client): GL 管线 G-01..07`（scene-gl.js +~130 行）

  二者已修复报告中的若干子项（§3 清单），且使**报告全部行号漂移**（index.js +55~+330、scene-gl.js 前部 0→尾部 +131、we-renderer +5~+90）。按报告 file:line 直接动手会定位到错误代码。
- §5「已做得好的防御」经四路抽查**全部属实**，无「把已修复当问题」的反向误报；报告自报的 §7 复核状态基本诚实，但 §7.3 对 P2/P3「信任子代理」的部分本次发现 2 处小勘误（§4.2）。

---

## 2. 当前树已过时的报告结论（按报告条目）

| 报告条目 | 状态 | 当前树事实 |
|---|---|---|
| P0-1「FBO 无上限、8K 全尺寸、604MB FBO、浪费 21.5×」 | ⚠️ 量化失真 | `01a0262` G-07 已落地：`makeFBO`（scene-gl.js:215-243）clamp 到 `WE_GL_MAX_DIM=4096`。8192×4608 纹理实际产生 4096×4096 FBO（67MB/个），浪费 ~5.4-8×（对 1920×1080 画布）。**核心结论不变**（FBO 仍跟主纹理而非画布预算，仍 P0），但量级数字与 :396-399/:457-468 行号失效（现为 :528-533, :575-576）。 |
| P0-4 子项「cancel 是死代码、ctrl.abort 无人调用、disposer 不杀 worker」 | ❌ 已修复（半边） | `4cb5a83` P-06 新增卸载 disposer（index.js:2796-2800）遍历 `_sceneAnimInflight` 调 cancel → worker.terminate（:824-829）；aborted 检查已非死代码。**但仍成立**：无条件 `new Worker`（:800）、无全局并发闸、cache key 含 w/h（:766-773）、**scene-frame 渲染 worker 卸载不被终止**（:2542 未传 signal）。 |
| P1-2 子项「/scene-manifest 每请求整包读」 | ❌ 已修复 | `4cb5a83` P-10 已加路由级缓存 `_sceneManifestCache`（LRU 8）+ inflight 去重（index.js:2877-2913）。/scene-resource 主分支问题**依然成立**（见下）。 |
| P1-4 子项「frameCount 无上限」 | ⚠️ 字面已修复 | `4cb5a83` 已加 60s 硬上界（index.js:2711）。30fps×60s=1800 帧仍可达小时级 CPU，量级问题仍在但非「无上限」。 |
| P2-10 子项「帧缓存只增不减」 | ⚠️ 部分推翻 | `4cb5a83` P-12 新增 `gcFrameCacheSync`（index.js:750-762）：sf\* >32 个清最旧。san\_\*/vid\_\*/sv2\_\* 仍无任何 GC（sv1\_ 已 bump 为 sv2\_，:3518）。 |
| P2-9「DXT 全解压 RGBA 上传（scene-gl.js:214）」 | ⚠️ 机制归属修正 | :214 行号失效；RGBA 上传属实（:248）但 **DXT 解压发生在宿主**（scene-resource 供 PNG），S3TC 修复需宿主+客户端两处联动，非 scene-gl 单点。 |

---

## 3. 仍完全成立的核心结论（当前树复核确认）

### P0 全部成立（修复方向不变）

- **P0-1** ✅（核心）：FBO=主纹理尺寸（scene-gl.js:531-532），无画布预算 clamp。G-07 的 4096 clamp 是防崩不是防浪费。
- **P0-2** ✅：帧时环（scene-gl.js:128-132）记录 rAF 间隔 dt（:658-666）非 render 耗时，且 fpsCap 早退在计时之前；消费方仅在 test/，client.js 从不读 `.stats`；无慢帧熔断（G-03 只对连续**抛错**计数）。修复可行性已验证：`client.js:1410-1429` onError→mp4 回退链现成。
- **P0-3** ✅：index.js:793 每次渲染（scene-frame miss :2542 / scene-anim :2717）无条件调 `extractSceneVideoFrames`（:597-681：:628 整包 readFileSync + :637-644 全 .tex 条目 `e.read()` 整条目 LZ4）→ `extractTexVideoMp4`（pkg-extract.js:753-770）内 `parseTexInternal` 逐 mip 再解压一遍；「无视频」结论不缓存（vid_\* 帧缓存检查在全量扫描**之后**，:663）。头部探测修复可行：isVideoMp4 标志在 mip 数据前（pkg-extract.js:359-364）。
- **P0-4 主体** ✅：无条件 new Worker（:800）、无渲染并发闸（`acquireTranscodeSlot` :1213-1219 仅服务转码）、key 含 w/h。
- **P0-5** ✅：24/24 效果每 pass 整帧 `new Uint8Array`（watercaustics.js:34、blur.js:42/73/108、godrays.js:54/82/118/146、lightshafts.js:93）；`_texSample`（model.js:709-735，:728 每次新数组）；applyBlending（math.js:159-200，常规 3-4 个/像素、vividLight 最多 ~9 个）。「25 个 effects」实为 24（`_once.js` 是工具非效果）。
- **P0-6** ✅：`_renderPassthroughLayer` fullscreen 分支（image.js:263-276）全帧拷贝 + 原分辨率效果链，无 `_downsample` 无 staticFrame 门；sway/flag/retro 预处理（:104-118）在降采样（:186-189）之前。静态帧全分辨率确为有意决策（image.js:184-185、integration.js:106 注释）。

### 关键 P1 成立项

- **P1-1**（godrays 误报判定）✅：`_gaussPass` 完整定义于 godrays.js:144-162，7 权重和 0.999999。
- **P1-2 scene-resource 半边** ✅：主分支（index.js:2955）每请求整包读 → scene-manifest.js 同步 parsePkg+parseTexInternal+decodeTex+encodePng（**level 9**，比报告说的 canvas.js level 6 更慢；且 decodeTex 内部再跑一遍 parseTexInternal，实为**三重解析**，比报告说的还多一层）；缓存只挂 fallback 分支（:2960-2978）。
- **P1-3** ✅：scene-gl fetch no-store（:159/:169）；三路由 no-store（index.js:2982/3369/3474，另 scene-frame/anim/runtime 同）；webgl2-unavailable（scene-gl.js:443-444）晚于 meta+shader 串行 fetch（:790, :805-810）；全库无 WebGL2 预检/SwiftShader 嗅探。
- **P1-5** ✅：`[class*="_bubble"]`+`[data-composer-card]` 4 段 backdrop 链（client.js:4219-4226）；glassWindow 默认 true；overlay blur(3px)（:5000-5001）；侧栏 blur 上限 200px（:2800，saturate 有 60 钳制但 blur 没有）。
- **P1-6/P1-7** ✅：applyFontStyles 无缓存全量重写（:2067-2104，对照 scrim 侧 :2059 已有缓存模式）；probe video 成功/缓存命中路径均不销毁（:1568-1578, :1530-1535, :1552-1557；唯一切换壁纸/关开关时清 :1460-1463）。
- **P1-8~P1-12** ✅：GLSL 解释器五重浪费逐项命中（transpile.js:747-750、:919-924、:183-200；executor.js:221-240）；粒子每帧重建+2000 步重模拟（particles.js:17, :155, :161-163）；puppet/model 每帧重建（puppet.js:141-153, :226-243, :680-703；model.js:239, :585-670）；textureCache 无 LRU（core.js:59）+ 双重 parseTexInternal（textures.js:116-121 注释自证）；`_downsample` 无缓存（core.js:806-832）。
- **P2-11/P2-14/P2-15/P2-17/P2-22** 等 ✅ 全部命中（行号见各路复核）。

---

## 4. 报告内需要修正的错误/表述

### 4.1 事实性修正

1. **P1-4「完成产物可静默丢失」需重测定性**：成功路径一直有落盘（index.js:2758 `writeFileSync(cachePath, outBuf)`，旧树 :2564 同样存在）。真实残留窗口是：① :2758 缓存写失败被静默吞；② 失败路径（:2784-2788）只向可能已关闭的 socket 回 422 且**无任何日志**；③ 卸载 abort 发生在渲染尾段。实测「孤儿 2 无产物」需在修复 ①② 后重新取证才能归因。
2. **emit() 调用点 = 109**（client 路实数）：报告正文 P2-6 的 108 接近正确；**§7.2「勘误为 114」反而是错的**——`grep -c` 未剔除 5 行注释（:1776/:2434/:3764/:3983/:4080）。
3. **P2-3「:has()×4」**：源码 4 处属实（:4373/:4415/:4431/:4436），但后 2 处在 `@supports not (backdrop-filter…)` 回退块内，Chromium 下不活跃——实际影响面 2 个活跃选择器。
4. **P0-5「25 个 effects」**：实为 24（`_once.js` 是 `degradedOnce` 工具）。
5. **P0-6 措辞归属**：「用户要求」字样只在 glsl/integration.js:106；image.js:184-185 只写了画质理由（重议静态帧策略时两处注释要一起改）。
6. **P1-2 编码器归属**：主分支用的是 scene-manifest.js 自家 **level 9** 编码器（:872/:894），报告引的 canvas.js level 6（:192-206）是 fallback 分支的——实际比报告说的更慢。
7. **§5 shake.js 例子不精确**：shake.js:57 取的是 RG 双通道（fm[0]+fm[1]），`_texR` 单通道变体不敷使用，需 RG 变体；waterwaves.js:44/tint.js:25 例子成立。
8. **P1-7 措辞**：probe video 非「永久」常驻，换壁纸/关 beta 时会清理；应表述为「该壁纸整个播放期间常驻缓冲整段 MP4」。
9. **base64 占比**：实测 581,036 字符 = src 67.1% / lib 63.5%（lib 现 914KB），报告「880KB 的 69%」量级正确。

### 4.2 行号漂移总表（P0/关键项，当前树）

| 条目 | 报告行号 | 当前行号 |
|---|---|---|
| P0-1 FBO=主纹理 | scene-gl.js:396-399, 457-468 | **:528-533, :575-576** |
| P0-2 帧时环/dt | scene-gl.js:121-125, 540-548 | **:128-132, :655-666** |
| P0-3 整包扫描 | index.js:597-675, 723-729 | **:597-681, :793**（调用路径 :2542/:2717） |
| P0-4 new Worker / key 含 wh | index.js:734, 700-707 | **:800, :766-773** |
| P0-5 _texSample / applyBlending | model.js:695-701, math.js:159-199 | **model.js:709-735, math.js:159-200** |
| P1-2 主分支整包读 | index.js:2718-2721 | **:2955, 缓存 :2998-3055** |
| P1-4 reject 无日志 | index.js:2590-2593 | **:2784-2788** |
| P1-5 气泡链 | client.js:4109-4116 | **:4219-4226** |
| P1-6 fontCustom | client.js:1962-1999 | **:2067-2104** |
| P1-7 probe video | client.js:1463-1474 | **:1568-1578, :1530-1535** |

---

## 5. 复核新发现的问题（报告未列，建议补入）

### Host（lib/index.js）
1. **frames 目录孤儿 `.prog` 永不清理**：sweepTranscodeArtifacts 只扫 transcode/ffmpeg 目录；残留 .prog 让 /scene-anim-progress 永报旧进度，叠加 P2-4 无守卫 1.5s 轮询 = **无限轮询**（建议升 P2 前列）。
2. **scene-frame 渲染 worker 卸载不终止**（:2542 无 signal、无注册表）——P0-4 修复的 ACTIVE_WORKERS 方案须覆盖 scene-frame 半边。
3. **scene-anim 单次渲染三次整包读**：timings 探测（:2668-2669，还无谓分配整块 Canvas）+ extractSceneVideoFrames（:793）+ worker 内 readPkg——应点明合计成本。
4. **worker 超时公式 600s×framesN**（:836）：216 帧=36h，多帧渲染实质无超时兜底，与无并发闸叠加放大孤儿渲染风险。
5. **gcFrameCacheSync 按条数（32）不按字节**：4K PNG 单张 10MB → 上限仍可 300MB+。

### scene-gl
6. **makeFBO 对 w/h 各自独立 clamp 破坏纵横比**（8192×4608→4096×4096，16:9→1:1）：foliagesway 等读 aspect 的效果会失真——修 P0-1 时应**按画布预算等比 clamp**（兼具正确性收益）。
7. **uploadTex 无 MAX_TEXTURE_SIZE 守卫**：8K 纹理本体直接上传。
8. 热路径每帧 Float32Array/数组分配（_weGLQuadMVP :26、_weGLMvpWithZRot :38-39、resVec :571、convertUniform slice :317-319）——并入 P2-7 修复。
9. stats.frameTimes 超 4096 后每帧 splice O(n)——加熔断消费方时顺手改环形索引。

### Client
10. **滑杆 tick applyEffects 双跑**（:2495-2524 直接调 + emit 订阅 :5385 再跑一次）——fontCustom 开启时 style 重写每 tick ×2，去掉直接调用即减半。
11. weDrawFrame 每解码帧读 canvas.clientWidth/Height（:1194-1195）——逐帧布局读，可交给已有 ResizeObserver。
12. WallpaperPicker 每次 emit 全量重算 ratingCounts/typeCounts/hiddenInventoryList/playableInventory/rotationCandidates（:2595-2623，且 :2623 与 :3405 重复）——可按 inventory 代次 memoize。

### CPU 渲染器
13. resolveTransform（core.js:478-515）每对象每帧沿父链对每个祖先 parseVec3——P2-21 未覆盖的逐对象路径（P3 级）。
14. `_attachmentOffset → _puppetBoneFinal`（core.js:421-476）每帧重解 animLayers（findIndex+正则 :443-462）+ 重算全套骨骼——P1-10 同族，修复时应一并覆盖。
15. bloom.js 存在两份完整重复实现（:6-122 死代码 vs :127-243 实际使用）——维护性问题。

---

## 6. 对修复路线图的修订意见

报告 §4 的波次划分整体合理，按当前树调整：

**第 1 波修订**：
- 项 1（FBO clamp）不变，但实现改为**等比 clamp 到画布预算**（顺带修 §5-6 纵横比坑）；预期收益数字按 4096² 基线重算（5.4-8×，非 21.5×）。
- 项 4（worker 治理）须显式纳入 **scene-frame worker**（新发现 #2）与**多帧超时兜底**（新发现 #4）。
- 项 5（P1-4）降级为「失败路径补日志 + 缓存写失败不静默 + frameCount 上限已有 60s 后的量级评估」，**先重测再定修复**（§4.1-1）。
- 新增：frames 目录孤儿 .prog 清扫（新发现 #1，一行 sweep 目录的事，收益是断掉无限轮询）。

**第 2/3 波**：P1-2 修复只需做 /scene-resource 半边（scene-manifest 缓存已有）；P2-9 标注为跨 host+client 联动；P2-10 收窄为 san\_\*/vid\_\*/sv2\_\* 三类 + GC 改字节预算。

---

## 7. 结论

报告的**技术判断质量高**：45 条复核无一方向性错误，P0 归因（8K 效果链、无熔断、同步整包扫描、无并发闸、分配风暴、降采样盲区）全部在当前树成立，§5 防御清单诚实准确，「先实测取证再归因」的方法论（CDP A/B、逐线程采样、孤儿渲染观测）为结论提供了扎实锚点。

报告的**主要缺陷是时效管理**而非技术深度：它定格在 `4cb5a83^`，而同日两个修复提交改变了 6 处子项的事实状态与全部行号；此外 P0-1 的量化因不知 G-07 clamp 而高估约 2×，P1-4 的「静默丢失」归因需要在补日志后重新取证。

**建议**：按 §4.2 行号总表与 §2 过时清单对原报告做一次「当前树对齐」修订（或直接以本文为准执行），再启动第 1 波修复。
