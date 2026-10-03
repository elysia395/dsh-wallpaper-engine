# 宿主路由索引（P2-11 前置 1 · 自动生成，勿手改）

> 生成：`node test/tools/host-route-index.mjs --write`；核对：`node test/verify-route-index.mjs`
> （守卫会在索引与代码不一致时失败 —— 索引因此不会烂掉）。
>
> **依赖** = 该处理器块里引用到的 `apply` 作用域声明（缩进 ≤2）= **将来 context 对象的字段候选**；
> 同一列里反复出现的名字，就是该提出来的字段。拆到 `lib/routes/*.js` 的族则列它的 **`c` 字段**。
> 循环里注册的路由（`for (const seg of [...])`）按**实际条数**逐条列出，不折叠成一行。
> 路径列省略 `${BASE}` 前缀；因此**看起来同名的两行**是同一路径同时挂了根路径与带前缀
> 两条注册（渲染页按根路径上报，只挂一条会静默 404）。提及判定带尾边界，`/media` 不会被
> `/media-info` 误算成已覆盖。

共 **37** 条路由。

| # | 路径 | 来源 | 形态 | 依赖（闭包状态 / `c` 字段） | 守卫提及 |
|---|---|---|---|---|---|
| 1 | `/inventory` | lib/index.js:3123 | async 箭头 | webServer buildInventory disposers observeAdapter | 15 |
| 2 | `/media-info` | lib/index.js:3263 | 箭头 | webServer log mediaMap disposers | 7 |
| 3 | `/transcode-progress` | lib/index.js:3293 | 箭头 | webServer mediaMap disposers | 2 |
| 4 | `/transcoded` | lib/index.js:3346 | 箭头 | webServer mediaMap disposers serveFile | 1 |
| 5 | `/media` | lib/index.js:3402 | 箭头 | webServer log mediaMap disposers serveFile | 17 |
| 6 | `/preview` | lib/index.js:3402 | 箭头 | webServer log mediaMap disposers serveFile | 8 |
| 7 | `/video-preview` | lib/index.js:3431 | 箭头 | webServer mediaMap disposers serveFile | 1 |
| 8 | `/scene-frame` | lib/routes/scene-frame.js:73 | 箭头 | disposers base mediaMap trackStream customFramePath customIdFromAbs …(+3) | 11 |
| 9 | `/scene-frame-cache` | lib/routes/scene-frame.js:151 | 箭头 | disposers base mediaMap GPU_FRAME_MAX_BYTES GPU_WRITE_INFLIGHT armBodyIdleTimeout …(+4) | 4 |
| 10 | `/custom-frame` | lib/routes/scene-frame.js:238 | 箭头 | disposers base serveFile CUSTOM_FRAME_EXT CUSTOM_FRAME_MAX_BYTES armBodyIdleTimeout …(+3) | 2 |
| 11 | `/scene-live` | lib/routes/scene-serve.js:53 | 箭头 | disposers base WEBWALLGL_DIR appendDiagLine traceRequests serveFile …(+1) | 7 |
| 12 | `/scene-files` | lib/routes/scene-serve.js:91 | 箭头 | disposers base handleSceneFiles | 5 |
| 13 | `/media-origin` | lib/routes/scene-serve.js:99 | 箭头 | disposers base mediaOriginInfo | 1 |
| 14 | `/scene-payload-progress` | lib/routes/scene-serve.js:119 | 箭头 | disposers base payloadProgress | 1 |
| 15 | `/props` | lib/index.js:3782 | 箭头 | webServer mediaMap disposers | 5 |
| 16 | `/live-frame` | lib/index.js:3828 | 箭头 | webServer mediaMap disposers serveFile | 2 |
| 17 | `/media-status` | lib/routes/now-playing.js:76 | 箭头 | disposers base | 2 |
| 18 | `/audio-spectrum` | lib/routes/now-playing.js:86 | 箭头 | disposers base | 2 |
| 19 | `/now-playing` | lib/routes/now-playing.js:105 | 箭头 | disposers base | 3 |
| 20 | `/now-playing/artwork` | lib/routes/now-playing.js:119 | 箭头 | disposers base serveFile | 2 |
| 21 | `/media-control` | lib/routes/now-playing.js:137 | 箭头 | disposers base | 3 |
| 22 | `/client-diag` | lib/routes/diag.js:78 | 箭头 | disposers appendDiagLine notice base | 3 |
| 23 | `/diag` | lib/routes/diag.js:142 | 箭头 | disposers | 9 |
| 24 | `/diag` | lib/routes/diag.js:143 | 箭头 | disposers base | 9 |
| 25 | `/diag-log` | lib/routes/diag.js:144 | 箭头 | disposers log base | 2 |
| 26 | `/api/local-assets` | lib/index.js:3913 | async 箭头 | webServer disposers serveFile | 1 |
| 27 | `/we-assets-dir` | lib/index.js:3963 | 箭头 | webServer disposers | 3 |
| 28 | `/scene-video` | lib/index.js:4029 | 箭头 | webServer mediaMap disposers serveFile SCENE_VIDEO_INFLIGHT | 1 |
| 29 | `/scene-audio` | lib/index.js:4112 | 箭头 | webServer mediaMap disposers serveFile | 2 |
| 30 | `/upload` | lib/routes/upload.js:68 | 箭头 | disposers base tokenFor UPLOAD_EXT UPLOAD_MAX_BYTES ensureUploadDir …(+6) | 4 |
| 31 | `/remove` | lib/routes/upload.js:218 | 箭头 | disposers base CONTROL_JSON_MAX_BYTES ensureUploadDir removeUploadMeta resolveUploadFile …(+1) | 1 |
| 32 | `/upload-dir` | lib/routes/upload.js:275 | 箭头 | disposers base CONTROL_JSON_MAX_BYTES setUploadDir normalizeUserDir armBodyIdleTimeout | 2 |
| 33 | `/fontsets` | lib/routes/fontsets.js:251 | async 箭头 | disposers base readFontSetId | 5 |
| 34 | `/star-count` | lib/routes/github-stars.js:105 | async 箭头 | disposers base repoSlug log | 2 |
| 35 | `/about-qr` | lib/routes/about-qr.js:62 | 箭头 | disposers base aboutDir serveFile | 3 |
| 36 | `/metrics` | lib/routes/metrics.js:35 | 箭头 | disposers base | 2 |
| 37 | `/settings` | lib/index.js:4187 | 箭头 | webServer disposers adapterFenceSeen adapterOverride observeAdapter adapterDetectedTarget …(+1) | 17 |

**零提及（拆分前必须先补守卫）**：（无）

**被最多路由引用的闭包状态（context 字段优先级，仅 `lib/index.js` 内的路由）**：

`webServer`×14 · `disposers`×14 · `mediaMap`×10 · `serveFile`×8 · `log`×3 · `observeAdapter`×2 · `buildInventory`×1 · `SCENE_VIDEO_INFLIGHT`×1 · `adapterFenceSeen`×1 · `adapterOverride`×1 · `adapterDetectedTarget`×1 · `SETTINGS_MAX_BYTES`×1

**路由模块的 context 契约**（声明了却没用到的字段单独标出 —— 那是死声明）：

| 模块 | 入口 | 路由数 | `c` 字段 | 死声明 |
|---|---|---|---|---|
| `lib/routes/about-qr.js` | `registerAboutQrRoutes(webServer, c)` | 1 | `disposers` `base` `aboutDir` `serveFile` | — |
| `lib/routes/diag.js` | `registerDiagRoutes(webServer, c)` | 4 | `disposers` `appendDiagLine` `log` `notice` `base` `onHandleDiag` | — |
| `lib/routes/fontsets.js` | `registerFontsetsRoutes(webServer, c)` | 1 | `disposers` `base` `readFontSetId` | — |
| `lib/routes/github-stars.js` | `registerGithubStarsRoutes(webServer, c)` | 1 | `disposers` `base` `repoSlug` `cachePath` `log` `fetchJson` | — |
| `lib/routes/metrics.js` | `registerMetricsRoutes(webServer, c)` | 1 | `disposers` `base` `log` | — |
| `lib/routes/now-playing.js` | `registerNowPlayingRoutes(webServer, c)` | 5 | `disposers` `base` `appendDiagLine` `configPath` `readConfig` `serveFile` `log` | — |
| `lib/routes/scene-frame.js` | `registerSceneFrameRoutes(webServer, c)` | 3 | `disposers` `base` `mediaMap` `trackStream` `serveFile` `GPU_FRAME_MAX_BYTES` `GPU_WRITE_INFLIGHT` `CUSTOM_FRAME_EXT` `CUSTOM_FRAME_MAX_BYTES` `armBodyIdleTimeout` `atomicWriteFileP` `customFrameDir` `customFramePath` `customIdFromAbs` `gpuFrameFileFor` `lingerClose` `looksLikePng` `pngSizeOf` `sceneFrameSlot` | — |
| `lib/routes/scene-serve.js` | `registerSceneServeRoutes(webServer, c)` | 4 | `disposers` `base` `WEBWALLGL_DIR` `appendDiagLine` `traceRequests` `serveFile` `handleSceneFiles` `mediaOriginInfo` `payloadProgress` `log` | — |
| `lib/routes/upload.js` | `registerUploadRoutes(webServer, c)` | 3 | `disposers` `base` `tokenFor` `UPLOAD_EXT` `UPLOAD_MAX_BYTES` `CONTROL_JSON_MAX_BYTES` `ensureUploadDir` `readUploadMeta` `metaEntry` `setUploadMeta` `removeUploadMeta` `resolveUploadFile` `setUploadDir` `normalizeUserDir` `armBodyIdleTimeout` `lingerClose` | — |

