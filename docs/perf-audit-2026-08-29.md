# dsh-wallpaper-engine 性能深度审计报告

> 日期：2026-08-29 ｜ 版本：v0.7.1（工作树含未提交的 sf40 GLSL 解释器改动）
> 方法：5 路并行代码审计（Host / Client / scene-gl / CPU 渲染核心 / GLSL·效果链）+ 本机真实运行时取证（CDP A/B 实验、逐线程 CPU 采样、渲染进程内存采样、3 次真实 scene-anim 渲染观测）。
> 本文档只关注**性能**；正确性问题见 `docs/review/00-REVIEW-SUMMARY.md` 与 `docs/SECOND-REVIEW.md`。注意：那两份审查文档中的「godrays `_gaussPass` 未定义（LGT-01）」在**当前工作树已过时**——`godrays.js:144` 已有完整定义（本次复核确认，见 §7）。

---

## 1. 结论速览（TL;DR）

当前用户会话（scene 壁纸 3427824116，betaSceneAnim=true，fpsCap=24，sceneGLDegrade=true）实测：**GUI 渲染进程主线程 ~99% CPU 满载、GPU 进程 1GB RSS、渲染进程 RSS 以 ~20MB/s 锯齿上涨**。归因与代码证据完全对上，六大根因按影响排序：

| # | 根因 | 实测影响 | 一句话修复 |
|---|---|---|---|
| 1 | **scene-gl 效果链按主纹理原分辨率（8K）渲染**（scene-gl.js:396-399） | 每帧 150M 片元、1.2GB/帧带宽、604MB FBO 显存；SwiftShader 下 1fps；比画布需求浪费 21.5× | 链 FBO clamp 到画布预算（≤1920×1080） |
| 2 | **无低帧率熔断**（fps=1 也不降级） | 主线程 92-99% 永久满载，永不自愈 | 滑窗帧时阈值 → onError → 复用 mp4 回退链 |
| 3 | **每次渲染前主线程同步整包读+双重 LZ4 解压扫描视频纹理，无 memoize**（index.js:597-675, 723-729） | 每请求 0.5-1s（44MB pkg）/ 5-10s（336MB）事件循环阻塞，GUI 卡顿直接可见 | 结果 memoize + 头部探测代替全解压 |
| 4 | **渲染 worker 无全局并发闸 + 断开不取消** | 双视口实测 2 条 WorkerThread 各 99% CPU 打满宿主进程 11 分钟 | 全局信号量 + 同场景尺寸归一 |
| 5 | **每条聊天气泡常驻 4 段 backdrop-filter 链**（client.js:4109-4116） | 动态壁纸每帧 N 个气泡背景重滤波，GPU 合成成本随气泡数线性涨 | 玻璃收敛到共享快照层/有限表面 |
| 6 | **CPU 渲染器分配风暴 + sf38 降采样盲区**（passthrough 全分辨率、每像素数组分配） | scene-anim 实测 ~3s/帧@1080p（216 帧 11 分钟） | scratch 复用 + 写入式采样/混合 + 堵住盲区 |

**意外收获（实测发现的功能性缺陷）**：孤儿 scene-anim 渲染 2 跑完 216 帧（约 8 分钟 × 1 核）后**无任何缓存产物且无日志**（静默丢失）；真机 X 会话下窗口 Chrome **WebGL2 上下文创建失败**（`webgl2-unavailable`）→ 每选一张 scene 壁纸都会触发一场 11 分钟 CPU 预渲染。

---

## 2. 运行时实测取证（本机，2026-08-29 上午）

### 2.1 受测环境
- DSH GUI（Electron，`--ozone-platform=x11`）+ wallpaper 插件 host 同进程；选中壁纸 `ls-686710928829` = `~/Pictures/WallpaperEngine/3427824116`（scene，44MB pkg，2 个 8192×4608 全屏 image 对象 + 2 个 foliagesway 效果）。
- 机器：Intel UHD + RTX 3060 Mobile（Linux，X 会话）。

### 2.2 症状采样
- GUI 渲染进程（PID 8030）：进程级 52→104% CPU 波动；**逐线程拆解：Blink 主线程 ~99%（10s +988 jiffies），Compositor 仅 ~3%** —— 不是合成器/毛玻璃把进程打满，而是主线程在跑原生渲染工作。
- GPU 进程：RSS 1.04GB 稳定（与 §4 P0-1 的 8K 纹理 + 8K FBO 显存估算 ~1GB 吻合），CPU 32-62% 波动。
- 渲染进程 RSS：40 分钟 964MB→1.49GB，12 秒粒度采样呈 **~20MB/s 锯齿**（40s 涨 ~800MB 再整体回落）——周期性大分配 churn（与每帧数组分配/GC 及 GL 上传缓冲行为一致）。

### 2.3 CDP A/B 对照实验（headless Chrome 加载同一 GUI 页面，同壁纸同服务）
| 指标 | GL ON | GL OFF（localStorage weSceneGL=0） |
|---|---|---|
| 主线程 CPU | **92.1% 忙（全部 (program) 原生帧）** | **74.5% 空闲** |
| sceneGL fps | **≈1.0**（fpsCap=24 形同虚设） | 不活跃 |
| Trace 5s | GPUTask 6851ms（20 次 × ~342ms）、Commit 3454ms（4 次 × ~860ms） | RunTask 1369ms、Commit 10ms，无 GPUTask |
| JS 层 | 全部 <1% | buildListSnapshot 3.5% 等（DSH 自身会话列表） |

结论：**该页面的主线程满载 100% 由 wallpaper 的 scene-gl 渲染路径造成**（headless SwiftShader 下每帧 ~1s）。布局/样式重算可忽略（UpdateLayoutTree 1ms）。

### 2.4 scene-anim CPU 渲染经济学（3 次真实渲染观测）
| 渲染 | 参数 | 帧数/时长 | 实测 | 产物 |
|---|---|---|---|---|
| 孤儿 1（headless 触发） | 1920×1080@24fps | 216 帧（9s 循环） | ~11 分钟，1 核 99% | ✅ 540KB mp4 落盘 |
| 孤儿 2（窗口 Chrome 触发） | 另一视口尺寸 | 216 帧 | ~8 分钟，1 核 99% | ❌ **无产物、无日志**（.prog 删除即终） |
| 对照（curl 保持连接） | 720p@12fps | 108 帧 | **143s 总耗时**（~1.3s/帧） | ✅ 264KB mp4 落盘 |

- 两个孤儿渲染由**两个不同视口尺寸的客户端**同时触发（cache key 含 w/h → 去重失效），宿主进程内 2 条 WorkerThread 各 99% CPU；**客户端断开后渲染继续**（9898ca5 的有意设计：结果可缓存复用），无全局并发上限。
- 孤儿 2 的丢失路径：index.js:2590-2593 渲染 promise reject 后只向已关闭的 socket 回 422，无日志、无重试、无落盘 —— 与注释宣称的「渲染跑到完成并写缓存」(index.js:2574-2579) 不符。

### 2.5 真机 WebGL 状况
- 窗口 Chrome（真 X 显示）在该会话下 **`getContext('webgl2')` 与 `getContext('webgl')` 双双失败** → scene-gl 以 `init:webgl2-unavailable` 失败 → 每换一张 scene 壁纸都会把系统推进 11 分钟 CPU 渲染路径。
- 插件无任何「WebGL2 可用性一次性预检」或「软渲染（SwiftShader/llvmpipe）嗅探」； Electron 主会话里 GL 是否软渲染未直接确认（无 CDP），但主线程 99% + A/B 结果与软渲染行为一致。

### 2.6 其他实测数字
- 静态帧 PNG：本壁纸 10.4MB（3840×2160），缓存命中 10ms 返回；5 张共 44MB（版本前缀 sf35，旧版本文件不清理）。
- 客户端 bundle：lib/client.js **880KB**（源 840KB 的 69% 是 base64 吉祥物图）。
- inventory 路由：10ms（7 张壁纸，扫描有 3s TTL 缓存，正常）。

---

## 3. 发现清单（跨模块合并去重，按严重度）

> 编号规则：P0（灾难/满载级）→ P1（明显性能损益）→ P2（中等）→ P3（轻微）。`[实]` = 本机实测佐证；`[双]` = 两路独立审计交叉印证。

### P0

**P0-1 scene-gl 效果链按主纹理原始分辨率渲染，无上限** `[实]`
`src/scene-gl.js:396-399, 457-468`：FBO 对 = `makeFBO(mainTexEntry.w, mainTexEntry.h)`。8192×4608 主纹理 → 本场景每帧 4 个 37.75MP 效果 pass ≈ 150M 片元/帧、~1.2GB/帧带宽、604MB FBO + ~400MB 纹理显存，而 present 仅输出 ≤1920×1080（浪费 (8192/1765)²≈21.5×）。SwiftShader 实测 1fps；即使真 GPU，iGPU 带宽（25-60GB/s）也会被 60fps 的 73GB/s 需求打满。设计文档 `docs/plan-scene-webgl-details.md:362` 按 4K 纹理定案，未为 8K 设防。
**修复**：链 FBO clamp 到画布预算（CPU mp4 路径本就只按 ≤1920×1080 渲染，对齐语义）；可选按实测帧时自适应降档链分辨率；FBO 超 `MAX_TEXTURE_SIZE` 先降档。

**P0-2 无低帧率熔断/自动降级** `[实]`
`src/scene-gl.js:121-125, 540-548`：帧时环只记录（且记录的是 rAF 间隔而非 render 耗时），唯一消费方是 E2E 脚本；客户端从不读 `renderer.stats`。降级判定全是宿主静态白名单（`lib/index.js:2868-2978`）。fps=1 时主线程 92-99% 永久满载、永不回退。
**修复**：滑窗 p95 帧时 > 阈值持续数秒 → `onError({reason:'slow'})` → 复用现有 mp4 回退链（client.js:1354-1364 零改动）；仪表改测 `render()` 前后 `performance.now()`。

**P0-3 每次渲染前主线程同步整包读 + 双重 LZ4 解压扫描，无 memoize** `[实]` `[双]`
`lib/index.js:723-729` 每次 scene-frame（缓存 miss）/scene-anim 渲染都调 `extractSceneVideoFrames`（`index.js:597-675`）：`readFileSync` 整包（本壁纸 44MB，代码注释自证可达 336MB）→ 遍历全部 `.tex` 条目 `e.read()`（整条目 LZ4 链解压，pkg-extract.js:263-285）→ `extractTexVideoMp4` 再逐 mip 全量解压一遍（pkg-extract.js:287-353）——**每个纹理解压两次只为回答「是不是视频」**，且「无视频」结论不缓存。44MB pkg ≈ 0.5-1s 事件循环阻塞/次；336MB → 5-10s。与 dsh GUI/API 同进程，卡顿直接可见。
**修复**（按收益）：① `Map<pkg+mtime+size, videoRefs[]>` memoize（多数场景零视频，一次后归零）；② 头部探测：TEXB0004 的 isVideoMp4 标志在 mip 数据前（只需条目 ~64B），TEXB1-3 只需 mip0 首 LZ4 块 ≤4KB 判 ftyp；③ 只扫 scene.json materials 实际引用的纹理（通常 ≤20 条）；④ 扫描移入 worker。

**P0-4 渲染 worker 无全局并发闸；断开不取消；卸载不终止** `[实]`
`lib/index.js:734` 每次渲染无条件 `new Worker`（node:worker_threads，**跑在 dsh 宿主进程内**）；去重仅按含 w/h 的 cache key（`index.js:700-707, 2461-2470`）→ 双视口 = 双渲染各 99% CPU（实测）。断开不取消是 9898ca5 有意设计，但叠加无上限放大浪费；disposer（index.js:3511-3535）杀 ffmpeg 不杀 worker。scene-anim 的 `cancel`（2470-2475）是死代码，`ctrl.abort` 全链路无人调用；但 2539/2556/2563 的 `ctrl.signal.aborted` 检查仍在——与「跑完写缓存」的注释矛盾（孤儿 2 丢失的候选路径之一）。
**修复**：全局渲染信号量（`max(1, cpus-2)`，仿 `acquireTranscodeSlot` index.js:1070-1082）+ ACTIVE_WORKERS 注册表 + disposer 终止；尺寸档位量化（960/1280/1920）减少 key 组合；scene-frame 路由接 AbortSignal（已有 onAbort 机制白拿）。

**P0-5 CPU 渲染器分配风暴：每效果每 pass 整帧 `new Uint8Array`，每像素 5-30 个临时数组** `[实]` `[双]`
全部 25 个 effects（watercaustics.js:34、blur.js:37/68/102、godrays.js:38/63/100、lightshafts.js:75…）每 pass 分配整帧缓冲；`model.js:695-701 _texSample` 每次调用返回新数组；`math.js:159-199 applyBlending` 的 `mix().map()` 链每像素再分配 4-8 个。1.75M px 帧一个 watercaustics 对象 ≈ **3000 万个数组分配/帧**（@4K 1.4 亿）。每帧 3s 中分配+GC 占 30-60%（估）。渲染进程 ~20MB/s RSS 锯齿同源。
**修复**：实例级按尺寸 scratch 池（乒乓双缓冲）；`_texSample(tex,u,v,out)` 写入式变体全热路径替换；`applyBlending(mode,A,B,opacity,out)` 直写三分量。

**P0-6 sf38 降采样盲区：passthrough/fullscreen 效果链全分辨率 + sway/flag/retro 预处理先于降采样** `[实]` `[双]`
`image.js:263-275`（`_renderPassthroughLayer` fullscreen 分支）`new Uint8Array(this.canvas.data)` 全帧拷贝后按原分辨率 W×H 跑 applyEffects，**既无 `_downsample` 也无 `staticFrame` 门**（composelayer 会滤 blur 但 fullscreen 路径不滤）——这是无条件的漏网路径。`image.js:93-107` sway/flag/retro 预处理在 186-189 行降采样**之前**对全尺寸源纹理跑（先降采样可省 10-60×）。
> ⚠️ 定性说明：`image.js:184-185` 与 `glsl/integration.js:106` 的注释明确写着**「静态帧全分辨率渲染保证细腻（4K 降采样会马赛克）——用户要求」**——即 image 主路径与 GLSL 路径的**静态帧**全分辨率是**有意决策**而非疏漏；本条真正的问题在 anim 模式的 passthrough 路径（该路径连静态帧的决策理由都不适用，纯漏网）。
**修复**：anim 模式 passthrough 输入套用同款 `_downsample`；预处理挪到降采样后；全帧拷贝缓冲复用。静态帧若要提速需与画质决策一起重议（如 2M px 折中阈值或 quality 选项）。

### P1

**P1-1 ~~godrays `_gaussPass` 未定义~~ —— 复核后判定为误报（既有审查文档过时）**
`godrays.js:144-162` **已有完整定义**（7-tap 可分离高斯，权重和 0.999999），当前工作树 godrays 正常工作。两份既有正确性审查（review/00 LGT-01）与两路子代理引用的「必抛 TypeError / 从未生效」结论基于旧代码。仅存的性能小点：`_gaussPass` 每 tap 走分配型 `_texSample`（并入 P0-5 修复即可）。
**修复**：无需修复（性能部分并入 P0-5）。

**P1-2 /scene-resource、/scene-manifest 每请求整包读 + 主线程同步解码/deflate，绕过已有缓存** `[双]`
`lib/index.js:2718-2721` 主分支每纹理请求 `readFile` 整包 → `scene-manifest.js:2539-2557` 重 parsePkg + `decodeTex`（DXT→151MB RGBA@8K）+ `encodePng`（`zlib.deflateSync` level6，canvas.js:192-206）**同步卡事件循环秒级/张**；已有的 `_glPkgCache`/`_glTexCache`（index.js:2760-2818）只挂在 fallback 分支（2723-2740），GL 纹理主路径形同虚设。多纹理场景一次激活 = N 次整包读 + N 次主线程 PNG 编码。
**修复**：主分支接 `glSceneAccess` + `glDecodeTexCached`；encodePng 异步化或 worker；高价值纹理落盘缓存。

**P1-3 scene-gl 客户端/HTTP 全链零缓存（no-store）+ WebGL2 无预检** `[实]`
`src/scene-gl.js:136,146` 全部 fetch `cache:'no-store'`；宿主三路由同（index.js:2745, 3026, 3131）。contextlost 重建/壁纸切回/降级重估都全量重取（8K PNG 数十 MB + 客户端解码 + 151MB/张上传）。且 `webgl2-unavailable`（scene-gl.js:308-309）晚于 meta+shader fetch，逐 token 重复失败——真机 WebGL 不可用时**每选一张 scene 壁纸触发一场 11 分钟 CPU 渲染**（实测）。
**修复**：① 一次性 WebGL2 probe（失败 sessionStorage 全局标记，本会话直接 mp4）+ SwiftShader/llvmpipe renderer 嗅探禁用；② shader/纹理字节按 (token,path,mtime) LRU；③ token 加 mtime ETag 放开协商缓存。

**P1-4 scene-anim 完成产物可静默丢失（实测 1/2 丢失）+ 帧数无上限 + 主线程整缓冲落盘** `[实]`
孤儿渲染 2 跑完 216 帧 ~8 分钟无产物无日志（index.js:2590-2593 仅 422 到死 socket）。`index.js:2517-2525` frameCount 无上限（60s 相机路径 @30fps = 1800 帧小时级）；`2550-2564` APNG 70MB 主线程 `writeFileSync`/`readFileSync`；`775-776` 对 transfer 来的 buffer 再整块拷贝。
**修复**：渲染完成→落盘→按需响应（与注释意图对齐）；frameCount 硬上限（如 300，超出时间缩放采样）；产物写盘走 `atomicWriteFileP`/worker 直写；响应改 `serveFile`。

**P1-5 每条聊天气泡常驻 4 段 backdrop-filter 链** `[实]`
`src/client.js:4109-4116`：`[class*="_bubble"]` 子串选择器命中每条消息气泡 + 输入栏，链 = blur(≤60px)+saturate(≤2.83)+brightness+contrast。动态壁纸每帧所有可见气泡背景重滤波（中端 GPU 估 15-45ms/帧@30 气泡）。设置窗打开时再叠整窗玻璃 + 全屏 overlay blur(3px)（client.js:4886-4891）+ repo/panel 双层（最坏 N+M+6 层）。侧栏模糊上限 200px（:2695）数量级浪费。
**修复**：气泡收敛为 rgba 底色或共享一次模糊的「壁纸快照层」；blur=0 时真正 `none`（现在 blur(0px) saturate(1.15) 仍强制 backdrop pass，:2012-2019）；overlay 去 blur；:has() 打稳定 data- 属性替代。

**P1-6 fontCustom 开启时每次 emit 全量重写 `<style id="we-font-patch">`**
`src/client.js:1962-1999, 2095-2099`：每次 emit（滑杆每 tick、进度轮询每 1.5s、visibilitychange）都 textContent 全量重写含 `body * {…!important}` 的规则 → 全文档双轮样式重算 + backdrop 面板重光栅（与 ff363e2 的 :has() 风暴同类）。当前用户 fontCustom=false 未触发。
**修复**：缓存 lastFontCss，值不变直接 return；规则体只写一次，仅更新 3 个 CSS 变量。

**P1-7 scene-anim probe `<video>` 成功后不销毁（betaSceneAnim 用户）**
`src/client.js:1463-1474`：`stopPoll()` 只清定时器不 remove probe；缓存命中路径也不调 stopPoll → 隐藏 video 挂 body 永久缓冲整段 MP4（数十 MB）。
**修复**：成功/停止路径统一 `removeAttribute('src')+load()+remove()`。

**P1-8 静态帧 GLSL 解释执行不降采样（有意决策）+ 解释器派发/分配层五重浪费** `[实]` `[双]`
① `glsl/integration.js:106-107` 仅 `!staticFrame` 才封顶 65536px——**注释明示「用户要求：静态帧不应用降低分辨率操作」**，属有意取舍（代价：4K 静态帧 8.3M px 逐像素解释执行，第三方复杂 shader 秒~十秒级/效果）；② 转译器只内联了 mix（`transpile.js:747-750` 亲核：`step/smoothstep/clamp/min/max` 全发 `__rt.<fn>` 属性查找+typeof 判型+vec 版 `mk(n)` 新 Float32Array，纯标量 `sin(x)` 也走 `__rt.sin`）；③ 多分量 swizzle 读恒生成 `[a,b,c][i]` 数组字面量，嵌套表达式文本膨胀 ~2^d 份重复求值；④ `__initGlobals` 每像素重置全部全局含 const 常量与带初始化器数组；⑤ 像素循环固定开销：varyings `for..of` 迭代器分配 + `gl_FragColor.fill(0)` + 输出 12 次 Math 调用；texture2D 调用链 4 层 + 每采样 `Set.has`。②-⑤ 与静态/动态无关，是无条件浪费。
**修复**：②-⑤ 按前述内联/预展开/写分析方案执行（解释器吞吐 ×2-3）；静态帧降采样需与画质决策重议（折中阈值或 quality 选项），不宜单方面改。

**P1-9 粒子每帧从零重建+重模拟（跨帧 O(N²)），operator 参数每粒子每步字符串解析**
`particles.js:17, 82-91`（sys 每帧重建 → `_simulatedTo` 失效，每帧从 0 模拟到 t，guard 2000 步）；`:300/316/365/397` `parseVec3(getVal(...))` 在粒子内循环；`:20-27` 每帧两次替换全局 `Math.random`。216 帧 loop 9s 总计 O(N²) 粒子步。
**修复**：sys 按对象 id 缓存于渲染器实例（同 `_mdlCache`）；times 单调时增量推进；operator 参数一次解析传标量；RNG 显式传参。

**P1-10 puppet/model 每帧重建静态结构 + 每像素采样闭包数组分配**
`puppet.js:104-127`（bindWorld/bindInv/校验每帧重建，绑定姿势是静态数据）、`:176-193`（顶点每帧 new 对象数组）、`:590-604`（sample() 闭包每像素 7 数组含 4×4 嵌套）；`model.js:218` 每像素 2 个字面量数组、`:559-642 _shadeGeneric` 每像素 ~15 数组 + 每光源 `Math.pow`。
**修复**：bind 链按 mesh 缓存；顶点 SoA Float32Array；预乘 alpha 纹理一次性预计算；着色函数改标量参数；spec pow 用 256 项 LUT。

**P1-11 无界/重复纹理解码：实例级 Map 无上限 + `loadTexImage` 双重 parseTex + 跨请求零复用**
`core.js:59`（textureCache 无 LRU，44MB pkg 解码后 130-350MB/实例）；`textures.js:116-121` parseTex+decodeTex 各自全量跑 parseTexInternal（双重逐 mip LZ4）；worker 退出全丢、下次 anim 全量重解码；`jpeg.js:163-165` huffDecode 每 bit 线性扫表（4096² JPEG 数秒级）。
**修复**：decodeTex 复用 parse 信息（首次 ~2×）；字节 LRU；按 pkg mtime 落盘解码产物或常驻解码 worker；规范 Huffman 直读表。

**P1-12 `_downsample` 每帧对同一纹理重算不缓存**
`image.js:167-171` + `core.js:806-832`：纹理不可变、maxDisp 跨帧恒定，却每帧全 texel box-filter + new Uint8Array（4096² 纹理 16.7M texel 读 + 16MB 分配/对象/帧）。
**修复**：纹理对象挂 `_dsCache = Map<maxDisp, img>`（maxDisp 量化到 2 的幂为键）。

### P2

**P2-1 玻璃/侧栏 blur=0 不真正关闭**：`client.js:2012-2019, 4115-4116` blur(0px) saturate(1.15)… 仍非 none，强制 backdrop 采样层（壁纸 media filter 侧已正确做 none，:2026-2031）。
**P2-2 拉绳拖拽写 left/top + 每事件读 offsetWidth**：`client.js:3782-3792, 3726-3738` → 指针频率强制同步布局；settle 也是 top/left transition（:5036-5040）。改 transform + 尺寸拖拽期缓存。
**P2-3 设置窗 `:has()`×4 + 全屏 overlay blur(3px)**：`client.js:4263/4305/4321/4326, 4886-4891`——设置页内任何 DOM 变动（搜索键入/进度 width 更新）触发 dialog :has() 重估 + 整窗玻璃重滤波。改稳定 data- 属性 + overlay 去 blur。
**P2-4 scene-anim 轮询 1.5s 无变化守卫 emit**（`client.js:1440-1454`，对比转码轮询有守卫 :1729-1741）；transcode 轮询 500ms 全程 fetch；两者 document.hidden 不暂停。
**P2-5 Edge canvas 绘制循环每帧冗余 clearRect**（`client.js:1184-1214`，4K 源 60fps ≈ 1G px/s；cover 模式 draw 全覆盖时 clear 纯冗余；>1080p 源 dpr cap 可降 1）。
**P2-6 emit() 全量扇出架构**（`client.js:424-433`，108 处调用点，useStore 无 selector 粒度；occlusion 事件也全树重渲染）。
**P2-7 scene-gl 每帧全量重设 uniform + 每帧 getAttribLocation + 无 VAO + 每帧重建静态 MVP**（`scene-gl.js:430-432, 491-500, 459, 526`；材质常量每帧字符串 split；attrib 预取 + VAO + 常量预转换可全消）。
**P2-8 scene-gl 默认 fpsCap=0 不限帧 + 无静态场景跳帧**（`client.js:86`；无 g_Time 的场景 60-144fps 全功率空转；CPU mp4 路径默认才 12fps）。
**P2-9 DXT 全解压 RGBA 上传，未用 WEBGL_compressed_texture_s3tc**（`scene-gl.js:214`；8K DXT 38MB→151MB 显存/张，带宽 ×4；WE 的 DXT 块与 S3TC 兼容）。
**P2-10 帧缓存/动画缓存/转码缓存只增不减**（`index.js:2344 sf35_`、`703 san_sf35_`、`3174 sv1_` 前缀 bump 后旧文件永留；anim key 含 w/h 组合爆炸；转码无上限。当前 44MB，长期单调膨胀）。启动清扫旧前缀 + 目录 LRU + w/h 档位量化。
**P2-11 scene-frame 失败无负缓存**（`index.js:2349-2392`，不支持的场景每次列表刷新全链路重来 + 主线程 `extractSceneMainImage` 解码+PNG 编码回退）。
**P2-12 blur 高斯核每像素重建 weights 数组**（`blur.js:76-84` 在 y/x 循环内建核；hoist 到 pass 级 + 行指针步进采样）。
**P2-13 bloom：lin() 每像素 Math.pow（输入仅 256 取值 → LUT）+ bright/hdr 双缓冲分别模糊（线性可先加后糊，工作量减半）+ 不可分盒式模糊**（`bloom.js:19, 140, 188-245`）。
**P2-14 每帧 encodeIdat zlib level6**（`scene-render-worker.mjs:33` → `apng-encode.js:34`；150-400ms/帧@1080p；fmt=mp4 时中间 APNG 整个多余——原始帧 rawvideo pipe 给 ffmpeg 可跳过 deflate+重解码）。
**P2-15 scene-anim 主线程 `new SceneRenderer` 探测 timings（与 worker 重复整包读）**（`index.js:2482-2483`）；timings 移 worker 或按 abs+mtime 缓存。
**P2-16 合成路径 Uint8↔float 往返 + 缺不透明快速路径**（`canvas.js:41-44, 103-106, 167-170`：/255、/outA、Math.round×4；a==1 且 dstA==1 时仍全混合；乘倒数 + `(x+0.5)|0` + 行拷贝 `set` + Uint32 视图）。
**P2-17 `probeMp4` 同步 16MB 读 + 尾部 8MB 逐字节回扫**（`index.js:922-967`，主线程 10-50ms/次；有 FIFO 500 缓存兜底）。
**P2-18 视频抽帧临时文件名固定（pid+i）→ 并发竞态**（`index.js:654`；加随机后缀 + finally 删除）。
**P2-19 buildInventory 无 in-flight 去重**（`index.js:1939-1942`，仅 3s TTL；复制 steamProbeInflight 模式）。
**P2-20 文本位图缓存 FIFO 按条数不按字节**（`text.js:28-32`，compensate≤32 → 单条可达数十 MB；改字节预算 LRU）。
**P2-21 关键帧/相机 transforms 每帧 sort + 每帧字符串 parseVec3**（`core.js:746-761`、`camera.js:123`；构造期预排序 + 数值通道缓存）。
**P2-22 场景 JSON 每帧逐对象重读+重解析（含 LZ4 条目重解压）** `[双]`
`image.js:73` renderImage 每帧 `readJsonAny(o.image)` → `core.js:112-121` 无缓存 → `textures.js:88-105` `read()` 每次 `probeLz4Chain` + `readPkgEntry` 全量解压 + `JSON.parse`；`model.js:8,19`、`core.js:293-299` 同款。50 对象场景每帧 50-150 次 parse（~2-10ms/帧）纯浪费——pkg 内容不可变，实例级 `Map<relpath, parsed>` 即可归零。
**P2-23 GLSL 编译缓存仅实例内存；#include 每次编译重读文件；parseMeta 每编译跑 3 遍**
`integration.js:63-64`（缓存挂 renderer 实例）+ `scene-render-worker.mjs:13,34`（每 job 新实例 → 热门第三方 shader 每 job 重编译 100-500ms）；`integration.js:86-93` include 每次 `existsSync+readFileSync`；`preprocess.js:104` + `executor.js:13-14` + `integration.js:53` 三方各跑一遍 parseMeta。修复：模块级全局缓存（compiled 无实例状态可共享）+ 编译产物落盘（源码 hash 键，new Function/vm.Script cachedData 重建）+ include 内容 memoize。
**P2-24 scene-player（WebGL 播放器页）每帧重复 GL 查询与队列重建**
`scene-player.js:1244-1272`（bindProg3D 每帧 ~14 次 `getUniformLocation`，program 切换后重调）、`:1153`（每帧 `getParameter(MAX_VERTEX_ATTRIBS)`）、`:1296-1323`（每帧重建 8 个渲染队列 + 每模型浅克隆）、`:1165`（`filter().length` 每帧分配只为计数）。中等场景 ~1-5ms/帧。修复：program 创建时缓存 location 表；队列分桶加载期一次。
**P2-25 depthparallax QUALITY 1/2 每像素 24/64 步 ray-march，全走分配型采样**
`depthparallax.js:69-84`：march 循环内每步 `_texSample` + `cur=[cur[0]-delta[0],…]` 新数组。全屏 QUALITY2 ≈ 1.1 亿次双线性 + ~7 allocs/px → 单效果 5-10s/帧（场景使用即灾难）。修复：标量化 march + 强制降采样输入。
**P2-26 blurradial 每 tap 每像素 cos/sin；foliagesway 帧常量每像素重算**
`blurradial.js:53-56`（`K.o[i]*amt` 与三角函数只依赖帧常量却在像素循环重算，全屏 ≈ 40-80ms/帧）；`foliagesway.js:57-62`（`speed*t*sW[i]` 每像素 8 次冗余乘法）。修复：循环外预计算 cosK/sinK/相位表。
**P2-27 scene-scripts 每帧 props 重 dispatch + O(n) find + 全场景 walk + 数值-字符串往返桥**
`scene-scripts.js:614-621`（scriptproperties 每帧组装 payload + `copyPlain` 深拷贝 dispatch）、`:167-175`（`objList.find` 每属性访问 O(n)）、`:672-696`（每帧递归 walk 全场景）、`:197-211`（ownerRef 为 getter 桥：每次 `thisLayer.origin` 读 = 跨 context 调用 + String + parseV split + new Vec3；写走 `toFixed(6)` 字符串再被渲染侧 parseVec3 重解析）。合计每帧 ~2-8ms。修复：props 按 userProps 代次 memoize；name→obj Map；walk 结果缓存；数值走数组而非字符串。

### P3（择要）

- **canvas.clear 逐 4 字节循环写**（canvas.js:8-14 → Uint32Array.fill，@4K 省 20-40ms/帧）。
- **JPEG huffDecode 每 bit 线性扫表 + 每块 3 个新 Float64Array**（jpeg.js:152-172, 260；规范解码直读/前缀 LUT + 块缓冲复用）。
- **client bundle 880KB，69% 是 base64 吉祥物图**（src/client.js:3663, 3669 → host 路由懒加载）。
- **classic（CD 架）模式绕过分页无虚拟化**（client.js:2916/3040/3272 → content-visibility:auto）。
- **`data-we-appwindow` 死属性**（client.js:5244-5267 检测了但 CSS 无消费，声明的降级不存在）。
- **进度条 width transition 布局动画**（client.js:4240-4244 → transform:scaleX）。
- **scene-gl：shader 串行 fetch、meta 双请求、contextrestored 回调缺 disposed 短路、无 alpha=0/离屏剔除、GL ready 后 8K 底图 img 常驻**（scene-gl.js:646-651、client.js:1321-1330、:597-605、:510、:1561-1565）。
- **主线程每帧字符串解析/重复排序小项、`_rt_` 快照整幅拷贝、`_meshBounds` 每帧全顶点扫描、最近邻放大伪影、双 PNG 编码器**。
- **apng-encode crc32 表每 chunk 重建 + 每行 Buffer.from 视图**（apng-encode.js:5-11, 32；照抄 canvas.js 的模块级表）；APNG 全帧 filter-0 无帧间差分（帧差 + fcTL 区域矩形可缩 5-50×）。
- **mask/noise 用 RGBA 采样取 [0] 而零分配的 `_texR` 就在旁边**（waterwaves.js:43、shake.js:46、tint.js:24 等；model.js:646-659）；`mSx===1&&mSy===1` 时恒等乘法可分支消除。
- **文本位图缓存 key 含 color**（同文本换色重栅格化；可改 blit 时着色）。
- **配置每请求 readFileSync + 进度轮询端点每秒 statSync/readFileSync**（index.js:459-464 等；settings 内存缓存 + 写时失效）。
- **spawnFfmpeg 对已 abort 的 signal 仍继续 spawn**（index.js:1377-1394）。
- **ffmpeg 双镜像并行下载占双份带宽**（index.js:1280-1310）。
- **`/remove`、`/upload-dir` body 无大小上限**（index.js:3365, 3401；对比 /settings 64KB 上限）。

---

## 4. 修复路线图（建议波次）

**第 1 波（止血，防灾难，每项 ≤ 半天）**
1. scene-gl 链 FBO clamp 到画布预算（P0-1）——本例立即从 1fps/92% 满载回到可用。
2. 低帧率熔断 + WebGL2 一次性预检 + SwiftShader 嗅探（P0-2/P1-3）。
3. `extractSceneVideoFrames` memoize + 头部探测（P0-3）。
4. 全局渲染信号量 + worker 注册表 + disposer 终止（P0-4）。
5. scene-anim 完成产物强制落盘（对齐注释意图）+ frameCount 上限（P1-4）。

**第 2 波（明显收益，1-2 天级）**
6. scene-resource 主分支接缓存 + encodePng 异步化（P1-2）。
7. CPU 渲染器 scratch 池 + 写入式 _texSample/applyBlending（P0-5）。
8. passthrough/sway 预处理降采样盲区（P0-6）+ _downsample 缓存（P1-12）。
9. 气泡玻璃收敛 + blur=0 真关闭 + probe video 销毁 + fontCustom style 缓存（P1-5/6/7、P2-1）。

**第 3 波（结构性，按需）**
10. GLSL 内置函数标量化内联 + initGlobals 写分析 + 像素循环特化（P1-8，解释器吞吐 ×2-3）+ 编译缓存全局化/落盘（P2-23）。
11. 粒子增量模拟（P1-9）；puppet/model 静态结构缓存（P1-10）；场景 JSON 实例级缓存（P2-22）；depthparallax/blurradial 热点（P2-25/26）。
12. 纹理解码跨请求复用 + 压缩纹理上传（P1-11、P2-9）；scene-gl VAO/常量预转换（P2-7）；静态场景跳帧（P2-8）；scene-player location 缓存（P2-24）。
13. 缓存治理（P2-10/11）+ P2/P3 清扫。

---

## 5. 已做得好的防御（避免误报）

- **Host**：扫描链全异步+分块；CPU 光栅在 worker；广泛的 in-flight 去重；转码成熟治理（并发闸 2+deadline+断开即杀）；大文件流式 Range 三分支正确；上传流式+背压+上限；原子写+启动清扫；ffmpeg 懒下载+校验。
- **Client**：壁纸 media filter 默认 none / transform identity→none（避免常驻离屏层）；视频切换 GC 彻底；Edge 绘制事件驱动+same-canvas 守卫；缩略图分页+lazy+单遍聚合；持久化 200ms 防抖+pagehide flush；无 MutationObserver；主样式表 TAG_ID 去重一次注入；遮挡暂停三信号；卸载清理完整。
- **scene-gl**：帧内零 GL 对象创建；program 去重+uniform location 预取；编译 fail-fast 不重试；四路 dispose + WEBGL_lose_context；hidden+IntersectionObserver 停帧；GL 激活期无 CPU 双渲染；画布 1920×1080 上限；sf35 FBO 反馈环修复正确。
- **CPU 渲染器**：sf38 anim 降采样主路径；`_rt_` 快照 rev 缓存；MDL/锚点缓存；文本双层缓存；worker 单实例复用+逐帧压缩 IDAT；确定性 RNG；blit 数学质量高；脚本 vm 沙箱+超时熔断（同类实现高水准）；LZ4 边界校验。
- **GLSL 解释器**：mix/vec 二元运算内联已生效（实测转译输出验证）；varying 双线性缓冲预分配复用；编译缓存键（file|combos）正确；`_texR/_texA` 单通道零分配采样器已存在（修复采样风暴时可直接复用）；失败有明确降级通道，性能问题不会静默变正确性问题。

---

## 6. 附：实测复现命令要点

- A/B：`google-chrome --headless=new --remote-debugging-port=9333 <GUI URL>` + CDP Profiler/Tracing（脚本存 `.perf-probe/cdp-trace.mjs`）。
- scene-anim 计时：`curl -w '%{time_total}' '<GUI>/wallpaper-engine/scene-anim/<token>?fps=12&sec=6&fmt=mp4&w=1280&h=720'`（token=base64url(scene.pkg 路径)）。
- 渲染 worker 观测：`ps -T -p <dsh pid> -o %cpu,comm | grep WorkerThread`。
- 孤儿渲染复现：请求发出后立即断开客户端，观察 `.prog` 进度继续推进、完成后 cache 目录是否有产物。

---

## 7. 复核状态（汇总报告前的逐条确认，2026-08-29）

> 复核方式：主审计代理逐行读码 + 独立子代理交叉 + 本人对全部 P0/关键 P1 的代码位置亲自重读、对可运行项做本机实测。

### 7.1 已确认（代码亲读 + 实测双重证据）
| 发现 | 代码证据（本人重读） | 运行时实测 |
|---|---|---|
| P0-1 scene-gl 8K 效果链 | `scene-gl.js:396-399`（FBO=主纹理尺寸）、`:457-458` | GPU 进程 RSS 1.04→1.2GB；headless 1fps、GPUTask 342ms/次 |
| P0-2 无低帧率熔断 | `scene-gl.js:537-558`（帧时环只 push，全库无消费方） | fps=1 持续满载不降级 |
| P0-3 渲染前同步整包扫描 | `index.js:715-729`（每次渲染调 extractSceneVideoFrames）+ `:628,634`（readFileSync 整包） | —（逻辑静态可证） |
| P0-4 worker 无并发闸 | `index.js:731-740`（无条件 new Worker）、`:700-707`（cache key 含 w/h） | 实测双 WorkerThread 各 99% CPU |
| P0-5 采样/效果分配风暴 | `model.js` `_texSample` 定义（哨兵 `[1,1,1,1]`+返回新数组）、`blur.js:73,82-90`（整帧 new + 权重每像素重建） | 渲染进程 ~20MB/s RSS 锯齿 |
| P0-6 passthrough 绕过降采样 | `image.js:263-275`（fullscreen 分支无 _downsample、无 staticFrame 门） | anim 3s/帧 与 sf38 基线 1.6s/帧 的差值构成 |
| P1-2 scene-resource 绕过缓存 | `index.js:2718-2745`（主分支每请求 readFile 整包；缓存仅 `!bytes` 兜底分支；`no-store`） | — |
| P1-4 渲染产物可静默丢失 | `index.js:2536-2595`（reject 只向死 socket 422，无日志） | 实测 1/2 孤儿渲染无产物 |
| P1-5 气泡 backdrop-filter | `client.js:4109-4116`（`[class*="_bubble"]` 4 段链） | —（样式静态可证） |
| P2-1 blur=0 不真关 | `client.js:2012-2019`（`--we-blur: 0px` 非 none）+ `:4115` 恒应用 | — |
| 粒子每帧重建重模拟 | `particles.js:17`（每帧 `_buildParticleSystem`）、`:86-87`（fresh `particles:[]`）、`:20-21`（全局 Math.random 替换） | — |
| GLSL `__rt` 派发层 | `transpile.js:747-750`（BUILTIN 全走 `__rt.<fn>`，仅 mix 内联） | — |
| scene-gl 全链 no-store | `scene-gl.js:136,146` | — |
| WebGL2 真机不可用 | `scene-gl.js:308-309`（无预检，逐 token 失败） | 实测窗口 Chrome `NO_CONTEXT` → 触发 11 分钟 CPU 渲染 |

### 7.2 复核后修正的结论
1. **godrays `_gaussPass`「未定义」为误报**：`godrays.js:144-162` 已有完整定义（当前工作树）。既有审查文档 `review/00`（LGT-01）与两路子代理的「godrays 从未生效」结论过时。报告 §3 P1-1 已改写为误报记录。
2. **静态帧全分辨率是有意决策**：`image.js:184-185`、`glsl/integration.js:106` 注释明示「用户要求：静态帧不降采样（4K 降采样会马赛克）」。P0-6/P1-8 中静态帧部分重新定性为「既有取舍」，真正无条件漏网的是 anim 模式 passthrough 路径；静态帧提速需与画质决策一起重议。
3. 小勘误：emit() 调用点实测 114 处（代理报 108，量级一致）；`_texSample`/passthrough 的行号与代理报告略有偏移（工作树未提交改动所致），已按当前文件行号修正。

### 7.3 未逐行复核（信任子代理 + 抽查一致）
P2/P3 层面的具体条目（scene-player 每帧 GL 查询、depthparallax ray-march、scene-scripts 桥接、blurradial 三角函数等）来自单路代理，方向与抽样核对一致，修复前建议按 file:line 再确认一次行号。
