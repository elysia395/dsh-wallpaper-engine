# WE-Renderer 二次审查报告(对两轮评审的逐条复核)

> 日期:2026-08(本轮)
> 对象:`docs/we-renderer-review.md`(P0-1..20 / P1-1..45 体系)与
> `docs/review/00-REVIEW-SUMMARY.md` + 分片 01-06(BASE/IMG/MOD/GLS/WAT/LGT 体系)
> 中的**全部 finding**,逐条判定真实/需确认/误报/已修复。
>
> **复核方法(两层)**:
> 1. 6 个模块复核代理逐条核对源码、对数值/逻辑类断言用 node 独立复现
>   (for 循环转译、权重和、运算符优先级、parseMeta 截断等);
> 2. 本报告作者**亲自**复核:全部 P0/P1 finding 逐行读码确认,
>   关键 P0 另做独立 node 复现(for 循环编译失败、下标丢失、swizzle 复合赋值
>   NaN、swizzle 长度失真、parseMeta 嵌套截断、_gaussPass 零定义、
>   blitScaled 负尺寸塌缩、K1 权重 2.0、g_Bones 矩阵顺序),
>   P2/P3 按模块抽查(抽查 30+ 条全部与证据吻合)。
>
> **复核基线(重要)**:当前工作树含一批**未提交**修正(git diff:
> shake/waterwaves/foliagesway/swing/blur/depthparallax/filmgrain/opacity/
> preprocess.js,即 sf35 系列),两份评审文档本身未入库。
> 凡引用行号以当前工作树为准;评审后已被修复的条目标 🔧。

## 判定图例

- **✅ 真实**:代码证据确凿(多数经 node 复现),问题成立
- **⚠️ 需确认**:机制确凿但影响面依赖运行时输入/场景数据,或"官方行为"无源可考
- **❌ 误报**:finding 对代码理解有误(给出反驳证据)
- **🔧 已修复**:评审所述问题在当前工作树已不存在

---

## 一、总结论

两份评审的**核心发现几乎全部属实**,且两轮独立评审互为印证的结论
(godrays `_gaussPass`、blurradial K1、GLSL for 循环/下标、粒子三连、
blitScaled 负尺寸、mask UV)本轮全部再次确认。P0 级 **0 误报**。

发现的偏差集中在少数 P1/P2:
- **误报 2 条**:P1-12(方向弄反)、P1-23(机理误读,但底层另有真 bug);
- **已修复 6+ 条**:shake 三项(P1-9/WAT-01/WAT-05)、P0-9 之 waterwaves 半、
  WAT-04 的 4/5、LGT-08 的一半成员(filmgrain/opacity/blur/depthparallax
  已随 sf35 改纯 uv);
- **若干 ⚠️**:机制真实但触发面窄或依赖官方行为定论(详见分模块表)。

### 统计(we-renderer-review.md 体系)

| 级别 | 总数 | ✅ | ⚠️ | ❌ | 🔧 |
|---|---|---|---|---|---|
| P0 | 20 | 19 | 1(P0-9 半修复) | 0 | 0 |
| P1 | 45 | 39 | 3(P1-2/3/4) | 2(P1-12/23) | 1(P1-9) |
| P2(§五) | ~30 | 绝大多数 ✅ | 少数 | 0 | 0 |

### 统计(00-REVIEW-SUMMARY 体系)

| 级别 | 总数 | 结论 |
|---|---|---|
| P0 | 7 | 全部 ✅(LGT-01/02、MOD-21/22/23、GLS-01/02) |
| P1 | 28 | 全部 ✅ 或 ✅(附注) |
| P2/P3 | ~148 | 绝大多数 ✅;⚠️ 约 15 条(依赖官方源/运行时输入);🔧 约 6 条 |

---

## 二、P0 逐条判定(20/20 复核)

| ID | 判定 | 复核证据(本轮) |
|---|---|---|
| P0-1 blitRotated 方向反 | ✅ | `canvas.js:95` `cos(-angle)` 逆映射 → 内容 R(+a),y-down 呈顺时针;注释自称"逆时针",WE-REVERSE §9.4 官方=逆时针 |
| P0-2 blitScaled 伪双线性 | ✅ | `canvas.js:55,59` `Math.round` 最近邻,`:44` 注释称 bilinear;同文件 blitRotated 118-133 是真双线性 |
| P0-3 blitScaled 负尺寸塌缩 | ✅ | `canvas.js:49-60` flipX 时 `srcOffX=-img.width` → clamp 钉 0 → `sx=w-1` 恒定垂直色带;flipY 无镜像语句 |
| P0-4 正交粒子缺 origin | ✅ | `particles.js:222` scenePos 无 `sys.origin`(像素路径 230 有),`:436-437` 绘制未加 |
| P0-5 maxcount 累计封顶 | ✅ | `particles.js:179` 门限、`:182` `count++`、死亡 splice(190)从不 `--` |
| P0-6 初速恒 0 | ✅ | `particles.js:126-128` 解析弃用、`:223` `vel:[0,0,0]`,代码注释自认"暂不实现" |
| P0-7 全屏 quad v 轴反 | ✅ | `image.js:16-17,24` v=0 配 NDC y=-1 → 画布底;§9.1 官方 v=0 在图顶 |
| P0-8 blurradial K1 权重 2.0 | ✅ | `blurradial.js:31-35,53-64` K1 四向单向合并核(Σw=1.0)被 ± 配对采样 → 总重 2.0;K0/K2 配对后恰 1.0 反证;权重与 blur.js:62/godrays.js:96 的 7-tap 相邻对之和精确吻合 |
| P0-9 mask UV 与 §9.2 矛盾 | ⚠️ 半修复 | waterwaves.js:29 已 `mSx=1`(🔧);**watercaustics.js:37 仍 `maskTex.width/W`** → 此条对 watercaustics 仍 ✅ |
| P0-10 godrays _gaussPass 丢失 | ✅ | `godrays.js:97-98` 调用,全库零定义(grep);git 考古 `684fb0a` 拆分时丢定义留调用;`effects.js:107` catch 吞错(log 为 no-op)→ godrays 从未渲染一帧 |
| P0-11 for 循环编译失败 | ✅ | `transpile.js:238-241`;独立 node 复现:输出 `for (/* stmt declarator_list */; (i < 4); i;)` → `new Function` 抛 `Unexpected token ';'` |
| P0-12 swizzle 长度失真 | ✅ | `transpile.js:608-611` 多分量 swizzle `type: base.type`;复现:`c.xyz*2.0` 展开 4 分量 `[...][3]=undefined` → NaN;`vec3 w=...` 得 4 元素 |
| P0-13 swizzle 复合赋值 NaN | ✅ | `transpile.js:279-289`;复现:`var __t0 = adj; tc[0] *= __t0[0];` 标量取下标 → undefined → NaN |
| P0-14 parseMeta 嵌套截断 | ✅ | `preprocess.js:10,18` 非贪婪正则;复现:嵌套 options → combos `{}`、range → material:null;parseMetaGL 已用 readBalancedJson 修复,**parseMeta 未回移** |
| P0-15 discard 失效+残留 | ✅ | `transpile.js:254-255` → 注释;`executor.js:183,199-204` gl_FragColor 模块级复用、无 discard 信号、无逐像素重置 |
| P0-16 采样恒 clamp | ✅ | `integration.js:60-62` `_glslSample` 硬编码 `true`,与 §9.6(主图 CLAMP/位移类 REPEAT)相反;注释"GL 默认=clamp"本身错误(GL 默认 REPEAT) |
| P0-17 resolution 语义反 | ✅ | `executor.js:119` 返回 `(objW,objH,texW,texH)` = §9.2 判别实验①明确排除的约定 (b) |
| P0-18 纹理槽 off-by-one | ✅ | `integration.js:91,148` `textures[idx-1]`;官方水 ripple 材质 `[null,null,normal]` 下 g_Texture2 绑到 null;executor.js:217-222 测试路径用 `textures[idx]`(正确),两处不一致 |
| P0-19 pkg shader 路径错 | ✅ | `integration.js:14` `split('/')[2]` 对 `effects/waterripple/effect.json` 得 `effect.json` → 拼出 `shaders/workshop/effect.json/...` 永不命中;失败静默(28 行) |
| P0-20 纹理派生 combo 丢失 | ✅ | `integration.js:35` 只读 `passes[0].combos`;`parseMeta` 丢 mode/combo 字段(parseMetaGL 有 textureUniform 推导)→ MASK 恒 0 |

**P0 结论:20 条全部成立(P0-9 一半已被 sf35 修复)。无一条误报。**

---

## 三、P1 逐条判定(45/45 复核)

### 3.1 ✅ 确认真实(39 条)

| ID | 一句话 | 关键证据 |
|---|---|---|
| P1-1 | getVal 丢弃 {user,value} 用户绑定 | `math.js:19-24`;`_isVisibleSelf`(core.js:502-508)单独解析 user 反证缺口 |
| P1-5 | blurprecise 无条件 no-op 且阻断 GLSL | `effects.js:100-101` 空分支在 `_applyGlslEffect`(105)之前 |
| P1-6 | waterripple clamp 后仍 wrap 采样 | `waterripple.js:67-69` clamp 到 [0,1] 后 `_texSample` 未传 clamp,uu=1.0 回绕左缘 |
| P1-7 | waterflow/cloudmotion 主图位移 REPEAT | `waterflow.js:53-56`、`cloudmotion.js:44` 均无 clamp 参,违 §9.6 |
| P1-8 | waterwaves 位移最近邻 | `waterwaves.js:60-61` `Math.floor` 单像素取 |
| P1-10 | blend transformRepeat 与 boolean 比恒 false | `blend.js:20` boolean vs `:58` `===1`/`:63` `===0` 双死分支 |
| P1-11 | depthparallax 不接 optsMouse;两处格式不一 | `depthparallax.js:23` 只读 csv;`integration.js:85` 用 `.x`、`camera.js:253` 用 `[0]` |
| P1-13 | skew REPEAT=0 未 clamp | `skew.js:14,23-24` 不 frac 但 `_texSample` 默认 wrap |
| P1-14 | lightshafts RAYMODE/RENDERING 未实现 | `lightshafts.js:71` 仅读 BLENDMODE,头注释自限 MODE=0 |
| P1-15 | glitter 噪声纹理硬编码 | `glitter.js:28` 恒 `util/perlin_256`,场景槽位未读 |
| P1-16 | godrays CASTTYPE/QUALITY/KERNEL/COPYBACKGROUND 未读 | `godrays.js` 全文件无读取点,cast 恒径向 30 采样 |
| P1-17 | filmgrain GREYSCALE/MASK 只判 ===1 | `filmgrain.js:7,12,30`;字符串 "1" 时双双失效(库内其余文件均双兼容) |
| P1-18 | iris 位移采样 REPEAT | `iris.js:59,70` 无 clamp 参 |
| P1-19 | sway/flag 主纹理位移 REPEAT | `image.js:320,366` 无 clamp 参 |
| P1-20 | 光源筛选用 o.light 而非官方分类 | `camera.js:259`;§4 官方光源为 `shape:"light"` |
| P1-21 | 相机接管条件与解析默认矛盾 | `camera.js:100` 默认 (0,0,1) vs `:206` 门限全 0 → 永不接管 |
| P1-22 | renderPuppet 忽略 tr.angle | `puppet.js:7-84` 无 angle 读取 |
| P1-24 | p.rot 模拟但绘制不读 | `particles.js:270,318` 写;`_drawParticles`(418-529)零读取 |
| P1-25 | bloom HDR 通道无条件叠加 | `bloom.js:41-59` 无条件构建,`:75` 恒 `blur+blurHdr`;feather=0 → 除 0.001 硬阶跃 |
| P1-26 | jpeg RST 不跳过 | `jpeg.js:70-77` pos 回退,`consumeRestart:129-133` 不前进 → 卡死 |
| P1-27 | jpeg 灰度 Cb 无守卫 | `jpeg.js:445`(Cr 有 `:446` 守卫)→ TypeError → 纹理丢弃 |
| P1-28 | reflect/refract/any/all 等未收录 | `transpile.js:12-19` BUILTIN 缺 → 裸调用 ReferenceError |
| P1-29 | BUILTIN 声明但 runtime 未实现 | `transpile.js:17-18` vs `runtime.js:208-222` 无 texture2DLod 等 |
| P1-30 | `#define mul` 使 vec×mat 逐分量/NaN | `common.h:6` 宏展开后 `((v)*(m))`;`transpile.js:429-449` vec 分支先命中 |
| P1-31 | 标量 out/inout 不回写 | `transpile.js:175-181` 仅 vec/mat 做 slice |
| P1-32 | discard 语义丢失 | `transpile.js:254-255`(= P0-15 转译侧) |
| P1-33 | vec ==/!= 生成 === 恒 false | `transpile.js:455-457` 引用比较 |
| P1-34 | int/int 不截断、% 直通 | `transpile.js:450,461`;负操作数 % 与 GLSL floor-mod 分歧 |
| P1-35 | 声明不按类型截断(P0-12 放大器) | `transpile.js:204-214` 无截断;`vec3 w = vec4值` 得 4 元素 |
| P1-36 | include 缺失静默删除 | `preprocess.js:43-44`;GL 路由(index.js:3081+)有 stub 回退,CPU 无 |
| P1-37 | 注释内 #include 被展开 | `preprocess.js:35` 无行首锚定 |
| P1-38 | 缺失 uniform 不落 default | `executor.js:84-97` 跳键 → undefined;parseMeta 丢 default 字段 |
| P1-39 | vert 角点 a_Position 恒 0 | `executor.js:168` 四角全 `[0,0,0]` |
| P1-40 | atan 双参向量重载 NaN | `runtime.js:117-120` `Math.atan2(vec,vec)` |
| P1-41 | mix(标,标,vec t) 返回长度 1 | `runtime.js:48-49` n=max(len(a),len(b))=1 |
| P1-42 | catch 引用未声明 name → ReferenceError | `integration.js:130,158` 第二副本丢参;回退分支不可达 |
| P1-43 | 多 pass 只执行 passes[0] | `integration.js:75,132` 无 pass 循环 |
| P1-44 | 材质参数无 default 兜底 | 同 P1-38(parseMeta 丢 default) |
| P1-45 | shader 查找失败静默 | `integration.js:28` 无日志缓存 null |

### 3.2 ⚠️ 需确认(3 条)

| ID | 判定理由 |
|---|---|
| P1-2 _isLiveComponent 误杀 | **机制确凿**:`core.js:540` 泛词正则 + `:581` 剔除整个对象(应只跳该 effect);但命中面依赖实际 effect 目录名,且该启发式已被文档化为有意为之(01 分片 KNOWN#6)。修法明确(改为 per-effect 跳过),误杀面需场景数据裁定 |
| P1-3 MDL fps 硬编码 30 | 硬编码确凿(`core.js:325`、`puppet.js:130`);"fps≠30 模型播放速度错"需官方 MDL 自带帧率元数据为前提,静态无法实证 |
| P1-4 动画 loop/reverse 量纲 | `core.js:630-633` reverse 实为 **ping-pong**(确凿,node 实测三角波);length 量纲(帧 vs 秒)§5.1 无定论,不能判 bug |

### 3.3 ❌ 误报(2 条)

| ID | 反驳证据 |
|---|---|
| P1-12 blurradial MASK 采样"缺缩放、与 blur.js:115 等 8 处不一致" | **前提错误**:`blurradial.js:69` 与 `blur.js:115` 都是纯 uv 采样,二者一致;且按 §9.2 裁决(缩放≡1 → mask UV=纯 uv)该写法**恰好正确**。finding 把裁决方向弄反了 |
| P1-23 多发射器共用 sys.acc "发射率 N×Σrate 放大" | **机理误读**:node 实测 2×rate10/1s 总发射恰 20(=Σ),无放大;共享 acc 的 floor 只提取合并整数部分。但底层确有**不同的真 bug**:发射归属错配——跨整数边界时由循环中靠后的发射器独占记账,低速率前序发射器被饿死(见 §七 新增 F-2) |

### 3.4 🔧 已修复(1 条)

| ID | 现状 |
|---|---|
| P1-9 shake 半像素偏置 | `shake.js:52` 已改连续 UV + 双线性(sf35),`Math.round` 已删除;同修的还有 WAT-01(+1px)与 WAT-05(位移单位 ×w/×h) |

---

## 四、00-REVIEW-SUMMARY 体系复核

### 4.1 P0(7 条)——全部 ✅

LGT-01(=P0-10)、LGT-02(`pulse.js:39` `_createAudioResponse` 同 commit 丢失;
无频谱时 pulse=0 → PULSEALPHA 整层透明,双失效模式成立)、
MOD-21(=P0-5)、MOD-22(=P1-24)、MOD-23(`particles.js:455`
`f.width || fr.count > 0 ? …` 优先级丢 f.width,node 300→125)、
GLS-01(=P0-11)、GLS-02(下标 `v[0]`→`v`,独立复现 `var a = v;`;
shaderfrog 7.0.1 下标节点为 quantifier 而转译器查 'index')。

### 4.2 P1(28 条)——全部成立(附注 3 条)

BASE-01(=P0-3)、BASE-02(brightness 乘在 alpha 上,`image.js:131-132,176,191`
+ `canvas.js:62`;>1 时 Uint8 回绕)、BASE-03(`image.js:130,144` fullscreen
size=[W,H] 再乘 ps 二次放大)、IMG-01(=P0-7)、IMG-02(=P1-25;代码事实确凿,
"官方应门控 HDR 通道"为推断)、MOD-01(g_Bones `final×bindInv` 顺序反,
`puppet.js:173`;node 顶点 (11,0)→(0,11),正确 (10,1))、MOD-13(无近平面裁剪,
`model.js:194,200` NaN 深度穿过 z-test)、MOD-24(=P0-4)、MOD-33/34(font-render
每字形按自身 bbox 缩到满 size `font-render.js:388-389`、逐字形垂直居中 `:458`)、
GLS-03(mat×vec NaN、mat×mat 逐分量、mul 宏把正确路径也废掉)、GLS-04(=P0-18)、
GLS-05(=P0-17)、GLS-06(=P0-14)、LGT-03(=P0-8)、LGT-04(`godrays.js:113`
alpha 相加未 clamp,0.8+0.6→Uint8 存 101)、LGT-05(=P1-10)。

### 4.3 骨架/木偶(puppet)专项——逐条判定

粒子(P0-4/5/6、P1-24、F-2)已在正文列出;骨架类 finding 集中在此补全:

| ID | 判定 | 一句话 | 关键证据 |
|---|---|---|---|
| MOD-01 | ✅ | g_Bones 合成顺序反(final×bindInv 应为 bindInv×final) | `puppet.js:173`;node 顶点 (11,0)→(0,11),正确 (10,1);旋转骨骼绕模型原点公转 |
| MOD-02 | ✅ | bindWorld 父链与 _sampleAnimRT 链法不一致 | `puppet.js:119`(`_matMulRow(bindWorld[parent],local)`,平移=Rz(子角)·父t+子t)vs `:229-230`(平移=父t+Rz(父角)·子t);父绑定旋转≠0 时两实现分歧(node 实测 (10,5) vs (5,0)) |
| P1-22 | ✅ | renderPuppet 忽略 tr.angle(puppet 不随对象旋转) | `puppet.js:7-84` 无 angle 读取 |
| P1-3 | ⚠️ | 骨骼动画 fps 硬编码 30 | `puppet.js:130,143`、`core.js:325`;偏差前提(fps≠30 模型存在)待官方元数据实证 |
| MOD-04 | ✅ | fps 30 + `0xF0 0x41` 魔数扫描脆弱(扫到不读 fps 浮点) | `puppet.js:382-384` |
| MOD-05 | ✅ | MDLA 9 浮点交错布局自相重叠:float5 被 bone2.pos.y 与 bone0.rot.x 同读;b=31 时 pos/rot 帧相差 7 | `puppet.js:211-221`(代码自述布局下冲突成立;真实布局可能不同,需实测模型裁定) |
| MOD-06 | ✅ | 单骨畸形 `catch{bones=[]}` 丢弃全部骨骼;64B 读取无越界检查 | `puppet.js:364`、`:357`(循环条件仅 p+12<len) |
| MOD-07 | ✅ | 动画层合成逻辑三份拷贝(renderPuppet/_skinPuppet/core.js `_puppetBoneFinal`) | `puppet.js:29-56,139-165`、`core.js:311-358` |
| MOD-08 | ✅ | core.js:18 死导入 mdl.js;mdl.js 公开副本缺 isFinite/\|v\|≤1e6/索引范围校验 | `mdl.js:7-38` vs `puppet.js:293-314` |
| MOD-09 | ✅ | 蒙皮 final 每骨仅 {angle,tx,ty},骨骼缩放与 Z 轴丢失 | `puppet.js:129,153-155,161-163` |
| MOD-11 | ✅ | 退化网格 _meshBounds ±1e9 → W 非有限 new Uint8Array 抛错(被外层吞);巨尺寸触发 isBg 误判丢视图平移 | `puppet.js:568-575,63-65,74`、`camera.js:280` |
| MOD-12 | ✅ | 锚点上限 64,第 65+ 静默丢弃(attachment 返回 [0,0]);每帧重算完整 FK | `core.js:290`、`:361-416` |
| MOD-13 | ✅ | 3D 光栅化无近平面/w≤0 裁剪,NaN 深度穿过 z-test 写垃圾 | `model.js:194,200`(NaN>=x 为 false) |
| MOD-14 | ✅ | model 对象 alpha/brightness 从不应用 | `model.js:7-92` 无 `getVal(o,'alpha')` |
| MOD-15 | ✅ | `_texR`/`_texA` 缺 isFinite 守卫(NaN UV → rgba[NaN] → 写 0) | `model.js:646-674`(对照 `_texSample:679` 有守卫);同族遗漏见 F-3 |
| MOD-16 | ✅ | 无法线网格位移计算两遍(41-47 算法线、59-63 主循环) | `model.js:41-47,59-63` |
| MOD-17 | ✅(证据修正) | 3D 路径恒 wrap(model.js 全部 2 参 `_texSample` 调用) | 支撑句"无任何调用传 true"失准(blur/godrays/integration 传 true),实质结论不变 |
| MOD-18 | ⚠️ | 正交 model 用中心原点投影 vs image 左下定位,两种约定并存 | `camera.js:231` vs `image.js:137-145`;需一次实渲染裁定 |
| MOD-19 | ✅ | flowimage layers 过滤在 flowIdx≠0 时静默丢弃 textures[0] | `model.js:279` |
| MOD-20 | ⚠️ | core vert/frag 动画项数学不一致(旋转 UV vs 未旋转 UV+1) | `model.js:100` vs `:482`;官方源不可得,待证 |

### 4.4 P2/P3 抽样与偏差

抽查 30+ 条全部与证据吻合。需要修正/注意的:

| 条目 | 判定 | 说明 |
|---|---|---|
| WAT-01/WAT-05(shake) | 🔧 | sf35 已修(见 P1-9) |
| WAT-04 mask UV 5 文件 | 🔧 4/5 | 现仅 watercaustics.js:37 仍违 §9.2 |
| LGT-08 mask UV 成员清单 | ⚠️ 半过时 | opacity/filmgrain/blur/depthparallax 已随 sf35 改纯 uv;**仍违者:godrays.js:16-17、glitter.js:26-27、tint.js:15-16、blend.js:28-29** |
| MOD-17 3D 恒 wrap | ✅(证据修正) | 结论对,但"无任何调用传 true"失准:blur/godrays/integration 均传 true;实质是 model.js 3D 路径全部 2 参调用 |
| MOD-28 alphafade 分数 vs 秒 | ⚠️ | 代码用寿命分数确凿;官方语义无源,且与 sizechange 等口径一致,"异类"论据不充分 |
| BASE-27 LZ4 未硬化 | ⚠️(主体真) | "无 MAX 上限检查"子句失准(1520-1521 已有);blocksX/Y 缺 ceil 属实 |
| BASE-30 NaN 传播 | ⚠️(主体真) | 附注"NaN 是 truthy"错误(NaN 是 falsy,`NaN||0===0`);主 claim 成立 |
| WAT-03 smoothstep NaN | ⚠️ | 机制真(math.js:205 无守卫),但需 x 恰等于 e0==e1 点,"缺失纹理即触发"夸大 |
| IMG-09/IMG-16/IMG-20、MOD-18/20、WAT-06/09/10/11/15/18/20、BASE-04/25/31 | ⚠️ | 代码事实均核实无误;与官方偏差需官方 shader 源/实机对照(评审已自标) |
| P2 step/smoothstep 宽松重载 | ⚠️ | 合法 GLSL 重载实测均正确,问题仅是非法调用被静默接受 |

---

## 五、横切主题复核(we-renderer-review §四)

| 主题 | 判定 | 备注 |
|---|---|---|
| 1. 拆分丢 helper(_gaussPass/_createAudioResponse) | ✅ | git `684fb0a` 实证;建议加"拆分后公共方法 grep"回归 |
| 2. mask UV 三种写法 | ⚠️ 已大幅收窄 | 现仅剩 **watercaustics.js:37**(maskW/objW)与 **godrays/glitter/tint/blend**(maskRes/objRes)两组违 §9.2;评审清单中 filmgrain/opacity/blur/depthparallax/blurradial/waterwaves/foliagesway/swing/shake 已是纯 uv |
| 3. wrap 语义混乱 | ✅ 且更广 | waterflow/cloudmotion/foliagesway/swing/iris/sway/flag 主图位移均 REPEAT;**sf35 修复后的 shake.js:52 也未传 clamp(回归,见 F-5)** |
| 4. combos 值兼容性 | ✅ | filmgrain.js:6 `||12`、pulse.js:16 `||9` 吞显式 0;**新实例:godrays.js:28 combineMode 未 Number()**(被 LGT-01 掩盖,修复后即现形) |
| 5. 静默失败 | ✅(措辞修正) | catch 非裸吞,带名字调 this.log;但 log 默认 no-op 且 index.js 显式传 `log:()=>{}` → 实践全静默 |
| 6. 每像素堆分配 | ✅ | model.js:695、math.js:141-178、runtime.js:6,12、waterflow.js:57 闭包等,4K 下千万级/帧 |

---

## 六、对两份原报告的质量评价

1. **we-renderer-review.md**:P0 全部成立;P1 有 2 条误报(P1-12/23)、1 条已被修复
   (P1-9);§四.2 的 mask UV 分组清单部分过时。其"行向量/列向量、y-down/y-up"
   类几何论断抽查全部成立,可信度高。
2. **00-REVIEW-SUMMARY.md + 分片**:P0/P1 全部成立;[verified] 标注的数值复现
   本轮抽查均精确吻合(300→125、(11,0)→(0,11)、alpha 101 等)。个别 P2/P3
   措辞失准(BASE-27/30 子句、MOD-17 支撑句、LGT-12 中间推导值)但不影响结论。
3. 两份报告**共同盲区**(本轮新增,见 §七):jpeg DC 预测器、粒子发射归属、
   sf35 shake 回归、convertUniform bool、renderGlsl 死参等。

---

## 七、本轮新增发现(评审漏报,均经核实)

| # | 位置 | 问题 | 核实 |
|---|---|---|---|
| F-1 | jpeg.js:238 | RST 间隔处 **DC 预测器不归零**(consumeRestart 不清 prevDC)——即使修好 P1-26 的 pos 推进,RST 后 DC 仍漂移 | 读码确认(prevDC 仅 415 初始化一次) |
| F-2 | particles.js:175-177 | 多发射器共享 acc 的**发射归属错配**:总速率正确但粒子由靠后发射器独占产生,低速率前序发射器饿死(P1-23 的真实形态) | node 实测 emitter0=0/emitter1=20 |
| F-3 | model.js:321-325 | `_shadeDna` 内联采样缺 isFinite 守卫(MOD-15 同族遗漏) | 读码确认 |
| F-4 | image.js:48 | `_materialUniforms` csv 直通原始值,布尔/对象可进 uniform(IMG-08 的 csv 侧同族) | 读码确认 |
| F-5 | shake.js:52 | **sf35 修复引入回归**:主图采样未传 clamp,旧代码显式 clamp,现边缘位移带 REPEAT 回绕(违 §9.6) | 读码确认 |
| F-6 | cloudmotion.js:22 / lightshafts.js:73 / foliagesway.js:34 | 缺失全局纹理 → `_texSample(null)`=白 → 最大位移/全幅光柱(WAT-02 同根因漏列) | 读码确认 |
| F-7 | waterflow.js:44 vs shake.js:45 | 同为 noflow 语义实现方向相反:waterflow 缺纹理=最大流量,shake 缺纹理=无位移(shake 对) | 读码确认 |
| F-8 | godrays.js:28 | combineMode 未 Number(),字符串 BLENDMODE 落 default 混合(横切 4 遗漏实例) | 读码确认 |
| F-9 | canvas.js:196-232 | decodePngBuffer 无行长/总长度校验,截断 PNG 静默花屏(对照 scene-manifest.js 硬化版) | 读码确认 |
| F-10 | executor.js:160 | renderGlsl 解构的 `textures`/`time` 是死参 | 读码确认 |
| F-11 | executor.js:79 | convertUniform bool 用 `!!v`,字符串 "false"/"0" → true | 读码确认 |
| F-12 | executor.js:199 | 无逐像素异常隔离,单像素抛错丢整帧;与 P1-42 复合时回退链双重不可达 | 读码确认 |
| F-13 | preprocess.js:40,44,46 | expandIncludes 按文本 replace 定位,重复文本可错位;注释内展开的头文件若含 `*/` 会提前闭合注释 | 读码确认 |
| F-14 | transpile.js:617-623 | mat 下标 `.subarray` 分支因 GLS-02 成为死代码;修好 GLS-02 后"本地 mat 普通数组"才会在此处 TypeError(修 GLS-02 必须同步修此处) | 读码确认 |
| F-15 | godrays/glitter 的 mask 缩放注释 | godrays.js:15、glitter.js:25 注释引"官方 vert maskRes/对象Res"与 §9.2 裁决冲突,需统一裁决(并入 LGT-08 处理) | 读码确认 |

> 注:光/后期复核代理曾补报"depthparallax.js:15 MASK 只判 ===1",
> 本轮亲自核对为**误报**——当前代码是 `=== '1' || === 1` 双兼容(可能已被
> sf35 顺手修复),不计入新增。

---

## 八、修复优先级建议(按本轮复核后的真实影响面重排)

0. **安全(全局最高,集成层补审新增)**:P-01 场景脚本 vm 沙箱可逃逸
   (`this.constructor.constructor` / 任意宿主函数 `.constructor` → 宿主 `process`,
   已 node 复现)——加载任意 workshop 壁纸即在 DSH 主进程任意代码执行;
   脚本须在无宿主引用的受限 context 或低权限子进程执行。另:H-09/H-10
   (pkg-extract 无解压上限/无符号链接防护,scene-manifest.js 同款已修未回移)、
   P-08(CPU 路径 PNG 解码未硬化)。

1. **先修"必现失效"**:
   godrays `_gaussPass` 回补(+ F-8 的 Number)、pulse `_createAudioResponse` 回补、
   粒子三连(P0-4/5/6)、GLSL for 循环(P0-11)+ 下标(P0-12/GLS-02,
   **须同步处理 F-14**)、blitScaled 负尺寸(P0-3)与双线性(P0-2)、
   blitRotated 方向(P0-1)、全屏 quad v 轴(P0-7)、brightness→RGB(BASE-02)。
2. **GLSL 兜底层成建制修复**:P0-16..20 五项 + P1-38..45(swizzle/discard/
   parseMeta 回移 readBalancedJson);这一层决定第三方 workshop 特效整体生死。
3. **骨架/木偶链**:MOD-01(g_Bones 顺序)+ MOD-02(bindWorld 与 _sampleAnimRT
   链法统一)——两者叠加决定旋转骨骼是否正确,建议一起修并用旋转重骨骼模型实测;
   随后 MOD-09(补骨骼缩放/Z)、P1-22(renderPuppet 接 tr.angle)、MOD-06
   (单骨容错改跳单骨);P1-3/MOD-04(fps)待官方帧率元数据确认后再动。
4. **统一裁决(先定后改)**:mask UV(剩 watercaustics + godrays/glitter/tint/blend
   + F-15 注释冲突)、缺失纹理回退策略(WAT-02/F-6/F-7,建议以 shake 守卫或
   flowmask→中灰为准)、主图位移 CLAMP(P1-6/7/13/18/19 + F-5 shake 回归)、
   wrap 边缘插值(model.js:691)。
5. **单点特效修复**:blurradial K1(P0-8)、LGT-04 alpha clamp、P1-10 blend
   transformRepeat、LGT-06 iris s4 槽位、P1-17 filmgrain 双兼容、F-2 发射器
   独立 acc、jpeg RST 两项(P1-26 + F-1)。
6. **健壮性/性能**:MOD-13 近平面、MOD-15/F-3 isFinite 守卫族、
   每像素分配(model.js:695/math.js:141/waterflow.js:57)、_rt_ 快照缓存
   (BASE-11)、objects.find O(n²)(BASE-16)。
7. **防回归**:为 P0 全部加冒烟单测(如 effectGodrays 小纹理断言不抛、
   transpile 含 for 的 shader 断言编译通过);把"拆分丢 helper"写成 lint。

---

## 九、集成层补审(第三轮)

> 前两轮评审与上述二次审查只覆盖 `lib/we-renderer/`。本轮补审**集成层**:
> host 管线(lib/index.js 3538 行 + pkg-extract.js)、GL renderer
> (src/scene-gl.js 699 行)+ UI 降级链(src/client.js)、CPU 视频管线
> (scene-render-worker.mjs / scene-manifest.js / scene-scripts.js /
> scene-player.js / index.js 路由)。方法同前:3 个模块代理逐条核对 +
> node 复现,作者对**全部** finding 亲自读码复核(关键项独立复现:
> vm 逃逸、TDZ、copilot 门禁、gate 语义对照)。

### 9.1 政策「effects 加载失败就不加载 + UI 提示」落实情况(核心结论)

该政策只在 **GL 路由的 gate 层**完整实现(`sceneGLCheck` → degraded 清单 →
设置面板 ⚠ 提示,src/client.js:3444-3448)。两条断链:

1. **CPU 路由完全没有该机制**(H-01 = P-02,已实锤):
   `scene-render-worker.mjs:13,34` 与 `index.js:2483` 三处渲染入口全部
   显式 `log: () => {}`,渲染器所有逐对象静默跳过(core.js:589、effects.js:108、
   puppet 三条静默 return、缺纹理跳过)既不上 UI 连日志都被丢弃;
   全仓库 `degraded` 仅存在于 GL 路径。**残缺帧被当成功加载**。
2. **GL 侧提示只在"降级开 + GL 活到首帧"的窄路径成立**(G-01):
   `sceneGL.degraded` 只在 onReady 赋值,首帧前失败(shader 编译/纹理/watchdog)
   静默回退 mp4;mp4 失败亦无任何提示(G-03:probe.onerror 空、8 分钟超时仅清进度条)。

### 9.2 GL renderer + UI 降级链(G-xx,全部 ✅)

| ID | 级 | 一句话 |
|---|---|---|
| G-01 | P2 | GL 首帧前失败 → `sceneGL.degraded` 永不赋值 → 降级提示断链(静默回退 mp4) |
| G-02 | P2 | `sceneGLDegrade=false` 的 meta 预取无超时(可挂起死锁,壁纸永停静态帧);`!meta` 分支直接进 GL,违反"关闭降级=回退视频完整渲染" |
| G-03 | P2 | mp4 升级路径失败无提示:probe.onerror 空实现 + 8min maxWait 仅清进度条 |
| G-04 | P3 | 降级汇总丢弃 host 的 object 名与 action 全文(标签覆盖完整,明细丢失) |
| G-05 | P3 | 死常量 `_WE_GL_ENGINE='dsh-we-scene-gl/2'`(现行 /3) |
| G-06 | P3 | contextlost 后 startLoop 可在死 context 上跑帧并提前触发 onReady(闪空帧+假 ready) |
| G-07 | P3 | `weSceneGLFailed:<token>` sessionStorage 无过期、不区分瞬态/永久,整会话钉死 mp4 |

降级提示链断点(host mark → payload.degraded → renderer.degraded() →
sceneGL.degraded → UI 3444):断点 = ①hard-reject 时 payload 不带 degraded;
②首帧前失败(G-01);③onReady 前暂停态;④降级开关关闭(G-02);
⑤mp4 兜底失败(G-03)。已验证不存在:切壁纸残留、竞态串台、标签缺漏。

### 9.3 host 管线与 GL gate(H-xx,全部 ✅)

| ID | 级 | 一句话 |
|---|---|---|
| H-01 | P1 | CPU 三渲染入口全 `log:()=>{}`,无任何 degraded 采集(= P-02,政策直接违反) |
| H-02 | P1 | 视频抽帧 tmp 路径仅 `pid+index` 并发互踩(node 复现 COLLIDE);帧缓存 hash 仅 `ref\|length` 同长串缓存 |
| H-03 | P2 | gate visible 判定 `===false` 漏字符串 'false' 与 user 绑定,与 CPU `_isVisibleSelf` 不一致,且 skip 不记 degraded |
| H-04 | P2 | gate/scene-gl.js 完全不处理 obj.parent(CPU 折叠父链变换+传播可见性)→ 分组对象 GL 错位/多渲,静默 |
| H-05 | P3 | 3D 模型对象(`o.model`)落 `no-image` 桶被错标"文字/脚本/纯色" |
| H-06 | P2 | waterwaves 双波:gate 按 combo DUALWAVES,CPU 按常量 direction2/scale2 → 双向不一致(常量驱动时 GL 静默渲单波) |
| H-07 | P2 | zoom hard-reject 只读 scene.camera.zoom,漏 general.zoom/相机对象 zoom → GL 按 1 渲染,静默错 |
| H-08 | P2 | loose scene.json 场景 `readPkg(dir)` EISDIR → sceneAspect 恒 null,宽高比修正静默失效 |
| H-09 | P2 | pkg-extract.js 无解压/像素上限(scene-manifest.js 有,同仓库不一致,~2GB 分配 DoS 面) |
| H-10 | P2 | pkg-extract.js dirSceneAccess 无符号链接防护(scene-manifest.js 有 realpath+lstat)→ 松散场景越界读 |
| H-11 | P3 | /media-info 依赖与 /media 前缀的注册顺序 |
| H-12 | P3 | transcode 缓存永不清理(tc_*.mp4 只增不减) |
| H-13 | P3 | probeMp4 moov 越界容忍可读垃圾元数据 |
| H-14 | P3 | extractSceneVideoVia 按 ftyp 切到文件末尾不按 box size 截断 |

gate ↔ CPU 能力不一致(host 报告 A/B/C 表,抽查全部成立):
**A. GL 判不支持但 CPU 能渲**(粒子/文字/3D 模型/相机路径/bloom/puppet/
视频纹理/自定义 shader/非白名单效果 19 个/zoom≠1 整场景 hard-reject);
**B. GL 判支持但实际渲错且静默**(常量驱动双波、字符串 'false'、user 绑定
visible、general.zoom、父链、效果 usershadervalues——gate 只传
constantshadervalues,index.js:2957 vs image.js:39);
C. 抽查一致项(效果 visible 剔除、dir 推导、PERSPECTIVE 语义、parallax)。
token 安全总体良好(mediaMap 白名单,无任意文件读取)。

### 9.4 CPU 视频管线(P-xx,全部 ✅,P-06 附注)

| ID | 级 | 一句话 |
|---|---|---|
| **P-01** | **P0** | **场景脚本 vm 沙箱可逃逸 → 主进程任意代码执行**(已复现:`this.constructor.constructor("return process")()` 拿到宿主 process;脚本在 scene-render-worker 内执行,worker 具完整 Node 权限) |
| P-02 | P1 | = H-01(CPU 无 degraded,log 全丢) |
| P-03 | P1 | scene-anim 多帧分支无空白帧门禁(单帧有,worker 16-27 + index.js:2369)→ 纯色/黑帧被当有效动画下发 |
| P-04 | P1 | scene-anim 渲染失败=静默静态帧(422→probe.onerror 忽略→progress 恒 0→8min 停),用户零提示 |
| P-05 | P1 | scene-frame 挂起最长 10 分钟黑屏才回退;松散场景无 preview 时永久空白 |
| P-06 | P2 | scene-anim 帧数/内存无上界(loop 无 6s 上限,900 帧→GB 级);超时 600s×帧数形同虚设;`entry.cancel` 死代码——**注:不断开取消是注释明载的有意取舍,但无界帧数问题独立成立** |
| P-07 | P2 | abort 预中止路径 TDZ:`clearTimeout(timer)` 引用 766 行声明前的 const → ReferenceError(已复现) |
| P-08 | P2 | CPU 纹理 PNG 解码(canvas.js decodePngBuffer)无维度/IDAT/inflate 上限、截断静默出黑;硬化版只在 GL 纹理路径(= F-9 的强化,已复现 zlib 炸弹分歧) |
| P-09 | P2 | pkg/tex/png 3-4 份分叉实现;textures.js readPkg 无 LZ4 → LZ4 包 CPU 纹理乱读静默跳层;scene-manifest 新版 extractSceneMainImageVia 是死代码 |
| P-10 | P2 | scene-manifest 路由无缓存/in-flight/mtime 失效,大 pkg 每次同步重建阻塞主线程数秒 |
| P-11 | P2 | worker 进度消息在无 onProgress 时被误判渲染失败(隐性契约) |
| P-12 | P3 | 帧缓存键 Math.round(mtime) 亚秒不失效;松散场景引用文件变化不失效;帧缓存无 GC |
| P-13 | P3 | 脚本 update()/init() 无超时(编译才有 2s),死循环卡死渲染(P-05 根因);运行时错误空 catch |
| P-14 | P3 | scene-video 无内容校验,sv1 缓存键无管线版本 |
| P-15 | P3 | 空白帧门禁 0.05% 阈值可误伤深色合法场景 |
| P-16 | P3 | scene-scripts 正则改写非语法安全(字符串字面量误改);缺失图层静默返回假对象 |

CPU 端到端失败链 13 个失败点中**唯一带门禁的是 scene-frame 空白帧检测**,
其余全部静默(log 丢弃 / HTTP 状态码吞掉 / 客户端空 onerror)。

### 9.5 壁纸文件夹实测诊断(2026-08,`~/Pictures/WallpaperEngine`)

7 张场景壁纸,真 logger + 640×360 实渲:

| 壁纸 | 对象构成 | 诊断结果 |
|---|---|---|
| 3113554287 窗旁の伊蕾娜 | image×5, text×1 | **4 张纹理为 mp4 嵌入 tex,静态解码失败,4 个 image 被静默跳过**(CPU 无提示;GL 路由会记 video-texture degraded) |
| 3264258426 堂主美如画 | image×1, particle×1 | 无异常(GL 路由粒子按设计跳过) |
| 3295448069 零二 02 | image×1 | 无异常 |
| 3427824116 胡桃-窗前 | image×2, particle×6 | 无异常 |
| 3478544779 卡提希亚 | image×1 | 无异常 |
| 3593194513 卡提希娅 | image×11, particle×4, text×3, sound×1 | 无异常 |
| 3735447194 达妮娅 | image×31, particle×5, text×4, sound×2 | 无异常 |

结论:当前壁纸集**无一张含骨架(puppet)对象**;"粒子加载不了"= GL gate
按设计跳过(degraded 有记录,设置面板可见);"骨架加载不了"在当前集合
不出现,若未来遇到 puppet 壁纸,GL 按静态贴图渲染 + CPU 走 §4.3 蒙皮缺陷。
CPU 实渲 7/7 无异常(低分辨率下),但日志通道在生产配置下被 `log:()=>{}`
关闭(H-01),同样的失败在线上将不可见。

### 9.6 集成层修复优先级(并入 §八)

- **§八.0(安全)**:P-01 沙箱、H-09/H-10 pkg-extract 两项、P-08 PNG 硬化
  ——其中 H-09/H-10/P-08 都是"scene-manifest.js 已修、活路径未回移",
  移植成本低,应与 P-01 同批处理。
- **政策闭环(用户拍板项)**:建 CPU degraded 通道——worker 把渲染器 log/
  跳过计数经 postMessage 上浮(H-01 建议的 onDegraded 结构复用 GL degraded),
  scene-anim 补空白门禁(P-03),客户端把 GL 失败 reason 与 mp4 失败挂到
  3444 同款提示位(G-01/G-03);gate 补 mark:父链(H-04)、user 绑定(H-03)、
  general.zoom(H-07)、usershadervalues(表 B)。
- **健壮性**:H-02 tmp 路径加内容 hash、P-06 帧数上界、P-07 TDZ、P-13
  update 超时、P-10 manifest 缓存、H-12 转码缓存清理。

---

## 附录:复核分工与深度说明

| 模块 | 覆盖 finding | 复核方式 |
|---|---|---|
| 基础管线(canvas/math/core/textures/effects 派发) | P0-1..3、P1-1..5、§五 P2、BASE-01..34 | 代理逐条 + 作者全文件读码 |
| 场景对象(image/camera/bloom/model/puppet/particles/text/mdl/jpeg) | P0-4..7、P1-19..27、IMG-01..23、MOD-01..40 | 代理逐条 + 作者全文件读码 |
| 水/自然特效(10 文件) | P0-9、P1-6..9/14、WAT-01..20 | 代理逐条 + 作者全文件读码 |
| 光/后期特效(14 文件) | P0-8/10、P1-10..18、LGT-01..18 | 代理逐条 + 作者全文件读码 |
| GLSL 前端(transpile/preprocess/common.h) | P0-11..14、P1-28..37、GLS-01/02/03/06 等 | 代理逐条 + 作者独立 node 复现 6 项 |
| GLSL 后端(executor/runtime/integration) | P0-15..20、P1-38..45、GLS-04/05 等 | 代理逐条(node 复现 8 项)+ 作者读码确认关键行 |
| 集成层:host 管线+gate(index.js/pkg-extract) | H-01..14 + 能力表 A/B/C | 代理逐条 + 作者读码复核 10 条 |
| 集成层:GL renderer+UI 降级链(scene-gl/client) | G-01..07 + 断点表 | 代理逐条 + 作者逐条读码复核 |
| 集成层:CPU 视频管线(worker/manifest/scripts) | P-01..16 + 失败链 13 点 | 代理逐条 + 作者复核(P-01 逃逸/P-07 TDZ 独立复现) |

所有 node 复现均为只读,未修改任何源码。评审中标注"官方行为无源"的条目,
建议修复前用官方 preview.gif / 实机截图做 MAD 对照(两份原报告的共同建议,本轮重申)。

---

## 十、修复回执(2026-08,分支 feat/linux-scene-gl-live-render)

全部 ✅ 确认 finding 已按三波委派修复,**每条修复均经作者本人独立验收**
(node 复现 + `npm run verify` + 7 壁纸 MAD/目检),验收脚本留存于
仓库外 `.we-fix-accept/`(escape-battery / canvas-math-repro / glsl-repro / wallpaper-diag)。

### 提交清单(8 笔)

| 提交 | 范围 | 覆盖 finding | 作者验收要点 |
|---|---|---|---|
| `75fec2c` | 场景脚本沙箱 | P-01、P-13、P-16 | 12 探针逃逸电池全 blocked + 死循环 102ms 杀;两脚本壁纸 12 帧 sha256 与修前一致 |
| `b2d2259` | 基础管线 | P0-1/2/3、P-08/F-9、P1-1/2/5、WAT-03、BASE-08/11/16/17/18/19/30/31/34、C1 通道 | 复现 10/10;3113554287 MAD=0.000 + 4 组 video-texture degraded 精确命中 §9.5 |
| `35209d7` | GLSL 栈 | P0-11..20、P1-28..45、GLS-01..28 大部分、F-10..14 | 复现 8/8;GLS-09 hoist 采样 12→1 实测;P0-16/17/18 读码确认 |
| `3a36507` | 场景对象 | P0-4..7、P1-19..27、MOD-01..38、F-1..4 | 骨骼顺序数值复现 (11,0)→(10,1);粒子/帧宽/jpeg RST 抽查;MAD 全预期 |
| `3b9f79e` | 手写特效 | P0-8/9/10、P1-6..18、WAT/LGT、F-5..8、C2/C3/C4 | K1 权重和=1.0 独立验算;mask UV≡1 五文件 grep;foliagesway C4 正确触发 |
| `4cb5a83` | host 集成 | H-02..14、P-03/06/07/10/11/12/14/15、worker degraded | H-02/P-07/H-09 读码确认;gate 折叠与 CPU resolveTransform 逐位一致(代理 32/32) |
| `01a0262` | 客户端+GL | G-01..07 | build+verify PASS;提示断链/fatal 上报/父链折叠/FBO clamp 抽查 |
| `6d012ee` | worker transfer | 收口新发现 | 池化 ArrayBuffer transfer 抛错 → 空白帧 ok:false;去 transfer 后两例实测恢复 |

### 豁免/Deferred(有意不修,已在代码注释或各包 deferred 清单记录)

- **官方行为无考**:P1-3/MOD-04 fps、P1-4 量纲、MOD-18/20、IMG-09/16/20、MOD-28、
  BASE-14 色彩空间、WAT-09/14/15、GLS-03/P1-30(mul 宏矩阵语义)。
- **误报不改**:P1-12(blurradial mask)、P1-23 原表述(真身 F-2 已修)。
- **新发现待办**:particles `p.life`/`p.lifetime` 字段错位(粒子实际不死,
  统一字段会改变全部粒子壁纸行为,需官方寿命语义);H-14 根因回移
  scene-manifest.js(现 index.js 出口补偿截断);meta 预取 fetch 无超时(G-02 后半);
  contextlost 死 context 检测(G-06 完整版)。

### 端到端验证(收口)

- **degraded 通道三段全通**:CPU core→onDegraded(wallpaper-diag 实测事件)→
  worker postMessage→路由(3113554287 实测 8 条上浮);GL gate→renderer 缓存→
  client 提示条(W3-B harness A1/A2/A3)。
- **7 壁纸 MAD**:3113554287 逐字节一致;4 张粒子壁纸变化(预期:P0-4/5/6 修复);
  3295448069/3478544779 变化已目检 = 双线性重采样 + foliagesway C4 跳过,构图一致。
- **终验三件套**:逃逸电池 ALL BLOCKED;PNG 硬化抛错/合法回放任一;GLSL for 循环编译。
- `npm run verify`(package-files + client + transcode-state)全 PASS。
