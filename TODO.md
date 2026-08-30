# Wallpaper Engine 跨平台渲染引擎 — 现状与 TODO

> 目标：将 `lib/scene-renderer.js` 发展为与 Wallpaper Engine 原生渲染高度一致、
> 可在多平台（Windows/Linux/macOS 的 Node/浏览器）运行的 WE 场景**静态帧**渲染引擎。
> 以 wallpaper64.exe（官方引擎逆向）为**事实基准**逐组件复刻，辅以引擎 shader
> 源码、OBJ 源几何、场景数据与 preview 渲染验证。
> 渲染保持 worker 非阻塞 + 静态帧缓存。
>
> **方向决策（2026-08-30）**：放弃 scene-anim 自研动画方向（多帧渲染→视频）——
> 动画渲染不可靠（根因 A NSL 脚本时间轴等）且维护成本高。场景壁纸的动画来源只剩
> **内嵌视频纹理快路径（sceneVideo，硬件解码）**；其余场景展示静止态静态帧。
> 相关代码已删除（见 docs/RENDERER-FEASIBILITY.md §7 执行记录）；GPU 加速保留为**静态帧**加速。
> **完整决策背景、已删资产清单与未来实现路线：`docs/SCENE-ANIMATION-HANDOFF.md`（场景动画交接手记）。**
>
> **历史修复轮次（sf31-sf44）已压缩归档**：各修复已内联为代码注释（sf 标记：camera.js
> eye/zoom、puppet.js MDLA/additive、image.js viewShift、scene-scripts.js 快进等），
> 回归场景集见上文「二、验证基线」；原 docs/RENDER-ISSUES-ANALYSIS.md 等分析文档已于
> 2026-08-30 溶解（代码即真相）。本文件只保留当前状态、未完成项、关键防回归事实。

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
  静态帧取场景静止态时刻的骨骼姿态（`sceneStaticFrameTime`，有 single 入场动画
  的场景渲染到动画结束后的终态，见 lib/index.js）。
- **粒子**：emitter/initializer/operator 完整模拟（重力/阻力/颜色渐变/尺寸/
  旋转/轨道），mulberry32 种子 RNG 确定性。静态帧在选定时刻定格粒子场。
- **文本**：`lib/font-render.js` CFF 字体引擎；即时文本（时钟/日期/FPS）跳过
  渲染（静态帧缓存冲突，见 TODO）；作者水印（visible 用户属性）跳过。

### 效果链（CPU 复刻官方 shader；GPU 加速见下）
- 官方内置 30+ 效果全部实现（waterwaves/waterripple/shake/foliagesway/bloom/
  godrays/depthparallax/lightshafts/glitter/swing/shimmer/clouds 等），
  ApplyBlending 全 32 模式、mask UV 缩放、多 pass FBO 链。
- **第三方 workshop 效果**：运行时读 pkg 内 `shaders/workshop/<id>/*.frag`
  → GLSL 解释器（@shaderfrog/glsl-parser + 自写 AST→JS 转译器）通用执行；
  解析失败回退原图。
- **GPU 加速（静态帧，`sceneGpuAccel` 开关，默认关）**：
  - x64 + supreium-headless-gl（WebGL/ANGLE，prebuilds 直接打包，无 node-gyp）；
    DSH 宿主是 Electron（ABI 148 无 prebuild）→ GPU worker 由宿主 fork 系统
    Node 子进程（ABI 127）运行；无 GPU node 时回退 worker_threads（CPU）。
  - 静态帧单帧 4K 从 CPU 3-6s 提到 ~1s（实测 ~3 倍）；内置效果与第三方 GLSL
    效果 GPU 优先（同一份 preprocess 结果，输出与 CPU 一致）；失败/arm64 自动
    回退 CPU（功能不变）。
  - 纹理复用池 + FBO 复用池（sf42 显存泄漏修复）：多帧动画时期遗留的驱逐即
    泄漏问题已根治，40 帧零新建；`gpuObjectStats()` 诊断。
  - 多 pass 链（bloom/godrays/shine/shimmer/vhs 等）float→int 方言 shim 已覆盖
    （sf41 系统性审计：官方 32/45 单 pass + 扩展 67/67 shader 文件编译通过）。
  - 残余：非效果 CPU（蒙皮/粒子）无法 GPU 化（WebGL 蒙皮管线为大工程）。
  - 测试开关 `DSH_WE_GPU_GL=1` 强制（跳过 gpuAccel 门控）/`=0` 强制 CPU；
    arm64 门控在 `gl-core.js`。

### 基础设施
- **scene.pkg（PKGV）**/TEX 容器（TEXB0001-4/LZ4/TEXS/FIF）/JPEG/TTF 解码。
- **NSL 脚本**：`lib/scene-scripts.js` vm 沙箱（编译缓存 + engine API 补全）。
  静态帧只求值 init 态（脚本动画时间轴已随动画方向放弃，见 TODO）。
- **worker 非阻塞渲染** + **静态帧缓存**（`sf34_` 键：gpu 标志 + 路径 + 尺寸 +
  mtime，管线变更后 bump）。
- **静态帧回退链**：SceneRenderer 完整渲染 → 主纹理提取（`extractSceneMainImage`）
  → 工坊 preview 图（客户端兜底）。
- **sceneVideo 快路径**：场景含内嵌视频纹理时提取 MP4，浏览器硬件解码播放
  （poster=静态帧），无内嵌/解码失败自动回退静态帧。
- **ffmpeg**：`DSH_WE_FFMPEG` env → 插件本地 → lazy 下载缓存 → PATH；资产表
  覆盖 win/linux/darwin × x64/arm64/ia32（供视频壁纸抽帧转码用）。

---

## 二、验证基线

- `npm run verify`（verify-client + verify-transcode-state）全过；
  `node scripts/verify-scene.mjs` 13/13（scene-frame 路由 + 缓存断言，2026-08-30
  起全绿；此前 cache-on-disk 断言为测试键前缀过期问题，已修）。
- 本地与 workshop 场景静态帧批量回归（亮度/暗比/不透明逐项核对；
  3470764447/3660962877 视频纹理抽帧为既有问题）。GPU 开启 vs CPU 基线一致。
- 回归场景集（历史 15 场景，覆盖各类根因）：脚本场景 3486806915 / 3629379075 /
  3660962877；zoom 场景 3554161528 / 3641860575；eye≠0 场景 3486806915 /
  3669681034 / 3690417937；粒子场景 13/15；内嵌 MP4 场景 3470764447 / 3660962877。
- ~~官方 preview.gif 像素 A/B 回归~~：**已放弃（2026-08-30）**——workshop 的
  preview.gif 是作者自行上传的素材，不保证等于真实引擎渲染输出，不能作为
  正确性基准；`scripts/regression/` 已删除。回归改以真实壁纸人工对照为准。

---

## 三、TODO（未完成）

### 功能
- [x] **sceneVideo 健壮性修复（已恢复 2026-08-30）**：幽灵 error 守卫
      （`curLayer.contains(media)`）、瞬时错误重试（ABORTED/NETWORK/DECODE 重试 2 次、
      SRC_NOT_SUPPORTED 立即降级）、`preload="auto"`、播放看门狗（1s 强制 play）、
      首次手势兜底 —— 原只热补丁在 lib/client.js（构建产物）导致 `npm run build` 后丢失，
      已从重构前备份（`D:\dsh-wallpaper-engine_20260830`）按原文移植回 `src/client.js`
      并加注释（buildMedia 场景分支 + apply 效果初始化区）。
      排障备忘：sceneVideo "停住显示静态帧" 先查 **pauseOnBattery**（电池供电 +
      「使用电池时暂停」= 预期行为，非 bug；曾误判为播放失败）；3582367840 是
      真实格式错误（error 4: Format error，另一类问题）。
- [x] **静态帧脚本 init 态补全（核验完成 2026-08-30，sf42 已实现）**：`scene-scripts.js`
      `runScriptValueCached` 的 catch 已走 `onError` → `renderer._scriptErrors` → gpuDiag
      （不再静默吞错）；`animationlayers`/`getAnimationLayer`/`getParent`/`getAnimation`/
      `getTextureAnimation`（真实 spritesheet 帧控制）/`isRunningInEditor`/`registerAudioBuffers`/
      `engine.setTimeout`（异步防递归卡死）/`input`（画布中心静态鼠标）等 NSL API no-op/代理
      已全部在位。核验方式：直接读 `scene-scripts.js` 沙箱构造（makeSceneRef/makeOwnerRef/engine）。
- [x] **小角度旋转精确化（静态核验 2026-08-30）**：① **实测确认 scene.json angles 单位 =
      弧度**（3554161528: 0.14317≈8.2° / 0.51322≈29.4°，小数值只可能是弧度）——transform.js
      的 `Math.cos(ang[2])` 与 image.js `blitRotated` 直接收弧度**正确，无需换算**；
      ② 方向约定：官方 `common.h rotateVec2`（标准逆时针 `[[cos,-sin],[sin,cos]]`）、
      lwe 参考（R(-angle) 补偿 Y-flip）、本插件（canvas y-down +angle=顺时针）三者一致。
      官方 2D 图像矩阵确切符号未能从反编译片段完全闭合（无实机验证能力），以 lwe 为准，
      已内联注释至 scene/transform.js `resolveTransform`。
- [x] **静止态时间策略完善（2026-08-30）**：`sceneStaticFrameTime` 现纳入**相机路径
      总时长**（motion-path 相机播完后的稳定位姿；否则 t=2.5 可能命中运镜中段）。
      脚本驱动场景维持 2.5 默认（脚本在选定 t 求值一次 + 快进）。
- [x] **即时文本（核验 2026-08-30）**：维持"放弃渲染、识别即跳过"策略——时钟/日期/
      FPS 文本会与静态帧缓存冲突（冻结在渲染时刻）；单独实时渲染需渲染分离+合成+
      客户端轮询，静态帧方向下优先级低，暂不投入。
- [x] **puppet 按对象 size 四边裁切（2026-08-30）**：官方以对象声明 size 为 quad，
      网格超出部分裁掉。已实现：`canvas.blitScaled` 增加可选 `srcRect` 源子矩形参数；
      `renderPuppet` 在 size 显式存在时按 quad 求交裁剪（缺失/autosize 时无裁切，
      行为不变）。3554161528 冒烟渲染验证通过。
- [x] **剩余边缘脚本/效果（核验 2026-08-30，均优雅处理）**：
      - weizhi 未定义（3629379075 / 3660962877）：当前渲染 **0 脚本错误**——sf42 的
        NSL API 补全已让脚本不再抛错；残余 "Event ID does not exist" 是 NSL 框架
        对作者脚本引用未注册事件的自有日志，优雅降级。**已解决**。
      - DAY DATE TIME 对 boolean 写 `.x`（3641860575）：壁纸自身缺陷，实测捕获 1 条
        `Cannot create property 'x' on boolean 'false'`，脚本保持原值、场景正常渲染。
        **已优雅处理**。
      - puppet cat11 / RW0 MDL 解析失败（3641860575）：非标准 MDL 布局，渲染器
        跳过该 puppet 并记日志，其余组件正常。**已优雅处理**。

### 已放弃（2026-08-30 方向决策，勿再投入）
> 完整背景、技术要点、已删资产清单与三条未来实现路线见
> **`docs/SCENE-ANIMATION-HANDOFF.md`（场景动画交接手记）**——留给未来有能力实现者。
- ~~NSL 脚本动画时间轴（根因 A）~~：NSL 框架动画调度器用真实时钟/事件驱动，
  与场景时间 t 无关；完整复刻 = 在沙箱里再实现一个事件循环（"再写半个引擎"）。
  静态帧接受 init/静止态。
- ~~scene-anim 多帧→视频管线~~：路由/缓存/进度/帧并行/NVENC 合成已全部删除。
- ~~视频纹理逐帧播放~~、~~rope/trail 粒子 emitter~~、~~多相机动画选择~~（静态帧
  只取单一时刻，动画专属语义不再需要）。

### 逆向待确认（仍影响静态帧正确性）
- [ ] **0x384 矩阵B 用途**：image 路径 origin×0.5×矩阵B 的消费方式。
- [ ] **多相机对象选择/叠加语义**：scene 含多个 `camera:"default"` 时的选择规则
      （当前取 origin 动画值域跨度最大的相机对象，用户实测更接近官方）。

---

## 四、官方数学逆向要点（已内联为代码注释）

> 详细推导原存 docs/WE-REVERSE.md 与 WE-REVERSE-CAMERA-MATH.md，2026-08-30 已溶解
> （代码即真相）——以下事实落在对应实现处注释：camera.js `_viewShift`/`_setupCamera`
> （eye 语义 sf42/43/44、正交 zoom、worldToScreen）、puppet.js（MDLA 段布局、additive
> 层、蒙皮行向量）、image.js（origin×0.5×M 定位、viewShift）、scene/transform.js
> （MDAT 锚点）、scene/animation.js（relative 动画）。核心结论速览：

### 已确认
- **官方定位 = origin×0.5×M**（0.5 = 场景→画布固定缩放）。
- **视图平移**：前景 `(-eye.x×ps, +eye.y×ps)` — 两轴都参与（sf42 定论，
  官方 0x1401ED0D0 对 eye x(0x178)/y(0x17c) 均 subss）；背景（size 达场景尺寸）跳过。
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
  （否则旧帧命中导致"修复不生效"）；`scripts/verify-scene.mjs` 的断言前缀
  必须同步（当前 `sf34_`）。
- **部署**：host 端（lib/）改动须**重启 dsh web**；client 端改 `src/client.js`
  需 `npm run build` 生成 `lib/client.js` 再重启。
- **GPU 后端**：supreium-headless-gl 需 `{ isWebGL2: false }`（JS 模拟 WebGL2
  层有 bug）；官方 WE shader 是 GLSL ES 1.0 不受影响。
- **.git 已损坏**（无 HEAD/index/config）：删除代码前必须整目录备份（本次重构
  前已备份；今后大改动照此执行）。
