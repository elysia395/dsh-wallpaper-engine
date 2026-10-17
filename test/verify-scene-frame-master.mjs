#!/usr/bin/env node
/**
 * verify-scene-frame-master.mjs — GPU 抓帧缓存**单主帧 + 面积升级制**的行为自检。
 *
 * ── 为什么需要它（这条判据的来历）────────────────────────────────────────────
 * 一张壁纸可以被多个窗口同时实时渲染（每个加载了客户端的窗口各挂一层；Electron
 * 跨窗口不共享 WebGL 面 ⇒ 各画各的）。单槽 + "形状不符就清写"的时代，两个视口
 * 比不同的窗口会在每轮轮播到访时**互相清写**对方的帧（实测 60s 一轮永不收敛）。
 * 第一版修复（按视比分桶）解决了互踢，但引入了新成本：**频繁调整窗口大小 ⇒ 每
 * 个新形状在轮播边界上都会为每张壁纸抓一帧落盘，桶只增不减**。
 * 现行设计 = **单主帧 + 面积升级制（只升不降）**：
 *   · 客户端：主帧面积 ≥ 我的画布（容差 5%）⇒ 保留 + cover 缩小显示；主帧缺失
 *     或明显更小 ⇒ 抓**我的尺寸**覆盖写入；
 *   · 宿主 PUT 面积守卫（本文件的 4/5/6 三条）：来帧面积 < 盘上主帧 × 0.95 ⇒
 *     409 frame-smaller 拒写 —— 小帧永远覆盖不掉大帧，"乒乓"的最后半步也被堵死；
 *   · 等面积覆盖放行：那是「重新截」在换内容，不是降级。
 * 写入次数 = 主帧面积单调升级的次数（个位数封顶）；磁盘每壁纸恒定 1 帧。
 *
 * 判据走公开面（真 `apply()` + mock webServer + 真 PUT/HEAD/GET/DELETE 字节流），
 * 隔离同 verify-scene.mjs：`DSH_WE_DATA_DIR` / `DSH_WE_STEAM_ROOT` 指向
 * `.test-cache/`，全程不碰真实 `~/.dsh-wallpaper-engine`。
 *
 * Usage:  node test/verify-scene-frame-master.mjs
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// 面积守卫的容差**从真源现算**（不写死 0.95）：符号 → 唯一声明处。缺锚即红。
import { locate } from './tools/source-locator.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ISO = join(root, '.test-cache', 'scene-frame-master');
const DATA_DIR = join(ISO, 'data');
const TEST_FRAMES_DIR = join(ISO, 'data', 'cache', 'frames');

rmSync(ISO, { recursive: true, force: true });
mkdirSync(DATA_DIR, { recursive: true });
process.env.DSH_WE_DATA_DIR = DATA_DIR;
delete process.env.DSH_WE_CACHE_DIR;
delete process.env.DSH_WE_UPLOAD_DIR;

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log('  ✓ ' + name + (detail ? ' — ' + detail : '')); }
  else { failed++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
};

/**
 * 面积守卫的判据本体（生产与负对照共用）：逐字照
 * `lib/routes/scene-frame.js` 的 `incomingArea < prevDim.width * prevDim.height * (1 - GPU_FRAME_AREA_TOL)`。
 * @param {number} prevArea 盘上主帧面积
 * @param {number} incomingArea 来帧面积
 * @param {number} tol 容差（GPU_FRAME_AREA_TOL）
 * @returns {200|409}
 */
function areaGuardStatus(prevArea, incomingArea, tol) {
  return incomingArea < prevArea * (1 - tol) ? 409 : 200;
}

/** 一条**观测**是否与判据期望一致 —— 就是生产里那条 check 的判定式（负对照复用它）。 */
function observedMatches(observedStatus, prevArea, incomingArea, tol) {
  return observedStatus === areaGuardStatus(prevArea, incomingArea, tol);
}

/**
 * 「`GPU_FRAME_AREA_TOL` 是**同一个旋钮**」的判据本体（生产与负对照共用）：两份拷贝必须
 * **同值**且都落在 (0,1) 内。
 *
 * 取证（`git log -S GPU_FRAME_AREA_TOL` + 两处上下文注释）：
 *   · 两份都由同一次合并（PR #206「单主帧 + 面积升级制」）引入 ⇒ **同一个设计来源**；
 *   · 客户端那处的注释逐字写着「与宿主 `GPU_FRAME_AREA_TOL` **同值同义**，两端独立部署」
 *     （浏览器半边不能 import 宿主常量，所以只能复制一份）；
 *   · 它们守**同一条边界**的两侧：客户端「主帧面积 ≥ 画布 ×(1−TOL) ⇒ 保留」，宿主
 *     「来帧面积 < 盘上主帧 ×(1−TOL) ⇒ 409」。
 * ⇒ 判定：**同一个旋钮的两份拷贝**，必须钉相等（不是各自独立的策略）。
 * 漂开的后果**不对称**：`tol_client > tol_host` ⇒ 客户端保留一张宿主会拒写的更小帧 ⇒
 * 用户长期看到偏小/偏糊的主帧，且再也不会被重新抓帧顶掉（后果面负对照见 4l）。
 */
function tolerancePairProblems(hostTol, clientTol) {
  const bad = [];
  if (!(hostTol > 0 && hostTol < 1)) bad.push('宿主容差越界：' + JSON.stringify(hostTol));
  if (!(clientTol > 0 && clientTol < 1)) bad.push('客户端容差越界：' + JSON.stringify(clientTol));
  if (Number(hostTol) !== Number(clientTol)) {
    bad.push('两份 `GPU_FRAME_AREA_TOL` 不同值：宿主 ' + JSON.stringify(hostTol)
      + ' ≠ 客户端 ' + JSON.stringify(clientTol));
  }
  return bad;
}

/**
 * 客户端的「保留主帧」判定 —— 逐字照 `src/live-layer-watch.js` 的 cover 阈值语义
 * （`主帧面积 ≥ 画布 × (1 − TOL) ⇒ 不抓新帧`）。只用于**后果面**负对照。
 */
function clientKeepsMainFrame(frameArea, canvasArea, tol) {
  return frameArea >= canvasArea * (1 - tol);
}

// ── PNG 工厂（合法 IHDR/IEND，尺寸/填充可调） ───────────────────────────────
function pngChunkCrc32(type, payload) {
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
  const len = Buffer.alloc(4); len.writeUInt32BE(payload.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), payload]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const pngHeadFor = (w, h) => {
  const b = Buffer.alloc(13);
  b.writeUInt32BE(w, 0); b.writeUInt32BE(h, 4); b[8] = 8; b[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunkCrc32('IHDR', b),
  ]);
};
const makePng = (w, h, fill = 7, payloadBytes = 4096) => Buffer.concat([
  pngHeadFor(w, h),
  pngChunkCrc32('IDAT', Buffer.alloc(payloadBytes, fill)),
  pngChunkCrc32('IEND', Buffer.alloc(0)),
]);

// ── 合成 Steam 库（同 verify-scene.mjs 的 fixture：32×32 噪声场景） ───────────
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
  header.writeInt32LE(8, p); p += 4;
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
  mip.writeInt32LE(0, 8);
  mip.writeInt32LE(0, 12);
  mip.writeInt32LE(rgbaBytes.length, 16);
  rgbaBytes.copy(mip, 20);
  const header = Buffer.alloc(9 + 9 + 4 * 8 + 9 + 4 * 2 + 4);
  let p = 0;
  header.write('TEXV0005\0', p, 'ascii'); p += 9;
  header.write('TEXI0001\0', p, 'ascii'); p += 9;
  header.writeInt32LE(0, p); p += 4;
  header.writeInt32LE(0, p); p += 4;
  header.writeInt32LE(width, p); p += 4;
  header.writeInt32LE(height, p); p += 4;
  header.writeInt32LE(width, p); p += 4;
  header.writeInt32LE(height, p); p += 4;
  header.writeInt32LE(0, p); p += 4;
  header.write('TEXB0002\0', p, 'ascii'); p += 9;
  header.writeInt32LE(1, p); p += 4;
  header.writeInt32LE(1, p); p += 4;
  return Buffer.concat([header.subarray(0, p), mip]);
}

const fixtureLib = join(ISO, 'steamlib');
const fixtureItemDir = join(fixtureLib, 'steamapps', 'workshop', 'content', '431960', '990002');
{
  mkdirSync(fixtureItemDir, { recursive: true });
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
    title: 'Master Frame Fixture Scene', type: 'scene', file: 'scene.pkg', preview: 'preview.jpg',
    contentrating: 'Everyone',
  }));
  writeFileSync(join(fixtureItemDir, 'preview.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  process.env.DSH_WE_STEAM_ROOT = [process.env.DSH_WE_STEAM_ROOT, fixtureLib].filter(Boolean).join(',');
}

// ── Boot: real host apply() + mock webServer ────────────────────────────────
const routes = [];
const mockCtx = {
  webServer: {
    register(route) { routes.push(route); return () => { const i = routes.indexOf(route); if (i >= 0) routes.splice(i, 1); }; },
    tapIndex() { return () => {}; },
  },
};
const hostMod = await import(pathToFileURL(join(root, 'lib', 'index.js')).href);
const host = hostMod.default || hostMod;
const apply = host.apply || (host.inject && host.apply);
apply(mockCtx);
const sceneRoute = routes.find((r) => r.path === '/wallpaper-engine/scene-frame');
const gpuRoute = routes.find((r) => r.path === '/wallpaper-engine/scene-frame-cache');
check('scene-frame / scene-frame-cache 路由已注册', Boolean(sceneRoute && gpuRoute));
// 结构锚：单主帧 + 面积守卫只实现一次，锚在路由源码上，防"实现漂回分桶"——
// 漂了行为判据会红，这条让红得更早、更可读。
{
  const routeSrc = readFileSync(join(root, 'lib', 'routes', 'scene-frame.js'), 'utf8');
  const indexSrc = readFileSync(join(root, 'lib', 'index.js'), 'utf8');
  check('路由源码带着面积守卫不变量（frame-smaller + 容差常量）',
    routeSrc.includes("'frame-smaller'") && routeSrc.includes('GPU_FRAME_AREA_TOL'));
  check('lib 不再携带分桶构造（bucketPath / gpuBucketListFor 已拆除）',
    !indexSrc.includes('bucketPath') && !indexSrc.includes('gpuBucketListFor'));
}

// ── request helpers（真 req/res 字节流，同 verify-scene.mjs 口径） ──────────
const fakeRes = () => {
  const state = { status: 200, headers: {}, body: Buffer.alloc(0), ended: false }; // 宿主默认 200，路由只显式改非 200
  const res = new Writable({
    write(chunk, enc, cb) { state.body = Buffer.concat([state.body, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]); cb(); },
    final(cb) { state.ended = true; cb(); },
  });
  res.setHeader = (k, v) => { state.headers[String(k).toLowerCase()] = String(v); };
  res.writeHead = (code, hdrs) => { state.status = code; if (hdrs) for (const [k, v] of Object.entries(hdrs)) state.headers[String(k).toLowerCase()] = String(v); };
  Object.defineProperty(res, 'statusCode', { get: () => state.status, set: (v) => { state.status = v; } });
  res.__state = state;
  return res;
};
const runHandler = async (route, url, method = 'GET', body = null, headers = {}) => {
  const res = fakeRes();
  if (body) {
    const req = new Readable({ read() {} });
    req.url = url; req.method = method;
    req.headers = { 'content-type': 'image/png', ...(headers || {}) };
    route.handler(req, res);
    req.push(Buffer.isBuffer(body) ? body : Buffer.from(body));
    req.push(null);
  } else {
    route.handler({ url, headers: headers || {}, method, on() {}, once() {}, resume() {} }, res);
  }
  await new Promise((resolveFn) => {
    const t = setTimeout(resolveFn, 8000);
    res.on('finish', () => { clearTimeout(t); resolveFn(); });
    if (res.__state.ended) { clearTimeout(t); resolveFn(); }
  });
  return res;
};
const runPut = (url, png) => runHandler(gpuRoute, url, 'PUT', png, { 'content-type': 'image/png' });
const runHead = (url) => runHandler(sceneRoute, url, 'HEAD');
const runGet = (url) => runHandler(sceneRoute, url, 'GET');
const runClear = (url, method = 'DELETE') => runHandler(gpuRoute, url, method);

// ── 取 token：从库存里抓一张场景壁纸的 scene-frame token ────────────────────
const invRoute = routes.find((r) => r.path === '/wallpaper-engine/inventory');
const inv = await runHandler(invRoute, '/wallpaper-engine/inventory');
const invJson = JSON.parse(String(inv.__state.body));
const wp = (invJson.wallpapers || []).find((w) => w.type === 'scene' && w.frameUrl);
let token = '';
if (wp) token = wp.frameUrl.split('/').pop();

if (token) {
  const { readdirSync } = await import('node:fs');
  // 主帧文件名 = 缓存键 + '_gpu.png'（单槽唯一文件）。
  const gpuPathOf = () => {
    const files = readdirSync(TEST_FRAMES_DIR).filter((f) => f.endsWith('_gpu.png'));
    return files.length === 1 ? join(TEST_FRAMES_DIR, files[0]) : null;
  };

  // ── 1. 首次 PUT：空槽接受任何尺寸 ──
  const pngA = makePng(800, 600, 1); // 面积 480,000
  const put1 = await runPut('/wallpaper-engine/scene-frame-cache/' + token, pngA);
  check('1. 空槽 PUT 800×600 → 200 落盘（单槽文件名 <key>_gpu.png）',
    put1.__state.status === 200 && Boolean(gpuPathOf())
    && readFileSync(gpuPathOf()).equals(pngA),
    'status=' + put1.__state.status);
  const body1 = JSON.parse(String(put1.__state.body));
  check('1b. 响应带 ar（几何自 PNG 推导）', body1 && body1.ar === 1.3333,
    'ar=' + (body1 && body1.ar));

  // ── 2. HEAD/GET：几何头与字节 ──
  const head2 = await runHead('/wallpaper-engine/scene-frame/' + token);
  check('2. HEAD → 204 + X-WE-GPU:1 + W/H/AR 几何头',
    head2.__state.status === 204
    && head2.__state.headers['x-we-gpu'] === '1'
    && head2.__state.headers['x-we-gpu-w'] === '800'
    && head2.__state.headers['x-we-gpu-h'] === '600'
    && head2.__state.headers['x-we-gpu-ar'] === '1.3333',
    JSON.stringify(head2.__state.headers));
  const get2 = await runGet('/wallpaper-engine/scene-frame/' + token);
  check('2b. GET → 原字节回放', get2.__state.status === 200 && get2.__state.body.equals(pngA),
    get2.__state.body.length + 'B');

  // ── 3. 等面积覆盖：换内容放行（「重新截」路径） ──
  const pngA2 = makePng(800, 600, 2);
  const put3 = await runPut('/wallpaper-engine/scene-frame-cache/' + token, pngA2);
  check('3. 等面积 PUT → 200 覆盖（换内容，非降级）',
    put3.__state.status === 200 && readFileSync(gpuPathOf()).equals(pngA2),
    'status=' + put3.__state.status);

  // ── 4. 面积守卫：明显更小的帧拒写（乒乓的最后半步） ──
  const pngSmall = makePng(640, 480, 3); // 面积 307,200 < 480,000 × 0.95
  const put4 = await runPut('/wallpaper-engine/scene-frame-cache/' + token, pngSmall);
  const body4 = JSON.parse(String(put4.__state.body));
  check('4. 小帧 PUT → 409 frame-smaller（主帧毫发无损）',
    put4.__state.status === 409 && body4.error === 'frame-smaller'
    && body4.have && body4.have.w === 800 && body4.have.h === 600
    && body4.got && body4.got.w === 640
    && readFileSync(gpuPathOf()).equals(pngA2),
    'status=' + put4.__state.status + ' body=' + String(put4.__state.body).slice(0, 80));

  // ── 4b/4c. 面积守卫的**边界锚点**（容差两侧各贴一个 ±1% 的近邻用例）───────────────
  // 为什么必须有两个**边界锚点**：只被 0.64 与 0.974 两个**远点**夹住时，容差存在一条**死带** ——
  // 把常量从 0.05 弱化到 0.30（强度弱化 6 倍）仍 18/18 全绿。边界两侧各贴一个 ±1% 近邻用例后，
  // 任何"跨过这两个点"的弱化/收紧都会当场红（见 4d/4e）。
  // 容差**从真源现算**：`GPU_FRAME_AREA_TOL` 在 lib 半边唯一声明 —— ⚠️ 客户端半边
  // `src/live-layer-watch.js` 有自己的同名副本（cover 阈值），所以必须限定 `{ in: 'lib' }`，
  // 否则 source-locator 会（正确地）判"两处声明 ⇒ 谁对不确定"。
  const tolDecl = locate('GPU_FRAME_AREA_TOL', { in: 'lib' });
  const tolMatch = tolDecl.ok
    ? /const\s+GPU_FRAME_AREA_TOL\s*=\s*([0-9.]+)\s*;/.exec(readFileSync(join(root, tolDecl.hit.rel), 'utf8'))
    : null;
  const tol = tolMatch ? Number(tolMatch[1]) : NaN;
  check('4b-锚点：`GPU_FRAME_AREA_TOL` 在 lib 半边唯一声明且能抠出字面量（缺锚即红；阈值一律现算，不写死 0.95）',
    tolDecl.ok && Number.isFinite(tol) && tol > 0 && tol < 1,
    tolDecl.ok
      ? `${tolDecl.hit.rel}:${tolDecl.hit.line} ⇒ ${Number.isFinite(tol) ? tol : '**抠不出字面量**'}`
      : tolDecl.detail);
  const prevW = Number(body4.have && body4.have.w);
  const prevH = Number(body4.have && body4.have.h);
  const prevArea = prevW * prevH;
  const boundary = 1 - tol;
  /** 固定高、调宽 ⇒ 面积比可控（返回 [w, h]）。 */
  const dimsFor = (ratio) => [Math.max(2, Math.round(prevArea * ratio / prevH)), prevH];
  const [wBelow, hBelow] = dimsFor(boundary - 0.01);
  const [wAbove, hAbove] = dimsFor(boundary + 0.01);
  const areaBelow = wBelow * hBelow;
  const areaAbove = wAbove * hAbove;
  const ratioBelow = areaBelow / prevArea;
  const ratioAbove = areaAbove / prevArea;
  check('4b-夹具：两个近邻用例确实贴住边界两侧（都在容差 ±2% 内、分处两侧、不与边界重合）',
    Number.isFinite(tol) && prevArea > 0
    && ratioBelow < boundary && ratioAbove > boundary
    && (boundary - ratioBelow) <= 0.02 && (ratioAbove - boundary) <= 0.02,
    `主帧 ${prevW}×${prevH}（${prevArea}）· 边界 ${boundary} · 下 ${ratioBelow.toFixed(4)}（${wBelow}×${hBelow}）`
      + ` · 上 ${ratioAbove.toFixed(4)}（${wAbove}×${hAbove}）`);
  const URL_TOKEN = '/wallpaper-engine/scene-frame-cache/' + token;
  const putBelow = Number.isFinite(tol) ? await runPut(URL_TOKEN, makePng(wBelow, hBelow, 41)) : null;
  check('4c. 边界**下方 1%** 的帧 → 409 frame-smaller（守卫在边界处真的有牙）',
    Boolean(putBelow) && observedMatches(putBelow.__state.status, prevArea, areaBelow, tol)
    && putBelow.__state.status === 409 && readFileSync(gpuPathOf()).equals(pngA2),
    putBelow ? 'status=' + putBelow.__state.status + '（期望 409，主帧须毫发无损）' : '（容差锚点丢了 ⇒ 本用例不成立）');
  const putAbove = Number.isFinite(tol) ? await runPut(URL_TOKEN, makePng(wAbove, hAbove, 42)) : null;
  check('4d. 边界**上方 1%** 的帧 → 200 放行（容差内不互相顶掉）',
    Boolean(putAbove) && observedMatches(putAbove.__state.status, prevArea, areaAbove, tol)
    && putAbove.__state.status === 200,
    putAbove ? 'status=' + putAbove.__state.status + '（期望 200）' : '（容差锚点丢了 ⇒ 本用例不成立）');
  // 负对照：把**实现的容差**改坏（同一个判定式喂变异后的容差所产生的"观测"）⇒ 上面两条用例必须判红。
  // 这正是审计的反证实验：0.05 → 0.30 时原判据全绿；现在被这两个近邻用例夹住。
  const weakenedSeen = areaGuardStatus(prevArea, areaBelow, 0.30);   // 弱化 6 倍后：边界下方也会被放行
  const tightenedSeen = areaGuardStatus(prevArea, areaAbove, 0.01);  // 收紧后：边界上方也会被拒
  check('4e. negative control：容差被弱化到 0.30（审计反证实验）⇒ 边界下方那条观测会被**同一条判据**判红',
    Number.isFinite(tol) && !observedMatches(weakenedSeen, prevArea, areaBelow, tol)
    && weakenedSeen === 200 && areaGuardStatus(prevArea, areaBelow, tol) === 409,
    `弱化后观测 ${weakenedSeen} vs 判据期望 ${areaGuardStatus(prevArea, areaBelow, tol)}`);
  check('4f. negative control：容差被收紧到 0.01 ⇒ 边界上方那条观测会被**同一条判据**判红（另一个方向也有牙）',
    Number.isFinite(tol) && !observedMatches(tightenedSeen, prevArea, areaAbove, tol)
    && tightenedSeen === 409 && areaGuardStatus(prevArea, areaAbove, tol) === 200,
    `收紧后观测 ${tightenedSeen} vs 判据期望 ${areaGuardStatus(prevArea, areaAbove, tol)}`);
  check('4g. 正对照：真容差下的两条观测与判据期望一致（判据不是恒真/恒假）',
    Number.isFinite(tol) && observedMatches(409, prevArea, areaBelow, tol) && observedMatches(200, prevArea, areaAbove, tol));

  // ── 4h–4l：跨半边 —— 客户端那一份 `GPU_FRAME_AREA_TOL` 必须与宿主**同值同义** ─────────
  // 取证见 `tolerancePairProblems` 的注释（同源于 PR #206；客户端注释写着"同值同义"）。
  // 客户端半边不能 import 宿主常量 ⇒ 只能复制；**复制的就是必须被钉住的东西**：
  // 早先只有"两边各自在 (0,1)"这种弱前提，两份值漂开没有任何判据看得见。
  const clientTolDecl = locate('GPU_FRAME_AREA_TOL', { in: 'src' });
  const clientTolMatch = clientTolDecl.ok
    ? /const\s+GPU_FRAME_AREA_TOL\s*=\s*([0-9.]+)\s*;/.exec(readFileSync(join(root, clientTolDecl.hit.rel), 'utf8'))
    : null;
  const clientTol = clientTolMatch ? Number(clientTolMatch[1]) : NaN;
  check('4h. 跨半边锚点：客户端 `GPU_FRAME_AREA_TOL` 在 src 半边唯一声明且能抠出字面量（缺锚即红）',
    clientTolDecl.ok && Number.isFinite(clientTol),
    clientTolDecl.ok
      ? `${clientTolDecl.hit.rel}:${clientTolDecl.hit.line} ⇒ ${Number.isFinite(clientTol) ? clientTol : '**抠不出字面量**'}`
      : clientTolDecl.detail);
  const pairBad = tolerancePairProblems(tol, clientTol);
  check('4i. **同一个旋钮**：客户端与宿主两份 `GPU_FRAME_AREA_TOL` 必须同值'
    + '（同源 PR #206，客户端注释写着"同值同义"；漂开 ⇒ 客户端保留宿主会拒写的帧）',
    pairBad.length === 0, pairBad.join('；') || `宿主 ${tol} == 客户端 ${clientTol}（都在 (0,1) 内）`);
  check('4j. negative control：**任一侧**改成 0.30 ⇒ 同一条 `tolerancePairProblems` 判红（两个方向）',
    tolerancePairProblems(0.30, clientTol).length > 0 && tolerancePairProblems(tol, 0.30).length > 0
    && tolerancePairProblems(tol, clientTol).length === 0);
  check('4k. negative control：把一份改成越界值（0 / 1 / NaN）⇒ 同一条判据判红（不只是"等不等"）',
    tolerancePairProblems(0, clientTol).length > 0 && tolerancePairProblems(tol, 1).length > 0
    && tolerancePairProblems(Number.NaN, clientTol).length > 0);
  // 后果面：tol_client=0.30 时，**存在**一个面积让客户端保留、而宿主按自己的容差拒写。
  // 这就是"两份拷贝漂开"的可观测代价（不是抽象不等）。
  const riskArea = Math.round(prevArea * (boundary - 0.01));   // 边界下方 1%（宿主会 409 的那一档）
  check('4l. negative control（后果面）：`tol_client=0.30` 时同一面积**客户端保留、宿主拒写** ⇒ 错配可见',
    Number.isFinite(tol) && clientKeepsMainFrame(riskArea, prevArea, 0.30) === true
    && areaGuardStatus(prevArea, riskArea, tol) === 409
    && clientKeepsMainFrame(riskArea, prevArea, clientTol) === false,
    `面积 ${riskArea}（主帧 ${prevArea}×${boundary - 0.01}）· 客户端(0.30)保留=${clientKeepsMainFrame(riskArea, prevArea, 0.30)}`
      + ` · 宿主(${tol})${areaGuardStatus(prevArea, riskArea, tol)} · 真两侧(客户端 ${clientTol})保留=${clientKeepsMainFrame(riskArea, prevArea, clientTol)}`);

  // ── 5. 容差内：略小仍放行（相近窗口不互相顶掉） ──
  // ⚠️ 此刻主帧已被 4d 换成 `${wAbove}×${hAbove}`（边界上方那条被接受）⇒ 本用例的期望按**当前**
  //    主帧算，不再写上一条注释里的 480,000。
  const pngNear = makePng(790, 592, 4); // 面积 467,680 ≥ 当前主帧面积 × (1 - 容差)
  const put5 = await runPut(URL_TOKEN, pngNear);
  check('5. 容差内略小帧（98%）→ 200 放行',
    put5.__state.status === 200, 'status=' + put5.__state.status);

  // ── 6. 升级：更大的帧覆盖 ──
  const pngBig = makePng(1200, 900, 5); // 面积 1,080,000
  const put6 = await runPut('/wallpaper-engine/scene-frame-cache/' + token, pngBig);
  const body6 = JSON.parse(String(put6.__state.body));
  check('6. 大帧 PUT → 200 upgraded:true（单槽内升级覆盖）',
    put6.__state.status === 200 && body6.upgraded === true
    && readFileSync(gpuPathOf()).equals(pngBig),
    'status=' + put6.__state.status);

  // ── 7. 全程单文件：不产生第二份 ──
  const files7 = readdirSync(TEST_FRAMES_DIR).filter((f) => f.endsWith('.png'));
  check('7. 全流程只有一张主帧（无形状桶文件）',
    files7.length === 1 && files7[0].endsWith('_gpu.png'),
    files7.join(', '));

  // ── 8. 清除：删主帧 + 幂等 ──
  const clr1 = await runClear('/wallpaper-engine/scene-frame-cache/' + token);
  check('8. DELETE → 200 removed:true，文件消失',
    clr1.__state.status === 200 && /"removed":true/.test(String(clr1.__state.body))
    && gpuPathOf() === null,
    'status=' + clr1.__state.status);
  const head8 = await runHead('/wallpaper-engine/scene-frame/' + token);
  check('8b. 删后 HEAD → 404（X-WE-GPU 无从谈起）', head8.__state.status === 404,
    'status=' + head8.__state.status);
  const clr2 = await runClear('/wallpaper-engine/scene-frame-cache/' + token);
  check('8c. 再删 → 幂等 200 removed:false',
    clr2.__state.status === 200 && /"removed":false/.test(String(clr2.__state.body)),
    'status=' + clr2.__state.status);

  // ── 9. v=4 豁免：用户 pin 的自定义画面不被抓帧顶掉 ──
  const get9 = await runGet('/wallpaper-engine/scene-frame/' + token + '?v=4');
  check('9. v=4 空自定义画面 → 422（诚实的"pin 来源失效"）',
    get9.__state.status === 422, 'status=' + get9.__state.status);

  // ── 10. 坏载荷门禁：假 PNG / 无几何 PNG 415 ──
  const put10a = await runPut('/wallpaper-engine/scene-frame-cache/' + token, Buffer.alloc(2048, 0x41));
  check('10a. 非 PNG 字节 → 415 unsupported-format', put10a.__state.status === 415,
    'status=' + put10a.__state.status);
  const truncatedPng = Buffer.concat([pngHeadFor(100, 100), pngChunkCrc32('IEND', Buffer.alloc(0))]);
  const put10b = await runPut('/wallpaper-engine/scene-frame-cache/' + token, truncatedPng);
  check('10b. 有签名无像素数据（<1KB/缺 IDAT）→ 415', put10b.__state.status === 415,
    'status=' + put10b.__state.status);
} else {
  failed++;
  console.log('  ✗ 无法取得 token，主帧行为断言全部未执行');
}

console.log(failed === 0 ? 'MASTER FRAME PASSED (' + passed + ' checks)' : failed + ' CHECK(S) FAILED');
process.exit(failed === 0 ? 0 : 1);
