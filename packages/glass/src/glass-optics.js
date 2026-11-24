/**
 * Optional rounded refraction, rim highlights and pointer light for existing glass.
 * Owns decoration leaves only; never changes content, fonts or containing blocks.
 * Single-line inline code uses a separate background leaf; wrapped code stays native
 * (the #197 rectangular-backdrop regression must not return).
 * Visible surfaces share cached displacement maps. Pointer-only frames use CSSOM
 * and cached geometry so the native surface observer sees no style mutations.
 */
function installGlassOptics() {
  const win = window, doc = document;
  if (!doc.body || !win.CSS || !win.CSS.supports('backdrop-filter', 'url("#we-optics-probe")')) {
    reportGlassOptics('local-lens-v2-unsupported', 'Original glass retained');
    return;
  }
  const ns = 'http://www.w3.org/2000/svg';
  const selector = [
    'body[data-we-glass-page][data-we-left-sidebar] [data-we-surface-plate="left-sidebar"]',
    'body[data-we-glass-chat][data-we-glass-page] [data-composer-card]',
    // Match the same bubble carrier as glass-css; the question reply's _bubbleWidth is square.
    'body[data-we-glass-chat][data-we-glass-page]:not([data-we-thinking-native]) [data-chat-flow] [class*="_bubble_"]:not([role="tooltip"])',
    'body[data-we-glass-page]:not([data-we-thinking-native]) [data-chat-flow] .md-code-block',
    'body[data-we-glass-page]:not([data-we-thinking-native]) [data-chat-flow] :not(pre) > code',
    'body[data-we-glass-page] [data-slot="conversation.view"] button[class*="_toBottom"]',
    'body[data-we-glass-window] [data-we-surface-runtime="settings-window"]',
    'body[data-we-glass-page] [data-we-surface-runtime="declared"],body[data-we-glass-page] [data-we-surface-runtime="extra"]',
    'body[data-we-glass-page] .we-picker',
    'body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_panel"]',
    'body[data-we-glass-page][data-we-sidebar-glass] [data-we-surface-plate="right-sidebar"]',
    'body[data-we-glass-page] [data-plugin-versions] > div:has(> button[aria-expanded],> [role="status"])'
  ].join(',');
  const seats = new Map(), visible = new Set(), dirty = new Set(), cache = new Map(), cleanup = [];
  const scrollTargets = new Set();
  const freeRules = [];
  const leafProperties = ['--we-optics-left', '--we-optics-top', '--we-optics-width', '--we-optics-height'];
  const generation = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  let closed = false, scheduled = 0, serial = 0, assetSerial = 0, point = null, pointerReported = false;
  let rectsDirty = true, lightsDirty = false, cachePixels = 0;
  const status = { generation, surfaces: 0, maps: 0, updates: 0, pointer: false, errors: 0,
    pixels: 0, buildMs: 0, cacheHits: 0, layoutReads: 0, lightWrites: 0, scans: 0 };
  let svg, defs, style, resize, intersection, mutation, compactRoot;
  const variableNames = ['--we-optics-filter', '--we-optics-native', '--we-optics-bg', '--we-optics-shadow', '--we-optics-x', '--we-optics-y'];
  function report(event, detail) { try { reportGlassOptics('local-lens-v2-' + event, detail); } catch {} }
  function trimCache() {
    // Keep small maps warm for reverse scrolling within the existing pixel budget.
    if (cache.size <= 48 && cachePixels <= 1200000) return;
    for (const asset of [...cache.values()].sort((a, b) => a.used - b.used)) {
      if (cache.size <= 48 && cachePixels <= 1200000) break;
      if (asset.refs) continue;
      asset.filter.remove(); cache.delete(asset.key); cachePixels -= asset.pixels;
    }
  }
  function releaseAsset(seat) {
    if (seat.asset) {
      seat.asset.refs--; seat.asset.used = win.performance.now(); seat.asset = null;
      trimCache();
    }
    seat.key = null;
  }
  function deactivate(el, seat) {
    el.removeAttribute('data-we-optics');
    el.removeAttribute('data-we-optics-seat');
    seat.leaf?.remove(); seat.leaf = null; seat.leafGeometry = null; seat.clipParents = null; seat.clip = null;
    if (seat.rule) { seat.rule.style.cssText = ''; seat.rule.selectorText = ':not(*)'; freeRules.push(seat.rule); seat.rule = null; seat.vars = null; }
    releaseAsset(seat); seat.sampled = false; seat.lightX = null; seat.lightY = null; seat.rect = null;
  }
  function detach(el) {
    const seat = seats.get(el);
    if (!seat) return;
    deactivate(el, seat);
    resize?.unobserve(el); intersection?.unobserve(el);
    seats.delete(el); visible.delete(el); dirty.delete(el);
  }
  function dispose() {
    if (closed) return;
    closed = true;
    win.cancelAnimationFrame(scheduled);
    for (const release of cleanup.reverse()) { try { release(); } catch {} }
    for (const el of [...seats.keys()]) { try { detach(el); } catch {} }
    style?.remove(); svg?.remove(); compactRoot?.remove();
    if (win.__weGlassOptics === status) delete win.__weGlassOptics;
  }
  function fail(error) {
    status.errors++;
    report('error', String(error?.stack || error).slice(0, 290));
    dispose();
  }
  function guard(fn) { return (...args) => { if (!closed) { try { return fn(...args); } catch (error) { fail(error); } } }; }
  function node(name, attrs) {
    const el = doc.createElementNS(ns, name);
    for (const [key, value] of Object.entries(attrs || {})) el.setAttribute(key, String(value));
    return el;
  }
  function sample(el, seat) {
    if (!seat.rule) {
      seat.rule = freeRules.pop();
      if (!seat.rule) {
        const index = style.sheet.insertRule(':not(*){}', style.sheet.cssRules.length);
        seat.rule = style.sheet.cssRules[index];
      }
      seat.rule.selectorText = `[data-we-optics-seat="${generation}-${seat.id}"]`;
      seat.vars = seat.rule.style;
      el.setAttribute('data-we-optics-seat', `${generation}-${seat.id}`);
    }
    el.removeAttribute('data-we-optics');
    const css = win.getComputedStyle(el);
    const layer = ['pseudo', 'local'].includes(seat.mode) ? win.getComputedStyle(el, '::before') : css;
    let native = layer.backdropFilter || layer.webkitBackdropFilter;
    // Wide frost wipes out the entire refracting band of a 20–30px code capsule.
    if (seat.mode === 'compact') native = native && native !== 'none' ? native.replace(/blur\([^)]*\)/g, 'blur(0.35px)') : 'blur(0.35px)';
    const decoration = seat.mode === 'local' ? layer : css;
    if (seat.mode === 'compact' && !seat.leaf) {
      if (!compactRoot) {
        compactRoot = doc.createElement('div'); compactRoot.setAttribute('data-we-optics-root', '');
        compactRoot.setAttribute('aria-hidden', 'true'); compactRoot.setAttribute('inert', ''); doc.body.append(compactRoot);
      }
      seat.leaf = doc.createElement('span');
      seat.leaf.setAttribute('data-we-optics', 'compact-leaf');
      seat.leaf.setAttribute('data-we-optics-seat', `${generation}-${seat.id}`);
      compactRoot.append(seat.leaf);
      seat.vars.setProperty('--we-optics-radius', css.borderRadius);
      seat.clipParents = [];
      for (let parent = el.parentElement; parent && parent !== doc.body; parent = parent.parentElement) {
        const parentCss = win.getComputedStyle(parent);
        if (/(auto|scroll|hidden|clip)/.test(parentCss.overflow + parentCss.overflowX + parentCss.overflowY)) seat.clipParents.push(parent);
      }
    }
    seat.vars.setProperty('--we-optics-native', native && native !== 'none' ? native : 'blur(1px)');
    seat.vars.setProperty('--we-optics-bg', decoration.backgroundImage || 'none');
    seat.vars.setProperty('--we-optics-shadow', decoration.boxShadow === 'none' ? '0 0 0 transparent' : decoration.boxShadow);
    seat.radii = [css.borderTopLeftRadius, css.borderTopRightRadius, css.borderBottomRightRadius, css.borderBottomLeftRadius];
    el.setAttribute('data-we-optics', seat.mode);
    seat.sampled = true;
  }
  function update(el, seat, w, h, fragments) {
    if (!w || !h) return;
    if (el.tagName === 'CODE') {
      const mode = fragments > 1 ? 'fragmented' : h <= 48 ? 'compact' : 'direct';
      if (seat.mode !== mode) { deactivate(el, seat); seat.mode = mode; }
    }
    if (!seat.sampled) sample(el, seat);
    seat.w = w; seat.h = h;
    // A wrapping inline box must not sample one large rectangle over adjacent prose.
    if (seat.mode === 'fragmented') return;
    const compact = seat.mode === 'compact';
    const radii = seat.radii.map(value => Math.max(0, Math.min(parseFloat(value) || 0, w / 2, h / 2)));
    const key = [w, h, ...radii, compact ? 'capsule' : 'panel'].join(':');
    if (seat.key === key) return;
    releaseAsset(seat);
    const reused = cache.get(key);
    if (reused) {
      reused.refs++; seat.asset = reused; seat.key = key; status.cacheHits++;
      seat.vars.setProperty('--we-optics-filter', `url("#${reused.id}")`);
      return;
    }
    const started = win.performance.now();
    const pad = compact ? 18 : h < 64 ? 12 : 24, scale = compact ? 84 : 38;
    const density = Math.min(compact ? .85 : 1, 560 / (w + pad * 2), 560 / (h + pad * 2));
    const mw = Math.ceil((w + pad * 2) * density), mh = Math.ceil((h + pad * 2) * density);
    const canvas = doc.createElement('canvas'); canvas.width = mw; canvas.height = mh;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Lens displacement canvas unavailable');
    const pixels = ctx.createImageData(mw, mh), data = pixels.data;
    const bevel = compact ? Math.min(16, h * .46) : Math.min(18, h * .22), eta = 1 / 1.45;
    // Reuse the same refraction response across every pixel, rather than pow/sqrt per pixel.
    const response = new Float32Array(1025);
    for (let i = 0; i <= 1024; i++) {
      const slope = Math.pow(i / 1024, 1.65) * .94, nz = Math.sqrt(1 - slope * slope);
      const rz = Math.sqrt(1 - eta * eta * (1 - nz * nz));
      response[i] = (eta * nz - rz) * slope / Math.max(rz, .05) * (compact ? 40 : 29);
    }
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
      const px = (x + .5) / density - pad - w / 2, py = (y + .5) / density - pad - h / 2;
      const radius = radii[py < 0 ? (px < 0 ? 0 : 1) : (px < 0 ? 3 : 2)];
      const qx = Math.abs(px) - (w / 2 - radius), qy = Math.abs(py) - (h / 2 - radius);
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0), len = Math.sqrt(ox * ox + oy * oy);
      const distance = len + Math.min(Math.max(qx, qy), 0) - radius;
      let nx = 0, ny = 0;
      if (len > 0) { nx = ox / len * Math.sign(px); ny = oy / len * Math.sign(py); }
      else if (qx > qy) nx = Math.sign(px); else ny = Math.sign(py);
      const edge = Math.max(0, Math.min(1, 1 + distance / bevel));
      const bend = response[Math.round(edge * 1024)];
      const fade = distance > 0 ? Math.max(0, 1 - distance / 12) : 1;
      const offset = (y * mw + x) * 4;
      const zoomX = compact ? Math.max(-8, Math.min(8, -px * .08)) : 0;
      const zoomY = compact ? -py * .18 : 0;
      data[offset] = Math.round(255 * (.5 + (nx * bend * fade + zoomX) / scale));
      data[offset + 1] = Math.round(255 * (.5 + (ny * bend * fade + zoomY) / scale));
      data[offset + 2] = 128; data[offset + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    const id = 'we-optics-' + generation + '-' + assetSerial++;
    const filter = node('filter', { id, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' });
    for (const [name, value] of Object.entries({ x: -pad, y: -pad, width: w + 2 * pad, height: h + 2 * pad })) filter.setAttribute(name, value);
    filter.append(
      node('feImage', { href: canvas.toDataURL(), x: -pad, y: -pad, width: w + pad * 2, height: h + pad * 2, preserveAspectRatio: 'none', result: 'lensMap' }),
      node('feDisplacementMap', { in: 'SourceGraphic', in2: 'lensMap', scale, xChannelSelector: 'R', yChannelSelector: 'G' })
    );
    defs.append(filter);
    const asset = { id, key, filter, refs: 1, pixels: mw * mh, used: win.performance.now() };
    cache.set(key, asset); cachePixels += asset.pixels; seat.asset = asset;
    trimCache();
    // Publish only after the complete filter exists, so a failed map keeps native glass.
    seat.vars.setProperty('--we-optics-filter', `url("#${id}")`);
    seat.key = key; status.updates++;
    status.pixels += mw * mh; status.buildMs += win.performance.now() - started;
  }
  function frame() {
    scheduled = 0;
    if (doc.hidden) return;
    const measured = [];
    // Read all pending geometry before writing filters or light coordinates.
    let pixelsThisFrame = 0;
    for (const el of dirty) {
      if (!visible.has(el) || !el.isConnected) continue;
      if (measured.length >= 12 || pixelsThisFrame >= 180000) break;
      status.layoutReads += 2;
      const w = el.offsetWidth, h = el.offsetHeight;
      let fragments = 0;
      if (w && h && el.tagName === 'CODE') {
        fragments = el.getClientRects().length; status.layoutReads++;
      }
      measured.push([el, seats.get(el), w, h, fragments]);
      pixelsThisFrame += Math.min(w, 560) * Math.min(h, 560);
    }
    const clips = new Map();
    const scrollers = [...scrollTargets];
    for (const el of visible) {
      const seat = seats.get(el);
      if (!seat || !el.isConnected) continue;
      const moved = rectsDirty || !seat.rect || scrollers.some(target => target.contains(el));
      if (moved) { seat.rect = el.getBoundingClientRect(); status.layoutReads++; }
      if (seat.clipParents && (moved || !seat.clip)) {
        const clip = { left: 0, top: 0, right: win.innerWidth, bottom: win.innerHeight };
        for (const parent of seat.clipParents) {
          if (!clips.has(parent)) { clips.set(parent, parent.getBoundingClientRect()); status.layoutReads++; }
          const rect = clips.get(parent);
          clip.left = Math.max(clip.left, rect.left); clip.top = Math.max(clip.top, rect.top);
          clip.right = Math.min(clip.right, rect.right); clip.bottom = Math.min(clip.bottom, rect.bottom);
        }
        seat.clip = clip;
      }
    }
    rectsDirty = false;
    scrollTargets.clear();
    // Spread first appearances/streaming growth across frames; never build a whole page at once.
    let newGeometry = false;
    for (const [el, seat, w, h, fragments] of measured) {
      update(el, seat, w, h, fragments); dirty.delete(el);
      if (!seat.rect || (seat.leaf && !seat.clip)) newGeometry = true;
    }
    const writes = [];
    for (const el of visible) {
      const seat = seats.get(el);
      if (!seat || !el.isConnected) continue;
      if (seat.leaf && seat.rect && seat.clip && seat.leafGeometry?.rect !== seat.rect) {
        const { rect, clip, leafGeometry: previous } = seat;
        const geometry = [rect.left, rect.top, rect.width, rect.height].map(n => n.toFixed(2));
        const inset = [Math.max(0,clip.top-rect.top), Math.max(0,rect.right-clip.right), Math.max(0,rect.bottom-clip.bottom), Math.max(0,clip.left-rect.left)].map(n => n.toFixed(2)+'px').join(' ');
        geometry.forEach((value, index) => {
          if (value !== previous?.geometry[index]) seat.vars.setProperty(leafProperties[index], value+'px');
        });
        if (inset !== previous?.inset) seat.vars.setProperty('--we-optics-clip', `inset(${inset})`);
        seat.leafGeometry = { rect, geometry, inset };
      }
      if (point && (lightsDirty || measured.length) && seat.sampled && seat.rect) {
        const rect = seat.rect;
        if (!rect.width || !rect.height) continue;
        const x = (point[0] - rect.left) * seat.w / rect.width, y = (point[1] - rect.top) * seat.h / rect.height;
        const near = x > -230 && x < seat.w + 230 && y > -120 && y < seat.h + 120;
        const lightX = near ? `${x.toFixed(1)}px` : '-1000px';
        const lightY = near ? `${y.toFixed(1)}px` : '-1000px';
        if (near || seat.lightX) writes.push([seat, lightX, lightY]);
      }
    }
    for (const [seat, x, y] of writes) {
      if (x !== seat.lightX) { seat.vars.setProperty('--we-optics-x', x); seat.lightX = x; status.lightWrites++; }
      if (y !== seat.lightY) { seat.vars.setProperty('--we-optics-y', y); seat.lightY = y; status.lightWrites++; }
    }
    lightsDirty = newGeometry;
    status.surfaces = seats.size; status.maps = visible.size ? [...visible].filter(el => seats.get(el)?.key).length : 0;
    if (newGeometry || [...dirty].some(el => visible.has(el))) schedule();
  }
  function schedule() {
    if (!scheduled && !closed && !doc.hidden) scheduled = win.requestAnimationFrame(guard(frame));
  }
  function discover(resample, roots = [doc.body]) {
    status.scans++;
    for (const el of [...seats.keys()]) if (!el.isConnected || !el.matches(selector)) detach(el);
    const candidates = new Set();
    for (const root of resample ? [doc.body] : roots) {
      if (!root.isConnected) continue;
      if (root.matches(selector)) candidates.add(root);
      root.querySelectorAll(selector).forEach(el => candidates.add(el));
    }
    for (const el of candidates) {
      if (el.closest('[data-we-surface-preserve]') || el.parentElement?.closest(selector)) continue;
      if (!seats.has(el)) {
        const seat = { id: serial++, mode: el.hasAttribute('data-we-surface-runtime') ? 'local' : el.matches('[data-composer-card]') ? 'pseudo' : 'direct', saved: new Map() };
        variableNames.forEach(name => seat.saved.set(name, { value: el.style.getPropertyValue(name), priority: el.style.getPropertyPriority(name) }));
        seats.set(el, seat); dirty.add(el);
        resize.observe(el); intersection.observe(el);
      } else if (resample) { const seat = seats.get(el); if (seat.sampled) sample(el, seat); dirty.add(el); }
    }
    rectsDirty = true; lightsDirty = true;
    schedule();
  }
  try {
    svg = node('svg', { width: 0, height: 0, 'aria-hidden': 'true' });
    svg.style.cssText = 'position:absolute;pointer-events:none';
    defs = node('defs'); svg.append(defs); doc.body.append(svg);
    style = doc.createElement('style'); style.dataset.weOptics = generation;
    // Outrank the upstream !important background shorthand without changing its fill.
    const surfaceSelector = 'body[data-we-glass-page] [data-we-optics][data-we-optics][data-we-optics][data-we-optics]';
    style.textContent = `
      ${surfaceSelector}:not([data-we-optics="local"]):not([data-we-optics="compact-leaf"]),${surfaceSelector}[data-we-optics="local"]::before {
        background-image:radial-gradient(ellipse 280px 150px at var(--we-optics-x,-1000px) var(--we-optics-y,-1000px),rgba(235,253,255,.16),transparent 78%),var(--we-optics-bg,none)!important;
        box-shadow:inset 0 1px .7px rgba(248,255,255,.66),inset 1px 0 .7px rgba(224,248,255,.25),inset 0 -1px .8px rgba(166,213,240,.24),var(--we-optics-shadow,0 0 0 transparent)!important;
      }
      ${surfaceSelector}:is([data-we-optics="direct"],[data-we-optics="compact-leaf"]),${surfaceSelector}:is([data-we-optics="pseudo"],[data-we-optics="local"])::before {
        -webkit-backdrop-filter:var(--we-optics-filter,) var(--we-optics-native,blur(1px))!important;
        backdrop-filter:var(--we-optics-filter,) var(--we-optics-native,blur(1px))!important;
      }
      ${surfaceSelector}[data-we-optics="compact"] {
        -webkit-backdrop-filter:none!important;backdrop-filter:none!important;
        background-image:radial-gradient(ellipse 180px 65px at var(--we-optics-x,-1000px) var(--we-optics-y,-1000px),rgba(235,253,255,.23),transparent 78%),linear-gradient(180deg,rgba(255,255,255,.14),transparent 36%,rgba(44,100,145,.07) 76%,rgba(255,255,255,.11)),var(--we-optics-bg,none)!important;
        box-shadow:inset 0 1px .7px rgba(255,255,255,.82),inset 0 -1px 1px rgba(22,58,91,.25),inset 1px 0 1px rgba(235,253,255,.35),var(--we-optics-shadow,0 0 0 transparent)!important;
      }
      [data-we-optics-root] {position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden}
      ${surfaceSelector}[data-we-optics="compact-leaf"] {
        position:absolute;left:var(--we-optics-left);top:var(--we-optics-top);width:var(--we-optics-width);height:var(--we-optics-height);
        border-radius:var(--we-optics-radius);clip-path:var(--we-optics-clip,inset(0));pointer-events:none;
      }
    `;
    doc.head.append(style);
    resize = new win.ResizeObserver(guard(entries => {
      entries.forEach(entry => dirty.add(entry.target)); rectsDirty = true; lightsDirty = true; schedule();
    })); cleanup.push(() => resize.disconnect());
    intersection = new win.IntersectionObserver(guard(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) { visible.add(entry.target); dirty.add(entry.target); }
        else { visible.delete(entry.target); const seat = seats.get(entry.target); if (seat?.sampled) deactivate(entry.target, seat); }
      }
      lightsDirty = true;
      schedule();
      // Prepare the filter before the element crosses a nested scroller's clip.
    }), { scrollMargin: '128px 0px' }); cleanup.push(() => intersection.disconnect());
    let mutationTimer = 0, pendingResample = false;
    const pendingRoots = new Set();
    mutation = new win.MutationObserver(guard(records => {
      let relevant = false;
      for (const record of records) {
        if (record.target === svg || svg.contains(record.target) || record.target === style || compactRoot?.contains(record.target)) continue;
        if (record.type === 'attributes') { relevant = true; if (record.target === doc.body) pendingResample = true; else pendingRoots.add(record.target); }
        else for (const el of [...record.addedNodes, ...record.removedNodes]) {
          if (el.nodeType !== 1 || el === svg || el === style || el === compactRoot || svg.contains(el)) continue;
          relevant = true; if (el.isConnected) pendingRoots.add(el);
        }
      }
      if (!relevant || mutationTimer) return;
      mutationTimer = win.setTimeout(guard(() => {
        mutationTimer = 0; discover(pendingResample, [...pendingRoots]); pendingRoots.clear(); pendingResample = false;
      }), 100);
    }));
    mutation.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-we-glass-page', 'data-we-glass-chat', 'data-we-left-sidebar', 'data-we-glass-window', 'data-we-sidebar-glass', 'data-sidebar-right-open', 'data-ds-dark-theme', 'data-we-left-sidebar-radius', 'data-we-right-sidebar-radius', 'data-we-thinking-native', 'data-we-surface-runtime', 'data-we-surface-preserve'] });
    cleanup.push(() => { mutation.disconnect(); win.clearTimeout(mutationTimer); });
    const move = guard(event => {
      if (event.pointerType === 'touch' || win.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      point = [event.clientX, event.clientY]; status.pointer = true; lightsDirty = true; schedule();
      if (!pointerReported) { pointerReported = true; report('pointer', 'Global tracking active, including outside glass'); }
    });
    doc.addEventListener('pointermove', move, { passive: true }); cleanup.push(() => doc.removeEventListener('pointermove', move));
    const scrolled = guard(event => {
      if (event.target instanceof win.Element) scrollTargets.add(event.target);
      else rectsDirty = true;
      lightsDirty = true;
      schedule();
    });
    win.addEventListener('scroll', scrolled, { passive: true, capture: true }); cleanup.push(() => win.removeEventListener('scroll', scrolled, true));
    const resized = guard(() => { rectsDirty = true; lightsDirty = true; schedule(); });
    win.addEventListener('resize', resized, { passive: true }); cleanup.push(() => win.removeEventListener('resize', resized));
    const resumed = guard(() => { if (!doc.hidden) { rectsDirty = true; lightsDirty = true; schedule(); } });
    doc.addEventListener('visibilitychange', resumed); cleanup.push(() => doc.removeEventListener('visibilitychange', resumed));
    win.__weGlassOptics = status;
    discover(false);
    return dispose;
  } catch (error) { fail(error); return undefined; }
}

// No network diagnostics: counters contain no content and exist only while enabled.
function reportGlassOptics(event, detail) {
  if (event.endsWith('error')) console.warn('[wallpaper-engine-glass] optics disabled:', detail);
}

let glassOpticsTimer = 0, glassOpticsRelease = null;

// Approximate the GTX 1650 recommendation using known renderer names.
const limitedGlassRenderers = [
  /\bIntel\s+(?:GMA\b|U?HD Graphics\b|Iris(?: Plus| Pro| Xe)? Graphics\b|Arc A3[1578]0[EM]?\b)/i,
  /\bGeForce\s+(?:(?:GTX?\s+)?[2-9]\d{2}M?|GTX?\s+(?:10[1356]0|1630)|MX(?:[1-4]\d{2}|5[15]0))\b/i,
  /\bRadeon\s+(?:HD\b|R[579]\b|RX\s+(?:[45]\d{2}|5[34]00|6400)M?\b|Vega\s+(?:3|6|8|10|11)\s+Graphics\b|(?:6[168]0|[78][46]0)M\b)/i,
  /\bApple\s+M[12]\b(?!\s+(?:Pro|Max|Ultra)\b)/i,
];

function glassOpticsGpuMode() {
  if (detectSoftwareRender()) return 'software';
  const { renderer, software } = probeGlassRenderer();
  if (software) return 'software';
  const model = renderer.replace(/\s*\((?:R|TM)\)|[®™]/gi, '');
  return limitedGlassRenderers.some(pattern => pattern.test(model)) ? 'limited' : 'standard';
}

const glassOpticsOptInKey = 'we-glass-optics-local-opt-in';
let glassOpticsLocalOptIn;

function setGlassOpticsLocalOptIn(enabled) {
  glassOpticsLocalOptIn = enabled;
  try { window.localStorage.setItem(glassOpticsOptInKey, enabled ? '1' : '0'); } catch { /* session only */ }
}

function glassOpticsEnabled(configured, mode) {
  if (configured !== true) return false;
  mode ??= glassOpticsGpuMode();
  if (mode !== 'limited') return mode === 'standard';
  if (glassOpticsLocalOptIn === undefined) {
    try { glassOpticsLocalOptIn = window.localStorage.getItem(glassOpticsOptInKey) === '1'; }
    catch { glassOpticsLocalOptIn = false; }
  }
  return glassOpticsLocalOptIn;
}

function disposeGlassOptics() {
  window.clearTimeout(glassOpticsTimer); glassOpticsTimer = 0;
  if (glassOpticsRelease) { try { glassOpticsRelease(); } catch {} glassOpticsRelease = null; }
}
function canMountGlassOptics() {
  const body = document.body;
  return !glassRowDisabled
    && !(typeof skinYieldActive === 'function' && skinYieldActive())
    && glassOpticsEnabled(selection.glassOptics)
    && body?.hasAttribute('data-we-glass-page') && !body.hasAttribute('data-we-glass-fallback');
}

function syncGlassOptics() {
  if (!canMountGlassOptics()) {
    disposeGlassOptics(); return;
  }
  if (glassOpticsRelease || glassOpticsTimer) return;
  glassOpticsTimer = window.setTimeout(() => {
    glassOpticsTimer = 0;
    if (!canMountGlassOptics()) return;
    try { glassOpticsRelease = installGlassOptics() || null; }
    catch (error) { reportGlassOptics('local-lens-v2-boot-error', String(error?.stack || error)); }
  }, 150);
}


export { installGlassOptics, syncGlassOptics, disposeGlassOptics, glassOpticsGpuMode, glassOpticsEnabled, setGlassOpticsLocalOptIn };
