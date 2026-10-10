# 「关于」页签的联系方式二维码 + 更新公告配图（源资产）

本目录归档设置页**「关于」页签**里两张联系方式二维码的**原始截图**，以及「更新公告」弹窗
配图的**原始插画**。与 `assets/mascot/` 同一口径：它们是**源资产**，不是运行时载荷。

- 运行时用的是这两张图**裁到码区**的派生版本，落在 **`lib/about/*.png`**（随包发布），由插件路由
  `GET <BASE>/about-qr/<文件名>` 直出（白名单 + ETag/304，见 `lib/routes/about-qr.js`）；
  客户端只存路径（`src/about-assets.js`）。2026-10-01 之前那版把派生图**内联 base64** 进客户端
  bundle，用户要求改成 PNG 引入 —— bundle 因此省下约 240KB，换码也不必重建产物。
- 因此**本目录**（源资产）**不进 npm 包**（不在 `package.json` 的 `files` 白名单内），只随仓库源码分发；
  派生产物 `lib/about/` 进包（`verify-package-files` 盯着）。

## 文件与用途

| 文件 | 尺寸 | 用途 |
|---|---|---|
| `qq-group-dshwe-llm-702x852.png` | 702×852 | **QQ 群「DSHWE \| LLM 讨论群」** 群二维码（含图内标题）。对应 `lib/about/qq-group.png` / `ABOUT_QR_QQ_PATH` |
| `douyin-group-dshwe-2-748x748.png` | 748×748 | **抖音群「dshwe 交流 2 群」**（群号 917001335502）二维码（含图内群名与群号）。对应 `lib/about/douyin-group.png` / `ABOUT_QR_DOUYIN_PATH`。2026-10-10 换码：旧码 `douyin-group-dsh-1044x1026.png`（「dsh 交流群」，群号 252729465001）已退役 |
| `update-notice-star-1254x1254.png` | 1254×1254 | **v1.3.0 更新公告配图**「求个 star 喵！」GitHub 求星插画（原图）。对应 `lib/about/update-notice.jpg` / `NOTICE_ART_PATH`（缩到 720px + JPEG q88，Pillow LANCZOS） |

> **派生版只取"码"那块**（裁掉图内的标题带 / 群名 / 群号），因为这些文字在页面里由**卡片自己的
> 标题与说明行**承担（重复两遍没有信息量），而裁掉之后两张码在面板里**尺寸一致、并排对齐**、
> 码点也更大更好扫。裁剪框（含 36px 留白）见下面的派生脚本注释。

## 替换素材时怎么重新生成派生版本

1. 把新二维码存成 PNG 放到本目录（原始尺寸留着，便于日后重新派生）。
2. 派生：缩到**宽 520px**（等比），转**128 色调色板** PNG（quantize + optimize）——
   码点仍足够清晰（QQ 码约 9 px/模块），而体积只有原图的 1/4 左右。
3. 把派生 PNG 覆盖到 **`lib/about/`**（文件名固定：`qq-group.png` / `douyin-group.png`），
   **不需要重建客户端产物** —— 客户端只存路径；README 引用的也是这两张（中英两份同步显示新码）。

参考命令（本机 `Pillow`；换尺寸 / 色数只改这两个参数）：

```python
from PIL import Image
import base64, io
# 裁剪框 = 码的内容 bbox（含 36px 留白）；两张图各自的框见下面的常量。
BOXES = {
    "qq-group-dshwe-llm-702x852.png":      (63, 249, 634, 819),   # 标题带 / 分隔线之下
    "douyin-group-dshwe-2-748x748.png":    (185, 116, 567, 497),  # 群名 / 群号文字之上
}
MARGIN, W, COLORS = 36, 520, 128

def derive(path):
    im = Image.open(path).convert("RGB")
    x0, y0, x1, y1 = BOXES[path.split("/")[-1]]
    im = im.crop((max(0, x0 - MARGIN), max(0, y0 - MARGIN),
                  min(im.width, x1 + MARGIN), min(im.height, y1 + MARGIN)))
    im = im.resize((W, round(im.height * W / im.width)), Image.LANCZOS)
    im = im.convert("P", palette=Image.ADAPTIVE, colors=COLORS)
    buf = io.BytesIO(); im.save(buf, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
```

（bbox 由一次性的内容扫描得到：行 / 列方向上都统计"非近白"像素，取 ≥3 像素的区间端点。
派生结果直接写进 `lib/about/` —— **不要再转 base64 内联**。）

## 派生版怎么验证（两档，都做过）

1. **结构保真**：把派生图上采样回裁剪框分辨率、与裁剪后的原图逐像素比 —— 两图平均通道差
   `0.90 / 0.72`（满量程 255）、99 分位差 `9 / 8`、按墨色二值化后一致率 `99.30% / 99.75%`。
2. **真解码**：会用 macOS Vision（`VNDetectBarcodesRequest`，见下面的自检命令）对**派生版**扫码。
   **实测：QQ 码解出 `https://qm.qq.com/q/yxDL6BdsFW`**；抖音那种"点划 + 渐变 + 中心头像"的
   装饰码连**原图**都解不出来（Vision 认不了这一型），所以它的验证只到第 1 档 ——
   **换抖音码时请务必用手机真机扫一次**再提交。

```bash
# ① 扫的就是插件运行时直出的那两份字节（lib/about/ 下的 PNG）
# ② 用 Vision 扫（一行一个文件；本命令就是上面第 2 档验证用的）
cat > /tmp/qrdecode.swift <<'SWIFT'
import Foundation; import Vision; import AppKit
for path in CommandLine.arguments.dropFirst() {
  guard let i = NSImage(contentsOfFile: path), let t = i.tiffRepresentation,
        let r = NSBitmapImageRep(data: t), let cg = r.cgImage else { continue }
  let req = VNDetectBarcodesRequest(); req.symbologies = [.qr]
  try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
  print(path, (req.results ?? []).compactMap { $0.payloadStringValue })
}
SWIFT
swiftc -O /tmp/qrdecode.swift -o /tmp/qrdecode && /tmp/qrdecode lib/about/qq-group.png lib/about/douyin-group.png
```

## 公告配图（update-notice-star-1254x1254.png）的派生口径

跟二维码不是一回事：整图**无裁剪**，Pillow LANCZOS 缩到 **720×720**，存 **JPEG q88**
（progressive + optimize，约 146KB；PNG 同尺寸要 753KB）。派生覆盖 `lib/about/update-notice.jpg`
—— 路径与客户端产物都不动（`/about-qr` 路由带 ETag/304，换图即生效）。下个版本换公告图时：
新图存本目录（原始尺寸留着），按同口径重派生覆盖即可，白名单与客户端不用改。
