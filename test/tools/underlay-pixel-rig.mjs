/**
 * underlay-pixel-rig.mjs —— **真浏览器像素对照装置**（手动工具，不进 `npm run verify` 链）。
 *
 * 回答的问题：**壁纸的像素没送到屏上时，页面自己画的是什么颜色？**
 * 这是「最小化 / 还原 / 被遮挡时闪一整块白」那一类问题的可测口径：合成器丢层没法在测试里
 * 制造，但「那一片像素没了之后屏上还剩什么」可以逐像素量出来 —— 剩下的若是宿主的纯白底，
 * 用户看到的就是白闪；若是一层壁纸代表色，就只是同色底（画布兜底色要守的正是这一条）。
 *
 * 装置构成（每条都刻意贴着真机）：
 *   · 页面结构逐条照抄宿主前端：`html,body,#root{height:100%;margin:0}` +
 *     `body{background:var(--dsw-alias-bg-base,#fff)}`（未定义令牌时兜底纯白，证据在
 *     `@deepseek-ai/dsh-web-frontend` 的 dist CSS）+ `#root{position:fixed;transform:translateZ(0)}`
 *     + 兼容模式基线透明的 `.dshDesktopFrame`。**刻意不给页面垫任何"窗口底板"**：
 *     页面没画的像素就是 alpha=0，量的是页面自己的绘制，与平台无关。
 *   · 跑的是**真产物** `lib/client.js`（经宿主那套 `window.__ModuleLoader__` 契约加载）。
 *   · "壁纸层没送到屏上"用 `visibility:hidden` 打在**媒体叶子**上模拟：层与页面其余部分照旧
 *     绘制，只有那一片像素没了 —— 这正是合成器丢掉那一层时屏上出现的像素。
 *   · 中心像素取 CDP `Page.captureScreenshot`（1×1 clip）→ PNG → ffmpeg 解到 RGBA；页面若
 *     什么都没画则 alpha=0，再按平台窗口底板色（Electron 的 `backgroundColor` 缺省 `#FFF`）
 *     合成一遍，得到用户实际看到的颜色。
 *
 * 怎么用（A/B 对照要走**两份产物**）：
 *   node test/tools/underlay-pixel-rig.mjs lib/client.js "本次"
 *   git show HEAD:lib/client.js > /tmp/before.js
 *   node test/tools/underlay-pixel-rig.mjs /tmp/before.js "对照"
 * 输出三行：① 壁纸在屏（对照行）② 媒体叶子不绘制 ③ 整层不绘制。① 两版应当逐像素一致
 * （兜底色不该改变正常观感）；② 是这条修复真正动的那个数。
 *
 * 前置：Chromium 系浏览器 + ffmpeg 在 PATH（缺任一项会直接报错退出，不会给出假绿）。
 * 本机会弹一次「找不到钥匙串」是 `--use-mock-keychain` 已经挡掉的那类问题的对照 —— 见
 * `docs/DEV-GUIDE.md` 的浏览器启动口径。
 * Usage: node test/tools/underlay-pixel-rig.mjs <bundle.js> [label]
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

const BUNDLE = readFileSync(process.argv[2], 'utf8');
const LABEL = process.argv[3] || process.argv[2];
const MP4 = '/tmp/rig/clip.mp4';
const BROWSERS = [
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
];
const PORT = 8791;
const CDP_PORT = 9455;
const W = 900;
const H = 640;

const HOST_CSS = `
  html,body,#root{height:100%;margin:0}
  body{color:var(--dsw-alias-label-primary,#0f1115);background:var(--dsw-alias-bg-base,#fff)}
  #root{position:fixed;inset:0;transform:translateZ(0)}
  .dshDesktopFrame{position:fixed;inset:0;display:grid;background:transparent}
  .dshDesktopFrameTitlebar{height:38px;background:var(--dsh-desktop-frame-fill,#f4f5f7)}
`;

const PAGE = `<!doctype html>
<html data-platform="win32">
<head><meta charset="utf-8"><style>${HOST_CSS}</style></head>
<body>
  <div id="root"><div class="dshDesktopFrame"><div class="dshDesktopFrameTitlebar">DSH</div></div></div>
  <script>
    window.__facts = { errors: [], beacons: 0 };
    window.__ModuleLoader__ = { load: (h) => { window.__handoff = h; } };
    window.onerror = (m) => { window.__facts.errors.push(String(m)); };
    // 选中壁纸：走本地存储种子（宿主设置里没有东西时客户端会迁移这份种子）。
    try { localStorage.setItem('dsh-wallpaper-engine:selection', JSON.stringify({ id: 'v1', edgeCompat: false })); } catch (e) {}
  </script>
  <script src="/client.js"></script>
  <script>
  (function () {
    var React = {
      Fragment: 'Fragment',
      useState: function (i) { return [typeof i === 'function' ? i() : i, function () {}]; },
      useEffect: function () {}, useLayoutEffect: function () {}, useMemo: function (f) { return f(); },
      useCallback: function (f) { return f; }, useRef: function (v) { return { current: v }; },
      createElement: function (t, p) {
        var c = Array.prototype.slice.call(arguments, 2);
        return typeof t === 'function' ? t(p || {}) : { type: t, props: p || null, children: c };
      },
    };
    var cleanups = [];
    var ctx = {
      slots: { inject: function (k, cb) { cb(); }, register: function () {} },
      effect: function (fn) {
        try { var c = fn(); if (typeof c === 'function') cleanups.push(c); }
        catch (e) { window.__facts.errors.push('effect: ' + String(e && e.stack || e)); }
      },
      get: function () { return undefined; },
      on: function () { return function () {}; },
    };
    try {
      var h = window.__handoff;
      var exp = h.factory(function (spec) {
        if (spec === 'react') return React;
        if (spec === 'react-dom') return { createPortal: function (n) { return n; } };
        return {};
      });
      window.__facts.inject = exp.inject;
      exp.apply(ctx);
      window.__facts.applied = true;
    } catch (e) {
      window.__facts.errors.push('apply: ' + String(e && e.stack || e));
    }
  })();
  </script>
</body></html>`;

const INVENTORY = {
  installDir: 'D:/we', total: 1, portableCount: 1, playlists: [],
  wallpapers: [{
    id: 'v1', title: 'Rig video', type: 'video', playable: true,
    media: '/wallpaper-engine/media/rig', preview: null, contentrating: 'Everyone',
    schemeColor: 'rgb(24, 90, 160)',
  }],
};

function ensureClip() {
  if (existsSync(MP4)) return;
  mkdirSync('/tmp/rig', { recursive: true });
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xC8283C:s=640x360:d=3:r=15',
    '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', MP4], { stdio: 'ignore' });
  if (r.status !== 0 || !existsSync(MP4)) { console.error('生成测试片段失败（需要 ffmpeg）'); process.exit(2); }
}

function serve() {
  const mp4 = readFileSync(MP4);
  return new Promise((res) => {
    const s = createServer((req, r) => {
      const u = new URL(req.url, 'http://x');
      const p = u.pathname;
      const json = (o) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify(o)); };
      if (p === '/') { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(PAGE); return; }
      if (p === '/client.js') { r.setHeader('content-type', 'text/javascript'); r.end(BUNDLE); return; }
      if (p === '/clip.mp4' || p === '/wallpaper-engine/media/rig') {
        r.setHeader('content-type', 'video/mp4');
        r.setHeader('accept-ranges', 'bytes');
        if (req.headers.range) {
          const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range);
          const start = m[1] ? Number(m[1]) : 0;
          const end = m[2] ? Number(m[2]) : mp4.length - 1;
          r.statusCode = 206;
          r.setHeader('content-range', `bytes ${start}-${end}/${mp4.length}`);
          r.end(mp4.subarray(start, end + 1));
          return;
        }
        r.end(mp4); return;
      }
      if (p === '/wallpaper-engine/inventory') return json(INVENTORY);
      if (p === '/wallpaper-engine/settings') return json({ ok: true });
      if (p === '/diag') { window_counter(); r.statusCode = 204; r.end(); return; }
      if (p === '/wallpaper-engine/client-diag') { window_counter(); r.statusCode = 204; r.end(); return; }
      r.statusCode = 404; r.end('nope');
    });
    s.listen(PORT, '127.0.0.1', () => res(s));
  });
}
function window_counter() { /* 诊断信标：只计数，不落盘 */ }

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const get = async (url) => (await fetch(url)).json();

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.onmessage = (e) => this._on(JSON.parse(String(e.data))); }
  static connect(url) { return new Promise((res, rej) => { const ws = new WebSocket(url); ws.onopen = () => res(new Cdp(ws)); ws.onerror = () => rej(new Error('cdp connect failed')); }); }
  _on(m) { if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); if (m.error) rej(new Error(m.error.message)); else res(m.result); } }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  }
}

function run(cmd, args, input) {
  return new Promise((res, rej) => {
    const c = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = []; const err = [];
    c.stdout.on('data', (d) => out.push(d));
    c.stderr.on('data', (d) => err.push(d));
    c.on('error', rej);
    c.on('exit', (code) => code === 0 ? res(Buffer.concat(out)) : rej(new Error(cmd + ' exit ' + code + ': ' + Buffer.concat(err).toString().slice(0, 300))));
    if (input) c.stdin.end(input); else c.stdin.end();
  });
}

async function main() {
  if (!process.argv[2]) { console.error('用法：node test/tools/underlay-pixel-rig.mjs <bundle.js> [label]'); process.exit(2); }
  const browserPath = BROWSERS.find((p) => existsSync(p));
  if (!browserPath) { console.error('找不到 Chromium 系浏览器（候选：' + BROWSERS.join(', ') + '）'); process.exit(2); }
  ensureClip();
  const server = await serve();
  const browser = spawn(browserPath, [
    '--headless=new', '--enable-unsafe-swiftshader', '--use-mock-keychain',
    '--no-first-run', '--no-default-browser-check', '--disable-features=CalculateNativeWinOcclusion',
    '--user-data-dir=/tmp/rig-profile', `--remote-debugging-port=${CDP_PORT}`,
    `--window-size=${W},${H}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let cdp = null;
  try {
    let ver = null;
    for (let i = 0; i < 40 && !ver; i++) { try { ver = await get(`http://127.0.0.1:${CDP_PORT}/json/version`); } catch { await sleep(250); } }
    if (!ver) throw new Error('浏览器没起来');
    cdp = await Cdp.connect(ver.webSocketDebuggerUrl);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false }, sessionId);
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` }, sessionId);
    const ev = async (expr) => {
      const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
      if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
      return r.result.value;
    };
    const shot = async () => {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: W / 2, y: H / 2, width: 1, height: 1, scale: 1 } }, sessionId);
      const raw = await run('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], Buffer.from(data, 'base64'));
      return [raw[0], raw[1], raw[2], raw[3]];
    };
    // 等应用起播：层 + 视频就绪
    let ready = null;
    for (let i = 0; i < 60 && !ready; i++) {
      ready = await ev(`(() => { const v = document.querySelector('.we-layer video'); return (document.body.hasAttribute('data-we-wallpaper') && v && v.readyState >= 2 && v.videoWidth > 0) ? 1 : 0; })()`);
      if (!ready) await sleep(250);
    }
    await sleep(600);
    console.log('readyFlag=' + ready);
    const facts = await ev(`(() => {
      const v = document.querySelector('.we-layer video');
      const root = getComputedStyle(document.documentElement);
      const body = getComputedStyle(document.body);
      const el = document.documentElement;
      return {
        applied: !!window.__facts.applied, errors: window.__facts.errors.slice(0, 4),
        hasAttr: document.body.hasAttribute('data-we-wallpaper'),
        layers: Array.from(document.body.children).map((c) => c.id || c.tagName),
        vidCount: document.querySelectorAll('video').length,
        underlayVar: el.style.getPropertyValue('--we-wallpaper-underlay') || '(unset)',
        htmlBg: root.backgroundColor, bodyBg: body.backgroundColor,
        video: v ? { src: v.getAttribute('src'), rs: v.readyState, w: v.videoWidth, h: v.videoHeight, paused: v.paused, t: Number(v.currentTime.toFixed(2)), err: v.error && v.error.code } : null,
        layerRect: (() => { const n = document.getElementById('dsh-wallpaper-engine-layer'); if (!n) return null; const r = n.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(),
      };
    })()`);
    const visible = await shot();
    await ev(`(() => { document.querySelectorAll('.we-layer .we-media').forEach((m) => { m.style.visibility = 'hidden'; }); return document.querySelectorAll('.we-layer .we-media').length; })()`);
    await sleep(400);
    const noMedia = await shot();
    await ev(`(() => { const n = document.getElementById('dsh-wallpaper-engine-layer'); if (n) n.style.display = 'none'; return 1; })()`);
    await sleep(400);
    const noLayer = await shot();
    await ev(`(() => { document.querySelectorAll('.we-layer .we-media').forEach((m) => { m.style.visibility = ''; }); const n = document.getElementById('dsh-wallpaper-engine-layer'); if (n) n.style.display = ''; return 1; })()`);

    const over = (px, plate = [255, 255, 255]) => {
      const a = px[3] / 255;
      return [0, 1, 2].map((i) => Math.round(px[i] * a + plate[i] * (1 - a)));
    };
    const fmt = (px) => `rgba(${px.join(',')}) → 合成到窗口底板 #FFF 后 rgb(${over(px).join(',')})`;
    console.log(`\n=== ${LABEL} ===`);
    console.log('facts:', JSON.stringify(facts));
    console.log('① 壁纸在屏（对照）      :', fmt(visible));
    console.log('② 媒体叶子不绘制（掉层）:', fmt(noMedia));
    console.log('③ 整层不绘制            :', fmt(noLayer));
  } finally {
    try { browser.kill('SIGKILL'); } catch { /* ignore */ }
    server.close();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('RIG FAILED', e); process.exit(1); });
