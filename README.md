# dsh-plugin-wallpaper-engine

[English](README.en.md) | [中文](README.md) | [🆕 小白上手版](README.beginner.md)

[![npm version](https://img.shields.io/npm/v/dsh-plugin-wallpaper-engine)](https://www.npmjs.com/package/dsh-plugin-wallpaper-engine)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![ci](https://github.com/elysia395/dsh-wallpaper-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/elysia395/dsh-wallpaper-engine/actions/workflows/ci.yml)

一个 DSH bundle：把你电脑上的 **Wallpaper Engine** 壁纸变成 **DSH 网页界面（`dsh web`）的背景**，配以 iOS 风格液态玻璃效果。

> **只想用起来？** 直接看 [小白上手版](README.beginner.md)，零术语、照着点就行。

## 功能总览

- **Video / Web 壁纸**：`.mp4` 在 `<video>` 中播放，HTML 在沙箱 `<iframe>` 中加载；
- **Scene 壁纸静态帧**（v0.3）：从 `scene.pkg` / `scene.json` 提取主纹理作为静态背景，带质量门与工坊预览图回退；
- **液态玻璃**：整个 DSH 原生设置窗口 + 输入栏/气泡的毛玻璃化，配色 / 玻璃颜色 / 玻璃透明度 / 模糊统一调节；
- **壁纸选择弹窗**：缩略图网格、分页或 CD 架紧凑布局、内容分级（G/PG13/R）与类型过滤；
- **隐藏 / 恢复**（软删除，localStorage，不碰源文件）与**批量操作**；
- **视频倍速**（0.5x–2x）、**水平翻转**、**暂停/播放**；
- **自定义壁纸**：上传本地 JPG / PNG / MP4，可换存储盘符、适配模式（覆盖/填充/居中/拉伸）、SHA-256 去重；
- **自动轮转**：自定义轮播列表（数量不限、独立间隔与顺序），可从 WE 播放列表一键导入。

![基础效果展示](https://raw.githubusercontent.com/elysia395/dsh-wallpaper-engine/main/docs/images/showcase.png)

> 壁纸 + 磨砂遮罩 + iOS 液态玻璃，渲染在 DSH 界面后方。

## 支持的壁纸类型

| 类型 | 由谁渲染 | 能否搬到 DSH |
|---|---|---|
| **Scene（场景）** | WE 自带 3D 引擎 | ✅ 静态帧 — 提取主纹理（`.pkg`/`.json` 内的 .tex / 内嵌 JPEG） |
| **Video（视频）** | `.mp4` 文件 | ✅ `<video>` 播放（支持 Range seek） |
| **Web（网页）** | WE 内置 Chromium 壳 | ✅ 沙箱 `<iframe>` 加载（见[安全模型](#安全模型)） |
| **Application（应用）** | 注入的外部窗口 | ❌ 不支持 |

## 架构

### Host 端（`lib/index.js`，纯 ESM，无构建）

一个 Cordis 插件（`inject: ['webServer']` 硬依赖），职责：

1. 读 Steam `libraryfolders.vdf` + 注册表定位 WE 安装目录（Steam 装在非默认盘也可用）；
2. 枚举 `projects/defaultprojects`、`projects/myprojects`、`steamapps/workshop/content/431960/*` 下的壁纸；
3. 在 DSH webserver 注册同源 HTTP 路由（见下文契约表）；
4. 管理自定义上传目录（迁移、持久化）与场景静态帧磁盘缓存。

库存计算带 **5 秒 TTL 缓存**（`?refresh=1` 强制重扫），注册表探测结果进程内只查一次。

### Client 端（`src/client.js` → `lib/client.js`）

浏览器模块（`window.__ModuleLoader__.load({ id, factory })` 外壳）。规范源文件是 `src/client.js` + `src/client.css`，由 `scripts/build-client.mjs` 拼接生成编译产物 `lib/client.js`。**不要手改 `lib/client.js`。**

职责：拉取库存 → 把选中壁纸渲染到应用三列后方的固定图层（`position:fixed; z-index:-2`）+ 遮罩层 → 注册一级设置页「Wallpaper Engine」。全部用户偏好保存在浏览器 `localStorage`（键 `dsh-wallpaper-engine:selection`）。

## HTTP 契约（Host ↔ Browser，同源）

| Method | Path | 入参 | 响应 | 说明 |
|---|---|---|---|---|
| GET | `/wallpaper-engine/inventory` | `?refresh=1` 强制重扫 | JSON 库存 | 5s TTL 缓存；`no-store` |
| GET | `/wallpaper-engine/media/<token>` | `Range` 头 | 视频 / HTML 流 | 206/416/304；`nosniff` |
| GET | `/wallpaper-engine/preview/<token>` | `Range` 头 | 预览图流 | 同上 |
| GET | `/wallpaper-engine/scene-frame/<token>` | — | JPEG / PNG | 按 `<版本>_<路径>_<mtime>` 磁盘缓存 |
| POST | `/wallpaper-engine/upload` | `?title=`；body 原始字节；`Content-Type` 白名单 | 壁纸条目 | 512MB 上限；流式落盘；SHA-256 去重 |
| POST | `/wallpaper-engine/remove` | JSON `{ id }` | `{ removed }` | 仅限 `up-*` 文件 |
| POST | `/wallpaper-engine/upload-dir` | JSON `{ dir, migrate? }` | 迁移统计 | 绝对路径（支持 `~`）；配置写入失败会报错 |

**Token 机制**：`<token>` 是绝对路径的 base64url，仅在库存枚举时写入进程内 `mediaMap`。路由只服务 `mediaMap` 中已登记的文件——浏览器无法通过猜测 token 读取任意文件。

## 安全模型

本插件服务的是**本机第三方内容**（Workshop 壁纸），默认按不可信输入对待：

- **路径遏制**：`project.json` 的 `file` / `preview` 字段解析后必须落在项目目录内（`path.relative` 校验）。恶意 project.json 无法用绝对路径或 `..\..` 让 `/media`、`/preview` 枚举并服务项目目录之外的文件。
- **Web 壁纸沙箱**：`<iframe sandbox="allow-scripts allow-forms">`（**不含** `allow-same-origin`）。壁纸脚本以 opaque origin 运行，**不能**访问 DSH 页面的 `localStorage` 或同源 API；相对路径的 `<img>`/`<script>` 子资源（no-cors）不受影响。
  - 已知代价：少数依赖同源读取或指针锁定的交互型 Web 壁纸可能功能不全。这是有意取舍，已同步文档。
- **上传白名单**：仅 JPG / PNG / MP4；浏览器与 host 双重校验；512MB 上限；服务时 `X-Content-Type-Options: nosniff`。
- **不出网**：媒体只在本机 loopback 流动，不上传任何服务器。

## 磁盘布局

```
~/.dsh-wallpaper-engine/
├── config.json          # 记录上传目录（可被 DSH_WE_UPLOAD_DIR 环境变量覆盖）
├── uploads/             # 自定义壁纸（默认位置，可在设置中迁移到任意盘符）
│   └── .meta.json       # 上传元数据（标题 + sha256，用于去重）
└── cache/frames/        # Scene 静态帧缓存（DSH_WE_CACHE_DIR 可覆盖）
```

除以上数据外，插件不写任何持久化 DSH 设置；对 agent 零 token 开销。

## 场景静态帧：工作原理

- **读取**：解析 `scene.pkg`（PKGV 容器 + LZ4 条目链）或松散 `scene.json` 目录；从第一个 image 对象出发定位主纹理，其余 .tex 按「艺术图可能性」评分兜底（内嵌 JPEG/PNG 最高分，mask/effect/depth 降权，R8/RG88 灰度几乎排除）。
- **解码**：TEX 容器（TEXV0005/TEXI0001、TEXB0001-4）→ **RGBA8888 / R8 / RG88 / DXT1 / DXT3 / DXT5**，以及 **WE 内嵌 JPEG / PNG**（原样直出）。
- **质量门**：灰度 >88% 或纯色（方差 <3）的帧被拒绝并尝试下一候选；全部失败回退项目 `preview.jpg`。
- **缓存**：`<版本>_<路径>_<mtime>` 键控；工坊更新自动失效。
- **限制**：BC7 / RGB565 / 16 位浮点无法解码（回退预览图）；静态帧 ≠ 3D 渲染。

## 安装

### 用户（发布版，推荐）

```sh
dsh plugin --profile web add dsh-plugin-wallpaper-engine
```

重启 `dsh web` → 设置 → Wallpaper Engine。

> **macOS**：macOS 无 WE 客户端；本插件的 macOS 版（WaifuX + 散装媒体支持）由社区维护者 Jerry 维护，独立发布：
>
> ```sh
> dsh plugin --profile web add dsh-plugin-wallpaper-engine-mac
> ```
>
> 仓库：https://github.com/ruijiaang-lab/dsh-wallpaper-engine

### 开发者（本地源码运行）

```sh
git clone https://github.com/elysia395/dsh-wallpaper-engine.git
dsh plugin --profile web add link:<插件文件夹绝对路径>
```

`link:` 与源码文件夹建立实时连接：改完 `src/client.js` 或 `src/client.css` 后 `npm run build` 并重启 `dsh web` 即生效。host 端是纯 ESM，改完重启 `dsh web` 即可。

## 使用

1. `dsh web` → 设置 → 左侧导航 **Wallpaper Engine**（一级设置页）。
2. **选择壁纸** 打开弹窗，点选一张壁纸；ESC / 点遮罩关闭。
3. 「壁纸效果」区四个滑动条：壁纸模糊 / 暗化 / 边框 / 玻璃（0–60px，与设置窗口玻璃共用一套配方）。
4. 「外观」区：设置窗口液态玻璃总开关、配色（6 预设 + 取色器）、玻璃颜色、玻璃透明度。

所有选择保存在 `localStorage`，刷新 / 重启不丢。浅色 / 深色主题请来回切换找到适合当前壁纸的一种；文字看不清时调高 **暗化**、**边框**。

## 配置与隐私

- 无 model-visible tool、无 prompt 文本——对 agent 零 token 开销。
- 隐藏状态、轮播列表、过滤器等均在浏览器 `localStorage`；不写任何持久化 DSH 设置。
- 唯一落盘数据：上传文件、`uploads/.meta.json`、`config.json`（约百字节）、场景帧缓存（见[磁盘布局](#磁盘布局)）。
- 分级读取自 `project.json` 的 `contentrating` 字段，与 WE 客户端显示一致，但**不跟随** WE 客户端的成人内容开关（插件直接扫盘）。

## 与 dsh-better-sidebar 的兼容

液态玻璃效果对 dsh-better-sidebar 的侧边栏面板做了专门适配（毛玻璃、高光与层级统一），三列共享同一套「壁纸 + 遮罩」背景。

## 已知限制

- Scene（原生 3D）与 Application 无法内嵌；动态渲染仍是 WE 桌面的工作。
- 浏览器需允许静音 `<video>` 自动播放（DSH 跑在 loopback，现代浏览器默认允许）。
- Web 壁纸运行在无同源权限的沙箱中（见[安全模型](#安全模型)）。
- 选择器文案为中英混合（未接入 DSH locale 命名空间；文案已集中在 `src/client.js` 顶部 `STR` 表中，为 i18n 铺路）。
- 纯 shader / 程序生成类场景、BC7 等特殊纹理、视频纹理驱动场景会回退工坊预览图——预期行为，非缺陷（本机实测约 80%+ 场景能提取出接近原图的静态帧）。

## 开发

```sh
npm run build             # 从 src/client.js + src/client.css 重新生成 lib/client.js
npm test                  # = npm run verify && npm run verify:scene
npm run diagnose:scenes   # 批量诊断本机场景壁纸，输出 scene-diagnosis.tsv
```

- Host 端（`lib/index.js`、`lib/pkg-extract.js`）为纯 ESM，无构建步骤。
- Client 端规范源文件是 `src/client.js`（逻辑 + React 树）与 `src/client.css`（全部样式）；`scripts/build-client.mjs` 在构建时把 CSS 注入模板字面量并生成 `window.__ModuleLoader__.load(...)` 外壳。**不要手改 `lib/client.js`。**
- `npm install` / `pnpm install` 触发 `prepare` → `build`，全新 checkout 始终带最新产物。
- 测试要求 Node ≥ 18（见 `package.json` `engines`）；CI 在 Node 18/20/22 上运行全部验证脚本。
- 二进制解析器（PKG/LZ4/TEX/DXT/PNG）在 `lib/pkg-extract.js` 单一实现；`scripts/diagnose-scenes.mjs` 通过其导出复用，请勿在脚本中复制解析逻辑。

### 仓库体积说明

`docs/images/` 目前约 47MB（其中 `vinyl-record.gif` 39MB）。如需压缩，建议：

```sh
# PNG（无损压缩）
oxipng --opt max docs/images/*.png
# GIF → 动图 WebP / MP4（体积可降 90%+）
ffmpeg -i docs/images/vinyl-record.gif -c:v libwebp -lossless 0 docs/images/vinyl-record.webp
```

## 贡献

改动请遵循：先改 `src/` 再 `npm run build`；提交前跑 `npm test`。MIT License（见 [LICENSE](LICENSE)）。
