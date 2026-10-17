#!/usr/bin/env node
/** 用虚拟时钟执行真实排播和跟随源码，锁定慢速拉出与收尾行为。 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const tuner = readFileSync(new URL('../packages/pet-link/src/pet-link-tuner.js', import.meta.url), 'utf8');
const pet = readFileSync(new URL('../packages/pet-link/src/pet-link.js', import.meta.url), 'utf8');

async function scenario(options = {}) {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  const frameMs = 1000 / (options.fps || 60);
  const schedule = (fn, delay) => {
    const id = ++nextId;
    timers.set(id, { at: now + delay, fn });
    return id;
  };
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  const samples = [];
  const writes = [];
  const animations = [];
  let started = null;
  let duration = null;
  let hold = null;
  let done = false;
  let error = null;
  const edge = () => {
    if (options.missing) return null;
    if (options.throwEdge) throw new Error('edge unavailable');
    const elapsed = Math.max(0, now - (started ?? now) - (options.delay || 0));
    const t = Math.min(1, elapsed / duration);
    if (options.edge) return options.edge(elapsed, duration);
    return 1600 - 340 * t * t;
  };
  const style = {};
  Object.defineProperty(style, 'transform', { set(value) { writes.push({ at: now, value }); } });
  const petEl = {
    style,
    getBoundingClientRect() {
      const x = mod?.state.offset?.x || 0;
      const y = mod?.state.offset?.y || 0;
      return { left: (options.realWalk ? 600 : 1600 - 100 * 0.5703) + x, top: 390 + y, width: 100, height: 100 };
    },
  };
  const env = {
    document: { addEventListener() {}, querySelector: s => s === '.dsh-pet-root' ? petEl : null },
    window: { innerWidth: 1600, innerHeight: 800 },
    performance: { now: () => now },
    setTimeout: (fn, ms) => schedule(fn, ms),
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: options.noRaf ? undefined : fn => schedule(fn, frameMs),
    weT: s => s,
    observeHold: () => { hold = { at: now, x: mod.state.offset?.x || 0, edge: options.throwEdge ? null : edge() }; },
    walkDuration: options.walkMs || 0,
    realWalk: Boolean(options.realWalk),
    post: (path, body) => {
      const entry = { name: body.name, at: now, ackAt: null };
      animations.push(entry);
      const ms = body.name.includes('蓄力') ? (options.braceAckMs || 0)
        : body.name.includes('后拉接') ? (options.pullAckMs || 0) : (options.ackMs || 0);
      return new Promise(resolve => { schedule(() => {
        entry.ackAt = now;
        resolve(!options.failWalk || !body.name.includes('螃蟹步'));
      }, ms); });
    },
  };
  // 编排场景保留真实点播队列、慢开与位移；原跟随场景仅隔离网络点播和去回程。
  const mod = new Function(...Object.keys(env), tuner + '\n' + pet + `
    petLinkPost = post;
    petLinkProbe = async () => true;
    if (!realWalk) {
      petLinkWalkMs = () => walkDuration;
      petLinkWalkTo = () => petLinkWait(walkDuration);
      petLinkPlay = async (key) => { petLinkState.lastKey = PET_ANIM[key]; return true; };
    }
    petLinkSay = async () => true;
    petLinkWaitSidebarClose = async () => { observeHold(); return 'closed'; };
    petLinkReturnHomeWalk = async () => true;
    petLinkState.available = true;
    return { state: petLinkState, run: () => petLinkRunInner('sidebar', petLinkState.epoch) };
  `)(...Object.values(env));
  // 旧回归固定基准，默认参数用例显式清除对应覆盖，读取生产默认值。
  Object.assign(mod.state.tuning, {
    slowOpenMs: 10125, edgeGapPx: 0, followGraceMs: 600, openDelayMs: 0, braceMs: 5167,
  }, options.tuning || {});
  const api = {
    mode: 'official', edgeX: options.noEdge ? undefined : edge,
    beginPull(ms) { started = now; duration = ms; },
    commit() {},
  };
  mod.state.runner = { busy: true, sidebar: api };
  mod.run().then(() => { done = true; }, err => { error = err; done = true; });
  await flush();
  let cancelled = false;
  for (let count = 0; count < 20000; count++) {
    if (done) break;
    let next = null;
    for (const [id, task] of timers) if (!next || task.at < next.task.at) next = { id, task };
    assert.ok(next, '排播必须可以继续推进');
    assert.ok(next.task.at < 60000, '排播不得无界等待');
    timers.delete(next.id);
    now = next.task.at;
    if (options.cancelAt !== undefined && !cancelled && now >= options.cancelAt) {
      mod.state.epoch++;
      cancelled = true;
    }
    next.task.fn();
    await flush();
    samples.push({ at: now, x: mod.state.offset?.x || 0 });
  }
  if (error) throw error;
  assert.ok(done, '排播必须正常收尾');
  return { hold, samples, writes, animations, started, duration, now, cancelled };
}

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log('PASS ' + name); }
  catch (err) { failures++; console.error('FAIL ' + name + ': ' + err.message); }
}
const anim = (result, part) => result.animations.find(entry => entry.name.includes(part));
await check('逻辑一走路请求成功后才位移，并按一整段5167ms走到侧栏', async () => {
  const result = await scenario({ realWalk: true, ackMs: 750 });
  const walk = anim(result, '右侧螃蟹步');
  const brace = anim(result, '蓄力');
  assert.ok(result.writes[0].at > walk.ackAt, `移动=${result.writes[0].at} 请求成功=${walk.ackAt}`);
  assert.ok(brace.at >= walk.ackAt + 5167 && brace.at < walk.ackAt + 5200, `准备开始=${brace.at}`);
  const middle = result.samples.find(s => s.at >= walk.ackAt + 2583);
  assert.ok(middle.x > 400 && middle.x < 550, `走路中途不应已经贴边，实际偏移=${middle.x}`);
});
await check('覆盖为完整准备时长时等待结束且后拉请求成功后才展开', async () => {
  const result = await scenario({ realWalk: true, braceAckMs: 500, pullAckMs: 800 });
  const brace = anim(result, '蓄力');
  const pull = anim(result, '后拉接');
  assert.ok(pull.at >= brace.ackAt + 5167, `后拉=${pull.at} 准备确认=${brace.ackAt}`);
  assert.ok(result.started >= pull.ackAt, `展开=${result.started} 后拉确认=${pull.ackAt}`);
  assert.equal(result.duration, 10125);
});
await check('去程走路与蓄力准备两个覆盖值独立控制真实排播', async () => {
  const result = await scenario({ realWalk: true, tuning: { sidebarWalkMs: 7000, braceMs: 2200 } });
  const walk = anim(result, '右侧螃蟹步');
  const brace = anim(result, '蓄力');
  assert.ok(brace.at >= walk.ackAt + 7000 && brace.at < walk.ackAt + 7030, `准备=${brace.at}`);
  assert.ok(result.started >= brace.ackAt + 2200 && result.started < brace.ackAt + 2230, `展开=${result.started}`);
});
await check('提前量只进入准备段末尾，不得提前到去程走路', async () => {
  const result = await scenario({ realWalk: true, tuning: { sidebarWalkMs: 3500, braceMs: 2400, openLeadMs: 800 } });
  const brace = anim(result, '蓄力');
  assert.ok(result.started >= brace.ackAt + 1600 && result.started < brace.ackAt + 1630, `展开=${result.started} 准备=${brace.ackAt}`);
  assert.equal(result.duration, 10125 + 800);
});
await check('超大提前量也不能越过准备开始，负提前量按零处理', async () => {
  const early = await scenario({ realWalk: true, tuning: { braceMs: 1000, openLeadMs: 99999 } });
  assert.equal(early.started, anim(early, '蓄力').ackAt);
  assert.equal(early.duration, 10125 + 1000);
  const late = await scenario({ realWalk: true, tuning: { braceMs: 1000, openLeadMs: -100 } });
  assert.equal(late.started, anim(late, '后拉接').ackAt);
});
await check('走路和准备时长为零或负值时仍有界衔接，不产生NaN位移', async () => {
  const result = await scenario({ realWalk: true, tuning: { sidebarWalkMs: 0, braceMs: -500 } });
  assert.ok(result.hold && result.now < 15000);
  assert.ok(result.writes.every(entry => !entry.value.includes('NaN')));
});
await check('真实走位取消后停止位移，不点播准备或展开侧栏', async () => {
  const result = await scenario({ realWalk: true, cancelAt: 1500 });
  assert.ok(result.cancelled);
  assert.equal(result.started, null);
  assert.equal(anim(result, '蓄力'), undefined);
  assert.ok(result.writes.every(entry => entry.at < 1500));
});
await check('走路点播失败安全收尾，不滑行或继续准备展开', async () => {
  const result = await scenario({ realWalk: true, failWalk: true });
  assert.equal(result.hold, null);
  assert.equal(result.started, null);
  assert.equal(anim(result, '蓄力'), undefined);
  assert.equal(result.writes.length, 0);
});

await check('预备默认一秒切到后拉，不再等完整5167ms素材', async () => {
  const result = await scenario({
    realWalk: true, braceAckMs: 200, pullAckMs: 300,
    tuning: { braceMs: undefined, openDelayMs: 500 },
  });
  const brace = anim(result, '蓄力');
  const pull = anim(result, '后拉接');
  assert.equal(pull.at - brace.ackAt, 1000);
  assert.equal(result.started - pull.ackAt, 500);
});
await check('预备切段间隔可独立调节，不改变侧栏展开延迟', async () => {
  const fast = await scenario({ realWalk: true, tuning: { braceMs: 300, openDelayMs: 800 } });
  const slow = await scenario({ realWalk: true, tuning: { braceMs: 1500, openDelayMs: 800 } });
  assert.equal(anim(fast, '后拉接').at - anim(fast, '蓄力').ackAt, 300);
  assert.equal(anim(slow, '后拉接').at - anim(slow, '蓄力').ackAt, 1500);
  assert.equal(fast.started - anim(fast, '后拉接').ackAt, 800);
  assert.equal(slow.started - anim(slow, '后拉接').ackAt, 800);
});
await check('预备切段等待期间取消，不点播后拉也不展开侧栏', async () => {
  const result = await scenario({
    realWalk: true, cancelAt: 500,
    tuning: { sidebarWalkMs: 0, braceMs: 1000 },
  });
  assert.ok(result.cancelled);
  assert.ok(anim(result, '蓄力'));
  assert.equal(anim(result, '后拉接'), undefined);
  assert.equal(result.started, null);
});

await check('侧栏默认晚500ms启动，不推迟准备与后拉点播', async () => {
  const result = await scenario({
    realWalk: true, pullAckMs: 800,
    tuning: { openDelayMs: undefined, slowOpenMs: undefined },
  });
  const pull = anim(result, '后拉接');
  assert.equal(result.started - pull.ackAt, 500);
  assert.equal(result.duration, 8125);
});
await check('展开延迟独立生效，不改变后拉时刻和展开速度', async () => {
  const immediate = await scenario({ realWalk: true, tuning: { openDelayMs: 0 } });
  const delayed = await scenario({ realWalk: true, tuning: { openDelayMs: 900 } });
  assert.equal(anim(delayed, '后拉接').at, anim(immediate, '后拉接').at);
  assert.equal(delayed.started - immediate.started, 900);
  assert.equal(delayed.duration, immediate.duration);
});
await check('提前量与展开延迟可同时使用，负延迟按零处理', async () => {
  const tuning = { braceMs: 2400, openLeadMs: 800, openDelayMs: 0 };
  const immediate = await scenario({ realWalk: true, tuning });
  const delayed = await scenario({ realWalk: true, tuning: { ...tuning, openDelayMs: 300 } });
  const negative = await scenario({ realWalk: true, tuning: { ...tuning, openDelayMs: -500 } });
  assert.equal(delayed.started - immediate.started, 300);
  assert.equal(anim(delayed, '后拉接').at, anim(immediate, '后拉接').at);
  assert.equal(negative.started, immediate.started);
});
await check('延迟期间取消排播不得事后展开侧栏', async () => {
  const result = await scenario({
    realWalk: true, cancelAt: 500,
    tuning: { sidebarWalkMs: 0, braceMs: 0, openDelayMs: 1000 },
  });
  assert.ok(result.cancelled);
  assert.equal(result.started, null);
});
await check('长展开延迟计入跟随上限，不能在展开前退出跟随', async () => {
  const result = await scenario({ tuning: { openDelayMs: 5000, slowOpenMs: 1000, edgeGapPx: -15 } });
  assert.ok(Math.abs(result.hold.x + 325) < 0.5, `手边间距-15px时最终偏移=${result.hold.x}px`);
  assert.ok(result.writes.at(-1).at >= result.started + 1000);
});

for (const fps of [20, 60, 144]) {
  await check(`慢速侧栏 ${fps}fps 全程后退并最终贴边`, async () => {
    const result = await scenario({ fps });
    const middle = result.samples.find(s => s.at >= result.started + 8000);
    assert.ok(middle.x < -80, `展开8s后应明显后退，实际 ${middle.x.toFixed(2)}px`);
    assert.ok(Math.abs(result.hold.x + 340) < 0.5, `最终应后退340px，实际 ${result.hold.x.toFixed(2)}px`);
    assert.ok(result.hold.at - result.started < result.duration + 700, `到位应及时收尾，实际 ${result.hold.at - result.started}ms`);
  });
}
await check('超过起手宽限的启动延迟不会掐断后续跟随', async () => {
  const result = await scenario({ delay: 1500 });
  assert.ok(Math.abs(result.hold.x + 340) < 0.5, `实际 ${result.hold.x}px`);
});
await check('跟随速度较低时必须追上最终边缘后再停', async () => {
  const result = await scenario({ tuning: { slowOpenMs: 1000, followSpeed: 150 } });
  assert.ok(Math.abs(result.hold.x + 340) < 0.5, `实际 ${result.hold.x}px`);
  assert.ok(result.writes.at(-1).at - result.started < 4000, '追上边缘后应结束位移而不是持续空转');
});
await check('followStillEps 覆盖值实际控制静止收尾', async () => {
  const edge = (elapsed, duration) => 1260 - Math.max(0, elapsed - duration) * 0.002;
  const loose = await scenario({ edge, tuning: { followStillEps: 1 } });
  const strict = await scenario({ edge, tuning: { followStillEps: 0.05 } });
  assert.ok(strict.hold.at > loose.hold.at + 1000, `strict=${strict.hold.at} loose=${loose.hold.at}`);
});
await check('缺少边缘控制面不空转到超时', async () => {
  const result = await scenario({ noEdge: true });
  assert.ok(result.hold.at - result.started < result.duration + 500, `实际 ${result.hold.at - result.started}ms`);
  assert.equal(result.writes.length, 0);
});
await check('边缘暂不可用可有界结束', async () => {
  const result = await scenario({ missing: true });
  assert.ok(result.hold && result.hold.at - result.started < result.duration + 2600);
});
await check('边缘读取抛错不得打断排播', async () => {
  const result = await scenario({ throwEdge: true });
  assert.ok(result.hold && result.hold.at - result.started < result.duration + 2600);
});
await check('epoch取消后不再写宠物位移', async () => {
  const result = await scenario({ cancelAt: 7167 });
  assert.ok(result.cancelled);
  assert.ok(result.started !== null && result.writes.length > 0, '取消必须发生在跟随已经开始之后');
  assert.equal(result.hold, null);
  assert.ok(result.writes.every(s => s.at < 7167));
});
await check('没有rAF时计时器降级仍可完整跟随', async () => {
  const result = await scenario({ noRaf: true });
  assert.ok(Math.abs(result.hold.x + 340) < 0.5, `实际 ${result.hold.x}px`);
});
await check('提前展开时走位与跟随不争写且最终贴边', async () => {
  const result = await scenario({ walkMs: 1600, tuning: { openLeadMs: 1200 } });
  assert.ok(result.started >= 1600);
  assert.ok(result.writes.every(s => s.at >= result.started));
  assert.ok(Math.abs(result.hold.x + 340) < 0.5, `实际 ${result.hold.x}px`);
});
if (failures) process.exitCode = 1;
else console.log('ALL PET FOLLOW CHECKS PASSED');
