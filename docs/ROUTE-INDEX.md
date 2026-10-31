# 宿主路由索引（自动生成，勿手改）

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
> 这类源文件路径误算（提及 ≠ 有断言；零提及 = 没有守卫安全网）。

共 **48** 条路由。

| # | 路径 | 来源 | 形态 | 依赖（闭包状态 / `c` 字段） | 守卫提及 |
|---|---|---|---|---|---|
| 1 | `/client-diag` | lib/routes/diag.js:85 | 箭头 | disposers appendDiagLine notice base | 5 |
| 2 | `/diag` | lib/routes/diag.js:149 | 箭头 | disposers | 13 |
| 3 | `/diag` | lib/routes/diag.js:150 | 箭头 | disposers base | 13 |
| 4 | `/diag-log` | lib/routes/diag.js:151 | 箭头 | disposers log base componentsProbe | 3 |
| 5 | `/glass-presets` | lib/routes/presets.js:502 | async 箭头 | disposers base | 1 |
| 6 | `/settings` | lib/routes/settings.js:158 | 箭头 | disposers base ctx mediaOriginApi readSettings isBetterSidebarLoaded …(+3) | 21 |
| 7 | `/cache-dir` | lib/routes/cache-dir.js:47 | 箭头 | disposers base CONTROL_JSON_MAX_BYTES normalizeUserDir cacheBaseDir setCacheDir …(+1) | 1 |
| 8 | `/cache-dir/browse` | lib/routes/cache-dir.js:115 | 箭头 | disposers base normalizeUserDir | 1 |
| 9 | `/rope-art` | lib/routes/rope-art.js:35 | 箭头 | disposers base serveFile | 4 |
| 10 | `/star-count` | packages/about-notice/lib/routes/github-stars.js:109 | async 箭头 | disposers base repoSlug log http | 2 |
| 11 | `/about-qr` | packages/about-notice/lib/routes/about-qr.js:69 | 箭头 | disposers base aboutDir serveFile | 3 |
| 12 | `/fontsets` | packages/fonts/lib/routes/fontsets.js:255 | async 箭头 | disposers base readFontSetId | 4 |
| 13 | `/system-fonts` | packages/fonts/lib/routes/system-fonts.js:492 | async 箭头 | disposers base http | 3 |
| 14 | `/glass-row-state` | packages/glass/lib/routes/glass-row.js:23 | async 箭头 | disposers base http | **0** |
| 15 | `/mascot` | packages/mascot-avatar/lib/routes/mascot.js:50 | 箭头 | disposers base serveFile http mascotDir mascotPath …(+5) | 4 |
| 16 | `/avatar` | packages/mascot-avatar/lib/routes/avatar.js:54 | 箭头 | disposers base serveFile http avatarDir avatarPath …(+6) | 5 |
| 17 | `/media-status` | packages/media-bridge/lib/routes/now-playing.js:87 | 箭头 | disposers base | 2 |
| 18 | `/audio-spectrum` | packages/media-bridge/lib/routes/now-playing.js:97 | 箭头 | disposers base | 2 |
| 19 | `/now-playing` | packages/media-bridge/lib/routes/now-playing.js:116 | 箭头 | disposers base | 4 |
| 20 | `/now-playing/artwork` | packages/media-bridge/lib/routes/now-playing.js:130 | 箭头 | disposers base serveFile | 2 |
| 21 | `/media-control` | packages/media-bridge/lib/routes/now-playing.js:148 | 箭头 | disposers base CONTROL_JSON_MAX_BYTES http | 3 |
| 22 | `/api/local-assets` | packages/media-bridge/lib/routes/we-assets.js:67 | async 箭头 | disposers serveFile listWeAssetNames weAssetsAvailable WE_ASSETS_SOURCE_ID getWeAssetsDir …(+1) | 2 |
| 23 | `/we-assets-dir` | packages/media-bridge/lib/routes/we-assets.js:115 | 箭头 | disposers base CONTROL_JSON_MAX_BYTES normalizeUserDir setWeAssetsDir listWeAssetNames …(+3) | 3 |
| 24 | `/inventory` | packages/media-bridge/lib/routes/inventory.js:104 | async 箭头 | disposers base mediaOriginApi buildInventory componentsProbe | 29 |
| 25 | `/slides` | packages/media-bridge/lib/routes/slides.js:44 | 箭头 | disposers base mediaMap tokenFor listImages http | 5 |
| 26 | `/media-info` | packages/media-bridge/lib/routes/media-derived.js:61 | 箭头 | disposers base mediaMap log getMediaInfo faststartVariant …(+2) | 10 |
| 27 | `/transcode-progress` | packages/media-bridge/lib/routes/media-derived.js:104 | 箭头 | disposers base mediaMap transcodeJobs clampNum | 2 |
| 28 | `/transcoded` | packages/media-bridge/lib/routes/media-derived.js:157 | 箭头 | disposers base mediaMap serveFile transcodeToFps registerTranscodeWaiter …(+1) | 1 |
| 29 | `/video-preview` | packages/media-bridge/lib/routes/media-derived.js:216 | 箭头 | disposers base mediaMap serveFile generateVideoPreview | 2 |
| 30 | `/media` | packages/media-bridge/lib/routes/media-bytes.js:39 | 箭头 | disposers base serveFile serveLayout mediaMap log …(+2) | 23 |
| 31 | `/preview` | packages/media-bridge/lib/routes/media-bytes.js:39 | 箭头 | disposers base serveFile serveLayout mediaMap log …(+2) | 12 |
| 32 | `/scene-frame` | packages/media-bridge/lib/routes/scene-frame.js:81 | 箭头 | disposers base mediaMap trackStream customFramePath customIdFromAbs …(+4) | 14 |
| 33 | `/scene-frame-cache` | packages/media-bridge/lib/routes/scene-frame.js:167 | 箭头 | disposers base mediaMap GPU_FRAME_AREA_TOL GPU_FRAME_MAX_BYTES GPU_WRITE_INFLIGHT …(+8) | 5 |
| 34 | `/custom-frame` | packages/media-bridge/lib/routes/scene-frame.js:271 | 箭头 | disposers base serveFile CUSTOM_FRAME_EXT CUSTOM_FRAME_MAX_BYTES armBodyIdleTimeout …(+4) | 3 |
| 35 | `/scene-live` | packages/media-bridge/lib/routes/scene-serve.js:87 | 箭头 | disposers base WEBWALLGL_DIR webwallglPkgDir appendDiagLine traceRequests …(+3) | 11 |
| 36 | `/scene-files` | packages/media-bridge/lib/routes/scene-serve.js:156 | 箭头 | disposers base handleSceneFiles | 5 |
| 37 | `/media-origin` | packages/media-bridge/lib/routes/scene-serve.js:164 | 箭头 | disposers base mediaOriginInfo | 2 |
| 38 | `/scene-payload-progress` | packages/media-bridge/lib/routes/scene-serve.js:184 | 箭头 | disposers base payloadProgress | 1 |
| 39 | `/props` | packages/media-bridge/lib/routes/props.js:46 | 箭头 | disposers base mediaMap userPropsFor parseUserPropDefs entryDirPrefix …(+2) | 9 |
| 40 | `/live-frame` | packages/media-bridge/lib/routes/live-frame.js:44 | 箭头 | disposers base mediaMap serveFile traceRequests liveFrameFile …(+3) | 3 |
| 41 | `/scene-video` | packages/media-bridge/lib/routes/scene-media.js:57 | 箭头 | disposers base mediaMap serveFile ensureFrameCacheDir sceneVideoProbeKey …(+6) | 3 |
| 42 | `/scene-audio` | packages/media-bridge/lib/routes/scene-media.js:141 | 箭头 | disposers base mediaMap serveFile ensureSceneAudio | 4 |
| 43 | `/upload` | packages/media-bridge/lib/routes/upload.js:73 | 箭头 | disposers base tokenFor UPLOAD_EXT UPLOAD_MAX_BYTES ensureUploadDir …(+7) | 6 |
| 44 | `/remove` | packages/media-bridge/lib/routes/upload.js:223 | 箭头 | disposers base CONTROL_JSON_MAX_BYTES ensureUploadDir removeUploadMeta resolveUploadFile …(+2) | 1 |
| 45 | `/upload-dir` | packages/media-bridge/lib/routes/upload.js:280 | 箭头 | disposers base CONTROL_JSON_MAX_BYTES setUploadDir normalizeUserDir armBodyIdleTimeout …(+1) | 3 |
| 46 | `/occlusion` | packages/media-bridge/lib/routes/occlusion.js:52 | async 箭头 | disposers base hub http | 4 |
| 47 | `/pet-link/official` | packages/pet-link/lib/routes/official-pet.js:49 | async 箭头 | disposers http | 5 |
| 48 | `/pet-link/official/assets/` | packages/pet-link/lib/routes/official-pet.js:83 | 箭头 | disposers http | **0** |

**零提及（暂无守卫覆盖，建议补）**：`/glass-row-state`、`/pet-link/official/assets/`

**被最多路由引用的闭包状态（context 字段优先级，仅 `lib/index.js` 内的路由）**：



**路由模块的 context 契约**（声明了却没用到的字段单独标出 —— 那是死声明）：

| 模块 | 入口 | 路由数 | `c` 字段 | 死声明 |
|---|---|---|---|---|
| `lib/routes/cache-dir.js` | `registerCacheDirRoutes(webServer, c)` | 2 | `disposers` `base` `CONTROL_JSON_MAX_BYTES` `normalizeUserDir` `cacheBaseDir` `setCacheDir` `armBodyIdleTimeout` | — |
| `lib/routes/diag.js` | `registerDiagRoutes(webServer, c)` | 4 | `disposers` `appendDiagLine` `log` `notice` `base` `onHandleDiag` `componentsProbe` | — |
| `lib/routes/presets.js` | `registerGlassPresetsRoutes(webServer, c)` | 1 | `disposers` `base` | — |
| `lib/routes/rope-art.js` | `registerRopeArtRoutes(webServer, c)` | 1 | `disposers` `base` `serveFile` | — |
| `lib/routes/settings.js` | `registerSettingsRoutes(webServer, c)` | 1 | `disposers` `base` `ctx` `mediaOriginApi` `readSettings` `isBetterSidebarLoaded` `sanitizeSettings` `withLegacyFontValues` `mergeSettings` `armBodyIdleTimeout` `lingerClose` | — |
| `packages/about-notice/lib/routes/about-qr.js` | `registerAboutQrRoutes(webServer, c)` | 1 | `disposers` `base` `aboutDir` `serveFile` | — |
| `packages/about-notice/lib/routes/github-stars.js` | `registerGithubStarsRoutes(webServer, c)` | 1 | `disposers` `base` `repoSlug` `cachePath` `log` `http` `fetchJson` | — |
| `packages/fonts/lib/routes/fontsets.js` | `registerFontsetsRoutes(webServer, c)` | 1 | `disposers` `base` `readFontSetId` | — |
| `packages/fonts/lib/routes/system-fonts.js` | `registerSystemFontsRoutes(webServer, c)` | 1 | `disposers` `base` `cachePath` `log` `schema` `http` `platform` `home` `fontDirs` `runFontCommand` | — |
| `packages/glass/lib/routes/glass-row.js` | `registerGlassRowRoutes(webServer, c)` | 1 | `disposers` `base` `http` | — |
| `packages/mascot-avatar/lib/routes/avatar.js` | `registerAvatarRoutes(webServer, c)` | 1 | `disposers` `base` `serveFile` `http` `avatarDir` `avatarPath` `AVATAR_SIDES` `AVATAR_EXT` `AVATAR_MAX_BYTES` `atomicWriteFileP` `armBodyIdleTimeout` `lingerClose` | — |
| `packages/mascot-avatar/lib/routes/mascot.js` | `registerMascotRoutes(webServer, c)` | 1 | `disposers` `base` `serveFile` `http` `mascotDir` `mascotPath` `MASCOT_EXT` `MASCOT_MAX_BYTES` `atomicWriteFileP` `armBodyIdleTimeout` `lingerClose` | — |
| `packages/media-bridge/lib/routes/inventory.js` | `registerInventoryRoutes(webServer, c)` | 1 | `disposers` `base` `mediaOriginApi` `buildInventory` `componentsProbe` | — |
| `packages/media-bridge/lib/routes/live-frame.js` | `registerLiveFrameRoutes(webServer, c)` | 1 | `disposers` `base` `mediaMap` `serveFile` `traceRequests` `liveFrameFile` `atomicWriteFileSync` `lingerClose` `http` | — |
| `packages/media-bridge/lib/routes/media-bytes.js` | `registerMediaBytesRoutes(webServer, c)` | 2 | `disposers` `base` `serveFile` `serveLayout` `mediaMap` `log` `pinnedFaststartVariant` `ensureImagePreview` | — |
| `packages/media-bridge/lib/routes/media-derived.js` | `registerMediaDerivedRoutes(webServer, c)` | 4 | `disposers` `base` `mediaMap` `serveFile` `log` `getMediaInfo` `faststartVariant` `transcodeJobs` `transcodeToFps` `registerTranscodeWaiter` `generateVideoPreview` `transcodeCached` `clampNum` | — |
| `packages/media-bridge/lib/routes/now-playing.js` | `registerNowPlayingRoutes(webServer, c)` | 5 | `disposers` `base` `appendDiagLine` `configPath` `cacheBaseDir` `readConfig` `serveFile` `CONTROL_JSON_MAX_BYTES` `log` `http` | — |
| `packages/media-bridge/lib/routes/occlusion.js` | `registerOcclusionRoutes(webServer, c)` | 1 | `disposers` `base` `hub` `log` `diag` `http` | — |
| `packages/media-bridge/lib/routes/props.js` | `registerPropsRoutes(webServer, c)` | 1 | `disposers` `base` `mediaMap` `userPropsFor` `parseUserPropDefs` `entryDirPrefix` `filterKnownOverrides` `http` | — |
| `packages/media-bridge/lib/routes/scene-frame.js` | `registerSceneFrameRoutes(webServer, c)` | 3 | `disposers` `base` `mediaMap` `trackStream` `serveFile` `GPU_FRAME_AREA_TOL` `GPU_FRAME_MAX_BYTES` `GPU_WRITE_INFLIGHT` `CUSTOM_FRAME_EXT` `CUSTOM_FRAME_MAX_BYTES` `armBodyIdleTimeout` `atomicWriteFileP` `customFrameDir` `customFramePath` `customIdFromAbs` `gpuFrameFileFor` `lingerClose` `looksLikePng` `pngDimsOfBuf` `pngSizeOf` `sceneFrameSlot` `http` | — |
| `packages/media-bridge/lib/routes/scene-media.js` | `registerSceneMediaRoutes(webServer, c)` | 2 | `disposers` `base` `mediaMap` `serveFile` `ensureFrameCacheDir` `sceneVideoProbeKey` `sceneVideoProbeSet` `atomicWriteFileP` `ensureSceneAudio` `SCENE_VIDEO_INFLIGHT` `extractSceneVideoFromDir` `extractSceneVideoFromPkgFile` `cacheKeyFor` | — |
| `packages/media-bridge/lib/routes/scene-serve.js` | `registerSceneServeRoutes(webServer, c)` | 4 | `disposers` `base` `WEBWALLGL_DIR` `webwallglPkgDir` `appendDiagLine` `traceRequests` `serveFile` `handleSceneFiles` `mediaOriginInfo` `payloadProgress` `log` | — |
| `packages/media-bridge/lib/routes/slides.js` | `registerSlidesRoutes(webServer, c)` | 1 | `disposers` `base` `mediaMap` `tokenFor` `listImages` `http` | — |
| `packages/media-bridge/lib/routes/upload.js` | `registerUploadRoutes(webServer, c)` | 3 | `disposers` `base` `tokenFor` `UPLOAD_EXT` `UPLOAD_MAX_BYTES` `CONTROL_JSON_MAX_BYTES` `ensureUploadDir` `readUploadMeta` `metaEntry` `setUploadMeta` `removeUploadMeta` `resolveUploadFile` `setUploadDir` `normalizeUserDir` `armBodyIdleTimeout` `lingerClose` `http` | — |
| `packages/media-bridge/lib/routes/we-assets.js` | `registerWeAssetsRoutes(webServer, c)` | 2 | `disposers` `base` `serveFile` `CONTROL_JSON_MAX_BYTES` `normalizeUserDir` `setWeAssetsDir` `listWeAssetNames` `weAssetsAvailable` `WE_ASSETS_SOURCE_ID` `getWeAssetsDir` `http` | — |
| `packages/pet-link/lib/routes/official-pet.js` | `registerOfficialPetRoutes(webServer, c)` | 2 | `disposers` `base` `http` | — |

