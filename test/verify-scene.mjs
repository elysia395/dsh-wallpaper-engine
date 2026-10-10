/**
 * verify-scene.mjs — 场景出图来源链 + GPU 抓帧缓存的自检。
 *
 * Levels:
 *   B. 宿主路由集成（mock webServer）：出图来源链头（抓帧 → 自定义画面 → 空态）、
 *      抓帧回填的槽位语义（409 唯一性 / 几何头 / 清除通道 / 并发串行）。
 *   D2/D3. 中途放弃请求的断开时机（确定性替身 + 结构棘轮）。
 *   E. 缓存键单一构造点。
 *   F. sceneVideo 文件版探测（issue #136）：新旧路径等价 / 读量上界 / 调用点结构。
 *
 * 真机夹具（Steam 工坊）只在存在时跑；合成夹具总会跑，所以没有 Steam 也能通过。
 *
 * Usage:  node test/verify-scene.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, rmSync, readdirSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Writable, Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
// 剥注释：共享的字符串感知实现（test/tools/js-text.mjs）。
import { stripComments } from './tools/js-text.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 宿主半的**全部注册面** = `lib/index.js` + `lib/routes/*.js`。
 * 路由族拆出 `apply(ctx)` 之后 ⇒ 凡断言"宿主仍实现某契约"的判据都必须覆盖
 * 那个目录，否则"已搬走"会被误报成"契约丢了"（假红）。反之，断言"某路由**已不在正文**"的
 * 判据仍必须只读 `lib/index.js`。
 */
const readHostHalf = () => ['lib/index.js',
  ...readdirSync(resolve(root, 'lib', 'routes')).filter((f) => f.endsWith('.js')).map((f) => 'lib/routes/' + f)]
  .map((f) => readFileSync(resolve(root, f), 'utf8')).join('\n');
// Point the cache **root** at a workspace-relative dir so the suite passes under
// sandboxes that cannot write outside the workspace (the real host has no
// such restriction). ⚠️ `DSH_WE_CACHE_DIR` 是缓存**根**（帧缓存落在 `<root>/frames`）——
// 把 env 值直接当帧目录用，下面"没有落盘"的断言会恒真、静默假通过。
const TEST_CACHE_DIR = join(root, '.test-cache', 'cache');
const TEST_FRAMES_DIR = join(TEST_CACHE_DIR, 'frames');
process.env.DSH_WE_CACHE_DIR = TEST_CACHE_DIR;

let passed = 0;
let failed = 0;
let platformSkipped = 0;
const platformSkippedNames = [];
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  if (ok) passed++;
  else failed++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
}
/** 本平台不适用的断言：**不得计为通过** —— 否则"在 CI 平台上跑不了的那一半"会伪装成绿。 */
function platformSkip(name, why) {
  platformSkipped++;
  platformSkippedNames.push(name);
  console.log('  ○ ' + name + (why ? ' — ' + why : ''));
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Minimal PNG chunk writer for synthetic embedded-PNG tests. */
function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  let crc = 0xffffffff;
  const bytes = out.subarray(4, 8 + data.length);
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let k = 0; k < 8; k++) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  }
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length);
  return out;
}

/** Build a tiny packed scene.pkg with raw (uncompressed) entries. */
function buildPkg(entries) {
  const parts = [];
  const index = [];
  let offset = 0;
  for (const { path, bytes } of entries) {
    index.push({ path, offset, length: bytes.length });
    parts.push(bytes);
    offset += bytes.length;
  }
  const headerSize = 12 + 8 + index.reduce((n, e) => n + 4 + Buffer.byteLength(e.path, 'utf8') + 8, 0);
  const header = Buffer.alloc(headerSize);
  let p = 0;
  header.writeInt32LE(8, p); p += 4; // magic length
  header.write('PKGV0001', p, 'ascii'); p += 8;
  header.writeInt32LE(index.length, p); p += 4;
  for (const e of index) {
    header.writeInt32LE(Buffer.byteLength(e.path, 'utf8'), p); p += 4;
    header.write(e.path, p, 'utf8'); p += Buffer.byteLength(e.path, 'utf8');
    header.writeUInt32LE(e.offset, p); p += 4;
    header.writeUInt32LE(e.length, p); p += 4;
  }
  return Buffer.concat([header.subarray(0, p), ...parts]);
}

function buildTexRgba(width, height, rgbaBytes) {
  const mip = Buffer.alloc(4 * 5 + rgbaBytes.length);
  mip.writeInt32LE(width, 0);
  mip.writeInt32LE(height, 4);
  mip.writeInt32LE(0, 8); // isLz4
  mip.writeInt32LE(0, 12); // decompressedCount
  mip.writeInt32LE(rgbaBytes.length, 16); // storedLen
  rgbaBytes.copy(mip, 20);
  // Consecutive NUL-terminated strings (the real TEX header layout).
  const header = Buffer.alloc(9 + 9 + 4 * 8 + 9 + 4 * 2 + 4);
  let p = 0;
  header.write('TEXV0005\0', p, 'ascii'); p += 9;
  header.write('TEXI0001\0', p, 'ascii'); p += 9;
  header.writeInt32LE(0, p); p += 4; // format RGBA8888
  header.writeInt32LE(0, p); p += 4; // flags
  header.writeInt32LE(width, p); p += 4;
  header.writeInt32LE(height, p); p += 4;
  header.writeInt32LE(width, p); p += 4;
  header.writeInt32LE(height, p); p += 4;
  header.writeInt32LE(0, p); p += 4; // unknown
  header.write('TEXB0002\0', p, 'ascii'); p += 9;
  header.writeInt32LE(1, p); p += 4; // imageCount
  header.writeInt32LE(1, p); p += 4; // mipmapCount
  return Buffer.concat([header.subarray(0, p), mip]);
}

// ── Offline fixture: synthetic Steam library for Level B ────────────────────
// Level B must not depend on a real workshop scene being installed (dev boxes
// often have none → 'no scene wallpaper with frameUrl on this machine'). A
// synthetic library wired through DSH_WE_STEAM_ROOT makes the route pipeline
// testable anywhere: the pkg ships one 32×32 noise RGBA texture (noise keeps
// the PNG payload above the >1000B assertion and passes the colorful-main-
// texture gate that a flat fill would trip).
const fixtureLib = join(root, '.test-cache', 'scene-fixture', 'steamlib');
const fixtureItemDir = join(fixtureLib, 'steamapps', 'workshop', 'content', '431960', '990002');
{
  rmSync(join(root, '.test-cache', 'scene-fixture'), { recursive: true, force: true });
  mkdirSync(fixtureItemDir, { recursive: true });
  // A library root is only scanned when steamapps/common/wallpaper_engine
  // exists (owningLibrariesP) — create it so the workshop content is found.
  mkdirSync(join(fixtureLib, 'steamapps', 'common', 'wallpaper_engine'), { recursive: true });
  const W = 32;
  const rgba = Buffer.alloc(W * W * 4);
  let seed = 0x12345678;
  for (let i = 0; i < W * W; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    rgba[i * 4] = seed & 0xff;
    rgba[i * 4 + 1] = (seed >> 8) & 0xff;
    rgba[i * 4 + 2] = (seed >> 16) & 0xff;
    rgba[i * 4 + 3] = 255;
  }
  const pkg = buildPkg([
    { path: 'scene.json', bytes: Buffer.from(JSON.stringify({ objects: [{ image: 'main.tex' }] })) },
    { path: 'main.tex', bytes: buildTexRgba(W, W, rgba) },
  ]);
  writeFileSync(join(fixtureItemDir, 'scene.pkg'), pkg);
  writeFileSync(join(fixtureItemDir, 'project.json'), JSON.stringify({
    title: 'Synthetic Fixture Scene', type: 'scene', file: 'scene.pkg', preview: 'preview.jpg',
    contentrating: 'Everyone',
  }));
  writeFileSync(join(fixtureItemDir, 'preview.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  // Env roots are additive: a real Steam library on this machine still scans.
  process.env.DSH_WE_STEAM_ROOT = [process.env.DSH_WE_STEAM_ROOT, fixtureLib].filter(Boolean).join(',');
}

// ── Level B: host route integration (mock webServer) ────────────────────────
console.log('Level B — scene-frame route (mock webServer)');
const routes = [];
const mockCtx = {
  webServer: {
    register(route) { routes.push(route); return () => { const i = routes.indexOf(route); if (i >= 0) routes.splice(i, 1); }; },
    tapIndex() { return () => {}; },
  },
};
const hostMod = await import(pathToFileURL(resolve(root, 'lib', 'index.js')).href);
const host = hostMod.default || hostMod;
// Build a minimal real-ish ctx for the plugin's apply (only webServer is used
// for route registration; uploads config writes are guarded by try/catch).
const apply = host.apply || (host.inject && host.apply);
const dispose = apply(mockCtx);
const sceneRoute = routes.find((r) => r.path === '/wallpaper-engine/scene-frame');
check('scene-frame route registered', Boolean(sceneRoute), sceneRoute ? 'kind=' + sceneRoute.kind : 'missing');

// Route requires a token that mediaMap knows; tokens are minted during
// inventory. Emulate by calling the inventory route first with a req shim.
const invRoute = routes.find((r) => r.path === '/wallpaper-engine/inventory');
function fakeReq(url) { return { url, headers: {}, method: 'GET' }; }
function fakeRes() {
  const state = { status: 200, headers: {}, body: Buffer.alloc(0), ended: false };
  // A real Writable so createReadStream(...).pipe(res) completes; the test
  // awaits 'finish' to collect the full payload.
  const res = new Writable({
    write(chunk, enc, cb) { state.body = Buffer.concat([state.body, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]); cb(); },
    final(cb) { state.ended = true; cb(); },
  });
  res.setHeader = (k, v) => { state.headers[k] = v; };
  res.writeHead = (s, h) => { state.status = s; if (h) Object.assign(state.headers, h); };
  Object.defineProperty(res, 'statusCode', { get: () => state.status, set: (v) => { state.status = v; } });
  res.__state = state;
  return res;
}
/** Run a handler and wait for either its returned promise or the response
 *  stream to finish (the scene-frame handler kicks off an async IIFE that
 *  pipes a file stream into res). */
async function runHandler(route, url) {
  const res = fakeRes();
  const done = route.handler(fakeReq(url), res);
  if (done && typeof done.then === 'function') await done;
  if (!res.__state.ended) {
    await new Promise((resolveFn) => {
      const t = setTimeout(resolveFn, 8000);
      res.on('finish', () => { clearTimeout(t); resolveFn(); });
    });
  }
  return res;
}

let token = null;
let invBody = null;
{
  const res = await runHandler(invRoute, '/wallpaper-engine/inventory');
  invBody = JSON.parse(res.__state.body.toString('utf8'));
  // The synthetic fixture (id 990002) is what Level B exercises; a real
  // workshop scene on this machine would still be listed alongside it.
  const scene = (invBody.wallpapers || []).find((w) => w.id === '990002' && w.frameUrl);
  token = scene ? scene.frameUrl.split('/').pop() : null;
  check('inventory exposes the fixture scene frameUrl', Boolean(token), token ? 'frame token minted' : 'fixture scene missing from inventory');
}

if (token) {
  // ── 出图来源链头（账本 §6.6/§6.7）：这个 fixture 既没有实时抓帧、也没有自定义画面 ⇒ 必须
  //    **诚实留空**（404），而不是"替作者猜一张图" —— 猜图来源一律不许回落
  //    （§6.4 的静默回落陷阱：合成路径还在，"找最大图片"就仍活在自动链上）。
  const beforeList = existsSync(TEST_FRAMES_DIR) ? readdirSync(TEST_FRAMES_DIR).slice() : [];
  const firstRes = await runHandler(sceneRoute, '/wallpaper-engine/scene-frame/' + token);
  check('无抓帧且无自定义画面 ⇒ 404 空态（不回落任何猜图来源）',
    firstRes.__state.status === 404,
    'status=' + firstRes.__state.status + ' ' + firstRes.__state.body.length + 'B');
  {
    let err = null;
    try { err = JSON.parse(firstRes.__state.body.toString('utf8')).error; } catch { /* 非 JSON */ }
    check('空态给出可判定原因（no-frame）', err === 'no-frame', String(err));
  }
  // cache file written under the plugin data dir (env-overridden for tests)
  const cacheDir = TEST_FRAMES_DIR;
  // 缓存键版本从源码读（别写死：升版本时这里会静默测到旧文件，等于假通过）
  const keyVersion = (/LIVE_FRAME_KEY_VERSION = '([^']+)'/.exec(
    readFileSync(resolve(root, 'lib', 'index.js'), 'utf8')) || [])[1] || 'sf';
  // 只比较**本次请求前后**的差集：目录里可能有历史运行的残留（旧语义留下的静态帧），
  // 拿"目录为空"当判据会被那些残留绊倒。
  const addedNow = (existsSync(cacheDir) ? readdirSync(cacheDir) : []).filter((f) => !beforeList.includes(f));
  check('GET 空态不产出任何静态帧缓存（提取链已移除）', addedNow.length === 0,
    addedNow.slice(0, 4).join(', ') || '干净');

  // ── GPU 抓帧回填端点（HEAD 探测 + PUT 写入 + 唯一性/结构校验 + 清除通道）──
  // 槽位此刻是**空的**（上面的 GET 返回 404 —— 既无抓帧也无自定义画面）⇒ PUT 应能写入。
  const gpuRoute = routes.find((r) => r.path === '/wallpaper-engine/scene-frame-cache');
  check('scene-frame-cache route registered', Boolean(gpuRoute), gpuRoute ? 'kind=' + gpuRoute.kind : 'missing');
  // 结构合法的 PNG 构造器：签名 + IHDR + IDAT + IEND（host 只做结构校验，不解码）。
  const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const pngChunk = (type, payload) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(payload.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), payload]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdrFor = (w, h) => {
    const b = Buffer.alloc(13);
    b.writeUInt32BE(w, 0); b.writeUInt32BE(h, 4); b[8] = 8; b[9] = 2;
    return b;
  };
  const pngHeadFor = (w, h) => Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdrFor(w, h)),
  ]);
  const pngTail = pngChunk('IEND', Buffer.alloc(0));
  const makePng = (payloadBytes, fill = 7, size = [64, 64]) =>
    Buffer.concat([pngHeadFor(size[0], size[1]), pngChunk('IDAT', Buffer.alloc(payloadBytes, fill)), pngTail]);
  const gpuPng = makePng(4096);
  const runPut = async (url, body) => {
    const req = new Readable({ read() {} });
    req.url = url; req.method = 'PUT'; req.headers = { 'content-type': 'image/png' };
    const res = fakeRes();
    gpuRoute.handler(req, res);
    req.push(body); req.push(null);
    await new Promise((resolveFn) => {
      const t = setTimeout(resolveFn, 8000);
      res.on('finish', () => { clearTimeout(t); resolveFn(); });
      if (res.__state.ended) { clearTimeout(t); resolveFn(); }
    });
    return res;
  };
  const runClear = async (url, method = 'DELETE') => {
    const req = { url, headers: {}, method };
    const res = fakeRes();
    gpuRoute.handler(req, res);
    await new Promise((r) => setTimeout(r, 20));
    return res;
  };
  const runHead = async (url) => {
    const req = { url, headers: {}, method: 'HEAD' };
    const res = fakeRes();
    const done = sceneRoute.handler(req, res);
    if (done && typeof done.then === 'function') await done;
    return res;
  };
  if (gpuRoute) {
    // 精确匹配本次运行的 key（含 fixture mtime）—— 目录里可能有历史运行
    // 残留的其它 key 文件，不算失败。版本取自上面从源码读出的 keyVersion，
    // 写死字面量会在宿主升键后静默测到旧文件（第 514 行的注释即此意）。
    const curKey = keyVersion + '_' + token + '_' + Math.round(statSync(join(fixtureItemDir, 'scene.pkg')).mtimeMs);
    const head0 = await runHead('/wallpaper-engine/scene-frame/' + token);
    check('HEAD 空槽（无抓帧、无自定义画面）→ 404 且不发 X-WE-GPU',
      head0.__state.status === 404 && head0.__state.headers['X-WE-GPU'] === undefined,
      'status=' + head0.__state.status + ' gpu=' + String(head0.__state.headers['X-WE-GPU']));
    // 结构校验：只有魔数的 9 字节 / 有魔数无 IHDR-IEND / 结构合法但过短 → 全 415。
    const putMagicOnly = await runPut('/wallpaper-engine/scene-frame-cache/' + token,
      Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from([1])]));
    check('PUT 9 字节假 PNG → 415（不再永久占槽）', putMagicOnly.__state.status === 415, 'status=' + putMagicOnly.__state.status);
    const putNoChunks = await runPut('/wallpaper-engine/scene-frame-cache/' + token,
      Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(4096, 7)]));
    check('PUT 魔数正确但无 IHDR/IEND → 415', putNoChunks.__state.status === 415, 'status=' + putNoChunks.__state.status);
    const putTooSmall = await runPut('/wallpaper-engine/scene-frame-cache/' + token, makePng(10));
    check('PUT 结构合法但过小（< 1KB 地板）→ 415', putTooSmall.__state.status === 415, 'status=' + putTooSmall.__state.status);
    check('以上三次拒绝都没有落盘', !existsSync(join(cacheDir, curKey + '_gpu.png')), 'ok');
    const put1 = await runPut('/wallpaper-engine/scene-frame-cache/' + token, gpuPng);
    check('PUT 合法 PNG → 200', put1.__state.status === 200, 'status=' + put1.__state.status);
    const gpuFiles = readdirSync(cacheDir).filter((f) => f === curKey + '_gpu.png');
    check('GPU frame stored as <key>_gpu.png (文件名即标记，可直接打开)',
      gpuFiles.length === 1, gpuFiles.join(', ') || 'missing');
    // v=4（强制自定义画面）：**豁免** GPU 抓帧 —— 用户显式 pin 的来源不被一张抓帧顶掉（§6.2/§6.7）。
    const getV4 = await runHandler(sceneRoute, '/wallpaper-engine/scene-frame/' + token + '?v=4');
    check('?v=4 无自定义画面 ⇒ 422（显式 pin 失效要明示，客户端据此提示"已失效"）',
      getV4.__state.status === 422, 'status=' + getV4.__state.status);
    const headV4 = await runHead('/wallpaper-engine/scene-frame/' + token + '?v=4');
    check('?v=4 豁免抓帧：即使槽位已有 _gpu.png，v=4 也不拿它顶（HEAD 仍 404）',
      headV4.__state.status === 404, 'status=' + headV4.__state.status);
    const head1 = await runHead('/wallpaper-engine/scene-frame/' + token);
    check('HEAD after PUT → X-WE-GPU=1', head1.__state.status === 204 && head1.__state.headers['X-WE-GPU'] === '1',
      'status=' + head1.__state.status + ' gpu=' + head1.__state.headers['X-WE-GPU']);
    const getGpu = await runHandler(sceneRoute, '/wallpaper-engine/scene-frame/' + token);
    check('GET now serves the GPU-captured bytes', getGpu.__state.status === 200 && getGpu.__state.body.equals(gpuPng),
      getGpu.__state.body.length + 'B');
    const getGpuV3 = await runHandler(sceneRoute, '/wallpaper-engine/scene-frame/' + token + '?v=3');
    check('?v=3 已退役 ⇒ clamp 到 0 ⇒ 仍服务抓帧（值域收缩、零迁移）',
      getGpuV3.__state.status === 200 && getGpuV3.__state.body.equals(gpuPng),
      getGpuV3.__state.body.length + 'B');
    const headV3 = await runHead('/wallpaper-engine/scene-frame/' + token + '?v=3');
    check('HEAD ?v=3 → X-WE-GPU=1', headV3.__state.status === 204 && headV3.__state.headers['X-WE-GPU'] === '1',
      'status=' + headV3.__state.status + ' gpu=' + headV3.__state.headers['X-WE-GPU']);
    const put2 = await runPut('/wallpaper-engine/scene-frame-cache/' + token, gpuPng);
    check('second PUT rejected → 409 (每壁纸一份)', put2.__state.status === 409, 'status=' + put2.__state.status);
    // 并发写入（TOCTOU 的真复现装置）：同 key 串行 → 恰好一 200 一 409。
    await runClear('/wallpaper-engine/scene-frame-cache/' + token);
    const raced = await Promise.all([
      runPut('/wallpaper-engine/scene-frame-cache/' + token, makePng(4096, 1)),
      runPut('/wallpaper-engine/scene-frame-cache/' + token, makePng(4096, 2)),
      runPut('/wallpaper-engine/scene-frame-cache/' + token, makePng(4096, 3)),
    ]);
    const codes = raced.map((r) => r.__state.status).sort().join(',');
    check('三个并发 PUT 只有一个成功（唯一性闸串行化）', codes === '200,409,409', 'codes=' + codes);
    const survivor = readdirSync(cacheDir).filter((f) => f === curKey + '_gpu.png').length;
    check('并发后磁盘上仍只有一份 GPU 帧', survivor === 1, 'count=' + survivor);
    const noTmpLeft = readdirSync(cacheDir).filter((f) => f.startsWith(curKey + '_gpu.png.tmp')).length;
    check('并发写入未残留 .tmp 垃圾', noTmpLeft === 0, 'tmp=' + noTmpLeft);
    // 清除通道：DELETE（以及 POST ?clear=1）→ 可重新抓取。
    const clr = await runClear('/wallpaper-engine/scene-frame-cache/' + token);
    check('DELETE 清除 GPU 帧 → 200 + removed=true',
      clr.__state.status === 200 && /"removed":true/.test(String(clr.__state.body)), 'status=' + clr.__state.status);
    const clr2 = await runClear('/wallpaper-engine/scene-frame-cache/' + token, 'POST');
    check('POST 无 clear 参数 → 405（不误触发清除）', clr2.__state.status === 405, 'status=' + clr2.__state.status);
    const clr3 = await runClear('/wallpaper-engine/scene-frame-cache/' + token + '?clear=1', 'POST');
    check('POST ?clear=1 清除路径 → 200',
      clr3.__state.status === 200 && /"removed":false/.test(String(clr3.__state.body)), 'status=' + clr3.__state.status);
    const headAfterClear = await runHead('/wallpaper-engine/scene-frame/' + token);
    check('清除抓帧后 HEAD → 404（没有 CPU 帧可回落 —— 这正是"诚实留空"）',
      headAfterClear.__state.status === 404 && headAfterClear.__state.headers['X-WE-GPU'] === undefined,
      'status=' + headAfterClear.__state.status);
    const put3 = await runPut('/wallpaper-engine/scene-frame-cache/' + token, gpuPng);
    check('清除后可重新写入 → 200（坏帧不再是死结）', put3.__state.status === 200, 'status=' + put3.__state.status);
    // ── 抓帧几何随 HEAD 暴露（客户端据此判断存帧是否还是当前视口的构图）────
    // _gpu.png 是抓帧那一刻渲染页视口的构图（渲染器按画布比取景），别的窗口/
    // 旧会话留下的帧拿到当前窗口上屏会被 CSS object-fit: cover 再裁一次 = 画面
    // 放大且四周被切。IHDR 的宽高比就是抓帧画布的设备像素比 → 直接读文件头即可。
    const headGeo64 = await runHead('/wallpaper-engine/scene-frame/' + token);
    check('HEAD 报出抓帧几何（X-WE-GPU-W/H/AR，来自 PNG IHDR）',
      headGeo64.__state.headers['X-WE-GPU-AR'] === '1.0000'
      && headGeo64.__state.headers['X-WE-GPU-W'] === '64' && headGeo64.__state.headers['X-WE-GPU-H'] === '64',
      'ar=' + headGeo64.__state.headers['X-WE-GPU-AR']
      + ' wh=' + headGeo64.__state.headers['X-WE-GPU-W'] + 'x' + headGeo64.__state.headers['X-WE-GPU-H']);
    await runClear('/wallpaper-engine/scene-frame-cache/' + token);
    const putWide = await runPut('/wallpaper-engine/scene-frame-cache/' + token, makePng(4096, 7, [1440, 960]));
    check('PUT 3:2 抓帧（1440x960）→ 200', putWide.__state.status === 200, 'status=' + putWide.__state.status);
    const headGeoWide = await runHead('/wallpaper-engine/scene-frame/' + token);
    check('HEAD 报出 3:2 抓帧几何（1.5000 → 客户端判「与 16:9 视口不符」→ 重抓）',
      headGeoWide.__state.status === 204 && headGeoWide.__state.headers['X-WE-GPU-AR'] === '1.5000',
      'ar=' + headGeoWide.__state.headers['X-WE-GPU-AR']);
    const headGeoNoGpu = await (async () => {
      await runClear('/wallpaper-engine/scene-frame-cache/' + token);
      return runHead('/wallpaper-engine/scene-frame/' + token);
    })();
    check('无帧（既无抓帧也无自定义画面）⇒ 404 且不发任何几何头',
      headGeoNoGpu.__state.status === 404
      && headGeoNoGpu.__state.headers['X-WE-GPU'] === undefined
      && headGeoNoGpu.__state.headers['X-WE-GPU-AR'] === undefined,
      'status=' + headGeoNoGpu.__state.status + ' gpu=' + String(headGeoNoGpu.__state.headers['X-WE-GPU']));
    await runPut('/wallpaper-engine/scene-frame-cache/' + token, gpuPng); // 还原槽位状态
    // ── P2-L：unlink 失败（权限/占用）必须报错 ────────────────────────────
    // 回 200 + removed:false 会让客户端把「清除」当成功（面板行消失、提示已清除），
    // 而宿主照旧发 GPU 帧 —— 画面纹丝不动且没有任何反馈。ENOENT 仍算幂等成功。
    {
      // ⚠️ 平台前提：**POSIX 的 chmod 才能阻止 unlink**；Windows 上 chmod 不影响删除
      //（模式位基本被忽略）⇒ 该用例在 win32 上无法成立。改法：win32 只断言仍然中立的那半
      //（ENOENT 幂等成功），并在下面明确标注 coverage 差异，而不是让 5 条断言假失败。
      if (process.platform === 'win32') {
        const first = await runClear('/wallpaper-engine/scene-frame-cache/' + token);
        check('win32：清除存在的槽位 ⇒ 200 + removed:true（删除确实生效）',
          first && first.__state.status === 200 && /"removed":true/.test(String(first.__state.body)),
          'status=' + (first && first.__state.status) + ' body=' + String(first && first.__state.body).slice(0, 70));
        const again = await runClear('/wallpaper-engine/scene-frame-cache/' + token);
        check('win32：重复清除 ⇒ 幂等成功（200 + removed:false，不得假报已删除）',
          again && again.__state.status === 200 && /"removed":false/.test(String(again.__state.body)),
          'status=' + (again && again.__state.status) + ' body=' + String(again && again.__state.body).slice(0, 70));
        platformSkip('unlink 失败场景（chmod 不影响 unlink ⇒ 前提在 Windows 不成立；见 TODO §9.3）',
          'POSIX 才有牙的那一半本平台不执行');
        await runPut('/wallpaper-engine/scene-frame-cache/' + token, gpuPng); // 还原槽位
      } else {
      const mode = statSync(cacheDir).mode & 0o777;
      chmodSync(cacheDir, 0o555); // 目录不可写 → unlinkSync EACCES
      let locked = null;
      try {
        locked = await runClear('/wallpaper-engine/scene-frame-cache/' + token);
      } finally {
        chmodSync(cacheDir, mode); // 立刻恢复，后续用例照常
      }
      check('unlink 失败 → 500（不得假成功）',
        locked && locked.__state.status === 500 && /unlink-failed/.test(String(locked.__state.body)),
        'status=' + (locked && locked.__state.status) + ' body=' + String(locked && locked.__state.body).slice(0, 90));
      check('unlink 失败后 GPU 帧仍在盘上（清除确实没发生）',
        readdirSync(cacheDir).filter((f) => f === curKey + '_gpu.png').length === 1);
      const headLocked = await runHead('/wallpaper-engine/scene-frame/' + token);
      check('unlink 失败后 HEAD 仍报 X-WE-GPU=1（与客户端所见一致）',
        headLocked.__state.status === 204 && headLocked.__state.headers['X-WE-GPU'] === '1',
        'gpu=' + headLocked.__state.headers['X-WE-GPU']);
      const afterUnlock = await runClear('/wallpaper-engine/scene-frame-cache/' + token);
      check('恢复可写后重试清除 → 200 + removed=true（失败不是死结）',
        afterUnlock.__state.status === 200 && /"removed":true/.test(String(afterUnlock.__state.body)),
        'status=' + afterUnlock.__state.status);
      }
    }
    const putBad = await runPut('/wallpaper-engine/scene-frame-cache/' + token, Buffer.from('not-an-image'));
    check('PUT bad magic → 415', putBad.__state.status === 415, 'status=' + putBad.__state.status);
    const putUnknown = await runPut('/wallpaper-engine/scene-frame-cache/not-a-real-token', gpuPng);
    check('PUT unknown token → 404', putUnknown.__state.status === 404, 'status=' + putUnknown.__state.status);
    const headUnknown = await runHead('/wallpaper-engine/scene-frame/not-a-real-token');
    check('HEAD unknown token → 404', headUnknown.__state.status === 404, 'status=' + headUnknown.__state.status);
    // HEAD 契约：空槽 → 404，且纯探测绝不写盘。
    await runClear('/wallpaper-engine/scene-frame-cache/' + token);
    for (const ext of ['png', 'jpg', 'gif']) { rmSync(join(cacheDir, curKey + '.' + ext), { force: true }); }
    const before = readdirSync(cacheDir).length;
    const headEmpty = await runHead('/wallpaper-engine/scene-frame/' + token);
    check('HEAD 空槽 → 404（纯探测不触发提取）', headEmpty.__state.status === 404, 'status=' + headEmpty.__state.status);
    check('HEAD 空槽未写盘（文件数不变）', readdirSync(cacheDir).length === before,
      before + ' → ' + readdirSync(cacheDir).length);
  }
}

// C: error paths
{
  const res = await runHandler(sceneRoute, '/wallpaper-engine/scene-frame/not-a-real-token');
  check('unknown token → 404', res.__state.status === 404, 'status=' + res.__state.status);
}

// 帧上限从源码解析（别写死：上限一改，超限用例会静默测到旧尺寸 = 假通过）
const frameLimit = (() => {
  const expr = (/const GPU_FRAME_MAX_BYTES = ([^;]+);/.exec(
    readFileSync(resolve(root, 'lib', 'index.js'), 'utf8')) || [])[1] || '';
  return /^[\d\s*+()]+$/.test(expr) ? Number(new Function('return (' + expr + ')')()) : 0;
})();
check('帧上限常量可从源码解析（超限块尺寸不写死）', frameLimit > 0, 'GPU_FRAME_MAX_BYTES = ' + frameLimit);

// D: 真 socket 端到端 —— 错误应答必须真的送到客户端。
// mock res 无法暴露「res.end() 后立刻 req.destroy() 会丢掉写缓冲」这类问题
//（33MB 超限请求在这种写法下客户端只拿到 ECONNRESET 而不是 413），所以这里起
// 一个真 http server，按框架语义（最长前缀优先）分发到同一个 handler。
if (token) {
  const http = await import('node:http');
  const routesForHttp = routes.filter((r) => r.path.startsWith('/wallpaper-engine/'));
  const server = http.createServer((req, res) => {
    const path = new URL(req.url || '/', 'http://x').pathname;
    const hit = routesForHttp
      .filter((r) => path === r.path || path.startsWith(r.path + '/'))
      .sort((a, b) => b.path.length - a.path.length)[0];
    if (!hit) { res.statusCode = 404; res.end('no route'); return; }
    try { hit.handler(req, res); } catch (err) { res.statusCode = 500; res.end(String(err)); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  // 结果里带上**是哪个信号先到**（`res end` / `res close` / `req error`）与响应状态码：
  // 偶发 `status=0` 时，这一条决定了"是服务端没送到"还是"客户端侧先报错、但 413 其实收到了"
  // —— 不写清就没法定位（本仓规矩：拿到断言原文再查实现）。
  const sendOver = (method, path, body) => new Promise((resolveFn) => {
    const seen = [];
    let settled = false;
    const done = (status, why) => {
      if (settled) return;
      settled = true;
      resolveFn({ status, why, seen: seen.join('>') });
    };
    // agent:false + Connection:close —— 413 路径会主动断开连接（设计如此），
    // 复用 keep-alive 套接字会让后续请求假性 ECONNRESET。
    const req = http.request({
      host: '127.0.0.1', port, method, path, agent: false,
      headers: { 'Content-Type': 'image/png', Connection: 'close' },
    }, (res) => {
      res.resume();
      res.on('end', () => { seen.push('end:' + res.statusCode); done(res.statusCode, 'res-end'); });
      res.on('close', () => { seen.push('close:' + res.statusCode); done(res.statusCode, 'res-close'); });
      res.on('aborted', () => seen.push('aborted'));
    });
    // 连接被对端掐断 → 状态记 0，便于断言区分。
    req.on('error', (e) => { seen.push('error:' + (e && e.code)); done(0, 'req-error:' + (e && e.code)); });
    if (body) req.write(body);
    req.end();
  });
  const overLimit = await sendOver('PUT', '/wallpaper-engine/scene-frame-cache/' + token, Buffer.alloc(33 * 1024 * 1024, 5));
  // ⚠️ 33MB 这一条**天生不确定**（账本 P3-22）：413 路径会 `res.end()` 后立刻 `req.destroy()`（设计如此），
  // 而 33MB 请求体远没写完 ⇒ 客户端可能先拿到 ECONNRESET 而不是 413。两种结果**都是"被拒绝"**，
  // 区别只是谁先到。所以这里接受两种合法结果，把"没被拒绝"（200 / 5xx）判红；
  // **精确的 413 语义由下一条（恰好 limit+1，超限块即最后一块、无竞态）钉住**。
  // 判据仍有牙：服务端若不拒绝，这里拿到的是 200 而不是 0。
  check('真 socket：超限 PUT 被拒绝（413，或连接被主动掐断 —— 精确 413 见下一条）',
    overLimit.status === 413 || overLimit.status === 0,
    'status=' + overLimit.status + ' why=' + overLimit.why + ' seen=' + overLimit.seen);
  // 恰好 limit+1：超限块**就是最后一块**（实测 64KB 分块下 513 块里的第 513 块）——
  // 33MB 那个用例比上限多 1MB，超限块离正文结尾还有约 1MB，缝碰不到。
  const exactLimit = await sendOver('PUT', '/wallpaper-engine/scene-frame-cache/' + token,
    Buffer.alloc(frameLimit + 1, 6));
  check('真 socket：恰好 limit+1（超限块即最后一块）仍收到 413',
    exactLimit.status === 413, 'status=' + exactLimit.status);
  const badBody = await sendOver('PUT', '/wallpaper-engine/scene-frame-cache/' + token, Buffer.from('not-an-image'));
  check('真 socket：非法载荷收到 415', badBody.status === 415, 'status=' + badBody.status);
  const cleared = await sendOver('DELETE', '/wallpaper-engine/scene-frame-cache/' + token);
  check('真 socket：DELETE 清除通道可达', cleared.status === 200, 'status=' + cleared.status);
  const headOver = await new Promise((resolveFn) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'HEAD', path: '/wallpaper-engine/scene-frame/' + token }, (res) => {
      res.resume();
      resolveFn({ status: res.statusCode, gpu: res.headers['x-we-gpu'] });
    });
    req.on('error', () => resolveFn({ status: 0 }));
    req.end();
  });
  check('真 socket：HEAD 探测可达且报 X-WE-GPU', headOver.status === 204 || headOver.status === 404,
    'status=' + headOver.status + ' gpu=' + headOver.gpu);
  await new Promise((r) => server.close(r));
}

// ── Level B2: 用户图片资产路由（会话头像 + 吉祥物立绘；真 socket + 隔离的数据目录）──
// 这两族是用户资产的第三条腿（前两条：上传壁纸 / 自定义画面）：POST 导入（raw body，
// MIME 白名单）/ GET·HEAD 查看 / DELETE 清除。头像按"一方一张"（user / ai），立绘**只有
// 一张**（再导入即覆盖 —— 用户口径）。它俩在真机上踩过同一个坑：**宿主没重挂时** POST
// 会落到 SPA 兜底、拿到一个裸 405（客户端为此把"宿主里没有这条路由"翻译成"重启 DSH"）。
//
// ⚠️ 两边都必须隔离：
//   · 数据目录：`avatarDir()` = `pluginDataDir()/avatars`，而 `pluginDataDir()` 认
//     `DSH_WE_DATA_DIR` ⇒ 指到工作区里的临时目录。**不许落到真实的 ~/.dsh-wallpaper-engine**
//     —— 路由会清"同一方的旧文件"，指错等于把用户的头像删掉。
//   · 清理：用例自己删掉整个临时目录（含正式文件与 .tmp）。
{
  const http = await import('node:http');
  const dataDir = join(root, '.test-cache', 'avatar-route-data');
  rmSync(dataDir, { recursive: true, force: true });
  const PREV_DATA_DIR = process.env.DSH_WE_DATA_DIR;
  process.env.DSH_WE_DATA_DIR = dataDir;
  const routesForHttp = routes.filter((r) => r.path.startsWith('/wallpaper-engine/'));
  const server = http.createServer((req, res) => {
    const path = new URL(req.url || '/', 'http://x').pathname;
    const hit = routesForHttp
      .filter((r) => path === r.path || path.startsWith(r.path + '/'))
      .sort((a, b) => b.path.length - a.path.length)[0];
    if (!hit) { res.statusCode = 404; res.end('no route'); return; }
    try { hit.handler(req, res); } catch (err) { res.statusCode = 500; res.end(String(err)); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const call = (method, path, headers, body) => new Promise((resolveFn) => {
    const chunks = [];
    const req = http.request({ host: '127.0.0.1', port, method, path, agent: false, headers: headers || {} }, (res) => {
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolveFn({ status: res.statusCode, headers: res.headers, buf, body: buf.toString('utf8') });
      });
    });
    req.on('error', () => resolveFn({ status: 0, headers: {}, body: '' }));
    if (body) req.write(body);
    req.end();
  });
  try {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(24, 7)]);
    const empty = await call('GET', '/wallpaper-engine/avatar/user');
    check('头像：未导入 ⇒ GET 404（且 no-store，导入后不会再看到这个 404）',
      empty.status === 404 && empty.headers['cache-control'] === 'no-store',
      'status=' + empty.status + ' cc=' + empty.headers['cache-control']);
    const badSide = await call('POST', '/wallpaper-engine/avatar/nope', { 'Content-Type': 'image/png' }, png);
    check('头像：非法的一方 ⇒ 400（路径段当白名单查，不拼进文件名）',
      badSide.status === 400 && /bad-side/.test(badSide.body), 'status=' + badSide.status);
    const badType = await call('POST', '/wallpaper-engine/avatar/user', { 'Content-Type': 'text/plain' }, 'hi');
    check('头像：非白名单 MIME ⇒ 415', badType.status === 415, 'status=' + badType.status);
    const first = await call('POST', '/wallpaper-engine/avatar/user', { 'Content-Type': 'image/png' }, png);
    const firstName = (/"name":"([^"]+)"/.exec(first.body) || [])[1] || '';
    check('头像：导入 ⇒ 200 + 文件名（<side>-<stamp>.<ext>，它同时是缓存键）',
      first.status === 200 && /^user-[a-z0-9]{4,16}\.png$/.test(firstName),
      'status=' + first.status + ' name=' + firstName);
    const got = await call('GET', '/wallpaper-engine/avatar/user');
    check('头像：查看 ⇒ 200 + 字节一致 + 长缓存（由文件名担保）',
      got.status === 200 && got.headers['content-type'] === 'image/png'
      && got.buf.length === png.length && got.buf.equals(png)
      && /max-age=31536000/.test(String(got.headers['cache-control'])),
      'status=' + got.status + ' bytes=' + got.buf.length + '/' + png.length
      + ' cc=' + got.headers['cache-control']);
    const head = await call('HEAD', '/wallpaper-engine/avatar/user');
    check('头像：HEAD 只探测（200，无体）', head.status === 200 && head.body === '',
      'status=' + head.status);
    // 换图 ⇒ 同 side 的旧文件必须清掉（读取侧按前缀取第一个命中的），且新旧字节不同。
    const png2 = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(32, 9)]);
    const second = await call('POST', '/wallpaper-engine/avatar/user', { 'Content-Type': 'image/png' }, png2);
    const secondName = (/"name":"([^"]+)"/.exec(second.body) || [])[1] || '';
    const files = readdirSync(join(dataDir, 'avatars')).filter((f) => f.startsWith('user-'));
    check('头像：换图 ⇒ 新名字 + 旧文件被清（同 side 目录里只剩一份）',
      second.status === 200 && secondName !== firstName && files.length === 1 && files[0] === secondName,
      'files=[' + files.join(',') + '] second=' + secondName);
    const cleared = await call('DELETE', '/wallpaper-engine/avatar/user');
    const afterClear = await call('GET', '/wallpaper-engine/avatar/user');
    check('头像：清除 ⇒ 200 removed:true，随后 GET 回到 404',
      cleared.status === 200 && /"removed":true/.test(cleared.body) && afterClear.status === 404,
      'status=' + cleared.status + ' then ' + afterClear.status);

    // ── 吉祥物立绘（同一族的第二条腿）：**只有一张**，导入即覆盖（用户口径）──
    const mEmpty = await call('GET', '/wallpaper-engine/mascot');
    check('立绘：未导入 ⇒ GET 404（路由不带 side，整族只有一张）',
      mEmpty.status === 404 && mEmpty.headers['cache-control'] === 'no-store',
      'status=' + mEmpty.status);
    const mBad = await call('POST', '/wallpaper-engine/mascot', { 'Content-Type': 'image/gif' }, png);
    check('立绘：非白名单 MIME ⇒ 415', mBad.status === 415, 'status=' + mBad.status);
    const m1 = await call('POST', '/wallpaper-engine/mascot', { 'Content-Type': 'image/png' }, png);
    const m1Name = (/"name":"([^"]+)"/.exec(m1.body) || [])[1] || '';
    check('立绘：导入 ⇒ 200 + 文件名（mascot-<stamp>.<ext>）',
      m1.status === 200 && /^mascot-[a-z0-9]{4,16}\.png$/.test(m1Name),
      'status=' + m1.status + ' name=' + m1Name);
    const mGot = await call('GET', '/wallpaper-engine/mascot');
    check('立绘：查看 ⇒ 200 + 字节一致 + 长缓存',
      mGot.status === 200 && mGot.buf.equals(png) && /max-age=31536000/.test(String(mGot.headers['cache-control'])),
      'status=' + mGot.status + ' bytes=' + mGot.buf.length + '/' + png.length);
    // **覆盖**：再导入一次 ⇒ 新名字 + 目录里只剩这一张（旧的正式文件被清掉）。
    const m2 = await call('POST', '/wallpaper-engine/mascot', { 'Content-Type': 'image/png' }, png2);
    const m2Name = (/"name":"([^"]+)"/.exec(m2.body) || [])[1] || '';
    const mFiles = readdirSync(join(dataDir, 'mascot')).filter((f) => f.startsWith('mascot-'));
    check('立绘：再导入 ⇒ 覆盖（新名字 + 目录里只剩一张，旧文件被清）',
      m2.status === 200 && m2Name !== m1Name && mFiles.length === 1 && mFiles[0] === m2Name,
      'files=[' + mFiles.join(',') + '] second=' + m2Name);
    const mClear = await call('DELETE', '/wallpaper-engine/mascot');
    const mAfter = await call('GET', '/wallpaper-engine/mascot');
    check('立绘：清除 ⇒ 200 removed:true，随后 GET 回到 404',
      mClear.status === 200 && /"removed":true/.test(mClear.body) && mAfter.status === 404,
      'status=' + mClear.status + ' then ' + mAfter.status);
  } finally {
    await new Promise((r) => server.close(r));
    if (PREV_DATA_DIR === undefined) delete process.env.DSH_WE_DATA_DIR; else process.env.DSH_WE_DATA_DIR = PREV_DATA_DIR;
    rmSync(dataDir, { recursive: true, force: true });
  }
}
// ── Level D2: 中途放弃请求的断开时机（确定性；真 socket 上只能碰运气）──────
// 真 socket 用例是**竞态**断言：断开早于应答刷出才失败，而那一刻取决于背压与
// 事件循环负载。这里用替身把时序钉死，判据是**顺序**，对每条"收到一半就放弃"的
// 路由都一样：
//   应答先写 → 请求体排空（req 'end'）→ 应答真刷完（res 'finish'）→ 才允许 req.destroy()。
// 语义依据（可复算）：`res.writableEnded` 在 res.end() 一调即为真，**不代表已刷出**；
// 代表刷出的是 `writableFinished`（'finish' 已发出）。替身的 fidelity 由负对照钉住。
//
// ⚠️ `/upload` 与 `/custom-frame` 不在此表内：前者的上限是 512MB（行为级触发要一次性
//    写出 512MB+1），后者会在**真实**的用户 overrides 目录里删同名兄弟文件。两者的
//    接线由下面的 Level D3 结构棘轮覆盖。
{
  const hostSrc = readHostHalf();
  // 上限一律按**源码原文**解析/核对（不写死尺寸：上限一改，这里会红而不是静默测旧值）
  const constNum = (name) => {
    const expr = (new RegExp('const ' + name + ' = ([^;]+);').exec(hostSrc) || [])[1] || '';
    return /^[\d\s*+()]+$/.test(expr) ? Number(new Function('return (' + expr + ')')()) : 0;
  };
  // `needle` 钉的是"这条路由的上限**在哪**"。P4-13 把 8 条收 body 管道收敛进了
  // `lib/http-body.js`，上限表达式随之从内联回调里的 `size > X` 变成调用点的 `maxBytes: X`
  // —— 判据跟着**改指同一个事实**（这条路由的上限就是这个常量），不是放宽。
  const ABORT_CASES = [
    { label: 'scene-frame-cache PUT', route: '/wallpaper-engine/scene-frame-cache', method: 'PUT',
      cap: constNum('GPU_FRAME_MAX_BYTES'), needle: 'maxBytes: GPU_FRAME_MAX_BYTES',
      headers: { 'content-type': 'image/png' } },
    { label: 'live-frame POST', route: '/wallpaper-engine/live-frame', method: 'POST',
      cap: constNum('LIVE_FRAME_MAX_BYTES') || 4 * 1024 * 1024, needle: 'maxBytes: 4 * 1024 * 1024',
      headers: { 'content-type': 'image/png' } },
    { label: 'settings PUT', route: '/wallpaper-engine/settings', method: 'PUT',
      cap: constNum('SETTINGS_MAX_BYTES'), needle: 'maxBytes: SETTINGS_MAX_BYTES',
      headers: { 'content-type': 'application/json' } },
  ];
  // ServerResponse 的刷出语义：end() 只把 writableEnded 置真，'finish' 要等真正 flush。
  const mkFlushableRes = () => {
    const res = new EventEmitter();
    const state = { status: 0, body: null, headers: {} };
    let pendingFlush = null;
    res.setHeader = (k, v) => { state.headers[k] = v; };
    res.writeHead = (s, h) => { state.status = s; Object.assign(state.headers, h || {}); };
    Object.defineProperty(res, 'statusCode', { get: () => state.status, set: (v) => { state.status = v; } });
    res.writableEnded = false;
    res.writableFinished = false;
    res.end = (b) => {
      if (b !== undefined) state.body = Buffer.isBuffer(b) ? b : Buffer.from(String(b));
      res.writableEnded = true;
      pendingFlush = () => { res.writableFinished = true; res.emit('finish'); };
    };
    res.__flush = () => { if (pendingFlush) pendingFlush(); };
    res.__state = state;
    return res;
  };
  check('负对照：替身区分「end() 已调用」与「应答已刷完」',
    (() => { const r = mkFlushableRes(); r.end('x'); return r.writableEnded === true && r.writableFinished === false; })());
  // 忠实的 IncomingMessage 替身：`end` 一发出 ⇒ `readableEnded`/`complete` 为真；
  // `close` 在 Node ≥16 也表示**请求已完成** ⇒ 同样置 complete。不模拟这两点，
  // 下面"请求体读完"的判据就成了摆设。
  const mkOrderReq = (c) => {
    const req = new EventEmitter();
    req.url = c.route + '/' + token;
    req.method = c.method;
    req.headers = c.headers || {};
    req.readableEnded = false;
    req.complete = false;
    req.destroyed = false;
    req.destroy = () => { req.destroyed = true; };
    req.resume = () => {};
    req.pause = () => {};
    req.setTimeout = () => req;
    const rawEmit = req.emit.bind(req);
    req.emit = (ev, ...args) => {
      if (ev === 'end' || ev === 'close') { req.readableEnded = true; req.complete = true; }
      return rawEmit(ev, ...args);
    };
    return req;
  };
  for (const c of ABORT_CASES) {
    const route = routes.find((r) => r.path === c.route);
    check(`${c.label}：路由在位且源码里的体积判定与用例一致`,
      Boolean(route) && hostSrc.includes(c.needle), c.needle);
    if (!route || !(c.cap > 0) || !token) continue;
    const req = mkOrderReq(c);
    const res = mkFlushableRes();
    route.handler(req, res);
    req.emit('data', Buffer.alloc(c.cap + 1, 7)); // 超限块**恰好是最后一块**
    check(`${c.label}：超限时应答为 413`, res.__state.status === 413, 'status=' + res.__state.status);
    // ① 应答已刷完，但**请求体还没读完** ⇒ 不得断开（带着未读入站数据关闭会 RST）。
    //    这是"小应答先刷完"的常态：413 只有几十字节，而请求体还剩很多。
    res.__flush();
    check(`${c.label}：应答已刷完但请求体未读完 ⇒ 不得断开`, req.destroyed === false,
      'destroyed=' + req.destroyed);
    // ② 请求体读完（req 'end'）——**两条件齐了**才允许断开。
    req.emit('end');
    check(`${c.label}：两条件齐了才断开（不留悬挂连接）`, req.destroyed === true,
      'destroyed=' + req.destroyed);
    // ③ `req 'close'` 先于应答刷出 ⇒ 同样不许断：在这条路径上直接 destroy
    //    会丢掉那一次 413。
    const req2 = mkOrderReq(c);
    const res2 = mkFlushableRes();
    route.handler(req2, res2);
    req2.emit('data', Buffer.alloc(c.cap + 1, 7));
    req2.emit('close'); // 请求完成，但应答还没刷出
    check(`${c.label}：req 'close' 早于应答刷出 ⇒ 不得断开`, req2.destroyed === false,
      'destroyed=' + req2.destroyed);
    res2.__flush();
    check(`${c.label}：应答刷完后才断开`, req2.destroyed === true, 'destroyed=' + req2.destroyed);
  }
}
// ── Level D3: 断开路径只有一处（结构棘轮）──────────────────────────────────
// "先写应答、再排空、等应答刷完才断"必须是**唯一**入口（lingerClose）。谁再写一次裸
// req.destroy()，计数立刻变红 —— 那是**有意的**棘轮：请把该路由接到 lingerClose 上。
// 覆盖 Level D2 因成本/副作用跑不了的两条：/upload（上限 512MB）与 /custom-frame
// （会在真实 overrides 目录里删同名兄弟文件）。
// 口径 = **宿主半的全部注册面**（`lib/index.js` + `lib/routes/*.js`）：把路由族拆出 `apply`
// 之后，判据只读一个文件会把"已搬走"误报成"少接了一条"（假红）。
{
  const src = readHostHalf();
  /** 判据只认代码：调用点沿用短名 `strip`。 */
  const strip = stripComments;
  /** 共享判据：阳性（宿主半全文）与阴性对照（合成样本）都走它。 */
  const bareDestroyCount = (t) => (t.match(/req\.destroy\(\)/g) || []).length;
  const bare = bareDestroyCount(strip(src));
  check('D3 全仓 req.destroy() 只允许两处收口（lingerClose / idle 兜底）', bare <= 2,
    '当前 ' + bare + ' 处');
  const calls = strip(src).match(/lingerClose\(/g) || [];
  check('D3 每条"收到一半就放弃"的路由都接了 lingerClose（当前 5 条：帧缓存 / 实时帧 / 自定义画面 / 上传 / 设置）',
    calls.length >= 6, '出现 ' + calls.length + ' 次（1 处定义 + 调用点）');
  check('负对照：裸 req.destroy() 计数判据有牙（同一函数吃合成样本 ⇒ 计数 1）',
    bareDestroyCount(strip("try { req.destroy(); } catch { /* ignore */ }")) === 1);
}
// ── Level E: 缓存键单一构造点（结构不变量）──────────────────────────────────
// 帧缓存键如果每个派生点各拼一遍字面量 ⇒ 升版本
// 只改一处就会让「写盘的产物」与「读取的路径」错位（症状：改了却没生效、
// 缓存永不命中、白烧 CPU）。这里把「每种缓存各只有一个派生点」钉死；
// 新增第 4 种缓存时本断言会红 —— 那是**有意的**棘轮，请连同这里一起改。
{
  // ⚠️ 读**宿主半**（`lib/index.js` + `lib/routes/*.js`）：场景视频那一份键派生点已随族
  //    搬进 `lib/routes/scene-media.js`。本判据守的是"每种缓存各只有一个派生点"这个
  //    **宿主级**不变量，不是"三个派生点都在主文件里"（本文件头 30–31 行的约定）。
  const hostSrc = readHostHalf();
  /** 共享判据：阳性（宿主半）与阴性对照（宿主半 + 一条合成派生）共用同一计数函数。 */
  const base64UrlDerivations = (t) => (t.match(/Buffer\.from\(abs, 'utf8'\)\.toString\('base64url'\)/g) || []).length;
  const derivations = base64UrlDerivations(hostSrc);
  /**
   * 取一个顶层函数的函数体：起点锚 `function <name>(`，终点锚 `function <nextName>(`。
   * ⚠️ 终点锚**必须真实存在，且缺锚要判红**（返回 null）：此处此前把终点写成
   * `sceneFrameSlotFile`（全仓不存在）⇒ `indexOf` 返回 −1 ⇒ `slice(start, −1)` 一直扫到
   * 文件末尾 —— 判据从"函数体内"退化成"文件余下所有内容"，却照样报绿。
   * 这正是 P3-16 那类"判据空转"的又一实例：**锚点漂了没人发现**。
   */
  const fnBody = (srcText, name, nextName) => {
    const start = srcText.indexOf('function ' + name + '(');
    const end = srcText.indexOf('function ' + nextName + '(');
    if (start === -1 || end === -1 || end <= start) return null;
    return srcText.slice(start, end);
  };
  const slotBody = fnBody(hostSrc, 'sceneFrameSlot', 'gpuFrameFileFor');
  check('判据锚点在位：sceneFrameSlot 的函数体取到了边界（缺锚即红，不许退化成扫全文）',
    slotBody !== null,
    slotBody ? 'len=' + slotBody.length : '锚点缺失（sceneFrameSlot / gpuFrameFileFor 改名了？）');
  check('负对照：终点锚缺失时 fnBody 返回 null（判据有牙，不会静默扫全文）',
    fnBody('function a() {}\n', 'a', 'doesNotExist') === null);
  check('P1-6 每种缓存各只有一个键派生点（当前 3 种：帧 / 场景音频 / 场景视频）',
    derivations === 3,
    '派生点 ' + derivations + ' 处');
  check('P1-6 sceneFrameSlot 复用 sceneFrameCacheKey 且不再自带版本前缀',
    slotBody !== null && slotBody.includes('sceneFrameCacheKey(abs, mtime)') && !slotBody.includes('LIVE_FRAME_KEY_VERSION'),
    'reuse=' + (slotBody !== null && slotBody.includes('sceneFrameCacheKey(abs, mtime)')) + ' versionInSlot=' + (slotBody !== null && slotBody.includes('LIVE_FRAME_KEY_VERSION')));
  check('P1-6 negative control: 再写一份派生会被同一计数判据数出来',
    base64UrlDerivations(hostSrc + "\nconst x = Buffer.from(abs, 'utf8').toString('base64url');") === derivations + 1);

  // ── 槽位只给唯一产物（反向探针：删掉的死字段不许爬回来）─────────────────────
  // `sceneFrameSlot` 曾返回 `pngPath` / `jpgPath` / `gifPath` / `dir` 与一个 `_vN` 档位后缀，
  // 而那些**都没有消费者**（静态帧提取线的遗留）；档位后缀还让"档 4"那次调用白做一次
  // `statSync` + `ensureFrameCacheDir()`。这条判据钉住"只有一个产物 + 档位语义不在槽位里"。
  const DEAD_SLOT_FIELDS = ['pngPath', 'jpgPath', 'gifPath', 'slot.dir'];
  const slotDeadHits = (srcText) => DEAD_SLOT_FIELDS.filter((f) => srcText.includes(f));
  // 扫描面 = lib/**（死字段若从别处爬回来同样要红）。
  // ⚠️ **先剥注释再判**（规则 ⑦，用共享的字符串感知实现）：解释"这些字段为什么被删"的注释
  // 必须能点名它们 —— 否则守卫会逼着后来人删掉那条解释，把"为什么"从代码里抹掉。
  const libSources = (() => {
    const out = [];
    (function walk(dir) {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
          if (/vendor|webwallgl/.test(e.name)) continue; // 第三方副本不归我们管
          walk(p);
        } else if (/\.(js|mjs)$/.test(e.name) && e.name !== 'client.js') {
          out.push(stripComments(readFileSync(p, 'utf8')));
        }
      }
    })(join(root, 'lib'));
    return out;
  })();
  check('P4-16 槽位的死字段（pngPath / jpgPath / gifPath / dir）在 lib/ 里零残留',
    slotDeadHits(libSources.join('\n')).length === 0,
    slotDeadHits(libSources.join('\n')).join(', ') || '零残留');
  check('P4-16 negative control: 死字段判据有牙',
    slotDeadHits('return { key, pngPath: join(dir, key + ".png") };').length === 1
    && slotDeadHits('return { key, gpuPath: join(dir, key + "_gpu.png") };').length === 0);
  /**
   * 取 `return { … }` 的对象字面量（花括号配对）；数它**顶层**的字段数。
   * 为什么要数而不是按名字判：`dir` 这种名字在本函数里**合法地**作为局部变量出现
   *（`const dir = ensureFrameCacheDir()`），所以"按名字禁 `dir`"是错的判据；
   * 而"返回里多了个字段"用**数量**判既准确又稳定（加一个就红）。
   */
  const returnLiteral = (body) => {
    if (!body) return null;
    const at = body.indexOf('return {');
    if (at === -1) return null;
    const open = body.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < body.length; i++) {
      if (body[i] === '{') depth++;
      else if (body[i] === '}') { depth--; if (depth === 0) return body.slice(open, i + 1); }
    }
    return null;
  };
  const fieldCount = (lit) => {
    if (!lit) return -1;
    let depth = 0, n = 1, sawContent = false;
    for (let i = 1; i < lit.length - 1; i++) {
      const ch = lit[i];
      if (ch === '{' || ch === '(' || ch === '[') depth++;
      else if (ch === '}' || ch === ')' || ch === ']') depth--;
      else if (ch === ',' && depth === 0) n++;
      else if (!/\s/.test(ch)) sawContent = true;
    }
    return sawContent ? n : 0;
  };
  const slotRet = returnLiteral(slotBody);
  check('P4-16 槽位返回**恰好两个字段**（key + gpuPath；加一个就红）',
    fieldCount(slotRet) === 2,
    slotRet ? 'fields=' + fieldCount(slotRet) + ' → ' + slotRet.replace(/\s+/g, ' ') : '取不到 return { … }');
  check('P4-16 negative control: 字段计数判据有牙',
    fieldCount('{ key, dir, gpuPath: 1 }') === 3 && fieldCount('{ key, gpuPath: 1 }') === 2
    && fieldCount('{ key, gpuPath: join(dir, key + "_gpu.png") }') === 2);
  check('P4-16 sceneFrameSlot 不带档位参数、也不拼 `_v` 后缀（档位语义归调用方）',
    slotBody !== null && /function sceneFrameSlot\(\s*abs\s*\)/.test(slotBody) && !slotBody.includes("'_v'"),
    slotBody === null ? '锚点缺失' : 'arity-ok=' + /function sceneFrameSlot\(\s*abs\s*\)/.test(slotBody));
  check('P4-16 档 4 豁免抓帧时**不解析槽位**（不留那次白做的 statSync + ensureFrameCacheDir）',
    /variant === 4 \? null : gpuFrameFileFor\(sceneFrameSlot\(abs\)\)/.test(readFileSync(join(root, 'lib', 'routes', 'scene-frame.js'), 'utf8')));
}

// ── Level F: sceneVideo 文件版探测（issue #136）──────────────────────────────
// 启动探测曾对每个 scene.pkg 做 readFile(整包) + 全量 parsePkg（一库实测 15.86 GB
// 读风暴；索引阶段还曾因"链形头整条拉载荷"单包读 257 MB）。修复 = 文件版路径
//（只读 PKG 索引 + .tex 前缀）。三条腿：
//   ① 等价：合成容器逐支（raw 命中 / 打分选优 / 伪装压缩头 / 真 LZ4 链 / 空条目 /
//      无视频）新旧路径的布尔与提取字节一致，且 parsePkg 与 parsePkgHead 的条目表
//      （含 flags）逐字段全等 —— 压缩判定的内存版/文件版不许分叉；
//   ② 读量上界：链形头的大条目只读头不拉载荷（计数 readAt 下索引+前缀 < 80 KB，
//      而文件 > 120 KB —— 负对照保证"整包读"必撞上界）；
//   ③ 结构：宿主两处调用点必须走文件版，旧形态（readFile 整包 → extractSceneVideo）
//      零残留。
console.log('Level F — sceneVideo 文件版探测（issue #136）等价 / 读量上界 / 结构');
{
  const { extractSceneVideo, extractSceneVideoFromPkgFile, probeSceneVideoFromPkgFile } =
    await import(pathToFileURL(join(root, 'lib/scene-manifest.js')).href);
  const { parsePkg, parsePkgHead, readPkgEntryHeadAt } =
    await import(pathToFileURL(join(root, 'lib/pkg-read.js')).href);
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  const eqDir = join(root, '.test-cache', 'probe-eq');
  rmSync(eqDir, { recursive: true, force: true });
  mkdirSync(eqDir, { recursive: true });

  /** 命中 tex：前 4 字节盒大小 + 'ftyp'（判定窗 i=4 → 偏移 0），其余填 0xAB。 */
  const ftypTex = (n) => {
    const b = Buffer.alloc(Math.max(n, 16), 0xab);
    b.writeUInt32LE(n, 0);
    b.write('ftyp', 4, 'ascii');
    return b;
  };
  /** 无视频 tex：与上同形但不含 'ftyp'。 */
  const noFtypTex = (n) => Buffer.alloc(n, 0x7e);
  /**
   * 真 LZ4 链条目：内容 = 8 字节周期 × 125 = 1000 字节（bytes[4..7] = 'ftyp'，
   * 只有解压后才看得见）；单块「8 字面 + 回指 offset 8」压缩到 15 字节块，
   * 链总长 31 < 1000 ⇒ probeCompressedEntry 的门与链走查都成立（LZ4 flag）。
   * 手算依据：token 0x8F(lit 8 / match 15) + P(8) + offset LE 8 + match 扩展
   * (992−4−15=973 → 255,255,255,208)；解压 op 恰好 1000。
   */
  const lz4TexEntry = () => {
    const P = Buffer.from([0xe8, 0x03, 0x00, 0x00, 0x66, 0x74, 0x79, 0x70]);
    const block = Buffer.concat([Buffer.from([0x8f]), P, Buffer.from([0x08, 0x00, 255, 255, 255, 208])]);
    const entry = Buffer.alloc(16 + block.length);
    entry.writeUInt32LE(1000, 0); entry.writeUInt32LE(0, 4); // int64 originalSize
    entry.writeInt32LE(1000, 8);
    entry.writeInt32LE(block.length, 12);
    block.copy(entry, 16);
    return entry;
  };
  /** 伪装压缩头的 raw：门（originalSize=90000 > 长度）过、链走查第一跳就失败。 */
  const fakeSizeNoVideo = () => {
    const b = Buffer.alloc(300, 0x5a);
    b.writeUInt32LE(90000, 0);
    b.writeUInt32LE(0, 4);
    b.writeInt32LE(1, 8);
    b.writeInt32LE(999999, 12);
    return b;
  };
  const sceneJson = () => Buffer.from('{"objects":[]}');

  const fixtures = {
    'raw-hit': [{ path: 'scene.json', bytes: sceneJson() }, { path: 'main.tex', bytes: ftypTex(600) }],
    'scoring': [{ path: 'scene.json', bytes: sceneJson() },
      { path: 'masks/mask0.tex', bytes: ftypTex(400) },
      { path: 'main.tex', bytes: ftypTex(500) }],
    'lz4': [{ path: 'scene.json', bytes: sceneJson() }, { path: 'main.tex', bytes: lz4TexEntry() }],
    'fake-size': [{ path: 'scene.json', bytes: sceneJson() }, { path: 'main.tex', bytes: fakeSizeNoVideo() }],
    'tiny': [{ path: 'scene.json', bytes: sceneJson() },
      { path: 'main.tex', bytes: ftypTex(300) },
      { path: 'empty.tex', bytes: Buffer.alloc(0) },
      { path: 'stub.tex', bytes: Buffer.from('TEXV000') }],
    'novideo': [{ path: 'scene.json', bytes: sceneJson() }, { path: 'main.tex', bytes: noFtypTex(800) }],
  };
  const entryShape = (list) => JSON.stringify(
    list.map((e) => [e.path, e.offset, e.compressedSize, e.size, e.flags]));
  for (const [name, entries] of Object.entries(fixtures)) {
    const pkg = buildPkg(entries);
    const file = join(eqDir, name + '.pkg');
    writeFileSync(file, pkg);
    // ① 条目表（含压缩 flags）逐字段全等 —— probeCompressedEntry ≡ probeCompressedEntryAt。
    let counted = 0;
    const readAt = async (pos, len) => {
      counted += len;
      return pkg.subarray(pos, pos + Math.min(len, Math.max(pkg.length - pos, 0)));
    };
    const head = await parsePkgHead(readAt, pkg.length);
    const mem = parsePkg(pkg);
    check('F 条目表与压缩判定逐字段相等（' + name + '）', entryShape(mem) === entryShape(head),
      entryShape(mem) === entryShape(head) ? 'entries=' + mem.length : 'mem=' + entryShape(mem) + ' head=' + entryShape(head));
    // ② 探测布尔一致 + ③ 提取字节一致（含双方 null）。
    const oldV = extractSceneVideo(new Uint8Array(pkg));
    const newV = await probeSceneVideoFromPkgFile(file);
    const oldHas = !!(oldV && oldV.length);
    check('F 探测布尔一致（' + name + '）', newV === oldHas, 'old=' + oldHas + ' new=' + newV);
    const newEx = await extractSceneVideoFromPkgFile(file);
    const bothNull = (oldV == null) === (newEx == null);
    const sameBytes = bothNull && (oldV == null || sha(oldV) === sha(newEx));
    check('F 提取字节一致（' + name + '）', sameBytes,
      oldHas ? sha(oldV).slice(0, 12) + ' vs ' + (newEx ? sha(newEx).slice(0, 12) : 'null') : '双方 null');
  }
  // ② 读量上界：120 KB 链形头 junk + 小 tex；索引+前缀的全部 readAt 计数 < 80 KB。
  {
    const junk = Buffer.alloc(120 * 1024, 0x5a);
    junk.writeUInt32LE(300000, 0);
    junk.writeUInt32LE(0, 4);       // 门形：originalSize > 长度
    junk.writeInt32LE(1, 8);
    junk.writeInt32LE(9999999, 12);  // 链第一跳失败 ⇒ raw（曾在这里整条拉 120 KB）
    const big = buildPkg([
      { path: 'scene.json', bytes: sceneJson() },
      { path: 'junk.bin', bytes: junk },
      { path: 'main.tex', bytes: noFtypTex(400) },
    ]);
    let counted = 0;
    const readAt = async (pos, len) => {
      counted += len;
      return big.subarray(pos, pos + Math.min(len, Math.max(big.length - pos, 0)));
    };
    const entries = await parsePkgHead(readAt, big.length);
    for (const e of entries) {
      if (e.path.toLowerCase().endsWith('.tex')) await readPkgEntryHeadAt(readAt, big.length, e, 204);
    }
    check('F 读量上界：索引+前缀 < 80 KB（文件 > 120 KB）', counted < 80 * 1024 && big.length > 120 * 1024,
      '读 ' + counted + 'B / 文件 ' + big.length + 'B');
    check('F negative control: 整包读（=文件体积）必撞上界，判据有牙', big.length >= 80 * 1024,
      'file=' + big.length + ' ≥ 80KB ⇒ 若整读必红');
  }
  // ③ 结构：宿主两处调用点必须走文件版。**读宿主半**（`lib/index.js` + `lib/routes/*.js`）——
  //     `/scene-video` 已搬进 `lib/routes/scene-media.js`，只读主文件会把"已搬走"误报成
  //     "契约丢了"（本文件头第 30–31 行的那条约定：断言"仍实现某契约"要覆盖族目录）。
  {
    const hostHalfSrc = stripComments(readHostHalf());
    /** 共享判据：阳性（宿主半）与阴性对照（合成变异串）都喂进它。 */
    const usesUint8Probe = (t) => /extractSceneVideo\(new Uint8Array\(/.test(t);
    check('F 后台探测泵走文件版', /probeSceneVideoFromPkgFile\(job\.abs\)/.test(hostHalfSrc));
    check('F /scene-video 走文件版提取', /await extractSceneVideoFromPkgFile\(abs\)/.test(hostHalfSrc));
    check('F 宿主零残留：readFile(整包) → extractSceneVideo 旧形态',
      !usesUint8Probe(hostHalfSrc));
    check('F negative control: 旧形态会被同一判据判出（合成变异串 ⇒ true）',
      usesUint8Probe('extractSceneVideo(new Uint8Array(await readFile(abs)))') === true);
  }
  // ③b 族文件归属：场景内嵌媒资族（`/scene-video` + `/scene-audio`）已搬进
  //     `lib/routes/scene-media.js`（逐条理由见该文件头）。判据钉两件事：
  //     ① 门面里零残留、两条注册都在族文件里；
  //     ② 去重账本 `SCENE_VIDEO_INFLIGHT` **只以引用进 `c`**（声明仍在门面的 `apply()` 里）
  //        ⇒ 搬文件不改变它"本 fiber 单例"的生命周期（这是纯搬移、不是行为改动）。
  {
    const hostSrc = stripComments(readFileSync(join(root, 'lib', 'index.js'), 'utf8'));
    const famSrc = stripComments(readFileSync(join(root, 'lib', 'routes', 'scene-media.js'), 'utf8'));
    const stale = /path:\s*`\$\{BASE\}\/(scene-video|scene-audio)`/;
    check('G 场景内嵌媒资族已搬进 lib/routes/scene-media.js（门面里零残留）',
      !stale.test(hostSrc)
        && famSrc.includes('path: `${BASE}/scene-video`')
        && famSrc.includes('path: `${BASE}/scene-audio`'));
    check('G 去重账本只以引用进 c（声明仍在 apply()，生命周期未改）',
      /const SCENE_VIDEO_INFLIGHT = new Map\(\);/.test(hostSrc)
        && /SCENE_VIDEO_INFLIGHT/.test(famSrc)
        && /registerSceneMediaRoutes\(webServer, \{/.test(hostSrc));
    check('G negative control: 门面里重新出现被搬走的路由字面量会被同一条判据拒掉',
      stale.test(hostSrc + '\n  path: `${BASE}/scene-audio`,'));
  }
  // ③c 族文件归属：属性族（`/props`）、首帧缓存族（`/live-frame`）、设置族（`/settings`）已分别
  //     搬进 `lib/routes/props.js` / `lib/routes/live-frame.js` / `lib/routes/settings.js`。
  //     判据钉两件事（与 ③b 同形）：
  //     ① 门面里三条路由字面量零残留，且改成"一次调用"的调用点形态；
  //     ② 各族的**关键不变量**随文件一起落地（不是只剩空壳路由）——
  //        · props：覆盖值只认 project.json 仍声明着的属性（`filterKnownOverrides`）；
  //        · live-frame：只收 JPEG（`FF D8` 头校验）＋ 4MB 上限；
  //        · settings：写路径只认 PUT，落盘前必过 `sanitizeSettings` 与迁移护栏 `withLegacyFontValues`。
  {
    const hostSrc = stripComments(readFileSync(join(root, 'lib', 'index.js'), 'utf8'));
    const propsSrc = stripComments(readFileSync(join(root, 'lib', 'routes', 'props.js'), 'utf8'));
    const frameSrc = stripComments(readFileSync(join(root, 'lib', 'routes', 'live-frame.js'), 'utf8'));
    const settingsSrc = stripComments(readFileSync(join(root, 'lib', 'routes', 'settings.js'), 'utf8'));
    const stale = /path:\s*`\$\{BASE\}\/(props|live-frame|settings)`/;
    check('H 三条路由族已搬出 apply()（门面里零残留，族文件各持一条注册）',
      !stale.test(hostSrc)
        && propsSrc.includes('path: `${BASE}/props`')
        && frameSrc.includes('path: `${BASE}/live-frame`')
        && settingsSrc.includes('path: `${BASE}/settings`'));
    check('H 门面里改为一次调用（三条调用点形态正确）',
      /registerPropsRoutes\(webServer, \{/.test(hostSrc)
        && /registerLiveFrameRoutes\(webServer, \{/.test(hostSrc)
        && /registerSettingsRoutes\(webServer, \{/.test(hostSrc));
    check('H 各族的关键不变量随文件落地（不是空壳路由）',
      /filterKnownOverrides\(pj, userPropsFor\(token\)\)/.test(propsSrc)
        && /buf\[0\] !== 0xff \|\| buf\[1\] !== 0xd8/.test(frameSrc)
        && /maxBytes: 4 \* 1024 \* 1024/.test(frameSrc)
        && /method !== 'PUT'/.test(settingsSrc)
        && /sanitizeSettings\(parsed\)/.test(settingsSrc)
        && /withLegacyFontValues\(sanitized\)/.test(settingsSrc));
    check('H negative control: 门面里重新出现被搬走的路由字面量会被同一条判据拒掉',
      stale.test(hostSrc + '\n  path: `${BASE}/settings`,'));
  }
  // ③d 媒体字节族：`/media` + `/preview`（原始字节直出）已搬进 `lib/routes/media-bytes.js`。
  //     判据与 ③c 同形，钉三件事：
  //     ① 门面里两条路由字面量与那个循环零残留（`for (const seg of ['media','preview'])` 也搬走了）；
  //     ② 改成"一次调用"，且**调用点必须排在 media-derived 之后** —— `/media-info` 与 `/media`
  //        同前缀，晚注册会被 prefix 匹配吞掉（本族唯一会静默出错的地方）；
  //     ③ 关键不变量落地：`/media` 经 `pinnedFaststartVariant` 定音（同一次播放一份字节布局）、
  //        `/preview` 不定音、非 GET/HEAD 出 405。
  {
    const hostSrc = stripComments(readFileSync(join(root, 'lib', 'index.js'), 'utf8'));
    const bytesSrc = stripComments(readFileSync(join(root, 'lib', 'routes', 'media-bytes.js'), 'utf8'));
    const stale = /path:\s*`\$\{BASE\}\/\$\{seg\}`/;
    check('I 媒体字节族已搬出 apply()（门面里零残留，族文件持循环注册）',
      !stale.test(hostSrc)
        && !/for \(const seg of \['media', 'preview'\]\)/.test(hostSrc)
        && /for \(const seg of \['media', 'preview'\]\)/.test(bytesSrc)
        && bytesSrc.includes('path: `${BASE}/${seg}`'));
    check('I 调用点形态正确，且排在 media-derived 之后（前缀吞噬防线）',
      /registerMediaBytesRoutes\(webServer, \{/.test(hostSrc)
        && hostSrc.indexOf('registerMediaDerivedRoutes(webServer, {') < hostSrc.indexOf('registerMediaBytesRoutes(webServer, {'));
    check('I 关键不变量随文件落地：/media 定音、/preview 不定音、非 GET/HEAD 出 405',
      /seg === 'media' \? pinnedFaststartVariant\(abs, token, log\) : null/.test(bytesSrc)
        && /serveLayout\(pick\.layout, pick\.abs, req, res, method === 'HEAD'\)/.test(bytesSrc)
        && /serveFile\(abs, req, res, method === 'HEAD'\)/.test(bytesSrc)
        // 负对照：旧的"选一份落盘副本"形态不许复活（已换成服务期虚拟布局）。
        && !/serveFile\(fast \|\| abs/.test(bytesSrc)
        && /res\.statusCode = 405/.test(bytesSrc));
    check('I negative control: 门面里重新出现被搬走的循环字面量会被同一条判据拒掉',
      stale.test(hostSrc + '\n      path: `${BASE}/${seg}`,'));
  }
  rmSync(eqDir, { recursive: true, force: true });
}

if (typeof dispose === 'function') dispose();
delete process.env.DSH_WE_STEAM_ROOT;
rmSync(join(root, '.test-cache', 'scene-fixture'), { recursive: true, force: true });

console.log('');
console.log(passed + ' passed, ' + failed + ' failed'
  + (platformSkipped ? ', ' + platformSkipped + ' platform-skipped' : ''));
if (platformSkipped) {
  console.log('  ⚠️ 本平台不执行的断言（不计入通过）：');
  for (const n of platformSkippedNames) console.log('     ○ ' + n);
  console.log('     来自 posix 分支的 5 条（500 unlink-failed / 帧仍在盘上 / 重试可用 …）在 '
    + process.platform + ' 上没有任何覆盖 —— 这是覆盖差异，不是通过。');
}
process.exit(failed === 0 ? 0 : 1);
