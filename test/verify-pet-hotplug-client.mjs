import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const pet = readFileSync(new URL('../packages/pet-link/src/pet-link.js', import.meta.url), 'utf8');
const tuner = readFileSync(new URL('../packages/pet-link/src/pet-link-tuner.js', import.meta.url), 'utf8');
function load(sharedWindow, noTimers = false) {
  let now = 0, nextId = 0, toggle = 0, post = 0, capOverride = null, delayCap = null, nativeResult = true;
  const timers = new Map(), listeners = new Map(), calls = [];
  const rect = { left: 100, top: 100, width: 640, height: 360 };
  const root = { isConnected: true, style: {}, querySelector() { return null; }, getBoundingClientRect: () => ({ ...rect }) };
  const ctl = { version: 3, target: 'main', getRoot: () => root, getPlayback: () => ({ id: 0, name: '', phase: 'ended' }),
    lock() { calls.push('lock'); return true; }, unlock() { calls.push('unlock'); return true; },
    lockBubbles() { calls.push('bubble-lock'); return true; }, unlockBubbles() { calls.push('bubble-unlock'); return true; },
    hideBubble() { calls.push('hide'); return true; }, allowBubble() {}, setBubbleDuration() {},
    adoptPosition() { calls.push('adopt'); return true; }, throwNative() {}, getNativeThrow: () => ({ active: false }), stopNativeThrow() {},
  };
  const window = sharedWindow || { innerWidth: 1200, innerHeight: 800 };
  window.__dshPetCtl = ctl;
  const document = { querySelector: selector => selector === '.dsh-pet-root' ? root : null,
    querySelectorAll: () => [], addEventListener(type, fn) { listeners.set(fn, type); }, removeEventListener(type, fn) { listeners.delete(fn); } };
  const schedule = (fn, ms, repeat = false) => { const id = ++nextId; timers.set(id, { fn, at: now + Math.max(1, ms), ms, repeat }); return id; };
  const env = { window, document, location: { origin: 'http://test' }, performance: { now: () => now }, Date: { now: () => now },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }), AbortController, fetch() {},
    apiUrl: path => '/wallpaper' + path, weT: s => s, wallSidebarToggle: () => { toggle++; return nativeResult; },
    setTimeout: (fn, ms) => schedule(fn, ms), clearTimeout: id => timers.delete(id),
    setInterval: (fn, ms) => schedule(fn, ms, true), clearInterval: id => timers.delete(id),
    requestAnimationFrame: fn => schedule(() => fn(now), 16), cancelAnimationFrame: id => timers.delete(id),
    apiFetch: async (path, init) => {
      if (path.endsWith('/capability')) {
        calls.push(['cap', init.cache]); if (delayCap) return await delayCap;
        return { ok: true, data: capOverride || capability() };
      }
      if (init?.method === 'POST') { post++; return { ok: true, data: { ok: true } }; }
      return { ok: true, data: { main: { pets: [{ id: 'main', display: 'web' }], animations: { events: { DSHWE: Object.values(api.names) } } } } };
    },
  };
  if (noTimers) { env.setTimeout = undefined; env.clearTimeout = undefined; }
  const capability = () => ({ protocol: 1, generation: 'a', enabled: true, linkEnabled: true, available: true,
    ttlMs: 1500, target: 'main', petBase: '/dsh-pet-7340', names: Object.values(api.names) });
  const api = new Function('env', 'with(env){' + tuner + '\n' + pet + `
    return { ...petLink, state:petLinkState, names:PET_ANIM, probe:petLinkProbe,
      eligible:()=>typeof petLinkEligible==='function' && petLinkEligible(),
      slow:petLinkSlowOpen, rebound:petLinkEggRebound,
      glide:()=>petLinkGlide(petLinkPetRect(),800,500,60000,()=>petLinkState.epoch===0),
      tunerRun:petLinkTunerRun,
      pendingRun:()=>{petLinkRunInner=async(logic,epoch)=>{await petLinkWait(60000);return{phase:'cancelled'};};return petLinkRun('sidebar',petLinkState.epoch);}
    };}`)(env);
  async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }
  async function advance(ms) {
    const end = now + ms;
    for (let count = 0; count < 10000; count++) {
      let id, first;
      for (const [key, timer] of timers) if (timer.at <= end && (!first || timer.at < first.at)) { id = key; first = timer; }
      if (!first) break;
      now = first.at; timers.delete(id); if (first.repeat) timers.set(id, { ...first, at: now + first.ms }); first.fn(); await flush();
    }
    now = end; await flush();
  }
  return { api, ctl, root, window, calls, timers, listeners, flush, advance, capability,
    cap(value) { capOverride = value; }, delay(value) { delayCap = value; }, native(value) { nativeResult = value; }, get toggle() { return toggle; }, get post() { return post; } };
}
let failures = 0;
async function check(name, fn) { try { await fn(); console.log('PASS ' + name); } catch (e) { failures++; console.error('FAIL ' + name + ': ' + e.message); } }
await check('未知协议、关闭联动、错误目标和缺能力控制面均不取得资格', async () => {
  for (const change of [{ protocol: 9 }, { linkEnabled: false }, { enabled: false }, { target: 'other' }]) {
    const h = load(); h.cap({ ...h.capability(), ...change }); assert.equal(await h.api.probe(), false); h.api.dispose();
  }
  for (const change of [{ version: 2 }, { target: 'pet-2' }, { getRoot: undefined }, { throwNative: undefined }]) {
    const h = load(); Object.assign(h.ctl, change); assert.equal(await h.api.probe(), false); h.api.dispose();
  }
});
await check('资格不永久缓存，短期复核无缓存且失效后自动恢复', async () => {
  const h = load(); await h.api.warmup(); assert.equal(h.api.eligible(), true);
  h.cap({ ...h.capability(), linkEnabled: false }); await h.advance(550);
  assert.equal(h.api.eligible(), false); assert.equal(h.listeners.size, 1, '资格失效保留维护热键');
  h.cap(h.capability()); await h.advance(550); assert.equal(h.api.eligible(), true);
  assert.ok(h.calls.filter(x => Array.isArray(x)).every(x => x[1] === 'no-store')); h.api.dispose(); assert.equal(h.timers.size, 0);
});
await check('失效后的点击和手势只走原生，不发点播或广播', async () => {
  const h = load(); h.cap({ ...h.capability(), available: false }); await h.api.warmup();
  await h.api.mascot.tap(); await h.api.performer.onGrab(); await h.api.performer.onPull(1);
  assert.equal(h.toggle, 1); assert.equal(h.post, 0); h.api.dispose();
});
await check('目标卸载立即取消，旧流程 finally 不清理新实例', async () => {
  const h = load(); await h.api.warmup(); const run = h.api.pendingRun(); await h.flush();
  h.root.isConnected = false; await h.advance(550);
  const afterCancel = h.calls.length; await run;
  assert.equal(h.api.eligible(), false); assert.equal(h.calls.length, afterCancel);
  h.api.dispose(); assert.equal(h.timers.size, 0);
});
await check('未响应请求可被卸载取消，迟到资格不得复活', async () => {
  const h = load(); let deliver; h.delay(new Promise(resolve => { deliver = resolve; }));
  const probe = h.api.warmup(); await h.flush(); h.api.dispose();
  deliver({ ok: true, data: h.capability() }); await h.flush(); assert.equal(await probe, false);
  assert.equal(h.api.state.available, null); assert.equal(h.timers.size, 0);
});
await check('慢开中退出即还原，旧异步不得再次 commit', async () => {
  const h = load(); await h.api.warmup(); let begin = 0, commit = 0;
  h.api.mascot.registerSidebar({ mode: 'official', beginPull() { begin++; }, commit() { commit++; } });
  const slow = h.api.slow(); await h.flush(); assert.equal(begin, 1);
  h.api.dispose(); await slow; assert.equal(commit, 1); assert.equal(h.timers.size, 0);
});
await check('连续十次启停的监视、监听和在途请求均能清空', async () => {
  const h = load();
  for (let i = 0; i < 10; i++) { await h.api.warmup(); assert.equal(h.api.eligible(), true); h.api.dispose(); assert.equal(h.timers.size, 0); assert.equal(h.listeners.size, 0); }
});
await check('反击中退出只恢复一次，迟到 finally 不触碰新样式', async () => {
  const h = load(); await h.api.warmup(); let commit = 0;
  h.api.mascot.registerSidebar({ edgeX:()=>1200, rebound() {}, commit() { commit++; } });
  const motion = h.api.rebound(()=>h.api.state.epoch === 0);
  await h.advance(20); h.api.dispose(); await h.advance(20); await motion;
  assert.equal(commit, 1);
});
await check('资格失效后的面板运行不取消原生气泡或发起请求', async () => {
  const h = load(); await h.api.warmup(); h.api.dispose(); let cancel = 0;
  h.api.state.bubbleRun = { cancel() { cancel++; } }; h.cap({ ...h.capability(), linkEnabled: false });
  const result = await h.api.tunerRun('mascot'); assert.equal(result.logic, 'disabled');
  assert.equal(cancel, 0); assert.equal(h.post, 0);
});
await check('位移中退出立即取消帧并结清 Promise，不残留 RAF', async () => {
  const h=load(); await h.api.warmup(); const motion=h.api.glide();
  h.api.dispose(); assert.equal(h.timers.size,0); assert.equal(await motion,false);
});
await check('新实例接替后旧实例重复退出不能删除新登记', async () => {
  const shared={innerWidth:1200,innerHeight:800}; const a=load(shared); await a.api.warmup();
  const b=load(shared); await b.api.warmup(); const owner=shared.__dshwePetLinkRuntime;
  a.api.dispose(); assert.equal(shared.__dshwePetLinkRuntime,owner); assert.equal(b.api.eligible(),true);
  await a.api.warmup(); assert.equal(shared.__dshwePetLinkRuntime,owner,'已被替换的旧实例不能重新接管');
  assert.equal(b.api.eligible(),true);
  assert.equal(a.timers.size,0); b.api.dispose(); assert.equal(b.timers.size,0);
});
await check('首次缺桥接仍注册维护热键，参数可导出且不能试跑', async () => {
  const h = load(); h.cap({ ...h.capability(), available: false, reason: '桥接尚未安装' });
  await h.api.warmup();
  try {
    assert.equal(h.listeners.size, 1);
    h.api.tuner.setForLogic('mascot', 'mascotDropPx', 92);
    assert.equal(h.api.tuner.snapshot().logicValues.mascot.mascotDropPx, 92);
    assert.equal((await h.api.tuner.run('mascot')).logic, 'disabled');
    assert.equal(h.post, 0);
  } finally { h.api.dispose(); }
  assert.equal(h.listeners.size, 0); assert.equal(h.timers.size, 0);
});
await check('原生侧栏拒绝处理时如实报告失败并打开维护诊断，不重复切换', async () => {
  const h = load(); h.native(false); let opened = 0;
  h.api.tuner.open = () => { opened++; return true; };
  const result = await h.api.mascot.tap();
  assert.equal(result.fallback, false); assert.ok(result.reason);
  assert.equal(opened, 1); assert.equal(h.toggle, 1); assert.equal(h.post, 0);
  h.api.dispose();
});
await check('非浏览器环境缺少计时器时不启动可选联动监视', async () => {
  const h = load(undefined, true);
  assert.equal(await h.api.warmup(), false);
  assert.equal(h.timers.size, 0); assert.equal(h.calls.length, 0);
  h.api.dispose();
});
if (failures) process.exitCode = 1;
