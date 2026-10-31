/**
 * pet-install 路由夹具（2026-11-01 重写）。
 *
 * 背景：自研下载器已整体拆除——它绕过 DSH 的依赖管理、与本地 link: 布局冲突，
 * 曾造成「插件列表两个同名条目 / 运行时误判未安装 / DSH 启动崩溃」。
 *
 * 现在这个夹具验的是**拆除结果**，而不是下载行为：
 *  1) 只保留 state 一条路由，返回安装态与版本（供卡片显示）；
 *  2) install / install-progress / uninstall 三条路由**必须不存在**；
 *  3) transaction.js / tar.js / run-pnpm.js 三个实现文件**必须已删除**；
 *  4) state 返回体带官方安装入口（installUrl / installCommand），供 UI 引导。
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const lib = (p) => new URL('packages/pet-link/lib/' + p, root);

// ── 1) 实现文件必须已删除 ──────────────────────────────────────────────
for (const gone of ['pet-install/transaction.js', 'pet-install/tar.js', 'pet-install/run-pnpm.js']) {
  assert.ok(!existsSync(lib(gone)), '下载器实现应已删除：' + gone);
}
console.log('PASS 下载器实现已删除：transaction.js / tar.js / run-pnpm.js');

// ── 2) 新模块在场 ────────────────────────────────────────────────────
assert.ok(existsSync(lib('pet-install/state-probe.js')), '应存在只读 state-probe.js');
const probeMod = await import(lib('pet-install/state-probe.js'));
assert.equal(typeof probeMod.createStateProbe, 'function', '应导出 createStateProbe');
console.log('PASS 只读 state-probe.js 在场且导出 createStateProbe');

// ── 3) 路由文件只剩 state ─────────────────────────────────────────────
const routeSrc = readFileSync(lib('routes/pet-install.js'), 'utf8');
const paths = [...routeSrc.matchAll(/path:\s*`\$\{BASE\}([^`]*)`/g)].map((m) => m[1]);
assert.deepEqual(paths, ['/pet-link/pet/state'], '路由应只剩 state，实际：' + paths.join(', '));

console.log('PASS 路由只剩 state（install / install-progress / uninstall 已移除）');

// ── 4) 路由文件不再引用下载器 ─────────────────────────────────────────
assert.ok(!/pet-install\/transaction|run-pnpm|createPetInstaller/.test(routeSrc), '路由不应再引用下载器');
console.log('PASS 路由不再引用下载器实现');

// ── 5) state 探测返回体：安装态 + 官方入口 ────────────────────────────
const probe = probeMod.createStateProbe({ profiledNodeModules: null, runtimeDir: null });
const st = probe.state();
for (const key of ['installed', 'version', 'name', 'path', 'runtimePresent', 'installUrl', 'installCommand']) {
  assert.ok(key in st, 'state() 应包含字段 ' + key);
}
assert.equal(typeof st.installed, 'boolean', 'installed 应为布尔');
assert.equal(st.installCommand, 'dsh plugin add dshpet-dshwe', '安装命令应为官方入口');
assert.equal(st.installUrl, 'https://www.npmjs.com/package/dshpet-dshwe', '官方地址应指向 npm');
console.log('PASS state() 返回安装态 + 官方安装入口（' + st.installCommand + '）');

// ── 6) 候选包名：新名优先、旧名兼容 ───────────────────────────────────
assert.deepEqual(probeMod.CANDIDATES, ['dshpet-dshwe', 'dsh-pet-dshwe'], '候选包名顺序应为新名优先');
console.log('PASS 候选包名：dshpet-dshwe 优先，dsh-pet-dshwe 兼容');

console.log('\nPASS 全部 6 段：拆除结果符合预期（只读状态 + 官方引导）');