# dsh-plugin-wallpaper-engine

[English](README.en.md) | [中文](README.md)

> 🆕 Never used the command line? Start here: **[beginner-friendly guide →](README.beginner.md)** (a simplified walkthrough in Chinese for users who have never touched a terminal).

A DSH bundle that turns your **Wallpaper Engine** wallpapers into the **background of the DSH web GUI** (`dsh web`).

![Main interface showcase](docs/images/main-interface.gif)

> Wallpaper + scrim + iOS liquid glass rendered behind the DSH GUI.

It discovers the Wallpaper Engine install on your machine, lists its wallpapers, and renders the *portable* ones behind the DSH chat interface with an iOS-style **liquid glass** effect. What you get out of the box:

- **All four wallpaper types covered** — Video (`.mp4`) with hardware decoding, Web/HTML in an iframe, Scene replayed as a full-scene frame by the built-in renderer, Image via custom uploads (local JPG / PNG / MP4);
- **One look, fully controllable** — accent colour, glass colour and transparency, liquid glass for the whole settings window and the sidebar, custom typography and input-caret colour; everything applies instantly and persists;
- **Eight picture sliders** — wallpaper blur / brightness / contrast / saturation / wallpaper opacity / scrim / border / glass;
- **Battery & performance** — occlusion pause (minimize / focus-loss / battery, three toggles) and a decode frame-rate cap (host-side frame-skip transcode that cuts hardware-decoder load sharply);
- **Library management** — thumbnail picker modal, hide / restore (soft delete), content-rating and type filters, CD-rack compact layout, spinning vinyl record;
- **Automatic rotation** — any number of user-defined lists, each with its own interval and playback order;
- **Mascot pull-cord** — a rope along the top of the chat; pull it down to open the **wallpaper repo** drawer (six tabs of quick controls);
- **Settings stored in a host file** (since v0.4.0) — they survive restarts, port changes, browser-data clears and browser switches.

> The full feature list and the per-release change log live in **[`docs/CHANGELOG.md`](docs/CHANGELOG.md)** (Chinese-first, English section included).

> ⚠️ **Two prerequisites before you update this plugin**: ① the DSH kernel / DSH Desktop is current (harness 0.1.5-rc.1, DSH Desktop ≥ 2.0.7); ② dsh-better-sidebar ≥ 0.19.0 (if you are still on the older 0.1.2-rc.1 kernel, stay on 0.18.x — do not mix).
>
> The correct update order, the compatibility matrix and how to recover from updating out of order: **[`docs/UPGRADING.md`](docs/UPGRADING.md)**.

## Which wallpaper types are supported?

Wallpaper Engine wallpapers come in four types:

| Type | Rendered by | Portable to DSH? |
|---|---|---|
| **Scene** | Wallpaper Engine's own 3D engine | ✅ Full-scene frame — a pure-JS scene renderer (object tree / textures / particles / shader effects), see below |
| **Video** | a plain `.mp4` file | ✅ Yes — plays in a `<video>` tag |
| **Web** | a Chromium (`webwallpaper64.exe`) host for HTML | ✅ Yes — loads in an `<iframe>` |
| **Image** | — (this plugin's custom upload) | ✅ Yes — upload local JPG / PNG as a wallpaper |
| **Application** | an injected external window | ❌ No |

> A Scene wallpaper is rendered by the built-in **pure-JS scene renderer** into a **3840-wide** full-scene frame (height derived from the scene aspect — 2160 for a 16:9 scene; object tree / textures / puppet meshes / shader effects / particles); on failure it falls back step by step to the main-texture extraction, then to the workshop preview image. Implementation details, the host / client split and the complete HTTP route table: **[`docs/HOW-IT-WORKS.md`](docs/HOW-IT-WORKS.md)**.


## Settings persistence (v0.4.0)

**All your settings (selected wallpaper, colors, transparency, layout, rotation,
hidden wallpapers, playback speed / flip, …) are stored in a host-side file
since v0.4.0 — no longer in browser localStorage.**

- **Where**: `~/.dsh-wallpaper-engine/config.json` (the same file that stores
  the upload-directory preference). Concrete locations:
  - Windows: `C:\Users\<your-user>\.dsh-wallpaper-engine\config.json`
  - WSL / Linux / macOS: `~/.dsh-wallpaper-engine/config.json`
- **Why**: settings used to live in browser localStorage, which is isolated by
  *origin* (scheme + host + **port**). DSH Desktop starts the harness on a
  **random port every launch**, so each start looked like a brand-new storage
  space and every setting fell back to defaults (plain web on a fixed port was
  unaffected). Storing on the host makes persistence port-independent.
- **What you get**: settings survive restarts, port changes, browser-data
  clears, browser switches and private windows.
- **Migration**: config saved by older versions in localStorage is **migrated
  automatically on first launch** — nothing to do.
- **Behavior change to know**: on one machine, multiple browsers (e.g. Chrome
  and Edge) or devices pointing at the same dsh now **share one configuration**
  (previously each had its own). If you roll back to an older version, it still
  reads the localStorage cache copy, so nothing is lost.
- **Writes**: every settings change is persisted automatically (debounced
  200 ms); if the file is corrupted the plugin falls back to defaults and does
  not overwrite your file.
- **What still lives in the browser**: only pure UI state — the **active tab**
  shared by the settings page and the drawer (one `localStorage` key), plus the
  mascot rope's **snap position**. Browser `localStorage` also acts as a **synchronous read
  cache** and a fallback when the host routes are unreachable, but it is no longer
  the source of truth for any setting.

## Install

### For users (published version, recommended)

If you simply want to use the plugin, install the published package from npm:

```sh
dsh plugin --profile web add dsh-plugin-wallpaper-engine
```

Then restart `dsh web` and open **Settings → Wallpaper Engine**.

> **macOS users**: Wallpaper Engine has no macOS client. The macOS line of this
> plugin (WaifuX + loose-media support) is maintained by Jerry and published as
> a separate npm package:
>
> ```sh
> dsh plugin --profile web add dsh-plugin-wallpaper-engine-mac
> ```
>
> Repo: https://github.com/ruijiaang-lab/dsh-wallpaper-engine

### For developers (running your own copy)

**For most people you can skip this section.** The full walkthrough for installing from a local
checkout with `link:` (including what "checkout" means and which exact path to fill in) now lives in the
**[contribution guide](CONTRIBUTING.md)** — you only need it if you want to work on the plugin's code yourself.

### Troubleshooting install failures

Symptom-and-fix steps for the common install errors now live in
**[`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)**: a stale pnpm virtual store in the profile
(`ERR_PNPM_UNEXPECTED_VIRTUAL_STORE`), `github:` installs rejected by the `allowBuilds` allowlist
(`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`), and a "symptom → where to look first" table.


## Usage

1. Open `dsh web` → the DSH GUI.
2. Open **Settings** and pick **Wallpaper Engine** from the left navigation (a first-level settings page, its own nav entry).
3. Click **选择壁纸** to open the picker modal, then click a Video/Web/Scene wallpaper (or an uploaded image/video) in the thumbnail grid. It appears behind the app; close the modal via the backdrop, ESC, or the close button. Application wallpapers cannot be embedded in the web UI and are hidden from the grid.
4. Use **暂停/播放** to pause a video wallpaper, and **关闭** to clear it.
   The choice is persisted host-side to `~/.dsh-wallpaper-engine/config.json` (the browser's `localStorage` is only a sync cache and fallback — see 「Settings persistence」 below).

![Settings UI overview](docs/images/settings-ui.gif)

> The settings page: the liquid-glass card with six tabs (壁纸 / 外观 / 字体 / 吉祥物 / 效果 / 高级).

![Wallpaper picker modal](docs/images/wallpaper-library.gif)

> The picker modal: browse every wallpaper thumbnail, batch-hide, and restore from the hidden tab.

### Six adjustment tabs

The settings page and the wallpaper-repo drawer share the same **top category
tabs** — every control is grouped into one of six domains, each tab showing only
the 3–8 controls that belong there instead of a thirty-item single column:

| Tab | Contents |
|---|---|
| **壁纸** (wallpaper, default) | current-wallpaper card (vinyl + picker + pause/close/refresh), auto-rotation, custom wallpapers |
| **外观** (appearance) | accent, glass color, glass transparency, settings-window glass, sidebar glass & content surface |
| **字体** (typography) | master switch + color / weight / family, input caret color |
| **吉祥物** (mascot) | visibility switch, form cards (artwork doubles as a live preview), size slider |
| **效果** (effects) | wallpaper blur / brightness / contrast / saturate / wallpaper opacity / scrim / border / glass, playback speed, fps cap, fit, flip, occlusion pause, beta scene animation / GPU render acceleration (scene wallpapers only, experimental) (an empty state guides you to pick a wallpaper first) |
| **高级** (advanced) | compact layout, Edge compatibility |

The pill indicator slides between tabs; the settings page and the drawer share
one stored tab (a single `localStorage` key — switching a tab in the settings page
leaves the drawer opening on that same tab; never written to the config file). Long explanations moved into tooltips — each row keeps a one-line hint.

### Hide & restore (soft delete)

Every wallpaper card has a **隐藏** button in its top-right corner — it only removes the wallpaper from the list, **never touches the source file**. Restore any wallpaper from the **已隐藏** tab in the modal (single restore or **全部恢复**); the **批量** button in the modal toolbar enters multi-select mode to hide several at once. Hidden state is persisted host-side with the rest of your settings (survives refresh / restart / browser switches); hiding the currently playing wallpaper doesn't interrupt playback, and automatic rotation skips hidden wallpapers.

### Content-rating & type filters

Above the thumbnail grid in the picker modal there are two dropdowns that
reproduce Wallpaper Engine's own categorisation:

- **内容分级** (content rating) — reads each wallpaper's `contentrating` field
  (WE wallpapers: `project.json`; custom uploads: `uploads/.meta.json`; the
  field mirrors WE's workshop tags G / PG13 / R): **全部** (all) /
  **Everyone (G, default)** / **PG13** (parental guidance) / **Mature (R)** /
  **未分级** (unrated — wallpapers without the field, typically local projects).
  An upload without a rating counts as **Everyone**
  ([#84](https://github.com/elysia395/dsh-wallpaper-engine/issues/84): the
  default filter would otherwise hide the user's own files entirely — absent
  from the grid and impossible to select).
- **类型** (type) — filters by the embeddable type: **全部** (all) / **视频**
  (video) / **网页** (web) / **图片** (image, custom uploads) / **场景** (scene,
  static frame).

Every option shows how many playable wallpapers currently match. Wallpapers
outside the selected categories are dropped from the grid, the rotation editor
and the rotation candidates — they are never auto-selected or rotated either.
The choice is persisted host-side to `config.json`; the default is **Everyone**,
mirroring Wallpaper Engine's conservative first-run stance.

> Note: the rating is read from each wallpaper file's `contentrating` field —
> the same rating WE's client shows — but the plugin does **not** follow the
> adult-content switch inside the Wallpaper Engine client (it scans the disk
> directly and bypasses WE's configuration).

### Card style & vinyl record

- **紧凑布局 (compact layout)**: a sliding toggle in the **高级** (advanced) tab.
  ON gives the **CD-rack** look — cards stack like CD jewel cases
  (each row's top covers the row above, vertical only), hovering scales the
  card up and brings it to the front, the grid is tighter (~7 cards per row)
  and shows everything on ONE page with no pagination. OFF is the regular
  grid (fixed-height overlap-proof cards with pagination, default). The
  choice is persisted host-side to `config.json`.
- **黑胶唱片 (vinyl record)**: next to the wallpaper selection there is a
  **rotating vinyl record** that uses the selected wallpaper's cover as the
  record label — it spins while the wallpaper plays and stops when paused
  (animation is disabled under `prefers-reduced-motion`). A small record also
  sits in the picker modal head. The vinyl shows in **both** card styles.

### Playback speed & horizontal flip

With a video wallpaper selected, the **效果** (effects) tab shows the **倍速** presets (0.5x / 0.75x / 1x / 1.25x / 1.5x / 2x) — driven by the browser's native `playbackRate`, instant, no reload or black flash (wallpaper videos are muted, so there is no audio to keep in sync). The **水平翻转** toggle mirrors the image via CSS `scaleX(-1)` — it works for video, web, and uploaded images/videos alike, with zero main-thread cost.

### Occlusion pause (battery-saving trio)

Like Wallpaper Engine's "pause when covered" — the main reason desktop WE is ~0 GPU most of the time. Browsers cannot detect window occlusion directly, so the plugin uses the three closest signals (toggles in the **效果** tab, instant + persisted):

| Toggle | Default | Behavior |
|---|---|---|
| **最小化/切页时暂停** (pause on minimize/tab-switch) | on | pauses the video when the page is hidden (minimized / tab switched away); the decoder drops to zero — explicit `pause`, since browser throttling alone does not guarantee stopped decoding |
| **窗口失焦时暂停** (pause on focus loss) | off | pauses when another app takes focus (the wallpaper is likely covered) |
| **使用电池时暂停** (pause on battery) | off | pauses while on battery via `navigator.getBattery` (no-op in browsers without it) |

Playback resumes automatically when you come back / regain focus / plug in (unless you paused manually). Video wallpapers only — web (iframe) wallpapers cannot be paused from outside and are only throttled by the browser while the page is hidden.

### Decode frame-rate cap (frame-skip transcode)

High-fps sources (e.g. 4K120 H.264) dominate GPU decode (~60% Video Decode at 1.0x on a 4060). The **帧率上限** control (unlimited / 60 / 48 / 30 / 24 fps) has the host re-encode the wallpaper ONCE to the capped frame rate via ffmpeg — the timeline stays **1.0x normal speed** and stays fully decoupled from 倍速 — output is **4K-preserving AV1** (NVDEC decode throughput for AV1 is roughly 2× H.264), cached under `~/.dsh-wallpaper-engine/cache/transcodes/`.

- The original plays **first**, and the app swaps to the transcoded file when ready; the settings page shows a **live progress bar** (downloading ffmpeg % → transcoding % with an estimated-seconds-readout → finalizing → switch). First run takes a few tens of seconds (including a possible one-time ffmpeg download); afterwards the same wallpaper opens instantly.
- Sources at/below the cap are skipped; transcode failures transparently fall back to the original — nothing else is affected.
- Measured: 4K120 → 24fps AV1 drops GPU from ~60% to **~15%**.
- Cached per path+mtime+cap, so rotation pays the cost once per wallpaper.

**ffmpeg provisioning (three tiers, auto-detected in order)**:

| Tier | Notes |
|---|---|
| **Explicit** | `DSH_WE_FFMPEG` env var pointing at any ffmpeg binary, or drop one into the plugin dir as `./ffmpeg/ffmpeg(.exe)` — both take priority |
| **Auto-download** | with no local ffmpeg, the first use downloads a pinned single-file build for the platform (Windows x64 / Linux x64·arm64 / macOS x64·arm64 etc., asset table verified) from a **dual-source race**: `npmmirror` (fast in CN) vs GitHub release (fast elsewhere), first success wins — streamed to disk, magic-byte/size verified, 5-minute per-source timeout, cached at `~/.dsh-wallpaper-engine/ffmpeg/`. `DSH_WE_FFMPEG_URL` overrides the source (self-hosted mirror / proxy). |
| **System PATH** | falls back to a bare `ffmpeg`; if none exists the wallpaper silently stays on the original |

> Transcoding uses **NVENC** (`av1_nvenc`, falling back to `h264_nvenc`) and requires an NVIDIA GPU + driver; without one the feature auto-disables. No ffmpeg or a failed transcode simply disables the feature — no side effects.

### Custom wallpapers

The **自定义壁纸** section uploads local images (JPG / PNG) or videos (MP4) as wallpapers:

- **Storage location**: files default to `~/.dsh-wallpaper-engine/uploads` (your home directory — usually the C: drive). Click **更改** to move storage to any drive (absolute path, `~` supported); existing files migrate automatically and the choice persists across restarts — recommended for users who don't want wallpaper data on the system drive.
- **Format limit**: JPG / PNG / MP4 only; validated twice (browser + host) with a clear error message.
- **Video thumbnails**: uploaded MP4s get an on-demand ffmpeg-extracted thumbnail in the picker (the first second is skipped to avoid black fade-ins), cached under `~/.dsh-wallpaper-engine/cache/video-previews/`; without ffmpeg the card keeps the "no preview" placeholder and playback is unaffected.
- **Fit modes**: 覆盖 (cover) / 填充 (contain) / 居中 (center) / 拉伸 (fill) — applied to every wallpaper type (web iframes don't read `object-fit`, so they are unaffected).
- **Management**: each upload can be **移除** (confirm dialog, deletes the local file); uploaded wallpapers also support hide/restore, playback speed, and flip.
- **Deduplication**: re-uploading an identical file is detected by content (SHA-256) and returns the existing entry — no duplicate copies pile up in the library.

### Automatic rotation (轮播列表)

Rotation runs over **user-defined carousel lists** (the 自动轮播 group in the **壁纸** tab). Create any number of lists with **新建**, pick Video/Web wallpapers — or a Scene whose frame is available — into each from the inventory, give each list its own switch interval (1, 5, 10, 30, 60 or 120 minutes) and order (顺序/随机), then enable **自动轮转** on the list you want active. Lists are persisted host-side to `~/.dsh-wallpaper-engine/config.json`; **rotation runs entirely client-side** and never depends on Wallpaper Engine's own `config.json` playlist paths.

At least two playable wallpapers per list are required (Video/Web, or a Scene served as a static frame); manual changes reset the next timer; each list keeps its own cadence, so you can have one list switching every 5 minutes and another every 30. On first run, the first playable Wallpaper Engine playlist is imported automatically as a list so the feature works out of the box; **从 WE 播放列表导入** inside the editor imports any other playlist into the list being edited. Application wallpapers cannot be embedded in the web UI, so they are automatically excluded from rotation and hidden from the picker; Scene wallpapers (playable as a static frame) can join rotation.

### Liquid-glass appearance (whole settings window + accent + transparency)

The **外观** (appearance) tab controls the look
of the **entire native DSH settings window** (following the dsh-web-ui-all
skin-center design):

| Control | What it controls | Range | Default |
|---|---|---|---|
| **设置窗口液态玻璃** (settings-window glass) | Master switch: turns the whole settings window (dialog + left nav + all native sections) into liquid glass | on / off | on |
| **配色** (accent) | Theme color: buttons, switches, links, nav active, sliders and glass highlights inside the window all follow it | 6 presets + custom color picker | `#4f8cff` classic blue |
| **玻璃颜色** (glass color) | The BASE TINT of the settings-window glass itself (not just transparency) | 6 presets + custom color picker | white (light) / deep navy (dark) |
| **玻璃透明度** (glass transparency) | Opacity of the glass surfaces (settings window, composer, bubbles, sidebar panels) | 0–60 % | 12 % |

> With the master switch on, **every native section** (General / Models /
> Plugins / …) and the left nav become one liquid-glass + accent look — the
> plugin overrides the shell tokens scoped to the settings dialog, so nothing
> outside the window is touched. The settings-window glass blur uses the SAME
> adjustment range as the conversation bar: the **玻璃** (glass) slider (0–60 px)
> drives the blur radius of both the settings window and the composer/bubbles,
> with an identical saturation/brightness/contrast recipe; **玻璃颜色** sets the
> base tint of the glass itself (defaults white in light / deep navy in dark;
> once picked, both themes use that color), and the **玻璃透明度** control sets
> the transparency — higher lets the wallpaper colour show through more clearly,
> lower approaches solid. Browsers without `backdrop-filter` automatically fall
> back to a high-opacity solid so text stays readable. All controls apply
> instantly and persist host-side to `config.json` (they survive restarts and
> browser switches).

### Mascot (chat pull-cord)

The **吉祥物** (mascot) tab controls the chat **pull-cord** (a draggable rope pinned to the top edge; pulling it down slides out the **wallpaper repo** drawer). The **form** picker renders as cards — each card draws the actual artwork scaled by the current **吉祥物大小** slider, so choosing a form and judging its size happen in one place:

| Control | What it does | Range | Default |
|---|---|---|---|
| **显示吉祥物** (show mascot) | Whether the pull-cord mascot and its wallpaper-repo drawer render | on / off | on |
| **吉祥物形态** (mascot form) | Switch artwork: default **小女仆** (near-square chibi) or **鲸御姐** (portrait 2:3 full-body) | 小女仆 / 鲸御姐 | 小女仆 |
| **吉祥物大小** (mascot size) | Scale the mascot (the rope box follows the ratio; drag / snap geometry adapts automatically) | 0.5×–2.5× | 1× |

> Both artworks are inlined as base64 (transparent background) at build time, so the single-file client bundle stays self-contained. **Size** changes only the rope's own box; the wallpaper-repo drawer below is unaffected. Settings apply instantly and persist to the host-side config file.

![Mascot quick-adjustment drawer](docs/images/mascot-drawer.png)

> Pull the top rope mascot to slide out the **wallpaper repo** drawer: six-tab quick adjustments with the vinyl card, rotation and custom-wallpaper management within reach.

### Custom typography

The **字体** (typography) tab holds the dedicated typography section. The **master switch defaults to off** — the UI keeps the stock dsh typography with zero injected styling; turn it on to apply the three knobs below. Every change applies instantly and persists (the adjustment panel's own labels always stay in theme ink — they are deliberately excluded from the 字体颜色 tint to keep the panel readable):

| Control | What it does | Range / options | Default |
|---|---|---|---|
| **字体自定义** | Master switch: off = fully restore the stock dsh fonts (one-click reset) | on / off | off |
| **字体颜色** | Global text tint | custom color picker | `#000000` |
| **字重** | Global font weight | 100–900 (step 50) | 400 |
| **字体** | Font family switch | default · YaHei · KaiTi · SimSun · SimHei · 行楷 (Xingkai) · monospace | default |

> Each **字体** chip renders in its own font (WYSIWYG preview); 行楷 maps to `STXingkai` (falls back to KaiTi when not installed, `Xingkai SC` on macOS). Error / danger / warning elements keep their system red color — global tinting never overrides them.

### Input caret color

The text caret takes its color from the dsh theme, while the wallpaper shows
straight through the liquid-glass composer behind it — when the two colors are
close, the caret becomes invisible ([#83](https://github.com/elysia395/dsh-wallpaper-engine/issues/83)).
The **输入光标** section on the typography tab gives the caret its own color control:

| Option | What it does |
|---|---|
| **自动** (auto) | Injects nothing — the caret keeps the native dsh behavior (default) |
| **6 preset colors** | white / black / classic blue / ice cyan / rose pink / coral red — black & white give the strongest contrast on light / dark wallpapers |
| **Custom picker** | any color |

Once picked, the color is applied via `caret-color` to **every** text input
(inputs, textareas, editable areas), instantly and persistently; it is
independent of the **字体自定义** master switch — you do not need to turn on
global font tinting just to make the caret visible.

### The eight sliders

The **效果** (effects) tab — available while a wallpaper is active — offers eight sliders to tune how it blends with the UI:

| Slider | What it controls | Range | Default |
|---|---|---|---|
| **壁纸模糊** (wallpaper blur) | Blurs the wallpaper itself | 0–60 px | 0 |
| **亮度** (brightness) | Wallpaper brightness (media filter) | 40–160 % | 100 % |
| **对比度** (contrast) | Wallpaper contrast (media filter) | 40–200 % | 100 % |
| **饱和度** (saturate) | Wallpaper saturation (media filter) | 0–200 % | 100 % |
| **壁纸透明度** (wallpaper opacity) | Transparency of the whole wallpaper layer (higher = more transparent): fading it out blends the wallpaper into the page base colour — the IDEA background-image style of "visible but not overpowering". Complements **暗化** (scrim): one fades the wallpaper itself, the other darkens the whole picture; for the blend-into-base look, combine higher opacity with a lower scrim | 0–90 % | 0 % |
| **暗化** (scrim) | Darkens the overlay between wallpaper and text | 0–90 % | 25 % |
| **边框** (border) | Raises border/divider contrast | 0–90 % | 35 % |
| **玻璃** (glass) | Blur radius of the frosted-glass panels (composer, bubbles) | 0–60 px | 16 |

> **Light vs. dark mode** — Wallpapers differ wildly in colour and brightness, so
> there is no one mode that fits every wallpaper. Switch DSH's theme between
> **light** and **dark** to find which suits the current wallpaper. If text or
> hairlines become hard to read on a bright or busy wallpaper, raise the
> **暗化 / 边框** sliders, or use **亮度** to tame an overly bright wallpaper
> (and optionally add a little **壁纸模糊**) until it is comfortable; if the
> wallpaper is too loud instead, raise **壁纸透明度** to let it recede into the
> base colour. All eight sliders apply instantly — no page refresh needed.

## Configuration

There is no model-visible tool or prompt text. The bundle adds zero tokens to the
agent, and no **durable DSH setting** is written (the harness settings system is
untouched). The plugin's own on-disk data is only:

- `~/.dsh-wallpaper-engine/config.json` — **every plugin setting** (selected
  wallpaper, hidden list, rotation lists, appearance / typography / effects
  controls) plus the **upload directory**, i.e. 「Settings persistence」 above;
- the **custom-upload files** and the **caches** — `uploads/` and
  `cache/frames/`, `cache/transcodes/`, `cache/video-previews/`, `ffmpeg/` under the directories you chose
  (the cache root can be overridden with `DSH_WE_CACHE_DIR`).

Browser `localStorage` keeps only pure UI state (tab memory, rope position) and
acts as a synchronous read cache / fallback for the config.

**Environment variables**:

| Variable | Purpose |
|---|---|
| `DSH_WE_FFMPEG` | explicit ffmpeg executable path (highest priority in the resolution chain) |
| `DSH_WE_FFMPEG_URL` | replaces the auto-download source (self-hosted mirror / proxy) |
| `DSH_WE_CACHE_DIR` | overrides the cache root (transcode cache / scene-frame cache) |
| `DSH_WE_STEAM_ROOT` | explicit Steam root(s) (comma/semicolon separated, Windows or /mnt paths; fallback when registry/auto-detection misses) |

## dsh-better-sidebar compatibility

The liquid-glass effect is specifically adapted for dsh-better-sidebar's panels
(frost, specular highlight, and layer hierarchy are unified), so the sidebar and
the conversation area share the same wallpaper + scrim background and read as one
continuous surface.

The **外观** tab exposes a set of **sidebar glass** controls independent of
both the conversation glass and the active wallpaper. Even with no Wallpaper
Engine wallpaper selected, the sidebar can be tinted and frosted over the stock
DSH surface or another background source. These controls target only the
dsh-better-sidebar subtree; browsers without `backdrop-filter` fall back to a
near-opaque fill:

| Control | What it controls | Range | Default |
|---|---|---|---|
| **侧栏液态玻璃** | Master switch: frost the sidebar panels | On / off | On |
| **侧栏模糊** | Blur radius of the sidebar frost | 0–200 px | 16 |
| **侧栏透明度** | Sidebar glass density (**higher = clearer**: 0 densest / 200 clearest) | 0–200 % | 120 % |
| **侧栏玻璃颜色** | Sidebar glass **base tint** | 6 presets + custom picker | `#ffffff` white |

> Sidebar glass is a separate set of knobs from the settings-window glass: the
> conversation「玻璃」slider only drives the composer/bubbles, while the sidebar
> sliders drive the sidebar. Turning **侧栏液态玻璃** off restores the native
> sidebar, including its editor/terminal content surfaces. The sidebar defaults
> to a fairly clear glass (so it matches the background instead of glowing
> white); editor/terminal content surfaces have their own near-opaque fill +
> transparency controls to keep text readable in the narrow panels.

![dsh-better-sidebar compatibility & custom typography](docs/images/better-sidebar-font.png)

> The sidebar glass adaptation with the custom typography (行楷) applied at the same time.

## Documentation

| Document | Contents |
|---|---|
| **This page** (`README.en.md`) | Facade: capability overview, supported wallpaper types, install, the complete user guide (six tabs / eight sliders / appearance / mascot / typography / rotation / custom uploads) |
| [`README.md`](README.md) | 中文 README (the primary user guide — Chinese is the reference language) |
| [`README.beginner.md`](README.beginner.md) | Beginner-friendly walkthrough (Chinese; for users who have never touched a terminal) |
| [`docs/UPGRADING.md`](docs/UPGRADING.md) | Update prerequisites, compatibility matrix, update order and rollback (Chinese + English) |
| [`docs/CHANGELOG.md`](docs/CHANGELOG.md) | Per-release features and fixes (Chinese + English) |
| [`docs/HOW-IT-WORKS.md`](docs/HOW-IT-WORKS.md) | Scene renderer, host / client split, complete HTTP route table (Chinese + English) |
| [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) | Install-failure fixes and "symptom → where to look first" (Chinese + English) |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Local-source install, build & verify, per-platform branch rules (bilingual) |
| [`docs/README.md`](docs/README.md) | Full documentation index (incl. renderer-decision and robustness-audit engineering docs, Chinese) |

## Limitations

- Application wallpapers cannot be embedded and are hidden from the thumbnail
  picker and rotation candidates. Their live render remains Wallpaper Engine's
  desktop job. Scene wallpapers are rendered to a full-scene frame (static) —
  see 「Which wallpaper types are supported?」 above; any scene animation is
  frozen in that frame.
- The browser must be able to autoplay muted `<video>` (DSH runs on loopback; muted
  autoplay is allowed by modern browsers).
- Media is served from your local Wallpaper Engine install paths; the host only
  serves files it has already enumerated (no arbitrary filesystem exposure).
  Custom uploads likewise stay on your machine — nothing is uploaded to any server.
- **The frame-skip transcode depends on ffmpeg and NVIDIA NVENC** (`av1_nvenc` →
  `h264_nvenc` fallback): without ffmpeg (including unavailable auto-download,
  e.g. musl/Alpine or other uncovered platforms) or an NVIDIA GPU, the fps cap
  auto-disables and wallpapers keep playing the original — nothing else is affected.
- **Occlusion pause applies to video wallpapers only**: web (iframe) wallpapers
  cannot be paused from outside and are only throttled by the browser when hidden.
- The picker is English/Chinese mixed (this bundle is not yet wired into DSH's
  locale namespaces).

## Development / rebuild

Before contributing code, read the [contribution guide](CONTRIBUTING.md). Send Windows, WSL, and shared cross-platform changes to `main`; send macOS, WaifuX, and loose-media changes to `dsh-wallpaper-engine-mac`, maintained by [Jerry (@ruijiaang-lab)](https://github.com/ruijiaang-lab).

The host half (`lib/index.js`) is plain ESM with no build step. The client half
(`lib/client.js`) is a **compiled artifact** produced from the canonical source
`src/client.js` by `scripts/build-client.mjs`, which emits the exact
`window.__ModuleLoader__.load({ id, factory })` envelope the DSH module loader
consumes (the same shape `tsdown` emits for in-box client packages).

```sh
npm run build                  # regenerate lib/client.js from src/client.js
npm run verify                 # materialize the emitted bundle and assert its exports
node scripts/verify-scene.mjs  # scene static-frame extraction / scene-frame route self-test (incl. synthetic fixtures)
```

Edit `src/client.js`, then `npm run build`. Do not hand-edit `lib/client.js`.
`npm install`/`pnpm install` runs `prepare` → `build` automatically, so a
fresh checkout always ships a current `lib/client.js`.

The host↔browser contract is plain same-origin HTTP, so the two halves are
developed independently: rebuild the host by restarting `dsh web`, and rebuild
the client with `npm run build` before re-running `dsh web`.
