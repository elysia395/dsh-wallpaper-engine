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
    // 3840×2160 全场景渲染 (worker + 效果) 实测 20-30s (lens_flare_sun 等
    // 全分辨率效果) — 8s 等待在冷缓存时会超时 → 0B 误报。放宽到 90s。
    await new Promise((resolveFn) => {
      const t = setTimeout(resolveFn, 90000);
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
  const scene = (invBody.wallpapers || []).find((w) => w.type === 'scene' && w.frameUrl);
  token = scene ? scene.frameUrl.split('/').pop() : null;
  check('inventory exposes scene frameUrl', Boolean(token), token ? 'frame token minted' : 'no scene wallpaper with frameUrl on this machine');
}

if (token) {
  const firstRes = await runHandler(sceneRoute, '/wallpaper-engine/scene-frame/' + token);
  const okFirst = firstRes.__state.status === 200 && firstRes.__state.body.length > 1000;
  const ctype = firstRes.__state.headers['Content-Type'] || firstRes.__state.headers['content-type'] || '';
  check('scene-frame 200 + payload', okFirst, 'status=' + firstRes.__state.status + ' ' + firstRes.__state.body.length + 'B ' + ctype);
  check('scene-frame mime', /image\/(jpeg|png)/.test(ctype), ctype);
  // cache file written under the plugin data dir (env-overridden for tests)
  // 键 = sf34_<gpuFlag>_<token>_<fw>x<fh>_<mtime> (gpuFlag 隔离 GPU/CPU, 尺寸隔离非 16:9)
  const cacheDir = TEST_CACHE_DIR;
  const cached = existsSync(cacheDir) ? readdirSync(cacheDir).filter((f) => f.startsWith('sf34_') && f.includes(token)) : [];
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
if (typeof dispose === 'function') dispose();

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
