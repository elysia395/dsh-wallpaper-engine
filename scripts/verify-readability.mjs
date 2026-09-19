// Verify the TEXT-SURFACE READABILITY FLOOR (upstream #82).
//
// Why this suite exists: the wallpaper may be dimmed/blended so it "does not
// dominate", but TEXT MUST STAY READABLE. IDEA's background-image feature has a
// single knob (image opacity) and still "just works" because the image always
// sits BEHIND the editor / tool-window surfaces, which keep a background of
// their own. This plugin lacked that structural property: every text-bearing
// surface was painted as `glass colour @ --we-glass-alpha`, and in dark mode
// that alpha is additionally multiplied by 0.4 — worst case 0.03 × 0.4 = 0.012,
// i.e. no frost at all. The floor is a THEME-BASE LAYER composited OVER the
// glass tint at a fixed weight:
//
//     color-mix(in srgb, <theme base> floor%, <glass tint @ its alpha> (1-floor)%)
//     effective alpha = floor + a·(1−floor) ≥ floor
//
// so neither 玻璃透明度 nor the dark-theme ×0.4/×0.33 factors can undercut it
// (they only scale the tint operand). Clamping the tint alpha itself with max()
// cannot work — in dark mode the tint is a WHITE glaze and can only LIGHTEN the
// surface (measured ceiling 1.79:1 at any alpha), so the theme-base layer is
// the only shape that reaches the WCAG 4.5:1 body-text target. Where a surface
// drives its own same-colour alpha (the editor/terminal content plate) the
// floor IS a literal max() clamp, which leaves the user's value above the floor
// byte-identical.
//
// Assertions (all derived from the BUILT lib/client.js — nothing re-typed):
//   F1  the floor is an explicit named constant + CSS token pair, and the
//       stylesheet copy matches the JS constant (no drift).
//   F2  every text-bearing surface the plugin drives carries the floor in BOTH
//       themes: composer/bubble tokens, settings-window layers 1/2/3, sidebar
//       panels + native right panel, the plugin's own drawer / panel modal, and
//       the update toast (max() form).
//   F3  the content-surface plate uses a literal max() clamp on its own alpha.
//   F4  the software-render fallback plate still clears the floor (the #95
//       fallback from 8894670/7ba5643 keeps working).
//   C1  full grid 玻璃透明度 {0,15,30,45,60} × theme {light,dark} × 壁纸透明度
//       {0,50,90}: the effective composer-surface alpha is ≥ the floor, with the
//       computed numbers printed.
//   C2  the floor is NOT reduced at 玻璃透明度 = 60 (its most transparent end).
//   C3  the floor is NOT affected by 壁纸透明度: the floor declarations never
//       read --we-wallpaper-opacity, the effective alpha is identical for
//       {0,50,90}, and that token still only drives .we-layer.
//   C4  above the floor the slider is NOT flattened: the alpha still changes
//       monotonically with 玻璃透明度, and for the content plate every user
//       alpha above the floor passes through unchanged.
//   C5  the dark-theme ×0.4 tint factor cannot undercut the floor (the veil
//       weight is independent of it) — proven against the extracted factor.
//   M1  the measurement has discriminating power: the UN-floored tint fails
//       4.5:1 in the worst case (the bug), the floored surface passes.
//   M2  helpers behave (positive + negative controls on the contrast maths).
//
// Usage: node scripts/verify-readability.mjs
import { readFileSync } from 'node:fs';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
}

const SRC = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

// ── source → values ─────────────────────────────────────────────────────────
function num(re, text = SRC) {
  const m = text.match(re);
  return m ? Number(m[1]) : NaN;
}

// 1) the named JS constants (single source of truth for both floor values)
const FLOOR_JS = {
  light: num(/const READABILITY_FLOOR = ([\d.]+);/),
  dark: num(/const READABILITY_FLOOR_DARK = ([\d.]+);/),
};

// 2) the injected stylesheet: evaluate the CSS template literal with exactly
// those constants (so the string checked here IS the string the plugin injects).
const CSS_BODY_MATCH = SRC.match(/const CSS = `([^`]*)`;/);
const CSS_BODY = CSS_BODY_MATCH ? CSS_BODY_MATCH[1] : '';
let CSS = '';
let cssError = null;
try {
  CSS = new Function('READABILITY_FLOOR', 'READABILITY_FLOOR_DARK',
    'return `' + CSS_BODY + '`;')(FLOOR_JS.light, FLOOR_JS.dark);
} catch (err) { cssError = err && err.message; }

// 3) the glass-alpha mapping, derived from the source (never re-typed here)
const GMAP = SRC.match(/const glassAlpha = Math\.max\(([\d.]+), ([\d.]+) - \(selection\.glassAlpha \/ ([\d.]+)\) \* ([\d.]+)\);/);
const glassAlpha = GMAP
  ? (pct) => Math.max(Number(GMAP[1]), Number(GMAP[2]) - (pct / Number(GMAP[3])) * Number(GMAP[4]))
  : null;

// ── flat-rule lookup on the injected stylesheet ─────────────────────────────
/** Every flat rule whose body declares `prop` (brace-depth matched). */
function rulesWithProp(prop) {
  const out = [];
  const needle = prop + ':';
  let from = 0;
  for (;;) {
    const at = CSS.indexOf(needle, from);
    if (at < 0) break;
    from = at + needle.length;
    const open = CSS.lastIndexOf('{', at);
    if (open < 0) continue;
    const prevClose = CSS.lastIndexOf('}', open);
    const header = CSS.slice(prevClose + 1, open).trim();
    let depth = 0, close = -1;
    for (let i = open; i < CSS.length; i++) {
      if (CSS[i] === '{') depth++;
      else if (CSS[i] === '}') { depth--; if (depth === 0) { close = i; break; } }
    }
    if (close < 0) continue;
    out.push({ header, body: CSS.slice(open + 1, close) });
  }
  return out;
}

function declValue(body, prop) {
  const m = body.match(new RegExp('(?:^|[\\s;])' + prop + ':\\s*([^;]+);'));
  return m ? m[1].trim() : null;
}

/** The rule declaring `prop` whose header contains `selector`, if any. */
function ruleFor(prop, selector) {
  return rulesWithProp(prop).find((r) => r.header.includes(selector)) || null;
}

/** Does this declaration open with the floor veil (theme base at floor weight)? */
function hasVeil(value, label) {
  if (value === null) return { ok: false, why: label + ': declaration missing' };
  const ok = /^color-mix\(in srgb,\s*var\(--we-readability-base\)\s+calc\(var\(--we-readability-floor\) \* 100%\),/.test(value)
    && value.includes('calc((1 - var(--we-readability-floor)) * 100%)');
  return { ok, why: label + ': ' + JSON.stringify(value.slice(0, 120)) };
}

// ── colour maths (WCAG 2.x) ─────────────────────────────────────────────────
const hex2rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const s2l = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = ([r, g, b]) => 0.2126 * s2l(r) + 0.7152 * s2l(g) + 0.0722 * s2l(b);
const contrast = (a, b) => {
  const la = lum(a), lb = lum(b), hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
};
const over = (fg, fa, bg) => fg.map((c, i) => c * fa + bg[i] * (1 - fa));
/** theme-base veil at `F` composited OVER a tint of colour `frost` at alpha `w`. */
const veil = (frost, w, base, F) => {
  const alpha = F + w * (1 - F);
  const premult = frost.map((c, i) => base[i] * F + c * w * (1 - F));
  return { alpha, color: premult.map((c) => c / alpha) };
};

const GRID_GLASS = [0, 15, 30, 45, 60];
const GRID_WP = [0, 50, 90];
const TEXT = { light: [0, 0, 0], dark: [255, 255, 255] };
// worst-case backdrop: the darkest / brightest plausible wallpaper pixel (the
// wallpaper is fully opaque there, i.e. 壁纸透明度 = 0).
const WORST_PIXEL = { light: [0, 0, 0], dark: [255, 255, 255] };
// page base the wallpaper blends toward (README: light → white, dark → black)
const PAGE_BASE = { light: [255, 255, 255], dark: [0, 0, 0] };

function main() {
  // ── F1: explicit named floor, JS constant ↔ CSS token, no drift ───────────
  check('F1a the floor is an explicit named pair of JS constants',
    FLOOR_JS.light > 0 && FLOOR_JS.light < 1 && FLOOR_JS.dark > 0 && FLOOR_JS.dark < 1,
    'READABILITY_FLOOR=' + FLOOR_JS.light + ' READABILITY_FLOOR_DARK=' + FLOOR_JS.dark);

  check('F1b the injected stylesheet was extracted + evaluated (no interpolation surprise)',
    CSS.length > 50000 && cssError === null,
    'css chars=' + CSS.length + ' · template error=' + JSON.stringify(cssError));

  const lightVars = CSS.match(/body \{\s*--we-readability-floor:\s*([\d.]+);\s*--we-readability-base:\s*(#[0-9a-fA-F]{6});/);
  const darkVars = CSS.match(/body\[data-ds-dark-theme\] \{\s*--we-readability-floor:\s*([\d.]+);\s*--we-readability-base:\s*(#[0-9a-fA-F]{6});/);
  check('F1c --we-readability-floor / --we-readability-base are declared for both themes',
    lightVars !== null && darkVars !== null,
    'light=' + JSON.stringify(lightVars && [Number(lightVars[1]), lightVars[2]])
      + ' dark=' + JSON.stringify(darkVars && [Number(darkVars[1]), darkVars[2]]));
  check('F1d the stylesheet floor EQUALS the JS constant (no drift)',
    lightVars !== null && darkVars !== null
      && Number(lightVars[1]) === FLOOR_JS.light && Number(darkVars[1]) === FLOOR_JS.dark,
    'css=' + JSON.stringify(lightVars && Number(lightVars[1])) + '/' + JSON.stringify(darkVars && Number(darkVars[1]))
      + ' js=' + FLOOR_JS.light + '/' + FLOOR_JS.dark);

  const FLOOR = {
    light: lightVars ? Number(lightVars[1]) : NaN,
    dark: darkVars ? Number(darkVars[1]) : NaN,
  };
  const BASE = {
    light: lightVars ? hex2rgb(lightVars[2]) : null,
    dark: darkVars ? hex2rgb(darkVars[2]) : null,
  };

  // ── F2: every text-bearing surface carries the floor, both themes ─────────
  const surfaceSpecs = [
    ['composer card token (light)', '--dsw-specific-input-major', 'body[data-we-wallpaper]'],
    ['message bubble token (light)', '--dsw-specific-bubble', 'body[data-we-wallpaper]'],
    ['composer card token (dark)', '--dsw-specific-input-major', 'body[data-ds-dark-theme][data-we-wallpaper]'],
    ['message bubble token (dark)', '--dsw-specific-bubble', 'body[data-ds-dark-theme][data-we-wallpaper]'],
    ['settings window layer 1 (light)', '--dsw-alias-bg-layer-1', 'body[data-we-glass-window]'],
    ['settings window layer 2 (light)', '--dsw-alias-bg-layer-2', 'body[data-we-glass-window]'],
    ['settings window layer 3 (light)', '--dsw-alias-bg-layer-3', 'body[data-we-glass-window]'],
    ['settings window layer 1 (dark)', '--dsw-alias-bg-layer-1', 'body[data-ds-dark-theme][data-we-glass-window]'],
    ['settings window layer 2 (dark)', '--dsw-alias-bg-layer-2', 'body[data-ds-dark-theme][data-we-glass-window]'],
    ['settings window layer 3 (dark)', '--dsw-alias-bg-layer-3', 'body[data-ds-dark-theme][data-we-glass-window]'],
    ['sidebar panel (light)', 'background-color', 'body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_panel"]'],
    ['sidebar chrome group (light)', 'background-color', 'body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_terminalWrap"]'],
    ['sidebar panel (dark)', 'background-color', 'body[data-ds-dark-theme][data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_panel"]'],
    ['sidebar chrome group (dark)', 'background-color', 'body[data-ds-dark-theme][data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_terminalWrap"]'],
    ['native right panel (light)', 'background-color', 'body[data-we-sidebar-glass] [data-sidebar-right-panel]'],
    ['native right panel (dark)', 'background-color', 'body[data-ds-dark-theme][data-we-sidebar-glass] [data-sidebar-right-panel]'],
    ['plugin repo drawer', 'background-color', '.we-repo-panel--open'],
    ['plugin panel modal', 'background-color', '.we-picker__modal--panel'],
  ];
  const veilMisses = [];
  for (const [label, prop, selector] of surfaceSpecs) {
    const rule = ruleFor(prop, selector);
    const value = rule ? declValue(rule.body, prop) : null;
    const verdict = hasVeil(value, label);
    if (!verdict.ok) veilMisses.push(verdict.why);
  }
  check('F2a every text-bearing surface token carries the readability floor (veil form)',
    veilMisses.length === 0,
    surfaceSpecs.length + ' surface(s) checked · missing/broken=' + veilMisses.length
      + (veilMisses.length ? ' · ' + JSON.stringify(veilMisses) : ''));

  const darkComposer = ruleFor('--dsw-specific-input-major', 'body[data-ds-dark-theme][data-we-wallpaper]');
  const DARK_FACTOR = darkComposer
    ? Number((declValue(darkComposer.body, '--dsw-specific-input-major')
      .match(/rgba\(255, 255, 255, calc\(var\(--we-glass-alpha, [\d.]+\) \* ([\d.]+)\)\)/) || [])[1])
    : NaN;
  check('F2b the veil keeps a fixed weight while the tint keeps its own alpha (dark ×factor preserved)',
    /rgba\(255, 255, 255, calc\(var\(--we-glass-alpha, 0\.15\) \* 0\.4\)\)/.test(declValue(darkComposer ? darkComposer.body : '', '--dsw-specific-input-major') || '')
      && /calc\(var\(--we-readability-floor\) \* 100%\)/.test(declValue(darkComposer ? darkComposer.body : '', '--dsw-specific-input-major') || ''),
    'dark tint factor=' + DARK_FACTOR);

  // ── F3: the content plate uses a literal max() clamp on its own alpha ──────
  const contentProp = 'background-color';
  const contentRules = rulesWithProp(contentProp)
    .filter((r) => /\.cm-editor|xterm|\.dshDesktopSidebarSurface/.test(r.header));
  const CONTENT_TOKEN = 'max(calc(var(--we-readability-floor) * 100%), var(--we-content-surface-alpha, 88%))';
  check('F3 the editor/terminal content plate clamps its own alpha with max()',
    contentRules.length >= 3 && contentRules.every((r) => r.body.includes(CONTENT_TOKEN)),
    contentRules.length + ' content rule(s), all carrying ' + CONTENT_TOKEN);

  // ── F4: the software-render fallback plate still clears the floor ─────────
  const fbRule = rulesWithProp(contentProp)
    .find((r) => r.header.includes('[data-we-glass-fallback]') && r.header.includes('[data-composer-card]::before'));
  const fbPlatePct = fbRule
    ? Number((fbRule.body.match(/color-mix\(in srgb, var\(--we-glass-color, #ffffff\) (\d+)%, transparent\)/) || [])[1])
    : NaN;
  check('F4 the software-render fallback plate (#95) still clears the floor',
    fbPlatePct / 100 >= Math.max(FLOOR.light, FLOOR.dark),
    'fallback plate=' + (isNaN(fbPlatePct) ? 'missing' : fbPlatePct + '%') + ' · floor=' + Math.max(FLOOR.light, FLOOR.dark));

  // ── C1/C2: the grid — effective composer alpha ≥ floor, numbers printed ───
  check('C1a the glass-alpha mapping was derived from the source',
    glassAlpha !== null, 'mapping=' + JSON.stringify(GMAP ? GMAP.slice(1) : null));

  const alphaTable = { light: [], dark: [] };
  const contrastTable = { light: [], dark: [] };
  let alphaOk = true, contrastOk = true;
  for (const theme of ['light', 'dark']) {
    const F = FLOOR[theme];
    for (const gp of GRID_GLASS) {
      const g = glassAlpha(gp);
      const w = theme === 'dark' ? g * DARK_FACTOR : g;
      const { alpha, color } = veil([255, 255, 255], w, BASE[theme], F);
      alphaTable[theme].push(Number(alpha.toFixed(4)));
      if (!(alpha >= F)) alphaOk = false;
      // 壁纸透明度 only changes the BACKDROP (never the surface): worst case is
      // the fully opaque extreme wallpaper pixel.
      let worst = Infinity;
      for (const wp of GRID_WP) {
        const backdrop = over(WORST_PIXEL[theme], 1 - wp / 100, PAGE_BASE[theme]);
        worst = Math.min(worst, contrast(TEXT[theme], over(color, alpha, backdrop)));
      }
      contrastTable[theme].push(Number(worst.toFixed(2)));
      if (!(worst >= 4.5)) contrastOk = false;
    }
  }
  check('C1b full grid: effective composer-surface alpha ≥ floor (玻璃透明度 × 壁纸透明度 × theme)',
    alphaOk,
    'light α=' + alphaTable.light.join('/') + ' (floor ' + FLOOR.light + ') · dark α='
      + alphaTable.dark.join('/') + ' (floor ' + FLOOR.dark + ')');
  check('C1c full grid: worst-case WCAG contrast of body text ≥ 4.5:1',
    contrastOk,
    'light=' + contrastTable.light.join('/') + ' · dark=' + contrastTable.dark.join('/')
      + ' (worst backdrop: light #000, dark #fff; text light #000 / dark #fff)');

  check('C2 the floor is NOT reduced at 玻璃透明度 = 60 (most transparent end)',
    alphaTable.light[GRID_GLASS.length - 1] >= FLOOR.light
      && alphaTable.dark[GRID_GLASS.length - 1] >= FLOOR.dark
      && alphaTable.light[GRID_GLASS.length - 1] === Math.min(...alphaTable.light)
      && alphaTable.dark[GRID_GLASS.length - 1] === Math.min(...alphaTable.dark),
    'min alpha light=' + Math.min(...alphaTable.light) + ' dark=' + Math.min(...alphaTable.dark)
      + ' vs floors ' + FLOOR.light + '/' + FLOOR.dark);

  // ── C3: independence from 壁纸透明度 ──────────────────────────────────────
  // One composite step that takes the 壁纸透明度-driven backdrop as an INPUT, so
  // "the alpha does not move" is a property of the code path, not of a constant
  // compared with itself (the contrast half DOES move, proving wp is exercised).
  function surfaceFor(theme, gp, wp) {
    const g = glassAlpha(gp);
    const w = theme === 'dark' ? g * DARK_FACTOR : g;
    const backdrop = over(WORST_PIXEL[theme], 1 - wp / 100, PAGE_BASE[theme]);
    const s = veil([255, 255, 255], w, BASE[theme], FLOOR[theme]);
    return {
      alpha: s.alpha,
      contrast: contrast(TEXT[theme], over(s.color, s.alpha, backdrop)),
    };
  }
  const floorDeclRules = surfaceSpecs
    .map(([, prop, selector]) => ruleFor(prop, selector))
    .filter(Boolean);
  const floorText = floorDeclRules.map((r) => r.header + ' { ' + r.body + ' }').join('\n')
    + '\n' + (lightVars ? lightVars[0] : '') + (darkVars ? darkVars[0] : '');
  const wpLeak = /--we-wallpaper-opacity/.test(floorText);
  const layerOpacity = rulesWithProp('opacity').find((r) => /\.we-layer\s*$/.test(r.header));
  const alphaPerWp = GRID_WP.map((wp) => Number(surfaceFor('light', 30, wp).alpha.toFixed(6)));
  const contrastPerWp = GRID_WP.map((wp) => Number(surfaceFor('light', 30, wp).contrast.toFixed(2)));
  check('C3a the floor never reads --we-wallpaper-opacity: surface alpha is identical for 壁纸透明度 {0,50,90}',
    !wpLeak && new Set(alphaPerWp).size === 1 && new Set(contrastPerWp).size > 1,
    'floor declarations mention --we-wallpaper-opacity=' + wpLeak
      + ' · α=' + alphaPerWp.join('/') + ' (identical) · backdrop contrast=' + contrastPerWp.join('/') + ' (moves)');
  check('C3b 壁纸透明度 keeps driving ONLY .we-layer (semantics unchanged)',
    layerOpacity !== undefined && layerOpacity.body.includes('opacity: var(--we-wallpaper-opacity, 1)'),
    '.we-layer opacity=' + JSON.stringify(layerOpacity && declValue(layerOpacity.body, 'opacity')));

  // ── C4: the slider is not flattened above the floor ──────────────────────
  const strictlyDecreasing = (arr) => arr.every((v, i) => i === 0 || v < arr[i - 1]);
  // content plate: user alphas above the floor must pass through unchanged.
  const userAlphas = [20, 30, 45, 50, 70, 88, 100];
  const clamped = userAlphas.map((p) => Math.max(FLOOR.light * 100, p));
  const passThrough = userAlphas.every((p, i) => p <= FLOOR.light * 100 || clamped[i] === p);
  const everAboveFloor = userAlphas.some((p) => p > FLOOR.light * 100);
  check('C4a the content plate is not flattened: user alphas above the floor pass through unchanged',
    passThrough && everAboveFloor && clamped.every((v) => v >= FLOOR.light * 100),
    'user=' + userAlphas.join('/') + ' → effective=' + clamped.join('/') + ' (floor ' + (FLOOR.light * 100) + '%)');
  check('C4b 玻璃透明度 still changes the effective alpha monotonically (no flattening)',
    strictlyDecreasing(alphaTable.light) && strictlyDecreasing(alphaTable.dark),
    'light ' + alphaTable.light.join(' > ') + ' · dark ' + alphaTable.dark.join(' > '));

  // ── C5: the dark ×0.4 factor cannot undercut the floor ───────────────────
  const darkNoTint = veil([255, 255, 255], 0, BASE.dark, FLOOR.dark);
  check('C5 the dark-theme tint factor cannot lower the veil (floor holds even at tint alpha 0)',
    Math.abs(darkNoTint.alpha - FLOOR.dark) < 1e-12 && FLOOR.dark > DARK_FACTOR,
    'veil alpha at tint 0 = ' + darkNoTint.alpha + ' · floor=' + FLOOR.dark + ' > tint factor=' + DARK_FACTOR);

  // ── M1: discriminating power — the un-floored tint FAILS ─────────────────
  let beforeWorst = Infinity, beforeAt = null;
  let clampCeiling = 0;
  for (const theme of ['light', 'dark']) {
    for (const gp of GRID_GLASS) {
      const g = glassAlpha(gp);
      const w = theme === 'dark' ? g * DARK_FACTOR : g;
      for (const wp of GRID_WP) {
        const backdrop = over(WORST_PIXEL[theme], 1 - wp / 100, PAGE_BASE[theme]);
        const cr = contrast(TEXT[theme], over([255, 255, 255], w, backdrop));
        if (cr < beforeWorst) { beforeWorst = cr; beforeAt = theme + ' @ 玻璃透明度=' + gp + ', 壁纸透明度=' + wp + ', α=' + w.toFixed(4); }
      }
      // What a max() clamp on the TINT alpha could do at best in dark mode: the
      // glaze is white, so over the brightest pixel it is white at every alpha.
      if (theme === 'dark') {
        clampCeiling = Math.max(clampCeiling,
          contrast(TEXT.dark, over([255, 255, 255], Math.max(FLOOR.dark, w), WORST_PIXEL.dark)));
      }
    }
  }
  check('M1 the OLD (un-floored) surface really fails 4.5:1 — this assertion has teeth',
    beforeWorst < 4.5 && clampCeiling < 4.5,
    'worst before=' + beforeWorst.toFixed(2) + ':1 (' + beforeAt + ') · worst after='
      + Math.min(...contrastTable.light, ...contrastTable.dark).toFixed(2) + ':1'
      + ' · best a max() clamp on the dark tint could reach=' + clampCeiling.toFixed(2) + ':1 (why the floor is a layer)');

  // ── M2: maths helpers, positive + negative controls ──────────────────────
  const controls = [
    ['black on white = 21', Math.abs(contrast([0, 0, 0], [255, 255, 255]) - 21) < 0.01],
    ['white on white = 1', Math.abs(contrast([255, 255, 255], [255, 255, 255]) - 1) < 0.01],
    ['veil alpha additive', Math.abs(veil([0, 0, 0], 0.5, [255, 255, 255], 0.5).alpha - 0.75) < 1e-12],
    ['veil colour is the base over the tint', veil([0, 0, 0], 0, [255, 255, 255], 0.5).color.join() === '255,255,255'],
    ['veil at tint 0 = base only', veil([0, 0, 0], 0, [0, 0, 0], 0.59).alpha === 0.59],
    ['negative control: 0.3 veil fails 4.5:1', contrast([0, 0, 0], over([255, 255, 255], 0.3, [0, 0, 0])) < 4.5],
  ];
  const bad = controls.filter(([, ok]) => !ok).map(([name]) => name);
  check('M2 contrast/veil helpers hold their positive + negative controls',
    bad.length === 0, controls.length + ' controls, failed=[' + bad.join(', ') + ']');

  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (failed.length === 0
    ? 'ALL READABILITY FLOOR CHECKS PASSED'
    : failed.length + ' CHECK(S) FAILED'));
  process.exit(failed.length === 0 ? 0 : 1);
}

try {
  main();
} catch (err) {
  console.error('TEST ERROR:', err && err.stack ? err.stack : err);
  process.exit(1);
}
