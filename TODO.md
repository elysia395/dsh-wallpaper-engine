# Wallpaper Engine 跨平台渲染引擎 — 现状与 TODO

> 目标：将 `lib/scene-renderer.js` 发展为与 Wallpaper Engine 原生渲染高度一致、
> 可在多平台（Windows/Linux/macOS 的 Node/浏览器）运行的 WE 场景渲染引擎。
> 以 wallpaper64.exe（官方引擎逆向）为**事实基准**逐组件复刻，辅以引擎 shader
> 源码、OBJ 源几何、场景数据与 preview 渲染验证。
> 渲染保持 worker 非阻塞 + 静态帧缓存。
>
> **历史修复轮次（sf31-sf41j）已压缩归档**，完整细节在 git 历史中。本文件
> 只保留当前状态、未完成项、关键防回归事实。

---

## 一、当前架构（已实现）

### 渲染管线
- **Canvas**：RGBA + z-buffer，`blit`/`blitScaled`（双线性）。
- **相机**：`_setupCamera` — lookAt + Perspective/Ortho，垂直 FOV 50°；
  `camera.projection`/`general.orthogonalprojection` 驱动；`fovOverride` 可调。
- **光照**：4 灯衰减 + Blinn spec + ambient/skylight 按法线·up 混合。
- **MDL 静态网格**：stride 候选探测 + 重算平滑法线；光栅化透视校正 1/w、
  双面渲染、opaque/additive/translucent 混合。
- **Puppet**：MDLV 顶点 + MDLS 骨骼 + MDLA 动画 + `_skinPuppet` 蒙皮；
  动画层合成（普通 mix + additive delta + rate）；MDAT0001 锚点挂载子对象。
- **粒子**：emitter/initializer/operator 完整模拟（重力/阻力/颜色渐变/尺寸/
  旋转/轨道），mulberry32 种子 RNG 确定性。
- **文本**：`lib/font-render.js` CFF 字体引擎；即时文本（时钟/日期/FPS）跳过
  渲染（静态帧缓存冲突，见 TODO）；作者水印（visible 用户属性）跳过。

### 效果链（CPU 复刻官方 shader；GPU 加速见下）
- 官方内置 30+ 效果全部实现（waterwaves/waterripple/shake/foliagesway/bloom/
  godrays/depthparallax/lightshafts/glitter/swing/shimmer/clouds 等），
  ApplyBlending 全 32 模式、mask UV 缩放、多 pass FBO 链。
- **第三方 workshop 效果**：运行时读 pkg 内 `shaders/workshop/<id>/*.frag`
  → GLSL 解释器（@shaderfrog/glsl-parser + 自写 AST→JS 转译器）通用执行；
  解析失败回退原图。
- **GPU 加速（sf40h 实装，`lib/we-renderer/gpu-gl/`）**：
  - x64 + supreium-headless-gl（WebGL/ANGLE，prebuilds 直接打包，无 node-gyp）
  - **配置项 `sceneGpuAccel`（默认 false，附属 beta场景动画）**：仅 beta 开启
    时 UI 显示/可用（测试中功能，不渲染动画即不使用）；开启后静态帧与动画帧
    都走 GPU。渲染门控：`_getGpuBackend` 检查 `this.gpuAccel`；worker 经
    workerData.gpuAccel 传递；scene-frame/scene-anim 缓存键含 gpu 标志隔离
    （GPU/CPU 输出有微小 float 精度差，切换不得命中旧帧）
  - **边缘处理（开关 GPU 时）**：静态帧强制刷新（URL 加 `?gpu=0/1` 触发重取，
    服务端按 pathname 解析忽略 query、按配置算新 gpu 键）+ 无内嵌 MP4 时
    `queueSceneAnimUpgrade` 重触发（内部先 cancel 旧渲染 → probe abort →
    服务端取消旧 CPU 渲染 → 新配置渲染；beta 已开但无缓存时开 GPU 即触发）；
    trySwitch 去参数比较（带 gpu 参数的静态帧 URL 动画完成后仍能切换）；
    beta 关闭时一并清 `sceneGpuAccel`（避免重开 beta 时 GPU 隐式恢复）
  - **竞态修复（实测"开启后没加速"根因）**：`persistSelection()` 是 200ms 防抖 +
    异步 PUT — 开关 GPU 后立即触发渲染时宿主 config 还没收到 sceneGpuAccel →
    服务端按旧配置（CPU）渲染。修复：开关时跳过防抖立即冲刷
    （`clearTimeout + writeLocalCache + pushPersisted`），等 PUT 落盘完成
    （宿主「响应即已持久化」）再触发 queueSceneAnimUpgrade — 与 beta 开启同款。
    实测链路验证（全部 PASS）：单帧 worker gpuCalls=5 / 4103ms vs CPU 6566ms；
    多帧动画 GPU 10058ms vs CPU 28997ms（3 倍）；配置持久化读回 PASS。
    **部署注意**：lib/index.js（host 端）改动须重启 dsh web；lib/client.js
    改动须 `npm run build` — 实测"没加速"多为旧构建或 host 未重载。
  - **sceneVideo 抢占修复（实测"重启后进度条不出现"根因）**：inventory 给所有
    scene 壁纸无条件提供 `sceneVideo` URL（1858 行，只要 hasFrame）→ 客户端
    `applySelection` 的 `!selection.sceneVideo` gate 恒 false → **queueSceneAnimUpgrade
    永不触发** → 无进度条、无动画渲染（任何场景壁纸都是）。且 sceneVideo 只是
    "视频纹理"的 MP4 提取（丢失场景其他动画：粒子/骨骼/效果）。修复：
    - **beta 开启时忽略 sceneVideo**（`sceneVideo = betaSceneAnim !== true ? w.sceneVideo : null`）
      → beta 开走 scene-anim 完整渲染（GPU 加速）；sceneVideo 仅 beta 关闭时快路径
    - **sceneVideo 404 回退补触发**：media error 时置 null + 若 beta 开 →
      queueSceneAnimUpgrade（无内嵌 MP4 的场景也能触发）
  - **GPU 全覆盖修复（实测"GPU 占用/显存无变化、速度无改善"根因）**：此前
    只有水层 5 效果走 GPU，**后处理链（bloom 16-pass / color_grading）全 CPU**
    （每帧大头）→ 用户感知不到加速。修复 gl-shim + preprocess 的 4 个 WebGL
    兼容 bug，bloom 16/16 pass 全 GPU：
    - **floatifyIntLiterals 误伤 for 循环**：`for (int i = -2)` 的 `- 2` 被转
      `- 2.0`（int 类型错误）→ 保护一元负号/声明上下文（`= ( , [` 前缀），
      `(数字` 仅当后跟算术符才转（排除函数 int 参数 `ApplyBlending(31,`）。
    - **shaderfrog preprocess 对 common_blending.h 多独立 `#if MACRO == N` 求值
      有 bug**（真实文件残留空体函数）→ preprocessShader 先手动求值
      `#if NAME == NUM`（evaluateNumericIfs，CRLF 统一 LF）+ patch 空体
      ApplyBlending（31 分支 `A+B*opacity`）。
    - **`in vec3` 参数限定符**（ES 3.0 语法，WebGL1 不支持）→ stripInQualifiers
      移除（`const in` → `const`）。
    - **BLENDMODE 宏注入**：shaderfrog defines 不生成 `#define` 行 → 源码前
      显式插入 `#define <K> <V>`（[COMBO] 默认值）。
  - **color_grading 残留**：官方 shader 自身 vert `varying vec4` vs frag
    `varying vec2` 类型不一致（DX 允许截断，WebGL 严格拒绝）→ 该单 pass 回退
    CPU（便宜，可接受）。实测 Plana 静态帧 GPU 3231ms vs CPU 5808ms（**1.8 倍**）。
  - **GPU 利用率优化（用户实测 5-15%，效果链合并 + 纹理缓存）**：
    - 耗时分解：效果 44%（GPU 实际执行 ~13ms/次，其余为 CPU 组装/上传）+ **非效果
      （蒙皮/粒子/blit）56% CPU 固有** — GPU 利用率低主因是 CPU 渲染间隙
    - **runEffectChainOnGL**（gl-effect.js）：同一对象连续效果 GPU 内 FBO 乒乓，
      中间结果不读回 — 水层 4 效果独立 4 次 ~400ms → 单会话 ~35ms（91% 节省）。
      applyEffects 开头 `_tryEffectChainGpu` 检测连续可 GPU 效果批量执行；
      任一失败回退逐个原路径。修复：unit 0 预留给中间 FBO（mask 从 unit 1 起）、
      FBO 纹理补 MIN_FILTER、integration 导入 getVal。
    - **纹理上传缓存**（_texCache）：同一 texData 对象跨帧复用 GPU 纹理，多帧
      动画免 re-upload。
    - 实测：Plana 全场景 640×360 **2533ms vs CPU 6342ms（2.5 倍，链式额外 +22%）**；
      动画 6 帧 8889ms vs 28737ms（3.2 倍）。输出与 CPU 95.8% 一致（avg 3.6）。
    - **用户实测场景 3554161528 修复（实测"GPU 仍低、动画无加速"根因）**：用户
      当前壁纸是 3554161528（非 Plana），其效果 (rounded_mask/pulse_/blend/
      waterflow) 编译失败 → 链式 10 次只成 1 次、大量回退 CPU → 仅 1.26 倍。
      修复 4 个 shim/combos 缺陷：
      - **`float x = 0` int→float 赋值**（rounded_mask）→ floatify 转 `= 0.0`
      - **`CAST3(0)` int 参数**（pulse_）→ `(数字)` 后跟 `)` 或算术符才转
        （排除 `ApplyBlending(31,` 的 int 参数）
      - **blend BLENDMODE undeclared**：combos 在场景 pass.combos（非 [COMBO]
        注释）→ inferBuiltinCombos 开头合并 pass.combos + blend 默认 31
      - **waterflow `int * float`** → floatify 二元运算符覆盖
      实测：3554161528 静态帧 **2521ms vs 11501ms（4.6 倍）**、动画 **5188ms vs
      64897ms（12.5 倍）**。残余 rounded_mask `#else` 为 shaderfrog 嵌套 #if bug
      （CPU 路径同样失败，回退可接受）。
    - 残余：非效果 CPU（蒙皮/粒子）无法 GPU 化（WebGL 蒙皮管线为大工程）。
  - **输入卡顿修复（主进程同步 IO 阻塞）**：用户反馈"agent 文本框输入偶发卡顿"
    — 根因：场景渲染请求时主进程**同步 IO 阻塞事件循环**：
    - `extractSceneVideoFrames` 的 `readFileSync(srcPath)` 同步读整个 scene.pkg
      （实测最大 321MB → **85ms 完全阻塞**；Plana 29MB）+ 目录 readdirSync +
      视频纹理 `writeFileSync(tmpVideo)`（内嵌 MP4 几十 MB）
    - scene-anim 合成后 `writeFileSync(tmpApng)` / `readFileSync(tmpOut)` /
      `writeFileSync(cachePath)`（APNG/MP4 数十 MB）
    - 偶发性：仅渲染请求触发时卡；缓存命中/非场景不触发。输入恰好撞上渲染
      即卡顿。
    - **修复**：全部改异步 — `await readFile(srcPath)`（node:fs/promises 线程池）、
      `await writeFileP(tmpVideo/tmpApng/cachePath)`、`outBuf = await readFile(tmpOut)`、
      `await readdir` + `await readFile`（目录分支）。验证：异步 readFile 不阻塞
      （同步 85ms → 0ms tick 间隔）。14 壁纸回归无破坏。
  - 内置效果与第三方 GLSL 效果 GPU 优先（同一份 preprocess 结果，输出与 CPU
    一致）；失败/arm64 自动回退 CPU（功能不变）
  - 多 pass 链（bloom/godrays/shine/shimmer/vhs 等）float→int 方言 shim 已覆盖
    （sf41 系统性审计：官方 32/45 单 pass + 扩展 67/67 shader 文件编译通过，
    残余为 shaderfrog 嵌套 #if 的 CPU 同路径失败，回退可接受）
  - 实测：Plana 水层 4K 3526ms → 1194ms（3 倍）；全场景 640×360 6.3s → 3.9s
  - 测试开关 `DSH_WE_GPU_GL=1` 强制（跳过 gpuAccel 门控）/`=0` 强制 CPU；
    arm64 门控在 `gl-core.js`
  - **sf41 系列（worker 双模式 + 动画全分辨率 + 帧并行 + NVENC）**：
    - **fork 系统 Node**：DSH 宿主 Electron ABI 148 无 supreium prebuild
      （仅 Node ABI 93/108/115/127/137/147）→ GPU worker 由宿主 **fork 系统
      Node 子进程**（ABI 127）运行；env 净化（剔除 ELECTRON_RUN_AS_NODE /
      ELECTRON_NO_ASAR 等，防 node-gyp-build 误判 electron runtime）；无 GPU
      node 时回退 worker_threads（纯 Node 宿主）。
    - **大文件传输**：APNG/PNG 不走 fork IPC（大消息丢失 → exit 134/ok 不到）
      → worker 写临时文件 + 宿主异步读回 + ack 握手。
    - **PNG 帧序列管线（sf41h）**：scene-anim 视频输出不再打包 APNG — 每帧
      渲染为独立**无损 PNG 文件**（复用 encodePng，deflate 成本与 APNG 相同），
      宿主 ffmpeg image2 直读合成。1080p×240 帧 APNG 419MB 曾致合成慢/失败
      → 被迫降 720p；现恢复全分辨率，画质零损失，宿主零大文件读回。
    - **帧并行渲染（sf41i）**：times 切段 → 多 worker 并发（每 worker 独立
      GL 上下文，GPU 并行利用），并发数 `sceneGpuWorkers` 配置（1-8；auto：
      帧数 ≥120→4 / ≥60→2 / 其余 1；GPU 不可用不并行）；任一 worker 失败
      （如显存不足）自动回退单 worker 串行；帧目录合并（全局序号）→ ffmpeg
      合成。合成用 **NVENC 硬件编码**（`h264_nvenc -cq 19`，失败回退 x264
      crf 18；webm 保持 vp9 CPU）。实测 1080p 动画 8.7 分钟 → **3.2 分钟**
      （渲染 2.9 倍 + NVENC 合成秒级）；`-y` 防 spawnFfmpeg 双尝试残留冲突。
    - **启动延迟（sf41j）**：scene-anim 首次渲染延迟 ~60s（缓存命中立即），
      避开 DSH 启动初始化窗口（宿主首次 LLM/会话加载），降低"启动后第一次
      输入卡顿"的插件叠加贡献；客户端轮询超时 8→15 分钟（1080p 渲染 >8min
      曾致进度条卡 77% 后跳变）。

### 基础设施
- **scene.pkg（PKGV）**/TEX 容器（TEXB0001-4/LZ4/TEXS/FIF）/JPEG/TTF 解码。
- **NSL 脚本**：`lib/scene-scripts.js` vm 沙箱（编译缓存 + engine API 补全）。
- **worker 非阻塞渲染** + **静态帧/动画缓存**（`sf*` 键，管线变更后 bump）。
- **scene-anim 视频化**：静态帧立即显示 → 后台预渲染 MP4/WebM（**无损 PNG 帧
  序列** → ffmpeg image2 合成，ffmpeg 按需 lazy download，sha256 pin）→
  `<video>` 播放（播放/暂停/倍速/进度/循环）；帧并行 + NVENC 见上。
- **ffmpeg**：`DSH_WE_FFMPEG` env → 插件本地 → lazy 下载缓存 → PATH；资产表
  覆盖 win/linux/darwin × x64/arm64/ia32。

---

## 二、验证基线

本地与 workshop 场景全回归通过（14 壁纸批量，亮度/暗比/不透明逐项核对；
3470764447/3660962877 视频纹理抽帧为既有问题）。GPU 开启 vs CPU 基线一致。

---

## 三、TODO（未完成）

### 功能
- [ ] **视频纹理逐帧**（scene-anim 多帧中视频纹理逐帧播放；当前多帧用首帧）。
- [ ] **粒子 rope/trail/control points 类 emitter**（本地库 0 使用，未实现）。
- [ ] **小角度旋转精确化**：`blitRotated` 非 90° 旋转的符号/矩阵一致性需官方
      实机渲染核对（保持待确认）。
- [ ] **即时文本拆出单独实时渲染**（时钟秒级正确需渲染分离 + 合成 + 客户端
      轮询；当前策略 = 放弃渲染，最简）。

### 逆向待确认
- [ ] **0x384 矩阵B 用途**：image 路径 origin×0.5×矩阵B 的消费方式。
- [ ] **多相机对象选择/叠加语义**：scene 含多个 `camera:"default"` 时的选择规则
      （当前取 origin 动画值域跨度最大的相机对象，用户实测更接近官方）。

---

## 四、官方数学逆向要点（详见 `docs/WE-REVERSE.md`）

### 已确认
- **官方定位 = origin×0.5×M**（0.5 = 场景→画布固定缩放）。
- **视图平移**：前景 `(-eye.x×ps, 0)` — 仅 x 分量；背景（size 达场景尺寸）跳过。
- **puppet origin 参与骨骼矩阵链**；MDAT0001 锚点 = 骨骼最终世界位姿 + 锚点矩阵。
- **additive 动画层参考姿势 = 层动画帧0**；层名"动画 N"→ MDL 第 N 个动画。
- **MDLA 段布局**：骨骼 b 的 (tx,ty,rot) = 段 b 内 float 位置 (2b, 2b+1, 2b+2)
  （9 列循环跨帧；sf40g 修正 rot 为 2b+2，7 模型验证命中）。
- **蒙皮**：行向量 × 列主序矩阵约定与官方 shader 一致。

---

## 五、关键事实备忘（避免回归）

- **FOV 是垂直的**（50° 默认）；正交由 `projScale` 换算场景单位→像素。
- **MDL UV 在 stride-8**（stride 64 时 36）；模型双面渲染 + 背面法线翻转。
- **混合**：D3D additive = `dst += src·srcA`；translucent = alpha over；opaque 直写。
- **Bloom 参数可能是 `{script,value}` 对象** — 必须取 `.value` 否则 NaN→黑帧。
- **效果材质**：`effects/xxx/effect.json` 定义多 pass + fbo；scene.json 对象的
  `effects[].passes[].constantshadervalues` 覆盖各 pass 参数。
- **`{script, value}` uniform**：静态帧取 `.value` 回退（脚本运行时尚缺）。
- **passthrough 层**：`_rt_` 材质 = 读当前画布 → 效果链 → 全屏合成。
- **文件编码**：改 package.json 等 JSON 必须 UTF-8 **无 BOM**。
- **缓存键**：渲染管线变更后必须 bump `lib/index.js` 的 `sf*` 前缀 + 删旧缓存
  （否则旧帧命中导致"修复不生效"）。
- **部署**：host 端（lib/）改动须**重启 dsh web**；client 端改 `src/client.js`
  需 `npm run build` 生成 `lib/client.js` 再重启。
- **GPU 后端**：supreium-headless-gl 需 `{ isWebGL2: false }`（JS 模拟 WebGL2
  层有 bug）；官方 WE shader 是 GLSL ES 1.0 不受影响。
