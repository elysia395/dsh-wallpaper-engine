# Wallpaper Engine 跨平台渲染引擎 — 现状与 TODO

> 目标：将 `lib/scene-renderer.js` 发展为与 Wallpaper Engine 原生渲染高度一致、
> 可在多平台（Windows/Linux/macOS 的 Node/浏览器）运行的 WE 场景渲染引擎。
> 以 wallpaper64.exe（官方引擎逆向）为**事实基准**逐组件复刻，辅以引擎 shader
> 源码、OBJ 源几何、场景数据与 preview 渲染验证。
> 渲染保持 worker 非阻塞 + 静态帧缓存。

---

## 一、已实现组件（验证依据：引擎源码 / 数值对比 / preview 像素统计）

### 1. 核心渲染管线
- **Canvas**：RGBA + z-buffer，`blit`/`blitScaled`（双线性）。
- **相机**：`_setupCamera` — lookAt + Perspective/Ortho，垂直 FOV（50° 默认），
  `camera.projection`/`general.orthogonalprojection` 驱动；`fovOverride` 可调。
- **光照**：`ComputeLightSpecular` 复刻 — 4 灯衰减 `saturate(1-d/radius)`、
  Blinn spec、ambient/skylight 按法线·up 混合。
- **MDL 静态网格** `_parseMdlStatic`：stride 候选 [64,48,32,40,44,56] → 回退
  [20,16,...]，UV=stride-8；无法线时重算平滑法线。
- **光栅化** `_rasterizeMesh3D`：透视校正 1/w、双面渲染（背面法线翻转）、
  opaque/additive/translucent 混合、`depthwrite: disabled` 不写 z。
- **Bloom** `_applyBloom`：亮部提取 → 1/4 降采样 + 盒式模糊 → 按 strength 叠加；
  参数兼容 `{script,value}` 对象（NaN 防护）。

### 2. 场景对象
- **Image**：`renderImage` — 正交 projScale、尺寸/alpha/brightness、
  效果链 `applyEffects`、passthrough 后处理层（`_rt_` framebuffer 材质）。
- **Model / Puppet**：MDL 网格 → 蒙皮（绑定姿态 + 动画层合成）→ 光栅化。
- **Particle**：`_buildParticleSystem` 完整模拟 — emitter/initializer/operator
  （重力/阻力/力/颜色渐变/alpha 淡入淡出/尺寸/旋转/轨道）、additive 混合、
  R 通道 smoothstep 软边、`mix(color1,color2,v_Color.r)`、projScale。

### 3. 效果链（CPU 复刻引擎 shader）
| Effect | 源码依据 | 状态 |
|---|---|---|
| `scroll` | `effects/scroll`（`v_Scroll=sign(s)·s²·t`，`frac((uv+v_Scroll)·g_Scale)`） | ✅ 已验证 |
| `tint` | `effects/tint`（ApplyBlending，默认 multiply） | ✅ 已验证 |
| `pulse` | `effects/pulse`（mask.a·Multiply） | ✅ 已实现 |
| `filmgrain` | `effects/filmgrain`（双噪声卷动 + GREYSCALE + softlight） | ✅ 已验证 |
| `godrays` | `effects/godrays` 5-pass 链（downsample2→cast→gauss_x→gauss_y→combine） | ✅ 已验证 |
| `waterwaves` / `waterripple` / `shake` | 引擎 effect | ✅ 已有（简化） |
| `foliagesway` | `effects/foliagesway`（noise.g 相位 + 4 频 sin 位移，UV 模式） | ✅ 已实现 |
| `opacity` | `effects/opacity`（albedo.a ×= mask.r） | ✅ 已实现 |
| `waterflow` | `effects/waterflow`（flow map 位移 + 双周期循环混合） | ✅ 已实现 |
| `skew` | `effects/skew`（UV 按象限偏移 top/bottom/left/right） | ✅ 已实现 |
| `iris` | `effects/iris`（虹膜 motion 位移 + mask/BACKGROUND） | ✅ 已实现 |
| `lightshafts` | `effects/lightshafts`（squareToQuad 透视光柱, RAYMODE=0 线性） | ✅ 已实现 |
| `cloudmotion` | `effects/cloudmotion`（perlin 噪声云层 UV 位移 + MASK） | ✅ 已实现 |
| `shimmer` | `effects/shimmer`（旋转 UV 扫光渐变, MODE 线性/镜像, mix 逐通道） | ✅ 已实现 |
| `blurradial` | `effects/blur_radial_gaussian`（径向旋转高斯, KERNEL 3/7/13 采样核） | ✅ 已实现 |
| `glitter` | `effects/glitter`（双 pass: 256² 闪光图案 → ApplyBlending 混合） | ✅ 已实现 |
| `clouds` | `effects/clouds`（双云纹理采样 + 阈值混合 + SHADING） | ✅ 已实现 |
| `swing` | `effects/swing`（p0-p1 轴翻页旋转 + UV 扭曲 + DOUBLESIDED/MASK/NOISE） | ✅ 已实现 |
| `depthparallax` | `effects/depthparallax`（QUALITY 0 线性 / 1/2 层 ray march 24/64 层） | ✅ 已实现（sf39l；指针默认屏幕中心，静态帧仍有透视位移） |
| `blur` | `effects/blur` 4-pass（downsample4→gauss_x→gauss_y→combine，13/7/3-tap 核） | ✅ 已实现（sf39l；blurprecise 仍跳过） |
| `watercaustics` | `effects/caustics`（perlin/uniform/voronoi 4 噪声 + 色差 + MODE 0/1） | ✅ 已实现（sf39l） |
| `blend` | `effects/blend`（PerformBlend WRITEALPHA / BLENDMODE + GetUVBlend） | ✅ 已实现（sf39l；NUMBLENDTEXTURES=1 主路径） |
| **第三方 workshop 效果**（34 种，300 次使用；`custom_user_texture` 家族 144 次含 Mutsumi/Elaina） | 壁纸 pkg 内 `shaders/workshop/<id>/effects/*.frag` → **GLSL 解释器**（sf40） | ✅ 通用执行（fade/shadow/custom_user_texture 验证 PASS；复杂 shader 解析失败回退原图） |

### 4. 基础设施
- **ApplyBlending 全 32 模式** CPU 复刻（`common_blending.h` 逐宏翻译，含 HSL 系列）。
- **全局 assets 回退**：`loadTexture`/`readJsonAny`/`readAny` 支持 WE 全局
  `assets/`，worker 经 `locateWallpaperEngineP()` 探测安装目录。
- **效果多 pass 链**：`applyEffects` 传入完整 `passes`，godrays 走 5-pass + 半分辨率 fbo。
- **worker 非阻塞渲染**：`scene-render-worker.mjs`（600s 超时、空帧门禁、
  ArrayBuffer 零拷贝回传）。
- **静态帧缓存**：cache key `sf*`（渲染管线变更后 bump）。
- **camera paths**：`_resolveCameraPose` 多 path 顺序循环（总时长 = duration 和），
  path 内关键帧线性插值 eye/center/up/zoom。
- **粒子确定性**：mulberry32 种子 RNG（场景路径+对象 id hash），同 time 帧可复现。
- **模型欧拉角**：`mat4FromTRS` 按引擎约定 Rz(-z)·Ry(y)·Rx(-x)，X/Z 取负；
  `resolveTransform` 保留完整 XYZ angles。
- **generic LIGHTMAP**：第 2 UV 通道（stride 56: uv2@stride-16），透视校正插值，
  combo 大小写兼容，lightmap 乘 light/spec。
- **skylight 环境光**：`_shadeGeneric` ambient = skylight·(n·up) mix。
- **scene scripts**：`lib/scene-scripts.js` vm 沙箱执行 {script,value}。
- **JPEG 纹理解码**：`lib/we-renderer/jpeg.js` baseline SOF0/SOF1（Huffman +
  反量化 + 浮点 IDCT + YCbCr）；无效 JPEG（高度周期熵流）检测 → fallback 纯黑。
- **TTF 字体**：`parseCffFont` 扩展 glyf 表路径（cmap/glyf/loca/hmtx）。
- **sound 对象**：正确归类，渲染时静默跳过（无渲染）。

---

## 二、当前验证基线（本地 defaultprojects 全回归通过）

本地与 workshop 场景均通过全回归验证：相机 paths 多镜头动画、欧拉角修复、
flowimage 流光、scroll×5 + godrays 后处理、lightmap 第 2 UV + skylight、
粒子确定性渲染（同 time 帧可复现）、纯色层/文本/背景等组件均与官方一致。

workshop 场景：scene.pkg 解析 + 渲染全通过（含 puppet/文本/纯色/粒子）；
视频纹理（MP4 主纹理）：静态帧已支持 — 主线程 ffmpeg 抽帧（TEX 内嵌 MP4
+ 独立媒体文件两种形式），`loadTexture` 遇视频引用读 PNG 替代；
多帧（scene-anim APNG）模式：视频纹理暂用首帧（times[0]）的静态帧 —
逐帧抽帧成本高且 SceneRenderer 复用单实例时 videoFrames 静态，
逐帧播放留待后续。

---

## 三、TODO（按优先级）

### 短期（引擎一致性优先）
- [x] **背景中区错位**：已定位为 preview 编辑器相机差异，非渲染 bug。
- [x] **generic LIGHTMAP 第 2 UV 通道**：stride 56 uv2@stride-16 + 透视校正 +
  combo 兼容 + skylight。
- [x] **多帧/视频动画**：`/scene-anim` 路由 + worker times 数组 + APNG 编码。
- [x] **text 对象**：`lib/font-render.js` CFF 字体引擎 + `renderTextObject` 集成。

### 场景壁纸动画化（静态帧 → 动画，前期准备已就绪）
- [x] **scene-anim 缓存**：APNG/视频按 场景mtime+参数+格式+管线版本 落盘
      （`san_sf32_<hash>_<params>.<ext>`）+ 并发去重（Map<key,Promise>）。
- [x] **客户端集成 + 视频化**：scene 壁纸 `selection.url` → 静态帧（立即）；
      后台预渲染 **MP4/WebM 动画视频**（scene-anim `?fmt=mp4`，宿主 ffmpeg
      合成 x264/VP9，缓存复用）→ `<video>` 播放 —— **与视频壁纸同款控制**：
      播放/暂停（遮挡暂停同生效）、倍速（0.5-2x playbackRate）、进度、循环。
- [x] **渐进加载**：`queueSceneAnimUpgrade` — 隐藏 `<video>` 预加载
      `/scene-anim/<token>?fps=..&fmt=mp4`（触发宿主渲染+缓存），完成后校验
      当前 URL 仍为该静态帧才切换（防轮播误升级）；失败保持静态帧。
- [x] **倍速 / 帧率限制**：UI 对 scene 动画放开（同 video）；`fpsCap` 变更 →
      以新帧率重渲染动画视频（scene-anim `?fps=`，与视频抽帧同语义）。
- [x] **渲染进度条**：worker 逐帧上报 → 宿主写 `.prog` 进度文件 →
      `/scene-anim-progress/<token>?fps&fmt` 端点 → 客户端轮询 + UI 进度条
      （"场景动画渲染中 X%"）。
- [x] **音频策略**（决策）：保持无音频 — 预渲染频谱是快照，scene 动画的
      实时音频响应是固有限制（video 壁纸才有）。
- [ ] **视频纹理逐帧**（可选）：多帧动画中视频纹理逐帧播放（SceneRenderer
      复用单实例时 videoFrames 静态，需按 time 重取）——当前多帧用首帧。

### 中期
- [x] **属性动画 {animation}**：WE 属性动画按 t 线性插值烘焙
  （alpha/scale/origin/angles/visible/color/size 等）。
- [x] **动画 relative 语义**：`{animation, relative: true}` = 基准 + 偏移（逐分量）。
- [x] **单通道动画误判 vec3**：仅当存在 c1/c2 或 c0 值为向量时才走多通道。
- [x] **依赖循环防护**：`_resolveObjects` visiting 集合防 A↔B 循环。
- [x] **MDL 段逆向**：MDLV0023 + MDLS0004 + MDAT0001（骨骼锚点）+ MDMP0001
  （blend shapes）+ MDLE0002（骨骼扩展矩阵）+ MDLA0006（动画）。
- [x] **camera paths**：多 path 顺序循环 + 关键帧插值。
- [x] **generic REFLECTION combo**：`_rt_` 渲染目标（画布快照）采样。
- [ ] **粒子完整 renderer 扩展**：rope/trail/control points 类 emitter。
- [x] **HDR/bloom 完整链**：downsample_quarter_bloom + saturate + lin gamma 合成。
- [x] **音频响应**：g_AudioSpectrum 驱动 pulse。
- [x] **视差（parallax）**：camera.parallax + mouse 驱动位移。
- [x] **genericimage2 spritesheet**：TEXS 帧元数据 → 时间驱动精灵帧动画。
- [x] **puppet 骨骼动画**：MDLV 顶点 + MDLS 骨骼 + MDLA 动画 + `_skinPuppet` 蒙皮；
      **动画层合成**：全部 visible animationlayers 参与（普通层 mix + additive 层
      世界空间 delta 叠加 + rate）。
- [x] **audio bar 效果对象**：未实现时跳过，避免白色占位覆盖画面。
- [x] **粒子 emitter（本地库实测）**：sphererandom(66) + boxrandom(17) 已支持
      （boxrandom 每轴 distancemin/max 随机距离 + 随机符号；speedmin/max 初速
      与 sign 语义未从官方确认 → 暂不实现）。rope/trail 本地 0 使用。
- [ ] **小角度旋转精确化**：`blitRotated` 逆映射双线性数学正确（绕中心，
      90° 已验证）；非 90° 旋转的**符号/矩阵一致性**需官方实机渲染核对
      （lwe 非事实源）→ 保持待确认。
- [x] **GLSL 效果解释器（sf40，通用第三方效果覆盖）**：运行时读取壁纸 pkg 内
      `shaders/workshop/<id>/effects/*.frag/.vert` 直接执行，覆盖任意第三方
      效果。技术栈：**@shaderfrog/glsl-parser 7.x**（PEG 解析 + 自带预处理器，
      #if/#ifdef/#define + combo 宏注入）+ **自写 AST→JS 转译器**（glsl-transpiler
      老库 swizzle 左值等语法不兼容，弃用）+ 宿主运行时（texSample2D/mul/CAST/
      saturate/M_PI + 30+ 内置函数 + vert 4 角 varying 双线性插值 + 逐像素 main）。
      详见下方 sf40 记录。

### 工程
- [x] **模块拆分（we-renderer 子目录）**：`core.js` 骨架 + 方法 mixin 模块
  （puppet/model/effects/particles/image/text；bloom/camera 追加既有函数文件）。
- [x] **缓存键管理**：渲染管线变更后 bump `lib/index.js` 的 `sf*` 前缀。
- [x] **scene.pkg 容器（PKGV）**：双头部支持 + 条目布局（sized-string 头部 +
  u32 count + 条目），多版本验证通过。
- [x] **TEX 容器变体**：TEXB0001-4（含 V4 JSON 头 + param 校验）、LZ4 压缩、
  TEXS0001-3 帧表、FIF 格式枚举。
- [x] **solidlayer 纯色层**：对象 color 填充矩形（flat shader）。
- [x] **相机对象运镜（sf31）**：`camera:"default"` 对象 origin/zoom 动画接入相机；
  scene.camera.eye 为默认时用其 origin 作 eye；zoom 接入正交 camProj。
- [x] **关键帧贝塞尔插值（sf34）**：`{animation}` 关键帧带 `back/front` 切线
  （相对关键帧的控制点，x=帧、y=值偏移）→ 三次贝塞尔求值（u 由 frame 线性
  定位，控制点 y = 值+front.y/back.y）。实证：Mutsumi origin c1 @t=1s =
  119（贝塞尔缓入）vs 线性 124.9；官方 preview 帧增量递减 = ease-out。
- [x] **多相机对象选择（sf33→sf34）**：取 origin 动画"值域跨度"最大的相机
  对象（Mutsumi：id 216 摆动 400 vs id 1297271"入场镜头" 2313 → 选后者）。
  旧实现取第一个 → 前景组件集体做 216 的 y 0→400→0 摆动（用户反馈"组件的
  运动方式像另一个组件"）。跨度评估按 id 回查 `scene.objects` 原始动画
  （烘焙后 `.animation` 已不在对象上）。
- [x] **scene-anim 渲染取消（sf34）**：切换壁纸时旧渲染（worker + ffmpeg 合成）
  不取消 → ffmpeg 占满 CPU + 进度条跳变。服务端 `res close` + 等待者计数 →
  AbortController 杀 worker/ffmpeg/删 .prog；进度文件按格式隔离
  （`.apng.prog`/`.vid.prog`，同参数 apng/mp4 不再互相覆盖）；客户端
  `queueSceneAnimUpgrade` 可取消（清轮询 timer + 销毁 probe 触发 abort）。
- [x] **NSL 脚本运行时（sf35，运动方式根本修复）**：WE 场景大量用 {script,value}
  的 NSL 脚本驱动动画（Mutsumi Dock：788 库 48KB 定义 shared.offsetedStartAni/
  aniScheduler，715 Dock 逻辑，726 Launcher 缩放，413/756 骨骼动画层）。
  旧实现**每帧重编译所有脚本**（状态丢失 + init 每帧重复 + CPU 爆）且
  engine API 缺失（isRunningInEditor）→ NSL 库中途抛错 → shared 全空 →
  组件运动全错。修复：
  - 脚本缓存（每实例一个）：编译一次、init 一次、applyUserProperties 首次、
    每帧只调 update；跨帧状态保留（scene-anim 多帧复用实例）
  - engine API 补全：isRunningInEditor/input.cursorWorldPosition/WEMath
    （mix/clamp/smoothStep）；setTimeout 改真实异步（旧同步 shim 无限递归卡死）
  - 模块转译修复：`import * as WEMath from 'WEMath'` 原被映射到 __WEColor →
    WEMath 函数全丢（726 报 smoothStep is not a function）
  - thisObject/thisLayer 通过 ownerRef 代理绑定真实场景对象（读写
    origin/scale/visible/alpha），缓存共享条目对象不串
  - userProps 从外部 project.json 读（pkg 内无该条目 → 旧实现为空 →
    脚本属性默认值丢失）；_setupCamera 不再每帧重置
  - 验证：Mutsumi shared 建立（offsetedStartAni/minScale/radius/
    appDockWidth）、Launcher 布局（垂直排列间距 147.2）、若叶睦定位
    (1920,1080)、缓存命中毫秒级
- [x] **text 渲染缓存（sf35）**：69 个 text 对象每帧重 parseCffFont + renderText
  （30s+）→ 字体/位图缓存（FIFO 256）→ 首次 3.1s、缓存后 3ms。
- [x] **正弦波浪运动修复（sf36）**：用户反馈"部分组件诡异正弦波浪"。
  定位为效果链实现与官方 shader 的数学偏差（Mutsumi：26 组件 waterwaves +
  5 foliagesway + 2 shake）：
  - **waterwaves 方向**：官方 `v_Direction = rotateVec2((0,1), θ) = (-sinθ, cosθ)`
    （common.h），本地用 `(sinθ, cosθ)` → x 分量反号 → 波浪沿镜像方向传播。
  - **foliagesway aspect**：官方 vert `aspect = texW/texH × ratio`，本地 `H/W` →
    摆动轴互换（方向错 90°）。
  - **shake 官方数学**：本地是"简化正弦"（sin(t·speed·2.3)×s×30），官方是
    锯齿 + 摩擦曲线（frac(time/π2) sin + friction mix + bounds 映射）×
    strength² × flowMask（方向图 rg−0.498）。眼睛等组件抖动方式完全重写。
- [x] **waterripple/pulse 官方数学（sf36b）**：waterripple 本地是"简化圆形波纹"
  （sin(r)×strength×3 径向），官方是法线贴图（waterripplenormal）双采样位移
  （rippleCoords = uv±time×animSpeed² + scroll；normal 归一化×strength²）。
  pulse 本地缺时间正弦脉冲（非音频分支 pulse=1），补官方
  smoothstep(bounds, sin(time×speed+(phase−0.25)×2π)×0.5+0.5)×amount + noise +
  pow + PULSECOLOR/PULSEALPHA/MASK。
- [x] **效果核对（sf36c）**：swing/waterflow/cloudmotion/scroll/shimmer 本地
  已按官方数学实现（无偏差）；lightshafts 完整移植（squareToQuad+inverse3）。
- [x] **NSL API/NaN 修复（sf36d）**：`WEMath.rad2deg/deg2rad` 缺失 → 733 Lens
  Flare angles NaN；`new Vec3(otherVec3)` 构造把 Vec3 实例存进 this.x → 级联
  NaN（733 origin）。修复后全场景 NaN 归零（906 Launcher 24 的 origin NaN 经
  确认是直接 applySceneScripts 的测试伪影——SceneRenderer 渲染路径
  renderObjects 下 906 正常且默认 visible=false 跳过渲染）。
- [x] **scene-anim 采样修复（sf37，普遍快放根因）**：旧实现 frameCount 按 sec
  （默认 2s）算但采样时间覆盖 loop（动画周期）——**动画周期 > sec 时视频内
  快放**（Mutsumi 动画 5s+粒子 starttime 10s → 2s 视频播 10s = **5 倍速**，
  "几乎全部动画壁纸运动方式/速度错"的引擎级根因）。修复：
  - frameCount = fps × max(sec, loop)——视频时长覆盖完整动画周期（1:1）
  - t0 = 0——动画从场景开始播放（旧 t0=粒子 starttime 跳过动画开头段）
  - loop = max(period, animDuration, starttime, 2)——覆盖相机/动画/粒子
  验证：Mutsumi 12 帧采样 0-5s 运镜序列平滑（先上移 -229→472 再回落 + 拉近）。
- [x] **渲染性能优化（sf38，逆向 lwe 官方）**：profile 定位瓶颈 = applyEffects
  （效果链在 4K 原始纹理上 CPU 逐像素，占渲染 76%，2695ms/帧）。逆向
  linux-wallpaperengine 源码：官方效果是 fragment shader **GPU 数千线程并行**
  处理全分辨率 + FBO 乒乓 + 纹理/VBO/shader 缓存。CPU 实现无法用 GPU，采用
  **降采样近似**：效果前等比降采样到显示尺寸（blit 目标 dw/dh，box 滤波），
  效果是低频扰动/波浪损失极小。效果：applyEffects 2695ms→67ms（40 倍）、
  1920x1080 渲染 50-90s→**1.6s/帧**（30-50 倍）、scene-anim 120 帧 2.3 小时
  →**3 分钟**；视觉差异实测 1.3%。
- [x] **文本系统修复（sf38b，逆向 lwe CText）**：WE 文本 scale 常 ~0.09，
  旧实现 `px = pointsize × ps × scale` 栅格化到 ~2-4px **不可见**（所有场景
  壁纸文本不合理的根因）。官方（lwe CText.cpp:204-213）语义：
  - **栅格化高分辨率补偿**：px = pointsize × compensate（compensate =
    min(1/avgScale, 32) 当 scale<1）
  - **显示时 model scale 应用**：dw = img × scale × ps（quad×model scale）
  - **对齐默认 center**（官方 quad 中心=origin；horizontalalign left/right
    锚点修正：left=ox, center=ox-dw/2, right=ox-dw）
  验证：Mutsumi Clock（pointsize 202, scale 0.28）px 4→721、显示 100px+
  合理；渲染帧1 265ms 性能不降（文本位图缓存生效）。
- [x] **scene-anim 黑屏修复（sf38c）**：切换动画后黑屏。诊断链路：渲染帧
  正常（100% 不透明、无暗像素）→ APNG→MP4 内容正常（用户 MP4 提取帧亮度
  118-159）→ **根因在服务端响应**：scene-anim 缓存命中用 `trackStream`（完整
  200 无 Accept-Ranges），video 播放 MP4 必须 Range seek → 黑屏。改用
  `serveFile`（Accept-Ranges/206/Content-Range，media 路由已验证）。另补
  mimeFor 的 .apng（image/apng）。
- [x] **黑屏/静态帧破坏修复（sf38d，视频纹理抽帧）**：诊断批量回归发现
  3470764447/3660962877 静态帧全黑（99.8%）——根因：视频纹理（.tex 内嵌
  MP4，伊蕾娜系列 29-116MB）抽帧失败——`-f image2` 写单帧缺 `-update 1`
  时 ffmpeg 警告"no image sequence pattern"且不写文件 → videoFrames 缺 →
  视频纹理组件黑（scene-frame 与 scene-anim 共用抽帧，黑屏同根因）。
  修复：抽帧加 `-update 1`。验证：3470 静态帧 99.8% 黑 → 亮度 131（主要
  组件显示）。残余：白天/黄昏/夜晚（48.6MB 同尺寸）抽帧仍 status=1 待查。
- [x] **亚托莉黑斑/黑线修复（sf38e，lightshafts NaN）**：用户反馈亚托莉
  (3669681034) 静态帧黑线/黑斑，且"上次提交不存在"。git 对比定位：lightshafts
  是当前版**新增实现**（HEAD 无此效果→跳过→无黑斑）。黑斑根因：lightshafts
  透视逆变换（squareToQuad/inv3）在亚托莉的透视点（含负 y）下 fx/fy 溢出
  （巨大/NaN）→ 噪声采样 `_texSample` 的 NaN 输入 → rgba[NaN]=undefined →
  `NaN×mask=NaN` → applyBlending(NaN) → 输出黑斑（实测 fxv=NaN、col 负色）。
  修复（三处）：
  - `_texSample`（model.js）：非有限坐标返回 [0,0,0,0]（通用防护）
  - `effectLightshafts`：fxv isFinite 归零 + fc 颜色 clamp [0,1]（负色防护）
  验证：亚托莉黑斑 11→0、3840 孤立线 0、其他壁纸批量无回归。
- [x] **亚托莉残留蓝黑色斑（sf38f，applyBlending 溢出回绕）**：sf38e 后用户
  反馈"黑线消失、黑斑减少，剩余黑斑蓝黑色"。逐像素诊断：画布出现源图不存
  在的纯红 (255,1,1)/纯蓝 (25,14,249)/蓝黑 (1,2,55) 像素，且效果隔离测试
  一度误判"与效果无关"（`_resolveObjects` 浅拷贝 `{…o}` 共享 effects 数组
  引用，改 `scene.objects[i].effects` 不生效，必须改 `renderer.objects`）。
  正确隔离后定位 **lightshafts 唯一元凶**（单独渲染 46 个孤立蓝黑块，
  shake/foliagesway 干净）。根因：官方 shader `mask *= grad`
  （grad = 1−fxCoord.y）在透视逆变换溢出（亚托莉 point0/1 y 为负 →
  大片区域 fy>1）时 mask **变负** → fx 负 → 官方 GPU 写 framebuffer 自动
  clamp [0,1]（仅变暗），而 CPU `applyBlending(31) = A + B×opacity`
  **无 clamp** → 负值 Math.round(−0.91×255)=−233 写入 Uint8Array
  **模 256 回绕**成 23 → 蓝黑色 (1,2,55)、(23,21,124)。
  修复：`applyBlending`（math.js）所有分支输出统一 clamp [0,1]（与官方
  framebuffer 写回语义一致，全局修复所有效果的溢出回绕）。
  验证：亚托莉 1920/3840 蓝黑块 41→0、bluish 142→0；批量回归 14 个壁纸
  ——3582367840/3554161528/3461168300 的"蓝黑块"经源图对比为贴图本身
  暗色（srcPixel 与渲染一致）系误报；4 个壁纸渲染失败（NSL "Event ID
  does not exist" 既有问题，3660962877 同类，未修）。
- [x] **beta场景动画开关（sf38g）**：用户反馈"动态效果不可靠"（scene-anim
  CPU 渲染试验性，部分壁纸组件错误），要求默认只渲染静态帧、动画化改为
  显式开启。实现：
  - `selection.betaSceneAnim`（默认 false）+ sanitizeSettings 客户端/服务端
    双镜像（src/client.js + lib/index.js，保持同步）
  - `queueSceneAnimUpgrade` 开头 gate：`betaSceneAnim !== true` 时直接
    return（cancel 旧升级后）——applySelection / fpsCap 变更 / 开关切换
    三条路径全部经过该 gate，关闭时 scene 壁纸只显示静态帧 (frameUrl)
  - 壁纸效果区新增"beta场景动画"checkbox（scene 类型显示）：关闭时若
    已在播放 scene-anim 视频 → 回退静态帧并取消渲染；开启时从静态帧
    启动动画化升级
  - build 后 lib/client.js 185449 bytes；verify-client 报 react-dom mock
    缺失为既有问题（与本次改动无关）
- [x] **占位文本处理（sf38h）**：用户反馈"壁纸中大部分文本是需要接其它
  组件的占位文本（可关闭作者声明、实时时钟等）"。全量扫描 14 个壁纸的
  text 对象分类：①**脚本驱动**（`{script, value}`，时钟/日期/星期/时辰/
  FPS）②**静态占位**（作者声明"Bilibili/抖音 夜莺Night"等）③**用户属性
  可见性**（`visible:{user:...}`）。分析发现 3 个 bug 并修复：
  - **toValueObj 误判文本字符串为向量**（scene-scripts.js）：多词文本
    （"Text Layer"）被转 Vec3 → update 返回原值 → formatResult 格式化为
    "0.000000 0.000000 0.000000"（FPS 计数器文本破坏）。修复：仅纯数字
    字符串转 Vec3，非数字多词字符串保持原样。
  - **visible 用户属性未解析**（core.js `_isVisible`）：`visible:{user:
    "clock",value}` 官方语义 = 绑定 project.json 用户属性，用户关闭后该
    组件不渲染；旧实现只读 scene.json 硬编码 value → 用户关闭的作者声明/
    FPS/时钟仍显示。修复：`_isVisible` 优先读 userProps[user] 当前值
    （false/'false' → 隐藏），无该键回退 value。
  - **scene scriptproperties 未注入**（scene-scripts.js）：scene.json 对象
    上的 `scriptproperties`（如 `use24hFormat:{user:"_24",value:false}`）
    是设计器存盘 + 用户属性绑定，编译期 createScriptProperties 只含脚本
    内声明默认 → 时钟 12/24h、分隔符等用户调整丢失。修复：运行时按当前
    对象覆盖 `context.__scriptProperties`（user 绑定 → userProps 当前值，
    否则 value；同脚本多对象不串）。
  验证：时钟/日期/星期/时辰脚本全部正常更新为真实时间（3655429099
  "Wednesday"→"Tuesday"、3774904326 "DAY"→"TUE" 等）；3660962877 Clock
  499 经 _24=true 注入显示 24h 制 "18:09"（修复前错误 12h）；FPS 计数器
  "Text Layer" 不再被破坏且 visible.user=fps=false 时隐藏；作者声明
  newproperty50=true 正常显示。残余：FPS/帧率显示类依赖每帧累积（静态帧
  无法计算，保持占位）；3774904326 Text UPDATER 读 shared.currentTODState
  但无脚本设置（跨脚本依赖缺失，NSL 框架层）；3640755971/3641860575
  渲染失败（NSL Event ID 既有问题）。
- [x] **即时文本放弃渲染（sf38i）**：时钟/日期/FPS 等即时组件与静态帧缓存
  直接冲突（缓存的 PNG/视频里时间冻结在渲染时刻 = 错误时间）。用户决策：
  **短期放弃渲染这些文本**，拆出方案延后。量化：88 个文本脚本中 84 个时间
  依赖（识别可靠）；文本层单独渲染成本仅 ~68ms（1280×720，构造 10ms +
  渲染 68ms，远低于全场景 1.6s）。实现：`_isLiveText(o)`（text.js）正则检测
  脚本源码 `new Date|Date.now|getHours(|getMinutes(|getSeconds(|getFullYear(
  |getMonth(|getDate(|getDay(|engine.frametime|performance.now` → 命中即
  `renderTextObject` 开头 return。验证：3655429099 3/3 跳过、3774904326
  时钟/日期跳过但静态符号 ☾☽ 与 Text UPDATER（无时间依赖）保留、
  3660962877 61/69 跳过（渲染 380ms 含 62 脚本编译，缓存后无影响）。
  静态文本（作者声明等）不受影响正常渲染。
- [ ] **即时文本拆出单独实时渲染（延后，sf38i 决策）**：背景帧缓存（跳过
  即时文本）+ 每次请求单独渲染文本层合成（~68ms），需客户端定时轮询刷新
  URL 时钟才走动。用户决策：延后进行，当前用"放弃渲染"策略。方案矩阵：
  A 放弃渲染（已实现，最简）/ B 拆出单独渲染（时钟秒级正确但需渲染分离 +
  合成 + 客户端轮询，复杂度最高）/ C 分钟级缓存刷新（缓存 key 附分钟时间戳
  每分钟重渲整帧 3840~1.6s，时钟误差 ≤60s，实现简单但即时壁纸持续占 CPU）。
- [x] **作者水印一并跳过（sf38j）**：用户要求"一并考虑不渲染可关闭作者
  水印"。扫描确认水印特征 = **静态文本（无脚本）+ visible 绑定用户属性**
  （伊蕾娜系列 4 壁纸 "Bilibili/抖音 夜莺Night"、"（可自定义文字）"，
  visible.user="newproperty50"；与即时文本互补——脚本文本如媒体信息组件
  保留）。实现：`_isWatermarkText(o)`（text.js）——非脚本文本 + visible
  含字符串 user → 跳过渲染。验证：3470764447/3486806915/3629379075/
  3660962877 水印全部跳过（4 壁纸 × 2 组）；其他壁纸无水印不受影响；
  保留的 stay 文本（歌词/符号/媒体信息）正常。
- [ ] **小角度旋转**：image 对象非零角度旋转（blitRotated 近似，待精确）。
- [x] **blitRotated 负尺寸空白修复（sf39a）**：全库位置审计发现 image 组件
  负 scale（镜像）+ 旋转组合完全空白。根因（纯数学）：`blitRotated` 用
  `invDw = img.width / dw`（dw 负 → invDw 负）且 `sx = (ux + halfW) * invDw`
  （halfW 负）→ 源 UV 符号翻转 → `sx < 0 || sx >= img.width` 全部 continue
  → 不渲染。修复：负 dw/dh 归一化为正 + flipX/flipY 标记，旋转前翻转
  `sux = -sux`（绕中心镜像，与 blitScaled flip 语义一致）。验证：4×4
  单元测试镜像+旋转内容正确、方向正确；正 scale 旋转无回归（45°/90°/0°
  全通过）；批量渲染 14/14 壁纸 OK。涉及对象：3486806915 栏杆509/左垂发
  组2 593（负 scale+rot）、3774904326 音频线 419（负 scale）。
- [x] **attachment 锚点语义确认（sf39b）**：审计发现 3486806915 面部组件
  resolveTransform 与 lwe 差异巨大（恒定 +384/+434）。纯数学验证：
  - 差异对象全部经 attachment（五官494→头697→身体467 骨骼锚点），lwe
    无 attachment 支持（其 resolveTransform 无锚点分支）→ 差异是 lwe
    缺失功能，非我们 bug
  - 锚点数学验证：MDAT0001 锚点 = 骨骼最终世界位姿 + 锚点矩阵（官方语义
    已确认）；蒙皮绑定姿态 = 原始网格（bindInv 抵消 bind 平移，数学自洽）
  - 3629379075（后发/书/头 3 锚点）、3640755971（十字架）锚点全部 ✓ 在
    父网格内；3486806915 的 467 是"骨架根"设计（小网格 75×85 + 骨骼延伸
    定义身体骨架，子对象经 attachment 挂骨骼）——官方正常行为
  - 14 个壁纸无 attachment 父链 resolveTransform 与 lwe 公式 100% 一致
- [x] **复杂组件 4 处不一致修复（sf39c-d）**：用户反馈复杂组件壁纸大量问题，
  系统性审计发现：
  - **sf39c：attachment 锚点动画层门控不一致**（core.js `_attachmentOffset` vs
    puppet.js renderPuppet）：renderPuppet 的 animLayers 构建有
    `animations.length > 1` 门控，_attachmentOffset 无 → 单动画 + animationlayers
    时锚点跟随错误动画 → 子对象挂载错位。修复：_attachmentOffset 加同款门控。
  - **sf39d：puppet scale≠1 定位偏移**（puppet.js renderPuppet）：官方模型矩阵
    scale 同时缩放位置与尺寸，旧实现 `dx = origin + rawBounds.minX` 未乘 scale
    （scale 只进 blit 尺寸）→ scale≠1 时网格整体偏移 scale×minX。修复：
    `leftX = origin + rawBounds.minX×scale`。验证：scale=1 壁纸（3460/3655）位置
    不变（用户实测基线），scale=0.98（3640755971）渲染正常。
  - 已确认非 bug：particles 无 viewShift（官方 2D 相机在原点，粒子仅受
    parallax，lwe CParticle.cpp:1901 确认）；model 用完整 camVP（3D 透视路径，
    与 image 2D 平移语义各自正确）；`_sampleAnimRT`/`_matMulRow` 单份实现无
    重复。批量回归 14/14 壁纸全通过。
- [x] **第二轮不一致审计（sf39e-f）**：继续系统性排查（用户指出大量不一致
  不会一轮解决），发现并修复：
  - **sf39e：文本 verticalalign 忽略**（text.js）：场景 232 文本中 1 个
    verticalalign=bottom 被居中显示（位置错误）。修复：verticalalign 支持
    top/bottom/center（与 image alignment 同锚定语义）。另排查确认文本
    Y-up 正确（3655429099 音频壁纸布局推断：音频条 y=275 → 画布底部、
    时钟 y≈2000 → 画布顶部，Y-up 合理；lwe CText 的 Y-down 是 Linux 移植
    转置，官方 WE 文本与 image 同约定）。
  - **sf39f：puppet 缺 brightness**（puppet.js）：官方 CImage 有 brightness
    （lwe CImage.cpp:952），puppet 是 image 子类，旧实现 blit 只传 alpha →
    暗色/过曝 puppet 颜色不对。修复：`alpha × brightness`。已确认 image/
    solidlayer 已有 brightness（正确），model 用材质 uniform（非对象级，
    不同对象类型非不一致）。
  - 已确认一致：particle 发射率 flags&2 = limitOnePerFrame（官方同语义）、
    instantaneous 官方支持、粒子角度 -em.angle 与 blitRotated -angle 同约定、
    位置 +angle 与 lwe L160 一致。批量回归 14/14。
- [x] **第三轮：以官方 shader 源码为真相（sf39g，粒子 4 bug）**：用户指出
  lwe 非官方 + 实测可能巧合，改用官方 assets/shaders/ 源码为唯一真相源，
  发现并修复粒子渲染 4 处不一致：
  - **textureRatio 缺失**：官方 genericparticle.vert `textureRatio =
    g_Texture0Resolution.y/x`，ComputeParticlePosition 垂直尺寸乘 ratio。
    旧实现 halfY=sz/2 忽略 → 12 个非正方形粒子纹理（流星 256×794/drop
    32×128/花瓣 512×128 等）被拉伸成正方形。
  - **smoothstep 二次削边**：官方 frag `color = v_Color × tex.r`（直接采样
    red，chromaticdot red 渐变软点 中心175→边缘0）。旧实现加
    smoothstep(0.2,0.7) → 68% 像素被削成硬边。
  - **多余 0.5 alpha**：官方 v_Color = a_Color（无衰减）。旧实现乘 0.5 →
    粒子普遍偏淡。
  - **SPRITESHEET 缺失**：官方 vert ComputeSpriteFrame 帧选择+blend，旧实现
    无 → 精灵表粒子（notes_sprite_sheet 41 帧 1690×1032，3554161528/
    3641860575）显示整张表。已实现按 TEXS 帧元数据选帧采样。
  验证：官方 font.vert 无 Y-flip + 与 image 同 MVP → 文本 Y-up 结论获官方
  佐证。批量回归 14/14。
- [x] **第四轮：官方 shader 源码审计效果链（sf39h）**：逐效果对比官方
  assets/effects/<name>/shaders/effects/*.frag/.vert 源码，修复 3 处：
  - **waterripple 缺 mask**：官方 `texCoord += normal.xy×strength²×mask`
    (MASK combo)，旧实现忽略 pt[1] mask → 有 mask 水面全图波纹。
  - **waterwaves 缺 mask**：官方 `texCoord += val×offset×strength²×mask`，
    旧实现无 pass 参数忽略 mask。
  - **pulse phase 换算错**：官方 `sin(time×speed + (phase−π/2))`，
    g_PulsePhase range [0,6.282] 弧度；旧实现 `(phase−0.25)×2π` 把 phase 当
    0-1 → phase=3(弧度) 错算 17.3。
  已确认精确一致（逐项核对官方源码）：foliagesway（aspect/噪声/双正弦全对）、
  waterwaves 主数学（vd/off/dist/DUALWAVES）、shimmer（rotate/frac/mix 全对）、
  iris（vert 位移 + frag 替换 + BACKGROUND）、pulse 主流程（noise/pow/blend）、
  waterripple 主数学（n1/n2/normalize）。批量回归 14/14。
- [x] **第五轮：效果 mask UV 缩放系统性修复（sf39i）**：审计发现 3461168300
  等壁纸大量效果 mask 是对象纹理的 **1/2 尺寸**（3840×1741 对象 → 1920×870
  mask，3550×3750 → 1775×1875）。官方 vert 统一 `v_TexCoord.zw` mask UV
  缩放（waterwaves/waterripple/shake/foliagesway 等 vert 确认：
  `z *= maskRes.z/x, w *= maskRes.w/y`）。旧实现所有效果用对象 uv 采样 mask
  → mask 只覆盖 1/4 区域 → 效果区域错误。修复：waterwaves/waterripple/
  foliagesway 的 mask 采样 + shake 的 flow 方向图采样，统一乘
  `maskTex.width/tex.width` 缩放（降采样等比，比例不变）。批量回归 14/14。
  已确认精确（本轮核对官方源码）：waterflow（cycles/blend/mix）、cloudmotion
  （噪声坐标/旋转/MASK mix）、clouds（aspect/旋转/双云/SHADING/MASK）。
- [x] **第六轮：效果链审计（sf39j）**：对照官方 shader 源码修复 3 处：
  - **tint 默认 blend mode 错 + 缺 mask**：官方 BLENDMODE 默认 30（注释），
    旧实现默认 2(multiply) → 着色错误；官方 mask = alpha×maskTex.r，旧实现
    只乘 alpha。修复：默认 30 + mask 支持 + mask UV 缩放。
  - **filmgrain 噪声时间未 frac**：官方 vert `t = frac(g_Time)`，旧实现用
    原始 t → 大时间噪声坐标错位；补 mask UV 缩放。
  - **swing mask UV 未缩放**（sf39i 遗漏）：补 mask 缩放。
  已确认精确：swing 主数学（anim/轴/扭曲/mask 区域/NOISE）、skew（top/bottom
  改 x、left/right 改 y 交叉语义）、scroll（sign×speed²×time + frac×rep）。
  批量回归 14/14。
- [x] **第七轮：效果链审计（sf39k）**：对照官方 shader 源码修复 3 处：
  - **godrays downsample2 mask UV 未缩放**（sf39i 遗漏）：补缩放。
  - **glitter combine mask UV 未缩放**：补缩放。prepare 噪声坐标 ×5 已确认
    精确（官方 vert 同 ×5）。
  - **opacity 缺 g_UserAlpha + mask UV 缩放**：官方 `albedo.a *= mask ×
    g_UserAlpha`（alpha 参数默认 1.0），旧实现只乘 mask 且未缩放。
  已确认精确：godrays cast（dist×length/30 采样/i·weight）、downsample2 噪声
  （mix/step/smoothstep/噪声坐标 n2=(v·0.633−t·0.5s, −u·0.633+t·0.5s)·scale）、
  glitter prepare（density²/timer0/glitter0²）。批量回归 14/14。

- [x] **第八轮：实现未实现效果（sf39l）**：按使用量逐个实现官方效果：
  - **blur（3629379075/3774904326）**：官方 4-pass 链完整复刻 —
    downsample4（目标像素中心 ±1 源texel 4 角采样，rgb=Σ(s·a)/Σa、
    a=Σ(a²)/4）→ gaussian_x → gaussian_y（KERNEL 0/1/2 = 13/7/3-tap 固定权重
    `[0.006299…0.171834]` 对称；offset = g_Scale.x/y ÷ 纹理分辨率；VERTICAL
    combo 决定方向）→ combine（ApplyCompositeOffset = 像素offset ÷ blurred
    分辨率；div = a>0?a:1 反预乘；ApplyComposite COMPOSITE 0/1/2/3 +
    COMPOSITEMONO + compositecolor；mix(原, 效果, mask)；BLURALPHA=0 还原 a）。
    mask UV = uv·(maskRes/objRes)（blur_combine.vert zw 约定）。
  - **depthparallax（3629379075/3641860575）**：QUALITY 0 线性指针偏移 +
    QUALITY 1/2 ray march（24/64 层）完整复刻；sens<0 正交模式、sens≥0 透视
    模式（ctrlSign/ctrlPerspOrtho）；g_ParallaxPosition 参数化（静态帧默认
    屏幕中心 0.5,0.5）。验证：深度=1.0 区无位移、全黑深度图全量位移
    （=P=viewDir·scale·0.1）均符合官方算法。
  - **watercaustics（3582367840）**：4 噪声纹理（perlin/uniform/voronoi）
    按时间卷动 + distortion 扰动 + chromatic 3 通道 voronoi_local 采样；
    MODE 0 realistic（smoothstep 阈值）/ MODE 1 illustrative（粒子阈值）；
    ApplyBlending BLENDMODE 默认 32。验证：图案非恒定 + alpha 保持。
  - **blend（3554161528）**：PerformBlend WRITEALPHA（premultiplied 合成
    数学）/ 非 WRITEALPHA（blendAlpha·=blend.a + ApplyBlending）；
    GetUVBlend 裁剪；blend 纹理 = textures[1]（_rt_ 引用 → canvas 近似）。
    验证：WRITEALPHA 输出 (0,255,0,128) 与官方数学一致。
  批量回归 14/14（与基线一致；3470764447/3660962877 视频纹理为既有问题）。
  已提交 bea7b03（含 sf39e-l）。

- [x] **第九轮：GLSL 效果解释器（sf40）**：通用第三方效果执行（替代逐个手写）：
  - **技术栈调研**：@shaderfrog/glsl-parser 7.x（2026 活跃，PEG 解析 + 自带
    预处理器）可装可跑；glsl-transpiler 3.x 能转译简单 shader 但 swizzle 左值
    （`albedo.rgb =`）等语法直接报错（老 stack.gl 生态）→ **弃用，自写转译器**。
  - **模块**（lib/we-renderer/glsl/）：
    - `preprocess.js`：`#include` 递归展开（WE 全局 assets/shaders + pkg）+
      `// [COMBO]` 注释默认值 + 场景 combos 注入 → shaderfrog `preprocess()`；
      `uniform <t> <n>; // {"material":"xxx"}` 提取 material→uniform 映射
    - `transpile.js`：AST→JS（vec→数组、swizzle 读写、构造广播、运算符重载、
      if/for/while/return、函数参数按值复制、mat `m[i][j]` → subarray 列向量、
      `group` 括号、`type_specifier`/`type_name` callee、else-if 数组结构）
    - `runtime.js`：30+ GLSL 内置（mix/step/smoothstep/clamp/dot/cross…）
      + WE intrinsic（texSample2D/mul 行向量×列主序/CAST2-4/saturate/M_PI）
    - `executor.js`：vert 4 角跑 varying → 双线性插值 → 逐像素 `main()` →
      RGBA；uniform 引擎注入（g_Time/g_TextureNResolution xy=objRes zw=texRes/
      g_LayerModelMatrix 单位阵/parallaxPosition）
    - `integration.js`：applyEffects else 分支（第三方/官方未实现效果走 GLSL），
      pkg shader 读取 + 编译缓存（实例级）+ g_Texture0=当前纹理绑定 + 失败回退原图
  - **验证**：fade（vert 变换 + smoothstep 链）、shadow（if/else-if 链 +
    ApplyBlending + vert 反射坐标）、custom_user_texture（PerformBlend WRITEALPHA +
    common_blending.h include）三个真实效果**端到端 PASS**（对照官方 shader
    手写数学，偏差 ≤0.5）；14 壁纸批量回归与基线逐位一致。
  - **性能优化**：
    - **vec 运算转译期内联**：`v*2.0 + CAST2(0.5)` → 数组字面量
      `[v[0]*2.0, v[1]*2.0]`（expr 加 simple 标记，简单操作数安全内联），
      消除 __rt._vadd/_vmul 函数调用 + Float32Array 分配
    - **mix 内联**：vec 混合逐分量展开
    - **bilinear 缓冲复用**：像素循环预分配 varying 插值缓冲
    - **大对象降采样**：>65536 像素对象在小分辨率（≤256²）执行 + 最近邻放大 —
      **3840×2160 全屏效果 ~30s → 159ms**
    - 基准（128×128）：custom_user_texture 59ms/帧（3.6μs/px）、shadow 8ms、
      fade 6ms
  - **限制**：复杂 shader 超出解析器（如 18KB audio_responsive_oscilloscope
    parse 失败）→ 回退原图；音频效果（enhanced_simple_audio_bars）无 shader
    文件 → 回退；后续可加编译结果磁盘缓存、step/smoothstep/clamp vec 内联。
  未提交 git（用户要求本轮不提交）。

- [x] **第十轮：父级可见性级联（sf40a，Mutsumi 用户栏组件误渲染）**：用户反馈
  Mutsumi（3629379075）渲染了 App Launcher Dock 用户栏组件（该组件官方默认
  关闭 `appdockenabled=false`，且属实时组件）。诊断（diag-dock2/3）：
  - renderOrder 中 Dock 相关 25 个对象：id=714 "App Launcher Dock"
    `visible:{user:"appdockenabled",value:false}`（自身已正确跳过），
    **Launcher 1-6（id 726-769）无 visible 字段且 `parent:714`** →
    旧 `_isVisible` 对 `visible==null` 返回 true，脱离父 Dock 独立渲染；
    Launcher 7-24 为 `visible:false`（作者显式关闭）。
  - **修复（core.js）**：`_isVisible` 拆出 `_isVisibleSelf`（原自身判定），
    外层沿 parent 链（≤32 层，与 `resolveTransform` 同模式）检查祖先
    可见性 — 任一祖先不可见 → 本对象不可见。官方场景图语义：组/容器
    对象隐藏时子对象一并隐藏（App Launcher Dock 用父对象 visible 绑定
    用户属性开关，父隐藏后 Launcher 不得独立渲染）。
  - **验证**：Mutsumi 渲染循环实际渲染 37 个对象，Dock/Launcher 数 = 0
    （修复前 Launcher 1-6 渲染）；14 壁纸批量回归与基线一致（无破坏；
    3470764447/3660962877 为既有视频纹理问题）。
  未提交 git（用户要求本轮不提交）。

---

## 四、官方数学逆向（wallpaper64.exe 为准，详见 `docs/WE-REVERSE.md`）

### 已确认
- **官方定位 = origin×0.5×M**（0.5 = 场景→画布固定缩放；M = 世界×视图×投影）。
- **0x30 世界矩阵默认单位阵**（无 0x20 标志时）→ DSH origin×ps 等价。
- **背景跳过视图**（0x304 的 0x1100 标志）：背景（size 达场景尺寸）不经 -eye。
- **视图平移**：前景 `(-eye.x×ps, 0)` — 仅 x 分量（sf32 用户与官方对比确认；
  y 分量按标准 LookAt 推导曾被误用，已移除）。
- **puppet origin 参与骨骼矩阵链**（2×2 旋转，无平移）。
- **MDAT0001 锚点**：子对象 `attachment` 锚定到父 puppet 命名锚点
  （骨骼最终世界位姿 + 锚点矩阵 + 自身 origin）——官方引擎解析确认。
- **additive 动画层参考姿势 = 层动画帧0**（帧0处 additive 贡献为 0）。
- **动画层→动画映射**：层名"动画 N"（数字后缀）→ MDL 第 N 个动画。
- **官方 shader 源码随发行版发布**：蒙皮 `mul(vec4(pos,1), Σw·g_Bones)`
  行向量约定与 DSH `_skinPuppet` 一致。

### 待确认
- [x] **0.5 与 DSH 分辨率关系**：已核对 — 官方固定 0.5（1920 画布 = 场景
      3840/2）；DSH ps = 画布/正交宽（3840/3840=1），粒子/image/puppet 均乘
      ps，在各自画布下与官方 0.5 像素等价（3840 画布 = 2×1920）。
- [ ] **0x384 矩阵B 用途**：image 路径 origin×0.5×矩阵B 的消费方式。
- [ ] **多相机对象选择/叠加语义**：scene 含多个 `camera:"default"` 时的选择规则。
      逆向进展（未定论）：wallpaper64.exe 对象创建分类（0x140190180-0x140190820）
      确认 `camera` 属性值分派：`"point"` → 0x360 字节对象（vtable 0x140490980）；
      `camera:"default"` **不匹配任何专用分支** → 落入默认通用对象
      （vtable 0x140491c38，类型码 0x2c0=5，无渲染内容）。**相机对象消费/
      多相机选择代码未定位**（相机矩阵构造 0x14017FCFC 读内部相机结构，
      来源未确认；相机对象 vtable 无应用方法）。
      文件证据（多相机场景实测）：两相机对象各自 origin/zoom/scale 动画、
      `path` 字段引用 `scripts/camera_paths_<id>.json`（实测内容为空 paths）、
      `visible` 由用户属性 `hrbrbbrentryanimation` 驱动（默认 true，
      scene.json scriptproperties 确认）。preview.gif 前 22 帧静止
      （官方 preview 渲染相机固定，无法反推运镜）。
      当前实现取第一个相机对象（sf33，用户实测更接近官方）。

---

## 五、关键事实备忘（避免回归）

- **FOV 是垂直的**（50° 默认）；正交由 `projScale` 换算场景单位→像素。
- **MDL UV 在 stride-8**（stride 64 时 36）；模型双面渲染 + 背面法线翻转。
- **混合**：D3D additive = `dst += src·srcA`；translucent = alpha over；opaque 直写。
- **Bloom 参数可能是 `{script,value}` 对象** — 必须取 `.value` 否则 NaN→黑帧。
- **效果材质**：`effects/xxx/effect.json` 定义多 pass + fbo；scene.json 对象的
  `effects[].passes[].constantshadervalues` 覆盖各 pass 参数。
- **`{script, value}` uniform**：静态帧取 `.value` 回退（脚本运行时尚缺）。
- **passthrough 层**：`models/util/fullscreenlayer.json` 等 `_rt_` 材质 =
  读当前画布 → 效果链 → 全屏合成。
- **文件编码**：改 package.json 等 JSON 必须 UTF-8 **无 BOM**。
- **视图平移（sf32）**：前景 `(-camEye.x, 0)×ps`（画布坐标）；背景（size 达
  场景尺寸）跳过——`_viewShift()` 单一入口。
