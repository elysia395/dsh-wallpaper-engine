# Wallpaper Engine 官方引擎逆向 — 技术细节

> 本文记录 wallpaper64.exe（官方渲染引擎）的逆向方法、关键地址与已确认数学。
> 以官方引擎为**事实基准**复刻 WE 场景渲染，避免参数猜测。

---

## 1. WE 原版位置

| 项 | 路径 |
|---|---|
| 官方引擎 | `C:\Program Files (x86)\Steam\steamapps\common\wallpaper_engine\wallpaper64.exe` |
| 32 位引擎 | 同目录 `wallpaper32.exe` |
| Workshop 壁纸 | `C:\Program Files (x86)\Steam\steamapps\workshop\content\431960\<workshopid>\scene.pkg` |
| 引擎配置 | `wallpaper_engine\config.json`（按 Windows 用户分节） |
| 引擎日志 | `wallpaper_engine\log.txt` |
| 辅助进程 | `bin/wallpaperservice64.exe`（渲染服务）、`bin/wallpaperui.exe`（UI） |

**命令行**（wallpaper64.exe，单实例启动器——转发给已运行实例后退出）：
```
wallpaper64.exe -control pause|stop|play|mute|unmute
wallpaper64.exe -control openWallpaper -file <scene.pkg路径>
wallpaper64.exe -control workshopid -id <workshopid>
wallpaper64.exe -screensaver|-host|-preview
```

---

## 2. 逆向工具链

### 2.1 环境
- exe 为 x64 PE：ImageBase `0x140000000`，**.text VA=0x1000 ↔ Raw=0x400**（偏移差 0xC00）。
- 字节扫描地址换算：`真实地址 = 0x140000000 + (fileOff - 0x400 + 0x1000)`。
- 反汇编：`objdump -d --start-address=0x140XXXXXX --stop-address=0x140YYYYYY wallpaper64.exe`。

### 2.2 函数边界（pdata）
`.pdata` 段（VA=0x4EA000, Raw=0x4E1C00）的 RUNTIME_FUNCTION 表（12B/条：
BeginAddress, EndAddress, UnwindInfoAddress）可反查任意地址所属函数。
已知函数边界：
| 函数 | 地址区间 | 作用 |
|---|---|---|
| 定位数学 | 0x1401EC25A-0x1401EC41F | origin×0.5×M → 写 0x9f0 |
| M 矩阵链 | 0x14014774B-0x140148477 | 骨骼矩阵链乘法（origin 槽 0x2f0 参与） |
| 对象提交 | 0x1401E8ED9-0x1401EA24E | 矩阵B(0x384)/M(0x344) 复制、0x304 标志测试 |
| 相机矩阵构造 | 0x14017FCFC-0x1401816CC | view/proj 缓存构造（0.5 常量） |
| 相机矩阵应用 | 0x1401ED0D0-0x1401EDB1B | 读 0x178/0x17c 做矩阵乘（eye 相关） |
| 矩阵 helper | 0x14005F5B0-0x14005F5F3 | 返回 rcx + edx*16（取矩阵行） |

### 2.3 逆向脚本（本地 `scripts/reverse/`，不入库）
- `pdata-map*.mjs`：目标地址 → 函数边界。
- `matrix*-write.mjs`：对象矩阵区（M/矩阵B/0x8f0/view-proj 缓存）写入点。
- `find-*.mjs`：xref / 投影 / eye / 骨骼 / 字符串定位。
- `read-*.mjs`：字符串与常量读取。

---

## 3. 已确认的官方数学

### 3.1 定位数学（0x1401EC338，函数 0x1401EC25A-0x1401EC41F）
```
定位矩阵(0x9f0-0xa2f, 完整4×4) = origin(0x2f0/0x2f4) × 0.5 × M
0.5 = 常量 0x1404926C0 —— 固定场景→画布缩放
M = 对象 0x344-0x37f（由 0x1401E9609 从 0xc8+0x8f0 复制）
0x9f0 第4行 = M 第4行（0x374 movups 原样 → 0xa20）
```
- 结果被 0x1400D9537 复制到输出顶点矩阵数组。

### 3.2 M 的来源（0x1400D4200-0x1400D43C5）
```
0xc8+0x8f0 = 0x30 × (0x38 × 0x40)
  0x930-0x960 = 0x38 × 0x40
  0x8f0-0x920 = 0x30 × (0x930-0x960)
```
- **0x38/0x40**：渲染时压栈 ← **0x1160/0x11a0 相机矩阵缓存**。
- **0x30**：对象世界矩阵——默认单位阵（无 0x20 标志），或从调用者复制。
- 矩阵B（0x384）= rsi 矩阵复制，同源也写入 0xc8+0x30。

### 3.3 puppet 特有：origin 骨骼链（0x140147F31，函数 0x14014774B-0x140148477）
- 对象矩阵数组与骨骼矩阵做链乘法，**origin 槽（0x2f0）被骨骼矩阵 2×2 旋转
  变换后写回**（0x140147FC4，无平移）。
- image 无此路径 → **puppet 与 image 定位差异的结构性来源**。

### 3.4 背景跳过视图
- 0x304 标志（bit 0x1100）区分路径 → 背景（size 达场景正交尺寸）不经 -eye。

### 3.5 视图平移（sf32 定论）
```js
_viewShift(o, size, ps) {
  if (isBg || !this.camEye) return [0, 0];
  return [(-this.camEye[0]) * (ps?ps[0]:1), 0];  // 仅 x 分量
}
```
- **y 分量 = 0**（用户与官方渲染对比确认）；sf29 曾按标准 LookAt 推导
  `vs[1]=+eye.y×ps`，实测与官方相反 → 移除。
- 相机对象（`camera:"default"`）驱动的 eye：origin 完整位移（x+y），
  用于"先上移再拉远"式开屏运镜（origin y 负→上移、正→下移 + zoom 拉远）。

---

## 4. 待确认问题

- **Q4** 0.5 与 DSH ps 的等价性边界（粒子 projScale 等路径）。
- **Q6** 0x384 矩阵B 用途（image 路径 origin×0.5×矩阵B → 0x970）。
- **Q8** 多 `camera:"default"` 对象的选择/叠加语义（官方实机渲染确认）。

  **对象分类逆向（0x140190180-0x140190820，场景对象创建分派）**：
  | 对象属性 | 分配大小 | vtable | 备注 |
  |---|---|---|---|
  | `sound` | 0x320 | 0x140490ae8 | 声音对象（不渲染） |
  | `camera:"point"` | 0x360 | 0x140490980 | 注视点/光源点类 |
  | `shape:"light"` | 0x460 | 0x140491d10 | 光源（0x304 \|= 0x2000） |
  | `sprite` | 0x270 | — | — |
  | **`camera:"default"`** | 默认通用 | **0x140491c38** | **无专用分支**，类型码 0x2c0=5，无渲染内容 → 仅 origin/zoom 动画被相机系统读取（消费处未定位） |

  **Mutsumi Dock（3629379075）多相机证据**：两个 `camera:"default"` 对象
  （id 216 无名 / id 1297271 "入场镜头"），各自 origin/zoom/scale 动画 +
  `path` 字段（引用 `scripts/camera_paths_<id>.json`，实测均为空 `{"paths":[]}`）+
  `visible` = 用户属性 `hrbrbbrentryanimation`（scene.json scriptproperties 默认
  true，NSL 脚本开关"enableAnimation"控制）。preview.gif（31 帧 207×207）前
  22 帧完全静止 → 官方 preview 渲染相机固定，无法反推运镜。相机对象消费
  /多相机选择代码未定位（相机矩阵构造 0x14017FCFC 读内部相机结构，来源待确认）。

---

## 5. 动画语义实证（官方 preview.gif 为事实源）

### 5.1 场景属性动画 relative 语义
- scene.json 对象属性 `{animation: {c0/c1/c2: 关键帧, options: {fps,length,mode}, relative: true}}`。
- **`relative: true` = 关键帧值是相对基准值的偏移**，最终值 = 基准 + 偏移（逐分量）。
- 向量动画通常 c0/c1/c2 三通道齐全（scale/origin）；标量动画（alpha）只有 c0。

### 5.2 单通道动画不得误判为 vec3
- `hasMulti` 判断仅当存在 c1/c2 通道（或 c0 值本身是 "x y z" 字符串向量）时
  才走多通道求值；只有 c0 的 alpha 动画输出标量。

### 5.3 preview.gif 时间轴与场景 t 的关系
- workshop `preview.gif` 是官方引擎生成的竖条拼接动画（页 0 = 全部帧，
  顶部对齐；帧 f 位于 top=f×frameH）。sharp 读 page 0 raw 后手动裁剪。
- **preview 首帧不一定对应场景 t=0**（开屏动画：黑幕淡出 / 角色入场 /
  相机运镜的时间轴需逐壁纸用亮度/关键对象出现时刻反推）。

### 5.4 camera:"default" 相机对象
- 部分场景含多个 `camera:"default"` 对象，带 origin/zoom 动画
  （入场镜头：origin x/y/z 关键帧 + zoom 拉远）。
- 官方可能用此类对象驱动相机（eye/zoom）；DSH 在 scene.camera.eye 为默认
  (0,0,0) 时用其 origin 作 eye，zoom 接入正交 camProj。

### 5.5 官方 shader 源码（assets/shaders/）
- **渲染数学以源码随发行版发布**：genericimage2/4.vert 蒙皮
  `localPos = mul(vec4(a_Position,1), Σw·g_Bones)`（行向量）与 DSH `_skinPuppet` 一致。
- image 层 uniform 含 `g_LayerModelMatrix`（独立层矩阵）。

---

## 6. 动画层合成（组件错位主因之一）

### 6.1 animationlayers 多 visible 层合成
- 场景对象 `animationlayers: [{additive, blend, rate, animation, visible}]`。
- **官方语义（数学推导）**：全部 visible 层按序参与合成 —
  - 普通层（additive=false）：`final = mix(final, layerWorld, blend)`（blend=1 → 替换）
  - additive 层：`final += (layerWorld − refWorld) × blend`，refWorld = **层动画帧0世界**。
- **additive 参考姿势 = 层动画帧0（非 bind）**：帧0处 additive 贡献为 0。
  多数 MDL 帧0 局部链乘 = bind 世界（此时两者等价）；个别模型骨骼帧0≠bind
  （差数十单位）→ 用 bind 作 ref 会在帧0 即引入常数偏移 → 蒙皮整体飞走。
- **动画层→动画映射**：层名"动画 N"（数字后缀）→ MDL 第 N 个动画；
  名字不匹配时按索引回退会选错动画。
- **rate** 加速层动画采样。
- DSH 旧实现只取第一个 visible 层 → 多 visible 层壁纸缺层错位。

---

## 7. 组件数据流（组件→图片哪部分 + 放哪里）

### 7.1 数据链（scene 对象 → 纹理）
```
scene.json 对象 {image, origin, size, parent, scale, angles}
  → models/xxx.json {puppet|material, autosize, cropoffset}
    → materials/xxx.json {passes[0]: shader, textures[0], combos}
      → materials/xxx.tex {TEXV/TEXI/TEXB: 尺寸, 格式, mip, TEXS 帧表}
```

### 7.2 组件 → 图片哪个部分
- **image 对象**：**整张纹理** — quad 顶点 UV = a_TexCoord（genericimage2.vert
  `v_TexCoord.xy = a_TexCoord`，0-1 全幅）；**size 通常 = 纹理尺寸**。
- **SPRITESHEET**（combos + TEXS 帧表）：`v_TexCoord = g_Texture0Translation +
  a_TexCoord × g_Texture0Rotation.xy/zw`——引擎设 Translation/Rotation 选帧。
- **puppet 对象**：**MDL 顶点 UV**（80B stride，uv@72,76）——网格顶点定义的
  纹理区域（通常覆盖大部分纹理，非全幅）。
- **cropoffset**：官方 exe 无此字符串（4 种大小写变体全无）→ **忽略**。
- **autosize**：官方 exe 存在 → 解析 model json 读布尔，true 时 size =
  纹理尺寸（size 缺失时回退纹理尺寸，等价）。

### 7.3 组件 → 放哪里
- **origin**（scene 对象）：场景坐标（正交）——image 中心语义、puppet 网格
  原点语义——画布 = origin×ps + viewShift（image/puppet vs[1] 一致）。
- **size**（scene 对象）：场景单位 → 画布 dw = size×scale×ps。
- **父链**：resolveTransform 累积（origin×祖先scale + 旋转 + 祖先origin）。
- **attachment 锚点（MDAT0001）**：子对象 `attachment` 字段把 origin 锚定到
  父 puppet 的命名 MDAT 锚点（骨骼最终世界位姿 + 锚点矩阵 + 自身 origin）。

### 7.4 逆向方法（可复现）
1. 数据链追踪（scene→model→material→tex）。
2. 官方 shader 源码确认 UV/顶点语义（genericimage2/4.vert 行号引用）。
3. 官方 exe 字符串搜索确认字段存在性（autosize ✓ / cropoffset ✗ / spritesheet ✓）。
4. 实测：tex 尺寸 vs 对象 size（image=整张）；MDL UV 范围（puppet=网格区域）。

---

## 8. attachment → MDAT 锚点定位（官方 exe 确认）

**结论：子对象 `attachment` 字段把 origin 锚定到父 puppet 的命名 MDAT 锚点
（骨骼世界位姿 + 锚点矩阵），官方引擎真实存在。**

- **官方 exe 证据**：
  - 字符串 `MDAT0001`（旁有 MDLA0006/MDMP0001/MDLE0002/MDLS0004），解析代码
    比较魔数 → 读 u16 计数 → 逐条 `[u16 骨骼索引 + 名字\0 + 64B 矩阵]`
    存入锚点列表（MDL 对象+0xa8）。
  - 字符串 `attachment`，邻近 `setParent`/`getTransformMatrix`/`parallaxDepth`/
    `sortorder`/`Invalid parent configuration.`（场景对象属性分发区）——
    attachment 是官方场景对象属性。
- **实现语义**：子有效原点 = 父原点 + 骨骼最终世界位姿（动画层合成后）+
  锚点矩阵平移（按骨骼旋角旋转）+ 自身 origin。
- **逆向方法**：exe 字符串搜索（MDAT/attachment）→ 反汇编解析函数 →
  文件名匹配 MDL 锚点名字 → 渲染覆盖比例数值实验选语义变体。

---

## 9. GL 移植 spike 实证（test/scene-gl-spike，3295448069 全效果场景）

以 GL（WebGL2，无预处理直接编译 pkg 官方 ES 1.00 shader）与 CPU 渲染器逐点对
比（MAD 指标 + 效果隔离变体目录判别法）得出的官方语义裁决：

### 9.1 v 轴方向 = D3D y-down（spike 最大坑）
- 官方 shader 血统是 HLSL/D3D（`mul(v,m)` 行向量、`texSample2D` 宏）→ **v=0
  在图顶、纹理行 0 = 图顶**（与 GL 默认 flipY 约定相反）。
- GL 全链路 y-down 做法：纹理**不翻转**上传（tex 行 0 = PNG 行 0 = 图顶）；
  quad UV 顶边 v=0；效果 pass 的 MVP **y 行取负**（图顶 → NDC−1 → FBO tex 行 0，
  链内一致）；present pass MVP 正常（图顶 → NDC+1 = 屏幕上）。
- 反例：flipY 上传会让 waterripple.frag 的 `frac(v + g_Time·…)` 时间相位镜像，
  位移场整体翻倒（MAD 11+ 无法收敛）。

### 9.2 g_TextureNResolution 语义（lwe 可考 + 实测排除其余约定）
- **lwe（Almamu/linux-wallpaperengine）`CTexture::setupResolution` =
  (mip0.w, mip0.h, header.w, header.h)**。绝大多数纹理 header==mip0 → zw/xy=1。
- 判别实验①（效果隔离 MAD）：约定 (a) (w,h,1/w,1/h) 与 (b) (objW,objH,texW,texH)
  都会让 iris mask 缩放变成近似 no-op（违背作者画眼部 mask 的意图）→ 排除；
  lwe 约定下 GL vs 修正后 CPU MAD 2.88@960×540 / **1.25@1920×1080**（≈滤波地板）。
- **waterripple.vert 的 MASK UV 用 g_Texture2Resolution（normal 槽分辨率）缩放**
  ——lwe 约定下该缩放=1 → mask UV=纯 uv（作者意图：mask 与内容同坐标系，头部
  黑团=保护区）。旧 CPU 实现 maskW/texW(=0.5) 是近似错误（已修，见 9.5）。

### 9.3 ES 1.00 严格性：官方 shader 需 int 字面量修正
- 严格 GLSL ES 1.00 禁 int→float 隐式转换，ANGLE/SwiftShader 拒绝官方文本两处：
  `* 2 - 1`（waterripple.frag n1/n2 解码）、`smoothstep(1 - g_Rough, 1,`（iris.vert）。
  WE 官方编译器宽松放行 → **assembleGLSL 需定向 regex fixup**（`* 2 - 1` →
  `* 2.0 - 1.0` 等）。"唯一必需宏是 texSample2D" 的论断不成立。

### 9.4 angles：弧度直读 + 屏幕空间旋转语义
- **scene.json `angles` 是弧度**（lwe CImage.cpp:1097 注释明示 + glm::rotate(−angle,z)；
  CPU 渲染器一致按弧度用）。
- **正角 = 屏幕逆时针**（反旋拟合实测：GL 顶点空间需 r=−rad）。
- **旋转必须像素空间刚体**：NDC/本地坐标各向异性（16:9 画布），直接 rotZ 会把
  30° 压成 17.6°（tan⁻¹((h/w)·tanθ) 实测吻合）。正确做法 S⁻¹·RotZ·S（S=diag(dw,dh)）。
- lwe 未做像素空间修正（其正交投影处理不同），此点为 DSH 特有需求。

### 9.5 spike 顺带实锤的 CPU 渲染器 bug（均已修）
1. **Canvas.clear 无视参数**（canvas.js）——恒填 (0,0,0,0)，scene.json clearcolor
   从未生效；未覆盖区域透明黑而非场景底色（全幅场景无感，旋转/留边场景出错）。
2. **waterripple mask UV u·0.5**——见 9.2（修后头部不再被波纹穿透，符合作者意图）。
3. **waterripple 法线 z 未解码**——`nz = n1[2]` 原始 [0,1] 通道当 [-1,1] 用；
   官方为 `n1.z = n1.z×2−1`（本场景 z≈1 数值影响≈0，但语义修正）。
4. **iris mask 未采样**（更早会话已修）：官方 iris.vert 用 mask 纹理圈定生效区。

### 9.6 纹理环绕模式
- 官方 waterripple/normal/mask 均为 REPEAT（位移采样坐标本就跨 [0,1]）。
- 主图（g_Texture0）：CPU 对位移后 UV clamp；判别实验⑤实测 REPEAT vs CLAMP
  差异仅上下边缘 1-2px 带 → **跟 CPU 用 CLAMP**（无可考官方证据时跟已验收视觉）。
