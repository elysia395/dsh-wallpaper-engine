/**
 * dsh-wallpaper-engine — host half.
 *
 * A Cordis plugin (loaded as an out-of-tree bundle row, see cordis.patch.yml)
 * that bridges the local Wallpaper Engine install into the DSH web GUI.
 *
 * Responsibilities, all through the DSH webserver service (`ctx.webServer`):
 *   1. Locate the Wallpaper Engine install (Steam app 431960) by reading
 *      Steam's libraryfolders.vdf, so non-default Steam drives work.
 *   2. Enumerate installed wallpapers of the two *portable* kinds:
 *        - type "video"  → the project's `.mp4` (or other media) file
 *        - type "web"    → the project's HTML entry
 *      Scene (native 3D) wallpapers are rendered live by the bundled WebWallGL
 *      engine (lib/webwallgl/ + /scene-live); Application wallpapers are listed
 *      too, but only their preview image is served (they would need the host to
 *      launch a third-party executable, which this plugin does not do).
 *   3. Serve a JSON inventory and the media/preview bytes over loopback HTTP
 *      routes the browser half fetches directly (same-origin):
 *        GET /wallpaper-engine/inventory          → JSON inventory (installDir, uploadDir,
 *                                                   cacheDir, weAssetsDir, weAssetsAvailable,
 *                                                   sceneMediaBase, total, portableCount,
 *                                                   wallpapers[…], playlists[…])
 *        GET /wallpaper-engine/media/<token>      → video / html (Range supported)
 *        GET /wallpaper-engine/preview/<token>    → preview image
 *
 * The plugin contributes no model-visible tool and no prompt text. Every route
 * is registered through the plugin fiber so it unwinds on unload. `webServer`
 * is a **hard dependency** (`inject = ['webServer']`; the rationale is on that
 * declaration below): a profile without an HTTP server does not load this
 * bundle. `ctx.webServer` is still read defensively, since a route table
 * cannot be built without it. The generated route table — the authoritative
 * list, replacing the three examples above — is `docs/ROUTE-INDEX.md`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
// 壁纸媒体源（独立 loopback 监听）——见 ensureMediaOrigin 的说明。

// Scene wallpaper embedded-video extraction (ported from dsh-web-ui's
// skin-center we-* modules). A separate module so the PKG/TEX container
// primitives (lib/pkg-read.js) stay untouched — this one only probes for an
// embedded MP4.
// WE 用户属性（project.json general.properties）→ 面板描述 / 覆盖值合并。
// 语义细节见该文件头：order 浮点、combo 保类型、逐键本地化、condition 只影响 UI。
// 设置白名单/校验的**唯一真源**（客户端侧由构建期内联同一文件）。
import { sanitizeFromSchema } from './settings-schema.js';
// 收 body 的**唯一缓冲实现**（累加 + 字节计闸 + 一次解码）—— 见 lib/http-body.js。
// 小控制面 JSON 体的统一上限也住在那个叶子模块（单一真源：媒体桥组件也要用它，
// 组件入口不能 import 门面 ⇒ 常量必须有门面之外的落点）。
import { CONTROL_JSON_MAX_BYTES } from './http-body.js';
// 字节出站套件（载荷账本 / 静态发送 / /scene-files）—— 见 lib/serve.js 文件头。
import { payloadProgress } from './serve.js';
// 数据目录内核的模块级路径函数（`pluginDataDir`）**不再投影到门面作用域**：门面正文零引用
// （消费方一律经 `kernel/config.js` 的注入面；内核键面那条由 `test/verify-mp4-vfs.mjs` 直取）。
// （`configPath` 随媒体桥路由族出户 —— 现在只有那条族用它，它从叶子模块直取。）
// ── 宿主内核（P1a 内核化）────────────────────────────────────────────────────
// 门面里的套件实例（发现 / 配置 / 数据目录 / 上传库 / 转码 / 帧缓存 / 媒体目录 / 诊断追踪 /
// http 生命周期 …）全部搬进 `lib/kernel/host-kernel.js`，在**模块加载期**建成一次（族别清单以
// 该文件的构造点为准；加载期时点由 `test/verify-adapter.mjs` 钉住）。
// 契约（稳定面 / 内部面划分 / 访问器纪律）与时点纪律见该文件头。
// ── 宿主引导（P2-2b 拆环）────────────────────────────────────────────────────
// `hostKernel` 单例 / `BASE` / `PLUGIN_NAME` / `repoSlugFromPkg` 四个声明已搬进**叶子模块**
// （P-F 三格全部出户后本模块只 import `hostKernel` / `BASE` / `runComponent` / `handOffTeardown` /
// `componentProbe` 五个绑定：`PLUGIN_NAME` 与 `repoSlugFromPkg` 都不再进本模块作用域 —— 前者仍只由
// `lib/host-boot.js` 声明、子包启动叶子消费；后者经 `boot:` 源型从服务面给到组件行。）
// `lib/host-boot.js` 不 import 本模块/组件/路由：组件入口 deps 经 subpackage-boot 键表取 ⇒「本模块 ⇄ 组件入口」的 import 环被真正拆掉（P2-1b 只消除了门面求值期的
// 读边，环本身当时还在）。`hostKernel` 仍在**模块加载期**创建（即 host-boot 的求值期，
// 时点与搬家前同义）⇒ `test/verify-adapter.mjs` 的「env 必须先于门面 import 设好」加载期契约
// 不变；内核契约（稳定面 / 内部面划分 / 访问器纪律）见 `lib/kernel/host-kernel.js` 文件头。
import { hostKernel, BASE, runComponent, handOffTeardown,
  componentProbe as bootComponentProbe } from './host-boot.js';
// 子包启动自检的叶子（P-A）：子包 ⇄ patch 行发现 / 行名解析 / 键取用 / teardown 交接
// 都在这里，主包与子包共用同一份实现（§5.1 ② 通道的**唯一受控叶子**）。
import { assertSubpackagesResolvable, assertSubpackagesResolvableInHost, httpView, provideSubpackageHost, subpackageKeys, subpackageSpecifiers } from './subpackage-boot.js';
// 会话段（版本戳 / 日志与提示 / token 表 / faststart / 启动清扫 / 字节出站 / 媒体源 /
// 清单构建 ＋ teardown）已搬进 lib/kernel/host-session.js —— 工厂契约见该文件头。
// `extOf` 反向传给会话段（清单载荷的容器后缀判据 ⇒ 见该文件头）。
import { createHostSession } from './kernel/host-session.js';
export { extOf };
import { registerInventoryRoutes } from './routes/inventory.js';
import { registerDiagRoutes } from './routes/diag.js';
// 遮挡消息桥族（上游新增域模块）：hub 处理 x11 遮挡探针，路由对外暴露状态/控制面。
import { createOcclusionHub } from './occlusion/index.js';
import { registerOcclusionRoutes } from './routes/occlusion.js';
import { registerSceneFrameRoutes } from './routes/scene-frame.js';
import { registerMediaDerivedRoutes } from './routes/media-derived.js';
import { registerMediaBytesRoutes } from './routes/media-bytes.js';
import { registerWeAssetsRoutes } from './routes/we-assets.js';
import { registerSceneMediaRoutes } from './routes/scene-media.js';
import { registerSceneServeRoutes } from './routes/scene-serve.js';
import { registerUploadRoutes } from './routes/upload.js';
import { registerGlassPresetsRoutes } from './routes/presets.js';
import { registerPropsRoutes } from './routes/props.js';
import { registerLiveFrameRoutes } from './routes/live-frame.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerCacheDirRoutes } from './routes/cache-dir.js';
// C8′/C6 出户的组件行（P2-1 / P2-2）：组件入口**静态** import（不是动态）—— `test/verify-reachability.mjs`
// 只从 ENTRY 沿 import 边走，动态加载的组件入口会被判定为不可达，棘轮当场变红。
// 组件名 → 实现表的登记在 `applyComponent` **函数体内**（P2-1b 起；模块级常量会让门面求值期
// 读到组件入口的导出，宿主装载顺序下踩 TDZ），`applyComponent` 与组件入口复用同一份实现。
// ⚠️ **P-F（2026-10-16）**：`about-notice` / `mascot-avatar` / `media-bridge` 已全部出户到
// `packages/<组件>/`，这里改成它们**真实的包名**静态 import。这是**宿主装载面**（门面按组件名加载
// 实现），**不是**跨包通道 —— 跨包通道只有 `ctx.wallpaperEngineHost`（ADR-0014 S5.1/S5.2）；
// 该边随 §12 的发布形态（主包精确依赖子包）成立，开发期由根 `devDependencies` 的
// `file:packages/<组件>` 提供。
import { applyImpl as applyAboutNoticeImpl } from 'dsh-plugin-wallpaper-engine-about-notice';
import { applyImpl as applyMascotAvatarImpl } from 'dsh-plugin-wallpaper-engine-mascot-avatar';
// 第三件组件（媒体桥入包）：路由族、后端实现与 macOS 音频 tap 源码随包走 ⇒ 门面只剩分发点。
import { applyImpl as applyMediaBridgeImpl } from 'dsh-plugin-wallpaper-engine-media-bridge';
// 组件行**浏览器可见面**的声明单一真源（ADR-0013 D3②）：宿主侧持有"组件名 → 浏览器渲染落点"，
// 浏览器侧只持有 gate（`COMPONENT_GATE` 指向的那一个判定函数）；对账在
// `test/verify-component-visibility.mjs`。这里**再导出**一次，使它落在 import 图上 ——
// 可达性判据（`test/verify-reachability.mjs` 的棘轮 = 零不可达文件）跟随 `export … from` 边；
// 再导出不产生 import 绑定 ⇒ 不撞 `test/verify-module-layout.mjs` 的"死绑定"判据。
// 该文件零 import（纯数据 + 契约描述）⇒ 不可能与门面 / 组件入口成环。
export { COMPONENT_VISIBILITY, COMPONENT_GATE } from './component-visibility.js';
// `BASE` 字面量的声明在 lib/host-boot.js；本模块上方已静态 import 同名绑定，
// 下面全部调用点一字未动。

// ── 宿主内核实例 ────────────────────────────────────────────────────────────
// 套件实例（原名 → 内核内的私有句柄）住在 lib/kernel/host-kernel.js：
//   WE 发现 discovery · 配置 configKit · 数据目录 dataDir · 场景探测 sceneProbeKit
//   MP4 探测 mp4ProbeKit · 转码 transcodeKit · 上传库 uploadStoreKit · 随包资源 weAssetsKit
//   shim/seed shimSeedKit · 帧缓存 frameStoreKit · 视频预览 videoPreviewKit · 媒体目录 mediaDirsKit
//   诊断追踪 diagTraceKit · 缓存根 cacheDirKit · http 生命周期 httpLifecycleKit。
// 只被族间互调、门面不用的符号（atomicTmpPath / enqueueConfigWrite / readProjectP /
// resolveFfmpeg / resolveSceneMainFileP / SCAN_CHUNK / spawnFfmpeg / videoPreviewCacheDir /
// writeConfig）留在内核内部，不出现在门面里。
//
// 内核实例本身由 lib/host-boot.js 在模块加载期创建并从那里 import。下面把内核返回的
// 族内符号投影回模块作用域：名字与全部调用点逐字未变 —— `apply()` 零改动。

// 同名解构：把内核返回的键**按门面正文的真实引用面**投影回模块作用域。
// 口径是可复算的：把本块整段抠掉后，块外（**含注释文本**）用词边界搜不到的名字就是死绑定 ——
// 现存绑定必须全部在门面正文里真被引用。
// 未列入的（transcodeKit / ABOUT_DIR / AVATAR_EXT / AVATAR_MAX_BYTES / MASCOT_EXT /
// MASCOT_MAX_BYTES / setFontSetId / commitFontSetMigration / FONTSET_BUILTIN_DIR）由内核、
// 路由族或组件入口直接消费，不经门面绑定。契约见 lib/kernel/host-kernel.js 文件头。
const {
  cacheBaseDir, atomicWriteFileSync, atomicWriteFileP, readSettings, fontSetsDir,
  glassPresetsDir, readFontSetId, mergeSettings,
  withLegacyFontValues, normalizeUserDir, ensureFrameCacheDir, ensureSceneAudio,
  sceneVideoProbeKey, sceneVideoProbeSet, getMediaInfo, ensureDirOnce, customFrameDir, avatarDir,
  mascotDir, ensureUploadDir, transcodeToFps, registerTranscodeWaiter, transcodeCachePathFor,
  transcodeJobs, readUploadMeta, metaEntry, setUploadMeta, removeUploadMeta, resolveUploadFile,
  setUploadDir, UPLOAD_MAX_BYTES, WEBWALLGL_DIR, WEBWALLGL_PKG_DIR, GLASS_PRESET_BUILTIN_DIR,
  WE_ASSETS_SOURCE_ID, weAssetsAvailable, getWeAssetsDir, setWeAssetsDir, listWeAssetNames,
  userPropsFor, isBetterSidebarLoaded, GPU_FRAME_MAX_BYTES, GPU_FRAME_AREA_TOL, GPU_WRITE_INFLIGHT, gpuFrameFileFor,
  looksLikePng, pngSizeOf, pngDimsOfBuf, sceneFrameSlot, generateVideoPreview, UPLOAD_EXT, CUSTOM_FRAME_EXT,
  CUSTOM_FRAME_MAX_BYTES, AVATAR_SIDES, mascotPath, avatarPath, liveFrameFile, customIdFromAbs,
  customFramePath, appendDiagLine, traceRequests, setCacheDir, armBodyIdleTimeout, lingerClose,
} = hostKernel;

/**
 * 小控制面 JSON 请求体的**统一上限**（64 KiB）。
 *
 * 收 body 的路由**必须**有上限：逐块 `body += chunk` 而不比较长度，会让异常大的请求把宿主堆
 * 无界撑大（OOM / 进程死亡）。默认只听 loopback，但 webserver 允许 `host: 0.0.0.0`。
 *
 * 上限按**收到的字节数**计（`size += chunk.length`，`chunk` 是 Buffer），解码只在收完之后做
 * **一次**（`Buffer.concat(chunks).toString('utf8')`）：这两件事是配对的 —— 逐块 `toString()`
 * 会把落在两个 TCP 分片之间的多字节码点切成 U+FFFD，而用户可见字符串（壁纸 id / 字体名 /
 * 字体族）被写坏了客户端永远不知道。判据与不变量见 `lib/routes/upload.js` 文件头。
 *
 * 守卫：`test/verify-body-caps.mjs` 从磁盘枚举**每一个** `req.on('data')` 站点，缺上限即红 ——
 * 新增路由不会因为"忘了抄"而静默漏闸。
 */
// ⚠️ `CONTROL_JSON_MAX_BYTES` 的定义已搬进 `lib/http-body.js`（单一真源：媒体桥组件入口
// 也要用它，而组件不许 import 门面 ⇒ 常量不能只住在门面）。值一字未变，本文件改为 import。

// 容器后缀判据的唯一真源在叶子模块（上游把它做成扫描族工厂的闭包导出）——
// 这里 import + 再导出，保持门面对外原有的 `extOf` 面不变。
import { extOf } from './fs-paths.js';

// `repoSlugFromPkg()`（从 package.json 现读 owner/repo，正文与 JSDoc 逐字未变）的声明在
// lib/host-boot.js（P2-2b 搬走）；本模块上方已静态 import 同名绑定。

// 设置规范化入口。白名单/范围/默认值全部来自 lib/settings-schema.js（唯一真源）——
// 在这里另写一份镜像就要与客户端各写一遍，漏键即静默丢弃。
// 宿主侧不收 CLIENT_ONLY 的键（设备本地记忆），非对象输入返回 null 由调用方判空。
function sanitizeSettings(raw) {
  return sanitizeFromSchema(raw, 'host');
}

/**
 * Hard-depend on `webServer` so the Loader waits for the HTTP server to mount
 * before running this plugin. A ctx.get() at mount time is racy: rows mount
 * concurrently and the webserver may not exist yet, which would silently skip
 * route registration and let the SPA fallback answer every request. This bundle
 * is web-only (its dsh.client declares platform "web"), so a hard injection is
 * correct; it is simply not added to headless/TUI profiles.
 */
export const inject = ['webServer'];

export function apply(ctx) {
  const webServer = ctx.webServer;
  if (!webServer || typeof webServer.register !== 'function') {
    return () => {}; // defensive: never expected in practice
  }

  // 0a. 跨包服务面（BUNDLE-SPLIT §5.1 ①，P-A 的 B 方案）─────────────────────────
  // 子包宿主半边 `export const inject = ['wallpaperEngineHost']`，靠这一个服务拿到
  // 冻结键集 / 拆卸交接 / 纯符号面；`provide` 由 cordis 记在**主包自己的 fiber** 上，
  // 主包一卸服务即撤销 ⇒ 子包 fiber 随之 park（D-13 B「关主包 = 关整族」的物理基础）。
  // 判据：test/verify-subpackage-purity.mjs（子包半边零主包说明符 + inject 名逐字对账）。
  provideSubpackageHost(ctx);

  // 0b. 子包启动自检（BUNDLE-SPLIT §7.6①，P-A）──────────────────────────────────
  // 为什么要有这一段：宿主对**行级**失败是静默的（§4.1 I5 —— Loader 只把那一行记成
  // failed，主包照常起来），而"子包行解析不到"的后果恰好是浏览器半边**静默消失**：
  // 用户的界面少一块，终端里却没有指向原因的报错。所以这里按 patch 里**净新增的子包行**
  // 自己 resolve 一遍，解析不到就抛（大声失败），错误消息带包名与行 id。
  // **两条腿缺一不可**（2026-10-16 真机事故：三条组件行 `failed to import`，主包却报通过）：
  //   ① 仓库腿 —— 解析根 = 本仓 `node_modules`（开发期 `file:` 自链、发布期主包自己的依赖树），
  //      发现的是"patch 行与主包 manifest 脱节"；
  //   ② 宿主腿 —— 解析根 = **每个会装载本主包的 profile** 的 `cordis.yml` 旁（§8.1 spike：
  //      本版 `boot()` 只传 4 实参 ⇒ `bareModuleBaseUrl` 恒 undefined ⇒ 宿主恒按裸包名从
  //      profile 根解析行名），发现的是①结构性看不见的"仓库里在、profile 侧缺链接"。
  // 判据：test/verify-subpackage-boot.mjs（硬档；它同时钉住"静默实现必须判红"与两条腿的顺序）。
  const rootManifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const subpackageRows = subpackageSpecifiers(
    readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8'), rootManifest.name);
  assertSubpackagesResolvable(subpackageRows, (name) => {
    try { return createRequire(import.meta.url).resolve(name); } catch { return null; }
  });
  assertSubpackagesResolvableInHost(subpackageRows, { mainName: rootManifest.name });

  // 会话段（版本戳 / 日志与提示 / token 表 / faststart / 启动清扫 / 字节出站 / 媒体源 /
  // 清单构建 ＋ teardown）由 lib/kernel/host-session.js 一次建好；这里只解构出注册要用的
  // 名字（顶格声明 ⇒ test/tools/host-route-index.mjs 的 `applyScope` 仍能把它们列进依赖）。
  const { log, notice, mediaMap, tokenFor, serveFile, serveLayout, handleSceneFiles,
    faststartVariant, pinnedFaststartVariant, trackStream, disposers, mediaOriginApi,
    buildInventory, SCENE_VIDEO_INFLIGHT, dispose } = createHostSession(hostKernel, { base: BASE, ctx });

  // R-1（BUNDLE-SPLIT §13.1）：teardown 的交接**必须先于任何一次注册**。
  // 为什么不能像原来那样留在本函数最后一行：`apply` 中间任何一处抛错（最现实的是上一次装载
  // 残留导致的 `webserver: duplicate … route`）都会让最后一行**永不执行** ⇒ `ctx.effect` 从未
  // 登记 ⇒ fiber 卸载时 `dispose()` 不跑 ⇒ 前面各族**已经注册成功**的路由留在宿主路由表里
  // ⇒ 下一次启用继续撞重复路由，插件直到进程重启都起不来（半装载残留，正是 R-1 要消灭的形态）。
  // 为什么「先登记」就够、不必在这里再包 `try/catch`：cordis 的 `Fiber._reload()` 捕获 `apply`
  // 抛出的错后把 epoch 打回 `INACTIVE`，随即转入 `_unload()`，而那条路径 `clear()` 并逐条执行
  // `_disposables` ⇒ **抛错前登记的 effect 一定被回滚**（`handOffTeardown()` 已包 `once`，
  // 将来两条通道若同时被收也只真跑一次 —— 见 lib/host-boot.js 的 JSDoc）。
  // 为什么位置选在 `createHostSession()` **之后**：注册顺序仍排在会话自己的 effect 之后 ⇒
  // 卸载时反序执行的**顺序逐字不变**（本 teardown 仍最先跑）；成功路径的返回值仍是同一个
  // `once` 包装（函数末尾原样交回直调方）。
  // 判据 test/verify-bundle-rows.mjs ⑧c（apply 实测向 `ctx.effect` 交 1 个 teardown）。
  const teardown = handOffTeardown(ctx, dispose);

  // 1. Inventory JSON → lib/routes/inventory.js（路径/头/状态码/错误文案逐字未变）。
  //    `componentsProbe` 是**只读**行状态面（与 3c-6 的 /diag-log 同一个探针、同一批账）：
  //    浏览器半边按它在 `/inventory` 里的 `components` 字段决定"该组件的界面渲不渲染"
  //    （ADR-0013 D3 的状态面；形状与失效口径写在那个族的文件头）。
  registerInventoryRoutes(webServer, {
    disposers, base: BASE, mediaOriginApi, buildInventory, componentsProbe: componentProbe,
  });

  // 3./3a. 派生媒体族路由（源元信息 / 抽帧转码 + 进度 / 视频缩略图）→ lib/routes/media-derived.js。
  //        四条注册与它们的依赖都在那个文件里；这里只声明它的依赖。**调用点必须早于下面的
  //        /media 族**：`/media-info` 与 `/media` 同前缀，晚注册会被 prefix 匹配吞掉。
  registerMediaDerivedRoutes(webServer, {
    disposers, base: BASE, mediaMap, serveFile, log,
    getMediaInfo, faststartVariant, transcodeJobs,
    transcodeToFps, registerTranscodeWaiter, generateVideoPreview,
    // 只读回答"这个 (源, 上限) 的抽帧版在不在盘上"（`/media-info?fps=`）——
    // 客户端据此在**建层之前**就选抽帧版当 src，而不是先取原片再换源。
    // ⚠️ 它必须是纯读：任何转码都只能由 `/transcoded` 自己发起。
    transcodeCached: (abs, fps) => {
      const p = transcodeCachePathFor(abs, fps);
      return Boolean(p && existsSync(p));
    },
  });

  // 2/3. Media + preview（原始字节直出）→ lib/routes/media-bytes.js。
  //      两条注册（同一个循环，`seg ∈ {media, preview}`）与它们的依赖都在那个文件里；
  //      字节出站套件与「流三层收尾」纪律仍见 lib/serve.js。
  registerMediaBytesRoutes(webServer, {
    disposers, base: BASE, serveFile, serveLayout, mediaMap, log, pinnedFaststartVariant,
  });

  // 3c-3b/3c-5. 场景帧服务族路由（实时抓帧缓存 / 自定义画面）→ lib/routes/scene-frame.js。
  //            三条注册与它们的依赖都在那个文件里；这里只声明它的依赖。
  registerSceneFrameRoutes(webServer, {
    disposers, base: BASE, mediaMap, trackStream, serveFile,
    // ⚠️ `GPU_FRAME_AREA_TOL` 必须在这里给到：路由的面积守卫算 `1 - GPU_FRAME_AREA_TOL`，
    // 少这一项会得到 **NaN** ⇒ 比较恒 false ⇒ 守卫**静默失效**（小帧覆盖大帧却回 200）。
    // 这是"消费面漏一个键"最难查的形态：不抛错、不判红，只是闸门不再工作。
    GPU_FRAME_MAX_BYTES, GPU_FRAME_AREA_TOL, GPU_WRITE_INFLIGHT,
    CUSTOM_FRAME_EXT, CUSTOM_FRAME_MAX_BYTES,
    armBodyIdleTimeout, atomicWriteFileP, customFrameDir, customFramePath, customIdFromAbs,
    gpuFrameFileFor, lingerClose, looksLikePng, pngSizeOf, pngDimsOfBuf, sceneFrameSlot,
  });

  // 3c-2/3c-3/3c-3b. 场景载荷服务族路由（live 渲染页 / 壁纸自有文件 / 媒体源诊断 +
  //                 载荷进度账本）→ lib/routes/scene-serve.js。四条注册与它们的依赖都在
  //                 那个文件里；媒体源服务本身（handleSceneFiles / ensureMediaOrigin）
  //                 留在原地 —— /inventory 也消费 ensureSceneMediaOrigin()。
  registerSceneServeRoutes(webServer, {
    // ⚠️ `WEBWALLGL_PKG_DIR` 必须在这里给到（与 GPU_FRAME_AREA_TOL 同一类坑：DEPS 声明了、
    // 门面也解构了，但**调用点漏传**）⇒ 得到 undefined ⇒ 引擎走"未安装"早退（404 + no-store），
    // 且 readWebShim 拿不到 bundle（注入整条跳过）。判据 test/verify-scene-live.mjs 覆盖到这两面。
    disposers, base: BASE, WEBWALLGL_DIR, WEBWALLGL_PKG_DIR, appendDiagLine, traceRequests, serveFile,
    handleSceneFiles, mediaOriginInfo: mediaOriginApi.mediaOriginInfo, payloadProgress, log,
  });

  // 3c-3. `/scene-files`（路径围栏 + shim/seed/focus-guard 注入）已随字节出站套件
  //       搬进 lib/serve.js 的工厂 `createServeKit`（调用点见本文件上方）。

  // 3c-0 / 3c-3a. 适配器形态观测 + 壁纸媒体源 → lib/media-origin.js
  //        （本文件上方构建的 `mediaOriginApi`；源地址/端口/形态访问器都在那里）。

  // 3c-3c. 壁纸属性（WE 用户属性，project.json `general.properties`）→ lib/routes/props.js。
  //        面板读当前生效值（默认值 ⊎ 用户覆盖）与候选文件；写入不在这里 ——
  //        覆盖值随设置一起 PUT（/settings），与其它设置共用同一套持久化与白名单校验。
  registerPropsRoutes(webServer, { disposers, base: BASE, mediaMap, userPropsFor });

  // 3c-4. 网页壁纸首帧缓存（`__wp.capture` 回填的 JPEG）→ lib/routes/live-frame.js。
  //       GET 按入口 mtime 校验新鲜度（壁纸更新即自动作废旧帧）；POST 收 4MB 内 JPEG。
  //       `bodyReader` 由该模块自己 import（不走 `c`，见 verify-body-caps）。
  registerLiveFrameRoutes(webServer, {
    disposers, base: BASE, mediaMap, serveFile, traceRequests,
    liveFrameFile, atomicWriteFileSync, lingerClose,
  });

  // 3c-5. 媒体状态族路由（媒体后端懒启动 + /media-status、/audio-spectrum、/now-playing、
  //       /now-playing/artwork、/media-control）**已出户**到独立子包
  //       `packages/media-bridge/`（patch 里 `id: wallpaper-engine-media-bridge`，
  //       第三件组件，P-F 批 1c）：注册点、后端实例与启动决策整族随实现搬走（实现体住
  //       `packages/media-bridge/lib/`），本文件只剩下面的组件分发点。裸行因此少了这一族的注册
  //       —— 条数以 `node test/tools/host-route-index.mjs` 现算（架构说明见下面 6c）。

  // 3c-6 / 3c-7. 诊断族路由（/client-diag、/diag、/diag-log）→ lib/routes/diag.js。
  //           注册顺序、共用处理器与两处兜底都在那个文件里；这里只声明它的依赖。
  // 出参 `onHandleDiag` 把诊断族的 `handleDiag` 交回来，武装 3c-3a 的 `mediaDiagHandler` ——
  // 场景壁纸的 mediaBase 指向媒体源之后，渲染页的告警必须在那里也落进**同一份**环形缓冲。
  // ⚠️ 保持这个**语句形态**（行首即函数名、不加以赋值前缀）：`test/tools/host-route-index.mjs`
  //    的调用点正则认的就是它，加了前缀本族会被判成"孤儿族模块"。
  // 契约面 { disposers, base, hub, log, diag } 与 lib/routes/occlusion.js 的 DEPS 逐键相等。
  // 3c-5b. 遮挡消息桥（上游新增域模块接线）：hub 起 x11 探针，路由暴露状态/控制。
  // ⚠️ 形态是**被判据钉住的**（test/verify-occlusion-hub.mjs 的 D3：调用点必须是
  // `registerOcclusionRoutes(webServer, {` 紧跟 `disposers, base: BASE, hub: occlusionHub, log: log.tag('occlusion'),`）
  // ⇒ 三个实参一律**内联**，不要引入中间变量（那会改变语句形态并判红）。
  const occlusionHub = createOcclusionHub({
    log: log.tag('occlusion'),
    diag: (obj) => appendDiagLine('occlusion', obj),
  });
  disposers.push(() => occlusionHub.dispose());
  occlusionHub.start().catch(() => { /* hub.start 不外抛；兜底防 unhandled */ });
  registerOcclusionRoutes(webServer, {
    disposers, base: BASE, hub: occlusionHub,
    log: log.tag('occlusion'),
    diag: (obj) => appendDiagLine('occlusion', obj),
  });

  registerDiagRoutes(webServer, {
    disposers, appendDiagLine, base: BASE, log, notice,
    onHandleDiag: mediaOriginApi.setDiagHandler,
    // P2-4 A2：组件装载探针（只读）—— `/diag-log` 的响应体带 `components`，组件行缺行时能一眼看出。
    componentsProbe: componentProbe,
  });

  // 3c-3d / 3c-3e. WE 官方素材源族路由（只读素材端点 /api/local-assets ＋ 配置端点
  //               /we-assets-dir）→ lib/routes/we-assets.js。两条注册与"配-用"联动
  //               都在那个文件里（`bodyReader` 由它自己 import，不走 `c`）；这里只声明依赖。
  //               ⚠️ `getWeAssetsDir` 传的是**访问器**不是值：`WE_ASSETS_DIR` 可变
  //                  （`setWeAssetsDir` 改写它），传值会让刚 POST 完仍读旧值。
  registerWeAssetsRoutes(webServer, {
    disposers, base: BASE, serveFile,
    CONTROL_JSON_MAX_BYTES, normalizeUserDir,
    setWeAssetsDir, listWeAssetNames, weAssetsAvailable,
    WE_ASSETS_SOURCE_ID, getWeAssetsDir,
  });

  // 3e. 场景内嵌媒资族路由（场景包自带的动画 MP4 + 独立音频）→ lib/routes/scene-media.js。
  //     两条注册、提取去重账本与提取链都在那个文件里；这里只声明它的依赖。
  //     ⚠️ `SCENE_VIDEO_INFLIGHT` 是会话段（lib/kernel/host-session.js）里的单例，
  //        生命周期与一次 apply 一致 —— 见该工厂的返回契约。
  registerSceneMediaRoutes(webServer, {
    disposers, base: BASE, mediaMap, serveFile,
    ensureFrameCacheDir, sceneVideoProbeKey, sceneVideoProbeSet,
    atomicWriteFileP, ensureSceneAudio, SCENE_VIDEO_INFLIGHT,
  });

  // 4/5/6. 上传资产族路由（导入 / 删除 / 切换上传目录）→ lib/routes/upload.js。
  //          三条注册与它们的依赖都在那个文件里；这里只声明它的依赖。
  registerUploadRoutes(webServer, {
    disposers, base: BASE, tokenFor, UPLOAD_EXT, UPLOAD_MAX_BYTES, CONTROL_JSON_MAX_BYTES,
    ensureUploadDir, readUploadMeta, metaEntry, setUploadMeta, removeUploadMeta,
    resolveUploadFile, setUploadDir, normalizeUserDir, armBodyIdleTimeout, lingerClose,
  });

  // 6b. 字体集族路由（list / get / put / delete / activate / import / export）**已出户**到子包行
  //     `dsh-plugin-wallpaper-engine-fonts`（P-A，packages/fonts/lib/routes/fontsets.js，
  //     patch 里 `id: wallpaper-engine-fonts`）。一个 `prefix` 注册覆盖七个端点；客户端半边
  //     （设置面板的字体段）仍留主 bundle —— §7.1「P-A 不动设置面板」。
  //     门面**不再**有这条调用点：那一行的 c 面由 `lib/subpackage-boot.js` 的冻结键集喂
  //     （同文件头的跨包通道说明），所以这里的 6b 只剩这段注释。
  //     出户前后**路径集合逐条相同**：`node test/tools/host-route-index.mjs` 按行现算对账。

  // 6b-2. 玻璃预设族路由（list / get / create / delete / install-assets / export / import）
  //     → lib/routes/presets.js。一个 `prefix` 注册覆盖七个端点。**没有** activate / PUT：
  //     预设没有活动指针，"应用"走客户端（读回 values → 合并 → settings 通道 PUT + 落效，
  //     立即生效），改一份预设 = 删掉重存 —— 理由见族文件头。
  //     ⚠️ ADR-0011 起预设是**整机配置快照**（settings 段 + 三个按需的资产段）⇒ 这一族
  //     要读本机资产（内嵌 / 导出补段）与落本机资产（install-assets），因此额外接线：
  //     readSettings / readFontSetId / fontSetsDir（字体段的载体是活动字体集）与
  //     mascotDir / mascotPath / avatarDir / avatarPath / AVATAR_SIDES（两族图片的落盘与
  //     定位 —— 落盘复用 mascot.js / avatar.js 同一套语义，不新增第二条通道）。
  registerGlassPresetsRoutes(webServer, {
    disposers, base: BASE, glassPresetsDir, glassPresetsBuiltinDir: GLASS_PRESET_BUILTIN_DIR,
    readSettings, readFontSetId, fontSetsDir,
    mascotDir, mascotPath, avatarDir, avatarPath, AVATAR_SIDES,
    atomicWriteFileP, ensureDirOnce, armBodyIdleTimeout, lingerClose, log,
  });

  // 6c. 「关于」页签的仓库 star 数与两张联系方式二维码（原 6c / 6d 两条腿）**已出户**到组件行
  //     `packages/about-notice/lib/index.js`（patch 里 `id: wallpaper-engine-about-notice`，
  //     C8′ 宿主侧）：本文件因此只注册**裸行部分**的路由；出户前后的路径集合逐条相同。
  //     那两条腿的纪律（只读一条出站腿、10 分钟 TTL + 落盘缓存、白名单直出 PNG）
  //     随实现一起搬走；客户端半边（关于页签渲染 / 更新公告）仍留主包，按包级 `dsh.client` 加载。
  //     ⚠️ 条数不在这里手写：`docs/ROUTE-INDEX.md` 是生成物、`test/verify-route-index.mjs`
  //     按运行时注册逐条对账；全表与每族条数用 `node test/tools/host-route-index.mjs` 现算。

  // 6c′. 本机字体清单（设置页「全局字体 / 终端字体」下拉里那一组）**已出户**到同一子包行
  //      `dsh-plugin-wallpaper-engine-fonts`（packages/fonts/lib/routes/system-fonts.js）。
  //      三平台各一条权威来源（system_profiler / PowerShell / fc-list），拿不到时按文件名推
  //      并**如实标 approximate**；一次扫描很贵（macOS 实测 ~10s）⇒ 双层缓存 + 过期先回旧值。
  //      扫描**不在启动期**发生：第一次请求这条路才触发（族文件头的不变量）。
  //      ⚠️ 落地缓存路径仍走内核键 `pluginDataDir`（该行的 `cachePath` 由包内自建，
  //      见 packages/fonts/lib/index.js:94 的 `cachePath` 实参）—— 与出户前是同一个文件。

  // 6e/6f. 「扩展」页签的会话头像两张图（`/avatar/<side>`）与「系统」页签的自定义吉祥物立绘
  //     （`/mascot`）已随 **C6 出户到 mascot-avatar 组件行**（P2-2）：两族由
  //     `packages/mascot-avatar/lib/index.js` 的 `applyImpl` 用**自建的最小出站套件**注册
  //     （`c` 与本文件同形；服务层符号从内核的**组件视图面**取），整包加载时经下面的
  //     `applyComponent` 分发点来到同一份实现。这两族的**实现体也住在组件目录里**
  //     （`packages/mascot-avatar/lib/routes/{avatar,mascot}.js`，P2-8 搬入）—— 本文件只剩分发点。

  // 7. 插件设置（端口无关持久化）→ lib/routes/settings.js。
  //    GET 回已存设置（从未存过则 null）＋ betterSidebar / adapter 两个旁路观测值；
  //    PUT /settings 按键合并（只覆盖 body 里出现过的键）写进 ~/.dsh-wallpaper-engine/config.json；
  //    GET/PUT /settings/<组件簇> 只读写该簇的键（段外键忽略；`meta` 不设路由）。
  registerSettingsRoutes(webServer, {
    disposers, base: BASE, ctx, mediaOriginApi,
    readSettings, isBetterSidebarLoaded, sanitizeSettings, withLegacyFontValues, mergeSettings,
    armBodyIdleTimeout, lingerClose,
  });

  // 7b. 「缓存位置」（高级页签）→ lib/routes/cache-dir.js。一条 POST；当前值随 /inventory
  //     的 `cacheDir` 下发。⚠️ `cacheBaseDir` 传的是**访问器**不是值：它就是"每次现读
  //     env → config → 默认"的那条解析链，传值快照会让"刚改完却报旧路径"。
  registerCacheDirRoutes(webServer, {
    disposers, base: BASE, CONTROL_JSON_MAX_BYTES,
    normalizeUserDir, cacheBaseDir, setCacheDir, armBodyIdleTimeout,
  });

  // fiber disposer 的语义（先逐个 disposer、再 releaseKernelLease(hostKernel)——内核引用计数
  // 归零才 `transcodeKit.dispose()`——再 destroy 在途流、清 activeStreams / mediaMap）
  // 逐字搬进 lib/kernel/host-session.js 的 `dispose()`。
  // ⚠️ 只 `return dispose` 不够：本模块导出的是**函数声明** `apply`（有
  // `prototype`）⇒ cordis 走 `new apply(ctx)` 分支、返回值被丢弃 ⇒ fiber 卸载时上面那串 teardown
  // 从不执行，路由留在宿主路由表里 ⇒ 关掉再打开撞 `webserver: duplicate … route`。所以同一份
  // disposer 还要交给 `ctx.effect`（cordis 的显式清理通道）；返回值只为直调方保留。
  // 交接**已挪到本函数开头**（R-1：失败路径也必须能收住，见那里的注释）—— 这里只是把同一个
  // `once` 包装原样交回给直调方（测试夹具 / 只提供 `webServer` 的 mock ctx）。
  // 见 lib/host-boot.js 的 `handOffTeardown()`；判据 test/verify-bundle-rows.mjs ⑧c。
  return teardown;
}

// 组件装载账本（P2-4 A2；P2-2b 把**实例**搬进叶子模块 `lib/host-boot.js`）：三本账
// （`loadedComponents` / `startedComponents` / `failedComponents`）与**唯一记账入口** `runComponent()`
// 都在那边，本文件只 import `runComponent` 与探针 `componentProbe`（别名 `bootComponentProbe`）。
// `applyComponent`（按组件加载的分发点）与组件入口的 `apply()`（宿主按 patch 行独立加载）都经
// `runComponent()` 调实现，写同一批账 ⇒ 两条路径语义一致。
// 账本**不读任何组件入口导出** ⇒ 不重开 P2-1b 那条模块求值期 TDZ 读边（`test/verify-bundle-rows.mjs` 钉着）。

/**
 * 组件名 → 实现（**声明面的唯一真源**；P2-4 A2 从 `applyComponent` 函数体内提出来）。
 *
 * 为什么提成模块级函数：探针要报"声明了哪些组件"，若在别处再抄一份名字清单就会漂移 ——
 * 这里改一处，`applyComponent` 与 `componentProbe()` 同时跟着变。表建在**函数体内**而不是模块级
 * 常量是承重的：门面求值期因此不读组件入口的导出（P2-1b，见 `applyComponent` 的 JSDoc）。
 */
function componentImpls() {
  return new Map([
    // 组件名（patch 行 name 的子路径段）→ 实现。**静态** import 是承重的：动态加载会让组件入口
    // 在 `test/verify-reachability.mjs` 的 import 图上不可达（ENTRY 只沿 import 边走），棘轮变红。
    ['about-notice', applyAboutNoticeImpl],
    ['mascot-avatar', applyMascotAvatarImpl],
    ['media-bridge', applyMediaBridgeImpl],
  ]);
}

/**
 * 组件装载探针（P2-4 A2）：只读，给出声明面 / 已装载面 / **已启动面** / 失败面 / 缺口；经
 * `lib/routes/diag.js` 的 `/diag-log` 响应体 `components` 字段对外可见。
 *
 * 存在理由：组件行缺行或被 `disabled` 时本包**零代码执行**，该组件的路由整族 404，而客户端
 * 「看」是静默坏（`src/client.js` 的 `<img src>`、`src/avatar-layer.js` 的 `<img>` 没有 onerror）
 * ⇒ 需要一个能一眼看出"哪个组件没装载"的落点。
 *
 * ⚠️ 只有 `loaded`（= 进过 apply）不够：真实存在的故障形态是 **apply 进了、实现抛了**
 * （`cannot get property "webServer" without inject`）⇒ `loaded` 两个组件都在，探针
 * **假绿**，而用户看到"组件启用失败"、该组件的路由全 404。三面分开报才看得见：`loaded`（进过 apply）/
 * `started`（跑完、disposer 已交回）/ `failed`（名字 → 错误文案）。口径与实现都在叶子模块
 * `lib/host-boot.js` 的 `componentProbe()`；这里只负责把**声明面**（本模块是它的唯一真源）传进去。
 *
 * ⚠️ 传的是**两个**声明面，不是一个：`declared` = 运行时装载面（`componentImpls()` 的键集，
 * 与 patch 行同口径，`test/verify-bundle-rows.mjs` 逐名钉死不许塞多余的），
 * `builtin` = **代码内建面**（同一批键，但语义是"这个包写死了哪些组件行"）。
 * 后者是给 `/inventory` 的行状态表用的：它**不知道** patch 行的启停（两面当前恒等），
 * "行被关掉"由**账本**表达 —— 没装载 ⇒ 不在 `started` / `failed` 里 ⇒ 状态表落到 `missing`。
 * 消费方需要"一个确实存在、值为不可用"的键，才能把"关掉"与"未知行 / 老宿主"分开（ADR-0013 D3③）。
 */
function componentProbe() {
  return bootComponentProbe([...componentImpls().keys()], [...componentImpls().keys()]);
}

/**
 * 组件分发点（P2-0 钉契约；P2-1/P2-2 起有两行真实组件）。
 *
 * `apply` 是"整包加载"路径（现状语义，一字未动）；本函数是"按组件加载"入口 —— 组件行在
 * `cordis.patch.yml` 里是一行**独立 plugin**（`name:` 是该子包的真包名，P-F 前是
 * `'<主包名>/<子路径>'`），宿主按那一行加载
 * 时走组件入口的 `apply(ctx, config)`，再回到这里。两个入口因此共用同一份实现，不可能漂移。
 *
 * `root` / `rawConfig` 与 `apply` 的入参同形（fiber 根 / 原样配置）；第三个实参是**显式依赖面**：
 * 组件实现能拿到什么，全在 `subpackageKeys()` 的冻结键表里逐个列出（P-F 起：与组件入口**同一
 * 真源**，不再各写一份字面量 ⇒ 两条装载路径不可能漂移；不隐式共享门面的会话状态）——
 * 这是"组件行可独立装卸"的前提。
 *
 * ⚠️ **求值期与环（P2-1b）**：本模块**静态** import 组件入口（承重，见下），组件入口又经服务面
 * 回到本模块的 `applyComponent` ⇒ 两者互为环。宿主真实装载顺序是**裸行在前** ⇒ 组件模块可能**先于**
 * 本模块求值。实现表因此建在 `componentImpls()` 的**函数体里**（`applyComponent` 真被调用时才建）：本模块的求值期不再读组件
 * 入口的导出，那条 TDZ 读边（`ReferenceError: Cannot access '…' before initialization`）被消除。
 * 注意这**没有消除环本身**，只去掉了门面求值期的读边；组件侧在**模块作用域**回调门面导出仍会 TDZ
 * —— 那条纪律写在组件入口文件头，并由 `test/verify-bundle-rows.mjs` 的判据钉住；彻底解耦（拆环）
 * 留给 P2-2b。
 */
export function applyComponent(root, rawConfig, component) {
  const impls = componentImpls();
  const impl = impls.get(component);
  if (typeof impl !== 'function') throw new Error('unknown component: ' + component);
  // 记账与错误留证都在叶子模块 `lib/host-boot.js` 的 `runComponent()` 里（**唯一记账入口**）：
  // 组件入口自己的 `apply()` 走同一个函数 ⇒ 两条装载路径同一批账，且失败必然被记进 `failed`。
  // 未知组件在上面就抛了 ⇒ 注册面与账本都不会被污染（`/diag-log` 探针读这批账）。
  // P-F：组件行的宿主半边**全部出户**到 `packages/<pkg>/`（`SUBPACKAGE_KEY_TABLE` 里三格都有它）
  // ⇒ 依赖面**一律**取自冻结键表 —— 与组件入口 `apply()` 里那次 `host.keys(component, ctx)` 逐键相等，
  // 两条装载路径不可能漂移。`http` 面（纯符号视图 `httpView`）与组件入口里的 `host.http` 是同一份
  // 对象：路由族的应答 / 读体只有这一条通道（出户后本包零主包说明符）⇒ 两条路径连"怎么应答"都一致。
  //
  // 「迁移窗口」的三元式（仍在 `lib/components/` 的格子沿用主包字面量）已随批 1c 三格全部出户删除
  // （2026-10-16）；`repoSlugFromPkg` / `pluginDataDir` / `configPath` 等出户组件需要的绑定现在只经
  // `boot:` / `data:` 源型从服务面取，本模块不再持有它们。
  const deps = { ...subpackageKeys(component, root), http: httpView };
  return runComponent(component, root, rawConfig, deps, impl);
}

export default { inject, apply };
