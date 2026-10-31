import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { apply } from '../packages/pet-link/lib/index.js';
import { createSubpackageHost } from '../lib/subpackage-boot.js';
const root = new URL('../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('packages/pet-link/package.json', root), 'utf8'));
assert.equal(pkg.name, 'dsh-plugin-wallpaper-engine-pet-link');
assert.ok(!Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies }).includes('dsh-pet'));
assert.equal(pkg.exports['./install'], undefined, '不再发布改写官方文件的安装入口');
assert.equal(existsSync(new URL('packages/pet/package.json', root)), false, '不携带内置副本');
for (const path of ['lib/index.js', 'lib/routes/official-pet.js', 'lib/official-provider.js',
  'lib/prepared.js', 'src/official-pet.js', 'src/pet-link.js', 'src/pet-link-tuner.js']) {
  assert.ok(existsSync(new URL('packages/pet-link/' + path, root)), path);
}
const routes = new Map(); let cleanup;
const off = apply({ wallpaperEngineHost: createSubpackageHost(),
  webServer: { port: 49123, register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } },
  effect(fn) { cleanup = fn(); } }, { linkEnabled: false });
try {
  // 2026-11-01：install / install-progress / uninstall 三条路由已随自研下载器一起移除；
// 新增引导图 exact 路由（`/official/guide-step?n=`）供卡片的图文安装说明使用。
// 现有 5 条：official 控制面 + assets prefix + meme + guide-step + pet/state。
  for (const path of ['/wallpaper-engine/pet-link/official', '/wallpaper-engine/pet-link/official/assets/',
    '/wallpaper-engine/pet-link/official/meme',
    '/wallpaper-engine/pet-link/official/guide-step',
    '/wallpaper-engine/pet-link/pet/state']) {
    assert.ok(routes.has(path), '缺少路由 ' + path);
  }
  // 反向断言：下载器路由必须不存在（防止有人把它们加回来）
  for (const gone of ['/wallpaper-engine/pet-link/pet/install', '/wallpaper-engine/pet-link/pet/install-progress',
    '/wallpaper-engine/pet-link/pet/uninstall']) {
    assert.ok(!routes.has(gone), '下载器路由应已移除：' + gone);
  }
  assert.equal(routes.size, 5);
  let body;
  await routes.get('/wallpaper-engine/pet-link/official').handler({ method: 'GET' }, {
    setHeader() {}, end(value) { body = JSON.parse(value); },
  });
  assert.deepEqual(body, { ok: false, reason: 'bridge-disabled' });
  // 引导图路由：三张图真能出（HEAD + Content-Length + image/png），越界 404。
  // 这是卡片「如何下载安装联动桌宠」面板的图片来源，破图会让教程不可用。
  {
    const guidePath = '/wallpaper-engine/pet-link/official/guide-step';
    const route = routes.get(guidePath);
    assert.ok(route, 'guide-step 路由应已注册');
    for (const n of [1, 2, 3]) {
      let status = 0; let len = -1; let type = '';
      const res = {
        setHeader(k, v) { const key = String(k).toLowerCase(); if (key === 'content-length') len = Number(v); if (key === 'content-type') type = String(v); },
        end() {}, on() {}, destroy() {},
        set statusCode(v) { status = v; }, get statusCode() { return status; },
      };
      route.handler({ method: 'HEAD', url: guidePath + '?n=' + n }, res);
      assert.equal(status, 200, 'step' + n + ' 应 200，实际 ' + status);
      assert.ok(len > 0, 'step' + n + ' Content-Length 应为正，实际 ' + len);
      assert.equal(type, 'image/png', 'step' + n + ' 应为 image/png，实际 ' + type);
    }
    for (const bad of ['0', '4', 'abc']) {
      let status = 0;
      const res = { setHeader() {}, end() {}, on() {}, destroy() {}, set statusCode(v) { status = v; }, get statusCode() { return status; } };
      route.handler({ method: 'HEAD', url: guidePath + '?n=' + bad }, res);
      assert.equal(status, 404, 'n=' + bad + ' 应 404，实际 ' + status);
    }
    console.log('PASS guide-step 三张图可出图（200 + image/png + 正长度），越界参数 404');
  }
} finally { off(); cleanup(); }
assert.equal(routes.size, 0);
const side = readFileSync(new URL('src/sidebar-right.js', root), 'utf8');
const sideEnd = side.indexOf('// 定时器一律走 window.');
const calls = [];
const native = new Function('drawer', side.slice(0, sideEnd) + ';ropeDrawerControl=drawer;return [wallSidebarOpen(),wallSidebarClose(),wallSidebarToggle()];')({
  open() { calls.push('open'); }, close() { calls.push('close'); }, toggle() { calls.push('toggle'); },
});
assert.deepEqual(native, [true, true, true]);
assert.deepEqual(calls, ['open', 'close', 'toggle']);
console.log('PASS 外置官方 pet：无硬依赖、无私有安装入口、禁用无请求、壁纸回退与卸载');
