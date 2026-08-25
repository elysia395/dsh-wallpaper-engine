// Verify the frame-skip transcode (抽帧转码) state machine against the emitted
// client bundle, focusing on the fps-cap switching bug:
//
//   switching 24→48 DIRECTLY while the 24fps transcode is still in flight used
//   to be treated as "already working on it" — the stale 24fps request then
//   completed, swapped the video to a 24fps re-encode and marked the state
//   "ready" while the picker advertised the NEW cap ("已切换至 48fps 抽帧版").
//   Only a round-trip through 无限制 (cap 0) cleared the latch, which is why
//   that workaround "fixed" it.
//
// This drives the REAL bundle through apply() + the picker's onClick handlers
// with a controllable fetch mock and asserts:
//   1. clicking 48fps while the 24fps request is in flight ABORTS the 24fps
//      request and starts a fresh 48fps one (no stale swap ever happens);
//   2. the completed 48fps request swaps the video in and reports ready with
//      the CORRECT cap;
//   3. switching back to 24fps after the swap starts + completes a 24fps
//      request and the state/UI stay truthful.
//
// Usage: node scripts/verify-transcode-state.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
}
function assert(cond, name, detail) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + name + (detail ? ' — ' + detail : ''));
}

// ── React mock (same contract as verify-client.mjs) ─────────────────────────
const React = {
  Fragment: 'Fragment',
  useState: (init) => [init, () => {}],
  useEffect: () => {},
  useRef: (v) => ({ current: v }),
  createElement: (type, props, ...children) =>
    typeof type === 'function' ? type(props || {}) : ({ type, props: props || null, children }),
};

// ── DOM mock with a real-enough <video> ─────────────────────────────────────
let byId = {};
const rotationTimers = [];
function makeEl(tag) {
  const handlers = {};
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    dataset: {},
    attributes: {},
    style: { _props: {}, setProperty(k, v) { this._props[k] = v; }, removeProperty(k) { delete this._props[k]; } },
    className: "",
    _parent: null,
    appendChild(c) { c._parent = this; this.children.push(c); if (c.id) byId[c.id] = c; return c; },
    remove() { if (this._parent) { const i = this._parent.children.indexOf(this); if (i >= 0) this._parent.children.splice(i, 1); } if (this.id) delete byId[this.id]; },
    setAttribute(k, v) { this.attributes[k] = v; },
    removeAttribute(k) { delete this.attributes[k]; },
    querySelector(sel) {
      if (sel === 'video') return this.children.find((c) => c.tagName === 'VIDEO') || null;
      if (sel.includes('canvas')) return null;
      return null;
    },
  };
  if (String(tag).toLowerCase() === 'video') {
    Object.assign(el, {
      isConnected: true,
      src: '',
      currentTime: 0,
      duration: 60,
      playbackRate: 1,
      paused: false,
      load() { el._loadCount = (el._loadCount || 0) + 1; },
      play() { el.paused = false; return Promise.resolve(); },
      pause() { el.paused = true; },
      addEventListener(type, fn, opts) { handlers[type] = fn; },
      removeEventListener(type) { delete handlers[type]; },
      _handlers: handlers,
    });
  }
  return el;
}

const bodyEl = makeEl('body');
const document = {
  createElement: (t) => makeEl(t),
  getElementById: (id) => byId[id] || null,
  querySelector: () => null,
  head: { appendChild: () => {} },
  body: bodyEl,
};
const localStorage = {
  _store: {},
  getItem(k) { return this._store[k] ?? null; },
  setItem(k, v) { this._store[k] = v; },
};

// ── Controllable fetch mock ─────────────────────────────────────────────────
// transcode requests are deferred so the test decides WHEN each completes;
// abort wiring lets us assert the stale request actually got cancelled.
const transcodePending = []; // { fps, url, controller, resolve, reject }
let transcodeResolved = []; // snapshots of completed requests (fps, aborted)
const mediaInfo = { width: 3840, height: 2160, codec: 'hvc1', fps: 120 };

function wireAbort(signal, resolve, reject) {
  if (!signal) return () => {};
  const onAbort = () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
  if (signal.aborted) { onAbort(); return () => {}; }
  signal.addEventListener('abort', onAbort);
  return () => signal.removeEventListener('abort', onAbort);
}

const fetchMock = (url, opts) => {
  opts = opts || {};
  if (typeof url === 'string' && url.includes('/wallpaper-engine/transcoded/')) {
    const fps = Number(new URL(url, 'http://x').searchParams.get('fps'));
    return new Promise((resolve, reject) => {
      const detach = wireAbort(opts.signal, resolve, reject);
      transcodePending.push({ fps, url, signal: opts.signal || null, resolve, reject, detach });
    });
  }
  if (typeof url === 'string' && url.includes('/wallpaper-engine/transcode-progress/')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ phase: 'transcode', percent: 50, source: 'ffmpeg', finalizing: false, eta: 10 }) });
  }
  if (typeof url === 'string' && url.includes('/wallpaper-engine/media-info/')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, info: mediaInfo }) });
  }
  if (typeof url === 'string' && url.includes('/wallpaper-engine/inventory')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        installDir: 'D:/we', total: 1, portableCount: 1, playlists: [],
        wallpapers: [
          { id: 'w1', title: 'Video W1', type: 'video', playable: true, media: '/wallpaper-engine/media/w1', preview: null, contentrating: 'Everyone' },
        ],
      }),
    });
  }
  if (typeof url === 'string' && url.includes('/wallpaper-engine/settings')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
  }
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
};

function activePending() {
  return transcodePending.filter((p) => !p.signal || !p.signal.aborted);
}
function completeTranscode(req, ok) {
  assert(req, 'a transcode request must be pending');
  const i = transcodePending.indexOf(req);
  if (i >= 0) transcodePending.splice(i, 1);
  transcodeResolved.push({ fps: req.fps, aborted: req.signal ? req.signal.aborted : false });
  req.detach();
  if (ok) {
    req.resolve({ ok: true, status: 206, arrayBuffer: () => Promise.resolve(new Uint8Array(1)) });
  } else {
    req.reject(Object.assign(new Error('transcode failed'), { name: 'Error' }));
  }
  return req;
}

// ── Module load + apply ─────────────────────────────────────────────────────
const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const cap = { handoff: null };
const sandbox = {
  window: {
    __ModuleLoader__: { load: (h) => { cap.handoff = h; } },
    setTimeout: (fn, ms) => { const t = { fn, ms, cleared: false }; rotationTimers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.cleared = true; },
    setInterval: () => ({ _interval: true }),
    clearInterval: () => {},
  },
  navigator: { userAgent: 'Mozilla/5.0 Chrome/120.0' }, // non-Edge: native <video>
  AbortController, // Node's real one: abort() must reject in-flight fetches
  setInterval: () => ({ _interval: true }), // bare setInterval in the client
  clearInterval: () => {},
  document, localStorage, fetch: fetchMock, React,
};
vm.createContext(sandbox);
new vm.Script(code, { filename: 'client.js' }).runInContext(sandbox);
const { factory } = cap.handoff;
const requireMock = (spec) => {
  if (spec === 'react') return React;
  if (spec === 'react-dom') return { createPortal: (node) => node };
  throw new Error('unexpected require: ' + spec);
};
const exportsObj = factory(requireMock);

const registrations = [];
const pickerRenders = [];
const slots = {
  inject: (key, cb) => cb(),
  register: (opts, render) => { registrations.push({ key: opts.name, id: opts.id, label: opts.label, order: opts.order }); pickerRenders.push(render); },
};
const effects = [];
const ctx = { slots, effect(fn) { effects.push(fn); fn(); return fn; } };
exportsObj.apply(ctx);

// ── Tree helpers ────────────────────────────────────────────────────────────
function walk(root, visit) {
  if (Array.isArray(root)) { root.forEach((n) => walk(n, visit)); return; }
  if (!root || typeof root !== 'object') return;
  visit(root);
  if (Array.isArray(root.children)) root.children.forEach((n) => walk(n, visit));
}
function findButton(tree, cls, text) {
  let hit = null;
  walk(tree, (n) => {
    if (hit) return;
    const c = typeof n.props?.className === 'string' ? n.props.className : '';
    if (c.includes(cls) && Array.isArray(n.children) && n.children.length === 1 && n.children[0] === text) hit = n;
  });
  return hit;
}
// Wallpaper cards carry the EXACT class 'we-picker__card' (+ '--selected');
// the close card shares that class, so ALSO require the wallpaper's title.
function findWallpaperCard(tree, title) {
  let hit = null;
  walk(tree, (n) => {
    if (hit) return;
    const c = typeof n.props?.className === 'string' ? n.props.className : '';
    if ((c === 'we-picker__card' || c === 'we-picker__card we-picker__card--selected') && n.props.title === title) hit = n;
  });
  return hit;
}
function renderTree() { return pickerRenders[0](); }

// ── Scenario ────────────────────────────────────────────────────────────────
async function main() {
  // Let the initial apply() settle (inventory fetch etc.).
  await new Promise((r) => setTimeout(r, 20));

  // Open the picker modal and select the single video wallpaper.
  let tree = renderTree();
  const openBtn = findButton(tree, 'we-picker__btn', '选择壁纸');
  assert(openBtn && typeof openBtn.props.onClick === 'function', 'picker open button found');
  openBtn.props.onClick();
  tree = renderTree();
  const card = findWallpaperCard(tree, 'Video W1');
  assert(card && typeof card.props.onClick === 'function', 'wallpaper card found');
  card.props.onClick(); // applySelection('w1')
  await new Promise((r) => setTimeout(r, 20)); // media-info probe resolves

  const layer = document.getElementById('dsh-wallpaper-engine-layer');
  assert(layer, 'wallpaper layer mounted');
  const video = layer.querySelector('video');
  assert(video, 'video element mounted');
  check('wallpaper layer + video mounted', !!video);
  check('video starts on the ORIGINAL (no transcode)', video.src === '/wallpaper-engine/media/w1' && !video.dataset.weTranscoded);

  // ---- 24fps: request starts, pending ----
  tree = renderTree();
  const b24 = findButton(tree, 'we-picker__rate', '24fps');
  assert(b24 && typeof b24.props.onClick === 'function', '24fps button found');
  b24.props.onClick();
  await new Promise((r) => setTimeout(r, 10));
  check('click 24fps starts a transcode request', transcodePending.length === 1 && transcodePending[0].fps === 24);
  const statusWorking = JSON.stringify(renderTree()).includes('抽帧准备中');
  check('UI shows 抽帧准备中 while 24fps transcode runs', statusWorking);

  // ---- 24 → 48 DIRECT while the 24fps request is in flight ----
  tree = renderTree();
  const b48 = findButton(tree, 'we-picker__rate', '48fps');
  assert(b48 && typeof b48.props.onClick === 'function', '48fps button found');
  b48.props.onClick();
  await new Promise((r) => setTimeout(r, 10));
  // The stale 24fps request must have been ABORTED, and a fresh 48fps one started.
  const stale24 = transcodePending.find((p) => p.fps === 24);
  check('24→48 direct: stale 24fps request is aborted (not left to swap in)',
    transcodeResolved.length === 0 && stale24 && stale24.signal && stale24.signal.aborted === true);
  const activeAfter48 = activePending();
  check('24→48 direct: a fresh 48fps request starts',
    activeAfter48.length === 1 && activeAfter48[0].fps === 48 && !activeAfter48[0].signal.aborted);
  check('24→48 direct: video still on the ORIGINAL mid-flight', video.src === '/wallpaper-engine/media/w1' && !video.dataset.weTranscoded);

  // ---- Complete the 48fps request → swap + ready with the CORRECT cap ----
  const req48 = activeAfter48[0];
  completeTranscode(req48, true);
  await new Promise((r) => setTimeout(r, 20));
  // loadedmetadata fires only after src swap; the mock fires it manually:
  assert(video._handlers.loadedmetadata, 'loadedmetadata handler registered after swap');
  video._handlers.loadedmetadata();
  await new Promise((r) => setTimeout(r, 10));
  check('48fps completes → video swapped to the 48fps re-encode',
    video.dataset.weTranscoded === '48' && video.src.includes('fps=48'));
  check('48fps completes → UI reports ready at 48fps',
    JSON.stringify(renderTree()).includes('已切换至 48fps 抽帧版'));

  // ---- Back to 24fps after the swap: fresh request + truthful swap ----
  // (Regression: with the video already on a transcode, the progress poller's
  // emit used to abort + re-start the request forever — a page freeze. The
  // request must stay in flight across the poll emit.)
  tree = renderTree();
  const b24b = findButton(tree, 'we-picker__rate', '24fps');
  b24b.props.onClick();
  await new Promise((r) => setTimeout(r, 30)); // let several poll-emit cycles run
  const active24b = activePending();
  check('48→24 after swap starts a fresh 24fps request',
    active24b.length === 1 && active24b[0].fps === 24 && !active24b[0].signal.aborted);
  completeTranscode(active24b[0], true);
  await new Promise((r) => setTimeout(r, 20));
  assert(video._handlers.loadedmetadata, 'loadedmetadata handler registered (24)');
  video._handlers.loadedmetadata();
  await new Promise((r) => setTimeout(r, 10));
  check('24fps completes → video swapped to the 24fps re-encode',
    video.dataset.weTranscoded === '24' && video.src.includes('fps=24'));
  check('24fps completes → UI reports ready at 24fps',
    JSON.stringify(renderTree()).includes('已切换至 24fps 抽帧版'));

  // ---- 无限制 clears everything (the historical workaround, still works) ----
  tree = renderTree();
  const b0 = findButton(tree, 'we-picker__rate', '无限制');
  assert(b0 && typeof b0.props.onClick === 'function', '无限制 button found');
  b0.props.onClick();
  await new Promise((r) => setTimeout(r, 10));
  check('无限制 reverts to the original + idle', !video.dataset.weTranscoded && video.src === '/wallpaper-engine/media/w1');

  // ---- Failure of a NEW cap reverts to the original (truthful 已回退原片) ----
  b24b.props.onClick();
  await new Promise((r) => setTimeout(r, 10));
  completeTranscode(activePending()[0], false); // 502/network failure
  await new Promise((r) => setTimeout(r, 20));
  check('failed transcode → video back on the original',
    !video.dataset.weTranscoded && video.src === '/wallpaper-engine/media/w1');
  check('failed transcode → UI reports fallback',
    JSON.stringify(renderTree()).includes('转码不可用，已回退原片'));

  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (failed.length === 0 ? 'ALL TRANSCODE STATE CHECKS PASSED' : failed.length + ' CHECK(S) FAILED'));
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('TEST ERROR:', err && err.stack ? err.stack : err);
  process.exit(1);
});
