#!/usr/bin/env node
/** 虚拟播放时钟执行彩蛋二真实排播，网络、视频回执和浏览器动画为边界替身。 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const tuner = readFileSync(new URL('../packages/pet-link/src/pet-link-tuner.js', import.meta.url), 'utf8');
const pet = readFileSync(new URL('../packages/pet-link/src/pet-link.js', import.meta.url), 'utf8');
function load(options = {}) {
  let now = 0, id = 0;
  const tasks = new Map(), events = [];
  const record = (type, value) => events.push({ type, value, at: now });
  const schedule = (fn, ms) => { const key = ++id; tasks.set(key, { at: now + Math.max(0, ms), fn }); return key; };
  const playback = { id: 7, name: '彩蛋-吉祥物-哈气-dshwe', phase: 'playing', currentTime: 0, duration: 4 };
  const animations = [];
  const page = { animate(keys, timing) {
    const animation = { pause() {}, cancel() { record('shake-cancel'); },
      set currentTime(value) { this.time = value; record('shake-frame', value); }, get currentTime() { return this.time; } };
    animations.push(animation); record('shake-start', { keys, timing }); return animation;
  } };
  const styles = new Map([['overflow-x', { value: 'auto', priority: 'important' }]]);
  page.style = { getPropertyValue: key => styles.get(key)?.value || '', getPropertyPriority: key => styles.get(key)?.priority || '',
    setProperty: (key, value, priority = '') => styles.set(key, { value, priority }), removeProperty: key => styles.delete(key) };
  const document = { documentElement: page };
  const env = { document, window: { matchMedia: () => ({ matches: !!options.reduced }) }, playback, options, record,
    performance: { now: () => now }, weT: s => s, setTimeout: schedule, clearTimeout: key => tasks.delete(key),
    requestAnimationFrame: fn => schedule(fn, 10), cancelAnimationFrame: key => tasks.delete(key) };
  const mod = new Function(...Object.keys(env), tuner + '\n' + pet + `
    const ctl = { getPlayback: () => playback, unlock() {}, unlockBubbles() {} };
    petLinkPetCtl = () => ctl;
    petLinkPetEl = () => null;
    petLinkSay = async () => true; petLinkBubbleHide = () => true;
    petLinkBubbleDuration = () => true;
    petLinkStops = () => ({ W: 1200, H: 900, rightEdge: { x: 900, y: 450 } });
    petLinkPlay = async key => {
      record('request', key); await petLinkWait(options.ackMs || 0);
      if (options.failPlay) return false;
      petLinkState.lastKey = PET_ANIM[key]; playback.phase = 'playing'; record('playing', key); return true;
    };
    petLinkReturnHomeWalk = async () => record('return');
    petLinkState.runner = { busy: true, sidebar: { syncOpen() {
      record('open-start'); let active = true;
      return { seek(value) { if (active) record('seek', value); },
        finish() { if (active) { active = false; record('finish'); } },
        cancel() { if (active) { active = false; record('cancel'); } } };
    } } };
    return { tuner: petLinkTuner, state: petLinkState,
      motion: alive => typeof petLinkEggHissMotion === 'function' ? petLinkEggHissMotion(alive) : Promise.resolve(false),
      run: () => petLinkRunInner('egg2', petLinkState.epoch), dispose: () => petLink.dispose() };
  `)(...Object.values(env));
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  async function advance(to) {
    await flush();
    for (let n = 0; n < 20000; n++) {
      let first;
      for (const [key, task] of tasks) if (!first || task.at < first.task.at) first = { key, task };
      if (!first || first.task.at > to) { now = to; await flush(); return; }
      now = first.task.at; tasks.delete(first.key); first.task.fn(); await flush();
    }
    throw Error('时钟未收敛');
  }
  return { ...mod, playback, events, animations, page, advance,
    set: (key, value) => mod.tuner.setForLogic('egg2', key, value) };
}
let failures = 0;
async function check(name, fn) { try { await fn(); console.log('PASS ' + name); } catch (e) { failures++; console.error('FAIL ' + name + ': ' + e.message); } }
const of = (h, type) => h.events.filter(e => e.type === type);
await check('彩蛋二独立导出抖动及展开参数，枚举和边界非法值拒绝，重置不串页', () => {
  const h = load();
  for (const [key, value] of Object.entries({ egg2ShakePx: 8, egg2ShakeHz: 12, egg2OpenAtPct: 35, egg2OpenEase: 2 }))
    assert.equal(h.tuner.snapshot().defaults[key], value, key);
  h.tuner.setForLogic('sidebar', 'edgeGapPx', -17);
  assert.equal(h.set('egg2OpenEase', 9), false);
  assert.equal(h.set('egg2OpenAtPct', 101), false);
  assert.equal(h.set('egg2ShakeHz', -1), false);
  assert.notEqual(h.set('egg2ShakePx', 13), false);
  assert.equal(h.tuner.snapshot().logicValues.egg2.egg2ShakePx, 13);
  h.tuner.reset('egg2');
  assert.equal(h.tuner.snapshot().logicValues.egg2.egg2ShakePx, 8);
  assert.equal(h.tuner.snapshot().logicValues.sidebar.edgeGapPx, -17);
});
await check('哈气真实开播前不抖动或展开，实际开播后才接特效', async () => {
  const h = load({ ackMs: 300 }); h.set('egg2LeadMs', 0); h.playback.phase = 'loading';
  const pending = h.run(); await h.advance(200);
  assert.equal(of(h, 'shake-start').length, 0); assert.equal(of(h, 'open-start').length, 0);
  await h.advance(350); assert.equal(of(h, 'shake-start').length, 0);
  h.playback.currentTime = 1.75; await h.advance(400); assert.equal(of(h, 'shake-start').length, 1);
  h.playback.currentTime = 4; h.playback.phase = 'ended'; await h.advance(500); await pending;
  assert.equal(of(h, 'finish').length, 1);
});
await check('按视频进度而非墙钟展开，缓冲时侧栏和抖动冻结，实际ended才到终点', async () => {
  const h = load(); h.set('egg2OpenEase', 0);
  const pending = h.motion(() => true); await h.advance(100);
  assert.equal(of(h, 'shake-start').length, 0); assert.equal(of(h, 'open-start').length, 0);
  h.playback.currentTime = 2; await h.advance(200);
  assert.ok(Math.abs(of(h, 'seek').at(-1).value - (.5 - .35) / .65) < .0001);
  const shake = of(h, 'shake-frame').at(-1).value, seek = of(h, 'seek').at(-1).value;
  await h.advance(5000);
  assert.equal(of(h, 'seek').at(-1).value, seek); assert.equal(of(h, 'shake-frame').at(-1).value, shake);
  assert.equal(of(h, 'finish').length, 0);
  h.playback.currentTime = 4; await h.advance(5100);
  assert.ok(of(h, 'seek').at(-1).value < 1); assert.equal(of(h, 'finish').length, 0);
  h.playback.phase = 'ended'; await h.advance(5200); assert.equal(await pending, true);
  assert.equal(of(h, 'finish').length, 1); assert.equal(of(h, 'shake-cancel').length, 1);
});
await check('展开缓动独立生效，元数据缺失不按预估时长提前展开', async () => {
  const h = load(); h.set('egg2OpenAtPct', 0); h.set('egg2OpenEase', 2);
  h.playback.duration = NaN; const pending = h.motion(() => true); await h.advance(6000);
  assert.equal(of(h, 'open-start').length, 0);
  h.playback.duration = 4; h.playback.currentTime = 2; await h.advance(6100);
  assert.equal(of(h, 'seek').at(-1).value, .875);
  h.playback.phase = 'ended'; await h.advance(6200); await pending;
});
await check('强度零及减少动态效果只关闭抖动，不破坏真实结束同步', async () => {
  for (const reduced of [false, true]) {
    const h = load({ reduced }); if (!reduced) h.set('egg2ShakePx', 0);
    const pending = h.motion(() => true); h.playback.currentTime = 2; await h.advance(100);
    assert.equal(of(h, 'shake-start').length, 0); assert.equal(of(h, 'open-start').length, 1);
    h.playback.phase = 'ended'; await h.advance(200); assert.equal(await pending, true);
    assert.equal(of(h, 'finish').length, 1);
  }
});
await check('卸载同步归还特效及侧栏，旧回调不再结束或改写新演出', async () => {
  const h = load(); h.playback.currentTime = 2;
  const pending = h.motion(() => true); await h.advance(100);
  assert.equal(of(h, 'open-start').length, 1);
  h.dispose(); assert.equal(of(h, 'shake-cancel').length, 1); assert.equal(of(h, 'cancel').length, 1);
  const count = h.events.length; h.playback.phase = 'ended'; await h.advance(1000); await pending;
  assert.equal(h.events.length, count); assert.equal(of(h, 'finish').length, 0);
});
await check('点播失败不启动特效，播放代际被替换即取消旧特效', async () => {
  const failed = load({ failPlay: true }); failed.set('egg2LeadMs', 0); failed.playback.phase = 'failed';
  const run = failed.run(); await failed.advance(1000); await run;
  assert.equal(of(failed, 'shake-start').length, 0); assert.equal(of(failed, 'open-start').length, 0);
  const h = load(); h.playback.currentTime = 2; const pending = h.motion(() => true); await h.advance(100);
  h.playback.id++; await h.advance(200); assert.equal(await pending, false);
  assert.equal(of(h, 'cancel').length, 1); assert.equal(of(h, 'shake-cancel').length, 1);
});
await check('全GUI抖动临时裁剪视口，退出恢复原优先级且不覆盖外部样式修改', async () => {
  const h = load(); h.playback.currentTime = 2; const run = h.motion(() => true); await h.advance(100);
  assert.equal(h.page.style.getPropertyValue('overflow-x'), 'clip');
  h.page.style.setProperty('overflow-y', 'hidden', 'important');
  h.dispose(); await h.advance(200); await run;
  assert.equal(h.page.style.getPropertyValue('overflow-x'), 'auto');
  assert.equal(h.page.style.getPropertyPriority('overflow-x'), 'important');
  assert.equal(h.page.style.getPropertyValue('overflow-y'), 'hidden');
});
await check('抖动开始时刻独立保存导出，负数拒绝且当前重置恢复张嘴帧默认', () => {
  const h = load();
  assert.equal(h.tuner.snapshot().defaults.egg2ShakeAtMs, 1750);
  assert.equal(h.set('egg2ShakeAtMs', -1), false);
  assert.equal(h.set('egg2ShakeAtMs', Infinity), false);
  h.tuner.setForLogic('sidebar', 'edgeGapPx', -17);
  assert.notEqual(h.set('egg2ShakeAtMs', 2100), false);
  assert.equal(h.tuner.snapshot().logicValues.egg2.egg2ShakeAtMs, 2100);
  h.tuner.reset('egg2');
  assert.equal(h.tuner.snapshot().logicValues.egg2.egg2ShakeAtMs, 1750);
  assert.equal(h.tuner.snapshot().logicValues.sidebar.edgeGapPx, -17);
});
await check('张嘴时刻前连动画和裁剪也不创建，按真实视频时间而非墙钟起抖', async () => {
  const h = load(); h.set('egg2ShakeAtMs', 1750);
  const run = h.motion(() => true); h.playback.currentTime = 1; await h.advance(5000);
  assert.equal(of(h, 'shake-start').length, 0);
  assert.equal(h.page.style.getPropertyValue('overflow-x'), 'auto');
  h.playback.currentTime = 1.749; await h.advance(5100);
  assert.equal(of(h, 'shake-start').length, 0);
  h.playback.currentTime = 1.75; await h.advance(5200);
  assert.equal(of(h, 'shake-start').length, 1);
  assert.equal(of(h, 'shake-frame').at(-1).value, 0);
  h.playback.currentTime = 2; await h.advance(5300);
  assert.equal(of(h, 'shake-frame').at(-1).value, 3000);
  const held = of(h, 'shake-frame').at(-1).value; await h.advance(6000);
  assert.equal(of(h, 'shake-frame').at(-1).value, held);
  h.playback.phase = 'ended'; await h.advance(6100); await run;
});
await check('开始前取消不迟到起抖，超出片长不抖动但侧栏仍实际结束到位，零时刻保持兼容', async () => {
  for (const start of [0, 6000]) {
    const h = load(); h.set('egg2ShakeAtMs', start);
    const run = h.motion(() => true); await h.advance(100);
    assert.equal(of(h, 'shake-start').length, start === 0 ? 1 : 0);
    h.playback.phase = 'ended'; await h.advance(200); await run;
    assert.equal(of(h, 'finish').length, 1);
  }
  const h = load(); h.set('egg2ShakeAtMs', 1750);
  const run = h.motion(() => true); await h.advance(100); h.dispose();
  h.playback.currentTime = 2; await h.advance(500); await run;
  assert.equal(of(h, 'shake-start').length, 0);
});
if (failures) process.exitCode = 1;
