/**
 * host-kernel.js —— 宿主内核：门面在**模块加载期**建成的各套件实例（P1a 内核化；清单以本文件的
 * 构造点为准）。
 *
 * 来源：从 `lib/index.js` **纯搬移**（P1a）。搬过来的东西逐字保留 —— 构造语句、它们的
 * 族外依赖、构造顺序、每族解构名，以及随实现走的注释。门面因此收缩成"薄适配层"：单例
 * `const hostKernel = createHostKernel();` 建在叶子模块 `lib/host-boot.js`，门面只一次同名解构 ⇒ `apply()` 内**零改动**
 * （`registerXxxRoutes(webServer, …)` 调用点与每个 `c` 对象逐字未变；调用点清单由
 * `node test/tools/host-route-index.mjs` 现算）。
 *
 * ⚠️ 时点契约（不可改，`test/verify-adapter.mjs` 钉的）：`createHostKernel()` 必须在
 * **模块加载期**执行（`lib/host-boot.js` 的模块作用域），不能挪进 `apply()`：
 *   ① 上传库的 `UPLOAD_DIR` 在**模块加载时**解析 env ⇒ env 必须在 import 门面之前设好；
 *   ② 族内符号被门面**模块级**调用点消费（`ensureDirOnce` / `pathExistsP` / `cacheBaseDir` 族），
 *      建在 `apply()` 里这些调用点就拿不到同名绑定（要么改签名、要么靠未初始化的 let 兜底）。
 * 生命周期与原"模块级单例"完全一致：同一模块实例被再次 apply 时状态保留，卸载时由
 * `releaseKernelLease()`（**引用计数归零**才触发 `transcodeKit.dispose()`，见下方租约段）
 * 与各路由族登记的 disposer 收口。
 *
 * ── 返回契约（`createHostKernel()` → 平坦对象）────────────────────────────────
 * ⚠️ 字段总数与两级分面的**数字一律不写在这里**：口径与实测由 `test/verify-component-face.mjs` ①
 * 按本文件的 `KERNEL_STABLE_FACE` 与实跑返回对象现算（**只有那条判据的文件头持有合同数字**）
 * ⇒ 改契约时改那一处，本文件不再留第二份会漂的副本。
 *
 * **稳定面（stable face）** —— 被 ≥2 个路由族或门面共享基座消费的字段（键集见本文件末
 * `KERNEL_STABLE_FACE`）；搬移或改语义必须连带改契约与全部消费方：
 *   `base` · `disposers` · `serveFile` · `log` · `armBodyIdleTimeout` · `lingerClose` ·
 *   `mediaMap` · `atomicWriteFileP` · `appendDiagLine` · `CONTROL_JSON_MAX_BYTES` ·
 *   `normalizeUserDir` · `cacheBaseDir` · `cachePath` · `mediaOriginApi` · `traceRequests`
 *   · 本次已由内核产出：`atomicWriteFileP` · `appendDiagLine` · `armBodyIdleTimeout` ·
 *     `lingerClose` · `normalizeUserDir` · `cacheBaseDir` · `traceRequests`；
 *   · 仍由门面 `apply()` 构建：`base`（门面 `const BASE`）· `disposers` · `serveFile` ·
 *     `log` · `mediaMap` · `CONTROL_JSON_MAX_BYTES` · `cachePath`（`() => join(pluginDataDir(), …)`
 *     那一族按需访问器）· `mediaOriginApi` —— 它们要么依赖 `ctx`、要么与"一次 apply"同生命周期，
 *     属 P1b（"apply 内的基座也进内核"）的范围，本次**刻意不动**（零改动纪律优先）。
 *
 * **内部面（internal face）** —— 单族消费的实现细节（发现 / 配置 / 数据目录 / 上传库 /
 * 帧缓存 / 转码 / 媒体目录 / diag / http 生命周期…）。本文件外不得直接依赖；要跨族复用，先把它
 * 升进稳定面并补契约。P1-S1 追加的 `mergeSettings`（配置族：读-改-写整条在写队列内）属此种 ——
 * 只有 settings 路由一族消费（门面转发注入）⇒ 列内部面，稳定面不变（键集见 `KERNEL_STABLE_FACE`）。
 * （口径：字段总数 = 内核产出的**稳定面** + **内部面**两级；键数与实测由
 * `test/verify-component-face.mjs` ① 现算，本文件不抄数字。）
 *
 * **访问器 vs 值（deps 纪律）** —— 门面给套件注入依赖时：**可变目录 / 可变配置一律传访问器**
 * （函数），让运行期改写立即生效；**常量与共享可变状态传值**（对象引用）。本模块逐字保留原门面
 * 的每一条选择，例：
 *   · 访问器：`cacheBaseDir` · `configPath` · `readConfig` · `readSettings` ·
 *     `videoPreviewCacheDir: () => videoPreviewKit.videoPreviewCacheDir()` ·
 *     `ensureFrameCacheDir: () => frameStoreKit.ensureFrameCacheDir()`（另有清单族与路由族各自
 *     接的 `getUploadDir` / `getWeAssetsDir` / `mascotDir` / `avatarDir` / `customFrameDir` /
 *     `normalizeUserDir` / `cachePath` / `tokenFor`…）
 *   · 值/引用：`WEBWALLGL_DIR`（① 先建，无初始化环）· `pluginDataDir` · `transcodeKit`（共享
 *     可变状态：在途表 / 并发闸）· `atomicWriteFileP` …
 * 反例代价：把 `cacheBaseDir` 传值快照 ⇒ "刚改完缓存位置却仍报旧路径"。
 *
 * 本模块**绝不** import `lib/index.js`（会成环）：只 import `node:` 内置与本仓 lib/ 的族模块。
 */

import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { access, stat } from 'node:fs/promises';

// 配置 / 数据目录内核（本目录）。
import { createConfigKit } from './config.js';
import { createDataDir, configPath, pluginDataDir } from './data-dir.js';
// 发现与播放列表族：上游把它拆成两族（各有独立守卫）——「Steam/WE 安装发现」+「目录树扫描」。
import { createSteamDiscoveryKit } from '../steam-discovery.js';
import { createWallpaperScanKit } from '../wallpaper-scan.js';
// 存储三族（上传库 / 缓存根迁移 / 帧缓存与 GPU 抓帧）。
import { createUploadStoreKit } from '../upload-store.js';
// 上传目录的运行期状态与迁移（上游把它们留在门面私有位置）—— 见 lib/upload-dir.js 文件头。
import { createUploadDirKit, createUploadDirResolution } from '../upload-dir.js';
// 用户目录归一 + 跨卷安全移动 + 容器后缀：上游把它们留在门面**私有**位置，本分支抽成叶子模块共用
// （从门面 import 会成 `内核 → 门面` 的环，见 lib/fs-paths.js 文件头）。
import { extOf, normalizeUserDir, moveFileP } from '../fs-paths.js';
import { createCacheDirKit } from '../cache-dir.js';
import { createFrameStoreKit } from '../media/frame-store.js';
// 随包 WE 资源族 / mediaDirs / shim-seed / diag-trace / http-lifecycle。
import { createWeAssetsKit } from '../we-assets.js';
import { createMediaDirsKit } from '../media/media-dirs.js';
import { createShimSeedKit } from '../shim-seed.js';
import { createDiagTraceKit } from '../diag-trace.js';
import { createHttpLifecycleKit } from '../http-lifecycle.js';
// 媒体探测三族（MP4 元信息 / 场景音频与视频探测 / 视频预览抽帧）＋ 转码套件。
import { createMp4ProbeKit } from '../media/mp4-probe.js';
import { createSceneProbeKit } from '../media/scene-probe.js';
import { createVideoPreviewKit } from '../media/video-preview.js';
import { createTranscodeKit } from '../media/transcode.js';

/** Steam appid for Wallpaper Engine. */
const WE_APPID = '431960';

/** 面积升级守卫的容差（上游 lib/index.js 取值）：来帧面积 < 盘上主帧 × (1−TOL) ⇒ 409。 */
const GPU_FRAME_AREA_TOL = 0.05;

/**
 * npm 依赖 `webwallgl` 的**包目录**（引擎文件与 web shim 正文的取源）。
 * ⚠️ 它必须真的存在，否则：
 *   · `/scene-live/engine/*` 走"未安装"早退 ⇒ 404 + no-store（判据要 200 + revalidate）；
 *   · `readWebShim()` 拿不到 bundle ⇒ 静默空串 ⇒ /scene-files 的四段注入整条跳过。
 * 解析失败返回 null（调用方各自降级），**不抛**。
 */
const WEBWALLGL_PKG_DIR = (() => {
  try {
    return dirname(createRequire(import.meta.url).resolve('webwallgl'));
  } catch {
    return null;
  }
})();

/** WE schemecolor（"0.847 0.725 0.713"，0–1 浮点三元组）→ CSS 颜色；无效返回 null。 */
function schemeToCss(v) {
  if (typeof v !== 'string') return null;
  const parts = v.trim().split(/\s+/).map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some((x) => !Number.isFinite(x))) return null;
  const c = parts.slice(0, 3).map((x) => Math.max(0, Math.min(255, Math.round(x * 255))));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

// ── 内核租约（D5）─────────────────────────────────────────────────────────────
/**
 * 引用计数租约：`hostKernel` 是**模块级**单例（`lib/host-boot.js` 的
 * `export const hostKernel = createHostKernel();`），而 `createHostSession(...)` 每次 apply 产出
 * **新的**会话对象。于是"两行共享同一份内核"时，谁都不该在卸载时抢先释放共享资源
 * （`transcodeKit` 的在途 ffmpeg 子进程 / 进度账本 / 在途表）—— 只有**最后一个**卸载的
 * 会话才真的 dispose。
 *
 * 计数**不进** `createHostKernel()` 的平坦返回对象（键数与分面口径见 `test/verify-component-face.mjs` ①）：它按 kernel 对象归属，
 * 存在这里的模块级 WeakMap 里 ⇒ 字段数不变、也不会随会话泄漏（键是弱引用）。
 *
 * 单行（现状）语义等价：一次 acquire（计数 1）→ 一次 release（计数归零）⇒ 恰一次 dispose。
 */
const KERNEL_LEASES = new WeakMap(); // kernel → 未释放的会话数

/** 会话建立时登记一次（`lib/kernel/host-session.js` 工厂体解构后立即调）。 */
export function acquireKernelLease(kernel) {
  KERNEL_LEASES.set(kernel, (KERNEL_LEASES.get(kernel) || 0) + 1);
}

/**
 * 会话 teardown 时释放一次；返回**是否真的 dispose 了**（供守卫做行为断言）：
 *   · 计数 > 1 ⇒ 只减一，共享资源留给最后一行（返回 false）；
 *   · 未 acquire 过 / 计数已归零 ⇒ 幂等 no-op（返回 false）—— **不得**再 dispose 一次，
 *     否则"归零后再 release"会二次清空在途任务（`test/verify-bundle-rows.mjs` 钉这条）。
 * dispose 的异常不吞（与现 teardown 同款语义，不包 try/catch）。
 */
export function releaseKernelLease(kernel) {
  const n = KERNEL_LEASES.get(kernel) || 0;
  if (n <= 0) return false;
  if (n > 1) { KERNEL_LEASES.set(kernel, n - 1); return false; }
  KERNEL_LEASES.delete(kernel);
  kernel.transcodeKit.dispose();
  return true;
}

/**
 * 建一次宿主内核（门面在**模块作用域**建一次，见文件头的时点契约）。
 *
 * 无 deps：内核自足 —— 所有族外依赖都是 `node:` 内置或本仓 lib/ 的静态 import；门面不再向
 * 内核传任何值（这是 P1a"内核自足"的判据，也是 P1b 继续搬 `apply()` 内基座的前提）。
 */
export function createHostKernel() {
  // ── Steam / WE 发现与播放列表族（`lib/steam-discovery.js` + `lib/wallpaper-scan.js`）──
  // 装配形状：上游把这一族拆成「安装/库发现」与「目录树扫描」两个 kit（各有独立守卫），
  // 本分支 P0 曾合成一个 `lib/we-discovery.js`；按 F 裁决取上游拆分，并把下面这些**注入**进去：
  //   · 三个异步谓词 + `mtimeOrNullP` —— 上游由门面供给（`pathExistsP` 还被 cache-dir /
  //     upload-dir / inventory 消费，必须在内核里仍是一个绑定）；
  //   · `extOf` / `schemeToCss` —— 本分支的**单一真源**（`lib/fs-paths.js` / 本文件），
  //     注入进扫描族而不是让它自带一份（见 `lib/wallpaper-scan.js` 文件头的差异说明）。
  const pathExistsP = async (p) => { try { await access(p); return true; } catch { return false; } };
  const isFileP = async (p) => { try { return (await stat(p)).isFile(); } catch { return false; } };
  const isDirectoryP = async (p) => { try { return (await stat(p)).isDirectory(); } catch { return false; } };
  /** 异步取 mtime (ms)；不存在/读不到返回 null —— 兼作存在性探测（sceneVideo 缓存键）。 */
  const mtimeOrNullP = async (p) => { try { return (await stat(p)).mtimeMs; } catch { return null; } };
  const { locateWallpaperEngineP, owningLibrariesP } = createSteamDiscoveryKit({ WE_APPID, pathExistsP });
  const {
    readProjectP, resolveSceneMainFileP, scanSignatureP,
    enumerateWallpapersAsync, pathKey, readPlaylistsP, playlistItemId,
    SCAN_CHUNK,
  } = createWallpaperScanKit({ WE_APPID, pathExistsP, isFileP, isDirectoryP, extOf, schemeToCss });

  // ── 数据目录 / config 内核（`lib/kernel/data-dir.js` + `lib/kernel/config.js`）──
  const configKit = createConfigKit();
  const {
    readConfig, atomicWriteFileSync, atomicTmpPath, atomicWriteFileP,
    writeConfig, enqueueConfigWrite, readSettings, writeSettings, mergeSettings,
    fontSetsDir, glassPresetsDir, readFontSetId, setFontSetId,
    commitFontSetMigration, withLegacyFontValues,
  } = configKit;
  const { cacheBaseDir } = createDataDir({ normalizeUserDir, readConfig });

  // ── Scene 独立音频（BGM/音效，WE 音频组件引用）`lib/media/scene-probe.js` ──────
  const sceneProbeKit = createSceneProbeKit({ ensureFrameCacheDir: () => frameStoreKit.ensureFrameCacheDir(), atomicWriteFileP });
  const {
    ensureSceneAudio, sceneVideoProbeKey, sceneVideoProbeGet, sceneVideoProbeSet, scheduleSceneVideoProbe,
  } = sceneProbeKit;

  // ── Media metadata probe（最小 MP4 box walker）`lib/media/mp4-probe.js` ────────
  const mp4ProbeKit = createMp4ProbeKit();
  const { getMediaInfo } = mp4ProbeKit;

  // ── Frame-skip transcode（抽帧转码, ffmpeg）`lib/media/transcode.js` ───────────
  const transcodeKit = createTranscodeKit({
    cacheBaseDir, configPath, videoPreviewCacheDir: () => videoPreviewKit.videoPreviewCacheDir(), getMediaInfo, atomicTmpPath,
    // 本地 ffmpeg 的查找根 = bundle 根。搬移前门面算的是
    // `join(dirname(fileURLToPath(import.meta.url)), '..')`（门面在 lib/ 下）；本模块在
    // lib/kernel/ 下 ⇒ 等价式要多退一级（下方 we-assets 的 pluginRoot 同理、方向相反）。
    pluginRoot: join(dirname(fileURLToPath(import.meta.url)), '..', '..'),
  });
  const {
    ensureDirOnce, transcodeCacheDir, sweepTranscodeArtifacts, sweepCustomFrameTmp,
    transcodeToFps, registerTranscodeWaiter, transcodeCachePathFor,
    transcodeJobs,
  } = transcodeKit;

  // ── 上传目录的运行期状态与迁移 `lib/upload-dir.js` ──────────────────────────────
  // 上游把这三样（`UPLOAD_DIR` 状态 / `resolveUploadFile` / `setUploadDir`）留在**门面内**，
  // 只把「解析默认与候选目录」交给 `lib/asset-paths.js` 的 kit。⚠️ 上游那份同名副本**已删**：
  // 解析链由叶子模块 `lib/upload-dir.js` 的
  // `createUploadDirResolution()` 给出（默认值的唯一真源在那里），这里只 import + 注入。
  // 本分支门面是薄适配层 ⇒ 收进叶子模块，由这里在**模块加载期**建一次
  // （env 解析时点被 test/verify-adapter.mjs 钉住）。
  // ⚠️ 必须**先于**上传库 kit 建：上游 `createUploadStoreKit` 把 `getUploadDir` 当**注入项**
  // （它的 `ensureUploadDir()` / `uploadMetaPath()` 内部调用该访问器）—— 少传这一项会在
  // 第一次取上传元数据时抛 `getUploadDir is not a function`（本轮实测的装配期错误）。
  const { defaultUploadDir, resolveUploadDir } = createUploadDirResolution({ pluginDataDir, readConfig });
  const uploadDirKit = createUploadDirKit({
    defaultUploadDir, resolveUploadDir,
    ensureDir: ensureDirOnce, pathExistsP, moveFileP, enqueueConfigWrite,
    readConfig, writeConfig,
    readProjectP, resolveSceneMainFileP, SCAN_CHUNK,
    previewCandidates: () => uploadStoreKit.PREVIEW_CANDIDATES || [],
  });

  // ── 上传库（上传 meta 与上传文件枚举）`lib/upload-store.js` ─────────────────────
  // 实例必须在**模块加载期**建：`UPLOAD_DIR` 的 env 解析发生在模块加载时。
  const uploadStoreKit = createUploadStoreKit({
    getUploadDir: uploadDirKit.getUploadDir,
    ensureDirOnce, enqueueConfigWrite, atomicWriteFileSync,
  });
  const {
    ensureUploadDir, readUploadMeta, metaEntry, setUploadMeta,
    removeUploadMeta,
  } = uploadStoreKit;
  const {
    resolveUploadFile, setUploadDir, getUploadDir, UPLOAD_MAX_BYTES, enumerateUploadsP,
  } = uploadDirKit;

  // ── weAssets 套件（随包内建目录）`lib/we-assets.js` ────────────────────────────
  // pluginRoot = bundle 的 `lib/`（门面原式 `dirname(fileURLToPath(import.meta.url))`）。
  const weAssetsKit = createWeAssetsKit({
    pluginRoot: join(dirname(fileURLToPath(import.meta.url)), '..'),
    readConfig, writeConfig, enqueueConfigWrite,
  });
  const {
    // ⚠️ `WEBWALLGL_PKG_DIR` **不在这里解构**：它是本文件模块级常量（we-assets kit 不提供它 ——
    // 它是 npm 依赖 webwallgl 的包目录）。在这里解构会把它影子化成 `undefined`（同类陷阱第二次踩）。
    WEBWALLGL_DIR, ABOUT_DIR, FONTSET_BUILTIN_DIR, GLASS_PRESET_BUILTIN_DIR,
    WE_ASSETS_SOURCE_ID, weAssetsAvailable, getWeAssetsDir, setWeAssetsDir, listWeAssetNames,
  } = weAssetsKit;

  // ── web shim / 属性 seed / 侧栏安装检测套件 `lib/shim-seed.js` ─────────────────
  // `WEBWALLGL_DIR` 由上方 we-assets 套件以值常量提供（① 先建，无初始化环）。
  const shimSeedKit = createShimSeedKit({
    WEBWALLGL_PKG_DIR, WEBWALLGL_DIR, readSettings });
  const {
    readWebShim, userPropsFor, buildSeedScript, isBetterSidebarLoaded,
  } = shimSeedKit;

  // ── 帧缓存与 GPU 抓帧 `lib/media/frame-store.js` ──────────────────────────────
  // sceneProbeKit（上方，传访问器）与 scene-frame / scene-media 两条路由族都消费它。
  const frameStoreKit = createFrameStoreKit({ cacheBaseDir, ensureDirOnce });
  const {
    // ⚠️ `GPU_FRAME_AREA_TOL` **不在这里解构**：它是本文件模块级的常量（frame-store kit 不提供），
    // 在这里解构会把它影子化成 `undefined`（实测踩过：返回对象里该键为 undefined）。
    ensureFrameCacheDir, GPU_FRAME_MAX_BYTES, GPU_WRITE_INFLIGHT,
    gpuFrameFileFor, looksLikePng, pngSizeOf, pngDimsOfBuf, sceneFrameSlot,
  } = frameStoreKit;

  // ── Custom-upload video thumbnails（按需 ffmpeg 抽帧）`lib/media/video-preview.js` ──
  const videoPreviewKit = createVideoPreviewKit({ cacheBaseDir, ensureDirOnce, transcodeKit });
  const {
    pruneVideoPreviewCache, pruneCacheDirBySize, TRANSCODE_CACHE_MAX_BYTES,
    generateVideoPreview,
  } = videoPreviewKit;

  // ── mediaDirs 套件（立绘/头像/自定义画面目录与路径）`lib/media/media-dirs.js` ────
  const mediaDirsKit = createMediaDirsKit({ pluginDataDir, ensureDirOnce });
  const {
    UPLOAD_EXT, CUSTOM_FRAME_EXT, CUSTOM_FRAME_MAX_BYTES, customFrameDir, AVATAR_EXT,
    AVATAR_MAX_BYTES, AVATAR_SIDES, avatarDir, MASCOT_EXT, MASCOT_MAX_BYTES, mascotDir,
    mascotPath, avatarPath, liveFrameFile, customIdFromAbs, customFramePath,
    listCustomFrameIds,
  } = mediaDirsKit;

  // ── 诊断日志与请求追踪 `lib/diag-trace.js` ────────────────────────────────────
  const diagTraceKit = createDiagTraceKit({ configPath });
  const {
    appendDiagLine, traceRequests, traceMediaRequests,
  } = diagTraceKit;

  // ── 缓存根迁移 `lib/cache-dir.js`（POST /cache-dir 消费 `setCacheDir`）──────────
  const cacheDirKit = createCacheDirKit({
    cacheBaseDir, readConfig, writeConfig, enqueueConfigWrite,
    pathExistsP, ensureDirOnce, moveFileP,
  });
  const { setCacheDir } = cacheDirKit;

  // ── HTTP 生命周期：空闲超时 / linger 收口 `lib/http-lifecycle.js` ──────────────
  const httpLifecycleKit = createHttpLifecycleKit();
  const {
    armBodyIdleTimeout, lingerClose,
  } = httpLifecycleKit;

  // ══════════════════════════════════════════════════════════════════════════════
  // 返回契约：门面解构用的**平坦**对象（族别见文件头"稳定面 / 内部面"）。
  // 只把门面真正消费的字段交出去；族内其余实现细节（`SCAN_CHUNK` / `atomicTmpPath` /
  // `resolveFfmpeg` / `spawnFfmpeg` / `writeConfig` / `enqueueConfigWrite` /
  // `readProjectP` / `resolveSceneMainFileP` / `videoPreviewCacheDir`）留在内核内，
  // 属内部面 —— 门面不再看到它们。
  // ══════════════════════════════════════════════════════════════════════════════
  return {
    // 发现族
    pathExistsP, mtimeOrNullP, locateWallpaperEngineP, owningLibrariesP, pathKey, readPlaylistsP,
    playlistItemId, scanSignatureP, enumerateWallpapersAsync,
    // 配置族
    readConfig, atomicWriteFileSync, atomicWriteFileP, readSettings, writeSettings, mergeSettings,
    fontSetsDir, glassPresetsDir, readFontSetId, setFontSetId, commitFontSetMigration, withLegacyFontValues,
    // 数据目录（`pluginDataDir` 是模块级路径函数，随内核以**值**传出 —— 见文件头「值/引用」：
    // 会话段 `host-session.js` 从 kernel 解构它来拼旧版清扫根 `legacyCacheBaseDir`。
    // ⚠️ 漏掉这一个键不会抛在装配期：解构得到 `undefined`，直到 `join(pluginDataDir(), 'cache')`
    //    被调用时才抛 TypeError，且 `lib/faststart.js:84-90` 的 try/catch 会把它吞成"只扫当前根"
    //    ⇒ 旧版 faststart 副本永不回收。判据 test/verify-mp4-vfs.mjs 的 G2。）
    cacheBaseDir, pluginDataDir,
    // 场景探测族
    ensureSceneAudio, sceneVideoProbeKey, sceneVideoProbeGet, sceneVideoProbeSet, scheduleSceneVideoProbe,
    // MP4 元信息
    getMediaInfo,
    // 转码族（＋共享可变状态的句柄：会话卸载时经 `releaseKernelLease()` 释放，
    // 引用计数归零才由它触发 `transcodeKit.dispose()`）
    ensureDirOnce, transcodeCacheDir, sweepTranscodeArtifacts, sweepCustomFrameTmp, transcodeToFps,
    registerTranscodeWaiter, transcodeCachePathFor, transcodeJobs, transcodeKit,
    // 上传库族（`normalizeUserDir` 是 `lib/fs-paths.js` 的模块级导出，这里以稳定面身份透传）
    ensureUploadDir, readUploadMeta, enumerateUploadsP, metaEntry, setUploadMeta, removeUploadMeta,
    resolveUploadFile, setUploadDir, getUploadDir, UPLOAD_MAX_BYTES, normalizeUserDir,
    // 随包 WE 资源族
    WEBWALLGL_DIR, WEBWALLGL_PKG_DIR, ABOUT_DIR, FONTSET_BUILTIN_DIR, GLASS_PRESET_BUILTIN_DIR, WE_ASSETS_SOURCE_ID,
    weAssetsAvailable, getWeAssetsDir, setWeAssetsDir, listWeAssetNames,
    // shim-seed 族
    readWebShim, userPropsFor, buildSeedScript, isBetterSidebarLoaded,
    // 帧缓存族
    ensureFrameCacheDir, GPU_FRAME_MAX_BYTES, GPU_FRAME_AREA_TOL, GPU_WRITE_INFLIGHT, gpuFrameFileFor, looksLikePng,
    pngSizeOf, pngDimsOfBuf, sceneFrameSlot,
    // 视频预览族
    pruneVideoPreviewCache, pruneCacheDirBySize, TRANSCODE_CACHE_MAX_BYTES, generateVideoPreview,
    // 媒体目录族
    UPLOAD_EXT, CUSTOM_FRAME_EXT, CUSTOM_FRAME_MAX_BYTES, customFrameDir, AVATAR_EXT,
    AVATAR_MAX_BYTES, AVATAR_SIDES, avatarDir, MASCOT_EXT, MASCOT_MAX_BYTES, mascotDir, mascotPath,
    avatarPath, liveFrameFile, customIdFromAbs, customFramePath, listCustomFrameIds,
    // diag 族
    appendDiagLine, traceRequests, traceMediaRequests,
    // 缓存根迁移 / HTTP 生命周期
    setCacheDir, armBodyIdleTimeout, lingerClose,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 分级面的**机械真源**（P2-7B）—— 把上面那段散文变成可复算的键集。
// ══════════════════════════════════════════════════════════════════════════════
/**
 * 稳定面（stable face）的键集，与文件头「返回契约」列的项**逐字对应**（项数即本数组长度）。
 *
 * 为什么要有这份数组：文件头把"稳定面 / 内部面"两级写成散文，没有任何判据对账 ⇒
 * 分级会随人读代码的记性漂移（P2-7 的 M9 就是问这个）。这里给出单一真源，
 * `test/verify-component-face.mjs` 按"实跑内核的 `Object.keys()` − 稳定面 ∩ 内核键"
 * 复算内部面（三组数字见文件头「返回契约」），并断言组件视图的每一键都在这个口径内。
 *
 * ⚠️ 键集是**契约**：加减一项都是契约变更，必须同步改文件头「返回契约」与消费方
 * （组件视图 / 路由族声明面）。这里只声明，不做运行期校验 —— 校验在守卫里，
 * 免得模块加载期多一次抛错面。
 *
 * 本数组 = 内核产出的那些项（`atomicWriteFileP` · `appendDiagLine` · `armBodyIdleTimeout` ·
 * `lingerClose` · `normalizeUserDir` · `cacheBaseDir` · `traceRequests`）＋ 仍由门面 `apply()`
 * 构建的那些项（`base` · `disposers` · `serveFile` · `log` · `mediaMap` · `CONTROL_JSON_MAX_BYTES` ·
 * `cachePath` · `mediaOriginApi`）—— 后者**不在**本函数的返回对象上，所以"稳定面 ∩ 内核键"
 * 只剩前者；内部面 = 内核键 − 稳定面。
 */
export const KERNEL_STABLE_FACE = Object.freeze([
  'base',
  'disposers',
  'serveFile',
  'log',
  'armBodyIdleTimeout',
  'lingerClose',
  'mediaMap',
  'atomicWriteFileP',
  'appendDiagLine',
  'CONTROL_JSON_MAX_BYTES',
  'normalizeUserDir',
  'cacheBaseDir',
  'cachePath',
  'mediaOriginApi',
  'traceRequests',
]);
