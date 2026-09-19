// Verify the SOFTWARE-RENDERING backdrop-filter fallback (upstream issue #95).
//
// Why this suite exists: `@supports not ((backdrop-filter: blur(1px)) or
// (-webkit-backdrop-filter: blur(1px)))` is a SYNTAX check. In third-party
// desktop shells that composite in software (enhanced / extended window modes)
// the property parses fine but NEVER renders, so that CSS fallback stays
// dormant, the glass surfaces claim a blur nobody draws, and the panels look
// fully transparent ("过透"). The fix detects the condition at RUNTIME from the
// WebGL renderer string and sets `body[data-we-glass-fallback]`; the CSS keyed
// on that attribute disables backdrop-filter explicitly and re-applies the very
// same near-opaque recipe the @supports fallbacks already carry (same --we-*
// tokens, same color-mix declarations — no new mechanism, no new token).
//
// Static source assertions (cheap, robust) plus real runtime assertions against
// the BUILT lib/client.js loaded in a node:vm sandbox with mocked globals, one
// fresh sandbox per scenario (the detection caches its decision per module
// instance, so a fresh instance is what makes scenario isolation honest).
//
//   S1 the software-rasteriser regex carries every required pattern + /i.
//   S2 the manual override token + both renderer read paths are present.
//   A1 renderer containing SwiftShader → body[data-we-glass-fallback="1"].
//   A2 a software context is released politely (WEBGL_lose_context once).
//   B1 normal renderer (NVIDIA GeForce RTX 4060) → hook absent.
//   B2 second normal renderer (Apple M1 Pro) → hook absent.
//   C1 getContext() → null (no WebGL at all) → hook set, and the
//      'experimental-webgl' fallback is attempted in that order.
//   C2 the no-WebGL verdict is cached too (exactly 2 getContext calls for
//      2 applies, never 4).
//   D1 ?we-glassfallback=off beats a SwiftShader detection → hook absent.
//   D2 ?we-glassfallback=on beats a normal renderer → hook set.
//   D3 ?we-glassfallback=1 / D4 =0 behave like on / off.
//   D5 an unknown value (?we-glassfallback=maybe) means auto → detection wins.
//   E1 the injected stylesheet really carries data-we-glass-fallback rules.
//   E2 REUSE proof: every near-opaque recipe the @supports fallbacks use also
//      appears in a data-we-glass-fallback rule (both texts, same string).
//   E3 those rules explicitly disable backdrop-filter (both prefixes) and the
//      content-surface plate reuses --we-content-surface-alpha / -color.
//   E4 the master switches are preserved (data-we-sidebar-glass /
//      data-we-glass-window still gate the fallback surfaces).
//   E5 GAP FIX (upstream #94): the composer card carries its blur on
//      [data-composer-card]::before, so the fallback block covers that carrier
//      too — a data-we-glass-fallback rule matching ::before with BOTH "none"
//      declarations AND a near-opaque recipe that the SIBLING fallback rules
//      also quote (same string, no new token / mechanism).
//   F1 disposing the plugin (fiber cleanup) removes the hook.
//   G1 the detection is cached: 3 applies → exactly 1 WebGL context created.
//   H1 no WEBGL_debug_renderer_info → gl.getParameter(gl.RENDERER) is read and
//      matched (llvmpipe → hook set).
//   H2 the same fallback path with a normal RENDERER → hook absent.
//   P1 the exact string the LOCAL supreium-headless-gl software rasteriser
//      reports (RENDERER "ANGLE" + VENDOR "stack-gl", no debug-renderer-info)
//      is detected — the reason the vendor string joins the match.
//   I1 a non-browser-ish sandbox WITHOUT `location` / URLSearchParams does not
//      throw and still detects (typeof guards hold).
//
// Usage: node scripts/verify-softrender.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
}

const CODE = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

// ── Sandbox harness ──────────────────────────────────────────────────────────
// Mirrors the loader style of verify-client.mjs / verify-resource-lifecycle.mjs:
// the built bundle is a window.__ModuleLoader__.load({ id, factory }) envelope,
// so we capture the handoff and call factory(require) ourselves.
function makeEl(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    children: [],
    attributes: Object.create(null),
    dataset: {},
    textContent: '',
    className: '',
    style: {
      _props: {},
      setProperty(k, v) { this._props[k] = v; },
      removeProperty(k) { delete this._props[k]; },
    },
    appendChild(child) { this.children.push(child); child._parent = this; return child; },
    remove() {
      if (this._parent) {
        const i = this._parent.children.indexOf(this);
        if (i >= 0) this._parent.children.splice(i, 1);
      }
    },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    removeAttribute(k) { delete this.attributes[k]; },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() { return { width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 }; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    isConnected: false,
  };
}

const React = {
  Fragment: 'Fragment',
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
  useLayoutEffect: () => {},
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useRef: (v) => ({ current: v }),
  createElement: (type, props, ...children) =>
    typeof type === 'function' ? type(props || {}) : ({ type, props: props || null, children }),
};

/**
 * Load lib/client.js into a fresh vm context and apply the plugin once per call
 * to the returned apply().
 * `renderer` is the WEBGL_debug_renderer_info UNMASKED_RENDERER_WEBGL string;
 * `publicRenderer` is what gl.getParameter(gl.RENDERER) reports (used when the
 * debug extension is missing, i.e. unmasked:false).
 */
function loadClient({
  search = '',
  renderer = 'NVIDIA GeForce RTX 4060',
  publicRenderer = 'NVIDIA GeForce RTX 4060',
  publicVendor = 'Google Inc. (Mock)',
  unmasked = true,
  webgl = true,
  loseContext = true,
  provideLocation = true,
  provideURLSearchParams = true,
} = {}) {
  const stats = { getContext: 0, kinds: [], loseContext: 0, contextCreations: 0 };

  const DBG = { UNMASKED_RENDERER_WEBGL: 0x9246, UNMASKED_VENDOR_WEBGL: 0x9245 };
  const glMock = {
    RENDERER: 0x1f01,
    VENDOR: 0x1f00,
    getExtension(name) {
      if (name === 'WEBGL_debug_renderer_info' && unmasked) return DBG;
      if (name === 'WEBGL_lose_context' && loseContext) {
        return { loseContext() { stats.loseContext++; } };
      }
      return null;
    },
    getParameter(p) {
      if (p === DBG.UNMASKED_RENDERER_WEBGL) return renderer;
      if (p === DBG.UNMASKED_VENDOR_WEBGL) return 'Google Inc. (Mock)';
      if (p === 0x1f01) return publicRenderer;
      if (p === 0x1f00) return publicVendor;
      return null;
    },
  };

  const bodyEl = makeEl('body');
  const headEl = makeEl('head');
  const makeCanvas = () => {
    const el = makeEl('canvas');
    el.getContext = (kind) => {
      stats.getContext++;
      stats.kinds.push(String(kind));
      if (!webgl) return null;
      if (kind !== 'webgl' && kind !== 'experimental-webgl') return null;
      stats.contextCreations++;
      return glMock;
    };
    return el;
  };

  const document = {
    createElement: (tag) => (String(tag).toLowerCase() === 'canvas' ? makeCanvas() : makeEl(tag)),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    head: headEl,
    body: bodyEl,
  };

  const localStorage = {
    _store: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._store, k) ? this._store[k] : null; },
    setItem(k, v) { this._store[k] = String(v); },
    removeItem(k) { delete this._store[k]; },
  };

  const cap = { handoff: null };
  const timers = [];
  const sandbox = {
    window: {
      __ModuleLoader__: { load: (h) => { cap.handoff = h; } },
      addEventListener: () => {},
      removeEventListener: () => {},
      matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
      setTimeout: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
      clearTimeout: (t) => { if (t) t.cleared = true; },
      innerWidth: 1280,
      innerHeight: 800,
      outerWidth: 1280,
      outerHeight: 800,
    },
    document,
    localStorage,
    // Never resolves: the boot chain (loadPersisted → loadInventory) must not
    // race the synchronous assertions below with a late applyEffects().
    fetch: () => new Promise(() => {}),
    React,
    navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 mock' },
  };
  if (provideLocation) {
    sandbox.location = { search, href: 'http://127.0.0.1:43120/' + search, pathname: '/' };
  }
  if (provideURLSearchParams) sandbox.URLSearchParams = URLSearchParams;

  vm.createContext(sandbox);
  new vm.Script(CODE, { filename: 'client.js' }).runInContext(sandbox);
  if (!cap.handoff || typeof cap.handoff.factory !== 'function') {
    throw new Error('lib/client.js did not register a module-loader factory');
  }
  const requireMock = (spec) => {
    if (spec === 'react') return React;
    if (spec === 'react-dom') return { createPortal: (node) => node }; // no createRoot → rope effect skipped
    throw new Error('unexpected require: ' + spec);
  };
  const exportsObj = cap.handoff.factory(requireMock);

  const disposers = [];
  const ctx = {
    slots: { inject: (key, cb) => cb(), register: () => {} },
    effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d); return d; },
  };

  return {
    stats,
    bodyEl,
    headEl,
    exportsObj,
    ctx,
    disposers,
    timers,
    apply() { exportsObj.apply(ctx); },
    hook() {
      return Object.prototype.hasOwnProperty.call(bodyEl.attributes, 'data-we-glass-fallback')
        ? bodyEl.attributes['data-we-glass-fallback']
        : null;
    },
    styleCss() {
      const tags = headEl.children.filter((c) => c && c.dataset && c.dataset.pluginCss);
      return tags.length ? String(tags[tags.length - 1].textContent || '') : '';
    },
  };
}

// ── CSS rule parser (leaf {selector, body, ancestors}) ───────────────────────
// Comments are stripped and string literals are skipped so braces inside
// `content: "}"` / url() values cannot desynchronise the scan. Ancestor headers
// let a rule know it lives inside an `@supports …` block.
function parseCssRules(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const stack = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (ch === '{') {
      stack.push({ header: text.slice(start, i).trim(), bodyStart: i + 1 });
      start = i + 1;
    } else if (ch === '}') {
      const frame = stack.pop();
      if (frame) {
        rules.push({
          header: frame.header,
          body: text.slice(frame.bodyStart, i),
          ancestors: stack.map((f) => f.header),
        });
      }
      start = i + 1;
    }
    i++;
  }
  return rules;
}

function main() {
  // ── S1: the required software-rasteriser patterns, matched case-insensitively
  {
    const m = /const SOFT_RENDER_RE = \/(.+?)\/([a-z]*);/.exec(CODE);
    const src = m ? m[1] : '';
    // Second element is the RAW source substring (the regex source escapes "(").
    const required = [
      ['SwiftShader', 'swiftshader'],
      ['Software', 'software'],
      ['llvmpipe', 'llvmpipe'],
      ['softpipe', 'softpipe'],
      ['Microsoft Basic Render', 'microsoft basic render'],
      ['ANGLE (Software', 'angle \\(software'],
    ];
    const missing = required.filter(([, needle]) => !src.toLowerCase().includes(needle));
    check('S1 SOFT_RENDER_RE carries every required pattern (' + required.map(([l]) => l).join(', ') + ') with /i',
      !!m && /i/.test(m[2] || '') && missing.length === 0,
      'regex=' + (m ? '/' + src + '/' + m[2] : '(not found)') + ' missing=' + (missing.map(([l]) => l).join(',') || 'none'));
  }

  // ── S2: manual override token + both renderer read paths
  {
    const hasParam = CODE.includes('we-glassfallback');
    const onOff = /\bflag === "on" \|\| flag === "1"/.test(CODE) && /\bflag === "off" \|\| flag === "0"/.test(CODE);
    const dbgExt = CODE.includes('WEBGL_debug_renderer_info') && CODE.includes('UNMASKED_RENDERER_WEBGL');
    const plainRenderer = /gl\.RENDERER !== undefined/.test(CODE) && /gl\.getParameter\(gl\.RENDERER\)/.test(CODE);
    const vendorRead = CODE.includes('UNMASKED_VENDOR_WEBGL') && /gl\.getParameter\(gl\.VENDOR\)/.test(CODE);
    check('S2 ?we-glassfallback override (on/1/off/0, else auto) + both renderer read paths exist',
      hasParam && onOff && dbgExt && plainRenderer && vendorRead,
      'param=' + hasParam + ' onOff=' + onOff + 'debugInfo=' + dbgExt + 'plainRENDERER=' + plainRenderer
        + ' vendor=' + vendorRead);
  }

  // ── A/G/E/F/I: one SwiftShader sandbox serves several checks ───────────────
  {
    const c = loadClient({
      renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
    });
    let thrown = null;
    try { c.apply(); } catch (e) { thrown = e && e.message; }
    check('A1 SwiftShader renderer → body[data-we-glass-fallback="1"] (hook engaged)',
      !thrown && c.hook() === '1',
      'apply threw: ' + (thrown || '(none)') + ' · hook=' + JSON.stringify(c.hook()));
    check('A2 the software context is released politely (WEBGL_lose_context once)',
      c.stats.loseContext === 1,
      'loseContext calls=' + c.stats.loseContext);

    // ── G1: 3 applies in the SAME module instance → the cached decision means
    //    exactly one WebGL context creation (not one per apply).
    let thrown2 = null;
    try { c.apply(); c.apply(); } catch (e) { thrown2 = e && e.message; }
    check('G1 detection is cached: 3 applies → exactly 1 WebGL getContext call',
      !thrown2 && c.stats.getContext === 1 && c.stats.contextCreations === 1,
      'getContext=' + c.stats.getContext + ' (' + c.stats.kinds.join(',') + ') contexts=' + c.stats.contextCreations
        + ' applies=3' + (thrown2 ? ' · apply threw: ' + thrown2 : ''));

    // ── E1..E4: the INJECTED stylesheet of the BUILT bundle ────────────────
    const css = c.styleCss();
    const rules = parseCssRules(css);
    const fbRules = rules.filter((r) => r.header.includes('data-we-glass-fallback'));
    const fbText = fbRules.map((r) => r.header + ' { ' + r.body + ' }').join('\n');
    const supportsRules = rules.filter((r) => r.ancestors.some((a) => /^@supports not/.test(a)));
    const supportsText = supportsRules.map((r) => r.header + ' { ' + r.body + ' }').join('\n');

    check('E1 the injected stylesheet contains data-we-glass-fallback rules',
      css.length > 0 && fbRules.length >= 5,
      'css chars=' + css.length + ' fallback rules=' + fbRules.length
        + ' · selectors start with: ' + fbRules[0].header.split(',')[0].trim());

    // The recipes below are quoted VERBATIM from the @supports fallbacks; each
    // one must also appear inside a data-we-glass-fallback rule.
    const recipes = [
      'color-mix(in srgb, var(--we-sidebar-color, #ffffff) 92%, transparent)',
      'color-mix(in srgb, var(--we-glass-color, #ffffff) 92%, transparent)',
      'color-mix(in srgb, var(--we-glass-color, #ffffff) 94%, transparent)',
      '--dsw-alias-bg-layer-1: var(--we-glass-color, #ffffff)',
      '--dsw-alias-bg-layer-1: var(--we-glass-color, #0d1524)',
    ];
    const shared = recipes.filter((r) => supportsText.includes(r) && fbText.includes(r));
    check('E2 reuse proven: every @supports fallback recipe also appears in a data-we-glass-fallback rule',
      shared.length === recipes.length && supportsRules.length >= 4,
      shared.length + '/' + recipes.length + ' shared'
        + ' · @supports fallback rules=' + supportsRules.length
        + (shared.length === recipes.length ? '' : ' · missing in fallback: '
          + JSON.stringify(recipes.filter((r) => !shared.includes(r)))));

    const contentToken = 'var(--we-content-surface-alpha, 88%)';
    const contentColor = 'var(--we-content-surface-color, var(--dsw-alias-bg-layer-1, #1e1f26))';
    const fbContentRules = fbRules.filter((r) => r.header.includes('.cm-editor') || r.header.includes('.xterm'));
    const contentReuse = fbContentRules.length > 0
      && fbContentRules.every((r) => r.body.includes(contentToken) && r.body.includes(contentColor));
    const noneRules = fbRules.filter((r) => /(^|[^-])backdrop-filter:\s*none/.test(r.body)
      && /-webkit-backdrop-filter:\s*none/.test(r.body));
    check('E3 fallback rules disable backdrop-filter (both prefixes) and reuse the content-surface tokens',
      noneRules.length >= 4 && contentReuse,
      'rules with both "none" declarations=' + noneRules.length
        + '/' + fbRules.length + ' · content rules=' + fbContentRules.length
        + ' reuse(--we-content-surface-*)= ' + contentReuse);

    const sidebarGated = fbRules.filter((r) => r.header.includes('_panel')).every((r) => r.header.includes('[data-we-sidebar-glass]'));
    const dialogGated = fbRules.filter((r) => r.header.includes('settings.section')).every((r) => r.header.includes('[data-we-glass-window]'));
    check('E4 master switches preserved: sidebar fallback stays gated on data-we-sidebar-glass, dialog on data-we-glass-window',
      sidebarGated && dialogGated,
      'sidebarGated=' + sidebarGated + ' dialogGated=' + dialogGated);

    // ── E5 (gap fix): upstream #94 moved the composer card's blur onto
    // [data-composer-card]::before, so the fallback block must cover that
    // carrier as well — otherwise the exact element issue #95 reports as 过透
    // still has no fallback. Reuses the `recipes` list declared for E2 (no
    // duplicated recipe table) and proves the plate quotes a string a SIBLING
    // fallback rule already carries.
    const composerBefore = fbRules.filter((r) => /\[data-composer-card\]::before/.test(r.header));
    const composerNone = composerBefore.filter((r) => /(^|[^-])backdrop-filter:\s*none/.test(r.body)
      && /-webkit-backdrop-filter:\s*none/.test(r.body));
    const composerRecipe = recipes.find((rec) => composerNone.some((r) => r.body.includes(rec)));
    // The recipe has to be the VALUE of a background declaration on that rule
    // (not merely present), i.e. the ::before really is the near-opaque plate.
    const composerPlate = composerRecipe !== undefined && composerNone.some((r) => {
      const at = r.body.indexOf(composerRecipe);
      return at >= 0 && /background(-color)?\s*:/.test(r.body.slice(0, at));
    });
    // …and that exact string must already be carried by a SIBLING fallback rule.
    const composerRecipeShared = composerPlate
      && fbRules.some((r) => !composerBefore.includes(r) && r.body.includes(composerRecipe));
    check('E5 composer-card ::before carrier is covered: fallback rule with both "none" declarations + a recipe shared with the sibling fallback rules',
      composerBefore.length >= 1 && composerNone.length >= 1 && composerRecipeShared,
      '::before fallback rules=' + composerBefore.length + ' · with both "none"=' + composerNone.length
        + ' · recipe=' + JSON.stringify(composerRecipe || null)
        + ' · reused by a sibling fallback rule=' + composerRecipeShared);

    // ── F1: fiber disposal removes the hook ────────────────────────────────
    let disposeErr = null;
    try {
      c.disposers[0]();
      c.disposers[0](); // idempotent
    } catch (e) { disposeErr = e && e.message; }
    check('F1 disposing the plugin (fiber cleanup) removes body[data-we-glass-fallback]',
      !disposeErr && c.hook() === null,
      'dispose threw: ' + (disposeErr || '(none)') + ' · hook after dispose=' + JSON.stringify(c.hook()));
  }

  // ── B1/B2: normal renderers must NOT engage the fallback ──────────────────
  for (const [label, renderer] of [
    ['B1', 'NVIDIA GeForce RTX 4060'],
    ['B2', 'Apple M1 Pro'],
  ]) {
    const c = loadClient({ renderer });
    let thrown = null;
    try { c.apply(); } catch (e) { thrown = e && e.message; }
    check(label + ' normal renderer (' + renderer + ') → hook absent',
      !thrown && c.hook() === null,
      'apply threw: ' + (thrown || '(none)') + ' · hook=' + JSON.stringify(c.hook()));
  }

  // ── C1/C2: no WebGL at all → software/unsupported, cached ─────────────────
  {
    const c = loadClient({ webgl: false });
    let thrown = null;
    try { c.apply(); } catch (e) { thrown = e && e.message; }
    const kindsOk = c.stats.kinds.length === 2
      && c.stats.kinds[0] === 'webgl' && c.stats.kinds[1] === 'experimental-webgl';
    check('C1 getContext() → null (no WebGL) → hook set, trying webgl then experimental-webgl',
      !thrown && c.hook() === '1' && kindsOk,
      'apply threw: ' + (thrown || '(none)') + ' · hook=' + JSON.stringify(c.hook())
        + ' · kinds=' + JSON.stringify(c.stats.kinds));
    let thrown2 = null;
    try { c.apply(); } catch (e) { thrown2 = e && e.message; }
    check('C2 the no-WebGL verdict is cached too (2 applies → 2 getContext calls, not 4)',
      !thrown2 && c.stats.getContext === 2,
      'getContext=' + c.stats.getContext + ' (' + c.stats.kinds.join(',') + ')'
        + (thrown2 ? ' · apply threw: ' + thrown2 : ''));
  }

  // ── D1..D5: the manual override ───────────────────────────────────────────
  const SOFT = 'ANGLE (Software Adapter, SwiftShader Device)';
  const HARD = 'NVIDIA GeForce RTX 4060';
  const overrideCases = [
    ['D1', '?we-glassfallback=off', SOFT, null, 'off beats SwiftShader detection'],
    ['D2', '?we-glassfallback=on', HARD, '1', 'on beats a normal renderer'],
    ['D3', '?we-glassfallback=1', HARD, '1', '1 behaves like on'],
    ['D4', '?we-glassfallback=0', SOFT, null, '0 behaves like off'],
    ['D5', '?we-glassfallback=maybe', SOFT, '1', 'unknown value = auto (detection wins)'],
  ];
  for (const [label, search, renderer, expected, why] of overrideCases) {
    const c = loadClient({ search, renderer });
    let thrown = null;
    try { c.apply(); } catch (e) { thrown = e && e.message; }
    check(label + ' ' + search + ' (' + renderer + ') → hook ' + JSON.stringify(expected) + ' — ' + why,
      !thrown && c.hook() === expected,
      'apply threw: ' + (thrown || '(none)') + ' · hook=' + JSON.stringify(c.hook()));
  }

  // ── H1/H2: no debug-renderer-info extension → public RENDERER is used ─────
  {
    const c = loadClient({ unmasked: false, publicRenderer: 'llvmpipe (LLVM 15.0.7, 256 bits)' });
    let thrown = null;
    try { c.apply(); } catch (e) { thrown = e && e.message; }
    check('H1 no WEBGL_debug_renderer_info → gl.getParameter(gl.RENDERER)="llvmpipe …" → hook set',
      !thrown && c.hook() === '1',
      'apply threw: ' + (thrown || '(none)') + ' · hook=' + JSON.stringify(c.hook()));
  }
  {
    const c = loadClient({ unmasked: false, publicRenderer: 'NVIDIA GeForce RTX 4060' });
    let thrown = null;
    try { c.apply(); } catch (e) { thrown = e && e.message; }
    check('H2 same RENDERER fallback path with a hardware string → hook absent',
      !thrown && c.hook() === null,
      'apply threw: ' + (thrown || '(none)') + ' · hook=' + JSON.stringify(c.hook()));
  }

  // ── P1: the measured LOCAL software rasteriser string (headless-gl) ───────
  // Measured on this machine: supreium-headless-gl reports RENDERER "ANGLE",
  // VENDOR "stack-gl", VERSION "WebGL 1.0 stack-gl 8.3.0" and does NOT expose
  // WEBGL_debug_renderer_info. The renderer alone carries no software wording,
  // so this scenario is what justifies matching the vendor string too.
  {
    const c = loadClient({ unmasked: false, publicRenderer: 'ANGLE', publicVendor: 'stack-gl' });
    let thrown = null;
    try { c.apply(); } catch (e) { thrown = e && e.message; }
    check('P1 measured local headless-GL string (RENDERER="ANGLE", VENDOR="stack-gl") → hook set',
      !thrown && c.hook() === '1',
      'apply threw: ' + (thrown || '(none)') + ' · hook=' + JSON.stringify(c.hook()));
  }

  // ── I1: non-browser-ish environment (no location / no URLSearchParams) ────
  {
    const c = loadClient({
      provideLocation: false,
      provideURLSearchParams: false,
      renderer: 'Google SwiftShader',
    });
    let thrown = null;
    try { c.apply(); } catch (e) { thrown = e && e.message; }
    check('I1 sandbox WITHOUT location / URLSearchParams: no throw, detection still runs (typeof guards hold)',
      !thrown && c.hook() === '1',
      'apply threw: ' + (thrown || '(none)') + ' · hook=' + JSON.stringify(c.hook()));
  }

  // ── Local data point, deliberately NOT an assertion ───────────────────────
  // supreium-headless-gl (a dependency of this repo) IS a software rasteriser,
  // so its renderer string is the closest thing to the reporter's environment
  // that this machine can produce. It is NOT a browser: it never runs Chromium's
  // compositor, so it proves nothing about whether a desktop shell ignores
  // backdrop-filter. It is recorded because it shows what a software GL stack
  // can hide behind: a bare "ANGLE" with no software wording at all when
  // WEBGL_debug_renderer_info is absent (the one tell left is VENDOR "stack-gl",
  // which is why that pattern is in SOFT_RENDER_RE). No PASS/FAIL: a native
  // module that is unavailable elsewhere must not fail this suite.
  {
    let line = 'unavailable';
    try {
      // createGL(width, height, options) reads options.isWebGL2 unguarded, so an
      // options object is required. Ask for WebGL 1 — the same context kind
      // detectSoftwareRender() requests in the browser.
      const gl = createRequire(import.meta.url)('supreium-headless-gl')(1, 1, { isWebGL2: false, preserveDrawingBuffer: true });
      if (!gl) {
        line = 'no context';
      } else {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        const pub = String(gl.getParameter(gl.RENDERER));
        const re = /swiftshader|software|llvmpipe|softpipe|microsoft basic render|angle \(software|stack-gl/i;
        line = 'RENDERER=' + JSON.stringify(pub)
          + ' VENDOR=' + JSON.stringify(String(gl.getParameter(gl.VENDOR)))
          + ' VERSION=' + JSON.stringify(String(gl.getParameter(gl.VERSION)))
          + ' WEBGL_debug_renderer_info=' + !!dbg
          + ' unmasked=' + (dbg ? JSON.stringify(String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL))) : 'n/a')
          + ' matchedByRegex(RENDERER+VENDOR)=' + re.test(pub + ' ' + String(gl.getParameter(gl.VENDOR)));
        const destroy = gl.getExtension('STACKGL_destroy_context');
        if (destroy) destroy.destroy(); // release the context before exit
      }
    } catch (e) {
      line = 'unavailable (' + (e && e.message) + ')';
    }
    console.log('DATA (not an assertion) | local supreium-headless-gl software rasteriser reports: ' + line
      + ' — it is NOT a browser (no Chromium compositor), so it only shows how a software GL stack can read');
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (failed.length === 0
    ? 'ALL SOFT-RENDER FALLBACK CHECKS PASSED'
    : failed.length + ' CHECK(S) FAILED'));
  process.exit(failed.length === 0 ? 0 : 1);
}

try {
  main();
} catch (err) {
  console.error('TEST ERROR:', err && err.stack ? err.stack : err);
  process.exit(1);
}
