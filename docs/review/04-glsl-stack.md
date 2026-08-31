# we-renderer review: GLSL interpreter stack

Scope: `lib/we-renderer/glsl/{preprocess,transpile,executor,runtime,integration}.js`,
`glsl/{common.h,common_perspective.h}`; skimmed `math.js` (`applyBlending`) and
`model.js:676-702` (`_texSample`, which is the sampler backend the GLSL path calls through).
Cross-checked against `docs/WE-REVERSE.md`, `docs/plan-scene-webgl.md` (§10 resolution
convention) and `docs/plan-scene-webgl-details.md` (esp. §13 GLSL bug fixes). All claims
marked **[verified]** were reproduced numerically against the real `@shaderfrog/glsl-parser`
7.0.1 + the actual transpiler/executor code (node probes); unmarked claims are
inspection-verified with the exact code path cited.

Context reminder: this stack is the **fallback** for third-party workshop effects and
official effects not hand-implemented in CPU. Failure mode is "return original image"
(silent), so every finding below manifests as *silently wrong or silently missing* output,
never a crash.

Severity legend:

- **P0** — crash / wrong result, blocks usage
- **P1** — clearly wrong vs official WE output
- **P2** — minor visual deviation or perf issue, or wrong-but-narrowly-triggered
- **P3** — nit, dead code, robustness, documentation

---

## A. Transpiler (`transpile.js`)

### GLS-01 — **P1** — `transpile.js:237-242` (with `:193-220`, `:259-261`) — every `for` loop fails to compile; loop statements are silently dropped

**What the code does.** `stmt('for_statement')` builds
`for (${init.trim()}; ${cond}; ${upd}) { … }` where `init = this.stmt(node.init, ctx)` and
`upd = this.exprStmt(node.operation, ctx, true)`.

Three independent breakages, all reproduced against the real parser/transpiler **[verified]**:

1. `init` for `for (int i = 0; …)` is a **bare `declarator_list`** node (shaderfrog 7.0.1),
   not a `declaration_statement`, so `stmt()` falls to the `default:` case
   (`transpile.js:259-261`) and emits the comment `/* stmt declarator_list */`. The loop
   variable is **never declared** (`i` would be a ReferenceError even if the header were
   valid JS). Same for the assignment-init form `for (f = 0.0; …)` — `stmt()` has no case
   for a bare `assignment` node either.
2. The update expression always gets a trailing `;` from `exprStmt` (`transpile.js:271`),
   producing **three semicolons** in the for-header → `new Function` throws
   `SyntaxError: Unexpected token ';'`.
3. `i++` parses as `postfix` with `postfix.type === 'literal'` (`'++'`); `postfixExpr`
   (`transpile.js:600-628`) has no increment case and returns the bare base — the increment
   silently becomes a no-op (`i;`).

Transpiled output for `for (int i = 0; i < 4; i++) { s += float(i); }` **[verified]**:

```js
for (/* stmt declarator_list */; (i < 4); i;) {
```

→ `SyntaxError: Unexpected token ';'`. `compileGlsl` → `new Function` throws →
`_compileWorkshopEffect` catches, logs, caches `null` → **effect silently disabled**.

**Expected.** GLSL for-loops execute; blur/convolution/voronoi/trail workshop shaders are
built on them.

**Fix.** Handle for-init specially: accept `declarator_list`/`assignment` in the for-header
(emit `var i = 0` / `i = 0.0` without trailing `;`), and emit postfix/prefix
increment/decrement (`i++` → `i = i + 1`) without `;` in update position. A regression test
with a 4-tap loop shader would pin this.

### GLS-02 — **P1** — `transpile.js:330-333`, `:337-344`, `:614-626` — every subscript expression silently loses its index (`v[0]` → `v`, `m[1]` → `m`, `c[i]` → `c`)

**What the code does.** All three index-handling sites check `pf.type === 'index'`. In
shaderfrog/glsl-parser **7.0.1** a `[...]` subscript is a postfix whose inner node type is
**`'quantifier'`** (`{"type":"quantifier","lb":{…},"expression":{index},"rb":{…}}`) — dumped
from the real AST **[verified]**. The `'index'` branch never matches, so `postfixExpr` falls
through to `return { code: base.code, … }` and `lvalue()` returns the bare base.

Consequences **[verified]**:

- `float a = v[0];` → `var a = v;` (whole vec2 assigned to float slot).
- `vec2 c2 = m[1];` → `var c2 = m;` (entire mat3, not column 1).
- `float w[3]; w[0]=0.5; w[1]=0.25;` → `var w = 0; w = 0.5; w = 0.25;` — array declarations
  are also unsupported (`d.identifier` has a `quantifier` array specifier that
  `collectLocals` ignores, so `w` types as `float` and `defaultValue('float')=0`), and the
  subscripted stores collapse to scalar overwrites (last write wins). `w[0]+w[1]+w[2]` →
  `((w+w)+w)` = 0.375 where GLSL gives 0.875.
- `float f = c[i];` (dynamic index) → `var f = c;` → `gl_FragColor.set([f,f,f,f])` coerces
  the array to NaN → black pixel.

Unlike GLS-01 this does **not** throw — it produces silently wrong pixels or black output.

**Expected.** `v[i]` selects a component; `m[i]` selects a column (vec); arrays work.

**Fix.** Match `pf.type === 'quantifier'` (or both) in `postfixExpr`/`lvalue`/`lvalueBase`;
restore the existing mat-column `subarray` logic that the `MAT_SIZE[base.type]` branch at
`transpile.js:617-623` was written for (it is currently dead code because of the type-name
mismatch — see also GLS-03 for why the type is often null by then). Add minimal array
support (`new Array(n).fill(0)` default, per-element stores) or reject array-using shaders
explicitly at compile time instead of mis-rendering.

### GLS-03 — **P1** — `transpile.js:429-449`, `runtime.js:20-23` — matrix arithmetic is component-wise or NaN; `mat*vec` produces garbage

**What the code does.** In `binaryExpr`, the vec branch (`if (lvec || rvec)`) is checked
**before** the mat branch (`if (lmat || rmat)`), so `mat * vec` enters the vec-inline path
with `n = lvec || rvec` = the *vector's* length and `li = l.code` (the matrix treated as a
scalar). Output for `mat2 rot = mat2(0.0,1.0,-1.0,0.0); vec2 r = rot * vec2(1.0,0.0);`
**[verified]**:

```js
var r = [(rot * v[0]), (rot * v[1])];   // array * number = NaN
```

→ rendered RGBA is NaN-derived garbage instead of GLSL's `(0,1)`. `mat * mat` (neither side
a vec) reaches the mat branch, which calls `__rt._vmul` — a **component-wise (Hadamard)
product**, not a matrix product. Only explicit `mul(v, m)` calls map to the correct
`runtime.mul` row-vector product (`runtime.js:167-176`).

Aggravator: `common.h:6` defines `#define mul(v, m) ((v) * (m))`. On systems with a real WE
install (`weAssetsDir` set), `_resolveGlslInclude` resolves the *real* common.h, the macro
expands, and `mul()` degrades into the broken `*` path above — while on systems *without*
WE assets the unknown `mul` survives to `__rt.mul` and is correct. The macro is correct
GPU-GLSL but wrong for this CPU transpiler.

**Expected.** `m*v` = linear transform; `m1*m2` = matrix product; `mul()` = row-vector
product (HLSL semantics, per WE-REVERSE §5.5).

**Fix.** In `binaryExpr`, dispatch on `(lmat,rvec)`, `(lvec,rmat)`, `(lmat,rmat)` combos to
dedicated `__rt._matVecMul/_vecMatMul/_matMul` helpers (column-major flat layout is already
the convention in `runtime.mul` and `CAST3X3`). Either exclude the `mul` macro from the CPU
path (stub common.h for the fallback like the GL route does at scene-shader time) or teach
the `*` path mat-awareness so expansion is harmless.

### GLS-04 — **P1** — `integration.js:91` and `:148` — `g_TextureN` sampler binding is off by one; every aux texture lands in the wrong slot

**What the code does.** `textures = pass.textures.map(…)` preserves the **full slot array**
(WE convention: slot 0 = chain input `_pg_`/null, slot 1 = first aux, cf. details §6.1
as-built meta `"textures": [null, {mask}, {normal}]`). But the sampler bind is

```js
u[un] = idx === 0 ? img : (textures[idx - 1] || null);
```

So `g_Texture1` binds `textures[0]` — i.e. `loadTexture(null/'_pg_')` → `null` → sampled as
white by `_texSample` — and `g_Texture2` binds `textures[1]` (the mask) where the shader
expects the normal map. Every workshop effect with ≥1 aux texture gets shifted/white
bindings. Note the executor's own test helper `compileAndRender`
(`executor.js:217-222`) binds `u[name] = textures[idx]` — the two bindings in the same
stack **disagree**, and the executor's is the correct one. (The engine-inject side,
`engineInject` `eng.textures[idx]`, also indexes the full array — so
`g_Texture1Resolution` describes the right texture while `g_Texture1` samples the wrong
one.)

**Expected.** `g_TextureN` (N≥1) ↔ slot N ↔ `textures[N]` (0-based slot array with slot 0 =
input image).

**Fix.** Use `textures[idx]` in both integration copies (or filter slot 0 out of `textures`
and keep `idx-1`, but then fix `engine.textures` accordingly). Add a two-texture end-to-end
test asserting the mask actually reaches `g_Texture1`.

### GLS-05 — **P1** — `executor.js:112-123` — `g_TextureNResolution` uses the convention the Phase-0 experiment *rejected*, and mixes object dims with texture dims

**What the code does.** For an existing texture:
`Float32Array.from([eng.objW || w, eng.objH || h, w, h])` — i.e. candidate **(b)
(objW,objH,texW,texH)** from details §5. The arbitrated convention (plan-scene-webgl.md §10,
WE-REVERSE §9.2, lwe `CTexture::setupResolution`) is **(mip0.w, mip0.h, header.w,
header.h)**; the discriminating experiment rejected candidate (b) because it breaks
resolution-driven UV scaling (iris mask became a no-op, violating author intent). For a
missing texture the code falls back to `[objW,objH,objW,objH]`. **[verified]** with
`buildUniforms` + two textures `{1920×1080}` and `{256×256}` and `objW/objH = 3840×2160`:
`g_Texture0Resolution = [3840,2160,1920,1080]`, `g_Texture1Resolution =
[3840,2160,256,256]` — xy are object dims, not mip0 dims; zw has no header dims at all.

**Expected.** `vec4(mip0.w, mip0.h, header.w, header.h)` per bound texture (for this code's
textures without separate header dims: `[w, h, w, h]`).

**Fix.** Return `[tex.width, tex.height, tex.width, tex.height]` (and plumb header dims
when decodeTex exposes them); for missing textures use the slot-0 image dims or `[1,1,1,1]`
— not object dims. Reuse one shared convention constant with the scene-gl client so the two
paths can't drift.

### GLS-06 — **P1** — `preprocess.js:10`, `:18` — CPU `parseMeta` still truncates nested-brace meta JSON; combos silently vanish and material mappings become NaN

**What the code does.** `parseMeta` uses non-greedy `(\{[\s\S]*?\})` regexes. The identical
bug was fixed for the GL path via `readBalancedJson` (`preprocess.js:74-92`, details §13.1)
but deliberately left in `parseMeta` with the rationale "stock 效果走手写 JS 不受影响"
(details §13.1). That rationale does not hold for **this** stack: `compileGlsl`
(`executor.js:10-15`) feeds `parseMeta` output to `buildUniforms`, and this stack's whole
purpose is third-party workshop shaders — the ones carrying `"options":{…}`/nested metadata.
**[verified]** against the real code:

- `// [COMBO] {"combo":"NOISE","default":0,"options":{"None":0,"Simplex":1}}` →
  `parseMeta.combos = {}` (JSON.parse fails on the truncated capture, swallowed by
  `catch {}`), while `parseMetaGL` correctly yields `NOISE`.
- `uniform float g_Amount; // {"material":"amount","default":0.5,"range":{"min":0,"max":1}}`
  → `uniforms.g_Amount = {"material":null,…}` — the material mapping is lost.

Two downstream effects: (a) lost combo defaults are **not** a compile error — shaderfrog's
preprocessor evaluates `#if MODE == 1` with undefined `MODE` as 0 and silently removes the
branch **[verified]**, so features that default *on* render as if off; (b) lost `material`
means `buildUniforms` never sets the uniform, the transpiled `var g_Amount = __u.g_Amount;`
is `undefined`, and any use is NaN → **black output** **[verified]** (E2E: a multiplied
missing uniform produced all-zero RGBA).

**Expected.** Combo defaults and material mappings survive nested metadata; a uniform with
a meta `default` should at least get that default.

**Fix.** Use `readBalancedJson` in `parseMeta` (it is 20 lines above, same file); while
there, honor `meta.default` as a fallback value in `buildUniforms` so missing csv keys
degrade to the authored default instead of NaN.

### GLS-07 — **P2** — `transpile.js:455-457` — `==`/`!=` on vectors become JS reference comparison (always false / always true)

`binaryExpr` maps `==`→`===`, `!=`→`!==` unconditionally. For vec operands the generated
code compares distinct array instances. **[verified]**: `vec2 a = vec2(0.5,0.5);
a == vec2(0.5,0.5)` renders the *else* branch (blue) where GLSL takes the *then* branch
(red); for `!=` every comparison is inverted-true. Wrong branching, no fallback triggered.
**Fix:** emit `__rt._veq(a,b)`/`_vne` helpers that compare by length + components when
either side is a non-scalar.

### GLS-08 — **P2** — `transpile.js:167-185` — scalar `out`/`inout` function parameters never write back

`functionCode` only `.slice(0)`-copies vec/mat in-params; `out float`/`inout float` params
are plain JS numbers, so writes inside the callee are lost. **[verified]**:
`void split(vec4 c, out float r, out float g){ r=c.x; g=c.y; }` transpiles to
`function split(c, r, g){ r = c[0]; g = c[1]; }` and the caller's variables stay 0 → output
black where GLSL gives (0.25,0.75). Multi-output helper functions are a common workshop
idiom. **Fix:** hoist scalar out/inout args into one-element boxes
(`{v:0}`) or desugar to returned tuples; at minimum detect `out` scalars at compile time and
fail loudly instead of mis-rendering.

### GLS-09 — **P2** — `transpile.js:545-575`, `:600-628` — non-simple subexpressions are re-evaluated per component; swizzling a call multiplies sampler cost (measured 12×)

`constructVec`/`broadcast`/`postfixExpr` paste `base.code` once per output component,
ignoring the `simple` flag the rest of the transpiler maintains. **[verified]** end-to-end
with an instrumented sampler: `vec4 c = texture2D(t, uv); … c.rgb` costs 1 sample/pixel,
but the idiomatic `gl_FragColor = vec4(texture2D(t, uv).rgb, 1.0)` costs **12 samples per
pixel** (3 for `.rgb`, ×4 for the vec4 broadcast) — 48 samples for a 2×2 image. Same
multiplication applies to any `vecN(userFn(x))` (userFn run N×, wrong if impure) and to
`.xyz` of `normalize(v)` etc. In a per-pixel interpreter where each sample is 4 texel
fetches + bilinear math, this is the dominant avoidable cost. **Fix:** in `constructVec`,
`broadcast` and multi-component `postfixExpr`, if `!base.simple` hoist
`var __tN = base.code;` first (the transpiler already does exactly this in
`assignStmt`'s swizzle path, `transpile.js:283-289`).

### GLS-10 — **P2** — `transpile.js:12-19` vs `runtime.js:208-222` — BUILTIN set advertises functions `runtimeObject` does not implement

`BUILTIN` includes `texture2DLod`, `floatBitsToInt`, `intBitsToFloat`; `runtimeObject`
implements none of them → `__rt.texture2DLod is not a function` **[verified]** → per-pixel
TypeError → caught → effect silently disabled. (Same for any shader calling them anywhere,
even in dead branches.) Also absent: `dFdx/dFdy/fwidth`, `reflect`, `refract`,
`faceforward`, `matrixCompMult` — those at least parse as "unknown custom functions" and
fail the same way. **Fix:** implement the easy ones (`texture2DLod` = alias of texture2D
since there is no mip chain; `reflect`; `matrixCompMult`) and drop the rest from BUILTIN so
they surface as a clear compile log line instead of a mid-render TypeError.

### GLS-11 — **P2** — `integration.js:60-62` — all textures force-CLAMPed; official aux textures are REPEAT, and the justifying comment is factually wrong

`_glslSample` calls `_texSample(tex, u, v, true)` "clamp (GL 默认)". OpenGL's default wrap
state is **REPEAT**, not clamp; and the project's own arbitration (WE-REVERSE §9.6,
plan-scene-webgl.md §2.6) is slot0 = CLAMP (following CPU), **slot1/2 (mask/normal) =
REPEAT** — ripple/fire/water workshop effects scroll aux UVs beyond [0,1] by design. The
GLSL fallback clamps everything → scrolling textures freeze at the edge (streaks) instead
of tiling. **Fix:** bind wrap per slot (slot 0 clamp, others repeat) by threading the slot
index into the sampler, mirroring the scene-gl route's sampler params.

### GLS-12 — **P2** — `transpile.js:429-461` — int/int division becomes float division

`1 / 2` transpiles to `(1 / 2)` = 0.5; GLSL ES int division yields 0. **[verified]** (type
tracking even labels the result `float`). Shows up in kernels (`i/2`), texel math
(`1/255`), and atlas math. **Fix:** when both operand types are `int`/`uint`, emit
`Math.trunc(l / r)`; the type info is already tracked (`int_constant` → `'int'`).

### GLS-13 — **P2** — `integration.js:65-104` vs `:108-128` — `_applyGlslEffect` defined twice; the first is dead and hides a semantic difference

**Verified as asked.** `proto._applyGlslEffect` is assigned at **line 65** and again at
**line 108**; the second overwrites the first (property assignment on the same prototype),
so the *live* implementation is the downsample-aware one (`MAX_GLSL_PIXELS = 65536`,
`staticFrame` check, `_renderGlslEffect` + `_upsampleRgba`). The dead first copy renders
**always at full resolution** and contains its own copy of the uniform assembly — so a
reader of lines 65-104 (e.g. when fixing GLS-04's `textures[idx-1]`, which exists in **both**
copies at :91 and :148) will fix one and leave live code untouched. A duplicate-name scan of
all `lib/we-renderer/*.js` mixins finds **no other** shadowed/duplicate method definitions
(only benign `constructor`/`get` across different classes). **Fix:** delete lines 65-104;
keep `_renderGlslEffect` as the single uniform-assembly site (a third copy lives in
`executor.js` `compileAndRender` and has the divergent binding convention noted in GLS-04).

### GLS-14 — **P2** — `transpile.js:243-261` — `do-while` body dropped; `switch` dropped; `discard` ignored

`stmt` has no `do_statement` case → `/* stmt do_statement */` and the loop vanishes
**[verified]**: `do { a += 1.0; } while (a < 3.0)` renders `a = 0` where GLSL gives 3.
`switch_statement` → `/* switch unsupported */` (variables stay unset). `discard` →
`/* discard */` and execution continues, so the pixel gets whatever `gl_FragColor` already
holds instead of being left untouched. Each is rare in WE effects but all three are silent.
**Fix:** `do-while` is a 2-line addition; make `switch`/`discard` throw at compile time so
they hit the (documented) fallback instead of mis-rendering.

### GLS-15 — **P2** — `transpile.js:118`, `executor.js:84-97` — missing uniforms become `undefined` → NaN → black; authored `default` values are ignored

`generate()` emits `var ${name} = __u.${name};` with no fallback; `buildUniforms` skips
uniforms whose material is missing from `constantshadervalues` and never consults
`meta.default` (which `parseMeta` drops anyway — it keeps only `{material, type}` at
`preprocess.js:22`, unlike `parseMetaGL` which spreads `...meta`). **[verified]**: a shader
multiplying by an unsatisfied uniform renders all-zero RGBA. **Fix:** `var ${name} = __u.${name} !== undefined ? __u.${name} : ${this.defaultValue(type)};` and plumb `meta.default`
through `convertUniform` as the last fallback.

### GLS-16 — **P2** — `executor.js:180-181` — fragment varyings with no vertex shader throw and disable the whole effect

With no `.vert` found, `varyings = []` and `__v` stays `{}`; a frag declaring
`varying vec2 v_UV;` reads `__v.v_UV[0]` → `TypeError: Cannot read properties of undefined`
**[verified]** → caught in `_renderGlslEffect` → original image returned. Many workshop
frags rely on the engine's generic vertex stage. **Fix:** when a frag declares varyings but
no vert exists, synthesize `v_TexCoord`/`v_UV`-style varyings from the pixel's (fu,fv)
(default zero for unknown names) instead of crashing per pixel.

### GLS-17 — **P2** — `transpile.js:362-367` — `gl_FragCoord` (and other gl_* reads) are not provided → ReferenceError → effect disabled

Screen-space workshop shaders read `gl_FragCoord`; the transpiler emits the bare identifier
and nothing in the module defines it → first read throws → fallback to original image.
`renderGlsl` already knows (x,y) per pixel and could inject `__rt`-style `gl_FragCoord =
[x+0.5, y+0.5, 0, 1]` via the `__v` mechanism. **Fix:** thread a per-pixel `gl_FragCoord`
through the same object as varyings; cheap and unblocks a whole class of effects.

### GLS-18 — **P2** — `model.js:688-692` (context file; feeds `_glslSample` too) — left/top edge of every texture extrapolates instead of clamping/wrapping; can go negative

`fx = x * W - 0.5` with `x0 = max(0, floor(fx))` leaves `tx = fx - x0 ∈ [-0.5, 0)` for the
left half-texel band; weights are not clamped and the +1 tap is not wrapped. **[verified]**
with texels [0,100,200,300]: at `u = 0` CLAMP the sampler returns `1.5·t0 − 0.5·t1 = −50`
where GPU CLAMP returns 0; at `u = 0.01` REPEAT returns −46 where GPU bilinear REPEAT leans
on the wrapped texel W−1 (≈2.5). Negative intermediates then flow into mask/normal math of
CPU effects and GLSL shaders alike (dark 1px left/top seam). **Fix:** clamp `tx, ty` to
[0,1] for CLAMP and index the +1 tap with `(x0+1) % W` for REPEAT.

### GLS-19 — **P2** — `transpile.js:62-73`, `:513-516` — overloaded functions collapse to the last definition for all call sites

`this.functions` is keyed by name only; two GLSL overloads emit two same-named JS functions
(later wins) and every call site targets it. **[verified]**: `scale(float)` and
`scale(vec2)` → calls with vec2 args hit the vec2 body (ok by luck), but float call sites
would get `v[0]+v[1]` = NaN. Common for `hash()/noise()` variants. **Fix:** mangle names by
parameter-type signature at definition and call sites (the param types are already
collected in `collect()`).

---

## B. Preprocessor (`preprocess.js`)

### GLS-20 — **P3** — `preprocess.js:10` — `[COMBO_OFF]` and texture-driven combos (`MASK`) are not parsed by the CPU-path `parseMeta`

`comboRe` matches `[COMBO]` only; `parseMetaGL` handles `[COMBO_OFF]` and the
MASK→textureUniform derivation (`preprocess.js:98-115`). Mitigations make this mostly
benign today: shaderfrog evaluates undefined macros as 0 **[verified]** (which equals the
COMBO_OFF default), and workshop scenes usually bake combos into `pass.combos` (injected
via `preprocessShader` `defines`). But a workshop shader whose mask combo is *not* baked
will silently render with the mask branch off even when the mask texture is bound. **Fix:**
reuse `parseMetaGL`'s table for the CPU path (the two parsers already coexist for exactly
this purpose).

### GLS-21 — **P3** — `preprocess.js:34-49` — `expandIncludes` iterates `source` while mutating `out`; shared `seen` set drops legitimately repeated includes

`re.exec(source)` walks the *original* text while replacements go to `out` (works only
because match text, not positions, is replaced); the `seen` set is shared across *sibling*
includes at all depths, so an unguarded snippet included by two different headers is
expanded once and silently emptied the second time (guarded WE headers like `common.h` are
unaffected). Includes inside block comments also match. **Fix:** iterate with
`out = out.replace(re, …)` callback form; drop `seen` in favor of a per-expansion-stack
guard for cycle prevention only.

### GLS-22 — **P3** — `executor.js:10-15` vs `preprocess.js:52-63` — `compileGlsl` runs `parseMeta` on the pre-expansion source

Uniform metadata living inside included headers is collected by `preprocessShader`'s
internal post-expansion `parseMeta` (for defines) but not by `compileGlsl`'s, so those
uniforms are missing from the returned `uniforms` table and never bound (→ NaN per GLS-15).
**Fix:** have `preprocessShader` return the post-expansion meta, or re-run `parseMeta` after
expansion in `compileGlsl`.

### GLS-23 — **P3** — `preprocess.js:26-29` — precision-qualified declarations are not matched by the uniform regexes

`uniform highp sampler2D g_Texture0;` — `unifPlain` requires `uniform <type> <name>;`
adjacent tokens, so qualified declarations fall out of the meta table (the transpiler's AST
scan still sees them, so they read `__u` and go NaN-undefined per GLS-15 rather than
crashing). **Fix:** allow optional qualifiers: `/uniform\s+(?:(?:lowp|mediump|highp)\s+)?([\w]+)\s+(\w+)\s*;/`.

---

## C. Executor / runtime (`executor.js`, `runtime.js`)

### GLS-24 — **P3** — `executor.js:151-157` — `makeSampler` is dead code with a contradictory null-texture default

`makeSampler` is exported but never used (integration binds `this._glslSample` directly).
Its `!tex → [0,0,0,0]` guard contradicts the effective behavior (`_texSample` returns
`[1,1,1,1]` white for null textures — which happens to match the official util/white
convention for masks, but not the flowmask mid-gray case documented in details §13.4). Also
dead: `makeVarying` (`executor.js:53-55`) and `runtime.js:205` `export const texture2D =
null`. **Fix:** delete the dead exports; document the white default (and consider the
mode-based fallback the GL route implements).

### GLS-25 — **P3** — `executor.js:76` — `int` uniforms are not truncated

`convertUniform` for `int` does `Number(v)`; a csv value of `0.5` stays `0.5` and any
`Math.trunc`-style semantics downstream diverge from GLSL. **Fix:** `Math.trunc(Number(v))`
for `int`/`uint`.

### GLS-26 — **P3** — `transpile.js:116-145`, `runtime.js` — module-level (global) mutable state persists across pixels

GLSL globals are re-initialized per fragment invocation; the transpiled module initializes
globals once per `renderGlsl` and `main()` mutations carry over to the next pixel. Affects
noise-seed idioms (`float seed = 1.0; void main(){ seed = fract(seed*…); }`). **Fix:**
re-assign non-const globals at the top of the generated `main()` (or per-pixel), or document
the restriction.

### GLS-27 — **P3** — `integration.js:15` — cache key is `file|JSON.stringify(passes[0].combos)`; safe today but content-blind

Correct aspects verified: `null` caching prevents recompiling failed shaders every frame
(`integration.js:28,47`); `_glslCache` is an instance property (own-property assignment at
`:16` shadows the prototype `null` at `:9`), and `SceneRenderer` is created per render job
(`scene-render-worker.mjs:13,34`), so cross-pkg collisions cannot happen and the
missing-shader-content dimension of the key is harmless. Risk appears only if the renderer
ever becomes long-lived per pkg. **Fix (defensive):** include `frag.length + vert.length`
or a hash in the key; skip passes[1+] combos knowingly (see GLS-28).

### GLS-28 — **P2** — `integration.js:75,107-127` — only `passes[0]` is executed; multi-pass workshop effects silently render their first pass only; animated downsampling is nearest-neighbor

Two related scope cuts in the live `_applyGlslEffect`: (a) `pass = ef.passes[0]` and a
single `renderGlsl` call — workshop effects with render-to-texture pass chains (blur
variants etc.) lose every pass after the first, with no log; (b) animated frames >65536 px
render at ≤~340×192 and are **nearest-neighbor** upscaled (`_upsampleRgba:164-182`, mapping
formula verified correct: `floor(y*sh/H)` covers all source rows, `min` clamps are right) —
mathematically sound but visibly blocky for smooth full-screen effects; a bilinear pass
would cost the same order as one shader sample. (a) is worth a `log('多 pass 效果仅执行
pass 0')` at minimum, and a gate that falls back to the original image for `passes.length >
1` if fidelity is preferred over partial output. **Fix:** at least log; ideally implement
the 2-3 most common pass graphs (downsample → gaussian x/y → combine, as the hand-written
`effectBlur` already does).

---

## D. Header stubs (`common.h`, `common_perspective.h`)

### GLS-29 — **P3** — `common.h:3-4` — M_PI constants differ (harmlessly) between stubs and runtime; `mul` macro is CPU-path hazardous

`common.h` `M_PI = 3.14159265358979323846` vs `runtime.js:157` `M_PI = 3.14159265359` (the
WE-authored value). In the CPU path both can be in scope depending on whether common.h
resolved (macro wins after preprocessing), giving `cos(π)` ≈ −1 vs −0.9999999999 — visible
only as sub-pixel phase noise; note it because WE-REVERSE treats official source as
ground truth. The `mul` macro hazard is covered in GLS-03. `common_perspective.h`'s
`squareToQuad` column-major layout is consistent with `runtime.mul`'s column-major indexing
(checked: `mat3(a,d,g, b,e,h, c,f,1.0)` flat = [a,d,g,b,e,h,c,f,1], and `mul` reads
`m[j + i*rows]` — row i of column-vector convention ✓), and its guard symbol
(`WE_COMMON_PERSPECTIVE_H_MIN`) matches the §13.5 stub-injection convention. OK.

---

## Verified OK

- `readBalancedJson` (`preprocess.js:74-92`): handles strings/escapes/nested braces;
  `parseMetaGL` recovers `MODE`/`NOISE` combos that CPU `parseMeta` loses **[verified]**.
- `parseMetaGL` vs details §6.3 spec: `[COMBO|COMBO_OFF]`, uniform-meta spread, texture-combo
  derivation default `'0'` — faithful to the as-written spec **[verified]**.
- shaderfrog `preprocessShader`: injected combo defines + undefined-macro-as-0 semantics
  consistent; `#ifdef`/`#if` branches cut cleanly, no spurious errors **[verified]**.
- Transpiler basics: unary minus on vec (inline per-component), else-if chains, ternary with
  vec branches, `float()/int()/bool()` casts (trunc via `Math.trunc` ✓), `while` +
  `break`/`continue`, multi-component swizzle compound assignment (`c.xy += v` per-component
  with temp hoist) all emit correct JS **[verified]**.
- Swizzle reads (`.xyzw/.rgba/.stpq` single and multi), vec constructors (scalar broadcast,
  multi-arg join + truncate) produce correct values for simple operands **[verified]**.
- `runtime.js` math: `mix/step/smoothstep/clamp/min/max/mod/fract` broadcast semantics
  match GLSL (incl. `mod` floor-variant and `fract(x)=x−floor(x)` for negatives);
  `atan(y,x)` argument order correct despite the confusing comment; `dot/length/distance/
  normalize` fine; `mul(v,m)` row-vector × column-major verified against `CAST3X3` layout;
  `saturate` on scalars and vectors; `CAST2/3/4` fallbacks.
- `runtime.mul` + `CAST3X3` mat4→mat3 upper-left extraction is the correct column-major
  element set `[0,1,2,4,5,6,8,9,10]` (unlike `constructMat`'s flat-slice — GLS noted inside
  GLS-03 family; direct `mat3(mat4)` constructor takes the wrong 9 elements, P3).
- `executor.renderGlsl` varying pipeline: 4-corner eval order `[(0,0),(1,0),(0,1),(1,1)]` =
  TL,TR,BL,BR matches `bilinearTo`'s top/bottom pairing; pixel-center `(x+0.5)/W` UVs;
  y-down orientation consistent with the CPU convention (WE-REVERSE §9.1); pre-allocated
  interpolation buffers reused per pixel without aliasing; scalar varyings handled;
  NaN output clamps to 0 rather than poisoning the Uint8Array **[verified by trace]**.
- Vertex-stage handling: varying pre-initialization to Float32Array(4) before corner eval
  makes swizzle-writes safe; `gl_Position` writes land in an implicit global (harmless);
  `a_TexCoord` corners match the y-down GPU quad convention (details §3).
- `buildUniforms`/`convertUniform`: csv string vectors ("1 1"), single-number broadcast,
  `{value:…}` unwrapping, bool coercion, mat4 passthrough all correct; engine-inject
  fallbacks (`g_Time`, `g_UserAlpha=1`, `g_ParallaxPosition` default) sane.
- Cache: null-caching of failed compiles; per-instance Map (prototype-shadow) is per-job
  safe; combos included in key **[verified]**.
- Downsample/upsample mapping math (`_upsampleRgba`) correct, incl. edge clamps; static
  frames correctly exempted (`staticFrame = !(times.length > 1)`, `core.js:51`) and downsampled
  uniforms keep full-res `objW/objH` so resolution math stays resolution-independent.
- Duplicate-method scan across all `lib/we-renderer/*.js` mixins: `_applyGlslEffect` is the
  only shadowed definition; no other conflicting duplicates.
- `math.js applyBlending`: modes 0-32 match common_blending.h semantics as previously
  reviewed (03 file); output clamp to [0,1] prevents Uint8Array wraparound as commented.
- `model.js _texSample` NaN/Inf guard returns transparent black; REPEAT modulo handles
  negatives; only the half-texel edge band is off (GLS-18).
