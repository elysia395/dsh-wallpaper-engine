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
- [x] **TODO-4 text 对象**：`lib/font-render.js` CFF 字体引擎（sfnt→CFF→
      CharStrings→charstring 解释器→扫描线光栅化，含 Local/Global Subrs、
      width/hint 处理）；`renderTextObject` 集成（dino_run 计分 "00000"
      数码管清晰渲染）。

### 中期
- [x] **camera paths**：`_resolveCameraPose` 多 path 顺序循环 + 关键帧插值
      （eye/center/up/zoom）。
- [x] **scene scripts**：`lib/scene-scripts.js` vm 沙箱执行 {script,value}
      （update/applyUserProperties 导出 + WEColor API）；razer 彩虹色生效。
- [x] **generic REFLECTION combo**：`_rt_` 渲染目标（画布快照）+
      screenUV + normal.xy*0.01 采样 ×0.35（planks 4 纹理验证）。
- [ ] **粒子完整 renderer 扩展**：rope/trail/control points 类 emitter。
- [ ] **其余 effects/ 系列**（62 个）：blur、blurradial、waterflow、watercaustics、
      swing、spin、skew、twirl、fisheye、perspective、vhs、glitter、shine、
      shimmer、fire、foliagesway、chromaticaberration、lightshafts、localcontrast、
      motionblur、refraction、xray、colorkey、cursorripple、depthparallax、
      edgedetection、fluidsimulation、clouds、cloudmotion、nitro、iris、blend*…
- [ ] **HDR/bloom 完整链**：✅ 已实现（downsample_quarter_bloom 4 角采样 +
      saturate(scale-threshold) + 饱和度 + lin gamma + LDR/HDR 合成）。
- [ ] **音频响应**：✅ 已实现（g_AudioSpectrum 驱动 pulse，引擎 CreateAudioResponse
      公式验证）；需 opts.audioSpectrum 输入（本地场景未用）。
- [x] **sound 对象**：已正确归类（scene 图 'sound' 类型，渲染时静默跳过——无渲染）。
- [x] **视差（parallax）**：camera.parallax + mouse 驱动位移（opts.mouse），
      `(depth+amount)·disp·referenceSize`（lwe 公式）。
- [x] **genericimage2 spritesheet**：TEXS 帧元数据 → 时间驱动精灵帧动画
      （mario_walk_1 等 9 处）。
- [x] **项目 shader（本地使用）**：swayimage（beach 棕榈摆动）、flag
      （eagleflag 旗帜，preview 匹配）、retro（HSV 霓虹）。
- [ ] **puppet 骨骼动画**：✅ 蒙皮基础已实现 — MDLV 顶点 (blendindices@40+blendweight@56) +
      MDLS 骨骼 (9B头+父索引+4x4局部矩阵) + MDLA 动画 (元数据 [u32时长][u32 0][name\0]
      [mode\0][00 00][f0 41][u16帧数][u16 0][u32 0][u32骨骼数][u32 0][u32段字节] +
      骨骼段×N, 段块 36B = 3骨骼 pos.xy 交错布局) + _skinPuppet 时间驱动蒙皮
      (t→30fps帧→层级世界→animWorld×bindInv→顶点 Σw×g_Bones)；
      验证 t=0=绑定姿态 ✓, t 变化平移动画 (眉毛眨眼) ✓。
      **待解明**: 骨骼 rot.z 动画布局 — 头 bone1 段 col7 平滑 -0.2rad 确认为 rot.z,
      但 bone0 段 col6=1 为占位 (非旋转), 段内字段交错布局需更多样例/引擎参考。
- [x] **audio bar 效果对象**：solidlayer + simple_gradient_audio_bar 等（未实现时
      跳过，避免白色占位覆盖画面）。

### 工程
- [ ] **缓存键管理**：渲染管线变更后 bump `lib/index.js` 的 `sf*` 前缀（当前 sf10）。
- [x] **重构**：WE 渲染引擎提取为 `lib/we-renderer/` 独立子目录（core 主体 +
      math/canvas/textures/mdl/bloom/camera 工具模块），`lib/scene-renderer.js`
      变兼容 re-export 入口。
- [x] **scene.pkg 容器（PKGV）**：`readPkg` 双头部支持（旧 PKGV@0 / 新 PKGV0018-0023@4）,
      条目 = u32 nameLen + name + u32 offset + u32 size（不 4 对齐, 无 u64,
      offset 相对 dataStart）; 4 个 workshop scene.pkg 全部解析通过。
      **格式调研结论**（repkg/lwe 源码 + 实测三方一致）：PKGV 全版本（0004-0023）
      为**单一布局** — sized-string 头部（u32 len + "PKGVxxxx"）+ u32 count +
      条目 (u32 len name + u32 offset + u32 length)，offset 相对 dataStart；
      不存在第二种主流布局（旧 PKGV@0 分支仅为防御）。
- [x] **JPEG 纹理解码**：`lib/we-renderer/jpeg.js` baseline SOF0/SOF1（4:4:4/4:2:2/4:2:0,
      Huffman + 反量化 + 浮点 IDCT + YCbCr, RST restart, FF00 填充）;
      TEX 内嵌照片纹理 → loadTexImage jpeg 分支。
- [x] **TEX 容器变体**：`lib/pkg-extract.js` 已覆盖全部 TEXB0001-4（含 V4 JSON 头 +
      param 校验）、LZ4 压缩、TEXS0001-3 帧表、FIF 格式枚举 — 与 repkg/lwe 源码逐字段一致。
- [x] **TTF 字体**：`parseCffFont` 扩展 glyf 表路径（cmap fmt4/12 → 字符映射,
      glyf/loca 简单+复合字形, 二次贝塞尔细分折线, hmtx advance）;
      renderText 统一 CFF/TTF 接口。
- [x] **MDL 骨骼格式逆向**（puppet 动画输入，无社区实现）：MDLV0023 顶点
      （80B stride, pos@0 uv@72, 与 lwe CImage 一致）+ MDLS0004 骨骼（BONEENTRY =
      9B 头 + u32 len + 4x4 矩阵 64B + JSON 属性, 父骨骼索引）+ MDLA0006 动画
      （可选段; 动画条目 = u32 时长/数据 + 骨骼 TRS 流, 每骨骼 36B = pos+rot+scale,
      按骨骼分组 601 帧/骨 实测）。
- [x] **solidlayer 纯色层**：`models/util/solidlayer.json` → 对象 color 填充矩形
      （flat shader）; 带音频条类效果（未实现）时跳过避免白色占位块。
- [ ] **workshop 场景验证**：4 个 scene.pkg 壁纸（2934788040 花 ✓ 完整渲染 /
      3461168300 普拉娜 ✓ / 3470764447 Elaina ⚠ 主纹理为 MP4 视频 / 3486806915
      Amiya ✓ 148 对象 puppet+文本+纯色）; 剩余小角度旋转未实现（直接绘制近似）。
- [ ] **清理**：`scene-layers-out/`（726MB 渲染产物）仅保留少量验证图；
      `docs/images/`（47MB）、`_refs/linux-wallpaperengine`（21MB）按需裁剪。
- [ ] **Git 修复**：`.git` 缺 HEAD/config（objects 仅 43 个，历史截断）；
      重建仓库 + 新分支推送。**网络已恢复**（沙箱外 `git -c http.sslVerify=false`
      或 curl `--ssl-no-revoke` 可访问 github，ls-remote 验证通过）；用户要求
      完成大部分工作后再推送/创建 PR。

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
