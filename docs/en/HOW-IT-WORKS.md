# How it works

> **中文**: [`../HOW-IT-WORKS.md`](../HOW-IT-WORKS.md)（与本文同源：改一处请同步另一处）
>
> This document covers **user-visible behaviour** (why a wallpaper renders the way it does, and what
> happens when it fails). **Code structure** is in [`CODE-STRUCTURE.md`](../CODE-STRUCTURE.md);
> **why it was designed that way** is in [`adr/`](../adr/). It deliberately **carries no drifting
> numbers** — counts, sizes and timeout thresholds point at the implementation or give a way to
> recompute them (see [`adr/0017`](../adr/0017-code-is-truth-docs-reference-source.md) D1).

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
  **package size** by `liveFirstFrameBudget()` (`src/live-layer/watch.js`) and carries a ceiling; and the host
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
  (both are constants in `src/live-layer/watch.js`: `LIVE_TRANSFER_RETRY_DELAY_MS` / `LIVE_TRANSFER_RETRY_LIMIT`); only a
  renderer that genuinely never produces a frame, or loses its heartbeat, is persisted.
- **Out-figure sources (the one authoritative order; code in `packages/media-bridge/lib/routes/scene-frame.js`)**:
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
- **Why there is no CPU fallback image**: any "guessed" picture shares one flaw — it can
  **"succeed" by producing a poor image**: bypassing the quality gate, caching a blurry frame, and
  turning a decidable fact ("this wallpaper has no usable picture") into something that looks like a
  normal frame, so the user sees "the wallpaper is blurry" instead of "it has no picture". The
  server-side contract is therefore **either a real picture or an honest blank** (the status row names
  the reason).
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

> **Payload origin (separate media origin)**: a web wallpaper's entry HTML plus all of its subresources,
> and a scene wallpaper's `scene.pkg`, are served by a **dedicated loopback media origin** the host opens
> itself (`GET /wallpaper-engine/media-origin`) — *not* by the plugin's HTTP routes (the app origin stays
> the fallback). Why: plugin routes sit behind a capability-header fence that a strict-sandbox iframe can
> never carry, so the wallpaper entry would always answer `403`; the media origin bypasses the fence and
> also keeps third-party HTML off the host origin. Scene payloads additionally gain **speed** (large
> packages cannot fit the first-frame budget) and `scene.pkg` carries an `ETag` so rebuilds can `304`.
> It starts **lazily**: only when the library holds a web wallpaper or a live-renderable scene. The full
> device-form and fallback rules are in [`CODE-STRUCTURE.md`](../CODE-STRUCTURE.md) §10.
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

- **Host half**: locate the Steam root (`DSH_WE_STEAM_ROOT` override → registry → common install dirs → WSL
  `/mnt`), read the libraries from `libraryfolders.vdf`, recognise the install root by its **marker files**
  (`wallpaper32.exe` / `wallpaper64.exe`, or `version.json` under the newer `distribution/`), then enumerate
  `projects/defaultprojects`, `projects/myprojects` and `steamapps/workshop/content/431960/*`.
  Rows, components, route families and the subpackage contract are in
  [`CODE-STRUCTURE.md`](../CODE-STRUCTURE.md) §1–§3; the authoritative route list is
  [`ROUTE-INDEX.md`](../ROUTE-INDEX.md) (this page does not hand-write paths or counts).
- **Client half**: fetches the inventory and renders the selected wallpaper into a fixed layer *behind* the
  three app columns; registers the first-level settings page **「壁纸引擎」** with tabs (library / appearance /
  playback / system / extensions / about); 「选择壁纸」 is an in-panel drill-in view.
  - Page-wide glass is **decoupled** from the wallpaper: the `data-we-glass-page` anchor is mounted by the
    glass row; a wallpaper is only one possible **backdrop source**.
  - 「左侧栏液态玻璃」 is off by default: off = a transparent hole, on = the same glass recipe for that column.
  - The **extensions** tab is a module container: **click & trail** (`packages/fx`) and **3D depth**
    (`packages/parallax`) are independent islands — what they draw lives in their module headers;
    `parallaxPlugin` (follow other plugins' front-end element groups) is **off by default**.
  - The about tab's two QR codes are packaged PNGs (`lib/about/`); the star count is fetched by the host
    (GitHub API, cached).
  - The quick playback panel **shares the same renderers** as the settings page; the sidebar form draws
    only the simplified configuration (presets and per-surface tuning stay in settings).
### Font sets: where a whole look lives

Font customisation works in **sets** — one look is one **file**, not a pile of settings keys:

- **Two layers, user layer wins**: a shipped set under `lib/fontsets/<id>.json` (read-only) and a user copy
  under `<pluginDataDir>/fontsets/<id>.json`. Editing a shipped set is **copy-on-write**; deleting the user
  copy restores the shipped one — there is no separate reset command.
- **Switching has one write primitive**: `POST …/activate` moves the pointer, and the client must read the
  value back and adopt it; "in use" means **the value still matches what was adopted**.
- **Import / export**: export uses a host response header plus an ordinary link; import is pre-checked
  against the file's `$schema` with a concrete reason on failure.

Endpoint families, key sources and failure semantics are in
[`CODE-STRUCTURE.md`](../CODE-STRUCTURE.md) §3.3 / §7; the decision record is
[`adr/0011`](../adr/0011-preset-full-snapshot.md).
### The installed-font list: ask the OS, then cache it

The dropdowns add **fonts installed on this machine** by **asking the operating system** (on macOS two legs
in parallel — `system_profiler` localized names and CoreText canonical names, unioned; Windows
`InstalledFontCollection`; Linux `fc-list`); when none answers, names are derived from font file names and
honestly marked as a guess. One scan is expensive ⇒ two cache layers, stale values served first with a
background rescan, plus a "Rescan" button; **nothing is scanned at startup**.

⚠️ **A name the system lists is not necessarily a name the browser can match** (system-reserved faces,
alternate spellings). The panel probes each name in this browser, skips the dead ones and **says how many
were skipped**. Invariants live in `packages/fonts/lib/routes/system-fonts.js` and `src/system-fonts.js`
file headers; the decision and its costs are in [ADR-0009](../adr/0009-system-fonts-from-the-os.md).
### Captured-frame geometry & the empty-frame gate

A captured frame is "the composition of the renderer viewport at capture time"; a frame captured in
**another window / an older session** gets cropped a second time by CSS `object-fit: cover`. The host
attaches `X-WE-GPU-W/H/AR` to `HEAD /scene-frame/<token>` (read from the PNG IHDR, pure header), and the
client compares it with the current viewport: a relative difference > 2 % or unknown geometry ⇒
**capture → content gate → clear the slot → PUT** (clearing after capturing: a failed capture that left an
empty slot would fall back to a CPU frame, worse than keeping an old-composition frame). The still is
re-mounted in place with a `gpu-frame-stale` / `gpu-frame-recaptured` diagnostics line, so old frames heal
on the next mount / rotation.

A byte-size threshold is unreliable (a black 1080p PNG is already ≈ 44 KB), so before storing, the canvas
is downsampled and its brightness distribution inspected: near-black or almost no contrast means "nothing
rendered yet" and the capture is abandoned, plus a resolution-scaled size floor.

**When a capture is unsatisfactory**: Settings → Effects → Picture → 「实时帧」 offers a **thumbnail
preview**, **「重新截」** and **「清除 GPU 帧」** (= `DELETE /wallpaper-engine/scene-frame-cache/<token>`).
This row is **not gated on the live-rendering switch**, and 「自定义画面」 is always shown; only
「出图来源」 hides while live rendering is effective.

Sampling and thresholds are constants in `src/live-layer/watch.js`; the implementation is in
[`CODE-STRUCTURE.md`](../CODE-STRUCTURE.md) §10.
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

Whether a switch also flips light/dark is driven by the **"Theme follows the wallpaper" switch** (off by
default in `lib/settings-schema.js`; off = the whole chain never runs). With it on, colour order:

1. **The wallpaper's own scheme colour** — `general.properties.schemecolor.value` in `project.json`; an
   override set in the 壁纸属性 panel wins; an author value of exactly `0 0 0` counts as unfilled (a pure
   black picked by hand is still honoured).
2. **The most-occupied colour of the picture** — only when ① is missing: downsample, 4 bits/channel, modal
   bucket; the author's `preview` and a real rendered frame **vote**, and a disagreement resolves to dark
   (light only when both agree).
3. **Neither available ⇒ leave the theme alone** — no switch, no thrashing.

Verdict uses WCAG relative luminance with the **"clearly bright"** threshold (deliberately not mid grey).
The write goes through the host's client `theme` service. Self-imposed rules: **nothing is written when the
verdict already matches**, **a manual change makes it yield**, and **no theme service ⇒ inert**.

Thresholds and implementation are in `src/theme-follow.js` (`THEME_FOLLOW_LIGHT_ABOVE`).
### Coexistence: glass surfaces vs. other UI plugins

#### Ownership Boundaries

Wallpaper and glass remain independent. Turning wallpaper off does not disable glass. The skin-centre marker `html[data-dsh-skin]` still makes the plugin yield as a whole and restore after the skin leaves.

While a wallpaper is active, the two page-let-through tokens (`--dsw-alias-bg-base`, `--dsw-specific-sidebar-fill`) are declared with author `!important` (`src/styles/base.js`, the `body[data-we-wallpaper]` and dark-theme blocks). This is a **cross-plugin contract**, not defensive coding: DSH's theme API lets a plugin (DS Bot's Bot mode, for example) colour the host through `ctx.theme.overrideTokens`, and the host writes the composed tokens as **inline styles** on `<body>`; a normal author declaration always loses to an inline one, so the wallpaper layer stays hidden behind the opaque page base ([#282](https://github.com/elysia395/dsh-wallpaper-engine/issues/282), the same "another plugin covers the wallpaper" class as [#279](https://github.com/elysia395/dsh-wallpaper-engine/issues/279)). The `!important` only applies inside the wallpaper gate; with no wallpaper this plugin declares nothing and the host's inline values apply unchanged — a one-way takeover that reads and writes no other plugin's state. A third-party panel that needs its own backing should paint its own surface background or use `data-we-surface-preserve` instead of rewriting these two page-background tokens.

The **page-level background-layer token mapping** (`--dsw-alias-bg-layer-1/2/3`, `--dsw-alias-button-elevated-fill`, `--dsw-alias-bg-overlay`, …) applies on `body[data-we-glass-page]` to the **whole page**: the host's own sidebar buttons, right-panel tab strip and settings-window cards all read that family, so scoping it to the chat flow alone makes those surfaces fall back to the host's solid fills. Every mapping still carries the readability floor (`--we-readability-floor`), so it is not unbounded transparency. Frost and backing plates for the settings window, sidebars and declared surfaces are still claimed per surface by the shared ownership runtime; unknown third-party panels keep their own background declarations, button semantics, syntax colours and terminal ANSI colours.

| Surface | Adaptation | Fallback |
|---|---|---|
| Native sidebars | Geometry-checked decorative leaves behind the page | Native background; no ancestor positioning or layer escalation |
| Settings window | Unused `::before` in an existing positioned stacking context | Native if blur, an occupied pseudo-element or unsafe structure prevents adaptation |
| Right-sidebar CodeMirror / xterm | Known canvases inside the expanded native sidebar | Ownership removed on native policy, preserve or sidebar close |
| Declared third-party surfaces | Explicit declaration and carrier safety checks | No guessing for undeclared or unsafe content |
| Extra selectors | Frost in an unused pseudo-element within an existing context | No new context or forced content-background removal |

Outer host-shell wallpaper transparency is separate from glass adaptation. These boundaries are not certification of every third-party plugin.

#### Per-Surface Fallback

**Glass compatibility** in appearance settings offers **Automatic** and **Keep native** for each surface. `glassSurfacePolicy` controls adaptation eligibility; existing inherited/custom `glassMode` parameters keep their meaning. Missing policies mean automatic. Policies participate in settings and profile preset persistence, import and export.

Surface IDs: `left-sidebar`, `right-sidebar`, `settings-window`, `content`, `declared`, `extra`. The advanced list shows ownership records as `id / mode / reason`, without collecting plugin text or arbitrary styles. It is a panel-render snapshot, not compatibility certification.

This is not a global glass-off switch. Chat, title-bar and other independent gates are outside this table. See [ADR-0010](../adr/0010-glass-off-revisit-four-states.md).

#### Author Declarations

```html
<section data-we-surface="v1" style="position:relative;z-index:1">
  <div data-we-surface-layout>Layout allowed to lose its background</div>
  <div data-we-surface-preserve>Content that must stay native</div>
</section>
```

- `data-we-surface="v1"` requests adaptation, not guaranteed ownership. Do not add a stacking context to shared ancestors merely for glass; the example assumes this positioning already exists.
- `data-we-surface-layout` permits background removal inside an owned declared surface, without crossing nested ownership boundaries.
- `data-we-surface-preserve` opts a node and descendants out, taking precedence over built-in adapters and extra selectors.
- Runtime attributes such as `data-we-surface-runtime` and `data-we-layout-runtime` are private. Third-party plugins must not set or depend on them.

No third-party nodes are moved, no third-party z-index is changed, and no top-layer escalation is used. While an external modal is visible, WE's rope, repository panel, update notice and automatic introduction hide. Ordinary non-modal `role="dialog"` does not trigger yielding.

#### Troubleshooting

| Symptom | Check |
|---|---|
| A surface stays opaque | Inspect policy and reason; preserving unknown content can be intentional fallback. |
| Extra frost does not appear | Check existing positioning, non-auto z-index, blur, occupied `::before` and preserve. |
| A popup is covered or fixed content moves | Compare geometry and actual hit targets with WE disabled. Inspect transform, filter, contain and stacking ancestors, rather than raising z-index. |
| A plate survives sidebar collapse | Record sidebar mode, policy and reason; closing should revoke ownership and decorative leaves. |
| Glass does not restore after a skin leaves | Allow yield observation to settle; include versions, reproduction and diagnostics if it persists. |

#### Verification and Limits

`node test/verify-glass-runtime-browser.mjs` runs actual bundle CSS and runtime in isolated Chromium. It checks themes, narrow screens, hit testing, focus, fixed geometry, pixels, fallback and cleanup. Set `WE_TEST_BROWSER` to an executable when necessary. A missing browser fails rather than silently skipping. This regression is in `npm run verify`.

Host-structure fixtures do not replace testing each real third-party window, prove a native crash fix, or establish long-term stability. Untested platforms and independent-review status must be reported separately.

Further reading: [surface ownership](../adr/0015-glass-surface-ownership.md), [token ledger](../TOKEN-CONTRACT.md), [troubleshooting](../TROUBLESHOOTING.md).

#### Disabling the glass row: sidebars stay transparent, the rest returns native

Since `packages/glass` ([ADR-0016](../adr/0016-glass-subpackage.md)), glass is a **standalone plugin row** (`wallpaper-engine-glass`) that can be disabled on its own in the plugin manager:

- **Row enabled** (default): byte-for-byte the same look as previous versions — including better-sidebar colouring from `--dsw-alias-bg-layer-1` (the glass token mapping still applies).
- **Row disabled**: the glass stylesheet and behavior layer leave together, so no `data-we-glass-*` gates are written ⇒ every glass recipe stops applying and the host returns to its native theme. **The left/right sidebar bodies stay transparent (the wallpaper shows through)**; the left-sidebar glass switch still only means transparent ⇄ glass. better-sidebar / parallax / official pet integration are unaffected (they read the host's native token values — which is what the host shows with no glass anyway); the wallpaper-domain let-through rules (canvas base / host clearing) stay in the main package, so wallpapers keep working when the glass row is disabled.
- **Main row disabled**: the glass row parks with the service plane ([ADR-0014](../adr/0014-subpackage-contract.md) S7.2) and the whole family leaves together.

**Disabling / re-enabling the row while the host is running takes effect immediately, with no host restart**: a desktop host's row toggle does not reload an already-loaded page, so the glass bundle carries its own observation channel — it probes `GET <base>/glass-row-state` every 3 seconds (paused while the page is hidden, immediate on becoming visible), and **the route's existence = the row is enabled** (row disabled ⇒ the host prunes that row's fiber ⇒ 404). On a 404 the browser half removes its glass stylesheet, runs the behaviour layer's `disposeGlassLayer()` (every `data-we-glass-*` gate and `--we-*` variable unwound), stops rendering the settings section and empties the surface status projection; re-enabling restores everything as it was (stylesheet re-injected + `sync` re-run). So after a disable **the sidebar bodies stay transparent and the rest of the UI returns to the host's native look**. A single failed probe keeps the current state, so a network hiccup never flips the look.

### Client-side errors also leave a trace (`client-error`)

A failure that only happens in someone's browser leaves nothing behind on the host — so the client installs two listeners (`error` / `unhandledrejection`) and writes the exception's message and the **first three lines of its stack** into the same diagnostics channel (`[we-live …] client-error · …`, level `error`, unregistered with the fiber). The tag is `client-error`: when diagnosing, run `Select-String 'client-error' diag/http.jsonl` first — with the stack you can go straight to the line.

### Tests

`npm run verify` (client / transcode / playback control / scene / scene-live among others) plus
`npm run smoke` (rotation, live-frame backfill and identity, font-set loading, …); `npm run verify:all` =
build + both suites + the soft tier. **How many entries each chain has is not written here** — the source
of truth is the `MANIFEST` in `test/run-guards.mjs`; hard-coding a number makes it drift.
