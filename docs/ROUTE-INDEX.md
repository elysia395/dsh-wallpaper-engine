# 宿主路由索引（P2-11 前置 1 · 自动生成，勿手改）

> 生成：`node test/tools/host-route-index.mjs --write`；核对：`node test/verify-route-index.mjs`
> （守卫会在索引与代码不一致时失败 —— 索引因此不会烂掉）。
>
> **依赖** = 该处理器块里引用到的 `apply` 作用域声明（缩进 ≤2）= **将来 context 对象的字段候选**；
> 同一列里反复出现的名字，就是该提出来的字段。拆成独立模块的族（`lib/routes/*.js` 或
> 组件目录里的实现文件）则列它的 **`c` 字段**。
> 循环里注册的路由（`for (const seg of [...])`）按**实际条数**逐条列出，不折叠成一行。
> 路径列省略 `${BASE}` 前缀；因此**看起来同名的两行**是同一路径同时挂了根路径与带前缀
> 两条注册（渲染页按根路径上报，只挂一条会静默 404）。**守卫提及**列的口径：该路由以
> 路由形状（尾边界，`/media` 不被 `/media-info` 误算）出现在几个守卫/冒烟文件的**代码**里；
> `lib/…`、`src/…`、`test/…` 这类**代码路径**先被遮掉 ⇒ 也不会被 `lib/media/mp4-probe.js`
> 这类源文件路径误算（提及 ≠ 有断言；零提及 = 拆前无安全网）。

共 **44** 条路由。

| # | 路径 | 来源 | 形态 | 依赖（闭包状态 / `c` 字段） | 守卫提及 |
|---|---|---|---|---|---|
| 1 | `/inventory` | lib/routes/inventory.js:90 | async 箭头 | disposers base mediaOriginApi buildInventory componentsProbe | 24 |
| 2 | `/media-info` | lib/routes/media-derived.js:60 | 箭头 | disposers base mediaMap log getMediaInfo faststartVariant …(+1) | 10 |
| 3 | `/transcode-progress` | lib/routes/media-derived.js:103 | 箭头 | disposers base mediaMap transcodeJobs | 2 |
| 4 | `/transcoded` | lib/routes/media-derived.js:156 | 箭头 | disposers base mediaMap serveFile transcodeToFps registerTranscodeWaiter | 1 |
| 5 | `/video-preview` | lib/routes/media-derived.js:215 | 箭头 | disposers base mediaMap serveFile generateVideoPreview | 2 |
| 6 | `/media` | lib/routes/media-bytes.js:39 | 箭头 | disposers base serveFile serveLayout mediaMap log …(+1) | 17 |
| 7 | `/preview` | lib/routes/media-bytes.js:39 | 箭头 | disposers base serveFile serveLayout mediaMap log …(+1) | 10 |
| 8 | `/scene-frame` | lib/routes/scene-frame.js:82 | 箭头 | disposers base mediaMap trackStream customFramePath customIdFromAbs …(+3) | 13 |
| 9 | `/scene-frame-cache` | lib/routes/scene-frame.js:168 | 箭头 | disposers base mediaMap GPU_FRAME_AREA_TOL GPU_FRAME_MAX_BYTES GPU_WRITE_INFLIGHT …(+7) | 5 |
| 10 | `/custom-frame` | lib/routes/scene-frame.js:272 | 箭头 | disposers base serveFile CUSTOM_FRAME_EXT CUSTOM_FRAME_MAX_BYTES armBodyIdleTimeout …(+3) | 3 |
| 11 | `/scene-live` | lib/routes/scene-serve.js:86 | 箭头 | disposers base WEBWALLGL_DIR WEBWALLGL_PKG_DIR appendDiagLine traceRequests …(+3) | 9 |
| 12 | `/scene-files` | lib/routes/scene-serve.js:153 | 箭头 | disposers base handleSceneFiles | 5 |
| 13 | `/media-origin` | lib/routes/scene-serve.js:161 | 箭头 | disposers base mediaOriginInfo | 1 |
| 14 | `/scene-payload-progress` | lib/routes/scene-serve.js:181 | 箭头 | disposers base payloadProgress | 1 |
| 15 | `/props` | lib/routes/props.js:45 | 箭头 | disposers base mediaMap userPropsFor | 7 |
| 16 | `/live-frame` | lib/routes/live-frame.js:44 | 箭头 | disposers base mediaMap serveFile traceRequests liveFrameFile …(+2) | 3 |
| 17 | `/occlusion` | lib/routes/occlusion.js:50 | async 箭头 | disposers base hub | 3 |
| 18 | `/client-diag` | lib/routes/diag.js:85 | 箭头 | disposers appendDiagLine notice base | 4 |
| 19 | `/diag` | lib/routes/diag.js:149 | 箭头 | disposers | 11 |
| 20 | `/diag` | lib/routes/diag.js:150 | 箭头 | disposers base | 11 |
| 21 | `/diag-log` | lib/routes/diag.js:151 | 箭头 | disposers log base componentsProbe | 3 |
| 22 | `/api/local-assets` | lib/routes/we-assets.js:69 | async 箭头 | disposers serveFile listWeAssetNames weAssetsAvailable WE_ASSETS_SOURCE_ID getWeAssetsDir | 1 |
| 23 | `/we-assets-dir` | lib/routes/we-assets.js:116 | 箭头 | disposers base CONTROL_JSON_MAX_BYTES normalizeUserDir setWeAssetsDir listWeAssetNames …(+2) | 3 |
| 24 | `/scene-video` | lib/routes/scene-media.js:54 | 箭头 | disposers base mediaMap serveFile ensureFrameCacheDir sceneVideoProbeKey …(+3) | 3 |
| 25 | `/scene-audio` | lib/routes/scene-media.js:138 | 箭头 | disposers base mediaMap serveFile ensureSceneAudio | 4 |
| 26 | `/upload` | lib/routes/upload.js:72 | 箭头 | disposers base tokenFor UPLOAD_EXT UPLOAD_MAX_BYTES ensureUploadDir …(+6) | 4 |
| 27 | `/remove` | lib/routes/upload.js:222 | 箭头 | disposers base CONTROL_JSON_MAX_BYTES ensureUploadDir removeUploadMeta resolveUploadFile …(+1) | 1 |
| 28 | `/upload-dir` | lib/routes/upload.js:279 | 箭头 | disposers base CONTROL_JSON_MAX_BYTES setUploadDir normalizeUserDir armBodyIdleTimeout | 3 |
| 29 | `/glass-presets` | lib/routes/presets.js:502 | async 箭头 | disposers base | 1 |
| 30 | `/settings` | lib/routes/settings.js:158 | 箭头 | disposers base ctx mediaOriginApi readSettings isBetterSidebarLoaded …(+3) | 20 |
| 31 | `/cache-dir` | lib/routes/cache-dir.js:47 | 箭头 | disposers base CONTROL_JSON_MAX_BYTES normalizeUserDir cacheBaseDir setCacheDir …(+1) | 1 |
| 32 | `/cache-dir/browse` | lib/routes/cache-dir.js:115 | 箭头 | disposers base normalizeUserDir | 1 |
| 33 | `/star-count` | packages/about-notice/lib/routes/github-stars.js:109 | async 箭头 | disposers base repoSlug log http | 2 |
| 34 | `/about-qr` | packages/about-notice/lib/routes/about-qr.js:69 | 箭头 | disposers base aboutDir serveFile | 3 |
| 35 | `/fontsets` | packages/fonts/lib/routes/fontsets.js:255 | async 箭头 | disposers base readFontSetId | 4 |
| 36 | `/system-fonts` | packages/fonts/lib/routes/system-fonts.js:487 | async 箭头 | disposers base http | 3 |
| 37 | `/mascot` | packages/mascot-avatar/lib/routes/mascot.js:50 | 箭头 | disposers base serveFile http mascotDir mascotPath …(+5) | 5 |
| 38 | `/avatar` | packages/mascot-avatar/lib/routes/avatar.js:54 | 箭头 | disposers base serveFile http avatarDir avatarPath …(+6) | 5 |
| 39 | `/media-status` | packages/media-bridge/lib/routes/now-playing.js:87 | 箭头 | disposers base | 2 |
| 40 | `/audio-spectrum` | packages/media-bridge/lib/routes/now-playing.js:97 | 箭头 | disposers base | 2 |
| 41 | `/now-playing` | packages/media-bridge/lib/routes/now-playing.js:116 | 箭头 | disposers base | 3 |
| 42 | `/now-playing/artwork` | packages/media-bridge/lib/routes/now-playing.js:130 | 箭头 | disposers base serveFile | 2 |
| 43 | `/media-control` | packages/media-bridge/lib/routes/now-playing.js:148 | 箭头 | disposers base CONTROL_JSON_MAX_BYTES http | 3 |
| 44 | `/pet-link/capability` | packages/pet-link/lib/routes/pet-link.js:14 | 箭头 | disposers base | 2 |

**零提及（拆分前必须先补守卫）**：（无）

**被最多路由引用的闭包状态（context 字段优先级，仅 `lib/index.js` 内的路由）**：



**路由模块的 context 契约**（声明了却没用到的字段单独标出 —— 那是死声明）：

| 模块 | 入口 | 路由数 | `c` 字段 | 死声明 |
|---|---|---|---|---|
| `lib/routes/cache-dir.js` | `registerCacheDirRoutes(webServer, c)` | 2 | `disposers` `base` `CONTROL_JSON_MAX_BYTES` `normalizeUserDir` `cacheBaseDir` `setCacheDir` `armBodyIdleTimeout` | — |
| `lib/routes/diag.js` | `registerDiagRoutes(webServer, c)` | 4 | `disposers` `appendDiagLine` `log` `notice` `base` `onHandleDiag` `componentsProbe` | — |
| `lib/routes/inventory.js` | `registerInventoryRoutes(webServer, c)` | 1 | `disposers` `base` `mediaOriginApi` `buildInventory` `componentsProbe` | — |
| `lib/routes/live-frame.js` | `registerLiveFrameRoutes(webServer, c)` | 1 | `disposers` `base` `mediaMap` `serveFile` `traceRequests` `liveFrameFile` `atomicWriteFileSync` `lingerClose` | — |
| `lib/routes/media-bytes.js` | `registerMediaBytesRoutes(webServer, c)` | 2 | `disposers` `base` `serveFile` `serveLayout` `mediaMap` `log` `pinnedFaststartVariant` | — |
| `lib/routes/media-derived.js` | `registerMediaDerivedRoutes(webServer, c)` | 4 | `disposers` `base` `mediaMap` `serveFile` `log` `getMediaInfo` `faststartVariant` `transcodeJobs` `transcodeToFps` `registerTranscodeWaiter` `generateVideoPreview` `transcodeCached` | — |
| `lib/routes/occlusion.js` | `registerOcclusionRoutes(webServer, c)` | 1 | `disposers` `base` `hub` `log` `diag` | — |
| `lib/routes/presets.js` | `registerGlassPresetsRoutes(webServer, c)` | 1 | `disposers` `base` | — |
| `lib/routes/props.js` | `registerPropsRoutes(webServer, c)` | 1 | `disposers` `base` `mediaMap` `userPropsFor` | — |
| `lib/routes/scene-frame.js` | `registerSceneFrameRoutes(webServer, c)` | 3 | `disposers` `base` `mediaMap` `trackStream` `serveFile` `GPU_FRAME_AREA_TOL` `GPU_FRAME_MAX_BYTES` `GPU_WRITE_INFLIGHT` `CUSTOM_FRAME_EXT` `CUSTOM_FRAME_MAX_BYTES` `armBodyIdleTimeout` `atomicWriteFileP` `customFrameDir` `customFramePath` `customIdFromAbs` `gpuFrameFileFor` `lingerClose` `looksLikePng` `pngDimsOfBuf` `pngSizeOf` `sceneFrameSlot` | — |
| `lib/routes/scene-media.js` | `registerSceneMediaRoutes(webServer, c)` | 2 | `disposers` `base` `mediaMap` `serveFile` `ensureFrameCacheDir` `sceneVideoProbeKey` `sceneVideoProbeSet` `atomicWriteFileP` `ensureSceneAudio` `SCENE_VIDEO_INFLIGHT` | — |
| `lib/routes/scene-serve.js` | `registerSceneServeRoutes(webServer, c)` | 4 | `disposers` `base` `WEBWALLGL_DIR` `WEBWALLGL_PKG_DIR` `appendDiagLine` `traceRequests` `serveFile` `handleSceneFiles` `mediaOriginInfo` `payloadProgress` `log` | — |
| `lib/routes/settings.js` | `registerSettingsRoutes(webServer, c)` | 1 | `disposers` `base` `ctx` `mediaOriginApi` `readSettings` `isBetterSidebarLoaded` `sanitizeSettings` `withLegacyFontValues` `mergeSettings` `armBodyIdleTimeout` `lingerClose` | — |
| `lib/routes/upload.js` | `registerUploadRoutes(webServer, c)` | 3 | `disposers` `base` `tokenFor` `UPLOAD_EXT` `UPLOAD_MAX_BYTES` `CONTROL_JSON_MAX_BYTES` `ensureUploadDir` `readUploadMeta` `metaEntry` `setUploadMeta` `removeUploadMeta` `resolveUploadFile` `setUploadDir` `normalizeUserDir` `armBodyIdleTimeout` `lingerClose` | — |
| `lib/routes/we-assets.js` | `registerWeAssetsRoutes(webServer, c)` | 2 | `disposers` `base` `serveFile` `CONTROL_JSON_MAX_BYTES` `normalizeUserDir` `setWeAssetsDir` `listWeAssetNames` `weAssetsAvailable` `WE_ASSETS_SOURCE_ID` `getWeAssetsDir` | — |
| `packages/about-notice/lib/routes/about-qr.js` | `registerAboutQrRoutes(webServer, c)` | 1 | `disposers` `base` `aboutDir` `serveFile` | — |
| `packages/about-notice/lib/routes/github-stars.js` | `registerGithubStarsRoutes(webServer, c)` | 1 | `disposers` `base` `repoSlug` `cachePath` `log` `http` `fetchJson` | — |
| `packages/fonts/lib/routes/fontsets.js` | `registerFontsetsRoutes(webServer, c)` | 1 | `disposers` `base` `readFontSetId` | — |
| `packages/fonts/lib/routes/system-fonts.js` | `registerSystemFontsRoutes(webServer, c)` | 1 | `disposers` `base` `cachePath` `log` `schema` `http` `platform` `home` `fontDirs` `runFontCommand` | — |
| `packages/mascot-avatar/lib/routes/avatar.js` | `registerAvatarRoutes(webServer, c)` | 1 | `disposers` `base` `serveFile` `http` `avatarDir` `avatarPath` `AVATAR_SIDES` `AVATAR_EXT` `AVATAR_MAX_BYTES` `atomicWriteFileP` `armBodyIdleTimeout` `lingerClose` | — |
| `packages/mascot-avatar/lib/routes/mascot.js` | `registerMascotRoutes(webServer, c)` | 1 | `disposers` `base` `serveFile` `http` `mascotDir` `mascotPath` `MASCOT_EXT` `MASCOT_MAX_BYTES` `atomicWriteFileP` `armBodyIdleTimeout` `lingerClose` | — |
| `packages/media-bridge/lib/routes/now-playing.js` | `registerNowPlayingRoutes(webServer, c)` | 5 | `disposers` `base` `appendDiagLine` `configPath` `cacheBaseDir` `readConfig` `serveFile` `CONTROL_JSON_MAX_BYTES` `log` `http` | — |
| `packages/pet-link/lib/routes/pet-link.js` | `registerPetLinkRoutes(webServer, c)` | 1 | `disposers` `base` | — |

