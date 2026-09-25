// GPU 抓帧回填的「异步落地身份校验」行为级 smoke（评审第二轮产出物，已进仓库）：
// 回填的落地回调只对**发起时那张壁纸**记账 —— 多 MB PNG 的 HEAD+toBlob+PUT 要
// 0.1–1.5s，期间用户可能已经切走；旧实现用「当前 selection」记账，会把「已有 GPU
// 帧」记到新壁纸头上，后果不只是面板提示错 ≤30s：回到被误标的壁纸时 CPU scene-anim
// 渲染会被门禁整个挡掉（30s 内 pinned 缓存命中）。
//
// 判据（用户可见后果）：上传期间切走 → 落地 → 回到原壁纸时 CPU 渲染照常启动。
// 做法：可控 mock 让 PUT /scene-frame-cache/<token> 挂住（deferred），轮换切到另一张
// 壁纸后再放行落地，然后 B→A→B 复检门禁是否仍然放行。
//
// 用法：node test/live-frame-async-identity-smoke.mjs
//   修复版 → 全 ✓ + exit 0；把身份校验摘掉（按当前 selection 记账）→ ✗ + exit 1。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const clientPath = process.argv[2] || new URL('../lib/client.js', import.meta.url);
const code = readFileSync(clientPath, 'utf8');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log('  ✓ ' + label + (detail ? ' — ' + detail : ''));
  else { failures++; console.log('  ✗ ' + label + (detail ? ' — ' + detail : '')); }
};

const React = {
  Fragment: 'Fragment', useState: (i) => [i, () => {}], useEffect: () => {}, useRef: (v) => ({ current: v }),
  createElement: (t, p, ...c) => (typeof t === 'function' ? t(p || {}) : { type: t, props: p || null, children: c }),
};

const timers = [];
const intervals = [];
const byId = {};
const mediaEls = [];    // 所有 <video>
const iframeEls = [];
const headCalls = [];
const putCalls = [];
const animSrcs = [];    // 出现过的 /scene-anim/ src（探针视频 = CPU 渲染真的启动了）

function makeEl(tag) {
  const listeners = {};
  const el = {
    tagName: tag.toUpperCase(), children: [], dataset: {}, attributes: {}, isConnected: true,
    style: { _props: {}, cssText: '', setProperty(k, v) { this._props[k] = v; }, removeProperty(k) { delete this._props[k]; } },
    className: '', poster: '',
    appendChild(c) { this.children.push(c); if (c.id) byId[c.id] = c; c._parent = this; return c; },
    // 真 DOM 语义：摘除后没有父节点（isConnected 随之 false）。
    remove() { if (this._parent) { const i = this._parent.children.indexOf(this); if (i >= 0) this._parent.children.splice(i, 1); this._parent = undefined; } },
    setAttribute(k, v) { this.attributes[k] = v; },
    removeAttribute(k) { delete this.attributes[k]; (this.__removedAttrs ||= []).push(k); },
    getAttribute(k) { return this.attributes[k] ?? null; },
    hasAttribute(k) { return k in this.attributes; },
    querySelector(sel) {
      const want = String(sel).includes('iframe') ? 'IFRAME'
        : String(sel).includes('video') ? 'VIDEO'
          : String(sel).includes('canvas') ? 'CANVAS' : null;
      const walk = (n) => {
        if (!Array.isArray(n.children)) return null;
        for (const c of n.children) { if (c.tagName === want) return c; const r = walk(c); if (r) return r; }
        return null;
      };
      return want ? walk(this) : null;
    },
    querySelectorAll(sel) {
      const want = String(sel).split(',').map((x) => x.trim().toUpperCase());
      const out = [];
      const walk = (n) => { if (!Array.isArray(n.children)) return; for (const c of n.children) { if (want.includes(c.tagName)) out.push(c); walk(c); } };
      walk(this);
      return out;
    },
    contains(n) { let cur = n; while (cur) { if (cur === this) return true; cur = cur._parent; } return false; },
    addEventListener(ev, fn) { (listeners[ev] ||= []).push(fn); },
    removeEventListener(ev, fn) { const l = listeners[ev]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } },
    __fire(ev) { (listeners[ev] || []).slice().forEach((f) => f()); if (ev === 'load' && this.onload) this.onload(); },
    play() { this.__plays = (this.__plays || 0) + 1; return Promise.resolve(); },
    pause() { this.__paused = true; },
    load() { this.__loads = (this.__loads || 0) + 1; },
  };
  el.classList = {
    add(c) { const p = el.className ? el.className.split(' ') : []; if (!p.includes(c)) { p.push(c); el.className = p.join(' '); } },
    remove(c) { const p = el.className ? el.className.split(' ') : []; const i = p.indexOf(c); if (i >= 0) { p.splice(i, 1); el.className = p.join(' '); } },
  };
  Object.defineProperty(el, 'src', {
    get() { return this.attributes.src || ''; },
    set(v) { this.attributes.src = String(v || ''); if (String(v).includes('/scene-anim/')) animSrcs.push(String(v)); },
  });
  Object.defineProperty(el, 'isConnected', {
    get() { let cur = this; while (cur) { if (!cur._parent) return cur.tagName === 'BODY'; cur = cur._parent; } return false; },
  });
  if (tag === 'iframe') {
    el.contentWindow = {
      __wpStats: { frame: () => ({ fps: 30, running: true }) },
      __wp: { resume() {}, pause() {}, setVolume() {}, setFit() {}, pushPointer() {}, pointerLeave() {} },
      document: { querySelector: (s) => (String(s).includes('data-webwallgl-gl') ? displayCanvas : null) },
    };
  }
  return el;
}

// 渲染页显示 canvas（1080p）：体积 120000B > 41472 的地板，且 2×2 采样有对比度。
const blobStub = { size: 120000 };
const displayCanvas = { width: 1920, height: 1080, toBlob: (cb) => cb(blobStub) };
const sampleCtx = {
  drawImage() {},
  getImageData: () => {
    const px = new Uint8ClampedArray(64 * 64 * 4);
    for (let i = 0; i < px.length; i += 4) {
      const bright = (i / 4) % 2 === 0;
      px[i] = bright ? 220 : 20; px[i + 1] = bright ? 200 : 30; px[i + 2] = bright ? 180 : 40; px[i + 3] = 255;
    }
    return { data: px };
  },
};

const bodyEl = makeEl('body');
const document = {
  createElement: (t) => {
    const el = makeEl(t);
    if (t === 'video') mediaEls.push(el);
    if (t === 'iframe') iframeEls.push(el);
    if (t === 'canvas') { el.width = 0; el.height = 0; el.getContext = (k) => (k === '2d' ? sampleCtx : null); }
    return el;
  },
  getElementById: (id) => { const el = byId[id]; return el && el.isConnected ? el : null; },
  querySelector: () => null,
  head: { appendChild: () => {} },
  body: bodyEl,
  hidden: false,
  hasFocus: () => true,
  addEventListener() {}, removeEventListener() {},
  documentElement: makeEl('html'),
};

const localStorage = {
  _store: {
    'dsh-wallpaper-engine:selection': JSON.stringify({
      id: 'a', rotationEnabled: true, rotationGroupId: 'g1',
      rotationGroups: [{ id: 'g1', name: 'L', interval: 5, order: 'sequence', wallpaperIds: ['a', 'b'] }],
      videoVolume: 0.6, videoAudioEnabled: true,
      // liveBootDelay: 0 —— 「重启恢复」期的启动延迟会把 iframe 的挂载推迟到
      // scheduleLiveMount，而 startLiveWatch 只对已进文档的 iframe 生效
      //（frame.isConnected 守卫）→ 延迟期间 fire('load') 不会武装心跳。
      // 本文件测的是抓帧上传的身份校验，与启动延迟无关。
      liveBootDelay: 0,
    }),
    weRotationTestSec: '10',
  },
  getItem(k) { return this._store[k] ?? null; }, setItem(k, v) { this._store[k] = v; }, removeItem(k) { delete this._store[k]; },
};

const WALLPAPERS = [
  // A：场景 + live 渲染（首帧能出 → 触发 GPU 抓帧回填）
  { id: 'a', title: 'Scene A', type: 'scene', playable: false, media: null,
    frameUrl: '/wallpaper-engine/scene-frame/aaa', sceneLive: true, sceneLiveSrc: 'tok-a',
    preview: '/wallpaper-engine/preview/aaa', contentrating: 'Everyone' },
  // B：场景、没有 live 源（切过去后 CPU scene-anim 渲染才是唯一动画路径）
  { id: 'b', title: 'Scene B', type: 'scene', playable: false, media: null,
    frameUrl: '/wallpaper-engine/scene-frame/bbb',
    preview: '/wallpaper-engine/preview/bbb', contentrating: 'Everyone' },
];

let putResolve = null;
const fetch = (url, opts) => {
  const u = String(url), m = (opts && opts.method) || 'GET';
  if (m === 'HEAD') {
    if (u.includes('/scene-frame/')) {
      headCalls.push(u);
      // 两个 token 都没有 GPU 帧（否则回填/门禁根本不会走到"抓帧 + 写盘"）
      return Promise.resolve({ ok: false, status: 404, headers: { get: () => null } });
    }
    return Promise.resolve({ ok: true, status: 204, headers: { get: () => null } });
  }
  if (m === 'PUT' && u.includes('/scene-frame-cache/')) {
    putCalls.push(u);
    // 关键：上传挂住不落地 —— 模拟「多 MB PNG 上传 0.1–1s」窗口。
    return new Promise((res) => { putResolve = () => res({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) }); });
  }
  if (u.includes('/scene-anim-progress/')) {
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ percent: 12 }) }); // 永远不完成
  }
  if (m === 'PUT' || m === 'POST' || m === 'DELETE') {
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
  }
  return Promise.resolve({
    ok: true, status: 200, json: () => Promise.resolve(
      u.includes('/settings') ? { ok: true, betterSidebar: false } :
        u.includes('/media-info') ? { info: null } :
          u.includes('/scene-live-stats') ? {} :
            { installDir: 'D:/we', total: WALLPAPERS.length, portableCount: 0, playlists: [], wallpapers: WALLPAPERS },
    ),
  });
};

const cap = { handoff: null };
const sandbox = {
  window: {
    __ModuleLoader__: { load: (h) => { cap.handoff = h; } },
    setTimeout: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.cleared = true; },
    setInterval: (fn, ms) => { const t = { fn, ms, cleared: false }; intervals.push(t); return t; },
    clearInterval: (t) => { if (t) t.cleared = true; },
    addEventListener() {}, innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1,
  },
  document, localStorage, fetch, React,
  setTimeout: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
  clearTimeout: (t) => { if (t) t.cleared = true; },
  setInterval: (fn, ms) => { const t = { fn, ms, cleared: false }; intervals.push(t); return t; },
  clearInterval: (t) => { if (t) t.cleared = true; },
  location: { origin: 'http://localhost', search: '' },
  navigator: {},
};
vm.createContext(sandbox);
new vm.Script(code, { filename: 'client.js' }).runInContext(sandbox);
const exportsObj = cap.handoff.factory((spec) => (spec === 'react' ? React : { createPortal: (n) => n }));
exportsObj.apply({ slots: { inject: (k, cb) => cb(), register: () => {} }, effect(fn) { fn(); return fn; } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fireLatest = (ms) => { const t = timers.filter((x) => !x.cleared && x.ms === ms).pop(); if (t) { t.cleared = true; t.fn(); } return t; };
const animCount = (tok) => animSrcs.filter((s) => s.includes('/scene-anim/' + tok)).length;
// 「B 的槽位有没有被误记账」的新观测点：gpuFrameUi 的槽位探测是 HEAD /scene-frame/<token>，
// 误记账会让 TTL 内的缓存命中、从而**跳过**这次探测 —— 所以「有没有探测」等价于「有没有被
// 误记账」。（CPU 动画渲染路线已删除，旧观测点 animCount 只剩「零请求」这一用途。）
const headCount = (tok) => headCalls.filter((u) => String(u).includes('/scene-frame/' + tok)).length;
// 持久化有 200ms 防抖：断言落库前先冲掉写盘定时器（同 rotation-smoke 的做法）。
const flushPersist = () => timers.filter((t) => !t.cleared && t.ms === 200).forEach((t) => { t.cleared = true; t.fn(); });
const persistedId = () => { flushPersist(); return JSON.parse(localStorage._store['dsh-wallpaper-engine:selection']).id; };

console.log('client: ' + clientPath);
console.log('场景：① live 首帧 → 抓帧上传（挂住）② 上传期间轮换到 B ③ 让上传落地 ④ B→A→B 再回来');

// 等 boot（loadPersisted → loadInventory → applySelection）落定。
for (let i = 0; i < 60 && iframeEls.length === 0; i++) await sleep(10);
check('live 层已挂载（A 的 live iframe）', iframeEls.length >= 1, 'iframes=' + iframeEls.length);
const liveFrame = iframeEls[iframeEls.length - 1];
liveFrame.__fire('load'); // → startLiveWatch

const tick = intervals.find((t) => !t.cleared && t.ms === 1000);
check('live 心跳已武装', !!tick);
if (tick) tick.fn(); // 首帧确认 → scheduleLiveFrameBackfill（2.5s 后抓帧）

const bf = timers.filter((t) => !t.cleared && t.ms === 2500).pop();
check('回填定时器已武装（首帧后 2.5s）', !!bf);
if (bf) { bf.cleared = true; bf.fn(); }
await sleep(30);
check('① 抓帧上传已发出且挂住（PUT 未落地）', putCalls.length === 1 && !!putResolve,
  'put=' + putCalls.length + ' url=' + (putCalls[0] || ''));

// ② 上传期间切走：轮换到 B（B 无 live → 静态帧 + CPU scene-anim 渲染路径）
fireLatest(10000);
await sleep(40);
check('② 上传期间已切到 B', persistedId() === 'b', 'id=' + persistedId());
const bHeadsAfterFirstArrival = headCount('bbb');
check('② 首次到 B 时客户端照常 HEAD 探测 B 的槽位（未被误记账成已 pinned 而跳过）',
  bHeadsAfterFirstArrival >= 1, 'bbb HEAD=' + bHeadsAfterFirstArrival);

// ③ 上传此刻落地 —— 这是被评审的窗口
if (putResolve) putResolve();
await sleep(40);

// ④ B → A → B：回到 B 时槽位探测必须照常发生（旧实现会把 B 的 token 标成 pinned，
//    于是 TTL 内缓存命中 → 跳过这次 HEAD 探测）
const before = headCount('bbb');
fireLatest(10000);          // B → A（live 准备）
await sleep(20);
fireLatest(300);            // live 首帧 poll → 提交到 A
await sleep(40);
fireLatest(10000);          // A → B
await sleep(40);
const after = headCount('bbb');
check('④ 已再次回到 B', persistedId() === 'b', 'id=' + persistedId());
check('上传落地不得给「当前壁纸 B」记上 GPU 帧 —— 回到 B 时槽位探测必须照常发生',
  after > before,
  'bbb HEAD ' + before + ' → ' + after + '（旧实现因误记账命中缓存而停在 ' + before + '）');
// 顺带钉死：整条流程里仍然一帧 CPU 动画渲染都没有（该路线已删除）。
check('全流程零 CPU 动画渲染请求（scene-anim 已删除）', animCount('bbb') === 0,
  '/scene-anim/bbb 探针=' + animCount('bbb'));

console.log('');
console.log(failures === 0 ? 'A4 行为级复现：PASS（身份校验生效）' : failures + ' CHECK(S) FAILED（身份校验缺失 → 已复现误记账）');
process.exit(failures === 0 ? 0 : 1);
