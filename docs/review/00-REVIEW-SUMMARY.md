# WE-Renderer 评审汇总（2026-08-28 多 subagent 评审）

> 评审对象：`lib/we-renderer/`（CPU 软件复刻的 Wallpaper Engine 场景渲染器：基础管线 + effects + GLSL 兜底解释器）
> 评审方式：6 个并行子代理分片评审（每片独立产出本目录 `01-06*.md`），本文件为汇总索引与跨模块共性结论。
> 严重级别：**P0** = 崩溃/必现错误 ｜ **P1** = 与官方 WE 明显不符 ｜ **P2** = 次要视觉/性能/健壮性 ｜ **P3** = nit
> 标注 `[verified]` = 该条已在评审中以 node 数值复现（非仅读代码）。
> 说明：`../we-renderer-review.md` 为更早一轮评审的既有文档（P0-1..20/P1-1..45 编号体系），本轮独立分片后与其结论高度一致（如 godrays `_gaussPass`、blurradial K1、GLSL for 循环、粒子三连、mask UV、blitScaled 负尺寸），可互为印证。

---

## 0. 分片索引与统计

| 分片 | 文件 | finding 数 | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|---|
| 01 基础管线 | `core / canvas / math / textures / effects 派发` | BASE-01..34 | 1 | 4 | 9 | 23 |
| 02 图像/相机/Bloom | `image / camera / bloom` | IMG-01..23 | 1 | 2 | 6 | 16 |
| 03 模型/木偶/粒子/文本 | `model / puppet / particles / text / mdl / font-render` | MOD-01..40 | 1 | 9 | 15 | 19 |
| 04 GLSL 栈 | `glsl/*` + `integration.js` | GLS-01..29 | 1 | 7 | 15 | 11 |
| 05 effects 水/自然 | `waterwaves/waterflow/watercaustics/waterripple/clouds/cloudmotion/foliagesway/swing/shake/lightshafts` | WAT-01..20 | 1 | 1 | 10 | 12 |
| 06 effects 光/后期 | `godrays/glitter/shimmer/blurradial/blur/blend/filmgrain/pulse/tint/opacity/skew/iris/scroll/depthparallax` | LGT-01..18 | 2 | 5 | 6 | 9 |
| **合计** | | **164** | **7** | **28** | **58** | **90** |

每片末均有 `## Verified OK`（与官方语义/文档核对通过的部分）与 `KNOWN/PENDING`（既有仲裁清单，评审不重复推导）。

---

## 1. 必须立即处理的 P0（崩溃 / 效果必现失效）

| ID | 位置 | 问题 |
|---|---|---|
| **LGT-01** | `effects/godrays.js:97-98` | `this._gaussPass` 在拆分 effects.js 时被丢弃（原单体在 `effects.js:299` 定义），全库无定义 → godrays 每次在 pass 2 抛 `TypeError`，被 `effects.js:107` 吞掉 → **godrays 从未渲染过一帧**（且每帧刷错误日志）。修复：把 7-tap 可分高斯的辅助函数放回原型。 |
| **LGT-02** | `effects/pulse.js:39` | `this._createAudioResponse` 同样在拆分时丢失 → 音频响应脉冲（AUDIOPROCESSING>0 且有频谱）抛错跳过；无频谱时 `pulse=0` 直接使 PULSEALPHA 图层整层变透明。 |
| **MOD-21** | `particles.js:179-191` | `sys.count` 计的是**累计发射数**且从不递减 → 粒子总发射量达 `maxCount` 后**永久停止发射**。 |
| **MOD-22** | `particles.js` | 粒子旋转被模拟（`p.rot/angVel`）但 `_drawParticles` **从不读取** → 所有粒子恒轴对齐。 |
| **MOD-23** | `particles.js:455` | SPRITESHEET 帧宽：`f.width || fr.count > 0 ? … : …` 运算符优先级恒丢弃 `f.width`（300 意图 → 实际 125）[verified]。 |
| **GLS-01** | `transpile.js` | 所有 `for` 循环**编译失败**（init 是裸 `declarator_list` 循环变量未声明；update 尾 `;` 成第 3 个分号 SyntaxError；`i++` 空转）→ 一切用循环的 shader（blur/voronoi/trails）**静默回退原图**。 |
| **GLS-02** | `transpile.js` | 所有下标静默丢索引（`v[0]`→`v`、`m[1]`→`m`）：shaderfrog 7.0.1 用 `postfix.type === 'quantifier'`，转译器只查 `'index'`；GLSL 数组折叠成标量覆盖 → **静默错像素/黑图、无回退**。 |

> 注：LGT-01/02 的根因经 git 考古证实（commit `684fb0a` 拆 effects.js 时丢函数、留调用点）；MOD-21/22/23、GLS-01/02 均为效果/渲染必现失效或崩溃级错误。

---

## 2. 高优先级 P1（与官方 WE 明显不符，优先修复）

### 2.1 基础管线 / 图像
- **BASE-01 (P1)** `canvas.js:49-60` — 负尺寸（镜像对象）`blitScaled` 整幅塌缩成采单列/单行：`srcOffX=(x0-dx)*invDw` 对翻转得 `-imgWidth`，clamp 把每像素钉在源右缘 → 镜像图层渲染成 1px 拖影 [verified]。
- **BASE-02 (P1)** `image.js` + `canvas.js:62,79-83` — **brightness 作用在 alpha 上**而非 RGB（调暗变半透明而非变暗）；且 `brightness>1` 使 `outA` 溢出、Uint8 回绕（1.3 → alpha=76）[verified]。
- **BASE-03 (P1)** `image.js:130,144,204` — `model.fullscreen` 把 `size=[W,H]`（像素）再乘一次正交缩放 `ps` → 全屏 quad 被放大 `3840/ortho.width` 倍。
- **IMG-01 (P1)** `image.js:16-28` — 全屏自定义 shader quad 的 v 轴映射与已仲裁官方约定相反（画布顶采样 v=1）→ 所有 `_customShaders` 层（cloudsbg 地平线、flowimage）**上下镜像** [verified]。
- **IMG-02 (P1)** `bloom.js` — HDR bloom 通道**无条件计算并叠加**；默认 `bloomhdrfeather=0` 时其门控饱和到 1 → 非 HDR 场景过度泛光 5–20× [verified]。

### 2.2 模型 / 木偶 / 粒子 / 文本
- **MOD-01 (P1)** `puppet.js:167-173` — `g_Bones = final×bindInv` 顺序反了（应为 `bindInv×final`）→ 旋转骨骼绕模型原点公转而非自身枢轴 [verified: 顶点 (11,0)→(0,11)，正确 (10,1)]。
- **MOD-13 (P1)** `model.js:162-248` — `_rasterizeMesh3D` 无近平面/w≤0 裁剪：NaN 深度通过 z-test（`NaN>=x` 为假）→ 相机背后三角形写入垃圾。
- **MOD-24 (P1)** `particles.js:222 vs 230-231,436-437` — 正交路径构造 `scenePos` 时丢掉粒子系统自身 origin（+视图位移）→ 粒子堆在画布角而非发射器世界位置。
- **MOD-33/34 (P1)** `font-render.js` — 每个字形都被缩放到满 `size` 高再各自垂直居中 → 破坏任何比例字体的 x-height/基线对齐（含 NotoSans 回退）。

### 2.3 GLSL 栈
- **GLS-03 (P1)** `transpile.js` — 矩阵运算坏：`mat*vec` 命中 vec 内联分支 → `[(m*v[0]),(m*v[1])]` NaN；`mat*mat` 变逐分量；仅显式 `mul()` 正确，而官方 `common.h` 的 `#define mul(v,m) ((v)*(m))` 在有 WE 资产时连它都废掉。
- **GLS-04 (P1)** `integration.js:91,148` — `g_TextureN` 采样绑定**差一位**（`textures[idx-1]`）：辅助纹理全部错位（`g_Texture1` 绑到 slot0=null→白）；executor 自带的 `compileAndRender` 用正确的 `textures[idx]`，两处互相矛盾。
- **GLS-05 (P1)** `executor.js` — `g_TextureNResolution` 用的是 **Phase-0 判别实验明确否定的** `(objW,objH,texW,texH)` 约定（已仲裁应为 lwe `(mip0.w,mip0.h,header.w,header.h)`）。
- **GLS-06 (P1)** `preprocess.js:10,18` — CPU `parseMeta` 仍会截断嵌套花括号 meta JSON（修复只给了 `parseMetaGL`）→ combo 默认值静默丢失（`#if` 分支被当 0 剪掉）、uniform `material` 映射丢失 → undefined → **整图黑**。

### 2.4 effects
- **LGT-03 (P1)** `blurradial.js:53-64` — KERNEL=1 的 4-tap 有符号核（权重和 1.0）被当作对称 ± 采样镜像 → 总权重 2.0 ≈ **2× 亮度**且 tap 集合错位 [verified]。
- **LGT-04 (P1)** `godrays.js:113` — combine alpha `src.a + rays.a` 未 clamp → Uint8 模 256 回绕（0.8+0.6 存成 101 而非 255）[verified]。
- **LGT-05 (P1)** `blend.js:58,63` — `transformRepeat === 1 / === 0` 与**布尔值**比较 → TRANSFORMUV 的 wrap/clip 两个分支全是死代码 [verified]。

---

## 3. 跨模块共性根因（一改多受益）

1. **mask/flow UV 缩放约定自相矛盾（系统性）** — `WAT-04`/`LGT-08` 跨 10+ 个 effect：`waterwaves/watercaustics/foliagesway/swing/shake/godrays/glitter/tint/opacity/filmgrain/blur/blend/depthparallax` 用 `maskW/objW`（mask 半尺寸时 uv×0.5）；而 `waterripple/cloudmotion/clouds/iris/shimmer/pulse/blurradial` 用纯 uv。官方已仲裁约定为 header/mip0（无 mip → 1 全幅）。**与 MAD 验证过的 WE-REVERSE §9.2/9.5 冲突，需统一重新裁决**。本次全部按 KNOWN/PENDING 标注，未重复推导。
2. **缺失纹理白/中灰回退的放大效应** — `WAT-02`：`_texSample(null)` 返回 `[1,1,1,1]`（白）→ `util/noflow` 缺失时 waterflow 把白解码成最大流量（flowAmount=1.42）→ 全图 0.05 UV≈96px 对角位移；同类白回退还影响 `clouds.js:34`（全幅覆盖）、`watercaustics.js:28-31`。
3. **per-pixel 分配爆炸（性能）** — `WAT-08`/`GLS-09`：`waterflow` 的 `mix2` 闭包、`watercaustics` 每像素 ~9-10 个堆数组 + 8-11 次纹理采样；GLSL 非简单表达式逐分量重求值（`vec4(texture2D(t,uv).rgb,1.0)` 实测每像素 12 次采样）——4K 静态帧 ≈ 7500-8300 万次分配/帧。
4. **位移采样 wrap/clamp 不一致** — `WAT-07`：waterflow/cloudmotion/foliagesway/swing 对**主图位移采样**用 REPEAT，而 waterwaves/shake/waterripple 用 clamp，违背项目自己的 §9.6 CLAMP 决策 → 边框回绕条纹（waterflow 最重，~5% UV）。
5. **BLENDMODE=0 的 falsy 默认值 bug** — `LGT-07`：`filmgrain.js:6` / `pulse.js:16` 用 `combos.BLENDMODE || 默认` → 显式 `BLENDMODE=0`（Normal）静默变成 softlight(12)/add(9)。其余 effect 用 `!= null ? Number(..) : 默认`（正确），需统一。
6. **`combos.X === '1' || === 1` 字符串/数字不一致** — 跨 effect 检查方式五花八门（`MASK`/`REPEAT`/`WRITEALPHA`/`BLURALPHA`/`TRANSFORMUV` 等），JSON 中 combo 可能为字符串或数字，部分 effect 只认一种 → 静默失效分支。

---

## 4. 建议修复顺序（按收益/成本）

1. **P0 恢复**：`_gaussPass`（LGT-01）、`_createAudioResponse`（LGT-02）、GLSL `for`/下标（GLS-01/02）——先让 godrays/音频脉冲/GLSL 兜底"能跑"。
2. **视觉效果最大偏差**：IMG-01（全屏 v 翻转，一行 UV 修复）、IMG-02（bloom HDR 门控）、BASE-02（brightness 改作用于 RGB）、BASE-01（镜像 blit）。
3. **粒子正确性**：MOD-21/22/23/24（发射计数、旋转渲染、帧宽优先级、ortho origin）。
4. **GLSL 语义**：GLS-04（纹理绑定差一）、GLS-05（resolution 约定）、GLS-06（parseMeta 嵌套括号）、GLS-03（矩阵运算）。
5. **单 effect 修复**：LGT-03/04/05、WAT-01（`Math.round(x+0.5)` → +1px 偏移）、WAT-03（`smoothstepFn` e0==e1 → NaN）。
6. **系统性统一**：mask UV 约定裁决（§3.1）、缺失纹理回退策略（§3.2）、per-pixel 分配优化（§3.3）、REPEAT/clamp 统一（§3.4）、BLENDMODE falsy（§3.5）。
7. **健壮性**：MOD-13（近平面裁剪）、LGT-04（alpha clamp）、P0/P1 全部加单测冒烟（如 `effectGodrays` 小纹理断言不抛）。

---

## 5. 已知 / 待仲裁（评审保留，未重复推导）

见各分片 `KNOWN/PENDING` 段；核心四项：
- shake 位移单位缺 ×w/×h（mp4 从未生效）；
- mask UV 缩放用 mask/object 比而非官方 header/mip0 比；
- waterripple mask 纯 uv（mSx=mSy=1，已定案）；
- canvas.clear（基础管线）。

---

## 6. Verified OK（与官方语义核对通过的关键部分）

完整清单见各分片 `## Verified OK` 段。代表性结论：`mat4FromTRS`、`applyBlending` 1-4/6-9/11-19/23-29 模式、`resolveTransform`、MDAT0001 锚点解析、`_viewShift` 符号、相机路径插值、alignment 边缘锚定、透视校正光栅插值、`_texSample` isFinite 守卫、PNG 编解码 filter 0-4、waterripple 官方公式逐项核对、lightshafts squareToQuad/inv3 几何自洽、runtime GLSL 内建（`atan(y,x)`/`mod`/`fract`）等。
