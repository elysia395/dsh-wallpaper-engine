# dsh-plugin-wallpaper-engine

[English](README.en.md) | [中文](README.md)

> 🆕 Never used the command line? Start here: **[beginner-friendly guide →](README.beginner.md)** (a simplified walkthrough in Chinese for users who have never touched a terminal).

A DSH bundle that turns your **Wallpaper Engine** wallpapers into the **background of the DSH web GUI** (`dsh web`).

> ✅ **Improved: occasional full-screen white flash in immersive windows** (v0.6.4, keeps full frosted glass)
> Older builds could flash the **whole window white** when you clicked the dialog or typed in an **immersive fullscreen window** opened via a **desktop shortcut** (standalone / kiosk) — under **hardware acceleration**, Chromium's compositor occasionally paints the backdrop white while it re-composites over the wallpaper.
> **v0.6.4 keeps reducing the compositing layers**: the repo panel is lazy-mounted when closed, the rope has no permanent filter, and the wallpaper media no longer forces a transform compositing layer by default — whilst **keeping the full frosted glass**. Normal browser tabs are unaffected and keep the full frosted glass + hardware acceleration.
> The plugin shows a one-time notice (once per version) about this.

It discovers the Wallpaper Engine install on your machine, lists its wallpapers, and renders them behind the DSH chat interface with an iOS-style **liquid glass** effect: Video (`.mp4`) plays live, Web/HTML loads in an iframe, and **Scene wallpapers are rendered in real time by the built-in WebWallGL WebGL engine (particles / scripts / parallax / packaged audio, auto-falling back to scene frames)**. Since v0.2 it also adds:

- **Modal wallpaper picker** — the thumbnail grid lives in a popup modal, so the settings page stays compact;
- **Hide / restore (soft delete)** — hide wallpapers you don't want, restore them anytime; no source files are touched;
- **Playback speed** — six native presets from 0.5x to 2x, instant, no media reload;
- **Horizontal flip** — mirror the image (video / web / uploaded images);
- **Custom uploads** — use your own local JPG / PNG / MP4 as a wallpaper, with a configurable storage location, fit modes, and automatic thumbnails for uploaded MP4s; **WE project directories** in the storage location (scene/web/video folders containing `project.json`, e.g. a WallpaperEM downloads folder) are picked up automatically too — their scene wallpapers render live like any other;
- **Scene full-scene frames** (v0.6) — Scene wallpapers are fully replayed by a pure-JS scene renderer (object tree / textures / particles / shader effects) instead of being an unusable "not playable" entry.
- **Scene wallpapers in real time** (v0.8) — Scene wallpapers are now rendered live by the built-in **WebWallGL** engine (`lib/webwallgl/`, MIT, from [webwallgl](https://github.com/oneincase/webwallgl)): particle systems, puppet models, SceneScript, **mouse parallax / click interaction**, packaged audio and audio-reactive effects, at a selectable frame cap (15/30/60 fps). The renderer page runs in a same-origin isolated iframe under a **heartbeat watchdog**: first-frame timeout or a stalled runtime falls back to the embedded-MP4 → static-frame chain (remembered per wallpaper; re-toggling the switch retries).
- **Liquid-glass settings page** (v0.3.1) — the settings UI is now a **first-level settings page** (following the dsh-web-ui-all skin-center design): the whole page is a customizable liquid-glass card with **accent color** (6 presets + a custom color picker) and **glass transparency** (0–60%). Both apply instantly and persist.
- **Whole-settings-window liquid glass** (v0.3.2) — one click turns the **entire native DSH settings window** (dialog + left nav + ALL native sections: General / Models / Plugins / …) into liquid glass with your custom accent + transparency. With the「设置窗口液态玻璃」master switch on, the window background, nav active/hover, buttons, switches and links all follow the chosen accent and transparency; off restores the stock look.
- **Unified glass tuning** (v0.3.3–v0.3.5) — the settings-window glass blur shares the SAME adjustment as the conversation bar: the **玻璃** (glass) slider (0–60 px) drives the blur radius of both the settings window and the composer/bubbles, with an identical saturation/brightness/contrast recipe. A new **玻璃颜色** (glass color) control lets you tint the glass BASE itself (6 presets + custom picker; defaults white in light / deep navy in dark; once picked, both themes use that color) — **配色** styles the interactive elements, **玻璃颜色** styles the glass itself.
- **Settings persisted to a host file** (v0.4.0) — all settings (selected wallpaper, accent, transparency, layout, rotation, hidden, speed/flip, …) are now stored in `~/.dsh-wallpaper-engine/config.json` instead of browser localStorage, so they survive restarts, port changes (including DSH Desktop's random `--port 0` loopback port), browser-data clears and browser switches. Legacy localStorage config is migrated automatically on first launch.
- **Edge-compatible rendering** — Edge (and only Edge) paints its built-in "download / cast" media-overlay toolbar over any *visible* `<video>` element, and there is no official switch to disable it. On Edge, video wallpapers are therefore rendered onto a `<canvas>` by default to keep that toolbar away. A new「Edge 兼容」toggle (right-aligned on the 紧凑布局 row, on by default) turns this off and falls back to the native `<video>` in every browser.
- **Media-stream handle fix + async scan** (v0.4.1) — media/preview/scene-frame streams now release their file handles immediately when the client disconnects (fixes handles accumulating with every wallpaper switch/refresh, and Windows locking that prevented deleting/moving a wallpaper file). The wallpaper-library scan is fully async (fs.promises thread pool), so it no longer blocks the event loop (noticeably faster startup on WSL / big libraries). **WSL support**: Steam roots mounted under `/mnt/<drive>` are auto-detected, so a Harness running inside WSL can discover a Windows Wallpaper Engine install.
- **Occlusion pause (battery-saving trio)** — like Wallpaper Engine's "pause when covered": pause the video wallpaper on minimize / tab-switch, on window focus loss, and/or on battery power, dropping the decoder engine to zero; it resumes automatically when you come back (web/iframe wallpapers are only throttled by the browser while hidden). Each toggle persists.
- **Decode frame-rate cap (frame-skip transcode)** — high-fps sources (e.g. 4K120 H.264) are the dominant GPU cost (~60% Video Decode at 1.0x on a 4060). The **帧率上限** control (unlimited / 60 / 48 / 30 / 24 fps) has the host re-encode the wallpaper ONCE to the capped fps (timeline stays 1.0x normal speed, fully decoupled from 倍速) as **4K-preserving AV1**, with a **live download/transcode progress bar**; measured 4K120→24fps drops GPU from ~60% to **~15%**. ffmpeg is provisioned in three tiers: explicit path → **auto-download** (npmmirror + GitHub dual-source race, cross-platform asset table verified) → system PATH.
- **Wallpaper-effect tuning sliders** (v0.6.x) — the **壁纸效果** area gains three new sliders: **亮度 / 对比度 / 饱和度** (wallpaper media filter), alongside wallpaper blur / scrim etc., so any wallpaper can be blended comfortably with the UI. All apply instantly and persist.
- **Custom typography** (v0.6.7) — a new **字体** section in settings. The master switch defaults to off (stock dsh look); once enabled you can tune **font color / weight (100–900) / family** (default · YaHei · KaiTi · SimSun · SimHei · 行楷 Xingkai · monospace, each chip previewed in its own font). Error/danger/warning text keeps its system red; toggling the switch off restores defaults in one click.
- **Wallpaper opacity** ([#82](https://github.com/elysia395/dsh-wallpaper-engine/issues/82)) — a new **壁纸透明度** slider in the effects tab (0–90 %, higher = more transparent): fades the whole wallpaper layer toward the page base colour — the IDEA background-image style of "visible but not overpowering". Complements the scrim, keeping text readable.
- **Input caret color** ([#83](https://github.com/elysia395/dsh-wallpaper-engine/issues/83)) — a new **输入光标** section on the typography tab: when the caret is hard to see against the wallpaper, pick a high-contrast color from 6 presets or the custom picker (or **自动** to restore the native dsh caret). Applies to every text input and editable area, independent of the typography master switch.
- **Custom uploads usable + honest playback state** ([#84](https://github.com/elysia395/dsh-wallpaper-engine/issues/84)) — fixes "my uploaded video wallpaper is blank and there is no resume button": ① `uploads/.meta.json` never records a `contentrating`, so uploads used to read as **unrated** while the rating filter defaults to **Everyone** — every custom upload was filtered out by default (absent from the grid, and rejected when the upload flow auto-applied it → blank wallpaper layer + a disabled 播放 button). An upload without a rating now counts as **Everyone**, so your own files work out of the box, while an explicit G / PG13 / R tag still filters normally. ② A refused `video.play()` (autoplay policy, a codec the browser cannot decode such as HEVC/10-bit, or a play() interrupted by the next src swap) used to be swallowed silently: the panel kept saying 「播放中」 and the only control was 「暂停」 — a wallpaper frozen on its first frame with no way to resume. The control now reflects the `<video>` element's REAL state, so it returns to 「播放」 (a working retry) with a readable reason, e.g. "cannot decode this video — use H.264", and it re-issues play() automatically once the media becomes ready (an aborted play() is the most common cause of a frozen wallpaper). ③ A wallpaper dropped by a filter now says which filter excluded it instead of leaving an unexplained blank.

![Main interface showcase](docs/images/main-interface.gif)

> Wallpaper + scrim + iOS liquid glass rendered behind the DSH GUI.

## ⚠️ Prerequisites for updating: ① latest DSH kernel ② latest better-sidebar (v0.7.2+)

**Do NOT update this plugin until BOTH prerequisites are met.** v0.7.2 targets DeepSeek Harness **0.1.5-rc.1** (shipped in **DSH Desktop ≥ 2.0.7**) and requires **dsh-better-sidebar ≥ 0.19.0** (from 0.19 the right column plugs into the native right sidebar of harness 0.1.5; users still on the 0.1.2-rc.1 line should keep better-sidebar 0.18.x — do not mix). The correct update order:

1. **Update DeepSeek Harness / DSH Desktop first**: check for updates via the desktop app's top-bar version info, or grab the installer from [GitHub Releases](https://github.com/anywhere-labs/dsh-desktop/releases);
2. **Then update dsh-better-sidebar to 0.19.0+**: `dsh plugin --profile web add dsh-better-sidebar@latest`;
3. **Finally update this plugin**: `dsh plugin --profile web add dsh-plugin-wallpaper-engine` (or click update in the plugin market).

> 💡 Also update your **other DSH plugins at the same time**: older plugins may fail to load outright on harness 0.1.5 (an old dsh-better-sidebar was observed misbehaving on 0.1.5 due to API changes).

If you updated out of order, bringing the kernel and better-sidebar back to their matching latest versions restores everything — no plugin rollback needed. The plugin also shows a one-time in-app notice per release.

> 🐛 **v0.7.2 fixes the "right sidebar fully transparent" regression and extends the glass to the native right sidebar**: the harness 0.1.5 native sidebar panel paints `var(--dsw-alias-bg-base)` — the exact token this plugin sets to transparent while a wallpaper is active — and the native panel ships no frosted glass of its own, so after moving to better-sidebar 0.19 the whole right column went see-through. From v0.7.2 the native right sidebar is covered by the「侧栏液态玻璃」adaptation: the same **侧栏模糊 / 透明度 / 玻璃颜色** sliders drive it, and with the master switch off it falls back to the theme's opaque panel colour (no longer transparent).

> ✅ **v0.7.1 has been verified on DSH Desktop v2.0.5 (harness 0.1.2-rc.1)**: host routes (inventory / media / scene-frame), the first-level settings section, the picker modal, video & scene wallpaper playback, the rope-dock drawer, and the liquid-glass effects all work in both Compatibility and Enhanced desktop modes. The APIs this plugin relies on (slots / webserver / theme variables) were verified unchanged on harness 0.1.5-rc.1 as well.
>
> 🐛 **v0.7.1 also fixes the rc.1 "swatches / vinyl record render as rounded rectangles" regression** ([#74](https://github.com/elysia395/dsh-wallpaper-engine/issues/74)): rc.1's theme layer ships a new `corner-shape.css` that applies `corner-shape: superellipse(1.5)` (squircle-ish corners) to **every element**, so any `border-radius:50%` circle renders as a rounded rectangle. The plugin now explicitly resets `corner-shape: round` on every circle / pill control it draws (swatches, vinyl record, slider thumbs, toggle knobs, font chips, …); on older harness builds the declaration is ignored, with no side effects.

## Which wallpaper types are supported?

Wallpaper Engine wallpapers come in four types:

| Type | Rendered by | Portable to DSH? |
|---|---|---|
| **Scene** | Wallpaper Engine's own 3D engine | ✅ Real-time — the built-in WebWallGL WebGL engine (particles / scripts / parallax / packaged audio); falls back to scene frames on failure |
| **Video** | a plain `.mp4` file | ✅ Yes — plays in a `<video>` tag |
| **Web** | a Chromium (`webwallpaper64.exe`) host for HTML | ✅ Real-time — WebWallGL's web mount with the **injected WE API** (audio/property/media listeners) under a strict sandbox; falls back to a plain iframe on failure |
| **Application** | an injected external window | ❌ No |

Scene wallpapers are replayed in real time by the plugin's built-in **WebWallGL
engine** (`lib/webwallgl/`, MIT, upstream [webwallgl](https://github.com/oneincase/webwallgl)):
it parses `scene.pkg`'s object tree in WebGL2 and renders every image layer
(shader effects translated from HLSL and executed on the GPU), puppet skeletal
models, particle systems and text objects, runs the scene's own SceneScript —
mouse movement drives parallax / cursor interaction, and packaged audio (BGM /
SFX) plays under the shared volume / audio-switch settings.

> **Rendering form & fallback**: the renderer page runs in a same-origin
> isolated iframe under a **heartbeat watchdog** — a 15 s first-frame timeout,
> or 20 s without a frame while playback is expected (after one automatic
> recovery attempt), marks the wallpaper failed and degrades it to the
> embedded-MP4 → static-frame chain. Loose `scene.json` directories and
> environments without WebGL2 use that chain directly. Failure memory is
> cleared by re-toggling 「场景实时渲染」 in the settings. The static-frame
> chain (pure-JS scene renderer, below) remains the underlay and the fallback.

**Web wallpapers** go through WebWallGL too: the host injects the **WE API shim**
(`wallpaperRegisterAudioListener` / `wallpaperPropertyListener` / media
listeners, from upstream `web-shim.js`, injected into the entry HTML by
`/scene-files`) and hands the page to the renderer — so workshop web wallpapers
that depend on the WE API (audio visualizers, property-driven and pointer-tracking
pages) actually run instead of rendering blank or erroring. **Security**: the
wallpaper iframe is forced into `sandbox="allow-scripts"` (strict sandbox) so the
third-party HTML can never inherit the DSH origin (it cannot call host APIs or
read host storage as the app). Cross-origin control and pointer injection go
through the renderer page's `postMessage` channel. On load failure or a stalled
runtime the wallpaper is remembered and degrades to the legacy plain iframe
(no WE API).
>
> **Payload origin (separate media origin)**: a web wallpaper's entry HTML and all of
> its subresources are served by a **dedicated loopback media origin the host opens
> itself** (a random port on `127.0.0.1`, reported by
> `GET /wallpaper-engine/media-origin`) — *not* by the plugin's HTTP routes. Why: DSH
> Desktop wraps every plugin route in a capability-header fence
> (`x-dsh-desktop-renderer`, injected only into requests issued by same-origin
> frames), and a strict-sandbox iframe is an opaque origin that can never carry that
> header — the wallpaper entry would always answer `403 Forbidden` (symptom: the
> preview frame looks fine, then the wallpaper goes fully black). The media origin
> bypasses that fence, and third-party HTML no longer shares the host origin at all,
> so the sandbox gets a second layer of isolation.
>
> **Frame cap and "it still stutters"**: the wallpaper's rAF cap is implemented by
> **frame skipping** — every vsync is kept so the delivered frame stays phase-aligned
> with the display and only every n-th frame reaches the page (a `setTimeout`-based cap
> yields 17/33/50ms jitter, which looks worse). While live, a `live-fps` line is written
> to the diagnostics file every 5 s: `ui=` whole-page fps, `web=` the wallpaper's own
> fps, `rnd=` renderer-page fps, `cap=` the current cap. If it still feels heavy, that
> line tells you whether the wallpaper itself is slow (`web` low) or the whole page is
> (`ui` low too — e.g. the sidebar's `backdrop-filter` re-sampling the wallpaper every
> frame; try lowering the blur to confirm).

> **Known web-wallpaper limits**: author `fetch`/`XHR` carries `Origin: null` under
> the opaque origin (the host answers with `Access-Control-Allow-Origin: *`, so
> ordinary resources load); `wallpaperMediaIntegration` (system Now Playing / cover
> art) **is** supplied by the host — see "System-audio reaction and Now Playing"
> below; CSS `:hover` interaction driven by the browser's own hit-test cannot be
> triggered by external pointer injection (as documented upstream).

### System-audio reaction and Now Playing (song info + cover art)

Two switches in the「声音」(sound) tab (both on by default):

| Switch | What it does |
|---|---|
| **系统音频反应** | Feeds a spectrum of **whatever the system is playing** (any app) to the wallpaper's audio-reactive effects. It is the system-output **loopback**, not the microphone, and it is built in on all three platforms — no extra installs: CoreAudio on macOS, WASAPI loopback on Windows (**no "Stereo Mix" or virtual sound card needed**), PulseAudio/PipeWire on Linux. Only macOS asks once for "audio recording" permission on first use; when no audio can be captured the wallpaper falls back to its built-in simulated spectrum |
| **媒体信息** | Hands the system **Now Playing** (title / artist / album / album artist / playback / timeline / **cover art**) to the wallpaper through the official WE APIs `wallpaperRegisterMediaPropertiesListener` / `wallpaperRegisterMediaThumbnailListener` / `wallpaperRegisterMediaPlaybackListener` (plus `…TimelineListener`) |
| **在线歌词** | Lyrics come from local sources first (a `.lrc` next to the audio file, or an already-cached copy); when enabled, a missing lyric triggers one query to [lrclib.net](https://lrclib.net) — that request sends title/artist/album, hence **off by default** |

> **Where this data comes from**: the host runs a bundled Rust middleware,
> [media-bridge](https://github.com/oneincase/media-bridge), as a child process (stdio NDJSON;
> downloaded on first use, sha256-verified, cached under `~/.dsh-wallpaper-engine/bin/`) —
> MediaRemote on macOS, the system media session (GSMTC) on Windows, MPRIS over D-Bus on Linux;
> system audio comes from a CoreAudio Process Tap (14.2+), WASAPI loopback and PulseAudio/PipeWire
> monitors respectively. So `brew install media-control`, `playerctl`, "Stereo Mix"/VB-Cable and
> even compiling a Swift helper on your machine (Xcode Command Line Tools) are all no longer needed.
> When the middleware cannot be fetched or started, the plugin falls back to its built-in
> implementation and reports the reason in `GET /wallpaper-engine/media-status` (`fallback`).
>
> **Cover art**: written by the middleware under a content-fingerprinted name (a new file per
> track), proxied by the host at `/wallpaper-engine/now-playing/artwork`, then downscaled to 512²
> and converted to a **self-contained data URL** before it reaches the wallpaper — plugin routes
> are fenced by the host capability gate on Desktop (a cross-origin sandboxed wallpaper cannot
> fetch them), while a data URL depends on no origin and can be drawn into a canvas untainted.
>
> **Who owns the timeline (renderer side)**: the bundled WebWallGL page ships a demo media
> source (so previews look alive) that only steps in when the host provides **no** media.
> As soon as the host pushes a snapshot with `hasMedia`, that source is stored on the
> renderer's `rt.mediaSource` and properties / thumbnail / playback / position / duration
> all follow the host. (Older renderer builds kept pushing the demo source's fake progress
> once per second and overwrote the host's timeline — fixed in WebWallGL, and the plugin's
> real-browser end-to-end test now guards it.)

### Static-frame fallback: how it works

- **Object tree**: parses `scene.pkg` (PKGV container + LZ4 entry chains) or a
  loose `scene.json` directory, topologically sorts every object (image /
  particle / text / sound) by dependencies / parent.
- **image layers**: loads the material main textures (RGBA8888 / DXT1/3/5 …),
  positions them in scene coordinates (origin / scale / angle accumulated down
  the parent chain), and applies alpha / brightness.
- **puppet meshes**: MDL (MDLV) mesh + bind-pose rasterization (software
  raster + bilinear UV sampling + alpha compositing), so skeletal models like
  the character / back hair display correctly.
- **shader effect chain**: waterwaves (incl. the dual-wave DUALWAVES product) /
  waterripple / shake are implemented in the CPU with the exact shader math;
  mask textures are supported.
- **particle systems**: boxrandom / sphererandom emitters, color / size / alpha /
  lifetime / velocity / rotation initializers, movement / alphafade / sizechange /
  turbulence / oscillate* operators, and sprite drawing.
- **Atlas padding is trimmed**: a scene's main texture is often a power-of-two **atlas**
  (2048²/4096²) where the artwork occupies just one band and the rest is pure black. The
  static frame is cropped to the artwork itself (uniform black edges only; a crop leaving
  too little is skipped), so the loading placeholder fills the screen instead of being
  anchored to the atlas centre and showing mostly black.
- **Cache**: results are cached at `~/.dsh-wallpaper-engine/cache/frames/`
  keyed by `<version>_<path>_<mtime>` (override with `DSH_WE_CACHE_DIR`);
  workshop updates and renderer upgrades invalidate the frame automatically.
  First render takes ~3–4s, then near-instant on cache hit.

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
     - `GET /wallpaper-engine/video-preview/<token>` → on-demand ffmpeg-extracted thumbnail for a custom MP4 upload (disk-cached)
     - `GET /wallpaper-engine/scene-frame/<token>` → scene full-scene frame (pure-JS renderer output 3840×2160, falls back to main-texture extraction, PNG disk-cached; also the live renderer's underlay)
     - `GET /wallpaper-engine/scene-live/*` → the vendored WebWallGL renderer page (built into `lib/webwallgl/`, loaded by the live-render iframe)
     - `GET /wallpaper-engine/scene-files/<token>/<path>` → raw scene wallpaper files (`scene.pkg` / `project.json` …, Range supported; the renderer page parses the container itself). The same path is also mounted on the **separate wallpaper media origin** (see above); web-wallpaper payloads are fetched from there
     - `GET /wallpaper-engine/media-origin` → reports the active wallpaper media origin (diagnostics: which origin a web wallpaper is loaded from)
     - `POST /wallpaper-engine/upload` → upload a custom wallpaper (JPG / PNG / MP4, raw bytes)
     - `POST /wallpaper-engine/remove` → remove an uploaded wallpaper
     - `POST /wallpaper-engine/upload-dir` → change the upload directory (persisted to `~/.dsh-wallpaper-engine/config.json`, migrates existing files)
     - `GET /wallpaper-engine/settings` → read plugin settings (v0.4.0)
     - `PUT /wallpaper-engine/settings` → save plugin settings (v0.4.0, written to `~/.dsh-wallpaper-engine/config.json`)
     - `GET /wallpaper-engine/media-info/<token>` → media metadata (resolution / codec / fps / duration, from a moov probe)
     - `GET /wallpaper-engine/transcoded/<token>?fps=N` → frame-skip transcode stream (one-time ffmpeg re-encode, disk-cached)
     - `GET /wallpaper-engine/transcode-progress/<token>?fps=N` → download / transcode progress (progress-bar polling)
- **Client half** (`lib/client.js`): a browser module that fetches the inventory
  and renders the selected wallpaper into a fixed layer *behind* the app columns,
  plus a **first-level settings page** "Wallpaper Engine" (liquid-glass card,
  picker modal, hide/restore, playback speed / flip, accent color + glass
  transparency, and custom-upload management).
- **Custom-upload storage**: uploaded files are written to a plugin-managed local
  directory (default `~/.dsh-wallpaper-engine/uploads`, changeable from the
  settings UI) and served through the same `/media` + `/preview` routes as WE
  media — identical pipeline, survives restarts, no browser quota limits.

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

### Troubleshooting install failures

`dsh plugin --profile web add ...` forwards the command to **pnpm**. If you see this error:

```text
[ERR_PNPM_UNEXPECTED_VIRTUAL_STORE] Unexpected virtual store location
dsh: pnpm failed in profile directory C:\Users\xxx\.dsh-desktop\profiles\web
```

**This is not a problem with the plugin itself** (any plugin would fail the same way) — the pnpm
dependency state of that profile directory has gone stale. pnpm stores the virtual-store path
(an absolute path) in `node_modules\.modules.yaml`; if the profile directory was **moved / copied /
restored from a backup**, or the pnpm version / `virtual-store-dir` config changed, the recorded path
no longer matches, so pnpm refuses to install anything into that profile.

**Fix (Windows PowerShell):**

```powershell
# 1) Quit the DSH desktop app first
# 2) Remove the profile's dependency directory (only node_modules — config / installed plugin names are kept)
Remove-Item "$env:USERPROFILE\.dsh-desktop\profiles\web\node_modules" -Recurse -Force
# 3) Reinstall this plugin
dsh plugin --profile web add dsh-plugin-wallpaper-engine
```

> Deleting just `node_modules\.modules.yaml` also works (pnpm recreates it and continues); removing
> the whole `node_modules` is more thorough. If `.dsh-desktop` is touched by OneDrive / cloud sync /
> migration tools, add it to the sync exclusion list to avoid a recurrence.

If you see this error instead:

```text
[ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED] ... The git-hosted package "dsh-plugin-wallpaper-engine@0.6.8"
needs to execute build scripts but is not in the "allowBuilds" allowlist.
```

**You used a `github:` install form** (e.g. `dsh plugin --profile web add github:elysia395/dsh-wallpaper-engine`).
pnpm 11 blocks build scripts of git-hosted packages by default for supply-chain safety, and this
plugin's git checkout needs the `prepare` script to build the client — so `github:` direct installs
always fail. Use the **npm package name** instead (the published npm package is pre-built, no
compile-time build needed):

```sh
dsh plugin --profile web add dsh-plugin-wallpaper-engine
```

> If your plugin hub (dsh-plugin-hub) generated a `github:` command, upgrade it to **v1.4.1+** — the
> new version auto-resolves the npm package name and switches to the npm channel.

## Usage

1. Open `dsh web` → the DSH GUI.
2. Open **Settings** and pick **Wallpaper Engine** from the left navigation (a first-level settings page, its own nav entry).
3. Click **选择壁纸** to open the picker modal, then click a Video/Web/Scene wallpaper (or an uploaded image/video) in the thumbnail grid. It appears behind the app; close the modal via the backdrop, ESC, or the close button. Application wallpapers cannot be embedded in the web UI and are hidden from the grid.
4. Use **暂停/播放** to pause a video wallpaper, and **关闭** to clear it.
   The choice is remembered in your browser's `localStorage` (key
   `dsh-wallpaper-engine:selection`).

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
| **效果** (effects) | wallpaper blur / brightness / contrast / saturate / wallpaper opacity / scrim / border / glass, playback speed, fps cap, fit, flip, occlusion pause (an empty state guides you to pick a wallpaper first) |
| **高级** (advanced) | compact layout, Edge compatibility |

The pill indicator slides between tabs; the settings page and the drawer keep
independent tab state (remembered in `localStorage`, never written to the config
file). Long explanations moved into tooltips — each row keeps a one-line hint.

### Hide & restore (soft delete)

Every wallpaper card has a **隐藏** button in its top-right corner — it only removes the wallpaper from the list, **never touches the source file**. Restore any wallpaper from the **已隐藏** tab in the modal (single restore or **全部恢复**); the **批量** button in the modal toolbar enters multi-select mode to hide several at once. Hidden state is persisted in `localStorage` (survives refresh/restart); hiding the currently playing wallpaper doesn't interrupt playback, and automatic rotation skips hidden wallpapers.

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
  (video) / **网页** (web) / **图片** (image, custom uploads).

Every option shows how many playable wallpapers currently match. Wallpapers
outside the selected categories are dropped from the grid, the rotation editor
and the rotation candidates — they are never auto-selected or rotated either.
The choice persists in browser `localStorage`; the default is **Everyone**,
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
  choice persists in `localStorage`.
- **黑胶唱片 (vinyl record)**: next to the wallpaper selection there is a
  **rotating vinyl record** that uses the selected wallpaper's cover as the
  record label — it spins while the wallpaper plays and stops when paused
  (animation is disabled under `prefers-reduced-motion`). A small record also
  sits in the picker modal head. The vinyl shows in **both** card styles.

### Playback speed & horizontal flip

With a video wallpaper selected, the **效果** (effects) tab shows the **倍速** presets (0.5x / 0.75x / 1x / 1.25x / 1.5x / 2x) — driven by the browser's native `playbackRate`, instant, no reload or black flash (wallpaper videos are muted, so there is no audio to keep in sync). The **水平翻转** toggle mirrors the image via CSS `scaleX(-1)` — it works for video, web, and uploaded images/videos alike, with zero main-thread cost.

### Switch transitions

Pick the animation used when the wallpaper changes. **Manual picks and automatic rotation share the same setting** (「壁纸」tab → 「切换过场」). The default is a **hard cut** — zero cost, zero risk, and it is a one-line change (`DEFAULTS.switchTransition`) once the favourite is settled.

| Transition | Look | Baseline |
|---|---|---|
| **硬切** hard cut (default) | no animation, instant | — |
| **交叉淡化** cross-fade | the new picture fades in over the old one | 1800 ms |
| **推移** push | the new picture slides in while the old one slides out | 700 ms |
| **擦除** wipe | a hard edge sweeps across to reveal the new picture | 700 ms |
| **光圈** iris | a circle opens from the centre | 800 ms |
| **缩放** zoom | the new picture eases in slightly zoomed, the old one pushes forward | 900 ms |
| **条带** bars (venetian blind) | 7 slats — horizontal for a lateral transition, vertical for a vertical one — open in parallel from the entering side, with gaps that close at the end | 800 ms |

**Direction** only applies to the directional transitions (push / wipe / bars): for push and wipe it picks the entering side; for bars it picks the entering side too, which is also what makes the slats horizontal (lateral) or vertical (up/down). **Duration** is each type’s baseline × fast (0.6×) / normal (1×) / slow (1.6×), with the resulting milliseconds shown on the control.

Three constraints shaped the shortlist: only `transform` / `opacity` / `clip-path` are animated (compositor-friendly — `mask` and `filter` fall off the composited layer on `<video>` and live render `<iframe>`s, which is why 条带 uses a `clip-path` polygon instead of a mask: its N slats are disconnected, so a thin "spine" hugging the entering edge (growing from zero width) joins them into a single connected polygon); the outgoing picture always stays **opaque underneath** the incoming one, because glass `backdrop-filter` silently stops working over a transparent backdrop; and every duration comes from a single source (the inline `--we-switch-ms`, with the cross-fade baseline referencing `ROTATION_FADE_MS`).

With `prefers-reduced-motion: reduce` every transition degrades to a hard cut, and the incoming layer’s temporary inline styles are cleared when the transition ends (a full-screen video would otherwise keep a compositing layer forever).

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

> Transcoding uses **NVENC** (`av1_nvenc`, falling back to `h264_nvenc`) and requires an NVIDIA GPU + driver; without one the feature auto-disables (or falls back to slow software H.264). No ffmpeg or a failed transcode simply disables the feature — no side effects.

### Wallpaper properties (live author-property editing)

When the current wallpaper is a **scene** or **web** wallpaper, the 「当前壁纸」 card shows a
green **壁纸属性** button next to 「选择壁纸」. It opens the adjustable properties the author
defined in the WE editor (color / bool / slider / combo / text / file); applying one takes
effect **immediately** (`__wp.updateWebProps`) — no re-mount needed.

- Definitions come from the wallpaper's `project.json` → `general.properties`, labels from its
  own `general.localization` (per-key fallback zh-chs → zh-cht → en-us); properties carrying a
  `condition` show/hide by the current values, and `editable: false` internals are hidden from
  the panel while still being sent to the wallpaper (WE semantics).
- Edits are **remembered** per wallpaper: after a reload/restart a web wallpaper receives them
  with its HTML seed, a scene wallpaper gets them replayed once live rendering is ready.
  「恢复默认」 clears every edit for that wallpaper.
- The panel shows the values **actually in effect** (read back from the renderer, since a
  scene's defaults live in its own snapshot), not just the project.json defaults.
- If live rendering is not active (static frame / compat mode) the panel says so; edits apply
  once live rendering takes over.

### Custom wallpapers

The **自定义壁纸** section uploads local images (JPG / PNG) or videos (MP4) as wallpapers:

- **Storage location**: files default to `~/.dsh-wallpaper-engine/uploads` (your home directory — usually the C: drive). Click **更改** to move storage to any drive (absolute path, `~` supported); existing files migrate automatically and the choice persists across restarts — recommended for users who don't want wallpaper data on the system drive.
- **WE project directories** are recognized in the same location: any subfolder with a `project.json` (shipping `scene.pkg` / `scene.json` / `index.html` / `*.mp4`) becomes a wallpaper of the matching type — scene wallpapers render live. Folders are scanned in chunks (~30 ms for hundreds), are read-only (never listed under upload management, never removable), and loose `preview.jpg/png/gif` files are used as thumbnails.
- **Format limit** for direct uploads: JPG / PNG / MP4 only; validated twice (browser + host) with a clear error message.
- **Video thumbnails**: uploaded MP4s get an on-demand ffmpeg-extracted thumbnail in the picker (the first second is skipped to avoid black fade-ins), cached under `~/.dsh-wallpaper-engine/cache/video-previews/`; without ffmpeg the card keeps the "no preview" placeholder and playback is unaffected.
- **Fit modes**: 覆盖 (cover) / 填充 (contain) / 居中 (center) / 拉伸 (fill) — applied to custom wallpapers only (WE wallpapers keep their intended cover framing).
- **Management**: each upload can be **移除** (confirm dialog, deletes the local file); uploaded wallpapers also support hide/restore, playback speed, and flip.
- **Deduplication**: re-uploading an identical file is detected by content (SHA-256) and returns the existing entry — no duplicate copies pile up in the library.

### Automatic rotation (轮播列表)

Rotation runs over **user-defined carousel lists** (the 自动轮播 group in the **壁纸** tab). Create any number of lists with **新建**, pick Video/Web wallpapers into each from the inventory, give each list its own switch interval (1, 5, 10, 30, 60 or 120 minutes) and order (顺序/随机), then enable **自动轮转** on the list you want active. Lists are persisted in your browser's `localStorage` and are fully client-side — rotation never depends on Wallpaper Engine's own `config.json` playlist paths.

At least two playable Video/Web wallpapers per list are required; manual changes reset the next timer; each list keeps its own cadence, so you can have one list switching every 5 minutes and another every 30. On first run, the first playable Wallpaper Engine playlist is imported automatically as a list so the feature works out of the box; **从 WE 播放列表导入** inside the editor imports any other playlist into the list being edited. Application wallpapers cannot be embedded in the web UI, so they are automatically excluded from rotation and hidden from the picker.

Rotation switches only when the next wallpaper is **fully ready**: at switch time the next candidate is prepared in the background (live renderer first frame / static-frame extraction / video canplay / image decode) while the current wallpaper keeps playing; the commit then cross-fades old and new layers over 1.2s, so the new layer is alive on arrival with no black flash. A candidate that fails to prepare (e.g. a 404 video) is skipped in a bounded chain to the next one. For development/smoke testing, `localStorage.weRotationTestSec` (seconds) temporarily shortens the rotation interval.

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
> instantly and persist in `localStorage`.

> **Text-surface readability floor (on by default, not user-adjustable in this
> version)** — every surface that carries text (composer card & tool popups,
> message bubbles, all three settings-window layers, sidebar panels and the
> editor/terminal content plate, the plugin's own wallpaper-repository drawer and
> panel modal) now composites a layer of the **theme base colour** — white in
> light mode, deep navy in dark mode — underneath the glass tint at a fixed
> weight of 45 % (59 % in dark). The values are the smallest that keep body text
> at **WCAG 4.5:1** across the measured grid (glass transparency {0,15,30,45,60}
> × theme × wallpaper opacity {0,50,90}), with the worst case taken at the
> darkest plausible wallpaper pixel (light) and the brightest (dark): worst-case
> body-text contrast improves from **1.00:1 to 4.63:1**. Raising **玻璃透明度** to
> its maximum, or raising **壁纸透明度**, can therefore no longer make text
> illegible — those two sliders only move the glass-tint half of the weight, the
> floor half stays fixed. Semantics are unchanged: glass transparency still means
> "higher = more transparent" and still applies monotonically (you can still make
> a panel clearer or more solid), it just cannot go below the floor; wallpaper
> opacity still drives only the wallpaper layer (`.we-layer` stays opaque; the
> fade lands on the media leaf) and still means
> "blend into the page base colour", with no coupling to the floor.

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
| **壁纸透明度** (wallpaper opacity) | Transparency of the wallpaper layer (higher = more transparent): fading it out blends the wallpaper into the **native base colour** (**pure white in light, pure black in dark**) — the IDEA background-image style of "visible but not overpowering". Complements **暗化** (scrim): one fades the wallpaper itself, the other darkens the whole picture; for the blend-into-base look, combine higher opacity with a lower scrim. For scene wallpapers the static-frame underlay retires once the live renderer is on, so it can no longer show through the faded live picture | 0–90 % | 0 % |
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
>
> **Text surfaces always keep a floor** — every surface that carries text
> (composer, bubbles, settings window, sidebar & content plate, the plugin's own
> drawer / panel modal) keeps a **readability floor** (on by default, not
> adjustable): a fixed theme-base layer sits under the glass tint, so the sliders
> above can no longer push body text below legibility (worst case 4.63:1 — see
> the "Text-surface readability floor" note above).

## Configuration

There is no model-visible tool or prompt text. The bundle adds zero tokens to the
agent. Selection, hidden state, and rotation lists live in browser `localStorage`;
no durable DSH settings are written. The only on-disk data is the **custom-upload
files** (in the directory you chose) and `~/.dsh-wallpaper-engine/config.json`
(~100 bytes) that remembers that directory.

**Environment variables**:

| Variable | Purpose |
|---|---|
| `DSH_WE_FFMPEG` | explicit ffmpeg executable path (highest priority in the resolution chain) |
| `DSH_WE_FFMPEG_URL` | replaces the auto-download source (self-hosted mirror / proxy) |
| `DSH_WE_CACHE_DIR` | overrides the cache root (transcode cache / scene-frame cache) |
| `DSH_WE_STEAM_ROOT` | explicit Steam root(s) (comma/semicolon separated, Windows or /mnt paths; fallback when registry/auto-detection misses) |
| `DSH_WE_MEDIA_BRIDGE` | explicit media-middleware executable (dev/self-built artifact; highest priority) |
| `DSH_WE_MEDIA_BRIDGE_URL` | replaces the middleware download source (`{tag}` / `{asset}` placeholders supported) |
| `DSH_WE_MEDIA_BRIDGE_TAG` / `DSH_WE_MEDIA_BRIDGE_SHA256` | use another middleware version (an unpinned tag is refused unless you supply its sha256) |
| `DSH_WE_MEDIA_LEGACY` | `=1` forces the built-in implementation (for A/B debugging) |
| `DSH_WE_MEDIA_NO_AUDIO` | `=1` metadata only — never touches system audio capture (no permission prompt) |
| `DSH_WE_MEDIA_PROVIDER` | `=mock` runs the middleware's built-in fake player (no real player needed) |
| `DSH_WE_MEDIA_IDLE_MS` | idle ms before the middleware child is stopped (`0` = never; default 15 min) |
| `DSH_WE_MEDIA_DEBUG` | `=1` logs the middleware's stderr and spawn arguments |

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

## Limitations

- Application wallpapers cannot be embedded and are hidden from the thumbnail
  picker and rotation candidates. Their live render remains Wallpaper Engine's
  desktop job. Scene wallpapers are re-rendered to a full-scene static frame
  (see above) — the only dynamic (animated particle / water) effects are frozen
  in that frame.
- The browser must be able to autoplay muted `<video>` (DSH runs on loopback; muted
  autoplay is allowed by modern browsers).
- Media is served from your local Wallpaper Engine install paths; the host only
  serves files it has already enumerated (no arbitrary filesystem exposure).
  Custom uploads likewise stay on your machine — nothing is uploaded to any server.
- **The frame-skip transcode depends on ffmpeg and NVIDIA NVENC** (`av1_nvenc` →
  `h264_nvenc` fallback): without ffmpeg (including unavailable auto-download,
  e.g. musl/Alpine or other uncovered platforms) or an NVIDIA GPU, the fps cap
  auto-disables and wallpapers keep playing the original — nothing else is affected.
- **Occlusion pause applies to video wallpapers and scene live render**: videos
  pause their decoder directly; the scene live render pauses its render loop
  through the control surface (GPU usage drops with it). Plain web (iframe)
  wallpapers
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
npm run verify                 # materialize the emitted bundle and assert its exports (incl. the scene-live pipeline self-test)
node scripts/verify-scene.mjs  # scene static-frame extraction / scene-frame route self-test (incl. synthetic fixtures, offline)
node scripts/verify-scene-live.mjs  # scene live-render self-test (vendor artifacts / scene-live + scene-files routes / directory fence / Range / media origin)
node scripts/e2e-web-media-origin.mjs  # real-browser end-to-end (needs a local Chromium): media origin + strict-sandbox iframe + shim / property seed / control channel
node scripts/diagnose-web-blank.mjs  # triage one blank web wallpaper (headless real browser + screenshot + console errors; WALL_ID=<dir name>)
node scripts/sync-webwallgl.mjs     # build the renderer page from a local webwallgl checkout and vendor it into lib/webwallgl/
```

`lib/webwallgl/` is a **vendored build artifact** of the upstream renderer page
(`index.html` + hashed assets + `.upstream.json` provenance), written
overwriting-style by `scripts/sync-webwallgl.mjs` (built with
`--base=/wallpaper-engine/scene-live/`). Make changes upstream, never by hand in
that directory. The renderer page depends only on the host's `/scene-live` and
`/scene-files` same-origin routes and is driven by the client through
`frame.contentWindow.__wp` (same-origin iframe), so both halves evolve
independently.

Edit `src/client.js`, then `npm run build`. Do not hand-edit `lib/client.js`.
`npm install`/`pnpm install` runs `prepare` → `build` automatically, so a
fresh checkout always ships a current `lib/client.js`.

The host↔browser contract is plain same-origin HTTP, so the two halves are
developed independently: rebuild the host by restarting `dsh web`, and rebuild
the client with `npm run build` before re-running `dsh web`.
