# Changelog

> **中文**: [`../CHANGELOG.md`](../CHANGELOG.md)（与本文同源：改一处请同步另一处）

> This file used to be the English half inside `docs/CHANGELOG.md`. It is now a standalone page like
> every other bilingual document in `docs/en/` — same basename as its Chinese counterpart, with a
> language-switch link at the top (see [`README.md`](./README.md) §language layout).
>
> **Version numbers, issue numbers and performance figures live here**, not on the front page
> (`README.md` / `README.en.md` keep only version-independent highlights).
>
> **Current released version: `v1.2.0`** (matches `package.json`'s `version`).

### Unreleased (next version)

> Increment after **v1.2.0** (local, unreleased; per-commit):

- **The first module's defaults are now the maintainer's own tuned set** (user's words: "make the settings
  currently in the hardware monitor bars extension the default configuration" ⇒ clarified as "bake the
  values I have dialled in now into the defaults").
  **What**: ten keys in `DEFAULTS` of `lib/settings-schema.js` changed value — `metricsEnabled` now
  defaults to **on**, plus height / vertical offset / bar width / row gap / threshold / opacity / the
  black-band opacity / glow / outline width (the numbers live in that file and are not copied here). The
  key set and their order are unchanged (the one edit besides values is the kind of `metricsEnabled`:
  `boolFalse` ⇒ `boolTrue` — a kind encodes the "value when absent" (`boolFalse` is `v === true`, so an
  absent value lands on false), which means changing `DEFAULTS` alone would be sanitised back), every other
  `KINDS` range is untouched, and the other nineteen keys already matched
  the tuned set (horizontal offset 0 / bar gap 2 / thin white rules on / blend mode Auto / smoothness 60 /
  window 60 / solid bars on / series names on / three series on, network and disk off), so they stay put.
  **Why**: these ten are not factory guesses but the look that was dialled in by hand — baking them in means
  a fresh install or a reset lands on that look instead of re-dragging every slider; the master switch
  follows, because the bars are the whole point of that module.
  **Guards**: the "Extensions" block of `test/verify-client.mjs` now asserts "default on ⇒ the parameter
  controls are drawn straight away" (the other two modules stay default-off and keep their "off ⇒ no
  parameters" pin), the default slider read-outs are re-pinned to the baked values, and a new assertion
  covers "turning the master switch off collapses that whole parameter list"; in `test/verify-scene-live.mjs`
  the "off" half of the extension-island comparison now passes an **explicit** `metricsEnabled: false`
  (it used to hand `DEFAULTS` in as the "off" sample, which turned that comparison into a tautology the
  moment the default flipped — the guard caught itself first); the golden fixture was
  re-stamped to the new defaults (`.test-cache/regen-golden-metrics.mjs` gained a ten-key `RESTAMPED` list:
  the key set is unchanged and only values moved, so it re-stamps instead of adding slots — it reported
  `added 0 key slots across 18 cases`, with every other key acting as the zero-drift safety valve).
  **No new setting key** (count, order and ranges unchanged) ⇒ `docs/ROUTE-INDEX.md` and `lib/types/` stay
  untouched.

- **Optimised: the cost of the "3D depth" motion** (user feedback: the effect is good, but the motion
  costs too much).
  **What**: all of it lives in `src/parallax-layer.js` and the parallax section of `src/styles.js`, and
  **no new setting key** was added (so the golden fixture and `docs/ROUTE-INDEX.md` stay untouched).
  ① **Narrower variable scope**: the per-frame displacement step `--we-parallax-x / -y` moved from the
  body to **the layers that actually move** (`.we-layer` / `.we-rope` / `.we-metrics`, rescanned with
  `document.querySelectorAll` every 250ms, each record holding the step it last wrote so nothing is read
  back from the DOM), leaving only the five per-layer multipliers on the body (written once per settings
  change) — custom properties inherit, so writing the step on the body re-resolved styles for the whole
  document every frame. ② **Frame rate capped at 60Hz** (`PARALLAX_MIN_FRAME_MS` = 0.75 of a frame): the
  extra frames on a high-refresh display now only reschedule instead of writing variables, and the easing
  was always normalised to 60fps. ③ **"Arrived" is now judged by visible displacement**:
  `settle = max(PARALLAX_SETTLE_PX, remaining visible pixels / largest multiplier)` — 0.25px normally and
  1px once the cursor has been still for 180ms, which retires the last dozen frames of the tail in one go
  (under 1px of movement at the moment it snaps, so nothing shows). ④ **The viewport is read only on
  start and on resize** (no more asking `window` every frame). ⑤ **No frame at all when every multiplier
  is 0** (one placement and done). ⑥ **Compositor layers only while moving**: the loop adds
  `.we-parallax--moving` to those layers (the stylesheet gives it `will-change: translate` — translate
  only, so scale's raster scale is never frozen) and it is removed the moment the loop settles or the
  module stops — this repo deliberately keeps no always-on compositor layer (same reasoning as the
  two-frame nudge of `.we-layer--repaint`).
  **Why**: this layer lives entirely on the input path, so its cost is exactly three things — how wide
  each frame's style invalidation reaches, how many frames one gesture runs, and whether every frame has
  to repaint the full-screen wallpaper. Those six items cut one of the three apiece, and not a single
  pixel of the effect itself changed.
  **Checks**: the source-shaped check in `test/verify-scene-live.mjs` gains a ⑧ performance group (scoped
  writes / 60Hz cap / visible-displacement thresholds / zero-multiplier fast path / the compositor hint
  being added and dropped), plus a new **behavioural** check that builds a minimal fake DOM
  (`querySelectorAll` returning three fake elements, a fake rAF driven by hand) and really runs frames,
  asserting that the step lands on those elements only, that the body carries just the five multipliers,
  that the compositor hint class is present while moving and gone once settled, and that a stop cleans up
  both sides; the `src/styles.js` check gains
  `body[data-we-parallax="on"] .we-parallax--moving { will-change: translate; }`.
- **Added: a third Extensions module, "3D depth" — parallax that follows the cursor**.
  **What**: five new setting keys (`lib/settings-schema.js`, DEFAULTS + KINDS) — `parallaxEnabled`
  (`boolFalse`, off by default), `parallaxBg` (`num 0..10`, default `1`, wallpaper and mascot),
  `parallaxMetrics` (`num 0..20`, default `1`, the bars layer), `parallaxMascot` (`boolTrue`) and
  `parallaxSmooth` (`num 0..98`, default `85`). Two new files: behaviour layer `src/parallax-layer.js`
  (a base module: zero `ctx`, reads `selection` only) and descriptor `src/ext-parallax.js` (a five-row
  island); `src/panel-tabs.js` gains a third registry entry; `src/client.js` gains five named handlers,
  the `extensionCtx()` entries and `subscribe(syncParallaxLayer)` / `disposeParallaxLayer()`;
  `src/styles.js` gains a "third Extensions module: 3D depth (parallax)" section; `src/i18n-copy.js`
  registers 12 keys; the build table gains both modules.
  **It builds no DOM node at all**: it only listens passively to `pointermove` on `document` and `resize`
  on `window`, turning the cursor's offset from the screen center into seven CSS variables plus a
  `data-we-parallax` switch attribute on the body, and the stylesheet multiplies everything with `calc()`
  — `.we-layer` translates by `--we-parallax-bg` and scales by `calc(1 + var / 100)`, `.we-rope` by
  `--we-parallax-mascot`, `.we-metrics` by `--we-parallax-metrics`, and `.we-metrics--labels` /
  `.we-metrics--guides` take the bars value plus 1% / 2%. One unit: for a cursor offset `u` from the
  screen center the target displacement is `PARALLAX_DIRECTION × u × percentage / 100` (crossing the whole
  longest diagonal moves that layer by its own percentage of that diagonal — exactly the user's
  definition); `PARALLAX_DIRECTION = -1` means **mirrored about the screen center** (opposite the cursor);
  the easing is an exponential approach per frame (`parallaxSmooth`, `0` = instant) and the loop stops once
  the target is reached (zero frames while idle; only `parallaxKick()` schedules one).
  **Why**: the user's request — "add an extension: 3D effect: as the cursor moves, the components and the
  wallpaper background ease along the direction symmetric about the center… the background travel defaults
  to 1% of the longest diagonal, and [hardware monitor bars] also supports a custom travel (chart component
  only, its other components add 1% each on top of that value)… click & trail effects must not shift… make
  the mascot widget take part too, if possible". Three trade-offs: ① the displacement uses the **CSS
  independent properties `translate` / `scale`** rather than `transform` — the wallpaper transition's
  `resetLayerSwitchStyles()` writes and clears an inline `transform`, and only the independent properties
  compose with it instead of overwriting each other; ② the wallpaper must be **scaled up** by
  `1 + pct / 100` (max horizontal displacement = pct × viewport width / 2, so without the up-scale the base
  color shows at the edges); ③ the **click & trail layer deliberately does not take part** (the user's third
  point), nor does the drawer / quick panel / settings panel (they sit under the pointer, so moving them
  would ruin aiming).
  **Checks**: `test/verify-scene-live.mjs` gained two registration checks (each new module appears once in
  `INLINE_MODULES` and once in the bundle), a single-file import of `src/parallax-layer.js` with three
  `syncParallaxLayer()` states (on / out-of-range values / off) plus `disposeParallaxLayer()` — **no rAF in
  the environment, zero throws, zero DOM side effects** — a source-contract check (the direction constant
  and both formula lines, the `typeof document` guard in `parallaxBody()`, the `requestAnimationFrame` early
  return, `LABEL_STEP` / `GUIDE_STEP`, both passive listeners, plus **negative** assertions that it builds no
  DOM and never touches `we-fx`) and a styles-section check (the five `body[data-we-parallax="on"]` rules, the
  `translate` / `scale` `calc()`, plus **negative** assertions that this section contains no `transform:` and
  no `.we-fx`), and the third module's island check (order-sensitive: off ⇒ only the master switch row, on ⇒
  the four parameter rows); `test/verify-client.mjs` gained the island behaviour assertions (three module
  cards, master switch off by default, the four row labels and slider ranges 0..10, 0..20, 0..98, the default
  readouts `1%`, `1%`, `85%`, the mascot switch on by default, and a negative assertion that no other module's
  controls leak in).
  **Fixtures**: five new setting keys ⇒ `test/fixtures/settings-sanitize-golden.json` re-recorded by
  "behaviour at introduction" (`added 165 key slots across 18 cases`); `docs/ROUTE-INDEX.md` untouched
  (pure client side, no new route).
- **Fix: Auto blend on an almost black background now uses Lighten with the bars' opacity cut down (the factor is customizable)**.
  **What**: the Auto stop in `src/metrics-layer.js` goes from two tiers to three — new
  `METRICS_BLEND_NIGHT = 'lighten'` / `METRICS_LUMA_DEEP = 0.15`; the
  **first** line of `metricsBlendForLuma` tests for almost black (actually-shown luma < `METRICS_LUMA_DEEP`)
  ⇒ that band takes Lighten, and the **bars layer** (`band.host.style.opacity`) has its opacity multiplied by
  a customizable factor (the user's "opacity -50%"). Each entry of the per-band plan is therefore `{ mode, dim }`
  instead of a bare string, and `dim` comes **only** from that almost-black rule — a hand-picked Lighten carries
  no `dim` (the user's own choice is not cut, so the flag cannot be derived from `mode === 'lighten'`); the
  fallback used when the wallpaper cannot be sampled is the new `metricsBlendFallback()` (never cut); the
  **label layer and the rules layer keep the plain opacity** (they always blend `normal`, so cutting them would
  only turn white text and lines grey). The island's Blend mode hint and both word lists follow.
  The factor itself is a **setting key**: the user then asked "the opacity -50% just mentioned should also be
  customizable", so the hard-coded `METRICS_DEEP_ALPHA = 0.5` became the new key `metricsDeepOpacity`
  (`50` by default, range `10..100`, `kind: 'num'`), read in the frame as
  `const deepAlpha = metricsClamp(selection.metricsDeepOpacity, 10, 100, 50) / 100;`. The key states the
  **result** (how much opacity the bars layer keeps on an almost black background) rather than "how much to
  subtract" — `100` naturally means "turn this almost-black rule off", so no extra switch is needed; the island
  row is called **"Bar opacity on black"** and appears **only while Blend mode is Auto** (no other stop can ever
  pick the almost-black rule, so showing it there would lie — the same reason the five colour pickers only show
  up in "Distinct hues").
  **Why**: the user's report — "fix [hardware monitor bars]: for an almost black background, Auto should use
  Lighten + bars opacity -50%". On pure black `multiply` is ×0 (it wipes the bars out) and `overlay` barely
  lifts them; only `lighten` (per-channel max) lets a bar show its **own colour** — but a full-strength Lighten
  glows into a mush, one smeared band, hence the opacity cut (50% by default, adjustable). The threshold `0.15` is a look-and-feel value and
  must stay **far below** `METRICS_LUMA_SPLIT` (`0.5`), otherwise it swallows the dark tier.
  **Checks**: the `metrics-layer.js` source-contract check in `test/verify-scene-live.mjs` grew 8 assertions (the
  two constants, the first-line test, `metricsBlendFallback`, the hand-picked `{ mode: manual, dim: false }`, the
  `deepAlpha` line that reads the setting key and the `entry.dim ? deepOpacity : opacity` write); the Extensions
  block of `test/verify-client.mjs` checks the new slider's range (10..100), its default read-out (`50%`) and that
  it shows up **only on Auto** (switching to another stop hides it, switching back brings it back). **One new
  setting key** ⇒ the golden fixture was recorded as it behaves on introduction (`added 33 key slots across 18
  cases`); `docs/ROUTE-INDEX.md` stays untouched (client-only, no new route).

- **New: the second Extensions module — click & trail effects**.
  **What**: ① two new files: the island `src/ext-fx.js` (one master switch plus a sub-switch each for clicks
  and the trail, with their own style, size, glow, duration, width, opacity, blend mode and colours — either
  sub-switch alone is enough, and turning one off folds its own group of controls away) and the canvas layer
  `src/fx-layer.js` (a body-level `.we-fx` canvas at `z-index: -1` that only listens **passively** to
  `pointermove` / `pointerdown` on `document` — the host is `pointer-events: none`, so it captures no input;
  clicks whose target is one of the plugin's own controls are dropped, so clicking a button never also bursts
  a ripple). ② Clicks draw two spreading rings (the second starting 18% of the lifetime later), a cluster of
  **unequal** flying dots plus one white flash, or both; the trail is either a round-capped band that tapers
  segment by segment or dots left behind at a fixed step — both fade by age and are dropped once spent, so a
  resting pointer still fades out. ③ The frame loop is **content-driven**: `fxStart()` returns immediately when
  there is no `requestAnimationFrame` (hence zero DOM side effects in the test sandbox), it only keeps
  scheduling while something is alive and stops itself once the canvas is empty (zero frames while idle); right
  after the loop's only early return it calls the idempotent `fxEnsureHost()`, so the deadlock the bars layer
  once shipped (treating "host not created yet" as a reason to return) cannot come back. ④ Opacity and the
  **blend mode** are written on the **host element** (on the canvas they would only blend against the host's
  own stacking context) and the layer composites with `lighter` inside; the colour follows the theme accent /
  rainbow (a hue per instance that also drifts over time) / custom. ⑤ Stacking comes from document order: the
  layer sits above the wallpaper and below the scrim and the bars, re-checked every frame with
  `compareDocumentPosition`. ⑥ 14 new `fx*` setting keys (`lib/settings-schema.js`: DEFAULTS + KINDS + four
  value tables; the master switch defaults to **off**), and the swatch picker only appears in the Custom mode.
  **Why**: the user asked to start the next extension — "click effects and trail effects", explicitly as an
  example, free to design. The layer deliberately **never samples wallpaper pixels** (hence no Auto mode) and
  leaves blending to the default Screen or a hand-picked mode; every other choice aims at looks first (two
  rings instead of one, unequal dots instead of equal, age-based removal instead of smearing).
  **Tests**: the Extensions block in verify-client pins two module cards, no parameter labels while the master
  switch is off, then 34 labels / ten slider bounds / the `140px` · `420ms` · `85%` readouts / five blend-mode
  options / a swatch picker that only appears in Custom mode and defaults to `#4f8cff` / each sub-switch
  folding away its own group; verify-scene-live pins that each new file appears exactly once in the bundle,
  that `fx-layer.js` imports standalone with **no throws and no side effects without rAF** (its export set is
  exactly `disposeFxLayer,syncFxLayer`), the source form (`FX_HOST_ID`, the content-driven loop, the
  `fxEnsureHost()` right after `if (!fxOn || !st.on) return;`, both `insertBefore` stacking paths,
  `mix-blend-mode` and `opacity` on the host, `globalCompositeOperation = 'lighter'`,
  `target.closest(FX_UI_SELECTOR)`, `{ passive: true }`) and the island's 12 parameters in order with the
  swatch picker only in Custom mode. Docs (README / HOW-IT-WORKS / this file) are mirrored between the two
  languages; `docs/ROUTE-INDEX.md` is untouched (client-only, no new route); the i18n dictionary and the golden
  fixture pick up the new keys.

- **Fix: Auto blend mode now reads the brightness actually on screen, the three host families stay above the
  scrim, and the rules layer sizes its own canvas**.
  **What**: ① Auto no longer judges by the wallpaper's **raw image** brightness — `drawImage` returns source
  pixels, which neither see the CSS filters this plugin issues nor the darkening layer stacked on top of the
  wallpaper, so a bright wallpaper dimmed to mid grey still counted as bright and took multiply (bars = bar
  colour × dark backdrop, i.e. lost in the background). The plugin's own effects are now undone first
  (`metricsDisplayLuma`: the `brightness()` factor, `contrast()` stretched around 0.5, the fade colour and the
  leaf opacity of a translucent wallpaper, then the `scrim` darkening — every step clamped to the schema
  ranges), those four keys plus the fade colour feed a signature (`metricsDisplaySig`) so dragging a setting
  recomputes the displayed brightness immediately instead of waiting for the sampling cache, and the sampled
  raw values are kept as `metricsLumaRaw` while everything downstream sees the displayed one. ② The three host
  families (bars / labels / rules) and the darkening layer `.we-scrim` are all `z-index: -1` body-level
  overlays, so their stacking comes from document order — and the scrim is only appended **when a wallpaper
  becomes active**, so a layer that starts earlier (extensions on at boot, wallpaper applied later) ended up
  covered by it; the layer now checks document order every frame and moves the three families back above the
  scrim in their original order (`metricsRaiseAboveScrim`). ③ The rules layer **never sized its canvas**: the
  band canvases and the label layer both called `metricsSizeCanvas`, the rules one did not, so its bitmap
  stayed at the HTML default 300×150, stretched by the CSS `width/height: 100%` — with a block narrower than
  300 only the left part of each rule was drawn, taller than 150 the lower rules were cut off and everything
  was stretched vertically (the user's report: the white rules did not show fully). Both layers now size their
  canvas whenever the geometry changes and clear their own repaint signature.
  **Why**: the user's report — ① the bars are hard to make out because on bright backgrounds multiply is
  applied and then the background plugin's own darkening dims them further; the suggestion was to read the
  values this plugin has configured, compute the area's actual displayed brightness from them, and pick the
  mode from that; ② the white rules did not show fully.
  **Tests**: the canvas-layer source assertions in verify-scene-live now cover `metricsDisplayLuma` /
  `metricsFadeBaseLuma` / `metricsDisplaySig` / the four `selection.*` keys that go into the reversal /
  `metricsRaiseAboveScrim` and its per-frame call / the "clear my signature when sizing succeeds" shape of
  both layers (asserting that a line was painted cannot catch a missing size call). **No new setting keys**, so
  the i18n table and the golden fixture are untouched; the `METRICS_BLEND_VALUES` comment in
  `lib/settings-schema.js` now says the decision uses the displayed brightness. Chinese and English docs
  (README / HOW-IT-WORKS / this file) kept in sync.

- **Fix + new: the row labels get their own layer with their ink clamped to 20%–80% lightness, and Auto
  blend mode now switches per band of wallpaper brightness**.
  **What**: ① the series names move **out of** the blending bars layer into a third host layer
  (`#we-metrics-labels`) that always blends `normal` — the previous version kept the labels in the bars'
  layer, where `multiply` crushed a near-white theme colour into near-invisibility (the user's report: the
  labels had become hard to make out, likely because they are white and multiply wiped them); the colour is
  still the Appearance one but passes through `metricsClampInk()`, which clamps the HSL **lightness** into
  20%–80% (`METRICS_INK_MIN` / `METRICS_INK_MAX`) — pure white lands on 80%, pure black on 20%, and the text
  reads on both bright and dark wallpapers; ② Auto no longer takes one average brightness for the whole
  block: it is cut horizontally into at most `METRICS_BAND_MAX` bands (**one host per band, each carrying its
  own stop**), each band samples the wallpaper brightness behind its own bars and picks multiply for bright
  areas and overlay for dark ones — CSS `mix-blend-mode` is element-level, so per-pixel switching is
  impossible and bands are the approximation; the cuts always fall in the middle of a bar gap
  (`metricsBands`), so no bar is ever sliced in half; a band that cannot be sampled (iframe, cross-origin,
  no video frame yet) still falls back to the last hand-picked mode; the probe changed from a 24 × 24 square
  to a single row of `bands × 1` pixels, its cache key carries the band count and the block's horizontal
  position/width share, and the band count is **decided by geometry alone** (manual mode is always one band,
  so the DOM is never rebuilt per frame).
  **Why**: the user asked ① to clamp the label colour's lightness to 20%–80% while still letting the plugin
  control it, and ② whether it could be smarter and detect regions whose background brightness is above or
  below 50%, using multiply on bright areas and overlay on dark ones.
  **Guards**: verify-scene-live's bundle check went from "two independent paint paths" to **three** (bars /
  labels / rules exactly once each — collapsing them back would mean the three layers stuck together again
  and the decoupling is gone), and its canvas-source assertions gained `METRICS_LABEL_HOST_ID` /
  `METRICS_BAND_MAX` / `METRICS_INK_MIN` / `METRICS_INK_MAX` / `metricsClampInk` / `metricsBlendPlan` /
  `metricsBands` / `metricsSyncHosts` / `metricsPaintLabels` / the per-band blend write
  (`metricsNodeStyle(band.host, 'mix-blend-mode', mode)`) / the gradient using the clamped ink.
  **No new setting keys** ⇒ neither the copy table nor the golden fixture changes. Chinese and English docs
  (README / HOW-IT-WORKS / this file) are in sync.

- **New: the resource bars can set their layer blend mode (including an automatic mode that reads the
  wallpaper's brightness), a thin-white-rule scale, and a custom colour per series**.
  **What**: ① a new setting key `metricsBlend` (an enum, default `auto`) decides how the bars fuse with the
  wallpaper — the manual stops are CSS `mix-blend-mode` (normal / multiply / overlay / screen / soft-light /
  darken / lighten), while **Auto** samples the wallpaper image and picks multiply when the sampled average
  is bright and overlay when it is dark; when the image cannot be sampled (Web and Scene wallpapers are
  iframes, the video has no frame yet, a cross-origin canvas is tainted) it **falls back to the last mode
  picked by hand** instead of something arbitrary, and the sample is cached with a TTL so pixels are not
  read every frame; ② a new setting key `metricsGuides` (thin white rules, default on) draws a 1px white
  line across the whole block at **each row's 50% height** and **between every two rows** (a constant 35%
  opacity), turning the bars into a readable scale; ③ the canvas layer now mounts **two host layers** —
  bars and row labels in one (the blend mode and opacity are written on that one) and the white rules in
  **their own** (blending stays `normal`: in the bars' layer multiply would wipe the lines out); the rules'
  repaint signature **excludes the data timestamp**, so the per-second bar frames never redraw them, and
  the two layers' visibility and blending stay independent — exactly the seam the upcoming cursor-driven
  3D depth effect needs; ④ the "Distinct hues" mode no longer uses built-in fixed hues: five new setting
  keys `metricsColorCpu` / `metricsColorMem` / `metricsColorGpu` / `metricsColorNet` / `metricsColorDisk`
  (type `hex`, defaulting to the old factory hues, so anyone who never touched a colour sees the same
  picture) take over, and the panel only grows the five colour pickers in that mode (preset dots plus a
  custom colour wheel whose drag writes live and whose release persists).
  **Why**: the user asked ① whether the layer blend mode of this overlay could be changed ("multiply on a
  bright background, overlay on a dark one"), ② to "add thin white lines, one at each bar chart's 50%
  height and one between every two bars", ③ to "keep the labels/bars and the white lines decoupled,
  because the next extension I plan is a cursor-driven 3D depth effect", ④ to "allow custom bar colours".
  **Judgements**: verify-client's Extensions block gains nine labels (thin white rules / blend mode / the
  seven blend stop names), pins the rules switch as on by default and the blend control as a **dropdown**
  (eight stops laid out flat would be crushed by the equal-width `.we-picker__seg`) defaulting to `auto`,
  with stops checked verbatim against `METRICS_BLEND_VALUES` (values and option count together), and adds a
  behaviour round: no colour input in the accent stop → after clicking "Distinct hues" exactly five colour
  rows whose defaults are the series' factory hues → switching back removes them again; the
  verify-scene-live island judgement now expects **17 parameters + 5 series switches**, plus a new check
  using a recording stub (this host's `swatchRow` is a noop) to pin "called exactly five times, only in the
  spectrum stop, each time with that series' factory hue", and the canvas source assertions add both host
  ids, the rule opacity, the two Auto stops, `metricsResolveBlend`, `metricsSampleLuma`,
  `metricsSeriesColor`, `metricsPaintBars` and `metricsPaintGuides`; the settings-sanitization golden
  fixture takes the seven new keys under "behaviour at introduction" (script
  `.test-cache/regen-golden-metrics.mjs`, safety valve = zero drift on every other host-side key).
  Chinese and English copy (README / HOW-IT-WORKS / this file) updated together.

- **Changed: the resource bars are labelled in English, the label fades vertically, and the whole block
  can be offset left/right and up/down**.
  **What**: ① the line drawn over each row is no longer the translated metric name but a **fixed English
  short tag** — CPU / RAM / GPU / NET / DISK (the canvas layer's `METRICS_SERIES[].tag`, a plain ASCII
  constant that **never enters the vocabulary**; the panel switches still use the translated names, so the
  two now own one place each); ② that line goes from "30% opacity all over" to a **vertical linear
  gradient**: 30% at the top of the glyphs and fully transparent at the bottom, with the gradient span
  taken from the text's own line box (not the whole row band, so the fade looks the same however tall the
  rows are); ③ two new sign-capable setting keys `metricsOffsetX` / `metricsOffsetY` move **the whole
  block** away from the centered position (positive = right / up), and dragging it off screen clamps it
  back inside the margins — an offset is a nudge, it should not be able to lose the decoration.
  **Why**: the user asked for labels that read as part of the graphic (English tags that the UI language
  cannot rewrite), for text that is "default colour at the top and transparent at the bottom, evenly
  graded", and to "allow setting its position (left/right, up/down offset)".
  **Judgements**: verify-client's Extensions block gains the `水平偏移` / `垂直偏移` labels, their slider
  maximum `400` and **minimum `-400`** (with a new `sliderMin` helper: for a sign-capable slider a
  max-only assertion cannot see "the negative half was dropped"), plus `0px` readouts for both; the
  verify-scene-live island judgement now expects **15 parameters + 5 series switches**, and the canvas
  source assertions add the offset constant (`METRICS_OFFSET_MAX`), `rows[ri].def.tag`,
  `createLinearGradient` and "bottom stop fully transparent"; the settings-sanitization golden fixture
  takes the two new keys under "behaviour at introduction" (script
  `.test-cache/regen-golden-metrics.mjs`, safety valve = zero drift on every other host-side key).
  Chinese and English copy (README / HOW-IT-WORKS / this file) updated together.

- **Changed: the resource bars are centered with a margin on all four sides; new "bar gap" and
  "series names" knobs; sliders now show their value on the right**.
  **What**: ① the bars no longer hug the bottom-right corner — the whole block is **centered
  horizontally** in the lower part of the screen with a fixed margin on every side (its height is also
  clamped against the viewport, so a short window cannot push it off the edge); ② a new setting key
  `metricsBarGap` controls **the gap between neighbouring bars in the same row**, so bar width, bar gap
  and row gap each own one dimension; ③ a new setting key `metricsLabels` (series names, on by default)
  draws each row's name **centered in that row** in the font set under Appearance — bold, in
  Appearance's text color, at **30% opacity**, as tall as the row (if the row is too short or no text
  color is available nothing is drawn: it is decoration, and no label beats a noisy one); ④ the last
  cell of `SliderRow` no longer prints just the unit but **echoes the current value plus unit**, rewritten
  in place while dragging (this applies to the whole settings panel, not only the bar module).
  **Why**: the user's framing is "this is a wallpaper plugin, so looks come first" — hugging the edge
  looks cheap, bars fused into a block hide how many slots there are, and a slider with no readout forces
  guessing; the name overlay answers "which row is which metric", and 30% opacity is the trade-off that
  keeps the bars readable through it.
  **Judgements**: verify-client's Extensions block gains the `柱间距` / `序列名称` labels, the bar-gap
  slider maximum, and **value-readout** assertions (height `120px`, bar gap `2px`, threshold `80%`, time
  window `60s`, read from the `we-picker__value` cell), plus SliderRow shape assertions that the third
  cell is `readout` (not a bare `suffix`) and that dragging rewrites it in place; verify-scene-live's
  extension-island judgement now reads **13 params + 5 series switches** and adds a canvas-layer source
  assertion (centering/margin constants, the bar gap folded into the pitch, the row-label painter); the
  settings-sanitize golden fixture records the two new keys by "behaviour at introduction"
  (`.test-cache/regen-golden-metrics.mjs`, safety valve = zero drift for every other host key). Chinese
  and English copy (README / HOW-IT-WORKS / this file) kept in sync.

- **New: the first Extensions module — hardware monitor bars (live resource bars in the bottom-right
  corner of the screen)**. **What**: the Extensions tab now renders one module card whose controls
  (enable, height, bar width, row gap, threshold, opacity, outline width, glow, smoothing, time window,
  solid bars, colors, and which of the five series are shown) all live inside it — glow bars that
  **step** along the bottom-right of the screen, **one row per series** (CPU / memory / GPU / network /
  disk stacked top to bottom, with an adjustable gap), **bars only**: no ticks, no headers, no axes.
  Bar width sets how wide one slot is and the time window sets how many slots fit, so "length" and
  "width" are two independent knobs; any bar **above the threshold** (a share of that metric's full
  scale; 0 turns it off) turns red. The values are the machine's current resources:
  **CPU** (`os.cpus()` time delta) and **memory** (`os.freemem()`) need no subprocess at all, while
  **GPU / network / disk** share one resident `typeperf -si 1` (`GPU Engine(*engtype_3D)` /
  `Network Interface(*)` / `PhysicalDisk(_Total)`) that starts lazily, **only on Windows**, stops
  itself after 30 s without a client, and drops out as a whole if it fails (a metric the host cannot
  read is simply not drawn — never a fake bar). The bars sit above the wallpaper layer (canvas
  after the wallpaper and the glass scrim, with a negative `z-index` and `pointer-events: none`, the
  block right-aligned and sized by its slot count), and their colors follow the Appearance accent by
  default. **Why**: this is the **first** case of "later features are added as modules under the
  Extensions tab", and it walks the whole add-a-module path (descriptor in its own file, every action
  through a named handler, the source of truth still `lib/settings-schema.js`); bars rather than a line
  chart is the user's call — one slot per second reads better and removes the continuous animation
  (so no "reduced motion" fallback is needed). **Judgements**: verify-client's Extensions block asserts
  the anchor texts (section label / module name / switch), that the `we-ext` container is really in the
  tree, that the appearance controls are **absent** while the switch is off (pinning the default), that
  all 18 controls appear once it is on, that slider maxima match KINDS (height / bar width / row gap /
  threshold / window / outline width), and that it resets afterwards; the settings-sanitize golden
  fixture gains the 17 `metrics*` keys by "behaviour at introduction" (three of them new with the bar
  rework; `.test-cache/regen-golden-metrics.mjs`, safety valve = zero drift on every other host key);
  the route index is recomputed (`lib/routes/metrics.js` is a new route). All
  four new modules (`lib/metrics.js` / `lib/routes/metrics.js` / `src/ext-metrics.js` /
  `src/metrics-layer.js`) gained **real judgements** instead of an entry in the zero-coverage exception
  table of `docs/GUARD-MAP.md` (that table may only shrink): verify-scene-live now imports both
  browser-side modules directly and really renders the extension island once, plus one behavioural
  judgement for the sampler and one for that read-only route.
  Chinese and English copy (README / HOW-IT-WORKS / this file) are in sync.
  **Also**: the registry went from a top-level constant to the **lazy** `extensionModules()` — a
  top-level reference to a sibling module's symbol made verify-scene-live's standalone
  `import src/panel-tabs.js` throw a ReferenceError (the first version was caught by exactly that
  judgement), and the lazy form both imports on its own and no longer depends on injection order.

- **New: a sixth tab, "Extensions" — the module container for later features (placed before "About")**.
  **What**: the settings page goes from five tabs to six; the new **Extensions** tab is nothing but a
  registry, `extensionModules()` (`src/panel-tabs.js`, shape `{ id, title, desc?, render? }`; it began
  as the top-level constant `EXTENSION_MODULES` and became a lazy function together with the first
  module, see the entry above) — every
  module listed there renders one card, and an empty registry renders an empty state (section label +
  title + one line). **Why**: until now every new feature had to touch the tab bar, the
  `renderActiveTab` dispatch and a whole string of judgements and copy that hard-coded "five tabs";
  with this page a later feature **only adds one entry to the registry** — the tab, the tab bar and the
  pill indicator stay untouched. **Why before "About"**: credits stay last (「关于」/ About is still the
  final tab), so **Extensions** takes slot 5. **Judgements**: verify-client's tab count / label
  sequence / pill width 5→6 (About is still checked as `tabs[5]`), plus a new behaviour assertion for
  the Extensions tab (section label + empty-state copy + the `we-ext` container really being in the
  tree + exactly one tab active + no other tab's controls leaking in); verify-scene-live's `TAB_FNS`
  picks up `renderExtensionsTab`; the build markers pick up the same function. Chinese and English copy
  (README / HOW-IT-WORKS / this file) updated together.

- **Fix (issue #129): the scene payload origin is unreachable for any non-local client, and that
  failure then blacklists the host too.** 1.2.0 switched the scene payload origin to the host's
  dedicated loopback media server (`inventory.sceneMediaBase`, `http://127.0.0.1:<port>`) — for any
  client **not running on that machine** (remote desktop / proxied devices) `127.0.0.1` points at the
  client itself, so the `scene.pkg` fetch always fails; the renderer's diagnostic beacon targets the
  same origin, closing the only investigation window; and failure attribution reads the host ledger,
  which is **cumulative across instances** (`completed > 0` is permanently true), so the failure is
  mis-attributed to the render side and written into the **failure memory shared by every window** —
  the local machine then sits on the static poster too. Three fixes: **① `mediaBase` follows page
  reachability** (`resolveSceneMediaBase`: fall back to the page's own origin when the page itself
  runs on a non-local http(s) origin — the 1.1.0 behaviour; local pages / in-shell custom schemes
  keep the media server); **② render-side attribution now requires in-watch full-transfer evidence**
  (ledger never saw the token, or `completed`/`served` did not grow by a full package during this
  watch ⇒ transfer-class soft failure, not persisted); **③ `stall` (no frames while running) is also
  demoted to a session-soft failure** (an unfocused/occluded window's "no frames" is not evidence
  that the wallpaper cannot render) — session memory + 45 s auto-retry, same as transfer. Also
  vendored the missing `default-wallpaper/index.html` fallback page (the renderer's visible landing
  spot when scene parsing fails; upstream ships it under public/, sync-webwallgl now copies it).
  Guards: verify-scene-live rewrote/added 6 checks (mediaBase decision expression, three-state
  ledger reads, in-watch evidence, stall soft failure, retry accepts any soft failure, fallback page
  vendored + sync script + cache header).
- **Fix (issue #131): with "left sidebar override" enabled, the collapse/expand sidebar buttons
  shift down and the collapsed-state expand button becomes invisible.** Root cause is the CSS
  **containing-block** rule: a non-none `backdrop-filter` makes the element the containing block for
  its `position:fixed` descendants. In Windows title-bar mode the host puts the collapse/expand
  sidebar button and the collapsed-state "new session" button at `position:fixed` ⇒ they switch from
  viewport-relative to column-relative: the column's top is pushed down by
  `[data-windows-titlebar]`'s `padding-top` (every button drops by one title-bar height), and while
  collapsed the column's grid track is 0 wide with `overflow:hidden` ⇒ the button is clipped away
  entirely (expand button invisible). Fix: move **only the `backdrop-filter` pair** of the glass
  recipe onto the column's `::before` (a pseudo-element has no descendants, so it can never become
  anyone's containing block); the column itself takes `position:relative` + `z-index:0` (keeping the
  pseudo-element's `z-index:-1` inside the column); the software-rasterizer fallback explicitly
  disables the `::before` blur too. Base colour / sheen / border / token mappings stay on the column,
  so the glass and text layering is unchanged. Guards: verify-glass-compositing S2c (three
  declaration shapes + a "put the blur back on the column and it goes red" negative control) and
  S2c2 (fallback coverage), plus a real-browser probe (after the fix the fixed button sits at
  viewport top=20 and still hit-tests while collapsed; the pre-fix replica lands at column-top+20
  and is clipped away).
- **Fix (issue #127): text painted the same colour as its background (yellow-on-yellow /
  white-on-yellow).** Both root causes live in the accent remap: **① the shell's primary-control
  contract pairs a fill with `label-primary-foreground` as theme-inverted inks**
  (dsh-client-ui-primitives/Button.module.css); once we remap the fill to a user accent of **any
  luminance**, the theme's static ink is no longer guaranteed readable (light accent × light-theme
  ink ≈ 1.5:1) — new `--we-accent-ink` (effects.js picks black/white by WCAG relative luminance),
  wired into `--dsw-alias-label-primary-foreground` by the whole-dialog remap, hover now mixes
  toward the ink instead of white; our own `.we-picker__btn--primary` / `.we-picker__tab--active`
  switched to the ink too. **② The accent namespace leaked**: a third-party settings section that
  reads `var(--we-accent)` as a text colour (no fallback) lands on a fill we remapped to the same
  accent — pixel-identical colours (measured: 8250 of 8250 pixels inside the button are the exact
  same #FFCF4D). The settings window now resets `--we-accent` to `initial` (a fallback-less var()
  falls back to the inherited colour = the surface's native look), while `.we-picker` re-aliases
  from the body-level `--we-accent-src`, so our own consumers are unchanged; `--we-accent-ink`
  doubles as the **supported pairing token** for third-party sections.
- **Glass coverage, batch two (folding issue #71's glass-patch.css)**: the remaining alias tokens
  that can paint opaque surfaces now join the same glass — `bg-overlay` (popovers),
  `bg-module-platform`, `bg-multi-select`, `button-floating-fill`, `button-ghost-active-fill`,
  `button-tool-bar-fill`, `interactive-bg-active`, `interactive-bg-hover-solid`,
  `markdown-citation`, `markdown-placeholder`. Layer weights follow that patch's role ladder, but
  every entry is wrapped in the readability floor (#82's recipe); semantic state colours and accent
  fills stay native per the patch's own notes; light and dark entries are shape-identical.
- **Troubleshooting**: new "Install failure: `generation peer validation failed`" section
  (issue #116/#117's root cause = DSH core < 0.2.0-rc.1, with a `dsh --version` self-check and a
  note that the desktop app's version number is not the core version).

- **Internal: guard coverage gaps closed + a comment audit + a derived "which guard owns which module" map**
  (**no user-visible behaviour change**; `lib/client.js` only lost comments and one piece of dead state). Three things:
  **① The field-write contract**: outside `client.js` there are 126 raw `selection.<field> = …` writes, while the
  registered ratchet could see only 11 — its scan surface judged extensions by **directory-entry name**
  (`filter(f => f.endsWith('.js'))`), so **the whole `src/font/` directory silently fell out**, and
  `lib/settings-schema.js` was never scanned at all. The surface is now **derived from `INLINE_MODULES`** (the source
  of truth), plus a coverage floor, negative controls and a regression probe; the 27 "module × field" pairs that are
  **neither persisted nor transient** now live in an **enumerable registry** (zero unknowns / no idling entries /
  every entry carries a written reason). Also removed the **dead state** `fontSetLoaded` (written, never read anywhere).
  **② Ten `src/` modules gained `export {}`** (`CODE-STRUCTURE.md` §5 rule 5: the export list *is* the guards'
  interface); the artifact is **byte-for-byte unchanged**; `verify-picker-model` therefore now **imports the source
  module directly** for behaviour assertions, cross-checks it against the artifact (**24 cases, two channels**), and
  carries a **self-contained mutation probe** proving the judgement has teeth.
  **③ Guard map**: new `test/tools/guard-targets.mjs` (derives the modules a guard touches **from its own code** — no
  maintained list) and the generated [`GUARD-MAP.md`](../GUARD-MAP.md) (guard → module and module → guard tables),
  with a soft-tier guard `test/verify-guard-map.mjs` (enumerable zero-coverage + byte-identical artifact + coverage
  floor). **After touching a module, look it up here to know which guards to run.**
  **Also fixed**: `scripts/build-client.mjs`'s clash extraction required column 0, so it missed modules that indent
  their top-level declarations ⇒ clashes went unreported (a runtime SyntaxError once flattened); export-block
  stripping missed the same shape. Both now use "indent == the file's minimum declaration indent".
  **Comment audit** (all 28 modules swept): only provenance pointing at **removed code / internal ledger ids** was
  dropped (13 issue numbers · 2 retired tiers · 1 deleted file · 14 phase markers), **numbers that drift were turned
  into symbols** (`"20s with no frame"` → `LIVE_STALL_TICKS`, etc.), and three comments contradicting the
  implementation were **corrected** (one had it *backwards*: the properties panel has long been an in-page drill-down
  while the comment still said "inline below the list"). Sourced measurements and "why it is this way" rationale are
  **kept per §writing-discipline 2** (of 23 broad-match history candidates only 3 were deletable).

- **Video wallpapers got their own channel — and "no picture means no reveal"**. Video used to run through the
  real-time pipeline designed for WebGL scenes (content gate / backing plate / heartbeat / payload / GPU frame
  capture, only part of which means anything for video). Measured consequences: ① the gate's video criterion was
  "a frame is already in hand" (`readyState ≥ 2`), while video wallpapers deliberately carry **no poster** (WE's
  `preview.gif` as a poster plays the preview first, then the real thing) ⇒ the whole switch (transition included)
  waited for the first decodable frame — longer for bigger sources and higher caps, degrading from seconds to tens
  of seconds; ② the gate **released on budget expiry**, so the "no picture yet" instant was painted straight to
  screen — a full block of **solid colour** (real-machine log: `gate-arm … budget` → `gate-open why=budget rs=0`
  → `loadeddata` 1–2 s later).
  Change: `src/video-layer.js` (the video channel: readiness criterion + reveal policy + transcode trigger) and
  `src/layer-core.js` (the switch core both channels share: layer retirement, inline transition styles, visibility
  re-push) were extracted out of the live pipeline, which now keeps a single delegation; the reveal now trusts
  **only the present frame** (poster **loaded** — the attribute existing does not count — or `readyState ≥ 2`), and
  budget expiry became a **stall criterion** (re-check every 1200 ms; reveal only if something is really on screen;
  after 15 s with no picture, **keep the old wallpaper** and log one warn — never paint the base colour); a
  transcode source swap only lands while the layer is still held by the gate, or right after the user changed the
  cap themselves (swapping `src` on an on-screen layer clears the current frame = solid colour). The fence check
  `CHANNEL_FILES × LIVE_ONLY` keeps the channel free of **any live-only symbol**, with an anti-vacuity floor (the
  listed symbols must still genuinely exist in the live module, or the fence degenerates into checking an empty list).

- **Root cause of the 0.5–2 s switch delay: the source's moov sits at the end of the file, and the player streams
  the whole file** (fixed by a faststart variant). Real-machine fetch forensics (the temporary instrumentation
  removed in this same change): the player's first `/media` request is `Range: bytes=0-`, and it then **reads the
  entire file** before reporting `loadedmetadata` — 764,688,296B/1761 ms · 501,752,315B/1250 ms ·
  155,604,213B/357 ms · 101,749,329B/324 ms (≈430 MB/s). These sources keep their moov **at the end of the file**
  (`moovStart≈EOF`) ⇒ metadata time ∝ file size, and the content gate held the old wallpaper that long
  (`held=1668/2860/3340 ms`, matching the file sizes); the very same iris2 (729 MB) needs only 149–233 ms on the
  "first wallpaper right after a page load" path. The same forensics also ruled out four candidates, each with
  readings: `document.hidden` was 0 throughout (not occlusion throttling) · Range answers 206 with a proper
  `Content-Range` (not a stripped Range) · the `load()/src=` call stacks were empty (the plugin is not restarting
  the element) · `loadedmetadata` medians are identical whether the previous wallpaper was a video or not (578 vs
  586 ms — not decoder contention).
  Change: for mp4/m4v/mov whose moov is not near the head (>1 MB) the host builds a one-off `ffmpeg -c copy
  -movflags +faststart` variant (**no re-encode**; measured 729 MB/0.92 s), cached by "source path + size + mtime"
  (`fs_*.mp4`, 8 GB LRU, mtime bumped on hit and written at most once per 5 minutes), and `/media` serves the
  variant the moment it exists ⇒ the player gets the moov in its first chunk, independent of file size
  (end-to-end measured: `Range: bytes=0-511` returns `ftyp@4 moov@36`, where the original had moov at
  764,643,145); **a token is pinned to one byte layout for the lifetime of a host run** (the original and the
  variant have different byte offsets — one playback must never switch files halfway); variants are warmed
  **serially**, rotation list first and then the rest of the library, under a 6 GB source-byte budget. On the
  client side, **pre-commit warm-up** was added: pointer-down / hovering a card warms it to metadata only
  (`preload=metadata`, **never `play()`**, single slot, 20 s TTL) and the click adopts that element ⇒ the demuxer
  is already in place the moment the layer is built (without introducing a second 4K decoder).
  Checks: `verify-scene-live`'s "byte layout pinned / copy-only remux (`-c copy -movflags +faststart`) / cache
  ceiling / mtime bump", plus the four ① checks (metadata only · no play · an adopted element is never re-assigned
  `src` · the trigger is the card identity marker `data-we-id`).

- **The frame-rate cap's criterion is back to "can the cap really drop frames", the tiers were trimmed, and a
  host-killing crash was fixed.**
  Background: the previous version treated "natively playable" as sufficient reason not to decimate — but "the
  container plays natively" and "the source frame rate is above the cap" are two different things: 4K120 H.264 is
  both natively playable and far above any cap ⇒ the cap became a **complete no-op on the very mp4 files in use**,
  leaving nothing but a panel string, when its entire purpose is to cut GPU decode load (Video Decode rises with
  frame rate and is the biggest block for wallpapers; the v1.1.0 section records ~60% → ~15% after 4K120→24 fps on
  a 4060).
  Change: the criterion is now `capNeedsTranscode()` — **decimate only when the source frame rate is above the cap
  (+1 frame tolerance)**, regardless of native playability; "natively playable" survives only as a cost guard for
  the case where the **source frame rate cannot be read** (never re-encode a whole file for an unknown frame rate);
  the "use the cached decimated version when building the layer" criterion dropped its native-playability condition
  too (otherwise the layer starts on the decimated file and is immediately reverted to the original — a wasted
  source swap); the panel string became " · source frame rate unknown — no decimation" (zh/en in sync). Tiers were
  trimmed to **unlimited / 60 / 30** (60 halves 120 fps sources, 30 halves 60/50 fps ones; 48 and 24 retired), and
  stored 48/24 values are **clamped back to the default 0 (unlimited)** by the enum domain — no migration code
  (measured `sanitizeFromSchema({fpsCap:24})` → 0).
  Crash: the new faststart helper is a **module-level** function, and its failure branch referenced `log`, which
  only exists inside `apply()` ⇒ a `ReferenceError` thrown inside the catch ⇒ that async task rejected with nobody
  handling it ⇒ Node 24 killed the host process on the **unhandled rejection** (crash log verbatim:
  `dsh: fatal load failure: ReferenceError: log is not defined at lib/index.js:1235`) ⇒ DSH restarted the host over
  and over and wallpapers never appeared (what the user saw: a solid-colour opening frame, then DSH crashing and
  restarting after a few switches). Fix: all logging goes through an injected `say` (optional, and a logging
  failure can never affect the flow), plus a catch-all `job.catch`.
  Checks: `verify-logging` gained **N8** (with `apply`'s body cut out, module-level source may not contain
  `log.<level>(`, with a failing control — a synthetic module-level `log.warn` goes red immediately);
  `verify-transcode-state`'s fixture became **natively playable mp4/avc1** (it used to say `hvc1`, i.e. it travelled
  the "non-native must transcode" path — the regression above was **invisible in the fixture**, which is one reason
  the previous version was not caught), and it gained a behavioural check "natively playable + 120 fps source +
  30 fps cap ⇒ still decimates"; a mutation test confirmed the check goes red (5 FAILs) when the old criterion is
  put back. `verify-scene-live`'s ② group was rewritten to the three-state criterion (above ⇒ transcode / not above
  ⇒ skip / unknown ⇒ native guard) with a negative control (writing "natively playable" back as a no-transcode
  condition is caught); after the tier retirement the fixture's 24/48 buttons and assertions all moved to 30/60.

- **Two temporary forensics hooks were removed**: the client `video-tl` timeline probe (it wrapped `load()`,
  defined an instance `src` accessor and installed 200 ms/3 s/15 s timers) and the host `media-req` fetch trace —
  they existed only to localise the two issues above and are now closed out; their readings live on as evidence in
  the checks and in the entries above.

- **Documentation slim-down: the living ledger retired, `wip/` emptied, the archive branch that moved to its own
  repository deleted, and three English mirrors dropped** (**50 → 41 files / 11,178 → 6,625 lines, −41%**; the
  directory rules were updated in [`docs/README.md`](../README.md)):
  · **The refactor ledger retired**: `docs/wip/OPEN-ITEMS.md` (277 lines, **71 ✅ against 1 ❌ / 1 pending**) moved
    wholesale into `docs/archive/wip/` under this repo's own lifecycle rule ("describes **unfinished** work…
    **on completion, move the whole thing into `docs/archive/`**"), with the status banner the policy requires.
    What was still alive moved to better homes: **behaviour gaps** (old layer kept while a request hangs / the
    first-paint base-colour window / bare iframes) → the new "**Known behaviour boundaries**" section of
    [`TROUBLESHOOTING.md`](../TROUBLESHOOTING.md); the **token-layer constraints (§9.1's `V1–V10`)** → enforced by
    guards (`verify-readability` / `verify-glass-compositing`), and `FONT-SYSTEM.md` now points at those guards.
    The machine half of §2's baseline and §7's trigger lines was already carried by the ratchets and
    `verify-route-families.mjs`. Its claim to be "the only living ledger / the status column is the only source of
    progress truth" had already lapsed: the row-by-row ledger guard went away with
    [`adr/0006`](../adr/0006-comment-discipline-as-written-convention.md), and `git grep` shows **zero** code or
    test references — anything worth watching becomes a guard; a ledger drifts, and drifting turns nothing red.
  · **`docs/wip/` retired**: the other two (`POST-REFACTOR-AUDIT.md`, whose P4 items have all been closed out, and
    `SIDEBAR-TABS-DESIGN.md`, shipped in v1.1.0 → v1.2.0) moved into `docs/archive/wip/` with status banners.
    `docs/` now has a single invariant: **evergreen + ADR + user-facing en + archive**.
  · **The static-frame archive branch deleted**: `docs/archive/static-frame/**` (15 files / 4,347 lines / ~370 KB) —
    the v1.1.0 section already recorded that this line, once migrated to
    [`YV3507/we-static-frame`](https://github.com/YV3507/we-static-frame), "will be removed by another contributor
    in the next update"; this executes that. The long tail belongs to git history.
  · **English maintainer mirrors dropped**: `docs/en/{CODE-STRUCTURE,DEV-GUIDE,FONT-SYSTEM}.md` (890 lines) — their
    reader is the maintainer, and bilanguage was double maintenance; user-facing `README` / `UPGRADING` /
    `HOW-IT-WORKS` / `TROUBLESHOOTING` / `CHANGELOG` stay paired (precedent: `en/UPGRADING.md` already said
    "CHANGELOG (Chinese only)").

- **Fixed a CI failure that was "green locally, dead in 0 s on push", and added the check that pins it down**:
  `verify.yml` had its `concurrency` at the **workflow** level with `${{ matrix.os }}` in the group — and
  `matrix` only exists in the **job** context ⇒ GitHub declares the whole workflow file invalid at startup:
  the run **fails in 0 s with `jobs=[]`**, and the page only says "This run likely failed because of a workflow
  file issue". **Observed shape**: in this very CI check, both `46a1d2a` and `7515c7f` pushes looked exactly like
  that (0 s / failure / no jobs), while earlier pushes completed normally in 50 s. It now hangs off the **job**,
  with unchanged semantics (a new push cancels the previous run **on the same platform**).
  Check: `test/verify-contracts.mjs` gained **⑤** — the region before `jobs:` may not contain `matrix` /
  `strategy` / `steps` / `needs` / `job` (with a negative control and an anti-vacuity floor requiring at least
  one workflow to really use `matrix.` after `jobs:`); `docs/DEV-GUIDE.md` §4.3 documents the pitfall.

- **Fixed the root cause of the "artifact differs across platforms" failure** (the second thing the ubuntu leg
  caught): `src/i18n-copy.js` had historically been committed **with CRLF** (every other committed file is
  stored LF) and **28 of its lines were `\r\r\n` (a doubled CR)**. The build only normalizes `\r\n → \n`, so a
  Windows checkout (`core.autocrlf=true` inflates the pair back to `\r\r\n`) leaves **one stray CR** behind,
  while a Linux checkout has a plain `\r\n` that gets normalized away ⇒ **the same source produces a different
  `lib/client.js` on each platform**: whichever bytes you commit, the other leg's "artifact matches source"
  step (`git diff --exit-code -- lib/client.js`) goes red — observed as ubuntu red / win32 green, and
  **invisible no matter how much you run locally**.
  Change: ① that file (doubled CRs included) is now normalized to **LF on disk**, matching every other file;
  ② `scripts/build-client.mjs` reads its inputs through `readNormalized()`, which **asserts no stray CR
  survives** and names the offending file, failing the build (better a local red than a platform-dependent
  artifact). The locally rebuilt artifact is now **byte-identical** to the committed one (CR = 0).

- **Fixed an unrunnable test that upstream v1.2.0 brought in**: `test/repro-sidebar-props.mjs` (the real-artifact
  repro harness for the sidebar "wallpaper properties" panel) hard-coded the repo root to the author's machine,
  `/Users/oneincase/Documents/workspace/dsh-wallpaper-engine` ⇒ on any non-Mac machine `readFileSync` fails with
  `ENOENT` (on Windows it is even resolved as `D:\Users\oneincase\...`). It now derives the root the way every other
  test does: from this file's own location (`new URL('../', import.meta.url)`).
  **Suggestion for upstream**: wire this repro harness into the `verify` chain — it exercises exactly the *scope*
  error the stub harness cannot see (`renderUserPropsPanel is not defined` ⇒ React unmounts the whole tree ⇒ blank
  page), and because it is in no chain, CI never runs it, which is also how a hard-coded path could slip through.
  Also noted: the `tabBodyOf` finding from `verify-dead-declarations` (a standalone script referencing a top-level
  declaration) is **upstream's own** warn-only item — it is red on a pristine `origin/main` worktree too, not
  something this repo introduced.


- **The render harness gained three kinds of anchor — and they exposed five real coverage gaps** (the coverage half of P4-19).
  It started from a counter-example: `renderWallpaperTab` (456 lines) produced **only 3 control labels** under the harness,
  because the gates `editing` / `groups` / `uploadedList` / `propsPanelOpen` all default to off — roughly **410 lines** of its
  four sections had never been rendered. Two sibling gaps surfaced the same way: the appearance page's font-section details sit
  behind `sel.fontCustom` (**~180 lines**), and the effects page's live-render group could not even pass "it renders" because the
  harness supplied **none** of its globals.
  ⇒ three **behavioural anchors** were added (each invariant under refactoring, each with positive/negative controls): a **label
  anchor** (`labelSeq`, rows going through `SliderRow`/`switchRow`/`ctlText`), a **class anchor** (`classKinds`, "which widgets were
  drawn" — the only thing that can see the wallpaper tab's raw `input`/`select` beyond its gates), and a **text anchor** (`textKinds`,
  "which strings were rendered" — the transcode row has five branches that differ **only in wording**). Both sides of every gate are
  pinned: `wantClasses` on the open side, `rejectClasses` on the closed side.
  The harness went from 3 cases to **19** (wallpaper 5 / appearance 3 / effects 11), with two **coverage floors**, a `want` floor, an
  **anchor-coverage floor** (all three anchors must actually be used) and a `wantTexts` floor. This round measured one **silent failure**:
  a patch inserted a new case into the previous case's `ctx:` builder — **syntactically valid but never iterated** — so not a single
  judgement was added while the suite stayed green (caught only because the pass count did not move). A **"guard of guards"** was added
  too: a static assertion that every `sameSeq(...)` and all three anchor calls are wrapped in `if (t.<field>)` — it immediately caught
  an unguarded `sameSeq(seq, t.want)` (**without a guard the judgement *crashes* instead of going red**, leaving no verdict at all).
  **Real defects fixed along the way**: the harness never supplied the live-render group's globals (those dozens of lines had never run) ·
  `FRAME_VARIANTS` was stubbed as an **empty array**, so the scene case threw on `FRAME_VARIANTS[i].label` (**an empty stand-in makes a
  branch unreachable — the other disguise of "zero coverage"**) · the transcode row also gates on `sel.transcodeState === "working"`.

- **`renderEffectsTab` split into five blocks — after building it a finer anchor** (remaining P4-19 work). It was the last hundred-line renderer, yet it has **only a single section label** ⇒ section order cannot pin its internal structure. So the labels of `SliderRow` / `switchRow` / `ctlText` were first **put back into the rendered tree** (the `noop` stubs had been swallowing them into `null`), which makes the **ordered sequence of control labels** a judgeable behavioural fact — invariant under any refactor, yet fine-grained enough to catch "a row was moved / removed": the effects page yields 10 labels in the settings variant and 9 in the sidebar variant (the missing one is exactly `帧率上限`, matching the sidebar exemption), and the appearance page yields 7 in the settings variant and 5 in the sidebar variant (the three missing ones come from the `!sidebarSurface` gate).
  Only then was the split done: `renderEffectsTab` **270 → 39 lines** (the parent is now the empty-state early return + the single section shell + five-block composition), with the content becoming five sub-renderers of 12 / 42 / 80 / 78 / 21 lines.
  **One judgement's scope was corrected along the way**: `verify-scene-live`'s "the sidebar ctx must cover every field the renderers need" used to read only the `render*Tab` layer's destructure — once the fields moved into `render*Section`, it read an empty set and went red. **It was right to go red**; the judgement's scope had not followed the code. It now collects the section functions too (candidate fields 8 → 70).

- **The body-reading pipelines collapsed into one implementation: a new `lib/http-body.js`, with nine sites moved onto it** (audit §6.2, P4-13). Previously **eleven sites each hand-rolled** the same "accumulate + cap on cumulative bytes + decode once" logic, and both costs had actually materialised: **a forgotten cap** (a newly added route forgot to copy it) and **change one place, change eleven**. Those two now have their own homes — the former stays under `test/verify-body-caps.mjs`'s disk enumeration, the latter is solved by the shared reader `bodyReader()`.
  **It only takes the three things that were genuinely duplicated** (accumulate / cap / `Buffer.concat` then decode exactly once): responding, timeouts and disconnect teardown stay at each call site — those policies genuinely differ (some call `fail(413)`, some write `res.statusCode` directly, some must wait for a disk write), and abstracting them too would only hide the differences inside parameters.
  **The classification was measured, not guessed**: 11 collectors = **9 "buffering" sites** (moved onto the shared implementation) + **2 "stream-to-disk" sites** (`/upload`'s 512MB and `/custom-frame`, which write `.tmp` as they receive, with backpressure). The latter are a **structural exemption** — their file header has always said the 512MB body must **not** be buffered in memory — so the judgement records them as an exemption, not as something missed.
  **Judgement and implementation ship together**: `verify-body-caps` went from "every site must have a cap" to five checks — an inline collector must carry the cap (named per site, including those two streaming exemptions) · a ratchet of **≤ 2** inline collectors · a floor of **≥ 9** shared-reader call sites · every `X.onData` must genuinely come from `bodyReader(...)` in the same file (`foo.onData` cannot sneak past; negative controls included) · and **a flag set inside a call site must be declared before it**. `verify-scene`'s three "the source's size check matches the test case" needles were re-pointed from `size > X` to `maxBytes: X` (the same fact in its new place, not a relaxation).
  ⚠️ **The migration tripped over a real bug family, and exposed a blind spot in the behavioural judgements**: moving `let done/tooLarge = false` out of the inline callbacks left **three declarations missing** — `shouldStop` / `onOverflow` are closures, so a missing declaration only throws a ReferenceError once "this route actually receives a body". The behavioural judgements caught only `/client-diag`; **nothing ever POSTed a body to `/we-assets-dir`**, which only a static judgement can see ⇒ that is exactly what the fifth check covers (recognising only the boolean/counter-flag shape `NAME = true|false|<number>`, so a `charset=utf-8` inside a string is never misread). **Teeth proof**: removing one declaration goes red naming `lib/index.js:tooLarge`.

- **Ledger truth repair: three claims that had gone stale** (`docs/wip/OPEN-ITEMS.md` calls its status column "the single source of truth for progress", and three of its entries were wrong — each of them would actively **mislead the next person planning work**, which is why this deserves its own cut):
  ① **P3-28 said "landed in the workspace with judgements, **not committed**"** — it had in fact gone in with the P4-1…P4-16 aggregate commit, with `verify:all` green: the second fence layer (`lstatSync` rejecting links + a `realpathSync.native` containment check), the host-provided `sceneMediaBase`, and the `onHandleDiag` shared between the media source and the diagnostics family are all in the committed tree, and `verify-scene-live`'s four fence judgements are complete (including the anti-vacuity negative control "an ordinary file in the same directory still returns 200" and the platform skip recorded when a link cannot be created) ⇒ **flipped to ✅**. Per ADR-0006 D2 the replacement text is a **recompute command**, not line numbers (line numbers drift).
  ② **P2-11 said "that guard went away with ADR-0006 ⇒ this monitor is now dead"** — it has in fact been **rebuilt as a code-reading guard**, `test/verify-route-families.mjs` (in the hard `verify` chain), following §7 item 6's recompute method; its current reading is `ROUTE-FAMILY TRIGGER NOT FIRED (below the line)` (36 routes / largest family 2 < 3).
  ③ **§3.1 said `src/panel-tabs.js` "is still 5 giant render functions in one file, the repo's largest unit of understanding"** — no longer true after P4-19: the three largest renderers are each just a "compose the sections in order" list (a dozen lines), with the drawing living per section in `render*Section`; **the only hundred-line renderer left is `renderEffectsTab`**. This cut is **documentation only**, but what it repairs is the "single source of truth" itself.

- **The two largest tab renderers were split into one sub-renderer per section — but the judgement came first** (audit P4-19). `renderWallpaperTab` (458 lines) and `renderAdvancedTab` (111 lines) were the repo's largest **units of understanding**, and they had **not a single behavioural judgement** — only source anchors ("the function is here", "its first line destructures ctx"). The three things a pure move breaks most easily (**dropping a section / reordering / duplicating one**) were invisible to those anchors, so this cut was ordered **build the thing that can see it, then move**:
  a **real-renderer harness** (real renderers + a minimal stand-in ctx) renders the two tabs and extracts the **ordered** sequence of `we-picker__section-label` nodes from the tree ⇒ "section order" becomes a behavioural judgement that is invariant under any refactor. It also pinned the **gate** on the 实时渲染诊断 section: a video wallpaper does not draw it, a scene wallpaper draws it **last** (that gate previously existed only as scattered source strings, with no behavioural assertion).
  Then the move: `renderWallpaperTab` **458 → 16 lines** (four sections at 102 / 61 / 149 / 162), `renderAdvancedTab` **111 → 16 lines** (five sections at 18 / 18 / 44 / 25 / 25). Each parent is now a composition list answering "which sections, in what order", and each section destructures only the ctx fields it actually uses.
  **Three real defects were caught and fixed along the way**: ① the **spread** form `...INTERVALS.map(...)` made the derivation script treat it as member access ⇒ that section did not destructure `INTERVALS`, so the first branch to execute would throw a ReferenceError (the new render harness caught it immediately). A second, **static** judgement was added for that class — "every ctx field a section function uses, it must destructure" — using that tab's ctx field universe as the vocabulary, **comments stripped first** (rule ⑦), with the spread form counting as a use and object keys not; ② writing that static judgement tripped over **CRLF slicing** — the boundary string used a bare `\n`, which does not match in the (CRLF) working tree, so `indexOf` returned −1 and the slice ran to the end of the file, pulling in **other functions'** destructures and reporting the whole vocabulary as "not destructured" (a judgement that "slices wrong and reports anyway" is exactly the shape it exists to prevent); it now normalises to LF with the reason written down; ③ the split script introduced **140 bare-LF lines** into a file that was pure CRLF; normalised.
  **Teeth proof**: removing `INTERVALS` from that section's destructure makes the render judgement and the static judgement **each go red and name it**.
  **Second round, same method**: `renderAppearanceTab` / `renderEffectsTab` got the **same section-order expectations** first — with the ctx driven by the **renderer's own destructure line** (everything except the few value-shaped fields `fontSet` / `surface` / `sel` is a handler), so "what this tab needs" is still decided by the source rather than hand-copied. That also turned two gates that previously existed only as source strings into behavioural assertions: on the appearance page's sidebar variant the **three sections wrapped in `!sidebarSurface` are not drawn** (only 主题 / 细节 remain), and the effects page takes its **empty-state early return** when `!sel.id`. Only then was `renderAppearanceTab` split: **350 → 10 lines** (five sections at 38 / 22 / 231 / 27 / 54). The most concrete benefit of that architecture shows up here — the module header's promise that "a missing field is an immediate ReferenceError" still holds **after** splitting, because `const { … } = ctx;` is now **one per section**, so what each section needs is visible at a glance. This round caught a third bug of the same family: an injected preamble local (`const sidebarSurface = surface === "sidebar";`) did not bring **its own dependency** into that section's destructure ⇒ `surface is not defined` (the render harness caught it; three sites fixed at once).
  **Deliberately left**: `renderEffectsTab` (271) has only a single section label ⇒ splitting it "one sub-renderer per section" has **no order to pin**; doing it would first require a different anchor (e.g. pinning the *ordered sequence of control labels*), so it was not touched this round; `renderAppearanceFontSection` (231), `renderWallpaperUploadsSection` (162), `renderWallpaperRotationSection` (149) and `renderAboutTab` (123) remain sizeable units that could be split one level further. See the P4-19 row in `docs/wip/OPEN-ITEMS.md`.

- **CI gained a POSIX leg: the other half of the platform conditionals now actually executes** (audit §8). Both workflows previously ran only on `windows-latest`, while the guards contain **platform conditionals** whose halves only have teeth on their own platform — the most concrete being `verify-scene`'s unlink-failure case: **only POSIX `chmod` can block an unlink** (on Windows the mode bits are essentially ignored) ⇒ the POSIX half (500 `unlink-failed` / the frame is still on disk / retry works …) did **not** execute on win32, while the win32 half (ENOENT idempotence) does not execute on POSIX; there is also `verify-scene-live`'s junction/dir branch and a win32-specific assertion in `verify-media-bridge`.
  **The judgement itself had been shouting about this**: on every win32 run `verify-scene` printed "5 of these come from the posix branch … has no coverage on win32 — this is a coverage difference, not a pass." So "changing the platform changes which half is asserted" is not a reason to *avoid* a platform — it is exactly the reason to run **both**. `verify.yml` is now `strategy.matrix.os = [windows-latest, ubuntu-latest]` with `fail-fast: false` (one leg going red must not hide the other leg's verdict), `concurrency.group` includes `matrix.os` (unambiguous semantics: a new push cancels the previous run *of the same platform* rather than the two legs cancelling each other), and the first step prints `process.platform` so the logs are readable. **`verify:bridge` runs on both legs** — `lib/media/provision.js` already declares Linux assets (`media-bridge-linux-x64-musl` and friends, hashes included), so it is not a case of "nothing to download"; that step carries its own third outcome ("environment skip"), so a failure there is a real regression.
  **Judgement**: a new section ④ in `test/verify-contracts.mjs` — it parses the runner set a workflow **actually runs** from its source (recognising both `runs-on: <literal>` and `runs-on: ${{ matrix.os }}` + `os: [...]`) and asserts it contains both windows and ubuntu/linux; three negative controls cover a single-platform literal, a single-platform matrix, and "the matrix form must yield *all* platforms" (otherwise the main judgement would go falsely green). **Teeth proof**: collapsing `verify.yml` back to windows-only goes red naming `runners=windows-latest`; restoring goes green.
  ⚠️ **This leg's first real run is its verification** — this machine is Windows, and the POSIX branch is structurally unrunnable here (`chmod` does not affect deletion); that cannot be substituted locally.

- **The published artifact is now actually installed by a real installer** (audit §7.6). The blind spot was structural: CI only ran `dsh plugin add link:<workspace>`, and the publish-surface guards only check the **declarations** (`files` / reachable closure / `dependencies`) — and **a symlink does not participate in dependency resolution**, so "can `peerDependencies` resolve from the **installation closure**" was structurally invisible on that channel. The cost was measured by a user report: `Packages: +1` (only the plugin itself was installed) → `generation … already exists, reusing` → `generation peer validation failed: @deepseek-ai/dsh-client-runtime does not resolve from the installation closure`.
  `test/compat-harness-live.mjs` now has **two install channels**: `--channel link` (default; symlinks the workspace) and `--channel tarball` (runs `npm pack` first, then installs the **.tgz**, with `--fresh` to isolate HOME). So the existing end-to-end judgements (host routes reachable / the on-disk diagnostics carry the liveness marker / the ring buffer reads back / the process survives / no plugin-tree load failure) **now cover the published artifact too**, plus three judgements that belong to the tarball channel only: a **channel self-proof** (the installed entry is a **real directory**, not a symlink — otherwise the judgement might be measuring something else) and two targeted failure-string assertions (`peer validation failed` / `does not resolve from the installation closure`). `harness-compat.yml` runs **one step per channel**, and `npm pack`'s cache / logs point at the isolated directory, so packing needs no network and never pollutes the global cache.
  ⚠️ **This channel cannot run on this machine** (the sandbox forbids spawning with pipes — even the first "HOME isolation reaches the child" step fails with EPERM — and there is no `dsh` here), but it fails **loudly** rather than skipping silently: a missing prerequisite shows up as a failure, which is exactly the failure shape this repo's §0 requires. The locally verifiable half was verified: packing produces a single tarball (39 files).

- **The panel tabs finally honour their own module header: 26 inline "write + notify" arrows became named handlers** (audit §6.3, which called it a **real seam gap, not style**). The header of `src/panel-tabs.js` has always said "a tab **must not** write selection / must not emit — writing settings is the handlers' job", but the measured violations were **not** on the "writes selection" clause (that one was always zero). What was actually missed were **the two classes the judgement cannot see**: ① 22 direct `emit()` calls across 4 renderers; ② writes to **module-level state** (`propsPanelOpen = !propsPanelOpen`, `pickerFocusPending`, `pickerOpener = el`) and to **what a ctx alias points at** (`editing.name` / `editing.interval` / `editing.order = …`, where `editing` *is* `selection.editing`). Class ② contains no `selection.` literal at all, so the "count the `selection.` literals" judgement **let it through indefinitely**.
  **Why this is a gap rather than style**: the sibling renderers split out in the same cut — `src/picker-modal.js` and `src/picker-props-panel.js` — have long been held to the **strict** standard (`selection` zero references + `emit(` zero calls); only `panel-tabs.js` was missing from that table.
  **Fix**: those inline arrows became **named handlers** in `src/client.js`, passed into the tabs through ctx — `onTogglePropsPanel`, `openPicker` / `onOpenPicker` / `onOpenPickerDraft`, the three rotation-draft mutators (`onEditName` / `onEditInterval` / `onEditOrder`), the two editable-path draft clusters (upload dir, WE assets dir), `onToggleSceneLive` (**six things together**: write the switch + clear failure memory + clear prepare-phase cooldown + clear in-session soft failures + rebuild layers + re-sync audio), plus `onFpsCap` / `onObjectFit` (including the Edge canvas path's direct redraw) / `onToggleLiveDiag` and friends. What remains in the tabs is `onClick: onFoo`.
  **Judgements**: ① `panel-tabs.js` joined the seam judgement table in `verify-client` (**the same wording** as the other two renderers); ② a new judgement forbids a renderer from **mutating ctx aliases / module-level state**, covering assignment, member assignment and in-place mutation, while never flagging pure reads (including `.map`) or mentions inside comments. **Three teeth proofs**: injecting one of each class goes red and **names** it (`propsPanelOpen` / `editing` / `不得自己发通知`), and after restoring, `verify-client-sync`'s rebuild is **byte-for-byte identical**. **Consequential updates**: three cross-file "panel → live render" wiring judgements in `verify-scene-live` followed the call site to its new owner (**both ends pinned**: the handler really does it + the panel really references that handler — pinning only one end misses "someone deleted the other end"), and the sidebar ctx coverage list plus the real-render harness were extended in step (11 new free variables; missing one is a ReferenceError).

- **The frame-cache slot now yields only its one real artifact, and a wasted "variant 4" pass is gone** (audit §6.4). `sceneFrameSlot` used to return `pngPath` / `jpgPath` / `gifPath` / `dir` plus a `_vN` variant suffix, while **only `gpuPath` had a consumer** (alongside `key`, which is the write-dedup lock key for the GPU-frame PUT) — those three paths were leftovers of the static-frame extraction line, and the `_vN` suffix was **never reachable**: no live call site ever passed a non-zero variant. The return is now `{ key, gpuPath }`.
  **A real piece of wasted work on that same chain went with it**: variant 4 (a user's explicitly pinned custom cover) is **exempt** from frame capture, yet it still called `sceneFrameSlot(abs, 4)` — doing a `statSync` + `ensureFrameCacheDir()` for paths that would **never be read** (`gpuFrameFileFor` already returned `null` for variant 4). The exemption is now decided **by the caller** (`variant === 4 ? null : gpuFrameFileFor(sceneFrameSlot(abs))`), so variant 4 does not resolve a slot at all. `gpuFrameFileFor` also lost its `variant` parameter and a dead branch that only covered variants 1/2/3 while the value domain is `{0,4}`.
  **Verified**: four new assertions in `test/verify-scene.mjs`, each with a control — the dead fields have **zero residue** in `lib/` (and the scan **strips comments first**: the comment explaining *why* they were deleted must still be able to name them), the return has **exactly two fields** (counted, not name-matched — `dir` legitimately exists in that function as a local variable, so forbidding the name would be the wrong judgement), no variant parameter and no `_v` suffix, and the exemption point does not resolve a slot. **Two teeth proofs**: re-adding `dir` + `pngPath` goes red and names it; re-adding **only** `dir` goes red reporting `fields=3` (that second one specifically closes the "a name-based judgement would miss a bare `dir`" gap).

- **The publish surface shrank again: the TEX-extraction module retired outright and the in-tree JPEG decoder copy went with it** (audit §6.1, which called it "the **only** structural leftover this refactor clearly failed to delete"). `lib/pkg-extract.js` was a leftover of the static-frame line: once P2-12 deleted that line wholesale, its **TEX→RGBA decode chain** (`decodeTex` and every decode helper), its **embedded-PNG payload decode** and its **embedded-MP4 extraction** had no callers left — measured from the only live entry point, `parseTex`, **430 of 645 lines were unreachable**. Two illusions kept it alive: ① the host's two `await import('./pkg-extract.js')` calls only use `parsePkg` / `readPkgEntry`, whose implementations already live in `lib/pkg-read.js` (the direction P3-17 was already consolidating), so they can import it directly; ② the only mention of it in `lib/scene-manifest.js` is **a sentence in a comment** — a read-only audit concluded from that "this one is live, **do not delete it by mistake**", which is **reading a comment as a call site** (this repo already has a "strip comments before judging" rule for *assertions*; this was the same rule failing on the *auditing* side). What really pinned it was a ledger-guard "live dependency survives" assertion (it checked that the string `function extractTexVideoMp4(` existed — **a guard pinning a call-less function as a live dependency**); that guard retired with ADR-0006, and the last obstacle to deletion went with it.
  **Removed**: `lib/pkg-extract.js` (645 lines) · `lib/vendor/jpeg-js/` (7 files, ~100KB of in-tree copy shipped in the package) · two `package.json` `files` entries (`lib/pkg-extract.js`, `lib/vendor/`) · an unused `node:zlib` import and a zombie "PNG encoder" section comment. Container knowledge keeps its **single implementation**, `lib/pkg-read.js`.
  **Verified**: the `lib/**` scan surface went **27 → 23 files / 34,124 → 31,756 lines**, with runtime-unreachable still at **0 / 0**; every publish-surface guard (files coverage / named entry points / `node --check` per module / relative specifiers resolvable / dead declarations / BOM) is green. **Judgement**: a new section ④ in `test/verify-retired-lines.mjs` — the retired vocabulary must have **zero residue** in the scan surface, plus three existence assertions (the file is gone, the copy is gone, `files` no longer lists them) and a negative control; and it was executed strictly per this repo's "**a reverse probe precedes the deletion**" discipline: **add the probe first, let it go red and enumerate the 10 places to clean, then clean them one by one**.
  ⚠️ The `lib/vendor` directory name itself is deliberately **not** in the retired vocabulary — it is the **permitted** location for third-party copies per `CODE-STRUCTURE` §5; what retired is that one copy, not the directory concept.

- **Four host-hardening cuts (each an independent one-thing-at-a-time change, each with a guard that pins it)**:
  ① **Four routes gained a request-body cap** — `/remove`, `/upload-dir`, `/we-assets-dir` and `/media-control`
  accumulated `body += chunk` while **never comparing a length**: an oversized request grows the host heap
  without bound (it listens on loopback only by default, but the webserver allows `host: 0.0.0.0`, and all four
  are POST). The cap comes from one shared constant, `CONTROL_JSON_MAX_BYTES` (64 KB for small control-plane JSON).
  **This judgement gap had already been measured once**: a read-only audit recorded that "no guard requires a
  cap on body-reading routes; the gates its siblings already had relied on people remembering to copy them",
  and then the newly added `/media-control` **forgot to copy it** ⇒ the gap went from three routes to four.
  So this is not "fix three more": the judgement is now **disk-enumerated over every `req.on('data')` site, red
  when a cap is missing** (`test/verify-body-caps.mjs`, 8 positive/negative controls plus a coverage floor; a
  callback that is a bare identifier — the idle-timer reset — is a **structural** exemption, not an allowlist).
  ② **Per-chunk decoding ⇒ multi-byte code points became `U+FFFD`**: the second silent defect on that same chain —
  a code point split across two TCP segments gets corrupted, and when **user-visible strings** (wallpaper ids,
  font names, font families) are corrupted the client never finds out. Six handlers (`/settings`, `/fontsets`,
  `/remove`, `/upload-dir`, `/we-assets-dir`, `/media-control`) now **count bytes as they arrive and decode
  exactly once** via `Buffer.concat(...).toString('utf8')` — the shape `/live-frame`, `/scene-frame-cache` and
  `/client-diag` already had.
  ③ **`reqLogSeen` gained a bound**: its keys carry **request-controlled** path segments (`/scene-files`
  sub-paths, `/live-frame` tokens, `/scene-live` pathnames) and it only ever did `get`/`set` with no reclamation
  ⇒ distinct requests grow the heap **monotonically** (measured: 200k distinct tokens took `heapUsed` from 32.2 MB
  to 72.4 MB and it was never released). The 10 s TTL only suppresses **writes**, it does not clean entries, so the
  bound is now guaranteed separately (oldest-first eviction in insertion order once over the limit). When dedup and
  the bound conflict, **the bound wins**: an evicted key may produce one duplicate diagnostic line — diagnostic dedup
  is best-effort, bounded memory is a hard requirement.
  ④ **`/custom-frame` gained an "abandoned mid-upload" path, plus two temp-file defects**: when the dialog is closed
  or the network drops, `req 'end'`, `'error'` and the timeout all fail to fire and `failed` is never set ⇒ reaching
  cleanup through `ws 'close'` alone was impossible: the write stream stayed open (an unclosed fd until GC) and up to
  30 MB of `.tmp` was left on disk, while the read side only accepts the real extensions ⇒ **invisible** garbage that
  only accumulates. It now mirrors `upload.js` with a `req.once('close')` (and no longer destroys the stream once
  `completed`), plus a startup sweep that removes **only sufficiently old** `.tmp` files (orphans from a killed
  process; age-gated so an in-flight write is never deleted).
  **Transcode temp files also moved to `atomicTmpPath`** (`.tmp<pid><incrementing seq>`): they used the deterministic
  name `cachePath + '.tmp' + pid`, and `cancel()` removes the `TRANSCODE_INFLIGHT` entry immediately ⇒ a new job could
  start on the same path **before** the old job finished settling, and the old job's `unlinkSync(tmp)` in its `catch`
  deleted **the new job's work in progress**. ⚠️ The rename also fixed the sweeper's "protect this process's in-flight
  writes" check (it only recognised names **ending** in `.tmp<pid>`, so after the rename it would have failed silently
  and deleted a file being written during HMR). **`uploads/.meta.json`'s read-modify-write joined `enqueueConfigWrite`**
  (the same write queue `config.json` uses): two overlapping meta writes lose `sha256`, and `sha256` is exactly what
  content dedup compares — lose it and the same file piles up as copies.
- **Two client defects users run straight into**:
  ① **The boot chain gained a terminal `.catch`, and the bare `localStorage` read moved behind a guard** — the migration
  branch wrapped only `JSON.parse` in a try, leaving `localStorage.getItem` **outside** it: when site data is disabled
  or the page is embedded from an opaque origin, `getItem` itself throws `SecurityError` ⇒ `loadPersisted()` rejects
  wholesale ⇒ the boot chain (`loadPersisted → loadFontSet → loadInventory`) breaks ⇒ the picker is **permanently stuck
  on "scanning Wallpaper Engine…"** and the one-time notice never settles (the user can only refresh or disable the
  plugin). The whole read now goes through a guarded `readPersistedRaw()`, and the chain has a **terminal catch** that
  leaves a `boot-chain-failed` diagnostic line. The comment right there already described this exact pitfall being fixed
  once before — which is why the **position** of a guard matters more than remembering to wrap a try.
  ② **The music toggle's highlight was inverted**: the predicate was `weAudioVolume() > 0 || disabled` (simplified:
  highlighted only when the toggle is on *and* the volume is 0), while the factory default is `videoVolume: 0` +
  `videoAudioEnabled: true` ⇒ the button was lit while the wallpaper was mute, and clicking it (turning the track off)
  made the highlight **disappear**; the adjacent label looked only at `videoAudioEnabled` ⇒ label and highlight
  contradicted each other. It now uses **verbatim the same predicate as the button's own state** (and as the label):
  `videoAudioEnabled === false ? "" : " is-on"`. ⚠️ The "on *and* has volume" spelling is deliberately **not** used:
  volume is a **separate** control, and that spelling would leave a click with **no visual feedback at all** in the
  factory default configuration.
- **One disabled monitor restored (as a code-reading guard) + one "assertion idling" bug fixed**:
  ① **The route-family trigger line has a watcher again** — ledger §7-6 ("a path-first-segment family reaching ≥3 routes
  ⇒ split it per family") used to be watched by `verify-ledger.mjs`, and that guard was retired wholesale with ADR-0006,
  whose own "cost" section states that **the monitor is now dead** ⇒ the trigger line still lived in the docs with
  nothing watching it. Following the remedy ADR-0006 prescribes, the judgement now lives in a code-reading guard,
  `test/verify-route-families.mjs` (enumeration via `buildIndex()` in `host-route-index`; grouping verbatim identical to
  group ② of `analyze-host-apply.mjs`). **It going red does not mean the code is broken — it means an adjudication is
  due** (split the family, or move the line *and* the judgement together).
  ② **One `verify-scene` judgement was scanning the whole file**: its end anchor was written as `sceneFrameSlotFile`
  (**which does not exist anywhere in the repo**) ⇒ `indexOf` returned −1 ⇒ `slice(start, −1)` scanned to the end of the
  file, degrading the judgement from "inside the function body" to "everything else in the file" while still reporting
  green. It now bounds by the next top-level function and adds a **"missing anchor is red"** assertion plus a negative
  control (this "anchor drifted and nobody noticed" shape is another instance of the P3-16 class).
- **Documents and comments now describe only the current mechanism (a batch of statements that contradicted the code)**:
  `theme-follow.js`'s header claimed the threshold was mid-grey `≈0.2159` while the implementation is `0.40` and the same
  file says further down that it does **not** use mid-grey (header and body contradicted each other); `effects.js` claimed
  it "only reads selection" while `clearEffects()` writes five of its fields (now states the single exception and that it
  still writes no settings); `client.js`'s rotation-interval comment said "default 5 minutes" while the source of truth is
  `rotationInterval: 30`; `lib/index.js`'s cache-key invariant still pointed at the "prewarm disk write" **deleted with
  P2-12**; one `live-layer.js` comment had turned into a chronicle ("this line once said …", which ADR-0006 forbids);
  `CONTRIBUTING.md` called `INLINE_MODULES` "the 14 modules" when it is far more than that (**per ADR-0006 D2 this became
  "read it off the build list", no hardcoded number**); `HOW-IT-WORKS.md` still pointed at "ledger §9.5" (that section is
  archived). One **dead fixture pipeline** was also removed: the "contract fields" `fontSetNewName` / `newName` **do not
  exist** in the implementation (neither the store literal nor `fontSetCtx()` has them) — only the guard was still feeding
  them. **`docs/en/TROUBLESHOOTING.md` gained the section the Chinese page had and the English one was missing entirely**:
  "I changed the plugin and nothing happens at all — separate the client half from the host half" (with its four on-the-spot
  checks), plus the lineage note at the top — after which this pair's section structure lines up item by item for the first
  time (it was 7 : 5 headings before).
- **Ledger numbers retired per ADR-0006 D2**: `docs/wip/OPEN-ITEMS.md` §2/§3/§7 had copied a dozen-plus values that drift
  (inline-module count, the `lib/**` scan surface, `apply`'s line count and route count, `WallpaperPicker`'s line count,
  guard counts, the co-change mean…) and **all of them had drifted** (an earlier read-only audit listed them one by one).
  They are now **metric + recompute command only**. §3.2's "`lib/**` duplication 9.6%" conclusion had the **direction
  backwards** (it counted the generated `lib/client.js`, which carries a copy of `src/**` again, as host-half structural
  duplication — with the generated artifact and vendored code excluded, the hand-written surface is well under 1% at both
  window sizes), corrected together with "the scope and exclusions must be stated".

### v1.2.0 (2026-10-02)

> Everything from 1.1.0 to 1.2.0. Themes: the **sidebar workbench** (Appearance / Playback in the sidebar + "Wallpaper properties"), the **glass tinted floor** and the "Left sidebar override", and the **prerequisite switch to the official desktop (DeepSeek Harness) ≥ 0.2.0-rc.1** (old DSH Desktop 2.0.x cannot install this release). Announcement: the v1.2.0 Release page.

- **Prerequisite switch: `engines.dsh` now declares `>=0.2.0-rc.1`, mirrored by the three dsh peers and the description**: the manifest declarations are the data source for the plugin market's host-requirement badge and install pre-flight (a top-level hard `engines.dsh` plus the optional `@deepseek-ai/dsh-*` peers, intersected for display). All four declarations must be the **same string** for the badge to render as a single `DSH >=0.2.0-rc.1` (mismatched strings render as an `A ∩ B` intersection). Result: the official desktop (kernels 0.2.0-rc.1 / 0.2.0-rc.2) shows a quiet "compatible" badge; old DSH Desktop 2.0.x (kernel 0.1.7-rc.1) shows the red "incompatible" badge and the install pre-flight refuses. Verified against dshmarket's own resolution lib (`.test-cache/badge-sim.mjs`).
- **The quick panel's empty-state hint now spells out the full click path**: the sidebar's type dropdown and the settings page's type filter are **two stacked layers** (the upstream one filters first, the sidebar narrows on top); when the two have nothing in common the old hint said "switch it to All" without saying where. The main hint now **names both layers** ("Scene" here and "Video" in Settings have nothing in common — only wallpapers passing both filters are listed), followed by the **full click path** (Settings → Wallpaper Engine → Library → "Choose wallpaper" → the "Type" dropdown at the top → "All"); when both layers agree and the type itself is empty, no misleading path is shown — just "No playable wallpapers of type {name}".
- **The in-app notice is rewritten for 1.2.0 (`NOTICE_VERSION` bumped)**: the body follows the v1.2.0 Release copy (prerequisite change first, then sidebar / glass / render engine, usage tips and the three-step readability routine); the "💡 Tips" and "❗❗❗ hard to read" section headers changed from grey small print to **bold body text**, and the About tip gained a ❗❗❗ prefix in bold (field feedback). The i18n dictionary was rotated with the notice: +31 / −35 (all v1.1.0 notice entries retired); `verify-i18n`'s two-way accounting is green.
- **A Windows CRLF false positive fixed in the guards**: verify-scene-live's "the panel renderer must be a top-level declaration" check tested indentation with `\s+` — `\s` spans newlines and JS regex `^` treats `\r` as a line terminator in multiline mode, so on a CRLF checkout a top-level declaration preceded by a comment line was misread as "indented" (invisible on LF checkouts); now `[ \t]+` (same-line indentation), negative control updated. A replication script confirmed the failure predates this round's changes (the pristine HEAD file reproduces it).

- **Sidebar Wallpaper properties: the entry sits below the tab bar (full row, no background) and opens an in-page drill-down**: the field report was "the wallpaper properties under the sidebar's Wallpaper / Appearance / Playback tabs are gone". What we found: the panel only ever lived in the settings page's **Wallpaper library tab**; the sidebar (one shared `src/quick-panel.js` for the official right-pane tab and the low-version slide-out drawer) never wired it up — not a regression, but a gap. **Final shape** (converged over three rounds of user feedback): the entry sits **below** the Wallpaper / Appearance / Playback tab bar, **spanning the full row** (`.we-qp__propsbtn`: full-row width, keeping the button border, centred text and a 12px label matching the tab labels — each pinned to the user's wording). It is visible in all three tabs at the same spot and **does not disappear while the drill-down is open** — in the open state the same row and position read "Collapse wallpaper properties" with `is-on` highlighting, and clicking again collapses it; clicking it from another tab switches back to Wallpaper first, otherwise the click looks like it did nothing. Opening it is an **in-page drill-down**: the content area becomes the properties panel directly (there is no back-button row) while the list, search box and sound group step aside. The panel body and toggle remain **shared with the settings page** (the `propsPanelOpen` accessor plus the module-level `renderUserPropsPanel`), and the entry's visibility rule is character-for-character the settings page's (scene / web wallpapers with a `propsUrl`). Two real defects were hit and fixed this round: ① **a scope accident** (the direct cause of the whole page going blank): the panel renderer used to be a closure inside `apply()`, while `src/sidebar-right.js` is a prelude (evaluated **before** `apply()`), so the render callback it registers cannot reach apply's scope ⇒ the real app threw `ReferenceError: renderUserPropsPanel is not defined` ⇒ React unmounted the whole tree; the settings path could not notice because it receives that function explicitly through `ctx`, and this was only caught by a repro harness that runs the real artifact through the real sidebar registration path. The renderer therefore moved to **module scope**, with a structural check pinning "must be a top-level declaration" (the layout-time stub harness can never catch scope errors). ② **complementary gates**: the drill branch and the remaining content branches must gate on `qpTab === "wallpaper" && toggle && propsAvailable` and its negation respectively; a single step of skew (toggle still on but this wallpaper has no `propsUrl`) leaves both false and blanks the content area. Also fixed: the panel drew the property table left over from the **previous evaluation** (the host is asynchronous) and used to look only at `propsState.loading`, so switching wallpapers with the panel open showed the previous wallpaper's properties as if they were the new one's (a mismatched token now suppresses every row and says "Fetching this wallpaper's properties…"); the three empty-table causes are stated separately in the note (never pretending to be "no properties"); and `onClear` collapses the toggle when the wallpaper is cleared. A temporary status readout (` · <token> · <definitions the host returned>`) hung in the panel header while the blank-panel report was being diagnosed and **has been removed at the user's request** — the header now carries only the human-readable sentence, and a check pins "no readout".
  **Verification**: [repro-sidebar-props.mjs](../test/repro-sidebar-props.mjs) runs the **real artifact** (`lib/client.js` → `apply(ctx)` → the official sidebar `ctx.slots.inject("sidebar.right.pane.tab")` registration path → a real selection → a real click on the entry): before the fix it reproduced that exact `ReferenceError` verbatim, after it the "entry → drill-down → panel lands" path completes. Checks: `verify-scene-live` — the entry sits **below the tab bar and before the content area** (with a negative control: moving it above the tab bar turns it red), full-row with an explicit border whose colour comes from the theme text colour (`--we-ink` + `color-mix` 40%, with a negative control), present in all three tabs and switching its label/highlight with the drill-down, and switching back to the Wallpaper tab when clicked from another tab; the drill branch precedes the others and renders the panel directly, with **no back-button row**; the remaining branches and the drill branch have **complementary gates** (`!(…)` at least twice, with a "revert to toggle-reading only" negative control); the panel renderer must be a **module-level top-level declaration** (with a negative control that an indented declaration inside `apply()` turns red); real-source render checks — the entry goes through the handler, the drill-down takes the list's place and the entry becomes "Collapse", clicking "Collapse" returns to the list, "the wallpaper page's content area is never empty (list or panel)" across **five inputs**, and the entry is present in all three tabs while the panel belongs to the Wallpaper tab alone. `verify-picker-props` sections 8/9 stand. Full `npm run verify` (23) and `verify:docs` are green; the route index's "guard mentions" counts were regenerated for the new guards.

- **The sidebar's current-wallpaper thumbnail is properly round now — the outer edge is a true circle clip and the centre hole no longer uses a mask**: the field report was "the current-wallpaper image is not round enough". Cause: the outer edge relied on `border-radius + overflow` (rounding a square box) while a `radial-gradient` mask punched the centre hole — a mask promotes the element to an extra raster layer and **blurs the outer edge's anti-aliasing**, so the circle looked fuzzy. Now: the outer edge is `clip-path: circle(50%)` (a true circle clip on the image box, with visibly cleaner anti-aliasing) on a square box (`aspect-ratio: 1/1` + `box-sizing: border-box`), the centre hole is still drawn by the `::after` **stroked ring** (not a colour patch — the panel is glass, so only a gap lets the background through), and the disc no longer uses a mask at all. Checks: `verify-scene-live` gained two (true circle clip + square box + no mask, with a "revert to border-radius + mask" negative control; the centre hole still drawn by the ::after stroked ring).
- **Four CI-assertion fixes (two permanently-red compat probes + the five-section walk after a rename + one mock keychain for every headless browser + a CRLF-tolerant verify-scene-live)**: ① `compat-harness-pages`'s surface-token probe took `.value` off `evS`'s return value (which already IS the value) ⇒ `sp` was always `null` and **three assertions had been red since bb06fc2 with no visible reason** (harness-compat is dispatch-only, so nobody noticed); now fixed and green (27/27), with a `DSH_WE_COMPAT_DEBUG` raw-value dump added. ② The five-section walk hard-coded `Wallpaper Engine`, but the UI refactor renamed that section to 「壁纸引擎」 ⇒ the last section was clicked 0 times (the same assertion's `断点=` field named it, but the reading was easy to miss); it now matches a **candidate list** (a rename can no longer fail silently; only "neither name found" goes red). ③ **Headless browser launch policy: all 6 `--headless=new` launch sites now carry `--use-mock-keychain`** — on macOS a missing flag makes Chromium (Edge measured) touch the real keychain and pop the "keychain not found" dialog, interrupting whoever is running the tests (reproduced twice on the user's machine; `compat-harness-pages` and `tools/diagnose-web-blank` were each missing it, and the second run inside `e2e-web-media-origin` too). `verify-contracts` now guards it statically (section ③, matched per **launch argument array** so new launch sites are covered automatically, with a negative control).
  ⑤ `verify-scene-live`'s "sidebar ctx covers every field the renderers need" check wrote a literal `\n` in its pattern, so on a **CRLF checkout** (CI runs on windows-latest; this repo ships no .gitattributes and Git for Windows defaults to autocrlf) it matched **zero candidates**: green locally on an LF checkout, but red in CI as `候选 0 个` with 279 passed / 1 failed (measured on this PR's first push). It now accepts `\r?\n` with a positive/negative control (the same check must find the fields in both LF and CRLF forms, and must miss on a wrong function name); the other 21 guards were re-run one by one on a `git clone -c core.autocrlf=true` checkout and are all green — this was the only CRLF-fragile assertion in the batch.
- **Dragging a colour wheel or a slider no longer stutters (the drag path writes only what is visible)**: the field report (a user saying "picking a custom colour feels laggy") traced to every single tick of a drag through the native colour wheel running `setSetting + emit()` — `emit` re-renders the whole panel (the settings one is the heaviest: the font table, 12 colour swatches and the font-set editor), and that **full** `applyEffects` inside the emit subscribers also rebuilds the font stylesheet, re-syncs scene audio and reads `getComputedStyle` once (whenever wallpaper opacity is above 0 — which is a **forced synchronous style recalculation**, i.e. a whole-page relayout) ⇒ three expensive jobs per tick, which is what made dragging feel sticky. There are now two paths: during a drag (`input`) the handler only writes the value and calls `applyEffects({ live: true })` (skipping those jobs as unrelated to this drag, while still writing **all** the style variables) and does **not** emit — the visible readout updates in place (the slider track writes `--we-fill` straight to its style, and a native colour swatch changes on its own); on release (`change`) the full pass runs once (emit → full `applyEffects`). The volume slider follows the same split (no emit while dragging; volume itself applies immediately). Intermediate drag values are still persisted (that `setSetting` debounce of 200 ms), so closing the window mid-drag does not lose the last value. This matches the silent-drag convention already used by the wallpaper-properties panel (`onPropInput` in `src/picker-props-panel.js`).
  **Verified**: `verify-client` gained three layers — ① both row constructors must pass the live flag down (`input` = true / `change` = false); ② the 17 draggable handlers must all funnel through `commitLiveSetting` (the volume one keeps its own `if (!live) emit()`, recorded in the branch-notification exemption table as "the drag path deliberately does not notify"); ③ **behaviour**: the real `src/effects.js` is run against a DOM stub carrying spies — the drag path must call `getComputedStyle` zero times and touch neither the font stylesheet nor scene audio while still writing ≥15 style variables, and the no-argument (release) path must do all of them (negative control paired, including the "one calculation is allowed on a cold start with no cache" edge). `verify-scene-live`'s `applyEffects` shape assertion was updated to `function applyEffects(` along with the signature.
  **Known gap**: the 12 colour-role swatches in the Appearance page's "global font" section still emit on every tick under the old convention — their visible feedback goes through the host token layer written inside that emit, so going silent would freeze the preview; they need their own treatment (an rAF-coalesced path).
- **The sidebar gained "Wallpaper / Appearance / Playback" tabs — the two settings pages are now reachable without leaving the wallpaper**: the quick-play panel (the same component serves the official right-sidebar tab and the swipe-out drawer on older hosts) gained a three-tab bar **below** the rotation section; both its position and the rule that the content above stays visible on every tab are explicit requirements: **the current wallpaper and the rotation controls stay visible on all three tabs** (switching a wallpaper to compare while tuning appearance or playback is the common case), and only the tab body scrolls (on the official host the tab body is fixed-height with `overflow: hidden`, so scrolling is ours to manage). **The "Appearance" and "Playback" tabs share the very same renderers as the settings page's tabs of those names** (`ctx.surface === "sidebar"` omits the settings-only groups: appearance's **font / caret / window-and-sidebar** sections, playback's **preparation and diagnostics** rows — out-figure source, live frames, custom frame, fps ceiling, source info and transcode progress), so both places are one set of controls over one state, and a change in either shows up in the other; the active tab is remembered only in `localStorage` (never in `config.json`). To make that possible, 12 appearance/frame handlers (`onAccent` / `onGlassColor` / `onGlassAlpha` / `onBlur` / `onBorder` / `onToggleThemeFollow` / `onScrim` / `onWallpaperBlur` / `onWallpaperOpacity` / `onBackground{Brightness,Contrast,Saturate}`) were **lifted from the `WallpaperPicker` component closure to module level** (the same precedent as the playback handlers before them), and the sidebar's **hand-written** audio group was merged back into `renderAudioTab` (its hints had already drifted from the settings page). The sidebar's footer entry button now **changes its label and target with the active tab**: "壁纸引擎设置 ›" on the wallpaper tab, "字体与更多外观 ›" on appearance and "更多播放设置 ›" on playback; the latter two go through a **transient deep-link request** (`settingsTabRequest` + `openSettingsSection(tabId)`) that lands in a one-shot effect on the settings page running the same `switchTab` (if the automatic open fails, the request is cleared so it cannot hijack the next manual open). The sidebar's own type filter **gained an "image" option** (it previously offered only all / scene / web / video); the list stacks two filters ("the settings page's type filter first, then this one"), and when both are set to something other than "all" and the list comes back empty, the empty state names **the upstream filter** (otherwise it reads as "the library has no such wallpapers"). And the sidebar no longer collapses to a single sentence when loading or scanning fails — those two states now occupy the "Wallpaper" tab only, while Appearance and Playback stay reachable.
  **Verified**: `verify-scene-live` gained 18 source assertions (five type options present plus a negative control with one removed · all three tabs present and the **tab bar's position** between rotation and the footer · the remembered tab staying out of settings · sharing the settings renderers with zero hand-written controls in the sidebar · six surface gates · handlers lifted to module level · **the sidebar ctx covering every field the renderers destructure**, both provided fields and setting-only placeholders · no bare writes · the deep link carrying a tabId and clearing on timeout), and it now **renders each of the three tabs once against the real source** (React and the store stubbed, the renderers real): all three render, each draws its own content, the footer label follows the tab, the "go pick one ›" empty state appears, plus a **wiring assertion** that walks the three rendered trees poking every handler — no settings-only placeholder may appear in them (negative control paired). `verify-fontset`'s panel harness gained a surface assertion: **the default and `"settings"` are byte-identical** (the settings shape loses not a single node), the sidebar shape omits only the groups it should, and the empty-state CTA differs between the two. The i18n dictionary gained 7 entries.
- **The Appearance page gained "Left sidebar override" (off by default, right below the Glass opacity slider) — the native left column can finally be driven by the glass recipe**: while a wallpaper is active the host's native left column (the session / workspace column) used to be a **transparent hole**: the plugin sets `--dsw-specific-sidebar-fill` to `transparent`, so that column showed the wallpaper **raw** — no frost, no base tint, and none of the theme knobs (Accent / Glass color / Glass opacity / Frost / Border) reached it, unlike every other panel. With the switch on the column gets the **same recipe table as the other panels**: glass colour (the clamped readability base) @ glass opacity composited above the readability floor + Frost (`--we-blur`) + Border (the hairline divider goes through `--dsw-alias-border-l3`; the wallpaper token mapping only took over l1/l2 — which is exactly why the Border slider never touched this column) + Accent (mapped onto `--dsw-alias-interactive-bg-hover` / `-accent` / `state-business-primary` / `brand-*`, i.e. the selected / hovered rows, badges and emphasis text). Off = byte-identical to today (proven both ways: the switch alone without the wallpaper anchor also leaves the column untouched). The no-backdrop-filter and software-rasteriser tiers fall back to the established near-opaque (92%) plate with an explicit `backdrop-filter: none`. **Anchor**: the column only carries CSS-module hash classes (the harness's `pI_x6G_sidebarCol` / `hHd-Xa_root` — build hashes that drift, unusable), but the **slot outlet** `[data-slot="sidebar"]` (same mechanism as the settings window's `[data-slot="settings.section"]`) is its **direct child**, so `div:has(> [data-slot="sidebar"])` selects the parent; ⚠️ the glass cannot be painted on the outlet itself — it carries `display:contents` (the slot renderer's ANCHOR_STYLE), generates **no box**, and would paint nothing.
  **Verified**: a **four-state probe** on a real harness (isolated HOME, headless page — `compat-harness-pages`: bare page / wallpaper anchor only / anchor + switch / switch removed): the anchor resolves uniquely (`matches=1`), the default tier reads `rgba(0,0,0,0)/none`, the switch tier reads `color(srgb 1 1 1 / 0.571) + blur(16px) saturate(1.3)`, and removing the switch restores every field verbatim. Plus a **pixel A/B on a real wallpaper** (synthetic 1920×1080 test image + host `PUT /settings` flipping the real setting): across the left column's red/green boundary the max horizontal gradient went **145 → 5** and the gradient RMS **11.2 → 1.17** (≈9.6× softer), while the centre control region changed **0%**; `verify-readability`'s F2a surface table gained two rows (the left column is a large text-bearing surface that looks straight at the wallpaper, so it must carry the floor) — 27 surfaces, all passing.
- **Glass-tint floor: a custom hue reaches the dialog and sidebar for the first time**: #82's readability base used to be **theme white/black** (light `#ffffff` / dark `#0d1524`) at a fixed 45%/59% of the surface recipe that no slider could move ⇒ a user's custom glass colour was squeezed down to ~10% at best ("dark looks black, light looks white" in the dialog). The base is now **the glass colour clamped for luminance, per theme** (dark that is too bright gets darkened, light that is too dark gets brightened, targeting 4.6:1 to leave headroom for hex quantisation) — the hue follows the user while the clamp keeps #82's ≥4.5:1 body-text criterion; **the white glaze on the composer and message bubbles (`rgba(255,255,255,…)`) moved to a semantically identical tinted glaze in the same batch** — every text-bearing surface in the conversation area now follows the custom hue as one family; `verify-readability`'s grid was upgraded accordingly to **glass colour {black / mid-grey / white} × slider × theme × wallpaper opacity, all combinations ≥4.5:1** (the old grid only tested a single white frost point, so it was blind to dark custom colours).
- **Cranking glass transparency no longer "turns everything black and white"**: the lower bound of the slider's mapping curve moved from 0.03 to 0.10 — under the tinted floor the old curve drained the glass colour's share to ~1%, leaving only the theme base (the "crank it up and it goes black/white" report); at full transparency a visible layer of frost now remains while wallpaper transmittance still rises monotonically.
- **The settings page gained an "About" tab (the fifth, placed last)**: its four sections appear **in order** — ① a short project introduction; ② this repository's URL plus "⭐ Star it on GitHub" (a real link, new window, `rel=noopener`, with a **selectable, copyable bare URL** beside it — whether an external link can wake a browser inside the desktop shell is not the plugin's call, so this backs up "I clicked and nothing happened"); ③ **two QR codes** for the community groups (QQ and Douyin); ④ the contributor thanks **closing the page** (listing what oneincase / YV3507 / yuxilao / Jerry and the rest contributed, ending on the 💌 line). The order is an explicit requirement, pinned by a guard that compares first-occurrence indices (wrong order or a missing section both fail, with controls on both sides). It is the only tab that **reads no panel state**: it writes no settings, emits no notifications and holds not a single form control (the guard pins that semantics: the slider-row count must be 0). The two codes are **bundled PNGs** (`lib/about/qq-group.png` / `douyin-group.png`, collected by `package.json`'s `files`), served directly by the plugin's own route `GET /wallpaper-engine/about-qr/<filename>` (allowlist + ETag/304, so swapping a code needs no rebuild) — **not** inline base64: that version pushed roughly 240 KB into `lib/client.js` (parsed on every cold start for characters unrelated to this page's logic), whereas as static files the bundle returns to its original size and swapping a code means replacing a PNG. The "Contact" sections of the Chinese and English READMEs reference **the same** files (what is displayed and what the plugin serves are the same bytes, with no second copy). Derivation recipe: keep only the code area (cropping the in-image title, group name and number — those are carried by the card and README headings), scale to 520 px wide, 128-colour palette; that is why the two codes match in size and align side by side in the panel. **Verification**: the derived images were upsampled back to the source resolution and compared pixel by pixel — mean channel difference `0.90 / 0.72`, 99th-percentile difference `9 / 8`, binarised agreement `99.3% / 99.7%`; scanning the **derived** QQ code with macOS Vision yielded `https://qm.qq.com/q/yxDL6BdsFW` (the Douyin code's dotted, gradient decoration defeats Vision even on the **source** image, so its verification stops at structural fidelity — scan with a real phone after swapping a code).

- **Whole-window white (near-grey) frames on minimize/restore on the Windows desktop client are fixed**: the minimize animation, the taskbar thumbnail and the instant after restoring could show a **solid white** plate (a light grey under the default dimming) instead of the wallpaper. Mechanism: the wallpaper layer is an ordinary `z-index: -2` child of `body` (its pixels live in the root frame's raster), and while a wallpaper is active the plugin turns the base token `transparent` — so any window/tab state change can reveal the **window base plate** (Electron's `backgroundColor` defaults to `#FFF`) plus the host `body`'s white fallback whenever the root frame cannot get that layer. Fix: while a wallpaper is active the **root element** carries an opaque **wallpaper representative colour** (new `--we-wallpaper-underlay`) — the canvas background is the last layer on the compositing chain that "does not depend on a raster, filled directly by the compositor". Resolution order: **the most-occupied colour of the picture** first (sampled 64×64 straight off the already-decoded video / canvas / img leaf inside the layer — no extra request, no extra decode), then the author / panel scheme colour (an author `0 0 0` counts as *unfilled*), and nothing when neither exists (back to transparent). A dropped layer therefore degrades from "white flash" to "a tone-matched solid". The same round added a **two-frame re-composite nudge** on becoming visible (only in the hidden → visible direction, never a permanent compositing layer) and an **on-screen trace** (layer geometry + leaf ready-state + frames presented + "next frame presented at +N ms", the latter via rVFC rather than a timer) for problems that only reproduce in a specific window state and that intent-level logs cannot answer. **Measured** (headless Edge, the real artifact, page structure copied rule-by-rule from the host frontend): with the media leaf not painting, the centre pixel went from `rgb(191,191,191)` before the fix (the host's white base pushed through the default dimming) to `rgb(150,30,42)` — that video's own dominant colour, i.e. the sampling leg beating the author colour; with the wallpaper on screen the two builds are pixel-identical (no side effects). **One shell-side follow-up remains upstream** (option ① of the report): the desktop shell sets a transparent base plate for darwin windows only, and its win32 `BrowserWindow` passes no `backgroundColor`, so that plate stays white and still shows when the window has literally no frame to submit.
- **Clearing the shell's canvas base no longer pins a mode name**: it used to clear only the `data-dsh-desktop-mode="extended"` case (where the shell paints `.dshDesktopFrame` opaque and covers the wallpaper whole). Mode names and the gated set evolve with the shell, so pinning one name turns "the wallpaper is covered" into a silent regression on the next shell update — now the base is cleared whenever a wallpaper is active (a no-op in compatibility mode, whose baseline is already transparent), and the guard has teeth in both directions: a missing clear fails, and writing a single-mode gate back fails.
- **The dead `data-we-appwindow` marker is gone**: it was left over from the "immersive window automatically drops the frosted blur" round (its CSS consumer was removed when full frosted glass was kept), and had been write-only since — while its test (`outerWidth === innerWidth`) is exactly what misfires on a frameless desktop-shell window. The attribute went away with its consumer, so neither the DOM nor the diagnostic surface keeps a hook nobody reads.

- **Large scene wallpapers now take the host's own media origin (performance)**: **Scene payloads (`scene.pkg`, often 70–90 MB) now use the host's own dedicated loopback media origin too** (web wallpapers already did). `/inventory` gained `sceneMediaBase` (gated on "the library really holds a live-renderable scene"; an empty string when the media origin is unavailable), and the client's `liveRenderUrl` consumes it instead of **hard-coding `location.origin`**. **Two things not to misread**: ① the renderer page itself stays on the app origin (it **must** be same-origin — the parent drives it through `frame.contentWindow.__wp`), so the speed-up has a ceiling; ② this is a **transport-path improvement, not a security fix**.
- **The media origin now answers the root `/diag` (observability)**: the renderer's diagnostic beacon posts to `{mediaBase origin}/diag` — once `mediaBase` points elsewhere, that root path must exist on the media origin too, otherwise a first-frame-timeout report loses the renderer's warnings to a silent 404. The diag family therefore hands `handleDiag` to the media origin through an out-parameter, so both mounts share **one** ring buffer (there is a single `/diag-log`).
- **`/scene-files` gained a second fence layer (security hardening)**: the target file's **real path** must now still be inside the wallpaper directory — `lstatSync` rejects links plus a **`realpathSync.native`** containment check, and that layer is **fail-closed** (anything other than "does not exist" is fenced). Measurement confirmed that **JS `realpathSync` does not resolve junctions on Windows** (`.native` does), which is why this layer must use `.native`. (**Residual**: `dirSceneAccess` in `lib/scene-manifest.js` is still junction-blind; it belongs to a different route family and was left alone.)
- **UI localisation (following DSH's language setting)**: the plugin UI is wired into the host's `locale` service (`@deepseek-ai/dsh-client-locale`, shipped with dsh-web-app), with a **language catalogue identical to dsh web** (built-in `zh` / `en`; language packs added through the official `addLanguage` are followed too) — a user switches once under Settings → General → Language and the plugin UI follows **immediately**, with no page reload. Implementation: `src/i18n.js` (the lookup layer: an optional service plus a short poll, staying on Chinese when the service is absent) + `src/i18n-copy.js` (an English dictionary keyed by the Chinese source text); a language change re-renders through `useWeLocale()` subscriptions in top-level components, DOM patches (the settings nav icon, the settings-entry anchor) replay through `weOnLocaleChange`, and the host's slot / tab / shortcut registration surfaces read their labels through thunks. Copy the host half returns for display (route replies for uploads, font sets, asset paths and so on) is substituted by the client at the display site through the same table — the host route contract is unchanged; host messages that **concatenate at runtime** (`unsupported format: ` + extension) are not covered. New guard `test/verify-i18n.mjs` (no bare Chinese / two-way dictionary reconciliation / value discipline / runtime following / top-level subscription contract, each with negative controls) and the scanner shared with the migration, `test/tools/i18n-scan.mjs`; the `npm run verify` chain gained this link.
- **`verify:bridge`'s "environment skip" (CI going red)**: on windows-latest this end-to-end check can show "artifact sha256 correct, process alive, no `hello`, both streams empty" — which looks **exactly** like a middleware/protocol regression, but has the opposite disposition (the former is an environment difference, the latter must fail), and raising the bootstrap budget from 25 s to 90 s was measured and disproved (90 s does not help on the runner either). The self-check now, on a failed handshake, first runs an **active probe** (one trivial call against the same artifact, to see whether it responds) and **verifies artifact trustworthiness** (is the sha256 the published artifact's?): only when "the probe also says this environment cannot execute it **and** the artifact is trustworthy" is it recorded as an **environment skip**, and the log ends by naming that "this channel had no assertion coverage this time" (never passing itself off as a pass); if the probe says it can execute, or the artifact is untrustworthy, it still goes red — so "this environment cannot run it" no longer blocks unrelated PRs, while a genuine regression cannot slip away. The host-side failure line also gained **the first non-protocol line of the subprocess's stdout** and **the spawn style actually used** (that line used to carry only stderr plus a "hello timed out", while in such a scenario stdout is the one stream that might still speak).
- **Failure memory carries a "pipeline identity" (old verdicts are no longer reused across pipelines)**: `sceneLiveFailures` says "this wallpaper could not produce frames **on that pipeline**", and it is the **only** source of the panel's "live rendering failed (…) fell back automatically" row. After the bundle changes, or after the host finally exposes a scene media origin (`sceneMediaBase` going from an empty string to a loopback origin), the old verdict should be voided once — the client now records the pipeline identity (`LIVE_DIAG_BUILD` plus whether a media origin exists) in `localStorage.weLivePipeline`, checks it at startup **after settings have landed**, and on a mismatch clears that batch of memory and rebuilds back to live (no need to toggle "scene live rendering" by hand). The predicate is **one-way**: only "the bundle changed / the media origin went from absent to present" clears, never the reverse (a source that merely jitters wiping real failure memory would be worse). **The measured motivation**: a `timeout` left behind when the host half was not reloaded makes "the client is updated, the host is old" look as if the fix did nothing at all.
- **The "first-frame timeout" false verdict on large scene wallpapers is fixed (usability · driven by on-machine measurement)**: field diagnostics showed `scene.pkg` measuring up to **336 MB** (not the 70–90 MB the documents assumed), while **the first frame cannot arrive before the whole package does** — three client instances mounting the same package starve each other's transfer, so the visible one was judged "first-frame timeout" after 15 s with `stats={"fps":0,"running":false}` (not a single frame) and that verdict was written into the failure memory **shared by every window**. Five corrections: ① the first-frame budget became `15 s + package size ÷ 8 MB/s` (capped at 90 s, the size supplied by a new `/inventory` field `scenePkgBytes`); ② the host gained a **payload transfer ledger** (new route `GET /wallpaper-engine/scene-payload-progress?token=…`) that the client polls each tick, and **while bytes are still climbing the timeout does not count** (an unknown ledger or an old host falls back to the wall clock); ③ **hidden / non-playing instances do not pull the payload at all** (the `src` is assigned late when the layer is built, detached to `about:blank` when the page goes to the background to abort in-flight requests, and restored when visible; the layer key does not include this state ⇒ no rebuild, with the poster present throughout); ④ **failures are split by cause**: when the ledger says "it transferred but never finished" only a **session-scoped** soft failure is recorded (not persisted) with an automatic retry after a 45 s cooldown (at most 2), while only a renderer page that truly produces no frame, or a runtime disconnect, writes the shared memory; ⑤ **`scene.pkg` is revalidatable** (`ETag` (size+mtime) + `Last-Modified`, so a hit is a bodyless 304; the entry HTML stays `no-store`) — a package of hundreds of megabytes was re-read from disk every time the live layer was rebuilt, and this removes it.
- **Scene payloads are no longer gated on the adapter shape (performance fix)**: `mediaOriginNeeded()` gates **the web wallpapers' capability-header fence**, while the reason a scene wants its own origin is **bandwidth** — so in the native-browser shape `sceneMediaBase` was permanently an empty string and large packages necessarily took the app origin that starves (on-machine log: the same 336 MB package arrived in 0.6 s on the media origin, while on the app origin it showed 15–74 s and sometimes never returned). Scene payloads now lazily start the media origin unconditionally (falling back to the app origin only if it cannot start), and the client's layer key includes that cell ⇒ once the host exposes it, the renderer page is rebuilt; before retrying a transfer-class soft failure the inventory is refreshed once, which specifically cures "this instance's inventory is stuck from before the media origin came up".
- **Two hard defects in diagnostics**: `client-boot` (the only line carrying the page id / window mode and able to answer "how many client instances are running right now") **never reached disk** — it called `liveStateBrief()` → `selection` (`const`, still in its TDZ) at the top of the bundle, and the exception was silently swallowed by an outer `catch {}` (measured: 0 occurrences in 2495 lines across two diagnostic files); it now reports one tick later. `liveFail`'s scene also gained **the payload ledger reading / the media-origin origin / the first-frame budget / the in-flight tick count**, so the next such problem does not have to be reasoned out.
- **The pre-warm renderer page leaked during the startup wait is fixed (complementary to ③ above)**: assigning `src=about:blank` to a **detached** iframe **does not commit a navigation** — so the pre-warm page kept an entire WebWallGL engine resident until the session ended (measured on this machine: one leak left **9 4K engines** alive for an hour, an amplifier for "large packages all get slower after switching a few wallpapers"; ③ handles the visibility pause of **mounted** layers and cannot reach this never-mounted pre-warm page). It is now mounted hidden so the navigation really commits, and the empty shell is removed afterwards; a connected (adopted) frame is still never touched.
- **Host error strings leaked Chinese into the English UI (a missing re-lookup at the display site)**: a host `error` string is **runtime data**, so the client must pass it through `weT(...)` again **where it is displayed** — and the font-set chain did not: `lib/routes/fontsets.js` answers in Chinese (e.g. `字体集数量已达上限`), `fontset-store` stores it verbatim in `fontSetError`, and `src/fontset-editor.js` drops it straight into a sentence ⇒ the English UI showed `Font sets unavailable: 字体集数量已达上限`, while the English entries the dictionary had long carried for exactly those strings could **never take effect** (dead entries). The same datum even had two display sites that disagreed — one re-looked-up (`src/client.js`), one did not (`src/quick-panel.js`). Four display sites are now fixed (`fontset-editor` / `quick-panel` / `picker-props-panel` / the `client.js` one whose message is wrapped in an `Error` yet rendered into the wallpaper-properties panel) plus one dictionary entry; `verify-i18n`'s "zero missing translations" caught the entry I had forgotten to add.
- **"Theme follows the wallpaper" was documented as having "no switch"**: it is a `kind: 'boolFalse'` switch in `lib/settings-schema.js` — **off by default** and rendered as a plain `switchRow` in the panel — yet all four README / HOW-IT-WORKS files (zh + en) said "no switch, the behaviour is the feature", while this very CHANGELOG had it right. Corrected against the code: **off means the whole colour chain never runs**, which is not the same as "it switches themes automatically".
- **Comments and docs now state current principles only (the archaeology is gone)**: removed the "here is why the thing we discarded was discarded" narrative from 60-odd source files — "the old implementation…", "this used to be buried in `src/client.js`…", `评审 P2-x` review tags, `(a fix for the big-package incident)`, and drift-prone counts such as `1,204 lines` / `116 selectors` / `hand-copied 56 times` — rewriting each into "why the current invariant holds". **Kept**: user-facing copy (the `weT` arguments and assertion names) untouched, measured provenance (writing discipline 2), the accounts of **live** code such as `legacy`, and the ledger narrative in `CHANGELOG` / `archive` / `wip`. The same batch retired seven **prose-reading** assertions (next entry) and fixed three real defects along the way (a red artifact-sync check, a guard whose Usage pointed at a non-existent file, and the closure audit's false positive).
- **Prose-reading assertions retired, with the decision procedure written down (ADR-0007)**: ADR-0006's boundary ("guards that read code stay; guards that read prose are not added") lived **only in prose**, so it failed to stop three things that actually happened: assertions moving on to **copy fragments in the source** (`includes('有能力头栅栏…')`, `includes('ESC 返回')`, `includes(' 档 · ')`); one assertion nailing itself to **a bug** (`includes('/设置|Settings/i.test')` — and that regex was exactly the settings-entry anchor that goes **silently dead** when the host changes language or wording, so "fixing the bug turned the guard red"); and a one-off cleanup's acceptance criterion left **vacuously true** (the typo 「秡」). They are now retired under a four-question test, and the copy assertions were replaced by **mechanism** assertions (the status line must have "three branches, each wrapped in `weT(...)`", mutation-tested to prove it has teeth). **The locale anchor itself was fixed in the same batch** (a candidate set of host labels, plus two exact-value exemptions registered for "match the host verbatim" — our dictionary's `"设置"` is the **verb** sense, so using it as the anchor would have been worse). Retired-line checks: 13 → 10.
- **`test/tools/audit-import-closure.mjs` no longer reports a false positive**: it treated a **data-file read** such as `readFileSync(new URL('../package.json', …))` as a module import, so `lib/index.js → package.json` was reported as "the published package is missing a file". It now judges the two **separately** (only real module imports require `files` coverage; a data read is checked for mere presence on disk) and strips comments first, with a teeth test added (injecting a non-existent import ⇒ `[UNRESOLVED]` and a non-zero exit).

### v1.1.0 (1.0.1 → 1.1.0 · 2026-09-29)

> This install contains everything after **1.0.1** up to **1.1.0** (the commits landed since v1.0.1 `6ba2fae`).

**UI**

- **Theme follows the wallpaper (automatic light/dark)**: after a switch the plugin picks the global theme from the wallpaper — colour order **① the wallpaper's own scheme colour** (`project.json` `schemecolor` / `ui_browse_properties_scheme_color`; an override you set in the **壁纸属性** panel wins, and an author value of exactly `0 0 0` counts as **unfilled** — that is the WE editor's default for new projects and 124 of 360 wallpapers here carry it, so taking it at face value would pin a third of the library to dark; a hand-picked pure black in the panel is still honoured) **→ ② the most-occupied colour of the picture** (64×64 downsample, 4 bits/channel quantisation, modal bucket — only when ① is missing; the author preview and a **real rendered frame** (scene capture / web `__wp.capture`) each vote, and **a disagreement resolves to dark** — light only when both agree; a capture can land on a not-yet-settled frame, and "should be dark but came out light" is the error the eye notices) **→ ③ neither available ⇒ leave the theme alone** (no thrashing). The verdict is a WCAG relative-luminance threshold of **0.40** ("only clearly bright colours get a light UI"; not mid grey 0.2159 — the author colours in this library have a median luminance of 0.214, so a mid-grey threshold cuts through the densest part of the distribution (27 wallpapers within ±0.05), and saturated mid-tones end up "light" while the eye reads them as dark). **Off by default** — a switch at the top of the "Appearance → Theme" section (setting key `themeFollow`); when on, the behaviour *is* the feature; when off, all six entry points idle (no colour sampling, no verdict, no theme write, no bookkeeping) and the yield marker / vote ranking / status line it had written are cleared. Three self-imposed rules: **nothing is written when the verdict already matches the current preference** (`setTheme` persists the preference into the profile's `cordis.patch.yml`, so without de-duplication a rotation list mixing light and dark wallpapers would rewrite that file on every switch); **changing the theme by hand in DSH stops it for the current wallpaper** (re-evaluating the same wallpaper will not take it back) and **the next switch resumes it**; when the host provides no `theme` service the whole thing stays inert and never throws. Along the way a dead pipe got fixed: the host had been sending `schemeColor` all along while the client never consumed it, so the first-frame poster fell back to a CSS variable — it now uses the author's colour.
- **Adapter mode (「适配目标」)**: the **高级** tab gained an **「适配」** section that works out which of **a plain web browser / the unofficial desktop client / the official desktop client** the plugin is running in, shows 「检测到：… · capability header present / absent」, and lets you override it — **a manual pick wins over detection**. Detection is **OS-independent**: the host observes **request headers and the UA** (the `x-dsh-desktop-renderer` header ⇒ unofficial desktop client — measured to be injected only by the community shell `DSH Desktop.app`, with zero hits for that literal in the official `DeepSeek Harness.app` `app.asar`; `Electron/` in the UA ⇒ desktop shell; neither ⇒ plain browser) and latches what it sees **without ever unwinding it**, so a health probe before the first frame cannot demote a known desktop back to the browser (a wrong "browser" verdict is what makes a web wallpaper answer 403). It drives four behaviours: ① whether a **web wallpaper payload** uses the dedicated media origin or the app origin — a plain browser has no fence, so no second loopback listener is opened, and that relative-path shape is asserted by its own guard; ② **desktop-shell material rules** (`data-dsh-desktop-mode` / `data-we-mica`) are gated on `[data-we-adapter^="desktop-"]`, so a browser session never inherits them; ③ **「窗口失焦时暂停」 is only offered on the browser target** (a desktop shell that lost focus usually still shows the wallpaper, and pausing would freeze a **visible** picture; the stored value survives and resumes when you switch back); ④ **panel rows appear per target with a stated reason**, and a manual pick that contradicts detection spells out the consequence (browser picked while a header is observed ⇒ 403).
- **Settings tabs reorganised**: the 「字体」 tab merged into 「**外观**」, 「玻璃」 was renamed to 「**雾化**」, and the adjustment controls were regrouped by purpose (appearance / effects / sound / advanced) — the six tabs stay 壁纸 / 外观 / 吉祥物 / 效果 / 声音 / 高级.
- **Font sets (a whole typography look as one preset)**: custom typography is now organised in **sets** — a preset ships with the plugin, and you can **create (from the current look) / rename / delete**; editing any font item lands **only in the current set**, and 「restore」 puts that set back the way it was (a set you edited is marked 「已改」 and "use" reads the whole set back). **Export / import** a `.json` (export opens the system **Save as** dialog; import validates the version tag first and names the reason for a bad file). The UI only says *which* set is in use — it never reveals whether a set shipped with the plugin.
- **「Only modified」 is on by default**: the typography-role table initially lists just the roles whose size / weight / family you changed (with an explicit line when nothing is modified yet), and the whole block is now part of "custom typography" — turning the master switch off collapses it.
- **Wallpaper-switch transitions (7 options)**: cross-fade / push / wipe / iris / zoom / strip / blinds; **hard cut by default**, shared by manual selection and automatic rotation; type / direction / speed tier are **whitelisted** (unknown values fall back to the default). 「条带」 (strip) became a real venetian blind this round — the previous implementation was visually indistinguishable from 「擦除」 (wipe).
- **The live-frame row** is no longer gated by the live-rendering switch (you can re-capture at any time) and shows a **thumbnail of the current wallpaper's live frame**.
- The transition options moved into a **dropdown**, and two redundant panel hints were removed.
- **「启动延迟」 renamed to 「启动最长等待时间」, and the value is now a cap**: the delay period still preloads (so the first frame warms up), the live picture is swapped in **the moment the first frame is ready**, and at the cap it is swapped in regardless; the options read `立即 / ≤3s / ≤5s / ≤10s`.

**Logging & notices**

- **The terminal reports problems only by default**: host output is folded into three levels (the level
  name *is* the logger method name) — `error` (breaks the plugin / DSH / system), `warn` (degradation,
  fallback, a fence rejection, a first-frame timeout — anything that **affects what you see**) and
  `info` (everything else: per-texture lines, heartbeats, the autosize gate, preparation probes, the
  log-side trace of a success). **Only `error` + `warn` are mirrored to the terminal**; `info` appears
  only with `DSH_WE_LOG_LEVEL=info` (values `error` / `warn` / `info`, default `warn`). Before this,
  every renderer report and heartbeat went straight to the terminal (measured at ~18 lines/minute).
- **Success notices moved to their own channel**: one terminal line, `[wallpaper-engine] … ✔` ("wallpaper
  media origin listening", "scene wallpaper ready") — the **same prefix as the log lines**, with the `✔`
  merely marking "this is a success, not a problem". **At most once per kind per session** (an HMR remount
  does not resend it); not through the logger, without a level, not written to disk. It only appears when
  stdout is a terminal — the DSH Desktop host is started by Electron over a pipe (`isTTY` is false), so
  Desktop is quiet by default; `DSH_WE_NOTICE=1` turns it on, `=0` silences it permanently, and only a
  **failed delivery** produces one `warn`.
- **Every reporting endpoint now declares its own level**: client `[we-live]` diagnostic lines carry
  `&lvl=` on the same-origin pixel request (an unknown or missing value falls back to `info`); the
  **renderer page** (the shipped WebWallGL artifact) used to feed its level to the browser console only
  and drop it from the request; as of the renderer 2.0.2 sync the page declares `&lvl=` itself (computed
  from the **same failure table the host uses**), and the host's `levelForReport` always takes the
  sender's declaration, falling back to that table only when it is missing. The local patch used in
  between was removed with 2.0.2. The rotation-prep
  first-frame timeout moved from a bare `console.info` onto the same channel and is tagged `warn`.
- **The diagnostics file has a cap**: `~/.dsh-wallpaper-engine/diag/http.jsonl` rotates to
  `http.jsonl.1` at 8 MiB (one generation only); `/diag-log` and the per-line JSON shape are unchanged.
- **Client-side exceptions are traced too**: a render-time exception in the panel used to show up only as
  a blank UI — and on that machine DevTools cannot be opened, so the diagnostics buffer held nothing.
  `error` and `unhandledrejection` now write the message plus the first three stack frames into the same
  diagnostics channel (tag `client-error`, level `error`); search for `client-error` first when triaging.
- Details and the gate commands are in [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md), "Terminal output:
  problems only by default".

**Fixes**

- **A native confirmation dialog left the wallpaper paused for good** (no upstream issue; reproduced on
  the real machine): `window.confirm` hands focus to its own window, so with "pause on window blur"
  (`pauseOnBlur`) enabled the wallpaper stopped the moment the dialog appeared; the modal also **blocks
  the render thread** (an input box receives no keys), and the `focus` event on dismissal is **not
  guaranteed to arrive** ⇒ the occlusion decision stuck on "window blurred" and only a page reload
  recovered it. The decision is now also **re-checked on a low-frequency timer** (3 s, emitting and
  logging one `occlusion-recheck` line only when the decision changes), and deleting a font set moved to
  an **in-panel confirmation** (no native dialog).
- **Buttons and links are no longer different sizes**: the class shared by 「rename」 (`<button>`) and
  「export」 (`<a>`) used to pin only the `<button>` box — an `<a>` defaults to `inline` (an **inline box
  ignores `height`**), `content-box`, a non-inherited font, and an underline. The class now holds for
  both element kinds (`display` / `box-sizing` / `font` / `line-height` / `text-decoration` all spelled out).
- **Stutter when switching away during the boot wait**: the not-yet-mounted iframe is a **running renderer page**, not a plain element — nothing terminated it on a wallpaper switch, so it kept fetching the package / decoding textures / uploading in the background, on the same main thread as the new wallpaper's own startup. `applySelection` and unload now clear its timer and **abort** it (`src=about:blank`); the mount path also arms the heartbeat once (the `load` handler only arms it when mounted, and a delayed frame's document may finish loading before that — which would leave `we-live-on` off forever). Guard: `rotation-prepared-leak-smoke` cases Q1 / Q2 / Q3 (each with a failing control).
- **No more black screen when a scene wallpaper is activated for the first time**: on a wallpaper's **first** activation the live-captured frame does not exist yet (this live session has to backfill it), while the placeholder tried 「captured frame」 as its only source and **silently kept a near-black theme colour** on failure ⇒ a black screen until the first frame. The placeholder now takes **live-captured frame → the author's packaged preview image → the theme colour**: the preview is **only a stand-in** (never "guessing a picture on the author's behalf" — `/scene-frame`'s empty-state semantics are **unchanged**, not a byte on the host side) and is displaced the moment the live first frame lands; guard `rotation-prepared-leak-smoke` cases P / P2 (positive / negative controls paired).
- **Fixed the "collapsed right sidebar still shows a glass plate on harness 0.1.7" bug (upstream issue #107)**: the host's right-panel container keeps its **width while collapsed** and paints no background of its own, while the plugin painted it unconditionally ⇒ a mid-grey slab across the right of the conversation area (zero console errors, easily mistaken for a theme problem). Every rule that paints that container (including the `.cm-editor` / `.xterm` content surfaces and the software-render fallback) is now scoped to `[data-sidebar-right-open]`, plus an explicit closed-state clear; guard `verify-host-paint-scope`.
- **Removed "beta scene animation"**: the `betaSceneAnim` switch, the host `/scene-anim` and `/scene-anim-progress` routes, the client-side upgrade queue / progress polling / probe `<video>`, and the worker's multi-frame rendering and APNG output are **all deleted** (WebWallGL live rendering supersedes it); `verify-client` gained a **reverse probe** asserting that route never comes back.
- **Resource leaks fixed (12 findings from the audit)**: scene-anim teardown, probe videos, listeners, timers, polling guards; host-side resources and cache caps too.
- **`sceneVideo` made honest**: only emitted when the wallpaper really embeds an MP4; added a follow-up fetch for ordering, and it no longer enters the layer key while live rendering.
- **The poster static frame showing through at high wallpaper opacity**: the fade-out backing colour is now native pure black / white.
- **An unterminated CSS comment swallowing the `.we-layer` rule** (video wallpapers dropping to the bottom of the page / scene wallpapers covering the text layer).
- **The wallpaper being covered by the shell canvas in extended mode**: the opaque background on `.dshDesktopFrame` is cleared.
- **Fallback for the enhanced-mode left workspace on Win10 (no Mica)** (upstream #73).
- **Glass did not fall back under software rendering** (upstream issue #95): a *syntax* check such as `@supports not (backdrop-filter)` stays true when the syntax is supported but rasterisation never happens ⇒ the fallback never fired and panels stayed too transparent. Added `detectSoftwareRender()` (no WebGL context ⇒ software; otherwise match `UNMASKED_RENDERER_WEBGL` / `VENDOR` against swiftshader / llvmpipe / …) and a `?we-glassfallback=on|off` manual override; the fallback now also covers the composer card's `::before` carrier.
- **Text-surface readability floor** (#82): text-bearing surfaces get a theme base colour layered on top (`--we-readability-floor`, 0.45 light / 0.59 dark) — the wallpaper may be dimmed and faded, the body text stays at ≥4.5:1.
- **The input-card blur moved onto `::before`** (#89 / #94), restoring viewport positioning for fixed descendants.
- **Cross-platform fix for the ffmpeg child process cwd** plus a robustness audit.

**Dependencies & guards**

- Adopted upstream PR #87's `js-yaml` constraint in minimal form (a non-reachable vulnerability).
- Packaging-whitelist regression assertions (`verify-package-files`), covering every runtime module under `lib/**`.
- **Three publish-face strengthenings (v1.1.0)**:
  - **`scripts/prepare.mjs` is now shipped**: `prepare` really does run when the plugin is installed from git, or when the packed artifact is executed as a *root project* (unpack, then `pnpm install`) — shipping the script without it means `MODULE_NOT_FOUND` the moment it runs (reproducible by unpacking the published package and running `pnpm install` in it). Follow-ups: `verify-package-publish` ⑦ no longer treats `prepare` as a repo-only script (its target must ship), and ② opens its dev-directory allowlist for exactly this one file — `src/` `scripts/` `test/` `docs/` are still rejected everywhere else.
  - **Every relative import target of the reachable closure must exist on disk** (new assertion + negative control in `verify-package-publish` ①): an import pointing at a file that is not there is a dead path locally — nobody trips over it until it is installed on a user's machine and blows up as `ERR_MODULE_NOT_FOUND`. The npm **1.0.1** artifact was exactly that (`./scene-script-apis.js`, imported by `lib/scene-scripts.js`, never shipped). The same rule now also runs as **P7** in `verify-package-files`: every runtime module under `lib/**` is scanned, not just the closure reachable from `lib/index.js`.
  - **Version `1.0.1 → 1.1.0`**: the published 1.0.1 cannot be overwritten and no longer matches this repository, so only a new version carries the current code to npm.

**Docs & repo housekeeping**

- Planning documents brought into the repo (`docs/`); the **static-frame rendering line is archived** under `docs/archive/static-frame/` — that line's renderer, like the beta scene-animation line's, now lives in the standalone repo [`YV3507/we-static-frame`](https://github.com/YV3507/we-static-frame) (offline scene → a single PNG, usable as a library or CLI) and **will be removed by other contributors in the next update**.

**Removals / behaviour changes**

- **The static-frame line is gone**: the offline scene renderer, main-texture extraction, the compositor and
  the "static frame" prewarming job were **deleted** (~10k lines). A scene wallpaper now has only two
  out-figure sources — **live frame** (captured from the running render, preferred) and **custom frame**
  (a screenshot you imported); with neither, it stays **honestly empty** instead of guessing an image (a
  guessed image is blurry and hides the decidable fact that this wallpaper has no usable picture).
  Also: `?v=1/2/3` tiers are retired (old values simply mean "auto" — **no migration needed**); the frame
  cache key was renamed/bumped (old caches expire; the only cost is re-capturing a few live frames); the
  panel row "wallpaper picture refresh" became "**out-figure source**" (two tiers).

### v1.0.1 (milestone · 2026-09-25)

> This install contains **0.7.6 + 0.7.7 + 0.7.8 + 1.0.1**.

- **"Extended mode" compatibility fix**: fixed wallpapers not showing in extended mode, and wallpapers that "work for a few seconds and then fall back to a static image / preview image" — **wallpapers and every effect now work in all three window modes** (compatible / enhanced / extended), with no need to switch modes.
- The in-app notice was bumped to 1.0.1: the "extended mode not supported yet" warning is gone; a new Tip states that some settings-panel options not yet in effect are upcoming work that will open up as updates land.

### v0.7.8 (scene-wallpaper live rendering goes fully live)

- **Scene-wallpaper live rendering engine**: WebWallGL live rendering is wired in, and 90 %+ of scene effects render fully in real time; the rare wallpaper that cannot render live automatically falls back to the static-frame pipeline (millisecond output + background prewarming) — no black screen.
- **Mouse parallax / mouse perspective**: scene layers shift as the mouse moves; perspective / depth of field change with the pointer in real time.
- **Live particles + water ripples + click interaction**: the particle system runs live (quality tier adjustable on the effects tab); water / liquid ripples; cursor scripts, particle anchors and other click responses (left button).
- **Audio detection (music spectrum)**: on Windows it taps system audio (WASAPI loopback + GSMTC) — **no Stereo Mix, no virtual audio device, no extra wiring**; it also brings Now Playing — track / artist / artwork straight into the wallpaper.
- **Frame-rate cap & playback-state management**: pick 15 / 30 / 60 fps; auto-pause when the window is hidden / minimised / unfocused; auto-pause on battery (all switchable on the effects tab).
- **Full dsh-desktop 2.0.14 adaptation**: fixes plugin load failures after the upgrade, the right-sidebar glass showing a grey plate when collapsed, and the enhanced-mode left grey panel covering the wallpaper; pairing with dsh-desktop 2.0.14 or newer is recommended.

### v0.7.6 / v0.7.7

- **Wallpaper properties panel**: live author-property updates + a narrow card layout inside the drawer; centred name row and other UI corrections.
- **Rotation upgrade**: switch when ready + cross-fade (slowed to a uniform 1.8 s: rotation / GPU still frame → first-frame fade-in / manual wallpaper switches all share one recipe) + node-level adoption for live / web.
- **Media on three platforms**: media-bridge integrated (macOS / Windows / Linux), middleware pinned at v0.1.5 (spectrum semantics corrected + capture follows the default output device); Now Playing artwork with a generic source. Online lyrics were added too: a local `.lrc` / cached copy comes first, and only a missing lyric triggers one lrclib.net query, which sends title / artist / album — hence off by default.
- **Web wallpaper fixes**: a dedicated wallpaper media origin serves the payload (fixes an all-black Desktop), a cross-origin duplicate shim injection that capped the frame rate twice, and the renderer page synced to webwallgl 1.4.2 (including both classes of web-wallpaper white-screen fix).
- **GPU frame capture backfill + geometry validation**: live frames backfilled into the static-frame cache, panel state / clear entry points, a strict gate for CPU rendering; a stored frame whose aspect ratio does not match the viewport is dropped and re-captured.
- **Video wallpapers got 0.7.5's "play on selection" back** (the preview poster and the prewarm probe chain are gone); official asset path (the WE assets directory, host half + client half).
- **Diagnostics workbench**: web-wallpaper "white screen" triage (headless real-browser screenshot + console errors); a render-path black box (client step reporting + host-side log dump).

### v0.7.5

> Upstream v0.7.5's content (`#91` font rework + frame-refresh tiers, `#99` video-wallpaper track volume, glass saturation no longer rising with blur `#98`, …) plus **all of this repository's 0.7.4 content** (see the next section).
> ⚠️ **WebWallGL live rendering (`#103`) and the `lib/webwallgl/` publishing allowlist are NOT in this version** — they came in with the catch-up merge (shipped later in `v1.1.0`); this release's pipeline prefix was `sf33_`.

### v0.7.4 (unpublished — its content shipped inside v0.7.5)

> The 0.7.3 name on npm was already taken by an earlier set of commits and cannot be overwritten, so the version was bumped; 0.7.4 = the 0.7.3 content + #88 (scene static-frame fix series) + the two entries below. **This version number was never published to npm** (`0.7.3 → 0.7.5`); its content shipped with v0.7.5.

- **Composer glass positioning fix** ([#89](https://github.com/elysia395/dsh-wallpaper-engine/issues/89), community PR [#94](https://github.com/elysia395/dsh-wallpaper-engine/pull/94)) — `[data-composer-card]` contains `position:fixed` descendants (`@dsh-external/dsh-webui` mounts the "AI browser" seat inside the card), and a `backdrop-filter` on the card becomes a **containing block** for those fixed descendants per spec — the seat stopped being viewport-anchored, gained hundreds of px of phantom overflow, and the composer was left stranded above the bottom of the scroll. The blur now lives on a `::before` pseudo-element (no DOM descendants → it can never become a containing block), keeping the same radius / `--we-*` tokens — visually identical.
- **Honest sceneVideo field** ([#92](https://github.com/elysia395/dsh-wallpaper-engine/issues/92), community PR [#94](https://github.com/elysia395/dsh-wallpaper-engine/pull/94)) — the inventory used to pass off "static frame available" as "embedded MP4", emitting a `sceneVideo` URL for nearly every Scene wallpaper, so the client's `/scene-video` request was a guaranteed 404. The real probe is now cached by "pkg path + mtime" (bounded LRU, background fill, opportunistic backfill from real requests; unknown stays `null` and is never guessed), and the URL is emitted only when an embedded MP4 is confirmed.

### v0.7.3

- **Custom uploads usable + honest playback state** ([#84](https://github.com/elysia395/dsh-wallpaper-engine/issues/84)):
  - ① `uploads/.meta.json` never recorded a `contentrating`, so uploads used to read as **unrated** while the rating filter defaults to **Everyone** — every custom upload was filtered out by default (absent from the grid, and rejected when the upload flow auto-applied it → blank wallpaper layer + a disabled 播放 button). An upload without a rating now counts as **Everyone**, so your own files work out of the box, while an explicit G / PG13 / R tag still filters normally.
  - ② A refused `video.play()` (autoplay policy, a codec the browser cannot decode such as HEVC/10-bit, or a play() interrupted by the next src swap) used to be swallowed silently: the panel kept saying 「播放中」 and the only control was 「暂停」 — a wallpaper frozen on its first frame with no way to resume. The control now reflects the `<video>` element's REAL state, so it returns to 「播放」 (a working retry) with a readable reason, e.g. "cannot decode this video — use H.264", and it re-issues play() automatically once the media becomes ready.
  - ③ A wallpaper dropped by a filter now says which filter excluded it instead of leaving an unexplained blank.
- **Wallpaper opacity** ([#82](https://github.com/elysia395/dsh-wallpaper-engine/issues/82)) — a new slider in the effects tab (0–90 %, higher = more transparent, default 0 %): fades the whole wallpaper layer toward the page base colour — the IDEA background-image style of "visible but not overpowering". Complements the scrim, keeping text readable.
- **Input caret color** ([#83](https://github.com/elysia395/dsh-wallpaper-engine/issues/83)) — a new **输入光标** section on the typography tab: when the caret is hard to see against the wallpaper, pick a high-contrast color from 6 presets or the custom picker (or **自动** to restore the native dsh caret — 自动 is the default). Applies to every text input and editable area, independent of the typography master switch.

### v0.7.2

- **Prerequisite bump**: targets DeepSeek Harness **0.1.5-rc.1** (DSH Desktop ≥ 2.0.7) and requires **dsh-better-sidebar ≥ 0.19.0**. Update order and rollback: see [`UPGRADING.md`](./UPGRADING.md).
- **Fixes the "right sidebar fully transparent" regression and extends the glass to the native right sidebar**: the harness 0.1.5 native sidebar panel paints `var(--dsw-alias-bg-base)` — the exact token this plugin sets to transparent while a wallpaper is active — and the native panel ships no frosted glass of its own, so after moving to better-sidebar 0.19 the whole right column went see-through. From v0.7.2 the native right sidebar is covered by the「侧栏液态玻璃」adaptation: the same **侧栏模糊 / 透明度 / 玻璃颜色** sliders drive it, and with the master switch off it falls back to the theme's opaque panel colour (no longer transparent). The group is: **侧栏液态玻璃** (master switch, on by default) · **侧栏模糊** (0–200 px, default 16) · **侧栏透明度** (0–200 %, default 120 %, higher = clearer) · **侧栏玻璃颜色** (6 presets + custom picker, default `#ffffff`).
- Follow-up fixes: sidebar colour controls and the content surface had no effect on the official native right sidebar; the sidebar colour mix strength is now a visibility curve independent of transparency.

### v0.7.1

- **Adapted to DeepSeek Harness 0.1.2-rc.1** and verified on **DSH Desktop v2.0.5**: host routes (inventory / media / scene-frame), the first-level settings section, the picker modal, video & scene wallpaper playback, the rope-dock drawer, and the liquid-glass effects all work in both Compatibility and Enhanced desktop modes. The APIs this plugin relies on (slots / webserver / theme variables) were verified unchanged on harness 0.1.5-rc.1 as well.
- **Fixes the rc.1 "swatches / vinyl record render as rounded rectangles" regression** ([#74](https://github.com/elysia395/dsh-wallpaper-engine/issues/74)): rc.1's theme layer ships a new `corner-shape.css` that applies `corner-shape: superellipse(1.5)` (squircle-ish corners) to **every element**, so any `border-radius:50%` circle renders as a rounded rectangle. The plugin now explicitly resets `corner-shape: round` on every circle / pill control it draws (swatches, vinyl record, slider thumbs, toggle knobs, font chips, …); on older harness builds the declaration is ignored, with no side effects.

### v0.6.8

- A stabilization batch for the scene rendering pipeline (solid-layer white boxes / JPEG fallback alpha / clearcolor / `#86` residue / resource-leak regression guards). The `files` allowlist regression that silently dropped a runtime module is now guarded permanently by `test/verify-package-files.mjs`.

### v0.6.7

- **Custom typography** — a new **字体** section in settings. The master switch defaults to off (stock dsh look); once enabled you can tune **font color / weight (100–900) / family** (default · YaHei · KaiTi · SimSun · SimHei · 行楷 Xingkai · monospace, each chip previewed in its own font). Error/danger/warning text keeps its system red; toggling the switch off restores defaults in one click.

### v0.6.4

- **Improved: occasional full-screen white flash in immersive windows** (keeps full frosted glass). Older builds could flash the **whole window white** when you clicked the dialog or typed in an **immersive fullscreen window** opened via a **desktop shortcut** (standalone / kiosk) — under **hardware acceleration**, Chromium's compositor occasionally paints the backdrop white while it re-composites over the wallpaper. **v0.6.4 keeps reducing the compositing layers**: the repo panel is lazy-mounted when closed, the rope has no permanent filter, and the wallpaper media no longer forces a transform compositing layer by default — whilst **keeping the full frosted glass**. Normal browser tabs are unaffected and keep the full frosted glass + hardware acceleration. The plugin shows a one-time notice (once per version) about this.

### Around v0.6.3

- **Mascot (chat pull-cord)** — a draggable cord that snaps along the top edge; pull it down to reveal the **wallpaper library** drawer, with two character forms (maid / orca) and a 0.5×–2.5× size control.
- **Wallpaper-effect tuning sliders** (v0.6.x) — the **壁纸效果** area gains three new sliders: **亮度 / 对比度 / 饱和度** (wallpaper media filter — **亮度 40–160 % / 对比度 40–200 % / 饱和度 0–200 %**, all defaulting to 100 %), alongside wallpaper blur / scrim etc., so any wallpaper can be blended comfortably with the UI. All apply instantly and persist.

### v0.6.0

- **Scene full-scene frames** — Scene wallpapers are fully replayed by a pure-JS scene renderer (object tree / textures / particles / shader effects) instead of a main-texture static frame. Implementation details: [`HOW-IT-WORKS.md`](./HOW-IT-WORKS.md).

### v0.5.x

- **Occlusion pause (battery-saving trio)** — like Wallpaper Engine's "pause when covered": pause the video wallpaper on minimize / tab-switch, on window focus loss, and/or on battery power, dropping the decoder engine to zero; it resumes automatically when you come back (web/iframe wallpapers are only throttled by the browser while hidden). Each toggle persists, and the trio is 「最小化/切页时暂停」 (on by default), 「窗口失焦时暂停」 (off by default) and 「使用电池时暂停」 (off by default); the scene live render pauses its render loop on the same conditions.
- **Decode frame-rate cap (frame-skip transcode)** — high-fps sources (e.g. 4K120 H.264) are the dominant GPU cost (~60% Video Decode at 1.0x on a 4060). The host re-encodes the wallpaper ONCE with ffmpeg to the capped fps (timeline stays 1.0x normal speed, fully decoupled from 倍速) as **4K-preserving AV1**, with a **live download/transcode progress bar**; measured 4K120→24fps drops GPU from ~60% to **~15%**. ffmpeg is provisioned in three tiers: explicit path → auto-download (npmmirror + GitHub dual-source race) → system PATH. The tiers are unlimited / 60 / 48 / 30 / 24 fps, and a source already at or below the cap is skipped; the cache key is "path + mtime + cap", so rotation pays once per wallpaper; transcoding prefers **NVENC** (`av1_nvenc` → `h264_nvenc`) and falls back to **libx264 software encoding** without an NVIDIA GPU; only a missing ffmpeg auto-disables it and leaves the wallpaper on the original.

### v0.4.1

- **Media-stream handle fix + async scan** — media/preview/scene-frame streams now release their file handles immediately when the client disconnects (fixes handles accumulating with every wallpaper switch/refresh, and Windows locking that prevented deleting/moving a wallpaper file). The wallpaper-library scan is fully async (fs.promises thread pool), so it no longer blocks the event loop (noticeably faster startup on WSL / big libraries).
- **WSL support** — Steam roots mounted under `/mnt/<drive>` are auto-detected, so a Harness running inside WSL can discover a Windows Wallpaper Engine install.

### v0.4.0

- **Settings persisted to a host file** — all settings (selected wallpaper, accent, transparency, layout, rotation, hidden, speed/flip, …) are now stored in `~/.dsh-wallpaper-engine/config.json` instead of browser localStorage, so they survive restarts, port changes (including DSH Desktop's random `--port 0` loopback port), browser-data clears and browser switches. Legacy localStorage config is migrated automatically on first launch.
- **Edge-compatible rendering** — Edge (and only Edge) paints its built-in "download / cast" media-overlay toolbar over any *visible* `<video>` element, and there is no official switch to disable it. On Edge, video wallpapers are therefore rendered onto a `<canvas>` by default to keep that toolbar away. A new「Edge 兼容」toggle (right-aligned on the 紧凑布局 row, on by default) turns this off and falls back to the native `<video>` in every browser.

### v0.3.1–v0.3.6

- **Liquid-glass settings page** (v0.3.1) — the settings UI is now a **first-level settings page** (following the dsh-web-ui-all skin-center design): the whole page is a customizable liquid-glass card with **accent color** (6 presets + a custom color picker, default classic blue `#4f8cff`) and **glass transparency** (0–60 %, default 12 %). Both apply instantly and persist.
- **Whole-settings-window liquid glass** (v0.3.2) — one click turns the **entire native DSH settings window** (dialog + left nav + ALL native sections: General / Models / Plugins / …) into liquid glass with your custom accent + transparency. Off restores the stock look.
- **Unified glass tuning** (v0.3.3–v0.3.5) — the settings-window glass blur shares the SAME adjustment as the conversation bar: the **玻璃** (glass) slider (0–60 px) drives the blur radius of both the settings window and the composer/bubbles, with an identical saturation/brightness/contrast recipe. A new **玻璃颜色** (glass color) control lets you tint the glass BASE itself (6 presets + custom picker; defaults white in light / deep navy in dark; once picked, both themes use that color) — **配色** styles the interactive elements, **玻璃颜色** styles the glass itself.
- **Card style & vinyl record** — the 紧凑布局 (compact CD-rack stacking) toggle and the spinning vinyl-record artwork label.

### v0.2

- **Modal wallpaper picker** — the thumbnail grid lives in a popup modal, so the settings page stays compact.
- **Hide / restore (soft delete)** — hide wallpapers you don't want, restore them anytime; no source files are touched.
- **Playback speed** — six native presets from 0.5x to 2x, instant, no media reload.
- **Horizontal flip** — mirror the image (video / web / uploaded images).
- **Custom uploads** — use your own local JPG / PNG / MP4 as a wallpaper, with a configurable storage location (default `~/.dsh-wallpaper-engine/uploads`, movable to any drive, existing files migrated) and fit modes (cover / contain / center / fill), plus automatic thumbnails for uploaded MP4s.
