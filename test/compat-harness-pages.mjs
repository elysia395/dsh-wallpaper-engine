#!/usr/bin/env node
/**
 * compat-harness-pages.mjs —— 档位 2：无头浏览器**逐页 DOM / 样式断言**（compat 层，
 * 不进 `npm run verify` 链；由 `.github/workflows/harness-compat.yml` 在真 harness 上调用）。
 *
 * 与档位 1（compat-harness-surfaces：包级清单棘轮）的分工：包名没变、**包内结构变了**
 * 导致我们的美化失效，清单查不出来 —— 本脚本把页面真正渲染出来，对**计算样式**下判据。
 *
 * 走的页面与判据：
 *   ① 首页（引导弹窗消完、会话未开）：插件 client 活着（主样式标签在场、内容是当前
 *      CSS）、body 玻璃锚点与 --we-* 变量落位、我们自己的 UI 入口（拉绳）在场；
 *   ② 会话页：点得到「新建会话」且 `main.conversation` / `rightbar` slot 真的挂出来
 *      （第二页可达），插件样式与错误卫生在换页后仍成立；
 *   ③ 设置页（**核心探针**）：设置 dialog 的 `:has([data-slot="settings.section"])`
 *      锚点在场，且它身上的**计算样式是我们的** —— backdrop blur、独有 sheen 渐变、
 *      `--dsw-alias-bg-layer-1` 被我们替换成 --we-glass-color 的值。harness 改了
 *      dialog 结构 / slot 改名 ⇒ 锚点选择器落空 ⇒ 三条全红（#107 型回归的页面级抓手）；
 *   ④ 设置五个分区逐个点（通用/模型/插件/Agent 预设/壁纸引擎——本插件那枚在 UI 重构里
 *      从「Wallpaper Engine」改名而来，按候选名匹配）：每页 dialog 仍开、我们的样式仍在场、
 *      不新增指向本插件的运行期错误；
 *   ⑤ 右栏 panel：由 harness 内部状态门控（会话态下占据者仍可能不渲染），**在场才判**
 *      （展开 → open 属性 → 开态玻璃），缺席只记信息不判红 —— 包级/页面级两条线已覆盖它。
 *   ⑥ 表面令牌探针（#80 / #71）：compat 跑在空数据目录上（没有已选壁纸），而页面玻璃锚点
 *      body[data-we-glass-page] 由插件恒挂（玻璃与有没有壁纸无关）⇒ 探针先读**锚点在场**的
 *      计算样式，再在**同一次求值**里临时摘掉锚点读对照侧（= 宿主原生实色），finally 里装回去；
 *      读 `--dsw-alias-bg-layer-1/2/3`
 *      与 `--dsw-alias-button-elevated-fill` 这两侧的**计算样式**，
 *      并读侧栏「新建会话」按钮的实际 background-color。判据 = 「锚点在 ⇒ harness 的面拿到玻璃」；
 *      日志、以及按新裁定接管的 markdown 代码块底各一条。回退档（软件光栅器）按模式取相反的期望值
 *      （令牌被钉回不透明面板色）。**同一段探针**还覆盖「左侧栏液态玻璃」（leftSidebarGlass，
 *      默认关）：左侧栏那一列的锚点是座位出口 [data-slot="sidebar"] 的父元素（哈希类名不可用），
 *      取「只有页面玻璃锚点 / 再加开关 / 摘掉开关」三态的计算样式 —— 锚点改名或结构
 *      变了 ⇒ 第一条就红；默认档与开关档必须一个不吃玻璃、一个拿到玻璃配方，摘掉开关
 *      逐字段还原。
 *
 * 鉴权：dsh web 是 token → 303 + Set-Cookie；浏览器自带 cookie 处理，直接导航 token URL。
 * 弹窗：启动期挡路 dialog 用**结构化消法**（单按钮 dialog 直接点；多按钮按跳过型白名单
 * 文案点，`--lang=zh-CN` 钉住文案），并排除设置 dialog（点它的「关闭」会把设置关掉）。
 *
 * 前置：已安装的 harness（沿用隔离 HOME / DSH_WE_DATA_DIR 约定）+ Chromium 系浏览器。
 * 缺浏览器 = 默认红（`--allow-skip` 显式接受不跑，P3-13 口径）。
 * `--dump` = 探查模式：把页面原始观测全打出来（写断言前先看这里，不判红绿）。
 * CDP 走 Node ≥22 的全局 WebSocket，零依赖（消息 = JSON 文本帧）。
 */
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CACHE = join(ROOT, '.test-cache', 'compat');
const ISO_HOME = join(CACHE, 'home');
const DATA_DIR = join(ISO_HOME, '.dsh-wallpaper-engine');
const BROWSER_LOG = join(CACHE, 'pages-browser.log');
const HARNESS_LOG = join(CACHE, 'pages-harness.log');
const PROFILE_DIR = join(CACHE, 'pages-chrome-profile');
const STYLE_SEL = 'style[data-plugin-css="dsh-wallpaper-engine/styles-v3"]';
const SETTINGS_DIALOG = '[role="dialog"]:has([data-slot="settings.section"])';

const argv = process.argv.slice(2);
const DUMP = argv.includes('--dump');
const ALLOW_SKIP = argv.includes('--allow-skip');
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const PORT = Number(argOf('--port', process.env.DSH_WE_COMPAT_PAGES_PORT || 5200));
// 玻璃回退模式演练钮：on/off → 给页面追加 ?we-glassfallback=on|off（产品自带的手动覆盖，
// 见 src/client.js detectSoftwareRender）；不设 = 按运行环境自动探测（CI 无 GPU 即回退态）。
const GLASS_FALLBACK = (process.env.DSH_WE_COMPAT_GLASS_FALLBACK || '').trim();

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tail = (s, n = 25) => String(s).split('\n').slice(-n).join('\n');

// win32：`dsh` / 浏览器都是 .cmd / .exe 垫片链，Node ≥18 在 shell:false 下拒绝启动 .cmd。
const spawnTool = (cmd, args, opts = {}) =>
  spawn(cmd, args, { ...opts, shell: process.platform === 'win32' });

function get(url) {
  return new Promise((res) => {
    const u = new URL(url);
    const req = httpRequest({ host: u.hostname, port: u.port, path: u.pathname + u.search, timeout: 5000 }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => res({ status: r.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', (e) => res({ status: 0, body: String(e.message) }));
    req.on('timeout', () => { req.destroy(); res({ status: 0, body: 'timeout' }); });
    req.end();
  });
}

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

async function runTool(cmd, args, { timeoutMs = 300000 } = {}) {
  const child = spawnTool(cmd, args, { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let settled = false;
  return new Promise((res) => {
    const done = (code) => { if (!settled) { settled = true; clearTimeout(t); res({ code, out }); } };
    const t = setTimeout(() => {
      out += '\n[timeout]\n';
      try { child.kill('SIGKILL'); } catch { /* 已退出 */ }
      done(124);
    }, timeoutMs);
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { out += b; });
    child.on('error', (e) => { out += String(e.stack || e); done(127); });
    child.on('exit', (code) => done(code ?? 1));
  });
}

// ── 零依赖 CDP 客户端 ────────────────────────────────────────────────────────
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.onmessage = (ev) => this.#on(JSON.parse(String(ev.data)));
  }
  static connect(url) {
    return new Promise((res, rej) => {
      const ws = new WebSocket(url);
      ws.onopen = () => res(new Cdp(ws));
      ws.onerror = () => rej(new Error('CDP WebSocket 连接失败：' + url));
    });
  }
  #on(msg) {
    if (msg.id && this.pending.has(msg.id)) {
      const { res, rej, hint } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) rej(new Error(hint + ': ' + msg.error.message));
      else res(msg.result);
    } else if (msg.method) {
      for (const fn of this.listeners) fn(msg);
    }
  }
  onEvent(fn) { this.listeners.push(fn); }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej, hint: method });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
}

// ── 浏览器候选（与 e2e-web-media-origin 同源的清单）──────────────────────────
const CANDIDATES = process.platform === 'win32' ? [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
] : process.platform === 'darwin' ? [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
] : [
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
];

const TOKEN_RE = /http:\/\/127\.0\.0\.1:(\d+)\/\?token=([^\s'"<>]+)/;

// 挡路弹窗的跳过型白名单（--lang=zh-CN 钉住文案；绝不能包含「保存并继续」这类
// 把流程带进配置向导的按钮）。
const DISMISS_EXPR = `(() => {
  const SETTINGS = '${SETTINGS_DIALOG}';
  const SAFE = ['稍后配置', '继续', '知道了', '关闭', '跳过', 'Got it', 'Continue', 'Skip', 'Later', 'Configure later', 'Close'];
  for (const d of [...document.querySelectorAll('[role="dialog"]')]) {
    if (d.matches(SETTINGS) || d.querySelector('[data-slot="settings.section"]')) continue;
    const btns = [...d.querySelectorAll('button')];
    if (btns.length === 1) { btns[0].click(); return 1; }
    const safe = btns.find((b) => SAFE.includes((b.textContent || '').trim()));
    if (safe) { safe.click(); return 1; }
  }
  return 0;
})()`;

// 无浏览器 ⇒ 默认红（P3-13 口径）。`--allow-skip` 是**显式逃生门**，不是"通过"：它 exit 0
// 之前必须过一道覆盖面地板，数的是 `results.length`（**本轮真的执行了几条判据**），
// 而不是"我打印了一句正在跳过" —— 静默跳过（零断言 exit 0）与显式接受不跑必须能被分辨（C4）。
// 地板值 = 这条路径之前的前置判据条数；位置搬动时它跟着改（见下方 `SKIP_MIN_CHECKS - 1` 自指）。
const SKIP_MIN_CHECKS = 1;   // 浏览器可定位探针：这条路径上唯一真跑过的判据

async function main() {
  for (const d of [ISO_HOME, DATA_DIR, childEnv.DSH_WE_UPLOAD_DIR, childEnv.DSH_WE_CACHE_DIR, childEnv.DSH_WE_STEAM_ROOT, CACHE]) {
    mkdirSync(d, { recursive: true });
  }

  const browserPath = CANDIDATES.find((p) => existsSync(p));
  if (!check('Chromium 系浏览器可定位', Boolean(browserPath),
    browserPath || '未找到（本地可加 --allow-skip 显式接受不跑）')) {
    if (ALLOW_SKIP) {
      check('覆盖面：本轮至少执行了 ' + SKIP_MIN_CHECKS + ' 条判据（跳过也要有地板）',
        results.length >= SKIP_MIN_CHECKS,
        '本轮已执行 ' + results.length + ' 条判据 / 地板 ' + SKIP_MIN_CHECKS
          + '（自指：前置探针 ' + (SKIP_MIN_CHECKS - 1) + ' 条 + 覆盖面本身 1 条）');
      console.log('  ⛔ SKIP 页面断言未执行（--allow-skip，无浏览器）—— 零判据的退出码 0 不叫通过');
      process.exit(0);
    }
    process.exit(1);
  }

  // 隔离先于一切：不成立绝不继续（否则 dsh plugin add 会改到真实 ~/.dsh）。
  const iso = spawnSync(process.execPath, ['-e', 'process.stdout.write(require("node:os").homedir())'],
    { env: childEnv, encoding: 'utf8' });
  if (!check('隔离 HOME 对子进程生效', iso.status === 0 && resolve(String(iso.stdout)) === resolve(ISO_HOME),
    iso.status === 0 ? String(iso.stdout) : '退出 ' + iso.status)) return;

  const add = await runTool('dsh', ['plugin', '--profile', 'web', 'add', 'link:' + ROOT]);
  if (!check('dsh plugin add 装载本插件（退出码 0）', add.code === 0,
    add.code === 0 ? undefined : '退出 ' + add.code + '\n' + tail(add.out))) return;

  // ── 起 harness（port 默认 5200，与 live 探活错开）──────────────────────────
  const harness = spawnTool('dsh', ['--profile', 'web', '--no-open', '--port', String(PORT)], {
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  let hout = '';
  const hsink = createWriteStream(HARNESS_LOG, { flags: 'w' });
  harness.stdout.on('data', (b) => { hout += b; hsink.write(b); });
  harness.stderr.on('data', (b) => { hout += b; hsink.write(b); });
  harness.on('error', (e) => { hout += String(e.stack || e); });

  const tokenHit = await waitUntil(async () => {
    if (harness.exitCode !== null || harness.signalCode !== null) return 'dead';
    const m = hout.match(TOKEN_RE);
    return m ? m : null;
  }, 120000);
  if (!tokenHit || tokenHit === 'dead') {
    check('harness 启动并输出 token URL', false,
      tokenHit === 'dead' ? '进程提前退出\n' + tail(hout) : '120s 未见 token URL\n' + tail(hout));
    await killTree(harness);
    return;
  }
  const pageUrl = `http://127.0.0.1:${tokenHit[1]}/?token=${tokenHit[2]}`;
  check('harness 启动并输出 token URL', true, 'port=' + tokenHit[1]);

  // ── 起无头浏览器（CDP 端口 0 → DevToolsActivePort 文件回读，免端口抢占）─────
  rmSync(PROFILE_DIR, { recursive: true, force: true });
  mkdirSync(PROFILE_DIR, { recursive: true });
  // 浏览器是真 .exe ⇒ **绝不走 shell**：win32 上 shell:true 会把命令交给 cmd 解析，
  // `C:/Program Files/...` 在空格处被切断（CI 实测 'C:/Program' is not recognized）。
  // shell:true 只为 dsh 的 .cmd 垫片保留（本文件其余 spawnTool 调用都是它）。
  const browser = spawn(browserPath, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${PROFILE_DIR}`,
    '--remote-allow-origins=*',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--no-ping',
    '--enable-unsafe-swiftshader',
    // macOS 上给无头浏览器一个**假钥匙串**：不给它，Chromium 系（实测 Edge）会去碰
    // 真钥匙串并弹「找不到用于存储…的钥匙串」对话框打断跑测的人（本机实测复现；
    // 见 e2e-web-media-origin 同一条与 docs/DEV-GUIDE 的浏览器启动口径）。
    // 其他平台该开关无害；win32 上 CI 无水可摸，传了是空操作。
    '--use-mock-keychain',
    '--lang=zh-CN',
    '--window-size=1440,900',
    'about:blank',
  ], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  const bsink = createWriteStream(BROWSER_LOG, { flags: 'w' });
  browser.stdout.on('data', (b) => bsink.write(b));
  browser.stderr.on('data', (b) => bsink.write(b));
  browser.on('error', (e) => bsink.write(String(e.stack || e)));

  const portFile = join(PROFILE_DIR, 'DevToolsActivePort');
  const portHit = await waitUntil(async () => {
    if (browser.exitCode !== null || browser.signalCode !== null) return 'dead';
    if (!existsSync(portFile)) return null;
    const first = readFileSync(portFile, 'utf8').split('\n')[0];
    return first && /^\d+$/.test(first) ? Number(first) : null;
  }, 20000, 300);
  if (!check('浏览器 CDP 端口就绪（DevToolsActivePort）', Boolean(portHit) && portHit !== 'dead',
    portHit === 'dead' ? '浏览器进程提前退出\n' + tail(existsSync(BROWSER_LOG) ? readFileSync(BROWSER_LOG, 'utf8') : '')
      : portHit ? 'port=' + portHit : '20s 未见端口文件')) {
    await killTree(browser);
    await killTree(harness);
    return;
  }

  let cdp = null;
  let sessionId = '';
  const pageErrors = [];
  try {
    const ver = await get(`http://127.0.0.1:${portHit}/json/version`);
    const wsUrl = JSON.parse(ver.body).webSocketDebuggerUrl;
    cdp = await Cdp.connect(wsUrl);
    cdp.onEvent((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails || {};
        pageErrors.push(String((d.exception && d.exception.description) || d.text || 'exception'));
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        pageErrors.push((msg.params.args || []).map((a) => a.value || a.description || '').join(' '));
      }
    });
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
    await cdp.send('Runtime.enable', {}, sessionId);

    const ev = async (expression) => {
      try {
        const r = await cdp.send('Runtime.evaluate',
          { expression, returnByValue: true, awaitPromise: true }, sessionId);
        if (r.exceptionDetails) {
          return { error: String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text) };
        }
        return { value: r.result.value };
      } catch (e) { return { error: String(e.message) }; }
    };
    // ⚠️ 求值出错必须**看得见**：错误被静默成 null 时，上面那段探针的重复声明（SyntaxError）
    //    会让 sp 恒为 null、三条判据恒红且看不出原因。DSH_WE_COMPAT_DEBUG 只加细节，
    //    不再是"能不能看到"的开关；同一条错误只打一次，免得住循环里刷屏。
    const evSErrors = new Set();
    const evS = async (expression) => {
      const r = await ev(expression);
      if (r.error !== undefined && !evSErrors.has(r.error)) {
        evSErrors.add(r.error);
        console.log('  [evS error] ' + String(r.error).slice(0, 400));
      }
      return r.error === undefined ? r.value : null;
    };
    const waitEv = (expression, timeoutMs = 10000, intervalMs = 300) =>
      waitUntil(async () => {
        const v = await evS(expression);
        return v ? { v } : null;
      }, timeoutMs, intervalMs);
    const dismissBlockers = async (rounds) => {
      let total = 0;
      for (let i = 0; i < rounds; i++) {
        const n = await evS(DISMISS_EXPR);
        total += Number(n) || 0;
        if (!n) break;
        await sleep(700);
      }
      return total;
    };

    // ── 导航：浏览器自带 cookie 处理（token → 303 → 应用）───────────────────
    // 就绪判据必须锚在 http: 文档上 —— about:blank 的 readyState 也是 complete，
    // 只看 readyState 会在导航提交前就误判就绪。
    await cdp.send('Page.navigate', { url: pageUrl }, sessionId);
    const ready = await waitEv('location.protocol === "http:" && document.readyState === "complete" ? 1 : 0', 30000, 500);
    if (!check('应用页面加载完成（readyState=complete）', Boolean(ready), '30s 超时\n' + tail(hout))) return;
    await sleep(2500); // SPA 挂载与插件 effect 挂载的沉降

    // 强制回退演练：token URL 的查询串会被 303 交换丢掉（Location: /），参数落不到页面上
    // —— 会话 Cookie 已在手，带参数二次导航到 / 才是产品覆盖开关的真正入口。
    if (GLASS_FALLBACK === 'on' || GLASS_FALLBACK === 'off') {
      await cdp.send('Page.navigate',
        { url: `http://127.0.0.1:${tokenHit[1]}/?we-glassfallback=${GLASS_FALLBACK}` }, sessionId);
      await waitEv('location.protocol === "http:" && document.readyState === "complete" ? 1 : 0', 30000, 500);
      await sleep(2500);
    }

    // ── 首页原始观测 ────────────────────────────────────────────────────────
    const observed = await ev(`(() => {
      const body = document.body;
      const ourTag = document.querySelector(${JSON.stringify(STYLE_SEL)});
      return {
        url: location.href,
        title: document.title,
        bodyAttrs: [...body.attributes].map((a) => a.name + '=' + a.value),
        ourStyle: Boolean(ourTag),
        ourStyleLen: ourTag ? (ourTag.textContent || '').length : 0,
        cssVars: {
          weAccent: getComputedStyle(body).getPropertyValue('--we-accent').trim().slice(0, 40),
          weGlassColor: getComputedStyle(body).getPropertyValue('--we-glass-color').trim().slice(0, 40),
        },
        dialogs: [...document.querySelectorAll('[role="dialog"]')].map((d) => ({
          text: (d.textContent || '').trim().slice(0, 60),
          buttons: [...d.querySelectorAll('button')].map((b) => (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 16)),
        })),
        rope: Boolean(document.querySelector('.we-rope')),
        headings: [...document.querySelectorAll('h1, h2')].slice(0, 6).map((h) => h.textContent.trim().slice(0, 30)),
      };
    })()`);
    if (observed.error) console.log('观测表达式出错：' + observed.error);
    const o = (observed && observed.value) || {};
    // 玻璃渲染模式：软件光栅器（CI 无 GPU / SwiftShader）下产品主动进回退态 ——
    // 回退规则**故意** backdrop-filter:none + 近不透明平板底，属正确行为，
    // 判据必须按模式取期望值（把正确回退判成红 = 假红）。
    const glassFb = Array.isArray(o.bodyAttrs)
      && o.bodyAttrs.some((a) => a.startsWith('data-we-glass-fallback'));

    // ── 交互链 A：消启动弹窗 → 选会话 → 会话页（换页后样式/错误仍成立）────────
    const flow = {};
    flow.noticeDismissed = await evS(
      `(() => { const b = document.querySelector('.we-update-notice__btn'); if (b) b.click(); return b ? 1 : 0; })()`);
    flow.blockersBeforeSession = await dismissBlockers(3);
    flow.sessionPicked = await evS(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) =>
        /newSession/.test(String(x.className))
        || (x.getAttribute('aria-label') || '').includes('新建会话')
        || (x.textContent || '').trim() === '新建会话');
      if (!b) return 0; b.click(); return 1;
    })()`);
    // 会话页到达的判据 = slot 锚点（比视觉元素稳定）：main.conversation 挂出即第二页可达。
    flow.conversationOpen = Boolean(await waitEv(`(() => {
      const slots = new Set([...document.querySelectorAll('[data-slot]')].map((el) => el.getAttribute('data-slot')));
      return slots.has('main.conversation') && slots.has('rightbar') ? 1 : 0;
    })()`, 12000, 400));
    flow.blockersAfterSession = await dismissBlockers(2);

    // 右栏 panel（在场才判）：harness 内部状态门控，缺席只记信息。
    flow.panelMounted = await evS(`document.querySelector('[data-sidebar-right-panel]') ? 1 : 0`) === 1;
    if (flow.panelMounted) {
      // 展开入口挂在会话头部、**异步后到** —— 快照取样会抢在按钮渲染之前（CI 实测 expand=0
      // 假红）。改成轮询：等到「已开 / 找到 expand 并点掉」之一才继续；8s 仍等不到才是真改入口。
      const opener = await waitEv(`(() => {
        const p = document.querySelector('[data-sidebar-right-panel]');
        if (!p) return 0;
        if (p.hasAttribute('data-sidebar-right-open')) return 'open';
        const b = document.querySelector('[data-sidebar-right-expand]');
        if (b) { b.click(); return 'clicked'; }
        return 0;
      })()`, 8000, 400);
      flow.expandFound = opener ? opener.v : 0;
      if (opener && opener.v === 'open') {
        flow.opened = true;
      } else if (opener) {
        flow.opened = Boolean(await waitEv(
          `document.querySelector('[data-sidebar-right-panel]') && document.querySelector('[data-sidebar-right-panel]').hasAttribute('data-sidebar-right-open') ? 1 : 0`,
          8000, 300));
      } else {
        flow.opened = false;
        // 入口缺席的归因：展开按钮住在 conversation.session.header.corner ——
        // 头部槽位整个没渲染 = 视图态（判据不取样、记信息）；头部在而按钮不在 = 锚点改名（判红）。
        flow.openerDiag = await evS(`(() => {
          const slots = [...document.querySelectorAll('[data-slot]')].map((el) => el.getAttribute('data-slot'));
          return {
            headerCorner: slots.includes('conversation.session.header.corner'),
            slotTail: slots.filter((s) => /conversation|header|hero/.test(s)),
            expandInDoc: document.querySelectorAll('[data-sidebar-right-expand]').length,
            panelButtons: document.querySelectorAll('[data-sidebar-right-toggle], [data-sidebar-right-mode]').length,
          };
        })()`);
      }
      if (flow.opened) {
        flow.panelGlass = await evS(`(() => {
          const p = document.querySelector('[data-sidebar-right-panel]');
          if (!p) return null;
          const cs = getComputedStyle(p);
          return {
            backdrop: cs.backdropFilter || cs.webkitBackdropFilter || '',
            bg: (cs.backgroundImage || '').slice(0, 300),
            bgColor: cs.backgroundColor,
          };
        })()`);
      }
    }

    // ── 交互链 B：设置页（核心玻璃探针）+ 五分区走查 ─────────────────────────
    flow.settingsOpened = await evS(
      `(() => { const b = document.querySelector('[aria-label="设置"]'); if (!b) return 0; b.click(); return 1; })()`);
    flow.settingsDialog = Boolean(await waitEv(
      `document.querySelector('${SETTINGS_DIALOG}') ? 1 : 0`, 8000, 400));
    let settingsGlass = null;
    if (flow.settingsDialog) {
      settingsGlass = await evS(`(() => {
        const dlg = document.querySelector('${SETTINGS_DIALOG}');
        const cs = getComputedStyle(dlg);
        return {
          backdrop: cs.backdropFilter || cs.webkitBackdropFilter || '',
          bg: (cs.backgroundImage || '').slice(0, 300),
          layer1: cs.getPropertyValue('--dsw-alias-bg-layer-1').trim().slice(0, 80),
        };
      })()`);
    }

    // 五分区走查。最后一项是**本插件自己的分区**：UI 重构把它从「Wallpaper Engine」
    // 改名成「壁纸引擎」（2026-09-30，见 docs/archive/wip 的改版口径 —— 该目录原为 docs/wip，
    // 文档收敛时整体归档）⇒ 按**候选名**匹配
    // （第一个在 DOM 里找得到的），判据盯的是「点得到 + 我们的样式仍在场」，
    // 不盯死某个历史文案；两条候选都找不到才判红。
    const SECTIONS = [['通用设置'], ['模型'], ['插件'], ['Agent 预设'], ['壁纸引擎', 'Wallpaper Engine']];
    const walk = [];
    for (const cands of SECTIONS) {
      const sec = cands[0];
      const clicked = await evS(`(() => {
        const names = ${JSON.stringify(cands)};
        const b = [...document.querySelectorAll('button')].find((x) => names.includes((x.textContent || '').trim()));
        if (!b) return 0; b.click(); return 1;
      })()`);
      await sleep(600);
      const snap = await evS(`(() => {
        const dlg = document.querySelector('${SETTINGS_DIALOG}');
        if (!dlg) return null;
        return {
          textLen: (dlg.textContent || '').length,
          ourStyle: Boolean(document.querySelector(${JSON.stringify(STYLE_SEL)})),
        };
      })()`);
      walk.push({ section: sec, clicked: Number(clicked) || 0, snap, ourErrors: countOurErrors(pageErrors) });
    }

    if (DUMP) {
      console.log('── 首页观测 ──');
      console.log(JSON.stringify(o, null, 2));
      console.log('── 交互链 ──');
      console.log(JSON.stringify(flow, null, 2));
      console.log('── 设置玻璃计算样式 ──');
      console.log(JSON.stringify(settingsGlass, null, 2));
      console.log('── 分区走查 ──');
      console.log(JSON.stringify(walk, null, 2));
      console.log('── 运行期错误（前 10 条）──');
      console.log(JSON.stringify(pageErrors.slice(0, 10), null, 2));
      return;
    }

    // ── 判据 ────────────────────────────────────────────────────────────────
    check('应用页面真的加载了（有标题）',
      Boolean(o.title || (o.headings && o.headings.length)),
      o.title || (o.headings && o.headings[0]) || 'title/headings 皆空');

    check('插件 client 在真实 harness 页面里活着（主样式标签在场且非空）',
      Boolean(o.ourStyle) && o.ourStyleLen > 1000,
      o.ourStyle ? 'len=' + o.ourStyleLen : '未找到 ' + STYLE_SEL);

    const cssIsOurs = await evS(
      `(document.querySelector(${JSON.stringify(STYLE_SEL)}) || {textContent:''}).textContent.includes('data-we-sidebar-glass')`);
    check('样式标签内容确系我们的当前 CSS（含 data-we-sidebar-glass 规则）',
      cssIsOurs === true, String(cssIsOurs));

    check('默认玻璃开关与变量落到了页面（body 锚点 + --we-accent/--we-glass-color）',
      Array.isArray(o.bodyAttrs) && o.bodyAttrs.some((a) => a.startsWith('data-we-sidebar-glass'))
        && Boolean(o.cssVars && o.cssVars.weAccent && o.cssVars.weGlassColor),
      (o.bodyAttrs || []).filter((a) => a.startsWith('data-we-')).join(' ')
        + ' / accent=' + (o.cssVars ? o.cssVars.weAccent : '?')
        + ' glassColor=' + (o.cssVars ? o.cssVars.weGlassColor : '?'));

    check('我们自己的选择器入口在 DOM（壁纸仓库拉绳 .we-rope）',
      o.rope === true || await evS(`Boolean(document.querySelector('.we-rope'))`));

    check('会话页可达（新建会话点得到，main.conversation + rightbar slot 挂出）',
      flow.sessionPicked === 1 && flow.conversationOpen === true,
      'sessionPicked=' + flow.sessionPicked + ' conversationOpen=' + flow.conversationOpen);

    if (flow.panelMounted) {
      const openerMissing = !flow.opened && flow.expandFound === 0;
      if (openerMissing && flow.openerDiag && !flow.openerDiag.headerCorner) {
        // 视图态：会话头部（展开按钮的宿主槽位）整个没渲染 —— 无从取样，记信息不判红。
        console.log('  ℹ️ 会话头部未渲染（视图态），展开/玻璃判据本轮不取样 —— slot 尾部：'
          + JSON.stringify(flow.openerDiag.slotTail));
      } else {
        check('右栏在场：展开机制可用（expand → open 属性）', flow.opened === true,
          'expand=' + String(flow.expandFound)
          + (flow.openerDiag ? ' diag=' + JSON.stringify(flow.openerDiag) : ''));
        if (flow.opened) {
          const pg = flow.panelGlass;
          check('右栏开态玻璃·backdrop 按渲染模式成立（正常=blur / 回退=显式 none）',
            Boolean(pg) && (glassFb
              ? String(pg.backdrop).trim() === 'none'
              : /blur\(/.test(String(pg.backdrop))),
            pg ? 'fallback=' + (glassFb ? 1 : 0) + ' backdrop=' + String(pg.backdrop).slice(0, 70) : '取不到 computed');
          check('右栏开态玻璃·sheen 渐变在场', Boolean(pg)
            && /linear-gradient/.test(pg.bg) && /rgba?\(255, ?255, ?255/.test(pg.bg),
            pg ? 'bg=' + String(pg.bg).slice(0, 90) : '取不到 computed');
          if (glassFb) {
            check('回退态·右栏平板底在场（背景非全透明 —— 无 blur 时由它兜底）',
              Boolean(pg) && pg.bgColor && pg.bgColor !== 'rgba(0, 0, 0, 0)',
              pg ? 'bgColor=' + String(pg.bgColor).slice(0, 60) : '取不到 computed');
          }
        }
      }
    } else {
      console.log('  ℹ️ 右栏 panel 本次未被 harness 渲染（内部状态门控）—— 包级与页面级判据已覆盖，此条不判红');
    }

    // ── 表面令牌探针（#80 / #71）─────────────────────────────────────────────
    // 本脚本跑在**隔离的空数据目录**上 ⇒ 没有已选壁纸、body 上没有 data-we-wallpaper，
    // 但**页面玻璃锚点 data-we-glass-page 是插件挂的、恒在**（玻璃与有没有壁纸无关）。
    // 所以探针反过来取对照侧：先读**锚点在场**的计算样式（= 玻璃配方），再在**同一次求值**里
    // 临时摘掉这个锚点、读第二侧（= 宿主原生实色），finally 里装回去 —— 判据挂在
    // 「锚点在 ⇒ harness 的面拿到玻璃」这个语义上，不挂任何选择器/实现细节：把
    // body[data-we-glass-page] 上的令牌映射去掉，after 侧就退回原生实色 ⇒ 本条变红。
    // 玻璃配方以 color-mix(...) 认族：harness 原生值是静态调色板的实色（解析成 #hex/rgb）。
    // 回退档（软件光栅器）下期望**相反**且有意义的另一件事：这些令牌被钉回不透明面板色
    // （半透明 + 无霜等于文字压在壁纸上）—— 与设置窗口那三条按模式取期望值同口径。
    const surfaceProbe = await evS(`(() => {
      // 抬高按钮面的宿主：优先按**语义类名**认（CSS 模块哈希会变，但 xUkysG_newSession 这类
      // 语义段是源码里写死的），再退到既有会话链用的 aria-label / 文案判据。
      const findRaised = () => {
        const btns = [...document.querySelectorAll('button')];
        return btns.find((x) => /newSession/.test(String(x.className)))
          || btns.find((x) => (x.getAttribute('aria-label') || '').includes('新建会话'))
          || btns.find((x) => (x.textContent || '').trim() === '新建会话');
      };
      const snap = () => {
        const cs = getComputedStyle(document.body);
        const g = (t) => String(cs.getPropertyValue(t) || '').trim();
        const btn = findRaised();
        return {
          layer1: g('--dsw-alias-bg-layer-1'),
          layer2: g('--dsw-alias-bg-layer-2'),
          layer3: g('--dsw-alias-bg-layer-3'),
          elevated: g('--dsw-alias-button-elevated-fill'),
          codeBlock: g('--dsw-alias-markdown-code-block'),
          raisedBg: btn ? getComputedStyle(btn).backgroundColor : null,
        };
      };
      // ⚠️ 不要在这里取 before：本 IIFE 末尾的 let before = null; 会与 const before = snap();
      //    在**同一函数作用域**里重复声明 ⇒ 整段求值是 SyntaxError，被 evS 静默吞成 null
      //    ⇒ 下面三条判据恒红、col / colWall 两条永不执行（"没有锚点"那一侧的对照在下面的 try 里现取）。
      // 左侧栏液态玻璃（leftSidebarGlass）：那一列的锚点是座位出口 [data-slot="sidebar"]
      // 的**父元素**（CSS 模块哈希类名不可用；出口自己 display:contents 不生成盒子）。
      // 四个状态各取一次：锚点在场但开关关（默认档 = 不吃玻璃）/ 两个属性都在
      // （我们的配方）/ 再摘掉开关（必须回到"只盖锚点"那一档 ⇒ 默认关不改动）。
      const colSnap = () => {
        const cols = [...document.querySelectorAll('div:has(> [data-slot="sidebar"])')];
        const col = cols[0] || null;
        if (!col) return null;
        const cs = getComputedStyle(col);
        return {
          matches: cols.length,
          bg: cs.backgroundColor,
          backdrop: cs.backdropFilter || cs.webkitBackdropFilter,
          borderRight: cs.borderRightWidth + ' ' + cs.borderRightColor,
          l3: String(cs.getPropertyValue('--dsw-alias-border-l3') || '').trim(),
        };
      };
      const colBare = colSnap();
      let before = null;
      const after = snap();
      const colWall = colSnap();
      let colOn = null;
      let colOff = null;
      try {
        // 「没有锚点」那一侧对照：**临时摘掉**插件自己挂的页面玻璃锚点（真机上它恒在，
        // 所以这一侧只在这个探针里存在）；finally 里装回去，后续状态不被污染。
        document.body.removeAttribute('data-we-glass-page');
        before = snap();
      } finally { document.body.setAttribute('data-we-glass-page', 'on'); }
      document.body.setAttribute('data-we-left-sidebar', 'on');
      colOn = colSnap();
      document.body.removeAttribute('data-we-left-sidebar');
      colOff = colSnap();
      return { before, after, colBare, colWall, colOn, colOff };
    })()`);

    // ⚠️ `evS` 返回的是**值本身**（`ev` 才返回 {value} 包装）—— 这里曾写成
    //     `surfaceProbe.value`，于是 sp 恒为 null、下面三条判据**恒红且看不出原因**
    //     （bb06fc2 起一直如此：harness-compat 是派发制，没人重跑就没人发现）。
    const sp = surfaceProbe || null;
    if (process.env.DSH_WE_COMPAT_DEBUG) console.log('  [surfaceProbe raw] ' + JSON.stringify(surfaceProbe).slice(0, 900));
    // 两侧快照都在场才判（探针抛错时 evS 给 null ⇒ 这里的每条都落在"取不到 = 红"上）。
    const spOk = Boolean(sp && sp.before && sp.after);
    const SURFACE_TOKENS = ['layer1', 'layer2', 'layer3', 'elevated'];
    const tokenSide = (side) => SURFACE_TOKENS
      .map((k) => k + '=' + String((sp && sp[side] && sp[side][k]) || '（取不到）').slice(0, 26)).join(' ');
    check('表面令牌：锚点在时 harness 的面板层与抬高按钮面被接管为玻璃（--dsw-alias-bg-layer-1/2/3 + button-elevated-fill，#80/#71）',
      spOk && SURFACE_TOKENS.every((k) => (glassFb
        // 回退档：钉回不透明面板色 —— 两侧都不该是玻璃配方。
        ? !isGlassMix(sp.before[k]) && !isGlassMix(sp.after[k])
        // 正常档：锚点关闭时是 harness 原生实色，锚点在时必须变成玻璃配方。
        : isGlassMix(sp.after[k]) && !isGlassMix(sp.before[k]))),
      'fallback=' + (glassFb ? 1 : 0) + ' · before[' + tokenSide('before') + '] · after[' + tokenSide('after') + ']');

    // markdown 代码块底（用户口径："代码块和重点文字背景也要和对话框一样玻璃化"）：
    // 2026-10 起**接管**（与气泡同一张配方表：主题底色压可读性下限 + 玻璃色 @ 玻璃透明度）。
    // 正常档：锚点在时必须变成玻璃配方；回退档（软件光栅器/无 backdrop-filter）：钉回不透明面板色。
    check('markdown 代码块底按新裁定接管为玻璃（回退档则钉回不透明；shiki 前景色不动）',
      spOk && (glassFb
        ? !isGlassMix(sp.after.codeBlock)
        : isGlassMix(sp.after.codeBlock) && !isGlassMix(sp.before.codeBlock)),
      'fallback=' + (glassFb ? 1 : 0)
        + ' codeBlock before=' + String((sp && sp.before && sp.before.codeBlock) || '（取不到）').slice(0, 40)
        + ' after=' + String((sp && sp.after && sp.after.codeBlock) || '（取不到）').slice(0, 40));

    if (spOk && sp.after.raisedBg) {
      const beforeAlpha = alphaOf(sp.before.raisedBg);
      const afterAlpha = alphaOf(sp.after.raisedBg);
      check('侧栏「新建会话」按钮面在锚点下变成半透明玻璃（#71；回退档则保持不透明）',
        glassFb ? afterAlpha === 1 : (beforeAlpha === 1 && afterAlpha !== null && afterAlpha < 1),
        'fallback=' + (glassFb ? 1 : 0) + ' bg before=' + String(sp.before.raisedBg).slice(0, 40)
          + ' after=' + String(sp.after.raisedBg).slice(0, 40));
    } else {
      console.log('  ℹ️ 侧栏「新建会话」按钮本次未渲染 —— 同一条令牌已由上面的令牌面判据覆盖，本条不判红');
    }

    // ── 左侧栏液态玻璃（leftSidebarGlass，默认关）───────────────────────────────
    // 三件事：① 锚点（座位出口 [data-slot="sidebar"] 的父元素 = 左栏那一列）在真 harness
    // 上唯一命中；② 默认档（只有页面玻璃锚点、开关关）那一列**不吃**玻璃，开关打开才拿到
    // 我们的配方（正常档 = 玻璃色 + 雾化；回退档 = 近不透明 + 显式 none）；③ 摘掉开关即还原
    // —— 后两条合起来保证「默认关 = 与今天逐字节相同」。
    const col = (sp && sp.colOn) || null;
    const colWall = (sp && sp.colWall) || null;
    check('左侧栏液态玻璃·锚点唯一命中原生左栏（[data-slot="sidebar"] 的父元素）',
      Boolean(col) && col.matches === 1,
      col ? 'matches=' + col.matches : '没选到列元素（座位出口改名 / 结构变了 ⇒ 本条变红）');
    if (col && colWall) {
      // ⚠️ 这里读的是 **backgroundColor 的计算值** —— color-mix 已被浏览器解析成
      //    color(srgb r g b / a)（不再含 color-mix 字面量）⇒ 认族要用 alpha + backdrop，
      //    不能照抄上面按**自定义属性**取值那几条的 isGlassMix。
      const wallAlpha = alphaOf(colWall.bg);
      const onAlpha = alphaOf(col.bg);
      const wallIsGlass = glassFb ? (wallAlpha !== null && wallAlpha >= 0.9) : /blur\(/.test(String(colWall.backdrop));
      const onIsGlass = glassFb
        ? (String(col.backdrop).trim() === 'none' && onAlpha !== null && onAlpha >= 0.9)
        : (/blur\(/.test(String(col.backdrop)) && onAlpha !== null && onAlpha > 0 && onAlpha < 1);
      check('左侧栏液态玻璃·关 = 那一列不吃玻璃；开 = 拿到玻璃配方（回退档 = 近不透明 + 显式 none）',
        !wallIsGlass && onIsGlass,
        'fallback=' + (glassFb ? 1 : 0)
          + ' · 关=' + String(colWall.bg).slice(0, 40) + '/α' + wallAlpha + '/' + String(colWall.backdrop).slice(0, 24)
          + ' · 开=' + String(col.bg).slice(0, 40) + '/α' + onAlpha + '/' + String(col.backdrop).slice(0, 24));
      check('左侧栏液态玻璃·摘掉开关即还原（打开档与默认档逐字段相同）',
        JSON.stringify(sp.colOff) === JSON.stringify(colWall),
        '默认档=' + JSON.stringify(colWall) + ' 摘开关后=' + JSON.stringify(sp.colOff));
    }

    check('设置页打开且锚点在场（:has([data-slot="settings.section"]) 选得到 dialog）',
      flow.settingsOpened === 1 && flow.settingsDialog === true,
      'opened=' + flow.settingsOpened + ' dialog=' + flow.settingsDialog);

    if (flow.settingsDialog) {
      check('设置窗口玻璃·backdrop 按渲染模式成立（正常=blur / 回退=显式 none）',
        Boolean(settingsGlass) && (glassFb
          ? String(settingsGlass.backdrop).trim() === 'none'
          : /blur\(/.test(String(settingsGlass.backdrop))),
        settingsGlass ? 'fallback=' + (glassFb ? 1 : 0)
          + ' backdrop=' + String(settingsGlass.backdrop).slice(0, 90) : '取不到 computed');
      // sheen 渐变两档（0.1 = 浅色规则 / 0.07 = 深色规则）都是我们 styles.js 里的层，
      // 断言按「白色起步 + 38% 中间停」认族，主题无关。
      check('设置窗口玻璃·独有 sheen 渐变在场（白色三层渐变、38% 中间停）',
        Boolean(settingsGlass && /linear-gradient/.test(settingsGlass.bg)
          && /rgba\(255, 255, 255, (0\.07|0\.1)\)/.test(settingsGlass.bg)
          && /38%/.test(settingsGlass.bg)),
        settingsGlass ? 'bg=' + String(settingsGlass.bg).slice(0, 120) : '取不到 computed');
      check('设置窗口 token 被我们接管（--dsw-alias-bg-layer-1 = --we-glass-color 的值）',
        Boolean(settingsGlass && settingsGlass.layer1
          && (settingsGlass.layer1.includes(String(o.cssVars ? o.cssVars.weGlassColor : '#ffffff').slice(0, 7))
            || settingsGlass.layer1.includes('color-mix'))),
        settingsGlass ? 'layer1=' + settingsGlass.layer1 : '取不到 computed');
    }

    const walkBroken = walk.filter((w) => w.clicked !== 1 || !w.snap || !w.snap.ourStyle || w.snap.textLen <= 100);
    check('设置五分区逐页走查（每页 dialog 仍开 + 我们样式仍在场）',
      flow.settingsDialog === true && walk.length === SECTIONS.length && walkBroken.length === 0,
      walk.map((w) => w.section + ':' + (w.snap ? w.snap.textLen : 'lost')).join(' ')
        + (walkBroken.length ? ' 断点=' + walkBroken.map((w) => w.section).join(',') : ''));

    const ours = countOurErrors(pageErrors);
    check('页面运行期错误不含指向本插件的异常', ours === 0,
      ours === 0 ? '共 ' + pageErrors.length + ' 条宿主侧错误（不拦）'
        : oursErrorDetail(pageErrors));
  } finally {
    if (cdp) { try { cdp.ws.close(); } catch { /* 已关闭 */ } }
    await killTree(browser);
    await killTree(harness);
  }
}

function countOurErrors(list) {
  return list.filter((e) => /wallpaper-engine|dsh-wallpaper-engine|we-picker|we-rope|data-we-/.test(e)).length;
}
function oursErrorDetail(list) {
  return list.filter((e) => /wallpaper-engine|dsh-wallpaper-engine|we-picker|we-rope|data-we-/.test(e))
    .slice(0, 2).join(' | ').slice(0, 300);
}
/** 是不是「玻璃配方」：我们的映射写成 color-mix(...)，harness 原生值是实色。 */
function isGlassMix(value) {
  return /color-mix\(/.test(String(value || ''));
}
/** `rgb(r, g, b)` / `rgba(r, g, b, a)` 的 alpha（无 alpha 分量 = 1；认不出 = null）。 */
/** `rgb(r, g, b)` / `rgba(r, g, b, a)` 的 alpha（无 alpha 分量 = 1；认不出 = null）。
 *  color-mix 的计算值在 Chromium 里可能是 `color(srgb r g b / a)` 形式
 *  （宽色域安全序列化，实测：`color(srgb 1 1 1 / 0.5875)`）—— 两种形态都要认，
 *  否则玻璃配方一律判成"取不到"。 */
function alphaOf(color) {
  const s = String(color || '');
  const m = /rgba?\(([^)]+)\)/.exec(s);
  if (m) {
    const parts = m[1].split(',').map((x) => Number(x.trim()));
    return parts.length === 4 ? parts[3] : 1;
  }
  const c = /color\(\s*srgb\s+[^/)]+(?:\/\s*([\d.]+)\s*)?\)/.exec(s);
  if (c) return c[1] === undefined ? 1 : Number(c[1]);
  return null;
}

main().then(() => {
  const failed = results.filter((ok) => !ok).length;
  if (DUMP) { console.log('\nDUMP 完成（探查模式不判红绿）'); process.exitCode = 0; return; }
  if (failed) console.log(`\nHARNESS PAGES FAILED — ${failed}/${results.length} 条判据不成立`);
  else console.log(`\nHARNESS PAGES PASSED — ${results.length} 条判据全部成立`);
  process.exitCode = failed ? 1 : 0;
}).catch((err) => {
  console.error('compat-harness-pages 未捕获异常：', err);
  process.exitCode = 1;
});
