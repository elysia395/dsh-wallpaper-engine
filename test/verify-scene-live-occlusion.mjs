#!/usr/bin/env node
/**
 * verify-scene-live-occlusion.mjs — 遮挡入口曝光 + 父页消息桥 + 宿主 HTML 注入的机检
 * （规格：docs/wip/LINUX-OCCLUSION.md §5/§8；沿 test/verify-scene-live.mjs 的
 *  mock webServer + 真实 handler 请求模式）。
 *
 * Levels:
 *   A. 渲染页曝光：lib/webwallgl/renderer.js 里 `window.__weSetOcclusion` 恰好一处；
 *      把曝光语句抠出来在假 realm 里跑真源码 —— 验证调用穿透到 `inst.setOcclusion`
 *      与异常吞噬。
 *   B. 注入（真实请求）：GET /scene-live/index.html 的响应体在 <head> 后带
 *      `<script src=…/occlusion-bridge.js?v=<插件版本>>`，其余字节与盘上文件一致，
 *      缓存头语义不变（no-store）；目录形态同样注入；引擎文件 / 兜底页不受影响；
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
import { Writable } from 'node:stream';
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

// ── Level A: 渲染页曝光 ──────────────────────────────────────────────────────
console.log('Level A — 渲染页 lib/webwallgl/renderer.js 曝光 window.__weSetOcclusion');
const rendererPath = join(root, 'lib', 'webwallgl', 'renderer.js');
const rendererSrc = readFileSync(rendererPath, 'utf8');
// 契约钉死：曝光全局名与入参语义（规格 §5：入参 = setOcclusion payload，null 合法）。
const EXPOSURE_HEAD = 'window.__weSetOcclusion = (payload) => {';
const exposureCount = rendererSrc.split(EXPOSURE_HEAD).length - 1;
check('renderer.js 恰好曝光一处 window.__weSetOcclusion', exposureCount === 1, 'count=' + exposureCount);
// 从曝光起点做花括号配平，抠出整条语句（含收尾 `;`）。
function extractExposure(src) {
  const at = src.indexOf(EXPOSURE_HEAD);
  if (at < 0) return '';
  let depth = 0;
  for (let i = at + EXPOSURE_HEAD.length - 1; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, src[i + 1] === ';' ? i + 2 : i + 1);
  }
  return '';
}
const exposureStmt = extractExposure(rendererSrc);
check('曝光语句可抠出（花括号配平）', exposureStmt.length > EXPOSURE_HEAD.length, exposureStmt.length + ' chars');
check('负对照：抠取器对缺曝光的源码返回空串', extractExposure(rendererSrc.replace(EXPOSURE_HEAD, '')) === '');
// 行为断言：抠出曝光语句在假 realm 里跑真源码 —— 调用穿透 + 异常吞噬。
if (exposureStmt) {
  const calls = [];
  const inst = { setOcclusion(p) { calls.push(p); } };
  const win = {};
  new Function('window', 'inst', exposureStmt)(win, inst);
  const payload = { occluders: [[0, 0, 100, 100]], epoch: 'x11::display=:1', gen: 7 };
  win.__weSetOcclusion(payload);
  win.__weSetOcclusion(null);   // null = 清除、回 run（合法入参）
  win.__weSetOcclusion(undefined);
  check('曝光真源码：调用穿透（payload 原样到达 inst.setOcclusion，null/undefined 归一为 null）',
    calls.length === 3 && calls[0] === payload && calls[1] === null && calls[2] === null,
    'calls=' + calls.length);
  inst.setOcclusion = () => { throw new Error('renderer blew up'); };
  let threw = false;
  try { win.__weSetOcclusion(payload); } catch { threw = true; }
  check('曝光真源码：渲染器抛错被吞噬（不外泄到调用方）', threw === false);
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
// 不 bump 版本也会换 URL（评审 C6）。
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
  check('桥 script 注入在 <head> 之后、引擎与渲染页脚本之前',
    atTag !== -1 && body.indexOf('<head') !== -1 && body.indexOf('<head') < atTag
      && atTag < body.indexOf('./engine/') && atTag < body.indexOf('./renderer.js'),
    'head<' + atTag + '<engine@' + body.indexOf('./engine/'));
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
  // 引擎不受注入影响：可重验证缓存 + 字节与 npm 依赖里的文件一致（路由不碰引擎字节）。
  const engineRef = (/<script\s+src="\.\/engine\/([^"]+)"/.exec(diskIndex) || [])[1] || '';
  const engineBytes = engineRef ? readFileSync(join(root, 'node_modules', 'webwallgl', engineRef)) : Buffer.alloc(0);
  const engineRes = await runHandler(liveRoute, '/wallpaper-engine/scene-live/engine/' + engineRef);
  check('引擎文件 must-revalidate + 字节不变（注入只作用于 index.html）',
    Boolean(engineRef) && engineRes.__state.status === 200 && /must-revalidate/.test(h(engineRes, 'Cache-Control'))
      && engineRes.__state.body.equals(engineBytes),
    'engine=' + engineRef + ' cc=' + h(engineRes, 'Cache-Control') + ' bytes=' + engineRes.__state.body.length);
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
  // ⚠️ `stdio: 'ignore'` 而不是 `'pipe'`：某些沙箱（本会话实测）禁止子进程管道捕获 ⇒ EPERM，
  // 会让这条"语法是否合法"的判据因为**环境限制**而报假红（脚本本身 `node --check` 是通过的）。
  try { execFileSync(process.execPath, ['--check', join(root, 'lib', 'webwallgl', 'occlusion-bridge.js')], { stdio: 'ignore' }); return true; }
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
try { if (dispose) dispose(); } catch { /* ignore */ }
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
