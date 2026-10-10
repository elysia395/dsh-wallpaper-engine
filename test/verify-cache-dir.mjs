/**
 * verify-cache-dir.mjs — 「缓存位置」（高级 → 缓存位置）这条链的宿主侧自检。
 *
 * 为什么独立成一个文件：这条链跨四层，任何一层退化都会让用户"改了却没用"或者更糟
 * （把缓存写进别人的目录 / 搬错东西）：
 *   ① 解析顺序 `cacheBaseDir()`：`DSH_WE_CACHE_DIR`（env）→ config.json 的根字段
 *      `cacheDir` → `<数据目录>/cache`；
 *   ② **六处**缓存子目录都从这条链派生（transcodes / faststart / frames /
 *      video-previews / media-bridge / artwork）。改语义之前其中两处在别的文件里各自
 *      用 `configPath()` 的父目录 / `dataDir` 硬拼 —— 那种写法在这儿正是被判的红。
 *   ③ `POST /cache-dir` 的形状：只认绝对路径、非目录拒绝、迁移只搬已知子目录名、
 *      旧目录不删、回包用 `effective` 再次问解析链（env 覆盖要能看出来）。
 *   ④ 两处"写死 homedir"的旧缺口：默认上传目录、自定义画面目录（`overrides/`）
 *      —— 它们必须跟着 `pluginDataDir()` 走。
 *   ⑤ `GET /cache-dir/browse`（设置页「更改」弹出的目录浏览器数据腿）：只列**目录**
 *      不列文件、条目 `path` 可直接回传问下一级、current/parent 归一化、判不了的
 *      path（文件 / 不存在）一律 400 —— 不猜、不静默回落根视图。
 *
 * 判据尽量走**公开面**（真 `apply()` + mock webServer + 真请求），因为"某个缓存目录又
 * 长回硬编码"这种事只有端到端才判得干净；剩下够不着的（六个名字是否都串在同一条链上、
 * 两处缺口有没有爬回 `homedir()`）用**带负对照的棘轮**钉住 —— 负对照保证判据本身不是
 * 恒真。行为面的另一档（帧真的落到 `<缓存根>/frames`）在 test/verify-scene.mjs 里。
 *
 * 隔离：`DSH_WE_DATA_DIR` / `DSH_WE_STEAM_ROOT` 都指向 `.test-cache/`，`DSH_WE_CACHE_DIR`
 * 由本文件自己开关 ⇒ 全程不碰真实 `~/.dsh-wallpaper-engine`。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable, Writable } from 'node:stream';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ISO = join(root, '.test-cache', 'cache-dir');
const DATA_DIR = join(ISO, 'data');
const ENV_CACHE = join(ISO, 'env-cache');
const CUSTOM = join(ISO, 'custom');
const MOVED = join(ISO, 'moved');
const NOFOLLOW = join(ISO, 'nofollow');

rmSync(ISO, { recursive: true, force: true });
mkdirSync(DATA_DIR, { recursive: true });
process.env.DSH_WE_DATA_DIR = DATA_DIR;
process.env.DSH_WE_STEAM_ROOT = join(ISO, 'steam'); // 不存在 ⇒ 机库为空，/inventory 快且隔离
delete process.env.DSH_WE_CACHE_DIR;
delete process.env.DSH_WE_UPLOAD_DIR;

// ── tiny check harness（与 verify-scene.mjs 同形） ────────────────────────────
let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) passed++;
  else failed++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
}
function section(title) { console.log('\n' + title); }

/** Windows 上盘符大小写与分隔符都不该影响"是不是同一个目录"的判断。 */
const norm = (p) => resolve(p).toLowerCase();

// ── shared mock webServer + req/res shims（与 verify-scene-live.mjs 同形） ───
const routes = [];
const mockCtx = {
  webServer: {
    register(route) {
      routes.push(route);
      return () => { const i = routes.indexOf(route); if (i >= 0) routes.splice(i, 1); };
    },
    tapIndex() { return () => {}; },
  },
};
const hostMod = await import(pathToFileURL(resolve(root, 'lib', 'index.js')).href);
const host = hostMod.default || hostMod;
const apply = host.apply || (host.inject && host.apply);
const dispose = apply(mockCtx);

function fakeRes() {
  const state = { status: 200, headers: {}, body: Buffer.alloc(0), ended: false };
  const res = new Writable({
    write(chunk, enc, cb) {
      state.body = Buffer.concat([state.body, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      cb();
    },
    final(cb) { state.ended = true; cb(); },
  });
  res.setHeader = (k, v) => { state.headers[k] = v; };
  res.writeHead = (s, h) => { state.status = s; if (h) Object.assign(state.headers, h); };
  Object.defineProperty(res, 'statusCode', { get: () => state.status, set: (v) => { state.status = v; } });
  res.__state = state;
  return res;
}
/** 带 JSON 请求体的 fake 请求：handler 里是 req.on('data'/'end')，Readable.from 即可。 */
function fakeReqBody(url, method, obj) {
  const r = Readable.from([Buffer.from(JSON.stringify(obj))]);
  r.url = url;
  r.method = method;
  r.headers = { 'content-type': 'application/json' };
  return r;
}
function fakeReq(url, method) {
  return { url, method, headers: {} };
}
/** 等应答 end/finish：POST 的应答在写盘之后才发，等它就是等持久化完成。 */
async function runHandler(route, req) {
  const res = fakeRes();
  const done = route.handler(req, res);
  if (done && typeof done.then === 'function') await done;
  if (!res.__state.ended) {
    await new Promise((resolveFn) => {
      const t = setTimeout(resolveFn, 8000);
      res.on('finish', () => { clearTimeout(t); resolveFn(); });
    });
  }
  return res;
}
const routeFor = (path) => routes.find((r) => r.path === path);
const CACHE_URL = '/wallpaper-engine/cache-dir';
const json = (res) => { try { return JSON.parse(res.__state.body.toString('utf8')); } catch { return null; } };
async function postCache(obj) { return runHandler(routeFor(CACHE_URL), fakeReqBody(CACHE_URL, 'POST', obj)); }

const cacheRoute = routeFor(CACHE_URL);
const invRoute = routeFor('/wallpaper-engine/inventory');
const readConfigJson = () => JSON.parse(readFileSync(join(DATA_DIR, 'config.json'), 'utf8'));

// ── A. 端点形状 ─────────────────────────────────────────────────────────────
section('A. POST /cache-dir 的形状与校验');
check('A1 路由已注册（缓存位置是设置项，不是可选项）',
  !!cacheRoute && typeof cacheRoute.handler === 'function');
check('A2 只认 POST：GET 出 405（当前值经 /inventory.cacheDir 下发，无需 GET）',
  (await runHandler(cacheRoute, fakeReq(CACHE_URL, 'GET'))).__state.status === 405);
{
  const res = await postCache({ dir: 'relative/path', migrate: true });
  check('A3 相对路径 ⇒ 400（用户能填的必须能解析成目录）',
    res.__state.status === 400 && typeof (json(res) || {}).error === 'string',
    (json(res) || {}).error);
}
{
  const res = await postCache({ migrate: true });
  check('A4 缺 dir / 坏 JSON ⇒ 400（不是 500，也不是静默用默认值）', res.__state.status === 400);
}
{
  const filePath = join(ISO, 'not-a-dir.txt');
  writeFileSync(filePath, 'x');
  const res = await postCache({ dir: filePath, migrate: true });
  const body = json(res) || {};
  check('A5 路径存在但是文件 ⇒ 400（否则缓存会写进文件里）',
    res.__state.status === 400 && /无法在该路径创建目录/.test(String(body.error)),
    body.error);
}
// 只断行为项：两条 400 文案已由 A3/A5 在**运行时响应**上断过（同上同源），这里再 includes
// 一次源码字面量只会产生"改了文案就假红"的复述 —— 删掉，保留"不缓存缓存根副本"这条行为项。
const cacheRouteSrc = readFileSync(join(root, 'lib', 'routes', 'cache-dir.js'), 'utf8');
check('A6 路由模块不缓存缓存根的副本（跨族共享可变量须每次现问）',
  /effective: cacheBaseDir\(\)/.test(cacheRouteSrc)
    && !/const cacheDir = cacheBaseDir\(\)/.test(cacheRouteSrc));

// ── B. 解析顺序：env → config → <数据目录>/cache ─────────────────────────────
// 这一节的手法：解析链用 `/cache-dir` 回包的 `effective`（每次现问链、**不受 inventory 的
// 3s TTL 影响**，见 lib/inventory.js 的 INVENTORY_TTL_MS）来判正负对照；`/inventory` 只在
// 最后读一次 —— 读的是"界面真正显示的那个值"，因此那一次必须等过 TTL（否则拿到的是上一态
// 的缓存载荷，那正是本节最容易写出的恒真假通过）。
section('B. cacheBaseDir() 的解析顺序（正负对照）');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
{
  const res = await postCache({ dir: CUSTOM, migrate: true });
  const body = json(res) || {};
  check('B1 绝对路径 ⇒ 200，且 effective 是归一化后的路径',
    res.__state.status === 200 && norm(body.effective || '') === norm(CUSTOM), JSON.stringify(body));
  check('B2 目标目录被建出来 + cacheDir 落进 config.json 的根字段',
    existsSync(CUSTOM) && norm(readConfigJson().cacheDir || '') === norm(CUSTOM),
    'config.json cacheDir=' + readConfigJson().cacheDir);
  const again = json(await postCache({ dir: CUSTOM, migrate: true })) || {};
  check('B3 指回当前目录 ⇒ same 短路（不重复建目录、不重写 config）',
    again.same === true && again.migrated === 0, JSON.stringify(again));
}
{
  // env 覆盖：这是"用户改了却像没生效"的唯一来源，回包必须能和用户填的值区分开。
  process.env.DSH_WE_CACHE_DIR = ENV_CACHE;
  const body = json(await postCache({ dir: CUSTOM, migrate: true })) || {};
  check('B4 env 优先于 config：回包同时给出「用户填的」与「实际生效的」⇒ 界面能提示被覆盖',
    norm(body.cacheDir || '') === norm(CUSTOM) && norm(body.effective || '') === norm(ENV_CACHE),
    'cacheDir=' + body.cacheDir + ' effective=' + body.effective);
  delete process.env.DSH_WE_CACHE_DIR;
  const back = json(await postCache({ dir: CUSTOM, migrate: true })) || {};
  check('B5 清掉 env 后回到 config 那条（对照：B4 不是恒真）',
    norm(back.effective || '') === norm(CUSTOM), back.effective);
}
{
  // 默认值（既没 env 也没 config）：删掉 config.json 再问链 —— 目标即默认值 ⇒ same 短路，
  // 所以这一问既不写 config 又能把"默认值"读出来。
  const cfgPath = join(DATA_DIR, 'config.json');
  const backup = readFileSync(cfgPath);
  rmSync(cfgPath, { force: true });
  const body = json(await postCache({ dir: join(DATA_DIR, 'cache'), migrate: false })) || {};
  check('B6 都没设 ⇒ <数据目录>/cache（默认值本身也在这条链上）',
    body.same === true && norm(body.effective || '') === norm(join(DATA_DIR, 'cache'))
      && !existsSync(cfgPath),
    'effective=' + body.effective);
  writeFileSync(cfgPath, backup);
}
{
  const inv = json(await runHandler(invRoute, fakeReq('/wallpaper-engine/inventory', 'GET'))) || {};
  check('B7 /inventory 下发生效值（客户端靠它显示，不靠回显用户输入）',
    norm(inv.cacheDir || '') === norm(CUSTOM), inv.cacheDir);
  check('B8 行为面：设了 DSH_WE_DATA_DIR 后默认上传目录也在数据目录里（旧缺口 ①）',
    norm(inv.uploadDir || '').startsWith(norm(DATA_DIR)), inv.uploadDir);
}
{
  // 界面读数这一档必须过 TTL（3s）才拿到新载荷 —— 隔 3.2s 再读，env 覆盖才真的传到界面。
  process.env.DSH_WE_CACHE_DIR = ENV_CACHE;
  await sleep(3200);
  const inv = json(await runHandler(invRoute, fakeReq('/wallpaper-engine/inventory', 'GET'))) || {};
  check('B9 env 覆盖真的传到界面读数（过 inventory TTL 后再读；B7 的同一判据此刻必须为假）',
    norm(inv.cacheDir || '') === norm(ENV_CACHE) && norm(inv.cacheDir || '') !== norm(CUSTOM),
    inv.cacheDir);
  delete process.env.DSH_WE_CACHE_DIR;
}

// ── C. 迁移：只搬已知的六个缓存子目录，旧目录不删 ────────────────────────────
section('C. 迁移行为（六个子目录 = 缓存根的全部已知成员）');
const CACHE_SUBDIR_FILES = {
  transcodes: 'job.mp4',
  faststart: 'clip.mp4',
  frames: 'abc_gpu.png',
  'video-previews': 'p.webp',
  'media-bridge': 'asset.bin',
  artwork: 'cover.jpg',
};
{
  for (const [name, file] of Object.entries(CACHE_SUBDIR_FILES)) {
    mkdirSync(join(CUSTOM, name), { recursive: true });
    writeFileSync(join(CUSTOM, name, file), name);
  }
  writeFileSync(join(CUSTOM, 'keepme.txt'), '不知道是什么，别动');
  const res = await postCache({ dir: MOVED, migrate: true });
  const body = json(res) || {};
  check('C1 六个已知缓存子目录里的文件全部搬走（migrated == 6）',
    res.__state.status === 200 && body.migrated === 6 && body.skipped === 0,
    'migrated=' + body.migrated + ' skipped=' + body.skipped);
  check('C2 搬到了新根下同名子目录里',
    Object.entries(CACHE_SUBDIR_FILES).every(([name, file]) => existsSync(join(MOVED, name, file))));
  check('C3 不认识的东西原地不动（目标可能是用户随手指的已有目录 ⇒ 不能当"整棵树归我"）',
    existsSync(join(CUSTOM, 'keepme.txt')) && !existsSync(join(MOVED, 'keepme.txt')));
  check('C4 旧目录不删（只留搬空的壳）—— 插件不替用户删目录',
    existsSync(CUSTOM) && existsSync(join(CUSTOM, 'transcodes')));
  const again = json(await postCache({ dir: MOVED, migrate: true })) || {};
  check('C5 指回当前目录 ⇒ same，不重复搬（幂等）',
    again.same === true && again.migrated === 0, JSON.stringify(again));
  mkdirSync(join(MOVED, 'artwork'), { recursive: true });
  writeFileSync(join(MOVED, 'artwork', 'keep.bin'), 'x');
  const noMove = json(await postCache({ dir: NOFOLLOW, migrate: false })) || {};
  check('C6 migrate:false 只换根不搬（用户明确说要自己收尾）',
    noMove.same === false && noMove.migrated === 0
      && existsSync(join(MOVED, 'artwork', 'keep.bin'))
      && norm(readConfigJson().cacheDir || '') === norm(NOFOLLOW),
    'migrated=' + noMove.migrated);
}

// ── D. 「六处都派生自同一条链」+ 两处旧缺口的棘轮 ────────────────────────────
section('D. 派生棘轮：六个子目录 / 两处 homedir 缺口（带负对照）');
const hostSrc = readFileSync(join(root, 'lib', 'index.js'), 'utf8');
const faststartSrc = readFileSync(join(root, 'lib', 'faststart.js'), 'utf8');
const mediaIndexSrc = readFileSync(join(root, 'lib', 'media', 'index.js'), 'utf8');
const legacySrc = readFileSync(join(root, 'lib', 'media', 'legacy.js'), 'utf8');
// 两个媒体工厂共用的「现问缓存根」解析器（字符串调用点照用、访问器就现算）。
const LAZY_ROOT = /const cacheRoot = \(\) => \(typeof cacheBaseDir === 'function' \? cacheBaseDir\(\) : cacheBaseDir\)/;
function walkJs(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkJs(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
const libFiles = walkJs(join(root, 'lib'));

check('D1 transcodes / frames / video-previews 三处都写 `join(cacheBaseDir(), …)`',
  ['transcodes', 'frames', 'video-previews']
    .every((n) => new RegExp("join\\(cacheBaseDir\\(\\), '" + n + "'\\)").test(hostSrc)));
check('D2 faststart 变体缓存跟缓存根走（旧写法是 configPath() 的父目录）',
  /join\(cacheBaseDir\(\), 'faststart'\)/.test(faststartSrc));
check('D3 媒体中间件 / 封面缓存跟缓存根走（工厂每次现问，不留值快照）',
  /cacheDir: join\(cacheRoot\(\), 'media-bridge'\)/.test(mediaIndexSrc)
    && /join\(cacheRoot\(\), 'artwork'\)/.test(legacySrc)
    && LAZY_ROOT.test(mediaIndexSrc) && LAZY_ROOT.test(legacySrc));
// 「传访问器」而不是「传现算的值」：值快照会让用户在设置页改完缓存位置之后，
// 新的封面 / 中间件缓存又写回旧盘（宿主重启才纠正）—— 与 cacheBaseDir() 不收快照同一个理由。
const nowPlayingSrc = readFileSync(join(root, 'lib', 'routes', 'now-playing.js'), 'utf8');
const ROOT_SNAPSHOT = /cacheBaseDir: cacheBaseDir\(\),/;
check('D3b now-playing 把访问器交给媒体后端，而不是起动时现算的值',
  /^\s{4}cacheBaseDir,$/m.test(nowPlayingSrc) && !ROOT_SNAPSHOT.test(nowPlayingSrc));
check('D3c negative control: 值快照写法会被 D3b 判红',
  ROOT_SNAPSHOT.test('    cacheBaseDir: cacheBaseDir(),'));
// 缺省参数仍与从前逐字一致：这两个工厂被别处单独调用时不该因为这次改动换目录。
check('D4 媒体工厂的缺省仍是 <dataDir>/cache（缺省行为不因本次改动而变）',
  /cacheBaseDir = join\(dataDir, 'cache'\)/.test(mediaIndexSrc)
    && /cacheBaseDir = join\(dataDir, 'cache'\)/.test(legacySrc));

// 负对照：这两条正则必须判得出"改动之前"的写法，否则 D5/D6 是恒真。
const STALE_CACHE_ROOT = /join\(dirname\(configPath\(\)\), 'cache'/;
const STALE_HOMEDIR_GAP = /join\(homedir\(\),\s*'\.dsh-wallpaper-engine',/;
check('D5 negative control: 旧的两条写法本身会被下面两条判据判红',
  STALE_CACHE_ROOT.test("ensureDirOnce(join(dirname(configPath()), 'cache', 'faststart'));")
    && STALE_HOMEDIR_GAP.test("const DEFAULT_UPLOAD_DIR = join(homedir(), '.dsh-wallpaper-engine', 'uploads');")
    && STALE_HOMEDIR_GAP.test("ensureDirOnce(join(homedir(), '.dsh-wallpaper-engine', 'overrides'))"));
check('D6 lib/ 全域再无「按 configPath() 的父目录拼缓存根」',
  !libFiles.some((p) => STALE_CACHE_ROOT.test(readFileSync(p, 'utf8'))));
check('D7 lib/ 全域再无「dataDir 之外还写死 homedir 的子目录」'
  + '（pluginDataDir() 的默认值本身不算 —— 它前面没有第二个片段）',
  !libFiles.some((p) => STALE_HOMEDIR_GAP.test(readFileSync(p, 'utf8')))
    && hostSrc.includes("join(homedir(), '.dsh-wallpaper-engine')"),
  '默认数据目录仍在：join(homedir(), \'.dsh-wallpaper-engine\')');
check('D8 默认上传目录 / 自定义画面目录都改成 pluginDataDir() 派生',
  /function defaultUploadDir\(\) \{ return join\(pluginDataDir\(\), 'uploads'\); \}/.test(hostSrc)
    && /function customFrameDir\(\) \{ return ensureDirOnce\(join\(pluginDataDir\(\), 'overrides'\)\); \}/.test(hostSrc)
    && !/DEFAULT_UPLOAD_DIR/.test(hostSrc));

// ── E. GET /cache-dir/browse（「更改」弹出目录浏览器的数据腿） ────────────────
// 只读：列**目录名**（不列文件、不给内容）；条目 path 原样回传问下一级，客户端零路径拼接。
const allRealDirs = (entries) => entries.every((d) => {
  try { return statSync(d.path).isDirectory(); } catch { return false; }
});
section('E. GET /cache-dir/browse 的形状与校验');
const BROWSE_URL = '/wallpaper-engine/cache-dir/browse';
const browseRoute = routes.find((r) => r.kind === 'prefix' && r.path === BROWSE_URL);
check('E1 路由已注册（prefix 形态，与带查询串的 GET 先例同口径）',
  !!browseRoute && typeof browseRoute.handler === 'function');
check('E2 只认 GET：POST 出 405（落盘迁移在 POST /cache-dir，这条只读）',
  (await runHandler(browseRoute, fakeReqBody(BROWSE_URL, 'POST', {}))).__state.status === 405);
{
  const res = await runHandler(browseRoute, fakeReq(BROWSE_URL, 'GET'));
  const o = json(res);
  check('E3 根视图（不带 path）：列存在的盘（至少一个）+ 主目录 + 无 parent',
    res.__state.status === 200 && Array.isArray(o.dirs) && o.dirs.length >= 1
      && typeof o.home === 'string' && o.home.length > 0
      && o.parent === null && o.current === '',
    (o.dirs || []).length + ' 个盘根');
  check('E4 根视图条目形状 { name, path }，且 path 都是真目录',
    o.dirs.every((d) => d && typeof d.name === 'string' && typeof d.path === 'string')
      && allRealDirs(o.dirs));
}
{
  const base = join(ISO, 'browse');
  mkdirSync(join(base, 'beta'), { recursive: true });
  mkdirSync(join(base, 'alpha'), { recursive: true });
  writeFileSync(join(base, 'plain.txt'), 'x');
  const res = await runHandler(browseRoute,
    fakeReq(BROWSE_URL + '?path=' + encodeURIComponent(base), 'GET'));
  const o = json(res);
  check('E5 列子目录：只列目录不列文件、字典序、条目 path 可直接回传',
    res.__state.status === 200 && o.dirs.length === 2
      && o.dirs[0].name === 'alpha' && o.dirs[1].name === 'beta'
      && norm(o.dirs[0].path) === norm(join(base, 'alpha')),
    JSON.stringify(o.dirs));
  check('E6 current 归一化、parent 指向上一级',
    norm(o.current) === norm(base) && norm(o.parent) === norm(dirname(base)));
  const fileRes = await runHandler(browseRoute,
    fakeReq(BROWSE_URL + '?path=' + encodeURIComponent(join(ISO, 'not-a-dir.txt')), 'GET'));
  check('E7 path 指向文件 ⇒ 400（不能当目录浏览）',
    fileRes.__state.status === 400 && typeof (json(fileRes) || {}).error === 'string');
  const missRes = await runHandler(browseRoute,
    fakeReq(BROWSE_URL + '?path=' + encodeURIComponent(join(ISO, 'no-such-dir')), 'GET'));
  check('E8 不存在的路径 ⇒ 400（不猜、不静默回落根视图）',
    missRes.__state.status === 400);
}
// E3 的负对照：E4 用的判据函数喂坏输入必须翻红 —— 否则解析器静默返回空集时
// 正断言恒绿（本文件对允许清单/棘轮的既有口径）。
check('E9 negative control: E4 的条目判据会红（列表混入文件时）',
  allRealDirs([{ name: 'ok', path: join(ISO, 'browse', 'alpha') }])
    && !allRealDirs([{ name: 'x', path: join(ISO, 'not-a-dir.txt') }]));
// ── 收尾 ────────────────────────────────────────────────────────────────────
if (typeof dispose === 'function') dispose();
delete process.env.DSH_WE_DATA_DIR;
delete process.env.DSH_WE_STEAM_ROOT;
rmSync(ISO, { recursive: true, force: true });

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
