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
| `opacity` / `blurprecise` | — | ⏸ 跳过（性能/简化） |
| 其余 effects（blur/waterflow/swing/iris/lightshafts…） | `assets/effects/` 62 个源码 | ⏳ 待实现 |

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

workshop 场景：scene.pkg 解析 + 渲染全通过（含 puppet/文本/纯色/粒子），
视频纹理类（MP4 主纹理）待视频解码组件。

---

## 三、TODO（按优先级）

### 短期（引擎一致性优先）
- [x] **背景中区错位**：已定位为 preview 编辑器相机差异，非渲染 bug。
- [x] **generic LIGHTMAP 第 2 UV 通道**：stride 56 uv2@stride-16 + 透视校正 +
  combo 兼容 + skylight。
- [x] **多帧/视频动画**：`/scene-anim` 路由 + worker times 数组 + APNG 编码。
- [x] **text 对象**：`lib/font-render.js` CFF 字体引擎 + `renderTextObject` 集成。

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
- [ ] **其余 effects/ 系列**（62 个）：blur、waterflow、swing、spin、skew、twirl、
      fisheye、vhs、glitter、shine、fire、foliagesway、chromaticaberration、
      lightshafts、localcontrast、motionblur、refraction、xray、colorkey、
      cursorripple、depthparallax、edgedetection、fluidsimulation、clouds、iris…
- [x] **HDR/bloom 完整链**：downsample_quarter_bloom + saturate + lin gamma 合成。
- [x] **音频响应**：g_AudioSpectrum 驱动 pulse。
- [x] **视差（parallax）**：camera.parallax + mouse 驱动位移。
- [x] **genericimage2 spritesheet**：TEXS 帧元数据 → 时间驱动精灵帧动画。
- [x] **puppet 骨骼动画**：MDLV 顶点 + MDLS 骨骼 + MDLA 动画 + `_skinPuppet` 蒙皮；
      **动画层合成**：全部 visible animationlayers 参与（普通层 mix + additive 层
      世界空间 delta 叠加 + rate）。
- [x] **audio bar 效果对象**：未实现时跳过，避免白色占位覆盖画面。

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
- [ ] **小角度旋转**：image 对象非零角度旋转（blitRotated 近似，待精确）。
- [ ] **清理**：`scene-layers-out/`、`docs/images/`、`_refs/` 按需裁剪。

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
- [ ] **0.5 与 DSH 分辨率关系**：官方固定 0.5（1920 画布 = 场景 3840/2），
      3840 渲染 ps=1 在全部路径是否等价（粒子 projScale 待核对）。
- [ ] **0x384 矩阵B 用途**：image 路径 origin×0.5×矩阵B 的消费方式。
- [ ] **多相机对象选择/叠加语义**：scene 含多个 `camera:"default"` 时的选择规则。

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
