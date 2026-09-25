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
  appendFileSync,
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
import { join, resolve, normalize, basename, dirname, relative, isAbsolute, sep } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
// 壁纸媒体源（独立 loopback 监听）——见 ensureMediaOrigin 的说明。
import { createServer } from 'node:http';

// Scene wallpaper animation + live player (ported from dsh-web-ui's
// skin-center we-* modules). WE_SCENE_PLAYER_HTML is served by
// /wallpaper-engine/scene-runtime; the manifest/resource extractors feed it.
// They are separate modules so the existing static-frame path (pkg-extract.js)
// is never disturbed.
import { WE_SCENE_PLAYER_HTML } from './scene-player.js';
import { buildSceneManifest, buildSceneManifestFromDir,
         extractSceneResource, extractSceneResourceFromDir,
         extractSceneVideo, extractSceneVideoFromDir } from './scene-manifest.js';
import { readPkg } from './we-renderer/textures.js';
import { createMediaBackend } from './media/index.js';
// WE 用户属性（project.json general.properties）→ 面板描述 / 覆盖值合并。
// 语义细节见该文件头：order 浮点、combo 保类型、逐键本地化、condition 只影响 UI。
import { parseUserPropDefs, entryDirPrefix, filterKnownOverrides } from './we-props.js';

/** Steam appid for Wallpaper Engine. */
const WE_APPID = '431960';
/** Request path prefix under which this bundle's HTTP surface lives. */
const BASE = '/wallpaper-engine';
/** Vendored WebWallGL renderer page (built+copied by scripts/sync-webwallgl.mjs,
 *  with --base=/wallpaper-engine/scene-live/ so its asset refs resolve here). */
const WEBWALLGL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'webwallgl');

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
// 临时名带 pid + 进程内序号：同一目标文件的并发写入者不再共用同一个
// `<file>.tmp`（评审实测两路并发 PUT 会互相 rename/覆盖对方半截内容）。
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
/** 场景实时渲染 (WebWallGL) 帧率上限 options. Mirror of the client's list. */
const SCENE_LIVE_FPS_VALUES = [15, 30, 60];

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
// 场景包内独立音频（BGM/音效，WE 音频组件引用）：长安雪等场景无内嵌 MP4，
// 音轨以独立文件存放 —— scene-audio 路由此处抽出（取最大者当 BGM）。
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
    const { parsePkg } = await import('./pkg-extract.js');
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
          const { readPkgEntry } = await import('./pkg-extract.js');
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

// ── sceneVideo 字段的诚实来源: 「该 scene 主文件是否内嵌 MP4」探测缓存 ────────
// 旧实现 (buildInventory) 用 hasFrame (静态帧可用性) 冒充「内嵌视频」, 对几乎
// 100% 的 scene 壁纸都输出 sceneVideo URL → 客户端请求 /scene-video/<token>
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

/**
 * 为主线程的 scene 静态帧渲染预抽取视频纹理帧。
 * src: scene.pkg 文件 / 松散目录 / scene.json 文件路径。
 * 返回 Map<规范化纹理引用, PNG 路径>; 无视频或 ffmpeg 不可用返回空 Map。
 */
async function extractSceneVideoFrames(src, time, signal) {
  const map = new Map();
  const srcPath = String(src).toLowerCase().endsWith('.json') ? dirname(src) : src;
  let isDir = false;
  try { isDir = statSync(srcPath).isDirectory(); } catch { /* ignore */ }
  let access = null;
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
    const data = readFileSync(srcPath);
    const { parsePkg, readPkgEntry, extractTexVideoMp4 } = await import('./pkg-extract.js');
    const entries = parsePkg(data);
    access = {
      list: () => entries.map((e) => ({ path: e.path, read: () => readPkgEntry(data, e) })),
    };
  }
  // 视频来源: 独立媒体文件 + TEX 容器内嵌 MP4
  const videos = collectSceneVideoFiles(access);
  for (const e of access.list()) {
    if (!e.path.toLowerCase().endsWith('.tex')) continue;
    let b = null;
    try { b = e.read(); } catch { /* ignore */ }
    if (!b) continue;
    const mp4 = extractTexVideoMp4(b);
    if (mp4) videos.push({ ref: e.path, bytes: mp4 });
  }
  if (!videos.length) return map;
  let ff = null;
  try { ff = await resolveFfmpeg(null); } catch { return map; }
  if (!ff) return map;
  const outDir = ensureFrameCacheDir();
  const tKey = String(Math.round((Number(time) || 0) * 1000));
  for (let i = 0; i < videos.length; i++) {
    const v = videos[i];
    const extMatch = /(\.[^.]+)$/.exec(v.ref);
    const tmpVideo = join(tmpdir(), 'dsh-we-vid-' + process.pid + '-' + i + (extMatch ? extMatch[1] : '.mp4'));
    const hash = createHash('sha256').update(v.ref + '|' + v.bytes.length).digest('hex').slice(0, 16);
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
async function renderSceneFrameInWorker(src, width, height, time, opts = {}) {
  if (_weInstallDirCache === null) _weInstallDirCache = await locateWallpaperEngineP();
  const weAssetsDir = _weInstallDirCache || undefined;
  const signal = opts.signal || null;
  // 预抽取场景视频纹理静态帧 (ffmpeg) 传给 worker 替代视频引用。
  // 本仓只渲染**单帧** (scene-frame)：多帧动画 (times → APNG) 已随 beta 场景动画
  // 一并移除（见同批提交的说明）。
  let videoFrames = null;
  if (!(signal && signal.aborted)) {
    try {
      videoFrames = await extractSceneVideoFrames(src, time, signal);
    } catch { videoFrames = null; }
  }
  if (signal && signal.aborted) throw new Error('cancelled');
  return new Promise((resolve) => {
    let worker;
    try {
      worker = new Worker(new URL('./scene-render-worker.mjs', import.meta.url), {
        workerData: {
          src, width, height, time, weAssetsDir,
          videoFrames: videoFrames && videoFrames.size ? Object.fromEntries(videoFrames) : null,
        },
        type: 'module',
      });
    } catch (e) {
      resolve({ ok: false, error: String(e && e.message ? e.message : e) });
      return;
    }
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      try { worker.terminate(); } catch { /* ignore */ }
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
    // 大型场景 CPU 光栅化可能很慢, 给足超时
    const timer = setTimeout(() => finish({ ok: false, error: 'scene render timeout' }), 600000);
    worker.on('message', (msg) => {
      if (msg && msg.ok) {
        finish({ ok: true, png: Buffer.from(msg.png), diff: msg.diff, checked: msg.checked });
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
    videoVolume: clampNum(o.videoVolume, 0, 1, 0),
    videoAudioEnabled: o.videoAudioEnabled !== false,
    fpsCap: FPS_CAP_VALUES.includes(o.fpsCap) ? o.fpsCap : 0,
    // 场景实时渲染 (WebWallGL live WebGL): 默认开启, 失败由客户端自动降级。
    sceneLive: o.sceneLive !== false,
    sceneLiveFps: SCENE_LIVE_FPS_VALUES.includes(o.sceneLiveFps) ? o.sceneLiveFps : 30,
    // live 渲染的启动延迟（秒）：重启恢复上次壁纸时先显示占位图（静态帧 / 自动
    // 首帧 / 主题色），延迟到点再挂渲染 iframe —— 避免大场景包与 DSH 首屏抢主线程。
    liveBootDelay: clampNum(o.liveBootDelay, 0, 30, 3),
    // 系统音频反应（频谱）：auto = 有采集能力就用（macOS 需一次性授权），off = 关闭
    // （渲染页回落内置模拟源）。依赖缺失/未授权时自动回落，不影响壁纸。
    audioSource: o.audioSource === 'off' ? 'off' : 'auto',
    // 媒体集成（Now Playing：歌名/歌手/专辑/封面 → 壁纸的 wallpaperMediaIntegration）
    mediaIntegration: o.mediaIntegration !== false,
    // 在线歌词（LRCLIB）：默认**关** —— 它是一次外发请求（把曲名/歌手/专辑发给
    // lrclib.net），与插件「不上传任何服务器」的口径一致才默认关；音频同目录的
    // .lrc 与本地缓存歌词不受这个开关影响，照常供数。
    mediaLyricsOnline: o.mediaLyricsOnline === true,
    // 用户改过的壁纸属性（「壁纸属性」面板）：{ [token]: { [属性名]: 值 } }。
    // token = base64(入口文件绝对路径)，与 /props /scene-files 同一套（目录改名
    // 就自然失效，不会张冠李戴）；只收标量值 —— 属性值在 WE 里就是
    // 字符串/数字/布尔，收对象只可能来自被篡改的请求。
    userProps: (o.userProps && typeof o.userProps === 'object' && !Array.isArray(o.userProps))
      ? Object.fromEntries(Object.entries(o.userProps)
          .filter(([k, v]) => typeof k === 'string' && k && v && typeof v === 'object' && !Array.isArray(v))
          .map(([k, v]) => [k, Object.fromEntries(Object.entries(v)
            .filter(([n, val]) => typeof n === 'string' && n
              && (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean'))
            // 值可能是颜色三元组字符串 / 滑块数字 / 布尔；字符串长度设上限防止
            // 设置文件被灌爆（属性值实际都很短）。
            .map(([n, val]) => [n, typeof val === 'string' ? val.slice(0, 2000) : val]))]))
      : {},
    // 按壁纸的实时渲染失败记忆 { [wallpaperId]: true }（客户端 heartbeat 写入,
    // 重开 sceneLive 开关时清空）。必须进白名单, 否则 PUT 上来即被丢弃、
    // 刷新/重启后记忆丢失（踩坑回归：client 侧 sanitize 有、host 侧漏加）。
    sceneLiveFailures: (o.sceneLiveFailures && typeof o.sceneLiveFailures === 'object'
      && !Array.isArray(o.sceneLiveFailures))
      ? Object.fromEntries(Object.entries(o.sceneLiveFailures)
          // 值是失败原因（'timeout' / 'stall'，客户端展示用）；兼容旧的 true。
          .filter(([k, v]) => typeof k === 'string' && k
            && (v === true || v === 'timeout' || v === 'stall')))
      : {},
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
    // Wallpaper layer opacity (%, 0 = untouched; #82) + input caret color
    // ('' = follow native; #83). Mirror of src/client.js sanitizeSettings.
    wallpaperOpacity: clampNum(o.wallpaperOpacity, 0, 90, 0),
    // 切换过场（手动点选 / 自动轮播共用）：类型 + 方向 + 速度档。
    // ⚠️ 白名单必须与 src/client.js 的 SWITCH_TRANSITION_VALUES / SWITCH_DIRS /
    // SWITCH_SPEED_VALUES 一字不差 —— 这里漏一个键，客户端的设置就会被静默丢弃
    // （#106 那类漂移 bug 的成因）。verify-client 有一条键集对照断言钉死这一点。
    switchTransition: ['cut', 'fade', 'push', 'wipe', 'iris', 'zoom', 'bars'].includes(o.switchTransition)
      ? o.switchTransition : 'cut',
    switchTransitionDir: ['left', 'right', 'up', 'down'].includes(o.switchTransitionDir)
      ? o.switchTransitionDir : 'left',
    switchTransitionSpeed: ['fast', 'normal', 'slow'].includes(o.switchTransitionSpeed)
      ? o.switchTransitionSpeed : 'normal',
    caretColor: typeof o.caretColor === 'string' && /^#[0-9a-f]{6}$/i.test(o.caretColor)
      ? o.caretColor : '',
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
  const dirs = [transcodeCacheDir(), ffmpegDataDir(), videoPreviewCacheDir()];
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
    // 监听器无条件挂一次 (旧实现 signal.aborted 为真时直接 return): abort 已在
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
        // 非 Windows 必须给真实存在的目录 — 旧实现回退 'C:\\' 在 Linux/macOS
        // 上不存在 → spawn ENOENT → ffmpeg 永远启动失败 (跨平台 bug, 2026-08-30 修复)。
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
      // 结束整个尝试链 (不再 spawn 第二次), 避免切换壁纸后它继续编码到超时。
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
 * 渲染页静默回落程序化复刻，行为与此前完全一致。
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

/**
 * 静态帧缓存键：`<逻辑版本>_<入口绝对路径 base64url>_<mtime>`。
 *
 * **只能有一处实现**：prewarm（后台预热）与 /scene-frame 路由各写一份的话，版本号
 * 一改就会一边写一边读不着 —— 实测升 sf34（裁图集黑边）时漏改 prewarm，预热出来的
 * 帧永远不会被服务，白烧 CPU。改动生成逻辑时改这个版本号即可（旧帧自动失效重建）。
 */
const SCENE_FRAME_KEY_VERSION = 'sf34';
function sceneFrameCacheKey(abs, mtime) {
  return SCENE_FRAME_KEY_VERSION + '_' + Buffer.from(abs, 'utf8').toString('base64url') + '_' + Math.round(mtime);
}

// Scene frame 提取的 in-flight 去重：同一缓存键的并发请求共享一次提取
// （scene.pkg 可能几十 MB，读盘 + 解码很贵；客户端列表页会同时请求多帧，
//  同一张帧在滚动刷新时也可能并发命中）。
const SCENE_FRAME_INFLIGHT = new Map();

// scene-frame 缓存槽位解析（GET / HEAD / GPU 回填 PUT 共用）：key =
// sf33_<base64url(abs)>_<mtime>(_vN)。CPU 提取/预览帧存 <key>.png|.jpg|.gif；
// GPU 抓帧存独立的 <key>_gpu.png —— 文件名即标记：存在 = 该槽已被 live
// 渲染抓帧覆盖（拒绝重复写，缓存唯一），且可直接双击打开查看。
function sceneFrameSlot(abs, variant) {
  let mtime = 0;
  try { mtime = statSync(abs).mtimeMs; } catch { /* keep 0 */ }
  // 键必须与 sceneFrameCacheKey 同源（同一个 SCENE_FRAME_KEY_VERSION）——
  // 两处各自写字面量时，升键只改一处就会让提取产物与读取路径错位。
  const key = SCENE_FRAME_KEY_VERSION + '_' + Buffer.from(abs, 'utf8').toString('base64url') + '_' + Math.round(mtime)
    + (variant ? '_v' + variant : '');
  const dir = ensureFrameCacheDir();
  return {
    key,
    dir,
    pngPath: join(dir, key + '.png'),
    jpgPath: join(dir, key + '.jpg'),
    gifPath: join(dir, key + '.gif'),
    gpuPath: join(dir, key + '_gpu.png'),
  };
}
// 服务优先级：GPU 抓帧 > CPU 提取/预览帧（GPU 帧存在即胜出，CPU 帧保留作
// 对照但不再上屏）。
function sceneFrameSlotFile(slot) {
  return existsSync(slot.gpuPath) ? slot.gpuPath
    : existsSync(slot.pngPath) ? slot.pngPath
      : existsSync(slot.jpgPath) ? slot.jpgPath
        : existsSync(slot.gifPath) ? slot.gifPath : null;
}
// GPU 抓帧全局优先（档 0–3 通吃）：_gpu.png 是真实渲染帧，优于任何 CPU
// 提取变体 —— 用户给某壁纸选过画面效果档位（v1–3）时也服务档 0 的 GPU 帧；
// 档 4 = 用户自定义封面（显式选择）不受影响，返回 null。
function gpuFrameFileFor(abs, variant, slot) {
  if (variant > 3) return null;
  const gpuSlot = variant === 0 ? slot : sceneFrameSlot(abs, 0);
  return existsSync(gpuSlot.gpuPath) ? gpuSlot.gpuPath : null;
}
// GPU 抓帧回填载荷上限（4K PNG 一般数 MB，32MB 余量充足）。
const GPU_FRAME_MAX_BYTES = 32 * 1024 * 1024;
// 最小结构校验：只认 8 字节魔数会让「9 字节假 PNG」永久占槽（评审实测 PUT
// 200 落盘、浏览器解不出、之后恒 409），因此额外要求长度下限 + IHDR + IEND。
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
// 并发 PUT 会双双通过（评审真 socket 复现：两个 24MB PUT 都返回 200）。
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
// preview file, so the picker used to show the "无预览" placeholder. Extract
// one frame lazily — only when the browser actually requests the thumbnail —
// through the same ffmpeg provisioning the Scene static-frame path uses.
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
// transcodeCacheDir 的 tc_*.mp4 每个 80–280MB, 而旧实现从不淘汰 → 长期使用后
// 无上限增长 (几十 GB)。启动后扫一次, 超上限就按 mtime 从最旧开始删到上限以内。
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
 */
function appendDiagLine(kind, obj) {
  try {
    const dir = join(dirname(configPath()), 'diag');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'http.jsonl'), JSON.stringify({ t: Date.now(), kind, ...obj }) + '\n');
  } catch { /* 诊断失败不影响服务 */ }
}

/**
 * 请求记录（含成功的 200）：同 route+path 十秒内只记一条，避免刷屏。
 *
 * 为什么连 200 也要记：排查「画面黑但服务端无任何 4xx」时，唯一的判据是
 * **某个请求到底有没有发生**（例如壁纸入口是否真被 iframe 请求过）——
 * 只看错误码会把「没请求」与「请求成功」混为一谈。
 */
const reqLogSeen = new Map();
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
    const last = reqLogSeen.get(key);
    if (last && now - last < 10000) return;
    reqLogSeen.set(key, now);
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

// 场景帧预热逻辑版本：pkg-extract 合成语义变更时自增（作废预热状态记忆，
// 全库重新比对）。与 scene-frame 缓存键前缀解耦 —— 预热不改键。
// 预热签名：改生成逻辑就追加后缀（这里加 -crop = 裁图集黑边），预热会对
// 所有场景重跑一遍。
const SCENE_PREWARM_LOGIC = 'sf33-prewarm-yfix-filter-v4-puppetquad-crop';
let _scenePrewarmStarted = false;
async function sceneFramePrewarm() {
  if (_scenePrewarmStarted) return;
  _scenePrewarmStarted = true;
  const installDir = await locateWallpaperEngineP();
  const libraryDirs = await owningLibrariesP();
  const all = await enumerateWallpapersAsync(installDir, libraryDirs);
  const scenes = all.filter((w) => w.type === 'scene' && w.fileAbs);
  const dir = ensureFrameCacheDir();
  const statePath = join(dir, 'prewarm-state.json');
  let state = {};
  try { state = JSON.parse(readFileSync(statePath, 'utf8')) || {}; } catch { /* 首次运行 */ }
  const { extractSceneMainImage, extractSceneMainImageFromDir } = await import('./pkg-extract.js');
  let touched = 0;
  for (const w of scenes) {
    let mtime = 0;
    try { mtime = statSync(w.fileAbs).mtimeMs; } catch { continue; }
    const sig = SCENE_PREWARM_LOGIC + ':' + Math.round(mtime);
    if (state[w.fileAbs] === sig) continue;
    const key = sceneFrameCacheKey(w.fileAbs, mtime);
    const pngPath = join(dir, key + '.png');
    const jpgPath = join(dir, key + '.jpg');
    try {
      const frame = w.fileAbs.toLowerCase().endsWith('.json')
        ? extractSceneMainImageFromDir(dirname(w.fileAbs))
        : extractSceneMainImage(new Uint8Array(await readFile(w.fileAbs)));
      const target = frame.mime === 'image/jpeg' ? jpgPath : pngPath;
      const other = target === pngPath ? jpgPath : pngPath;
      let same = false;
      if (existsSync(target)) {
        const cur = await readFile(target);
        const next = Buffer.from(frame.bytes);
        same = cur.length === next.length && cur.equals(next);
      }
      if (!same) {
        await atomicWriteFileP(target, frame.bytes);
        if (existsSync(other)) { try { unlinkSync(other); } catch { /* ignore */ } }
      }
      state[w.fileAbs] = sig;
      touched++;
      if (touched % 15 === 0) { try { writeFileSync(statePath, JSON.stringify(state)); } catch { /* ignore */ } }
    } catch {
      // 提取失败（无合格主纹理等）→ 不动现有缓存、不记 sig，下次启动重试
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  try { writeFileSync(statePath, JSON.stringify(state)); } catch { /* ignore */ }
}

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

  // Startup sweep: a previous host process may have died mid-transcode or
  // mid-download (the detached ffmpeg child keeps writing after its parent is
  // killed by a restart/HMR), orphaning .tmp outputs, .prog progress files,
  // .part downloads and ffmpeg-err logs. Nothing of THIS process can be
  // mid-flight at startup, so all stale artifacts are removed in one pass.
  // 缓存清扫/裁剪推迟到插件加载完成之后：两者都是同步遍历缓存目录，在 apply()
  // 里直接跑会阻塞插件树加载、拖长整个 profile 的启动时间（用户实测反馈）。
  const startupSweepTimer = setTimeout(() => {
    try { sweepTranscodeArtifacts(); } catch { /* ignore */ }
    try { pruneVideoPreviewCache(); } catch { /* ignore */ }
    // 大文件缓存同样要有上限 (见 pruneCacheDirBySize): transcode 输出
    // (tc_*.mp4, 每个 80–280MB) 旧实现从不淘汰 → 按 mtime-LRU 收敛到上限以内。
    // 只匹配真正的转码产物, 不碰同名的 .loop / .prog / .tmp 附属文件。
    try { pruneCacheDirBySize(transcodeCacheDir(), TRANSCODE_CACHE_MAX_BYTES, /^tc_.*\.mp4$/); } catch { /* ignore */ }
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
   * Scene-shaped derived fields for ONE wallpaper entry: static frame, the
   * legacy scene-runtime player, the WebWallGL live-render capability, the
   * embedded MP4 / packaged audio extractors, and the 自定义画面 memory.
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
    // 未知 (无缓存项) → null 并投递后台探测, 绝不猜 —— 旧实现用 hasFrame
    // 冒充「内嵌视频」, 客户端请求必然 404 (字段在说谎)。
    const svKey = isScene ? sceneVideoProbeKey(w.fileAbs, sceneMtime) : null;
    const svKnown = svKey === null ? undefined : sceneVideoProbeGet(svKey);
    if (svKey !== null && svKnown === undefined) scheduleSceneVideoProbe(w.fileAbs, svKey);
    return {
      sceneUrl: isScene ? `${BASE}/scene-runtime/${tokenFor(w.fileAbs)}` : null,
      sceneLive: isPkg,
      sceneLiveSrc: isPkg ? tokenFor(w.fileAbs) : null,
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
      // 三次存在性探测并发（原本串行，慢盘上是 3× 延迟）。
      const [hasMedia, hasPreview, sceneMtime] = await Promise.all([
        w.type === 'video' || w.type === 'web' ? pathExistsP(w.fileAbs) : Promise.resolve(false),
        w.previewAbs ? pathExistsP(w.previewAbs) : Promise.resolve(false),
        // Scenes: fileAbs points at the resolved scene main file (scene.pkg /
        // scene.json); frameUrl serves its extracted static frame.
        // 改用 stat 取 mtime：与原来的 access 同为一次异步探测（不增加 I/O），
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
        preview: hasPreview ? `${BASE}/preview/${tokenFor(w.previewAbs)}` : null,
        frameUrl: hasFrame ? `${BASE}/scene-frame/${tokenFor(w.fileAbs)}` : null,
        // 加载期占位底色（主题色）：尚无抽帧图时的兜底，避免一上来就是黑屏。
        schemeColor: w.schemeColor || null,
        // Scene fields — legacy scene-runtime player, WebWallGL live render,
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
    const payload = {
      installDir,
      uploadDir: UPLOAD_DIR,
      // WE 官方素材（local-assets）：客户端据此决定 scene-live URL 是否带
      // localAssets=1，并在设置面板展示配置状态。
      weAssetsDir: WE_ASSETS_DIR,
      weAssetsAvailable: weAssetsAvailable(),
      total: wallpapers.length,
      portableCount: wallpapers.filter((w) => w.playable).length,
      wallpapers,
      playlists,
    };
    inventoryCache = { t: Date.now(), payload };
    return payload;
  }

  const disposers = [];
  disposers.push(() => { try { clearTimeout(startupSweepTimer); } catch { /* ignore */ } });

  // ── 场景静态帧后台预热（方案一，2026-09-20 用户确认）───────────────────
  // 合成器修复（y-up 坐标翻转 + 层过滤放宽）只影响「重新生成」的帧：缓存键
  // 保持 sf33 不升版 —— 已缓存壁纸点开零等待、显示不变。启动空闲后串行重
  // 提取全库场景帧，与磁盘现有帧逐字节比对，不同才原子替换；提取失败绝不动
  // 现有缓存（不冒充成功）。单图层场景产物与旧帧一致 → 不替换；多层场景
  // 静默替换为几何/层数修复版。状态落盘 prewarm-state.json，同一逻辑版本
  // + 同一 mtime 的壁纸后续启动直接跳过。
  // 顺延到 2 分钟：启动后立刻重提取全库静态帧会与首屏/壁纸加载抢 CPU（用户实测
  // 反馈启动变慢），推迟到用户大概率已经进入使用状态之后。
  const prewarmTimer = setTimeout(() => {
    sceneFramePrewarm().catch(() => { /* 预热失败不影响正常功能 */ });
  }, 120000);
  disposers.push(() => { try { clearTimeout(prewarmTimer); } catch { /* ignore */ } });

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
      // 错误响应绝不能被宿主缓存：Electron 若缓存过 404 页，之后即使文件到位也会
      // 一直显示缓存的错误页（实测症状：服务端看不到请求、画面却是旧的错误文本）。
      res.setHeader('Cache-Control', 'no-store');
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
        serveFile(mediaMap.get(token), req, res, method === 'HEAD');
      },
    }));
  }

  // 3a. On-demand thumbnail for a custom-uploaded video (see
  // generateVideoPreview). MP4 uploads have no preview file, so this extracts
  // one frame with the same lazy ffmpeg chain the Scene static-frame path
  // uses; while ffmpeg is unavailable the route answers 4xx and the client
  // keeps its "无预览" placeholder.
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
      if (method !== 'GET' && method !== 'HEAD') {
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
      // 壁纸画面刷新档位（?v=1..3）：不同档 = 不同生成逻辑 → 缓存键加 _vN
      // 后缀，各档互不覆盖；档 0/无参数沿用原键（既有帧零作废）。
      const vRaw = Number(new URL(req.url || '/', 'http://x').searchParams.get('v') || 0);
      const variant = Number.isFinite(vRaw) && vRaw >= 1 && vRaw <= 4 ? Math.floor(vRaw) : 0;
      // HEAD：纯磁盘探测（绝不触发提取）—— GPU 抓帧回填的客户端按它决定
      // 要不要抓帧：204 + X-WE-GPU 标记槽位状态（1=已有 GPU 帧，0=CPU/预览帧），
      // 404 = 空槽。已有 GPU 帧时附带 X-WE-GPU-W/H/AR（抓帧几何，读 PNG 头，
      // 见 pngSizeOf）：客户端据此判断该帧是否还是当前视口的构图。
      if (method === 'HEAD') {
        const slot = sceneFrameSlot(abs, variant);
        const gpuFile = gpuFrameFileFor(abs, variant, slot);
        const file = gpuFile || sceneFrameSlotFile(slot);
        if (!file) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'no-frame' }));
          return;
        }
        res.statusCode = 204;
        res.setHeader('X-WE-GPU', gpuFile ? '1' : '0');
        if (gpuFile) {
          // 抓帧几何（见 pngSizeOf）：客户端按它判断这张帧还是不是**当前视口**
          // 的构图 —— 不是就清掉按当前视口重抓（否则别的窗口/旧会话留下的帧会
          // 一直被 CSS cover 再裁一次，画面放大且四周被切）。
          const dim = pngSizeOf(gpuFile);
          if (dim) {
            res.setHeader('X-WE-GPU-W', String(dim.width));
            res.setHeader('X-WE-GPU-H', String(dim.height));
            res.setHeader('X-WE-GPU-AR', (dim.width / dim.height).toFixed(4));
          }
        }
        res.end();
        return;
      }
      (async () => {
        // Cache key version: bump when the extraction pipeline changes so
        // frames produced by older (buggy) logic are re-extracted instead of
        // served stale from disk. sf33 = 静态帧效果全分辨率 (不降采样) +
        // scene-frame 渲染尺寸按场景 ortho (非 16:9 壁纸不再裁切)。
        // 键含 SCENE_FRAME_KEY_VERSION：改生成逻辑（如裁图集黑边）时升版本即可，
        // 旧帧自动失效重建。
        const slot = sceneFrameSlot(abs, variant);
        const key = slot.key;
        const pngPath = slot.pngPath;
        const jpgPath = slot.jpgPath;
        const gifPath = slot.gifPath;
        // GPU 抓帧优先于 CPU 提取帧：有 _gpu.png 就上屏，CPU 帧留作对照。
        let servePath = gpuFrameFileFor(abs, variant, slot) || sceneFrameSlotFile(slot);
        if (!servePath) {
          // in-flight 去重：同一 key 的并发请求共享一次提取 + 一次缓存写入。
          let inflight = SCENE_FRAME_INFLIGHT.get(key);
          if (!inflight) {
            inflight = (async () => {
              // 档 4=自定义画面：用户导入的截屏（overrides/<id>.*），直接服务
              // 原文件（分辨率=截图分辨率；不存在时 422，客户端回退预览）。
              if (variant === 4) {
                const p = customFramePath(customIdFromAbs(abs));
                if (!p) throw new Error('no-custom-frame');
                return p;
              }
              // 档 3=预览图：直接取 workshop 项目同目录的 preview 文件（作者
              // 原版预览；jpg/png/gif 均可作 <img> 源）。
              if (variant === 3) {
                const dirAbs = dirname(abs);
                for (const fn of ['preview.jpg', 'preview.png', 'preview.gif']) {
                  const p = join(dirAbs, fn);
                  if (existsSync(p)) {
                    const target = fn.endsWith('.jpg') ? jpgPath : fn.endsWith('.gif') ? gifPath : pngPath;
                    await atomicWriteFileP(target, await readFile(p));
                    return target;
                  }
                }
                throw new Error('no-preview');
              }
              const { extractSceneMainImage, extractSceneMainImageFromDir } = await import('./pkg-extract.js');
              // 提取优先（2026-09-20，用户确认后实施）：scene-frame 不再先试
              // SceneRenderer worker。0.7.x 的 worker-first 让每张无缓存壁纸
              // 先陪跑 CPU 渲染（超时上限 600s/帧），且渲染器可能「成功」输出
              // 劣质小帧、绕过空帧门禁被写进缓存（无缓存场景实测 3.7s/33KB，
              // 8.3MP 正常帧应为数 MB）。主纹理提取本路径实测 0.05–1.3s，即
              // 0.7.3 用户认可的静态帧语义。
              // 异步读盘：scene.pkg 可达几十 MB，readFileSync 会阻塞事件循环。
              const frame = abs.toLowerCase().endsWith('.json')
                ? extractSceneMainImageFromDir(dirname(abs), variant)
                : extractSceneMainImage(new Uint8Array(await readFile(abs)), variant);
              const target = frame.mime === 'image/jpeg' ? jpgPath : pngPath;
              // 首写胜出：提取期间 live GPU 抓帧可能已回填该槽（PUT
              // /scene-frame-cache）→ 丢弃本次提取产物，直接服务槽内文件。
              const occupied = sceneFrameSlotFile(slot);
              if (occupied) return occupied;
              // 异步原子发布（.tmp+rename）：写入中途崩溃不留半截缓存文件。
              await atomicWriteFileP(target, frame.bytes);
              return target;
            })();
            SCENE_FRAME_INFLIGHT.set(key, inflight);
            // 无论成败都摘除（失败允许后续请求重试）。
            inflight.then(
              () => SCENE_FRAME_INFLIGHT.delete(key),
              () => SCENE_FRAME_INFLIGHT.delete(key),
            );
          }
          servePath = await inflight;
        }
        res.setHeader('Content-Type', servePath.endsWith('.jpg') ? 'image/jpeg'
          : servePath.endsWith('.gif') ? 'image/gif'
            : servePath.endsWith('.webp') ? 'image/webp' : 'image/png');
        res.setHeader('Cache-Control', 'no-store');
        trackStream(createReadStream(servePath), res);
      })().catch((err) => {
        res.statusCode = 422;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
      });
    },
  }));

  // 3a-gpu. Live GPU 抓帧回填：PUT /scene-frame-cache/<token> —— live 渲染页
  //     首帧确认后由客户端抓渲染 canvas（preserveDrawingBuffer:true，父页面同源
  //     直读，无需渲染页配合）写回静态帧缓存。GPU 帧存独立的 <key>_gpu.png
  //     （文件名即标记，可直接打开查看）；serve 优先级高于 CPU 提取帧。
  //     缓存唯一性：_gpu.png 已存在 → 409（每壁纸一份，不反复生成），写入在
  //     同 key 临界区内串行（并发 PUT 不会双双通过）。
  //     清除通道：DELETE（或 POST ?clear=1）删掉 _gpu.png —— 抓到黑帧/想要
  //     重新抓取时的唯一出路，删后 HEAD 回到 X-WE-GPU=0、PUT 可再写一次。
  //     token 白名单 = mediaMap，与 scene-frame 同一缓存键（档 0）。
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/scene-frame-cache`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      const url = new URL(req.url || '/', 'http://x');
      const json = (code, payload) => {
        res.statusCode = code;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(payload));
      };
      let token = '';
      try {
        token = decodeURIComponent(url.pathname.slice(`${BASE}/scene-frame-cache/`.length));
      } catch {
        json(404, { error: 'unknown-token' }); return;
      }
      // DELETE 与 POST ?clear=1 等价（POST 是框架确定放行的方法，DELETE 实测
      // 前缀路由同样可达；两者都提供，避免依赖单一方法的可达性）。
      const wantsClear = method === 'DELETE' || (method === 'POST' && url.searchParams.get('clear') === '1');
      if (wantsClear) {
        const abs = mediaMap.get(token);
        if (!abs) { json(404, { error: 'unknown-token' }); return; }
        const slot = sceneFrameSlot(abs, 0);
        let removed = false;
        try { unlinkSync(slot.gpuPath); removed = true; }
        catch (e) {
          // ENOENT = 本来就没有（幂等成功）；EACCES/EBUSY/EPERM 等 = **真的没删掉**，
          // 必须报错：否则客户端把「清除」当成功（面板行消失、提示已清除），而宿主
          // 照旧发 GPU 帧 —— 画面纹丝不动且没有任何反馈（评审 P2-L）。
          if (!e || e.code !== 'ENOENT') {
            json(500, { ok: false, removed: false, error: 'unlink-failed', code: (e && e.code) || '' });
            return;
          }
        }
        json(200, { ok: true, removed });
        return;
      }
      if (method !== 'PUT') { json(405, { error: 'method not allowed' }); return; }
      const abs = mediaMap.get(token);
      if (!abs) { json(404, { error: 'unknown-token' }); return; }
      const chunks = [];
      let size = 0;
      let failed = false;
      const fail = (code, payload) => {
        if (failed) return;
        failed = true;
        json(code, payload);
        // 应答必须活着送到客户端：紧接着 req.destroy() 会把写缓冲里的应答一起
        // 丢掉（评审实测 33MB 超限时客户端只看到 ECONNRESET 而非 413）。改为
        // 先排空剩余请求体（不缓冲），应答写完再断开。
        const drop = () => { try { req.destroy(); } catch { /* ignore */ } };
        if (res.writableFinished) { drop(); return; }
        if (typeof res.once === 'function') res.once('finish', drop); else drop();
        try { req.resume(); } catch { /* ignore */ }
      };
      armBodyIdleTimeout(req, () => fail(408, { error: 'request timeout' }));
      req.on('data', (c) => {
        if (failed) return;
        size += c.length;
        if (size > GPU_FRAME_MAX_BYTES) { fail(413, { error: 'frame too large' }); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (failed) return;
        const body = Buffer.concat(chunks);
        // GPU 抓帧统一 PNG（客户端 canvas.toBlob('image/png')）：签名 + IHDR +
        // IEND + 长度下限，避免 9 字节假 PNG 永久占槽。
        if (!looksLikePng(body)) { json(415, { error: 'unsupported-format' }); return; }
        const slot = sceneFrameSlot(abs, 0);
        // 唯一性闸与写盘同一临界区（按缓存键串行）：并发 PUT 只有一个能写，
        // 其余拿到 409（评审实测：无锁时两个 24MB PUT 都会 200）。
        const prev = GPU_WRITE_INFLIGHT.get(slot.key) || Promise.resolve();
        const write = prev
          .catch(() => { /* 前序失败不影响本次判定 */ })
          .then(async () => {
            if (existsSync(slot.gpuPath)) return { code: 409, payload: { error: 'gpu-frame-exists' } };
            await atomicWriteFileP(slot.gpuPath, body);
            return { code: 200, payload: { ok: true, bytes: body.length } };
          });
        GPU_WRITE_INFLIGHT.set(slot.key, write);
        write
          .then((r) => json(r.code, r.payload))
          .catch((err) => json(500, { error: String(err && err.message ? err.message : err) }))
          .finally(() => {
            if (GPU_WRITE_INFLIGHT.get(slot.key) === write) GPU_WRITE_INFLIGHT.delete(slot.key);
          });
      });
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

  // 3c-2. WebWallGL live renderer page, vendored into lib/webwallgl/ by
  //       scripts/sync-webwallgl.mjs (built with --base=/wallpaper-engine/
  //       scene-live/ so its absolute asset references resolve under this
  //       prefix). Same-origin and NOT sandboxed: the parent page drives it
  //       through frame.contentWindow.__wp / __wpStats, and backdrop-filter
  //       (liquid glass) can sample the composited output. Scene scripts stay
  //       confined inside WebWallGL's own SceneScript sandbox.
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/scene-live`,
    handler: (req, res) => {
      traceRequests(res, 'scene-live', new URL(req.url || '/', 'http://x').pathname);
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') { res.statusCode = 405; res.end('method not allowed'); return; }
      let rest = '';
      try {
        rest = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname.slice(`${BASE}/scene-live`.length));
      } catch {
        res.statusCode = 400; res.end('bad request'); return;
      }
      rest = rest.replace(/^\/+/, '');
      if (!rest || rest.endsWith('/')) rest += 'index.html';
      const abs = resolve(WEBWALLGL_DIR, rest);
      // Directory fence: nothing outside the vendored tree is ever served.
      if (abs === WEBWALLGL_DIR || !abs.startsWith(WEBWALLGL_DIR + sep)) {
        // 自解释的 403：谁被拦、从哪来。这行文字会直接显示在壁纸层上 —— 用户
        // 截图即可定位（历史上「网页壁纸黑屏、左上角 forbidden」就是这条）。
        appendDiagLine('fence', { route: 'scene-live', rest: rest.slice(0, 160), referer: String(req.headers.referer || '').slice(0, 120), dest: req.headers['sec-fetch-dest'] || '' });
        console.log(`[wallpaper-engine] scene-live fenced: rest="${rest}" referer="${req.headers.referer || '-'}" ua-iframe=${req.headers['sec-fetch-dest'] || '-'}`);
        res.setHeader('Cache-Control', 'no-store');
        res.statusCode = 403; res.end(`forbidden-scene-live[${rest}]`); return;
      }
      // Hash-named assets are immutable; index.html must revalidate (an
      // upstream sync changes the hashed references it carries).
      res.setHeader('Cache-Control', rest === 'index.html' ? 'no-store' : 'public, max-age=31536000, immutable');
      serveFile(abs, req, res, method === 'HEAD');
    },
  }));

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
    if (method !== 'GET' && method !== 'HEAD') { res.statusCode = 405; res.end('method not allowed'); return; }
      let rest = '';
      try {
        rest = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname.slice(`${BASE}/scene-files/`.length));
      } catch {
        res.statusCode = 400; res.end('bad request'); return;
      }
      const token = rest.split('/')[0] ?? '';
      const abs = mediaMap.get(token);
      if (!abs) { res.statusCode = 404; res.end('unknown-token'); return; }
      const subpath = rest.slice(token.length).replace(/^\/+/, '');
      if (!subpath) { res.statusCode = 404; res.end('missing-subpath'); return; }
      // The wallpaper root is the directory holding scene.pkg / scene.json;
      // project.json and the web entry sit next to them. Fence the target.
      const root = dirname(abs);
      const target = resolve(root, subpath);
      if (target === root || !target.startsWith(root + sep)) {
        appendDiagLine('fence', { route: 'scene-files', subpath: subpath.slice(0, 160), referer: String(req.headers.referer || '').slice(0, 120), dest: req.headers['sec-fetch-dest'] || '' });
        console.log(`[wallpaper-engine] scene-files fenced: subpath="${subpath}" referer="${req.headers.referer || '-'}" dest=${req.headers['sec-fetch-dest'] || '-'}`);
        res.setHeader('Cache-Control', 'no-store');
        res.statusCode = 403; res.end(`forbidden-scene-files[${subpath}]`); return;
      }
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-store');
      if (method === 'GET' && /\.html?$/i.test(target)) {
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
          const tag = `<script data-we-shim="host">${esc(shim)}</script>`
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
      serveFile(target, req, res, method === 'HEAD');
  }

  // 3c-3. 应用源挂载：渲染页（同源非沙箱 frame）取 scene.pkg / project.json。
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/scene-files`,
    handler: (req, res) => handleSceneFiles(req, res, 'app'),
  }));

  // 3c-3a. 壁纸媒体源：独立 loopback 监听（网页壁纸载荷的落点）。
  //
  // 为什么需要第二个源 —— DSH Desktop 给**每一个**插件路由套了能力头栅栏
  //（app/Contents/Resources/app/lib/webserver.js → decideDesktopBrowserAccess：
  // 请求必须带 x-dsh-desktop-renderer，而该头只由 Electron 主进程注入给
  // 「details.frame.origin === 应用源 且 顶层 frame 同源」的请求）。网页壁纸按
  // 设计必须跑在 sandbox="allow-scripts" 的不透明源里：它的 frame.origin 是
  // "null"，永远拿不到这个头 —— 于是入口 HTML 一律 403 Forbidden，服务端连一行
  // 请求日志都不会有（表现为预览图先正常、随后整块黑掉）。增强模式下普通浏览器
  // 访问也不可用（desktopBrowserAccessAvailable 只认兼容模式），唯一干净的出路
  // 是让壁纸载荷根本不经过宿主插件路由：我们自己在 127.0.0.1 上再监听一个随机
  // 端口，只服务 /scene-files/<token>/…，行为与同源那条完全一致（同一段处理
  // 函数：目录围栏 / CORS / shim+seed 注入 / Range）。顺带的好处是第三方 HTML
  // 连「同源」都不再沾边，沙箱之外又多一层隔离。
  let mediaOrigin = null;       // { server, port, base }
  let mediaOriginTask = null;
  let mediaOriginDead = false;  // 起过一次就不反复试（否则每次 inventory 都重试绑定）
  function mediaOriginBase() {
    return ensureMediaOrigin().then((m) => (m ? m.base : ''));
  }
  function ensureMediaOrigin() {
    if (mediaOrigin) return Promise.resolve(mediaOrigin);
    if (mediaOriginDead) return Promise.resolve(null);
    if (mediaOriginTask) return mediaOriginTask;
    mediaOriginTask = new Promise((done) => {
      const unavailable = (cause) => {
        const msg = cause instanceof Error ? cause.message : String(cause);
        console.log(`[wallpaper-engine] 壁纸媒体源不可用（网页壁纸回落应用源；Desktop 上会 403）：${msg}`);
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
        console.log(`[wallpaper-engine] 壁纸媒体源已监听 ${mediaOrigin.base}（网页壁纸载荷不再经过插件路由的能力头栅栏）`);
        done(mediaOrigin);
      });
    });
    return mediaOriginTask;
  }
  disposers.push(() => { try { mediaOrigin?.server?.close(); } catch { /* ignore */ } });

  // 3c-3b. 诊断：上报媒体源地址（verify 脚本与用户截图都能一眼看出网页壁纸
  //        到底从哪个源加载）。
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/media-origin`,
    handler: (req, res) => {
      mediaOriginBase().then((base) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({ base: base || null, port: mediaOrigin ? mediaOrigin.port : null }));
      });
    },
  }));

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
      const chunks = [];
      let size = 0;
      let done = false;
      const fail = (code) => {
        if (done) return;
        done = true;
        res.statusCode = code; res.end();
        try { req.destroy(); } catch { /* ignore */ }
      };
      req.on('data', (c) => {
        if (done) return;
        size += c.length;
        if (size > 4 * 1024 * 1024) { fail(413); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (done) return;
        done = true;
        try {
          const buf = Buffer.concat(chunks);
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

  // 3c-5. 媒体后端（Now Playing + 系统音频频谱）。懒启动：第一次被问到数据才启动
  //       —— 没人用就不该去下产物、不该起子进程、更不该申请音频权限。
  //       首选 media-bridge 子进程（macOS MediaRemote/CoreAudio、Windows GSMTC/
  //       WASAPI、Linux MPRIS/PipeWire，三平台同一套能力）；取不到产物或起不来时
  //       由门面自动回落到 lib/media/legacy.js（旧的 macOS Swift tap + ffmpeg 路径），
  //       回落原因在 status.fallback 里。audioSource=off 且媒体集成关闭时完全不启动。
  const mediaBackend = createMediaBackend({
    dataDir: dirname(configPath()),
    log: (m) => console.log('[wallpaper-engine][media] ' + m),
    diag: appendDiagLine,
  });
  disposers.push(() => mediaBackend.stop());
  const ensureMedia = () => {
    let st = {};
    try {
      const cfg = readConfig();
      st = cfg && cfg.settings ? cfg.settings : {};
    } catch { /* 读不到配置就按默认启用 */ }
    if (st.audioSource === 'off' && st.mediaIntegration === false) return;
    mediaBackend.start({
      // DSH_WE_MEDIA_NO_AUDIO=1：只取元数据、永不碰系统音频采集（不申请授权）。
      // 与 DSH_WE_DATA_DIR / DSH_WE_CACHE_DIR 同一套测试隔离约定 —— 端到端脚本靠它
      // 在不弹「音频录制」授权的前提下跑通媒体链路。
      audio: st.audioSource !== 'off' && process.env.DSH_WE_MEDIA_NO_AUDIO !== '1',
      online: st.mediaLyricsOnline === true,
    });
  };
  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/media-status`,
    handler: (req, res) => {
      ensureMedia();
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ ok: true, ...mediaBackend.status() }));
    },
  }));
  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/audio-spectrum`,
    handler: (req, res) => {
      ensureMedia();
      const st = mediaBackend.status();
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      // running=false 时客户端**不装**音频桥：渲染页一旦装了桥就跳过场景 BGM 的
      // 分析器接线（renderer 的 L2 开头即 `if(t.audioBridge) return`），喂一屏 0
      // 会把壁纸的音频反应从「内置模拟源」变成「一条死线」。让渲染页继续用自己的
      // 模拟源 / 包内音频分析，比喂 0 正确。
      res.end(JSON.stringify({
        ok: true,
        bands: Array.from(mediaBackend.spectrum()),
        running: st.audio.status === 'running',
      }));
    },
  }));
  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/now-playing`,
    handler: (req, res) => {
      ensureMedia();
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({
        ok: true,
        media: mediaBackend.nowPlaying(),
        hasArtwork: Boolean(mediaBackend.artworkFile()),
      }));
    },
  }));
  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/now-playing/artwork`,
    handler: (req, res) => {
      // 中间件的封面文件名带内容指纹（换曲即换名），所以每次都要读当前快照的路径，
      // 不能缓存文件名 —— 缓存了会在换曲后继续发上一张封面。
      const f = mediaBackend.artworkFile();
      if (!f || !existsSync(f)) { res.statusCode = 404; res.end('no-artwork'); return; }
      res.setHeader('Cache-Control', 'no-store');
      serveFile(f, req, res, false);
    },
  }));

  // 3c-6. 客户端（浏览器半）行为上报：渲染链路的关键步骤落盘 —— 排查只在
  //       某个宿主环境出现的问题时，「走了哪条分支、在哪一步停下」比事后猜有用。
  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/client-diag`,
    handler: (req, res) => {
      if ((req.method || '').toUpperCase() !== 'POST') { res.statusCode = 405; res.end(); return; }
      const chunks = [];
      let size = 0;
      let done = false;
      req.on('data', (c) => {
        if (done) return;
        size += c.length;
        if (size > 64 * 1024) { done = true; res.statusCode = 413; res.end(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (done) return;
        done = true;
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          appendDiagLine('client', {
            event: String(body.event || ''),
            type: String(body.type || ''),
            id: String(body.id || ''),
            detail: String(body.detail || '').slice(0, 300),
            src: String(body.src || '').slice(0, 200),
          });
        } catch { /* 坏 payload 忽略 */ }
        res.statusCode = 204;
        res.end();
      });
    },
  }));

  // 3c-3d. WE 官方素材端点（local-assets）—— 上游 WebWallGL 渲染页的消费契约
  //       （renderer/src/local-assets.ts；上游 dev server 在 host/wallpaper-host.ts
  //       实现同一接口，这里是等价的服务端实现）。渲染页只在 URL 带
  //       ?localAssets=1 时探测本端点，客户端仅在素材目录可用时加该参数
  //       （liveRenderUrl），故未配置素材的用户零请求、行为与此前完全一致。
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
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
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
      req.on('error', () => { res.statusCode = 400; res.end('request error'); });
    },
  }));

  // 3c-7. Renderer diagnostics sink. WebWallGL's reportDiag() fires a pixel
  //       request at `{mediaBase origin}/diag?msg=…` — i.e. the ROOT path, not
  //       under BASE. Those messages are the only window into what happens
  //       inside the renderer page (shim injection failures, fallbacks to a
  //       bare iframe, sound-layer errors, …), which is exactly what a
  //       "wallpaper goes black" report needs. Keep a bounded ring buffer and
  //       mirror to the host log; a debug route lets us read it back.
  const diagLog = [];
  const handleDiag = (req, res) => {
    try {
      const u = new URL(req.url || '/diag', 'http://x');
      const msg = u.searchParams.get('msg') || '';
      if (msg) {
        diagLog.push({ t: Date.now(), msg });
        if (diagLog.length > 200) diagLog.shift();
        // 落盘：DSH Desktop 的运行日志不收录 host 的 stdout，而渲染页的内部告警
        //（shim 未注入 / 退回裸 iframe / 声音层失败…）是排查「壁纸黑屏」的关键，
        // 必须与 4xx 记录写进同一个可事后读取的文件。
        appendDiagLine('renderer', { msg: msg.slice(0, 300) });
        console.log(`[wallpaper-engine][renderer] ${msg}`);
      }
    } catch { /* ignore malformed */ }
    res.statusCode = 204;
    res.end();
  };
  // 渲染页按 `{mediaBase origin}/diag` 上报（根路径）；但同一份产物里还有一条
  // 走 `${BASE}/diag` 的通道 —— 两条都接上，否则「壁纸黑屏」时最关键的渲染页告警
  // 会以 404 静默丢掉（实测：排查本机黑屏时它们全部打在 ${BASE}/diag 上）。
  disposers.push(webServer.register({ kind: 'exact', path: '/diag', handler: handleDiag }));
  disposers.push(webServer.register({ kind: 'exact', path: `${BASE}/diag`, handler: handleDiag }));
  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/diag-log`,
    handler: (req, res) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ entries: diagLog.slice(-80) }));
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
        const tokenB64 = Buffer.from(abs, 'utf8').toString('base64url');
        // 异步读盘：scene.pkg 可达几十 MB，readFileSync 会阻塞事件循环。
        const manifest = abs.toLowerCase().endsWith('.json')
          ? buildSceneManifestFromDir(dirname(abs), tokenB64)
          : buildSceneManifest(new Uint8Array(await readFile(abs)), tokenB64);
        if (!manifest) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: false, error: 'manifest-build-failed' }));
          return;
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({ ok: true, manifest }));
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
      try {
        const bytes = abs.toLowerCase().endsWith('.json')
          ? extractSceneResourceFromDir(dirname(abs), subpath)
          : extractSceneResource(new Uint8Array(await readFile(abs)), subpath);
        if (!bytes) { res.statusCode = 404; res.end('resource-not-found'); return; }
        const isPng = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
        res.setHeader('Content-Type', isPng ? 'image/png' : 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store');
        res.end(Buffer.from(bytes));
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
          // （与 SCENE_FRAME_INFLIGHT 同型）。
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

  // 自定义画面管理：POST 导入（raw body，MIME 白名单，30MB 上限）/
  // GET 查看 / DELETE 清除；scene-frame ?v=4 消费同一 overrides 目录。
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/custom-frame`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      const pathname = new URL(req.url || '/', 'http://x').pathname;
      const id = decodeURIComponent(pathname.slice(`${BASE}/custom-frame/`.length)).replace(/\/+$/, '');
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'bad-id' }));
        return;
      }
      if (method === 'GET') {
        const p = customFramePath(id);
        if (!p) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'not-set' }));
          return;
        }
        serveFile(p, req, res, false);
        return;
      }
      if (method === 'DELETE') {
        let removed = false;
        for (const e of ['png', 'jpg', 'webp']) {
          try { unlinkSync(join(customFrameDir(), id + '.' + e)); removed = true; } catch { /* ignore */ }
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: true, removed }));
        return;
      }
      if (method !== 'POST') {
        res.statusCode = 405; res.end('method not allowed'); return;
      }
      const ctype = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const ext = CUSTOM_FRAME_EXT[ctype];
      if (!ext) {
        res.statusCode = 415;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: '不支持的格式：' + ctype + '（仅支持 JPG / PNG / WebP）' }));
        return;
      }
      const dir = customFrameDir();
      for (const e of ['png', 'jpg', 'webp']) {
        if (e !== ext) { try { unlinkSync(join(dir, id + '.' + e)); } catch { /* ignore */ } }
      }
      const target = join(dir, id + '.' + ext);
      const tmpAbs = target + '.tmp';
      const ws = createWriteStream(tmpAbs);
      let size = 0;
      let failed = false;
      const cleanupTmp = () => { try { unlinkSync(tmpAbs); } catch { /* ignore */ } };
      const fail = (code, payload) => {
        if (failed) return;
        failed = true;
        try { ws.destroy(); } catch { /* ignore */ }
        res.statusCode = code;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(payload));
        try { req.destroy(); } catch { /* ignore */ }
      };
      ws.on('error', () => fail(500, { error: 'write failed' }));
      ws.on('close', () => { if (failed) cleanupTmp(); });
      armBodyIdleTimeout(req, () => fail(408, { error: 'request timeout' }));
      req.on('data', (c) => {
        if (failed) return;
        size += c.length;
        if (size > CUSTOM_FRAME_MAX_BYTES) { fail(413, { error: '图片过大（上限 30MB）' }); return; }
        if (!ws.write(c)) req.pause();
      });
      ws.on('drain', () => { if (!failed) req.resume(); });
      req.on('end', () => {
        if (failed) return;
        ws.end(() => {
          try { renameSync(tmpAbs, target); } catch { fail(500, { error: 'publish failed' }); return; }
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: true, id, bytes: size }));
        });
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
      let completed = false; // 请求已成功应答 (临时文件已 rename 或本就该保留)
      let tmpCleaned = false; // 防重复清理
      const cleanupTmp = () => {
        if (tmpCleaned) return;
        tmpCleaned = true;
        try { unlinkSync(tmpAbs); } catch { /* ignore */ }
      };
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
      // 上传中途关标签页/断网: 不会走 req 'end'/'error'/超时, 旧实现既不销毁
      // 写流也不删临时文件 → 上传目录里留下一个打开的文件描述符 + 最多 512MB
      // 的 .tmp (启动清扫只看 transcode/ffmpeg/preview 目录, 不扫 uploads)。
      req.once('close', () => {
        if (completed || failed) return;
        failed = true;
        try { ws.destroy(); } catch { /* ignore */ } // 'close' 里 cleanupTmp
        cleanupTmp();
      });
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
        // 请求体已完整收到: 从此处起临时文件由下面的 ws.end 回调负责发布
        // (rename 或清理), req 'close' 不得再销毁写流 (否则回调不会执行)。
        completed = true;
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
