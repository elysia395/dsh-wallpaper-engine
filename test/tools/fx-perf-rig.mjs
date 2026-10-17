/**
 * fx-perf-rig.mjs —— **真浏览器帧耗时对照装置**（手动工具，不进 `npm run verify` 链）。
 *
 * 回答的问题：**开启点击与拖尾效果后，一帧到底画多久？**（issue #190）
 * 单元守卫数的是"贵操作次数"（模糊 / 描边），它证明调用变少了；这个装置量的是**时间**，
 * 用来回答"变少了到底有没有用"。
 *
 * 加载什么：**真的 `src/fx-layer.js` 源文件**（它就是要被内联进产物的那一份），
 * 按 ES module 导入，配套 `src/we-base.js`。**不加载整份 `lib/client.js` 产物** ——
 * 那份要走宿主 `__ModuleLoader__` 的工厂交接（还要 React / localStorage / 一堆路由替身），
 * 装起来一大坨，而本装置只关心光效层的绘制成本。
 *
 * ⚠️ 装置的局限（结论必须连这句一起读）：
 *   · 无头浏览器的合成 / 光栅化路径与真机不同，**只作相对 A/B 对照**，不是真机绝对值。
 *   · 不挂真壁纸 ⇒ 量的是光效层**自身**的绘制成本，不含它与壁纸做 `mix-blend-mode` 合成的那部分。
 *   · 真机绝对值需要报告者复测（本装置只给相对 A/B 对照）。
 *
 * 用法（A/B 走两份 fx-layer.js）：
 *   node test/tools/fx-perf-rig.mjs src/fx-layer.js "修复后"
 *   node test/tools/fx-perf-rig.mjs /path/to/fx-layer-before.js "修复前"
 *
 * 退出码：0 = 拿到结果；1 = 装置失败；2 = 用法 / 前置缺失（**不给假绿**）。
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');

const FX_PATH = process.argv[2];
const LABEL = process.argv[3] || FX_PATH;
if (!FX_PATH || !existsSync(FX_PATH)) {
  console.error('用法: node test/tools/fx-perf-rig.mjs <fx-layer.js> [label]');
  process.exit(2);
}
const FX_SRC = readFileSync(FX_PATH, 'utf8');
const WE_BASE = readFileSync(join(REPO, 'src', 'we-base.js'), 'utf8');

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
];
const browser = BROWSERS.find((p) => existsSync(p));
if (!browser) { console.error('找不到 Chromium 系浏览器，装置退出（不给出假绿）'); process.exit(2); }

const PORT = 8795;
const FRAMES = 240;

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#101418}
  body[data-we-wallpaper="on"] .we-fx{display:block;position:fixed;left:0;top:0;width:100%;height:100%;z-index:-1;pointer-events:none}
  .we-fx{display:none}
  .we-fx__canvas{display:block;width:100%;height:100%}
  .we-scrim{position:fixed;inset:0;z-index:-1;background:rgba(0,0,0,.25)}
</style></head><body data-we-wallpaper="on">
<div class="we-scrim"></div>
<script type="module">
import { weClampTo, weNow } from '/we-base.js';
// 光效层按**裸标识符**读这三样（内联后同作用域）⇒ 单文件导入时补到 globalThis 上。
globalThis.weClampTo = weClampTo;
globalThis.weNow = weNow;
// 满档设置 = 报告里最吃 GPU 的那组参数。
globalThis.selection = {
  fxEnabled: true, fxClick: true, fxTrail: true,
  fxClickStyle: 'both', fxTrailStyle: 'comet',
  fxClickSize: 140, fxClickGlow: 100, fxTrailLength: 2000, fxTrailWidth: 3,
  fxTrailGlow: 100, fxOpacity: 85, fxBlend: 'screen',
  fxColorMode: 'accent', fxColor: '#4f8cff',
};

function report(payload) {
  try {
    fetch('/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  } catch (e) { /* 回传失败 = 装置侧超时兜底 */ }
}

try {
  const fx = await import('/fx-layer.js');
  fx.syncFxLayer();
  const mounted = Boolean(document.getElementById('we-fx-layer'));

  const times = [];
  let i = 0, last = 0, n = 0;
  await new Promise((done) => {
    function tick(ts) {
      if (last) times.push(ts - last);
      last = ts;
      // 固定轨迹：横向扫过 + 周期性点击（同时压拖尾与点击两条路）。
      const x = 60 + (i * 7) % 1700;
      const y = 120 + (i * 11) % 800;
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
      if (i % 20 === 0) {
        document.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }));
      }
      i += 1; n += 1;
      if (n < ${FRAMES}) { requestAnimationFrame(tick); return; }
      done();
    }
    requestAnimationFrame(tick);
  });

  times.sort((a, b) => a - b);
  const pick = (q) => times[Math.min(times.length - 1, Math.floor(times.length * q))];
  let sum = 0;
  for (const t of times) sum += t;
  report({
    mounted, n: times.length,
    p50: pick(0.5), p95: pick(0.95), max: times[times.length - 1], mean: sum / times.length,
  });
} catch (e) {
  report({ error: String((e && e.stack) || e) });
}
</script>
</body></html>`;

let resolveResult = null;
const resultPromise = new Promise((res) => { resolveResult = res; });

const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/result') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.writeHead(204); res.end();
      let parsed;
      try { parsed = JSON.parse(body); } catch { parsed = { error: 'bad json: ' + body.slice(0, 200) }; }
      if (resolveResult) resolveResult(parsed);
    });
    return;
  }
  if (req.url.startsWith('/fx-layer.js')) {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    res.end(FX_SRC); return;
  }
  if (req.url.startsWith('/we-base.js')) {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    res.end(WE_BASE); return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});

// ⚠️ 必须先监听再启浏览器：漏掉这一行浏览器会拿到 connection refused，页面回传永远不来，
// 装置只会静默超时（踩过）。
await new Promise((res, rej) => {
  server.once('error', rej);
  server.listen(PORT, '127.0.0.1', res);
});

const profile = join(tmpdir(), 'fx-perf-' + Date.now());
const child = spawn(browser, [
  '--headless=new',
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--use-mock-keychain',
  '--disable-extensions', '--disable-crashpad',
  '--window-size=1920,1080',
  // ⚠️ 刻意**不**加 --disable-gpu：要量的就是绘制成本，软件光栅会把结论带偏。
  `http://127.0.0.1:${PORT}/`,
], { stdio: 'ignore' });

const timeout = new Promise((_, rej) => { setTimeout(() => rej(new Error('超时（60s 内没收到页面回传）')), 60000); });

try {
  const r = await Promise.race([resultPromise, timeout]);
  if (r.error) throw new Error('页面报错: ' + r.error);
  const f = (v) => (typeof v === 'number' ? v.toFixed(2) : String(v));
  console.log(`── ${LABEL} ──`);
  console.log(`  光效层已挂载   : ${r.mounted}`);
  console.log(`  采样帧数       : ${r.n}`);
  console.log(`  帧间隔 mean    : ${f(r.mean)} ms`);
  console.log(`  帧间隔 p50/p95 : ${f(r.p50)} / ${f(r.p95)} ms`);
  console.log(`  帧间隔 max     : ${f(r.max)} ms`);
  console.log(`  （60fps 的理想帧间隔 = 16.67ms；p95 明显高于它 = 掉帧）`);
} catch (e) {
  console.error(`── ${LABEL} ──`);
  console.error('  装置失败: ' + e.message);
  process.exitCode = 1;
} finally {
  try { child.kill(); } catch { /* ignore */ }
  server.close();
}
