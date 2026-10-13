#!/usr/bin/env node
/**
 * verify-occlusion-hub.mjs — Linux 遮挡生产端（lib/occlusion/ + lib/routes/occlusion.js）
 * 的结构与行为守卫。**不依赖真实 X11**：适配器用注入的假件，纯函数直接喂用例。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────────────
 * 遮挡链路的渲染端（WebWallGL）是 vendored 黑盒，宿主端快照形状错了它只会"静默
 * 清遮挡"（rects:null ⇒ run 全速）——错误的表现不是崩溃而是"功能无声失效"。所以
 * 这里把**快照契约**（docs/wip/LINUX-OCCLUSION.md §1/§3：字段集、rects 相对化、
 * 降级形态、gen 语义、永不抛错）钉成机检，让偏差在 CI 红而不是在用户桌面上哑。
 *
 * ── 判据面 ──────────────────────────────────────────────────────────────────
 *   A. rects.js 纯函数：裁剪/去零面积/合并（含负对照：坏矩形必须被丢）；
 *   B. hub 快照契约：x11 成功形态（相对化 + 字段集）、内容不变 gen 不动、
 *      适配器死亡 ⇒ 降级形态（backend none + rects null）且不抛、getSnapshot 永不空；
 *   C. 会话门：Wayland / 无 DISPLAY / 非 linux ⇒ 不走 X11（负对照三条）；
 *   D. 路由族静态：exact 路径模板、GET-only、sendJson 单一实现（无内联 JSON 样板）。
 *
 * Usage:  node test/verify-occlusion-hub.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { clipRect, cleanOccluders, rectsArea } from '../lib/occlusion/rects.js';
import { createOcclusionHub } from '../lib/occlusion/index.js';
import { isX11CandidateEnv } from '../lib/occlusion/x11.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let checked = 0; // F1 地板统计的是**执行过的判据数**（评审 F7：失败多条时地板不失真）
const check = (name, fn) => {
  checked++;
  try {
    fn();
    passed++;
    console.log(`PASS | ${name}`);
  } catch (err) {
    console.error(`FAIL | ${name}: ${err && err.message}`);
    process.exitCode = 1;
  }
};
const checkAsync = async (name, fn) => {
  checked++;
  try {
    await fn();
    passed++;
    console.log(`PASS | ${name}`);
  } catch (err) {
    console.error(`FAIL | ${name}: ${err && err.message}`);
    process.exitCode = 1;
  }
};

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** 假适配器：脚本化 poll 序列，模拟 X11 采集成功/失败。 */
function fakeAdapter(script) {
  let i = 0;
  const listeners = new Set();
  return {
    start: async () => {},
    poll: async () => {
      const step = script[Math.min(i, script.length - 1)];
      i++;
      if (step === 'die') return null;
      if (step instanceof Error) throw step;
      return step;
    },
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    stop: () => {},
    emit: () => { for (const fn of listeners) fn(); },
  };
}

// ── A. rects.js ──────────────────────────────────────────────────────────────
check('A1 clipRect 相交裁剪', () => {
  assert.deepEqual(clipRect([0, 0, 100, 100], [50, 50, 100, 100]), [50, 50, 50, 50]);
});
check('A2 clipRect 不相交 ⇒ null（负对照）', () => {
  assert.equal(clipRect([200, 200, 10, 10], [0, 0, 100, 100]), null);
});
check('A3 cleanOccluders 丢零面积/越界出界矩形（负对照）', () => {
  const own = [0, 0, 800, 600];
  assert.deepEqual(cleanOccluders([[0, 0, 0, 0], [400, 0, 200, 100], [900, 900, 5, 5]], own), [[400, 0, 200, 100]]);
});
check('A4 cleanOccluders 合并相触矩形', () => {
  const own = [0, 0, 800, 600];
  assert.deepEqual(cleanOccluders([[0, 0, 100, 50], [0, 50, 100, 50]], own), [[0, 0, 100, 100]]);
});
check('A5 rectsArea 含重叠语义', () => {
  assert.equal(rectsArea([[0, 0, 10, 10], [0, 0, 10, 10]]), 200);
});
check('A6 仅角相触的矩形不合并（负对照：面积虚高守卫）', () => {
  const own = [0, 0, 800, 600];
  const out = cleanOccluders([[0, 0, 100, 100], [100, 100, 100, 100]], own);
  assert.deepEqual(out.map((r) => r.join(',')), ['0,0,100,100', '100,100,100,100'],
    '角触（两轴都零重叠）必须保持两个矩形，并包会虚报一倍面积');
});

// ── B. hub 快照契约 ──────────────────────────────────────────────────────────
// 会话门一律注入：缺省的 isCandidate 读真实环境（linux + DISPLAY），macOS / Windows /
// 无头 CI 上会让 hub 直接降级成 none，B 组断言的就不再是快照契约而是运行环境。
const hubFor = (opts) => createOcclusionHub({ isCandidate: () => true, ...opts });
const X11_OK = {
  own: { x: 100, y: 50, w: 800, h: 600 },
  occluders: [[100, 50, 400, 300], [500, 50, 400, 200]],
  epoch: 'x11::display=:1',
};

await checkAsync('B1 成功快照：rects 相对化 + 字段集完整', async () => {
  const hub = hubFor({ createAdapter: () => fakeAdapter([X11_OK]) });
  await hub.start();
  const s = hub.getSnapshot();
  assert.equal(s.ok, 1);
  assert.equal(s.backend, 'x11');
  assert.equal(s.epoch, 'x11::display=:1');
  assert.deepEqual(s.own, { w: 800, h: 600 });
  assert.deepEqual(s.rects, [[0, 0, 400, 300], [400, 0, 400, 200]]);
  assert.equal(typeof s.gen, 'number');
  assert.equal(typeof s.ts, 'number');
  hub.dispose();
});
await checkAsync('B2 内容不变 ⇒ gen 不递增；内容变 ⇒ gen+1', async () => {
  const adapter = fakeAdapter([X11_OK]);
  const hub = hubFor({ createAdapter: () => adapter, pollMs: 10 });
  await hub.start();
  const g1 = hub.getSnapshot().gen;
  await sleep(25); // 走两跳相同内容
  assert.equal(hub.getSnapshot().gen, g1);
  await hub.dispose();
  // 第二阶段：内容变化（own 变了）
  const adapter2 = fakeAdapter([X11_OK, { ...X11_OK, occluders: [[100, 50, 400, 300]] }]);
  const hub2 = hubFor({ createAdapter: () => adapter2, pollMs: 10 });
  await hub2.start();
  const gA = hub2.getSnapshot().gen;
  await sleep(25);
  assert.equal(hub2.getSnapshot().gen, gA + 1, '内容变化必须 gen+1');
  await hub2.dispose();
});
await checkAsync('B3 适配器死亡 ⇒ 降级形态且不抛（负对照）', async () => {
  const hub = hubFor({ createAdapter: () => fakeAdapter([X11_OK, 'die']), pollMs: 10, retryStartMs: 1000 });
  await hub.start();
  const before = hub.getSnapshot();
  assert.equal(before.backend, 'x11');
  await sleep(25);
  const after = hub.getSnapshot();
  assert.equal(after.backend, 'none');
  assert.equal(after.rects, null);
  assert.equal(after.own, null);
  assert.equal(after.ok, 1);
  assert.equal(after.ts >= before.ts, true, '降级也要刷新 ts（心跳契约）');
  await hub.dispose();
});
await checkAsync('B4 getSnapshot 永不空/永不抛（从未启动也安全）', async () => {
  const hub = hubFor({ createAdapter: () => fakeAdapter([X11_OK]) });
  const s = hub.getSnapshot();
  assert.equal(s.ok, 1);
  hub.dispose();
  hub.dispose(); // 幂等
});
await checkAsync('B5 非候选会话 ⇒ 初始即降级且不建适配器', async () => {
  let built = 0;
  const hub = hubFor({
    createAdapter: () => { built++; return fakeAdapter([X11_OK]); },
    isCandidate: () => false,
    retryStartMs: 1000,
  });
  await hub.start();
  await sleep(5);
  assert.equal(built, 0, '非 X11 会话不得构造适配器');
  assert.equal(hub.getSnapshot().backend, 'none');
  await hub.dispose();
});
check('B6 快照字段只许这一套（契约面收缩守卫）', () => {
  const hub = hubFor({ createAdapter: () => fakeAdapter([X11_OK]) });
  const s = hub.getSnapshot();
  assert.deepEqual(Object.keys(s).sort(), ['backend', 'epoch', 'gen', 'ok', 'own', 'rects', 'ts']);
  hub.dispose();
});
await checkAsync('B7 降级后重试必须真的重建适配器（评审 P1：started 复位回归钉）', async () => {
  let built = 0;
  const hub = hubFor({
    createAdapter: () => {
      built++;
      if (built === 1) {
        return { ...fakeAdapter([X11_OK]), start: async () => { throw new Error('boom'); } };
      }
      return fakeAdapter([X11_OK]);
    },
    pollMs: 10,
    retryStartMs: 30,
  });
  await hub.start();
  assert.equal(hub.getSnapshot().backend, 'none', '首次 start 失败 ⇒ 降级');
  await sleep(120); // 重试窗口（30ms）过后适配器应重建
  assert.equal(built, 2, '重试必须真的重建适配器（不复位 started 就是死代码）');
  assert.equal(hub.getSnapshot().backend, 'x11', '重建后恢复 x11');
  await hub.dispose();
});
await checkAsync('B8 poll 永挂 ⇒ 看门狗超时降级（评审 P1：busy 卡死防线）', async () => {
  const hub = hubFor({
    createAdapter: () => ({ ...fakeAdapter([X11_OK]), poll: () => new Promise(() => {}) }),
    pollTimeoutMs: 30,
    retryStartMs: 60_000, // 测试窗口内不让重试插进来
  });
  await hub.start();
  await sleep(80);
  assert.equal(hub.getSnapshot().backend, 'none', '挂起的 poll 必须被看门狗打断并降级');
  await hub.dispose();
});
await checkAsync('B9 getSnapshot 返回拷贝（原地改写不污染内部态，评审 P2）', async () => {
  const hub = hubFor({ createAdapter: () => fakeAdapter([X11_OK]) });
  await hub.start();
  const a = hub.getSnapshot();
  a.own.w = 1;
  a.rects[0][0] = 999;
  a.rects.push([9, 9, 9, 9]);
  const b = hub.getSnapshot();
  assert.equal(b.own.w, 800, 'own 改写不得穿透');
  assert.equal(b.rects[0][0], 0, 'rects 改写不得穿透');
  assert.equal(b.rects.length, 2, 'rects 增删不得穿透');
  await hub.dispose();
  await hub.dispose(); // 幂等
});

// ── C. 会话门 ────────────────────────────────────────────────────────────────
check('C1 X11 候选：linux + DISPLAY、无 WAYLAND_DISPLAY', () => {
  assert.equal(isX11CandidateEnv({ DISPLAY: ':1' }, 'linux'), true);
});
check('C2 Wayland 会话禁走 X11（负对照）', () => {
  assert.equal(isX11CandidateEnv({ DISPLAY: ':1', WAYLAND_DISPLAY: 'wayland-0' }, 'linux'), false);
});
check('C3 无 DISPLAY / 非 linux 禁走（负对照×2）', () => {
  assert.equal(isX11CandidateEnv({}, 'linux'), false);
  assert.equal(isX11CandidateEnv({ DISPLAY: ':1' }, 'darwin'), false);
});

// ── D. 路由族静态 ────────────────────────────────────────────────────────────
const routeSrc = readFileSync(join(ROOT, 'lib/routes/occlusion.js'), 'utf8');
check('D1 exact 路径模板与 c 解构形态', () => {
  assert.match(routeSrc, /kind: 'exact'/);
  assert.match(routeSrc, /const \{ disposers, base: BASE, hub, log, diag \} = c;/);
  assert.match(routeSrc, /path: `\$\{BASE\}\/occlusion`/);
});
check('D2 GET-only + 405 + sendJson 单一实现', () => {
  assert.match(routeSrc, /req\.method !== 'GET'/);
  assert.match(routeSrc, /setHeader\('Allow', 'GET'\)/);
  assert.match(routeSrc, /sendJson\(res, 405/);
  // 用 includes 而非 import 正则字面量：P5 的裸包导入扫描会把「引号后紧跟 \.」
  // 的正则文本误判成裸包导入（offenders 列表里出现过 '\.\./json-response.js'）。
  assert.ok(routeSrc.includes("import { sendJson } from"), '必须 import sendJson');
  assert.ok(routeSrc.includes("'../json-response.js'"), '必须来自共享实现 json-response');
  assert.doesNotMatch(routeSrc, /res\.end\(/, '路由族不得出现内联 JSON 样板');
});
check('D3 lib/index.js 接线：语句形态 + hub 生命周期', () => {
  // ⚠️ 归一成 LF 再匹配：下面两条正则都是**跨行**形态（把 `\n` 当行界），而 CI 的 Windows 检出
  //    是 CRLF（`core.autocrlf=true`）⇒ 不归一时这两条在 ubuntu 上绿、在 windows 上红
  //    （实测：本判据第一次跑 windows-latest 就是这么红的，报"input did not match"）。
  //    与 verify-glass-surfaces / verify-scene-live / verify-client 同一口径、同一处方。
  const idx = readFileSync(join(ROOT, 'lib/index.js'), 'utf8').replace(/\r\n?/g, '\n');
  assert.ok(idx.includes("import { registerOcclusionRoutes } from './routes/occlusion.js';"));
  assert.ok(idx.includes("import { createOcclusionHub } from './occlusion/index.js';"));
  assert.match(idx, /^\s*registerOcclusionRoutes\(webServer, \{\n\s*disposers, base: BASE, hub: occlusionHub,\n\s*log: log\.tag\('occlusion'\),\n\s*diag: \(obj\) => appendDiagLine\('occlusion', obj\),\n\s*\}\);/m);
  assert.match(idx, /createOcclusionHub\(\{\n\s*log: log\.tag\('occlusion'\),\n\s*diag: \(obj\) => appendDiagLine\('occlusion', obj\),\n\s*\}\)/);
  assert.match(idx, /disposers\.push\(\(\) => occlusionHub\.dispose\(\)\);/);
});

// ── E. 路由 handler 运行时行为（真实执行 handler，不只文本棘轮）──────────────
const { registerOcclusionRoutes } = await import('../lib/routes/occlusion.js');
function fakeWebServer() {
  const routes = [];
  return { routes, register: (r) => { routes.push(r); return () => {}; } };
}
function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    end(b) { this.body = String(b); },
  };
}
const SNAPSHOT = { ok: 1, backend: 'x11', epoch: 'x11::display=:1', gen: 7, own: { w: 800, h: 600 }, rects: [[1, 2, 3, 4]], ts: 123 };
await checkAsync('E1 GET → 200 + no-store + 快照逐字直发', async () => {
  const ws = fakeWebServer();
  registerOcclusionRoutes(ws, { disposers: [], base: '/wallpaper-engine', hub: { getSnapshot: () => SNAPSHOT } });
  const res = fakeRes();
  await ws.routes[0].handler({ method: 'GET', url: '/wallpaper-engine/occlusion' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.deepEqual(JSON.parse(res.body), SNAPSHOT);
});
await checkAsync('E2 POST → 405 + Allow: GET + ok:0 体', async () => {
  const ws = fakeWebServer();
  registerOcclusionRoutes(ws, { disposers: [], base: '/wallpaper-engine', hub: { getSnapshot: () => SNAPSHOT } });
  const res = fakeRes();
  await ws.routes[0].handler({ method: 'POST', url: '/wallpaper-engine/occlusion' }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'GET');
  assert.equal(JSON.parse(res.body).ok, 0);
});
await checkAsync('E3 trace=1：GET 与 405 都逐请求 log+diag（评审 F2）', async () => {
  const ws = fakeWebServer();
  const logLines = [], diagLines = [];
  registerOcclusionRoutes(ws, {
    disposers: [], base: '/wallpaper-engine', hub: { getSnapshot: () => SNAPSHOT },
    log: (l) => logLines.push(l), diag: (o) => diagLines.push(o),
  });
  const prev = process.env.DSH_WE_OCCLUSION_TRACE;
  process.env.DSH_WE_OCCLUSION_TRACE = '1';
  try {
    await ws.routes[0].handler({ method: 'GET', url: '/x' }, fakeRes());
    await ws.routes[0].handler({ method: 'POST', url: '/x' }, fakeRes());
  } finally {
    if (prev === undefined) delete process.env.DSH_WE_OCCLUSION_TRACE;
    else process.env.DSH_WE_OCCLUSION_TRACE = prev;   // eslint-disable-line require-atomic-updates -- 顺序 await 的判据；env 无并发读写
  }
  assert.equal(logLines.length, 2, 'GET 一行 + 405 一行');
  assert.deepEqual(diagLines.map((o) => o.ev), ['get', '405']);
});
await checkAsync('E4 无 trace ⇒ 零留痕；c 缺 log/diag 也不炸（评审 F1）', async () => {
  delete process.env.DSH_WE_OCCLUSION_TRACE;
  const ws = fakeWebServer();
  const logLines = [], diagLines = [];
  registerOcclusionRoutes(ws, {
    disposers: [], base: '/wallpaper-engine', hub: { getSnapshot: () => SNAPSHOT },
    log: (l) => logLines.push(l), diag: (o) => diagLines.push(o),
  });
  await ws.routes[0].handler({ method: 'GET', url: '/x' }, fakeRes());
  await ws.routes[0].handler({ method: 'PUT', url: '/x' }, fakeRes());
  assert.equal(logLines.length, 0);
  assert.equal(diagLines.length, 0);
  // c 连 log/diag 都不给 + trace 开着：可观测性缺省不得升级成 unhandled rejection
  const ws2 = fakeWebServer();
  registerOcclusionRoutes(ws2, { disposers: [], base: '/wallpaper-engine', hub: { getSnapshot: () => SNAPSHOT } });
  process.env.DSH_WE_OCCLUSION_TRACE = '1';   // eslint-disable-line require-atomic-updates -- 顺序 await 的判据；env 无并发读写
  try {
    const res2 = fakeRes();
    await ws2.routes[0].handler({ method: 'GET', url: '/x' }, res2);
    assert.equal(res2.statusCode, 200);
  } finally {
    delete process.env.DSH_WE_OCCLUSION_TRACE;
  }
});

// ── 覆盖面地板 ───────────────────────────────────────────────────────────────
check('F1 覆盖面地板：本文件至少 15 项判据', () => {
  assert.ok(checked >= 15, `实际 ${checked} 项`);
});

if (process.exitCode) {
  console.error(`${process.exitCode} OCCLUSION HUB CHECK(S) FAILED`);
} else {
  console.log(`ALL OCCLUSION HUB CHECKS PASSED (${passed})`);
}
// 显式退出：断言中途失败时 hub.dispose() 不会被执行，残留的轮询/重试定时器会让进程永不退出。
process.exit(process.exitCode || 0);
