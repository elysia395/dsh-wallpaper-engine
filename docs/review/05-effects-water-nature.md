# we-renderer review: effects (water & nature)

Scope: full read of `lib/we-renderer/effects/{waterwaves,waterflow,watercaustics,waterripple,clouds,cloudmotion,foliagesway,swing,shake,lightshafts}.js`;
skimmed `effects.js` (dispatch), `math.js` (`applyBlending`, `parseVec2/3`, `getVal`, `smoothstepFn`),
`model.js:676-702` (`_texSample`), `core.js:158-210` (`loadTexture` fallback chain), and
`docs/WE-REVERSE.md` (esp. §9.2 resolution-UV, §9.6 wrap modes).

Verification basis: (1) the one official shader available in-repo, `test/scene-gl-spike/assets/shaders__effects__waterripple.frag`,
against which `waterripple.js` was checked formula-by-formula; (2) each file's own header comment stating the
official shader math — code was checked against the comment it claims to implement; (3) node one-liner
replicas of the exact code for every numeric claim marked **[verified]**. The other nine official
shaders (waterwaves/waterflow/caustics/clouds/cloudmotion/foliagesway/swing/shake/lightshafts .frag/.vert)
are **not** present in the repo and no public mirror is indexed — where a finding depends on the official
text rather than internal arithmetic it is marked **needs official source** with what to check.

Severity legend:

- **P0** — crash / wrong result, blocks usage
- **P1** — clearly wrong vs official WE output
- **P2** — minor visual deviation, perf issue, or wrong-but-narrowly-triggered
- **P3** — nit, dead code, robustness, documentation

KNOWN/PENDING items already adjudicated (not re-derived, listed only for completeness): shake displacement
units missing ×w/×h; mask UV scaling using mask/object ratio instead of header/mip0 (=1) in
shake/waterripple-class effects; waterripple mask pure-uv (mSx=mSy=1, decided convention); canvas.clear (covered by base review).

---

## Findings

### WAT-01 — **P2** — `effects/shake.js:39-40` — `Math.round` on half-integer pixel coordinate: whole layer reads its right neighbour (+1 px shift) even at zero displacement **[verified]**

**What the code does.**
`const sx = Math.max(0, Math.min(w - 1, Math.round(u * w + offset * s2 * fmx)));` — with no flow texture
(`fmx = fmy = 0`, the common case for weak shakes) `sx = Math.round(x + 0.5)`, and `Math.round` rounds
`.5` up, so every output pixel x samples source pixel **x+1**.

**[verified]** (replica of the exact expression, w=1920): x=0 → `round(0.50)`=1; x=1 → 2; x=5 → 6;
x=100 → 101 — always +1. Sibling effect waterwaves uses `Math.floor(uu * w)` (`waterwaves.js:61`):
`floor(100.5)`=100 — no bias. Official shake.vert samples `v_TexCoord.xy` continuously (bilinear), which at
zero displacement resolves to exactly texel x (u=(x+0.5)/w is the texel center) — i.e. no shift.

**Expected.** Zero-displacement shake = pass-through; displacement = nearest/neighbour sample symmetric
around the texel.

**Fix.** Use `Math.floor(u * w + disp)` (like `waterwaves.js:61`) or `Math.round(u * w - 0.5 + disp)`.

### WAT-02 — **P2** — `effects/waterflow.js:23,44-46` (also `clouds.js:34`, `watercaustics.js:28-31`) — missing global texture degrades to white via `_texSample(null) = [1,1,1,1]`, which decodes as **maximum flow** → full-strength diagonal displacement **[verified]**

**What the code does.** `loadTexture('util/noflow')` returns `null` when neither the pkg nor
`weAssetsDir` provides it (`core.js:160-209` caches and returns `null`). `flowTex = null` then
`this._texSample(flowTex, u, v)` returns `[1,1,1,1]` (`model.js:677`), and the decode
`fx = (1 - 0.498) * 2 = 1.004, fy = 1.004` gives `flowAmount = 1.42` → clamped to 1 → **every pixel**
displaced by `1.004 * strength * 0.1 * cycle` up to `0.0502` UV.

**[verified]** replica: `flowAmount = hypot(1.004, 1.004) = 1.420` (clamp→1); max offset `0.0502` UV =
**96.4 px** diagonal @1920 w. Official fallback `util/noflow` is mid-gray 127 (see `client.js:218` note:
"官方默认 util/noflow 即中心灰"), decoding to ≈0 flow — the null-texture path inverts the intended
"no flow" meaning into "max flow".

Same class: `clouds.js:34` — missing `util/clouds_256` → `cloud0 = cloud1 = 1` → `cloudBlend = 1` →
smoothstep→1 → opaque cloud layer over the whole image; `watercaustics.js:28-31` — missing voronoi/perlin
→ constant 1 samples → white wash (and the WAT-03 NaN below). The client has a 1×1 gray fallback for
flowmask materials, but the renderer path does not.

**Expected.** Missing texture ≈ official no-op texture (mid-gray flow, mid-gray noise), not saturated
white.

**Fix.** In `loadTexture` (or per-effect), synthesize the official defaults when a `util/*`/`pattern/*`
global is unavailable: `noflow` = 1×1 (127,127), `uniform_256`/`perlin_256` = mid-gray, `clouds_256` =
mid-gray noise; at minimum treat `null` as (0.498, 0.498) in the flow decode sites.

### WAT-03 — **P2** — `effects/watercaustics.js:86` + `math.js:204-207` — `smoothstepFn(e0, e1, x)` with `e0 === e1` yields **NaN → zeroed output pixels**; reachable when `util/uniform_256` is missing **[verified]**

**What the code does.** `smoothstepFn` computes `(x - e0) / (e1 - e0)` with no `e0 === e1` guard.
MODE 0 edges are `blendColor[0] * 0.8` and `1.0 - blendColor[1] * 0.2`; with the missing-texture fallback
`blendColor = [1,1,1,1]` (`model.js:677`) both edges are **exactly 0.8**. For any sample x == 0.8 the
result is NaN; `Math.round(NaN * 255)` is NaN and a Uint8Array stores it as 0 → black pixel dots.
(MODE 0 otherwise survives via `sat()` folding ±Infinity to 0/1; only the exact-equality point NaNs.)

**[verified]** replica: `e0 = 0.8, e1 = 0.8, x = 0.8 → NaN`; `Math.round(NaN*255) = NaN`; `new Uint8Array([NaN])[0] === 0`. Also
verified the MODE 1 reversed-edge form `smoothstepFn(bt, bt - 0.001, cs)` inverts correctly (cs=0.25→1.000,
cs=0.35→0.000) — reversed edges per se are the intended official trick and are fine.

**Expected.** `e0 === e1` should behave as a step (GLSL leaves it undefined but ANGLE-style impls yield a
clean 0/1, never NaN).

**Fix.** Guard in `smoothstepFn`: `const d = e1 - e0; if (d === 0) return x < e0 ? 0 : 1;`.

### WAT-04 — **P2, KNOWN/PENDING** — `effects/waterwaves.js:29-30`, `watercaustics.js:37`, `foliagesway.js:31-32`, `swing.js:34-35`, `shake.js:16-17` — mask/flow UV scaled by **mask/object pixel ratio** instead of the decided header/mip0 (=1) convention

**(KNOWN deviation — listed for the ledger, not re-derived.)** These files compute
`mSx = maskTex.width / tex.width` (and height), i.e. when the mask texture is half the object size the
mask UV becomes `uv × 0.5` **[verified]**: uv=(0.781, 0.741) → maskUV=(0.391, 0.370) — the mask's
top-left quadrant is stretched over the whole object. Per WE-REVERSE §9.2 the official scale factor is
`g_TextureNResolution.zw / .xy` = header/mip0 = 1 for normal textures, i.e. pure uv — exactly what
`waterripple.js:35` (`mSx = 1, mSy = 1`, decided convention) and `cloudmotion.js:35,40` /
`clouds.js:75` (plain u,v) already do. So the five files above are internally inconsistent with the
project's own decided convention. Fix when picking this PENDING item up: replace the ratio with 1 (or a
real header/mip0 lookup), which also makes waterwaves/caustics/foliagesway/swing agree with
waterripple/cloudmotion/clouds.

### WAT-05 — **P2, KNOWN/PENDING** — `effects/shake.js:39-40` — displacement units missing ×w/×h (shake invisible at high res)

**(KNOWN deviation — not re-derived.)** `sx = … u * w + offset * s2 * fmx` adds the displacement in raw
pixel units while it is derived from a UV-space strength (`s2 = strength²`, default 0.1 → `s2 = 0.01`):
max ≈ 0.01·2 = 0.02 px — sub-pixel, hence "barely visible". Official shake.vert displaces the UV before
the resolution multiply. Listed per instructions; fix is `(u + offset * s2 * fmx) * w` (i.e. multiply
after displacement), done together with WAT-01 since it touches the same two lines.

### WAT-06 — **P2 (suspected — needs official source)** — `effects/waterwaves.js:15,51,55-56` — dual-wave composition: product `val1·val2` displaced along **off1 only**; `direction2`'s perpendicular never contributes a direction; `offset2` scaled by `speed2`; dual flag gap

**What the code does.** `dual = c.direction2 != null || c.scale2 != null` (line 15); the second wave only
enters as a scalar modulator: `uu += p1 * s1 * p2 * s2 * off1[0] * s * mf` (lines 55-56) — the
displacement direction is always the **wave-1 perpendicular** `off1 = (cos d1, −sin d1)`; `off2`
(computed at line 34) is dead. `dist2 = (t + offset2) * speed2 + …` (line 51) makes `offset2` a
*time* offset scaled by `speed2` (default 3) rather than a raw phase term.

**Why suspect.** Two alternative official forms are plausible: (a) additive second displacement
`+ off2 · val2 · strength² · mask` (two independent wave trains), or (b) product form but with
`sin(dist2 + g_Offset2)` (raw phase). Both differ visibly from the implementation: with (a) the wave-2
perpendicular direction would shear the surface along `off2` — the current code can never do that —
and with (b) `offset2 = 1` currently contributes `3 rad` of phase (×speed2) instead of 1.
**[verified]** (arithmetic): `offset2=1, speed2=3` → phase contribution `3 rad` vs `1 rad` under form (b);
`|displacement|max = |val1·val2|·|off1|·strength² ≤ 0.01 UV = 19.2 px @1920 w` (product form magnitude —
same cap as single-wave, whereas additive form (a) would cap at 2× that).

**Needs official source.** Compare against `waterwaves.frag` (`SECONDWAVE`/`DUALWAVE` block): the
composition operator, whether `off2` displaces independently, and whether `g_Offset2` is added before or
after `g_Speed2` multiplication. Also **[verified]** gap: `{speed2, exponent2, offset2}` set without
`direction2/scale2` → `dual = false` and wave 2 is silently dropped.

**Fix (after source check).** If official is additive: `uu += p2·s2·off2[0]·s2v·mf` as a second term (and
give wave 2 its own strength if the shader has one); if product: change line 51 to
`t * speed2 + … + offset2`. Either way widen line 15 to include `speed2/exponent2/offset2`.

### WAT-07 — **P2** — `effects/waterflow.js:53-56`, `cloudmotion.js:44`, `foliagesway.js:62`, `swing.js:81` — displaced **main-image** sampling uses REPEAT; project decision (WE-REVERSE §9.6) is CLAMP; waterwaves/shake/waterripple already clamp **[verified inconsistency]**

**What the code does.** These four sample the displaced UV through `this._texSample(tex, u ± d, v ± d)`
whose default is REPEAT (`model.js:684-687`), so a displacement that crosses the border wraps to the
opposite edge. Waterflow's max displacement is 0.05 UV (WAT-02) → up to ~5% of the border band shows
content mirrored from the opposite edge; swing's page-flip displacement near image borders does the same.
Meanwhile `waterwaves.js:61-62` and `shake.js:39-40` clamp indices to `[0, w-1]` and `waterripple.js:67-68`
clamps to `[0,1]` — per WE-REVERSE §9.6 ("主图 CPU 用 CLAMP … 跟已验收视觉") that is the accepted main-image
convention, so the same wallpaper class behaves differently depending on which effect runs.

**Expected.** One wrap policy for the main image (CLAMP per §9.6); REPEAT remains correct for
displacement/mask/normal/noise textures.

**Fix.** Pass `clamp = true` for the main-image samples in those four call sites (4th arg of
`_texSample`).

### WAT-08 — **P2 (perf)** — `effects/waterflow.js:57-64`, `watercaustics.js:41-93` — per-pixel closures and ~10 heap arrays/pixel; waterflow defines `mix2` **inside the pixel loop**

**What the code does.** `waterflow.js:57` re-creates the `mix2` arrow function for every pixel (one
closure allocation per pixel), and each pixel allocates 6 `_texSample` result arrays + 3 `mix2` result
arrays ≈ **9 arrays / 36 boxed numbers**; watercaustics allocates ≈10 arrays and makes 8-11 `_texSample`
calls per pixel (albedo, mask, shift, n1, n2, 3× voronoi chromatic, glow, blendColor, +particle in MODE 1).
`core.js:45-51` defaults the canvas to 3840×2160 and renders static frames at full resolution
("静态帧 … 不降采样") → ~8.3 M pixels: waterflow ≈ 75 M array allocations per frame, watercaustics ≈ 83 M
plus 70-90 M texture taps. The other effects allocate 1-4 arrays/pixel (every `_texSample` call allocates;
`waterwaves.js`/`shake.js` avoid it for the main image by indexing `src` directly — the good pattern).

**Expected.** Zero per-pixel heap allocation is achievable: hoist `mix2`/`smoothstep` out of the loop,
write channels into `out` directly, and add a channel-scoped sampler (e.g. `_texR` exists at
`model.js:646` already) for mask/noise/red-only samples.

**Fix.** Hoist the closures (1-line change), then switch hot loops to scalar sampling
(`_texR`/inline bilinear) writing straight into `out[di…]`; skip the alpha channel math where the effect
copies alpha through.

### WAT-09 — **P2 (suspected — needs official source)** — `effects/watercaustics.js:54-55` — perlin shift term applied at **full ±1 scale** while the two uniform-noise terms are scaled by 0.025

**What the code does.**
`cx += (n1−0.5)·2·0.025·distortion + (n2−0.5)·2·0.025·distortion + shift[0]·distortion` — `shift` comes
from perlin256 (±1 after decode) with **no** 0.025 factor. At `distortion` default 1 the caustics
coordinate can jump by ±1.0 granularity cell (granularity 2 → half the tile), i.e. the "fine ripple"
(0.025-scale terms) is dominated by a coarse smear from one noise channel.

**Needs official source.** caustics.frag distortion block — check whether the perlin shift is also
×0.025 (or ×0.0025), or whether it intentionally rides at full scale. Note the asymmetry is at least
suspicious given the comment on line 6 ("distortion 扰动" as one mechanism). Falsification: official
output with `distortion=0` still matches (both variants collapse), `distortion=1` on a test wallpaper
shows whether caustics tile smoothly (scaled shift) or jump cell-to-cell (current).

**Fix.** Pending source: likely `… + shift[0] * 0.025 * distortion` (mirror the uniform terms).

### WAT-10 — **P3** — `effects/cloudmotion.js:26` — `direction + Math.PI / 2` string-concatenates when the constant is stored as a string → NaN → all-black output **[verified]**

**What the code does.** `getVal` does no numeric coercion (`math.js:19-24`). Every other consumer
coerces implicitly (`Math.sin(dir)`, `t * speed` multiply-coerce), but this one **adds**:
`Math.cos(direction + Math.PI / 2)`. With `c.direction = "1.5708"` (string form appears in scene
constantshadervalues) the expression is `"1.57081.5707963267948966"` → NaN → `rxo/ryo` NaN →
`_texSample` returns `[0,0,0,0]` (`model.js:679`) → **black frame**.

**[verified]** replica: `"1.5707963267948966" + Math.PI/2` → `"1.57079632679489661.5707963267948966"`,
`cos → NaN`.

**Fix.** `const dir = Number(getVal(c, 'direction', Math.PI / 2)) || Math.PI / 2;` (or coerce in `getVal`
for scalar uniforms).

### WAT-11 — **P3 (suspected — needs official source)** — `effects/swing.js:58` — `sizeMod = size * (1 − |anim| · amount · 0.5)` double-applies `amount`

**What the code does.** `anim = sin(…) * amount` already carries `amount` (default 0.2); multiplying by
`amount` again makes the flap-width modulation ∝ `sin²·amount²` (max 2% of `size` at defaults:
**[verified]** `sizeMod(0.4) = 0.392` at |anim| max vs `0.360` for the plausible official
`size*(1 − |anim|/2)` — a 5× weaker modulation). The header comment (line 9) only says "sizeMod 边缘
feather" without the formula. Also unverified: the noise-mode clamp `anim = clamp(anim + sin(n)·noiseAmount, −1, 1)` (line 47).

**Needs official source.** swing.frag/vert mask section — check the `sizeMod` expression and whether the
noise sum is clamped. Fix accordingly (drop the inner `* amount` if official is `size*(1−|anim|·0.5)`).

### WAT-12 — **P3** — `effects/waterripple.js` (whole file) — SPECULAR branch and PERSPECTIVE=1 path unimplemented (silent)

The in-repo official `waterripple.frag:2,13-16,69-76` gates a specular highlight
(`SPECULAR == 1`: `direction = normalize(vec2(0.5,0) − uv)`, `pow(dot,…)*g_SpecularStrength` added to
rgb·a), and lines 44-58 implement the `PERSPECTIVE == 1` variant the CPU does not build
(`coordsRotated = v_TexCoordPerspective.xy / .z`, plus `mask *= step(0, .z)`). The header comment scopes
the CPU port to `PERSPECTIVE=0`, and the specular combo defaults to 0 — both acceptable — but a
wallpaper compiled with either combo on renders without any error, just silently different (specular
missing; perspective ripple computed with the flat formulas). Suggest a `combos.PERSPECTIVE === 1` /
`combos.SPECULAR === 1` log-once warning so the gap is diagnosable.

### WAT-13 — **P3** — `effects/waterwaves.js:24`, `waterripple.js:26`, `foliagesway.js:28` — mask enabled by **texture presence**, not `combos.MASK`

`const hasMask = !!pt[1] && pt[1] !== 'null'` ignores the official `MASK` combo gate
(`waterripple.frag:34`: `#if MASK == 1`). If a material binds something in texture slot 1 while MASK=0
(e.g. an unused binding), the CPU multiplies the displacement by that texture where the official shader
would not. The combo-gated effects (watercaustics:15, clouds:31, cloudmotion:19, swing:27) do this
correctly. Fix: `hasMask = (combos.MASK == 1) && pt[1] …`, falling back to texture presence only when the
combo is absent (as the other effects effectively do).

### WAT-14 — **P3** — `effects/lightshafts.js:56-59` — default `point0..point3` are one wallpaper's skewed quad; scenes omitting the points get an arbitrary shaft geometry; other defaults unverified

Defaults `0.67728 0.01297 / 0.76007 0.14043 / 0.46654 1.09592 / 0.16363 0.44881` are clearly traced from
a specific workshop wallpaper (5-decimal noise). A scene whose lightshafts material omits `point0-3`
inherits this random quad. The surrounding math, however, is **[verified] correct**: replica of
`sq2q`+`inv3`+row-vector apply maps `p0→(0,0), p1→(1,0), p2→(1,1), p3→(0,1)` exactly (w components
1.0000/1.0322/4.7204/4.1141), forward maps square corners→p0..p3 exactly, unit square→itself
(`(0.5,0.25)→(0.5, 0.25), w=1`), and the degenerate `det==0`/affine branch produces a well-formed affine
matrix (collinear input → row0 `1,0,0`). Rayspeed/rayscale/smoothness/feather/exponent/intensity/color
defaults match the header comments but could not be cross-checked against official metadata (no source
available) — same caveat for every other effect's defaults in this review (all consistent with their
own header comments).

**Fix.** Replace with the official editor defaults once a stock install's
`assets/shaders/effects/lightshafts.frag` header (uniform default annotations) can be read; meanwhile a
neutral quad (e.g. full-cover `0 0 / 1 0 / 1 1 / 0 1`) would be a saner fallback than another
wallpaper's values.

### WAT-15 — **P3** — `effects/watercaustics.js:28-31` — texture slot indices 2/3/4/5 assume the mask slot is always present in the material's texture list

The code unconditionally reads `pt[2]=voronoi_local, pt[3]=uniform_256, pt[4]=perlin_256, pt[5]=voronoi`
with `pt[1]` reserved for the mask. If the official material drops the mask binding when `MASK=0` (or
orders the pattern textures differently), every index shifts and the CPU silently samples the wrong
pattern (falls back only when the slot is *absent*, not when it holds the wrong texture). Needs one real
watercaustics material JSON (MASK=0 and MASK=1 variants) to confirm the fixed indices; consider keying by
the texture label/comment in the material instead of position.

### WAT-16 — **P3** — `effects/shake.js:9-11` — falsy `||` fallbacks corrupt legitimate zero values **[verified]**

`fx = fr[0] || 1` / `by = bd[1] || 1`: a user-configured `friction "0 2"` silently becomes `fx = 1`
(pow(x,0)=1 vs intended pow(x,0)… either way 0 and 1 both flatten the curve, but the *user's* 0 is
indistinguishable from "unset") and `bounds "0.2 0"` becomes `by = 1`, remapping the offset curve.
**[verified]** replica: `pv2('0 2') → {fx:1, fy:2}`; `pv2('0.2 0') → {bx:0.2, by:1}`. The `by - bx || 1`
div-guard (line 30) is fine and correctly prevents the ÷0. Fix: `fr[0] ?? 1`, `bd[1] ?? 1` (keep the
explicit `|| 1` only for the divisor).

### WAT-17 — **P3** — `effects/foliagesway.js:6` vs `:38-41`, `waterwaves.js:38` — stale/contradictory comments

`foliagesway.js:6` still documents the pre-fix math ("aspect=(h/w)×ratio") while lines 38-41 record the
fix ("aspect = texW/texH×ratio; 本地曾用 H/W → 反了") — the code (line 41 `(W/H)*ratio`) follows the fix;
line 6 should be deleted before someone "fixes" it back. `waterwaves.js:38` claims "低分辨率加速: 每 2x2
计算一次" but the loop below is per-pixel — the optimization either was removed or never landed; the
comment overstates current performance (relevant given WAT-08).

### WAT-18 — **P3** — `effects/clouds.js:22-25,61-74` — `parse4` zero-fills missing components (short vector inputs lose defaults); SHADING variants unverified

`parse4` maps `"0.01 0.01"` → `[0.01, 0.01, 0, 0]` — a user/scene vec2 silently zeroes the second cloud
layer's speed/scale instead of falling back to the documented defaults (`speed z/w = -0.02`, `scale
z/w = 0.5`). Also unverified against official clouds.frag (no source): SHADING≠0 multiplies the cloud
color by the **raw** product `cloud0·cloud1` (line 68, not the smoothstepped `cloudBlend`), and SHADING=0
mixes `color2→color1` with the post-alpha `blend` (line 63) — both plausible but only the header comment
backs them. Needs official `clouds.frag` SHADING block to close.

### WAT-19 — **P3** — `math.js:147,163` — `applyBlending` mode 20 is an exact duplicate of mode 4 (both linear burn)

`case 4` and `case 20` both compute `max(v + B − 1, 0)`. Official `common_blending.h` has ~32 distinct
modes; one of the two is likely a different operator (e.g. negation/subtract family) mis-copied.
Effects hitting it: any BLENDMODE=20 material (none of the ten files here default to 20 — watercaustics
defaults 32 `A·(1+B)`, lightshafts 31 `A + B·opacity`, both matching their header comments — but third
party / GLSL-fallback materials can). Verify against `common_blending.h` and fix case 20.

### WAT-20 — **P3** — `effects/waterflow.js:64` — mix factor clamped to 1 where official may overshoot

`mix2(s0, fa, Math.min(1, flowAmount))`: `flowAmount = length((rg−0.498)·2)` reaches 1.42 for saturated
flow textures; official `mix(albedo, fa, amount)` with amount>1 extrapolates past `fa` (brighter/saturated
banding at strong flow). The CPU clamp is safer but is an unflagged deviation from the literal formula
(the header comment itself writes `out = mix(原, fa, amount)`). Either drop the clamp (values are
re-clamped on the Uint8 write anyway) or note it as intentional in the comment.

---

## Verified OK

- **waterripple** — full pipeline matches the in-repo official `waterripple.frag` exactly:
  scroll `rotateVec2((0,1),dir)·scrollSpeed²·t` = `(−sin·ss²·t, cos·ss²·t)` (lines 42-43); ripple coords
  `(uv ± as²·t + scroll)·scale`, second sample `uv·1.333 − as²·t + scroll`, then `xz ×= texW/texH`,
  `yw ×= ratio` — **[verified]** order commutes with the official `*= scale → xz/yw` (numeric identity,
  both expressions bit-equal on sample inputs); dual normal sampling `n1/n2` with `n1.z×2−1` decode and
  `normalize(n1.xy+n2.xy, n1.z)` (lines 56-63, official frag lines 61-63); `strength²·mask` displacement
  (line 38, 67-68; official line 65); CLAMP on displaced main sample per §9.6; mask pure-uv is the
  documented decided convention. Defaults `0.1/0.15/1/0/0/1` match the official uniform annotations
  (frag lines 13, 23-27).
- **waterwaves single wave** — `vd = (−sin, cos)` is the correct official `rotateVec2((0,1), dir)` (the
  historical sign fix holds); `off = (vd.y, −vd.x)` perpendicular; `strength²` convention; `pow|sin|^exp · sign`
  (lines 46-48); displacement along off × mask; `floor`+clamp indexing (no WAT-01-style bias); CLAMP wrap.
- **waterflow cycle/blend** — **[verified]** curve: `blend` = 1→0.957→0.5→0.043→0 and `blend2` =
  0.5→0.156→0→0.156→0.5 at `st` = 0/0.1/0.25/0.4/0.5 (feather 0.4) — the zero-offset sample always wins at
  its own zero crossing, so the two-phase loop is seamless; `0.498` decode matches the noflow mid-gray
  convention (`client.js:218`); phasescale applied to the phase-texture UV; alpha passed through.
- **watercaustics structure** — chromatic 3-tap ±0.01·chromatic on x; `caustics = mix(caustics, glowSample, blur)`;
  MODE 1 threshold/particle via intentionally reversed smoothstep edges (**[verified]** inversion clean);
  MODE 0 threshold `smoothstep(blendColor.r·0.8, 1−blendColor.g·0.2, …)` matches its header comment;
  alpha preserved; output clamped before Uint8 write (lines 95-97).
- **clouds vert UV** — `(uv + t·speed)·scale` with `xz ×= aspect`, second sample `zw = (−w, z)` (lines
  50-54) matches its header comment; `cloudBlend = r·r` → smoothstep(threshold, threshold+feather) → ×alpha;
  WRITEALPHA path; mask plain-uv (consistent with ratio=1 convention).
- **cloudmotion** — noise coords `u·(W/H)·scale·scaleX + t·speed`, `v·scale`; offset `(noise.r·2−1)·amount·mask`
  rotated by `direction+π/2` with correct `rotateVec2((ox,0),θ) = (ox·cosθ, ox·sinθ)` (line 37); MASK
  mix(uv, uvs, dstMask) including the second mask sample at the displaced position (lines 39-42) per comment.
- **foliagesway** — `aspect = (W/H)·ratio` (the recorded fix), `rotDir = rotate(1/aspect, aspect)` (lines
  41-42) correct `rotateVec2` form; `amp = strength²·0.005`; phase `(noise.g·2π + rot(uv).x·10 + rot(uv).y·5)·phase`;
  the 4-term sine/cosine weight tables match the header comment exactly (lines 45-46);
  **[verified]** sane magnitude: max sway ≈ 0.006 UV ≈ 11.5 px @1920 w at defaults; mask multiplies amp.
- **swing** — aspect-corrected axis/center/ortho decomposition (lines 50-56); distortion
  `axis·anim·dOrtho·dAlong + ortho·anim²·dOrtho` (lines 67-68) matches the header formula; reversed-edge
  smoothstep masks with feather (lines 73-77); mask texture gated by combo; back-transform `tx2/aspect`
  (line 79); `feather2 = max(feather, 1e-5)` div-guard.
- **shake (besides WAT-01/05/16)** — official offset curve faithfully ported: `sin(frac(t/π2)·π2)·0.498+0.5`,
  `cos(time)≥0` branch selection matching `g_Friction.x/y` order, bounds normalize with `|| 1` div-guard,
  `×2−1`; flow decode `(rg−0.498)·2` consistent with waterflow; CLAMP on final index.
- **lightshafts** — `sq2q`/`inv3`/row-vector apply **[verified]**: quad points map exactly to unit-square
  corners and back; identity quad is identity; `det==0` and `sum==0` degenerate branches well-formed;
  `step(0, fx.z)` mask; reversed-edge center masks; `isFinite` guard on the noise value and explicit
  `[0,1]` clamp on the gradient color — both required on CPU (GPU auto-clamps), correctly commented at
  lines 102-113; alpha `max(a, fx)`; BLENDMODE 31 default = additive `A + B·opacity` per comment.
- **dispatch** (`effects.js:32-114`) — all ten effects routed to the right entry point (waterripple gets
  the extra `ef` arg), per-effect try/catch with log, `visible` gate, `pass.combos`/`pass.textures` plumbing.
- **model.js `_texSample` (676-702)** — REPEAT default is correct for displacement/mask/normal/noise
  textures (official REPEAT per §9.6); non-finite coordinate guard (line 679) prevents NaN propagation;
  bilinear + `((u%1)+1)%1` wrap correct; 4th-arg clamp available and (per WAT-07) underused.
- **math.js `applyBlending`** — output clamped to [0,1] (line 178) prevents Uint8 wrap-around of negative
  blend results (the lightshafts black-patch class is already fixed); modes 31/32 match the two defaults
  used by these effects; `parseVec2/3` handle number/array/string; `getVal` unwraps `{value}` wrappers.
