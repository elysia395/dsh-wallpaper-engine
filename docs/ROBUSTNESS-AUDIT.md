# 健壮性审计记录（2026-08-30）

> 目标：杜绝"我这能用、你那不行"。审计维度：发布包完整性、编码、跨平台、运行时容错、依赖兼容。
> 审计方法：脚本化校验（导入闭包/打包/编码扫描）+ 关键代码深读。配套工具：`scripts/audit-import-closure.mjs`。

---

## 1. 发布包完整性（最高优先级 — 0.6.7 缺 scene-script-apis.js 事故的同类检查）

| 检查 | 结果 |
|---|---|
| lib/ 全部运行时导入闭包 vs `files` 列表 | ✅ 68 文件 / 63 被导入目标全部覆盖（`scripts/audit-import-closure.mjs`，可随时重跑） |
| `npm pack --dry-run` 实际内容 | ✅ 75 文件 / 865KB；关键文件（scene-script-apis.js、worker、cordis.patch.yml、gpu-gl/gpu-dawn/scene/materials/render/registry/wgsl）全部在位 |
| 不应发布的内容混入 | ✅ 无 src/、scripts/、docs/、node_modules、临时文件（`prepare` 在发布时重建 client、tarball 内无源） |
| worker 路径解析 | ✅ `new URL('./scene-render-worker.mjs', import.meta.url)` 相对 lib/，发布包内正确 |

**保证**：发布前 `npm pack --dry-run` + `node scripts/audit-import-closure.mjs` 双检查；`prepare` 保证 `lib/client.js` 始终由发布时的 `src/client.js` 构建。

## 2. 编码健壮性

| 检查 | 结果 |
|---|---|
| 全仓 91 个源文件 UTF-8 合法性（fatal 解码） | ✅ 全部合法 |
| BOM 扫描（JSON.parse 杀手） | ✅ 无 BOM |
| 双编码语义乱码 | ⚠️ 仅 `lib/scene-scripts.js` 注释区（30 处，字节合法、显示乱码、**零运行时影响**）；可选修复，风险>收益，暂留 |

## 3. 跨平台（Windows / Linux(WSL) / macOS）

| 路径 | 现状 |
|---|---|
| Steam 探测 | ✅ 注册表（Windows）+ reg.exe（WSL /mnt）+ env（`DSH_WE_STEAM_ROOT`）+ 已知目录 + WSL DrvFS 扫描；TTL 缓存 + in-flight 去重 |
| libraryfolders.vdf | ✅ KeyValues 解析 + `wslPath` 转 `/mnt/<盘>/...` |
| ffmpeg | ✅ 资产表 win32{x64,ia32}/linux{x64,ia32,arm,arm64}/darwin{x64,arm64} + SHA256 钉住 + 三档供给（env→本地→lazy 下载→PATH） |
| **ffmpeg spawn cwd** | ✅ **修复（2026-08-30）**：旧实现 `cwd: SystemRoot || 'C:\\'` 在 Linux/macOS 上 spawn ENOENT → ffmpeg 必失败；现非 Windows 回退继承父 cwd |
| GPU 后端 | ✅ supreium 仅 x64 + ABI 匹配才启用；arm64/加载失败 → 自动回退 CPU（`gl-core.js`）；Electron 无 prebuild → fork 系统 Node，无 node → worker_threads CPU |
| 路径分隔符/大小写 | ✅ 全程 `node:path` join；WSL 挂载路径转换 |
| `where node`（Windows 命令） | ✅ 失败捕获 → 回退已知路径（含 /usr/bin/node） |

## 4. 运行时容错（降级链）

| 场景 | 降级 |
|---|---|
| WE 未安装 / Steam 库为空 | ✅ inventory 空列表 + 客户端空态处理；GLSL 无 weAssetsDir → 效果回退原图 |
| config.json 损坏 | ✅ readConfig try/catch → {}；原子写（.tmp+fsync+rename）+ 写串行化队列防丢失更新 |
| 缓存目录创建失败 | ✅ ensureDirOnce catch + 路由级 fallback（渲染失败→主纹理提取→preview） |
| ffmpeg 缺失/下载失败 | ✅ resolveFfmpeg 三级 + PATH；转码失败 → `transcodeState:fallback` → 播原片 |
| GPU worker 失败 | ✅ fork 失败→worker_threads；渲染失败→CPU 回退；效果失败→原图 |
| scene.pkg 大文件读取 | ✅ 全异步（`await readFile`）+ 头部索引只读 scene.json（无同步阻塞） |
| 脚本死循环/异常 | ✅ vm.runInContext timeout 500ms + onError 捕获 + gpuDiag 记录 |
| 客户端 autoplay 被拒 | ✅ 首次手势兜底（pointerdown/keydown/touchstart 强制 play） |
| 视频解码错误 | ✅ sceneVideo 幽灵守卫 + 瞬时重试 2 次 + 404 立即降级 |
| 上传超限/类型不符 | ✅ 512MB 上限 + MIME 白名单 |

## 5. 依赖兼容

| 项 | 状态 |
|---|---|
| `@shaderfrog/glsl-parser`（无 main/exports，DEP0151 警告） | ⚠️ 上游包缺陷，Node 22 仅警告不报错；未来 Node 移除默认 index 查找时需换版本/加 exports shim。**watch item** |
| DSH 服务访问 | ✅ `webServer` 经 `ctx.get` 可选（headless/TUI profile 不崩） |
| `dsh-better-sidebar` 探测 | ✅ loader 条目树探测，读不到按未安装 |
| peerDependencies | ⚠️ cordis ^4.0.1 / dsh-* >=0.1.0-rc.6 — 与 DSH Desktop 版本需匹配（安装器处理）；macOS 分支独立维护 |
| Node 版本 | ✅ 使用 node: 前缀 + ?? + 可选链 + 顶层 await（Node 14.21+ 即可，DSH 宿主远新于此） |

## 6. 结论与遗留

- **已修复**：`spawnFfmpeg` 跨平台 cwd（真实 bug，非 Windows 上 ffmpeg 必失败）。
- **已保证**：发布包导入闭包完整、编码合法、降级链全覆盖。
- **watch items**（非阻断）：glsl-parser exports（DEP0151）；scene-scripts.js 双编码注释（观感）；`STEAM_PROBE_DIRS` 未过 wslPath（无碍，WSL 由 /mnt 扫描覆盖）。

**重跑审计**：`node scripts/audit-import-closure.mjs && npm pack --dry-run && npm run verify && node scripts/verify-scene.mjs`
