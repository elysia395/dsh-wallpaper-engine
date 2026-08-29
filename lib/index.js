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
 *      Scene (native 3D) and Application wallpapers are listed too, but only
 *      their preview image is served (they cannot be rendered here — see README).
 *   3. Serve a JSON inventory and the media/preview bytes over loopback HTTP
 *      routes the browser half fetches directly (same-origin):
 *        GET /wallpaper-engine/inventory          → { installDir, wallpapers:[…], playlists:[…] }
 *        GET /wallpaper-engine/media/<token>      → video / html (Range supported)
 *        GET /wallpaper-engine/preview/<token>    → preview image
 *
 * The plugin contributes no model-visible tool and no prompt text. Every route
 * is registered through the plugin fiber so it unwinds on unload. `webServer`
 * is treated as optional (guarded with ctx.get) so the bundle also loads in a
 * headless/TUI profile that has no HTTP server.
 */

import {
  readFileSync,
  existsSync,
  statSync,
  createReadStream,
  createWriteStream,
  readdirSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
  renameSync,
  openSync,
  readSync,
  writeSync,
  fstatSync,
  closeSync,
  fsyncSync,
  chmodSync,
} from 'node:fs';
// Async filesystem (thread pool) for the wallpaper-scan chain — keeps the
// event loop responsive on slow media (WSL DrvFS) instead of blocking it for
// seconds per chunk (see "Loading plugins…" stall report).
import {
  access, readdir, readFile, stat,
  writeFile as writeFileP, rename as renameP, unlink as unlinkP, copyFile as copyFileP,
} from 'node:fs/promises';
import { join, resolve, normalize, basename, dirname, relative, isAbsolute, extname } from 'node:path';
import { homedir, tmpdir, cpus } from 'node:os';
import { createHash } from 'node:crypto';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

// Scene wallpaper animation + live player (ported from dsh-web-ui's
// skin-center we-* modules). WE_SCENE_PLAYER_HTML is served by
// /wallpaper-engine/scene-runtime; the manifest/resource extractors feed it.
// They are separate modules so the existing static-frame path (pkg-extract.js)
// is never disturbed.
import { WE_SCENE_PLAYER_HTML } from './scene-player.js';
import { buildSceneManifest, buildSceneManifestFromDir,
         extractSceneResourceVia,
         extractSceneVideo, extractSceneVideoFromDir } from './scene-manifest.js';
import { readPkg } from './we-renderer/textures.js';
// scene-gl（Phase 1，docs/plan-scene-webgl.md §4）：纹理解析兜底 + shader 元数据。
import { resolveSceneTexPath, pkgSceneAccess, dirSceneAccess, parseTex, decodeTex } from './pkg-extract.js';
import { expandIncludes, parseMetaGL, patchShakeFrag } from './we-renderer/glsl/preprocess.js';
import { sceneHasScripts } from './scene-scripts.js';
import { getBuiltinTexturePng, getBuiltinTextureInfo, normalizeBuiltinUtilName } from './we-renderer/util-textures.js';
import { encodePng } from './we-renderer/canvas.js';

/** Steam appid for Wallpaper Engine. */
const WE_APPID = '431960';
/** Request path prefix under which this bundle's HTTP surface lives. */
const BASE = '/wallpaper-engine';
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
    html: 'text/html', htm: 'text/html', js: 'text/javascript',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    png: 'image/png', webp: 'image/webp', apng: 'image/apng',
  }[ext] || 'application/octet-stream';
}

// ── Custom uploads (read-A storage: files live on disk in a plugin-managed
//    directory, served through the SAME token/media/preview routes as the
//    Wallpaper Engine media — no IndexedDB, no quota limits, survives
//    restarts by construction). ──────────────────────────────────────────────
/** Config file that remembers the user-chosen upload directory. */
function configPath() { return join(homedir(), '.dsh-wallpaper-engine', 'config.json'); }

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
async function atomicWriteFileP(filePath, data) {
  const tmp = filePath + '.tmp';
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
 * The browser half reads/writes them through GET/PUT /wallpaper-engine/settings,
 * replacing localStorage as the source of truth (which was origin-scoped and
 * reset whenever DSH Desktop restarts on a new random --port 0 loopback port).
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

// ── Server-side settings validation (mirror of the client's readPersisted
//    whitelist in src/client.js; keep the two in sync) ───────────────────────
const RATING_VALUES = ['all', 'everyone', 'pg13', 'mature', 'unrated'];
const TYPE_VALUES = ['all', 'video', 'web', 'image', 'scene'];
const OBJECT_FIT_VALUES = ['cover', 'contain', 'center', 'fill'];
/** 吉祥物（拉绳）可选形态：maid = 默认小女仆，whale = 鲸御姐. Mirror of src/client.js. */
const ROPE_FORM_VALUES = ['maid', 'whale'];
const ROPE_SCALE_MIN = 0.5, ROPE_SCALE_MAX = 2.5;
/** 字体族白名单（字体自定义）. Mirror of src/client.js FONT_FAMILY_VALUES. */
const FONT_FAMILY_VALUES = ['inherit', 'Microsoft YaHei', 'KaiTi', 'SimSun', 'SimHei', 'STXingkai', 'monospace'];
/** 解码帧率上限 options (fps); 0 = 无限制. Mirror of the client's list. */
const FPS_CAP_VALUES = [0, 60, 48, 30, 24];

function clampNum(v, lo, hi, fallback) {
  return typeof v === 'number' && v >= lo && v <= hi ? v : fallback;
}

function clampStr(v, allowed, fallback) {
  return allowed.includes(v) ? v : fallback;
}

// ── Scene 视频纹理静态帧 (ffmpeg 抽帧) ──────────────────────────
// WE 场景主纹理可以是视频: TEX 容器内嵌 MP4 (sync 视频纹理, TEXI 标志或
// mip0 ftyp box) 或独立 .mp4/.webm/.mov 文件 (material textures 引用)。
// SceneRenderer 无法解码视频 → 渲染前在主线程用 ffmpeg 抽指定时刻的帧为
// PNG, 映射表 (规范化引用路径 → PNG) 传给 worker; loadTexture 遇视频引用
// 时读 PNG 替代。抽帧失败不影响渲染 (该纹理缺省, 维持现状)。
const SCENE_VIDEO_EXT_RE = /\.(mp4|m4v|webm|mov)$/i;

function normalizeSceneTexRef(ref) {
  const r = String(ref || '');
  return r.startsWith('materials/') ? r : 'materials/' + r;
}

/** 收集场景内的视频纹理 (独立媒体文件; TEX 内嵌 MP4 另行检测)。 */
function collectSceneVideoFiles(access) {
  const videos = [];
  for (const e of access.list()) {
    if (!SCENE_VIDEO_EXT_RE.test(e.path)) continue;
    let b = null;
    try { b = e.read(); } catch { /* ignore */ }
    if (b && b.length) videos.push({ ref: e.path, bytes: Buffer.from(b) });
  }
  return videos;
}

// P0-3①: 视频引用扫描 memoize — scene-frame/scene-anim 每帧渲染都无条件经过
// 本扫描 (:628 readFileSync 整包 + 全部 .tex 逐条整解压), 同一壁纸反复切回/
// 双视口重复付全价; "无视频"结论同样缓存 (绝大多数场景是纯纹理)。键 =
// abs + sceneCacheStamp (pkg=自身 mtimeMs; 松散场景=目录全文件 mtime hash,
// 与 sf35_/san_* 失效键同源) + size。容量 16 条 LRU (删最旧); 值含视频字节
// (vid_* 帧缓存键的内容 hash 依赖它), 失效只随 mtime。
const _sceneVideoScanCache = new Map();
const SCENE_VIDEO_SCAN_CACHE_MAX = 16;

/**
 * 扫描场景的视频引用 (独立媒体文件 + TEX 内嵌 MP4), 带 memoize。
 * 返回 [{ref, bytes}]; 失败向上抛 (与旧路径一致, 不缓存失败)。
 */
async function scanSceneVideoRefs(src, srcPath) {
  // 提到分支外: 旧代码在 pkg 分支内解构、循环在分支外使用, 松散场景 (目录)
  // 走到 .tex 循环即 ReferenceError (被上游 catch 吞掉 → 内嵌视频静默丢失)。
  const { extractTexVideoMp4, probeTexVideoQuick } = await import('./pkg-extract.js');
  let isDir = false;
  try { isDir = statSync(srcPath).isDirectory(); } catch { /* ignore */ }
  // memoize 键: stat 失败 (源已消失) 时不缓存, 直接走原路径让其抛错
  let memoKey = null;
  try {
    const st = statSync(srcPath);
    // 松散场景用 scene.json 路径触发 sceneCacheStamp 的目录全量 mtime walk
    // (srcPath 是目录时其自身 mtime 不随内容变化, 键会滞留旧值)
    const stampBase = isDir ? join(srcPath, 'scene.json') : srcPath;
    memoKey = srcPath + '|' + sceneCacheStamp(stampBase) + '|' + st.size;
  } catch { memoKey = null; }
  if (memoKey) {
    const hit = _sceneVideoScanCache.get(memoKey);
    if (hit) {
      // LRU touch: 重插到尾 (Map 迭代序=插入序, 头部即最旧)
      _sceneVideoScanCache.delete(memoKey);
      _sceneVideoScanCache.set(memoKey, hit);
      return hit;
    }
  }
  let access = null;
  let pkgData = null;
  let pkgEntries = null;
  if (isDir) {
    const root = srcPath;
    access = {
      list() {
        const out = [];
        const walk = (dir) => {
          let names = [];
          try { names = readdirSync(dir, { withFileTypes: true }); } catch { return; }
          for (const n of names) {
            const full = join(dir, n.name);
            if (n.isDirectory()) {
              if (!n.name.startsWith('.')) walk(full);
            } else {
              out.push({
                path: full.slice(root.length + 1).replace(/\\/g, '/'),
                read: () => readFileSync(full),
              });
            }
          }
        };
        walk(root);
        return out;
      },
    };
  } else {
    pkgData = readFileSync(srcPath);
    const { parsePkg, readPkgEntry } = await import('./pkg-extract.js');
    pkgEntries = parsePkg(pkgData);
    access = {
      // raw: 保留原始条目 (offset/compressedSize/flags) 供头部探测
      list: () => pkgEntries.map((e) => ({ path: e.path, read: () => readPkgEntry(pkgData, e), raw: e })),
    };
  }
  // 视频来源: 独立媒体文件 + TEX 容器内嵌 MP4
  const videos = collectSceneVideoFiles(access);
  for (const e of access.list()) {
    if (!e.path.toLowerCase().endsWith('.tex')) continue;
    // P0-3②: 头部探测确定非视频 → 跳过整条目解压; 'unknown' (判不准) 与
    // 'video' 走原全量路径 (保守正确优先)。松散场景无 raw, 直接全量。
    if (e.raw && probeTexVideoQuick(pkgData, e.raw) === 'no') continue;
    let b = null;
    try { b = e.read(); } catch { /* ignore */ }
    if (!b) continue;
    const mp4 = extractTexVideoMp4(b);
    if (mp4) videos.push({ ref: e.path, bytes: mp4 });
  }
  if (memoKey) {
    _sceneVideoScanCache.set(memoKey, videos);
    while (_sceneVideoScanCache.size > SCENE_VIDEO_SCAN_CACHE_MAX) {
      _sceneVideoScanCache.delete(_sceneVideoScanCache.keys().next().value);
    }
  }
  return videos;
}

/**
 * 为主线程的 scene 静态帧渲染预抽取视频纹理帧。
 * src: scene.pkg 文件 / 松散目录 / scene.json 文件路径。
 * 返回 Map<规范化纹理引用, PNG 路径>; 无视频或 ffmpeg 不可用返回空 Map。
 */
async function extractSceneVideoFrames(src, time, signal) {
  const map = new Map();
  const srcPath = String(src).toLowerCase().endsWith('.json') ? dirname(src) : src;
  const videos = await scanSceneVideoRefs(src, srcPath);
  if (!videos.length) return map;
  let ff = null;
  try { ff = await resolveFfmpeg(null); } catch { return map; }
  if (!ff) return map;
  const outDir = ensureFrameCacheDir();
  const tKey = String(Math.round((Number(time) || 0) * 1000));
  for (let i = 0; i < videos.length; i++) {
    const v = videos[i];
    // H-02: tmp 键纳入内容 hash — 旧键只有 pid+index, 同进程内两个 wallpaper 的
    // 同名视频纹理 (如各自 materials/loop.mp4) 抽帧时写同一路径互相覆盖半截
    // 文件, ffmpeg 读到混合字节; 内容键后同名不同内容互不干扰。
    const contentHash = createHash('sha256').update(v.bytes).digest('hex').slice(0, 12);
    const extMatch = /(\.[^.]+)$/.exec(v.ref);
    const tmpVideo = join(tmpdir(), 'dsh-we-vid-' + process.pid + '-' + i + '-' + contentHash + (extMatch ? extMatch[1] : '.mp4'));
    // 帧缓存键同样纳入内容 (旧键 ref|length: 同长不同内容的视频串缓存 → 坏帧;
    // 键变化只让旧缓存条目自然过期, 不降低安全性)
    const hash = createHash('sha256').update(v.ref + '|' + v.bytes.length + '|' + contentHash).digest('hex').slice(0, 16);
    const outPng = join(outDir, 'vid_' + hash + '_' + tKey + '.png');
    if (existsSync(outPng)) {
      map.set(normalizeSceneTexRef(v.ref), outPng);
      continue;
    }
    try {
      writeFileSync(tmpVideo, v.bytes);
      // -update 1: image2 muxer 写单帧必须加 (否则警告"no image sequence pattern"
      // 且不写文件 → 视频纹理抽帧失败 → 组件黑)。-ss 在 -i 前 (快速 seek)。
      await spawnFfmpeg(ff, ['-ss', String(Number(time) || 0), '-i', tmpVideo, '-frames:v', '1', '-update', '1', '-f', 'image2', '-vcodec', 'png', outPng], 0, { signal });
    } catch (e) {
      if (signal && signal.aborted) throw new Error('cancelled');
      try { unlinkSync(tmpVideo); } catch { /* ignore */ }
      continue; // 抽帧失败 → 该视频纹理缺省 (维持现状)
    }
    try { unlinkSync(tmpVideo); } catch { /* ignore */ }
    if (existsSync(outPng)) map.set(normalizeSceneTexRef(v.ref), outPng);
  }
  return map;
}

// 在 worker 线程渲染场景帧, 返回 { ok, png(Buffer), diff, checked } 或 { ok:false, error }
let _weInstallDirCache = null;
// scene-anim APNG 并发去重: 缓存路径 → 渲染 Promise (同参数同时请求只渲染一次)
const _sceneAnimInflight = new Map();
// /scene-manifest 结果缓存 (P-10): 大 pkg 的 manifest 构建是 CPU 重活 (解包 +
// 全纹理解析), 每次客户端拉取都重建会阻塞主线程数秒。键 = abs + mtimeMs 全精度
// (文件更新自动失效), 值 = 序列化 JSON 字符串 (LRU 上限 8); 并发请求经
// _sceneManifestInflight 去重共享一次构建。只缓存成功结果, 失败允许重试。
const _sceneManifestCache = new Map();
const _sceneManifestInflight = new Map();
const SCENE_MANIFEST_CACHE_MAX = 8;
// 场景 ortho 宽高比缓存 (scene-frame/scene-anim 渲染尺寸修正 — 视口比例 ≠ 场景
// 宽高比会垂直裁切; 非 16:9 壁纸如 3582367840 ortho 2880×1800 固定 16:9 渲染即裁切)
const _sceneAspectCache = new Map();
function sceneAspect(abs) {
  if (_sceneAspectCache.has(abs)) return _sceneAspectCache.get(abs);
  let ar = null;
  try {
    // H-08: 松散场景 (scene.json 项目) 直接读 scene.json — 旧实现一律 readPkg,
    // 对目录 readFileSync 抛 EISDIR → 宽高比恒 null, 非 16:9 壁纸的渲染尺寸
    // 修正静默失效 (与 glSceneAccess 的 .json→dirSceneAccess 分支同款分流)。
    let sc = null;
    if (abs.toLowerCase().endsWith('.json')) {
      sc = JSON.parse(readFileSync(abs, 'utf8'));
    } else if (statSync(abs).isDirectory()) {
      sc = JSON.parse(readFileSync(join(abs, 'scene.json'), 'utf8'));
    } else {
      sc = readPkg(abs).readJson('scene.json');
    }
    const ortho = sc && sc.general && sc.general.orthogonalprojection;
    if (ortho && ortho.width && ortho.height) ar = parseFloat(ortho.width) / parseFloat(ortho.height);
  } catch { /* 保持 null */ }
  _sceneAspectCache.set(abs, ar);
  return ar;
}

// 场景缓存失效键 (P-12): pkg/视频文件用自身 mtimeMs 全精度 (Math.round 会把
// 亚秒内的更新抹平 → 引用更新后仍吃旧缓存); 松散场景 (abs 是 scene.json) 把
// 目录内全部文件 (≤4 层, 与 dirSceneAccess 同深度上限) 的 mtime+size 纳入
// hash — scene.json 自身的 mtime 不随其引用的 .tex/材质文件变化。
function sceneCacheStamp(abs) {
  if (abs.toLowerCase().endsWith('.json')) {
    try {
      const dir = dirname(abs);
      const parts = [];
      const walk = (sub, depth) => {
        if (depth > 4) return;
        let names = [];
        try { names = readdirSync(join(dir, sub)); } catch { return; }
        for (const n of names) {
          const rel = sub ? sub + '/' + n : n;
          let st = null;
          try { st = statSync(join(dir, rel)); } catch { continue; }
          if (st.isDirectory()) walk(rel, depth + 1);
          else parts.push(rel + ':' + st.mtimeMs + ':' + st.size);
        }
      };
      walk('', 0);
      return 'd' + createHash('sha256').update(parts.sort().join('|')).digest('hex').slice(0, 16);
    } catch { /* 落回单文件 mtime */ }
  }
  try { return String(statSync(abs).mtimeMs); } catch { return '0'; }
}

// 帧缓存磁盘 GC (P-10 收窄版 + N-05 字节预算): frames 目录下 sf* (scene-frame
// 静态帧) / san_* (scene-anim 动画产物) / vid_* (视频纹理抽帧) / sv2_*
// (scene-video mp4) 四类前缀统一纳入 — 旧实现只按 sf* 条数 (>32) 清, 4K PNG
// 单张可 10MB+, 条数上限形同虚设, 其余三类只增不减。改为按文件 size 累加的
// 字节预算 (默认 256MB, DSH_WE_FRAME_CACHE_MAX_BYTES 可调), 超限按 mtime 从
// 最旧开始删。旧 sv1_* 键已被 sv2_ (P-14) 取代永不命中, 见到即删。keepPath
// 计入总量但永不删 (刚发布的产物, 语义同 sweepTranscodeCache)。挂载点:
// apply() 启动清扫一次 + sf/san/sv2 各落盘点触发 (vid_* 由启动清扫兜底)。
function gcFrameCacheSync(dir, keepPath) {
  let names = [];
  try { names = readdirSync(dir); } catch { return; }
  const maxBytes = Number(process.env.DSH_WE_FRAME_CACHE_MAX_BYTES) || 256 * 1024 * 1024;
  const statted = [];
  let total = 0;
  for (const n of names) {
    const p = join(dir, n);
    try {
      if (/^sv1_/.test(n)) { unlinkSync(p); continue; } // 旧键已失效, 直接清
      if (!/^(sf|san_|vid_|sv2_)/.test(n)) continue;
      const st = statSync(p);
      if (!st.isFile()) continue;
      total += st.size;
      if (p !== keepPath) statted.push({ p, m: st.mtimeMs, size: st.size });
    } catch { /* 在用/权限, 下轮再清 */ }
  }
  if (total <= maxBytes) return;
  statted.sort((a, b) => a.m - b.m); // 最旧在前
  for (const e of statted) {
    if (total <= maxBytes) break;
    try { unlinkSync(e.p); total -= e.size; } catch { /* 在用/权限, 下轮再清 */ }
  }
}
// scene-anim 缓存路径: 场景mtime+参数+格式+管线版本 (与 scene-frame sf* 同版本语义)
// sf35 = shake 2π 平滑数学 + UV→像素单位 + mask header/mip0 比 (foliagesway 等)
// 旧版: shake 从不生效且每循环闪一帧; mask 错误平铺 → 植物摆动落空
function sceneAnimCachePath(abs, fps, sec, w, h, ext) {
  // P-12: 失效键走 sceneCacheStamp (mtimeMs 全精度; 松散场景纳入引用文件 mtime)
  const stamp = sceneCacheStamp(abs);
  // W0: runScripts 入键 — 脚本开/关产出不同帧 (脚本写 visible/origin 等),
  // 不入键则开关切换后吃到旧缓存 (脚本关的帧被当脚本开的帧下发)
  const rs = (() => { try { return readSettings()?.enableSceneScripts === true ? '|rs1' : ''; } catch { return ''; } })();
  const key = 'san_sf35_' + createHash('sha256')
    .update(abs + '|' + stamp + '|' + fps + '|' + sec + '|' + w + '|' + h + '|' + ext + rs)
    .digest('hex').slice(0, 20) + ext;
  return join(ensureFrameCacheDir(), key);
}
// scene-anim 渲染进度文件: <cachePath 去扩展名>.<fmt>.prog, 内容 "done/total"; 完成删除
// fmt 后缀隔离: 同参数 apng 与 mp4/webm 的 cachePath 去扩展名后相同, 若共用 .prog
// 两个渲染任务会互相覆盖进度 (进度条跳变) — 用格式名区分。
function sceneAnimProgressFile(cachePath, ext) {
  const fmt = ext === '.apng' ? 'apng' : 'vid';
  return cachePath.slice(0, -String(ext).length) + '.' + fmt + '.prog';
}
// P0-4④: 渲染尺寸档位量化 (960/1280/1920) — cache key 含 w/h, 相邻视口尺寸
// (1536/1680/1792 …) 各自 miss 缓存重复整段渲染。宽向上取整到档位, 高按场景
// ortho 宽高比 (无 ortho 时按请求比例) 重导出, 高超 1080 预算时等比回缩 —
// 档位只影响键的组合数, 不破坏 sceneAspect 已修正的纵横比。量化即按档位
// 渲染 (响应与缓存同尺寸; 客户端 object-fit 容忍任意尺寸 PNG/MP4)。
// /scene-anim 与 /scene-anim-progress 两处必须用同一函数量化, 键才一致。
const SCENE_ANIM_SIZE_TIERS = [960, 1280, 1920];
function quantizeSceneAnimSize(abs, w, h) {
  let tw = w;
  for (const t of SCENE_ANIM_SIZE_TIERS) {
    if (w <= t) { tw = t; break; }
  }
  if (tw === w) return { w, h }; // 已在档位 (或超出最大档, clamp 已限 1920)
  const sar = sceneAspect(abs);
  let nh = sar ? Math.round(tw / sar) : Math.round((h * tw) / w);
  if (nh > 1080) {
    // 高预算上界与路由 clamp 一致: 等比回缩 (宽不再纯档位, 但键仍确定)
    const rw = Math.round((1080 * tw) / nh);
    return { w: Math.max(320, rw), h: 1080 };
  }
  return { w: tw, h: Math.max(180, nh) };
}
// P0-4①: 入口拿全局渲染信号量, finally 释放 — 排队期间不启动 worker、不计时。
async function renderSceneFrameInWorker(src, width, height, time, opts = {}) {
  await acquireRenderSlot();
  try {
    return await renderSceneFrameInWorkerHeld(src, width, height, time, opts);
  } finally {
    releaseRenderSlot();
  }
}
async function renderSceneFrameInWorkerHeld(src, width, height, time, opts = {}) {
  if (_weInstallDirCache === null) _weInstallDirCache = await locateWallpaperEngineP();
  const weAssetsDir = _weInstallDirCache || undefined;
  const { times, frameDelayMs } = opts;
  const signal = opts.signal || null;
  // W0: 脚本总开关 (用户拍板: 完全不执行壁纸内嵌脚本) — settings.enableSceneScripts
  // 缺省/false → worker 渲染全程跳过 applySceneScripts; 含脚本壁纸由渲染器发
  // scene-script degraded (上浮到日志) + GL gate 同款标记 (配置页提醒)。
  const runScripts = (() => { try { return readSettings()?.enableSceneScripts === true; } catch { return false; } })();
  // 单帧模式: 预抽取场景视频纹理静态帧 (ffmpeg) 传给 worker 替代视频引用;
  // 多帧 (APNG) 模式: 视频纹理暂用首帧 (times[0]) 的静态帧 — 逐帧抽帧成本高,
  // 且 SceneRenderer 复用单实例时 videoFrames 静态; 逐帧播放留待后续
  let videoFrames = null;
  if (!(signal && signal.aborted)) {
    try {
      const vt = times && times.length ? times[0] : time;
      videoFrames = await extractSceneVideoFrames(src, vt, signal);
    } catch { videoFrames = null; }
  }
  if (signal && signal.aborted) throw new Error('cancelled');
  return new Promise((resolve) => {
    let worker;
    try {
      worker = new Worker(new URL('./scene-render-worker.mjs', import.meta.url), {
        workerData: {
          src, width, height, time, times, frameDelayMs, weAssetsDir, runScripts,
          fmt: opts.fmt, rawVideo: opts.rawVideo === true, // P2-14: raw 帧模式开关
          videoFrames: videoFrames && videoFrames.size ? Object.fromEntries(videoFrames) : null,
        },
        type: 'module',
      });
    } catch (e) {
      resolve({ ok: false, error: String(e && e.message ? e.message : e) });
      return;
    }
    // P0-4②: 创建即注册 — 卸载 disposer 兜底 terminate (finish 是唯一收口)
    ACTIVE_SCENE_WORKERS.add(worker);
    let settled = false;
    // P-07: timer 提升到 finish 之前声明 — 旧实现 const timer 声明在 addEventListener
    // 之后, abort 预中止路径 onAbort→finish→clearTimeout(timer) 触发 TDZ
    // ReferenceError (用 null 预置, clearTimeout(null) 是无害 no-op)
    let timer = null;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      try { worker.terminate(); } catch { /* ignore */ }
      ACTIVE_SCENE_WORKERS.delete(worker);
      resolve(v);
    };
    const onAbort = () => {
      // 客户端断开 (切换壁纸): 终止 worker 释放 CPU — 渲染任务由调用方按
      // signal 取消, 这里只保证 worker 线程尽快结束, 结果被丢弃。
      try { worker.terminate(); } catch { /* ignore */ }
      finish({ ok: false, error: 'cancelled' });
    };
    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    // 大型场景 CPU 光栅化可能很慢, 给足超时 (多帧 × 每帧)
    // N-04: 旧公式 600000×framesN 无上界 (216 帧=36h 形同虚设) — 改有界:
    // 单帧 10 分钟 × 帧数, 封顶 20 分钟; 超时按失败收尾走既有回退链。
    const framesN = times && times.length ? times.length : 1;
    timer = setTimeout(
      () => finish({ ok: false, error: 'scene render timeout' }),
      Math.min(600000 * Math.max(1, framesN), 20 * 60 * 1000),
    );
    const onProgress = opts.onProgress;
    const onFrame = opts.onFrame; // P2-14: raw 帧消费者 (视频合成路径), 缺省时丢弃
    worker.on('message', (msg) => {
      // 多帧逐帧进度 (scene-anim 渲染进度条)
      // P-11: progress 消息只是进度通知、不是结果 — 旧实现仅在 onProgress 存在
      // 时 return, 无回调的调用方 (scene-frame 等) 会把 progress 消息误判为
      // 渲染失败提前收尾 (worker 契约: 唯一的结果消息带 ok 字段)。
      if (msg && msg.progress) {
        if (onProgress) {
          try { onProgress(msg.done || 0, msg.total || framesN); } catch { /* ignore */ }
        }
        return;
      }
      // P2-14: raw 帧消息 — 中间帧直传 (非结果消息), 与 progress 同款语义:
      // 无消费者 (onFrame 缺省) 时静默丢弃, 绝不误判为结果/失败。帧序由
      // worker→host 消息队列 FIFO 保证。
      if (msg && msg.frame) {
        if (onFrame && msg.rgba) {
          try { onFrame(Buffer.from(msg.rgba.buffer, msg.rgba.byteOffset, msg.rgba.byteLength), msg.index | 0); } catch { /* ignore */ }
        }
        return;
      }
      if (msg && msg.ok) {
        // 契约 C1/Wave 3: worker 上浮的 CPU degraded 清单 (可缺省) — 透传进
        // 返回值供调用方记录/上浮, 不改变 ok 语义 (最小侵入方式)
        const degraded = Array.isArray(msg.degraded) ? msg.degraded : undefined;
        // P2-14: raw 模式结果 — 帧已经 onFrame 流出, 无 apng/png 载荷
        if (msg.raw) finish({ ok: true, raw: true, degraded });
        else if (msg.apng) finish({ ok: true, apng: Buffer.from(msg.apng), degraded });
        else finish({ ok: true, png: Buffer.from(msg.png), diff: msg.diff, checked: msg.checked, degraded });
      } else {
        finish({ ok: false, error: (msg && msg.error) || 'scene render failed' });
      }
    });
    worker.once('error', (e) => finish({ ok: false, error: String(e && e.message ? e.message : e) }));
    worker.once('exit', (code) => {
      if (code !== 0) finish({ ok: false, error: 'scene render worker exited ' + code });
    });
  });
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

function sanitizeSettings(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw;
  const rotationGroups = Array.isArray(o.rotationGroups)
    ? o.rotationGroups
        .filter((g) => g && typeof g === 'object' && typeof g.id === 'string' && g.id)
        .map((g) => ({
          id: g.id,
          name: typeof g.name === 'string' && g.name.trim() ? g.name.trim() : '轮播列表',
          interval: clampNum(g.interval, 1, 1440, 30),
          order: g.order === 'random' ? 'random' : 'sequence',
          wallpaperIds: Array.isArray(g.wallpaperIds)
            ? g.wallpaperIds.filter((x) => typeof x === 'string' && x)
            : [],
        }))
    : [];
  return {
    id: typeof o.id === 'string' ? o.id : '',
    scrim: clampNum(o.scrim, 0, 1, 0.25),
    border: clampNum(o.border, 0, 1, 0.35),
    blur: clampNum(o.blur, 0, 60, 16),
    wallpaperBlur: clampNum(o.wallpaperBlur, 0, 60, 0),
    backgroundBrightness: clampNum(o.backgroundBrightness, 40, 160, 100),
    backgroundContrast: clampNum(o.backgroundContrast, 40, 200, 100),
    backgroundSaturate: clampNum(o.backgroundSaturate, 0, 200, 100),
    rotationEnabled: o.rotationEnabled === true,
    rotationGroupId: typeof o.rotationGroupId === 'string' ? o.rotationGroupId : '',
    rotationGroups,
    rotationSeeded: o.rotationSeeded === true,
    hiddenIds: Array.isArray(o.hiddenIds)
      ? o.hiddenIds.filter((x) => typeof x === 'string' && x)
      : [],
    playbackRate: clampNum(o.playbackRate, 0.5, 2, 1),
    fpsCap: FPS_CAP_VALUES.includes(o.fpsCap) ? o.fpsCap : 0,
    betaSceneAnim: o.betaSceneAnim === true,
    sceneGLDegrade: o.sceneGLDegrade !== false,
    pauseOnHidden: o.pauseOnHidden !== false,
    pauseOnBlur: o.pauseOnBlur === true,
    pauseOnBattery: o.pauseOnBattery === true,
    flip: o.flip === true,
    objectFit: clampStr(o.objectFit, OBJECT_FIT_VALUES, 'cover'),
    contentRatingFilter: clampStr(o.contentRatingFilter, RATING_VALUES, 'everyone'),
    typeFilter: clampStr(o.typeFilter, TYPE_VALUES, 'all'),
    pickerLayout: o.pickerLayout === 'classic' ? 'classic' : 'fixed',
    edgeCompat: o.edgeCompat !== false,
    accent: typeof o.accent === 'string' && /^#[0-9a-f]{6}$/i.test(o.accent)
      ? o.accent : '#4f8cff',
    glassAlpha: clampNum(o.glassAlpha, 0, 60, 12),
    glassColor: typeof o.glassColor === 'string' && /^#[0-9a-f]{6}$/i.test(o.glassColor)
      ? o.glassColor : '#ffffff',
    glassWindow: o.glassWindow !== false,
    // dsh-better-sidebar glass knobs (mirror of src/client.js).
    sidebarGlass: o.sidebarGlass !== false,
    sidebarBlur: clampNum(o.sidebarBlur, 0, 200, 16),
    sidebarAlpha: clampNum(o.sidebarAlpha, 0, 200, 120),
    sidebarColor: typeof o.sidebarColor === 'string' && /^#[0-9a-f]{6}$/i.test(o.sidebarColor)
      ? o.sidebarColor : '#ffffff',
    sidebarContentAlpha: clampNum(o.sidebarContentAlpha, 0, 80, 30),
    sidebarContentColor: typeof o.sidebarContentColor === 'string' && /^#[0-9a-f]{6}$/i.test(o.sidebarContentColor)
      ? o.sidebarContentColor : '',
    // Chat-interface mascot pull-cord visibility (mirror of src/client.js).
    ropeShown: o.ropeShown !== false,
    // Mascot form (maid/whale) + scale (0.5–2.5), mirror of src/client.js.
    ropeForm: clampStr(o.ropeForm, ROPE_FORM_VALUES, 'maid'),
    ropeScale: clampNum(o.ropeScale, ROPE_SCALE_MIN, ROPE_SCALE_MAX, 1),
    // "What's new" notice dismissal version (port-independent, mirror of client).
    noticeSeen: typeof o.noticeSeen === 'string' ? o.noticeSeen : '',
    // Custom typography (#57 slim): master switch + color/weight/family.
    // Mirror of src/client.js sanitizeSettings.
    fontCustom: o.fontCustom === true,
    fontColor: typeof o.fontColor === 'string' && /^#[0-9a-f]{6}$/i.test(o.fontColor)
      ? o.fontColor : '#000000',
    fontWeight: clampNum(o.fontWeight, 100, 900, 400),
    fontFamily: FONT_FAMILY_VALUES.includes(o.fontFamily) ? o.fontFamily : 'inherit',
  };
}

// ── Media metadata probe (minimal MP4 box walker) ───────────────────────────
// Reports { width, height, codec, fps } for a local MP4/MOV by reading its moov
// box (faststart files keep it near the head, normal files at the tail).
// Serves two purposes: the picker hint ("源 4K · 120fps · H.264") and the
// 帧率上限 decision — a source at/below the cap skips the transcode entirely.
const MEDIA_INFO_CACHE = new Map();
const VIDEO_CODECS = new Set(['avc1', 'hvc1', 'hev1', 'av01', 'vp09', 'mp4v']);

function readBoxes(buf, start, end, onBox) {
  // H-13: end 再夹一次缓冲上界 — 任何调用点的 container.size 声明值都不允许
  // 把读取带出 buf.length (off+size>buf.length 即停)
  end = Math.min(end, buf.length);
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

// ── MP4 顶层 box 工具 (H-14/P-14) ───────────────────────────────────────────
// scene-manifest.js 的 extractSceneVideoVia 从 ftyp 命中处一路切到 .tex 尾、
// 不按 MP4 box size 截断 (该文件不在本次修复范围), 宿主侧补偿: 按 [u32 size]
// [type] 串走顶层 box, 把 .tex 尾残留裁掉; 写缓存前用 ftyp+moov 判据校验
// (probeMp4 同款判据的内存版, 复用其 box 语义)。
// 返回完整 box 链的末尾偏移; onBox 返回 true 提前停 (此时返回当前 off)。
function mp4TopBoxes(buf, onBox) {
  let off = 0;
  while (off + 8 <= buf.length) {
    let size = buf.readUInt32BE(off);
    let header = 8;
    if (size === 1) {
      if (off + 16 > buf.length) break;
      size = Number(buf.readBigUInt64BE(off + 8));
      header = 16;
    } else if (size === 0) {
      size = buf.length - off; // size=0: box 延伸到数据末尾
    }
    if (size < header || off + size > buf.length) break;
    if (onBox(buf.toString('latin1', off + 4, off + 8), off, size, header)) return off;
    off += size;
  }
  return off;
}

// H-14: 裁掉顶层 box 链之后的所有非 box 残留 (TEX 容器尾、对齐垃圾)。
function trimMp4ByTopBoxes(buf) {
  const end = mp4TopBoxes(buf, () => false);
  return end > 0 && end < buf.length ? buf.subarray(0, end) : buf;
}

// P-14: 缓存写入前的内容校验 — 首个顶层 box 必须是 ftyp, 且存在 moov
// (与 probeMp4 找 moov 的判据一致; ftyp 缺失 = 不是 MP4, moov 缺失 = 不可解)。
function mp4LooksValid(buf) {
  if (!buf || buf.length < 16) return false;
  let sawFirst = false;
  let firstOk = true;
  let hasMoov = false;
  mp4TopBoxes(buf, (type) => {
    if (!sawFirst) {
      sawFirst = true;
      firstOk = type === 'ftyp';
      if (!firstOk) return true;
    }
    if (type === 'moov') { hasMoov = true; return true; }
    return false;
  });
  return sawFirst && firstOk && hasMoov;
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
    // H-13: moov 候选收紧 — 声明尺寸 s 必须 ≥8、≤64MB 且 start+s 完全落在
    // 文件内 (旧实现容忍 +8 越界且不限尺寸: 超大声明会把 moovBuf 分配出来、
    // readSync 在 EOF 停止, 余下是零填充, 后续字段读的是垃圾元数据)。
    const MOOV_MAX_BYTES = 64 * 1024 * 1024;
    const MOOV_BYTES = Buffer.from('moov', 'latin1');
    const findMoov = (buf, bufStart, anchoredToEof, limit) => {
      const scanEnd = Math.min(buf.length - 4, limit || buf.length);
      // P2-17: 逐字节回扫 (每偏移 4 次比较, 8MB tail ~3200 万次) 改
      // Buffer#lastIndexOf 按模式跳查; 命中点校验与旧循环一致, 不合格则从
      // 命中点前一位继续回扫 (lastIndexOf 语义 = 匹配起点 ≤ byteOffset,
      // 链式 i-1 与旧 for 降序枚举等价)。
      if (scanEnd < 4) return null;
      let i = buf.lastIndexOf(MOOV_BYTES, scanEnd);
      while (i >= 4) {
        const s = buf.readUInt32BE(i - 4);
        const start = bufStart + i - 4;
        if (s >= 8 && s <= MOOV_MAX_BYTES && start >= 0 && start + s <= fileSize) {
          if (!anchoredToEof || (start + s >= fileSize - 128)) return { start, size: s };
        }
        i = buf.lastIndexOf(MOOV_BYTES, i - 1);
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
        // H-13: stsd 条目读取同时受 stsd 自身声明尺寸约束 (空壳 box 不越过)
        if (entryStart + 52 <= moovEnd && entryStart + 52 <= stsd.off + stsd.size) {
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
        // H-13: timescale/duration 字段必须落在 mdhd 声明尺寸内 — 声明 8 字节
        // 头的空壳 box 直接按偏移读会吃到相邻 box 的字节 (v1 布局读到 +36)
        const mdhdNeed = ver === 1 ? 36 : 20;
        if (mdhd.off + mdhd.header + mdhdNeed <= mdhd.off + mdhd.size && mdhd.off + mdhd.size <= moovEnd) {
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
              // H-13: stts 表项同时受 stts box 声明尺寸约束
              const sttsEnd = Math.min(moovEnd, stts.off + stts.size);
              let samples = 0, ticks = 0;
              for (let i = 0; i < entryCount; i++) {
                const e = stts.off + stts.header + 8 + i * 8;
                if (e + 8 > sttsEnd) break;
                const cnt = moovBuf.readUInt32BE(e);
                const delta = moovBuf.readUInt32BE(e + 4);
                samples += cnt; ticks += cnt * delta;
              }
              if (ticks > 0) info.fps = Math.round((samples * timescale / ticks) * 100) / 100;
            }
          }
        }
      }
      if (info.codec) { best = info; break; }
    }
    return best && (best.fps || best.width) ? best : null;
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

// P0-4①: 全局渲染并发闸 (与转码闸同型) — scene-frame/scene-anim 每次渲染
// 无条件 new Worker, 多视口/多壁纸并发时 N 个 CPU 光栅化线程一起抢核, 只会
// 互相拖慢。上限 max(1, cpus-2) 给宿主/主线程留余量; 排队不计入渲染超时
// (timer 从 worker 启动起算)。
const RENDER_MAX_CONCURRENT = Math.max(1, cpus().length - 2);
let renderActive = 0;
const renderWaiters = [];
function acquireRenderSlot() {
  if (renderActive < RENDER_MAX_CONCURRENT) {
    renderActive += 1;
    return Promise.resolve();
  }
  return new Promise((resolveSlot) => renderWaiters.push(resolveSlot));
}
function releaseRenderSlot() {
  const next = renderWaiters.shift();
  if (next) next();
  else renderActive -= 1;
}

// P0-4②/N-02: 活跃渲染 worker 注册表 — scene-anim 半边已有各自 AbortController
// cancel 链 (见 _sceneAnimInflight disposer); scene-frame 路径此前无 signal 无
// 注册, 插件卸载/HMR 后 worker 照跑成孤儿。worker 创建时注册, finish/terminate
// 时摘除; 卸载 disposer 遍历 terminate 兜底。
const ACTIVE_SCENE_WORKERS = new Set();

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
  const dirs = [transcodeCacheDir(), ffmpegDataDir()];
  // A plugin HMR/re-apply re-runs this sweep while the SAME process may still be
  // mid-transcode; never delete artifacts owned by the current pid (the ffmpeg
  // child keeps writing to `.tmp<pid>` — removing it would corrupt the job).
  const ownTmpSuffix = '.tmp' + process.pid;
  for (const dir of dirs) {
    let entries = [];
    try { entries = readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      if (name.endsWith(ownTmpSuffix)) continue;
      if (!(/\.tmp\d*$/.test(name) || /\.part\d*$/.test(name)
        || /\.prog$/.test(name) || /^ffmpeg-err-/.test(name))) continue;
      try { unlinkSync(join(dir, name)); } catch { /* ignore */ }
    }
  }
  sweepSceneProgArtifacts();
  // P-10 收窄版 + N-05: 启动时帧缓存按字节预算清扫一次 (挂法同上 — 本函数只在
  // apply() 启动链调用, 运行期由 sf/san/sv2 各落盘点触发 gcFrameCacheSync)。
  gcFrameCacheSync(frameCacheDir());
}

// N-01: frames 目录的 *.prog 孤儿 — 上面的 sweep 只扫 transcode/ffmpeg 目录,
// scene-anim 的 .prog (sceneAnimProgressFile 写在 frames 目录) 残留后进度端点
// 永报旧值, 叠加客户端 1.5s 无守卫轮询 = 无限轮询。删除规则:
//   1. 对应产物 (<key>.apng/.mp4/.webm) 已存在 → 删 (进度端点按产物存在回
//      100, .prog 只会遮蔽真实状态);
//   2. 产物不在且 .prog 已 10 分钟未更新 → 删 (在途渲染每帧都重写它, mtime
//      恒新; HMR 重挂载后同进程的在途任务靠新鲜度幸存, 死任务被清)。
const SCENE_PROG_STALE_MS = 10 * 60 * 1000;
function sweepSceneProgArtifacts() {
  const dir = frameCacheDir();
  let names = [];
  try { names = readdirSync(dir); } catch { return; }
  for (const name of names) {
    if (!/\.prog$/.test(name)) continue;
    const p = join(dir, name);
    try {
      // .prog 名 = <key>.<apng|vid>.prog → 产物候选 <key>.apng/.mp4/.webm
      const stem = name.slice(0, -'.prog'.length).replace(/\.(apng|vid)$/, '');
      const hasArtifact = existsSync(join(dir, stem + '.apng'))
        || existsSync(join(dir, stem + '.mp4'))
        || existsSync(join(dir, stem + '.webm'));
      const stale = Date.now() - statSync(p).mtimeMs > SCENE_PROG_STALE_MS;
      if (hasArtifact || stale) unlinkSync(p);
    } catch { /* ignore */ }
  }
}

// 转码缓存 GC (H-12): tc_*.mp4 只增不减 — 每个新缓存落盘后按总量上限 (默认
// 2GiB, DSH_WE_TRANSCODE_CACHE_MAX_BYTES 可调) 从最旧开始清。永不删刚发布的
// keepPath 与 .tmp* 在途产物; 正在被 serve 的文件在 POSIX 上已打开 fd 照常读
// 完, Windows 上 unlink 失败静默跳过 (下轮再清)。
function sweepTranscodeCache(keepPath) {
  const maxBytes = Number(process.env.DSH_WE_TRANSCODE_CACHE_MAX_BYTES) || 2 * 1024 * 1024 * 1024;
  const dir = ensureTranscodeCacheDir();
  let names = [];
  try { names = readdirSync(dir).filter((n) => /^tc_.*\.mp4$/.test(n)); } catch { return; }
  const statted = [];
  let total = 0;
  for (const n of names) {
    const p = join(dir, n);
    try {
      const st = statSync(p);
      if (!st.isFile()) continue;
      total += st.size;
      if (p !== keepPath) statted.push({ p, m: st.mtimeMs, size: st.size });
    } catch { /* ignore */ }
  }
  statted.sort((a, b) => a.m - b.m); // 最旧在前
  for (const e of statted) {
    if (total <= maxBytes) break;
    try { unlinkSync(e.p); total -= e.size; } catch { /* 在用/权限, 下轮再清 */ }
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
// process group (own hidden console), a pwsh-wrapped launch (pwsh children
// are proven to work in this environment), then a plain direct spawn; (3) keep
// EVERY attempt's error so the final message shows the full picture.
// `timeoutMs` is the per-attempt budget handed down from the JOB deadline
// (runFfmpegTranscode computes it as the remaining time, so all encoder
// attempts share one 15min wall-clock budget instead of 15min each).
// opts.signal (AbortSignal) additionally cancels the running ffmpeg (client
// disconnect / wallpaper switch).
// P2-14 扩展: opts.onStdin(stream) — rawvideo stdin 管道模式。指定后 stdio[0]
// 由 'ignore' 改 'pipe', spawn 成功即回调一次交出 stdin 供调用方逐帧写入。
// 此模式禁用 attempt 重试 (流式帧不可重放, 重试需从头再喂), 失败直接 reject
// (调用方回退非管道路径)。这是对上述 "(1) never use pipes" 的唯一受控例外:
// 仅在管道 spawn 成功时使用, 受限环境 (piped stdio EPERM) 下调用方拿到
// reject → 走既有文件中转路径, 行为不变。
function spawnFfmpeg(ff, args, timeoutMs, opts = {}) {
  const limit = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : TRANSCODE_TIMEOUT_MS;
  const signal = (opts && opts.signal) || null;
  const onStdin = (opts && opts.onStdin) || null; // P2-14: stdin 管道模式
  return new Promise((resolve, reject) => {
    const errLog = join(ensureTranscodeCacheDir(), 'ffmpeg-err-' + process.pid + '-' + Date.now() + '.log');
    const attempts = [
      { name: 'detached', opts: { detached: true, windowsHide: true } },
      { name: 'plain', opts: { windowsHide: true } },
    ];
    if (onStdin) attempts.length = 1; // P2-14: 管道模式不重试 (见上)
    let idx = 0;
    let curProc = null;
    const onAbort = () => {
      if (curProc) { try { curProc.kill(); } catch { /* ignore */ } }
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
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
        // P2-14: onStdin 模式下 stdin 走管道, 其余保持原样 (stderr 仍进临时文件)
        proc = spawn(a.file || ff, a.args || args,
          { ...a.opts, cwd: process.env.SystemRoot || (process.platform === 'win32' ? 'C:\\' : '/'), stdio: errFd ? (onStdin ? ['pipe', 'ignore', errFd] : ['ignore', 'ignore', errFd]) : 'ignore' });
      } catch (err) {
        if (errFd) { try { closeSync(errFd); } catch { /* ignore */ } }
        errors.push(a.name + ' spawn throw ' + (err && err.code ? err.code : err));
        runNext();
        return;
      }
      curProc = proc;
      if (onStdin) {
        // 交出 stdin; 调用方负责 end()/错误吞并 (ffmpeg 早退 → EPIPE 由 exit 收口)
        try { onStdin(proc.stdin); } catch (err) {
          errors.push('onStdin throw ' + String(err && err.message ? err.message : err));
          try { proc.kill(); } catch { /* ignore */ }
        }
      }
      // Track the child so a job deadline (see TRANSCODE_TIMEOUT_MS) can kill it
      // even while it is detached / mid-encode.
      ACTIVE_FFMPEG.add(proc);
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

// P2-14: scene-anim 视频合成的 raw 帧直喂管道 — 渲染 worker 逐帧流出的 RGBA
// 原始字节直接写 ffmpeg stdin (-f rawvideo -pix_fmt rgba), 跳过中间 APNG 的
// 逐帧 deflateSync(level6) 编码 + ffmpeg 端 PNG 解码回 RGBA 两步全多余中转。
// 输出编码参数与旧 APNG 中转路径逐项一致 (编码器/pix_fmt/CRF/movflags 不变),
// 仅输入封装从 "-r fps -i tmp.apng" 改为 rawvideo 管道 — 像素源相同时输出
// 力求一致。管道不可用的受限 spawn 环境 (piped stdio EPERM, 见 spawnFfmpeg
// 注释) 下返回 null, 调用方回退旧 APNG 中转路径, 行为与修复前一致。
function startSceneAnimRawPipe(ff, w, h, fps, fmt, ext, signal) {
  const tmpOut = join(tmpdir(), 'dsh-we-anim-out-' + process.pid + '-' + Date.now() + ext);
  const outArgs = fmt === 'webm'
    ? ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-crf', '32', '-b:v', '0', tmpOut]
    : ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-movflags', '+faststart', tmpOut];
  const vargs = ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', w + 'x' + h,
    '-framerate', String(fps), '-i', '-', ...outArgs];
  let stdin = null;
  let settled = false; // finish 成功后 dispose 变 no-op
  // 写入链: 保持帧序 (FIFO 串行) 并处理背压 (write 返回 false 时等 drain)
  let chain = Promise.resolve();
  // 独立 abort 链: 外部 signal 取消透传给 ffmpeg; dispose 也能单独杀进程
  const pipeCtrl = new AbortController();
  const fwd = () => pipeCtrl.abort();
  if (signal) {
    if (signal.aborted) pipeCtrl.abort();
    else signal.addEventListener('abort', fwd, { once: true });
  }
  const job = spawnFfmpeg(ff, vargs, 0, {
    signal: pipeCtrl.signal,
    onStdin: (s) => {
      stdin = s;
      // ffmpeg 早退/被杀后的 EPIPE 在此吞并 — 失败由 job (exit != 0) 收口
      s.on('error', () => { /* ignore */ });
    },
  });
  return {
    write(chunk) {
      if (!stdin || settled) return;
      chain = chain.then(() => new Promise((res) => {
        if (!stdin || stdin.destroyed || stdin.writableEnded) return res();
        // drain 与 error/close 竞速: ffmpeg 中途死亡时不会再 drain, 不竞速则
        // 写入链悬挂 → finish 永不返回 (失败由 job exit != 0 收口上报)。
        // 触发后摘除未触发监听, 避免背压频繁时 error/close 堆积 (MaxListeners)
        let done = false;
        const cleanup = () => {
          if (done) return;
          done = true;
          stdin.removeListener('drain', cleanup);
          stdin.removeListener('error', cleanup);
          stdin.removeListener('close', cleanup);
          res();
        };
        if (stdin.write(chunk)) cleanup();
        else {
          stdin.once('drain', cleanup);
          stdin.once('error', cleanup);
          stdin.once('close', cleanup);
        }
      }));
    },
    // 收尾: 等已排队帧全部落管 → 关 stdin → 等 ffmpeg exit 0 → 读产物
    async finish() {
      try {
        await chain;
        if (stdin) { try { stdin.end(); } catch { /* ignore */ } }
        await job;
        return readFileSync(tmpOut);
      } finally {
        settled = true;
        if (signal) signal.removeEventListener('abort', fwd);
        try { unlinkSync(tmpOut); } catch { /* ignore */ }
      }
    },
    // 兜底清理 (渲染失败/取消/finish 未达): 杀 ffmpeg + 关管道 + 删临时产物
    dispose() {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', fwd);
      pipeCtrl.abort();
      if (stdin) { try { stdin.destroy(); } catch { /* ignore */ } }
      try { unlinkSync(tmpOut); } catch { /* ignore */ }
      job.catch(() => { /* 已 dispose 的失败不上浮 */ });
    },
  };
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
    '-map', '0:v:0', '-an', '-preset', 'p1',
    '-b:v', String(bitrate), '-maxrate', String(bitrate), '-bufsize', String(bitrate * 2),
    '-vf', 'fps=' + String(fps), '-g', String(fps * 2)];
  // 输出时长限制: 部分源视频容器帧率信息异常 (实测 100k fps/100k tbn),
  // 旧参数 `-r fps` 无法纠正 → ffmpeg 按输入帧率解码并大量复制帧 (5 万帧)
  // 卡死 + 长时间占满 CPU。fps 滤镜做正确 CFR 采样 + -t 限制输出时长。
  if (mi && mi.duration && isFinite(mi.duration) && mi.duration > 0) {
    base.push('-t', String(mi.duration));
  }
  // 整个任务所有编码尝试共享一个 deadline（见 TRANSCODE_TIMEOUT_MS 注释）：
  // 每次 spawn 只拿到剩余预算，避免「每种编码器各 15 分钟」的预算重计。
  const deadline = Date.now() + TRANSCODE_TIMEOUT_MS;
  let lastErr = null;
  for (const enc of ['av1_nvenc', 'h264_nvenc']) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      lastErr = new Error('transcode deadline exceeded (' + TRANSCODE_TIMEOUT_MS + 'ms total)');
      break;
    }
    try {
      // -f mp4 is REQUIRED: the temp output path ends in ".tmp<pid>", which
      // ffmpeg cannot map to a muxer by extension (it exits -22 on that).
      await spawnFfmpeg(ff, [...base, '-c:v', enc, '-f', 'mp4', out], remaining, { signal });
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
  // (旧实现无 res close 取消, 卡死的转码要等 15 分钟硬超时才被杀, 期间占满 CPU)
  const ctrl = new AbortController();
  let waiters = 0;
  const cancel = () => {
    if (ctrl.signal.aborted) return;
    ctrl.abort();
    try { unlinkSync(cachePath + '.tmp' + process.pid); } catch { /* ignore */ }
    TRANSCODE_INFLIGHT.delete(cachePath);
  };
  const p = (async () => {
    const tmp = cachePath + '.tmp' + process.pid;
    const progKey = abs + '|' + fps;
    // 并发闸：排队等待期间 deadline 未启动（deadline 在 runFfmpegTranscode
    // 内、拿到闸之后才开始计时）。
    await acquireTranscodeSlot();
    try {
      await runFfmpegTranscode(abs, tmp, fps, ctrl.signal);
      renameSync(tmp, cachePath);
      sweepTranscodeCache(cachePath); // H-12: 新缓存落盘后按总量上限清最旧
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
 * Scene static-frame cache directory (plugin-managed, under the same data dir
 * as config/uploads). Extracted frames are cached keyed by
 * `<base64url(absPath)>_<mtime>` so a workshop update invalidates the frame.
 * `DSH_WE_CACHE_DIR` overrides the location (tests / power users).
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

// Scene frame 提取的 in-flight 去重：同一缓存键的并发请求共享一次提取
// （scene.pkg 可能几十 MB，读盘 + 解码很贵；客户端列表页会同时请求多帧，
//  同一张帧在滚动刷新时也可能并发命中）。
const SCENE_FRAME_INFLIGHT = new Map();
// P2-11: scene-frame 失败负缓存 — 旧实现失败只摘 inflight, 下次请求全链路重来
// (worker 整段渲染 + 主线程 extractSceneMainImage 回退, 秒级 CPU 浪费在必然
// 失败的 scene 上)。键 = abs+mtime (sf 缓存键) + 渲染参数 w×h+time, 值 = 错误
// 码。TTL 60s 容量 64 (Map 插入序 LRU); mtime 变化 → 键变化自动失效, 成功
// (磁盘缓存命中/渲染成功) 时主动清除。
const SCENE_FRAME_NEG_TTL_MS = 60 * 1000;
const SCENE_FRAME_NEG_MAX = 64;
const sceneFrameNegCache = new Map(); // key → { t, code }
/** Accepted upload MIME → file extension (matches mimeFor above). */
const UPLOAD_EXT = { 'video/mp4': 'mp4', 'image/jpeg': 'jpg', 'image/png': 'png' };
/** Upload size cap: 512 MB (a single wallpaper video). */
const UPLOAD_MAX_BYTES = 512 * 1024 * 1024;
/** Uploaded-file name pattern: `<up-id>.<ext>` (group 1 = id, group 2 = ext). */
const UPLOAD_FILE_RE = /^(up-[a-z0-9-]+)\.(mp4|jpg|jpeg|png)$/i;

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
  if (typeof v === 'string') return { title: v, sha256: null };
  if (v && typeof v === 'object') return {
    title: typeof v.title === 'string' && v.title.trim() ? v.title : id,
    sha256: typeof v.sha256 === 'string' ? v.sha256 : null,
  };
  return { title: id, sha256: null };
}

function setUploadMeta(id, title, sha256) {
  try {
    const m = readUploadMeta();
    m[id] = { title: title || id, sha256: sha256 || null };
    // 原子写（.tmp+rename）：崩溃/断电不留半截 JSON，整份 meta 不会丢失。
    atomicWriteFileSync(uploadMetaPath(), JSON.stringify(m));
  } catch { /* ignore */ }
}

function removeUploadMeta(id) {
  try {
    const m = readUploadMeta();
    if (id in m) { delete m[id]; atomicWriteFileSync(uploadMetaPath(), JSON.stringify(m)); }
  } catch { /* ignore */ }
}

/** Scan the uploads dir → WE-shaped wallpaper entries (no project.json). */
async function enumerateUploadsP(dir) {
  if (!(await pathExistsP(dir))) return [];
  let entries = [];
  try { entries = await readdir(dir); } catch { return []; }
  const out = [];
  for (const entry of entries) {
    const abs = join(dir, entry);
    let st; try { st = await stat(abs); } catch { continue; }
    if (!st.isFile()) continue;
    const m = UPLOAD_FILE_RE.exec(entry);
    if (!m) continue;
    const ext = m[2].toLowerCase();
    const id = m[1];
    const type = ext === 'mp4' ? 'video' : 'image';
    out.push({ id, type, fileAbs: abs, previewAbs: type === 'image' ? abs : null });
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

// ── Loose wallpaper source (Linux default: ~/Pictures/WallpaperEngine) ─────
// WE is Windows-only; a native Linux host has no Steam/WE install to scan, so
// this read-only source surfaces wallpapers from a directory (Linux default:
// $HOME/Pictures/WallpaperEngine): plain image/video files directly, and WE
// scene-project folders (project.json + scene.pkg/scene.json + preview.jpg)
// as full scene wallpapers through the exact same /media + /preview +
// /scene-frame + /scene-video token pipeline used by installed WE wallpapers.
// Point it anywhere with DSH_WE_LOOSE_DIR (comma/semicolon-separated, `~`
// allowed) on any platform. Unlike uploads this source is strictly read-only:
// nothing is written there, nothing is removable via the UI, and ids use the
// "ls-" prefix so the client's upload manager (which keys on "up-") never
// treats them as managed uploads (no remove button / no source-file deletion).
const LOOSE_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.apng']);
const LOOSE_VIDEO_EXT = new Set(['.mp4', '.webm', '.mkv', '.avi', '.mov']);
const LOOSE_MAX_DEPTH = 4;       // bounded recursion into subfolders
const LOOSE_MAX_ENTRIES = 3000;  // soft cap: keep the inventory sane on huge trees

function resolveLooseDirs() {
  const raw = process.env.DSH_WE_LOOSE_DIR && process.env.DSH_WE_LOOSE_DIR.trim();
  const dirs = [];
  if (raw) {
    for (const s of raw.split(/[,;]/)) {
      const t = s.trim();
      if (!t) continue;
      if (t === '~') dirs.push(homedir());
      else if (t.startsWith('~/')) dirs.push(join(homedir(), t.slice(2)));
      else dirs.push(t);
    }
  } else if (process.platform === 'linux') {
    // Native Linux has no WE install; ~/Pictures/WallpaperEngine is the natural
    // drop-off for workshop scene folders and loose wallpapers.
    dirs.push(join(homedir(), 'Pictures', 'WallpaperEngine'));
  }
  return dirs.map(normalize);
}

/**
 * Probe a directory for a loose WE scene project — a workshop folder dropped
 * into the loose source (project.json + scene.pkg/scene.json + preview.jpg).
 * Returns a scene wallpaper descriptor, or null when the directory is not one.
 * The whole folder counts as ONE wallpaper; its internals (textures, preview,
 * shaders) are not enumerated separately.
 */
async function probeLooseSceneP(dir) {
  const proj = await readProjectP(dir);
  if (!proj || proj.type !== 'scene') return null;
  const mainFile = await resolveSceneMainFileP(dir, proj.file);
  if (!mainFile) return null;
  let previewAbs = null;
  if (proj.preview && (await isFileP(resolve(dir, proj.preview)))) {
    previewAbs = resolve(dir, proj.preview);
  }
  return {
    id: 'ls-' + createHash('sha256').update(dir, 'utf8').digest('hex').slice(0, 12),
    type: 'scene',
    title: proj.title,
    contentrating: proj.contentrating,
    fileAbs: join(dir, mainFile),
    previewAbs,
  };
}

async function enumerateLooseP(dirs, maxDepth = LOOSE_MAX_DEPTH) {
  const out = [];
  let budget = LOOSE_MAX_ENTRIES;
  const visit = async (dir, depth) => {
    if (depth > maxDepth || budget <= 0) return;
    let entries = [];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (budget <= 0) return;
      const name = entry.name;
      if (name.startsWith('.')) continue; // dotfiles / hidden dirs
      const abs = join(dir, name);
      if (entry.isDirectory()) {
        if (entry.isSymbolicLink()) continue;
        // A loose WE scene project folder counts as ONE wallpaper (whole dir);
        // its internals (textures/preview/shaders) are not enumerated apart.
        const proj = await probeLooseSceneP(abs);
        if (proj) {
          out.push(proj);
          budget--;
          continue;
        }
        await visit(abs, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = extname(name).toLowerCase();
      const type = LOOSE_VIDEO_EXT.has(ext) ? 'video' : LOOSE_IMAGE_EXT.has(ext) ? 'image' : null;
      if (!type) continue;
      // Deterministic id from the absolute path: stable across restarts and
      // distinct from WE ("folder name") and upload ("up-") ids.
      const id = 'ls-' + createHash('sha256').update(abs, 'utf8').digest('hex').slice(0, 12);
      out.push({ id, type, fileAbs: abs, previewAbs: type === 'image' ? abs : null });
      budget--;
    }
  };
  for (const dir of dirs) {
    if (!(await pathExistsP(dir))) continue;
    await visit(dir, 0);
  }
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

  // Startup sweep: a previous host process may have died mid-transcode or
  // mid-download (the detached ffmpeg child keeps writing after its parent is
  // killed by a restart/HMR), orphaning .tmp outputs, .prog progress files,
  // .part downloads and ffmpeg-err logs. Nothing of THIS process can be
  // mid-flight at startup, so all stale artifacts are removed in one pass.
  sweepTranscodeArtifacts();

  // Token → absolute path map. Tokens are base64url of the abs path, so the
  // route never exposes an arbitrary filesystem string the client could not
  // otherwise obtain from the inventory.
  const mediaMap = new Map();
  const tokenFor = (absPath) => {
    const token = Buffer.from(absPath, 'utf8').toString('base64url');
    mediaMap.set(token, absPath);
    return token;
  };

  // Build the inventory (async scan chain — fs.promises, event-loop friendly).
  // The browser half refetches live each load, so freshness semantics are
  // unchanged; only the blocking behavior is gone.
  //
  // 短 TTL 缓存（3s）：客户端每次切壁纸/刷新面板都会重新拉 inventory，而
  // 全量扫描（locate + readdir + 每个壁纸的存在性探测）在慢盘上要几百 ms
  // 到几秒。TTL 内直接返回缓存，对用户的感知延迟上限仍是 3 秒。
  const INVENTORY_TTL_MS = 3000;
  let inventoryCache = null; // { t, payload }
  // P2-19: in-flight 单飞（steamProbeInflight 同款）— TTL 过期瞬间的并发请求
  // （面板刷新 + 切壁纸 + 客户端加载扇出）此前各自跑一遍全量扫描（locate +
  // readdir + 每壁纸存在性探测），共享同一次构建；失败不进缓存（允许重试）。
  let inventoryInflight = null;
  async function buildInventory() {
    if (inventoryCache && Date.now() - inventoryCache.t < INVENTORY_TTL_MS) {
      return inventoryCache.payload;
    }
    if (inventoryInflight) return inventoryInflight;
    inventoryInflight = buildInventoryScan();
    try {
      const payload = await inventoryInflight;
      inventoryCache = { t: Date.now(), payload };
      return payload;
    } finally {
      inventoryInflight = null;
    }
  }
  async function buildInventoryScan() {
    const installDir = await locateWallpaperEngineP();
    const libraryDirs = await owningLibrariesP();
    const all = await enumerateWallpapersAsync(installDir, libraryDirs);
    const byPath = new Map(all.map((w) => [pathKey(w.fileAbs), w.id]));
    const byId = new Map(all.map((w) => [w.id, w]));
    const wallpapers = await Promise.all(all.map(async (w) => {
      // 三次存在性探测并发（原本串行，慢盘上是 3× 延迟）。
      const [hasMedia, hasPreview, hasFrame] = await Promise.all([
        w.type === 'video' || w.type === 'web' ? pathExistsP(w.fileAbs) : Promise.resolve(false),
        w.previewAbs ? pathExistsP(w.previewAbs) : Promise.resolve(false),
        // Scenes: fileAbs points at the resolved scene main file (scene.pkg /
        // scene.json); frameUrl serves its extracted static frame.
        w.type === 'scene' && w.fileAbs ? pathExistsP(w.fileAbs) : Promise.resolve(false),
      ]);
      return {
        id: w.id,
        title: w.title,
        type: w.type,
        contentrating: w.contentrating,
        playable: hasMedia,
        media: hasMedia ? `${BASE}/media/${tokenFor(w.fileAbs)}` : null,
        preview: hasPreview ? `${BASE}/preview/${tokenFor(w.previewAbs)}` : null,
        frameUrl: hasFrame ? `${BASE}/scene-frame/${tokenFor(w.fileAbs)}` : null,
        // Live WebGL scene player entry. We serve it whenever the scene's main
        // file is present; the client falls back to frameUrl/preview if the
        // manifest cannot be built or the iframe fails.
        sceneUrl: w.type === 'scene' && hasFrame ? `${BASE}/scene-runtime/${tokenFor(w.fileAbs)}` : null,
        // Scene animation exposed as a playable MP4 (extracted from the scene
        // package). The client prefers this <video> path: it is hardware-decoded
        // and smooth, unlike a live WebGL iframe (which can spin up multiple
        // contexts and freeze the page). 404 → client falls back to frameUrl.
        sceneVideo: w.type === 'scene' && hasFrame ? `${BASE}/scene-video/${tokenFor(w.fileAbs)}` : null,
      };
    }));
    // Custom uploads: scanned fresh each request (read-A storage), appended
    // AFTER the WE wallpapers. Images serve themselves as preview; videos get
    // the client-side "无预览" placeholder.
    const uploadsDir = ensureUploadDir();
    const uploadMeta = readUploadMeta();
    const uploads = (await enumerateUploadsP(uploadsDir)).map((w) => ({
      id: w.id,
      title: metaEntry(uploadMeta, w.id).title || w.id,
      type: w.type,
      playable: true,
      media: `${BASE}/media/${tokenFor(w.fileAbs)}`,
      preview: w.previewAbs ? `${BASE}/preview/${tokenFor(w.previewAbs)}` : null,
    }));
    wallpapers.push(...uploads);
    // Loose wallpaper source (read-only): Linux defaults to
    // ~/Pictures/WallpaperEngine. Images/videos use the media/preview pipeline;
    // WE scene-project folders become full scene entries with the same
    // frameUrl/sceneUrl/sceneVideo surface as installed WE scenes. "ls-" ids
    // keep them out of the upload manager (which keys on the "up-" prefix).
    const looseDirs = resolveLooseDirs();
    const loose = (await enumerateLooseP(looseDirs)).map((w) => {
      const base = {
        id: w.id,
        title: w.title || basename(w.fileAbs),
        contentrating: w.contentrating || null,
        preview: w.previewAbs ? `${BASE}/preview/${tokenFor(w.previewAbs)}` : null,
      };
      if (w.type === 'scene') {
        return {
          ...base,
          type: 'scene',
          playable: false,
          media: null,
          frameUrl: `${BASE}/scene-frame/${tokenFor(w.fileAbs)}`,
          sceneUrl: `${BASE}/scene-runtime/${tokenFor(w.fileAbs)}`,
          sceneVideo: `${BASE}/scene-video/${tokenFor(w.fileAbs)}`,
        };
      }
      return {
        ...base,
        type: w.type,
        playable: true,
        media: `${BASE}/media/${tokenFor(w.fileAbs)}`,
      };
    });
    wallpapers.push(...loose);
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
    const payload = {
      installDir,
      uploadDir: UPLOAD_DIR,
      looseDir: looseDirs[0] || null,
      total: wallpapers.length,
      portableCount: wallpapers.filter((w) => w.playable).length,
      wallpapers,
      playlists,
    };
    return payload; // P2-19: 缓存写入移至 buildInventory 单飞包装层
  }

  const disposers = [];

  // 1. Inventory JSON.
  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/inventory`,
    handler: async (req, res) => {
      try {
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
  function trackStream(stream, res) {
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
    return stream;
  }

  // headOnly: HEAD 请求返回与 GET 完全相同的头，但不开流、无 body。
  function serveFile(absPath, req, res, headOnly) {
    if (!absPath || !existsSync(absPath)) {
      res.statusCode = 404; res.end('not found'); return;
    }
    const st = statSync(absPath);
    res.setHeader('Content-Type', mimeFor(absPath));
    res.setHeader('Accept-Ranges', 'bytes');
    const range = req.headers.range;
    if (range) {
      // 显式三分支：bytes=A-B / bytes=A- / bytes=-S（suffix）。
      // 旧实现把 bytes=-500 错解为从 0 起的前 501 字节而非末尾 500 字节。
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
      trackStream(createReadStream(absPath, { start, end }), res);
      return;
    }
    res.setHeader('Content-Length', String(st.size));
    if (headOnly) { res.end(); return; }
    trackStream(createReadStream(absPath), res);
  }

  // Media metadata (source resolution / codec / fps) — the picker hint and the
  // 帧率上限 skip-decision.
  // ⚠ 顺序耦合 (H-11): 本路由必须保持在下方 for(['media','preview']) 循环注册
  // /media 前缀路由 **之前** — "/media-info/..." 同样命中 "/media" 前缀匹配器,
  // 一旦顺序颠倒, /media-info 请求会被 /media handler 当作 token "info/…"
  // 解码 → 404。webServer 前缀匹配按注册顺序先到先得, 移动本块前必读此注。
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
    // ⚠ /media 是前缀路由, 会吞掉同前缀的 /media-info — 那条路由必须保持在本
    // 循环之前注册 (见上方 H-11 顺序耦合说明), 本块不可上移。
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
        serveFile(mediaMap.get(token), req, res, method === 'HEAD');
      },
    }));
  }

  // Scene static frame: extract the scene's main texture as a static image
  // (JPEG passthrough for WE's embedded-JPEG textures, PNG for raw-compressed
  // textures), cached under the plugin data dir keyed by abs-path + mtime.
  // Scenes are read in-place from the user's own library — nothing is copied,
  // uploaded or redistributed.
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/scene-frame`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET') {
        res.statusCode = 405; res.end('method not allowed'); return;
      }
      const pathname = new URL(req.url || '/', 'http://x').pathname;
      const token = decodeURIComponent(pathname.slice(`${BASE}/scene-frame/`.length));
      const abs = mediaMap.get(token);
      if (!abs) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'unknown-token' }));
        return;
      }
      // P2-11: 负缓存键 (下方 async 体内赋值; 失败收口的 .catch 在 async 作用域
      // 之外, 需在此层声明才能写入失败条目)。
      let negKey = null;
      (async () => {
        // Cache key version: bump when the extraction pipeline changes so
        // frames produced by older (buggy) logic are re-extracted instead of
        // served stale from disk. sf34 = 0.6.8 发布包漏装 scene-script-apis.js
        // 期间 SceneRenderer 全线崩溃、scene-frame 回退 extractSceneMainImage
        // 产出多对象场景图层错乱坏帧 —— bump 使坏缓存一次性失效重渲染。
        // (sf33 = 静态帧效果全分辨率 (不降采样) + 渲染尺寸按场景 ortho。)
        // sf35 = shake 2π 平滑数学 + UV→像素单位 + mask header/mip0 比 — shake/
        // foliagesway/waterwaves 输出全部变化, 旧静态帧/动画缓存需失效重渲。
        // P-12: mtime 失效键改走 sceneCacheStamp — 全精度 mtimeMs (Math.round
        // 抹平亚秒更新) + 松散场景纳入目录内引用文件的 mtime。
        // W0: runScripts 入键 (同 sceneAnimCachePath 注释) — 脚本开/关帧不同
        const rsSuffix = (() => { try { return readSettings()?.enableSceneScripts === true ? '_rs1' : ''; } catch { return ''; } })();
        const key = 'sf35_' + Buffer.from(abs, 'utf8').toString('base64url') + '_' + sceneCacheStamp(abs) + rsSuffix;
        const dir = ensureFrameCacheDir();
        const pngPath = join(dir, key + '.png');
        const jpgPath = join(dir, key + '.jpg');
        let servePath = existsSync(pngPath) ? pngPath : existsSync(jpgPath) ? jpgPath : null;
        // P2-11: 渲染参数 (宽 3840, 高按场景 ortho, time=2.5) 提升到路由层 —
        // 下方 inflight 与负缓存键共用同源取值。
        let fw = 3840, fh = 2160;
        const sar = sceneAspect(abs);
        if (sar) fh = Math.round(3840 / sar);
        // P2-11: 失败负缓存命中 → 直接回缓存错误码, 不再 spawn worker、也不走
        // 主线程 extractSceneMainImage 回退 (键含 sceneCacheStamp, mtime/内容
        // 变化自动换键失效; TTL 内失败结论视为仍成立)。
        negKey = key + '|' + fw + 'x' + fh + '@2.5';
        const neg = servePath ? null : sceneFrameNegCache.get(negKey);
        if (servePath) {
          sceneFrameNegCache.delete(negKey); // 磁盘缓存命中 = 成功, 主动失效
        } else if (neg && Date.now() - neg.t < SCENE_FRAME_NEG_TTL_MS) {
          sceneFrameNegCache.delete(negKey); // 重插 Map 尾部, 刷新 LRU 最近使用序
          sceneFrameNegCache.set(negKey, neg);
          res.statusCode = 422;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: neg.code }));
          return;
        }
        if (!servePath) {
          // in-flight 去重：同一 key 的并发请求共享一次提取 + 一次缓存写入。
          let inflight = SCENE_FRAME_INFLIGHT.get(key);
          if (!inflight) {
            // N-02: 渲染取消信号 — 旧路径不传 signal, 客户端断开 (切壁纸/刷新)
            // 后 worker 照跑到完。全部等待者断开时 abort (最后一个关门才杀,
            // 并发共享 inflight 的其他请求不受单个断开影响); onAbort 机制
            // renderSceneFrameInWorker 内现成。
            const ctrl = new AbortController();
            inflight = (async () => {
              const { extractSceneMainImage, extractSceneMainImageFromDir } = await import('./pkg-extract.js');
              // 完整场景渲染 (SceneRenderer) 优先: 在 worker 线程输出 3840×2160
              // 全场景帧 (背景+模型+粒子+shader效果), 不阻塞主进程; 失败时回退
              // 旧的主纹理提取.
              try {
                // 松散 scene.json 项目传目录, scene.pkg 传文件
                const src = abs.toLowerCase().endsWith('.json') ? dirname(abs) : abs;
                // 渲染尺寸 fw/fh 已提升到路由层 (负缓存键同源): 宽 3840, 高按
                // 场景 ortho 宽高比 (非 16:9 壁纸如 3582367840 ortho 2880×1800
                // 固定 3840×2160 会垂直裁切, 高随场景比例)。
                const result = await renderSceneFrameInWorker(src, fw, fh, 2.5, { signal: ctrl.signal });
                if (!result.ok) throw new Error(result.error);
                // 空帧门禁: 渲染器"成功"输出空白/纯色帧时视为失败, 走回退链。
                // P-15 复核: 阈值 0.05%→0.1% — 实测 7 张场景壁纸 (§9.5) 中 6 张
                // 有内容的 diff 比例 86.6%~99.6%, 3113554287 恰为 0% (真空白,
                // 按设计拦截), 无一落在 0.05%~0.1% 区间 → 放宽为深色合法场景
                // 留余量; 与 worker 多帧门禁 (BLANK_DIFF_RATIO) 保持同值。
                if (result.diff < result.checked * 0.001) throw new Error('blank frame (renderer)');
                // 契约 C1 (H-01 最小侵入落地): CPU 渲染的降级清单上浮到宿主日志
                // — 残缺帧仍按现有链路服务, 但不再"无声" (完整 UI 提示链是 Wave 3)
                if (result.degraded && result.degraded.length) {
                  try { (ctx.logger && ctx.logger.warn || (() => {}))('[wallpaper-engine] scene-frame degraded: ' + JSON.stringify(result.degraded)); } catch { /* ignore */ }
                }
                // 异步原子发布（.tmp+rename）：写入中途崩溃不留半截缓存文件。
                await atomicWriteFileP(pngPath, result.png);
                // P-10/N-05: 四类前缀字节预算 LRU (keepPath = 刚写入的本帧)
                gcFrameCacheSync(dir, pngPath);
                return pngPath;
              } catch (e) {
                // 渲染失败(非 scene.pkg 结构/缺资源等) → 回退主纹理静态帧
                // N-02: 取消 (等待者全部断开) 不是失败 — 不再走主线程回退链
                // 白读整包, 直接向上抛由 422 收尾。
                if (ctrl.signal.aborted) throw new Error('cancelled');
                try { unlinkSync(pngPath); } catch { /* ignore */ }
              }
              // 异步读盘：scene.pkg 可达几十 MB，readFileSync 会阻塞事件循环。
              const frame = abs.toLowerCase().endsWith('.json')
                ? extractSceneMainImageFromDir(dirname(abs))
                : extractSceneMainImage(new Uint8Array(await readFile(abs)));
              const target = frame.mime === 'image/jpeg' ? jpgPath : pngPath;
              await atomicWriteFileP(target, frame.bytes);
              return target;
            })();
            SCENE_FRAME_INFLIGHT.set(key, inflight);
            // 无论成败都摘除（失败允许后续请求重试）。
            inflight.then(
              // P2-11: 渲染成功 → 负缓存条目主动失效
              () => { SCENE_FRAME_INFLIGHT.delete(key); sceneFrameNegCache.delete(negKey); },
              () => SCENE_FRAME_INFLIGHT.delete(key),
            );
            inflight.ctrl = ctrl; // N-02: 挂在 inflight 上, 等待者断开时按计数 abort
            inflight.waiters = 0;
          }
          inflight.waiters++;
          // N-02: 本请求断开 → 等待者 -1; 归零 (再无人要这帧) 才取消渲染,
          // 与 scene-anim 的 waiters 计数同思路。detach 幂等防 close+完成双触发。
          let frameDetached = false;
          const frameDetach = (allowAbort) => {
            if (frameDetached) return;
            frameDetached = true;
            inflight.waiters--;
            if (allowAbort && inflight.waiters <= 0) {
              try { inflight.ctrl.abort(); } catch { /* ignore */ }
            }
          };
          req.once('close', () => frameDetach(true));
          try {
            servePath = await inflight;
          } finally {
            frameDetach(false); // 拿到结果/抛错后本请求不再计入等待者, 不触发 abort
          }
        }
        res.setHeader('Content-Type', servePath.endsWith('.jpg') ? 'image/jpeg' : 'image/png');
        res.setHeader('Cache-Control', 'no-store');
        trackStream(createReadStream(servePath), res);
      })().catch((err) => {
        const code = String(err && err.message ? err.message : err);
        // P2-11: 失败写入负缓存 (TTL 60s 内后续请求直接回错误码)。'cancelled'
        // 除外 — 那是等待者全部断开的主动取消, 不是渲染失败, 不能污染缓存;
        // negKey 为 null = 早期失败 (键未建), 同样跳过。
        if (negKey && code !== 'cancelled') {
          sceneFrameNegCache.delete(negKey); // 先删再插 = 移到 Map 尾部
          sceneFrameNegCache.set(negKey, { t: Date.now(), code });
          if (sceneFrameNegCache.size > SCENE_FRAME_NEG_MAX) {
            sceneFrameNegCache.delete(sceneFrameNegCache.keys().next().value); // 淘汰最旧
          }
        }
        res.statusCode = 422;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: code }));
      });
    },
  }));

  // 3b. Scene 动画帧 (APNG): /scene-anim/<token>?fps=..&sec=.. — 多帧渲染成
  //     动画 (粒子/相机路径/效果动画可评判)。静态帧缓存不适用, 每次渲染。
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/scene-anim`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET') {
        res.statusCode = 405; res.end('method not allowed'); return;
      }
      const url = new URL(req.url || '/', 'http://x');
      const token = decodeURIComponent(url.pathname.slice(`${BASE}/scene-anim/`.length));
      const abs = mediaMap.get(token);
      if (!abs) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'unknown-token' }));
        return;
      }
      // beta 场景动画开关: 未开启时拒绝渲染 (客户端 queueSceneAnimUpgrade 也有
      // 同 gate; 服务端双保险 — 防止旧客户端/直接请求触发 CPU 动画渲染)
      const st = readSettings();
      if (!st || st.betaSceneAnim !== true) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'beta-scene-anim-disabled' }));
        return;
      }
      // 参数: fps (默认 12), sec (默认 2 秒), 分辨率上限 1920×1080
      // (CPU 渲染昂贵; 客户端按屏幕/dpr 传 w/h — 提高分辨率避免动画放大模糊)
      const fps = clampNum(Number(url.searchParams.get('fps')) || 0, 2, 30, 12);
      const sec = clampNum(Number(url.searchParams.get('sec')) || 0, 0.5, 6, 2);
      let w = clampNum(Number(url.searchParams.get('w')) || 0, 320, 1920, 960);
      let h = clampNum(Number(url.searchParams.get('h')) || 0, 180, 1080, 540);
      // 按场景 ortho 宽高比修正 (客户端视口比例 ≠ 场景 → 垂直裁切; 官方固定场景比例)
      const sar = sceneAspect(abs);
      if (sar) {
        const viewAR = w / h;
        if (Math.abs(sar - viewAR) > 0.02) {
          const nh = Math.round(w / sar);
          if (nh >= 180 && nh <= 1080) h = nh;
          else if (nh < 180) { h = 180; w = Math.round(h * sar); }
          else { h = 1080; w = Math.round(h * sar); }
        }
      }
      // P0-4④: 尺寸档位量化 (960/1280/1920) — 渲染与 cache key 都按档位,
      // 相邻视口尺寸共享同一段渲染; 进度端点用同一函数量化保证键一致。
      const qz = quantizeSceneAnimSize(abs, w, h);
      w = qz.w; h = qz.h;
      // 输出格式: 默认 APNG; ?fmt=mp4|webm → 渲染 APNG 后 ffmpeg 合成视频
      // (video 元素获得播放/暂停/倍速/进度等控制 — scene 动画与视频壁纸同款)
      const fmt = String(url.searchParams.get('fmt') || '').toLowerCase();
      const isVideo = fmt === 'mp4' || fmt === 'webm';
      const ext = isVideo ? (fmt === 'webm' ? '.webm' : '.mp4') : '.apng';
      const mime = isVideo ? (fmt === 'webm' ? 'video/webm' : 'video/mp4') : 'image/apng';
      const cachePath = sceneAnimCachePath(abs, fps, sec, w, h, ext);
      if (existsSync(cachePath)) {
        // 用 serveFile (带 Range/206): video 播放 MP4 必须支持 Range seek —
        // 旧 trackStream 完整 200 无 Accept-Ranges → 浏览器 video 黑屏。
        res.setHeader('Cache-Control', 'no-store');
        serveFile(cachePath, req, res);
        return;
      }
      let entry = _sceneAnimInflight.get(cachePath);
      if (!entry) {
        // 取消信号: 所有等待者断开 (切换壁纸) 时终止渲染 — kill worker 线程与
        // ffmpeg 子进程, 释放 CPU; 同时删除进度文件避免残留 (进度条跳变源之一)。
        const ctrl = new AbortController();
        let waiters = 0;
        // P2-14: ffmpeg rawvideo 管道句柄 (仅 fmt=mp4/webm; 下方 IIFE 内赋值,
        // 成功路径 finish() 后 dispose 幂等 no-op, 失败/取消兜底杀进程)
        let vid = null;
        const cancel = () => {
          if (ctrl.signal.aborted) return;
          ctrl.abort();
          try { unlinkSync(sceneAnimProgressFile(cachePath, ext)); } catch { /* ignore */ }
          _sceneAnimInflight.delete(cachePath);
        };
        const pending = (async () => {
          // 时间采样: 覆盖 相机路径周期 + 对象属性动画总时长 (否则动画被截断
          // 只播开头一段 — 大部分壁纸"运动方式错"的根因) + 粒子 starttime 后
          const src = abs.toLowerCase().endsWith('.json') ? dirname(abs) : abs;
          let period = 0, starttime = 0, animDuration = 0;
          try {
            const { SceneRenderer: SR } = await import('./scene-renderer.js');
            const r = new SR(src, { width: w, height: h, time: 0, weAssetsDir: _weInstallDirCache || undefined, log: () => {} });
            // 相机路径总周期: 各 path duration 之和
            const cam = r.scene.camera || {};
            const paths = Array.isArray(cam.paths) ? cam.paths : [];
            for (const p of paths) {
              if (typeof p === 'string') {
                try { const j = r.pkg.readJson(p); if (j && Array.isArray(j.paths)) for (const pp of j.paths) period += (pp.duration || 0); } catch {}
              } else if (p && Array.isArray(p.transforms)) {
                period += (p.duration || 0);
              }
            }
            // 属性动画总时长 (length/fps): 全部对象 (含 camera:"default" 相机对象)
            // {animation}.options.length 关键帧数 → 时长 = length / fps
            const ANIM_KEYS = ['alpha', 'scale', 'origin', 'angles', 'visible', 'color', 'size', 'brightness', 'parallaxDepth', 'zoom'];
            for (const o of r.objects || []) {
              if (o.particle && typeof o.particle === 'string') {
                try {
                  const pd = r.pkg.readJson(o.particle);
                  if (pd && pd.starttime) starttime = Math.max(starttime, pd.starttime);
                } catch {}
              }
              for (const key of ANIM_KEYS) {
                const v = o[key];
                if (!v || typeof v !== 'object' || !v.animation || !v.animation.options) continue;
                const len = v.animation.options.length || 0;
                const afps = v.animation.options.fps || 30;
                if (len > 0) animDuration = Math.max(animDuration, len / afps);
              }
            }
          } catch { /* 保持 0 */ }
          if (ctrl.signal.aborted) throw new Error('cancelled');
          // 采样起点 = 0: 动画/相机从场景开始播放 (旧实现 t0=粒子 starttime 会
          // 跳过动画开头段 — 入场运镜等运动方式丢失)。loop 覆盖 相机周期/属性
          // 动画/粒子 starttime (确保粒子可见) 至少 sec 秒。
          const t0 = 0;
          const loop = Math.max(period, animDuration, starttime, 2);
          // 视频时长 = 至少覆盖完整动画周期 (loop): 旧实现按 sec 算帧数但采样
          // 覆盖 loop — 动画周期 > sec 时视频内快放 (Mutsumi 5s 动画在 2s 视频
          // 里 2.5 倍速) — "运动方式/速度"普遍错的主因。
          // P-06: 总时长上界 60s — loop 由场景相机路径/属性动画长度决定、无界
          // (曾见 300s 相机路径 → 30fps×300s=9000 帧 → GB 级内存/缓存); 超界时
          // 采样点仍均匀铺满 loop 周期, 只是时间上被压进 60s 的视频里。
          const videoSec = Math.min(Math.max(sec, loop), 60);
          const frameCount = Math.max(2, Math.round(fps * videoSec));
          if (entry) entry.frames = frameCount; // P1-4: 失败日志要带帧数 (entry 此时已赋值)
          const times = [];
          for (let i = 0; i < frameCount; i++) times.push(t0 + (i / frameCount) * loop);
          const progFile = sceneAnimProgressFile(cachePath, ext);
          try { writeFileSync(progFile, '0/' + frameCount); } catch { /* 进度文件写失败不影响 */ }
          // P2-14: 视频格式先备好 ffmpeg rawvideo stdin 管道 — 渲染帧逐个直喂
          // ffmpeg, 跳过中间 APNG (每帧 deflateSync level6 编码 + ffmpeg 端 PNG
          // 解码回 RGBA) 全多余中转。管道不可用 (受限 spawn 环境 piped stdio
          // EPERM, 见 spawnFfmpeg 注释) 时 vid=null → 渲染走原 APNG 路径、下方
          // 回退旧 APNG 中转合成, 行为与修复前一致。
          if (isVideo) {
            try {
              const ff = await resolveFfmpeg(null);
              vid = startSceneAnimRawPipe(ff, w, h, fps, fmt, ext, ctrl.signal);
            } catch { vid = null; /* 回退 APNG 中转 */ }
          }
          const result = await renderSceneFrameInWorker(src, w, h, 0, {
            times,
            frameDelayMs: Math.round(1000 / fps),
            signal: ctrl.signal,
            rawVideo: !!vid, // P2-14: raw 帧模式 — worker 逐帧直传 RGBA, 不做 APNG/deflate
            onFrame: vid ? (buf) => vid.write(buf) : undefined,
            onProgress: (done, total) => {
              if (ctrl.signal.aborted) return; // 取消后不再写进度文件
              try { writeFileSync(progFile, done + '/' + total); } catch { /* ignore */ }
            },
          });
          try { unlinkSync(progFile); } catch { /* ignore */ }
          if (!result.ok) throw new Error(result.error);
          if (ctrl.signal.aborted) throw new Error('cancelled');
          // 契约 C1 (H-01 最小侵入落地): CPU 渲染的降级清单上浮到宿主日志
          // (与 /scene-frame 同款; 完整 UI 提示链是 Wave 3)
          if (result.degraded && result.degraded.length) {
            try { (ctx.logger && ctx.logger.warn || (() => {}))('[wallpaper-engine] scene-anim degraded: ' + JSON.stringify(result.degraded)); } catch { /* ignore */ }
          }
          let outBuf;
          if (vid && result.raw) {
            // P2-14: raw 管道收尾 — 帧已流式写入 ffmpeg stdin, 等 exit 0 取产物
            outBuf = await vid.finish();
          } else if (isVideo) {
            // APNG → 视频 (ffmpeg 合成): 获得 video 元素的播放/暂停/倍速/进度能力。
            // 输入必须显式 -r <fps>: ffmpeg 6.0 的 APNG 解复用器在大尺寸/大文件
            // (如 1080p 24 帧 ~70MB) 上会把流帧率误估成 100k fps, 导致每帧被复制
            // 数千次 (dup=15000+), 编码永久跑不完 (进度卡在 mux 阶段)。小 APNG
            // (如 320×180) 不受影响, 故此前未暴露。
            // P2-14 后本块仅为 raw 管道不可用环境的回退路径。
            const tmpApng = join(tmpdir(), 'dsh-we-anim-' + process.pid + '-' + Date.now() + '.apng');
            const tmpOut = join(tmpdir(), 'dsh-we-anim-out-' + process.pid + '-' + Date.now() + ext);
            try {
              writeFileSync(tmpApng, result.apng);
              const ff = await resolveFfmpeg(null);
              const vargs = fmt === 'webm'
                ? ['-r', String(fps), '-i', tmpApng, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-crf', '32', '-b:v', '0', tmpOut]
                : ['-r', String(fps), '-i', tmpApng, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-movflags', '+faststart', tmpOut];
              await spawnFfmpeg(ff, vargs, 0, { signal: ctrl.signal });
              if (ctrl.signal.aborted) throw new Error('cancelled');
              outBuf = readFileSync(tmpOut);
            } finally {
              try { unlinkSync(tmpApng); } catch { /* ignore */ }
              try { unlinkSync(tmpOut); } catch { /* ignore */ }
            }
          } else {
            outBuf = result.apng;
          }
          if (ctrl.signal.aborted) throw new Error('cancelled');
          // P1-4 取证: 缓存写失败此前被静默吞掉 — 完成产物只存在于本次响应,
          // 下次请求全链路重渲; §2 重定性要求先补日志再归因 (不改变行为)。
          try { writeFileSync(cachePath, outBuf); } catch (err) {
            console.warn('[wallpaper-engine] scene-anim 缓存写失败: ' + cachePath
              + ' (' + outBuf.length + 'B) — ' + String(err && err.message ? err.message : err));
          }
          // P-10/N-05: san_* 产物 (可达几十 MB) 落盘后按字节预算清一次
          gcFrameCacheSync(dirname(cachePath), cachePath);
          return outBuf;
        })();
        entry = { promise: pending, waiters: 0, cancel };
        _sceneAnimInflight.set(cachePath, entry);
        pending.finally(() => {
          if (_sceneAnimInflight.get(cachePath) === entry) _sceneAnimInflight.delete(cachePath);
        }).catch(() => { /* 错误由 await 侧处理 */ });
        // P2-14: 管道兜底 — 渲染失败/取消/门禁拦截时杀 ffmpeg + 关 stdin, 避免半
        // 截管道上的 ffmpeg 成为孤儿进程 (vid 在 IIFE 内赋值, 此处惰性读取;
        // 成功路径 finish 已置 settled, dispose 为 no-op)。
        pending.finally(() => { if (vid) vid.dispose(); }).catch(() => { /* 同上 */ });
      }
      entry.waiters++;
      // 不随客户端断开取消渲染: 浏览器 <video> 探针在渲染期间 (30-60s) 收不到
      // 媒体数据会中止请求 / 用户刷新或切换壁纸 → res close。若在此 cancel, 渲染
      // 中途死亡 (实测 7/24 帧处被杀), 进度卡死且动画永不落盘。改为渲染跑到完成
      // 并写缓存: 客户端轮询 (probe.onerror 保持轮询) 在缓存就绪后看到 100 自动
      // 切换; 同参数重复请求共享同一渲染任务 (inflight 去重), 不会重复渲染。
      // 渲染有界 (~1 分钟) 且结果可复用 — 代价仅是后台多占一会儿 CPU。
      const onClose = () => { entry.waiters--; };
      res.once('close', onClose);
      (async () => {
        try {
          const buf = await entry.promise;
          // 响应完成: 本请求不再占住渲染任务 (close 还会触发一次, 幂等)
          entry.waiters--;
          res.setHeader('Content-Type', mime);
          res.setHeader('Cache-Control', 'no-store');
          res.end(buf);
        } catch (err) {
          // P1-4 取证: 失败路径此前只向 (可能已关闭的) socket 回 422、无任何
          // 日志 (对比 degraded 事件有日志) — 孤儿渲染归因无从查起。补请求
          // 参数+帧数+错误; 行为不变, 仍回 422。
          console.warn('[wallpaper-engine] scene-anim 渲染失败: req=' + cachePath.slice(-30)
            + ' fps=' + fps + ' sec=' + sec + ' ' + w + 'x' + h + ext
            + ' frames=' + (entry.frames != null ? entry.frames : '?')
            + ' err=' + String(err && err.message ? err.message : err));
          res.statusCode = 422;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
        }
      })();
    },
  }));
  // P-06: entry.cancel 接通 — 不挂到 res close 是注释明载的有意取舍 (浏览器
  // <video> 探针会在渲染期间断开, 误挂会杀掉中途渲染且动画永不落盘); 真正的
  // 取消时机是插件卸载/HMR: 在途 worker 与 ffmpeg 子进程必须随宿主终止, 否则
  // 成孤儿继续吃 CPU。cancel 内部幂等 (aborted 直接 return)。
  disposers.push(() => {
    for (const e of _sceneAnimInflight.values()) {
      try { e.cancel(); } catch { /* ignore */ }
    }
  });

  // 3c. Scene 动画渲染进度: /scene-anim-progress/<token>?fps&fmt — 客户端轮询
  //     渲染中读 .prog 文件 (done/total), 完成 (缓存存在) 返回 100。
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/scene-anim-progress`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET') {
        res.statusCode = 405; res.end('method not allowed'); return;
      }
      const url = new URL(req.url || '/', 'http://x');
      const token = decodeURIComponent(url.pathname.slice(`${BASE}/scene-anim-progress/`.length));
      const abs = mediaMap.get(token);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (!abs) { res.end(JSON.stringify({ percent: 100 })); return; }
      const fps = clampNum(Number(url.searchParams.get('fps')) || 0, 2, 30, 12);
      const sec = clampNum(Number(url.searchParams.get('sec')) || 0, 0.5, 6, 2);
      let w = clampNum(Number(url.searchParams.get('w')) || 0, 320, 1920, 960);
      let h = clampNum(Number(url.searchParams.get('h')) || 0, 180, 1080, 540);
      const fmt = String(url.searchParams.get('fmt') || '').toLowerCase();
      const ext = fmt === 'mp4' ? '.mp4' : fmt === 'webm' ? '.webm' : '.apng';
      // P0-4④: 与 /scene-anim 同款量化 — 两处键必须一致, 进度/缓存才能对上
      // (注: 本端点历来不做 ortho 宽高比修正, 该不一致先维持现状不扩散)。
      const qzp = quantizeSceneAnimSize(abs, w, h);
      w = qzp.w; h = qzp.h;
      const cachePath = sceneAnimCachePath(abs, fps, sec, w, h, ext);
      if (existsSync(cachePath)) { res.end(JSON.stringify({ percent: 100 })); return; }
      const progFile = sceneAnimProgressFile(cachePath, ext);
      if (existsSync(progFile)) {
        let d = 0, tot = 1;
        try {
          const t = readFileSync(progFile, 'utf8');
          const parts = t.split('/');
          d = Number(parts[0]) || 0; tot = Number(parts[1]) || 1;
        } catch { /* ignore */ }
        res.end(JSON.stringify({ done: d, total: tot, percent: Math.round((d / tot) * 100) }));
      } else {
        res.end(JSON.stringify({ percent: 0 }));
      }
    },
  }));

  // 3c2. Live scene WebGL player HTML. The <iframe> loads <token> as the last
  //      path segment; the embedded runtime's own <script> reads that token from
  //      location.pathname to fetch the manifest. Served same-origin so the
  //      parent's backdrop-filter (liquid glass) can still sample it. The client
  //      does NOT embed this player by default (a live WebGL context per scene
  //      froze the page in testing) — the route stays available as a fallback.
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/scene-runtime`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET') { res.statusCode = 405; res.end('method not allowed'); return; }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(WE_SCENE_PLAYER_HTML);
    },
  }));

  // 3d. Scene manifest JSON — the WebGL player fetches this to know the scene
  //     layers / models / particles / camera. Built on demand from the scene
  //     pkg (or loose scene.json dir).
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/scene-manifest`,
    handler: async (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET') { res.statusCode = 405; res.end('method not allowed'); return; }
      const pathname = new URL(req.url || '/', 'http://x').pathname;
      const token = decodeURIComponent(pathname.slice(`${BASE}/scene-manifest/`.length));
      const abs = mediaMap.get(token);
      if (!abs) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: false, error: 'unknown-token' }));
        return;
      }
      try {
        // P-10: abs+mtimeMs 缓存 + in-flight 去重 (scene.js:108 路由内缓存,
        // 不动 scene-manifest.js 本身; 只缓存成功结果, 失败/空允许重试)
        let mtime = 0;
        try { mtime = statSync(abs).mtimeMs; } catch { /* keep 0 */ }
        const mkey = abs + '|' + mtime;
        const cached = _sceneManifestCache.get(mkey);
        if (cached) {
          // LRU 触碰: 重新插入挪到最新端
          _sceneManifestCache.delete(mkey);
          _sceneManifestCache.set(mkey, cached);
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(cached);
          return;
        }
        let pending = _sceneManifestInflight.get(mkey);
        if (!pending) {
          pending = (async () => {
            const tokenB64 = Buffer.from(abs, 'utf8').toString('base64url');
            // 异步读盘：scene.pkg 可达几十 MB，readFileSync 会阻塞事件循环。
            const manifest = abs.toLowerCase().endsWith('.json')
              ? buildSceneManifestFromDir(dirname(abs), tokenB64)
              : buildSceneManifest(new Uint8Array(await readFile(abs)), tokenB64);
            if (!manifest) return null;
            const body = JSON.stringify({ ok: true, manifest });
            _sceneManifestCache.set(mkey, body);
            while (_sceneManifestCache.size > SCENE_MANIFEST_CACHE_MAX) {
              const k = _sceneManifestCache.keys().next().value;
              if (k === undefined) break;
              _sceneManifestCache.delete(k);
            }
            return body;
          })();
          _sceneManifestInflight.set(mkey, pending);
          pending.finally(() => {
            if (_sceneManifestInflight.get(mkey) === pending) _sceneManifestInflight.delete(mkey);
          }).catch(() => { /* 错误由 await 侧处理 */ });
        }
        const body = await pending;
        if (!body) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: false, error: 'manifest-build-failed' }));
          return;
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(body);
      } catch (err) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) }));
      }
    },
  }));

  // 3d. Scene resources (textures/particle sprites referenced by the manifest).
  //     Each is decoded to PNG when possible, else served as raw bytes (the
  //     player labels by payload).
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/scene-resource`,
    handler: async (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET') { res.statusCode = 405; res.end('method not allowed'); return; }
      let rest = '';
      try {
        rest = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname.slice(`${BASE}/scene-resource/`.length));
      } catch {
        res.statusCode = 400; res.end('bad request'); return;
      }
      const token = rest.split('/')[0] ?? '';
      const abs = mediaMap.get(token);
      if (!abs) { res.statusCode = 404; res.end('unknown-token'); return; }
      const subpath = rest.slice(token.length).replace(/^\/+/, '');
      if (!subpath) { res.statusCode = 404; res.end('missing-subpath'); return; }
      if (subpath.includes('..')) { res.statusCode = 404; res.end('bad-path'); return; }
      // W1: 内置 util 纹理直接下发 (gate 按 shader default 填槽引用的 util/*
      // 不在 pkg 内, 场景缓存链必然 miss — 先于 pkg 访问短路, 省一次整包读)
      if (normalizeBuiltinUtilName(subpath)) {
        const png = getBuiltinTexturePng(subpath);
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-store');
        res.end(png);
        return;
      }
      try {
        // P1-2（review2 §4 第 2 波第 7 项）：主分支此前每请求整包读 pkg + 同步
        // 解码/encodePng；现改走 sceneResourceCached（glSceneAccess 访问 LRU +
        // 结果缓存，GL 路径同款缓存访问层）。响应字节与旧管线逐字节一致。
        let bytes = sceneResourceCached(abs, subpath);
        let mime = null;
        if (!bytes) {
          // scene-gl 兜底（plan §4.2）：extractSceneResourceVia 候选链覆盖不到
          // materials/masks/*.tex 等短名引用 → resolveSceneTexPath 后缀匹配解析。
          // 仅本兜底分支：命中但 decode 失败 → 422（既有 catch-raw 行为原样保留）。
          // pkgBytes 不再预读：兜底分支同样吃 glSceneAccess 的访问缓存（miss 时
          // 内部自行 readFileSync，语义与旧透传 pkgBytes 等价）。
          const access = glSceneAccess(abs, null);
          const texPath = access ? resolveSceneTexPath(access, subpath) : null;
          if (!texPath) { res.statusCode = 404; res.end('resource-not-found'); return; }
          const file = access.readFile(texPath);
          if (!file) { res.statusCode = 404; res.end('resource-not-found'); return; }
          const decoded = glDecodeTexCached(abs, texPath, file.bytes);
          if (!decoded) {
            res.statusCode = 422;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: 'tex-decode-failed', path: texPath }));
            return;
          }
          bytes = decoded.buf;
          mime = decoded.mime;
        }
        const isPng = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
        const isJpeg = bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
        res.setHeader('Content-Type', mime || (isPng ? 'image/png' : isJpeg ? 'image/jpeg' : 'application/octet-stream'));
        res.setHeader('Cache-Control', 'no-store');
        res.end(Buffer.from(bytes));
      } catch (err) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
      }
    },
  }));

  // ══ 3f/3g. scene-gl（Phase 1，docs/plan-scene-webgl.md §4）══════════════════
  // WebGL2 实时渲染支持：scene-gl-meta（白名单判定 + 完整 scene schema）、
  // scene-shader（官方 ES 1.00 shader 展开下发）。与 scene-anim 同款
  // betaSceneAnim 403 门控 + token=base64url(abs)。GL 失败客户端落 mp4。

  // pkg/目录访问 LRU（key=abs|mtime, cap 2 — 附录 §6 定案）
  const _glPkgCache = new Map();
  function glSceneAccess(abs, pkgBytes) {
    let mtime = 0;
    try { mtime = statSync(abs).mtimeMs; } catch { /* keep 0 */ }
    const key = abs + '|' + Math.round(mtime);
    const hit = _glPkgCache.get(key);
    if (hit) {
      _glPkgCache.delete(key);
      _glPkgCache.set(key, hit);
      return hit;
    }
    let access = null;
    try {
      access = abs.toLowerCase().endsWith('.json')
        ? dirSceneAccess(dirname(abs))
        : pkgSceneAccess(pkgBytes || new Uint8Array(readFileSync(abs)));
    } catch {
      return null;
    }
    _glPkgCache.set(key, access);
    while (_glPkgCache.size > 2) _glPkgCache.delete(_glPkgCache.keys().next().value);
    return access;
  }

  // 解码纹理 PNG/JPEG LRU（字节预算 64MB — 附录 §4.4；4K PNG 单张 5-10MB）
  const GL_TEX_CACHE_CAP = 64 * 1024 * 1024;
  const _glTexCache = new Map(); // key → { buf, mime, size }
  let _glTexCacheBytes = 0;
  function glDecodeTexCached(abs, texPath, texBytes) {
    let mtime = 0;
    try { mtime = statSync(abs).mtimeMs; } catch { /* keep 0 */ }
    const key = abs + '|' + Math.round(mtime) + '|' + texPath;
    const hit = _glTexCache.get(key);
    if (hit) {
      _glTexCache.delete(key);
      _glTexCache.set(key, hit);
      return hit;
    }
    let out = null;
    try {
      const dec = decodeTex(texBytes);
      if (dec.kind === 'jpeg') out = { buf: Buffer.from(dec.bytes), mime: 'image/jpeg' };
      else if (dec.kind === 'png-pass') out = { buf: Buffer.from(dec.bytes), mime: 'image/png' };
      else if (dec.kind === 'rgba') out = { buf: encodePng(dec.width, dec.height, dec.rgba), mime: 'image/png' };
    } catch {
      return null;
    }
    if (!out) return null;
    out.size = out.buf.length;
    _glTexCache.set(key, out);
    _glTexCacheBytes += out.size;
    while (_glTexCacheBytes > GL_TEX_CACHE_CAP && _glTexCache.size > 1) {
      const k = _glTexCache.keys().next().value;
      _glTexCacheBytes -= _glTexCache.get(k).size;
      _glTexCache.delete(k);
    }
    return out;
  }

  // /scene-resource 主分支结果缓存（P1-2）：键 = abs|mtime|subpath（与
  // glDecodeTexCached 同款失效语义），只缓存成功结果；字节预算 LRU 与 _glTexCache
  // 同款 64MB。注意：不能直接复用 glDecodeTexCached —— 它走 pkg-extract.decodeTex +
  // canvas.js level 6 encodePng（jpeg 原样透传），而主分支契约是 scene-manifest
  // 管线（jpeg 解码成 RGBA 后 level 9 PNG；decode 失败回退原始 tex 字节），换用会
  // 改响应字节。encodePng 异步化暂缓: 需 worker 化（路由须保持 Buffer 语义）。
  const SCENE_RES_CACHE_CAP = 64 * 1024 * 1024;
  const _sceneResCache = new Map(); // key → { buf, size }
  let _sceneResCacheBytes = 0;
  function sceneResourceCached(abs, subpath) {
    let mtime = 0;
    try { mtime = statSync(abs).mtimeMs; } catch { /* keep 0 */ }
    const key = abs + '|' + Math.round(mtime) + '|' + subpath;
    const hit = _sceneResCache.get(key);
    if (hit) {
      _sceneResCache.delete(key);
      _sceneResCache.set(key, hit);
      return hit.buf;
    }
    // 访问层走 glSceneAccess 的 pkg/目录 LRU；候选链解析（extractSceneResourceVia）
    // 与旧 extractSceneResource/FromDir 逐字节同构。
    const access = glSceneAccess(abs, null);
    if (!access) throw new Error('scene-resource: open failed: ' + abs); // 与旧 readFile 抛错同走 500
    const buf = extractSceneResourceVia(access, subpath);
    if (!buf) return null; // 候选链未命中：不缓存，交给下方 resolveSceneTexPath 兜底
    _sceneResCache.set(key, { buf, size: buf.length });
    _sceneResCacheBytes += buf.length;
    while (_sceneResCacheBytes > SCENE_RES_CACHE_CAP && _sceneResCache.size > 1) {
      const k = _sceneResCache.keys().next().value;
      _sceneResCacheBytes -= _sceneResCache.get(k).size;
      _sceneResCache.delete(k);
    }
    return buf;
  }

  // WE 值读取（{user,value} 包装 / 原始值）与向量解析（字符串/数组/数字播撒）
  const glVal = (o, key, def) => {
    const v = o && o[key];
    if (v == null) return def;
    if (typeof v === 'object' && 'value' in v) return v.value;
    return v;
  };
  const glVec = (v, n, def) => {
    if (v == null) return def;
    if (typeof v === 'number') return Array(n).fill(v);
    if (Array.isArray(v)) { const a = v.map(Number); return a.length >= n ? a.slice(0, n) : def; }
    const parts = String(v).trim().split(/\s+/).map(Number);
    if (parts.some((x) => !Number.isFinite(x))) return def;
    if (parts.length === 1) return Array(n).fill(parts[0]);
    return parts.length >= n ? parts.slice(0, n) : def;
  };
  const glHasAnim = (v) => v != null && typeof v === 'object' && v.animation != null;

  // 纹理引用 → { path, width, height, headerWidth, headerHeight }
  // （lwe 约定 g_TextureNResolution=(mip0.w, mip0.h, header.w, header.h) — 附录 §11-①）
  function glTexInfo(access, ref) {
    if (ref == null || ref === '') return null;
    const refName = typeof ref === 'string' ? ref : (ref && typeof ref.name === 'string' ? ref.name : null);
    if (!refName || refName.startsWith('_rt_')) return null;
    const texPath = resolveSceneTexPath(access, refName);
    if (!texPath) {
      // W1: 内置 util 纹理 (官方 shader default 引用的全局纹理; 本机无 WE 安装
      // → 程序化生成, util-textures.js)。引用存在但 pkg 解析不到时才走内置。
      const bi = getBuiltinTextureInfo(refName);
      if (bi) return bi;
      return undefined; // 引用存在但解析失败（≠ 槽位为空）
    }
    const file = access.readFile(texPath);
    if (!file) return undefined;
    let info = null;
    try { info = parseTex(file.bytes); } catch { return undefined; }
    // 视频纹理嗅探（extractSceneVideoVia 同款 ftyp 扫描）：TEXI 未标记但 mip0 是
    // mp4 的"伪图像"纹理（如时辰切换场景 morning/day/dusk/night.tex）——GL 无法
    // 当静态图用，gate 需按视频对象处理（跳过/回退 sceneVideo）。
    let video = info.isVideoMp4 === true;
    if (!video) {
      const raw = file.bytes;
      for (let i = 0; i < 200 && i + 8 <= raw.length; i++) {
        if (raw[i] === 0x66 && raw[i + 1] === 0x74 && raw[i + 2] === 0x79 && raw[i + 3] === 0x70) { video = true; break; }
      }
    }
    return {
      path: texPath,
      width: info.mip0Width, height: info.mip0Height,
      headerWidth: info.width, headerHeight: info.height,
      video,
    };
  }

  // W2: 已验证效果集 (本地 7 张壁纸实测) — 默认放行; 其余目录走实验开关
  // (settings.sceneGLExperimental, 默认关)。渲染机制对全部效果通用 (客户端
  // 编译 + 失败隔离), 此分层只是 gate 放行策略。
  const SCENE_GL_EFFECT_TESTED = new Set(['waterripple', 'iris', 'waterwaves', 'foliagesway', 'shake', 'blurprecise', 'lens_flare_sun']);
  const SCENE_GL_ENGINE = 'dsh-we-scene-gl/4'; // W2: 通用效果层 (多pass拍平/previous/workshop)
  const SCENE_GL_ANIM_KEYS = ['alpha', 'scale', 'origin', 'angles', 'visible', 'color', 'size', 'brightness', 'parallaxDepth', 'zoom'];

  // 白名单 gate（主计划 §3 + 降级政策）：返回 { ok, reason, objects, degraded }
  // 分层语义（用户拍板：默认开启降级 GL、一视同仁）：
  //  - render：白名单效果的 image 对象 → 完整渲染
  //  - render-degraded：不支持的效果跳过、对象保留（blurprecise/lens_flare/workshop 自定义…）
  //  - skip：粒子/文字/音频/无图像对象 → 跳过并记入 degraded 清单（客户端 UI 展示）
  //  - hard-reject：只剩零个可渲染对象、zoom≠1（静态构图会错）等结构性情况
  // 放宽依据（CPU parity，实测/代码确认）：
  //  - hdr：general.hdr 仅 bloom 管线读取，无 bloom 时 CPU 恒 no-op
  //  - parallax：CPU 仅鼠标驱动（parallaxDisp≠0 才位移），mp4/静态帧恒静止 → GL 同
  //  - eye：image-only 场景 = _viewShift x 平移（-eye.x×ps，y 恒忽略，满幅背景豁免）
  //    → meta 透传 eye，renderer 实现同款 viewShift
  function sceneGLCheck(scene, access, opts) {
    // W2: 实验开关 (settings.sceneGLExperimental, 默认关) — 未在本地验证集
    // 出现的效果目录/结构变体默认 gate 掉, 开启后按通用机制放行。
    const experimental = !!(opts && opts.experimental === true);
    const fail = (reason) => ({ ok: false, reason });
    const general = scene.general || {};
    const cam = scene.camera || {};
    const degraded = [];
    const mark = (object, feature, action) => degraded.push({ object, feature, action });
    if (general.bloom === true) mark(null, 'bloom', '泛光管线未支持，已按无泛光渲染');
    if (cam.paths) mark(null, 'camera-paths', '相机路径动画未支持，已按起始构图渲染');
    // W0: 内嵌脚本提醒 — GL 路由从不执行脚本; CPU 路由由 settings.enableSceneScripts
    // 总开关控制 (默认关)。配置页据此显示"内嵌脚本未运行"。
    if (sceneHasScripts(scene)) mark(null, 'scene-script', '壁纸含内嵌脚本，未执行（如需运行请在设置中开启）');
    const eye = glVec(glVal(cam, 'eye', '0 0 0'), 3, [0, 0, 0]) || [0, 0, 0];
    const objects = Array.isArray(scene.objects) ? scene.objects : [];
    // H-07: zoom 三处来源一起判 — scene.camera.zoom / general.zoom / 相机对象
    // (camera:"default" 的 scene 对象) 的 zoom 属性。任一 ≠1 即 hard-reject:
    // GL 恒按 zoom=1 渲染, 静态构图会错 (旧实现只看 scene.camera.zoom, 其余
    // 两处静默丢失)。
    const zoomBad = (v) => {
      const z = Number(v);
      return !Number.isFinite(z) || Math.abs(z - 1) > 1e-4;
    };
    if (zoomBad(glVal(cam, 'zoom', 1))
      || zoomBad(glVal(general, 'zoom', 1))
      || objects.some((o) => o && glVal(o, 'camera', null) === 'default' && zoomBad(glVal(o, 'zoom', 1)))) {
      return fail('zoom');
    }
    if (objects.length === 0) return fail('objects:0');
    // H-04: 父链查找表 (CPU core.js objectsById 同款)
    const objectsById = new Map();
    for (const o of objects) if (o && o.id != null) objectsById.set(o.id, o);
    // H-03: 对象自身可见性 — 与 CPU core.js _isVisibleSelf 逐条对齐:
    // 官方语义 (lwe DynamicValueParser.cpp:37-52 + DynamicValue.cpp:160-185):
    // 数值按 !=0; 字符串先尝试 stof 解析 — 可解析按数值, 不可解析 ('true'/
    // 'false'/空串) → String 型 getBool() 恒 false → 隐藏 (裸字符串 'true'
    // 官方也隐藏) (BASE-05 烘焙动画值可能是数值/字符串);
    // {user,value} 绑定读 project.json general.properties 的当前值
    // (pkg 通常不含 project.json → 读不到该键时按 value, 与 CPU 回退序一致)。
    const projectJson = (() => { try { return access.readJson('project.json'); } catch { return null; } })();
    const userProps = projectJson && projectJson.general && projectJson.general.properties
      && typeof projectJson.general.properties === 'object'
      ? projectJson.general.properties : null;
    const valHidden = (x) => x === false || x === 0
      || (typeof x === 'string' && (!Number.isFinite(Number(x)) || Number(x) === 0));
    const glVisibleSelf = (o) => {
      const v = o && o.visible;
      if (v == null) return true;
      if (typeof v === 'object' && v !== null && 'user' in v) {
        if (typeof v.user === 'string' && v.user && userProps) {
          const up = userProps[v.user];
          if (up && typeof up === 'object' && 'value' in up) return !valHidden(up.value);
        }
        return !valHidden(v.value);
      }
      return !valHidden(glVal(o, 'visible', true));
    };
    // H-04: gate 侧父链折叠 (CPU core.js resolveTransform 同式: 子 origin ×
    // 累积 scale → 旋转(累积 Z 角) → + 累积 origin; 只做平移+角+缩放复合,
    // 不做 attachment 锚点)。折叠结果只用于 degraded 标记与 effTr 字段 —
    // gate 精度, 决定跳过/降级判定用; 完整父链渲染由 CPU 侧负责 (GL renderer
    // 消费 effTr 是 Wave 3, 当前仅随 payload 下发)。
    const foldChain = (chain) => {
      const root = chain[chain.length - 1];
      let origin = glVec(glVal(root, 'origin', '0 0 0'), 3, [0, 0, 0]) || [0, 0, 0];
      let scale = glVec(glVal(root, 'scale', '1 1 1'), 3, [1, 1, 1]) || [1, 1, 1];
      let angle = (glVec(glVal(root, 'angles', '0 0 0'), 3, [0, 0, 0]) || [0, 0, 0])[2] || 0;
      for (let i = chain.length - 2; i >= 0; i--) {
        const co = glVec(glVal(chain[i], 'origin', '0 0 0'), 3, [0, 0, 0]) || [0, 0, 0];
        const cs = glVec(glVal(chain[i], 'scale', '1 1 1'), 3, [1, 1, 1]) || [1, 1, 1];
        const ca = (glVec(glVal(chain[i], 'angles', '0 0 0'), 3, [0, 0, 0]) || [0, 0, 0])[2] || 0;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const rx = co[0] * scale[0], ry = co[1] * scale[1];
        origin = [origin[0] + rx * cos - ry * sin, origin[1] + rx * sin + ry * cos, 0];
        scale = [scale[0] * cs[0], scale[1] * cs[1], scale[2] * cs[2]];
        angle += ca;
      }
      return { origin, scale, angle };
    };
    // W1/W2: 官方语义 — 空纹理槽用 shader 元注释 default 填充 ({"default":"util/noise"}
    // 等; WE 编辑器对未覆盖槽位即按 default 取全局纹理)。按 shader 引用惰性解析
    // (pkg 内 shaders/<shaderRef>.frag/.vert, 与 /scene-shader 同路径同 parseMetaGL);
    // 解析失败按无 default (回退旧行为: 槽位 null → 客户端白/中灰兜底)。
    const samplerDefaultCache = new Map();
    const samplerDefaultFor = (shaderRef, slot) => {
      if (!samplerDefaultCache.has(shaderRef)) {
        const map = new Map();
        try {
          for (const ext of ['frag', 'vert']) {
            const f = access.readFile(`shaders/${shaderRef}.${ext}`);
            if (!f) continue;
            const meta = parseMetaGL(new TextDecoder('utf-8').decode(f.bytes));
            for (const [uname, u] of Object.entries(meta.uniforms || {})) {
              if (u.type !== 'sampler2D' || typeof u.default !== 'string' || !u.default) continue;
              const ms = /^g_Texture(\d+)$/.exec(uname);
              if (ms) map.set(Number(ms[1]), u.default);
            }
          }
        } catch { /* 解析失败按无 default */ }
        samplerDefaultCache.set(shaderRef, map);
      }
      return samplerDefaultCache.get(shaderRef).get(slot) || null;
    };
    const out = [];
    let idx = -1;
    for (const obj of objects) {
      idx++;
      const name = String(obj.name || ('对象' + idx));
      // H-03: 静态不可见对象剔除并记 degraded (CPU 同款语义; 旧实现漏字符串
      // 'false'/'0' 与 user 绑定, 且被跳对象不记 mark)
      if (!glVisibleSelf(obj)) { mark(name, 'visible 隐藏', '跳过该对象'); continue; }
      // H-04: 父链 — 任一祖先隐藏则本对象隐藏 (CPU _isVisible); 祖先角/位移/
      // 缩放折叠进 effTr; 链断 (父 id 缺失/成环) 记 mark 后按可达链继续。
      let effTr = null;
      if (obj.parent != null) {
        const chain = [obj];
        let cur = obj;
        let guard = 0;
        let broken = false;
        while (cur.parent != null && guard < 32) {
          const parent = objectsById.get(cur.parent);
          if (!parent || chain.includes(parent)) { broken = true; break; }
          chain.push(parent);
          cur = parent;
          guard++;
        }
        if (chain.some((a, i) => i > 0 && !glVisibleSelf(a))) {
          mark(name, 'visible 隐藏', '父链祖先隐藏，跳过该对象');
          continue;
        }
        if (broken) mark(name, 'parent 链缺失', '按无父渲染');
        effTr = foldChain(chain);
        // 父链有实际贡献 (折叠结果 ≠ 仅自身一元链) → 忽略 effTr 的渲染会错位,
        // 记入 degraded 让设置面板可见 (G-04 同款上浮链)
        const own = foldChain([obj]);
        const folded = Math.abs(effTr.angle - own.angle) > 1e-6
          || Math.abs(effTr.origin[0] - own.origin[0]) > 1e-6
          || Math.abs(effTr.origin[1] - own.origin[1]) > 1e-6
          || Math.abs(effTr.scale[0] - own.scale[0]) > 1e-6
          || Math.abs(effTr.scale[1] - own.scale[1]) > 1e-6;
        if (!broken && folded) mark(name, 'parent', '父链变换已折叠进 effTr（gate 精度；完整渲染由 CPU 侧负责）');
      }
      // 跳过类对象：粒子发射器 / 3D 模型 / 相机 / 无图像（文字、声音、纯 solid 等）
      if (obj.particle || obj.particles) { mark(name, 'particle', '粒子发射器未支持，已跳过该对象'); continue; }
      // H-05: no-image 桶细分 — 3D 模型/相机对象此前落笼统的"文字/脚本/纯色"
      // 标签; '3D 模型' 与既有 'model'(模型无材质) 区分以保 feature 唯一性。
      if (typeof obj.model === 'string' && obj.model) { mark(name, '3D 模型', '3D 模型对象未支持，已跳过该对象'); continue; }
      if (glVal(obj, 'camera', null) === 'default') { mark(name, '相机对象', '相机对象未支持，已跳过该对象'); continue; }
      if (!obj.image) {
        if (obj.sound != null) mark(name, '声音对象', '声音对象未支持，已跳过该对象');
        else if (obj.text != null) mark(name, '文字对象', '文字对象未支持，已跳过该对象');
        else if (obj.puppet != null) mark(name, '木偶对象', '木偶对象未支持，已跳过该对象');
        else mark(name, 'no-image', '脚本/纯色对象未支持，已跳过该对象');
        continue;
      }
      const modelJson = access.readJson(String(obj.image));
      if (!modelJson || !modelJson.material) { mark(name, 'model', '模型无材质，已跳过该对象'); continue; }
      if (modelJson.puppet) mark(name, 'puppet', '骨骼蒙皮动画未支持，已按静态贴图渲染');
      const matJson = access.readJson(String(modelJson.material));
      if (!matJson || !Array.isArray(matJson.passes) || matJson.passes.length !== 1) { mark(name, 'passes', '材质 pass 数≠1，已跳过该对象'); continue; }
      const matPass = matJson.passes[0];
      if (!/^genericimage/i.test(String(matPass.shader || ''))) { mark(name, 'shader:' + (matPass.shader || '?'), '材质 shader 未支持，已跳过该对象'); continue; }
      // 主纹理（视频纹理 = 伪图像，GL 不可用 → 跳过对象；场景级 sceneVideo 路径兜底）
      const mainRef = Array.isArray(matPass.textures) ? matPass.textures[0] : null;
      const mainTex = glTexInfo(access, mainRef);
      if (!mainTex) { mark(name, 'texture', '主纹理不可读（缺失），已跳过该对象'); continue; }
      if (mainTex.video) { mark(name, 'video-texture', '视频纹理对象（GL 不支持），已跳过该对象'); continue; }
      // 对象静态性：属性动画 → 静态首帧渲染 + 标记（木偶呼吸/摆动动画即此类）
      for (const key of SCENE_GL_ANIM_KEYS) {
        if (glHasAnim(obj[key])) { mark(name, 'anim:' + key, '属性动画(' + key + ')未支持，已按静态渲染'); break; }
      }
      if (Number(glVal(obj, 'colorBlendMode', 0)) !== 0) mark(name, 'cbm', 'colorBlendMode 未支持，已按默认渲染');
      const blending = String(matPass.blending || 'normal');
      if (blending !== 'normal' && blending !== 'translucent') mark(name, 'blending:' + blending, '混合模式未支持，已按普通透明合成');
      const alpha = Number(glVal(obj, 'alpha', 1));
      const brightness = Number(glVal(obj, 'brightness', 1));
      // 效果：不可见效果先剔除（CPU effects.js:37 同款语义）；不支持的效果跳过、对象保留
      // W2: 通用效果层 — effect.json passes[].material → 材质 → shader 引用, 逐 pass
      // 拍平进对象效果链 (客户端 FBO ping-pong 天然支持 N 链); 分层: 已验证目录
      // (SCENE_GL_EFFECT_TESTED) 默认放行, 其余需实验开关; 音频响应恒跳过。
      const effects = [];
      for (const ef of Array.isArray(obj.effects) ? obj.effects : []) {
        // H-03 同款对齐 (效果级): visible 的字符串/数值形态同样判隐藏
        if (valHidden(glVal(ef, 'visible', true))) continue;
        const dir = ef && ef.file ? basename(dirname(String(ef.file))) : '';
        const skipFx = (why) => mark(name, 'effect:' + (dir || '?'), why + '，已跳过该效果（对象保留）');
        // 音频响应: 全分层恒跳过 (用户排除音频绑定) — 目录名正则 + 下文 shader 源码双检
        if (/audio|bars|oscilloscope|visualizer|equalizer|spectrum/i.test(dir)) { skipFx('音频响应未支持'); continue; }
        if (!SCENE_GL_EFFECT_TESTED.has(dir) && !experimental) { skipFx('效果未支持（未测试特性，可在设置中开启）'); continue; }
        const effectJson = ef && ef.file ? access.readJson(String(ef.file)) : null;
        const ePasses = effectJson && Array.isArray(effectJson.passes) ? effectJson.passes : [];
        const scenePasses = Array.isArray(ef.passes) ? ef.passes : [];
        if (!ePasses.length) { skipFx('效果定义缺失'); continue; }
        let fxBad = false;
        for (let pi = 0; pi < ePasses.length; pi++) {
          const ePass = ePasses[pi] || {};
          const matJson = ePass.material ? access.readJson(String(ePass.material)) : null;
          const matPass = matJson && Array.isArray(matJson.passes) ? matJson.passes[0] : null;
          const shaderRef = matPass && typeof matPass.shader === 'string' ? matPass.shader : '';
          if (!shaderRef || shaderRef.includes('..') || shaderRef.startsWith('/')) { skipFx('材质 shader 缺失'); fxBad = true; break; }
          const fragF = access.readFile(`shaders/${shaderRef}.frag`);
          const vertF = access.readFile(`shaders/${shaderRef}.vert`);
          if (!fragF || !vertF) { skipFx('shader 文件缺失'); fxBad = true; break; }
          // 音频响应第二道: shader 源码引用音频频谱 uniform → 恒跳过
          // (覆盖目录名漏网形态, 如全下划线目录名的汉化音频效果)
          const fragSrc = new TextDecoder('utf-8').decode(fragF.bytes);
          if (/g_AudioSpectrum/i.test(fragSrc)) { skipFx('音频响应未支持'); fxBad = true; break; }
          const sPass = scenePasses[pi] || {};
          const combos = { ...(matPass.combos || {}), ...(sPass.combos || {}) };
          const comboOf = (k) => String(combos[k] ?? '0');
          if (comboOf('AUDIOPROCESSING') !== '0') { skipFx('音频响应未支持'); fxBad = true; break; }
          // 结构性变体分层: 未测试形态需实验开关 (机制客户端已通用, 仅未本地验证)
          if (comboOf('PERSPECTIVE') === '1' && !experimental) { skipFx('透视变体未测试'); fxBad = true; break; }
          const consts = sPass.constantshadervalues || {};
          // H-06: 双波两处开关都要挡 — combo DUALWAVES 与常量 direction2/scale2
          if (shaderRef === 'effects/waterwaves' && !experimental && (comboOf('DUALWAVES') === '1'
            || 'direction2' in consts || 'scale2' in consts)) { skipFx('双波变体未测试'); fxBad = true; break; }
          if (shaderRef === 'effects/foliagesway' && comboOf('MODE') === '1' && !experimental) { skipFx('顶点模式未测试'); fxBad = true; break; }
          // 纹理槽: scene.json pass.textures (null→shader default) ⊕ effect.json
          // pass.bind (_rt_→链输入/previous→对象主纹理/命名纹理)
          const binds = Array.isArray(ePass.bind) ? ePass.bind : [];
          const bindByIndex = new Map();
          for (const b of binds) if (b && Number.isFinite(Number(b.index))) bindByIndex.set(Number(b.index), String(b.name || ''));
          const texRefs = Array.isArray(sPass.textures) ? sPass.textures : [];
          samplerDefaultFor(shaderRef, -1); // 预热该 shader 的 default 表
          const defaults = samplerDefaultCache.get(shaderRef);
          const maxBindSlot = bindByIndex.size ? Math.max(...bindByIndex.keys()) : -1;
          const maxDefaultSlot = defaults && defaults.size ? Math.max(...defaults.keys()) : -1;
          const slotCount = Math.max(texRefs.length, maxBindSlot + 1, maxDefaultSlot + 1);
          const texSlots = [];
          let texBad = false;
          for (let si = 0; si < slotCount; si++) {
            const bindName = bindByIndex.get(si);
            if (bindName != null && bindName !== '') {
              if (bindName === 'previous') { texSlots.push({ previous: true }); continue; }
              if (bindName.startsWith('_rt_')) {
                // 仅放行: index 0 且引用上一 pass 的输出 FBO (拍平后 = 链输入,
                // 客户端 unit0 本就绑链输入 — 该槽仅作清单标记)
                const prevTarget = pi > 0 ? String(ePasses[pi - 1].target || '') : '';
                if (si === 0 && pi > 0 && prevTarget && bindName === prevTarget) { texSlots.push({ chain: true }); continue; }
                skipFx('_rt_ 跨 pass 绑定未支持'); texBad = true; break;
              }
              const tb = glTexInfo(access, bindName);
              if (tb === undefined || (tb && tb.video)) { skipFx('效果纹理不可读'); texBad = true; break; }
              texSlots.push(tb);
              continue;
            }
            let ref = si < texRefs.length ? texRefs[si] : null;
            if (ref == null || ref === '' || ref === 'null') ref = samplerDefaultFor(shaderRef, si);
            const t = glTexInfo(access, ref);
            if (t === undefined || (t && t.video)) { skipFx('效果纹理不可读'); texBad = true; break; }
            texSlots.push(t || null);
          }
          if (texBad) { fxBad = true; break; }
          effects.push({ shader: shaderRef, dir, textures: texSlots, constants: consts, combos });
        }
      }
      out.push({
        name,
        type: 'image',
        origin: glVec(glVal(obj, 'origin', '0 0 0'), 3, [0, 0, 0]),
        size: glVec(glVal(obj, 'size', null), 2, null) || [mainTex.width, mainTex.height],
        scale: glVec(glVal(obj, 'scale', '1 1 1'), 3, [1, 1, 1]),
        angles: glVec(glVal(obj, 'angles', '0 0 0'), 3, [0, 0, 0]),
        // H-04: 父链折叠变换 (gate 精度; 无父对象为 null 不下发)
        ...(effTr ? { effTr: { origin: [effTr.origin[0], effTr.origin[1]], scale: [effTr.scale[0], effTr.scale[1]], angle: effTr.angle } } : {}),
        alpha: Number.isFinite(alpha) ? alpha : 1,
        brightness: Number.isFinite(brightness) ? brightness : 1,
        colorBlendMode: 0,
        alignment: String(glVal(obj, 'alignment', '') || ''),
        blending,
        mainTexture: mainTex,
        effects,
      });
    }
    if (out.length === 0) return fail('no-renderable');
    return { ok: true, eye, degraded, objects: out };
  }

  // 3f. GET /scene-gl-meta/<token> — 白名单判定 + 完整 scene schema（附录 §6.1）
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/scene-gl-meta`,
    handler: async (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET') { res.statusCode = 405; res.end('method not allowed'); return; }
      const url = new URL(req.url || '/', 'http://x');
      const token = decodeURIComponent(url.pathname.slice(`${BASE}/scene-gl-meta/`.length));
      const abs = mediaMap.get(token);
      if (!abs) { res.statusCode = 404; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify({ error: 'unknown-token' })); return; }
      const st = readSettings();
      if (!st || st.betaSceneAnim !== true) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'beta-scene-anim-disabled' }));
        return;
      }
      try {
        const access = glSceneAccess(abs, null);
        if (!access) { res.statusCode = 422; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify({ supported: false, reason: 'pkg-read' })); return; }
        const scene = access.readJson('scene.json');
        if (!scene) { res.statusCode = 422; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify({ supported: false, reason: 'scene-json' })); return; }
        const check = sceneGLCheck(scene, access, { experimental: st.sceneGLExperimental === true });
        const payload = { supported: check.ok, engine: SCENE_GL_ENGINE };
        if (!check.ok) {
          payload.reason = check.reason;
          // W0: 硬拒路径同样下发 degraded (此前仅 supported 时下发) — 含脚本
          // 壁纸被硬拒 (如 no-renderable) 时配置页仍能显示"内嵌脚本未运行"。
          payload.degraded = Array.isArray(check.degraded) ? check.degraded : [];
        } else {
          const general = scene.general || {};
          const ortho = general.orthogonalprojection || {};
          payload.scene = {
            general: {
              bloom: general.bloom === true,
              hdr: general.hdr === true,
              clearenabled: general.clearenabled !== false,
              clearcolor: String(glVal(general, 'clearcolor', '0 0 0')),
              ortho: { width: Number(ortho.width) || 0, height: Number(ortho.height) || 0 },
            },
            camera: { static: true, eye: check.eye },
            objects: check.objects,
          };
          // 降级清单（缺省 [] = 完整渲染；客户端设置面板/徽标据此提示用户）
          payload.degraded = Array.isArray(check.degraded) ? check.degraded : [];
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(payload));
      } catch (err) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
      }
    },
  }));

  // 3g. GET /scene-shader/<token>/<shaderRef> — 官方 ES 1.00 shader 展开下发
  //     （只做 expandIncludes，#if 原样保留给客户端 define 头求值；附录 §6.3）
  const _glslStubDir = join(dirname(fileURLToPath(import.meta.url)), 'we-renderer', 'glsl');
  const _glslStubs = {
    'common.h': readFileSync(join(_glslStubDir, 'common.h'), 'utf8'),
    'common_perspective.h': readFileSync(join(_glslStubDir, 'common_perspective.h'), 'utf8'),
  };
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/scene-shader`,
    handler: async (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET') { res.statusCode = 405; res.end('method not allowed'); return; }
      const rest = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname.slice(`${BASE}/scene-shader/`.length));
      const token = rest.split('/')[0] ?? '';
      const abs = mediaMap.get(token);
      if (!abs) { res.statusCode = 404; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify({ error: 'unknown-token' })); return; }
      const st = readSettings();
      if (!st || st.betaSceneAnim !== true) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'beta-scene-anim-disabled' }));
        return;
      }
      // W2: 参数为完整 shader 引用 (effects/<dir> 或 workshop/<id>/effects/<name>),
      // 与 gate 清单 ef.shader 对应; 白名单目录门禁 → 路径形态校验 + pkg 内存在性。
      const shaderRef = rest.slice(token.length).replace(/^\/+/, '');
      if (!/^[A-Za-z0-9_\-\/]+$/.test(shaderRef) || shaderRef.includes('..') || shaderRef.startsWith('/')) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'shader-ref-invalid', shader: shaderRef }));
        return;
      }
      try {
        const access = glSceneAccess(abs, null);
        if (!access) { res.statusCode = 422; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify({ error: 'pkg-read' })); return; }
        const fragFile = access.readFile(`shaders/${shaderRef}.frag`);
        const vertFile = access.readFile(`shaders/${shaderRef}.vert`);
        if (!fragFile || !vertFile) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'shader-missing', shader: shaderRef }));
          return;
        }
        const fragRaw = new TextDecoder('utf-8').decode(fragFile.bytes);
        const vertRaw = new TextDecoder('utf-8').decode(vertFile.bytes);
        // include 白名单预检：未知 include → 422（防"能编译但错"）
        for (const src of [fragRaw, vertRaw]) {
          const incRe = /#include\s+"([^"]+)"/g;
          let im;
          while ((im = incRe.exec(src))) {
            if (!_glslStubs[im[1]]) {
              res.statusCode = 422;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ error: 'include-not-found', include: im[1] }));
              return;
            }
          }
        }
        const resolveStub = (name) => _glslStubs[name] || '';
        let frag = expandIncludes(fragRaw, resolveStub);
        let vert = expandIncludes(vertRaw, resolveStub);
        // sf35: shake.frag 旧版（2023 pkg 快照）相位裁 [0,π/2) → 每 π/2/speed 硬跳变
        // （"人物快速闪动"根因）。官方后续版本已改为 6.28 切片（Steam 讨论帖定稿，
        // 翻译新增 shake_phase 属性佐证）。检测旧特征 → 替换 2π 连续公式；新版不动。
        if (shaderRef === 'effects/shake') {
          const { frag: patched, patched: hits } = patchShakeFrag(frag);
          if (hits.length) frag = patched;
        }
        // 官方部分 shader（shake.vert 等）不 #include common.h 却直接用 mul/CAST
        // 等宏/函数（官方引擎隐式注入公共头）→ 缺 include 守卫标记时前置补 stub。
        // stub 自带 WE_COMMON_H_MIN 守卫，已含 common.h 的 shader 不受影响。
        const commonStub = _glslStubs['common.h'] || '';
        if (commonStub) {
          if (!vert.includes('WE_COMMON_H_MIN')) vert = commonStub + '\n' + vert;
          if (!frag.includes('WE_COMMON_H_MIN')) frag = commonStub + '\n' + frag;
        }
        // parseMetaGL 对 vert+frag 各跑一次再按字段合并（对齐 CPU compileGlsl，
        // vert 覆盖 frag 同名项 — PERSPECTIVE 元注释只在 waterripple.vert）
        const metaF = parseMetaGL(frag);
        const metaV = parseMetaGL(vert);
        const combos = { ...metaF.combos, ...metaV.combos };
        const uniforms = { ...metaF.uniforms, ...metaV.uniforms };
        // 纹理槽表：sampler2D 声明 → unit/role/combo（附录 §6.3）
        const textures = {};
        for (const [name, u] of Object.entries(uniforms)) {
          if (u.type !== 'sampler2D') continue;
          const mUnit = /^g_Texture(\d+)$/.exec(name);
          textures[name] = {
            unit: mUnit ? Number(mUnit[1]) : null,
            role: u.mode === 'opacitymask' ? 'opacitymask' : (mUnit && Number(mUnit[1]) === 0 ? 'source' : 'aux'),
            combo: u.combo || null,
            mode: u.mode || null, // flowmask 槽空时客户端回退中灰（非白）— 见 scene-gl.js
            stage: metaV.uniforms[name] ? 'vertex' : 'fragment',
          };
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        // uniformsFrag：片元阶段自有表。同名 uniform 跨阶段语义可不同
        // （foliagesway g_Speed：vert material=speed 默认 1 / frag=speeduv 默认 5），
        // GL 链接器同名合一位置 → 喂值必须按片元语义（视觉数学所在）。
        res.end(JSON.stringify({ effect: shaderRef, engine: SCENE_GL_ENGINE, vert, frag, combos, uniforms, uniformsFrag: metaF.uniforms, textures }));
      } catch (err) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
      }
    },
  }));

  // 3e. Scene MP4 video: extract the scene's embedded animation and serve it as
  //     a hardware-decodable <video> source. Cached like scene-frame. Scenes
  //     without an embedded video answer 404 so the client falls back to the
  //     static frame. This is the smooth, non-freezing path for scene
  //     wallpapers (avoids a live WebGL context per scene).
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
        // P-14: sv2 — 管线版本入键 (v2 = 顶层 box 截断 + ftyp/moov 内容校验),
        // 旧 sv1 缓存可能存了带 .tex 尾残留或无 moov 的坏 mp4, 换键一次性失效;
        // mtime 失效键同 P-12 走 sceneCacheStamp (全精度 + 松散场景引用文件)。
        const key = 'sv2_' + Buffer.from(abs, 'utf8').toString('base64url') + '_' + sceneCacheStamp(abs);
        const mp4Path = join(ensureFrameCacheDir(), key + '.mp4');
        if (!existsSync(mp4Path)) {
          // in-flight 去重：同一 key 的并发请求共享一次提取 + 一次缓存写入
          // （与 SCENE_FRAME_INFLIGHT 同型）。
          let inflight = SCENE_VIDEO_INFLIGHT.get(key);
          if (!inflight) {
            inflight = (async () => {
              // 异步读盘：scene.pkg 可达几十 MB，readFileSync 会阻塞事件循环。
              const bytes = abs.toLowerCase().endsWith('.json')
                ? extractSceneVideoFromDir(dirname(abs))
                : extractSceneVideo(new Uint8Array(await readFile(abs)));
              if (!bytes || bytes.length === 0) return null;
              // H-14: extractSceneVideoVia 按 ftyp 切到 .tex 尾、不按 box size
              // 截断 → 宿主侧把顶层 box 链之后的残留裁掉 (scene-manifest.js 不
              // 在本次修复范围, 此处补偿)。
              const mp4 = trimMp4ByTopBoxes(Buffer.from(bytes));
              // P-14: 写缓存前内容校验 (ftyp + moov, probeMp4 同款判据) —
              // 不合格的"视频"不落缓存, 404 让客户端走静态帧回退。
              if (!mp4LooksValid(mp4)) return null;
              // 异步原子发布（.tmp+rename）：写入中途崩溃不留半截缓存文件。
              await atomicWriteFileP(mp4Path, mp4);
              // P-10/N-05: sv2_* 产物落盘后按字节预算清一次
              gcFrameCacheSync(dirname(mp4Path), mp4Path);
              return mp4Path;
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

  // 4. Custom upload (raw body; MIME whitelist; writes into the uploads dir).
  //    Returns the new wallpaper entry so the client can refresh the inventory.
  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/upload`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'POST') {
        res.statusCode = 405; res.end('method not allowed'); return;
      }
      const query = new URL(req.url || '/', 'http://x').searchParams;
      const title = (query.get('title') || '').trim().slice(0, 80);
      const ctype = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const ext = UPLOAD_EXT[ctype];
      if (!ext) {
        res.statusCode = 415;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({
          error: '不支持的格式：' + ctype + '（仅支持 JPG / PNG / MP4）',
        }));
        return;
      }
      // 流式落盘：边收边写 .tmp 文件、边更新 sha256，完成后 rename 发布 —
      // 不再把最多 512MB 的文件整个缓冲在内存里。.tmp 在同目录，rename 为
      // 同设备原子操作；失败路径（超限/超时/写错误）由 ws 'close' 清理临时文件。
      const dir = ensureUploadDir();
      const id = 'up-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      const fileAbs = join(dir, id + '.' + ext);
      const tmpAbs = fileAbs + '.tmp';
      const hash = createHash('sha256');
      const ws = createWriteStream(tmpAbs);
      let size = 0;
      let failed = false;
      const cleanupTmp = () => { try { unlinkSync(tmpAbs); } catch { /* ignore */ } };
      const fail = (code, payload) => {
        if (failed) return;
        failed = true;
        try { ws.destroy(); } catch { /* ignore */ } // 'close' 里 cleanupTmp
        res.statusCode = code;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(payload));
        try { req.destroy(); } catch { /* ignore */ }
      };
      ws.on('error', () => fail(500, { error: 'upload write failed' }));
      ws.on('close', () => { if (failed) cleanupTmp(); });
      // 60s 无数据即超时（见 armBodyIdleTimeout）。
      armBodyIdleTimeout(req, () => fail(408, { error: 'request timeout' }));
      req.on('data', (c) => {
        if (failed) return;
        size += c.length;
        if (size > UPLOAD_MAX_BYTES) {
          fail(413, { error: '文件过大（上限 512MB）' });
          return;
        }
        hash.update(c);
        // 背压：写流缓冲满时暂停读取，drain 后恢复。
        if (!ws.write(c)) req.pause();
      });
      ws.on('drain', () => { if (!failed) req.resume(); });
      req.on('end', () => {
        if (failed) return;
        ws.end(() => {
          try {
            const sha = hash.digest('hex');
            // Content dedup: uploading the SAME file again must not create a
            // duplicate entry — return the existing wallpaper instead. meta
            // stores each upload's sha256; legacy entries without a hash never
            // match, so pre-existing uploads are unaffected.
            const meta = readUploadMeta();
            let dupId = null;
            for (const metaId of Object.keys(meta)) {
              if (metaEntry(meta, metaId).sha256 === sha) { dupId = metaId; break; }
            }
            if (dupId) {
              const existing = resolveUploadFile(dir, dupId);
              if (existing && existsSync(existing)) {
                // 内容已存在：丢弃刚收的临时文件，返回既有条目。
                failed = true; // 让 ws 'close' 清掉临时文件
                const eext = existing.slice(existing.lastIndexOf('.') + 1).toLowerCase();
                const etype = eext === 'mp4' ? 'video' : 'image';
                const etitle = metaEntry(meta, dupId).title || dupId;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({
                  id: dupId,
                  title: etitle,
                  type: etype,
                  playable: true,
                  duplicate: true,
                  media: `${BASE}/media/${tokenFor(existing)}`,
                  preview: etype === 'image' ? `${BASE}/preview/${tokenFor(existing)}` : null,
                }));
                return;
              }
              // meta says the id exists but the file is gone — fall through and
              // store a fresh copy under a new id.
            }
            renameSync(tmpAbs, fileAbs);
            // meta 无条件写（即便无 title 也记 sha256）：否则重复上传同一文件
            // 时 dedup 比对不到哈希，内容去重形同虚设。
            setUploadMeta(id, title || id, sha);
            const type = ext === 'mp4' ? 'video' : 'image';
            const payload = {
              id,
              title: title || id,
              type,
              playable: true,
              media: `${BASE}/media/${tokenFor(fileAbs)}`,
              preview: type === 'image' ? `${BASE}/preview/${tokenFor(fileAbs)}` : null,
            };
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(payload));
          } catch (err) {
            failed = true; // 让 ws 'close' 清掉临时文件
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
          }
        });
      });
      req.on('error', () => {
        if (!failed) {
          failed = true;
          try { ws.destroy(); } catch { /* ignore */ } // 'close' 里 cleanupTmp
          res.statusCode = 400; res.end('request error');
        }
      });
    },
  }));

  // 5. Custom upload removal — ONLY files inside the uploads dir with an
  //    `up-…` id (path traversal is impossible: the id is host-generated and
  //    resolveUploadFile re-checks the normalized prefix).
  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/remove`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'POST') {
        res.statusCode = 405; res.end('method not allowed'); return;
      }
      let body = '';
      // 60s 无数据即超时（见 armBodyIdleTimeout）。
      let timedOut = false;
      armBodyIdleTimeout(req, () => {
        timedOut = true;
        res.statusCode = 408;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'request timeout' }));
      });
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        if (timedOut) return;
        let id = null;
        try { id = JSON.parse(body || '{}').id; } catch { /* ignore */ }
        const dir = ensureUploadDir();
        const abs = resolveUploadFile(dir, id);
        if (!abs) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'invalid upload id' }));
          return;
        }
        let removed = false;
        try { unlinkSync(abs); removed = true; } catch { /* ignore */ }
        removeUploadMeta(id);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ removed }));
      });
      req.on('error', () => { res.statusCode = 400; res.end('request error'); });
    },
  }));

  // 6. Change the upload directory (persisted to config.json; survives
  //    restarts without env setup). Existing uploads migrate to the new
  //    location by default. The user enters an absolute path in the settings
  //    UI — most users prefer their data off the system (C:) drive.
  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/upload-dir`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'POST') {
        res.statusCode = 405; res.end('method not allowed'); return;
      }
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let dirRaw = null;
        let migrate = true;
        try {
          const o = JSON.parse(body || '{}');
          dirRaw = o.dir;
          migrate = o.migrate !== false;
        } catch { /* ignore */ }
        const dir = normalizeUserDir(dirRaw);
        if (!dir) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({
            error: '请输入有效的绝对路径（如 D:\\MyWallpapers 或 /data/wallpapers）',
          }));
          return;
        }
        // The path must resolve to a directory (mkdir when missing; reject a
        // path that exists as a FILE).
        try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
        let isDir = false;
        try { isDir = statSync(dir).isDirectory(); } catch { /* ignore */ }
        if (!isDir) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: '无法在该路径创建目录（权限不足或路径被占用）' }));
          return;
        }
        // setUploadDir 现在是异步的（迁移走线程池 + 写串行化）。
        setUploadDir(dir, migrate).then(
          (result) => {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(result));
          },
          (err) => {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
          },
        );
      });
      req.on('error', () => { res.statusCode = 400; res.end('request error'); });
    },
  }));

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
        json(200, { settings: readSettings(), betterSidebar: isBetterSidebarLoaded(ctx) });
        return;
      }
      if (method !== 'PUT') {
        res.statusCode = 405; res.end('method not allowed'); return;
      }
      let body = '';
      let tooLarge = false;
      // 60s 无数据即超时（见 armBodyIdleTimeout）。
      armBodyIdleTimeout(req, () => {
        if (tooLarge) return;
        tooLarge = true;
        json(408, { error: 'request timeout' });
      });
      req.on('data', (c) => {
        if (tooLarge) return;
        body += c;
        if (body.length > SETTINGS_MAX_BYTES) {
          tooLarge = true;
          json(413, { error: 'settings payload too large' });
          req.destroy();
        }
      });
      req.on('end', () => {
        if (tooLarge) return;
        let parsed;
        try { parsed = JSON.parse(body || '{}'); } catch {
          json(400, { error: 'invalid JSON body' }); return;
        }
        const sanitized = sanitizeSettings(parsed);
        if (!sanitized) {
          json(400, { error: 'settings must be a JSON object' }); return;
        }
        // 写已串行化（enqueueConfigWrite），等写盘完成再应答，保持原有
        // 「响应即已持久化」的语义。
        writeSettings(sanitized).then(
          () => json(200, { ok: true, settings: sanitized }),
          (err) => json(500, { error: String(err && err.message ? err.message : err) }),
        );
      });
      req.on('error', () => { if (!tooLarge) json(400, { error: 'request error' }); });
    },
  }));

  return () => {
    for (const d of disposers) { try { d(); } catch { /* ignore */ } }
    // 杀掉所有在途 ffmpeg 子进程：插件卸载 / HMR 后宿主再无权管理它们，
    // 不杀就是孤儿进程继续吃 CPU/GPU（detached 模式下尤甚）。它们写一半
    // 的 .tmp<pid> 输出留给下次 apply 的 sweepTranscodeArtifacts 清理。
    for (const proc of ACTIVE_FFMPEG) {
      try { proc.kill(); } catch { /* ignore */ }
    }
    ACTIVE_FFMPEG.clear();
    // P0-4②/N-02: 终止全部在途渲染 worker — scene-anim 各任务有自己的
    // cancel 链 (上方 _sceneAnimInflight disposer), scene-frame 路径靠本
    // 注册表兜底; 不终止则卸载后孤儿线程继续光栅化吃 CPU。
    for (const w of ACTIVE_SCENE_WORKERS) {
      try { w.terminate(); } catch { /* ignore */ }
    }
    ACTIVE_SCENE_WORKERS.clear();
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
// P0-3 自验/诊断用: 视频纹理帧抽取 (含 memoize 扫描) 需可被独立调用计时。
export { extractSceneVideoFrames };
