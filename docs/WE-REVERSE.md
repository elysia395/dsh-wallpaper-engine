# Wallpaper Engine 官方引擎逆向 — 技术细节

> 本文记录 wallpaper64.exe（官方渲染引擎）的逆向方法、关键地址、已确认数学与
> 脚本工具链。以官方引擎为**事实基准**复刻 WE 场景渲染，避免参数猜测。
> 核心结论随时更新于 `scripts/reverse/NOTES-M-matrix.md` 与 `TODO.md` 第四节。

---

## 1. WE 原版位置

| 项 | 路径 |
|---|---|
| 官方引擎 | `C:\Program Files (x86)\Steam\steamapps\common\wallpaper_engine\wallpaper64.exe` |
| 32 位引擎 | 同目录 `wallpaper32.exe`（本机当前运行实例为 32 位） |
| Workshop 壁纸 | `C:\Program Files (x86)\Steam\steamapps\workshop\content\431960\<workshopid>\scene.pkg` |
| 引擎配置 | `wallpaper_engine\config.json`（按 Windows 用户分节，含 `wallpaperconfig.Monitor0.file` 当前壁纸） |
| 引擎日志 | `wallpaper_engine\log.txt`（渲染/错误，含 "DXGI device lost" 等） |
| 辅助进程 | `bin/wallpaperservice64.exe`（渲染服务）、`bin/wallpaperui.exe`（UI） |

**命令行**（wallpaper64.exe，单实例启动器——转发给已运行实例后退出）：
```
wallpaper64.exe -control pause|stop|play|mute|unmute
wallpaper64.exe -control openWallpaper -file <scene.pkg路径>
wallpaper64.exe -control workshopid -id <workshopid>
wallpaper64.exe -screensaver|-host|-preview
```
> 实测：直接传 scene.pkg 或 -preview 会退出（exit 0）；当前壁纸由
> config.json 的活跃用户节决定。杀 wallpaperui 会触发壁纸重载。

**本机当前活跃壁纸**：config 顶层节 `Kai`（当前 Windows 用户）→
`wallpaperconfig.Monitor0.file` = Amiya（3486806915）。杀 wallpaperui 后
引擎可能加载 recent 节（Plana 3461168300）。

---

## 2. 逆向工具链

### 2.1 环境
- exe 为 x64 PE：ImageBase `0x140000000`，**.text VA=0x1000 ↔ Raw=0x400**（偏移差 0xC00）。
- 字节扫描地址换算：`真实地址 = 0x140000000 + (fileOff - 0x400 + 0x1000)`。
  ⚠️ **不要**用 `fileOff + 0x140000000`（会偏 0xC00，早期脚本犯过此错）。
- 反汇编：`objdump -d --start-address=0x140XXXXXX --stop-address=0x140YYYYYY wallpaper64.exe`
  （输出为 RVA 地址，`.text+0x…` 表示相对 .text 起始）。

### 2.2 函数边界（pdata）
`.pdata` 段（VA=0x4EA000, Raw=0x4E1C00）的 RUNTIME_FUNCTION 表（12B/条：
BeginAddress, EndAddress, UnwindInfoAddress）可反查任意地址所属函数：
```js
// scripts/reverse/pdata-map.mjs — 打印目标地址所在函数 [begin,end)
```
已知函数边界：
| 函数 | 地址区间 | 作用 |
|---|---|---|
| 定位数学 | 0x1401EC25A-0x1401EC41F | origin×0.5×M → 写 0x9f0 |
| M 矩阵链 | 0x14014774B-0x140148477 | 骨骼矩阵链乘法（origin 槽 0x2f0 参与） |
| 对象提交 | 0x1401E8ED9-0x1401EA24E | 矩阵B(0x384)/M(0x344) 复制、0x304 标志测试 |
| 相机矩阵构造 | 0x14017FCFC-0x1401816CC | 0x1170/0x11a0 view/proj 缓存构造（0.5 常量） |
| 相机矩阵应用 | 0x1401ED0D0-0x1401EDB1B | 读 0x178/0x17c 做矩阵乘（eye 相关） |
| 矩阵 helper | 0x14005F5B0-0x14005F5F3 | 返回 rcx + edx*16（取矩阵行） |

### 2.3 脚本清单（scripts/reverse/）
| 脚本 | 用途 |
|---|---|
| `pdata-map.mjs` / `pdata-map2.mjs` | 目标地址 → 函数边界 |
| `matrix340-write.mjs` | 对象 0x340-0x37f（M）写入点 |
| `matrix384-write.mjs` | 对象 0x370-0x3ff（矩阵B）写入点 |
| `matrix8f0-write.mjs` | 0xc8+0x8f0（M 真正来源）写入点 |
| `matrix1160-write.mjs` | 0xc8+0x1160-0x11df（view/proj 缓存）访问点 |
| `find-matrixfn-callers.mjs` | 找矩阵链函数调用者（无直接 call → vtable/jmp） |
| `find-xrefs.mjs` / `find-proj-*.mjs` | xref / 投影矩阵引用 / eye 访问 |
| `iat-parse.mjs` / `d3d11-imports.mjs` / `imports-dll.mjs` | IAT 导入（仅 D3D11CreateDevice；渲染 API 全 vtable） |
| `check-cli.mjs` / `cli-context.mjs` | 命令行字符串（-control/openWallpaper/workshopid） |
| `read-strings.mjs` / `read-camera-strings.mjs` 等 | 字符串定位 |

---

## 3. 已确认的官方数学（截至 sf27）

### 3.1 定位数学（0x1401EC338，函数 0x1401EC25A-0x1401EC41F）
```
定位矩阵(0x9f0-0xa2f, 完整4×4) = origin(0x2f0/0x2f4) × 0.5 × M
0.5 = 常量 0x1404926C0（movss 0x1401EC322/0x1401EC446）——固定场景→画布缩放
M = 对象 0x344-0x37f（由 0x1401E9609 从 0xc8+0x8f0 复制）
0x9f0 第4行 = M 第4行（0x374 movups 原样 → 0xa20）
```
- 两分支殊途同归：r15b≠0 直接算（0x1401EC338）；r15b==0 先算 0x9b0 再复制
  （0x1401EC5A6-0x1401EC5E7）。分支2 还额外 origin×0.5×矩阵B(0x384) → 0x970。
- 结果被 0x1400D9537 复制到输出顶点矩阵数组（rdi+rdx，rdx=movzwl 0x2(%rsi,%r9,2)）。

### 3.2 M 的来源（0x1400D4200-0x1400D43C5）
```
0xc8+0x8f0 = 0x30 × (0x38 × 0x40)
  0x930-0x960 = 0x38 × 0x40（0x38 行 × 0x40 列）
  0x8f0-0x920 = 0x30 × (0x930-0x960)
```
- **0x38/0x40**：渲染时压栈 ← **0x1160/0x11a0 相机矩阵缓存**
  （0x1401EC936/0x1401EC96C 复制；0x1401800B8 从 rsi+0x48/0x50 复制；
  0x14017FCFC 用 0.5 常量 + 0x14005F5B0 构造）。
- **0x30**：对象世界矩阵——0x1401EC799 设单位阵（无 0x20 标志）或
  0x1401EC878 从 rdi 复制（有 0x20 标志，rdi = 调用者传入）。
- 矩阵B（0x384）= rsi 矩阵复制（0x1401E95B5），同源也写入 0xc8+0x30。

### 3.3 puppet 特有：origin 骨骼链（0x140147F31，函数 0x14014774B-0x140148477）
- 对象矩阵数组 0x210-0x2ff（间隔 0x20，8 槽）与骨骼矩阵（r12+rcx*8，rcx=索引）
  做链乘法，**origin 槽（0x2f0）被骨骼矩阵变换后写回**（0x140147FC4）。
- image 无此路径 → **puppet 与 image 定位差异的结构性来源**（头 vs 发/耳/眼错位）。
- ⚠️ 公式未定：哪级骨骼 / animWorld|bindWorld|bindInv / 乘还是加 / 方向。

### 3.4 背景跳过视图
- 0x304 标志（bit 0x1000|0x100 = 0x1100）在 0x1401E8B75/0x1401EA2F5 等测试，
  跳另一路径 → 背景不经 -eye。
- 用户最初"头相对背景偏移 182px@1920 = 360×0.5 = eye.x×0.5"证实背景不平移。

### 3.5 sf27 实现（DSH `_viewShift()`）
```js
_viewShift(o, size, ps) {
  // 背景判定: size 接近场景正交尺寸 (314 = 3840×2160 全屏)
  if (isBg || !this.camEye) return [0, 0];
  return [(-this.camEye[0]) * (ps?ps[0]:1), 0];  // x=-eye.x=+360, y=0
}
```
- 前景 x +360 @3840（= 180 @1920，匹配用户 182px 观察）；y 归零（用户实测上移异常）。
- 应用于 renderImage / renderPuppet / _renderSolidLayer / TextObject。

---

## 4. Amiya 关键数据（3486806915）

| 项 | 值 |
|---|---|
| camera | eye=(-360,-269.56,0) center=(-360,-269.56,-1) up=(0,1,0) |
| orthogonalprojection | 3840×2160 |
| 背景 314 | image 全屏 3840×2160，origin=(1920,1080)，无 cropoffset |
| 头 697 | puppet，origin=(3.92,174.03)，parent=467 → abs(885.41,800.49)，size=548×678 |
| 头骨骼 | 骨0 bind T=(-51.83,-250.55)，骨1 (+20.89,74.34)，骨2 (+193.34,322.43) |
| 头网格 | raw x[-225,224] 中心(-0.5,-1)；蒙皮后 x[-255.1,187.3] 中心(-33.9,0.85) |
| 身体 407 | image，parent=528→467，abs origin=(866.85,316.20)，size=739×1088 |
| 发/耳/眼 | image，挂 463/494（697 的子锚）→ 与头同链 |

---

## 5. 验证脚本（scripts/core/）

| 脚本 | 用途 |
|---|---|
| `amiya-worker-sim.mjs` | 模拟 worker 渲染 3840×2160 + 空帧检查（写 out/amiya_worker_sim.png） |
| `amiya-sf27-verify.mjs` | 组件画布中心（含/不含视图平移）对比 |
| `amiya-sf27-diff.mjs` | 含/不含视图平移的渲染帧像素 diff |
| `amiya-head-bone-pos.mjs` | 头 697 骨骼动画 pos/animWorld 平移 |
| `amiya-467-bones.mjs` | 骨骼 bind 矩阵 + 蒙皮后包围盒 |
| `amiya-head-chains.mjs` | 头部组件父链（abs origin） |
| `amiya-bg-identify.mjs` / `amiya-bg-alpha.mjs` | 背景判定（size/alpha/_renderType） |
| `amiya-camera.mjs` | scene.camera/general 数据 |

---

## 6. 待确认问题（详见 TODO.md 第四节）

- **Q1** view 平移 y 分量（0 / -269.56 / +269.56）——0x14017FCFC / 0x1401ED27F。
- **Q2** puppet origin 骨骼链公式——哪级骨骼/矩阵类型/方向。
- **Q3** M 的 0x30 世界矩阵内容（单位阵 vs rdi）。
- **Q4** 0.5 与 DSH ps 的等价性边界（粒子 projScale 等）。
- **Q5** sf27 实机验证（栏杆高度 / 头 x 对齐方向）。
- **Q6** 0x384 矩阵B 用途（image 路径 0x970）。
- **Q7** 0x9f0 结果矩阵与蒙皮 gBones 的组合顺序。
- **Q8** 官方引擎动态渲染参照（截屏提取像素坐标）。
