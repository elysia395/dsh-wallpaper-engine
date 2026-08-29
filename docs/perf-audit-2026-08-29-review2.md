# perf-audit-2026-08-29 二次评审报告（修复执行交接版）

> 评审日期：2026-08-29 ｜ 评审基准树：`01a0262`（HEAD，lib/ 与 src/ 工作区干净）
> 评审对象：`docs/perf-audit-2026-08-29.md`（下称「原报告」，定格于 `4cb5a83^` 工作树）
> 评审方法：4 路独立复核代理（scene-gl / host index.js / CPU 渲染器 / client.js）对原报告全部 P0/P1/P2 逐条重读当前代码 + 主评审人对 P0-1/2/3/6、P2-10/16/18/19/20/21/23/24/27、bundle 数据亲验。
> 本文档面向**执行修复的 agent**：含每条结论的当前树状态、精确锚点、修复规格与验收方法。

---

## 0. 使用须知（重要）

1. **不要用原报告的 file:line 直接定位。** 原报告写于 `4cb5a83^`；当天随后两个提交使其全部行号漂移：
   - `4cb5a83 fix(host): 集成层 H-02..14 + P-03/06/07/10/11/12/14/15`（index.js +473 行，偏移 +55~+330）
   - `01a0262 fix(client): GL 管线 G-01..07`（scene-gl.js +~130 行，偏移 0→+131；client.js 偏移 0→+131；we-renderer +5~+90）
2. 本文档所有行号均为**当前树**行号，但仍建议以**符号锚点**（函数名/常量名/CSS 类名）grep 定位后再动手。
3. 状态图例：✅=二次复核确认成立；⚠️=部分成立（含义见条目）；❌=当前树已过时/已修复，**不要修**；◇=未二次复核，沿用原报告结论（方向可信，行号需重锚）。

---

## 1. 总体判定

**原报告技术判断质量高，可作为修复依据；主要缺陷是时效管理。**

- 复核统计：**P0×6、P1×12、P2×27 全部给出当前树判定**（38 ✅ / 7 ⚠️ / 0 条方向性推翻，另有 5 处子项❌已过时）；P3 抽查 8 项全部命中。
- 机制描述（双重 LZ4 解压、分配风暴、no-store 链、帧时环无消费方、backdrop 4 段链等）全部与代码对上；数字估算（3000 万分配/帧、12 次 Math 调用、guard 2000、权重和 0.999999、saturate=1.15@blur0、侧栏 200px 上限等）逐项命中。
- §5「已做得好的防御」经四路抽查**全部属实**，无「把已修复当问题」的反向误报。
- 例外：原报告 §7.2 的「emit() 勘误为 114」**本身是错的**（grep 未剔除 5 行注释；正文 108 更接近，实测 109）。

---

## 2. 已过时/已修复清单（执行前必读，这些不要再修）

| 原报告条目 | 状态 | 当前树事实（锚点） |
|---|---|---|
| P0-1 的「FBO 无上限」表述 | ❌ 半边过时 | G-07 已落地：`makeFBO` clamp 到 `WE_GL_MAX_DIM=4096`（scene-gl.js:85, :215-243）。8K 纹理实际 FBO=4096²，**但 FBO 仍跟主纹理而非画布预算——核心问题仍在，见 §3 P0-1** |
| P0-4 子项「cancel 死代码、ctrl.abort 无人调用」 | ❌ 已修复 | 卸载 disposer 遍历 `_sceneAnimInflight` 调 cancel → worker.terminate（index.js:2796-2800, :824-829）。scene-anim 半边已通；**scene-frame worker 仍未覆盖（见 N-02）** |
| P1-2 子项「/scene-manifest 每请求整包读」 | ❌ 已修复 | 路由级缓存 `_sceneManifestCache`（LRU 8）+ inflight 去重（index.js:2877-2913） |
| P1-4 子项「frameCount 无上限」 | ❌ 字面已修复 | 60s 硬上界（index.js:2711）；30fps×60s=1800 帧仍有小时级量级问题（⚠️ 降级为量级评估） |
| P2-10 子项「sf 帧缓存只增不减」 | ❌ 已修复 | `gcFrameCacheSync`：sf\* >32 个清最旧（index.js:750-762，挂在 :2557）；san\_\*/vid\_\*/sv2\_\* 仍无 GC |
| P2-10 子项「sv1\_ 前缀」 | ❌ 已 bump | 现为 sv2\_（index.js:3518），旧 sv1\_ 文件同样无清扫 |
| P2-18「视频抽帧临时文件名固定（pid+i）→并发竞态」 | ❌ 已修复 | H-02：tmp 键已纳入内容 hash（index.js:653-658 `dsh-we-vid-<pid>-<i>-<contentHash>`） |

### P1-4 需重新定性（重要）

原报告「完成产物可静默丢失」的归因**证据不足**：成功路径一直有落盘（index.js:2758 `writeFileSync(cachePath, outBuf)`，旧树同款）。真实残留窗口：
1. :2758 缓存写失败被静默吞掉；
2. 失败路径 :2784-2788 只向（可能已关闭的）socket 回 422、**无任何日志**（对比 degraded 事件有日志 :2731-2733）；
3. 卸载 abort 发生在渲染尾段。

**执行要求**：先补 ①② 两项日志/错误处理，再按 §9 孤儿渲染复现命令重新取证，才能确认「孤儿 2 无产物」的真正归因。不要直接按原报告结论大改流程。

---

## 3. P0 执行卡（全部成立，修复方向不变）

### P0-1 scene-gl 效果链 FBO 按主纹理尺寸渲染 ✅（量化需更新）

- **锚点**：`scene-gl.js:531-532`（`fboA/fboB = makeFBO(mainTexEntry.w, mainTexEntry.h)`）、`:575-576`（链按 FW/FH=主纹理尺寸跑）；画布预算由 client 侧 `sceneViewportSize()` 决定（client.js:1467-1471，≤1920×1080×dpr2）。
- **量化修正**：受 G-07 影响，8192×4608 纹理 FBO 实为 4096×4096（67MB/个），每帧 ~67M 片元（非 150M），浪费 ~5.4-8×（非 21.5×）。实测症状（GPU RSS 1GB+、SwiftShader 1fps）不受影响。
- **修复规格**：
  1. 链 FBO **等比** clamp 到画布预算（对齐 CPU mp4 路径 ≤1920×1080 语义）；**不要**沿用 makeFBO 现有的 w/h 各自独立 clamp——8192×4608→4096×4096 会把 16:9 压成 1:1，foliagesway 等读 aspect 的效果失真（N-06，正确性收益）。
  2. `uploadTex`（scene-gl.js:244-258）补 `MAX_TEXTURE_SIZE` 守卫（纹理本体目前无守卫，N-07）。
  3. 可选：按实测帧时自适应降档链分辨率。
- **验收**：§9 A/B 实验主线程 CPU 从 92%+ 降至接近 GL OFF 基线；GPU RSS 显著回落；foliagesway 场景目视无 aspect 失真。

### P0-2 无低帧率熔断/自动降级 ✅

- **锚点**：帧时环 scene-gl.js:128-132；`pushFrameTime(dt)` 的 dt 是 rAF 间隔（:658-666 `now - lastNow`），**非 render 耗时**，且 fpsCap 早退（:660-665）在计时之前；消费方仅 test/scene-gl-e2e/\*，client.js 从不读 `.stats`；G-03 只对连续**抛错**计数（:682-692），对慢不熔断。
- **修复规格**：
  1. 在 `render(t)` 前后取 `performance.now()`，滑窗 p95 帧时 > 阈值（如 200ms）持续数秒 → `onError({reason:'slow', permanent:false})`；
  2. 客户端**零改动**复用现有回退链（client.js:1410-1429 onError → markSceneGLFailed + queueSceneAnimUpgrade）；
  3. 顺手把 frameTimes 超 4096 后的每帧 `splice` O(n)（:131）改环形索引（N-09）。
- **注意**：与 P1-3 的 WebGL2 预检/SwiftShader 嗅探同属「防止进入灾难路径」，建议同批做。

### P0-3 渲染前主线程同步整包读 + 双重 LZ4 解压扫描，无 memoize ✅

- **锚点**：调用点 index.js:793（`renderSceneFrameInWorker` 内，scene-frame miss :2542 与 scene-anim :2717 两条路径无条件经过）；函数体 :597-681——:628 `readFileSync` 整包、:637-644 遍历全部 .tex `e.read()`（readPkgEntry 整条目 LZ4，pkg-extract.js:279-305）→ `extractTexVideoMp4`（pkg-extract.js:753-770）内 `parseTexInternal` 逐 mip 再解压一遍。vid_\* 帧缓存检查（:663）在全量扫描**之后**；「无视频」结论不缓存。
- **修复规格**（按收益排序，①②即可解决绝大部分）：
  1. `Map<abs+mtimeMs+size, videoRefs[]>` memoize（失效键可复用现有 `sceneCacheStamp` index.js:723-745）；
  2. 头部探测代替全解压：TEXB0004 的 isVideoMp4 标志在 mip 数据前（pkg-extract.js:359-364，只需条目头部 ~64B）；TEXB1-3 只需 mip0 首 LZ4 块（≤4KB）判 ftyp（判定逻辑参照 pkg-extract.js:758-766）；
  3. 只扫 scene.json materials 实际引用的纹理；
  4. 扫描移入 worker（与 dsh GUI 同进程，秒级阻塞直接可见）。
- **关联**：scene-anim 单次渲染合计**三次**整包读（timings 探测 :2668-2669 + 本条 :793 + worker 内 readPkg），修复时一并考量（N-03）。

### P0-4 渲染 worker 无全局并发闸 ✅（取消/卸载子项见 §2 已修部分）

- **仍成立**：无条件 `new Worker`（index.js:800）；无渲染并发闸（`acquireTranscodeSlot` :1213-1219 + `TRANSCODE_MAX_CONCURRENT=2` :1210 仅服务转码）；cache key 含 w/h（:766-773）→ 双视口双渲染；**scene-frame worker 卸载不终止**（:2542 未传 signal，N-02）；多帧渲染超时公式 `600000 × framesN`（:836）216 帧=36h 形同虚设（N-04）。
- **修复规格**：
  1. 全局渲染信号量 `max(1, cpus-2)`，仿 acquireTranscodeSlot；
  2. ACTIVE_WORKERS 注册表 + disposer 终止（覆盖 scene-frame 与 scene-anim 两类）；
  3. 尺寸档位量化（960/1280/1920）减少 key 组合；
  4. 超时改有界公式（如 `min(600s × frames, 20min)` 或按帧时滑动兜底）；
  5. scene-frame 路由接 AbortSignal（已有 onAbort 机制白拿）。

### P0-5 CPU 渲染器分配风暴 ✅

- **锚点**：24/24 效果每 pass 整帧 `new Uint8Array`（watercaustics.js:34、blur.js:42/73/108、godrays.js:54/82/118/146、lightshafts.js:93 等，grep `new Uint8Array` 全中）；`_texSample` 每次返回新数组（model.js:709-735，:728 `const out=[0,0,0,0]`）；`applyBlending` 每像素 3-9 个临时数组（math.js:159-200，vividLight :150 最糟）。
- **勘误**：原报告「25 个 effects」实为 24（`_once.js` 是 `degradedOnce` 工具）。
- **修复规格**：
  1. 效果实例级按尺寸 scratch 池（乒乓双缓冲）替换整帧分配；
  2. `_texSample(tex,u,v,out)` 写入式变体全热路径替换（**已有零分配单通道采样器 `_texR/_texA` model.js:674-707 可直接复用/仿写**；waterwaves.js:44、tint.js:25 等取 [0] 的先换；shake.js:57 取 RG 双通道需 RG 变体）；
  3. `applyBlending(mode,A,B,opacity,out)` 直写三分量。
- **验收**：渲染进程 ~20MB/s RSS 锯齿（原报告 §2.2）应基本消失；scene-anim 帧时下降 30%+。

### P0-6 sf38 降采样盲区 ✅

- **锚点**：`_renderPassthroughLayer` fullscreen 分支（image.js:263-276）：:269 全帧 `new Uint8Array(this.canvas.data)` 拷贝 + :272 原分辨率 applyEffects，**无 `_downsample` 无 staticFrame 门**；composelayer 分支 :290 同样全帧拷贝+全分辨率（只滤 blur :296-299）；sway/flag/retro 预处理（image.js:104-118）在降采样（:186-189）**之前**对全尺寸源纹理跑。
- **定性边界**（勿越界）：静态帧全分辨率是**有意决策**（image.js:184-185 画质理由、glsl/integration.js:106 「用户要求」字样），只修 anim 路径；静态帧提速须与画质决策重议（两处注释要一起改）。
- **修复规格**：anim 模式 passthrough/composelayer 输入套用同款 `_downsample`；预处理挪到降采样后；全帧拷贝缓冲复用。

---

## 4. P1 执行卡

| # | 状态 | 当前锚点 | 要点/修复规格 |
|---|---|---|---|
| P1-1 godrays `_gaussPass` 误报记录 | ✅ | godrays.js:144-162 完整定义（7 权重和 0.999999） | 无需修复；性能小点（:153 每 tap 分配型 _texSample）并入 P0-5 |
| P1-2 /scene-resource 主分支绕过缓存 | ✅（scene-manifest 半边❌已修，见 §2） | index.js:2955 每请求整包读 → scene-manifest.js:2539-2557 | **比原报告更糟**：encodePng 是自家 **level 9**（:872/:894）非 canvas.js level 6；且 parseTexInternal→decodeTex 内部再 parseTexInternal（:767）= **三重解析**。修复：主分支接 `glSceneAccess`+`glDecodeTexCached`（:2998-3055 现成的）；encodePng 异步化/worker；高价值纹理落盘缓存 |
| P1-3 全链 no-store + WebGL2 无预检 | ✅ | scene-gl.js:159/:169；index.js:2982/3369/3474（另 :2581/:2646/:2782/:2853 同）；webgl2-unavailable :443-444 晚于 meta+shader 串行 fetch（:790, :805-810）；全库无预检/嗅探 | ① 一次性 WebGL2 probe（失败 sessionStorage 全局标记，本会话直接 mp4）+ `WEBGL_debug_renderer_info` 嗅探 SwiftShader/llvmpipe 禁用；② shader/纹理字节按 (token,path,mtime) LRU；③ token 加 mtime ETag 放开协商缓存 |
| P1-4 产物丢失/落盘/拷贝 | ⚠️ 重定性（见 §2） | index.js:2758（静默吞）、:2784-2788（无日志 422）、:2741-2755（APNG 主线程 writeFileSync/readFileSync）、:853（transfer 后 `Buffer.from` 整拷） | 先补日志与写失败处理再重测归因；产物写盘走 `atomicWriteFileP`/worker 直写；响应改 serveFile |
| P1-5 气泡 4 段 backdrop-filter 链 | ✅ | client.js:4219-4226（`[class*="_bubble"]`+`[data-composer-card]`，blur+saturate+brightness+contrast）；glassWindow 默认 true（:152/:333, :4373, :4400-4401）；overlay blur(3px) :5000-5001；侧栏 blur 上限 200px :2800（saturate 有 60 钳制 :2182，blur 没有） | 气泡收敛为 rgba 底色或共享「壁纸快照层」；overlay 去 blur；侧栏上限降到 60 量级 |
| P1-6 fontCustom 每次 emit 全量重写 style | ✅ | client.js:2067-2104（:2075 无条件 textContent 全量重写含 `body *{!important}` :2083-2087；注入 CSS 实为纯常量，变量走 `--we-font-*` :2201-2203） | 照抄 scrim 侧已有模式（:2059 `lastScrimCss` 缓存）；规则体只写一次仅更新 CSS 变量；**顺带修滑杆 tick applyEffects 双跑（N-10）** |
| P1-7 scene-anim probe `<video>` 不销毁 | ✅ | client.js:1568-1578（`preload="auto"` 缓冲整段）；stopPoll 只清定时器 :1530-1535；成功/缓存命中路径均不 remove（:1572-1575, :1552-1557）；唯一清理点 :1460-1463 | 成功/停止路径统一 `removeAttribute('src')+load()+remove()`；措辞修正：非「永久」，换壁纸/关 beta 时会清 |
| P1-8 GLSL 解释器五重浪费 | ✅ | ① integration.js:106-107（静态帧不降采样=有意）；② transpile.js:747-750（仅 mix 内联，余走 `__rt.*`）；③ swizzle `[a,b,c][i]` :919-924；④ `__initGlobals` 每像素重置含 const :183-200 + executor.js:225；⑤ 像素循环 executor.js:221-240（varyings for..of + fill(0) + 12 次 Math）；texture2D 4 层链 + 每采样 Set.has（integration.js:145） | ②-⑤ 无条件浪费，按原报告方案内联/预展开/写分析（吞吐 ×2-3）；①静态帧降采样须与画质决策重议 |
| P1-9 粒子每帧重建+重模拟 | ✅ | particles.js:17（每帧 `_buildParticleSystem`）、:86-87、:155（`_simulatedTo` 从 0）、:161-163（guard=2000）；parseVec3 内循环 :337/:353/:405/:440；Math.random 全局替换每帧两次 :20-27 + :42-49 | sys 按对象 id 缓存于渲染器实例（同 `_mdlCache`）；times 单调时增量推进；operator 参数一次解析；RNG 显式传参 |
| P1-10 puppet/model 每帧重建 | ✅ | puppet.js:141-153（bindWorld/bindInv 每帧重建+全顶点校验 :131-138）、:226-243（顶点每帧 new）、:680-703（sample() 每像素 7 数组）；model.js:239（每像素 2 字面量）、:585-670（_shadeGeneric ~10+每光源 ~5 数组+Math.pow :626/:632） | bind 链按 mesh 缓存；顶点 SoA；着色函数标量参数；spec pow LUT；**一并覆盖 attachment 骨骼路径（N-14：core.js:421-476 每帧重解 animLayers :443-462）** |
| P1-11 纹理解码无界/重复 | ✅ | core.js:59（textureCache 无 LRU，:243 只 set）；textures.js:116-121（注释自证双重 parseTexInternal）；jpeg.js:161-181 huffDecode 每 bit 线性扫表（:172-173） | decodeTex 复用 parse 信息（首次 ~2×）；字节 LRU；解码产物落盘/常驻 worker；Huffman 直读表 |
| P1-12 `_downsample` 每帧重算不缓存 | ✅ | core.js:806-832（:812 new Uint8Array 无缓存）；调用点 image.js:186-189 | 纹理对象挂 `_dsCache = Map<maxDisp, img>`（maxDisp 量化 2 的幂；scale 动画场景兼容） |

---

## 5. P2 处置总表（全部经二次复核）

| # | 状态 | 当前锚点 | 备注 |
|---|---|---|---|
| P2-1 玻璃 blur=0 不真关 | ✅ | client.js:2118（`--we-blur: 0px`）、:2123（saturate=1.15）、:4225-4226 恒应用；media 侧正确 none :2131-2136 | blur=0 时真正 `none` |
| P2-2 拉绳拖拽 left/top+offsetWidth | ✅ | client.js:3892-3911（写 left/top）；:3836-3848（ropeSize 每 pointermove 两次同步布局读）；:5146-5150（settle top/left transition） | 改 transform + 拖拽期缓存尺寸 |
| P2-3 设置窗 `:has()` | ⚠️ | client.js:4373/:4415（活跃）、:4431/:4436（在 `@supports not` 死分支，Chromium 不活跃）；overlay blur(3px) :5000-5001 | 实际影响面=2 个活跃选择器；改稳定 data- 属性 |
| P2-4 scene-anim 轮询无守卫 | ✅ | client.js:1545-1559（1.5s 无条件 emit）；对照 transcode :1834-1845 有守卫；两处 document.hidden 不暂停 | 加变化守卫+hidden 暂停；**叠加 N-01 孤儿 .prog 会无限轮询** |
| P2-5 Edge canvas 冗余 clearRect | ✅ | client.js:1185-1215（:1198 clearRect，cover 全覆盖时冗余；rVFC 驱动 :1221） | cover 模式免 clear；>1080p 源 dpr cap 降 1 |
| P2-6 emit() 全量扇出 | ✅ | client.js:424-433（无 selector）；**调用点实测 109**（原报告正文 108≈对，§7.2 的 114 错——含 5 行注释 :1776/:2434/:3764/:3983/:4080） | 架构项，第 3 波 |
| P2-7 scene-gl 每帧 uniform/attrib/无 VAO/MVP | ✅ | 每帧全量 uniform :591-618；getAttribLocation 每帧每 pass :549-550（**uniform 位置已预取 :469-472，缺的是 attrib 那一半，与 §5 防御不矛盾**）；无 VAO（0 命中）；静态 MVP 每帧重建 :577/:644；材质常量每帧 split :314/:615 | attrib 预取+VAO+常量预转换；**并入 N-08 热路径分配**（:26/:38-39/:571/:317-319） |
| P2-8 默认 fpsCap=0+无静态跳帧 | ✅ | client.js:86（DEFAULTS）、:1400 透传；scene-gl.js:107/:660-665；无 g_Time 场景全功率空转 | 静态场景跳帧/默认限帧 |
| P2-9 DXT 未用 S3TC | ⚠️ | scene-gl.js:248（RGBA 上传属实；:214 行号失效） | **机制修正：DXT 解压在宿主**（scene-resource 供 PNG），S3TC 需宿主供原始 DXT 字节+客户端 compressedTexImage2D 联动，跨模块修复 |
| P2-10 缓存只增不减 | ⚠️ | sf\* 已有 32 条数 LRU（index.js:750-762，❌ 见 §2）；san\_\*/vid\_\*/sv2\_\* 仍无 GC（:769, :3518） | 收窄为三类前缀 GC + 条数改字节预算（N-05）+ 启动清扫 |
| P2-11 scene-frame 失败无负缓存 | ✅ | index.js:2525-2587（失败摘除 inflight :2573-2576，下次全链路重来+主线程 extractSceneMainImage 回退） | 加 TTL 负缓存 |
| P2-12 blur 高斯核每像素重建 | ✅ | blur.js:82-90（y/x 循环内建 full[]/weights[]） | hoist 到 pass 级+行指针步进 |
| P2-13 bloom lin() pow/双缓冲分别模糊/盒式 | ✅ | bloom.js:22/:153（Math.pow）、:229-231（HDR 每像素×3）、:211-215（bright/hdr 分别模糊）、:247-265（O(r²) 盒式） | LUT+先加后糊+可分离；**注意 N-15：bloom.js 有两份实现，:6-122 是死代码，实际只用 :127-243** |
| P2-14 每帧 encodeIdat level6 | ✅ | scene-render-worker.mjs:88 → apng-encode.js:34（deflateSync level6）；fmt=mp4 时中间 APNG 全程多余（index.js:2735-2755） | rawvideo pipe 给 ffmpeg 跳过 deflate |
| P2-15 主线程 timings 探测 | ✅ | index.js:2668-2669（new SceneRenderer 同步整包读 core.js:31→textures.js:47，且无谓分配整块 w×h×4 Canvas） | timings 移 worker 或 abs+mtime 缓存；并入 N-03 |
| P2-16 合成 Uint8↔float 往返 | ✅ | we-renderer/canvas.js:41-44/:103-106/:165-170（Math.round×4、/outA、无不透明快速路径） | 乘倒数+`(x+0.5)\|0`+Uint32 视图+a==1&&dstA==1 快路径 |
| P2-17 probeMp4 同步 16MB 读+尾部回扫 | ✅ | index.js:1053-1167（head/tail 8MB readSync :1058-1073、逐字节回扫 :1080-1094）；FIFO 500 缓存 :1176-1180 | 有缓存兜底，优先级低 |
| P2-18 抽帧临时文件名竞态 | ❌ | 已修复（index.js:653-658 内容 hash） | **不要修**，见 §2 |
| P2-19 buildInventory 无 in-flight 去重 | ✅ | index.js:2110（无 `_inventoryInflight`，仅 3s TTL） | 复制 steamProbeInflight 模式 |
| P2-20 文本位图缓存按条数 | ✅ | we-renderer/text.js:28-32（FIFO 256 条不按字节） | 字节预算 LRU |
| P2-21 关键帧/相机每帧 sort+parseVec3 | ✅ | core.js:746-761（evalChannel 内 `frames.sort` 每次调用执行）；camera.js:123（transforms `.sort` 每帧） | 构造期预排序+数值通道缓存；**补 N-13：resolveTransform 父链 parseVec3（core.js:478-515）** |
| P2-22 场景 JSON 每帧重读重解析 | ✅ | image.js:73 → core.js:112-121（无缓存）→ textures.js:88-105（每次 probeLz4Chain+readPkgEntry 全量解压+JSON.parse）；model.js:8/:19、core.js:293-300 同款 | 实例级 `Map<relpath, parsed>` 即可归零（pkg 内容不可变） |
| P2-23 GLSL 编译缓存仅实例内存 | ✅ | glsl/integration.js:63-64（`_glslCache` 挂实例）；include 每次 existsSync+readFileSync（:86-93）；parseMeta 三方各跑（preprocess.js:104 + executor.js:13-14 + integration.js:53） | 模块级全局缓存+编译产物落盘+include memoize |
| P2-24 scene-player 每帧 GL 查询/队列重建 | ✅ | scene-player.js:689-699 等（每帧 getUniformLocation×N）、:757（getParameter） | program 创建时缓存 location 表；队列分桶加载期一次 |
| P2-25 depthparallax ray-march 全分配 | ✅ | depthparallax.js:43（QUALITY2=64 层）、:81-86（每步新数组+分配型采样） | 标量化 march+强制降采样输入 |
| P2-26 blurradial/foliagesway 帧常量重算 | ✅ | blurradial.js:48/:59-63（每 tap cos/sin，:60 纯帧常量）；foliagesway.js:64-68（`speed*t*sW[i]` 每像素×8） | 循环外预计算 cosK/sinK/相位表 |
| P2-27 scene-scripts 每帧 dispatch/walk/字符串桥 | ✅ | scene-scripts.js:614-621（props dispatch+copyPlain :228-237）、:143（objList.find O(n)）、:672-696（每帧递归 walk） | props memoize；name→obj Map；walk 结果缓存；数值走数组 |

---

## 6. P3 处置（抽查确认 8 项；其余沿用原报告）

- ✅ **base64 吉祥物图**：client.js:3773（151,738 字符）+:3779（429,344 字符）= 581,036 字符，占 src 67.1% / lib 63.5%（lib 现 914KB）。修复：host 路由懒加载。
- ✅ **classic 模式无虚拟化**：client.js:3021/:3145/:3377（分页器被 `!cdMode &&` 抑制 :3049/:3185/:3404；全文无 content-visibility）。
- ✅ **`data-we-appwindow` 死属性**：client.js:5348-5378 设置但全插件无 CSS 消费，:5352 注释宣称的降级不存在。
- ✅ **进度条 width transition**：client.js:4350-4354 + 内联 width :3609/:3640 → 改 transform:scaleX。
- ✅ **mask/noise 用 RGBA 采样取 [0]**：waterwaves.js:44、tint.js:25 确认（`_texR/_texA` 就在 model.js:674-707）；**shake.js:57 例子不精确**（取 RG 双通道需 RG 变体）。
- ◇ 沿用原报告（方向可信、行号需重锚）：canvas.clear 逐 4 字节循环（→Uint32Array.fill）；jpeg.js 每块 3 个 Float64Array；apng-encode crc32 表每 chunk 重建+APNG 无帧间差分；文本位图缓存 key 含 color；配置每请求 readFileSync；spawnFfmpeg 对已 abort signal 仍 spawn；ffmpeg 双镜像并行下载；`/remove`、`/upload-dir` body 无大小上限；scene-gl shader 串行 fetch/meta 双请求/无离屏剔除/GL ready 后 8K 底图常驻（scene-gl.js:805-810 串行已确认）。
- ✅ §5 Client 防御全属实（media filter none :2131-2136、视频 GC :1175-1184、分页 :2615-2623、防抖 :526-543、**无 MutationObserver（0 命中）**、遮挡三信号 :1697-1703）。

---

## 7. 新发现问题清单（原报告未列，编号 N-01~N-15）

| # | 严重度建议 | 问题 | 锚点 | 处置 |
|---|---|---|---|---|
| N-01 | **P1（进第 1 波）** | frames 目录孤儿 `.prog` 永不清理：sweepTranscodeArtifacts 只扫 transcode/ffmpeg 目录；残留 .prog 让进度端点永报旧值，叠加 P2-4 无守卫 1.5s 轮询 = **无限轮询** | index.js:1295/:2089（sweep 范围）vs sceneAnimProgressFile :777-780（写在 frames 目录） | sweep 覆盖 frames 目录 *.prog |
| N-02 | P0-4 并入 | scene-frame 渲染 worker 卸载不终止（无 signal、无注册表） | index.js:2542 | P0-4 注册表覆盖两类 worker |
| N-03 | P0-3 并入 | scene-anim 单次渲染三次整包读（timings 探测+视频扫描+worker readPkg），且 timings 探测无谓分配整块 Canvas | index.js:2668-2669, :793 | 合并探测/扫描，结果共享 |
| N-04 | **P1** | 渲染 worker 超时 `600000×framesN`：216 帧=36h，多帧渲染无超时兜底 | index.js:836 | 改有界公式 |
| N-05 | P2-10 并入 | gcFrameCacheSync 按条数（32）不按字节（4K PNG 单张 10MB → 上限仍可 300MB+） | index.js:750-762 | 字节预算 |
| N-06 | P0-1 并入 | makeFBO 对 w/h 各自独立 clamp 破坏纵横比（8192×4608→4096×4096，16:9→1:1），读 aspect 的效果失真 | scene-gl.js:218-220 | 等比 clamp |
| N-07 | P0-1 并入 | uploadTex 无 MAX_TEXTURE_SIZE 守卫 | scene-gl.js:244-258 | 超限降档 |
| N-08 | P2-7 并入 | scene-gl 热路径每帧 Float32Array/数组分配 | scene-gl.js:26, :38-39, :571, :317-319 | 预分配复用 |
| N-09 | P0-2 顺手 | frameTimes 超 4096 后每帧 splice O(n) | scene-gl.js:131 | 环形索引 |
| N-10 | **P2** | 滑杆 tick applyEffects 双跑（handler 直接调 + emit 订阅再跑；fontCustom 时 style 重写 ×2） | client.js:2495-2524, :5385, 注释 :2434-2436 | 去掉直接调用 |
| N-11 | P3 | weDrawFrame 每解码帧读 canvas.clientWidth/Height（逐帧布局读） | client.js:1194-1195 | 交给已有 ResizeObserver |
| N-12 | P2 | WallpaperPicker 每次 emit 全量重算 ratingCounts/typeCounts/hiddenInventoryList/playableInventory（:2623 与 :3405 重复调用）/rotationCandidates | client.js:2595-2623 | 按 inventory 代次 memoize |
| N-13 | P3 | resolveTransform 每对象每帧沿父链逐祖先 parseVec3 | core.js:478-515 | 并入 P2-21 缓存 |
| N-14 | P1-10 并入 | attachment 子对象每帧重解 animLayers（findIndex+正则）+ 重算全套骨骼位姿 | core.js:421-476（:443-462） | 随 P1-10 缓存 |
| N-15 | 维护性 | bloom.js 两份完整重复实现（:6-122 仅被再导出=死代码；实际只用 :127-243） | bloom.js | 删死代码 |

---

## 8. 修订后修复路线图

**第 1 波（止血，每项 ≤ 半天）**
1. **P0-1** 链 FBO **等比** clamp 到画布预算 + uploadTex MAX_TEXTURE_SIZE 守卫（含 N-06/N-07）。收益按 4096² 基线重算（5.4-8×）。
2. **P0-2 + P1-3①** render 耗时滑窗熔断（onError 'slow'）+ 一次性 WebGL2 probe + SwiftShader 嗅探（含 N-09）。
3. **P0-3①②** extractSceneVideoFrames memoize（键复用 sceneCacheStamp）+ TEX 头部探测。
4. **P0-4** 全局渲染信号量 + ACTIVE_WORKERS 注册表（覆盖 scene-frame/scene-anim，含 N-02）+ 有界超时（N-04）+ 尺寸档位量化。
5. **P1-4** 失败路径补日志 + 缓存写失败不静默（**先取证再定流程改动**，见 §2）。
6. **N-01** sweep 覆盖 frames 目录 *.prog（一行级改动，断掉无限轮询）。

**第 2 波（明显收益，1-2 天级）**
7. P1-2 /scene-resource 主分支接缓存 + encodePng 异步化（scene-manifest 缓存已有，勿重复）。
8. P0-5 scratch 池 + 写入式 _texSample/applyBlending（复用 _texR/_texA，补 RG 变体）。
9. P0-6 anim passthrough/composelayer 降采样 + 预处理挪后 + P1-12 _downsample 缓存。
10. P1-5/6/7 + P2-1 + N-10 气泡玻璃收敛、blur=0 真 none、probe video 销毁、fontCustom 缓存、滑杆双跑。

**第 3 波（结构性，按需）**
11. P1-8②-⑤ GLSL 内联/预展开/写分析（×2-3）+ P2-23 编译缓存全局化/落盘。
12. P1-9 粒子增量模拟；P1-10 puppet/model 缓存（含 N-14）；P2-22 场景 JSON 实例级缓存；P2-25/26 热点。
13. P1-11 纹理解码复用 + P2-9 S3TC（**跨 host+client 联动**）+ P2-7（含 N-08）+ P2-8 + P2-24。
14. 缓存治理（P2-10 收窄版+N-05、P2-11）+ P2/P3 清扫（含 N-12/N-13/N-15）。

---

## 9. 验证/复现命令集（沿用原报告 §6，已确认仍适用）

- A/B 实验：`google-chrome --headless=new --remote-debugging-port=9333 <GUI URL>` + CDP Profiler/Tracing（脚本存 `.perf-probe/cdp-trace.mjs`）；GL OFF 对照 = localStorage `weSceneGL=0`。
- scene-anim 计时：`curl -w '%{time_total}' '<GUI>/wallpaper-engine/scene-anim/<token>?fps=12&sec=6&fmt=mp4&w=1280&h=720'`（token=base64url(scene.pkg 路径)）。
- 渲染 worker 观测：`ps -T -p <dsh pid> -o %cpu,comm | grep WorkerThread`（修复 P0-4 后并发应 ≤ 信号量上限）。
- 孤儿渲染复现：请求发出后立即断开客户端，观察 `.prog` 进度推进与完成后 cache 目录产物（验证 P1-4 修复后**必须**有日志）。
- 渲染进程 RSS 锯齿：12s 粒度采样 GUI 渲染进程 RSS（验证 P0-5 后 ~20MB/s 锯齿应消失）。

---

## 10. 复核统计明细

| 模块 | ✅ 确认 | ⚠️ 部分确认 | ❌ 已过时 | 复核方式 |
|---|---|---|---|---|
| scene-gl（7 条） | P0-2, P1-3, P2-7, P2-8, §5 防御 | P0-1, P2-9 | — | 独立代理+主评审亲验 |
| host index.js（10 条） | P0-3, P1-3, P2-11, P2-14/15, P2-17, §5 防御 | P0-4, P1-2, P1-4, P2-10 | （子项见 §2）, P2-18 | 独立代理+主评审亲验 |
| CPU 渲染器（11 条） | P0-5, P0-6, P1-1, P1-8~12, P2-12/13/22/25/26, §5 防御 | — | — | 独立代理 |
| client.js（12 条+P3） | P1-5/6/7, P2-1/2/4/5/6/8, P3×4, §5 防御 | P2-3 | — | 独立代理+主评审亲验 |
| P2-16/19/20/21/23/24/27 | ✅ 全部 | — | — | 主评审亲验 |
