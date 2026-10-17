#!/usr/bin/env node
/**
 * verify-slides.mjs — 图片 / 幻灯片清单路由（`lib/routes/slides.js`）的聚焦判据。
 *
 * 为什么单独一个守卫：这条路由是**图片 / 幻灯片壁纸**（WE `preset` 型项目）在
 * 浏览器半边的唯一取图入口 —— 它坏了不会报错，只会表现为「壁纸停在第一张」或
 * 「轮播里混进非图片」。两种症状用户都只能看到"图不对"，看不到异常 ⇒ 硬档。
 *
 * 被钉住的不变量（都是对外可观察行为）：
 *   ① 路由形状：`kind: 'prefix'` + `/wallpaper-engine/slides`；
 *   ② 清单内容与顺序：只列图片（非图片 / 隐藏文件不进）、**自然序**、递归子目录
 *      —— 顺序必须与扫描族 `listImages` 一致，否则首图与清单错位，第一拍会跳一下；
 *   ③ 每张图只回**同源媒体 URL**（token 形态），且 token 解析回该目录内的文件
 *      （绝不把磁盘路径放进应答）；
 *   ④ 失败形态：空目录 ⇒ 404 `no-images`、未知 token ⇒ 404 `unknown-token`、
 *      非 GET ⇒ 405（三种都不许抛）。
 *
 * 判据纪律（docs/DEV-GUIDE.md §4.7）：每条判据只定义一次（命名函数），正向与负对照
 * **调同一个函数**；负对照喂的是**变异源码**（现场改写 `lib/routes/slides.js` 落到
 * `.test-cache/`，不动 `lib/`）。
 *
 * Usage: node test/verify-slides.mjs
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerSlidesRoutes } from '../lib/routes/slides.js';
import { createWallpaperScanKit } from '../lib/wallpaper-scan.js';
import { createCheck } from './tools/assert-harness.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ISO = join(ROOT, '.test-cache', 'slides-guard');
const BASE = '/wallpaper-engine';
const { check, stats } = createCheck();

rmSync(ISO, { recursive: true, force: true });
mkdirSync(ISO, { recursive: true });

// ── 真件：扫描族的 listImages（顺序语义的唯一真源）+ 真磁盘探测 ──────────────
const kit = createWallpaperScanKit({
  WE_APPID: '431960',
  pathExistsP: (p) => existsSync(p),
  isFileP: (p) => { try { return statSync(p).isFile(); } catch { return false; } },
  isDirectoryP: (p) => { try { return statSync(p).isDirectory(); } catch { return false; } },
});

// ── 夹具：一个图片目录（自然序 + 子目录 + 非图片 + 隐藏文件）与一个空目录 ────
const pics = join(ISO, 'pics');
mkdirSync(join(pics, 'sub'), { recursive: true });
writeFileSync(join(pics, 'b.jpg'), 'b');
writeFileSync(join(pics, 'a.jpg'), 'a');
writeFileSync(join(pics, 'note.txt'), 'n');
writeFileSync(join(pics, '.hidden.jpg'), 'h');
writeFileSync(join(pics, 'sub', 'c.png'), 'c');
const emptyDir = join(ISO, 'empty');
mkdirSync(emptyDir, { recursive: true });
const staleImage = join(emptyDir, 'only.jpg');
writeFileSync(staleImage, 'o');

// ── 挂路由：真 mediaMap + tokenFor（token 形态与宿主一致：base64url(绝对路径)）──
function mount(register = registerSlidesRoutes) {
  const routes = [];
  const mediaMap = new Map();
  const tokenFor = (abs) => {
    const token = Buffer.from(String(abs), 'utf8').toString('base64url');
    mediaMap.set(token, String(abs));
    return token;
  };
  register({ register: (route) => { routes.push(route); return () => {}; } }, {
    disposers: [], base: BASE, mediaMap, listImages: kit.listImages, tokenFor,
  });
  return { route: routes[0], mediaMap, tokenFor };
}

/** 发一次请求；应答结束（`end`）即解析，返回 `{ status, body }`。 */
function call(route, url, method = 'GET') {
  return new Promise((done) => {
    const state = { status: 0, body: null };
    const res = {
      setHeader() {},
      writeHead(status) { state.status = status; },
      end(chunk) {
        try { state.body = JSON.parse(String(chunk)); } catch { state.body = null; }
        done(state);
      },
    };
    Object.defineProperty(res, 'statusCode', { get: () => state.status, set: (v) => { state.status = v; } });
    route.handler({ url, method, headers: {} }, res);
  });
}

// ── 判据（正/负对照共用同一份实现）───────────────────────────────────────────
/** ② 清单内容与顺序。 */
async function listsPicturesInOrder(route, token, expected) {
  const r = await call(route, `${BASE}/slides/${token}`);
  return r.status === 200 && r.body !== null && r.body.ok === true
    && Array.isArray(r.body.images)
    && r.body.images.map((img) => img.name).join(',') === expected;
}

/** ③ 每张图回同源媒体 URL，且 token 解析回夹具目录内的文件。 */
async function returnsMediaUrlsInside(route, token, mediaMap, dirAbs) {
  const r = await call(route, `${BASE}/slides/${token}`);
  if (r.status !== 200 || r.body === null || !Array.isArray(r.body.images)) return false;
  const root = resolve(dirAbs).toLowerCase();
  return r.body.images.every((img) => {
    if (!img || typeof img.url !== 'string' || !img.url.startsWith(`${BASE}/media/`)) return false;
    const abs = mediaMap.get(img.url.slice(`${BASE}/media/`.length));
    if (typeof abs !== 'string') return false;
    const norm = resolve(abs).toLowerCase();
    return norm === root || norm.startsWith(root + sep);
  });
}

/** ④ 空目录 ⇒ 404 `no-images`。 */
async function emptyDirIs404(route, token) {
  const r = await call(route, `${BASE}/slides/${token}`);
  return r.status === 404 && r.body !== null && r.body.ok === false && r.body.error === 'no-images';
}

/** ④ 未知 token ⇒ 404 `unknown-token`。 */
async function unknownTokenIs404(route) {
  const r = await call(route, `${BASE}/slides/not-a-real-token`);
  return r.status === 404 && r.body !== null && r.body.error === 'unknown-token';
}

/** ④ 非 GET ⇒ 405。 */
async function nonGetIs405(route, token) {
  const r = await call(route, `${BASE}/slides/${token}`, 'POST');
  return r.status === 405 && r.body !== null && r.body.error === 'method-not-allowed';
}

// ── 变异体加载器（源码文本改写 ⇒ `.test-cache/` 里 import）──────────────────
let mutantSeq = 0;
async function loadMutant(label, transform) {
  const src = readFileSync(join(ROOT, 'lib', 'routes', 'slides.js'), 'utf8');
  const out = transform(src);
  if (out === src) throw new Error('变异体没改到源码（判据会失真）: ' + label);
  const dir = join(ISO, 'mutants');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${mutantSeq++}-${label}.mjs`);
  // 变异体落在 `.test-cache/` ⇒ 相对 import 失效，换成绝对 file URL
  //（只替换说明符本身：`from` 与引号保持原样，免得把裸包 import 的判据喂出假阳性）。
  const jsonUrl = pathToFileURL(join(ROOT, 'lib', 'json-response.js')).href;
  const patched = out.replace("'../json-response.js'", `'${jsonUrl}'`);
  writeFileSync(file, patched);
  return (await import(pathToFileURL(file).href)).registerSlidesRoutes;
}

// ═══ 正向判据 ═══════════════════════════════════════════════════════════════
const main = mount();
// token 与宿主 inventory 同口径：指向**首图文件**（路由按 dirname 列同目录）。
const picsToken = main.tokenFor(join(pics, 'a.jpg'));
// 空目录：token 在图片还在时签发，随后图片被移走 —— 目录还在、图没了。
const emptyToken = main.tokenFor(staleImage);
rmSync(staleImage, { force: true });

check('S1 路由形状：prefix + /slides 路径',
  main.route !== undefined && main.route.kind === 'prefix' && main.route.path === `${BASE}/slides`,
  main.route && `${main.route.kind} ${main.route.path}`);

check('S2 清单：只列图片、自然序、递归子目录（b/a/note.txt/.hidden/sub ⇒ a,b,sub/c）',
  await listsPicturesInOrder(main.route, picsToken, 'a.jpg,b.jpg,sub/c.png'),
  '期望 a.jpg,b.jpg,sub/c.png');

check('S3 每张图只回同源媒体 URL，且 token 解析回该目录内',
  await returnsMediaUrlsInside(main.route, picsToken, main.mediaMap, pics));

check('S4 空目录 ⇒ 404 no-images', await emptyDirIs404(main.route, emptyToken));
check('S5 未知 token ⇒ 404 unknown-token', await unknownTokenIs404(main.route));
check('S6 非 GET ⇒ 405', await nonGetIs405(main.route, picsToken));

// ═══ 覆盖面地板 ═════════════════════════════════════════════════════════════
const listed = await kit.listImages(pics);
check('S7 覆盖面：夹具恰好 3 张图片（listImages 可调用、判据不为空集）',
  listed.length === 3, listed.join(','));

// ═══ 负对照（同一段判据，喂变异源码）═══════════════════════════════════════
const noEmptyCheck = await loadMutant('no-empty-check', (s) => s.replace('if (!names.length)', 'if (false)'));
const mutant = mount(noEmptyCheck);
check('S8 负对照：变异体删掉空目录判据 ⇒ 同一条判据判红（空目录会返回 200）',
  await emptyDirIs404(mutant.route, mutant.tokenFor(staleImage)) === false);

console.log(`\n${stats.failed === 0 ? 'ALL SLIDES CHECKS PASSED' : 'SLIDES CHECKS FAILED'} (${stats.passed + stats.failed})`);
process.exit(stats.failed === 0 ? 0 : 1);
