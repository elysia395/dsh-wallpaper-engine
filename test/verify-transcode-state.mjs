// Verify the frame-skip transcode (抽帧转码) state machine against the emitted
// client bundle, focusing on the fps-cap switching bug:
//
//   switching 30→60 DIRECTLY while the 30fps transcode is still in flight used
//   to be treated as "already working on it" — the stale 30fps request then
//   completed, swapped the video to a 30fps re-encode and marked the state
//   "ready" while the picker advertised the NEW cap ("已切换至 60fps 抽帧版").
//   Only a round-trip through 无限制 (cap 0) cleared the latch, which is why
//   that workaround "fixed" it.
//
// This drives the REAL bundle through apply() + the picker's onClick handlers
// with a controllable fetch mock and asserts:
//   1. clicking 60fps while the 30fps request is in flight ABORTS the 30fps
//      request and starts a fresh 60fps one (no stale swap ever happens);
//   2. the completed 60fps request swaps the video in and reports ready with
//      the CORRECT cap;
//   3. switching back to 30fps after the swap starts + completes a 30fps
//      request and the state/UI stay truthful.
//
// Usage: node test/verify-transcode-state.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const results = [];
/** 转码编码器兜底（issue：只有 NVENC ⇒ 无 NVENC 的 ffmpeg 必然全失败）。 */
{
  const idx = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8');
  const oldBaseForm = idx.includes("'-map', '0:v:0', '-an', '-preset', 'p1',");
  const p1OnlyInEncTune = idx.includes("av1_nvenc: ['-preset', 'p1'")
    && idx.includes("h264_nvenc: ['-preset', 'p1'");
  const encTune = idx.includes('const ENC_TUNE = {');
  // 判据提成命名函数，让**阳性（真源码）与阴性（诱饵）走同一条判据**：拿测试自己刚写下的
  // 两个字面量互 `contains`（A3）对任何实现都真，零鉴别力。
  const swFallbackIn = (text) => text.includes("libx264: ['-preset', 'veryfast', '-crf', '20']")
    && text.includes("for (const enc of ['av1_nvenc', 'h264_nvenc', 'libx264'])");
  check('转码：NVENC 专属 preset 已从公共参数移出（旧 base 形态不存在且 p1 只在 ENC_TUNE）',
    !oldBaseForm && p1OnlyInEncTune);
  check('转码：质量参数按编码器拆分（ENC_TUNE）', encTune);
  check('转码：libx264 软件兜底在列（无 NVENC 的 ffmpeg 也能出片）', swFallbackIn(idx));
  const decoy = "const base = ['-i', abs, '-preset', 'p1'];\nfor (const enc of ['av1_nvenc', 'h264_nvenc']) {}";
  check('negative control: 旧的 NVENC-only 写法被**同一条判据**判出（libx264 兜底缺失）',
    swFallbackIn(decoy) === false);
}
/** 派生媒体族（`/media-info` · `/transcode-progress` · `/transcoded` · `/video-preview`）
 *  已搬到 lib/routes/media-derived.js（逐条理由见该文件头）。这里钉两件事：
 *  ① 门面里零残留、四条注册都在族文件里；② **调用点早于 `/media` 字节族** —— 后者的
 *  `prefix` 匹配器会把 `…/media-info/…` 一并吞掉（搬迁前那条注释就是为此而写）。
 *  ⚠️ `/media` 循环本身也已搬到 `lib/routes/media-bytes.js`，所以这条对比现在是"两个
 *  **门面里的调用点**先后"（两族都不在门面里注册路由字面量）。 */
{
  const host = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8');
  const derived = readFileSync(new URL('../lib/routes/media-derived.js', import.meta.url), 'utf8');
  const stale = /path: `\$\{BASE\}\/(media-info|transcode-progress|transcoded|video-preview)`/;
  const PATHS = ['media-info', 'transcode-progress', 'transcoded', 'video-preview'];
  check('派生媒体族：四条路由已搬进 lib/routes/media-derived.js（门面里零残留）',
    !stale.test(host) && PATHS.every((p) => derived.includes('path: `${BASE}/' + p + '`')));
  const callAt = host.indexOf('registerMediaDerivedRoutes(webServer, {');
  const bytesAt = host.indexOf('registerMediaBytesRoutes(webServer, {');
  check('派生媒体族：调用点在门面里，且早于 /media 字节族（晚注册会被 prefix 吞掉）',
    callAt > 0 && bytesAt > 0 && callAt < bytesAt);
  check('negative control: 门面里重新出现被搬走的路由字面量会被这条判据拒掉',
    stale.test(host + '\n  path: `${BASE}/media-info`,'));
}

/** 「有缓存转码就直接播转码」（m01627 的第二半）：宿主**只读**回答"这个上限的抽帧版在不在
 *  盘上"，客户端据此在**建层之前**就把抽帧版当 src，而不是先取原片再等探针回来换源。
 *  这里钉三件事：① 键只有一份（转码落盘与只读判定共用 `transcodeCacheKey`）；② `/media-info`
 *  的回答必须来自只读的 `transcodeCached`，**顺手起转码**要被拒；③ 客户端确实带着当前上限去问，
 *  并把这个回答记成 `selection.transcodeReady`。 */
{
  const host = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8');
  const derived = readFileSync(new URL('../lib/routes/media-derived.js', import.meta.url), 'utf8');
  const layer = readFileSync(new URL('../src/video-layer.js', import.meta.url), 'utf8');
  check('抽帧缓存键只有一份：落盘与"有没有缓存"共用 transcodeCacheKey(abs, mtimeMs, fps)',
    /function transcodeCacheKey\(abs, mtimeMs, fps\)/.test(host)
      && /const key = transcodeCacheKey\(abs, st\.mtimeMs, fps\);/.test(host)
      && /join\(transcodeCacheDir\(\), 'tc_' \+ transcodeCacheKey\(abs, st\.mtimeMs, fps\) \+ '\.mp4'\)/.test(host));
  check('门面把只读判定 transcodeCached 接给派生媒体族（且它就是 existsSync + 同一个路径函数）',
    /transcodeCached: \(abs, fps\) => \{/.test(host)
      && /transcodeCachePathFor\(abs, fps\)/.test(host)
      && /return Boolean\(p && existsSync\(p\)\);/.test(host));
  // `/media-info` 处理器体：从它的注册字面量到下一个 disposers.push
  const at = derived.indexOf('path: `${BASE}/media-info`');
  const body = at < 0 ? '' : derived.slice(at, derived.indexOf('disposers.push', at + 1));
  // 共享判据：阳性（真实处理器体）与阴性对照（同一处理器体的变异）都喂进它 —— 对照断的是
  // 它自己的字面量，而是"同一判据对变异文本返回 false"。
  const readOnlyAnswer = (body) => /transcode = \{ fps, cached: transcodeCached\(abs, fps\) === true \}/.test(body)
    && !body.includes('transcodeToFps(') && !body.includes('await ');
  check('/media-info 只读回答（transcode 来自 transcodeCached，处理器体里没有转码调用）',
    readOnlyAnswer(body));
  check('negative control: 把这条只读回答换成"顺手转一次"会被同一条判据拒掉',
    (() => {
      const bad = derived.replace('transcode = { fps, cached: transcodeCached(abs, fps) === true }',
        'transcode = await transcodeToFps(abs, fps)');
      const at2 = bad.indexOf('path: `${BASE}/media-info`');
      const b = at2 < 0 ? '' : bad.slice(at2, bad.indexOf('disposers.push', at2 + 1));
      return readOnlyAnswer(b) === false;
    })());
  check('客户端带着**当前上限**问 /media-info，并把"已缓存"记成 transcodeReady（唯一 URL 构造点）',
    /\?fps=" \+ encodeURIComponent\(String\(selection\.fpsCap \|\| 0\)\)/.test(layer)
      && /data\.transcode\.cached === true/.test(layer)
      && /selection\.transcodeReady = \{ token, fps: selection\.fpsCap, url: transcodedUrlFor\(token, selection\.fpsCap\) \};/.test(layer)
      && /function transcodedUrlFor\(token, fps\)/.test(layer));
  check('negative control: 客户端各处自己拼 transcoded URL 的形态已被唯一构造点取代',
    !layer.includes('"/wallpaper-engine/transcoded/" + encodeURIComponent(token) + "?fps=" + cap')
      && !layer.includes('"/media-info/" + encodeURIComponent(token), '));
}
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
  // Function initializers are invoked (lazy useState), matching real React.
  useState: (init) => [typeof init === "function" ? init() : init, () => {}],
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
// 夹具**故意用原生可解的容器/编码**（mp4 里的 avc1 = H.264，浏览器直接能播）：这正是
// 帧率上限必须仍然生效的那一类源。2026-10-02 的回归就是"原生可解 ⇒ 不抽帧"，而夹具当时写的是
// `hvc1`（不在原生白名单里）⇒ 走的是"非原生必须转"那条路，回归**在夹具里看不见**。
// 口径：上限的判据是"源帧率是否高于上限"，与容器能不能原生播无关（见 src/video-layer.js
// 的 capNeedsTranscode）。所以夹具必须站在"原生可解 + 高帧率"这一侧。
const mediaInfo = { width: 3840, height: 2160, codec: 'avc1', fps: 120 };

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
  // ⚠️ 每个替身响应都必须带 `status`：真实 Response 的 `ok` **由 status 推出**，
  //    而 api-client 正是据此判成败 —— 少了 status 会被读成 0（= 失败），
  //    症状是"清单加载失败 → picker 按钮不渲染"这类看似与网络层无关的断言红。
  if (typeof url === 'string' && url.includes('/wallpaper-engine/transcode-progress/')) {
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ phase: 'transcode', percent: 50, source: 'ffmpeg', finalizing: false, eta: 10 }) });
  }
  if (typeof url === 'string' && url.includes('/wallpaper-engine/media-info/')) {
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, info: mediaInfo }) });
  }
  if (typeof url === 'string' && url.includes('/wallpaper-engine/inventory')) {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        installDir: 'D:/we', total: 1, portableCount: 1, playlists: [],
        wallpapers: [
          { id: 'w1', title: 'Video W1', type: 'video', playable: true, media: '/wallpaper-engine/media/w1', mediaExt: 'mp4', preview: null, contentrating: 'Everyone' },
        ],
      }),
    });
  }
  if (typeof url === 'string' && url.includes('/wallpaper-engine/settings')) {
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
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
  // 页内下钻后库视图与页签内容互斥：选完经「返回」退出，帧率上限控件才渲染（真实路径）。
  findButton(renderTree(), 'we-picker__btn', '返回').props.onClick();

  const layer = document.getElementById('dsh-wallpaper-engine-layer');
  assert(layer, 'wallpaper layer mounted');
  const video = layer.querySelector('video');
  assert(video, 'video element mounted');
  check('wallpaper layer + video mounted', !!video);
  check('video starts on the ORIGINAL (no transcode)', video.src === '/wallpaper-engine/media/w1' && !video.dataset.weTranscoded);

  // The 帧率上限 controls live on the 效果 tab in the tabbed picker.
  localStorage.setItem('dsh-wallpaper-engine:picker-tab', 'effects');
  // ---- 30fps: request starts, pending ----
  tree = renderTree();
  const b30 = findButton(tree, 'we-picker__rate', '30fps');
  assert(b30 && typeof b30.props.onClick === 'function', '30fps button found');
  b30.props.onClick();
  await new Promise((r) => setTimeout(r, 10));
  check('click 30fps starts a transcode request', transcodePending.length === 1 && transcodePending[0].fps === 30);
  // 回归判据（行为层，不只是文本层）：源是**原生可解的 mp4/avc1** 且帧率 120 > 上限 30 ⇒
  // 必须真的起抽帧 —— 旧口径（原生可解即免转）在这里会停在 "native"、一个请求都不发。
  // 本判据只认"请求里带的是 30"这一件事（落点/计数与上一条共用同一份观测）；把它对**变异
  // 状态**（同样的比较式、操作数换成改动版字面量 60）跑一遍必须为 false —— 否则它就是恒真
  // 的复述（这条比较式若对变异也不为假，说明它根本没在断 fps）。
  const b30RightFps = (pendingAfterClick) => pendingAfterClick.length === 1 && pendingAfterClick[0].fps === 30;
  check('原生可解（mp4/avc1）+ 源 120fps + 上限 30 ⇒ 仍然抽帧（上限的意义是压解码占用）',
    b30RightFps(transcodePending));
  check('negative control: 同一比较式吃变异状态（fps 60）必须为 false',
    b30RightFps([{ fps: 60 }]) === false);
  const statusWorking = JSON.stringify(renderTree()).includes('抽帧准备中');
  check('UI shows 抽帧准备中 while 30fps transcode runs', statusWorking);

  // ---- 24 → 48 DIRECT while the 30fps request is in flight ----
  tree = renderTree();
  const b60 = findButton(tree, 'we-picker__rate', '60fps');
  assert(b60 && typeof b60.props.onClick === 'function', '60fps button found');
  b60.props.onClick();
  await new Promise((r) => setTimeout(r, 10));
  // The stale 30fps request must have been ABORTED, and a fresh 60fps one started.
  const stale30 = transcodePending.find((p) => p.fps === 30);
  check('30→60 direct: stale 30fps request is aborted (not left to swap in)',
    transcodeResolved.length === 0 && stale30 && stale30.signal && stale30.signal.aborted === true);
  const activeAfter60 = activePending();
  check('30→60 direct: a fresh 60fps request starts',
    activeAfter60.length === 1 && activeAfter60[0].fps === 60 && !activeAfter60[0].signal.aborted);
  check('30→60 direct: video still on the ORIGINAL mid-flight', video.src === '/wallpaper-engine/media/w1' && !video.dataset.weTranscoded);

  // ---- Complete the 60fps request → swap + ready with the CORRECT cap ----
  const req60 = activeAfter60[0];
  completeTranscode(req60, true);
  await new Promise((r) => setTimeout(r, 20));
  // loadedmetadata fires only after src swap; the mock fires it manually:
  assert(video._handlers.loadedmetadata, 'loadedmetadata handler registered after swap');
  video._handlers.loadedmetadata();
  await new Promise((r) => setTimeout(r, 10));
  check('60fps completes → video swapped to the 60fps re-encode',
    video.dataset.weTranscoded === '60' && video.src.includes('fps=60'));
  check('60fps completes → UI reports ready at 60fps',
    JSON.stringify(renderTree()).includes('已切换至 60fps 抽帧版'));

  // ---- Back to 30fps after the swap: fresh request + truthful swap ----
  // (Regression: with the video already on a transcode, the progress poller's
  // emit used to abort + re-start the request forever — a page freeze. The
  // request must stay in flight across the poll emit.)
  tree = renderTree();
  const b30b = findButton(tree, 'we-picker__rate', '30fps');
  b30b.props.onClick();
  await new Promise((r) => setTimeout(r, 30)); // let several poll-emit cycles run
  const active30b = activePending();
  check('60→30 after swap starts a fresh 30fps request',
    active30b.length === 1 && active30b[0].fps === 30 && !active30b[0].signal.aborted);
  completeTranscode(active30b[0], true);
  await new Promise((r) => setTimeout(r, 20));
  assert(video._handlers.loadedmetadata, 'loadedmetadata handler registered (24)');
  video._handlers.loadedmetadata();
  await new Promise((r) => setTimeout(r, 10));
  check('30fps completes → video swapped to the 30fps re-encode',
    video.dataset.weTranscoded === '30' && video.src.includes('fps=30'));
  check('30fps completes → UI reports ready at 30fps',
    JSON.stringify(renderTree()).includes('已切换至 30fps 抽帧版'));

  // ---- 无限制 clears everything (the historical workaround, still works) ----
  tree = renderTree();
  const b0 = findButton(tree, 'we-picker__rate', '无限制');
  assert(b0 && typeof b0.props.onClick === 'function', '无限制 button found');
  b0.props.onClick();
  await new Promise((r) => setTimeout(r, 10));
  check('无限制 reverts to the original + idle', !video.dataset.weTranscoded && video.src === '/wallpaper-engine/media/w1');

  // ---- Failure of a NEW cap reverts to the original (truthful 已回退原片) ----
  b30b.props.onClick();
  await new Promise((r) => setTimeout(r, 10));
  completeTranscode(activePending()[0], false); // 502/network failure
  await new Promise((r) => setTimeout(r, 20));
  check('failed transcode → video back on the original',
    !video.dataset.weTranscoded && video.src === '/wallpaper-engine/media/w1');
  check('failed transcode → UI reports fallback',
    JSON.stringify(renderTree()).includes('转码不可用，已回退原片'));

  // ---- 结构契约：转码字段的写入权（抽模块后钉住）----
  // 契约的可核对形式：
  //   · 三个字段的**状态机**写入必须全在 视频通道 src/video-layer.js；
  //   · src/client.js 只允许"换壁纸/切走时复位"（= null / = "idle"）；
  //   · 两个新入口必须真的被 client.js 调用（搬移后接线不能断）；
  //   · transcode.js 必须登记进 INLINE_MODULES 且**真的进了产物**（防孤儿：文件在却不进 bundle）。
  {
    const clientSrc = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');
    const prepSrc = readFileSync(new URL('../src/media-prep.js', import.meta.url), 'utf8');
    const tcSrc = readFileSync(new URL('../src/video-layer.js', import.meta.url), 'utf8');
    const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
    const build = readFileSync(new URL('../scripts/build-client.mjs', import.meta.url), 'utf8');
    const FIELDS = ['mediaInfo', 'transcodeState', 'transcodeProgress'];
    const writes = (src, f) => [...src.matchAll(new RegExp('selection\\.' + f + '\\s*=\\s*([^;\\n]+)', 'g'))]
      .map((m) => m[1].trim());
    const isReset = (v) => v === 'null' || v === '"idle"';
    const badInClient = [];
    for (const f of FIELDS) for (const v of writes(clientSrc, f)) if (!isReset(v)) badInClient.push(f + ' = ' + v);
    check('client.js 对三个转码字段只做复位（状态机写入在 视频通道 src/video-layer.js）', badInClient.length === 0,
      badInClient.join('; ')
      || '复位写入 ' + FIELDS.map((f) => f + '×' + writes(clientSrc, f).length).join(' '));
    // 防空转：transcode.js 里若没有状态机写入，上面那条判据就是空对空。
    const machine = FIELDS.reduce((a, f) => a + writes(tcSrc, f).filter((v) => !isReset(v)).length, 0);
    check('negative control: transcode.js 里确有状态机写入（防判据空转）', machine >= 8, machine + ' 处');
    check('negative control: 非复位的写法会被判出',
      writes('selection.mediaInfo = await probe();', 'mediaInfo').some((v) => !isReset(v)));
    // 调用点按文件分别计数（跨文件接线：换壁纸的两处在 applySelection（media-prep.js），
    // 卸载路径的一处在 client.js 的 apply 清理里）—— 不拼接字符串，免得"在哪个文件"这条
    // 信息被抹掉，将来搬动时也不会再出现"计数对了但位置错了"。
    const countIn = (src, name) => (src.match(new RegExp(name + '\\(\\)', 'g')) || []).length;
    const wired = (name) => countIn(clientSrc, name) + countIn(prepSrc, name);
    check('新入口已接线（invalidateMediaInfoProbe ×2 + abortMediaInfoProbe ×1）',
      wired('invalidateMediaInfoProbe') === 2 && wired('abortMediaInfoProbe') === 1,
      `client.js=${countIn(clientSrc, 'invalidateMediaInfoProbe')}/${countIn(clientSrc, 'abortMediaInfoProbe')}`
      + ` media-prep.js=${countIn(prepSrc, 'invalidateMediaInfoProbe')}/${countIn(prepSrc, 'abortMediaInfoProbe')}`);
    check('client.js 不再直写探测状态（探测的 token/AbortController 只属于 transcode.js）',
      !/\bmediaInfoToken\s*=/.test(clientSrc) && !/\bmediaInfoAbort\s*=/.test(clientSrc)
      && !/\bmediaInfoToken\s*=/.test(prepSrc) && !/\bmediaInfoAbort\s*=/.test(prepSrc));
    // ④ 之后：抽帧换源链路**并入视频通道**（原 `视频通道 src/video-layer.js` 已删除）⇒ 这条判据的
    // 语义跟着搬家：从「transcode.js 已登记进 INLINE_MODULES」改成「并入视频通道、且不再是
    // 独立项」。原判据的真实意图**原样保留**：防孤儿（登记了却进不了 bundle）+ 只有一份。
    check('抽帧换源链路已并入视频通道（video-layer.js 已登记、transcode.js 不再是独立项）',
      /file:\s*'src\/video-layer\.js'/.test(build)
      && !/file:\s*'src\/transcode\.js'/.test(build)
      && (bundle.match(/async function refreshMediaInfo\(/g) || []).length === 1);
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (failed.length === 0 ? 'ALL TRANSCODE STATE CHECKS PASSED' : failed.length + ' CHECK(S) FAILED'));
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('TEST ERROR:', err && err.stack ? err.stack : err);
  process.exit(1);
});
