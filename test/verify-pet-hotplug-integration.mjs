import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { installBridge } from '../packages/pet-link/tools/install-bridge.mjs';

const root = mkdtempSync(resolve('.artifacts/hotplug-integration-'));
const home = join(root, 'home');
const profile = join(home, 'profiles/desktop');
const packageRoot = join(profile, 'node_modules/dsh-pet');
mkdirSync(join(packageRoot, 'lib'), { recursive: true });
const upstream = resolve(process.env.PET_TEST_UPSTREAM || '.artifacts/hotplug-upstream/package');
for (const path of ['package.json', 'lib/client.js', 'lib/index.js']) {
  writeFileSync(join(packageRoot, path), readFileSync(join(upstream, path)));
}
process.env.DSH_HOME = home;
process.env.DSH_PROFILE_DIR = profile;
const installed = installBridge({ dshHome: home, packageRoot });
assert.equal(installed.status, 'installed');
const { checkPetPrepared } = await import('../packages/pet-link/lib/prepared.js');
assert.equal(checkPetPrepared(home, profile).available, true, '宿主必须识别从原版准备的完整安装');
for (const path of [join(packageRoot, 'lib/client.js'), join(packageRoot, 'lib/index.js'),
  join(home, 'dsh-pet/main-animation/webm/通用-左侧螃蟹步-dshwe.webm'),
  join(home, 'dsh-pet/memes/吓哭了.png'), join(home, 'dsh-pet/animation-ext/leash-bridge-ext.json')]) {
  const before = readFileSync(path);
  writeFileSync(path, Buffer.concat([before, Buffer.from('\n changed')]));
  assert.equal(checkPetPrepared(home, profile).available, false, '已变化资源必须立即失效：' + path);
  writeFileSync(path, before);
  assert.equal(checkPetPrepared(home, profile).available, true);
}
assert.equal(checkPetPrepared(home, join(home, 'profiles/other')).available, false, '不能借其他 profile 的安装取得资格');
console.log('PASS 官方原版完整安装与宿主资格打通，代码/视频/配图/扩展变化及错误 profile 均撤销资格');

let cordisUrl;
if (process.env.PET_TEST_CORDIS_MODULE) cordisUrl = pathToFileURL(resolve(process.env.PET_TEST_CORDIS_MODULE)).href;
else { try { cordisUrl = import.meta.resolve('@deepseek-ai/cordis'); } catch { throw new Error('真实 Cordis 必须可用，或设置 PET_TEST_CORDIS_MODULE；本验收不跳过'); } }
const { Context, Service } = await import(cordisUrl);
const routes = new Map();
class WebServer extends Service {
  constructor(ctx) { super(ctx, 'webServer'); }
  register(route) {
    assert.ok(!routes.has(route.path), '禁止重复注册 ' + route.path);
    routes.set(route.path, route);
    return () => { if (routes.get(route.path) === route) routes.delete(route.path); };
  }
}
const { name, inject, apply } = await import('../packages/pet-link/lib/index.js');
const plugin = { name, inject, apply };
const ctx = new Context();
const service = ctx.plugin(WebServer);
let fiber;
const path = '/wallpaper-engine/pet-link/capability';
function get(handler = routes.get(path)?.handler) {
  if (!handler) return null;
  let body; const headers = {};
  const res = { setHeader(k, v) { headers[k.toLowerCase()] = v; }, end(value) { body = value; } };
  handler({ method: 'GET' }, res);
  assert.equal(headers['cache-control'], 'no-store');
  assert.equal(res.statusCode, 200);
  return JSON.parse(String(body));
}
async function until(predicate, label) {
  const end = Date.now() + 3000;
  while (!predicate() && Date.now() < end) await delay(10);
  assert.ok(predicate(), label);
  if (fiber?.error) throw fiber.error;
}
try {
  await service.await();
  const { createSubpackageHost } = await import('../lib/subpackage-boot.js');
  ctx.provide('wallpaperEngineHost', createSubpackageHost());
  fiber = ctx.plugin(plugin, { linkEnabled: true });
  await fiber.await();
  await until(() => get()?.available, '真实 Cordis 必须成功挂载能力路由');
  const initial = get();
  const oldHandler = routes.get(path).handler;
  fiber.update({ linkEnabled: false }, true);
  await until(() => get()?.linkEnabled === false, '配置更新无页面刷新即可关闭联动');
  assert.equal(get().available, false);
  assert.notEqual(get().generation, initial.generation);
  assert.equal(get(oldHandler).enabled, false);
  fiber.update({ linkEnabled: true }, true);
  await until(() => get()?.available === true, '配置更新无进程重启即可恢复联动');
  console.log('PASS 真实 Cordis 配置 update 关闭/恢复联动、旧处理器失效且每次会话独立');
  await fiber.dispose(); fiber = null;
  assert.equal(routes.size, 0);
  for (let i = 0; i < 10; i++) {
    fiber = ctx.plugin(plugin, { linkEnabled: true }); await fiber.await();
    await until(() => get()?.available, '第 ' + i + ' 次重挂恢复');
    assert.equal(routes.size, 1);
    await fiber.dispose(); fiber = null; assert.equal(routes.size, 0);
  }
  console.log('PASS 真实 Cordis 连续十次启停，路由无重复和泄漏，未重启 DSH 或页面');
} finally {
  if (fiber) await fiber.dispose();
  await service.dispose();
}
const artifact = { home, profile, packageRoot, upstream, backup: installed.backup };
writeFileSync(resolve('.artifacts/hotplug-prepared.json'), JSON.stringify(artifact, null, 2) + '\n');
assert.ok(existsSync(join(home, 'dsh-pet/pet-link-install.json')));
console.log(JSON.stringify(artifact));
