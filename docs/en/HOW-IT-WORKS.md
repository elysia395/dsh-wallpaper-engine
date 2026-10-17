# How it works

> **中文**: [`../HOW-IT-WORKS.md`](../HOW-IT-WORKS.md)（与本文同源：改一处请同步另一处）
>
> This document covers **user-visible behaviour** (why a wallpaper renders the way it does, and what
> happens when it fails). **Code structure** is in [`CODE-STRUCTURE.md`](../CODE-STRUCTURE.md);
> **why it was designed that way** is in [`adr/`](../adr/). It deliberately **carries no drifting
> numbers** — counts, sizes and timeout thresholds point at the implementation or give a way to
> recompute them (see [`README.md`](../README.md) §写作纪律 4).

### The default form for scene / web wallpapers: WebWallGL live rendering

**Scene and web wallpapers render live by default** (setting `sceneLive`, UI labels 「场景实时渲染」 /
「网页实时渲染」, on by default) — the renderer is the **engine from the npm dependency `webwallgl`** (version pinned in `package.json`) plus
the in-repo adapter page under `lib/webwallgl/` (`index.html` + `renderer.js`); engine files are served at
runtime straight from `node_modules/webwallgl` (under `engine/`), and the page is mounted by the host with `/wallpaper-engine/scene-live/` as its base (asset
references resolve under that prefix); the wallpaper's own files (`scene.pkg` / web project files) are
served through `/wallpaper-engine/scene-files/`. For web wallpapers the host injects the WE API shim
(extracted at runtime from the package's `webwallgl.mjs`) and the `project.json` property seed into the returned HTML — under the
strict sandbox the renderer page cannot reach into the wallpaper iframe, so the shim must ride along
with the document.

- **When live rendering is skipped**: the wallpaper switch is off, or the wallpaper is in the **failure
  memory** (first-frame timeout, or **no frames for a sustained run** at runtime — the heartbeat ticks
  once per second, auto-`resume()`s once at `LIVE_STALL_TICKS` ticks as a self-rescue, and only declares
  `stall` at twice that). It then falls back to the **out-figure
  chain** below (which is allowed to come up honestly empty).
  ⚠️ **A loose `scene.json` directory is not a reason to skip live rendering**:
  WebWallGL supports the loose form natively — the site root is identical for both forms and the
  renderer decides from `project.json`'s `file` suffix, so the host only has to answer "is this a scene".
  **The first-frame timeout is not a fixed wall clock**: the first
  frame **cannot exist before the whole package has arrived**, so the budget is computed from the
  **package size** by `liveFirstFrameBudget()` (`src/live-layer.js`) and carries a ceiling; and the host
  keeps a **payload ledger**
  (`GET /wallpaper-engine/scene-payload-progress?token=…`, see [`ROUTE-INDEX.md`](../ROUTE-INDEX.md))
  that resets the clock every tick while bytes are still arriving — "still downloading" is no longer
  read as "cannot render". **Hidden / non-playing instances never pull the payload at all** (the
  iframe gets its `src` late, and going to the background swaps it for `about:blank`, which aborts the
  in-flight request): such an instance cannot produce frames anyway (Chromium freezes rAF of hidden
  pages) and it would otherwise compete for bandwidth and decoders with the instance that *is* visible.
  **When there really is no first frame, the cause decides the bookkeeping**: the ledger saying
  "transferred but never completed" ⇒ only a **session-local** soft failure (never the shared failure
  memory every window reads), with an automatic retry after a cooldown and a bounded number of attempts
  (both are constants in `src/live-layer.js`: `LIVE_TRANSFER_RETRY_DELAY_MS` / `LIVE_TRANSFER_RETRY_LIMIT`); only a
  renderer that genuinely never produces a frame, or loses its heartbeat, is persisted.
- **Out-figure sources (the one authoritative order; code in `lib/routes/scene-frame.js`)**:
  ① live-render iframe → ② the author-embedded MP4 (`sceneVideo`) → ③ **live-captured frame**
  (`<key>_gpu.png`, PUT back by the live page once the first frame lands) → ④ **custom frame** (a
  screenshot the user imported) → ⑤ **empty state** (404 with a machine-readable reason).
  **No black screen before the first frame**: the placeholder still is chosen as **live-captured frame →
  the author's packaged project preview → the theme colour** (`buildLivePoster`) — on a wallpaper's
  **first** activation the captured frame does not exist yet (this live session has to backfill it), so
  the author's preview stands in and is displaced the moment the live first frame lands. It is only a
  placeholder and is **never treated as "this wallpaper's out-figure"**.
  `?v=4` forces the custom frame and is **exempt** from the captured frame (an explicit pin is never
  displaced by a capture); `?v=1/2/3` are retired and clamped to 0.
- **Why there is no CPU fallback image any more (the P2-12 design decision)**: 0.6–0.7.x fell back to an
  offline scene renderer / main-texture extraction / the workshop preview image. All three could
  **"succeed" by producing a poor image** — bypassing the quality gate, caching a blurry frame, and
  turning a decidable fact ("this wallpaper has no usable picture") into something that looks like a
  normal frame. The whole line (renderer + extraction + compositor, ~10k lines) is gone; the contract
  now is **either a real picture or an honest blank** (the status row names the reason).
  ⚠️ **That ruling governs the server-side "out-figure"**: `/scene-frame` never produces a guessed
  image. The client's **pre-first-frame / empty-frame placeholder** still uses the **author's packaged
  preview** (the author's own image, not one this plugin synthesised) — it only holds until the live
  first frame or a user-imported custom frame appears.
- **Frame rate**: 「实时渲染帧率」 (15 / 30 / 60 fps) is passed through the iframe query.
- Guards: `test/verify-scene-live.mjs` (live chain), `test/verify-scene.mjs` (out-figure chain + cache).

### Scene rendering: how it works

Scenes are rendered live by the bundled **WebWallGL engine** (the engine itself comes from the npm dependency `webwallgl`; `lib/webwallgl/` holds only this repo's adapter page — see above; it parses
`scene.pkg` / loose `scene.json` itself and replays the object tree, textures, particles and shaders,
preferring the GPU and falling back to software): in WebGL2 it renders every image layer in real time
(shader effects such as waterwaves / waterripple translated from HLSL and executed on the GPU), puppet
skeletal models, particle systems and text objects, and runs the scene's own SceneScript — mouse
movement drives parallax / cursor interaction, and packaged audio (BGM / SFX) plays under the shared
volume / audio-switch settings and drives the audio-reactive effects.

The scene card's **type** badge in the picker reads 「场景」; `/scene-live` + `/scene-files` are its data
plane. The host contract is just two things: **feed the scene files to the render page on demand**, and
**keep the frame it captures** (③ above).

### Web wallpapers: implementation details & known limits

**Web wallpapers** go through WebWallGL too: the host injects the **WE API shim**
(`wallpaperRegisterAudioListener` / `wallpaperPropertyListener` / media listeners, taken from the
`webwallgl` package, injected into the entry HTML by `/scene-files`) and hands the page to the renderer — so
workshop web wallpapers that depend on the WE API (audio visualizers, property-driven and
pointer-tracking pages) actually run instead of rendering blank or erroring. **Security**: the wallpaper
iframe is forced into `sandbox="allow-scripts"` (strict sandbox) so the third-party HTML can never
inherit the DSH origin (it cannot call host APIs or read host storage as the app). Cross-origin control
and pointer injection go through the renderer page's `postMessage` channel. On load failure or a stalled
runtime the wallpaper is remembered and degrades to the legacy plain iframe (no WE API).

> **Payload origin (separate media origin)**: **a web wallpaper's entry HTML plus all of its subresources**,
> and **a scene wallpaper's `scene.pkg` (measured at 336 MB on the reporter's machine; the earlier
> "often 70–90 MB" is out of date)**, are served by a **dedicated loopback media
> origin the host opens itself** (a random port on `127.0.0.1`, reported by
> `GET /wallpaper-engine/media-origin`) — *not* by the plugin's HTTP routes (the app origin stays the
> fallback for when that origin cannot start). Why: DSH Desktop
> wraps every plugin route in a capability-header fence (`x-dsh-desktop-renderer`, injected only into
> requests issued by same-origin frames), and a strict-sandbox iframe is an opaque origin that can never
> carry that header — the wallpaper entry would always answer `403 Forbidden` (symptom: the preview frame
> looks fine, then the wallpaper goes fully black). The media origin bypasses that fence, and third-party
> HTML no longer shares the host origin at all, so the sandbox gets a second layer of isolation.
> **A scene wallpaper takes it for payload speed**: a large `scene.pkg` cannot fit the first-frame budget
> on the app-origin path (which must also buy texture decode and shader compile), so the host points its
> payload at the media origin **unconditionally**. **`scene.pkg` is also revalidatable-cacheable**: the
> response carries `ETag` (size+mtime) + `Last-Modified`, and a matching conditional request answers `304`
> with no body — re-reading a few hundred MB from disk on every live-layer rebuild is exactly what this
> removes (the entry HTML stays `no-store`: it carries the injected shim and the property seed).
>
> **When that second listener is actually opened** (adapter mode, set under 「高级 → 适配」): **the scene
> payload is independent of the adapter form** — its reason for a separate origin is **bandwidth**, which
> holds in a plain browser too, so `inventory.sceneMediaBase` no longer collapses to an empty string just
> because the surface looks like a browser (that old behaviour sent big packages down the path that
> starves; fixed 2026-09). The **web wallpaper** half is still gated on the capability header (the fence
> only exists on desktop shells): the host observes
> the **capability header** and **`Electron/` in the UA** per request — either one marks a desktop surface and
> the media origin starts as before; when neither is present (**a plain web browser**) there is no fence, so the
> web payload is served from the app origin as a **relative path**. The same mount handler serves both, so the two
> forms differ only in the URL. It starts **lazily, on demand**: when the library holds a
> web wallpaper, or when it holds a **live-renderable scene** (`sceneLive`); the scene origin reaches the client
> as `inventory.sceneMediaBase` (**an empty string now means only "it could not start" ⇒ fall back to the app
> origin**; the layer key carries this value, so the renderer page is rebuilt once the host manages to offer it).
> A manually picked
> adapter target forces either direction, and
> `GET /wallpaper-engine/media-origin` is an explicit probe that starts it on demand without going through
> this gate.

> **Frame cap and "it still stutters"**: the wallpaper's rAF cap is implemented by **frame skipping** —
> every vsync is kept so the delivered frame stays phase-aligned with the display and only every n-th
> frame reaches the page (a `setTimeout`-based cap yields 17/33/50 ms jitter, which looks worse). While
> live, a `live-fps` line is written to the diagnostics file every 5 s: `ui=` whole-page fps, `web=` the
> wallpaper's own fps, `rnd=` renderer-page fps, `cap=` the current cap. If it still feels heavy, that
> line tells you whether the wallpaper itself is slow (`web` low) or the whole page is (`ui` low too —
> e.g. the sidebar's `backdrop-filter` re-sampling the wallpaper every frame; try lowering the blur to
> confirm).

> **Known limits**: author `fetch`/`XHR` carries `Origin: null` under the opaque origin (the host answers
> with `Access-Control-Allow-Origin: *`, so ordinary resources load); `wallpaperMediaIntegration` (system
> Now Playing / cover art) **is** supplied by the host; CSS `:hover` interaction driven by the browser's
> own hit-test cannot be triggered by external pointer injection (as documented upstream).

### Host / client split

- **Host half** (`lib/index.js` + `lib/routes/*.js`): a Cordis plugin that
  1. locates the Wallpaper Engine install by reading Steam's `libraryfolders.vdf` (so it works even when Steam is on a non-default drive),
  2. enumerates wallpapers from `projects/defaultprojects`, `projects/myprojects`, and `steamapps/workshop/content/431960/*`,
  3. registers same-origin HTTP routes on the DSH webserver so the browser half can fetch data and stream media directly. They are grouped by responsibility — **assets** · **transcode** · **live rendering** · **out-figure & capture** · **settings & system**.
     **The authoritative list (each route's source line, registration shape and context contract) is [`ROUTE-INDEX.md`](../ROUTE-INDEX.md)** — this file no longer hand-writes the path table *or a route count* (hand-writing always rots: that table long listed `/scene-runtime`, `/scene-manifest` and `/scene-resource`, **all three deleted**, while missing most of the routes that existed; the count drifted the same way).
- **Client half** (`lib/client.js`): a browser module that fetches the inventory and renders the selected
  wallpaper into a fixed layer *behind* the app columns; it registers the first-level settings page
  **「壁纸引擎」** (Wallpaper Engine) with six tabs (library / appearance / playback / system /
  extensions / about — **extensions** is the module container for later features: its registry comes
  lazily from `extensionModules()` in `src/panel-tabs.js` (never a top-level reference to a sibling
  module's symbol — importing that source file on its own would throw a ReferenceError), an empty
  registry renders an empty state, and the modules registered today are **click & trail effects**: descriptor `packages/fx/src/ext-fx.js` (the island — one master
  switch plus a sub-switch each for clicks and the trail, alongside their style, size, glow, duration,
  width, opacity, blend mode and colors), canvas layer `packages/fx/src/fx-layer.js` (**client-only, no host half**) — it
  only listens passively to `pointermove` / `pointerdown` on `document` (the host is a `pointer-events: none`
  overlay, so it never captures input; a click whose target sits inside
  `button, a, input, select, textarea, label, [role="button"], [contenteditable="true"], .we-picker, .we-modal`
  is dropped, so clicking the plugin's own controls never also bursts a ripple) and paints into a body-level
  `.we-fx` canvas (`z-index: -1`; document order keeps it above the wallpaper and below the scrim,
  re-checked every frame with `compareDocumentPosition`). The loop is **content-driven**: clicks draw two
  spreading rings (the second one starting 18% of the lifetime later) or a cluster of **unequal** flying dots
  plus a white flash at the center, and the trail either tapers a round-capped band segment by segment or
  leaves dots behind at a fixed step — both fade by age and are dropped once spent (a resting pointer still
  fades out), and the loop stops itself when there is nothing left to draw (zero frames while idle). It
  deliberately never reads wallpaper pixels (hence no Auto mode), writes opacity and blend mode on the
  **host element** (on the canvas they would only blend against the host's own stacking context), composites
  with `lighter` inside, and takes its color from the theme accent / rainbow (a hue per instance, drifting
  over time) / custom.
  The registry also holds the **3D depth** module (the **third** entry in that module container, after the avatar and click/trail effects — the ordinal is fixed by the registry order, not by this page): behaviour layer `packages/parallax/src/parallax-layer.js` plus
  descriptor `packages/parallax/src/ext-parallax.js` — the opposite of the one above, it **builds no DOM node at all**. It
  only listens passively to `pointermove` on `document`, `resize` on `window` and `visibilitychange`,
  turning the cursor's offset from the screen center into a displacement, and each frame writes the
  **final, fully multiplied displacement** straight onto **the layers that actually move** as the CSS
  **independent property `translate`** (two decimals; nothing is written when the value did not change) —
  the displacement **never travels through a custom property**: custom properties inherit, so writing one
  would re-resolve styles for a whole subtree. The body keeps a single "wallpaper bleed" multiplier
  `--we-parallax-bg` (written once per settings change, feeding the static
  `scale: calc(1 + multiplier / 50)` in the parallax section of `src/styles.js`, i.e. the wallpaper is
  enlarged by `1 + pct/50` so no base color shows past the edges). **A percentage means "the largest
  displacement this layer can reach, as a share of the screen's longest diagonal"** (user wording
  m02697-①: with the cursor in a screen corner |displacement| is exactly p% x diagonal), so the per-frame
  formula is `displacement = 2 x pct/100 x (cursor - screen center)`, written in the layer as
  `PARALLAX_STEP_DIV = 50`. The wallpaper and the
  mascot each multiply their own percentage (1% for the wallpaper by default, the mascot sharing the
  wallpaper's value); the interface groups (composer / conversation text area (user bubbles inside
  included) / sidebar) are governed by a
  separate sub-switch `parallaxUi` (off by default) and the four regions **each store their own absolute
  percentage** (`parallaxUiChatDepth` / `parallaxUiComposerDepth` / `parallaxUiSidebarDepth` /
  `parallaxUiBubbleDepth`, KINDS `num 0..10`, step 0.1, shipping at 1.2 / 1.8 / 1.6 / 1.4 (user request m04159 pinned those four to the values he had tuned; source of truth = `lib/settings-schema.js`)): the old **total factor**
  `parallaxUiDepth` and the whole "panel x100 / stored factor" chain are retired, so the panel and the
  stored value now **share one unit** and setting a region to 0 means that region does not move at all
  (user ruling m02697-③). **Front-end element groups registered by other plugins** (user wording m02697-②)
  have **their own switch**, `parallaxPlugin` (user request m03549: **independent of `parallaxUi`, off by
  default**, because it moves the real interface drawn by other plugins): while it is off the layer does
  **not even scan** for them (rather than computing a coefficient of 0) and that panel card shows only the
  switch; once it is on the layer scans the host's slot outlets `[data-slot]` (an outlet itself is
  `display: contents` and generates no box, so the displacement lands on its **element child**), skips
  frame-wide containers / the native groups' own outlets / the settings and plugin-management subtrees, then
  runs a second filter `parallaxPluginEffectiveGroups()`: an outlet that sits **inside one of the four native
  group boxes** or **inside another discovered plugin group** does not count (that filter only applies while
  "Interface follows" is **on**), and reads the distance from `parallaxPluginDepths` (slot key -> %, a `map`
  entry) where **a missing key means the 1% default and an explicit 0 means that group does not move**
  (that table only counts while the switch is on); the panel's list comes from the layer's
  `parallaxDiscoveredGroups()` through `ctx` (**same source as what actually
  moves**: it and the target rescan share the one `parallaxPluginEffectiveGroups()`, so every row has a
  landing spot; the single exception - a group with a `position: fixed` descendant stays put - is spelled
  out in that row's tooltip), and the panel splits it into three cards ("Background" / "Native front end" /
  "Plugin front end"). User bubbles stack one more layer on top of the
  text area, and only the 24 most recent ones move; `PARALLAX_UI_SIGN = 1` makes the interface move the
  **same way as** the wallpaper - the near interface travels a little further than the far wallpaper, a
  camera pan - and the displacement itself lands on the anchor itself when it owns a box, or else on the
  nearest ancestor that does (`parallaxGroupBox()`, at most 3 levels up), because the host's slot outlets hard-code `display: contents` and generate none). The
  direction of the wallpaper leg is negated so the shift is **mirrored about the screen center**
  (cursor to the top right moves everything to the bottom left), the easing is an exponential approach per
  frame (`parallaxSmooth`, 0 = instant), and the loop stops itself as soon as the displacement left on
  screen no longer shows (zero frames while idle; frames now follow the display's real refresh rate, since
  the old 60Hz cap is gone, "arrived" is judged from the remaining step times the largest multiplier and
  loosened to 1px once the cursor has been still for 180ms, no frame is scheduled at all when every
  multiplier is 0, nothing is scheduled while the page is hidden, and the moving layers are promoted to
  compositor layers only while the loop runs, the hint being dropped the moment it settles — this repo
  deliberately keeps no always-on compositor layer). Frames take **zero measurements** (the viewport is
  read when the loop starts and on resize, and targets are re-scanned outside the frame as well), and
  `localStorage.weParallaxDebug = '1'` turns on a per-frame self-check (callback cost, write count and
  frame gap p50/p95/max plus a long-frame count, printed once the gesture settles and exposed as
  `window.__weParallaxStats`). The wallpaper's bleed scaling is the one above (the static `scale`
  in `src/styles.js`), and the displacement uses the CSS
  **independent properties `translate` / `scale`** rather than `transform` — the wallpaper transition's
  `resetLayerSwitchStyles` writes and clears an inline `transform`, so only the independent properties
  compose with it. The click & trail layer deliberately does not move; making the interface drift as whole
  blocks is **another sub-switch** (`parallaxUi`, off by default) whose displacement is **snapped to whole
  device pixels** (so text is never pushed onto half pixels) with **hysteresis** on that snapping (the
  easing tail lingers around zero, so an already written pixel is kept until the value leaves the hysteresis
  band - without it the interface flips 0<->1 device pixel between frames, which on its own would already
  read as a shiver across the middle) and whose `translate` is **removed entirely** once
  it settles (the property alone establishes a containing block, which would re-anchor fixed descendants);
  a group that contains any `position: fixed` descendant stays put, and nested groups keep only the
  outermost one (user bubbles are the deliberate exception: they live inside the conversation text area's
  box, so their displacement stacks on top of it). **The left column is the one different shape**: it is
  displaced with **relative positioning** (`position: relative` plus `left`/`top`) and **never** with
  `translate` - in Windows titlebar mode the host renders the "collapse sidebar" button as a
  `position: fixed` descendant of that very column, so any `transform` on it would become the button's
  containing block and push it down by a whole titlebar height (the class of accident #131 was); relative
  positioning establishes no containing block, so the left column is both safe and exempt from the
  `fixed`-descendant rule above. One more host fact the parallax section has to work around: the interface
  groups move **real elements that live inside the conversation scroll container**, so that section seals
  the container's horizontal axis (`body[data-we-parallax="on"] [data-conversation-scroll] { overflow-x:
  hidden; }`). The host writes `overflow-y: auto` there, and per spec a non-`visible` axis makes the other
  axis' `visible` compute to `auto`, so a horizontal displacement that crossed the container's inline-end
  grew a **horizontal scrollbar** - it ate a scrollbar's worth of scrollport and pushed the sticky composer
  card up (user report m02410-①: "a black bar shows up at the bottom of the composer and pushes it up").
  That scrollbar appearing and disappearing as the displacement reversed across the screen centre was the
  dominant part of the reported shiver, with the snapping hysteresis above only a secondary contributor.
  `hidden` is used rather than `clip` for wider support, and sealing the axis is preferred over
  `::-webkit-scrollbar:horizontal { display: none }`, which would switch that container to custom scrollbars
  and change the look of the vertical one too; conversation content never scrolls sideways anyway (long
  tokens and wide code blocks scroll inside their own boxes).
  On the settings
  page that hosts it,
  picking wallpapers is an in-panel drill-in view (no modals) alongside hide/restore, transitions /
  playback speed / flip, accent color + glass transparency, the font system, and custom-upload management.
  The page-wide glass recipe is **independent of whether a wallpaper is set**: its anchor is
  `data-we-glass-page` on `body`, mounted unconditionally by `applyGlass` in `src/glass.js` (the plugin
  running means the recipe applies) and removed in pairs by `clearEffects` in `src/effects.js`; a wallpaper
  is only one possible **backdrop source**, while `data-we-wallpaper` covers just the two "the page gets
  out of the way so the wallpaper layer shows through" declarations (page base colour / sidebar fill set
  to transparent).
  A separate **quick playback panel** (current wallpaper / rotation / fast list switching / sound, with
  list and card views) merges into the official right sidebar's tab on harness ≥0.1.5, and falls back to a
  right-slide drawer pulled out by the mascot on older hosts.
- **Custom-upload storage**: uploaded files are written to a plugin-managed local directory (default
  `~/.dsh-wallpaper-engine/uploads`, changeable from the settings UI) and served through the same
  `/media` + `/preview` routes as WE media — identical pipeline, survives restarts, no browser quota limits.

> Development details (build artifacts, hot-mount rules, cache-key prefixes) live in
> [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md).

### Font sets: where a whole look lives

A font set is **one `.json` file that describes the entire typography look** — role tokens (body /
secondary / dimmed / headings / code / table …), per-component overrides and the caret. Switching a set
switches all of them at once, which is what "one look" means here.

- **Two layers, and the user layer wins**: a set ships **with the package** under `lib/fontsets/`
  (read-only), and edits are written to the **user layer** under the plugin data directory. Editing a
  shipped set is **copy-on-write**: the user layer gets its own copy, and deleting that copy restores the
  shipped original — there is no "reset" command, because deleting *is* the reset.
- **Import / export is a plain `.json` round trip**: export goes through a host response header plus an
  ordinary link, so on desktop it is the system's own "Save as".
- **What is *not* persisted in settings**: the per-item font values. `config.json` keeps only the root
  fields (which set is active, plus the free-form custom entries); the keys themselves are defined once in
  `lib/settings-schema.js` and shared by the client and the host, so both sides sanitise the same way.
- **Guards**: `test/verify-fontset.mjs` (the whole feature) + `test/fontset-load-smoke.mjs` (loading).
  The three font channels and their invariants live in the file headers under `src/font/` — see
  [`FONT-SYSTEM.md`](../FONT-SYSTEM.md) for the index.

### The installed-font list: ask the OS, then cache it

Besides the built-in family keys, the "default font (global)" and "terminal font" dropdowns offer the
**fonts installed on this machine**. That list is **not** produced by the plugin reading font files — it
**asks the operating system** (on macOS **two legs run in parallel**: `system_profiler` for the
**localized** names and CoreText for the **canonical/English** ones, unioned — so both `苹方-简` and
`PingFang SC` are selectable; Windows PowerShell's `InstalledFontCollection`; Linux `fc-list`); when none
of those answers, names are derived from **font file names** and the result is
**honestly marked as a guess** (the panel says so). A single scan is expensive (seconds to tens of seconds
on macOS) ⇒ two cache layers, stale values served first with a background rescan, and a "Rescan" button in
the panel; **nothing is scanned at startup** (the first real use triggers it). ⚠️ **The names a system lists are not necessarily names a browser can match** (system-reserved faces such as `Apple Color Emoji` / `Symbol` / `Zapf Dingbats`, plus alternate spellings like `苹方-繁`, can all resolve to nothing) — when the panel renders it probes whether each name actually works in this browser, skips the ones that do not, and **says how many were skipped**, so a dead option is never mistaken for a broken feature. The decision and its costs
are in [ADR-0009](../adr/0009-system-fonts-from-the-os.md); the mechanism invariants live in the headers of
`packages/fonts/lib/routes/system-fonts.js` and `src/system-fonts.js`.

### Captured-frame geometry validation (viewport aspect ratio)

A captured frame is "the composition of the renderer viewport at the moment of capture" — the renderer
frames by canvas ratio (within 2 % of the scene's design ratio it shows the whole design, otherwise it
covers by canvas ratio), and the frame is then laid out through CSS `object-fit: cover` again. So a frame
captured in **another window / an older session** gets cropped a second time on screen: measured, a
1440×960 (3:2) frame in a 2488×1376 viewport shows only 84.5 % of the scene's design width (from a
best-match fit against a CPU frame), with subjects ~19 % larger than live and cut off on all sides. The
host therefore attaches `X-WE-GPU-W/H/AR` to `HEAD /scene-frame/<token>` (read from the PNG's IHDR, pure
file header, no extraction), and the client compares it with the current viewport: a relative difference
> 2 % (the same tolerance the renderer uses for its own fit) or an unknown geometry (old host / unreadable
file) triggers **capture → content gate → clear the slot → PUT** (clearing after capturing, because a
capture failure that left an empty slot would fall back to a CPU frame — worse than keeping an
old-composition frame). Once stored, the still frame is re-mounted in place and a `gpu-frame-stale` /
`gpu-frame-recaptured` diagnostics line is written. Old frames therefore heal themselves on the next
mount / rotation; no manual cleanup is needed.

### Empty-frame gate & clear channels

A byte-size threshold is unreliable (measured black PNGs from a headless run: 960×540 ≈ 12 KB,
1080p ≈ 44 KB, 4K ≈ 165 KB — all far above any fixed gate), so before storing a capture the canvas is
downsampled to `LIVE_FRAME_SAMPLE` and its brightness distribution inspected: near-black or almost no
contrast means "nothing has been rendered yet" and the capture is abandoned (the CPU frame stays), plus a
resolution-scaled size floor.
**The sampling edge and the four thresholds are constants in `src/live-layer.js`**
(`LIVE_FRAME_SAMPLE` · `LIVE_FRAME_LIT_RATIO` · `LIVE_FRAME_MIN_VARIANCE` · `LIVE_FRAME_BYTES_PER_PX`);
this document does not copy their values — they are **tunable parameters**, and a copy here would drift
away from the implementation. When a capture is unsatisfactory there are three entries under
**Settings → Effects → Picture → 「实时帧」**: the **thumbnail preview** (the very still shown during a
switch / before the live first frame, same URL as the one in use — with its pixel dimensions),
**「重新截」** (re-capture the **current** picture and replace the cache; if it fails the old frame stays,
with the reason shown inline), and **「清除 GPU 帧」** (equivalent to
`DELETE /wallpaper-engine/scene-frame-cache/<token>`, or `POST …?clear=1` — afterwards HEAD reports
`X-WE-GPU: 0`, the current tier takes effect immediately, and the next live session captures again).

> **This row is not gated on the live-rendering switch**: that live frame is exactly what is on screen
> during a switch and before the live first frame, so a wrong composition (black frame / old viewport /
> captured mid-transition) must be re-capturable **immediately** rather than after turning live rendering
> off and back on. By the same argument **「自定义画面」 is always shown** (an imported screenshot and live
> rendering do not interfere). Only **「出图来源」** (switching capture tiers) is hidden while live
> rendering is effective — changing tiers has no effect then, so showing it would only mislead.

### Occlusion pause: the verdict does **not** come from events alone

Pausing on occlusion is driven by `visibilitychange` / `blur` / `focus` events — and that has a hole
caused by **native modals**: `window.confirm` / `alert` hand focus to their own window, and the `focus`
event on the way back **is not guaranteed to arrive**. The verdict would then rest permanently on "not
visible", i.e. a wallpaper that never resumes. The host therefore runs an **idempotent timer poll as a
second leg**: if the page is the visible document and its `visibilityState` says so, the verdict goes
back to "playing" even when no event ever arrived — and while the occlusion pause is in force the poll
interval is deliberately short so a missed resume is corrected within a beat rather than after minutes.

- The three switches (minimize / switch tab, window focus loss, on battery) are defaults in
  `lib/settings-schema.js` — **the panel is the source of truth for their current values**, this document
  does not copy them.
- 「窗口失焦时暂停」 is **only offered when the adapter target is a plain browser**: a desktop shell keeps
  the wallpaper visible while unfocused, so pausing on blur would freeze a picture the user can still see.
  The stored value is not deleted when the target changes — switching back re-enables it.
- On a hit, video wallpapers **stop decoding outright** (not merely throttled by the browser: the decoder
  goes idle), and a live scene stops its render loop. Coming back to the foreground / plugging in resumes
  automatically — except a wallpaper the user paused by hand, which is never auto-resumed.

### Theme follows the wallpaper: colour chain and the yield rule

After a switch the plugin decides the global light/dark theme (`src/theme-follow.js`) — driven by the
**"Theme follows the wallpaper" switch**, which `lib/settings-schema.js` leaves **off by default**
(off = the whole colour chain below never runs). With the switch on, colour order:

1. **The wallpaper's own scheme colour** — `general.properties.schemecolor.value` in `project.json`
   (a 0–1 float triple; in the WE editor its `text` is `ui_browse_properties_scheme_color`). The host's
   inventory already converts it to `rgb()` (`schemeColor`); an override you set in the **壁纸属性** panel
   wins over the author's value. **Almost every wallpaper in a real library carries the property** ⇒ almost
   none of them need any image work. An author value of exactly `0 0 0` counts as **unfilled** (the WE editor's
   default for new projects, and a substantial share of a real library) and falls through to ②; a pure black
   picked by hand in the panel is still honoured.
   > The hit rate is **not written down here**: it varies with *which wallpapers you have installed*, i.e. it
   > is a different number for every reader. To recompute it, tally the `schemeColor` field (the inventory
   > builder is the reference implementation).
2. **The most-occupied colour of the picture** — only when ① is missing: downsample the picture to
   `LIVE_FRAME_SAMPLE` and take the modal bucket after **4 bits/channel** quantisation (the quantisation
   rule and bucket count live in the colour-picking code in `src/theme-follow.js`; same
   downsample precedent as `liveFrameLooksUsable`). Two sources **vote**: the author's `preview` and a real rendered frame (scene wallpapers sample the frame the
   live renderer just captured, reusing that same read; web wallpapers use their `__wp.capture` result),
   and **a disagreement resolves to dark** — light only when both agree (a capture may land on a frame that has
   not settled yet). Neither ever overrides ①. Absolute URLs use `crossOrigin="anonymous"` (the media origin sends
   `Access-Control-Allow-Origin: *`), so the canvas is never tainted.
3. **Neither available ⇒ leave the theme alone** — no switch, no thrashing.

Verdict: WCAG relative luminance (the same coefficients as `test/verify-readability.mjs`) with a threshold of
**0.40** — "only clearly bright colours get a light UI" (not mid grey 0.2159: the author colours in this
library have a median luminance of 0.214, so that threshold cuts through the densest part of the distribution
and calls saturated mid-tones light while the eye reads them as dark).

The write goes through the host's client Cordis service `theme` (`setTheme('dark' | 'light')`, same API on the
official and community clients) and uses **the same handle** as our token layer (both come from that one
`ctx.get('theme')` poll; deliberately no `inject` declaration, see the token-layer block in src/client.js).
Three self-imposed rules live in the module header: **nothing is written when the verdict already matches**
(`setTheme` persists the preference into the profile's `cordis.patch.yml`), **a manual change makes it yield**
(re-evaluating the same wallpaper will not take it back; the next switch resumes), and **no theme service ⇒
the whole feature stays inert**.

### Client-side errors also leave a trace (`client-error`)

A failure that only happens in someone's browser leaves nothing behind on the host — so the client reports
the chain it actually walked to the host's diagnostics file. Anything that drives a downgrade (a live
renderer that never produced a frame, a capture that failed, a preview that could not be read) writes a
`client-error` line with the branch taken and the step it stopped at, which is why "it went black on my
machine" can be answered from the log instead of by guessing. This is a **diagnostics channel only**: it
never changes what the user sees, and it is the same ring the host's own `diag` family writes to (see
[`ROUTE-INDEX.md`](../ROUTE-INDEX.md)).

### Tests

`npm run verify` (the client / transcode / playback-control / scene / scene-live entries among others) plus
`npm run smoke` (node-level behaviour: rotation, live-frame backfill and identity, font-set loading, and more).
Every assertion has a failure channel (a non-zero exit when it does not hold);
`npm run verify:all` = build + both suites + the soft tier.
**How many entries each chain has is not written here**: the source of truth is the `verify` / `smoke` /
`verify:docs` scripts in `package.json` — hard-coding a number here makes it drift.
