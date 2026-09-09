# we-renderer review: effects (light & post-processing)

Scope: full read of `lib/we-renderer/effects/{godrays,glitter,shimmer,blurradial,blur,blend,filmgrain,pulse,tint,opacity,skew,iris,scroll,depthparallax}.js`;
skimmed `effects.js` (dispatch), `math.js` (`applyBlending` modes 1–32, `parseVec2/3`, `getVal`, `smoothstepFn`),
`model.js:676-702` (`_texSample`), `core.js:158-210` (`loadTexture` fallback), and `docs/WE-REVERSE.md` (§9.2/9.5/9.6).

Verification basis: (1) the two official shaders available in-repo, `test/scene-gl-spike/assets/shaders__effects__iris.{vert,frag}`,
against which `iris.js` was checked formula-by-formula; (2) each file's own header comment plus the author's
source-audit rounds recorded in `TODO.md` (sf39h–sf39l: pulse phase, godrays cast/noise, glitter prepare,
tint/opacity/filmgrain defaults, blur 4-pass chain, depthparallax POM, scroll/skew/shimmer) — code was checked
against the math its comment claims was source-verified; (3) `git show 684fb0a~1:lib/we-renderer/effects.js`
(the pre-split monolith) to confirm lost helper definitions; (4) node replicas of the exact code for every
numeric claim marked **[verified]**. Official shader texts for godrays/glitter/shimmer/blur/blend/filmgrain/
pulse/tint/opacity/skew/scroll/depthparallax are **not** in the repo and no indexed public mirror was found —
claims that depend on the official text rather than internal arithmetic are marked **needs official source**.

Severity legend:

- **P0** — crash / effect silently never renders
- **P1** — clearly wrong vs official WE output
- **P2** — minor visual deviation, perf issue, or wrong-but-narrowly-triggered
- **P3** — nit, dead code, robustness, documentation

Cross-review boundaries: GLSL fallback stack findings are covered by `04-glsl-stack.md` (GLS-01..29) and
water/nature effects by `05-effects-water-nature.md`; the mask-UV-scaling class below is listed there as
KNOWN/PENDING — it is consolidated here (one ID) only because half of *these* files implement the opposite
convention from the other half.

---

## Findings

### LGT-01 — **P0** — `effects/godrays.js:97-98` — `this._gaussPass` does not exist anywhere in `lib/`; godrays always throws at pass 2 and is silently skipped **[verified]**

**What the code does.** `const blurX = this._gaussPass(castTex, blurScale[0] / hw, 0, gauss7);` — a repo-wide
grep finds `_gaussPass` referenced only here; no file in `lib/` defines it. The pre-split monolith defined it
(`git show 684fb0a~1:lib/we-renderer/effects.js` line 299: `_gaussPass(tex, offX, offY, kernel)` — a separable
7-tap pass with `half = (kernel.length-1)/2`); the split commit `684fb0a` ("拆分 effects.js … 24 个效果各一文件")
moved the callers into `effects/godrays.js` but dropped the helper. Every invocation therefore throws
`TypeError: this._gaussPass is not a function` after the cast pass, which `effects.js:107` catches and logs —
so godrays never produces a visible frame (and logs an error every frame).

**Expected.** The official 5-pass chain downsample2 → cast → gauss_x → gauss_y → combine completes; passes 2–3
are the 7-tap gaussian at `blurscale/hw, hh`.

**Fix.** Restore the helper (e.g. in `effects/godrays.js` or back on the prototype next to `_texSample`):
the lost body is exactly `out[px] = Σ_i sample(u+(i-half)·offX, v+(i-half)·offY, true)·kernel[i]` over the
7-entry `gauss7` kernel (sums to 0.999999, see LGT-verified list). Add a unit smoke test that calls
`effectGodrays` on a small texture and asserts no throw.

### LGT-02 — **P1** — `effects/pulse.js:39` — `this._createAudioResponse` also lost in the split: audio-reactive pulse throws (effect skipped); without audio spectrum `pulse=0` blanks the layer **[verified]**

**What the code does.** `pulse = this.audioSpectrum ? this._createAudioResponse(this.audioSpectrum, c, audioMode) : 0;`
— `_createAudioResponse` is defined nowhere in `lib/` (was `684fb0a~1:effects.js:452`, dropped by the same
commit as LGT-01). Two failure modes: (a) `audioSpectrum` present → TypeError → caught at `effects.js:107` →
pulse effect never renders; (b) `audioSpectrum` absent (static-frame renderer, the common DSH path) →
`pulse = 0` hard-coded, so with `PULSEALPHA` combo the whole layer renders at alpha 0 (invisible) and with
`PULSECOLOR` it renders permanently at the `tintLow` end — for the entire wallpaper lifetime.

**Expected.** Audio branch computes the smoothed band response; the no-audio branch should fall back to the
time-based sine pulse (the `else` branch right below, lines 41-52), not to a constant 0.

**Fix.** Restore `_createAudioResponse` from `684fb0a~1` (band select `freqMin..freqMax` on `spec.left/right`,
mean, `smoothstep(bounds)`, `pow(power)·multiply`); and change the `audioSpectrum == null` case to reuse the
non-audio sine computation instead of `0`.

### LGT-03 — **P1** — `effects/blurradial.js:31-35,53-64` — KERNEL=1 kernel is mirrored although its 4 weights are signed single-sample taps: total weight = **2.0** (≈2× brightness) and doubled/misplaced tap set **[verified]**

**What the code does.** K1 = offsets `[2.3515644035337887, 0.469433779698372, −1.4091998770852121, −3]`,
weights `[0.2028175528299753, 0.4044856614512112, 0.3213933537319605, 0.0713034319868530]`, applied by the
shared loop as `(sp + sm) * w` — i.e. each offset sampled at **both** signs. Unlike K0/K2 (positive distance
offsets meant to be mirrored), K1's weights sum to exactly 1.0 *as four single samples* and its offsets are
already signed: 0.404486 = 0.214607+0.189879 and 0.202818 = 0.131514+0.071303 (linear-filter pair taps), i.e.
a 4-sample bilinear encoding of the official 7-tap kernel **[verified]**. Mirroring makes the effective total
`2 × 1.0 = 2.000000` **[verified]** — the radial blur with KERNEL=1 renders ~2× brighter (saturated white
bleed on bright backgrounds) — and samples ±{2.35, 0.47, 1.41, 3.0} (8 points) instead of the official
{+2.35, +0.47, −1.41, −3.0}. KERNEL=0 totals 1.000000 and KERNEL=2 totals 1.000000 (K2's `w[1]` is dead but
unused since `K.o.length === 1`) **[verified]**.

**Expected.** KERNEL=1: `albedo = Σ_i sample(center + rotate(delta, o_i·amt)) · w_i` — 4 samples, weights sum 1.

**Fix.** Give K1 a `signed: true` flag (or a separate loop) so its offsets are sampled once at their own sign;
keep the mirroring only for K0/K2.

### LGT-04 — **P1** — `effects/godrays.js:113` — combine alpha `src.a + rays.a` written unclamped: Uint8Array wraps modulo 256, e.g. 0.8+0.6 → **101** instead of 255 **[verified]**

**What the code does.** `out[di + 3] = Math.round((src[di + 3] / 255 + r[3]) * 255);` — official combine is
`albedo.a += rays.a` which clamps at the framebuffer (`1.0`); here values >1 wrap: (0.8+0.6)·255 = 357 →
stored 101 (alpha 0.396); (1.0+1.0)·255 = 510 → stored 254; (0.5+0.7)·255 = 306 → stored 50 **[verified]**.
Any bright ray over an already-opaque region produces dark alpha holes with the wrong blend against the
background. RGB is safe (`applyBlending` clamps, and cast pass clamps), only alpha wraps.

**Expected.** `min(1, src.a + rays.a)`.

**Fix.** `Math.round(Math.min(1, src[di + 3] / 255 + r[3]) * 255)`.

### LGT-05 — **P1** — `effects/blend.js:58,63` — `transformRepeat === 1` / `=== 0` compared against a **boolean**: both TRANSFORMUV branches are dead code **[verified]**

**What the code does.** Line 20 sets `transformRepeat = combos.TRANSFORMREPEAT === '1' || combos.TRANSFORMREPEAT === 1`
(a boolean), then line 58 tests `if (transformUV && transformRepeat === 1)` (never true: `true === 1` is
`false` in JS) and line 63 `if (transformUV && transformRepeat === 0)` (never true: `false === 0` is `false`)
**[verified]**. Consequence: with `TRANSFORMUV=1`, blend UVs are never `frac`-wrapped (REPEAT mode) and never
range-tested (clip mode) — in clip mode the effect blends outside the intended UV window where official
disables it (`blend *= 0`), because `_texSample` silently REPEAT-wraps the un-clamped UV.

**Expected.** TRANSFORMREPEAT=1 → `blendUV = frac(blendUV)`; TRANSFORMREPEAT=0 → zero the blend outside [0,1]².

**Fix.** `if (transformUV && transformRepeat) { frac }` / `if (transformUV && !transformRepeat) { clip }`.

### LGT-06 — **P2** — `effects/iris.js:38` — `moveStart.y` uses the wrong phase slot vs the in-repo official `iris.vert`: `s4(1,2)` should be `s4(0,2)` **[verified vs official source]**

**What the code does.** `const moveStart = [s2(0) + s4(0, 1), s2(0) + s4(1, 2)];` — official
(`shaders__effects__iris.vert:34-37`): `motion2 = sin(1.9·(lowDt+{0,1}))`, `motion4 = sin(2.5·(lowDt+{0,0,1,1}) + {1,2,1,2})`,
`moveStart = motion2.xx + motion4.xy` → moveStart.y = `sin(1.9·lowDt) + sin(2.5·lowDt + 2)`. The code computes
`sin(1.9·lowDt) + sin(2.5·(lowDt+1) + 2)` = `sin(1.9·lowDt) + sin(2.5·lowDt + 4.5)`. Max deviation over
lowDt∈[0,60) is **1.898** (at lowDt=54) → at default scale 1, `0.0019` UV ≈ **2.05 px** vertical hold-phase
error @1080p **[verified]**; the error persists most of each second (the `smoothstep(1−rough,1,·)` gate keeps
`f=0`, i.e. moveStart, except mid-second). `moveStart.x` and both `moveEnd` components match official exactly
(max |diff| 0.000000 / correct) **[verified]**.

**Expected.** `moveStart = [s2(0) + s4(0, 1), s2(0) + s4(0, 2)]`.

**Fix.** One-token change: `s4(1, 2)` → `s4(0, 2)` on line 38.

### LGT-07 — **P2** — `effects/filmgrain.js:6` and `effects/pulse.js:16` — `combos.BLENDMODE || default`: BLENDMODE=0 (Normal) silently becomes softlight(12) / add(9) **[verified]**

**What the code does.** `const mode = combos.BLENDMODE || 12;` (filmgrain) and `|| 9` (pulse) — `0` is falsy,
so a wallpaper that explicitly selects blend mode 0 gets softlight (filmgrain) or additive (pulse) instead of
Normal. All sibling effects use the correct null-guard pattern (`k.BLENDMODE != null ? Number(k.BLENDMODE) : d`
— godrays.js:28, blur.js:23, blend.js:15, tint.js:8, shimmer.js:27, glitter.js:22, blurradial.js:16,
depthparallax.js:14), so this is an inconsistency introduced by these two files. (Related: `pulse.js:37`
`combos.AUDIOPROCESSING || 0` passes strings through — `"2" > 0` is true but the later `mode === 2` channel
select would fail; harmless today only because of LGT-02.)

**Expected.** BLENDMODE=0 → mode 0 (Normal = `mix(A, B, opacity)` in `applyBlending`'s default branch).

**Fix.** `const mode = combos.BLENDMODE != null ? Number(combos.BLENDMODE) : 12;` (and `: 9` for pulse);
also `Number(combos.AUDIOPROCESSING)`.

### LGT-08 — **P2** — cross-cutting: mask/aux-texture UV scaling contradicts the project's own adjudicated convention *within this file set* — `maskTex.width/object.width` vs pure `uv` **needs decision / official vert re-check**

**What the code does.** Two conventions coexist:
- mask/object ratio scaling: `godrays.js:16-17,43` · `glitter.js:26-27,65` · `tint.js:15-16,24` ·
  `opacity.js:14-15,21` · `filmgrain.js:17-18,38` · `blur.js:115-116` · `blend.js:28-29,57,61` (blend tex +
  opacity mask) · `depthparallax.js:27-28,39-40,42` (depth + mask);
- pure `uv` sampling: `iris.js:57,61` · `shimmer.js:43,45` · `pulse.js:68` · `blurradial.js:69`.

WE-REVERSE §9.2/§9.5 records the spike verdict: with the lwe resolution convention
`g_Texture1Resolution = (mip0.w, mip0.h, header.w, header.h)`, the official verts' `z/x, w/y` ratio is
header/mip0 ≈ 1 → **mask UV = uv**, and that convention was MAD-verified at 1920×1080 *running the official
shaders*; the analogous "object-size-based" convention was explicitly excluded. Conversely TODO sf39i/sf39j
claims official verts scale by `maskRes/objectRes` and applied it to ~10 effects. Both cannot be right: for
the common sf39i case (1920×870 mask on a 3840×1741 object), ratio-scaling samples only the top-left quarter
of the mask stretched across the object, while pure-uv is a no-op. `05-effects-water-nature.md` already lists
this class as KNOWN/PENDING for shake/waterripple; this review adds that the inconsistency now also splits
the light/post effect set itself (iris — whose official vert is **in-repo** and whose comment block at
`iris.js:23-29` consciously uses pure-uv — vs tint/opacity/godrays/… which scale).

**Expected.** One convention everywhere. Under the spike-adjudicated lwe convention it is pure `uv`
(z/x = header/mip0 of the *mask itself*, ≈1), i.e. the scaling in godrays/glitter/tint/opacity/filmgrain/
blur/blend/depthparallax should be removed — unless a .tex corpus study shows these masks really ship
header≠mip0 with header = object canvas.

**Fix.** Re-adjudicate against a real pkg: dump `g_Texture1Resolution` for a mask-bearing wallpaper in the GL
spike and compare CPU variants; then either delete the `maskTex.width / tex.width` factors or record the
header≠mip0 evidence in WE-REVERSE and port iris/shimmer/pulse/blurradial to it.

### LGT-09 — **P2** — `math.js:163` — `applyBlending` case 20 (Subtract) is an exact duplicate of case 4 (LinearBurn): `max(A+B−1, 0)` instead of `A−B` **[verified by inspection]**

**What the code does.** `case 4` and `case 20` both compute `A.map((v, i) => Math.max(v + B[i] - 1, 0))`.
Within the mode table this codebase itself establishes (1..32 used as the WE BLENDMODE enum by every effect),
20 is Subtract: `base − blend` (the final clamp at math.js:178 already handles the negative range). A wallpaper
selecting Subtract 20 gets LinearBurn instead (identical to 4) — e.g. base 0.9/blend 0.2 → official 0.7,
this code 0.1. *needs official enum check* (mode names inferred from the project's own table; no two modes
elsewhere in the table are duplicates, which corroborates that 20 is wrong).

**Expected.** `case 20: out = mix(A, A.map((v, i) => v - B[i]), opacity)`.

**Fix.** As above; add a tiny unit test enumerating modes 1–32 asserting pairwise inequality of the pure-blend
functions.

### LGT-10 — **P2** — `effects/blur.js:76-84` — gaussian weights array rebuilt **per output pixel**: ~518k throwaway arrays+entries per frame at 1920×1080 **[verified]**

**What the code does.** Inside `gauss()`'s inner x/y loop, every pixel executes
`const full = []; for (…) full[K.off[i]] = K.w[i]; const n = K.off[0]; const weights = []; for (i=-n..n) weights.push(…)`
— at dw×dh = 480×270 × 2 passes that is 259 200 pixels × 2 arrays + up to 27 pushes ≈ **518 400 allocations**
per frame for data that depends only on `kernel` (constant per effect). The kernel `K` and derived `weights`
are loop-invariant.

**Expected.** Weights computed once per pass (they are already constant — the same 13/7/3-tap tables appear as
constants in `godrays.js:96` and `blurradial.js:26-40`).

**Fix.** Hoist `full`/`weights` construction above the y-loop (or precompute all three kernel tables once at
module level); optionally mirror `godrays._gaussPass`'s simpler `(i-half)·step` indexing which needs no
per-pixel work at all.

### LGT-11 — **P3** — `effects/filmgrain.js:12` — `combos.MASK === 1` (number-only) and `combos.GREYSCALE === 1`: string-valued combos silently disable mask/greyscale **[verified]**

**What the code does.** `const hasMask = combos.MASK === 1;` — every other effect in this set accepts both
`'1'` and `1` (`MASK === '1' || MASK === 1`). The GLSL-stack paths in `image.js:109,341` hedge with
`combos.spritesheet || combos.SPRITESHEET`, i.e. the project has met non-canonical combo values in the wild.
`"1" === 1` is `false` **[verified]** → the filmgrain mask is dropped (full-strength grain) when MASK arrives
as a string; same for `greyscale === 1` (line 7/31) → color noise instead of grey.

**Expected.** Mask/greyscale honored for `'1'` and `1`.

**Fix.** `combos.MASK === '1' || combos.MASK === 1` (and `Number(combos.GREYSCALE) === 1`), matching siblings.

### LGT-12 — **P3** — missing global textures degrade through `_texSample(null) = [1,1,1,1]` into degenerate effects: `glitter.js:28` (perlin_256), `shimmer.js:31` (gradient_ferro_fluid), `blend.js:59` (blend tex under WRITEALPHA)

**What the code does.** `loadTexture` returns `null` when neither pkg nor `weAssetsDir` provides the file
(`core.js:176-209`), and `_texSample(null)` returns white (`model.js:677`).
- `glitter.js:28,43-45`: noise white → `n0r = 1·(1−0) = 1` for **every** cell → `timer = frac(100 + tm)` is
  frame-global → all 65 536 tiles flash **synchronously** instead of per-cell random sparkle.
- `shimmer.js:31,52`: gradient white → `shimmerColor = 1` → the sweep becomes a uniform full-strength tint
  pulse (mix factor `shimmerColor·f = f`).
- `blend.js:59`: missing blend texture with `WRITEALPHA=1` → `bc=[1,1,1,1]` → `newAlpha = a·(1−b)+1·b` drives
  alpha toward 1 across the layer.
Well-behaved counter-examples in the same set: `godrays.js:43,45` and `pulse.js:48` explicitly null-check,
and `opacity.js:11`'s `util/white` fallback is *correctly* white (`m=1`).

**Expected.** A missing util texture should approximate the official default (perlin noise ≈ mid-gray random,
gradient ≈ black-to-white ramp), or the effect should no-op — not collapse to a global white constant.

**Fix.** Cheap procedural fallbacks: for glitter noise return a hash-based pseudo-random per cell when
`noiseTex == null`; for shimmer gradient use `frac(sx)` as the ramp; for blend treat null as "skip effect".

### LGT-13 — **P3** — `effects/pulse.js:7` — stale header comment still documents the **old wrong** phase math the code no longer uses

**What the code does.** Line 7: `v_Pulse = smoothstep(bounds.x, bounds.y, sin(time×speed + (phase−0.25)×2π)×0.5+0.5)`
— but the implementation (line 44) and the sf39h audit note (TODO.md:439-441: official is
`sin(time×speed + (phase−π/2))`, phase in radians, range [0, 6.282]) use `(phase − 1.57079632679)`. The
comment is the pre-fix formula that sf39h explicitly corrected; the next editor will "restore" the bug from
it. (Implementation itself matches sf39h — no math finding here.)

**Expected.** Comment matches code: `(phase − π/2)` radians.

**Fix.** Update line 7; consider noting the uniform range [0, 6.282] there too.

### LGT-14 — **P3** — `effects/godrays.js:52` — `noisesmoothness=0` → 0/0 NaN → alpha silently 0 (black rays) for exact-mid noise samples **[verified]**

**What the code does.** `const sm = Math.min(1, Math.max(0, (noiseSample - (0.5 - noiseSmooth)) / (2 * noiseSmooth)));`
— with `noiseSmooth = 0` (UI minimum), the denominator is 0; when `noiseSample == 0.5` exactly, `0/0 = NaN`,
`Math.round(NaN) = NaN`, and Uint8Array stores `0` **[verified]** — that pixel's ray alpha is killed. Sibling
`pulse.js:45` already guards the identical pattern with `Math.max(1e-6, bounds[1] - bounds[0])`.

**Expected.** Zero-width smoothstep = hard step, not NaN.

**Fix.** `const denom = 2 * noiseSmooth || 1e-6;` (or mirror pulse's epsilon).

### LGT-15 — **P3** — `effects/depthparallax.js:81` — POM `weight = afterDepth / (afterDepth - beforeDepth)` can divide by ~0 → ±Infinity → `_texSample` non-finite guard → **black pixels** (theoretical for 8-bit depth)

**What the code does.** Denominator is 0 when `depth(prev) − depth(cur) = layerDepth` exactly (1/24 or 1/64);
`weight = ±Infinity` makes `sampleU/V` infinite and `model.js:679` then returns `[0,0,0,0]` — a black pixel.
For 8-bit depth maps exact equality is (nearly) impossible (255/24 and 255/64 are non-integers), so this is
robustness only — but a float/HDR depth texture or bilinear-interpolated coincidence triggers it with no
diagnostic. The march itself checks out: flat depth 1 → 0 steps (no shift), 0 → N steps (full `P`), matching
the author's sf39l verification note, and the interpolation is self-consistent with the inverted-layer
framing (`beforeDepth = depth(prev) − cld − ld` is the correct sign for the `cld: 1→0` formulation;
equivalent to LearnOpenGL's `+ layerDepth` under `d' = 1−d`) **[verified]**.

**Expected.** `weight` clamped to [0,1]; no non-finite coordinates.

**Fix.** `const wgt = afterDepth === beforeDepth ? 0.5 : Math.min(1, Math.max(0, afterDepth / (afterDepth - beforeDepth)));`

### LGT-16 — **P3** — `effects/blur.js:21` — y-direction blur scale taken from `passes[1]` only; `passes[2]`'s own `scale` uniform ignored

**What the code does.** `scaleV` is read from the gaussian_x pass (`pG = passes[1]`) and used for both the x
and y sweeps (`gauss(img, vertical)` / `gauss(img, !vertical)`, lines 99-100). Officially each gaussian pass
material carries its own `scale` vec2 (`blur_gaussian_x` / `blur_gaussian_y`); the CPU picks `.x`/`.y` from
the *x-pass's* vec2 for both directions. Identical in every observed effect.json (both default `"1 1"`), wrong
the day a wallpaper sets per-pass scales. *needs official source* for whether WE's editor can produce
divergent per-pass values.

**Expected.** x-sweep uses `passes[1].scale.x`, y-sweep uses `passes[2].scale.y`.

**Fix.** Read a `scaleV2 = parseVec2(getVal(((passes||[])[2]||{}).constantshadervalues …))` and use
`scaleV2[1] / h2` in the vertical branch.

### LGT-17 — **P3** — per-pixel allocation/alloc-churn in the shared hot path (`applyBlending`) and blurradial

**What the code does.** `applyBlending` (`math.js:140-179`) allocates 2–4 arrays plus a `mix` closure per call
and is invoked once per pixel by filmgrain/pulse/tint/shimmer/glitter/godrays-combine (≈2M calls/frame at
1080p → GC churn; visible as periodic frame hitches in a CPU renderer). `blurradial.js:42,55` additionally
allocates two `[x,y]` arrays per tap per pixel, and `blurradial.js:66` re-samples `prev` even when
`!hasMask && !keepAlpha` where its value is discarded (1 of 8–15 samples wasted).

**Expected.** Zero per-pixel heap allocation in the steady-state loop where feasible.

**Fix.** Cheap wins first: skip the `prev` sample when unused; write blend math with scalar locals for the
common modes (2 multiply, 9 add, 12 softlight) before considering full scalarization of `applyBlending`.

### LGT-18 — **P3** — `effects/iris.js:23-29` — mask applied on texture presence, ignoring `combos.MASK` (deliberate, but is an undocumented-in-docs semantic divergence)

**What the code does.** `maskTex = pt[1] && pt[1] !== 'null' ? this.loadTexture(pt[1]) : null` — the official
frag gates all mask sampling behind `#if MASK`; this code applies the mask whenever `textures[1]` exists, even
if the material's MASK combo is 0. The inline comment justifies it (the audited scene's iris pass carries no
combos; consistent with the waterripple precedent). Risk: a wallpaper that binds an opacity mask but disables
MASK gets eye-motion damping where official displaces fully. Borderline-call documentation issue, not
necessarily a bug.

**Expected.** Official: `#if MASK` drives it. Documented deviation is acceptable if recorded in WE-REVERSE.

**Fix.** Prefer `hasMask = combos.MASK ? … : texturePresent` fallback order (combo wins, presence as legacy
fallback), and note the decision in WE-REVERSE §9.

---

## Verified OK

- **Gaussian kernel sums**: blur.js 13-tap = 0.999998, 7-tap = 0.999999, 3-tap = 1.000000; godrays `gauss7` = 0.999999; blurradial K0 = 1.000000, K2 = 1.000000 (its unused `w[1]` is dead weight, not an error) — all ≈1, correctly normalized. (K1 = 2.0 is the exception → LGT-03.)
- **godrays cast** (`godrays.js:63-93`): direction `center−uv` normalized, `dist = min(dist, dist·rayLength)`, 30 samples stepping back by `dist/29` with weight `i/29`, intensity `rayIntensity·0.1`, rayColor on rgb only — matches the author's sf39k source-audit note (TODO.md:472).
- **godrays downsample2 noise** (`godrays.js:29-36`): `n2 = (v·0.633 − t·0.5s, −u·0.633 + t·0.5s)·scale`, `mix(sample.a, sample.a·noise, amount)`, threshold step, premultiply-then-alpha=1 order — matches TODO.md:472-473.
- **glitter prepare** (`glitter.js:34-53`): noise coord ×5, `n0r = r·(1−g)`, `timer = frac(n0r·100 + t·speed·density²)`, double smoothstep peak of width `density²/2`, square, 256×256 r8 pattern — matches TODO.md:473-474.
- **pulse time path** (`pulse.js:41-53`): `sin(t·speed + (phase−π/2))·0.5+0.5` → smoothstep(bounds) → ×amount; noise `t·0.0833·speed / t·0.0278·speed`; `pow(pulse, power)` — matches sf39h (TODO.md:439-441). PULSECOLOR `ApplyBlending(BLENDMODE, albedo·tintLow, albedo·tintHigh, pulse)` and PULSEALPHA `a·pulse` shapes match the header contract.
- **iris vs in-repo official shaders**: `time/lowDt/moveEnd/smoothstep(1−rough,1,cos(frac·π)·−0.5+0.5)/noise sin,cos/×scale·0.001` all exact; frag: displaced sample `uv + da·mask`, `irisMask` sampled at the *displaced* mask coord, `BACKGROUND` = `mix(eyeColor, iris, irisMask)`, MASK=0 path = plain displaced sample — all match `shaders__effects__iris.{vert,frag}` (only moveStart.y → LGT-06).
- **blend PerformBlend WRITEALPHA** (`blend.js:31-47`): premultiplied compositing incl. `step(0.01,…)` src/dst correction terms — structurally matches the header contract and the sf39l note (TODO.md:492-496); non-WRITEALPHA `blendAlpha *= blendColors.a` then ApplyBlending, alpha preserved.
- **blur downsample4** (`blur.js:35-57`): ±1 source texel corners, `rgb = Σ(s·a)/max(0.001, Σa)`, `a = Σ(a²)/4` — matches sf39l description; combine div = `a>0 ? a : 1` un-premultiply, per-mode ApplyComposite branches, mask mix, BLURALPHA=0 alpha restore, all output channels clamped.
- **blur 4-pass order**: passes[0] downsample → [1] gaussian → [1]-derived direction + opposite → [3] combine; VERTICAL/combo/texture-slot reading consistent with the documented effect.json layout.
- **depthparallax POM**: march counts flat-depth 1→0 steps / 0→24 steps (full `P = viewdir·scale·0.1`), matching the author's sf39l verification (TODO.md:487-490); QUALITY 0 `vec2(2,−2)·scale·−0.04` pointer + `(depth·2−1)·pointer·mask` consistent with header; QUALITY default 1 → 24 layers, QUALITY 2 → 64.
- **scroll / skew / shimmer / tint / opacity**: match their sf39h/sf39i/sf39j audit notes exactly (`sign(s)·s²·t`, frac·repeat; cross quadrant semantics `top/bottom→u`, `left/right→v` with original-UV quadrant tests; shimmer rotate/frac/per-channel mix; tint default BLENDMODE 30 + `alpha×mask.r`; opacity `a × mask × g_UserAlpha`).
- **`_texSample`** (`model.js:676-702`): bilinear [0,1] floats, `clamp=true` → clamped edge, default REPEAT, non-finite UV → `[0,0,0,0]` (guards NaN propagation), null → white (safe for the opacity/godrays mask fallbacks, degenerate only per LGT-12).
- **BLENDMODE falsy-0 pattern**: absent in all files of this set *except* filmgrain/pulse (LGT-07) — godrays.js:28, blur.js:23, blend.js:15, tint.js:8, shimmer.js:27, glitter.js:22, blurradial.js:16, depthparallax.js:14 all use `!= null ? Number(…) : default`.
- **Dispatch signatures** (`effects.js:46-106`): every effect name → call arity matches its definition in the split files; try/catch + log per effect prevents one bad effect from killing the frame (which is currently masking LGT-01/LGT-02).
