/**
 * dsh-wallpaper-engine — host half type surface.
 *
 * The host plugin contributes no public Cordis services and registers no model
 * tool. It serves 37 same-origin HTTP routes through `ctx.webServer` and unwinds
 * them on unload; `docs/ROUTE-INDEX.md` is the generated table of those routes
 * and stays authoritative for their paths and handlers.
 *
 * Exactly one of those routes leaves the machine: `GET /wallpaper-engine/star-count`
 * fetches the repository's star count from the public GitHub API (read-only, no
 * credentials, 10-minute cache plus an on-disk fallback). Everything else serves
 * local data — including `GET /wallpaper-engine/about-qr/<file>`, which hands out
 * the two contact QR codes shipped in `lib/about/` (whitelisted names only).
 *
 * `webServer` is a HARD dependency, declared by `inject` below: the Loader waits
 * for the HTTP server to mount before running this plugin, and a profile with no
 * HTTP server does not load the bundle at all. `ctx.webServer` is read directly
 * at mount time; it is never reached through `ctx.get`.
 */

import type { Context } from '@deepseek-ai/cordis';

/** One normalized Wallpaper Engine project (or upload) as served in the inventory. */
export interface WallpaperDescriptor {
  /** Entry id: Workshop id, project folder name, or `up-*` / `up-dir-*` for uploads. */
  id: string;
  /** Display title: project.json title, uploads/.meta.json title, or the id as fallback. */
  title: string;
  /** Kind assigned by the enumerator: 'scene' | 'video' | 'web' | 'application',
   *  plus 'image' for a single-file upload. */
  type: string;
  /** Wallpaper Engine content rating from project.json (or uploads/.meta.json), or null. */
  contentrating: string | null;
  /** Whether the entry has playable media (video/web, or any single-file upload). */
  playable: boolean;
  /** Served media URL (`/wallpaper-engine/media/<token>`), or null. */
  media: string | null;
  /** Real container suffix of the media file, lower-case and without the dot (e.g. `mp4`),
   *  or null. The media URL is token-shaped and carries no extension, so the client's
   *  "the browser can play this natively" decision (skip the frame-rate-cap re-encode)
   *  has no other way to know the container. */
  mediaExt: string | null;
  /** Served preview URL (`/wallpaper-engine/preview/<token>`; uploads without a
   *  preview image fall back to `/wallpaper-engine/video-preview/<token>`), or null. */
  preview: string | null;
  /** Scene static-frame URL (`/wallpaper-engine/scene-frame/<token>`), or null. */
  frameUrl: string | null;
  /** Load-time placeholder colour derived from WE's schemecolor (`rgb(r, g, b)`), or null. */
  schemeColor: string | null;
  /** Whether WebWallGL can live-render this scene (a packed pkg, not a loose scene.json). */
  sceneLive: boolean;
  /** Scene main-file token for the live renderer (`sceneLive` only), or null. */
  sceneLiveSrc: string | null;
  /** `scene.pkg` size in bytes (0 when it cannot be measured). The client scales its
   *  first-frame watchdog budget by it — the first frame cannot exist before the whole
   *  package has arrived, and measured packages reach 336 MB. */
  scenePkgBytes: number;
  /** Scene embedded-animation MP4 URL (`/wallpaper-engine/scene-video/<token>`); null
   *  until the probe confirms the pkg really carries an MP4. */
  sceneVideo: string | null;
  /** Scene packaged-audio URL (`/wallpaper-engine/scene-audio/<token>`), or null. */
  sceneAudio: string | null;
  /** Whether a user-supplied static frame replaces the extracted one. */
  hasCustomFrame: boolean;
  /** Whether the web live render applies to this entry (entry HTML present). */
  webLive: boolean;
  /** Full entry URL the web renderer loads (`/wallpaper-engine/scene-files/<token>/<name>`), or null. */
  webLiveSrc: string | null;
  /** Served project.json URL for the properties panel (`/wallpaper-engine/props/<token>`), or null. */
  propsUrl: string | null;
  /** Automatic web first-frame cache URL (`/wallpaper-engine/live-frame/<token>`), or null. */
  liveFrame: string | null;
}

/** A Wallpaper Engine playlist read from `config.json`. */
export interface PlaylistDescriptor {
  /** Stable identifier derived from the Wallpaper Engine profile and index. */
  id: string;
  /** Playlist name shown in the picker. */
  name: string;
  /** Wallpaper Engine ordering mode (`sequence` or `random`). */
  order: 'sequence' | 'random';
  /** Wallpaper Engine delay in seconds, when present. */
  delay: number | null;
  /** Inventory ids in the playlist order. */
  wallpaperIds: string[];
  /** Number of resolved entries in the playlist. */
  total: number;
  /** Number of resolved Video/Web entries. */
  portableCount: number;
  /** Number of config entries that could not be matched to the inventory. */
  unresolvedCount: number;
}

/** Shape returned by GET /wallpaper-engine/inventory. */
export interface Inventory {
  /** Absolute Wallpaper Engine install dir, or null when not found. */
  installDir: string | null;
  /** Absolute upload directory (env → config.json → default); always a path. */
  uploadDir: string;
  /** Absolute WE official-assets directory (env / config.json), or null when unset. */
  weAssetsDir: string | null;
  /** Whether `weAssetsDir` currently holds a usable `materials/` tree. */
  weAssetsAvailable: boolean;
  /**
   * Origin (scheme://host:port) of the plugin's own wallpaper media source, for the
   * live renderer's `mediaBase` when rendering a Scene. Empty string means "use the
   * application origin" — native browsers need no second listener, and a failed media
   * source must degrade rather than blank the wallpaper.
   */
  sceneMediaBase: string;
  /** Total entries: installed WE wallpapers plus custom uploads. */
  total: number;
  /** Number of entries with playable media. */
  portableCount: number;
  /** All installed entries. */
  wallpapers: WallpaperDescriptor[];
  /** Saved Wallpaper Engine playlists available for scoped rotation. */
  playlists: PlaylistDescriptor[];
}

/** The host plugin hard-depends on the webserver service (`webServer`). */
export declare const inject: string[];

/** Registers every route on `ctx.webServer`; the returned disposer unwinds them on unload. */
export declare function apply(ctx: Context): () => void;

/** The plugin object form of the same two exports (`export default { inject, apply }`). */
declare const plugin: { inject: string[]; apply: typeof apply };
export default plugin;
