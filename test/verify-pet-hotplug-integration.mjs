import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { clientEntryFixture } from './tools/official-performer.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { createSubpackageHost } from '../lib/subpackage-boot.js';
import { name, inject, apply } from '../packages/pet-link/lib/index.js';

const moduleUrl = process.env.PET_TEST_CORDIS_MODULE
  ? pathToFileURL(resolve(process.env.PET_TEST_CORDIS_MODULE)).href
  : import.meta.resolve('@deepseek-ai/cordis');
const { Context, Service } = await import(moduleUrl);
const entry = clientEntryFixture(readFileSync(new URL('../packages/pet-link/lib/client.pet-link.js', import.meta.url), 'utf8'));
assert.deepEqual(entry.plugin.inject, [], '可选官方服务不得阻塞客户端激活');
const page = new Context();
const client = page.plugin({ name: 'official-pet-client-regression', ...entry.plugin });
try {
  await client.await();
  assert.equal(await entry.bridge.warmup(), false, '运行时服务缺席时仍能激活并降级 native');
  // M5 起桥接探测的是自家 fork 的 petApiDshwe.link（不再认官方 petApi7340）。
  // 给完整 link 面（version=4 + 12 方法）且目标根节点可见 ⇒ linked 可用、warmup=true。
  const petRoot = {
    isConnected: true,
    getBoundingClientRect: () => ({ left: 10, top: 10, width: 180, height: 180, x: 100, y: 100 }),
    getAttribute: () => null,
  };
  page.provide('petApiDshwe', {
    getState: () => ({ pets: {} }),
    menuEvents: () => ({ ok: false }),
    pose: () => ({ x: 0.4, y: 0.6, facing: 'left' }),
    progress: () => null,
    link: {
      version: 4,
      getRoot: id => (id === 'main' ? petRoot : null),
      adoptPosition: () => true,
      pollState: () => true,
      getPlayback: () => ({ playbackId: null, anim: '', currentTime: 0, duration: 0, paused: true, buffering: false }),
      throwNative: () => 1,
      stopNativeThrow: () => true,
      getNativeThrow: () => ({ id: 1, active: false, cancelled: false, state: null }),
      allowBubble: () => true,
      hideBubble: () => true,
      setBubbleDuration: () => true,
      lock: () => true,
      unlock: () => true,
    },
  });
  assert.equal(await entry.bridge.warmup(), true, '真实同页上下文可读取后到的 petApiDshwe（linked 可用）');
  assert.equal(entry.listeners.size, 1, '客户端只安装一次监听');
} finally { await client.dispose(); }
assert.equal(entry.listeners.size, 0, '真实 Cordis 卸载归还客户端监听');
console.log('PASS 真实 Cordis 客户端：构建产物激活、官方服务缺席与晚到、卸载清理');
const routes = new Map();
class WebServer extends Service {
  constructor(ctx) { super(ctx, 'webServer'); }
  register(route) {
    assert.ok(!routes.has(route.path), '禁止重复注册 ' + route.path);
    routes.set(route.path, route);
    return () => { if (routes.get(route.path) === route) routes.delete(route.path); };
  }
}
const ctx = new Context();
const service = ctx.plugin(WebServer);
const plugin = { name, inject, apply };
const path = '/wallpaper-engine/pet-link/official';
let fiber;
async function get(handler = routes.get(path)?.handler, method = 'GET') {
  assert.ok(handler, '正式官方路由必须在场');
  let body;
  await handler({ method }, { setHeader() {}, end(value) { body = JSON.parse(value); } });
  return body;
}
async function until(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate() && Date.now() < deadline) await delay(10);
  if (fiber?.error) throw fiber.error;
  assert.ok(predicate(), '配置更新必须完成路由交接');
}
try {
  await service.await();
  ctx.provide('wallpaperEngineHost', createSubpackageHost());
  fiber = ctx.plugin(plugin, { linkEnabled: true });
  await fiber.await();
  // 宿主半路由数 = 3（官方控制 + 资源 prefix + 气泡配图）+ 4（/pet-link/pet/{state,install-progress,install,uninstall}）= 7。
  assert.equal(routes.size, 7);
  assert.equal((await get(undefined, 'PUT')).reason, 'method-not-allowed');
  const initial = routes.get(path).handler;
  fiber.update({ linkEnabled: false }, true);
  await until(() => routes.get(path)?.handler !== initial);
  assert.equal((await get()).reason, 'bridge-disabled');
  assert.equal((await get(initial)).reason, 'bridge-disabled', '旧处理器必须失效');
  const disabled = routes.get(path).handler;
  fiber.update({ linkEnabled: true }, true);
  await until(() => routes.get(path)?.handler !== disabled);
  assert.equal((await get(undefined, 'PUT')).reason, 'method-not-allowed');
  await fiber.dispose(); fiber = null;
  assert.equal(routes.size, 0);
  for (let i = 0; i < 10; i++) {
    fiber = ctx.plugin(plugin, { linkEnabled: false });
    await fiber.await();
    assert.equal(routes.size, 7);
    assert.equal((await get()).reason, 'bridge-disabled');
    await fiber.dispose(); fiber = null;
    assert.equal(routes.size, 0);
  }
  console.log('PASS 真实 Cordis：正式路由、配置更新、旧处理器失效、十次启停及零路由残留');
  console.log('此检查不安装或修改官方 pet，不代表官方渲染器的完整演出验收。');
} finally {
  if (fiber) await fiber.dispose();
  await service.dispose();
}
