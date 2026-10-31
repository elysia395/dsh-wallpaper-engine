import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * M5 pet-link 浏览器半 · 抓绳互动（逻辑二）专项夹具（真蓝本对照版 · T9 接线收尾）。
 *
 * 蓝本：`_reference/legacy-pet-link-138k.js`
 *   · 站位锚点 `petLinkMascotStand`：手位 312/640、36/360（**不是** sidebar 的 handRightRatio）。
 *   · `petLinkMascotPlaybackMotion`：releaseAt=max(grab+pull, tune)；绳位移分段缓动；
 *     脱手 = 逐帧页面内写位（新架构 adoptPosition），**绝对落点 = landingBase.y + mascotDropPx**。
 *
 * 断言目标：
 *   ① 站位用蓝本手位锚点，且**不随 handRightRatio 变**（能区分两种实现）；
 *   ② 下落是绝对落点 landingBase.y + dropPx；
 *   ③ 12 个 mascot 旋钮改后输出按预期变（敏感度矩阵，默认值从 PETLINK_DEFAULTS 动态派生）；
 *   ④ 抓住/侧栏默认同刻、可分别调开；releaseAt 被 grab+pull 钳住；
 *   ⑤ 绳子缓动 ease=0 与 ease=2 可区分；无逐帧 HTTP。
 */

const FILES = [
  'constants.js', 'mode.js', 'bubble.js',
  'linked-shared.js', 'linked-sidebar.js', 'linked-mascot.js', 'linked-egg1.js', 'linked-egg2.js',
  'linked.js', 'native.js', '../pet-link.js',
];
const source = FILES
  .map(file => readFileSync(new URL('../packages/pet-link/src/pet-link/' + file, import.meta.url), 'utf8'))
  .join('\n');
const load = new Function(source + ';return { createPetLink, PETLINK_DEFAULTS };')();
const D = load.PETLINK_DEFAULTS;

/** mascot 12 键默认值（从 PETLINK_DEFAULTS 动态派生，避免写死旧值造成假红）。 */
const MASCOT_KEYS = [
  'mascotWalkMs', 'mascotTumbleMs', 'mascotGrabAtMs', 'mascotOpenAtMs',
  'mascotRopeDownPx', 'mascotRopePullMs', 'mascotRopeBackMs',
  'mascotRopePullEase', 'mascotRopeBackEase', 'mascotReleaseAtMs', 'mascotDropPx', 'mascotDropMs',
];
const REAL_DEFAULTS = Object.fromEntries(MASCOT_KEYS.map(key => [key, D[key]]));

// 蓝本手位锚点（夹具自算期望，用于区分「蓝本比例」与「误用 handRightRatio」）。
const HAND_X = 312 / 640;
const HAND_Y = 36 / 360;

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

const VIEW = { width: 1000, height: 800 };
const HOME = { x: 500, y: 400 };
const SIZE = 180;
const ROPE = { x: 0.25, y: 0.5 }; // rope.point（中心 x、下沿 y）→ px = (250, 400)

/**
 * 抓绳互动专用假运行时。
 * @param {object} cfg - { overrides? }
 */
function harness(cfg = {}) {
  let clock = 0;
  let serial = 0;
  const calls = { playAnim: [], adoptPosition: [], lock: 0, unlock: 0, sidebar: [], rope: [] };
  let getPlaybackReads = 0;
  let locked = false;
  let playback = null;
  const petCenter = { ...HOME };

  const root = {
    isConnected: true, style: {}, _attrs: new Map(),
    setAttribute(key, value) { this._attrs.set(key, value); },
    getAttribute(key) { return this._attrs.get(key); },
    getBoundingClientRect() {
      return { left: petCenter.x - SIZE / 2, top: petCenter.y - SIZE / 2, width: SIZE, height: SIZE, x: petCenter.x, y: petCenter.y };
    },
  };

  const durOf = name => {
    if (name.includes('螃蟹步')) return 0.25;
    if (name.includes('跳抓')) return 8;
    return 0.4;
  };

  const link = {
    version: 4, target: 'main',
    getRoot: id => (id === 'main' ? root : null),
    adoptPosition(point) {
      calls.adoptPosition.push({ ...point, at: clock });
      petCenter.x = point.x; petCenter.y = point.y; return true;
    },
    pollState() { return true; },
    getPlayback() {
      getPlaybackReads += 1;
      if (!playback) return { playbackId: null, anim: '', currentTime: 0, duration: 0, paused: true, buffering: false };
      const elapsed = Math.max(0, (clock - playback.at) / 1000);
      const currentTime = Math.min(playback.duration, elapsed);
      return { playbackId: playback.playbackId, anim: playback.anim, currentTime, duration: playback.duration, paused: currentTime >= playback.duration, buffering: false };
    },
    throwNative() { return ++serial; },
    stopNativeThrow() { return true; },
    getNativeThrow() { return { id: 1, active: false, cancelled: false }; },
    allowBubble() { return true; },
    hideBubble() { return true; },
    setBubbleDuration() { return true; },
    lock() { calls.lock += 1; locked = true; return true; },
    unlock() { calls.unlock += 1; locked = false; return true; },
    isLocked() { return locked; },
  };

  const api = {
    pose: () => ({ x: petCenter.x / 1000, y: petCenter.y / 800, facing: 'left' }),
    getState: () => ({ pets: { main: { sleep: { data: { sleeping: false } } } } }),
    progress: () => null,
    menuEvents: () => ({ ok: false }),
    link,
  };

  const sidebar = Object.fromEntries(['open', 'close', 'beginPull', 'commit', 'rebound', 'toggle'].map(key =>
    [key, (...args) => { calls.sidebar.push({ method: key, args, at: clock }); return true; }]));
  sidebar.edgeX = () => 700;
  sidebar.isOpen = () => false;

  const bubbleNodes = [];
  const document = {
    createElement: () => makeElement(),
    body: { appendChild(node) { bubbleNodes.push(node); } },
    querySelector: () => null,
  };

  const petLink = load.createPetLink({
    isEnabled: () => true,
    getApi: () => api,
    translate: value => value,
    viewport: () => ({ ...VIEW }),
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
      playback = { anim: name, playbackId: 'p' + ++serial, at: clock, duration: durOf(name) };
      return true;
    },
    wake: async () => true,
    rope: {
      point: () => ({ ...ROPE }),
      moveRope(px) { calls.rope.push({ move: px, at: clock }); },
      restoreRope() { calls.rope.push({ restore: true, at: clock }); },
    },
    fallback: () => { calls.sidebar.push({ method: 'fallback', at: clock }); return true; },
  });
  petLink.mascot.registerSidebar(sidebar);

  // 动态默认 + mascotWalkMs=250（把 0=自动 固定成可计时值，纯测试便利）。
  const tuning = { ...REAL_DEFAULTS, mascotWalkMs: 250, ...(cfg.overrides || {}) };
  for (const [key, value] of Object.entries(tuning)) {
    assert.equal(petLink.tuner.setForLogic('mascot', key, value), true, '设置旋钮失败：' + key);
  }

  return { petLink, calls, bubbleNodes, home: HOME, reads: () => getPlaybackReads, isLocked: () => locked };
}

/** 从一次运行得到可比较指标（时间换算成「跳抓段 clip 时间」ms）。 */
function metrics(h) {
  const tumble = h.calls.playAnim.find(item => item.name.includes('跳抓'));
  const t0 = tumble ? tumble.at : 0;
  const clip = at => at - t0;
  const moves = h.calls.rope.filter(item => typeof item.move === 'number');
  const maxRope = moves.length ? Math.max(...moves.map(item => item.move)) : 0;
  const firstPositive = moves.find(item => item.move > 0);
  const openCall = h.calls.sidebar.find(item => item.method === 'open');

  const adoptions = h.calls.adoptPosition;
  const pre = adoptions.filter(item => item.at <= t0);
  const walkEnd = pre.length ? pre[pre.length - 1] : null;
  const walkEndY = walkEnd ? walkEnd.y : h.home.y;
  const dropFirst = adoptions.find(item => item.at > t0 && item.y > walkEndY + 1);
  const dropMaxY = adoptions.length ? Math.max(...adoptions.map(item => item.y)) : h.home.y;

  let lastPosIdx = -1;
  moves.forEach((item, i) => { if (item.move > 0) lastPosIdx = i; });
  const zeroAfter = lastPosIdx >= 0 ? moves.slice(lastPosIdx + 1).find(item => item.move === 0) : null;

  return {
    maxRope,
    ropeFirstClip: firstPositive ? clip(firstPositive.at) : null,
    openClip: openCall ? clip(openCall.at) : null,
    dropFirstClip: dropFirst ? clip(dropFirst.at) : null,
    dropMaxY,
    ropeZeroClip: zeroAfter ? clip(zeroAfter.at) : null,
    walkEnd,
    http: h.calls.playAnim.length,
    reads: h.reads(),
  };
}

async function run(cfg = {}) {
  const h = harness(cfg);
  const done = await h.petLink.tuner.run('mascot');
  return { h, done, m: metrics(h) };
}

/** 取「绳子下拉」递增序列（首个正值到峰值/平台）。 */
function pullSequence(moves) {
  const vals = moves.filter(item => typeof item.move === 'number').map(item => item.move);
  const start = vals.findIndex(v => v > 0);
  if (start < 0) return [];
  const seq = [];
  for (let i = start; i < vals.length; i += 1) {
    if (i === start || vals[i] >= vals[i - 1] - 1e-9) seq.push(vals[i]);
    else break;
  }
  return seq;
}

// 蓝本几何期望（夹具自算）
const ropeX = ROPE.x * VIEW.width;                 // 250
const ropeY = ROPE.y * VIEW.height;                // 400（绳下沿）
const standX = ropeX - SIZE * (HAND_X - 0.5);      // 252.25
// 站位口径照抄蓝本 petLinkMascotStand（L1251-1255）：
  //   目标 = 当前中心 + (绳子位置 − 手当前绝对位置)；手在容器内 y = padY + videoH×36/360。
  //   夹具里 rect.top=0 ⇒ standY = SIZE/2 + ropeY − handYInBox。
  const videoH = SIZE * 9 / 16;
  const padY = (SIZE - videoH) / 2;
  const handYInBox = padY + videoH * (36 / 360);
  const standY = SIZE / 2 + ropeY - handYInBox;
const landingY = Math.min(VIEW.height - 60, ropeY + 120); // 520
const releaseAt = Math.max(D.mascotGrabAtMs + D.mascotRopePullMs, D.mascotReleaseAtMs);

// ── 1) 基线：站位锚点 + 绝对落点 + 时间线 ─────────────────────────────────────
{
  const { h, done, m } = await run();
  assert.equal(done.phase, 'done', 'mascot 必须跑完');
  assert.equal(h.isLocked(), false, '结束必须归还租约');
  assert.ok(h.bubbleNodes.length > 0, '必须自绘气泡');

  // 站位：手位锚点 312/640、36/360（不是 handRightRatio）。
  assert.ok(m.walkEnd, '必须有走位写位');
  assert.ok(Math.abs(m.walkEnd.x - standX) < 1, '站位 x 应≈ropeX + size×(0.5−312/640)=' + standX + '，实际 ' + m.walkEnd.x);
  assert.ok(Math.abs(m.walkEnd.y - standY) < 1, '站位 y 应≈ropeY + size×(0.5−36/360)=' + standY + '，实际 ' + m.walkEnd.y);

  // 抓住/侧栏默认同刻。
  assert.ok(m.ropeFirstClip !== null && m.openClip !== null);
  assert.ok(Math.abs(m.ropeFirstClip - m.openClip) <= 80, '默认 grab==open==2500 应同刻；rope=' + m.ropeFirstClip + ' open=' + m.openClip);

  // releaseAt = max(grab+pull, tune) 钳位。
  assert.ok(m.dropFirstClip !== null, '必须发生脱手下落');
  assert.ok(Math.abs(m.dropFirstClip - releaseAt) <= 100, 'releaseAt 应≈' + releaseAt + '（max 钳位），实际 ' + m.dropFirstClip);

  // 绳子下拉≈ropeDownPx，最终归零并 restore。
  assert.ok(Math.abs(m.maxRope - D.mascotRopeDownPx) < 1, '绳子最大位移应≈' + D.mascotRopeDownPx + '，实际 ' + m.maxRope);
  assert.ok(h.calls.rope.some(item => item.restore === true), '收尾必须 restoreRope');
  const lastMove = [...h.calls.rope].reverse().find(item => typeof item.move === 'number');
  assert.equal(lastMove.move, 0, '绳子最终应回到 0');

  // 绝对落点 = landingBase.y + dropPx（不是「当前中心 + dropPx」）。
  const expectedDropY = landingY + D.mascotDropPx;
  assert.ok(Math.abs(m.dropMaxY - expectedDropY) < 2, '下落绝对落点应≈' + expectedDropY + '（landingBase.y+' + D.mascotDropPx + '），实际 ' + m.dropMaxY);
  const relDropY = standY + D.mascotDropPx;
  assert.ok(Math.abs(m.dropMaxY - relDropY) > 30, '必须区别于「相对偏移」算法（相对值≈' + relDropY + '）');

  assert.ok(m.http <= 4, '动作触发（HTTP）应有界，实际 ' + m.http);
  assert.ok(m.reads > m.http * 10, 'getPlayback 应逐帧远多于 HTTP，reads=' + m.reads + ' http=' + m.http);

  console.log('PASS 基线：站位按蓝本手位锚点 · releaseAt=max(grab+pull) 钳位 · 绳子 ' + D.mascotRopeDownPx + 'px · 绝对落点 landingBase.y+' + D.mascotDropPx + ' · 无逐帧 HTTP');
}

// ── 2) 锚点用蓝本比例，不被 handRightRatio 带偏 ──────────────────────────────
{
  const { m } = await run({ overrides: { handRightRatio: 0.2 } });
  assert.ok(m.walkEnd, '必须有走位写位');
  assert.ok(Math.abs(m.walkEnd.x - standX) < 1, '改 handRightRatio=0.2 不应影响吉祥物站位；期望 ' + standX + '，实际 ' + m.walkEnd.x);
  const wrongX = ropeX - SIZE * (0.2 - 0.5); // 若误用 handRightRatio 会到 304
  assert.ok(Math.abs(m.walkEnd.x - wrongX) > 30, '必须明显区别于「误用 handRightRatio」的落点 ' + wrongX);
  assert.ok(Math.abs(m.walkEnd.y - standY) < 1, '站位 y 仍应按 36/360 锚点 ' + standY + '，实际 ' + m.walkEnd.y);
  console.log('PASS 站位锚点：312/640 与 36/360 固定比例，handRightRatio 变化不影响（≠误用 handRightRatio）');
}

// ── 3) 抓住与侧栏可分别调开 ───────────────────────────────────────────────────
{
  const { m } = await run({ overrides: { mascotGrabAtMs: 1000, mascotOpenAtMs: 1800 } });
  assert.ok(m.ropeFirstClip !== null && m.openClip !== null);
  assert.ok(m.ropeFirstClip < m.openClip, 'grabAt=1000 < openAt=1800 时绳子应先动、侧栏后开');
  assert.ok(Math.abs(m.ropeFirstClip - 1000) <= 80 && Math.abs(m.openClip - 1800) <= 80, '抓/开各自时刻吻合');
  console.log('PASS 抓绳时刻与侧栏触发分别消费：grab/open 可各调各的');
}

// ── 4) 参数敏感度矩阵（默认值动态派生）────────────────────────────────────────
{
  const base = (await run()).m;

  const down2 = (await run({ overrides: { mascotRopeDownPx: D.mascotRopeDownPx * 2 } })).m;
  assert.ok(Math.abs(down2.maxRope - 2 * base.maxRope) < 1.5, 'mascotRopeDownPx 翻倍 ⇒ 绳子最大位移翻倍');

  const drop2 = (await run({ overrides: { mascotDropPx: D.mascotDropPx * 2 } })).m;
  assert.ok(Math.abs(drop2.dropMaxY - base.dropMaxY - D.mascotDropPx) < 2, '绝对落点下 mascotDropPx 每 +dropPx ⇒ 落点 y 精确 +dropPx');

  const pullSlow = (await run({ overrides: { mascotRopePullMs: D.mascotRopePullMs + 400 } })).m;
  assert.ok(pullSlow.dropFirstClip > base.dropFirstClip + 200, 'mascotRopePullMs↑ ⇒ releaseAt=max(grab+pull) 后移、下落起点后移');

  const backSlow = (await run({ overrides: { mascotRopeBackMs: D.mascotRopeBackMs + 500 } })).m;
  assert.ok(backSlow.ropeZeroClip > base.ropeZeroClip + 200, 'mascotRopeBackMs↑ ⇒ 绳子归零更晚');

  const dropSlow = (await run({ overrides: { mascotDropMs: D.mascotDropMs * 2 } })).m;
  assert.ok(dropSlow.dropFirstClip >= base.dropFirstClip - 80, 'mascotDropMs 只影响时长，不改下落起点');
  assert.ok(Math.abs(dropSlow.dropMaxY - base.dropMaxY) < 2, 'mascotDropMs↑ 后绝对落点不变');

  const shortTumble = await run({ overrides: { mascotTumbleMs: 500 } });
  assert.equal(shortTumble.m.ropeFirstClip, null, 'mascotTumbleMs=500 时不应发生绳子下拉');
  // 截短后宠物最多停在绳子处（站位在顶部、下落到地面 610），不能"已经落到地面"。
  // 截短后宠物应停在**站位**（蓝本口径下站位在绳子下方，故以 standY 为界），
  // 绝不能已经落到地面 landing（≈610）。
  assert.ok(shortTumble.m.dropMaxY <= standY + 1, 'mascotTumbleMs 截短时不应发生下落（站位 y=' + standY.toFixed(1) + '，实际 ' + shortTumble.m.dropMaxY + '）');

  console.log('PASS 参数敏感度矩阵：ropeDownPx / dropPx(绝对) / ropePullMs / ropeBackMs / dropMs / tumbleMs 均按预期');
}

// ── 5) 缓动曲线对齐真蓝本：ease=0（匀速）与 ease=2（三次缓出）可区分 ──────────
{
  const h0 = (await run({ overrides: { mascotRopePullEase: 0 } })).h;
  const seq0 = pullSequence(h0.calls.rope);
  const h2 = (await run({ overrides: { mascotRopePullEase: 2 } })).h;
  const seq2 = pullSequence(h2.calls.rope);

  assert.ok(seq0.length > 4 && seq2.length > 4, '下拉序列样本太少：' + seq0.length + '/' + seq2.length);
  assert.notDeepEqual(seq0, seq2, 'ease=0 与 ease=2 的位置序列必须不同');

  const n = Math.min(seq0.length, seq2.length);
  let strictlyHigher = 0;
  for (let i = 0; i < n; i += 1) {
    assert.ok(seq2[i] >= seq0[i] - 0.4, '三次缓出位置不应低于匀速：idx=' + i);
    if (seq2[i] > seq0[i] + 0.5) strictlyHigher += 1;
  }
  assert.ok(strictlyHigher >= 2, '三次缓出必须至少两处严格高于匀速，实际 ' + strictlyHigher);
  console.log('PASS 缓动可区分（真蓝本曲线）：ease=0 匀速 与 ease=2 三次缓出 位置序列不同');
}

console.log('PASS M5 抓绳互动（真蓝本对照·T9）：手位锚点 / 绝对落点 / 抓绳·缓动·脱手 全套真消费');
