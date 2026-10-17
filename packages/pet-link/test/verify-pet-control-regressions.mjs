#!/usr/bin/env node
/** 定点执行真实补丁片段与拉绳入口，不运行全套门禁。传入修复前客户端快照。 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as patcher from '../tools/patch-pet-client.mjs';

const fixture = process.argv[2];
if (!fixture) throw new Error('需要传入精调存档中的 pet-runtime/client.js');
const legacy = readFileSync(fixture, 'utf8');
const controlled = patcher.applyControlEdits ? patcher.applyControlEdits(legacy) : legacy;
const source = patcher.applyBubbleTimingEdits ? patcher.applyBubbleTimingEdits(controlled) : controlled;
const repo = new URL('../../../', import.meta.url);
const client = readFileSync(new URL('src/client.js', repo), 'utf8');
const pet = readFileSync(new URL('src/pet-link.js', repo), 'utf8');
const tuner = readFileSync(new URL('src/pet-link-tuner.js', repo), 'utf8');
function between(text, start, end) {
  const at = text.indexOf(start);
  const to = text.indexOf(end, at + start.length);
  assert.ok(at >= 0 && to > at, '必须取得真实源码片段：' + start);
  return text.slice(at, to);
}
function harness() {
  const slots = [];
  let cursor = 0;
  let mounted = false;
  let effects = [];
  let now = 100;
  let polls = 0;
  const window = {};
  const env = {
    window, Date: { now: () => now }, console: { log() {}, warn() {} },
    petAnims: { idle: ['idle'], events: { DSHWE: ['pull'] } },
    animRef: { current: 'pull' }, stopMove() {}, pick: rows => rows[0],
    statePoller: { now: () => polls++ },
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
    },
    useRef(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: initial };
      return slots[i];
    },
    useEffect(effect) { if (!mounted) effects.push(effect); },
    setSeqRaw() {},
  };
  const infra = between(source, '\t\tconst [anim, setAnimRaw]', '\t\tconst [facing,');
  const bubbles = between(source, '\t\tconst [bubbleOn,', '\t\tconst menuRef');
  const control = between(source, '\t\t// ── pet-link 补丁：页内控制面', '\t\tuseEffect(() => () => {');
  const ended = between(source, '\t\tconst handleEnded = (e) => {', '\t\t\tconst animations = petAnims;');
  const renderFn = new Function('env', `with (env) {
    let bubbleDurationMs = 10000;
    const bubbleDuration = () => bubbleDurationMs;
    ${infra}\n${bubbles}\n${control}
    ${ended}\nthrow new Error('进入了随机或工作状态回退'); };
    return { once, whisperBubbleOn, setOnce, show: () => setWhisperBubbleOn(true), handleEnded };
  }`);
  const render = () => {
    cursor = 0;
    effects = [];
    const result = renderFn(env);
    for (const effect of effects) effect();
    mounted = true;
    return result;
  };
  render();
  return { window, render, advance: ms => { now += ms; }, polls: () => polls };
}
let failures = 0;
async function check(name, run) {
  try { await run(); console.log('PASS ' + name); }
  catch (error) { failures++; console.error('FAIL ' + name + ': ' + error.message); }
}
await check('首次挂载控制面开放的气泡窗口在后续渲染仍生效', () => {
  const h = harness();
  h.window.__dshPetCtl.lock('pull');
  const current = h.render();
  h.window.__dshPetCtl.allowBubble(4000);
  current.show();
  assert.equal(h.render().whisperBubbleOn, true);
  h.advance(4001);
  h.window.__dshPetCtl.hideBubble();
  h.render().show();
  assert.equal(h.render().whisperBubbleOn, false, '窗口到期仍应拦截外来气泡');
});
await check('相同动作的锁续期不清掉我方气泡', () => {
  const h = harness();
  h.window.__dshPetCtl.lock('pull');
  h.window.__dshPetCtl.allowBubble(4000);
  h.render().show();
  h.window.__dshPetCtl.lock('pull');
  assert.equal(h.render().whisperBubbleOn, true);
});
await check('独占期间外来工作状态不能把当前后拉改成循环', () => {
  const h = harness();
  h.window.__dshPetCtl.lock('pull');
  h.render().setOnce(false);
  assert.equal(h.render().once, true);
});
await check('显式锁下播到末尾停帧，不进入工作状态回退', () => {
  const h = harness();
  h.window.__dshPetCtl.lock('pull');
  assert.doesNotThrow(() => h.render().handleEnded({ currentTarget: { classList: { contains: () => true } } }));
});
await check('控制面可以唤醒现有状态轮询，不绕过点播协议', () => {
  const h = harness();
  assert.equal(typeof h.window.__dshPetCtl.pollState, 'function');
  h.window.__dshPetCtl.pollState();
  assert.equal(h.polls(), 1);
});
function ropeHarness() {
  const calls = [];
  const refs = [];
  const env = {
    useWeLocale() {}, useStore: () => ({ ropeShown: true, ropeScale: 1 }),
    ropeArtOf: () => ({ w: 52, h: 57 }), clampNum: v => v,
    ROPE_SCALE_MIN: 0.5, ROPE_SCALE_MAX: 2, ROPE_VIEW_MARGIN: 8, ROPE_EDGE_INSET: 8,
    ROPE_PREVIEW_START: 50, ROPE_OPEN_THRESHOLD: 100, ROPE_POS_KEY: 'rope',
    readRopePos: () => ({ x: 100, y: 8 }), ropeClamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
    window: { innerWidth: 1600, innerHeight: 900 }, localStorage: { setItem() {} },
    wallSidebarToggle() {}, wallSidebarOpen() {}, wallSidebarClose() {},
    petLink: { performer: { onGrab: () => calls.push('grab'), onPull() {}, onRelease() {} }, mascot: { tap: () => calls.push('tap') } },
    React: { useState: value => [typeof value === 'function' ? value() : value, () => {}], useRef: initial => { const ref = { current: initial }; refs.push(ref); return ref; } },
  };
  const body = between(client, 'function RopeDock() {', '  const onRopeKeyDown');
  const api = new Function(...Object.keys(env), body + '\nreturn { onRopePointerDown, onRopePointerMove, finishDrag }; }\nreturn RopeDock();')(...Object.values(env));
  refs[0].current = { style: {}, offsetWidth: 52, offsetHeight: 57, setPointerCapture() {}, classList: { add() {}, remove() {} } };
  const down = { pointerType: 'mouse', button: 0, pointerId: 1, clientX: 100, clientY: 8, preventDefault() {} };
  return { api, calls, down };
}
await check('单击吉祥物不提前排入5167ms抓握准备', () => {
  const h = ropeHarness();
  h.api.onRopePointerDown(h.down);
  h.api.finishDrag(100, 8, false);
  assert.deepEqual(h.calls, ['tap']);
});
await check('只有实际拖动超过死区才触发一次抓握', () => {
  const h = ropeHarness();
  h.api.onRopePointerDown(h.down);
  assert.deepEqual(h.calls, []);
  h.api.onRopePointerMove({ ...h.down, clientX: 101 });
  assert.deepEqual(h.calls, []);
  h.api.onRopePointerMove({ ...h.down, clientX: 110 });
  h.api.onRopePointerMove({ ...h.down, clientX: 120 });
  assert.deepEqual(h.calls, ['grab']);
});
await check('广播成功后主动刷新轮询，失败时不刷新', async () => {
  let polls = 0;
  let accepted = true;
  const env = {
    window: { __dshPetCtl: { allowBubble() {}, pollState: () => polls++ } },
    location: { origin: 'http://test' }, apiFetch: async () => ({ ok: true, data: { ok: accepted } }),
  };
  const say = new Function(...Object.keys(env), tuner + '\n' + pet + '\nreturn petLinkSay;')(...Object.values(env));
  await say('text');
  assert.equal(polls, 1);
  await say('text', 'image');
  assert.equal(polls, 2);
  accepted = false;
  await say('text');
  assert.equal(polls, 2);
});
await check('只有显式保留时才允许我方气泡跨动作', () => {
  const h = harness(), ctl = h.window.__dshPetCtl;
  ctl.lock('pull'); ctl.allowBubble(4000); h.render().show();
  ctl.lock('idle', 60000, true);
  assert.equal(h.render().whisperBubbleOn, true);
  ctl.lock('pull');
  assert.equal(h.render().whisperBubbleOn, false, '默认切段仍清场');
});
await check('主动关闭同时收回放行窗口，迟到轮询不能再次弹出', () => {
  const h = harness(), ctl = h.window.__dshPetCtl;
  ctl.lock('pull'); ctl.allowBubble(4000); h.render().show();
  ctl.hideBubble(); h.render().show();
  assert.equal(h.render().whisperBubbleOn, false);
});
if (failures) process.exitCode = 1;
