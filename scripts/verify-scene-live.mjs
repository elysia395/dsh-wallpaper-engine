#!/usr/bin/env node
/**
 * verify-scene-live.mjs — WebWallGL live render pipeline self-test.
 *
 * Levels:
 *   A. Vendor artifacts: lib/webwallgl/ carries the renderer page with
 *      /wallpaper-engine/scene-live/-prefixed asset refs and an .upstream.json
 *      whose file list actually exists (sync-webwallgl.mjs output).
 *   B. /scene-live route (mock webServer): index.html + hashed assets serve
 *      with the right mime/cache headers, the directory fence rejects escapes
 *      (encoded ../), and non-GET is 405.
 *   C. /scene-files route: a synthetic Steam library fixture (DSH_WE_STEAM_ROOT
 *      → temp dir with steamapps/common/wallpaper_engine + workshop content)
 *      drives the real inventory so a token gets minted; asserts scene pkg /
 *      project.json byte-for-byte serving, the fence, unknown-token 404,
 *      missing-subpath 404 and Range/206.
 *   D. Client source contract: src/client.js exposes the live pieces
 *      (priority chain, heartbeat, audio mux, key extension) — cheap static
 *      assertions that fail loudly when a refactor drops the wiring.
 *
 * Runs anywhere (no Steam needed — the fixture is synthetic).
 *
 * Usage:  node scripts/verify-scene-live.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable, Writable } from 'node:stream';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Keep every cache/config write inside the workspace (same stance as
// verify-scene.mjs) — apply() may sweep/purge caches on startup.
const TEST_CACHE_DIR = join(root, '.test-cache', 'scene-live');
process.env.DSH_WE_CACHE_DIR = TEST_CACHE_DIR;
// Custom-storage fixture, created BEFORE lib/index.js is imported: UPLOAD_DIR
// is resolved at module load, and the inventory scan must see the fixture from
// its very first call (the scan result is TTL-cached for 3 s).
const TEST_UPLOAD_DIR = join(TEST_CACHE_DIR, 'uploads-fixture');
process.env.DSH_WE_UPLOAD_DIR = TEST_UPLOAD_DIR;
// 设置文件（config.json）也挪进来：本脚本会 PUT 设置来验证「覆盖值 → HTML 种子」
// 这条链路，绝不能碰用户真实的那份（pluginDataDir 认这个变量，不设时行为不变）。
const TEST_DATA_DIR = join(TEST_CACHE_DIR, 'data');
process.env.DSH_WE_DATA_DIR = TEST_DATA_DIR;
// POSIX 读 $HOME、Windows 读 %USERPROFILE%，两个都覆盖。
const TEST_HOME = join(TEST_CACHE_DIR, 'home');
mkdirSync(TEST_HOME, { recursive: true });
process.env.HOME = TEST_HOME;
process.env.USERPROFILE = TEST_HOME;

/** Minimal PKGV writer (raw entries) — mirrors the synthetic builder in
 *  verify-scene.mjs so the static-frame extractor has something real to chew on. */
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
  const mip = Buffer.alloc(20 + rgbaBytes.length);
  mip.writeInt32LE(width, 0);
  mip.writeInt32LE(height, 4);
  mip.writeInt32LE(0, 8);
  mip.writeInt32LE(0, 12);
  mip.writeInt32LE(rgbaBytes.length, 16);
  rgbaBytes.copy(mip, 20);
  const header = Buffer.alloc(9 + 9 + 4 * 8 + 9 + 4 * 2);
  let p = 0;
  header.write('TEXV0005\0', p, 'ascii'); p += 9;
  header.write('TEXI0001\0', p, 'ascii'); p += 9;
  header.writeInt32LE(0, p); p += 4;  // RGBA8888
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
/** 32×32 noise RGBA (noise survives the extractor's flatness/color gates). */
function noiseRgba(w) {
  const rgba = Buffer.alloc(w * w * 4);
  let seed = 0x12345678;
  for (let i = 0; i < w * w; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    rgba[i * 4] = seed & 0xff;
    rgba[i * 4 + 1] = (seed >> 8) & 0xff;
    rgba[i * 4 + 2] = (seed >> 16) & 0xff;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}
function writeUploadsFixture() {
  rmSync(TEST_UPLOAD_DIR, { recursive: true, force: true });
  // A WE project directory, exactly the shape a WallpaperEM downloads folder
  // has: project.json declaring scene.json while only scene.pkg ships.
  const projDir = join(TEST_UPLOAD_DIR, 'my-scene-1');
  mkdirSync(projDir, { recursive: true });
  const pkg = buildPkg([
    { path: 'scene.json', bytes: Buffer.from(JSON.stringify({ objects: [{ image: 'main.tex' }] })) },
    { path: 'main.tex', bytes: buildTexRgba(32, 32, noiseRgba(32)) },
  ]);
  writeFileSync(join(projDir, 'scene.pkg'), pkg);
  writeFileSync(join(projDir, 'project.json'), JSON.stringify({
    title: 'Custom Dir Scene', type: 'scene', file: 'scene.json', preview: 'preview.jpg',
    contentrating: 'Everyone',
  }));
  writeFileSync(join(projDir, 'preview.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  // A legacy single-file upload must keep working alongside directories.
  writeFileSync(join(TEST_UPLOAD_DIR, 'up-fixture-image.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
}
writeUploadsFixture();

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) passed++;
  else failed++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
}

// ── Level A: vendor artifacts ────────────────────────────────────────────────
console.log('Level A — vendored WebWallGL renderer page');
const vendorDir = join(root, 'lib', 'webwallgl');
const vendorHtmlPath = join(vendorDir, 'index.html');
check('lib/webwallgl/index.html exists', existsSync(vendorHtmlPath));
const vendorHtml = existsSync(vendorHtmlPath) ? readFileSync(vendorHtmlPath, 'utf8') : '';
const assetRefs = [...vendorHtml.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
check('renderer html references assets under /wallpaper-engine/scene-live/',
  assetRefs.length > 0 && assetRefs.every((r) => r.startsWith('/wallpaper-engine/scene-live/')),
  assetRefs.length + ' refs');
const upstreamPath = join(vendorDir, '.upstream.json');
check('.upstream.json present', existsSync(upstreamPath));
if (existsSync(upstreamPath)) {
  const up = JSON.parse(readFileSync(upstreamPath, 'utf8'));
  const missing = (up.files || []).filter((f) => !existsSync(join(vendorDir, f)));
  check('.upstream.json files all exist on disk', missing.length === 0,
    missing.length ? 'missing: ' + missing.join(', ') : (up.name || '') + '@' + (up.version || '?'));
}

// 网页壁纸帧率上限的实现质量与 shim 幂等性 —— 这两条都是实测踩过的坑，且都藏在
// vendor 产物里：升级上游后若忘记重新 vendor，断言会直接指出。
const vendoredShim = existsSync(join(vendorDir, 'web-shim.js'))
  ? readFileSync(join(vendorDir, 'web-shim.js'), 'utf8') : '';
check('vendored shim throttles by vsync frame-skip (not setTimeout)',
  /Math\.ceil\(1000 \/ fps \/ nativeMs/.test(vendoredShim),
  '跳过帧的节流（旧实现 setTimeout 会产出 17/33/50ms 抖动）');
check('vendored shim installs only once (idempotent guard)',
  /__weShimInstalled/.test(vendoredShim),
  '双 shim 会让 rAF 节流叠加：15fps 上限实测变成 7.5fps');
const vendoredBundle = assetRefs
  .filter((r) => r.endsWith('.js'))
  .map((r) => { try { return readFileSync(join(vendorDir, r.replace('/wallpaper-engine/scene-live/', '')), 'utf8'); } catch { return ''; } })
  .join('\n');
check('renderer rewrite recognises any data-we-shim value (host-injected shim)',
  vendoredBundle.includes('data-we-shim(?:-src)?'),
  '宿主注入的是 data-we-shim="host"，按值匹配会重复注入');

// ── shared mock webServer + req/res shims ───────────────────────────────────
const routes = [];
const mockCtx = {
  webServer: {
    register(route) { routes.push(route); return () => { const i = routes.indexOf(route); if (i >= 0) routes.splice(i, 1); }; },
    tapIndex() { return () => {}; },
  },
};
const hostMod = await import(pathToFileURL(resolve(root, 'lib', 'index.js')).href);
const host = hostMod.default || hostMod;
const apply = host.apply || (host.inject && host.apply);
const dispose = apply(mockCtx);

function fakeReq(url, headers) {
  return { url, headers: headers || {}, method: 'GET' };
}
function fakeRes() {
  const state = { status: 200, headers: {}, body: Buffer.alloc(0), ended: false };
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
/** 带请求体的 fake 请求（settings PUT）：handler 里是 req.on('data'/'end')，用 Readable 即可。 */
function fakeReqBody(url, method, obj) {
  const r = Readable.from([Buffer.from(JSON.stringify(obj))]);
  r.url = url;
  r.method = method;
  r.headers = { 'content-type': 'application/json' };
  return r;
}
/** 等响应 end/finish（PUT 的应答在写盘之后才发，等它就是等持久化完成）。 */
function waitRes(res) {
  return new Promise((resolveFn) => {
    if (res.__state.ended) { resolveFn(); return; }
    const t = setTimeout(resolveFn, 5000);
    res.on('finish', () => { clearTimeout(t); resolveFn(); });
  });
}
async function runHandler(route, url, headers) {
  const res = fakeRes();
  const done = route.handler(fakeReq(url, headers), res);
  if (done && typeof done.then === 'function') await done;
  if (!res.__state.ended) {
    await new Promise((resolveFn) => {
      const t = setTimeout(resolveFn, 8000);
      res.on('finish', () => { clearTimeout(t); resolveFn(); });
    });
  }
  return res;
}
const h = (res, k) => res.__state.headers[k] || res.__state.headers[k.toLowerCase()] || '';

// ── Level B: /scene-live static route ────────────────────────────────────────
console.log('Level B — /scene-live route (mock webServer)');
const liveRoute = routes.find((r) => r.path === '/wallpaper-engine/scene-live');
check('scene-live route registered', Boolean(liveRoute), liveRoute ? 'kind=' + liveRoute.kind : 'missing');
if (liveRoute) {
  const idxRes = await runHandler(liveRoute, '/wallpaper-engine/scene-live/index.html');
  check('index.html 200 + text/html', idxRes.__state.status === 200 && /text\/html/.test(h(idxRes, 'Content-Type')),
    'status=' + idxRes.__state.status + ' ' + h(idxRes, 'Content-Type'));
  check('index.html no-store', /no-store/.test(h(idxRes, 'Cache-Control')), h(idxRes, 'Cache-Control'));

  // Serve one referenced asset (hashed name → immutable long cache).
  const assetRef = assetRefs.find((r) => r.endsWith('.js'));
  const assetRes = assetRef ? await runHandler(liveRoute, assetRef) : null;
  check('hashed asset 200 + js mime + immutable',
    assetRes && assetRes.__state.status === 200 && /javascript/.test(h(assetRes, 'Content-Type'))
      && /immutable/.test(h(assetRes, 'Cache-Control')),
    assetRes ? h(assetRes, 'Content-Type') + ' ' + h(assetRes, 'Cache-Control') : 'no js asset ref found');

  // Bare prefix serves index.html (the client loads /scene-live/index.html, but
  // the directory form must not 404).
  const dirRes = await runHandler(liveRoute, '/wallpaper-engine/scene-live/');
  check('directory form serves index.html', dirRes.__state.status === 200 && /text\/html/.test(h(dirRes, 'Content-Type')),
    'status=' + dirRes.__state.status);

  // Encoded ../ escape must be fenced. NOTE: literal ../ (or %2e%2e) segments
  // are normalised away by `new URL()` itself and never reach the handler;
  // the %2e%2e%2f form (encoded slash) survives normalisation, decodes to a
  // real parent hop inside the handler and MUST be stopped by the fence.
  const escRes = await runHandler(liveRoute, '/wallpaper-engine/scene-live/%2e%2e%2findex.js');
  check('encoded ../ escape fenced (403)', escRes.__state.status === 403, 'status=' + escRes.__state.status);

  const postRes = fakeRes();
  liveRoute.handler({ url: '/wallpaper-engine/scene-live/index.html', headers: {}, method: 'POST' }, postRes);
  check('POST rejected (405)', postRes.__state.status === 405, 'status=' + postRes.__state.status);
}

// ── Level C: /scene-files via synthetic Steam fixture ────────────────────────
console.log('Level C — /scene-files route (synthetic Steam library)');
const fixtureRoot = join(root, '.test-cache', 'scene-live', 'steamlive-fixture');
const workshopDir = join(fixtureRoot, 'steamapps', 'workshop', 'content', '431960', '990001');
rmSync(fixtureRoot, { recursive: true, force: true });
mkdirSync(workshopDir, { recursive: true });
// A library root is only counted when steamapps/common/wallpaper_engine exists
// (see owningLibrariesP) — create it so enumerate picks the workshop content up.
mkdirSync(join(fixtureRoot, 'steamapps', 'common', 'wallpaper_engine'), { recursive: true });
const pkgBytes = Buffer.concat([
  Buffer.from('PKGV0023', 'latin1'),
  Buffer.alloc(4096, 0x5a),
]);
writeFileSync(join(workshopDir, 'scene.pkg'), pkgBytes);
writeFileSync(join(workshopDir, 'project.json'), JSON.stringify({
  title: 'Live Fixture Scene',
  type: 'scene',
  file: 'scene.pkg',
  preview: 'preview.jpg',
  contentrating: 'Everyone',
}));
// preview only needs to exist for the inventory probe; content is irrelevant.
writeFileSync(join(workshopDir, 'preview.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
// A file OUTSIDE the wallpaper dir, targeted by the fence test.
const secretPath = join(fixtureRoot, 'secret.txt');
writeFileSync(secretPath, 'top-secret');
// A web-wallpaper fixture directory (project.json + HTML entry + subresources):
// drives the /scene-files HTML shim injection, subresource MIME and CORS asserts.
const webDir = join(fixtureRoot, 'steamapps', 'workshop', 'content', '431960', '990003');
mkdirSync(webDir, { recursive: true });
writeFileSync(join(webDir, 'project.json'), JSON.stringify({
  title: 'Fixture Web Wallpaper', type: 'web', file: 'index.html', preview: 'preview.jpg',
  contentrating: 'Everyone',
  // 用户属性：host 必须把它转成 seed 脚本注入 HTML（严格沙箱下渲染页无法运行时补推）
  general: {
    properties: {
      color0: { order: 0, type: 'color', value: '1 0 0' },
      fpslock: { order: 1, type: 'bool', value: true },
      // order 用浮点（真实壁纸拿它做细分排序）
      size: { order: 2.5, type: 'slider', value: 0.5, min: 0, max: 2, step: 0.05, precision: 2, text: 'Size' },
      // combo 选项值类型混用：必须原样保留（字符串化会让壁纸里的 === 失配）
      mode: { order: 3, type: 'combo', value: 1, options: [{ label: 'One', value: 1 }, { label: 'Two', value: '2' }] },
      tip: { order: 4, type: 'text', text: 'Section' },
      // 条件只影响面板显隐，值照常下发
      extra: { order: 5, type: 'bool', value: true, condition: 'fpslock.value == true' },
      // 作者标记「用户不可编辑」：面板隐藏，值照常下发
      internal: { order: 6, type: 'slider', value: 1, editable: false },
    },
    localization: { 'zh-chs': { tip: '分节标题', size: '尺寸' } },
  },
}));
writeFileSync(join(webDir, 'index.html'), [
  '<!doctype html><html><head><meta charset="utf-8"><title>fixture</title>',
  '<link rel="stylesheet" href="style.css"></head>',
  '<body><div id="app"></div><script src="app.js"></script></body></html>',
].join('\n'));
writeFileSync(join(webDir, 'style.css'), '#app{color:#fff}');
writeFileSync(join(webDir, 'app.js'), 'window.__fixtureWeb=true;');
writeFileSync(join(webDir, 'preview.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
process.env.DSH_WE_STEAM_ROOT = fixtureRoot;

const invRoute = routes.find((r) => r.path === '/wallpaper-engine/inventory');
const filesRoute = routes.find((r) => r.path === '/wallpaper-engine/scene-files');
check('scene-files route registered', Boolean(filesRoute), filesRoute ? 'kind=' + filesRoute.kind : 'missing');
let fixture = null;
if (invRoute) {
  const res = await runHandler(invRoute, '/wallpaper-engine/inventory');
  const body = JSON.parse(res.__state.body.toString('utf8'));
  fixture = (body.wallpapers || []).find((w) => w.type === 'scene' && w.title === 'Live Fixture Scene') || null;
  check('fixture scene listed in inventory', Boolean(fixture), fixture ? fixture.id : 'not found');
  check('inventory marks fixture sceneLive=true with sceneLiveSrc',
    Boolean(fixture && fixture.sceneLive === true && typeof fixture.sceneLiveSrc === 'string' && fixture.sceneLiveSrc),
    fixture ? 'src len=' + String(fixture.sceneLiveSrc || '').length : '-');
}
if (filesRoute && fixture && fixture.sceneLiveSrc) {
  const token = fixture.sceneLiveSrc;
  const pkgRes = await runHandler(filesRoute, `/wallpaper-engine/scene-files/${token}/scene.pkg`);
  check('scene.pkg 200 + octet-stream + byte-identical',
    pkgRes.__state.status === 200 && h(pkgRes, 'Content-Type') === 'application/octet-stream'
      && pkgRes.__state.body.equals(pkgBytes),
    'status=' + pkgRes.__state.status + ' ' + pkgRes.__state.body.length + 'B');

  const pjRes = await runHandler(filesRoute, `/wallpaper-engine/scene-files/${token}/project.json`);
  let pjOk = false;
  try { pjOk = pjRes.__state.status === 200 && JSON.parse(pjRes.__state.body.toString('utf8')).file === 'scene.pkg'; } catch { /* leave false */ }
  check('project.json 200 + parses', pjOk, 'status=' + pjRes.__state.status);

  const rangeRes = await runHandler(filesRoute, `/wallpaper-engine/scene-files/${token}/scene.pkg`, { range: 'bytes=0-99' });
  check('Range request → 206 + Content-Range + 100B',
    rangeRes.__state.status === 206 && /^bytes 0-99\//.test(h(rangeRes, 'Content-Range'))
      && rangeRes.__state.body.length === 100,
    'status=' + rangeRes.__state.status + ' ' + h(rangeRes, 'Content-Range'));

  // Fence: encoded parent hops aiming at a file OUTSIDE the wallpaper dir
  // (5 hops up from …/431960/990001 to the fixture root; literal ../ would be
  // normalised away by `new URL()` before the handler ever sees it).
  const fenceUrl = `/wallpaper-engine/scene-files/${token}/%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fsecret.txt`;
  const fenceRes = await runHandler(filesRoute, fenceUrl);
  check('encoded ../../ escape fenced (403)', fenceRes.__state.status === 403, 'status=' + fenceRes.__state.status);

  const unknownRes = await runHandler(filesRoute, '/wallpaper-engine/scene-files/bm90LWF0b2tlbg/scene.pkg');
  check('unknown token → 404', unknownRes.__state.status === 404, 'status=' + unknownRes.__state.status);

  const nosubRes = await runHandler(filesRoute, `/wallpaper-engine/scene-files/${token}/`);
  check('missing subpath → 404', nosubRes.__state.status === 404, 'status=' + nosubRes.__state.status);
}

// ── Level C3: web wallpapers over /scene-files ──────────────────────────────
// The strict-sandbox web path needs three host duties: inject the vendored WE
// shim into the HTML entry, serve subresources with correct MIME types (a CSS
// file as application/octet-stream is rejected by the browser), and allow
// opaque-origin fetches via CORS.
{
  // 回归闸门：道具入口必须在**场景**壁纸上也在。踩过的坑：inventory 条目先展开
  // sceneFieldsFor 再展开 webFieldsFor，两者都返回 propsUrl，后者的 null 把场景
  // 的值盖掉 —— 表现就是「场景壁纸没有壁纸属性按钮」。
  const inv = JSON.parse((await runHandler(invRoute, '/wallpaper-engine/inventory')).__state.body.toString('utf8'));
  const sc = (inv.wallpapers || []).find((w) => w.id === '990001') || null;
  check('场景壁纸也带 propsUrl（属性入口不被 web 分支覆盖）',
    Boolean(sc && sc.propsUrl && sc.propsUrl.indexOf('/props/') > 0),
    sc ? String(sc.propsUrl || '(空)').slice(0, 52) : 'scene not found');
}

console.log('Level C3 — web wallpaper files (shim injection / MIME / CORS)');
let mediaEntry = '';   // C4 复用：C3 里从 inventory 拿到的那条入口 URL
{
  const res = await runHandler(invRoute, '/wallpaper-engine/inventory');
  const body = JSON.parse(res.__state.body.toString('utf8'));
  const web = (body.wallpapers || []).find((w) => w.id === '990003') || null;
  check('web wallpaper listed with webLive + webLiveSrc',
    Boolean(web && web.webLive === true && web.webLiveSrc),
    web ? 'type=' + web.type + ' src=' + String(web.webLiveSrc || '').length + 'ch' : 'not found');
  // 入口 URL 必须是**媒体源绝对 URL**（host 自建的第二个 loopback 监听），
  // 而不是插件路由：Desktop 的能力头（x-dsh-desktop-renderer）栅栏拒绝不透明源
  //（严格沙箱 iframe）对插件路由的请求，网页壁纸载荷因此整体挪到我们自己的源；
  // 这条断言就是那次「网页壁纸全黑」事故的回归闸门。
  mediaEntry = String((web && web.webLiveSrc) || '');
  check('webLiveSrc 是媒体源绝对 URL（不再落回插件路由）',
    /^http:\/\/127\.0\.0\.1:\d+\/wallpaper-engine\/scene-files\//.test(mediaEntry),
    mediaEntry.slice(0, 76) || '(空)');
  if (web && web.webLiveSrc) {
    // 应用源挂载仍然存在（场景 pkg / 媒体源不可用时的回落）：去掉源后用同一条
    // 路径把同样的断言跑一遍，保证两处挂载行为一致。
    const entryUrl = mediaEntry.replace(/^http:\/\/127\.0\.0\.1:\d+/, '');
    const baseUrl = entryUrl.replace(/\/[^/]*$/, '');
    const htmlRes = await runHandler(filesRoute, entryUrl);
    const html = htmlRes.__state.body.toString('utf8');
    check('HTML entry served with shim injected',
      htmlRes.__state.status === 200 && /text\/html/.test(h(htmlRes, 'Content-Type'))
        && html.indexOf('data-we-shim="host"') !== -1,
      'status=' + htmlRes.__state.status + ' shim=' + (html.indexOf('data-we-shim') !== -1));
    // 属性 seed：严格沙箱下渲染页读不到 iframe（无法运行时补推 __weApplyProps），
    // 属性只能由宿主随 HTML 注入 —— 漏掉它依赖属性的壁纸会画成默认（实测黑屏）。
    check('HTML entry carries the property seed from project.json',
      html.indexOf('data-we-seed="host"') !== -1 && html.indexOf('__weSeedProps') !== -1
        && html.indexOf('color0') !== -1,
      'seed=' + (html.indexOf('data-we-seed') !== -1));
    check('HTML entry advertises CORS for opaque origins',
      h(htmlRes, 'Access-Control-Allow-Origin') === '*', h(htmlRes, 'Access-Control-Allow-Origin'));
    const cssRes = await runHandler(filesRoute, `${baseUrl}/style.css`);
    check('stylesheet served as text/css (not octet-stream)',
      cssRes.__state.status === 200 && /text\/css/.test(h(cssRes, 'Content-Type')),
      h(cssRes, 'Content-Type'));
    const jsRes = await runHandler(filesRoute, `${baseUrl}/app.js`);
    check('script served as javascript',
      jsRes.__state.status === 200 && /javascript/.test(h(jsRes, 'Content-Type')),
      h(jsRes, 'Content-Type'));
  }
}

// ── Level C4: wallpaper media origin (real loopback listener) ───────────────
// C3 打的是 mock 出来的「应用源挂载」；这一层对**真实 socket** 打一轮：不透明源
//（Origin: null）能否取到入口、子资源 MIME、OPTIONS 预检、目录围栏、非本路由
// 404。Desktop 上网页壁纸能不能显示，完全取决于这个源。
console.log('Level C4 — 壁纸媒体源（真实 loopback 监听）');
{
  const moRoute = routes.find((r) => r.path === '/wallpaper-engine/media-origin');
  check('media-origin 诊断路由已注册', Boolean(moRoute));
  if (moRoute) {
    const moRes = await runHandler(moRoute, '/wallpaper-engine/media-origin');
    const mo = JSON.parse(moRes.__state.body.toString('utf8') || '{}');
    const base = String(mo.base || '');
    check('media-origin 上报可用源（127.0.0.1 + 随机端口）',
      /^http:\/\/127\.0\.0\.1:\d+$/.test(base), 'base=' + (base || '(空)'));
    if (base && mediaEntry) {
      const entryPath = mediaEntry.replace(/^http:\/\/127\.0\.0\.1:\d+/, '');
      const dirPath = entryPath.replace(/\/[^/]*$/, '');
      // 不透明源（严格沙箱 iframe）真实发出的请求就长这样：Origin: null。
      const opaque = await fetch(base + entryPath, { headers: { Origin: 'null' }, cache: 'no-store' });
      const opaqueHtml = await opaque.text();
      check('Origin: null 下入口 HTML 200 + shim/seed 注入 + CORS *',
        opaque.status === 200 && opaque.headers.get('access-control-allow-origin') === '*'
          && opaqueHtml.indexOf('data-we-shim="host"') !== -1
          && opaqueHtml.indexOf('data-we-seed="host"') !== -1,
        'status=' + opaque.status + ' acao=' + opaque.headers.get('access-control-allow-origin'));
      const css = await fetch(base + dirPath + '/style.css', { cache: 'no-store' });
      check('子资源经媒体源可达（text/css）',
        css.status === 200 && /text\/css/.test(css.headers.get('content-type') || ''),
        'status=' + css.status + ' ' + css.headers.get('content-type'));
      const pre = await fetch(base + entryPath, { method: 'OPTIONS', cache: 'no-store' });
      check('OPTIONS 预检放行（204 + ACAO *）',
        pre.status === 204 && pre.headers.get('access-control-allow-origin') === '*',
        'status=' + pre.status + ' acao=' + pre.headers.get('access-control-allow-origin'));
      const fenced = await fetch(base + dirPath + '/%2e%2e%2f%2e%2e%2fsecret.txt', { cache: 'no-store' });
      const fencedBody = await fenced.text();
      check('媒体源同样受目录围栏保护（403 + 自解释体）',
        fenced.status === 403 && fencedBody.indexOf('forbidden-scene-files[') === 0,
        'status=' + fenced.status + ' body=' + fencedBody.slice(0, 32));
      const off = await fetch(base + '/wallpaper-engine/media-status', { cache: 'no-store' });
      check('媒体源只服务 /scene-files（其它路径 404）', off.status === 404, 'status=' + off.status);
    }
  }
}

// ── Level C5: 壁纸属性（project.json general.properties → 面板 / 种子）───────
// 「壁纸属性」面板读这条路由；写入走 settings（userProps），再由 buildSeedScript
// 并进 HTML 种子 —— 这里把整条链路验证到底。
console.log('Level C5 — 壁纸属性解析 / 覆盖值 → HTML 种子');
{
  const propsRoute = routes.find((r) => r.path === '/wallpaper-engine/props');
  const settingsRoute = routes.find((r) => r.path === '/wallpaper-engine/settings');
  check('props 路由已注册', Boolean(propsRoute));
  let token = '';
  {
    const inv = JSON.parse((await runHandler(invRoute, '/wallpaper-engine/inventory')).__state.body.toString('utf8'));
    const web = (inv.wallpapers || []).find((w) => w.id === '990003') || null;
    token = String((web && web.propsUrl) || '').split('/').pop();
    check('inventory 给场景/网页壁纸带 propsUrl', Boolean(web && web.propsUrl), web ? String(web.propsUrl).slice(0, 48) : 'not found');
  }
  const pres = await runHandler(propsRoute, `/wallpaper-engine/props/${encodeURIComponent(token)}`);
  const pdata = JSON.parse(pres.__state.body.toString('utf8') || '{}');
  const byName = Object.fromEntries((pdata.props || []).map((p) => [p.name, p]));
  check('属性面板数据可取（含全部类型）',
    pres.__state.status === 200 && pdata.ok === true && (pdata.props || []).length === 6,
    'count=' + ((pdata.props || []).length) + ' status=' + pres.__state.status);
  check('editable:false 从面板隐藏（值照常下发）', !byName.internal);
  check('order 按浮点排序（2.5 落在 2 与 3 之间）',
    (pdata.props || []).map((p) => p.name).join(',') === 'color0,fpslock,size,mode,tip,extra',
    (pdata.props || []).map((p) => p.name).join(','));
  check('slider 带 min/max/step/precision',
    byName.size && byName.size.min === 0 && byName.size.max === 2 && byName.size.step === 0.05 && byName.size.precision === 2);
  check('combo 选项保留声明类型（数字 / 字符串混用）',
    byName.mode && byName.mode.options[0].value === 1 && byName.mode.options[1].value === '2',
    byName.mode ? JSON.stringify(byName.mode.options.map((o) => o.value)) : 'missing');
  check('文案逐键本地化回退 zh-chs',
    byName.size && byName.size.text === '尺寸' && byName.tip && byName.tip.text === '分节标题',
    byName.size ? byName.size.text : 'missing');
  check('text 类型是静态说明（无值）', byName.tip && byName.tip.value === null);
  check('condition 只随定义带出（面板按当前值求值）', byName.extra && byName.extra.condition === 'fpslock.value == true');

  // 覆盖值 → 种子：PUT 设置后，同一份 HTML 应当带上被改过的值
  const entryPath = '/wallpaper-engine/scene-files/' + token + '/index.html';
  const putRes = fakeRes();
  await settingsRoute.handler(fakeReqBody('/wallpaper-engine/settings', 'PUT', {
    userProps: { [token]: { color0: '0 1 0', size: 1.25 } },
  }), putRes);
  await waitRes(putRes);   // 「响应即已持久化」：等应答再读种子
  check('设置接受 userProps 覆盖值（白名单）', putRes.__state.status === 200, 'status=' + putRes.__state.status);
  const html2 = (await runHandler(filesRoute, entryPath)).__state.body.toString('utf8');
  check('覆盖值并进 HTML 种子（host 侧合并，网页壁纸不闪默认值）',
    html2.includes('__weSeedProps') && html2.includes('0 1 0') && html2.includes('1.25'),
    'seed=' + html2.includes('__weSeedProps'));
  const pdata2 = JSON.parse((await runHandler(propsRoute, `/wallpaper-engine/props/${encodeURIComponent(token)}`)).__state.body.toString('utf8'));
  const byName2 = Object.fromEntries((pdata2.props || []).map((p) => [p.name, p]));
  check('覆盖值在面板数据里标记为 overridden',
    byName2.color0 && byName2.color0.overridden === true && byName2.color0.value === '0 1 0');
  // 还原（同一份临时 config 后续断言还用它）
  const putBack = fakeRes();
  await settingsRoute.handler(fakeReqBody('/wallpaper-engine/settings', 'PUT', { userProps: {} }), putBack);
  await waitRes(putBack);
  const html3 = (await runHandler(filesRoute, entryPath)).__state.body.toString('utf8');
  check('清空覆盖值后种子回到默认（1 0 0）',
    html3.includes('1 0 0') && !html3.includes('0 1 0'));
}

// ── Level C2: custom storage (uploads) — WE project directories ─────────────
// The reported bug: pointing 存储位置 at a WallpaperEM-style downloads folder
// found none of its scene wallpapers (the old scanner only matched `up-*.ext`
// single files). The fixture (created before import) holds one WE project dir
// plus one legacy single-file upload.
console.log('Level C2 — custom storage scan (WE project dirs under uploads)');
{
  const sceneFrameRoute = routes.find((r) => r.path === '/wallpaper-engine/scene-frame');
  const res = await runHandler(invRoute, '/wallpaper-engine/inventory');
  const body = JSON.parse(res.__state.body.toString('utf8'));
  const dirScene = (body.wallpapers || []).find((w) => w.id === 'up-dir-my-scene-1') || null;
  check('uploads WE project dir listed as scene', Boolean(dirScene), dirScene ? dirScene.type : 'not found');
  check('custom-storage scene takes its project.json title',
    Boolean(dirScene && dirScene.title === 'Custom Dir Scene'), dirScene ? dirScene.title : '-');
  check('custom-storage scene marked sceneLive + sceneLiveSrc',
    Boolean(dirScene && dirScene.sceneLive === true && dirScene.sceneLiveSrc),
    dirScene ? 'src len=' + String(dirScene.sceneLiveSrc || '').length : '-');
  check('custom-storage scene has frameUrl + preview',
    Boolean(dirScene && dirScene.frameUrl && dirScene.preview),
    dirScene ? 'frameUrl=' + Boolean(dirScene.frameUrl) + ' preview=' + Boolean(dirScene.preview) : '-');
  const fileUp = (body.wallpapers || []).find((w) => w.id === 'up-fixture-image') || null;
  check('single-file upload still scanned alongside',
    Boolean(fileUp && fileUp.type === 'image' && fileUp.playable === true),
    fileUp ? fileUp.type + ' playable=' + fileUp.playable : 'not found');

  if (dirScene && dirScene.sceneLiveSrc) {
    const pkgRes = await runHandler(filesRoute, `/wallpaper-engine/scene-files/${dirScene.sceneLiveSrc}/scene.pkg`);
    check('custom-storage scene.pkg served via /scene-files',
      pkgRes.__state.status === 200 && pkgRes.__state.body.length > 1000,
      'status=' + pkgRes.__state.status + ' ' + pkgRes.__state.body.length + 'B');
  }
  if (dirScene && dirScene.frameUrl && sceneFrameRoute) {
    const frameRes = await runHandler(sceneFrameRoute, dirScene.frameUrl);
    const ctype = h(frameRes, 'Content-Type');
    check('custom-storage scene frame extracted (real pkg decode)',
      frameRes.__state.status === 200 && /image\/(jpeg|png)/.test(ctype),
      'status=' + frameRes.__state.status + ' ' + ctype + ' ' + frameRes.__state.body.length + 'B');
  }
}

// ── Level D: client source contract ─────────────────────────────────────────
console.log('Level D — client source wiring (src/client.js)');
const src = readFileSync(join(root, 'src', 'client.js'), 'utf8');
/** `function name() { … }` 的函数体源码（用于按内容而非脆弱的跨行正则断言）。 */
function fnBody(source, name) {
  const i = source.indexOf('function ' + name + '(');
  if (i < 0) return '';
  const j = source.indexOf('\n}', i);
  return j < 0 ? source.slice(i) : source.slice(i, j);
}
const fadeBgBody = fnBody(src, 'resolveWallpaperFadeBg');
const clientChecks = [
  ['live is the top priority for scenes and web', /const isLive = \(sel\.type === "scene" \|\| sel\.type === "web"\) && liveRenderEnabled\(sel\)/.test(src)],
  ['sceneVideo yields to live', /Boolean\(sel\.sceneVideo\) && !isLive/.test(src)],
  ['web wallpapers force the strict sandbox', /webSandbox=strict/.test(src)],
  ['heartbeat watchdog exists', /function startLiveWatch/.test(src) && /LIVE_FIRST_FRAME_MS/.test(src)],
  ['failure memory persists', /sceneLiveFailures/.test(src) && /function liveFail/.test(src)],
  ['audio mux honours live', /!selLike\.sceneLiveActive/.test(src)],
  ['syncLayers key carries live state', /"live\\u0000" \+ \(selection\.sceneLiveSrc \|\| selection\.webLiveSrc\)/.test(src)],
  // sceneVideo 只在**非 live** 形态下进 key：live 生效时 buildMedia 已把 isSceneVideo
  // 短路，把 sceneVideo 算进 key 会让「sceneVideo 诚实化的时序补拉」
  //（scheduleSceneVideoResync 落地时 sceneVideo 由 null 变 URL）在 live 播放中
  // 冷启动一次渲染页 —— 无意义重建，用户会看到画面重新加载。
  ['sceneVideo stays out of the layer key while live renders',
    /\(layerLive \? "" : \(selection\.sceneVideo \|\| ""\)\)/.test(src)],
  // 垫底静态帧是 iframe 的**下层**：只要 iframe 半透明（壁纸透明度一高），它就会以
  // a(1−a) 的强度透出来（实测「壁纸透明度高时显现静态帧」）。首帧点亮后必须整块退场。
  ['the static-frame underlay retires once the live frame is on',
    /:has\(\.we-live-iframe\.we-live-on\) \.we-live-poster\s*\{[^}]*opacity:\s*0/.test(src)],
  // 淡出底色必须是**原生外观**（纯黑/纯白），不能是主题面板色 —— 否则拉高「壁纸
  // 透明度」会露出一块与原生外观不符的主题色（用户实测反馈）。
  ['the wallpaper fade base is the native black/white, not the panel token',
    fadeBgBody.includes('--dsw-alias-bg-base')
    && /"#000000" : "#ffffff"/.test(fadeBgBody)
    && !fadeBgBody.includes('--dsw-alias-bg-layer-1')],
  // 画面来源选项的三条门禁（2026-09-26 按用户反馈调整过）：
  // - 「壁纸画面刷新」换的是 **CPU 静态帧**，实时画面在跑时它没有任何作用 → 只在
  //   live 未生效时渲染；
  // - 「实时帧」（GPU 抓帧：重新截 / 清除 / 微缩预览）与「自定义画面」**live 开着时
  //   同样显示** —— 那张静帧正是切换途中与 live 首帧前给用户看的画面，构图不对时
  //   必须能立刻重抓，而不是先关掉实时渲染；导入截图与 live 也互不干扰。
  ['CPU frame-variant row shows only while live is not effective',
    /sel\.type === "scene" && sel\.sceneFrameUrl && !liveRenderEnabled\(sel\)/.test(src)],
  ['live-frame (GPU capture) row is NOT gated on the live switch',
    /sceneWithFrame && \(gpuPinnedHere \|\| liveRenderEnabled\(sel\)\)/.test(src)],
  ['custom-frame row is NOT gated on the live switch',
    /sel\.type === "scene" && React\.createElement\("div", \{ className: "we-picker__ctl" \}/.test(src)],
  // 「重新截」= force 重抓：必须走「先抓帧 + 内容门禁 → 成功后才清旧帧」的安全顺序，
  // 抓不到时不许把原来那张删掉（面板上给失败原因）。
  ['manual re-capture forces a fresh capture through the safe path',
    /scheduleLiveFrameBackfill\(live, \{ force: true \}\)/.test(src)
    && /const stale = force \|\| \(hasGpu && arRef > 0/.test(src)],
  // 微缩预览必须指向层里正在用的那个 URL（同档位）+ 缓存破坏参数。
  ['frame preview points at the live layer URL',
    /function framePreviewSrc\(selLike\)[\s\S]{0,500}?frameUrlWithVariant\(selLike && selLike\.sceneFrameUrl, v\)[\s\S]{0,200}?we-prev=/.test(src)],
  ['pointer injection wired', /__wp\.pushPointer|wp\.pushPointer/.test(src) && /pointerLeave/.test(src)],
  ['fit mapping table present', /SCENE_LIVE_FIT = \{ cover: "cover"/.test(src)],
  // 实测踩坑回归（2026-09-22）：渲染页 resume() 会 resetFrameMeter，心跳若
  // 每秒无条件调 resume 会永远读到 fps=0 → 15s 误降级。控制必须去重下发，
  // 且 tick 内先读统计再应用控制。
  ['controls are deduped before dispatch', /liveApplied\.playing !== playing/.test(src)],
  ['heartbeat reads stats before applying controls', /const stats = liveStats\(frame\);\s*\n\s*applyLiveControls\(frame\);/.test(src)],
  ['upload management list excludes project dirs', /isUploadedWallpaper\(w\) && !isDirWallpaper\(w\)/.test(src)],
  // 帧率取证（「限了 30 还卡」时唯一能分清「壁纸自身掉帧」与「整页掉帧」的手段）
  ['live fps probe reports ui / web / rnd to the diag channel',
    src.includes('function reportLiveFps') && src.includes('"live-fps"')
      && src.includes('function takeUiFps') && src.includes('wstate.webFps')],
  // 网页壁纸的 src 直用 host 给的绝对 URL（媒体源）；相对形态仅作回落。
  ['web live src reuses the absolute media-origin URL', src.includes('const webEntry = String(selLike.webLiveSrc || "")')
    && src.includes('/^https?:\\/\\//i.test(webEntry)')],
  // 实机回归（2026-09-25）：「场景类壁纸正常几秒就失效」「网页也是」「失效以后是静态的」
  // 「只有扩展模式」「网页类是预览图」。成因是 extended 的「首帧后延迟 8000ms 换元」自救：
  // 换元后的新元素为防白闪被摘掉 `we-live-on`，层回落垫底图（场景=静态帧、网页=预览图），
  // 而渲染页照旧出声；日志上 first-frame-ok 后**正好 +8s** 出现 live-frame-rebuilt。
  // 该 workaround 的前提（启动期 iframe 永不上屏）已不成立 ⇒ 改成 **opt-in**。
  ['extended frame swap is opt-in (default off) — it is the "几秒后失效" 病因',
    /function useExtendedFrameSwap\(\)/.test(src)
    && /extendedFrameSwap = String\(rawFlag\)\.toLowerCase\(\) === "1";/.test(src)
    && /if \(desktopWindowMode\(\) === "extended" && !liveFrameRebuildTimer && useExtendedFrameSwap\(\)\) \{/.test(src)],
];
for (const [name, ok] of clientChecks) check(name, ok);
// 负对照：**没有开关的**换元调用点（旧写法）喂给同一判据必须被判不合格 —— 否则这条断言
// 只要文件里出现 `we-ext-swap` 字样就会通过，等于没有牙。
{
  const swapIsOptIn = (s) => /if \(desktopWindowMode\(\) === "extended" && !liveFrameRebuildTimer && useExtendedFrameSwap\(\)\) \{/.test(s);
  const ungated = 'if (desktopWindowMode() === "extended" && !liveFrameRebuildTimer) {';
  check('negative control: the ungated extended swap call site is rejected', swapIsOptIn(ungated) === false);
  check('positive control: the current client gates the extended swap', swapIsOptIn(src) === true);
}
// 实测踩坑回归（2026-09-22）：host 的 sanitizeSettings 是白名单，漏加
// sceneLiveFailures 会让 PUT 上来的失败记忆被丢弃、刷新后记忆消失。
const hostSrc = readFileSync(join(root, 'lib', 'index.js'), 'utf8');
check('host settings whitelist keeps sceneLiveFailures', /sceneLiveFailures: \(o\.sceneLiveFailures && typeof o\.sceneLiveFailures === 'object'/.test(hostSrc));
check('host injects the vendored shim into web HTML', /data-we-shim="host"/.test(hostSrc) && /readWebShim\(\)/.test(hostSrc));
check('host sends CORS for opaque-origin fetches', /Access-Control-Allow-Origin', '\*'/.test(hostSrc));
check('inventory derives webLive via webFieldsFor', /webFieldsFor\(w, hasMedia, webMediaBase\)/.test(hostSrc));
// 2026-09-23 黑屏事故回归：Desktop 的能力头栅栏（宿主 lib/webserver.js →
// decideDesktopBrowserAccess）只放行同源 frame，不透明源的沙箱 iframe 永远拿不到
// x-dsh-desktop-renderer → 插件路由一律 403。网页壁纸载荷因此必须走 host 自建的
// 独立 loopback 源，两处挂载共用同一段处理函数。
check('host 自建壁纸媒体源（独立 loopback 监听）',
  /let mediaOrigin = null/.test(hostSrc) && /function ensureMediaOrigin\(\)/.test(hostSrc)
    && /server\.listen\(0, '127\.0\.0\.1'/.test(hostSrc) && /function mediaOriginBase\(\)/.test(hostSrc));
check('scene-files 处理函数被双挂载（应用源 + 媒体源）',
  /function handleSceneFiles\(req, res, mount\)/.test(hostSrc)
    && hostSrc.includes("handleSceneFiles(req, res, 'media')")
    && hostSrc.includes("handleSceneFiles(req, res, 'app')")
    && hostSrc.includes('function traceMediaRequests('));
check('媒体源只服务 /scene-files 前缀', hostSrc.includes("pathname.startsWith(`${BASE}/scene-files/`)"));

// 封面（Now Playing artwork）：实测用户反馈「不显示歌曲封面」的根因是只问 Spotify。
// 现在通用路径是 media-control 自带的 artworkData（系统 MediaRemote，任何播放器都有），
// 且缓存后缀按 MIME 决定（PNG 存成 .jpg 会按错误类型解码）。
// 2026-09-23：这套降级为**回落实现**（lib/media/legacy.js），首选换成 media-bridge
// 子进程（lib/media/*）——断言因此两边都盯：旧实现的能力不能退化，新链路的接缝要在。
const legacyBridgeSrc = readFileSync(join(root, 'lib', 'media', 'legacy.js'), 'utf8');
check('旧实现已挪进 lib/media/legacy.js（回落路径还在）',
  existsSync(join(root, 'lib', 'media', 'legacy.js')) && !existsSync(join(root, 'lib', 'media-bridge.js')));
check('封面走 media-control 的 artworkData（通用，不限 Spotify）',
  legacyBridgeSrc.includes('artworkData') && legacyBridgeSrc.includes('artworkMimeType')
    && legacyBridgeSrc.includes('function takeArtworkMac('));
check('例行轮询 --no-artwork（封面 base64 每秒几百 KB），换曲才取',
  legacyBridgeSrc.includes("'get', '--no-artwork'") && legacyBridgeSrc.includes('npNoArtwork'));
check('封面缓存按 MIME 定后缀并清旧文件',
  legacyBridgeSrc.includes('ARTWORK_EXT') && legacyBridgeSrc.includes('function writeArtwork(')
    && legacyBridgeSrc.includes("'artwork'"));
check('Spotify AppleScript 降为兜底', legacyBridgeSrc.includes('function fetchSpotifyArtwork('));
check('回落实现暴露 artworkMime 与 backend 标记',
  legacyBridgeSrc.includes('artworkMime: () => artworkMime') && legacyBridgeSrc.includes("backend: 'legacy'"));
check('回落实现尊重「音频已关」（不会偷偷开采集/申请权限）',
  legacyBridgeSrc.includes('if (audio) startAudio();'));
check('host 按扩展名回封面 Content-Type', hostSrc.includes("bmp: 'image/bmp'"));

// ── media-bridge 中间件的接缝（首选路径）────────────────────────────────────
const provSrc = readFileSync(join(root, 'lib', 'media', 'provision.js'), 'utf8');
const supSrc = readFileSync(join(root, 'lib', 'media', 'supervisor.js'), 'utf8');
const facadeSrc = readFileSync(join(root, 'lib', 'media', 'index.js'), 'utf8');
check('产物表：darwin 通用包 / linux x64 musl / win32 双架构',
  provSrc.includes("'media-bridge-darwin-universal'")
    && provSrc.includes("'media-bridge-linux-x64-musl'") && provSrc.includes("'media-bridge-win32-x64.exe'"));
check('产物 sha256 全部固定（宁可回落也不执行未校验的二进制）',
  // ≥5：win32-arm64 是可选产物，Release 里没有时它能没有哈希（靠 x64 回落链）
  (provSrc.match(/[0-9a-f]{64}/g) || []).length >= 5 && provSrc.includes('MEDIA_BRIDGE_SHA256'));
check('魔数识别包含 macOS universal 的 fat 头', provSrc.includes('0xca') && provSrc.includes('0xfe'));
// win32-arm64 在 CI 里是可选产物（windows-11-arm runner 会卡）：没有它时 Windows ARM64
// 必须能回落到 x64（系统自带模拟），否则那台机器会直接掉到 legacy 实现。
check('Windows ARM64 有 x64 产物回落链',
  /MEDIA_BRIDGE_FALLBACKS/.test(provSrc)
    && /'media-bridge-win32-arm64\.exe': \['media-bridge-win32-x64\.exe'\]/.test(provSrc));
check('产物解析链：环境变量 → 插件 bin/ → 下载缓存 → Release 下载',
  provSrc.includes('DSH_WE_MEDIA_BRIDGE') && provSrc.includes("join(PLUGIN_ROOT, 'bin', asset)")
    && provSrc.includes('cacheDirFor(dataDir, tag)') && provSrc.includes('releases/download/'));
check('协议握手校验 hello.protocol（版本不符不硬来）',
  supSrc.includes('hello.protocol') && supSrc.includes('PROTOCOL_VERSION'));
check('事件与响应按字段分流（不能假设下一行是响应）',
  supSrc.includes('if (msg.event)') && supSrc.includes('pending.has(msg.id)'));
check('频谱走订阅推送（50ms），不是每帧去问', supSrc.includes('SPECTRUM_INTERVAL_MS') && supSrc.includes("events.push('spectrum')"));
check('音频关时用 --no-audio（连音频授权都不会弹）', supSrc.includes("'--no-audio'"));
check('位置外推用 updatedAtMs + rate（暂停不外推）',
  supSrc.includes('playing && pb.positionSource !== ') && supSrc.includes('Date.now() - ref'));
check('事件里已外推的位置不重复外推（参考时刻改写成事件时刻）',
  supSrc.includes("pb.positionSource === 'interpolated'") && supSrc.includes('pb.updatedAtMs = refMs'));
check('歌词换算成渲染页要的 [[秒, 文本], …]（含 LRC offset）',
  supSrc.includes('export function lyricsToTuples') && supSrc.includes('offsetMs'));
// 状态缓存兜底：中间件的 status 事件此前只在元数据源报错时发（v0.1.3），音频源
// idle→preparing→running 的变化不通知 —— 消费端只在启动时读一次 status，会永远停在
// preparing（Linux 实测：频谱有数据、客户端却拿不到）。v0.1.4 补了事件，插件这层
// 兜底刷新也保留：两层互不依赖。
check('supervisor 兜底刷新 status（不依赖中间件的事件是否齐全）',
  /const STATUS_REFRESH_MS = /.test(supSrc) && /function refreshStatusSoon\(/.test(supSrc)
    && /refreshStatusSoon\(\);/.test(supSrc));
check('崩溃退避重启 + 超预算回落（onFatal）',
  supSrc.includes('MAX_RESTARTS') && supSrc.includes('onUnexpectedExit') && supSrc.includes('onFatal'));
check('空闲停进程 + 下次访问自动唤醒', supSrc.includes('IDLE_STOP_MS') && supSrc.includes('asleep'));
// Windows 黑框回归：GUI 宿主（DSH Desktop / Electron）spawn 控制台子进程时必须带
// windowsHide（= Win32 CREATE_NO_WINDOW），否则会弹出/闪一个黑框。中间件与 ffmpeg
// 的每一处 spawn 都要带上；macOS/Linux 专属的调用（media-control/playerctl/xattr 等）
// 不在 Windows 上跑，但一并带上也无害。
const winHideSites = [
  { file: 'lib/media/supervisor.js', spawn: /spawn\(binPath[\s\S]{0,80}\.\.\.a\.opts/, minFlags: 2 },
  { file: 'lib/index.js', spawn: /spawn\(a\.file[\s\S]{0,80}\.\.\.a\.opts/, minFlags: 2 },
  { file: 'lib/media/legacy.js', spawn: /spawnSync\('ffmpeg'[\s\S]{0,220}windowsHide: true/, minFlags: 1 },
];
const winHideBad = [];
for (const site of winHideSites) {
  const body = readFileSync(join(root, site.file), 'utf8');
  const flags = (body.match(/windowsHide: true/g) || []).length;
  if (!site.spawn.test(body) || flags < site.minFlags) winHideBad.push(site.file);
}
check('平台 spawn 点都带 windowsHide（GUI 宿主在 Windows 上不出黑框）',
  winHideBad.length === 0, winHideBad.join(', ') || '已覆盖中间件 / ffmpeg 转码 / 回落路径');
check('门面：中间件优先，失败回落旧实现并留下原因',
  facadeSrc.includes('fallBackTo(') && facadeSrc.includes("backend: live ? 'bridge'"));
check('门面支持 DSH_WE_MEDIA_LEGACY=1 强制走旧实现', facadeSrc.includes('DSH_WE_MEDIA_LEGACY'));
check('门面把「音频已关」传给回落实现（不让回落偷偷开采集）',
  facadeSrc.includes('createLegacy({ dataDir, log, audio: optsRef.audio })'));
check('host 路由形状不变（客户端/渲染页无需感知后端切换）',
  /path: `\$\{BASE\}\/media-status`/.test(hostSrc) && /path: `\$\{BASE\}\/audio-spectrum`/.test(hostSrc)
    && /path: `\$\{BASE\}\/now-playing`/.test(hostSrc) && /path: `\$\{BASE\}\/now-playing\/artwork`/.test(hostSrc));
check('spectrum 路由回报 running（客户端据此决定装不装音频桥）',
  hostSrc.includes('running: st.audio.status ===') && hostSrc.includes('mediaBackend.status()'));
check('settings 白名单保留 mediaLyricsOnline（否则开关会被丢）',
  /mediaLyricsOnline: o\.mediaLyricsOnline === true/.test(hostSrc));

// 客户端：封面必须转成**自包含 data URL** —— 宿主给的是插件路由，
// 沙箱壁纸在 Desktop 上取不到（能力头栅栏只放行同源 frame）。
check('client 把封面降采样成 data URL 再推给壁纸',
  src.includes('async function fetchArtworkDataUrl(') && src.includes('createImageBitmap(')
    && src.includes('toDataURL("image/jpeg"') && src.includes('thumbnail: mediaArtData || undefined'));
check('client 按曲目缓存封面并重试（宿主下载封面是异步的）',
  src.includes('function scheduleArtworkFetch(') && src.includes('MEDIA_ART_MAX_TRIES'));
check('client 透传歌词与 albumArtist（[[秒, 文本]] 原样给渲染页）',
  src.includes('lyrics: Array.isArray(m.lyrics) && m.lyrics.length ? m.lyrics : undefined')
    && src.includes('albumArtist: m.albumArtist || ""'));
check('client 的 push key 带歌词版本（歌词晚到也要再推一帧）',
  src.includes('const lyrRev =') && src.includes('lyrRev].join('));
check('音频桥按宿主 running 装卸（装了桥 = 渲染页放弃自带音频源）',
  src.includes('function syncAudioBridge(frame, running)') && src.includes('syncAudioBridge(frame, d.running === true)'));
check('「在线歌词」开关默认关（外发请求要用户点头）',
  src.includes('mediaLyricsOnline: false') && src.includes('mediaLyricsOnline: o.mediaLyricsOnline === true')
    && src.includes('在线歌词'));
check('host builds the property seed from project.json + 覆盖值',
  /function buildSeedScript\(entryAbs, token\)/.test(hostSrc) && /parseUserPropDefs\(pj, overrides/.test(hostSrc)
    && /userPropsFor\(token\)/.test(hostSrc));
check('host 侧属性解析模块（order 浮点 / combo 保类型 / 逐键本地化 / condition）',
  existsSync(join(root, 'lib', 'we-props.js'))
    && /parseUserPropDefs/.test(readFileSync(join(root, 'lib', 'we-props.js'), 'utf8')));
check('settings 白名单保留 userProps（按 token 存标量）',
  /userProps: \(o\.userProps && typeof o\.userProps === 'object'/.test(hostSrc));
check('「壁纸属性」按钮：仅场景/网页壁纸 + 绿色样式',
  src.includes('we-picker__btn--props') && src.includes('(current.type === "scene" || current.type === "web") && sel.propsUrl'));
check('属性面板热更新走 __wp.updateWebProps',
  src.includes('function applyUserProps(') && src.includes('wp.updateWebProps(wire)'));
check('属性面板值以渲染页实时表为准（getProperties）',
  src.includes('wp.getProperties()') && src.includes('function loadUserPropDefs('));
check('条件求值器已移植（fail open）',
  src.includes('function weEvalCondition(') && src.includes('function weCondParse('));
check('场景就绪后回放覆盖值（无 HTML 种子通道）',
  src.includes('function applyStoredUserProps(') && src.includes('applyStoredUserProps(selection)'));
// 用户口径：选择壁纸页只保留**顶部**关闭按钮（底部那个是重复的）。
// 计数口径：closePicker 的绑定 = 顶部按钮 + 点击遮罩，共 2 处。
check('选择壁纸弹窗只留顶部关闭按钮（底部不再有）',
  (src.match(/onClick: closePicker/g) || []).length === 2
    && src.includes('we-picker__modal-foot" },')
    && src.includes('ESC / 点击遮罩关闭'),
  'closePicker 绑定数=' + ((src.match(/onClick: closePicker/g) || []).length));
check('抽屉里名称行文字居中', src.includes('.we-repo-panel .we-picker__current-title { grid-area: title; text-align: center; }'));
check('标题里的类型/播放态在抽屉内联并加括号（整行省略）',
  src.includes('className: "we-picker__current-meta" }') && src.includes('.we-repo-panel .we-picker__current-meta {')
    && src.includes('.we-repo-panel .we-picker__current-meta::before { content: "（"; }')
    && src.includes('.we-repo-panel .we-picker__current-meta::after { content: "）"; }'));
check('抽屉窄容器：标题独占首行 + 按钮上下排列（8px）',
  src.includes('.we-repo-panel .we-picker__current {') && src.includes('grid-template-areas:')
    && src.includes('.we-repo-panel .we-picker__current-actions {')
    && /grid-area: actions; flex-direction: column; align-items: stretch; gap: 8px;/.test(src));
check('renderer diagnostics sink registered at /diag', /path: '\/diag'/.test(hostSrc) && /diag-log/.test(hostSrc));
// 实测踩坑（2026-09-23）：同一份渲染页产物里还有一条走 ${BASE}/diag 的告警通道，
// 只挂根路径会让「壁纸黑屏」时最关键的渲染页告警全部 404 静默丢掉。
check('renderer diagnostics also accepted at ${BASE}/diag', hostSrc.includes('path: `${BASE}/diag`'));
// 自定义存储位置的目录型条目：up-dir- 前缀（用户自己的内容 / 不参与 /remove）
check('uploads scan tags project dirs with up-dir- prefix', /id: `up-dir-\$\{name\}`/.test(hostSrc));
check('uploads scan resolves scene.pkg for declared scene.json', /resolveSceneMainFileP\(abs, proj\.file\)/.test(hostSrc));

// ── Level E: WE 官方素材（local-assets）端点 + 目录设置 ─────────────────────
// 契约对齐上游 renderer/src/local-assets.ts 的四种请求形；素材 fixture 是
// 合成字节（端点不解析 .tex，只透传字节）。
console.log('Level E — WE local-assets endpoint + assets-dir setting');
const weAssetsFixture = join(TEST_CACHE_DIR, 'we-assets');
rmSync(weAssetsFixture, { recursive: true, force: true });
mkdirSync(join(weAssetsFixture, 'materials', 'util'), { recursive: true });
mkdirSync(join(weAssetsFixture, 'materials', 'particle'), { recursive: true });
mkdirSync(join(weAssetsFixture, 'materials', 'gradient'), { recursive: true });
mkdirSync(join(weAssetsFixture, 'fonts'), { recursive: true });
const NOISE_BYTES = Buffer.from('synthetic-util-noise-tex-bytes');
writeFileSync(join(weAssetsFixture, 'materials', 'util', 'noise.tex'), NOISE_BYTES);
writeFileSync(join(weAssetsFixture, 'materials', 'particle', 'halo.tex'), Buffer.from('synthetic-halo'));
writeFileSync(join(weAssetsFixture, 'materials', 'gradient', 'gradient_0.tex'), Buffer.from('synthetic-gradient'));
const FONT_BYTES = Buffer.from('synthetic-font-bytes');
writeFileSync(join(weAssetsFixture, 'fonts', 'NotoSans.ttf'), FONT_BYTES);

const laRoute = routes.find((r) => r.path === '/api/local-assets');
const weDirRoute = routes.find((r) => r.path === '/wallpaper-engine/we-assets-dir');
check('/api/local-assets route registered as prefix', Boolean(laRoute) && laRoute.kind === 'prefix',
  laRoute ? 'kind=' + laRoute.kind : 'missing');
check('we-assets-dir route registered', Boolean(weDirRoute) && weDirRoute.kind === 'exact');

function fakePostReq(url, body) {
  const listeners = {};
  const req = {
    url, method: 'POST', headers: {},
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); return req; },
  };
  queueMicrotask(() => {
    for (const fn of listeners.data || []) fn(Buffer.from(body));
    for (const fn of listeners.end || []) fn();
  });
  return req;
}
async function postJson(route, url, obj) {
  const res = fakeRes();
  const done = route.handler(fakePostReq(url, JSON.stringify(obj)), res);
  if (done && typeof done.then === 'function') await done;
  if (!res.__state.ended) {
    await new Promise((resolveFn) => {
      const t = setTimeout(resolveFn, 8000);
      res.on('finish', () => { clearTimeout(t); resolveFn(); });
    });
  }
  return res;
}

if (laRoute && weDirRoute) {
  // 未配置素材：探测 ok:false（渲染页静默回落，不是错误）。
  const probe0 = await runHandler(laRoute, '/api/local-assets');
  const probe0Body = JSON.parse(probe0.__state.body.toString('utf8'));
  check('probe before configure → ok:false', probe0.__state.status === 200 && probe0Body.ok === false);

  // POST 校验：不存在的目录 / 缺 materials/ 都 400。
  const badPost = await postJson(weDirRoute, '/wallpaper-engine/we-assets-dir', { dir: join(TEST_CACHE_DIR, 'no-such-dir') });
  check('POST with missing materials/ rejected', badPost.__state.status === 400,
    'status=' + badPost.__state.status);
  const relPost = await postJson(weDirRoute, '/wallpaper-engine/we-assets-dir', { dir: 'relative/path' });
  check('POST with relative path rejected', relPost.__state.status === 400,
    'status=' + relPost.__state.status);

  // 配置合法素材目录 → available + 贴图计数。
  const okPost = await postJson(weDirRoute, '/wallpaper-engine/we-assets-dir', { dir: weAssetsFixture });
  const okBody = JSON.parse(okPost.__state.body.toString('utf8'));
  check('POST valid assets dir accepted (with texture count)',
    okPost.__state.status === 200 && okBody.available === true && okBody.textures === 3,
    'status=' + okPost.__state.status + ' textures=' + okBody.textures);

  const probe1 = await runHandler(laRoute, '/api/local-assets');
  const probe1Body = JSON.parse(probe1.__state.body.toString('utf8'));
  check('probe after configure → ok + roots[0].id=local',
    probe1Body.ok === true && probe1Body.roots && probe1Body.roots[0] && probe1Body.roots[0].id === 'local');

  const idxRes = await runHandler(laRoute, '/api/local-assets/local/materials/index.json');
  const idxBody = JSON.parse(idxRes.__state.body.toString('utf8'));
  check('materials index lists engine names (posix, ext stripped)',
    Array.isArray(idxBody.names)
      && idxBody.names.includes('util/noise')
      && idxBody.names.includes('particle/halo')
      && idxBody.names.includes('gradient/gradient_0'),
    (idxBody.names || []).join(','));

  const texRes = await runHandler(laRoute, '/api/local-assets/local/materials/util/noise.tex');
  check('tex bytes served verbatim', texRes.__state.status === 200
    && texRes.__state.body.equals(NOISE_BYTES), 'status=' + texRes.__state.status);

  const fontRes = await runHandler(laRoute, '/api/local-assets/local/fonts/NotoSans.ttf');
  check('arbitrary file served (fonts fallback path)', fontRes.__state.status === 200
    && fontRes.__state.body.equals(FONT_BYTES), 'status=' + fontRes.__state.status);

  // 安全与错误面：越界 → 403；未知素材源 → 404；缺失文件 → 404。
  // 注意：%2e%2e 会被 WHATWG URL 解析器在 pathname 阶段直接归并掉（到不了
  // 路由），真正能触达路径限定的是编码斜杠（..%2f 在 pathname 里保持编码，
  // 经 decodeURIComponent 后才变成 '/'）—— 用后者测围栏。
  const travRes = await runHandler(laRoute, '/api/local-assets/local/..%2f..%2fetc%2fpasswd');
  check('encoded-slash traversal fenced (403)', travRes.__state.status === 403,
    'status=' + travRes.__state.status);
  const badIdRes = await runHandler(laRoute, '/api/local-assets/nope/materials/index.json');
  check('unknown source id → 404', badIdRes.__state.status === 404, 'status=' + badIdRes.__state.status);
  const missRes = await runHandler(laRoute, '/api/local-assets/local/materials/util/missing.tex');
  check('missing file → 404', missRes.__state.status === 404, 'status=' + missRes.__state.status);

  // 清除（空串）→ 探测回落 ok:false。
  const clearPost = await postJson(weDirRoute, '/wallpaper-engine/we-assets-dir', { dir: '' });
  const clearBody = JSON.parse(clearPost.__state.body.toString('utf8'));
  check('POST empty dir clears the setting', clearPost.__state.status === 200 && clearBody.available === false);
  const probe2 = await runHandler(laRoute, '/api/local-assets');
  check('probe after clear → ok:false', JSON.parse(probe2.__state.body.toString('utf8')).ok === false);
}

// Level D 增补：local-assets 接线的静态契约（防重构丢线）。
check('client gates localAssets=1 on inventory availability',
  /weAssetsAvailable \? "&localAssets=1"/.test(src));
check('syncLayers key carries local-assets availability',
  /weAssetsAvailable \? "la1"/.test(src));
check('client posts assets dir to host route',
  /we-assets-dir/.test(src) && /function changeWeAssetsDir/.test(src));
check('host inventory reports weAssets availability',
  /weAssetsAvailable: weAssetsAvailable\(\)/.test(hostSrc));
check('host fences local-assets file paths',
  /未知素材源/.test(hostSrc) && /target\.startsWith\(root \+ sep\)/.test(hostSrc));

// ── teardown ────────────────────────────────────────────────────────────────
try { dispose && dispose(); } catch { /* ignore */ }
delete process.env.DSH_WE_STEAM_ROOT;
delete process.env.DSH_WE_UPLOAD_DIR;
rmSync(fixtureRoot, { recursive: true, force: true });
rmSync(TEST_UPLOAD_DIR, { recursive: true, force: true });
rmSync(weAssetsFixture, { recursive: true, force: true });

console.log('');
if (failed > 0) {
  console.log(`SCENE-LIVE CHECKS FAILED — ${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`ALL SCENE-LIVE CHECKS PASSED (${passed})`);
