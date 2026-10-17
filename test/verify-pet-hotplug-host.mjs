import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { registerPetLinkRoutes } from '../packages/pet-link/lib/routes/pet-link.js';

mkdirSync(resolve('.artifacts'), { recursive: true });
const home = mkdtempSync(resolve('.artifacts/hotplug-host-'));
process.env.DSH_HOME = home;
process.env.DSH_PROFILE_DIR = join(home, 'profiles/desktop');
const routes = new Map();
const server = { register(route) { routes.set(route.path, route); return () => { if (routes.get(route.path) === route) routes.delete(route.path); }; } };
const config = { linkEnabled: true };
function mount() {
  const disposers = [];
  registerPetLinkRoutes(server, { disposers, base: '/wall' }, { isLinkEnabled: () => config.linkEnabled !== false });
  return () => disposers.splice(0).reverse().forEach(fn => fn());
}
function get(handler = routes.get('/wall/pet-link/capability').handler, method = 'GET') {
  let body; const headers = {};
  const res = { setHeader(k, v) { headers[k.toLowerCase()] = v; }, end(v) { body = v; } };
  handler({ method }, res);
  return { status: res.statusCode, data: body ? JSON.parse(String(body)) : null, headers };
}
const unmount = mount();
const firstHandler = routes.get('/wall/pet-link/capability').handler;
const first = get();
assert.equal(first.headers['cache-control'], 'no-store');
assert.equal(first.data.protocol, 1);
assert.equal(first.data.enabled, true);
assert.equal(first.data.linkEnabled, true);
assert.equal(first.data.available, false);
assert.equal(first.data.ttlMs, 1500);
assert.equal(typeof first.data.generation, 'string');
config.linkEnabled = false;
assert.equal(get().data.linkEnabled, false);
config.linkEnabled = true;
assert.equal(get().data.linkEnabled, true);
const nextUnmount = mount();
const next = get();
assert.notEqual(first.data.generation, next.data.generation);
unmount();
assert.equal(routes.size, 1, '旧会话不能移除新路由');
assert.equal(get(firstHandler).data.enabled, false, '迟到的旧处理器必须撤销资格');
assert.equal(get(firstHandler).data.available, false);
assert.equal(get().data.generation, next.data.generation);
assert.equal(get(undefined, 'POST').status, 405);
nextUnmount();
assert.equal(routes.size, 0);
console.log('PASS 协议、短期资格、无缓存、独立联动开关、代际和迟到退出');

const data = join(home, 'dsh-pet');
mkdirSync(join(data, 'animation-ext'), { recursive: true });
writeFileSync(join(data, 'animation-ext/leash-bridge-ext.json'), JSON.stringify({ target: 'main', animations: { events: { DSHWE: ['通用-右侧螃蟹步-dshwe', '侧边栏-蓄力准备往后拉-dshwe', '侧边栏-后拉接疲态结束-dshwe'] } } }));
const stop = mount();
assert.equal(get().data.available, false, '仅有扩展文件不得认定已准备');
assert.ok(get().data.reason);
stop();
console.log('PASS 缺少完整安装凭据时拒绝接管');
