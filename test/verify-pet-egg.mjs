#!/usr/bin/env node
/**
 * verify-pet-egg.mjs —— 彩蛋一/二移植的**行为**判据（不只 coverage，T7 真蓝本校正后）。
 *
 * 覆盖：
 *  1) eggAt 双计数真参与选逻辑：eggAt=3 时第 1/2 次点击走常规逻辑、**第 3 次才进彩蛋**；
 *     eggAt=1 / eggAt=2 亦按次数进；far（sidebar）/ near（mascot）分别计数。
 *  2) 全屏抖动（旧版 petLinkEggHissMotion 同口径）：egg2ShakePx 改关键帧振幅；
 *     egg2ShakeHz 改 WAAPI currentTime 推进速率；ShakePx=0 不建动画。
 *  3) 展开缓动：egg2OpenEase=0/2 驱动 syncOpen().seek() 曲线不同（easeOut 早段更快）。
 *  4) 弹飞轨迹三参共同决定：egg1FlingPx / egg1FlingMs / egg1FlingPower 分别改变 throwNative 初速。
 *  5) egg1 段时长（egg1KickMs / egg1FlungMs / egg1LandMs）与 egg1EdgeGapPx 真被消费。
 *  6) 共享层：lockHeartbeatMs 真决定租约续期节奏；bubbleWindowMs 真传给 link.allowBubble。
 *
 * 直接读源码串起来求值（与 verify-pet-linked.mjs 同口径），不依赖构建产物。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FILES = [
  'constants.js', 'mode.js', 'bubble.js',
  'linked-shared.js', 'linked-sidebar.js', 'linked-mascot.js', 'linked-egg1.js', 'linked-egg2.js',
  'linked.js', 'native.js', '../pet-link.js',
];
const source = FILES
  .map(file => readFileSync(new URL('../packages/pet-link/src/pet-link/' + file, import.meta.url), 'utf8'))
  .join('\n');
const load = new Function(source + ';return { createPetLink, detectPetLinkProvider, petLinkDecideLogic };')();

function makeElement() {
  return {
    tag: '', style: {}, children: [], removed: false, _attrs: new Map(),
    setAttribute(key, value) { this._attrs.set(key, value); },
    getAttribute(key) { return this._attrs.get(key); },
    appendChild(node) { this.children.push(node); },
    remove() { this.removed = true; },
    querySelector() { return null; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 40 }; },
  };
}

/** 假 documentElement：记录 WAAPI animate 关键帧/选项，currentTime 可写。 */
function makeRootElement() {
  const styleMap = new Map();
  const animations = [];
  const rootEl = {
    style: {
      setProperty(key, value, priority) { styleMap.set(key, { value, priority: priority || '' }); },
      getPropertyValue(key) { return styleMap.has(key) ? styleMap.get(key).value : ''; },
      getPropertyPriority(key) { return styleMap.has(key) ? styleMap.get(key).priority : ''; },
      removeProperty(key) { styleMap.delete(key); },
    },
    animations,
    animate(keyframes, options) {
      const anim = {
        keyframes, options, currentTime: 0, paused: false, cancelled: false,
        pause() { this.paused = true; },
        cancel() { this.cancelled = true; },
      };
      animations.push(anim);
      return anim;
    },
  };
  return rootEl;
}

/** 搭一套假运行时（与 verify-pet-linked 同构；额外提供 documentElement 抖动、syncOpen、allowBubble）。 */
function harness(cfg = {}) {
  const installed = cfg.installed !== false;
  const enabled = cfg.enabled !== false;
  const linkVersion = cfg.linkVersion ?? 4;
  let clock = 0;
  let serial = 0;
  const calls = { playAnim: [], adoptPosition: [], lock: 0, unlock: 0, throwNative: [], wake: 0, sidebar: [], rope: [], allowBubble: [], seek: [], finish: 0 };
  let locked = false;
  let playback = null;
  let throwAt = -Infinity;
  const edgeState = { v: 700 }; // 侧栏边缘 x；cfg.edge 提供时按展开/收起切换
  const petCenter = { x: 500, y: 400 };
  const SIZE = 180;

  const root = {
    isConnected: true,
    style: {},
    _attrs: new Map(),
    setAttribute(key, value) { this._attrs.set(key, value); },
    getAttribute(key) { return this._attrs.get(key); },
    getBoundingClientRect() {
      return { left: petCenter.x - SIZE / 2, top: petCenter.y - SIZE / 2, width: SIZE, height: SIZE, x: petCenter.x, y: petCenter.y };
    },
  };

  let sleepState = cfg.sleeping ? { sleeping: true, start: 'sleep-start', loop: 'sleep-loop', end: 'sleep-end' } : { sleeping: false };

  const link = {
    version: linkVersion,
    target: 'main',
    getRoot: id => (id === 'main' ? root : null),
    adoptPosition(point) { calls.adoptPosition.push({ x: point.x, y: point.y }); petCenter.x = point.x; petCenter.y = point.y; return true; },
    pollState() { return true; },
    getPlayback() {
      if (sleepState.sleeping) return { playbackId: null, anim: 'sleep-end', currentTime: 0.5, duration: 1, paused: false, buffering: false };
      if (!playback) return { playbackId: null, anim: '', currentTime: 0, duration: 0, paused: true, buffering: false };
      const elapsed = Math.max(0, (clock - playback.at) / 1000);
      const currentTime = Math.min(playback.duration, elapsed);
      return { playbackId: playback.playbackId, anim: playback.anim, currentTime, duration: playback.duration, paused: currentTime >= playback.duration, buffering: false };
    },
    throwNative(point, velocity) { const id = ++serial; throwAt = clock; calls.throwNative.push({ point: { ...point }, velocity: { ...velocity }, id, at: clock, edge: edgeState.v }); return id; },
    stopNativeThrow() { return true; },
    getNativeThrow(id) { const active = clock - throwAt < 300; return { id, active, cancelled: false, state: active ? { x: petCenter.x, y: petCenter.y, vx: -100, vy: -50 } : null }; },
    allowBubble(ms) { calls.allowBubble.push(ms); return true; },
    canBubble() { return true; },
    hideBubble() { return true; },
    setBubbleDuration() { return true; },
    lock(name, ttl, preserveBubble, petId) { calls.lock += 1; locked = true; return true; },
    unlock() { calls.unlock += 1; locked = false; return true; },
    isLocked() { return locked; },
  };
  if (linkVersion < 4) { delete link.setBubbleDuration; }

  const api = installed ? {
    pose: () => ({ x: petCenter.x / 1000, y: petCenter.y / 800, facing: 'left' }),
    getState: () => ({ pets: { main: { sleep: { data: sleepState } } } }),
    progress: () => null,
    menuEvents: () => ({ ok: false }),
    link,
  } : null;

  const sidebar = Object.fromEntries(['open', 'close', 'beginPull', 'commit', 'toggle'].map(key =>
    [key, (...args) => { calls.sidebar.push({ method: key, args, at: clock }); return true; }]));
  sidebar.rebound = (expanded, ms) => {
    calls.sidebar.push({ method: 'rebound', args: [expanded, ms], at: clock });
    if (cfg.edge) edgeState.v = expanded ? cfg.edge.open : cfg.edge.close;
    return true;
  };
  sidebar.edgeX = () => edgeState.v;
  sidebar.isOpen = () => false;
  if (cfg.syncOpen) {
    sidebar.syncOpen = () => ({
      seek(progress) { calls.seek.push(progress); },
      finish() { calls.finish += 1; },
      cancel() { /* noop */ },
    });
  }

  const bubbleNodes = [];
  const document = {
    createElement: () => makeElement(),
    body: { appendChild(node) { bubbleNodes.push(node); } },
    querySelector: () => null,
  };
  // 全屏抖动直接对 document.documentElement.animate（旧版同口径）——夹具注入之。
  const rootEl = makeRootElement();
  const prevDoc = globalThis.document;
  globalThis.document = { ...document, documentElement: rootEl };

  const petLink = load.createPetLink({
    isEnabled: () => enabled,
    getApi: () => api,
    translate: value => value,
    viewport: () => ({ width: 1000, height: 800 }),
    document,
    storage: null,
    now: () => clock,
    wait: async ms => { clock += Math.max(40, ms); },
    setTimeout: () => 0,
    clearTimeout: () => {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    bubbleUrl: index => '/m' + index + '.png',
    playAnim: async (petId, name, facing) => {
      calls.playAnim.push({ petId, name, facing, at: clock });
      playback = { anim: name, playbackId: 'p' + ++serial, at: clock, duration: 0.4 };
      return true;
    },
    wake: async petId => { calls.wake += 1; sleepState = { sleeping: false }; return true; },
    rope: {
      point: () => ({ x: 0.25, y: 0.5 }),
      moveRope(px) { calls.rope.push({ move: px }); },
      restoreRope() { calls.rope.push({ restore: true }); },
    },
    fallback: () => { calls.sidebar.push({ method: 'fallback' }); return true; },
  });
  petLink.mascot.registerSidebar(sidebar);
  return {
    petLink, calls, bubbleNodes, api, rootEl,
    setPetX(x) { petCenter.x = x; },
    clock: () => clock,
    restoreDoc() { if (prevDoc === undefined) delete globalThis.document; else globalThis.document = prevDoc; },
  };
}

const tune = (h, logic, key, value) => {
  const ok = h.petLink.tuner.setForLogic(logic, key, value);
  assert.equal(ok, true, `setForLogic(${logic},${key},${value}) 应成功`);
};

// ── 1) eggAt 双计数：far(sidebar) / near(mascot) 分别「第 N 次才进彩蛋」──────────
{
  const h = harness();
  tune(h, 'sidebar', 'eggAt', 3);
  const r1 = await h.petLink.mascot.tap();
  const r2 = await h.petLink.mascot.tap();
  const r3 = await h.petLink.mascot.tap();
  assert.equal(r1.logic, 'sidebar', '第 1 次点击应走常规 sidebar，不进彩蛋，实际 ' + r1.logic);
  assert.equal(r2.logic, 'sidebar', '第 2 次点击应走常规 sidebar，不进彩蛋，实际 ' + r2.logic);
  assert.equal(r3.logic, 'egg1', '第 3 次点击必须进彩蛋一，实际 ' + r3.logic);
  assert.equal(h.petLink.snapshot().farCount, 0, '触发彩蛋后 far 计数归零');
  h.restoreDoc();
}
{
  const h1 = harness();
  tune(h1, 'sidebar', 'eggAt', 1);
  const a1 = await h1.petLink.mascot.tap();
  assert.equal(a1.logic, 'egg1', 'eggAt=1：第 1 次即彩蛋一');
  h1.restoreDoc();

  const h2 = harness();
  tune(h2, 'sidebar', 'eggAt', 2);
  const b1 = await h2.petLink.mascot.tap();
  const b2 = await h2.petLink.mascot.tap();
  assert.equal(b1.logic, 'sidebar', 'eggAt=2：第 1 次常规');
  assert.equal(b2.logic, 'egg1', 'eggAt=2：第 2 次彩蛋一');
  h2.restoreDoc();
}
{
  const h = harness();
  h.setPetX(260);
  tune(h, 'mascot', 'eggAt', 3);
  const r1 = await h.petLink.mascot.tap();
  const r2 = await h.petLink.mascot.tap();
  const r3 = await h.petLink.mascot.tap();
  assert.equal(r1.logic, 'mascot', 'near 路径第 1 次常规 mascot，实际 ' + r1.logic);
  assert.equal(r2.logic, 'mascot', 'near 路径第 2 次常规 mascot，实际 ' + r2.logic);
  assert.equal(r3.logic, 'egg2', 'near 路径第 3 次必须进彩蛋二，实际 ' + r3.logic);
  assert.equal(h.petLink.snapshot().nearCount, 0, '触发彩蛋后 near 计数归零');
  h.restoreDoc();
}
console.log('PASS eggAt 双计数：第 1/2 次不进彩蛋、第 3 次进（far=egg1 / near=egg2；eggAt=1/2 亦按次数）');

// ── 2) 全屏抖动（旧版 petLinkEggHissMotion 同口径）：Px 改振幅、Hz 改推进速率 ───────
const TRANSLATE_X = frame => {
  const m = /^(-?[\d.]+)px/.exec(String(frame.translate || ''));
  return m ? Number(m[1]) : NaN;
};
async function runShake(px, hz, atMs = 100) {
  const h = harness();
  tune(h, 'egg2', 'egg2ShakePx', px);
  tune(h, 'egg2', 'egg2ShakeHz', hz);
  tune(h, 'egg2', 'egg2ShakeAtMs', atMs);
  tune(h, 'egg2', 'egg2HissMs', 5000);
  const done = await h.petLink.tuner.run('egg2');
  assert.equal(done.phase, 'done', 'egg2 应跑完');
  const anims = h.rootEl.animations;
  const result = { anims, calls: h.calls, rootEl: h.rootEl };
  h.restoreDoc();
  return result;
}
{
  const a = await runShake(20, 8);
  assert.equal(a.anims.length, 1, 'egg2ShakePx>0 必须创建 1 个 documentElement 抖动动画');
  const animA = a.anims[0];
  const xsA = animA.keyframes.map(TRANSLATE_X);
  const maxA = Math.max(...xsA.map(Math.abs));
  assert.equal(maxA, 20, '关键帧最大横向位移应等于 egg2ShakePx（实际 ' + maxA + '）');
  assert.equal(animA.options.duration, 1000, '抖动周期固定 1000ms（旧版同）');
  assert.equal(animA.options.iterations, Infinity, '抖动无限迭代');
  assert.equal(animA.options.easing, 'linear', '关键帧线性、频率靠 currentTime 控制（旧版同）');
  // 纵向分量 = strength*0.625（旧版 y=strength*.625）。
  const ys = animA.keyframes.map(f => Number((/(-?[\d.]+)px$/).exec(String(f.translate || '').trim())?.[1]));
  assert.ok(ys.some(v => Math.abs(Math.abs(v) - 12.5) < 1e-9), '纵向分量应为 ±12.5px（20*0.625）');

  const b = await runShake(40, 8);
  const maxB = Math.max(...b.anims[0].keyframes.map(TRANSLATE_X).map(Math.abs));
  assert.equal(maxB, 40, 'egg2ShakePx 翻倍 → 振幅翻倍（' + maxA + ' vs ' + maxB + '）');

  const c = await runShake(20, 4);
  const rateA = a.anims[0].currentTime;
  const rateC = c.anims[0].currentTime;
  assert.ok(rateA > 0, '抖动开始后 currentTime 应被推进');
  assert.ok(Math.abs(rateA / rateC - 2) < 1e-6, 'egg2ShakeHz 翻倍 → WAAPI currentTime 推进速率翻倍（' + rateA + ' vs ' + rateC + '）');

  const off = await runShake(0, 8);
  assert.equal(off.anims.length, 0, 'egg2ShakePx=0 不得创建抖动动画（默认原地不动）');
  assert.equal(off.calls.adoptPosition.length, 0, '默认不写 adoptPosition，保持原地不动');
}
console.log('PASS 全屏抖动：documentElement WAAPI 关键帧振幅随 egg2ShakePx、currentTime 速率随 egg2ShakeHz；ShakePx=0 关闭');

// ── 3) 展开缓动：egg2OpenEase 驱动 syncOpen().seek() 曲线 ───────────────────────
async function runEase(easeIndex) {
  const h = harness({ syncOpen: true });
  tune(h, 'egg2', 'egg2OpenEase', easeIndex);
  const done = await h.petLink.tuner.run('egg2');
  assert.equal(done.phase, 'done');
  const seek = h.calls.seek.slice();
  const finish = h.calls.finish;
  h.restoreDoc();
  return { seek, finish };
}
{
  const linear = await runEase(0);
  const easeOut = await runEase(2);
  assert.ok(linear.finish >= 1, '哈气结束应调用 syncOpen().finish() 完成展开');
  assert.ok(linear.seek.length > 0, '过 egg2OpenAtPct 后应逐帧 seek 推进展开');
  assert.notDeepEqual(linear.seek, easeOut.seek, 'egg2OpenEase=0 与 2 的展开曲线应不同');
  for (let i = 0; i < Math.min(linear.seek.length, easeOut.seek.length); i += 1) {
    assert.ok(easeOut.seek[i] + 1e-9 >= linear.seek[i], '缓出(2) 的展开进度应不慢于匀速(0) @' + i);
  }
  assert.ok(easeOut.seek.some((v, i) => v > linear.seek[i] + 1e-6), '缓出(2) 至少某些帧严格更快（曲线不同）');
}
console.log('PASS 展开缓动：egg2OpenEase=0/2 经 syncOpen().seek() 产生不同展开曲线（缓出早段更快）');

// ── 4) 弹飞轨迹：FlingPx / FlingMs / FlingPower 三参共同决定初速 ─────────────────
async function runFling(tuneOverrides = {}) {
  const h = harness();
  for (const [key, value] of Object.entries(tuneOverrides)) tune(h, 'egg1', key, value);
  const done = await h.petLink.tuner.run('egg1');
  assert.equal(done.phase, 'done', 'egg1 应跑完');
  assert.ok(h.calls.throwNative.length >= 1, 'egg1 必须调 throwNative');
  const vel = h.calls.throwNative[0].velocity;
  h.restoreDoc();
  return vel;
}
{
  const base = await runFling();
  // 用**当前实际默认值**派生「翻倍」输入，别硬编码 1040/1400（默认值已按蓝本校正为
  // egg1FlingPx=420 / egg1FlingMs=520，硬编码会与默认值脱钩、变成假红）。
  const defaults = harness().petLink.tuner.snapshot().defaults;
  const px2 = await runFling({ egg1FlingPx: defaults.egg1FlingPx * 2 });
  const ms2 = await runFling({ egg1FlingMs: defaults.egg1FlingMs * 2 });
  const pow2 = await runFling({ egg1FlingPower: 2 });
  assert.ok(base.vx < 0 && base.vy < 0, '弹飞方向朝左上');
  assert.ok(Math.abs(px2.vx / base.vx - 2) < 1e-6, 'egg1FlingPx 翻倍 → 水平初速翻倍（' + base.vx + ' vs ' + px2.vx + '）');
  assert.ok(Math.abs(ms2.vx / base.vx - 0.5) < 1e-6, 'egg1FlingMs 翻倍 → 水平初速减半（' + base.vx + ' vs ' + ms2.vx + '）');
  assert.ok(Math.abs(pow2.vx / base.vx - 2) < 1e-6, 'egg1FlingPower 翻倍 → 水平初速翻倍（' + base.vx + ' vs ' + pow2.vx + '）');
}
console.log('PASS 弹飞：egg1FlingPx / egg1FlingMs / egg1FlingPower 分别线性改变 throwNative 初速（非只调 power）');

// ── 5) egg1 段时长 / 专属间距 / 425-640 锚点 / 回程 600ms ─────────────────────
{
  // defaults 真源：从 tuner.snapshot().defaults 取，别硬编码蓝本旧默认（T5 已按蓝本改默认）。
  const dh = harness();
  const DEFAULTS = dh.petLink.tuner.snapshot().defaults;
  dh.restoreDoc();

  // 5a) egg1KickMs 段时长
  const long = harness();
  const short = harness();
  tune(short, 'egg1', 'egg1KickMs', 0);
  const dl = await long.petLink.tuner.run('egg1');
  const ds = await short.petLink.tuner.run('egg1');
  assert.equal(dl.phase, 'done');
  assert.equal(ds.phase, 'done');
  assert.ok(short.clock() <= long.clock(), 'egg1KickMs=0 应比默认更快进入后续段');
  long.restoreDoc(); short.restoreDoc();

  // 5b) 踢腿锚点 = 425/640（脚尖接触点），不是 handRightRatio。
  const rectW = 180, edge = 700, gap = DEFAULTS.egg1EdgeGapPx;
  const anchorX = edge - gap - rectW * (425 / 640 - 0.5);
  const handX = edge - gap - rectW * (DEFAULTS.handRightRatio - 0.5);
  const peakX = h => (h.calls.adoptPosition.length ? Math.max(...h.calls.adoptPosition.map(c => c.x)) : NaN);
  const h0 = harness();
  await h0.petLink.tuner.run('egg1');
  assert.ok(Math.abs(peakX(h0) - anchorX) < 2, '踢腿位应落到 425/640 锚点 x≈' + anchorX.toFixed(2) + '，实际 ' + peakX(h0).toFixed(2));
  if (Math.abs(anchorX - handX) > 5) {
    assert.ok(Math.abs(peakX(h0) - handX) > 5, '踢腿位不应退回 handRightRatio x≈' + handX.toFixed(2));
  }
  h0.restoreDoc();

  // 5c) egg1EdgeGapPx 改变 → 踢腿位相应平移。
  const hg = harness();
  tune(hg, 'egg1', 'egg1EdgeGapPx', 50);
  await hg.petLink.tuner.run('egg1');
  assert.ok(Math.abs(peakX(hg) - (anchorX - 50)) < 2, 'egg1EdgeGapPx=50 应把踢腿位左移 50px（实际 ' + peakX(hg).toFixed(2) + '）');
  hg.restoreDoc();

  // 5d) 回程 600ms：egg1 最后一个走路段（returnHome）耗时≈600ms，而非 sidebarWalkMs。
  const hr = harness();
  const dr = await hr.petLink.tuner.run('egg1');
  assert.equal(dr.phase, 'done');
  const anims = hr.calls.playAnim;
  const lastWalk = anims[anims.length - 1];
  const returnSpan = hr.clock() - lastWalk.at;
  assert.ok(returnSpan >= 550 && returnSpan <= 900, 'egg1 回程段时长应≈600ms（实际 ' + returnSpan + 'ms）');
  assert.ok(returnSpan < 2000, 'egg1 回程不得退回 sidebarWalkMs(≈' + DEFAULTS.sidebarWalkMs + 'ms)');
  hr.restoreDoc();
}
console.log('PASS egg1：egg1KickMs 段时长、egg1EdgeGapPx 间距、425/640 踢腿锚点、回程 600ms');

// ── 5.5) F2 回弹三阶段：展开→接触(370/640)→起飞→收起→再展开 + 弹飞启动延迟 ──────
async function runEgg1Edge(edge, opts = {}) {
  const h = harness({ edge });
  if (opts.flingDelay !== undefined) {
    const ok = h.petLink.tuner.setForLogic('egg1', 'egg1FlingStartDelayMs', opts.flingDelay);
    assert.equal(ok, true, '设置弹飞启动延迟应成功');
  }
  const done = await h.petLink.tuner.run('egg1');
  assert.equal(done.phase, 'done', 'egg1 应跑完');
  const flung = h.calls.playAnim.find(a => a.name.indexOf('被弹飞') >= 0);
  const throw0 = h.calls.throwNative[0];
  const rebounds = h.calls.sidebar.filter(c => c.method === 'rebound');
  const flingDelay = (flung && throw0) ? throw0.at - flung.at : NaN;
  const result = { h, flung, throw0, rebounds, flingDelay };
  h.restoreDoc();
  return result;
}
{
  // 由 defaults 与踢腿锚点算出回弹接触阈值（避免写死像素）。
  const dcfg = harness();
  const D2 = dcfg.petLink.tuner.snapshot().defaults;
  dcfg.restoreDoc();
  const rectW = 180, edge0 = 700, gap0 = D2.egg1EdgeGapPx;
  const kickX = edge0 - gap0 - rectW * (425 / 640 - 0.5); // 踢腿位中心（蓝本 425/640 锚点）
  const petLeft = kickX - rectW / 2;
  const contact370 = petLeft + rectW * (370 / 640); // 回弹接触锚点（370/640，躯干）
  const contact425 = petLeft + rectW * (425 / 640); // 若错用踢腿锚点的对照值
  assert.ok(contact425 - contact370 > 10, '370/640 与 425/640 接触位应有可区分差值');
  const hitEdge = Math.floor(contact370 - 10);                                  // 必接触
  const missEdge = Math.ceil(contact370 + (contact425 - contact370) / 2);       // 370 不接触、425 会接触

  // A) 及时接触 → 快速起飞；三阶段 open(240)→fling→close(180)→reopen(300) 真发生。
  const hit = await runEgg1Edge({ open: hitEdge, close: 700 });
  assert.ok(hit.throw0, 'egg1 必须起飞（throwNative）');
  assert.ok(hit.flingDelay < 300, '接触及时→快速起飞，实际 ' + hit.flingDelay + 'ms');
  const rb = hit.rebounds;
  assert.ok(rb.length >= 3, 'rebound 阶段应 ≥3 次，实际 ' + rb.length);
  assert.deepEqual(rb[0].args, [true, 240], '第 1 阶段应为 展开 240ms');
  assert.deepEqual(rb[1].args, [false, 180], '第 2 阶段应为 收起 180ms');
  assert.deepEqual(rb[2].args, [true, 300], '第 3 阶段应为 再展开 300ms');
  assert.ok(rb[0].at <= hit.throw0.at && hit.throw0.at <= rb[1].at,
    '起飞必须发生在「展开」与「收起」之间（证明接触阶段真跑，不是只多调两次 API）');
  assert.ok(rb[2].at > rb[1].at, '收起应先于再展开（close→reopen 时序）');

  // B) 接触锚点=370/640：missEdge 介于 370 与 425 两接触位之间 → 370 不接触(走兜底≈1200ms)，425 会立即起飞。
  const miss = await runEgg1Edge({ open: missEdge, close: 700 });
  assert.ok(miss.throw0, '未接触兜底也必须起飞（流程不空转）');
  assert.ok(miss.flingDelay > 1000, 'edge=' + missEdge + ' 在 370/640 阈值下不接触→兜底起飞≈1200ms；若错用 425/640 会立即起飞。实际 ' + miss.flingDelay + 'ms');
  assert.equal(miss.throw0.edge, missEdge, '起飞时边缘读数应等于未达接触锚点的值');

  // C) 弹飞启动延迟真控起飞时刻：加大 300ms → 起飞按量后移。
  const d0 = await runEgg1Edge({ open: hitEdge, close: 700 }, { flingDelay: 0 });
  const d3 = await runEgg1Edge({ open: hitEdge, close: 700 }, { flingDelay: 300 });
  const delta = d3.flingDelay - d0.flingDelay;
  assert.ok(Math.abs(delta - 300) < 150, '弹飞启动延迟 +300ms 应使起飞后移≈300ms，实际 ' + delta + 'ms');
}
console.log('PASS F2 回弹三阶段：open240→接触(370/640)→fling→close180→reopen300；弹飞启动延迟真控起飞时刻');

// ── 6) 共享层：lockHeartbeatMs 真决定续期节奏；bubbleWindowMs 真传给 allowBubble ──
{
  const base = harness();
  await base.petLink.tuner.run('sidebar');
  const beat = harness();
  tune(beat, 'sidebar', 'lockHeartbeatMs', 1000);
  await beat.petLink.tuner.run('sidebar');
  assert.ok(beat.calls.lock > base.calls.lock, 'lockHeartbeatMs=1000 的续期次数应多于默认（' + base.calls.lock + ' vs ' + beat.calls.lock + '）');
  assert.ok(beat.calls.lock >= 3, 'lockHeartbeatMs=1000 在一轮里应发生多次续期，实际 ' + beat.calls.lock);
  base.restoreDoc(); beat.restoreDoc();

  const hb = harness();
  tune(hb, 'sidebar', 'bubbleWindowMs', 1234);
  await hb.petLink.tuner.run('sidebar');
  assert.ok(hb.calls.allowBubble.includes(1234), 'bubbleWindowMs 应原样传给 link.allowBubble，实际 ' + JSON.stringify(hb.calls.allowBubble));
  hb.restoreDoc();
}
console.log('PASS 共享层：lockHeartbeatMs 真续期、bubbleWindowMs 真传 allowBubble');

console.log('PASS T11/T10/T7 彩蛋一/二：eggAt 计数 + 全屏抖动(WAAPI) + 展开缓动 + 弹飞轨迹 + 三阶段回弹(370/640+延迟) + 段时长 + 425/640 踢腿锚点 + 回程 600ms + 共享层');
