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
const sceneFrameHeadCalls = [];
const sceneFrameDeleteCalls = [];
// 已删除的 CPU 动画渲染（scene-anim / APNG）的**反向**探针：任何 <video>.src
// 指向 /scene-anim/<token> 都说明那条路线复活了 —— 断言必须恒为空。
const animProbeSrcs = [];
// 同一个 src 赋值也记录**元素**：用于区分「探测视频」与「上屏的层内视频」
// （层内视频的 _parent 是 LAYER_ID 那个层节点）。
const animVideoEls = [];
const imgEls = [];
function makeEl(tag) {
  return {
    tagName: tag.toUpperCase(),
    children: [],
    dataset: {},
    attributes: {},
    style: { _props: {}, setProperty(k, v) { this._props[k] = v; }, removeProperty(k) { delete this._props[k]; } },
    className: "",
    appendChild(c) { this.children.push(c); c._parent = this; if (c.id) byId[c.id] = c; return c; },
    remove() { if (this._parent) { const i = this._parent.children.indexOf(this); if (i >= 0) this._parent.children.splice(i, 1); } if (this.id) delete byId[this.id]; },
    setAttribute(k, v) { this.attributes[k] = v; },
    removeAttribute(k) { delete this.attributes[k]; },
    querySelector(sel) { return null; },
  };
}

const bodyEl = makeEl("body");
const document = {
  createElement: (t) => {
    const el = makeEl(t);
    if (t === 'video') {
      let _src = '';
      Object.defineProperty(el, 'src', {
        get: () => _src,
        set: (v) => {
          _src = String(v || '');
          if (_src.includes('/scene-anim/')) { animProbeSrcs.push(_src); animVideoEls.push({ el, src: _src }); }
        },
      });
    }
    if (t === 'img') {
      // 静态帧层（buildMedia 的 img 分支）的 src：用于锁定「回退静态帧必须带画面档位」。
      let _src = '';
      Object.defineProperty(el, 'src', {
        get: () => _src,
        set: (v) => { _src = String(v || ''); imgEls.push({ el, src: _src }); },
      });
    }
    return el;
  },
  getElementById: (id) => byId[id] || null,
  querySelector: () => null,
  // makeEl so injected <style id="we-font-patch"/"we-caret-patch"> elements are
  // tracked in byId and their textContent is assertable below.
  head: makeEl("head"),
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
    // 场景 C 记着画面档位 3：锁定「静态帧必须按该壁纸记住的档位加载」。
    frameVariants: { c: 3 },
  }) },
  getItem(k) { return this._store[k] ?? null; },
  setItem(k, v) { this._store[k] = v; },
  removeItem(k) { delete this._store[k]; },
};
// 槽位是否已有 GPU 抓帧（场景 C）：DELETE 后翻假，模拟真宿主的磁盘状态。
let cccGpuPinned = true;
// P2-L：宿主 unlink 失败时回 200 + removed:false（文件其实还在磁盘上）。
let cccClearUnlinkFails = false;
const inventoryCalls = []; // /inventory 请求次数（sceneVideo 时序补拉断言用）
const fetch = (url, opts) => {
  const u = String(url);
  const method = (opts && opts.method) || 'GET';
  if (u.includes('/wallpaper-engine/inventory')) inventoryCalls.push(u);
  // GPU 抓帧缓存的 HEAD 探测 / DELETE 清除（面板提示与清除入口）：
  // 场景 C（/scene-frame/ccc）假装缓存里已有 _gpu.png。
  if (method === 'HEAD') {
    sceneFrameHeadCalls.push(u);
    return Promise.resolve({
      ok: true, status: 204,
      headers: { get: (k) => (String(k).toLowerCase() === 'x-we-gpu'
        ? (u.includes('/scene-frame/ccc') && cccGpuPinned ? '1' : '0') : null) },
    });
  }
  if (method === 'DELETE') {
    sceneFrameDeleteCalls.push(u);
    if (cccClearUnlinkFails) {
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ ok: true, removed: false, error: 'unlink-failed' }),
      });
    }
    // 真宿主语义：DELETE 删掉 <key>_gpu.png → 之后 HEAD 回到 X-WE-GPU=0。
    if (u.includes('/scene-frame-cache/ccc')) cccGpuPinned = false;
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, removed: true }) });
  }
  // 已删除路线的进度端点：这里保留一个应答，用来**证明客户端从不请求它**
  // （真请求了就会在 animProbeSrcs 之外留下痕迹，故一并把它当作陷阱）。
  if (u.includes('/scene-anim-progress/')) {
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ percent: 100 }) });
  }
  // Route the settings GET: host reports dsh-better-sidebar as installed +
  // enabled (→ the 侧栏玻璃 control group must render), while keeping settings
  // empty so loadPersisted takes the "host has nothing yet → migrate the
  // localStorage seed" path the rest of the harness relies on.
  if (u.includes('/wallpaper-engine/settings')) {
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

// 变异测试钩子：默认读构建产物，DSH_MUT_LIB 指向变异副本时读它。
const code = readFileSync(process.env.DSH_MUT_LIB || new URL('../lib/client.js', import.meta.url), 'utf8');
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
  // 浏览器里裸 setTimeout/setInterval 就是 window 上的 —— 沙箱必须同样提供：
  // 只用裸全局的代码路径（live 心跳、转码进度轮询）否则会静默抛错，
  // 让这类行为断言变成假绿。
  setTimeout: (fn, ms) => {
    const token = { fn, ms, cleared: false };
    rotationTimers.push(token);
    return token;
  },
  clearTimeout: (token) => { if (token) token.cleared = true; },
  setInterval: (fn, ms) => {
    const token = { fn, ms, cleared: false, interval: true };
    rotationTimers.push(token);
    return token;
  },
  clearInterval: (token) => { if (token) token.cleared = true; },
};
// 可控时钟：「帧率上限」按钮只有走到门禁的**冷缓存**分支（probeGpuFramePin 的
// 30s TTL 过期）才能被行为断言测出是否真的走了门禁 —— 否则按钮路径与「选壁纸」
// 路径共用同一条 gpuFramePins 缓存命中，改回直调也照样绿。
const RealDate = Date;
let nowOffset = 0;
const FakeDate = function (...a) { return a.length ? new RealDate(...a) : new RealDate(RealDate.now() + nowOffset); };
FakeDate.now = () => RealDate.now() + nowOffset;
FakeDate.parse = RealDate.parse; FakeDate.UTC = RealDate.UTC; FakeDate.prototype = RealDate.prototype;
sandbox.Date = FakeDate;
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

setTimeout(async () => {
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
  console.log('--we-wallpaper-opacity (default 0% → unset):', JSON.stringify(p['--we-wallpaper-opacity']));
  assert.equal(p['--we-wallpaper-opacity'], undefined, 'wallpaper opacity must stay untouched by default (no identity-opacity compositing layer)');
  console.log('--we-accent:', JSON.stringify(p['--we-accent']));
  console.log('--we-glass-alpha:', JSON.stringify(p['--we-glass-alpha']));
  console.log('--we-glass-color:', JSON.stringify(p['--we-glass-color']));
  console.log('body[data-we-glass-window] (default on):', JSON.stringify(bodyEl.attributes['data-we-glass-window']));
  // ── 轮换「就绪后切换 + 渐变」断言 ─────────────────────────────────
  // mock 环境无 addEventListener/Image → 准备管线特性探测失败即同步直通提交。
  // 按 5 分钟（300000ms）定位真正的轮换定时器，绕开 persist 防抖的 200ms
  // 定时器；提交结果同步看新层 dataset.weKey（含 selection.url），持久化
  // 需再手动 flush 200ms 的 persist 写。
  // 断言走 assert.ok：任何一条不成立 → 非零退出（评审指出此前全是
  // console.log，把轮换打回元素级领养也能 exit 0）。
  const rotCheck = (label, cond) => { assert.ok(cond, label); console.log('  ✓ ' + label); };
  const flushPersistWrites = () => {
    for (const t of rotationTimers.filter((item) => !item.cleared && !item.fired && item.ms === 200)) {
      t.fired = true;
      try { t.fn(); } catch (e) { console.log('persist flush threw:', e && e.message); }
    }
  };
  const findRotTimer = () => rotationTimers.find((item) => !item.cleared && !item.fired && item.ms === 5 * 60 * 1000);
  const fireRot = (t) => { t.fired = true; t.fn(); };
  const preLayer = document.getElementById('dsh-wallpaper-engine-layer');
  const rotTimer = findRotTimer();
  rotCheck('rotation timer scheduled (5min)', !!rotTimer);
  if (rotTimer) {
    fireRot(rotTimer); // a → b（直通提交）
    const postLayer = document.getElementById('dsh-wallpaper-engine-layer');
    const weKey1 = postLayer && postLayer.dataset ? postLayer.dataset.weKey : '';
    rotCheck('rotation prepare: ready-commit switches layer to next (b/media/def)',
      !!postLayer && postLayer !== preLayer && weKey1.indexOf('/wallpaper-engine/media/def') !== -1);
    rotCheck('rotation fade: old layer marked weFading', !!preLayer && preLayer.dataset.weFading === '1');
    rotCheck('rotation fade: old layer yielded LAYER_ID', !!preLayer && preLayer.id === '');
    rotCheck('rotation fade: new layer carries fadein classes', !!postLayer
      && postLayer.className.indexOf('we-layer--fadein') !== -1
      && postLayer.className.indexOf('we-layer--fadein-on') !== -1);
    flushPersistWrites();
    rotCheck('rotation prepare: commit persisted (id b)',
      JSON.parse(localStorage._store['dsh-wallpaper-engine:selection']).id === 'b');
    // 第二次 fire（wrap）：上一份 fading 层被即时退役，选择绕回 a。
    const rotTimer2 = findRotTimer();
    rotCheck('rotation prepare: timer re-armed after commit', !!rotTimer2);
    if (rotTimer2) {
      fireRot(rotTimer2);
      const layer2 = document.getElementById('dsh-wallpaper-engine-layer');
      const weKey2 = layer2 && layer2.dataset ? layer2.dataset.weKey : '';
      rotCheck('rotation prepare: second ready-commit wraps (a/media/xyz)',
        !!layer2 && layer2 !== postLayer && weKey2.indexOf('/wallpaper-engine/media/xyz') !== -1);
      rotCheck('rotation fade: second switch also fades', !!layer2
        && layer2.className.indexOf('we-layer--fadein') !== -1);
      rotCheck('rotation fade: previous fading layer retired immediately',
        bodyEl.children.indexOf(preLayer) === -1);
      flushPersistWrites();
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
      treeText = JSON.stringify(tree);
    }

    // ── 输入光标（#83）: caret color swatches live on the font tab and are
    //    INDEPENDENT of the 字体自定义 master switch (visible while it is off). ──
    console.log('font tab has 输入光标 section:', treeText.includes('输入光标'));
    console.log('caret swatches (expect 7: 自动 + 6 presets):', (treeText.match(/"aria-label":"光标颜色 /g) || []).length);
    console.log('caret custom color input present:', treeText.includes('自定义光标颜色'));
    const findSwatch = (root, aria) => {
      let hit = null;
      (function walk(node) {
        if (hit || !node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (node.props && node.props['aria-label'] === aria) { hit = node; return; }
        if (Array.isArray(node.children)) node.children.forEach(walk);
      })(root);
      return hit;
    };
    const caretWhite = findSwatch(tree, '光标颜色 #ffffff');
    const caretAuto = findSwatch(tree, '光标颜色 自动');
    console.log('caret 白 preset + 自动 buttons present:', !!caretWhite && !!caretAuto);
    if (caretWhite && caretAuto) {
      caretWhite.props.onClick();
      tree = renderPicker();
      assert.equal(p['--we-caret-color'], '#ffffff', 'picking a caret color must arm --we-caret-color');
      const caretSt = document.getElementById('we-caret-patch');
      console.log('caret style injected with caret-color rule:',
        !!caretSt && String(caretSt.textContent || '').includes('caret-color: var(--we-caret-color) !important'));
      assert.ok(caretSt, 'we-caret-patch style element must exist while a caret color is set');
      caretAuto.props.onClick();
      tree = renderPicker();
      assert.equal(p['--we-caret-color'], undefined, '自动 must clear --we-caret-color');
      assert.equal(document.getElementById('we-caret-patch'), null, '自动 must remove the caret style element');
      console.log('caret 自动 restores native caret: true');
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

    // ── 壁纸透明度（#82）: slider max 90; 60% → layer opacity 0.4; 0% unsets. ──
    const wpOpacityRow = findSliderRow(tree, '壁纸透明度');
    console.log('壁纸透明度 slider max (expect 90):', sliderMax(wpOpacityRow));
    const wpOpacityInput = findRangeInput(wpOpacityRow);
    if (wpOpacityInput) {
      wpOpacityInput.props.onInput({ target: { value: '60' } });
      tree = renderPicker();
      assert.equal(p['--we-wallpaper-opacity'], '0.4', '壁纸透明度 60% must drive layer opacity 0.4');
      const wpReset = findRangeInput(findSliderRow(tree, '壁纸透明度'));
      if (wpReset) wpReset.props.onInput({ target: { value: '0' } });
      tree = renderPicker();
      assert.equal(p['--we-wallpaper-opacity'], undefined, '壁纸透明度 0% must unset the variable (identity opacity)');
      console.log('壁纸透明度 drives --we-wallpaper-opacity (0.4 @60%, unset @0%): true');
    }

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

  // ── GPU 抓帧缓存：状态提示 + 清除入口（面板）──────────────────────────
  // 按用户决策：_gpu.png 存在时优先于「壁纸画面刷新」全部档位，所以切档位
  // 的前置动作是先清除。这里验证完整链路：选中场景 → HEAD 探测 → 面板出现
  // 「清除 GPU 帧」→ 点击 → DELETE 打到 host → 提示行消失。
  {
    // 与上文 setTab 同款：mock 的 useState 每次渲染都取 initializer，
    // 重新种 localStorage 再渲染即可确定性地切到目标 tab。
    // 「画面」section（壁纸画面刷新 + GPU 帧行）在「效果」tab 里。
    localStorage.setItem('dsh-wallpaper-engine:picker-tab', 'effects');
    assert.ok(pickerRenders.length > 0, 'picker render 回调必须已注册');
    // 等 boot 的 promise 链（loadPersisted → loadInventory →
    // revalidateSelection）全部落定：它会按持久化 id 覆盖选择。
    await new Promise((r) => setTimeout(r, 80));
    const renderPicker = () => {
      try { return pickerRenders[0](); } catch (e) { console.log('picker render threw:', e && e.message); return null; }
    };
    const reopenPicker = () => {
      let tree2 = renderPicker();
      const openBtn = [];
      (function walk(node) {
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (!node || typeof node !== 'object') return;
        const cls = typeof node.props?.className === 'string' ? node.props.className : '';
        if (cls.includes('we-picker__btn') && Array.isArray(node.children) && node.children.length === 1
          && node.children[0] === '选择壁纸') openBtn.push(node);
        if (Array.isArray(node.children)) node.children.forEach(walk);
      })(tree2);
      if (openBtn.length) { try { openBtn[0].props.onClick(); } catch { /* ignore */ } }
      return renderPicker();
    };
    const findBtn = (root, label) => {
      let hit = null;
      (function walk(node) {
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (!node || typeof node !== 'object') return;
        const cls = typeof node.props?.className === 'string' ? node.props.className : '';
        if (cls.includes('we-picker__btn') && Array.isArray(node.children) && node.children.length === 1
          && node.children[0] === label) hit = node;
        if (Array.isArray(node.children)) node.children.forEach(walk);
      })(root);
      return hit;
    };
    const findCard = (root, text) => {
      const cards = [];
      (function walk(node) {
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (!node || typeof node !== 'object') return;
        const cls = typeof node.props?.className === 'string' ? node.props.className : '';
        if (cls === 'we-picker__card' || cls.startsWith('we-picker__card ')) cards.push(node);
        if (Array.isArray(node.children)) node.children.forEach(walk);
      })(root);
      return cards.find((card) => JSON.stringify(card).includes(text));
    };
    let tree3 = reopenPicker();
    // 前置：先点选一张视频壁纸把层建出来（上文「无活动壁纸」用例清掉了层），
    // 否则 scene C 是首层、无旧层可淡，手动淡出的断言失去对象。Wall 0 在
    // 第 1 页：往前翻（上一页）找，翻到首页必现。
    let seedCard = findCard(tree3, 'Wall 0');
    for (let i = 0; i < 6 && !seedCard; i++) {
      const prev = findBtn(tree3, '‹ 上一页');
      if (!prev || prev.props.disabled) break;
      prev.props.onClick();
      tree3 = reopenPicker();
      seedCard = findCard(tree3, 'Wall 0');
    }
    assert.ok(seedCard && typeof seedCard.props.onClick === 'function', 'video card (Wall 0) must be clickable');
    seedCard.props.onClick(); // 建首层（existing=null → 本步不淡，正常）
    // 场景 C 落在第 2 页（上文翻页后 sel.page 就停在那里）——若不在，翻页找。
    let sceneCard = findCard(tree3, 'Scene C');
    for (let i = 0; i < 4 && !sceneCard; i++) {
      const next = findBtn(tree3, '下一页 ›');
      if (!next || next.props.disabled) break;
      next.props.onClick();
      tree3 = reopenPicker();
      sceneCard = findCard(tree3, 'Scene C');
    }
    assert.ok(sceneCard && typeof sceneCard.props.onClick === 'function', 'scene C card must be clickable');
    const manualPreLayer = document.getElementById('dsh-wallpaper-engine-layer');
    sceneCard.props.onClick(); // 选中场景壁纸 → syncLayers → HEAD 探测
    await new Promise((r) => setTimeout(r, 20)); // 等 HEAD 探测的 promise 回来
    // 「画面」section（含 GPU 提示行）在 tab 面板里，模态框只渲染网格 →
    // 选中后关掉模态框再断言（模态框关闭按钮文案恰为「关闭」）。
    const modalClose = findBtn(renderPicker(), '关闭');
    assert.ok(modalClose, '模态框应有「关闭」按钮');
    modalClose.props.onClick();
    assert.ok(sceneFrameHeadCalls.some((u) => u.includes('/scene-frame/ccc')),
      '选中场景壁纸后必须 HEAD 探测 GPU 帧状态（面板据此提示）');
    // ── 手动切换（非轮换）也是交叉淡化：此前只有轮换 commit 置 pendingRotationFade
    //    才淡，手动点选硬切 —— 旧层即拆、下一张的静态帧缓存直接上屏。改为按
    //    weWid 判定（层上 weWid ≠ 当前选择 id → 淡出）。syncLayers 在 onClick
    //    内同步完成，无需再等待。
    const manualPostLayer = document.getElementById('dsh-wallpaper-engine-layer');
    assert.ok(manualPreLayer && manualPreLayer.dataset.weFading === '1',
      '手动切换：旧壁纸层必须标记 weFading 淡出保留（不得即拆）');
    assert.ok(manualPreLayer.id === '',
      '手动切换：旧层必须让出 LAYER_ID');
    assert.ok(manualPostLayer && manualPostLayer !== manualPreLayer
      && manualPostLayer.className.indexOf('we-layer--fadein') !== -1,
      '手动切换：新层必须带 fadein 类淡入（交叉淡化，不是硬切）');
    assert.ok(manualPostLayer.dataset.weWid === 'c',
      '新层必须记录 weWid（后续重建按它判定是否换壁纸）');
    tree3 = renderPicker(); // 模态框已关：此时渲染的是 tab 面板（含「画面」section）
    assert.ok(JSON.stringify(tree3).includes('壁纸画面刷新'), '选中场景壁纸后面板应出现「壁纸画面刷新」行');
    assert.equal(animProbeSrcs.length, 0,
      '槽位已有 GPU 帧时不得启动任何 CPU 动画渲染（scene-anim 已删除）');
    const clearBtn = findBtn(tree3, '清除 GPU 帧');
    assert.ok(clearBtn, 'HEAD 报 X-WE-GPU=1 时面板必须给出「清除 GPU 帧」入口');
    // ── P2-L：宿主回 200 但 removed:false（unlink 失败）时不得当清除成功 ──
    // 只判 r.ok 会把「假成功」当清除：面板行消失、提示已清除，而宿主照旧发 GPU
    // 帧 —— 画面纹丝不动、档位怎么点都不变、且没有任何反馈。
    cccClearUnlinkFails = true;
    const probesBeforeFail = animProbeSrcs.length;
    clearBtn.props.onClick();
    await new Promise((r) => setTimeout(r, 40));
    tree3 = renderPicker();
    assert.ok(findBtn(tree3, '清除 GPU 帧'),
      'P2-L：宿主回 200 + removed:false 时必须保留清除入口（不得当清除成功）');
    assert.ok(JSON.stringify(tree3).includes('清除失败'),
      'P2-L：清除失败必须给出提示，而不是静默显示成功');
    assert.equal(animProbeSrcs.slice(probesBeforeFail).length, 0,
      'P2-L：没真删掉就不能恢复 CPU 渲染（否则与仍在生效的 GPU 帧叠加）');
    cccClearUnlinkFails = false;
    const clearBtn2 = findBtn(renderPicker(), '清除 GPU 帧');
    assert.ok(clearBtn2, 'P2-L：失败后必须还能重试清除');
    clearBtn2.props.onClick();
    await new Promise((r) => setTimeout(r, 40)); // 等 DELETE + 清除后的 HEAD 判据回来
    assert.ok(sceneFrameDeleteCalls.some((u) => u.includes('/scene-frame-cache/ccc')),
      '点击清除必须 DELETE /scene-frame-cache/<token>');
    tree3 = renderPicker();
    assert.ok(!findBtn(tree3, '清除 GPU 帧'), '清除成功后提示行必须消失');
    // 目标形态：场景动画只保留 WebWallGL live 一条路线，回退链是
    // MP4 → 静态帧 → 单张大图 → 内嵌图；**没有 CPU 动画渲染**（scene-anim / APNG
    // 已删除）。清除 GPU 抓帧后画面回落静态帧链即可，不得再启动分钟级的 CPU 渲染。
    assert.equal(animProbeSrcs.length, 0,
      '清除 GPU 帧后不得启动 CPU scene-anim 渲染（该路线已删除）');
    console.log('GPU 帧提示 + 清除入口链路: ok');
    console.log('GPU 帧优先于静态帧（清除后回落静态帧链，不再有 CPU 渲染）: ok');

    // ── CPU 动画渲染路线已删除：这里改为**钉死删除** ──────────────────────
    // 目标形态：场景动画只保留 WebWallGL live 一条路线，回退链是
    // MP4 → 静态帧 → 单张大图 → 内嵌图；**没有 CPU 动画渲染**（scene-anim / APNG，
    // 分钟级 CPU 渲染且会把 live 抓帧的静帧覆盖掉）。原先这一段逐条断言「点帧率档位
    // 会启动 CPU 重渲染、产物上屏、有 GPU 帧时被门禁挡住」，那些能力连同 /scene-anim
    // 路由一起删了 —— 现在反过来把这些入口钉死，删掉的东西不得悄悄复活。
    for (const [what, needle] of [
      ['queueSceneAnimUpgrade', 'queueSceneAnimUpgrade'],
      ['maybeQueueSceneAnimUpgrade', 'maybeQueueSceneAnimUpgrade'],
      ['cancelSceneAnimUpgrade', 'cancelSceneAnimUpgrade'],
      ['/scene-anim 路由', '/scene-anim/'],
      ['sceneAnimProgress 状态', 'sceneAnimProgress'],
      ['betaSceneAnim 开关', 'betaSceneAnim'],
    ]) {
      assert.ok(!code.includes(needle), 'CPU 动画渲染路线已删除，不得复活：' + what);
    }


    // ⑤ 抓帧回填落地必须校验「发起时那张壁纸」，不得把状态记到当前壁纸头上。
    assert.ok(code.includes('if (String(selection.id || "") !== backfillWid) return;'),
      'GPU 抓帧回填落地必须校验壁纸身份（否则切走后会给新壁纸误标「已有 GPU 帧」）');

    // ⑤b 抓帧回填必须校验存帧**几何**（视口宽高比），不只是「槽位有没有帧」：
    // 抓帧是「抓帧那一刻视口的构图」，别的窗口/旧会话留下的帧拿到当前窗口上屏
    // 会被 CSS object-fit: cover 再裁一次 —— 实测 1440x960 的帧在 2488x1376
    // 视口里只显示设计宽度的 84.5%（对 CPU 帧做最佳匹配拟合），人物比 live 大
    // 约 19% 且四周被切。判据来自宿主的 X-WE-GPU-AR（读 PNG 的 IHDR）。
    assert.ok(code.includes('GPU_FRAME_ASPECT_TOL') && code.includes('"x-we-gpu-ar"'),
      'GPU 抓帧回填必须校验存帧视比（不符 → 清掉按当前视口重抓），行为级见 live-frame-backfill-smoke 的 G/H/I/J');

    // ⑤c 两条渐变链路的时长必须各自与常量同步（独立常量，不合并）：
    // - 轮换交叉淡化（.we-layer--fadein）= ROTATION_FADE_MS（1800ms）：两端都是
    //   静止画面，越长越柔顺；
    // - GPU 静帧 → live 首帧（.we-live-iframe）= LIVE_FIRST_FADE_MS（1800ms）：
    //   手动切换壁纸时「静帧 → 实时画面」的缓慢过渡正是这条腿。0.8s 短窗口
    //   实测过渡太急，按用户明确要求回到与轮换同口径的 1.8s。
    // 两个规则块的 transition 串相同，必须分别锚定断言。
    const liveIframeCss = code.match(/\.we-layer \.we-live-iframe\s*\{[^}]*\}/);
    const fadeinCss = code.match(/\.we-layer--fadein\s*\{[^}]*\}/);
    assert.ok(code.includes('ROTATION_FADE_MS = 1800') && code.includes('LIVE_FIRST_FADE_MS = 1800')
      && liveIframeCss && /transition:\s*opacity 1\.8s ease/.test(liveIframeCss[0])
      && fadeinCss && /transition:\s*opacity 1\.8s ease/.test(fadeinCss[0]),
      '渐变时长必须与常量同步（fadein=ROTATION_FADE_MS 1.8s / live 首帧=LIVE_FIRST_FADE_MS 1.8s），改常量时同步 CSS');

    // ⑥ 行为级不变量：整条流程（选中 → HEAD 探测 → 抓帧回填 → 清除 → 后续重建）
    // 里 animProbeSrcs 必须恒为 0 —— 一帧 CPU 动画渲染都不许启动（回退走静态帧链）。
    // 这条替代了原先「点帧率档位会启动 CPU 重渲染 / 关 beta场景动画按档位回退」的
    // 用例：那些开关与整条 CPU 渲染路线一起删了，留下的不变量是「不再有 CPU 渲染」。
    tree3 = renderPicker();
    assert.equal(animProbeSrcs.length, 0,
      'CPU 动画渲染已删除：全流程不得出现任何 /scene-anim 请求');
    console.log('CPU 动画渲染路线已删除（源码钉死 + 行为级零请求）: ok');

    // ── sceneVideo 诚实化的时序补拉 ────────────────────────────────────────
    // 宿主对 sceneVideo 改为「按 pkg 真探测」：未命中缓存时先给 null（不猜）并把探测
    // 投到后台，而客户端启动时那次 inventory 必然早于定论 ⇒ 必须有一次延迟补拉，
    // 否则真正内嵌 MP4 的场景首屏会掉到静态帧（本机实测 3/35 个场景）。
    {
      const before = inventoryCalls.length;
      const tick = rotationTimers.filter((t) => !t.cleared && t.ms === 3000);
      assert.ok(tick.length >= 1,
        '启动加载完 inventory 后必须安排一次 sceneVideo 时序补拉（3000ms 定时器）');
      for (const t of tick) { t.cleared = true; t.fn(); }
      await new Promise((r) => setTimeout(r, 40));
      assert.equal(inventoryCalls.length, before + 1,
        'sceneVideo 补拉必须真的重拉一次 inventory');
      assert.ok(!rotationTimers.some((t) => !t.cleared && t.ms === 3000),
        'sceneVideo 补拉只做一次：补拉自身不得再排定时器（否则变成轮询）');
      console.log('sceneVideo 时序补拉（一次 · 不自触发）: ok');
    }
  }
  console.log('effects ran:', effects.length);
  console.log('\nALL CLIENT CHECKS DONE');
}, 50);
