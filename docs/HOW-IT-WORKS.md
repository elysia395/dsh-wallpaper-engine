# 工作原理 / How it works

> 本文件承接原先放在 README 首页的**实现细节**：场景渲染器、宿主 / 客户端分工、HTTP 路由表。
> 门面（`../README.md`）只保留「支持哪些壁纸类型」的结论表 + 本文件链接。
> 渲染路线的工程决策见 [`RENDERER-FEASIBILITY.md`](./RENDERER-FEASIBILITY.md)；未来实现路线见
> [`SCENE-ANIMATION-HANDOFF.md`](./SCENE-ANIMATION-HANDOFF.md)。

## 中文

### 场景渲染器

Scene 壁纸的 3D 场景由本插件内置的**纯 JS 场景渲染器**（入口 `lib/scene-renderer.js` 只是 9 行
re-export 壳，实现主体在 `lib/we-renderer/core.js` 及其子模块；参考
linux-wallpaperengine / repkg 逆向成果）完整重放：解析 `scene.pkg` 的对象树，渲染全部 image 层
（含 waterwaves / waterripple / shake 等 shader 效果的 CPU 实现）、puppet 骨骼网格（绑定姿态）、
以及粒子系统（发射器 / 初始化器 / 运算符 / 精灵绘制）。选择器里场景卡片带有「静态帧」徽标，可与动态壁纸区分。

> **展现效果**：渲染器输出 **3840 宽**（高度按场景比例推导，16:9 场景即 2160）的完整场景帧（背景 + 水 +
> 后发 + 人物 + 伞 + 粒子），对摄影、
> 插画、动画截图类场景壁纸效果接近原版；渲染失败（纯 shader 生成类 / 特殊纹理格式）时自动回退旧的
> 主纹理提取，再失败回退工坊预览图（`preview.jpg`），属预期行为，不视为缺陷。

### 场景渲染：怎么工作的

- **对象树**：解析 `scene.pkg`（PKGV 容器 + LZ4 条目链）或松散 `scene.json` 目录，按 dependencies/parent 拓扑排序全部对象（image / particle / text / sound）。
- **image 层**：加载材质主纹理（RGBA8888 / DXT1/3/5 等），按 scene 坐标定位（origin/scale/angle 父链累积），应用 alpha/brightness。
- **puppet 网格**：MDL（MDLV）网格 + 绑定姿态光栅化（软件光栅 + 双线性 UV 采样 + 透明合成），人物 / 后发等骨骼模型正确显示。
- **shader 效果链**：waterwaves（含 DUALWAVES 双波乘积）/ waterripple / shake 按 shader 精确数学在 CPU 实现；mask 纹理支持。
- **粒子系统**：boxrandom / sphererandom 发射器、color/size/alpha/lifetime/velocity/rotation 等初始化器、movement/alphafade/sizechange/turbulence/oscillate* 等运算符、sprite 精灵绘制。
- **缓存**：渲染结果按 `<版本>_<gpu 标志>_<路径>_<mtime>` 缓存到 `~/.dsh-wallpaper-engine/cache/frames/`（可用 `DSH_WE_CACHE_DIR` 覆盖），工坊更新后自动失效重建；**冷缓存**首次渲染约 20-30 秒（3840 宽全场景 + 全分辨率效果），之后秒级命中。

### 工作原理

- **Host 端**（`lib/index.js`）：一个 Cordis 插件，负责
  1. 通过读取 Steam 的 `libraryfolders.vdf` 定位 Wallpaper Engine 安装位置（所以 Steam 装在非默认盘也能用）；
  2. 从 `projects/defaultprojects`、`projects/myprojects` 以及 `steamapps/workshop/content/431960/*` 枚举壁纸；
  3. 在 DSH webserver 上注册同源 HTTP 路由，让浏览器端直接获取数据和流式加载媒体：
     - `GET /wallpaper-engine/inventory` → 壁纸 JSON 列表
     - `GET /wallpaper-engine/media/<token>` → 视频 / HTML（支持 Range）
     - `GET /wallpaper-engine/preview/<token>` → 预览图
     - `GET /wallpaper-engine/video-preview/<token>` → 自上传 MP4 的按需抽帧缩略图（ffmpeg，磁盘缓存）
     - `GET /wallpaper-engine/scene-frame/<token>` → 场景壁纸完整场景帧（纯 JS 渲染器输出 3840 宽 / 高度随场景比例，失败回退主纹理提取，PNG 磁盘缓存）
     - `GET /wallpaper-engine/scene-video/<token>` → 场景内嵌 MP4（抽出后硬件解码播放，支持 Range；场景无内嵌视频时 404，客户端回退静态帧）
     - `GET /wallpaper-engine/scene-anim/<token>?fps=N&sec=N&fmt=apng|mp4|webm` → 场景动画帧（多帧渲染成动画；实验性「beta 场景动画」，见「效果」页签开关）
     - `GET /wallpaper-engine/scene-anim-progress/<token>?fps&sec&fmt` → 场景动画渲染进度（进度条轮询，读渲染中的 `.prog`）
     - `GET /wallpaper-engine/scene-runtime/<token>` → 场景 WebGL 播放器页面（同源 HTML；客户端默认不内嵌，仅作回退路径）
     - `GET /wallpaper-engine/scene-manifest/<token>` → 场景清单 JSON（图层 / 模型 / 粒子 / 相机，按需从 `scene.pkg` 构建，供播放器读取）
     - `GET /wallpaper-engine/scene-resource/<token>/<子路径>` → 场景资源（清单引用的纹理 / 精灵，可解码则返回 PNG，否则原始字节）
     - `POST /wallpaper-engine/upload` → 上传自定义壁纸（JPG / PNG / MP4，原始字节流）
     - `POST /wallpaper-engine/remove` → 移除已上传的壁纸
     - `POST /wallpaper-engine/upload-dir` → 更改上传目录（持久化到 `~/.dsh-wallpaper-engine/config.json`，自动迁移已有文件）
     - `GET /wallpaper-engine/settings` → 读取插件设置（v0.4.0）
     - `PUT /wallpaper-engine/settings` → 保存插件设置（v0.4.0，写入 `~/.dsh-wallpaper-engine/config.json`）
     - `GET /wallpaper-engine/media-info/<token>` → 媒体元数据（分辨率 / 编码 / 帧率 / 时长，moov 探测）
     - `GET /wallpaper-engine/transcoded/<token>?fps=N` → 抽帧转码流（ffmpeg 一次性重编码，磁盘缓存）
     - `GET /wallpaper-engine/transcode-progress/<token>?fps=N` → 下载 / 转码进度（进度条轮询）
- **Client 端**（`lib/client.js`）：一个浏览器模块，拉取壁纸列表，把选中壁纸渲染到应用三列**后方**的固定图层，并在「设置」里注册一个**一级设置页**「Wallpaper Engine」（含液态玻璃卡片、选择弹窗、隐藏 / 恢复、倍速 / 翻转、配色 / 透明度与自定义壁纸管理）。
- **自定义壁纸存储**：上传的文件写入插件管理的本地目录（默认 `~/.dsh-wallpaper-engine/uploads`，可在设置里改到任意盘符），经同一套 `/media`、`/preview` 路由服务（视频缩略图另走 `/video-preview`）——与 WE 媒体走完全相同的管道，天然跨重启持久、无浏览器配额限制。

> 开发相关（构建产物、热挂载规则、缓存键前缀）见 [`../CONTRIBUTING.md`](../CONTRIBUTING.md)。

---

## English

### The scene renderer

A Scene wallpaper's 3D scene is fully replayed by the plugin's **pure-JS scene renderer**
(`lib/scene-renderer.js` is a 9-line re-export shell; the implementation body lives in
`lib/we-renderer/core.js` and its submodules — built from linux-wallpaperengine / repkg
reverse-engineering): it parses
`scene.pkg`'s object tree and renders every image layer (with CPU implementations of shader effects
like waterwaves / waterripple / shake), the puppet skeletal meshes (bind pose), and the particle
systems (emitters / initializers / operators / sprite drawing). Scene cards carry a 「静态帧」 badge in
the picker.

> **Expected result**: the renderer outputs a **3840-wide** full-scene frame (height derived from the
> scene aspect — 2160 for a 16:9 scene) containing background + water + back
> hair + character + umbrella + particles, close to the original for photographic, illustration and
> animation-screenshot scenes. On failure (pure shader/procedural scenes, exotic texture formats) it
> falls back to the older main-texture extractor, then to the workshop preview image (`preview.jpg`) —
> expected behaviour, not a defect.

### Scene rendering: how it works

- **Object tree**: parses `scene.pkg` (PKGV container + LZ4 entry chains) or a loose `scene.json`
  directory, topologically sorts every object (image / particle / text / sound) by dependencies / parent.
- **image layers**: loads the material main textures (RGBA8888 / DXT1/3/5 …), positions them in scene
  coordinates (origin / scale / angle accumulated down the parent chain), and applies alpha / brightness.
- **puppet meshes**: MDL (MDLV) mesh + bind-pose rasterization (software raster + bilinear UV sampling +
  alpha compositing), so skeletal models like the character / back hair display correctly.
- **shader effect chain**: waterwaves (incl. the dual-wave DUALWAVES product) / waterripple / shake are
  implemented in the CPU with the exact shader math; mask textures are supported.
- **particle systems**: boxrandom / sphererandom emitters, color / size / alpha / lifetime / velocity /
  rotation initializers, movement / alphafade / sizechange / turbulence / oscillate* operators, and
  sprite drawing.
- **Cache**: results are cached at `~/.dsh-wallpaper-engine/cache/frames/` keyed by
  `<version>_<gpu-flag>_<path>_<mtime>` (override with `DSH_WE_CACHE_DIR`); workshop updates and renderer upgrades
  invalidate the frame automatically. A cold-cache first render takes ~20–30 s (3840-wide full scene at
  full-resolution effects), then near-instant on cache hit.

### How it works

- **Host half** (`lib/index.js`): a Cordis plugin that
  1. locates the Wallpaper Engine install by reading Steam's `libraryfolders.vdf` (so it works even when Steam is on a non-default drive),
  2. enumerates wallpapers from `projects/defaultprojects`, `projects/myprojects`, and `steamapps/workshop/content/431960/*`,
  3. registers same-origin HTTP routes on the DSH webserver so the browser half can fetch data and stream media directly:
     - `GET /wallpaper-engine/inventory` → JSON list of wallpapers
     - `GET /wallpaper-engine/media/<token>` → video / HTML (Range supported)
     - `GET /wallpaper-engine/preview/<token>` → preview image
     - `GET /wallpaper-engine/video-preview/<token>` → on-demand ffmpeg-extracted thumbnail for a custom MP4 upload (disk-cached)
     - `GET /wallpaper-engine/scene-frame/<token>` → scene full-scene frame (pure-JS renderer output 3840 wide / height from the scene aspect, falls back to main-texture extraction, PNG disk-cached)
     - `GET /wallpaper-engine/scene-video/<token>` → the scene's embedded MP4 (hardware-decoded playback, Range supported; 404 when the scene embeds no video, and the client falls back to the static frame)
     - `GET /wallpaper-engine/scene-anim/<token>?fps=N&sec=N&fmt=apng|mp4|webm` → scene animation frames (multi-frame render to an animation; experimental beta scene animation, see the 效果 tab toggle)
     - `GET /wallpaper-engine/scene-anim-progress/<token>?fps&sec&fmt` → scene animation render progress (progress-bar polling, reads the in-flight `.prog`)
     - `GET /wallpaper-engine/scene-runtime/<token>` → scene WebGL player page (same-origin HTML; the client does not embed it by default — fallback path only)
     - `GET /wallpaper-engine/scene-manifest/<token>` → scene manifest JSON (layers / models / particles / camera, built on demand from `scene.pkg` for the player)
     - `GET /wallpaper-engine/scene-resource/<token>/<subpath>` → scene resources (textures / sprites referenced by the manifest; PNG when decodable, raw bytes otherwise)
     - `POST /wallpaper-engine/upload` → upload a custom wallpaper (JPG / PNG / MP4, raw bytes)
     - `POST /wallpaper-engine/remove` → remove an uploaded wallpaper
     - `POST /wallpaper-engine/upload-dir` → change the upload directory (persisted to `~/.dsh-wallpaper-engine/config.json`, migrates existing files)
     - `GET /wallpaper-engine/settings` → read plugin settings (v0.4.0)
     - `PUT /wallpaper-engine/settings` → save plugin settings (v0.4.0, written to `~/.dsh-wallpaper-engine/config.json`)
     - `GET /wallpaper-engine/media-info/<token>` → media metadata (resolution / codec / fps / duration, from a moov probe)
     - `GET /wallpaper-engine/transcoded/<token>?fps=N` → frame-skip transcode stream (one-time ffmpeg re-encode, disk-cached)
     - `GET /wallpaper-engine/transcode-progress/<token>?fps=N` → download / transcode progress (progress-bar polling)
- **Client half** (`lib/client.js`): a browser module that fetches the inventory and renders the selected
  wallpaper into a fixed layer *behind* the app columns, plus a **first-level settings page**
  "Wallpaper Engine" (liquid-glass card, picker modal, hide/restore, playback speed / flip, accent color +
  glass transparency, and custom-upload management).
- **Custom-upload storage**: uploaded files are written to a plugin-managed local directory (default
  `~/.dsh-wallpaper-engine/uploads`, changeable from the settings UI) and served through the same
  `/media` + `/preview` routes as WE media — identical pipeline, survives restarts, no browser quota limits.

> Development details (build artifacts, hot-mount rules, cache-key prefixes) live in
> [`../CONTRIBUTING.md`](../CONTRIBUTING.md).
