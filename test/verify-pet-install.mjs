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
 *  4) state 返回体带官方安装入口（installUrl / installCommand），供 UI 引导；
 *  5) `index.js` 的**真实装配**把 profileDir 正确翻成 profiledNodeModules / runtimeDir
 *     （2026-11-02 修：此前键名对不上，detect() 恒判未安装）。
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

// ── 7) 真实装配：index.js 的 profileDir → profiledNodeModules / runtimeDir ──
// 这条是 2026-11-02 那个「装了宠物却永远显示未安装」bug 的钉子：
// 只测 createStateProbe 自身（第 5 段）抓不到调用方键名写错，必须走 applyImpl。
{
  const indexMod = await import(new URL('packages/pet-link/lib/index.js', root));
  const work = mkdtempSync(join(tmpdir(), 'pet-install-wiring-'));
  const home = join(work, 'home');
  const profileDir = join(home, '.dsh', 'profiles', 'desktop');
  const mkProfile = (withPet) => {
    const dir = join(profileDir, 'node_modules', 'dshpet-dshwe');
    if (withPet) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dshpet-dshwe', version: '9.9.9' }));
      mkdirSync(join(home, '.dsh', 'dsh-pet-dshwe'), { recursive: true });
      writeFileSync(join(home, '.dsh', 'dsh-pet-dshwe', 'logs.txt'), 'x');
    } else {
      rmSync(join(profileDir, 'node_modules'), { recursive: true, force: true });
      rmSync(join(home, '.dsh', 'dsh-pet-dshwe'), { recursive: true, force: true });
    }
  };
  /** 以真实 applyImpl 起一次组件装配，返回 GET state 的响应体。 */
  const stateViaApplyImpl = (petApiDshwe) => {
    const routes = [];
    const webServer = { port: 51231, register: (route) => { routes.push(route); return () => {}; } };
    const ctx = { webServer, get: (name) => (name === 'petApiDshwe' ? petApiDshwe : undefined) };
    const c = {
      base: '/wallpaper-engine',
      http: { sendJson: (res, status, value) => { res.statusCode = status; res.body = value; } },
      tolerantWebServer: (ws) => ws,
    };
    const dispose = indexMod.applyImpl(ctx, { profileDir }, c);
    try {
      const route = routes.find((r) => r.path === '/wallpaper-engine/pet-link/pet/state');
      assert.ok(route, 'applyImpl 应注册 state 路由，实际：' + routes.map((r) => r.path).join(', '));
      const res = {};
      route.handler({ method: 'GET', headers: {} }, res);
      assert.equal(res.statusCode, 200, 'state 应 200');
      return res.body;
    } finally {
      dispose();
    }
  };

  const savedHome = process.env.DSH_HOME;
  const savedProfile = process.env.DSH_PROFILE_DIR;
  const savedProfile2 = process.env.DSH_PROFILE;
  try {
    process.env.DSH_HOME = join(home, '.dsh');
    delete process.env.DSH_PROFILE_DIR;
    delete process.env.DSH_PROFILE;

    mkProfile(true);
    const installed = stateViaApplyImpl(null);
    assert.equal(installed.installed, true, 'index.js 装配后应认出已安装（此前恒 false）');
    assert.equal(installed.version, '9.9.9', '版本应来自 profile node_modules 下的 package.json');
    assert.equal(installed.runtimePresent, true, 'runtimePresent 应来自 <DSH_HOME>/dsh-pet-dshwe');
    assert.equal(installed.running, false, '页内没有 petApiDshwe 时应报 running=false');
    console.log('PASS 真实装配认得出已安装：' + installed.version + ' / runtimePresent=' + installed.runtimePresent);

    const running = stateViaApplyImpl({ link: { version: 4 } });
    assert.equal(running.running, true, '页内存在 petApiDshwe 时 running 应为 true');
    console.log('PASS 真实装配的 running 跟随页内服务');

    mkProfile(false);
    const missing = stateViaApplyImpl(null);
    assert.equal(missing.installed, false, 'profile 里没有宠物时应报未安装');
    assert.equal(missing.runtimePresent, false, '数据根不存在时 runtimePresent=false');
    console.log('PASS 真实装配认得出未安装');
  } finally {
    if (savedHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = savedHome;
    if (savedProfile === undefined) delete process.env.DSH_PROFILE_DIR; else process.env.DSH_PROFILE_DIR = savedProfile;
    if (savedProfile2 === undefined) delete process.env.DSH_PROFILE; else process.env.DSH_PROFILE = savedProfile2;
    rmSync(work, { recursive: true, force: true });
  }
}

console.log('\nPASS 全部 7 段：拆除结果符合预期（只读状态 + 官方引导 + 真实装配）');