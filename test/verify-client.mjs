// Verify the emitted client bundle materializes + drives the DOM correctly
// under the DSH module-loader contract. Exercises apply(), syncLayers(), and
// confirms: wallpaper + scrim layers are `<body>` children (no shell.overlay),
// the four effect knobs (wallpaper blur/scrim/border/glass blur) push CSS
// variables, the picker renders, and automatic rotation is scoped to a
// user-defined rotation group (list) with its own interval.
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
// 剥注释：共享的字符串感知实现（test/tools/js-text.mjs）。
import { stripComments, stripExportBlocks } from './tools/js-text.mjs';
// 分支级"改了 store 却没通知"的分析与审计工具**同源**（避免两份判据分叉）。
import { pathNotifications } from './tools/branch-notify.mjs';

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
// 「关于」页签那行 star 数的请求计数（宿主路由 /star-count）：既判"切进去会问一次"，
// 也判"别的页签一次都不问"（TTL 内重复切回也不重问）。
const starCountCalls = [];
// CPU 动画渲染（scene-anim / APNG）的**反向**探针：本仓不提供那条路线，任何 <video>.src
// 指向 /scene-anim/<token> 都说明它被接了回来 —— 断言必须恒为空。
const animProbeSrcs = [];
// 同一个 src 赋值也记录**元素**：用于区分「探测视频」与「上屏的层内视频」
// （层内视频的 _parent 是 LAYER_ID 那个层节点）。
const animVideoEls = [];
const imgEls = [];
// 真 DOM 语义：`document.activeElement` 是**元素自己** `focus()` 的结果。焦点陷阱
// （trapModalTab）与模态框初始焦点（modalInitialFocus）都读它 ⇒ 挂载台必须真的实现，
// 否则这两条判据结构上不可达（同 pauseOnBlur 那次的修法：补语义，不把断言写弱）。
let activeEl = null;
function makeEl(tag) {
  return {
    tagName: tag.toUpperCase(),
    children: [],
    dataset: {},
    attributes: {},
    style: { _props: {}, setProperty(k, v) { this._props[k] = v; }, removeProperty(k) { delete this._props[k]; } },
    className: "",
    // 真 DOM 语义：className 与 classList 是同一份数据的两个视图（客户端两处都用 ——
    // 切层写过 className，复合成微推走 classList）。挂载台只实现 className 时，
    // classList 那一路会静默空转，断言也就无从下手。
    get classList() {
      const self = this;
      const parts = () => String(self.className || "").split(/\s+/).filter(Boolean);
      const write = (list) => { self.className = list.join(" "); };
      return {
        add(c) { const l = parts(); if (!l.includes(c)) l.push(c); write(l); },
        remove(c) { write(parts().filter((x) => x !== c)); },
        contains(c) { return parts().includes(c); },
      };
    },
    appendChild(c) { this.children.push(c); c._parent = this; if (c.id) byId[c.id] = c; return c; },
    remove() { if (this._parent) { const i = this._parent.children.indexOf(this); if (i >= 0) this._parent.children.splice(i, 1); } if (this.id) delete byId[this.id]; },
    setAttribute(k, v) { this.attributes[k] = v; },
    removeAttribute(k) { delete this.attributes[k]; },
    focus() { activeEl = this; },
    blur() { if (activeEl === this) activeEl = null; },
    querySelector(sel) { return null; },
  };
}

const bodyEl = makeEl("body");
activeEl = bodyEl;
const document = {
  get activeElement() { return activeEl; },
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
  // 画布兜底色写在**根元素**上（见 src/live-layer.js 的 writeUnderlayColor）——
  // 挂载台没有它时那条路会静默空转，判据变成恒真。
  documentElement: makeEl("html"),
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
// 库存加载失败的模拟开关（P3-11 0b：错误态 + 「重试」恢复的往返断言用）。与 `cccClearUnlinkFails`
// 同款：测试里翻它，然后走**真实**的重载路径（页签的「刷新」按钮 → onRefresh → loadInventory）。
let inventoryFails = false;
const inventoryCalls = []; // /inventory 请求次数（sceneVideo 时序补拉断言用）
// 首载期截取渲染（P3-11 尾账）：`!sel.loaded` 那条「扫描 Wallpaper Engine…」只在**库存应答
// 落定之前**可见，而本夹具的启动链是 await 过的 ⇒ 它在默认夹具里结构上不可达（当时如实记在
// 归档计划里，没有降级成打印）。这里给 `/inventory` 的**应答投递**加一个闸门：先挂住 →
// 渲染一次拿到首载态 → 放行 → 再渲染证明那个窗口真的关上了（只断言"看见了提示"可能只是
// 渲染函数恒返回同一棵树 ⇒ 三条断言一起空转）。
let releaseInventoryHold = null;
const inventoryHold = new Promise((resolve) => { releaseInventoryHold = resolve; });
const fetchNow = (url, opts) => {
  const u = String(url);
  const method = (opts && opts.method) || 'GET';
  if (u.includes('/wallpaper-engine/inventory')) {
    inventoryCalls.push(u);
    if (inventoryFails) {
      return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({ error: '测试用宿主故障' }) });
    }
  }
  // GPU 抓帧缓存的 HEAD 探测 / DELETE 清除（面板提示与清除入口）：
  // 场景 C（/scene-frame/ccc）假装缓存里已有 _gpu.png。
  if (method === 'HEAD') {
    sceneFrameHeadCalls.push(u);
    return Promise.resolve({
      ok: true, status: 204,
      headers: { get: (k) => {
        const key = String(k).toLowerCase();
        const pinned = u.includes('/scene-frame/ccc') && cccGpuPinned;
        if (key === 'x-we-gpu') return pinned ? '1' : '0';
        // 预览窗口要显示实时帧的像素尺寸（宿主从 PNG 的 IHDR 读）。
        if (key === 'x-we-gpu-w') return pinned ? '2488' : null;
        if (key === 'x-we-gpu-h') return pinned ? '1376' : null;
        if (key === 'x-we-gpu-ar') return pinned ? '1.8081' : null;
        return null;
      } },
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
  // CPU 动画渲染的进度端点：这里保留一个应答，用来**证明客户端从不请求它**
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
  // 「关于」页签的 star 数（宿主代取 GitHub 的那条路由）。**计数器是判据的一半**：
  // "别的页签一次都不发"要能被数出来（见下面关于页那段）。
  if (u.includes('/wallpaper-engine/star-count')) {
    starCountCalls.push(u);
    return Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({ ok: true, count: 428, fetchedAt: 1759290000000, stale: false }),
    });
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
      // schemeColor = 作者配色（宿主 inventory 的同一字段）：a 有值 ⇒ 画布兜底色必须落到
      // 根元素；b 是 WE 新建工程的默认值 0 0 0 ⇒ 视作"没填"，兜底色必须**不设**。
      { id: "a", title: "Video A", type: "video", playable: true, media: "/wallpaper-engine/media/xyz", preview: null, contentrating: "Everyone", schemeColor: "rgb(18, 52, 86)" },
      { id: "b", title: "Video B", type: "video", playable: true, media: "/wallpaper-engine/media/def", preview: null, contentrating: "Everyone", schemeColor: "rgb(0, 0, 0)" },
      { id: "c", title: "Scene C", type: "scene", playable: false, media: null, preview: "/wallpaper-engine/preview/ccc", frameUrl: "/wallpaper-engine/scene-frame/ccc", contentrating: "Everyone" },
      { id: "d", title: "Scene D (no frame)", type: "scene", playable: false, media: null, preview: null, frameUrl: null, contentrating: "Everyone" },
      // e is PG13 and must be excluded under the default Everyone filter.
      { id: "e", title: "PG13 E", type: "web", playable: true, media: "/wallpaper-engine/media/pg", preview: null, contentrating: "PG13" },
    ],
  }),
  });
};

// 闸门只挡**投递**（fetchNow 已经同步跑完 ⇒ `inventoryCalls` 照样记下这次请求），不挡请求发出。
const fetch = (url, opts) => {
  const res = fetchNow(url, opts);
  return String(url).includes('/wallpaper-engine/inventory') ? inventoryHold.then(() => res) : res;
};

// 变异测试钩子：默认读构建产物，DSH_MUT_LIB 指向变异副本时读它。
const code = readFileSync(process.env.DSH_MUT_LIB || new URL('../lib/client.js', import.meta.url), 'utf8');
const independentSidebarSelector = 'body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_panel"]';
const wallpaperGatedSidebarSelector = 'body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar]';
assert.ok(code.includes(independentSidebarSelector), 'sidebar glass must not require an active wallpaper');
assert.ok(!code.includes(wallpaperGatedSidebarSelector), 'legacy wallpaper-gated sidebar selector must be removed');
// ── 页面玻璃的门（用户报障：玻璃只在设了壁纸后才生效）────────────────────────────
// 口径：整页的玻璃令牌映射挂 **data-we-glass-page**（glass.js 恒挂：插件在跑就挂，
// 与有没有壁纸无关）；**data-we-wallpaper** 只剩"页面让开、露出壁纸层"那两条
// （bg-base / sidebar-fill 置透明）—— 壁纸不在场时那两条必须**不**生效，否则页面基色
// 会变透明（窗口底板透出来）。下面两条互为负对照：把映射锚回壁纸门 ⇒ 第一条红；
// 把让开那两条挪进页面玻璃块 ⇒ 第二条红。
const blockBodyOf = (needle) => {
  const i = code.indexOf(needle);
  if (i < 0) return null;
  const open = code.indexOf('{', i);
  const close = code.indexOf('}', open);
  return open < 0 || close < 0 ? null : code.slice(open + 1, close);
};
const pageGlassBlock = blockBodyOf('body[data-we-glass-page] {');
const wallpaperBlock = blockBodyOf('body[data-we-wallpaper] {');
assert.ok(pageGlassBlock && pageGlassBlock.includes('--dsw-alias-bg-layer-1')
  && pageGlassBlock.includes('--dsw-alias-markdown-code-block'),
  'page-glass token mapping must sit on body[data-we-glass-page] (glass works without a wallpaper)');
assert.ok(wallpaperBlock && wallpaperBlock.includes('--dsw-alias-bg-base: transparent')
  && !wallpaperBlock.includes('--dsw-alias-bg-layer-1'),
  'the page-let-the-wallpaper-through block stays wallpaper-only (no glass mapping inside)');
assert.ok(/setAttribute\("data-we-glass-page", "on"\)/.test(code)
  && /removeAttribute\("data-we-glass-page"\)/.test(code),
  'the page-glass anchor must be mounted by glass.js and removed by clearEffects (paired)');
assert.ok(code.includes('body[data-we-sidebar-glass] [data-dsh-better-sidebar] .cm-editor'),
  'sidebar content surfaces must follow the sidebar master switch',
);
assert.ok(code.includes('body[data-we-wallpaper] {') && code.includes('body[data-we-wallpaper]:not([data-ds-dark-theme])'),
  'wallpaper-only effects (base let-through, light-scheme text boost) must remain wallpaper-gated');
console.log('sidebar glass selectors are wallpaper-independent: true · page glass is anchored on data-we-glass-page: true');
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
// 事件监听表：客户端把未聚焦/遮挡与 ESC 处理器注册在 window/document 上。挂载台默认**没有**
// `addEventListener`，加上它（纯追加、不影响既有断言）才能让"注册了没有 / 派发后行为"可判。
// 注意处理器本身注册在 `useEffect` 里，而 mock React 的 `useEffect` 是空实现 ⇒ 需要那类断言的
// 用例要**临时**把它换成收集器（见 ESC 那段），跑完立刻还原。
const winListeners = {};
const docListeners = {};
const addListenerTo = (reg) => (ev, fn) => { (reg[ev] ||= []).push(fn); };
const removeListenerFrom = (reg) => (ev, fn) => {
  const a = reg[ev]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
};
sandbox.window.addEventListener = addListenerTo(winListeners);
sandbox.window.removeEventListener = removeListenerFrom(winListeners);
document.addEventListener = addListenerTo(docListeners);
document.removeEventListener = removeListenerFrom(docListeners);

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
// 侧栏官方档（2026-10-09 字体节 / 玻璃高级行迁入侧栏后，它们的行为断言必须打在
// **侧栏 body 渲染台**上）：给 installSidebarRight 需要的两个可选服务桩 ——
// register 返回 disposer、openTab 空转即可；其余服务名（locale / theme / shortcuts）
// 一律 null ⇒ 各轮询路径停在第一次尝试（不 fire 它们的 250ms 定时器就不动）。
const sidebarRightTabsStub = { register: () => () => {} };
const sidebarRightStub = { openTab: () => {} };
const ctx = {
  slots,
  effect(fn) { effects.push(fn); fn(); return fn; },
  get: (name) => (name === 'sidebarRightTabs' ? sidebarRightTabsStub
    : name === 'sidebarRight' ? sidebarRightStub : null),
};

// apply(ctx) 在这个夹具里必须跑通：ctx 已提供 slots / effect / document / fetch，任何抛出都会
// 让后面的注册与层断言在"什么都没挂上"的空跑上继续绿下去（throw 只打印的话仍然 exit 0）。
let thrown = null;
try { exportsObj.apply(ctx); } catch (e) { thrown = (e && (e.stack || e.message)) || String(e); }
assert.equal(thrown, null, 'apply(ctx) 不得抛（夹具已给 slots/effect/document/fetch）：' + thrown);
console.log('apply threw: (none)');
console.log('slot registrations:', JSON.stringify(registrations));

const sectionReg = registrations.find((r) => r.key === 'settings.section');
console.log('registered as first-level settings.section:', !!sectionReg);
console.log('section id:', sectionReg ? sectionReg.id : '(missing)');
console.log('section label:', sectionReg ? sectionReg.label : '(missing)');
assert.ok(!registrations.some((r) => r.key === 'settings.general.item'), 'no longer registered as general item:');

setTimeout(async () => {
  console.log('body children ids:', JSON.stringify(bodyEl.children.map((c) => c.id)));
  console.log('has wallpaper layer:', !!document.getElementById('dsh-wallpaper-engine-layer'));
  console.log('has scrim:', !!document.getElementById('dsh-wallpaper-engine-scrim'));
  console.log('body[data-we-wallpaper]:', JSON.stringify(bodyEl.attributes['data-we-wallpaper']));
  const p = bodyEl.style._props;
  console.log('--we-scrim-color:', JSON.stringify(p['--we-scrim-color']));
  console.log('--we-border-alpha:', JSON.stringify(p['--we-border-alpha']));
  console.log('--we-blur:', JSON.stringify(p['--we-blur']));
  console.log('--we-wallpaper-opacity (default 0% → unset):', JSON.stringify(p['--we-wallpaper-opacity']));
  assert.equal(p['--we-wallpaper-opacity'], undefined, 'wallpaper opacity must stay untouched by default (no identity-opacity compositing layer)');
  console.log('--we-accent:', JSON.stringify(p['--we-accent']));
  console.log('--we-glass-alpha:', JSON.stringify(p['--we-glass-alpha']));
  console.log('--we-glass-color:', JSON.stringify(p['--we-glass-color']));
  console.log('body[data-we-glass-window] (default on):', JSON.stringify(bodyEl.attributes['data-we-glass-window']));

  // ── P3-11 尾账：首载期「扫描 Wallpaper Engine…」的截取渲染 ────────────────────
  // 判据只定义一次，正/负对照共用（形态规则见 docs/DEV-GUIDE.md §4.7 约定 5）。
  const startupState = (root) => {
    const out = { hints: [], cards: 0, hasPickTrigger: false, errors: [] };
    (function walk(node) {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (!node || typeof node !== 'object') return;
      const cls = typeof node.props?.className === 'string' ? node.props.className.split(/\s+/).filter(Boolean) : [];
      if (cls.includes('we-picker__card')) out.cards++;
      if (cls.includes('we-picker__error')) out.errors.push(String((node.children || [])[0] || ''));
      if (Array.isArray(node.children)) {
        if (cls.includes('we-picker__hint')) out.hints = out.hints.concat(node.children.filter((c) => typeof c === 'string'));
        if (node.children.includes('选择壁纸')) out.hasPickTrigger = true;
        node.children.forEach(walk);
      }
    })(root);
    return out;
  };
  const atStartup = startupState(pickerRenders[0]());
  assert.ok(atStartup.hints.includes('扫描 Wallpaper Engine…'),
    '库存应答落定之前必须渲染首载提示（当前 ' + JSON.stringify(atStartup.hints) + '）');
  assert.equal(atStartup.cards, 0, '首载期不得渲染壁纸卡片（当前 ' + atStartup.cards + ' 张）');
  assert.equal(atStartup.errors.length, 0, '首载期不得显示错误态（当前 ' + JSON.stringify(atStartup.errors) + '）');
  assert.equal(atStartup.hasPickTrigger, false, '首载期不得出现「选择壁纸」入口（出现即说明库存已经算完）');
  console.log('  ✓ 首载态：库存应答挂起时只渲染扫描提示');
  // 窗口真的关上：放行应答后**同一条判据**必须给出不同的答案 —— 否则"看见了首载态"可能只是
  // 渲染函数恒返回同一棵树（上面四条一起空转）。
  releaseInventoryHold();
  await new Promise((r) => setTimeout(r, 80));
  const afterBoot = startupState(pickerRenders[0]());
  // 只判**那句文案**：`we-picker__hint` 落定后在别处还有 9 个（页签提示等），
  // 拿"hint 总数为 0"当判据会把它们一起算进来 ⇒ 判据与首载态就不是同一件事了。
  assert.ok(!afterBoot.hints.includes('扫描 Wallpaper Engine…'), '库存落定后首载提示必须消失');
  assert.ok(afterBoot.hasPickTrigger, '库存落定后必须出现「选择壁纸」入口（这是窗口关上的证据）');
  console.log('  ✓ 首载态：应答放行后提示消失、入口出现');
  // 负对照：把**变异输入**喂进同一条判据
  const synthStartup = (classes, text) => ({ props: { className: classes }, children: [text] });
  assert.equal(startupState(synthStartup('we-picker__hint', '扫描 Wallpaper Engine…')).hints.length, 1,
    '负对照：判据必须认得首载提示');
  assert.equal(startupState(synthStartup('we-picker__card', 'x')).cards, 1,
    '负对照：判据必须数得出卡片');
  assert.equal(startupState(synthStartup('we-picker__error', '未检测到 Wallpaper Engine：x')).errors.length, 1,
    '负对照：判据必须认得错误态');
  assert.equal(startupState({ props: { className: 'we-picker' }, children: ['选择壁纸'] }).hasPickTrigger, true,
    '负对照：判据必须认得「选择壁纸」入口');

  // ── 画布兜底色（--we-wallpaper-underlay）────────────────────────────────────
  // 不变量：壁纸激活期间**根元素**带着一个不透明的壁纸代表色。它存在的理由是窗口 /
  // 标签页状态切换（最小化 → 任务栏缩略图 → 还原）时合成器可能拿不到壁纸层的像素，
  // 而页面自己若不画任何东西，露出的就是窗口底板 / 宿主 body 的纯白兜底。
  // 这里判行为侧：作者配色落到根元素（正）；作者填的 0 0 0 视作"没填" ⇒ 不设（负，在
  // 轮换一节里）。**载体必须是 html** 这条是样式表结构判据，落在 test/verify-readability.mjs 的 F6。
  {
    const rootProps = document.documentElement.style._props;
    console.log('--we-wallpaper-underlay:', JSON.stringify(rootProps['--we-wallpaper-underlay']));
    assert.equal(rootProps['--we-wallpaper-underlay'], 'rgb(18, 52, 86)',
      '作者配色必须在壁纸激活期间落到根元素（画布兜底色）');
  }

  // ── 可见性恢复：一次性复合成微推 ────────────────────────────────────────────
  // 只在"隐藏 → 可见"这一个方向动层：普通 focus（用户点回窗口）不得触发 —— 否则每次点
  // 窗口都要动一次层。三条一起判：正（恢复可见 ⇒ 加上 + 下一拍撤掉）、两条负对照
  //（隐藏态不触发 / focus 不触发）。
  {
    const fireDoc = (type) => { for (const fn of (docListeners[type] || [])) fn(); };
    const fireWin = (type) => { for (const fn of (winListeners[type] || [])) fn(); };
    const node = document.getElementById('dsh-wallpaper-engine-layer');
    assert.ok(node, '微推断言需要屏上有一个壁纸层');
    const repaintTimers = () => rotationTimers.filter((t) => !t.cleared && !t.fired && t.ms === 32);
    const before = repaintTimers().length;
    document.hidden = false;
    fireDoc('visibilitychange');
    assert.ok(node.classList.contains('we-layer--repaint'),
      '恢复可见必须给壁纸层加一次性的复合成微推类');
    const timers = repaintTimers();
    assert.equal(timers.length, before + 1, '微推必须安排在下一拍撤掉（否则留下常驻合成层）');
    timers[timers.length - 1].fired = true;
    timers[timers.length - 1].fn();
    assert.ok(!node.classList.contains('we-layer--repaint'), '下一拍必须撤掉微推类');
    document.hidden = true;
    fireDoc('visibilitychange');
    assert.ok(!node.classList.contains('we-layer--repaint'), '负对照：还在隐藏态时不得触发微推');
    document.hidden = false;
    const idle = repaintTimers().length;
    fireWin('focus');
    assert.ok(!node.classList.contains('we-layer--repaint') && repaintTimers().length === idle,
      '负对照：普通 focus（点回窗口）不得触发微推');
  }

  // ── 轮换「就绪后切换 + 渐变」断言 ─────────────────────────────────
  // mock 环境无 addEventListener/Image → 准备管线特性探测失败即同步直通提交。
  // 按 5 分钟（300000ms）定位真正的轮换定时器，绕开 persist 防抖的 200ms
  // 定时器；提交结果同步看新层 dataset.weKey（含 selection.url），持久化
  // 需再手动 flush 200ms 的 persist 写。
  // 断言走 assert.ok：任何一条不成立 → 非零退出（只 console.log 的话，把轮换打回
  // 元素级领养也能 exit 0）。
  const rotCheck = (label, cond) => { assert.ok(cond, label); console.log('  ✓ ' + label); };
  const flushPersistWrites = () => {
    for (const t of rotationTimers.filter((item) => !item.cleared && !item.fired && item.ms === 200)) {
      t.fired = true;
      try { t.fn(); } catch (e) { console.log('persist flush threw:', e && e.message); }
    }
  };
  const findRotTimer = () => rotationTimers.find((item) => !item.cleared && !item.fired && item.ms === 5 * 60 * 1000);
  const fireRot = (t) => { t.fired = true; t.fn(); };
  // 切换过场（#112）：默认是「硬切」，所以下面这组轮换断言先经 UI 选成
  // 「交叉淡化」才有过渡路径；硬切与动画型过场各有专门断言（见本节末尾）。
  const findAriaBtn = (label) => {
    const tree = pickerRenders[0]();
    let hit = null;
    (function walk(node) {
      if (hit || !node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node.props && node.props['aria-label'] === label) { hit = node; return; }
      if (Array.isArray(node.children)) node.children.forEach(walk);
    })(tree);
    return hit;
  };
  // 过场动画是**下拉菜单**（过场会持续增加，平铺按钮迟早挤爆）——
  // 断言集中在「选项集合 + 选中值驱动」两件事上，新增过场只需扩这张表。
  const TRANSITION_IDS = { 硬切: 'cut', 交叉淡化: 'fade', 推移: 'push', 擦除: 'wipe', 光圈: 'iris', 缩放: 'zoom', 条带: 'bars' };
  const findTransitionSelect = () => findAriaBtn('过场动画');
  const pickTransition = (label) => {
    const el = findTransitionSelect();
    assert.ok(el, '「过场动画」下拉必须存在');
    const id = TRANSITION_IDS[label];
    assert.ok(id, '测试用的过场名必须在这张表里：' + label);
    assert.ok(Array.isArray(el.children) && el.children.some((o) => o && o.props && o.props.value === id),
      '下拉里必须有这个过场选项：' + label);
    el.props.onChange({ target: { value: id } });
  };
  const preLayer = document.getElementById('dsh-wallpaper-engine-layer');
  const rotTimer = findRotTimer();
  rotCheck('rotation timer scheduled (5min)', !!rotTimer);
  rotCheck('切换过场 renders a dropdown with all seven transitions',
    (() => {
      const el = findTransitionSelect();
      if (!el || el.type !== 'select' || !Array.isArray(el.children)) return false;
      const ids = el.children.map((o) => o.props && o.props.value);
      const labels = el.children.map((o) => (o.children || [])[0]);
      return Object.keys(TRANSITION_IDS).length === ids.length
        && Object.values(TRANSITION_IDS).every((v) => ids.includes(v))
        && Object.keys(TRANSITION_IDS).every((l) => labels.includes(l))
        && el.props.value === 'cut'; // 默认硬切
    })());
  rotCheck('默认过场是硬切（未设置时）',
    JSON.parse(localStorage._store['dsh-wallpaper-engine:selection'] || '{}').switchTransition === undefined
      || JSON.parse(localStorage._store['dsh-wallpaper-engine:selection'] || '{}').switchTransition === 'cut');
  pickTransition('交叉淡化');
  if (rotTimer) {
    fireRot(rotTimer); // a → b（直通提交）
    const postLayer = document.getElementById('dsh-wallpaper-engine-layer');
    const weKey1 = postLayer && postLayer.dataset ? postLayer.dataset.weKey : '';
    rotCheck('rotation prepare: ready-commit switches layer to next (b/media/def)',
      !!postLayer && postLayer !== preLayer && weKey1.indexOf('/wallpaper-engine/media/def') !== -1);
    rotCheck('rotation fade: old layer marked weFading', !!preLayer && preLayer.dataset.weFading === '1');
    rotCheck('rotation fade: old layer yielded LAYER_ID', !!preLayer && preLayer.id === '');
    // 画布兜底色的负对照：换到 b（作者配色是 WE 新建工程的默认值 0 0 0 ⇒ 视作"没填"）之后，
    // 根元素**不得**继续带着上一张壁纸的颜色 —— 否则"照用纯黑"这条会静默把一张亮壁纸钉成黑底。
    rotCheck('画布兜底色：换到「颜色未填」的壁纸后根元素不再保留上一张的颜色',
      document.documentElement.style._props['--we-wallpaper-underlay'] === undefined);
    rotCheck('rotation fade: new layer carries the switch classes', !!postLayer
      && postLayer.className.indexOf('we-layer--switch') !== -1);
    rotCheck('rotation fade: 交叉淡化基准 = ROTATION_FADE_MS (1800ms)', !!postLayer
      && postLayer.style._props['--we-switch-ms'] === '1800ms');
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
      rotCheck('rotation fade: second switch also animates', !!layer2
        && layer2.className.indexOf('we-layer--switch') !== -1);
      rotCheck('rotation fade: previous fading layer retired immediately',
        bodyEl.children.indexOf(preLayer) === -1);
      flushPersistWrites();
      // ── 动画型过场：推移（方向默认左）+ 旧层同时退场 ──
      pickTransition('推移');
      const pushTimer = findRotTimer();
      rotCheck('rotation timer re-armed for the 推移 case', !!pushTimer);
      if (pushTimer) {
        const beforePush = document.getElementById('dsh-wallpaper-engine-layer');
        fireRot(pushTimer);
        const pushLayer = document.getElementById('dsh-wallpaper-engine-layer');
        rotCheck('推移：新层带 switch 类（入场层走通用 transition）', !!pushLayer
          && pushLayer !== beforePush
          && pushLayer.className.indexOf('we-layer--switch') !== -1);
        rotCheck('推移：基准 700ms 写入 --we-switch-ms', !!pushLayer
          && pushLayer.style._props['--we-switch-ms'] === '700ms');
        rotCheck('推移：新层终态回到 translate3d(0,0,0)', !!pushLayer
          && pushLayer.style.transform === 'translate3d(0, 0, 0)');
        rotCheck('推移：旧层同时位移出场并被压到新层之下', !!beforePush
          && beforePush.className.indexOf('we-layer--switch-out') !== -1
          && beforePush.style.transform === 'translate3d(-100%, 0, 0)'
          && beforePush.style.zIndex === '-3');
        // 收尾：过场结束必须把新层的临时样式清干净（否则满屏视频永久占合成层）。
        const cleanup = rotationTimers.find((t) => !t.cleared && !t.fired && t.ms === 760);
        rotCheck('推移：过场结束后清理定时器已排（ms+60）', !!cleanup);
        if (cleanup) {
          cleanup.fired = true; cleanup.fn();
          rotCheck('推移：收尾后新层回到干净的 we-layer（内联样式清空）',
            pushLayer.className === 'we-layer'
            && pushLayer.style.transform === '' && pushLayer.style.clipPath === ''
            && pushLayer.style._props['--we-switch-ms'] === undefined);
        }
        flushPersistWrites();
        // ── 条带（百叶窗）：终态必须是满屏矩形，且 N 块板都从进入侧（右侧）长出来 ──
        // 两个易错点都在终态里可判：① 方向反了 → 封闭边/板会跑到左侧；
        // ② 退回「锯齿扫过」那版（板塌成一条直边、与擦除无异）→ N 块板的深度点消失。
        pickTransition('条带');
        const barsTimer = findRotTimer();
        rotCheck('rotation timer re-armed for the 条带 case', !!barsTimer);
        if (barsTimer) {
          fireRot(barsTimer);
          const barsLayer = document.getElementById('dsh-wallpaper-engine-layer');
          const clip = barsLayer ? barsLayer.style.clipPath : '';
          rotCheck('条带：终态覆盖满屏且封闭边在右侧（方向 left）',
            !!clip && clip.indexOf('polygon(100.00% 0.00%') === 0
            && clip.indexOf('0.00% 0.00%') !== -1
            && clip.indexOf('100.00% 100.00%') !== -1);
          // 板数从产物里读，断言按 4N+1 算 —— 改板数不会误报，但**几何退回
          // 「锯齿扫过」那版**（点数公式不同）会翻红。
          const barsN = Number((code.match(/const SWITCH_BARS_TEETH = (\d+)/) || [])[1]);
          rotCheck('条带：N 块板的深度点都在（百叶窗，不是锯齿擦除）—— 点数 = 4N+1',
            !!clip && barsN >= 2 && (clip.match(/%/g) || []).length / 2 === 4 * barsN + 1);
          // 中段「板 + 缝」的几何在下面的单元级断言里直接算产物函数验证（终态看不出）。
          flushPersistWrites();
          // ── 硬切：默认值，旧层立即拆除、不排任何过场 ──
        pickTransition('硬切');
        const cutTimer = findRotTimer();
        rotCheck('rotation timer re-armed for the 硬切 case', !!cutTimer);
        if (cutTimer) {
          const beforeCut = document.getElementById('dsh-wallpaper-engine-layer');
          fireRot(cutTimer);
          const cutLayer = document.getElementById('dsh-wallpaper-engine-layer');
          rotCheck('硬切：旧层立即拆除（不进过渡路径）', !!beforeCut
            && bodyEl.children.indexOf(beforeCut) === -1);
          rotCheck('硬切：新层没有任何 switch 类或临时样式', !!cutLayer
            && cutLayer !== beforeCut
            && cutLayer.className.indexOf('we-layer--switch') === -1
            && cutLayer.style.transform === undefined
            && cutLayer.dataset.weFading === undefined);
          flushPersistWrites();
          // 下面的「手动点选也必须过渡」回归断言走的是交叉淡化这条腿
          // （历史 bug：只有轮换 commit 才淡、手动点选硬切），这里把过场选回去。
          pickTransition('交叉淡化');
        }
      }
      }
    }
  }
  assert.ok(pickerRenders.length > 0, 'picker 至少被渲染一次');
  if (pickerRenders.length) {
    // ── Tabbed IA: the picker splits into six tabs (壁纸/外观/吉祥物/效果/声音/
    //    高级 —— 「字体」已并入「外观」). Each WallpaperPicker instance keeps its
    //    active tab in localStorage; mock React's useState returns the initializer
    //    value, so re-seeding the key + re-rendering switches tabs deterministically. ──
    const TAB_KEY = 'dsh-wallpaper-engine:picker-tab';
    const setTab = (id) => localStorage.setItem(TAB_KEY, id);
    const renderPicker = () => {
      try { return pickerRenders[0](); } catch (e) { console.log('picker render threw:', e && e.message); return null; }
    };
    // ── 侧栏 body 渲染台（2026-10-09 字体节 / 玻璃高级行迁入侧栏后的行为断言落点）──
    // 注册路径真跑（installSidebarRight 经 ctx.get 桩拿到两个可选服务）⇒ registrations
    // 里 `sidebar.right.pane.tab` 与 pickerRenders **同一次 register 推入** ⇒ 按 key 定位。
    // 页签与两块折叠块的展开态都住 localStorage（qp-tab / qp-font-open / qp-glass-detail，
    // 同"仅 UI 状态不进 config.json"口径）⇒ 渲染前播种，渲染即为「外观页 · 两块展开」。
    const renderSidePane = () => {
      localStorage.setItem('dsh-wallpaper-engine:qp-tab', 'appearance');
      localStorage.setItem('dsh-wallpaper-engine:qp-font-open', '1');
      localStorage.setItem('dsh-wallpaper-engine:qp-glass-detail', '1');
      const i = registrations.findIndex((r) => r.key === 'sidebar.right.pane.tab');
      assert.ok(i >= 0 && i < pickerRenders.length,
        '侧栏 body 必须已注册（installSidebarRight 真跑 —— ctx.get 桩缺了先红这里）');
      try { return pickerRenders[i](); } catch (e) { console.log('sidebar render threw:', e && e.message); return null; }
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
    // 下限（可负的滑块要用它）：`"min":"-400"` —— 负号必须一起判，否则"范围丢了负半边"
    // 这种回归在只判 max 的断言下完全看不见（位置偏移就是第一个可负的滑块）。
    const sliderMin = (row) => (row ? JSON.stringify(row).match(/"min":"(-?\d+)"/)?.[1] : null);
    const findRangeInput = (row) =>
      (Array.isArray(row?.children) ? row.children : [])
        .find((c) => c && typeof c === 'object' && c.type === 'input');

    // ── 壁纸库 tab (default): card head + tab bar + wallpaper controls. ──
    localStorage.removeItem(TAB_KEY);
    let tree = renderPicker();
    let treeText = JSON.stringify(tree);
    assert.ok(countMatches(tree, /"role":"tab"/g) === 6, 'tab bar renders (6 tabs):');
    assert.ok(treeText.includes('"we-tabs__tab we-tabs__tab--active"') && treeText.includes('自动轮播'), 'default tab is 壁纸库:');
    assert.ok(treeText.includes('"选择壁纸"'), 'library tab has 选择壁纸:');
    assert.ok(treeText.includes('自定义壁纸'), 'library tab has 自定义壁纸:');
    console.log('other tabs keep their controls out of the tree:',
      !treeText.includes('玻璃透明度') && !treeText.includes('字体自定义') && !treeText.includes('吉祥物大小'));

    // ── 设置页签重组（UI 重构）：六个页签 = 壁纸库 / 外观 / 播放 / 系统 / 扩展 / 关于 ──
    //    原六页签合并：壁纸 → 壁纸库；效果+声音 → 播放；吉祥物+高级 → 系统；外观原样；
    //    「扩展」是后加的**模块容器**（注册表在 src/panel-tabs.js 的 extensionModules()，
    //    排在「关于」之前）；「关于」是后加的静态页（**排在最后**，唯一不读面板状态的那个）。
    {
      const tabButtons = [];
      (function walk(node) {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (node.props && node.props.role === 'tab') tabButtons.push(node);
        if (Array.isArray(node.children)) node.children.forEach(walk);
      })(tree);
      const labels = tabButtons.map((b) => String((b.children || [])[0] || ''));
      assert.deepEqual(labels, ['壁纸库', '外观', '播放', '系统', '扩展', '关于'],
        'tab bar must render exactly 壁纸库/外观/播放/系统/扩展/关于');
      // 指示胶囊的宽度按页签数现算 —— 加/减页签忘改这里会当场错位（且只在视觉上错）。
      assert.ok(JSON.stringify(tree).includes('calc((100% - 6px) / 6)'),
        'tab pill width must be derived from PICKER_TABS.length (6)');
    }

    // ── 「扩展」页签（第六个）：一个**模块容器** —— 表里没模块时只画空态 ──
    //    它的价值在"容器还在、模块真的按注册表上架、且没跟别的页签串内容"：后续功能都只往
    //    src/panel-tabs.js 的 extensionModules() 里加一项，页签本身不该再改。
    //    现有三项：一号 = 自定义会话头像，二号 = 点击效果与拖尾效果，
    //    三号 = 3D 效果（三张卡共用本块）。
    {
      setTab('extensions');
      const extTree = renderPicker();
      const extText = JSON.stringify(extTree);
      // 容器 + 三个模块的标题与总开关都得在。
      for (const anchorText of ['扩展模块', '自定义会话头像', '启用自定义会话头像',
        '点击效果与拖尾效果', '启用点击与拖尾效果', '3D 效果', '启用 3D 效果']) {
        assert.ok(extText.includes(anchorText), '「扩展」页签必须包含「' + anchorText + '」');
      }
      // 模块槽位的类名必须真的在树上（CSS 段与渲染器对不上是肉眼可见的回归）。
      assert.ok(extText.includes('"we-ext"') && extText.includes('"we-ext__module"'),
        '「扩展」页签必须画出模块容器 we-ext 与模块卡 we-ext__module');
      // 注册表**非空** ⇒ 空态不该再画（两者是互斥形态，留着会让用户以为没装上）。
      assert.ok(!extText.includes('还没有可用的扩展模块'), '注册表非空时不得再画空态');
      // 三条注册表项 ⇒ 恰好三张模块卡（漏一个模块、或把别的东西当模块画进去都会现形）。
      assert.equal((extText.match(/"we-ext__module"/g) || []).length, 3,
        '注册表里三项 ⇒ 「扩展」页签必须画出三张模块卡');
      // **顺序即屏上顺序**（用户口径：会话头像那一项排在**第一**）：卡标题在渲染树里的首次
      // 出现下标必须按注册表顺序递增 —— 只判"都在"会让"新模块被排到末尾"这类回归悄悄通过。
      {
        const order = ['自定义会话头像', '点击效果与拖尾效果', '3D 效果']
          .map((t) => extText.indexOf('"' + t + '"'));
        assert.ok(order.every((i) => i >= 0) && order.every((i, k) => k === 0 || i > order[k - 1]),
          '三张模块卡必须按注册表顺序排列（头像第一）：' + JSON.stringify(order));
      }
      // 2026-10-04 用户口径：扩展模块的出厂开关**全部默认关、按需开启** ⇒ 三个模块的
      // 参数控件默认一律不画，否则会给人"关着也生效"的错觉；三条同时钉住默认值没被误改成 true。
      assert.ok(!extText.includes('头像大小') && !extText.includes('圆角强度'),
        '一号模块（自定义会话头像）总开关默认关 ⇒ 不得画出参数控件');
      assert.ok(!extText.includes('点击样式') && !extText.includes('拖尾光晕'),
        '二号模块（点击效果与拖尾效果）总开关关闭时不得画出任何参数控件');
      assert.ok(!extText.includes('背景缓动距离') && !extText.includes('缓动平滑'),
        '三号模块（3D 效果）总开关关闭时不得画出任何参数控件');
      // ── 一号模块（自定义会话头像）：默认关 ⇒ 只画总开关 + 说明；开了才长两方各一行
      //    （头像 + 昵称）与两个滑块 ──
      //    装饰本体（往宿主的消息行里补头像节点）在无头环境看不见 ⇒ 岛这一侧的判据盯
      //    "控件按开关长/收 + 两个滑块的量程是 schema 那一对 + 昵称真的接上了处理器"，
      //    屏上那半边由 verify-scene-live 的源码/样式段判据钉住。
      const avOn = findCtlInput(extTree, '启用自定义会话头像');
      assert.ok(avOn, '一号模块必须画出总开关（findCtlInput 能取到它的 onChange）');
      assert.equal(avOn && avOn.props.checked, false, '一号模块（头像）的总开关默认必须是关的');
      if (avOn) {
        avOn.props.onChange({ target: { checked: true } });
        flushPersistWrites();
        const avTree = renderPicker();
        const avText = JSON.stringify(avTree);
        for (const t of ['「我」的头像', '你的消息在右侧，头像跟着在右侧',
          '「助手」的头像', '助手的消息在左侧，头像跟着在左侧',
          '导入图片…', '头像大小', '圆角强度']) {
          assert.ok(avText.includes(t), '打开一号模块后「扩展」页签必须有「' + t + '」');
        }
        // 另三个模块的参数**不得**因为头像开着而出现（四张卡各管各的）。
        assert.ok(!avText.includes('点击样式') && !avText.includes('拖尾粗细') && !avText.includes('缓动平滑'),
          '另两个模块关着时，一号模块开着也不该画出它们的参数');
        // 两个滑块的量程必须与 lib/settings-schema.js 的 AVATAR_SIZE_* / AVATAR_RADIUS_* 一致。
        assert.equal(sliderMin(findSliderRow(avTree, '头像大小')), '24', '头像大小下限必须是 24px');
        assert.equal(sliderMax(findSliderRow(avTree, '头像大小')), '72', '头像大小上限必须是 72px');
        assert.equal(sliderMin(findSliderRow(avTree, '圆角强度')), '0', '圆角强度下限必须是 0%');
        assert.equal(sliderMax(findSliderRow(avTree, '圆角强度')), '100', '圆角强度上限必须是 100%');
        // 默认回显：40px / 100%（默认正圆是用户口径的一部分 —— 改默认值即改观感）。
        const avReadoutOf = (labelText) => {
          const row = findSliderRow(avTree, labelText);
          if (!row) return null;
          const hits = (row.children || []).filter((c) =>
            typeof c?.props?.className === 'string' && c.props.className.includes('we-picker__value'));
          return hits.length === 1 ? String((hits[0].children || [])[0] ?? '') : null;
        };
        assert.equal(avReadoutOf('头像大小'), '40px', '头像大小默认必须是 40px');
        assert.equal(avReadoutOf('圆角强度'), '100%', '圆角强度默认必须是 100%（正圆）');
        // 两方各一个「导入图片…」（没设置过图片时不该出现「清除」按钮）。
        assert.equal((avText.match(/导入图片…/g) || []).length, 2, '两方各一个「导入图片…」按钮');
        assert.ok(!avText.includes('清除'), '没导入过图片时不该画「清除」按钮');
        // ⚠️ **没有昵称**（用户口径：加了昵称太丑，整体移除）：这一页不该再出现昵称输入。
        assert.ok(!avText.includes('昵称'), '昵称已按用户口径移除，页签里不得再出现它');
        // 复位：总开关关掉（后续判据要的是"默认态"）。
        // 复位：总开关关掉（后续判据要的是"默认态"），昵称也清回去。
        const avOff = findCtlInput(renderPicker(), '启用自定义会话头像');
        if (avOff) avOff.props.onChange({ target: { checked: false } });
        flushPersistWrites();
        assert.ok(!JSON.stringify(renderPicker()).includes('头像大小'),
          '关掉一号模块总开关后它那一串参数必须收起来');
      }
      // 导入/清除的**失败文案**必须能把"宿主没重挂"这件事说出来（用户实测：改了宿主代码、
      // 只等客户端 HMR ⇒ 导入报「宿主返回 405」，而那个 405 其实是 SPA 兜底对 POST 的答复）。
      // 判据落在 `assetRouteFailure` 的裸 404/405 判别与那句文案上（与字体集/系统字体同口径，
      // 头像与立绘共用同一条腿 —— 文案里的 `{what}` 由调用点给），并要求请求走 `parse: "always"`
      //（否则非 2xx 的信封读不到，永远只剩裸状态码）。
      {
        const clientSrcForAvatar = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');
        assert.ok(/function assetRouteFailure\(res, what\)/.test(clientSrcForAvatar)
          && /res\.status === 404 \|\| res\.status === 405/.test(clientSrcForAvatar)
          && clientSrcForAvatar.includes('宿主里没有{what}路由：重启 DSH 后再试')
          && /postImageAsset\("\/avatar\/" \+ side, img\.blob, weT\("头像"\)\)/.test(clientSrcForAvatar)
          && /postImageAsset\("\/mascot", img\.blob, weT\("立绘"\)\)/.test(clientSrcForAvatar)
          && (clientSrcForAvatar.match(/parse: "always"/g) || []).length >= 1,
          '用户资产路由的失败文案必须区分"宿主里没有这条路由"（裸 404/405 ⇒ 提示重启 DSH）');
      }
      // ── 二号模块（点击效果与拖尾效果）：默认关 ⇒ 只画总开关 + 说明；开了才长参数 ──
      //    它与一/三号模块共用一个页签，判据的重点是"三张卡各自独立"：别的模块的参数不该
      //    在本模块的开关下长出来，反之亦然；两个子开关（点击 / 拖尾）关掉时只收起自己那一串。
      const fxOn = findCtlInput(extTree, '启用点击与拖尾效果');
      assert.ok(fxOn, '二号模块必须画出总开关（findCtlInput 能取到它的 onChange）');
      if (fxOn) {
        fxOn.props.onChange({ target: { checked: true } });
        flushPersistWrites();
        const fxTree = renderPicker();
        const fxText = JSON.stringify(fxTree);
        for (const t of ['点击效果', '在点击处炸开一圈光效', '点击样式', '点击时炸开的样子',
          '涟漪', '从点击处扩散的圆环', '星火', '向四周飞散的亮点', '两者', '圆环与星火一起',
          '半径', '点击光晕',
          '拖尾效果', '光标划过时留下会淡出的轨迹', '拖尾样式', '轨迹的样子',
          '彗尾', '一条渐隐的光带', '星尘', '留在原地的亮点',
          '拖尾时长', '拖尾粗细', '拖尾光晕', '不透明度', '混合模式',
          '正常', '正片叠底', '叠加', '滤色', '变亮',
          '效果配色', '跟随主题色', '彩虹', '自定义']) {
          assert.ok(fxText.includes(t), '打开二号模块后「扩展」页签必须有「' + t + '」');
        }
        // 另两个模块的参数**不得**因为二号模块开着而出现（三张卡各管各的）。
        assert.ok(!fxText.includes('头像大小') && !fxText.includes('背景缓动距离'),
          '另两个模块关着时，二号模块开着也不该画出它们的参数');
        // 滑块范围必须与 lib/settings-schema.js 的 KINDS 一致（改范围要同时改两处）。
        assert.equal(sliderMin(findSliderRow(fxTree, '半径')), '40', '点击半径下限必须是 40px');
        assert.equal(sliderMax(findSliderRow(fxTree, '半径')), '400', '点击半径上限必须是 400px');
        assert.equal(sliderMax(findSliderRow(fxTree, '点击光晕')), '100', '点击光晕上限必须是 100%');
        assert.equal(sliderMin(findSliderRow(fxTree, '拖尾时长')), '80', '拖尾时长下限必须是 80ms');
        assert.equal(sliderMax(findSliderRow(fxTree, '拖尾时长')), '2000', '拖尾时长上限必须是 2000ms');
        assert.equal(sliderMin(findSliderRow(fxTree, '拖尾粗细')), '1', '拖尾粗细下限必须是 1px');
        assert.equal(sliderMax(findSliderRow(fxTree, '拖尾粗细')), '12', '拖尾粗细上限必须是 12px');
        assert.equal(sliderMax(findSliderRow(fxTree, '拖尾光晕')), '100', '拖尾光晕上限必须是 100%');
        assert.equal(sliderMin(findSliderRow(fxTree, '不透明度')), '10', '不透明度下限必须是 10%');
        assert.equal(sliderMax(findSliderRow(fxTree, '不透明度')), '100', '不透明度上限必须是 100%');
        // 单位回显：ms 是本轮新增的第三种后缀（px / % / s 之外）—— 回显漏了它就会显示成裸数字。
        const fxReadoutOf = (labelText) => {
          const row = findSliderRow(fxTree, labelText);
          if (!row) return null;
          const hits = (row.children || []).filter((c) =>
            typeof c?.props?.className === 'string' && c.props.className.includes('we-picker__value'));
          return hits.length === 1 ? String((hits[0].children || [])[0] ?? '') : null;
        };
        assert.equal(fxReadoutOf('半径'), '140px', '半径回显带 px 单位（默认 140）');
        assert.equal(fxReadoutOf('拖尾时长'), '420ms', '拖尾时长回显带 ms 单位（默认 420）');
        assert.equal(fxReadoutOf('不透明度'), '85%', '不透明度回显带 % 单位（默认 85）');
        // ── 混合模式：这一层**没有「自动」档**（它刻意不采样壁纸像素）⇒ 5 档、默认滤色 ──
        const fxFindSelect = (root, aria) => {
          let hit = null;
          (function walk(node) {
            if (hit || !node || typeof node !== 'object') return;
            if (Array.isArray(node)) { node.forEach(walk); return; }
            if (node.type === 'select' && node.props && node.props['aria-label'] === aria) { hit = node; return; }
            if (Array.isArray(node.children)) node.children.forEach(walk);
          })(root);
          return hit;
        };
        const fxBlend = fxFindSelect(fxTree, '混合模式');
        assert.ok(fxBlend, '二号模块必须画出「混合模式」下拉（5 档平铺会挤成一团）');
        if (fxBlend) {
          assert.equal(fxBlend.props.value, 'screen', '二号模块的混合模式默认必须是「滤色」');
          const fxBlendText = JSON.stringify(fxBlend);
          for (const v of ['screen', 'normal', 'overlay', 'multiply', 'lighten']) {
            assert.ok(fxBlendText.includes('"value":"' + v + '"'), '二号模块的混合模式缺少档位 ' + v);
          }
          assert.equal((fxBlendText.match(/"type":"option"/g) || []).length, 5,
            '二号模块的混合模式必须恰好 5 个档位（与 FX_BLEND_VALUES 对齐）');
        }
        // ── 取色器**只在「自定义」档出现**（别的档颜色由主题或色相决定，摆着就是骗人） ──
        const fxFindButton = (root, label) => {
          let hit = null;
          (function walk(node) {
            if (hit || !node || typeof node !== 'object') return;
            if (Array.isArray(node)) { node.forEach(walk); return; }
            if (node.type === 'button' && String((node.children || [])[0]) === label) { hit = node; return; }
            if (Array.isArray(node.children)) node.children.forEach(walk);
          })(root);
          return hit;
        };
        const fxColorInputs = (root) => {
          const out = [];
          (function walk(node) {
            if (!node || typeof node !== 'object') return;
            if (Array.isArray(node)) { node.forEach(walk); return; }
            if (node.type === 'input' && node.props && node.props.type === 'color') out.push(node);
            if (Array.isArray(node.children)) node.children.forEach(walk);
          })(root);
          return out;
        };
        assert.equal(fxColorInputs(fxTree).length, 0, '「跟随主题色」档下不得出现自定义取色器');
        const fxCustomBtn = fxFindButton(fxTree, '自定义');
        assert.ok(fxCustomBtn, '二号模块必须画出配色档「自定义」');
        if (fxCustomBtn) {
          fxCustomBtn.props.onClick();
          flushPersistWrites();
          const fxCustomTree = renderPicker();
          const fxCustomText = JSON.stringify(fxCustomTree);
          assert.ok(fxCustomText.includes('自定义颜色'), '「自定义」档下必须画出「自定义颜色」取色行');
          const fxColors = fxColorInputs(fxCustomTree);
          assert.equal(fxColors.length, 1, '「自定义」档下必须恰好一个取色器');
          assert.equal(String(fxColors[0].props.value), '#4f8cff', '取色器默认值必须是 fxColor 的默认色');
          assert.equal(typeof fxColors[0].props.onInput, 'function', '取色器必须挂上 onInput（拖动期实时）');
          assert.equal(typeof fxColors[0].props.onChange, 'function', '取色器必须挂上 onChange（抬手落盘）');
          const fxAccentBtn = fxFindButton(renderPicker(), '跟随主题色');
          if (fxAccentBtn) fxAccentBtn.props.onClick();
          flushPersistWrites();
          assert.equal(fxColorInputs(renderPicker()).length, 0, '切回「跟随主题色」后取色器必须消失');
        }
        // ── 两个子开关各自收起自己那一串参数（"关掉了还能拖它的参数"是错觉） ──
        const clickOff = findCtlInput(renderPicker(), '在点击处炸开一圈光效');
        assert.ok(clickOff, '二号模块必须画出「点击效果」子开关');
        if (clickOff) {
          clickOff.props.onChange({ target: { checked: false } });
          flushPersistWrites();
          const noClickText = JSON.stringify(renderPicker());
          assert.ok(!noClickText.includes('点击样式') && !noClickText.includes('点击光晕'),
            '关掉「点击效果」后它自己那一串参数必须收起来');
          assert.ok(noClickText.includes('拖尾样式') && noClickText.includes('拖尾光晕'),
            '关掉「点击效果」不该动到拖尾那一串参数');
        }
        const trailOff = findCtlInput(renderPicker(), '光标划过时留下会淡出的轨迹');
        assert.ok(trailOff, '二号模块必须画出「拖尾效果」子开关');
        if (trailOff) {
          trailOff.props.onChange({ target: { checked: false } });
          flushPersistWrites();
          const noTrailText = JSON.stringify(renderPicker());
          assert.ok(!noTrailText.includes('拖尾样式') && !noTrailText.includes('拖尾光晕'),
            '关掉「拖尾效果」后它自己那一串参数必须收起来');
        }
        // 复位：总开关关掉（子开关那两条留在关着的档里没关系，总开关关着就都不画）。
        const fxOff = findCtlInput(renderPicker(), '启用点击与拖尾效果');
        if (fxOff) fxOff.props.onChange({ target: { checked: false } });
        flushPersistWrites();
      }
      // ── 三号模块（3D 效果）：默认关 ⇒ 只画总开关 + 说明；开了才长三个参数 ──
      //    它跟另两个模块最大的不同是**它一个 DOM 节点都不建**（行为层只往 body 写 CSS
      //    变量，位移在 src/styles.js 的视差段里算）⇒ 岛这一侧的判据只盯"控件真的按开关
      //    长出来、关掉就收起"，屏上真的挪了多少像素由 verify-scene-live 的源码口径与
      //    样式段判据钉住（无头环境看不见像素）。
      const parOn = findCtlInput(extTree, '启用 3D 效果');
      assert.ok(parOn, '三号模块必须画出总开关（findCtlInput 能取到它的 onChange）');
      assert.equal(parOn && parOn.props.checked, false, '三号模块的总开关默认必须是关的');
      if (parOn) {
        parOn.props.onChange({ target: { checked: true } });
        flushPersistWrites();
        const parTree = renderPicker();
        const parText = JSON.stringify(parTree);
        for (const t of ['3D 效果', '光标移动时，壁纸与吉祥物沿屏幕中心的对称方向轻轻偏移；界面整块默认不动（要一起动就打开下面的「界面元素跟随」）',
          '背景缓动距离', '吉祥物跟随', '挂件也按「背景缓动距离」一起挪', '界面元素跟随',
          '输入卡片、会话文本区（连里面的用户气泡一起）与侧栏作为整块跟着挪：文字与底下的玻璃一起动', '缓动平滑']) {
          assert.ok(parText.includes(t), '打开三号模块后「扩展」页签必须有「' + t + '」');
        }
        // 另两个模块的参数**不得**因为三号开着而出现（三张卡各管各的）。
        assert.ok(!parText.includes('头像大小') && !parText.includes('拖尾粗细'),
          '另两个模块关着时，三号模块开着也不该画出它们的参数');
        // 滑块范围必须与 lib/settings-schema.js 的 KINDS 一致（改范围要同时改两处）。
        assert.equal(sliderMin(findSliderRow(parTree, '背景缓动距离')), '0', '背景缓动距离下限必须是 0%');
        assert.equal(sliderMax(findSliderRow(parTree, '背景缓动距离')), '10', '背景缓动距离上限必须是 10%');
        assert.equal(sliderMin(findSliderRow(parTree, '缓动平滑')), '0', '缓动平滑下限必须是 0%');
        assert.equal(sliderMax(findSliderRow(parTree, '缓动平滑')), '98', '缓动平滑上限必须是 98%');
        // 默认回显：背景是 1%（用户口径里写明的默认值 —— 改大了就是"一开就很晃"）。
        const parReadoutOf = (labelText, tree) => {
          const row = findSliderRow(tree || parTree, labelText);
          if (!row) return null;
          const hits = (row.children || []).filter((c) =>
            typeof c?.props?.className === 'string' && c.props.className.includes('we-picker__value'));
          return hits.length === 1 ? String((hits[0].children || [])[0] ?? '') : null;
        };
        assert.equal(parReadoutOf('背景缓动距离'), '1%', '背景缓动距离默认必须是 1%');
        assert.equal(parReadoutOf('缓动平滑'), '85%', '缓动平滑默认必须是 85%');
        // 吉祥物子开关默认**开**（用户口径第 4 条："如果可以，让吉祥物也参与"）：它只管
        // "挂件要不要跟着挪"，关掉只是不挪自己，不影响壁纸。
        const parMascot = findCtlInput(parTree, '挂件也按「背景缓动距离」一起挪');
        assert.ok(parMascot, '三号模块必须画出「吉祥物跟随」子开关');
        assert.equal(parMascot && parMascot.props.checked, true, '「吉祥物跟随」默认必须是开的');
        // 界面组子开关默认**关**（用户口径：它动的是真实界面 —— 输入卡片、会话文本区、侧栏，
        // 连文字一起挪，绝不能不问自取）：关着时只画它自己那一行，距离滑块连文案都不出现。
        const parUi = findCtlInput(parTree, '输入卡片、会话文本区（连里面的用户气泡一起）与侧栏作为整块跟着挪：文字与底下的玻璃一起动');
        assert.ok(parUi, '三号模块必须画出「界面元素跟随」子开关');
        assert.equal(parUi && parUi.props.checked, false, '「界面元素跟随」默认必须是关的');
        assert.equal(findSliderRow(parTree, '会话文本区距离'), null,
          '「界面元素跟随」关着时不该画出四个区域距离');
        if (parUi) {
          parUi.props.onChange({ target: { checked: true } });
          flushPersistWrites();
          const uiTree = renderPicker();
          // 四个区域距离**各是绝对百分比**（用户裁决 m02697-①③）：面板与存档**同一个单位**
          // ⇒ 滑杆域 = KINDS 域（0..10、步长 0.1，没变）；出厂值则是用户实际调好的那一组
          //（用户诉求 m04159：「修改原生前端在开启时的默认值」⇒ 1.2 / 1.8 / 1.6 / 1.4）。
          // 真源在 lib/settings-schema.js 的 DEFAULTS，这里按"面板必须照它回显"逐个钉住。
          const parNativeDefaults = {
            '会话文本区距离': '1.2%',
            '输入卡片距离': '1.8%',
            '侧栏距离': '1.6%',
            '用户气泡距离': '1.4%',
          };
          Object.keys(parNativeDefaults).forEach((label) => {
            assert.equal(sliderMin(findSliderRow(uiTree, label)), '0', label + ' 下限必须是 0%');
            assert.equal(sliderMax(findSliderRow(uiTree, label)), '10', label + ' 上限必须是 10%');
            assert.equal(parReadoutOf(label, uiTree), parNativeDefaults[label],
              label + ' 的默认回显必须是出厂值 ' + parNativeDefaults[label] + '（真源 = lib/settings-schema.js 的 DEFAULTS）');
          });
          assert.equal(findSliderRow(uiTree, '界面跟随距离'), null,
            '总倍率退役后不得再画出「界面跟随距离」');
          // 缓动元素设置分三类（用户裁决 m02697-③）：三张分组卡的标题按序都在树上。
          const sectionTitles = [];
          (function walk(node) {
            if (!node || typeof node !== 'object') return;
            if (Array.isArray(node)) { node.forEach(walk); return; }
            if (node.props?.className === 'we-picker__section-label') {
              sectionTitles.push(String((node.children || [])[0] ?? ''));
            }
            if (Array.isArray(node.children)) node.children.forEach(walk);
          })(uiTree);
          // （`扩展模块` 是注册表容器自己那张卡，排在本模块各行之前 ⇒ 只取末三张。）
          assert.deepEqual(sectionTitles.slice(-3), ['背景', '原生前端', '插件前端'],
            '缓动元素设置必须按 背景 / 原生前端 / 插件前端 三张分组卡排');
          assert.equal(sectionTitles[0], '扩展模块', '三张分组卡必须落在「扩展模块」容器之内');
          const uiText = JSON.stringify(uiTree);
          // 界面组在自己那一行上还挂着一句"整块跟着挪"的说明。
          assert.ok(uiText.includes('输入卡片、会话文本区（连里面的用户气泡一起）与侧栏作为整块跟着挪'),
            '「界面元素跟随」必须带一句说明它是整块一起挪的');
          // 「插件前端」那一张卡**有自己的开关**（用户诉求 m03549："把插件前端也单独归类加开关"；
          // 裁决 = 独立开关、默认关）：界面跟随开着而它关着时，这一卡**只有开关** —— 提示与槽位行
          // 一行都不许画（"关着还能拖参数"那条不变量在子开关上也照旧）。
          const parPluginHint = '别的插件注册进来的界面元素组（比如任务看板、市场面板）也跟着挪；默认关 —— 它动的是它们的真实界面';
          const parPlugin = findCtlInput(uiTree, parPluginHint);
          assert.ok(parPlugin, '「插件前端」必须画出它自己的开关「插件前端跟随」');
          assert.equal(parPlugin && parPlugin.props.checked, false,
            '「插件前端跟随」默认必须是关的（它动的是别的插件画出来的真实界面）');
          assert.ok(!uiText.includes('还没认到别的插件注册的前端元素组')
            && !uiText.includes('下面是运行期认到的'),
            '「插件前端跟随」关着时那一卡不得画出提示或槽位行');
          if (parPlugin) parPlugin.props.onChange({ target: { checked: true } });
          flushPersistWrites();
          const pluginTree = renderPicker();
          const pluginText = JSON.stringify(pluginTree);
          // 开了插件开关、而运行期一个槽位都没认到（这个夹具没有 DOM）⇒ 空那一条文案。
          assert.ok(pluginText.includes('还没认到别的插件注册的前端元素组'),
            '开了「插件前端跟随」却一个槽位都没认到时，必须给一句说明');
          // **独立于**「界面元素跟随」：把界面整块关掉，插件这一卡照旧（开关还开着、提示还在），
          // 而原生那四行跟着界面那一块一起收起来 —— 两张卡、两个开关，谁也不牵谁。
          const parUiOff = findCtlInput(pluginTree,
            '输入卡片、会话文本区（连里面的用户气泡一起）与侧栏作为整块跟着挪：文字与底下的玻璃一起动');
          if (parUiOff) parUiOff.props.onChange({ target: { checked: false } });
          flushPersistWrites();
          const pluginOnlyTree = renderPicker();
          const pluginOnlyText = JSON.stringify(pluginOnlyTree);
          const parPluginStill = findCtlInput(pluginOnlyTree, parPluginHint);
          assert.equal(parPluginStill && parPluginStill.props.checked, true,
            '「界面元素跟随」关掉后「插件前端跟随」必须照旧开着（两个开关互不依赖）');
          assert.ok(pluginOnlyText.includes('还没认到别的插件注册的前端元素组'),
            '「界面元素跟随」关掉后插件那一卡的说明必须还在');
          assert.equal(findSliderRow(pluginOnlyTree, '用户气泡距离'), null,
            '「界面元素跟随」关掉后原生那四行必须收起来');
        }
        // 复位：总开关关掉（后续判据要的是"默认态"）。关掉之后连同界面组那些行一起收干净。
        const parOff = findCtlInput(renderPicker(), '启用 3D 效果');
        if (parOff) parOff.props.onChange({ target: { checked: false } });
        flushPersistWrites();
        assert.ok(!JSON.stringify(renderPicker()).includes('背景缓动距离'),
          '关掉三号模块总开关后它那一串参数必须收起来');
        assert.equal(findSliderRow(renderPicker(), '用户气泡距离'), null,
          '关掉三号模块总开关后界面组那几行也必须收起来');
      }
      // 唯一激活的页签是「扩展」：只数类名不看文案，能同时挡住"没切过去"与"两个都亮"。
      const activeTabs = [];
      (function walk(node) {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        const cls = typeof node.props?.className === 'string' ? node.props.className : '';
        if (cls.split(/\s+/).includes('we-tabs__tab--active')) activeTabs.push(String((node.children || [])[0] || ''));
        if (Array.isArray(node.children)) node.children.forEach(walk);
      })(extTree);
      assert.deepEqual(activeTabs, ['扩展'], '点开「扩展」后恰好只有它处于激活态');
      // 负对照：别的页签的控件不得漏进「扩展」（合并渲染器最容易犯的错）。
      assert.ok(!extText.includes('选择壁纸') && !extText.includes('玻璃透明度') && !extText.includes('吉祥物大小'),
        '「扩展」页签不得混进别页签的控件');
    }

    // ── 「关于」页签：静态页 —— 简介 / 致谢 / 仓库与 Star / 两张交流群二维码 ──
    //    它的价值全在"内容真的画出来了"：漏一张码、链接指到别处、或者把面板控件
    //    混进来，都是用户一眼可见而别的判据看不见的回归。
    {
      setTab('about');
      tree = renderPicker();
      treeText = JSON.stringify(tree);
      const collectByClass = (root, token) => {
        const out = [];
        (function walk(node) {
          if (!node || typeof node !== 'object') return;
          if (Array.isArray(node)) { node.forEach(walk); return; }
          const cls = typeof node.props?.className === 'string' ? node.props.className : '';
          if (cls.split(/\s+/).includes(token)) out.push(node);
          if (Array.isArray(node.children)) node.children.forEach(walk);
        })(root);
        return out;
      };
      const tabs = collectByClass(tree, 'we-tabs__tab');
      assert.ok(tabs.length === 6 && String(String(tabs[5].children[0])) === '关于',
        '「关于」必须是最后一枚页签');
      assert.ok(treeText.includes('"we-tabs__tab we-tabs__tab--active"')
        && collectByClass(tree, 'we-tabs__tab--active').length === 1
        && String(String(collectByClass(tree, 'we-tabs__tab--active')[0].children[0])) === '关于',
        'about tab is active (and exactly one tab is active)');
      // 四块内容各有一个绝对锚点：简介 / 仓库 / 交流群 / 致谢。
      for (const anchorText of ['项目简介', '贡献者致谢', '去 GitHub 点亮 Star', '加入交流群', 'oneincase', 'YV3507']) {
        assert.ok(treeText.includes(anchorText), '关于页必须包含「' + anchorText + '」');
      }
      // 段落顺序是用户的明确口径（`贡献者致谢` 压尾）：简介 → 仓库/Star → 交流群 → 致谢。
      // 用序列化树里的**首次出现下标**比大小 —— 顺序错了必然有一个逆序。
      const ordered = (s) => {
        const idx = ['📖 项目简介', '⭐ 开源与支持', '💬 加入交流群', '🙏 贡献者致谢'].map((t) => s.indexOf(t));
        return idx.every((i) => i >= 0) && idx.every((v, i) => i === 0 || idx[i - 1] < v);
      };
      assert.ok(ordered(treeText),
        '关于页段落顺序必须是：项目简介 → 开源与支持 → 加入交流群 → 贡献者致谢（致谢压尾）');
      // 正/负对照：谓词本身两个方向都有牙（否则"顺序对了"可能只是它恒真）。
      assert.ok(ordered('📖 项目简介|⭐ 开源与支持|💬 加入交流群|🙏 贡献者致谢'), 'positive control: 顺序谓词对正确顺序判真');
      assert.ok(!ordered('🙏 贡献者致谢|⭐ 开源与支持|💬 加入交流群|📖 项目简介'), 'negative control: 致谢没压尾要被判出');
      assert.ok(!ordered('📖 项目简介|⭐ 开源与支持|❓ 缺一段'), 'negative control: 段落缺失要被判出');
      // 两张码：img 的 src 必须是**随包 PNG 的路由 URL**（经 apiUrl 拼前缀），且两张不同。
      // 反过来——**不许**出现内联 base64（那会把 240KB 压回 bundle）。
      const qrImgs = collectByClass(tree, 'we-about__qr-img');
      assert.equal(qrImgs.length, 2, '关于页必须正好渲染两张二维码图');
      const qrSrcs = qrImgs.map((n) => String(n.props.src || ''));
      assert.ok(qrSrcs.every((s) => s.startsWith('/wallpaper-engine/about-qr/')),
        '二维码必须走宿主路由 /about-qr/<文件名>（图本体是随包 PNG）');
      assert.ok(qrSrcs.every((s) => s.endsWith('.png')), '路由 URL 指向的必须是 .png');
      assert.ok(!qrSrcs.some((s) => s.startsWith('data:')),
        '二维码不得再内联为 data URI（用户口径：PNG 引入）');
      assert.ok(qrSrcs[0] !== qrSrcs[1], '两张二维码必须不是同一张图');
      assert.ok(qrImgs.every((n) => n.props.alt && String(n.props.alt).length > 0),
        '二维码必须带 alt（图片加载不出来时也得说得出这是哪张码）');
      // Star 按钮：真链接、新窗口、指到本仓。
      const starLinks = collectByClass(tree, 'we-about__star');
      assert.equal(starLinks.length, 1, '关于页必须有且只有一枚 Star 按钮');
      assert.equal(String(starLinks[0].props.href), 'https://github.com/elysia395/dsh-wallpaper-engine',
        'Star 按钮必须指向本仓地址');
      assert.equal(String(starLinks[0].props.target), '_blank', 'Star 按钮必须在新窗口打开');
      assert.ok(starLinks[0].props.rel && String(starLinks[0].props.rel).includes('noopener'),
        '外链必须带 rel=noopener');
      // 静态页的"负对照"：它会读面板状态就会带控件 —— 一条滑条都不许有。
      assert.equal(collectByClass(tree, 'we-picker__slider-row').length, 0,
        '「关于」是静态页：不得渲染任何滑条行');
      assert.ok(!/"type":"(checkbox|range|color|select)"/.test(treeText),
        '「关于」不得渲染任何表单控件');
      // negative control：别的页签不得出现关于页的文案（内容真的按页签隔离）。
      setTab('system');
      assert.ok(!JSON.stringify(renderPicker()).includes('去 GitHub 点亮 Star'),
        'negative control: 系统页不得混入关于页的内容');
      localStorage.removeItem(TAB_KEY);
    }

    // ── 「关于」页签的 star 数：切进去问一次、显示出来、TTL 内不再问，别的页签不问 ──
    //    走**真实点击路径**（tab 按钮的 onClick → switchTab → loadStarCount），不是
    //    直接调加载器 —— 这条断言要防的正是"切页签没接上"这种接线级回归。
    {
      const fresh = () => new Promise((r) => setTimeout(r, 0));
      const tabButton = (root, label) => {
        let hit = null;
        (function walk(node) {
          if (hit || !node || typeof node !== 'object') return;
          if (Array.isArray(node)) { node.forEach(walk); return; }
          if (node.props && node.props.role === 'tab'
            && String((node.children || [])[0] || '') === label) { hit = node; return; }
          if (Array.isArray(node.children)) node.children.forEach(walk);
        })(root);
        return hit;
      };
      setTab('system');
      let t = renderPicker();
      assert.equal(starCountCalls.length, 0, '别的页签一次都不该问 star 数（系统页渲染后）');
      const aboutBtn = tabButton(t, '关于');
      assert.ok(aboutBtn && typeof aboutBtn.props.onClick === 'function', '找得到「关于」页签按钮（否则后面是空转）');
      aboutBtn.props.onClick();
      await fresh();
      t = renderPicker();
      const aboutText = JSON.stringify(t);
      assert.equal(starCountCalls.length, 1, '切到「关于」页 ⇒ 恰好问一次 /star-count');
      assert.ok(aboutText.includes('⭐ 当前 428 star'), '取到之后把那行字画出来（当前 428 star）');
      assert.ok(!aboutText.includes('暂时取不到'), '取到值时不得同时出现失败文案');
      // TTL 内来回切：不再问（GitHub 未认证限流是整机共享的，别把额度烧在页签上）
      const sysBtn = tabButton(t, '系统');
      if (sysBtn && typeof sysBtn.props.onClick === 'function') sysBtn.props.onClick();
      const aboutBtn2 = tabButton(renderPicker(), '关于');
      if (aboutBtn2 && typeof aboutBtn2.props.onClick === 'function') aboutBtn2.props.onClick();
      await fresh();
      assert.equal(starCountCalls.length, 1, 'TTL 内切回来不重复问（缓存生效）');
      t = renderPicker();
      assert.ok(JSON.stringify(t).includes('⭐ 当前 428 star'), '值仍在（不会闪一下就没）');
      localStorage.removeItem(TAB_KEY);
    }

    // ── 外观 tab: swatches / sliders / sidebar-glass group. ──
    // ⚠️ 2026-10-09 真迁移后**两棵渲染台分工**：设置页渲染台（renderPicker）钉简化配置与
    //    页签行为 + 迁移负断言（独立配置 / 字体节不再画）；侧栏渲染台（renderSidePane，
    //    qp-tab=appearance + 两块折叠块展开）钉高级行为（独立配置往返 / 胶囊 / 触发条 /
    //    字体开关）。两边的 handler 是同一份模块级实现，bodyEl 属性断言与哪棵树无关。
    setTab('appearance');
    tree = renderPicker();
    treeText = JSON.stringify(tree);
    assert.ok(treeText.includes('"we-tabs__tab we-tabs__tab--active"'), 'appearance tab active:');
    assert.equal((treeText.match(/"aria-label":"配色 /g) || []).length, 6, '配色预设应有 6 个色板');
    assert.equal((treeText.match(/"aria-label":"玻璃颜色 /g) || []).length, 6, '玻璃颜色预设应有 6 个色板');
    assert.ok(treeText.includes('自定义玻璃颜色'), 'glass color custom input present:');
    assert.ok(treeText.includes('type":"color"'), 'custom color input present:');
    // ── #159② 玻璃色分主题（面板 + 写入口径的完整往返）────
    //    判据不是"控件在不在"，而是**两个颜色各自独立**：默认关 ⇒ 只有浅色一行；打开 ⇒ 多出
    //    深色那一行；点浅色只改浅色、点深色只改深色；关掉 ⇒ 深色侧收敛到浅色（"一个颜色同时
    //    用于两套"的字面含义，而不是留下一个看不见的旧值下次又冒出来）。
    const findGlassSwatch = (root, ariaLabel) => {
      let hit = null;
      (function walk(node) {
        if (hit || !node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (node.type === 'button' && node.props && node.props['aria-label'] === ariaLabel) { hit = node; return; }
        if (Array.isArray(node.children)) node.children.forEach(walk);
      })(root);
      return hit;
    };
    const swatchActive = (el) => !!el && String(el.props.className).includes('we-picker__swatch--active');
    assert.equal((treeText.match(/"aria-label":"玻璃颜色 · 深色 /g) || []).length, 0,
      '「深色单独设置」默认关 ⇒ 不得画出深色色板行');
    assert.ok(swatchActive(findGlassSwatch(tree, '玻璃颜色 #ffffff')),
      '默认白釉在浅色那一行是选中项');
    const glassSepSwitch = findCtlInput(tree, '深色单独设置');
    assert.ok(glassSepSwitch, '玻璃色的「深色单独设置」开关在场（外观页）');
    glassSepSwitch.props.onChange({ target: { checked: true } });
    tree = renderPicker();
    treeText = JSON.stringify(tree);
    assert.equal((treeText.match(/"aria-label":"玻璃颜色 · 深色 /g) || []).length, 6,
      '打开「深色单独设置」⇒ 深色那一行有 6 个色板');
    // 点浅色那行的「深夜蓝」：只该改浅色那一侧（深色那行不动）
    findGlassSwatch(tree, '玻璃颜色 #0d1524').props.onClick();
    tree = renderPicker();
    assert.ok(swatchActive(findGlassSwatch(tree, '玻璃颜色 #0d1524')), '点了浅色 ⇒ 浅色那行选中深夜蓝');
    assert.ok(swatchActive(findGlassSwatch(tree, '玻璃颜色 · 深色 #ffffff')),
      '⚠️ 分主题开着时点浅色**不得**顺手改掉深色那一侧（否则"分开设置"是假的）');
    // 再点深色那行的「玫瑰粉」：只该改深色那一侧
    findGlassSwatch(tree, '玻璃颜色 · 深色 #DD8FAC').props.onClick();
    tree = renderPicker();
    assert.ok(swatchActive(findGlassSwatch(tree, '玻璃颜色 · 深色 #DD8FAC')), '点了深色 ⇒ 深色那行选中玫瑰粉');
    assert.ok(swatchActive(findGlassSwatch(tree, '玻璃颜色 #0d1524')), '点深色时浅色那一侧不受影响');
    // 关掉开关 ⇒ 深色行消失，且深色侧收敛到浅色那一侧（内部仍存两套值，但值相同）
    findCtlInput(tree, '深色单独设置').props.onChange({ target: { checked: false } });
    tree = renderPicker();
    treeText = JSON.stringify(tree);
    assert.equal((treeText.match(/"aria-label":"玻璃颜色 · 深色 /g) || []).length, 0,
      '关掉「深色单独设置」⇒ 深色色板行消失');
    findCtlInput(tree, '深色单独设置').props.onChange({ target: { checked: true } });
    tree = renderPicker();
    assert.ok(swatchActive(findGlassSwatch(tree, '玻璃颜色 · 深色 #0d1524')),
      '关掉再打开 ⇒ 深色那一侧已收敛到浅色（不得跳回关掉前的玫瑰粉）');
    // 复原出厂：关开关 + 浅色那行回白釉（关着时写两侧 ⇒ 两套都回白釉）
    findCtlInput(tree, '深色单独设置').props.onChange({ target: { checked: false } });
    tree = renderPicker();
    findGlassSwatch(tree, '玻璃颜色 #ffffff').props.onClick();
    tree = renderPicker();
    treeText = JSON.stringify(tree);
    assert.ok(swatchActive(findGlassSwatch(tree, '玻璃颜色 #ffffff')), '复原：浅色那行回白釉');
    assert.ok(treeText.includes('玻璃透明度'), 'glass transparency slider row present:');
    assert.ok(treeText.includes('"侧栏液态玻璃"'), 'sidebar-glass master switch present:');
    // ── 跟随全局（sidebarFollowGlobal，默认开；现场口径："我需要侧栏玻璃也跟随全局"）──
    //    合并 #132 后旋钮住在「侧栏玻璃·独立配置」下 ⇒ 跟随开着时收起的是那个开关本身：
    //    画出来又不生效的旋钮正是要防的（WIP 原口径）。内容面与跟随无关 ⇒ 独立配置照旧在场。
    const followSwitch = findCtlInput(tree, '侧栏玻璃跟随全局');
    assert.ok(followSwitch, 'follow-global switch present:');
    assert.equal(bodyEl.attributes['data-we-sidebar-follow'], 'on', '默认跟随 ⇒ body 上有跟随属性');
    // ── 迁移负断言（真迁移的"设置页那一侧"）：高级行与字体节搬进侧栏折叠块后，设置页
    //    一个都不许再画 —— 两个方向都钉：这里判"设置页没有"，renderSidePane 那侧判"侧栏有"。 ──
    assert.equal(findCtlInput(tree, '侧栏玻璃·独立配置'), null, '设置页不画「侧栏玻璃·独立配置」（已迁侧栏折叠块）');
    assert.equal(findCtlInput(tree, '内容面玻璃·独立配置'), null, '设置页不画「内容面玻璃·独立配置」（已迁侧栏折叠块）');
    assert.equal(findSliderRow(tree, '侧栏模糊'), null, '设置页不画「侧栏模糊」（精确标签，防 tooltip 骗过）');
    assert.equal((JSON.stringify(tree).match(/"aria-label":"侧栏玻璃颜色 /g) || []).length, 0,
      '设置页不画侧栏玻璃颜色色板（已迁侧栏折叠块）');
    assert.equal(findCtlInput(tree, '字体自定义'), null, '设置页不画「字体自定义」（字体节已迁侧栏）');
    // ── 切侧栏渲染台（外观页 · 字体节与详细玻璃都展开）：从这里起高级行断言。 ──
    tree = renderSidePane();
    treeText = JSON.stringify(tree);
    assert.ok(findCtlInput(tree, '内容面玻璃·独立配置'), '内容面独立配置不受跟随开关影响:');
    // 关掉跟随 ⇒ 侧栏「独立配置」出现（能力没丢），body 属性随之摘掉。
    followSwitch.props.onChange({ target: { checked: false } });
    assert.equal(bodyEl.attributes['data-we-sidebar-follow'], undefined,
      '关掉跟随必须摘掉 body 属性（否则侧栏的釉仍取共享那一份）');
    tree = renderSidePane();
    treeText = JSON.stringify(tree);
    assert.ok(findCtlInput(tree, '侧栏玻璃·独立配置'), '关掉跟随 ⇒ 侧栏「独立配置」出现:');
    // ⚠️ 基线交付给下面 #132 的判据主体：跟随关着 ⇒ 它的开关流/量程/退役判据照原样跑。
    // ⚠️ 本批（wip §10.24）：侧栏家族与内容面的滑块挂在**各自的「独立配置」**下面 ——
    //    登记表那四个子面一直是这个口径（参数只在独立配置打开后才出现），而这两个既有面
    //    原先**没有开关**、滑块是**死的**；补上入口后行为与那四个统一。
    //    判据用 `findSliderRow`（**精确标签**）而不是 `treeText.includes` —— 后者会被别处的
    //    tooltip 文本骗过：雾化那条 tooltip 里就写着「侧栏有自己的「侧栏模糊」」，实测骗过一次。
    assert.ok(findCtlInput(tree, '侧栏玻璃·独立配置'), 'sidebar independent-config switch present:');
    assert.ok(findCtlInput(tree, '内容面玻璃·独立配置'), 'content independent-config switch present:');
    assert.equal(findSliderRow(tree, '侧栏模糊'), null, '独立配置关着时不该画「侧栏模糊」');
    assert.equal(findSliderRow(tree, '侧栏透明度'), null, '独立配置关着时不该画「侧栏透明度」');
    assert.equal(findSliderRow(tree, '内容面透明度'), null, '内容面独立配置关着时不该画「内容面透明度」');
    // The three detail knobs (侧栏模糊 / 侧栏透明度 / 侧栏玻璃颜色) are
    // conditional on the 侧栏液态玻璃 master switch: off → hidden, on →
    // restored, in the SAME render pass (the toggle re-emits synchronously).
    const sidebarSwitch = findCtlInput(tree, '"侧栏液态玻璃"');  // 带引号精确匹配：新标签「左侧栏液态玻璃」是它的超串
    if (sidebarSwitch) {
      sidebarSwitch.props.onChange({ target: { checked: false } });
      assert.equal(bodyEl.attributes['data-we-sidebar-glass'], undefined, 'sidebar master off must restore native surfaces');
      tree = renderSidePane();
      assert.ok(JSON.stringify(tree).includes('"侧栏液态玻璃"'), 'switch itself stays visible when off:');
      assert.ok(!JSON.stringify(tree).includes('侧栏玻璃·独立配置'), 'master off also hides the independent switch:');
      sidebarSwitch.props.onChange({ target: { checked: true } });
      assert.equal(bodyEl.attributes['data-we-sidebar-glass'], 'on', 'sidebar master on must re-arm sidebar surfaces');
      tree = renderSidePane();
      assert.ok(findCtlInput(tree, '侧栏玻璃·独立配置'), 'master on restores the independent switch:');
    }
    // 打开「侧栏玻璃·独立配置」⇒ 它自己的三个滑块出现，且量程与 KINDS 一致。
    // R4 量纲统一（wip §10.19）：侧栏家族的量程从 0–200 收到**规范刻度**
    //（模糊 0–60 px 与全局雾化同刻度；透明度 0–100 %）。这里钉住"面板与规范刻度一致"。
    findCtlInput(tree, '侧栏玻璃·独立配置').props.onChange({ target: { checked: true } });
    tree = renderSidePane();
    assert.equal(sliderMax(findSliderRow(tree, '侧栏模糊')), '60', '侧栏模糊上限必须是 60px（与全局雾化同刻度，R4）');
    assert.equal(sliderMax(findSliderRow(tree, '侧栏透明度')), '100', '侧栏透明度上限必须是 100（规范刻度，R4）');
    assert.equal((JSON.stringify(tree).match(/"aria-label":"侧栏玻璃颜色 /g) || []).length, 6, '侧栏玻璃颜色预设应有 6 个色板');
    assert.ok(JSON.stringify(tree).includes('自定义侧栏玻璃颜色'), 'sidebar glass color custom input present:');
    // ── §11 A2-F2：侧栏档那个**单**色板固定写浅色那一半 ────────────────────────────
    //    侧栏的玻璃色变量只消费浅色半（src/glass.js / src/effects.js 的 sidebar 分支都取
    //    `glassColorOf(sel,"light")` —— 侧栏没有 `data-ds-dark-theme` 孪生，有意不分深浅）。
    //    所以侧栏面板①只画一行、②显示与写入都是**浅色半**，不是"当前配色那一侧"：否则深色
    //    主题下用户点一下改的是他在这块面板上看不到的那个值（面板还不许自己采样主题）。
    //    断言用"两半不同"的状态来钉：浅色=白釉、深色=玫瑰粉 ⇒ 显示哪一半、点一下改哪一半都无处可藏。
    setTab('appearance');
    let sepTree = renderPicker();
    findCtlInput(sepTree, '深色单独设置').props.onChange({ target: { checked: true } });
    sepTree = renderPicker();
    findGlassSwatch(sepTree, '玻璃颜色 · 深色 #DD8FAC').props.onClick(); // 深色半 = 玫瑰粉
    sepTree = renderPicker();
    assert.ok(swatchActive(findGlassSwatch(sepTree, '玻璃颜色 #ffffff')),
      'A2-F2 前提：浅色半仍是白釉（与深色半不同 —— 否则下面两条判不出"取错了一半"）');
    assert.ok(swatchActive(findGlassSwatch(sepTree, '玻璃颜色 · 深色 #DD8FAC')),
      'A2-F2 前提：深色半已设为玫瑰粉');
    tree = renderSidePane();
    treeText = JSON.stringify(tree);
    assert.equal((treeText.match(/"aria-label":"玻璃颜色 /g) || []).length, 6,
      'A2-F2：侧栏档只画一行玻璃颜色（「玻璃颜色 · 深色」行不发到侧栏 —— 侧栏不消费深色半）');
    assert.ok(swatchActive(findGlassSwatch(tree, '玻璃颜色 #ffffff')),
      'A2-F2：侧栏档色板显示的是**浅色半**（显示深色半 = 用户看到的值不是他改的那个）');
    findGlassSwatch(tree, '玻璃颜色 #0d1524').props.onClick(); // 侧栏这一个色板点「深夜蓝」
    setTab('appearance');
    sepTree = renderPicker();
    assert.ok(swatchActive(findGlassSwatch(sepTree, '玻璃颜色 #0d1524')),
      'A2-F2：侧栏档点一个颜色 ⇒ 浅色半跟着变');
    assert.ok(swatchActive(findGlassSwatch(sepTree, '玻璃颜色 · 深色 #DD8FAC')),
      'A2-F2：侧栏档点色**不得**碰深色半（写当前配色那一侧的实现会在这里红）');
    // 结构半边：旧实现是按主题选一侧（`singleGlassOnDark = sidebarSurface && panelThemeIsDark()`）。
    // 挂载台里 `document.body` 没有能力齐全的 hasAttribute ⇒ 只靠上面的行为断言抓不到"条件选侧"
    // 那一种回退，所以再钉一条源码判据 + 一条证明该判据真能抓到的负对照。
    const glassPanelSrc = readFileSync(new URL('../src/glass-panel.js', import.meta.url), 'utf8');
    // 只判**代码**：注释里正好写着"panelThemeIsDark 已随之删除"这句（第一版被自己的注释判红）。
    // 剥注释走共享的**字符串感知**实现（`test/tools/js-text.mjs`）—— 手写"块注释一条正则 +
    // 行注释一条正则"不认字符串与行注释，注释里出现那两个字符就会静默吃掉中间的真实代码，
    // 而判据照样报绿（`verify-module-layout` ⑦ 专抓这个，别在这里再写一遍）。
    const glassPanelCode = stripComments(glassPanelSrc);
    const themeSampler = /panelThemeIsDark|singleGlassOnDark/;
    assert.ok(themeSampler.test('const singleGlassOnDark = sidebarSurface && panelThemeIsDark();'),
      '负对照：被删掉的"按主题选侧"实现确实会命中下面这条源码判据');
    assert.ok(!themeSampler.test(glassPanelCode),
      'A2-F2：面板不许自己采样主题来决定写哪一侧（侧栏那一行固定写浅色半）');
    // 复原出厂：关开关（深色半收敛到浅色）+ 浅色半回白釉，别把状态留给后面的判据。
    sepTree = renderPicker();
    findCtlInput(sepTree, '深色单独设置').props.onChange({ target: { checked: false } });
    sepTree = renderPicker();
    findGlassSwatch(sepTree, '玻璃颜色 #ffffff').props.onClick();
    tree = renderSidePane();
    treeText = JSON.stringify(tree);
    assert.ok(swatchActive(findGlassSwatch(tree, '玻璃颜色 #ffffff')), 'A2-F2 复原：侧栏档回白釉');
    // 内容面同样：它的开关打开后才画透明度 / 底色两行。
    findCtlInput(tree, '内容面玻璃·独立配置').props.onChange({ target: { checked: true } });
    tree = renderSidePane();
    treeText = JSON.stringify(tree);
    assert.equal(sliderMax(findSliderRow(tree, '内容面透明度')), '100', '内容面透明度上限必须是 100（规范刻度，R4）');
    // §10.27 + v1.3.0 追版：新增的「思考触发条玻璃·独立配置」—— 打开后才画它自己的两项，量程同样
    // 钉在规范刻度上（这正是"拖过 60 跳回 20"那次事故的两侧之一：**面板量程**那一侧）。
    // ⚠️ 这一面**挂在「思考块液态玻璃」三挡（2026-10-06）的「液态玻璃」挡**门下（登记表 `master`）：
    //    非"液态玻璃"挡时它一行都不画（画了就是"画出来又不生效"的死旋钮 ⇒ 本仓专门防这一类），
    //    所以各挡都钉 —— 关/原生 ⇒ 找不到；液态玻璃 ⇒ 出现且量程正确。
    // 三挡分段的替身驱动：找「思考块液态玻璃」那一行（we-picker__ctl），点其中目标挡位的按钮。
    const clickThinkGear = (root, label) => {
      let row = null;
      (function walk(node) {
        if (row || !node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        const cls = typeof node.props?.className === 'string' ? node.props.className : '';
        if (cls.includes('we-picker__ctl') && JSON.stringify(node).includes('思考块液态玻璃')) { row = node; return; }
        if (Array.isArray(node.children)) node.children.forEach(walk);
      })(root);
      assert.ok(row, '找得到「思考块液态玻璃」三挡行');
      let hit = null;
      (function findBtn(node) {
        if (hit || !node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(findBtn); return; }
        // JSON 包含式而非 children 严格相等：weT 在替身里不保证恒等（词表/回退都可能改写文案），
        // 按钮级 JSON 含目标挡名即可 —— 行级 hint 不在按钮子树里，三挡按钮互不包含彼此的挡名。
        if (node.type === 'button' && JSON.stringify(node).includes(label)) { hit = node; return; }
        if (Array.isArray(node.children)) node.children.forEach(findBtn);
      })(row);
      assert.ok(hit, '三挡分段里找得到「' + label + '」按钮');
      hit.props.onClick();
    };
    assert.equal(findCtlInput(tree, '思考触发条玻璃·独立配置'), null,
      '思考玻璃非"液态玻璃"挡时「思考触发条玻璃·独立配置」不该画（master 门）');
    clickThinkGear(tree, '液态玻璃');
    tree = renderSidePane();
    assert.equal(bodyEl.attributes['data-we-thinking-glass'], 'on', '选液态玻璃挡 ⇒ 玻璃门挂上');
    assert.equal(bodyEl.attributes['data-we-thinking-native'], undefined, '选液态玻璃挡 ⇒ 原生门不挂');
    findCtlInput(tree, '思考触发条玻璃·独立配置').props.onChange({ target: { checked: true } });
    tree = renderSidePane();
    assert.equal(sliderMax(findSliderRow(tree, '思考触发条玻璃·玻璃透明度')), '100',
      '思考触发条透明度上限必须是 100（规范刻度）');
    assert.equal(sliderMax(findSliderRow(tree, '思考触发条玻璃·雾化')), '60',
      '思考触发条雾化上限必须是 60px（与全局雾化同刻度）');
    // 原生挡：赢过玻璃挡 —— native 门挂上、玻璃门摘下（互斥在 effects.js 门控层），
    // 触发条独立配置与胶囊两行整组收起（它们的 CSS 门此时不挂 ⇒ 画了就是死旋钮）。
    clickThinkGear(tree, '原生');
    tree = renderSidePane();
    assert.equal(bodyEl.attributes['data-we-thinking-native'], 'on', '选原生挡 ⇒ 原生门挂上');
    assert.equal(bodyEl.attributes['data-we-thinking-glass'], undefined, '选原生挡 ⇒ 玻璃门摘下（互斥）');
    assert.equal(findCtlInput(tree, '思考触发条玻璃·独立配置'), null, '原生挡 ⇒ 触发条独立配置行收起');
    assert.equal(findSliderRow(tree, '胶囊雾化'), null, '原生挡 ⇒ 胶囊雾化行收起（死旋钮防线）');
    // 收尾：关挡 ⇒ 两个门控属性都摘下 —— 三挡往返钉住，不留"关着还挂门"的缺口。
    clickThinkGear(tree, '关');
    tree = renderSidePane();
    treeText = JSON.stringify(tree);
    assert.equal(bodyEl.attributes['data-we-thinking-glass'], undefined, '关挡 ⇒ 玻璃门摘下');
    assert.equal(bodyEl.attributes['data-we-thinking-native'], undefined, '关挡 ⇒ 原生门摘下');
    assert.equal(findCtlInput(tree, '思考触发条玻璃·独立配置'), null, '关挡 ⇒ 该行收起');
    // ⚠️ 全局「玻璃透明度」的量程必须与 KINDS 一致（100）。这一条是为一个**真实事故**补的：
    //    处理器里手写的钳制漏改时，面板量程是 100 而钳制是 0–60，`clampNum` 又"越界即回落默认值"
    //    ⇒ 拖过 60 就跳回 20（用户实测"最多只能拉到 20%"）。面板量程 + 处理器取值域**两边都要钉**，
    //    加上第 ⑦ 组钉住 KINDS 本身，三者同源才闭环。
    assert.equal(sliderMax(findSliderRow(tree, '玻璃透明度')), '100', '玻璃透明度上限必须是 100（与 KINDS 同源）');
    // 本批（wip §10.20）：「设置窗口液态玻璃」这个 master 开关**已退役** ——
    // 它的功能由「设置窗口玻璃·独立配置」接管（行为与开启时逐位一致）。这里两头都钉：
    // 退役的开关**不许**再出现，接管的那个独立配置**必须**在。
    assert.ok(!treeText.includes('设置窗口液态玻璃'), 'retired「设置窗口液态玻璃」switch must be gone:');
    assert.ok(treeText.includes('设置窗口玻璃·独立配置'), 'the child independent switch takes over:');
    assert.ok(treeText.includes('整个设置窗口'), 'window glass hint stays (now on the child switch):');

    // 收尾：跟随开回默认态 ⇒ 「独立配置」又收起、属性回来（完整往返双向钉住）。
    followSwitch.props.onChange({ target: { checked: true } });
    assert.equal(bodyEl.attributes['data-we-sidebar-follow'], 'on', '重新打开跟随 ⇒ 属性回来');
    tree = renderSidePane();
    treeText = JSON.stringify(tree);
    assert.equal(findCtlInput(tree, '侧栏玻璃·独立配置'), null, '重新打开跟随 ⇒ 「独立配置」又收起');

    // ── 「字体」已并入「外观」：老的 localStorage 页签值必须迁移过去（不能把用户
    //    甩回「壁纸」）。2026-10-09 真迁移后**设置页外观不再画字体节** —— 页签迁移行为
    //    用设置页台钉（玻璃透明度在场 ⇒ 落点对了），字体开关与它的行为用侧栏台钉。 ──
    setTab('font');
    tree = renderPicker();
    treeText = JSON.stringify(tree);
    assert.ok(treeText.includes('玻璃透明度'),
      'legacy "font" tab value must migrate to 外观 (its own rows must be on screen)');
    assert.ok(!treeText.includes('字体自定义'),
      '设置页外观不再画「字体自定义」（字体节已迁侧栏 —— 真迁移的另一侧）');
    // 侧栏渲染台：字体节默认收起 ⇒ renderSidePane 已播种 qp-font-open=1（展开）。
    tree = renderSidePane();
    treeText = JSON.stringify(tree);
    assert.ok(treeText.includes('字体自定义'), '侧栏外观必须画「字体自定义」（迁移目的地）');
    const fontSwitch = findCtlInput(tree, '字体自定义');
    assert.ok(fontSwitch, '侧栏字体自定义开关必须找得到（缺则后面断言零覆盖）');
    if (fontSwitch) {
      fontSwitch.props.onChange({ target: { checked: true } });
      tree = renderSidePane();
      treeText = JSON.stringify(tree);
      assert.ok(/文字颜色角色/.test(code) && /排版角色/.test(code) && /恢复默认/.test(code),
    '字体节必须揭示字体控件组（角色色组 + 排版角色组 + 恢复默认）—— 单一「字体颜色」行与全局字重/字族都已移除');
      assert.ok(treeText.includes('默认字体'), '展开态下字体族两行（默认字体 / 终端字体）必须在场');
      fontSwitch.props.onChange({ target: { checked: false } });
      tree = renderSidePane();
      treeText = JSON.stringify(tree);
    }

    // ── 输入光标（#83）: caret color swatches live alongside the font controls
    //    (same 外观 tab now) and are INDEPENDENT of the 字体自定义 master switch. ──
    assert.ok(treeText.includes('输入光标'), '外观 must host the 输入光标 section');
    assert.ok(treeText.includes('输入光标'), 'appearance tab has 输入光标 section:');
    assert.equal((treeText.match(/"aria-label":"光标颜色 /g) || []).length, 7, '光标颜色应有 7 个色板（自动 + 6 预设）');
    assert.ok(treeText.includes('自定义光标颜色'), 'caret custom color input present:');
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
    // 前置**硬断言**（缺前置 = 默认红，不与"通过"同形）：`console.log('… present:', !!x && !!y)`
    // 加一句 `if (…) { asserts }` 的写法在控制项一改名时会让后面的断言**静默不跑**，而守卫照样绿
    // （零覆盖与通过同形）。所以这里用 assert.ok 把前置钉死。
    assert.ok(caretWhite && caretAuto,
      '光标颜色行必须同时有「#ffffff」预设与「自动」按钮（缺则后续断言零覆盖）');
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
    // 前置硬断言（同上：探测不是判据，缺了就红）。
    assert.ok(ropeToggle, '吉祥物页必须有「显示吉祥物」开关（缺则后续断言零覆盖）');
    if (ropeToggle) {
      assert.ok(ropeToggle.props.checked === true, 'rope toggle checked by default:');
      ropeToggle.props.onChange({ target: { checked: false } });
      tree = renderPicker();
      const ropeOff = findCtlInput(tree, '显示吉祥物');
      assert.ok(!!ropeOff && ropeOff.props.checked === false, 'unchecking hides the rope (checkbox off):');
      ropeToggle.props.onChange({ target: { checked: true } });
      tree = renderPicker();
      const ropeOn = findCtlInput(tree, '显示吉祥物');
      assert.ok(!!ropeOn && ropeOn.props.checked === true, 're-checking restores the rope (checkbox on):');
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
    // 三张卡：两张内置形态 + 一张**自定义立绘**（用户口径：「导入后显示在鲸鱼姐后面、
    // 同样的卡片大小和样式」⇒ 它排在最后、用的是同一个卡片类/同一套尺寸口径）。
    assert.ok(mascotCards.length === 3, 'mascot cards (expect 3: maid / whale / custom):');
    assert.ok(!!activeForm(mascotCards) && activeForm(mascotCards).props.title === '小女仆', 'default form is maid:');
    const customCard0 = mascotCards[2];
    assert.ok(customCard0 && String(customCard0.children?.[1]?.children?.[0] || '') === '自定义',
      '第三张卡必须是「自定义」（排在鲸御姐后面）');
    assert.ok(customCard0 && customCard0.props["aria-pressed"] === 'false',
      '没导入自定义立绘时它不是 active 的那张');
    const whaleCard = mascotCards.find((c) => c.props.title === '鲸御姐');
    if (whaleCard) { whaleCard.props.onClick(); tree = renderPicker(); }
    mascotCards = findMascotCards(tree);
    assert.ok(!!activeForm(mascotCards) && activeForm(mascotCards).props.title === '鲸御姐', 'form switches to whale:');
    const maidCard = mascotCards.find((c) => c.props.title === '小女仆');
    if (maidCard) { maidCard.props.onClick(); tree = renderPicker(); }
    mascotCards = findMascotCards(tree);
    assert.ok(!!activeForm(mascotCards) && activeForm(mascotCards).props.title === '小女仆', 'form switches back to maid:');
    const ropeScaleSlider = findSliderRow(tree, '吉祥物大小');
    // 前置硬断言（同光标色板那处）：改前这里是 `console.log(… present:, !!x)` + `if (x) { 断言 } else
    // { console.log('… not found') }` —— 那个 else **只打印**，所以是**静默跳过**：滑块一改名，下面三条
    // 断言一条都不跑，而这条守卫照样绿（零覆盖与通过同形）。同处的 min/max 判据也从 log 改成了断言。
    assert.ok(ropeScaleSlider, '「吉祥物大小」滑块必须在场（缺则后续断言零覆盖）');
    if (ropeScaleSlider) {
      const ri = findRangeInput(ropeScaleSlider);
      assert.ok(ri && String(ri.props.min) === '0.5' && String(ri.props.max) === '2.5',
        'rope size slider min/max 必须是 0.5 / 2.5');
      assert.ok(ri && String(ri.props.value) === '1', 'rope size default scale (1):');
      if (ri) ri.props.onInput({ target: { value: '1.5' } });
      tree = renderPicker();
      const ri2 = findRangeInput(findSliderRow(tree, '吉祥物大小'));
      assert.ok(ri2 && String(ri2.props.value) === '1.5', 'rope size slider updates to 1.5:');
      // 设置页形态卡片固定基础尺寸（2026-10-04 用户口径）：「吉祥物大小」只作用于
      // 主页面 RopeDock，卡片不跟着缩放 —— 若有人把 `form.w * sel.ropeScale` 的
      // 乘法加回去，1.5 倍下小女仆会是 78px、鲸御姐 144px，这里当场红。
      const artsAtScale = [];
      (function walkArt(n) {
        if (!n || typeof n !== 'object') return;
        if (Array.isArray(n)) { n.forEach(walkArt); return; }
        const cls = typeof n.props?.className === 'string' ? n.props.className : '';
        if (cls.includes('we-picker__mascot-art')) artsAtScale.push(n);
        if (Array.isArray(n.children)) n.children.forEach(walkArt);
      })(tree);
      assert.equal(artsAtScale.length, 2, '1.5 倍下形态卡片立绘仍应有 2 个（卡片不消失）');
      assert.equal(artsAtScale[0] && artsAtScale[0].props.style?.width, '52px', '小女仆卡片宽度固定 52px（不随滑块缩放）');
      assert.equal(artsAtScale[1] && artsAtScale[1].props.style?.height, '96px', '鲸御姐卡片高度固定 96px（不随滑块缩放）');
      // ── 自定义立绘那张卡（用户口径：吉祥物可自定义导入；已导入时下一次导入覆盖上一次）──
      //    没导入过 ⇒ 卡片画「+」占位、标题是导入的 tooltip、**不得**出现「清除」；
      //    两张内置形态卡照旧可点（没有自定义立绘压着）。
      {
        const cardsNow = findMascotCards(tree);
        const custom = cardsNow[2];
        assert.ok(custom && String(custom.children?.[1]?.children?.[0] || '') === '自定义',
          '第三张卡必须是「自定义」（排在鲸御姐后面）');
        assert.equal(custom && custom.props.title, '导入图片…', '没导入过 ⇒ 卡片的提示是「导入图片…」');
        assert.ok(!JSON.stringify(tree).includes('清除'),
          '没导入过立绘时不得出现「清除」按钮');
        assert.ok(cardsNow.every((c) => c.props.disabled !== true), '没有自定义立绘时三张卡都可点');
        // 卡面舞台与内置卡**同一个盒**（最高的那张 64×96）：占位是该盒，导入后图片等比缩进它。
        const stageOf = (card) => card && card.children?.[0]?.props?.style;
        assert.ok(custom && stageOf(custom).width === '64px' && stageOf(custom).height === '96px',
          '自定义卡的卡面舞台必须与最高的内置卡同一个盒（64×96）');
      }
      // 已导入那一档用**源码口径**判（挂载台够不到 store：`selection` 只在 bundle 内部，
      // 而这个测试驱动的都是"控件 → 处理器 → setSetting"那条路；导入是唯一能把
      // mascotImage 写进去的动作，而它需要真文件 + 网络）。行为侧那半边由
      // test/verify-scene.mjs 的真 socket 路由用例（导入 / 覆盖 / 清除）覆盖。
      {
        const srcNow = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');
        const tabsNow = readFileSync(new URL('../src/panel-tabs.js', import.meta.url), 'utf8');
        assert.ok(/function ropeArtOf\(selLike\)/.test(srcNow)
          && /apiUrl\("\/mascot\?v=" \+ encodeURIComponent\(name\)\)/.test(srcNow),
          '主页面吉祥物必须走 ropeArtOf（自定义优先）这条解析');
        assert.ok(/const previewArt = ropeArtOf\(sel\);/.test(tabsNow)
          && /const customArt = previewArt\.custom;/.test(tabsNow),
          '设置页的自定义立绘那一格必须复用同一条解析（两处各写一遍必然漂）');
        // 自定义生效时的三件事：明说"主页面用的是这张图"、按钮变「替换图片…」+「清除」、
        // 形态卡片**禁用**（点了不会变 ⇒ 不许做成"点了没反应"）。
        assert.ok(tabsNow.includes('自定义立绘生效中：主页面吉祥物用的是这张图；点卡片可换一张')
          && tabsNow.includes('customArt ? weT("替换图片…（再导入会覆盖上一次）") : weT("导入图片…")')
          && tabsNow.includes('disabled: customArt,')
          && tabsNow.includes('customArt && React.createElement("button"')
          && tabsNow.includes('className: "we-picker__mascot-card" + (customArt ? " we-picker__mascot-card--active" : "")'),
          '自定义立绘生效时的四个形态（提示 / 卡片 active / 替换提示 / 内置卡禁用）必须在渲染器里逐条在位');
        // 显示盒的算法在导入处（96×192 等比适配、短边不小于 28），主页面与预览读同一份设置。
        // 上限常量的真源在 schema（MASCOT_BOX_MAX_W/H，verify-contracts 的单源判据盯着）——
        // 这里钉"client 不本地重声明 + 导入记账三件"。
        assert.ok(!/const\s+MASCOT_BOX_MAX_W/.test(srcNow)
          && /MASCOT_BOX_MAX_W \/ img\.width/.test(srcNow)
          && /MASCOT_BOX_MIN_SIDE = 28/.test(srcNow)
          && /const box = Math\.max\(1, Math\.round\(img\.width \* k\)\) \+ "x" \+ Math\.max\(1, Math\.round\(img\.height \* k\)\);/.test(srcNow)
          && /setSetting\("mascotImage", posted\.name\);/.test(srcNow)
          && /setSetting\("mascotImageBox", box\);/.test(srcNow),
          '立绘导入必须把文件名与显示盒一起记账（上限常量只从 schema 引用；盒坏了 ropeArtOf 回落到内置形态）');
      }
      if (ri2) ri2.props.onInput({ target: { value: '1' } });
      tree = renderPicker();
    }

    // ── 「边框」「玻璃(→雾化)」已从「效果」移到「外观」的「细节」段：
    //    在新家要能在、在旧家必须不在（否则就是搬了个寂寞）。 ──
    setTab('appearance');
    tree = renderPicker();
    assert.equal(sliderMax(findSliderRow(tree, '雾化')), '60', '雾化（原「玻璃」）必须在「外观」里，上限 60px');
    assert.equal(sliderMax(findSliderRow(tree, '边框')), '90', '边框必须在「外观」里，上限 90%');
    assert.equal(findSliderRow(tree, '玻璃'), null, '「玻璃」这个行名必须已改掉（避免与玻璃颜色/玻璃透明度撞车）');
    setTab('effects');
    tree = renderPicker();
    assert.equal(findSliderRow(tree, '雾化'), null, '雾化 不得再留在「效果」');
    assert.equal(findSliderRow(tree, '边框'), null, '边框 不得再留在「效果」');
    console.log('边框 / 雾化 已迁到外观（效果里不再有）: ok');
    // 注意：效果页签的 tooltip 里仍会出现「玻璃」二字（壁纸透明度那条），所以这里
    // 用**结构化**判定（slider-row 的标签），不能用 treeText.includes('玻璃')。

    // ── 壁纸透明度（#82）: slider max 90; 60% → layer opacity 0.4; 0% unsets. ──
    const wpOpacityRow = findSliderRow(tree, '壁纸透明度');
    assert.equal(sliderMax(wpOpacityRow), '90', '壁纸透明度上限必须是 90%');
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
        // 按**class 令牌**匹配，不是精确串：卡片有多个修饰态（`--selected` 当前播放、
        // `--checked` 批量勾选），枚举式精确匹配会把 `--checked` 的卡片整批漏掉。
        // 令牌匹配同时排除 `we-picker__card-wrap` 这类近似名（它不是 `we-picker__card`）。
        if (cls.split(/\s+/).includes('we-picker__card')) cards.push(node);
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
    // Virtual window（2026-10-04 用户口径：**库视图不再分页**）：本台 React 是替身 ⇒
    // qpVirtWindow 的测量 effect 不跑，窗口恒为"未测量首窗" = 关闭卡 + 前 29 张
    // （PICKER_VP_FIRST = 30 条目）—— 恰好把窗口计算钉成**确定性**断言；滚动出的窗口
    // 归真浏览器（判定台/真机）。分页器从此不存在于库视图（轮换编辑器仍用它）。
    // 判据必须**真断言**：整块 `console.log` 只在日志里像断言、不判真假（形态规则见
    // docs/DEV-GUIDE.md §4.7 约定 5）。
    let cards = collectCards(tree);
    rotCheck('虚拟首窗：30 张卡（关闭卡 + 29）', cards.length === 30);
    rotCheck('虚拟首窗：库视图不再渲染分页器', !JSON.stringify(tree).includes('we-picker__pager'));
    const winText = JSON.stringify(cards);
    rotCheck('虚拟首窗：含首张（Wall 0）与窗尾（Wall 28）', winText.includes('Wall 0') && winText.includes('Wall 28'));
    rotCheck('虚拟首窗：窗外条目不渲染（Wall 29 / Video A / Scene C）',
      !winText.includes('Wall 29') && !winText.includes('Video A') && !winText.includes('Scene C'));
    rotCheck('筛选：无 frameUrl 的场景（Scene D）不进网格', !winText.includes('Scene D'));
    rotCheck('筛选：默认 Everyone 下 PG13 不进网格', !winText.includes('PG13 E'));
    // 窗口外的条目必须**可达**（这是"虚拟"与"砍掉"的分界）：搜索把库收敛进首窗。
    const findSearchBox = (root) => { let hit = null; (function walkS(n) {
      if (hit) return;
      if (Array.isArray(n)) { n.forEach(walkS); return; }
      if (!n || typeof n !== 'object') return;
      const c = typeof n.props?.className === 'string' ? n.props.className : '';
      if (c.split(/\s+/).includes('we-picker__search')) { hit = n; return; }
      if (Array.isArray(n.children)) n.children.forEach(walkS);
    })(root); return hit; };
    const searchBox = findSearchBox(tree);
    rotCheck('虚拟首窗：搜索框在（窗外条目经它可达）', Boolean(searchBox && searchBox.props.onInput));
    searchBox.props.onInput({ target: { value: 'Video A' } });
    tree = renderPicker();
    cards = collectCards(tree);
    rotCheck('虚拟首窗：搜索收敛后远端条目（Video A）落进首窗', cards.length === 2
      && JSON.stringify(cards).includes('Video A'));
    searchBox.props.onInput({ target: { value: '' } });
    tree = renderPicker();
    // 负对照：把**变异输入**喂进**同一条判据**，证明这两条判据真能失败
    const mutated = { props: { className: 'we-picker__card' },
      children: [{ props: { className: 'we-picker__card-wrap' }, children: [] }] };
    rotCheck('负对照：卡片判据不把近似类名算进去（多算一张就会被判出）',
      collectCards(mutated).length === 1 && collectCards({}).length === 0);
    rotCheck('负对照：搜索收敛判据两侧都真（清空后 Video A 回到窗外）',
      collectCards(tree).length === 30 && !JSON.stringify(collectCards(tree)).includes('Video A'));

    // ── 0b：搜索 / 类型筛选 / 批量 / 隐藏页 / 卡片头计数 ──────────────────
    // 判据只在**一处**定义，正判据与负对照都调它（形态规则见 docs/DEV-GUIDE.md §4.7 约定 5）。
    const cardTexts = (root) => collectCards(root).map((c) => JSON.stringify(c));
    // 关闭卡也是 `we-picker__card`（分页计数里它一直算一张）⇒ 判"只剩匹配项"时必须先摘掉它。
    const wallpaperCardTexts = (root) => cardTexts(root).filter((s) => !s.includes('✕ 关闭'));
    const onlyMatching = (root, needle) => {
      const t = wallpaperCardTexts(root);
      return t.length > 0 && t.every((s) => s.includes(needle));
    };
    const synthCards = (texts) => texts.map((t) => ({ props: { className: 'we-picker__card' }, children: [t] }));
    const findByProp = (root, name, value) => { let hit = null; (function walk(n) {
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (!n || typeof n !== 'object') return;
      if (n.props && n.props[name] === value) hit = n;
      if (Array.isArray(n.children)) n.children.forEach(walk);
    })(root); return hit; };
    const findByClass = (root, cls) => { let hit = null; (function walk(n) {
      if (hit) return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (!n || typeof n !== 'object') return;
      const c = typeof n.props?.className === 'string' ? n.props.className : '';
      if (c.split(/\s+/).includes(cls)) { hit = n; return; }
      if (Array.isArray(n.children)) n.children.forEach(walk);
    })(root); return hit; };
    // 按**按钮文字**找 `.we-picker__btn`。放在助手区（而不是某个用例中间）：0b 段之后有十几个
    // 用例要用它，声明在中间会让"谁在用它"取决于阅读顺序。
    const findBtnByText = (root, label) => { let hit = null; (function walk(n) {
      if (hit) return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (!n || typeof n !== 'object') return;
      const c = typeof n.props?.className === 'string' ? n.props.className : '';
      if (c.split(/\s+/).includes('we-picker__btn') && textOf(n) === label && typeof n.props.onClick === 'function') { hit = n; return; }
      if (Array.isArray(n.children)) n.children.forEach(walk);
    })(root); return hit; };
    const textOf = (root) => { let out = ''; (function walk(n) {
      if (typeof n === 'string') { out += n; return; }
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n.children)) n.children.forEach(walk);
    })(root); return out; };
    // 徽标只在**卡片头**里找：壁纸卡片自己也有 `we-picker__card-badge`（如「静态帧」），
    // 不限定范围会取到卡片上那个。
    const badgeOf = (root) => {
      const head = findByClass(root, 'we-picker__card-head');
      const b = head ? findByClass(head, 'we-picker__card-badge') : null;
      return b ? textOf(b) : null;
    };
    const persisted = () => JSON.parse(localStorage._store['dsh-wallpaper-engine:selection'] || '{}');

    // 卡片头徽标 = 当前（过滤后）**全量**可播放数；网格只渲染**虚拟首窗** —— 两者是
    // "全量与窗口"的关系（分页已退役，这里不再需要先翻回第 1 页）。
    tree = renderPicker();
    assert.equal(badgeOf(tree), '33', '卡片头徽标显示当前可播放数（全量）');
    assert.equal(collectCards(tree).length, 30, '首窗渲染关闭卡 + 29 张（未测量首窗 = 30 条目）');
    assert.ok(!JSON.stringify(tree).includes('we-picker__pager'), '分页器不再出现');

    // ── 模态框**标记等价**（搬迁前后逐字未变）────────────────────────────────
    // 模态框那棵子树被 116 个 `.we-picker__*` 选择器按**层级 / 相邻关系**选元素
    // （src/styles.js 586–1603），test/e2e-web-media-origin.mjs 里另有一份**手抄**的
    // picker DOM 镜像 —— 标记只要改一个类名、或只挪一层嵌套，CSS 与那份镜像都会**静默**漂，
    // 所以"搬走这段渲染"必须证明逐字未变。判据：以 `we-picker__modal` 为根深度优先遍历，
    // 把每个元素的 class 令牌按「深度:令牌」摊平成序列，与搬迁前录下的 golden 逐项相等。
    // 深度进序列 ⇒「增删一个类名」与「改一个层级」都会让判据变假（负对照实测）。
    // 三个状态各录一份：普通视图 / 批量模式（批量条 + 勾选标记）/ 隐藏页。
    const modalClassSequence = (root) => {
      const modal = findByClass(root, 'we-picker__modal');
      if (!modal) return [];
      const out = [];
      (function walk(node, depth) {
        if (Array.isArray(node)) { node.forEach((c) => walk(c, depth)); return; }
        if (!node || typeof node !== 'object') return;
        // Fragment 是透明容器（不产生 DOM）：不记 class、不进深度，子层原样摊平 ——
        // 否则虚拟窗口的 Fragment 会给卡片一个幻影层级，深度不再忠实于 DOM。
        if (node.type === 'Fragment') {
          if (Array.isArray(node.children)) node.children.forEach((c) => walk(c, depth));
          return;
        }
        const cls = typeof node.props?.className === 'string' ? node.props.className : '';
        for (const token of cls.split(/\s+/).filter(Boolean)) out.push(depth + ':' + token);
        if (Array.isArray(node.children)) node.children.forEach((c) => walk(c, depth + 1));
      })(modal, 0);
      return out;
    };
    // 判据只有这一处：正判据与全部负对照都调它（形态规则见 docs/DEV-GUIDE.md §4.7 约定 5）。
    const classSequenceMatches = (seq, golden) =>
      seq.length === golden.length && seq.every((t, i) => t === golden[i]);
    // 只把**第一个**壁纸卡的深度 +1：序列长度不变，只有层级变 —— 用来证明逐项比较真在比内容。
    const bumpFirstCardDepth = (seq) => {
      const out = seq.slice();
      const i = out.findIndex((t) => t.startsWith('3:we-picker__card'));
      if (i >= 0) out[i] = '4:' + out[i].slice(2);
      return out;
    };
    const EXPECTED_NORMAL = [
      '0:we-picker__modal 1:we-picker__modal-head 2:we-picker__modal-head-left 3:we-vinyl 3:we-vinyl--playing 3:we-vinyl--sm 4:we-vinyl__cover 5:we-vinyl__empty 4:we-vinyl__hole',
      '3:we-picker__modal-title 2:we-picker__btn 1:we-picker__modal-tabs 2:we-picker__btn 2:we-picker__tab 2:we-picker__tab--active 2:we-picker__btn 2:we-picker__tab 1:we-picker__modal-body',
      '2:we-picker__row 3:we-picker__hint 3:we-picker__btn 2:we-picker__row 2:we-picker__filter-row 3:we-picker__text 3:we-picker__search 3:we-picker__hint 3:we-picker__label',
      '3:we-picker__playlist-select 3:we-picker__hint 3:we-picker__label 3:we-picker__playlist-select 2:we-picker__grid 3:we-picker__card 4:we-picker__card-close 3:we-picker__card 4:we-picker__card-placeholder',
      '4:we-picker__card-type 4:we-picker__card-title 4:we-picker__card-hide 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-type 4:we-picker__card-title 4:we-picker__card-hide 3:we-picker__card',
      '4:we-picker__card-placeholder 4:we-picker__card-type 4:we-picker__card-title 4:we-picker__card-hide 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-type 4:we-picker__card-title 4:we-picker__card-hide',
      '3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-type 4:we-picker__card-title 4:we-picker__card-hide 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-type 4:we-picker__card-title',
      '4:we-picker__card-hide 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-type 4:we-picker__card-title 4:we-picker__card-hide 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-type',
      '4:we-picker__card-title 4:we-picker__card-hide 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-type 4:we-picker__card-title 4:we-picker__card-hide 3:we-picker__card 4:we-picker__card-placeholder',
      '4:we-picker__card-type 4:we-picker__card-title 4:we-picker__card-hide 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-type 4:we-picker__card-title 4:we-picker__card-hide 3:we-picker__card',
      '4:we-picker__card-placeholder 4:we-picker__card-type 4:we-picker__card-title 4:we-picker__card-hide 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-type 4:we-picker__card-title 4:we-picker__card-hide',
      '3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-type 4:we-picker__card-title 4:we-picker__card-hide 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-type 4:we-picker__card-title',
      '4:we-picker__card-hide 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-type 4:we-picker__card-title 4:we-picker__card-hide 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-type',
      '4:we-picker__card-title 4:we-picker__card-hide 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-type 4:we-picker__card-title 4:we-picker__card-hide 3:we-picker__card 4:we-picker__card-placeholder',
      '4:we-picker__card-type 4:we-picker__card-title 4:we-picker__card-hide 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-type 4:we-picker__card-title 4:we-picker__card-hide 3:we-picker__card',
      '4:we-picker__card-placeholder 4:we-picker__card-type 4:we-picker__card-title 4:we-picker__card-hide 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-type 4:we-picker__card-title 4:we-picker__card-hide',
      '3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-type 4:we-picker__card-title 4:we-picker__card-hide 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-type 4:we-picker__card-title',
      '4:we-picker__card-hide 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-type 4:we-picker__card-title 4:we-picker__card-hide 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-type',
      '4:we-picker__card-title 4:we-picker__card-hide 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-type 4:we-picker__card-title 4:we-picker__card-hide 3:we-picker__card 4:we-picker__card-placeholder',
      '4:we-picker__card-type 4:we-picker__card-title 4:we-picker__card-hide 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-type 4:we-picker__card-title 4:we-picker__card-hide 1:we-picker__modal-foot',
      '2:we-picker__hint',
    ].join(' ').split(' ');
    const EXPECTED_BATCH = [
      '0:we-picker__modal 1:we-picker__modal-head 2:we-picker__modal-head-left 3:we-vinyl 3:we-vinyl--playing 3:we-vinyl--sm 4:we-vinyl__cover 5:we-vinyl__empty 4:we-vinyl__hole',
      '3:we-picker__modal-title 2:we-picker__btn 1:we-picker__modal-tabs 2:we-picker__btn 2:we-picker__tab 2:we-picker__tab--active 2:we-picker__btn 2:we-picker__tab 1:we-picker__modal-body',
      '2:we-picker__row 3:we-picker__hint 3:we-picker__btn 2:we-picker__row 2:we-picker__batch-bar 3:we-picker__hint 3:we-picker__btn 3:we-picker__btn 2:we-picker__row',
      '2:we-picker__filter-row 3:we-picker__text 3:we-picker__search 3:we-picker__hint 3:we-picker__label 3:we-picker__playlist-select 3:we-picker__hint 3:we-picker__label 3:we-picker__playlist-select',
      '2:we-picker__grid 3:we-picker__card 4:we-picker__card-close 3:we-picker__card 3:we-picker__card--checked 4:we-picker__card-placeholder 4:we-picker__card-title 4:we-picker__card-check 3:we-picker__card',
      '4:we-picker__card-placeholder 4:we-picker__card-title 4:we-picker__card-check 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-title 4:we-picker__card-check 3:we-picker__card 4:we-picker__card-placeholder',
      '4:we-picker__card-title 4:we-picker__card-check 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-title 4:we-picker__card-check 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-title',
      '4:we-picker__card-check 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-title 4:we-picker__card-check 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-title 4:we-picker__card-check',
      '3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-title 4:we-picker__card-check 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-title 4:we-picker__card-check 3:we-picker__card',
      '4:we-picker__card-placeholder 4:we-picker__card-title 4:we-picker__card-check 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-title 4:we-picker__card-check 3:we-picker__card 4:we-picker__card-placeholder',
      '4:we-picker__card-title 4:we-picker__card-check 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-title 4:we-picker__card-check 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-title',
      '4:we-picker__card-check 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-title 4:we-picker__card-check 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-title 4:we-picker__card-check',
      '3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-title 4:we-picker__card-check 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-title 4:we-picker__card-check 3:we-picker__card',
      '4:we-picker__card-placeholder 4:we-picker__card-title 4:we-picker__card-check 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-title 4:we-picker__card-check 3:we-picker__card 4:we-picker__card-placeholder',
      '4:we-picker__card-title 4:we-picker__card-check 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-title 4:we-picker__card-check 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-title',
      '4:we-picker__card-check 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-title 4:we-picker__card-check 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-title 4:we-picker__card-check',
      '3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-title 4:we-picker__card-check 3:we-picker__card 4:we-picker__card-placeholder 4:we-picker__card-title 4:we-picker__card-check 3:we-picker__card',
      '4:we-picker__card-placeholder 4:we-picker__card-title 4:we-picker__card-check 1:we-picker__modal-foot 2:we-picker__hint',
    ].join(' ').split(' ');
    const EXPECTED_HIDDEN = [
      '0:we-picker__modal 1:we-picker__modal-head 2:we-picker__modal-head-left 3:we-vinyl 3:we-vinyl--playing 3:we-vinyl--sm 4:we-vinyl__cover 5:we-vinyl__empty 4:we-vinyl__hole',
      '3:we-picker__modal-title 2:we-picker__btn 1:we-picker__modal-tabs 2:we-picker__btn 2:we-picker__tab 2:we-picker__btn 2:we-picker__tab 2:we-picker__tab--active 1:we-picker__modal-body',
      '2:we-picker__row 3:we-picker__hint 3:we-picker__btn 2:we-picker__grid 3:we-picker__card 3:we-picker__card--hidden 4:we-picker__card-placeholder 4:we-picker__card-type 4:we-picker__card-title',
      '4:we-picker__card-hide 1:we-picker__modal-foot 2:we-picker__hint',
    ].join(' ').split(' ');
    const modalRoot = findByClass(tree, 'we-picker__modal');
    const seqNormal = modalClassSequence(tree);
    // 绝对锚点（不读 golden）：否则"两边都空"也算相等。
    assert.equal(seqNormal.length, 181, '绝对锚点：普通视图的 class 令牌数（空序列不得算通过）');
      assert.ok(collectCards(modalRoot).length >= 25, '绝对锚点：模态框里的卡片数 ≥ 25（关闭卡 + 首窗 29 张）');
      assert.ok(classSequenceMatches(seqNormal, EXPECTED_NORMAL), '普通视图：模态框标记序列与下钻改版后逐字一致（golden 录自虚拟窗口形态）');
    // 负对照：把**变异输入**喂进**同一条判据**
    assert.ok(!classSequenceMatches(seqNormal.filter((_, i) => i !== 7), EXPECTED_NORMAL),
      '负对照：删掉一个类名 ⇒ 判据变假');
    assert.ok(!classSequenceMatches(seqNormal.concat(['0:we-picker__fake']), EXPECTED_NORMAL),
      '负对照：插入一个类名 ⇒ 判据变假');
    assert.ok(!classSequenceMatches(bumpFirstCardDepth(seqNormal), EXPECTED_NORMAL),
      '负对照：只把一个节点的层级挪一格（长度不变）⇒ 判据变假');
    assert.ok(!classSequenceMatches([], EXPECTED_NORMAL), '负对照：空序列不得算作"一致"');

    // 搜索：标题过滤（输入即过滤）+ 瞬态不落盘
    const searchInput = findByClass(tree, 'we-picker__search');
    assert.ok(searchInput && typeof searchInput.props.onInput === 'function', '搜索框必须存在且可输入');
    searchInput.props.onInput({ target: { value: 'Wall 3' } });
    tree = renderPicker();
    assert.ok(onlyMatching(tree, 'Wall 3'), '搜索 Wall 3 ⇒ 网格只剩匹配项');
    assert.ok(collectCards(tree).length < 25, '命中数必须真的变少（不是换页）');
    assert.equal(Number(badgeOf(tree)), collectCards(tree).length - 1, '跨层对拍（搜索后）：徽标数 == 网格卡片数');
    assert.ok(!JSON.stringify(persisted()).includes('"search"'), '搜索是瞬态字段，不得落盘');
    // 负对照：把**变异输入**喂进同一条判据
    assert.ok(onlyMatching(synthCards(['Wall 3', 'Wall 30']), 'Wall 3'), '负对照：全匹配时判据为真');
    assert.ok(!onlyMatching(synthCards(['Wall 3', 'Wall 40']), 'Wall 3'), '负对照：混入一张不匹配 ⇒ 判据变假');
    assert.ok(!onlyMatching(synthCards([]), 'Wall 3'), '负对照：空网格不得算作「只剩匹配项」');
    // 搜不到 ⇒ 只剩关闭卡（网格空态），徽标归 0
    searchInput.props.onInput({ target: { value: '不存在的标题 zzz' } });
    tree = renderPicker();
    assert.equal(collectCards(tree).length, 1, '搜不到时网格只剩关闭卡');
    assert.equal(badgeOf(tree), '0', '搜不到时徽标显示 0');
    searchInput.props.onInput({ target: { value: '' } });
    tree = renderPicker();

    // 类型筛选：持久化设置（走 setSetting），且真的换掉网格内容
    const typeSel = findByProp(tree, 'aria-label', '类型');
    assert.ok(typeSel && typeof typeSel.props.onChange === 'function', '类型筛选必须存在且可切换');
    assert.ok(typeSel.children.some((o) => o && o.props && o.props.value === 'scene'), '类型筛选必须有「场景」档');
    typeSel.props.onChange({ target: { value: 'scene' } });
    tree = renderPicker();
    assert.ok(onlyMatching(tree, 'Scene'), '类型=场景 ⇒ 网格只剩场景卡');
    assert.equal(findByProp(tree, 'aria-label', '类型').props.value, 'scene', '类型筛选落到状态（重渲染后的值）');
    // 落盘是 200ms 去抖 ⇒ 读 localStorage 前必须先把在途的 persist 放掉（同 rotation 段的做法）
    for (const t of rotationTimers.filter((x) => !x.cleared && !x.fired && x.ms === 200)) { t.fired = true; t.fn(); }
    assert.equal(persisted().typeFilter, 'scene', '类型筛选是持久化设置（setSetting 落盘）');
    typeSel.props.onChange({ target: { value: 'all' } });
    tree = renderPicker();
    assert.equal(collectCards(tree).length, 30, '类型切回全部 ⇒ 网格恢复满窗（关闭卡 + 29）');

    // 批量模式：进入/勾选/计数/退出不留痕
    assert.ok(clickPager(tree, '批量'), '批量按钮必须存在');
    tree = renderPicker();
    const batchBar = findByClass(tree, 'we-picker__batch-bar');
    assert.ok(batchBar, '进入批量 ⇒ 出现批量条');
    assert.ok(textOf(batchBar).includes('已选 0 张'), '批量条初始计数为 0');
    const pickCard = collectCards(tree).find((c) => JSON.stringify(c).includes('Wall 0'));
    assert.ok(pickCard && typeof pickCard.props.onClick === 'function', '批量模式下卡片仍可点');
    pickCard.props.onClick();
    tree = renderPicker();
    assert.ok(textOf(findByClass(tree, 'we-picker__batch-bar')).includes('已选 1 张'), '点一张卡 ⇒ 计数变 1');
    const seqBatch = modalClassSequence(tree);
    assert.ok(classSequenceMatches(seqBatch, EXPECTED_BATCH),
      '批量模式：模态框标记序列与下钻改版后逐字一致（多出批量条与勾选标记）');
    // 勾选标记是批量模式下卡片里的 `we-picker__card-check`（选中显示 ✓，未选为空字符串）
    const checkOf = (root, title) => {
      const card = collectCards(root).find((c) => JSON.stringify(c).includes(title));
      const span = card ? findByClass(card, 'we-picker__card-check') : null;
      return span ? textOf(span) : null;
    };
    assert.equal(checkOf(tree, 'Wall 0'), '✓', '被选中的卡片带 ✓ 勾选标记');
    assert.equal(checkOf(tree, 'Wall 1'), '', '未选中的卡片勾选标记为空（不是所有卡都算选中）');
    assert.ok(clickPager(tree, '取消'), '批量条必须有「取消」');
    tree = renderPicker();
    assert.equal(findByClass(tree, 'we-picker__batch-bar'), null, '退出批量 ⇒ 批量条消失');
    assert.equal(checkOf(tree, 'Wall 0'), null, '退出批量 ⇒ 勾选标记消失（零残留）');
    assert.ok(findByClass(tree, 'we-picker__card-hide'), '退出批量 ⇒ 卡片恢复「隐藏」按钮');
    // 负对照：批量条计数判据对变异输入有牙
    const fakeBar = { props: { className: 'we-picker__batch-bar' }, children: ['已选 9 张'] };
    assert.ok(!textOf(fakeBar).includes('已选 0 张') && textOf(fakeBar).includes('已选 9 张'),
      '负对照：计数判据读的是渲染值（换个数字就不再命中）');

    // 隐藏页：真隐藏一张 ⇒ hiddenIds +1 ⇒ 页签计数与隐藏页文案同步（跨状态一致）
    const flushPersistTimers = () => {
      for (const t of rotationTimers.filter((x) => !x.cleared && !x.fired && x.ms === 200)) { t.fired = true; t.fn(); }
    };
    const findHiddenTab = (root) => { let hit = null; (function walk(n) {
      if (hit) return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (!n || typeof n !== 'object') return;
      const c = typeof n.props?.className === 'string' ? n.props.className : '';
      if (c.split(/\s+/).includes('we-picker__tab') && textOf(n).includes('已隐藏')) { hit = n; return; }
      if (Array.isArray(n.children)) n.children.forEach(walk);
    })(root); return hit; };
    const hiddenCountMatches = (text, n) => text.includes('已隐藏 ' + n + ' 张');
    const beforeHidden = persisted().hiddenIds.length;
    const hideBtn = findByClass(tree, 'we-picker__card-hide');
    assert.ok(hideBtn && typeof hideBtn.props.onClick === 'function', '普通视图的卡片上必须有「隐藏」按钮');
    hideBtn.props.onClick({ stopPropagation() {} });
    tree = renderPicker();
    flushPersistTimers();
    assert.equal(persisted().hiddenIds.length, beforeHidden + 1, '隐藏一张 ⇒ hiddenIds 增 1（且被持久化）');
    assert.ok(findHiddenTab(tree) && textOf(findHiddenTab(tree)).includes('已隐藏（' + (beforeHidden + 1) + '）'),
      '页签上的已隐藏计数跟随 hiddenIds');
    assert.ok(!wallpaperCardTexts(tree).some((s) => s.includes('"Wall 0"')),
      '被隐藏的壁纸不再出现在普通网格里');
    findHiddenTab(tree).props.onClick();
    tree = renderPicker();
    assert.ok(hiddenCountMatches(textOf(tree), beforeHidden + 1),
      '隐藏页标题的计数与 hiddenIds 一致（当前 ' + (beforeHidden + 1) + '）');
    const seqHidden = modalClassSequence(tree);
    assert.ok(classSequenceMatches(seqHidden, EXPECTED_HIDDEN),
      '隐藏页：模态框标记序列与下钻改版后逐字一致（头部行/问句行已移出网格）');
    // 负对照：把**变异输入**喂进同一条「计数一致」判据
    assert.ok(!hiddenCountMatches('已隐藏 7 张', 3) && hiddenCountMatches('已隐藏 3 张', 3),
      '负对照：计数对不上号判为假、对得上为真（判据不是恒真）');
    // 复原（否则后面依赖 Wall 0 在网格里的断言会红）：隐藏页里的按钮是"恢复此壁纸"
    // —— 与普通视图的"隐藏"**同类名**（`we-picker__card-hide`），靠 title 区分。
    const restoreBtn = findByClass(tree, 'we-picker__card-hide');
    assert.ok(restoreBtn && restoreBtn.props.title === '恢复此壁纸', '隐藏页卡片的按钮是「恢复此壁纸」');
    restoreBtn.props.onClick({ stopPropagation() {} });
    tree = renderPicker();
    flushPersistTimers();
    assert.equal(persisted().hiddenIds.length, beforeHidden, '恢复那张 ⇒ hiddenIds 回到原值');
    assert.ok(textOf(findHiddenTab(tree)).includes('已隐藏（' + beforeHidden + '）'), '页签计数随之回落');
    // 回到普通视图（后续段落假定它在普通视图）
    findByClass(tree, 'we-picker__tab').props.onClick();
    tree = renderPicker();

    // ── 0b：库视图初始焦点（页内下钻后不再有 Tab 陷阱 —— 它不是对话框了）──────
    const fakeButton = () => { const el = makeEl('button'); el.disabled = false; el.tabIndex = 0; el.getClientRects = () => [1]; return el; };
    const modalNode = findByClass(tree, 'we-picker__modal');
    assert.ok(modalNode, '库视图必须渲染（we-picker__modal 类名沿用）');
    assert.equal(modalNode.props.role, undefined, '下钻视图不得再是对话框（role=dialog 已移除）');
    // 初始焦点：面板在打开 picker 时置 `pickerFocusPending`，库视图返回按钮的 ref 消费它（一次性）
    const findCloseBtn = (root) => { let hit = null; (function walk(n) {
      if (hit) return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (!n || typeof n !== 'object') return;
      const c = typeof n.props?.className === 'string' ? n.props.className : '';
      if (c.split(/\s+/).includes('we-picker__btn') && textOf(n) === '返回' && typeof n.props.ref === 'function') { hit = n; return; }
      if (Array.isArray(n.children)) n.children.forEach(walk);
    })(root); return hit; };
    const closeBtn = findCloseBtn(tree);
    assert.ok(closeBtn, '库视图的返回按钮必须挂 ref（初始焦点落点）');
    const fakeClose = fakeButton();
    closeBtn.props.ref(fakeClose);
    assert.equal(document.activeElement, fakeClose, '打开库视图后初始焦点落在返回按钮上');
    const elsewhere = fakeButton(); elsewhere.focus();
    closeBtn.props.ref(fakeButton());
    assert.equal(document.activeElement, elsewhere, 'ref 只消费一次（第二次不得把焦点抢回来）');

    // 页内下钻后：库视图**替换**页签内容（同一时刻只有一棵树在渲染）—— 后续用例要操作
    // 页签里的控件（轮播列表下拉等），先经「返回」按钮退出库视图（真实路径，不是注入状态）。
    closeBtn.props.onClick();
    tree = renderPicker();
    assert.ok(!findByClass(tree, 'we-picker__modal'), '「返回」⇒ 库视图退出，页签内容回来');

    // ── 0b：轮换列表编辑器（选项文案 / 改间隔 / 删除组，**面板内确认**）────────
    // 破坏性动作一律走面板内确认（`armConfirm` + `renderConfirmRow`），所以这里挂的是**探针**
    // 而不是替身：真出现原生 `window.confirm` 就记一笔、并答 false（答 false ⇒ 动作不落地，
    // 下面那些"确认之后真的变了"的判据会当场变红）。计数在 0b 段末断言为 0。
    // 挂载台本来就没有 `window.confirm`，探针必须挂在**沙箱的 window** 上才拦得住。
    let nativeModalCalls = 0;
    sandbox.window.confirm = () => { nativeModalCalls++; return false; };
    // 问句行里那两枚按钮：**只在行内找**，避免与页面上其它「取消」（批量条退出批量、编辑器
    // 放弃改动）撞名 —— 撞名会让判据点错按钮，那正是"看着绿、其实没测到"。
    const confirmRowBtn = (t, label) => {
      const row = findByClass(t, 'we-picker__confirm-row');
      return row ? findBtnByText(row, label) : null;
    };
    const groupSel = findByProp(tree, 'aria-label', '轮播列表');
    assert.ok(groupSel && typeof groupSel.props.onChange === 'function', '轮播列表下拉必须存在');
    const groupOptionText = (sel) => sel.children.filter((o) => o && o.props && o.props.value !== undefined)
      .map((o) => textOf(o)).join(' | ');
    assert.ok(groupOptionText(groupSel).includes('My list（2 可播放 · 5 分钟）'),
      '每个列表的选项文案 = 名称（可播放数 · 间隔分钟）：' + groupOptionText(groupSel));
    // 改间隔：写进**当前活动列表**（无 confirm）
    const intervalSel = findByProp(tree, 'aria-label', '轮转间隔');
    assert.ok(intervalSel && typeof intervalSel.props.onChange === 'function', '轮转间隔下拉必须存在');
    intervalSel.props.onChange({ target: { value: '30' } });
    tree = renderPicker();
    flushPersistTimers();
    const activeGroup = () => persisted().rotationGroups.find((x) => x.id === persisted().rotationGroupId);
    assert.equal(activeGroup().interval, 30, '改间隔 ⇒ 写进活动列表（并落盘）');
    assert.equal(findByProp(tree, 'aria-label', '轮转间隔').props.value, '30', '下拉回读新间隔');
    // 删除列表：**面板内两下**。第一下只置令牌（不删、且出现问句行），问句行的「确认」才删；
    // 「取消」把令牌清掉。三步都读**渲染出的**证据。
    const groupsBefore = persisted().rotationGroups.length;
    // 判据读**渲染出的**状态，不读 localStorage：`deleteGroup` 直接改内存（splice）而不落盘，
    // 拿 localStorage 比会得到一条恒真的空转判据（取消也"通过"）。
    const groupOptionCount = (t) => findByProp(t, 'aria-label', '轮播列表').children
      .filter((o) => o && o.props && o.props.value).length;
    const delBtn = () => findBtnByText(tree, '删除');
    delBtn().props.onClick(); // 第一下
    tree = renderPicker();
    assert.ok(findByClass(tree, 'we-picker__confirm-row'), '第一下必须出现问句行（面板内确认）');
    assert.ok(textOf(findByClass(tree, 'we-picker__confirm-row')).includes('My list'),
      '问句点明是哪一个列表：' + textOf(findByClass(tree, 'we-picker__confirm-row')));
    assert.equal(groupOptionCount(tree), groupsBefore, '第一下只待确认 ⇒ 不删（令牌不是动作）');
    assert.equal(delBtn().props.disabled, true,
      '待确认时原「删除」按钮置灰（指路到问句行，不留"再点一下是不是就删了"的猜测）');
    // 负对照：**取消** ⇒ 不删、问句行收起、原按钮恢复可点
    confirmRowBtn(tree, '取消').props.onClick();
    tree = renderPicker();
    assert.equal(groupOptionCount(tree), groupsBefore, '取消 ⇒ 不删（取消就是取消）');
    assert.equal(findByClass(tree, 'we-picker__confirm-row'), null, '取消 ⇒ 问句行收起（令牌已清）');
    assert.equal(delBtn().props.disabled, false, '取消 ⇒ 原按钮恢复可点');
    // 正路：第一下 → 问句行的「确认」⇒ 真删，且不留悬空 id
    delBtn().props.onClick();
    tree = renderPicker();
    assert.ok(confirmRowBtn(tree, '确认'), '第二下之前问句行的「确认」必须在场（否则正路不可达）');
    confirmRowBtn(tree, '确认').props.onClick();
    tree = renderPicker();
    assert.equal(groupOptionCount(tree), groupsBefore - 1, '确认 ⇒ 真删（下拉里少一个列表）');
    assert.equal(findByClass(tree, 'we-picker__confirm-row'), null, '落地后问句行收起（令牌已清）');
    assert.equal(findByProp(tree, 'aria-label', '轮播列表').props.value, '', '删掉活动列表 ⇒ 选择回落为空（不留悬空 id）');
    assert.ok(textOf(findByProp(tree, 'aria-label', '轮播列表')).includes('暂无轮播列表'),
      '删光之后下拉显示「暂无轮播列表」（而不是一个空下拉）');

    // 新建 / 保存：此刻列表已被删空 ⇒ 保存后应恰好回到 1 个（断言是确定的）
    assert.ok(findBtnByText(tree, '新建'), '轮播列表必须有「新建」');
    findBtnByText(tree, '新建').props.onClick();
    tree = renderPicker();
    const nameInput = findByProp(tree, 'aria-label', '轮播列表名称');
    assert.ok(nameInput && typeof nameInput.props.onInput === 'function', '新建 ⇒ 打开编辑页（名称输入框）');
    assert.ok(findByProp(tree, 'aria-label', '轮播间隔'), '编辑页要有间隔档');
    assert.ok(findByProp(tree, 'aria-label', '轮播顺序'), '编辑页要有顺序档');
    // 选片走页内下钻（编辑器不再有内联网格）：点编辑器里的「选择壁纸」进库视图，
    // 草稿态点卡片 = 加入/移出，「返回」回编辑器继续保存。
    const editorPane = findByClass(tree, 'we-picker__editor');
    assert.ok(editorPane, '新建 ⇒ 编辑器必须在场');
    const draftOpen = findBtnByText(editorPane, '选择壁纸');
    assert.ok(draftOpen && typeof draftOpen.props.onClick === 'function', '编辑页要给「选择壁纸」下钻入口');
    draftOpen.props.onClick();
    tree = renderPicker();
    assert.ok(findByClass(tree, 'we-picker__modal'), '点选择壁纸 ⇒ 下钻库视图打开');
    assert.ok(!textOf(tree).includes('✕ 关闭'), '草稿态不渲染「关闭壁纸」卡（挑列表与当前播放无关）');
    const draftCard = findByClass(tree, 'we-picker__card');
    assert.ok(draftCard && typeof draftCard.props.onClick === 'function', '下钻视图要列出壁纸卡（首张即壁纸）');
    draftCard.props.onClick();
    tree = renderPicker();
    assert.ok(textOf(tree).includes('已选 1 个'), '点卡片 ⇒ 草稿已选 1 个（下钻顶部计数）');
    findBtnByText(tree, '返回').props.onClick();
    tree = renderPicker();
    assert.ok(findByProp(tree, 'aria-label', '轮播列表名称'), '返回 ⇒ 回到编辑器（名称输入在场）');
    assert.ok(textOf(tree).includes('已选 1 个'), '返回后编辑器仍显示已选 1 个');
    nameInput.props.onInput({ target: { value: '新列表' } });
    tree = renderPicker();
    assert.equal(findByProp(tree, 'aria-label', '轮播列表名称').props.value, '新列表', '名称输入回写草稿');
    assert.equal(groupOptionCount(tree), 0, '保存之前下拉里仍是 0 个（判据能区分保存前后）');
    findBtnByText(tree, '保存').props.onClick();
    tree = renderPicker();
    assert.equal(groupOptionCount(tree), 1, '保存 ⇒ 轮播列表从 0 变成 1');
    assert.ok(groupOptionText(findByProp(tree, 'aria-label', '轮播列表')).includes('新列表'),
      '新列表以草稿里的名字出现在下拉里');
    assert.equal(findByProp(tree, 'aria-label', '轮播列表名称'), null, '保存后编辑页关闭');
    // 负对照：把变异输入喂进同一条"下拉里出现该名字"判据
    assert.ok(!groupOptionText({ children: ['别的列表（1 可播放 · 5 分钟）'] }).includes('新列表'),
      '负对照：同一条判据对不含该名字的选项文案为假');
    // 切换活动列表：再造一个（夹具只有一个 ⇒ 要测"切到另一个"就得先造第二个）
    const optionIds = (t) => findByProp(t, 'aria-label', '轮播列表').children
      .filter((o) => o && o.props && o.props.value).map((o) => o.props.value);
    assert.equal(optionIds(tree).length, 1, '此刻恰好一个列表');
    findBtnByText(tree, '新建').props.onClick();
    tree = renderPicker();
    findByProp(tree, 'aria-label', '轮播列表名称').props.onInput({ target: { value: '第二个' } });
    tree = renderPicker();
    // 第二个列表同样走下钻选片（选片只有一个入口：库视图）。
    findBtnByText(findByClass(tree, 'we-picker__editor'), '选择壁纸').props.onClick();
    tree = renderPicker();
    findByClass(tree, 'we-picker__card').props.onClick();
    tree = renderPicker();
    findBtnByText(tree, '返回').props.onClick();
    tree = renderPicker();
    findBtnByText(tree, '保存').props.onClick();
    tree = renderPicker();
    assert.equal(optionIds(tree).length, 2, '再保存一个 ⇒ 两个列表');
    const activeNow = findByProp(tree, 'aria-label', '轮播列表').props.value;
    const other = optionIds(tree).find((id) => id !== activeNow);
    findByProp(tree, 'aria-label', '轮播列表').props.onChange({ target: { value: other } });
    tree = renderPicker();
    assert.equal(findByProp(tree, 'aria-label', '轮播列表').props.value, other,
      'onGroupChange ⇒ 活动列表真的切过去了（下拉值跟着变）');

    // ── 0b：批量隐藏（**面板内确认**）+ 隐藏页「全部恢复」────────────────────
    // 每一步都是"第一下只待确认、问句行的按钮才落地"：先「取消」（不隐藏、且不退批量），
    // 再「确认」（隐藏并从网格消失、自动退批量），最后用隐藏页的「全部恢复」把状态收回去。
    // 三步都读**渲染出的**证据。
    // 批量操作住在库视图里：上面的页签用例已把库视图退出 ⇒ 重新打开（真实路径）。
    findBtnByText(tree, '选择壁纸').props.onClick();
    tree = renderPicker();
    assert.ok(clickPager(tree, '批量'), '批量按钮必须存在');
    tree = renderPicker();
    const batchPick = collectCards(tree).find((c) => JSON.stringify(c).includes('Wall 0'));
    assert.ok(batchPick && typeof batchPick.props.onClick === 'function', '批量模式下卡片可点');
    batchPick.props.onClick();
    tree = renderPicker();
    findBtnByText(tree, '批量隐藏').props.onClick();
    tree = renderPicker();
    assert.ok(findByClass(tree, 'we-picker__confirm-row'), '「批量隐藏」第一下必须出现问句行');
    assert.ok(textOf(findByClass(tree, 'we-picker__confirm-row')).includes('1 张'),
      '问句按**当前**选中数现算（不是缓存下来的常量）：' + textOf(findByClass(tree, 'we-picker__confirm-row')));
    confirmRowBtn(tree, '取消').props.onClick();
    tree = renderPicker();
    assert.ok(wallpaperCardTexts(tree).some((s) => s.includes('"Wall 0"')), '取消 ⇒ 不隐藏（取消就是取消）');
    assert.ok(findByClass(tree, 'we-picker__batch-bar'), '取消 ⇒ 仍留在批量模式（选择没被清掉）');
    findBtnByText(tree, '批量隐藏').props.onClick();
    tree = renderPicker();
    confirmRowBtn(tree, '确认').props.onClick();
    tree = renderPicker();
    assert.ok(!wallpaperCardTexts(tree).some((s) => s.includes('"Wall 0"')), '确认 ⇒ 被隐藏的壁纸退出网格');
    assert.equal(findByClass(tree, 'we-picker__batch-bar'), null, '隐藏成功后自动退出批量模式');
    findHiddenTab(tree).props.onClick();
    tree = renderPicker();
    assert.ok(textOf(tree).includes('已隐藏 ' + (beforeHidden + 1) + ' 张'),
      '隐藏页计数 +1（批量隐藏走的是同一条隐藏路径）');
    assert.ok(findBtnByText(tree, '全部恢复'), '隐藏页必须有「全部恢复」');
    findBtnByText(tree, '全部恢复').props.onClick();
    tree = renderPicker();
    assert.ok(findByClass(tree, 'we-picker__confirm-row'), '「全部恢复」第一下必须出现问句行');
    assert.ok(textOf(findHiddenTab(tree)).includes('已隐藏（' + (beforeHidden + 1) + '）'),
      '待确认期间**没有恢复任何东西**（第一下只置令牌，计数不动）');
    confirmRowBtn(tree, '确认').props.onClick();
    tree = renderPicker();
    assert.ok(textOf(findHiddenTab(tree)).includes('已隐藏（' + beforeHidden + '）'), '确认 ⇒ 计数回到零基');
    findByClass(tree, 'we-picker__tab').props.onClick();
    tree = renderPicker();
    assert.ok(wallpaperCardTexts(tree).some((s) => s.includes('"Wall 0"')), '确认 ⇒ 那张壁纸回到网格');
    // 0b 段的收口断言：**全程零原生模态**。探针答 false ⇒ 真出现原生 confirm 时上面那些
    // "确认之后真的变了"的判据会全部变红，这里再把"一次都没发生"直接钉住。
    assert.equal(nativeModalCalls, 0, '全程零原生 window.confirm（破坏性动作一律走面板内确认）');

    // ── 0b：库存加载失败的错误态 + 「重试」恢复（WallpaperPicker 的两条早退分支）──
    // 进错误态的唯一入口是"重载库存失败"⇒ 先用页签里的「刷新」把它打失败（真实路径，不是注入状态）。
    // 「刷新」住在页签内容里，而库视图此时开着 ⇒ 先经「返回」退出（页内下钻两棵树互斥）。
    findBtnByText(tree, '返回').props.onClick();
    tree = renderPicker();
    const showsInventoryError = (t) => textOf(t).includes('未检测到 Wallpaper Engine：');
    inventoryFails = true;
    findBtnByText(tree, '刷新').props.onClick();
    await new Promise((r) => setTimeout(r, 80)); // 等 loadInventory 的 promise 落定
    tree = renderPicker();
    assert.ok(showsInventoryError(tree), '库存加载失败 ⇒ 显示「未检测到 Wallpaper Engine：<原因>」');
    assert.ok(findBtnByText(tree, '重试'), '错误态必须给「重试」按钮（否则用户无路可走）');
    assert.equal(findBtnByText(tree, '刷新'), null, '错误态下整块面板被替换（不是叠在面板上）');
    // 负对照：把变异输入喂进同一条判据
    assert.ok(showsInventoryError({ children: ['未检测到 Wallpaper Engine：合成'] }),
      '负对照：合成文本必须被判为错误态（判据读的是渲染文本，不是常量）');
    // 重试：开关放回成功 ⇒ 点「重试」⇒ 面板与网格都应回来
    inventoryFails = false;
    findBtnByText(tree, '重试').props.onClick();
    await new Promise((r) => setTimeout(r, 80));
    tree = renderPicker();
    assert.ok(!showsInventoryError(tree), '重试成功 ⇒ 错误态消失');
    assert.ok(findBtnByText(tree, '选择壁纸'), '恢复后回到正常面板（页签内容回来了；类型筛选在库视图里，下钻打开即有）');

    // ── 0b：ESC 关闭 picker（处理器住在 useEffect 里 ⇒ 必须让 effect 跑一次才可达）──────
    // 做法：**临时**把 mock 的 `useEffect` 换成收集器 ⇒ 渲染一次拿到注册函数 ⇒ 立刻还原 ⇒
    // 再跑收集到的 effect（它们只做注册）⇒ 派发 keydown。全程不改全局行为，所以不会牵动既有
    // 断言里的定时器与监听时序（把 useEffect 永久改成"会跑"会打开一堆路径，那是另一件事）。
    if (!findByClass(tree, 'we-picker__modal')) {
      const reopener = findBtnByText(tree, '选择壁纸');
      assert.ok(reopener, '前置：模态框关着时必须能找到「选择壁纸」入口');
      reopener.props.onClick();
      tree = renderPicker();
    }
    assert.ok(findByClass(tree, 'we-picker__modal'), '前置：模态框当前是打开的');
    const collectedEffects = [];
    const realUseEffect = React.useEffect;
    React.useEffect = (fn) => { collectedEffects.push(fn); };
    tree = renderPicker();
    React.useEffect = realUseEffect;
    assert.ok(collectedEffects.length >= 1, '渲染期必须注册 effect（ESC 处理器就住在里面）');
    const keydownBefore = (winListeners['keydown'] || []).length;
    for (const fn of collectedEffects) { try { fn(); } catch { /* 依赖挂载台没有的宿主接口的 effect，忽略 */ } }
    assert.ok((winListeners['keydown'] || []).length > keydownBefore,
      '窗口上必须因此多一个 keydown 处理器（capture 注册）');
    const dispatchKey = (key) => {
      const beforeOpen = !!findByClass(renderPicker(), 'we-picker__modal');
      for (const fn of [...(winListeners['keydown'] || [])]) {
        fn({ key, type: 'keydown', stopPropagation() {}, preventDefault() {} });
      }
      return { beforeOpen, afterOpen: !!findByClass(renderPicker(), 'we-picker__modal') };
    };
    assert.deepEqual(dispatchKey('Enter'), { beforeOpen: true, afterOpen: true },
      '负对照：非 Escape 键不得关闭（与下一条共用同一条判据）');
    assert.deepEqual(dispatchKey('Escape'), { beforeOpen: true, afterOpen: false },
      'Escape ⇒ 关闭 picker（模态框从渲染树里消失）');

    // Turn the active wallpaper off through the real picker callback. Sidebar
    // theming must remain armed because it is an independent feature; only
    // wallpaper-owned layers and the data-we-wallpaper marker disappear.
    // 页面玻璃同理：data-we-glass-page 是"插件在跑"的锚点，**不**跟着壁纸走 ——
    // 它一掉，整个令牌映射与对话栏玻璃就整组不匹配（用户报障：玻璃只在设了壁纸后生效）。
    const closeCard = cards.find((card) => JSON.stringify(card).includes('✕ 关闭'));
    assert.ok(closeCard && typeof closeCard.props.onClick === 'function', 'close-wallpaper card must be available');
    assert.equal(bodyEl.attributes['data-we-glass-page'], 'on', '前置：页面玻璃锚点在壁纸在场时就是挂着的');
    closeCard.props.onClick();
    assert.equal(bodyEl.attributes['data-we-wallpaper'], undefined, 'wallpaper marker must clear');
    assert.equal(bodyEl.attributes['data-we-glass-page'], 'on', 'page glass must stay armed without a wallpaper');
    assert.equal(bodyEl.attributes['data-we-sidebar-glass'], 'on', 'sidebar glass must remain enabled');
    assert.equal(typeof p['--we-sidebar-color'], 'string', 'sidebar color variable must remain available');
    // 这里原本还有一条 `--we-sidebar-alpha`。它被删掉是因为该变量是**死码**：
    // 整份样式表里精确出现 1 次、且那次在注释里，没有任何 CSS 消费者（登记表实测确认）。
    // 断言"一个没人读的变量必须继续存在"守的是保真度的反面（adr/0007 第 4 问）。
    // 侧栏透明度真正接线的是它的两个下游：--we-sidebar-sheen / --we-sidebar-tint。
    assert.equal(typeof p['--we-sidebar-sheen'], 'string', 'sidebar sheen variable must remain available');
    assert.equal(typeof p['--we-sidebar-tint'], 'string', 'sidebar tint variable must remain available');
    assert.equal(typeof p['--we-sidebar-blur'], 'string', 'sidebar blur variable must remain available');
    console.log('sidebar glass remains armed without an active wallpaper: true');
  }

  // ── GPU 抓帧缓存：状态提示 + 清除入口（面板）──────────────────────────
  // 按用户决策：_gpu.png 存在时优先于「出图来源」全部档位，所以切档位
  // 的前置动作是先清除。这里验证完整链路：选中场景 → HEAD 探测 → 面板出现
  // 「清除 GPU 帧」→ 点击 → DELETE 打到 host → 提示行消失。
  {
    // 与上文 setTab 同款：mock 的 useState 每次渲染都取 initializer，
    // 重新种 localStorage 再渲染即可确定性地切到目标 tab。
    // 「画面」section（出图来源 + GPU 帧行）在「效果」tab 里。
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
    // 否则 scene C 是首层、无旧层可淡，手动淡出的断言失去对象。Wall 0 在虚拟
    // 首窗里（窗口第 1 个条目），直接可点。
    let seedCard = findCard(tree3, 'Wall 0');
    assert.ok(seedCard && typeof seedCard.props.onClick === 'function', 'video card (Wall 0) must be clickable');
    seedCard.props.onClick(); // 建首层（existing=null → 本步不淡，正常）
    tree3 = reopenPicker();
    // 场景 C 在窗外（库存第 33 张）—— 分页已退役，窗外条目靠**搜索**收敛进场。
    // 本回调自己的搜索框查找器（这里不共享外层助手作用域）。
    const findSearch = (root) => { let hit = null; (function walkS(n) {
      if (hit) return;
      if (Array.isArray(n)) { n.forEach(walkS); return; }
      if (!n || typeof n !== 'object') return;
      const c = typeof n.props?.className === 'string' ? n.props.className : '';
      if (c.split(/\s+/).includes('we-picker__search')) { hit = n; return; }
      if (Array.isArray(n.children)) n.children.forEach(walkS);
    })(root); return hit; };
    const search3 = findSearch(tree3);
    assert.ok(search3 && typeof search3.props.onInput === 'function', 'search box available for out-of-window cards');
    search3.props.onInput({ target: { value: 'Scene C' } });
    tree3 = reopenPicker();
    let sceneCard = findCard(tree3, 'Scene C');
    assert.ok(sceneCard && typeof sceneCard.props.onClick === 'function', 'scene C card must be clickable');
    findSearch(tree3).props.onInput({ target: { value: '' } });
    tree3 = reopenPicker();
    const manualPreLayer = document.getElementById('dsh-wallpaper-engine-layer');
    sceneCard.props.onClick(); // 选中场景壁纸 → syncLayers → HEAD 探测
    await new Promise((r) => setTimeout(r, 20)); // 等 HEAD 探测的 promise 回来
    // 「画面」section（含 GPU 提示行）在页签内容里，库视图只渲染网格且与页签内容
    // 互斥（页内下钻）→ 选中后退出库视图再断言（退出按钮文案恰为「返回」）。
    const modalClose = findBtn(renderPicker(), '返回');
    assert.ok(modalClose, '库视图应有「返回」按钮');
    modalClose.props.onClick();
    assert.ok(sceneFrameHeadCalls.some((u) => u.includes('/scene-frame/ccc')),
      '选中场景壁纸后必须 HEAD 探测 GPU 帧状态（面板据此提示）');
    // ── 手动切换（非轮换）也是交叉淡化：判据按 weWid 判定（层上 weWid ≠ 当前选择 id →
    //    淡出），而不是只认轮换 commit 置的 pendingRotationFade —— 否则手动点选会硬切，
    //    旧层即拆、下一张的静态帧缓存直接上屏。syncLayers 在 onClick 内同步完成，无需再等待。
    const manualPostLayer = document.getElementById('dsh-wallpaper-engine-layer');
    assert.ok(manualPreLayer && manualPreLayer.dataset.weFading === '1',
      '手动切换：旧壁纸层必须标记 weFading 淡出保留（不得即拆）');
    assert.ok(manualPreLayer.id === '',
      '手动切换：旧层必须让出 LAYER_ID');
    assert.ok(manualPostLayer && manualPostLayer !== manualPreLayer
      && manualPostLayer.className.indexOf('we-layer--switch') !== -1,
      '手动切换：新层必须带 switch 过场类（交叉淡化，不是硬切）');
    assert.ok(manualPostLayer.dataset.weWid === 'c',
      '新层必须记录 weWid（后续重建按它判定是否换壁纸）');
    tree3 = renderPicker(); // 模态框已关：此时渲染的是 tab 面板（含「画面」section）
    // 画面来源三行的门禁：
    // 「出图来源」换的是 CPU 静态帧 → 只在 live 未生效时出现；「实时帧」（GPU 抓帧
    // 的重新截 / 清除 / 微缩预览）与「自定义画面」**不受实时渲染开关影响** —— 那张静帧
    // 正是切换途中与 live 首帧前给用户看的画面，构图不对时必须能立刻重抓。
    assert.ok(JSON.stringify(tree3).includes('出图来源'), '选中场景壁纸后面板应出现「出图来源」行');
    assert.ok(JSON.stringify(tree3).includes('自定义画面'),
      '「自定义画面」行必须可见（live 开着时也要能导入截图）');
    assert.ok(JSON.stringify(tree3).indexOf('出图来源') > JSON.stringify(tree3).indexOf('场景实时渲染'),
      '「出图来源」必须排在「场景实时渲染」开关注下方');
    // ── 实时帧：重新截 + 微缩预览（当前壁纸实时帧） ──
    {
      const gpuText = JSON.stringify(tree3);
      assert.ok(gpuText.includes('"重新截"'), '面板必须给出「重新截」（实时渲染开着时也能重抓当前帧）');
      assert.ok(gpuText.includes('实时帧'), '「实时帧」分组必须存在');
      const shot = (function find(n) {
        if (!n || typeof n !== 'object') return null;
        if (Array.isArray(n)) { for (const c of n) { const r = find(c); if (r) return r; } return null; }
        if (n.type === 'img' && String(n.props && n.props.className).includes('we-picker__frame-shot')) return n;
        if (Array.isArray(n.children)) { for (const c of n.children) { const r = find(c); if (r) return r; } }
        return null;
      })(tree3);
      assert.ok(shot, '槽里有实时帧时必须给出「当前壁纸实时帧」微缩预览');
      assert.ok(String(shot.props.src).indexOf('/scene-frame/ccc') !== -1
        && String(shot.props.src).indexOf('we-prev=') !== -1,
        '预览必须指向层里正在用的那个 scene-frame URL（+ 缓存破坏参数），否则预览与实屏不一致');
      assert.ok(gpuText.includes('2488×1376'),
        '预览旁必须显示实时帧的像素尺寸（宿主 X-WE-GPU-W/H）');
      // 「重新截」在**没有实时渲染**时的行为：给出可读原因，且**不许**动现有缓存。
      const deletesBefore = sceneFrameDeleteCalls.length;
      const recaptureBtn = findBtn(tree3, '重新截');
      assert.ok(recaptureBtn && typeof recaptureBtn.props.onClick === 'function', '「重新截」必须可点');
      recaptureBtn.props.onClick();
      tree3 = renderPicker();
      assert.ok(JSON.stringify(tree3).includes('拿不到实时画面'),
        '没有实时渲染时点「重新截」必须说明原因（而不是静默无事发生）');
      assert.equal(sceneFrameDeleteCalls.length, deletesBefore,
        '没有实时画面时「重新截」不得删除现有缓存（安全顺序：先抓到才清旧）');
      console.log('实时帧：重新截 + 微缩预览: ok');
    }
    assert.equal(animProbeSrcs.length, 0,
      '槽位已有 GPU 帧时不得启动任何 CPU 动画渲染（scene-anim 已删除）');
    // ── 高级页签：省电三档 + 实时渲染诊断（都从「效果」移来） ──
    {
      localStorage.setItem('dsh-wallpaper-engine:picker-tab', 'advanced');
      const adv = JSON.stringify(renderPicker());
      assert.ok(adv.includes('省电') && adv.includes('最小化/切页时暂停')
        && adv.includes('窗口失焦时暂停') && adv.includes('使用电池时暂停'),
        '高级 must host the 省电 group');
      assert.ok(adv.includes('实时渲染诊断'), '高级 must host the live 诊断 group');
      localStorage.setItem('dsh-wallpaper-engine:picker-tab', 'effects');
      const eff = JSON.stringify(renderPicker());
      assert.ok(!eff.includes('最小化/切页时暂停'), '省电 must not stay in 效果');
      assert.ok(!eff.includes('实时渲染诊断'), '实时渲染诊断 must not stay in 效果');
      console.log('省电 / live 诊断已迁到高级（效果里不再有）: ok');
    }
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
    // MP4 → 静态帧 → 单张大图 → 内嵌图；**没有 CPU 动画渲染**。清除 GPU 抓帧后画面回落
    // 静态帧链即可，不得启动分钟级的 CPU 渲染。
    assert.equal(animProbeSrcs.length, 0,
      '清除 GPU 帧后不得启动 CPU scene-anim 渲染（该路线已删除）');
    console.log('GPU 帧提示 + 清除入口链路: ok');
    console.log('GPU 帧优先于静态帧（清除后回落静态帧链，不再有 CPU 渲染）: ok');

    // ── CPU 动画渲染：源码里**钉死**这条路线不存在 ────────────────────────
    // 目标形态：场景动画只保留 WebWallGL live 一条路线，回退链是
    // MP4 → 静态帧 → 单张大图 → 内嵌图；**没有 CPU 动画渲染**（那种路线是分钟级 CPU 渲染，
    // 且会把 live 抓帧的静帧覆盖掉）。下面把它那一族入口逐个钉死：这些名字一旦回到源码，
    // 就说明这条路线被接了回来（点帧率档位重渲染、产物上屏、被 GPU 帧门禁挡住，一并失效）。
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
    // - 轮换/手动切壁纸的过场（.we-layer--switch）= 类型基准 × 速度档；其中
    //   「交叉淡化」的基准直接引用 ROTATION_FADE_MS（1800ms），所以这两者对齐由
    //   SWITCH_TRANSITIONS 保证（下面按源码断言），CSS 只认内联 --we-switch-ms；
    // - GPU 静帧 → live 首帧（.we-live-iframe）= LIVE_FIRST_FADE_MS（1800ms）：
    //   手动切换壁纸时「静帧 → 实时画面」的缓慢过渡正是这条腿。0.8s 短窗口
    //   实测过渡太急，按用户明确要求回到与轮换同口径的 1.8s。
    const liveIframeCss = code.match(/\.we-layer \.we-live-iframe\s*\{[^}]*\}/);
    assert.ok(code.includes('ROTATION_FADE_MS = 1800') && code.includes('LIVE_FIRST_FADE_MS = 1800')
      && liveIframeCss && /transition:\s*opacity 1\.8s ease/.test(liveIframeCss[0]),
      '渐变时长必须与常量同步（live 首帧=LIVE_FIRST_FADE_MS 1.8s），改常量时同步 CSS');
    // 过场：时长由内联 --we-switch-ms 驱动（类型基准 × 速度档），CSS 侧三属性都读它 ——
    // 既保证「改基准只动一处」，也避免再出现「常量改了 CSS 忘改」的漂移。
    const switchCss = code.match(/\.we-layer--switch\s*\{[^}]*\}/);
    assert.ok(switchCss
      && ['transform', 'opacity', 'clip-path'].every((pv) =>
        new RegExp(pv + '\\s+var\\(--we-switch-ms').test(switchCss[0])),
      '过场必须只动 transform / opacity / clip-path，且时长统一取 --we-switch-ms（合成器友好 + 单一真源）');
    // i18n 之后 label 是 getter（`get label() { return weT("交叉淡化"); }`）——文案必须在
    // **渲染期**求值，不能在模块加载时冻结。判据因此改成"**只取 fade 这一条**对账"：
    // 它必须引用 ROTATION_FADE_MS、且**不得**出现 `ms: <数字>`（写死 1800 就会被判红）。
    // 不能再用 `[^}]*` 切条目：getter 体里自带 `}`，会把条目切在半路（判据静默失真）。
    const fadeFrom = code.indexOf('{ id: "fade"');
    const fadeNext = fadeFrom < 0 ? -1 : code.indexOf('{ id: "', fadeFrom + 4);
    const fadeEntry = fadeFrom >= 0 && fadeNext > fadeFrom ? code.slice(fadeFrom, fadeNext) : '';
    assert.ok(fadeEntry.includes('ms: ROTATION_FADE_MS') && !/ms: \d/.test(fadeEntry),
      '「交叉淡化」的基准必须直接引用 ROTATION_FADE_MS（不写死 1800）');

    // ⑤d 设置键**两端一致**（#106 那类「宿主白名单漏键 → 客户端设置被静默丢弃」的漂移）。
    // "从两边源码文本里抠键名"这条路不可行：两侧都改为**派生**（唯一真源
    // lib/settings-schema.js），源码里没有手写键列表可抠，而且抠名字也证明不了
    // "宿主真的会接受"。所以改判 ①键集派生 ②结构上必须委托 ③**行为**逐键与 golden 一致。
    {
      const src = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');
      const persistSrc = readFileSync(new URL('../src/persistence.js', import.meta.url), 'utf8');
      const host = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8');
      const schemaMod = await import(new URL('../lib/settings-schema.js', import.meta.url).href);
      const { sanitizeFromSchema, serializeSettings, CLIENT_ONLY, DEFAULTS_ONLY, KINDS, DEFAULTS } = schemaMod;

      const persisted = Object.keys(serializeSettings({}));
      const clientSan = Object.keys(sanitizeFromSchema({}, 'client'));
      const hostSan = Object.keys(sanitizeFromSchema({}, 'host'));

      // ① 键集恒等式（全部派生，无手写清单）
      assert.deepEqual(persisted.slice().sort(), clientSan.slice().sort(),
        '持久化白名单必须与客户端 sanitize 键集完全相同');
      assert.deepEqual(hostSan.slice().sort(),
        clientSan.filter((k) => !CLIENT_ONLY.includes(k)).sort(),
        '宿主接受的键集 = 客户端键集 − CLIENT_ONLY');
      for (const k of CLIENT_ONLY) {
        assert.ok(clientSan.includes(k) && !hostSan.includes(k), 'CLIENT_ONLY 必须只存在于客户端：' + k);
      }
      for (const k of DEFAULTS_ONLY) {
        assert.ok(!clientSan.includes(k) && !hostSan.includes(k) && k in DEFAULTS,
          'DEFAULTS_ONLY 必须只在默认值里：' + k);
      }
      assert.ok(clientSan.includes('id') && hostSan.includes('id') && !('id' in DEFAULTS),
        'id 必须在两侧白名单里但不在 DEFAULTS 里（它是选中项，不是设置项）');

      // ①b F3 阶段 2：六个字体键**不在** settings 的持久化白名单里 —— 它们的值住
      //    `fontsets/<id>.json`（客户端通道见 src/fontset-store.js，宿主侧见 lib/routes/fontsets.js）。
      //    与下面的 golden 夹具互为印证：这些键一旦回到白名单，宿主输出就会多出它们、夹具当场漂移。
      //    kind 元数据与默认值**仍须在册**：`sanitizeFontset` 按 `KINDS` 的 kind 消毒、按 `DEFAULTS` 兜底。
      const FONT_KEYS = ['themeColors', 'themeDarkSeparate', 'themeSize', 'themeWeight', 'themeFamily', 'globalFamily', 'componentFonts'];
      assert.deepEqual(FONT_KEYS.filter((k) => persisted.includes(k) || hostSan.includes(k)), [],
        '字体值自 F3 起住字体集文件，不得回到 settings 白名单');
      assert.ok(FONT_KEYS.every((k) => k in KINDS && k in DEFAULTS),
        '字体键的 kind 元数据与默认值仍须在 schema 里（sanitizeFontset 用）');

      // ①c `DEFAULTS_ONLY` 键**不得经落盘通道写**。三条入口的分工是：`setSetting` / `setFontValues`
      //    = 改设置**并落盘**，`setTransient` = 改瞬态字段、不落盘。一个不在持久化白名单里的键走
      //    `setSetting` ⇒ 白跑一次 debounce + 一次多余的宿主 PUT，而且**读起来像它会持久化**
      //    （实测一处：`onFontResetAll` 里写 `fontAdvanced`）。
      //    ⚠️ 判据**只禁落盘通道**，不禁裸直写：`media-prep.js` 的 `applySelection` 是**整批直写后
      //    一次 persist**（`type` / `blockedNote` / `sceneVideo` … 同型），禁裸写会逼出任意豁免。
      //    扫描面 = **产物**（= 全部内联模块的正文 ⇒ 不可能漏调用方，也不需要维护"可能是调用方的
      //    文件"清单 —— 清单漏一个文件，判据在那个文件上就恒真）。键集从 `DEFAULTS_ONLY` 派生。
      //    注释先剥掉（共享的字符串感知实现，见 test/tools/js-text.mjs）：`setTransient` 那条
      //    契约注释里正好点名了这些键。
      const persistingWritesOf = (text) => {
        const t = stripComments(text);
        return DEFAULTS_ONLY.filter((k) =>
          new RegExp('setSetting\\(\\s*[\'"]' + k + '[\'"]').test(t)
          || new RegExp('setFontValues\\(\\s*\\{[^}]*\\b' + k + '\\s*:').test(t));
      };
      assert.deepEqual(persistingWritesOf(code), [],
        'DEFAULTS_ONLY 键不得经落盘通道（setSetting / setFontValues）写：'
        + persistingWritesOf(code).join(', '));
      assert.deepEqual(persistingWritesOf('setSetting("fontAdvanced", false);'), ['fontAdvanced'],
        'negative control: 经落盘通道写仅默认值键会被判出');
      assert.deepEqual(persistingWritesOf('setFontValues({ themeTypeOnly: 1 });'), ['themeTypeOnly'],
        'negative control: 字体值入口写仅默认值键同样会被判出');
      assert.deepEqual(persistingWritesOf(
        'setTransient("fontAdvanced", false);\n// setSetting("fontAdvanced", x)\n/* setSetting("themeTypeOnly", y) */'),
      [], 'positive control: setTransient 本身、以及注释里的写法都不算（判据不是恒真）');

      // ①d `src/client.js` 里**非持久化字段**必须经 `setTransient` 改（契约的第三条入口）。
      //    口径由实现派生、**不维护字段清单**：持久化白名单 = `persisted`（`serializeSettings` 带的键），
      //    再排除 `id`（由 settings blob 顶层携带）与 `FONT_KEYS`（走字体集通道）⇒ 其余字段只在内存里
      //    活着，对它们落盘没有意义，裸直写 `selection.x = v` 等于绕过了"唯一入口"那句话。
      //    扫描面 = `src/client.js`：它是 store 的**属主**，三个入口都在这里。其它模块手上只有
      //    `selection`（没有入口可调）⇒ 它们的直写不在本条范围内，由 ①e 的上界棘轮盯着。
      const transientBareWrites = (text) => {
        const code = stripComments(text);
        const out = [];
        for (const m of code.matchAll(/(?<![\w.$])selection\.([\w$]+)\s*=(?!=)/g)) {
          const k = m[1];
          if (persisted.includes(k) || k === 'id' || FONT_KEYS.includes(k)) continue;
          out.push(k);
        }
        return out;
      };
      assert.deepEqual(transientBareWrites(src), [],
        'client.js 里非持久化字段必须经 setTransient 写，不得裸直写：' + transientBareWrites(src).join(', '));
      assert.deepEqual(transientBareWrites('selection.uploading = true;'), ['uploading'],
        'negative control: 瞬态字段裸直写会被判出');
      assert.deepEqual(transientBareWrites('selection.videoVolume = 0.5;'), [],
        'positive control: 持久化字段的直写不算（那条通道归 setSetting / ①c 管）');
      assert.deepEqual(transientBareWrites('setTransient("uploading", true);'), [],
        'positive control: 经 setTransient 写不算（判据不是恒真）');
      assert.deepEqual(transientBareWrites('// selection.uploading = true;'), [],
        'positive control: 注释里的写法不算（先剥注释）');
      assert.deepEqual(transientBareWrites('wrapper.selection.uploading = true;'), [],
        'positive control: 别的对象的同名字段不算（按 `selection.` 收口）');

      // ①e 上界棘轮：**其它模块**里对"已知瞬态字段"的裸直写（它们没有入口可调）。
      //    "已知瞬态字段" = 本仓任何 `setTransient("…")` 点过名的字段（派生，不手写清单）。
      //    ⚠️ 这 11 处**不是"孤立瞬态写入"**：读过一遍，是三类型路径，裸写是它们的**形态**而不是疏忽 ——
      //      · `src/media-prep.js` ×6 —— **整批应用**（`applySelection` 一族：写一批字段后一次
      //        `persistSelection()`；同一批里还有持久化字段与 `type` / `id` 等）；
      //      · `src/live-layer.js` ×2 —— `syncLayers` 内部，**本次渲染正由 emit 驱动**（源码注释写明
      //        "这里不 emit：本次 syncLayers 正是由 emit 驱动的"）；
      //      · `src/effects.js` ×3 —— **卸载清理**（禁用 / HMR 后不留上一张壁纸的播放态）。
      //      · `src/preset-store.js` ×1 —— 通道失败文案的唯一写点（`setPresetError` 助手：
      //        清单 / 应用 / 保存 / 删除四条路的失败与清空都汇到它，写点收口是一处 ——
      //        2026-10-04 引入玻璃预设时按本棘轮要求归的类）。
      //      给它们注入入口是**仪式**而不是收口（"禁裸写会逼出任意豁免"那条注记就是这个意思）⇒ 这条
      //      棘轮的作用是**不许变多**：新增一处即红，由人判定它属于哪一类，并顺手把上界按实测下调。
      //
      //    ⚠️ **扫描面必须从 `INLINE_MODULES` 派生**（原先写的是 `readdirSync('../src/')` +
      //      `.filter(f => f.endsWith('.js'))`）：那条路径**按目录项名判扩展名**，而目录项名不以
      //      `.js` 结尾 ⇒ **`src/font/` 整个目录隐式脱出判据**（实测），且 `lib/settings-schema.js`
      //      这个"两侧共用内核"从来没被扫过。这正是 DEV-GUIDE §4.7 约定 4 禁止的形状 ——
      //      手工清单漏一行，那个文件**静默失去覆盖**。所以扫描面取**真源**：构建脚本里被内联的每一个文件。
      const REMAINING_CROSS_MODULE_MAX = 12;
      const repoRoot = new URL('../', import.meta.url);
      /** 被内联进 bundle 的每一个文件（真源 = 构建脚本的 INLINE_MODULES）。 */
      const inlineModules = (() => {
        const region = readFileSync(new URL('scripts/build-client.mjs', repoRoot), 'utf8')
          .match(/const INLINE_MODULES = \[([\s\S]*?)\n\];/);
        return region ? [...region[1].matchAll(/file:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]) : [];
      })();
      // `src/client.js` **不在** INLINE_MODULES 里 —— 它是正文，构建脚本单独读它。
      // 漏掉它 = 瞬态字段的域几乎为空（实测：只剩 4 个），判据当场失效。
      const CLIENT_BODY = 'src/client.js';
      const scannedModules = [CLIENT_BODY, ...inlineModules.filter((f) => f !== CLIENT_BODY)];
      const moduleTextOf = (f) => readFileSync(new URL(f, repoRoot), 'utf8');
      // 覆盖面地板：与扫描逻辑**无关**的绝对数（解析器静默返回空表 / 清单被删空时，下面每条都会空转）。
      const SCAN_FLOOR = { modules: 20, subdirModules: 3, transient: 20 };
      assert.ok(inlineModules.length >= SCAN_FLOOR.modules,
        '覆盖面：INLINE_MODULES 解析出 ≥' + SCAN_FLOOR.modules + ' 项（防解析器返回空表）—— 得 ' + inlineModules.length);
      assert.ok(scannedModules.includes(CLIENT_BODY),
        '覆盖面：扫描面必须含正文 ' + CLIENT_BODY + '（它不在 INLINE_MODULES 里，漏掉它瞬态域会空）');
      assert.ok(inlineModules.includes('lib/settings-schema.js'),
        '覆盖面：扫描面必须含"两侧共用内核" lib/settings-schema.js');
      assert.ok(scannedModules.filter((f) => /^src\/[^/]+\//.test(f)).length >= SCAN_FLOOR.subdirModules,
        '覆盖面：扫描面含 ≥' + SCAN_FLOOR.subdirModules + ' 个 src/ **子目录**里的模块（' +
        '原先的 readdirSync 写法在这里恒为 0，正是本判据要防的回归）');
      assert.ok(scannedModules.every((f) => { try { return readFileSync(new URL(f, repoRoot), 'utf8').length > 0; } catch { return false; } }),
        '登记的每个 file 都能读到');
      // 负对照（合成输入 → 同一个判据）：合成清单里放一个 src/ 子目录模块，覆盖面断言必须认出来。
      const subdirsOf = (list) => list.filter((f) => /^src\/[^/]+\//.test(f));
      assert.ok(subdirsOf(['src/font/synthetic.js']).length === 1 && subdirsOf(['src/top.js']).length === 0,
        '负对照：覆盖面地板认得出 src/ 子目录模块（不是恒真）');
      const knownTransient = new Set();
      for (const f of scannedModules) {
        const t = stripComments(moduleTextOf(f));
        for (const m of t.matchAll(/setTransient\(\s*['"]([\w$]+)['"]/g)) knownTransient.add(m[1]);
      }
      assert.ok(knownTransient.size >= SCAN_FLOOR.transient,
        '覆盖面：瞬态字段域 ≥' + SCAN_FLOOR.transient + ' 个（它派生自 setTransient 的调用点，' +
        '只在 client.js 里 —— 实测漏掉正文后会缩到 4）—— 得 ' + knownTransient.size);
      const crossModule = [];
      for (const f of scannedModules) {
        if (f === CLIENT_BODY) continue;
        const t = stripComments(moduleTextOf(f));
        for (const m of t.matchAll(/(?<![\w.$])selection\.([\w$]+)\s*=(?!=)/g)) {
          if (knownTransient.has(m[1])) crossModule.push(f + ':' + m[1]);
        }
      }
      assert.ok(crossModule.length <= REMAINING_CROSS_MODULE_MAX,
        'client.js 之外对已知瞬态字段的裸直写只许下降（上界 ' + REMAINING_CROSS_MODULE_MAX + '）：'
        + crossModule.length + ' 处 → ' + crossModule.join(', '));
      assert.ok(crossModule.length > 0 || REMAINING_CROSS_MODULE_MAX === 0,
        '棘轮空转：上界还有余量却没有直写可收 ⇒ 该把上界下调');
      // 回归探针：把合成内容写进一个**真实存在的**子目录模块，同一条判据必须报出来
      // （原先的扫描面在这个探针上会得到 0 ⇒ 探针就能证明"洞已被堵上"）。
      const injected = { file: 'src/font/apply.js', text: 'selection.uploading = true;\n' };
      const probeHits = [...stripComments(injected.text).matchAll(/(?<![\w.$])selection\.([\w$]+)\s*=(?!=)/g)]
        .filter((m) => knownTransient.has(m[1]));
      assert.equal(probeHits.length, 1,
        '回归探针：写进 src/font/（子目录）模块的瞬态直写必须被扫描面覆盖（得 ' + probeHits.length + '）');

      // ①e-2 **其余直写必须可枚举**（原先是"不可见的第三类"）。
      //    为什么需要：瞬态字段是**派生**的（`setTransient("…")` 的点名），于是任何一个
      //    **模块内部持有、不进设置也不进瞬态**的字段（`transcodeState` / `mediaInfo` /
      //    `fontSetError` …）都在判据视野之外 —— 实测 111 处、23 个字段、覆盖 6 个模块，
      //    而"这个字段归谁负责"只能靠通读代码回答。这不是"禁止直写"（那会逼出任意豁免，
      //    见上面那条警示），而是**把看不见的第三类变成一张可枚举、可复核、只许缩小的表**。
      //    ⚠️ 表里每一行的 `why` 是**人写下的理由**，判据只保证它非空 —— 判断仍归人。
      const UNREGISTERED_DIRECT_WRITES = {
        'src/effects.js': {
          why: '卸载清理（禁用 / HMR 后不留上一张壁纸的播放态）；无 emit 是刻意的 —— 这一路径本身就是"把屏上痕迹收干净"',
          fields: ['sceneAudioUrl', 'sceneHasAudio'],
        },
        'src/fontset-store.js': {
          why: '字体集通道内部的加载态/错误文案/清单；面板经 client.js 的渲染期读取消费（不是每次改动都 emit）',
          fields: ['fontSetActive', 'fontSetError', 'fontSets'],
        },
        'src/preset-store.js': {
          why: '玻璃预设通道内部的清单投影（活跃清单；已删除的出厂不回来，无隐藏形态）；错误文案已收口到 setPresetError 单写点（verify-client ①e 棘轮）',
          fields: ['glassPresets'],
        },        'src/live-layer.js': {
          why: '实时看护的会话内标志；`startLiveWatch` / `stopLiveWatch` 是它的两个入口',
          fields: ['sceneLiveActive'],
        },
        'src/media-prep.js': {
          why: '**整批应用**：`applySelection` 一族写一批字段后一次 `persistSelection()` / 一次 emit，逐个注入入口是仪式',
          fields: ['liveFrame', 'mediaExt', 'mediaInfo', 'previewUrl', 'propsUrl', 'sceneAudioUrl',
            'sceneFrameUrl', 'sceneHasAudio', 'sceneLiveActive', 'sceneLiveSrc', 'sceneVideo',
            'schemeColor', 'transcodeState', 'type', 'webLiveSrc'],
        },
        'src/persistence.js': {
          why: '启动加载期的一次性赋值（宿主→本地合并的结果），随后由调用方 emit',
          fields: ['hostLoaded', 'sidebarPresent'],
        },
        'src/system-fonts.js': {
          why: '本机字体清单通道的瞬态（不落盘、不进字体集）：清单 / 在途 / 失败文案 / 取得时刻'
            + '由 ensureSystemFonts 的取数生命周期写入，面板渲染期读取（client.js selection 初始化处有同段注释）',
          fields: ['systemFonts', 'systemFontsApproximate', 'systemFontsAt', 'systemFontsError', 'systemFontsLoading'],
        },
        'src/video-layer.js': {
          why: '视频通道拥有这三个字段的写入权（client.js 那段注释写明）；进度由 /transcode-progress 轮询驱动，'
            + '源码在 syncLayers 内部明确标注 "no emit() here"',
          fields: ['mediaInfo', 'transcodeProgress', 'transcodeReady', 'transcodeState'],
        },
      };
      // 判据（派生，不手写字段清单）：一个模块里"既不在持久化白名单、也不被 setTransient 点名"的字段。
      // 正判据与负对照**调同一个函数**（§4.7 约定 5）—— 负对照喂的是合成源码文本。
      const unregisteredFieldsIn = (srcText, persistedKeys, transientKeys) => [...new Set(
        [...stripComments(srcText).matchAll(/(?<![\w.$])selection\.([\w$]+)\s*=(?!=)/g)]
          .map((m) => m[1])
          .filter((k) => !persistedKeys.has(k) && !transientKeys.has(k)),
      )].sort();
      const persistedSet = new Set(persisted);
      const outside = [...new Set(scannedModules
        .map((f) => [f, f === CLIENT_BODY ? [] : unregisteredFieldsIn(moduleTextOf(f), persistedSet, knownTransient)])
        .flatMap(([f, ks]) => ks.map((k) => f + ':' + k)))].sort();
      const registered = new Set(Object.entries(UNREGISTERED_DIRECT_WRITES)
        .flatMap(([f, e]) => e.fields.map((k) => f + ':' + k)));
      const unknown = outside.filter((x) => !registered.has(x));
      assert.deepEqual(unknown, [],
        '这两类之外的字段直写必须登记进 UNREGISTERED_DIRECT_WRITES（新字段 = 一次可见的改动）：'
        + unknown.join(', '));
      // 只许缩小：表里的每一项都必须在源码里真实命中（否则该删）
      const stale = [...registered].filter((x) => !outside.includes(x));
      assert.deepEqual(stale, [], '登记表不空转（这些条目已无对应直写，该删）：' + stale.join(', '));
      // 每一条都要有书面理由（判据只保证"有人写过"，判断归人）
      const noReason = Object.entries(UNREGISTERED_DIRECT_WRITES)
        .filter(([, e]) => !e.why || e.why.trim().length < 10).map(([f]) => f);
      assert.deepEqual(noReason, [], '登记表每一项都要有非空的 why（人写下的理由）：' + noReason.join(', '));
      // 负对照：同一条判据对合成源码必须报出新字段；已登记的与两类已知字段都不许被报出
      assert.deepEqual(
        unregisteredFieldsIn('selection.brandNew = 1;', persistedSet, knownTransient), ['brandNew'],
        '负对照：未登记的字段会被同一条判据报出');
      assert.deepEqual(
        unregisteredFieldsIn('selection.fontSetError = 1;\nselection.uploading = 2;\nselection.volume = 3;',
          new Set(['volume']), new Set(['uploading'])), ['fontSetError'],
        '正/负对照：持久化与瞬态两类都不算"未登记"，只有第三类算');
      assert.deepEqual(unregisteredFieldsIn('// selection.ghost = 1;', persistedSet, knownTransient), [],
        'positive control: 注释里的写法不算（判据先剥注释）');
      // 覆盖面：登记表非空（否则上面的"零 unknown"会在空表上恒真）
      assert.ok(registered.size >= 10, '覆盖面：登记表 ≥10 项（防表被清空后判据空转）—— 得 ' + registered.size);

      // ①f **令牌动作总是通知**（`armConfirm` / `disarmConfirm` 都不得"没变就早返回"）。
      //    为什么：这两个函数经常被拿来**顶替一句 `emit()`**（"换上下文 ⇒ 顺手清令牌"、收起子分支…）
      //    —— 一旦"本来就没有令牌"时静默返回，那条路径就**丢了重渲染**：视图停在上一个状态，直到
      //    用户碰了别的控件才把两次变化一起兑现（实测：收起「字体集预设」时开关不动、再点别的按钮
      //    才连带收起）。多一次幂等重渲比丢一次重渲便宜得多 ⇒ 不做"没变就不发"的优化。
      //    判据只看"`emit()` 之前有没有 `return`"（`emit(); return;` 这种收尾不算缺陷）。
      const notifiesEveryTime = (text, name) => {
        const m = stripComments(String(text)).match(new RegExp('const ' + name + ' = \\([^)]*\\) => \\{([\\s\\S]*?)\\}'));
        if (!m) return false;
        const at = m[1].search(/\bemit\(\)/);
        if (at < 0) return false;
        return !/\breturn\b/.test(m[1].slice(0, at));
      };
      assert.ok(notifiesEveryTime(src, 'armConfirm') && notifiesEveryTime(src, 'disarmConfirm'),
        'armConfirm / disarmConfirm 必须每次都 emit（不得早返回）—— 它们常被用来顶替 emit()');
      assert.ok(notifiesEveryTime('const disarmConfirm = () => { y(); emit(); };', 'disarmConfirm') === true,
        'positive control: 总是通知的实现不算（判据不是恒真）');
      assert.ok(notifiesEveryTime('const disarmConfirm = () => { if (!x) return; y(); emit(); };', 'disarmConfirm') === false,
        'negative control: "没变就早返回"的令牌动作会被判出');
      assert.ok(notifiesEveryTime('const disarmConfirm = () => { if (!x) return; };', 'disarmConfirm') === false,
        'negative control: 早返回且不通知的令牌动作同样被判出');
      // 配套：那条收起分支**走的是 `disarmConfirm()`**（于是继承上面的通知义务）。
      // 窗口取 800 字符 —— 只圈住同一个处理器内部，跨处理器不会误配。
      const closePathGoesThroughToken = (text) =>
        /onOpen:[\s\S]{0,800}?else disarmConfirm\(\);/.test(stripComments(String(text)));
      assert.ok(closePathGoesThroughToken(src),
        '「字体集预设」的收起分支必须调 disarmConfirm()（否则上面那条与这条路径无关）');
      assert.ok(closePathGoesThroughToken('onOpen: (v) => { if (v) busy(x); else disarmConfirm(); },') === true,
        'positive control: 走令牌动作的收起分支不算（判据不是恒真）');
      assert.ok(closePathGoesThroughToken('onOpen: (v) => { if (v) busy(x); else { /* 什么也不做 */ } },') === false,
        'negative control: 收起分支不走令牌动作会被判出');

      // ①g **持久化字段的直写必须与落盘配对**（"改了不生效 / 刷新后回退"那一类）。
      //    口径：扫 `src/client.js` 的实现面，对每个**持久化白名单里**的字段的 `selection.x = …`
      //    直写，要求它**所在的函数体**里有 `persistSelection()` 或 `setSetting(`（后者内部会落盘）。
      //    ⚠️ 函数级判据看不见"调用点落盘" ⇒ 那份豁免是**显式且只许缩小**的，每条写明为什么安全，
      //    并且判据会检查它不空转（名单里的函数必须真的还在源码里，否则该删）。
      const PERSIST_ELSEWHERE = {
        seedGroupsFromPlaylists: '唯一调用点在读缓存后首次播种，紧随其后就是 persistSelection()',
        setCustomFrameLocal: '两个调用点（onCustomFrameFile / onClearCustomFrame）在各自分支里都落盘 —— '
          + '导入那支走 setSetting("url", …)，无 sceneFrameUrl 时走 else persistSelection()',
      };
      /** 第 at 行（0 基）所在的函数体；找不到函数返回 null。 */
      const fnBodyAt = (ls, at) => {
        let owner = null;
        for (let i = 0; i <= at && i < ls.length; i++) {
          const m = /^(\s*)(?:function\s+([\w$]+)|const\s+([\w$]+)\s*=\s*(?:async\s*)?\()/.exec(ls[i]);
          if (m) owner = { name: m[2] || m[3], start: i, indent: m[1].length };
        }
        if (!owner) return null;
        for (let i = at + 1; i < ls.length; i++) {
          if (/^\s*\}/.test(ls[i]) && (ls[i].match(/^\s*/)[0] || '').length === owner.indent) {
            return { name: owner.name, body: ls.slice(owner.start, i + 1).join('\n') };
          }
        }
        return { name: owner.name, body: ls.slice(owner.start).join('\n') };
      };
      /** 判据（正/负对照共用）：返回"没和落盘配对"的 `字段@函数:L行` 清单。 */
      const unpairedPersistedWrites = (text, exempt = []) => {
        const ls = stripComments(String(text)).split('\n');
        const out = [];
        ls.forEach((line, i) => {
          if (/function (setSetting|setTransient)\(field, value\)/.test(line)) return;
          for (const m of line.matchAll(/(?<![\w.$])selection\.([\w$]+)\s*=(?!=)/g)) {
            if (!persisted.includes(m[1])) continue;
            const hit = fnBodyAt(ls, i);
            if (hit && exempt.includes(hit.name)) continue;
            const paired = Boolean(hit) && (/persistSelection\(\)/.test(hit.body) || /setSetting\(/.test(hit.body));
            if (!paired) out.push(m[1] + '@' + (hit ? hit.name : '(无函数)') + ':L' + (i + 1));
          }
        });
        return out;
      };
      const unpaired = unpairedPersistedWrites(src, Object.keys(PERSIST_ELSEWHERE));
      assert.deepEqual(unpaired, [],
        '持久化字段的直写必须与落盘配对；未配对：' + unpaired.join(', '));
      const staleExempt = Object.keys(PERSIST_ELSEWHERE)
        .filter((n) => !new RegExp('(?:function\\s+' + n + '\\b|const\\s+' + n + '\\s*=)').test(stripComments(src)));
      assert.deepEqual(staleExempt, [], 'PERSIST_ELSEWHERE 里已不存在的函数该删：' + staleExempt.join(', '));
      assert.deepEqual(
        unpairedPersistedWrites('function f() { selection.videoVolume = 1; }\n'), ['videoVolume@f:L1'],
        'negative control: 未配对的持久化字段直写会被判出');
      assert.deepEqual(
        unpairedPersistedWrites('function f() { selection.videoVolume = 1; persistSelection(); }\n'), [],
        'positive control: 同一函数里落了盘 ⇒ 不算（判据不是恒真）');
      assert.deepEqual(
        unpairedPersistedWrites('function f() { selection.videoVolume = 1; setSetting("x", 1); }\n'), [],
        'positive control: `setSetting(` 同函数也算落盘（它内部会 persist）');
      assert.deepEqual(
        unpairedPersistedWrites('function f() { selection.uploading = true; }\n'), [],
        'positive control: 瞬态字段不归这条判据（那是 ①d 的范围）');
      assert.deepEqual(
        unpairedPersistedWrites('function f() { selection.videoVolume = 1; }\n', ['f']), [],
        'positive control: 豁免名单里的函数不算（豁免生效）');

      // ①h **面板处理器不得"写了 store 却没有任何能通知的动作"**（横向排查的产物）。
      //    判据：先把"能通知的名字"按**传递闭包**算出来（种子 = `emit` + 下面四个显式列出的助手，
      //    再反复把"体内调用了闭包里某个名字"的本地定义并进来）；然后对每个**处理器形态**
      //    （`onXxx:` / `onXxx =` / `setXxx` / `changeXxx` / `toggleXxx`）且**写了 store** 的定义，
      //    要求它体内调用闭包里的任意名字。
      //    ⚠️ 已知边界：这是**处理器级**判据 —— "同一处理器里某一支通知、另一支不通知"它看不出
      //    （收起「字体集预设」那个缺陷正是那一形态）；那一形态由 ①f 的机制契约兜住（令牌动作总是
      //    通知 + 收起分支必须走它）。本条的职责是拦住"**整个处理器**都不会通知"这一类。
      //    扫描面**派生**自构建脚本的 `INLINE_MODULES`（= 真正被内联进产物的那些模块），**不硬编码
      //    文件名**：新增一个模块（实测形状：上游带来的 `src/theme-follow.js`，它落在旧扫描面之外）
      //    时自动进面 —— 否则"处理器必须通知"这条判据对新模块**静默失效**，正是它要防的那类失效。
      const inlineFiles = [...readFileSync(new URL('../scripts/build-client.mjs', import.meta.url), 'utf8')
        .matchAll(/file:\s*'([^']+)'/g)].map((m) => m[1]);
      const panelSrcs = [...new Set(['src/client.js', ...inlineFiles])]
        .map((f) => { try { return readFileSync(new URL('../' + f, import.meta.url), 'utf8'); } catch { return ''; } });
      const defRe = /^(\s*)(?:function\s+([\w$]+)\s*\(|const\s+([\w$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>|(on[A-Z][\w$]*)\s*:)/;
      const defsOf = (text) => {
        const ls = stripComments(String(text)).split('\n');
        const out = [];
        ls.forEach((l, i) => {
          const m = defRe.exec(l);
          if (!m) return;
          const name = m[2] || m[3] || m[4];
          // ⚠️ 单行定义（`const onX = (v) => { … };`）必须就地收尾：否则会一路吞掉**后面的处理器**，
          //    把它们的 `emit()` 算到这个身上 —— 那是假阴性（反向探针实测过）。
          const opens = (l.match(/\{/g) || []).length;
          const closes = (l.match(/\}/g) || []).length;
          if (opens === 0 || opens === closes) { out.push({ name, body: l }); return; }
          const indent = m[1].length;
          let end = ls.length;
          for (let k = i + 1; k < ls.length; k++) {
            if (ls[k].trim() === '') continue;
            const ind = (ls[k].match(/^\s*/)[0] || '').length;
            if (ind < indent) { end = k; break; }
            if (/^\s*\}/.test(ls[k]) && ind === indent) { end = k + 1; break; }
          }
          out.push({ name, body: ls.slice(i, end).join('\n') });
        });
        return out;
      };
      const NOTIFY_HELPERS = ['busy', 'done', 'armConfirm', 'disarmConfirm'];
      const callsAny = (body, names) => [...names].some((n) => new RegExp('(?:^|[^\\w$.])' + n + '\\s*\\(').test(body));
      const notifyingNames = (defs) => {
        const names = new Set(['emit', ...NOTIFY_HELPERS]);
        for (let pass = 0; pass < 8; pass++) {
          for (const d of defs) if (!names.has(d.name) && callsAny(d.body, names)) names.add(d.name);
        }
        return names;
      };
      // 闭包的种子要干净：显式列出的助手必须**自身**真的 emit（否则闭包被污染、判据变松）
      const helperDefs = defsOf(src).filter((d) => NOTIFY_HELPERS.includes(d.name));
      assert.deepEqual(
        NOTIFY_HELPERS.filter((n) => !helperDefs.some((d) => d.name === n && /\bemit\(\)/.test(d.body))), [],
        'NOTIFY_HELPERS 里每个名字都必须自身真的 emit');
      const writesRe = /(setTransient\(|setSetting\(|setFontValues\(|(?<![\w.$])selection\.[\w$]+\s*=(?!=))/;
      const silentHandlers = (text) => {
        const defs = defsOf(text);
        const names = notifyingNames(defs);
        return defs.filter((d) => /^(?:on[A-Z]|set[A-Z]|change[A-Z]|toggle[A-Z])/.test(d.name)
          && writesRe.test(d.body) && !callsAny(d.body, names)).map((d) => d.name);
      };
      const HANDLERS_NOTIFY_ELSEWHERE = {
        setSetting: '它就是入口本身（写 + 落盘）：通知由调用点负责',
        setFontValues: '它就是入口本身（写字体值 + 落盘）：通知由调用点负责',
        setTransient: '它就是入口本身（只写内存）：通知由调用点负责',
        setCustomFrameLocal: '两个调用点（onCustomFrameFile / onClearCustomFrame）在各自分支里都 emit',
      };
      const silent = panelSrcs.flatMap((t) => silentHandlers(t))
        .filter((n) => !(n in HANDLERS_NOTIFY_ELSEWHERE));
      assert.deepEqual(silent, [],
        '面板处理器写 store 却不会通知（视图会静默停在旧状态）：' + silent.join(', '));
      const staleHandlerExempt = Object.keys(HANDLERS_NOTIFY_ELSEWHERE)
        .filter((n) => !panelSrcs.some((t) => defsOf(t).some((d) => d.name === n)));
      assert.deepEqual(staleHandlerExempt, [],
        'HANDLERS_NOTIFY_ELSEWHERE 里已不存在的定义该删：' + staleHandlerExempt.join(', '));
      assert.deepEqual(silentHandlers('const onX = (v) => { setTransient("a", v); };\n'), ['onX'],
        'negative control: 写了 store 却不会通知的处理器会被判出');
      assert.deepEqual(silentHandlers('const onX = (v) => { setTransient("a", v); emit(); };\n'), [],
        'positive control: 直接 emit ⇒ 不算（判据不是恒真）');
      assert.deepEqual(silentHandlers('const onX = (v) => { setTransient("a", v); busy(p); };\n'), [],
        'positive control: 调用会通知的助手 ⇒ 不算');
      assert.deepEqual(silentHandlers('const onX = (v) => { helper(); };\nconst helper = () => { emit(); };\n'), [],
        'positive control: 间接（调用了会通知的本地函数）⇒ 不算（闭包生效）');
      assert.deepEqual(silentHandlers('const onX = (v) => { const y = v; };\n'), [],
        'positive control: 不写 store 的处理器不归这条判据');

      // ①i **分支级**：每条从处理器出口离开的路径，都必须在该路径**最后一次写 store 之后**通知过。
      //    为什么还要这一条：①h 是**处理器级**的 —— 体内某处能通知就放过，于是"`if` 的两支里只有
      //    一支通知"它看不见（实测缺陷正是那一形态：收起「字体集预设」时视图停在旧状态）。
      //    判据与审计工具同源（`test/tools/branch-notify.mjs` 的 `pathNotifications`：按花括号配平
      //    切语句、把 `if/else if/else` 展开成路径、路径数封顶）。它自己的**边界**写在那份工具头里
      //    （缩进/单行 if 的形态、`try`/`switch`/循环体不展开、通知按名字闭包判定）。
      const BRANCH_NOTIFY_ELSEWHERE = {
        onRenameCommit: '通知由 `busy()` 的 `done` 在 promise 解析后才发（在写之后）—— 位置分析看不见时序',
        setCustomFrameLocal: '函数内不通知，两个调用点在各自分支里都 `emit`（同 ①h 的豁免）',
        // 拖动档（live）**有意**不通知：拖动中不重渲染（数值回显由控件就地更新 —— SliderRow 的
        // --we-fill），抬手那一次（change）走完整路径；音量本身在拖动档已经即时生效
        //（weApplyAudio + syncSceneAudio），不是"改了不生效"。同 commitLiveSetting 的两档口径。
        onVideoVolume: 'live 档有意不 emit（拖动中不重渲染，回显由控件就地更新）；抬手档 emit',
      };
      const branchSilent = panelSrcs.flatMap((t) => pathNotifications(t))
        .map((s) => s.split('@')[0]).filter((n) => !(n in BRANCH_NOTIFY_ELSEWHERE));
      assert.deepEqual(branchSilent, [],
        '有分支路径写了 store 却在该路径最后一次写之后没有通知：' + branchSilent.join(', '));
      const staleBranchExempt = Object.keys(BRANCH_NOTIFY_ELSEWHERE)
        .filter((n) => !panelSrcs.some((t) => defsOf(t).some((d) => d.name === n)));
      assert.deepEqual(staleBranchExempt, [],
        'BRANCH_NOTIFY_ELSEWHERE 里已不存在的定义该删：' + staleBranchExempt.join(', '));
      // 负对照就是**历史缺陷形态**（无条件写 + `if` 只有一支通知）—— 反向探针实测过：它会被判出。
      assert.deepEqual(
        pathNotifications('const onX = (v) => {\n  setTransient("a", v);\n  if (v) busy(p);\n  else { /* 什么都不做 */ }\n};\n')
          .map((s) => s.split('@')[0]),
        ['onX'], 'negative control: 「无条件写 + 只有一支通知」会被判出');
      assert.deepEqual(
        pathNotifications('const onX = (v) => {\n  setTransient("a", v);\n  if (v) busy(p);\n  else emit();\n};\n'), [],
        'positive control: 两支都通知 ⇒ 不算（判据不是恒真）');
      assert.deepEqual(
        pathNotifications('const onX = (v) => {\n  if (v) setTransient("a", v);\n  emit();\n};\n'), [],
        'positive control: 条件写 + 后面兜底 emit ⇒ 不算');
      assert.deepEqual(
        pathNotifications('const onX = (v) => {\n  if (v) { setTransient("a", v); emit(); }\n  else { setTransient("b", v); emit(); }\n};\n'), [],
        'positive control: 两支各自写、各自通知 ⇒ 不算');

      // ② 结构：两侧都必须**委托**给 schema，宿主不得再有手写逐键白名单。
      //    ⚠️ `serializeSelection` 住在 src/persistence.js ⇒ 那一条按文件归属分源；
      //    `sanitizeSettings` 住在 client.js，是对同一份 schema 的另一侧入口。
      assert.ok(/sanitizeFromSchema\(o, "client"\)/.test(src), '客户端 sanitizeSettings 必须委托给 schema');
      assert.ok(/serializeSettings\(selection\)/.test(persistSrc),
        '客户端 serializeSelection 必须委托给 schema（现在住在 src/persistence.js）');
      assert.ok(/sanitizeFromSchema\(raw, 'host'\)/.test(host), '宿主 sanitizeSettings 必须委托给 schema');
      const handWritten = (host.match(/clampNum\(o\.|clampStr\(o\./g) || []).length;
      assert.equal(handWritten, 0,
        '宿主不得再手写逐键白名单（发现 ' + handWritten + ' 处）—— 手抄正是漂移的来源');

      // ③ golden：设置规范化的**行为快照**夹具（逐键固定值）。夹具体积小、人可读，
      //    任何"顺手改了某个范围/默认值"的改动都会在这里现形；确属有意修改时，
      //    连同夹具一起更新。
      const golden = JSON.parse(readFileSync(
        new URL('../test/fixtures/settings-sanitize-golden.json', import.meta.url), 'utf8'));
      const canon = (o) => JSON.stringify(o && typeof o === 'object' && !Array.isArray(o)
        ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])) : o);
      const goldenDrift = [];
      for (const c of golden.cases) {
        const want = c.host === '__null__' ? null : c.host;
        if (canon(sanitizeFromSchema(c.input, 'host')) !== canon(want)) goldenDrift.push(c.name);
      }
      assert.deepEqual(goldenDrift, [],
        '宿主设置规范化必须与 P1-5 前的实现逐键一致（漂移用例：' + goldenDrift.join(', ') + '）');

      // ③b #159② 玻璃色的形状规则（迁移 + 读容忍 + 半对补齐）。每条各钉一条真实的
      //     静默失败路径，而不是"函数返回了个对象"：
      //     · v5 及更早的存档是**标量** hex —— 不认它，用户存了半天的颜色升级后变白釉；
      //     · **不过迁移段**的读路径也必须认标量（ADR-0011 D6 之后这条来路换了，但**依然存在**）：
      //       ① 用户层旧预设文件（本次改造直接作废、不做兼容，可文件还在盘上，`readPresetAt`
      //          拒读前仍会先过一遍形状）；② **手改的 `config.json`**（用户本机那份就是标量
      //          `#0d1524` 且 `settingsVersion` 还是 5）；③ 测试台架自造的输入。
      //          ⚠️ 出厂预设正文**已不再是这条来路**：七套已按新 tag 重建、`glassColor` 写成一对
      //          `{light, dark}`（t1），所以"出厂档是标量"这句话从 2026-10-11 起不再成立。
      //     · 只写一侧（历史形态 / 手改文件）⇒ 另一侧要跟着那一侧，不能掉回白釉（保住色相）。
      //     反过来"半对补齐"也意味着**不允许**再产出半对：`{light}` 那种入参进来必须成对出去
      //     （面板的选中态与"关掉开关收敛"都靠这个等式）。
      const glassPairOf = (input) => (sanitizeFromSchema(input, 'host') || {}).glassColor;
      assert.deepEqual(glassPairOf({ glassColor: '#123456' }),
        { light: '#123456', dark: '#123456' }, '老式标量玻璃色 ⇒ 迁移成两侧同值');
      assert.deepEqual(glassPairOf({ glassColor: { light: '#010203', dark: '#040506' } }),
        { light: '#010203', dark: '#040506' }, '显式一对 ⇒ 原样保留（两套不再被压成一套）');
      assert.deepEqual(glassPairOf({ glassColor: { dark: '#040506' } }),
        { light: '#040506', dark: '#040506' }, '只剩深色一侧 ⇒ 浅色跟着它（不回白釉）');
      assert.deepEqual(glassPairOf({ glassColor: { light: '#010203' } }),
        { light: '#010203', dark: '#010203' }, '只剩浅色一侧 ⇒ 深色跟着它');
      assert.deepEqual(glassPairOf({ glassColor: { light: 'nope', dark: '#040506' } }),
        { light: '#040506', dark: '#040506' }, '坏的那一侧由好的一侧补齐（不是整对丢掉）');
      assert.deepEqual(glassPairOf({ glassColor: { light: 'nope', dark: 'also-nope' } }),
        { light: '#ffffff', dark: '#ffffff' }, '两侧都非法 ⇒ 回白釉一对');
      assert.deepEqual(glassPairOf({ glassColor: 42 }),
        { light: '#ffffff', dark: '#ffffff' }, '非字符串非对象 ⇒ 回白釉一对（永不抛）');
      assert.deepEqual(glassPairOf({ glassColor: ' #0d1524 ' }),
        { light: '#0d1524', dark: '#0d1524' }, '标量周围带空白 ⇒ 去空白后认它');
      // 迁移不是"读容忍"的替代品：老存档（输入带旧版本号）走完迁移也必须是一对，
      // 且版本号被盖成当前值（夹具 ③ 里 18 个用例的这次漂移就是这么被发现的）。
      const migratedV5 = sanitizeFromSchema({ settingsVersion: 5, glassColor: '#0d1524' }, 'host') || {};
      assert.deepEqual(migratedV5.glassColor, { light: '#0d1524', dark: '#0d1524' },
        'v5 老存档 ⇒ 迁移后玻璃色是一对');
      assert.equal(migratedV5.settingsVersion, 6, '规范化后版本号盖成当前值');
      // 读容忍的**真实入口**：带当前版本的档**不过迁移** ⇒ 标量只能由 `readGlassColors` 自己认。
      // ⚠️ 来路（ADR-0011 D6 之后）：**手改的 config.json**（本机那份就是标量 + 旧版本号，绕过迁移直传）、
      //    **作废后仍留在盘上的用户层旧预设**、以及测试台架自造的输入。
      //    出厂预设正文**已从这条来路退出** —— 七套已重建为新 tag 且写成一对 `{light, dark}`。
      // ⚠️ 上面那条"老式标量"其实是被**迁移**接住的（不过版本号或版本号更老），走不到标量分支；
      //    这一条才是钉住读容忍的那条（删掉标量分支 ⇒ 手改档/旧预设静默变白釉）。
      assert.deepEqual(sanitizeFromSchema({ settingsVersion: 6, glassColor: ' #0d1524 ' }, 'host').glassColor,
        { light: '#0d1524', dark: '#0d1524' },
        '当前版本号的档（手改 config.json / 用户层旧预设，出厂预设已不再是这条来路）：标量玻璃色必须由读容忍认下');
      // 出厂默认：开关默认关 = "一个颜色管两套"。深色那侧的出厂观感来自 src/effects.js
      // 按主题钳制，不是"存了一个深色值"。
      assert.deepEqual(glassPairOf({}), { light: '#ffffff', dark: '#ffffff' },
        '玻璃色默认白釉一对');
      assert.equal((sanitizeFromSchema({}, 'host') || {}).glassDarkSeparate, false,
        '「深色单独设置」默认关（出厂就是一个颜色管两套）');
      assert.ok(KINDS.glassColor && KINDS.glassColor.kind === 'glassColors',
        'glassColor 必须走 glassColors 归一（旧的 hex 只认单个色 ⇒ 一对根本进不来）');

      // ③c 两层**各自在场**（#159② 的 v5→v6 迁移 + 读容忍）。这里是**结构**判据，不是行为判据 ——
      //     理由必须写清楚，否则以后有人会"顺手"把它换成行为断言：两层对**读出来的值**等价
      //     （`readGlassColors` 对任何入参都产出完整一对 ⇒ `sanitizeFromSchema` 的输入输出逐字节
      //     不变），实测删掉 `migrateSettings` 里 v6 那一步，③b 的每一条**照样全绿**。
      //     两层要保的是两件不同的事，各有一条静默失败路径：
      //       · 读容忍：**手改过的 config.json**（本机那份 = 标量 + 旧版本号，绕过迁移直传）、
      //         **作废后仍在盘上的用户层旧预设**、测试台架的 selection —— 这些**不过迁移**
      //         （预设那条路还显式盖当前版本号短路）⇒ 删它，老档立刻变白釉。
      //         ⚠️ ADR-0011 D6 之后出厂预设正文**已退出这条来路**（七套重建为新 tag、写成一对），
      //         但读容忍本身仍然必要 —— 上面三项就是它现在的真实入口。
      //         这一层**有行为判据**（③b 里"当前版本号的档 + 标量"那条）；下面再补一条结构判据当保险。
      //       · 一次性迁移：让**存档形状**收敛到当前刻度。形状本身没有行为可观测，所以只能
      //         钉"那一步在场"，并在下面配负对照证明这条判据不是恒真。
      const schemaSrc = readFileSync(new URL('../lib/settings-schema.js', import.meta.url), 'utf8');
      const bodyOf = (text, name) => {
        const at = text.indexOf('function ' + name + '(');
        if (at < 0) return '';
        const open = text.indexOf('{', at);
        let depth = 0;
        for (let i = open; i < text.length; i += 1) {
          if (text[i] === '{') depth += 1;
          else if (text[i] === '}' && (depth -= 1) === 0) return text.slice(open, i + 1);
        }
        return '';
      };
      const migrationHasV6 = (text) => /out\.glassColor\s*=\s*\{\s*light:\s*out\.glassColor\s*,\s*dark:\s*out\.glassColor\s*\}/.test(bodyOf(text, 'migrateSettings'));
      const readerHasScalar = (text) => /typeof\s+raw\s*===\s*'string'/.test(bodyOf(text, 'readGlassColors'));
      assert.ok(migrationHasV6(schemaSrc),
        'v5→v6 迁移必须在场：`migrateSettings` 里要有「标量 ⇒ 两侧同值」那一步（消掉旧存档的标量形状）');
      assert.ok(readerHasScalar(schemaSrc),
        '读容忍必须在场：`readGlassColors` 要认标量（出厂预设 / 手改档不过迁移段）');
      // 负对照：把同一套抽取 + 正则用在"删掉那一层"的文本上必须判 false（否则上面两条是恒真的）。
      const noV6 = schemaSrc.replace(
        /if \(typeof out\.glassColor === 'string'\) \{\s*out\.glassColor = \{ light: out\.glassColor, dark: out\.glassColor \};\s*\}/, '');
      const noScalar = schemaSrc.replace(/if \(typeof raw === 'string'\) \{/, 'if (false) {');
      assert.notEqual(noV6, schemaSrc, 'negative control: 抽取用到的迁移形态必须真能匹配到（否则负对照是空的）');
      assert.notEqual(noScalar, schemaSrc, 'negative control: 抽取用到的读容忍形态必须真能匹配到（否则负对照是空的）');
      assert.ok(!migrationHasV6(noV6), 'negative control: 删掉迁移那一步后，③c 的迁移判据必须判红');
      assert.ok(!readerHasScalar(noScalar), 'negative control: 删掉读容忍那一步后，③c 的读容忍判据必须判红');

      // ④ 共有键上 client 与 host 必须逐键相同 —— 这就是"两侧不会再漂"的定义。
      //    （历史差异只剩非对象输入：host 返回 null、client 返回默认值，见 schema 头注释。）
      const sharedDrift = [];
      for (const c of golden.cases) {
        if (!c.input || typeof c.input !== 'object') continue;
        const cl = sanitizeFromSchema(c.input, 'client') || {};
        const ho = sanitizeFromSchema(c.input, 'host') || {};
        for (const k of hostSan) {
          if (JSON.stringify(cl[k]) !== JSON.stringify(ho[k])) sharedDrift.push(c.name + ':' + k);
        }
      }
      assert.deepEqual(sharedDrift, [],
        '共有键上 client 与 host 必须给出相同结果（漂移：' + sharedDrift.slice(0, 5).join(', ') + '）');

      // 切换过场三键仍必须三处都在（#106 的当事键，单独钉一次）
      for (const k of ['switchTransition', 'switchTransitionDir', 'switchTransitionSpeed']) {
        assert.ok(persisted.includes(k) && hostSan.includes(k) && KINDS[k],
          '切换过场的设置键必须在 schema + 两侧白名单里：' + k);
      }
      // 方向映射钉死：left = 新画面自右进入（擦除从右侧长出来 / 条带从右端长出）。
      // 这条是纯源码契约 —— 终态看不出方向（起点被 reflow 后的终态覆盖），但方向
      // 反了用户一眼就能看出，所以必须锁住映射本身。
      assert.ok(/if \(dir === "up"\) return "inset\(100% 0 0 0\)";/.test(code)
        && /const fromEnd = dir === "left" \|\| dir === "up";/.test(code)
        && /const inward = fromEnd \? -1 : 1;/.test(code),
        '方向映射必须保持「left = 画面向左移动 / 新画面自右进入」（擦除与条带同语义）');

      // 条带几何（单元级）：DOM 里只能看到终态，而「中段有没有板缝」才是百叶窗的
      // 关键 —— 直接从产物里取出 barsPolygon 在 p=0.5 求值。板缝一旦合并（例如
      // slat 恒等于 period），中段就退化成一块实心矩形，肉眼看与「擦除」无异
      // （用户实测反馈：擦除和条带分不出来）。这里把那个退化钉死。
      {
        const i = code.indexOf('function barsPolygon(');
        assert.ok(i >= 0, 'barsPolygon 必须存在');
        let depth = 0, started = false, srcFn = '';
        for (let j = i; j < code.length; j++) {
          if (code[j] === '{') { depth++; started = true; }
          else if (code[j] === '}') { depth--; if (started && depth === 0) { srcFn = code.slice(i, j + 1); break; } }
        }
        const n = Number((code.match(/const SWITCH_BARS_TEETH = (\d+)/) || [])[1]);
        const fn = new Function('const SWITCH_BARS_TEETH = ' + n + ';\n' + srcFn + '\nreturn barsPolygon;')();
        const xsOf = (poly) => [...new Set([...poly.matchAll(/([\d.]+)% ([\d.]+)%/g)].map((m) => Number(m[1])))];
        const ptsOf = (poly) => [...poly.matchAll(/([\d.]+)% ([\d.]+)%/g)].map((m) => [Number(m[1]), Number(m[2])]);
        for (const p of [0.3, 0.5]) {
          const pts = ptsOf(fn('left', p));
          const depthX = 100 * (1 - p);            // dir=left：板从右侧伸进来 p
          assert.ok(pts.some((q) => Math.abs(q[0] - depthX) < 0.01),
            '条带 p=' + p + ' 必须有「板深」点 x≈' + depthX.toFixed(1) + '（实际 x：' + JSON.stringify(xsOf(fn('left', p))) + '）');
          // 缝里那条「脊」必须是有长度的线段：板厚 slat = p/N < 周期 period 时缝才存在。
          // 板厚一旦等于周期（缝合并），脊上的相邻点 y 相同 → 长度归零 → 中段就是一块
          // 实心矩形，肉眼与「擦除」无异（用户实测反馈的原始问题）。这条把该退化钉死。
          const spineYs = pts.filter((q) => q[0] > 99 && q[0] < 100).map((q) => q[1]);
          // 脊上的点是**成对**发出的（每条缝一对：缝起点 → 缝终点），所以必须成对相减。
          // 跨缝相减会得到「周期」而恒定非零，那样板厚等于周期也测不出来。
          const gapLens = [];
          for (let k = 0; k + 1 < spineYs.length; k += 2) gapLens.push(Math.abs(spineYs[k + 1] - spineYs[k]));
          assert.ok(gapLens.some((g) => g > 0.5),
            '条带 p=' + p + ' 的缝必须有非零长度（缝存在 → 百叶窗而非实心擦除）；缝长：' + JSON.stringify(gapLens.slice(0, 6)));
        }
        // 两端必须退化：p=0 零面积（什么都没露出）、p=1 满屏（块缝闭合）。
        const xs0 = xsOf(fn('left', 0)).map(Number);
        const xs1 = xsOf(fn('left', 1)).map(Number);
        assert.ok(xs0.every((v) => v > 99.9), '条带 p=0 必须零面积（不能一开始就露出板）');
        assert.ok(xs1.some((v) => v < 0.1) && xs1.some((v) => v > 99.9),
          '条带 p=1 必须覆盖满屏（从进入侧一路铺到对侧）');
        console.log('条带几何（板 + 缝 · 两端退化）: ok');
      }
      // 默认 = 硬切（用户裁决：先上零成本零风险，等「最帅的」定了再改这一处）。
      // 断在**被测产物**（code）上，这样 DSH_MUT_LIB 变异也能验到这条有牙。
      assert.ok(/switchTransition: "cut"/.test(code), '默认过场必须是硬切（DEFAULTS.switchTransition）');
      assert.ok(persisted.length > 0 && hostSan.length > 0 && golden.cases.length > 0,
    '设置键两端对账：三份来源都非空（客户端 ' + persisted.length + ' / 宿主 ' + hostSan.length + ' / golden ' + golden.cases.length + '）');
    }

    // ⑥ 行为级不变量：整条流程（选中 → HEAD 探测 → 抓帧回填 → 清除 → 后续重建）
    // 里 animProbeSrcs 必须恒为 0 —— 一帧 CPU 动画渲染都不许启动（回退走静态帧链）。
    // 点帧率档位、关场景动画这两条路径都不得改走分钟级的 CPU 重渲染。
    tree3 = renderPicker();
    assert.equal(animProbeSrcs.length, 0,
      'CPU 动画渲染已删除：全流程不得出现任何 /scene-anim 请求');
    console.log('CPU 动画渲染路线已删除（源码钉死 + 行为级零请求）: ok');

    // ── sceneVideo 诚实化的时序补拉 ────────────────────────────────────────
    // 宿主对 sceneVideo 是「按 pkg 真探测」：未命中缓存时先给 null（不猜）并把探测
    // 投到后台，而客户端启动时那次 inventory 必然早于定论 ⇒ 必须有一次延迟补拉，
    // 否则真正内嵌 MP4 的场景首屏会掉到静态帧（实测 35 个场景里有 3 个）。
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
  assert.ok(effects.length > 0, '效果链至少要跑过一次（effects 记录 ' + effects.length + ' 条）');
  
// ⑦ 条件求值器住在独立模块（src/we-cond.js），因此可以直接 import 做**行为**测试
// —— 这是抽模块的核心收益（不必对 src/client.js 做文本断言）。
// 期望值是**行为快照**：抽模块只允许"行为不动"。
// ⚠️ 已知语义：本求值器把 `===` / `!==` 也走**宽松**比较（当前实现如此）。
//    若将来要改成严格比较，必须同步本表并评估对真实壁纸 condition 的影响。
{
  const { weEvalCondition, weCondTokenize, weCondParse } = await import(
    new URL('../src/we-cond.js', import.meta.url).href);

  const CASES = [
    // [说明, 表达式, values, 期望]
    ['无条件（空串）', '', undefined, true],
    ['空白条件', '   ', undefined, true],
    ['数值相等命中', 'x == 1', { x: 1 }, true],
    ['字符串同值也算相等（宽松）', 'x == 1', { x: '1' }, true],
    ['数值不等', 'x == 1', { x: 2 }, false],
    ['=== 目前也是宽松比较', 'x === 1', { x: '1' }, true],
    ['!= 取反', 'x != 1', { x: 1 }, false],
    ['与运算真', 'a && b', { a: 1, b: 1 }, true],
    ['与运算假', 'a && b', { a: 1, b: 0 }, false],
    ['或运算', 'a || b', { a: 0, b: 1 }, true],
    ['取反', '!a', { a: 0 }, true],
    ['取反带括号', '!(a)', { a: 0 }, true],
    ['浮点大于命中', 'a > 1.5', { a: 2 }, true],
    ['浮点大于不满足', 'a > 1.5', { a: 1 }, false],
    ['大于等于', 'a >= 2', { a: 2 }, true],
    ['字符串字面量比较', 'str == "hi"', { str: 'hi' }, true],
    ['成员访问', 'obj.prop == 1', { obj: { prop: 1 } }, true],
    ['括号组合', '(a == 1) && (b != 2)', { a: 1, b: 3 }, true],
    ['嵌套成员 + 与运算', 'p.mode == 1 && p.on', { p: { mode: 1, on: true } }, true],
    ['枚举字符串比较', 'mode == "auto"', { mode: 'auto' }, true],
    ['三元素（不支持）→ fail open 可见', 'a ? 1 : 0', { a: 1 }, true],
    ['赋值（不支持）→ fail open 可见', 'a = 1', { a: 1 }, true],
    ['垃圾表达式 → fail open 可见', '@@@', {}, true],
    ['values 缺失 → fail open 可见', 'a == 1', undefined, true],
  ];
  const wrong = [];
  for (const [label, expr, values, want] of CASES) {
    let got;
    try { got = weEvalCondition(expr, values); } catch (e) { got = 'THREW:' + e.message; }
    if (got !== want) wrong.push(label + '（期望 ' + want + ' 实得 ' + got + '）');
  }
  assert.deepEqual(wrong, [], '条件求值器行为必须与搬移前一致：' + wrong.join(' / '));

  // 负对照：故意植入一条**错期望**，检测器必须恰好抓到它（证明上面的比较真在比，
  // 而不是恒真）。
  const planted = CASES.concat([['植入的错期望', 'x == 1', { x: 2 }, true]]);
  const plantedWrong = planted.filter(([label, expr, values, want]) => {
    let got;
    try { got = weEvalCondition(expr, values); } catch { got = 'THREW'; }
    return got !== want;
  });
  assert.deepEqual(plantedWrong.map((c) => c[0]), ['植入的错期望'],
    '负对照：植入的那条错期望必须被抓到（且只抓到它）');

  // 编译结果按表达式缓存（拖动滑块时每帧要过数百项）—— 同表达式两次必须是同一函数
  const f1 = weCondParse(weCondTokenize('a == 1'));
  const f2 = weCondParse(weCondTokenize('a == 1'));
  assert.equal(typeof f1, 'function', 'weCondParse 必须返回可调用函数');
  assert.equal(f1({ a: 1 }), true, '编译出的函数必须可直接求值');
  assert.equal(typeof f2, 'function', '重复编译必须同样可用');
  assert.ok(CASES.length >= 20, '条件求值器用例表不得被清空（当前 ' + CASES.length + ' 例）');
}

// ── store 写入的单一入口 ───────────────────────────────────────────────────
// "赋值 + persistSelection()" 是两件事：漏掉 persist 就是"改了不生效/刷新后回退"，
// 而没有任何判据会红。收成 `setSetting(field, value)`（写 + 落盘）与
// `setTransient(field, value)`（只写）之后，判据可以断言：
//   · **页签**（src/panel-tabs.js）连 `selection` 都不许提 —— 只能经 ctx 的两个入口；
//   · client.js 里"赋值 + 紧跟 persistSelection()"的手抄形态为 **0**（棘轮只许减少）；
//   · 两个入口本身是唯一的"写 + 落盘"实现处（反查：入口体内必须有 selection[field] = 与
//     persistSelection()，否则判据是空转）。
{
  const tabsSrc2 = readFileSync(new URL('../src/panel-tabs.js', import.meta.url), 'utf8');
  const storeSrc = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');
  // ⚠️ **先剥注释再判**（规则 ⑦）：本文件头的契约注释必须能点名 `selection.` / `editing` 才能把
  // "为什么不许写"讲清楚 —— 不剥注释的判据会逼着后来人删掉那条解释（把"为什么"从代码里抹掉）。
  // 这一条与下面 `seamCrossings` 的口径现在一致（那里本来就剥）：判据只针对**代码**。
  const tabRefs = (stripComments(tabsSrc2).match(/(^|[^.\w$])selection\.|persistSelection/g) || []).length;
  assert.equal(tabRefs, 0,
    '页签不得直接读写 selection / persistSelection（必须走 ctx 的 setSetting / setTransient）');
  assert.equal((stripComments(tabsSrc2).match(/(^|[^.\w$])selection\./g) || []).length, 0,
    '负对照：剥注释后页签仍不得出现 `selection.`（同一判据对代码有牙）');
  assert.equal((stripComments('// selection.x = 1;\nconst a = 1;\n').match(/(^|[^.\w$])selection\./g) || []).length, 0,
    '负对照：注释里的 `selection.` 不得被算作违规');
  assert.equal((stripComments('selection.x = 1;').match(/(^|[^.\w$])selection\./g) || []).length, 1,
    '负对照：代码里的 `selection.` 必须被算作违规');
  const pairs = (storeSrc.match(/selection\.[A-Za-z_$][\w$]*\s*=[^=][^\n]*persistSelection\(\);/g) || []).length;
  assert.equal(pairs, 0, 'client.js 里不许再有手抄的"赋值 + persistSelection()"（当前 ' + pairs + ' 处）');
  assert.ok(/function setSetting\(field, value\) \{\s*\n\s*selection\[field\] = value;\s*\n\s*persistSelection\(\);/.test(storeSrc),
    'setSetting 必须是"写 store + 落盘"的唯一实现处');
  assert.ok(/function setTransient\(field, value\) \{\s*\n\s*selection\[field\] = value;/.test(storeSrc),
    'setTransient 必须是"只写 store"的实现处（瞬态字段不落盘）');
  // 负对照：判据对合成文本有牙（手抄形态 / 页签直写都必须被判出）
  assert.ok(/selection\.[A-Za-z_$][\w$]*\s*=[^=][^\n]*persistSelection\(\);/
    .test('selection.x = 1; persistSelection();'), '负对照：手抄形态必须能被判出');
  assert.ok(((('selection.y = 2;').match(/(^|[^.\w$])selection\.|persistSelection/g) || []).length) === 1,
    '负对照：页签直写必须能被判出');
}

// ── P3-11 阶段 2/3：搬出去的渲染器都只经 ctx（不写 selection / 不自发通知）──────
// 两次搬迁的契约同口径：模态框 → `src/picker-modal.js`（那 11 处原本内联改 `selection.*`
// 的箭头都成了 ctx 里的具名回调，动作体留在组件里）；属性面板 → `src/picker-props-panel.js`
// （面板状态与「改一个属性」的动作同样留在组件里，渲染器只拿值 + 回调）。
// 判据只有这一处：数"越过接缝直呼"的次数 —— **按代码判**（先剥注释，否则这些文件的头注
// 自己提到这两个词就会被误伤）。
{
  // 唯一判据。剥注释走共享的字符串感知实现（test/tools/js-text.mjs），与
  // scripts/build-client.mjs 的"浏览器安全"扫描同口径。
  const seamCrossings = (text) => {
    const code = stripComments(text);
    return {
      selection: (code.match(/(^|[^.\w$])selection\b/g) || []).length,
      notify: (code.match(/\bemit\s*\(/g) || []).length,
      readsCtx: /\}\s*=\s*ctx;/.test(code),
    };
  };
  // 每条都带一个**非空转锚点**：那串必须在文件里真的存在，否则"零次越界"只是扫了个空文件。
  const RENDERERS = [
    { file: '../src/picker-modal.js', user: '库视图',
      anchor: ['function renderPickerModal(ctx)', 'we-picker__modal-head'] },
    { file: '../src/picker-props-panel.js', user: '属性面板',
      anchor: ['function renderPickerPropsPanel(ctx)', 'we-picker__props-row'] },
    // P4-15：`panel-tabs.js` 此前**不在**这张表里 —— 它用的是上面那条更弱的判据（只数
    // `selection.` 字面量），于是三类越界全都漏过去了：直接 `emit()`、写模块状态
    //（`propsPanelOpen = !propsPanelOpen`）、改 ctx 别名的子对象（`editing.name = …`）。
    // 同一批"搬出去的渲染器"必须**同一条口径**，否则接缝纪律只对其中两个文件成立。
    { file: '../src/panel-tabs.js', user: '页签',
      anchor: ['function renderWallpaperTab(ctx)', 'function renderAppearanceTab(ctx)',
        'function renderEffectsTab(ctx)', 'function renderAdvancedTab(ctx)',
        'function renderExtensionsTab(ctx)'] },
  ];
  for (const r of RENDERERS) {
    const src = readFileSync(new URL(r.file, import.meta.url), 'utf8');
    const got = seamCrossings(src);
    assert.ok(r.anchor.every((a) => src.includes(a)),
      r.file + ' 必须真的含有' + r.user + '渲染器（否则下面的零次判据是空转）');
    assert.ok(got.readsCtx, r.user + '渲染器必须从 `ctx` 解构取外界（唯一入参）');
    assert.equal(got.selection, 0, r.user + '渲染器不得直接读写 selection（当前 ' + got.selection + ' 处）');
    assert.equal(got.notify, 0, r.user + '渲染器不得自己发通知（当前 ' + got.notify + ' 处）');
  }
  // 负对照：把**变异输入**喂进同一条判据 —— 两种越界各一例，且正常文本不得被误伤。
  const planted = seamCrossings('const onX = () => { selection.modalView = "normal"; emit(); };');
  assert.equal(planted.selection, 1, '负对照：直写 selection 必须被判出');
  assert.equal(planted.notify, 1, '负对照：自己发通知必须被判出');
  assert.equal(seamCrossings('  // 契约：不写 selection、不自己发通知\n  const a = 1;\n').selection, 0,
    '负对照：注释里提到这两个词不得被误伤（注释先剥掉）');
  assert.equal(seamCrossings('function f(ctx) { const { sel } = ctx; return sel; }').readsCtx, true,
    '正对照：从 ctx 解构的文本必须被认出来');
  assert.equal(seamCrossings('function f() { const { sel } = ctx; return sel; }').readsCtx, true,
    '正对照：解构本身被判据认作"经 ctx 取外界"（判据盯的是解构形态）');

  // ── P4-15：渲染器不得**改写**经 ctx 拿到的东西 / 模块级状态 ──────────────────
  // 这一类 `seamCrossings` **看不见**：它数的是 `selection` 与 `emit(`，而实测的越界形态是
  //   · `propsPanelOpen = !propsPanelOpen` —— 裸标识符的**模块级**状态（连 `selection` 都不含）；
  //   · `editing.name = …` —— `editing` 是 `selection.editing` 的 **ctx 别名**（同样不含 `selection.`）。
  // 两条都躲过了旧判据，却正是"渲染器成了状态的写入方"这件事本身。
  const MUTABLE_ALIASES = ['editing', 'sel', 'current', 'group', 'groups', 'fontSet',
    'propsPanelOpen', 'pickerFocusPending', 'pickerOpener', 'selection'];
  const MUTATORS = ['push', 'pop', 'splice', 'shift', 'unshift', 'sort', 'reverse'];
  /** 返回被**改写**的别名名单（只认赋值与原地变更，不认读取 —— 读取是渲染器的本分）。 */
  const aliasMutations = (text) => {
    const code = stripComments(text);
    const hits = [];
    for (const a of MUTABLE_ALIASES) {
      const head = '(^|[^.\\w$])' + a;
      const forms = [
        head + '\\s*(?:=[^=]|\\+=|-=|\\+\\+|--)',                                  // a = … / a += … / a++
        head + '(?:\\.\\w+)+\\s*=[^=]',                                            // a.b = …
        head + '(?:\\.\\w+)*\\.(?:' + MUTATORS.join('|') + ')\\s*\\(',             // a.push( / a.b.splice(
      ];
      if (forms.some((f) => new RegExp(f, 'm').test(code))) hits.push(a);
    }
    return hits;
  };
  for (const r of RENDERERS) {
    const src = readFileSync(new URL(r.file, import.meta.url), 'utf8');
    const muts = aliasMutations(src);
    assert.equal(muts.length, 0,
      r.user + '渲染器不得改写 ctx 别名 / 模块状态（命中 ' + muts.join(', ') + '）');
  }
  // 负对照：三类真实越界各一例必须被判出；纯读取与注释提及不得被误伤。
  assert.deepEqual(aliasMutations('const f = (ctx) => { propsPanelOpen = !propsPanelOpen; };'), ['propsPanelOpen'],
    '负对照：写模块级状态必须被判出');
  assert.deepEqual(aliasMutations('const f = (ctx) => { editing.name = e.target.value; };'), ['editing'],
    '负对照：改 ctx 别名的子对象必须被判出');
  assert.deepEqual(aliasMutations('const f = (ctx) => { group.wallpaperIds.push(id); };'), ['group'],
    '负对照：原地变更数组必须被判出');
  assert.deepEqual(aliasMutations('const f = (ctx) => { return sel.flip ? groups.map(g => g.name) : editing.name; };'), [],
    '负对照：纯读取（含成员访问与 map）不得被误伤');
  assert.deepEqual(aliasMutations('// propsPanelOpen = x; editing.name = y;\nconst a = 1;'), [],
    '负对照：注释里提到这些形态不得被误伤（注释先剥掉）');
}

// ── B4-a：库视图渲染器已拆成"派生 + 装配"，那棵层级契约最重的标记移进了子渲染器 ──────
// `renderPickerModal` 只应"派生窗口 + 装配"，不再内联 `we-picker__modal*` 标记（标记按层级 /
// 相邻关系绑定 116 个选择器，见文件头注）。判据盯**代码**：装配函数体内不得再出现标记，
// 且必须调用子渲染器；负对照证明同一条判据能判出"标记确实在子渲染器里"（否则是个恒真判据）。
{
  const src = readFileSync(new URL('../src/picker-modal.js', import.meta.url), 'utf8');
  // 取"函数体"：从声明处到下一个同级声明（`\n  function `/`\n  export {`）—— 不靠行号。
  const bodyOf = (name) => {
    const i = src.indexOf('function ' + name + '(');
    assert.ok(i >= 0, '找不到 ' + name + '（判据不得空转）');
    const j = src.indexOf('\n  function ', i + 1);
    return src.slice(i, j === -1 ? src.indexOf('\n  export {', i) : j);
  };
  const SUB_RENDERERS = ['renderPickerVSpacer', 'renderPickerCloseCard', 'renderPickerPickCard',
    'renderPickerHiddenBody', 'renderPickerNormalBody', 'renderPickerModalHead', 'renderPickerModalTabs',
    'renderPickerModalFoot', 'renderPickerBatchBar', 'renderPickerFilterRow'];
  for (const n of SUB_RENDERERS) {
    assert.ok(src.includes('function ' + n + '(') && src.includes(n + '('),
      '库视图子渲染器 ' + n + ' 必须存在（工厂作用域声明）且有调用点');
  }
  const assy = bodyOf('renderPickerModal');
  assert.ok(assy.includes('renderPickerModalHead(ctx)') && assy.includes('renderPickerHiddenBody(ctx, hiddenWin)')
    && assy.includes('renderPickerNormalBody(ctx, draft, draftIdSet, normalWin)'),
    'renderPickerModal 必须是"派生 + 装配"：直接调子渲染器');
  assert.ok(!assy.includes('we-picker__modal-head') && !assy.includes('we-picker__modal-body'),
    'renderPickerModal 体内不得再内联 modal-head / modal-body 标记（已移入子渲染器）');
  // 负对照：同一条判据对子渲染器本身必须判得出（标记确实在子渲染器里）——证明判据有牙。
  assert.ok(bodyOf('renderPickerModalHead').includes('we-picker__modal-head')
    && bodyOf('renderPickerHiddenBody').includes('we-picker__modal-body'),
    '负对照：modal-head / modal-body 标记必须落在子渲染器体内');
}

// ── B4-b：快捷面板渲染器已拆成"派生 + 装配"，标记移进了 qpRender* 子渲染器 ────────
// `QuickPanel` 只应"hooks + 派生 + 装配"，不再内联列表行 / 卡片 / 当前壁纸 / 视图栏 /
// 底栏 / 库区这几棵子树的标记（`.we-qp__*` 按层级与相邻关系绑定样式，见文件头注）。
// 判据盯**代码**：装配函数体内不得再出现那批标记，且必须调子渲染器；负对照证明同一条
// 判据能判出"标记确实在子渲染器里"（否则是个恒真判据）。
{
  const src = readFileSync(new URL('../src/quick-panel.js', import.meta.url), 'utf8');
  const bodyOf = (name) => {
    const i = src.indexOf('function ' + name + '(');
    assert.ok(i >= 0, '找不到 ' + name + '（判据不得空转）');
    const j = src.indexOf('\n  function ', i + 1);
    return src.slice(i, j === -1 ? src.indexOf('\n  export {', i) : j);
  };
  const SUB_RENDERERS = ['qpRenderRow', 'qpRenderCard', 'qpRenderSpacer', 'qpRenderCurrent',
    'qpRenderRotation', 'qpRenderTabs', 'qpRenderPropsButton', 'qpRenderAppearancePane',
    'qpRenderPlaybackPane', 'qpRenderViewBar', 'qpRenderList', 'qpRenderFoot',
    'qpRenderLibrarySection'];
  const qpStart = src.indexOf('function QuickPanel(');
  assert.ok(qpStart > 0, '找不到 QuickPanel（判据不得空转）');
  for (const n of SUB_RENDERERS) {
    const at = src.indexOf('function ' + n + '(');
    assert.ok(at >= 0 && at < qpStart && src.includes(n + '('),
      '快捷面板子渲染器 ' + n + ' 必须在 QuickPanel 之前声明（工厂作用域）且有调用点');
  }
  const assy = bodyOf('QuickPanel');
  assert.ok(assy.includes('qpRenderCurrent(sel, current, playbackLive)')
    && assy.includes('qpRenderRotation(sel, groups, playable)')
    && assy.includes('qpRenderTabs(qpTab, switchQpTab)')
    && assy.includes('qpRenderLibrarySection(') && assy.includes('qpRenderFoot(foot)'),
    'QuickPanel 必须是"派生 + 装配"：直接调子渲染器');
  assert.ok(!assy.includes('we-qp__item') && !assy.includes('we-qp__card') && !assy.includes('we-qp__current')
    && !assy.includes('we-qp__viewbar') && !assy.includes('we-qp__foot') && !assy.includes('we-qp__library'),
    'QuickPanel 体内不得再内联那批子树标记（已移入 qpRender* 子渲染器）');
  // 负对照：同一条判据对子渲染器本身必须判得出（标记确实在子渲染器里）——证明判据有牙。
  assert.ok(bodyOf('qpRenderRow').includes('we-qp__item') && bodyOf('qpRenderFoot').includes('we-qp__foot')
    && bodyOf('qpRenderViewBar').includes('we-qp__viewbar'),
    '负对照：item / foot / viewbar 标记必须落在对应的 qpRender* 子渲染器体内');
}

// ── B4-c：设置页「外观 / 播放」两节也已拆成"派生 + 装配"，标记移进了子渲染器 ──────────
// `renderAppearanceFontSection` / `renderMascotTab` / `renderEffectsPlaybackSection` 不再内联
// 那几棵子树（字体角色 / 组件表、吉祥物卡片一排、转码进度条）的标记。判据盯**代码**：
// 装配函数体内不得再出现那批标记，且必须调子渲染器；负对照证明同一条判据能判出
// "标记确实在子渲染器里"（否则是个恒真判据）。
{
  const src = readFileSync(new URL('../src/panel-tabs.js', import.meta.url), 'utf8');
  const bodyOf = (name) => {
    const i = src.indexOf('function ' + name + '(');
    assert.ok(i >= 0, '找不到 ' + name + '（判据不得空转）');
    const j = src.indexOf('\n  function ', i + 1);
    return src.slice(i, j === -1 ? src.length : j);
  };
  const HELPERS = ['renderFontGlobalFamily', 'renderFontColorRoles', 'renderFontTypeRoles',
    'renderFontComponents', 'renderFontSet', 'renderMascotFormCards', 'renderTranscodeProgress'];
  for (const n of HELPERS) {
    assert.ok(src.includes('function ' + n + '(') && src.includes(n + '('),
      '设置页子渲染器 ' + n + ' 必须存在（工厂作用域声明）且有调用点');
  }
  const GROUPS = [
    { consumer: 'renderAppearanceFontSection', calls: ['renderFontGlobalFamily(sel, onGlobalFamily',
      'renderFontColorRoles(sel, officialColorOf', 'renderFontTypeRoles(sel, typeRoles',
      'renderFontComponents(sel, onFontAdvanced', 'renderFontSet(fontSet)'] },
    { consumer: 'renderMascotTab', calls: ['renderMascotFormCards(sel, previewArt, previewW, previewH'] },
    { consumer: 'renderEffectsPlaybackSection', calls: ['renderTranscodeProgress(sel)'] },
  ];
  for (const g of GROUPS) {
    const ci = src.indexOf('function ' + g.consumer + '(');
    assert.ok(ci > 0, '找不到 ' + g.consumer + '（判据不得空转）');
    for (const c of g.calls) {
      const h = c.slice(0, c.indexOf('('));
      assert.ok(src.indexOf('function ' + h + '(') < ci,
        h + ' 必须在 ' + g.consumer + ' 之前声明（工厂作用域）');
      assert.ok(bodyOf(g.consumer).includes(c),
        g.consumer + ' 必须是"派生 + 装配"：直接调 ' + h);
    }
  }
  assert.ok(!bodyOf('renderMascotTab').includes('we-picker__mascot-row')
    && !bodyOf('renderEffectsPlaybackSection').includes('we-picker__prog-track')
    && !bodyOf('renderAppearanceFontSection').includes('we-picker__font-table'),
    '装配函数体内不得再内联那批子树标记（已移入子渲染器）');
  // 负对照：同一条判据对子渲染器本身必须判得出（标记确实在子渲染器里）——证明判据有牙。
  assert.ok(bodyOf('renderMascotFormCards').includes('we-picker__mascot-row')
    && bodyOf('renderTranscodeProgress').includes('we-picker__prog-track')
    && bodyOf('renderFontTypeRoles').includes('we-picker__font-table'),
    '负对照：mascot-row / prog-track / font-table 标记必须落在对应的子渲染器体内');
}

// ── 判据纪律：本文件不许有"log 形式的伪判据" ─────────────────────────────────
// `console.log('x (expect 1):', n === 1)` 在日志里**像**断言，实际不判真假 —— 产品改坏了
// 它照样 exit 0。棘轮**基线 0**：本文件必须一处都没有；
// `catch` 里的错误上报不是判据，排除在外。
{
  const selfSrc = readFileSync(new URL(import.meta.url), 'utf8');
  // 判据只认**以 `console.log(` 开头的语句**：伪判据都是这种形态，而本段自己的负对照行以
  // `assert.equal(` 开头（它的字符串字面量里正是带着 `console.log(… === …)` 样本）——
  // 不收紧就会被自己的对照绊倒（同 `docs/DEV-GUIDE.md` §4.7 约定 3 那条陷阱）。
  const isFakeJudgement = (line) => {
    const t = line.trim();
    if (!/^console\.log\(/.test(t)) return false;      // 不是 log 语句
    if (/catch|threw|\.message/.test(t)) return false; // 错误上报不是判据
    return /(===|!==|\.includes\(|\.length|\.some\(|\.every\()/.test(t) || /expect|应该|必须|不得/.test(t);
  };
  const fakeJudgements = (src) => src.split('\n')
    .map((line, i) => ({ n: i + 1, line }))
    .filter((x) => isFakeJudgement(x.line));
  const found = fakeJudgements(selfSrc);
  assert.equal(found.length, 0,
    'log 形式的伪判据必须为 0（39 处已清零，不许再出现）：行 ' + found.map((x) => x.n).join(','));
  // 负对照：把**变异输入**喂进同一条判据
  assert.equal(fakeJudgements("  console.log('x (expect 1):', n === 1);").length, 1,
    '负对照：log 形式的伪判据必须能被判出');
  assert.equal(fakeJudgements("  assert.equal(n, 1, 'x');").length, 0,
    '负对照：真断言不得被误伤');

  // 同族的第二种形态：`console.log('… present:', !!x)` 之后紧跟
  // `if (x) { …断言… }` —— 探测日志不判真假，而"缺失即跳过断言"让后面的判据**零覆盖仍绿**
  // （缺前置与通过同形，见 `docs/DEV-GUIDE.md` §4.7 约定 8 的反面）。判据只看**紧邻的非空行**是否
  // 用同一个标识符做 `if (x)`；`if (!x) assert.fail(…)` 那种"缺了就红"的正写法**不算**。
  const probeThenSkip = (src) => {
    const ls = src.split('\n');
    const out = [];
    ls.forEach((line, i) => {
      if (!/^console\.log\(/.test(line.trim())) return;
      const m = /!!\s*([A-Za-z_$][\w$]*)/.exec(line);
      if (!m) return;
      for (let k = i + 1; k < Math.min(ls.length, i + 4); k++) {
        const nxt = ls[k].trim();
        if (!nxt) continue;
        if (new RegExp('^if\\s*\\(\\s*' + m[1] + '\\b').test(nxt)) out.push({ n: i + 1 });
        break;
      }
    });
    return out;
  };
  const probeSkips = probeThenSkip(selfSrc);
  assert.equal(probeSkips.length, 0,
    '探测日志 + 紧跟的条件跳过必须为 0（缺前置不许与"通过"同形）：行 ' + probeSkips.map((x) => x.n).join(','));
  assert.equal(probeThenSkip("  console.log('x present:', !!w);\n  if (w) { assert.ok(1); }").length, 1,
    '负对照：探测日志 + 条件跳过必须能被判出');
  assert.equal(probeThenSkip("  console.log('x present:', !!w);\n  assert.ok(w, 'w 必须存在');").length, 0,
    '正对照：探测之后是硬断言 ⇒ 不算（判据不是恒真）');
  assert.equal(probeThenSkip("  console.log('x present:', !!w);\n  if (!w) assert.fail('缺 w');").length, 0,
    '正对照：「缺了就红」的写法不算');
  assert.equal(fakeJudgements("  catch (e) { console.log('threw:', e && e.message); }").length, 0,
    '负对照：catch 里的错误上报不得被当成判据');
}

// ── 拖动期的 live 档：色板 / 滑块每格只写"看得见的那部分" ─────────────────────
// 现场（用户实测）：在原生颜色轮盘里拖动时，**每格**都 `setSetting + emit()` —— emit 让整棵
// 面板（设置页那棵最重：字体表 + 12 个色块 + 字体集编辑器）重渲染，而 emit 的订阅者里那次
// **全量** applyEffects 还会重建字体样式表、同步场景音频、并读一次 `getComputedStyle`
//（壁纸透明度 > 0 时 ⇒ **强制同步样式计算**，整页 style recalc）—— 拖动因此发涩。
// 现在两档：`input`（拖动中）= 写值 + `applyEffects({ live: true })`（跳过与本次改动无关的
// 重活，样式变量照旧全量写）、**不 emit**；`change`（抬手）= 完整一次（emit → 全量 applyEffects）。
// 三层判据：① 两个行构造器把 live 传下去；② 会拖动的处理器都经 `commitLiveSetting` 收口；
// ③ **行为**：拿真 `src/effects.js` 在带间谍的 DOM 替身上跑，live 档必须不读 getComputedStyle、
// 不碰字体 / 场景音频，但照样写样式变量；同一份替身下无参调用必须**两样都做**（负对照）。
{
  const clientSrc = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');
  const effectsText = readFileSync(new URL('../src/effects.js', import.meta.url), 'utf8');
  const declOf = (name) => {
    const i = clientSrc.indexOf('function ' + name + '(') >= 0
      ? clientSrc.indexOf('function ' + name + '(') : clientSrc.indexOf('const ' + name + ' = ');
    return i < 0 ? '' : clientSrc.slice(i, i + 700);
  };
  // ① 行构造器：input 传 true、change 传 false（拖动档 / 抬手档的分界就在这两处）。
  assert.ok(clientSrc.includes('onInput: (e) => { liveFill(e.currentTarget); onInput(Number(e.target.value), true); }'),
    'SliderRow 的 input 必须走拖动档（live=true）并就地更新 --we-fill');
  assert.ok(clientSrc.includes('onChange: (e) => onInput(Number(e.target.value), false),'),
    'SliderRow 的 change 必须是抬手档（live=false）');
  // 滑块右侧那格必须是**数值回显**（值 + 单位），不是只印一个单位 —— 拖动期由 liveFill
  // 就地改写同一格（面板全域生效：每个走 SliderRow 的控件都受益）。
  // ⚠️ 合并 #135 订正：旧调用点传的是**已格式化的"值+单位"整串**（如 `35 + "%"`），
  // 直接 `String(v) + unit` 会拼成 "3535%"、拖动期还会叠出陈旧单位 —— 现在按
  // "串里有没有数字"分两口径：裸单位（新滑杆）回显值 + 单位；预格式化整串（旧调用点）原样。
  assert.ok(clientSrc.includes('const preformatted = /\\d/.test(unit);')
    && clientSrc.includes('}, readout(value)),'),
    'SliderRow 第三格必须回显（readout(value)：裸单位 = 值 + 单位；预格式化整串 = 原样）');
  assert.ok(clientSrc.includes('if (out && !preformatted) out.textContent = readout(el.value);'),
    'SliderRow 拖动期就地改写右侧数值（仅裸单位口径；预格式化旧口径保持 main 既有观感）');
  // 可输入数值区（SliderRow 的 numberEdit）：编辑期**必须不受控**。
  // 为什么钉这条：受控写法（value 由设置渲染 + 每敲一键写设置）在"删空重打"这一路会自锁 ——
  // 退格把框清成空串，空串不是合法值 ⇒ 不写设置 ⇒ React 把旧值渲回去 ⇒ 用户看到"数字删不掉"
  // （实测报回来的原话：「我在输入框里不能删除已有数字」）。修法 = 本地 draft + 回车 / 失焦提交：
  //   · 正向：编辑期给 defaultValue（不受控）、提交走 onCommit、空串直接放弃编辑；
  //   · 负向对照：**不许**再出现"每键写设置"的那种受控 input（onInput 里直接调 onInput(…, true)）。
  assert.ok(clientSrc.includes('function NumberValueInput(props)')
    && clientSrc.includes('...(editing ? { defaultValue: draft } : { value: String(value) }),'),
    '可输入数值区必须走 NumberValueInput（编辑期 defaultValue 不受控）');
  assert.ok(clientSrc.includes('if (s === "") return;'),
    '可输入数值区的空串必须是"放弃编辑"（否则删空会被当成 0 写进去）');
  // 负向对照：受控 + 每键写设置的那种写法不许回来。
  assert.ok(!/we-picker__value-input[\s\S]{0,900}?onInput: \(e\) => \{[\s\S]{0,300}?onInput\(Number\(raw\), true\)/.test(clientSrc),
    '可输入数值区不得每敲一键就写设置（那正是"数字删不掉"的成因）');
  assert.ok(clientSrc.includes('onInput: (e) => onPick(e.target.value, true),')
    && clientSrc.includes('onChange: (e) => onPick(e.target.value, false),'),
    'swatchRow 的自定义色盘必须同样分 input / change 两档');
  // ② 会拖动的处理器都收口到同一条：写值 + （live ? 只应用样式 : emit）。
  const DRAGGABLE = ['onScrim', 'onWallpaperOpacity', 'onBorder', 'onBlur', 'onWallpaperBlur',
    'onBackgroundBrightness', 'onBackgroundContrast', 'onBackgroundSaturate', 'onAccent',
    'onGlassColor', 'onGlassAlpha', 'onSidebarBlur', 'onSidebarAlpha', 'onSidebarColor',
    'onSidebarContentAlpha', 'onSidebarContentColor', 'onCaretColor'];
  const notRouted = DRAGGABLE.filter((n) => !declOf(n).includes('commitLiveSetting('));
  assert.equal(notRouted.length, 0, '拖动类处理器必须经 commitLiveSetting（拖动档不 emit）：' + notRouted.join(', '));
  assert.ok(declOf('commitLiveSetting').includes('if (live) applyEffects({ live: true });')
    && declOf('commitLiveSetting').includes('else emit();'),
    'commitLiveSetting 必须只有这两个分支（live ⇒ 只应用样式；抬手 ⇒ emit，全量那一次由订阅者跑）');
  // 音量滑块不走 applyEffects（它直接改 media 元素），但同样要"拖动不 emit"。
  assert.ok(declOf('onVideoVolume').includes('if (!live) emit();'),
    'onVideoVolume 拖动档必须跳过 emit（音量本身照样即时生效）');
  // ③ 行为：真 effects.js + 间谍替身。`with` + Proxy 让未知自由名自动得到记录用的替身
  //   （不必手抄一份依赖清单；清单漏一个就会以 ReferenceError 响亮地红）。
  const props = [];
  const named = [];
  const spy = { gets: 0 };
  const noop = () => {};
  const stubTarget = {
    selection: {
      scrim: 0, wallpaperOpacity: 40, accent: '#4f8cff', glassColor: '#ffffff', glassAlpha: 0,
      blur: 0, border: 0, fontCustom: true, caretColor: '', sidebarBlur: 0, sidebarAlpha: 0,
      sidebarColor: '#ffffff', sidebarContentAlpha: 0, sidebarContentColor: '', sidebarGlass: true,
      glassWindow: false, wallpaperBlur: 0, backgroundBrightness: 100, backgroundContrast: 100,
      backgroundSaturate: 100, objectFit: 'cover', flip: false,
    },
    document: {
      body: {
        style: {
          setProperty: (k, v) => { props.push(k + '=' + v); },
          removeProperty: (k) => { props.push('-' + k); },
        },
        setAttribute: noop, removeAttribute: noop, hasAttribute: () => false, offsetHeight: 1,
      },
      getElementById: () => null,
    },
    getComputedStyle: () => { spy.gets++; return { getPropertyValue: () => '' }; },
    GLASS_SATURATE: 1.3, SCRIM_ID: 'we-scrim', LAYER_ID: 'we-layer',
    adapterCaps: () => ({ target: 'plain-browser' }),
    detectMicaSupport: () => true, detectSoftwareRender: () => false,
    useLegacySaturateCoupling: () => false,
    weClampSurfaceColor: (hex) => hex,
    // 名字被记录下来的替身（字体样式表 / 场景音频 / 光标注入 —— 拖动档一概不该碰）
    snapshotHostFontDefaults: () => { named.push('snapshotHostFontDefaults'); },
    applyComponentFonts: () => { named.push('applyComponentFonts'); },
    removeFontStyles: () => { named.push('removeFontStyles'); },
    removeComponentFonts: () => { named.push('removeComponentFonts'); },
    applyCaretStyles: () => { named.push('applyCaretStyles'); },
    removeCaretStyles: () => { named.push('removeCaretStyles'); },
    syncSceneAudio: () => { named.push('syncSceneAudio'); },
    resolveWallpaperFadeBg: () => '#000000',
  };
  const scope = new Proxy(stubTarget, {
    // 只接管"替身里有"或"全局也没有"的名字 —— 否则连 `Math` / `String` 也会被当成自由名
    // 拿到一个记录用的替身（第一版就是这样炸的）。
    has: (t, k) => (k in t) || !(k in globalThis),
    get: (t, k) => (k in t ? t[k] : (...a) => { named.push(String(k)); return undefined; }),
    set: () => true,
  });
  // `new Function` 不是模块环境 ⇒ 先剥掉 `export { … }`（构建期内联时也是这么剥的；
  // 共享实现见 test/tools/js-text.mjs 的 stripExportBlocks —— 别在这里再抄一份正则）。
  const effectsBody = stripExportBlocks(effectsText);
  const mod = new Function('__scope', 'with (__scope) { ' + effectsBody + '\nreturn { applyEffects, clearEffects }; }')(scope);
  const run = (opts) => {
    props.length = 0; named.length = 0; spy.gets = 0;
    mod.applyEffects(opts);
    return { props: props.slice(), named: named.slice(), gets: spy.gets };
  };
  // 冷启动边界：**第一次** applyEffects 就是拖动档（缓存还空着）时允许算一次 —— 之后不再算。
  const cold = run({ live: true });
  assert.ok(cold.gets <= 1 && cold.props.length >= 15 && cold.props.some((p) => p.startsWith('--we-accent-src=')),
    '拖动档冷启动（无缓存）：最多算一次淡出底色，但样式变量照写 —— 写了 ' + cold.props.length + ' 个');
  run(); // 抬手档：算出并缓存淡出底色
  const live = run({ live: true });
  assert.ok(live.props.length >= 15 && live.props.some((p) => p.startsWith('--we-accent-src=')),
    '拖动档照样写样式变量（不是提前 return 的空转）—— 写了 ' + live.props.length + ' 个');
  assert.equal(live.gets, 0,
    '拖动档不得读 getComputedStyle（那就是每格一次强制同步样式计算，拖动发涩的主因）');
  assert.equal(live.named.filter((n) => ['snapshotHostFontDefaults', 'applyComponentFonts', 'removeFontStyles',
    'removeComponentFonts', 'syncSceneAudio'].includes(n)).length, 0,
    '拖动档不得重建字体样式表 / 同步场景音频（与本次拖动无关）：' + live.named.join(', '));
  const full = run();
  assert.ok(full.gets >= 1, '负对照：抬手档（无参）必须走完整路 —— 该读的读（getComputedStyle 至少 1 次）');
  assert.ok(full.named.includes('snapshotHostFontDefaults') && full.named.includes('applyComponentFonts'),
    '负对照：抬手档必须重建字体样式表（fontCustom=true ⇒ snapshot + apply）');
  assert.ok(full.named.includes('syncSceneAudio'), '负对照：抬手档必须同步场景音频');
  assert.ok(full.named.includes('removeWallpaperFadeBg') === false, '（防呆：名字记录器本身工作正常）');
}

// ── #159①：宿主切深浅主题后，淡出底色缓存必须被清掉（行为级）────────────────────
// 事故：`--we-wallpaper-fade-bg` 是 .we-layer 那块 z-index −2 衬底的底色（透明底色会让
// backdrop-filter 失效，所以必须垫一个实色），而它的解析结果缓存在 effects.js 的
// `lastFadeBg` 里、**只在 applyEffects 被调用时**重算。宿主切主题（翻转 body 的
// data-ds-dark-theme）不会调用我们，本仓唯一的主题订阅（theme-follow）由开关门控、
// 默认关 ⇒ 缓存停在旧主题的底色上，而它给**每一面玻璃**当衬底 ⇒ 整页被染成过期色。
// 判据走真 src/effects.js（与上面那条拖动档判据同一个 with 挂载台），四件：
//   ① 观察者真的挂在 body 上、只认 data-ds-dark-theme、且幂等（只挂一个）；
//   ② 负对照：翻转属性但**不派发** ⇒ 拖动档仍旧值（证明缓存确实是黏的，判据不是空转）；
//   ③ 派发之后拖动档必须拿到新主题的底色；
//   ④ clearEffects 必须断开（否则卸载后观察者留在宿主 DOM 上）。
{
  const fxSrc = readFileSync(new URL('../src/effects.js', import.meta.url), 'utf8');
  const fxProps = [];
  const fxBody = {
    style: { setProperty: (k, v) => fxProps.push(k + '=' + v), removeProperty: (k) => fxProps.push('-' + k) },
    _attrs: new Set(),
    setAttribute(k) { this._attrs.add(k); },
    removeAttribute(k) { this._attrs.delete(k); },
    hasAttribute(k) { return this._attrs.has(k); },
    offsetHeight: 1,
  };
  const fxObservers = [];
  class FakeMutationObserver {
    constructor(cb) { this.cb = cb; this.disconnected = false; fxObservers.push(this); }
    observe(target, opts) { this.target = target; this.opts = opts; }
    disconnect() { this.disconnected = true; }
  }
  const fxTarget = {
    selection: {
      scrim: 0, wallpaperOpacity: 40, accent: '#4f8cff', glassColor: '#ffffff', glassAlpha: 0,
      blur: 0, border: 0, fontCustom: false, caretColor: '', sidebarBlur: 0, sidebarAlpha: 0,
      sidebarColor: '#ffffff', sidebarContentAlpha: 0, sidebarContentColor: '', sidebarGlass: true,
      glassWindow: false, wallpaperBlur: 0, backgroundBrightness: 100, backgroundContrast: 100,
      backgroundSaturate: 100, objectFit: 'cover', flip: false,
    },
    document: {
      body: fxBody,
      getElementById: () => null,
      createElement: () => ({ style: {}, dataset: {} }),
      head: { appendChild: () => {} },
    },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    MutationObserver: FakeMutationObserver,
    GLASS_SATURATE: 1.3, SCRIM_ID: 'we-scrim', LAYER_ID: 'we-layer',
    adapterCaps: () => ({ target: 'plain-browser' }),
    detectMicaSupport: () => true, detectSoftwareRender: () => false,
    useLegacySaturateCoupling: () => false,
    weClampSurfaceColor: (hex) => hex,
    snapshotHostFontDefaults: () => {}, applyComponentFonts: () => {}, removeFontStyles: () => {},
    removeComponentFonts: () => {}, applyCaretStyles: () => {}, removeCaretStyles: () => {},
    syncSceneAudio: () => {},
  };
  const fxScope = new Proxy(fxTarget, {
    has: (t, k) => (k in t) || !(k in globalThis),
    get: (t, k) => (k in t ? t[k] : () => undefined),
    set: () => true,
  });
  const fxMod = new Function('__scope',
    'with (__scope) { ' + stripExportBlocks(fxSrc) + '\nreturn { applyEffects, clearEffects }; }')(fxScope);
  // 只走**拖动档**：那是唯一读缓存的路径（抬手档无论如何都会重算）。
  const liveFadeBg = () => {
    fxProps.length = 0;
    fxMod.applyEffects({ live: true });
    return fxProps.filter((p) => p.startsWith('--we-wallpaper-fade-bg=')).pop();
  };
  assert.equal(liveFadeBg(), '--we-wallpaper-fade-bg=#ffffff', '冷启动（无暗色属性）的衬底 = 纯白');
  const watch = fxObservers[0];
  assert.ok(fxObservers.length === 1 && watch && watch.target === fxBody
    && JSON.stringify(watch.opts) === JSON.stringify({ attributes: true, attributeFilter: ['data-ds-dark-theme'] }),
    '#159①：切主题的失效观察者必须挂在 body 上且只认 data-ds-dark-theme —— 实测 '
    + fxObservers.length + ' 个 / ' + JSON.stringify(watch && watch.opts));
  fxBody.setAttribute('data-ds-dark-theme');
  assert.equal(liveFadeBg(), '--we-wallpaper-fade-bg=#ffffff',
    '负对照：属性翻转但观察者没回调时，拖动档必须仍拿旧值（否则这条判据测的就不是缓存失效）');
  assert.equal(fxObservers.length, 1, '观察者只许挂一次（幂等）：实测 ' + fxObservers.length);
  watch.cb([{ type: 'attributes' }]);
  assert.equal(liveFadeBg(), '--we-wallpaper-fade-bg=#000000',
    '#159①：切到深色后拖动档必须重算到 #000000（缓存被失效）');
  fxMod.clearEffects();
  assert.ok(watch.disconnected, '#159①：clearEffects 必须断开主题观察者（否则卸载后它还挂在宿主 DOM 上）');
  const neverDisconnected = new FakeMutationObserver(() => {});
  neverDisconnected.observe(fxBody, {});
  assert.ok(neverDisconnected.disconnected === false,
    'negative control: 没调 disconnect 的观察者不许判成已断开');
}

// ── #148 宿主半：焦点被**无手势地**搬进壁纸帧时必须交还给用户本来在用的元素 ──────────
// 事故：壁纸（WE 场景 / 网页）每 0.9–3.6 s 调一次 `element.focus()`，把键盘从 DSH 手里拿走 ——
// 用户在输入框打字、输入法候选到一半就断。壁纸帧那一半在 `lib/we-focus-guard.js`（手势窗口），
// 这里钉**宿主文档**那一半：帧内改不到的路径（跨源 `top.focus()`、`autofocus`、`showModal()`、
// `label` 转发）把焦点搬走后，由宿主把它搬回来。判据四件：
//   ① 装上的监听器清单 + 自证对象（真机可核）；
//   ② 三条判据**同时**成立才交还，每条都配一条负对照（焦点落在宿主元素上 / 有真实手势 /
//      focusout 来自别的元素）；
//   ③ 两道保险（记住项过期 / 交还频率）各自负对照；
//   ④ 拆除函数摘干净、可重装，且重复安装不叠加。
// 全部走**真 src/focus-handback.js**（`with` + Proxy 的同一套挂载台；未知自由名直接抛，
// 漏抄依赖清单会响亮地红）。
{
  const fhSrc = readFileSync(new URL('../src/focus-handback.js', import.meta.url), 'utf8');
  const buildFh = (source) => {
    const listeners = [];
    const focused = [];
    const drop = (l) => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
    const win = {
      addEventListener: (t, fn) => { listeners.push({ on: 'window', t, fn }); },
      removeEventListener: (t, fn) => { drop(listeners.find((l) => l.on === 'window' && l.t === t && l.fn === fn)); },
    };
    const doc = {
      body: { tagName: 'BODY' }, documentElement: { tagName: 'HTML' }, activeElement: null,
      addEventListener: (t, fn) => { listeners.push({ on: 'document', t, fn }); },
      removeEventListener: (t, fn) => { drop(listeners.find((l) => l.on === 'document' && l.t === t && l.fn === fn)); },
    };
    const scope = new Proxy({ document: doc, window: win }, {
      has: (t, k) => (k in t) || !(k in globalThis),
      // 未知自由名直接抛：漏抄依赖清单要响亮地红，而不是悄悄拿到一个返回 undefined 的替身。
      get: (t, k) => (k in t ? t[k] : () => { throw new Error('focus-handback 引用了未预期的自由名 ' + String(k)); }),
      set: (t, k, v) => { t[k] = v; return true; },
    });
    const mod = new Function('__scope',
      'with (__scope) { ' + stripExportBlocks(source) + '\nreturn { installFocusHandback }; }')(scope);
    const hostInput = { tagName: 'INPUT', isConnected: true, focus: () => { focused.push('input'); } };
    const hostButton = { tagName: 'BUTTON', isConnected: true, focus: () => { focused.push('button'); } };
    const frame = { tagName: 'IFRAME', className: 'we-media we-iframe', isConnected: true };
    // 事件派发：同类型全部监听器都跑一遍（真实 DOM 里也是这样，我们只挂一份）。
    const fire = (type, target) => { for (const l of listeners.slice()) if (l.t === type) l.fn({ type, target }); };
    return { mod, listeners, focused, win, doc, hostInput, hostButton, frame, fire };
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  // 交还频率下限是 300ms ⇒ 需要"确实过了间隔"的判据就得真等过去（睡一段比造假时钟诚实）。
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const A = buildFh(fhSrc);
  const disposeA = A.mod.installFocusHandback();
  assert.ok(typeof disposeA === 'function', '#148 宿主半：installFocusHandback 必须返回拆除函数（挂 ctx.effect）');
  assert.ok(A.listeners.filter((l) => l.on === 'document').length === 2
    && A.listeners.filter((l) => l.on === 'window').length === 4,
    '#148 宿主半：监听器清单 = document 上 focusin/focusout + window 上 pointerdown/mousedown/touchstart/keydown，实测 '
    + JSON.stringify(A.listeners.map((l) => l.on + ':' + l.t)));
  assert.ok(A.win.__weFocusHandback && A.win.__weFocusHandback.active === true,
    '#148 宿主半：状态必须挂到 window.__weFocusHandback 上（真机控制台自证"交还了几次"）');
  assert.equal(A.mod.installFocusHandback(), disposeA, '#148 宿主半：重复安装必须幂等（返回同一个拆除函数）');
  assert.equal(A.listeners.length, 6, '#148 宿主半：重复安装不许叠加第二套监听器，实测 ' + A.listeners.length);

  // ② 正常交还：用户在输入框里 → 焦点被搬进壁纸帧 → 搬回来。
  A.fire('focusin', A.hostInput);
  assert.equal(A.win.__weFocusHandback.lastEl, A.hostInput,
    '#148 宿主半：focusin 必须记住用户最后在用的那个元素');
  A.doc.activeElement = A.frame;
  A.fire('focusout', A.hostInput);
  await tick();
  assert.deepEqual(A.focused, ['input'],
    '#148 宿主半：焦点被搬进壁纸帧 ⇒ 必须交还给用户本来在用的元素（实测 ' + JSON.stringify(A.focused) + '）');
  assert.equal(A.win.__weFocusHandback.handbacks, 1, '#148 宿主半：交还次数必须如实记账');
  // 壁纸帧自己拿到 focusin 时不许覆盖"记住的元素"（覆盖了 = 下一轮就没得交还，整条机制空转）。
  A.fire('focusin', A.frame);
  assert.equal(A.win.__weFocusHandback.lastEl, A.hostInput,
    '#148 宿主半：壁纸帧自己拿到 focusin 时不许覆盖记住的宿主元素');

  // §11 A3-F1：`lastHandBackAt` 现在挂在 state 上（不再是闭包局部）⇒ 每条负对照前**清零**。
  // 否则"刚刚交还过（< MIN_GAP_MS）"会抢在②③⑤任何一条判定之前 return，把负对照全变成假绿
  // —— 实测删掉 ②/③/⑤ 里任意一条判据，verify-client 仍然是 EXIT 0。
  const resetGap = () => { A.win.__weFocusHandback.lastHandBackAt = 0; };

  // ②负对照之一：焦点落进**宿主元素**（不是壁纸帧）⇒ 不交还（否则会和用户正常切焦点拉锯）。
  resetGap();
  A.doc.activeElement = A.hostButton;
  A.fire('focusin', A.hostInput);
  A.fire('focusout', A.hostInput);
  await tick();
  assert.equal(A.win.__weFocusHandback.handbacks, 1,
    '负对照①：焦点落到宿主元素上时不许交还（否则用户每次点别处都被拽回来）');

  // ②负对照之二：`activeElement` 是壁纸帧但**已断开** ⇒ 不交还（聚焦一个不在文档里的元素毫无意义）。
  resetGap();
  A.doc.activeElement = { tagName: 'IFRAME', className: 'we-iframe', isConnected: false };
  A.fire('focusout', A.hostInput);
  await tick();
  assert.equal(A.win.__weFocusHandback.handbacks, 1,
    '负对照②：壁纸帧已断开时不许交还');

  // ②负对照之三：focusout 来自**别的**元素 ⇒ 连判断都不进（否则每次 blur 都要走一轮）。
  resetGap();
  A.doc.activeElement = A.frame;
  A.fire('focusin', A.hostButton);
  const skipBefore = A.win.__weFocusHandback.skipped;
  A.fire('focusout', A.hostInput);
  await tick();
  assert.ok(A.win.__weFocusHandback.handbacks === 1 && A.win.__weFocusHandback.skipped === skipBefore,
    '负对照③：focusout 的 target 不是记住的那个元素时不交还、也不记 skipped（只认"刚从它离开"）');

  // ③ 保险一：记住项过期（半天前点过的输入框不许被翻出来抢焦点）。
  //    ⚠️ 先睡过 MIN_GAP、并**清零 lastHandBackAt** 再测：否则"没交还"可能是频率下限拦的，
  //    判据就不精确了（首版正是这样"看着绿、其实测的不是这条"—— 它掩盖了阳性对照的失败）。
  await sleep(320);
  resetGap();
  A.win.__weFocusHandback.lastAt = Date.now() - 200000;
  A.doc.activeElement = A.frame;
  const skippedBefore = A.win.__weFocusHandback.skipped;
  A.fire('focusout', A.hostButton);
  await tick();
  assert.ok(A.win.__weFocusHandback.handbacks === 1 && A.win.__weFocusHandback.skipped === skippedBefore + 1,
    '#148 宿主半：记住项超过 STALE_MS 就不交还（且要记一次 skipped，真机据此区分"没触发"与"没装上"）');

  // ③ 阳性对照：间隔够、记住项新鲜 ⇒ 交还成立（同时也是下一条负对照的前提）。
  resetGap();
  A.win.__weFocusHandback.lastAt = Date.now();
  A.fire('focusout', A.hostButton);
  await tick();
  assert.equal(A.win.__weFocusHandback.handbacks, 2,
    '#148 宿主半：正常条件下交还成立（为下一条负对照提供前提）');

  // ③ 保险二：交还频率下限（壁纸高频夺焦时不至于把主线程拖成焦点乒乓）。
  A.doc.activeElement = A.frame;
  A.fire('focusout', A.hostButton);
  await tick();
  assert.equal(A.win.__weFocusHandback.handbacks, 2,
    '#148 宿主半：两次交还之间必须隔 MIN_GAP_MS（紧随其后的第二次不许再交还）');
  await sleep(320);
  A.fire('focusout', A.hostButton);
  await tick();
  assert.equal(A.win.__weFocusHandback.handbacks, 3,
    '负对照：间隔够了（320ms > MIN_GAP_MS）就必须恢复交还 ⇒ 上一条判的不是别的东西');

  // ④ 拆除：摘干净、标记 inactive、拆完不再交还。
  disposeA();
  assert.equal(A.listeners.length, 0, '#148 宿主半：拆除函数必须摘掉全部监听器，残留 ' + A.listeners.length);
  assert.equal(A.win.__weFocusHandback.active, false, '#148 宿主半：拆除后状态必须标记 inactive');
  A.doc.activeElement = A.frame;
  A.fire('focusout', A.hostButton);
  await tick();
  assert.equal(A.win.__weFocusHandback.handbacks, 3, '负对照：拆除后不许再交还');
  assert.ok(typeof A.mod.installFocusHandback() === 'function', '#148 宿主半：拆除后必须能重新装上');

  // ④'' §11 A3-F2：手势窗口里跳过的交还**不永久丢失** —— 窗口关闭时自动补交一次。
  //    没有这一步：焦点进壁纸帧之后宿主收不到 keydown（`gestureAt` 就此冻结），唯一的触发
  //    路径（focusout 的那个 setTimeout）也不会再来 ⇒ 打字期间被夺走的焦点永久掉地。
  //    用**独立实例**，免得补交定时器插入上面那串计量序列。
  const R = buildFh(fhSrc);
  const disposeR = R.mod.installFocusHandback();
  R.fire('focusin', R.hostInput);
  R.fire('pointerdown', null); // 用户自己去点了壁纸 ⇒ 这一轮先跳过
  assert.ok(R.win.__weFocusHandback.gestureAt > 0,
    '#148 宿主半：window 上的四类手势必须刷新"最近真实交互"时间戳');
  R.doc.activeElement = R.frame;
  R.fire('focusout', R.hostInput);
  await tick();
  assert.ok(R.win.__weFocusHandback.handbacks === 0 && R.win.__weFocusHandback.skipped === 1
    && R.focused.length === 0,
    'A3-F2 前提：手势窗口内先跳过（不许立刻交还，且要记一次 skipped），实测 '
    + JSON.stringify({ handbacks: R.win.__weFocusHandback.handbacks, skipped: R.win.__weFocusHandback.skipped, focused: R.focused }));
  await sleep(1150); // 窗口 1000ms 关闭 ⇒ 无需新的 focusout，补交自己发生
  assert.deepEqual(R.focused, ['input'],
    'A3-F2：手势窗口里跳过的交还必须在窗口关闭后补一次（实测 ' + JSON.stringify(R.focused) + '）');
  assert.equal(R.win.__weFocusHandback.handbacks, 1, 'A3-F2：补交也要如实记账');
  // 补交只有**一个在途定时器**：窗口里再来几次 focusout 不叠加、也不立刻交还。
  R.fire('pointerdown', null);
  R.doc.activeElement = R.frame;
  R.fire('focusout', R.hostInput);
  R.fire('focusout', R.hostInput);
  await tick();
  assert.ok(R.win.__weFocusHandback.handbacks === 1 && R.win.__weFocusHandback.skipped === 3,
    'A3-F2：窗口内重复 focusout 不立刻补交、每次跳过都记账，实测 '
    + JSON.stringify({ handbacks: R.win.__weFocusHandback.handbacks, skipped: R.win.__weFocusHandback.skipped }));
  // 拆除必须清掉在途的补交定时器（否则拆完还有异步动静，真机上则是永远醒着的空定时器）。
  // 观测点 = `state.retrying`（自证面里就带着"有没有一个在途的补交定时器"）：只看 handbacks
  // 是抓不到的 —— 定时器即使活着也会被 handBack 首行的 `!active` 挡住，交还计数不变。
  assert.equal(R.win.__weFocusHandback.retrying, true,
    'A3-F2 前提：窗口内跳过一次之后必须真的挂着一个在途补交定时器（否则下一条判据没在判它）');
  disposeR();
  assert.equal(R.win.__weFocusHandback.retrying, false,
    'A3-F2/F5：拆除必须清掉在途的补交定时器（`retrying` 仍为 true = 定时器泄漏，实测被清掉后才是 false）');
  await sleep(1150);
  assert.equal(R.win.__weFocusHandback.handbacks, 1,
    'A3-F2：拆除后补交不许再发生（实测补交又在拆除后发生了）');

  // ④' 环境能力：本仓的 verify 挂载台用 stub `document`（只有 body / style，没有 addEventListener）
  //     ⇒ 必须安静退场（返回 null、不抛、不留半个监听器）。实测 verify-transcode-state 的挂载台
  //     就是这种 document，`ctx.effect` 里抛会中断整条 apply（首版正是这样红的）。
  const bare = buildFh(fhSrc);
  bare.doc.addEventListener = undefined;
  let bareThrew = false;
  let bareRet = 'unset';
  try { bareRet = bare.mod.installFocusHandback(); } catch (err) { bareThrew = true; }
  assert.ok(bareThrew === false && bareRet === null,
    '#148 宿主半：宿主 DOM 能力不全时必须安静退场（返回 null 且不抛），实测 ret=' + String(bareRet));
  assert.equal(bare.listeners.length, 0, '#148 宿主半：退场时不许留下半个监听器');

  // 变异负对照（判据真的在判"手势"与"落点"）：喂同一份源码的两个改写版，各拆掉一条判据。
  // ⚠️ A3-F2 之后手势分支的正文变了（里面多了一段补交）⇒ 这里只替换**判断头**；并且断言
  // 改写确实生效（`replace` 落空会得到一个和原版逐字相同的"变异体"，那种绿是假绿）。
  const mutGestureSrc = fhSrc.replace(
    'if (now - state.gestureAt <= GESTURE_WINDOW_MS) {', 'if (false) { /* 去掉手势判定 */');
  assert.ok(mutGestureSrc !== fhSrc,
    'negative control 的改写必须真的命中源码（否则变异体 = 原版，绿是假的）');
  const mutGesture = buildFh(mutGestureSrc);
  mutGesture.mod.installFocusHandback();
  mutGesture.fire('pointerdown', null);
  mutGesture.fire('focusin', mutGesture.hostInput);
  mutGesture.doc.activeElement = mutGesture.frame;
  mutGesture.fire('focusout', mutGesture.hostInput);
  await tick();
  assert.deepEqual(mutGesture.focused, ['input'],
    'negative control: 摘掉"最近真实交互"判定 ⇒ 有手势也会交还 ⇒ 上面那条负对照不是空转');
  const mutTargetSrc = fhSrc.replace('if (!weIsWallpaperFrame(active) || !active.isConnected) return;',
    '/* 不看落点 */');
  assert.ok(mutTargetSrc !== fhSrc, 'negative control 的改写必须真的命中源码');
  const mutTarget = buildFh(mutTargetSrc);
  mutTarget.mod.installFocusHandback();
  mutTarget.fire('focusin', mutTarget.hostInput);
  mutTarget.doc.activeElement = mutTarget.hostButton;
  mutTarget.fire('focusout', mutTarget.hostInput);
  await tick();
  assert.deepEqual(mutTarget.focused, ['input'],
    'negative control: 摘掉"焦点得在壁纸帧里"判定 ⇒ 落到宿主元素也交还 ⇒ 上面那条负对照不是空转');
}

// ── 滑块的取值域必须**同源于 schema**（为一个真实事故补的判据）────────────────────
// 事故（用户实测）：R4 把刻度改成 0–100 时改了 `KINDS` 与面板量程，**漏了处理器里手写的四处**；
// 而 `clampNum` 是"**越界即回落到默认值**"（不是截断）⇒ 拖过旧上限的瞬间滑块**跳回默认值**
// —— 用户看到的就是"「玻璃透明度」最多只能拉到 20%"（20 正是 `DEFAULTS.glassAlpha`）。
// 判据口径：凡 `clampNum(…, DEFAULTS.<键>)` 的调用，取值域必须写成 `...schemaRange("<键>")`
// （两处都要、且键名必须与被钳的那个键一致）⇒ 以后改 `KINDS` 不会再有第二处要改。
{
  const src = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');
  // ⚠️ 正则要同时认得**两种形态**：修好的 `clampNum(v, ...schemaRange("k"), DEFAULTS.k)` 源码里只有
  //    三个实参（spread 在运行期展开成两个），而写手的旧形态是四个（`v, 0, 60, DEFAULTS.k`）。
  //    所以按"最后一个实参是 DEFAULTS.<键>"来切，把它前面的部分整体当"取值域"。
  const grab = (text) => [...text.matchAll(/clampNum\(\s*([^;]*?),\s*DEFAULTS\.([A-Za-z0-9_]+)\s*\)/g)]
    .map((m) => {
      const parts = m[1].split(',').map((s) => s.trim());
      return { key: m[2], value: parts[0], range: parts.slice(1).join(', ') };
    });
  const calls = grab(src);
  // 违规口径：取值域里出现**数字字面量**（那才会与 KINDS 漂移）。
  // ⚠️ 具名常量（`ROPE_SCALE_MIN` / `ROPE_SCALE_MAX`）**不算违规**：schema 的 KINDS 引用的就是
  //    这两个名字（`min: 'ROPE_SCALE_MIN'`）⇒ 改常量时两边一起改，本来就是同源。
  const bad = calls.filter((c) => /\d/.test(c.range) && c.range !== '...schemaRange("' + c.key + '")');
  assert.ok(calls.length >= 6, '覆盖面：至少 6 处处理器钳制带 DEFAULTS 回退（防判据空转），实测 ' + calls.length);
  assert.equal(bad.length, 0, '取值域不许出现数字字面量（必须走 schemaRange 或具名常量，否则改 KINDS 会漏改）—— 违规：'
    + bad.map((c) => c.key + '(' + c.range + ')').join(', '));
  // 负对照（喂**同一个** grab）：`0, 60` 这种数字字面量必须判出；`...schemaRange(...)` 与具名常量不判出。
  const synth = grab('clampNum(pct, 0, 60, DEFAULTS.glassAlpha)')[0];
  const good = grab('clampNum(pct, ...schemaRange("glassAlpha"), DEFAULTS.glassAlpha)')[0];
  const named = grab('clampNum(scale, ROPE_SCALE_MIN, ROPE_SCALE_MAX, DEFAULTS.ropeScale)')[0];
  assert.ok(synth && /\d/.test(synth.range) && good && !/\d/.test(good.range)
    && named && !/\d/.test(named.range),
    'negative control: `0, 60` 判出；`...schemaRange(...)` 与具名常量不判出');
}

// ── 皮肤中心互操作：皮肤在台上 ⇒ 我方整族退场（壁纸 + 玻璃门控）────────────────
// 判据四件：① 单腿信号（DOM 观察；轮询腿与对方路由依赖随 dsh-skins#49 契约落定整体删除）；
// ② 只读对方（绝不写它的标记）；③ 退场在玻璃三层门控点都生效、复位带滞回、手动重选立刻退；
// ④ 复位按记忆且不抢用户新选择。
{
  const clientSrc = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');
  const glassSrc = readFileSync(new URL('../src/glass.js', import.meta.url), 'utf8');
  const effectsSrc = readFileSync(new URL('../src/effects.js', import.meta.url), 'utf8');
  const mediaSrc = readFileSync(new URL('../src/media-prep.js', import.meta.url), 'utf8');
  // ① 单腿：只观察对方的公开标记。轮询（GET /api/skin-center/v2/active）在对方的显式动作
  //    契约（dsh-skins#49：试穿/应用/重复应用都写 html[data-dsh-skin]）落地后不该再回来。
  //    ⚠️ 判据只看**代码**（剥注释）：文件头注释里会写这条路由的历史，字面量匹配会误伤。
  const clientCode = stripComments(clientSrc);
  assert.ok(/attributeFilter: \["data-dsh-skin"\]/.test(clientSrc),
    '互操作：DOM 那条腿必须只观察对方的 data-dsh-skin');
  assert.ok(!clientCode.includes('skin-center/v2/active') && !clientCode.includes('SKIN_ACTIVE_URL'),
    '互操作：轮询腿与对方路由的依赖必须已删除（信号契约落地后不再需要）');
  assert.ok(clientSrc.includes('ctx.effect(() => installSkinInterop()'),
    '互操作：观察器必须随 fiber 挂载（卸载即摘）');
  // 装入瞬间只认领现状、不当作动作：启动期 enter→清壁纸→设置合并复活→exit 的抖动会把用户的
  // 壁纸选择抹掉（实测刷新闪烁的放大器）。判据钉死"认领"分支且 install 里不再有 enter；
  // 认领的记忆从**盘上落的那份**拿（enter 写的两枚键），没落过盘才退回空记忆。
  assert.ok(/skinYielded = true;\s*\n\s*skinYieldMemory = \{\s*\n\s*id: rid,/.test(clientSrc)
    && /rotationEnabled: rid \? selection\.skinYieldRestoreRotation === true : selection\.rotationEnabled === true/.test(clientSrc)
    && /reportClientDiag\("skin-yield", "adopt · install\/dom"\)/.test(clientSrc),
    '互操作：install 腿必须只"认领"（id 为空且皮肤在台上；记忆从盘上落的那份拿），不新建退场');
  const installBody = clientSrc.slice(clientSrc.indexOf('function installSkinInterop()'), clientSrc.indexOf('function installSkinInterop()') + 2200);
  assert.ok(!/enterSkinYield\(/.test(installBody) && /adopt · install\/dom/.test(installBody),
    '互操作：install 路径不许再调 enterSkinYield（启动不是用户动作）');
  // ①a 启动竞态判据：壁纸腿要"过一拍仍在台上 + 标记在场"（对方的运行时会在我们的标记之前
  //     先按持久化选择上妆；把它当动作 ⇒ 有壁纸时刷新掉壁纸），设置在途（!loaded）一律不算。
  //     无壁纸腿也要进 —— 玻璃与壁纸正交（data-we-glass-page 恒挂），无壁纸用户中途试穿 /
  //     应用皮肤也得摘玻璃（安装期的 adopt 只管启动那一拍，这条腿管中途上台）。
  assert.ok(/function scheduleSkinYieldEnter\(/.test(clientSrc)
    && /if \(!document\.documentElement\.hasAttribute\("data-dsh-skin"\)\) return;/.test(clientSrc)
    && /const wallMarkerOn = !!\(document\.body && document\.body\.hasAttribute\("data-we-wallpaper"\)\);/.test(clientSrc)
    && /if \(!wallMarkerOn && \(selection\.id \|\| !selection\.loaded\)\) return;/.test(clientSrc)
    && /enterSkinYield\(reason \+ "\/dom"\)/.test(clientSrc)
    && /SKIN_YIELD_ENTER_GRACE_MS = \d+/.test(clientSrc),
    '互操作：退场要"过一拍仍在 + 我方在台上（壁纸在台，或无壁纸且设置已就位）"才执行（竞态不许清壁纸；无壁纸也要摘玻璃）');
  // ①b 跨插件读契约（dsh-skins 的首屏预判，issue #51）：对方在出文档之前同步读
  //     `<DSH_WE_DATA_DIR || ~/.dsh-wallpaper-engine>/config.json` 的 `settings.id`
  //     （非空 ⇒ 首帧不画皮肤）。路径 / 环境变量名 / 键名是**双边契约**，单方面改动会把
  //     首帧预判打回"皮肤先闪一下"。
  const hostSrc = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8');
  assert.ok(hostSrc.includes('process.env.DSH_WE_DATA_DIR')
    && hostSrc.includes("join(pluginDataDir(), 'config.json')"),
    '首屏预判契约：数据目录环境变量名与 config.json 路径不能被单方面改名');
  const schemaMod = await import(new URL('../lib/settings-schema.js', import.meta.url).href);
  assert.ok(schemaMod.serializeSettings({ id: 'x' }).id === 'x',
    '首屏预判契约：settings.id 必须始终被序列化进持久化文件');
  assert.ok(schemaMod.serializeSettings({}).id === '',
    '首屏预判契约：没有选择时 settings.id 必须是空串（对方按"非空"判定壁纸在台）');
  // ② 只读纪律：绝不写对方的任何标记（一旦写了就会与对方的切换引擎打架）。
  assert.ok(!/setAttribute\(\s*["']data-dsh-skin["']/.test(clientSrc)
    && !/delete\s+document\.body\.dataset\.dshSkinCenter/.test(clientSrc),
    '互操作只读：不许写对方的 data-dsh-skin / data-dsh-skin-center');
  // ③ 退场在三处门控点都生效：glass 的整族摘除、effects 的两处（思考玻璃 / 侧栏跟随）。
  assert.ok(glassSrc.includes('data-we-sidebar-fullclear') && glassSrc.includes('skinYieldActive()'),
    '退场：glass 整族门控要有摘除路径');
  const yieldIdx = glassSrc.indexOf('skinYieldActive()');
  const pageGateIdx = glassSrc.indexOf('setAttribute("data-we-glass-page"');
  assert.ok(yieldIdx >= 0 && pageGateIdx > yieldIdx, '退场必须先于本函数挂任何玻璃面');
  assert.ok(/selection\.thinkingGlass && !selection\.thinkingNative && !skinYield/.test(effectsSrc),
    '退场：思考玻璃门控点要带让路守卫');
  assert.ok(/selection\.thinkingNative && !skinYield/.test(effectsSrc),
    '退场：原生挡门控点要带让路守卫（三挡的第二半，2026-10-06）');
  assert.ok(/selection\.sidebarGlass && selection\.sidebarFollowGlobal && !skinYield/.test(effectsSrc),
    '退场：侧栏跟随门控点要带让路守卫');
  // ③b 复位滞回：对方 refresh 会先摘标记再补回，瞬时摘不许直接复位（现场踩过 0.7s 抢回壁纸）。
  assert.ok(/function scheduleSkinYieldExit\(/.test(clientSrc)
    && /cancelSkinYieldExit\(\)/.test(clientSrc)
    && /SKIN_YIELD_EXIT_GRACE_MS = \d+/.test(clientSrc)
    && /if \(skinYielded\) scheduleSkinYieldExit\(reason\)/.test(clientSrc),
    '复位要有滞回（schedule/cancel + 宽限常量），瞬时摘标记不许直接复位');
  // ③c 手动重选壁纸 = 最新显式动作 ⇒ 立刻退让路，且不拿记忆里的旧 id 覆盖用户的新选择。
  assert.ok(/opts\.fromManual\s*&&\s*typeof skinYieldActive === "function" && skinYieldActive\(\)/.test(mediaSrc)
    && /exitSkinYield\("manual-pick", \{ skipRestore: true \}\)/.test(mediaSrc),
    '让路态里的手动重选要立刻退出让路（只认 fromManual）');
  assert.ok(/function exitSkinYield\(reason, opts\)/.test(clientSrc)
    && /if \(!skipRestore && !selection\.id && mem\.id\) \{/.test(clientSrc)
    && /applySelection\(mem\.id, \{ fromSkinRestore: true \}\)/.test(clientSrc),
    '手动重选退出时不许用记忆里的旧 id 覆盖用户的新选择（放回那次带 fromSkinRestore）');
  // ④ 复位：按记忆放回（在 exitSkinYield 里）；轮播必须一起按停；诊断行留痕。
  assert.ok(/if \(!skinYielded\) return;/.test(clientSrc)
    && clientSrc.includes('if (selection.rotationEnabled) setSetting("rotationEnabled", false)'),
    '退场：必须先按停轮播，否则空 id 会被 rotation 自动补位');
  assert.ok(clientSrc.includes('reportClientDiag("skin-yield"'),
    '退场 / 复位要留诊断行（skin-yield），否则现场无法回放是谁触发的');
  // ⑤ 让路记忆**落盘**（跨重启）：enter 落（skinYieldRestoreId / skinYieldRestoreRotation）、
  //    exit 消费即清、认领从盘上拿、启动复位按盘上放回（boot-restore 借 exit 的消费路径）。
  assert.ok(/setSetting\("skinYieldRestoreId", skinYieldMemory\.id\);/.test(clientSrc)
    && /setSetting\("skinYieldRestoreRotation", skinYieldMemory\.rotationEnabled\);/.test(clientSrc)
    && /setSetting\("skinYieldRestoreId", ""\);/.test(clientSrc)
    && /setSetting\("skinYieldRestoreRotation", false\);/.test(clientSrc)
    && /exitSkinYield\("boot-restore"\)/.test(clientSrc),
    '让路记忆要落盘（enter 落 / exit 清 / 认领与启动复位读盘），否则重启一次就丢');
  const noClear = clientSrc.replace('setSetting("skinYieldRestoreId", "");', '/* 漏清 */');
  assert.ok(!/setSetting\("skinYieldRestoreId", ""\);/.test(noClear),
    'negative control: 复位漏清落盘记忆即判红');
  // 负对照（喂**同一个**判据）：三处退化都必须判出；轮询腿被加回来也必须判出。
  const stripped = effectsSrc.replace(/&& !skinYield/g, '');
  assert.ok(!/selection\.thinkingGlass && !skinYield/.test(stripped)
    && !/selection\.sidebarGlass && selection\.sidebarFollowGlobal && !skinYield/.test(stripped),
    'negative control: 摘掉让路守卫即判红');
  const noHyst = clientSrc.replace('if (skinYielded) scheduleSkinYieldExit(reason);', 'if (skinYielded) exitSkinYield(reason + "/cleared");');
  assert.ok(!/if \(skinYielded\) scheduleSkinYieldExit\(reason\)/.test(noHyst),
    'negative control: 复位退回"立即 exit"即判红');
  const med = mediaSrc.replace('opts.fromManual', 'true');
  assert.ok(!/opts\.fromManual\s*&&\s*typeof skinYieldActive/.test(med),
    'negative control: 手动重选钩子改吃所有调用即判红');
  const noAdopt = clientSrc.replace(
    /skinYielded = true;\s*\n\s*skinYieldMemory = \{\s*\n\s*id: rid,/,
    'enterSkinYield("install/dom"); /*');
  assert.ok(!/skinYielded = true;\s*\n\s*skinYieldMemory = \{\s*\n\s*id: rid,/.test(noAdopt),
    'negative control: 认领分支退回 enter 即判红');
  const noStageGate = clientSrc.replace('if (!wallMarkerOn && (selection.id || !selection.loaded)) return;',
    '/* 去掉在台前提 */');
  assert.ok(!/if \(!wallMarkerOn && \(selection\.id \|\| !selection\.loaded\)\) return;/.test(noStageGate),
    'negative control: 去掉"我方在台上"这个前提即判红');
  // 回退负对照：单腿旧条件（只认壁纸标记 ⇒ 无壁纸用户永远进不了让路）也必须判出。
  const oneLegRegress = clientSrc.replace(
    'if (!wallMarkerOn && (selection.id || !selection.loaded)) return;',
    'if (!(document.body && document.body.hasAttribute("data-we-wallpaper"))) return;');
  assert.ok(!/if \(!wallMarkerOn && \(selection\.id \|\| !selection\.loaded\)\) return;/.test(oneLegRegress),
    'negative control: 退回"只认壁纸标记"的单腿旧条件即判红');
  const noEnterHyst = clientSrc.replace('if (!document.documentElement.hasAttribute("data-dsh-skin")) return; // 瞬时翻转：已自纠',
    '/* 去掉瞬时翻转前提 */');
  assert.ok(!/if \(!document\.documentElement\.hasAttribute\("data-dsh-skin"\)\) return;/.test(noEnterHyst),
    'negative control: 去掉"过一拍仍在台上"这个前提即判红');
  const wrongPath = hostSrc.replace("join(pluginDataDir(), 'config.json')", "join(pluginDataDir(), 'config2.json')");
  assert.ok(!wrongPath.includes("join(pluginDataDir(), 'config.json')"),
    'negative control: 配置文件路径被改名即判红');
  assert.ok(schemaMod.serializeSettings({ id: '' }).id === '',
    'negative control: 空 id 不会被伪造成非空（对方据此判"壁纸在台"）');
  const revived = clientCode.replace('const SKIN_YIELD_EXIT_GRACE_MS',
    'const SKIN_ACTIVE_URL = "/api/skin-center/v2/active";\nconst SKIN_YIELD_EXIT_GRACE_MS');
  assert.ok(revived.includes('skin-center/v2/active'),
    'negative control: 判据能发现轮询腿被加回来（喂同一份剥注释源码）');
  // ⑥ 主题维度（用户口径：WE 在台时主题归 WE；退场把**改过的那份**放回；任何外部主题切换
  //    不硬覆盖回去）：清空路径放回、让路态整族不写、复位那次带 fromSkinRestore（让位标记
  //    不复位 —— 皮肤窗口里改过的主题不被放回打回）。行为面在 test/verify-theme-follow.mjs ⑧。
  const themeSrc = readFileSync(new URL('../src/theme-follow.js', import.meta.url), 'utf8');
  assert.ok(mediaSrc.includes('themeFollowRelease();')
    && /themeFollowOnWallpaper\(selection, \{ fromSkinRestore: !!\(opts && opts\.fromSkinRestore\) \}\);/.test(mediaSrc),
    '主题维度：清空路径要放回、评估要透传"皮肤放回"标志（src/media-prep.js）');
  assert.ok(clientSrc.includes('applySelection(mem.id, { fromSkinRestore: true });'),
    '主题维度：皮肤退场放回壁纸时带 fromSkinRestore（src/client.js）');
  assert.ok((themeSrc.match(/\|\| themeFollowSkinYielded\(\)\)|if \(themeFollowSkinYielded\(\)\)/g) || []).length === 5,
    '主题维度：评估 / 写 / 图源 / 两条帧腿共 5 处写入口都要带皮肤让路门');
  assert.ok(/function themeFollowRelease\(\)/.test(themeSrc)
    && /if \(themeFollowYield\) return;/.test(themeSrc)
    && /if \(current && current !== themeFollowWritten\) return;/.test(themeSrc),
    '主题维度：放回要带"别人接管过就不碰"的两层判据（让位标记 + 现值比对）');
  const noRelease = mediaSrc.replace('themeFollowRelease();', '/* 漏放回 */');
  assert.ok(!/themeFollowRelease\(\);/.test(noRelease), 'negative control: 清空路径漏放回即判红');
  const gateRe = /\|\| themeFollowSkinYielded\(\)\)|if \(themeFollowSkinYielded\(\)\)/g;
  const noThemeGate = themeSrc.replace(gateRe, '');
  assert.ok((noThemeGate.match(gateRe) || []).length !== 5,
    'negative control: 摘掉主题的皮肤让路门即判红');
  const stompBack = themeSrc.replace('if (current && current !== themeFollowWritten) return;', '/* 无脑放回 */');
  assert.ok(!/if \(current && current !== themeFollowWritten\) return;/.test(stompBack),
    'negative control: 放回变成无脑覆盖（不看现值）即判红');
}

console.log('\nALL CLIENT CHECKS DONE');
}, 50);
