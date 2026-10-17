# Troubleshooting

> **中文**: [`../TROUBLESHOOTING.md`](../TROUBLESHOOTING.md)（与本文同源：改一处请同步另一处）


## "I changed the plugin and nothing happens at all" — separate the **client half** from the **host half** first

This one is specifically for "I changed the code, refreshed the page, and the behaviour is byte-for-byte
the same" (measured in practice: a large-scene first-frame-timeout fix looked like it had no effect, when
in fact the **host half had never reloaded**). The two halves load in completely different ways:

| Half | Where it comes from | When it takes effect |
|---|---|---|
| Client half (`lib/client.js` / `src/**`) | The host serves the **built artifact** as a static asset to the page | **Refreshing the page** is enough (the `client-boot` build marker in diagnostics changes) |
| Host half (`lib/index.js` / `lib/routes/**`) | `apply(ctx)` runs **once** when the DSH process starts, then lives in memory | You **must restart that host** (the official `DeepSeek Harness` and the community `DSH Desktop` are **two separate processes**, each loading its own copy) |

Three on-the-spot checks (all on local 127.0.0.1; any one of them settles it):

```powershell
# 1) Only a new host has this route: 200 = new code running, 404 = the host is old
curl.exe -s -o NUL -w "%{http_code}`n" "http://127.0.0.1:<GUI port>/wallpaper-engine/scene-payload-progress?token=x"
# 2) Only a new host's inventory has scenePkgBytes (the large-package first-frame budget scales by it)
(Invoke-WebRequest "http://127.0.0.1:<GUI port>/wallpaper-engine/inventory").Content | Select-String scenePkgBytes
# 3) Timestamp comparison: build-stamp.at is when the CURRENT host ran apply; earlier than the source mtime => the host did not reload
Get-Content "$env:USERPROFILE\.dsh-wallpaper-engine\build-stamp.json"
Get-Item  D:\dsh-wallpaper-engine\lib\index.js | Select-Object LastWriteTime
# 4) Process start time: the host process started before you edited the file => it holds the old module in memory
Get-Process 'DeepSeek Harness','DSH Desktop' | Select-Object ProcessName,Id,StartTime
```

Two easy misreadings, while we are here:

- **The plugin directory is usually a junction** (`~/.dsh/profiles/<profile>/node_modules/dsh-plugin-wallpaper-engine → the workspace`),
  so "the file is already new" does **not** mean "memory is new" — what matters is the **load moment**, not the file contents.
- **The panel line "live render failed (…) fell back automatically" comes from persisted failure memory**
  (`settings.sceneLiveFailures` in `config.json`) and says nothing about whether a frame was produced *this* time.
  After a pipeline change (new bundle / the host starting to expose a scene media origin) the client **invalidates it once**
  (see [`CHANGELOG.md`](./CHANGELOG.md)); on older versions you must toggle "scene live render" off and on to clear it.

### Install failure: `ERR_PNPM_UNEXPECTED_VIRTUAL_STORE`

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

### Install failure: `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`

```text
[ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED] ... The git-hosted package "dsh-plugin-wallpaper-engine@0.6.8"
needs to execute build scripts but is not in the "allowBuilds" allowlist.
```

**You used a `github:` install form** (e.g. `dsh plugin --profile web add github:elysia395/dsh-wallpaper-engine`).
Since v1.4 the client artifact `lib/client.js` is **not committed**, and no build script runs at install
time (pnpm 11 blocks build scripts of git-hosted packages by default for supply-chain safety) — so a
`github:` direct install ships no client half and is not supported. Use the **npm package name**
instead (the published tarball is built at packaging time; no compile-time build is needed):

```sh
dsh plugin --profile web add dsh-plugin-wallpaper-engine
```

> If your plugin hub (dsh-plugin-hub) generated a `github:` command, upgrade it to **v1.4.1+** — the
> new version auto-resolves the npm package name and switches to the npm channel.

### Install failure: `generation peer validation failed: @deepseek-ai/dsh-client-runtime does not resolve`

```text
generation-install: installed in 436ms
generation-install: generation peer validation failed: @deepseek-ai/dsh-client-runtime does not resolve from the installation closure
```

**Your DSH core is older than this plugin's tested floor.** The plugin declares
`engines.dsh >= 0.1.5-rc.1` and `@deepseek-ai/dsh-client-runtime >= 0.1.0-rc.6`
(`package.json` `engines` / `peerDependencies`; the tested floor is kernel **0.1.5**) — a kernel
older than **0.1.5-rc.1** (e.g. `0.1.2-rc.1` / DSH Desktop 2.0.5) ships a runtime below that floor,
so pnpm rejects the dependency graph at generation time. This is not a network / mirror /
pnpm-state problem, and **installing an older plugin version will not help**: kernels predating
0.1.5-rc.1 are outside the tested support range — loosening the peer range would only produce an
install that is broken at runtime.

**Fix: upgrade the host first, then install** (both steps):

```sh
# 1) Bring the DSH kernel to >= 0.1.5-rc.1 (updating the official desktop app to the latest is
#    enough; the old DSH Desktop line needs at least 2.0.7). Self-check: `dsh --version` >= 0.1.5-rc.1
dsh --version
# 2) Install again
dsh plugin --profile web add dsh-plugin-wallpaper-engine
```

> "The desktop app says v0.10.0" is the **app's own** version number, not the bundled **DSH core**
> version — the verdict comes from `dsh --version` (issue #116: a v0.10.0 desktop app bundling a
> 0.1.7-rc.2 core; that kernel now satisfies ≥ 0.1.5-rc.1 and can install this plugin).

### Symptom → where to look first

| Symptom | Check first |
|---|---|
| The panel shows 「宿主里没有字体集路由…」 or 「宿主返回 404 / 405」 | The host is stale: **host-side code loads once at startup**, so a page refresh only swaps the client bundle. **Restart DSH** (`dsh web` again, or quit and reopen the desktop app). Two self-checks: ① `~/.dsh-wallpaper-engine/build-stamp.json`'s `at` must be later than `lib/index.js`'s mtime; ② search `diag/http.jsonl` for `fontsets` — **zero hits** means the request never reached the plugin (a bare status code can only come from another layer) |
| The settings panel suddenly goes blank / the whole UI whites out | Search the client-exception trace first: `client-error` (the message plus the first three stack frames, all in one diagnostics line). One known class is **React #31** (an array of objects rendered as a child) — the `client-error` text points straight at the line |
| After confirming something (a delete / hide) the wallpaper stays paused and inputs stop responding | A native `confirm` hands focus to its own window, so with "pause on window blur" the wallpaper stops; the modal also blocks the render thread, and the `focus` event on dismissal is not guaranteed to arrive (on older builds only a reload recovered). The occlusion decision is re-checked every 3 s and logs an `occlusion-recheck` line (a lost event heals itself), and deleting a font set uses an in-panel confirmation. On older builds, click the window or switch away and back |
| The wallpaper picker is empty | Wallpaper Engine installed with at least one wallpaper; restart `dsh web` (see [`../../README.beginner.md`](../../README.beginner.md), FAQ 1 — Chinese only) |
| A solid white flash (light grey under the default dimming) when minimizing / restoring the window, and a white taskbar thumbnail | What shows through is the **window base plate**. **Current branch**: while a wallpaper is active the root element carries an opaque wallpaper representative colour (picture dominant colour → author scheme colour, `--we-wallpaper-underlay`), so a dropped layer degrades to a tone-matched solid instead of a white flash; becoming visible again also triggers a two-frame re-composite nudge. If it is **still pure white** (no tone at all), the window submitted **no frame at all** at that moment — that is the shell's base plate (the win32 `BrowserWindow` sets no transparent `backgroundColor`) and cannot be changed from the plugin side; please attach the `onscreen` line from the diagnostics |
| Video wallpaper is black / frozen | The card's play button and message: 「播放」 means it is not actually playing — click to retry; an "cannot decode" hint means re-export as **H.264** MP4 |
| A Web (HTML) wallpaper shows nothing but the page background | Web wallpapers render **live** by default (the renderer page loads `/scene-live/` and pulls sub-resources via `/scene-files/<token>/…`). **Refresh the page first**; if it is still blank, restart `dsh web` once (the host route is registered when the plugin loads). To rule the live path out, turn off 「网页实时渲染」 under **Playback → Effects** and check the **compatibility path** (`/wallpaper-engine/media/<token>` — the plain-iframe fallback loading the same entry HTML). On either path, check DevTools → Network: sub-resources should be 200 — report the failing request path if you see 404/403 |
| A web wallpaper turned black / 403 after picking an adapter target | The manual pick in 「System → Advanced → 适配」 **wins over detection**: picking 「原生浏览器」 while running in a desktop client that enforces the capability-header fence makes the web payload switch to the app origin and get rejected with `403`. Switch back to 「自动检测」 (or any desktop target) to recover; the section's status line states what was detected and warns directly when the pick contradicts it |
| A custom upload is not visible | The **content rating** filter above the grid (defaults to Everyone; unrated uploads count as Everyone) |
| Scene wallpaper shows a still image | **It should not by default** — scene wallpapers are rendered **live** by WebWallGL (particles / scripts / parallax all animate). First check whether 「场景实时渲染」 under **Playback → Effects** was turned off, and whether a failure reason (first-frame timeout / runtime stall) is shown under that switch: re-enabling it clears the failure memory and retries. Only when live rendering is unavailable does it fall back to the chain (author-embedded MP4 → live capture → custom frame → empty state; before the first frame it shows the **author's preview**, so there is no black screen); browsers without WebGL2 **always** take that chain (a **loose `scene.json` directory does not** — it renders live too) — there, use 「出图来源」 to pick another frame source or import a 「自定义画面」 (see [`HOW-IT-WORKS.md`](./HOW-IT-WORKS.md)) |
| Scene / web wallpaper is black, and ~15 s later it falls back to a static frame (or just the poster) | That is the live renderer's **watchdog degrading**: no first frame within 15 s ⇒ the failure is remembered and it degrades automatically. Check that the file is readable and the GPU driver works (WebGL2 is required); re-enabling 「场景实时渲染」/「网页实时渲染」 clears the memory and retries. **Current behaviour**: that extraction/compositing chain is gone entirely — the host **only serves a frame that already exists** (otherwise an honest 404 empty state; it neither generates nor prewarms anything) — and the client's pre-first-frame poster takes **live-captured frame → the author's preview → the theme colour**, so **even a wallpaper that never captures a frame is not black before the first frame**. If you still see nothing but a flat colour for a long time, **not even the author's preview** could be read (no preview in the project, or a read failure) — please attach the diagnostics lines |
| The frame-rate cap does nothing | It needs ffmpeg (the encoder prefers NVENC, falling back to libx264 software encoding without an NVIDIA GPU); with no ffmpeg at all the feature disables itself (see 「Limitations」 in `../README.en.md`) |
| A mid-grey / light slab appears to the right of the conversation area once the right sidebar is closed | The right-panel container keeps its width and only hides its children, while the plugin's frosted background applies to that container in every state (guarded by `verify-host-paint-scope`); workaround: turn off the 「侧栏液态玻璃」 master switch, or drag that session's right-sidebar width to 0 |
| Settings revert after a restart | Settings live in a host-side file (see "Where are my settings stored?" below) — check `~/.dsh-wallpaper-engine/config.json` is writable and that you did not roll back to an older version. Also: a host log line reading 「settings PUT 丢弃了白名单外的键」 means the client's and host's field lists have drifted — please report that line |

### Terminal output: problems only by default

Host output has three levels whose names are the logger method names:

| Level | Criterion | Shown on the terminal by default |
|---|---|---|
| `error` | breaks the **plugin / DSH / system** (a core capability fails to start, data or processes are damaged, the user must act) | ✅ |
| `warn` | an abnormal condition that **affects what you see** (degradation, fallback, a fence rejection, first-frame timeout, retry, rejected request) | ✅ |
| `info` | everything else (diagnostic detail, per-frame stats, runtime information, the log-side trace of a success) | ❌ |

**Only the first two levels are shown by default** — so "the wallpaper goes black" is silent on the
terminal, while the on-disk record keeps being written. To see the detail (per-texture lines,
heartbeats, the autosize gate, preparation probes…):

```powershell
# Windows PowerShell (this launch only)
$env:DSH_WE_LOG_LEVEL = "info"; dsh web
```

```sh
# macOS / Linux
DSH_WE_LOG_LEVEL=info dsh web
```

Accepted values are `error` / `warn` / `info` (default `warn`; anything else falls back to it).

The **on-disk** channel is still the first place to look (it is unaffected by the terminal gate and
survives the terminal closing):

- `~/.dsh-wallpaper-engine/diag/http.jsonl` — request records, path fences, renderer and client
  reports; at the cap it rotates to `http.jsonl.1` (one generation only, so the directory has a hard cap;
  threshold and line shape are in the `lib/diag-trace.js` file header);
- `GET http://127.0.0.1:<port>/wallpaper-engine/diag-log` — the last batch of renderer / client reports (ring cap and window: see `lib/routes/diag.js`).

Success notices ("wallpaper media origin listening", "scene wallpaper ready") travel on a **separate
channel**: one terminal line, `[wallpaper-engine] … ✔` — the **same prefix as the log lines**, with the
`✔` merely marking "this is a success, not a problem". Not through the logger, without a level, and not
written to disk. It only appears when **stdout is a terminal** — the DSH Desktop host is started by
Electron over a pipe, so `isTTY` is false and Desktop stays quiet by default. To see notices on Desktop,
opt in:

```powershell
$env:DSH_WE_NOTICE = "1"   # set before launching DSH; "0" silences it permanently (including the warn for a failed delivery)
```

---

## Known behaviour boundaries (**not bugs**, but very easy to report as bugs)

All three are the unavoidable price of one trade-off: **keep the old picture rather than show the base
colour.** They are listed here so that a "looks stuck / flashed for a moment" symptom has an explanation.
Criteria and readings for all three are in `docs/CHANGELOG.md` (the unreleased section).

### After switching to a wallpaper: "nothing happened" and the old wallpaper stays

The layer content gate only reveals when the new layer **really has a picture**, or when that level reports a
failure. If the media request **hangs** (neither succeeds nor fails), the new layer keeps waiting and the old
wallpaper stays on screen — what the user sees is "I clicked and nothing happened, and the settings show a
different wallpaper than the screen".

**Current state**: the video channel has a **bounded** fallback — it re-checks every `VIDEO_POSTER_BUDGET_MS`
(see `src/video-layer.js`) and only reveals when something is really on screen; at `VIDEO_STALL_GIVE_UP_MS`
with still no picture it **keeps the old wallpaper** and writes one `video-stall` warn to the diagnostic
archive. **"Release to the theme colour / base colour on timeout" was explicitly rejected** — that is exactly
the shape of the solid-colour bug (the gate releasing while `readyState = 0` ⇒ the user stares at a full block
of base colour for a second or two).

### The first wallpaper after a page load shows a short stretch of base colour

There is **no old layer to hold** at that moment, so the gate is not armed at all ⇒ the base colour is on
screen until the first frame arrives. Measured (one-off; readings and conditions in the unreleased section of
`docs/CHANGELOG.md`): for the same 729 MB 4K120 source, `loadedmetadata` on that "first wallpaper" path takes
only a bit over a hundred milliseconds.

**Current state (not done)**: the fix is to give video wallpapers a **real still frame** as their face
(reusing the existing frame-extraction path) instead of waiting for the `<video>`'s first frame.

### Switching to a "web wallpaper (legacy link)" shows a short white / empty stretch

The gate recognises `iframe.we-live-iframe` via `we-live-on`; a bare `iframe.we-iframe` falls into the
"don't gate" bucket.

**Current state (not done)**: this one **can be covered** — the iframe element's own `load` / `error` fire
even cross-origin (the same code already uses them in `prepareWebProbe`); all that is missing is wiring those
two signals into the gate's signal table.

