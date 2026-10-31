import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * M5 pet-link 浏览器半 · 联动夹具。
 *
 * 覆盖：
 *  1) linked provider 四条排播（侧栏拉动 / 抓绳 / 踢开弹飞 / 站立哈气）全跑通，且走 link.*；
 *  2) 彩蛋计数（第 3 次改走 egg1 / egg2）与返回原位；
 *  3) 未装 / 关闭 / 探测失败（含 runtime-too-old）三种情况均回落 native 且原因可读；
 *  4) sleep/wake 竞争：取锁后在睡 → 先唤醒、等醒来再下发点播（wake 早于首个 playAnim，锁释放后重取）；
 *  5) 无逐帧 HTTP：播放触发（HTTP）只每段一次，进度读取（页面内 getPlayback）逐帧远多于它。
 *
 * 直接读源码串起来求值（与 test/verify-pet-tuner.mjs 同口径），不依赖构建产物。
 */

const FILES = [
  'constants.js', 'mode.js', 'bubble.js',
  'linked-shared.js', 'linked-sidebar.js', 'linked-mascot.js', 'linked-egg1.js', 'linked-egg2.js',
  'linked.js', 'native.js', '../pet-link.js',
];
const source = FILES
  .map(file => readFileSync(new URL('../packages/pet-link/src/pet-link/' + file, import.meta.url), 'utf8'))
  .join('\n');
const load = new Function(source + ';return { createPetLink, detectPetLinkProvider, petLinkDecideLogic };')();

/** 假 DOM 元素：气泡与根节点都用它。 */
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

/**
 * 搭一套假运行时。
 * @param {{ installed?: boolean, enabled?: boolean, linkVersion?: number, sleeping?: boolean }} cfg
 */
function harness(cfg = {}) {
  const installed = cfg.installed !== false;
  const enabled = cfg.enabled !== false;
  const linkVersion = cfg.linkVersion ?? 4;
  let clock = 0;
  let serial = 0;
  const calls = { playAnim: [], adoptPosition: [], lock: 0, unlock: 0, throwNative: [], wake: 0, sidebar: [], rope: [] };
  /** 租约事件流：`[{ at, op:'lock'|'unlock' }]`。热锁时序用例据此断言各阶段持锁状态。 */
  const lockEvents = [];
  let getPlaybackReads = 0;
  let locked = false;
  let playback = null;
  let throwAt = -Infinity;
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
    adoptPosition(point) { calls.adoptPosition.push({ ...point, at: clock, locked }); petCenter.x = point.x; petCenter.y = point.y; return true; },
    pollState() { return true; },
    getPlayback() {
      getPlaybackReads += 1;
      if (sleepState.sleeping) return { playbackId: null, anim: 'sleep-end', currentTime: 0.5, duration: 1, paused: false, buffering: false };
      if (!playback) return { playbackId: null, anim: '', currentTime: 0, duration: 0, paused: true, buffering: false };
      const elapsed = Math.max(0, (clock - playback.at) / 1000);
      const currentTime = Math.min(playback.duration, elapsed);
      return { playbackId: playback.playbackId, anim: playback.anim, currentTime, duration: playback.duration, paused: currentTime >= playback.duration, buffering: false };
    },
    throwNative(point, velocity) { const id = ++serial; throwAt = clock; calls.throwNative.push({ point: { ...point }, velocity: { ...velocity }, id }); return id; },
    stopNativeThrow() { return true; },
    getNativeThrow(id) { const active = clock - throwAt < 300; return { id, active, cancelled: false, state: active ? { x: petCenter.x, y: petCenter.y, vx: -100, vy: -50 } : null }; },
    allowBubble() { return true; },
    hideBubble() { return true; },
    setBubbleDuration() { return true; },
    lock(name, ttl, preserveBubble, petId) { calls.lock += 1; locked = true; lockEvents.push({ at: clock, op: 'lock' }); return true; },
    unlock() { calls.unlock += 1; locked = false; lockEvents.push({ at: clock, op: 'unlock' }); return true; },
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

  const sidebar = Object.fromEntries(['open', 'close', 'beginPull', 'commit', 'rebound', 'toggle'].map(key =>
    [key, (...args) => { calls.sidebar.push({ method: key, args }); return true; }]));
  sidebar.edgeX = () => 700;
  // `openTimes`：等待阶段「侧栏还开着」的采样次数（每拍 100ms）。缺省 0 = 不等（旧行为）。
  // 用一个闭包计数器而不是看时钟：等待阶段是一段循环，按次数模拟用户「过一会儿才关侧栏」最直观。
  let openTimes = cfg.openTimes ?? 0;
  sidebar.isOpen = () => { if (openTimes > 0) { openTimes -= 1; return true; } return false; };

  const bubbleNodes = [];
  const document = {
    createElement: () => makeElement(),
    body: { appendChild(node) { bubbleNodes.push(node); } },
    querySelector: () => null,
  };

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
      // `locked`：下发动作那一刻是否持锁（热锁时序用例据此断言「动作执行段持锁」）。
      calls.playAnim.push({ petId, name, facing, locked });
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
  /** 某时刻是否持锁（按事件流回放，用于断言「等待阶段未持锁 / 回程持锁」）。 */
  const lockedAt = t => { let state = false; for (const e of lockEvents) { if (e.at <= t) state = e.op === 'lock'; } return state; };
  return { petLink, calls, bubbleNodes, root, api, getPlaybackReads: () => getPlaybackReads, isLocked: () => locked, clock: () => clock, lockEvents, lockedAt };
}

// ── 1) 四条逻辑跑通 ─────────────────────────────────────────────────────────
for (const logic of ['sidebar', 'mascot', 'egg1', 'egg2']) {
  const h = harness();
  assert.equal(h.petLink.mode(), 'linked', logic + '：可用时必须是 linked');
  const done = await h.petLink.tuner.run(logic);
  assert.equal(done.phase, 'done', logic + ' 必须跑完');
  assert.equal(done.busy, false);
  assert.equal(h.petLink.snapshot().busy, false);
  assert.ok(h.calls.playAnim.length > 0, logic + ' 必须下发动作');
  assert.ok(h.calls.playAnim.every(call => call.petId === 'main'), logic + ' 动作必须显式带目标 petId');
  if (logic !== 'egg2') assert.ok(h.calls.adoptPosition.length > 0, logic + ' 走位必须写 adoptPosition');
  else assert.equal(h.calls.adoptPosition.length, 0, 'egg2 原地不动，不写位置');
  assert.ok(h.calls.lock >= 1 && h.calls.unlock >= 1, logic + ' 必须上锁并在结尾解锁');
  assert.equal(h.isLocked(), false, logic + ' 结束必须归还租约');
  assert.ok(h.bubbleNodes.length > 0, logic + ' 必须自绘气泡');
}
console.log('PASS 四条排播：sidebar / mascot / egg1 / egg2 全部经 link.* 跑通');

// ── 2) 彩蛋计数与返回原位 ───────────────────────────────────────────────────
{
  const h = harness();
  await h.petLink.mascot.tap(); // 第 1 次：正常
  await h.petLink.mascot.tap(); // 第 2 次
  const third = await h.petLink.mascot.tap(); // 第 3 次：改走彩蛋
  assert.ok(['egg1', 'egg2'].includes(third.logic), '第 3 次必须改走彩蛋，实际 ' + third.logic);
  assert.equal(h.petLink.snapshot().farCount + h.petLink.snapshot().nearCount, 0, '触发彩蛋后计数归零');
}
// 踢开弹飞必须调 throwNative
{
  const h = harness();
  await h.petLink.tuner.run('egg1');
  assert.ok(h.calls.throwNative.length >= 1, 'egg1 必须走原生 throwNative');
  assert.ok(h.calls.throwNative[0].velocity.vx < 0 && h.calls.throwNative[0].velocity.vy < 0, '弹飞方向必须朝左上');
}
console.log('PASS 彩蛋计数与踢开弹飞（throwNative）');

// ── 3) 三种回落 native + 原因可读 ───────────────────────────────────────────
{
  const cases = [
    { name: '未装', cfg: { installed: false }, reason: 'runtime-not-installed' },
    { name: '关闭', cfg: { enabled: false }, reason: 'toggled-off' },
    { name: '探测失败-版本过旧', cfg: { linkVersion: 3 }, reason: 'runtime-too-old' },
  ];
  for (const item of cases) {
    const h = harness(item.cfg);
    assert.equal(h.petLink.mode(), 'native', item.name + ' 必须回落 native');
    assert.equal(h.petLink.reason(), item.reason, item.name + ' 原因必须可读：' + item.reason);
    const result = await h.petLink.mascot.tap();
    assert.equal(result.logic, 'disabled', item.name + ' 点击必须是 native 语义');
    assert.equal(result.fallback, true, item.name + ' 必须回落到主包吉祥物');
    assert.equal(h.calls.playAnim.length, 0, item.name + ' 不得下发任何动作');
  }
}
// 目标无效也算探测失败（能读原因）
{
  const h = harness();
  assert.equal(h.petLink.tuner.setTarget('missing'), true);
  assert.equal(h.petLink.mode(), 'native');
  assert.equal(h.petLink.reason(), 'unknown-pet');
}
console.log('PASS 未装 / 关闭 / 探测失败（含 runtime-too-old）均回落 native 且原因可读');

// ── 4) sleep/wake 竞争：先唤醒再下发点播 ────────────────────────────────────
{
  const h = harness({ sleeping: true });
  const done = await h.petLink.tuner.run('sidebar');
  assert.equal(done.phase, 'done', '睡着时也必须能跑通（先唤醒）');
  assert.equal(h.calls.wake, 1, '必须唤醒一次');
  assert.ok(h.calls.lock >= 2, '必须释放后重新取锁（页面租约会延迟 wake 叶子）');
  // wake 必须早于首个动作
  assert.ok(h.calls.playAnim.length > 0, '唤醒后仍要下发动作');
}
console.log('PASS sleep/wake：取锁后在睡 → 先唤醒、等醒来再下发点播');

// ── 5) 无逐帧 HTTP ─────────────────────────────────────────────────────────
{
  const h = harness();
  await h.petLink.tuner.run('sidebar');
  const http = h.calls.playAnim.length; // 播放触发 = HTTP 次数（每段一次）
  const reads = h.getPlaybackReads();
  assert.ok(http <= 6, '每逻辑的动作触发（HTTP）应有界，实际 ' + http);
  assert.ok(reads > http * 3, '进度读取（页面内 getPlayback）应逐帧远多于 HTTP，实际 reads=' + reads + ' http=' + http);
}
console.log('PASS 无逐帧 HTTP：播放触发每段一次，进度读取逐帧走页面内 getPlayback');

console.log('PASS M5 桌宠联动浏览器半：双 provider 状态机 + 四条排播复刻 + 回落与 sleep/wake + 无逐帧 HTTP');

// ── 6) 共享层行为夹具（T5）：followEdge 收尾对齐旧版 + ropeSegmentAt 夹紧分段 ─────
//   不是只让 coverage 绿：这里改参数 → 输出必须按预期变（到位位置 / 收尾时机 / 分段位移）。
{
  const sharedSrc = ['constants.js', 'linked-shared.js']
    .map(file => readFileSync(new URL('../packages/pet-link/src/pet-link/' + file, import.meta.url), 'utf8')).join('\n');
  const kitApi = new Function(sharedSrc + ';return { createLinkedKit, PETLINK_FOLLOW_MEASURE_MS };')();

  /** 造一个受控时钟 + 可注入 tuning 的 kit。 */
  function makeKit(tuning = {}) {
    let clock = 0;
    const state = { tuning: { sidebar: { ...tuning } }, logic: 'sidebar', sidebar: null, pool: null };
    const rt = {
      now: () => clock,
      wait: async ms => { clock += Math.max(0, ms); },
      viewport: () => ({ width: 1000, height: 800 }),
      getApi: () => null,
      getState: () => null,
      translate: v => v,
      rope: { point: () => null, moveRope() {}, restoreRope() {} },
      bubble: { show: () => ({}), hide() {}, dispose() {} },
      state,
    };
    return { kit: kitApi.createLinkedKit(rt), state, clock: () => clock };
  }

  /**
   * 造宠物：`root.getBoundingClientRect` 反映 adoptPosition 写入的中心，**并且反映 transform**。
   *
   * ⚠️ 这条"反映 transform"是承重的：真实浏览器里 `getBoundingClientRect()` **包含**
   * transform 的作用。假 DOM 若忽略它，实现里"叠了 translate 又把 rect 中心当基准"
   * 这种 bug 就永远测不出来 —— 真机表现为宠物原地反复抽搐，而夹具全绿。
   * 现在把 transform 折算进 rect（`真实中心 + 偏移`），这才和浏览器同语义。
   */
  function makeDet(startX, size = 180, y = 400) {
    let cx = startX;
    let cy = y;
    let tx = 0;
    let ty = 0;
    const writes = [];
    let transformWrites = 0;
    const samples = [];
    const root = {
      isConnected: true,
      style: {
        get transform() { return tx === 0 && ty === 0 ? '' : `translate(${tx}px,${ty}px)`; },
        set transform(value) {
          transformWrites += 1;
          const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(String(value || ''));
          tx = m ? Number(m[1]) : 0;
          ty = m ? Number(m[2]) : 0;
          // 记录"人眼看到的"位置：真实中心 + 叠加偏移。抽搐 = 这串序列出现回跳。
          samples.push(cx + tx);
        },
      },
      // 与浏览器同语义：量到的矩形 = 真实位置 + transform 偏移。
      getBoundingClientRect: () => ({ left: cx - size / 2 + tx, top: cy - size / 2 + ty, width: size, height: size }),
    };
    return {
      target: 'main',
      link: {
        getRoot: () => root,
        // ⚠️ 真实语义：`adoptPosition` 改的是 inset（left/top），**不会**清掉我们叠加的
        // transform。早先这里顺手把 tx/ty 归零，等于帮实现"擦掉"了偏移，
        // 于是 offset 修正写错也测不出来（反向验证时仍然绿）。现在保持 transform 不动。
        adoptPosition: point => { cx = point.x; cy = point.y; writes.push(point.x); return true; },
      },
      x: () => cx + tx,
      writes,
      samples,
      transformWrites: () => transformWrites,
      offset: () => ({ tx, ty }),
    };
  }

  // (a) 边在移动时不得收尾；停住后按「静止确认 + 到位」收尾，最终贴合「手右边缘=边缘」。
  {
    const h = makeKit({ followGraceMs: 0, followStillMs: 120, followStillEps: 0.5, followSpeed: 2000, handRightRatio: 0.5, edgeGapPx: 0 });
    const det = makeDet(500);
    const edgeOf = c => (c < 400 ? 700 - (300 * c) / 400 : 400);
    h.state.sidebar = { edgeX: () => edgeOf(h.clock()) };
    const ok = await h.kit.followEdge(det, () => true, 'sidebar', { openState: { opened: true, at: 0, ms: 0 }, maxMs: 5000 });
    assert.equal(ok, true, 'followEdge 必须收尾');
    assert.ok(h.clock() >= 400 + 120, '必须在边缘静止并累计 followStillMs 后才收尾，实际 ' + h.clock());
    assert.ok(Math.abs(det.x() - 400) <= 2, '最终中心必须贴合 400，实际 ' + det.x().toFixed(2));
    // 回滚后语义：逐帧 `adoptPosition` 推进（保守取舍，见实现注释）。
    // 曾试过 transform 插值消除卡顿，但与运行时定位叠加会产生抽搐且无法自证，已放弃。
    assert.ok(det.writes.length > 5, '必须逐帧写 adoptPosition，实际 ' + det.writes.length);
    assert.deepEqual(det.offset(), { tx: 0, ty: 0 }, '不得残留 transform 偏移');
  }

  // (b) openSettled 门（T1 漏、T5 补）：展开未结束前不得判静止收尾。
  {
    const h = makeKit({ followGraceMs: 0, followStillMs: 100, followStillEps: 0.5, followSpeed: 2000, handRightRatio: 0.5, edgeGapPx: 0 });
    const det = makeDet(600);
    h.state.sidebar = { edgeX: () => 600 };
    await h.kit.followEdge(det, () => true, 'sidebar', { openState: { opened: true, at: 0, ms: 600 }, maxMs: 5000 });
    assert.ok(h.clock() >= 600, 'openSettled 未满足前必须继续跟随（旧版 openSettled 门），实际 ' + h.clock());
  }

  // (c) followStillMs 真消费：静止确认越长收尾越晚。
  {
    const run = async stillMs => {
      const h = makeKit({ followGraceMs: 0, followStillMs: stillMs, followStillEps: 0.5, followSpeed: 2000, handRightRatio: 0.5, edgeGapPx: 0 });
      const det = makeDet(600);
      h.state.sidebar = { edgeX: () => 600 };
      await h.kit.followEdge(det, () => true, 'sidebar', { openState: { opened: true, at: 0, ms: 0 }, maxMs: 5000 });
      return h.clock();
    };
    const fast = await run(60);
    const slow = await run(300);
    assert.ok(slow > fast, 'followStillMs 变大 ⇒ 收尾更晚（fast=' + fast + ' slow=' + slow + '）');
  }

  // (d) edgeGapPx / handRightRatio 真消费：改变目标换算。
  {
    const settleX = async tuning => {
      const h = makeKit({ followGraceMs: 0, followStillMs: 40, followStillEps: 0.5, followSpeed: 3000, handRightRatio: 0.5, edgeGapPx: 0, ...tuning });
      const det = makeDet(600);
      h.state.sidebar = { edgeX: () => 600 };
      await h.kit.followEdge(det, () => true, 'sidebar', { openState: { opened: true, at: 0, ms: 0 }, maxMs: 5000 });
      return det.x();
    };
    const base = await settleX({});
    const gap = await settleX({ edgeGapPx: 40 });
    assert.ok(Math.abs((base - gap) - 40) <= 2, 'edgeGapPx +40 ⇒ 目标左移 40，实际差 ' + (base - gap).toFixed(2));
    const hand = await settleX({ handRightRatio: 0.6 });
    assert.ok(Math.abs((base - hand) - 18) <= 2, 'handRightRatio +0.1 ⇒ 目标左移 size×0.1=18，实际差 ' + (base - hand).toFixed(2));
  }

  // (e) ropeSegmentAt 夹紧分段：releaseAt = max(grab+pull, releaseAtMs)（旧版核心边界）。
  {
    const h = makeKit();
    const cfg = { grabAtMs: 2500, pullMs: 800, releaseAtMs: 2920, backMs: 260, downPx: 40 };
    assert.equal(h.kit.ropeTimeline(cfg).releaseAtMs, 3300, 'releaseAt 必须夹紧到 grab+pull=3300（旧版边界）');
    assert.equal(h.kit.ropeSegmentAt(2500, cfg), 0, '抓住前绳子在原位');
    assert.equal(h.kit.ropeSegmentAt(2900, cfg), 20, '下拉到一半 = down×0.5');
    assert.equal(h.kit.ropeSegmentAt(3000, cfg), 25, '夹紧后 3000 仍在下拉（而非按 2920 提前回弹）');
    assert.equal(h.kit.ropeSegmentAt(3300, cfg), 40, '夹紧点拉到底');
    assert.ok(h.kit.ropeSegmentAt(3400, cfg) < 40 && h.kit.ropeSegmentAt(3400, cfg) > 0, '夹紧点之后开始回弹');
    assert.equal(h.kit.ropeTimeline({ grabAtMs: 2500, pullMs: 800, releaseAtMs: 4000 }).releaseAtMs, 4000, 'releaseAtMs 晚于 grab+pull 时保留原值');
    assert.equal(h.kit.ropeSegmentAt(3300, { ...cfg, downPx: 100 }), 100, 'downPx 翻倍 ⇒ 位移翻倍');
    assert.equal(h.kit.ropeSegmentAt(2900, { ...cfg, pullEase: t => t * t }), 10, 'pullEase 改变 ⇒ 中途值变');
  }

  console.log('PASS T5 共享层行为夹具：followEdge 收尾（openSettled/静止/到位）对齐旧版 + ropeSegmentAt 夹紧分段');
}

// ── 7) 气泡时间节点（bubbleTiming）行为夹具：改 offsetMs → 出现时刻按锚点平移 ─────
//   证明面板「动作 + 起止锚点 + 毫秒偏移」是真消费，而非"能调不生效"。
{
  const sharedSrc = ['constants.js', 'linked-shared.js']
    .map(file => readFileSync(new URL('../packages/pet-link/src/pet-link/' + file, import.meta.url), 'utf8')).join('\n');
  const api = new Function(sharedSrc + ';return { createLinkedKit };')();

  /** 用一段可控 playback 跑 eggKick，返回气泡 show 相对段首的墙钟时刻。 */
  async function runBubbleShow(showRule, clipMs) {
    let clock = 0;
    const shows = [];
    const state = { tuning: { egg1: {} }, logic: 'egg1', sidebar: null, pool: null, bubbleTiming: { egg1Angry: { show: showRule } } };
    let playback = null;
    const rt = {
      now: () => clock,
      wait: async ms => { clock += Math.max(0, ms); },
      viewport: () => ({ width: 1000, height: 800 }),
      getApi: () => null, getState: () => null, translate: v => v,
      rope: { point: () => null, moveRope() {}, restoreRope() {} },
      bubble: { show: cfg => { shows.push({ at: clock, duration: cfg.duration }); return true; }, hide() {}, dispose() {} },
      state,
      playAnim: async (petId, name) => { playback = { name, at: clock, duration: clipMs / 1000 }; return true; },
    };
    const size = 180;
    const root = { isConnected: true, getBoundingClientRect: () => ({ left: 500 - size / 2, top: 400 - size / 2, width: size, height: size }) };
    const det = {
      target: 'main',
      link: {
        getRoot: () => root,
        adoptPosition: () => true,
        getPlayback: () => {
          if (!playback) return { anim: '', currentTime: 0, duration: 0 };
          const elapsed = Math.max(0, (clock - playback.at) / 1000);
          return { anim: playback.name, currentTime: Math.min(playback.duration, elapsed), duration: playback.duration, paused: elapsed >= playback.duration };
        },
      },
    };
    const kit = api.createLinkedKit(rt);
    const alive = () => true;
    kit.beginBubbles('egg1', det, alive);
    const segStart = clock;
    await kit.playSegment(det, 'eggKick', null, null, alive);
    kit.endBubbles();
    return { showAt: shows.length ? shows[0].at - segStart : null, count: shows.length };
  }

  const clipMs = 3000;
  const a = await runBubbleShow({ action: 'eggKick', edge: 'start', offsetMs: 500 }, clipMs);
  const b = await runBubbleShow({ action: 'eggKick', edge: 'start', offsetMs: 1500 }, clipMs);
  assert.equal(a.count, 1, '起点锚点：offsetMs=500 应弹一次');
  assert.equal(b.count, 1, '起点锚点：offsetMs=1500 应弹一次');
  assert.ok(a.showAt >= 500 && a.showAt <= 560, '起点锚点 offsetMs=500 ⇒ 约 500ms 出现，实际 ' + a.showAt);
  assert.ok(b.showAt >= 1500 && b.showAt <= 1560, '起点锚点 offsetMs=1500 ⇒ 约 1500ms 出现，实际 ' + b.showAt);
  assert.ok(Math.abs((b.showAt - a.showAt) - 1000) <= 64, '起点锚点：offset 增大 1000 ⇒ 出现推迟约 1000ms');

  const c = await runBubbleShow({ action: 'eggKick', edge: 'end', offsetMs: -500 }, clipMs);
  const d = await runBubbleShow({ action: 'eggKick', edge: 'end', offsetMs: -1500 }, clipMs);
  assert.equal(c.count, 1, '终点锚点：offsetMs=-500 应弹一次');
  assert.equal(d.count, 1, '终点锚点：offsetMs=-1500 应弹一次');
  assert.ok(Math.abs(c.showAt - (clipMs - 500)) <= 72, '终点锚点 offsetMs=-500 ⇒ 约 D-500 出现，实际 ' + c.showAt);
  assert.ok(Math.abs(d.showAt - (clipMs - 1500)) <= 72, '终点锚点 offsetMs=-1500 ⇒ 约 D-1500 出现，实际 ' + d.showAt);
  assert.ok(Math.abs((c.showAt - d.showAt) - 1000) <= 72, '终点锚点：offset 提前 1000 ⇒ 出现提前约 1000ms');

  console.log('PASS T12 气泡时间节点夹具：起点/终点锚点改 offsetMs → 出现时刻按预期平移（bubbleTiming 真消费）');
}

// ── 8) duration 隐藏规则夹具（T14）：按「已显示墙钟 + offset」真触发隐藏 ───────────
//   证明面板「按显示时长(duration)」不只是能存，而是运行中真的生效；改 offset → 隐藏时刻变。
{
  const sharedSrc = ['constants.js', 'linked-shared.js']
    .map(file => readFileSync(new URL('../packages/pet-link/src/pet-link/' + file, import.meta.url), 'utf8')).join('\n');
  const api = new Function(sharedSrc + ';return { createLinkedKit };')();

  async function runDurationHide(offsetMs) {
    let clock = 0;
    const events = [];
    let playback = null;
    const state = {
      tuning: { egg1: {} }, logic: 'egg1', sidebar: null, pool: null,
      bubbleTiming: {
        egg1Angry: {
          show: { action: 'default', edge: 'start', offsetMs: 0 },
          hide: { action: 'duration', edge: 'start', offsetMs },
        },
      },
    };
    const rt = {
      now: () => clock,
      wait: async ms => { clock += Math.max(0, ms); },
      viewport: () => ({ width: 1000, height: 800 }),
      getApi: () => null, getState: () => null, translate: v => v,
      rope: { point: () => null, moveRope() {}, restoreRope() {} },
      bubble: {
        show: () => { events.push({ kind: 'show', at: clock }); return true; },
        hide: () => { events.push({ kind: 'hide', at: clock }); },
        dispose() {},
      },
      state,
      playAnim: async (petId, name) => { playback = { name, at: clock, duration: 2 }; return true; },
    };
    const size = 180;
    const root = { isConnected: true, getBoundingClientRect: () => ({ left: 500 - size / 2, top: 400 - size / 2, width: size, height: size }) };
    const det = {
      target: 'main',
      link: {
        getRoot: () => root,
        adoptPosition: () => true,
        getPlayback: () => {
          if (!playback) return { anim: '', currentTime: 0, duration: 0 };
          const elapsed = Math.max(0, (clock - playback.at) / 1000);
          return { anim: playback.name, currentTime: Math.min(playback.duration, elapsed), duration: playback.duration, paused: elapsed >= playback.duration };
        },
      },
    };
    const kit = api.createLinkedKit(rt);
    const alive = () => true;
    kit.beginBubbles('egg1', det, alive);
    kit.showBubble('egg1Angry', det); // show 规则 default ⇒ 立即显示
    const shownAt = clock;
    await kit.playSegment(det, 'eggKick', null, 2000, alive);
    kit.endBubbles();
    const hide = events.find(e => e.kind === 'hide');
    return { shownAt, hideAt: hide ? hide.at : null, delta: hide ? hide.at - shownAt : null };
  }

  const h500 = await runDurationHide(500);
  const h1500 = await runDurationHide(1500);
  assert.ok(h500.delta !== null, 'duration 隐藏规则必须真的触发隐藏（不是只"能存"）');
  assert.ok(Math.abs(h500.delta - 500) <= 72, 'duration offset=500 ⇒ 显示后约 500ms 隐藏，实际 ' + h500.delta);
  assert.ok(Math.abs(h1500.delta - 1500) <= 72, 'duration offset=1500 ⇒ 显示后约 1500ms 隐藏，实际 ' + h1500.delta);
  assert.ok(Math.abs((h1500.delta - h500.delta) - 1000) <= 72, '改 duration offset ⇒ 隐藏时刻随之平移');
  console.log('PASS T14 duration 隐藏规则夹具：duration 节点按「已显示墙钟 + offset」真触发，改 offset → 隐藏时刻变');
}

// ── 9) 热锁时序（T2）：动作段持锁 → 等侧栏关闭放开 → 回程重锁 → 结束完全释放 ─────
//   用户明确要求分阶段持锁，不能「一锁到底」也不能「放开后又续回」。
//   借助 harness 的 lockEvents / lockedAt 事件流逐段断言；playAnim 记录 locked 证明动作段持锁。
{
  // (a) 有「等侧栏关闭」阶段的逻辑：sidebar / mascot。openTimes=3 ⇒ 等待循环至少跑 3 拍（约 300ms）。
  for (const logic of ['sidebar', 'mascot']) {
    const h = harness({ openTimes: 3 });
    const done = await h.petLink.tuner.run(logic);
    assert.equal(done.phase, 'done', logic + '：必须跑完');
    assert.equal(done.busy, false);

    // 动作执行段（走位/预备/后拉/彩蛋段等）：每次下发动作都必须处于持锁状态。
    assert.ok(h.calls.playAnim.length > 0, logic + '：必须下发动作');
    assert.ok(h.calls.playAnim.every(c => c.locked === true), logic + '：动作执行段每次 playAnim 都必须持锁');

    // 租约事件流必须是四段：lock（动作段）→ unlock（等关闭）→ lock（回程）→ unlock（结束）。
    // ⚠️ 逐段切换动画时会调 `allowOnly()` 续期并改写白名单（每次都是一次 `lock`），
    //    那些是**心跳/白名单更新**，不是状态转换 —— 连续相同事件先合并再断言。
    const ops = h.lockEvents.map(e => e.op).filter((op, i, arr) => i === 0 || op !== arr[i - 1]);
    assert.deepEqual(ops, ['lock', 'unlock', 'lock', 'unlock'], logic + '：租约事件流必须四段，实际 ' + JSON.stringify(ops));
    // 取**状态转换**那两个事件（解锁、重新上锁），而不是原始下标。
    const unlockIdx = h.lockEvents.findIndex(e => e.op === 'unlock');
    const unlockWaiting = h.lockEvents[unlockIdx];
    const relock = h.lockEvents.slice(unlockIdx + 1).find(e => e.op === 'lock');
    const finalUnlock = h.lockEvents.slice(h.lockEvents.indexOf(relock) + 1).find(e => e.op === 'unlock');
    assert.ok(unlockWaiting && relock && finalUnlock, logic + '：必须找到 unlock→lock→unlock 三处转换');

    // 等关闭阶段放开：等待期必须真实存在（不是零长度），且整段未持锁。
    const waitMs = relock.at - unlockWaiting.at;
    assert.ok(waitMs >= 200, logic + '：等侧栏关闭的等待期必须真实存在，实际 ' + waitMs + 'ms');
    assert.equal(h.lockedAt(unlockWaiting.at), false, logic + '：进入「等关闭」即放开锁');
    assert.equal(h.lockedAt(unlockWaiting.at + Math.floor(waitMs / 2)), false, logic + '：等关闭阶段中段未持锁');

    // 回程重锁：回程 re-lock 之后、结束释放之前必须持锁；回程写位也必须在持锁状态下。
    assert.equal(h.lockedAt(relock.at), true, logic + '：回程开始必须重新持锁');
    const returnWrites = h.calls.adoptPosition.filter(w => w.at >= relock.at && w.at <= finalUnlock.at);
    assert.ok(returnWrites.length > 0, logic + '：回程必须有位置写入');
    assert.ok(returnWrites.every(w => w.locked === true), logic + '：回程写位必须在持锁状态下');

    // 结束后已解锁：run 完全释放，不把锁留在外面。
    assert.equal(finalUnlock.op, 'unlock', logic + '：最后一步必须是解锁');
    assert.equal(h.lockedAt(finalUnlock.at), false, logic + '：结束后已解锁');
    assert.equal(h.isLocked(), false, logic + '：结束后必须完全释放租约');
  }

  // (b) 无等待段的逻辑（egg1 / egg2）：必须全程持锁到底再释放，中途不得放开。
  for (const logic of ['egg1', 'egg2']) {
    const h = harness();
    const done = await h.petLink.tuner.run(logic);
    assert.equal(done.phase, 'done', logic + '：必须跑完');
    // 同样先合并连续的 lock（`allowOnly` 每段都会续期一次，属心跳不是状态转换）。
    assert.deepEqual(h.lockEvents.map(e => e.op).filter((op, i, arr) => i === 0 || op !== arr[i - 1]), ['lock', 'unlock'], logic + '：无等待段必须全程持锁到底再释放');
    assert.ok(h.calls.playAnim.length > 0 && h.calls.playAnim.every(c => c.locked === true), logic + '：动作段必须持锁');
    assert.equal(h.isLocked(), false, logic + '：结束后必须完全释放租约');
  }

  console.log('PASS T2 热锁时序：动作段持锁 / 等关闭阶段未持锁 / 回程重新持锁 / 结束完全释放（无等待段全程持锁）');
}

// ── 10) surface 分流写位（t3）：web 走页面内 adoptPosition，desktop 改走 rt.positionDesktop ──
//   用户规则：main pet 同时启用 web+desktop 时只操控 web；只启用单端时操控那端。
//   PET 侧把规则解析进 link.surface；这里验证共享层的分流：desktop 那只不在本页 DOM 里，
//   adoptPosition 控不到，位置必须经装配层的 positionDesktop（→ HTTP POST /position?surface=desktop）。
{
  const sharedSrc = ['constants.js', 'linked-shared.js']
    .map(file => readFileSync(new URL('../packages/pet-link/src/pet-link/' + file, import.meta.url), 'utf8')).join('\n');
  const api = new Function(sharedSrc + ';return { createLinkedKit };')();

  /** 一次 kit 运行：记录 adoptPosition 与 positionDesktop 的全部调用。 */
  function makeKit(surface) {
    const adoptWrites = [];
    const desktopWrites = [];
    const root = { isConnected: true, getBoundingClientRect: () => ({ left: 410, top: 310, width: 180, height: 180 }) };
    const det = {
      target: 'main',
      link: {
        getRoot: () => root,
        adoptPosition: point => { adoptWrites.push({ ...point }); return true; },
        ...(surface !== undefined ? { surface } : {}),
      },
    };
    const rt = {
      now: () => 0,
      wait: async () => {},
      viewport: () => ({ width: 1000, height: 800 }),
      getApi: () => null,
      getState: () => null,
      translate: v => v,
      rope: { point: () => null, moveRope() {}, restoreRope() {} },
      bubble: { show: () => ({}), hide() {}, dispose() {} },
      state: { tuning: {}, logic: 'sidebar', sidebar: null, pool: null },
      positionDesktop: (petId, x, y) => { desktopWrites.push({ petId, x, y }); },
    };
    return { kit: api.createLinkedKit(rt), det, adoptWrites, desktopWrites };
  }

  // web/缺省：写位全走页面内 adoptPosition，绝不触发 positionDesktop。
  for (const surface of [undefined, 'web']) {
    const h = makeKit(surface);
    h.kit.writePosition(h.det, 500, 400);
    assert.equal(h.desktopWrites.length, 0, 'surface=' + surface + '：web 写位不得走 positionDesktop');
    assert.equal(h.adoptWrites.length, 1, 'surface=' + surface + '：web 写位必须走 adoptPosition');
    assert.deepEqual(h.adoptWrites[0], { x: 500, y: 400 });
  }

  // desktop：独立桌面窗口里的那只页面内控不到，写位必须整条改走 positionDesktop。
  {
    const h = makeKit('desktop');
    h.kit.writePosition(h.det, 500, 400);
    assert.equal(h.adoptWrites.length, 0, 'surface=desktop：不得写页面内 adoptPosition（那只不在本页 DOM）');
    assert.equal(h.desktopWrites.length, 1, 'surface=desktop：写位必须走 positionDesktop（HTTP /position?surface=desktop）');
    assert.deepEqual(h.desktopWrites[0], { petId: 'main', x: 500, y: 400 });
  }

  // 非法取值：与 petLinkSurface 同口径按 web 回落（mode.js 的 runtime-too-old 只拦"给了非法值"，
  // 探测层已判 native；这里防的是绕过探测直接调共享层的兜底路径）。
  {
    const h = makeKit('both');
    h.kit.writePosition(h.det, 500, 400);
    assert.equal(h.desktopWrites.length, 0, 'surface=both（非法，PET 侧已解析、不该出现）按 web 回落');
    assert.equal(h.adoptWrites.length, 1);
  }

  console.log('PASS t3 surface 分流写位：web→adoptPosition / desktop→positionDesktop / 非法回落 web');
}
