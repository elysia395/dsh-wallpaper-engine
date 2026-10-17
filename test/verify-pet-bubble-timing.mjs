#!/usr/bin/env node
/** 以虚拟时钟执行真实气泡调度与四条排播，不启动宿主，不运行全套门禁。 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const tuner = readFileSync(new URL('../packages/pet-link/src/pet-link-tuner.js', import.meta.url), 'utf8');
const pet = readFileSync(new URL('../packages/pet-link/src/pet-link.js', import.meta.url), 'utf8');
function load(options = {}) {
  let now = 0, next = 0;
  const timers = new Map();
  const events = [];
  const env = {
    options,
    performance: { now: () => now }, weT: text => text,
    setTimeout: (fn, ms) => { const id = ++next; timers.set(id, { at: now + Math.max(0, ms), fn }); return id; },
    clearTimeout: id => timers.delete(id),
    record: (type, value) => events.push({ type, value, at: now }),
  };
  const mod = new Function(...Object.keys(env), tuner + '\n' + pet + `
    petLinkSay = async (text, image) => { record('show', text); record('show-image', image); return true; };
    petLinkBubbleHide = () => { record('hide'); return true; };
    petLinkBubbleDuration = ms => { record('duration', ms); return true; };
    petLinkAnimLock = () => true;
    petLinkPlay = async key => { petLinkState.lastKey = PET_ANIM[key]; record('animation', key); return true; };
    petLinkPetRect = () => ({ left: 100, top: 100, width: 100, height: 100 });
    petLinkStops = () => ({ rightEdge: { x: 1200, y: 300 }, rope: { left: 400, top: 0, width: 50, height: 60 }, W: 1600, H: 900 });
    petLinkWalkMs = () => 100;
    petLinkWalkTo = (x, y, ms) => petLinkWait(Number.isFinite(ms) ? ms : 100);
    petLinkEggRebound = () => petLinkWait(100);
    if (!options.motion) petLinkFlingAway = () => petLinkWait(100);
    petLinkWaitSettled = () => petLinkWait(50);
    if (!options.motion) petLinkPullRopeDown = () => { record('rope'); return petLinkWait(680); };
    if (options.motion) {
      petLinkPetCtl=()=>({throwNative(point,velocity){record('native-throw',{point,velocity});return 1;},getNativeThrow:()=>({active:false,cancelled:false}),stopNativeThrow(){}});
      petLinkPetRect = () => ({ left: 600, top: 100, width: 100, height: 100 });
      const style = {};
      Object.defineProperty(style, 'transform', { set: value => record('rope-transform', value) });
      petLinkRopeEl = () => ({ style });
      petLinkGlide = (rect, x, y, ms) => { record('glide', { x, y, ms }); return petLinkWait(ms); };
    }
    petLinkWaitSidebarClose = () => petLinkWait(options.holdMs ?? 1000).then(() => 'closed');
    petLinkReturnHomeWalk = (ms, alive, home, onStart) => { record('return'); if(onStart) onStart(ms); return petLinkWait(ms); };
    petLinkEggReturnHome = petLinkReturnHomeWalk;
    petLinkSnapOpenSidebar = () => { record('open'); return true; };
    petLinkOpenSidebar = () => true;
    petLinkCloseSidebar = () => true;
    petLinkState.available = true;
    petLinkState.runner = { busy: true, sidebar: { mode: 'official', beginPull(ms) { record('sidebar-begin', ms); }, commit() {} } };
    Object.assign(petLinkState.tuning, { mascotWalkMs: 100, egg1WalkMs: 100, sidebarWalkMs: 1000, braceMs: 500, pullMs: 2000, slowOpenMs: 1000, openDelayMs: 0 });
    return { tuner: petLinkTuner, state: petLinkState, run: logic => petLinkRunInner(logic, petLinkState.epoch),
      create: typeof petLinkCreateBubbleTimeline === 'function' ? petLinkCreateBubbleTimeline : null,
      dispose: () => petLink.dispose(), pullRope: alive => petLinkPullRopeDown(alive), fling: alive => petLinkFlingAway(alive || (()=>true)) };
  `)(...Object.values(env));
  async function flush() { for (let i = 0; i < 24; i++) await Promise.resolve(); }
  async function advance(to) {
    await flush();
    for (let count = 0; count < 10000; count++) {
      let nextTask;
      for (const [id, task] of timers) if (!nextTask || task.at < nextTask.task.at) nextTask = { id, task };
      if (!nextTask || nextTask.task.at > to) { now = to; await flush(); return; }
      assert.ok(nextTask.task.at >= now, '时钟不能倒退');
      now = nextTask.task.at;
      timers.delete(nextTask.id);
      nextTask.task.fn();
      await flush();
    }
    throw new Error('调度无界');
  }
  async function run(logic) {
    let done = false, error;
    mod.run(logic).then(() => { done = true; }, err => { error = err; done = true; });
    await advance(40000);
    if (error) throw error;
    assert.ok(done, '排播不得被气泡等待阻塞');
  }
  const set = (id, show, hide) => {
    assert.equal(typeof mod.tuner.setBubbleTiming, 'function', '应提供结构化气泡配置入口');
    assert.notEqual(mod.tuner.setBubbleTiming(id, { show, hide }), false);
  };
  return { ...mod, start: mod.run, events, timers, advance, run, set, now: () => now };
}
const node = (action, edge, offsetMs = 0) => ({ action, edge, offsetMs });
const defaults = node('default', 'start');
const sidebarFactory = { show: node('pull', 'start', 7000), hide: node('duration', 'start', 5000) };
const sidebarFactoryValues = { sidebarWalkMs: 5167, braceMs: 1000, pullMs: 10125, slowOpenMs: 8125,
  bubbleMs: 3000, bubbleWindowMs: 4000, lockHeartbeatMs: 20000, holdMaxMs: 180000, eggAt: 3,
  mascotGrabAtMs: 2500, eggBubbleLeadMs: 600, returnWalkMinPx: 40, handRightRatio: 0.5703,
  edgeGapPx: -15, openLeadMs: 0, openDelayMs: 500, segGapMs: 0, followGraceMs: 200,
  followSpeed: 3200, followStillMs: 140, followStillEps: 0.5 };
const factoryRules = {
  sidebar: sidebarFactory,
  mascot: { show: defaults, hide: defaults },
  egg1Angry: { show: node('eggKick', 'start'), hide: node('duration', 'start', 5000) },
  egg1Land: { show: node('eggFlung', 'start'), hide: node('duration', 'start', 15000) },
  egg2: { show: defaults, hide: node('duration', 'start', 5000) },
};
const screenshotValues = {
  egg1: { egg1EdgeGapPx: 0, egg1WalkMs: 0, egg1LeadMs: 600, egg1KickMs: 5167,
    egg1FlungMs: 10125, egg1LandMs: 5167, egg1FlingDelayMs: 0, egg1FlingPx: 420,
    egg1FlingMs: 520, egg1PostLandMs: 600 },
  egg2: { egg2LeadMs: 600, egg2HissMs: 5167 },
  mascot: { mascotWalkMs: 0, mascotTumbleMs: 8000, mascotOpenAtMs: 2500,
    mascotRopeDownPx: 90, mascotRopePullMs: 420, mascotRopeBackMs: 260,
    mascotReleaseAtMs: 2920, mascotDropPx: 90, mascotDropMs: 520,
    mascotRopePullEase: 1, mascotRopeBackEase: 2 },
};
const sharedValues = { segGapMs: 0, bubbleMs: 3000, bubbleWindowMs: 4000,
  lockHeartbeatMs: 20000, holdMaxMs: 180000, returnWalkMinPx: 40 };
const shown = h => h.events.filter(e => e.type === 'show');
const hidden = h => h.events.filter(e => e.type === 'hide');
let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log('PASS ' + name); }
  catch (err) { failures++; console.error('FAIL ' + name + ': ' + err.message); }
}
await check('四页首次加载恢复既有数字与截图气泡基点', () => {
  const h = load(); h.state.tuning = {};
  const snap = h.tuner.snapshot();
  assert.deepEqual(snap.bubbleTiming, factoryRules);
  for (const logic of ['sidebar', 'mascot', 'egg1', 'egg2']) {
    const expected = logic === 'sidebar' ? sidebarFactoryValues : { ...sharedValues, ...screenshotValues[logic] };
    for (const [key, value] of Object.entries(expected)) assert.equal(snap.logicValues[logic][key], value, logic + ':' + key);
  }
});
await check('四页当前重置恢复各自完整基点且不串其他页', () => {
  for (const logic of ['sidebar', 'mascot', 'egg1', 'egg2']) {
    const h = load(); h.state.tuning = {};
    const baseline = h.tuner.snapshot();
    for (const page of Object.keys(baseline.logicValues)) h.tuner.setForLogic(page, 'bubbleMs', 1234);
    for (const id of Object.keys(factoryRules)) h.set(id, defaults, node('duration', 'start', 99));
    const before = h.tuner.snapshot();
    h.tuner.reset(logic);
    const after = JSON.parse(JSON.stringify(h.tuner.snapshot()));
    assert.deepEqual(after.logicValues[logic], baseline.logicValues[logic]);
    for (const page of Object.keys(baseline.logicValues).filter(page => page !== logic)) {
      assert.deepEqual(after.logicValues[page], before.logicValues[page]);
    }
    const ids = logic === 'egg1' ? ['egg1Angry', 'egg1Land'] : [logic];
    for (const id of Object.keys(factoryRules)) assert.deepEqual(after.bubbleTiming[id], ids.includes(id) ? factoryRules[id] : before.bubbleTiming[id], logic + ':' + id);
  }
});
await check('全部重置与重新加载恢复同一套四逻辑默认值', () => {
  const h = load(); h.state.tuning = {};
  const baseline = h.tuner.snapshot();
  h.tuner.set('bubbleMs', 123);
  for (const page of Object.keys(baseline.logicValues)) h.tuner.setForLogic(page, 'segGapMs', 999);
  for (const id of Object.keys(factoryRules)) h.set(id, defaults, node('duration', 'start', 99));
  h.tuner.reset();
  assert.deepEqual(h.tuner.snapshot(), baseline);
  const fresh = load(); fresh.state.tuning = {};
  assert.deepEqual(fresh.tuner.snapshot(), baseline);
  assert.deepEqual(baseline.bubbleTiming, factoryRules);
});
await check('截图彩蛋一气泡实际在踢腿和弹飞开始出现并按5秒15秒关闭', async () => {
  const h = load();
  const timeline = h.create('egg1', () => true);
  timeline.start('eggKick', 5167);
  await h.advance(0);
  assert.equal(shown(h).length, 1);
  await h.advance(4999); assert.equal(hidden(h).length, 0);
  await h.advance(5000); assert.equal(hidden(h)[0].at, 5000);
  timeline.end('eggKick'); timeline.start('eggFlung', 10125);
  await h.advance(5000); assert.equal(shown(h)[1].at, 5000);
  await h.advance(15125); timeline.end('eggFlung'); timeline.defaultHide('egg1Land');
  await h.advance(19999); assert.equal(hidden(h).length, 1);
  await h.advance(20000); assert.equal(hidden(h)[1].at, 20000);
  assert.equal(timeline.preserve(), false);
});
await check('截图彩蛋二默认出现且真实持续5秒不被默认关闭提前截断', async () => {
  const h = load();
  const timeline = h.create('egg2', () => true);
  timeline.defaultShow('egg2');
  await h.advance(1000); timeline.defaultHide('egg2');
  await h.advance(4999); assert.equal(hidden(h).length, 0);
  await h.advance(5000); assert.equal(hidden(h)[0].at, 5000);
});
await check('彩蛋一哇啊原文不变，仅落地图替换为吓哭了且愤怒图保留', async () => {
  const h = load();
  await h.run('egg1');
  assert.deepEqual(shown(h).map(e => e.value), ['偶鲸鲸！！！！！', '哇啊啊啊啊啊！！！']);
  assert.deepEqual(h.events.filter(e => e.type === 'show-image').map(e => e.value), ['暴怒鲸尾女仆贴纸', '吓哭了']);
});
await check('逻辑一出厂21项数字和7000/5000气泡规则等于用户确认配置', () => {
  const h = load(); h.state.tuning = {};
  const snap = h.tuner.snapshot();
  for (const [key, value] of Object.entries(sidebarFactoryValues)) {
    assert.equal(snap.logicValues.sidebar[key], value, key);
    assert.equal(snap.defaults[key], value, key + ' default');
  }
  assert.deepEqual(snap.bubbleTiming.sidebar, sidebarFactory);
  assert.deepEqual(snap.bubbleTiming, factoryRules);
});
await check('当前逻辑重置恢复所选出厂基点且不改其他页', () => {
  const h = load();
  h.tuner.setForLogic('sidebar', 'braceMs', 9876);
  h.set('sidebar', node('walk', 'start', 100), node('duration', 'start', 200));
  h.tuner.setForLogic('mascot', 'bubbleMs', 1234);
  h.set('mascot', node('walk', 'end', 50), node('duration', 'start', 800));
  const other = h.tuner.snapshot();
  h.tuner.reset('sidebar');
  const snap = h.tuner.snapshot();
  for (const [key, value] of Object.entries(sidebarFactoryValues)) assert.equal(snap.logicValues.sidebar[key], value, key);
  assert.deepEqual(snap.bubbleTiming.sidebar, sidebarFactory);
  assert.deepEqual(snap.logicValues.mascot, other.logicValues.mascot);
  assert.deepEqual(snap.bubbleTiming.mascot, other.bubbleTiming.mascot);
});
await check('全部重置与重新加载都恢复逻辑一7000/5000出厂规则', () => {
  const h = load();
  h.tuner.set('sidebarWalkMs', 9000);
  h.tuner.setForLogic('sidebar', 'bubbleMs', 1234);
  h.set('sidebar', node('walk', 'start'), node('duration', 'start', 10));
  h.tuner.reset();
  const snap = h.tuner.snapshot();
  for (const [key, value] of Object.entries(sidebarFactoryValues)) assert.equal(snap.logicValues.sidebar[key], value, key);
  assert.deepEqual(snap.bubbleTiming.sidebar, sidebarFactory);
  assert.deepEqual(load().tuner.snapshot().bubbleTiming.sidebar, sidebarFactory);
});
await check('所选出厂配置真实排播在后拉开始7秒弹出并显示5秒', async () => {
  const h = load({ holdMs: 10000 }); h.state.tuning = {};
  await h.run('sidebar');
  const at = action => h.events.find(e => e.type === 'animation' && e.value === action).at;
  assert.equal(at('brace'), 5167);
  assert.equal(at('pull'), 6167);
  assert.deepEqual(h.events.find(e => e.type === 'sidebar-begin'), { type: 'sidebar-begin', value: 8125, at: 6667 });
  assert.equal(shown(h).length, 1);
  assert.equal(hidden(h).length, 1);
  assert.equal(shown(h)[0].at, at('pull') + 7000);
  assert.equal(hidden(h)[0].at, shown(h)[0].at + 5000);
  assert.ok(h.events.some(e => e.type === 'duration' && e.value === 2147483647), '自定义关闭不能被原三秒抢先关闭');
});
await check('五条气泡独立导出默认节点，原21个数字参数不变', () => {
  const h = load();
  const snap = h.tuner.snapshot();
  assert.deepEqual(Object.keys(snap.bubbleTiming).sort(), ['egg1Angry', 'egg1Land', 'egg2', 'mascot', 'sidebar']);
  assert.equal(Object.keys(snap.values).length, 49);
  assert.deepEqual(snap.bubbleTiming.sidebar, sidebarFactory);
});
await check('后拉开始后600ms出现，结束前200ms关闭', async () => {
  const h = load();
  h.set('sidebar', node('pull', 'start', 600), node('pull', 'end', -200));
  await h.run('sidebar');
  assert.equal(shown(h)[0].at, 2100);
  assert.equal(hidden(h)[0].at, 3300);
  assert.equal(shown(h).length, 1);
});
await check('可以在预备开始前200ms出现，不推迟任何动作', async () => {
  const h = load();
  h.set('sidebar', node('brace', 'start', -200), node('brace', 'end', 100));
  await h.run('sidebar');
  assert.equal(shown(h)[0].at, 800);
  assert.equal(hidden(h)[0].at, 1600);
  assert.equal(h.events.find(e => e.value === 'brace').at, 1000);
  assert.equal(h.events.find(e => e.value === 'pull').at, 1500);
});
await check('按显示时长独立关闭，不被原三秒和默认弹出点覆盖', async () => {
  const h = load();
  h.set('sidebar', node('walk', 'start', 100), node('duration', 'start', 1250));
  await h.run('sidebar');
  assert.equal(shown(h)[0].at, 100);
  assert.equal(hidden(h)[0].at, 1350);
  assert.equal(shown(h).length, 1);
});
await check('关闭早于出现时禁止迟到气泡重新弹出', async () => {
  const h = load();
  h.set('sidebar', node('pull', 'end', 500), node('pull', 'start', 100));
  await h.run('sidebar');
  assert.equal(shown(h).length, 0);
});
await check('返回动作结束后的正偏移仍可触发，不拖延返回', async () => {
  const h = load();
  h.set('sidebar', node('return', 'end', 200), node('duration', 'start', 300));
  await h.run('sidebar');
  assert.equal(h.events.find(e => e.type === 'return').at, 4500);
  assert.equal(shown(h)[0].at, 5300);
  assert.equal(hidden(h)[0].at, 5600);
});
await check('逻辑二可以在跳抓进行时出现，返回开始时关闭', async () => {
  const h = load();
  h.set('mascot', node('mascotTumble', 'start', 1200), node('return', 'start'));
  await h.run('mascot');
  assert.equal(shown(h)[0].at, 1300);
  assert.equal(hidden(h)[0].at, 9100);
});
await check('彩蛋一两条气泡独立，旧气泡关闭不能隐藏新气泡', async () => {
  const h = load();
  h.set('egg1Angry', node('eggKick', 'start'), node('eggLand', 'end', 100));
  h.set('egg1Land', node('eggLand', 'start', 200), node('duration', 'start', 500));
  await h.run('egg1');
  assert.equal(shown(h).length, 2);
  assert.equal(shown(h)[0].at, 700);
  assert.equal(shown(h)[1].at, 16242);
  assert.equal(hidden(h).length, 1);
  assert.equal(hidden(h)[0].at, 16742);
});
await check('彩蛋二可在哈气结束前出现，结束后关闭', async () => {
  const h = load();
  h.set('egg2', node('eggHiss', 'end', -400), node('eggHiss', 'end', 100));
  await h.run('egg2');
  assert.equal(shown(h)[0].at, 5367);
  assert.equal(hidden(h)[0].at, 5867);
});
await check('卸载撤销全部待触发气泡，不能在下一轮弹出', async () => {
  const h = load();
  assert.equal(typeof h.create, 'function');
  h.set('sidebar', node('pull', 'start', 1000), node('pull', 'end'));
  const run = h.create('sidebar', () => h.state.epoch === 0);
  run.plan([{ action: 'pull', durationMs: 2000 }]);
  run.start('pull', 2000);
  await h.advance(200);
  h.dispose();
  await h.advance(10000);
  assert.equal(shown(h).length, 0);
  assert.equal(h.timers.size, 0);
});
await check('新一轮开始废弃旧事件和旧所有权', async () => {
  const h = load();
  assert.equal(typeof h.create, 'function');
  h.set('sidebar', node('pull', 'start', 1000), node('pull', 'end'));
  const old = h.create('sidebar', () => true);
  old.plan([{ action: 'pull', durationMs: 2000 }]); old.start('pull', 2000);
  await h.advance(200);
  h.create('mascot', () => true);
  await h.advance(5000);
  assert.equal(shown(h).length, 0);
});
await check('非法动作、非有限偏移和不可预知返回的提前量均被拒绝', () => {
  const h = load();
  assert.equal(typeof h.tuner.setBubbleTiming, 'function');
  for (const rule of [node('eggKick', 'start'), node('pull', 'start', NaN), node('return', 'start', -100)]) {
    assert.equal(h.tuner.setBubbleTiming('sidebar', { show: rule, hide: defaults }), false);
  }
  assert.deepEqual(h.tuner.snapshot().bubbleTiming.sidebar, sidebarFactory);
});
await check('重置同时清除气泡节点配置，JSON快照与数字参数兼容', () => {
  const h = load();
  h.set('sidebar', node('pull', 'start', 800), node('duration', 'start', 2000));
  const snap = JSON.parse(JSON.stringify(h.tuner.snapshot()));
  assert.equal(snap.bubbleTiming.sidebar.show.offsetMs, 800);
  h.tuner.reset();
  assert.deepEqual(h.tuner.snapshot().bubbleTiming.sidebar, sidebarFactory);
});
await check('本轮固定规则快照，运行中编辑和重置只影响下一轮', async () => {
  const h = load();
  h.set('sidebar', node('pull', 'start', 1000), node('duration', 'start', 500));
  const timeline = h.create('sidebar', () => true);
  timeline.plan([{ action: 'pull', durationMs: 2000 }]); timeline.start('pull', 2000);
  await h.advance(200);
  h.tuner.reset();
  await h.advance(1100);
  assert.equal(shown(h)[0].at, 1000);
  assert.equal(timeline.preserve(), true);
  await h.advance(1600);
  assert.equal(hidden(h)[0].at, 1500);
  assert.equal(timeline.preserve(), false);
});
await check('动作启动校准后重排尚未触发的提前事件', async () => {
  const h = load();
  h.set('sidebar', node('pull', 'start', -100), node('duration', 'start', 300));
  const timeline = h.create('sidebar', () => true);
  timeline.plan([{ action: 'walk', durationMs: 1000 }, { action: 'brace', durationMs: 500 }, { action: 'pull', durationMs: 2000 }]);
  timeline.start('walk', 1000);
  await h.advance(1000); timeline.end('walk');
  await h.advance(1100); timeline.start('brace', 500);
  await h.advance(1450); assert.equal(shown(h).length, 0);
  await h.advance(1550); assert.equal(shown(h)[0].at, 1500);
});
for (const [logic, expected] of [
  ['sidebar', [8500]], ['mascot', [8100]], ['egg1', [700, 5867]], ['egg2', [0]],
]) await check(logic + ' 未配置时使用各自出厂气泡时点与条数', async () => {
  const h = load(); await h.run(logic);
  assert.deepEqual(shown(h).map(e => e.at), expected);
});
await check('独立支线参数全部导出，旧21键默认值保留', () => {
  const h = load(); h.state.tuning = {};
  const values = h.tuner.snapshot().values;
  const expected = { mascotWalkMs: 0, mascotTumbleMs: 8000, mascotOpenAtMs: 2500,
    mascotRopeDownPx: 90, mascotRopePullMs: 420, mascotRopeBackMs: 260,
    egg1WalkMs: 0, egg1LeadMs: 600, egg1KickMs: 5167, egg1FlungMs: 10125,
    egg1LandMs: 5167, egg1FlingPx: 420, egg1FlingMs: 520, egg2LeadMs: 600, egg2HissMs: 5167 };
  for (const [key, value] of Object.entries(expected)) assert.equal(values[key], value, key);
});
await check('逻辑二走路、跳抓、抓绳与展开时点独立生效', async () => {
  const h = load();
  Object.assign(h.state.tuning, { mascotWalkMs: 700, mascotTumbleMs: 1200, mascotGrabAtMs: 200, mascotOpenAtMs: 450, mascotDropPx: 0 });
  await h.run('mascot');
  assert.equal(h.events.find(e => e.type === 'animation' && e.value === 'mascotTumble').at, 700);
  assert.equal(h.events.find(e => e.type === 'rope').at, 900);
  assert.equal(h.events.find(e => e.type === 'open').at, 1150);
  assert.equal(shown(h)[0].at, 1900);
});
await check('彩蛋一三段时长、独立前置等待与落地停留进入真实排播', async () => {
  const h = load();
  Object.assign(h.state.tuning, { egg1WalkMs: 900, egg1LeadMs: 100, egg1KickMs: 700, egg1FlungMs: 1200, egg1LandMs: 400, egg1PostLandMs: 250 });
  await h.run('egg1');
  const at = key => h.events.find(e => e.type === 'animation' && e.value === key).at;
  assert.equal(at('eggKick'), 1000); assert.equal(at('eggFlung'), 1700); assert.equal(at('eggLand'), 2950);
  assert.equal(h.events.find(e => e.type === 'return').at, 3600);
});
await check('彩蛋二前置等待与哈气时长不受彩蛋一覆盖影响', async () => {
  const h = load();
  Object.assign(h.state.tuning, { egg1LeadMs: 9999, egg1KickMs: 9999, egg2LeadMs: 200, egg2HissMs: 900 });
  await h.run('egg2');
  assert.equal(h.events.find(e => e.type === 'animation' && e.value === 'eggHiss').at, 200);
  assert.equal(h.events.find(e => e.type === 'return').at, 1100);
});
await check('旧JSON的共享彩蛋等待与抓绳展开参数继续兼容', () => {
  const h = load();
  h.tuner.set('eggBubbleLeadMs', 123); h.tuner.set('mascotGrabAtMs', 456);
  assert.equal(h.tuner.snapshot().values.egg1LeadMs, 123);
  assert.equal(h.tuner.snapshot().values.egg2LeadMs, 123);
  assert.equal(h.tuner.snapshot().values.mascotOpenAtMs, 456);
  h.tuner.set('egg1LeadMs', 321); h.tuner.set('mascotOpenAtMs', 654);
  assert.equal(h.tuner.snapshot().values.egg1LeadMs, 321);
  assert.equal(h.tuner.snapshot().values.egg2LeadMs, 123);
  assert.equal(h.tuner.snapshot().values.mascotOpenAtMs, 654);
});
await check('真实绳子位移读取独立距离及拉下弹回时长', async () => {
  const h = load({ motion: true });
  Object.assign(h.state.tuning, { mascotRopeDownPx: 150, mascotRopePullMs: 800, mascotRopeBackMs: 500 });
  let finishedAt;
  h.pullRope().then(() => { finishedAt = h.now(); });
  await h.advance(1500);
  assert.deepEqual(h.events.filter(e => e.type === 'rope-transform').map(e => [e.value, e.at]),
    [['translate(0px,150px)', 0], ['translate(0px,0px)', 800], ['', 1300]]);
  assert.equal(finishedAt, 1300);
});
await check('真实抛掷入口读取独立强度与发力时间换算初速', async () => {
  const h = load({ motion: true });
  Object.assign(h.state.tuning, { egg1FlingPx: 200, egg1FlingMs: 900 });
  h.fling(); await h.advance(1000);
  const value=h.events.find(e => e.type === 'native-throw').value;
  assert.deepEqual(value.point,{x:650,y:150});assert.equal(value.velocity.vx,-200/0.9);assert.ok(value.velocity.vy<0);
});
await check('取消逻辑二后不能继续触发延迟侧栏与抓绳', async () => {
  const h = load();
  Object.assign(h.state.tuning, { mascotGrabAtMs: 800, mascotOpenAtMs: 1200 });
  h.state.tuning.mascotWalkMs = 100;
  const pending = h.start('mascot'); await h.advance(500);
  h.state.epoch++;
  await h.advance(10000); await pending;
  assert.equal(h.events.filter(e => e.type === 'open' || e.type === 'rope').length, 0);
});
await check('卸载立即归还绳子位移，不再被旧异步任务改写', async () => {
  const h = load({ motion: true });
  h.state.tuning.mascotRopePullMs = 800;
  h.pullRope(() => h.state.epoch === 0);
  await h.advance(100); h.dispose();
  const after = h.events.filter(e => e.type === 'rope-transform');
  assert.equal(after.length, 2);
  assert.equal(after[1].at, 100);
  await h.advance(3000);
  assert.equal(h.events.filter(e => e.type === 'rope-transform').length, 2);
});
for (const logic of ['sidebar', 'mascot', 'egg1', 'egg2']) {
  await check('真实排播只消费自己的气泡时长：' + logic, async () => {
    const h = load();
    h.set(logic === 'sidebar' ? 'sidebar' : logic === 'egg1' ? 'egg1Angry' : logic, defaults, defaults);
    if (logic === 'egg1') h.set('egg1Land', defaults, defaults);
    assert.equal(typeof h.tuner.setForLogic, 'function');
    for (const [i, page] of ['sidebar', 'mascot', 'egg1', 'egg2'].entries()) h.tuner.setForLogic(page, 'bubbleMs', (i + 1) * 1234);
    await h.run(logic);
    const duration = h.events.filter(e => e.type === 'duration');
    assert.ok(duration.length > 0);
    assert.ok(duration.every(e => e.value === (['sidebar', 'mascot', 'egg1', 'egg2'].indexOf(logic) + 1) * 1234));
  });
}
await check('新页抓绳与侧栏时刻真正独立，不继承旧JSON联动别名', async () => {
  const h = load();
  h.tuner.setForLogic('mascot', 'mascotGrabAtMs', 200);
  assert.equal(h.tuner.snapshot().logicValues.mascot.mascotOpenAtMs, 2500);
  await h.run('mascot');
  assert.equal(h.events.find(e => e.type === 'rope').at, 300);
  assert.equal(h.events.find(e => e.type === 'open').at, 2600);
});
if (failures) process.exitCode = 1;
