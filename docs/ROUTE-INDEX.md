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

共 **41** 条路由。

| # | 路径 | 来源 | 形态 | 依赖（闭包状态 / `c` 字段） | 守卫提及 |
|---|---|---|---|---|---|
| 1 | `/inventory` | lib/index.js:3005 | async 箭头 | webServer disposers mediaOriginApi buildInventory | 22 |
| 2 | `/media-info` | lib/routes/media-derived.js:57 | 箭头 | disposers base mediaMap log getMediaInfo faststartVariant …(+1) | 9 |
| 3 | `/transcode-progress` | lib/routes/media-derived.js:100 | 箭头 | disposers base mediaMap transcodeJobs | 2 |
| 4 | `/transcoded` | lib/routes/media-derived.js:153 | 箭头 | disposers base mediaMap serveFile transcodeToFps registerTranscodeWaiter | 1 |
| 5 | `/video-preview` | lib/routes/media-derived.js:212 | 箭头 | disposers base mediaMap serveFile generateVideoPreview | 2 |
| 6 | `/media` | lib/routes/media-bytes.js:36 | 箭头 | disposers base serveFile serveLayout mediaMap log …(+1) | 20 |
| 7 | `/preview` | lib/routes/media-bytes.js:36 | 箭头 | disposers base serveFile serveLayout mediaMap log …(+1) | 10 |
| 8 | `/scene-frame` | lib/routes/scene-frame.js:74 | 箭头 | disposers base mediaMap trackStream customFramePath customIdFromAbs …(+3) | 12 |
| 9 | `/scene-frame-cache` | lib/routes/scene-frame.js:152 | 箭头 | disposers base mediaMap GPU_FRAME_MAX_BYTES GPU_WRITE_INFLIGHT armBodyIdleTimeout …(+4) | 4 |
| 10 | `/custom-frame` | lib/routes/scene-frame.js:237 | 箭头 | disposers base serveFile CUSTOM_FRAME_EXT CUSTOM_FRAME_MAX_BYTES armBodyIdleTimeout …(+3) | 3 |
| 11 | `/scene-live` | lib/routes/scene-serve.js:53 | 箭头 | disposers base WEBWALLGL_DIR appendDiagLine traceRequests serveFile …(+1) | 7 |
| 12 | `/scene-files` | lib/routes/scene-serve.js:91 | 箭头 | disposers base handleSceneFiles | 5 |
| 13 | `/media-origin` | lib/routes/scene-serve.js:99 | 箭头 | disposers base mediaOriginInfo | 1 |
| 14 | `/scene-payload-progress` | lib/routes/scene-serve.js:119 | 箭头 | disposers base payloadProgress | 1 |
| 15 | `/props` | lib/routes/props.js:42 | 箭头 | disposers base mediaMap userPropsFor | 7 |
| 16 | `/live-frame` | lib/routes/live-frame.js:41 | 箭头 | disposers base mediaMap serveFile traceRequests liveFrameFile …(+2) | 2 |
| 17 | `/media-status` | lib/routes/now-playing.js:82 | 箭头 | disposers base | 2 |
| 18 | `/audio-spectrum` | lib/routes/now-playing.js:92 | 箭头 | disposers base | 2 |
| 19 | `/now-playing` | lib/routes/now-playing.js:111 | 箭头 | disposers base | 3 |
| 20 | `/now-playing/artwork` | lib/routes/now-playing.js:125 | 箭头 | disposers base serveFile | 2 |
| 21 | `/media-control` | lib/routes/now-playing.js:143 | 箭头 | disposers base | 3 |
| 22 | `/client-diag` | lib/routes/diag.js:78 | 箭头 | disposers appendDiagLine notice base | 4 |
| 23 | `/diag` | lib/routes/diag.js:142 | 箭头 | disposers | 10 |
| 24 | `/diag` | lib/routes/diag.js:143 | 箭头 | disposers base | 10 |
| 25 | `/diag-log` | lib/routes/diag.js:144 | 箭头 | disposers log base | 2 |
| 26 | `/api/local-assets` | lib/routes/we-assets.js:66 | async 箭头 | disposers serveFile listWeAssetNames weAssetsAvailable WE_ASSETS_SOURCE_ID getWeAssetsDir | 1 |
| 27 | `/we-assets-dir` | lib/routes/we-assets.js:113 | 箭头 | disposers base CONTROL_JSON_MAX_BYTES normalizeUserDir setWeAssetsDir listWeAssetNames …(+2) | 3 |
| 28 | `/scene-video` | lib/routes/scene-media.js:51 | 箭头 | disposers base mediaMap serveFile ensureFrameCacheDir sceneVideoProbeKey …(+3) | 2 |
| 29 | `/scene-audio` | lib/routes/scene-media.js:135 | 箭头 | disposers base mediaMap serveFile ensureSceneAudio | 3 |
| 30 | `/upload` | lib/routes/upload.js:68 | 箭头 | disposers base tokenFor UPLOAD_EXT UPLOAD_MAX_BYTES ensureUploadDir …(+6) | 4 |
| 31 | `/remove` | lib/routes/upload.js:218 | 箭头 | disposers base CONTROL_JSON_MAX_BYTES ensureUploadDir removeUploadMeta resolveUploadFile …(+1) | 1 |
| 32 | `/upload-dir` | lib/routes/upload.js:275 | 箭头 | disposers base CONTROL_JSON_MAX_BYTES setUploadDir normalizeUserDir armBodyIdleTimeout | 2 |
| 33 | `/fontsets` | lib/routes/fontsets.js:245 | async 箭头 | disposers base readFontSetId | 6 |
| 34 | `/glass-presets` | lib/routes/presets.js:403 | async 箭头 | disposers base | 2 |
| 35 | `/star-count` | lib/routes/github-stars.js:107 | async 箭头 | disposers base repoSlug log | 2 |
| 36 | `/system-fonts` | lib/routes/system-fonts.js:457 | async 箭头 | disposers base | 4 |
| 37 | `/about-qr` | lib/routes/about-qr.js:65 | 箭头 | disposers base aboutDir serveFile | 3 |
| 38 | `/mascot` | lib/routes/mascot.js:50 | 箭头 | disposers base serveFile mascotDir mascotPath MASCOT_EXT …(+4) | 3 |
| 39 | `/avatar` | lib/routes/avatar.js:54 | 箭头 | disposers base serveFile avatarDir avatarPath AVATAR_SIDES …(+5) | 4 |
| 40 | `/settings` | lib/routes/settings.js:50 | 箭头 | disposers base ctx mediaOriginApi readSettings isBetterSidebarLoaded …(+5) | 19 |
| 41 | `/cache-dir` | lib/routes/cache-dir.js:36 | 箭头 | disposers base CONTROL_JSON_MAX_BYTES normalizeUserDir cacheBaseDir setCacheDir …(+1) | 1 |

**零提及（拆分前必须先补守卫）**：（无）

**被最多路由引用的闭包状态（context 字段优先级，仅 `lib/index.js` 内的路由）**：

`webServer`×1 · `disposers`×1 · `mediaOriginApi`×1 · `buildInventory`×1

**路由模块的 context 契约**（声明了却没用到的字段单独标出 —— 那是死声明）：

| 模块 | 入口 | 路由数 | `c` 字段 | 死声明 |
|---|---|---|---|---|
| `lib/routes/about-qr.js` | `registerAboutQrRoutes(webServer, c)` | 1 | `disposers` `base` `aboutDir` `serveFile` | — |
| `lib/routes/avatar.js` | `registerAvatarRoutes(webServer, c)` | 1 | `disposers` `base` `serveFile` `avatarDir` `avatarPath` `AVATAR_SIDES` `AVATAR_EXT` `AVATAR_MAX_BYTES` `atomicWriteFileP` `armBodyIdleTimeout` `lingerClose` | — |
| `lib/routes/cache-dir.js` | `registerCacheDirRoutes(webServer, c)` | 1 | `disposers` `base` `CONTROL_JSON_MAX_BYTES` `normalizeUserDir` `cacheBaseDir` `setCacheDir` `armBodyIdleTimeout` | — |
| `lib/routes/diag.js` | `registerDiagRoutes(webServer, c)` | 4 | `disposers` `appendDiagLine` `log` `notice` `base` `onHandleDiag` | — |
| `lib/routes/fontsets.js` | `registerFontsetsRoutes(webServer, c)` | 1 | `disposers` `base` `readFontSetId` | — |
| `lib/routes/github-stars.js` | `registerGithubStarsRoutes(webServer, c)` | 1 | `disposers` `base` `repoSlug` `cachePath` `log` `fetchJson` | — |
| `lib/routes/live-frame.js` | `registerLiveFrameRoutes(webServer, c)` | 1 | `disposers` `base` `mediaMap` `serveFile` `traceRequests` `liveFrameFile` `atomicWriteFileSync` `lingerClose` | — |
| `lib/routes/mascot.js` | `registerMascotRoutes(webServer, c)` | 1 | `disposers` `base` `serveFile` `mascotDir` `mascotPath` `MASCOT_EXT` `MASCOT_MAX_BYTES` `atomicWriteFileP` `armBodyIdleTimeout` `lingerClose` | — |
| `lib/routes/media-bytes.js` | `registerMediaBytesRoutes(webServer, c)` | 2 | `disposers` `base` `serveFile` `serveLayout` `mediaMap` `log` `pinnedFaststartVariant` | — |
| `lib/routes/media-derived.js` | `registerMediaDerivedRoutes(webServer, c)` | 4 | `disposers` `base` `mediaMap` `serveFile` `log` `getMediaInfo` `faststartVariant` `transcodeJobs` `transcodeToFps` `registerTranscodeWaiter` `generateVideoPreview` `transcodeCached` | — |
| `lib/routes/now-playing.js` | `registerNowPlayingRoutes(webServer, c)` | 5 | `disposers` `base` `appendDiagLine` `configPath` `cacheBaseDir` `readConfig` `serveFile` `log` | — |
| `lib/routes/presets.js` | `registerGlassPresetsRoutes(webServer, c)` | 1 | `disposers` `base` | — |
| `lib/routes/props.js` | `registerPropsRoutes(webServer, c)` | 1 | `disposers` `base` `mediaMap` `userPropsFor` | — |
| `lib/routes/scene-frame.js` | `registerSceneFrameRoutes(webServer, c)` | 3 | `disposers` `base` `mediaMap` `trackStream` `serveFile` `GPU_FRAME_MAX_BYTES` `GPU_WRITE_INFLIGHT` `CUSTOM_FRAME_EXT` `CUSTOM_FRAME_MAX_BYTES` `armBodyIdleTimeout` `atomicWriteFileP` `customFrameDir` `customFramePath` `customIdFromAbs` `gpuFrameFileFor` `lingerClose` `looksLikePng` `pngSizeOf` `sceneFrameSlot` | — |
| `lib/routes/scene-media.js` | `registerSceneMediaRoutes(webServer, c)` | 2 | `disposers` `base` `mediaMap` `serveFile` `ensureFrameCacheDir` `sceneVideoProbeKey` `sceneVideoProbeSet` `atomicWriteFileP` `ensureSceneAudio` `SCENE_VIDEO_INFLIGHT` | — |
| `lib/routes/scene-serve.js` | `registerSceneServeRoutes(webServer, c)` | 4 | `disposers` `base` `WEBWALLGL_DIR` `appendDiagLine` `traceRequests` `serveFile` `handleSceneFiles` `mediaOriginInfo` `payloadProgress` `log` | — |
| `lib/routes/settings.js` | `registerSettingsRoutes(webServer, c)` | 1 | `disposers` `base` `ctx` `mediaOriginApi` `readSettings` `isBetterSidebarLoaded` `sanitizeSettings` `withLegacyFontValues` `writeSettings` `armBodyIdleTimeout` `lingerClose` | — |
| `lib/routes/system-fonts.js` | `registerSystemFontsRoutes(webServer, c)` | 1 | `disposers` `base` `cachePath` `log` `platform` `home` `fontDirs` `runFontCommand` | — |
| `lib/routes/upload.js` | `registerUploadRoutes(webServer, c)` | 3 | `disposers` `base` `tokenFor` `UPLOAD_EXT` `UPLOAD_MAX_BYTES` `CONTROL_JSON_MAX_BYTES` `ensureUploadDir` `readUploadMeta` `metaEntry` `setUploadMeta` `removeUploadMeta` `resolveUploadFile` `setUploadDir` `normalizeUserDir` `armBodyIdleTimeout` `lingerClose` | — |
| `lib/routes/we-assets.js` | `registerWeAssetsRoutes(webServer, c)` | 2 | `disposers` `base` `serveFile` `CONTROL_JSON_MAX_BYTES` `normalizeUserDir` `setWeAssetsDir` `listWeAssetNames` `weAssetsAvailable` `WE_ASSETS_SOURCE_ID` `getWeAssetsDir` | — |

