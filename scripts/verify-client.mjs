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
      { id: 'g1', name: 'My list', interval: 5, order: 'sequence', wallpaperIds: ['a', 'b'] },
    ],
  }) },
  getItem(k) { return this._store[k] ?? null; },
  setItem(k, v) { this._store[k] = v; },
};
const fetch = (url) => {
  // Route the settings GET: host reports dsh-better-sidebar as installed +
  // enabled (→ the 侧栏玻璃 control group must render), while keeping settings
  // empty so loadPersisted takes the "host has nothing yet → migrate the
  // localStorage seed" path the rest of the harness relies on.
  if (String(url).includes('/wallpaper-engine/settings')) {
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, betterSidebar: true }) });
  }
  return Promise.resolve({
  ok: true, status: 200,
  json: () => Promise.resolve({
    installDir: "D:/we", total: 34, portableCount: 33,
    playlists: [
      { id: "p1", name: "Test playlist", order: "sequence", wallpaperIds: ["a", "b", "c"], total: 3, portableCount: 2 },
    ],
    wallpapers: [
      // 30 synthetic videos force pagination (33 playable cards → 2 pages at 24/page).
      // All carry contentrating "Everyone" so they stay visible under the
      // default Everyone filter.
      ...Array.from({ length: 30 }, (_, i) => ({
        id: "w" + i, title: "Wall " + i, type: "video", playable: true, media: "/wallpaper-engine/media/w" + i, preview: null,
        contentrating: "Everyone",
      })),
      { id: "a", title: "Video A", type: "video", playable: true, media: "/wallpaper-engine/media/xyz", preview: null, contentrating: "Everyone" },
      { id: "b", title: "Video B", type: "video", playable: true, media: "/wallpaper-engine/media/def", preview: null, contentrating: "Everyone" },
      { id: "c", title: "Scene C", type: "scene", playable: false, media: null, preview: "/wallpaper-engine/preview/ccc", frameUrl: "/wallpaper-engine/scene-frame/ccc", contentrating: "Everyone" },
      { id: "d", title: "Scene D (no frame)", type: "scene", playable: false, media: null, preview: null, frameUrl: null, contentrating: "Everyone" },
      // e is PG13 and must be excluded under the default Everyone filter.
      { id: "e", title: "PG13 E", type: "web", playable: true, media: "/wallpaper-engine/media/pg", preview: null, contentrating: "PG13" },
    ],
  }),
  });
};

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

const sectionReg = registrations.find((r) => r.key === 'settings.section');
console.log('registered as first-level settings.section:', !!sectionReg);
console.log('section id:', sectionReg ? sectionReg.id : '(missing)');
console.log('section label:', sectionReg ? sectionReg.label : '(missing)');
console.log('no longer registered as general item:', !registrations.some((r) => r.key === 'settings.general.item'));

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
  console.log('--we-accent:', JSON.stringify(p['--we-accent']));
  console.log('--we-glass-alpha:', JSON.stringify(p['--we-glass-alpha']));
  console.log('--we-glass-color:', JSON.stringify(p['--we-glass-color']));
  console.log('body[data-we-glass-window] (default on):', JSON.stringify(bodyEl.attributes['data-we-glass-window']));
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
      // First-level section wrapper: ul.we-picker__section-list > li glass card.
      const rootUl = tree.type === 'ul' ? tree : null;
      const rootCls = typeof tree.props?.className === 'string' ? tree.props.className : '';
      console.log('section wrapper is ul.we-picker__section-list:', rootUl && rootCls.includes('we-picker__section-list'));
      const liChildren = rootUl ? (Array.isArray(rootUl.children) ? rootUl.children : []) : [];
      const li = liChildren.find((n) => n && typeof n === 'object' && typeof n.props?.className === 'string' && n.props.className.includes('we-picker__card-shell'));
      console.log('glass card shell (li.we-picker__card-shell) present:', !!li);
      const treeText = JSON.stringify(tree);
      console.log('card head (we-picker__card-head) present:', treeText.includes('we-picker__card-head'));
      console.log('card name "Wallpaper Engine":', treeText.includes('Wallpaper Engine'));
      console.log('accent preset swatches (expect 6):', (treeText.match(/"aria-label":"配色 /g) || []).length);
      console.log('glass-color preset swatches (expect 6):', (treeText.match(/"aria-label":"玻璃颜色 /g) || []).length);
      console.log('glass color custom input present:', treeText.includes('自定义玻璃颜色'));
      console.log('custom color input present:', treeText.includes('type":"color"'));
      console.log('glass transparency slider row present:', treeText.includes('玻璃透明度'));
      console.log('sidebar-glass master switch present:', treeText.includes('侧栏液态玻璃'));
      console.log('sidebar blur slider present:', treeText.includes('侧栏模糊'));
      console.log('sidebar alpha slider present:', treeText.includes('侧栏透明度'));
      console.log('sidebar glass-color swatches (expect 6):', (treeText.match(/"aria-label":"侧栏玻璃颜色 /g) || []).length);
      console.log('sidebar glass color custom input present:', treeText.includes('自定义侧栏玻璃颜色'));
      // The three detail knobs (侧栏模糊 / 侧栏透明度 / 侧栏玻璃颜色) are
      // conditional on the 侧栏液态玻璃 master switch: off → hidden, on →
      // restored, in the SAME render pass (the toggle re-emits synchronously).
      const sidebarSwitch = (() => {
        let hit = null;
        (function walk(node) {
          if (Array.isArray(node)) { node.forEach(walk); return; }
          if (!node || typeof node !== 'object') return;
          const children = Array.isArray(node.children) ? node.children : [];
          if (children.includes('侧栏液态玻璃')) {
            const input = children.find((c) => c && typeof c === 'object' && c.type === 'input');
            if (input && typeof input.props.onChange === 'function') hit = input;
          }
          if (Array.isArray(node.children)) node.children.forEach(walk);
        })(tree);
        return hit;
      })();
      if (sidebarSwitch) {
        sidebarSwitch.props.onChange({ target: { checked: false } });
        tree = pickerRenders[0]();
        const offText = JSON.stringify(tree);
        console.log('switch off hides the three detail knobs:',
          !offText.includes('侧栏模糊') && !offText.includes('侧栏透明度') && !offText.includes('侧栏玻璃颜色'));
        console.log('switch itself stays visible when off:', offText.includes('侧栏液态玻璃'));
        sidebarSwitch.props.onChange({ target: { checked: true } });
        tree = pickerRenders[0]();
        console.log('switch back on restores the detail knobs:',
          JSON.stringify(tree).includes('侧栏模糊') && JSON.stringify(tree).includes('侧栏透明度') && JSON.stringify(tree).includes('侧栏玻璃颜色'));
      } else {
        console.log('switch off hides the three detail knobs: false (switch not found)');
      }
      // Mascot rope-dock visibility toggle: present by default (checked),
      // unchecking flips the persisted flag (checkbox off), re-checking
      // restores it — re-renders read the live `selection`.
      const findRopeToggle = (root) => {
        let hit = null;
        (function walk(node) {
          if (Array.isArray(node)) { node.forEach(walk); return; }
          if (!node || typeof node !== 'object') return;
          const children = Array.isArray(node.children) ? node.children : [];
          if (children.includes('显示吉祥物（聊天顶部拉绳）')) {
            const input = children.find((c) => c && typeof c === 'object' && c.type === 'input');
            if (input && typeof input.props.onChange === 'function') hit = input;
          }
          if (Array.isArray(node.children)) node.children.forEach(walk);
        })(root);
        return hit;
      };
      const ropeToggle = findRopeToggle(tree);
      console.log('mascot rope toggle present:', !!ropeToggle);
      if (ropeToggle) {
        console.log('rope toggle checked by default:', ropeToggle.props.checked === true);
        ropeToggle.props.onChange({ target: { checked: false } });
        tree = pickerRenders[0]();
        const ropeOff = findRopeToggle(tree);
        console.log('unchecking hides the rope (checkbox off):', !!ropeOff && ropeOff.props.checked === false);
        ropeToggle.props.onChange({ target: { checked: true } });
        tree = pickerRenders[0]();
        const ropeOn = findRopeToggle(tree);
        console.log('re-checking restores the rope (checkbox on):', !!ropeOn && ropeOn.props.checked === true);
      } else {
        console.log('mascot rope toggle: false (not found)');
      }
      // 玻璃 slider now spans 0–60 px (was 0–40): assert the raised max on the
      // 玻璃 range input (label "玻璃", max 60) so the range stays in sync.
      const glassSlider = (() => {
        let hit = null;
        (function walk(node) {
          if (Array.isArray(node)) { node.forEach(walk); return; }
          if (!node || typeof node !== 'object') return;
          const cls = typeof node.props?.className === 'string' ? node.props.className : '';
          const children = Array.isArray(node.children) ? node.children : [];
          const label = children.find((c) => c && typeof c === 'object' && Array.isArray(c.children) && c.children.includes('玻璃'));
          if (cls.includes('we-picker__slider-row') && label) hit = node;
          if (Array.isArray(node.children)) node.children.forEach(walk);
        })(tree);
        return hit;
      })();
      const sliderMax = glassSlider ? JSON.stringify(glassSlider).match(/"max":"(\d+)"/)?.[1] : null;
      console.log('玻璃 slider max (expect 60):', sliderMax);
      console.log('whole-window glass master switch present:', treeText.includes('设置窗口液态玻璃'));
      console.log('window glass hint present:', treeText.includes('整个设置窗口'));
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
      const collectCards = (root) => {
        const cards = [];
        (function walk2(node) {
          if (Array.isArray(node)) { node.forEach(walk2); return; }
          if (!node || typeof node !== 'object') return;
          const cls = typeof node.props?.className === 'string' ? node.props.className : '';
          if (cls === 'we-picker__card' || cls === 'we-picker__card we-picker__card--selected') cards.push(node);
          if (Array.isArray(node.children)) node.children.forEach(walk2);
        })(root);
        return cards;
      };
      const clickPager = (root, label) => {
        let hit = null;
        (function walk(node) {
          if (Array.isArray(node)) { node.forEach(walk); return; }
          if (!node || typeof node !== 'object') return;
          const cls = typeof node.props?.className === 'string' ? node.props.className : '';
          if (cls.includes('we-picker__btn') && Array.isArray(node.children) && node.children.length === 1 && node.children[0] === label) hit = node;
          if (Array.isArray(node.children)) node.children.forEach(walk);
        })(root);
        if (hit && typeof hit.props.onClick === 'function') { try { hit.props.onClick(); } catch (e) { console.log('pager click threw:', e && e.message); } }
        return hit;
      };
      // Page 1: 33 playable wallpapers → 2 pages @ 24; grid = close card + 24.
      let cards = collectCards(tree);
      console.log('page 1 cards (expect 25: close + 24):', cards.length);
      console.log('pager rendered (pages > 1):', JSON.stringify(tree).includes('we-picker__pager'));
      const page1Text = JSON.stringify(cards);
      console.log('page 1 shows first wallpaper (Wall 0):', page1Text.includes('Wall 0'));
      console.log('page 1 does NOT show page-2 item (Wall 30):', !page1Text.includes('Wall 30'));
      console.log('scene D (no frameUrl) excluded from grid:', !page1Text.includes('Scene D'));
      console.log('pg13 wallpaper excluded under default Everyone filter:', !page1Text.includes('PG13 E'));
      // Flip to page 2 → 33 - 24 = 9 wallpapers + close card = 10.
      clickPager(tree, '下一页 ›');
      try { tree = pickerRenders[0](); } catch (e) { renderError = e && e.message; }
      cards = collectCards(tree);
      console.log('page 2 cards (expect 10: close + 9):', cards.length);
      const page2Text = JSON.stringify(cards);
      console.log('page 2 shows last wallpaper (Wall 29):', page2Text.includes('Wall 29'));
      console.log('page 2 no longer shows page-1 item (Wall 0):', !page2Text.includes('Wall 0'));
      console.log('scene C (frameUrl) in grid:', page2Text.includes('Scene C'));
    }
  }
  console.log('effects ran:', effects.length);
  console.log('\nALL CLIENT CHECKS DONE');
}, 50);
