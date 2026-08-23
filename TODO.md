# Wallpaper Engine 跨平台渲染引擎 — 现状与 TODO

> 目标：将 `lib/scene-renderer.js` 发展为与 Wallpaper Engine 原生渲染高度一致、
> 可在多平台（Windows/Linux/macOS 的 Node/浏览器）运行的 WE 场景渲染引擎。
> 以引擎自带 shader 源码、OBJ 源几何、场景数据与 preview 渲染为**事实基准**，
> 优先引擎事实而非参数猜测。
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
  [20,16,...]，UV=stride-8；无法线时重算平滑法线。已对照 neonsun.obj/neongrid.obj 验证。
- **光栅化** `_rasterizeMesh3D`：透视校正 1/w、双面渲染（背面法线翻转）、
  opaque/additive/translucent 混合、`depthwrite: disabled` 不写 z。
- **Bloom** `_applyBloom`：亮部提取 → 1/4 降采样 + 盒式模糊 → 按 strength 叠加；
  参数兼容 `{script,value}` 对象（NaN 防护）。

### 2. 场景对象
- **Image**：`renderImage` — 正交 projScale、尺寸/alpha/brightness、
  效果链 `applyEffects`、passthrough 后处理层（`_rt_` framebuffer 材质）。
- **Model / Puppet**：MDL 网格 → 蒙皮（绑定姿态）→ 光栅化。
- **Particle**：`_buildParticleSystem` 完整模拟 — emitter/initializer/operator
  （重力/阻力/力/颜色渐变/alpha 淡入淡出/尺寸/旋转/轨道）、additive 混合、
  R 通道 smoothstep 软边、`mix(color1,color2,v_Color.r)`、projScale。

### 3. 效果链（CPU 复刻引擎 shader）
| Effect | 源码依据 | 状态 |
|---|---|---|
| `scroll` | `effects/scroll`（`v_Scroll=sign(s)·s²·t`，`frac((uv+v_Scroll)·g_Scale)`） | ✅ 已验证 |
| `tint` | `effects/tint`（ApplyBlending，默认 multiply） | ✅ 已验证 |
| `pulse` | `effects/pulse`（mask.a·Multiply） | ✅ 已实现 |
| `filmgrain` | `effects/filmgrain`（双噪声卷动 + GREYSCALE + softlight） | ✅ 已验证（方差 3.13×） |
| `godrays` | `effects/godrays` 5-pass 链（downsample2→cast→gauss_x→gauss_y→combine） | ✅ 已验证（add 提亮） |
| `waterwaves` / `waterripple` / `shake` | 引擎 effect | ✅ 已有（简化） |
| `opacity` / `blurprecise` | — | ⏸ 跳过（性能/简化） |
| 其余 57 个 effects（blur/waterflow/swing/iris/lightshafts…） | `assets/effects/` 62 个源码 | ⏳ 待实现 |

### 4. 基础设施
- **ApplyBlending 全 32 模式** CPU 复刻（`common_blending.h` 逐宏翻译，含 HSL 系列）。
- **全局 assets 回退**：`loadTexture`/`readJsonAny`/`readAny` 支持 WE 全局
  `assets/`（`util/noise.tex`、`models/util/fullscreenlayer.json` 等），
  worker 经 `locateWallpaperEngineP()` 探测安装目录。
- **效果多 pass 链**：`applyEffects` 传入完整 `passes`，godrays 走 5-pass + 半分辨率 fbo。
- **worker 非阻塞渲染**：`scene-render-worker.mjs`（600s 超时、空帧门禁、
  ArrayBuffer 零拷贝回传）。
- **静态帧缓存**：cache key `sf10`（当前）。
- **camera paths**：`_resolveCameraPose` 多 path 顺序循环（总时长 = duration 和），
  path 内关键帧线性插值 eye/center/up/zoom（demon_core 4 镜头验证）。
- **粒子确定性**：mulberry32 种子 RNG（场景路径+对象 id hash），同 time 帧可复现，
  不同 time 驱动动画（shimmering_particles 两次渲染 diff=0）。
- **模型欧拉角**：`mat4FromTRS` 按引擎约定 Rz(-z)·Ry(y)·Rx(-x)（lwe-CParticle.cpp:1836），
  X/Z 取负；`resolveTransform` 保留完整 XYZ angles。
- **generic LIGHTMAP**：第 2 UV 通道（stride 56: uv2@stride-16），透视校正插值，
  combo 大小写兼容（引擎材质小写），lightmap 乘 light/spec（引擎 v_TexCoord.zw 语义）。
- **skylight 环境光**：`_shadeGeneric` ambient = skylight·(n·up) mix（引擎
  v_LightAmbientColor + skylight）。

---

## 二、当前验证基线（本地 defaultprojects 全回归通过）

| 场景 | 状态 | 备注 |
|---|---|---|
| `demon_core` | ✅ 正确 | camera paths 4 镜头动画 |
| `neon_sunset` | ✅ 正确 | 欧拉角修复 + filmgrain |
| `deep_space` | ✅ 正确 | flowimage 流光正确 |
| `dino_run` | ✅ | scroll×5 + godrays 后处理 |
| `dna_fragment` | ✅ 正确 | 背景已验证正确（preview 编辑器相机差异） |
| `arsenal` | ✅ 手枪可见 | lightmap 第 2 UV + skylight 已实现 |
| `shimmering_particles` | ✅ 确定性渲染 | 同 time 帧可复现，动画需多帧评判 |
| `beach`/`retro`/`razer_bedroom`/`razer_vortex`/`eagleflag` | ✅ 渲染成功 | — |

---

## 三、TODO（按优先级）

### 短期（引擎一致性优先）
- [x] **TODO-1 `dna_fragment` 背景中区**：已定位为 preview 编辑器方形相机
      差异（运行时基于 scene.json camera 正确），非渲染 bug。
- [x] **TODO-2 `arsenal` lightmap 第 2 UV 通道**：stride 56 uv2@stride-16 提取 +
      透视校正插值 + combo 大小写兼容 + skylight ambient。
- [x] **TODO-3 多帧/视频动画**：`/scene-anim` 路由 + worker times 数组 +
      APNG 编码（`lib/apng-encode.js`，acTL/fcTL/fdAT）；粒子 starttime
      延迟语义（dust motes=50 等）已修复，t=55 粒子正确显示。
- [ ] **TODO-4 text 对象**：TTF/OTF 解析（sfnt/cmap/glyf 轮廓 + 扫描线光栅化），
      支持 color/pointsize/origin/scale/horizontalalign/anchor（dino_run label）。
      字体源：全局 `assets/fonts/`。

### 中期
- [x] **camera paths**：`_resolveCameraPose` 多 path 顺序循环 + 关键帧插值
      （eye/center/up/zoom）。
- [ ] **scene scripts**：`{script, value}` 的 JS 运行时（userProps/update 钩子），
      支撑 razer 彩虹色、dino_run 计分等动态行为。
- [ ] **粒子完整 renderer 扩展**：rope/trail/control points 类 emitter。
- [ ] **其余 effects/ 系列**（62 个）：blur、blurradial、waterflow、watercaustics、
      swing、spin、skew、twirl、fisheye、perspective、vhs、glitter、shine、
      shimmer、fire、foliagesway、chromaticaberration、lightshafts、localcontrast、
      motionblur、reflection、refraction、xray、colorkey、cursorripple、depthparallax、
      edgedetection、fluidsimulation、clouds、cloudmotion、nitro、iris、blend*…
- [ ] **HDR/bloom 完整链**：HDR 阈值/散射/up-sampling 组合（`combine_hdr_*`）。
- [ ] **音频响应**：`g_AudioSpectrum*` uniform（pulse 的 AUDIOPROCESSING 分支）。
- [ ] **sound 对象**：无渲染影响（跳过即可，但需在场景图中正确归类）。
- [ ] **视差（parallax）**：`parallaxDepth` + 相机位移。

### 工程
- [ ] **缓存键管理**：渲染管线变更后 bump `lib/index.js` 的 `sf*` 前缀（当前 sf10）。
- [ ] **清理**：`scene-layers-out/`（726MB 渲染产物）仅保留少量验证图；
      `docs/images/`（47MB）、`_refs/linux-wallpaperengine`（21MB）按需裁剪。
- [ ] **Git 修复**：`.git` 缺 HEAD/config（objects 仅 43 个，历史截断）；
      重建仓库 + 新分支推送（当前网络不可达 github.com）。

---

## 四、关键事实备忘（避免回归）

- **FOV 是垂直的**（50° 默认）；正交由 `projScale` 换算场景单位→像素。
- **MDL UV 在 stride-8**（stride 64 时 36）；模型双面渲染 + 背面法线翻转
  （引擎默认 no-cull）。
- **混合**：D3D additive = `dst += src·srcA`；translucent = alpha over；opaque 直写。
- **Bloom 参数可能是 `{script,value}` 对象** — 必须取 `.value` 否则 NaN→黑帧。
- **效果材质**：`effects/xxx/effect.json` 定义多 pass + fbo（scale=2 → 半分辨率）；
  scene.json 对象的 `effects[].passes[].constantshadervalues` 覆盖各 pass 参数。
- **`{script, value}` uniform**：静态帧取 `.value` 回退（脚本运行时尚缺）。
- **passthrough 层**：`models/util/fullscreenlayer.json` 等 `_rt_` 材质 =
  读当前画布 → 效果链 → 全屏合成。
- **文件编码**：改 package.json 等 JSON 必须 UTF-8 **无 BOM**（PS 5.1
  `Set-Content -Encoding UTF8` 会写 BOM 导致 JSON.parse 崩溃）。
- **DSH 安装恢复规则**：CLI `dsh plugin add` 会被 startup-recovery 回滚；
  手动编辑 profile package.json（link: 说明符）避免事务回滚。
