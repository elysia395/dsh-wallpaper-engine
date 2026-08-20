# dsh-plugin-wallpaper-engine

[English](README.en.md) | [中文](README.md) | [🆕 Beginner guide (中文)](README.beginner.md)

[![npm version](https://img.shields.io/npm/v/dsh-plugin-wallpaper-engine)](https://www.npmjs.com/package/dsh-plugin-wallpaper-engine)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![ci](https://github.com/elysia395/dsh-wallpaper-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/elysia395/dsh-wallpaper-engine/actions/workflows/ci.yml)

A DSH bundle that turns your local **Wallpaper Engine** wallpapers into the **background of the DSH web GUI** (`dsh web`), with an iOS-style liquid-glass effect.

> **Just want to use it?** The [beginner guide](README.beginner.md) (Chinese) walks through it click by click, zero jargon.

## Feature overview

- **Video / Web wallpapers**: `.mp4` plays in a `<video>` element, HTML loads in a sandboxed `<iframe>`;
- **Scene static frames** (v0.3): the main texture is extracted from `scene.pkg` / `scene.json` as a static background, with a quality gate and workshop-preview fallback;
- **Liquid glass**: the whole native DSH settings window plus the composer/bubbles are frosted glass, with unified accent / glass color / glass transparency / blur tuning;
- **Wallpaper picker modal**: thumbnail grid, pagination or CD-rack compact layout, content-rating (G/PG13/R) and type filters;
- **Hide / restore** (soft delete in localStorage — source files are never touched) and batch operations;
- **Playback speed** (0.5x–2x), **horizontal flip**, pause/play;
- **Custom uploads**: local JPG / PNG / MP4 as wallpapers, movable storage directory, fit modes (cover/contain/center/fill), SHA-256 deduplication;
- **Automatic rotation**: user-defined carousel lists (unlimited count, per-list interval and order), one-click import from WE playlists.

![Wallpaper showcase](https://raw.githubusercontent.com/elysia395/dsh-wallpaper-engine/main/docs/images/showcase.png)

> Wallpaper + scrim + iOS liquid glass rendered behind the DSH GUI.

## Supported wallpaper types

| Type | Rendered by | Portable to DSH? |
|---|---|---|
| **Scene** | WE's own 3D engine | ✅ Static frame — main texture extracted (`.tex` / embedded JPEG inside `.pkg`/`.json`) |
| **Video** | a plain `.mp4` file | ✅ `<video>` playback (Range seeking supported) |
| **Web** | WE's built-in Chromium host | ✅ Sandboxed `<iframe>` (see [Security model](#security-model)) |
| **Application** | an injected external window | ❌ No |

## Architecture

### Host half (`lib/index.js`, plain ESM, no build)

A Cordis plugin with a hard `inject: ['webServer']` dependency. It:

1. locates the WE install via Steam's `libraryfolders.vdf` and the registry (non-default Steam drives work);
2. enumerates wallpapers under `projects/defaultprojects`, `projects/myprojects`, `steamapps/workshop/content/431960/*`;
3. registers same-origin HTTP routes on the DSH webserver (contract table below);
4. manages the custom-upload directory (migration, persistence) and the scene-frame disk cache.

The inventory computation carries a **5-second TTL cache** (`?refresh=1` forces a rescan); the registry probe runs once per process.

### Client half (`src/client.js` → `lib/client.js`)

A browser module in the `window.__ModuleLoader__.load({ id, factory })` envelope. The canonical sources are `src/client.js` + `src/client.css`; `scripts/build-client.mjs` assembles the compiled artifact `lib/client.js`. **Never hand-edit `lib/client.js`.**

It fetches the inventory, renders the selected wallpaper into a fixed layer behind the app columns (`position:fixed; z-index:-2`) plus a scrim, and registers the first-level "Wallpaper Engine" settings page. All user preferences live in browser `localStorage` (key `dsh-wallpaper-engine:selection`).

## HTTP contract (host ↔ browser, same origin)

| Method | Path | Input | Response | Notes |
|---|---|---|---|---|
| GET | `/wallpaper-engine/inventory` | `?refresh=1` forces a rescan | JSON inventory | 5s TTL cache; `no-store` |
| GET | `/wallpaper-engine/media/<token>` | `Range` header | video / HTML stream | 206/416/304; `nosniff` |
| GET | `/wallpaper-engine/preview/<token>` | `Range` header | preview image stream | same as above |
| GET | `/wallpaper-engine/scene-frame/<token>` | — | JPEG / PNG | disk-cached, keyed by `<version>_<path>_<mtime>` |
| POST | `/wallpaper-engine/upload` | `?title=`; raw body; `Content-Type` whitelist | wallpaper entry | 512MB cap; streamed to disk; SHA-256 dedup |
| POST | `/wallpaper-engine/remove` | JSON `{ id }` | `{ removed }` | `up-*` files only |
| POST | `/wallpaper-engine/upload-dir` | JSON `{ dir, migrate? }` | migration stats | absolute path (`~` supported); config write failures are reported |

**Token mechanism**: `<token>` is the base64url of an absolute path, registered in the in-process `mediaMap` only while the inventory is enumerated. Routes serve only registered files — a browser cannot read arbitrary files by guessing tokens.

## Security model

The plugin serves **third-party local content** (Workshop wallpapers) and treats it as untrusted input:

- **Path containment**: the `file` / `preview` fields of `project.json` must resolve inside the project directory (validated with `path.relative`). A malicious project.json can no longer use absolute paths or `..\..` to get arbitrary files enumerated and served by `/media` / `/preview`.
- **Web-wallpaper sandbox**: `<iframe sandbox="allow-scripts allow-forms">` (**without** `allow-same-origin`). Wallpaper scripts run with an opaque origin and **cannot** reach the DSH page's `localStorage` or same-origin APIs; relative `<img>`/`<script>` subresources (no-cors requests) still load.
  - Known trade-off: interactive web wallpapers that rely on same-origin reads or pointer lock may lose some functionality. This is a deliberate trade-off, documented here.
- **Upload whitelist**: JPG / PNG / MP4 only, validated in both browser and host; 512MB cap; served with `X-Content-Type-Options: nosniff`.
- **No network egress**: media only flows over localhost; nothing is uploaded to any server.

## On-disk layout

```
~/.dsh-wallpaper-engine/
├── config.json          # remembers the upload directory (DSH_WE_UPLOAD_DIR env overrides)
├── uploads/             # custom uploads (default location; movable to any drive from settings)
│   └── .meta.json       # upload metadata (title + sha256, used for dedup)
└── cache/frames/        # scene static-frame cache (DSH_WE_CACHE_DIR overrides)
```

Apart from this data the plugin writes no durable DSH settings and adds zero tokens to the agent.

## Scene static frames: how it works

- **Reading**: parses `scene.pkg` (PKGV container + LZ4 entry chains) or a loose `scene.json` directory; locates the main texture starting from the first image object, with the remaining `.tex` files ranked by an art-likelihood score (embedded JPEG/PNG scores highest; mask/effect/depth penalized; R8/RG88 nearly excluded).
- **Decoding**: TEX containers (TEXV0005/TEXI0001, TEXB0001-4) → **RGBA8888 / R8 / RG88 / DXT1 / DXT3 / DXT5**, plus **WE embedded JPEG / PNG** (passed through untouched).
- **Quality gate**: frames that are >88% grayscale or flat (variance <3) are rejected and the next candidate is tried; when nothing passes, the project `preview.jpg` is served instead.
- **Cache**: keyed `<version>_<path>_<mtime>`; workshop updates invalidate frames automatically.
- **Limits**: BC7 / RGB565 / 16-bit-float textures cannot be decoded (preview fallback); a static frame is not a 3D render.

## Install

### For users (published version, recommended)

```sh
dsh plugin --profile web add dsh-plugin-wallpaper-engine
```

Restart `dsh web`, then open **Settings → Wallpaper Engine**.

> **macOS**: Wallpaper Engine has no macOS client. The macOS line of this plugin (WaifuX + loose-media support) is maintained by community maintainer Jerry and published separately:
>
> ```sh
> dsh plugin --profile web add dsh-plugin-wallpaper-engine-mac
> ```
>
> Repo: https://github.com/ruijiaang-lab/dsh-wallpaper-engine

### For developers (running your own copy)

```sh
git clone https://github.com/elysia395/dsh-wallpaper-engine.git
dsh plugin --profile web add link:<absolute-path-to-plugin-folder>
```

`link:` keeps a live link to your source folder: edit `src/client.js` or `src/client.css`, run `npm run build`, restart `dsh web`, and the change is live. The host half is plain ESM — edit and restart `dsh web`.

## Usage

1. `dsh web` → Settings → **Wallpaper Engine** in the left nav (a first-level settings page).
2. Click **选择壁纸** (pick wallpaper) to open the modal and click a wallpaper; ESC or the backdrop closes it.
3. The **壁纸效果** (wallpaper effects) area has four sliders: wallpaper blur / scrim / border / glass (0–60px, shared recipe with the settings-window glass).
4. The **外观** (appearance) area: the settings-window glass master switch, accent (6 presets + color picker), glass color, glass transparency.

All choices persist in `localStorage` across refreshes and restarts. Wallpapers differ wildly in brightness — try both the light and dark DSH themes to see which suits the current wallpaper; if text gets hard to read, raise the **scrim** and **border** sliders.

## Configuration & privacy

- No model-visible tool, no prompt text — zero token overhead for the agent.
- Hidden state, carousel lists, filters etc. live in browser `localStorage`; no durable DSH settings are written.
- The only on-disk data: uploaded files, `uploads/.meta.json`, `config.json` (~100 bytes), and the scene-frame cache (see [On-disk layout](#on-disk-layout)).
- Ratings come from each wallpaper's `contentrating` field (matching what the WE client shows) but do **not** follow the WE client's adult-content switch — the plugin scans the disk directly.

## dsh-better-sidebar compatibility

The liquid-glass effect is specifically adapted for dsh-better-sidebar's panels (frost, specular highlight and layer hierarchy are unified), so the sidebar and the conversation area share the same wallpaper + scrim background.

## Limitations

- Scene (native 3D) and Application wallpapers cannot be embedded; their live render remains Wallpaper Engine's desktop job.
- The browser must allow muted `<video>` autoplay (DSH runs on loopback; modern browsers allow this by default).
- Web wallpapers run in a sandbox without same-origin privileges (see [Security model](#security-model)).
- The picker text is Chinese/English mixed (not wired into DSH's locale namespaces; strings are centralized in the `STR` table at the top of `src/client.js` as groundwork for i18n).
- Pure shader/procedural scenes, exotic formats like BC7, and video-texture-driven scenes fall back to the workshop preview — expected behaviour, not a defect (measured ~80%+ of scenes produce a good static frame).

## Development

```sh
npm run build             # regenerate lib/client.js from src/client.js + src/client.css
npm test                  # = npm run verify && npm run verify:scene
npm run diagnose:scenes   # batch-diagnose local scene wallpapers → scene-diagnosis.tsv
```

- The host half (`lib/index.js`, `lib/pkg-extract.js`) is plain ESM with no build step.
- The client canonical sources are `src/client.js` (logic + React tree) and `src/client.css` (all styles); `scripts/build-client.mjs` injects the CSS into a template literal and emits the `window.__ModuleLoader__.load(...)` envelope. **Never hand-edit `lib/client.js`.**
- `npm install` / `pnpm install` runs `prepare` → `build`, so a fresh checkout always ships a current artifact.
- Tests require Node ≥ 18 (see `engines` in `package.json`); CI runs all verification scripts on Node 18/20/22.
- Binary parsing (PKG/LZ4/TEX/DXT/PNG) has a single implementation in `lib/pkg-extract.js`; `scripts/diagnose-scenes.mjs` reuses its exports — do not duplicate parsing logic in scripts.

### Repository size note

`docs/images/` is currently ~47MB (the `vinyl-record.gif` alone is 39MB). To compress:

```sh
# PNG (lossless)
oxipng --opt max docs/images/*.png
# GIF → animated WebP / MP4 (90%+ size reduction)
ffmpeg -i docs/images/vinyl-record.gif -c:v libwebp -lossless 0 docs/images/vinyl-record.webp
```

## Contributing

Edit `src/` first, then `npm run build`; run `npm test` before committing. MIT License — see [LICENSE](LICENSE).
