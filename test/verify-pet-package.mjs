import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = new URL('../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('packages/pet-link/package.json', root), 'utf8'));
assert.equal(pkg.name, 'dsh-plugin-wallpaper-engine-pet-link');
assert.ok(!Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies }).includes('dsh-pet'));
for (const path of ['lib/index.js', 'lib/routes/pet-link.js', 'lib/prepared.js', 'tools/install-bridge.mjs', 'tools/patch-data/dsh-pet-0.3.6-index.txt', 'tools/patch-data/LICENSE.dsh-pet', 'src/pet-link.js', 'src/pet-link-tuner.js']) {
  assert.ok(existsSync(new URL('packages/pet-link/' + path, root)), path);
}
const mod = await import('../packages/pet-link/lib/index.js');
assert.deepEqual(mod.inject, ['webServer', 'wallpaperEngineHost']);
const routes = new Map(); let cleanup;
const { createSubpackageHost } = await import('../lib/subpackage-boot.js');
const off = mod.apply({ wallpaperEngineHost: createSubpackageHost(), webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } }, effect(fn) { cleanup = fn(); } }, { linkEnabled: false });
assert.equal(routes.size, 1);
let body;
routes.values().next().value.handler({ method: 'GET' }, { setHeader() {}, end(value) { body = JSON.parse(value); } });
assert.equal(body.available, false);
assert.equal(body.linkEnabled, false);
off(); cleanup(); assert.equal(routes.size, 0);
const side = readFileSync(new URL('src/sidebar-right.js', root), 'utf8');
const sideEnd = side.indexOf('// 定时器一律走 window.');
const drawerCalls = [];
const native = new Function('drawer', side.slice(0, sideEnd) + ';ropeDrawerControl=drawer;return [wallSidebarOpen(),wallSidebarClose(),wallSidebarToggle()];')({
  open() { drawerCalls.push('open'); }, close() { drawerCalls.push('close'); }, toggle() { drawerCalls.push('toggle'); },
});
assert.deepEqual(native, [true, true, true], '无桌宠时必须保留上游抽屉回退');
assert.deepEqual(drawerCalls, ['open', 'close', 'toggle']);
console.log('PASS 完整子包可独立加载、无dsh-pet硬依赖、禁用回退及幂等卸载');

const cache = new URL('.test-cache/', root);
mkdirSync(cache, { recursive: true });
const cleanCwd = mkdtempSync(fileURLToPath(new URL('pet-clean-', cache)));
assert.equal(existsSync(join(cleanCwd, '.artifacts')), false, '新目录不得预建产物目录');
const hostTest = spawnSync(process.execPath, [fileURLToPath(new URL('test/verify-pet-hotplug-host.mjs', root))], {
  cwd: cleanCwd, stdio: 'inherit',
});
assert.ifError(hostTest.error);
assert.equal(hostTest.status, 0, '热插拔宿主测试必须在无产物目录的干净环境独立通过');
console.log('PASS 干净工作目录无需预存.artifacts即可运行宿主测试');
