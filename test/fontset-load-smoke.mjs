// React #31 校验：**对象不能作为子节点**。替身若默默吞掉，这类错就只能在真机上炸
// （实测：参数位置上的赋值表达式把"角色对象数组"当成了子节点，空表时看不出、
// 一旦筛出角色整块面板就崩）。替身必须和 React 一样**抛**。
function badChild(c) {
  if (c === null || c === undefined || typeof c === 'boolean' || typeof c === 'string' || typeof c === 'number') return null;
  if (Array.isArray(c)) { for (const x of c) { const b = badChild(x); if (b) return b; } return null; }
  if (typeof c === 'object' && c.type) return null;
  return c;
}
function assertChildren(children) {
  for (const c of children) {
    const bad = badChild(c);
    if (bad) throw new Error('React #31：无效子节点（对象不能作为子节点）: ' + JSON.stringify(Object.keys(bad)).slice(0, 80));
  }
}// fontset-load-smoke.mjs — F3 阶段 2：客户端**从活动字体集载入**这条通道的节点级冒烟。
//
// 为什么值得单独一条：`src/fontset-store.js` 是"字体值到底存哪"的另一半答案，而它的失败形态
// 与设置不同 —— 设置丢一次只是回退，字体集读不出来必须**整套不采用**（半套用会让外观说不清）。
// 本冒烟把可观察的三件事钉住：
//   ① 启动链真的按 **settings → 字体集（list → 活动那份）→ 库存** 的顺序取数；
//   ② 宿主那份值被**整套**采用（证据 = 本地缓存 `we-fontset-active` 与宿主逐键相同 ——
//      缓存与 `Object.assign(selection, values)` 在同一个分支里写，缓存对 = 采用过）；
//   ③ 宿主读不出来时**不写回、不编造**：本地缓存保持原样（先前的值），不会退化成默认值。
//
// 判据的边界（如实记下，不假装）：**"失败时 selection 逐字段未被改动"没有在本冒烟里直接观察到**
// —— selection 是 bundle 内部状态，本挂载台只暴露 apply/inject。可观察的是它上面的不变量
// （缓存不被覆盖、没有发起任何写），以及源码里那条"要么整套 Object.assign、要么什么都不动"的分支。
// 「点滑块 → PUT 到活动集」的写路径要等阶段 3 的面板（那时才有可驱动的 UI），届时在同一挂载台上补。
//
// Usage: node test/fontset-load-smoke.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log('  ✓ ' + label + (detail ? ' — ' + detail : ''));
  else { failures++; console.log('  ✗ ' + label + (detail ? ' — ' + detail : '')); }
};

// `useState` 必须支持**惰性初始化**（`useState(readSavedPickerTab)` 传的是函数）：
// 假 React 直接把它当值返回的话，页签永远是默认的「壁纸」——面板内容就驱动不到。
const React = { Fragment: 'Fragment', useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {}, useRef: (v) => ({ current: v }),
  createElement: (t, p, ...c) => { assertChildren(c); return typeof t === 'function' ? t(p || {}, ...c) : { type: t, props: p || null, children: c }; } };
// ⚠️ 这一档**不跑 effect、setter 是空操作** ⇒ 这台子看不见"改了状态却忘了 `emit()`"的缺陷
//（真机的重渲挂在**插件自己那个根组件**的 effect 上，而台子渲染的是 `slots.register` 的渲染器）。
// 那个契约由 `verify-client` 的 ①f 从源码面钉住（令牌动作必须每次都通知 + 收起分支必须走它）。

/** 宿主那份活动集（字体键齐全 —— 宿主永远给全）。 */
const HOST_VALUES = {
  themeColors: { primary: { light: '#112233', dark: '#aabbcc' } },
  themeDarkSeparate: true,
  themeSize: { 'markdown-h1': 24 },
  themeWeight: { 'markdown-h1': 900 },
  themeFamily: { 'markdown-h1': 'SimSun' },
  globalFamily: 'sys:PingFang SC',
  componentFonts: { markdown: { size: 15 } },
};
/** 本地缓存里"上次那份"（与宿主那份**明显不同**，才能分辨谁赢了）。 */
const CACHED_VALUES = {
  themeColors: {}, themeDarkSeparate: false, themeSize: { 'markdown-h1': 19 },
  themeWeight: {}, themeFamily: {}, globalFamily: '', componentFonts: {},
};
const CACHE_KEY = 'we-fontset-active';

function makeEl(tag) {
  const listeners = {};
  const el = {
    tagName: tag.toUpperCase(), children: [], dataset: {}, attributes: {},
    style: { _props: {}, cssText: '', setProperty(k, v) { this._props[k] = v; }, removeProperty(k) { delete this._props[k]; } },
    className: '', textContent: '',
    appendChild(c) { this.children.push(c); c._parent = this; return c; },
    remove() { if (this._parent) { const i = this._parent.children.indexOf(this); if (i >= 0) this._parent.children.splice(i, 1); } },
    setAttribute(k, v) { this.attributes[k] = v; },
    removeAttribute(k) { delete this.attributes[k]; },
    getAttribute(k) { return this.attributes[k] ?? null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    contains() { return false; },
    get isConnected() { return true; },
    addEventListener(ev, fn) { (listeners[ev] ||= []).push(fn); },
    removeEventListener(ev, fn) { const l = listeners[ev]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } },
    __fire(ev) { (listeners[ev] || []).slice().forEach((f) => f()); },
    play() { return Promise.resolve(); }, pause() {}, load() {},
  };
  el.classList = { add() {}, remove() {} };
  return el;
}

/**
 * 挂一个客户端实例。
 * @param fetchImpl (url, init) => Promise<Response 形态>
 * @param store     跨挂载共享的 localStorage 后备（第二个场景要看得见第一个写下的缓存）
 */
function mount({ fetchImpl, store }) {
  const bodyEl = makeEl('body');
  const document = {
    createElement: (t) => makeEl(t),
    getElementById: () => null,
    querySelector: () => null,
    head: { appendChild: () => {} },
    body: bodyEl,
    hidden: false,
    hasFocus: () => true,
    addEventListener() {},
    removeEventListener() {},
    documentElement: makeEl('html'),
  };
  const localStorage = {
    _store: store,
    getItem(k) { return this._store[k] ?? null; },
    setItem(k, v) { this._store[k] = v; },
    removeItem(k) { delete this._store[k]; },
  };
  const requests = [];
  const fetch = (url, init) => {
    const o = init || {};
    requests.push({ method: (o.method || 'GET').toUpperCase(), url: String(url), body: o.body || null });
    return fetchImpl(String(url), o);
  };
  const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  const cap = { handoff: null };
  // 2026-10-09 字体节迁侧栏：这台的面板渲染器必须把**官方侧栏 body** 也注册出来（字体 UI
  // 现在只画在侧栏外观页），且要把「外观页 + 字体节展开」的 UI 状态播进 store ——
  // 与 verify-client / verify-system-fonts 同一套手法（qp-* 键仅 UI 状态，不进 config.json）。
  store['dsh-wallpaper-engine:qp-tab'] = 'appearance';
  store['dsh-wallpaper-engine:qp-font-open'] = '1';
  // 定时器登记表 + 面板渲染器：写路径的判据要"重渲一次面板（= 真机里 emit() 做的事）
  // → 点滑块 → 跑 200ms debounce → 看发了什么请求"。
  const timers = [];
  const renderers = [];
  const fireTimers = (ms) => timers.filter((t) => !t.cleared && t.ms === ms).forEach((t) => { t.cleared = true; t.fn(); });
  const stubTimeout = (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; };
  const sandbox = {
    window: {
      __ModuleLoader__: { load: (h) => { cap.handoff = h; } },
      setTimeout: stubTimeout,
      clearTimeout: (t) => { if (t) t.cleared = true; },
      addEventListener() {}, removeEventListener() {},
      innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1,
    },
    document, localStorage, fetch, React,
    location: { origin: 'http://localhost' },
    setTimeout: stubTimeout,
    clearTimeout: (t) => { if (t) t.cleared = true; },
  };
  vm.createContext(sandbox);
  new vm.Script(code, { filename: 'client.js' }).runInContext(sandbox);
  const exportsObj = cap.handoff.factory((spec) => (spec === 'react' ? React : { createPortal: (n) => n }));
  exportsObj.apply({
    // 面板由 `slots.inject(名称, () => slots.register(meta, render))` 装配；产出元素树的是
    // **register 的第二个参数**。`apply()` 期就把首次渲染跑一遍（真机也这样），但那时库存还没到
    // （面板停在「扫描…」）⇒ 把 renderer 留下，**启动完成后重渲一次**（= 真机 emit() 触发的那次）。
    slots: {
      inject: (k, cb) => { try { cb(); } catch { /* 首帧渲染失败不影响后续重渲 */ } },
      register: (meta, render) => { if (typeof render === 'function') renderers.push(render); return null; },
    },
    // 侧栏官方档的两个可选服务桩（见上面注释：字体 UI 的新家在这里注册出来）。
    get: (name) => (name === 'sidebarRightTabs' ? { register: () => () => {} }
      : name === 'sidebarRight' ? { openTab: () => {} } : null),
    effect(fn) { fn(); return fn; },
  });
  return {
    requests, store: localStorage._store, timers, fireTimers,
    renderPanel: () => renderers.map((r) => r()),
  };
}

/** 展平渲染树里的宿主节点（假 React 已把函数组件展开）。 */
function collectTree(root, out = []) {
  if (Array.isArray(root)) { root.forEach((n) => collectTree(n, out)); return out; }
  if (!root || typeof root !== 'object') return out;
  if (root.type) out.push(root);
  if (Array.isArray(root.children)) root.children.forEach((n) => collectTree(n, out));
  return out;
}

/** 一个"正常的宿主"：/settings + /fontsets（活动集是 compact）+ /inventory。settings 可参数化。 */
const hostWith = (settings) => (url, init) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(
  String(url).includes('/fontsets/import') ? { ok: true, id: 'imported-1', name: '导入的那份' }
    : url.includes('/fontsets/') ? { ok: true, id: 'compact', name: '紧凑', values: HOST_VALUES }
      : url.includes('/fontsets') ? { fontsets: [{ id: 'compact', name: '紧凑', origin: 'builtin', active: true }], active: 'compact', migrated: false, adopted: false }
        : url.includes('/settings') ? { ok: true, betterSidebar: false, settings }
          : { installDir: 'D:/we', total: 1, portableCount: 1, playlists: [], wallpapers: [
            { id: 'v', title: 'V', type: 'video', playable: true, media: '/wallpaper-engine/media/vvv', preview: null, contentrating: 'Everyone' },
          ] }) });
const goodHost = hostWith({ id: 'v', blur: 7 });

/** 一个"字体集**本体**读不出来"的宿主：清单正常（活动集是 compact），那一份是 422。 */
const brokenFontSetHost = (url) => Promise.resolve(
  url.includes('/fontsets/')
    ? { ok: false, status: 422, json: () => Promise.resolve({ error: 'fontset file is unreadable', reason: 'bad-version' }) }
    : goodHost(url));

/** 一个"字体集清单都拿不到"的宿主（整条通道不可用）。 */
const noFontSetHost = (url) => Promise.resolve(
  url.includes('/fontsets')
    ? { ok: false, status: 404, json: () => Promise.resolve({ error: 'not found' }) }
    : goodHost(url));

const waitBoot = () => new Promise((r) => setTimeout(r, 50));

(async () => {
  // ── 场景 A：正常宿主 —— 值被整套采用，顺序正确 ──────────────────────────────
  console.log('A. 正常宿主：settings → 字体集(list → 活动那份) → 库存');
  const shared = {}; // 跨场景共享的 localStorage（第二个场景要看得见第一个写下的缓存）
  const a = mount({ fetchImpl: goodHost, store: shared });
  await waitBoot();
  const order = a.requests.map((r) => r.method + ' ' + r.url.replace('http://localhost', ''));
  const iSettings = order.findIndex((x) => x.includes('/settings'));
  const iList = order.findIndex((x) => x.endsWith('/wallpaper-engine/fontsets'));
  const iOne = order.findIndex((x) => x.includes('/fontsets/compact'));
  const iInv = order.findIndex((x) => x.includes('/inventory'));
  check('启动链取了 /fontsets 与活动那份', iList >= 0 && iOne >= 0, order.join(' | '));
  check('顺序 = settings → 字体集清单 → 活动那份 → 库存',
    iSettings >= 0 && iSettings < iList && iList < iOne && iOne < iInv, 'idx=' + [iSettings, iList, iOne, iInv].join(','));
  const cacheA = JSON.parse(shared[CACHE_KEY] || 'null');
  check('宿主那份被整套采用（本地缓存 = 活动 id + 全部字体键，与宿主逐键相同）',
    cacheA && cacheA.id === 'compact'
    && JSON.stringify(Object.keys(cacheA.values).sort()) === JSON.stringify(Object.keys(HOST_VALUES).sort())
    && JSON.stringify(cacheA.values) === JSON.stringify(HOST_VALUES),
    JSON.stringify(cacheA && { id: cacheA.id, size: cacheA.values && cacheA.values.themeSize }));
  check('启动期不发生任何字体集写入（载入 ≠ 落盘）',
    a.requests.every((r) => !(r.method === 'PUT' && r.url.includes('/fontsets'))), order.filter((x) => x.startsWith('PUT')).join(' | '));
  check('启动期的 PUT /settings 体里没有字体键（字体键已不走这条通道）',
    a.requests.filter((r) => r.method === 'PUT' && r.url.includes('/settings'))
      .every((r) => !/themeColors|themeSize|themeWeight|themeFamily|globalFamily|componentFonts|themeDarkSeparate/.test(String(r.body || ''))),
    a.requests.filter((r) => r.method === 'PUT').map((r) => r.url).join(' | ') || '(无 PUT)');

  // ── 场景 B：宿主读不出来 —— 不写回、不编造（缓存保持上次那份）────────────────
  console.log('B. 字体集读不出来：保留上次那份，不写回、不编造');
  const b = mount({ fetchImpl: brokenFontSetHost, store: shared });
  await waitBoot();
  const cacheB = JSON.parse(shared[CACHE_KEY] || 'null');
  check('读失败后本地缓存**仍是上次那份**（没有被清成默认值）',
    cacheB && cacheB.id === 'compact' && JSON.stringify(cacheB.values) === JSON.stringify(HOST_VALUES),
    JSON.stringify(cacheB && cacheB.id));
  check('读失败也不发起任何字体集写入（不拿默认值去覆盖宿主）',
    b.requests.every((r) => !(r.method === 'PUT' && r.url.includes('/fontsets'))));
  check('失败是"取过、被拒"而不是"没取"（请求记录里看得到那次 422）',
    b.requests.some((r) => r.url.includes('/fontsets/compact')), b.requests.map((r) => r.url.replace('http://localhost', '')).join(' | '));

  // ── 场景 C：全新安装 + 整条通道不可用 —— 不凭空造一份缓存 ────────────────────
  //    ⚠️ 这里刻意带上**设置缓存**（= 升级后的真实状态：localStorage 里有设置、但没有字体集缓存）。
  //    那正是"点『字体自定义』白屏"复现所需的条件：`readPersisted()` 走消毒分支 ⇒ 不再提供那些
  //    字体键，而字体集又读不出来 ⇒ 靠 selection 初始化里的兜底顶着。挂载不抛 = 兜底在位。
  console.log('C. 有设置缓存 + 没有字体集缓存 + 清单都拿不到：挂载不抛、不凭空造缓存');
  const fresh = {
    'dsh-wallpaper-engine:selection': JSON.stringify({ id: 'v', fontCustom: true, blur: 9 }),
  };
  let mountThrew = '';
  try { mount({ fetchImpl: noFontSetHost, store: fresh }); } catch (e) { mountThrew = String((e && e.message) || e); }
  await waitBoot();
  check('没有缓存时不写出任何缓存（也就不会把"默认值"伪装成用户的那份）',
    fresh[CACHE_KEY] === undefined, String(fresh[CACHE_KEY]));
  check('挂载/启动不抛（字体键的兜底在位 ⇒ 面板与令牌层的取值路径拿到的都是对象）',
    mountThrew === '', mountThrew || 'fontCustom=true + 无字体集缓存 + 宿主读不出来');

  // ── 共用驱动器：点开「字体集预设」子分支 + 读面板文案（D/E/F/G 都要用）──────────
  /** 点开「字体集预设」子分支：面板里那个 checkbox 的 aria-label 就是行标签。 */
  const openFontSetEditor = (d) => {
    const box = d.renderPanel().flatMap((t) => collectTree(t))
      .find((n) => n.type === 'input' && n.props && n.props['aria-label'] === '字体集预设');
    if (box) box.props.onChange({ target: { checked: true } });
    return Boolean(box);
  };
  /** 面板整棵树的文案（标记、失败态都长在这里）。 */
  const panelText = (d) => d.renderPanel().flatMap((t) => collectTree(t))
    .map((n) => (Array.isArray(n.children) ? n.children.filter((c) => typeof c === 'string').join('') : '')).join(' | ');

  // ── 场景 D：写路径（阶段 2 记下的差额，在这里补上）────────────────────────────
  // 面板的初始页签取自 localStorage（`PICKER_TAB_KEY`）⇒ 挂载台可以**直接渲染「外观」页签**，
  // 于是"点一下字号滑块 ⇒ 写活动集、不写 /settings"第一次成为**行为**判据。
  console.log('D. 写路径：改字号 ⇒ PUT 到活动集，且完全不碰 /settings');
  const dStore = {
    'dsh-wallpaper-engine:selection': JSON.stringify({ id: 'v', fontCustom: true }),
    'dsh-wallpaper-engine:picker-tab': 'appearance',
  };
  const d = mount({ fetchImpl: hostWith({ id: 'v', fontCustom: true }), store: dStore });
  await waitBoot();
  // 启动完成后再渲一次面板（= 真机里 emit() 触发的那次重渲）：此时库存与设置都已到位。
  const sizeInputs = d.renderPanel()
    .flatMap((tree) => collectTree(tree))
    .filter((n) => n.type === 'input' && /字号 px/.test(String((n.props || {}).title || '')));
  check('「外观」页签里找得到排版角色的字号输入（写路径的前置：UI 可达）',
    sizeInputs.length > 0, sizeInputs.length + ' 个字号输入');
  // 「使用中」= **值仍然一致**（不是"宿主指针指着它"）：这里先记下**改之前**的标记，
  // 改完再对照 —— 一组真正的前后对照，而不是只看改完那一眼。
  openFontSetEditor(d);
  await new Promise((r) => setTimeout(r, 20));
  const markBefore = panelText(d);
  check('改之前：那一行标「（使用中）」（刚采纳，值一致）',
    markBefore.includes('（使用中）') && !markBefore.includes('（已改）'), markBefore.slice(-64));
  // 先把**启动期**挂起的写放掉（真机里 200ms 后自然落的那次）：否则它会被下面这次
  // `fireTimers(200)` 一起释放，混进"改字号之后发了什么"的窗口里（判据就说不清了）。
  d.fireTimers(200);
  await new Promise((r) => setTimeout(r, 10));
  const before = d.requests.length;
  if (sizeInputs.length) sizeInputs[0].props.onChange({ target: { value: '26' } });
  d.fireTimers(200); // 200ms debounce 到点 ⇒ flushFontSet ⇒ PUT
  await new Promise((r) => setTimeout(r, 10));
  const written = d.requests.slice(before);
  const fontPuts = written.filter((r) => r.method === 'PUT' && r.url.includes('/fontsets/'));
  const settingsPuts = written.filter((r) => r.method === 'PUT' && r.url.includes('/settings'));
  check('改字号 ⇒ PUT 落到**活动集**（/fontsets/compact）',
    fontPuts.length === 1 && fontPuts[0].url.endsWith('/fontsets/compact'),
    fontPuts.map((r) => r.url.replace('http://localhost', '')).join(' | ') || '(没有 PUT)');
  check('该 PUT 的体里带着刚改的值（markdown-h1 = 26）',
    fontPuts.length === 1 && /"markdown-h1":26/.test(String(fontPuts[0].body || '')),
    String(fontPuts[0] && fontPuts[0].body).slice(0, 96));
  check('同期**完全没有**写 /settings（字体值不走那条通道）',
    settingsPuts.length === 0, settingsPuts.map((r) => r.url).join(' | ') || '零次');
  const markAfter = panelText(d);
  check('改之后：标记换成「（已改）」—— 同一套、同一行，只是值被手动改过（不是凭空消失）',
    !markAfter.includes('（使用中）') && markAfter.includes('（已改）'), markAfter.slice(-64));
  // 「只看改过的」**默认开**（真机反馈那一轮把默认值翻了）：DEFAULTS_ONLY 的键不在持久化白名单里，
  // 必须由 `panelDefaults()` 显式铺进 selection —— 少了这一层默认值就**静默失效**（这条钉住它）。
  const typeRoleRows = () => {
    const nodes = d.renderPanel().flatMap((t) => collectTree(t));
    const table = nodes.find((n) => n.type === 'table'
      && collectTree(n).some((x) => Array.isArray(x.children) && x.children.join('') === '角色'));
    return table ? collectTree(table).filter((n) => n.type === 'tr' && collectTree(n).some((c) => c.type === 'td')).length : -1;
  };
  check('「只看改过的」默认开：表里只列改过的那个角色（默认值为 false 时会铺满 12 行）',
    typeRoleRows() === 1, typeRoleRows() + ' 行');

  // ── 场景 E：导入（阶段 4）—— 往返 + 三种失败态都要"说得出为什么" ───────────────
  // 驱动器是**真面板**：先点开「字体集预设」子分支（fire 那个 checkbox 的 onChange），
  // 再把文件喂给隐藏的 .json input —— 与用户操作是同一串。

  console.log('E. 导入：导出字节 ⇒ 读回同一份；三种坏文件各自给可判定文案');
  const eStore = {
    'dsh-wallpaper-engine:selection': JSON.stringify({ id: 'v', fontCustom: true }),
    'dsh-wallpaper-engine:picker-tab': 'appearance',
  };
  // **有状态的宿主**：PUT 建集 / POST activate 真的改这份清单。没有它就测不出"列表刷新了没有"——
  // 固定清单的替身会让"新建之后新那一行出没出现"永远为真（真机报过：新建/使用后界面留着旧信息）。
  const eSets = [{ id: 'compact', name: '紧凑', origin: 'builtin', active: true }];
  let eActive = 'compact';
  const baseHost = hostWith({ id: 'v', fontCustom: true });
  const statefulHost = (url, init) => {
    const u = String(url);
    const method = String((init && init.method) || 'GET').toUpperCase();
    if (u.includes('/fontsets/') && method === 'PUT') {
      const id = decodeURIComponent(/\/fontsets\/([^/?]+)/.exec(u)[1]);
      let name = id;
      try { name = JSON.parse(String(init.body)).name || id; } catch { /* 体不成形就退回 id */ }
      const row = eSets.find((r) => r.id === id);
      if (row) row.name = name; else eSets.push({ id, name, origin: 'user', active: false });
      return baseHost(u, init);
    }
    if (u.includes('/activate') && method === 'POST') {
      eActive = decodeURIComponent(/\/fontsets\/([^/]+)\/activate/.exec(u)[1]);
      eSets.forEach((r) => { r.active = r.id === eActive; });
      return baseHost(u, init);
    }
    if (u.includes('/fontsets') && !u.includes('/fontsets/')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({
        fontsets: eSets.map((r) => Object.assign({}, r)), active: eActive, migrated: true, adopted: false }) });
    }
    return baseHost(u, init);
  };
  const e = mount({ fetchImpl: statefulHost, store: eStore });
  await waitBoot();
  /**
   * 编辑器（含导入 input）在不在树上；顺带把整棵树的文案拼出来看失败态。
   *
   * ⚠️ `fileInput` **不许**用 `find(第一个 accept 含 .json 的 input)` —— 那是个会漂的假设：
   *    预设块（「玻璃 UI」节，排在「全局字体」节**之前**）也有一枚 `accept` **完全相同**
   *    的导入 input（`src/glass-panel.js` 的 `gp-import-input`），于是"第一个"拿到的是预设
   *    那一枚 ⇒ 喂给它的文件走进预设导入、`/fontsets/import` 永远收不到 POST，而这类失败
   *    看起来像"导入功能坏了"而不是"台架取错了对象"。
   *    ⇒ 先把树**按容器分组**，取含「导入字体集…」按钮的那一支，再在这一支里取 input：
   *      定位因此绑定在"字体集编辑器自己那个导入入口"上，与页面上还有几个 .json
   *      input、以及它们的先后顺序都无关。
   *    （`verify-fontset.mjs` 那条"树上只有一个 .json input"的断言在**独立树**里成立，
   *     它守的是另一个不变量，不受本处影响。）
   */
  const editorTree = () => {
    const all = e.renderPanel().flatMap((t) => collectTree(t));
    const isJsonInput = (n) => n.type === 'input' && String((n.props || {}).accept || '').includes('.json');
    // 定位字体集编辑器的导入行：含「导入字体集…」按钮的那个**容器**。
    const fontsetCtl = all.find((n) => collectTree(n).some((x) => x.type === 'button'
      && Array.isArray(x.children) && x.children.join('') === '导入字体集…'));
    const fileInput = fontsetCtl
      ? collectTree(fontsetCtl).find(isJsonInput)
      : all.find(isJsonInput);
    return {
      all,
      text: panelText(e),
      fileInput,
    };
  };
  check('「字体集预设」开关可驱动（面板上真的有这个 checkbox）', openFontSetEditor(e));
  await new Promise((r) => setTimeout(r, 20)); // 打开会拉一次清单
  const opened = editorTree();
  check('点开后编辑器与导入入口都出现', Boolean(opened.fileInput) && opened.text.includes('导入字体集…'));

  const EXPORTED = JSON.stringify({
    $schema: 'dsh-we/fontset@1', id: 'compact', name: '紧凑', values: HOST_VALUES,
  }, null, 2) + '\n';
  /** 喂一个文件给导入入口；返回这一轮的请求增量与之后的文案。 */
  const feed = async (file) => {
    const at = e.requests.length;
    const input = editorTree().fileInput;
    if (input) input.props.onChange({ target: { files: [file], value: 'x.json' } });
    await new Promise((r) => setTimeout(r, 20));
    return { posted: e.requests.slice(at), text: editorTree().text };
  };

  const good = await feed({ name: 'compact.json', text: () => Promise.resolve(EXPORTED) });
  const importPosts = good.posted.filter((r) => r.method === 'POST' && r.url.includes('/fontsets/import'));
  check('导入成功 ⇒ POST 到 /fontsets/import，且体就是**导出的那份字节**（客户端这一半的往返闭合）',
    importPosts.length === 1 && importPosts[0].body === EXPORTED,
    importPosts.length ? ('body 长度 ' + String(importPosts[0].body).length) : '(没有 POST)');
  check('往返：宿主收到的体解析回来与导出前逐键相同（不比对时间戳这类不稳定字段）',
    importPosts.length === 1
    && JSON.stringify(JSON.parse(String(importPosts[0].body)).values) === JSON.stringify(HOST_VALUES));
  check('导入成功后清单被回读一次（新那一行就是反馈）',
    good.posted.some((r) => r.method === 'GET' && r.url.endsWith('/fontsets'))
    && !good.text.includes('字体集不可用'));

  const noRead = await feed({ name: 'x.json', text: () => Promise.reject(new Error('boom')) });
  check('文件读不出来 ⇒ 文案点明"读不出这个文件"，且**不发请求**',
    noRead.posted.length === 0 && noRead.text.includes('读不出这个文件'), noRead.text.slice(0, 60));
  const badJson = await feed({ name: 'x.json', text: () => Promise.resolve('这不是 JSON') });
  check('不是 JSON ⇒ 文案点明，且不发请求',
    badJson.posted.length === 0 && badJson.text.includes('这不是 JSON 文件'));
  const badTag = await feed({ name: 'x.json', text: () => Promise.resolve('{"$schema":"dsh-we/fontset@99","values":{}}') });
  check('版本不符 ⇒ 文案点明**要哪个标记**，且不发请求（笼统的"导入失败"等于什么都没说）',
    badTag.posted.length === 0 && badTag.text.includes('这不是字体集文件')
    && badTag.text.includes('dsh-we/fontset@1'), badTag.text.slice(0, 80));

  // ── 场景 F：新建（面板不再问名字，名字由客户端生成）──────────────────────────
  console.log('F. 新建：不问名字，客户端生成并立刻切过去');
  {
    const at = e.requests.length;
    const createBtn = editorTree().all.find((n) => n.type === 'button'
      && Array.isArray(n.children) && n.children.join('') === '新建（以当前外观）');
    check('「新建（以当前外观）」按钮在（面板上点得到）', Boolean(createBtn));
    if (createBtn) createBtn.props.onClick();
    await new Promise((r) => setTimeout(r, 30));
    const round = e.requests.slice(at);
    const created = round.filter((r) => r.method === 'PUT' && /\/fontsets\/set-/.test(r.url));
    check('新建 ⇒ PUT 一份新 id 的集，且名字是客户端生成的（面板没问过）',
      created.length === 1 && /"name":"我的字体集/.test(String(created[0].body)),
      created.length ? String(created[0].url).split('/').pop() + ' body 名字=' + (/"name":"([^"]*)"/.exec(String(created[0].body)) || [])[1] : '(没有 PUT)');
    const newId = created.length ? String(created[0].url).split('/').pop() : '';
    check('建完立刻切过去（activate 指向那个新 id）—— 用户的下一步一定是调它',
      Boolean(newId) && round.some((r) => r.method === 'POST' && r.url.endsWith('/fontsets/' + newId + '/activate')),
      'id=' + newId);

    // ── 激活的语义：**必须真的把那一份的值读回来采用**（只挪指针 ⇒ 界面上什么都不会变）──
    // 新建时快照 = 当前值 ⇒ 建完那一眼应当是「（使用中）」；若 activate 不读值，会停在「（已改）」。
    await new Promise((r) => setTimeout(r, 20));
    const afterCreate = panelText(e);
    check('新建/切换之后马上又是「（使用中）」（激活确实采用了那一份，而不是只挪指针）',
      afterCreate.includes('（使用中）') && !afterCreate.includes('（已改）'), afterCreate.slice(-64));
    // **列表必须当场更新**：新建的那一行要立刻出现在面板里，不能等刷新页面（真机报过的"留着旧信息"）。
    check('新建之后新那一行**立刻**出现在面板里（列表跟着刷新，不必重载）',
      afterCreate.includes('我的字体集'), afterCreate.slice(-70));
  }

  // ── 场景 G：宿主没重挂（真机实测的形态）───────────────────────────────────────
  // 真机形态：页面刷新后**前端是新的、宿主还是旧的**（宿主模块只在启动时 load 一次，
  // bundle 却每次刷新重取）⇒ 请求落到 SPA 兜底：GET 裸 404、非 GET 裸 405，都没有 `{ error }` 信封。
  // 这一段把"文案必须自己说出来"钉住，并且用**成对**的宿主证明判据不是恒真。
  console.log('G. 宿主没有这条路由（裸 404）⇒ 文案自己说出去重启 DSH');
  {
    // 只有字体集那条路 404（别的一律正常，否则面板停在"未检测到 Wallpaper Engine"，
    // 根本走不到外观页签 —— 那测的就不是本段要测的东西了）。
    const bareFontsets = (body) => (url, init) => (String(url).includes('/fontsets')
      ? Promise.resolve({ ok: false, status: 404, json: body })
      // 字体集是「字体自定义」的**附属** ⇒ 这一场必须把总开关打开，否则那块（连同错误行）整块不渲染。
      : hostWith({ id: 'v', fontCustom: true })(url, init));
    const staleHost = bareFontsets(() => Promise.reject(new Error('empty body')));
    const g = mount({ fetchImpl: staleHost, store: {
      'dsh-wallpaper-engine:selection': JSON.stringify({ id: 'v' }),
      'dsh-wallpaper-engine:picker-tab': 'appearance',
    } });
    await waitBoot();
    openFontSetEditor(g);
    await new Promise((r) => setTimeout(r, 20));
    const staleText = panelText(g);
    check('裸 404（无 { error } 信封）⇒ 文案说"宿主里没有字体集路由：重启 DSH 后再试"',
      staleText.includes('重启 DSH 后再试') && staleText.includes('重启 DSH'), staleText.slice(0, 70));

    // 配对项：同一个 404，但**带信封**（= 请求确实到了本族）⇒ 原话照搬，不许混进"宿主没重挂"的猜测。
    const enveloppedHost = bareFontsets(() => Promise.resolve({ error: 'not found' }));
    const h = mount({ fetchImpl: enveloppedHost, store: {
      'dsh-wallpaper-engine:selection': JSON.stringify({ id: 'v' }),
      'dsh-wallpaper-engine:picker-tab': 'appearance',
    } });
    await waitBoot();
    openFontSetEditor(h);
    await new Promise((r) => setTimeout(r, 20));
    const envText = panelText(h);
    check('成对项：带 `{ error }` 的 404 ⇒ 原话照搬（"not found"），**不**出现"重启 DSH"那句',
      envText.includes('not found') && !envText.includes('重启 DSH 后再试'), envText.slice(0, 70));
  }

  // ── 场景 H：切换的语义 —— **点「使用」必须真的把那一份的值读回来采用** ─────────────
  // 这条的牙齿在于"值不同的第二份"：只挪指针不读值时，改的只是宿主清单里那个 active 字段，
  // 界面上的值一个都不会变（要等下次启动才生效）。替身的 active 跟着 activate 真的变。
  console.log('H. 切换：点「使用」⇒ 值真的换成那一份（不是只挪指针）');
  {
    const WIDE_VALUES = {
      themeColors: { primary: { light: '#ff0000', dark: '#00ff00' } },
      themeDarkSeparate: false,
      themeSize: { 'markdown-h1': 30 },
      themeWeight: {},
      themeFamily: {},
      globalFamily: '',
      componentFonts: {},
    };
    let active = 'compact';
    const twoSets = (url, init) => {
      const u = String(url);
      const method = String((init && init.method) || 'GET').toUpperCase();
      if (u.includes('/activate')) {
        const m = /\/fontsets\/([^/]+)\/activate/.exec(u);
        if (m) active = decodeURIComponent(m[1]);
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
      }
      if (u.includes('/fontsets/')) {
        const m = /\/fontsets\/([^/?]+)/.exec(u);
        const id = m ? decodeURIComponent(m[1]) : 'compact';
        const values = id === 'wide' ? WIDE_VALUES : HOST_VALUES;
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, id, name: id, values }) });
      }
      if (u.includes('/fontsets')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({
          fontsets: [
            { id: 'compact', name: '紧凑', origin: 'builtin', active: active === 'compact' },
            { id: 'wide', name: '宽敞', origin: 'user', active: active === 'wide' },
          ], active, migrated: true, adopted: false,
        }) });
      }
      return hostWith({ id: 'v', fontCustom: true })(url, init);
    };
    const h = mount({ fetchImpl: twoSets, store: {
      'dsh-wallpaper-engine:selection': JSON.stringify({ id: 'v', fontCustom: true }),
      'dsh-wallpaper-engine:picker-tab': 'appearance',
    } });
    await waitBoot();
    openFontSetEditor(h);
    await new Promise((r) => setTimeout(r, 20));
    const before = panelText(h);
    check('切换前：活动那一份是「（使用中）」、另一份不是',
      before.includes('（使用中）') && !before.includes('（已改）'));
    const sizeOf = () => (h.renderPanel().flatMap((t) => collectTree(t))
      .find((n) => n.type === 'input' && /：字号 px/.test(String((n.props || {}).title || ''))) || {}).props;
    const rowText = (name) => {
      const rows = h.renderPanel().flatMap((t) => collectTree(t)).filter((n) => n.type === 'tr');
      const row = rows.map((r) => collectTree(r)).find((cells) => cells.some((c) => c.type === 'td'
        && collectTree(c).some((x) => Array.isArray(x.children) && x.children.join('') === name)));
      return row ? row.map((c) => collectTree(c).map((x) => (Array.isArray(x.children) ? x.children.filter((y) => typeof y === 'string').join('') : '')).join('')).join('') : '';
    };
    check('切换前：字号输入显示的是活动那份的值（24）', (sizeOf() || {}).value === 24, String((sizeOf() || {}).value));
    const at = h.requests.length;
    // 只有"非活动"的那一行有「使用」（活动那份已经是使用中）⇒ 面板里就这一枚。
    const useBtn = h.renderPanel().flatMap((t) => collectTree(t))
      .find((n) => n.type === 'button' && Array.isArray(n.children) && n.children.join('') === '使用');
    check('待切换那一行点得到「使用」', Boolean(useBtn));
    if (useBtn) useBtn.props.onClick();
    await new Promise((r) => setTimeout(r, 30));
    const round = h.requests.slice(at);
    check('「使用」⇒ POST activate 到那一份',
      round.some((r) => r.method === 'POST' && r.url.endsWith('/fontsets/wide/activate')),
      round.map((r) => r.method + ' ' + r.url.split('/').slice(-2).join('/')).join(' | '));
    check('并且真的**读了那一份的值**（GET /fontsets/wide）', round.some((r) => r.method === 'GET' && r.url.endsWith('/fontsets/wide')),
      round.filter((r) => r.method === 'GET').map((r) => r.url.split('/').pop()).join(','));
    check('值真的换了：字号输入从 24 变成 30（只挪指针的话这里纹丝不动）',
      (sizeOf() || {}).value === 30, String((sizeOf() || {}).value));
    const after = panelText(h);
    check('切换后：「（使用中）」搬到了**宽敞**那一行，紧凑那一行不再有它',
      after.includes('（使用中）') && !after.includes('（已改）')
      && rowText('宽敞').includes('（使用中）') && !rowText('紧凑').includes('（使用中）'),
      '宽敞=' + rowText('宽敞').slice(0, 40) + ' | 紧凑=' + rowText('紧凑').slice(0, 40));

    // ── I. 删除字体集走**共用令牌**：钉的是"组件的接线"，不是渲染器契约 ─────────────
    // verify-fontset 那几条删除判据显式传 `armedId`（驱动**渲染器**）⇒ 它钉住的是渲染器契约。
    // 接线本身错了是**静默**的：`fontSetCtx` 的令牌前缀写错 ⇒ 面板永远不出现问句行，用户点
    // 「删除」看起来毫无反应，而渲染器那几条判据照样全绿。所以这里用**真面板**再走一遍：
    // 第一下只待确认（零请求），问句行的「确认」才发 DELETE。
    {
      // 前置：此刻活动集是 `wide`（H 段切过去了）⇒ 先切回 builtin 那份，让 `wide` 重新可删
      //（宿主的规则：活动集不出删除）。
      const back = h.renderPanel().flatMap((t) => collectTree(t))
        .find((n) => n.type === 'button' && Array.isArray(n.children) && n.children.join('') === '使用');
      check('I 前置：可切回「紧凑」，让「宽敞」重新变成可删的一行', Boolean(back));
      if (back) back.props.onClick();
      await new Promise((r) => setTimeout(r, 30));
      const btnByText = (label) => h.renderPanel().flatMap((t) => collectTree(t))
        .find((n) => n.type === 'button' && Array.isArray(n.children) && n.children.join('') === label);
      const delBtn = btnByText('删除');
      check('I 前置：非活动那一行点得到「删除」', Boolean(delBtn));
      const at = h.requests.length;
      if (delBtn) delBtn.props.onClick();
      await new Promise((r) => setTimeout(r, 20));
      const asked = panelText(h).includes('删除「宽敞」？');
      check('I 第一下只置令牌：出现问句行，且**一个字节都不发**',
        asked && h.requests.length === at,
        'requests=' + (h.requests.length - at) + ' · 问句在=' + asked);
      const yes = btnByText('确认');
      check('I 问句行的「确认」在场（正路可达，不是死按钮）', Boolean(yes));
      if (yes) yes.props.onClick();
      await new Promise((r) => setTimeout(r, 30));
      const del = h.requests.slice(at).filter((r) => r.method === 'DELETE');
      check('I 「确认」⇒ DELETE 落在**正确的那一份**', del.some((r) => r.url.endsWith('/fontsets/wide')),
        h.requests.slice(at).map((r) => r.method + ' ' + r.url.split('/').pop()).join(' | ') || '(无请求)');
    }
  }

  // ── 场景 J：收起「字体集预设」这条路径 ──────────────────────────────────────────
  // 缺陷形态（实测）：收起分支只调 `disarmConfirm()`，而它当时在"本来就没有待确认令牌"时
  // **提前返回、不 emit** ⇒ 开关不动、编辑器不收起；等用户碰了别的控件（那条路会 emit）才把两次
  // 变化一起兑现 —— 观感就是"关不掉"，再点别的按钮"两个一起关"。
  // ⚠️ 这台子**看不见"少了一次 emit"**（见假 React 上面那条注：真机的重渲挂在插件根组件的 effect
  //    上，台子不跑 effect）⇒ 这里只钉"这条路径可达且状态与视图一致"，**通知义务那半边**由
  //    `verify-client` 的 ①f 从源码面钉住（`disarmConfirm` 必须每次都通知 + 收起分支必须走它）。
  console.log('J. 收起「字体集预设」：这条路径可达，且收起后视图与状态一致');
  {
    const j = mount({
      fetchImpl: hostWith({ id: 'v', fontCustom: true }),
      store: {
        'dsh-wallpaper-engine:selection': JSON.stringify({ id: 'v', fontCustom: true }),
        'dsh-wallpaper-engine:picker-tab': 'appearance',
      },
    });
    await waitBoot();
    const boxOf = () => j.renderPanel().flatMap((t) => collectTree(t))
      .find((n) => n.type === 'input' && n.props && n.props['aria-label'] === '字体集预设');
    const b0 = boxOf();
    check('J 前置：面板上有「字体集预设」开关（驱动的是真面板，不是替身）', Boolean(b0));
    if (b0) {
      b0.props.onChange({ target: { checked: true } });
      await new Promise((r) => setTimeout(r, 20));
      check('J 打开后编辑器真的渲染出来（「重命名」在场）', /重命名/.test(panelText(j)));
      const opened = boxOf();
      check('J 打开后开关处于开态（checked=true 可由面板读回）',
        Boolean(opened && opened.props.checked === true), 'checked=' + String(opened && opened.props.checked));
      if (opened) opened.props.onChange({ target: { checked: false } });
      await new Promise((r) => setTimeout(r, 5));
      check('J 收起后编辑器不在面板里（视图与状态一致）', !/重命名/.test(panelText(j)));
      const closed = boxOf();
      check('J 收起后开关回到关态', Boolean(closed && closed.props.checked === false),
        'checked=' + String(closed && closed.props.checked));
    }
  }

  console.log('');
  if (failures) { console.log('FONTSET LOAD SMOKE FAILED — ' + failures + ' failed'); process.exit(1); }
  console.log('FONTSET LOAD SMOKE PASSED');
})();
