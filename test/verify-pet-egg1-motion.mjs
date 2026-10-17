#!/usr/bin/env node
/** 虚拟时钟执行真实彩蛋一排播、站位、位移与收尾。 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const tuner = readFileSync(new URL('../packages/pet-link/src/pet-link-tuner.js', import.meta.url), 'utf8');
const pet = readFileSync(new URL('../packages/pet-link/src/pet-link.js', import.meta.url), 'utf8');
function load(options = {}) {
  let now = 0, serial = 0;
  const tasks = new Map(), events = [];
  const record = (type, value) => events.push({ type, value, at: now });
  const schedule = (fn, ms) => { const id = ++serial; tasks.set(id, { fn, at: now + Math.max(0, ms) }); return id; };
  const env = { options, record, window: { innerWidth: 1600, innerHeight: 900 },
    setTimeout: schedule, clearTimeout: id => tasks.delete(id), setInterval: undefined, clearInterval: undefined, requestAnimationFrame: fn => schedule(fn, 10),
    performance: { now: () => now }, weT: x => x };
  const mod = new Function(...Object.keys(env), tuner + '\n' + pet + `
    let locked = false;
    const style = { transform: '' };
    const el = { style: new Proxy(style, { set(target, key, value) {
      target[key] = value; record('transform', { value, offset: { ...petLinkState.offset } }); return true;
    } }) };
    petLinkPetEl = () => el;
    let baseX=options.left??600,baseY=100;
    petLinkPetRect = () => ({ left: baseX + petLinkState.offset.x,
      top: baseY + petLinkState.offset.y, width: options.width ?? 100, height: 100 });
    let flightId=0,flightEnd=0;
    petLinkPetCtl = () => ({ lock(name) { locked = true; record('lock', name); return true; },
      unlock() { locked = false; record('unlock'); }, setBubbleDuration() {}, hideBubble() {},
      adoptPosition(point) {baseX=point.x-(options.width??100)/2;baseY=point.y-50;return true;},
      throwNative(point, velocity) { baseX=point.x-(options.width??100)/2;baseY=point.y-50;record('throw', {point,velocity}); flightEnd=performance.now()+500; return ++flightId; },
      getNativeThrow(id) { return {active:id===flightId && performance.now()<flightEnd,cancelled:id!==flightId}; },
      stopNativeThrow(id) { if(id!==flightId)return false;flightId++;record('stop');return true; } });
    petLinkProbe = async () => true;
    petLinkEligible = () => true;
    let eventsWalked = false;
    petLinkPost = async (url, body) => {
      if (!url.includes('/anim?')) return true;
      const key = Object.keys(PET_ANIM).find(key => PET_ANIM[key] === body.name);
      record('request', key);
      await petLinkWait(key === 'eggFlung' ? options.ackMs || 0 :
        key.startsWith('walk') && eventsWalked ? options.returnAckMs || 0 : 0);
      if (key.startsWith('walk')) eventsWalked = true;
      if (key === 'eggFlung' && options.failPlay) return false;
      record('animation', key);
      return true;
    };
    petLinkSay = async text => { record('bubble', text); return true; };
    petLinkState.activeLogic = 'egg1';
    petLinkState.offset = { x: 0, y: 0 };
    petLinkState.available = true;
    let edge=options.edge??1600;
    const sidebar = { edgeX: () => edge,
      rebound(open) { edge=open?(options.edge??1600)-300:options.edge??1600;record(open?'open':'close'); },
      commit() {}, open() { record('open'); }, close() { record('close'); }, isOpen: () => true };
    petLinkMascot.registerSidebar(sidebar);
    return { tuner: petLinkTuner, state: petLinkState, style,
      body: () => petLinkBodyRect(), toe: () => petLinkEggAnchorX(petLinkPetRect(),425/640), locked: () => locked,
      fling: alive => petLinkFlingAway(alive || (() => true)),
      run: () => petLinkTuner.run('egg1'), dispose: () => petLink.dispose() };
  `)(...Object.values(env));
  async function flush() { for (let i = 0; i < 32; i++) await Promise.resolve(); }
  async function advance(to) {
    await flush();
    for (let count = 0; count < 40000; count++) {
      let first;
      for (const [id, task] of tasks) if (!first || task.at < first.task.at) first = { id, task };
      if (!first || first.task.at > to) { now = to; await flush(); return; }
      assert.ok(first.task.at >= now); now = first.task.at; tasks.delete(first.id); first.task.fn(); await flush();
    }
    throw new Error('虚拟时钟任务未收敛');
  }
  return { ...mod, events, advance, set: (key, value) => mod.tuner.setForLogic('egg1', key, value) };
}
const timing = h => {
  for (const [key, value] of Object.entries({ egg1WalkMs: 100, egg1LeadMs: 100,
    egg1KickMs: 300, egg1FlungMs: 600, egg1LandMs: 400,
    egg1EdgeGapPx: 80, egg1FlingDelayMs: 200, egg1FlingPx: 120, egg1FlingMs: 500, egg1PostLandMs: 300 })) h.set(key, value);
};
const animation = (h, key) => h.events.find(e => e.type === 'animation' && e.value === key);
let failures = 0;
async function check(name, fn) { try { await fn(); console.log('PASS ' + name); } catch (e) { failures++; console.error('FAIL ' + name + ': ' + e.message); } }
await check('新增距离/延迟/停留可独立设置导出和当前重置', () => {
  const h = load(); const before = h.tuner.snapshot(); timing(h);
  for (const key of ['egg1EdgeGapPx', 'egg1FlingDelayMs', 'egg1PostLandMs']) {
    assert.equal(typeof h.tuner.snapshot().defaults[key], 'number', key);
    assert.equal(h.tuner.snapshot().logicTuning.egg1[key], { egg1EdgeGapPx: 80, egg1FlingDelayMs: 200, egg1PostLandMs: 300 }[key]);
  }
  h.tuner.reset('egg1'); const after = h.tuner.snapshot();
  assert.deepEqual(after.logicValues.sidebar, before.logicValues.sidebar);
  assert.deepEqual(after.logicValues.mascot, before.logicValues.mascot);
  assert.equal(after.logicValues.egg1.egg1EdgeGapPx, after.defaults.egg1EdgeGapPx);
});
await check('脚尖与当前侧栏边缘保留独立正间距，不受逻辑一手位影响', async () => {
  const h = load({ edge: 1300 }); timing(h); h.tuner.setForLogic('sidebar', 'handRightRatio', 0.99);
  const pending = h.run(); await h.advance(150);
  assert.ok(Math.abs(h.toe() - 1220) < 0.01, String(h.toe()));
  h.dispose(); await h.advance(10000); await pending;
});
await check('负间距向侧栏靠近，可精调踢腿接触点', async () => {
  const h = load(); timing(h); h.set('egg1EdgeGapPx', -15);
  const pending = h.run(); await h.advance(150);
  assert.ok(Math.abs(h.toe() - 1615) < 0.01, String(h.toe()));
  h.dispose(); await h.advance(10000); await pending;
});
await check('点播确认加延迟后才进入原生抛掷，距离与耗时共同确定初速', async () => {
  const h=load({ackMs:600}); timing(h);const p=h.run();await h.advance(1000);
  assert.equal(animation(h,'eggFlung'),undefined);assert.equal(h.events.find(e=>e.type==='throw'),undefined);
  await h.advance(1290);assert.equal(animation(h,'eggFlung').at,1100);assert.equal(h.events.find(e=>e.type==='throw'),undefined);
  await h.advance(1400);const launch=h.events.find(e=>e.type==='throw');assert.equal(launch.at,1300);
  assert.deepEqual(launch.value.velocity,{vx:-240,vy:-156});await h.advance(10000);await p;
});
await check('小于20像素仍触发原生初速，零距离关闭抛掷', async () => {
  const h=load();h.set('egg1FlingPx',5);h.set('egg1FlingMs',100);const p=h.fling();await h.advance(600);assert.equal(await p,true);
  assert.equal(h.events.find(e=>e.type==='throw').value.velocity.vx,-50);
  h.set('egg1FlingPx',0);const n=h.events.length;assert.equal(await h.fling(),false);assert.equal(h.events.length,n);
});
await check('大距离限制初速，边缘反弹交由同款原生物理决定', async () => {
  const h=load({left:0,width:640});h.set('egg1FlingPx',5000);h.set('egg1FlingMs',0);const p=h.fling();await h.advance(600);assert.equal(await p,true);
  assert.deepEqual(h.events.find(e=>e.type==='throw').value.velocity,{vx:-3200,vy:-1600});
});
await check('落地停留到点后自动回原位并解锁，不等待侧栏状态', async () => {
  const h = load(); timing(h); let done = false; const pending = h.run().then(result => { done = true; return result; });
  await h.advance(10000); assert.equal(done, true, '侧栏始终报告打开也必须自行收尾');
  const landed = animation(h, 'eggLand');
  const request = h.events.filter(e => e.type === 'request' && e.value.startsWith('walk')).at(-1);
  assert.equal(request.at, landed.at + 400 + 300);
  assert.equal(h.locked(), false); assert.equal(h.state.runner.busy, false);
  assert.deepEqual(h.state.offset, { x: 0, y: 0 }); assert.equal(h.state.lastResult.phase, 'done'); await pending;
});
await check('主演出先释放，回程确认后走完整段再独立解锁', async () => {
  const h = load({ returnAckMs: 1000 }); timing(h); let done = false;
  h.run().then(() => { done = true; }); await h.advance(5000);
  assert.equal(done, false); assert.equal(h.locked(), true);
  const returned = h.events.filter(e => e.type === 'animation' && e.value.startsWith('walk')).at(-1);
  const mainUnlock = h.events.find(e => e.type === 'unlock');
  assert.ok(mainUnlock.at < returned.at, JSON.stringify({ returned, mainUnlock }));
  await h.advance(15000); assert.equal(done,true); assert.equal(h.locked(), false);
  const unlock = h.events.filter(e=>e.type==='unlock').at(-1);
  assert.ok(unlock.at >= returned.at + 5167, JSON.stringify({returned,unlock}));
});
await check('点播失败不启动弹飞位移，仍然有限收尾', async () => {
  const h = load({ failPlay: true }); timing(h); let done = false; h.run().then(() => { done = true; });
  await h.advance(1200);
  assert.equal(h.events.find(e=>e.type==='throw'),undefined);
  await h.advance(10000); assert.equal(done, true); assert.equal(h.locked(), false);
});
await check('弹飞中取消即时归零，旧帧不再写位移', async () => {
  const h = load(); timing(h); const pending = h.run(); await h.advance(1000);
  h.dispose(); const count = h.events.filter(e => e.type === 'transform').length;
  await h.advance(2000); assert.deepEqual(h.state.offset, { x: 0, y: 0 });
  assert.ok(h.events.filter(e => e.type === 'transform').slice(count).every(e => e.value.offset.x === 0 && e.value.offset.y === 0));
  await h.advance(10000); await pending;
});
await check('弹飞延迟期间取消不再启动，落地停留期间取消不再返回', async () => {
  for (const at of [700, 2100]) {
    const h = load(); timing(h); const pending = h.run(); await h.advance(at); h.dispose();
    const count = h.events.filter(e => e.type === 'transform').length;
    await h.advance(10000); await pending;
    assert.ok(h.events.filter(e => e.type === 'transform').slice(count).every(e => e.value.offset.x === 0 && e.value.offset.y === 0), '取消时刻 ' + at);
    assert.equal(h.locked(), false);
  }
});
await check('弹飞延迟加位移长于素材时必须等完再落地', async () => {
  const h = load(); timing(h); h.set('egg1FlingDelayMs', 900); h.set('egg1FlingMs', 800);
  const pending = h.run(); await h.advance(700);
  await h.advance(1600); assert.equal(animation(h, 'eggLand'), undefined);
  const ack = animation(h, 'eggFlung');const hit=h.events.find(e=>e.type==='throw');assert.equal(hit.at,ack.at+900);
  await h.advance(10000); await pending;
  assert.ok(animation(h, 'eggLand').at >= hit.at + 500);
  assert.equal(h.locked(), false);
});
await check('等待回程确认或回位中取消后无迟到锁和位移', async () => {
  for (const at of [2500, 3100]) {
    const h = load({ returnAckMs: 700 }); timing(h); const pending = h.run(); await h.advance(at);
    h.dispose(); await h.advance(10000); await pending;
    assert.equal(h.locked(), false); assert.deepEqual(h.state.offset, { x: 0, y: 0 });
  }
});
await check('自然收尾后能再次触发彩蛋一，不遗留busy或动画锁', async () => {
  const h = load(); timing(h); const first = h.run(); await h.advance(10000); assert.deepEqual(await first, { busy: false, logic: 'egg1' });
  const second = h.run(); await h.advance(20000); assert.deepEqual(await second, { busy: false, logic: 'egg1' });
  assert.equal(h.events.filter(e => e.type === 'animation' && e.value === 'eggLand').length, 2);
  assert.equal(h.state.runner.busy, false); assert.equal(h.locked(), false);
  assert.deepEqual(h.state.offset, { x: 0, y: 0 });
});
if (failures) process.exitCode = 1;
