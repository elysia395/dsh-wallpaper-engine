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
 *        GET /wallpaper-engine/inventory          → { installDir, wallpapers:[…] }
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
} from 'node:fs';
import { join, resolve, normalize, basename } from 'node:path';
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
 * 1. WaifuX's own download folder — anything the user saves in WaifuX
 *    (static or video wallpaper) becomes a DSH background automatically.
 * 2. ~/Documents/dsh/we-content for loose files dropped in manually. */
const MAC_DEFAULT_CONTENT_DIRS =
  process.platform === 'darwin'
    ? [
        join(process.env.HOME || '', 'Library', 'Application Support', 'WaifuX', 'Wallpapers'),
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
    };
  } catch { return null; }
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
  roots.push(...extraRoots);
  for (const root of roots) {
    let entries = [];
    try { entries = readdirSync(root); } catch { continue; }
    for (const entry of entries) {
      const dir = join(root, entry);
      let st; try { st = statSync(dir); } catch { continue; }
      if (st.isDirectory()) {
        const proj = readProject(dir);
        if (!proj || found.has(proj.id)) continue;
        proj.fileAbs = resolve(dir, proj.file);
        proj.previewAbs = proj.preview ? resolve(dir, proj.preview) : null;
        found.set(proj.id, proj);
        continue;
      }
      // Loose media file (macOS adaptation): a bare .mp4/.png/… in the content
      // folder is its own wallpaper. Type is 'image' for stills so the browser
      // half renders an <img>; playable flags come from the same existsSync
      // path as project media.
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
    const wallpapers = all.map((w) => {
      const hasMedia = w.type === 'video' || w.type === 'web' || w.type === 'image'
        ? existsSync(w.fileAbs) : false;
      const hasPreview = w.previewAbs && existsSync(w.previewAbs);
      return {
        id: w.id,
        title: w.title,
        type: w.type,
        playable: hasMedia,
        media: hasMedia ? `${BASE}/media/${tokenFor(w.fileAbs)}` : null,
        preview: hasPreview ? `${BASE}/preview/${tokenFor(w.previewAbs)}` : null,
      };
    });
    return {
      installDir,
      total: wallpapers.length,
      portableCount: wallpapers.filter((w) => w.playable).length,
      wallpapers,
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

  return () => {
    for (const d of disposers) { try { d(); } catch { /* ignore */ } }
    mediaMap.clear();
  };
}

export default { inject, apply };