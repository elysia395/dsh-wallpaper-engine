// GPU 崩溃链加固（遮挡 → i915 reset → contextlost 永封）的回归验收：
//
//  A. pauseOnBlur 默认值迁移必须在「host 事实源合并之后」对最终生效值判定并
//     回推 host —— 存量用户 host/local 两层都落着旧默认 false（PUT 是全量
//     白名单替换），只迁 localStorage 会被 loadPersisted 的 host 合并原样
//     盖回（writeLocalCache 还会把 false 写回 local，标记已置位 → 永不重跑）。
//  B. sceneVideo 在播（内嵌 MP4 硬解 <video>）时，前台恢复不得重试 GL
//     （视频优先级高于 GL；重建层 = 在播视频重启闪烁）。
//  C. 前台恢复重试只认 contextlost* 前缀（内容性失败不重试）；重试烧掉一次
//     后，同 token 本页面会话不再自动重试（防崩溃循环）；CPU mp4 兜底已随
//     渲染路径移除 — 重试失败停留静态帧, 全程零 /scene-anim/ 请求。
//
// 三个场景各自在独立 vm 上下文里完整跑 lib/client.js 的 boot 链
// (apply → effect → loadPersisted → loadInventory → applySelection)。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const SETTINGS_KEY = 'dsh-wallpaper-engine:selection';
const MIGRATED_KEY = 'dsh-wallpaper-engine:pauseOnBlurMigrated';
const FRAME_TOKEN = 'TOK';
const FRAME_URL = '/wallpaper-engine/scene-frame/' + FRAME_TOKEN;
const MARK_KEY = 'weSceneGLFailed:' + FRAME_TOKEN;

let passCount = 0;
let failCount = 0;
function check(name, ok, detail) {
  if (ok) { passCount++; console.log('PASS ' + name); }
  else { failCount++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
}
const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));

const React = {
  Fragment: 'Fragment',
  useState: (init) => [init, () => {}],
  useEffect: () => {},
  useRef: (v) => ({ current: v }),
  createElement: (type, props, ...children) =>
    typeof type === 'function' ? type(props || {}) : ({ type, props: props || null, children }),
};

function makeSandbox(opts) {
  // opts: { hostSettings, localSelection, session, sceneVideo }
  const putCalls = [];
  const timers = [];
  const intervals = [];
  const winListeners = new Map();
  let byId = {};
  let nextId = 0;

  function makeEl(tag) {
    const el = {
      tagName: tag.toUpperCase(),
      id: '',
      children: [],
      dataset: {},
      attributes: {},
      style: { _props: {}, setProperty(k, v) { this._props[k] = v; }, removeProperty(k) { delete this._props[k]; } },
      className: '',
      isConnected: true,
      appendChild(c) { c._parent = this; this.children.push(c); if (c.id) byId[c.id] = c; return c; },
      remove() { if (this._parent) { const i = this._parent.children.indexOf(this); if (i >= 0) this._parent.children.splice(i, 1); } if (byId[this.id] === this) delete byId[this.id]; },
      setAttribute(k, v) { this.attributes[k] = String(v); },
      removeAttribute(k) { delete this.attributes[k]; },
      hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k); },
      getAttribute(k) { return this.attributes[k] ?? null; },
      addEventListener() {}, removeEventListener() {},
      querySelector() { return null; },
      // 渲染器预检走「webgl2-unavailable → onError → markSceneGLFailed →
      // 停留静态帧」失败链（与真实无 GL 环境同款分流）。
      getContext() { return null; },
      play() { return { catch() {} }; },
      pause() {}, load() {},
    };
    return el;
  }
  const bodyEl = makeEl('body');
  const document = {
    createElement: (t) => makeEl(t),
    createTextNode: (t) => ({ text: t }),
    getElementById: (id) => byId[id] || null,
    querySelector: () => null,
    head: { appendChild() {} },
    body: bodyEl,
    documentElement: makeEl('html'),
    hidden: false,
    hasFocus: () => true,
    addEventListener() {}, removeEventListener() {},
  };
  const localStorage = {
    _store: { ...(opts.localSelection ? { [SETTINGS_KEY]: JSON.stringify(opts.localSelection) } : {}) },
    getItem(k) { return this._store[k] ?? null; },
    setItem(k, v) { this._store[k] = String(v); },
    removeItem(k) { delete this._store[k]; },
  };
  const sessionStorage = {
    _store: { ...(opts.session || {}) },
    getItem(k) { return this._store[k] ?? null; },
    setItem(k, v) { this._store[k] = String(v); },
    removeItem(k) { delete this._store[k]; },
  };
  const fetchLog = [];
  const fetch = (url, init) => {
    const u = String(url);
    fetchLog.push(u);
    if (init && init.method === 'PUT' && u.includes('/wallpaper-engine/settings')) {
      putCalls.push({ url: u, body: init.body });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
    }
    if (u.includes('/wallpaper-engine/settings')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ settings: opts.hostSettings, betterSidebar: false }) });
    }
    if (u.includes('/wallpaper-engine/inventory')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({
        installDir: 'D:/we', total: 1, portableCount: 1, playlists: [],
        wallpapers: [
          // 单个 scene 壁纸（有 frameUrl → isPlayableType 判真）。sceneVideo
          // 由 opts 控制注入（内嵌 MP4 场景走 <video> 硬解, 不试 GL）。
          { id: 'sc', title: 'Scene GL', type: 'scene', playable: false, media: null, preview: null,
            frameUrl: FRAME_URL, contentrating: 'Everyone',
            ...(opts.sceneVideo ? { sceneVideo: '/wallpaper-engine/scene-video/TOK' } : {}) },
        ],
      }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  };
  const cap = { handoff: null };
  const window = {
    __ModuleLoader__: { load: (h) => { cap.handoff = h; } },
    setTimeout: (fn, ms) => { const t = { id: ++nextId, fn, ms, cleared: false }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.cleared = true; },
    setInterval: (fn, ms) => { const t = { id: ++nextId, fn, ms, cleared: false }; intervals.push(t); return t; },
    clearInterval: (t) => { if (t) t.cleared = true; },
    addEventListener(type, fn) { if (!winListeners.has(type)) winListeners.set(type, []); winListeners.get(type).push(fn); },
    removeEventListener(type, fn) { const l = winListeners.get(type) || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
    innerWidth: 1280, innerHeight: 720,
  };
  const sandbox = {
    window, document, localStorage, sessionStorage, fetch, React,
    AbortController, // scene-gl 渲染器构造需要（vm 上下文不继承宿主全局）
    performance: { now: () => 0 },
    // bundle 里 setInterval/clearInterval 是裸全局（不走 window.*）——委托到
    // 上面的捕获器，轮询句柄才能被测试驱动与断言。
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (t) => window.clearInterval(t),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (t) => window.clearTimeout(t),
    __dispatch(type) { for (const fn of [...(winListeners.get(type) || [])]) { try { fn({ type }); } catch (e) { console.log('  (listener threw:', e && e.message, ')'); } } },
    __flushPersist() { for (const t of [...timers]) if (!t.cleared && t.ms === 200) { t.cleared = true; t.fn(); } },
    __activeInterval() { for (let i = intervals.length - 1; i >= 0; i--) if (!intervals[i].cleared) return intervals[i]; return null; },
    __bumpTime(ms) { vm.runInContext('__weFakeNow += ' + ms + ';', sandbox.__ctx); },
    __ctx: null,
    __store: { localStorage, sessionStorage, putCalls, intervals, timers, fetchLog, byId: () => byId },
  };
  return sandbox;
}

async function boot(sandbox) {
  const ctxObj = vm.createContext(sandbox);
  sandbox.__ctx = ctxObj;
  // 可控时钟：重试冷却断言需要"时间流逝"（Date 是 vm 内建，这里整体接管）。
  vm.runInContext('var __weFakeNow = Date.now(); Date.now = function () { return __weFakeNow; };', ctxObj);
  // bundle 加载即调用 window.__ModuleLoader__.load(handoff) —— 预置捕获器存到 sandbox。
  sandbox.window.__ModuleLoader__.load = (h) => { sandbox.__handoff = h; };
  new vm.Script(code, { filename: 'client.js' }).runInContext(ctxObj);
  // 说明：内联的 __WESceneGL 是 factory 闭包变量，无法从外部置空；渲染器在
  // 本沙箱无 WebGL（getContext→null）→ weGLPreflight 判 'webgl2-unavailable'
  // → onError 优雅失败链，与真实无 GL 环境同款分流，无需模拟整套渲染器。
  const { factory } = sandbox.__handoff;
  const exportsObj = factory((spec) => {
    if (spec === 'react') return React;
    if (spec === 'react-dom') return { createPortal: (node) => node };
    throw new Error('unexpected require: ' + spec);
  });
  const slots = {
    inject: (key, cb) => cb(),
    register: () => {},
  };
  const ctx = { slots, effect(fn) { fn(); return fn; } };
  let thrown = null;
  try { exportsObj.apply(ctx); } catch (e) { thrown = e && e.message; }
  if (thrown) console.log('  (apply threw:', thrown, ')');
  await settle();
  return { exportsObj };
}

// ── A. host 存量 false → 合并后迁移翻 true 并回推 host ─────────────────────
async function scenarioA() {
  console.log('\n== A: pauseOnBlur 迁移在 host 事实源合并之后生效并回推 host ==');
  const sandbox = makeSandbox({
    hostSettings: { id: 'sc', pauseOnBlur: false }, // host 落着旧默认 false
    localSelection: { id: 'sc', pauseOnBlur: false }, // local 同样
    progress: 0,
  });
  await boot(sandbox);
  const st = sandbox.__store;
  sandbox.__flushPersist(); // 200ms 防抖的 local 写 + PUT
  await settle();

  const puts = st.putCalls;
  check('A: 迁移触发了设置回推 PUT', puts.length >= 1, 'putCalls=' + puts.length);
  const lastPut = puts.length ? JSON.parse(puts[puts.length - 1].body) : null;
  check('A: 回推 host 的 pauseOnBlur=true（修复前为 false）', !!lastPut && lastPut.pauseOnBlur === true,
    lastPut ? 'pauseOnBlur=' + lastPut.pauseOnBlur : 'no put');
  check('A: 回推不丢其它字段（id 保留）', !!lastPut && lastPut.id === 'sc', lastPut ? 'id=' + lastPut.id : '');
  const local = JSON.parse(st.localStorage._store[SETTINGS_KEY] || '{}');
  check('A: localStorage 缓存同步为 true（修复前被 writeLocalCache 写回 false）', local.pauseOnBlur === true,
    'pauseOnBlur=' + local.pauseOnBlur);
  check('A: 一次性迁移标记已置位', st.localStorage._store['dsh-wallpaper-engine:pauseOnBlurMigrated'] === '1');
}

// ── B. sceneVideo 在播 → 前台恢复不重试 GL ────────────────────────────────
async function scenarioB() {
  console.log('\n== B: sceneVideo 在播时前台恢复不动 GL ==');
  const sandbox = makeSandbox({
    hostSettings: { id: 'sc', pauseOnBlur: false },
    localSelection: { id: 'sc', pauseOnBlur: false },
    session: { [MARK_KEY]: 'contextlost-twice' }, // 崩溃封印在场
    sceneVideo: true, // 内嵌 MP4 → selection.sceneVideo 非空 → 重试守卫拦截
  });
  await boot(sandbox);
  const st = sandbox.__store;
  sandbox.__dispatch('focus');
  await settle();
  check('B: sceneVideo 在播时重试被守卫拦下（封印标记原样保留）',
    st.sessionStorage._store[MARK_KEY] === 'contextlost-twice',
    'mark=' + st.sessionStorage._store[MARK_KEY]);
  check('B: 全程零 /scene-anim/ 请求（CPU 渲染路径已移除）',
    !st.fetchLog.some((u) => String(u).includes('/scene-anim')));
}

// ── C. 重试只在 contextlost* 且每 token 一次；先取消在途升级 ────────────────
async function scenarioC() {
  console.log('\n== C: contextlost 前缀过滤 / 每 token 一次 / 取消在途升级 ==');
  const sandbox = makeSandbox({
    hostSettings: { id: 'sc', pauseOnBlur: false },
    localSelection: { id: 'sc', pauseOnBlur: false },
    session: { [MARK_KEY]: 'render-fatal:boom' }, // 内容性失败
  });
  await boot(sandbox);
  const st = sandbox.__store;
  check('C: 前置 — boot 后层停留静态帧（无任何轮询 interval）',
    !sandbox.__activeInterval());

  sandbox.__dispatch('focus'); // 内容性失败 + 回前台
  await settle();
  check('C: render-fatal 类失败不重试（标记原样）',
    st.sessionStorage._store[MARK_KEY] === 'render-fatal:boom',
    'mark=' + st.sessionStorage._store[MARK_KEY]);

  st.sessionStorage._store[MARK_KEY] = 'contextlost-twice';
  sandbox.__dispatch('focus'); // 第一次 contextlost 重试
  await settle();
  // 重试真实发生：封印被清除后渲染器重建（本沙箱无 WebGL → 预检失败链落
  // 'webgl2-unavailable'——一个全新的非 contextlost 失败，区别于被清掉的旧封印）。
  const markAfterRetry = st.sessionStorage._store[MARK_KEY];
  check('C: contextlost 封印被清除并重试（新失败非 contextlost）',
    markAfterRetry === undefined || String(markAfterRetry).indexOf('contextlost') !== 0,
    'mark=' + markAfterRetry);
  check('C: 重试失败后停留静态帧（无 CPU 兜底渲染轮询）', !sandbox.__activeInterval());
  check('C: 全程零 /scene-anim/ 请求',
    !sandbox.__store.fetchLog.some((u) => String(u).includes('/scene-anim')),
    sandbox.__store.fetchLog.filter((u) => String(u).includes('/scene-anim')).join(',') || '(none)');

  st.sessionStorage._store[MARK_KEY] = 'contextlost-twice'; // 又一次崩溃封印
  sandbox.__bumpTime(60000); // 越过 30s 冷却 → 只剩"每 token 一次"在拦
  sandbox.__dispatch('focus');
  await settle();
  check('C: 同 token 本页面会话只自动重试一次（冷却已过仍拦截）',
    st.sessionStorage._store[MARK_KEY] === 'contextlost-twice',
    'mark=' + st.sessionStorage._store[MARK_KEY]);
}

await scenarioA();
await scenarioB();
await scenarioC();
console.log('\n' + (failCount === 0
  ? 'ALL GPU-CRASH-FIX CHECKS PASSED (' + passCount + ')'
  : 'GPU-CRASH-FIX CHECKS FAILED: ' + failCount + ' failed, ' + passCount + ' passed'));
process.exit(failCount === 0 ? 0 : 1);
