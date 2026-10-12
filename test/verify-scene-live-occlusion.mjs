#!/usr/bin/env node
/**
 * verify-scene-live-occlusion.mjs — 遮挡入口曝光 + 父页消息桥 + 宿主 HTML 注入的机检
 * （规格：docs/wip/LINUX-OCCLUSION.md §5/§8；沿 test/verify-scene-live.mjs 的
 *  mock webServer + 真实 handler 请求模式）。
 *
 * Levels:
 *   A. bundle 曝光：vendored 渲染 bundle 里 `window.__weSetOcclusion` 恰好一处、位于
 *      控制器创建锚点之后（锚点字符串来自规格 §1，上游同步换符号 ⇒ 这里判红并强制
 *      重新定位复验）；并把曝光语句抠出来在假 realm 里跑真源码 —— 验证调用穿透与
 *      异常吞噬（行为断言，不依赖压缩符号名）。
 *   B. 注入（真实请求）：GET /scene-live/index.html 的响应体在 <head> 后带
 *      `<script src=…/occlusion-bridge.js?v=<插件版本>>`，其余字节与盘上文件一致，
 *      缓存头语义不变（no-store）；目录形态同样注入；哈希资源 / 兜底页不受影响；
 *      桥文件本身经围栏可达；越界仍 403。
 *   C. 桥行为：`node --check` 语法门 + 假 realm 里跑真源码，逐条钉消息契约
 *      （source/__weLive 门、setOcclusion 形状门、clearOcclusion、未就绪静默、
 *      渲染器抛错不外泄、幂等安装）。
 *
 * Usage:  node test/verify-scene-live-occlusion.mjs
 */

import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable, Writable } from 'node:stream';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// 与 verify-scene-live.mjs 同一套环境隔离：apply() 可能清扫缓存/读设置，全部指进
// 工作区内的临时目录（绝不碰用户真实的那份）。
const TEST_CACHE_DIR = join(root, '.test-cache', 'scene-live-occlusion');
process.env.DSH_WE_CACHE_DIR = TEST_CACHE_DIR;
process.env.DSH_WE_UPLOAD_DIR = join(TEST_CACHE_DIR, 'uploads-fixture');
process.env.DSH_WE_DATA_DIR = join(TEST_CACHE_DIR, 'data');
const TEST_HOME = join(TEST_CACHE_DIR, 'home');
mkdirSync(TEST_HOME, { recursive: true });
process.env.HOME = TEST_HOME;
process.env.USERPROFILE = TEST_HOME;

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) passed++;
  else failed++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
}

// ── Level A: bundle 曝光 ─────────────────────────────────────────────────────
console.log('Level A — vendored bundle 曝光 window.__weSetOcclusion');
const bundlePath = join(root, 'lib', 'webwallgl', 'assets', 'renderer-AJkjEL9i.js');
const bundle = readFileSync(bundlePath, 'utf8');
// 契约钉死：曝光全局名与入参语义（规格 §5：入参 = setOcclusion payload，null 合法）。
const EXPOSURE = 'window.__weSetOcclusion=function(t){try{window.__wp.setOcclusion(t)}catch(e){}};';
const exposureCount = bundle.split(EXPOSURE).length - 1;
check('bundle 恰好曝光一处 window.__weSetOcclusion（一行级、带 try/catch）', exposureCount === 1,
  'count=' + exposureCount);
// 规格锚点（§1，pin 4ba71c40）：上游同步换符号后这里判红，强制重新定位并复验 §8。
// 「控制器创建点」在「曝光」之前 —— 曝光必须包到那个作用域里的控制器包装对象。
const anchorCreate = bundle.indexOf('const me=Xb({fullscreen:!0})');
const anchorEntry = bundle.indexOf('setOcclusion(t){const e=me.occlusion?.band');
const atExposure = bundle.indexOf(EXPOSURE);
check('曝光位于控制器创建锚点之后（规格 §1 锚点法；上游同步 ⇒ 重新定位复验）',
  anchorCreate >= 0 && anchorEntry >= 0 && atExposure > anchorCreate && atExposure > anchorEntry,
  'create@' + anchorCreate + ' entry@' + anchorEntry + ' exposure@' + atExposure);
check('负对照：曝光语句必须在（把它拿掉的合成体被判红）',
  (bundle.replace(EXPOSURE, '').split(EXPOSURE).length - 1) === 0 && atExposure >= 0);
// 行为断言：抠出曝光语句在假 realm 里跑真源码 —— 调用穿透 + 异常吞噬，
// 这两条不依赖任何压缩符号名（上游换符号名后依然有效）。
{
  const stmt = bundle.slice(atExposure, bundle.indexOf(';', atExposure) + 1);
  const win = { __wp: { setOcclusion(p) { win.__calls.push(p); } }, __calls: [] };
  new Function('window', stmt)(win);
  const payload = { occluders: [[0, 0, 100, 100]], epoch: 'x11::display=:1', gen: 7 };
  win.__weSetOcclusion(payload);
  win.__weSetOcclusion(null);   // null = 清除、回 run（合法入参）
  check('曝光真源码：调用穿透（payload 原样到达控制器，null 也照传）',
    win.__calls.length === 2 && win.__calls[0] === payload && win.__calls[1] === null,
    'calls=' + win.__calls.length);
  win.__wp.setOcclusion = () => { throw new Error('renderer blew up'); };
  let threw = false;
  try { win.__weSetOcclusion(payload); } catch { threw = true; }
  check('曝光真源码：控制器抛错被吞噬（不外泄到调用方）', threw === false);
}

// ── shared mock webServer + req/res（沿 verify-scene-live.mjs 的 Level E 模式）──
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
async function runHandler(route, url, headers, method) {
  const res = fakeRes();
  const req = fakeReq(url, headers);
  if (method) req.method = method;
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
const h = (res, k) => res.__state.headers[k] || res.__state.headers[k.toLowerCase()] || '';

// ── Level B: /scene-live/index.html 注入（真实请求）──────────────────────────
console.log('Level B — /scene-live/index.html 注入遮挡桥（真实请求）');
const liveRoute = routes.find((r) => r.path === '/wallpaper-engine/scene-live');
check('scene-live route registered', Boolean(liveRoute));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const diskIndex = readFileSync(join(root, 'lib', 'webwallgl', 'index.html'), 'utf8');
const diskBridge = readFileSync(join(root, 'lib', 'webwallgl', 'occlusion-bridge.js'), 'utf8');
// 缓存键 = 桥内容 sha256 前 12 位（与 lib/routes/scene-serve.js 同一算式）：改桥
// 不 bump 版本也能自动失效浏览器旧字节（评审 C6——immutable 一年 + 版本键的洞）。
const bridgeKey = createHash('sha256').update(diskBridge).digest('hex').slice(0, 12);
const wantTag = `<script src="/wallpaper-engine/scene-live/occlusion-bridge.js?v=${bridgeKey}"></script>`;
if (liveRoute) {
  const res = await runHandler(liveRoute, '/wallpaper-engine/scene-live/index.html');
  const body = res.__state.body.toString('utf8');
  const atTag = body.indexOf(wantTag);
  check('index.html 200 + text/html + no-store（注入不改缓存头语义）',
    res.__state.status === 200 && /text\/html/.test(h(res, 'Content-Type')) && /no-store/.test(h(res, 'Cache-Control')),
    'status=' + res.__state.status + ' ' + h(res, 'Content-Type') + ' ' + h(res, 'Cache-Control'));
  check('index.html 带 <BASE>/scene-live/occlusion-bridge.js?v=<桥内容哈希> 的桥 script',
    atTag !== -1, 'tag=' + JSON.stringify(atTag !== -1 ? wantTag : '(缺失)'));
  check('缓存键等于桥内容哈希（改桥自动失效旧字节，评审 C6）',
    atTag !== -1 && body.includes('?v=' + bridgeKey), 'v=' + bridgeKey);
  check('桥 script 注入在 <head> 之后、渲染器 module script 之前',
    atTag !== -1 && body.indexOf('<head') !== -1 && body.indexOf('<head') < atTag
      && atTag < body.indexOf('renderer-AJkjEL9i.js'),
    'head<' + atTag + '<bundle@' + body.indexOf('renderer-AJkjEL9i.js'));
  check('注入只加一个标签：body 去掉桥标签后与盘上 index.html 逐字节一致',
    body.replace(wantTag, '') === diskIndex,
    'delta=' + (body.length - diskIndex.length) + 'B（应恰为标签长 ' + wantTag.length + 'B）');
  // 目录形态（rest 归一成 index.html）同样注入。
  const dirRes = await runHandler(liveRoute, '/wallpaper-engine/scene-live/');
  check('目录形态（/scene-live/）同样注入桥 script',
    dirRes.__state.status === 200 && dirRes.__state.body.toString('utf8').indexOf(wantTag) !== -1,
    'status=' + dirRes.__state.status);
  // HEAD 落回 serveFile 原样（注入只对 GET；不崩、头语义不变）。
  const headRes = await runHandler(liveRoute, '/wallpaper-engine/scene-live/index.html', {}, 'HEAD');
  check('HEAD index.html 照常 200 + no-store（不注入也不崩）',
    headRes.__state.status === 200 && /no-store/.test(h(headRes, 'Cache-Control')),
    'status=' + headRes.__state.status);
  // 桥文件本身经围栏可达（WEBWALLGL_DIR 内）。
  const bridgeRes = await runHandler(liveRoute, `/wallpaper-engine/scene-live/occlusion-bridge.js?v=${pkg.version}`);
  check('桥文件经 /scene-live/ 可达（200 + javascript MIME + 字节与盘上一致）',
    bridgeRes.__state.status === 200 && /javascript/.test(h(bridgeRes, 'Content-Type'))
      && bridgeRes.__state.body.equals(Buffer.from(diskBridge)),
    'status=' + bridgeRes.__state.status + ' ' + h(bridgeRes, 'Content-Type'));
  // 哈希资源不受影响：immutable 头 + 字节与盘上 bundle 一致（路由不碰资产字节）。
  const assetBytes = readFileSync(bundlePath);
  const assetRes = await runHandler(liveRoute, '/wallpaper-engine/scene-live/assets/renderer-AJkjEL9i.js');
  check('哈希资源照旧 immutable + 字节不变（曝光改的是内容、服务不改）',
    assetRes.__state.status === 200 && /immutable/.test(h(assetRes, 'Cache-Control'))
      && assetRes.__state.body.equals(assetBytes),
    'cc=' + h(assetRes, 'Cache-Control') + ' bytes=' + assetRes.__state.body.length);
  // 兜底页不注入（无渲染器的静态页不需要桥）。
  const fbRes = await runHandler(liveRoute, '/wallpaper-engine/scene-live/default-wallpaper/index.html');
  const fbBody = fbRes.__state.body.toString('utf8');
  check('default-wallpaper/index.html 200 + no-store + 不注入',
    fbRes.__state.status === 200 && /no-store/.test(h(fbRes, 'Cache-Control'))
      && fbBody.indexOf('occlusion-bridge') === -1,
    'status=' + fbRes.__state.status + ' cc=' + h(fbRes, 'Cache-Control'));
  check('负对照：注入判据有牙（兜底页体与盘上文件一致 = 未被注入）',
    fbBody === readFileSync(join(root, 'lib', 'webwallgl', 'default-wallpaper', 'index.html'), 'utf8'));
  // 围栏回归：越界仍 403。
  const escRes = await runHandler(liveRoute, '/wallpaper-engine/scene-live/%2e%2e%2findex.js');
  check('encoded ../ 越界仍 403（围栏零回归）', escRes.__state.status === 403, 'status=' + escRes.__state.status);
  // 非 GET 拒绝不变。
  const postRes = await runHandler(liveRoute, '/wallpaper-engine/scene-live/index.html', {}, 'POST');
  check('POST 仍 405', postRes.__state.status === 405, 'status=' + postRes.__state.status);
}

// ── Level C: 桥脚本行为（假 realm 跑真源码）─────────────────────────────────
console.log('Level C — occlusion-bridge.js 行为模拟');
check('桥脚本语法（node --check）', (() => {
  try { execFileSync(process.execPath, ['--check', join(root, 'lib', 'webwallgl', 'occlusion-bridge.js')], { stdio: 'pipe' }); return true; }
  catch { return false; }
})());
/** 假 realm：装一次桥源码，收集 message 监听器，返回派发器。 */
function installBridge() {
  const listeners = {};
  const parent = {};                       // window.parent 的替身（e.source 的比对目标）
  const win = {
    parent,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
  };
  new Function('window', diskBridge)(win);
  return {
    win,
    parent,
    listenerCount: () => (listeners.message || []).length,
    send(ev) { for (const fn of listeners.message || []) fn(ev); },
  };
}
{
  const b = installBridge();
  check('桥幂等安装：重复装载只有一份 message 监听器', (() => {
    new Function('window', diskBridge)(b.win);
    return b.listenerCount() === 1;
  })(), 'listeners=' + b.listenerCount());

  const calls = [];
  b.win.__weSetOcclusion = (p) => calls.push(p);
  // 契约钉死（与 A/C 并行，一字不能差）：
  const setMsg = { source: b.parent, data: { __weLive: 1, op: 'setOcclusion', payload: { occluders: [[0, 0, 100, 100]], epoch: 'x11::display=:1', gen: 7 } } };
  b.send(setMsg);
  check('setOcclusion：契约消息 → __weSetOcclusion 收到同一个 payload 对象',
    calls.length === 1 && calls[0] === setMsg.data.payload, 'calls=' + calls.length);
  b.send({ source: b.parent, data: { __weLive: 1, op: 'clearOcclusion' } });
  check('clearOcclusion：契约消息 → __weSetOcclusion(null)', calls.length === 2 && calls[1] === null);
  b.send({ source: b.parent, data: { __weLive: 1, op: 'setOcclusion', payload: { occluders: null, epoch: 'e', gen: 8 } } });
  check('setOcclusion：occluders=null 合法（规格 §1：null = 清除、回 run）',
    calls.length === 3 && calls[2].occluders === null);
  // 门 1：source 必须是 window.parent。
  const before = calls.length;
  b.send({ source: {}, data: { __weLive: 1, op: 'setOcclusion', payload: { occluders: [[0, 0, 1, 1]] } } });
  check('负对照：source ≠ window.parent 的同形消息被拒（门有牙）', calls.length === before);
  // 门 2：__weLive 必须 === 1。
  for (const bad of [0, 2, '1', undefined]) {
    b.send({ source: b.parent, data: { __weLive: bad, op: 'setOcclusion', payload: { occluders: [[0, 0, 1, 1]] } } });
  }
  check('负对照：__weLive ≠ 1（0/2/"1"/缺省）全部被拒', calls.length === before);
  // 门 3：payload.occluders 必须是数组或 null。
  for (const bad of ['[[0,0,1,1]]', 42, {}, undefined]) {
    b.send({ source: b.parent, data: { __weLive: 1, op: 'setOcclusion', payload: { occluders: bad } } });
  }
  check('负对照：occluders 非数组非 null（字符串/数字/对象/缺省）全部被拒',
    calls.length === before, 'calls=' + calls.length);
  // 未知 op 静默；垃圾事件不抛。
  let threw = false;
  try {
    b.send({ source: b.parent, data: { __weLive: 1, op: 'nonsense' } });
    b.send({ source: b.parent, data: null });
    b.send(null);
  } catch { threw = true; }
  check('未知 op 与垃圾事件静默丢弃（监听器不抛）', threw === false && calls.length === before);
  // 未就绪：__weSetOcclusion 不在 ⇒ 静默丢，不抛（渲染器晚启动是正常态）。
  {
    const quiet = installBridge();   // 不装 __weSetOcclusion
    let qThrew = false;
    try { quiet.send({ source: quiet.parent, data: { __weLive: 1, op: 'clearOcclusion' } }); } catch { qThrew = true; }
    check('__weSetOcclusion 未就绪：静默丢弃、不抛（1Hz 心跳会再喂）', qThrew === false);
  }
  // 渲染器晚就绪后到达的消息照常处理（上面 b 已验证）；这里钉"抛错的渲染器不外泄"。
  calls.length = 0;
  b.win.__weSetOcclusion = () => { throw new Error('pipeline rejected'); };
  threw = false;
  try { b.send(setMsg); } catch { threw = true; }
  check('渲染器 __weSetOcclusion 抛错 ⇒ 桥吞噬（异常不外泄、不影响渲染页）',
    threw === false, 'threw=' + threw);
}

// ── teardown ────────────────────────────────────────────────────────────────
try { dispose && dispose(); } catch { /* ignore */ }
rmSync(TEST_CACHE_DIR, { recursive: true, force: true });

console.log('');
if (failed > 0) {
  console.log(`OCCLUSION BRIDGE CHECKS FAILED — ${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`ALL OCCLUSION BRIDGE CHECKS PASSED (${passed})`);
// apply() 现在会拉起 occlusion hub（真实 X11 套接字 + 1Hz 心跳/30s 重试定时器），
// dispose() 已尽力清理，但适配器关闭是异步的 —— 显式退出，不让后台句柄钉住本进程。
process.exit(0);
