import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * pet-link 可选依赖口径夹具（t14）。
 *
 * 关键约束（计划 §3.3）：pet-link 必须在**没装 dsh-pet-dshwe** 时也能正常加载。
 * 本机 DSH（dsh-desktop-next 2.0.20-next，@deepseek-ai/cordis@4.0.5）的 inject 没有
 * required/optional 之分（凡写进 inject 都是必需依赖），可选访问靠 ctx.get：
 * "Read a service from the store without the inject requirement"（cordis/src/reflect.ts）。
 *
 * 覆盖：
 *  1) 宿主半 inject 不含 petApiDshwe（否则无运行时即不激活）；
 *  2) probeOptionalService 语义：无 ctx / 无 get / 返回 undefined / 抛异常 → null，命中 → 服务实例；
 *  3) 无 petApiDshwe 时宿主半 applyImpl 装载成功并可 dispose；有服务时同样装载成功；
 *  4) 浏览器半：无服务 → petLinkMode()==='native' 且 reason 可读；有服务 → 'linked'（探测命中）。
 */

let passed = 0;
function ok(message) { passed++; console.log('PASS ' + message); }

const { inject, probeOptionalService, applyImpl } = await import('../packages/pet-link/lib/index.js');

// ── 1) inject 面 ────────────────────────────────────────────────────────────
assert.deepEqual([...inject], ['webServer', 'wallpaperEngineHost'], 'inject 面被意外改动');
assert.ok(!inject.includes('petApiDshwe'), 'petApiDshwe 绝不能进必需 inject（会让无运行时下不激活）');
ok('宿主半 inject 不含 petApiDshwe（无运行时也能激活）');

// ── 2) probeOptionalService 语义 ────────────────────────────────────────────
assert.equal(probeOptionalService(undefined, 'petApiDshwe'), null);
assert.equal(probeOptionalService({}, 'petApiDshwe'), null);
assert.equal(probeOptionalService({ get: () => undefined }, 'petApiDshwe'), null);
const api = { link: {} };
assert.equal(probeOptionalService({ get: n => (n === 'petApiDshwe' ? api : undefined) }, 'petApiDshwe'), api);
assert.equal(probeOptionalService({ get: () => { throw new Error('boom'); } }, 'petApiDshwe'), null);
ok('probeOptionalService：无 ctx / 无 get / undefined / 异常 → null，命中 → 服务实例');

// ── 3) 宿主半装载（无 / 有服务都不抛）──────────────────────────────────────
function fakeWebServer() {
  const routes = [];
  return { port: 1234, routes, register(spec) { routes.push(spec); return () => {}; } };
}
const fakeHttp = { sendJson() {} };

{
  const ctx = { webServer: fakeWebServer(), get: () => undefined };
  let dispose;
  assert.doesNotThrow(() => {
    dispose = applyImpl(ctx, { profileDir: 'C:/__no_such_profile_t14__' }, { base: '', http: fakeHttp });
  }, '无 petApiDshwe 时 applyImpl 不该抛');
  assert.equal(typeof dispose, 'function');
  dispose();
  ok('无 petApiDshwe 时宿主半 applyImpl 装载成功并可 dispose');
}
{
  const ctx = { webServer: fakeWebServer(), get: n => (n === 'petApiDshwe' ? { link: {} } : undefined) };
  let dispose;
  assert.doesNotThrow(() => {
    dispose = applyImpl(ctx, { profileDir: 'C:/__no_such_profile_t14__' }, { base: '', http: fakeHttp });
  }, '有 petApiDshwe 时 applyImpl 不该抛');
  dispose();
  ok('有 petApiDshwe 时宿主半同样装载成功（探测命中不影响装配）');
}

// ── 4) 浏览器半：native 回落 / linked 命中 ──────────────────────────────────
const FILES = ['constants.js', 'mode.js', 'bubble.js',
  'linked-shared.js', 'linked-sidebar.js', 'linked-mascot.js', 'linked-egg1.js', 'linked-egg2.js',
  'linked.js', 'native.js', '../pet-link.js'];
const source = FILES
  .map(file => readFileSync(new URL('../packages/pet-link/src/pet-link/' + file, import.meta.url), 'utf8'))
  .join('\n');
const { createPetLink } = new Function(source + ';return { createPetLink };')();

function makeElement() {
  return {
    style: {}, children: [],
    setAttribute() {}, getAttribute() {}, appendChild(node) { this.children.push(node); }, remove() {},
    querySelector() { return null; }, getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 40 }; },
  };
}
/** 一个能力齐全的假 link 控制面（version 4）。 */
function fakeLink(visible) {
  return {
    version: 4, target: 'main',
    getRoot: () => (visible ? { isConnected: true, getBoundingClientRect: () => ({ width: 180, height: 180 }) } : null),
    adoptPosition: () => true,
    pollState: () => true,
    getPlayback: () => ({ playbackId: null, anim: '', currentTime: 0, duration: 0, paused: true, buffering: false }),
    throwNative: () => 1,
    stopNativeThrow: () => true,
    getNativeThrow: id => ({ id, active: false, cancelled: false, state: null }),
    allowBubble: () => true,
    hideBubble: () => true,
    setBubbleDuration: () => true,
    lock: () => true,
    unlock: () => true,
    isLocked: () => false,
  };
}
function build(getApi) {
  const document = { createElement: () => makeElement(), body: { appendChild() {} }, querySelector: () => null };
  return createPetLink({
    getApi,
    translate: value => value,
    viewport: () => ({ width: 1000, height: 800 }),
    document,
    storage: null,
    now: () => 0,
    wait: async () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    bubbleUrl: index => '/m' + index + '.png',
  });
}
{
  const petLink = build(() => null);
  assert.equal(petLink.mode(), 'native', '无服务必须回落 native');
  assert.equal(petLink.reason(), 'runtime-not-installed', '原因必须可读');
  ok('浏览器半：无 petApiDshwe → native（reason=runtime-not-installed）');
}
{
  const petLink = build(() => ({ link: fakeLink(true) }));
  assert.equal(petLink.mode(), 'linked', '有服务必须探测命中');
  assert.equal(petLink.reason(), '', 'linked 可用时原因为空串');
  ok('浏览器半：有 petApiDshwe.link → linked（探测命中）');
}

console.log('PASS pet-link 可选探测：无运行时装载 + native 回落（原因可读） / 有服务探测命中（共 ' + passed + ' 段）');
