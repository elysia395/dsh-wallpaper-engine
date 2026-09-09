# we-renderer 评审报告 — 基础实现与 effects

> 日期:2026-02(多 subagent 并行评审)
> 对象:`lib/we-renderer/` 全部 45 个文件(基础层 + 24 特效 + GLSL 兜底层),约 8.3k 行
> 方法:8 个评审 agent 分模块只读评审,统一以官方 WE 行为为事实基准
> (`docs/WE-REVERSE.md` §3/§5/§9、`test/scene-gl-spike/assets/` 官方 shader 快照、
> 官方 effect/material JSON);所有 P0 与关键 P1 均经过第二遍代码/文档复核,
> GLSL 转译类发现另在官方 waterripple 快照上用 node 实测复现。
> 评审期间未修改任何源码。

---

## 一、结论摘要

| 严重度 | 数量 | 含义 |
|---|---|---|
| P0 | 20 | 与官方行为明显可见偏差(整特效失效/翻转/错位/NaN) |
| P1 | 35+ | 特定参数/边界下偏差、功能性缺失 |
| P2 | 40+ | 隐患、性能(GC)、死代码 |

用户反馈"很多特效都有异常"的实锤按影响面排序:

1. **主绘制路径失真(所有壁纸可见)**:`blitScaled` 伪双线性(最近邻)+ 负尺寸镜像全错、`blitRotated` 旋转方向与官方相反 —— 几乎每个对象都经过这两条路径。
2. **特效整体静默失效**:`godrays` 调用不存在的 `_gaussPass` 每帧抛错被吞;`blurprecise` 无条件跳过;`pulse` 的 `_createAudioResponse` 同类缺失。
3. **粒子系统三连**:初速恒 0、maxcount 变终身累计上限、正交场景丢系统 origin。
4. **GLSL 兜底层(第三方 workshop 特效)成建制失效**:pkg shader 路径拼接错误(第三方效果永远找不到 shader)、纹理派生 combo(MASK 等)从不推导、纹理槽位 off-by-one、wrap 恒 clamp、`g_TextureNResolution` 语义与 §9.2 裁决相反、转译器 for 循环/swizzle 三处 P0(官方快照默认路径即触发)、discard 失效、`parseMeta` 嵌套 JSON 截断。
5. **mask UV 缩放三种写法互相矛盾**(详见 §四.2),与 WE-REVERSE §9.2 定论冲突者居多。

---

## 二、P0 清单(全部经复核)

### 2.1 基础绘制层(canvas.js)

**[P0-1] blitRotated 旋转方向与官方相反**
- 位置:`canvas.js:95`(及 109-110)
- 逆映射取 `cos(-angle)` → 内容变换为 R(+angle),y-down 画布上正角呈**顺时针**;官方正角=屏幕逆时针(WE-REVERSE §9.4,lwe CImage quad 旋转 −angle)。函数自己的注释写着"(逆时针)"。
- 修复:第 95 行改 `Math.cos(angle)/Math.sin(angle)`。

**[P0-2] blitScaled 注释称 bilinear,实际 Math.round 最近邻**
- 位置:`canvas.js:55、59`(注释在 44)
- 主绘制路径全部缩放对象受影响:4K 画布渲染 1080p 场景时 ps=2,几乎全部对象 2× 最近邻放大 → 像素块/摩尔纹。同文件 blitRotated(118-133)有真双线性,证明是设计意图。
- 修复:仿 blitRotated 做四点双线性(含 alpha)。

**[P0-3] blitScaled 负 dw/dh(镜像)完全错误**
- 位置:`canvas.js:49-60`
- flipX 时 `srcOffX = -img.width`,所有 sx clamp 到 0 → `sx = w-1` 恒定 → **垂直色带**;flipY 无镜像语句 → **水平色带**且不翻转。scale.x<0 的对象全部坏。
- 修复:按带符号 dw/dh 计算源坐标;flipY 补 `sy = img.height-1-sy`。

### 2.2 场景对象层

**[P0-4] 正交场景粒子缺系统 origin,整体定位错误**
- 位置:`particles.js:222`(生成)、`436-437`(绘制)
- 正交路径 `p.scenePos` 只含发射器局部坐标,绘制时 `p.scenePos[0]*ps[0]` 未加 `sys.origin`(像素路径 230 行加了)→ 粒子系统整体钉错位置。
- 修复:scenePos 初始化/更新统一加 `sys.origin`。

**[P0-5] maxcount 按"累计出生数"封顶,粒子流提前永久熄灭**
- 位置:`particles.js:179-190`
- `sys.count` 出生时 `++`、死亡 splice 时从不 `--`,门限 `sys.count < sys.maxCount` 变成一生最多生成 maxcount 个 → 粒子雨/落叶提前断流。
- 修复:门限改用 `sys.particles.length`(或死亡时递减)。

**[P0-6] 发射器 speedmin/speedmax/cone/sign 未实现,粒子初速恒 0**
- 位置:`particles.js:126-127`(解析后弃用)、`208、223`
- 代码注释自认"暂不实现";`vel:[0,0,0]`,无 velocityrandom 初始化器的发射器产出完全静止的粒子 → "粒子不飞散/堆积成团"。
- 修复:按 `speed∈[speedMin,speedMax]` 沿 directions(含 cone 扰动)赋初速,sign 施加逐轴符号。

**[P0-7] 全屏 shader quad 的 UV v=0 配在画布底部,违反 §9.1 y-down**
- 位置:`image.js:16-17(配对)、24(y 映射)`
- `v=0 ↔ NDC y=-1 → sy=H(画布底)`;官方 v=0 在图顶 → 全屏自定义 shader 层(cloudsbg/bg/curve 等)贴图垂直翻转、v 非对称数学(地平线等)上下倒置。
- 修复:uvs 改 `[[0,1],[1,1],[0,0],[1,0]]`,或 shade 入参统一 `v→1-v`。

### 2.3 特效层(effects/)

**[P0-8] blurradial KERNEL=1 按对称配对采样,总权重 2.0 → 过曝**
- 位置:`blurradial.js:53-64`(核数据 31-35)
- K1 的 4 个偏移被 ± 配对采样且每点乘全值权重,总权重 2×Σw=2.0;K0/K2 配对后均归一 1.0,反证 K1 数据是 7-tap 高斯的**单向**合并采样点(数值拟合与 blur.js:62/godrays.js:96 的 7-tap 权重精确吻合)。
- 修复:KERNEL=1 改 4 个单向采样。

**[P0-9] waterwaves/watercaustics mask UV 缩放沿用已被 §9.2 推翻的 maskW/objW 约定**
- 位置:`waterwaves.js:29-30,44`;`watercaustics.js:37,43`
- `mSx = maskTex.width / tex.width` 与 WE-REVERSE §9.2 裁决(g_TextureNResolution=(mip0,header)→缩放≈1→mask UV=纯 uv)直接矛盾;waterripple 已修(waterripple.js:35 mSx=1),这两个未同步。后果:mask 是对象 1/2 尺寸时只读 mask 左上 1/4 象限拉满全图;动画模式降采样后 mSx 漂移(静态≠动画),mSx>1 时取模平铺 mask 花纹错乱。
- 修复:mSx=mSy=1,与 waterripple 一致(必要时用 header/mip0 比)。

**[P0-10] godrays 调用不存在的 `_gaussPass`,整个特效必然抛错被静默吞掉**
- 位置:`godrays.js:97-98`
- 全插件(9 个 proto installer + node_modules)零定义;被 `effects.js:107` 的 catch 吞掉后原样返回 → godrays 任何场景下输出=原图。拆分自 effects.js 时 helper 未随迁(blur.js:66 有同款局部 gauss 闭包)。
- 修复:抽共享 `this._gaussPass(tex,ox,oy,kernel)` 或内联 7-tap。

### 2.4 GLSL 兜底层(glsl/,第三方 workshop 特效的主路径)

**[P0-11] transpile:for 循环变量声明丢失 + `i++` 递增丢失**
- 位置:`transpile.js:237-241(init)、259-260(stmt default 吞掉 declarator_list)、600-627(postfixExpr 不识别 ++)`
- 实测转译输出:`for (/* stmt declarator_list */; (i < 4); i;)` → 含循环的 shader 首帧 ReferenceError(或死循环)。
- 修复:`stmt()` 补 `declarator_list`;`postfixExpr` 处理 `++/--`。

**[P0-12] transpile:swizzle 表达式 type 沿用 base.type(长度失真)→ undefined/NaN 传染**
- 位置:`transpile.js:608-611`
- `v4.xy` 生成 2 元素却标 vec4,下游按 4 展开取 `[2]/[3]` → NaN。官方 waterripple.frag 默认路径 `vec3(n1.xy+n2.xy, n1.z)` 实测复现整图坏。
- 修复:swizzle 返回 `type:'vec'+sel.length`。

**[P0-13] transpile:多分量 swizzle 复合赋值遇标量 RHS → `__t[i]` 取标量下标 → NaN**
- 位置:`transpile.js:279-289`
- 官方 waterripple.vert 默认路径两处 `v_TexCoordRipple.xz *= rippleTextureAdjustment;`(合法 vec2 *= float)→ 顶点波纹坐标全 NaN。
- 修复:RHS 标量时广播。

**[P0-14] preprocess:parseMeta 非贪婪正则在嵌套花括号元注释处截断**
- 位置:`preprocess.js:10(comboRe)、18(unifRe)`
- `(\{[\s\S]*?\})` 在首个 `}` 截断,含 `"options":{...}` 的元注释 JSON.parse 失败被 `catch {}` 吞 → combo 默认值/material 映射静默丢失。同文件 `parseMetaGL`(74-92,`readBalancedJson`)已修过同一 bug(注释自证 foliagesway/shake 真实发生),`parseMeta` 未回移。
- 修复:改用 readBalancedJson。

**[P0-15] executor:discard 完全失效 + gl_FragColor 跨像素残留**
- 位置:`executor.js:199-204`(联动 transpile.js:254-255 `discard→/*注释*/`)
- discard 后继续执行且每像素必写输出;mask 镂空类特效输出拖影/脏色。
- 修复:discard 发射信号,executor 检测后跳过写入;每像素重置 gl_FragColor。

**[P0-16] executor/integration:采样 wrap 契约缺失,一切纹理恒 clamp**
- 位置:`executor.js:151-157(无 wrap 参数)`;`integration.js:60-62(_texSample(...,true) 硬编码)`
- §9.6:waterripple/normal/mask 均 REPEAT(位移坐标跨 [0,1]),仅主图 CLAMP。法线纹理被 clamp 到边缘 → 波纹静止/整片条纹。
- 修复:sampler 契约加 wrap 参数(g_Texture0 clamp、其余 repeat)。

**[P0-17] executor:g_TextureNResolution 语义与 §9.2 裁决相反**
- 位置:`executor.js:119`
- 返回 `(objW,objH,texW,texH)` —— 恰是 §9.2 判别实验①明确**排除**的约定 (b);lwe 约定应为 `(w,h,w,h)`(header==mip0 时缩放=1)。纹理≠对象尺寸的特效 mask 全错位。
- 修复:`Float32Array.from([w,h,w,h])`。

**[P0-18] integration:g_TextureN 槽位绑定 off-by-one**
- 位置:`integration.js:91、148`
- `u[un] = idx===0 ? img : textures[idx-1]`,注释却写 `textures[N]`。官方材质实锤:`"textures":[null,null,"effects/waterripplenormal"]` ↔ shader `g_Texture2`(water_normal),即 `pass.textures[N] ↔ g_TextureN` **直接对齐**(同库 waterwaves 等也用 `pt[1]` 当 mask=g_Texture1;快照 [null,mask,normal] 下现实现把 g_Texture1 绑 null、g_Texture2 绑 mask)。
- 修复:`u[un] = idx === 0 ? (textures[0] || img) : (textures[idx] || null)`(测试路径 executor.js:217-222 本来就是对的)。

**[P0-19] integration:pkg 内 shader 路径拼接错误,第三方效果永远找不到 shader**
- 位置:`integration.js:14,18,21-28`
- `String(ef.file).split('/')[2]` 对真实场景 `"file": "effects/waterripple/effect.json"` 恒得 `'effect.json'` → 查找 `shaders/workshop/effect.json/effects/<name>.frag`,任何布局都不存在;weAssetsDir 回退只覆盖官方内置效果 → 第三方效果(该层使命)静默 no-op,且查找失败无日志(28 行直接 cache null)。
- 修复:依次尝试 pkg `shaders/effects/<name>.frag` → pkg `effects/<name>/shaders/effects/<name>.frag` → weAssetsDir;首次 miss log 一行。

**[P0-20] integration:纹理派生 combo(MASK 等)从不推导,#if MASK 分支被静默删除**
- 位置:`integration.js:35`(及 15,75,132)
- combos 只来自 `ef.passes[0].combos` + [COMBO] 注释;uniform 尾注 `{"mode":"opacitymask","combo":"MASK"}` 不被 CPU 路径收集(parseMetaGL 有 textureUniform 逻辑,CPU 路径没用)→ 未定义 MASK 按 0 求值无报错 → mask 分支 + vert mask-UV 缩放整体消失。官方语义:绑定 opacitymask 纹理即 MASK=1(GL 路径与 CPU 定制路径 iris.js:24-28 均如此)。
- 修复:编译前按纹理槽非空推导 textureUniform combo 置 '1'。

---

## 三、P1 清单(功能性缺失/特定条件偏差)

### 基础层
| # | 位置 | 问题 |
|---|---|---|
| 1 | math.js:22 | `getVal` 不消费 `{user,value}` 用户属性绑定(v.user 被丢弃),绑定用户属性的 origin/scale/alpha/color 等全部静默用设计器默认 |
| 2 | core.js:534-543 | `_isLiveComponent` 泛词正则(audio/bars/spectrum…)命中即**剔除整个对象**,误杀非音频组件;应只跳过该效果 |
| 3 | core.js:325 / puppet.js:143 | MDL 动画 fps 硬编码 30,fps≠30 的模型播放速度按比例错 |
| 4 | core.js:628-633 | 动画 loop/reverse 的 length 量纲存疑(秒 vs 帧号,若为秒则狂速循环);reverse 实为 ping-pong |

### 特效层
| # | 位置 | 问题 |
|---|---|---|
| 5 | effects.js:100-101 | `blurprecise` 无条件 no-op 且抢在 GLSL 回退之前,该层完全不模糊 |
| 6 | waterripple.js:67-69 | clamp 到 1.0 后仍走 wrap 采样,`u=1.0` 回绕到对边(缺 `clamp=true`) |
| 7 | waterflow.js:53-56 / cloudmotion.js:44 | 主图位移采样 wrap 非 CLAMP(§9.6 基准),边缘 5-10% 宽度带串色 |
| 8 | waterwaves.js:61-64 | 位移采样 `Math.floor` 最近邻,波浪边缘锯齿(官方 LINEAR) |
| 9 | shake.js:39-40 | `Math.round(u*w)` 半像素偏置:零位移时整图平移 1px;改双线性连续 UV |
| 10 | blend.js:20,58,63 | `transformRepeat===1/0` 对 boolean 恒 false → TRANSFORMREPEAT 分支死代码,REPEAT=0 变环绕平铺 |
| 11 | depthparallax.js:23 | 未接入 `this.optsMouse`(GLSL 路径已接 integration.js:85),交互视差恒居中;且 optsMouse 两处格式不统一({x,y} vs 数组) |
| 12 | blurradial.js:69 | MASK 采样缺 maskRes/对象Res 缩放(与 blur.js:115 等库内 8 处不一致) |
| 13 | skew.js:23-24 | REPEAT=0 时未 clamp,越界 UV 仍环绕 |
| 14 | lightshafts.js:70-71 | RAYMODE(Linear/Radial/Corner)/RENDERING(Color/Gradient) combo 完全未实现 |
| 15 | glitter.js:28 | 噪声纹理硬编码 util/perlin_256,场景自配 Noise(p0.textures)被忽略 |
| 16 | godrays.js:64,69,96 | CASTTYPE(radial/directional)/QUALITY/KERNEL/COPYBACKGROUND 未读,30 采样+仅 radial 硬编码 |
| 17 | filmgrain.js:7,12,31 | GREYSCALE/MASK 只判 `===1`,字符串 combos 场景失效(库内其余 5+ 处均双兼容) |
| 18 | iris.js:59,70 | 位移采样 REPEAT,未跟 §9.6 CLAMP(边缘 1-2px) |
| 19 | image.js:320,366 | swayimage/flag 主纹理位移采样 wrap 非 CLAMP(§9.6) |

### 场景对象层
| # | 位置 | 问题 |
|---|---|---|
| 20 | camera.js:259 | 光源筛选 `o.light`,逆向结论是 `shape:"light"`(§4);lights 为空时 3D 场景只剩 ambient 偏暗 |
| 21 | camera.js:100,205-206 | 相机接管条件 `eye==(0,0,0)` vs 解析默认 `(0,0,1)` 矛盾,未写 eye 的场景相机对象运镜被忽略 |
| 22 | puppet.js:63-83 | renderPuppet 完全忽略 tr.angle(含父链累积角);被旋转父级挂载的 puppet 不转 |
| 23 | particles.js:175-177 | 多发射器共用 sys.acc,发射率 ≈ N×Σrate 放大 |
| 24 | particles.js:267+ | p.rot 维护了但绘制从不使用,旋转粒子(落叶/雪花)不翻转 |
| 25 | bloom.js:180-206 | hdr 亮部通道无条件计算并与 bright 相加,LDR 场景辉光约 2 倍 |
| 26 | jpeg.js:70-77,129-133 | RST 标记从不跳过(consumeRestart 不前进 pos),带 DRI 的 JPEG 自首个 RST 起解码全错 |
| 27 | jpeg.js:445 | 灰度 JPEG 无条件 `getPlane(1,...)`,Cb 缺 `planes.length>2` 式守卫 → 整张纹理丢弃 |

### GLSL 兜底层
| # | 位置 | 问题 |
|---|---|---|
| 28 | transpile.js:509-516 | reflect/refract/any/all/lessThan 等未收录内建生成裸调用 → ReferenceError |
| 29 | transpile.js:17-18 vs runtime.js:208-221 | BUILTIN 声明 texture2DLod/floatBitsToInt/intBitsToFloat 但 runtime 未实现 → TypeError |
| 30 | transpile.js:429-449 + common.h:10 | `#define mul(v,m) ((v)*(m))` 使 vec×mat 走逐分量乘,行向量积 __rt.mul 永不可达 → 射影变换全错 |
| 31 | transpile.js:174-184 | 标量 out/inout 参数不回写调用方 |
| 32 | transpile.js:254-255 | discard 语义丢失(与 P0-15 联动) |
| 33 | transpile.js:455-457 | vec 的 `==`/`!=` 生成 `===`/`!==`(引用比较)恒 false |
| 34 | transpile.js:450,461 | int/int 除法不截断、`%` 直通 JS %(GLSL floor-mod) |
| 35 | transpile.js:204-214 | 声明不按声明类型截断(P0-12 放大器) |
| 36 | preprocess.js:43-44 | 缺失/解析失败 include 被静默删除,CPU 路径无 GL 路径的 422 预检 |
| 37 | preprocess.js:35 | 注释内 `#include` 被当真指令展开(无行首锚定) |
| 38 | executor.js:84-97 | 缺失 uniform 不落 default → undefined 参与运算 → NaN 全图 |
| 39 | executor.js:168 | vert 角点 a_Position 恒 [0,0,0],依赖它的 varying 退化为常数 |
| 40 | runtime.js:117-120 | atan 双参向量重载返回 NaN |
| 41 | runtime.js:48-49 | mix(标量,标量,向量 t) 返回长度 1 |
| 42 | integration.js:157-160 | 渲染失败 catch 引用未声明 `name` → ReferenceError,回退分支不可达(真实错误被 effects.js 兜底吞掉) |
| 43 | integration.js:75,132 | 多 pass 只执行 passes[0],pass 1..N 全丢;g_EffectComposited/g_OutputTexture 正则不匹配落到 idx=0 绑 img |
| 44 | integration.js:76-86 | 缺失材质参数无 default 兜底(shader 注释 default 被 parseMeta 丢弃)→ uniform undefined → NaN |
| 45 | integration.js:28 | shader 查找失败完全静默(cache null 无日志),与 P0-19 复合后第三方效果无声消失 |

---

## 四、横切主题(多组发现共同指向)

1. **拆分丢 helper**:godrays `_gaussPass`、pulse `_createAudioResponse` 全库零定义 —— 从 effects.js 拆文件时闭包未随迁,catch 吞错后表现为"该特效无声无息没效果"。建议补一条回归规则:效果目录拆分后必须跑一次逐效果烟测。
2. **mask UV 缩放三种写法互相矛盾**:`maskW/objW`(tint/glitter/godrays/filmgrain/waterwaves/watercaustics/blurradial)、无缩放(shimmer)、`uv 直采`(waterripple/clouds/cloudmotion)。§9.2 裁决支持第三种;sf39i/j 的"mask 宽/对象宽"是对官方 vert `z *= maskRes.z/x` 的误读。建议以官方 vert 源逐一核对后统一,并在 WE-REVERSE 补一条定论。
3. **wrap 语义混乱**:§9.6 已定"主图位移采样 CLAMP、位移类纹理(mask/normal/noise)REPEAT",但 CPU 原生特效多处主图 wrap(waterflow/cloudmotion/sway/flag/iris/skew),GLSL 层又反向全 clamp(P0-16)。建议把 wrap 决策收进 `_texSample` 的调用约定或一个 sampler 配置。
4. **combos 值兼容性**:scene.json 里 combo 可能是字符串或数字,库内两种写法并存(`===1` vs 双兼容);`||` 取默认还会吞显式 0(pulse/filmgrain BLENDMODE)。统一 `!= null ? Number(x) : 默认`。
5. **静默失败**:`catch {}` 吞错 + 无效果名日志贯穿 preprocess/integration/effects;GLSL 失败回退原图是设计,但连"为什么回退"都不可见。建议统一日志通道带效果名与失败原因。
6. **每像素堆分配**:`_texSample` 每次返回新数组、applyBlending 内部 .map 链、GLSL runtime 每个 vec 运算 `new Float32Array` —— 4K 全屏每帧千万级短命对象,是"特效卡顿"的直接诱因。建议热路径标量化 + 预分配 scratch。

---

## 五、P2 精选(隐患/性能/死代码)

- canvas.js: blitRotated 镜像时边缘列被跳过(应 clamp 非 continue);blendMode 分支与普通分支 alpha 归一不一致;PNG colorType 4(灰度+alpha)按 4 通道读成花屏、interlace 未检测;crc32 表每次重建
- core.js: resolveTransform 父链 origin.z 清零;render() 双重全屏 clear;_downsample 直通 RGBA 平均产生半透明晕边;objects.find O(n²)
- image.js: 旋转分支提前 return 跳过视差与 colorBlendMode;usershadervalues 被 constantshadervalues 覆盖(顺序反了);_customShaders getter 每次新建 Set;retro 切口条件恒真(疑抄错方向)
- particles.js: 每帧从 t=0 全量重模拟(particleCache 死代码);spritesheet 帧宽 `f.width || fr.count>0 ? A : B` 运算符优先级错
- camera.js: 相机对象 zoom 只接入正交分支
- puppet.js/mdl.js: MDLA 帧循环 `% frameCount` 与"段内 frameCount+1 帧"注释矛盾;mdl.js 公开副本缺 puppet.js 版的顶点合理性校验(同一 bug 可经导出入口复发)
- model.js: `_texSample` wrap 分支边界不做环绕插值(x1 应 `(x0+1)%w`);3D 光栅化法线/世界坐标未透视校正(UV 做了)
- glsl/transpile.js: var 函数级作用域污染嵌套同名;simple 内联文本复制使一次 texSample2D 膨胀 8 次调用(实测);本地构造 mat 是普通数组却按 Float32Array 索引;mat3(m4) 得长度 1 的"矩阵";gl_Position 隐式全局;uniform 缺失静默 undefined
- glsl/executor.js+runtime.js: M_PI_2=6.283(2π,与 common.h π/2 矛盾);step/smoothstep 宽松重载错误;每像素分配无复用;动态循环无护栏;makeSampler/makeVarying 死代码
- glsl/integration.js: `_applyGlslEffect` 定义两次(65-104 死副本,P1-42 的丢参错误正源于复制);include 解析顺序颠倒(weAssetsDir 优先于 pkg 本地,与全库 pkg 优先约定相反)且不回退内置 glsl/common.h stub;动画帧 256×256 最近邻放大致 mask 块状化
- shimmer.js: `timeoffsetScale` 是全 effects 58 个 uniform 键中唯二含大写者(官方 material 键全小写,疑永远取默认);ApplyBlending 的 B 参数疑双重作用

---

## 六、修复优先级建议

1. **第一批(主路径,所有壁纸立刻受益)**:P0-2 blitScaled 双线性、P0-3 负尺寸镜像、P0-1 blitRotated 方向、P1-1 getVal user 绑定。
2. **第二批(特效正确性)**:P0-10 _gaussPass、P0-8 blurradial K1、P0-9 waterwaves/caustics mask(连同 §四.2 统一)、P0-4/5/6 粒子三连、P0-7 image quad v 轴、P1-11 depthparallax 接 optsMouse。
3. **第三批(GLSL 兜底)**:P0-19 shader 路径、P0-20 MASK 派生、P0-18 槽位 off-by-one、P1-45 查找失败日志、P1-42 name ReferenceError(先恢复可观测性,再修 P0-16 wrap 参数化、P0-17 Resolution 语义、P0-11/12/13 转译器三连、P0-14 parseMeta 回移 readBalancedJson、P0-15 discard、P1-38/44 uniform 默认值、P1-43 多 pass)。
4. **第四批**:P1 表余项 + P2 清理(combo 兼容统一、wrap 统一、热路径标量化、日志可观测、死副本删除)。
5. 每批修复后跑 `test/scene-gl-e2e` 对照 + 建议补逐效果 CPU 烟测(防拆分丢 helper 复发)。

---

## 七、评审覆盖面与已确认无异常

- **逐文件全覆盖**:core/canvas/math/textures、model/puppet/camera/particles/bloom/mdl/image/text/jpeg、effects.js + 24 个特效、glsl 全部 7 文件。
- **重点核对通过项**(节选):骨骼蒙皮行向量链与 §5.5 一致;动画层合成/additive 参考姿势与 §6.1 一致;attachment/MDAT 锚点与 §8 一致;viewShift 与 §3.5 定论一致;角度弧度直读与 §9.4 一致;applyBlending 模式 1-19/21-29 与标准公式逐一吻合(blur 4-pass 链、swing、foliagesway、scroll、opacity、tint、clouds、cloudmotion、waterflow、waterripple 主体数学对照官方快照/注释无误);iris.js 对照官方快照逐行一致;common.h/common_perspective.h 数学复刻经独立重推导正确;squareToQuad/inverse3 与官方头逐行一致。
- **完全未发现问题**:textures.js、tint.js、scroll.js、iris.js(以及 swing/foliagesway/opacity 除横切项外)。
- **评审局限**:官方 shader 源(除 iris/waterripple 快照)不可得,涉及未快照效果的"官方行为"条目已标"推测";静态评审未做渲染对照,建议修复前用官方 preview.gif 或实机截图做 MAD 对比。

## 附录:评审分工

| 模块 | 文件 |
|---|---|
| 基础核心层 | core.js、canvas.js、math.js、textures.js |
| 场景对象层 | model.js、puppet.js、camera.js、particles.js、bloom.js、mdl.js、image.js、text.js、jpeg.js |
| 水系特效+分派 | effects.js、waterwaves/waterflow/waterripple/watercaustics/clouds/cloudmotion |
| 光系特效 | godrays/lightshafts/glitter/shimmer/iris/pulse/tint/filmgrain |
| 变换模糊系 | blur/blurradial/scroll/skew/swing/shake/foliagesway/depthparallax/opacity/blend |
| GLSL 转译器 | transpile.js |
| GLSL 预处理+公共头 | preprocess.js、common.h、common_perspective.h |
| GLSL 执行器+运行时 | executor.js、runtime.js |
| GLSL 集成层 | integration.js |
