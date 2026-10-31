#!/usr/bin/env node
/**
 * verify-slides.mjs —— 图片 / 幻灯片壁纸的图集清单路由（`GET ${BASE}/slides/<token>`）的聚焦判据。
 *
 * 被测对象：`packages/media-bridge/lib/routes/slides.js` 的 `registerSlidesRoutes` + 内核扫描族的
 * **真** `listImages()`（`lib/wallpaper-scan.js`）。两者一起判，因为这条链的契约在两半之间：
 *   · 宿主半（`listImages`）负责「目录 → 相对路径、自然序」——顺序的唯一真源；
 *   · 路由半负责「token → 目录 → 每张图的同源 `/media/<token>` URL + 四种失败口径」。
 *
 * 为什么值得独立守卫：幻灯片壁纸的"顺序错了 / 少一张图"都不会报错，只是过场与 WE 里看到的不一致
 * （Linux 上 `readdir` 的次序近乎随机）；而 token 一旦解析到目录外，就是一个**越界读盘**入口。
 * 两种症状都静默 ⇒ 硬档。
 *
 * 判据设计（DEV-GUIDE §4.7）：
 *   · 正向判据里"每张 URL 的 token 必须反解回**本目录内**的真实文件"这条，钉的是越界；
 *   · S8 是变异体负对照：把 `if (!names.length)` 换成 `if (false)`（源码现场改写，落 `.test-cache/`，
 *     不动 `packages/`），同一段判据必须报红 —— 证明 404 分支真的在跑，而不是恒假。
 *   · 覆盖面地板（S7）写在最外层，`listImages` 退化成一个空数组也会当场红。
 *
 * Usage:  node test/verify-slides.mjs
 */

import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerSlidesRoutes } from '../packages/media-bridge/lib/routes/slides.js';
import { createWallpaperScanKit } from '../lib/wallpaper-scan.js';
import { extOf } from '../lib/fs-paths.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ISO = join(ROOT, '.test-cache', 'slides-guard');
const ROUTE_SRC = join(ROOT, 'packages', 'media-bridge', 'lib', 'routes', 'slides.js');
const BASE = '/wallpaper-engine';
const APPID = '431960';

let passed = 0; let failed = 0;
function check (name, ok, detail) {
  if (ok) passed++;
  else failed++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
}
function section (t) { console.log('\n' + t); }

rmSync(ISO, { recursive: true, force: true });
mkdirSync(ISO, { recursive: true });

// ── 真磁盘：内核扫描族的 listImages（判据面的一半）──────────────────────────
const listImages = createWallpaperScanKit({
  WE_APPID: APPID,
  pathExistsP: (p) => existsSync(p),
  isFileP: (p) => { try { return statSync(p).isFile(); } catch { return false; } },
  isDirectoryP: (p) => { try { return statSync(p).isDirectory(); } catch { return false; } },
  extOf,
  schemeToCss: () => null,
}).listImages;

// ── 夹具：一个图片目录（自然序 / 非图片 / 隐藏文件 / 子目录）+ 一个空目录 ─────
const PIC_DIR = join(ISO, 'pics');
const EMPTY_DIR = join(ISO, 'empty');
for (const rel of ['a.jpg', 'b.jpg', '10.jpg', 'note.txt', '.hidden.jpg', 'sub/c.png']) {
  const abs = join(PIC_DIR, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, 'x');
}
mkdirSync(EMPTY_DIR, { recursive: true });
writeFileSync(join(EMPTY_DIR, 'note.txt'), 'x');

/**
 * 装配真路由：假 webServer 只收注册（返回 disposer 句柄），假 http 只回送 JSON。
 * tokenFor 与媒体族同形——**登记进同一张 mediaMap**，判据据此反解"这张图真的在目录内"。
 */
function mountRoute (register = registerSlidesRoutes) {
  const routes = [];
  const disposers = [];
  const webServer = { register (route) { routes.push(route); return () => {}; } };
  const mediaMap = new Map();
  let seq = 0;
  const tokenFor = (abs) => {
    const token = 'tok' + (seq++);
    mediaMap.set(token, abs);
    return token;
  };
  const http = { sendJson (res, code, payload) { res.statusCode = code; res.body = payload; } };
  register(webServer, { disposers, base: BASE, mediaMap, tokenFor, listImages, http });
  return { routes, disposers, mediaMap, tokenFor, route: routes[0] };
}

/** 跑一次 handler：`listImages` 是 Promise ⇒ 等它落地（不依赖定时器的"碰巧"）。 */
async function callRoute (route, url, method = 'GET') {
  const res = { statusCode: 0, body: null };
  route.handler({ method, url }, res);
  if (!res.body) {
    for (let i = 0; i < 200 && !res.body; i++) await new Promise((resolve) => { setImmediate(resolve); });
  }
  return res;
}

// A. 注册形状：一条 prefix 路由，路径落在 `${BASE}/slides`，句柄进 disposers
const mounted = mountRoute();
const { routes, disposers, route } = mounted;
const token = mounted.tokenFor(join(PIC_DIR, 'a.jpg'));

section('A. 注册形状（卸载时要能注销掉，且不额外开地址空间）');
check('A1 注册一条 prefix 路由', routes.length === 1 && route.kind === 'prefix', routes.length + ' 条');
check('A2 路径是 `${BASE}/slides`', route.path === `${BASE}/slides`, route.path);
check('A3 注销句柄进了 disposers', disposers.length === 1);
check('A4 token 是首图的媒体 token（与 /media/<token> 同一张 mediaMap）',
  mounted.mediaMap.get(token) === join(PIC_DIR, 'a.jpg'));

// B. 成功回包：名字（相对、自然序）与同源 URL
const res = await callRoute(route, `${BASE}/slides/${token}`);
section('B. 回包：目录 → 自然序图集 → 每条同源 `/media/<token>` URL');
check('B1 200 + ok', res.statusCode === 200 && res.body && res.body.ok === true,
  JSON.stringify(res.body && res.body.error));
check('B2 token 原样回声（客户端拿它对齐当前壁纸）', res.body && res.body.token === token);
check('B3 图集是自然序、跳过非图片与隐藏文件（数字按数值排，字母在数字之后，子目录按前缀跟排）',
  res.body && Array.isArray(res.body.images)
    && res.body.images.map((it) => it.name).join(',') === '10.jpg,a.jpg,b.jpg,sub/c.png',
  JSON.stringify(res.body && res.body.images && res.body.images.map((it) => it.name)));
check('B4 每条 url 都走 `${BASE}/media/`（不新开寻址、不拼外部 origin）',
  res.body && res.body.images && res.body.images.every((it) => it.url.startsWith(`${BASE}/media/`)));
check('B5 每条 url 的 token 反解回**本目录内**的真实文件（越界即红）',
  res.body && res.body.images && res.body.images.every((it) => {
    const t = it.url.slice(`${BASE}/media/`.length);
    const abs = mounted.mediaMap.get(t);
    return typeof abs === 'string' && resolve(abs) === resolve(join(PIC_DIR, it.name))
      && abs.startsWith(resolve(PIC_DIR) + (process.platform === 'win32' ? '\\' : '/'));
  }));
check('B6 每张图都登记进了 mediaMap（`/media/<token>` 是唯一出口）',
  res.body && res.body.images && res.body.images.length >= 4 && mounted.mediaMap.size >= 5);

// C. 四种失败口径：都不抛、都是 JSON
const unknown = await callRoute(route, `${BASE}/slides/tok-does-not-exist`);
section('C. 失败口径：未知 token / 空目录 / 非 GET / 路径解码失败');
check('C1 未知 token ⇒ 404 unknown-token', unknown.statusCode === 404 && unknown.body.error === 'unknown-token',
  JSON.stringify(unknown.body));
const emptyToken = mounted.tokenFor(join(EMPTY_DIR, 'note.txt'));
const empty = await callRoute(route, `${BASE}/slides/${emptyToken}`);
check('C2 目录里一张图都没有 ⇒ 404 no-images', empty.statusCode === 404 && empty.body.error === 'no-images',
  JSON.stringify(empty.body));
const post = await callRoute(route, `${BASE}/slides/${token}`, 'POST');
check('C3 非 GET ⇒ 405 method-not-allowed（HEAD 同样不放过）',
  post.statusCode === 405 && post.body.error === 'method-not-allowed', JSON.stringify(post.body));
const head = await callRoute(route, `${BASE}/slides/${token}`, 'HEAD');
check('C4 HEAD 也走非 GET 分支', head.statusCode === 405 && head.body.error === 'method-not-allowed');
const bad = await callRoute(route, `${BASE}/slides/%E0%A4%A`);
check('C5 路径解码失败 ⇒ 400 bad-request（不抛 500）', bad.statusCode === 400 && bad.body.error === 'bad-request',
  JSON.stringify(bad.body));
const missingToken = await callRoute(route, `${BASE}/slides/`);
check('C6 空 token ⇒ 404 unknown-token（不拿整目录兜底）',
  missingToken.statusCode === 404 && missingToken.body.error === 'unknown-token', JSON.stringify(missingToken.body));

// D. 覆盖面地板：图集真的不止一张、子目录真的进来了
section('D. 覆盖面地板（listImages 退化 ⇒ 这里当场红）');
check('D1 回包至少 4 张图（含子目录一张）', res.body && res.body.images && res.body.images.length >= 4,
  String(res.body && res.body.images && res.body.images.length));
check('D2 子目录里的图带相对前缀', res.body && res.body.images
  && res.body.images.some((it) => it.name === 'sub/c.png'));

// E. 变异体负对照：把「空目录 ⇒ 404」拆掉，同一段判据必须报红
section('E. 变异体负对照（拆掉空目录闸 ⇒ 判据必须看到 200）');
const src = readFileSync(ROUTE_SRC, 'utf8');
const mutated = src.replace("if (!names.length) { json(404, { ok: false, error: 'no-images' }); return; }",
  "if (false) { json(404, { ok: false, error: 'no-images' }); return; }");
check('E1 变异体真的改到了源码锚点', mutated !== src);
const mutantPath = join(ISO, 'slides-mutant.route.mjs');
writeFileSync(mutantPath, mutated);
const mutantRoute = await import(pathToFileURL(mutantPath).href);
const mutantMounted = mountRoute(mutantRoute.registerSlidesRoutes);
const mutantToken = mutantMounted.tokenFor(join(EMPTY_DIR, 'note.txt'));
const mutantEmpty = await callRoute(mutantMounted.route, `${BASE}/slides/${mutantToken}`);
check('E2 变异体在空目录上回 200（原实现是 404 no-images）⇒ 404 判据不是恒真的',
  mutantEmpty.statusCode === 200 && !(mutantEmpty.body && mutantEmpty.body.error === 'no-images'),
  JSON.stringify(mutantEmpty.body));

// F. 收尾
console.log('');
if (failed) {
  console.log(`FAILED (${failed}) / passed (${passed})`);
  process.exit(1);
}
console.log(`ALL SLIDES CHECKS PASSED (${passed})`);
