# scene-gl 鼠标特效跟踪偏移 排查与修复计划（2026-08-31）

> 现象：GL 实时渲染路径下，鼠标特效（mousefollow 发射器 / pointerAttract
> 控制点）的跟踪点**沿屏幕中轴线最准，向两侧线性偏离光标中心**。
> 结论：根因已定位——鼠标坐标换算漏算 CSS `object-fit: cover` 的裁边偏移与
> 放大系数。本文档记录完整证据链、修复设计与验收方案。
> 状态：**待实施**（本文档先行落盘，代码改动另行执行）。

---

## 一、问题现象与签名

- 壁纸：3735447194（MrDogTastic's Mouse Trail，本机库
  `~/Pictures/WallpaperEngine/3735447194`，scene.pkg 实测确认）。
- 症状：鼠标轨迹粒子在中轴（水平居中线）附近贴合光标；向左/右两侧移动时，
  生成点偏离光标，偏离量随离中心距离增大，左右对称。
- **签名判读**：误差 = f(到中心的距离) 且中心为零、两侧对称 —— 这是"线性
  坐标换算少了一个以中心为基准的偏移/缩放项"的典型特征，直接指向
  鼠标→场景坐标换算，而非粒子模拟本身。

## 二、鼠标特效在 GL 路径的实现位置

| 环节 | 位置 | 职责 |
|---|---|---|
| 宿主 gate | `lib/index.js` ~L3915-3981 | `controlpoint[id=0].flags&1` → 清单 `particle.mousefollow`；控制点表下发 |
| 客户端解析 | `src/scene-gl.js` `_weGLCreateParticleSys` ~L340-370 | `cps` 表 + `pointerAttract`（flags&1 存在即装监听）+ `mousefollow` |
| 指针监听 | `src/scene-gl.js` `installPointerHooks` ~L2006-2016 | `document` pointermove → `pointerPx`（背板像素） |
| 坐标换算 | `src/scene-gl.js` `mouseScenePos` ~L2022-2026 | 背板像素 → 场景坐标（y 向上） |
| 发射/渲染 | `_weGLPSpawn` / `_weGLPFillVerts` ~L383/732 | base=鼠标场景坐标；粒子 `pos×ps` 折回画布像素 |

换算链 round-trip 数学自洽：

```
pointerPx = [(clientX−r.left)·CW/r.width, (clientY−r.top)·CH/r.height]   // installPointerHooks
scene     = [pointerPx[0]/ps[0], (CH−pointerPx[1])/ps[1]]               // mouseScenePos, ps=CW/orthoW, CH/orthoH
画布像素   = [scene[0]·ps[0], CH−scene[1]·ps[1]]                          // _weGLPFillVerts
```

三者复合 = 恒等映射 ⇒ **若背板位图与元素盒 1:1 对应，跟踪应处处精确**。
因此误差必然来自"背板位图与元素盒非 1:1"的展示环节。

## 三、根因：object-fit cover 裁边未参与坐标换算

### 展示层事实

- canvas 挂 `.we-media.we-media--gl.we-media--fit`（`src/client.js` ~L1703）；
- CSS（`src/client.js` L4229/L4245）：

```css
.we-layer .we-media      { width: 100%; height: 100%; object-fit: cover; ... }
.we-layer .we-media--fit { object-fit: var(--we-object-fit, cover); }
```

- 运行时配置（`~/.dsh-wallpaper-engine/config.json`）：`objectFit: "cover"`。
- 背板尺寸：`sceneViewportSize()` 钳到 ≤1920×1080，`applySarFit()` 再把背板
  调成**场景 SAR**（3840×2160 → 恒 16:9）。

### 失配如何产生

`getBoundingClientRect()` 返回**元素布局盒**，不含 object-fit 的内容矩形。
当窗口比例 ≠ 16:9（16:10 屏 / 任务栏 / 非 16:9 窗口等），cover 以
`s = max(boxW/CW, boxH/CH)` 放大背板并居中裁边。以 1920×1200 窗口 + 1920×1080
背板为例：

- s = 1.1111，显示尺寸 2133×1200，左右各裁 106.7 CSS px；
- 真实换算：`backingX = (clientX − r.left + 106.7) / 1.1111`；
- 旧公式：`backingX = (clientX − r.left) × 1`；
- **中轴处两者相等（偏移项恰好抵消）→ 跟踪精确；左右边缘误差 ±96 背板像素
  ≈ ±107 CSS px → 两侧线性发散。** 与现象逐点吻合。

### 已排除的候选

| 候选 | 排除依据 |
|---|---|
| 相机视差未补偿 | `scene-gl.js` 无任何 parallax 代码（grep 零命中） |
| 粒子模拟/渲染误差 | 换算链 round-trip 恒等（见 §二） |
| blur 补偿 scale / flip 镜像 | 配置 `wallpaperBlur=0`、`flip=false` → transform=none；且 `getBoundingClientRect` 含 transform，中心均匀 scale 类 transform 恰被旧公式吸收（见 §四注记） |
| dpr / 页面缩放 | `clientX` 与 rect 同为 CSS px，恒一致 |
| 静态图与粒子错位 | 底图 img 与 GL canvas 同 fit 同裁边，内容互相对齐，只有"对光标"偏 |

## 四、修复设计

### 核心改动：`installPointerHooks()` 的换算改为 object-fit 内容矩形映射

```js
pointerListener = (ev) => {
  try {
    const r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
    if (!r || !r.width || !r.height) return;
    // 解析有效 object-fit（getComputedStyle 解析 --we-object-fit 变量），异常回退 cover
    let fit = 'cover';
    try { fit = String(getComputedStyle(canvas).objectFit || 'cover').toLowerCase(); } catch { }
    const rx = r.width / CW, ry = r.height / CH;
    let sx, sy;
    if (fit === 'fill') { sx = rx; sy = ry; }                 // 逐轴拉伸
    else {
      const s = fit === 'contain' ? Math.min(rx, ry)
        : fit === 'none' ? 1
        : fit === 'scale-down' ? Math.min(1, Math.min(rx, ry))
        : Math.max(rx, ry);                                   // cover/未知 → cover
      sx = sy = s;
    }
    // object-position 默认 50% 50%（CSS 未另行设置）
    const offX = (r.width - CW * sx) / 2;
    const offY = (r.height - CH * sy) / 2;
    let bx = (ev.clientX - r.left - offX) / sx;
    let by = (ev.clientY - r.top - offY) / sy;
    // flip 镜像（--we-wallpaper-transform 的 scaleX(-1)）：rect 含 transform
    // 仍是轴对齐盒 → x 单轴翻回
    try {
      const tr = getComputedStyle(canvas).transform;
      if (tr && tr !== 'none' && (new DOMMatrix(tr)).a < 0) bx = CW - bx;
    } catch { /* DOMMatrix 不可用跳过 */ }
    pointerPx = [Math.min(CW, Math.max(0, bx)), Math.min(CH, Math.max(0, by))];
  } catch { /* 坐标读取失败保持旧值 */ }
};
```

配套：`stats.lastPointerPx = pointerPx` 一行诊断钩子（E2E/实机核对用）。

### 数学注记（为何 r 直接参与即精确）

blur 补偿的 `scale(k)`（中心 origin）与 cover/contain 的居中装配都是
**中心均匀缩放**，复合仍为中心缩放：真实映射
`bx = (clientX − r.center)/(f·k) + CW/2` 与本公式（以 r 直接算
`s = f·k`、`off = (r.width − CW·f·k)/2`）逐项等价。仅 `fill` + 非均匀
transform 的极端组合存在理论漂移，实践中不出现（配置注释已说明）。

### 回归安全性

- 窗口比例 = 背板比例（16:9 全屏等）时：`s = CW/r.width`、`offX/offY = 0`，
  公式**逐位退化**为旧公式 → 现有正确场景零变化。
- `pointerAttract`（3735447194 泡泡 flags&1 控制点）与 mousefollow 共用
  `mouseScenePos()`，一并修复。
- 性能：pointermove 每 事件一次 `getComputedStyle`（µs 级），无每帧成本。

## 五、验收方案

1. **数值验收** `.we-fix-accept/mousefit-map.mjs`：
   - CSS 语义真值模型（fit × 背板/窗口比例 × 可选 scale/flip）计算 5 探针点
     （中心 + 四边）期望背板坐标；
   - 新公式误差 <0.5px；旧公式在失配轴误差 >40px（同时证明 bug 与修复）；
   - 用例：1080p 背板 in 1920×1200 盒 cover / 1080p in 1080p cover（回归=精确）/
     1920×960 背板 in 1080p 盒 cover（超宽场景）/ contain letterbox / fill /
     flip+scale 复合。
2. **结构断言**：`node scripts/build-client.mjs` 后 `lib/client.js` 含
   objectFit 换算（grep），旧换算行消失。
3. **部署四步链**（docs/scene-gl-waves-2026-08-31.md「部署发现」）：
   build → `npm pack --pack-destination ~/.dsh-wallpaper-engine/dist/` →
   `rsync -a --delete` 同步 `lib/` 到
   `~/.dsh/profiles/web/node_modules/dsh-plugin-wallpaper-engine/` →
   重启 GUI app（宿主代码在内存，不重启不生效）。
4. **实机清单**：3735447194 鼠标轨迹在屏幕左/右边缘与光标重合；中轴行为
   不变；泡泡控制点跟随贴合；适配四模式（覆盖/填充/居中/拉伸）逐一核对。

## 六、边界与假设

- 不改 CSS/展示语义：cover 裁边是用户的适配选择，只修坐标换算。
- 不动 CPU 预渲染路径（mp4 无实时鼠标交互）；`scene-player.js` 为演示路由，
  不在本路径，不改。
- 假设：症状来自窗口比例 ≠ 场景 16:9。若 16:9 全屏仍复现，用
  `stats.lastPointerPx` 探针对拍光标坐标，复查 transform 链。
