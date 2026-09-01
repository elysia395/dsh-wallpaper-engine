// Verify the emitted client bundle materializes + drives the DOM correctly
// under the DSH module-loader contract. Exercises apply(), syncLayers(), and
// confirms: wallpaper + scrim layers are `<body>` children (no shell.overlay),
// the four effect knobs (wallpaper blur/scrim/border/glass blur) push CSS
// variables, the picker renders, and automatic rotation is scoped to a
// user-defined rotation group (list) with its own interval.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const React = {
  Fragment: 'Fragment',
  // Function initializers are invoked (lazy useState), matching real React.
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
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
  removeItem(k) { delete this._store[k]; },
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
const independentSidebarSelector = 'body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_panel"]';
const wallpaperGatedSidebarSelector = 'body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar]';
assert.ok(code.includes(independentSidebarSelector), 'sidebar glass must not require an active wallpaper');
assert.ok(!code.includes(wallpaperGatedSidebarSelector), 'legacy wallpaper-gated sidebar selector must be removed');
assert.ok(
  code.includes('body[data-we-sidebar-glass] [data-dsh-better-sidebar] .cm-editor'),
  'sidebar content surfaces must follow the sidebar master switch',
);
assert.ok(code.includes('body[data-we-wallpaper] {'), 'non-sidebar wallpaper effects must remain wallpaper-gated');
console.log('sidebar glass selectors are wallpaper-independent: true');
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
    // ── Tabbed IA: the picker splits into six tabs (壁纸/外观/字体/吉祥物/效果/
    //    高级). Each WallpaperPicker instance keeps its active tab in
    //    localStorage; mock React's useState returns the initializer value, so
    //    re-seeding the key + re-rendering switches tabs deterministically. ──
    const TAB_KEY = 'dsh-wallpaper-engine:picker-tab';
    const setTab = (id) => localStorage.setItem(TAB_KEY, id);
    const renderPicker = () => {
      try { return pickerRenders[0](); } catch (e) { console.log('picker render threw:', e && e.message); return null; }
    };
    const countMatches = (root, re) => (JSON.stringify(root).match(re) || []).length;
    // Find the .we-picker__ctl row whose subtree mentions `text`, then the
    // first input with onChange inside it — the pill-switch input is nested
    // inside label.we-picker__switch within that SAME row.
    const findCtlInput = (root, text) => {
      let row = null;
      (function walk(node) {
        if (row || !node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        const cls = typeof node.props?.className === 'string' ? node.props.className : '';
        if (cls.includes('we-picker__ctl') && JSON.stringify(node).includes(text)) { row = node; return; }
        if (Array.isArray(node.children)) node.children.forEach(walk);
      })(root);
      let hit = null;
      (function find(node) {
        if (hit || !node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(find); return; }
        if (node.type === 'input' && node.props && typeof node.props.onChange === 'function') { hit = node; return; }
        if (Array.isArray(node.children)) node.children.forEach(find);
      })(row);
      return hit;
    };
    const findSliderRow = (root, label) => {
      let hit = null;
      (function walk(node) {
        if (hit || !node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        const cls = typeof node.props?.className === 'string' ? node.props.className : '';
        const children = Array.isArray(node.children) ? node.children : [];
        const lbl = children.find((c) => c && typeof c === 'object' && Array.isArray(c.children) && c.children.includes(label));
        if (cls.includes('we-picker__slider-row') && lbl) hit = node;
        if (Array.isArray(node.children)) node.children.forEach(walk);
      })(root);
      return hit;
    };
    const sliderMax = (row) => (row ? JSON.stringify(row).match(/"max":"(\d+)"/)?.[1] : null);
    const findRangeInput = (row) =>
      (Array.isArray(row?.children) ? row.children : [])
        .find((c) => c && typeof c === 'object' && c.type === 'input');

    // ── 壁纸 tab (default): card head + tab bar + wallpaper controls. ──
    localStorage.removeItem(TAB_KEY);
    let tree = renderPicker();
    let treeText = JSON.stringify(tree);
    console.log('tab bar renders (6 tabs):', countMatches(tree, /"role":"tab"/g) === 6);
    console.log('default tab is 壁纸:', treeText.includes('"we-tabs__tab we-tabs__tab--active"') && treeText.includes('自动轮播'));
    console.log('wallpaper tab has 选择壁纸:', treeText.includes('"选择壁纸"'));
    console.log('wallpaper tab has 自定义壁纸:', treeText.includes('自定义壁纸'));
    console.log('other tabs keep their controls out of the tree:',
      !treeText.includes('玻璃透明度') && !treeText.includes('字体自定义') && !treeText.includes('吉祥物大小'));

    // ── 外观 tab: swatches / sliders / sidebar-glass group. ──
    setTab('appearance');
    tree = renderPicker();
    treeText = JSON.stringify(tree);
    console.log('appearance tab active:', treeText.includes('"we-tabs__tab we-tabs__tab--active"'));
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
    const sidebarSwitch = findCtlInput(tree, '侧栏液态玻璃');
    if (sidebarSwitch) {
      sidebarSwitch.props.onChange({ target: { checked: false } });
      assert.equal(bodyEl.attributes['data-we-sidebar-glass'], undefined, 'sidebar master off must restore native surfaces');
      tree = renderPicker();
      const offText = JSON.stringify(tree);
      console.log('switch off hides the three detail knobs:',
        !offText.includes('侧栏模糊') && !offText.includes('侧栏透明度') && !offText.includes('侧栏玻璃颜色'));
      console.log('switch itself stays visible when off:', offText.includes('侧栏液态玻璃'));
      sidebarSwitch.props.onChange({ target: { checked: true } });
      assert.equal(bodyEl.attributes['data-we-sidebar-glass'], 'on', 'sidebar master on must re-arm sidebar surfaces');
      tree = renderPicker();
      console.log('switch back on restores the detail knobs:',
        JSON.stringify(tree).includes('侧栏模糊') && JSON.stringify(tree).includes('侧栏透明度') && JSON.stringify(tree).includes('侧栏玻璃颜色'));
    } else {
      console.log('switch off hides the three detail knobs: false (switch not found)');
    }
    console.log('sidebar blur slider max (expect 200):', sliderMax(findSliderRow(tree, '侧栏模糊')));
    console.log('sidebar alpha slider max (expect 200):', sliderMax(findSliderRow(tree, '侧栏透明度')));
    console.log('whole-window glass master switch present:', treeText.includes('设置窗口液态玻璃'));
    console.log('window glass tooltip present:', treeText.includes('整个设置窗口'));

    // ── 字体 tab: master switch + conditional trio (颜色/字重/字体族). ──
    setTab('font');
    tree = renderPicker();
    treeText = JSON.stringify(tree);
    console.log('font tab has 字体自定义 switch:', treeText.includes('字体自定义'));
    const fontSwitch = findCtlInput(tree, '字体自定义');
    if (fontSwitch) {
      fontSwitch.props.onChange({ target: { checked: true } });
      tree = renderPicker();
      treeText = JSON.stringify(tree);
      console.log('font on reveals 颜色/字重/字体族 chips (expect 7):',
        treeText.includes('字体颜色') && treeText.includes('字重') && (treeText.match(/"aria-label":"字体 /g) || []).length === 7);
      fontSwitch.props.onChange({ target: { checked: false } });
      tree = renderPicker();
    }

    // ── 吉祥物 tab: rope toggle + form cards (live preview) + size slider. ──
    setTab('mascot');
    tree = renderPicker();
    const ropeToggle = findCtlInput(tree, '显示吉祥物');
    console.log('mascot rope toggle present:', !!ropeToggle);
    if (ropeToggle) {
      console.log('rope toggle checked by default:', ropeToggle.props.checked === true);
      ropeToggle.props.onChange({ target: { checked: false } });
      tree = renderPicker();
      const ropeOff = findCtlInput(tree, '显示吉祥物');
      console.log('unchecking hides the rope (checkbox off):', !!ropeOff && ropeOff.props.checked === false);
      ropeToggle.props.onChange({ target: { checked: true } });
      tree = renderPicker();
      const ropeOn = findCtlInput(tree, '显示吉祥物');
      console.log('re-checking restores the rope (checkbox on):', !!ropeOn && ropeOn.props.checked === true);
    } else {
      console.log('mascot rope toggle: false (not found)');
    }
    // Mascot form is now a pair of live-preview cards (aria-pressed = active).
    const findMascotCards = (root) => {
      const found = [];
      (function walk(node) {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        const cls = typeof node.props?.className === 'string' ? node.props.className : '';
        if (cls.includes('we-picker__mascot-card')) found.push(node);
        if (Array.isArray(node.children)) node.children.forEach(walk);
      })(root);
      return found;
    };
    const activeForm = (cards) => cards.find((c) => String(c.props.className).includes('--active'));
    let mascotCards = findMascotCards(tree);
    console.log('mascot form cards (expect 2):', mascotCards.length === 2);
    console.log('default form is maid:', !!activeForm(mascotCards) && activeForm(mascotCards).props.title === '小女仆');
    const whaleCard = mascotCards.find((c) => c.props.title === '鲸御姐');
    if (whaleCard) { whaleCard.props.onClick(); tree = renderPicker(); }
    mascotCards = findMascotCards(tree);
    console.log('form switches to whale:', !!activeForm(mascotCards) && activeForm(mascotCards).props.title === '鲸御姐');
    const maidCard = mascotCards.find((c) => c.props.title === '小女仆');
    if (maidCard) { maidCard.props.onClick(); tree = renderPicker(); }
    mascotCards = findMascotCards(tree);
    console.log('form switches back to maid:', !!activeForm(mascotCards) && activeForm(mascotCards).props.title === '小女仆');
    const ropeScaleSlider = findSliderRow(tree, '吉祥物大小');
    console.log('mascot rope size slider present:', !!ropeScaleSlider);
    if (ropeScaleSlider) {
      const ri = findRangeInput(ropeScaleSlider);
      console.log('rope size slider min/max (0.5/2.5):',
        ri && String(ri.props.min) === '0.5' && String(ri.props.max) === '2.5');
      console.log('rope size default scale (1):', ri && String(ri.props.value) === '1');
      if (ri) ri.props.onInput({ target: { value: '1.5' } });
      tree = renderPicker();
      const ri2 = findRangeInput(findSliderRow(tree, '吉祥物大小'));
      console.log('rope size slider updates to 1.5:', ri2 && String(ri2.props.value) === '1.5');
      if (ri2) ri2.props.onInput({ target: { value: '1' } });
      tree = renderPicker();
    } else {
      console.log('mascot rope size slider: false (not found)');
    }

    // ── 效果 tab: 玻璃 slider spans 0–60 px (wallpaper 'a' is active). ──
    setTab('effects');
    tree = renderPicker();
    console.log('effects tab has empty-state-free sliders:', JSON.stringify(tree).includes('壁纸模糊'));
    console.log('玻璃 slider max (expect 60):', sliderMax(findSliderRow(tree, '玻璃')));

    // ── 壁纸 tab again: modal / pagination / close card / sidebar stays armed.
    setTab('wallpaper');
    tree = renderPicker();
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
    tree = renderPicker();
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
    tree = renderPicker();
    cards = collectCards(tree);
    console.log('page 2 cards (expect 10: close + 9):', cards.length);
    const page2Text = JSON.stringify(cards);
    console.log('page 2 shows last wallpaper (Wall 29):', page2Text.includes('Wall 29'));
    console.log('page 2 no longer shows page-1 item (Wall 0):', !page2Text.includes('Wall 0'));
    console.log('scene C (frameUrl) in grid:', page2Text.includes('Scene C'));

    // Turn the active wallpaper off through the real picker callback. Sidebar
    // theming must remain armed because it is an independent feature; only
    // wallpaper-owned layers and the data-we-wallpaper marker disappear.
    const closeCard = cards.find((card) => JSON.stringify(card).includes('✕ 关闭'));
    assert.ok(closeCard && typeof closeCard.props.onClick === 'function', 'close-wallpaper card must be available');
    closeCard.props.onClick();
    assert.equal(bodyEl.attributes['data-we-wallpaper'], undefined, 'wallpaper marker must clear');
    assert.equal(bodyEl.attributes['data-we-sidebar-glass'], 'on', 'sidebar glass must remain enabled');
    assert.equal(typeof p['--we-sidebar-color'], 'string', 'sidebar color variable must remain available');
    assert.equal(typeof p['--we-sidebar-alpha'], 'string', 'sidebar alpha variable must remain available');
    assert.equal(typeof p['--we-sidebar-blur'], 'string', 'sidebar blur variable must remain available');
    console.log('sidebar glass remains armed without an active wallpaper: true');
  }
  console.log('effects ran:', effects.length);
  console.log('\nALL CLIENT CHECKS DONE');
}, 50);
