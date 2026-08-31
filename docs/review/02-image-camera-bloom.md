# we-renderer review: image / camera / bloom

Scope: `lib/we-renderer/image.js` (full), `lib/we-renderer/camera.js` (full), `lib/we-renderer/bloom.js` (full); shared helpers consulted for semantics only: `math.js` (`parseVec3/parseVec2/getVal/applyBlending`), `canvas.js` (`blitScaled/blitRotated/blit`), `model.js:676-702` (`_texSample`) plus the `_rasterizeMesh3D`/`_makeShadeFn` consumers needed to judge the fullscreen-shader path, `core.js` (`_downsample`, `resolveTransform`, `loadModelTexture`, render loop, `_readUserProps`), and `effects/waterwaves.js` as a mask-UV consumer. Reference semantics: `docs/WE-REVERSE.md` (§3.4/3.5 view shift, §7 placement, §9.1 y-down/GL-spike arbitration), `docs/review/01-base-pipeline.md` (BASE-01/02/03 etc. — referenced, not re-derived).

Severity: P0 = crash / wrong result blocking; P1 = clearly wrong vs official WE; P2 = minor visual / perf / robustness; P3 = nit / needs-official-confirmation.

All claims marked **[verified]** were reproduced numerically in this review (code-index math re-executed, not just read off the source). Findings whose divergence depends on official shader/engine sources I could not consult are marked *unverified-vs-official* and graded conservatively.

---

## Findings

### IMG-01 — P1 — `image.js:16-28` — fullscreen custom-shader quad is vertically flipped vs the arbitrated official UV convention **[verified]**

- **What the code does**: `_renderFullscreenShader` builds a screen-space quad with `positions = [(-1,-1),(1,-1),(-1,1),(1,1)]` and `uvs = [(0,0),(1,0),(0,1),(1,1)]`, mapped by `sx = (px·0.5+0.5)·W`, `sy = (0.5 − py·0.5)·H`. Numeric trace (W=1920, H=1080): vertex 0 → canvas `(0,1080)` (bottom-left) with uv `(0,0)`; vertex 2 → canvas `(0,0)` (**top**-left) with uv `(0,1)`. So the canvas **top row samples v=1**. `_rasterizeMesh3D` (`model.js:196-197,218`) interpolates `u,v` verbatim and every CPU port samples via `_texSample`, where `v=0` → row 0 = **image top** (`model.js:688-699`). Therefore the whole fullscreen layer is evaluated with `v` mirrored: the texture top is drawn at the canvas bottom.
- **Expected**: WE-REVERSE §9.1 (GL-spike arbitrated, MAD ≈ filter floor) fixes the official convention: quad **top edge ↔ v=0 ↔ tex row 0 ↔ screen top** (D3D y-down chain). Scene-level custom-shader objects go through the same genericimage vertex pipeline, so the same convention applies. No CPU port compensates — e.g. `_shadeCloudsBg` (`model.js:443-465`) uses raw `v` for `lift = smoothstep(0.5,0,v)²·2` and `hdy = (v−0.6)·…`, so its horizon glow (authored toward the lower-middle of the frame) lands near the canvas **top**; `_shadeFlowImage` (`model.js:270-313`) renders its layer textures upside down. Every shader in `_customShaders` (`image.js:448-453`) is v-asymmetric except pure-noise cases.
- **Impact**: all `_customShaders` fullscreen layers (cloudsbg, neonsun, neongrid, dna, core, curve, bg, flowimage) render mirrored in v vs official WE. For procedural skies this silently re-composes the scene; for texture-sampling shaders (flowimage) it is an outright flip.
- **Fix**: flip the v column of the quad: `const uvs = [[0,1],[1,1],[0,0],[1,0]];` (canvas top vertex then carries v=0). Do **not** change `_rasterizeMesh3D` or `_texSample` — the puppet/generic path feeds mesh-authored UVs and is consistent with §9.1 already. After the fix, re-check the CPU shader ports (`model.js:253-265`) for any tuning that accidentally compensated for the flip.

### IMG-02 — P1 — `bloom.js:41-59,67-91` (and the `_applyBloom` copy at `bloom.js:166-222`) — HDR bloom channel is computed and **summed unconditionally**; with default `bloomhdrfeather = 0` it saturates to full strength and over-blooms every non-HDR scene **[verified]**

- **What the code does**: the HDR quarter-res pass is always built (`bloom.js:41-59`) and always added to the LDR bloom at combine time: `br = (blur[o] + blurHdr[o]) * eff` (`bloom.js:75-77`, mixin copy `204-206`) — both when `gen.hdr` is true (linearized combine) and when it is false (plain `data + bloom·255`, `86-89`). The HDR gate `k = sat((scale − hdrThreshold) / max(0.001, hdrFeather))` (`bloom.js:53,180`) uses the feather only as a **divisor**; the default `hdrFeather = 0` collapses to divisor 0.001, i.e. a hard step: k = 1 for any `scale > hdrThreshold + 0.001`. And `hdrThreshold`/`hdrStrength` default to the plain bloom `threshold`/`strength` (`131-132`).
- **Numeric check** (code replica, threshold 0.65, strength 1, tint 1, scatter 1 → eff 0.25, blur ≈ identity on a flat region): pixel 230,230,230 → `scale=0.902`, LDR `k=0.252` → LDR-only add `0.0568`; code add `(0.252·avg + 1.0·avg)·0.25 = 0.2823` → **4.97×** official LDR-only. Pixel 179,179,179 → `scale=0.702`, LDR `k=0.052` → code add **20.25×** the LDR term. Pixel 128,64,32 → below threshold, both 0 (OK). The HDR term (multiplied by ~1, not by `scale−th`) dominates the sum.
- **Expected**: per the file's own header the engine chain is `downsample_quarter_bloom → combine_hdr`; the HDR bloom parameters (`bloomhdrthreshold/strength/scatter/feather`) exist for the HDR path (`gen.hdr`), which the combine itself already branches on (`bloom.js:67,196`). For a non-HDR scene the engine's visible bloom is the LDR bright pass (`albedo *= saturate(scale − threshold)`, then saturation boost, `×strength×tint`); the summed HDR term has no counterpart there.
- **Impact**: every scene with `bloom: true` and no `hdr: true` (the overwhelming majority) blooms several times stronger than official, with a hard-threshold character (feather step) instead of the LDR `scale−threshold` attenuation.
- **Fix**: gate the HDR channel on the same `gen.hdr === true` flag (skip its allocation/blur/sum when false), and/or replace the linear feather ramp with the LDR-style attenuation; if the engine really does sum both chains for LDR scenes, cite the combine shader lines — as written the defaults make the sum ≈ a second full-strength bloom.

### IMG-03 — P2 — `image.js:173-178` vs `179-191` — rotated objects silently lose **parallax** and **colorBlendMode** (control-flow verified)

- **What the code does**: the `tr.angle !== 0` branch calls `blitRotated` and `return`s **before** the parallax block (`179-187`) executes, and `canvas.blitRotated` (`canvas.js:89-144`) has no blend-mode parameter at all — `cbm` (`190-191`) is only reachable on the non-rotated `blitScaled` call.
- **Expected**: official WE applies the parallax translation and `colorBlendMode` pass as part of the object's model matrix / BLENDMODE state, independent of rotation (`lwe CImage.cpp:1111` parallax, `:751` colorBlendMode — both cited in this file's own comments).
- **Impact**: any object that is both rotated and parallax-layered (e.g. rotated clouds/decor on a parallax scene) stops responding to mouse parallax; any rotated object with `colorBlendMode > 0` composites with plain source-over instead. Both diverge only for the rotated subset, so the bug hides per-object.
- **Fix**: hoist the parallax computation above the rotation branch and pass `dx+pdx, dy+pdy` into `blitRotated`; add a `blendMode` parameter to `blitRotated` (same `applyBlending` per-pixel path `blitScaled` uses at `canvas.js:65-76`) or pre-blend a snapshot of the destination region.

### IMG-04 — P2 — `image.js:162-172` + `core.js:694-720` + `effects/waterwaves.js:29-30` — the effects pre-downsample changes resolution-dependent effect math (maskRes/objRes ratios), so animated frames diverge from static frames **[verified ratio math]**

- **What the code does**: on animated frames (`!staticFrame`) the texture is box-downsampled to `maxDisp = max(|dw|,|dh|)` before `applyEffects` (`167-169`). The aspect is preserved (`_downsample` scales by `maxSize/max(w,h)`, `core.js:696`), so pure-UV effect math is fine — but effects that scale mask UVs by a resolution **ratio** now see a different denominator: `effectWaterwaves` computes `mSx = maskTex.width / tex.width` (`waterwaves.js:29-30`, same pattern family as foliagesway/swing/filmgrain per their headers). Example: 4096-wide object with a 1920-wide mask → static frame ratio `1920/4096 = 0.469`; animated frame downsamples tex to 1920 → ratio `1920/1920 = 1.0` (2.13× bigger). Mask UVs `u·mSx` scale accordingly → the mask region that gates the displacement covers a different area, so the same wallpaper renders with visibly different effect extent in the static preview vs the animation. (The mask itself is loaded full-res — `loadTexture(pt[1])`, `waterwaves.js:25`.)
- **Expected**: the official chain runs effects at full resolution with `g_TextureNResolution` fixed per texture; the CPU perf heuristic (documented at `image.js:163-166`) must not change the *values* effects compute, only their sampling density. Note the related arbitration in `01-base-pipeline.md` "Known/pending #2" — whether the ratio should be mask/obj at all is under arbitration, but whichever convention wins, it must not flip by 2× between static and animated frames.
- **Fix**: any of (a) downsample mask/aux textures with the same factor so ratios are invariant; (b) pass the original object resolution to effects (e.g. stash `img.fullWidth` alongside the downsampled copy and use it in ratio computations); (c) skip the downsample for objects whose effect set includes resolution-ratio consumers.

### IMG-05 — P2 — `camera.js:227-231` vs `image.js:134-137` — camera zoom (path/camera-object) never reaches the 2D image path; ortho entry-zoom animations scale puppets but not images

- **What the code does**: `camZoom` (camera-path `zoom` lerp, or camera-object `zoom` override at `223-226`) is applied **only** by dividing the ortho projection half-extents (`228-229`), i.e. only geometry routed through `camProj`/`camVP` zooms — that is puppets/3D (`model.js:73`). The image/solid/passthrough 2D path computes `ps = [W/ortho.width, H/(ortho.height||1080)]` (`image.js:134-135`, `208`, `259`) with no zoom factor and no re-anchoring, so image layers keep constant size while the camera zoom animates. Grep confirms no other consumer of `camZoom`.
- **Expected**: an ortho zoom (range ÷ zoom) scales the whole scene — positions *and* sizes — about the screen center (the code's own comment `camera.js:219-221` cites entry animations `zoom 2.15→1` as "画面放大"). For image-based scenes (the common case for camera-object entry animations, cf. Mutsumi sf33) the zoom leg of the animation is currently a no-op; in mixed scenes puppets zoom while images don't (relative mismatch).
- **Fix**: in the 2D path use `ps' = ps · camZoom` and re-anchor positions about the canvas center: `dx = W/2 + (origin.x·ps − W/2)·camZoom + vs[0]` (same for y), or document the limitation next to `_viewShift`.

### IMG-06 — P2 — `camera.js:222-226` vs `233-242` — the perspective branch ignores the camera-object zoom override, and the `gen.zoom` fallback is dead code

- **What the code does**: `camZoom` (with the camera-object override, `223-226`) is consumed only inside the ortho branch (`228-229`). The perspective branch re-derives `const zoom = camPose.zoom != null ? camPose.zoom : (gen.zoom != null ? gen.zoom : 1)` (`236`) — but `camPose.zoom` is **always** non-null (`_resolveCameraPose` defaults `zoom: 1`, `camera.js:102`, and every return path sets it), so (a) the camera-object zoom override never applies in perspective scenes, and (b) `gen.zoom` is unreachable dead fallback (it is also questionable schema-wise — `zoom` is not a documented `general` field).
- **Related**: the camera-object zoom override at `223-226` is gated only on `camObj` being selected, not on `_camObjDriven` — a camera object whose origin was *not* adopted (scene.camera.eye explicitly set) still donates its `zoom`, mixing eye source and zoom source.
- **Expected**: one zoom resolution path for both projections; if entry-animation camera objects are meaningful in perspective scenes, their `zoom` must multiply `proj[0]/proj[5]` there exactly as `camZoom` divides the ortho range.
- **Fix**: use `camZoom` in the perspective branch (`this.camProj[0] *= camZoom; this.camProj[5] *= camZoom;`), delete the dead `gen.zoom` fallback, and decide whether the zoom override requires `_camObjDriven`.

### IMG-07 — P2 — `image.js:115-118` — spritesheet frame crop uses `||` fallbacks, so an authored frame at `x: 0` (grids / vertical strips) crops the wrong region **[verified]**

- **What the code does**: `fx = f.x || frameIdx * fw` (and `fy = f.y || 0`, `fw = f.width || …`, `fh = f.height || …`). `0` is falsy, so any frame whose metadata legitimately says `x = 0` falls back to the horizontal-strip guess `frameIdx·fw`.
- **Numeric check**: TEXS 2×2 grid (512×512, 256×256 frames), frame index 2 authored at `x=0, y=256` → code crops `x = 2·256 = 512, y = 256` — entirely the wrong half of the texture (and columns `512..767` past the last real column are silently zero-filled by the clamped `subarray`/`set` at `121`, i.e. transparent garbage on the frame's right edge).
- **Expected**: frame metadata, when present, is authoritative; the strip-position guess is only for *missing* fields (`lwe` TEXS frame table per WE-REVERSE §7.2). Also note `frameIdx` itself rides on the frame-0-only `duration` (BASE-24 — referenced, not re-derived).
- **Fix**: `const fx = f.x != null ? f.x : frameIdx * fw; const fy = f.y != null ? f.y : 0; const fw = f.width != null ? f.width : Math.floor(tex.width / fr.count); …`, and clamp the copy loop's column range (`fx + fw ≤ tex.width`) or zero-fill explicitly.

### IMG-08 — P2 — `image.js:40-46` (`_materialUniforms`) — boolean (checkbox) and non-numeric user properties become `NaN` uniforms

- **What the code does**: `out[uniform] = typeof v === 'number' ? v : parseFloat(v)`. `this.userProps` stores raw `project.json` `properties[k].value` (`core.js:75-91`), and checkbox properties store **booleans**: `parseFloat(true)` → `NaN`, which flows into every consumer (`uniforms.Speed`, `uniforms.tint`, `uniforms.Amount`, …) and then into per-pixel math — a NaN tint/speed turns the whole layer black/garbage. Object-valued entries (if any slip through unwrapping) NaN the same way. `false != null` passes the guard at line 42, so "property off" ≠ "property absent".
- **Expected**: official `usershadervalues` binds scalars (float/int/bool → 0/1) and vectors; a checkbox toggles a 0/1 uniform.
- **Fix**: `if (typeof v === 'boolean') out[uniform] = v ? 1 : 0; else if (typeof v === 'number' && isFinite(v)) …` and guard the `parseFloat` result with `Number.isFinite` (drop the uniform otherwise so the shader default applies).

### IMG-09 — P3 — `image.js:184-186` + `camera.js:253-256` — parallax `referenceSize` uses canvas width for **both** axes, and the mouse-y convention is unflipped (*unverified-vs-official*)

- **What the code does**: `ref = this.W` multiplies both `pdx` and `pdy` of the cited official formula `(depth + amount) · displacement · referenceSize` (`lwe CImage.cpp:1111`). If official `referenceSize` is per-axis (or the ortho vec2), the y-displacement is off by the aspect (16:9 → 1.78× too strong vertically). Additionally `centeredMouse = [mx − 0.5, my − 0.5]` (`camera.js:255-256`) uses `opts.mouse` y in whatever convention the caller passed, while every other y in the pipeline is flipped (scene y up / canvas y down); the vertical parallax **direction** is therefore convention-dependent and unverified. The engine's `delay` smoothing (`lwe CScene.cpp:304` `mix(disp, centeredMouse·amount·influence, delay)` — cited at `camera.js:245`) is not implemented (irrelevant for a fixed mouse, relevant if `opts.mouse` animates).
- **Fix**: verify `referenceSize` and the mouse-y sign against lwe `CImage.cpp:1111` / `CScene.cpp:304`; expected shape is `ref = [orthoWidth, orthoHeight]` (scene units, then ×ps) or `[W, H]`, and `centeredMouse.y` negated if mouse is top-origin.

### IMG-10 — P3 — `image.js:196-235` (`_renderSolidLayer`) — solid layers have no parallax at all

- **What the code does**: the solid-layer path computes size/viewShift/alignment but never reads `parallaxDepth`/`this.parallaxDisp` — compare `renderImage:179-187`. `parallaxDepth` is even in the animation bake list (`core.js:607`), so an animated solid layer still won't move.
- **Expected**: solidlayer is a regular scene object in WE; the parallax translation applies to it identically.
- **Fix**: extract the parallax block (IMG-03 hoist) into a helper `_parallaxOffset(o)` and add it to `dx/dy` here too.

### IMG-11 — P3 — `image.js:52-59` and `140-143` — view-shift comments contradict the shipped code and the arbitrated docs

- **What the code does**: the block comment at `52-59` asserts the standard-LookAt y translation (`vs[1] = +ey×ps`) is "修复后组件垂直位置对齐官方", but `_viewShift` (`camera.js:287-288`) deliberately returns `y = 0` for `scene.camera.eye` and `+ey` only for camera-object-driven eyes — which is exactly the sf32/sf33 arbitration recorded in WE-REVERSE §3.5 ("sf29 曾按标准 LookAt 推导 vs[1]=+eye.y×ps, 实测与官方相反 → 移除"). Lines `140-143` are additionally a garbled duplication ("…y 平移方向相反 (差 2×eye.y×ps) —" twice).
- **Risk**: the comment invites a future "fix" that re-introduces the y shift for `scene.camera.eye` and undoes the user-verified arbitration.
- **Fix**: rewrite the comment to match `_viewShift` + WE-REVERSE §3.5 (scene.eye → x only; camera-object origin → x+y), and delete the duplicated sentence.

### IMG-12 — P3 — `image.js:310-311` — `_swayImage` claims a ½-resolution "step 2" optimization that is not implemented

- **What the code does**: `const step = 2;` is declared with a comment ("步进 2 (性能): 摆动是低频, 1/2 分辨率计算后平滑") but the loops below iterate `x++`/`y++` over every pixel; `step` is never read. Full-resolution work with none of the promised savings (and no smoothing pass).
- **Fix**: either implement 2×2 stepping + bilinear expansion (as the GLSL path does in `glsl/integration.js:117-127`) or delete the variable/comment.

### IMG-13 — P3 — `image.js:394` (`_flagImage`) — flag output alpha is forced to 255; source albedo alpha discarded (plus full-res perf note)

- **What the code does**: `out[di + 3] = 255` unconditionally, and the TINT branch (`369-382`) never reads `albedo[3]` — a flag texture with transparent/soft edges renders as an opaque rectangle (black where albedo ≈ 0). Also note `_swayImage`/`_flagImage`/`_retroImage` run at **full** texture resolution every frame (they precede the effects downsample at `image.js:162-172` and never participate in it) — the same 4K-per-frame CPU cost the effects chain was architected to avoid.
- **Expected**: official flag.frag propagates the sampled albedo alpha (`lwe`/WE assets `flag.frag` — *unverified-vs-official*, but forcing 1 is unlikely to match any authored flag with cut-outs).
- **Fix**: carry `albedo[3]` into `out[di+3]` (scaled by the object alpha later anyway), and consider routing these preprocessors through the same downsample/step machinery as effects for animated frames.

### IMG-14 — P3 — `image.js:402-444` (`_retroImage`) — several details deviate-from-or-are-unverifiable-against official retro.frag/vert (*unverified-vs-official*)

- `u*0.997, v*0.997` (`416`): sampling is shrunk toward the origin with no centering offset (`+0.0015`), so the artwork sits ~0.15% up-left of official if official centers the inset.
- DOTS scroll `u -= t*0.02` (`415`) is applied to the **albedo sample and grunge UV** as well as the dot kernel — if official scrolls only the dot phase (`v_TexCoordDots`), the whole artwork drifts left over time in DSH.
- Grunge aspect `grungeTex.height/grungeTex.width` multiplies `gu` only (`411,418`); official `v_TexCoordGrunge = clip.xy/w · 0.75 · aspect` (comment `417`) may apply aspect to v or use w/h — direction unverified.
- Signature takes `W, H` (`402`, passed at `106`) but never uses them — dead parameters.
- **Fix**: pull the actual `assets/shaders/source/retro.frag`/`.vert` (they ship with WE per WE-REVERSE §5.5) and pin each line; until then leave a "unverified" comment on these four spots.

### IMG-15 — P3 — `image.js:127-128` (and `202-203`) — size fallback replaces **both** dimensions when **either** is 0

- **What the code does**: `if ((size[0] === 0 || size[1] === 0) && tex) size = [tex.width, tex.height];` — an authored `size = "1920 0"` (explicit width, missing height) becomes the full texture size, discarding the authored 1920.
- **Expected**: autosize semantics fill in *missing* dimensions only (`WE-REVERSE §7.2`: `size` 缺失时回退纹理尺寸); present non-zero components should survive.
- **Fix**: per-dimension fallback: `if (size[0] === 0) size[0] = tex.width; if (size[1] === 0) size[1] = tex.height;` (keep the both-zero full replace if preferred, but don't discard a authored component). Also worth a guard: a malformed `"abc 0"` size yields `NaN` here and silently skips the object in `blitScaled` (see BASE-30 for the parse-level fix).

### IMG-16 — P3 — `camera.js:280` (`_viewShift`) + `image.js:256-260` — background detection is a size heuristic; passthrough compose fallback flips behavior with render resolution

- **What the code does**: `isBg = size[0] >= orthoW-1 && size[1] >= orthoH-1`. Officially the background short-circuit is an object flag (`0x304` bit `0x1100`, WE-REVERSE §3.4) — a foreground overlay that happens to span the full ortho size (parallax foreground, fullscreen compose layer) silently loses the view shift. Separately, `_renderPassthroughLayer`'s compose branch falls back to `size = [W, H]` in **canvas pixels** (`257`) and then feeds that to `_viewShift` whose `isBg` compares against **scene units**: at 3840-wide renders `isBg` is true (no shift), at ≤1920-wide renders it is false (shift applied) — same scene, resolution-dependent behavior.
- **Fix**: for the passthrough fallback use ortho units (`[ortho.width, ortho.height]`) so the comparison is stable; longer term, plumb an explicit background flag (e.g. `size == ortho && origin == 0 && z-order first`) instead of raw size comparison.

### IMG-17 — P3 — `image.js:175` — `img.rotated` is dead code

- No producer anywhere sets `.rotated` (grep over `lib/we-renderer/**`): `const rotated = img.rotated || img;` always yields `img`. Either an effect was supposed to flag pre-rotated output (then implement it) or delete the clause.

### IMG-18 — P3 — `image.js:74-77` — the `_customShaders` route force-renders a **fullscreen** quad and ignores object alpha/transform

- Any object whose material shader is in `_customShaders` bypasses `resolveTransform`, `size`, `alpha`, `brightness`, `colorBlendMode`, and parallax, and is drawn as a full-canvas quad (`8-33`). For genuine fullscreen layers that is the intent (comment at `70`), but `flowimage` (in the set, `450`) is also used on positioned objects; such an object renders stretched over the whole canvas at the wrong place, and an object-level `alpha` animation on any of these layers is dropped (the shade fns return their own alpha, e.g. `_shadeFlowImage` `model.js:274,312`).
- **Fix**: gate the fullscreen route on `model.fullscreen` (or quad-covering size) and fall through to the normal path otherwise; multiply the shade result by `getVal(o,'alpha',1)`.

### IMG-19 — P3 — `bloom.js:53,179-180` + `69-77/198-206` — HDR feather is a linear ramp (comment says smoothstep) and the combine upsamples quarter-res bloom nearest-neighbor

- `k = sat((scale − th)/max(0.001, feather))` is a linear ramp, not the "smoothstep 过渡" the comment at `179` claims (also the divisor guard makes `feather ≤ 0.001` a hard step — see IMG-02). The combine loop maps full-res pixels to quarter-res cells with `floor(x·sw/W)` (`70-72`, `199-201`) — blocky bloom structure on high-contrast edges; a bilinear fetch (or the engine's upsample chain) would be closer to official. Minor: `blurQuarter` is a non-separable O(r²) box (`94-112`, `227-245`) — separable would cut cost for `hdrScatter > 2`.

### IMG-20 — P3 — `bloom.js:19-19,207-214` (mixin `140,208-214`) — HDR combine linearizes input but never re-encodes to sRGB (*unverified-vs-official*)

- The `isHdr` branch computes `lin(data/255) + bloom` and writes `sat(·)·255` back into the same sRGB buffer — `lin(0.5) ≈ 0.214`, so unless the engine's `combine_hdr` output is consumed by a later gamma-encoding pass that DSH doesn't emulate, HDR-enabled scenes render ≈2× darker mid-grey. The `exposure` constant is hard-coded 1 (`16,135`) with a "近近似 1" comment. Needs the actual `combine_hdr.frag` + present-pass encoding to adjudicate; if none exists, drop `lin()` (treat the buffer as display-referred like the LDR branch).

### IMG-21 — P3 — `math.js:54-59` via `camera.js:70,147-151,215` — degenerate `mat4LookAt` when `eye == center` (camera-path keyframe) collapses the view silently

- `v3norm` maps a zero vector to `[0,0,0]` (`math.js:31`, `|| 1` guard), so an interpolated camera pose with `eye == center` (reachable when a path lerps eye onto center, or authored `0 0 0` for both) yields an all-zero basis → `camVP` zeros → puppets/3D vanish with no log. Add a guard in `mat4LookAt` (fallback up-vector / identity) or clamp in `_resolveCameraPose`.

### IMG-22 — P3 — `image.js:134-135` etc. — perspective scenes fall back to raw-pixel placement for all 2D layers

- With no `orthogonalprojection`, `ps = null` and `origin` is interpreted as canvas pixels (and `_viewShift` bails via `isBg`/`camEye` semantics) — i.e. for perspective scenes the entire 2D blit path ignores the camera. This is a reasonable documented-in-spirit approximation (DSH targets 2D scenes), but nothing logs or documents it; a one-line comment + a `log` once per scene would prevent false bug reports on 3D wallpapers.

### IMG-23 — P3 — `image.js:135,208,259` + `camera.js:229` — `ortho.height || 1080` invents a vertical ortho size

- If a scene specifies `orthogonalprojection.width` but a missing/zero `height`, the vertical scene→pixel scale becomes `H/1080` regardless of the scene's actual coordinate extent — vertical placement/scale silently wrong. Better fallback: derive height from width and canvas aspect (`ortho.height || ortho.width·H/W`), or skip the `ps` scale entirely when only width exists.

---

## Verified OK (spot-checked against official semantics / docs)

- **Alignment** (`image.js:149-154`, `215-220`) **[verified numerically]**: with `ps=1`, origin y=540, h=200 → center dy=440 (rect 440–640), `top` → dy=540 (rect extends downward from origin), `bottom` → dy=340 — matches the cited `CImage.cpp:242-256` edge-anchoring semantics in canvas (y-down) space; left/right are symmetric and correct.
- **View-shift signs**: `vs[0] = −eye.x·ps` added to canvas x is the standard LookAt x translation (world point → `(p.x − eye.x)·ps`); `vs[1] = +eye.y·ps` for camera-object-driven eyes and **0** for `scene.camera.eye` matches the sf32/sf33 arbitration (WE-REVERSE §3.5) and is applied identically in `renderImage` (`145`), `_renderSolidLayer` (`214`), and `_renderPassthroughLayer` (`264`). The `dy = H − oy·ps − dh/2` flip (scene y up → canvas y down) with center anchoring is correct per WE-REVERSE §7.3.
- **Effects-downsample aspect** (`core.js:694-720`): scale = `maxSize/max(w,h)` preserves the **texture** aspect, which is the space effect UV math lives in — the "等比 aspect 保持" claim is true (the residual issue is resolution-*ratio* inputs, IMG-04, and straight-alpha averaging, BASE-14).
- **Camera paths** (`camera.js:106-152`): multi-path sequential loop with `len = max(lastTimestamp, duration)`, global-time modulo, per-path clamp to last keyframe, lerp of eye/center/up (up re-normalized) and zoom; sorting works on the `filter`ed copy (no scene mutation). Pure duplicate `resolveCameraPose` matches (drift tracked as BASE-33).
- **Parallax formula shape** (`image.js:181-187`): `(depth + amount) · displacement · ref` with `depth = parallaxDepth` (animated, `{value}`-unwrapped) and `amount = camera.parallax.amount` matches the cited `lwe CImage.cpp:1111` form; `parallaxDisp = centeredMouse·amount·mouseinfluence` matches the cited `CScene.cpp:304` modulo the unimplemented `delay` (IMG-09).
- **Spritesheet crop mechanics** (`image.js:119-122`): row loop guarded by `fy + y < tex.height`; short `subarray`+`set` degrades to zero-fill rather than throwing (column overrun noted in IMG-07); new texture object per frame — the cached texture is never mutated (no cross-frame pollution).
- **Multi-frame reuse**: `o.effects` temporarily narrowed in `_renderPassthroughLayer` is restored in `finally` (`277-279`); sway/flag/retro/spritesheet all produce fresh buffers; `tex` from `loadModelTexture`/`loadTexture` stays untouched; `_materialUniforms` builds a fresh object per call.
- **`_renderPassthroughLayer`** (`239-297`): fullscreen branch reads the canvas snapshot and blits at (0,0) (no object placement — correct for fullscreenlayer); compose branch crops the full-frame effect result to the object rect with canvas clamps and a `cw/ch <= 0` bail — matches the documented official "read `_rt_FullFrameBuffer` → effects → region blit" shape; the blur-skip is documented; per-frame full-canvas copy is the BASE-11 cost pattern (referenced).
- **swayimage math** (`301-329`): 4-sine sum (t·30/27/21/7·speed + `u·10 + mask.b` phase), displacement `mask.rg·sum·Amount·0.01`, RGB (not alpha) × Bright — plausible transcription of `swayimage.frag` (exact constants *unverified-vs-official*; perf claim wrong per IMG-12).
- **flag vert math** (`349-357`): the cited `v_NormalCoord` products check out numerically (`u·0.7`, `v·0.21`, `u·0.3`, `v·0.21` ≡ `uv·(1,0.3)·0.7` / `uv·(1,0.7)·0.3`), `mix((0,0,1), n, strength)` correctly expanded to `1 + (nz−1)·st` (`362`), both normal taps decompressed ×2−1 (`345,358-359`).
- **`_materialUniforms` vector/constant handling** (`37-50`): multi-component strings → `parseVec3`, `constantshadervalues` passed through; boolean/NaN gap is IMG-08.
- **Bloom bright pass** (`bloom.js:141-164`): quarter-res 4-corner average → `k = sat(scale − threshold)` multiply → saturation boost `-gray + rgb·2` → `×strength×tint` with `max(0, …)`; combine clamps with `min(255, …)` everywhere (no Uint8 wraparound); blur passes edge-clamped, NaN-free; `blurQuarter` mean-preserving. Greyscale weights question = BASE-13 (referenced, not re-derived).
- **`_texSample`** (`model.js:676-702`): non-finite UV → `[0,0,0,0]` guard, wrap/clamp modes, edge-clamped bilinear — matches the documented contract; callers in sway/flag/retro/flowimage use it consistently.
- **`getVal` integration**: animated `alpha/brightness/size/origin/scale/angles/parallaxDepth/zoom` all unwrap `{value}` at use sites (`image.js:127-132,149,182,190`, `camera.js:205,224`); `cz > 0 && isFinite` guard on camera-object zoom (`225`).
- **Negative sizes**: `dw/dh < 0` reaches `blitScaled`/`blitRotated` as flip semantics (canvas.js handles the sign; the flip *sampling* defect is BASE-01 — referenced, not re-derived); `blitScaled` early-returns on `dw===0||dh===0` (`canvas.js:47`).

---

## Suggested fix order

1. IMG-01 (fullscreen v-flip — one-line UV fix, then re-tune check) and IMG-02 (bloom HDR gate) — largest visual divergences.
2. IMG-07 (spritesheet crop) + IMG-08 (NaN uniforms) — small, unambiguous.
3. IMG-03/IMG-10 (parallax/colorBlendMode hoist, shared helper), IMG-05/IMG-06 (zoom unification).
4. IMG-04 (ratio-stable downsample), then the P3 list opportunistically (start with IMG-11 comment repair so the arbitration doesn't regress).
