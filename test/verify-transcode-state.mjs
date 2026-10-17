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
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createTranscodeKit } from '../lib/media/transcode.js';
import { stripComments } from './tools/js-text.mjs';

const results = [];
/** 转码编码器兜底（issue：只有 NVENC ⇒ 无 NVENC 的 ffmpeg 必然全失败）。 */
{
  // 抽帧转码实现住 lib/media/transcode.js（P0 库化；判据原先直读上游同名副本 lib/transcode.js，
  // task-10 A 已把该副本的修复搬进真源、把本判据重指过来，并在本批末次提交删掉了该副本）
  // ⇒ 文本判据合并两处；判据/期望值一字未改。
  const idx = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
    + readFileSync(new URL('../lib/media/transcode.js', import.meta.url), 'utf8');
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
  // 三处被钉的文本里，`transcodeCacheKey`/`transcodeCachePathFor` 的实现住 lib/media/transcode.js
  // （P0 库化；task-10 A 起本判据重指真源）；`transcodeCached` 仍在门面 ⇒ 合并两处文本，判据/期望值一字未改。
  const host = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
    + readFileSync(new URL('../lib/media/transcode.js', import.meta.url), 'utf8');
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

/** SLICE 11（转码等待者账本）：**在途命中时加入者也必须进账本**。
 *
 *  回归面：`transcodeToFps` 命中在途条目时曾直接 `return entry.promise` ⇒ 第二个客户端的
 *  `onEntry` 从不回调 ⇒ 路由在它里面写的 `registerTranscodeWaiter(e, res)` 不执行 ⇒ 该 res
 *  从不进账本 ⇒ 第一个客户端断开就把 `waiters` 打到 0、`cancel()` 杀掉 ffmpeg 并删掉半成品，
 *  仍在等的第二个客户端收到 502。账本本身（`registerTranscodeWaiter`：「**所有**等待者断开
 *  才 cancel」）就是为多等待者写的，所以"发起者断开即整体取消"不是既定口径。
 *
 *  本段**不需要真 ffmpeg**（CI 上没有，也不该依赖）：账本条目是调用期同步建好的（任务体在
 *  第一个 `await` 处分片），所以同一次 tick 里的第二次调用必定走"加入"分支 —— 观测与判定
 *  都是确定性的、不依赖计时器。供给链被指向一个不存在的路径 ⇒ 任务体随后以 ENOENT 失败
 *  （不触发真实下载），那条路径与本段判据无关。
 *
 *  ⚠️ 本段**故意不取消**真实 kit 的在途任务：`spawnFfmpeg` 在"子进程 spawn 失败（`proc.pid`
 *  为 undefined）"之后调用 `proc.kill()` 会**同步挂死整个进程**（macOS 实测；`kill()` 不返回、
 *  事件循环被阻塞、连 watchdog 都不再触发）—— 用这种方式制造"取消"会把守卫变成挂死而不是报红。
 *  所以：加入者登记只用**同步观测**（不需要取消），账本语义用**手造条目**跑（不需要真任务）。
 */
{
  // ⚠️ 沙盒路径**动态拼**（不用 `new URL('../.test-cache/…')` 这种静态相对说明符）：
  // `test/verify-module-layout.mjs` 的口径是"源码里的静态相对路径必须指向存在的文件"，
  // 而 `.test-cache/**` 是运行时产物目录（本段跑完就 rmSync）⇒ 静态写法会随"目录当前是否在盘上"翻面。
  const root = join(fileURLToPath(new URL('..', import.meta.url)), '.test-cache', 'transcode-waiter-ledger');
  mkdirSync(root, { recursive: true });
  const src = join(root, 'fake.mp4');
  writeFileSync(src, 'not-really-an-mp4');
  process.env.DSH_WE_FFMPEG = join(root, 'no-such-ffmpeg');
  const kit = createTranscodeKit({
    // 真源 deps 契约（`lib/media/transcode.js` 文件头）：目录一律由访问器注入，
    // 本段只关心"在途命中是否登记加入者"，所以 getMediaInfo 给 null、其余指向沙盒。
    cacheBaseDir: () => join(root, 'cache'),
    configPath: () => join(root, 'config.json'),
    videoPreviewCacheDir: () => join(root, 'video-previews'),
    getMediaInfo: () => null,
    atomicTmpPath: (f) => f + '.tmp' + process.pid + '1',
    pluginRoot: root,
  });
  /** 路由侧最小的 res 替身：账本只用到 `once('close', …)`。 */
  function fakeRes() {
    const handlers = {};
    return {
      statusCode: 200,
      once: (type, fn) => { handlers[type] = fn; },
      close: () => { if (handlers.close) handlers.close(); },
    };
  }
  const cb1 = [];
  const cb2 = [];
  const p1 = kit.transcodeToFps(src, 60, (e) => cb1.push(e));
  const p2 = kit.transcodeToFps(src, 60, (e) => cb2.push(e)); // 同 tick ⇒ 命中在途分支
  p1.then(() => {}, () => {}); // 随后的 ENOENT 拒绝不属于本段判据，别变成 unhandled rejection
  const joinObservation = {
    samePromise: p1 === p2,
    creator: cb1.length,
    joiner: cb2.length,
    sameEntry: cb1.length === 1 && cb2.length === 1 && cb1[0] === cb2[0],
  };
  // 共享判据：阳性（真实观测）与阴性对照（同一判据吃"加入者未登记"的观测）都走它。
  const joinerRegisters = (o) => o.samePromise === true && o.creator === 1 && o.joiner === 1
    && o.sameEntry === true;
  check('在途命中：加入者也进账本（否则退化成"发起者断开即整体取消"）',
    joinerRegisters(joinObservation), JSON.stringify(joinObservation));
  check('negative control: 同一判据吃"加入者未登记"的观测必须为 false',
    joinerRegisters({ ...joinObservation, joiner: 0, sameEntry: false }) === false);

  // 账本语义（手造条目）：先关一个不取消，全关才 cancel。与上一条互补 —— 上一条证明"加入者
  // 登记了"，这一条证明"账本确实按**全部**等待者计数"，两条合起来才是完整语义。
  let cancelled = 0;
  const fakeEntry = { waiters: 0, cancel: () => { cancelled++; } };
  const resA = fakeRes();
  const resB = fakeRes();
  kit.registerTranscodeWaiter(fakeEntry, resA);
  kit.registerTranscodeWaiter(fakeEntry, resB);
  resA.close();
  const afterOne = { waiters: fakeEntry.waiters, cancelled };
  resB.close();
  const afterAll = { waiters: fakeEntry.waiters, cancelled };
  const ledger = (o) => o.afterOne.waiters === 1 && o.afterOne.cancelled === 0
    && o.afterAll.waiters === 0 && o.afterAll.cancelled === 1;
  check('等待者账本：先关一个不取消，全关才 cancel', ledger({ afterOne, afterAll }),
    `one=${afterOne.waiters}/${afterOne.cancelled} all=${afterAll.waiters}/${afterAll.cancelled}`);
  check('negative control: 同一判据吃"发起者一关就 cancel"的观测必须为 false',
    ledger({ afterOne: { waiters: 0, cancelled: 1 }, afterAll: { waiters: 0, cancelled: 1 } }) === false);

  // 源码形态：在途命中分支**在返回同一个 promise 之前**先回调 onEntry。负对照按字面要求做
  // "把那一行删掉"——阳性与变异跑的是同一条判据函数。
  const tcText = readFileSync(new URL('../lib/media/transcode.js', import.meta.url), 'utf8');
  const joinsThroughOnEntry = (text) => {
    const at = text.indexOf('TRANSCODE_INFLIGHT.get(cachePath)');
    if (at < 0) return false;
    const end = text.indexOf('return entry.promise;', at);
    if (end < 0) return false;
    return /onEntry\(entry\)/.test(text.slice(at, end));
  };
  const withoutOnEntry = (() => {
    const at = tcText.indexOf('TRANSCODE_INFLIGHT.get(cachePath)');
    const end = tcText.indexOf('return entry.promise;', at);
    if (at < 0 || end < 0) return tcText;
    const cleaned = tcText.slice(at, end)
      // `\r?\n`：这条判据吃的是**源码文本**，而文本的换行取决于 checkout 的 EOL。
      // 仓库已用 `.gitattributes` 把检出钉成 LF，这里再容一次 CR，避免这条负对照
      // 变成「只有 LF 检出才跑得通」的平台依赖。
      .replace(/if \(typeof onEntry === 'function'\) onEntry\(entry\);\r?\n/, '');
    return tcText.slice(0, at) + cleaned + tcText.slice(end);
  })();
  check('在途命中分支在返回同一个 promise 前先回调 onEntry（源码形态）',
    joinsThroughOnEntry(tcText));
  check('negative control: 把那一行 onEntry(entry) 删掉后同一条判据必须为 false',
    joinsThroughOnEntry(withoutOnEntry) === false);

  rmSync(root, { recursive: true, force: true });
}
/** SLICE 12（kill 前必须判 pid）：`spawn` 失败（可执行文件不存在）时 ChildProcess 的
 *  `pid === undefined`，此时 `kill()` **既不抛也不返回** —— 事件循环被同步阻塞（macOS
 *  实测：连 watchdog 定时器都不再触发）。`try/catch` 因此完全无效（它挂住而不是抛），
 *  唯一的正解是调用前判 pid。本段把这条判据钉在转码族的 kill 调用点上；扫整个 `lib/**`
 *  的同类判据在 test/verify-child-kill.mjs。
 *
 *  判据作用在**剥注释后**的源码上（注释里提到 `proc.kill()` 不算调用点）—— 用共享的
 *  test/tools/js-text.mjs，而不是朴素块注释正则。阳性（真源码）与阴性（变异体）走同一条
 *  `pidUnguarded`。⚠️ 这也是本段只能钉源码形态的原因：行为判据在修复前会**挂死**而不是
 *  报红（守卫自身卡住，CI 只能超时）。
 */
{
  const tcText = readFileSync(new URL('../lib/media/transcode.js', import.meta.url), 'utf8');
  /** 判据：返回没有「子进程已建立」守卫包裹的 kill 调用点（行号）。 */
  const pidUnguarded = (text) => {
    const lines = stripComments(text).split('\n');
    const bad = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/([A-Za-z_$][\w$]*)\.kill\s*\(/);
      if (!m) continue;
      const recv = m[1];
      const win = lines.slice(Math.max(0, i - 8), i + 1).join('\n');
      const guarded = new RegExp('\\b' + recv + '\\s*&&\\s*' + recv + '\\.pid\\b'
        + '|\\b' + recv + '\\.pid\\s*(?:!==?|===?)\\s*undefined').test(win);
      if (!guarded) bad.push(i + 1);
    }
    return bad;
  };
  const realBad = pidUnguarded(tcText);
  check('转码族每个 kill 调用点都判了「子进程已建立」（pid 落地）',
    realBad.length === 0, '未守卫行=' + JSON.stringify(realBad));
  const mutant = tcText
    .split('if (proc.pid !== undefined) { try { proc.kill(); } catch { /* ignore */ } }')
    .join('if (true) { try { proc.kill(); } catch { /* ignore */ } }')
    .split('if (curProc && curProc.pid !== undefined) { try { curProc.kill(); } catch { /* ignore */ } }')
    .join('if (curProc) { try { curProc.kill(); } catch { /* ignore */ } }');
  check('negative control: 同一条判据吃「删掉 pid 守卫」的变异体必须报出调用点',
    pidUnguarded(mutant).length > 0, '未守卫行=' + JSON.stringify(pidUnguarded(mutant)));
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
const byId = {};
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
      addEventListener(type, fn) { handlers[type] = fn; },
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
const transcodeResolved = []; // snapshots of completed requests (fps, aborted)
// 夹具**故意用原生可解的容器/编码**（mp4 里的 avc1 = H.264，浏览器直接能播）：这正是
// 帧率上限必须仍然生效的那一类源。
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
  await new Promise((r) => { setTimeout(r, 20); });

  // Open the picker modal and select the single video wallpaper.
  let tree = renderTree();
  const openBtn = findButton(tree, 'we-picker__btn', '选择壁纸');
  assert(openBtn && typeof openBtn.props.onClick === 'function', 'picker open button found');
  openBtn.props.onClick();
  tree = renderTree();
  const card = findWallpaperCard(tree, 'Video W1');
  assert(card && typeof card.props.onClick === 'function', 'wallpaper card found');
  card.props.onClick(); // applySelection('w1')
  await new Promise((r) => { setTimeout(r, 20); }); // media-info probe resolves
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
  await new Promise((r) => { setTimeout(r, 10); });
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
  await new Promise((r) => { setTimeout(r, 10); });
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
  await new Promise((r) => { setTimeout(r, 20); });
  // loadedmetadata fires only after src swap; the mock fires it manually:
  assert(video._handlers.loadedmetadata, 'loadedmetadata handler registered after swap');
  video._handlers.loadedmetadata();
  await new Promise((r) => { setTimeout(r, 10); });
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
  await new Promise((r) => { setTimeout(r, 30); }); // let several poll-emit cycles run
  const active30b = activePending();
  check('60→30 after swap starts a fresh 30fps request',
    active30b.length === 1 && active30b[0].fps === 30 && !active30b[0].signal.aborted);
  completeTranscode(active30b[0], true);
  await new Promise((r) => { setTimeout(r, 20); });
  assert(video._handlers.loadedmetadata, 'loadedmetadata handler registered (24)');
  video._handlers.loadedmetadata();
  await new Promise((r) => { setTimeout(r, 10); });
  check('30fps completes → video swapped to the 30fps re-encode',
    video.dataset.weTranscoded === '30' && video.src.includes('fps=30'));
  check('30fps completes → UI reports ready at 30fps',
    JSON.stringify(renderTree()).includes('已切换至 30fps 抽帧版'));

  // ---- 无限制 clears everything (the historical workaround, still works) ----
  tree = renderTree();
  const b0 = findButton(tree, 'we-picker__rate', '无限制');
  assert(b0 && typeof b0.props.onClick === 'function', '无限制 button found');
  b0.props.onClick();
  await new Promise((r) => { setTimeout(r, 10); });
  check('无限制 reverts to the original + idle', !video.dataset.weTranscoded && video.src === '/wallpaper-engine/media/w1');

  // ---- Failure of a NEW cap reverts to the original (truthful 已回退原片) ----
  b30b.props.onClick();
  await new Promise((r) => { setTimeout(r, 10); });
  completeTranscode(activePending()[0], false); // 502/network failure
  await new Promise((r) => { setTimeout(r, 20); });
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
