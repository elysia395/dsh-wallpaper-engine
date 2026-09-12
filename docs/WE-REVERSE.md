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

### 6.2 未挂层 = 不播动画（0.8.15 实证）
- **对象的 `animationlayers` 是唯一的动画驱动源**：对象没有该字段（或全部层
  `visible:false`）⇒ 未播放任何动画 ⇒ 网格按 **MDLS 绑定姿态**渲染 ——
  这也是对象 `rect`（origin+size）与 raw 网格顶点一一对应的基准姿态。
- **反例（自造默认层0 的后果）**：`3302695207` 的 5 个 `人物` 对象都没有
  `animationlayers`，而 `人物_puppet.mdl` 的 MDLA **根骨帧0 恒为
  (864.231,−103.348)**、`MDLS` bind 根骨为 **(1311.230, +600.650)** ——
  差 (−447.0,−704.0) 场景单位、**全 121 帧相同**（常数偏移，非动画）。
  早期客户端兜底 `[{animation:0, blend:1}]` 会把这个偏移当姿态套上去 →
  整块网格平移 (−223,−352) 画布像素 → 人物下半身被推出画布下沿 411px、
  并脱开场景里独立摆好的 `扫帚`（其 rect 只与 bind 姿态对齐）。
- **判据（可复算）**：任意 puppet MDL 都能对比 `_ensureBindRig()` 与
  `_sampleAnimRT(mesh, anim0, 0)` 的各骨平移；相等 = 该模型的动画不改变摆放
  （库内 27 个带动画模型里 22 个如此），不等 = 该壁纸**必须**有层才会动。
- **库内普查（49 个 puppet payload）**：挂层的 38 个（3463520581 / 3593194513 /
  3735447194 / 3784528825 等）全部显式挂层 → 去掉"默认层0"兜底对它们零影响
  （payload JSON 逐字节相同）；未挂层的 11 个里只有本壁纸 5 个对象带动画。

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
- **实现位置（0.8.12 起）**：`lib/we-renderer/puppet-export.js` 的
  `parseMdatAnchors` / `buildPuppetAnchors` + `lib/index.js` gate 的
  `foldChain`（锚点偏移先于子 origin 累加，同受祖先 scale/旋转影响）。
  0.8.4 移除 CPU 渲染路径时该实现随之删除，GL 路径直到 0.8.12 才补回
  （3463520581 Asuna 部件错位根因：58 个带 attachment 的对象全部丢锚点）。
  - 骨骼位姿取 **绑定姿态**（MDLS bind 链）——无动画时与网格渲染口径一致。
  - **结论修正（0.8.13, 2026-09-12）**：0.8.12 记的「`hair back` +677 锚点残差」
    **不是锚点语义问题**，而是 **MDLS 骨骼条目解析截断**：`asuna body bottom`
    声明 7 根骨骼而解析只出 1 根 → 其 `Attachment bottom` 锚点的 `boneIdx=2`
    越界归零，躯干+头整组少走 (+230.3, +274.2) 父局部偏移（画面上就是"头/躯干
    往左下移"、"后脑与脸分开"、远处看两个头）。骨骼解析修好后同一条
    `world` 语义**零系数**对齐（before/after 元数据 diff：仅 6 个对象位移，
    全部 = `asuna body` 及其 5 个 `head` 锚点子对象的 (+240.7, +286.5) 场景位移）。
    此前"拟合出 0.55×"实为缺失骨骼项造成的假残差 —— 教训：锚点求值前先确认
    `boneIdx` 能解析（越界静默归零会把数据错误伪装成语义缺口）。
  - **MDLS0004 骨骼条目实测布局**（`models/asuna body bottom_puppet.mdl`）：
    `[tmp u8][type u32][parent i32][len u32=64][64B 行主序矩阵][0x00][名字]`
    —— **名字没有终止符**，直接接下一根骨骼的 `tmp`；无名骨骼则只有那一个
    `0x00`（旧实现按"跳过 1 个 0x00"解析，恰好只对无名形态正确）。定位下一根
    骨骼必须按"下一个合法头"扫描（`len` 合理 + `parent < 本骨序号` + 矩阵
    `m[15]=1`、无透视列），见 `puppet.js _nextBoneHeader`。
  - 反向验证对照组：KIRITO PUPPET 的 `Attachment` 锚点 ≈(2.7, −7.5) → 锚点
    几乎不生效，其 7 个部件不靠锚点即拼装正确（与右半侧目检一致）。
  - 锚点值空间自洽性检查（对后续排查有用）：除根 puppet 占位网格外，所有锚点
    点（骨骼世界平移 + 锚点矩阵平移）都落在**该模型自身网格 bbox 内**且位置
    语义合理（`asuna body` 的 `head` 锚点 (45, 369) 位于 985 顶点躯干网格的
    顶部 = 头部；`asuna body bottom` 的 `Attachment bottom` (233, 377) 位于
    872 顶点裙摆网格上缘 = 胸口）。根 puppet `puppet_puppet.mdl` 是 60×60
    占位网格，其 `hair back` 锚点 (8, 675) 落在网格外 —— 属该占位模型自身的
    数据特征（父级只提供"根锚点"语义，子级网格自己承担形状）。
- **逆向方法**：exe 字符串搜索（MDAT/attachment）→ 反汇编解析函数 →
  文件名匹配 MDL 锚点名字 → 渲染覆盖比例数值实验选语义变体。

---

## 8b. MDL 容器族与"图集排版姿态"（0.8.14，2686862510 部件脱离人物）

**结论：库内有两种 MDL 顶点记录布局，且旧容器 (`MDLV0013/0016`) 的 `MDLS` bind
姿势是"图集排版姿态"，渲染姿态来自 `MDLA` 首帧。静态帧必须按首帧装配，否则
部件停在图集排版位置（用户报的"左肩和披风脱离人物"）。**

- **顶点记录两族**（`pos` 恒在记录首 12B，差别只在 `pos` 之后有没有法线/切线区）：

  | 容器 | 记录 | 布局 | 库内 |
  |---|---|---|---|
  | `MDLV0021/0023` | 80B | `[pos 12][法线/切线 28][blendIdx 16][weights 16][uv 8]`（uv@72） | 36 个 |
  | `MDLV0013/0016` | 52B | `[pos 12][blendIdx 16][weights 16][uv 8]`（uv@44） | 3 个 |

  两族**互斥**（全库审计：52B 只有这两个容器命中，80B 只有新容器命中）→ 解析
  策略是"先 80B 主路径（条件与旧实现逐条一致），失败再 52B 紧凑回退"，紧凑
  回退额外校验 `Σw = 1` 与 `uv ∈ [−4,5]`（抽样 90%）以防噪声块误判。
- **网格 ≡ 图集**：两个文件都满足 `pos = (W·u − W/2, H/2 − H·v)`，逐顶点残差
  `0.0000`（2686862510 781 顶点）/`0.0002`（3022080536 2954 顶点，W=2156,
  H=3291）→ 网格顶点就是图集像素的搬运，**绑定姿势 = 图集排版姿势**。
- **渲染姿态 = MDLA 首帧**（实测）：
  - 2686862510 `本体_puppet.mdl`：骨骼 3/4/5 首帧世界 vs bind 平移差
    (+285.30, −3.32)/(−329.34, +30.20)/(+194.88, −799.69)（骨骼 0/1/2 = 0）
    → 左右披风片落到躯干 `x[−274..165]` 两侧同高位置、斗篷 `x[−167..651]
    y[−499..0]` 披身向右飘 —— 与作者 `preview.gif` 一致。
  - 新容器（34 个文件实测）：`bind` vs `帧0` 差 ≤0.03 单位（3593194513 /
    3735447194 / 3784528825）→ 新容器不烘焙，行为不变。
- **MDLA0001/0003 实测布局**（逐字节核对 2686862510）：
  ```
  "MDLA\0" + u32 段尾偏移 + u32 动画数
  per 动画: u32 id + u32 0 + 名字\0 + 循环标志\0
            + float fps + u32 frameCount + u32 0 + u32 boneCount
  per 骨骼: u32 0 + u32 segBytes + segBytes 数据        ← 每骨 8B 段头!
  行 = 9 float/36B: pos.x, pos.y, pos.z, ?, ?, rotZ, sx, sy, sz
  segBytes = (frameCount + 1) × 36 (末行 = 循环闭合行), 段步进 = segBytes + 8
  ```
  两个坑：① 既有实现用 **`[f0 41]` 魔数扫描**（= float 30.0）定位头部，
  `fps = 3.625` 时恒失配 → 整个 MDLA 丢弃；② 段**不是连续排布**，每根骨骼
  自带 8B 段头（`u32 0 + u32 segBytes`），按 `p + b*segBytes` 取段会从第二根起
  整体偏移。旧容器单骨整段（pos 列 0/1、rot 列 5），与新容器 `_sampleAnimRT`
  的列交错规则 (`(2b+5)%9`) 不同 → **旧容器逐帧动画不进入物化列表**，
  只用首帧的静态装配姿态。
- **实现**：`puppet.js _scanVertexBlock`（双布局）、`_parseLegacyMdla`、
  `_legacyPoseRT`、`_poseMeshByRT`；`puppet-export.js buildPuppetPayload`
  （`legacyContainer` → 烘焙首帧）/ `buildPuppetAnchors`（同口径骨位姿）。
- **回归证据**：39 个 MDL 解析审计只有这 2 个旧容器变化；47 个 payload
  JSON 逐字节相同；185 场景扫描 before/after 只有这 2 个场景 `degraded` −1。
- **遗留（未验证，不动）**：`MDLV0016 背景_puppet.mdl` / `MDLV0021
  bar_puppet.mdl` 仍无几何块（另一类问题）；新容器 `MDLA0006` 的段步进是否
  同样含 8B 段头**未审计**（MOD-05 的列交错疑点可能源于此，需单独验证后再动）。

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

## 10. lwe(linux-wallpaperengine,Almamu C++ 实现)对照裁决(2026-08,b016d7d)

第二批修复前以 lwe 全仓库行级对照,结论分三档(代理考古 + 作者逐条亲自核实)。

### 10.1 lwe 证实我们既有裁决(不变)
- **§9.2 g_TextureNResolution = (mip0/GPU 尺寸, 真实尺寸)**:CTexture.cpp:122-141
  (普通纹理解析 xy=mip0 实际、zw=header;动画=textureW/H+gifW/H;FBO 同构 CFBO.cpp:65)。
- **§9.6 wrap**:文件纹理默认 REPEAT、.tex 头 `ClampUVs(=2)` → CLAMP_TO_EDGE
  (CTexture.cpp:176-183);`_rt_*` FBO 恒 CLAMP(CFBO.cpp:26-35)——我们"效果链主图
  CLAMP"与官方 FBO 语义一致;直接文件采样 REPEAT 一致。FLAG 另有 Video=32。
- **v 轴**:WE 逻辑坐标左上 Y-down(CImage.cpp:1011-1014 渲染前翻 y;
  ddy(x)=dFdy(-x) 显式补偿);效果 pass NDC↔UV 恒等,FBO 间采样不翻转。
- **parent 折叠公式**:CImage.cpp:155-166 根向下 `子origin⊙祖scale→旋转祖angle→+祖
  origin`、scale 逐轴乘、angle 只加 z — 与我们 resolveTransform 一致(我们另有
  attachment 锚点扩展,lwe 未实现 MDAT)。
- **parallax 参考宽度**:x/y 同乘场景 width(CImage.cpp:1114-1118)— 与我们一致。
- **色彩空间(BASE-14 结案)**:lwe 全链 GL_RGBA8、零 GL_SRGB/pow → 降采样在 sRGB
  空间平均即官方行为,豁免取消,现状正确。
- **mul**:`#define mul(x,y) ((y)*(x))` 标准矩阵乘(ShaderUnit.cpp:30),非逐分量。
- **fmod**:trunc 版 `(x)-(y)*trunc((x)/(y))`(同文件),负数行为 ≠ floor-mod。
- **COMBO**:texture 派生 combo(如 MASK)=1 ⇔ 槽位实际绑定纹理(ShaderUnit.cpp:531-619)。

### 10.2 lwe 推翻/修正我们实现(已列第二批修复)
- **粒子寿命**:官方单 `lifetime` 字段(CParticle.h:76-79),我们 p.life/p.lifetime
  错位 → 统一 lifetime。
- **粒子初速**:boxrandom vel=0(CParticle.cpp:487-489);仅 sphererandom 径向
  `normalize(出生偏移)×random(speedmin,speedmax)`(626-636);sign 仅 sphere 且作用于
  出生偏移(614-623);**cone 官方解析但从未消费**(ObjectParser.cpp:605)→ 我们 P0-6
  的全 emitter cone 采样是发明语义,二次修正。
- **velocityrandom**:`p.velocity += vel` 且 `vel.y=-vel.y`(773-777)— 叠加+y翻转,
  我们原是赋值+不翻转+Math.random。
- **粒子步进**:官方真实 dt(≤0.1s/帧,CParticle.cpp:191-199),非固定 30fps →
  静态帧改 1/60 步进逼近。
- **alphafade(P1-4 结案)**:fadeintime/fadeouttime 是 **0-1 归一化寿命分数**
  (CParticle.cpp:1102-1134),我们实现本就按 0-1 → 豁免取消,仅字段名修正。
- **visible 字符串**:数值 !=0;字符串可 stof 按数值,不可解析(含 'true'/'false')
  → String 型 getBool 恒 false(DynamicValue.cpp:160-185)→ 裸 'true' 官方也隐藏。
- **ortho 回退**:projection 必填或 auto(包围盒→输出分辨率,CScene.cpp:41-69),
  无 1080 默认 → 我们 ||1080 改 ||输出高。
- **湍流**:确定性 curl-noise 场(NoiseUtils.h 固定置换表),每算子 phase/speed
  建时随机一次 → 我们改确定性噪声场。

### 10.3 lwe 未覆盖或与我们分歧(维持我们 exe 逆向结论/现状)
- **旋转方向(§9.4 维持)**:lwe `glm::rotate(-angle, z)`(CImage.cpp:1100-1104)
  净视觉 = 正角顺时针;我们 §9.4 经官方输出反旋拟合 = 正角逆时针。lwe 为第三方
  近似(其作者亦注明投影路径与官方不同,CScene.cpp:117-121),以 exe 拟合为准。
- **祖先 visible 传播(维持传播)**:lwe CImage::render 只查自身 visible;
  我们 CPU/gate 沿父链传播(编辑器组隐藏直觉 + App Launcher Dock 作者组件模式)。
  lwe 对 CText 甚至完全忽略父变换,说明其 parent 支持不完整,不跟随。
- **puppet 骨骼 g_Bones/MDAT**:lwe 无任何骨骼数学(puppet 仅静态网格)→ MOD 系列
  维持我们 exe 逆向。
- **MDLA 80B stride 中间 15 float(MOD-05 维持豁免)**:lwe 只读 pos@0/uv@72,
  其余未解释,仍需实测模型裁定。
- **bloom gen.hdr/HDR 通道/feather(P1-25 维持现状)**:lwe 相机 bloom 开→无条件
  base+bloom,无 HDR 支路 → 无法裁定,维持我们 gen.hdr 门控+注释。
- **ApplyBlending case 4 vs 20**:lwe 仓库无 common_blending.h 副本(头文件在 WE
  安装 assets/shaders/)→ 仍待官方源。
- **jpeg**:lwe 用 stb_image,我们自研差异自担。

---

## 11. 效果链以【效果】为单位编译（0.8.16，3302695207 背景整块变黑）

**结论：一个 WE 效果 = 同一 `dir` 的连续若干 pass，这些 pass 内部串联，必须整组
生效或整组不生效。** 只剔除"编译失败的那一个 pass"是错的。

- **实测结构**（3302695207 `snow0` 背景对象，官方 meta `dir` 字段）：
  ```
  waterflow            （1 pass）
  depthparallax        （1 pass）
  godrays              （5 pass：downsample2 → cast → gaussian → gaussian
                        [combos VERTICAL=1] → combine）
  ```
  人物对象同构：`waterwaves ×3 + shake + color_grading(workshop)`。
- **错误行为的后果**：实验开关打开时 `depthparallax`、
  `godrays_cast`（`'=' : cannot convert from 'const highp int'`）、
  `godrays_gaussian`（**shader 拉取失败 404/422：该 shader 不在壁纸包内，
  属 WE 内置 `assets/shaders/`**）、`godrays_combine`（`COPYBG` combo 预处理
  报错）全部编译失败，只剩 `godrays_downsample2` 成功 → 该 pass 的亮部提纯
  被当成整条链的最终输出 → **背景整块变黑，只剩太阳亮斑**（画布均值亮度
  113.5 → 21.6），人物正常 → 用户看到"人物正常但背景异常"。
- **修复**：客户端 `_weGLBuildPuppetMesh`/buildResources 侧按 `dir` 把
  `obj.effects` 切成连续组；组内任一 pass 无 program → **整组丢弃**（链输入
  原样传给下一个效果，与"未支持效果"同语义）并记一条 degraded
  （`效果的部分 pass 编译失败 (N/M)，整个效果已跳过（链输入原样传递）`）。
- **实测**：修复后同一配置下画布均值 21.6 → 113.9（背景恢复），
  `snow0` 只剩 `waterflow` 生效、`godrays`/`depthparallax` 整组跳过；
  人物侧只有 `color_grading` 被整组跳过（waterwaves/shake 逐位不变）。
- **零回归判据**：实验开关**关**时该改动只差 19 px（0.001%，纯时序抖动）；
  4 个既有壁纸（3463520581 / 3735447194 / 3784528825 / 2686862510）实验开
  前后差异 0.08%~1.96%，**低于同码重拍的对照抖动 2.52%** → 效果链全部编译
  通过的对象逐位不变。
- 备注：`godrays_gaussian` 属 WE 安装目录内置 shader，壁纸包内没有 → 该效果
  在本机**无法**完整运行；整组跳过是唯一不产生错误画面的口径。

### 11.1 粒子 `colorrandom`：整条 vec3 共用一个随机因子（0.8.17，官方实拍裁决）

- **lwe 现状**（我们 0.8.16 前照搬）：`createColorRandomInitializer`
  (CParticle.cpp:718) → `Maths::randomVec3` (Maths.cpp:13) = **逐通道各自独立
  随机**。
- **官方实拍反证**（3302695207 雪天，用户提供的 WE 运行截图）：雪花一律白偏蓝
  （最彩色样本 (163,211,231)/(204,236,246)），**没有任何绿/黄色点**；场景是深蓝
  夜景、不存在把绿点染成蓝的环境色。
- **我们照搬的后果**：预设 `particles/presets/snowperspective.json` 的
  `colorrandom` min=(255,255,255) max=(95,98,100)（作者本意"白↔浅灰"）在逐通道
  独立随机下会落到 (0.37,1.00,0.70) 这类高饱和色 → 实测雪花为
  (99,254,115) 绿 / (244,100,139) 粉 / (209,108,247) 紫 / (234,231,101) 黄，
  色度均值 61.9、最大 155.0。
- **修正**：单随机因子 t 在 min→max 间整条 vec3 线性插值；修正后同机
  `snow3` 单独层实测色度均值 **61.9 → 1.9**、最大 **155.0 → 5.0**，样本
  (104,107,109)…(142,143,144) ✓。
- **库内其它作者预设同样印证**（全部是"两色之间细微变化"，逐通道随机只会得到
  去饱和噪声）：3463520581 `Leaves (green)` (255,255,255)→(255,236,0)、
  3784528825 `Sakura` (255,255,255)→(255,192,248)、
  3593194513 `光束 2` (110,92,20)→(170,110,40)。
- 口径：与 §10.3 "lwe 未覆盖或与我们分歧 → 以官方输出为准" 一致。

### 11.2 粒子图层与官方内置素材（0.8.17 核对结论）

本机 `~/Pictures/WallpaperEngine/assets/`（91MB，WE 安装目录 assets 副本）可满足
此前一直走兜底的所有缺件，插件已默认把 `<loose 根>/assets` 登记为全局素材根：

- `materials/particle/chromaticdot.tex`（雪，rgba8888 64×64，实测中心亮、
  周边黑 = 加性 blending 的形状在 RGB 里）
- `materials/particle/fog/fog1.tex`（雾，**r8 + 64 帧 spritesheet** 128×128/帧）
- `assets/effects/godrays/shaders/effects/godrays_*.{vert,frag}`（背景 godrays 链
  缺的就是这个 gaussian pass）
- `assets/materials/util/solidlayer_instance_4.json`（snow5 的材质，1 pass，
  `genericimage4` + `util/white`）
- `assets/shaders/genericparticle.{vert,geom,frag}` + `common_particles.h`：粒子
  投影的**权威实现** —— `gl_Position = mul(vec4(position,1), g_ModelViewProjectionMatrix)`，
  即透视来自 MVP；`flags&4` 的"透视粒子"用专用透视相机（lwe CParticle.cpp:1895-1896:
  `perspective(fov, aspect, near, far) * lookAt((0,0,1000),(0,0,0),(0,1,0))`），
  我们目前只做 2D 圆盘 + 正交，z 分量丢弃 → `snowperspective` 的雪被压成中段一条带。

**对照测量**（官方实拍 1758×1029 与我们的 1920×1080 在 0.9 缩放 + (30,0) 偏移下
整帧 NCC 0.798）：背景/人物/雪天变体/「雪」角标一致；差异集中在
①透视粒子（雪的分布）②fog1 的 spritesheet 帧 ③snow5 solid layer 被跳过
④livetext/音频/水印控件层（需脚本 + 系统时间/电量/音频输入）。
