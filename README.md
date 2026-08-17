# dsh-plugin-wallpaper-engine

[English](README.md) | [中文](README.zh.md)

A DSH bundle that turns your **Wallpaper Engine** wallpapers into the **background of the DSH web GUI** (`dsh web`).

It discovers the wallpapers on your machine (WaifuX on macOS, Wallpaper Engine on Windows), lists them, and renders video/still wallpapers behind the DSH chat interface with an iOS-style **liquid glass** effect. You pick the wallpaper from a settings row, fine-tune it with four sliders, and pause/clear it anytime.

## Quick start (no command line needed)

**macOS (WaifuX wallpapers)**

1. Install **WaifuX**, log in (Steam account), download wallpapers you like — videos and stills both work
2. In DSH, open **Plugin Market**, search `wallpaper`, install this plugin (the mac build includes WaifuX support)
3. Open **Settings → General → Wallpaper Engine**, pick a wallpaper — the chat background updates immediately

No configuration needed: the plugin reads WaifuX's download folder automatically, and wallpapers you download later appear on their own. If text is hard to read, raise the **Dim** and **Border** sliders (instant effect). Wallpaper not showing? Restart DSH once after downloading, and make sure WaifuX uses its default download location.

**Windows (Wallpaper Engine wallpapers)**

1. Install **Wallpaper Engine** in Steam and subscribe to wallpapers (video / web)
2. Install this plugin from the DSH plugin market, then Settings → General → Wallpaper Engine → pick one

The plugin finds the Steam library automatically, on any drive.

## Why only Video and Web wallpapers?

Wallpaper Engine wallpapers come in four types:

| Type | Rendered by | Portable to DSH? |
|---|---|---|
| **Scene** | Wallpaper Engine's own 3D engine | ❌ No — native 3D (`.obj`/shaders), only WE can render it |
| **Video** | a plain `.mp4` file | ✅ Yes — plays in a `<video>` tag |
| **Web** | a Chromium (`webwallpaper64.exe`) host for HTML | ✅ Yes — loads in an `<iframe>` |
| **Application** | an injected external window | ❌ No |

This is the same fundamental limit that applies to **mineradio** and every other
third-party Wallpaper Engine integration: only *Video* and *Web* wallpapers are
portable. Scene wallpapers still show up in the picker (shown as `[不可播放]`)
so you can see what you have, but they cannot be used as a live background here.

## How it works

- **Host half** (`lib/index.js`): a Cordis plugin that
  1. locates the Wallpaper Engine install by reading Steam's `libraryfolders.vdf`
     (so it works even when Steam is on a non-default drive),
  2. enumerates wallpapers from `projects/defaultprojects`, `projects/myprojects`,
     and `steamapps/workshop/content/431960/*`,
  3. registers same-origin HTTP routes on the DSH webserver so the browser half
     can fetch data and stream media directly:
     - `GET /wallpaper-engine/inventory` → JSON list of wallpapers
     - `GET /wallpaper-engine/media/<token>` → video / HTML (Range supported)
     - `GET /wallpaper-engine/preview/<token>` → preview image
- **Client half** (`lib/client.js`): a browser module that fetches the inventory
  and renders the selected wallpaper into a fixed layer *behind* the app columns,
  plus a "Wallpaper Engine" row in General settings with a picker.

## Install

### For users (published version, recommended)

If you simply want to use the plugin, install the published package from npm:

```sh
dsh plugin --profile web add dsh-plugin-wallpaper-engine
```

Then restart `dsh web` and open **Settings → General → Wallpaper Engine**.

### For developers (running your own copy)

**For most people you can skip this section.** You only need it if you want to
work on the plugin's code yourself. The steps below assume you know what a command
line and a *repository* (a code folder that is under Git version control) are.

**1. Get the code (`checkout`)**

> *What "checkout" means:* it just means "download/get a copy of the source code
> into a folder on your machine." Typically you click **Code → Download ZIP** on
> this GitHub page and unzip it, or clone it with Git:
>
> ```sh
> git clone https://github.com/elysia395/dsh-wallpaper-engine.git
> ```
>
> After this you have a folder that contains `package.json`, `lib/`, `src/`, and
> `cordis.patch.yml`. That folder is what the rest of this section calls
> **the plugin folder**.

**2. Install it using its folder path (`link:`)**

> *What `link:` means here:* it tells `dsh` (which forwards the command to `pnpm`)
> to make a *link* to your local plugin folder instead of downloading a package
> from the internet. The benefit: when you edit the code and rebuild, the change
> shows up without reinstalling.

Replace `<插件文件夹绝对路径>` below with the **full path of your plugin folder**
(the "address bar" path you see when you open that folder in Explorer / your file
manager):

```sh
dsh plugin --profile web add link:<插件文件夹绝对路径>
```

**Concrete example** — if your plugin folder is at a path like `D:\dev\dsh-wallpaper-engine`:

```sh
dsh plugin --profile web add link:D:\dev\dsh-wallpaper-engine
```

You can also use a relative path if your shell's current directory is already the
folder's parent:

```sh
dsh plugin --profile web add link:./dsh-wallpaper-engine
```

> **Which exact path to fill in?** It must be the **folder that contains
> `package.json`** — not the path to `package.json` itself, and not any file inside.
> It is the same value you would paste into Explorer's address bar to open that folder.

> Why prefer `link:` over `file:`? `link:` creates a live link to your source
> folder, so edits to `src/client.js` + `npm run build` take effect without
> reinstalling; `file:` packs a static snapshot, which needs a re-add after every
> change. Both work for a first install.

Then restart `dsh web`. The host plugin becomes a bundle layer and the client
plugin auto-loads (`dsh.client.immediately: true`).

If your machine has Steam installed in a non-standard location, the host auto-detects
via `libraryfolders.vdf`. Nothing further is required.

## Usage

1. Open `dsh web` → the DSH GUI.
2. Open **Settings → General** and find the **Wallpaper Engine** row.
3. Pick a Video or Web wallpaper from the dropdown. It appears behind the app.
4. Use **暂停/播放** to pause a video wallpaper, and **关闭** to clear it.
   The choice is remembered in your browser's `localStorage` (key
   `dsh-wallpaper-engine:selection`).

### The four sliders

While a wallpaper is active, four sliders let you tune how it blends with the UI:

| Slider | What it controls | Range | Default |
|---|---|---|---|
| **壁纸模糊** (wallpaper blur) | Blurs the wallpaper itself | 0–60 px | 0 |
| **暗化** (scrim) | Darkens the overlay between wallpaper and text | 0–90 % | 25 % |
| **边框** (border) | Raises border/divider contrast | 0–90 % | 35 % |
| **玻璃** (glass) | Blur radius of the frosted-glass panels (composer, bubbles) | 0–40 px | 24 |

> **Light vs. dark mode** — Wallpapers differ wildly in colour and brightness, so
> there is no one mode that fits every wallpaper. Switch DSH's theme between
> **light** and **dark** to find which suits the current wallpaper. If text or
> hairlines become hard to read on a bright or busy wallpaper, raise the
> **暗化 / 边框** sliders (and optionally add a little **壁纸模糊**) until it is
> comfortable. All four sliders apply instantly — no page refresh needed.

## Configuration

There is no model-visible tool or prompt text. The bundle adds zero tokens to the
agent. All state is process-local/browser-local; no durable DSH settings are written.

## macOS

Wallpaper Engine has no macOS client, so on macOS the plugin is **directory-driven**
instead of Steam-driven. It scans content folders and treats every `.mp4`/`.webm`
(video) and `.png`/`.jpg`/`.gif`/`.webp` (image) file in them as a wallpaper:

- **WaifuX** (the popular macOS wallpaper app) — its download folders are
  scanned by default (`Wallpapers/` for static images, `Media/` for motion
  videos), and so are the **Wallpaper Engine workshop items WaifuX downloads
  via its bundled steamcmd** (standard Steam directory, no setup), so anything
  you save in WaifuX becomes a DSH background with no setup.
- `~/Documents/dsh/we-content/` — drop loose files here to use them as backgrounds.
- Any folders listed in `DSH_WALLPAPER_ENGINE_CONTENT` (colon-separated), or a
  copied Wallpaper Engine install/projects tree.

## Limitations

- Scene (native 3D) and Application wallpapers cannot be embedded; they appear as
  `[不可播放]` in the picker. Their live render remains Wallpaper Engine's desktop job.
- The browser must be able to autoplay muted `<video>` (DSH runs on loopback; muted
  autoplay is allowed by modern browsers).
- Media is served from your local Wallpaper Engine install paths; the host only
  serves files it has already enumerated (no arbitrary filesystem exposure).
- The picker is English/Chinese mixed (this bundle is not yet wired into DSH's
  locale namespaces).

## Development / rebuild

The host half (`lib/index.js`) is plain ESM with no build step. The client half
(`lib/client.js`) is a **compiled artifact** produced from the canonical source
`src/client.js` by `scripts/build-client.mjs`, which emits the exact
`window.__ModuleLoader__.load({ id, factory })` envelope the DSH module loader
consumes (the same shape `tsdown` emits for in-box client packages).

```sh
npm run build      # regenerate lib/client.js from src/client.js
npm run verify     # materialize the emitted bundle and assert its exports
```

Edit `src/client.js`, then `npm run build`. Do not hand-edit `lib/client.js`.
`npm install`/`pnpm install` runs `prepare` → `build` automatically, so a
fresh checkout always ships a current `lib/client.js`.

The host↔browser contract is plain same-origin HTTP, so the two halves are
developed independently: rebuild the host by restarting `dsh web`, and rebuild
the client with `npm run build` before re-running `dsh web`.

