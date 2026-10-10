/**
 * verify-we-install-probe.mjs — Wallpaper Engine「装在哪」这条探测链的自检。
 *
 * 为什么独立成一个文件：当前版本的 Wallpaper Engine 把可执行文件下移到了
 * `distribution\`，顶层只剩 `ChromaAppInfo.xml` / `installer.exe` / `launcher.exe`。
 * 旧的唯一判据（顶层 `<dir>\wallpaper32.exe` 存在）因此把**已安装**判成"未安装"，
 * 而且这不是降级是**功能消失**：
 *   · portable 项目（`<安装根>/projects/defaultprojects|myprojects`）整批不扫；
 *   · WE 播放列表读不到（`readPlaylistsP` 要 `<安装根>/config.json`）⇒ 轮换/playlist 失效。
 * 工坊扫描（`libraryDirs` → `<库>/steamapps/workshop/content/431960`）本来就不挂
 * installDir，所以"完全跳过创意工坊"并不是这条 bug 的机制 —— 本文件按真实机制判。
 *
 * 判据分两层：
 *   A/B. **行为面**：四个合成 Steam 根夹具（classic / modern / stale / libContent）
 *        各自 `apply()` 一次真宿主，走公开的 `GET /wallpaper-engine/inventory`。
 *   D.   **源码棘轮**：够不着的行为（探测顺序、缓存键、旧写法真的消失）用带负对照的
 *        源码判据钉住 —— 负对照保证判据本身不是恒真。
 *
 * 为什么每个 case 都要重新 `apply()`：清单的 3s TTL 缓存（lib/inventory.js 的
 * `INVENTORY_TTL_MS`）是 **per-apply** 的闭包状态 ⇒ 新 apply 就是新缓存，不必 sleep。
 *
 * 夹具故意全部用 `type: "video"` + **不存在的** mp4：`media` 只在文件真的存在时才非
 * null（lib/inventory.js），于是既不 spawn ffmpeg、不联网、也不起媒体源；用 scene
 * 类型反而会走 `ensureSceneMediaOrigin()`（起端口）。
 *
 * 隔离：`DSH_WE_DATA_DIR` / `DSH_WE_CACHE_DIR` / `DSH_WE_UPLOAD_DIR` 全指向
 * `.test-cache/we-install-probe`；`DSH_WE_STEAM_ROOT` 由本文件逐 case 开关（import 前
 * 不设），全程不碰真实 `~/.dsh-wallpaper-engine` 与真实 Steam 库。
 *
 * Usage:  node test/verify-we-install-probe.mjs
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Writable } from 'node:stream';
// 剥注释（字符串感知）：源码判据必须在"注释里的旧写法"上保持沉默。见 test/tools/js-text.mjs。
import { stripComments } from './tools/js-text.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ISO = join(root, '.test-cache', 'we-install-probe');
const DATA_DIR = join(ISO, 'data');
const FIX = join(ISO, 'steam-roots');

rmSync(ISO, { recursive: true, force: true });
mkdirSync(DATA_DIR, { recursive: true });
process.env.DSH_WE_DATA_DIR = DATA_DIR;
process.env.DSH_WE_CACHE_DIR = join(ISO, 'cache');
process.env.DSH_WE_UPLOAD_DIR = join(ISO, 'uploads');
delete process.env.DSH_WE_STEAM_ROOT;   // 每个 case 自己设 —— 见 inventoryFor()

// ── tiny check harness（与 verify-scene.mjs / verify-cache-dir.mjs 同形） ─────
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
const hostMod = await import(pathToFileURL(resolve(root, 'lib', 'index.js')).href);
const host = hostMod.default || hostMod;
const apply = host.apply || (host.inject && host.apply);

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
async function runHandler(route, url) {
  const res = fakeRes();
  const done = route.handler({ url, method: 'GET', headers: {} }, res);
  if (done && typeof done.then === 'function') await done;
  if (!res.__state.ended) {
    await new Promise((resolveFn) => {
      const t = setTimeout(resolveFn, 8000);
      res.on('finish', () => { clearTimeout(t); resolveFn(); });
    });
  }
  return res;
}

/**
 * 用一个**全新的** `apply()` 取一次清单（`DSH_WE_STEAM_ROOT` = 给定 Steam 根的列表）。
 * 返回解析后的载荷；路由缺失 / 非 200 时返回 `{ error }`（判据会把它报红）。
 */
async function inventoryFor(steamRoots) {
  if (steamRoots && steamRoots.length) process.env.DSH_WE_STEAM_ROOT = steamRoots.join(',');
  else delete process.env.DSH_WE_STEAM_ROOT;
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
  const dispose = apply(mockCtx);
  try {
    const route = routes.find((r) => r.path === '/wallpaper-engine/inventory');
    if (!route) return { error: '/inventory 路由未注册' };
    const res = await runHandler(route, '/wallpaper-engine/inventory');
    if (res.__state.status !== 200) {
      return { error: 'status=' + res.__state.status + ' ' + res.__state.body.toString('utf8').slice(0, 200) };
    }
    try { return JSON.parse(res.__state.body.toString('utf8')); } catch (err) { return { error: 'JSON: ' + err.message }; }
  } finally {
    if (typeof dispose === 'function') dispose();
  }
}

// ── synthetic Steam roots ───────────────────────────────────────────────────
function writeAt(p, text) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); }
function touch(p) { writeAt(p, ''); }
/**
 * `DSH_WE_STEAM_ROOT` 的语义是 **Steam 根**（含 `steamapps/` 的那一层），不是
 * Wallpaper Engine 安装夹 —— 宿主自己会拼 `steamapps/common/wallpaper_engine`。
 * 传错这一步候选会变成 `<…>/wallpaper_engine/steamapps/common/wallpaper_engine`，
 * 探测必然 miss（写本文件时实测踩过：四个 case 全部掉到开发者机器上的真安装）。
 */
function steamRoot(name) { return join(FIX, name); }
/** 该 Steam 根下的 Wallpaper Engine 安装夹 —— 也就是 `installDir` 的期望值。 */
function weDir(name) { return join(steamRoot(name), 'steamapps', 'common', 'wallpaper_engine'); }
/** WE project.json 的最小合法形状（`file` 必须非空，否则 readProjectP 直接跳过）。 */
function projectJson(title, file) { return JSON.stringify({ title, type: 'video', file }, null, 2); }
/** WE 的 `<安装根>/config.json`：一个 profile 一条 playlist，item 是**安装根相对**路径。 */
function playlistConfig(playlistName, folder) {
  return JSON.stringify({
    'fixture-profile': {
      general: {
        playlists: [{
          name: playlistName,
          items: [['projects', 'defaultprojects', folder, 'project.json'].join('\\')],
          settings: { order: 'random', delay: 30 },
        }],
      },
    },
  }, null, 2);
}

// classic：老布局（可执行文件就在安装根顶层）。
const CLASSIC_STEAM = steamRoot('classic');
const CLASSIC_ROOT = weDir('classic');
touch(join(CLASSIC_ROOT, 'wallpaper32.exe'));
writeAt(join(CLASSIC_ROOT, 'projects', 'defaultprojects', 'portable-classic', 'project.json'),
  projectJson('Fixture Portable Classic', 'missing.mp4'));
writeAt(join(CLASSIC_ROOT, 'config.json'), playlistConfig('Fixture Sequence', 'portable-classic'));

// modern：当前布局（顶层只剩三个启动器/清单文件，可执行文件在 distribution/）。
const MODERN_STEAM = steamRoot('modern');
const MODERN_ROOT = weDir('modern');
for (const name of ['ChromaAppInfo.xml', 'installer.exe', 'launcher.exe']) touch(join(MODERN_ROOT, name));
for (const name of ['wallpaper32.exe', 'wallpaper64.exe']) touch(join(MODERN_ROOT, 'distribution', name));
writeAt(join(MODERN_ROOT, 'distribution', 'version.json'), JSON.stringify({ version: '2.6.0' }));
mkdirSync(join(MODERN_ROOT, 'distribution', 'bin'), { recursive: true });
mkdirSync(join(MODERN_ROOT, 'distribution', 'plugins'), { recursive: true });
writeAt(join(MODERN_ROOT, 'projects', 'defaultprojects', 'portable-modern', 'project.json'),
  projectJson('Fixture Portable Modern', 'missing.mp4'));
writeAt(join(MODERN_ROOT, 'config.json'), playlistConfig('Fixture Rotate', 'portable-modern'));

// stale：卸载残留空壳（本机真有过这种目录：只剩 ui/ 与 log.txt）—— 绝不能被当成已安装。
const STALE_STEAM = steamRoot('stale');
const STALE_ROOT = weDir('stale');
mkdirSync(join(STALE_ROOT, 'ui'), { recursive: true });
writeAt(join(STALE_ROOT, 'log.txt'), 'uninstalled shell\n');

// libContent：安装夹被改名 / 不存在，但工坊内容目录在 ⇒ 这个 Steam 根仍是壁纸来源。
// （旧判据探的是 `steamapps/common/wallpaper_engine` 这个**目录名**，不会 push 它。）
const LIB_ROOT = steamRoot('libcontent');
writeAt(join(LIB_ROOT, 'steamapps', 'workshop', 'content', '431960', '424242', 'project.json'),
  projectJson('Fixture Workshop Item', 'missing.mp4'));

// ── Level A: fixture sanity（负对照：夹具本身必须真的"没有顶层 exe"） ────────
section('Level A — 夹具形状（负对照）');
check('A1 modern 夹具顶层确实没有可执行文件（复刻当前 WE 布局）',
  !existsSync(join(MODERN_ROOT, 'wallpaper32.exe')) && !existsSync(join(MODERN_ROOT, 'wallpaper64.exe')),
  '顶层只有 ' + ['ChromaAppInfo.xml', 'installer.exe', 'launcher.exe'].filter((n) => existsSync(join(MODERN_ROOT, n))).join(' / '));
check('A2 modern 夹具的 distribution/ 里有 exe 与 version.json（当前布局的稳定标记）',
  existsSync(join(MODERN_ROOT, 'distribution', 'wallpaper32.exe'))
    && existsSync(join(MODERN_ROOT, 'distribution', 'wallpaper64.exe'))
    && existsSync(join(MODERN_ROOT, 'distribution', 'version.json')));
check('A3 classic / modern 夹具都带 portable 项目与 WE config.json 播放列表',
  existsSync(join(CLASSIC_ROOT, 'projects', 'defaultprojects', 'portable-classic', 'project.json'))
    && existsSync(join(CLASSIC_ROOT, 'config.json'))
    && existsSync(join(MODERN_ROOT, 'projects', 'defaultprojects', 'portable-modern', 'project.json'))
    && existsSync(join(MODERN_ROOT, 'config.json')));
check('A4 stale 夹具一个标记都没有（空壳）',
  !existsSync(join(STALE_ROOT, 'wallpaper32.exe')) && !existsSync(join(STALE_ROOT, 'distribution'))
    && !existsSync(join(STALE_ROOT, 'projects')) && !existsSync(join(STALE_ROOT, 'config.json')));

// ── Level B: 行为面（真 apply + /inventory） ────────────────────────────────
section('Level B — GET /wallpaper-engine/inventory（四种 Steam 根）');

// B1: 旧代码在这里返回 null（顶层没有 exe）—— 这是本 issue 的回归门。
const c1 = await inventoryFor([STALE_STEAM, MODERN_STEAM]);
const c1Dir = c1.error ? null : c1.installDir;
check('B1 distribution/ 布局的安装被认出来（旧判据：installDir=null）',
  !c1.error && c1Dir && norm(c1Dir) === norm(MODERN_ROOT),
  c1.error || ('installDir=' + c1Dir));
// installDir 必须是"装 projects/ 与 config.json 的那一层"—— 探到 distribution/ 就全错。
check('B2 installDir 保留安装根本身（projects/ 与 config.json 都在它下面，不是 distribution\\）',
  !c1.error && c1Dir && !/distribution$/i.test(c1Dir)
    && existsSync(join(c1Dir, 'config.json')) && existsSync(join(c1Dir, 'projects')),
  c1.error || ('installDir=' + c1Dir));
check('B3 portable 项目被扫到（<安装根>/projects/defaultprojects）',
  !c1.error && (c1.wallpapers || []).some((w) => w.id === 'portable-modern'),
  c1.error || ('ids=' + (c1.wallpapers || []).map((w) => w.id).join(',')));
const c1Playlist = c1.error ? null : (c1.playlists || []).find((p) => p.name === 'Fixture Rotate');
check('B4 WE 播放列表被读到并解析出 portable 壁纸 id',
  !!c1Playlist && (c1Playlist.wallpaperIds || []).includes('portable-modern'),
  c1.error || JSON.stringify(c1Playlist || null));

// B5: 经典布局不许被这次修复丢掉。
const c2 = await inventoryFor([CLASSIC_STEAM]);
const c2Dir = c2.error ? null : c2.installDir;
const c2Playlist = c2.error ? null : (c2.playlists || []).find((p) => p.name === 'Fixture Sequence');
check('B5 经典布局（顶层 exe）仍被认出来',
  !c2.error && c2Dir && norm(c2Dir) === norm(CLASSIC_ROOT),
  c2.error || ('installDir=' + c2Dir));
check('B6 经典根的 portable 项目与播放列表同样可达',
  !c2.error && (c2.wallpapers || []).some((w) => w.id === 'portable-classic')
    && !!c2Playlist && (c2Playlist.wallpaperIds || []).includes('portable-classic'),
  c2.error || JSON.stringify(c2Playlist || null));

// B7: 空壳不是安装。若开发者机器上真装有 WE，installDir 会是那份真安装 —— 判据只要求
//     它**不是**这个空壳，这样自检在有真安装的机器上也不会假红。
const c3 = await inventoryFor([STALE_STEAM]);
check('B7 卸载残留空壳（只有 ui/ + log.txt）不被当成已安装',
  !c3.error && (c3.installDir === null || norm(c3.installDir) !== norm(STALE_ROOT)),
  c3.error || ('installDir=' + c3.installDir));

// B8: 库判据改成探工坊内容目录 ⇒ 安装夹不存在/被改名的根照样出壁纸。
const c4 = await inventoryFor([LIB_ROOT]);
check('B8 只带工坊内容目录的 Steam 根被认成库（安装夹不存在也能出壁纸）',
  !c4.error && (c4.wallpapers || []).some((w) => w.id === '424242'),
  c4.error || ('ids=' + (c4.wallpapers || []).map((w) => w.id).join(',')));

// ── Level D: 源码棘轮（带负对照） ───────────────────────────────────────────
section('Level D — lib/index.js 源码棘轮');
const hostSrc = stripComments(readFileSync(resolve(root, 'lib', 'index.js'), 'utf8'));

check('D1 标记表同时容忍经典布局与 distribution/ 布局（含稳定标记 version.json）',
  /const WE_INSTALL_MARKERS = \[/.test(hostSrc)
    && hostSrc.includes("'wallpaper32.exe'")
    && hostSrc.includes("'wallpaper64.exe'")
    && hostSrc.includes("join('distribution', 'wallpaper32.exe')")
    && hostSrc.includes("join('distribution', 'wallpaper64.exe')")
    && hostSrc.includes("join('distribution', 'version.json')"));

check('D2 探测走 isWallpaperEngineRootP（逐标记探存在性），且返回的是安装根本身',
  /async function isWallpaperEngineRootP\(dir\) \{/.test(hostSrc)
    && hostSrc.includes('if (await pathExistsP(join(dir, marker))) return true;')
    && hostSrc.includes('if (await isWallpaperEngineRootP(dir)) return dir;')
    // 独立安装（非 Steam）那条候选也没被删掉。
    && hostSrc.includes("candidates.push(wslPath('C:\\\\Program Files (x86)\\\\Wallpaper Engine'));"));

// "字面量 contains 字面量"式判据一律不写：它对任何实现都真（覆盖点在 D4 / D5）。
const STALE_TOPLEVEL_ONLY = "pathExistsP(join(dir, 'wallpaper32.exe'))";
const STALE_OWNING_DIR = "pathExistsP(join(probe, 'steamapps', 'common', 'wallpaper_engine'))";

check('D4 「只认顶层 exe」不再是安装判据',
  !hostSrc.includes(STALE_TOPLEVEL_ONLY));

check('D5 owningLibraries 探的是工坊内容目录，不再是安装夹目录名',
  hostSrc.includes("pathExistsP(join(probe, 'steamapps', 'workshop', 'content', WE_APPID))")
    && !hostSrc.includes(STALE_OWNING_DIR));

check('D6 env 覆盖排在注册表 / 常见目录之前（显式 override 必须压过自动发现）',
  hostSrc.includes('return [...env, ...(reg ? [reg] : []), ...STEAM_PROBE_DIRS, ...wsl];'));

check('D7 env 覆盖参与探测缓存键（改过的 override 不被 60s TTL 掩盖）',
  hostSrc.includes("const envKey = process.env.DSH_WE_STEAM_ROOT || '';")
    && hostSrc.includes('steamProbeCache.key === envKey')
    && hostSrc.includes('steamProbeCache = { t: Date.now(), key: envKey, dirs };'));

check('D8 清单载荷仍把 installDir 作为消费面（客户端/播放列表读它）',
  hostSrc.includes('locateWallpaperEngineP, owningLibrariesP, enumerateWallpapersAsync'));

// ── 收尾 ───────────────────────────────────────────────────────────────────
delete process.env.DSH_WE_STEAM_ROOT;
rmSync(ISO, { recursive: true, force: true });

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
