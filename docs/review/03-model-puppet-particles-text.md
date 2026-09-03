# we-renderer review: model / puppet / particles / text

Scope: `lib/we-renderer/model.js`, `puppet.js`, `particles.js`, `text.js`, `mdl.js`; skimmed
`core.js:277-455` (`_mdlAnchors`, `_puppetBoneFinal`, `_attachmentOffset`, `resolveTransform`)
and `math.js`. Cross-checked against `docs/WE-REVERSE.md` and, where needed for context,
`image.js`, `camera.js`, `canvas.js`, `font-render.js` (text.js delegates all rasterization there,
so font-render findings are in scope for the text pipeline).

Severity legend:

- **P0** — crash / wrong result, blocks usage
- **P1** — clearly wrong vs official WE output
- **P2** — minor visual deviation or perf issue, or wrong-but-narrowly-triggered
- **P3** — nit, dead code, robustness, documentation

Claims marked **[verified]** were reproduced numerically (node one-liners against replicas of the
exact code; numbers included inline). The reviewer did not execute the renderer against real
`.pkg` assets; every "suspected" finding includes what observation would falsify it.

---

## A. Puppet bone math & skinning (`puppet.js`, `core.js`)

### MOD-01 — **P1 (suspected)** — `puppet.js:167-173` — `g_Bones` composition order is reversed; rotating bones orbit the model origin instead of their pivot

**What the code does.** `_skinPuppet` builds the per-bone skinning matrix as
`gBones[b] = _matMulRow(m, bindInv[b])` (line 173), where `m = [c,s,0,0, -s,c,0,0, 0,0,1,0, tx,ty,0,1]`
(line 172) is the final world pose and `bindInv[b] = _matInvertRow(bindWorld[b])` (line 121).
Vertices are transformed with the row-vector convention `p·M` (lines 187-189:
`px = p0*m[0] + p1*m[4] + p2*m[8] + m[12]`).

Under that convention, `p·(A×B) = (p·A)·B` — i.e. the left factor is applied **first**.
Correct linear-blend skinning is `p_world = final(bindInv(p))`, so the composite must be
`bindInv × final`. The code composes `final × bindInv`, which applies the **final pose first**,
then the bind inverse. This holds for every self-consistent reading of the stored 4×4 layout
(row-major or column-major): the single-matrix application `p·m`, the angle extraction
`atan2(m[1], m[0])` (line 126) and `_sampleAnimRT`'s chaining math (lines 226-231) pin the
convention, and under it the composite order is reversed.

**[verified]** (exact replicas of `_matMulRow`/`_matInvertRow`/the `m` reconstruction/vertex apply):

- Identity sanity: `bind × bindInv = I` (product printed as `1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1`) —
  so bind pose and translation-only deltas render correctly, masking the bug.
- Case A — one bone, bind = R(90°)+t(10,0), animated final = R(180°)+t(10,0), vertex at pivot+(1,0) = (11,0):
  - code `final×bindInv` → `(≈0, 11)` — rotates about the **world origin**;
  - correct `bindInv×final` → `(10, 1)` — rotates about the **bone pivot**.
- Case C — translation-only bind (R=I) at t_b=(100,0), animated to R(90°), vertex (101,0):
  - code → `(≈0, 101)`; correct → `(100, 1)`. Error ≈ |(R−I)·t_b| = 141 units for a 90° rotation.
    For a head bone at offset (0,200) tilting ±10°, the pivot error ≈ 2·sin(5°)·200 ≈ 35 units.

**Expected.** `g_Bones = bindWorld⁻¹ × finalWorld` (the classic D3D row-vector
`offsetMatrix × worldMatrix`; matches WE-REVERSE §5.5's `mul(vec4(a_Position,1), Σw·g_Bones)`
with row-vector `mul`). Any bone whose animated world rotation differs from its bind rotation
and whose bind origin is non-zero must rotate its vertices about the bone pivot.

**Caveat / falsification.** The file's own comments record repeated visual verification against
real wallpapers (e.g. the additive-ref fix at lines 131-133), which contradicts a bug of this
magnitude — unless the verified models animate mostly via translation layers (rotation layers on
bones near the origin), or the visible error was attributed to other causes. Falsification test:
render a puppet whose animation rotates one bone with a distant bind origin; per the math above
the bound vertices must sweep an arc around the model origin. If they instead rotate about the
pivot, one of the premises above is wrong for real MDL data and this finding should be closed
with a note documenting the actual byte semantics.

**Fix.** `gBones[b] = this._matMulRow(bindInv[b], m);` (swap the operands at `puppet.js:173`),
then re-verify the standard verification set (N 7层 / 十字架 / nv per the comments) plus one
rotation-heavy model.

### MOD-02 — **P2** — `puppet.js:119` vs `puppet.js:226-231` — `bindWorld` parent chain contradicts `_sampleAnimRT`'s own chaining when a parent bind rotation ≠ 0

**What the code does.** `bindWorld[b] = _matMulRow(bindWorld[parent], local)` — parent × local.
`_sampleAnimRT` chains world poses with standard FK: `tx = parent.tx + px·cos(pa) − py·sin(pa)`
(i.e. local offset rotated by the parent's world angle), and the comment at lines 90-91 asserts
the verified invariant "动画帧0 局部姿势链乘后 = bind 世界姿势".

**[verified]** Two-bone chain, b0 local = R(90°)+t(10,0), b1 local = t(0,5), parent=0:

- code `bindWorld[1]`: translation `(10, 5)`, angle 1.571 — the parent rotation is **not**
  applied to the child offset;
- `_sampleAnimRT` frame-0 chain for the same bone: `(5, 0)` (= (10,0) + R(90°)·(0,5)).

So the two implementations disagree whenever a parent bind rotation is non-zero and the child
local translation is non-zero; the documented frame0==bind invariant only holds because tested
models evidently have identity bind rotations. If any model ships non-identity bind rotations,
bindRT (and therefore additive-layer references and `_puppetBoneFinal` attachments, which are
extracted from `bindWorld`, `puppet.js:123-127`) is wrong.

**Expected.** The bind-pose FK used for `bindWorld` must be the same math as `_sampleAnimRT` at
frame 0 (or whatever convention the bytes actually use — same caveat as MOD-01).

**Fix.** Either chain as `_matMulRow(local, bindWorld[parent])` (local-first, row-vector) or
reimplement `bindWorld` by calling the RT chain on the bind matrices; add a unit test asserting
`bindRT == _sampleAnimRT(mesh, anim, 0)` for all bones of every model in the test corpus.

### MOD-03 — **P2** — `puppet.js:7-84` — `renderPuppet` ignores the object rotation (`tr.angle` / `tr.angles`)

**What the code does.** `renderPuppet` uses only `tr.origin` and `tr.scale` (lines 75-80);
`resolveTransform` returns accumulated `angles` but the puppet raster/blit path never rotates.
The image path rotates via `blitRotated` (`image.js:173-177`), the model path via `mat4FromTRS`
(`model.js:29`), so a puppet (or its ancestor) with non-zero `angles` renders unrotated while
everything else rotates.

**Expected.** Official CImage-derived puppet transform includes the object/parent Z rotation
(WE-REVERSE §9.4: angles are radians, positive = CCW on screen, pixel-space rigid rotation).

**Fix.** Rotate the skinned vertex cloud by `tr.angle` about `tr.origin` before computing bounds,
or use `canvas.blitRotated` with center `(dx+dw/2, dy+dh/2)` like `renderImage`.

### MOD-04 — **P2** — `puppet.js:130,143` and `core.js:325,335` — animation frame rate hardcoded to 30 fps; fps bytes skipped by a fragile magic scan

**What the code does.** `const fps = 30; // 官方骨骼动画 30fps`; frame =
`Math.floor(t * fps * layer.rate) % Math.max(1, anim.frameCount)`. In `_parseMdl` the MDLA header
is parsed by scanning for the byte pair `0xF0 0x41` (line 382) — the low half of the float32
`30.0f` — after which the fps float itself is never read.

**Expected.** If the MDLA fps field is always 30.0 the behavior is right, but any animation
authored at another rate plays 24→30 (too fast) or 60→30 (too slow). Additionally the scan can
false-positive on arbitrary `41 F0 …` data before the real header, silently corrupting
`frameCount`/`boneCount` (the per-float sanity check in `_sampleAnimRT` limits the damage).

**Fix.** Read the float32 at the scan hit as `anim.fps` (and validate `0 < fps ≤ 240`), fall back
to 30; anchor the scan to the parsed header offsets instead of a raw byte pattern.

### MOD-05 — **P2** — `puppet.js:211-221` — reverse-engineered MDLA 9-float interleave double-books floats, and pos/rot of one bone are sampled from different frames near the cycle wrap

**What the code does.** Bone b's position is read at segment row `(frame + ⌊2b/9⌋) % N`, column
`(2b) % 9` (2 floats); rotation at row `(frame + ⌊2b/9⌋ + ⌊(2b+5)/9⌋) % N`, column `(2b+5) % 9`.

**[verified]** Channel collision: for b=2, position occupies row `f`, floats 4-5; for b=0,
rotation occupies row `f`, floats 5-6 → **float 5 of row f is read both as bone2.pos.y and
bone0.rot.x**. Further, for bone 31 of a 32-bone model, posShift=6 and rotShift=7, so position
comes from row `(f+6) % N` while rotation comes from row `(f+13) % N` — up to 7 frames apart
inside one cycle. Either the true MDLA layout is not what the comment says (in which case these
reads are wrong for some models), or the storage genuinely overlaps (impossible for independent
channels). The fact that two models rendered correctly suggests the layout guess fits those two
models only.

**Expected.** One float stores exactly one channel value; pos and rot for logical frame f come
from the same frame's record.

**Fix.** Re-derive the layout from a hexdump of 2-3 models with known bone counts (plot frame
strides vs boneCount), and add a parser test that checks channel continuity (bone world positions
should move smoothly across frames — jumpy channels indicate a misread column).

### MOD-06 — **P3** — `puppet.js:333-364` — one malformed bone discards **all** bones; parent forward-references silently become roots; no bounds check before the 64-byte matrix read

The whole bone loop is wrapped in one `try { … } catch { bones = []; }`: a single out-of-range
read (there is no `p + 64 ≤ buf.length` guard before reading the 16 floats at line 357) throws
away every bone, degrading the puppet to bind pose. Also `bindWorld[b] = parent >= 0 && … &&
bindWorld[parent] ? … : local` (line 119) treats a parent index ≥ b (forward reference, should
not happen in a well-formed MDL but costs nothing to detect) as a root bone.

**Fix.** Per-bone try/catch (skip the bone, keep the rest); validate `parent < b` and log when
violated; bounds-check `p + 64` before the matrix read.

### MOD-07 — **P3** — animation-layer composition logic triplicated

Layer filtering/animation-name matching/blend+additive composition exists in `puppet.js:29-56`
(`renderPuppet`), `puppet.js:139-165` (`_skinPuppet`), and `core.js:378-406` +
`core.js:332-356` (`_attachmentOffset`/`_puppetBoneFinal`). Three copies must be kept in sync
(a fourth variant of the mapping fallback exists in each). Extract one
`_resolveAnimLayers(o, mesh)` + one `composePose(final, layerRT, blend, additive, ref)` helper.

### MOD-08 — **P3** — dead imports and divergent duplicated MDL parsers

`core.js:18` imports `parseMdlPuppet`/`parseMdlStatic` from `mdl.js` but never uses them
(`renderPuppet` uses `this._parseMdl`, `renderModel` uses `this._parseMdlStatic`, both defined in
`puppet.js`). The `mdl.js` copies are *older, weaker* versions: `parseMdlPuppet` (`mdl.js:7-38`)
lacks the vertex/geometry sanity checks that make `puppet.js:285-317` safe against garbage
candidates (`isFinite`, |v| ≤ 1e6, index-range check), so anyone "helpfully" switching to the
mdl.js version would reintroduce the 1e28-vertex crash the comments describe. `puppet.js:424-553`
(`_parseMdlStatic`) is a near-verbatim copy of `mdl.js:51-173`. Delete `mdl.js` exports or make
`puppet.js` call them; do not keep two implementations.

### MOD-09 — **P3** — `puppet.js:95-195` — skinning keeps only {angle, tx, ty}: bone scale and Z are dropped

`bindRT`/`final` carry rotation+translation only. A rig that animates bone scale (squash &
stretch) or uses Z for layering will render with scale=1 and the projected 2D position. Document
the limitation or carry a 2D scale factor (sx, sy) through the RT pose like `angle`.

### MOD-10 — **P3** — `puppet.js:83` — brightness implemented as alpha multiplier

`blitScaled(img, dx, dy, dw, dh, alpha * brightness)`: official brightness multiplies the layer
RGB (a darkened puppet stays opaque); here brightness=0.5 makes opaque pixels 50 % transparent
instead of darker, and brightness>1 only raises alpha (no-op on opaque pixels). Same pattern in
`image.js:191` and `text.js:113`, so at least it is consistent — but it is not the official
semantics (see sf39f comment claiming it fixed puppet colors; worth re-checking on a
brightness≠1 wallpaper).

### MOD-11 — **P3** — `puppet.js:63-65,568-575` + `puppet.js:74` — degenerate-mesh bounds produce `Infinity` sizes; `_viewShift` isBg test misfires for large puppets/text

`_meshBounds` on an empty/degenerate skinned mesh returns ±1e9 bounds → `W = Math.ceil(Inf)+1` →
`new Uint8Array(Infinity)` throws (caught upstream in `core.js:582-590`, so the whole puppet is
silently skipped with a log line). Add an `isFinite` guard and skip early. Separately,
`_viewShift(o, [W, H], ps)` (`camera.js:280`) classifies a puppet as "background" when its mesh
pixel size ≥ ortho size − 1, silently dropping camera shift for legitimately huge puppets (same
for text at `text.js:96` with `[img.width, img.height]`). The isBg test should use the object's
declared size/flags, not the rasterized content size.

---

## B. Attachment anchors / placement (`core.js:277-455`)

### MOD-12 — **P3** — `core.js:290` — anchors silently capped at 64; unmatched attachment degrades to `[0,0]`; full bone FK recomputed per `resolveTransform` call

- `for (let e = 0; e < count && e < 64; …)`: a model with >64 MDAT anchors silently loses the
  tail; a child attached to anchor #65 falls back to `[0,0]` (i.e. parent origin) with no log.
- `_attachmentOffset` (`core.js:361-416`) re-parses/re-derives and runs `_puppetBoneFinal`
  (complete bone FK + layer composition + fresh `refCache`) on **every** `resolveTransform` call —
  for every descendant of a puppet, every frame. Cache the final pose per (puppet id, t, layer-set)
  per frame.
- Otherwise the MDAT0001 parse matches the documented format (u16 count, then per entry
  u16 boneIdx + name\0 + 64B matrix — verified against WE-REVERSE §8), and the anchor-offset math
  (`core.js:413-415`: rotate (anch.tx, anch.ty) by the bone's final angle, then add the bone
  translation) is the correct relative-to-bone semantics. `resolveTransform` applies the offset at
  the parent-level accumulated scale before adding the child's own origin (`core.js:441-449`),
  which matches the documented "锚点 + 自身 origin" behavior.

---

## C. Model 3D (`model.js`)

### MOD-13 — **P1** — `model.js:162-248` — no near-plane / w≤0 clipping; NaN depth passes the z-test and writes garbage

**What the code does.** `_rasterizeMesh3D` rasterizes raw screen-space triangles. `mat4TransformPoint`
(`math.js:76-85`) returns `iw = 0` when `w === 0` and does no clipping; a vertex behind the camera
(w < 0) or on the camera plane produces `w0 = 0` → `iw0 = 1/0 = Infinity` at `model.js:194`, so
interpolated `u/v` become `NaN/Infinity`, and the interpolated `depth` (line 198) can be `NaN`.

**[verified]** `NaN >= zbuf[di]` evaluates to `false` (JS comparison semantics), so line 200
`if (depth >= zbuf[di]) continue;` does **not** reject NaN-depth fragments: the fragment proceeds
to `shade()` with NaN world position/UV. `_texSample`'s isFinite guard (`model.js:679`) returns
black for those, but `_shadeCore`/`_shadeGeneric` lighting math propagates NaN into
`Math.round(NaN*255)` → `NaN` → stored as 0 in the `Uint8Array`. Net effect: any triangle with a
vertex behind the near plane renders as black/streaked garbage spanning the whole bounding box
instead of being clipped, exactly the case GPUs handle with clip space. This bites whenever a
camera path (camera.js eye/zoom animation) or a large model vertex crosses z ≤ near.

**Expected.** GPU behavior: clip primitives against `−w ≤ z ≤ w`; nothing behind the near plane
is rasterized.

**Fix (cheap, conservative).** Skip any triangle with `min(w0,w1,w2) ≤ 1e-6` (and `!isFinite(depth)`
guard before the z-test). Proper fix: clip the triangle against the near plane (Sutherland–Hodgman
on the single w=ε plane) before the bounding-box loop.

### MOD-14 — **P2** — `model.js:7-92` — object `alpha` (and `brightness`) never applied to model objects

`renderImage` multiplies `alpha * brightness` into the blit (`image.js:191`); `renderPuppet` does
the same (`puppet.js:83`). `renderModel` has no `getVal(o, 'alpha')` anywhere — the `vs` shading
context carries no alpha and `_shadeGeneric` returns the texture alpha only. A scene that fades a
3D model via an `alpha` animation (common for intro/outro) renders it fully opaque.

**Fix.** Thread `getVal(o,'alpha',1) * getVal(o,'brightness',1)` into `vs` and multiply the
returned color alpha in `_rasterizeMesh3D` (or scale `col[3]` at line 219's test).

### MOD-15 — **P2** — `model.js:646-674` — `_texR`/`_texA` lack the non-finite guard that `_texSample` has

`_texSample` guards `!isFinite(u)||!isFinite(v)` (`model.js:679`) explicitly to avoid NaN
propagation, but `_texR` (646) and `_texA` (661) — used by `bg`, `backgroundsphere`, `cloudsbg`,
`curve` — do not: `Math.floor(NaN)` → `NaN`, `Math.max/min` with NaN → NaN, `tex.rgba[NaN]` →
`undefined` → arithmetic yields NaN → `Math.round(NaN)` → 0-filled writes (black blotches). Since
these shaders feed unbounded time-based UVs (`u + t*0.03` etc.), one NaN UV poisons the whole
span.

**Fix.** Same two-line guard as `_texSample` (return 0.5 / 0 respectively).

### MOD-16 — **P3** — `model.js:38-58` vs `59-63` — vertex displacement computed twice for normal-less meshes

When `!normals[0]`, `_coreVertex`/`_dnaVertex`/`_neonGridVertex` run once to build `displaced[]`
for face normals, then again in the main per-vertex loop. Cache `displaced` and reuse it as
`local` in the main loop (also guarantees the two passes can never diverge).

### MOD-17 — **P3** — `model.js:676` — the `clamp` sampling mode is dead code; 3D models always WRAP

`_texSample(tex, u, v, clamp = false)` — no caller ever passes `true` (grep: all call sites are
2-arg). WE-REVERSE §9.6 records that the main texture follows CLAMP in the validated image path,
while here every 3D sample wraps; meshes whose UVs slightly exceed [0,1] get edge-bleed from the
opposite border. Either wire the clamp through for texture 0 or delete the parameter and document
the divergence.

### MOD-18 — **P3** — `model.js:72-73` + `camera.js:227-231` — ortho-scene models use a center-origin projection while images treat origin as bottom-left-based

`camProj` for ortho scenes is `mat4Ortho(-w/2, w/2, -h/2, h/2)`, so `renderModel` maps world
origin (0,0) to canvas center; the image path (`image.js:137-145`) treats `origin` as a
bottom-left-based coordinate. Both conventions are self-consistent per object type (3D model
scenes use center-based origins, 2D image scenes bottom-left), but a *model* object placed in an
ortho scene with image-style origins (e.g. bgfade/neongrid strips — the very cases
`_parseMdlStatic`'s stride fallback targets) lands offset by (w/2, h/2). Worth one verification
render; if confirmed, offset `tr.origin` by (w/2, h/2) for models when `camIsOrtho`.

### MOD-19 — **P3** — `model.js:279,299` — flowimage layer filtering and speed mapping are guesses

`layers = textures.filter((t, i) => t && i !== flowIdx && i !== (flowIdx === 0 ? -1 : 0))` drops
`textures[0]` whenever the flowmask is *not* at index 0 — so with `textures = [layer, flowmask, …]`
the first layer is silently excluded. Speed mapping `[Speed0, Speed1, Speed2, Speed]` is indexed
by the *filtered* layer order while the official naming (per the comment: `[flowmask, layer_2,
layer_1, layer_0]`) implies Speed0 ↔ layer_0. Add a regression case with a 3-layer flowimage.

### MOD-20 — **P3** — `model.js:100` vs `model.js:482` — `core` vert/frag ports compute the animated term differently

`_coreVertex` uses `sat(Math.sin((rx + ry) * period + t))` (rotated UV), while `_shadeCore`'s
`lightScale` uses `sat(Math.sin((u + v + 1) * period + t))` on unrotated UV. If both derive from
the same shader variable (anims.y/z), one of the two ports dropped the rotation. Re-check against
`core.vert`/`core.frag` in the official shader sources.

---

## D. Particles (`particles.js`)

### MOD-21 — **P1** — `particles.js:179-191` — `sys.count` counts *cumulative* spawns and is never decremented, so emission stops forever after `maxCount` total spawns

**What the code does.** Spawns are gated by `sys.count < sys.maxCount` (line 179) and `sys.count++`
on each spawn (line 184), but the death sweep `sys.particles.splice(i, 1)` (lines 189-191) never
decrements `count`. With `rate=10`, `maxcount=100` (the default), all particles die after 10 s —
and after 100 cumulative spawns (t = 10 s) **no new particle is ever spawned again**. Long loops
(screensaver-style, t = minutes) show an initially animated system that goes permanently empty.

**Expected.** Official `maxcount` bounds *simultaneously alive* particles; emission continues for
the whole simulation.

**Fix.** Recompute `sys.count = sys.particles.length` after the death sweep (or decrement in the
splice loop).

### MOD-22 — **P1** — `particles.js:267-277, 315-321` vs `418-529` — particle rotation is simulated but never rendered

`rotationrandom` initializes `p.rot`, `angularmovement` integrates `p.rot += p.angVel*dt`, but
`_drawParticles` never reads `p.rot` — every particle is drawn as an axis-aligned square
(lines 461-469 map the pixel square straight to UV). Any system using rotation (leaves, debris,
sparks) renders with the rotation frozen at 0. **[verified by grep: `p.rot` written at lines 270
and 318, never read.]**

**Fix.** In the tex path, rotate the sampling coordinates (inverse-rotate (nx, ny) by `p.rot`
before computing u/v, expanding the bounds loop by the rotated AABB), or rotate the destination
pixel offset; same for the no-texture circle path (no change needed there).

### MOD-23 — **P1** — `particles.js:455` — SPRITESHEET frame width: operator precedence discards `f.width` **[verified]**

```js
w: f.width || fr.count > 0 ? Math.floor(tex.width / fr.count) : tex.width
```
parses as `(f.width || (fr.count > 0)) ? Math.floor(tex.width/fr.count) : tex.width` — since
`count > 1` is guaranteed by the enclosing `if` (line 450), the condition is always truthy and
the frame width is **always** `floor(tex.width / fr.count)`, never the TEXS frame's own `width`.
**[verified]** with `f.width=300, tex.width=1000, count=8` → evaluates to `125`, not `300`.
Non-uniform sprite sheets (frames of differing width in the TEXS table) sample the wrong
sub-rectangle; only uniform sheets happen to be correct. The `h:` branch (`f.height || tex.height`)
is fine.

**Fix.** `w: f.width || (fr.count > 0 ? Math.floor(tex.width / fr.count) : tex.width)`.

### MOD-24 — **P1** — `particles.js:222` vs `230-231, 436-437` — ortho path drops the particle system's own origin (and view shift)

**What the code does.** `scenePos` is built as `[em.origin[0]*em.scale[0] + rx*em.scale[0],
em.origin[1]*em.scale[1] + ry*em.scale[1], 0]` — the emitter-local offset only, never adding
`sys.origin` (the resolved object origin incl. the full parent chain). `_drawParticles`'s ortho
branch then draws at `x = scenePos[0]*ps[0]`, `y = H − scenePos[1]*ps[1]` (lines 436-437) with no
origin/vs addition. The non-ortho branch *does* add the origin (`sx = sys.origin[0] + p.pos[0]`,
line 230). The two paths are mutually inconsistent, so at most one can match official behavior;
in lwe/WE the emitter origin is local to the particle-system object, so the ortho path is the
wrong one: in any `orthogonalprojection` scene, particles cluster near the canvas corner instead
of at the emitter's world position.

**Expected.** `scenePos = sys.origin + R(sys.angle)·(em.origin·s + offset·s)` in scene units.

**Fix.** Build `scenePos` from the same quantities as `p.pos` (add `sys.origin`, apply `sys.angle`
rotation) and keep the y-up convention for the ortho draw.

### MOD-25 — **P2** — `particles.js:197, 216-217, 230-231` — vertical random offset sign flipped in the non-ortho path; system rotation applied to the offset but not the emitter origin **[verified algebra]**

- Non-ortho: `oy = -em.origin[1]*em.scale[1]`, `p.pos[1] = oy + ry*s`, then
  `sy = H − sys.origin[1] + p.pos[1] = H − sys.origin.y − em.origin.y·s + ry·s`.
  Correct canvas y is `H − sys.origin.y − (em.origin.y + ry)·s`. The random offset enters as
  **+ry·s** instead of **−ry·s** → the vertical distribution is mirrored about the emitter origin
  (the emitter origin term itself is correct thanks to the pre-negation). The ortho `scenePos`
  path has the correct sign, which is exactly how the inconsistency between the paths in MOD-24
  arose.
- Rotation: the random offset `(px,py)` is rotated by `−em.angle` (lines 216-217) but the
  emitter's own origin `(ox,oy)` is not rotated by the *system* angle (`tr.angle`), so a rotated
  particle-system object moves its emission shape incorrectly.

**Fix.** Compute one scene-space position `sys.origin + R(sys.angle)·(em.origin·s) +
R(sys.angle+em.angle)·(offset·s)` and derive both `p.pos` (y-down) and `scenePos` (y-up) from it.

### MOD-26 — **P2** — `particles.js:117` — `rate: e.rate || 10` turns an explicit rate of 0 into 10/s **[verified]**

`e.rate || 10` cannot distinguish "absent" (official default 10) from "0" (burst-only emitters
commonly set `rate: 0` with `instantaneous: N`). **[verified]**: `{rate: 0} || 10 → 10`. A
burst-only emitter then emits a continuous 10/s stream in addition to the burst. Also line 114,
`const rate = (e.rate || 0) * (e.rate != null ? 1 : 1);` is dead code (identity multiply, unused).
Use `e.rate != null ? e.rate : 10`.

### MOD-27 — **P2** — `particles.js:118-131` — emitter `duration`, `speedmin/speedmax`, `cone`, `sign` parsed but never used

- `duration`: emitters never stop; a "spray for 2 s" emitter sprays forever (compounds MOD-21's
  opposite problem). Implement: skip emission when `em.duration > 0 && simT > em.delay +
  em.duration`.
- `speedmin/speedmax`: initial launch velocity is silently 0 (the comment at line 208 admits
  semantics are unconfirmed, but WE's emitter speed along the emission direction is standard);
  burst/confetti systems fall straight down instead of flying.
- `cone`/`sign`: unused; at minimum log once per system when an unsupported emitter field is
  present, so gaps are visible instead of silent.

### MOD-28 — **P2** — `particles.js:323-341` — `alphafade` treats fade in/out times as fractions of lifetime; official uses seconds **[verified example]**

`lifePos = age/life` is compared directly against `fadeintime`/`fadeouttime`
(`lifePos <= fadeIn`, `lifePos > fadeOut`, with `tt = (lifePos − fadeOut)/(1 − fadeOut)`).
**[verified]**: lifetime 10 s, fadeout 0.5 → this code fades during `age ∈ (5, 10)` s
(last 50 % of life); the official `fadeValue(age, lifetime − fadeOut, lifetime, 1, 0)` semantics
fade during `age ∈ (9.5, 10)` s. For long-lived particles the tail fade is stretched enormously;
for sub-1 s lifetimes it's compressed. Note the internal inconsistency: `sizechange`/`alphachange`
(342-361) *do* use normalized 0-1 `starttime/endtime`, which matches WE's json convention — so
alphafade is the odd one out. Fix by fading on absolute seconds (`age ∈ [0, fadeIn]`,
`age ∈ [life − fadeOut, life]`) after confirming against lwe's `CParticleAlphafade`.

### MOD-29 — **P3** — `particles.js:362-373` — turbulence re-randomizes speed and phase every 0.05 s step per particle

`sp` and `phase` are drawn from `Math.random()` inside the per-step operator, so the force field
jitters at 20 Hz instead of producing a coherent per-particle swirl. Sample `sp`/`phase` once at
spawn (store on the particle like `oscAlpha`) and keep only the time-dependent `sin(… + t·…)`.

### MOD-30 — **P3** — `particles.js:152-162` — simulation silently caps at 100 s **[verified]**

`while (simT < target && guard < 2000)` with `dt ≤ 0.05` simulates at most `2000 × 0.05 = 100 s`
**[verified]**, then `sys._simulatedTo = target` jumps the clock without simulating the gap:
for t > 100 s the state is "frozen at 100 s" (with MOD-21 fixed this would at least be visible).
Raise the guard, or fast-forward: if all particles are dead and no emitter is active, jump
`simT` directly to `target − ε`.

### MOD-31 — **P3** — `particles.js:20-27, 41-49, 90` — global `Math.random` swap is fragile and one of the two RNGs is dead

- `Math.random = sys.rng` is process-global mutation: any nested consumer of `Math.random`
  during `_buildParticleSystemInner`/`_simulateParticleSystem`/`_drawParticles` silently
  desynchronizes the deterministic stream (cache keys claim reproducibility). Prefer passing the
  rng explicitly to `_spawnParticle`/`_applyInitializer`/`_applyOperator`.
- `_buildParticleSystem` creates `rng` (line 41) and installs it globally, but
  `_buildParticleSystemInner` ignores `ctx.rng` and creates a *second* RNG (`rng:
  this._particleRng(o)`, line 90) that simulate/draw actually use. Dead parameter + a second
  hash pass; keep one.

### MOD-32 — **P3** — assorted particle nits

- `particles.js:178-179`: `const cap = em.flags & 2 ? 1 : toEmit;` — when the flag is set,
  accumulated emission beyond 1 is dropped *after* `sys.acc` was debited (mass loss); skip the
  debit or carry it.
- `particles.js:476`: nearest-neighbor texture sampling (no bilinear) — noticeably more aliased
  than the GPU path for downscaled particles; reuse the bilinear `_texSample` math.
- `particles.js:85,88`: `animFrames` and `t0` are stored and never read (dead); `animFrames`
  suggests an unimplemented `animationmode` feature.
- `particles.js:302-307`: explicit Euler (pos updated with the pre-gravity velocity); semi-implicit
  (velocity first) matches the usual engine integration more closely for gravity/drag.
- `particles.js:427-429`: particles are drawn in spawn order with no depth/z sort — fine for most
  systems, wrong vs official whenever the engine sorts by view depth (3D particle scenes).

---

## E. Text (`text.js` + `font-render.js`)

### MOD-33 — **P1** — `font-render.js:380-395, 444-445` — every glyph is scaled to the *full* `size` height, destroying x-height/cap-height proportions

`rasterizeContours` computes `scale = size / spanY` **per glyph** from that glyph's own bounding
box ("字形全高 = size"): a period, a hyphen, and a capital letter are all rendered `size` pixels
tall. Meanwhile advance widths come from `hmtx × size/unitsPerEm` (line 449), i.e. em-relative —
so spacing corresponds to real typography while glyph heights do not. Mixed-case text in any
proportional font — including the `fonts/NotoSans-Regular.ttf` fallback used for every
`systemfont_*` (text.js:76-78) — renders with lowercase letters as tall as capitals and wrong
letter spacing. The only fonts that look right are monospace-ish display fonts where all glyphs
share one bbox height (e.g. the Segment7 digits the parser was originally built for).

**Expected.** One global scale = `size / unitsPerEm` applied to all glyphs; per-glyph bitmaps
sized by that scale, positioned on a common baseline.

**Fix.** In `rasterizeContours`, take the scale as a parameter (`size/unitsPerEm`), and have
`renderText` place glyphs at `baselineY − glyphTop·scale`.

### MOD-34 — **P1** — `font-render.js:453-458` — glyphs are individually *vertically centered* instead of baseline-aligned

`gy = Math.round((totalH − g.img.height) / 2)` centers each glyph bitmap in the line box. Since
different glyphs have different heights (and, per MOD-33, different implicit scales), the visual
midline — not the baseline — is aligned: "go" puts the o at the g's x-height center, descenders
and ascenders wobble per character. Together with MOD-33 this makes any non-display font
unreadable at small sizes.

**Fix.** Same as MOD-33: shared baseline; `totalH` from `ascender − descender`.

### MOD-35 — **P2** — `font-render.js:293-301, 312-334, 335-360, 361` — CFF cubic curves are flattened to single chords; flex ops skipped

In the CFF charstring interpreter, `rrcurveto` (op 8) pushes only the segment endpoint with the
comment "直线近似: 端点"; same for `vhcurveto`/`hvcurveto` (30/31), `rcurveline` (24) and
`rlinecurve` (25). Every cubic in a CFF glyph becomes one straight line — an 'O' becomes an
octagon-ish polygon, bowls and terminals are visibly faceted at ≥ 24 px. Flex/flex variants
(26/27 and 12.x, line 361) are dropped entirely (`st.length = 0`), losing strokes in fonts that
use them. The TTF path is fine (`subdivBez` properly subdivides quadratics, 802-812) — port the
same recursive subdivision to the CFF cubics (de Casteljau on the 3 control points, ~3 levels or
flatness 0.25 like subdivBez).

### MOD-36 — **P2** — `font-render.js` — no kerning

Neither the `kern` table nor GPOS pair positioning is read; `renderText` lays out with bare
advances. WE (FreeType with kerning) tightens pairs like "AV", "To", "y,". For the short strings
WE texts usually show (clock digits, names) the impact is moderate but visible in headings.
Optional `kern` fmt-0 lookup would cover most legacy CFF/OTF fonts.

### MOD-37 — **P2** — `text.js:13-16, 21` — font and bitmap caches live on the **prototype** and are keyed by relative path only

`_fontCache`/`_textBitmapCache` are `Map` instance-*like* properties assigned to
`SceneRenderer.prototype` (installed at `core.js:778`), so all renderer instances in the process
share them. Keys are `fontPath` (relative, e.g. `fonts/font.ttf`) — two different wallpapers that
ship different bytes under the same relative path collide: the second wallpaper silently renders
with the first one's font. The bitmap cache key also embeds `color`/`px`/`text` but that doesn't
help since the parsed *font* is already wrong. Prefix keys with `this.pkgPath` (or move the Maps
into the constructor).

### MOD-38 — **P2** — `text.js:75-79` — a text object without a `font` renders nothing at all

`fontPath = getVal(o, 'font', '')`; only `systemfont_*` is remapped to NotoSans; if `fontPath`
is empty the entire `if (fontPath)` block is skipped — no fallback to the built-in font, no log.
WE text objects are not required to specify a font (engine default). Render with
`fonts/NotoSans-Regular.ttf` as the default instead of bailing.

### MOD-39 — **P3** — text nits

- `font-render.js:466-468`: `out[di] = Math.round(color[0]*255)` with no clamp — a color > 1
  (e.g. a "255 255 255"-style 0-255 string parsed as-is) wraps modulo 256 through the
  `Uint8Array`: **[verified]** `Math.round(255*255) = 65025 → stored as 1` (near-black). Clamp to
  255 or normalize inputs > 1.
- `font-render.js:462`: glyph coverage test `alpha > 128` — hard binary threshold, no
  anti-aliasing or gamma; combined with `blitScaled` downscaling this is the main source of
  jagged small text.
- `font-render.js:477-492`: the rendered image is cropped to the *ink* bbox, and `text.js:104-112`
  anchors that ink box to origin per `horizontalalign`/`verticalalign` — so alignment shifts with
  glyph ink (a text of only "il" vs "xm" anchors differently). The returned `advancePx` (line 492)
  is never used by `text.js`; layout-based anchoring should prefer it.
- `text.js:15-16`: the `alpha` parameter of `_renderTextCached` is accepted and ignored (alpha is
  applied at blit, line 113) — drop the parameter to avoid implying it's part of the key.
- `text.js:41-64`: `_isLiveText` and `_isWatermarkText` skipping is a documented product decision
  (comments cite user decisions) — fine, but note `_isWatermarkText` also skips *any* static text
  bound to a user property that is currently ON (user-customizable greetings etc.), and there is
  no log when skipping; one `this.log` per skipped object would make the intentional gap visible.

---

## F. math.js

### MOD-40 — **P3 (suspect)** — `math.js:147,163,164-165` — `applyBlending` case 20 duplicates case 4; cases 21/22 look mis-mapped

Case 4 and case 20 are byte-identical (`max(A+B−1, 0)` = linear burn). In the WE/lwe blend-mode
enumeration the high-20s region is subtract/divide-style operations (20 ≈ subtract `A−B`,
21 ≈ divide), while the code has 20 = linearburn-again and 21/22 = "reflect". Modes 1-19 and 23-30
match the standard formulas (darken/multiply/colorburn/…/difference/exclusion/phoenix/HSL swaps —
spot-checked). If any wallpaper uses colorBlendMode 20-22 the result is visibly wrong.
**Fix:** diff the switch against `lwe`'s `common_blending.h` `ApplyBlending` and correct 20-22;
add a comment table mapping enum → formula.

---

## Verified OK

- **`_matMulRow` / `_matInvertRow`** (`puppet.js:254-274`): standard row-major product; affine
  inverse = Rᵀ with translation −t·Rᵀ. Round-trip `bind × bindInv = I` verified numerically
  (product printed as identity; also `o[12..14]` correctly equals −t·R_row).
- **Frame indexing** (`puppet.js:143`, `core.js:335`): `floor(t·30·rate) % max(1, frameCount)`
  matches the documented `frame=floor(t*fps*rate)%frameCount` semantics incl. the divide-by-zero
  guard; layer `rate` correctly scales playback speed.
- **Additive/normal layer composition ±π wrap** (`puppet.js:150-160`, `core.js:341-351`): angle
  deltas wrapped into [−π, π] before scaling by blend — correct for additive layers and for
  mixing; the additive reference pose = layer's own frame 0 matches WE-REVERSE §6.
- **MDAT0001 anchor parse** (`core.js:286-302`): structure matches WE-REVERSE §8 exactly
  (magic check, u16 count, per-entry u16 boneIdx + NUL-terminated name + 64B float matrix),
  with sane bail-outs; `boneIdx` is bounds-checked at the use site (`core.js:377`).
- **Anchor offset math** (`core.js:413-415`): rotating the anchor-local translation by the bone's
  final angle then adding the bone world translation is correct for "matrix relative to bone";
  the accumulated-scale/rotation application order in `resolveTransform` (`core.js:435-452`,
  attachment offset added before the child's own origin, both rotated by the ancestor Z angle,
  ancestor scale applied) is self-consistent with the image path.
- **`_rasterizeMesh3D` interpolation**: perspective-correct 1/w·attr interpolation for UV/uv2/
  normals/world pos (`model.js:194-217`) is textbook-correct; **depth** correctly interpolated
  linearly in screen space (matches GPU z interpolation); z-test strict `>=` skip ≙ GL default
  `LESS`; degenerate triangles skipped (`|cross| < 1e-9`); two-sided rendering flips the normal
  for backfaces (`model.js:176-207`) as documented.
- **`_texSample`**: bilinear with wrap and a proper isFinite guard (`model.js:679`); `_texA`/
  `_texR` share the correct bilinear core (modulo MOD-15's guard gap).
- **Puppet `_rasterizeMesh`** (`puppet.js:578-644`): premultiplied-alpha bilinear sampling with
  un-premultiply and alpha cutoff is the correct way to filter RGBA; affine (non-perspective) UV
  is appropriate for the ortho 2D puppet path; y-flip via `flipY` + `blitScaled` placement is
  consistent (`topY = origin + scale·maxY`, `dy = H − topY·ps + vs[1]`, matching `renderImage`).
- **Canvas compositors** (`canvas.js:24-144`): source-over math `(src·a + dst·dstA·(1−a))/outA`
  is correct non-premultiplied blending; negative dw/dh handled as flips in both `blitScaled` and
  `blitRotated`; `clear()` resets the z-buffer.
- **Particle RNG**: mulberry32 seeded from pkgPath+id+origin gives a stable per-object stream —
  same frame ⇒ same output (mechanics verified; fragility noted in MOD-31).
- **Particle texture aspect & spritesheet timing**: `halfY × (tex.h/tex.w)` and
  `idx = min(count−1, floor(age/life × count))` match the documented genericparticle.vert
  semantics (sf39g); the alpha×texR compositing matches the "color = v_Color × tex.r" note.
- **Oscillator/alphafade interplay**: `alphafade` refreshing `oscAlpha.base` each step mirrors the
  documented native ordering (`particles.js:337-339`).
- **Text caching mechanics**: key covers font|px|text|color; 256-entry FIFO eviction keeps clock
  text bounded; `renderText` returns fresh buffers so cached images are never mutated by blit
  (module-level correctness; the prototype-sharing issue is MOD-37).
- **CFF/TTF container parsing** (`font-render.js:65-213, 499-590`): sfnt table dir, CFF
  Name/TopDICT/String/GSubr INDEX chain, Private DICT Subrs, cmap fmt 4 + 12 (BMP + astral),
  hmtx advances with numHMetrics clamp, head unitsPerEm, TTF glyf simple + composite glyphs with
  F2Dot14 transforms and component recursion — all structurally correct (quality issues are
  MOD-33/35/36).
- **`rgb2hsv`/`hsv2rgb`/`_greyscale`/smoothstep helpers** (`math.js:180-207`): standard formulas,
  degenerate-input safe (`d === 0`, `mx === 0` guarded).
- **`mat4FromTRS` / `mat4TransformPoint` / `mat4LookAt` / perspective / ortho** (`math.js:34-88`):
  internally consistent column-major helpers; `mat4TransformPoint` returning `(p/w, w)` is what
  the rasterizer expects; TRS negated-X/Z convention is at least consistently applied at both
  call sites (model objects).

---

*Review generated from static analysis + targeted numeric reproduction; renderer not executed
against real assets. Findings MOD-01, MOD-05, MOD-40 are flagged "suspected" with explicit
falsification tests because real-model behavior documented in code comments appears to contradict
the arithmetic — resolving that contradiction (either way) is the highest-value next step.*
