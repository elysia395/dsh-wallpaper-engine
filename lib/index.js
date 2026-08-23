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
  readdirSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
  renameSync,
  copyFileSync,
} from 'node:fs';
import { join, resolve, normalize, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

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

/** macOS: Steam keeps its files under ~/Library/Application Support/Steam. */
const STEAM_MAC_DIR =
  process.platform === 'darwin'
    ? join(process.env.HOME || '', 'Library', 'Application Support', 'Steam')
    : null;

/**
 * macOS adaptation — Wallpaper Engine has no macOS client, so discovery is
 * directory-driven: set DSH_WALLPAPER_ENGINE_CONTENT to one or more
 * (colon-separated) folders holding WE project files. Each folder is scanned
 * in every known layout (bare project folders, a copied Steam library's
 * workshop tree, or a copied WE install's projects/ tree), so content copied
 * from any Windows machine just works.
 */
function envDirs(name) {
  const raw = process.env[name];
  return raw ? raw.split(':').filter(Boolean) : [];
}

/** Default macOS content folders (no env var needed for the common case):
 * WaifuX stores static wallpapers in Wallpapers/ and motion-video wallpapers
 * in Media/; ~/Documents/dsh/we-content is for loose files dropped manually. */
const MAC_DEFAULT_CONTENT_DIRS =
  process.platform === 'darwin'
    ? [
        join(process.env.HOME || '', 'Library', 'Application Support', 'WaifuX', 'Wallpapers'),
        join(process.env.HOME || '', 'Library', 'Application Support', 'WaifuX', 'Media'),
        join(process.env.HOME || '', 'Documents', 'dsh', 'we-content'),
      ]
    : [];

/** Content folders expanded across known layouts (env var + macOS defaults). */
function contentRootsFromEnv() {
  const roots = [];
  const dirs = envDirs('DSH_WALLPAPER_ENGINE_CONTENT');
  dirs.push(...MAC_DEFAULT_CONTENT_DIRS);
  for (const dir of dirs) {
    for (const sub of ['', 'steamapps/workshop/content/431960', 'projects/defaultprojects', 'projects/myprojects']) {
      const p = sub ? join(dir, sub) : dir;
      if (existsSync(p)) roots.push(p);
    }
  }
  return roots;
}

/** Steam root recorded by the Windows installer; the probe list misses custom dirs. */
function steamPathFromRegistry() {
  if (process.platform !== 'win32') return null;
  try {
    const reg = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
    const out = execFileSync(
      reg,
      ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
      { encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const m = /SteamPath\s+REG_SZ\s+(.+)/i.exec(out);
    return m ? normalize(m[1].trim()) : null;
  } catch { return null; }
}

/** Probe list with the registered Steam root first, when it is known. */
function steamProbeDirs() {
  const reg = steamPathFromRegistry();
  const list = reg ? [reg, ...STEAM_PROBE_DIRS] : [...STEAM_PROBE_DIRS];
  if (STEAM_MAC_DIR && existsSync(STEAM_MAC_DIR)) list.push(STEAM_MAC_DIR);
  return list;
}

/** Valve KeyValues parser for libraryfolders.vdf: libraries owning WE. */
function librariesFromVdf(vdfPath) {
  const text = readFileSync(vdfPath, 'utf8');
  const libs = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*"path"\s+"([^"]+)"\s*$/.exec(line);
    if (m) { current = m[1].replace(/\\\\/g, '\\'); continue; }
    if (current && line.includes(WE_APPID) && !libs.includes(current)) libs.push(current);
  }
  return libs;
}

/** Locate the install directory (holds wallpaper32.exe). */
function locateWallpaperEngine() {
  const candidates = [];
  const libraries = [];
  const probes = steamProbeDirs();
  for (const probe of probes) {
    const vdf = join(probe, 'steamapps', 'libraryfolders.vdf');
    if (existsSync(vdf)) { try { libraries.push(...librariesFromVdf(vdf)); } catch { /* skip */ } }
  }
  const roots = [...probes, ...libraries];
  for (const root of roots) candidates.push(join(root, 'steamapps', 'common', 'wallpaper_engine'));
  candidates.push('C:\\Program Files (x86)\\Wallpaper Engine');
  candidates.push(...envDirs('DSH_WALLPAPER_ENGINE_DIR'));

  const seen = new Set();
  for (const raw of candidates) {
    const dir = normalize(raw);
    if (seen.has(dir)) continue;
    seen.add(dir);
    // Windows is identified by the WE binary; on other platforms accept a
    // directory carrying a WE projects/ layout (e.g. an install copied over).
    const marker =
      process.platform === 'win32'
        ? join(dir, 'wallpaper32.exe')
        : join(dir, 'projects', 'defaultprojects');
    if (existsSync(marker)) return dir;
  }
  return null;
}

/** Libraries that own Wallpaper Engine (for the workshop content root). */
function owningLibraries() {
  const libs = [];
  for (const probe of steamProbeDirs()) {
    const vdf = join(probe, 'steamapps', 'libraryfolders.vdf');
    if (existsSync(vdf)) { try { libs.push(...librariesFromVdf(vdf)); } catch { /* skip */ } }
    // The Steam root a libraryfolders.vdf lives in is itself a library, but it
    // is never listed as a "path" entry. If Wallpaper Engine is installed in
    // the DEFAULT Steam library, its workshop content lives under that same
    // root — include it, or every workshop wallpaper silently disappears from
    // the inventory (and playlists cannot resolve, breaking rotation).
    if (existsSync(join(probe, 'steamapps', 'common', 'wallpaper_engine'))) libs.push(probe);
  }
  return [...new Set(libs)];
}

function inferType(file) {
  if (/\.(mp4|webm|mkv|avi|mov)$/i.test(file)) return 'video';
  if (/\.(html?|js)$/i.test(file)) return 'web';
  return 'scene';
}

const KINDS = ['scene', 'video', 'web', 'application', 'image'];

/** Loose media files scanned directly as wallpapers (no project.json needed). */
const LOOSE_MEDIA = /\.(mp4|webm|png|jpe?g|gif|webp)$/i;

function readProject(dir) {
  const pj = join(dir, 'project.json');
  if (!existsSync(pj)) return null;
  try {
    const o = JSON.parse(readFileSync(pj, 'utf8'));
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
function resolveSceneMainFile(dir, declared) {
  for (const candidate of [declared, 'scene.pkg', 'scene.json']) {
    if (!candidate) continue;
    try {
      if (statSync(resolve(dir, candidate)).isFile()) return candidate;
    } catch { /* keep probing */ }
  }
  let pkgs = [];
  try {
    pkgs = readdirSync(dir).filter((name) => name.toLowerCase().endsWith('.pkg'));
  } catch {
    return null;
  }
  return pkgs.length === 1 ? pkgs[0] : null;
}

function enumerateWallpapers(installDir, libraryDirs, extraRoots = []) {
  const found = new Map();
  const roots = [];
  if (installDir) {
    for (const sub of ['defaultprojects', 'myprojects']) {
      const p = join(installDir, 'projects', sub);
      if (existsSync(p)) roots.push(p);
    }
  }
  for (const lib of libraryDirs) {
    const ws = join(lib, 'steamapps', 'workshop', 'content', WE_APPID);
    if (existsSync(ws)) roots.push(ws);
  }
  // macOS: WaifuX's bundled steamcmd creates its own Steam dir and downloads
  // Wallpaper Engine workshop items there, but its libraryfolders.vdf keeps an
  // empty apps block — scan the workshop path directly instead of trusting the
  // vdf's app list (which is how the Windows branch discovers it).
  if (STEAM_MAC_DIR && existsSync(STEAM_MAC_DIR)) {
    const ws = join(STEAM_MAC_DIR, 'steamapps', 'workshop', 'content', WE_APPID);
    if (existsSync(ws)) roots.push(ws);
  }
  roots.push(...extraRoots);
  for (const root of roots) {
    let entries = [];
    try { entries = readdirSync(root); } catch { continue; }
    for (const entry of entries) {
      const dir = join(root, entry);
      let st; try { st = statSync(dir); } catch { continue; }
      if (st.isDirectory()) {
        const proj = readProject(dir);
        if (proj && !found.has(proj.id)) {
          // Scenes: resolve the real container (scene.pkg vs scene.json) so the
          // scene-frame route reads a file that actually exists.
          proj.fileAbs = proj.type === 'scene'
            ? (() => { const main = resolveSceneMainFile(dir, proj.file); return resolve(dir, main || proj.file); })()
            : resolve(dir, proj.file);
          proj.previewAbs = proj.preview ? resolve(dir, proj.preview) : null;
          found.set(proj.id, proj);
          continue;
        }
        // WaifuX nests each workshop item under a container dir with no
        // project.json here: Media/workshop_<id>/steamapps/workshop/content/
        // 431960/<id>/project.json. Push the nested layer back onto the scan.
        const nested = join(dir, 'steamapps', 'workshop', 'content', WE_APPID);
        if (existsSync(nested)) roots.push(nested);
        continue;
      }
      // Loose media file (macOS adaptation): a bare .mp4/.png/… in the content
      // folder is its own wallpaper. Type is 'image' for stills so the browser
      // half renders an img element; playable flags come from the same
      // existsSync path as project media.
      if (!st.isFile() || !LOOSE_MEDIA.test(entry)) continue;
      const id = `file-${root}-${entry}`;
      if (found.has(id)) continue;
      found.set(id, {
        id,
        title: entry.replace(/\.[^.]+$/, ''),
        type: /\.(mp4|webm)$/i.test(entry) ? 'video' : 'image',
        file: entry,
        fileAbs: dir,
        previewAbs: null,
      });
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

function readPlaylists(installDir) {
  if (!installDir) return [];
  const configPath = join(installDir, 'config.json');
  if (!existsSync(configPath)) return [];
  let config;
  try { config = JSON.parse(readFileSync(configPath, 'utf8')); } catch { return []; }

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
    png: 'image/png', webp: 'image/webp',
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

function writeConfig(cfg) {
  try {
    mkdirSync(dirname(configPath()), { recursive: true });
    writeFileSync(configPath(), JSON.stringify(cfg));
  } catch { /* ignore */ }
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
  try { mkdirSync(frameCacheDir(), { recursive: true }); } catch { /* ignore */ }
  return frameCacheDir();
}
/** Accepted upload MIME → file extension (matches mimeFor above). */
const UPLOAD_EXT = { 'video/mp4': 'mp4', 'image/jpeg': 'jpg', 'image/png': 'png' };
/** Upload size cap: 512 MB (a single wallpaper video). */
const UPLOAD_MAX_BYTES = 512 * 1024 * 1024;
/** Uploaded-file name pattern: `<up-id>.<ext>` (group 1 = id, group 2 = ext). */
const UPLOAD_FILE_RE = /^(up-[a-z0-9-]+)\.(mp4|jpg|jpeg|png)$/i;

function ensureUploadDir() {
  try { mkdirSync(UPLOAD_DIR, { recursive: true }); } catch { /* ignore */ }
  return UPLOAD_DIR;
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
    writeFileSync(uploadMetaPath(), JSON.stringify(m));
  } catch { /* ignore */ }
}

function removeUploadMeta(id) {
  try {
    const m = readUploadMeta();
    if (id in m) { delete m[id]; writeFileSync(uploadMetaPath(), JSON.stringify(m)); }
  } catch { /* ignore */ }
}

/** Scan the uploads dir → WE-shaped wallpaper entries (no project.json). */
function enumerateUploads(dir) {
  if (!existsSync(dir)) return [];
  let entries = [];
  try { entries = readdirSync(dir); } catch { return []; }
  const out = [];
  for (const entry of entries) {
    const abs = join(dir, entry);
    let st; try { st = statSync(abs); } catch { continue; }
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

/** Resolve an upload id to its file path inside the uploads dir, or null. */
function resolveUploadFile(dir, id) {
  if (typeof id !== 'string' || !/^up-[a-z0-9-]+$/.test(id)) return null;
  const root = normalize(dir);
  try {
    for (const entry of readdirSync(dir)) {
      const m = UPLOAD_FILE_RE.exec(entry);
      if (m && m[1].toLowerCase() === id.toLowerCase()) {
        const abs = normalize(join(dir, entry));
        if (abs.startsWith(root + '\\')) return abs; // stays inside uploads dir
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
 *  uploads off the system drive). */
function moveFile(src, dst) {
  try { renameSync(src, dst); return true; } catch { /* cross-volume */ }
  try {
    copyFileSync(src, dst);
    unlinkSync(src);
    return true;
  } catch { return false; }
}

/** Switch the upload directory (persisted to config.json), migrating files. */
function setUploadDir(newDir, migrate) {
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
  if (migrate !== false && existsSync(oldDir)) {
    try {
      for (const entry of readdirSync(oldDir)) {
        if (entry === '.meta.json' || UPLOAD_FILE_RE.test(entry)) {
          if (moveFile(join(oldDir, entry), join(target, entry))) migrated += 1;
          else skipped += 1;
        }
      }
    } catch { /* ignore */ }
  }
  UPLOAD_DIR = target;
  const cfg = readConfig();
  cfg.uploadDir = target;
  writeConfig(cfg);
  ensureUploadDir();
  return { uploadDir: target, migrated, skipped, same: false };
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

  // Token → absolute path map. Tokens are base64url of the abs path, so the
  // route never exposes an arbitrary filesystem string the client could not
  // otherwise obtain from the inventory.
  const mediaMap = new Map();
  const tokenFor = (absPath) => {
    const token = Buffer.from(absPath, 'utf8').toString('base64url');
    mediaMap.set(token, absPath);
    return token;
  };

  // Build the inventory once; the browser half refetches live each load.
  function buildInventory() {
    const installDir = locateWallpaperEngine();
    const libraryDirs = owningLibraries();
    const all = enumerateWallpapers(installDir, libraryDirs, contentRootsFromEnv());
    const byPath = new Map(all.map((w) => [pathKey(w.fileAbs), w.id]));
    const byId = new Map(all.map((w) => [w.id, w]));
    const wallpapers = all.map((w) => {
      const hasMedia = w.type === 'video' || w.type === 'web' || w.type === 'image'
        ? existsSync(w.fileAbs) : false;
      const hasPreview = w.previewAbs && existsSync(w.previewAbs);
      // Scenes: fileAbs points at the resolved scene main file (scene.pkg /
      // scene.json); frameUrl serves its extracted static frame.
      const hasFrame = w.type === 'scene' && w.fileAbs && existsSync(w.fileAbs);
      return {
        id: w.id,
        title: w.title,
        type: w.type,
        contentrating: w.contentrating,
        playable: hasMedia,
        media: hasMedia ? `${BASE}/media/${tokenFor(w.fileAbs)}` : null,
        preview: hasPreview ? `${BASE}/preview/${tokenFor(w.previewAbs)}` : null,
        frameUrl: hasFrame ? `${BASE}/scene-frame/${tokenFor(w.fileAbs)}` : null,
      };
    });
    // Custom uploads: scanned fresh each request (read-A storage), appended
    // AFTER the WE wallpapers. Images serve themselves as preview; videos get
    // the client-side "无预览" placeholder.
    const uploadsDir = ensureUploadDir();
    const uploadMeta = readUploadMeta();
    const uploads = enumerateUploads(uploadsDir).map((w) => ({
      id: w.id,
      title: metaEntry(uploadMeta, w.id).title || w.id,
      type: w.type,
      playable: true,
      media: `${BASE}/media/${tokenFor(w.fileAbs)}`,
      preview: w.previewAbs ? `${BASE}/preview/${tokenFor(w.previewAbs)}` : null,
    }));
    wallpapers.push(...uploads);
    const playableIds = new Set(wallpapers.filter((w) => w.playable).map((w) => w.id));
    const playlists = readPlaylists(installDir).map((playlist) => {
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
    return {
      installDir,
      uploadDir: UPLOAD_DIR,
      total: wallpapers.length,
      portableCount: wallpapers.filter((w) => w.playable).length,
      wallpapers,
      playlists,
    };
  }

  const disposers = [];

  // 1. Inventory JSON.
  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/inventory`,
    handler: (req, res) => {
      try {
        const payload = JSON.stringify(buildInventory());
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
  function serveFile(absPath, req, res) {
    if (!absPath || !existsSync(absPath)) {
      res.statusCode = 404; res.end('not found'); return;
    }
    const st = statSync(absPath);
    res.setHeader('Content-Type', mimeFor(absPath));
    res.setHeader('Accept-Ranges', 'bytes');
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m && m[1] ? parseInt(m[1], 10) : 0;
      let end = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
      if (Number.isNaN(start)) start = 0;
      if (Number.isNaN(end) || end >= st.size) end = st.size - 1;
      if (start > end) {
        res.statusCode = 416;
        res.setHeader('Content-Range', `bytes */${st.size}`);
        res.end(); return;
      }
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${st.size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      createReadStream(absPath, { start, end }).pipe(res);
      return;
    }
    res.setHeader('Content-Length', String(st.size));
    createReadStream(absPath).pipe(res);
  }

  for (const seg of ['media', 'preview']) {
    const prefix = `${BASE}/${seg}/`;
    disposers.push(webServer.register({
      kind: 'prefix',
      path: `${BASE}/${seg}`,
      handler: (req, res) => {
        const pathname = new URL(req.url || '/', 'http://x').pathname;
        const token = decodeURIComponent(pathname.slice(prefix.length));
        serveFile(mediaMap.get(token), req, res);
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
      (async () => {
        let mtime = 0;
        try { mtime = statSync(abs).mtimeMs; } catch { /* keep 0 */ }
        // Cache key version: bump when the extraction pipeline changes so
        // frames produced by older (buggy) logic are re-extracted instead of
        // served stale from disk.
        const key = 'sf2_' + Buffer.from(abs, 'utf8').toString('base64url') + '_' + Math.round(mtime);
        const dir = ensureFrameCacheDir();
        const pngPath = join(dir, key + '.png');
        const jpgPath = join(dir, key + '.jpg');
        let servePath = existsSync(pngPath) ? pngPath : existsSync(jpgPath) ? jpgPath : null;
        if (!servePath) {
          const { extractSceneMainImage, extractSceneMainImageFromDir } = await import('./pkg-extract.js');
          const frame = abs.toLowerCase().endsWith('.json')
            ? extractSceneMainImageFromDir(dirname(abs))
            : extractSceneMainImage(new Uint8Array(readFileSync(abs)));
          if (frame.mime === 'image/jpeg') {
            writeFileSync(jpgPath, frame.bytes);
            servePath = jpgPath;
          } else {
            writeFileSync(pngPath, frame.bytes);
            servePath = pngPath;
          }
        }
        res.setHeader('Content-Type', servePath.endsWith('.jpg') ? 'image/jpeg' : 'image/png');
        res.setHeader('Cache-Control', 'no-store');
        createReadStream(servePath).pipe(res);
      })().catch((err) => {
        res.statusCode = 422;
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
      const chunks = [];
      let size = 0;
      let failed = false;
      req.on('data', (c) => {
        if (failed) return;
        size += c.length;
        if (size > UPLOAD_MAX_BYTES) {
          failed = true;
          res.statusCode = 413;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: '文件过大（上限 512MB）' }));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        if (failed) return;
        try {
          const buf = Buffer.concat(chunks);
          const sha = createHash('sha256').update(buf).digest('hex');
          // Content dedup: uploading the SAME file again must not create a
          // duplicate entry — return the existing wallpaper instead. meta
          // stores each upload's sha256; legacy entries without a hash never
          // match, so pre-existing uploads are unaffected.
          const dir = ensureUploadDir();
          const meta = readUploadMeta();
          let dupId = null;
          for (const id of Object.keys(meta)) {
            if (metaEntry(meta, id).sha256 === sha) { dupId = id; break; }
          }
          if (dupId) {
            const existing = resolveUploadFile(dir, dupId);
            if (existing && existsSync(existing)) {
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
          const id = 'up-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
          const fileAbs = join(dir, id + '.' + ext);
          writeFileSync(fileAbs, buf);
          if (title) setUploadMeta(id, title, sha);
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
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
        }
      });
      req.on('error', () => {
        if (!failed) { res.statusCode = 400; res.end('request error'); }
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
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
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
        const result = setUploadDir(dir, migrate);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(result));
      });
      req.on('error', () => { res.statusCode = 400; res.end('request error'); });
    },
  }));

  return () => {
    for (const d of disposers) { try { d(); } catch { /* ignore */ } }
    mediaMap.clear();
  };
}

export default { inject, apply };
