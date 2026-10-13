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
 *      Scene (native 3D) wallpapers are rendered live by the WebWallGL engine
 *      (npm `webwallgl`, page in lib/webwallgl/ + /scene-live); Application wallpapers are listed
 *      too, but only their preview image is served (they would need the host to
 *      launch a third-party executable, which this plugin does not do).
 *   3. Serve a JSON inventory and the media/preview bytes over loopback HTTP
 *      routes the browser half fetches directly (same-origin):
 *        GET /wallpaper-engine/inventory          → JSON with 8 top-level keys:
 *                                                   installDir, total, portableCount,
 *                                                   wallpapers[…], playlists[…], uploadDir,
 *                                                   weAssetsDir, weAssetsAvailable
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

import {
  readFileSync,
  existsSync,
  statSync,
  readdirSync,
  mkdirSync,
  openSync,
  readSync,
  closeSync,
} from 'node:fs';
// Async filesystem (thread pool) for the wallpaper-scan chain — keeps the
// event loop responsive on slow media (WSL DrvFS) instead of blocking it for
// seconds per chunk (see "Loading plugins…" stall report).
import {
  access, readdir, stat,
  rename as renameP, unlink as unlinkP, copyFile as copyFileP,
} from 'node:fs/promises';
import { join, resolve, normalize, dirname, relative, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// WE 用户属性（project.json general.properties）→ 面板描述 / 覆盖值合并。
// 语义细节见该文件头：order 浮点、combo 保类型、逐键本地化、condition 只影响 UI。
import { parseUserPropDefs, entryDirPrefix } from './we-props.js';
// 设置白名单/校验的**唯一真源**（客户端侧由构建期内联同一文件）。
import { sanitizeFromSchema, isFontSetId, sanitizeFontset, FONTSET_KEYS } from './settings-schema.js';
// 清单构建族（`buildInventory` 与它的两个字段函数）—— 见 lib/inventory.js 文件头。
import { createInventoryBuilder } from './inventory.js';
// 字节出站套件（载荷账本 / 静态发送 / /scene-files）—— 见 lib/serve.js 文件头。
import { createServeKit, payloadProgress } from './serve.js';
// 虚拟 faststart 的布局分析器（moov 搬家 = 服务期段表合成，磁盘 0）—— 见 lib/mp4-vfs.js 文件头。
import { createMp4VfsKit } from './mp4-vfs.js';
// faststart 子系统（字节布局钉子 / 预热 / 旧副本清扫）—— 见 lib/faststart.js 文件头。
import { createFaststartKit } from './faststart.js';
// scene 探测套件（独立音轨抽取 + 「主文件是否内嵌 MP4」探测账本）—— 见 lib/scene-probe.js 文件头。
import { createSceneProbeKit } from './scene-probe.js';
// MP4 容器探测（moov 盒走读 → 分辨率/编码/fps/duration + moov 位置）—— 抽帧上限判定
// 与 faststart 判据共用它；见 lib/media-probe.js 文件头。
import { getMediaInfo } from './media-probe.js';
// 壁纸扫描族（扫描根推导 / 签名 / project.json / 播放列表）—— 见 lib/wallpaper-scan.js 文件头。
import { createWallpaperScanKit } from './wallpaper-scan.js';
// 缓存清扫套件（孤儿产物清扫 + 两类容量上限）。
import { createCachePruneKit } from './cache-prune.js';
// 配置存储（config.json 的读 + 原子发布 + 读改写排队）。
import { createConfigStoreKit } from './config-store.js';
// Steam / WE 安装探测（注册表 + libraryfolders.vdf + 库归属）。
import { createSteamDiscoveryKit } from './steam-discovery.js';
// 抽帧转码（ffmpeg 供给 + 并发闸 + 在途任务账本）——见该文件头的不变量。
import { createTranscodeKit } from './transcode.js';
// 视频缩略图生成套件（并发闸 + 缓存键 + 同键合流）—— 见 lib/video-preview.js 文件头。
import { createVideoPreviewKit } from './video-preview.js';
// 诊断落盘套件（实现见 lib/host-diag.js）：diagBytes 水位与 reqLogSeen 去重表跟随实现。
import { createHostDiagKit } from './host-diag.js';
// 上传元数据账本（.meta.json 的读改写 + 预览候选名）—— 见 lib/upload-store.js 文件头。
import { createUploadStoreKit } from './upload-store.js';
// 本机目录/导入素材族（实现见 lib/asset-paths.js）：上传目录、自定义画面、头像立绘、WE 素材。
import { createAssetPathsKit } from './asset-paths.js';
import { registerDiagRoutes } from './routes/diag.js';
import { registerNowPlayingRoutes } from './routes/now-playing.js';
import { registerSceneFrameRoutes } from './routes/scene-frame.js';
import { registerMediaDerivedRoutes } from './routes/media-derived.js';
import { registerMediaBytesRoutes } from './routes/media-bytes.js';
import { registerWeAssetsRoutes } from './routes/we-assets.js';
import { registerSceneMediaRoutes } from './routes/scene-media.js';
import { registerSceneServeRoutes } from './routes/scene-serve.js';
import { registerOcclusionRoutes } from './routes/occlusion.js';
import { createOcclusionHub } from './occlusion/index.js';
import { registerUploadRoutes } from './routes/upload.js';
import { registerFontsetsRoutes } from './routes/fontsets.js';
import { registerGlassPresetsRoutes } from './routes/presets.js';
import { registerGithubStarsRoutes } from './routes/github-stars.js';
import { registerSystemFontsRoutes } from './routes/system-fonts.js';
import { registerAboutQrRoutes } from './routes/about-qr.js';
import { registerAvatarRoutes } from './routes/avatar.js';
import { registerMascotRoutes } from './routes/mascot.js';
import { registerPropsRoutes } from './routes/props.js';
import { registerLiveFrameRoutes } from './routes/live-frame.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerCacheDirRoutes } from './routes/cache-dir.js';
import { createLog } from './log.js';
import { createNotice } from './notice.js';
import { createMediaOrigin } from './media-origin.js';

/** Steam appid for Wallpaper Engine. */
const WE_APPID = '431960';
/** Request path prefix under which this bundle's HTTP surface lives. */
const BASE = '/wallpaper-engine';
/** 终端行前缀里的名字（日志与提示通道共用同一个，别写成两处字面量）。 */
const PLUGIN_NAME = 'wallpaper-engine';
/** WebWallGL renderer page (our host-adapter page served under /scene-live). */
const WEBWALLGL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'webwallgl');
/**
 * Package directory of the `webwallgl` npm dependency (the rendering engine
 * itself), served under /scene-live/engine/. `exports` has no `./package.json`
 * entry, so resolve the main entry and take its directory. `null` when the
 * dependency is not installed: the renderer page then fails to load its engine
 * and the client's live watchdog degrades as for any other render failure.
 */
const WEBWALLGL_PKG_DIR = (() => {
  try {
    return dirname(createRequire(import.meta.url).resolve('webwallgl'));
  } catch {
    return null;
  }
})();
/**
 * 「关于」页签的联系方式二维码（`lib/about/*.png`）—— 与 `WEBWALLGL_DIR` 同一套"包内资源"
 * 口径：随包发布、只读、由插件自己的路由（`lib/routes/about-qr.js`）按白名单直出。
 * README 里引用的就是这两张图（展示与插件用的是同一份字节，不另存副本）。
 */
const ABOUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'about');
/**
 * 随包字体集（F3）：`lib/fontsets/<id>.json` —— 与 `WEBWALLGL_DIR` 同一套"包内资源"口径
 * （相对本模块解析，随 `files` 发布）。**只读**：它是发布出去的字节，任何写路径都不得指向它；
 * 用户的编辑走"写时复制"落到 `pluginDataDir()/fontsets/`（见 lib/routes/fontsets.js 的文件头）。
 */
const FONTSET_BUILTIN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'fontsets');
/**
 * 随包玻璃预设：`lib/glass-presets/<id>.json` —— 与随包字体集同一套"包内资源"口径
 *（六套出厂观感，随 `files` 发布）。**只读**；用户保存的快照落
 * `pluginDataDir()/glass-presets/`（见 lib/routes/presets.js 的文件头）。
 */
const GLASS_PRESET_BUILTIN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'glass-presets');

/**
 * WE web-wallpaper API shim. Injected into web-wallpaper HTML responses by
 * /scene-files — under the strict sandbox the renderer page cannot reach into
 * the wallpaper iframe, so the shim must ride along with the document.
 *
 * The npm package does not ship the shim as a file: it is the `shimSource`
 * template literal inside `webwallgl.mjs` (the same text the engine injects on
 * its own fetch-and-rewrite path), so it is extracted from there. Read once and
 * cached; an absent package or a changed bundle shape degrades silently (the
 * wallpaper still runs, just without the WE API surface).
 */
let webShimCache;
function cookTemplateLiteral(raw) {
  const simple = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };
  return raw.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|\r\n|[\s\S])/g, (_, e) => {
    if (e[0] === 'u' && e.length > 1) return String.fromCodePoint(parseInt(e[1] === '{' ? e.slice(2, -1) : e.slice(1), 16));
    if (e[0] === 'x' && e.length === 3) return String.fromCharCode(parseInt(e.slice(1), 16));
    if (e === '\n' || e === '\r\n' || e === '\r') return '';
    return e in simple ? simple[e] : e;
  });
}
function extractWebShim(bundle) {
  const m = /const shimSource = \x60((?:\\[\s\S]|[^\x60\\])*)\x60;/.exec(bundle);
  return m && !/(^|[^\\])\$\{/.test(m[1]) ? cookTemplateLiteral(m[1]) : '';
}
function readWebShim() {
  if (webShimCache !== undefined) return webShimCache;
  try {
    webShimCache = WEBWALLGL_PKG_DIR ? extractWebShim(readFileSync(join(WEBWALLGL_PKG_DIR, 'webwallgl.mjs'), 'utf8')) : '';
  } catch {
    webShimCache = '';
  }
  return webShimCache;
}

/**
 * Build the user-property SEED script for a web wallpaper from the
 * project.json sitting next to its entry file — the same payload WallpaperEM's
 * /web/ middleware writes into the HTML.
 *
 * Why the HOST must do it: workshop web wallpapers read their defaults (colors,
 * line density, …) through `wallpaperPropertyListener.applyUserProperties`,
 * which only ever runs if someone calls the shim's `__weSeedProps`. WallpaperEM
 * injects the seed while rewriting the HTML; our strict-sandbox path serves the
 * original HTML (no rewrite) AND the renderer page cannot reach into the
 * cross-origin iframe at runtime to push props — so without this the wallpaper
 * silently falls back to its own defaults, which for property-driven wallpapers
 * means a black frame (measured: Chroma Drencher draws all-black lines).
 */
/** 某张壁纸的用户覆盖值（「壁纸属性」面板改过的）：{ [属性名]: 值 }，键是 token。 */
function userPropsFor(token) {
  try {
    const all = readSettings()?.userProps;
    const v = all && typeof all === 'object' ? all[String(token)] : null;
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function buildSeedScript(entryAbs, token) {
  try {
    const pj = JSON.parse(readFileSync(join(dirname(entryAbs), 'project.json'), 'utf8'));
    // 默认值 + 用户覆盖值（面板里改过的属性要随文档到达，否则壁纸会先用默认值
    // 画一帧再被纠正 —— 属性驱动的壁纸会出现可见跳变）。file 类值按入口所在
    // 目录补前缀（网页壁纸相对入口 URL 解析，与上游 effectiveProps 同语义）。
    const overrides = userPropsFor(token);
    const defs = parseUserPropDefs(pj, overrides, {
      filePrefix: entryDirPrefix(String((pj && pj.file) || '')),
    });
    const wire = {};
    for (const d of defs) {
      if (d.value === null) continue;
      wire[d.name] = { value: d.value };
    }
    if (!Object.keys(wire).length) return '';
    return `window.__weSeedProps(${JSON.stringify(wire)});`;
  } catch {
    return '';
  }
}
/** Async existence probes (fs.promises — thread pool, no event-loop blocking). */
async function pathExistsP(p) {
  try { await access(p); return true; } catch { return false; }
}
async function isDirectoryP(p) {
  try { return (await stat(p)).isDirectory(); } catch { return false; }
}
/** 异步取 mtime (ms); 不存在/读不到返回 null — 兼作存在性探测 (sceneVideo 缓存键)。 */
async function mtimeOrNullP(p) {
  try { return (await stat(p)).mtimeMs; } catch { return null; }
}
async function isFileP(p) {
  try { return (await stat(p)).isFile(); } catch { return false; }
}

/**
 * Steam / Wallpaper Engine 安装探测套件（见 lib/steam-discovery.js 文件头的不变量）。
 * 只注入 appid 与 pathExistsP —— 四个路径谓词留在本文件：它们被壁纸扫描套件、上传/缓存
 * 目录族共用，不是 Steam 专用。
 */
const { locateWallpaperEngineP, owningLibrariesP } = createSteamDiscoveryKit({ WE_APPID, pathExistsP });
/**
 * 壁纸扫描套件（见 lib/wallpaper-scan.js 文件头）：扫描根推导 / 扫描签名 /
 * project.json 解析 / 播放列表。四个注入项都是宿主已有实现 —— 三个 path 探测
 * 与 Steam 安装探测族同源，appid 是 workshop 路径的一部分。
 */
const {
  extOf, readProjectP, resolveSceneMainFileP, SCAN_CHUNK, scanSignatureP,
  enumerateWallpapersAsync, pathKey, readPlaylistsP, playlistItemId,
} = createWallpaperScanKit({ WE_APPID, pathExistsP, isFileP, isDirectoryP });

// ── Custom uploads (read-A storage: files live on disk in a plugin-managed
//    directory, served through the SAME token/media/preview routes as the
//    Wallpaper Engine media — no IndexedDB, no quota limits, survives
//    restarts by construction). ──────────────────────────────────────────────
/**
 * 插件数据目录（设置 / 抽屉抽帧 / 诊断落盘都在这里）。
 * 默认 `~/.dsh-wallpaper-engine`；`DSH_WE_DATA_DIR` 可把它整体挪走 —— 自检脚本
 * 会 PUT 设置，绝不能写用户真实的那份 config.json（与 DSH_WE_UPLOAD_DIR /
 * DSH_WE_CACHE_DIR 同一套测试隔离约定）。不设该变量时路径与从前完全一致。
 *
 * ⚠️ **跨插件读契约（dsh-skins 的首屏预判，issue #51）**：皮肤中心在**出文档之前**同步读
 *   `<该目录>/config.json` 的 `settings.id` —— 非空 ⇒ 视为"壁纸在台"，那一屏首帧不画皮肤、
 *   等壁纸接管（空 / 缺失 / JSON 坏一律 fail-open 向皮肤一侧）。所以下面三样都是**双边契约**，
 *   任何一侧单独改都会把首帧预判打回"皮肤先闪一下"：环境变量名 `DSH_WE_DATA_DIR`、
 *   文件名 `config.json`、键 `settings.id`（由 `serializeSettings` 无条件写出）。判据在
 *   test/verify-client.mjs 的互操作一节（含负对照）。
 */
function pluginDataDir() {
  const override = process.env.DSH_WE_DATA_DIR;
  return override && override.trim() ? resolve(override.trim()) : join(homedir(), '.dsh-wallpaper-engine');
}

/** Config file that remembers the user-chosen upload directory. */
function configPath() { return join(pluginDataDir(), 'config.json'); }

/**
 * 缓存**根**目录 —— 所有可再生产的大块产物都在这下面各占一个子目录：
 * `transcodes/`（重编码输出，每个 80–280MB）、`faststart/`（moov 搬家变体，100MB–1GB）、
 * `frames/`（场景抓帧 / 内嵌视频 / 包内音频）、`video-previews/`（缩略图）、
 * `media-bridge/`、`artwork/`。实测这几样合起来能吃掉几个 GB，也是「C 盘洁癖」的
 * 真正触发点（设置 / 头像 / 字体那些小文件挪不挪都无所谓）。
 *
 * 解析顺序：`DSH_WE_CACHE_DIR` → `config.json` 根字段 `cacheDir` → `<数据目录>/cache`。
 * 中间那一层就是设置页「高级 → 缓存位置」写的东西（POST /cache-dir，落盘 ⇒ 重启后仍在，
 * 用户不需要碰任何环境变量）。
 *
 * ⚠️ 两个不变量，改这里之前先读：
 *   ① **每次现读 config**（刻意不 memoize）：设置页改完立刻生效，且绝不会把新产物写回旧
 *      目录 —— 与 `pluginDataDir()` 同一条纪律。一次 readConfig 是几 KB 的同步读，而调用点
 *      都在请求 / 任务级（不是逐像素），代价可忽略。
 *   ② **本函数返回的是"根"**：`DSH_WE_CACHE_DIR` 早期只被帧缓存读、且被当作**帧目录本身**
 *      使用（不追加 `frames/`）。面向用户的 `cacheDir` 落地时统一成"根"这**一种**语义，
 *      两个入口不再各说各话（判据见 test/verify-cache-dir.mjs 的语义一节）。
 */
function cacheBaseDir() {
  const env = process.env.DSH_WE_CACHE_DIR;
  if (env && env.trim()) return normalize(env.trim());
  const cfg = readConfig();
  if (typeof cfg.cacheDir === 'string' && cfg.cacheDir.trim()) {
    // 用户手写进 config.json 的值同样过一遍校验：坏值（相对路径 / 控制字符）当作没配，
    // 落回默认 —— 宁可缓存继续放老地方，也不许把它写到 cwd 或半个路径上去。
    const dir = normalizeUserDir(cfg.cacheDir);
    if (dir) return dir;
  }
  return join(pluginDataDir(), 'cache');
}

/**
 * 本仓的 GitHub `owner/repo`（star 数那条路由的入参）—— **从 package.json 现读**，
 * 不另写一份字面量：仓库地址在 package.json 与 README 里已经各有一份，插件再抄一份
 * 就会在改地址时漏改一处（而那一处只在"关于页数字不更新"时才被发现）。
 * 解析不出来就返回空串 ⇒ 路由回 `ok:false`、关于页不显示数字（静默降级，不炸）。
 */
function repoSlugFromPkg() {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const url = String((pkg.repository && pkg.repository.url) || '');
    const m = url.match(/github\.com[/:]([^/\s]+\/[^/\s]+?)(?:\.git)?$/i);
    return m ? m[1] : '';
  } catch { return ''; }
}

/**
 * 配置存储套件（见 lib/config-store.js 文件头的不变量）：只注入 configPath。
 * pluginDataDir / configPath / cacheBaseDir / repoSlugFromPkg 留在本文件 —— 它们带着
 * verify-client、verify-cache-dir、verify-about 的文本锚点（数据目录覆盖、config.json 落点、
 * cacheBaseDir() 的三个子目录、GitHub 仓库地址正则）。
 */
const {
  readConfig, writeConfig, readSettings, writeSettings, SETTINGS_FIELD,
  atomicWriteFileSync, atomicWriteFileP, atomicTmpPath, enqueueConfigWrite,
} = createConfigStoreKit({ configPath });
// ── 字体集（`fontsets/<id>.json`）的目录与活动 id ────────────────────────
/** 字体集目录。走 `pluginDataDir()`（认 `DSH_WE_DATA_DIR`）⇒ 守卫能整体隔离，绝不写真目录。 */
function fontSetsDir() { return join(pluginDataDir(), 'fontsets'); }

/** 玻璃预设的用户层目录（可写）。走 `pluginDataDir()` ⇒ 守卫能整体隔离，绝不写真目录。 */
function glassPresetsDir() { return join(pluginDataDir(), 'glass-presets'); }

/**
 * 活动字体集 id —— `config.json` 的**根字段**（不在 settings 的键集里，因此不经 PUT /settings
 * 改写）。空串 = "还没有迁到字体集"（路由族据此做一次性迁移）。
 */
function readFontSetId() {
  const v = readConfig().fontSetId;
  return isFontSetId(v) ? v : '';
}

/**
 * 记下活动字体集 id。**必须**与 settings / uploadDir 走同一条写串行化队列：三者都是
 * config.json 的"读-改-写"，并发时会用一个旧快照吞掉另一方的改动。
 */
function setFontSetId(id) {
  if (!isFontSetId(id)) return Promise.reject(new Error('fontsets: invalid id ' + String(id)));
  return enqueueConfigWrite(() => {
    const cfg = readConfig();
    cfg.fontSetId = id;
    writeConfig(cfg);
    return id;
  });
}

/**
 * 迁移落定：**一次** config 写入同时做两件事 —— 记下活动 id、并把内联的六个
 * 字体键从 `settings` 里摘掉（D1：迁移之后 config.json 只留 `{ fontSetId, fontCustom }`）。
 * 分两次写会留下"id 已记、内联值还在"的中间态；写成一次就没有那个窗口。
 */
function commitFontSetMigration(id) {
  if (!isFontSetId(id)) return Promise.reject(new Error('fontsets: invalid id ' + String(id)));
  return enqueueConfigWrite(() => {
    const cfg = readConfig();
    cfg.fontSetId = id;
    const prev = cfg[SETTINGS_FIELD];
    if (prev && typeof prev === 'object') {
      // 过一遍宿主消毒即等于"按当前白名单重写" —— 字体键与 DEFAULTS_ONLY 一并落掉。
      cfg[SETTINGS_FIELD] = sanitizeFromSchema(prev, 'host') || prev;
    }
    writeConfig(cfg);
    return id;
  });
}

/**
 * 迁移前的护栏：字体值还没有自己的家（`fontSetId` 为空）时，**任何** settings
 * 写入都不得把它们抹掉 —— 否则用户随便改个别的设置（例如拖一下模糊）就会静默带走自定义的
 * 字体外观。值的来源是**磁盘上那份 config.json**，不是这次 PUT 的 body：新客户端的 body 已经
 * 不带这些键了，从 body 取等于没护栏。
 * 一旦迁移落定（`fontSetId` 非空）本函数即失效 —— 这条护栏自己终止，不留常驻的双写。
 */
function withLegacyFontValues(next) {
  if (readFontSetId()) return next;
  const prev = readSettings();
  if (!prev || typeof prev !== 'object') return next;
  const legacy = sanitizeFontset(prev);
  const out = Object.assign({}, next);
  for (const key of FONTSET_KEYS) if (key in prev) out[key] = legacy[key];
  return out;
}

// dsh-better-sidebar 安装检测：遍历 cordis loader 的条目树（ctx.loader 是根
// EntryTree，entries() 覆盖所有嵌套子树），找 dsh-better-sidebar 且未禁用的
// 条目。用它决定浏览器端的「侧栏玻璃」控制组是否显示 —— 不依赖侧栏 DOM 是否
// 已挂载（侧栏懒加载，DOM 探测会漏判），也不依赖其服务 API（版本间不稳定）。
// 注意 Entry 本身没有 name getter：包名在 entry.options.name（patch 行的 name
// 字段，即 import 说明符）；聚合包挂载时条目 id 可能是 web-ui-better-sidebar
// 之类，故 id 含 better-sidebar 也视为命中。loader 服务随 dsh-base 提供，
// 读不到时按「未安装」处理。
function isBetterSidebarLoaded(ctx) {
  try {
    const loader = ctx && ctx.loader;
    if (!loader || typeof loader.entries !== 'function') return false;
    for (const entry of loader.entries()) {
      const opts = entry && entry.options;
      if (!opts || opts.group) continue; // group 节点跳过
      const isSidebar = opts.name === 'dsh-better-sidebar'
        || String(opts.id || '').includes('better-sidebar');
      if (isSidebar && !entry.disabled) return true;
    }
  } catch { /* loader unavailable (headless/embed contexts): treat as absent */ }
  return false;
}

// 设置规范化入口。白名单/范围/默认值全部来自 lib/settings-schema.js（唯一真源）——
// 在这里另写一份镜像就要与客户端各写一遍，漏键即静默丢弃。
// 宿主侧不收 CLIENT_ONLY 的键（设备本地记忆），非对象输入返回 null 由调用方判空。
function sanitizeSettings(raw) {
  return sanitizeFromSchema(raw, 'host');
}

function transcodeCacheDir() {
  return join(cacheBaseDir(), 'transcodes');
}

// 目录创建记忆化：recursive mkdirSync 每次都要走一串同步 syscall（逐层
// stat），而 ensure*Dir 都在请求热路径上。同一路径只 mkdir 一次。
const ensuredDirs = new Set();
function ensureDirOnce(dir) {
  if (!ensuredDirs.has(dir)) {
    try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
    ensuredDirs.add(dir);
  }
  return dir;
}

// ── 抽帧转码套件（实现见 lib/transcode.js）─────────────────────────────────
// 只注入四个宿主侧的名字：configPath（ffmpeg 缓存根 = dirname(configPath())/ffmpeg）、
// 转码缓存目录、目录创建记忆化、原子临时名。留在本文件的名字都是**共享基础设施**：
// `transcodeCacheDir` 被 test/verify-cache-dir.mjs 按 `join(cacheBaseDir(), 'transcodes')`
// 钉住；`ensuredDirs`/`ensureDirOnce` 被上传目录/自定义画面/头像共用；`atomicTmpPath`
// 属于 config-store 的原子写实现（同一进程内序号，避免两套临时名）。
// `transcodeCacheKey` 不在这里解构 —— 它只在 transcode.js 内部被落盘与只读判定共用。
const {
  transcodeToFps, registerTranscodeWaiter, transcodeJobs,
  transcodeCachePathFor, resolveFfmpeg, spawnFfmpeg, ffmpegDataDir, disposeTranscodes,
} = createTranscodeKit({ configPath, transcodeCacheDir, ensureDirOnce, atomicTmpPath });

// ── 本机目录与导入素材（实现见 lib/asset-paths.js）：上传目录解析、上传/自定义画面 MIME 与
//    体积上限、头像与立绘族、自动首帧目录、WE 官方素材目录与清单。`UPLOAD_DIR` 本身留在本模块
//    （加载期解析 + `setUploadDir` 运行期改写），其余都是套件产物。
const {
  resolveUploadDir,
  UPLOAD_EXT, CUSTOM_FRAME_EXT, CUSTOM_FRAME_MAX_BYTES, customFrameDir,
  AVATAR_EXT, AVATAR_MAX_BYTES, AVATAR_SIDES, avatarDir, avatarPath,
  MASCOT_EXT, MASCOT_MAX_BYTES, mascotDir, mascotPath, liveFrameDir,
  WE_ASSETS_SOURCE_ID, weAssetsAvailable, getWeAssetsDir, setWeAssetsDir,
  listWeAssetNames,
} = createAssetPathsKit({ pluginDataDir, ensureDirOnce, readConfig, writeConfig, enqueueConfigWrite });


let UPLOAD_DIR = resolveUploadDir();

/**
 * 取**当前**上传目录的访问器（**不是**值快照）。给 `lib/inventory.js` 用：
 * `UPLOAD_DIR` 是可变模块状态（`setUploadDir` 会改写它）⇒ 若把值传进 `c`，
 * 用户刚改完上传目录、清单却仍列旧目录。此处与 `getWeAssetsDir` 同形。
 */
function getUploadDir() { return UPLOAD_DIR; }


/**
 * 帧缓存目录（插件托管，与 config/uploads 同一个数据目录）。这里存三类产物、
 * 各有自己的键前缀：实时抓帧（`<LIVE_FRAME_KEY_VERSION>_…_gpu.png`）、场景内嵌视频
 * （`sv1_*.mp4`）与场景包内音频（`sa1_*`）。键里带入口路径的 base64url + mtime，
 * 所以工坊更新会让旧产物自然失效。
 *
 * 目录取 `cacheBaseDir()/frames`（⇒ `DSH_WE_CACHE_DIR` 与设置页的 `cacheDir` 都作数，
 * 后者是用户可见的那条路）。**`DSH_WE_CACHE_DIR` 是"根"不是"帧目录本身"** —— 这个语义
 * 与早期版本不同（那时它被直接当帧目录用），统一的原因与判据见 `cacheBaseDir()` 的第 ② 条。
 */
function frameCacheDir() {
  return join(cacheBaseDir(), 'frames');
}
function ensureFrameCacheDir() {
  return ensureDirOnce(frameCacheDir());
}

/**
 * 静态帧缓存键：`<逻辑版本>_<入口绝对路径 base64url>_<mtime>`（可选 `_vN` 档位后缀）。
 *
 * 不变量：
 *   ① **只能有一处实现** —— 本函数是帧缓存键的唯一构造点，只由 `sceneFrameSlot` 调用；
 *      写帧的 GPU 抓帧回填与读帧的 `/scene-frame` 路由都必须经它，各写一份会出现
 *      "一边写一边读不着"（产物永不被服务，白烧 CPU）。
 *      注：同目录下的 `sv1_`（场景视频）与 `sa1_`（场景音频）是**另两个命名空间**，各有自己的
 *      构造点，不共用本条键。
 *   ② **渲染逻辑一改，版本前缀必须 bump**（见下方 `LIVE_FRAME_KEY_VERSION`）——
 *      否则旧前缀下的坏帧被继续复用，或产物写进旧键、读取走新键（"改了却没生效"）。
 *   任何触及渲染/提取产物的改动，都要同时检查：本常量、所有键构造点、缓存清理。
 */
const LIVE_FRAME_KEY_VERSION = 'lf1';
function sceneFrameCacheKey(abs, mtime) {
  return LIVE_FRAME_KEY_VERSION + '_' + Buffer.from(abs, 'utf8').toString('base64url') + '_' + Math.round(mtime);
}

// scene-frame 缓存槽位解析（GET / HEAD / GPU 回填 PUT 共用）：key =
// <LIVE_FRAME_KEY_VERSION>_<base64url(abs)>_<mtime>。
// 唯一产物是实时抓帧 <key>_gpu.png —— 文件名即标记：存在 = 该槽已被 live
// 渲染抓帧覆盖，且可直接双击打开查看。
//
// **每壁纸一张主帧**（`<key>_gpu.png`，单槽）+ **面积升级制**。
// 多窗口时代单槽的病根是"互相清写"——A 窗把 B 窗的帧当成"旧视口的构图"删掉重抓。
// 现行规则把"写"收紧成**只升不降**，问题从机制上消失：
//   · 客户端探测（HEAD 拿 X-WE-GPU-W/H）：主帧**面积 ≥ 我的画布**（容差 5%）⇒
//     保留，显示侧 CSS cover 缩小——大帧缩小无损失；
//   · 主帧比我的画布小 ⇒ 抓一张**我的尺寸**的帧 PUT 覆盖（升级，一次写）；
//   · 宿主 PUT 侧再做一道**面积守卫**（第二保险）：来帧面积 < 盘上主帧 × 0.95 ⇒
//     409 拒写——就算两个窗口竞态，小帧也永远覆盖不掉大帧（"乒乓"的最后半步
//     也被堵死）。等面积覆盖放行：那是「重新截」在换内容，不是降级。
// 写入次数 = 主帧面积单调升级的次数（带容差 ⇒ 个位数封顶）；磁盘每壁纸恒定 1 帧；
// 频繁调整窗口大小不再产生任何写入（形状变小根本不触发抓帧）。
// 键**只有一处构造点**（sceneFrameCacheKey）：两处各自拼字面量时，升键只改一处
// 就会让写盘产物与读取路径错位。
function sceneFrameSlot(abs) {
  let mtime = 0;
  try { mtime = statSync(abs).mtimeMs; } catch { /* keep 0 */ }
  const key = sceneFrameCacheKey(abs, mtime);
  const dir = ensureFrameCacheDir();
  return {
    key,
    // P4-16 守卫按顶层逗号数计字段：这里的字面量不许带尾逗号（4 字段假阳性的教训）。
    gpuPath: join(dir, key + '_gpu.png')
  };
}
// GPU 抓帧优先于自定义画面：`_gpu.png` 是真实渲染帧。
// ⚠️ 档位值域是 `{0, 4}`（其余值由路由 clamp 到 0），而**档 4 的豁免由调用方判定**
//（`lib/routes/scene-frame.js` 的 `variant === 4 ? null : gpuFrameFileFor(...)`）：
// 豁免了就不该再解析槽位 —— 那正是上面说的那次白工。本函数因此只回答
// "这个槽有没有抓帧"，不承担档位语义。
function gpuFrameFileFor(slot) {
  return existsSync(slot.gpuPath) ? slot.gpuPath : null;
}
// 主帧升级判定的面积容差：主帧面积 ≥ 来帧 × (1-TOL) 即视为"不比来帧小"。
// 5% ≈ 一侧分辨率差半档（如 1920×1080 vs 1855×1043）——既容忍两个相近窗口的
// 测量抖动，又不至于让明显更小的帧顶掉大帧。
const GPU_FRAME_AREA_TOL = 0.05;
// GPU 抓帧回填载荷上限（4K PNG 一般数 MB，32MB 余量充足）。
const GPU_FRAME_MAX_BYTES = 32 * 1024 * 1024;
// 最小结构校验：只认 8 字节魔数会让「9 字节假 PNG」永久占槽（PUT 200 落盘、
// 浏览器解不出、之后恒 409），因此额外要求长度下限 + IHDR + IEND。
const GPU_FRAME_MIN_BYTES = 1024;
function looksLikePng(body) {
  if (body.length < GPU_FRAME_MIN_BYTES) return false;
  const sig = body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47
    && body[4] === 0x0d && body[5] === 0x0a && body[6] === 0x1a && body[7] === 0x0a;
  if (!sig) return false;
  if (body.toString('latin1', 12, 16) !== 'IHDR') return false;
  // IEND 是最后一个 chunk：长度(4)=0 + 'IEND' + CRC(4) → 'IEND' 落在末尾 8..4。
  return body.toString('latin1', body.length - 8, body.length - 4) === 'IEND';
}
// 同 key 写入串行化：唯一性闸（existsSync → 写）必须在同一临界区内，否则
// 并发 PUT 会双双通过（实测：两个 24MB PUT 都返回 200）。
const GPU_WRITE_INFLIGHT = new Map();
// GPU 抓帧的几何信息：PNG 的 IHDR 就是抓帧画布的**设备像素**尺寸，其宽高比
// = 抓帧那一刻渲染页的视口比。渲染器按画布比取景（与设计比 2% 内 → 整张设计
// 上屏，否则按画布比 cover 裁切），所以「在别的窗口抓的帧」是**另一种构图**，
// 拿到当前窗口上屏会再被 CSS object-fit: cover 裁一次 → 画面明显放大。客户端
// 靠这个头判断存帧配不配当前视口（不符就清掉重抓）。只读文件头 33 字节。
function pngSizeOf(file) {
  let fd = -1;
  try {
    fd = openSync(file, 'r');
    const headBuf = Buffer.alloc(33);
    if (readSync(fd, headBuf, 0, 33, 0) < 33) return null;
    if (headBuf.toString('latin1', 12, 16) !== 'IHDR') return null;
    const width = headBuf.readUInt32BE(16);
    const height = headBuf.readUInt32BE(20);
    if (!(width > 0) || !(height > 0)) return null;
    return { width, height };
  } catch {
    return null; // 读不到就不发这个头：客户端按「几何未知」保守处理
  } finally {
    if (fd >= 0) { try { closeSync(fd); } catch { /* ignore */ } }
  }
}
// 同 `pngSizeOf`，但直接解析**内存里的 PNG 字节**（PUT 在落盘前就要从 IHDR 拿
// 几何做面积守卫判定 —— 落盘再读回是多余的 I/O）。结构由 `looksLikePng` 先行
// 保证（IHDR 在 12..16、宽高在 16..24）；这里仍自校验，坏输入返回 null ⇒ 调用方
// 按 415 拒写，绝不给无几何的字节落盘。
function pngDimsOfBuf(buf) {
  try {
    if (!buf || buf.length < 24) return null;
    if (buf.toString('latin1', 12, 16) !== 'IHDR') return null;
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    if (!(width > 0) || !(height > 0)) return null;
    return { width, height };
  } catch {
    return null;
  }
}

// ── Custom-upload video thumbnails (on-demand ffmpeg frame) ──────────────────
// An image upload serves itself as its preview, but an MP4 upload has no
// preview file, so the picker would show the "无预览" placeholder. Extract
// one frame lazily — only when the browser actually requests the thumbnail —
// through the same ffmpeg provisioning chain the transcode path uses.
const VIDEO_PREVIEW_WIDTH = 960;
// The picker requests one thumbnail per video card; without a gate, opening it
// would spawn one ffmpeg per upload. Thumbnails are short jobs, so keep them on
// their own small gate instead of queueing behind a 15-minute transcode.
const VIDEO_PREVIEW_MAX_CONCURRENT = 2;

/** Thumbnail cache dir, under the same cache root as transcodes/frames. */
function videoPreviewCacheDir() {
  return join(cacheBaseDir(), 'video-previews');
}
function ensureVideoPreviewCacheDir() {
  return ensureDirOnce(videoPreviewCacheDir());
}

// 视频缩略图生成套件（同键合流 + 缓存键 + 并发闸）—— 见 lib/video-preview.js 文件头。
// `videoPreviewCacheDir()` 仍在本模块：test/verify-cache-dir.mjs 的 D1 钉它的字面量。
const { generateVideoPreview } = createVideoPreviewKit({
  ensureVideoPreviewCacheDir, resolveFfmpeg, spawnFfmpeg,
  VIDEO_PREVIEW_WIDTH, VIDEO_PREVIEW_MAX_CONCURRENT,
});

/**
 * 缓存清扫套件（见 lib/cache-prune.js 文件头的不变量）：孤儿产物清扫 + 两类容量上限。
 * 三个目录解析器由宿主注入 —— 它们的根都是 cacheBaseDir()，锚在这里才能被
 * test/verify-cache-dir.mjs 的 D1（join(cacheBaseDir(), 'transcodes'|'video-previews')）看住。
 */
const {
  sweepTranscodeArtifacts, sweepCustomFrameTmp, pruneVideoPreviewCache,
  pruneCacheDirBySize, TRANSCODE_CACHE_MAX_BYTES,
} = createCachePruneKit({ transcodeCacheDir, ffmpegDataDir, videoPreviewCacheDir });


// 诊断落盘（实现见 lib/host-diag.js）：appendDiagLine 注入各路由族与套件；
// traceRequests 注入字节族；foldTokenPath 供留在本文件的 traceMediaRequests 折叠长路径。
const { appendDiagLine, traceRequests, foldTokenPath } = createHostDiagKit({ configPath });
/**
 * 媒体源（独立 loopback 源）的请求记录：只记**文档型请求**与**错误响应**。
 * 网页壁纸的子资源动辄上百个，全量落盘会把诊断环冲掉；而排查黑屏真正需要的判据
 * 只有两条：壁纸入口到底有没有被请求到、有没有被拒绝。
 */
function traceMediaRequests(req, res, pathKey) {
  try {
    const key = foldTokenPath(pathKey);
    const tail = key.split('/').pop() || '';
    const isDoc = tail === '' || /\.html?$/i.test(tail) || !/\.[a-z0-9]{1,8}$/i.test(tail);
    res.on('finish', () => {
      const status = res.statusCode || 0;
      if (!isDoc && status < 400) return;
      appendDiagLine('req', {
        route: 'scene-files@media',
        path: key,
        status,
        dest: String(req.headers['sec-fetch-dest'] || ''),
      });
    });
  } catch { /* 诊断失败不影响服务 */ }
}

/** 缓存文件路径（按入口文件 id）；不做有效性判断，mtime 校验在读取处做。 */
function liveFrameFile(abs) { return join(liveFrameDir(), customIdFromAbs(abs) + '.jpg'); }

function customIdFromAbs(abs) {
  const m = /431960[\\/]([^\\/]+)[\\/]/.exec(String(abs));
  if (m) return m[1];
  return Buffer.from(String(abs), 'utf8').toString('base64url').slice(0, 48);
}
function customFramePath(id) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(id))) return null;
  for (const ext of ['png', 'jpg', 'webp']) {
    const p = join(customFrameDir(), String(id) + '.' + ext);
    if (existsSync(p)) return p;
  }
  return null;
}
function listCustomFrameIds() {
  const ids = new Set();
  try {
    for (const f of readdirSync(customFrameDir())) {
      const m = /^([A-Za-z0-9_-]{1,64})\.(png|jpg|webp)$/.exec(f);
      if (m) ids.add(m[1]);
    }
  } catch { /* empty dir */ }
  return ids;
}
/** Upload size cap: 512 MB (a single wallpaper video). */
const UPLOAD_MAX_BYTES = 512 * 1024 * 1024;
/** Uploaded-file name pattern: `<up-id>.<ext>` (group 1 = id, group 2 = ext). */
const UPLOAD_FILE_RE = /^(up-[a-z0-9-]+)\.(mp4|jpg|jpeg|png)$/i;
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
const CONTROL_JSON_MAX_BYTES = 64 * 1024;


// 上传元数据账本（.meta.json 的读改写 + 预览候选名）—— 实现见 lib/upload-store.js 文件头。
// `UPLOAD_DIR` 本身仍归本模块：加载期解析（env 在 import 前设好）且 `setUploadDir` 运行期改写。
const {
  ensureUploadDir, readUploadMeta, metaEntry, setUploadMeta, removeUploadMeta, PREVIEW_CANDIDATES,
} = createUploadStoreKit({
  getUploadDir: () => UPLOAD_DIR, ensureDirOnce, enqueueConfigWrite, atomicWriteFileSync,
});

/**
 * Scan the uploads dir → WE-shaped wallpaper entries. Two shapes are
 * recognized:
 *   1. single media files named `up-*` (the plugin's own uploads), and
 *   2. WE project directories containing project.json (scene.pkg / scene.json /
 *      index.html / *.mp4) — the layout a WallpaperEM-style downloads folder
 *      has. The old scanner only knew shape 1, so pointing 存储位置 at such a
 *      folder found none of its scene wallpapers.
 */
async function enumerateUploadsP(dir) {
  if (!(await pathExistsP(dir))) return [];
  let entries;
  try { entries = await readdir(dir); } catch { return []; }
  const files = [];
  const dirs = [];
  for (const entry of entries) {
    if (!entry || entry.startsWith('.')) continue;
    const abs = join(dir, entry);
    let st; try { st = await stat(abs); } catch { continue; }
    if (st.isFile()) {
      const m = UPLOAD_FILE_RE.exec(entry);
      if (!m) continue;
      const ext = m[2].toLowerCase();
      const id = m[1];
      const type = ext === 'mp4' ? 'video' : 'image';
      files.push({ id, type, fileAbs: abs, previewAbs: type === 'image' ? abs : null });
    } else if (st.isDirectory()) {
      dirs.push({ name: entry, abs });
    }
  }
  // WE project directories, chunked: each needs a project.json read plus a few
  // existence probes, and a downloads folder can hold hundreds — unbounded
  // fan-out would swamp the libuv pool (same SCAN_CHUNK discipline as the
  // Steam scan).
  const projects = [];
  for (let i = 0; i < dirs.length; i += SCAN_CHUNK) {
    const chunk = dirs.slice(i, i + SCAN_CHUNK);
    const hits = await Promise.all(chunk.map(async ({ name, abs }) => {
      const proj = await readProjectP(abs);
      if (!proj || proj.type === 'application') return null;
      // Scenes: resolve the real container — project.json frequently declares
      // scene.json while only scene.pkg ships (same probe as the Steam scan).
      const fileAbs = proj.type === 'scene'
        ? resolve(abs, (await resolveSceneMainFileP(abs, proj.file)) || proj.file)
        : resolve(abs, proj.file);
      if (!(await pathExistsP(fileAbs))) return null; // main file missing → unusable
      let previewAbs = proj.preview ? resolve(abs, proj.preview) : null;
      if (previewAbs && !(await pathExistsP(previewAbs))) previewAbs = null;
      if (!previewAbs) {
        for (const cand of PREVIEW_CANDIDATES) {
          const p = join(abs, cand);
          if (await pathExistsP(p)) { previewAbs = p; break; }
        }
      }
      return {
        // `up-dir-` keeps project directories under the same "user's own
        // content" umbrella as `up-*` uploads (ratingOf treats both as
        // Everyone when the rating is missing) while staying out of the upload
        // management list: /remove resolves only `up-*.ext` files, so a
        // directory can never be deleted from the picker by accident.
        id: `up-dir-${name}`,
        title: proj.title || name,
        type: proj.type,
        fileAbs,
        previewAbs,
        contentrating: proj.contentrating,
        // 作者配色必须透传：目录形态的上传走这条分支（自定义存储目录里的工程全在这个
        // 名单里），漏掉它 = 「主题随壁纸」的优先级① 对这些壁纸永不生效，只能退到
        // 画面主色 —— 实测就是这么把一张作者标了 0 0 0 的暗色壁纸判成浅色的。
        schemeColor: proj.schemeColor,
      };
    }));
    for (const hit of hits) if (hit) projects.push(hit);
  }
  const out = [...files, ...projects];
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/** Resolve an upload id to its file path inside the uploads dir, or null. */
function resolveUploadFile(dir, id) {
  if (typeof id !== 'string' || !/^up-[a-z0-9-]+$/.test(id)) return null;
  const root = normalize(dir);
  try {
    for (const entry of readdirSync(dir)) {
      const m = UPLOAD_FILE_RE.exec(entry);
      if (m && m[1].toLowerCase() === id.toLowerCase()) {
        const abs = normalize(join(dir, entry));
        // Containment check that is NOT tied to the Windows separator: the old
        // `abs.startsWith(root + '\\')` never matched on macOS/Linux (where
        // normalize yields '/'), so removing (and deduping) uploads always
        // failed with "invalid upload id" there. path.relative is separator-
        // agnostic AND survives edge roots (uploads dir = '/' or a drive root,
        // where naive separator concatenation also breaks).
        const rel = relative(root, abs);
        if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return abs; // stays inside uploads dir
      }
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Validate + normalize a user-supplied upload-directory string. Accepts an
 * absolute path (Windows drive / UNC / POSIX) with optional `~` for the home
 * directory; strips surrounding quotes. Returns null when invalid.
 */
function normalizeUserDir(raw) {
  if (typeof raw !== 'string') return null;
  let dir = raw.trim().replace(/^["']|["']$/g, '');
  if (!dir) return null;
  if (dir === '~' || dir.startsWith('~\\') || dir.startsWith('~/')) {
    dir = join(homedir(), dir.slice(1));
  }
  if (/[\u0000-\u001f]/.test(dir)) return null; // control chars / NUL
  const isAbsolute = /^[a-zA-Z]:[\\/]/.test(dir) || /^\\\\/.test(dir) || /^\//.test(dir);
  if (!isAbsolute) return null;
  return normalize(dir);
}

/** Move a file, falling back to copy+delete when rename crosses volumes
 *  (EXDEV on Windows: C: → D: is the exact case users hit when relocating
 *  uploads off the system drive). Async variant — 大文件跨卷 copy 走线程池，
 *  不阻塞事件循环。 */
async function moveFileP(src, dst) {
  try { await renameP(src, dst); return true; } catch { /* cross-volume */ }
  try {
    await copyFileP(src, dst);
    await unlinkP(src);
    return true;
  } catch { return false; }
}

/** Switch the upload directory (persisted to config.json), migrating files.
 *  整体进 config 写队列：迁移 + uploadDir 持久化串行执行，不与 settings 的
 *  读-改-写交错。 */
function setUploadDir(newDir, migrate) {
  return enqueueConfigWrite(async () => {
    const oldDir = normalize(UPLOAD_DIR);
    const target = normalize(newDir);
    const sameDir = oldDir.toLowerCase() === target.toLowerCase();
    if (sameDir) {
      UPLOAD_DIR = target;
      return { uploadDir: target, migrated: 0, skipped: 0, same: true };
    }
    // Create the new directory first, then move files + meta (best effort).
    ensureUploadDir();
    let migrated = 0;
    let skipped = 0;
    if (migrate !== false && (await pathExistsP(oldDir))) {
      let entries;
      try { entries = await readdir(oldDir); } catch { entries = []; }
      for (const entry of entries) {
        if (entry === '.meta.json' || UPLOAD_FILE_RE.test(entry)) {
          // 逐项 await：迁移大量大文件时让出事件循环，避免一次性并发打满 IO。
          if (await moveFileP(join(oldDir, entry), join(target, entry))) migrated += 1;
          else skipped += 1;
        }
      }
    }
    // require-atomic-updates（噪声，非竞态）：`UPLOAD_DIR` 的运行期写者只有本函数，而整个函数体
    // 跑在 `enqueueConfigWrite` 的严格 promise 链里（见 `lib/config-store.js`）—— 任务串行，
    // await 期间不可能有第二个 `setUploadDir` 插进来改写它。队列语义即"整段迁移期间目录不被外人改写"。
    // eslint-disable-next-line require-atomic-updates -- 见上方注释：唯一写者在 enqueueConfigWrite 串行链内。
    UPLOAD_DIR = target;
    const cfg = readConfig();
    cfg.uploadDir = target;
    writeConfig(cfg);
    ensureUploadDir();
    return { uploadDir: target, migrated, skipped, same: false };
  });
}

/**
 * 缓存根下**已知**的子目录（`setCacheDir` 的迁移只认这些名字）。
 * 与 `cacheBaseDir()` 的文档一一对应：加一个新的缓存子目录时，这里要同时加。
 */
const CACHE_SUBDIRS = ['transcodes', 'faststart', 'frames', 'video-previews', 'media-bridge', 'artwork'];

/**
 * 递归移动一棵目录树（best effort）。返回 `{ moved, skipped }`。
 *
 * 不变量：
 *   · **绝不删除没能搬走的条目** —— 跨卷 copy 失败就留在原地（最多成为旧目录里的垃圾）。
 *     缓存全是可再生物，所以"没搬成功"的正确后果是下次重跑一遍，而不是丢用户的东西。
 *   · **不跟随符号链接**（`withFileTypes` + 只认 `isFile`/`isDirectory`，其余一律 skipped）：
 *     跟随 symlink 会把这次移动带出这棵树，指到用户别的地方去。
 *   · 逐项 `await`：几千个小文件时让出事件循环，避免一次性并发打满 IO。
 */
async function moveTreeP(src, dst) {
  let moved = 0;
  let skipped = 0;
  let entries;
  try { entries = await readdir(src, { withFileTypes: true }); } catch { return { moved, skipped }; }
  ensureDirOnce(dst);
  for (const entry of entries) {
    const from = join(src, entry.name);
    const to = join(dst, entry.name);
    if (entry.isDirectory()) {
      const sub = await moveTreeP(from, to);
      moved += sub.moved;
      skipped += sub.skipped;
    } else if (entry.isFile()) {
      if (await moveFileP(from, to)) moved += 1;
      else skipped += 1;
    } else {
      skipped += 1;
    }
  }
  return { moved, skipped };
}

/**
 * Switch the cache root (persisted to config.json as the root field `cacheDir`),
 * migrating existing cache by default. 整体进 config 写队列：迁移 + cacheDir 持久化
 * 串行执行，不与 settings / uploadDir 的读-改-写交错。
 *
 * ⚠️ 迁移**只搬 `CACHE_SUBDIRS` 里那几个名字**：目标路径可能是用户随手指的一个已有目录
 *   （D:\ 根、某个项目文件夹、甚至他的下载目录），把目标当"整棵树都归我"来 readdir 全搬
 *   会把无关文件卷进来 —— 而"指错目录等于动用户的东西"是本族最不能犯的错。搬不动也只是
 *   让他重跑一次转码，代价可接受。
 * ⚠️ 旧目录**不删**（只留下被搬空的子目录壳）：插件不替用户删目录，那由系统里自己收尾。
 */
function setCacheDir(newDir, migrate) {
  return enqueueConfigWrite(async () => {
    const oldDir = normalize(cacheBaseDir());
    const target = normalize(newDir);
    if (oldDir.toLowerCase() === target.toLowerCase()) {
      return { cacheDir: target, migrated: 0, skipped: 0, same: true };
    }
    // 先把目标建出来再搬：目标不存在时每一项都会失败并计入 skipped。
    ensureDirOnce(target);
    let migrated = 0;
    let skipped = 0;
    if (migrate !== false && (await pathExistsP(oldDir))) {
      for (const name of CACHE_SUBDIRS) {
        const from = join(oldDir, name);
        if (!(await pathExistsP(from))) continue;
        const sub = await moveTreeP(from, join(target, name));
        migrated += sub.moved;
        skipped += sub.skipped;
      }
    }
    const cfg = readConfig();
    cfg.cacheDir = target;
    writeConfig(cfg);
    return { cacheDir: target, migrated, skipped, same: false };
  });
}

// 请求体收集的 idle 超时：客户端连上后不发数据（或中途停发）会让连接永久
// 挂起，占着 socket 与路由状态。每次收到数据重置计时，60s 无数据即回调
// onTimeout（路由负责应答）并销毁请求。unref 保证计时器不拖住进程退出。
// ⚠️ 它是**最终兜底**：onTimeout 返回后无条件 destroy，**不经过 lingerClose**
//    ⇒ 这条路径的应答是尽力而为（调用点若要保证送达，应自行先应答再 lingerClose）。
const BODY_IDLE_TIMEOUT_MS = 60 * 1000;
function armBodyIdleTimeout(req, onTimeout) {
  let timer = null;
  let fired = false;
  const disarm = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const arm = () => {
    if (fired) return;
    disarm();
    timer = setTimeout(() => {
      fired = true;
      try { onTimeout(); } catch { /* ignore */ }
      try { req.destroy(); } catch { /* ignore */ }
    }, BODY_IDLE_TIMEOUT_MS);
    if (typeof timer.unref === 'function') timer.unref();
  };
  req.on('data', arm);
  req.once('end', disarm);
  req.once('close', disarm);
  arm();
  return disarm;
}

/**
 * 中途放弃一个请求体（413 / 408 / 5xx 应答**已经写出**之后）的唯一断开入口。
 *
 * 两个独立的"应答丢失"通道，都必须堵：
 *   ① 带着**未读的入站数据**关闭套接字 ⇒ RST（实测：不再排空、只挂 res 'finish'
 *      ⇒ 客户端 status=0）⇒ 要等请求体读完。
 *   ② 应答**尚未刷出**就关闭 ⇒ 写缓冲被丢掉，客户端同样只看到连接被掐断。
 *      ⚠️ `res.writableEnded` 在 res.end() 一调即为真，**不代表已刷出**；
 *      代表刷出的是 `writableFinished`（'finish' 已发出）—— 带背压时二者不同刻。
 *
 * ⇒ 顺序固定为「**请求体读完 **且** 应答刷完 → 才 destroy**」：两个条件**都**要成立。
 *   小应答（413 只有几十字节）通常**先**刷完，而请求体还剩很多没读 —— 只看应答就会在
 *   还有未读入站数据时关闭。排空最多等 LINGER_MAX_MS（客户端发满上限后停发时不能长期占住）。
 *
 * 调用点契约：**先写出应答**，然后调用本函数；**不得**再自行 req.destroy()
 * （守卫按此断言：全仓 req.destroy() 只允许出现在本函数与 idle 兜底两处）。
 */
const LINGER_MAX_MS = 5000;
function lingerClose(req, res) {
  let timer = null;
  let armed = false;
  const drop = () => {
    if (timer) { try { clearTimeout(timer); } catch { /* ignore */ } timer = null; }
    try { req.destroy(); } catch { /* ignore */ }
  };
  const armLinger = () => {
    if (armed) return; // 只武装一次：多个等待者不该叠加计时器
    armed = true;
    timer = setTimeout(drop, LINGER_MAX_MS);
    if (typeof timer.unref === 'function') timer.unref();
  };
  // 请求体读完（`end` 已发 / `complete` / 已销毁）—— 三种说法取或：不同终止路径置的不一样。
  const requestDrained = () => req.readableEnded === true || req.complete === true
    || req.destroyed === true || typeof req.once !== 'function';
  // 应答刷完（没有可等的 res 也算：调用方给的是替身）。
  const responseFlushed = () => !res || typeof res.once !== 'function' || res.writableFinished === true;
  const dropWhenBothDone = () => {
    if (requestDrained() && responseFlushed()) { drop(); return; }
    // ⚠️ `req 'close'` 也必须走同一条路：Node ≥16 在**请求完成**时就发它，不只表示"连接没了"。
    //    A/B 实测（同机各 12 次）：在这两条路径上不等应答直接 destroy ⇒ 丢 1 次应答；
    //    等应答刷完 ⇒ 0 次。
    if (!requestDrained()) {
      req.once('end', dropWhenBothDone);
      req.once('close', dropWhenBothDone);
    }
    if (!responseFlushed()) {
      res.once('finish', dropWhenBothDone);
      res.once('close', dropWhenBothDone);
    }
    armLinger();
  };
  dropWhenBothDone();
  if (!requestDrained()) { try { req.resume(); } catch { /* ignore */ } }
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
  // 版本戳：host 每次启动记录一次「加载的是哪份代码」，用于排查
  //「桌面端/CLI 到底跑的是哪个版本」（node_modules 里的 link 目标 + mtime）。
  try {
    const self = fileURLToPath(import.meta.url);
    atomicWriteFileSync(
      join(dirname(configPath()), 'build-stamp.json'),
      JSON.stringify({
        at: new Date().toISOString(),
        hostFile: self,
        hostMtime: statSync(self).mtimeMs,
      }, null, 2) + '\n',
    );
  } catch { /* 诊断用途，失败不影响加载 */ }

  const webServer = ctx.webServer;
  if (!webServer || typeof webServer.register !== 'function') {
    return () => {}; // defensive: never expected in practice
  }

  // 宿主日志的唯一入口（三档 + 终端镜像，见 lib/log.js 的文件头）。平台侧取一个具名
  // logger，这样 Desktop 的运行日志里每行都带 `[wallpaper-engine]`，而不是只有 fiber 名。
  const log = createLog(
    typeof ctx.logger === 'function' ? ctx.logger(PLUGIN_NAME) : ctx.logger,
    PLUGIN_NAME,
  );
  // 成功提示通道（sink 甲：终端一行，详见 lib/notice.js）。会话作用域 —— HMR 重挂后
  // `seen` 随之重建，所以"每 kind 每会话至多一条"与 `apply` 的生命周期严格对齐。
  const notice = createNotice(log, PLUGIN_NAME);

  // Token → absolute path map. Tokens are base64url of the abs path, so the
  // route never exposes an arbitrary filesystem string the client could not
  // otherwise obtain from the inventory.
  const mediaMap = new Map();
  const tokenFor = (absPath) => {
    const token = Buffer.from(absPath, 'utf8').toString('base64url');
    mediaMap.set(token, absPath);
    return token;
  };

  // 虚拟 faststart：布局分析器（有界内存缓存）→ lib/mp4-vfs.js；布局钉子 / 预热 / 旧副本清扫
  // → lib/faststart.js。这一族全部实现都在那两个文件里；`c` 只装它们**用到但不属于它们**的东西
  //（见各自文件头）。⚠️ 顺序：分析器先建 —— faststart 吃它的 `layoutFor`。
  const { layoutFor } = createMp4VfsKit({ appendDiagLine });
  // 旧版（≤ v1.3.1）的 faststart 副本写死在**数据目录**下的 `cache/faststart` —— 那条
  // `faststartCacheDir()` 不认 `DSH_WE_CACHE_DIR`，也不认设置里的「缓存位置」。所以搬过缓存根
  // 的用户那几 GB 只可能留在它下面：清扫要连它一起扫（见 lib/faststart.js 的 `legacyFaststartDirs`）。
  const legacyCacheBaseDir = () => join(pluginDataDir(), 'cache');
  const {
    faststartVariant, pinnedFaststartVariant, warmFaststartFavorites, sweepLegacyFaststartVariants,
  } = createFaststartKit({ layoutFor, cacheBaseDir, legacyCacheBaseDir, readConfig, mediaMap });

  // scene 探测套件（独立音轨抽取 + 「主文件是否内嵌 MP4」的有界 LRU 账本）→ lib/scene-probe.js。
  // ⚠️ 全局**只建这一个实例**：这本账同时被 /inventory（下面 buildInventory 的 map 回调）与
  //    /scene-video 路由读取；两处拿不同实例 ⇒ 同一 pkg 被重复探测、两个回答还会分叉。
  //    注入的 atomicWriteFileP / ensureFrameCacheDir 是「怎么落盘、落在哪」的策略，归本文件决定。
  const {
    ensureSceneAudio, sceneVideoProbeKey, sceneVideoProbeGet, sceneVideoProbeSet, scheduleSceneVideoProbe,
  } = createSceneProbeKit({ atomicWriteFileP, ensureFrameCacheDir });

  // Startup sweep: a previous host process may have died mid-transcode or
  // mid-download (the detached ffmpeg child keeps writing after its parent is
  // killed by a restart/HMR), orphaning .tmp outputs, .prog progress files,
  // .part downloads and ffmpeg-err logs. Nothing of THIS process can be
  // mid-flight at startup, so all stale artifacts are removed in one pass.
  // 缓存清扫/裁剪推迟到插件加载完成之后：两者都是同步遍历缓存目录，在 apply()
  // 里直接跑会阻塞插件树加载、拖长整个 profile 的启动时间（实测）。
  const startupSweepTimer = setTimeout(() => {
    try { sweepTranscodeArtifacts(); } catch { /* ignore */ }
    // 自定义画面目录不属上面那三个目录，这里单独扫（只清够旧的 `.tmp`，见 sweepCustomFrameTmp）。
    try { sweepCustomFrameTmp(customFrameDir()); } catch { /* ignore */ }
    // 头像目录同理（写流被强杀留下的 `.tmp`；读取侧只认正式扩展名 ⇒ 不扫就是看不见的垃圾）。
    try { sweepCustomFrameTmp(avatarDir()); } catch { /* ignore */ }
    // 吉祥物立绘目录同一条纪律（它同样只认 `mascot-*.{ext}`，`.tmp` 是看不见的垃圾）。
    try { sweepCustomFrameTmp(mascotDir()); } catch { /* ignore */ }
    try { pruneVideoPreviewCache(); } catch { /* ignore */ }
    // 大文件缓存同样要有上限 (见 pruneCacheDirBySize): transcode 输出
    // (tc_*.mp4, 每个 80–280MB) 没有上限就会一路增长 → 按 mtime-LRU 收敛到上限以内。
    // 只匹配真正的转码产物, 不碰同名的 .loop / .prog / .tmp 附属文件。
    try { pruneCacheDirBySize(transcodeCacheDir(), TRANSCODE_CACHE_MAX_BYTES, /^tc_.*\.mp4$/); } catch { /* ignore */ }
    // 旧版（≤ v1.3.1）的 faststart 变体是**源的全量拷贝**（本机实测 5 张 = 1570MB，且卡在
    // 8GB 上限下永不触发淘汰）。本版起"搬家"改为**服务期合成**（见 lib/mp4-vfs.js，磁盘 0）
    // ⇒ 那些副本一次性回收，也不再需要"按大小裁剪"这条纪律（不再有新的落盘）。
    // ⚠️ 清扫要连**旧版写死的那个根**一起扫：缓存根搬到别的盘、或一直用 DSH_WE_CACHE_DIR 的
    // 用户，旧副本只在数据目录里（判据与负对照见 test/verify-mp4-vfs.mjs 的 D 段）。
    try {
      const swept = sweepLegacyFaststartVariants();
      if (swept.files) {
        log.info('已回收旧版 faststart 副本：' + swept.files + ' 个 / '
          + (swept.bytes / 1048576).toFixed(1) + ' MB（本版起不再落盘）'
          + (swept.capped ? '（本轮达清扫上限，下次启动继续）' : ''));
      }
    } catch { /* ignore */ }
  }, 3000);

  const disposers = [];
  disposers.push(() => { try { clearTimeout(startupSweepTimer); } catch { /* ignore */ } });

  // 在途流台账：被 serveFile 登记的每条流都进这里，teardown（文件末尾的 fiber disposer）
  // 逐流 destroy。登记/三层收尾的实现都在 lib/serve.js（那边是闭包，这边只给引用）。
  const activeStreams = new Set();

  // 2/3. 媒体 + 预览字节直出（Range / HEAD / 条件 GET）与壁纸自有文件服务 → lib/serve.js。
  //      套件（trackStream / serveFile / handleSceneFiles）与载荷账本都在那个文件里。
  //      ⚠️ 调用点必须早于下面 createMediaOrigin —— 它吃 handleSceneFiles（原靠函数声明提升）。
  const { trackStream, serveFile, serveLayout, handleSceneFiles } = createServeKit({
    activeStreams, BASE, mediaMap, log, appendDiagLine,
    traceRequests, traceMediaRequests, readWebShim, buildSeedScript,
  });

  // 壁纸媒体源 + 适配器形态观测：整块收进 lib/media-origin.js（见该文件头）。
  // 依赖显式传入；返回的访问器供扫描链 / /inventory / /settings / 诊断族 / 场景载荷族共用。
  const mediaOriginApi = createMediaOrigin({
    base: BASE, log, notice, appendDiagLine, disposers, handleSceneFiles, readSettings,
  });

  // ── 清单构建族（`sceneFieldsFor` / `webFieldsFor` / `buildInventory` ＋ 3s TTL 缓存）
  //    → lib/inventory.js 的工厂 `createInventoryBuilder`（见该文件头）。这不是路由族而是
  //    工厂：TTL 缓存是**跨请求状态**，工厂形式让它与"apply() 的一次调用"同生命周期
  //    （做成模块级单例就会让两次 apply 共用缓存）。
  //    ⚠️ `getUploadDir` / `getWeAssetsDir` 传的是**访问器**不是值：这两个目录会被
  //       /upload-dir 与 /we-assets-dir 在运行时改写，传值快照会让清单一直报旧目录。
  //    `warmFaststartFavorites` 是下方（function 声明，hoisted）的预热器，此处只取引用；
  //    调用点必须在 `mediaOriginApi` 之后 —— 工厂要**立即读**它（const 非 hoist）。
  const buildInventory = createInventoryBuilder({
    log, BASE, tokenFor, mediaOriginApi, warmFaststart: warmFaststartFavorites,
    locateWallpaperEngineP, owningLibrariesP, enumerateWallpapersAsync,
    // ⚠️ 上一行必须**逐字**保持这个顺序与换行：test/verify-we-install-probe.mjs 的 D8 按
    //    字面量断言这三者仍是清单载荷的消费面（扫描签名是并列的第四项，另起一行）。
    scanSignatureP,
    pathKey, listCustomFrameIds, pathExistsP, mtimeOrNullP, extOf,
    ensureUploadDir, readUploadMeta, enumerateUploadsP, metaEntry,
    readPlaylistsP, playlistItemId, weAssetsAvailable,
    sceneVideoProbeKey, sceneVideoProbeGet, scheduleSceneVideoProbe, customIdFromAbs,
    getUploadDir, getWeAssetsDir, cacheBaseDir,
  });

  // 1. Inventory JSON.
  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/inventory`,
    handler: async (req, res) => {
      try {
        mediaOriginApi.observeAdapter(req);   // 先观测再建库：媒体源起不起由本次请求的形态决定
        const payload = JSON.stringify(await buildInventory());
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(payload);
      } catch (err) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
      }
    },
  }));

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
    GPU_FRAME_AREA_TOL, GPU_FRAME_MAX_BYTES, GPU_WRITE_INFLIGHT,
    CUSTOM_FRAME_EXT, CUSTOM_FRAME_MAX_BYTES,
    armBodyIdleTimeout, atomicWriteFileP, customFrameDir, customFramePath, customIdFromAbs,
    gpuFrameFileFor, lingerClose, looksLikePng, pngDimsOfBuf, pngSizeOf, sceneFrameSlot,
  });

  // 3c-2/3c-3/3c-3b. 场景载荷服务族路由（live 渲染页 / 壁纸自有文件 / 媒体源诊断 +
  //                 载荷进度账本）→ lib/routes/scene-serve.js。四条注册与它们的依赖都在
  //                 那个文件里；媒体源服务本身（handleSceneFiles / ensureMediaOrigin）
  //                 留在原地 —— /inventory 也消费 ensureSceneMediaOrigin()。
  registerSceneServeRoutes(webServer, {
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

  // 3c-5. 媒体状态族路由（媒体后端懒启动 + /media-status、/audio-spectrum、
  //       /now-playing、/now-playing/artwork）→ lib/routes/now-playing.js。
  //       后端实例、启动决策与四条注册都在那个文件里；这里只声明它的依赖。
  registerNowPlayingRoutes(webServer, {
    disposers, base: BASE, appendDiagLine, configPath, cacheBaseDir, readConfig, serveFile,
    CONTROL_JSON_MAX_BYTES,
    // 媒体子系统的行统一带 `[media]` 标签（与终端既有形状逐字一致）；级别由调用点标注。
    log: log.tag('media'),
  });

  // 3c-6b. 遮挡快照族路由（GET /occlusion）→ lib/routes/occlusion.js + lib/occlusion/。
  //        hub 是自带心跳/降级/适配器重建的活系统，创建与 dispose 都在**这里**（本文件的
  //        apply 作用域），路由族只是它唯一的只读消费者。start() 内部对「非 X11 会话 /
  //        连接失败」全部降级且不外抛，30s 退避重试由 hub 自理 —— 调用点只需兜一层
  //        unhandled 拒绝。⚠️ 保持调用点**语句形态**（行首即函数名、无赋值前缀）：
  //        test/tools/host-route-index.mjs 的正则认的就是它。
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

  // 3c-6 / 3c-7. 诊断族路由（/client-diag、/diag、/diag-log）→ lib/routes/diag.js。
  //           注册顺序、共用处理器与两处兜底都在那个文件里；这里只声明它的依赖。
  // 出参 `onHandleDiag` 把诊断族的 `handleDiag` 交回来，武装 3c-3a 的 `mediaDiagHandler` ——
  // 场景壁纸的 mediaBase 指向媒体源之后，渲染页的告警必须在那里也落进**同一份**环形缓冲。
  // ⚠️ 保持这个**语句形态**（行首即函数名、不加以赋值前缀）：`test/tools/host-route-index.mjs`
  //    的调用点正则认的就是它，加了前缀本族会被判成"孤儿族模块"。
  registerDiagRoutes(webServer, {
    disposers, appendDiagLine, base: BASE, log, notice,
    onHandleDiag: mediaOriginApi.setDiagHandler,
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
  //     ⚠️ `SCENE_VIDEO_INFLIGHT` 声明在**本文件**、以引用进 `c` —— 保持"本 fiber 单例"，
  //        生命周期与一次 apply 一致。
  const SCENE_VIDEO_INFLIGHT = new Map();
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

  // 6b. 字体集族路由（list / get / put / delete / activate / import / export）→ lib/routes/fontsets.js。
  //     一个 `prefix` 注册覆盖七个端点（子路径在族内分派）⇒ 面面上只多一条路由，
  //     与 /scene-frame、/scene-serve 的形态一致。一次性迁移**不在**这里做（惰性，见族文件头）。
  registerFontsetsRoutes(webServer, {
    disposers, base: BASE, fontSetsDir, fontSetsBuiltinDir: FONTSET_BUILTIN_DIR,
    readSettings, readFontSetId, setFontSetId, commitFontSetMigration,
    atomicWriteFileP, ensureDirOnce, armBodyIdleTimeout, lingerClose, log,
  });

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

  // 6c. 「关于」页签的仓库 star 数 → lib/routes/github-stars.js。**只读**一条腿：
  //     本插件唯一一处出站请求（api.github.com），带 10 分钟 TTL + 落盘缓存兜底；
  //     一键 star 不做（GitHub 要点星必须有用户凭据，插件不存任何 token）。
  registerGithubStarsRoutes(webServer, {
    disposers, base: BASE, repoSlug: repoSlugFromPkg(),
    cachePath: () => join(pluginDataDir(), 'star-count.json'),
    log,
  });

  // 6c′. 本机字体清单（设置页「全局字体 / 终端字体」下拉里那一组）→ lib/routes/system-fonts.js。
  //      三平台各一条权威来源（system_profiler / PowerShell / fc-list），拿不到时按文件名推
  //      并**如实标 approximate**；一次扫描很贵（macOS 实测 ~10s）⇒ 双层缓存 + 过期先回旧值。
  //      扫描**不在启动期**发生：第一次请求这条路才触发（族文件头的不变量）。
  registerSystemFontsRoutes(webServer, {
    disposers, base: BASE,
    cachePath: () => join(pluginDataDir(), 'system-fonts.json'),
    log,
  });

  // 6d. 「关于」页签的两张联系方式二维码（静态 PNG，白名单直出）→ lib/routes/about-qr.js。
  registerAboutQrRoutes(webServer, { disposers, base: BASE, aboutDir: ABOUT_DIR, serveFile });

  // 6e. 「扩展」页签第一个模块（自定义会话头像）的两张图 → lib/routes/avatar.js。
  //     POST 导入（raw body，MIME 白名单，8MB 上限）/ GET、HEAD 查看 / DELETE 清除，
  //     一条 prefix 注册覆盖三个端点（与 /custom-frame 同形）。图落在插件数据目录的
  //     `avatars/` 下（不进 overrides —— 那是"某个壁纸的画面"；也不进 uploads ——
  //     那会污染壁纸库存），设置里只存文件名（见 settings-schema 的 avatarFile 档）。
  // 6f. 「系统」页签的自定义吉祥物立绘 → lib/routes/mascot.js。形态与头像那族一致
  //     （POST 导入 / GET·HEAD 查看 / DELETE 清除，raw body + MIME 白名单），但只认一张：
  //     导入前先清同族旧文件 —— "下一次导入覆盖上一次"是用户口径。
  registerMascotRoutes(webServer, {
    disposers, base: BASE, serveFile,
    mascotDir, mascotPath, MASCOT_EXT, MASCOT_MAX_BYTES,
    atomicWriteFileP, armBodyIdleTimeout, lingerClose,
  });

  registerAvatarRoutes(webServer, {
    disposers, base: BASE, serveFile,
    avatarDir, avatarPath, AVATAR_SIDES, AVATAR_EXT, AVATAR_MAX_BYTES,
    atomicWriteFileP, armBodyIdleTimeout, lingerClose,
  });

  // 7. 插件设置（端口无关持久化）→ lib/routes/settings.js。
  //    GET 回已存设置（从未存过则 null）＋ betterSidebar / adapter 两个旁路观测值；
  //    PUT 把规范化副本写进 ~/.dsh-wallpaper-engine/config.json。
  registerSettingsRoutes(webServer, {
    disposers, base: BASE, ctx, mediaOriginApi,
    readSettings, isBetterSidebarLoaded, sanitizeSettings, withLegacyFontValues, writeSettings,
    armBodyIdleTimeout, lingerClose,
  });

  // 7b. 「缓存位置」（高级页签）→ lib/routes/cache-dir.js。一条 POST；当前值随 /inventory
  //     的 `cacheDir` 下发。⚠️ `cacheBaseDir` 传的是**访问器**不是值：它就是"每次现读
  //     env → config → 默认"的那条解析链，传值快照会让"刚改完却报旧路径"。
  registerCacheDirRoutes(webServer, {
    disposers, base: BASE, CONTROL_JSON_MAX_BYTES,
    normalizeUserDir, cacheBaseDir, setCacheDir, armBodyIdleTimeout,
  });

  return () => {
    for (const d of disposers) { try { d(); } catch { /* ignore */ } }
    // 目录创建记忆化 (ensureDirOnce) 只对本次 apply 的路径有意义, 卸载后同一
    // 模块实例可能被再次 apply 且路径不同 → 清空, 避免 Set 无界增长。
    ensuredDirs.clear();
    // 收尾：杀在途 ffmpeg 子进程 / 在途任务置 error / 清在途账本（实现见 lib/transcode.js）。
    disposeTranscodes();
    // Destroy every in-flight media stream so the fiber (HMR / plugin stop)
    // releases all file descriptors — zero residue.
    for (const s of activeStreams) {
      if (!s.destroyed) { try { s.destroy(); } catch { /* ignore */ } }
    }
    activeStreams.clear();
    mediaMap.clear();
  };
}

export default { inject, apply };

