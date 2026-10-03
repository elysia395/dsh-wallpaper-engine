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
  lstatSync,
  realpathSync,
  createReadStream,
  createWriteStream,
  readdirSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
  renameSync,
  appendFileSync,
  openSync,
  readSync,
  writeSync,
  fstatSync,
  closeSync,
  fsyncSync,
  chmodSync,
  utimesSync,
} from 'node:fs';
// Async filesystem (thread pool) for the wallpaper-scan chain — keeps the
// event loop responsive on slow media (WSL DrvFS) instead of blocking it for
// seconds per chunk (see "Loading plugins…" stall report).
import {
  access, readdir, readFile, stat,
  writeFile as writeFileP, rename as renameP, unlink as unlinkP, copyFile as copyFileP,
} from 'node:fs/promises';
import { join, resolve, normalize, basename, dirname, relative, isAbsolute, sep } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// 壁纸媒体源（独立 loopback 监听）——见 ensureMediaOrigin 的说明。
import { createServer } from 'node:http';

// Scene wallpaper embedded-video extraction (ported from dsh-web-ui's
// skin-center we-* modules). A separate module so the PKG/TEX container
// primitives (lib/pkg-read.js) stay untouched — this one only probes for an
// embedded MP4.
import { extractSceneVideo, extractSceneVideoFromDir } from './scene-manifest.js';
// WE 用户属性（project.json general.properties）→ 面板描述 / 覆盖值合并。
// 语义细节见该文件头：order 浮点、combo 保类型、逐键本地化、condition 只影响 UI。
import { parseUserPropDefs, entryDirPrefix, filterKnownOverrides } from './we-props.js';
// 设置白名单/校验的**唯一真源**（客户端侧由构建期内联同一文件）。
import { sanitizeFromSchema, clampNum, isFontSetId, sanitizeFontset, FONTSET_KEYS, ADAPTER_TARGET_VALUES } from './settings-schema.js';
// 收 body 的**唯一缓冲实现**（累加 + 字节计闸 + 一次解码）—— 见 lib/http-body.js（P4-13）。
import { bodyReader } from './http-body.js';
import { registerDiagRoutes } from './routes/diag.js';
import { registerNowPlayingRoutes } from './routes/now-playing.js';
import { registerSceneFrameRoutes } from './routes/scene-frame.js';
import { registerSceneServeRoutes } from './routes/scene-serve.js';
import { registerUploadRoutes } from './routes/upload.js';
import { registerFontsetsRoutes } from './routes/fontsets.js';
import { registerGithubStarsRoutes } from './routes/github-stars.js';
import { registerAboutQrRoutes } from './routes/about-qr.js';
import { registerMetricsRoutes } from './routes/metrics.js';
import { createLog } from './log.js';
import { createNotice } from './notice.js';

/** Steam appid for Wallpaper Engine. */
const WE_APPID = '431960';
/** Request path prefix under which this bundle's HTTP surface lives. */
const BASE = '/wallpaper-engine';
/** 终端行前缀里的名字（日志与提示通道共用同一个，别写成两处字面量）。 */
const PLUGIN_NAME = 'wallpaper-engine';
/** Vendored WebWallGL renderer page (built+copied by test/tools/sync-webwallgl.mjs,
 *  with --base=/wallpaper-engine/scene-live/ so its asset refs resolve here). */
const WEBWALLGL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'webwallgl');
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
 * WE web-wallpaper API shim, vendored next to the renderer page by the same
 * sync script. Injected into web-wallpaper HTML responses by /scene-files —
 * under the strict sandbox the renderer page cannot reach into the wallpaper
 * iframe, so the shim must ride along with the document. Read once and cached;
 * an absent file degrades silently (the wallpaper still runs, just without the
 * WE API surface).
 */
let webShimCache;
function readWebShim() {
  if (webShimCache !== undefined) return webShimCache;
  try {
    webShimCache = readFileSync(join(WEBWALLGL_DIR, 'web-shim.js'), 'utf8');
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
/** Common Steam install locations probed when libraryfolders.vdf is missing. */
const STEAM_PROBE_DIRS = [
  'C:\\Program Files (x86)\\Steam',
  'C:\\Program Files\\Steam',
  'D:\\Steam',
  'D:\\SteamLibrary',
  'E:\\SteamLibrary',
];

/** reg.exe: SystemRoot on Windows, /mnt/<letter>/Windows/System32 on WSL; null elsewhere. */
async function resolveRegExeP() {
  if (process.platform === 'win32') {
    return join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
  }
  if (process.platform !== 'linux') return null;
  let letters = [];
  try { letters = (await readdir('/mnt')).filter((n) => /^[a-zA-Z]$/.test(n)); } catch { return null; }
  for (const letter of letters) {
    const p = join('/mnt', letter, 'Windows', 'System32', 'reg.exe');
    if (await pathExistsP(p)) return p;
  }
  return null;
}

/** Steam root from HKCU\\Software\\Valve\\Steam on Windows and WSL; null elsewhere. */
function steamPathFromRegistryP() {
  return resolveRegExeP().then((reg) => {
    if (!reg) return null;
    return new Promise((resolvePromise) => {
      try {
        // async execFile (5s timeout): execFileSync would block the event loop.
        execFile(
          reg,
          ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
          { encoding: 'utf8', windowsHide: true, timeout: 5000 },
          (err, stdout) => {
            if (err) { resolvePromise(null); return; }
            const m = /SteamPath\s+REG_SZ\s+(.+)/i.exec(stdout || '');
            const p = m ? normalize(m[1].trim()) : null;
            resolvePromise(p ? wslPath(p) : null);
          },
        );
      } catch { resolvePromise(null); }
    });
  });
}

/** Steam roots from DSH_WE_STEAM_ROOT (comma/semicolon separated, Windows or /mnt paths). */
function steamRootsFromEnv() {
  const raw = process.env.DSH_WE_STEAM_ROOT && process.env.DSH_WE_STEAM_ROOT.trim();
  if (!raw) return [];
  return raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(wslPath);
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
 * WSL-only: Windows Steam drives appear under /mnt/<letter>. Probe them so a
 * Harness running inside WSL can discover a Windows Wallpaper Engine install
 * (paths are DrvFS mounts — slow, which is exactly why only async probes run).
 */
async function wslSteamRootsP() {
  if (process.platform !== 'linux') return [];
  let letters = [];
  try { letters = (await readdir('/mnt')).filter((n) => /^[a-zA-Z]$/.test(n)); } catch { return []; }
  const roots = [];
  for (const letter of letters) {
    const base = join('/mnt', letter);
    for (const c of [
      join(base, 'Program Files (x86)', 'Steam'),
      join(base, 'Program Files', 'Steam'),
      join(base, 'Steam'),
      join(base, 'SteamLibrary'),
    ]) {
      if (await pathExistsP(join(c, 'steamapps', 'libraryfolders.vdf'))) roots.push(c);
    }
  }
  return roots;
}

// Probe list 缓存：reg.exe 查询 + WSL /mnt 探测（DrvFS，慢）组合一次要几秒，
// 而 buildInventory 每次请求都调用两次（locateWallpaperEngineP / owningLibrariesP）。
// TTL 60s（含失败结果——Steam 未安装时不能每次请求都重新全盘探测），并发调用
// 共享同一个 in-flight Promise。
const STEAM_PROBE_TTL_MS = 60 * 1000;
let steamProbeCache = null; // { t, dirs }
let steamProbeInflight = null;

/** Probe list: registry root + env override(s), then known dirs, then WSL /mnt mounts. */
async function steamProbeDirsP() {
  if (steamProbeCache && Date.now() - steamProbeCache.t < STEAM_PROBE_TTL_MS) {
    return steamProbeCache.dirs;
  }
  if (steamProbeInflight) return steamProbeInflight;
  steamProbeInflight = (async () => {
    const reg = await steamPathFromRegistryP();
    const env = steamRootsFromEnv();
    const wsl = await wslSteamRootsP();
    return [...(reg ? [reg] : []), ...env, ...STEAM_PROBE_DIRS, ...wsl];
  })();
  try {
    const dirs = await steamProbeInflight;
    steamProbeCache = { t: Date.now(), dirs };
    return dirs;
  } finally {
    steamProbeInflight = null;
  }
}

/**
 * On WSL, translate a Windows path (`D:\SteamLibrary`) to its DrvFS mount form
 * (`/mnt/d/SteamLibrary`). libraryfolders.vdf entries are always Windows-style
 * even when read from inside WSL — without this the workshop library would
 * silently resolve to nothing. No-op on every other platform.
 */
function wslPath(p) {
  if (process.platform !== 'linux' || typeof p !== 'string') return p;
  const m = /^([a-zA-Z]):[\\/](.*)$/.exec(p);
  if (!m) return p;
  return join('/mnt', m[1].toLowerCase(), m[2].replace(/\\/g, '/'));
}

/** Valve KeyValues parser for libraryfolders.vdf: libraries owning WE. */
async function librariesFromVdfP(vdfPath) {
  let text;
  try { text = await readFile(vdfPath, 'utf8'); } catch { return []; }
  const libs = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*"path"\s+"([^"]+)"\s*$/.exec(line);
    if (m) { current = m[1].replace(/\\\\/g, '\\'); continue; }
    if (current && line.includes(WE_APPID)) {
      const t = wslPath(current);
      if (t && !libs.includes(t)) libs.push(t);
    }
  }
  return libs;
}

/** Locate the install directory (holds wallpaper32.exe). */
async function locateWallpaperEngineP() {
  const candidates = [];
  const libraries = [];
  const probes = await steamProbeDirsP();
  for (const probe of probes) {
    const vdf = join(probe, 'steamapps', 'libraryfolders.vdf');
    if (await pathExistsP(vdf)) {
      try { libraries.push(...await librariesFromVdfP(vdf)); } catch { /* skip */ }
    }
  }
  const roots = [...probes, ...libraries];
  for (const root of roots) candidates.push(join(root, 'steamapps', 'common', 'wallpaper_engine'));
  candidates.push(wslPath('C:\\Program Files (x86)\\Wallpaper Engine'));

  const seen = new Set();
  for (const raw of candidates) {
    const dir = normalize(raw);
    if (seen.has(dir)) continue;
    seen.add(dir);
    if (await pathExistsP(join(dir, 'wallpaper32.exe'))) return dir;
  }
  return null;
}

/** Libraries that own Wallpaper Engine (for the workshop content root). */
async function owningLibrariesP() {
  const libs = [];
  for (const probe of await steamProbeDirsP()) {
    const vdf = join(probe, 'steamapps', 'libraryfolders.vdf');
    if (await pathExistsP(vdf)) {
      try { libs.push(...await librariesFromVdfP(vdf)); } catch { /* skip */ }
    }
    // The Steam root a libraryfolders.vdf lives in is itself a library, but it
    // is never listed as a "path" entry. If Wallpaper Engine is installed in
    // the DEFAULT Steam library, its workshop content lives under that same
    // root — include it, or every workshop wallpaper silently disappears from
    // the inventory (and playlists cannot resolve, breaking rotation).
    if (await pathExistsP(join(probe, 'steamapps', 'common', 'wallpaper_engine'))) libs.push(probe);
  }
  return [...new Set(libs)];
}

function inferType(file) {
  if (/\.(mp4|webm|mkv|avi|mov)$/i.test(file)) return 'video';
  if (/\.(html?|js)$/i.test(file)) return 'web';
  return 'scene';
}

/**
 * 真实容器后缀（小写、不含点；取不到返回空串）。
 *
 * 给客户端判"浏览器原生可解"用 —— 媒体 URL 是 token 形态、没有扩展名，
 * 客户端自己猜不到容器（见 inventory 里 `mediaExt` 的注释）。
 */
function extOf(p) {
  const s = String(p || '');
  const dot = s.lastIndexOf('.');
  const sepAt = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return dot > sepAt + 1 ? s.slice(dot + 1).toLowerCase() : '';
}

const KINDS = ['scene', 'video', 'web', 'application'];

async function readProjectP(dir) {
  const pj = join(dir, 'project.json');
  if (!(await pathExistsP(pj))) return null;
  try {
    const o = JSON.parse(await readFile(pj, 'utf8'));
    if (!o || typeof o !== 'object' || !o.file) return null;
    let type = typeof o.type === 'string' ? o.type.toLowerCase() : inferType(o.file);
    if (!KINDS.includes(type)) type = 'scene';
    return {
      id: basename(dir),
      title: typeof o.title === 'string' ? o.title : basename(dir),
      type,
      file: o.file,
      preview: typeof o.preview === 'string' ? o.preview : null,
      // Content rating: Wallpaper Engine stores its own G / PG13 / R taxonomy
      // in project.json `contentrating` ("Everyone" / "PG13" / "Mature"). Pass
      // it through so the browser half can reproduce WE's rating filter
      // without re-reading the disk.
      contentrating: typeof o.contentrating === 'string' ? o.contentrating : null,
      // 主题色（WE 的 schemecolor）：网页壁纸在「尚无抽帧图」时用它做加载期占位底色。
      schemeColor: schemeToCss(o.general && o.general.properties
        && o.general.properties.schemecolor && o.general.properties.schemecolor.value),
    };
  } catch { return null; }
}

/**
 * Resolve a scene project's real main container. project.json's file field is
 * trusted when it exists on disk, but workshop items frequently declare
 * `scene.json` while shipping only the packed `scene.pkg` (and loose projects
 * ship the reverse) — probe the declared file, then scene.pkg, then
 * scene.json, then a single *.pkg in the directory. Returns the hit relative
 * to dir, or null when nothing matches.
 */
async function resolveSceneMainFileP(dir, declared) {
  for (const candidate of [declared, 'scene.pkg', 'scene.json']) {
    if (!candidate) continue;
    if (await isFileP(resolve(dir, candidate))) return candidate;
  }
  let pkgs = [];
  try {
    pkgs = (await readdir(dir)).filter((name) => name.toLowerCase().endsWith('.pkg'));
  } catch {
    return null;
  }
  return pkgs.length === 1 ? pkgs[0] : null;
}

// Project-directory batch size for the async scan: bounds in-flight I/O and
// peak memory while still parallelizing across the libuv thread pool.
const SCAN_CHUNK = 24;

async function enumerateWallpapersAsync(installDir, libraryDirs) {
  const found = new Map();
  const roots = [];
  if (installDir) {
    for (const sub of ['defaultprojects', 'myprojects']) {
      const p = join(installDir, 'projects', sub);
      if (await pathExistsP(p)) roots.push(p);
    }
  }
  for (const lib of libraryDirs) {
    const ws = join(lib, 'steamapps', 'workshop', 'content', WE_APPID);
    if (await pathExistsP(ws)) roots.push(ws);
  }
  // Collect candidate project dirs (async per root), then process them in
  // bounded chunks — the heavy per-project I/O (readdir/stat/readFile) runs on
  // the thread pool, so the event loop stays responsive throughout.
  const projectDirs = [];
  for (const root of roots) {
    let entries = [];
    try { entries = await readdir(root); } catch { continue; }
    for (const entry of entries) {
      const dir = join(root, entry);
      if (await isDirectoryP(dir)) projectDirs.push(dir);
    }
  }
  for (let i = 0; i < projectDirs.length; i += SCAN_CHUNK) {
    const chunk = projectDirs.slice(i, i + SCAN_CHUNK);
    const results = await Promise.all(chunk.map((dir) => readProjectP(dir).then((p) => p ? { dir, p } : null)));
    for (const hit of results) {
      if (!hit || found.has(hit.p.id)) continue;
      const { dir, p: proj } = hit;
      // Scenes: resolve the real container (scene.pkg vs scene.json) so the
      // scene-frame route reads a file that actually exists.
      proj.fileAbs = proj.type === 'scene'
        ? resolve(dir, (await resolveSceneMainFileP(dir, proj.file)) || proj.file)
        : resolve(dir, proj.file);
      proj.previewAbs = proj.preview ? resolve(dir, proj.preview) : null;
      found.set(proj.id, proj);
    }
  }
  return [...found.values()].sort((a, b) =>
    (a.title || '').localeCompare(b.title || ''));
}

function pathKey(file) {
  return normalize(String(file).replace(/\//g, '\\')).toLowerCase();
}

function playlistId(profileName, index, name) {
  return Buffer.from(`${profileName}\0${index}\0${name}`, 'utf8').toString('base64url');
}

function playlistRows(profile) {
  const general = profile && typeof profile === 'object' ? profile.general : null;
  if (!general || typeof general !== 'object') return [];
  if (Array.isArray(general.playlists) && general.playlists.length) return general.playlists;
  const selected = general.wallpaperconfig && general.wallpaperconfig.selectedwallpapers;
  if (!selected || typeof selected !== 'object') return [];
  return Object.values(selected)
    .map((monitor) => monitor && monitor.playlist)
    .filter((playlist) => playlist && typeof playlist === 'object');
}

async function readPlaylistsP(installDir) {
  if (!installDir) return [];
  const configPath = join(installDir, 'config.json');
  if (!(await pathExistsP(configPath))) return [];
  let config;
  try { config = JSON.parse(await readFile(configPath, 'utf8')); } catch { return []; }

  const result = [];
  const seen = new Set();
  for (const [profileName, profile] of Object.entries(config || {})) {
    for (const [index, row] of playlistRows(profile).entries()) {
      const items = Array.isArray(row.items)
        ? row.items.filter((item) => typeof item === 'string' && item.trim())
        : [];
      if (!items.length) continue;
      const name = typeof row.name === 'string' && row.name.trim()
        ? row.name.trim() : `Playlist ${index + 1}`;
      const signature = `${name}\0${items.join('\0')}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      const settings = row.settings && typeof row.settings === 'object' ? row.settings : {};
      result.push({
        id: playlistId(profileName, index, name),
        name,
        items,
        order: settings.order === 'random' ? 'random' : 'sequence',
        delay: typeof settings.delay === 'number' ? settings.delay : null,
      });
    }
  }
  return result;
}

function playlistItemId(item, byPath, byId) {
  const exact = byPath.get(pathKey(item));
  if (exact) return exact;
  const match = /[\\/]431960[\\/]([^\\/]+)(?:[\\/]|$)/i.exec(item);
  const project = match ? byId.get(match[1]) : null;
  if (project) return project.id;
  // Last resort: match the trailing project folder name. Covers install-relative
  // entries like `projects\defaultprojects\<name>\project.json` (and media
  // files inside such projects), which never contain the workshop appid.
  const folder = /[\\/]([^\\/]+)[\\/][^\\/]+$/i.exec(item);
  if (folder && byId.has(folder[1])) return folder[1];
  return null;
}

function mimeFor(absPath) {
  const ext = absPath.slice(absPath.lastIndexOf('.') + 1).toLowerCase();
  return {
    mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska',
    avi: 'video/x-msvideo', mov: 'video/quicktime',
    html: 'text/html', htm: 'text/html', js: 'text/javascript', mjs: 'text/javascript',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    png: 'image/png', webp: 'image/webp', apng: 'image/apng', bmp: 'image/bmp',
    // Web-wallpaper subresources: a stylesheet served as
    // application/octet-stream is REJECTED by the browser (strict MIME
    // checking), so the full set a workshop HTML page can reference must be
    // mapped — css/json/svg/fonts/audio included.
    css: 'text/css', json: 'application/json', svg: 'image/svg+xml',
    txt: 'text/plain', xml: 'application/xml', wasm: 'application/wasm',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
    mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', wav: 'audio/wav',
    m4a: 'audio/mp4', flac: 'audio/flac', aac: 'audio/aac',
  }[ext] || 'application/octet-stream';
}

// ── Custom uploads (read-A storage: files live on disk in a plugin-managed
//    directory, served through the SAME token/media/preview routes as the
//    Wallpaper Engine media — no IndexedDB, no quota limits, survives
//    restarts by construction). ──────────────────────────────────────────────
/**
 * 插件数据目录（设置 / 抽屉抽帧 / 诊断落盘都在这里）。
 * 默认 `~/.dsh-wallpaper-engine`；`DSH_WE_DATA_DIR` 可把它整体挪走 —— 自检脚本
 * 会 PUT 设置，绝不能写用户真实的那份 config.json（与 DSH_WE_UPLOAD_DIR /
 * DSH_WE_CACHE_DIR 同一套测试隔离约定）。不设该变量时路径与从前完全一致。
 */
function pluginDataDir() {
  const override = process.env.DSH_WE_DATA_DIR;
  return override && override.trim() ? resolve(override.trim()) : join(homedir(), '.dsh-wallpaper-engine');
}

/** Config file that remembers the user-chosen upload directory. */
function configPath() { return join(pluginDataDir(), 'config.json'); }

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

function readConfig() {
  try {
    const o = JSON.parse(readFileSync(configPath(), 'utf8'));
    return o && typeof o === 'object' ? o : {};
  } catch { return {}; }
}

/**
 * Atomic whole-file write: temp file + fsync + rename. Crash/断电 mid-write
 * leaves either the old file or the new file, never a truncated one (the same
 * publication semantics @deepseek-ai/dsh-storage-json uses for its JSON units;
 * on Windows libuv rename maps to MoveFileExW with replace).
 */
function atomicWriteFileSync(filePath, data) {
  const tmp = filePath + '.tmp';
  const fd = openSync(tmp, 'w');
  try {
    writeFileSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, filePath);
  } catch {
    // Cross-device / locked-target fallback: keep best-effort plain write.
    writeFileSync(filePath, data);
  }
}

/** Async variant of atomicWriteFileSync (same .tmp + rename publication). */
// 临时名带 pid + 进程内序号：同一目标文件的并发写入者不共用同一个
// `<file>.tmp`（共用时两路并发 PUT 会互相 rename/覆盖对方半截内容）。
// 后缀保持纯数字，兼容既有的 `.tmp\d*$` 清理规则。
let atomicTmpSeq = 0;
function atomicTmpPath(filePath) {
  atomicTmpSeq = (atomicTmpSeq + 1) % 1000000;
  return filePath + '.tmp' + process.pid + String(atomicTmpSeq).padStart(6, '0');
}
async function atomicWriteFileP(filePath, data) {
  const tmp = atomicTmpPath(filePath);
  await writeFileP(tmp, data);
  try {
    await renameP(tmp, filePath);
  } catch {
    // Cross-device / locked-target fallback: keep best-effort plain write.
    try { await writeFileP(filePath, data); } finally {
      try { await unlinkP(tmp); } catch { /* ignore */ }
    }
  }
}

function writeConfig(cfg) {
  try {
    mkdirSync(dirname(configPath()), { recursive: true });
    atomicWriteFileSync(configPath(), JSON.stringify(cfg));
  } catch { /* ignore */ }
}

/**
 * Plugin settings (wallpaper selection, scrim/border/blur, rotation groups,
 * hidden ids, playback rate, flip, object-fit, filters, liquid-glass theme)
 * persisted in the SAME config.json as uploadDir — host-side, port-independent.
 * The browser half reads/writes them through GET/PUT /wallpaper-engine/settings:
 * the loopback port is random (`--port 0`) and changes on every DSH Desktop
 * restart, so storage keyed to the page origin cannot be the source of truth.
 */
const SETTINGS_FIELD = 'settings';

// config.json 写串行化：settings 与 uploadDir 的写都是「读-改-写」三步，
// 并发执行时后写者基于旧快照会吞掉先写者的改动。用一个简单的 promise 链
// 排队，让每次读-改-写完整跑完再开始下一次。
let configWriteQueue = Promise.resolve();
function enqueueConfigWrite(fn) {
  const p = configWriteQueue.then(fn, fn);
  // 队列本身永不 reject：一次失败只影响它自己的调用方，不阻塞后续写入。
  configWriteQueue = p.then(() => {}, () => {});
  return p;
}

function readSettings() {
  const cfg = readConfig();
  const s = cfg[SETTINGS_FIELD];
  return s && typeof s === 'object' ? s : null;
}

function writeSettings(settings) {
  return enqueueConfigWrite(() => {
    const cfg = readConfig();
    cfg[SETTINGS_FIELD] = settings;
    writeConfig(cfg);
    return settings;
  });
}

// ── 字体集（`fontsets/<id>.json`）的目录与活动 id ────────────────────────
/** 字体集目录。走 `pluginDataDir()`（认 `DSH_WE_DATA_DIR`）⇒ 守卫能整体隔离，绝不写真目录。 */
function fontSetsDir() { return join(pluginDataDir(), 'fontsets'); }

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


// ── Scene 独立音频（BGM/音效，WE 音频组件引用）──────────────────
// 长安雪等场景无内嵌 MP4，音轨以独立文件存放 —— scene-audio 路由此处抽出（取最大者当 BGM）。
const SCENE_AUDIO_EXT_RE = /\.(mp3|ogg|oga|wav|m4a|flac|aac)$/i;
const _sceneAudioState = new Map(); // abs → { sig, file: 缓存路径|null }
function sceneAudioCacheKey(abs, mtime) {
  return 'sa1_' + Buffer.from(abs, 'utf8').toString('base64url') + '_' + Math.round(mtime);
}
async function ensureSceneAudio(abs) {
  let mtime = 0;
  try { mtime = statSync(abs).mtimeMs; } catch { return null; }
  const sig = String(Math.round(mtime));
  const hit = _sceneAudioState.get(abs);
  if (hit && hit.sig === sig) return hit.file;
  let best = null;
  try {
    const { parsePkg } = await import('./pkg-read.js');
    if (abs.toLowerCase().endsWith('.json')) {
      const { readdirSync: rd } = await import('node:fs');
      const dirAbs = dirname(abs);
      for (const name of rd(dirAbs)) {
        if (!SCENE_AUDIO_EXT_RE.test(name)) continue;
        const p = join(dirAbs, name);
        try {
          const st = statSync(p);
          if (!best || st.size > best.size) best = { path: p, size: st.size, ext: name.split('.').pop().toLowerCase(), loose: true };
        } catch { /* ignore */ }
      }
    } else {
      const data = await readFile(abs);
      const entries = parsePkg(data);
      for (const e of entries) {
        const p = String(e.path || e.p || '');
        if (!SCENE_AUDIO_EXT_RE.test(p)) continue;
        const size = Number(e.size) || 0;
        if (best && size <= best.size) continue;
        best = { entry: e, path: p, size, ext: p.split('.').pop().toLowerCase(), loose: false, data };
      }
    }
  } catch { best = null; }
  let file = null;
  if (best) {
    const key = sceneAudioCacheKey(abs, mtime);
    const target = join(ensureFrameCacheDir(), key + '.' + best.ext);
    try {
      if (!existsSync(target)) {
        if (best.loose) {
          await atomicWriteFileP(target, await readFile(best.path));
        } else {
          const { readPkgEntry } = await import('./pkg-read.js');
          const bytes = readPkgEntry(best.data, best.entry);
          if (!bytes || !bytes.length) throw new Error('empty audio entry');
          await atomicWriteFileP(target, Buffer.from(bytes));
        }
      }
      file = target;
    } catch { file = null; }
  }
  _sceneAudioState.set(abs, { sig, file });
  return file;
}

// ── sceneVideo 字段的诚实来源: 「该 scene 主文件是否内嵌 MP4」探测缓存 ────────
// 字段必须诚实:「内嵌 MP4」只能由真实探测得出 —— 拿 hasFrame (静态帧可用性)
// 冒充它, 对几乎 100% 的 scene 壁纸都会输出 sceneVideo URL → 客户端请求 /scene-video/<token>
// 拿到 404 (客户端能容错, 但字段在说谎)。
// 真实探测 = 用 scene-manifest 的 extractSceneVideo* 遍历 .tex 找 MP4; 对
// 几百 MB 的 pkg 很贵, 因此: 结果按「pkg 路径 + mtime」缓存 (改/换 pkg 自动
// 重探, true/false 都存); inventory 只读缓存, 未命中 = 未知 → null (绝不猜)
// 并把探测投到后台。这里给出有界 LRU。
const _sceneVideoProbeCache = new Map(); // `${abs}|${mtimeMs}` → boolean (LRU: 尾部最新)
const SCENE_VIDEO_PROBE_MAX = 512; // 有界: 超出丢最旧
const SCENE_VIDEO_PROBE_CONCURRENCY = 2; // 大 pkg 读盘很重, 小并发即可
const _sceneVideoProbeQueue = []; // 待探测 { key, abs } (按 key 去重)
let _sceneVideoProbeActive = 0;

/** 探测缓存键: 主文件路径 + mtime (mtimeMs 省略时现取, 取不到按 0)。 */
function sceneVideoProbeKey(abs, mtimeMs) {
  let m = mtimeMs;
  if (m === undefined || m === null) {
    try { m = statSync(abs).mtimeMs; } catch { m = 0; }
  }
  return abs + '|' + Math.round(Number(m) || 0);
}

/** 读缓存: undefined = 未知 (调用方必须当 null 处理)。命中刷新 LRU 位置。 */
function sceneVideoProbeGet(key) {
  if (!_sceneVideoProbeCache.has(key)) return undefined;
  const v = _sceneVideoProbeCache.get(key);
  _sceneVideoProbeCache.delete(key);
  _sceneVideoProbeCache.set(key, v);
  return v;
}

/** 记录探测结果 (有界 LRU); 后台探测与真实路由共用。 */
function sceneVideoProbeSet(key, has) {
  if (_sceneVideoProbeCache.has(key)) _sceneVideoProbeCache.delete(key);
  _sceneVideoProbeCache.set(key, !!has);
  while (_sceneVideoProbeCache.size > SCENE_VIDEO_PROBE_MAX) {
    _sceneVideoProbeCache.delete(_sceneVideoProbeCache.keys().next().value);
  }
}

/** 投递后台探测 (未知才投; 已在队列或已有结果则跳过)。 */
function scheduleSceneVideoProbe(abs, key) {
  if (_sceneVideoProbeCache.has(key)) return;
  if (!_sceneVideoProbeQueue.some((j) => j.key === key)) _sceneVideoProbeQueue.push({ key, abs });
  drainSceneVideoProbeQueue();
}

/** 后台探测泵: 小并发; 任何失败都记「否」, 异常不会冒到 inventory。 */
function drainSceneVideoProbeQueue() {
  while (_sceneVideoProbeActive < SCENE_VIDEO_PROBE_CONCURRENCY && _sceneVideoProbeQueue.length) {
    const job = _sceneVideoProbeQueue.shift();
    if (_sceneVideoProbeCache.has(job.key)) continue; // 排队期间已有结果 (真实请求回填)
    _sceneVideoProbeActive++;
    // 与 /scene-video 路由同一条探测路径: 松散 scene.json 传目录, pkg 传文件。
    (async () => {
      // 先让出当前 macrotask: 松散目录的探测是完全同步的 (遍历 + 读文件),
      // 若就地执行会跑在 inventory 的 map 回调里 → 拖慢响应。推迟一拍再做。
      await new Promise((r) => setTimeout(r, 0));
      let has = false;
      try {
        const bytes = job.abs.toLowerCase().endsWith('.json')
          ? extractSceneVideoFromDir(dirname(job.abs))
          : extractSceneVideo(new Uint8Array(await readFile(job.abs)));
        has = !!(bytes && bytes.length);
      } catch { has = false; }
      sceneVideoProbeSet(job.key, has);
    })().then(
      () => { _sceneVideoProbeActive--; drainSceneVideoProbeQueue(); },
      () => { _sceneVideoProbeActive--; drainSceneVideoProbeQueue(); },
    );
  }
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

// ── Media metadata probe (minimal MP4 box walker) ───────────────────────────
// Reports { width, height, codec, fps } for a local MP4/MOV by reading its moov
// box (faststart files keep it near the head, normal files at the tail).
// Serves two purposes: the picker hint ("源 4K · 120fps · H.264") and the
// 帧率上限 decision — a source at/below the cap skips the transcode entirely.
const MEDIA_INFO_CACHE = new Map();
const VIDEO_CODECS = new Set(['avc1', 'hvc1', 'hev1', 'av01', 'vp09', 'mp4v']);

function readBoxes(buf, start, end, onBox) {
  let off = start;
  while (off + 8 <= end) {
    let size = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    let header = 8;
    if (size === 1) {
      if (off + 16 > end) break;
      size = Number(buf.readBigUInt64BE(off + 8));
      header = 16;
    } else if (size === 0) {
      size = end - off;
    }
    if (size < header || off + size > end) break;
    if (onBox(type, off, size, header)) return;
    off += size;
  }
}

function boxChild(buf, container, type) {
  let found = null;
  readBoxes(buf, container.off + container.header, container.off + container.size,
    (t, o, s, h) => { if (t === type) { found = { off: o, size: s, header: h }; return true; } return false; });
  return found;
}

function probeMp4(abs) {
  const fd = openSync(abs, 'r');
  try {
    const fileSize = fstatSync(fd).size;
    if (fileSize < 64) return null;
    const headLen = Math.min(fileSize, 8 * 1024 * 1024);
    const tailLen = Math.min(fileSize, 8 * 1024 * 1024);
    const head = Buffer.alloc(headLen);
    const tail = Buffer.alloc(tailLen);
    let read = 0;
    while (read < headLen) {
      const n = readSync(fd, head, read, headLen - read, read);
      if (n <= 0) break;
      read += n;
    }
    read = 0;
    while (read < tailLen) {
      const n = readSync(fd, tail, read, tailLen - read, fileSize - tailLen + read);
      if (n <= 0) break;
      read += n;
    }
    // Head candidates must live in the first 1MB (faststart); tail candidates
    // must END at (or just before) EOF — filters out random 'moov' runs in mdat.
    const findMoov = (buf, bufStart, anchoredToEof, limit) => {
      const scanEnd = Math.min(buf.length - 4, limit || buf.length);
      for (let i = scanEnd; i >= 4; i--) {
        if (buf[i] === 0x6d && buf[i + 1] === 0x6f && buf[i + 2] === 0x6f && buf[i + 3] === 0x76) {
          const s = buf.readUInt32BE(i - 4);
          const start = bufStart + i - 4;
          if (s >= 8 && start >= 0 && start + s <= fileSize + 8) {
            if (!anchoredToEof || (start + s >= fileSize - 128)) return { start, size: s };
          }
        }
      }
      return null;
    };
    const moov = findMoov(head, 0, false, 1024 * 1024)
      || findMoov(tail, fileSize - tailLen, true, tailLen);
    if (!moov) return null;
    const moovBuf = Buffer.alloc(moov.size);
    read = 0;
    while (read < moov.size) {
      const n = readSync(fd, moovBuf, read, moov.size - read, moov.start + read);
      if (n <= 0) break;
      read += n;
    }
    const moovEnd = moov.size;
    const traks = [];
    readBoxes(moovBuf, 8, moovEnd, (t, o, s, h) => { if (t === 'trak') traks.push({ off: o, size: s, header: h }); return false; });
    let best = null;
    for (const trak of traks) {
      const mdia = boxChild(moovBuf, trak, 'mdia');
      if (!mdia) continue;
      const hdlr = boxChild(moovBuf, mdia, 'hdlr');
      if (hdlr && moovBuf.toString('latin1', hdlr.off + hdlr.header + 8, hdlr.off + hdlr.header + 12) !== 'vide') continue;
      const mdhd = boxChild(moovBuf, mdia, 'mdhd');
      const minf = boxChild(moovBuf, mdia, 'minf');
      const stbl = minf ? boxChild(moovBuf, minf, 'stbl') : null;
      const stsd = stbl ? boxChild(moovBuf, stbl, 'stsd') : null;
      const stts = stbl ? boxChild(moovBuf, stbl, 'stts') : null;
      const info = { width: 0, height: 0, codec: null, fps: null };
      if (stsd) {
        const entryStart = stsd.off + stsd.header + 8;
        if (entryStart + 52 <= moovEnd) {
          const codec = moovBuf.toString('latin1', entryStart + 4, entryStart + 8);
          if (VIDEO_CODECS.has(codec)) {
            info.codec = codec;
            info.width = moovBuf.readUInt16BE(entryStart + 32);
            info.height = moovBuf.readUInt16BE(entryStart + 34);
          }
        }
      }
      if (mdhd && info.codec) {
        const ver = moovBuf.readUInt8(mdhd.off + mdhd.header);
        const timescale = ver === 1
          ? Number(moovBuf.readBigUInt64BE(mdhd.off + mdhd.header + 20))
          : moovBuf.readUInt32BE(mdhd.off + mdhd.header + 12);
        const duration = ver === 1
          ? Number(moovBuf.readBigUInt64BE(mdhd.off + mdhd.header + 28))
          : moovBuf.readUInt32BE(mdhd.off + mdhd.header + 16);
        if (timescale > 0 && duration > 0) {
          info.duration = Math.round((duration / timescale) * 100) / 100;
          if (stts) {
            const entryCount = moovBuf.readUInt32BE(stts.off + stts.header + 4);
            let samples = 0, ticks = 0;
            for (let i = 0; i < entryCount; i++) {
              const e = stts.off + stts.header + 8 + i * 8;
              if (e + 8 > moovEnd) break;
              const cnt = moovBuf.readUInt32BE(e);
              const delta = moovBuf.readUInt32BE(e + 4);
              samples += cnt; ticks += cnt * delta;
            }
            if (ticks > 0) info.fps = Math.round((samples * timescale / ticks) * 100) / 100;
          }
        }
      }
      if (info.codec) { best = info; break; }
    }
    if (best && (best.fps || best.width)) {
      // moov 位置：faststart 判据（见 needsFaststart）+ 诊断口径。
      best.moovStart = moov.start;
      best.moovSize = moov.size;
      return best;
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

function getMediaInfo(abs) {
  if (!abs || !existsSync(abs)) return null;
  const st = statSync(abs);
  const key = abs + '|' + st.size + '|' + Math.round(st.mtimeMs);
  if (MEDIA_INFO_CACHE.has(key)) return MEDIA_INFO_CACHE.get(key);
  let info = null;
  try { info = probeMp4(abs); } catch { info = null; }
  if (MEDIA_INFO_CACHE.size > 500) {
    const first = MEDIA_INFO_CACHE.keys().next().value;
    if (first !== undefined) MEDIA_INFO_CACHE.delete(first);
  }
  MEDIA_INFO_CACHE.set(key, info);
  return info;
}

// ── Frame-skip transcode (抽帧转码, ffmpeg) ──────────────────────────────────
// The decode-side fps cap is implemented as a re-encode, NOT playbackRate:
// playbackRate is a speed multiplier, so slowing decode also slows motion.
// Instead the host transcodes the wallpaper ONCE to the capped frame rate
// (4K120 → 4K60: ffmpeg drops every other frame, timeline stays 1.0x, reference
// chains are re-encoded intact) and the browser plays a normal capped-fps file.
// Output is AV1 via NVENC (decode throughput ≈ 2× H.264 on NVDEC, so decode
// util roughly halves again), falling back to H.264 when AV1 encode is missing.
// ffmpeg resolution: DSH_WE_FFMPEG env → a local ./ffmpeg/ffmpeg(.exe) next to
// the bundle → system PATH. Missing ffmpeg ⇒ the transcode route errors and the
// client transparently keeps the original file (feature degrades gracefully).
const TRANSCODE_INFLIGHT = new Map();
// Hard deadline for ONE ffmpeg transcode job (covers ALL encoder attempts of
// that job — the timer no longer restarts per attempt — so a hung encode can
// never leave /transcoded waiting forever: the child is killed and the route
// answers 502, and the client falls back to the original). Queue wait behind
// the concurrency gate below does NOT consume the budget; the deadline starts
// when the job actually begins encoding. Overridable via
// DSH_WE_TRANSCODE_TIMEOUT_MS (ms).
const TRANSCODE_TIMEOUT_MS = Number(process.env.DSH_WE_TRANSCODE_TIMEOUT_MS) || 15 * 60 * 1000;
/** Active ffmpeg child processes, so a job deadline can kill them. */
const ACTIVE_FFMPEG = new Set();

// 全局转码并发闸：ffmpeg 重编码吃满 CPU/GPU 解码器，N 个并发只会一起变慢，
// 不会变快。最多 2 个并发，其余排队（排队不计入 TRANSCODE_TIMEOUT_MS，
// deadline 从拿到闸、开始编码起算）。
const TRANSCODE_MAX_CONCURRENT = 2;
let transcodeActive = 0;
const transcodeWaiters = [];
function acquireTranscodeSlot() {
  if (transcodeActive < TRANSCODE_MAX_CONCURRENT) {
    transcodeActive += 1;
    return Promise.resolve();
  }
  return new Promise((resolveSlot) => transcodeWaiters.push(resolveSlot));
}
function releaseTranscodeSlot() {
  const next = transcodeWaiters.shift();
  // 有等待者：名额直接移交（计数不变）；无等待者：名额归还。
  if (next) next();
  else transcodeActive -= 1;
}

function transcodeCacheDir() {
  const base = process.env.DSH_WE_CACHE_DIR && process.env.DSH_WE_CACHE_DIR.trim()
    ? process.env.DSH_WE_CACHE_DIR.trim()
    : join(dirname(configPath()), 'cache');
  return join(base, 'transcodes');
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

function ensureTranscodeCacheDir() {
  return ensureDirOnce(transcodeCacheDir());
}

// ── faststart 变体（moov 在文件尾部的源）──────────────────────────────────────
// 为什么需要它：Chromium 的媒体加载器对 `Range: bytes=0-` 的响应会**顺流整读**，而这几张源的
// moov 在文件尾部 ⇒ 元数据（duration/尺寸）要读到文件末尾才出来，耗时 ∝ 文件大小。真机
// `media-req` 取证（官方壳，2026-10-02）：
//   iris2 764,688,296B / 1761ms · lv_0 501,752,315B / 1250ms · kei 155,604,213B / 357ms
//   · ahq 101,749,329B / 324ms（≈430MB/s），而**同一个 iris2** 在"页面刚加载后的第一张"
//   那条路上只要 149–233ms —— 两者差别正是 moov 在不在前面。
// 修法：一次性 `-c copy -movflags +faststart` 把 moov 挪到文件头（**不重编码**，几秒），
// 按"源路径+大小+mtime"缓存复用 ⇒ 播放器第一段就能拿到 moov，与文件大小无关。
// 取不到/生成失败一律照旧服务原片：这条是优化，绝不允许它让壁纸播不出来。
const FASTSTART_INFLIGHT = new Map();
const FASTSTART_FAILED = new Set();
const FASTSTART_TIMEOUT_MS = 5 * 60 * 1000;
const FASTSTART_CACHE_MAX_BYTES = 8 * 1024 * 1024 * 1024;
/** 预热时最多为多少字节的源排队生成变体（见 warmFaststartFavorites）。 */
const FASTSTART_WARM_MAX_BYTES = 6 * 1024 * 1024 * 1024;
/** 命中变体时"顶 mtime"（LRU 按使用而非创建时间淘汰）——**不必每个请求都写一次盘**，节流。 */
const FASTSTART_TOUCH = new Map();
const FASTSTART_TOUCH_MIN_MS = 5 * 60 * 1000;
/**
 * **每个 token 在一次宿主运行里钉住"用哪份字节"**。
 *
 * 为什么必须有：原片与变体的**字节偏移不同**（moov 从头挪到尾）。若同一次播放里第一次请求
 * 拿到原片、第二次请求（变体刚生成完）拿到变体，解复用器就按旧偏移去读新布局 ⇒ 花屏/解码失败。
 * 所以"这一份播放用哪个文件"只由**第一次**请求决定，之后一直用它；命中会**续期**（2026-10-02
 * 审计：循环壁纸一次播放远超 TTL，固定窗口会在会话中途换字节布局），TTL 只兜底回收早已
 * 无人问津的钉子。
 */
const MEDIA_CHOICE_PIN = new Map();
const MEDIA_PIN_TTL_MS = 10 * 60 * 1000;
function faststartCacheDir() {
  return ensureDirOnce(join(dirname(configPath()), 'cache', 'faststart'));
}
function faststartPath(abs) {
  const st = statSync(abs);
  const key = createHash('sha256')
    .update(abs + '|' + st.size + '|' + Math.round(st.mtimeMs) + '|fs1')
    .digest('hex').slice(0, 20);
  return join(faststartCacheDir(), 'fs_' + key + '.mp4');
}
/** 需要 faststart 吗：mp4/m4v/mov 且 moov 不在头部附近（>1MB）。判不了就 false（保守）。 */
function needsFaststart(abs) {
  const ext = extOf(abs);
  if (ext !== 'mp4' && ext !== 'm4v' && ext !== 'mov') return false;
  let info = null;
  try { info = getMediaInfo(abs); } catch { return false; }
  if (!info || !Number.isFinite(info.moovStart)) return false;
  return info.moovStart > 1024 * 1024;
}
/**
 * 这一份播放该用哪个文件：**第一次请求定音**，之后一直用它（见 MEDIA_CHOICE_PIN）。
 * 变体已缓存 ⇒ 用它；没有 ⇒ 本次用原片并后台生成（绝不为了"下次快"去动正在播的那一份）。
 */
function pinnedFaststartVariant(abs, token, logFn) {
  if (!abs) return null;
  const key = String(token || abs);
  const pin = MEDIA_CHOICE_PIN.get(key);
  const now = Date.now();
  if (pin && now - pin.at < MEDIA_PIN_TTL_MS) {
    pin.at = now;                             // 命中即续期：播放会话内绝不换字节布局
    // 钉住的若是变体，说明它还在缓存里（被 LRU 删掉就退回原片，宁可这次慢也不要换布局）。
    if (!pin.variant) return null;
    if (existsSync(pin.variant)) { touchFaststart(pin.variant); return pin.variant; }
    pin.variant = null;                       // 变体没了 ⇒ 钉成原片
    return null;
  }
  const variant = faststartVariant(abs, logFn);   // 内部：命中就返回，否则后台起、返回 null
  MEDIA_CHOICE_PIN.set(key, { variant, at: now });
  // 上限保护：钉子只是短命状态，别让它随库增长。
  if (MEDIA_CHOICE_PIN.size > 200) {
    const oldest = [...MEDIA_CHOICE_PIN.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) MEDIA_CHOICE_PIN.delete(oldest[0]);
  }
  return variant;
}
/** 命中即"用过一次"：顶 mtime 让 LRU 按使用而不是创建时间淘汰；同一份 5 分钟内只写一次盘。 */
function touchFaststart(file) {
  const now = Date.now();
  if (now - (FASTSTART_TOUCH.get(file) || 0) < FASTSTART_TOUCH_MIN_MS) return;
  FASTSTART_TOUCH.set(file, now);
  try { const d = new Date(now); utimesSync(file, d, d); } catch { /* ignore */ }
}
/** 已缓存的 faststart 变体（没有就后台生成并返回 null，本次照旧服务原片）。 */
function faststartVariant(abs, logFn) {
  if (!abs) return null;
  let out = null;
  try {
    if (!needsFaststart(abs)) return null;
    out = faststartPath(abs);
    if (existsSync(out)) {
      touchFaststart(out);
      return out;
    }
  } catch { return null; }
  kickFaststart(abs, out, logFn);
  return null;
}
/**
 * 后台生成（同一份只跑一次；失败记下不再重试，避免反复起 ffmpeg）。
 *
 * ⚠️ **这一族是模块级函数，拿不到 `apply()` 里的 `log`** —— 真机事故（2026-10-02 晚·官方壳）：
 * 失败分支里写了 `log.warn(...)` ⇒ `ReferenceError: log is not defined` ⇒ 抛在 catch 里 ⇒ 这个
 * async 任务以 reject 收场且无人接管 ⇒ Node 24 按**未处理拒绝**杀掉宿主进程
 * （崩溃日志：`dsh: fatal load failure: ReferenceError: log is not defined at lib/index.js:1235`）
 * ⇒ DSH 反复重启宿主、壁纸一直出不来（用户看到的就是"开屏纯色帧 + 切几张后 DSH 崩溃重启"）。
 * 所以：日志一律经参数注入的 `say`（可缺省），并且给任务挂一个**兜底 catch**，任何异常都不许
 * 让宿主进程死掉。
 */
function kickFaststart(abs, out, logFn) {
  if (!out || FASTSTART_INFLIGHT.has(out) || FASTSTART_FAILED.has(out)) return;
  const say = (level, msg) => { try { if (logFn && typeof logFn[level] === 'function') logFn[level](msg); } catch { /* 日志绝不许反过来影响流程 */ } };
  const job = (async () => {
    const tmp = atomicTmpPath(out);
    try {
      const ff = await resolveFfmpeg(null);
      await spawnFfmpeg(ff, ['-y', '-hide_banner', '-nostdin', '-i', abs,
        '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', tmp], FASTSTART_TIMEOUT_MS, {});
      renameSync(tmp, out);
      // info：一次性成本 + 以后每次切换都受益 ⇒ 成功事实走 info 档。
      say('info', '视频壁纸 faststart 变体已生成：' + basename(abs));
      // 同时落一份诊断行：桌面壳默认安静档，没有它这条成功事实在真机上无从核对。
      try { appendDiagLine('faststart', { file: basename(abs), size: statSync(abs).size }); } catch { /* ignore */ }
    } catch (err) {
      try { unlinkSync(tmp); } catch { /* ignore */ }
      FASTSTART_FAILED.add(out);
      say('warn', '视频壁纸 faststart 变体生成失败（照旧服务原片）：'
        + String((err && err.message) || err));
    } finally {
      FASTSTART_INFLIGHT.delete(out);
    }
  })();
  // 兜底：即便上面还漏了什么，也绝不让它变成"未处理拒绝"把宿主带走。
  job.catch(() => { /* 见本函数的 ⚠️ */ });
  FASTSTART_INFLIGHT.set(out, job);
}

// ── Lazy ffmpeg provisioning (B + C + D) ─────────────────────────────────────
// Resolution chain (each level falls through to the next):
//   B. system PATH (bare name)                       ← last resort
//   C. lazy download cache ~/.dsh-wallpaper-engine/ffmpeg/ffmpeg[.exe]
//      (pinned single-file ffmpeg-static release asset, magic-byte + size
//      verified, atomic rename; runs once per machine, then cached)
//   env DSH_WE_FFMPEG  /  plugin-local ./ffmpeg/     ← explicit overrides
// Downloaded binaries are pinned by sha256 (FFMPEG_STATIC_SHA256, computed from
// the b6.0 release bytes) — a mismatch aborts before anything is executed; the
// magic-byte + size checks remain as a second layer.
const FFMPEG_STATIC_TAG = 'b6.0';
// process.platform → process.arch → release asset name (ffmpeg-static naming).
const FFMPEG_STATIC_ASSETS = {
  win32: { x64: 'ffmpeg-win32-x64', ia32: 'ffmpeg-win32-ia32' },
  linux: { x64: 'ffmpeg-linux-x64', ia32: 'ffmpeg-linux-ia32', arm: 'ffmpeg-linux-arm', arm64: 'ffmpeg-linux-arm64' },
  darwin: { x64: 'ffmpeg-darwin-x64', arm64: 'ffmpeg-darwin-arm64' },
};
// Pinned sha256 for every asset in FFMPEG_STATIC_ASSETS (ffmpeg-static b6.0).
// Computed from the exact release bytes served by both registry.npmmirror.com
// and github.com/eugeneware/ffmpeg-static releases/download/b6.0 (cross-verified
// on win32-x64; npmmirror mirrors the GitHub asset byte-for-byte). A mismatch
// aborts the download instead of executing an unverified binary.
const FFMPEG_STATIC_SHA256 = {
  'ffmpeg-win32-x64': 'e9fd5e711debab9d680955fc1e38a2c1160fd280b144476cc3f62bc43ef49db1',
  'ffmpeg-win32-ia32': 'fb3766af5cc193ca863e15cd4554a33732973209dad5e3c1433b5e291bceb16c',
  'ffmpeg-linux-x64': 'ed652b2f32e0851d1946894fb8333f5b677c1b2ce6b9d187910a67f8b99da028',
  'ffmpeg-linux-ia32': '103500b65ccb78c3c804088d6e17111d85e2bd03f5a0c61c349dc2d05e165f09',
  'ffmpeg-linux-arm': '1a9ddc19d0e071b6e1ff6f8f34dc05ec6dd4d8f3e79a649f5a9ec0e8c929c4cb',
  'ffmpeg-linux-arm64': '237800b37bb65a81ad47871c6c8b7c45c0a3ca62a5b3f9d2a7a9a2dd9a338271',
  'ffmpeg-darwin-x64': 'cfe20936c83ecf5d68e424b87e8cc45b24dd6be81787810123bb964a0df686f9',
  'ffmpeg-darwin-arm64': 'a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584',
};

function ffmpegDataDir() {
  const dir = join(dirname(configPath()), 'ffmpeg');
  try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return dir;
}
function ffmpegExeName() {
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

// Startup-only sweep of orphaned transcode/download artifacts (see apply()).
// Matches: `*.tmp<pid>` transcode outputs, `*.prog` progress files (legacy),
// `*.part*` download partials, `ffmpeg-err-*.log` spawn logs. Runs once before
// any route is served, so nothing of the current process is ever touched.
function sweepTranscodeArtifacts() {
  const dirs = [transcodeCacheDir(), ffmpegDataDir(), videoPreviewCacheDir()];
  // A plugin HMR/re-apply re-runs this sweep while the SAME process may still be
  // mid-transcode; never delete artifacts owned by the current pid (the ffmpeg
  // child keeps writing to `.tmp<pid>` — removing it would corrupt the job).
  // ⚠️ 尾部要允许**递增序号**：转码临时名走 `atomicTmpPath`（`.tmp<pid><6 位序号>`），
  // 只认 `.tmp<pid>` 结尾会让"保护本进程在途写"这条在改名后静默失效（HMR 时删掉正在写的产物）。
  const ownTmpRe = new RegExp('\\.tmp' + process.pid + '\\d*$');
  for (const dir of dirs) {
    let entries = [];
    try { entries = readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      if (ownTmpRe.test(name)) continue;
      if (!(/\.tmp\d*$/.test(name) || /\.part\d*$/.test(name)
        || /\.prog$/.test(name) || /^ffmpeg-err-/.test(name))) continue;
      try { unlinkSync(join(dir, name)); } catch { /* ignore */ }
    }
  }
}

/**
 * 自定义画面目录的孤儿 `.tmp` 清扫。
 *
 * `/custom-frame` 的"中途放弃"已由 `req 'close'` 收口（见 `routes/scene-frame.js` 文件头的不变量）
 * ⇒ 正常路径不再留孤儿。剩下的来源是**进程被强杀 / 崩溃**：写流随进程消失，`.tmp` 留在盘上。
 * 而读取侧（`customFramePath` / `listCustomFrameIds`）只认 `.png|.jpg|.webp` ⇒ 那种垃圾
 * **看不见**、只会累积（`sweepTranscodeArtifacts` 扫的三个目录都不含自定义画面目录）。
 *
 * ⚠️ 只清**够旧**的：HMR 重新 apply 会再跑一次本清扫，而同一进程里可能正有一个上传在写那个
 * 确定性的 `.tmp` 名 —— 按年龄设限就不会误删在途写（与 `sweepTranscodeArtifacts` 的
 * `ownTmpSuffix` 是同一类保护，这里是时间口径）。
 */
const CUSTOM_FRAME_TMP_STALE_MS = 10 * 60 * 1000;
function sweepCustomFrameTmp(dir) {
  let entries = [];
  try { entries = readdirSync(dir); } catch { return; }
  const cutoff = Date.now() - CUSTOM_FRAME_TMP_STALE_MS;
  for (const name of entries) {
    if (!name.endsWith('.tmp')) continue;
    const abs = join(dir, name);
    try { if (statSync(abs).mtimeMs > cutoff) continue; } catch { continue; }
    try { unlinkSync(abs); } catch { /* ignore */ }
  }
}

function ffmpegMagicOk(buf) {
  if (buf.length < 4) return false;
  // PE (Windows): "MZ"; ELF: 0x7F 'ELF'; Mach-O 64: CF FA ED FE.
  const mz = buf[0] === 0x4d && buf[1] === 0x5a;
  const elf = buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46;
  const mach = buf[0] === 0xcf && buf[1] === 0xfa && buf[2] === 0xed && buf[3] === 0xfe;
  return mz || elf || mach;
}

let ffmpegDownloadPromise = null;
// Last download failure (URL + reason) surfaced in the transcode 502 detail,
// so a bad tag/URL, blocked network or missing fetch is diagnosable instead of
// looking like a spawn problem.
let lastFfmpegDownloadError = null;

// Active transcode-job progress, keyed by abs|fps, polled by the picker's
// progress bar via GET /transcode-progress/<token>?fps=N:
//   phase 'download'  — bytes/total (content-length when the mirror sends it)
//   phase 'transcode' — output-file growth (see runFfmpegTranscode)
//   phase 'done'      — cached file is ready to serve
//   phase 'error'     — the job failed (client falls back to the original)
// Per-JOB entries (not a single global slot), so rotation can run several
// transcodes in parallel and each wallpaper still sees its own progress.
const transcodeJobs = new Map();
const TRANSCODE_JOBS_MAX = 64;
function setTranscodeJob(job) {
  transcodeJobs.set(job.key, job);
  if (transcodeJobs.size > TRANSCODE_JOBS_MAX) {
    const first = transcodeJobs.keys().next().value;
    if (first !== undefined) transcodeJobs.delete(first);
  }
}

// Download sources, raced in parallel (first success wins — the fastest mirror
// for THIS user wins automatically, no region pre-sorting):
//   npmmirror  — fast for CN users (validated ~2 min for the 70MB binary)
//   GitHub     — fast for everyone else
// `DSH_WE_FFMPEG_URL` replaces the list (user-chosen mirror / self-hosted).
function ffmpegDownloadUrls(asset) {
  const env = process.env.DSH_WE_FFMPEG_URL && process.env.DSH_WE_FFMPEG_URL.trim();
  if (env) return [env];
  return [
    'https://registry.npmmirror.com/-/binary/ffmpeg-static/' + FFMPEG_STATIC_TAG + '/' + asset,
    'https://github.com/eugeneware/ffmpeg-static/releases/download/' + FFMPEG_STATIC_TAG + '/' + asset,
  ];
}

// Stream one source to its .part file (visible progress on disk, no 70MB
// in-memory buffer), computing a streaming sha256. The caller owns the abort
// signal (per-source timeout / loser cancellation).
async function downloadFfmpegToFile(url, tmp, ctrl, job) {
  const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': 'dsh-wallpaper-engine' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  if (!res.body) throw new Error('no response body');
  const reader = res.body.getReader();
  const fd = openSync(tmp, 'w');
  let total = 0;
  const totalBytes = Number(res.headers.get('content-length')) || 0;
  if (job && job.phase === 'download') {
    job.total = totalBytes;
    job.source = url;
  }
  const hash = createHash('sha256');
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length) {
        let off = 0;
        while (off < value.length) {
          off += writeSync(fd, value, off, value.length - off);
        }
        hash.update(value);
        total += value.length;
        if (job && job.phase === 'download') {
          job.downloaded = total;
        }
      }
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (total < 20 * 1024 * 1024) throw new Error('implausible size ' + total);
  const head = Buffer.alloc(8);
  const rfd = openSync(tmp, 'r');
  try {
    let got = 0;
    while (got < 8) { const n = readSync(rfd, head, got, 8 - got, got); if (n <= 0) break; got += n; }
  } finally {
    closeSync(rfd);
  }
  if (!ffmpegMagicOk(head)) throw new Error('unrecognized binary magic');
  return { total, sha256: hash.digest('hex') };
}

async function ensureDownloadedFfmpeg(job) {
  const target = join(ffmpegDataDir(), ffmpegExeName());
  if (existsSync(target)) return target;
  const assets = FFMPEG_STATIC_ASSETS[process.platform];
  const asset = assets && assets[process.arch];
  if (!asset) {
    lastFfmpegDownloadError = 'unsupported platform ' + process.platform + '/' + process.arch;
    return null;
  }
  if (typeof fetch !== 'function') {
    lastFfmpegDownloadError = 'fetch unavailable (Node < 18?)';
    return null;
  }
  if (ffmpegDownloadPromise) return ffmpegDownloadPromise;
  ffmpegDownloadPromise = (async () => {
    const urls = ffmpegDownloadUrls(asset);
    const ctrls = urls.map(() => new AbortController());
    const tmpFiles = urls.map((u, i) => target + '.part' + i);
    const timers = ctrls.map((c) => setTimeout(() => c.abort(), 5 * 60 * 1000));
    const errors = [];
    const cleanup = () => timers.forEach(clearTimeout);
    const win = await new Promise((resolve) => {
      let done = false;
      let remaining = urls.length;
      urls.forEach((url, i) => {
        downloadFfmpegToFile(url, tmpFiles[i], ctrls[i], job)
          .then((r) => {
            if (done) return;
            const want = FFMPEG_STATIC_SHA256[asset];
            if (want && r.sha256 !== want) {
              errors.push(url + ' → sha256 mismatch');
              try { unlinkSync(tmpFiles[i]); } catch { /* ignore */ }
              remaining--; if (remaining === 0) { done = true; resolve(-1); }
              return;
            }
            done = true;
            resolve(i);
          })
          .catch((err) => {
            if (done) return;
            errors.push(url + ' → ' + String(err && err.message ? err.message : err));
            remaining--; if (remaining === 0) { done = true; resolve(-1); }
          });
      });
    });
    cleanup();
    if (win < 0) {
      try { tmpFiles.forEach((f) => { try { unlinkSync(f); } catch { /* ignore */ } }); } catch { /* ignore */ }
      lastFfmpegDownloadError = errors.join('; ') || 'all sources failed';
      return null;
    }
    for (let i = 0; i < ctrls.length; i++) {
      if (i !== win) {
        ctrls[i].abort();
        try { unlinkSync(tmpFiles[i]); } catch { /* ignore */ }
      }
    }
    if (process.platform !== 'win32') { try { chmodSync(tmpFiles[win], 0o755); } catch { /* ignore */ } }
    renameSync(tmpFiles[win], target);
    lastFfmpegDownloadError = null;
    return target;
  })().catch((err) => {
    lastFfmpegDownloadError = 'download internal error: ' + String(err && err.message ? err.message : err);
    return null;
  }).finally(() => {
    ffmpegDownloadPromise = null;
  });
  return ffmpegDownloadPromise;
}

// Async resolution chain (the C level may download on first use).
async function resolveFfmpeg(job) {
  if (process.env.DSH_WE_FFMPEG && process.env.DSH_WE_FFMPEG.trim()) {
    return process.env.DSH_WE_FFMPEG.trim();
  }
  try {
    const local = join(dirname(fileURLToPath(import.meta.url)), '..', 'ffmpeg', ffmpegExeName());
    if (existsSync(local)) return local;
  } catch { /* ignore */ }
  const dl = await ensureDownloadedFfmpeg(job);
  if (dl) return dl;
  return ffmpegExeName(); // system PATH
}

// Spawn ffmpeg for the (potentially long) background transcode. The dsh web
// process runs in a constrained spawn context (observed: console-app children
// dying at startup with 0xFFFFFFEA = -22, and piped stdio failing with EPERM).
// We therefore: (1) never use pipes — stderr is redirected to a temp FILE so
// its content survives into the 502 detail; (2) try, in order: a detached
// process group (own hidden console), then a plain direct spawn; (3) keep
// EVERY attempt's error so the final message shows the full picture.
// `timeoutMs` is the per-attempt budget handed down from the JOB deadline
// (runFfmpegTranscode computes it as the remaining time, so all encoder
// attempts share one 15min wall-clock budget instead of 15min each).
// opts.signal (AbortSignal) additionally cancels the running ffmpeg (client
// disconnect / wallpaper switch).
function spawnFfmpeg(ff, args, timeoutMs, opts = {}) {
  const limit = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : TRANSCODE_TIMEOUT_MS;
  const signal = (opts && opts.signal) || null;
  return new Promise((resolve, reject) => {
    const errLog = join(ensureTranscodeCacheDir(), 'ffmpeg-err-' + process.pid + '-' + Date.now() + '.log');
    const attempts = [
      { name: 'detached', opts: { detached: true, windowsHide: true } },
      { name: 'plain', opts: { windowsHide: true } },
    ];
    let idx = 0;
    let curProc = null;
    const onAbort = () => {
      if (curProc) { try { curProc.kill(); } catch { /* ignore */ } }
    };
    // 监听器无条件挂一次 (不能因 signal.aborted 为真就 return): abort 已在
    // 「检查」与「spawn」之间发生时, 第二次尝试会 spawn 出一个没有任何 abort 监听
    // 的子进程 —— 无人取消, 它就一直编码到超时。abort 后再挂监听不会触发,
    // 由下面的 spawn 后复查兜底。
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const errors = [];
    const runNext = () => {
      if (idx >= attempts.length) {
        if (signal) signal.removeEventListener('abort', onAbort);
        let detail = errors.join('; ');
        try {
          const t = readFileSync(errLog, 'utf8').trim();
          if (t) detail += ' | stderr: ' + t.split('\n').slice(-4).join(' | ');
        } catch { /* ignore */ }
        try { unlinkSync(errLog); } catch { /* ignore */ }
        reject(new Error('ffmpeg spawn failed' + (detail ? ': ' + detail : '')));
        return;
      }
      const a = attempts[idx++];
      let errFd = null;
      try { errFd = openSync(errLog, 'w'); } catch { /* ignore */ }
      let proc = null;
      try {
        // cwd: Windows 用 SystemRoot (console-app 启动稳定性, 见上方注释);
        // 非 Windows 必须给真实存在的目录 — 回退 'C:\\' 在 Linux/macOS 上不存在
        // → spawn ENOENT → ffmpeg 必然启动失败（cwd 必须是真实存在的目录）。
        const spawnCwd = process.env.SystemRoot
          || (process.platform === 'win32' ? 'C:\\' : undefined);
        proc = spawn(a.file || ff, a.args || args,
          { ...a.opts, cwd: spawnCwd, stdio: errFd ? ['ignore', 'ignore', errFd] : 'ignore' });
      } catch (err) {
        if (errFd) { try { closeSync(errFd); } catch { /* ignore */ } }
        errors.push(a.name + ' spawn throw ' + (err && err.code ? err.code : err));
        runNext();
        return;
      }
      curProc = proc;
      // Track the child so a job deadline (see TRANSCODE_TIMEOUT_MS) can kill it
      // even while it is detached / mid-encode.
      ACTIVE_FFMPEG.add(proc);
      // spawn 与上面的 signal 检查之间的 abort 竞态: 此时 onAbort 早已返回
      // (curProc 还是 null), 该子进程不会收到任何取消 → 刚起的进程立刻杀掉并
      // 结束整个尝试链 (不 spawn 第二次), 避免切换壁纸后它继续编码到超时。
      if (signal && signal.aborted) {
        try { proc.kill(); } catch { /* ignore */ }
        ACTIVE_FFMPEG.delete(proc);
        curProc = null;
        if (errFd) { try { closeSync(errFd); } catch { /* ignore */ } }
        signal.removeEventListener('abort', onAbort);
        try { unlinkSync(errLog); } catch { /* ignore */ }
        reject(new Error('ffmpeg aborted'));
        return;
      }
      let done = false;
      let timedOut = false;
      const settle = (msg) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        ACTIVE_FFMPEG.delete(proc);
        if (curProc === proc) curProc = null;
        if (errFd) { try { closeSync(errFd); } catch { /* ignore */ } }
        errors.push(msg);
        runNext();
      };
      const timer = setTimeout(() => {
        timedOut = true;
        try { proc.kill(); } catch { /* ignore */ }
        settle(a.name + ' timed out after ' + limit + 'ms');
      }, limit);
      proc.on('error', (err) => {
        settle(a.name + ' spawn error ' + (err && err.code ? err.code + ' ' + err.message : err));
      });
      proc.on('exit', (code) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        ACTIVE_FFMPEG.delete(proc);
        if (curProc === proc) curProc = null;
        if (errFd) { try { closeSync(errFd); } catch { /* ignore */ } }
        if (code === 0) {
          try { unlinkSync(errLog); } catch { /* ignore */ }
          if (signal) signal.removeEventListener('abort', onAbort);
          resolve();
          return;
        }
        errors.push(a.name + ' exit ' + code + (timedOut ? ' (killed by timeout)' : ''));
        runNext();
      });
    };
    runNext();
  });
}

async function runFfmpegTranscode(abs, out, fps, signal) {
  const key = abs + '|' + fps;
  // Download phase: resolveFfmpeg may lazy-download ffmpeg (bytes/total).
  const job = { key, phase: 'download', downloaded: 0, total: 0, source: '' };
  setTranscodeJob(job);
  const ff = await resolveFfmpeg(job);
  const mi = getMediaInfo(abs);
  // Real-time progress source: ffmpeg's `-progress FILE` output is BUFFERED and
  // invisible until the process exits on this platform, so instead we encode at
  // a fixed bitrate (size ∝ time) and derive percent/ETA from the OUTPUT FILE
  // size, which the muxer grows continuously. Bitrate scales with resolution.
  const pixels = mi && mi.width && mi.height ? mi.width * mi.height : 3840 * 2160;
  const bitrate = Math.round(Math.min(20e6, Math.max(4e6, 20e6 * pixels / (3840 * 2160))));
  job.phase = 'transcode';
  job.downloaded = 0;
  job.total = 0;
  job.source = ff;
  job.outFile = out;
  job.expectedBytes = mi && mi.duration ? Math.round((bitrate / 8) * mi.duration) : null;
  job.samples = []; // [{t, size}] rolling samples for growth-rate / ETA
  const base = ['-y', '-hide_banner', '-loglevel', 'error', '-i', abs,
    '-map', '0:v:0', '-an',
    '-vf', 'fps=' + String(fps), '-g', String(fps * 2)];
  // ★ 质量参数必须**按编码器**给：`-preset p1` 是 NVENC 专属，软件编码器会直接报
  //   `x264 [error]: invalid preset 'p1'` ⇒ 光把 -c:v 换成 libx264 也是死。
  //   自动下载的 ffmpeg-static（johnvansickle）**不含 NVENC**（`-encoders` 里没有
  //   h264_nvenc/av1_nvenc），所以在没有系统 ffmpeg 的机器上，软件兜底是唯一出路。
  const ENC_TUNE = {
    av1_nvenc: ['-preset', 'p1', '-b:v', String(bitrate), '-maxrate', String(bitrate), '-bufsize', String(bitrate * 2)],
    h264_nvenc: ['-preset', 'p1', '-b:v', String(bitrate), '-maxrate', String(bitrate), '-bufsize', String(bitrate * 2)],
    // 软件兜底：capped CRF（不叠 -b:v，避免与 crf 语义打架）。一次性缓存，慢一点可接受。
    libx264: ['-preset', 'veryfast', '-crf', '20'],
  };
  // 输出时长限制: 部分源视频容器帧率信息异常 (实测 100k fps/100k tbn),
  // 这种输入下 `-r fps` 纠正不了 → ffmpeg 按输入帧率解码并大量复制帧 (5 万帧)
  // 卡死 + 长时间占满 CPU。fps 滤镜做正确 CFR 采样 + -t 限制输出时长。
  if (mi && mi.duration && isFinite(mi.duration) && mi.duration > 0) {
    base.push('-t', String(mi.duration));
  }
  // 整个任务所有编码尝试共享一个 deadline（见 TRANSCODE_TIMEOUT_MS 注释）：
  // 每次 spawn 只拿到剩余预算，避免「每种编码器各 15 分钟」的预算重计。
  const deadline = Date.now() + TRANSCODE_TIMEOUT_MS;
  let lastErr = null;
  // 顺序：AV1(NVENC) → H.264(NVENC) → **软件兜底 libx264**。
  // 兜底这一档保证没有 NVENC 的 ffmpeg 也能出片（否则功能全关）。
  for (const enc of ['av1_nvenc', 'h264_nvenc', 'libx264']) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      lastErr = new Error('transcode deadline exceeded (' + TRANSCODE_TIMEOUT_MS + 'ms total)');
      break;
    }
    try {
      // -f mp4 is REQUIRED: the temp output path ends in ".tmp<pid>", which
      // ffmpeg cannot map to a muxer by extension (it exits -22 on that).
      // `+faststart` 把 moov 挪到文件头：这几张源实测 moov 在**尾部**
      //（moovStart≈EOF，见 probeMp4），播放器要先把尾巴取回来才能开始解复用 ——
      // 产物若同样把 moov 留在尾部，就等于把这笔成本原样交给下一次播放。
      const tune = ENC_TUNE[enc] || [];
      await spawnFfmpeg(ff, [...base, ...tune, '-c:v', enc, '-movflags', '+faststart', '-f', 'mp4', out],
        remaining, { signal });
      return;
    } catch (err) {
      lastErr = err; // try the next encoder (e.g. AV1 encode unsupported)
    }
  }
  throw new Error('ffmpeg transcode failed (ff=' + ff + ')'
    + (lastErr ? ': ' + lastErr.message : '')
    + (lastFfmpegDownloadError ? ' | download: ' + lastFfmpegDownloadError : ''));
}

/** Transcode to <fps> with a disk cache keyed by abs-path + mtime + fps. */
function transcodeToFps(abs, fps, onEntry) {
  const st = statSync(abs);
  const key = createHash('sha256')
    .update(abs + '|' + Math.round(st.mtimeMs) + '|' + fps)
    .digest('hex').slice(0, 20);
  const cachePath = join(ensureTranscodeCacheDir(), 'tc_' + key + '.mp4');
  if (existsSync(cachePath)) return Promise.resolve(cachePath);
  let entry = TRANSCODE_INFLIGHT.get(cachePath);
  if (entry) return entry.promise;
  // 取消: 所有等待者断开 (切换壁纸) 时终止转码 — kill ffmpeg 释放 CPU + 删 tmp
  // (没有这条取消, 卡死的转码要等 15 分钟硬超时才被杀, 期间占满 CPU)
  const ctrl = new AbortController();
  // ⚠️ 临时名必须**每次调用唯一**（`atomicTmpPath` = `.tmp<pid><递增序号>`），且在**开跑之前**
  // 就定下来，好让 `cancel()` 与任务体共用同一个路径。
  // 用同一个确定性名（曾经的 `cachePath + '.tmp' + pid`）会有一处"删兄弟产物"的静默缺陷：
  // `cancel()` 会立刻把条目从 `TRANSCODE_INFLIGHT` 删掉 ⇒ 新任务能在旧任务收尾**之前**用同一
  // 路径开跑，而旧任务 `catch` 里那句 `unlinkSync(tmp)` 删掉的正是**新任务正在写的产物**。
  const tmp = atomicTmpPath(cachePath);
  let waiters = 0;
  const cancel = () => {
    if (ctrl.signal.aborted) return;
    ctrl.abort();
    try { unlinkSync(tmp); } catch { /* ignore */ }
    TRANSCODE_INFLIGHT.delete(cachePath);
  };
  const p = (async () => {
    const progKey = abs + '|' + fps;
    // 并发闸：排队等待期间 deadline 未启动（deadline 在 runFfmpegTranscode
    // 内、拿到闸之后才开始计时）。
    await acquireTranscodeSlot();
    try {
      await runFfmpegTranscode(abs, tmp, fps, ctrl.signal);
      renameSync(tmp, cachePath);
      const job = transcodeJobs.get(progKey);
      if (job) job.phase = 'done';
      return cachePath;
    } catch (err) {
      try { unlinkSync(tmp); } catch { /* ignore */ }
      const job = transcodeJobs.get(progKey);
      if (job) job.phase = 'error';
      throw err; // surface the real ffmpeg error in the route's 502 detail
    } finally {
      releaseTranscodeSlot();
      if (TRANSCODE_INFLIGHT.get(cachePath) === entry) TRANSCODE_INFLIGHT.delete(cachePath);
    }
  })();
  entry = { promise: p, waiters: 0, cancel };
  TRANSCODE_INFLIGHT.set(cachePath, entry);
  if (typeof onEntry === 'function') onEntry(entry);
  return entry.promise;
}

// transcode 请求等待者注册: 路由 res close 时调用, 全部断开 → 取消转码
function registerTranscodeWaiter(entry, res) {
  if (!entry) return;
  entry.waiters++;
  const onClose = () => {
    entry.waiters--;
    if (entry.waiters <= 0) entry.cancel();
  };
  res.once('close', onClose);
}

/**
 * Upload directory, resolved in order: env override → persisted user config →
 * default. Users change it from the settings UI (POST /upload-dir), which
 * persists it to config.json so it survives restarts without any env setup.
 */
const DEFAULT_UPLOAD_DIR = join(homedir(), '.dsh-wallpaper-engine', 'uploads');
function resolveUploadDir() {
  if (process.env.DSH_WE_UPLOAD_DIR) return process.env.DSH_WE_UPLOAD_DIR;
  const cfg = readConfig();
  if (typeof cfg.uploadDir === 'string' && cfg.uploadDir.trim()) return cfg.uploadDir.trim();
  return DEFAULT_UPLOAD_DIR;
}

let UPLOAD_DIR = resolveUploadDir();

/**
 * WE 官方资源路径（本机 Wallpaper Engine 安装目录的 assets 树或其拷贝）。
 * 场景壁纸效果链 / 材质 / 粒子按名引用的公共贴图（util/*、particle/**、
 * gradient/*）不在壁纸 pkg 里 —— WebWallGL 渲染页对它们默认走程序化复刻
 * （观感近似、逐像素对不上）。配了这个目录后，渲染页经 /api/local-assets
 * 端点（契约对齐上游 renderer/src/local-assets.ts）+ URL 参数
 * ?localAssets=1 按名取官方像素，渲染与官方引擎对齐；未配置 / 目录无效时
 * 渲染页静默回落程序化复刻。
 * 素材属 WE 版权内容：只从用户本机路径只读取用，绝不复制入库（合规同上游
 * docs/COMPLIANCE.md）。持久化在 config.json（weAssetsDir 字段），设置 UI
 * 走 POST /wallpaper-engine/we-assets-dir；DSH_WE_ASSETS_DIR 可环境覆盖。
 */
const WE_ASSETS_SOURCE_ID = 'local';
function resolveWeAssetsDir() {
  if (process.env.DSH_WE_ASSETS_DIR && process.env.DSH_WE_ASSETS_DIR.trim()) {
    return normalize(process.env.DSH_WE_ASSETS_DIR.trim());
  }
  const cfg = readConfig();
  if (typeof cfg.weAssetsDir === 'string' && cfg.weAssetsDir.trim()) {
    return normalize(cfg.weAssetsDir.trim());
  }
  return null;
}
let WE_ASSETS_DIR = resolveWeAssetsDir();

/** 目录可用 = 存在 materials/ 子目录（渲染端只按名消费贴图，上游同一探测约定）。 */
function weAssetsAvailable() {
  if (!WE_ASSETS_DIR) return false;
  try { return statSync(join(WE_ASSETS_DIR, 'materials')).isDirectory(); } catch { return false; }
}

/** 设置 / 清除素材目录（persist config.json；写串行化，与 settings/uploadDir 不交错）。 */
function setWeAssetsDir(dir) {
  return enqueueConfigWrite(() => {
    WE_ASSETS_DIR = dir;
    weAssetsIndexCache.clear();
    const cfg = readConfig();
    if (dir) cfg.weAssetsDir = dir;
    else delete cfg.weAssetsDir;
    writeConfig(cfg);
    return dir;
  });
}

// 素材名清单：materials/**/*.tex 的相对路径去扩展名（引擎名，posix 分隔 ——
// `materials/util/noise.tex` → `util/noise`，与 shader/材质引用同名）。
// 扫盘结果缓存 60s（官方树 ~586 个文件，每次壁纸挂载都重扫不值得；上游
// dev server 同一约定）。
const weAssetsIndexCache = new Map(); // dir → { names, at }
async function listWeAssetNames(dir) {
  const hit = weAssetsIndexCache.get(dir);
  if (hit && Date.now() - hit.at < 60_000) return hit.names;
  const names = [];
  const walk = async (d, prefix) => {
    let entries;
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const rel = prefix ? prefix + '/' + e.name : e.name;
      if (e.isDirectory()) await walk(join(d, e.name), rel);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.tex')) names.push(rel.slice(0, -4));
    }
  };
  await walk(join(dir, 'materials'), '');
  names.sort();
  weAssetsIndexCache.set(dir, { names, at: Date.now() });
  return names;
}

/**
 * 帧缓存目录（插件托管，与 config/uploads 同一个数据目录）。这里存三类产物、
 * 各有自己的键前缀：实时抓帧（`<LIVE_FRAME_KEY_VERSION>_…_gpu.png`）、场景内嵌视频
 * （`sv1_*.mp4`）与场景包内音频（`sa1_*`）。键里带入口路径的 base64url + mtime，
 * 所以工坊更新会让旧产物自然失效。`DSH_WE_CACHE_DIR` 覆盖位置（测试 / 高级用户）。
 */
function frameCacheDir() {
  if (process.env.DSH_WE_CACHE_DIR && process.env.DSH_WE_CACHE_DIR.trim()) {
    return process.env.DSH_WE_CACHE_DIR.trim();
  }
  return join(dirname(configPath()), 'cache', 'frames');
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
// 渲染抓帧覆盖（拒绝重复写，缓存唯一），且可直接双击打开查看。
//
// ⚠️ 槽位**只有这一个产物**，所以这里也只给出这一个路径（外加 `key`，它是 PUT 的写去重锁键）：
// 曾经还返回 `pngPath` / `jpgPath` / `gifPath`（静态帧提取线的遗留）与一个 `_vN` 档位后缀，
// 两者都**没有任何消费者** —— 而档位后缀还让"档 4"那次调用白做一次 `statSync` +
// `ensureFrameCacheDir()`（档 4 是用户 pin 的自定义封面，**豁免**抓帧 ⇒ 根本不会读槽位）。
function sceneFrameSlot(abs) {
  let mtime = 0;
  try { mtime = statSync(abs).mtimeMs; } catch { /* keep 0 */ }
  // 键**只有一处构造点**（sceneFrameCacheKey）：两处各自拼字面量时，升键只改一处
  // 就会让写盘产物与读取路径错位（版本前缀同理：必须只有一处）。
  const key = sceneFrameCacheKey(abs, mtime);
  const dir = ensureFrameCacheDir();
  return { key, gpuPath: join(dir, key + '_gpu.png') };
}
// GPU 抓帧优先于自定义画面：`_gpu.png` 是真实渲染帧。
// ⚠️ 档位值域是 `{0, 4}`（其余值由路由 clamp 到 0），而**档 4 的豁免由调用方判定**
//（`lib/routes/scene-frame.js` 的 `variant === 4 ? null : gpuFrameFileFor(...)`）：
// 豁免了就不该再解析槽位 —— 那正是上面说的那次白工。本函数因此只回答
// "这个槽有没有抓帧"，不承担档位语义。
function gpuFrameFileFor(slot) {
  return existsSync(slot.gpuPath) ? slot.gpuPath : null;
}
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
let videoPreviewActive = 0;
const videoPreviewWaiters = [];
function acquireVideoPreviewSlot() {
  if (videoPreviewActive < VIDEO_PREVIEW_MAX_CONCURRENT) {
    videoPreviewActive += 1;
    return Promise.resolve();
  }
  return new Promise((resolveSlot) => videoPreviewWaiters.push(resolveSlot));
}
function releaseVideoPreviewSlot() {
  const next = videoPreviewWaiters.shift();
  if (next) next();
  else videoPreviewActive -= 1;
}

/** Thumbnail cache dir, under the same plugin data dir as config/uploads. */
function videoPreviewCacheDir() {
  const base = process.env.DSH_WE_CACHE_DIR && process.env.DSH_WE_CACHE_DIR.trim()
    ? process.env.DSH_WE_CACHE_DIR.trim()
    : join(dirname(configPath()), 'cache');
  return join(base, 'video-previews');
}
function ensureVideoPreviewCacheDir() {
  return ensureDirOnce(videoPreviewCacheDir());
}

/** Bound the on-disk cache (one small JPEG per distinct source revision). */
const VIDEO_PREVIEW_CACHE_MAX = 512;
function pruneVideoPreviewCache() {
  let names = [];
  try { names = readdirSync(videoPreviewCacheDir()); } catch { return; }
  const files = names.filter((n) => n.startsWith('pv_') && n.endsWith('.jpg'));
  if (files.length <= VIDEO_PREVIEW_CACHE_MAX) return;
  const ranked = files.map((n) => {
    const p = join(videoPreviewCacheDir(), n);
    let mtime = 0; try { mtime = statSync(p).mtimeMs; } catch { /* keep 0 */ }
    return { p, mtime };
  }).sort((a, b) => b.mtime - a.mtime);
  for (const f of ranked.slice(VIDEO_PREVIEW_CACHE_MAX)) {
    try { unlinkSync(f.p); } catch { /* ignore */ }
  }
}

// ── 磁盘缓存总量上限 (按 mtime-LRU 淘汰) ─────────────────────────────
// transcodeCacheDir 的 tc_*.mp4 每个 80–280MB, 没有上限就会一路增长
// (几十 GB)。启动后扫一次, 超上限就按 mtime 从最旧开始删到上限以内。
// 保守起见: 永不删最新的一份, 永不删 5 分钟内写出的文件 (可能是在途任务的产物),
// 永不碰本进程的 .tmp<pid> 输出。
const TRANSCODE_CACHE_MAX_BYTES = 4 * 1024 * 1024 * 1024;
const CACHE_PRUNE_MIN_AGE_MS = 5 * 60 * 1000;
function pruneCacheDirBySize(dir, maxBytes, matchRe) {
  let names = [];
  try { names = readdirSync(dir); } catch { return; }
  const ownTmpSuffix = '.tmp' + process.pid;
  const now = Date.now();
  const entries = [];
  let total = 0;
  for (const name of names) {
    if (name.endsWith(ownTmpSuffix) || !matchRe.test(name)) continue;
    const p = join(dir, name);
    let st = null;
    try { st = statSync(p); } catch { continue; }
    if (!st.isFile()) continue;
    total += st.size;
    entries.push({ p, size: st.size, mtime: st.mtimeMs });
  }
  if (total <= maxBytes) return;
  entries.sort((x, y) => x.mtime - y.mtime); // 最旧优先
  for (let i = 0; i < entries.length - 1 && total > maxBytes; i++) {
    const e = entries[i];
    if (now - e.mtime < CACHE_PRUNE_MIN_AGE_MS) continue; // 可能是在途任务刚写的
    try { unlinkSync(e.p); total -= e.size; } catch { /* ignore */ }
  }
}

/** Cache path keyed by source path + size + mtime, so replacing the video
 *  regenerates the frame instead of serving a stale thumbnail. */
function videoPreviewCachePath(abs) {
  let size = 0, mtime = 0;
  try { const st = statSync(abs); size = st.size; mtime = Math.round(st.mtimeMs); } catch { /* ignore */ }
  const key = createHash('sha256')
    .update(abs + '|' + size + '|' + mtime + '|v1|' + VIDEO_PREVIEW_WIDTH)
    .digest('hex').slice(0, 24);
  return join(ensureVideoPreviewCacheDir(), 'pv_' + key + '.jpg');
}

// Same-key concurrent requests share one extraction (and one disk write).
const VIDEO_PREVIEW_INFLIGHT = new Map();
async function generateVideoPreview(abs) {
  const out = videoPreviewCachePath(abs);
  if (existsSync(out)) return out;
  let entry = VIDEO_PREVIEW_INFLIGHT.get(out);
  if (entry) return entry;
  entry = (async () => {
    await acquireVideoPreviewSlot();
    const tmp = out + '.tmp' + process.pid;
    try {
      if (existsSync(out)) return out; // a queued sibling may have produced it
      const ff = await resolveFfmpeg(null);
      let lastErr = null;
      // Skip the opening second first: many videos start on a black fade-in,
      // which would otherwise become a black thumbnail. Fall back to 0 for
      // clips shorter than the seek point.
      for (const ss of [1, 0]) {
        try { unlinkSync(tmp); } catch { /* ignore */ }
        try {
          await spawnFfmpeg(ff, [
            '-y', '-hide_banner', '-nostdin',
            '-ss', String(ss),
            '-i', abs,
            '-frames:v', '1', '-an',
            '-vf', `scale='min(${VIDEO_PREVIEW_WIDTH},iw)':-2`,
            '-q:v', '3',
            '-update', '1', '-f', 'image2', tmp,
          ], 60 * 1000, {});
          if (existsSync(tmp)) { lastErr = null; break; }
          lastErr = new Error('no preview frame produced');
        } catch (e) { lastErr = e; }
      }
      if (!existsSync(tmp)) throw lastErr || new Error('no preview frame produced');
      renameSync(tmp, out);
      return out;
    } catch (e) {
      try { unlinkSync(tmp); } catch { /* ignore */ }
      throw e;
    } finally {
      releaseVideoPreviewSlot();
    }
  })();
  VIDEO_PREVIEW_INFLIGHT.set(out, entry);
  entry.then(
    () => { if (VIDEO_PREVIEW_INFLIGHT.get(out) === entry) VIDEO_PREVIEW_INFLIGHT.delete(out); },
    () => { if (VIDEO_PREVIEW_INFLIGHT.get(out) === entry) VIDEO_PREVIEW_INFLIGHT.delete(out); },
  );
  return entry;
}

/** Accepted upload MIME → file extension (matches mimeFor above). */
const UPLOAD_EXT = { 'video/mp4': 'mp4', 'image/jpeg': 'jpg', 'image/png': 'png' };

// ── 自定义画面（截屏导入）─────────────────────────────────────────────────
// 用户在 WE 等处对无法静态生成的壁纸（骨骼拼装场景如 Kirito x Asuna，预览
// gif 仅 160px）自行截图后按壁纸 id 导入；scene-frame ?v=4 直接服务该图，
// 作为刷新档位的「自定义画面」档。分辨率 = 用户截图分辨率。
const CUSTOM_FRAME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const CUSTOM_FRAME_MAX_BYTES = 30 * 1024 * 1024;
function customFrameDir() { return ensureDirOnce(join(homedir(), '.dsh-wallpaper-engine', 'overrides')); }

/**
 * 自动首帧缓存目录（网页壁纸）：live 渲染就绪后由客户端用 `__wp.capture()` 抽一帧
 * POST 上来，之后每次加载/重启都先显示它 —— 加载期不再黑屏、也不再停在作者预览图。
 * 与用户手动导入的「自定义画面」（overrides/）分开存放，互不覆盖。
 */
function liveFrameDir() { return ensureDirOnce(join(pluginDataDir(), 'live-frames')); }

/**
 * 诊断落盘：把「非 200 的 HTTP 响应 / 路径围栏」按行追加到
 * `~/.dsh-wallpaper-engine/diag/http.jsonl`。
 *
 * 为什么用文件而不是 console.log：DSH Desktop 的运行日志只收录各插件 logger 的
 * 输出，host 的 stdout 拿不到 —— 排查「桌面端黑屏但浏览器正常」这类只在某个宿主
 * 环境出现的问题时，需要一个与宿主无关、事后可读的通道。
 *
 * 大小轮转：这条通道是**常开的**（渲染页上报 + 心跳 + 请求记录），没有上限时它会一路长到
 * 几十 MB（实测一段时间的会话即到 69.8 MB），而后人排查只需要最近的那一段。上限取
 * `DIAG_MAX_BYTES`，到顶就把当前文件改名为 `http.jsonl.1`（**只留一代**，更旧的被覆盖），
 * 于是目录占用有硬上界 2×上限。字节数在内存里累加，不做逐次 `statSync`。
 *
 * 不变量：无论轮转与否，`/diag-log`（内存环形缓冲，最近 80 条）与每行的 JSON 形状都不变；
 * 轮转只发生在**写入之前**，绝不丢当次这一行。
 */
const DIAG_MAX_BYTES = 8 * 1024 * 1024;
let diagBytes = -1;   // -1 = 尚未探测盘上现有大小
function appendDiagLine(kind, obj) {
  try {
    const dir = join(dirname(configPath()), 'diag');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'http.jsonl');
    if (diagBytes < 0) diagBytes = existsSync(file) ? statSync(file).size : 0;
    if (diagBytes >= DIAG_MAX_BYTES) {
      renameSync(file, file + '.1');
      diagBytes = 0;
    }
    const line = JSON.stringify({ t: Date.now(), kind, ...obj }) + '\n';
    appendFileSync(file, line);
    diagBytes += Buffer.byteLength(line);
  } catch { /* 诊断失败不影响服务 */ }
}

// ── 场景载荷传输账本 ────────────────────────────────────────────────────────
// **为什么需要它**：`/scene-files` 的 `scene.pkg` 动辄 100–336MB（实测本机
// `pkg body: 336161480 bytes`），而渲染页的**首帧**必须等整包到齐（`mountScene` 里
// `await source.scenePkg()` 在 `pkg body` 之前，见 WebWallGL 的 scene-mount）。
// 客户端的首帧看护是**墙钟**的（15s），于是"传输被饿死"会被判成"这张壁纸渲染不出来"
// 并写进共享的失败记忆。传输到底有没有在动，**只有服务端知道**（客户端拿不到渲染页
// 的下载进度，渲染页 2.0.2 也不上报）⇒ 由这里记账，经
// `GET ${BASE}/scene-payload-progress?token=…` 供看护判"有进展就不算超时"。
//
// 记账口径：**每一次**带体的 GET（含 Range）都算一次传输；`served` 只增不减（跨重试累积，
// 于是客户端可以靠"上一次采样到这一次采样之间 served 有没有涨"判活，不必对时钟）；
// `completed` 只在响应的 `finish`（整包真的写出去）时 +1 —— 客户端断开走 `close`，
// 那次传输不计完成。**这正好是"传输未完成"与"渲染页不出帧"的分野**。
//
// 有界：只留最近 `PAYLOAD_LEDGER_MAX` 个 token（长会话里看过的壁纸很多，旧条目没人再问）。
const PAYLOAD_LEDGER_MAX = 64;
const payloadLedger = new Map(); // token -> entry
let payloadTransferSeq = 0;
const payloadOpen = new Map(); // 传输 id -> { token, entry, settled }
function payloadEntry(token) {
  let entry = payloadLedger.get(token);
  if (!entry) {
    entry = { served: 0, size: 0, active: 0, transfers: 0, completed: 0, startedAt: 0, lastByteAt: 0, lastEndAt: 0 };
    payloadLedger.set(token, entry);
    while (payloadLedger.size > PAYLOAD_LEDGER_MAX) {
      const oldest = payloadLedger.keys().next();
      if (oldest.done) break;
      payloadLedger.delete(oldest.value);
    }
  } else {
    // 重新取用即视为"最近用过"：淘汰按插入序，重取要搬到表尾。
    payloadLedger.delete(token);
    payloadLedger.set(token, entry);
  }
  return entry;
}
/** 开一次带体传输（返回结算句柄；调用方在 `res` 的 finish / close 上结算）。 */
function payloadBegin(token, size) {
  const entry = payloadEntry(token);
  const id = ++payloadTransferSeq;
  entry.active += 1;
  entry.transfers += 1;
  entry.size = Math.max(entry.size, Number(size) || 0);
  if (!entry.startedAt) entry.startedAt = Date.now();
  payloadOpen.set(id, { entry, settled: false });
  return id;
}
/** 累加这次传输已经写出去的字节（喂 `served` / `lastByteAt`：客户端靠它判"还在动"）。 */
function payloadBytes(id, n) {
  const open = payloadOpen.get(id);
  if (!open || !n) return;
  open.entry.served += n;
  open.entry.lastByteAt = Date.now();
}
/**
 * 结算一次传输（`res` 的 finish = 整包写完 / close = 没写完就断了）。
 * 只生效一次：`close` 在 `finish` 之后也会来，绝不能把已完成的传输改判成未完成。
 */
function payloadSettle(id, completed) {
  const open = payloadOpen.get(id);
  if (!open || open.settled) return;
  open.settled = true;
  payloadOpen.delete(id);
  open.entry.active = Math.max(0, open.entry.active - 1);
  open.entry.lastEndAt = Date.now();
  if (completed) open.entry.completed += 1;
}
/**
 * 账本快照（`GET ${BASE}/scene-payload-progress` 的应答体）。
 * `ok:false` = 这个 token 一次传输都没见过 —— 那是**未知**，不是"没在动"：
 * 客户端据此回落墙钟预算，绝不把"宿主没记账"当成失败证据。
 */
function payloadProgress(token) {
  const entry = token ? payloadLedger.get(token) : null;
  if (!entry) return { ok: false, token: String(token || ''), served: 0, size: 0, active: 0, transfers: 0, completed: 0, startedAt: 0, lastByteAt: 0, lastEndAt: 0 };
  return {
    ok: true,
    token: String(token),
    served: entry.served,
    size: entry.size,
    active: entry.active,
    transfers: entry.transfers,
    completed: entry.completed,
    startedAt: entry.startedAt,
    lastByteAt: entry.lastByteAt,
    lastEndAt: entry.lastEndAt,
  };
}

/**
 * 条件 GET 判定（ETag / Last-Modified → 304）。
 *
 * 为什么只在**显式要求**的调用点用（见 `handleSceneFiles` 的 .pkg 分支）：其余族
 *（预览图 / 上传 / 转码产物）的内容随时可能被用户改，`no-store` 是它们的正确默认。
 * 而 `scene.pkg` 的内容由 **size + mtime** 唯一确定，且一次传输就是几百 MB ——
 * 让浏览器复用手上的字节（304 无体）比重新读一遍盘便宜几个数量级。
 *
 * 语义按 RFC 9110：带 `If-None-Match` 时**忽略** `If-Modified-Since`；弱比较符
 *（`W/`）两边都剥掉再比；HTTP 日期精度只到秒 ⇒ mtime 也按秒截断比较。
 */
function notModifiedSince(req, etag, mtimeMs) {
  const headers = (req && req.headers) || {};
  const inm = headers['if-none-match'];
  if (typeof inm === 'string' && inm.trim()) {
    const want = inm.split(',').map((s) => s.trim().replace(/^W\//, ''));
    return want.includes('*') || want.includes(String(etag).replace(/^W\//, ''));
  }
  const ims = headers['if-modified-since'];
  if (typeof ims === 'string' && ims.trim()) {
    const t = Date.parse(ims);
    if (Number.isFinite(t)) return Math.floor(Number(mtimeMs) / 1000) * 1000 <= t;
  }
  return false;
}

/**
 * 请求记录（含成功的 200）：同 route+path 十秒内只记一条，避免刷屏。
 *
 * 为什么连 200 也要记：排查「画面黑但服务端无任何 4xx」时，唯一的判据是
 * **某个请求到底有没有发生**（例如壁纸入口是否真被 iframe 请求过）——
 * 只看错误码会把「没请求」与「请求成功」混为一谈。
 *
 * ⚠️ 这张表**必须有上界**：键里带**请求可控**的路径段（`/scene-files` 子路径、
 * `/live-frame` 的 token、`/scene-live` 的 pathname …），而请求方是任意页面。
 * 只 get/set 而不回收时，会话期内互不相同的请求会让堆**单向增长**（实测 20 万个不同的
 * `/live-frame/<随机>` 把 heapUsed 从 32.2MB 抬到 72.4MB 且不释放）。
 * 下面的 TTL 只抑制**写入**，不清理条目 ⇒ 上界由 `REQ_LOG_SEEN_MAX` 单独保证。
 */
const REQ_LOG_DEDUP_MS = 10000;
/** 去重表的硬上界（条）。超界按插入序淘汰最旧的 ⇒ 内存有界。 */
const REQ_LOG_SEEN_MAX = 2000;
const reqLogSeen = new Map();
/**
 * 去重判定 + 记账。返回 true 表示"这一条该落盘"。
 *
 * 上界与去重是**两个**要求，冲突时上界优先：条目被淘汰后同一键可能再落一条重复行 ——
 * 这是可接受的（诊断去重本就是尽力而为），而内存有界是硬要求。
 */
function reqLogSeenTouch(key, now, ttlMs) {
  const last = reqLogSeen.get(key);
  if (last !== undefined && now - last < ttlMs) return false;
  reqLogSeen.set(key, now);
  // Map 保持插入序 ⇒ 队首就是最旧的键。
  while (reqLogSeen.size > REQ_LOG_SEEN_MAX) {
    const oldest = reqLogSeen.keys().next();
    if (oldest.done) break;
    reqLogSeen.delete(oldest.value);
  }
  return true;
}
/**
 * 诊断里的路径折叠：场景/网页壁纸的路径首段是 base64 的绝对路径（很长），
 * 原样落盘等于什么都没记（只剩一串 base64）。折叠成 `<token>/…`，留下真正
 * 有信息量的文件名 / 子路径。
 */
function foldTokenPath(p) {
  const raw = String(p || '');
  const slash = raw.indexOf('/');
  return (slash > 40 ? '<token>/' + raw.slice(slash + 1) : raw).slice(0, 150);
}
function traceRequests(res, route, pathKey) {
  try {
    const key = route + '\u0000' + String(pathKey);
    const now = Date.now();
    if (!reqLogSeenTouch(key, now, REQ_LOG_DEDUP_MS)) return;
    res.on('finish', () => {
      appendDiagLine('req', {
        route,
        path: foldTokenPath(pathKey),
        status: res.statusCode || 0,
        dest: String(res.req && res.req.headers ? res.req.headers['sec-fetch-dest'] || '' : ''),
      });
    });
  } catch { /* ignore */ }
}
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

/** WE schemecolor（"0.847 0.725 0.713"，0–1 浮点三元组）→ CSS 颜色；无效返回 null。 */
function schemeToCss(v) {
  if (typeof v !== 'string') return null;
  const parts = v.trim().split(/\s+/).map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some((x) => !Number.isFinite(x))) return null;
  const c = parts.slice(0, 3).map((x) => Math.max(0, Math.min(255, Math.round(x * 255))));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
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

function ensureUploadDir() {
  // 按路径 memoize：UPLOAD_DIR 变化（setUploadDir）时新路径仍会 mkdir。
  return ensureDirOnce(UPLOAD_DIR);
}

function uploadMetaPath() { return join(UPLOAD_DIR, '.meta.json'); }

function readUploadMeta() {
  const p = uploadMetaPath();
  if (!existsSync(p)) return {};
  try {
    const o = JSON.parse(readFileSync(p, 'utf8'));
    return o && typeof o === 'object' ? o : {};
  } catch { return {}; }
}

/**
 * Normalize one meta entry: legacy shape `{ id: title }` or the current
 * `{ id: { title, sha256 } }`. sha256 lets the upload route deduplicate
 * identical content (re-uploading the same file returns the existing entry
 * instead of piling up copies).
 */
function metaEntry(meta, id) {
  const v = meta[id];
  if (typeof v === 'string') return { title: v, sha256: null, contentrating: null };
  if (v && typeof v === 'object') return {
    title: typeof v.title === 'string' && v.title.trim() ? v.title : id,
    sha256: typeof v.sha256 === 'string' ? v.sha256 : null,
    // Same field the Workshop path reads from project.json, mirrored for
    // custom uploads in uploads/.meta.json (WE's G / PG13 / R tags). Missing
    // or non-string values stay null: the inventory reports what is actually
    // recorded, and the CLIENT decides how a missing rating is filtered (see
    // ratingOf — uploads without a rating count as Everyone, #84).
    contentrating: typeof v.contentrating === 'string' && v.contentrating.trim()
      ? v.contentrating.trim() : null,
  };
  return { title: id, sha256: null, contentrating: null };
}

/**
 * 写入一份上传 meta。**必须串行**（与 `config.json` 共用同一写队列）。
 *
 * 这是「读整份 → 改一条 → 原子写回」三步：并发交错时后写者基于旧快照，会吞掉先写者的改动。
 * 丢掉的若是 `sha256`，`/upload` 的内容去重（按 sha256 比对）就再也匹配不上 ⇒ 同一文件被
 * 反复堆成副本。`/remove` 与上传完成回调本来就可以交错，所以这条不是理论风险。
 * 返回值是该次写盘的 promise（调用方等它落盘再应答，保持"响应即已持久化"的语义）。
 */
function setUploadMeta(id, title, sha256) {
  return enqueueConfigWrite(() => {
    try {
      const m = readUploadMeta();
      m[id] = { title: title || id, sha256: sha256 || null };
      // 原子写（.tmp+rename）：崩溃/断电不留半截 JSON，整份 meta 不会丢失。
      atomicWriteFileSync(uploadMetaPath(), JSON.stringify(m));
    } catch { /* ignore */ }
  });
}

function removeUploadMeta(id) {
  return enqueueConfigWrite(() => {
    try {
      const m = readUploadMeta();
      if (id in m) { delete m[id]; atomicWriteFileSync(uploadMetaPath(), JSON.stringify(m)); }
    } catch { /* ignore */ }
  });
}

/** Common preview file names probed inside a WE project directory. */
const PREVIEW_CANDIDATES = ['preview.jpg', 'preview.png', 'preview.gif', 'preview.webp'];

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
  let entries = [];
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
      let entries = [];
      try { entries = await readdir(oldDir); } catch { entries = []; }
      for (const entry of entries) {
        if (entry === '.meta.json' || UPLOAD_FILE_RE.test(entry)) {
          // 逐项 await：迁移大量大文件时让出事件循环，避免一次性并发打满 IO。
          if (await moveFileP(join(oldDir, entry), join(target, entry))) migrated += 1;
          else skipped += 1;
        }
      }
    }
    UPLOAD_DIR = target;
    const cfg = readConfig();
    cfg.uploadDir = target;
    writeConfig(cfg);
    ensureUploadDir();
    return { uploadDir: target, migrated, skipped, same: false };
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
    try { pruneVideoPreviewCache(); } catch { /* ignore */ }
    // 大文件缓存同样要有上限 (见 pruneCacheDirBySize): transcode 输出
    // (tc_*.mp4, 每个 80–280MB) 没有上限就会一路增长 → 按 mtime-LRU 收敛到上限以内。
    // 只匹配真正的转码产物, 不碰同名的 .loop / .prog / .tmp 附属文件。
    try { pruneCacheDirBySize(transcodeCacheDir(), TRANSCODE_CACHE_MAX_BYTES, /^tc_.*\.mp4$/); } catch { /* ignore */ }
    // faststart 变体同一条纪律：每个 100MB–1GB 量级，同样按 mtime-LRU 收敛到上限以内。
    try { pruneCacheDirBySize(faststartCacheDir(), FASTSTART_CACHE_MAX_BYTES, /^fs_.*\.mp4$/); } catch { /* ignore */ }
  }, 3000);

  // Token → absolute path map. Tokens are base64url of the abs path, so the
  // route never exposes an arbitrary filesystem string the client could not
  // otherwise obtain from the inventory.
  const mediaMap = new Map();
  const tokenFor = (absPath) => {
    const token = Buffer.from(absPath, 'utf8').toString('base64url');
    mediaMap.set(token, absPath);
    return token;
  };

  /**
   * Scene-shaped derived fields for ONE wallpaper entry: the WebWallGL
   * live-render capability (sceneLive / sceneLiveSrc), the embedded MP4 and
   * packaged-audio availability (sceneVideo / sceneAudio), and the 自定义画面
   * memory (hasCustomFrame).
   * Shared verbatim by the Steam scan and the custom-storage (uploads) scan —
   * a scene found in either place must behave identically, and every one of
   * these routes is driven by the entry's absolute main-file path, so no
   * extra plumbing is needed for the custom-storage case.
   */
  function sceneFieldsFor(w, hasFrame, customIds, sceneMtime) {
    const isScene = Boolean(w.type === 'scene' && hasFrame && w.fileAbs);
    // Loose scene.json directories have no scene.pkg for WebWallGL's
    // httpSource to fetch — live render is pkg-only.
    const isPkg = isScene && !w.fileAbs.toLowerCase().endsWith('.json');
    // sceneVideo 诚实化: 只有探测缓存确认该 pkg 真的内嵌 MP4 才给 URL;
    // 未知 (无缓存项) → null 并投递后台探测, 绝不猜 —— 拿 hasFrame 冒充
    // 「内嵌视频」客户端请求必然 404 (字段在说谎)。
    const svKey = isScene ? sceneVideoProbeKey(w.fileAbs, sceneMtime) : null;
    const svKnown = svKey === null ? undefined : sceneVideoProbeGet(svKey);
    if (svKey !== null && svKnown === undefined) scheduleSceneVideoProbe(w.fileAbs, svKey);
    // `scene.pkg` 的体积：客户端拿它把**首帧预算**按"这份载荷至少要传多久"放大
    //（见 `src/live-layer.js` 的 liveFirstFrameBudget）—— 首帧必须等整包到齐，
    // 而 100–336MB 的包在饿死的传输下远超固定 15s。取不到就 0（= 退回基准预算，
    // 绝不因为"量不出体积"把壁纸判失败）。
    let scenePkgBytes = 0;
    if (isPkg) {
      try { scenePkgBytes = statSync(w.fileAbs).size || 0; } catch { scenePkgBytes = 0; }
    }
    return {
      sceneLive: isPkg,
      sceneLiveSrc: isPkg ? tokenFor(w.fileAbs) : null,
      scenePkgBytes,
      sceneVideo: svKnown === true ? `${BASE}/scene-video/${tokenFor(w.fileAbs)}` : null,
      sceneAudio: isScene ? `${BASE}/scene-audio/${tokenFor(w.fileAbs)}` : null,
      hasCustomFrame: isScene ? customIds.has(customIdFromAbs(w.fileAbs)) : false,
    };
  }

  /**
   * Web-wallpaper live-render fields. `webLiveSrc` is the FULL entry URL
   * (mediaBase-relative path + file name), not a token: the renderer page's
   * web form expects `src` to be the complete entry URL (the WallpaperEM
   * protocol), and it derives project.json from it. Strict sandbox keeps the
   * third-party HTML on an opaque origin so it can never act with the DSH
   * origin's authority.
   */
  function webFieldsFor(w, entryOk, mediaBase) {
    const isWeb = Boolean(w.type === 'web' && entryOk && w.fileAbs);
    return {
      webLive: isWeb,
      // 绝对 URL（壁纸媒体源）——不透明源的沙箱 iframe 只有在这个源上才能把
      // 入口 HTML 与其子资源取回来；媒体源不可用时回落成应用源相对路径
      //（浏览器形态照旧，Desktop 上会 403）。
      webLiveSrc: isWeb
        ? `${mediaBase || ''}${BASE}/scene-files/${tokenFor(w.fileAbs)}/${basename(w.fileAbs)}`
        : null,
    };
  }

  // Build the inventory (async scan chain — fs.promises, event-loop friendly).
  // The browser half refetches live each load, so freshness semantics are
  // unchanged; only the blocking behavior is gone.
  //
  // 短 TTL 缓存（3s）：客户端每次切壁纸/刷新面板都会重新拉 inventory，而
  // 全量扫描（locate + readdir + 每个壁纸的存在性探测）在慢盘上要几百 ms
  // 到几秒。TTL 内直接返回缓存，对用户的感知延迟上限仍是 3 秒。
  const INVENTORY_TTL_MS = 3000;
  let inventoryCache = null; // { t, payload }
  async function buildInventory() {
    if (inventoryCache && Date.now() - inventoryCache.t < INVENTORY_TTL_MS) {
      return inventoryCache.payload;
    }
    const installDir = await locateWallpaperEngineP();
    const libraryDirs = await owningLibrariesP();
    const all = await enumerateWallpapersAsync(installDir, libraryDirs);
    const byPath = new Map(all.map((w) => [pathKey(w.fileAbs), w.id]));
    const byId = new Map(all.map((w) => [w.id, w]));
    const customIds = listCustomFrameIds();
    const wallpapers = await Promise.all(all.map(async (w) => {
      // 三次存在性探测并发（串行在慢盘上是 3× 延迟）。
      const [hasMedia, hasPreview, sceneMtime] = await Promise.all([
        w.type === 'video' || w.type === 'web' ? pathExistsP(w.fileAbs) : Promise.resolve(false),
        w.previewAbs ? pathExistsP(w.previewAbs) : Promise.resolve(false),
        // Scenes: fileAbs points at the resolved scene main file (scene.pkg /
        // scene.json); frameUrl serves the live-captured frame or the
        // user-imported 自定义画面 (there is no extraction step any more).
        // 用 stat 取 mtime：一次异步探测同时给出 mtime ——
        // 兼作存在性（hasFrame）与 sceneVideo 探测缓存（路径+mtime）的键。
        w.type === 'scene' && w.fileAbs ? mtimeOrNullP(w.fileAbs) : Promise.resolve(null),
      ]);
      const hasFrame = sceneMtime !== null;
      // 只有真的存在网页条目时才按需起媒体源监听（懒启动，失败回落空串）。
      const webMediaBase = w.type === 'web' && hasMedia ? await mediaOriginBase() : '';
      return {
        id: w.id,
        title: w.title,
        type: w.type,
        contentrating: w.contentrating,
        playable: hasMedia,
        media: hasMedia ? `${BASE}/media/${tokenFor(w.fileAbs)}` : null,
        // 真实容器后缀（小写、不含点）。**为什么必须由宿主给**：媒体 URL 是 token 形态
        //（`/media/<base64url>`），路径里没有扩展名 —— 客户端靠 URL 猜容器只会恒判"不可解"，
        // 于是"原生可解的源不整片重编码"这条治理永远不生效。客户端同样保留 URL 兜底，
        // 以便夹具/旧宿主没有这个字段时行为不变。
        mediaExt: w.fileAbs ? extOf(w.fileAbs) : null,
        preview: hasPreview ? `${BASE}/preview/${tokenFor(w.previewAbs)}` : null,
        frameUrl: hasFrame ? `${BASE}/scene-frame/${tokenFor(w.fileAbs)}` : null,
        // 加载期占位底色（主题色）：尚无抽帧图时的兜底，避免一上来就是黑屏。
        schemeColor: w.schemeColor || null,
        // Scene fields — WebWallGL live render,
        // embedded MP4, packaged audio, 自定义画面 (see sceneFieldsFor).
        ...sceneFieldsFor(w, hasFrame, customIds, sceneMtime),
        // Web wallpapers: WebWallGL live render (entry HTML + injected shim) +
        // the automatic first-frame cache (可能还没有 → GET 404 → 用主题色)。
        ...webFieldsFor(w, hasMedia, webMediaBase),
        // 「壁纸属性」面板入口：只有场景/网页壁纸的项目目录才有 project.json
        // 用户属性。**必须在这里统一给一次** —— 上面两个字段函数都返回过
        // propsUrl，webFieldsFor 的 null 会把场景壁纸的值盖掉（实测 216 张场景
        // 一张都拿不到，按钮因此不显示）。
        propsUrl: (w.type === 'scene' || w.type === 'web') && w.fileAbs
          ? `${BASE}/props/${tokenFor(w.fileAbs)}`
          : null,
        liveFrame: w.type === 'web' && hasMedia ? `${BASE}/live-frame/${tokenFor(w.fileAbs)}` : null,
      };
    }));
    // Custom storage: scanned fresh each request (read-A storage), appended
    // AFTER the WE wallpapers. Two shapes come out of enumerateUploadsP —
    // `up-*` single-file uploads (images / MP4) and `up-dir-*` WE project
    // directories (scene.pkg / index.html / *.mp4 with a project.json), i.e.
    // a WallpaperEM-style downloads folder. Both get the same scene fields as
    // the Steam scan, so a scene from either source plays identically
    // (live WebWallGL / static frame / embedded video / packaged audio).
    const uploadsDir = ensureUploadDir();
    const uploadMeta = readUploadMeta();
    const uploads = await Promise.all((await enumerateUploadsP(uploadsDir)).map(async (w) => {
      const isDirProject = w.id.startsWith('up-dir-');
      const me = metaEntry(uploadMeta, w.id);
      const [hasMedia, hasPreview, sceneMtime] = await Promise.all([
        (w.type === 'video' || w.type === 'web') && w.fileAbs
          ? pathExistsP(w.fileAbs) : Promise.resolve(false),
        w.previewAbs ? pathExistsP(w.previewAbs) : Promise.resolve(false),
        // 同 Steam 扫描：mtime 兼作存在性与 sceneVideo 探测缓存键。
        w.type === 'scene' && w.fileAbs ? mtimeOrNullP(w.fileAbs) : Promise.resolve(null),
      ]);
      const hasFrame = sceneMtime !== null;
      const webMediaBase = w.type === 'web' && hasMedia ? await mediaOriginBase() : '';
      return {
        id: w.id,
        // Project directories carry their own project.json title/rating;
        // single-file uploads use uploads/.meta.json (written by the upload route).
        title: isDirProject ? (w.title || w.id) : (me.title || w.id),
        contentrating: isDirProject ? (w.contentrating || null) : me.contentrating,
        type: w.type,
        // Single-file uploads exist by construction (they came from readdir);
        // directory entries report real existence. Scenes need no media —
        // they go through frameUrl / live render.
        playable: isDirProject ? hasMedia : true,
        media: w.type === 'scene' ? null : `${BASE}/media/${tokenFor(w.fileAbs)}`,
        // 同 Steam 扫描：真实容器后缀（见那里的注释）。
        mediaExt: w.fileAbs ? extOf(w.fileAbs) : null,
        preview: hasPreview
          ? `${BASE}/preview/${tokenFor(w.previewAbs)}`
          : w.type === 'video'
            ? `${BASE}/video-preview/${tokenFor(w.fileAbs)}`
            : null,
        frameUrl: hasFrame ? `${BASE}/scene-frame/${tokenFor(w.fileAbs)}` : null,
        schemeColor: w.schemeColor || null,
        ...sceneFieldsFor(w, hasFrame, customIds, sceneMtime),
        // Directory-shaped web wallpapers (project.json + index.html) get the
        // same live render path as scene directories.
        ...webFieldsFor(w, hasMedia, webMediaBase),
        // 同上：propsUrl 只在条目里给一次（见 Steam 扫描处的注释）。
        propsUrl: (w.type === 'scene' || w.type === 'web') && w.fileAbs
          ? `${BASE}/props/${tokenFor(w.fileAbs)}`
          : null,
        liveFrame: w.type === 'web' && hasMedia ? `${BASE}/live-frame/${tokenFor(w.fileAbs)}` : null,
      };
    }));
    wallpapers.push(...uploads);
    const playableIds = new Set(wallpapers.filter((w) => w.playable).map((w) => w.id));
    const playlists = (await readPlaylistsP(installDir)).map((playlist) => {
      const ids = [];
      const seenIds = new Set();
      for (const item of playlist.items) {
        const id = playlistItemId(item, byPath, byId);
        if (id && !seenIds.has(id)) { seenIds.add(id); ids.push(id); }
      }
      return {
        id: playlist.id,
        name: playlist.name,
        order: playlist.order,
        delay: playlist.delay,
        wallpaperIds: ids,
        total: ids.length,
        portableCount: ids.filter((id) => playableIds.has(id)).length,
        unresolvedCount: Math.max(0, playlist.items.length - ids.length),
      };
    });
    // 场景壁纸渲染页的 mediaBase（**宿主是唯一真源**，客户端不得自己拼 `location.origin`）。
    // **不按适配器形态门控**：网页壁纸要独立源是为了绕能力头栅栏，而场景壁纸要它是为了
    // **带宽**（`scene.pkg` 实测到 336MB；走应用源那条路挤不过首帧预算）—— 这个理由与
    // "是不是桌面壳"无关，浏览器形态同样成立。库里有可实时渲染的场景才起监听（懒启动）。
    // 起不来（`mediaOriginDead`）仍返回 '' ⇒ 客户端据此回落应用源（慢但可见），而不是空白。
    const sceneMediaBase = wallpapers.some((w) => w.sceneLive) ? await ensureSceneMediaOrigin() : '';
    const payload = {
      installDir,
      uploadDir: UPLOAD_DIR,
      // WE 官方素材（local-assets）：客户端据此决定 scene-live URL 是否带
      // localAssets=1，并在设置面板展示配置状态。
      weAssetsDir: WE_ASSETS_DIR,
      weAssetsAvailable: weAssetsAvailable(),
      // 场景渲染页的 mediaBase（独立壁纸媒体源的 origin；'' = 回落应用源）。
      // 客户端把它拼上 `${BASE}/scene-files` 后交给渲染页 —— 见 `src/live-layer.js` 的
      // liveRenderUrl（**不要再**在那里拼 location.origin，那会把大 pkg 推回应用源那条路）。
      sceneMediaBase,
      total: wallpapers.length,
      portableCount: wallpapers.filter((w) => w.playable).length,
      wallpapers,
      playlists,
    };
    inventoryCache = { t: Date.now(), payload };
    // 视频壁纸先排队生成 faststart 变体（轮换列表优先）：第一次切就该快，而不是"用过一次才快"。
    // 串行、只排一次、单张失败不影响其它；见 warmFaststartFavorites。
    warmFaststartFavorites(wallpapers, log).catch(() => { /* 预热是优化 */ });
    return payload;
  }

  // 视频壁纸的 faststart 变体预热（见 faststartVariant 的注释）：**轮换列表优先**，然后是库里
  // 其余视频 —— 目标是"第一次切就快"，而不是"用过一次才快"。串行（同一时刻只跑一个 ffmpeg）、
  // 每次宿主运行只排一次、单张失败不影响其它；总量按**源字节**卡在上限内，库很大时自然退化成
  // 只做掉轮换列表（真机库实测：6 张视频 / 1.56GB，远在 6GB 预算内）。懒生成（/media-info 与
  // /media 命中时起的后台任务）仍然是兜底 —— 新加的壁纸不可能等下一次重启才快。
  let faststartWarmStarted = false;
  async function warmFaststartFavorites(wallpapers, logFn) {
    if (faststartWarmStarted) return;
    faststartWarmStarted = true;
    let favIds = [];
    try {
      const cfg = readConfig();
      const groups = (cfg && cfg.settings && Array.isArray(cfg.settings.rotationGroups))
        ? cfg.settings.rotationGroups : [];
      favIds = groups.flatMap((g) => (g && Array.isArray(g.wallpaperIds) ? g.wallpaperIds : [])).map(String);
    } catch { /* 读不到设置就只有"其余视频"这一档 */ }
    const videos = wallpapers.filter((w) => w.type === 'video' && w.media);
    const picked = [
      ...videos.filter((w) => favIds.includes(String(w.id))),
      ...videos.filter((w) => !favIds.includes(String(w.id))),
    ];
    let budget = FASTSTART_WARM_MAX_BYTES;
    for (const w of picked) {
      try {
        const abs = mediaMap.get(String(w.media).split('/').pop());
        if (!abs || !needsFaststart(abs)) continue;
        const size = statSync(abs).size;
        if (size > budget) continue;          // 预算用完：剩下的交给懒生成
        budget -= size;                       // 已缓存的也算占位（它就在盘上）
        const out = faststartPath(abs);
        if (existsSync(out)) continue;
        kickFaststart(abs, out, logFn);
        await FASTSTART_INFLIGHT.get(out);    // 串行：等这一份做完再排下一份
      } catch { /* 单张失败不影响其它 */ }
    }
  }

  const disposers = [];
  disposers.push(() => { try { clearTimeout(startupSweepTimer); } catch { /* ignore */ } });

  // 1. Inventory JSON.
  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/inventory`,
    handler: async (req, res) => {
      try {
        observeAdapter(req);   // 先观测再建库：媒体源起不起由本次请求的形态决定
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

  // 2/3. Media + preview (stream, with Range support for `<video>` seeking).
  // Every stream is registered in activeStreams and released by a three-layer
  // cleanup: response 'close' (normal completion AND client abort mid-download
  // — without this the source fd stays open until process exit, leaking one
  // handle per wallpaper switch/refresh), stream 'end' (explicit release), and
  // the fiber disposer below (plugin unload / HMR destroys every in-flight
  // stream). The 'error' handler turns a vanished file into an aborted
  // response instead of an uncaughtException that crashes the process.
  const activeStreams = new Set();
  // `payloadId`（可选）= 这次响应的载荷账本身份：只有**带体**的传输才有，
  // 字节数在流的 `data` 上累加（`payloadBytes`），完成/中断由 `res` 的 finish/close 结算
  //（结算挂在 serveFile 里 —— 订阅点的顺序比这里更早，不会被 clean 抢在前面）。
  // ⚠️ 计数监听必须**挂在 `pipe()` 之后**：`on('data')` 会立刻让流进入 flowing 模式，
  //    先挂它、后 pipe 有"首块在 pipe 装上之前就被消费掉"的风险（= 响应少一段字节）。
  function trackStream(stream, res, payloadId) {
    activeStreams.add(stream);
    const cleanup = () => {
      activeStreams.delete(stream);
      if (!stream.destroyed) { try { stream.destroy(); } catch { /* ignore */ } }
    };
    stream.once('end', cleanup);
    stream.once('error', (err) => {
      cleanup();
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
      } else {
        try { res.destroy(); } catch { /* ignore */ }
      }
    });
    res.once('close', cleanup);
    stream.pipe(res);
    // 记账监听挂在 pipe 之后（见上方 ⚠️）：它只**观察**已流过的块，不参与背压。
    if (payloadId) {
      stream.on('data', (chunk) => {
        try { payloadBytes(payloadId, chunk && chunk.length ? chunk.length : 0); } catch { /* 记账失败不影响服务 */ }
      });
    }
    return stream;
  }

  // headOnly: HEAD 请求返回与 GET 完全相同的头，但不开流、无 body。
  // opts（可选）：
  //   · `revalidate`  —— 可重验证缓存（ETag / Last-Modified / 304）。**默认关**：
  //     只有内容能由 size+mtime 唯一确定的载荷（scene.pkg / project.json）才该开，
  //     其余族保持 no-store（它们的内容随时可能被用户改）。
  //   · `payloadToken` —— 把这次带体传输记进载荷账本（见 payloadBegin 上方那段）。
  // 两者都只影响**响应头与记账**，不改字节、Range、HEAD 的任何既有语义。
  function serveFile(absPath, req, res, headOnly, opts) {
    if (!absPath || !existsSync(absPath)) {
      // 错误响应绝不能被宿主缓存：Electron 若缓存过 404 页，之后即使文件到位也会
      // 一直显示缓存的错误页（实测：服务端看不到请求、画面却是旧的错误文本）。
      res.setHeader('Cache-Control', 'no-store');
      res.statusCode = 404; res.end('not found'); return;
    }
    const st = statSync(absPath);
    const payloadToken = opts && opts.payloadToken ? String(opts.payloadToken) : '';
    res.setHeader('Content-Type', mimeFor(absPath));
    res.setHeader('Accept-Ranges', 'bytes');
    // 条件 GET：内容由 size+mtime 钉住 ⇒ 未变就 304 无体（几百 MB 的包不必重传）。
    // 带 Range 的请求不走这条（部分内容请求的语义是"要这一段"，不是"复用手上的"）。
    if (opts && opts.revalidate) {
      const etag = 'W/"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';
      res.setHeader('ETag', etag);
      res.setHeader('Last-Modified', new Date(st.mtimeMs).toUTCString());
      res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
      if (!headOnly && !req.headers.range && notModifiedSince(req, etag, st.mtimeMs)) {
        res.statusCode = 304; res.end(); return;
      }
    }
    // 一次带体传输（GET、非 HEAD）：开账 → 计数 → 结算（finish=写完 / close=断在半路）。
    const beginPayload = (size) => {
      if (headOnly || !payloadToken) return 0;
      const id = payloadBegin(payloadToken, size);
      res.once('finish', () => payloadSettle(id, true));
      res.once('close', () => payloadSettle(id, false));
      return id;
    };
    const range = req.headers.range;
    if (range) {
      // 显式三分支：bytes=A-B / bytes=A- / bytes=-S（suffix）。
      // suffix 分支的含义是**末尾 S 字节**：bytes=-500 = 最后 500 字节，不是从 0 起的前 500 字节。
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      if (!m || (!m[1] && !m[2])) {
        // 两端皆空（bytes=-）或格式不匹配 → 不可满足。
        res.statusCode = 416;
        res.setHeader('Content-Range', `bytes */${st.size}`);
        res.end(); return;
      }
      let start;
      let end;
      if (m[1] && m[2]) {          // bytes=A-B
        start = parseInt(m[1], 10);
        end = Math.min(parseInt(m[2], 10), st.size - 1);
      } else if (m[1]) {           // bytes=A-
        start = parseInt(m[1], 10);
        end = st.size - 1;
      } else {                     // bytes=-S（suffix：末尾 S 字节）
        start = Math.max(0, st.size - parseInt(m[2], 10));
        end = st.size - 1;
      }
      if (start > end) {
        res.statusCode = 416;
        res.setHeader('Content-Range', `bytes */${st.size}`);
        res.end(); return;
      }
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${st.size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      if (headOnly) { res.end(); return; }
      trackStream(createReadStream(absPath, { start, end }), res, beginPayload(end - start + 1));
      return;
    }
    res.setHeader('Content-Length', String(st.size));
    if (headOnly) { res.end(); return; }
    trackStream(createReadStream(absPath), res, beginPayload(st.size));
  }

  // Media metadata (source resolution / codec / fps) — the picker hint and the
  // 帧率上限 skip-decision. Registered BEFORE the /media loop ("/media-info"
  // starts with "/media", the prefix matcher would otherwise swallow it).
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/media-info`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET') { res.statusCode = 405; res.end('method not allowed'); return; }
      const pathname = new URL(req.url || '/', 'http://x').pathname;
      const token = decodeURIComponent(pathname.slice(`${BASE}/media-info/`.length));
      const abs = mediaMap.get(token);
      if (!abs) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'unknown-token' }));
        return;
      }
      let info = null;
      try { info = getMediaInfo(abs); } catch { info = null; }
      // 顺手把 faststart 变体排上（见 faststartVariant）：`/media-info` 比播放器的第一个
      // media 请求早到，这里起跑能多抢一点时间；没有变体时本次仍照旧服务原片。
      // 注意：这里**不**下钉子 —— "这一份播放用哪个文件"只由 /media 的第一次请求定音。
      try { faststartVariant(abs, log); } catch { /* ignore */ }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ ok: !!info, info }));
    },
  }));

  // Frame-skip transcode progress (for the picker's progress bar). Polled by
  // the client every ~1s while its transcode fetch is pending; keyed by
  // abs|fps so each wallpaper watches only its own job.
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/transcode-progress`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET') { res.statusCode = 405; res.end('method not allowed'); return; }
      const url = new URL(req.url || '/', 'http://x');
      const token = decodeURIComponent(url.pathname.slice(`${BASE}/transcode-progress/`.length));
      const abs = mediaMap.get(token);
      const fps = clampNum(Number(url.searchParams.get('fps')) || 0, 1, 120, 60);
      let phase = 'idle', percent = 0, source = '', finalizing = false, eta = null;
      const p = abs ? transcodeJobs.get(abs + '|' + fps) : null;
      if (p) {
        phase = p.phase;
        source = p.source || '';
        if (phase === 'download') {
          percent = p.total > 0 ? Math.min(99, Math.round((p.downloaded / p.total) * 100)) : 0;
        } else if (phase === 'transcode' && p.outFile) {
          let size = 0;
          try { size = statSync(p.outFile).size; } catch { /* not created yet */ }
          if (p.expectedBytes && p.expectedBytes > 0) {
            percent = Math.min(99, Math.round((size / p.expectedBytes) * 100));
          }
          // Rolling size samples → growth rate → ETA (wall seconds remaining).
          const now = Date.now();
          if (!Array.isArray(p.samples)) p.samples = [];
          p.samples.push({ t: now, size });
          if (p.samples.length > 24) p.samples.shift();
          if (p.samples.length >= 3 && p.expectedBytes && p.expectedBytes > 0) {
            const a = p.samples[0], b = p.samples[p.samples.length - 1];
            const dt = (b.t - a.t) / 1000;
            const rate = dt > 0 ? (b.size - a.size) / dt : 0;
            if (rate > 0) {
              const rem = p.expectedBytes - b.size;
              if (rem > 0) eta = Math.max(1, Math.round(rem / rate));
            }
          }
          if (percent >= 99) finalizing = true;
        } else if (phase === 'done') {
          percent = 100;
        }
      }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ phase, percent, source, finalizing, eta }));
    },
  }));

  // Frame-skip transcode (抽帧转码): serves a capped-fps re-encode (see
  // transcodeToFps). On cache miss the request waits for the one-time ffmpeg
  // run; the client plays the ORIGINAL first and swaps to this when ready, so
  // first paint is instant. Missing ffmpeg / failed encode ⇒ 502, and the
  // client keeps the original (transparent fallback).
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/transcoded`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET') { res.statusCode = 405; res.end('method not allowed'); return; }
      const url = new URL(req.url || '/', 'http://x');
      const token = decodeURIComponent(url.pathname.slice(`${BASE}/transcoded/`.length));
      const abs = mediaMap.get(token);
      if (!abs) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'unknown-token' }));
        return;
      }
      // Accept every video extension the enumerator produces (WE officially
      // ships MP4/WebM; mkv/avi/mov appear in user folders). ffmpeg demuxes
      // them all and re-muxes to MP4+AV1 regardless of the input container;
      // the moov probe (media-info) stays MP4-only — other containers simply
      // get no source hint and are always transcoded, which is safe.
      if (!/\.(mp4|m4v|mov|webm|mkv|avi)$/i.test(abs)) {
        res.statusCode = 422;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'not-a-video' }));
        return;
      }
      const fps = clampNum(Number(url.searchParams.get('fps')) || 0, 1, 120, 60);
      (async () => {
        let out = null;
        let transcodeErr = null;
        try {
          out = await transcodeToFps(abs, fps, (e) => {
            // 客户端断开 (切换壁纸): 取消转码 — kill ffmpeg + 删 tmp (释放 CPU)
            registerTranscodeWaiter(e, res);
          });
        } catch (err) { transcodeErr = err; }
        if (!out) {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({
            error: 'transcode-failed',
            detail: String(transcodeErr && transcodeErr.message ? transcodeErr.message : transcodeErr),
          }));
          return;
        }
        serveFile(out, req, res);
      })().catch((err) => {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
      });
    },
  }));

  for (const seg of ['media', 'preview']) {
    const prefix = `${BASE}/${seg}/`;
    disposers.push(webServer.register({
      kind: 'prefix',
      path: `${BASE}/${seg}`,
      handler: (req, res) => {
        // GET 流式返回；HEAD 返回与 GET 相同的头但无 body；其余方法 405。
        const method = (req.method || 'GET').toUpperCase();
        if (method !== 'GET' && method !== 'HEAD') {
          res.statusCode = 405;
          res.setHeader('Allow', 'GET, HEAD');
          res.end('method not allowed');
          return;
        }
        const pathname = new URL(req.url || '/', 'http://x').pathname;
        const token = decodeURIComponent(pathname.slice(prefix.length));
        const abs = mediaMap.get(token);
        // faststart 变体（moov 在尾部的源）：有了就用它 —— 播放器第一段就能拿到 moov，
        // 不再顺流整读整个文件（见 faststartVariant 的注释）。**但同一次播放必须始终是同一份
        // 字节**（原片与变体的偏移不同），所以由第一次请求定音、之后钉住：见 pinnedFaststartVariant。
        const fast = seg === 'media' ? pinnedFaststartVariant(abs, token, log) : null;
        serveFile(fast || abs, req, res, method === 'HEAD');
      },
    }));
  }

  // 3a. On-demand thumbnail for a custom-uploaded video (see
  // generateVideoPreview). MP4 uploads have no preview file, so this extracts
  // one frame with the same lazy ffmpeg chain the transcode path uses; while
  // ffmpeg is unavailable the route answers 4xx and the client keeps its
  // "无预览" placeholder.
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/video-preview`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') {
        res.statusCode = 405;
        res.setHeader('Allow', 'GET, HEAD');
        res.end('method not allowed');
        return;
      }
      const pathname = new URL(req.url || '/', 'http://x').pathname;
      const token = decodeURIComponent(pathname.slice(`${BASE}/video-preview/`.length));
      const abs = mediaMap.get(token);
      if (!abs || !/\.(mp4|m4v|mov|webm|mkv|avi)$/i.test(abs)) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'unknown-token' }));
        return;
      }
      (async () => {
        const out = await generateVideoPreview(abs);
        // The URL only carries the path while the frame is keyed by
        // path+size+mtime: no-store stops a replaced source video from serving
        // a stale frame through the same URL (same policy as scene-frame).
        res.setHeader('Cache-Control', 'no-store');
        serveFile(out, req, res, method === 'HEAD');
      })().catch((err) => {
        res.statusCode = 422;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
      });
    },
  }));

  // 3c-3b/3c-5. 场景帧服务族路由（实时抓帧缓存 / 自定义画面）→ lib/routes/scene-frame.js。
  //            三条注册与它们的依赖都在那个文件里；这里只声明它的依赖。
  registerSceneFrameRoutes(webServer, {
    disposers, base: BASE, mediaMap, trackStream, serveFile,
    GPU_FRAME_MAX_BYTES, GPU_WRITE_INFLIGHT,
    CUSTOM_FRAME_EXT, CUSTOM_FRAME_MAX_BYTES,
    armBodyIdleTimeout, atomicWriteFileP, customFrameDir, customFramePath, customIdFromAbs,
    gpuFrameFileFor, lingerClose, looksLikePng, pngSizeOf, sceneFrameSlot,
  });

  // 3c-2/3c-3/3c-3b. 场景载荷服务族路由（live 渲染页 / 壁纸自有文件 / 媒体源诊断 +
  //                 载荷进度账本）→ lib/routes/scene-serve.js。四条注册与它们的依赖都在
  //                 那个文件里；媒体源服务本身（handleSceneFiles / ensureMediaOrigin）
  //                 留在原地 —— /inventory 也消费 ensureSceneMediaOrigin()。
  registerSceneServeRoutes(webServer, {
    disposers, base: BASE, WEBWALLGL_DIR, appendDiagLine, traceRequests, serveFile,
    handleSceneFiles, mediaOriginInfo, payloadProgress, log,
  });

  // 3c-3. Wallpaper file endpoint: raw bytes straight from the wallpaper's own
  //       directory. Scene wallpapers use it as WebWallGL's mediaBase (the
  //       renderer fetches scene.pkg / project.json and parses the container
  //       itself — LZ4 / TEX / DXT decode all live in WebWallGL). Web
  //       wallpapers use it for the HTML entry plus its subresources, with two
  //       host duties the strict-sandbox web path needs:
  //         a) inject the WE API shim into HTML responses — under the strict
  //            sandbox the renderer page cannot reach into the wallpaper
  //            iframe, so the shim must arrive with the document itself (the
  //            same job WallpaperEM's /web/ middleware does);
  //         b) allow opaque-origin fetches via CORS — strict sandbox gives the
  //            wallpaper an opaque origin, so its fetch()/XHR carries
  //            `Origin: null` (img/script/css subresource loads are unaffected).
  //       Path-fenced to the wallpaper directory; Range via serveFile.
  /**
   * /scene-files 的请求处理，**两处挂载共用同一段逻辑**：
   *   a) 应用源（宿主插件路由，见下方 3c-3）——场景壁纸由渲染页自己 fetch
   *      scene.pkg / project.json 走这条（渲染页是同源非沙箱 frame，Desktop 的
   *      能力头栅栏放行）；
   *   b) 壁纸媒体源（我们自己监听的第二个 loopback 端口，见 ensureMediaOrigin）
   *      ——网页壁纸的入口 HTML 与其全部子资源走这条。
   * `mount` 只影响请求记录：应用源逐请求全记（场景 pkg 等，量小），媒体源只记
   * 文档型请求与错误（网页壁纸的子资源太多，全量会把诊断环冲掉）。
   */
  function handleSceneFiles(req, res, mount) {
    const tracePath = () => new URL(req.url || '/', 'http://x').pathname.slice(`${BASE}/scene-files/`.length);
    if (mount === 'app') traceRequests(res, 'scene-files', tracePath());
    else traceMediaRequests(req, res, tracePath());
    const method = (req.method || 'GET').toUpperCase();
    if (method === 'OPTIONS') {
      // 跨源预检（媒体源上的 fetch + 自定义头，例如 Range）：直接放行。
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'range, content-type',
        'Access-Control-Max-Age': '600',
        'Cache-Control': 'no-store',
      });
      res.end();
      return;
    }
    if (method !== 'GET' && method !== 'HEAD') { res.setHeader('Cache-Control', 'no-store'); res.statusCode = 405; res.end('method not allowed'); return; }
      let rest = '';
      try {
        rest = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname.slice(`${BASE}/scene-files/`.length));
      } catch {
        res.setHeader('Cache-Control', 'no-store');
        res.statusCode = 400; res.end('bad request'); return;
      }
      const token = rest.split('/')[0] ?? '';
      const abs = mediaMap.get(token);
      // 错误响应一律 no-store（与 serveFile 的 404 同纪律）：可重验证缓存只放行**载荷**，
      // 缓存住一个 404 会让"文件后来到位了"仍然显示旧错误。
      if (!abs) { res.setHeader('Cache-Control', 'no-store'); res.statusCode = 404; res.end('unknown-token'); return; }
      const subpath = rest.slice(token.length).replace(/^\/+/, '');
      if (!subpath) { res.setHeader('Cache-Control', 'no-store'); res.statusCode = 404; res.end('missing-subpath'); return; }
      // The wallpaper root is the directory holding scene.pkg / scene.json;
      // project.json and the web entry sit next to them. Fence the target.
      //
      // 围栏**两层，缺一不可**：
      //   a) **字面路径**必须落在 root 内（`resolve()` + `startsWith`）—— 挡 `..` 与绝对路径；
      //   b) **解析后的真实路径**也必须落在 root 内 —— `resolve()` 不认识链接，而 `serveFile`
      //      会跟随链接 ⇒ 只有 (a) 不足以把目标钉在壁纸目录里。
      //      `lstatSync` 拒最终组件是链接；`realpathSync.native` 的包含性比对覆盖"中间目录是
      //      链接"（**必须 native**：JS 版 realpathSync 在 Windows 上不解析 junction —— 实测
      //      junction 内的文件它原样返回，native 才给出真实路径）。
      // 两层共用同一个 403 出口 ⇒ 响应形状（状态码 + 体）与补围栏前逐字一致。
      const root = dirname(abs);
      const target = resolve(root, subpath);
      const fenceOut = (why) => {
        appendDiagLine('fence', { route: 'scene-files', why, subpath: subpath.slice(0, 160), referer: String(req.headers.referer || '').slice(0, 120), dest: req.headers['sec-fetch-dest'] || '' });
        // 围栏拒绝 = 有请求被挡下（多半是路径拼错或第三方 HTML 在越界取文件）⇒ 影响显示效果 ⇒ warn。
        log.warn(`scene-files fenced (${why}): subpath="${subpath}" referer="${req.headers.referer || '-'}" dest=${req.headers['sec-fetch-dest'] || '-'}`);
        res.setHeader('Cache-Control', 'no-store');
        res.statusCode = 403; res.end(`forbidden-scene-files[${subpath}]`);
      };
      if (target === root || !target.startsWith(root + sep)) { fenceOut('path'); return; }
      // 「压根不存在」不在这里判 —— 交给下游的 `existsSync` / `serveFile` 出 404，免得把
      // "文件不在"报成"越界"（那会把排除故障的人引向错误方向）。**其余错误一律围栏**：
      // 解析不出来就不发。这一层刻意是 **fail-closed** —— 早先写成"catch 里一律放行"时，
      // 一个解析异常就等于围栏整层失效（`verify-scene-live` 的 junction 判据当场抓到了它）。
      let linked = false;
      let realTarget = '';
      let unresolved = false;
      try {
        linked = lstatSync(target).isSymbolicLink();
        realTarget = realpathSync.native(target);
      } catch (e) {
        const code = e && e.code;
        if (code !== 'ENOENT' && code !== 'ENOTDIR') unresolved = true;
      }
      if (linked) { fenceOut('symlink'); return; }
      if (unresolved) { fenceOut('unresolved'); return; }
      let realRoot = '';
      try { realRoot = realpathSync.native(root); } catch { realRoot = ''; }
      if (!realRoot) { fenceOut('unresolved-root'); return; }
      if (realTarget && realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) { fenceOut('realpath'); return; }
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (method === 'GET' && /\.html?$/i.test(target)) {
        // 入口 HTML 必须 no-store：它带着注入的 shim + 用户属性种子，且上游同步会
        // 换掉它携带的哈希引用（缓存住了就等于把旧种子喂给壁纸）。
        res.setHeader('Cache-Control', 'no-store');
        if (!existsSync(target)) { res.statusCode = 404; res.end('not found'); return; }
        let html = '';
        try { html = readFileSync(target, 'utf8'); } catch { res.statusCode = 500; res.end('read failed'); return; }
        const shim = readWebShim();
        if (shim && html.indexOf('data-we-shim') === -1) {
          // 注入到 <head> 之后（最前）：shim 必须早于作者脚本执行；属性 seed 紧跟
          // 其后（shim 的 __weSeedProps 若早于作者注册 listener 会挂起等待，安全）。
          // 两段内的 `</script` 都先转义，否则内联脚本会被提前截断。
          const esc = (s) => s.replace(/<\/script/gi, '<\\/script');
          const seed = buildSeedScript(target, token);   // token = 该壁纸的覆盖值键
          // 站点根声明（在 shim 之前）：官方 WE 把**壁纸目录本身**当站点根
          //（`..` 解析到根即丢弃），而本插件的形态是 <BASE>/scene-files/<token>/…
          // ——作者按官方语义写的 `../assets/x` 会逃出条目目录打到 unknown-token，
          // spine 类整页黑屏（3650874083 / 3650880224）。shim 按这个声明做夹住；
          // 只给 path（两个源——应用源与壁纸媒体源——路径相同，源由 baseURI 定）。
          // token 是 base64url，无需再编码。
          const siteRoot = `${BASE}/scene-files/${token}/`;
          const tag = `<script data-we-site-root="host">window.__weSiteRoot=${JSON.stringify(siteRoot)};</script>`
            + `<script data-we-shim="host">${esc(shim)}</script>`
            + (seed ? `<script data-we-seed="host">${esc(seed)}</script>` : '');
          const m = /<head[^>]*>/i.exec(html);
          html = m
            ? html.slice(0, m.index + m[0].length) + tag + html.slice(m.index + m[0].length)
            : tag + html;
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(html);
        return;
      }
      // 其余壁纸自有文件（`scene.pkg` 100–336MB、`project.json`）：内容由 size+mtime
      // 唯一确定 ⇒ 走可重验证缓存（ETag/304），并记进载荷账本 ——
      // 大包每次重建 live 层都重读一遍盘的代价，就靠这两条一起消掉。
      serveFile(target, req, res, method === 'HEAD', { revalidate: true, payloadToken: token });
  }

  // 3c-0. 适配器：宿主形态观测（判定与操作系统无关 —— 只读请求头与 UA）。
  //
  // 三档的事实来源：
  //   · 能力头 `x-dsh-desktop-renderer` ⇒ 带栅栏的桌面端。该头由**社区壳**
  //     注入（DSH Desktop.app 的 desktop-browser-access 分片）；官方
  //     DeepSeek Harness.app 的 app.asar 里该字面量零命中 —— 所以"有栅栏"判给
  //     社区端，而不是按 app 名望文生义。
  //   · UA 含 `Electron/` ⇒ 桌面壳。官方与社区都是 Electron，这一档只负责把
  //     「桌面壳」与「原生浏览器」分开，分不了官民。
  //   · 两者皆无 ⇒ 原生浏览器。
  // 两把闩锁**只增不减**：首帧之前可能先来一条非渲染器请求（探活、命令行），
  // 它不该把已经判明的桌面端改回浏览器 —— 而错判成浏览器的代价是网页壁纸 403。
  // 手选（settings.adapterTarget，见 lib/settings-schema.js）优先于观测。
  let adapterFenceSeen = false;
  let adapterShellSeen = false;
  let adapterOverride = 'auto';
  function observeAdapter(req) {
    const headers = (req && req.headers) || {};
    if (headers['x-dsh-desktop-renderer'] !== undefined) adapterFenceSeen = true;
    const ua = headers['user-agent'];
    if (typeof ua === 'string' && /Electron\//i.test(ua)) adapterShellSeen = true;
    const s = readSettings();
    const picked = s && typeof s.adapterTarget === 'string' ? s.adapterTarget : 'auto';
    adapterOverride = ADAPTER_TARGET_VALUES.includes(picked) ? picked : 'auto';
  }
  /** 观测目标（与客户端 src/adapter.js 的判定表同一套字面量）。 */
  function adapterDetectedTarget() {
    if (adapterFenceSeen) return 'desktop-community';
    if (adapterShellSeen) return 'desktop-official';
    return 'browser';
  }
  /** 网页壁纸载荷要不要走独立媒体源。`/media-origin` 是显式探测，不经这条。 */
  function mediaOriginNeeded() {
    if (adapterOverride === 'browser') return false;  // 手选浏览器：显式走应用源
    if (adapterOverride !== 'auto') return true;      // 手选桌面：恒走独立源
    return adapterFenceSeen || adapterShellSeen;      // 自动：观测到桌面形态才需要
  }

  // 3c-3a. 壁纸媒体源：独立 loopback 监听（壁纸载荷的落点）。
  //
  // 为什么需要第二个源 —— DSH Desktop 给**每一个**插件路由套了能力头栅栏
  //（desktop-browser-access 分片 → decideDesktopBrowserAccess：请求必须带
  // x-dsh-desktop-renderer，而该头只由 Electron 主进程注入给「frame.origin === 应用源
  // 且顶层 frame 同源」的请求）。网页壁纸按设计必须跑在 sandbox="allow-scripts" 的
  // 不透明源里：它的 frame.origin 是 "null"，永远拿不到这个头 —— 于是入口 HTML 一律
  // 403 Forbidden，服务端连一行请求日志都不会有（表现为预览图先正常、随后整块黑掉）。
  // 增强模式下普通浏览器访问也不可用（desktopBrowserAccessAvailable 只认兼容模式），
  // 唯一干净的出路是让壁纸载荷根本不经过宿主插件路由：我们自己在 127.0.0.1 上再监听
  // 一个随机端口，只服务 /scene-files/<token>/…，行为与同源那条完全一致（同一段处理
  // 函数：两层目录围栏 / CORS / shim+seed 注入 / Range）。顺带的好处是第三方 HTML 连
  // 「同源」都不再沾边，沙箱之外又多一层隔离。
  // **场景壁纸也走这条**：70–90MB 的 `scene.pkg` 走应用源那条路挤不过
  // 首帧预算（15 秒里还要买纹理解码与 shader 编译），把它的载荷也指向自建源即可。
  // 这条源的根路径 `/diag` 也要接（渲染页的诊断信标打的是 `{mediaBase origin}/diag`），
  // 否则 mediaBase 一指过来，渲染页的告警就 404 静默丢掉 —— 见下面的 `mediaDiagHandler`。
  let mediaOrigin = null;       // { server, port, base }
  let mediaOriginTask = null;
  let mediaOriginDead = false;  // 起过一次就不反复试（否则每次 inventory 都重试绑定）
  /**
   * 诊断族的根路径处理器（`routes/diag.js` 的 `handleDiag`），由 `registerDiagRoutes` 的**出参**
   * `onHandleDiag` 在 3c-7 处武装。**为什么是一个可变量而不是常量**：媒体源在 3c-3a 里创建、
   * 诊断族在 3c-7 里注册，两者在同一次 `apply` 内先后发生；而这个闭包只在**请求时**读它
   * （媒体源是按需懒启动的，任何请求都晚于 `apply` 返回）⇒ 读到的一定是已武装的值。
   * 传值会把 null 快照带进闭包。
   */
  let mediaDiagHandler = null;
  function mediaOriginBase() {
    // 适配器门控：**网页壁纸**的独立源只为「能力头栅栏」存在（栅栏只在桌面壳里）。
    // 原生浏览器没有栅栏 ⇒ 网页载荷走应用源相对路径即可，不必多开一个 loopback 监听。
    // 观测与手选都由 observeAdapter 收敛到 mediaOriginNeeded（见 3c-0）。
    // ⚠️ **场景载荷不走这条门控**（见 ensureSceneMediaOrigin）：它要独立源的理由是带宽。
    if (!mediaOriginNeeded()) return Promise.resolve('');
    return ensureMediaOrigin().then((m) => (m ? m.base : ''));
  }
  /**
   * 场景载荷的源（`/inventory` 的 `sceneMediaBase`）。
   *
   * **与适配器形态无关**：`scene.pkg` 动辄 100–336MB，走应用源（DSH 的插件路由）那条路
   * 实测会饿死（同一份 336MB 包，应用源上出现 15–74s 甚至永不返回的传输；媒体源上 0.6s），
   * 而首帧预算是墙钟 15s ⇒ 大场景壁纸被误判成"渲染不出来"并写进全局失败记忆。
   * 带宽是**所有形态**都成立的物理约束，所以这里直接懒起媒体源（仍然只在库里真有
   * `sceneLive` 时调用，且失败返空串回落应用源）。
   */
  function ensureSceneMediaOrigin() {
    return ensureMediaOrigin().then((m) => (m ? m.base : ''));
  }
  function ensureMediaOrigin() {
    if (mediaOrigin) return Promise.resolve(mediaOrigin);
    if (mediaOriginDead) return Promise.resolve(null);
    if (mediaOriginTask) return mediaOriginTask;
    mediaOriginTask = new Promise((done) => {
      const unavailable = (cause) => {
        const msg = cause instanceof Error ? cause.message : String(cause);
        // error：这不是优雅降级 —— 网页壁纸在 Desktop 上会直接 403（`ensureMediaOrigin`
        // 上方那段注释说明了能力头栅栏），也就是该形态的核心能力不可用。
        log.error(`壁纸媒体源不可用（网页壁纸回落应用源；Desktop 上会 403）：${msg}`);
        appendDiagLine('media-origin', { base: null, error: msg.slice(0, 160) });
        mediaOriginTask = null;
        mediaOriginDead = true;
        done(null);
      };
      let server;
      try {
        server = createServer((req, res) => {
          let pathname = '';
          try { pathname = new URL(req.url || '/', 'http://x').pathname; } catch { pathname = ''; }
          // 渲染页的诊断信标打的是 `{mediaBase origin}/diag`（**根路径**，见 routes/diag.js 的
          // Kg()）。场景壁纸的 mediaBase 指向本媒体源之后，这个根路径必须在这里也有落点 ——
          // 否则「大场景 pkg 首帧超时」时渲染页的告警会以 404 **静默丢掉**，而那正是排查现场
          // 唯一的内窗（同一条不变量见 routes/diag.js）。
          // 纪律与 /scene-files 一致：**同一个 handleDiag**，不另起一份缓冲（`/diag-log` 读的是
          // 同一份）；`${BASE}/diag` 一并接上，与 app 源的两条通道保持对称。
          if (pathname === '/diag' || pathname === `${BASE}/diag`) {
            // 未武装只可能发生在启动竞态里；此时**不假装成功** —— 落到下面的 404，
            // 让"告警丢了"当场可见，而不是被一个 204 吞掉。
            if (mediaDiagHandler) { mediaDiagHandler(req, res); return; }
          }
          if (!pathname.startsWith(`${BASE}/scene-files/`)) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.end('not found');
            return;
          }
          handleSceneFiles(req, res, 'media');
        });
      } catch (cause) { unavailable(cause); return; }
      server.on('clientError', (_err, socket) => { try { socket.destroy(); } catch { /* ignore */ } });
      server.on('error', unavailable);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        const port = addr && typeof addr === 'object' ? addr.port : 0;
        if (!port) { unavailable(new Error('listen 未返回端口')); return; }
        mediaOrigin = { server, port, base: `http://127.0.0.1:${port}` };
        appendDiagLine('media-origin', { base: mediaOrigin.base });
        // 成功事实：**不发日志**，只走提示通道（D4）。文案惰性构造 —— 闸门关掉时不必拼。
        notice('media-origin', () => `壁纸媒体源已监听 ${mediaOrigin.base}（网页壁纸载荷不再经过插件路由的能力头栅栏）`);
        done(mediaOrigin);
      });
    });
    return mediaOriginTask;
  }
  disposers.push(() => { try { mediaOrigin?.server?.close(); } catch { /* ignore */ } });

  /**
   * `/media-origin` 的应答体：媒体源地址与端口。
   * `mediaOrigin` 是**本作用域的可变量**（ensureMediaOrigin 会重新赋值它）⇒ 跨模块只能以
   * **访问器**形式提供；把 `mediaOrigin.port` 的值拷进 context 会永远报 null。
   * `/inventory` 只需要 `mediaOriginBase()`（拼 media/preview 前缀），端口只有诊断路由用。
   */
  function mediaOriginInfo() {
    // 显式探测（GET /media-origin）：问的就是"媒体源在不在"，所以绕开适配器
    // 门控直接起 —— 浏览器形态下 inventory 不用它，但这条诊断路由必须给真话。
    return ensureMediaOrigin().then((m) => ({ base: (m && m.base) || null, port: mediaOrigin ? mediaOrigin.port : null }));
  }

  // 3c-3c. 壁纸属性（WE 用户属性，project.json `general.properties`）：给「壁纸
  //        属性」面板读当前生效值（默认值 ⊎ 用户覆盖）与候选文件。
  //        写入不在这里 —— 覆盖值随设置一起 PUT（/settings），与其它设置共用同一
  //        套持久化与白名单校验，刷新/重启后依旧生效。
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/props`,
    handler: (req, res) => {
      const json = (code, payload) => {
        res.statusCode = code;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(payload));
      };
      if ((req.method || 'GET').toUpperCase() !== 'GET') { json(405, { ok: false, error: 'method-not-allowed' }); return; }
      let token = '';
      try {
        token = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname.slice(`${BASE}/props/`.length)).replace(/\/+$/, '');
      } catch { json(400, { ok: false, error: 'bad-request' }); return; }
      const abs = token ? mediaMap.get(token) : null;
      if (!abs) { json(404, { ok: false, error: 'unknown-token' }); return; }
      const dir = dirname(abs);
      let pj = null;
      try { pj = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')); } catch { /* 无 project.json：仍回空列表 */ }
      // 覆盖值只认 project.json 里还声明着的属性名（作者删掉的属性，陈旧覆盖忽略）
      const overrides = filterKnownOverrides(pj, userPropsFor(token));
      // 候选文件 / 子目录：面板把 file / directory 渲染成下拉，比手打相对路径可靠
      const files = [];
      const dirs = [];
      try {
        for (const ent of readdirSync(dir, { withFileTypes: true })) {
          if (ent.name.startsWith('.')) continue;
          if (ent.isDirectory()) { if (dirs.length < 60) dirs.push(`${ent.name}/`); }
          else if (files.length < 400) files.push(ent.name);
        }
      } catch { /* 读不到就退回文本输入 */ }
      const props = parseUserPropDefs(pj, overrides, {
        filePrefix: entryDirPrefix(String((pj && pj.file) || '')),
        listFiles: files,
      }).map((d) => ((d.ptype === 'directory' && dirs.length) ? { ...d, files: dirs } : d));
      json(200, { ok: true, token, props, overrides, hasProject: Boolean(pj) });
    },
  }));

  // 3c-4. Automatic first-frame cache for WEB wallpapers: once live rendering is
  //       up, the client captures one frame (`__wp.capture`) and POSTs it here —
  //       every later load/restart shows it during the boot delay instead of a
  //       black screen (no cache yet → the client falls back to the wallpaper's
  //       schemecolor). GET validates freshness against the entry file's mtime,
  //       so an updated wallpaper invalidates its stale frame automatically.
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/live-frame`,
    handler: (req, res) => {
      traceRequests(res, 'live-frame', new URL(req.url || '/', 'http://x').pathname.slice(`${BASE}/live-frame/`.length));
      const method = (req.method || 'GET').toUpperCase();
      let token = '';
      try {
        token = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname
          .slice(`${BASE}/live-frame/`.length)).replace(/\/+$/, '');
      } catch { res.statusCode = 400; res.end('bad request'); return; }
      const abs = mediaMap.get(token);
      if (!abs) { res.statusCode = 404; res.end('unknown-token'); return; }
      if (method === 'GET' || method === 'HEAD') {
        const file = liveFrameFile(abs);
        let fresh = false;
        try { fresh = statSync(file).mtimeMs >= statSync(abs).mtimeMs; } catch { fresh = false; }
        if (!fresh) { res.statusCode = 404; res.end('no-frame'); return; }
        res.setHeader('Cache-Control', 'no-store');
        serveFile(file, req, res, method === 'HEAD');
        return;
      }
      if (method !== 'POST') { res.statusCode = 405; res.end('method not allowed'); return; }
      let done = false;
      const fail = (code) => {
        if (done) return;
        done = true;
        res.statusCode = code; res.end();
        lingerClose(req, res);
      };
      const reader = bodyReader(req, {
        maxBytes: 4 * 1024 * 1024,
        shouldStop: () => done,
        onOverflow: () => fail(413),
      });
      req.on('data', reader.onData);
      req.on('end', () => {
        if (done) return;
        done = true;
        try {
          const buf = reader.buf();
          if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) { res.statusCode = 415; res.end('not jpeg'); return; }
          atomicWriteFileSync(liveFrameFile(abs), buf);
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: true, bytes: buf.length }));
        } catch (err) {
          res.statusCode = 500;
          res.end(String(err && err.message ? err.message : err));
        }
      });
      req.on('error', () => { done = true; });
    },
  }));

  // 3c-5. 媒体状态族路由（媒体后端懒启动 + /media-status、/audio-spectrum、
  //       /now-playing、/now-playing/artwork）→ lib/routes/now-playing.js。
  //       后端实例、启动决策与四条注册都在那个文件里；这里只声明它的依赖。
  registerNowPlayingRoutes(webServer, {
    disposers, base: BASE, appendDiagLine, configPath, readConfig, serveFile,
    CONTROL_JSON_MAX_BYTES,
    // 媒体子系统的行统一带 `[media]` 标签（与终端既有形状逐字一致）；级别由调用点标注。
    log: log.tag('media'),
  });

  // 3c-6 / 3c-7. 诊断族路由（/client-diag、/diag、/diag-log）→ lib/routes/diag.js。
  //           注册顺序、共用处理器与两处兜底都在那个文件里；这里只声明它的依赖。
  // 出参 `onHandleDiag` 把诊断族的 `handleDiag` 交回来，武装 3c-3a 的 `mediaDiagHandler` ——
  // 场景壁纸的 mediaBase 指向媒体源之后，渲染页的告警必须在那里也落进**同一份**环形缓冲。
  // ⚠️ 保持这个**语句形态**（行首即函数名、不加以赋值前缀）：`test/tools/host-route-index.mjs`
  //    的调用点正则认的就是它，加了前缀本族会被判成"孤儿族模块"。
  registerDiagRoutes(webServer, {
    disposers, appendDiagLine, base: BASE, log, notice,
    onHandleDiag: (fn) => { mediaDiagHandler = fn; },
  });

  // 3c-3d. WE 官方素材端点（local-assets）—— 上游 WebWallGL 渲染页的消费契约
  //       （renderer/src/local-assets.ts；上游 dev server 在 host/wallpaper-host.ts
  //       实现同一接口，这里是等价的服务端实现）。渲染页只在 URL 带
  //       ?localAssets=1 时探测本端点，客户端仅在素材目录可用时加该参数
  //       （liveRenderUrl），故未配置素材的用户零请求。
  //       四种请求形：
  //         GET /api/local-assets                              → {ok, roots}
  //         GET /api/local-assets/local/materials/index.json   → {names}
  //         GET /api/local-assets/local/materials/<name>.tex   → 文件字节
  //         GET /api/local-assets/local/<rel>                  → 文件字节（fonts 后备）
  disposers.push(webServer.register({
    kind: 'prefix',
    path: '/api/local-assets',
    handler: async (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') { res.statusCode = 405; res.end('method not allowed'); return; }
      const jsonOut = (code, payload) => {
        res.statusCode = code;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(payload));
      };
      let rest = '';
      try {
        rest = new URL(req.url || '/', 'http://x').pathname.slice('/api/local-assets'.length);
      } catch { jsonOut(400, { error: 'bad request' }); return; }
      // 探测（渲染页 installLocalAssets 第一步）：ok=false 时渲染页静默回落
      // 程序化复刻 —— 未配置素材不是错误，是正常态。
      if (rest === '' || rest === '/') {
        const ok = weAssetsAvailable();
        jsonOut(200, { ok, roots: ok ? [{ id: WE_ASSETS_SOURCE_ID, dir: WE_ASSETS_DIR }] : [] });
        return;
      }
      if (!weAssetsAvailable()) { jsonOut(404, { ok: false, error: '素材目录未配置或不可用' }); return; }
      const root = WE_ASSETS_DIR;
      let segs;
      try {
        segs = rest.replace(/^\/+/, '').split('/').filter(Boolean).map(decodeURIComponent);
      } catch { jsonOut(400, { error: '路径非法' }); return; }
      const id = segs.shift() || '';
      if (id !== WE_ASSETS_SOURCE_ID) { jsonOut(404, { error: `未知素材源：${id}` }); return; }
      const rel = segs.join('/');
      if (rel === 'materials/index.json') {
        jsonOut(200, { names: await listWeAssetNames(root) });
        return;
      }
      if (!rel) { jsonOut(400, { error: '路径非法' }); return; }
      // 路径限定：resolve 后必须仍在素材根之内（拒绝 .. 越界）。素材目录只读。
      const target = resolve(root, rel);
      if (!target.startsWith(root + sep)) { jsonOut(403, { error: 'forbidden' }); return; }
      let isFile = false;
      try { isFile = statSync(target).isFile(); } catch { /* ignore */ }
      if (!isFile) { jsonOut(404, { error: `素材不存在：${rel}` }); return; }
      serveFile(target, req, res, method === 'HEAD');
    },
  }));

  // 3c-3e. WE 官方资源路径设置：GET 返回当前配置与可用性；POST {dir} 设置
  //       （空串 / null 清除 → 回落程序化复刻）。只校验目录形态（存在且含
  //       materials/ 子目录），不做任何文件迁移 —— 素材是只读源。
  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/we-assets-dir`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      const jsonOut = (code, payload) => {
        res.statusCode = code;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(payload));
      };
      if (method === 'GET') {
        jsonOut(200, { dir: WE_ASSETS_DIR, available: weAssetsAvailable() });
        return;
      }
      if (method !== 'POST') { res.statusCode = 405; res.end('method not allowed'); return; }
      // 收 body 的两条不变量（权威表述见 lib/routes/upload.js 文件头）：
      //   ① **必须有上限** —— 逐块累加而不比较长度，异常大的请求会把宿主堆无界撑大；
      //   ② **必须一次性解码** —— 逐块 `body += chunk` 会把跨 TCP 分片的多字节码点切成 U+FFFD。
      // 这两件事的**唯一实现**在 `lib/http-body.js`（P4-13）。
      let tooLarge = false;
      const reader = bodyReader(req, {
        maxBytes: CONTROL_JSON_MAX_BYTES,
        onOverflow: () => { tooLarge = true; jsonOut(413, { error: 'payload too large' }); },
      });
      req.on('data', reader.onData);
      req.on('end', () => {
        if (tooLarge) return;
        const body = reader.text();
        let dirRaw = null;
        try { dirRaw = JSON.parse(body || '{}').dir; } catch { /* ignore */ }
        if (dirRaw === '' || dirRaw === null) {
          setWeAssetsDir(null).then(
            () => jsonOut(200, { dir: null, available: false }),
            (err) => jsonOut(500, { error: String(err && err.message ? err.message : err) }),
          );
          return;
        }
        const dir = normalizeUserDir(dirRaw);
        if (!dir) {
          jsonOut(400, { error: '请输入有效的绝对路径（如 D:\\Steam\\steamapps\\common\\wallpaper_engine\\assets 或 ~/WE/assets）' });
          return;
        }
        let hasMaterials = false;
        try { hasMaterials = statSync(join(dir, 'materials')).isDirectory(); } catch { /* ignore */ }
        if (!hasMaterials) {
          jsonOut(400, { error: '该目录下没有 materials/ 子目录 —— 请指向 WE 安装目录的 assets 树（或其拷贝）' });
          return;
        }
        setWeAssetsDir(dir).then(
          async () => jsonOut(200, { dir, available: true, textures: (await listWeAssetNames(dir)).length }),
          (err) => jsonOut(500, { error: String(err && err.message ? err.message : err) }),
        );
      });
      req.on('error', () => {
        if (tooLarge) return; // 超限那条已经应答过，别二次应答
        res.statusCode = 400; res.end('request error');
      });
    },
  }));

  // 3e. Scene MP4 video: extract the scene's embedded animation and serve it as
  //     a hardware-decodable <video> source. Cached like scene-frame. Scenes
  //     without an embedded video answer 404. This is the second source in the
  //     out-figure chain — live WebWallGL rendering comes first (a scene's own
  //     MP4 is a cheap hardware-decoded layer, not a replacement for it).
  const SCENE_VIDEO_INFLIGHT = new Map();
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/scene-video`,
    handler: (req, res) => {
      // GET 流式返回（支持 Range，<video> 拖动/循环用）；HEAD 只返回头。
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') {
        res.statusCode = 405;
        res.setHeader('Allow', 'GET, HEAD');
        res.end('method not allowed');
        return;
      }
      const pathname = new URL(req.url || '/', 'http://x').pathname;
      const token = decodeURIComponent(pathname.slice(`${BASE}/scene-video/`.length));
      const abs = mediaMap.get(token);
      if (!abs) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'unknown-token' }));
        return;
      }
      (async () => {
        let mtime = 0;
        try { mtime = statSync(abs).mtimeMs; } catch { /* keep 0 */ }
        const key = 'sv1_' + Buffer.from(abs, 'utf8').toString('base64url') + '_' + Math.round(mtime);
        const mp4Path = join(ensureFrameCacheDir(), key + '.mp4');
        // 机会式缓存：真实请求的结果回填探测缓存（与 inventory 同键：路径+mtime），
        // 让一次真实请求（含客户端拿到的 404）也「教会」缓存。状态码/响应体不变。
        const probeKey = sceneVideoProbeKey(abs, mtime);
        const cachedMp4 = existsSync(mp4Path);
        // 已有抽好的 mp4 = 该 abs+mtime 曾成功提取过 → 正向回填，不必重提取。
        if (cachedMp4) sceneVideoProbeSet(probeKey, true);
        if (!cachedMp4) {
          // in-flight 去重：同一 key 的并发请求共享一次提取 + 一次缓存写入
          // （按槽位键登记在途任务，落地后只摘自己那一条）。
          let inflight = SCENE_VIDEO_INFLIGHT.get(key);
          if (!inflight) {
            inflight = (async () => {
              try {
                // 异步读盘：scene.pkg 可达几十 MB，readFileSync 会阻塞事件循环。
                const bytes = abs.toLowerCase().endsWith('.json')
                  ? extractSceneVideoFromDir(dirname(abs))
                  : extractSceneVideo(new Uint8Array(await readFile(abs)));
                // 确实没有内嵌 MP4（返回空）→ 记否：后续 inventory 不再为该 pkg
                // 给 URL，后台也不再重复探测。
                if (!bytes || bytes.length === 0) { sceneVideoProbeSet(probeKey, false); return null; }
                // 异步原子发布（.tmp+rename）：写入中途崩溃不留半截缓存文件。
                await atomicWriteFileP(mp4Path, bytes);
                sceneVideoProbeSet(probeKey, true); // 产物已发布 → 正向回填
                return mp4Path;
              } catch (e) {
                // 提取失败记否（客户端 404 从此教会缓存）。
                sceneVideoProbeSet(probeKey, false);
                throw e;
              }
            })();
            SCENE_VIDEO_INFLIGHT.set(key, inflight);
            // 无论成败都摘除（失败允许后续请求重试）。
            inflight.then(
              () => SCENE_VIDEO_INFLIGHT.delete(key),
              () => SCENE_VIDEO_INFLIGHT.delete(key),
            );
          }
          const produced = await inflight;
          if (!produced) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: 'no-scene-video' }));
            return;
          }
        }
        // serveFile：Range 三分支 + HEAD + 流式（与 /media 同一条路径）。
        serveFile(mp4Path, req, res, method === 'HEAD');
      })().catch((err) => {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
      });
    },
  }));

  // 场景包内独立音频：GET/HEAD 流式返回（Range 与 /media 同路径）；无音频 404。
  // 客户端选中场景壁纸时 HEAD 探测此路由，决定卡片音乐按钮与 <audio> 播放。
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/scene-audio`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') {
        res.statusCode = 405; res.end('method not allowed'); return;
      }
      const pathname = new URL(req.url || '/', 'http://x').pathname;
      const token = decodeURIComponent(pathname.slice(`${BASE}/scene-audio/`.length));
      const abs = mediaMap.get(token);
      if (!abs) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'unknown-token' }));
        return;
      }
      (async () => {
        const file = await ensureSceneAudio(abs);
        if (!file) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'no-scene-audio' }));
          return;
        }
        serveFile(file, req, res, method === 'HEAD');
      })().catch(() => {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'scene-audio failed' }));
      });
    },
  }));

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

  // 6c. 「关于」页签的仓库 star 数 → lib/routes/github-stars.js。**只读**一条腿：
  //     本插件唯一一处出站请求（api.github.com），带 10 分钟 TTL + 落盘缓存兜底；
  //     一键 star 不做（GitHub 要点星必须有用户凭据，插件不存任何 token）。
  registerGithubStarsRoutes(webServer, {
    disposers, base: BASE, repoSlug: repoSlugFromPkg(),
    cachePath: () => join(pluginDataDir(), 'star-count.json'),
    log,
  });

  // 6d. 「关于」页签的两张联系方式二维码（静态 PNG，白名单直出）→ lib/routes/about-qr.js。
  registerAboutQrRoutes(webServer, { disposers, base: BASE, aboutDir: ABOUT_DIR, serveFile });

  // 6e. 「扩展」页签的资源柱状图取数（**只读**一条腿：GET /wallpaper-engine/metrics）→
  //     lib/routes/metrics.js。采样器（lib/metrics.js）是进程级状态：懒启动、无人请求
  //     30 s 自停；GPU/网络/磁盘靠一条常驻 `typeperf`（只在 win32 起），起不来就只剩
  //     CPU/内存两行柱子 —— 失败面全在那个文件里，这里只声明依赖。
  registerMetricsRoutes(webServer, { disposers, base: BASE, log });

  // 7. Plugin settings (port-independent persistence replacing localStorage).
  //    GET returns the persisted settings (null when never saved); PUT stores
  //    a sanitized copy in ~/.dsh-wallpaper-engine/config.json. This is what
  //    keeps every setting across DSH Desktop restarts with a new random
  //    --port 0 loopback port, and across browsers/devices on the same host.
  const SETTINGS_MAX_BYTES = 64 * 1024;
  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/settings`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      const json = (code, payload) => {
        res.statusCode = code;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(payload));
      };
      if (method === 'GET') {
        // betterSidebar: 侧栏玻璃控制组是否显示（dsh-better-sidebar 已安装且
        // 启用）。挂在 settings 响应上，客户端 loadPersisted 时一次取回。
        // adapter: 本页面跑在哪种宿主形态里（观测值 fence/detected + 手选后的生效值），
        // 客户端据此挂 body[data-we-adapter]、门控外壳材质与失焦暂停。见 3c-0。
        observeAdapter(req);
        json(200, {
          settings: readSettings(),
          betterSidebar: isBetterSidebarLoaded(ctx),
          adapter: {
            detected: adapterDetectedTarget(),
            fence: adapterFenceSeen,
            target: adapterOverride !== 'auto' ? adapterOverride : adapterDetectedTarget(),
          },
        });
        return;
      }
      if (method !== 'PUT') {
        res.statusCode = 405; res.end('method not allowed'); return;
      }
      let tooLarge = false;
      // 中途放弃（超限 / 超时）走**同一处**断开收口：应答先写，再排空、等应答刷完才断。
      const fail = (code, payload) => {
        if (tooLarge) return;
        tooLarge = true;
        json(code, payload);
        lingerClose(req, res);
      };
      // 60s 无数据即超时（见 armBodyIdleTimeout）。
      armBodyIdleTimeout(req, () => fail(408, { error: 'request timeout' }));
      // 字节计上限 + 收完一次性解码 —— 唯一实现见 `lib/http-body.js`（P4-13）。
      // `fail()` 自己会置 `tooLarge`（见它的定义），`end` 那条早退因此保持不变。
      const reader = bodyReader(req, {
        maxBytes: SETTINGS_MAX_BYTES,
        onOverflow: () => fail(413, { error: 'settings payload too large' }),
      });
      req.on('data', reader.onData);
      req.on('end', () => {
        if (tooLarge) return;
        const body = reader.text();
        let parsed;
        try { parsed = JSON.parse(body || '{}'); } catch {
          json(400, { error: 'invalid JSON body' }); return;
        }
        const sanitized = sanitizeSettings(parsed);
        if (!sanitized) {
          json(400, { error: 'settings must be a JSON object' }); return;
        }
        // 迁移前的护栏：字体值还没进字体集时，这次写入不得抹掉磁盘上的老字体值
        //（`withLegacyFontValues` 的完整理由见它的注释）。迁移落定后它自动失效。
        const persisted = withLegacyFontValues(sanitized);
        // 写已串行化（enqueueConfigWrite），等写盘完成再应答，保持原有
        // 「响应即已持久化」的语义。
        writeSettings(persisted).then(
          () => json(200, { ok: true, settings: persisted }),
          (err) => json(500, { error: String(err && err.message ? err.message : err) }),
        );
      });
      req.on('error', () => { if (!tooLarge) json(400, { error: 'request error' }); });
    },
  }));

  return () => {
    for (const d of disposers) { try { d(); } catch { /* ignore */ } }
    // 目录创建记忆化 (ensureDirOnce) 只对本次 apply 的路径有意义, 卸载后同一
    // 模块实例可能被再次 apply 且路径不同 → 清空, 避免 Set 无界增长。
    ensuredDirs.clear();
    // 杀掉所有在途 ffmpeg 子进程：插件卸载 / HMR 后宿主再无权管理它们，
    // 不杀就是孤儿进程继续吃 CPU/GPU（detached 模式下尤甚）。它们写一半
    // 的 .tmp<pid> 输出留给下次 apply 的 sweepTranscodeArtifacts 清理。
    for (const proc of ACTIVE_FFMPEG) {
      try { proc.kill(); } catch { /* ignore */ }
    }
    ACTIVE_FFMPEG.clear();
    // 在途转码任务置 error：正在轮询 transcode-progress 的客户端立刻看到
    // 失败并回退原始文件，而不是等一个永远不会 done 的任务。
    for (const job of transcodeJobs.values()) {
      if (job.phase === 'download' || job.phase === 'transcode') job.phase = 'error';
    }
    // 在途 Promise 本身无法取消，但其 finally 的 delete 对空 Map 是 no-op；
    // 清空后新 apply 的同名任务不会被旧的 inflight 条目误命中。
    TRANSCODE_INFLIGHT.clear();
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
