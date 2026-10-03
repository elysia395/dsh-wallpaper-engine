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
 * Usage:  node test/verify-scene-live.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable, Writable } from 'node:stream';
import { execFileSync } from 'node:child_process';
// 剥注释：共享的字符串感知实现（`verify-module-layout` 的『剥注释必须字符串感知』一节钉住"不许再用朴素正则"）。
import { stripComments, stripExportBlocks } from './tools/js-text.mjs';
// 单独 import `src/**` 时补上 bundle 作用域的取词层（面板渲染器直接用 weT；见该 shim 的文件头）。
import { installWeTShim } from './tools/weT-shim.mjs';
installWeTShim();

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
    // 作者配色：这条属性既是垫底图的底色兜底，也是「主题随壁纸」的优先级①。
    // 目录形态的上传一旦在 inventory 里把它丢掉，优先级①对这些壁纸就不生效、只能退到
    // 画面主色 —— 实测那会把作者标了 0 0 0 的暗色壁纸判成浅色（本夹具就是那条判据）。
    general: { properties: { schemecolor: { order: 0, text: 'ui_browse_properties_scheme_color', type: 'color', value: '0.114 0.220 0.329' } } },
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
// 兜底页（issue #129 证据 4）：渲染页在场景解析失败时把 iframe 指到
// `<BASE>/default-wallpaper/index.html` —— 缺了它，「静默超时」没有可见落点
//（该文件上游在 public/ 下、不在构建产物里，必须由 sync-webwallgl 单独拷）。
check('fallback page vendored: default-wallpaper/index.html exists',
  existsSync(join(vendorDir, 'default-wallpaper', 'index.html')));
check('sync script copies the fallback page（否则下次同步删掉它）',
  /public['"], 'default-wallpaper'/.test(readFileSync(join(root, 'test', 'tools', 'sync-webwallgl.mjs'), 'utf8').replace(/"/g, "'")));
check('scene-serve serves default-wallpaper without immutable cache',
  /rest === 'default-wallpaper\/index.html'/.test(readFileSync(join(root, 'lib', 'routes', 'scene-serve.js'), 'utf8')));

// 网页壁纸帧率上限的实现质量与 shim 幂等性 —— 这两条都藏在
// vendor 产物里：升级上游后若忘记重新 vendor，断言会直接指出。
const vendoredShim = existsSync(join(vendorDir, 'web-shim.js'))
  ? readFileSync(join(vendorDir, 'web-shim.js'), 'utf8') : '';
/** `installRafThrottle` 的函数体（大括号配对）—— 节流实现只在这段里算数。 */
function shimThrottleBody(src) {
  const at = src.indexOf('function installRafThrottle');
  if (at < 0) return null;
  const open = src.indexOf('{', at);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  return null;
}
/**
 * 节流判据：**每帧都挂原生 rAF（保 vsync 相位），交付只看经过的时间**。
 * 三种坏形态都判红：
 *   · 定时器节流（`setTimeout(1000/fps)` 后再 rAF）—— 定时器落在刷新的任意相位上，
 *     30fps 上限产出 17/33/50ms 抖动，观感是「限了 30 反而更卡」；
 *   · 按**回调次数**跳帧（旧 `slot % n`）—— 长任务后浏览器一个 vsync 只补发一个回调，
 *     间隔被放大成「饿死时长 + 最多 (n-1)×vsync」，尾部呈目标间隔的整数倍；
 *   · 只在链首判相位（相位基准挂在链内）—— 作者回调普遍自递归登记下一帧，每次交付都换
 *     新链，饿死恰好落在链首时链内什么都看不到。
 * 判据作用在**剥掉注释**的代码上：这段的注释里就写着 `setTimeout(1000/fps)`。
 * 上游在 b11e839 把判据从「数回调次数」改成「比时间戳」（#8），本条随之更新。
 */
function shimThrottleOk(body) {
  if (typeof body !== 'string') return false;
  const code = stripComments(body);
  return code.includes('origRaf(step)')            // 每帧都挂原生 rAF（与 vsync 同相位）
    && /nowMs\s*-\s*lastDeliverNow/.test(code)     // 交付按**经过的时间**判，不看回调次数
    && /target\s*-\s*slack/.test(code)             // 目标间隔 1000/fps + 测量噪声容差
    && !/\bsetTimeout\s*\(/.test(code);            // 定时器节流 = 抖动
}
const shimBody = shimThrottleBody(vendoredShim);
check('vendored shim throttles by vsync frame-skip (not setTimeout)',
  shimThrottleOk(shimBody),
  '每帧挂原生 rAF + 按时间戳交付（旧的 setTimeout 节流与数回调次数两种实现都判红）');
check('vendored shim throttle negative control: 定时器 / 数回调次数 / 链内相位 三种坏实现都被判出',
  shimThrottleOk('{ rafMap[id] = { kind: "native", id: origRaf(step) }; setTimeout(function () { cb(now); }, 1000 / fps); }') === false
  && shimThrottleOk('{ slot++; if (slot % n !== 0) { rafMap[id] = { kind: "native", id: origRaf(step) }; return; } cb(now); }') === false
  && shimThrottleOk('{ var lastNow = 0; var nowMs = now; var target = 1000 / fps; var slack = 0; if (nowMs - lastNow < target - slack) return; rafMap[id] = { kind: "native", id: origRaf(step) }; }') === false
  && shimThrottleOk('{ var nowMs = 1; var target = 2; var slack = 0; if (nowMs - lastDeliverNow < target - slack) {} rafMap[id] = { kind: "native", id: origRaf(step) }; }') === true);
check('vendored shim installs only once (idempotent guard)',
  /__weShimInstalled/.test(vendoredShim),
  '双 shim 会让 rAF 节流叠加：15fps 上限实测变成 7.5fps');
// 站点根夹住（官方 WE 语义：壁纸目录是站点根，`..` 解析到根即丢弃）。插件形态是
// <BASE>/scene-files/<token>/…，与上游 dev server 的 /web/<token>/<itemId>/ 不同 ⇒
// 靠宿主声明 __weSiteRoot；这条钉住 vendor 产物里**两条腿都在**（声明优先 + 逃逸才改写），
// 少了声明那条，作者按官方语义写的 `../assets/x` 会 404（spine 类整页黑屏）。
check('vendored shim 站点根夹住：认宿主声明的 __weSiteRoot，且只改逃逸的相对 URL',
  /__weSiteRoot/.test(vendoredShim) && /function clampUrlToSiteRoot/.test(vendoredShim)
    && /clampUrlToSiteRoot\(inner\)/.test(vendoredShim) && /\bX\.prototype\.open\b/.test(vendoredShim),
  '声明读取 + XHR/fetch 两个网络入口的夹住');
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

// 本脚本全程模拟**带能力头栅栏的桌面端**：社区壳（DSH Desktop.app）会给每条插件
// 路由注入 x-dsh-desktop-renderer，观测到它宿主才把网页壁纸载荷放进独立媒体源 ——
// 下面那条「webLiveSrc 是媒体源绝对 URL」的闸门正是这个形态的回归门。裸请求
//（原生浏览器，载荷走应用源相对路径）那一档由 test/verify-adapter.mjs 另行断言。
const FENCE_HEADERS = { 'x-dsh-desktop-renderer': '1', 'user-agent': 'Electron/33.2.0' };

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
  const res = await runHandler(invRoute, '/wallpaper-engine/inventory', FENCE_HEADERS);
  const body = JSON.parse(res.__state.body.toString('utf8'));
  fixture = (body.wallpapers || []).find((w) => w.type === 'scene' && w.title === 'Live Fixture Scene') || null;
  check('fixture scene listed in inventory', Boolean(fixture), fixture ? fixture.id : 'not found');
  check('inventory marks fixture sceneLive=true with sceneLiveSrc',
    Boolean(fixture && fixture.sceneLive === true && typeof fixture.sceneLiveSrc === 'string' && fixture.sceneLiveSrc),
    fixture ? 'src len=' + String(fixture.sceneLiveSrc || '').length : '-');
  // 场景载荷的源由**宿主**给出（桌面形态下 = 自建媒体源的 origin）。这一条钉住"客户端
  // 不再自己拼 location.origin"的前提：宿主必须先把它端出来，空串才是"回落应用源"的合法值。
  check('inventory 给场景载荷端出宿主自己的源（sceneMediaBase）',
    typeof body.sceneMediaBase === 'string' && /^http:\/\/127\.0\.0\.1:\d+$/.test(body.sceneMediaBase || ''),
    'sceneMediaBase=' + (body.sceneMediaBase || '(空)'));
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

  // ── 大包的传输代价：可重验证缓存 + 载荷账本 ────────────────────────────────
  // 实测 `scene.pkg` 到 336MB，而每次重建 live 层都会重新拉一整遍；内容由 size+mtime
  // 唯一确定 ⇒ 给 ETag/Last-Modified（304 无体 = 复用手上的字节）。判据必须**两半都钉**：
  // ① 头在（缓存可用）；② 命中条件时真的 304 且零体（不是"带了头但仍然全量重传"）。
  const pkgEtag = h(pkgRes, 'ETag');
  const pkgCc = h(pkgRes, 'Cache-Control');
  check('scene.pkg 可重验证缓存（ETag + Last-Modified + must-revalidate，且**不是** no-store）',
    Boolean(pkgEtag) && Boolean(h(pkgRes, 'Last-Modified')) && /must-revalidate/.test(pkgCc) && !/no-store/.test(pkgCc),
    'etag=' + pkgEtag + ' cc=' + pkgCc);
  const notMod = await runHandler(filesRoute, `/wallpaper-engine/scene-files/${token}/scene.pkg`, { 'if-none-match': pkgEtag });
  check('条件 GET 命中 ⇒ 304 + 零体（真的省掉一次几百 MB 的读盘与传输）',
    notMod.__state.status === 304 && notMod.__state.body.length === 0,
    'status=' + notMod.__state.status + ' ' + notMod.__state.body.length + 'B');
  // 负对照：换一个 ETag ⇒ 必须回 200 全量（否则"凡带 if-none-match 就 304"也能过）
  const staleEtag = await runHandler(filesRoute, `/wallpaper-engine/scene-files/${token}/scene.pkg`, { 'if-none-match': 'W/"0-0"' });
  check('负对照：ETag 不匹配 ⇒ 200 全量（缓存判据有牙）',
    staleEtag.__state.status === 200 && staleEtag.__state.body.equals(pkgBytes),
    'status=' + staleEtag.__state.status + ' ' + staleEtag.__state.body.length + 'B');
  // 只带 If-Modified-Since（没有 ETag 的客户端）同样要能 304
  const imsRes = await runHandler(filesRoute, `/wallpaper-engine/scene-files/${token}/scene.pkg`, { 'if-modified-since': h(pkgRes, 'Last-Modified') });
  check('只带 If-Modified-Since ⇒ 同样 304 零体',
    imsRes.__state.status === 304 && imsRes.__state.body.length === 0,
    'status=' + imsRes.__state.status);
  // 目录围栏/404 这些**错误**响应仍必须 no-store（见下面 unknown token → 404 旁的判据）

  // ── 载荷传输账本（客户端首帧看护的"到底还在不在下载"）──────────────────────
  const progressRoute = routes.find((r) => r.path === '/wallpaper-engine/scene-payload-progress');
  check('载荷进度路由已注册', Boolean(progressRoute), progressRoute ? 'kind=' + progressRoute.kind : 'missing');
  if (progressRoute) {
    const progRes = await runHandler(progressRoute, `/wallpaper-engine/scene-payload-progress?token=${encodeURIComponent(token)}`);
    let prog = null;
    try { prog = JSON.parse(progRes.__state.body.toString('utf8')); } catch { prog = null; }
    // 上面已经真的拉过整包（200 全量 + Range）⇒ 账本必须记下"传过多少字节、走完几次"。
    check('账本记下这次传输（served ≥ 整包字节、completed ≥ 1、active 归零）',
      Boolean(prog) && prog.ok === true && prog.served >= pkgBytes.length && prog.completed >= 1 && prog.active === 0,
      prog ? JSON.stringify(prog) : 'bad json');
    check('账本带上整包体积（客户端据此把预算按包大小放大）',
      Boolean(prog) && prog.size >= pkgBytes.length, prog ? 'size=' + prog.size : '-');
    const unknownProg = await runHandler(progressRoute, '/wallpaper-engine/scene-payload-progress?token=bm90LWEtdG9rZW4');
    let unknownBody = null;
    try { unknownBody = JSON.parse(unknownProg.__state.body.toString('utf8')); } catch { unknownBody = null; }
    check('未知 token ⇒ ok:false（"没记账" ≠ "没在动"，客户端据此回落墙钟）',
      Boolean(unknownBody) && unknownBody.ok === false, unknownBody ? JSON.stringify(unknownBody) : 'bad json');
    // 老宿主没有这条路由时客户端必须静默退回墙钟：这里只钉"路由缺失不是崩溃源"的判据形态
    check('负对照：账本对"零传输"的 token 不给假进展（served=0）',
      Boolean(unknownBody) && unknownBody.served === 0 && unknownBody.completed === 0,
      unknownBody ? 'served=' + unknownBody.served : '-');
  }

  // Fence: encoded parent hops aiming at a file OUTSIDE the wallpaper dir
  // (5 hops up from …/431960/990001 to the fixture root; literal ../ would be
  // normalised away by `new URL()` before the handler ever sees it).
  const fenceUrl = `/wallpaper-engine/scene-files/${token}/%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fsecret.txt`;
  const fenceRes = await runHandler(filesRoute, fenceUrl);
  check('encoded ../../ escape fenced (403)', fenceRes.__state.status === 403, 'status=' + fenceRes.__state.status);

  const unknownRes = await runHandler(filesRoute, '/wallpaper-engine/scene-files/bm90LWF0b2tlbg/scene.pkg');
  check('unknown token → 404', unknownRes.__state.status === 404, 'status=' + unknownRes.__state.status);
  // 负对照：可重验证缓存**不得**把错误响应也放行（否则 Electron 会缓存住 404 错误页，
  // 之后即使文件到位也一直显示旧错误文本 —— 那是这条缓存策略唯一的已知风险）。
  check('负对照：404 仍 no-store',
    /no-store/.test(h(unknownRes, 'Cache-Control') || ''), h(unknownRes, 'Cache-Control'));

  // ── 目录围栏的第二层：**字面围栏不认识链接** ────────────────────────────────
  // `resolve()` + `startsWith` 只挡 `..`，而 `serveFile` 会跟随链接 ⇒ 只有第一层时
  // 目标并没有被真正钉在壁纸目录里。上面那条 encoded-escape 测的是**第一层**（字面路径），
  // 这里测**第二层**（`lstatSync` 拒链接 + `realpathSync.native` 包含性），两层各一条。
  // 真实建链接：Windows 用 junction（**不需要**开发者模式 / 管理员，故这一层在 CI 的
  // windows-latest 上真有覆盖），POSIX 用 dir 链接；file 链接两边都要权限，建不出来就
  // **显式记为平台跳过** —— 绝不静默当成通过。
  const dirLinkType = process.platform === 'win32' ? 'junction' : 'dir';
  // (a) 最终组件是链接：普通文件名，字面路径完全在界内，只有链接它才越界。
  const fileLinkName = 'escape-link.pkg';
  let fileLinkMade = false;
  try { symlinkSync(secretPath, join(workshopDir, fileLinkName), 'file'); fileLinkMade = true; } catch { /* 平台不允许 */ }
  if (fileLinkMade) {
    const linkRes = await runHandler(filesRoute, `/wallpaper-engine/scene-files/${token}/${fileLinkName}`);
    const linkBody = linkRes.__state.body.toString('utf8');
    check('指向界外的**文件链接** ⇒ 403（且没有读出 secret.txt）',
      linkRes.__state.status === 403 && linkBody.indexOf('top-secret') === -1,
      'status=' + linkRes.__state.status);
  } else {
    console.log('  ~ 平台跳过：本机不允许创建文件符号链接（该层在此平台零覆盖）');
  }
  // (b) **中间目录**是链接：字面路径全在界内（没有 `..`），只有 realpath 能判出越界 ——
  // 这一条才是第二层的真牙齿：删掉 realpath 比对，它必然变红。
  const dirLinkName = 'escape-dir';
  let dirLinkMade = false;
  try { symlinkSync(fixtureRoot, join(workshopDir, dirLinkName), dirLinkType); dirLinkMade = true; } catch { /* 平台不允许 */ }
  if (dirLinkMade) {
    const viaDir = await runHandler(filesRoute, `/wallpaper-engine/scene-files/${token}/${dirLinkName}/secret.txt`);
    const viaBody = viaDir.__state.body.toString('utf8');
    check('中间目录是**指向界外的链接** ⇒ 403（字面路径全在界内，只有 realpath 判得出）',
      viaDir.__state.status === 403 && viaBody.indexOf('top-secret') === -1,
      'status=' + viaDir.__state.status);
    // 负对照（防空转）：同一目录里的**普通文件**照旧 200 ⇒ 上面两条 403 不是"一律拒绝"，
    // 新增的这一层没有把整个 /scene-files 变成 403。
    const plainRes = await runHandler(filesRoute, `/wallpaper-engine/scene-files/${token}/project.json`);
    check('负对照：同目录的普通文件不受新围栏影响（200）',
      plainRes.__state.status === 200, 'status=' + plainRes.__state.status);
  } else {
    console.log('  ~ 平台跳过：本机不允许创建目录链接 / junction（realpath 那层在此平台零覆盖）');
  }

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
  const inv = JSON.parse((await runHandler(invRoute, '/wallpaper-engine/inventory', FENCE_HEADERS)).__state.body.toString('utf8'));
  const sc = (inv.wallpapers || []).find((w) => w.id === '990001') || null;
  check('场景壁纸也带 propsUrl（属性入口不被 web 分支覆盖）',
    Boolean(sc && sc.propsUrl && sc.propsUrl.indexOf('/props/') > 0),
    sc ? String(sc.propsUrl || '(空)').slice(0, 52) : 'scene not found');
}

console.log('Level C3 — web wallpaper files (shim injection / MIME / CORS)');
let mediaEntry = '';   // C4 复用：C3 里从 inventory 拿到的那条入口 URL
{
  const res = await runHandler(invRoute, '/wallpaper-engine/inventory', FENCE_HEADERS);
  const body = JSON.parse(res.__state.body.toString('utf8'));
  const web = (body.wallpapers || []).find((w) => w.id === '990003') || null;
  check('web wallpaper listed with webLive + webLiveSrc',
    Boolean(web && web.webLive === true && web.webLiveSrc),
    web ? 'type=' + web.type + ' src=' + String(web.webLiveSrc || '').length + 'ch' : 'not found');
  // 入口 URL 必须是**媒体源绝对 URL**（host 自建的第二个 loopback 监听），
  // 而不是插件路由：Desktop 的能力头（x-dsh-desktop-renderer）栅栏拒绝不透明源
  //（严格沙箱 iframe）对插件路由的请求，网页壁纸载荷因此整体挪到我们自己的源；
  // 这条断言就是「网页壁纸全黑」形态的回归闸门。
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
    // 站点根声明：必须**早于 shim**（shim 首次解析 URL 前就要读到），值是 token 目录。
    // 不给它，spine 类壁纸（作者按官方语义写 `../assets/…`）会逃出条目目录 404 黑屏。
    check('HTML entry 声明站点根（token 目录、早于 shim）',
      html.indexOf('data-we-site-root="host"') !== -1
        && html.indexOf(`window.__weSiteRoot=${JSON.stringify(baseUrl + '/')}`) !== -1
        && html.indexOf('data-we-site-root') < html.indexOf('data-we-shim'),
      'root=' + (html.indexOf('__weSiteRoot') !== -1) + ' 顺序=' + html.indexOf('data-we-site-root') + '<' + html.indexOf('data-we-shim'));
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
      // 载荷改成可重验证缓存之后，入口 HTML 必须**仍然** no-store：它带注入的
      // shim + 用户属性种子，缓存住 = 把旧种子喂给壁纸。
      const htmlCc = opaque.headers.get('cache-control') || '';
      check('入口 HTML 仍 no-store（可重验证缓存只放行载荷本身）', /no-store/.test(htmlCc), htmlCc);
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
      // ── 隐藏耦合：**mediaBase 同时是诊断信标的 origin** ─────────────────────────
      // 渲染页的 reportDiag() 打的是 `{mediaBase origin}/diag`（根路径，见 routes/diag.js
      // 引的 Kg()）。场景壁纸的 mediaBase 改成指向本媒体源之后，这个根路径若不在媒体源上
      // 也有落点，"大场景 pkg 首帧超时"时渲染页的告警会以 404 **静默丢掉** —— 而那正是
      // 排查现场唯一的内窗。所以这里对**真实 socket** 打一发信标，并要求它出现在
      // `/diag-log` 的**同一份**环形缓冲里（不是另起一份）。
      const beaconMsg = 'verify-scene-live: media-origin diag sink';
      const beacon = await fetch(base + '/diag?msg=' + encodeURIComponent(beaconMsg) + '&lvl=warn', { cache: 'no-store' });
      check('媒体源根路径 /diag 可达并收下信标（204）', beacon.status === 204, 'status=' + beacon.status);
      const logRoute = routes.find((r) => r.path === '/wallpaper-engine/diag-log');
      if (logRoute) {
        const logRes = await runHandler(logRoute, '/wallpaper-engine/diag-log', FENCE_HEADERS);
        let entries = [];
        try { entries = JSON.parse(logRes.__state.body.toString('utf8')).entries || []; } catch { /* 留空 = 判据变假 */ }
        check('媒体源上的告警落进**同一份**诊断缓冲（/diag-log 可回读）',
          entries.some((e) => String(e.msg || '').indexOf(beaconMsg) !== -1),
          'entries=' + entries.length);
        // 负对照（防空转）：没打过的信标不许被读到 ⇒ 上面那条不是"任何串都算命中"。
        check('负对照：未上报的信标读不到（判据不是恒真）',
          !entries.some((e) => String(e.msg || '').indexOf('never-reported-beacon') !== -1));
      } else {
        check('diag-log 路由已注册（否则上一条无从读取）', false, 'missing');
      }
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
    const inv = JSON.parse((await runHandler(invRoute, '/wallpaper-engine/inventory', FENCE_HEADERS)).__state.body.toString('utf8'));
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
  const res = await runHandler(invRoute, '/wallpaper-engine/inventory', FENCE_HEADERS);
  const body = JSON.parse(res.__state.body.toString('utf8'));
  const dirScene = (body.wallpapers || []).find((w) => w.id === 'up-dir-my-scene-1') || null;
  check('uploads WE project dir listed as scene', Boolean(dirScene), dirScene ? dirScene.type : 'not found');
  check('custom-storage scene takes its project.json title',
    Boolean(dirScene && dirScene.title === 'Custom Dir Scene'), dirScene ? dirScene.title : '-');
  check('custom-storage scene marked sceneLive + sceneLiveSrc',
    Boolean(dirScene && dirScene.sceneLive === true && dirScene.sceneLiveSrc),
    dirScene ? 'src len=' + String(dirScene.sceneLiveSrc || '').length : '-');
  // 回归：目录形态的上传必须把作者配色带进 inventory（见夹具里 schemecolor 的注释）。
  // 值走的是与 Steam 扫描同一条 schemeToCss（0–1 浮点三元组 → rgb()）。
  check('custom-storage scene carries the author scheme color (regression)',
    Boolean(dirScene && dirScene.schemeColor === 'rgb(29, 56, 84)'),
    dirScene ? String(dirScene.schemeColor) : '-');
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
    // P2-12 之后 `/scene-frame` 只剩「实时抓帧 → 自定义画面 → 空」三级：这个 fixture 既没被
    // 抓过帧、也没导入自定义画面 ⇒ 必须是**诚实的空态**（404），而不是"替作者猜一张图"
    //（旧语义会在这里 CPU 解包一张静态帧并回 200）。
    check('custom-storage scene frame：无抓帧且无自定义画面 ⇒ 404 空态（不猜图）',
      frameRes.__state.status === 404,
      'status=' + frameRes.__state.status + ' ' + frameRes.__state.body.length + 'B');
  }
}

// ── Level D: client source contract ─────────────────────────────────────────
console.log('Level D — client source wiring (src/client.js + 抽出的模块)');
// 客户端源码现在是**三个文件**：逻辑（src/client.js）、注入的样式表（src/styles.js）、
// 实时渲染管线（src/live-layer.js）。Level D 的判据里既有 JS 结构断言、也有样式规则断言、
// 还有"跨文件的接线"断言（如"面板调用 + 被调函数里的门禁"）—— 所以三个来源都读出来，
// **各自用在对应的判据上**（不图省事拼成一个字符串：那样一个文件的文本就能满足另一个文件的
// 结构断言，判据会失去牙）。
const src = readFileSync(join(root, 'src', 'client.js'), 'utf8');
// 快捷播放面板源码（类型筛选等面板本地行为的断言读它）。
// ⚠️ 这里**在定义点**统一剥掉文件末尾的 `export { … }`：本文件有两处把它喂给 `new Function`
// （模块级自由变量形态复现台），而 `new Function` 不是模块环境 ⇒ 不剥就是语法错误。
// 同一手法见 `test/verify-client.mjs` 的 effects 段；构建期内联时也是这么剥的。
const qpSrc = stripExportBlocks(readFileSync(join(root, 'src', 'quick-panel.js'), 'utf8'));
check('前置：qpSrc 已剥掉 `export { … }`（两处 new Function 依赖这条）',
  !/^\s*export\b/m.test(qpSrc), '残留 export ⇒ new Function 会当场语法错误');
// 同上，但**剥掉注释**：面板那条下钻的判据要找"最后一个 renderUserPropsPanel() 调用点"，
// 而文件头的散文里也写着这个名字（首个匹配落在注释里 ⇒ 判据恒真）。剥注释的共享实现见
// `test/tools/js-text.mjs`（本仓纪律：字符串感知的剥注释，不用朴素块注释正则）。
const qpCode = stripComments(qpSrc);
const stylesSrc = readFileSync(join(root, 'src', 'styles.js'), 'utf8');
const liveSrc = readFileSync(join(root, 'src', 'live-layer.js'), 'utf8');
const prepSrc = readFileSync(join(root, 'src', 'media-prep.js'), 'utf8');
const tabsSrc = readFileSync(join(root, 'src', 'panel-tabs.js'), 'utf8');
/** `function name() { … }` 的函数体源码（用于按内容而非脆弱的跨行正则断言）。 */
function fnBody(source, name) {
  const i = source.indexOf('function ' + name + '(');
  if (i < 0) return '';
  const j = source.indexOf('\n}', i);
  return j < 0 ? source.slice(i) : source.slice(i, j);
}
// resolveWallpaperFadeBg 自 P1-7 后半起住在 src/effects.js —— 断言改读该模块
// （函数体判据本身不变；同时钉住它**不在** src/client.js，防两边各留一份）。
const effectsSrc = readFileSync(join(root, 'src', 'effects.js'), 'utf8');
const fadeBgBody = fnBody(effectsSrc, 'resolveWallpaperFadeBg');
check('效果应用层已抽成独立模块并被内联',
  // 签名带可选 opts（拖动档 live，见 applyEffects 的文件头说明）⇒ 这里只认前缀。
  effectsSrc.includes('function applyEffects(') && effectsSrc.includes('function clearEffects()')
    && readFileSync(join(root, 'lib', 'client.js'), 'utf8').includes('function applyEffects(')
    && !src.includes('function applyEffects('));
const clientChecks = [
  // live 优先与 sceneVideo 让位都发生在 **buildMedia** 里（已抽到 media-prep.js）。
  ['live is the top priority for scenes and web', /const isLive = \(sel\.type === "scene" \|\| sel\.type === "web"\) && liveRenderEnabled\(sel\)/.test(prepSrc)],
  ['sceneVideo yields to live', /Boolean\(sel\.sceneVideo\) && !isLive/.test(prepSrc)],
  ['web wallpapers force the strict sandbox', /webSandbox=strict/.test(liveSrc)],
  ['heartbeat watchdog exists', /function startLiveWatch/.test(liveSrc) && /LIVE_FIRST_FRAME_MS/.test(liveSrc)],
  // P4-15：这条接线从 panel-tabs.js 挪进了 client.js 的 `onToggleSceneLive`（渲染器只调处理器）。
  // 两端都钉：处理器真的清了失败记忆，且面板确实引用那个处理器。
  ['failure memory persists', /function onToggleSceneLive\(e\)[\s\S]*?setSetting\("sceneLiveFailures", \{\}\)/.test(src)
    && /function liveFail/.test(liveSrc) && /onToggleSceneLive/.test(tabsSrc)],
  ['audio mux honours live', /!selLike\.sceneLiveActive/.test(src)],
  ['syncLayers key carries live state', /"live\\u0000" \+ \(selection\.sceneLiveSrc \|\| selection\.webLiveSrc\)/.test(liveSrc)],
  // sceneVideo 只在**非 live** 形态下进 key：live 生效时 buildMedia 已把 isSceneVideo
  // 短路，把 sceneVideo 算进 key 会让「sceneVideo 诚实化的时序补拉」
  //（scheduleSceneVideoResync 落地时 sceneVideo 由 null 变 URL）在 live 播放中
  // 冷启动一次渲染页 —— 无意义重建，用户会看到画面重新加载。
  ['sceneVideo stays out of the layer key while live renders',
    /\(layerLive \? "" : \(selection\.sceneVideo \|\| ""\)\)/.test(liveSrc)],
  // 同 id 的 revalidate 不得拆掉待挂载的预热页。`loadInventory() → revalidateSelection() →
  // applySelection(selection.id)` 传进来的就是当前选中项，而那份 pending 正是**本次要用的**
  // 那一个；无条件 `cancelLiveMount("selection")` 会把它清成 `about:blank` 并且此后没有任何人
  // 恢复（`liveMountPending` 已空、看护器只在挂载成功路径上武装）⇒ 图层永久停在垫底图。
  // 判据钉**机制**：那记取消必须被"新旧 id 不等"包住，且比较必须发生在 `selection.id` 赋值
  // **之前**（赋值之后两边永远相等，守卫会失效）。
  // ⚠️ 这是一次**时序竞态**（`SCENE_VIDEO_RESYNC_MS` 与 `liveBootDelay` 撞在同一时刻、主线程被
  // pkg 解码占住时预热页先输），源码与合成 DOM 判据看不见它 —— 这条只钉住结构不退回，
  // 运行期的复现证据是诊断里的 `boot-mount-cancel reason=selection` + `beat · liveOn=0 watch=-`。
  ['a same-id revalidate does not tear down the pending live mount',
    (() => {
      const body = fnBody(prepSrc, 'applySelection');
      const guard = body.indexOf('if (selection.id !== (id || "")) cancelLiveMount("selection")');
      const assign = body.indexOf('selection.id = id || ""');
      const bare = body.includes('\n    cancelLiveMount("selection")');
      return guard >= 0 && assign > guard && !bare;
    })(),
    (() => {
      const body = fnBody(prepSrc, 'applySelection');
      return 'guard=' + body.indexOf('if (selection.id !== (id || "")')
        + ' assign=' + body.indexOf('selection.id = id || ""')
        + ' bareCall=' + body.includes('\n    cancelLiveMount("selection")');
    })()],
  // 垫底静态帧是 iframe 的**下层**：只要 iframe 半透明（壁纸透明度一高），它就会以
  // a(1−a) 的强度透出来（实测「壁纸透明度高时显现静态帧」）。首帧点亮后必须整块退场，
  // 且必须**串行**——延迟到 iframe 淡入（1.8s）完成后再快收。若退回与 iframe 同步
  // 双淡出，两个半透明层互换会让黑底在中点漏出 ~25%（层底是原生纯黑/纯白），实测
  // 症状「切换完成后整屏呼吸式变暗后恢复」会复发。
  ['the static-frame underlay retires once the live frame is on',
    /:has\(\.we-live-iframe\.we-live-on\) \.we-live-poster\s*\{[^}]*opacity:\s*0/.test(stylesSrc)
    && /:has\(\.we-live-iframe\.we-live-on\) \.we-live-poster\s*\{[^}]*transition:\s*opacity\s+0\.3s\s+ease\s+1\.8s/.test(stylesSrc)],
  // 淡出底色必须是**原生外观**（纯黑/纯白），不能是主题面板色 —— 否则拉高「壁纸
  // 透明度」会露出一块与原生外观不符的主题色（用户实测反馈）。
  ['the wallpaper fade base is the native black/white, not the panel token',
    fadeBgBody.includes('--dsw-alias-bg-base')
    && /"#000000" : "#ffffff"/.test(fadeBgBody)
    && !fadeBgBody.includes('--dsw-alias-bg-layer-1')],
  // 画面来源选项的三条门禁：
  // - 「壁纸画面刷新」换的是 **CPU 静态帧**，实时画面在跑时它没有任何作用 → 只在
  //   live 未生效时渲染；
  // - 「实时帧」（GPU 抓帧：重新截 / 清除 / 微缩预览）与「自定义画面」**live 开着时
  //   同样显示** —— 那张静帧正是切换途中与 live 首帧前给用户看的画面，构图不对时
  //   必须能立刻重抓，而不是先关掉实时渲染；导入截图与 live 也互不干扰。
  ['CPU frame-variant row shows only while live is not effective',
    /sel\.type === "scene" && sel\.sceneFrameUrl && !liveRenderEnabled\(sel\)/.test(tabsSrc)],
  ['live-frame (GPU capture) row is NOT gated on the live switch',
    /sceneWithFrame && \(gpuPinnedHere \|\| liveRenderEnabled\(sel\)\)/.test(tabsSrc)],
  ['custom-frame row is NOT gated on the live switch',
    /sel\.type === "scene" && React\.createElement\("div", \{ className: "we-picker__ctl" \}/.test(tabsSrc)],
  // 「重新截」= force 重抓：必须走「先抓帧 + 内容门禁 → 成功后才清旧帧」的安全顺序，
  // 抓不到时不许把原来那张删掉（面板上给失败原因）。
  ['manual re-capture forces a fresh capture through the safe path',
    // 跨文件接线：面板（client.js）发起 force 重抓；"先抓帧 + 内容门禁 → 成功后才清旧帧"
    // 的安全顺序在被调的 scheduleLiveFrameBackfill 里（live-layer.js）。
    /scheduleLiveFrameBackfill\(live, \{ force: true \}\)/.test(src)
    && /const stale = force \|\| \(hasGpu && arRef > 0/.test(liveSrc)],
  // 微缩预览必须指向层里正在用的那个 URL（同档位）+ 缓存破坏参数。
  ['frame preview points at the live layer URL',
    /function framePreviewSrc\(selLike\)[\s\S]{0,500}?frameUrlWithVariant\(selLike && selLike\.sceneFrameUrl, v\)[\s\S]{0,200}?we-prev=/.test(src)],
  ['pointer injection wired', /__wp\.pushPointer|wp\.pushPointer/.test(liveSrc) && /pointerLeave/.test(liveSrc)],
  ['fit mapping table present', /SCENE_LIVE_FIT = \{ cover: "cover"/.test(liveSrc)],
  // **实测**：渲染页 resume() 会 resetFrameMeter，心跳若每秒无条件调 resume 会永远读到
  // fps=0 → 15s 误降级。控制必须去重下发，且 tick 内先读统计再应用控制。
  ['controls are deduped before dispatch', /liveApplied\.playing !== playing/.test(liveSrc)],
  ['heartbeat reads stats before applying controls', /const stats = liveStats\(frame\);\s*\n\s*applyLiveControls\(frame\);/.test(liveSrc)],
  ['upload management list excludes project dirs', /isUploadedWallpaper\(w\) && !isDirWallpaper\(w\)/.test(src)],
  // 帧率取证（「限了 30 还卡」时唯一能分清「壁纸自身掉帧」与「整页掉帧」的手段）
  ['live fps probe reports ui / web / rnd to the diag channel',
    liveSrc.includes('function reportLiveFps') && liveSrc.includes('"live-fps"')
      && liveSrc.includes('function takeUiFps') && liveSrc.includes('wstate.webFps')],
  // 网页壁纸的 src 直用 host 给的绝对 URL（媒体源）；相对形态仅作回落。
  ['web live src reuses the absolute media-origin URL', liveSrc.includes('const webEntry = String(selLike.webLiveSrc || "")')
    && liveSrc.includes('/^https?:\\/\\//i.test(webEntry)')],
  // **实测**症状：「场景类壁纸正常几秒就失效」「网页也是」「失效以后是静态的」
  // 「只有扩展模式」「网页类是预览图」。成因是 extended 的「首帧后延迟 8000ms 换元」自救：
  // 换元后的新元素为防白闪被摘掉 `we-live-on`，层回落垫底图（场景=静态帧、网页=预览图），
  // 而渲染页照旧出声；日志上 first-frame-ok 后**正好 +8s** 出现 live-frame-rebuilt。
  // 该 workaround 的前提（启动期 iframe 永不上屏）已不成立 ⇒ 改成 **opt-in**。
  ['extended frame swap is opt-in (default off) — it is the "几秒后失效" 病因',
    /function useExtendedFrameSwap\(\)/.test(liveSrc)
    && /extendedFrameSwap = String\(rawFlag\)\.toLowerCase\(\) === "1";/.test(liveSrc)
    && /if \(desktopWindowMode\(\) === "extended" && !liveFrameRebuildTimer && useExtendedFrameSwap\(\)\) \{/.test(liveSrc)],
];
for (const [name, ok] of clientChecks) check(name, ok);
// 负对照：**没有开关的**换元调用点（旧写法）喂给同一判据必须被判不合格 —— 否则这条断言
// 只要文件里出现 `we-ext-swap` 字样就会通过，等于没有牙。
{
  const swapIsOptIn = (s) => /if \(desktopWindowMode\(\) === "extended" && !liveFrameRebuildTimer && useExtendedFrameSwap\(\)\) \{/.test(s);
  const ungated = 'if (desktopWindowMode() === "extended" && !liveFrameRebuildTimer) {';
  check('negative control: the ungated extended swap call site is rejected', swapIsOptIn(ungated) === false);
  check('positive control: the current client gates the extended swap', swapIsOptIn(liveSrc) === true);
}
// ── Level D3: 首帧看护的"按进展判超时" + 载荷延迟/暂停 + 失败分因 ──
// 现场：320MB/94MB 的 `scene.pkg` 在**三个客户端实例**同时挂载时
// 传输被饿死，可见那个实例 15s 后 `stats={"fps":0,"running":false}`（一帧都没出）→ 被判
// 「首帧超时」并写进**共享**失败记忆（所有窗口一起降级），而渲染器单独跑同一份包只要 1–2s。
// 四条修正各配一条判据 + 负对照；判据只看真实代码行（注释由共享 stripComments 剥掉）。
{
  const code = stripComments(liveSrc);
  // ① 预算由包大小放大 + 有硬上限（不是固定 15s 墙钟）
  check('首帧预算按 scenePkgBytes 放大，且封顶 LIVE_FIRST_FRAME_MAX_MS',
    /function liveFirstFrameBudget\(/.test(code) && /scenePkgBytes/.test(code)
      && /Math\.min\(LIVE_FIRST_FRAME_MAX_MS, scaled\)/.test(code)
      && /const LIVE_FIRST_FRAME_MAX_MS = \d+/.test(code));
  // ② 传输有进展 ⇒ 每拍重置计时（与"暂停期不计时"同一条纪律）
  check('载荷有进展就不计超时（loadingTicks + startedAt 重置）',
    /if \(livePayloadFlowing\(watch\)\) \{\s*\n\s*watch\.loadingTicks \+= 1;\s*\n\s*watch\.startedAt = Date\.now\(\);/.test(code)
      && /function livePayloadFlowing\(watch\)/.test(code)
      && /LIVE_PAYLOAD_STALL_MS/.test(code));
  // ③ 账本读数三态分离（issue #129）：HTTP 200 + ok:false = 账本**明确**没见过这个 token
  //    （本实例的取包根本没到宿主）→ 标 payloadUnseen，归因时按传输侧；请求失败（旧宿主
  //    404 / 断网）⇒ payload=null 且不标 unseen → 归因退回墙钟原语义。
  check('账本读数三态：ok:false 标 payloadUnseen；请求失败仍是未知（退回墙钟）',
    /if \(!d \|\| d\.ok !== true\) \{/.test(code)
    && /if \(d && d\.ok === false\) watch\.payloadUnseen = true;/.test(code)
    && /\.catch\(\(\) => \{ watch\.payloadPolling = false; \}\)/.test(code)
    && /SCENE_PAYLOAD_PROGRESS_PATH/.test(code));
  // ④ 隐藏/不播时不拉载荷：建层延迟 + 中途摘 src + 可见时补回（三条都在）
  check('隐藏/不播的实例不拉载荷（建层延迟 + 中途暂停 + 可见时补回）',
    /if \(liveFrameShouldDefer\(\)\) \{\s*\n\s*frame\.dataset\.weLiveSrc = url;/.test(code)
      && /function suspendLivePayload\(frame, watch\)/.test(code)
      && /frame\.src = "about:blank";/.test(code)
      && /function armDeferredLiveFrame\(frame\)/.test(code)
      && /armDeferredLiveFrame\(liveFrame\);/.test(code));
  // ⑤ 延迟载荷的帧不得被"空白文档的 load"武装心跳（那会白烧一个预算窗口 → 误判超时）
  check('空白文档（载荷暂停）不武装心跳：load 与三处直接武装都过 liveFrameDeferred',
    /if \(frame\.isConnected && !liveFrameDeferred\(frame\)\) startLiveWatch\(frame, sel\.id\);/.test(code)
      && /if \(!liveFrameDeferred\(frame\)\) \{ try \{ startLiveWatch\(frame, sel\.id\); \} catch/.test(code)
      && (code.match(/!liveFrameDeferred\(/g) || []).length >= 4);
  // ⑥ 失败分因（issue #129 收紧后）：归"渲染侧"（落盘）必须先有**本看护窗口内**的整包
  //    完成证据 —— 账本跨实例累积，completed>0 可能只是别的窗口很久以前传完的；
  //    没有窗口内证据（含账本明确 unseen）一律按传输侧软失败。stall 同级：失焦/被遮挡
  //    窗口的"无帧"不是"渲染不出来"的证据，同样只进会话内。
  check('失败分因：落盘要有窗口内整包证据；unseen/stall 都走会话内软失败',
    /function liveFailCauseOf\(watch\)/.test(code)
      && /if \(!p\) return watch && watch\.payloadUnseen \? "transfer" : "";/.test(code)
      && /if \(p\.active > 0\) return "transfer";/.test(code)
      && /if \(p\.completed - s\.completed <= 0\) \{/.test(code)
      && /watch\.payloadStart = \{ served, completed: watch\.payload\.completed \};/.test(code)
      && /cause === "transfer" \|\| reason === "stall"/.test(code)
      && /liveSessionFailures\.set\(wid, softReason\)/.test(code)
      && /function scheduleLiveTransferRetry\(wid, attempts\)/.test(code)
      && /LIVE_TRANSFER_RETRY_LIMIT/.test(code)
      && /LIVE_TRANSFER_RETRY_DELAY_MS/.test(code));
  check('软失败自动重试认一切会话内软失败（stall 也走重试，不只 transfer）',
    /if \(!liveSessionFailures\.has\(String\(wid\)\)\) return;/.test(code));
  check('出首帧即清软失败与重试计数（否则一次抖动会永久压着这张壁纸）',
    /liveSessionFailures\.delete\(watch\.wid\);/.test(code) && /liveTransferAttempts\.delete\(watch\.wid\);/.test(code));
  // ⑦ 层键带 mediaBase：宿主把媒体源端出来之后必须重建（否则旧渲染页一直用陈旧的源）
  check('层键含 sceneMediaBase（源变化 ⇒ 重建到媒体源）',
    /selection\.inventory\.sceneMediaBase\) \|\| ""\)/.test(code));
  // ⑧ 软失败重试前刷库存（本实例的 inventory 可能粘在"媒体源起来之前"的空串上）
  check('软失败重试前刷库存（粘住的空串是传输饿死的常见成因）',
    /if \(!\(selection\.inventory && selection\.inventory\.sceneMediaBase\)\) \{\s*\n\s*try \{ loadInventory\(\); \}/.test(code));
  // ⑨ client-boot 必须延迟一拍（顶层读 selection 会撞 TDZ，实测 0 行落盘）
  check('client-boot 延迟一拍上报（顶层读 selection 会被 TDZ 静默吞掉）',
    /setTimeout\(function \(\) \{\s*\n\s*try \{\s*\n\s*liveLog\("client-boot"/.test(code));
  // ⑩ 显式重试（面板重开开关）必须把会话内软失败一起清掉 —— 否则「重开开关可重试」
  //    这条逃生门对传输类失败不成立（它不在设置里，页面上看不见却拦着 live）。
  check('显式重试同时清会话内软失败（跨文件接线：面板 → 处理器 → clearLiveSessionFailures）',
    /function clearLiveSessionFailures\(\)/.test(code)
      && /liveSessionFailures\.clear\(\)/.test(code)
      // P4-15：调用点从 panel-tabs.js 挪进 client.js 的 `onToggleSceneLive`。**两端都要在**
      //（面板引用处理器 + 处理器真的清）：只钉一端就漏掉了"把另一端删掉"这种回归。
      && /function onToggleSceneLive\(e\)[\s\S]*?clearLiveSessionFailures\(\);/.test(src)
      && /onToggleSceneLive/.test(tabsSrc));
  // ⑪ 失败记忆的**管线身份**：旧管线的 timeout 断言不许跨管线复用 —— 它是面板那行
  //    「实时渲染失败（…）」的唯一来源，实测会让"宿主半没重载 + 客户端已更新"看起来毫无作用。
  check('失败记忆带管线身份，换管线作废一次（bundle 变 / 媒体源从无到有）',
    /function migrateStaleLiveFailures\(\)/.test(code)
      && /migrateStaleLiveFailures\(\);/.test(code)
      && /function livePipelineChanged\(\)/.test(code)
      && /String\(prev\.build \|\| ""\) !== now\.build\) return "build"/.test(code)
      && /Number\(prev\.media\) === 0 && now\.media === 1\) return "media"/.test(code)
      && /rememberLivePipeline\(\)/.test(code)
      && /LIVE_DIAG_BUILD = "d8"/.test(code));
  // 记录失败时必须**记住管线身份**，否则下次启动会把这条管线自己挣来的记忆当陌生管线清掉。
  check('记录失败时写下管线身份（否则自己的记忆会被下一次启动清掉）',
    /map\[wid\] = reason === "stall" \? "stall" : "timeout";[\s\S]{0,400}?rememberLivePipeline\(\);/.test(code));
  // 负对照：把"单向"改成双向（媒体源消失也清）⇒ 同一条判据变假。
  const oneWayPredicate = (s) => /Number\(prev\.media\) === 0 && now\.media === 1\) return "media"/.test(s)
    && !/Number\(prev\.media\) === 1 && now\.media === 0/.test(s);
  const twoWay = code.replace('Number(prev.media) === 0 && now.media === 1',
    'Number(prev.media) === 1 && now.media === 0');
  check('负对照：把单向判据改成双向（源一抖动就抹掉真实失败记忆）会被判红',
    twoWay !== code && oneWayPredicate(twoWay) === false && oneWayPredicate(code) === true);
  // 负对照：把"按进展重置"那两行换成旧的固定墙钟写法 ⇒ 同一条判据变假
  const flowingOk = (s) => /if \(livePayloadFlowing\(watch\)\) \{\s*\n\s*watch\.loadingTicks \+= 1;/.test(s);
  const degraded = code.replace(/if \(livePayloadFlowing\(watch\)\) \{\s*\n\s*watch\.loadingTicks \+= 1;\s*\n\s*watch\.startedAt = Date\.now\(\);\s*\n\s*\}/,
    '/* 旧写法：照常计时 */');
  check('负对照：退回固定墙钟（不看进展）会被同一条判据判红',
    degraded !== code && flowingOk(degraded) === false && flowingOk(code) === true);
}
// ── Level D2: 实时管线抽模块的结构契约（抽出来之后钉住）─────────────────────
// 契约的可核对形式：
//   · 管线**只在 live-layer.js 里**（client.js 不得再留一份同名实现）；
//   · 它对 client.js 的跨模块**写**为零 —— 唯一一处曾被外部翻转的状态（liveDiagOn）
//     必须走 toggleLiveDiag() 入口；
//   · 必须登记进 INLINE_MODULES **且真的进了产物**（防孤儿：文件在却不进 bundle）。
{
  const build = readFileSync(join(root, 'scripts', 'build-client.mjs'), 'utf8');
  const bundle = readFileSync(join(root, 'lib', 'client.js'), 'utf8');
  const MOVED = ['function startLiveWatch(', 'function syncLayers()', 'function scheduleLiveFrameBackfill(',
    'function liveLog(', 'function createLiveFrame('];
  const stillInClient = MOVED.filter((m) => src.includes(m));
  check('实时管线只在 src/live-layer.js（client.js 不留第二份）', stillInClient.length === 0,
    stillInClient.join(' ') || '搬走了 ' + MOVED.length + ' 个入口');
  check('client.js 对管线状态零跨模块写（liveDiagOn 必须走入口）',
    !/^\s*liveDiagOn\s*=/m.test(src) && !/^\s*liveDiagOn\s*=/m.test(tabsSrc)
    // P4-15：入口调用点从 panel-tabs.js 挪进 client.js 的 `onToggleLiveDiag`（渲染器只调处理器）。
    && /function onToggleLiveDiag\(\) \{ toggleLiveDiag\(\); emit\(\); \}/.test(src)
    && /onToggleLiveDiag/.test(tabsSrc));
  // ── 视频壁纸走**独立通道**（`src/video-layer.js`），不走实时那条路 ──────────────────
  // 现场（实测）：视频档此前过实时管线的切层内容闸门 ⇒ 整次切换（含过场）被推迟到首个
  // 可解码帧（源越大 / 帧率上限越高越久，十几秒）。正解不是调阈值，而是给视频一条自己的
  // 通道：就绪判据 = 海报**已加载** / 首帧 / 预算，且没画面时旧壁纸留屏（绝不露层底色 ——
  // 改成"poster 属性存在即放行"时出现过"十几秒纯色"，那正是这条注释要防的）。
  {
    const CH = readFileSync(new URL('../src/video-layer.js', import.meta.url), 'utf8');
    const LIVE = readFileSync(new URL('../src/live-layer.js', import.meta.url), 'utf8');
    check('视频通道有独立的就绪判据 videoContentReady（海报已加载 / 首帧）',
      CH.includes('function videoContentReady(video)')
      && CH.includes('__wePosterReady === true')
      && CH.includes('Number(video.readyState) >= 2'));
    check('视频通道必须探海报**加载**，不是只看属性存在',
      CH.includes('function probeVideoPoster(') && CH.includes('img.onload'));
    check('视频通道有兜底预算（拿不到海报也要能换下去 —— ⑥ 后它与执行器一起在通道里）',
      CH.includes('VIDEO_POSTER_BUDGET_MS') && CH.includes('setTimeout(stallGuard, VIDEO_POSTER_BUDGET_MS)'));
    // 真机取证（2026-10-02）：旧行为"预算到期就放行"会在 `<video>` rs=0 时把层放上屏，
    // 屏上只剩这一层底色（用户看到"纯色帧"，实测 1–2 秒起）。判据：预算这一路**只许在
    // 屏上真有画面时放行**，停滞到上限就停手留旧壁纸，绝不放行空层。
    // 审计收口（2026-10-02，合并 PR #128 后）：自续期链的取消句柄必须是读最新 id 的
    // cancelStall 闭包 —— 快照 id 清不掉在途下一跳，连切时遗留 tick 会把下一层的空层推上屏；
    // 且链上放行只许经 recheck（video 有画面 ≠ 层有画面，Edge canvas 还要等第一笔）。
    check('兜底预算不得放行空层（停滞只留旧壁纸，不铺底色）',
      CH.includes('const stallGuard = () => {')
      && /videoContentReady\(video\) \|\| video\.__weReady === true/.test(CH)
      && CH.includes('VIDEO_STALL_GIVE_UP_MS')
      && /waited >= VIDEO_STALL_GIVE_UP_MS[\s\S]{0,400}?video-stall/.test(CH)
      && CH.includes('cancelStall')
      && LIVE.includes('p.cancelStall')
      && !CH.includes('budget: posterGiveUp')
      && !LIVE.includes('clearTimeout(p.posterGiveUp)'));
    // 真机取证（2026-10-02，第二轮）：**只有设了「帧率上限」时才会再看到纯色帧** —— 抽帧就绪
    // 那一刻在在屏元素上 `src=transcoded; load()` 会清掉当前帧。判据：自动升级不许在"已上屏"
    // 的层上换源（推到下一次建层直接用抽帧版），只有"层还被闸门押着"或"用户刚主动改过上限"
    // 才当场换。
    check('抽帧升级不在已上屏的层上换源（换源＝清掉当前帧＝纯色）',
      CH.includes('function layerStillPending(')
      && /if \(!layerStillPending\(\) && !upgradeByUser\)[\s\S]{0,400}?selection\.transcodeReady = \{ token, fps: cap, url: transcodedUrl \}/.test(CH)
      && /useCached \? rc\.url : sel\.url/.test(CH)
      && /upgradeByUser = Date\.now\(\) - capChangedAt < 5000/.test(CH));
    // ── ① 提交前预热：把"取数"挪出切换的关键路径 ───────────────────────────────
    // 实测：宿主+磁盘 ~4ms、loadedmetadata→presented ~110ms，其余是"还没开始取数"；
    // 视频档此前刻意不跑准备链（怕第二个 4K 解码器）⇒ 整段启动成本压在关键路径上。
    // 折中＝只预到 HAVE_METADATA：**绝不 play()、绝不开 autoplay**。
    check('① 提交前预热只到元数据（不引进第二个解码器）',
      CH.includes('const VIDEO_WARM_TTL_MS')
      && CH.includes('el.preload = "metadata"')
      && CH.includes('el.autoplay = false')
      && !/el\.play\(/.test(CH)
      && CH.includes('function consumeWarmVideo(')
      && CH.includes('function warmVideoForPointer(')
      // 赋 src 已经启动资源选择，**不得**再补一次 load()（同值重启 = 白跑一次取数）。
      && !/el\.src = u;\s*\n\s*el\.load\(\);/.test(CH)
      && CH.includes('const warmed = prepared ? null : consumeWarmVideo(sel.url);')
      // 领养的元素**不得重赋 src**（同值重赋也会重启资源选择 = 黑屏闪烁源）：
      // 建层那段"设 src / 挑抽帧版"只对新建元素生效。
      && CH.includes('if (!prepared && !warmed) {'));
    check('① 预热的触发点是卡片身份标记（按下即预热、停在卡上也预热）',
      src.includes('warmVideoForPointer')
      && src.includes('addEventListener("pointerdown", onWarmPointerDown, { capture: true, passive: true });')
      && src.includes('addEventListener("pointerover", onWarmPointerOver, { capture: true, passive: true });')
      && CH.includes('VIDEO_WARM_HOVER_MS')
      && src.includes('disposeWarmVideo();')
      && readFileSync(join(root, 'src', 'picker-modal.js'), 'utf8').includes('"data-we-id": String(w.id)')
      && readFileSync(join(root, 'src', 'quick-panel.js'), 'utf8').includes('"data-we-id": String(w.id)'));
    // faststart 变体与"字节布局不得中途改换"（真机根因 + 我在自查里发现的隐患）：
    //   · 真机取证（当时加的临时插桩，已随本次提交删除）：播放器对 `Range: bytes=0-` 会
    //     **顺流整读**，moov 在尾部的源于是要读到文件末尾才报元数据，耗时 ∝ 文件大小
    //     （764MB/1761ms … 97MB/324ms）。变体把 moov 挪到头部即解 —— 但原片与变体的
    //     **字节偏移不同**，同一次播放里绝不能前半段读原片、后半段读变体（解复用器会按旧
    //     偏移读新布局 ⇒ 花屏/解码失败）。
    //   · 所以 /media 的选片必须经 `pinnedFaststartVariant`（第一次请求定音），而不是直接问缓存。
    const hostLib = readFileSync(join(root, 'lib', 'index.js'), 'utf8');
    check('① faststart 变体：同一 token 在运行期内钉住同一份字节布局（不许播放中途换文件）',
      hostLib.includes('function pinnedFaststartVariant(')
      && hostLib.includes('const MEDIA_CHOICE_PIN = new Map();')
      && /pinnedFaststartVariant\(abs, token, log\)/.test(hostLib)
      && /serveFile\(fast \|\| abs/.test(hostLib)
      // 钉子命中必须**续期**（审计 2026-10-02）：循环壁纸一次播放远超 TTL，固定窗口会在
      // 会话中途（seek/重缓冲触发新 Range 请求时）换字节布局。
      && hostLib.includes('pin.at = now;')
      // 生成命令必须是"只搬盒子"的复制（不得重编码），并且缓存预算有上限、命中会顶 mtime。
      && /'-c', 'copy', '-movflags', '\+faststart'/.test(hostLib)
      && hostLib.includes('FASTSTART_CACHE_MAX_BYTES') && hostLib.includes('touchFaststart('));
    check('实时管线的视频分支委托给通道，而不是自己下判据',
      LIVE.includes('return videoContentReady(video);'));
    // ── 视频通道的**符号围栏**（目标 ①：先造判据再搬家）──────────────────────────
    // 通道的价值就是"实时专属的东西一件都不过去"。搬家期间它是安全网：每搬一块进来，
    // 立刻检查这块有没有把实时符号带过来。两个方向都要防：
    //   · 围栏 —— 通道文件里不得出现清单里的任何符号；
    //   · **反空转地板** —— 清单里的符号必须仍真实存在于实时模块（否则有人改名之后，
    //     围栏就成了"查一堆不存在的名字"，永远绿）。
    const CHANNEL_FILES = ['../src/video-layer.js', '../src/layer-core.js'];
    const LIVE_ONLY = [
      'liveRenderEnabled', 'liveRenderUrl', 'applyLiveControls', 'startLiveWatch', 'stopLiveWatch',
      'liveFail', 'liveFrameEl', 'buildLivePoster', 'scheduleLiveMount', 'createLiveFrame',
      'cancelLiveMount', 'retainFrameBytes', 'releaseFrameBytes', 'paintFrame',
      'probeWallpaperOnScreen', 'layerContentReady', 'armLayerContentReveal', 'livePipelineNow',
      'migrateStaleLiveFailures', 'scheduleLiveFrameBackfill',
    ];
    const srcOf = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
    // ⚠️ **先剥注释再扫**（本仓 ADR-0006 规矩 ⑦）：⑥ 之后视频通道里会出现
    // 「实时管线只留一次委托」这类注释，注释里提到符号名不算引用。
    // 剥注释走**共享的字符串感知实现**（文件顶部的 `stripComments` 就是它）——
    // 这里不要再写第二份朴素正则：块注释正则会把字符串里的 `/*` 也吃掉
    //（docs 档的 verify-module-layout 专门判这一条，实测曾因这份本地副本判红）。
    const hits = (text) => LIVE_ONLY.filter((s) => new RegExp('\\b' + s + '\\b').test(stripComments(text)));
    const offenderList = [];
    for (const rel of CHANNEL_FILES) {
      for (const s of hits(srcOf(rel))) offenderList.push(rel + String.fromCharCode(58) + s);
    }
    check('围栏：视频通道不引用任何实时专属符号（' + CHANNEL_FILES.length + ' 文件 × ' + LIVE_ONLY.length + ' 符号）',
      offenderList.length === 0, offenderList.join(', ') || '干净');
    check('反空转：清单里的符号仍真实存在于实时模块（改名后围栏不许退化成查空名单）',
      hits(srcOf('../src/live-layer.js')).length === LIVE_ONLY.length,
      '实时模块命中 ' + hits(srcOf('../src/live-layer.js')).length + '/' + LIVE_ONLY.length);
    check('negative control: 通道里塞进任一实时符号都会被同一函数判出',
      hits('const u = liveRenderUrl(sel); const f = () => armLayerContentReveal();').length === 2
      && hits('const u = myOwnRenderUrl(sel);').length === 0);
    // ⑦ 名单**显式钉住**：恰好是视频通道的两个文件（通道本体 + 共用核心），且不含 ④ 已
    // 并入的 transcode.js —— 免得以后"扩容"成一份过期名单（那种名单会静静地不再看守）。
    check('⑦ 围栏名单恰好覆盖视频通道（通道 + 共用核心，不含已并入的 transcode.js）',
      CHANNEL_FILES.length === 2
      && CHANNEL_FILES.includes('../src/video-layer.js')
      && CHANNEL_FILES.includes('../src/layer-core.js')
      && !CHANNEL_FILES.some((f) => f.includes('transcode')));
  }
    // 搬移要**真的发生**：符号在核心里有定义，且原处不再有副本（否则只是复制一份、
    // 两条通道各留一个 —— 改一边另一边不动，那比不搬更坏）。
    const coreSrc = readFileSync(new URL('../src/layer-core.js', import.meta.url), 'utf8');
    const liveSrc = readFileSync(new URL('../src/live-layer.js', import.meta.url), 'utf8');
    const movedBlocks = ['nudgeWallpaperRepaint', 'onScreenBrief', 'retireFadingLayer', 'startLayerTransition', 'layerKeyDiff', 'switchTransitionOf', 'releaseLayerMedia', 'openRotationAudioGate', 'mediaFramesOf',
      'scheduleFadingLayerRemoval', 'applyInlineStyle'];
    const defsInFile = (text, n) => (text.match(new RegExp('^(?:function\\s+' + n + '\\s*\\(|(?:const|let|var)\\s+' + n + '\\s*=)', 'gm')) || []).length;
    check('共用核心真的持有搬过来的块，且实时管线里不再有副本（' + movedBlocks.length + ' 个符号）',
      movedBlocks.every((n) => defsInFile(coreSrc, n) === 1 && defsInFile(liveSrc, n) === 0),
      movedBlocks.map((n) => n + ':' + defsInFile(coreSrc, n) + '/' + defsInFile(liveSrc, n)).join(' '));
    // ③ 的搬移同理：视频档的媒体构建必须在**视频通道**里，media-prep 只留委托。
    const prepSrc = readFileSync(new URL('../src/media-prep.js', import.meta.url), 'utf8');
    const videoSrc = readFileSync(new URL('../src/video-layer.js', import.meta.url), 'utf8');
    check('③ 视频档的媒体构建在视频通道里，media-prep 里不再有副本（只剩委托）',
      defsInFile(videoSrc, 'buildVideoMedia') === 1
      && defsInFile(prepSrc, 'buildVideoMedia') === 0
      && prepSrc.includes('buildVideoMedia(sel, fitClass)'),
      'video=' + defsInFile(videoSrc, 'buildVideoMedia') + ' prep=' + defsInFile(prepSrc, 'buildVideoMedia'));
    // ⚠️ 实测回归：提取 buildVideoMedia 时切分器的**末端排他**把分支最后一行切掉了，
    // 而那行正是 `.we-media` / `.we-media--fit` 类名的来源 ⇒ 视频只显示左上角、占不满屏。
    // 这条把"两条腿都要挂类名"钉住（Edge 腿挂的是镜像 canvas，非 Edge 腿挂 <video>）。
    const videoFn = (videoSrc.match(/function buildVideoMedia\s*\([\s\S]*?\n\}/) || [])[0] || '';
    check('③ 视频档两条腿都挂了类名（we-media--canvas + fitClass / we-media + fitClass）',
      videoFn.includes('canvas.className = \"we-media we-media--canvas\" + fitClass;')
      && videoFn.includes('media.className = \"we-media\" + fitClass;'));
    // ── ② 帧率上限的判据是「上限能不能真的降帧」─────────────────────────────────
    // 设计口径：上限存在的唯一目的是压 GPU 解码占用（Video Decode 随帧率上升）。
    // 所以只有"源帧率高于上限"才值得整片重编码；源帧率 ≤ 上限时转码纯属白烧。
    // ⚠️ 曾经把"原生可解"当免转条件（2026-10-02 修）：4K120 的 H.264 既原生可解、
    // 又远高于上限 ⇒ 帧率上限在实际在用的 mp4 上一律失效、只剩一句面板文案。
    // 判据（三态都钉住）：帧率已知且高于上限 ⇒ 转；已知且不高于 ⇒ skip；**未知**才轮到
    // "原生可解就别盲转"这条成本护栏。
    check('② 抽帧决策看「上限能否真降帧」：高于上限才转、不高于则 skip、未知才用原生可解护栏',
      videoSrc.includes('function capNeedsTranscode(')
      && videoSrc.includes('const FPS_CAP_TOLERANCE = 1;')
      && videoSrc.includes('return src > cap + FPS_CAP_TOLERANCE;')
      && videoSrc.includes('if (need === false) {')
      && videoSrc.includes('if (need === null && isNativelyPlayableSource(mi, selection.url, selection.mediaExt)) {')
      && videoSrc.includes('selection.transcodeState = "skipped";')
      && videoSrc.includes('selection.transcodeState = "native";')
      // 「原生可解 ⇒ 直接不转」这条旧口径必须彻底消失（它就是上限失效的原因）。
      && !videoSrc.includes('if (isNativelyPlayableSource(mi, selection.url, selection.mediaExt)) {\n    if (video.dataset.weTranscoded) revertTranscodedVideo(video);\n    selection.transcodeReady = null;\n    selection.transcodeState = "native";'));
    check('② 正对照：判定只认原生容器/编码（mkv 之类的非原生容器不在白名单里）',
      videoSrc.includes('NATIVE_SRC_EXT') && videoSrc.includes('NATIVE_CODEC_RE')
      && /mp4\|m4v\|webm/.test(videoSrc)
      && !/NATIVE_SRC_EXT = \/[^/]*mkv/.test(videoSrc));
    check('② 负对照：把"原生可解"重新写成免转条件（旧口径）会被上一条判出',
      videoSrc.includes('function capNeedsTranscode(')
      && /if \(isNativelyPlayableSource\(mi, selection\.url, selection\.mediaExt\)\) \{\n    if \(video\.dataset\.weTranscoded\) revertTranscodedVideo\(video\);\n    selection\.transcodeReady = null;\n    selection\.transcodeState = "native";/.test('if (isNativelyPlayableSource(mi, selection.url, selection.mediaExt)) {\n    if (video.dataset.weTranscoded) revertTranscodedVideo(video);\n    selection.transcodeReady = null;\n    selection.transcodeState = "native";'));
    // 容器**必须**能拿到真实后缀：媒体 URL 是 `/media/<base64url>`，路径里没有扩展名 ——
    // 只靠 URL 判会**恒为假**（2026-10-02 实测回归：设了帧率上限时每次切换仍跑整片重编码）。
    // 两端各钉一条：宿主把 mediaExt 发出来、客户端把它接进 selection 再传进判据。
    check('② 真实容器由宿主给、客户端接（mediaExt 全链路在场）',
      readFileSync(join(root, 'lib', 'index.js'), 'utf8').includes('mediaExt: w.fileAbs ? extOf(w.fileAbs) : null,')
      && readFileSync(join(root, 'lib', 'index.js'), 'utf8').includes('function extOf(p)')
      && videoSrc.includes('const e = String(ext || "").toLowerCase();')
      && videoSrc.includes('NATIVE_EXT_SET')
      && readFileSync(join(root, 'src', 'media-prep.js'), 'utf8').includes('selection.mediaExt = w.mediaExt || null;'));
    // ── ⑤ 派发化：视频的转码触发归视频通道（syncLayers 不再直呼它）──────────────
    // 原来这 3 行是视频档在实时管线里**唯一的类型专属逻辑**，现在它只委托。
    check('⑤ 转码触发归视频通道（live-layer 只委托，不再直呼 maybeUpgradeToTranscoded）',
      videoSrc.includes('function videoChannelAfterLayerBuild(')
      && /videoChannelAfterLayerBuild\(video, selection\);/.test(liveSrc)
      && !/maybeUpgradeToTranscoded\(video, selection\.url/.test(liveSrc));
    // ── ⑥ 反向探针：视频档的放行**不经过实时管线的闸门机器** ──────────────────
    const liveSrcNow = readFileSync(new URL('../src/live-layer.js', import.meta.url), 'utf8');
    check('⑥ 视频档的放行机器归视频通道（实时管线只留一次委托）',
      videoSrc.includes('function armVideoChannelReveal(')
      && /armVideoChannelReveal\(video, recheck, giveUp\);/.test(liveSrcNow)
      && !/probeVideoPoster\(video, recheck, giveUp\)/.test(liveSrcNow)
      && !/VIDEO_POSTER_BUDGET_MS/.test(liveSrcNow));

  check('live-layer.js 已登记进 INLINE_MODULES 且在产物里只有一份',
    /file:\s*'src\/live-layer\.js'/.test(build)
    && (bundle.match(/function syncLayers\(\)/g) || []).length === 1);
  check('negative control: 未登记的模块名会被判出', !/file:\s*'src\/nope\.js'/.test(build));
  // ── 面板页签（C）：渲染器只在 panel-tabs.js，且**只从一个参数取外界** ──
  const TAB_FNS = ['renderWallpaperTab', 'renderAppearanceTab', 'renderAudioTab',
    'renderMascotTab', 'renderEffectsTab', 'renderAdvancedTab', 'renderAboutTab'];
  check('页签渲染器只在 src/panel-tabs.js（client.js 不留第二份）',
    TAB_FNS.every((n) => !new RegExp('function ' + n + '\\s*\\(').test(src))
    && TAB_FNS.every((n) => tabsSrc.includes('function ' + n + '(ctx) {')));
  // 每个渲染器的**首行**必须是 `const { … } = ctx;` —— "要什么"写在签名处，
  // 而不是靠闭包默默捕获（这正是这一刀的意义；也防止后来人图省事把捕获加回去）。
  const tabBodies = tabsSrc.split(/^  function (render\w+Tab)\(ctx\) \{$/m).slice(1);
  const noCtxLine = [];
  for (let i = 0; i < tabBodies.length; i += 2) {
    const fn = tabBodies[i], body = tabBodies[i + 1] || '';
    if (!/^\s*\n\s*const \{[^}]*\} = ctx;/.test(body)) noCtxLine.push(fn);
  }
  check('每个页签首行都从 ctx 解构（不许再靠闭包捕获）', noCtxLine.length === 0,
    noCtxLine.join(' ') || TAB_FNS.length + ' 个页签都显式取外界');
  check('panel-tabs.js 已登记进 INLINE_MODULES 且在产物里只有一份',
    /file:\s*'src\/panel-tabs\.js'/.test(build)
    && (bundle.match(/function renderEffectsTab\(ctx\)/g) || []).length === 1);
}

// host 的 sanitizeSettings 是白名单：漏加 sceneLiveFailures 会让 PUT 上来的
// 失败记忆被丢弃、刷新后记忆消失。
// ── Level E: 三条宿主路由必须各有行为断言 ───────────────────────────────────
// 这三条在 `docs/ROUTE-INDEX.md` 的"零提及"清单里不许出现 ⇒ 拆分 `apply(ctx)` 之前必须
// 补上真实行为断言，否则动它们等于没有安全网。三条都只断言**无副作用的失败路径**：
// 不写宿主持久化配置、不落盘、不依赖本机是否真有封面（否则 CI 会随环境飘）。
{
  const byPath = (p) => routes.find((r) => r.path === '/wallpaper-engine' + p);
  const clientDiag = byPath('/client-diag');
  const uploadDir = byPath('/upload-dir');
  const artwork = byPath('/now-playing/artwork');
  const mediaControl = byPath('/media-control');
  check('/client-diag 已注册（kind=exact）', Boolean(clientDiag) && clientDiag.kind === 'exact');
  check('/upload-dir 已注册（kind=exact）', Boolean(uploadDir) && uploadDir.kind === 'exact');
  check('/now-playing/artwork 已注册（kind=exact）', Boolean(artwork) && artwork.kind === 'exact');
  check('/media-control 已注册（kind=exact）', Boolean(mediaControl) && mediaControl.kind === 'exact');
  if (clientDiag) {
    const wrongMethod = await runHandler(clientDiag, '/wallpaper-engine/client-diag', {});
    check('/client-diag 非 POST ⇒ 405（早退，不落盘）', wrongMethod.__state.status === 405,
      'status=' + wrongMethod.__state.status);
    // 超限体 ⇒ 413：与客户端半的 64KB 上限对齐，同时钉住"不会把大体读进内存"。
    const big = Readable.from([Buffer.alloc(70 * 1024, 0x41)]);
    big.url = '/wallpaper-engine/client-diag';
    big.method = 'POST';
    big.headers = { 'content-type': 'application/json' };
    const resBig = fakeRes();
    clientDiag.handler(big, resBig);
    await waitRes(resBig);
    check('/client-diag 超 64KB ⇒ 413', resBig.__state.status === 413, 'status=' + resBig.__state.status);
  }
  if (uploadDir) {
    const wrongMethod = await runHandler(uploadDir, '/wallpaper-engine/upload-dir', {});
    check('/upload-dir 非 POST ⇒ 405（不改宿主持久化配置）', wrongMethod.__state.status === 405,
      'status=' + wrongMethod.__state.status);
  }
  if (artwork) {
    const r = await runHandler(artwork, '/wallpaper-engine/now-playing/artwork', {});
    const st = r.__state.status;
    check('/now-playing/artwork 无封面 ⇒ 404 no-artwork；有封面 ⇒ 2xx（绝不 5xx）',
      (st === 404 && r.__state.body.toString('utf8') === 'no-artwork') || (st >= 200 && st < 300),
      'status=' + st);
  }
}

const hostSrc = readFileSync(join(root, 'lib', 'index.js'), 'utf8');
/**
 * 宿主半的**全部注册面** = `lib/index.js` + `lib/routes/*.js`。
 * 路由族拆出 `apply(ctx)` 是 P2-11 的正常动作 ⇒ 凡断言"宿主仍实现某契约"的判据必须覆盖那个目录，
 * 否则"已搬走"会被误报成"契约丢了"。⚠️ 反过来，断言"某路由**已不在正文**"（如 /diag）的判据
 * 必须继续只用 `hostSrc` —— 拿扩面集合去检查"不在"，会把搬走的代码判成还在。
 */
const hostHalfSrc = [hostSrc, ...readdirSync(join(root, 'lib', 'routes')).filter((f) => f.endsWith('.js'))
  .map((f) => readFileSync(join(root, 'lib', 'routes', f), 'utf8'))].join('\n');
// 宿主设置白名单已改为**派生**（唯一真源 lib/settings-schema.js，P1-5）。因此这几条不再
// 抠实现里的字面量，而是把值喂给宿主的规范化函数看它收不收 —— 断言的是**行为**。
const schemaMod = await import(pathToFileURL(join(root, 'lib', 'settings-schema.js')).href);
const sanitizeHost = (raw0) => schemaMod.sanitizeFromSchema(raw0, 'host');
const hostKeeps = (k, v) => JSON.stringify(sanitizeHost({ [k]: v })[k]) === JSON.stringify(v);
check('host settings whitelist keeps sceneLiveFailures', hostKeeps('sceneLiveFailures', { w1: 'timeout' }));
check('host injects the vendored shim into web HTML', /data-we-shim="host"/.test(hostSrc) && /readWebShim\(\)/.test(hostSrc));
check('host sends CORS for opaque-origin fetches', /Access-Control-Allow-Origin', '\*'/.test(hostSrc));
check('inventory derives webLive via webFieldsFor', /webFieldsFor\(w, hasMedia, webMediaBase\)/.test(hostSrc));
// 黑屏的**成因**：Desktop 的能力头栅栏（**外部宿主** `@deepseek-ai/dsh-host-webserver`
// 的 decideDesktopBrowserAccess —— 本仓没有该文件）只放行同源 frame，不透明源的沙箱 iframe 永远拿不到
// x-dsh-desktop-renderer → 插件路由一律 403。网页壁纸载荷因此必须走 host 自建的
// 独立 loopback 源，两处挂载共用同一段处理函数。
check('host 自建壁纸媒体源（独立 loopback 监听）',
  /let mediaOrigin = null/.test(hostSrc) && /function ensureMediaOrigin\(\)/.test(hostSrc)
    && /server\.listen\(0, '127\.0\.0\.1'/.test(hostSrc) && /function mediaOriginBase\(\)/.test(hostSrc));
check('scene-files 处理函数被双挂载（应用源 + 媒体源）',
  /function handleSceneFiles\(req, res, mount\)/.test(hostHalfSrc)
    && hostHalfSrc.includes("handleSceneFiles(req, res, 'media')")
    && hostHalfSrc.includes("handleSceneFiles(req, res, 'app')")
    && hostHalfSrc.includes('function traceMediaRequests('));
check('媒体源只服务 /scene-files 前缀', hostSrc.includes("pathname.startsWith(`${BASE}/scene-files/`)"));
// ── 场景载荷改走自建源：三处必须同时成立（少一处就退化成"静默回落"，或更糟：告警丢失）──
// 背景：`scene.pkg` 实测到 336MB，走应用源那条路挤不过首帧预算（那里还要买纹理解码与
// shader 编译），故场景载荷改走自建 loopback 源。三条判据把这次改动的**每个接缝**都钉住：
//   ① 宿主端出这个源，且门控按"库里真有可实时渲染的场景"（不是无条件起监听）；
//   ② 客户端消费宿主给的值，**不再自己拼 location.origin**（否则改动无声失效）；
//   ③ 媒体源接住 `/diag`，且用的是诊断族**同一个** handleDiag（否则渲染页告警 404 静默丢失）。
//
// ⚠️ 2026-09 修正：① 的**形态门控**被拿掉了 —— `mediaOriginBase()` 在原生浏览器形态下
// 恒返空串（它门控的是"网页壁纸的能力头栅栏"），而场景载荷要独立源的理由是**带宽**，
// 与宿主形态无关。旧断言（`await mediaOriginBase()`）因此钉住的是一个**已知会饿死**的写法，
// 现在改成钉 `ensureSceneMediaOrigin()`，并加负对照：退回旧写法必须被判红。
check('宿主端出场景载荷的源，且按 sceneLive 门控（没有场景不多起监听）',
  /const sceneMediaBase = wallpapers\.some\(\(w\) => w\.sceneLive\) \? await ensureSceneMediaOrigin\(\) : ''/.test(hostSrc)
    && /^\s*sceneMediaBase,$/m.test(hostSrc));
{
  // 同一判据喂"改回旧写法"的源码：必须变假（旧写法在浏览器形态下恒空串 ⇒ 大包回落应用源）。
  const scenePinned = (s) => /const sceneMediaBase = wallpapers\.some\(\(w\) => w\.sceneLive\) \? await ensureSceneMediaOrigin\(\) : ''/.test(s)
    && !/sceneMediaBase = wallpapers\.some\(\(w\) => w\.sceneLive\) \? await mediaOriginBase\(\) : ''/.test(s);
  const mutated = hostSrc.replace('? await ensureSceneMediaOrigin()', '? await mediaOriginBase()');
  check('负对照：把调用点改回 mediaOriginBase() ⇒ 同一条判据变假',
    mutated !== hostSrc && scenePinned(mutated) === false && scenePinned(hostSrc) === true,
    'mutated=' + (mutated !== hostSrc));
}
{
  // `ensureSceneMediaOrigin` 里不得出现 mediaOriginNeeded / adapterOverride：
  // 那就是把形态门控偷偷加回来（判据只取该函数体，取不到就显式报缺）。
  const fn = (hostSrc.match(/function ensureSceneMediaOrigin\(\) \{[\s\S]{0,240}?\n  \}/) || [''])[0];
  check('ensureSceneMediaOrigin 只做懒启动（不读 mediaOriginNeeded / adapterOverride）',
    fn.includes('ensureMediaOrigin()') && !fn.includes('mediaOriginNeeded') && !fn.includes('adapterOverride'),
    fn ? 'body=' + fn.replace(/\s+/g, ' ').slice(0, 80) : 'function 未找到');
}
// 判据必须钉在**赋值表达式**上，而不是"文件里出现过 sceneMediaBase"：后者在"读进变量却
// 不用它"的写法下照样为真（实测：把 mediaBase 改成无条件 location.origin 时它不变红 ⇒
// 那是恒真式判据，属于 P3-16 点名的形态）。所以抠出 mediaBase 的赋值再断言它消费宿主值
// —— 场景路径消费 resolveSceneMediaBase()（issue #129：那里同时决定远程页面回落自身
// origin；宿主源是 127.0.0.1 loopback，远程客户端打它等于打自己）。
const mbAssign = (liveSrc.match(/const mediaBase = [\s\S]{0,220}?;/) || [''])[0];
check('客户端场景 mediaBase 的**赋值表达式**消费宿主给的源（经 resolveSceneMediaBase）',
  /isWeb \? /.test(mbAssign) && /resolveSceneMediaBase\(\)/.test(mbAssign)
    && !/const mediaBase = location\.origin/.test(mbAssign),
  mbAssign.replace(/\s+/g, ' ').slice(0, 90));
check('该源来自宿主载荷 inventory.sceneMediaBase',
  /const hostSceneBase = selection\.inventory && selection\.inventory\.sceneMediaBase/.test(liveSrc));
check('远程 http(s) 页面回落自身 origin；本机/自定义 scheme 维持宿主媒体源（issue #129）',
  /function originIsRemoteHttp\(origin\)/.test(liveSrc)
    && /u\.protocol !== "http:" && u\.protocol !== "https:"/.test(liveSrc)
    && /!\(h === "127\.0\.0\.1" \|\| h === "localhost"/.test(liveSrc)
    && /!originIsRemoteHttp\(typeof location !== "undefined" \? location\.origin : ""\)/.test(liveSrc));
check('negative control: 老的硬编码写法会被上一条判出',
  !liveSrc.includes('location.origin + "/wallpaper-engine/scene-files"'));
check('媒体源的 /diag 走诊断族同一个 handleDiag（同一份缓冲，且先于 scene-files 分派）',
  (() => {
    const diagAt = hostSrc.indexOf("pathname === '/diag'");
    const callAt = hostSrc.indexOf('mediaDiagHandler(req, res)');
    const sceneAt = hostSrc.indexOf('pathname.startsWith(`${BASE}/scene-files/`)');
    return diagAt > 0 && callAt > diagAt && sceneAt > diagAt
      && hostSrc.includes('onHandleDiag: (fn) => { mediaDiagHandler = fn; }')
      && /if \(onHandleDiag\) onHandleDiag\(handleDiag\)/.test(hostHalfSrc)
      && /let mediaDiagHandler = null/.test(hostSrc);
  })());
check('negative control: 调用点保持语句形态（加赋值前缀会被路由索引判成孤儿族模块）',
  /^\s*registerDiagRoutes\(webServer, \{$/m.test(hostSrc)
    && !/^\s*\w+\s*=\s*registerDiagRoutes\(/m.test(hostSrc));

// 封面（Now Playing artwork）：实测用户反馈「不显示歌曲封面」的根因是只问 Spotify。
// 现在通用路径是 media-control 自带的 artworkData（系统 MediaRemote，任何播放器都有），
// 且缓存后缀按 MIME 决定（PNG 存成 .jpg 会按错误类型解码）。
// 这套现为**回落实现**（lib/media/legacy.js），首选是 media-bridge 子进程（lib/media/*）
// —— 断言因此两边都盯：回落能力不能退化，新链路的接缝要在。
const legacyBridgeSrc = readFileSync(join(root, 'lib', 'media', 'legacy.js'), 'utf8');
check('回落实现住在 lib/media/legacy.js（回落路径还在）',
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
// 状态缓存兜底：中间件的 status 事件只在元数据源报错时发时，音频源
// idle→preparing→running 的变化不通知 —— 消费端只在启动时读一次 status，会永远停在
// preparing（频谱有数据、客户端却拿不到）。所以插件这层自己也兜底刷新，两层互不依赖。
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
check('门面：中间件优先，失败回落 legacy 并留下原因',
  facadeSrc.includes('fallBackTo(') && facadeSrc.includes("backend: live ? 'bridge'"));
check('门面支持 DSH_WE_MEDIA_LEGACY=1 强制走 legacy 回落', facadeSrc.includes('DSH_WE_MEDIA_LEGACY'));
check('门面把「音频已关」传给回落实现（不让回落偷偷开采集）',
  facadeSrc.includes('createLegacy({ dataDir, log, audio: optsRef.audio })'));
// 媒体状态族已搬到 lib/routes/now-playing.js（P2-11）。判据按 diag 族的同一形态翻成三条：
// ① URL 形状由**真实注册表**（mock webServer 跑一遍 apply 的结果）断言 —— 与代码住在哪个文件无关；
// ② 该路由的实现契约在**它现在所在的文件**里断言；③ 正文侧钉住"已搬走"（零路径字面量 + 一次调用）。
const nowPlayingSrc = readFileSync(join(root, 'lib', 'routes', 'now-playing.js'), 'utf8');
const nowPlayingPaths = ['/media-status', '/audio-spectrum', '/now-playing', '/now-playing/artwork', '/media-control'];
const missingNowPlaying = nowPlayingPaths.filter((p) => !routes.some((r) => r.path === '/wallpaper-engine' + p));
check('host 路由形状不变（客户端/渲染页无需感知后端切换）',
  missingNowPlaying.length === 0, missingNowPlaying.join(', ') || '五条都在');
check('negative control: 同一条判据能点出没注册的路径',
  ['/media-status', '/not-registered'].filter((p) => !routes.some((r) => r.path === '/wallpaper-engine' + p)).join() === '/not-registered');
check('spectrum 路由回报 running（客户端据此决定装不装音频桥）',
  nowPlayingSrc.includes('running: st.audio.status ===') && nowPlayingSrc.includes('mediaBackend.status()'));
check('媒体状态族已搬出 lib/index.js（正文零路径字面量 + 一次调用）',
  !/path: `\$\{BASE\}\/(media-status|audio-spectrum|now-playing)/.test(hostSrc)
    && /registerNowPlayingRoutes\(webServer, \{/.test(hostSrc));
check('settings 白名单保留 mediaLyricsOnline（否则开关会被丢）', hostKeeps('mediaLyricsOnline', true));

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
check('音频桥按宿主 running 装卸（装了桥 = 渲染页放弃自带音频源）',  src.includes('function syncAudioBridge(frame, running)') && src.includes('syncAudioBridge(frame, d.running === true)'));
// 媒体控制面（控制反转）：场景壁纸里 Now Playing 组件的按钮由渲染页推断成动作，
// 打到宿主注入的控制面 → POST /media-control → 中间件真控播放器。判据按**源码形态**
// 写成谓词（于是负对照能喂合成输入），三条缺一不可：控制面装载（五个动作齐）、
// 与显示面分离（按 window 记忆 + 卸载时才清）、动作名与宿主路由契约一致。
{
  const CONTROL_ACTIONS = ['play', 'pause', 'playPause', 'skipNext', 'skipPrevious'];
  const controlWiring = (text) =>
    text.includes('function syncMediaControl(frame)')
    && text.includes('wp.setMediaControl(controls)')
    && text.includes('mediaControlWin === win')
    && text.includes('wp.setMediaControl(null)')
    && CONTROL_ACTIONS.every((a) => text.includes('"' + a + '"'))
    && text.includes('apiPostJson("/media-control", { action })');
  check('client 装媒体控制面（五个动作 → 宿主 /media-control；装一次按 window 记忆、卸载时清）',
    controlWiring(src), '控制反转的宿主半：壁纸按钮 → 真实播放器');
  check('negative control: 卸载不清 / 不按 window 记忆 / 缺动作的三种坏形态都被判出',
    !controlWiring('function syncMediaControl(frame) { wp.setMediaControl(controls); }')
      && !controlWiring(src.replace('mediaControlWin === win', 'false'))
      && !controlWiring(src.replace('apiPostJson("/media-control", { action })', 'apiJson("/now-playing")')));
}
check('host 侧 /media-control 只收 POST + 动作走 mediaBackend.control（不在路由里触发懒启动）',
  nowPlayingSrc.includes('path: `${BASE}/media-control`')
    && nowPlayingSrc.includes('mediaBackend.control(action)')
    && !/media-control[\s\S]{0,700}ensureMedia\(\)/.test(nowPlayingSrc));
// 「在线歌词 / 系统音频反应 / 媒体信息」三键已**退役为常开**（用户口径：默认接入，
// 设置页与侧边栏都不再提供页面定义）。三件事一起钉：① schema 侧 kind 'const'（读取
// 时老配置里的关闭值被默认值取代）+ 默认 on；② UI 侧两个来源（设置页签渲染器 /
// 快捷播放面板）按**代码**（剥注释）都不得再出现这三个开关。
{
  const RETIRED_LABELS = ['系统音频反应', '媒体信息', '在线歌词'];
  const leftoversIn = (text) => RETIRED_LABELS.filter((label) => text.includes(label));
  const tabsCode = stripComments(tabsSrc);
  const qpCode = stripComments(readFileSync(join(root, 'src', 'quick-panel.js'), 'utf8'));
  check('三键退役为常开（schema kind const + 默认接入）',
    schemaMod.DEFAULTS.audioSource === 'auto' && schemaMod.KINDS.audioSource.kind === 'const'
      && schemaMod.DEFAULTS.mediaIntegration === true && schemaMod.KINDS.mediaIntegration.kind === 'const'
      && schemaMod.DEFAULTS.mediaLyricsOnline === true && schemaMod.KINDS.mediaLyricsOnline.kind === 'const',
    'kinds=' + schemaMod.KINDS.audioSource.kind + '/' + schemaMod.KINDS.mediaIntegration.kind
      + '/' + schemaMod.KINDS.mediaLyricsOnline.kind
      + ' · defaults=' + schemaMod.DEFAULTS.audioSource + '/' + schemaMod.DEFAULTS.mediaIntegration
      + '/' + schemaMod.DEFAULTS.mediaLyricsOnline);
  check('三个开关的页面定义已从设置页与快捷面板移除（按代码判，注释里提到不算）',
    leftoversIn(tabsCode).length === 0 && leftoversIn(qpCode).length === 0,
    '残留：' + ([...leftoversIn(tabsCode), ...leftoversIn(qpCode)].join(', ') || '无'));
  // 负对照：同一条判据喂合成文本 —— 真出现开关文案必须被判出（判据不是恒真）。
  check('negative control: 合成代码里的开关文案会被同一条判据点出',
    leftoversIn('switchRow("在线歌词", v)').join(',') === '在线歌词'
      && leftoversIn('switchRow("媒体信息", v) && switchRow("系统音频反应", v)').length === 2);

// 用户口径：侧栏壁纸列表支持类型筛选（全部 / 场景 / 网页 / 视频 / 图片）—— 面板本地、
// **瞬态**（setTransient 不经设置落盘；设置页的「类型」过滤另有一条，筛设置页列表与
// 轮播候选，两者互不影响、都只筛「列表」）。「图片」是后补的一档（上传的单文件图片
// 壁纸）：判据按**同一份档位表**逐档核对，再加一条负对照 —— 少一档必须被判红
//（此前"四档齐全"写的是"这四档都在"，补一档不会红，也就没有覆盖）。
  const QP_TYPE_ROWS = [['all', '全部'], ['scene', '场景'], ['web', '网页'], ['video', '视频'], ['image', '图片']];
  const sideTypeFilterOk = (text) => text.includes('function qpTypes()')
    && QP_TYPE_ROWS.every(([id, label]) => text.includes('id: "' + id + '"')
      && (text.includes('label: weT("' + label + '")') || text.includes('label: weT("' + label + '", null,')))
    && text.includes('w.type !== typeFilter');
  check('侧栏列表类型筛选：五档齐全（含「图片」）+ 面板本地应用 + 不走设置落盘',
  // i18n（中文原文即键）之后：容器从文件顶层常量改成 `qpTypes()`（每次渲染现建，
  // 否则文案会冻在加载期），每档 label 各自走 `weT("…")` —— 判据只认"档位 id 仍绑着
  // 同一句原文"，不认包装形态（认形态的判据会在下一次改写法时静默失效）。
    sideTypeFilterOk(qpSrc)
    && qpSrc.includes('setTransient("qpType", e.target.value)')
    && !qpSrc.includes('setSetting("qpType"')
    && src.includes('qpType: "all"'));
  // 负对照：同一条判据喂"少一档"的合成文本，必须被判红（判据不是恒真）。
  check('negative control: 少一档（缺「图片」）会被同一条判据点出',
    !sideTypeFilterOk(qpSrc.replace('{ id: "image", label: weT("图片") },', ''))
      && sideTypeFilterOk(qpSrc));
  // ↑ 本段与"三键退役"共用同一个 `{ … }` 块（原先那条 check 的收尾 `}` 就在这里）——
  //   不要再包一层 `{}`：块会多开一层，整个文件在 EOF 报 "Unexpected end of input"。
}
// 用户口径：设置页切「类型」不得把**正在应用**的壁纸干掉 ⇒ 类型档只筛列表与轮播
// 候选、不入播放闸门（keepPlayingWallpaper：分级拦播放，类型档没有入参）；轮播在场
// 时「仅被类型档排除」也不换台（typeOnlyExcluded）。分级闸门照旧干掉并解释 —— 那
// 一半钉在 verify-playback-controls E 段，这里钉类型档这一半。
{
  const gateKeepsPlaying = (clientText, prepText) =>
    clientText.includes('const keepCurrent = keepPlayingWallpaper(cur, selection.contentRatingFilter)')
      && clientText.includes('const typeOnlyExcluded = keepCurrent')
      && prepText.includes('if (!w || !keepPlayingWallpaper(w, selection.contentRatingFilter))');
  check('类型档不入播放闸门：revalidate 丢弃走 keepPlayingWallpaper + 换台豁免 typeOnlyExcluded',
    gateKeepsPlaying(src, prepSrc));
  // 负对照：把闸面换回「读类型档」的旧形态（变异输入），同一条判据必须判否。
  check('negative control: 闸门改回读类型档的形态会被同一条判据点出',
    !gateKeepsPlaying(src, 'if (!w || !isRotatableWallpaper(w, selection.contentRatingFilter, selection.typeFilter))'));
}
// 场景/网页实时渲染**默认开** —— 这是用户可见的默认值，三处一起钉：DEFAULTS 的值、
// KINDS 的类型（boolTrue = 缺键读作开）、以及面板/活层的判据形态（`!== false`，
// truthy 判断会在缺键时静默变成"关"）。缺键必须两侧都读作开。
{
  const countOf = (s, needle) => s.split(needle).length - 1;
  check('「场景实时渲染」默认开（DEFAULTS + KINDS boolTrue + 缺键两侧读作开）',
    schemaMod.DEFAULTS.sceneLive === true && schemaMod.KINDS.sceneLive.kind === 'boolTrue'
      && schemaMod.sanitizeFromSchema({}, 'client').sceneLive === true
      && sanitizeHost({}).sceneLive === true,
    'DEFAULTS.sceneLive=' + String(schemaMod.DEFAULTS.sceneLive));
  check('面板/活层判据是 `!== false` 形态（面板 ≥4 处 + live 层 ≥1 处）',
    countOf(tabsSrc, 'sel.sceneLive !== false') >= 4
      && countOf(liveSrc, 'selLike.sceneLive !== false') >= 1,
    'panel=' + countOf(tabsSrc, 'sel.sceneLive !== false') + ' live=' + countOf(liveSrc, 'selLike.sceneLive !== false'));
  // 负对照：默认翻成关，同一条判据必须变假 —— 证明上面两条不是恒真。
  const savedSceneLiveDefault = schemaMod.DEFAULTS.sceneLive;
  schemaMod.DEFAULTS.sceneLive = false;
  const flipped = schemaMod.DEFAULTS.sceneLive === true
    && schemaMod.sanitizeFromSchema({}, 'client').sceneLive === true;
  schemaMod.DEFAULTS.sceneLive = savedSceneLiveDefault;
  check('负对照：默认改成关 ⇒ 同一条判据变假', flipped === false && schemaMod.DEFAULTS.sceneLive === true);
}
check('host builds the property seed from project.json + 覆盖值',
  /function buildSeedScript\(entryAbs, token\)/.test(hostSrc) && /parseUserPropDefs\(pj, overrides/.test(hostSrc)
    && /userPropsFor\(token\)/.test(hostSrc));
check('host 侧属性解析模块（order 浮点 / combo 保类型 / 逐键本地化 / condition）',
  existsSync(join(root, 'lib', 'we-props.js'))
    && /parseUserPropDefs/.test(readFileSync(join(root, 'lib', 'we-props.js'), 'utf8')));
check('settings 白名单保留 userProps（按 token 存标量）',
  JSON.stringify(sanitizeHost({ userProps: { tok: { c: 'x', n: 1, obj: { bad: 1 } } } }).userProps)
    === '{"tok":{"c":"x","n":1}}');
// i18n 之后按钮文案走 `weT("…")`（中文原文即键）—— 判据改认带包装的形态，
// 顺序判据仍锚在"属性入口在播放/暂停按钮之前"这个**位置关系**上。
check('「壁纸属性」按钮：仅场景/网页壁纸 + 常规按钮样式（并入播放控制行、排在「暂停」之前）',
  tabsSrc.includes('(current.type === "scene" || current.type === "web") && sel.propsUrl')
    && !tabsSrc.includes('we-picker__btn--props')
    && tabsSrc.indexOf('weT("壁纸属性")') !== -1
    && tabsSrc.indexOf('weT("壁纸属性")') < tabsSrc.indexOf('weT("暂停")'));
check('属性面板热更新走 __wp.updateWebProps',
  src.includes('function applyUserProps(') && src.includes('wp.updateWebProps(wire)'));
check('属性面板值以渲染页实时表为准（getProperties）',
  src.includes('wp.getProperties()') && src.includes('function loadUserPropDefs('));
// 求值器自 P1-7 起是**独立模块** src/we-cond.js（构建期内联回客户端作用域）。
// 断言改为三件事：模块在位、产物里确实有它、client.js 不再自带实现 —— 免得抽出去之后
// 两边各留一份（那正是要防的漂移）。
const weCondSrc = readFileSync(join(root, 'src', 'we-cond.js'), 'utf8');
const bundleSrc = readFileSync(join(root, 'lib', 'client.js'), 'utf8');
check('条件求值器已抽成独立模块并被内联（fail open）',
  /\(function weEvalCondition|function weEvalCondition\(/.test(weCondSrc)
    && weCondSrc.includes('function weCondParse(')
    && bundleSrc.includes('function weEvalCondition(')
    && !src.includes('function weEvalCondition('));
check('场景就绪后回放覆盖值（无 HTML 种子通道）',
  // 声明留在 client.js（用户属性域），调用点在实时管线的挂载路径里（live-layer.js）。
  src.includes('function applyStoredUserProps(') && liveSrc.includes('applyStoredUserProps(selection)'));
// 用户口径：库视图只保留**顶部**返回按钮（底部那个是重复的）。
// 计数口径：UI 重构后选择壁纸是**页内下钻视图**（不再有遮罩/弹框）⇒ closePicker
// 只剩顶部「返回」按钮这 1 处绑定。
// P3-11 阶段 2：库视图标记已搬到 src/picker-modal.js ⇒ 这三条文本断言跟着**所属文件**走
// （同下面诊断族那批"按所属文件分家"的口径）。计数口径仍覆盖**整个客户端半**
// （client.js + picker-modal.js），所以在别处再加一个返回/关闭绑定照样会被判出。
const modalSrc = readFileSync(join(root, 'src', 'picker-modal.js'), 'utf8');
const clientHalf = src + '\n' + modalSrc;
// 官方侧栏接入（src/sidebar-right.js）：能力门 / 两段注册 / 模式真源的断言读它。
const sidebarSrc = readFileSync(join(root, 'src', 'sidebar-right.js'), 'utf8');
check('库视图只留顶部返回按钮（页内下钻，无遮罩绑定）',
  (clientHalf.match(/onClick: closePicker/g) || []).length === 1
    && modalSrc.includes('we-picker__modal-foot" },'),
  // ⚠️ 此前这里是 `&& modalSrc.includes('ESC 返回')` —— 断言**提示文案**，改一句话或换语言
  //    就判红（ADR-0007），已撤除。ESC 本身**不改动**：它由 verify-client.mjs 的
  //    「0b：ESC 关闭 picker」做**行为断言**（真派发 Escape + 非 Escape 负对照），
  //    比在这里读一句静态文案强得多 —— 别再加静态复制品。
  'closePicker 绑定数=' + ((clientHalf.match(/onClick: closePicker/g) || []).length));
// ── 抽屉形态：右侧左滑、装快捷播放面板 ──
// 钉三件事：滑动方向与宽度（`translateX`，不得出现 `translateY`）、内容与官方侧栏同源
// （QuickPanel，不另建 WallpaperPicker 副本）、弹框所有权只走一套机制
// （`repoPanelOwnsModal` 必须不存在）。
check('抽屉右侧左滑（360px、translateX；不再是顶部下落的 25vw/translateY）',
  stylesSrc.includes('width: 360px; max-width: 92vw;')
    && /we-repo-panel\s*\{[^}]*transform: translateX\(102%\)/.test(stylesSrc)
    && !/we-repo-panel\s*\{[^}]*translateY/.test(stylesSrc));
// 断言的是**机制**（同一个组件、壳只差 dock），不冻结 props 的字面形状 —— 面板渲染器
// 后来以 prop 形式加进来，写死 `{ dock: "drawer" }` 会让这条正确的改动判红（ADR-0007）。
check('抽屉与官方侧栏共用同一份 QuickPanel（不再是 WallpaperPicker 副本）',
  /React\.createElement\(QuickPanel, \{ dock: "drawer"/.test(src)
    && !src.includes('repoPanel: true')
    && !src.includes('repoPanelOwnsModal'));
check('官方侧栏接入用能力门 + 可选服务（不写进 inject，低版本宿主不会 park）',
  src.includes('installSidebarRight(ctx)')
    && sidebarSrc.includes('ctx.slots.inject("sidebar.right.pane.tab"')
    && sidebarSrc.includes('ctx.get("sidebarRightTabs")')
    && sidebarSrc.includes('ctx.get("sidebarRight")'));
// ── 侧栏三档页签（壁纸 / 外观 / 播放）──────────────────────────────────────
// 用户口径：设置页的「外观」「播放」两页也要能在侧栏快捷调（调参数时实时看壁纸效果）。
// 三件事各一条判据：① 页签栏的位置（在「轮播」之下 —— 当前壁纸与轮播三档都显示）；
// ② 两页与设置页**共用同一批渲染器**（surface 档少画设置页专属分组），不许在侧栏
// 自写一份控件；③ 页签记忆是 UI 状态（localStorage，不进 config.json）。
{
  const QP_TAB_ROWS = [['wallpaper', '壁纸'], ['appearance', '外观'], ['playback', '播放']];
  // 页签栏夹在「轮播」与「底栏」之间（三个锚点都是只在对应节出现的类名）。
  const tabBarBetween = (text) => {
    const t = text.indexOf('we-tabs we-qp__tabs');
    return t >= 0 && text.indexOf('we-qp__group') < t && t < text.indexOf('we-qp__foot');
  };
  const qpTabsOk = (text) => text.includes('const QP_TABS = [') && tabBarBetween(text)
    && QP_TAB_ROWS.every(([id, label]) => text.includes('id: "' + id + '"')
      && text.includes('label() { return weT("' + label + '")'));
  check('侧栏三档页签齐全（壁纸 / 外观 / 播放）且页签栏在「轮播」之下、底栏之上', qpTabsOk(qpSrc));
  check('negative control: 页签栏挪到「轮播」之上会被同一条判据判出',
    !tabBarBetween('we-tabs we-qp__tabs … we-qp__group … we-qp__foot')
      && tabBarBetween('we-qp__group … we-tabs we-qp__tabs … we-qp__foot'));
  check('侧栏页签记忆只进 localStorage（同 qp-view / picker-tab 口径，不进 config.json）',
    qpSrc.includes('localStorage.getItem(QP_TAB_KEY)')
      && qpSrc.includes('localStorage.setItem(QP_TAB_KEY, id)')
      && !qpSrc.includes('setSetting("qpTab"') && !qpSrc.includes('"qpTab"'));
  // 两页 = 设置页同名页签的同一批渲染器；侧栏不再自写控件（此前那份手写的「声音」组
  // 已并回渲染器 —— 它的提示语当时已经和设置页不一致了）。
  const sharedRenderers = (text) => text.includes('renderAppearanceTab(sidebarRenderCtx(')
    && text.includes('renderEffectsTab(sidebarRenderCtx(')
    && (text.match(/renderAudioTab\(sidebarRenderCtx\(/g) || []).length === 2
    && !/switchRow\(weT\("壁纸音轨"/.test(text)
    && !/SliderRow\(weT\("音量"/.test(text);
  check('侧栏「外观」「播放」两页与设置页共用同一批渲染器（壁纸页那份声音组也已并回）',
    sharedRenderers(qpSrc));
  check('negative control: 在侧栏自写一份音量行会被同一条判据判出',
    !sharedRenderers(qpSrc + '\nswitchRow(weT("壁纸音轨"), true, () => {});\n'));
  // 渲染器的 surface 档：侧栏档只**加门**（少画设置页专属分组），不许改行 ——
  // 缺省（设置页）那一趟一个节点都不少（行为级 golden 在 verify-client.mjs）。
  const gated = (text, label) => new RegExp('!sidebarSurface &&[\\s\\S]{0,240}?weT\\("' + label + '"\\)').test(text);
  // ⚠️ §10.25 起只剩**两节**：「窗口与侧栏」已撤销（内容并进「玻璃 UI」，而那节本身两档都画
  //    ⇒ 不再属于"只在设置页档渲染"的集合）。
  check('外观页两节（字体 / 光标）只在设置页档渲染',
    ['全局字体', '输入光标'].every((label) => gated(tabsSrc, label)));
  check('播放页的准备与诊断行（出图来源 / 实时帧 / 自定义画面 / 帧率上限 / 源信息 / 转码进度）只在设置页档渲染',
    ['出图来源', '实时帧', '自定义画面', '帧率上限'].every((label) => gated(tabsSrc, label))
      && tabsSrc.includes('!sidebarSurface && sel.type === "video" && sel.mediaInfo')
      && tabsSrc.includes('!sidebarSurface && sel.type === "video" && sel.transcodeState === "working"'));
  check('negative control: 去掉一扇门（外观少画一节）会被同一条判据判出',
    !gated('React.createElement("div", { className: "we-picker__section" },\n'
      + '  React.createElement("span", { className: "we-picker__section-label" }, weT("全局字体")),', '全局字体')
      && gated(tabsSrc, '全局字体'));
  check('侧栏档空态 CTA 切回壁纸页（不是设置页的库下钻）',
    tabsSrc.includes('sidebarSurface ? onPickWallpaper : onOpenPicker')
      && tabsSrc.includes('sidebarSurface ? weT("去挑一张 ›") : weT("选择壁纸")')
      && qpSrc.includes('onPickWallpaper: () => switchQpTab("wallpaper")'));
  // ── 侧栏壁纸档的「壁纸属性」（用户口径：属性要在侧栏里调，不要跳设置页）──────
  // 交互口径 = **页内下钻**：点入口把壁纸页内容区整区换成属性面板（列表让位），
  // 顶部「返回」/ 再点一次入口退出 —— 与设置页库视图那套下钻同一形态（那里是
  // pickerOpen 顶掉 renderActiveTab）。面板本体与设置页**共用同一个开关与同一个
  // 渲染器**（`propsPanelOpen` / `renderUserPropsPanel`），不许在侧栏另存一份。
  {
    // ① 入口在**页签栏下方**、独占整行、无背景（用户口径）。
    {
      // 锚点顺序：页签栏 → 入口 → **内容区**。⚠️ 内容区锚点不能用 `const tabBodyClass`
      //（那句在组件顶部声明，索引反而比页签栏更靠前），要用它被当作 render 参数的落点。
      const btnBelowTabs = (text) => {
        const tabs = text.indexOf('we-tabs we-qp__tabs');
        const btn = text.indexOf('we-qp__propsbtn');
        const area = text.indexOf('className: tabBodyClass');
        return tabs !== -1 && btn !== -1 && area !== -1 && tabs < btn && btn < area;
      };
      check('「壁纸属性」入口在页签栏下方、内容区之前（三档同一位置）', btnBelowTabs(qpCode));
      check('negative control: 把入口挪到页签栏之上会被同一条判据判出',
        !btnBelowTabs('we-qp__propsbtn … we-tabs we-qp__tabs … const tabBodyClass'));
      /** `.we-qp__propsbtn` 的**任意**规则（含 is-on / @supports 各态）里声明过透明边框吗。
       *  按"声明过没有"判，而不是"最后一条是什么"：级联里最后一条会被 is-on 那条盖住，
       *  于是"注入透明边框"这种变异反而判不出来（负对照会假红，实测踩过）。 */
      const declaresTransparentBorder = (styles) =>
        /\.we-qp__propsbtn(?:[^{}]*)\{[^}]*border-color:\s*transparent/.test(styles);
      // 用户口径（最终版）：整行、**保留边框**、文字居中、字号与页签标签一致（12px）。
      // 判据只写一次（命名谓词），正判据与负对照调同一个 —— 负对照喂变异输入。
      const entryStyled = (styles, code) => code.includes('we-picker__btn we-qp__propsbtn')
        && /\.we-qp__propsbtn \{[^}]*width: 100%/.test(styles)
        && /\.we-qp__propsbtn \{[^}]*justify-content: center/.test(styles)
        && /\.we-qp__propsbtn \{[^}]*font-size: 12px/.test(styles)
        && /\.we-tabs__tab \{[^}]*font-size: 12px/.test(styles)
        // 边框：所有 .we-qp__propsbtn 规则里**最后**声明的 border-color 不能是透明
        //（要按级联判最后一处——`@supports` 那条就是靠"更晚"生效的）。
        && !declaresTransparentBorder(styles);
      check('入口样式：整行 + 有边框 + 居中 + 字号与页签标签一致',
        entryStyled(stylesSrc, qpCode));
      // 上下内边距 + 解掉基类的固定高：固定高 + 零纵向内边距会让文字贴边、整枚看着被压扁。
      {
        const rule = /\.we-qp__propsbtn \{[^}]*\}/.exec(stylesSrc)[0];
        check('入口有上下内边距、且高度不再被钉死（`padding: 7px 12px` + `height: auto`）',
          /padding: 7px 12px/.test(rule) && /height: auto/.test(rule) && /line-height: 1\.2/.test(rule));
        check('negative control: 退回「固定高 + 零纵向内边距」会被同一条判据判出',
          !(/padding: 7px 12px/.test(rule.replace('padding: 7px 12px', 'padding: 0 12px'))
            && /height: auto/.test(rule.replace('height: auto', 'height: 30px'))));
      }
      // 负对照：改**这一条规则自己的块**（`justify-content: center;` 在别处也出现，全局替换
      // 会改到别的规则 ⇒ 变异没落在被判的对象上，负对照会假红）。
      // 边框那条变异必须落在**真正生效**的那处 —— `@supports` 里那句（更晚、且带颜色），
      // 往第一条规则里塞 `border-color: transparent` 是打不过它的（负对照会假红，实测）。
      const btnBlock = /\.we-qp__propsbtn \{[^}]*\}/.exec(stylesSrc)[0];
      const mixRule = /border-color: color-mix\(in srgb, var\(--we-ink[^;]*;/.exec(stylesSrc)[0];
      check('negative control: 去掉居中 / 让生效的边框颜色透明，都会被同一条判据判出',
        !entryStyled(stylesSrc.replace(btnBlock, btnBlock.replace('justify-content: center;', 'justify-content: flex-start;')), qpCode)
          && !entryStyled(stylesSrc.replace(mixRule, mixRule.replace('color-mix(in srgb, var(--we-ink, currentColor) 40%, transparent)', 'transparent')), qpCode));
      // 边框颜色必须取自**该主题下的文字色**（`--we-ink`）：深色主题浅字、浅色主题深字，
      // 于是两套主题都看得见（现场反馈过"无边框线"—— 宿主那条中性描边在这套玻璃上近乎不可见）。
      // 命名谓词：正判据与负对照调同一个（负对照喂变异输入，不是另抄一份）。
      const entryBorder = (styles) => {
        const rule = /\.we-qp__propsbtn \{[^}]*\}/.exec(styles);
        return !!rule && /border: 1px solid/.test(rule[0])
          && /var\(--we-ink, currentColor\) 40%, transparent/.test(styles);
      };
      check('入口边框显式声明，颜色取该主题的文字色（--we-ink）+ 40% 透明（color-mix 兜底）',
        entryBorder(stylesSrc));
      check('negative control: 退回"只靠宿主中性描边"（自身不写 border）会被同一条判据判出',
        (() => {
          const rule = /\.we-qp__propsbtn \{[^}]*\}/.exec(stylesSrc)[0];
          return !entryBorder(stylesSrc.replace(rule, rule.replace(/\s*border: 1px solid[^;]*;/, '')))
            && entryBorder(stylesSrc);
        })());
    }
    // ⚠️ 血泪判据：**面板渲染器必须是模块级声明**，不能是 `apply()` 里的闭包。
    //    `src/sidebar-right.js` 是 prelude（在 `apply()` **之前**求值），它注册的渲染回调
    //    引用不到 apply 的作用域 ⇒ 真机上 `ReferenceError: renderUserPropsPanel is not defined`
    //    ⇒ React 卸载整棵树 ⇒ **整个页面空白**（实测复现；不是"这里不画"那种局部问题）。
    //    设置页那条路察觉不到：它经 ctx 显式收这个函数，所以只有侧栏会炸。
    {
      // 模块级 = 顶格声明（源码里 `function` 前没有缩进）。缩进只认 `[ \t]`：
      // `\s` 会跨行吞掉换行，CRLF 检出下 `^` 落在 `\r` 后、`\s+` 吃掉 `\n`，
      // 顶格声明前面是注释行就会被误判成"缩进形态"（LF 检出测不出来）。
      const moduleLevel = /^function renderUserPropsPanel\(/m.test(src);
      const notInApply = !/^[ \t]+function renderUserPropsPanel\(/m.test(src);
      check('面板渲染器是**模块级**声明（放回 apply() 闭包会让侧栏一点就整页白屏）',
        moduleLevel && notInApply);
      check('quick-panel 当自由变量用它（不许改成只认 prop —— 那会再掉回同一个坑）',
        qpCode.includes('renderUserPropsPanel()') && !qpCode.includes('props.renderUserPropsPanel'));
      check('两个挂载点都不再传它（它已不在闭包里，传了也没用）',
        !src.includes('QuickPanel, { dock: "drawer", renderUserPropsPanel }')
          && !sidebarSrc.includes('QuickPanel, { dock: "official", renderUserPropsPanel }'));
      check('negative control: 缩进写进 apply()（闭包形态）会被同一条判据判红',
        !(/^function renderUserPropsPanel\(/m.test('  function renderUserPropsPanel() {')
          && !/^[ \t]+function renderUserPropsPanel\(/m.test('  function renderUserPropsPanel() {')));
    }
    // 共用同一个开关：两个壳（设置页 / 侧栏）不许各存一份 `propsPanelOpen`。
    // ⚠️ 同上：按**剥注释**的那份判，否则解释原理的散文里那句 `` `propsPanelOpen` `` 会被当成直读。
    check('「壁纸属性」开关只有一份（侧栏走 accessor，不另存一份状态）',
      (src.match(/let propsPanelOpen = /g) || []).length === 1
        && src.includes('function userPropsPanelOpen(')
        && qpCode.includes('userPropsPanelOpen()')
        && !qpCode.includes('propsPanelOpen'));
  }
  // ── 侧栏缩略图圆盘：圆度靠整圆裁切，不靠 mask ────────────────────────────────
  // 现场反馈"当前壁纸图片不够圆"。成因：外缘走 border-radius + overflow（把方盒子裁圆），
  // 同时又叠了 radial-gradient mask 去挖中心孔 —— mask 会提升一层光栅、把外缘抗锯齿弄糊。
  // 现在：外缘 = `clip-path: circle(50%)`，中心孔 = ::after 那枚描边圆环，整体不再用 mask。
  {
    const thumbRule = () => (/\.we-qp__thumb \{[^}]*\}/.exec(stylesSrc) || [''])[0];
    check('缩略图圆盘：整圆裁切（clip-path: circle）+ 方形外接盒；不再用 mask',
      /clip-path: circle\(50%\)/.test(thumbRule())
        && /aspect-ratio: 1 \/ 1/.test(thumbRule())
        && !/mask:/.test(thumbRule()));
    check('negative control: 退回「只靠 border-radius 裁圆 + mask 挖孔」会被同一条判据判出',
      !(() => {
        const r = thumbRule();
        return /clip-path: circle\(50%\)/.test(r.replace('clip-path: circle(50%);', ''))
          && !/mask:/.test(r + 'mask: radial-gradient(circle, transparent 0 3px, #000 4px);');
      })());
    check('中心孔仍由 ::after 的描边圆环画（不是叠色块；玻璃要能透出底色）',
      /\.we-qp__thumb::after \{[^}]*border: 1px solid/.test(stylesSrc)
        && /\.we-qp__thumb::after \{[^}]*border-radius: 50%/.test(stylesSrc));
  }
  // ── 侧栏列表的滚动链（真机回归：列表滚不动）────────────────────────────────
  // 布局靠"同级权重 + 源码顺序"决胜：`.we-qp--official .we-qp__section { flex: 0 0 auto }`
  // 与 `.we-qp--official .we-qp__library { flex: 1 1 auto }` 同为两个类，后者在源码里更晚
  // ⇒ 列表那节拿到弹性高度、它里面的 `overflow-y:auto` 才触发。**任何多一个类的写法**
  //（如 `.we-qp__tabbody--library > .we-qp__section`）会不看顺序地压过它 —— 列表随即被压成
  // 内容高、滚不动（用户实测到的那一版）。判据按**权重**判：给 `.we-qp__section` 设 flex
  // 的选择器不得比同族那条更重；再加一条顺序判据。
  {
    // 规则来自 styles.js 的 CSS：注释里也会出现这些类名（上面那条警告就写着坏写法）⇒ 先按
    // **CSS 词法**跳过注释与字符串再解析规则。不用"朴素块注释正则"（本仓 ⑦ 号规则：那类写法
    // 会从注释 / 字符串里开一个块注释，把中间的真实内容**静默删掉**）；CSS 也不套 JS 词法
    //（它没有行注释，`url(//host/x)` 会被误删）。
    const skipCssComments = (text) => {
      let out = '';
      for (let i = 0; i < text.length; i++) {
        if (text[i] === '/' && text[i + 1] === '*') {
          const end = text.indexOf('*/', i + 2);
          i = end === -1 ? text.length : end + 1;
          out += ' ';
          continue;
        }
        if (text[i] === '"' || text[i] === "'") {
          const quote = text[i];
          out += quote;
          for (i++; i < text.length && text[i] !== quote; i++) out += text[i] === '\\' ? text[i++] + (text[i] || '') : text[i];
          out += quote;
          continue;
        }
        out += text[i];
      }
      return out;
    };
    const css = skipCssComments(stylesSrc);
    /** 规则清单（含 @media/@keyframes 的嵌套：按花括号深度切）。 */
    const rules = [];
    for (let i = 0; i < css.length; i++) {
      if (css[i] !== '{') continue;
      const sel = css.slice(css.lastIndexOf('}', i) + 1, i);
      let depth = 0; let k = i;
      for (; k < css.length; k++) {
        if (css[k] === '{') depth++;
        else if (css[k] === '}' && --depth === 0) break;
      }
      rules.push({ at: i, sel, body: css.slice(i + 1, k) });
      i = k;
    }
    const weightOf = (sel) => (sel.match(/\.[\w-]+/g) || []).length + (sel.match(/\[[^\]]+\]/g) || []).length;
    const baseSel = '.we-qp--official .we-qp__section';
    const sectionFlexRules = [];
    for (const r of rules) {
      if (!/(^|[;\s])flex\s*:/.test(r.body)) continue;
      for (const part of r.sel.split(',')) {
        const s = part.trim();
        if (/\.we-qp__section\b/.test(s)) sectionFlexRules.push({ at: r.at, sel: s, w: weightOf(s) });
      }
    }
    const libraryRule = rules.find((r) => r.sel.split(',').some((s) => s.trim() === '.we-qp--official .we-qp__library')
      && /(^|[;\s])flex\s*:\s*1 1 auto/.test(r.body));
    const tooHeavy = sectionFlexRules.filter((r) => r.w > weightOf(baseSel));
    check('侧栏列表的滚动链：给 .we-qp__section 设 flex 的选择器不得比 `' + baseSel + '` 更重',
      sectionFlexRules.length >= 1 && tooHeavy.length === 0,
      tooHeavy.map((r) => r.sel + '(' + r.w + ')').join(' | ')
        || sectionFlexRules.length + ' 条同权重规则（靠源码顺序决胜）');
    check('列表那节的 `flex: 1 1 auto` 必须晚于同权重那条 `flex: 0 0 auto`（顺序即胜负）',
      Boolean(libraryRule) && sectionFlexRules.every((r) => libraryRule.at > r.at));
    check('negative control: `.we-qp__tabbody--library > .we-qp__section` 那条坏写法会被同一条判据判出',
      weightOf('.we-qp--official .we-qp__tabbody--library > .we-qp__section') > weightOf(baseSel));
  }
  // ── 需求④（两边数据一致）：侧栏不持有第二份状态 ──
  // ① 外观 / 画面处理器**提升到模块级**（在 WallpaperPicker 之前声明）—— 两处调的是
  //    同一份实现，不是两份手抄；
  // ② 渲染器解构的每个 ctx 字段，侧栏这一侧都要有交代（提供，或进 setting-only 名单
  //    由"取用即抛错"的占位器兜住）—— 将来渲染器加字段，这里会红；
  // ③ 侧栏两页零裸写（`selection.X =` 计数为 0）。
  const PROMOTED = ['onScrim', 'onWallpaperOpacity', 'onBorder', 'onBlur', 'onWallpaperBlur',
    'onBackgroundBrightness', 'onBackgroundContrast', 'onBackgroundSaturate', 'onAccent',
    'onGlassColor', 'onGlassAlpha', 'onGlassFidelity', 'onChatGlassFidelity', 'onToggleThemeFollow'];
  {
    const compStart = src.indexOf('function WallpaperPicker() {');
    const notPromoted = PROMOTED.filter((n) => {
      const at = src.indexOf('const ' + n + ' = ');
      return at === -1 || at > compStart;
    });
    check('外观 / 画面处理器已提升到模块级（设置页与侧栏共用同一份实现）',
      notPromoted.length === 0, notPromoted.join(', ') || PROMOTED.length + ' 个都在组件之前');
    check('negative control: 仍住在组件里的处理器会被同一条判据判出',
      ([...PROMOTED.slice(1), 'onScrim']).some((n) => {
        const at = src.indexOf('const ' + n + ' = ');
        return at > compStart;
      }) === false && PROMOTED.every((n) => src.indexOf('const ' + n + ' = ') < compStart));
  }
  {
    // 渲染器解构行 → ctx 字段表。
    // ⚠️ **必须容忍 CRLF**（`\\r?\\n`，不能写裸 `\\n`）：CI 跑在 windows-latest，检出是 CRLF
    //    形态（本仓没有 .gitattributes，Git for Windows 默认 autocrlf），而本文件的其它判据
    //    大多用 `\\s` 吃掉了那个 `\\r` —— 只有这条把换行写成了字面量 `\\n`，于是**候选恒为 0**：
    //    症状是 `候选 0 个` + 279 passed / 1 failed，本机（LF 检出）却全绿。
    //    实测复现：`git clone -c core.autocrlf=true` 的检出上 `node test/verify-scene-live.mjs`
    //    得到与 CI 逐字相同的失败（2026-10-01，PR #125 首次推送）。
    const CTX_DESTRUCTURE = (fnName) =>
      new RegExp('function ' + fnName + '\\(ctx\\) \\{\\r?\\n\\s*const \\{([^}]*)\\} = ctx;');
    const ctxFieldsOf = (fnName, text = tabsSrc) => {
      const m = text.match(CTX_DESTRUCTURE(fnName));
      return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : null;
    };
    // 正/负对照成对：同一判据在两种换行形态下都要认出字段（LF 是本机形态、CRLF 是 CI 形态），
    // 且对"换个函数名"要落空 —— 否则上面那条 ≥20 的判据可能是空转的。
    const lfSample = 'function renderAppearanceTab(ctx) {\n  const { a, b } = ctx;';
    check('ctx 解构判据在 LF / CRLF 两种检出形态下都认得出字段（CI 是 CRLF）',
      JSON.stringify(ctxFieldsOf('renderAppearanceTab', lfSample)) === JSON.stringify(['a', 'b'])
      && JSON.stringify(ctxFieldsOf('renderAppearanceTab', lfSample.replace(/\n/g, '\r\n'))) === JSON.stringify(['a', 'b'])
      && ctxFieldsOf('renderNope', lfSample) === null,
      'lf=' + JSON.stringify(ctxFieldsOf('renderAppearanceTab', lfSample))
        + ' crlf=' + JSON.stringify(ctxFieldsOf('renderAppearanceTab', lfSample.replace(/\n/g, '\r\n'))));
    const mentions = (text, f) => new RegExp('(^|[\\s,{])' + f + '\\s*[,:}]', 'm').test(text)
      || text.includes('"' + f + '"');
    // ⚠️ P4-19 之后要连**节函数**一起收：拆分把字段从 `render*Tab` 搬到了 `render*Section` 里，
    // 只读 Tab 那一层会得到空集（判据的 `>= 20` 会当场红 —— 它红得对，是口径没跟上代码）。
    const allFieldsOf = (fn) => {
      const domain = fn.replace(/^render/, '').replace(/Tab$/, '');
      const secNames = [...tabsSrc.matchAll(new RegExp('function (render' + domain + '\\w*Section)\\(ctx\\)', 'g'))]
        .map((m) => m[1]);
      return [fn, ...secNames].flatMap((n) => ctxFieldsOf(n) || []);
    };
    const wanted = ['renderAppearanceTab', 'renderEffectsTab', 'renderAudioTab']
      .flatMap((fn) => allFieldsOf(fn));
    const missing = wanted.filter((f) => !mentions(qpSrc, f));
    check('侧栏 ctx 覆盖渲染器要的全部字段（提供的字段 + setting-only 占位器），候选 ' + wanted.length + ' 个',
      wanted.length >= 20 && missing.length === 0, '缺：' + (missing.join(', ') || '无'));
    check('negative control: 漏掉一个 ctx 字段会被同一条判据判出',
      !mentions('const x = 1;', 'onGlassAlpha'));
    const bareWrites = (stripComments(qpSrc).match(/(?<![\w.$])selection\.[\w$]+\s*=(?!=)/g) || []).length;
    check('侧栏（quick-panel.js）对 store 零裸写 —— 写一律走处理器 / setSetting / setTransient',
      bareWrites === 0, bareWrites + ' 处裸写');
  }
  // 底栏深链：外观 / 播放各带自己的 tabId，落地走同一个 switchTab（一次性请求）。
  const deepLinkOk = (clientText, sideText, qpText) => sideText.includes('function openSettingsSection(tabId)')
    && sideText.includes('setTransient("settingsTabRequest", String(tabId))')
    && sideText.includes('setTransient("settingsTabRequest", "")')
    && clientText.includes('settingsTabRequest: ""')
    && clientText.includes('const req = selection.settingsTabRequest')
    && qpText.includes('openSettingsSection(foot.target)')
    && qpText.includes('label: weT("字体与更多外观 ›")')
    && qpText.includes('label: weT("更多播放设置 ›")');
  check('底栏深链：外观 / 播放页各带自己的 tabId（瞬态请求 + 超时清理）',
    deepLinkOk(src, sidebarSrc, qpSrc));
  check('negative control: 不带 tabId 的旧形态会被同一条判据判出',
    !deepLinkOk(src, 'function openSettingsSection() {', qpSrc));

  // 侧栏 ctx 的 setting-only 占位器要有**牙**：调用它、或读它的属性都抛错 —— 将来某次
  // 编辑把一行挪进侧栏档（比如把「帧率上限」放进播放页），会当场炸而不是静默变成
  // "点了没反应"。判据拿**真源码**求值后再戳（不是照着实现抄一遍 —— 那样只会测到抄写）。
  {
    const factory = new Function('weT', 'React', 'localStorage',
      qpSrc + '\nreturn { sidebarRenderCtx, QP_CTX_SETTINGS_ONLY, QP_TABS };');
    const bag = factory((k) => k, { createElement: () => null }, { getItem: () => null, setItem() {} });
    const ctx = bag.sidebarRenderCtx({ sel: {}, onAccent: () => 'ok' });
    const called = (() => { try { ctx.onCaretColor(); return 'no-throw'; } catch (e) { return String(e.message); } })();
    const read = (() => { try { return String(ctx.fontSet.open); } catch (e) { return String(e.message); } })();
    check('侧栏 ctx 的 setting-only 占位器：调用 / 取属性都抛错（响亮且可定位）',
      ctx.surface === 'sidebar' && ctx.onAccent() === 'ok' && bag.QP_TABS.length === 3
        && called.includes('[we-sidebar]') && called.includes('onCaretColor')
        && read.includes('[we-sidebar]') && read.includes('fontSet'),
      called.slice(0, 48));
    check('负对照：名单外的字段仍是 undefined（判据不是恒真 —— 占位器只覆盖点过名的）',
      ctx.someFieldNeverListed === undefined && bag.QP_CTX_SETTINGS_ONLY.length >= 20);
  }
}

// ── 渲染回归：三档页签都渲染得出，且各画各的 ────────────────────────────────
// 源码级判据看不出的那一类（漏声明的名字、ctx 装错对象、占位器在解构时就炸）只有真渲染
// 一次才知道。React / store 用最小替身，**渲染器用真的**（import src/panel-tabs.js）。
{
  const panelMod = await import(pathToFileURL(join(root, 'src', 'panel-tabs.js')).href);
  const schema = await import(pathToFileURL(join(root, 'lib', 'settings-schema.js')).href);
  const noop = () => null;
  // useState 的值由队列喂（QuickPanel 的调用序：[view, qpTab]）。
  const STATE = [];
  const ReactStub = {
    Fragment: 'Fragment',
    useState: (init) => [STATE.length ? STATE.shift() : (typeof init === 'function' ? init() : init), () => {}],
    useEffect: () => {}, useRef: (v) => ({ current: v }), createRef: () => ({ current: null }),
    createElement: (t, p, ...c) => (typeof t === 'function' ? t(p || {}, ...c) : { type: t, props: p || null, children: c }),
  };
  const shapeOf = (n, acc = []) => {
    if (Array.isArray(n)) { n.forEach((x) => shapeOf(x, acc)); return acc; }
    if (!n || typeof n !== 'object') return acc;
    if (n.props && n.props.className) acc.push(String(n.props.className));
    if (Array.isArray(n.children)) n.children.forEach((x) => shapeOf(x, acc));
    return acc;
  };
  const textOf = (n) => (Array.isArray(n) ? n.map(textOf).join(' ') : (!n || typeof n !== 'object' ? ''
    : ((Array.isArray(n.children) ? n.children.filter((c) => typeof c === 'string').join(' ') : '') + ' '
      + (Array.isArray(n.children) ? n.children.map(textOf).join(' ') : ''))));
  // 面板渲染器（panel-tabs.js 是真模块）要的**全局**预置：求值参数时会碰到的那几个。
  globalThis.React = ReactStub;
  globalThis.SliderRow = noop; globalThis.switchRow = noop;
  globalThis.ctlText = noop; globalThis.swatchRow = noop; globalThis.renderFontSetEditor = noop;
  globalThis.ACCENT_PRESETS = []; globalThis.GLASS_COLOR_PRESETS = []; globalThis.CARET_COLOR_PRESETS = [];
  // 子 UI 玻璃登记表 + 键名生成器：panel-tabs 的「玻璃 UI」节按它逐项渲染。
  // ⚠️ 给**真值**（schema 的同一份），不手抄 —— 手抄一份就多一个会漂的副本，
  //    而且夹具渲染的项数一旦与真实面板不同就是假绿。
  globalThis.GLASS_CHILDREN = schema.GLASS_CHILDREN || [];
  globalThis.childGlassKey = schema.childGlassKey || ((id, p) => id + p.charAt(0).toUpperCase() + p.slice(1));
  // ⚠️ 「玻璃 UI」节的渲染器已抽到 `src/glass-panel.js`（wip §10.13）：**打包后**它与
  //    `panel-tabs.js` 同作用域，所以后者能按名字直接调；但这里是**按文件 import** 的替身，
  //    两个模块各有自己的作用域 ⇒ 必须自己把它挂成全局（与上面那批模块级助手同一条口径）。
  globalThis.renderAppearanceGlassSection =
    (await import(pathToFileURL(join(root, 'src', 'glass-panel.js')).href)).renderAppearanceGlassSection;
  globalThis.FRAME_VARIANTS = []; globalThis.FPS_CAP_VALUES = (schema.FPS_CAP_VALUES || [0, 24, 30, 60]);
  // 角色表要**真的**：`renderAppearanceTab` 一进门就 `THEME_TYPE_ROLES.filter(...)`（与画不画
  // 字体那节无关）—— 给空数组也活得下去，但真表更接近运行期（而且这几张表是纯数据）。
  globalThis.THEME_TYPE_ROLES = (await import(pathToFileURL(join(root, 'src', 'font', 'typography.js')).href)).THEME_TYPE_ROLES || [];
  globalThis.THEME_COLOR_ROLES = (await import(pathToFileURL(join(root, 'src', 'font', 'color-roles.js')).href)).THEME_COLOR_ROLES || [];
  globalThis.gpuFrameUi = { wid: '', pinned: false, w: 0, h: 0, busy: false, recapturing: false, error: '' };
  // QuickPanel 的自由变量：一律当**形参**传（真实现或替身），漏一个就是 ReferenceError。
  const FREE = ['weT', 'React', 'localStorage',
    'useWeLocale', 'useStore', 'liveRenderEnabled', 'CARD_TYPE_LABELS', 'applySelection', 'cardKeyDown',
    'playbackIsVideoLike', 'playableInventory', 'groupWallpapers', 'rotationCandidates',
    'emit', 'setTransient', 'setSetting', 'onTogglePlay', 'onClear', 'onGroupChange', 'onNextWallpaper',
    'onToggleRotation', 'onToggleAudio', 'onVideoVolume', 'loadInventory', 'openSettingsSection',
    'renderAppearanceTab', 'renderEffectsTab', 'renderAudioTab',
    'onAccent', 'onBlur', 'onBorder', 'onGlassAlpha', 'onGlassColor', 'onGlassFidelity', 'onChatGlassFidelity', 'onToggleThemeFollow',
    'onScrim', 'onWallpaperBlur', 'onWallpaperOpacity',
    'onBackgroundBrightness', 'onBackgroundContrast', 'onBackgroundSaturate',
    // P4-15 从 panel-tabs.js 抽出的具名处理器：侧栏档也画到它们，于是它们成了 quick-panel.js
    // 的**自由变量** ⇒ 必须在这里当形参给（漏一个就是 ReferenceError，这正是本判据的设计）。
    // 与 QP_CTX_SETTINGS_ONLY 的分工：**侧栏档真的会画到的**由这里给真值（替身），
    // 设置页专属的（如 onFpsCap —— 帧率上限那行带 `!sidebarSurface` 门）才进占位器名单。
    'onGlassWindow', 'onLeftSidebarGlass', 'onSidebarGlass',
    // 「玻璃 UI」节的两级子 UI 开关 + 子项独立参数：外观页签（设置页与侧栏档都会画到）。
    'onToggleGlassChild', 'onToggleGlassIndependent', 'onToggleChildIndependent',
    'onGlassChildParam', 'childIndependentOn',
    // 子 UI 登记表：renderAppearanceGlassSection 按它逐项渲染。替身必须给**与 schema 同源**
    // 的那份（不能手抄），否则夹具渲染的项数与真实面板不同，等于假绿。
    'GLASS_CHILDREN', 'childGlassKey',
    'onToggleSceneLive', 'onLiveBootDelay', 'onSceneLiveFps',
    'onPlaybackRate', 'onObjectFit', 'onFlip', 'onOpenPicker', 'setPickerOpener',
    // 侧栏壁纸档的「壁纸属性」：开关读数 / 开关动作 / 面板渲染器**都是模块级的**
    //（client.js 里的函数声明），本台把它们当自由变量带传进来 —— 与内联后的真实形态一致。
    'userPropsPanelOpen', 'openUserPropsPanel', 'closeUserPropsPanel', 'renderUserPropsPanel'];
  const selBase = Object.assign({}, schema.DEFAULTS, {
    loaded: true, loading: false, id: 'w1', url: '/x', playing: true, videoPlaying: true,
    videoVolume: 0.5, videoAudioEnabled: false, videoError: '', type: 'video',
    contentRatingFilter: 'all', hiddenIds: [], rotationGroups: [], rotationGroupId: '',
    rotationEnabled: false, qpSearch: '', qpType: 'all', url2: '',
    inventory: { wallpapers: [], error: null, installDir: '/we', uploadDir: '/up', weAssetsDir: null, sceneMediaBase: '', total: 0, portableCount: 0, playlists: [] },
    accent: '#4f8cff', glassColor: '#ffffff', glassAlpha: 0, blur: 0, border: 0,
    themeFollow: false, themeFollowLine: '',
  });
  // 下钻动作的记账（判据：点开真的走了处理器的打开路径，不是就地偷改状态）。
  const OPEN_CALLS = [];
  // 「壁纸属性」面板渲染器替身：**模块级自由变量形态**（真产物里它就是模块级的函数声明，
  // 见 client.js；写成 `apply()` 里的闭包时真机会抛 ReferenceError，见 repro-sidebar-props.mjs）。
  let SEL = null;
  const propsPanelStub = () => (SEL && SEL.userPropsPanelOpen
    ? { type: 'div', props: { className: 'we-picker__props' }, children: [] }
    : null);
  SEL = selBase;
  const bag = new Function(...FREE,
    qpSrc + '\nreturn { QuickPanel };')(
    ...FREE.map((n) => ({
      weT: globalThis.weT, React: ReactStub,
      localStorage: { getItem: () => null, setItem() {} },
      useWeLocale: noop, useStore: () => SEL,
      liveRenderEnabled: () => false, CARD_TYPE_LABELS: { video: '视频', web: '网页', image: '图片', scene: '场景' },
      applySelection: noop, cardKeyDown: noop, playbackIsVideoLike: () => true,
      playableInventory: () => [], groupWallpapers: () => [], rotationCandidates: () => [],
      emit: noop, setTransient: noop, setSetting: noop,
      onTogglePlay: noop, onClear: noop, onGroupChange: noop, onNextWallpaper: noop,
      onToggleRotation: noop, onToggleAudio: noop, onVideoVolume: noop,
      loadInventory: noop, openSettingsSection: noop,
      renderAppearanceTab: panelMod.renderAppearanceTab, renderEffectsTab: panelMod.renderEffectsTab,
      renderAudioTab: panelMod.renderAudioTab,
      onAccent: noop, onBlur: noop, onBorder: noop, onGlassAlpha: noop, onGlassColor: noop, onGlassFidelity: noop, onChatGlassFidelity: noop,
      onToggleThemeFollow: noop, onScrim: noop, onWallpaperBlur: noop, onWallpaperOpacity: noop,
      onBackgroundBrightness: noop, onBackgroundContrast: noop, onBackgroundSaturate: noop,
      onGlassWindow: noop, onLeftSidebarGlass: noop, onSidebarGlass: noop,
      // 子 UI 两级开关 + 独立参数处理器；登记表与键名生成器给**真值**
      //（与 schema 同源，来自被内联的 panel 模块作用域）—— 手抄一份就会漂。
      onToggleGlassChild: noop, onToggleGlassIndependent: noop, onToggleChildIndependent: noop,
      onGlassChildParam: noop, childIndependentOn: () => false,
      onToggleSceneLive: noop, onLiveBootDelay: noop, onSceneLiveFps: noop,
      onPlaybackRate: noop, onObjectFit: noop, onFlip: noop, onOpenPicker: noop, setPickerOpener: noop,
      userPropsPanelOpen: () => SEL.userPropsPanelOpen === true,
      openUserPropsPanel: () => { OPEN_CALLS.push(1); SEL.userPropsPanelOpen = true; },
      closeUserPropsPanel: () => { SEL.userPropsPanelOpen = false; },
      renderUserPropsPanel: propsPanelStub,
    })[n] || noop));
  const renderTab = (tab, sel) => {
    SEL = sel || selBase;
    STATE.length = 0; STATE.push('cards', tab);
    // 面板渲染器替身由 FREE 注入（模块级自由变量形态，见上面 FREE 表）—— 与真产物的
    // 作用域形态一致：`apply()` 里的闭包在真机上会抛 ReferenceError（见 repro-*.mjs）。
    const tree = bag.QuickPanel({ dock: 'official' });
    return { tree, shape: shapeOf(tree).join('|'), text: textOf(tree) };
  };
  const threw = (tab, sel) => {
    try { renderTab(tab, sel); return ''; } catch (e) { return String((e && e.message) || e); }
  };
  const bad = ['wallpaper', 'appearance', 'playback'].map((t) => t + ':' + threw(t)).filter((s) => !s.endsWith(':'));
  check('三档页签都渲染得出（真源码 + 真渲染器）', bad.length === 0, bad.join(' | ') || '三档 ok');
  const wp = renderTab('wallpaper'); const ap = renderTab('appearance'); const pb = renderTab('playback');
  const tabsOf = (t) => t.shape.split('|')
    .filter((c) => c === 'we-tabs__tab' || c === 'we-tabs__tab we-tabs__tab--active');
  check('三档页签栏都在（每档三个页签，且只有当前档带 --active）',
    [wp, ap, pb].every((t) => tabsOf(t).length === 3 && tabsOf(t).filter((c) => c.includes('--active')).length === 1));
  check('壁纸档画列表、外观 / 播放档不画（列表只属于壁纸页）',
    wp.shape.includes('we-qp__library') && wp.shape.includes('we-qp__list')
      && wp.shape.includes('we-qp__viewtabs') // 列表/卡片视图切换也只在壁纸档（标签式，非页签栏成员）
      && !ap.shape.includes('we-qp__library') && !pb.shape.includes('we-qp__library'));
  check('外观档 = 主题 + 细节两节（设置页专属的字体那节不画）',
    ap.text.includes('主题') && ap.text.includes('细节') && !ap.text.includes('全局字体'));
  check('播放档 = 画面 + 声音两组；准备与诊断（帧率上限档位）不画，倍速 / 适配照旧在',
    pb.text.includes('画面') && pb.text.includes('声音')
      && !pb.text.includes('无限制') && pb.text.includes('2x') && pb.text.includes('覆盖'));
  check('底栏入口随页签换文案（壁纸 / 外观 / 播放三档各一）',
    wp.text.includes('壁纸引擎设置 ›') && ap.text.includes('字体与更多外观 ›')
      && pb.text.includes('更多播放设置 ›'));
  check('播放档的空态 CTA =「去挑一张 ›」（拿走当前壁纸再渲染一次）',
    renderTab('playback', Object.assign({}, selBase, { id: '', url: '' })).text.includes('去挑一张 ›'));
  // ── 壁纸属性下钻（真源码渲染）：入口可达 → 整区换面板 → 返回退出 ────────────
  // 入口判据与设置页同一条（上面那条源码判据、`verify-picker-props` ①）：仅
  //「场景/网页 + propsUrl」才出。下面几种输入调的是**同一个**谓词函数。
  {
    const findBtn = (root, label) => {
      let hit = null;
      (function walk(n) {
        if (hit) return;
        if (Array.isArray(n)) { n.forEach(walk); return; }
        if (!n || typeof n !== 'object') return;
        const cls = String((n.props && n.props.className) || '');
        if (n.type === 'button' && cls.split(/\s+/).includes('we-picker__btn')
          && textOf(n).trim() === label) { hit = n; return; }
        if (Array.isArray(n.children)) n.children.forEach(walk);
      })(root);
      return hit;
    };
    const hasPropsPanel = (t) => t.shape.includes('we-picker__props');
    const hasLibrary = (t) => t.shape.includes('we-qp__library');
    // 入口按**类名**找：文案随下钻在「壁纸属性 / 收起壁纸属性」之间切，按文字找会漏。
    const hasEntry = (t) => t.shape.includes('we-qp__propsbtn');
    // ⚠️ 入口判据里的 `current` 是**从库清单里按 id 找回来**的那一条（见 quick-panel.js）——
    //    夹具不给条目，`current` 恒为 null，再对的实现在这里也只会是一条空转的红。
    //    `userPropsPanelOpen` 是本台的开关读数（真源码读 `userPropsPanelOpen()`）。
    const withCurrent = (type, id, propsUrl, propsOpen, itemPropsUrl) => Object.assign({}, selBase, {
      type, id, url: '/x', propsUrl, userPropsPanelOpen: propsOpen === true,
      inventory: Object.assign({}, selBase.inventory, {
        wallpapers: [{ id, type, title: id, propsUrl: itemPropsUrl === undefined ? propsUrl : itemPropsUrl, preview: null }],
      }),
    });
    const sceneSel = () => withCurrent('scene', 's1', 'http://x/props/tokS');
    const webSel = () => withCurrent('web', 'w9', 'http://x/props/tokW');
    const noUrlSel = () => withCurrent('scene', 's2', null);
    const imgSel = () => withCurrent('image', 'i1', null);
    const entryOf = (sel) => findBtn(renderTab('wallpaper', sel).tree, '壁纸属性');
    check('侧栏壁纸档：场景 / 网页壁纸出「壁纸属性」入口（判据与设置页同一条）',
      Boolean(entryOf(sceneSel())) && Boolean(entryOf(webSel())));
    check('negative control: 图片壁纸 / 没有 propsUrl 的场景壁纸都不出入口',
      !entryOf(imgSel()) && !entryOf(noUrlSel()));
    // 点开 ⇒ 走处理器的打开路径（不是就地偷改状态），内容区整区换成「返回 + 面板」。
    {
      OPEN_CALLS.length = 0;
      const target = renderTab('wallpaper', sceneSel());
      const btn = findBtn(target.tree, '壁纸属性');
      check('点「壁纸属性」⇒ 走 openUserPropsPanel（不是就地偷改开关）',
        Boolean(btn) && !hasPropsPanel(target) && (btn.props.onClick(), OPEN_CALLS.length === 1));
      const openSel = withCurrent('scene', 's1', 'http://x/props/tokS', true);
      const opened = renderTab('wallpaper', openSel);
      check('下钻后：列表 / 搜索栏让位，内容区**直接就是面板**（没有返回按钮那一行）',
        hasPropsPanel(opened) && !hasLibrary(opened) && !opened.shape.includes('we-qp__viewbar')
          && !findBtn(opened.tree, '返回'),
        'panel=' + hasPropsPanel(opened) + ' lib=' + hasLibrary(opened));
      check('下钻时入口仍在（同一行同一位置，文案换成「收起壁纸属性」）—— 收起路径靠它',
        hasEntry(opened) && !findBtn(opened.tree, '壁纸属性') && Boolean(findBtn(opened.tree, '收起壁纸属性')));
      // 收起 ⇒ 回壁纸页（列表回来、面板消失），走的是处理器的关闭路径（没有返回按钮，
      // 所以走的是那枚「收起壁纸属性」；这条判据同时钉住"收起路径没有丢"）。
      const collapse = findBtn(opened.tree, '收起壁纸属性');
      const closedSel = withCurrent('scene', 's1', 'http://x/props/tokS', false);
      const closed = renderTab('wallpaper', closedSel);
      check('点「收起壁纸属性」⇒ 回壁纸页（列表与入口都回来、面板消失）',
        Boolean(collapse) && (collapse.props.onClick(), hasLibrary(closed)
          && !hasPropsPanel(closed) && hasEntry(closed) && Boolean(findBtn(closed.tree, '壁纸属性'))));
      // 结构性判据（这一族缺陷的共同形态就是"某一档里内容区什么都没有"）：壁纸档在任何
      // 开关 / 属性组合下，内容区都必须有**列表**或**面板**之一。
      for (const [name, sel] of [
        ['有属性 + 开关开（下钻）', withCurrent('scene', 's1', 'http://x/props/tokS', true)],
        ['有属性 + 开关关（列表）', withCurrent('scene', 's1', 'http://x/props/tokS', false)],
        ['propsUrl 被清掉 + 开关开', withCurrent('scene', 's1', '', true, null)],
        ['开关关着', withCurrent('scene', 's1', 'http://x/props/tokS', false)],
        ['本来就没属性（图片壁纸）', withCurrent('image', 'i1', null, true)],
      ]) {
        const t = renderTab('wallpaper', sel);
        check('壁纸档内容区非空（' + name + '）—— 列表或面板必居其一',
          hasLibrary(t) || hasPropsPanel(t), 'lib=' + hasLibrary(t) + ' panel=' + hasPropsPanel(t));
      }
      // 入口三档都在同一位置（页签栏下方）⇒ 切到外观 / 播放档时入口照旧在，面板不画。
      check('入口三档都在（不随页签消失、也不随下钻消失）；面板只属壁纸档',
        hasEntry(renderTab('wallpaper', openSel)) && hasEntry(renderTab('appearance', openSel))
          && hasEntry(renderTab('playback', openSel))
          && hasEntry(renderTab('wallpaper', withCurrent('scene', 's1', 'http://x/props/tokS', false)))
          && !hasPropsPanel(renderTab('appearance', openSel))
          && !hasPropsPanel(renderTab('playback', openSel)));
    }
  }
  // 接线判据：侧栏三档的树里**不许出现设置页专属的占位器**（把它戳一下会抛 [we-sidebar]）。
  // 抓的是"ctx 装错对象 / 少接一个处理器"那一类 —— 源码级判据只认名字在不在文件里，认不出
  // 它被塞进了哪一个 ctx 对象。其余抛错（例如替身里缺 weDrawCtx）不算，本判据只认那串前缀。
  const stubHits = (tree) => {
    const hits = [];
    (function walk(n) {
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (!n || typeof n !== 'object') return;
      for (const k of Object.keys(n.props || {})) {
        const fn = n.props[k];
        if (typeof fn !== 'function') continue;
        hits.push('#'); // 覆盖率计数（见下）：判据不能因为"树里根本没有处理器"而恒真
        try { fn({ target: { value: '1', checked: true } }); }
        catch (e) { if (String(e && e.message).includes('[we-sidebar]')) hits.push(k); }
      }
      if (Array.isArray(n.children)) n.children.forEach(walk);
    })(tree);
    return hits;
  };
  const wired = [wp, ap, pb].map((t) => stubHits(t.tree));
  const handlerCount = wired.reduce((sum, h) => sum + h.filter((x) => x === '#').length, 0);
  check('侧栏三档的控件都接在真人身上（树里没有设置页专属的占位器）—— 覆盖面 ' + handlerCount + ' 个处理器',
    handlerCount >= 10 && wired.every((h) => h.filter((x) => x !== '#').length === 0),
    wired.flat().filter((x) => x !== '#').join(', ') || '没有占位器上线');
  check('负对照：把设置页专属处理器塞进树里会被同一判据抓出',
    stubHits({ props: { onClick: () => { throw new Error('[we-sidebar] ctx.fontSet 属于设置页'); } }, children: [] })
      .filter((x) => x !== '#').length === 1);
}

// ── 设置页页签的渲染挂载台 + **节顺序**判据（P4-19 的前置）──────────────────────
// 为什么需要它：`renderWallpaperTab`（最大，458 行）与 `renderAdvancedTab` 此前**一条行为判据
// 都没有** —— 只有源码锚点（"函数在这儿""首行从 ctx 解构"）。而纯搬动最容易出的事
// （**漏掉一节 / 改掉顺序 / 复制一节**）源码锚点一个都看不见。
// 这里的挂载台用**真渲染器**（同一个 `panelMod`）+ 最小替身渲染这两个页签，并抽出树里
// `we-picker__section-label` 的**有序**序列 —— 于是"节顺序"成了**行为**判据：它对任何重构
// 都不变（代码搬去哪都行，只要渲染出来还是这个顺序），正是拆分这种纯搬动需要的那类判据。
{
  const noop = () => null;
  // 同一个模块（前面那块已经 import 过 ⇒ 这里拿的是缓存），但 `const` 是块作用域、不能跨块用。
  const panelMod = await import(pathToFileURL(join(root, 'src', 'panel-tabs.js')).href);
  const schemaMod = await import(pathToFileURL(join(root, 'lib', 'settings-schema.js')).href);
  // ⚠️ 先归一成 LF 再切片：工作树是 CRLF，而下面的边界串是 `\n  }\n`（裸 LF）——
  // 在 CRLF 上它**匹配不到**，`indexOf` 回 -1 会让切片一路吃到文件尾（把别人的解构也当成
  // 这一节的），于是判据会把整个词表都报成"漏解构"。这类"切错了还照旧报"正是判据要防的形状。
  const tabsSrcNow = readFileSync(new URL('../src/panel-tabs.js', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n');
  // 这些名字在产物里是**内联同一作用域**的常量 / 纯组件 / 纯函数；单独 import 时按内联规则
  // 补 globalThis 替身（`weT` 由 tools/weT-shim.mjs 装、React 等由上面那块装）。
  Object.assign(globalThis, {
    DEFAULTS: schemaMod.DEFAULTS,
    ADAPTER_TARGET_VALUES: schemaMod.ADAPTER_TARGET_VALUES,
    Toggle: noop, VinylRecord: noop,
    SWITCH_DIRS: ['left', 'right'], SWITCH_DIR_LABELS: { left: '左', right: '右' },
    SWITCH_SPEEDS: [{ id: 'fast', ms: 200 }, { id: 'normal', ms: 400 }],
    SWITCH_TRANSITIONS: [{ id: 'fade' }, { id: 'wipe' }],
    ADAPTER_LABELS: { auto: '自动检测' },
    adapterCaps: () => ({}), adapterDetectedLabel: () => '', adapterMismatchWarning: () => '',
    liveDiagVerbose: () => false, weAudioVolume: () => 0, vinylSpinVisible: () => false,
    liveFailReasonOf: () => '', groupWallpapers: () => [], switchFrames: () => [],
    switchTransitionOf: () => ({ id: 'fade', dir: 'left', speed: 'normal', ms: 400 }),
    renderConfirmRow: noop,
    changeUploadDir: async () => {}, changeWeAssetsDir: async () => {},
    uploadWallpaperFile: () => {}, removeUploadWallpaper: () => {},
    importPlaylistIntoDraft: () => {}, saveEditingGroup: () => {},
    startEditGroup: () => {}, cancelEditGroup: () => {}, startCreateGroup: () => {},
    // 效果页**实时渲染组**（`sel.type` 为场景/网页时才画）此前从没渲染过 —— 它要的这批替身
    // 一个都没给，于是那几十行连"渲染得出"这一条都过不了。补上才能让它进入判据视野。
    codecLabel: () => '', framePreviewSrc: () => '', frameVariantCount: () => 0,
    probeGpuFrameState: () => ({}), syncLayers: () => {},
    // `false` = 实时渲染未生效 ⇒ 「出图来源」那一行也画出来（覆盖更宽的那一支）。
    liveRenderEnabled: () => false, customFrameInput: null,
    SCENE_LIVE_FPS_VALUES: [0, 24, 30, 60],
    // ⚠️ 挂载台原先把 `FRAME_VARIANTS` 设成**空数组** ⇒ 场景档那一行读 `FRAME_VARIANTS[i].label`
    // 直接抛（"从没渲染过"的又一处：空替身让整条分支不可达）。给成有内容的表，分支才可达。
    FRAME_VARIANTS: [{ id: 0, label: '默认' }, { id: 1, label: '档 1' }, { id: 2, label: '档 2' }],
    frameVariantCount: () => 3,
  });
  /** 树上 `we-picker__section-label` 的**有序**文本序列（深度优先 = 渲染顺序）。 */
  const sectionSeq = (n, acc = []) => {
    if (Array.isArray(n)) { n.forEach((x) => sectionSeq(x, acc)); return acc; }
    if (!n || typeof n !== 'object') return acc;
    const cls = n.props && n.props.className;
    if (typeof cls === 'string' && cls.includes('we-picker__section-label')) {
      const txt = (Array.isArray(n.children) ? n.children : []).filter((c) => typeof c === 'string').join('');
      if (txt) acc.push(txt);
    }
    if (Array.isArray(n.children)) n.children.forEach((x) => sectionSeq(x, acc));
    return acc;
  };
  const sameSeq = (got, want) => got.length === want.length && got.every((x, i) => x === want[i]);

  // ── 把"标签"从替身里**放回树里**：`SliderRow` / `switchRow` / `ctlText` 的标签本来就是
  // 用户看得见的那一行文字，但 `noop` 把它们吞成 null ⇒ "控件标签的有序序列"就不可能成为判据。
  // 这条细锚是 `renderEffectsTab` 需要的：它**只有一个节标签**，节顺序钉不住它的内部结构。
  const REACT = globalThis.React;
  const labelStub = (label) => (typeof label === 'string' && label
    ? REACT.createElement('span', { className: 'stub-label' }, label) : null);
  const PREV_STUBS = { SliderRow: globalThis.SliderRow, switchRow: globalThis.switchRow, ctlText: globalThis.ctlText };
  globalThis.SliderRow = labelStub;
  globalThis.switchRow = (label) => labelStub(label);
  globalThis.ctlText = (label) => labelStub(label);
  /** 树里**控件标签**的有序序列（`stub-label` = SliderRow / switchRow / ctlText 的标签）。 */
  const labelSeq = (n, acc = []) => {
    if (Array.isArray(n)) { n.forEach((x) => labelSeq(x, acc)); return acc; }
    if (!n || typeof n !== 'object') return acc;
    const cls = n.props && n.props.className;
    if (typeof cls === 'string' && cls.includes('stub-label')) {
      const txt = (Array.isArray(n.children) ? n.children : []).filter((c) => typeof c === 'string').join('');
      if (txt) acc.push(txt);
    }
    if (Array.isArray(n.children)) n.children.forEach((x) => labelSeq(x, acc));
    return acc;
  };
  /**
   * 树里所有 `className` 的**有序**序列，以及去重排序后的"**画了哪些控件种类**"。
   *
   * 为什么需要这条：`labelSeq` **只看得见走 `SliderRow` / `switchRow` / `ctlText` 的标签** ——
   * 而轮播编辑器那几十行是**裸 `<input>` / `<select>` / `<span>`** 拼的，一个标签都不产。
   * 实测：把 `groups` / `group` / `editing` / `armedConfirm` 全打开后，`labelSeq` **仍然是原来那 3 个**
   * ⇒ 标签锚对"裸控件"这一段是**盲的**。类名序列补的正是这个盲区（它认"画了哪些种类"，
   * 而不是"写了哪些词"），且同样是行为级的：对任何重构不变。
   */
  const classSeq = (n, acc = []) => {
    if (Array.isArray(n)) { n.forEach((x) => classSeq(x, acc)); return acc; }
    if (!n || typeof n !== 'object') return acc;
    const cls = n.props && n.props.className;
    if (typeof cls === 'string' && cls) acc.push(cls);
    if (Array.isArray(n.children)) n.children.forEach((x) => classSeq(x, acc));
    return acc;
  };
  const classKinds = (tree) => [...new Set(classSeq(tree))].sort();
  /** 树里所有字符串（去重后排序）—— **文本锚**用：有些分支只改文案（同一套构件），
   *  类名锚看不见，标签锚也只认走 SliderRow/switchRow/ctlText 的那些。 */
  const treeStrings = (n, acc = []) => {
    if (Array.isArray(n)) { n.forEach((x) => treeStrings(x, acc)); return acc; }
    if (!n || typeof n !== "object") return acc;
    if (Array.isArray(n.children)) {
      for (const c of n.children) { if (typeof c === "string") acc.push(c); else treeStrings(c, acc); }
    }
    return acc;
  };
  const textKinds = (tree) => [...new Set(treeStrings(tree))].sort();

  const st = Object.assign({}, schemaMod.DEFAULTS, {
    loaded: true, loading: false, id: 'w1', url: '/x', type: 'video', playing: true,
    videoPlaying: true, videoVolume: 0.5, videoAudioEnabled: false, videoError: '',
    contentRatingFilter: 'all', hiddenIds: [], rotationGroups: [], rotationGroupId: '',
    rotationEnabled: false, flip: false, objectFit: 'cover', playbackRate: 1,
    sceneLive: true, sceneLiveFailures: {}, themeFollow: false, themeFollowLine: '',
    adapterTarget: 'auto', pauseOnHidden: false, pauseOnBlur: false, pauseOnBattery: false,
    editingUploadDir: false, uploadDirDraft: '', editingWeAssetsDir: false, weAssetsDirDraft: '',
    weAssetsError: '', propsUrl: '/wallpaper-engine/props/tok',
    inventory: {
      wallpapers: [], error: null, installDir: '/we', uploadDir: '/up', weAssetsDir: null,
      sceneMediaBase: '', total: 0, portableCount: 0, playlists: [],
    },
  });
  const withHandlers = (names) => Object.fromEntries(names.map((n) => [n, noop]));
  const CASES = [
    {
      fn: 'renderWallpaperTab',
      label: '',
      mk: () => st,
      want: ['当前壁纸', '切换过场', '自动轮播', '自定义壁纸'],
      // ⚠️ 实测：456 行的渲染器在「最小替身」下只吐出 3 个控件标签 —— 说明 `editing` / `groups` /
      // `uploadedList` / `propsPanelOpen` 这些门关着时，四节里绝大部分内容**根本没被渲染**。
      // 钉住现状不是认可它：门的另一侧一旦开始渲染，这条就会变红、逼人回来看（下一步就是开门）。
      wantLabels: ['过场动画', '时长', '自动轮转'],
      // 门的**另一侧**：这几条门关着时，编辑器块 / 上传列表 / 错误与提示都不该出现 ——
      // 与后面两条"开门"用例成对，钉住"门"本身（只钉开门侧的话，"把门拆掉、永远画编辑器"也会绿）。
      rejectClasses: ['we-picker__editor', 'we-picker__uploads-list', 'we-picker__error', 'we-picker__note',
        // 第 3 门（属性/实时）关着时：没有错误行、也没有 `is-on` 的属性按钮。
        'we-picker__current-error', 'we-picker__btn is-on'],
      ctx: (sel) => Object.assign({
        setSetting: noop, setTransient: noop, setPickerOpener: noop,
        INTERVALS: [5, 10, 30, 60], armedConfirm: '', cdMode: '', current: sel,
        editing: null, editorPageView: '', group: null, groups: [], isLiveScene: false,
        pagerRow: () => null, playableCount: 0, playableList: [], playbackLive: false,
        propsPanelOpen: false, renderUserPropsPanel: () => null, sel, uploadedList: [],
      }, withHandlers(['onArmConfirm', 'onArmDeleteGroup', 'onCancelEditUploadDir',
        'onCancelEditWeAssetsDir', 'onClear', 'onDeleteGroup', 'onDisarmConfirm', 'onEditInterval',
        'onEditName', 'onEditOrder', 'onGroupChange', 'onGroupInterval', 'onOpenPicker',
        'onOpenPickerDraft', 'onRefresh', 'onStartEditUploadDir', 'onStartEditWeAssetsDir',
        'onSwitchTransition', 'onSwitchTransitionDir', 'onSwitchTransitionSpeed', 'onToggleAudio',
        'onTogglePlay', 'onTogglePropsPanel', 'onToggleRotation', 'onUploadDirDraft',
        'onWeAssetsDirDraft'])),
    },
    {
      // 第 1 门：**轮播编辑器**。此前这一档（149 行）在最小替身下只渲染出「自动转轮」一个标签 ——
      // `groups` / `group` / `editing` / `armedConfirm` 全关着。开门才能让编辑器那几十行进入判据。
      fn: 'renderWallpaperTab',
      label: '（轮播编辑器打开）',
      mk: () => st,
      ctxOver: {
        groups: [{ id: 'g1', name: 'A 组', wallpaperIds: ['w1'], interval: 10, order: 'sequence' }],
        group: { id: 'g1', name: 'A 组', wallpaperIds: ['w1'], interval: 10, order: 'sequence' },
        editing: { name: 'A 组', interval: 10, order: 'sequence', wallpaperIds: ['w1'] },
        armedConfirm: 'group:g1',
      },
      want: ['当前壁纸', '切换过场', '自动轮播', '自定义壁纸'],
      // 这一档**不设** `wantLabels`：实测标签锚对它完全盲（编辑器是裸 input/select/span 拼的，
      // 开满四门后标签仍是那 3 个）—— 该档由下面的类名锚负责。
      // ⚠️ 实测：`labelSeq` 对这一段是**盲的** —— 编辑器是裸 `<input>` / `<select>` / `<span>` 拼的，
      // 把四个门全打开后标签仍是原来那 3 个。类名锚才看得见：多出 `we-picker__editor` + `we-picker__text`。
      wantClasses: ['we-picker__editor', 'we-picker__text'],
    },
    {
      // 第 2 门：**上传与资源路径编辑器**。门是 `uploadedList` 非空 + 两个编辑态 + 错误/提示两条；
      // 全都是**裸 input/div**（不经过 SliderRow/switchRow/ctlText）⇒ 同样由类名锚负责。
      fn: 'renderWallpaperTab',
      label: '（上传与路径编辑器打开）',
      mk: () => Object.assign({}, st, {
        editingUploadDir: true, uploadDirDraft: 'D:/uploads',
        editingWeAssetsDir: true, weAssetsDirDraft: 'E:/we',
        weAssetsError: '该目录不可写', uploadError: '上传失败', uploadNote: '已就绪',
      }),
      ctxOver: { uploadedList: [{ id: 'u1', title: '上传的壁纸' }] },
      want: ['当前壁纸', '切换过场', '自动轮播', '自定义壁纸'],
      wantClasses: ['we-picker__uploads', 'we-picker__uploads-path', 'we-picker__uploads-list',
        'we-picker__uploads-item', 'we-picker__uploads-name', 'we-picker__file',
        'we-picker__error', 'we-picker__note'],
    },
    {
      // 第 3 门：**当前壁纸节的属性与实时那一半**。门：`current.type = scene|web` + `sel.propsUrl`
      // （属性按钮）· `propsPanelOpen`（按钮 `is-on` + 面板）· `sel.videoError`/`blockedNote`（错误行）。
      fn: 'renderWallpaperTab',
      label: '（场景壁纸 + 属性面板打开）',
      mk: () => Object.assign({}, st, {
        type: 'scene', videoError: '解码失败', blockedNote: '内容受限',
      }),
      ctxOver: {
        current: { type: 'scene', title: '场景名' },
        isLiveScene: true,
        propsPanelOpen: true,
        renderUserPropsPanel: () => REACT.createElement('div', { className: 'stub-props-panel' }, 'props'),
      },
      want: ['当前壁纸', '切换过场', '自动轮播', '自定义壁纸'],
      wantClasses: ['we-picker__current', 'we-picker__current-info', 'we-picker__current-title',
        'we-picker__current-error', 'we-picker__btn is-on', 'stub-props-panel'],
    },
    {
      // 视频壁纸：「实时渲染诊断」**按门不画**（它只对能走实时渲染的场景 / 网页显示）。
      fn: 'renderAdvancedTab',
      label: '（视频壁纸：诊断节按门不画）',
      mk: () => st,
      want: ['浏览方式', '兼容性', '适配', '省电'],
      wantLabels: ['紧凑布局', 'Edge 兼容', '适配目标', '最小化/切页时暂停', '使用电池时暂停'],
      adv: true,
    },
    {
      // 场景壁纸：诊断节出现，且**在最后**。
      fn: 'renderAdvancedTab',
      label: '（场景壁纸：诊断节出现且在最后）',
      mk: () => Object.assign({}, st, { type: 'scene', sceneLive: true, sceneLiveSrc: '/x' }),
      want: ['浏览方式', '兼容性', '适配', '省电', '实时渲染诊断'],
      wantLabels: ['紧凑布局', 'Edge 兼容', '适配目标', '最小化/切页时暂停', '使用电池时暂停', 'live 诊断日志'],
      adv: true,
    },
  ];
  const advCtx = (sel) => Object.assign({ setSetting: noop, setTransient: noop, sel },
    withHandlers(['onAdapterTarget', 'onEdgeCompatChange', 'onLayoutChange', 'onPauseOnBattery',
      'onPauseOnBlur', 'onPauseOnHidden', 'onToggleLiveDiag']));
  for (const t of CASES) {
    const sel = t.mk();
    let tree = null;
    let err = '';
    // `ctxOver` 让一个用例把门**打开**（`groups` / `editing` / `uploadedList` … 默认全关着，
    // 于是那些分支从没被渲染过 —— 这一档就是为了让它们第一次进入判据的视野）。
    // 只给 `ctxOver` 的用例复用**第一条**（墙纸档）的 ctx 构造器：同一批处理器，只是门开着。
    const buildCtx = t.ctx || CASES[0].ctx;
    try { tree = panelMod[t.fn](t.adv ? advCtx(sel) : Object.assign(buildCtx(sel), t.ctxOver || {})); } catch (e) { err = String((e && e.message) || e); }
    // ① 渲染得出（缺 ctx 字段 / 缺全局替身都会在这里响亮地炸）
    check(t.fn + t.label + ' 渲染得出（真渲染器 + 最小替身）', err === '', err || 'ok');
    if (err) continue;
    // ② 节**有序**且一节不多不少 —— 这是纯搬动唯一会破坏的东西
    const seq = sectionSeq(tree);
    if (t.want) {
      check(t.fn + t.label + ' 的节顺序与集合逐字不变', sameSeq(seq, t.want),
        'want=[' + t.want.join(' / ') + '] got=[' + seq.join(' / ') + ']');
    }
    if (t.wantLabels) {
      const labels = labelSeq(tree);
      check(t.fn + t.label + ' 的控件标签顺序与集合逐字不变', sameSeq(labels, t.wantLabels),
        'want=[' + t.wantLabels.join(' / ') + '] got=[' + labels.join(' / ') + ']');
      // ── 简化配置 vs 复杂配置的**边界**（wip §3.4 / §10.22）────────────────────
      // 规划口径：「独立配置」层是**逐面覆盖全局**的高级动作 ⇒ 只出现在设置菜单那一档；
      // 简化配置（侧栏档）只留全局四件套。实测它曾同时出现在两档（用户看到侧边栏里
      // 也有那三个开关）—— 夹具改对只是"碰巧对"，所以这条规则单独判一次。
      // ⚠️ 只对**带「玻璃 UI」节**的页签判（其它页签本来就没有独立配置层）。
      const indep = labels.filter((l) => l.includes('独立配置'));
      if ((t.want || []).includes('玻璃 UI')) {
        if (t.surface === 'sidebar') {
          check(t.fn + ' 简化配置（侧栏档）里不许出现「独立配置」层',
            indep.length === 0, indep.length ? '泄漏：' + indep.join(' / ') : '0 个');
        } else {
          check(t.fn + ' 复杂配置（设置档）里**必须**有「独立配置」层',
            indep.length >= 1, indep.length + ' 个：' + indep.join(' / '));
        }
      }
    }
    // 类名锚：`wantClasses` 是**子串**判定（构件名常带修饰类，如 `we-picker__btn --primary`）——
    // 它认的是"这一段画出来了没有"，正是 `labelSeq` 对**裸 input/select** 的盲区。
    if (t.wantClasses) {
      const kinds = classKinds(tree);
      const missing = t.wantClasses.filter((c) => !kinds.some((k) => k.includes(c)));
      check(t.fn + t.label + ' 画出了该档应有的控件种类（类名锚）', missing.length === 0,
        'want⊆got? 缺=[' + missing.join(', ') + '] got=' + kinds.length + ' 种');
    }
    // 门的**另一侧**：这一档**不该**出现的构件（如"编辑器没打开时不该有 `we-picker__editor`"）。
    // 门的两个方向都钉住，才不是"只要画得多就算过"。
    if (t.rejectClasses) {
      const kinds = classKinds(tree);
      const present = t.rejectClasses.filter((c) => kinds.some((k) => k.includes(c)));
      check(t.fn + t.label + ' 不该出现的构件一个都没画（门的另一侧）', present.length === 0,
        '多出=[' + present.join(', ') + ']');
    }
    if (process.env.DSH_WE_SHOW_LABELS) {
      console.log('    LABELS ' + t.fn + t.label + ' = ' + JSON.stringify(labelSeq(tree)));
      console.log('    CLASSES ' + t.fn + t.label + ' (' + classKinds(tree).length + ') = '
        + JSON.stringify(classKinds(tree).filter((c) => /editor|playlist|rotation|text|select|hint/.test(c))));
    }
  }
  // 负对照：同一个比较器对"顺序被换 / 少一节 / 多一节"都必须判坏（否则上面两条可能是恒真）。
  // ── 守卫的守卫：判据**缺守卫时是"崩"而不是"判红"**，比判红更隐蔽 ──────────────
  // 实测过：ctx 驱动那个循环的标签检查漏了 `if (t.wantLabels)`，而有一条用例改用类名锚、
  // 压根没有 `wantLabels` ⇒ `sameSeq(labels, undefined)` 当场抛，整个守卫**一条结论都没留下**
  // （比"红"更糟：红至少留下了"哪一条不成立"）。这条把"每个 `sameSeq(x, t.<field>)` 都必须被
  // `if (t.<field>)` 包住"钉成静态事实。
  {
    // 只扫**本判据之前**的代码：负对照里的示例字符串也在源码里，扫全文件会把它们当代码。
    const MARK = '每个 sameSeq 的期望值都被';
    const src = stripComments(readFileSync(new URL(import.meta.url), "utf8"));
    const head = src.slice(0, src.indexOf(MARK));
    const unguarded = (text) => {
      const ls = text.split("\n"); const out = [];
      ls.forEach((l, i) => {
        const m = /sameSeq\([^,]+,\s*(t\.\w+)\)/.exec(l);
        if (!m) return;
        const win = ls.slice(Math.max(0, i - 4), i).join(" ");
        if (!win.includes("if (" + m[1] + ")")) out.push("L" + (i + 1) + ":" + m[1]);
      });
      return out;
    };
    const bad = unguarded(head);
    check('每个 sameSeq 的期望值都被 `if (t.<field>)` 守卫（缺守卫 ⇒ 崩而非判红，一条结论都不留）',
      bad.length === 0, bad.join(', ') || '全部已守卫');
    check('negative control: 缺 if 守卫的 sameSeq 会被同一条判据判出',
      unguarded('const a = sameSeq(x, t.wantLabels);').length === 1
      && unguarded(['if (t.wantLabels) {', '  const a = sameSeq(x, t.wantLabels);', '}'].join(String.fromCharCode(10))).length === 0);
    // 同一件事的**另一半**：三条锚的调用（`labelSeq` / `classKinds` / `textKinds`）也必须被
    // `if (t.<field>)` 包住 —— 否则那条判据要么恒真、要么在缺期望时崩。
    // （`DSH_WE_SHOW_LABELS` 那几行是**探查用 dump**，不是判据，跳过。）
    const unguardedAnchors = (text) => {
      const ls = text.split("\n"); const out = [];
      ls.forEach((l, i) => {
        if (!/=\s*(labelSeq|classKinds|textKinds)\(tree\)/.test(l)) return;
        const win = ls.slice(Math.max(0, i - 5), i + 1).join(" ");
        if (win.includes("DSH_WE_SHOW_LABELS")) return;
        if (!/if \(t\./.test(win)) out.push("L" + (i + 1) + ":" + l.trim().slice(0, 44));
      });
      return out;
    };
    const badAnchors = unguardedAnchors(head);
    check('三条锚的调用都被 `if (t.<field>)` 包住（否则判据恒真或缺期望时崩）',
      badAnchors.length === 0, badAnchors.join(' | ') || '全部已守卫');
    check('negative control: 未守卫的锚调用会被同一条判据判出',
      unguardedAnchors('const labels = labelSeq(tree);').length === 1
      && unguardedAnchors(['if (t.wantLabels) {', '  const labels = labelSeq(tree);', '}'].join(String.fromCharCode(10))).length === 0);
  }

  // ── 覆盖面地板（本轮实测的静默失败就是它要防的）─────────────────────────────
  // 一次补丁把新用例插进了上一条的 `ctx:` 构造器里 —— **语法合法、却从没被迭代到**，于是判据一条
  // 都没加而整个套件照旧全绿（当时靠"通过数没动"才发现）。用例没进数组 / 被改名 / 被注释掉都属于
  // 这一类：**静默少跑**。地板把"少跑"变成红。（带标签期望的条数单独设下限：那是细锚的覆盖面。）
  check('覆盖面：渲染用例数 ≥ 4 且其中带控件标签期望的 ≥ 3（用例静默没进数组即红）',
    CASES.length >= 4 && CASES.filter((c) => c.wantLabels).length >= 3,
    'cases=' + CASES.length + ' withLabels=' + CASES.filter((c) => c.wantLabels).length);
  check('negative control: 空数组 / 缺标签期望会被同一条地板判出',
    !([].length >= 4) && !([{ wantLabels: [] }, {}, {}, {}].filter((c) => c.wantLabels).length >= 3));

  // ── 类名锚的**正/负对照**（目标 ④：新守卫必须带负对照）─────────────────────
  // 类名锚的判定是"子串 + 子集"，两个方向都可能恒真：恒真一 = 集合里总有它；恒真二 = 子集判空。
  // 这里对**合成树**各验一次，并补一条"空树不会让判据恒真"。
  {
    const kindsOf = (tree0) => classKinds(tree0);
    const has = (kinds, c) => kinds.some((k) => k.includes(c));
    const editorTree = [{ props: { className: 'we-picker__editor' }, children: [] }];
    const multi = [
      { props: { className: 'we-picker__uploads' }, children: [
        { props: { className: 'we-picker__uploads-list' }, children: [] },
      ] },
    ];
    check('正对照：类名锚认得出该有的构件（含子串判定）',
      has(kindsOf(editorTree), 'we-picker__editor') && kindsOf(editorTree).length === 1);
    check('正对照：嵌套树的类名也收得到（不是只看顶层）',
      has(kindsOf(multi), 'we-picker__uploads') && has(kindsOf(multi), 'we-picker__uploads-list'));
    check('negative control: 缺构件会被 `wantClasses` 那一条判出来',
      ['we-picker__editor', 'we-picker__uploads-list'].filter((c) => !has(kindsOf(editorTree), c)).length === 1);
    check('negative control: 多出不该有的构件会被 `rejectClasses` 那一条判出来',
      ['we-picker__editor'].filter((c) => has(kindsOf(multi), c)).length === 0
      && ['we-picker__uploads'].filter((c) => has(kindsOf(multi), c)).length === 1);
    check('negative control: 空树 / 无 className 的树不会让两条判据恒真',
      kindsOf([]).length === 0 && kindsOf([{ props: {}, children: [] }]).length === 0);
  }

  check('负对照：节顺序判据对换序 / 缺节 / 多节都有牙',
    sameSeq(['甲', '乙'], ['甲', '乙'])
    && !sameSeq(['乙', '甲'], ['甲', '乙'])
    && !sameSeq(['甲'], ['甲', '乙'])
    && !sameSeq(['甲', '乙', '丙'], ['甲', '乙']));
  check('负对照：节抽取只认 section-label 节点（旁边普通文本不得被当节）',
    sectionSeq({ props: { className: 'we-picker__ctl' }, children: ['当前壁纸'] }).length === 0
    && sectionSeq({ props: { className: 'we-picker__section-label' }, children: ['当前壁纸'] }).length === 1);

  // ── appearance / effects：同一套挂载台（ctx 由**渲染器自己的解构行**驱动）────────
  // 这两页签的节顺序此前也没有判据（`verify-fontset` 只判"某串在场"，`renderEffectsTab`
  // 甚至只有一个节标签）。补上之后，它们才具备"按节拆成子渲染器"的安全网（P4-19 余项）。
  const ctxFieldsOf = (fnName) => {
    const at = tabsSrcNow.indexOf('function ' + fnName + '(ctx) {');
    const dm = /const \{([^}]*)\} = ctx;/.exec(tabsSrcNow.slice(at, at + 4000));
    return dm ? dm[1].split(',').map((s) => s.trim().split(':')[0].trim()).filter(Boolean) : [];
  };
  // 解构行里除少数几个"值形状"（fontSet / surface / sel）外全是处理器 ⇒ 其余一律 noop。
  // ⚠️ 必须收**这个页签 + 它的节函数**的字段并集：P4-19 之后 `render*Tab` 自己只解构 `{ }`，
  // 只读那一层会得到空集 ⇒ 处理器全是 undefined（此前一直没炸，只因没走到会**调用**它们的
  // 分支 —— 字体节一打开就撞上 `officialColorOf is not a function`）。
  // ⚠️ `sel` 必须**跳过**：它不在 `known` 里，若不排除就会被 noop 覆盖 ⇒ `sel.id` 变 undefined
  // ⇒ 效果页签走上"还没有启用壁纸"的**空态提前返回**，节判据于是拿到空树而"照旧报"。
  const allCtxFieldsOf = (fnName) => {
    const domain = fnName.replace(/^render/, '').replace(/Tab$/, '');
    const secs = [...tabsSrcNow.matchAll(new RegExp('function (render' + domain + '\\w*Section)\\(ctx\\)', 'g'))]
      .map((m) => m[1]);
    return [fnName, ...secs].flatMap((n) => ctxFieldsOf(n) || []);
  };
  const ctxFrom = (fnName, sel, known) => {
    const c = { sel };
    for (const n of allCtxFieldsOf(fnName)) if (n !== 'sel' && !(n in known)) c[n] = noop;
    return Object.assign(c, known);
  };
  const FONTSET_STUB = {
    open: true, fontSets: [], activeId: '', loading: false, error: '', editingId: '', draftName: '',
    exportUrl: () => '', onOpen: noop, onActivate: noop, onRefresh: noop, onDelete: noop, onEdit: noop,
    onDraftName: noop, onRenameCommit: noop, onCancelEdit: noop, onCreate: noop,
  };
  const MORE_CASES = [
    { fn: 'renderAppearanceTab', label: '（设置页：五节）', surface: 'settings',
      // 玻璃四件套 + 雾化已归入新节「玻璃 UI」；「左侧栏覆盖」归入「细节」，
      // 它的「独立配置」紧挂在它下方（用户口径：两者耦合）。
      // ⚠️ 本批（wip §10.20）起这一节**只剩一层**：「子 UI 玻璃」总开关与每个子面的
      // 「要不要玻璃」开关都已退役（那个"关"并不能如愿回到原生纯色）⇒ 每个子面**直接**
      // 一个「独立配置」。同时「设置窗口液态玻璃」退役（功能由「设置窗口玻璃·独立配置」接管）。
      // ⚠️ `selOver` 打开宿主能力位：`sidebarPresent` + `sidebarGlass` 之后，侧栏家族与内容面
      // 那几行才画得出来（`sidebarPresent` 为假时它们整段不渲染 —— 这正是"窗口与侧栏"那节
      // 在没装 dsh-better-sidebar 的机器上只剩空标题的原因，§10.25 因此把它并进了「玻璃 UI」）。
      selOver: { sidebarPresent: true, sidebarGlass: true },
      want: ['主题', '细节', '玻璃 UI', '全局字体', '输入光标'],
      wantLabels: ['主题随壁纸', '边框', '玻璃透明度', '雾化', '玻璃保真度', '左侧栏覆盖', '侧栏液态玻璃', '侧栏玻璃·独立配置', '内容面玻璃·独立配置', '设置窗口玻璃·独立配置', '对话框玻璃·独立配置', '思考触发条玻璃·独立配置', '浮层玻璃·独立配置', '字体自定义'] },
    // 侧栏档：被 `!sidebarSurface` 包住的两节不画 —— 这条门此前只有源码串，没有行为断言。
    // ⚠️ 「独立配置」层属**复杂配置** ⇒ 侧栏档不画（见下面那条"边界"判据，§10.22）。
    // ⚠️ §10.25：`左侧栏覆盖` 已从「细节」移入「玻璃 UI」⇒ 它在序列里的位置随节顺序前移。
    { fn: 'renderAppearanceTab', label: '（侧栏档：设置页专属的两节不画）', surface: 'sidebar',
      want: ['主题', '细节', '玻璃 UI'],
      wantLabels: ['主题随壁纸', '边框', '玻璃透明度', '雾化', '玻璃保真度', '左侧栏覆盖'] },
    // 效果页**只有一个节标签** ⇒ 节顺序钉不住它的内部结构。这里用**控件标签的有序序列**作细锚：
    // 它同样是行为级的（对任何重构不变），却细到能看见"某一行的位置被挪了 / 被删了"。
    { fn: 'renderEffectsTab', label: '（画面 · 设置页）', surface: 'settings', want: ['画面'],
      wantLabels: ['壁纸模糊', '亮度', '对比度', '饱和度', '壁纸透明度', '暗化', '倍速', '帧率上限', '适配', '水平翻转'] },
    { fn: 'renderEffectsTab', label: '（画面 · 侧栏档）', surface: 'sidebar', want: ['画面'],
      wantLabels: ['壁纸模糊', '亮度', '对比度', '饱和度', '壁纸透明度', '暗化', '倍速', '适配', '水平翻转'] },
    // 第 4 门：**效果页的实时渲染组**（`sel.type` 为场景/网页时才画；视频档一个都不出）。
    // 这一组的标签走 `switchRow` / `ctlText` ⇒ **标签锚这次看得见**（与墙纸档的门后裸控件不同）。
    { fn: 'renderEffectsTab', label: '（画面 · 场景壁纸：实时渲染组出现）', surface: 'settings',
      selOver: { type: 'scene', sceneLive: true, sceneFrameUrl: '/f.png', sceneLiveSrc: '/x' },
      want: ['画面'],
      // 实测：13 个标签 —— 比网页档多的两个（`出图来源` / `自定义画面`）正是**场景专属**那两行
      // （网页壁纸没有"出图来源"这一说）。标签锚是**精确序列**判定 ⇒ 两个方向都钉住了。
      wantLabels: ['壁纸模糊', '亮度', '对比度', '饱和度', '壁纸透明度', '暗化', '场景实时渲染',
        '启动最长等待时间', '实时渲染帧率', '出图来源', '自定义画面', '适配', '水平翻转'] },
    { fn: 'renderEffectsTab', label: '（画面 · 网页壁纸：实时渲染组出现）', surface: 'settings',
      selOver: { type: 'web', webLive: true, webLiveSrc: '/x' },
      want: ['画面'],
      wantLabels: ['壁纸模糊', '亮度', '对比度', '饱和度', '壁纸透明度', '暗化', '网页实时渲染',
        '启动最长等待时间', '实时渲染帧率', '适配', '水平翻转'] },
    // 目标③ 余项 1：「实时帧」那一段（门 = gpuFrameUi.wid === sel.id && pinned —— 这一张壁纸的槽里真有帧）。
    // 它有几行随 w/h/error/recapturing/busy 显隐的分支，全在模块级替身里，故用 globals。
    { fn: 'renderEffectsTab', label: '（画面 · 场景壁纸 + 本壁纸已固定实时帧）', surface: 'settings',
      selOver: { type: 'scene', sceneLive: true, sceneFrameUrl: '/f.png', sceneLiveSrc: '/x', id: 'w1' },
      globals: { gpuFrameUi: { wid: 'w1', pinned: true, w: 1920, h: 1080, busy: false, recapturing: false, error: '' } },
      want: ['画面'],
      // 实测 14 个：门打开后多出 `实时帧`（正好夹在 `出图来源` 与 `自定义画面` 之间）。
      wantLabels: ['壁纸模糊', '亮度', '对比度', '饱和度', '壁纸透明度', '暗化', '场景实时渲染',
        '启动最长等待时间', '实时渲染帧率', '出图来源', '实时帧', '自定义画面', '适配', '水平翻转'] },
    // 目标③ 余项 2：转码进度行的 done 态（另一态由「进行中」覆盖）。
    { fn: 'renderEffectsTab', label: '（画面 · 转码进度 done）', surface: 'settings',
      selOver: { type: 'video', transcodeState: 'working', transcodeProgress: { phase: 'done', percent: 100 } },
      want: ['画面'],
      // 进度行是**裸 div**（`we-picker__prog*`）⇒ 标签锚看不见，改由类名锚钉住（下面两档共用）。
      wantClasses: ['we-picker__prog', 'we-picker__prog-track', 'we-picker__prog-bar'],
      // 文本锚补的正是类名锚的盲区：这一行的**五个分支只差文案**（构件完全一样）。
      wantTexts: ['即将完成…'], },
    // 转码进度行的**进行中**态（`phase: "download"`）—— 与上面的 done 态**只差文案**（构件相同），
    // 故由**文本锚**钉住（`weT` 在挂载台里是身份层、占位符照插 ⇒ 期望串就是面板上那一串）。
    { fn: 'renderEffectsTab', label: '（画面 · 转码进度 download 42%）', surface: 'settings',
      selOver: { type: 'video', transcodeState: 'working', transcodeProgress: { phase: 'download', percent: 42 } },
      want: ['画面'],
      wantClasses: ['we-picker__prog-bar'],
      wantTexts: ['下载 ffmpeg 42%'] },
    // 转码收尾中（`phase: "transcode"` + `finalizing`）—— 同样只差文案，由文本锚钉住。
    { fn: 'renderEffectsTab', label: '（画面 · 转码进度 transcode 收尾中）', surface: 'settings',
      selOver: { type: 'video', transcodeState: 'working', transcodeProgress: { phase: 'transcode', percent: 96, finalizing: true } },
      want: ['画面'],
      wantTexts: ['收尾中…'] },
    // 转码进行中（不带 finalizing）：文案含 `{percent}`/`{eta}` 两个插值 ⇒ 只断言构件已画出
    // （分支确实被走到），文案留给上面的两档钉 —— 不猜插值结果。
    { fn: 'renderEffectsTab', label: '（画面 · 转码进度 transcode 进行中）', surface: 'settings',
      selOver: { type: 'video', transcodeState: 'working', transcodeProgress: { phase: 'transcode', percent: 66, eta: '' } },
      want: ['画面'],
      wantClasses: ['we-picker__prog', 'we-picker__prog-bar'] },
    // `gpuFrameUi` 的三态：错误提示行 + 两个按钮的进行中文案（都住在模块级替身里 ⇒ 用 globals）。
    { fn: 'renderEffectsTab', label: '（画面 · 抓帧出错 + 两态进行中）', surface: 'settings',
      selOver: { type: 'scene', sceneLive: true, sceneFrameUrl: '/f.png', sceneLiveSrc: '/x', id: 'w1' },
      globals: { gpuFrameUi: { wid: 'w1', pinned: true, w: 1920, h: 1080, busy: true, recapturing: true, error: '抓帧失败：超时' } },
      want: ['画面'],
      wantClasses: ['we-picker__hint'],
      wantTexts: ['抓帧失败：超时', '抓帧中…', '清除中…'] },
  ];
  for (const t of MORE_CASES) {
    const known = { surface: t.surface, fontSet: t.surface === 'sidebar' ? undefined : FONTSET_STUB };
    const sel = t.selOver ? Object.assign({}, st, t.selOver) : st;
    // `globals`：有些门住在**模块级替身**里（如 `gpuFrameUi.pinned` 决定"实时帧"那一段画不画），
    // 既不在 ctx 也不在 sel ⇒ 用例临时改写它，**渲染完立刻还原**（含 `continue` 那条路径，
    // 否则会串到后面的用例上）。
    const savedGlobals = t.globals ? Object.keys(t.globals).map((k) => [k, globalThis[k]]) : [];
    if (t.globals) Object.assign(globalThis, t.globals);
    let tree = null;
    let err = '';
    try { tree = panelMod[t.fn](ctxFrom(t.fn, sel, known)); } catch (e) { err = String((e && e.message) || e); }
    for (const [k, v] of savedGlobals) globalThis[k] = v;
    check(t.fn + t.label + ' 渲染得出', err === '', err || 'ok');
    if (err) continue;
    const seq = sectionSeq(tree);
    if (t.want) {
      check(t.fn + t.label + ' 的节顺序与集合逐字不变', sameSeq(seq, t.want),
        'want=[' + t.want.join(' / ') + '] got=[' + seq.join(' / ') + ']');
    }
    // 细锚：**控件标签的有序序列**（`renderEffectsTab` 只有一个节标签，靠这条才钉得住内部结构）。
    // 用类名锚的档（如转码进度：裸 div 拼的）**不设** `wantLabels` ⇒ 这条必须守卫，
    // 否则 `sameSeq(labels, undefined)` 会当场崩，而不是判红（崩了就没有那条结论）。
    if (t.wantLabels) {
      const labels = labelSeq(tree);
      check(t.fn + t.label + ' 的控件标签顺序与集合逐字不变',
        sameSeq(labels, t.wantLabels),
        'want=[' + t.wantLabels.join(' / ') + '] got=[' + labels.join(' / ') + ']');
    }
    if (t.wantTexts) {
      const texts = textKinds(tree);
      const missingTexts = t.wantTexts.filter((s0) => !texts.includes(s0));
      check(t.fn + t.label + ' 渲染出了该档应有的文案（文本锚）', missingTexts.length === 0,
        '缺=[' + missingTexts.join(' | ') + '] 共 ' + texts.length + ' 条字符串');
    }
    if (t.wantClasses) {
      const kinds = classKinds(tree);
      const missing = t.wantClasses.filter((c) => !kinds.some((k) => k.includes(c)));
      check(t.fn + t.label + ' 画出了该档应有的控件种类（类名锚）', missing.length === 0,
        'want⊆got? 缺=[' + missing.join(', ') + '] got=' + kinds.length + ' 种');
    }
    if (t.rejectClasses) {
      const kinds = classKinds(tree);
      const present = t.rejectClasses.filter((c) => kinds.some((k) => k.includes(c)));
      check(t.fn + t.label + ' 不该出现的构件一个都没画（门的另一侧）', present.length === 0,
        '多出=[' + present.join(', ') + ']');
    }
    if (process.env.DSH_WE_SHOW_LABELS) {
      const all = [];
      (function walk(n) {
        if (Array.isArray(n)) { n.forEach(walk); return; }
        if (!n || typeof n !== 'object') return;
        if (Array.isArray(n.children)) { for (const c of n.children) if (typeof c === 'string') all.push(c); }
        if (Array.isArray(n.children)) n.children.forEach(walk);
      })(tree);
      console.log('    LABELS ' + t.fn + t.label + ' = ' + JSON.stringify(labels));
      console.log('    STRINGS(' + all.length + ') hasFontPreset=' + all.some((s) => s.includes('字体集预设'))
        + ' hasRole=' + all.some((s) => s.includes('角色')) + ' sample=' + JSON.stringify(all.slice(0, 14)));
    }
  }
  // 负对照：上面这条"侧栏档少两节"必须真的来自门，而不是来自"侧栏档根本没渲染"。
  check('覆盖面：ctx 驱动的用例数 ≥ 5 且全部带控件标签期望（MORE_CASES 循环之后 —— 定义在它之前会撞 TDZ）',
    MORE_CASES.length >= 5 && MORE_CASES.filter((c) => c.wantLabels).length >= 5,
    'cases=' + MORE_CASES.length + ' withLabels=' + MORE_CASES.filter((c) => c.wantLabels).length);
  check('覆盖面：每个渲染用例都必须声明 `want`（关掉上面那条守卫空转的可能）',
    [...CASES, ...MORE_CASES].every((c) => Array.isArray(c.want) && c.want.length > 0),
    'cases=' + (CASES.length + MORE_CASES.length));
  // 锚体系的**覆盖面地板**：三种锚都必须被真的用上 —— 否则它们会被逐渐掏空
  // （新用例都用最省事的那种锚，另两种慢慢没人用，而"没人用"不会自己变红）。
  {
    const all = [...CASES, ...MORE_CASES];
    const nLabels = all.filter((c) => c.wantLabels).length;
    const nClasses = all.filter((c) => c.wantClasses || c.rejectClasses).length;
    const nTexts = all.filter((c) => c.wantTexts).length;
    check('覆盖面：三种锚都被真的用上（标签 ≥ 6 · 类名 ≥ 4 · 文本 ≥ 2）',
      nLabels >= 6 && nClasses >= 4 && nTexts >= 2,
      'labels=' + nLabels + ' classes=' + nClasses + ' texts=' + nTexts + ' cases=' + all.length);
    check('negative control: 只堆一种锚会被同一条地板判出',
      !([{ wantLabels: [] }, { wantLabels: [] }, { wantLabels: [] }, { wantLabels: [] },
        { wantLabels: [] }, { wantLabels: [] }].filter((c) => c.wantClasses).length >= 4));
  }

  check('负对照：外观页侧栏档确实渲染出了内容（不是空树 ⇒ 上面的"少三节"才有意义）',
    (() => {
      // 侧栏档画「主题 / 细节 / 玻璃 UI」三节 —— 比设置页少「全局字体 / 输入光标」。
      // ⚠️ 这个数字是**随节数变化**的：新增一节就要同步（它自己就是"少几节"那条判据的负对照）。
      try { return sectionSeq(panelMod.renderAppearanceTab(ctxFrom('renderAppearanceTab', st,
        { surface: 'sidebar', fontSet: undefined }))).length === 3; } catch { return false; }
    })());

  // ── 拆成"一节一个子渲染器"之后新增的失败模式：**节用了某个 ctx 字段却没解构它** ──
  // 这类错误的形状是"某个分支一旦被执行就 ReferenceError"，而渲染挂载台只在**走到的分支**上
  // 才撞得见它（本次实测正是这么抓到一处：`...INTERVALS.map(...)` 的展开写法让派生正则漏了它）。
  // 所以再补一条**静态**判据把它按在源码层：以"这个页签的 ctx 字段全集"为词表，逐个节函数检查
  // "用到了却没解构"。先剥注释（规则 ⑦），否则散文里的词会假报。
  const CTX_UNIVERSE = {
    renderWallpaperTab: ['setSetting', 'setTransient', 'INTERVALS', 'armedConfirm', 'cdMode', 'current',
      'editing', 'editorPageView', 'group', 'groups', 'isLiveScene', 'onArmConfirm', 'onArmDeleteGroup',
      'onCancelEditUploadDir', 'onCancelEditWeAssetsDir', 'onClear', 'onDeleteGroup', 'onDisarmConfirm',
      'onEditInterval', 'onEditName', 'onEditOrder', 'onGroupChange', 'onGroupInterval', 'onOpenPicker',
      'onOpenPickerDraft', 'onRefresh', 'onStartEditUploadDir', 'onStartEditWeAssetsDir',
      'onSwitchTransition', 'onSwitchTransitionDir', 'onSwitchTransitionSpeed', 'onToggleAudio',
      'onTogglePlay', 'onTogglePropsPanel', 'onToggleRotation', 'onUploadDirDraft', 'onWeAssetsDirDraft',
      'pagerRow', 'playableCount', 'playableList', 'playbackLive', 'propsPanelOpen',
      'renderUserPropsPanel', 'sel', 'setPickerOpener', 'uploadedList'],
    renderAdvancedTab: ['setSetting', 'onAdapterTarget', 'onEdgeCompatChange', 'onLayoutChange',
      'onPauseOnBattery', 'onPauseOnBlur', 'onPauseOnHidden', 'onToggleLiveDiag', 'sel'],
    renderAppearanceTab: ['setSetting', 'officialColorOf', 'onAccent', 'onBlur', 'onBorder',
      'onCaretColor', 'onChatGlassFidelity', 'onComponentFamily', 'onComponentFont', 'onFontAdvanced', 'onFontResetAll',
      'onGlassAlpha', 'onGlassColor', 'onGlassFidelity', 'onGlassWindow', 'onLeftSidebarGlass', 'onSidebarAlpha',
      'onSidebarBlur', 'onSidebarColor', 'onSidebarContentAlpha', 'onSidebarContentColor',
      'onSidebarGlass', 'onThemeColor', 'onThemeColorClear', 'onThemeDarkSeparate', 'onThemeFamily',
      'onThemeSize', 'onThemeTypeOnly', 'onThemeWeight', 'onToggleFontCustom', 'onToggleThemeFollow',
      'fontSet', 'sel', 'surface'],
  };
  // ⚠️ `tabsSrcNow` 在本块顶部声明（归一成 LF）—— 这里不再重复声明。
  /** 某页签的节函数（`render<Domain>…Section`）—— 拆分后的每一节。 */
  const sectionFnsOf = (domain) => {
    const out = [];
    const re = new RegExp('^  function (render' + domain + '\\w*Section)\\(ctx\\) \\{$', 'gm');
    for (const m of tabsSrcNow.matchAll(re)) {
      const to = tabsSrcNow.indexOf('\n  }\n', m.index);
      out.push({ name: m[1], body: tabsSrcNow.slice(m.index, to < 0 ? tabsSrcNow.length : to) });
    }
    return out;
  };
  const USED = (code, n) => new RegExp('(^|[^.\\w$]|\\.\\.\\.)' + n + '\\b(?!\\s*:)').test(code);
  const missingCtx = [];
  let sectionCount = 0;
  for (const [tab, all] of Object.entries(CTX_UNIVERSE)) {
    const domain = tab.replace(/^render/, '').replace(/Tab$/, '');
    const at = tabsSrcNow.indexOf('function ' + tab + '(ctx) {');
    const body = tabsSrcNow.slice(at, tabsSrcNow.indexOf('\n  }\n', at));
    const fns = [{ name: tab, body }, ...sectionFnsOf(domain)];
    for (const f of fns) {
      if (f.name.includes('Section')) sectionCount++;
      const code = stripComments(f.body);
      const dm = /const \{([^}]*)\} = ctx;/.exec(code);
      const own = dm ? dm[1].split(',').map((s) => s.trim().split(':')[0].trim()).filter(Boolean) : [];
      for (const n of all) if (USED(code, n) && !own.includes(n)) missingCtx.push(f.name + '→' + n);
    }
  }
  check('每个节函数都用到了 ctx 字段就解构它（覆盖面 ' + sectionCount + ' 个节函数）',
    sectionCount >= 8 && missingCtx.length === 0,
    'sections=' + sectionCount + (missingCtx.length ? ' · 漏解构=' + missingCtx.join(', ') : ''));
  check('负对照：用了却没解构的节函数会被同一判据抓出',
    (() => {
      const code = stripComments('function renderXSection(ctx) {\n const { sel } = ctx;\n ...INTERVALS.map((m) => m);\n}');
      return USED(code, 'INTERVALS') && !['sel'].includes('INTERVALS');
    })());
  check('负对照：对象键形态（`{ sel: … }`）不得被误报为"用到 ctx 字段"', !USED('const o = { sel: 1 };', 'sel'));
}

// 用户口径：吉祥物**点一下要能开也能关**侧栏 —— 点击必须进统一开关；
// 恒走 openPanel/openTab 就会变成只能开不能关。
// 判据按真实源码形态：点击分支走统一开关（不残留只开的 openPanel）、官方态 toggle 的
// 收起条件（展开 + 正显示本 kind）、手势的上推=关。
{
  const ropeActivate = (text) => /!d\.moved\) wallSidebarToggle\(\)/.test(text)
    && /wallSidebarOpen\(\)/.test(text)
    && /wallSidebarClose\(\)/.test(text)
    && !/openPanel\(/.test(text);
  check('吉祥物点击 = 开/关切换（官方态能关；下拉=开、上推=关走同一组开关）',
    ropeActivate(src) && src.includes('wallSidebarToggle()'));
  check('negative control: 「只开不关」的旧形态会被同一条判据判出',
    !ropeActivate('if (!canceled && !d.moved) openPanel();'));
  check('官方态 toggle 语义：展开且正显示「壁纸」才收起（别人的 tab 不替用户关）',
    sidebarSrc.includes('function sidebarRightOursActive(')
      && sidebarSrc.includes('a.kind === WE_SIDEBAR_KIND')
      && sidebarSrc.includes('weSidebarCtrl.isExpanded()')
      && sidebarSrc.includes('weSidebarCtrl.toggleExpanded()'));
  check('抽屉桥：RopeDock 注册三动作、隐藏/卸载时撤销（快捷键与点击共用同一入口）',
    src.includes('ropeDrawerControl = {') && src.includes('toggle: () => setOpen((o) => !o)')
      && src.includes('ropeDrawerControl = null;'));
}
// 快捷键（官方桌面默认 Cmd/Ctrl+Alt+W）：注册进宿主 shortcuts 服务，命令可改键；
// 无面板可开时 resolve=pass（不吞按键）；不写进 inject（缺服务的旧宿主不该 park）。
check('壁纸侧栏快捷键：走宿主 shortcuts 服务 + 桌面三档默认 primary+alt+W + pass 兜底',
  src.includes('installWallSidebarShortcut(ctx)')
    && sidebarSrc.includes('function installWallSidebarShortcut(')
    && sidebarSrc.includes('ctx.get("shortcuts")')
    && sidebarSrc.includes('shortcuts.register({')
    && sidebarSrc.includes('"wallpaper.sidebar.toggle"')
    && sidebarSrc.includes('"desktop:macos": { code: "KeyW", modifiers: ["primary", "alt"] }')
    && sidebarSrc.includes('"desktop:windows": { code: "KeyW", modifiers: ["primary", "alt"] }')
    && sidebarSrc.includes('"desktop:linux": { code: "KeyW", modifiers: ["primary", "alt"] }')
    && sidebarSrc.includes('{ status: "pass" }'));

// 设置入口的触发钮选取：官方应用里带 aria-haspopup="dialog" 的按钮
// 有十几个（TurnUsagePanel / StatsPills / ContextMeter / 插件管理器 / 任务管理器日期时间
// 选择器…），且都在左栏「设置」之前 —— 文档序取第一个必然点错，症状就是应用里
// 「壁纸引擎设置」无反应。判据：**按可读名字挑 + 必须没有裸首个匹配回退**。
//
// ⚠️ 本判据此前还断言了 `sidebarSrc.includes('/设置|Settings/i.test')` ——
//    那是**把措辞钉进判据**（见 docs/adr/0007）：锚点后来改成 locale 感知的候选集
//    （`isSettingsText` / `settingsLabelCandidates`），旧断言就开始拦正确的修复。
//    现在只断言**机制**（有按名字过滤、有排除自家入口、有无名字兜底、有重入锁），
//    不断言锚点怎么写 —— 怎么写属于实现，措辞与候选集由约定承担。
check('设置入口按可读名字选触发钮（不再取文档序第一个 dialog 按钮）',
  sidebarSrc.includes('function findSettingsTrigger(')
    && sidebarSrc.includes('function isSettingsText(')
    && sidebarSrc.includes('const named = dialogTriggers.filter(isSettingsLabel)')
    && !/querySelector\('button\[aria-haspopup="dialog"\]'\)/.test(sidebarSrc)
    && sidebarSrc.includes('findAccountMenuTrigger') && sidebarSrc.includes('findSettingsMenuItem')
    && sidebarSrc.includes('button[aria-haspopup="menu"][data-collapsed]') // 账号菜单触发钮（AccountMenu 的确定性锚）
    && sidebarSrc.includes('cand=[')
    && sidebarSrc.includes('data-we-qp-entry') // 必须排除自己的「壁纸引擎设置 ›」入口（实测曾自误中递归）
    && sidebarSrc.includes('openSettingsBusy')); // 重入锁

// 名字匹配必须**容忍宿主给标签加的修饰**：宿主左栏那颗入口实测文本是 `全局设置`（不是裸
// `设置`），桌面壳里还有 `Global settings`。相等匹配在宿主换措辞时**静默**失效 —— 症状就是
// 面板底栏那颗「壁纸引擎设置」点了没反应（诊断里落 `trigger=none` + 6s 后
// `settings-entry-timeout dialog=false`）。判据钉**机制**：`isSettingsText` 走包含匹配，
// 且候选集里带着那两条带修饰的宿主原文（照字面在册，见 verify-i18n 的 VALUE_ALLOW）。
check('设置入口的名字匹配容忍宿主标签的修饰（包含匹配 + 长候选优先）',
  /settingsLabelCandidates\(\)\s*\n?\s*\.slice\(\)\s*\n?\s*\.sort\(\(a, b\) => b\.length - a\.length\)/.test(sidebarSrc)
    && /\.some\(\(c\) => t\.includes\(c\)\)/.test(sidebarSrc)
    && !/settingsLabelCandidates\(\)\.includes\(t\)/.test(sidebarSrc)
    && /push\("全局设置"\)/.test(sidebarSrc)
    && /push\("Global settings"\)/.test(sidebarSrc));

// 应用侧诊断：入口找没找到/点的是谁/有没有落到本节（写宿主 diag 文件，跨实例可回读）。
check('设置入口带落盘诊断（settings-entry / settings-entry-timeout）',
  sidebarSrc.includes('reportClientDiag("settings-entry",')
    && sidebarSrc.includes('"settings-entry-timeout"'));
// 封面重试窗：桥出封面可能滞后换曲（抽帧/下载），4 次×0.7s 的旧窗口会让整首歌没封面。
check('封面重试窗拉长到 12 次 + 退避（封顶 4s，覆盖 ~40s）',
  src.includes('MEDIA_ART_MAX_TRIES = 12') && src.includes('Math.min(700 * mediaArtTries, 4000)'));
// 失败记忆（sceneLiveFailures，持久降级）只在**用户手动选中**时清除：手动点开 =
// 想看它 live，重试一次（真失败会自动回退并重新记账）。启动恢复 / revalidate /
// 轮换提交都不清 —— 凡路过就清等于没记忆（smoke L2 钉住该不变量）。
check('live 失败记忆只在用户手动选中时清除（fromManual 显式传入）',
  src.includes('function clearLiveFailure(') && prepSrc.includes('opts && opts.fromManual')
    && src.includes("applySelection(w.id, { fromManual: true })")
    && src.includes('applySelection(next.id, { fromManual: true })'));
// 封面链路的落盘诊断（media-art*）：只在应用侧复现的失败要能被回读定位。
check('封面链路带落盘诊断（media-art*，每曲最多一条）+ 慢拍不放弃',
  src.includes('"media-art-slow"') && src.includes('"media-art-try-fail"')
    && src.includes('let mediaArtDiag') && src.includes('MEDIA_ART_SLOW_MS')
    && src.includes('slow ? MEDIA_ART_SLOW_MS'));
// ── 诊断族（P2-11 第一族）：注册已搬到 lib/routes/diag.js ⇒ 文本断言按**所属文件**分家 ──
// 行为断言（上面的 Level E 405/413）走 mock webServer，搬去哪个文件都照样有效；这里钉的是
// "这一族只在那个文件里注册"—— 两边各留一份会让同一路径被重复挂载，而卸载只放掉一份。
const diagSrc = readFileSync(join(root, 'lib', 'routes', 'diag.js'), 'utf8');
check('renderer diagnostics sink registered at /diag', /path: '\/diag'/.test(diagSrc) && /diag-log/.test(diagSrc));
// **实测**：同一份渲染页产物里还有一条走 ${BASE}/diag 的告警通道，只挂根路径会让
// 「壁纸黑屏」时最关键的渲染页告警全部 404 静默丢掉。
check('renderer diagnostics also accepted at ${BASE}/diag', diagSrc.includes('path: `${BASE}/diag`'));
check('诊断族只在 lib/routes/diag.js 注册（lib/index.js 只留一次调用）',
  !/path: '\/diag'/.test(hostSrc) && !/path: `\$\{BASE\}\/diag/.test(hostSrc)
  && !/const diagLog = \[\]/.test(hostSrc) && !/const handleDiag = /.test(hostSrc)
  && /registerDiagRoutes\(webServer, \{/.test(hostSrc));
// 负对照：把注册塞回主文件那种写法必须被判出（否则上面这条只是"主文件恰好没这几个字"
const diagBackInMain = "disposers.push(webServer.register({ kind: 'exact', path: '/diag', handler: handleDiag }));";
check('negative control: diag 注册回流 lib/index.js 会被判出', /path: '\/diag'/.test(diagBackInMain));
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
  /weAssetsAvailable \? "&localAssets=1"/.test(liveSrc));
check('syncLayers key carries local-assets availability',
  /weAssetsAvailable \? "la1"/.test(liveSrc));
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
