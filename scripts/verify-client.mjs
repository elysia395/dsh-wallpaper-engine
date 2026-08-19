// Verify the emitted client bundle materializes + drives the DOM correctly
// under the DSH module-loader contract. Exercises apply(), syncLayers(), and
// confirms: wallpaper + scrim layers are `<body>` children (no shell.overlay),
// the four effect knobs (wallpaper blur/scrim/border/glass blur) push CSS
// variables, the picker renders, and automatic rotation is scoped to a
// user-defined rotation group (list) with its own interval.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const React = {
  Fragment: 'Fragment',
  useState: (init) => [init, () => {}],
  useEffect: () => {},
  useRef: (v) => ({ current: v }),
  // Minimal-but-real renderer: invoke function components so the picker tree
  // actually materializes (descriptors only for host elements).
  createElement: (type, props, ...children) =>
    typeof type === 'function' ? type(props || {}) : ({ type, props: props || null, children }),
};

let byId = {};
const rotationTimers = [];
function makeEl(tag) {
  return {
    tagName: tag.toUpperCase(),
    children: [],
    dataset: {},
    attributes: {},
    style: { _props: {}, setProperty(k, v) { this._props[k] = v; }, removeProperty(k) { delete this._props[k]; } },
    className: "",
    appendChild(c) { this.children.push(c); if (c.id) byId[c.id] = c; return c; },
    remove() { if (this._parent) { const i = this._parent.children.indexOf(this); if (i >= 0) this._parent.children.splice(i, 1); } },
    setAttribute(k, v) { this.attributes[k] = v; },
    removeAttribute(k) { delete this.attributes[k]; },
    querySelector(sel) { return null; },
  };
}

const bodyEl = makeEl("body");
const document = {
  createElement: (t) => makeEl(t),
  getElementById: (id) => byId[id] || null,
  querySelector: () => null,
  head: { appendChild: () => {} },
  body: bodyEl,
};

const localStorage = {
  // Select a wallpaper and enable rotation over a user-defined group; omit
  // effect knobs so the new DEFAULTS (scrim 0.25, border 0.35, blur 24) apply.
  _store: { 'dsh-wallpaper-engine:selection': JSON.stringify({
    id: 'a',
    rotationGroupId: 'g1',
    rotationEnabled: true,
    rotationGroups: [
      { id: 'g1', name: 'My list', interval: 5, order: 'sequence', wallpaperIds: ['a', 'b', 'c'] },
    ],
  }) },
  getItem(k) { return this._store[k] ?? null; },
  setItem(k, v) { this._store[k] = v; },
};
const fetch = () => Promise.resolve({
  ok: true, status: 200,
  json: () => Promise.resolve({
    installDir: "D:/we", total: 3, portableCount: 2,
    playlists: [
      { id: "p1", name: "Test playlist", order: "sequence", wallpaperIds: ["a", "b", "c"], total: 3, portableCount: 2 },
    ],
    wallpapers: [
      { id: "a", title: "Video A", type: "video", playable: true, media: "/wallpaper-engine/media/xyz", preview: null },
      { id: "b", title: "Video B", type: "video", playable: true, media: "/wallpaper-engine/media/def", preview: null },
      { id: "c", title: "Scene C", type: "scene", playable: false, media: null, preview: null },
    ],
  }),
});

const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const cap = { handoff: null };
const sandbox = {
  window: {
    __ModuleLoader__: { load: (h) => { cap.handoff = h; } },
    setTimeout: (fn, ms) => {
      const token = { fn, ms, cleared: false };
      rotationTimers.push(token);
      return token;
    },
    clearTimeout: (token) => { if (token) token.cleared = true; },
  },
  document, localStorage, fetch, React,
};
vm.createContext(sandbox);
new vm.Script(code, { filename: 'client.js' }).runInContext(sandbox);

const { id, factory } = cap.handoff;
console.log('registered id:', id);

const requireMock = (spec) => {
  if (spec === 'react') return React;
  if (spec === 'react-dom') return { createPortal: (node) => node }; // modal renders inline in the mock
  throw new Error('unexpected require: ' + spec);
};
const exportsObj = factory(requireMock);
console.log('factory keys:', Object.keys(exportsObj));
console.log('inject:', JSON.stringify(exportsObj.inject));
console.log('Symbol.toStringTag:', Object.prototype.toString.call(exportsObj));

const registrations = [];
const effects = [];
const pickerRenders = [];
const slots = {
  inject: (key, cb) => cb(),
  register: (opts, render) => { registrations.push({ key: opts.name, id: opts.id, label: opts.label, order: opts.order }); pickerRenders.push(render); },
};
const ctx = { slots, effect(fn) { effects.push(fn); fn(); return fn; } };

let thrown = null;
try { exportsObj.apply(ctx); } catch (e) { thrown = e && e.message; }
console.log('apply threw:', thrown || '(none)');
console.log('slot registrations:', JSON.stringify(registrations));

setTimeout(() => {
  console.log('body children ids:', JSON.stringify(bodyEl.children.map((c) => c.id)));
  console.log('has wallpaper layer:', !!document.getElementById('dsh-wallpaper-engine-layer'));
  console.log('has scrim:', !!document.getElementById('dsh-wallpaper-engine-scrim'));
  console.log('body[data-we-wallpaper]:', JSON.stringify(bodyEl.attributes['data-we-wallpaper']));
  const p = bodyEl.style._props;
  console.log('--we-scrim-color:', JSON.stringify(p['--we-scrim-color']));
  console.log('--we-border-alpha:', JSON.stringify(p['--we-border-alpha']));
  console.log('--we-blur:', JSON.stringify(p['--we-blur']));
  console.log('--we-wallpaper-blur:', JSON.stringify(p['--we-wallpaper-blur']));
  console.log('--we-wallpaper-scale:', JSON.stringify(p['--we-wallpaper-scale']));
  const timer = rotationTimers.find((item) => !item.cleared);
  console.log('rotation timer scheduled:', !!timer, timer ? timer.ms : null);
  if (timer) {
    timer.fn();
    console.log('rotation next id:', JSON.parse(localStorage._store['dsh-wallpaper-engine:selection']).id);
    const wrapTimer = rotationTimers.find((item) => !item.cleared);
    if (wrapTimer) {
      wrapTimer.fn();
      console.log('rotation wraps to id:', JSON.parse(localStorage._store['dsh-wallpaper-engine:selection']).id);
    }
  }
  console.log('picker renders:', pickerRenders.length > 0);
  if (pickerRenders.length) {
    let renderError = null;
    let tree = null;
    try { tree = pickerRenders[0](); } catch (e) { renderError = e && e.message; }
    console.log('picker render threw:', renderError || '(none)');
    if (tree) {
      // The thumbnail grid lives inside the picker MODAL now (settings page
      // shows only the summary + "选择壁纸" trigger). Open the modal by
      // invoking the trigger button's onClick, re-render, then count cards.
      const openBtn = [];
      (function walk(node) {
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (!node || typeof node !== 'object') return;
        const cls = typeof node.props?.className === 'string' ? node.props.className : '';
        if (cls.includes('we-picker__btn') && Array.isArray(node.children) && node.children.length === 1 && node.children[0] === '选择壁纸') openBtn.push(node);
        if (Array.isArray(node.children)) node.children.forEach(walk);
      })(tree);
      if (openBtn.length && typeof openBtn[0].props.onClick === 'function') {
        try { openBtn[0].props.onClick(); } catch (e) { console.log('open modal onClick threw:', e && e.message); }
      }
      try { tree = pickerRenders[0](); } catch (e) { renderError = e && e.message; }
      const cards = [];
      (function walk2(node) {
        if (Array.isArray(node)) { node.forEach(walk2); return; }
        if (!node || typeof node !== 'object') return;
        const cls = typeof node.props?.className === 'string' ? node.props.className : '';
        if (cls === 'we-picker__card' || cls === 'we-picker__card we-picker__card--selected') cards.push(node);
        if (Array.isArray(node.children)) node.children.forEach(walk2);
      })(tree);
      console.log('modal grid cards (expect 3: close + a + b):', cards.length);
      console.log('scene wallpaper excluded from grid:', !JSON.stringify(cards).includes('Scene C'));
    }
  }
  console.log('effects ran:', effects.length);
  console.log('\nALL CLIENT CHECKS DONE');
}, 50);
