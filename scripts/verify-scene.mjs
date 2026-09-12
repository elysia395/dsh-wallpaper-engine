/**
 * verify-scene.mjs — fixture self-test for the scene static-frame pipeline.
 *
 * Levels:
 *   A. pkg-extract unit: real workshop scene.pkg files must extract the MAIN
 *      colorful texture (never a mask), as JPEG passthrough or PNG, with sane
 *      dims. Synthetic PKG/TEX exercises the raw-RGBA decode + PNG encoder and
 *      the "no decodable texture" 422 path.
 *   B. Host route integration: a mock webServer captures the scene-frame route;
 *      the handler is invoked with real req/res shims to assert 200 + bytes,
 *      on-disk mtime cache creation and cache-hit reuse.
 *
 * Real fixtures are probed when present (Steam workshop + skin-center import
 * store); synthetic fixtures always run, so the script passes without Steam.
 *
 * Usage:  node scripts/verify-scene.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateSync, deflateSync } from 'node:zlib';
import { Writable } from 'node:stream';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Point the frame cache at a workspace-relative dir so the suite passes under
// sandboxes that cannot write outside the workspace (the real host has no
// such restriction).
const TEST_CACHE_DIR = join(root, '.test-cache', 'frames');
process.env.DSH_WE_CACHE_DIR = TEST_CACHE_DIR;
// Keep the loose-source default (~/Pictures on Linux) out of this hermetic
// suite: point it at a directory that cannot exist, so no host Pictures folder
// is ever scanned during tests. DSH_WE_LOOSE_DIR may be preset to run Level B
// against a real library (scene-frame route end-to-end needs a scene source).
process.env.DSH_WE_LOOSE_DIR = process.env.DSH_WE_LOOSE_DIR
  || join(root, '.test-cache', 'no-such-loose-dir');
const pkgExtract = await import(pathToFileURL(resolve(root, 'lib', 'pkg-extract.js')).href);

let passed = 0;
let failed = 0;
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  if (ok) passed++;
  else failed++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function pngInfo(bytes) {
  const b = Buffer.from(bytes);
  return {
    isPng: b.length > 24 && b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG',
    width: b.readUInt32BE(16),
    height: b.readUInt32BE(20),
  };
}

function jpegInfo(bytes) {
  const b = Buffer.from(bytes);
  let p = 2;
  let dims = null;
  while (p + 9 < b.length) {
    if (b[p] !== 0xff) { p++; continue; }
    const marker = b[p + 1];
    if (marker === 0xd8) { p += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      dims = { width: ((b[p + 7] << 8) | b[p + 8]) & 0xffff, height: ((b[p + 5] << 8) | b[p + 6]) & 0xffff };
      break;
    }
    const segLen = ((b[p + 2] << 8) | b[p + 3]) & 0xffff;
    if (segLen < 2) break;
    p += 2 + segLen;
  }
  return { isJpeg: b.length > 2 && b[0] === 0xff && b[1] === 0xd8 && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9, ...(dims || {}) };
}

/** Very small PNG decoder (filter types 0-4) returning {width,height,rgba}. */
function pngToRgba(bytes) {
  const b = Buffer.from(bytes);
  if (!(b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG')) return null;
  const width = b.readUInt32BE(16);
  const height = b.readUInt32BE(20);
  const bpp = 4;
  const stride = width * bpp + 1;
  // WE embedded PNGs are split into many IDAT chunks — collect them all.
  const idats = [];
  let iend = -1;
  let p = 8;
  while (p < b.length) {
    if (p + 12 > b.length) return null;
    const len = b.readUInt32BE(p);
    const type = b.toString('ascii', p + 4, p + 8);
    if (p + 12 + len > b.length) return null;
    if (type === 'IDAT') idats.push(b.subarray(p + 8, p + 8 + len));
    if (type === 'IEND') { iend = p; break; }
    p += 12 + len;
  }
  if (!idats.length || iend < 0) return null;
  const raw = Buffer.from(inflateSync(Buffer.concat(idats)));
  if (raw.length < stride * height) return null;
  const out = Buffer.alloc(width * height * bpp);
  for (let y = 0; y < height; y++) {
    const f = raw[y * stride];
    const line = raw.subarray(y * stride + 1, (y + 1) * stride);
    for (let x = 0; x < width * bpp; x++) {
      const a = x >= bpp ? out[y * width * bpp + x - bpp] : 0;
      const pr = y > 0 ? out[(y - 1) * width * bpp + x] : 0;
      const pc = y > 0 && x >= bpp ? out[(y - 1) * width * bpp + x - bpp] : 0;
      let v = line[x];
      if (f === 1) v = (v + a) & 255;
      else if (f === 2) v = (v + pr) & 255;
      else if (f === 3) v = (v + ((a + pr) >> 1)) & 255;
      else if (f === 4) { const p = a + pr - pc, pa = Math.abs(p - a), pb = Math.abs(p - pr), pcv = Math.abs(p - pc); v = (v + (pa <= pb && pa <= pcv ? a : pb <= pcv ? pr : pc)) & 255; }
      out[y * width * bpp + x] = v;
    }
  }
  return { width, height, rgba: out };
}

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

// ── Level A: pkg-extract ────────────────────────────────────────────────────
console.log('Level A — pkg-extract unit');

// A1: synthetic RGBA8888 scene → PNG path (exercises TEX parse + decode + PNG).
{
  // Checkerboard red/blue so the frame has real variance (a solid fill would
  // be rejected by the flatness gate).
  const rgba = Buffer.alloc(4 * 4 * 4);
  for (let i = 0; i < 4 * 4; i++) {
    const red = (i + ((i / 4) | 0)) % 2 === 0;
    rgba[i * 4] = red ? 220 : 30;
    rgba[i * 4 + 1] = red ? 30 : 30;
    rgba[i * 4 + 2] = red ? 30 : 220;
    rgba[i * 4 + 3] = 255;
  }
  const tex = buildTexRgba(4, 4, rgba);
  const pkg = buildPkg([
    { path: 'scene.json', bytes: Buffer.from(JSON.stringify({ objects: [{ image: 'main.tex' }] })) },
    { path: 'main.tex', bytes: tex },
  ]);
  try {
    const r = pkgExtract.extractSceneMainImage(new Uint8Array(pkg));
    const info = pngInfo(r.bytes);
    check('synthetic RGBA8888 → PNG ' + info.width + 'x' + info.height, r.mime === 'image/png' && info.isPng && info.width === 4 && info.height === 4 && r.texturePath === 'main.tex');
    const px = pngToRgba(r.bytes);
    const colorful = px && (() => { let c = 0; for (let i = 0; i < px.rgba.length; i += 4) { if (Math.max(px.rgba[i], px.rgba[i + 1], px.rgba[i + 2]) - Math.min(px.rgba[i], px.rgba[i + 1], px.rgba[i + 2]) > 40) c++; } return c > 10; })();
    check('synthetic PNG is colorful (not a gray mask)', colorful === true);
  } catch (e) {
    check('synthetic RGBA8888 → PNG', false, e.message);
  }
}

// A2: synthetic scene with no textures → descriptive throw.
{
  const pkg = buildPkg([{ path: 'scene.json', bytes: Buffer.from(JSON.stringify({ objects: [] })) }]);
  try {
    pkgExtract.extractSceneMainImage(new Uint8Array(pkg));
    check('empty scene throws', false, 'no error raised');
  } catch (e) {
    check('empty scene throws', /no texture candidates/.test(e.message), e.message);
  }
}

// A2b: embedded-PNG texture → passthrough (WE stores photographic art as PNG).
{
  // Build a tiny 2x2 RGBA PNG by hand (IHDR + IDAT + IEND).
  const raw = Buffer.alloc(2 * 4 * 4 + 3);
  for (let y = 0; y < 2; y++) {
    raw[y * 9] = 0; // filter 0
    raw.set([220, 30, 30, 255, 30, 220, 30, 255], y * 9 + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  // Wrap the PNG as the TEX mip payload (format RGBA8888 header, payload PNG).
  const mip = Buffer.alloc(20 + png.length);
  mip.writeInt32LE(2, 0); mip.writeInt32LE(2, 4);
  mip.writeInt32LE(0, 8); mip.writeInt32LE(0, 12);
  mip.writeInt32LE(png.length, 16);
  png.copy(mip, 20);
  const header = Buffer.alloc(9 + 9 + 4 * 8 + 9 + 4 * 2);
  let p = 0;
  header.write('TEXV0005\0', p, 'ascii'); p += 9;
  header.write('TEXI0001\0', p, 'ascii'); p += 9;
  header.writeInt32LE(0, p); p += 4; header.writeInt32LE(0, p); p += 4;
  header.writeInt32LE(2, p); p += 4; header.writeInt32LE(2, p); p += 4;
  header.writeInt32LE(2, p); p += 4; header.writeInt32LE(2, p); p += 4;
  header.writeInt32LE(0, p); p += 4;
  header.write('TEXB0002\0', p, 'ascii'); p += 9;
  header.writeInt32LE(1, p); p += 4; header.writeInt32LE(1, p); p += 4;
  const tex = Buffer.concat([header.subarray(0, p), mip]);
  const pkg = buildPkg([
    { path: 'scene.json', bytes: Buffer.from(JSON.stringify({ objects: [{ image: 'main.tex' }] })) },
    { path: 'main.tex', bytes: tex },
  ]);
  try {
    const r = pkgExtract.extractSceneMainImage(new Uint8Array(pkg));
    const same = Buffer.from(r.bytes).equals(Buffer.from(png));
    check('embedded PNG → passthrough', r.mime === 'image/png' && same, r.mime + ' ' + r.bytes.length + 'B');
  } catch (e) {
    check('embedded PNG → passthrough', false, e.message);
  }
}

// A2c: embedded MP4 payload → rejected (animation/video texture).
{
  // [u32 boxSize=24]['ftypmp42'][12 zero bytes] — 24 bytes total, boxSize sane.
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmp42'), Buffer.alloc(12)]);
  const mip = Buffer.alloc(20 + mp4.length);
  mip.writeInt32LE(2, 0); mip.writeInt32LE(2, 4);
  mip.writeInt32LE(0, 8); mip.writeInt32LE(0, 12);
  mip.writeInt32LE(mp4.length, 16);
  mp4.copy(mip, 20);
  const header = Buffer.alloc(9 + 9 + 4 * 8 + 9 + 4 * 2);
  let p = 0;
  header.write('TEXV0005\0', p, 'ascii'); p += 9;
  header.write('TEXI0001\0', p, 'ascii'); p += 9;
  header.writeInt32LE(0, p); p += 4; header.writeInt32LE(0, p); p += 4;
  header.writeInt32LE(2, p); p += 4; header.writeInt32LE(2, p); p += 4;
  header.writeInt32LE(2, p); p += 4; header.writeInt32LE(2, p); p += 4;
  header.writeInt32LE(0, p); p += 4;
  header.write('TEXB0002\0', p, 'ascii'); p += 9;
  header.writeInt32LE(1, p); p += 4; header.writeInt32LE(1, p); p += 4;
  const tex = Buffer.concat([header.subarray(0, p), mip]);
  const pkg = buildPkg([
    { path: 'scene.json', bytes: Buffer.from(JSON.stringify({ objects: [{ image: 'main.tex' }] })) },
    { path: 'main.tex', bytes: tex },
  ]);
  try {
    pkgExtract.extractSceneMainImage(new Uint8Array(pkg));
    check('embedded MP4 → rejected', false, 'no error raised');
  } catch (e) {
    check('embedded MP4 → rejected', /embedded mp4/.test(e.message), e.message);
  }
}

// A2d: grayscale-only scene → quality gate rejects → caller falls back.
{
  const gray = Buffer.alloc(4 * 4 * 4);
  for (let i = 0; i < 4 * 4; i++) {
    gray[i * 4] = 128; gray[i * 4 + 1] = 128; gray[i * 4 + 2] = 128; gray[i * 4 + 3] = 255;
  }
  const tex = buildTexRgba(4, 4, gray);
  const pkg = buildPkg([
    { path: 'scene.json', bytes: Buffer.from(JSON.stringify({ objects: [{ image: 'main.tex' }] })) },
    { path: 'main.tex', bytes: tex },
  ]);
  try {
    pkgExtract.extractSceneMainImage(new Uint8Array(pkg));
    check('grayscale texture → quality gate rejects', false, 'no error raised');
  } catch (e) {
    check('grayscale texture → quality gate rejects', /frame rejected|no decodable/.test(e.message), e.message);
  }
}

// A3: real workshop fixtures (probed; skipped when not installed).
const FIXTURES = [
  { file: process.env.DSH_WE_FIXTURE_1 || 'D:\\SteamLibrary\\steamapps\\workshop\\content\\431960\\3345141364\\scene.pkg', expect: 'materials/wallhaven-vqkme8.tex' },
  { file: process.env.DSH_WE_FIXTURE_2 || 'D:\\SteamLibrary\\steamapps\\workshop\\content\\431960\\3575109244\\scene.pkg', expect: 'materials/360albumviewer_imgproc_1242125.tex' },
];
for (const fx of FIXTURES) {
  if (!existsSync(fx.file)) { console.log('  (skip fixture ' + fx.file + ' — not present)'); continue; }
  try {
    const r = pkgExtract.extractSceneMainImage(new Uint8Array(readFileSync(fx.file)));
    const okMime = r.mime === 'image/jpeg' || r.mime === 'image/png';
    const okTex = r.texturePath === fx.expect;
    const okDims = r.width > 100 && r.height > 100;
    check('fixture ' + fx.file.split('\\').slice(-2).join('/'), okMime && okTex && okDims, r.mime + ' ' + r.width + 'x' + r.height + ' ← ' + r.texturePath);
  } catch (e) {
    check('fixture ' + fx.file.split('\\').slice(-2).join('/'), false, e.message);
  }
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
// 真实 http.IncomingMessage 是 EventEmitter; scene-frame 的等待者计数用
// req.once('close') — mock 需带同型 no-op。
function fakeReq(url) { return { url, headers: {}, method: 'GET', once: () => {} }; }
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
      // CPU worker 渲染首帧可达数十秒 (0.8.2 恢复两段式), 给足上限。
      const t = setTimeout(resolveFn, 120000);
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
  const scenes = (invBody.wallpapers || []).filter((w) => w.type === 'scene' && w.frameUrl);
  check('inventory exposes scene frameUrl', scenes.length > 0, scenes.length ? scenes.length + ' scene tokens minted' : 'no scene wallpaper with frameUrl on this machine');
  // 库里首个 scene 可能是 SDK 粒子特效预览 (CPU 渲染失败且无纹理候选 → 422
  // 属正确的回退行为)。挑第一个能产出静态帧的 scene 来做 payload/缓存断言;
  // 最多探测 8 个, 全失败则跳过 (机器上没有可渲染场景)。
  for (const scene of scenes.slice(0, 8)) {
    const t = scene.frameUrl.split('/').pop();
    const probe = await runHandler(sceneRoute, '/wallpaper-engine/scene-frame/' + t);
    if (probe.__state.status === 200 && probe.__state.body.length > 1000) {
      token = t;
      break;
    }
  }
}

if (token) {
  const firstRes = await runHandler(sceneRoute, '/wallpaper-engine/scene-frame/' + token);
  const okFirst = firstRes.__state.status === 200 && firstRes.__state.body.length > 1000;
  const ctype = firstRes.__state.headers['Content-Type'] || firstRes.__state.headers['content-type'] || '';
  check('scene-frame 200 + payload', okFirst, 'status=' + firstRes.__state.status + ' ' + firstRes.__state.body.length + 'B ' + ctype);
  check('scene-frame mime', /image\/(jpeg|png)/.test(ctype), ctype);
  // cache file written under the plugin data dir (env-overridden for tests)
  const cacheDir = TEST_CACHE_DIR;
  const cached = existsSync(cacheDir) ? readdirSync(cacheDir).filter((f) => f.startsWith('sf39_' + token + '_')) : [];
  check('frame cached on disk', cached.length >= 1, cacheDir + ' [' + cached.join(', ') + ']');

  // Second call must hit the cache (handler still returns the payload).
  const secondRes = await runHandler(sceneRoute, '/wallpaper-engine/scene-frame/' + token);
  check('scene-frame cache-hit returns payload', secondRes.__state.status === 200 && secondRes.__state.body.equals(firstRes.__state.body), secondRes.__state.body.length + 'B');
}

// C: error paths
{
  const res = await runHandler(sceneRoute, '/wallpaper-engine/scene-frame/not-a-real-token');
  check('unknown token → 404', res.__state.status === 404, 'status=' + res.__state.status);
}

// ── Level C: GL attachment 锚点 (MDAT0001) ─────────────────────────────────
// W7: 子对象 attachment 字段把 origin 锚定到父 puppet 的命名 MDAT 锚点
// (骨骼绑定位姿 + 锚点矩阵平移)。此前 gate 只折叠父链 origin → 发丝/脸/身体
// 被放到父对象原点附近 (3463520581 左侧橙发女性部件凌乱根因)。
console.log('Level C — GL attachment anchors (MDAT0001)');
const puppetExport = await import(pathToFileURL(resolve(root, 'lib', 'we-renderer', 'puppet-export.js')).href);
const { parseMdatAnchors, buildPuppetAnchors, buildPuppetPayload } = puppetExport;

/** 合成 MDAT0001 段: 魔数\0 + u32 段字节 + u16 计数 + 每条 [u16 骨骼 + 名\0 + 64B 矩阵]。 */
function synthMdl(entries, { truncateLastMatrix = false } = {}) {
  const body = [];
  for (const e of entries) {
    const head = Buffer.alloc(2);
    head.writeUInt16LE(e.boneIdx, 0);
    body.push(head, Buffer.from(e.name + '\0', 'utf8'));
    const m = Buffer.alloc(64);
    m.writeFloatLE(1, 0); m.writeFloatLE(1, 20); // 行0 占位 (解析只读平移)
    m.writeFloatLE(1, 20 + 20); m.writeFloatLE(1, 40);
    m.writeFloatLE(e.tx, 48); m.writeFloatLE(e.ty, 52); m.writeFloatLE(1, 60);
    body.push(truncateLastMatrix && e === entries[entries.length - 1] ? m.subarray(0, 32) : m);
  }
  const payload = Buffer.concat(body);
  // 计数为 u16, 紧跟第一条锚点的 u16 骨骼索引 (无对齐填充 — 与官方文件同布局)。
  const count = Buffer.alloc(2);
  count.writeUInt16LE(entries.length, 0);
  const magic = Buffer.from('MDAT0001\0', 'utf8');
  const segLen = Buffer.alloc(4);
  segLen.writeUInt32LE(magic.length + 4 + count.length + payload.length, 0);
  return Buffer.concat([Buffer.from('MDLV0014\0\0\0\0', 'utf8'), magic, segLen, count, payload]);
}

{
  const buf = synthMdl([
    { boneIdx: 0, name: 'Attachment', tx: -0.155, ty: -0.095 },
    { boneIdx: 2, name: 'head', tx: -32.515, ty: 116.414 },
  ]);
  const anchors = parseMdatAnchors(buf);
  check('MDAT0001 锚点解析 (名字/骨骼索引/平移)', anchors.length === 2
    && anchors[0].name === 'Attachment' && anchors[0].boneIdx === 0
    && Math.abs(anchors[0].ty + 0.095) < 1e-3
    && anchors[1].name === 'head' && anchors[1].boneIdx === 2
    && Math.abs(anchors[1].tx + 32.515) < 1e-3 && Math.abs(anchors[1].ty - 116.414) < 1e-3,
    JSON.stringify(anchors));

  // 矩阵被截断 → 该条丢弃且不抛 (坏 MDL 不能让 gate 挂)
  let threw = false;
  let trunc = [];
  try { trunc = parseMdatAnchors(synthMdl([{ boneIdx: 0, name: 'head', tx: 1, ty: 2 }], { truncateLastMatrix: true })); } catch { threw = true; }
  check('MDAT 矩阵越界 → 丢弃且不抛', !threw && trunc.length === 0, 'threw=' + threw + ' got=' + trunc.length);

  check('非 MDAT 数据 → 空锚点', parseMdatAnchors(Buffer.from('MDLV0014 nothing here', 'utf8')).length === 0);
  check('Uint8Array 输入同样可解析 (pkgSceneAccess 路径)', parseMdatAnchors(new Uint8Array(buf)).length === 2);

  // buildPuppetAnchors: 非 puppet 模型 / 无锚点 MDL 一律 null (调用方按无锚点)
  const acc = (bytes) => ({ readFile: () => (bytes ? { bytes } : null) });
  check('buildPuppetAnchors 非 puppet → null', buildPuppetAnchors(acc(buf), { material: 'x' }) === null);
  check('buildPuppetAnchors 无锚点 → null', buildPuppetAnchors(acc(Buffer.from('MDLV0014 nothing', 'utf8')), { puppet: 'models/p.mdl' }) === null);
  const info = buildPuppetAnchors(acc(buf), { puppet: 'models/p.mdl' });
  check('buildPuppetAnchors 合成 MDL → 锚点 + 空骨骼位姿',
    !!info && info.anchors.length === 2 && Array.isArray(info.boneRT) && info.boneRT.length === 0,
    info ? 'anchors=' + info.anchors.length + ' boneRT=' + info.boneRT.length : 'null');
}

// C3 端到端 (库里有带 attachment 的场景时才跑): gate 必须把锚点折进 effTr —
// 与"无锚点折叠"(只累加 origin/scale/angle) 不同的对象, 恰是带 attachment 的
// 对象; 不带 attachment 的对象两者必须一致 (无副作用回归)。
{
  const metaRoute = routes.find((r) => r.path === '/wallpaper-engine/scene-gl-meta');
  const scenes = ((invBody && invBody.wallpapers) || []).filter((w) => w.type === 'scene' && w.frameUrl);
  const vec3 = (s, def) => {
    const p = String(s == null ? def : s).trim().split(/\s+/).map(Number);
    return p.length >= 3 && !p.some(isNaN) ? p : def;
  };
  // 测试侧独立实现 (不引用 gate 代码): 只折叠父链 origin/scale/angles。
  const foldNoAnchor = (objs, obj) => {
    const byId = new Map(objs.map((o) => [o.id, o]));
    const chain = [obj];
    let cur = obj;
    for (let g = 0; cur.parent != null && g < 32; g++) {
      const p = byId.get(cur.parent);
      if (!p || chain.includes(p)) break;
      chain.push(p);
      cur = p;
    }
    const root = chain[chain.length - 1];
    let origin = vec3(root.origin, [0, 0, 0]);
    let scale = vec3(root.scale, [1, 1, 1]);
    let angle = vec3(root.angles, [0, 0, 0])[2];
    for (let i = chain.length - 2; i >= 0; i--) {
      const co = vec3(chain[i].origin, [0, 0, 0]);
      const cs = vec3(chain[i].scale, [1, 1, 1]);
      const cos = Math.cos(angle), sin = Math.sin(angle);
      origin = [origin[0] + co[0] * scale[0] * cos - co[1] * scale[1] * sin,
        origin[1] + co[0] * scale[0] * sin + co[1] * scale[1] * cos];
      scale = [scale[0] * cs[0], scale[1] * cs[1], scale[2] * cs[2]];
      angle += vec3(chain[i].angles, [0, 0, 0])[2];
    }
    return origin;
  };
  let tested = 0;
  let okAttached = 0;
  let okPlain = 0;
  let bad = 0;
  const notes = [];
  if (metaRoute) {
    for (const w of scenes) {
      if (tested >= 12) break;
      const t = w.frameUrl.split('/').pop();
      if (!t) continue;
      const metaRes = await runHandler(metaRoute, '/wallpaper-engine/scene-gl-meta/' + t);
      if (metaRes.__state.status !== 200) continue;
      let meta = null;
      try { meta = JSON.parse(metaRes.__state.body.toString('utf8')); } catch { continue; }
      if (!meta || meta.supported !== true || !meta.scene || !meta.scene.objects) continue;
      // 场景原始 json: token = base64url(scene.pkg|scene.json 绝对路径)
      let scene = null;
      try {
        const abs = Buffer.from(t, 'base64url').toString('utf8');
        const pkg = readFileSync(abs);
        const entries = pkgExtract.parsePkg(pkg);
        const e = entries.find((x) => /scene\.json$/.test(x.path));
        if (e) scene = JSON.parse(pkgExtract.readPkgEntry(pkg, e).toString('utf8'));
      } catch { /* 松散目录/不可读 → 跳过该壁纸 */ }
      if (!scene || !Array.isArray(scene.objects)) continue;
      tested++;
      const byName = new Map();
      for (const o of scene.objects) {
        if (!byName.has(o.name)) byName.set(o.name, []);
        byName.get(o.name).push(o);
      }
      for (const mo of meta.scene.objects) {
        if (!mo.effTr) continue;
        const cands = byName.get(mo.name) || [];
        // 同名多变体 (big/lil): 取折叠结果最接近的那个当同源对象
        let best = null;
        let bestD = Infinity;
        for (const c of cands) {
          const f = foldNoAnchor(scene.objects, c);
          const d = Math.abs(f[0] - mo.effTr.origin[0]) + Math.abs(f[1] - mo.effTr.origin[1]);
          if (d < bestD) { bestD = d; best = c; }
        }
        if (!best) continue;
        const noAnchor = foldNoAnchor(scene.objects, best);
        const same = Math.abs(noAnchor[0] - mo.effTr.origin[0]) < 0.5 && Math.abs(noAnchor[1] - mo.effTr.origin[1]) < 0.5;
        const chain = (() => {
          const byId = new Map(scene.objects.map((o) => [o.id, o]));
          let cur = best;
          for (let g = 0; cur.parent != null && g < 32; g++) { const p = byId.get(cur.parent); if (!p) break; cur = p; }
          return [best, cur];
        })();
        const hasAttach = typeof best.attachment === 'string' && best.attachment;
        if (hasAttach) { if (same) bad++; else okAttached++; }
        else if (same) okPlain++;
        else if (bestD > 0.5 && chain[0] !== chain[1]) bad++; // 无 attachment 却被位移 = 回归
      }
    }
  }
  if (tested === 0) {
    console.log('  · 跳过 C3 (本机松散库无可读 scene.json / 无 scene-gl 场景)');
  } else {
    check('带 attachment 的对象 effTr 已含锚点偏移', okAttached > 0 && bad === 0,
      'attached-shifted=' + okAttached + ' plain-equal=' + okPlain + ' bad=' + bad + (notes.length ? ' ' + notes.join(';') : ''));
  }
}

// ── Level D: MDLS 骨骼条目解析 (0.8.13) ────────────────────────────────────
// 真因回归: MDLS 条目尾部 = [0x00][名字], **名字没有终止符**, 直接接下一根骨骼
// 的 9 字节头。旧实现只跳过第一个 0x00 (落到名字上) → 第二根起头全错、循环很
// 快越界 → 声明 N 根只解析出 1 根 (3463520581 `asuna body bottom` 声明 7 根 →
// 锚点 boneIdx=2 越界归零 → 头部/躯干整组少走 (+230,+274), 画面双头/错位)。
console.log('Level D — MDLS 骨骼条目 (名字无终止符)');
const { installPuppet } = await import(pathToFileURL(resolve(root, 'lib', 'we-renderer', 'puppet.js')).href);

/** 合成 MDL: 头部 + 顶点块 (stride 80) + 索引块 + MDLS 段 (骨骼矩阵/父子/名字)。 */
function synthBoneMdl(bones) {
  const head = Buffer.alloc(17);
  Buffer.from('MDLV0014', 'utf8').copy(head, 0);
  const verts = [];
  for (const b of bones) { // 每根骨骼 1 个顶点, 位置取骨骼平移 (便于断言)
    const v = Buffer.alloc(80);
    v.writeFloatLE(b.tx, 0); v.writeFloatLE(b.ty, 4); v.writeFloatLE(0, 8);
    v.writeFloatLE(1, 20); v.writeFloatLE(1, 60); v.writeFloatLE(0, 72); v.writeFloatLE(0, 76);
    verts.push(v);
  }
  // 顶点块布局须匹配 _parseMdl 扫描: offset+4 = 顶点字节数, offset+8 = 顶点起点
  head.writeUInt32LE(verts.length * 80, 13);
  const idx = Buffer.alloc(2); idx.writeUInt16LE(0, 0);
  const indexBytes = Buffer.alloc(4); indexBytes.writeUInt32LE(idx.length, 0);
  const seg = [];
  for (let i = 0; i < bones.length; i++) {
    const b = bones[i];
    const h = Buffer.alloc(13); // tmp(u8) + type(u32) + parent(i32) + len(u32)
    h.writeUInt8(b.tmp == null ? 0 : b.tmp, 0);
    h.writeUInt32LE(b.type == null ? (i === 0 ? 0 : 1) : b.type, 1);
    h.writeInt32LE(b.parent, 5);
    h.writeUInt32LE(64, 9);
    const m = Buffer.alloc(64);
    m.writeFloatLE(1, 0); m.writeFloatLE(1, 20); m.writeFloatLE(1, 40); m.writeFloatLE(1, 60);
    m.writeFloatLE(b.tx, 48); m.writeFloatLE(b.ty, 52);
    const tail = b.name ? Buffer.concat([Buffer.from([0]), Buffer.from(b.name, 'utf8')]) : Buffer.from([0]);
    seg.push(h, m, tail);
  }
  const payload = Buffer.concat(seg);
  const mh = Buffer.alloc(17);
  Buffer.from('MDLS0004\0', 'utf8').copy(mh, 0);
  mh.writeUInt32LE(payload.length + 4, 9);
  mh.writeUInt32LE(bones.length, 13); // 计数紧随段字节字段 (offset 13)
  const mdls = Buffer.concat([mh, payload]);
  return Buffer.concat([head, ...verts, indexBytes, idx, mdls]);
}
function synthMdatAfterMdl(mdl, anchors) {
  const body = [];
  for (const a of anchors) {
    const h = Buffer.alloc(2); h.writeUInt16LE(a.boneIdx, 0);
    body.push(h, Buffer.from(a.name + '\0', 'utf8'));
    const m = Buffer.alloc(64);
    m.writeFloatLE(1, 0); m.writeFloatLE(1, 20); m.writeFloatLE(1, 40); m.writeFloatLE(1, 60);
    m.writeFloatLE(a.tx, 48); m.writeFloatLE(a.ty, 52);
    body.push(m);
  }
  const payload = Buffer.concat(body);
  const seg = Buffer.alloc(13);
  Buffer.from('MDAT0001\0', 'utf8').copy(seg, 0);
  seg.writeUInt32LE(9 + 4 + 2 + payload.length, 9);
  const cnt = Buffer.alloc(2); cnt.writeUInt16LE(anchors.length, 0);
  return Buffer.concat([mdl, seg, cnt, payload]);
}
const parseBones = (mdl) => {
  const proto = {};
  installPuppet(proto);
  proto.pkg = { read: () => mdl };
  proto.log = () => {};
  proto.onDegraded = null;
  const mesh = proto._parseMdl(mdl);
  return mesh ? mesh.bones : null;
};

{
  // D1: 带名字的 4 根骨骼 (第一根就带名 — 旧实现从第二根起错位)
  const named = [
    { name: 'legs', parent: -1, tx: 219.592, ty: 50.151 },
    { name: 'skirt', parent: 0, tx: -3.134, ty: 57.058 },
    { name: '', parent: 1, tx: 13.9, ty: 167.0 },
    { name: 'a-very-long-bone-name-0123456789', parent: 2, tx: -63.0, ty: 27.7 },
  ];
  const par = parseBones(synthBoneMdl(named));
  check('MDLS 带名骨骼全部解析 (4/4)', !!par && par.length === 4, par ? 'parsed=' + par.length : 'null');
  check('MDLS 带名骨骼父子/平移正确', !!par && par.length === 4 && par.every((b, i) => b.parent === named[i].parent
    && Math.abs(b.bind[12] - named[i].tx) < 1e-3 && Math.abs(b.bind[13] - named[i].ty) < 1e-3),
    par ? par.map((b, i) => `${i}:p${b.parent}/${b.bind[12].toFixed(1)}`).join(' ') : 'null');
  // D2: 无名骨骼 (旧实现唯一正确的形态) 不回归
  const anon = [{ name: '', parent: -1, tx: 1, ty: 2 }, { name: '', parent: 0, tx: 3, ty: 4 }, { name: '', parent: 1, tx: 5, ty: 6 }];
  const par2 = parseBones(synthBoneMdl(anon));
  check('MDLS 无名骨骼仍全部解析 (3/3)', !!par2 && par2.length === 3, par2 ? 'parsed=' + par2.length : 'null');
  // D3: 锚点骨骼索引随之可解析 (boneIdx 越界归零 = 旧实现的整组错位根因)
  const mdl = synthMdatAfterMdl(synthBoneMdl(named), [{ boneIdx: 2, name: 'Attachment bottom', tx: 2.772, ty: 103.002 }]);
  const info = buildPuppetAnchors({ readFile: () => ({ bytes: mdl }) }, { puppet: 'models/x.mdl' });
  const bt = info && info.boneRT && info.boneRT[2];
  check('锚点 boneIdx=2 → 骨骼 2 世界位姿 (非越界归零)',
    !!bt && Math.abs(bt.tx - 230.358) < 0.5 && Math.abs(bt.ty - 274.209) < 0.5,
    bt ? `bone2=(${bt.tx.toFixed(3)}, ${bt.ty.toFixed(3)})` : 'null');
}


// ── Level E: 旧容器 (MDLV0013/0016) 紧凑顶点记录 + MDLA 首帧装配 (0.8.14) ──
// 真因回归: MDLV0013/0016 的顶点记录是 **52B 紧凑形态** (pos 12B 后直接是 4 个
// 顶点索引 + 4 个权重 + uv), 没有新容器 (MDLV0021/0023) 的 28B 法线/切线区。
// 旧实现只按 80B 记录扫 → 扫不到任何顶点块 → _parseMdl 返回 null → GL 侧退化成
// "木偶数据解析失败, 按静态贴图渲染" → 整张图集 (atlas) 平铺上屏, 图集上散列的
// 部件 (斗篷/左右披风片) 就"脱离人物" (2686862510 用户实证)。
// 第二层: 旧容器的 MDLS bind 是**图集排版姿态**, 渲染姿态 = MDLA 首帧 (每骨
// 8B 段头 + (frameCount+1)×36B, 行 9 float: pos 列 0/1, rotZ 列 5) — 不烘焙首帧
// 即使网格解析出来, 部件仍停在图集排版位置。
console.log('Level E — 旧容器紧凑顶点记录 + MDLA 首帧装配');

/** 合成紧凑 (52B 记录) 容器的 MDL: 头部 + u32 0 + u32 顶点字节 + 顶点 + u32 索引字节 + 索引 [+ MDLS + MDLA]。 */
function synthCompactMdl({ bones = [], verts, indices, anim = null, breakWeights = false }) {
  const name = Buffer.from('models/compact.json\0', 'utf8');
  // 头部 = 魔数\0(9) + u16 9 + u16 384 + u32 1 + u32 1 + 名字\0 + 2B 填充 + 块前导 u32 0
  const blockOff = 21 + name.length + 2;
  const head = Buffer.alloc(blockOff + 8);
  Buffer.from('MDLV0013\0', 'utf8').copy(head, 0);
  head.writeUInt16LE(9, 9); head.writeUInt16LE(384, 11);
  head.writeUInt32LE(1, 13); head.writeUInt32LE(1, 17);
  name.copy(head, 21);
  head.writeUInt32LE(0, blockOff);              // 块前导字段 (实测为 0)
  head.writeUInt32LE(verts.length * 52, blockOff + 4);
  const vs = [];
  for (const v of verts) {
    const b = Buffer.alloc(52);
    b.writeFloatLE(v.x, 0); b.writeFloatLE(v.y, 4); b.writeFloatLE(v.z || 0, 8);
    for (let k = 0; k < 4; k++) b.writeUInt32LE(v.bi[k], 12 + k * 4);
    for (let k = 0; k < 4; k++) b.writeFloatLE(breakWeights ? 0 : v.bw[k], 28 + k * 4);
    b.writeFloatLE(v.u, 44); b.writeFloatLE(v.v, 48);
    vs.push(b);
  }
  const idx = Buffer.alloc(indices.length * 2);
  indices.forEach((x, i) => idx.writeUInt16LE(x, i * 2));
  const il = Buffer.alloc(4); il.writeUInt32LE(idx.length, 0);
  const parts = [head, ...vs, il, idx];
  if (bones.length) {
    const seg = [];
    for (let i = 0; i < bones.length; i++) {
      const bo = bones[i];
      const h = Buffer.alloc(13);
      h.writeUInt8(0, 0); h.writeUInt32LE(1, 1); h.writeInt32LE(bo.parent, 5); h.writeUInt32LE(64, 9);
      const m = Buffer.alloc(64);
      m.writeFloatLE(1, 0); m.writeFloatLE(1, 20); m.writeFloatLE(1, 40); m.writeFloatLE(1, 60);
      m.writeFloatLE(bo.tx, 48); m.writeFloatLE(bo.ty, 52);
      seg.push(h, m, Buffer.from([0]));
    }
    const payload = Buffer.concat(seg);
    const mh = Buffer.alloc(17);
    Buffer.from('MDLS0001\0', 'utf8').copy(mh, 0);
    mh.writeUInt32LE(payload.length + 4, 9);
    mh.writeUInt32LE(bones.length, 13);
    parts.push(Buffer.concat([mh, payload]));
  }
  if (anim) {
    const { fps, frameCount, rows } = anim;
    const segBytes = (frameCount + 1) * 36;
    const body = [];
    for (const r of rows) {
      const s = Buffer.alloc(8 + segBytes);
      s.writeUInt32LE(0, 0); s.writeUInt32LE(segBytes, 4);
      for (let f = 0; f <= frameCount; f++) {
        const o = 8 + f * 36;
        s.writeFloatLE(r.px, o); s.writeFloatLE(r.py, o + 4); s.writeFloatLE(0, o + 8);
        s.writeFloatLE(r.rot || 0, o + 20);
        s.writeFloatLE(1, o + 24); s.writeFloatLE(1, o + 28); s.writeFloatLE(1, o + 32);
      }
      body.push(s);
    }
    // 动画记录: u32 id + u32 0 + 名字\0 + 循环标志\0 + float fps + u32 frameCount
    //           + u32 0 + u32 boneCount   (动画计数已在 MDLA 头 u32@13)
    const hdr = Buffer.alloc(64);
    let q = 0;
    hdr.writeUInt32LE(7, q); q += 4;              // 动画 id
    hdr.writeUInt32LE(0, q); q += 4;
    Buffer.from('A\0loop\0', 'utf8').copy(hdr, q); q += 7;
    hdr.writeFloatLE(fps, q); hdr.writeUInt32LE(frameCount, q + 4);
    hdr.writeUInt32LE(0, q + 8); hdr.writeUInt32LE(rows.length, q + 12);
    const mh = Buffer.alloc(17);
    Buffer.from('MDLA0001\0', 'utf8').copy(mh, 0);
    mh.writeUInt32LE(0, 9);                        // 段尾偏移 (解析不依赖)
    mh.writeUInt32LE(1, 13);
    parts.push(Buffer.concat([mh, hdr.slice(0, q + 16), ...body])); // mh 已含动画计数
  }
  return Buffer.concat(parts);
}
const parseMdl = (mdl) => {
  const proto = {};
  installPuppet(proto);
  proto.pkg = { read: () => mdl };
  proto.log = () => {};
  proto.onDegraded = null;
  return { proto, mesh: proto._parseMdl(mdl) };
};
const geoC = [
  { x: 100, y: 200, z: 0, bi: [0, 0, 0, 0], bw: [1, 0, 0, 0], u: 0.1, v: 0.2 },
  { x: 300, y: 400, z: 0, bi: [1, 0, 0, 0], bw: [1, 0, 0, 0], u: 0.3, v: 0.4 },
  { x: 500, y: 600, z: 0, bi: [0, 1, 0, 0], bw: [0.5, 0.5, 0, 0], u: 0.5, v: 0.6 },
];
const bonesC = [{ parent: -1, tx: 10, ty: 20 }, { parent: 0, tx: 30, ty: 40 }];
{
  // E1: 紧凑记录能被解析 (旧实现 80B 扫描恒 null)
  const { mesh } = parseMdl(synthCompactMdl({ bones: bonesC, verts: geoC, indices: [0, 1, 2] }));
  check('紧凑容器顶点块解析 (3 顶点/3 索引)', !!mesh && mesh.vertexCount === 3 && mesh.indexCount === 3,
    mesh ? mesh.vertexCount + 'v/' + mesh.indexCount + 'i' : 'null');
  check('紧凑容器标记为旧容器', !!mesh && mesh.legacyContainer === true, mesh ? 'legacyContainer=' + mesh.legacyContainer : 'null');
  // E2: 字段偏移正确 (pos/blendIdx/weights/uv 各就各位)
  check('紧凑记录字段偏移正确 (pos/i/w/uv)',
    !!mesh && mesh.positions[1][0] === 300 && mesh.positions[1][1] === 400
    && mesh.blendIndices[2][1] === 1 && mesh.blendWeights[2][0] === 0.5
    && Math.abs(mesh.uvs[2][0] - 0.5) < 1e-6 && Math.abs(mesh.uvs[2][1] - 0.6) < 1e-6,
    mesh ? JSON.stringify({ p: mesh.positions[1].slice(0, 2), bi: mesh.blendIndices[2], bw: mesh.blendWeights[2], uv: mesh.uvs[2] }) : 'null');
  // E3: 权重不合法 (全 0) 时紧凑回退必须拒绝该块 (严格判据防噪声块误判)
  const bad = parseMdl(synthCompactMdl({ bones: bonesC, verts: geoC, indices: [0, 1, 2], breakWeights: true }));
  check('紧凑块权重非法 → 不误判 (返回 null)', bad.mesh === null, bad.mesh ? 'parsed=' + bad.mesh.vertexCount : 'null');
  // E4: MDLA 首帧装配姿态 (每骨 8B 段头 + (fc+1)×36B 行, pos 列 0/1, rotZ 列 5)
  const withAnim = synthCompactMdl({
    bones: bonesC, verts: geoC, indices: [0, 1, 2],
    anim: { fps: 3.625, frameCount: 2, rows: [{ px: 10, py: 20, rot: 0 }, { px: 5, py: 5, rot: 0 }] },
  });
  const animParsed = parseMdl(withAnim);
  const meshA = animParsed.mesh;
  check('MDLA 头按偏移直读 (fps≠30 也能解析)',
    !!meshA && !!meshA.legacyAnim && meshA.legacyAnim.fps === 3.625 && meshA.legacyAnim.frameCount === 2
    && meshA.legacyAnim.boneCount === 2 && meshA.legacyAnim.segBytes === 3 * 36,
    meshA && meshA.legacyAnim ? JSON.stringify({ fps: meshA.legacyAnim.fps, fc: meshA.legacyAnim.frameCount, seg: meshA.legacyAnim.segBytes }) : 'null');
  check('旧容器动画不进物化列表 (逐帧布局未验证)',
    !!meshA && meshA.animations.length === 0, meshA ? 'animations=' + meshA.animations.length : 'null');
  const rt = meshA && animParsed.proto._legacyPoseRT(meshA, 0);
  check('首帧世界姿势 = 父链合成 (b0(10,20) / b1(15,25))',
    !!rt && Math.abs(rt[0].tx - 10) < 1e-4 && Math.abs(rt[0].ty - 20) < 1e-4
    && Math.abs(rt[1].tx - 15) < 1e-4 && Math.abs(rt[1].ty - 25) < 1e-4,
    rt ? rt.map((r) => `(${r.tx.toFixed(2)},${r.ty.toFixed(2)})`).join(' ') : 'null');
  // E5: payload 烘焙首帧 (bind 世界 b1=(40,60) → 首帧 (15,25) ⇒ Δ(−25,−35))
  const payload = buildPuppetPayload({ readFile: () => ({ bytes: withAnim }) }, { puppet: 'models/compact.mdl' });
  const px = payload ? [payload.positions[0], payload.positions[1], payload.positions[3], payload.positions[4], payload.positions[6], payload.positions[7]] : null;
  check('payload 顶点按首帧装配烘焙 (v1 → 275,365; v2 权重 0.5/0.5 → 487.5,582.5)',
    !!px && Math.abs(px[0] - 100) < 1e-3 && Math.abs(px[1] - 200) < 1e-3
    && Math.abs(px[2] - 275) < 1e-3 && Math.abs(px[3] - 365) < 1e-3
    && Math.abs(px[4] - 487.5) < 1e-3 && Math.abs(px[5] - 582.5) < 1e-3,
    px ? px.map((n) => n.toFixed(2)).join(',') : 'null');
  // E6: 无 MDLA 的旧容器 → 不烘焙 (退回 bind 网格), 不抛
  const m6 = parseMdl(synthCompactMdl({ bones: bonesC, verts: geoC, indices: [0, 1, 2] })).mesh;
  const p6 = buildPuppetPayload({ readFile: () => ({ bytes: synthCompactMdl({ bones: bonesC, verts: geoC, indices: [0, 1, 2] }) }) }, { puppet: 'models/compact.mdl' });
  check('旧容器无 MDLA → 保留 bind 网格 (v1 仍 300,400)',
    !m6.legacyAnim && !!p6 && p6.positions[3] === 300 && p6.positions[4] === 400,
    p6 ? p6.positions[3] + ',' + p6.positions[4] : 'null');
  // E7: 新容器 (stride 80) 仍走主路径, 不被标记旧容器 (零回归判据)
  const namedD = [{ name: 'legs', parent: -1, tx: 219.592, ty: 50.151 }, { name: 'skirt', parent: 0, tx: -3.134, ty: 57.058 }];
  const m80 = parseMdl(synthBoneMdl(namedD)).mesh;
  check('80B 记录主路径不受影响 (legacyContainer=false)',
    !!m80 && m80.legacyContainer === false && m80.vertexCount === 2, m80 ? 'legacyContainer=' + m80.legacyContainer + ' ' + m80.vertexCount + 'v' : 'null');
  // E8/E9: animationlayers 语义 — 对象未挂可见层 = 未播放动画 → 不物化动画帧
  // (客户端同口径渲染绑定姿态; 3302695207 人物 根骨帧0≠bind 整体平移
  // (-447,-704) 的根因修复)。库里有"80B 容器 + MDLA"的场景时才跑 (合成夹具
  // 只有旧容器, 其动画本就不物化)。
  const { hasVisibleAnimLayer } = puppetExport;
  check('hasVisibleAnimLayer: 无字段/空数组/隐藏层 = false, 可见层 = true',
    hasVisibleAnimLayer({}) === false && hasVisibleAnimLayer({ animationlayers: [] }) === false
    && hasVisibleAnimLayer({ animationlayers: [{ visible: false }] }) === false
    && hasVisibleAnimLayer({ animationlayers: [{ visible: false }, { visible: true }] }) === true
    && hasVisibleAnimLayer({ animationlayers: [{ blend: 1 }] }) === true);
  let animFixture = null;
  try {
    const sceneWs = ((invBody && invBody.wallpapers) || []).filter((w) => w.type === 'scene' && w.frameUrl);
    for (const w of sceneWs) {
      if (animFixture) break;
      const abs = Buffer.from(String(w.frameUrl).split('/').pop(), 'base64url').toString('utf8');
      if (!abs || !existsSync(abs)) continue;
      const pkg = readFileSync(abs);
      const entries = pkgExtract.parsePkg(pkg);
      const byPath = new Map(entries.map((x) => [x.path, x]));
      const sjE = entries.find((x) => /scene\.json$/.test(x.path));
      if (!sjE) continue;
      const sj = JSON.parse(pkgExtract.readPkgEntry(pkg, sjE).toString('utf8'));
      const access = {
        readFile: (p) => { const e = byPath.get(p); return e ? { bytes: pkgExtract.readPkgEntry(pkg, e) } : null; },
      };
      for (const o of sj.objects || []) {
        if (typeof o.image !== 'string') continue;
        const mE = byPath.get(o.image);
        if (!mE) continue;
        let m = null;
        try { m = JSON.parse(pkgExtract.readPkgEntry(pkg, mE).toString('utf8')); } catch { continue; }
        if (!m || typeof m.puppet !== 'string' || !byPath.get(m.puppet)) continue;
        const pOn = buildPuppetPayload(access, m, { animationlayers: [{ animation: 0, blend: 1, visible: true }] });
        if (pOn && pOn.animations.length) { animFixture = { access, m, pOn }; break; }
      }
    }
  } catch { /* 松散目录/不可读 → 跳过 */ }
  if (animFixture) {
    const { access, m, pOn } = animFixture;
    const pOff = buildPuppetPayload(access, m, { animationlayers: [] });
    const pAbsent = buildPuppetPayload(access, m, {});
    const pLegacyCall = buildPuppetPayload(access, m); // 旧调用形态 (无第三参)
    check('未挂 animationlayers → 不物化动画帧 (绑定姿态渲染)',
      !!pOff && pOff.animations.length === 0 && !!pAbsent && pAbsent.animations.length === 0,
      `空数组=${pOff && pOff.animations.length} 无字段=${pAbsent && pAbsent.animations.length}`);
    check('挂可见层 → payload 与旧调用形态逐位一致 (零回归)',
      !!pOn && !!pLegacyCall && JSON.stringify(pOn) === JSON.stringify(pLegacyCall),
      pLegacyCall ? `animations=${pLegacyCall.animations.length}` : 'null');
  } else {
    console.log('  · 跳过 animationlayers 物化 (本机库无可读的带动画 80B 容器 puppet)');
  }
}

if (typeof dispose === 'function') dispose();

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
