# scene-gl 图像路径 spritesheet 选帧 排查与修复计划（sf51，2026-08-31）

> 现象：壁纸 3735447194（达妮娅）实时渲染时，时钟文字不支持显示，但时钟
> 位置附近**多出一坨白色**，疑似加载异常。
> 结论：根因已定位——**不是加载异常**。白色一坨是时钟组件自带的
> "Day/Night (Click)" 日/夜切换按钮贴图：256×768 三帧精灵表在 GL 图像路径
> 被整图压进 256×256 方形 quad（GL 缺 spritesheet 选帧，CPU 路径已有）。
> 时钟文字本身是"即时文字"，按设计刻意跳过，非 bug。
> 状态：**已实施**（2026-08-31；验收 `.analysis/sf51-spritesheet.mjs` 23/23，
> 引擎升 `/9`）。

---

## 一、问题现象与签名

- 壁纸：3735447194（达妮娅 - 愿予你安然一梦 | 鸣潮，本机库
  `~/Pictures/WallpaperEngine/3735447194`，scene.pkg 实测）。
- 症状一：时钟/日期文字不渲染（配置页 degraded 清单记 `livetext`）。
- 症状二：时钟应出现的位置附近有一坨白色（约 115×115px，画布
  ≈(1707,308) @1920×1080）。
- **签名判读**：白块位置与尺寸恰等于时钟组子对象 `Day/Night (Click)`(443)
  的渲染 quad；CPU 静态帧同位置只画**单个图标**（本机实测渲染确认），
  GL 实时路径画**整张三帧表**——差异精确指向 GL 图像路径的精灵表处理。

## 二、场景结构实测（scene.pkg 解包）

时钟组来自 workshop 3732231168（DAY DATE TIME 挂钟组件）：

| id | 对象 | 类型 | 说明 |
|---|---|---|---|
| 392 | DAY DATE TIME | text（脚本） | 组根，origin (3483.04, 1464.68)，scale 0.898 |
| 399 | Date | text（脚本） | 子对象，父 392 |
| 407 | Clock | text（脚本） | 子对象，父 392（脚本含 `new Date`） |
| 435 | Text UPDATER | text（脚本） | MORNING/EVENING，读 `shared.currentTODState` |
| 443 | Day/Night (Click) | image | 父 392，本地原点 (-75.2, 87.77)，size 256×256 |
| 606 | Circle Audio Visualization | image | origin (3480.9, 1445.4)，size 5×5（可忽略） |

关键证据链：

1. **时钟文字 = 即时文字，按设计跳过**。脚本含 `new Date()` /
   `getHours()`，CPU `lib/we-renderer/text.js _isLiveText` 与 GL gate
   `lib/index.js` ~L4058（mark `livetext`）双路一致跳过——避免静态渲染
   冻结出错误时间（W0 决策）。非异常。
2. **443 贴图是三帧精灵表**。`materials/workshop/3732231168/
   dayNightToggleSprite.tex` 实测：**256×768，DXT5**，TEXS 帧表 3 帧
   （各 256×256，y=0/256/512，frametime=1）；材质 pass
   `combos:{spritesheet:1}`，`genericimage4`。三帧内容（解码合成确认）：
   automatic=白月牙+灰拱圆 / day=实心白圆 / night=白月牙——全部白色系、
   帧几乎填满 256×256。
3. **CPU 路径已选帧**：`lib/we-renderer/image.js` L139-156，
   `combos.spritesheet && tex.frames.count > 1` 时按
   `floor(t/duration)%count` 裁单帧（静态帧 t=0 → 第 0 帧）；裁剪发生在
   效果链之前。本机 CPU 静态帧渲染：该位置仅单个图标，正确。
4. **GL 路径未选帧**：gate `glTexInfo`（`lib/index.js` L3624-3629）已把
   `frames` 随 `mainTexture` 下发，但客户端 `src/scene-gl.js` 仅粒子路径
   消费 frames（sf40g，`psys.frames` ~L1843）；图像对象合成 pass 直接
   `bindTexture(o.mainTexEntry.tex)` + 整图 UV 0..1（~L2247）→ **三帧全部
   压进 256×256 方形 quad**，三个白色图标叠成一坨白色。
5. 443 本身无效果链、无 alpha/brightness 覆写；`angles` 绑脚本（`{script, value}`
   形态，无 `animation` 字段）→ `glHasAnim` 不命中、`glVal` 直取 `value`
   "0 0 0" 按静态渲染，对象照常进 GL（degraded 清单**不会**出现 anim:angles）。

结论：白块 = 精灵表整图渲染，**加载链路完全正常**（纹理成功解码上传），
缺的是 GL 图像路径的 spritesheet 选帧特性。

## 三、修复设计（sf51）

对齐目标：GL 与 CPU 语义逐字一致——`Math.floor(t / duration) % count`
按时间轮帧（官方引擎无脚本时纹理动画本就自动轮播；本组件脚本只是把它
暂停在第 0 帧，DSH W0 从不执行脚本，故轮播即"无脚本官方语义"，亦与
CPU anim 模式一致）。

### 3.1 gate：`lib/index.js`

| 位置 | 改动 |
|---|---|
| `glTexInfo()` ~L3617 | `frames` 存在时增加 `frameDuration` = 有效 frametime 均值（`known ? total/known : 0.1`，逐字镜像 CPU `loadTexImage` BASE-24）；`frames[]` 数组保持原样（粒子 payload 兼容） |
| image 分支 `out.push` ~L4256 | `Number(matPass.combos.spritesheet ?? matPass.combos.SPRITESHEET ?? 0) === 1` 时 payload 增加 `{ spritesheet: true }`（CPU image.js L140 同款大小写双查）；frames 缺失/≤1 不加（CPU 此时也画整图，行为对齐） |
| `SCENE_GL_ENGINE` | `'dsh-we-scene-gl/8'` → `'/9'` |

### 3.2 客户端：`src/scene-gl.js`

1. `loadOne(info, repeat, mip)` 增加第 4 参 `wantSheet`；缓存键追加 sheet
   维度（`path|m|s`），避免同路径非裁剪加载串缓存。
   async 体内、`bmp.close()` **之前**：`wantSheet && info.frames?.length > 1`
   时逐帧离屏 2D canvas `drawImage(bmp, f.x, f.y, fw, fh, 0, 0, fw, fh)`
   裁帧，按**相同参数**（repeat/mip）`uploadTex` 上传（canvas 是合法
   texImage2D 源，N-07 守卫已有 canvas 中转先例），产出
   `entry.sheet = { entries: [texEntry...], duration }`；texEntry 记帧尺寸
   w/h/hw/hh，全部 push 进 `textures` 供 dispose。
   守卫（任一命中即放弃 sheet、维持现状整图，宁错勿崩）：任一帧宽高为
   0 / 各帧尺寸不一致 / 帧数 >64。`frameDuration` 不为正时 duration 兜底 1。
2. buildResources image 分支（~L1906）：`obj.spritesheet === true` 时传
   `wantSheet`；`mainFull.sheet` 存在则以 `sheet.entries[0]` 为初始
   `mainTexEntry`，`sheet` 存入对象资源。FBO 尺寸与 `mvpFx` 继续用帧尺寸
   （帧尺寸一致守卫保证各帧通用）；效果链 `{previous:true}` 槽读
   `o.mainTexEntry` → 自然拿到当前帧。
3. `render()` 每帧对象循环（① 效果链阶段前）：`o.sheet` 存在时
   `idx = Math.floor(t / o.sheet.duration) % entries.length`，换帧时替换
   `o.mainTexEntry`。`renderObjectChain` 与合成 pass 每帧现读
   `o.mainTexEntry`/`_weOutputs[i]`，无需其他改动。静态场景（P2-8 跳帧）
   冻结第 0 帧，与 CPU 静态帧语义一致。
4. 不改 present shader / 粒子 / 视频 / 木偶路径。

### 3.3 重建产物

`node scripts/build-client.mjs` 重新生成 `lib/client.js`（scene-gl.js 以
IIFE 拼进 bundle；改 src 后必须重建，当前 bundle 已与 src 同步）。

## 四、验收方案

1. `cd custom-plugins/dsh-wallpaper-engine && npm run verify`。
2. CPU 回归：`SceneRenderer` 渲染 3735447194 静态帧，改动前后时钟区裁剪
   图与近白像素统计逐字节一致（CPU 零改动 → 应不变）。
3. GL 验收：按 `test/scene-gl-e2e/capture.py` 现有 Playwright 流程抓
   GL_RUN 截图，裁剪 (1600-1830, 210-410) 区域确认只剩单帧图标
   （白月牙+灰拱），不再是三帧叠成的白色实心块；stats 无新增 error。
4. 收尾：清理排查期临时产物（仓库根 `.we-debug/`）。

## 五、明确不做（非目标）

- 时钟文字仍按设计跳过（livetext）。
- 日/夜切换按钮保留渲染（官方外观的一部分；DSH 不执行脚本故不可点击，
  但官方引擎无脚本时同样显示该动画）。若实机观感上希望隐藏按钮或钉死
  第 0 帧（不轮帧），均为一行级参数改动，验收时可切换。
- 不实现 cursorClick/脚本运行时；不改 CPU 选帧逻辑。

## 六、风险与影响面

- 改动被 `combos.spritesheet && frames>1` 双条件收窄：本地其余壁纸的粒子
  帧表（无材质 combos）与普通多帧 GIF 不受影响；粒子/文字/视频路径零改动。
- `loadOne` 缓存键追加维度：既有调用（粒子 `loadOne(info,false,false)`、
  效果纹理 `loadOne(info,true,false)`）键形态不变。
- 轮帧频率对齐 CPU（本表 frametime=1 → 每秒换帧）。
