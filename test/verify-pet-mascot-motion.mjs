#!/usr/bin/env node
/** 虚拟时钟执行真实逻辑二位移与排播，不启动宿主。 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const tuner = readFileSync(new URL('../packages/pet-link/src/pet-link-tuner.js', import.meta.url), 'utf8');
const pet = readFileSync(new URL('../packages/pet-link/src/pet-link.js', import.meta.url), 'utf8');
function load(options = {}) {
  let now = 0, serial = 0;
  const tasks = new Map(), events = [];
  const record = (type, value) => events.push({ type, value, at: now });
  const schedule = (fn, ms) => { const id = ++serial; tasks.set(id, { fn, at: now + Math.max(0, ms) }); return id; };
  const env = { options, record, setTimeout: schedule, clearTimeout: id => tasks.delete(id),
    requestAnimationFrame: fn => schedule(fn, 10), performance: { now: () => now }, weT: x => x };
  const mod = new Function(...Object.keys(env), tuner + '\n' + pet + `
    const ropeStyle = { transform: 'translateX(3px)', transitionProperty: 'top, left', transitionDuration: '280ms', transitionTimingFunction: 'ease' };
    const rope = { style: new Proxy(ropeStyle, { set(target, key, value) { target[key] = value; record('rope', { key, value, style: { ...target } }); return true; } }) };
    const petStyle = { transform: 'translate(35px,20px)' };
    const petEl = { querySelector: selector => selector === '.dsh-pet-stage' && options.stagePad
      ? { getBoundingClientRect: () => ({ ...petLinkPetRect(), top: petLinkPetRect().top + options.stagePad }) } : null,
      style: new Proxy(petStyle, { set(target, key, value) { target[key] = value; record('pet', { key, value }); return true; } }) };
    petLinkPetEl = () => petEl;
    petLinkPetRect = () => ({ left: 600 + petLinkState.offset.x, top: 100 + petLinkState.offset.y, width: options.width || 100, height: options.height || 100 });
    petLinkRopeRect = () => options.align ? { left: 400, top: 0, width: 50, height: 60 } : null;
    petLinkRopeEl = () => rope;
    petLinkStops = () => ({ rightEdge: { x: 1200, y: 300 }, rope: { left: 400, top: 0, width: 50, height: 60 }, W: 1600, H: 900 });
    petLinkWalkMs = () => 100;
    petLinkWalkTo = (x, y, ms) => { record('walk', { x, y }); return petLinkWait(ms); };
    petLinkPlay = async key => {
      record('request', key);
      if (key === 'walkLeft') await petLinkWait(options.walkAckMs || 0);
      if (key === 'mascotTumble') await petLinkWait(options.ackMs || 0);
      record('animation', key); petLinkState.lastKey = PET_ANIM[key];
      return (key !== 'mascotTumble' || !options.failPlay) && (key !== 'walkLeft' || !options.failWalk);
    };
    petLinkSay = async () => true; petLinkBubbleHide = () => true; petLinkBubbleDuration = () => true;
    petLinkWaitSidebarClose = () => petLinkWait(1000).then(() => 'closed');
    petLinkReturnHomeWalk = ms => { record('return'); return petLinkWait(ms); };
    petLinkSnapOpenSidebar = () => { record('open'); return true; };
    petLinkState.offset = { x: 35, y: 20 };
    petLinkState.available = true;
    petLinkState.runner = { busy: true };
    return { tuner: petLinkTuner, state: petLinkState, ropeStyle, petStyle,
      run: () => petLinkRunInner('mascot', petLinkState.epoch),
      pull: alive => petLinkPullRopeDown(alive), dispose: () => petLink.dispose() };
  `)(...Object.values(env));
  async function flush() { for (let i = 0; i < 32; i++) await Promise.resolve(); }
  async function advance(to) {
    await flush();
    for (let count = 0; count < 20000; count++) {
      let first;
      for (const [id, task] of tasks) if (!first || task.at < first.task.at) first = { id, task };
      if (!first || first.task.at > to) { now = to; await flush(); return; }
      assert.ok(first.task.at >= now); now = first.task.at; tasks.delete(first.id); first.task.fn(); await flush();
    }
    throw new Error('虚拟时钟任务未收敛');
  }
  return { ...mod, events, advance, set: (key, value) => mod.tuner.setForLogic('mascot', key, value) };
}
let failures = 0;
async function check(name, fn) { try { await fn(); console.log('PASS ' + name); } catch (e) { failures++; console.error('FAIL ' + name + ': ' + e.message); } }
const timing = h => {
  for (const [key, value] of Object.entries({ mascotWalkMs: 100, mascotTumbleMs: 2400,
    mascotGrabAtMs: 200, mascotOpenAtMs: 450, mascotRopeDownPx: 150, mascotRopePullMs: 400,
    mascotReleaseAtMs: 1000, mascotRopeBackMs: 300, mascotDropPx: 80, mascotDropMs: 400,
    mascotRopePullEase: 0, mascotRopeBackEase: 2 })) h.set(key, value);
};
const ropeMoves = h => h.events.filter(e => e.type === 'rope' && e.value.key === 'transform');
await check('私有拉下/弹回参数设置真实transform过渡并还原原样式', async () => {
  const h = load(); h.set('mascotRopePullMs', 800); h.set('mascotRopeBackMs', 500);
  h.set('mascotRopePullEase', 0); h.set('mascotRopeBackEase', 2);
  const pending = h.pull(); await h.advance(1500); await pending;
  const moves = ropeMoves(h);
  assert.equal(moves[0].value.style.transitionProperty, 'transform');
  assert.equal(moves[0].value.style.transitionDuration, '800ms');
  assert.equal(moves[0].value.style.transitionTimingFunction, 'linear');
  assert.equal(moves[1].at, 800); assert.equal(moves[1].value.style.transitionDuration, '500ms');
  assert.equal(moves[1].value.style.transitionTimingFunction, 'cubic-bezier(0.16,1,0.3,1)');
  assert.deepEqual(h.ropeStyle, { transform: 'translateX(3px)', transitionProperty: 'top, left', transitionDuration: '280ms', transitionTimingFunction: 'ease' });
});
await check('脱手/下落/缓动参数能导出，非法枚举拒绝', () => {
  const h = load(); timing(h);
  const snap = h.tuner.snapshot();
  for (const key of ['mascotReleaseAtMs', 'mascotDropPx', 'mascotDropMs', 'mascotRopePullEase', 'mascotRopeBackEase']) assert.equal(typeof snap.defaults[key], 'number', key);
  assert.equal(snap.logicValues.mascot.mascotDropPx, 80);
  assert.equal(h.set('mascotRopePullEase', 99), false);
});
await check('动画点播确认后统一抓握、脱手、展开和下落计时', async () => {
  const h = load({ ackMs: 600 }); timing(h); const pending = h.run();
  await h.advance(500); assert.equal(ropeMoves(h).length, 0); assert.equal(h.events.filter(e => e.type === 'open').length, 0);
  await h.advance(3000);
  const moves = ropeMoves(h);
  assert.equal(moves[0].at, 900); assert.equal(moves[1].at, 1700);
  assert.equal(h.events.find(e => e.type === 'open').at, 1150);
  const petMoves = h.events.filter(e => e.type === 'pet');
  assert.ok(petMoves.some(e => e.at > 1700 && e.at < 2100));
  assert.equal(petMoves.find(e => e.at === 2100)?.value.value, 'translate(-225.0px,110.0px)');
  assert.equal(petMoves.filter(e => e.at > 2100).length, 0);
  assert.deepEqual(h.state.offset, { x: -225, y: 110 });
  await h.advance(6000); await pending;
});
await check('脱手早于拉到底时夹限顺序，下落完成后保持落点', async () => {
  const h = load(); timing(h); h.set('mascotReleaseAtMs', 0);
  const pending = h.run(); await h.advance(15000); await pending;
  assert.equal(ropeMoves(h)[1].at, 700);
  assert.equal(h.events.find(e => e.type === 'pet' && e.at === 1100)?.value.value, 'translate(-225.0px,110.0px)');
  assert.deepEqual(h.state.offset, { x: -225, y: 110 });
});
await check('点播失败不触发抓握/展开或脱手位移', async () => {
  const h = load({ failPlay: true }); timing(h); const pending = h.run(); await h.advance(5000); await pending;
  assert.equal(ropeMoves(h).length, 0); assert.equal(h.events.filter(e => e.type === 'open' || e.type === 'pet').length, 0);
});
await check('取消下落立即还原我方位移，旧帧不能再写入', async () => {
  const h = load(); timing(h); const pending = h.run(); await h.advance(1200);
  assert.ok(h.state.offset.y > 20, '确实处于下落中');
  h.dispose(); const count = h.events.filter(e => e.type === 'pet').length;
  assert.deepEqual(h.state.offset, { x: 0, y: 0 });
  await h.advance(10000); await pending;
  assert.equal(h.events.filter(e => e.type === 'pet').length, count);
  assert.equal(h.ropeStyle.transform, 'translateX(3px)');
});
await check('下落距离为零时禁用主动下落，不插入额外等待', async () => {
  const h = load({ align: true, width: 640, height: 360 }); timing(h); h.set('mascotDropPx', 0);
  let done = false; h.run().then(() => { done = true; }); await h.advance(6000);
  assert.equal(h.events.filter(e => e.type === 'pet').length, 0); assert.equal(done, true);
});
await check('新控件当前重置只影响逻辑二，不改变逻辑一出厂基点', () => {
  const h = load(); const before = h.tuner.snapshot(); timing(h); h.tuner.reset('mascot');
  const snap = h.tuner.snapshot();
  assert.equal(snap.logicValues.mascot.mascotDropPx, snap.defaults.mascotDropPx);
  assert.deepEqual(snap.logicValues.sidebar, before.logicValues.sidebar);
  assert.deepEqual(snap.bubbleTiming.sidebar, before.bubbleTiming.sidebar);
});
await check('零下落时长有限收敛，不出现NaN且保持落点', async () => {
  const h = load(); timing(h); h.set('mascotDropMs', 0);
  const pending = h.run(); await h.advance(6000); await pending;
  assert.ok(h.events.some(e => e.type === 'pet'));
  assert.ok(h.events.every(e => e.type !== 'pet' || !e.value.value.includes('NaN')));
  assert.deepEqual(h.state.offset, { x: -225, y: 110 });
});
await check('点播确认前卸载不会晚启动抓握/下落/侧栏', async () => {
  const h = load({ ackMs: 1000 }); timing(h); const pending = h.run(); await h.advance(500); h.dispose();
  const count = h.events.filter(e => e.type === 'pet').length;
  await h.advance(6000); await pending;
  assert.equal(ropeMoves(h).length, 0); assert.equal(h.events.filter(e => e.type === 'open').length, 0);
  assert.equal(h.events.filter(e => e.type === 'pet').length, count);
});
await check('下落结束后保持落点直到正常回程，不额外向上归位', async () => {
  const h = load(); timing(h); const pending = h.run();
  await h.advance(3000);
  assert.equal(h.events.filter(e => e.type === 'return').length, 0);
  assert.deepEqual(h.state.offset, { x: -225, y: 110 });
  const landedAt = 1500;
  assert.equal(h.events.filter(e => e.type === 'pet' && e.at > landedAt).length, 0);
  await h.advance(6000); await pending;
});
await check('起身归位参数不再设置或出现在默认值和导出中', () => {
  const h = load();
  for (const key of ['mascotRecoverAtMs', 'mascotRecoverMs']) {
    assert.equal(h.set(key, 500), false, key);
    const snap = h.tuner.snapshot();
    for (const values of [snap.defaults, snap.values, snap.logicValues.mascot]) {
      assert.equal(Object.hasOwn(values, key), false, key);
    }
  }
});
await check('去程等待左侧螃蟹步确认后才开始位移和跳抓计时', async () => {
  const h = load({ walkAckMs: 600 }); timing(h); const pending = h.run();
  await h.advance(500);
  assert.equal(h.events.filter(e => e.type === 'walk').length, 0);
  assert.equal(h.events.filter(e => e.type === 'request' && e.value === 'mascotTumble').length, 0);
  await h.advance(6000); await pending;
  assert.equal(h.events.find(e => e.type === 'walk').at, 600);
  assert.equal(h.events.find(e => e.type === 'request' && e.value === 'mascotTumble').at, 700);
  assert.equal(ropeMoves(h)[0].at, 900);
});
await check('左蟹步确认前取消不得晚启动去程或跳抓', async () => {
  const h = load({ walkAckMs: 600 }); timing(h); const pending = h.run();
  await h.advance(200); h.dispose(); await h.advance(6000); await pending;
  assert.equal(h.events.filter(e => e.type === 'walk').length, 0);
  assert.equal(h.events.filter(e => e.type === 'request' && e.value === 'mascotTumble').length, 0);
  assert.equal(ropeMoves(h).length, 0);
});
await check('左蟹步点播失败时不以旧动画移动或继续跳抓', async () => {
  const h = load({ failWalk: true }); timing(h); const pending = h.run();
  await h.advance(6000); await pending;
  assert.equal(h.events.filter(e => e.type === 'walk').length, 0);
  assert.equal(h.events.filter(e => e.type === 'request' && e.value === 'mascotTumble').length, 0);
});
for (const [scale, stagePad] of [[1, 0], [0.5, 0], [0.75, 24]]) {
  await check('去程终点按双手最高点就位，跳抓不再上抬，缩放' + scale + '/视频层偏移' + stagePad, async () => {
    const width = 640 * scale, height = 360 * scale;
    const h = load({ align: true, width, height, stagePad }); timing(h); const pending = h.run();
    await h.advance(300);
    const walk = h.events.find(e => e.type === 'walk').value;
    const stageLeft = walk.x - width / 2;
    const stageTop = walk.y - height / 2 + stagePad;
    assert.ok(Math.abs(stageLeft + width * 312 / 640 - 425) < 0.01, '左右手之间对准吉祥物中心');
    assert.ok(Math.abs(stageTop + height * 36 / 360) < 0.01, '去程已走到自身跳跃能触顶的位置');
    assert.equal(h.events.filter(e => e.type === 'pet').length, 0, '跳抓播放期间不再添加根画布上抬');
    await h.advance(1500);
    const expected = { x: 425 - (600 + width / 2), y: 260 - (100 + height / 2) };
    assert.deepEqual(h.state.offset, expected, '仍落到原去程终点加原下落距离');
    const count = h.events.filter(e => e.type === 'pet').length;
    await h.advance(3000);
    assert.deepEqual(h.state.offset, expected);
    assert.equal(h.events.filter(e => e.type === 'pet').length, count, '落地后不额外归位');
    await h.advance(6000); await pending;
  });
}
await check('跳抓播放中取消清理位移且不得晚启动下落', async () => {
  const h = load({ align: true, width: 640, height: 360 }); timing(h); const pending = h.run();
  await h.advance(200);
  assert.equal(h.events.filter(e => e.type === 'pet').length, 0);
  h.dispose(); const count = h.events.filter(e => e.type === 'pet').length;
  await h.advance(6000); await pending;
  assert.deepEqual(h.state.offset, { x: 0, y: 0 });
  assert.equal(h.events.filter(e => e.type === 'pet').length, count);
  assert.equal(ropeMoves(h).length, 0);
});
if (failures) process.exitCode = 1;
