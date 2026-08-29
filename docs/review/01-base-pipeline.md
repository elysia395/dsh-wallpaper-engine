# we-renderer review: base pipeline (core/canvas/math/textures/effects dispatch)

Scope: `lib/we-renderer/core.js`, `canvas.js`, `math.js`, `textures.js`, `effects.js` (dispatch), plus the driving layer `lib/scene-renderer.js` / `lib/scene-manifest.js` and the modules core.js directly orchestrates for the reviewed behaviors (`bloom.js`, `camera.js`, `image.js` render-path call sites, `model.js::_texSample`, `scene-render-worker.mjs` driver). Reference semantics: `docs/WE-REVERSE.md`, `docs/plan-scene-webgl.md` (incl. the 已回滚/仲裁清单).

Severity: P0 = crash / wrong result blocking; P1 = clearly wrong vs official WE; P2 = minor visual / perf / robustness; P3 = nit.

All reproduction-claims marked **[verified]** were reproduced numerically in this review (not just read off the code).

---

## Findings

### BASE-01 — P1 — `canvas.js:49-60` — flipped `blitScaled` (negative dw/dh) samples a single source column/row **[verified]**

- **What the code does**: for `dw < 0` (`scale.x < 0` mirrored objects) it computes `x0 = floor(dx + dw)`, `x1 = ceil(dx)`, then `srcOffX = (x0 - dx) * invDw` and per-pixel `sx = clamp(round(srcOffX + (tx - x0) * invDw), 0, w-1)`, followed by `if (flipX) sx = w - 1 - sx`. Since `x0 - dx = dw` for flips, `srcOffX = dw * (w / |dw|) = -w`, so the un-flipped source coordinate sweeps `[-w, 0)` across the whole destination rect; the `Math.max(0, …)` clamp pins it to 0 for effectively every pixel, and post-flip every destination pixel samples `sx = w-1`.
- **Numeric check** (replica of the code's index math, `imgW = 8, dx = 10, dw = -5`): source indices for the 5 destination pixels = `[7, 7, 7, 7, 7]` (normal `dw = +5` correctly yields `[0,2,3,5,6]`). Same defect vertically for `dh < 0`.
- **Expected**: official WE (genericimage quad with negative scale) mirrors the texture; the un-flipped sweep must span `[0, w)` over the rect and the flip then reverses it. `blitRotated` does this correctly (`canvas.js:111-114` negates `ux/uy` instead of offsetting the rect origin).
- **Impact**: every object with a negative scale component (mirrored watermark/decor layers are common in workshop scenes) renders as a 1-pixel-wide smear of its right/bottom edge stretched across the whole quad.
- **Fix**: compute the offset against the rect's leading edge, e.g. `const srcOffX = (x0 - (flipX ? dx + dw : dx)) * invDw;` (same for `srcOffY` with `flipY ? dy + dh : dy`).

### BASE-02 — P1 — `image.js:131-132,176,191,205-206,229,233` + `canvas.js:62,79-83` — `brightness` is applied to **alpha**, and `brightness > 1` wraps the Uint8 alpha channel **[verified]**

- **What the code does**: `renderImage`/`_renderSolidLayer` read `brightness` and pass `alpha * brightness` as the *alpha* parameter of `blitRotated`/`blitScaled`. Inside `blitScaled`, `a = img.rgba[si+3]/255 * alpha` only scales source alpha; the RGB channels are copied unchanged. There is no `rgb *= brightness` anywhere in the image path.
- **Numeric check** (replica of `canvas.js:62-83` compositing on an empty canvas): opaque source with `brightness=0.5` → stored alpha 128 (object becomes 50 % translucent, RGB unchanged — nothing is darkened); `brightness=1.3` → `outA = 1.3`, `Math.round(1.3*255) = 332` → stored into `Uint8Array` as `332 & 255 = 76`; `brightness=2.0` → stored 254 after wrap. RGBA math also goes negative (`dst*dstA*(1-a)` with `a>1`) and wraps the color channels the same way.
- **Expected**: WE object `brightness` is a color multiplier (`albedo.rgb *= brightness`); alpha must stay `alpha`. `brightness > 1` brightens/clamps at the framebuffer, never changes coverage.
- **Impact**: any glow/emissive object authored with `brightness > 1` gets garbage wrapped alpha (opaque→nearly-transparent flashes); any dimmed object (`brightness < 1`) becomes ghost-transparent instead of darker.
- **Fix**: keep `alpha` as the blend alpha; apply brightness to RGB before compositing (pre-scale the source color in `blitScaled`/`blitRotated` via a `brightness` parameter, or bake a brightness-multiplied copy of the texture in `renderImage`), and clamp `outA` to `[0,1]` before `Math.round(outA*255)` as a defensive guard.

### BASE-03 — P1 — `image.js:130,144` (and `image.js:204` for solidlayer) — `model.fullscreen` sets `size = [W, H]` in **pixels**, then it is multiplied by the ortho scale `ps` again

- **What the code does**: `if (model.fullscreen) { size = [this.W, this.H]; }` puts the *render resolution* into what is otherwise a scene-unit size, and the same value then flows through `dw = size[0] * sc[0] * ps[0]` with `ps = [W/ortho.width, H/ortho.height]`.
- **Expected**: a fullscreen quad must cover the whole canvas exactly once, i.e. scene-unit size = ortho projection size (`ortho.width/height`), giving `dw = ortho.width * ps[0] = W`. The current code yields `dw = W * ps` (e.g. ortho 1920 → 2× oversize; the static-frame route in `lib/index.js:2355-2359` always renders 3840 wide regardless of ortho, so `ps = 3840/ortho.width` ≠ 1 for most scenes).
- **Impact**: any `fullscreen: true` image object whose shader is *not* in `_customShaders` (i.e. plain `genericimage*` backgrounds) is drawn oversized by `ps` and offset (with default origin `(0,0)` the quad is also mis-centered). Fullscreen shaders routed via `_renderFullscreenShader`/`_renderPassthroughLayer` are unaffected.
- **Fix**: `if (model.fullscreen) size = [ortho?.width || this.W, ortho?.height || this.H];` (and skip `ps` scaling for that quad, or equivalently set `dw = this.W, dh = this.H` directly). Same for `_renderSolidLayer` (`image.js:204`).

### BASE-04 — P2 — `camera.js:177-226` — `camera:"default"` objects drive eye/zoom **without any visibility check**

- **What the code does**: `_setupCamera` collects all `camera === 'default'` objects, picks the one with the largest origin-animation span, and applies its baked `origin`/`zoom` to the camera. `_isVisible`/`_isVisibleSelf` (`core.js:499-529`) are never consulted; camera objects are also never rendered (classified `unknown`), so visibility is otherwise meaningless for them — but WE-REVERSE §4/Q8 documents exactly this pattern where the entry-animation camera object's `visible` is bound to a user property (`hrbrbbrentryanimation` in Mutsumi 3629379075).
- **Expected**: when the user disables that property (object `visible` = false), official WE drops the entry camera movement; DSH still applies its origin/zoom animation.
- **Fix**: filter `camObjs` with `this._isVisible(o)` before span selection (and treat "all camera objects invisible" as "no camera-object drive").

### BASE-05 — P2 — `core.js:607,679` + `core.js:510` — animated `visible` with numeric keyframes never hides the object

- **What the code does**: `_resolveAnimations` bakes `visible` into `o.visible = { value }` where the value comes from `evalChannel` — keyframe values are floats, so `0`/`1`. `_isVisibleSelf` then only treats the object as hidden when `getVal(o,'visible',true) !== false` — i.e. `=== false` exactly; `{value: 0}` passes as visible.
- **Expected**: WE hides the object when the animated visibility is falsy/0.
- **Fix**: in `_isVisibleSelf`, also treat `0`/`'0'`/`'false'` as hidden (or coerce in `_resolveAnimations`: `value = Number(value) ? true : false` for the `visible` key).

### BASE-06 — P2 — `camera.js:100,206` — camera-object drive is dead unless `scene.camera.eye` is explicitly `0 0 0`

- **What the code does**: default eye is `parseVec3(cam.eye, [0, 0, 1])`, but the camera-object override is gated on `eye[0]===0 && eye[1]===0 && eye[2]===0`. A scene with `camera:"default"` entry-animation objects and *no* `scene.camera` section resolves eye to `(0,0,1)` → the gate fails and the entry camera is ignored.
- **Expected**: WE-REVERSE §5.4 states the intended rule as “scene.camera.eye 为默认 (0,0,0) 时用其 origin 作 eye” — i.e. the default itself should be `(0,0,0)` (or the gate should be “eye equals the *default* pose”, not “equals exact zero”).
- **Fix**: change the default to `[0,0,0]` per the documented semantic, or gate on “no explicit `cam.eye` in scene.json” instead of comparing resolved numbers.

### BASE-07 — P2 — `canvas.js:44-60` — `blitScaled` is nearest-neighbor while its comment (and official sampling) is bilinear

- **What the code does**: `sx/sy = Math.round(srcOff + t * invD…)`; comment on line 44 says “(bilinear, …)”. Point sampling on downscale drops texels (aliasing/moire), on upscale blocks.
- **Expected**: WE samples with linear filtering. Note `docs/plan-scene-webgl.md` Phase 1.5 explicitly records residual MAD from “LINEAR vs CPU NEAREST”, so this is a known visual gap, not a new discovery.
- **Fix**: implement the same 4-tap bilinear as `blitRotated` (`canvas.js:118-133`), at least for the minification case; fix the stale comment either way.

### BASE-08 — P2 — `textures.js:27-88` (`readPkg`) — no LZ4-entry support, unlike the other parser in the same plugin

- **What the code does**: `readPkg` (used by `SceneRenderer`) returns entry bytes raw. `scene-manifest.js:364-451` (`probeCompressedEntry`/`readPkgEntry`) documents and handles “some packers emit LZ4-chained entries”; its module header also says offsets are relative to the end of the index for the general case while `readPkg` treats old-format offsets as absolute (comment claims byte-level verification for PKGV0018).
- **Expected**: a workshop pkg with LZ4 entries must still render. Today `SceneRenderer` would fail every `loadTexImage` (garbage bytes → `parseTex` throw → log → null texture) while the manifest/preview path succeeds — the full renderer silently loses all textures exactly on the pkgs that need it most.
- **Fix**: route `readPkg` reads through the hardened `parsePkg`/`readPkgEntry` from `pkg-extract.js` (or port the LZ4-chain probe into `readPkg`).

### BASE-09 — P2 — `canvas.js:176-232` (`decodePngBuffer`) — gray+alpha PNGs decode wrong; interlaced PNGs undetected; no inflate size cap on untrusted input

- **What the code does**: `channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 4` — colorType 4 (8-bit gray+alpha, 2 bytes/px) falls into the `: 4` branch, so `stride = width*4` is twice the real row size → silently corrupt output. IHDR interlace byte (`data[12]`) is never checked, so Adam7 PNGs decode to garbage. `zlib.inflateSync` runs without `maxOutputLength`, and there is no `width*height` sanity cap — the hardened sibling `decodePngToRgba` in `scene-manifest.js:114-212` has all three guards (MAX_TEX_DIMENSION / MAX_TEX_PIXELS / maxOutputLength).
- **Expected**: reject or correctly decode colorType 4; reject interlaced PNGs; cap decompressed size (workshop files are untrusted; both decoders are fed straight from pkg bytes).
- **Fix**: `channels = {0:1, 2:3, 4:2, 6:4}[colorType]` + gray→RGB expansion for type 4, `if (data[12]) throw`, and mirror the MAX_* caps.

### BASE-10 — P2 — `model.js:676-700` (`_texSample`) + effect inner loops — per-pixel array allocations in 4K per-pixel paths

- **What the code does**: `_texSample` allocates a fresh `out = [0,0,0,0]` per call; `waterripple.js:55-57` allocates `n1`/`n2` arrays per pixel (3 `_texSample` calls + `Math.hypot` per pixel); `applyBlending` (`math.js:141-177`) allocates 2-6 intermediate arrays per call and is invoked per pixel for every `colorBlendMode > 0` object and per pixel inside shimmer/glitter/blend-style effects. At 3840×2160 that is tens of millions of short-lived arrays per frame → major GC pressure in the animation path.
- **Expected**: hot per-pixel helpers should write into caller-provided/scratch buffers (or return packed values).
- **Fix**: add a `dst` out-parameter variant of `_texSample` used by the per-pixel effects; make `applyBlending` accept an out array; hoist `[x0,y0]-corner` pair arrays in `bloom.js` out of loops.

### BASE-11 — P2 — `core.js:162-168` (`loadTexture` `_rt_` branch) — full-canvas snapshot copied on every lookup, uncached

- **What the code does**: any texture reference starting with `_rt_` returns `{ rgba: new Uint8Array(this.canvas.data) }` — a ~33 MB copy at 4K — and returns *before* the `textureCache.set` line, so nothing memoizes; effects referencing `_rt_*` repeatedly (reflection/passthrough chains, multiple passes) copy the canvas again per lookup per frame.
- **Expected**: snapshot once per render pass and reuse (the render target's content is fixed during a single object's effect chain anyway — it only changes as objects are drawn).
- **Fix**: cache one snapshot per `render()` call (e.g. `this._rtSnapshot` cleared at frame start), or hand effects a zero-copy view (`{rgba: this.canvas.data}`) where the effect only reads.

### BASE-12 — P3 — `math.js:148,153,163,173-175` — blending modes 5, 10, 20, 30, 31, 32 need a re-check against `common_blending.h`

- **What the code does**: mode 5 (`_bDarken` without opacity lerp) and 10 (`_bLighten` without lerp) skip the `opacity` mix that every other mode applies; mode 20 duplicates mode 4 (linear burn); mode 30 is `_c3(max(A)) * B`; mode 31 is `A + B*opacity` (bypasses the mix convention); mode 32 is `A*(1+B)` mixed. `TODO.md` claims all 32 modes are a literal translation of `common_blending.h`, but modes 5/10 asymmetry (no lerp while their siblings 1/6 lerp) is the kind of thing that silently diverges in transcription.
- **Expected**: exact per-mode semantics of the official header (including whether 5/10 apply `opacity`); official `ApplyBlending` also keeps `outColor.a = A.a`, which callers here handle separately — fine.
- **Fix**: diff the table against a copy of `assets/shaders/lib/common_blending.h` and add a comment per mode with the source line. (Not counted as wrong today — flagged for verification only.)

### BASE-13 — P3 — `bloom.js:157` (`_applyBloom`) — saturation boost uses Rec.601 weights instead of WE's quirky `greyscale()`

- **What the code does**: `gray = 0.2989*r + 0.587*g + 0.114*b` before `rgb = -gray + rgb*2`.
- **Expected**: WE's `common.h greyscale()` is the deliberate quirk `dot(c, float3(0.11, 0.59, 0.3))` — which `math.js:180` (`_greyscale`) already replicates correctly. If `downsample_quarter_bloom`/`combine_hdr` use `greyscale()`, the bloom saturation step should use the same quirky weights (slightly different hue emphasis of the bloom halo).
- **Fix**: use `_greyscale` (0.11/0.59/0.30) in the bloom bright-pass, or cite the shader line proving Rec.601.

### BASE-14 — P3 — `core.js:694-720` (`_downsample`) — box filter averages straight (non-premultiplied) alpha channels independently

- **What the code does**: sums R/G/B/A separately and divides by count. Transparent pixels contribute their (often black-or-bleeding) RGB at full weight, producing dark/bright fringing on downscaled cut-out edges.
- **Expected**: premultiply → average → un-premultiply (what GPU linear filtering effectively does for coverage).
- **Fix**: accumulate `r*a, g*a, b*a, a` and divide color by summed alpha (guard `a == 0`).

### BASE-15 — P3 — `core.js:727-768` (`_animValueAt`) — bezier Newton solver edge cases

- **What the code does**: solves `x(u) = frame` with a linear initial guess and ≤10 Newton iterations; bails to linear when `|d| < 1e-9` or the step leaves `[-0.5, 1.5]`. For non-monotone `x(u)` (author tangents overshoot in time) Newton can converge to the wrong branch; the fallback `u = linear-params` then ignores the tangents entirely. Also the tangent offset convention (`P1 = a0 + front`, `P2 = a1 + back`, `back.x` expected negative) is asserted, not verified against real keyframe data.
- **Expected**: official engine evaluates the cubic hermite/bezier per keyframe pair; time-overshoot curves are rare but legal.
- **Fix**: after Newton, verify `|bx(u) - frame| < ε` and otherwise do a bounded bisection on `u∈[0,1]` (x is monotone within a segment in practice); capture one real bezier keyframe pair from a workshop scene.json into a unit test to pin the front/back sign convention.

### BASE-16 — P3 — `core.js:133,137,424,522` — O(n) `objects.find` inside per-object/per-frame walks → O(n²) frames

- **What the code does**: `_resolveObjects.add`, `resolveTransform` chain walk, and `_isVisible` ancestor walk all do `this.objects.find(x => x.id === …)` per hop; `render()` additionally calls `_isVisible` per object per frame. Large scenes (hundreds of objects, deep groups) pay quadratic id lookups per frame in the animation path.
- **Fix**: build `Map<id, object>` once in `_resolveObjects` (and a `Map<id, parentChainResolved>` for visibility) and reuse in all three places.

### BASE-17 — P3 — `core.js:572` — scripts get hardcoded `frametime: 1/60`

- **What the code does**: every frame reports `System.frametime = 1/60` regardless of the actual frame step of the APNG render (`times` spacing = `loop/frameCount`, `frameDelayMs` may be 33/40/50 ms).
- **Expected**: scripts integrating velocity (`shared.pos += vel * System.frametime`) advance at the wrong rate when the render fps ≠ 60, so baked animation speed differs from official.
- **Fix**: pass the actual delta `times[i] - times[i-1]` (and a real value in static mode).

### BASE-18 — P3 — `core.js:319` (`_puppetBoneFinal`) — forward bone-parent references silently treated as root

- **What the code does**: `bindWorld[b]` composes the parent world only if `bindWorld[parent]` is already computed (`parent < b`); otherwise the bone is treated as a root without warning. MDL files whose bone list is not parent-first get wrong bind poses.
- **Fix**: two-pass or recursive-with-memo resolution; log when a parent index is unresolved.

### BASE-19 — P3 — `core.js:290` (`_mdlAnchors`) — anchor list silently capped at 64 entries

- **What the code does**: `for (let e = 0; e < count && e < 64 …)` — puppets with >64 MDAT anchors drop the rest; `attachment` lookups for dropped anchors return `[0,0]` (object sticks to parent origin).
- **Fix**: raise/remove the cap (the count is already bounds-checked against the buffer).

### BASE-20 — P3 — `camera.js:235` vs `scene-manifest.js:1971` — inconsistent default FOV (50 vs 45)

- **What the code does**: the CPU renderer falls back to `gen.fov` → 50; the manifest builder emits `fov: cam.fov ?? 45` for the GL/player path. Same scene, two defaults.
- **Fix**: pick one constant (WE default perspective fov) in a shared module.

### BASE-21 — P3 — `effects.js:37` — effect-level `visible: {user, value}` bindings ignore the user property

- **What the code does**: `getVal(ef, 'visible', true) === false` unwraps `{value}` only; a `{user:'x', value:true}` effect stays on even when the user property is false, while *object*-level visibility does honor user bindings (`core.js:502-508`).
- **Fix**: route effect visibility through the same `_isVisibleSelf`-style resolution (userProps first, value fallback).

### BASE-22 — P3 — `core.js:237-254` (`_loadAssetPng`) — hard-coded texture-name → PNG map

- **What the code does**: `'flare_1' → particle_flare1.png`, `'Untitled' → particle_leaves.png`, `'图层 44' → …` etc. — per-wallpaper hacks inside the generic loader; any other scene with a missing particle texture silently gets nothing, and a different scene with a texture literally named `Untitled` gets the wrong image.
- **Fix**: key the map by pkg path or move it into per-scene opts (`opts.assetMap`).

### BASE-23 — P3 — `textures.js:91-126` (`loadTexImage`) — `catch (e) { throw e; }` and the TEX container is parsed twice

- **What the code does**: `parseTex(raw)` then `decodeTex(raw)` each run `parseTexInternal` over the whole container (mipmaps included). The try/catch is a no-op.
- **Fix**: `const info = parseTex(raw); const dec = decodeTex(raw, info)` (accept pre-parsed info), drop the catch/rethrow.

### BASE-24 — P3 — `textures.js:115-121` — spritesheet duration taken from frame 0 only

- **What the code does**: `duration: info.frames[0].frametime || 0.1` — per-frame `frametime` is discarded, so variable-frame-rate spritesheet animations play at a constant rate; `image.js:111` (`frameIdx = floor(t / fr.duration) % count`) compounds this.
- **Fix**: accumulate cumulative start times per frame and select by `t` (TEXS carries per-frame frametime precisely for this).

### BASE-25 — P3 — `scene-manifest.js:2284` vs `core.js:431` — different default origins for objects without `origin`

- **What the code does**: the manifest's `resolveObjectTransform` defaults a root origin to `[width/2, height/2]`; the renderer's `resolveTransform` defaults to `[0,0,0]`. One of the two disagrees with WE's actual default for origin-less objects.
- **Fix**: verify against lwe `CImage` (which reads origin directly, absent → 0) and unify.

### BASE-26 — P3 — `scene-manifest.js:2436-2437` — `Math.abs(scale) || 1` turns scale 0 into scale 1

- **What the code does**: `lw *= Math.abs(objScale[0]) || 1` — an object with `scale = "0 0"` (author collapsed/hid it via scale) still renders full-size in the manifest preview path.
- **Fix**: keep 0 (`lw *= Math.abs(s)`), letting the degenerate quad drop out.

### BASE-27 — P3 — `scene-manifest.js:1519-1554` (`decompressLz4Block`) — unhardened LZ4 variant coexists with the hardened one

- **What the code does**: no `need()`-style bounds checks (overrunning `src` yields `undefined` → silently writes 0), no `MAX_DECOMPRESSED_BYTES` cap check parity issue aside — while `lz4DecompressBlock` (`scene-manifest.js:300-357`) validates every step and errors on mismatch. Also blocksX/Y at `scene-manifest.js:1663-1676` use `mipW / 4` without `Math.ceil` (non-multiple-of-4 DXT mips produce fractional loop bounds → partial garbage rows), unlike `decodeColorBlocks` which uses `Math.ceil`.
- **Fix**: delete this legacy decoder and use the hardened one (see BASE-28), or port the guards.

### BASE-28 — P3 — `scene-manifest.js:1611-1694` (`parseTexToRGBA`) — dead code with latent bugs (ARGB channel swap, TEXB0003-only layout)

- **What the code does**: no consumer anywhere in the plugin (verified by grep). If ever used: it treats format 0 as ARGB and swaps channels, while `TexFormat.RGBA8888 = 0` and `decodeTex` treat it as direct RGBA (per RePKG/lwe) — one of the two conventions is wrong and this copy is the outlier; it also assumes the TEXB0003 preamble (`p = texbPos + 9 + 8`) and would misparse TEXB0001/2/4.
- **Fix**: delete it, or re-export `decodeTex` under that name.

### BASE-29 — P2 (maintainability) — `scene-manifest.js` is a vendored near-duplicate of `pkg-extract.js`

- **What the code does**: its own header says `@module @linxin666/dsh-client-ui-skin-center/pkg-extract`; `pkg-extract.js` (`lib/pkg-extract.js`, canonical exports at line 1535) contains the same parser with drift already visible: LZ4 supported in `scene-manifest.js` `parsePkg` but not in `readPkg` (BASE-08), hardened `decodePngToRgba` vs unhardened `decodePngBuffer`, `resolveSceneTexPath` exists only in `pkg-extract.js`. Bug fixes must be applied twice; the two copies already disagree (see also BASE-27/28).
- **Fix**: make `scene-manifest.js` import from `pkg-extract.js` and keep only the manifest-builder logic.

### BASE-30 — P3 — `core.js:431-452` + `math.js:5-18` — NaN propagation from malformed scene values is unguarded (object silently vanishes)

- **What the code does**: `parseVec3('abc')` yields `[NaN, def1, def2]` (Number('abc') = NaN, and `??` does not catch NaN); a NaN origin/scale/angle flows through `resolveTransform` → `dx/dy` NaN → `blitScaled` loop bounds NaN → zero iterations → object silently skipped (a de-facto guard, but inconsistent); `_texSample` *does* guard (`isFinite` check at `model.js:680`). Note `core.js:444` `origin[2] || 0` does not catch NaN either (NaN is truthy).
- **Fix**: coerce non-finite components to defaults in `parseVec3/parseVec2` (`Number.isFinite` filter), matching the `_texSample` philosophy documented at `model.js:679`.

### BASE-31 — P3 — `core.js:128-143` — parent hoisting changes render order vs scene order

- **What the code does**: `add()` pushes dependencies *and the parent* before the object. Official WE build of the render list hoists `dependencies`; the parent relationship is transform-only (and WE editor output already lists parents before children). For hand-edited scenes where a child precedes its parent in `objects[]`, DSH reorders the draw sequence (child draws after parent instead of at its scene position).
- **Fix**: verify with lwe `CScene` and, if confirmed, hoist only `dependencies`, resolving parent transforms lazily (as `resolveTransform` already does).

### BASE-32 — P3 — `image.js:448-453` — `_customShaders` getter allocates a new Set on every access

- **What the code does**: `Object.defineProperty(proto, '_customShaders', { get() { return new Set([...]); } })` — a fresh Set per `renderImage` call per object per frame.
- **Fix**: return a module-level frozen Set.

### BASE-33 — P3 — `camera.js:4-91` / `bloom.js:6-112` — exported pure helpers duplicate the mixin implementations

- **What the code does**: `resolveCameraPose`/`setupCameraMatrices`/`computeParallaxDisplacement` and `applyBloom` re-implement `_resolveCameraPose`/`_setupCamera`/`_applyBloom` "逻辑零改动"-style copies (already drifted: the pure `setupCameraMatrices` lacks the camera-object origin/zoom override that the mixin has).
- **Fix**: have the mixins delegate to the pure functions (or delete the unused exports from `scene-renderer.js:9`).

### BASE-34 — P3 — `core.js:84-88` — external `project.json` lookup for loose dirs reads the *parent* directory

- **What the code does**: `path.dirname(String(this.pkgPath))` — when `pkgPath` is a loose scene *directory*, this points one level up; a sibling/parent `project.json` (another wallpaper) would pollute `userProps` with wrong schema colors/script defaults. (Loose dirs already get their own `project.json` via `pkg.readJson` on line 83.)
- **Fix**: only do the external lookup when `pkgPath` is a `.pkg` file; for directories look in the directory itself.

---

## Verified OK (spot-checked against official semantics / docs)

- `math.js` value parsing/unwrap: `getVal` `{value}` unwrap, `parseVec3/2` array/string/number forms; `_frac`; `sat`; `smoothstepFn` ≡ GLSL `smoothstep` for `e0 < e1`.
- **`_greyscale` quirk preserved**: `math.js:180` uses WE's `float3(0.11, 0.59, 0.3)` weights (the deliberate WE `common.h` oddity) — correct.
- `rgb2hsv`/`hsv2rgb`: standard cylinder conversion with hue wrap (`((h/6)%1+1)%1`), matches `common.h` behavior incl. `s = d/max`.
- `mat4` set: identity/mul column-major gl-matrix convention; `mat4Perspective`/`mat4Ortho`/`mat4LookAt` standard and correct; `mat4FromTRS` matches the documented engine convention `T · Rz(−z) · Ry(y) · Rx(−x) · S` (`math.js:60-75`); `mat4TransformPoint` guards `w = 0` (no NaN).
- `applyBlending` output clamp to `[0,1]` (`math.js:178`) — prevents the documented Uint8 wraparound for effect math (lightshafts negative-mask case); standard Photoshop-style formulas correct for modes 1-4, 6-9, 11-19, 23-25; HSL hue/saturation/color/luminosity mapping (26-29) uses base/blend slots correctly (B hue + A sat/lum etc.).
- `resolveTransform` (`core.js:418-455`): leaf-to-root chain collection with depth guard; root→leaf accumulation `child origin × accumulated scale → rotate(accumulated Z) → + origin`, child scale multiplied *after* its origin is applied — matches the documented lwe `CImage::resolveTransform` semantics (comments at 267-276); full XYZ angles carried in result.
- Attachment/MDAT: `_mdlAnchors` MDAT0001 layout (u16 count, u16 bone, NUL name, 64B matrix) per WE-REVERSE §8; `_attachmentOffset` rotates the anchor translation by the animated bone angle and adds the bone world translation, applies ancestor scale/rotation before own origin (`core.js:441-449`); animation-layer composition rules (additive ref = layer frame 0, angle wrap to ±π, blend lerp) match WE-REVERSE §6, and the animLayers mapping (visible filter, "动画 N" suffix, index fallback) is shared with `puppet.js` semantics.
- `_viewShift` (`camera.js:276-289`): background skip when `size ≥ ortho size`, camera.eye shift x-only, camera-object driven shift x+y with `vs[1]` added in canvas space (`image.js:145`) — matches the sf32/sf33 arbitration in WE-REVERSE §3.5.
- Camera: multi-path sequential loop with per-path `len = max(lastTimestamp, duration)`, in-path keyframe lerp clamped to last timestamp; zoom via ortho half-range divide (ortho) and proj[0]/[5] scale (perspective); `camVP = P·V`.
- Canvas compositing: source-over with un-premultiplied (straight) alpha and `/outA` un-association is mathematically correct; `blitRotated` handles negative dw/dh *correctly* (flip via `ux/uy` negation, `canvas.js:111-114`), conservative rotated bbox, edge-clamped bilinear, `outA ≤ 0` guard.
- PNG encode (`canvas.js:159-173`): filter 0, correct CRC32, correct IHDR (8-bit RGBA); `decodePngBuffer` filters 0-4 (Paeth) are standard and correct.
- Texture pipeline: pkg → WE global assets → external PNG fallback chain; failure results cached to avoid repeated fs hits; `_rt_` recognized before `.tex` normalization; video extensions short-circuit before `materials/` prefixing; `loadTexImage` crops DXT POT padding to the TEXI image rect anchored top-left (matches scene-manifest's verified probe); TEXS frame metadata plumbed for spritesheets.
- `decodeTex` (via `pkg-extract.js`): BC1 three-color+transparent when `c0 ≤ c1`, BC2 4-bit alpha ×17, BC3 3-bit alpha with exact 48-bit index math (double-safe), R8/RG88 expansion, size-vs-expected checks, `TexUnsupportedError` semantics; `parseTex` GIF flag → TEXS frames with per-version layouts.
- `effects.js` dispatch: per-effect try/catch keeps the previous image on failure; unknown/third-party effects fall through to the GLSL interpreter; `blurprecise` deliberately skipped (documented); multi-pass effects (`blur`, `godrays`, `glitter`, `blend`) receive full `passes` while single-pass ones take `passes[0]` — consistent with TODO.md's per-effect verification table.
- waterripple math matches the documented official frag: `strength²`, `animSpeed²`, `scroll = rotateVec2((0,1), dir)·scrollSpeed²·t`, second sample at `uv·1.333 − t·as²`, `x·aspect` / `y·ratio`, `×2−1` on *all* channels including `n1.z`, displacement `normal.xy × strength² × mask` (`effects/waterripple.js:38-68`) — including the fixed n1.z decode noted in WE-REVERSE §9.5.3.
- Visibility: `visible` `{user, value}` user-property resolution with value fallback; ancestor-chain visibility with cycle/depth guards; audio/live-component skip is an explicitly documented heuristic (`core.js:531-543`).
- Multi-frame reuse machinery: `_animBackup` built lazily before first bake and restored per frame; `_backupScriptValues` once + `_restoreScriptValues` per frame before `applySceneScripts`; script NSL cache/shared/ownerRef per renderer instance; worker (`scene-render-worker.mjs`) reuses one instance via `setTime` — structurally sound (see BASE-07 caveat on reference vs snapshot).
- Bloom orchestration: gated on `gen.bloom === true`; quarter-res 4-corner bright pass `saturate(scale−threshold)` → saturation boost → `×strength×tint`; HDR channel with feather divisor guard (`Math.max(0.001, hdrFeather)`); scatter passes radius-guarded; LDR add / HDR `lin()+bloom` combine with `Math.min(255, …)` clamps (no wraparound).
- scene-manifest driver: hardened `dirSceneAccess` (traversal + symlink fence), allocation ceilings, exact-fit LZ4 probe, case-insensitive pkg lookup, MP4 detection both at entry start and inside mip0 bytes, `#906` stop-on-top-candidate-unsupported logic, projection NaN/negative guards, `cropToProjection` aspect handling, `extractSceneResourceVia` catch-raw passthrough (documented scene-player dependency), camera-path segmentation with duration validation.
- `scene-renderer.js` is a pure re-export shim — no logic.

---

## Known / pending items (marked, not re-derived)

1. **KNOWN / PENDING arbitration — shake displacement units** (`effects/shake.js:39-40`): displacement `offset × strength² × flow` applied in *pixel* index space without `×w/×h`; official `shake.frag` displaces in UV units scaled by resolution. Fix was implemented and then **rolled back** per `docs/plan-scene-webgl.md` Phase 1.5 (“shake 位移单位缺 ×w/×h … 已回滚 … 入用户仲裁清单”).
2. **KNOWN / PENDING arbitration — mask UV scaling uses mask/object ratio** (`effects/opacity.js:14-15`, `effects/shake.js:16-17`, same pattern in other mask consumers): official convention (arbitrated in the GL spike) is `g_TextureNResolution = (mip0.w, mip0.h, header.w, header.h)` → scaling = header/mip0 (≈1 for most textures), not maskW/objectW. Also **rolled back** into the same arbitration list.
3. **KNOWN / arbitrated — waterripple mask UV = pure uv** (`effects/waterripple.js:29-35`, `mSx = mSy = 1`): deliberate result of the lwe `CTexture::setupResolution` arbitration (WE-REVERSE §9.2); the old `maskW/texW` scaling is documented as the bug. Do not "fix" back.
4. **canvas.clear — FIXED, keep fixed** (`canvas.js:7-12` now honors `r/g/b/a`; `core.js:576-580` passes `clearcolor×255` when `clearenabled !== false`): this was WE-REVERSE §9.5.1; any refactor of `render()` must keep the clearcolor pass and the cache-key bump discipline (`sf34` note in `lib/index.js:2338-2343`).
5. **KNOWN limitation — video textures frozen at `times[0]` in multi-frame mode** (`lib/index.js:718-725` + `core.js:182-190`): documented; per-frame ffmpeg extraction deferred.
6. **KNOWN heuristic — `_isLiveComponent`** (`core.js:534-543`) skips any object whose effect dir name matches `/audio|bars|oscilloscope|visualizer|equalizer|spectrum/i`, and `_renderSolidLayer` has a second narrower audio-bar skip (`image.js:198-201`). Documented deviation (no live audio data in static/anim renders).

---

## Suggested fix order

1. BASE-01 (flip) and BASE-02 (brightness) — outright wrong pixels, small localized fixes in `canvas.js`/`image.js`.
2. BASE-03 (fullscreen ps) — one-line size-unit fix.
3. BASE-04/05/06 — camera/visibility semantics.
4. BASE-08/09 (parser hardening/parity), BASE-10/11 (perf), then the P3 list opportunistically.
