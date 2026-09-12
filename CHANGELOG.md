# Changelog

## 0.8.17 — 粒子 colorrandom 颜色语义修正：雪花彩虹色 → 白↔浅灰 (3302695207 官方实拍裁决)

用户贴出官方实拍（WE 运行效果：雪天 + 时钟/日期/电量/音频条控件）要求核对一致性。
核对结论见下条「未实现项」，其中**当即修掉**的是粒子颜色的语义 bug：

- **症状**：我们的雪是**彩虹色**小点 —— 实测最彩色样本 (99,254,115) 绿、
  (244,100,139) 粉、(209,108,247) 紫、(234,231,101) 黄，色度
  (max-min 通道) 均值 **61.9**、最大 **155.0**。
- **根因**：`colorrandom` 三个通道各自独立取随机数。预设
  `particles/presets/snowperspective.json` 的 min=(255,255,255)、
  max=(95,98,100) 本意是"白↔浅灰"的细微变化，逐通道独立随机却会落到
  (0.37, 1.00, 0.70) 这类高饱和色上。lwe `randomVec3` 正是逐通道随机
  (CParticle.cpp:718 + Maths.cpp:13)，属其自身误差。
- **修正**：整条 vec3 共用一个随机因子 t（min→max 线性插值）。
- **判据（官方实拍）**：参考图里雪花一律"白偏蓝"（最彩色样本仍是
  (163,211,231)/(204,236,246) 一类蓝色调），**没有任何绿/黄色点**；且静止
  背景是深蓝夜景，不存在把绿点染成蓝点的环境色。
- **实测**：修正后同机同配置粒子色度均值 **61.9 → 1.9**、最大 **155.0 → 5.0**，
  样本变成 (104,107,109)…(142,143,144) 的白↔浅灰 ✓。
- 影响面：只影响挂 `colorrandom` 的粒子（其余初始器分支不变）；以官方输出为
  准的口径与 §10.3「分歧以官方为准」一致。

### 未实现项（本轮只核对，未动）

对着官方实拍逐项核对（无头实拍 + 逐像素测量，参考图 1758×1029 与我们的
1920×1080 在 **0.9 缩放 + (30,0) 偏移** 下整帧 NCC **0.798** 对齐）：

| 元素 | 官方实拍 | 我们 | 根因 |
| --- | --- | --- | --- |
| 背景（雪天 背景.tex） | 有 | **逐像素一致**（ncc 0.981） | — |
| 人物/扫帚 | 有，右侧 Ride 姿态 | 一致（同一绑定姿态落点） | — |
| 「雪」天气角标 | 有（右上圆形徽标） | 有（文本对象已渲染） | — |
| 雪（snow3 / snowperspective） | **满屏**，x 1%~99% | 只有中段一条带：x 24%~84%、y 24%~98% | `flags=4` **透视粒子**（3D 球壳 + 专用透视投影）未实现：我们只做 2D 圆盘 + 正交投影，z 分量被丢弃 |
| 雾（snow1 / fog1） | 下半明显蓝色雾 | 均值 0.7/255（几乎不可见） | 官方 fog1 贴图是 **r8 + 64 帧 spritesheet**（128×128/帧，tex-json 实测），我们按单帧渲染 |
| snow5（雪天全屏 solid layer） | 参与观感 | 跳过 | gate 报「材质 pass 数≠1」；材质 `assets/materials/util/solidlayer_instance_4.json` 实际可读（1 pass, genericimage4 + util/white），`colorBlendMode: 30` 语义未知 |
| 控件层：时钟 21:40 / 电量 49% / 12 SEP 2026 / SATURDAY / FPS 15 / 音频频谱条 / 手写「Bilibili 夜莺Night」「（可自定义文字）」「Night」「晚上」 | 有 | 全部跳过 | `livetext`（Clock/Date/帧率显示/早中晚）+ 音频响应 + `watermarktext`（文本1/文本2）—— 需脚本求值 + 系统时间/电量/音频输入 |

**已具备但此前未用上的资源**：本机 `~/Pictures/WallpaperEngine/assets/`（91MB
官方素材，WE 安装目录的 assets 副本）—— 插件已默认把 `<loose 根>/assets` 登记为
全局素材根，因此 `materials/particle/chromaticdot.tex`（雪）、
`materials/particle/fog/fog1.tex`（雾）、`assets/effects/godrays/*`、
`assets/materials/util/solidlayer_instance_4.json`、`assets/shaders/genericparticle.*`
与 `common_particles.h`（粒子投影权威实现）都可直接取用；先前无头实拍没接这个根，
所以雪花贴图/雾贴图一直走"无纹理圆点"兜底。

## 0.8.16 — 效果链按【效果】整组编译：实验开关下背景整块变黑根修 (3302695207)

用户接着报「人物正常显示了，但背景是异常的」。复现后确认：**背景图层本身渲染
完全正确**（背景纹理 NCC 定位 `texTopLeft=(-65,-47)`、ncc **0.981**，与对象
rect 逐像素吻合，1080p/1000p/800p/4K 四种视口一致），坏的是**效果链**。

- **触发条件**：设置里的「未测试特效放行」(`sceneGLExperimental`)。用户是开着的
  （`/wallpaper-engine/settings` 实测 `sceneGLExperimental: true`），此前所有
  无头回归都是关着的 → 一直没暴露。
- **根因**：一个 WE 效果 = 同 `dir` 的**连续若干 pass**，pass 之间**内部串联**。
  旧实现逐个 pass 隔离（编译失败只剔那一个 pass），于是 `snow0` 背景的
  `godrays` 5 pass（downsample2→cast→gaussian×2→combine）里只有
  `godrays_downsample2` 编译成功 → **亮部提纯的中间缓冲被当成整条链的最终输出**
  → 背景整块变黑、只剩太阳亮斑（画布均值亮度 **113.5 → 21.6**），人物/扫帚/
  云层照旧 → 正是用户看到的"人物正常、背景异常"。
- **失败清单**（实测）：`depthparallax.frag`(`for` 条件非法)、`godrays_cast.frag`
  (`int`/`float` 隐式转换)、`godrays_gaussian`(**shader 拉取失败 404/422：该
  shader 属 WE 内置 `assets/shaders/`，壁纸包内没有**)、`godrays_combine.vert`
  (`COPYBG` combo 预处理)、人物的 `color_grading.frag`(workshop shader
  `rgb2hsv` 重载缺失)。
- **修复**（只动 GPU/GL 客户端）：`src/scene-gl.js` buildResources 按 `dir` 把
  `obj.effects` 切成连续组，组内**任一 pass 无 program → 整组丢弃**（链输入原样
  传给下一个效果，与"未支持效果"同语义），并记一条 degraded：
  `效果的部分 pass 编译失败 (N/M)，整个效果已跳过（链输入原样传递）: <原因>`；
  `safeProgramFor` 改为返回 `{pe, err}` 以复用首个失败原因。
- **实测**：
  - 修复后同一配置：画布均值 **21.6 → 113.9**，天空/云/山脉/谷地/光束全部回来；
    `snow0` 只剩 `waterflow` 生效（`godrays`/`depthparallax` 整组跳过），
    人物侧只有 `color_grading` 被整组跳过（waterwaves×3/shake 逐位不变）。
  - 零回归：实验开关**关**时改动只差 **19 px（0.001%）**；
    3463520581 / 3735447194 / 3784528825 / 2686862510 四个既有壁纸实验开前后
    差异 0.08%~1.96%，**低于同码重拍的对照抖动 2.52%** → 链内 pass 全部编译
    通过的对象逐位不变。
- 说明：文本对象（作者的自定义 UI 标签「自选择时间模式」「雪」等）仍会按场景
  静态 visible 值渲染 —— 它们由内嵌脚本在运行时显隐，本管线不执行脚本；
  天气切换（`newproperty72` 条件）同样未实现（用户已确认暂不做）。

## 0.8.15 — 未挂 animationlayers 的木偶不再兜底播"动画0"：部件位置严重异常根修 (3302695207)

用户报「3302695207，部件位置严重异常」。查下去是**客户端自造了一层官方不存在的
默认动画层**：`_weGLBuildPuppetMesh` 在对象没有 `animationlayers` 时兜底
`[{animation: 0, blend: 1, rate: 1}]`，于是"未挂动画"的对象也被强行按 MDLA 帧
世界姿势蒙皮。

- **根因数据**：`models/人物_puppet.mdl`（MDLV0023/MDLS0004/MDLA0006，351 顶点、
  8 骨、121 帧）的 **MDLA 根骨帧0 恒为 (864.231,−103.348)**，而 **MDLS bind 根骨
  是 (1311.230, +600.650)** —— 差 **(−447.0,−704.0) 场景单位**，且**全部 121 帧
  完全相同**（不是动画，是常数偏移）。其余 7 根骨头的帧0 局部量与 bind **逐位
  相等**（差 ≤0.001），所以骨架是刚性的整体平移：网格包围盒从
  `x[−976,976] y[−817.5,761.5]` 变成 `x[−1392,499] y[−1522,58]`。
- **用户可见后果**（1920×1080，`px = world/2`、`py = 1080 − world_y/2`）：
  人物整块从 `x[850,1826] y[333,1127]` 搬到 `x[627,1603] y[685,1479]`
  —— **画布下沿 411px（部件高度的 38%）被推出屏幕**（只剩帽子和头发），
  同时脱开作者摆好的扫帚（`扫帚` 对象 rect `x[678,1647] y[682,1130]`，
  bind 姿态下正好托在人物座位下）。
- **官方语义**：puppet 的动画由**场景对象挂的 `animationlayers`** 驱动；对象
  未挂任何可见层 = 未播放动画 → 网格保持**绑定姿态**（raw 顶点 = 对象 rect =
  作者构图基准）。全库普查（49 个 puppet payload / 38 个带动画的对象）**全部显式
  挂层**，这个兜底只在本壁纸的 5 个 `人物` 对象上生效过 —— 去掉它对既有壁纸零影响。
- **修复**（只动 GPU/GL 管线，不碰 CPU 提取器）：
  - `src/scene-gl.js` `_weGLBuildPuppetMesh`：`layers` 只取对象的
    `animationlayers`（`visible !== false` 过滤），**不再兜底默认层 0**；无可见层
    → 不建 `skin` → 直接画绑定姿态网格（`lib/client.js` 已重建）。
  - `lib/we-renderer/puppet-export.js`：新增 `hasVisibleAnimLayer()`，
    `buildPuppetPayload(access, modelJson, sceneObj)` 对**未挂层**的对象**不物化
    动画帧**（每对象省 ~49KB JSON + 121×8 帧采样；`lib/index.js` gate 传入对象）。
    不传第三参时行为不变（实验层/等价性判据）。
- **实测证据**：
  - 渲染回归（1920×1080 GL 实拍）：修复前 `x[821,1373] y[712,1079]`（只有帽子/
    头发，触到画布下沿），修复后 `x[850,1826] y[333,1127]` —— 与"静态贴图对照"
    同位置（纹理 NCC 定位 `texTopLeft=(850,330)`，body 区 ncc 0.813 vs 静态
    0.808）；三人对比图（静态对照 / 修复前 / 修复后）目检一致。
  - 全库 payload 对照（49 个 payload，逐字节 JSON）：**挂层的 38 个 before/after
    完全相同**；未挂层的 11 个中 5 个（本壁纸 `人物`）`animations` 由 1 → 0
    （省 49,048 字节/对象），其余 6 个（3463520581 三个无动画模型）本来就 0 字节差。
  - 动画未受影响：3735447194（20+ 带动画木偶）t=1.5s vs t=8s 画面差 382,614 px、
    3463520581 t=1.5s vs t=7s 差 677,057 px；3784528825 正常出图。
  - 测试：`verify-scene.mjs` 新增 3 项（`hasVisibleAnimLayer` 谓词、"未挂层不
    物化动画帧"、"挂可见层 payload 与旧调用形态逐位一致"）；套件与本机基线一致
    （本机松散库缺失时第 3 项按惯例跳过）。`verify-client.mjs` 全通过。


## 0.8.14 — 旧容器 (MDLV0013/0016) 紧凑顶点记录 + MDLA 首帧装配：部件脱离人物根修 (2686862510)

用户报「2686862510 壁纸部件坐标解析异常，左肩和披风脱离人物」。查下去是**两层
叠加的结构性缺陷**，都只在旧容器族上成立（库内 39 个 puppet MDL 里 3 个）：

- **第一层：顶点块扫不到。** `models/本体_puppet.mdl` 是 `MDLV0013`，顶点记录是
  **52 字节紧凑形态** —— `[pos 12B][4×u32 顶点索引 16B][4×float 权重 16B]
  [uv 8B]`，`pos` 之后**没有**新容器 (`MDLV0021/0023`) 的 28B 法线/切线区。
  旧实现只按 80B 步长扫（`vertexBytes % 80`），紧凑块恒不匹配 → `_parseMdl`
  返回 `null` → host 记录 `{"object":"本体","feature":"puppet","action":"木偶数据
  解析失败，按静态贴图渲染"}` 并**退化成整张图集平铺上屏**。图集是"未装配"的
  排版：斗篷在图集顶部、左右披风片在左右边缘 → 画面上就是**披风悬在半空、
  肩甲片落在别处**（"左肩和披风脱离人物"）。
- **第二层：静态帧用错了姿态。** 就算网格解析出来，旧容器的 `MDLS` bind 姿势
  **就是图集排版姿态**（实测：2686862510 骨骼 3/4/5 的 bind 平移
  (−385.5,−97.5)/(430.6,−151.8)/(−165.8,674.8) 与图集上部件位置一一对应），
  渲染姿态来自 **MDLA 首帧**。新容器两姿态实测一致（`bind vs 帧0` 差 ≤0.03
  单位，34 个文件），旧容器差 **285~800 单位** → 旧容器必须按首帧装配。
  而旧实现的 MDLA 头是靠 **`[f0 41]` 魔数扫描**（= float 30.0）定位的，
  该模型 `fps = 3.625` → 魔数恒失配、扫描跑到文件尾 → **整个 MDLA 被丢弃**。
- **MDLA 布局实测**（`MDLA0001/0003`，逐字节核对）：
  `"MDLA\0" + u32 段尾偏移 + u32 动画数`，每个动画
  `u32 id + u32 0 + 名字\0 + 循环标志\0 + float fps + u32 frameCount + u32 0 +
  u32 boneCount`，随后**每根骨骼** `u32 0 + u32 segBytes + segBytes 数据` ——
  注意 **每骨有 8B 段头**（`segBytes=(frameCount+1)×36` 只是数据部分，段步进
  = `segBytes+8`），这是既有实现"段连续排布"假设之外的关键差异。行 = 9 float：
  `pos.x, pos.y, pos.z, ?, ?, rotZ, sx, sy, sz`（单骨整段：pos 列 0/1、rot 列 5）。
- **修复**（只动 GPU/GL 管线的解析与导出，不碰 CPU 提取器）：
  - `_parseMdl` 顶点块改为**双布局候选**：先按 80B 主路径扫（库内 36 个文件
    逐条件不变），失败再按 52B 紧凑布局扫；紧凑回退额外校验"权重 4 项 0..1
    且和 = 1、uv ∈ [−4,5]（抽样 90% 通过）"以防噪声块误判，并标记
    `legacyContainer`。
  - 新增 `_parseLegacyMdla()`（按偏移直读头部，不再靠 fps=30 魔数）+
    `_legacyPoseRT()`（首帧父链合成）+ `_poseMeshByRT()`（bind⁻¹×RT 蒙皮，
    与 `_skinPuppet` 同一套行向量约定）。
  - `buildPuppetPayload()` 对旧容器**烘焙首帧装配姿态**，`buildPuppetAnchors()`
    的骨位姿同口径（锚点必须落在渲染姿态上）。旧容器的逐帧动画**不进入物化
    列表**（新容器的列交错规则对"单骨整段 + 8B 段头"排布不成立，未实测验证
    前不喂给动画层）→ `hasAnim=false`，客户端直接画烘焙后的静态网格。
- **实测证据**：
  - 顶点记录字段与图集映射：52B 形态下 `pos = (1112·u − 556, 814.5 − 1629·v)`
    对 781 个顶点残差 **0.0000**（网格是图集的 1:1 拷贝，所以"排版即绑定"）。
  - 首帧装配：骨骼 3/4/5 相对 bind 位移 (+285.30,−3.32)/(−329.34,+30.20)/
    (+194.88,−799.69) → 左右披风片落到 `x[−256..−31]/[3..227]`（与躯干
    `x[−274..165]` 重叠、肩高一致）、斗篷 `x[−167..651] y[−499..0]` 披身向右
    飘出，与作者 `preview.gif`（161 帧，斗篷贴身穿戴向右飘）一致。
  - GL 实拍（1920×1080）：图集团块从"披风悬在人物左上 + 肩片落在石头上"
    变为"斗篷披在肩背向右展开"，`degraded` 里那条木偶解析失败消失。
  - 全库回归：39 个 puppet MDL 解析审计 **只有这 2 个旧容器变化**
    （`2686862510 本体` NONE→781v/6 骨、`3022080536 主体` NONE→2954v/24 骨），
    其余 37 个逐字段相同；47 个 puppet payload **JSON 逐字节相同**；
    185 个场景扫描 before/after 仅 2 个场景 `degraded` 计数 −1（就是这 2 个），
    `GL-supported 175 / frame-ok 64` 不变。
  - `3022080536 主体` 交叉验证：首帧 = bind（24 根 Δ=0.00），且
    `pos = (2156·u − 1078, −3291·v + 1645.5)` 残差 0.0002 → 网格与图集 1:1，
    改成网格渲染后**像素等价**（无内容丢失）。
- 新增 Level E 测试 10 项（合成 52B 容器 + MDLA0001 头 + 首帧装配断言 +
  "权重非法不误判" + "80B 主路径不受影响"）：`scripts/verify-scene.mjs` 35/35 通过。


## 0.8.13 — MDLS 骨骼条目解析截断：木偶躯干/头部整组错位根修 (3463520581)

0.8.12 把 3463520581 的部件错位绝大部分修好，用户仍报「左侧人物后脑和脸分开」
「头部和躯干往左下方移动了」。继续追下去，**真因不是锚点语义，而是 MDLS 骨骼
条目的名字字段解析截断**：`models/asuna body bottom_puppet.mdl` 声明 7 根骨骼
（`MDLS0004` 头里的 u32 计数 = 7），解析只出来 1 根。

- **布局实测**（`[tmp u8][type u32][parent i32][len u32=64][64B 行主序矩阵]
  [0x00][名字]`）：**名字没有终止符**，直接接下一根骨骼的 9 字节头；无名骨骼
  则只有那一个 `0x00`。旧实现 `p += len; while (buf[je] !== 0) je++; p = je+1;`
  只跳过了一个 `0x00` → 落到名字上，从第二根起头全错、很快越界退出；旧实现
  唯一正确的形态恰好是"所有骨骼都无名"（`asuna body` 等 15 根正是这样解析
  通过的，所以问题只在这一个 MDL 上暴露）。
- **用户可见后果**：`asuna body bottom` 的 `Attachment bottom` 锚点
  `boneIdx=2` 越界 → 锚点骨骼项按 (0,0,0) 兜底，躯干+头整组少走
  **(+230.3, +274.2) 父局部偏移**（×1.04495 后 ≈ (+240.7, +286.5) 场景单位
  = 120×143 画布像素）：画面上就是"头部和躯干往左下方移动"、"后脑与脸分开"、
  远处看像两个头；同一网格的蒙皮权重链也缺 6 根骨骼（动画/MDLE 扩展路径
  一并受影响）。
- **修复**：`lib/we-renderer/puppet.js` 新增 `_nextBoneHeader()` —— 矩阵之后
  按"下一个合法骨骼头"定位（`len` ∈ (0,4096] + `parent < 本骨序号`（父子顺序
  不变式）+ `type` 合理 + 矩阵 `m[15]=1`、无透视列、主轴非零且有限）。无名
  骨骼时首个候选即命中，与旧行为逐位一致 → 零回归。
- **实测证据**：
  - 全库审计（10 个 scene.pkg / 32 个 puppet MDL + 目录内 .mdl 文件）：修复前
    `declared != parsed` 的只有这一支 `asuna body bottom`（7 → 1）；修复后
    **32/32 与声明计数一致**，其余 MDL 解析结果逐位不变。
  - 场景元数据 before/after diff：**仅 6 个对象位移**，全部是 `asuna body`
    及其 5 个 `head` 锚点子对象（`hair c1`、`hair c1 behind 1/2`、
    `hair top c1`、`hair top c1 1`），位移量完全一致 (+240.7, +286.5)。
  - 渲染对照（1920×1080 无头 GL 截图 vs 作者预览）：修复前头部区域是"两个
    重叠的头部/上半身"，修复后"只剩一个头部、位置端正，脸侧的编织发辫与
    飘向左的长发都归位"。
- **锚点诊断开关全部移除**：0.8.12 为本地约束拟合临时加的
  `DSH_WE_ANCHOR_MODE` / `DSH_WE_ANCHOR_ROOT_SCALE` 及 `boneLocal` 变体数据
  已删除（拟合结论被真因取代，不留"猜测系数"入口）；锚点实现本身保持
  0.8.12 的语义不变。
- **新增 Level D 回归测试**（`scripts/verify-scene.mjs`，4 项）：合成带名/无名
  骨骼的 MDLS 段，断言带名 4/4、无名 3/3、父子与平移逐项正确、锚点
  `boneIdx=2` 能解析出骨骼 2 世界位姿 (230.358, 274.209) 而非越界归零。
  用旧实现跑：带名用例 3 项失败（parsed=1、bone2=null），确认测试真的守住
  这个 bug；整体 `verify-scene` 25 passed / 0 failed。
- 引擎协议不变（`dsh-we-scene-gl/10`），清单结构未变，仅数值修正。

## 0.8.12 — GL 实时渲染：木偶 attachment 锚点 (MDAT0001) 未实现 — 部件错位根修 (3463520581)

场景 `3463520581`（Kirito x Asuna / SAO 4K）左侧橙发女性的发丝、脸、身体、
裙摆互相错位（远处看似「两个头 / 光头 + 一坨头发」），右侧桐人相对正常
（其锚点平移近 0）。

- **根因：`attachment` 锚点从未参与父链折叠**。WE 场景里 puppet 的子对象带
  `attachment: "<名字>"`，语义是把子对象 origin 锚定到**父 puppet 命名锚点**
  上（`W7`）。锚点表在父 puppet 的 `.mdl` 的 `MDAT0001` 段：`u16 锚点数`
  + 每条 `u16 骨骼索引 + 名字\0 + 64B 行主序矩阵`。gate 侧此前只累加
  origin/scale/angle（"不做 attachment 锚点"），子对象被放到父对象原点附近
  ——本场景 Asuna 的头发锚点在父 puppet 原点上方 677px（`hair back`），
  丢失后整头长发掉到腰部以下；`asuna body`→`Attachment bottom`、
  发丝→`head`（骨骼链累计 369px）同理逐级错位。58 个带 attachment 的对象
  全部错位，桐人 7 个部件因锚点≈0 而"看起来正常"。
- **修复**：新增 `buildPuppetAnchors()`（`lib/we-renderer/puppet-export.js`，
  与 `/scene-puppet` payload 共用同一份 MDL 解析）——解析 MDAT 锚点 + 用
  `_ensureBindRig()` 取骨骼**绑定姿态**（该 bind 链实现从 `_skinPuppet`
  抽出，单一实现两条消费路径共用）。gate 的 `foldChain` 在每级父链插入
  锚点偏移：`锚点偏移 = 骨骼绑定位姿(tx,ty,angle) + Rz(angle)·锚点矩阵平移`，
  与子 origin 同空间（先加锚点再加 origin，同受祖先 scale/旋转影响），
  与旧 CPU `_attachmentOffset` 语义逐项一致（该实现随 0.8.4 移除 CPU 路径
  一同删除，GL 路径未跟进）。
- **锚点缺失时零回归**：无 `attachment` / 父非 puppet / MDL 无 MDAT / 名字
  不匹配 / 骨骼索引越界 → 原折叠路径不变（全库 180 场景实测：仅
  3463520581 使用 attachment，其余对象 effTr 与折叠结果逐位相同）。
- **本场景木偶为静态（绑定姿态）**：这些 `.mdl` 的 MDLA 头 fps 为 10/20，
  而现有 MDLA 解析按 `f0 41`（30fps 浮点魔数）扫描定位 → 动画解析为空、
  木偶按绑定姿态渲染（独立已知缺口，本次不动）。锚点取绑定姿态与网格
  渲染口径一致，拼装自洽；若后续修好 MDLA 动画，锚点必须改为**逐帧**跟随
  骨骼位姿（客户端 `_weGLSkinPuppet` 的同源 final 位姿），否则发丝会滞留。
- **已知残余（本场景，约束拟合后的定论）**：`hair back` 锚点定义在 ASUNA PUPPET
  的 56×56 占位网格上，锚点值却是 +677.017。用本场景三条链路做约束拟合
  （约束 = c2 层的"后脑"网格区域必须落在躯体头部上；躯体头部由"双脚踩地 +
  前发链"独立锚定），三种候选语义的实测偏差：

  | 变体 | c2 层后脑中心 − 躯体头部中心 | 前发链（`head` 锚点）表现 |
  |---|---|---|
  | `world`（骨骼世界位姿 + 锚点矩阵，当前实现） | (+245, +331) | ✓ 刘海在额头、头顶发层在头顶上方 49 |
  | `local`（骨骼局部 bind 平移 + 锚点矩阵） | (−381, +87) | ✗ 整组上移 193（头顶发层高出头顶 243） |
  | `none`（只用锚点矩阵，不要骨骼项） | (−43, +150) | ✗ 整组下移 263（头顶发层掉到头顶下方 213） |

  结论：**骨骼项规则（world）被 `head` 锚点链独立验证为正确**（这是当前渲染
  与作者预览一致的那部分），异常**只局域在根 puppet 的这个锚点**——它的平移
  表现得像处在约 0.55× 的空间里（拟合值 ≈372，文件写的是 677.017，无任何
  规则能解释 0.55）。192×192 预览覆盖场景中心方块，331 场景单位 ≈ 29px 而
  她整个头才 ≈21px：若作者渲染也有这个后脑层，预览上必然看得见；预览没有
  → 这是真实残差，不是作者意图。**不再用猜测系数糊上去**，按语义忠实下发，
  待 WE/Wine 对照裁定（诊断开关 `DSH_WE_ANCHOR_MODE=world|local|none`、
  `DSH_WE_ANCHOR_ROOT_SCALE` 已留在 gate 内，默认 world 即当前行为）。
  > **0.8.13 追记：这段"残差"是误判。** 真因是 MDLS 骨骼条目解析截断
  > （`asuna body bottom` 7 根只解析 1 根 → `Attachment bottom` 的 boneIdx=2
  > 越界归零，躯干组少走 (+230,+274)），修好后同一条 world 语义零系数对齐；
  > 当时拟合出的"0.55×"是把"骨骼项缺失"误当成了"锚点空间不同"。诊断开关
  > 已随之删除。
- 带 attachment 的对象全库仅此 1 个场景，其余 179 个场景 effTr 逐位不变。
- 引擎协议维持 `dsh-we-scene-gl/10`：清单结构未变（仅 `effTr` 数值不同），
  新旧 host/client 可混跑。

## 0.8.11 — GL 实时渲染：带效果木偶部件凌乱 + colorBlendMode 9 黑盒根修 (3784528825)

承接 0.8.10：静态帧修好后，GL 实时路径（实际显示的渲染路径）仍有两处
异常——「人物部件凌乱」与「壁纸中下方大块黑色图层」。

- **带效果的木偶对象回退成整图 quad（人物部件凌乱根因）**：W4 旧取舍把
  带效果的 puppet 赶回 image 路径平铺整张部件 atlas（3735447194 泡-中
  系列）。对部件散列 atlas（3784528825 Girl 20 效果 / Dragon Head 5 效果）
  等于把四肢、头发、飘带散一屏。修复：木偶恒走网格路径；效果链按官方
  语义在【贴图集空间】先跑（waterwaves 等的 mask 画在 sheet 空间——本场景
  Girl mask 1369×1370 = sheet 2738×2741 半分辨率可证），present 时网格
  采样链输出 FBO；无效果木偶逐位同旧行为。3735447194 两个带效果手部木偶
  （05手-下/06手-上）同法修正，目检拼装正确。
- **colorBlendMode 9（BlendAdd）未支持 → 黑底水纹层裸上屏（黑色大块根因）**：
  ripple1440p 层底图 86% 不透明黑（alpha=255 全图），官方靠 cbm 9 加性合成
  隐形黑底、只留波环高光；GL present 此前一律 SRC_ALPHA/ONE_MINUS_SRC_ALPHA
  → 整层黑盒压在中下方。修复：清单真实下发 cbm 9，present 对该对象切
  SRC_ALPHA/ONE（未夹取时与官方 `mix(A,min(A+B,1),α)` 逐位等价），画完即恢复；
  其余非 0 模式维持默认渲染 + degraded 标记。
- **workshop 2655151285 水效 shader 严格 GLSL 编译失败（黑盒第二根因）**：
  官方引擎的宽松编译器放行的写法（int 字面量×float、`float mask = 1;`、
  `vec2(1 - g_X)`、`1 / (1 - t)`、vec4 实参截断）在 ANGLE 全报错，整链
  被剔除后 ripple 层退回裸贴图。`_weGLAssemble` fixup 表新增 8 条覆盖
  waterflow/waterripple/perspective/opacity（workshop 包）与旧版 shimmer
  （`rotateVec2(v_TexCoord…)` vec4 实参、`vec3 x = texSample2D(...)` 截断）。
  修复后水面波纹正常流动（水流/涟漪/透视全部生效）。
- **材质常量 uniform arity 以链接器为准**：元注释 `"type":"color"` 恒产
  4 分量，而 shader 实际声明多为 vec3（g_SpecularColor/u_color）——
  uniform4fv 每帧 GL_INVALID_OPERATION 且该常量从未生效。构建期按
  ACTIVE_UNIFORMS 实际分量数裁剪/补齐（仅 matUniforms 通道）。
- **引擎协议 `dsh-we-scene-gl/9` → `/10`**（cbm 下发 + 木偶路径变化），
  host/client 需同版本（握手不符自动回退静态帧，静态帧已是 0.8.10 修复版）。

## 0.8.10 — 场景静态帧部件坐标拼接异常根修 (3784528825)

- **DXT5 mip 2 的幂填充未裁剪（部件错位/压扁主因）**：WE 的 TEX 容器把原始
  格式 mip0 填充到 2 的幂存储（3840×2160 的图存在 4096×4096 的 DXT5 mip
  里，TEXI 头的 image rect 才是真实内容，左上锚定）。`pkg-extract` 的
  `decodeTex` 此前把整张填充 mip 当图层内容返回，提取器拼合再把它缩放进
  quad —— 3784528825（Jinhsi Peach Blossom）背景被垂直压进上半屏、右侧
  留出清屏色条、各图层坐标整体偏移。修复：`decodeTex` 对全部原始格式
  （RGBA8888/R8/R16F/RG88/RG1616F/DXT1/3/5）解码后裁剪到 TEXI image rect，
  与 `scene-manifest.js` 的 `cropToImageRect` 语义对齐。GL 路径不受影响
  （客户端按实际上传图尺寸与 header 尺寸自洽计算 UV）。
- **拼合跳过木偶对象（部件 atlas 整图乱叠根修）**：木偶对象的 image json
  指向「部件 atlas + 网格骨架」（`puppet` 字段），其材质纹理是散落部件的
  打包图；CPU 拼合把它当平面 quad 整图贴上画布 → 四肢/飘带散一屏。拼合
  现在跳过木偶对象（GL 路径经 `/scene-puppet` 网格渲染，本就不受影响）。
- **质量门透明像素口径**：`frameQuality` 跳过全透明像素（精灵/部件图
  大面积透明，其透明区 RGB 是无意义填充，此前计入采样导致裁剪后的真实
  精灵被误判为"平坦帧"拒绝 — assets/presets/fern preview 回归）；全透明
  帧仍拒绝。
- **静态帧缓存键 sf38 → sf39**：旧管线产物全部作废重提。

## 0.8.9 — 同 shader 多效果实例 mask 串键修复

- **GL 效果纹理键冲突（3427824116 头发不摆、两侧乱摆根修）**：对象挂两个
  使用同一 shader 的效果时（如「图层 1」双 foliagesway —— 两侧花丛 mask
  + 头发 mask），效果纹理表以 `shader:槽位` 为键，两个实例键完全相同，
  并发加载互相覆盖、后完成者赢（赛车）—— 两个 pass 绑同一张 mask 渲染：
  一张 mask 区域摆两次、另一张区域完全静止，观感酷似"沿用了上一张壁纸
  的特效"。A→B 轮换时被误读为串特效；实则为该壁纸每次渲染必现（哪张
  mask 赢由加载赛车决定）。修复：键改为 mask 路径（唯一且同路径天然
  共享，与 loadOne 去重口径一致），读写两侧同步切换；无 path 的
  previous/chain 标记槽语义不变。

## 0.8.8 — 轮换「就绪后切换 + 交叉渐变」

轮换体验重做：此前定时器到点即落实切换，新壁纸的视频加载 / 场景静态帧
提取 / GL 编译全发生在切换之后，背景先黑场/半成品再逐渐就位，且切换是
硬切。现在下一张壁纸完全 ready 才落实切换，并以 1.2s 交叉淡化上屏。

- **就绪后切换（仅轮换路径）**：到点后进入后台准备管线 ——
  图片解码完成（img onload）、视频可播放（detached video canplay）、
  场景静态帧提取完成（GET frameUrl 触发 host 提取，onload 即完成）、
  GL 场景首帧渲染完成（staged 渲染器挂在 opacity:0 但 in-DOM 的驻留层里
  预渲染，IntersectionObserver 几何相交故渲染循环正常运转）—— 就绪才
  applySelection。优先级不变量保持 sceneVideo > GL > 静态帧，逐级回退。
- **就绪元素随提交走（黑屏闪烁根修）**：探测用的 img/video/iframe 元素
  本身在 commit 时被新层直接领养（GL canvas 走 staged 领养通道），绝不
  另建空白元素重新加载 —— 上屏即是已解码画面；视频一律带 poster=预览图
  覆盖抽帧转码 swap 的空窗。
- **GL 预渲染领养**：staged 渲染器 ready 后由 applySelection 直接接管
  sceneGL 槽位（跳过二次 meta/shader fetch 与初始化等待），收尾与
  trySceneGLNow onReady 等价（resize 观察/降级清单/视口补偿/抓帧回填/
  诊断钩）；staged 失败沿用 glFailed 封印 + 降级提示条，回退静态帧探测。
- **提交以准备期实测为准（三段闪烁链根修）**：准备管线记录实测结论
  （sceneVideo / GL / 静态帧…）。修复前 sceneVideo 探测 404 回退 GL 后，
  applySelection 仍按清单复活 sceneVideo —— 已就绪 GL 被误判销毁、新层
  video 必然再次 error 硬重建、GL 二次初始化再硬重建，一次切换三段闪烁。
  现在实测不可用的 sceneVideo 在提交时置 null，轮换提交不再事后重试
  GL，一次轮换只有唯一一次渐变重建。
- **交叉渐变**：提交时新层 opacity 0 → reflow → 1.2s 淡入；旧层不立即
  拆除 —— 旧视频/旧 GL 渲染器保活继续播（真交叉淡化），渐变结束统一
  移除并释放（任何时刻最多 2 层，快速连切即时退役上一份）。
- **轮换锚点 = 实际显示（A→B→A→B 乒乓根修）**：跨窗 storage 同步只改
  selection.id 不重建层，以其为锚会把"正在显示的"当作下一张再切回去。
  锚点改为按 selection.url 反查当前上屏壁纸，多窗口各自独立单调轮转。
- **健壮性**：候选坏壁纸（img/video error、帧提取 422 + preview 也挂）
  自动跳过链式尝试下一个（有界于候选数）；各阶段 20s 超时兜底
  （慢网络/慢提取提交兜底，GL 超时降级静态帧）—— 轮换永不静默卡死；
  手动切换/关闭轮换/改列表即时取消进行中的准备（staged GL/probe 全释放）；
  提交前再校验（轮换仍开/未被手动抢占/候选仍可播未隐藏）。
- 手动点选行为不变：即时切换、无渐变（即时反馈优先）。
- 开发钩子：localStorage.weRotationTestSec（秒）可临时覆盖轮换间隔
  （冒烟测试/手动预览用），未设置时按组间隔正常运转。

## 0.8.7 — resize 补全: FBO 链随画布重建 + 视口诊断钩子

用户实测 0.8.5/0.8.6 "小分辨率刷新 → 全屏 → 模糊, 再刷新才正常"。定位:
resize 链路确有触发, 但 renderer.resize() 不完整 — 对象效果链 FBO
(fboA/fboB) 只在 buildResources 按创建时画布预算分配 (s=min(1,CW/tw,CH/th)),
resize 只重算了几何; 画布变大后效果链仍以旧小分辨率光栅化, present 拉伸
→ 全屏发虚。旧 1920 帽下 FBO 尺寸几乎从不变化, 该缺陷被预算帽掩盖。

- resize() 现按 buildResources 同款公式重建各对象 FBO (等比 clamp,
  失败降级为旧分辨率 + mark 披露)
- stats.viewportLog 记录最近 8 次 resize 尝试 (含被阈值拒绝的) +
  stats.viewport() 现场读 CW/CH/canvas; client 挂 __weSceneGL.diag()
  一键看预算链全貌 (viewport/budget/lastBudget/ready/canvas/observer)

## 0.8.6 — 视口变化检测改用 ResizeObserver（轮询退役）

0.8.5 的 2s 轮询兜底替换为标准 API — 变化信号覆盖矩阵（无轮询）：

- **ResizeObserver 观察 GL canvas（主信号）**：元素布局盒尺寸变化即触发,
  不依赖 window 事件 — 窗口缩放/缩放级/容器重排等布局成因全覆盖;
  回调在绘制前送达; 生命周期跟随 GL 会话（observe/disconnect 随
  trySceneGL/dispose）, GPU 崩溃加固的"失败后无残留监测"断言语义不变。
- window resize 事件 + matchMedia resolution（dpr 跨屏变化 — 元素盒
  尺寸可能不变只有 dpr 变, RO 不触发, 由这条补）。
- onReady 补偿（GL 初始化窗口期的事件吞没, 0.8.5 引入）。
- 预算比对早退 + renderer.resize 阈值内零触碰 canvas — 重复信号无成本。

## 0.8.5 — GL 渲染分辨率跟随窗口（视口预算修复 + 轮询兜底）

两处叠加的分辨率问题（复现: 首启小分辨率 → 窗口全屏 → 壁纸模糊, 刷新才清晰）:

- **视口预算解锁**：GL 画布预算原被钉死在 1920×1080 (GL 引入期的保守帽),
  2K/4K 屏上整屏 CSS 拉伸发虚且窗口越大越模糊。改为视口物理像素
  (CSS×dpr), 绝对上限 4K — 渲染器 WE_GL_MAX_DIM=4096 本就按此设计。
  实测 2560×1440 屏从 1920×1080 → 2560×1440 原生渲染。
- **resize 事件吞没修复**：GL 初始化窗口期 (meta fetch + shader 编译,
  1~3s) 内到达的 resize 事件被 apply 的 ready 检查早退丢弃 → 画布停在
  初始小分辨率。三路保障: onReady 瞬间按当前视口补一次 (确定性修复) +
  window resize/dpr 事件 (即时) + 2s 轮询兜底 (用户决策; 生命周期跟随
  GL 会话启停, GPU 崩溃加固的"失败后无残留轮询"断言语义不变)。
- **resize 零成本化** (scene-gl): sarFitFor 先算后赋, 阈值内的 resize
  完全不触碰 canvas — canvas.width 赋值即使同值也清空位图, 静态场景
  (P2-8 跳帧) 会停在空帧; 旧实现的"阈值内回滚"路径恰有此双写。
  轮询/事件重复调用 resize 现在是真正的 no-op。

## 0.8.4 — CPU 渲染全部屏蔽（决策再修订）

0.8.2 恢复的 CPU 渲染优先链经实测后用户拍板撤除：静态帧只走提取器
（0.8.1 修复版），GPU 抓帧回填保留（0.8.3）。CPU 渲染相关代码全部移除
（引擎模块与 0.8.0 移除后的基线一致；恢复方案留档于历史 4340e53）。

- `/scene-frame` 回到提取器唯一实现；缓存键 sf37→sf38
- we-renderer 引擎模块 (core/image/text/particles/model/mdl/camera/
  bloom/textures/effects/glsl executor 等) 与 scene-renderer.js /
  scene-render-worker.mjs 再次移除; puppet.js 恢复 GL 专用裁剪版
- 保留: HEAD 缓存探测、PUT GPU 抓帧回填 (仅空槽)、负缓存、in-flight
  去重、客户端 GL 接管后中止底图请求
- 行为面: GL 开 → GPU 实时 + 抓帧建缓存; GL 关/失败 → 提取器静态图;
  无纹理场景 422 → 预览回退 (0.8.1 实测 56/177 可出帧, 真实 7 张全部 ✓)

## 0.8.3 — 静态帧缓存：GPU 抓帧回填 + CPU 兜底按需触发

0.8.2 的余留问题：GL 可用时客户端仍无条件预取 frameUrl 底图 → 每张壁纸
首次选中都会白跑一次 CPU worker 渲染 (4~30s CPU 尖峰, 结果被 GL 覆盖)。
按用户决策落地"每壁纸一份缓存, CPU/GPU 皆可创建, 仅空槽写入":

- **GPU 抓帧回填**：GL ready 后 2.5s (对齐 CPU 渲染 time=2.5, 粒子/效果
  已展开) 从 canvas 同帧 `readPixels` 抓 PNG → `HEAD /scene-frame` 探测
  空槽 (204) 才上传 → `PUT /scene-frame-cache/<token>` 写入 sf37 槽。
  已有帧 (CPU 先渲染过) 零开销跳过; 任一步失败静默放弃。
- **CPU 兜底按需触发**：GL ready 即撤底图 img 的 src → 宿主 N-02 等待者
  归零 → 中止在跑的 CPU worker 渲染。GL 可用时 CPU 渲染不再落盘; GL
  失败回退时层重建重设 img.src, 链路不变。
- **首写胜出**：worker 渲染完成时若槽已被 GPU 帧占用则丢弃结果; PUT 也
  只写空槽 — 两条创建路径互不覆盖。
- `scene-frame` 支持 HEAD (纯磁盘探测, 绝不触发渲染); PUT 校验 PNG/JPEG
  魔数 + 32MB 上限 + token 白名单。
- 首次空窗 (完全无缓存) 维持现状不加垫图 (用户决策)。

## 0.8.2 — 静态帧恢复 CPU 渲染（决策修订）

0.8.0 把提取器（多图层拼合）提为唯一静态帧实现后实测暴露：该分支在 0.7.1
只是 worker 崩溃兜底、从未被真实壁纸执行过，转正即翻车（y 翻转 / PNG 12MP
解码门 / 画布 33MP 上限三连，0.8.1 已修但能力面仍窄——无粒子/文字/特效，
SDK 纯粒子场景全 422）。决策修订（详见 `docs/plan-remove-cpu-render.md` 修订节）：

- **`/scene-frame` 恢复两段式**：CPU 引擎（SceneRenderer）worker 单帧渲染
  优先（含粒子/木偶/文字/shader 效果，即 0.7.1 的静态帧质量），失败回落
  提取器拼合（0.8.1 修复版）。缓存键 sf36→sf37。
- **只恢复静态帧，不恢复烘焙**：scene-anim / APNG / mp4 raw 多帧链、
  betaSceneAnim 开关、渲染进度条 UI 均维持删除；worker 只剩单帧模式。
- **脚本执行维持删除**：core.js 本地 sceneHasScripts 谓词 + 恒不执行；
  degraded 文案对齐"静态渲染不支持脚本"。
- 客户端取帧时机不变（选择即取，GL 就绪后淡入覆盖）：首次选择付一次
  4~30s 的 worker 渲染，之后磁盘缓存命中（0.7.1 同款行为）。
- we-renderer 引擎模块自 pre-removal 基线整体恢复（puppet.js 取消裁剪 —
  对 GL 路径纯增量）；打包 files 白名单补回 scene-renderer.js /
  scene-render-worker.mjs。

## 0.8.1 — 8K 工程静态帧只剩天空雾层

`3427824116 胡桃-窗前`（投影 8192×4608）：天空/图层 1 两个 37.7MP 内嵌
PNG 在拼合 Pass 1 全被静默判为解码失败——`decodeTexToRgba` 复用的
`decodePngPayload` 带着 12MP 质量门上限（那是给 `pngQuality`"超限即信任"
设计的），两层全弃 → 拼合弃用 → 回落单纹理路径输出天空雾图。

- **真解码上限与质量门分离**：`decodePngPayload` 增加 `maxPixels` 参数
  （默认仍 12MP）；`decodeTexToRgba` 传 64MP（与 JPEG 路径对齐）。
- **拼合超限缩放**：画布超 33.2MP 硬上限时不再整帧放弃，按比例均匀缩放
  画布与全部图层到 4K 预算（3840×2160）再拼合，层间几何不变。
- 附带修复：隔行（Adam7）PNG 拒绝解码（防错位像素）；RGB PNG 载荷补
  alpha=255（此前 source-over 拼合整层不可见）。
- 新增 `scripts/verify-all-wallpapers.mjs` 全库端到端验证（视频/GL 门/静态帧）。

## Unreleased — 移除 CPU 渲染路径：GL-only + 静态图回退（破坏性变更）

场景壁纸渲染优先级变为 **内嵌视频 > GL 实时 > 静态图**。CPU 软件渲染链
（we-renderer 引擎 + worker + scene-anim mp4/apng 烘焙，~11.8k 行）全部移除，
决策与依赖审计记录见 `docs/plan-remove-cpu-render.md`。

- **行为变化**：无 WebGL2 / GPU 崩溃环境从"分钟级 CPU 烘焙 mp4 动画"退化为
  静态图（提取器多图层拼合）；GL 失败自动回退并显示降级横幅。
- **配置页 4 开关 → 2**：新增「GL 实时渲染」（默认开，关闭 = 纯静态图）；
  「未测试特效放行」默认改开；「beta场景动画」「运行壁纸内嵌脚本」
  「GL 降级渲染」删除（设置键 betaSceneAnim/enableSceneScripts/sceneGLDegrade
  静默丢弃，等价全员升级 GL on）。
- **内嵌脚本不再支持**：GL 快照式架构从不加载脚本（时钟/时段类脚本冻结为
  存盘值，横幅披露"GL 渲染不支持脚本"）。
- **性能**：不再有分钟级后台 CPU 光栅化与 ffmpeg 烘焙；启动时一次性清扫
  旧 scene-anim 缓存产物（san_* / *.prog）。
- 视频壁纸转码（抽帧/进度条）、内嵌视频场景、壁纸库缩略图（preview.jpg）
  均不受影响。


## Unreleased — Linux/Intel GPU 崩溃链加固

实测复现路径：窗口被其它全屏应用遮挡（X11 下 Chromium 不做遮挡检测，页面
仍"可见"）→ GL 场景持续满帧渲染 → i915 GPU reset（`GL_GUILTY_CONTEXT_RESET_KHR`，
GPU 进程 exit 8704）→ 遮挡期间连崩两次烧完重建额度 → GL 会话级永封 → 切回
后壁纸灰色，必须刷新恢复。

- **`pauseOnBlur` 默认开**（原 false）：失焦即暂停渲染/解码，遮挡期间 GPU 归零，
  从源头掐断崩溃链。旧存档一次性迁移**在 host/local 合并之后**对最终生效值判定
  （`loadPersisted` 末尾，独立 localStorage 标记；host 是事实源且 PUT 是全量替换，
  旧版早把默认 false 落进 host —— 只迁 localStorage 会被 host 合并盖回，存量
  GL 用户拿不到保护），翻转后立即回推 host；迁移后手动关闭仍被尊重；
  host `sanitizeSettings` 镜像同步。
- **前台恢复重试**：回到前台（可见且聚焦）且层仍停在静态帧（mp4 兜底已接管时不
  动）时，`contextlost*` 类失败自动清 sessionStorage 失败标记并重试 GL；重试前
  取消在途 scene-anim 升级（防渲染完成后 trySwitch 把活 GL 按违反
  sceneVideo > GL > CPU mp4 优先级切回 mp4）。防崩溃循环双重限：每 token 每
  页面会话只自动重试一次 + 30s 全局冷却；内容性失败（unsupported/render-fatal
  等）不自动重试。
- **重建额度自动恢复**（scene-gl）：contextrestored 重建成功后稳定运行 60s 重置
  `rebuiltOnce`，多次独立 GPU 崩溃各有一次重建机会，不再两次崩溃即永封。
- 壳层（dsh-my-ui `src/main.js`）：`disable-gpu-process-crash-limit`，防 GPU
  进程连崩后 Chromium 本会话永久禁用硬件加速、回落 SwiftShader 连累 GL 预检。

## 0.7.0 — Coexistence v1：与 dsh-web-ui-all（皮肤中心）二选一互斥

### 新增
- **外观归属状态机**（`appearanceOwner: "plugin" | "skin"`，host 持久化）：默认
  `plugin = 无条件全量生效`——液态玻璃/配色/侧栏玻璃/字体不受皮肤在场影响
  （v0.7.1 取消自动让位过渡态）；显式选择 `skin` 才进入完全待机，且在另一壁纸
  引擎在播期间保持待机、无冲突时自动接管（页面不留无外观源空窗）。
- 设置页「外观归属卡」：探测状态展示（皮肤 id / 自定义主题）、双按钮切换、契约上报开关。
- 双引擎阻塞选择卡：双方壁纸同时运行时强制二选一；基于归因判据「无皮肤却存在 backdrop 标记 ⇒ 对方内置 WE 控制器在播」，第三方占用 `data-dsh-wallpaper-active` 同样触发。
- 契约上报（可关）：owning 时向 html 写 `data-dsh-wallpaper-active`、向 body/html 写 `data-dsh-backdrop-active`，令 skin-center 的 composer 中和器与表面半透明化正确协作；所有权受控（只撤除自己置位的标记）。

### 兼容加固
- portal 打标不变量：所有 body 级动态根（层/scrim/拉绳宿主/模态/卡片）插入即带 `data-dsh-plugin="dsh-plugin-wallpaper-engine"`，被 skin-center 表面打标规则豁免。
- z-index 平手修正：更新提示 1100→1090（避让 web-ui-all 移动端侧栏抽屉）、picker 模态 1000/1001→1005/1006（避让详情覆盖层）；≤768px 且对方抽屉展开期间隐藏拉绳与提示。
- 字体补丁并入状态机：yielding/idle 不再注入 `we-font-patch`，全页字色交还皮肤主题。

### 性能
- SliderRow 输入合帧：拖动期间每帧最多提交一次（此前每 tick 全量持久化+applyEffects×2+整树重渲×2），组合多插件观察器场景显著降载。

### 工程
- `scripts/verify-coexist.mjs`：39 项 headless 断言覆盖相位门控快照、idle 卸载/恢复闭环、上报所有权、阻塞卡决策路径、portal 打标静态不变量等；已并入 verify 链路。

### 兼容基线
- 实测对象：@linxin666/dsh-web-ui-all@0.3.5 / @linxin666/dsh-client-ui-skin-center@0.3.5。上游语义属性若有变更，自检日志会给出保守降级（按“无皮肤”处理）。
