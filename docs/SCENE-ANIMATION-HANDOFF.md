# 场景动画交接手记（Scene Animation Handoff）

> 供未来实现者使用。本插件曾实现过完整的"WE 场景动画"渲染管线，2026-08-30 因可靠性与
> 维护成本放弃并删除；本文保留**全部决策背景、技术要点、已删资产清单与推荐实现路线**，
> 让具备足够技术能力的后来者可以在此基础上重新实现。
> 配套：GitHub issue「场景动画开发邀请」；知识落点索引见 §6。

---

## 1. 功能定义：什么算"场景动画"

WE 的 Scene 壁纸是**原生 3D 场景**（scene.pkg：对象树 + 纹理 + puppet 骨骼模型 +
粒子系统 + 效果链 + NSL 脚本）。官方引擎在桌面实时渲染完整动画：粒子飘落、骨骼动画
（呼吸/眨眼/摆裙）、相机运镜、效果随时间演化、脚本驱动的昼夜/入场/循环。

本插件当前只渲染**静态帧**（`/scene-frame`，取场景静止态时刻）+ **内嵌视频纹理快路径**
（`/scene-video`，场景作者内嵌的 MP4 视频纹理，硬件解码）。**"场景动画"= 让 Scene 壁纸
像官方一样动起来**（多帧渲染 → 视频播放，或实时渲染）。

---

## 2. 决策记录：为什么放弃（2026-08-30）

自研动画方向（多帧渲染 → ffmpeg 合成视频 → `<video>` 播放）被放弃，三重理由：

1. **不可靠（根因 A，框架级）**：13/15 场景由 NSL 脚本驱动动画。NSL 库把整个动画调度器
   内联进每个 `{script, value}`，靠**真实时钟 setTimeout/事件**推进，与场景时间 t 无关。
   让脚本动画随 t 演进 = 在 vm 沙箱里再实现一个事件循环语义 —— "再写半个引擎"（2-4 周
   且无法根除）。详见 §3.1。
2. **维护打地鼠**：49/168 条 commit（29%）触碰渲染器，大量是"某类壁纸又不对了"的追修；
   每来一张新 workshop 壁纸都可能撞上未逆向特性。
3. **成本高**：CPU 软件光栅 4K 单帧 3-30s；动画（240 帧）分钟级；即使 GPU 加速 + NVENC +
   帧并行，首次渲染仍要数分钟，客户端还要维护进度轮询/竞态/beta 开关。

**放弃的是"自研多帧→视频"路径，不是"动画"本身**：内嵌 MP4 快路径（sceneVideo）保留，
硬件解码、可靠、免费。

---

## 3. 技术要点（复刻必读）

### 3.1 根因 A：NSL 脚本时间轴（动画不可靠的核心）

- WE 编辑器把整个 NSL（Noeru Script Library v1.4.0）框架内联进每个 `{script, value}`：
  动画调度/时间推进由框架自己的调度器完成（`AnimationScheduler.calcInterpolators()` 每次
  update 读 `engine.frametime` 做 `time += frametime`，事件经 `engine.setTimeout`）。
- 插件 vm 沙箱（`lib/scene-scripts.js`）只求值 init + update；静态帧只有 1 次 update →
  脚本动画停在 init 态；多帧渲染时 `engine.runtime` 传的是场景 t，但调度器按真实时间推进
  → 动画不随 t 走。
- **已实现的半套方案（P4a 快进）**：`DSH_WE_SCRIPT_FF=1` 启用，把剩余场景时间切成
  ≤120 步逐次重跑**状态脚本**（`scene-scripts.js` 的 `isStatefulScript`/`fastForwardSteps`），
  让动画时钟到达 t。**未解的关键**：动画注册 API（`thisLayer.getAnimationLayer` /
  `shared.offsetedStartAni`）是 no-op —— `tAniInterpolators` 恒空 → 快进无对象可推。
  实测 `percentage=1` 时 no-op 与官方"钉末帧"等价（静态帧够用）；真动画需实现注册 API。
- **解决方向**：让 NSL 调度器改读 `engine.runtime`（场景 t），或把调度器事件循环在沙箱内
  重实现；补全 `getAnimationLayer`/`startAnimation` 并让动画时间轴与场景时钟同步。

### 3.2 现有可复用资产（静态帧渲染器 = 动画渲染器的地基）

| 模块 | 现状 | 动画复刻可复用 |
|---|---|---|
| `lib/we-renderer/`（40 文件） | 完整 SceneRenderer：puppet 蒙皮（MDLV/MDLS/MDLA）、粒子模拟、效果链（30+ 内置 + 第三方 GLSL 解释器）、相机（eye/ortho/zoom/paths）、文本、光照 | ✅ 全部 —— 动画 = 每帧换 t 渲染 |
| `lib/scene-render-worker.mjs` | 单帧协议（worker/fork 双模式，GPU 用系统 Node 子进程） | ✅ 扩展为多帧即可（旧多帧协议已删，见 §4） |
| `lib/scene-player.js`（1,810 行，**已禁用**） | 客户端 WebGL 实时渲染器（每场景一个 WebGL 上下文冻结页面而禁用） | ✅ 场景图种子；未来 WebGPU 路线的起点 |
| `sceneStaticFrameTime`（lib/index.js） | 静止态时间选择（single 动画播完 + 相机路径总时长） | ✅ 可反向用于定位动画关键时间 |
| `scene/animation.js` | 属性动画求值（c0/c1/c2 逐通道、relative 偏移、贝塞尔切线） | ✅ 已实现 |
| `scene-scripts.js` 快进（P4a） | `DSH_WE_SCRIPT_FF=1` 状态脚本时间轴推进 | ⚠️ 半套，缺动画注册 API |

### 3.3 性能现实与 GPU

- **CPU**：4K 全分辨率效果 3-30s/帧（particles/GLSL 解释器逐像素）；动画 240 帧分钟级。
  静态帧可接受（缓存一次），动画必须 GPU。
- **GPU 现状（静态帧加速 `sceneGpuAccel`）**：supreium-headless-gl（WebGL/ANGLE），
  **仅 x64 prebuild**（ABI 93-147；DSH Electron ABI 148 无 → fork 系统 Node 子进程跑，
  arm64 门控回退 CPU）。
- **WebGPU/Dawn 已验证**（spike + `lib/we-renderer/gpu-dawn/backend.js` 雏形）：`webgpu`
  npm 包 prebuild 覆盖 win32-x64/linux-x64/linux-arm64/darwin-universal；RTX 4060 960×540
  计算着色器 **0.31ms/帧 vs CPU 6.58ms（21.1×）**；落地路径注释在 backend.js 头部
  （GLSL→WGSL 复用现有 transpile AST；Dawn 边界：单进程单实例、unmap 后勿立即重建）。
- **客户端 WebGL 路线**：scene-player.js 曾实测"每场景一个 WebGL 上下文冻结页面"——需
  单上下文复用或离屏渲染方案。

---

## 4. 已实现又删除的资产清单（2026-08-30，git 恢复后可考古）

> git 已于 2026-08-30 恢复（原 .git 损坏）；历史提交含 sf31-sf44 全部迭代。重构前完整
> 备份 `D:\dsh-wallpaper-engine_20260830`（只读）。

| 资产 | 位置（已删） | 功能 |
|---|---|---|
| `/scene-anim` 路由 | `lib/index.js` | 多帧渲染 → APNG/MP4/WebM（ffmpeg image2 + NVENC/x264/vp9） |
| `/scene-anim-progress` 路由 | `lib/index.js` | 渲染进度轮询（内存 + .prog 文件） |
| 动画缓存 helpers | `sceneAnimCachePath`/`sceneAnimProgressFile` | `san_sf32_` 键 |
| 帧并行 | `renderFramesParallel`/`sceneAnimWorkerCount` | times 切段多 worker 并发（每 worker 独立 GL 上下文） |
| PNG 帧序列管线 | worker 多帧分支 | 每帧独立无损 PNG → ffmpeg 直读合成（替代数百 MB APNG） |
| APNG 编码器 | `lib/apng-encode.js` | encodeApng/encodeIdat |
| 客户端升级机制 | `src/client.js` `queueSceneAnimUpgrade` | 静态帧 → 后台渲染 → 无缝切换 + 进度条 + beta 开关 |
| 场景循环判定 | `hasSingleAnim`/`sceneLoop` | 有 single 入场动画 → 视频不循环 |

**删除时已验证**：`npm run build` / `npm run verify` / `verify-scene` 13/13 全绿。

---

## 5. 推荐实现路线（三选一 / 可组合）

| 路线 | 描述 | 前置 | 工作量估 |
|---|---|---|---|
| **A. 多帧渲染 + 视频输出** | 恢复 §4 清单（git 考古）+ 解根因 A（§3.1）| 根因 A（2-4 周）| 3-6 周 |
| **B. WebGPU/Dawn 后端** | 用现有 `gpu-dawn/` 雏形把渲染/效果移到 GPU（21× 已验证），再做多帧 | Dawn 集成（3-6 周）| 6-10 周 |
| **C. Windows 官方引擎捕获** | `wallpaper64.exe -control openWallpaper` + ffmpeg gdigrab 窗口捕获，**像素级 100% 一致** | 仅 Windows；隐藏窗口/移出桌面 | 1-2 周（快路径）|

**组合建议**：短期用 C 出"完美帧"（Windows 主战场）；中期 A+B 做跨平台自研。
**不推荐**：引入第三方渲染器整体替换（功能倒退 + 跨平台冲突）；非静态逆向（见 §6 约束）。

---

## 6. 硬约束与知识落点

### 硬约束
- **跨平台**：Windows / Linux(含 WSL) / macOS（宿主为 DSH 的 Electron/Node 与浏览器）；
  渲染器必须能在**纯 Node 进程**里跑（Linux/macOS 无官方引擎）。
- **worker 非阻塞** + 静态帧缓存回退链（动画失败必须回退静态帧，不得白屏）。
- **禁止非静态逆向**：WE 本体曾损坏恢复数次——**不得对官方引擎做 hook/注入/实时采集**；
  官方目录的反编译文件（`wallpaper64.exe.c` 24.7MB + asm 76.4MB、`scenescript64.dll.c`
  214MB）**只读可用**于静态查证。

### 知识落点索引
- 渲染器事实：代码注释（sf 标记；camera.js eye/zoom、puppet.js MDLA/additive、
  image.js 定位、scene/animation.js relative、scene-scripts.js 快进）。
- 官方数学基准：TODO.md §四 + `_refs/we-shaders/`（官方 shader 源码）+ `_refs/linux-wallpaperengine/`
  （lwe 参考实现）。
- 可行性分析：`docs/RENDERER-FEASIBILITY.md`（三路线 + 约束矩阵）。
- 已删资产细节：git 历史（sf31-sf44 提交）+ 备份 `D:\dsh-wallpaper-engine_20260830`。
- 验收基线：TODO.md §二 验证基线（15 场景回归集）；静态帧渲染器是动画的对照基准。
