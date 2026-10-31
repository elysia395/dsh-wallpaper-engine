/**
 * verify-inventory-index.mjs — 「清单扫描索引」（#158）的自检。
 *
 * 为什么独立成一个文件：#158 的冷 TTFB（大库 1.9 s）不该靠"再快一点的扫描"解决，而该靠
 * **不扫**。`lib/inventory.js` 因此多了一条磁盘索引（签名 → 扫描原料 + 逐条目探测记忆），
 * 但这条链有三处会**静默退化**成"看起来还在、其实每次都全扫"，只有端到端数 I/O 次数才判得动：
 *   ① 签名命中却仍在探测（记忆表没被复用）；
 *   ② 库里新增一张壁纸却把整个库重探一遍（探测记忆没跨扫描延续）；
 *   ③ 索引把**载荷**存下来回放（token 是进程内的 `mediaMap` 产物 ⇒ 重启后每个 URL 都 404）。
 *
 * 判据用**计数桩**驱动真 `createInventoryBuilder`（不真扫盘：`enumerateWallpapersAsync` 与
 * `scanSignatureP` 都是可控桩），于是"探测了几次"是可数的整数，而不是凭感觉的"应该挺快"。
 * 每个 case 都**新建一个 builder**（等价于宿主重启）：`INVENTORY_TTL_MS` 的内存缓存在工厂
 * 闭包里，新工厂就是新缓存 —— 不必 sleep 3 秒。
 *
 * ⚠️ 一条与设计文档的偏离：审计里"② 请求在**强制重扫完成前**就能应答"这一条**不成立**，
 * 且是有意为之 —— 签名对不上等于**库本身变了**（换 Steam 根 / 增删项目目录），那时回旧
 * 载荷就是把上一个库的清单端给用户。实测踩过：`test/verify-we-install-probe.mjs` 的四个
 * 夹具共用一个 cacheDir，B6/B8 立刻红。所以"不等待"只发生在**签名命中**时（一格 fs 都不发），
 * 签名对不上与冷启动都等这一次重扫。
 *
 * 隔离：索引只写本文件自己的 `.test-cache/inventory-index/cache`。
 *
 * Usage:  node test/verify-inventory-index.mjs
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createInventoryBuilder } from '../lib/inventory.js';
import { registerInventoryRoutes } from '../packages/media-bridge/lib/routes/inventory.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ISO = join(root, '.test-cache', 'inventory-index');
const CACHE = join(ISO, 'cache');
const WE = join(ISO, 'we');
const UPLOADS = join(ISO, 'uploads');

rmSync(ISO, { recursive: true, force: true });
mkdirSync(CACHE, { recursive: true });

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) passed++;
  else failed++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
}
function section(title) { console.log('\n' + title); }

// ── 计数桩：探测次数是可数整数 ─────────────────────────────────────────────
const INDEX_FILE = join(CACHE, 'inventory-index.json');
const readIndex = () => {
  try { return JSON.parse(readFileSync(INDEX_FILE, 'utf8')); } catch { return null; }
};
let probes = { exists: 0, stat: 0, statPaths: [] };
const resetIoCalls = () => { probes = { exists: 0, stat: 0, statPaths: [] }; };

const installDir = join(WE, 'wallpaper_engine');
/** 一个 video 项目：主文件 + 预览图（video 类型没有 scene 分支，I/O 次数最好数）。 */
function makeProject(id) {
  const dir = join(installDir, 'projects', 'defaultprojects', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'project.json'), '{}');
  writeFileSync(join(dir, 'a.mp4'), '');
  writeFileSync(join(dir, 'preview.jpg'), '');
  return {
    id, title: id, type: 'video', contentrating: 'Everyone', schemeColor: null,
    fileAbs: join(dir, 'a.mp4'), previewAbs: join(dir, 'preview.jpg'), dirAbs: dir,
  };
}
let entries = [];
let sig = 'sig-1';
/** 桩里的目录 mtime 表：**只有这里改过**的条目才该被重探。 */
const dirMtime = new Map();

function makeBuilder() {
  return createInventoryBuilder({
    log: { info() {}, warn() {}, error() {} },
    BASE: '/wallpaper-engine',
    tokenFor: (abs) => 'tok-' + String(abs).split('/').pop(),
    mediaOriginApi: { mediaOriginBase: async () => 'https://media.example', ensureSceneMediaOrigin: async () => '' },
    warmFaststart: async () => {},
    locateWallpaperEngineP: async () => installDir,
    owningLibrariesP: async () => [],
    enumerateWallpapersAsync: async () => entries,
    scanSignatureP: async () => sig,
    pathKey: (p) => String(p).toLowerCase(),
    listCustomFrameIds: () => new Set(),
    pathExistsP: async (p) => { probes.exists += 1; return existsSync(p); },
    mtimeOrNullP: async (p) => {
      probes.stat += 1;
      probes.statPaths.push(String(p));
      if (dirMtime.has(p)) return dirMtime.get(p);
      return existsSync(p) ? 1 : null;
    },
    extOf: (p) => String(p).split('.').pop().toLowerCase(),
    ensureUploadDir: () => UPLOADS,
    readUploadMeta: () => ({}),
    enumerateUploadsP: async () => [],
    metaEntry: () => null,
    readPlaylistsP: async () => [],
    playlistItemId: () => null,
    weAssetsAvailable: () => false,
    sceneVideoProbeKey: (abs, m) => abs + '@' + m,
    sceneVideoProbeGet: () => undefined,
    scheduleSceneVideoProbe: () => {},
    customIdFromAbs: () => '',
    getUploadDir: () => UPLOADS,
    getWeAssetsDir: () => join(ISO, 'we-assets'),
    cacheBaseDir: () => CACHE,
  });
}
const buildFresh = () => makeBuilder()();

// ── ① 冷启动 ───────────────────────────────────────────────────────────────
section('① 冷启动：真扫一次，索引落盘');
const alpha = makeProject('alpha');
const beta = makeProject('beta');
entries = [alpha, beta];
resetIoCalls();
const p1 = await buildFresh();
check('冷启动返回两张壁纸', p1.wallpapers.length === 2,
  'ids=' + p1.wallpapers.map((w) => w.id).join(','));
check('冷启动每条约 2 次存在性探测（media + preview）', probes.exists === 4, 'exists=' + probes.exists);
const idx1 = readIndex();
check('磁盘索引已落盘（重启后不必再扫）', !!idx1, INDEX_FILE);
check('索引存的是扫描原料（fileAbs + dirAbs 都在）',
  !!idx1 && !!idx1.we?.[0]?.fileAbs && !!idx1.we?.[0]?.dirAbs);
check('索引里没有载荷字段（media / preview URL 不进索引）',
  !!idx1 && !('media' in (idx1.we?.[0] || {})) && !('wallpapers' in idx1));
check('索引里不含任何铸造过的 token（token 只活在进程内）',
  !!idx1 && !JSON.stringify(idx1).includes('/media/tok-'));
check('索引带签名与写入时刻（签名命中靠它）',
  !!idx1 && idx1.sig === 'sig-1' && typeof idx1.builtAt === 'number');

// ── ② 重启、库没动 ─────────────────────────────────────────────────────────
section('② 重启后签名没变：一格 fs 都不发');
resetIoCalls();
const p2 = await buildFresh();
check('签名命中 ⇒ 一次存在性探测都没有', probes.exists === 0, 'exists=' + probes.exists);
check('签名命中 ⇒ 一次 stat 都没有（探测记忆直接复用）', probes.stat === 0, 'stat=' + probes.stat);
check('载荷与冷启动逐字一致', JSON.stringify(p2) === JSON.stringify(p1));

// ── ③ 库里新增一张 ─────────────────────────────────────────────────────────
section('③ 库里新增一张：只有新条目被探测');
entries = [...entries, makeProject('gamma')];
sig = 'sig-2';
resetIoCalls();
const p3 = await buildFresh();
check('新增条目进了载荷', p3.wallpapers.some((w) => w.id === 'gamma'));
check('只探测新增的那一条（其余命中探测记忆）', probes.exists === 2, 'exists=' + probes.exists);
check('重扫时逐条核对项目目录 mtime（每存活条目一次）', probes.stat === 3, 'stat=' + probes.stat);

// ── ④ 只有一个项目目录变了（负对照） ───────────────────────────────────────
section('④ 只有一个项目目录变了：只有那一条重探');
dirMtime.set(beta.dirAbs, 99);           // 模拟"项目目录里动过文件"（根目录 mtime 不变 ⇒ 签名看不见）
entries = [...entries, makeProject('delta')];
sig = 'sig-3';
resetIoCalls();
await buildFresh();
check('目录变了的 beta 与新增的 delta 被重探（2 条 × 2 次）', probes.exists === 4, 'exists=' + probes.exists);
check('alpha / gamma 没有被重探（负对照：记忆按条目失效，不是整表作废）',
  probes.statPaths.filter((p) => p.includes('alpha')).length === 1
    && probes.statPaths.filter((p) => p.includes('gamma')).length === 1,
  'stat=' + probes.stat);

// ── ⑤ 索引容错 ─────────────────────────────────────────────────────────────
section('⑤ 索引坏了 / 版本不符 ⇒ 当成没有索引，不抛');
writeFileSync(INDEX_FILE, '{ 这不是 JSON');
resetIoCalls();
const p5a = await buildFresh();
check('坏索引不抛、照常返回全部 4 条', p5a.wallpapers.length === 4, 'ids=' + p5a.wallpapers.length);
check('坏索引 ⇒ 退回冷启动（全部重探）', probes.exists === 8, 'exists=' + probes.exists);
writeFileSync(INDEX_FILE, JSON.stringify({ v: 1, sig, builtAt: Date.now(), we: entries, probes: {} }));
resetIoCalls();
const p5b = await buildFresh();
check('老版本索引被忽略（形状变了不能当命中的）', probes.exists === 8 && p5b.wallpapers.length === 4,
  'exists=' + probes.exists);
// ── ⑤b §11 A3-F3：形状合法但**元素是垃圾**（`we: [null]`）───────────────────
//    顶层形状检查（v / sig / Array.isArray(we) / probes）全过，旧实现于是把它当命中索引用，
//    一路走到 `assembleInventory` 里的 `w.fileAbs` 并抛 TypeError；调用方 catch 成 500，
//    而索引一旦锁存就不再重读 ⇒ **跨重启永久 500**（只能手动删索引文件）。现在按"没有索引"
//    处理：照旧全扫，重扫后 `saveIndex` 重写一份干净的（自愈）。
//    写法上从**当前**索引里抠出 `v`（版本号没导出：手写常量会在版本一动后变成"其实没走到
//    元素检查"，判据看着绿其实在测别的事）。
const goodNow = JSON.parse(readFileSync(INDEX_FILE, 'utf8'));
writeFileSync(INDEX_FILE, JSON.stringify(Object.assign({}, goodNow, { we: [null] })));
resetIoCalls();
const p5c = await buildFresh();
check('A3-F3：we:[null] 的索引当"没有索引"（不抛、照常全扫）',
  p5c.wallpapers.length === 4 && probes.exists === 8,
  'wallpapers=' + p5c.wallpapers.length + ' exists=' + probes.exists);
const idx5c = readIndex();
check('A3-F3：重扫后索引自愈（逐元素形状合法、不再含 null）',
  !!idx5c && Array.isArray(idx5c.we) && idx5c.we.length === 4
    && idx5c.we.every((w) => w && typeof w === 'object'),
  'we=' + JSON.stringify((idx5c && idx5c.we) || null));
// ── ⑤c §11 A3-F3 的另一半：扫描原料本身混进非对象元素 ──────────────────────
//    `assembleInventory` 是**另一个入口**（冷启动 / 重扫直接把原料喂进去，不经过索引）⇒ 它也
//    逐元素兜一道，否则 `w.fileAbs` 同样抛 TypeError 变 500。签名换掉以便真的走 enumerate 那一支。
sig = 'sig-5';
const savedEntries = entries;
entries = [null, ...savedEntries];
resetIoCalls();
const p5d = await buildFresh();
check('A3-F3：扫描原料含 null 元素 ⇒ 跳过它、其余照常返回（不抛）',
  p5d.wallpapers.length === 4, 'wallpapers=' + p5d.wallpapers.length);
entries = savedEntries;

// ── ⑥ 索引不随删除无限长 ───────────────────────────────────────────────────
section('⑥ 已删除的项目从索引里消失');
entries = entries.filter((w) => w.id !== 'alpha');
sig = 'sig-4';
resetIoCalls();
await buildFresh();
const idx6 = readIndex();
check('探测记忆里没有已删除条目的键',
  !!idx6 && !Object.keys(idx6.probes).some((k) => k.includes('alpha')),
  'keys=' + Object.keys(idx6?.probes || {}).length);
check('扫描原料也只剩存活的条目',
  !!idx6 && idx6.we.length === 3 && !idx6.we.some((w) => w.id === 'alpha'),
  'we=' + (idx6?.we || []).map((w) => w.id).join(','));

// ── ⑦ /inventory 的协商式 gzip（#158 回归）─────────────────────────────────
section('⑦ 大库 /inventory 按 Accept-Encoding 协商压缩');
// 拆包回归：1.4.0 时这条路由还在主包、走 sendJson（`0949e625` 补的就是协商压缩），
// P0.2-D 把处理器逐字搬进 media-bridge 后序列化退化成裸 `JSON.stringify` ⇒ 冷扫 MB 级载荷
// 恒 identity（实测 1.86 MB）。判据直接挂**真路由**（假 webServer / req / res）：
// 压缩与否是响应头 + 字节的可见事实，不靠读源码猜。
const BIG_INVENTORY = { wallpapers: Array.from({ length: 200 }, (_, i) => ({ id: 'w' + i, title: '壁纸 ' + i })) };

function mountInventoryRoute(overrides = {}) {
  const routes = [];
  const webServer = { register(route) { routes.push(route); return { dispose() {} }; } };
  /** @type {any} */
  const c = {
    disposers: [],
    base: '/wallpaper-engine',
    mediaOriginApi: { observeAdapter() {} },
    buildInventory: async () => BIG_INVENTORY,
    componentsProbe: () => null,
    ...overrides,
  };
  registerInventoryRoutes(webServer, c);
  return { routes, c };
}

function callInventory(route, { method = 'GET', headers = {} } = {}) {
  const res = {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(key, value) { this.headers[String(key).toLowerCase()] = value; },
    end(chunk) {
      this.body = chunk === undefined ? Buffer.alloc(0) : Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    },
  };
  return Promise.resolve(route.handler({ method, url: '/wallpaper-engine/inventory', headers }, res))
    .then(() => res);
}

const { routes: inventoryRoutes } = mountInventoryRoute();
check('G1：路由形状不变（exact · /wallpaper-engine/inventory）',
  inventoryRoutes.length === 1 && inventoryRoutes[0].kind === 'exact' && inventoryRoutes[0].path === '/wallpaper-engine/inventory',
  inventoryRoutes.map((r) => r.kind + ' ' + r.path).join(' | '));

const plain = await callInventory(inventoryRoutes[0], { headers: { 'accept-encoding': 'identity' } });
check('G2：未声明 gzip ⇒ 恒 identity，头逐字保留（charset + no-store）',
  !plain.headers['content-encoding']
    && plain.headers['content-type'] === 'application/json; charset=utf-8'
    && plain.headers['cache-control'] === 'no-store'
    && plain.body.length > 1024,
  'enc=' + plain.headers['content-encoding'] + ' type=' + plain.headers['content-type'] + ' bytes=' + plain.body.length);

const zipped = await callInventory(inventoryRoutes[0], { headers: { 'accept-encoding': 'gzip, deflate, br' } });
check('G3：声明 gzip ⇒ Content-Encoding: gzip + Vary: Accept-Encoding',
  zipped.headers['content-encoding'] === 'gzip' && zipped.headers['vary'] === 'Accept-Encoding',
  'enc=' + zipped.headers['content-encoding'] + ' vary=' + zipped.headers['vary']);
check('G4：解压后与 identity 载荷逐字节相等',
  !!zipped.headers['content-encoding'] && gunzipSync(zipped.body).equals(plain.body),
  'gunzip=' + (zipped.headers['content-encoding'] === 'gzip' ? gunzipSync(zipped.body).length : 'n/a'));

const refused = await callInventory(inventoryRoutes[0], { headers: { 'accept-encoding': 'gzip;q=0' } });
check('G5：gzip;q=0（明确拒绝）⇒ 不压',
  !refused.headers['content-encoding'], 'enc=' + refused.headers['content-encoding']);

const headResp = await callInventory(inventoryRoutes[0], { method: 'HEAD', headers: { 'accept-encoding': 'gzip' } });
check('G6：HEAD ⇒ 不压（头可以协商，实体不压）',
  !headResp.headers['content-encoding'], 'enc=' + headResp.headers['content-encoding']);

const { routes: failingRoutes } = mountInventoryRoute({ buildInventory: async () => { throw new Error('boom'); } });
const failed500 = await callInventory(failingRoutes[0], { headers: { 'accept-encoding': 'gzip' } });
check('G7：500 分支仍是 application/json（不带 charset）',
  failed500.statusCode === 500 && failed500.headers['content-type'] === 'application/json',
  'status=' + failed500.statusCode + ' type=' + failed500.headers['content-type']);

// 负对照（判据有牙）：把协商分支改成永不成立，从源码文本载入一份**变异体**再走同一请求 ——
// 若这时 gzip 请求仍被压缩，说明判据测的不是这段代码。
const ROUTE_SRC = readFileSync(join(root, 'packages/media-bridge/lib/routes/inventory.js'), 'utf8');
const MUTANT_SRC = ROUTE_SRC.replace("if (body.length >= GZIP_MIN_BYTES && req.method !== 'HEAD') {", 'if (false) {');
check('G8：负对照准备工作（源码里存在可替换的协商分支）', MUTANT_SRC !== ROUTE_SRC);
const mutantMod = MUTANT_SRC === ROUTE_SRC
  ? { registerInventoryRoutes }
  : await import('data:text/javascript;base64,' + Buffer.from(MUTANT_SRC, 'utf8').toString('base64'));
const mutantRoutes = [];
mutantMod.registerInventoryRoutes({ register(route) { mutantRoutes.push(route); return { dispose() {} }; } }, {
  disposers: [], base: '/wallpaper-engine', mediaOriginApi: { observeAdapter() {} },
  buildInventory: async () => BIG_INVENTORY, componentsProbe: () => null,
});
const mutantResp = await callInventory(mutantRoutes[0], { headers: { 'accept-encoding': 'gzip' } });
check('G9：负对照 —— 去掉协商分支后 gzip 请求不再被压缩（判据有牙）',
  !mutantResp.headers['content-encoding'], 'enc=' + mutantResp.headers['content-encoding']);

// ── 收尾 ────────────────────────────────────────────────────────────────────
rmSync(ISO, { recursive: true, force: true });
console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
