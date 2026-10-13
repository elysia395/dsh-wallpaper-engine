#!/usr/bin/env node
/**
 * compat-harness-live.mjs —— 真 harness 适配探活（**CI 专用，不进 `npm run verify` 链**）。
 *
 * 与 verify 链的分工：verify 链用 mock webServer 测插件自己的契约；本脚本把插件
 * **装进真实的 @deepseek-ai/dsh 并启动它**，断言宿主路由在真实 harness 里注册可达、
 * 插件树无加载失败 —— 这条集成面在 mock webServer 上测不出来（它要的是真 harness 的注册与加载链）。
 * 它需要网络（pnpm 装 profile）与已安装的 harness，因此只由 `.github/workflows/harness-compat.yml`
 * 调用；本地跑法见 docs/DEV-GUIDE.md。
 *
 * 隔离与第三方边界（两条都是硬约束）：
 *   · HOME / USERPROFILE 指向隔离目录 ⇒ 干净 profile（只装本插件），不碰机器上的真实
 *     `~/.dsh`、不与任何常驻实例争锁；`DSH_WE_DATA_DIR` 再把插件自己的数据目录钉死在同一处。
 *   · `DSH_WE_MEDIA_LEGACY=1` + 只探 diag 族路由 ⇒ 媒体桥 / ffmpeg 全程不被拉起
 *     （适配测试不覆盖第三方，媒体桥端到端由 verify.yml 的 verify:bridge 步承担）。
 *
 * 判据（全部可独立交叉验证）：
 *   ① harness 起来并给出 token URL（首页 200）；
 *   ② `GET /wallpaper-engine/diag?msg=<标记>` → 204，且落盘诊断里出现同一标记
 *      （handler 真的执行过，不只是一条网络应答）；
 *   ③ `GET /wallpaper-engine/diag-log` 回读出同一标记（内存环形缓冲也在位）；
 *   ④ profile 里登记了本插件、node_modules 里有入口；
 *   ⑤ harness 日志无 `plugin tree failed to load`，且探活后进程仍存活。
 *   ⑥ **通道自证**（`--channel tarball`）：装进去的入口是**真目录**（不是软链）⇒ 跑的是发布产物；
 *      且安装输出里**没有** `peer validation failed` / `does not resolve from the installation closure`。
 *
 * ── 两条安装通道（`--channel link|tarball`，默认 `link`）──────────────────────────
 *   · `link:`（默认，历史通道）：把**工作区**软链进 profile ⇒ 跑的是工作区里的文件。
 *   · `tarball`：先 `npm pack`，再把 **.tgz 装进去** ⇒ 跑的是**发布产物**。
 * **为什么必须有第二条**：`verify-package-publish` 只核发布面的**声明**（`files` / 可达闭包 /
 * `dependencies`），**从不真的装一遍**；于是"只有在真实安装器里才会暴露"的那一类全仓零断言 ——
 * 最典型的是 **`peerDependencies` 能否在安装闭包里解析**（软链**结构性地**看不见这一条：
 * 它不参与依赖解析）。一次用户回执实测过它的代价：
 *   `Packages: +1`（只装了插件自己）→ `generation … already exists, reusing` →
 *   `generation peer validation failed: @deepseek-ai/dsh-client-runtime does not resolve from
 *   the installation closure`。⇒ 本通道就是那条路径的判据。
 */
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CACHE = join(ROOT, '.test-cache', 'compat');
const ISO_HOME = join(CACHE, 'home');
const DATA_DIR = join(ISO_HOME, '.dsh-wallpaper-engine');
const LOG_FILE = join(CACHE, 'harness.log');
const PLUGIN = 'dsh-plugin-wallpaper-engine';
const BASE = '/wallpaper-engine';

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const PORT = Number(argOf('--port', process.env.DSH_WE_COMPAT_PORT || 5199));
const FRESH = argv.includes('--fresh');
/** 安装通道：`link` = 软链工作区（历史通道）· `tarball` = 装 `npm pack` 的产物（P4-17）。 */
const CHANNEL = argOf('--channel', process.env.DSH_WE_COMPAT_CHANNEL || 'link');
if (!['link', 'tarball'].includes(CHANNEL)) {
  console.error('未知的 --channel：' + CHANNEL + '（只认 link | tarball）');
  process.exit(2);
}

const childEnv = {
  ...process.env,
  HOME: ISO_HOME,
  USERPROFILE: ISO_HOME,
  DSH_WE_DATA_DIR: DATA_DIR,
  DSH_WE_UPLOAD_DIR: join(CACHE, 'upload'),
  DSH_WE_CACHE_DIR: join(CACHE, 'cache'),
  DSH_WE_STEAM_ROOT: join(CACHE, 'steam'),
  DSH_WE_MEDIA_LEGACY: '1',
};

const results = [];
function check(name, ok, detail) {
  results.push(Boolean(ok));
  console.log((ok ? '✓ ' : '✗ ') + name + (detail ? ' — ' + detail : ''));
  return Boolean(ok);
}
const tail = (s, n = 30) => String(s).split('\n').slice(-n).join('\n');

// win32：`dsh` 是 npm 的 .cmd 垫片，Node ≥18 在 shell:false 下拒绝启动它。
const spawnTool = (cmd, args, opts = {}) =>
  spawn(cmd, args, { ...opts, shell: process.platform === 'win32' });

/** 跑一条工具命令并等它结束（超时 / 起不来都收敛成 {code, out}，不让异常穿透）。 */
function runTool(cmd, args, { env, timeoutMs = 300000 } = {}) {
  return new Promise((resolveP) => {
    const child = spawnTool(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let settled = false;
    const done = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveP({ code, out });
    };
    const timer = setTimeout(() => { out += '\n[timeout]\n'; try { child.kill('SIGKILL'); } catch { /* 已退出 */ } done(124); }, timeoutMs);
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { out += b; });
    child.on('error', (e) => { out += String(e.stack || e); done(127); });
    child.on('exit', (code) => done(code ?? 1));
  });
}

function get(port, pathAndQuery, headers = {}) {
  return new Promise((resolveP) => {
    // 手写 node:http 而不是 fetch：状态码与错误要可区分（0 = 连不上），且要拿到 set-cookie。
    const req = httpRequest(
      { host: '127.0.0.1', port, path: pathAndQuery, method: 'GET', timeout: 5000, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolveP({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString('utf8'),
          setCookie: ([]).concat(res.headers['set-cookie'] || []).map((s) => String(s).split(';')[0]),
        }));
      },
    );
    req.on('error', (e) => resolveP({ status: 0, body: String(e.message), setCookie: [] }));
    req.on('timeout', () => { req.destroy(); resolveP({ status: 0, body: 'timeout', setCookie: [] }); });
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
async function waitUntil(fn, timeoutMs, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() >= deadline) return null;
    await sleep(intervalMs);
  }
}

async function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* 已退出 */ } }
  }
  await waitUntil(async () => child.exitCode !== null || child.signalCode !== null, 10000, 200);
  if (child.exitCode === null && child.signalCode === null && process.platform !== 'win32') {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* 已退出 */ }
  }
}

function startHarness() {
  const child = spawnTool('dsh', ['--profile', 'web', '--no-open', '--port', String(PORT)], {
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  let out = '';
  const sink = createWriteStream(LOG_FILE, { flags: 'w' });
  const onData = (b) => { out += b; sink.write(b); };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', (e) => { out += String(e.stack || e); });
  return { child, output: () => out };
}

function diagFileHasMarker(file, marker) {
  if (!existsSync(file)) return false;
  return readFileSync(file, 'utf8').split('\n').some((line) => {
    if (!line) return false;
    try {
      const o = JSON.parse(line);
      return o.kind === 'renderer' && String(o.msg || '').includes(marker);
    } catch { return false; }
  });
}

async function main() {
  if (FRESH) rmSync(ISO_HOME, { recursive: true, force: true });
  for (const d of [ISO_HOME, DATA_DIR, childEnv.DSH_WE_UPLOAD_DIR, childEnv.DSH_WE_CACHE_DIR, childEnv.DSH_WE_STEAM_ROOT, CACHE]) {
    mkdirSync(d, { recursive: true });
  }
  console.log('安装通道 = ' + CHANNEL + '（' + (CHANNEL === 'tarball' ? 'npm pack 的产物' : '工作区软链') + '）\n');

  // 隔离先于一切：这条不成立就绝不能继续（否则 dsh plugin add 会改到真实 ~/.dsh）。
  const iso = spawnSync(process.execPath, ['-e', 'process.stdout.write(require("node:os").homedir())'],
    { env: childEnv, encoding: 'utf8' });
  if (!check('隔离 HOME 对子进程生效（homedir 指向隔离目录）',
    iso.status === 0 && resolve(String(iso.stdout)) === resolve(ISO_HOME),
    iso.status === 0 ? String(iso.stdout) : '退出 ' + iso.status)) return;

  // ── 装插件：两条通道（见文件头"两条安装通道"）──────────────────────────────
  let spec = 'link:' + ROOT;
  if (CHANNEL === 'tarball') {
    // 打包到隔离缓存里（与工作区解耦；`npm pack` 会跑 `prepare`，但产物落在 packDir）。
    const packDir = join(CACHE, 'pack-tarball');
    rmSync(packDir, { recursive: true, force: true });
    mkdirSync(packDir, { recursive: true });
    const pack = await runTool('npm', ['pack', '--pack-destination', packDir],
      // npm 的 cache / logs 指到隔离目录里：受限环境（沙箱、或全局 cache 不可写）下 `npm pack`
      // 会因为**写不了日志目录**而失败 —— 那是环境问题，不该伪装成"打包失败"。
      { env: { ...childEnv, npm_config_cache: join(CACHE, 'npm-cache') } });
    const tgzs = existsSync(packDir) ? readdirSync(packDir).filter((f) => f.endsWith('.tgz')) : [];
    if (!check('npm pack 产出唯一 tarball（退出码 0）', pack.code === 0 && tgzs.length === 1,
      pack.code !== 0 ? '退出 ' + pack.code + '\n' + tail(pack.out) : 'tarball=' + tgzs.join(','))) return;
    const tgz = join(packDir, tgzs[0]);
    const bytes = (() => { try { return lstatSync(tgz).size; } catch { return 0; } })();
    if (!check('tarball 体积合理（> 200KB —— 内联产物在里面）', bytes > 200 * 1024, bytes + ' B')) return;
    spec = tgz;
    console.log('packed: ' + spec + ' (' + bytes + ' B)\n');
  }

  const add = await runTool('dsh', ['plugin', '--profile', 'web', 'add', spec], { env: childEnv });
  if (!check('dsh plugin add 装载本插件（退出码 0）', add.code === 0,
    add.code === 0 ? undefined : '退出 ' + add.code + '\n' + tail(add.out))) return;

  // ── ⑥ 通道自证 + peer 解析（P4-17 的判据本体）──────────────────────────────
  const profileNm = join(ISO_HOME, '.dsh', 'profiles', 'web', 'node_modules', PLUGIN);
  /**
   * 通道自证：装进去的那份 `package.json` 与工作区**是不是同一个文件**。
   * 用 `realpathSync` 比对而**不是** `lstatSync().isSymbolicLink()`：Windows 上 pnpm 的
   * `link:` 落成 **junction**，而 `isSymbolicLink()` 对 junction 的判定不可靠（各平台/实现不一）
   * —— 那样写会让**既有通道**在 CI 上假红。realpath 会把软链与 junction 都解析到目标，
   * 于是"同一份"与"各自的副本"是平台无关的两个答案。
   */
  const sameFile = (a, b) => {
    try { return resolve(realpathSync(a)) === resolve(realpathSync(b)); } catch { return null; }
  };
  const isSameAsWorkspace = sameFile(join(profileNm, 'package.json'), join(ROOT, 'package.json'));
  if (CHANNEL === 'tarball') {
    // 装了 tarball 却还是工作区那一份 ⇒ 通道没生效（或装的是别的），那下面几条判据就是空转。
    check('通道自证：装进去的是**独立副本**（不是工作区那一份）⇒ 跑的是发布产物',
      isSameAsWorkspace === false, 'sameAsWorkspace=' + isSameAsWorkspace + ' path=' + profileNm);
    // 用户回执实测过的那两串：命中即"装不上/装不全"，而不是"能跑"。
    const peerFail = /peer validation failed/i.test(add.out);
    const unresolved = /does not resolve from the installation closure/i.test(add.out);
    check('安装输出无 peer 校验失败（peerDependencies 能在安装闭包里解析）', !peerFail,
      peerFail ? tail(add.out) : undefined);
    check('安装输出无"不在安装闭包里"的未解析依赖', !unresolved,
      unresolved ? tail(add.out) : undefined);
  } else {
    // link 通道：入口应当**就是**工作区那一份（软链 / junction 都算）。
    check('通道自证：link 通道装的就是工作区那一份（realpath 相同）',
      isSameAsWorkspace === true, 'sameAsWorkspace=' + isSameAsWorkspace + ' path=' + profileNm);
  }

  const profilePkgPath = join(ISO_HOME, '.dsh', 'profiles', 'web', 'package.json');
  const profileText = existsSync(profilePkgPath) ? readFileSync(profilePkgPath, 'utf8') : '';
  let registered;
  try {
    const pkg = JSON.parse(profileText);
    const inDeps = Boolean(pkg.dependencies && PLUGIN in pkg.dependencies);
    const inBundles = JSON.stringify((pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) || []).includes(PLUGIN);
    registered = inDeps || inBundles;
  } catch { registered = false; }
  check('隔离 profile 里登记了本插件（deps / bundles）', registered, profilePkgPath);
  check('插件入口落在 profile 的 node_modules（通道=' + CHANNEL + '）', existsSync(profileNm), profileNm);

  const h = startHarness();
  const TOKEN_RE = /http:\/\/127\.0\.0\.1:(\d+)\/\?token=([^\s'"<>]+)/;
  const tokenHit = await waitUntil(async () => {
    if (h.child.exitCode !== null || h.child.signalCode !== null) return 'dead';
    const m = h.output().match(TOKEN_RE);
    return m ? m : null;
  }, 120000);
  if (tokenHit === 'dead' || !tokenHit) {
    check('harness 启动并输出 token URL', false,
      tokenHit === 'dead' ? '进程提前退出\n' + tail(h.output()) : '120s 未见 token URL\n' + tail(h.output()));
    await killTree(h.child);
    return;
  }
  const token = tokenHit[2];
  check('harness 启动并输出 token URL', true, 'port=' + tokenHit[1]);

  // dsh web 的鉴权形态：token URL 回 303 + Set-Cookie 换会话，随后**带 Cookie** 的 GET / 才是应用
  //（裸 GET / 是 401「authentication required」）。插件路由（diag 族）不走这层围栏，探活另测。
  const ready = await waitUntil(async () => {
    if (h.child.exitCode !== null || h.child.signalCode !== null) return 'dead';
    const auth = await get(PORT, '/?token=' + token);
    if (auth.status === 200) return { how: 'token URL 直接 200' };
    if (auth.status >= 300 && auth.status < 400 && auth.setCookie.length) {
      const app = await get(PORT, '/', { Cookie: auth.setCookie.join('; ') });
      if (app.status === 200) return { how: auth.status + ' + 会话 Cookie → 200' };
    }
    return null;
  }, 60000, 1000);
  check('harness 首页就绪（token → 会话 Cookie → GET / → 200）', Boolean(ready && ready !== 'dead'),
    ready === 'dead' ? '进程提前退出\n' + tail(h.output()) : ready ? ready.how : '60s 内未达 200');

  if (ready && ready !== 'dead') {
    const marker = `compat-${process.pid}-${Date.now()}`;
    const attempts = [];
    const probe = async (pathAndQuery) => {
      let r = await get(PORT, pathAndQuery);
      attempts.push(pathAndQuery.split('?')[0] + '@token=' + r.status);
      if (r.status !== 204) {
        // 围栏语义按 harness 版本可能不同：handler 自身不认 token，两条腿任一 204 都算注册可达。
        const noTok = new URL(pathAndQuery, 'http://127.0.0.1');
        noTok.searchParams.delete('token');
        r = await get(PORT, noTok.pathname + noTok.search);
        attempts.push(pathAndQuery.split('?')[0] + '@noToken=' + r.status);
      }
      return r.status;
    };
    const diagStatus = await probe(`${BASE}/diag?msg=${encodeURIComponent(marker)}&token=${token}`);
    check('插件宿主路由在真实 harness 里可达（/wallpaper-engine/diag → 204）', diagStatus === 204,
      attempts.join(' → '));

    const diagFile = join(DATA_DIR, 'diag', 'http.jsonl');
    check('落盘诊断出现同一标记（handler 真的执行过，不只是一条应答）',
      diagFileHasMarker(diagFile, marker), diagFile);

    let logStatus = await get(PORT, `${BASE}/diag-log?token=${token}`);
    if (logStatus.status !== 200) logStatus = await get(PORT, `${BASE}/diag-log`);
    let markerInRing;
    try {
      const entries = JSON.parse(logStatus.body).entries || [];
      markerInRing = entries.some((e) => String(e.msg || '').includes(marker));
    } catch { markerInRing = false; }
    check('内存环形缓冲可回读同一标记（/diag-log → 200 且含标记）',
      logStatus.status === 200 && markerInRing, 'status=' + logStatus.status);
  }

  const alive = h.child.exitCode === null && h.child.signalCode === null;
  check('探活期间 harness 进程未崩溃', alive, alive ? undefined : tail(h.output()));
  check('harness 日志无插件树加载失败',
    !/plugin tree failed to load/i.test(h.output()),
    /plugin tree failed to load/i.test(h.output()) ? tail(h.output()) : undefined);

  await killTree(h.child);
}

main().then(() => {
  const failed = results.filter((ok) => !ok).length;
  if (failed) console.log(`\nCOMPAT LIVE FAILED — ${failed}/${results.length} 条判据不成立`);
  else console.log(`\nCOMPAT LIVE PASSED — ${results.length} 条判据全部成立`);
  process.exitCode = failed ? 1 : 0;
}).catch((err) => {
  console.error('compat-harness-live 未捕获异常：', err);
  process.exitCode = 1;
});
