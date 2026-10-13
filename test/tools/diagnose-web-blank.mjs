#!/usr/bin/env node
/**
 * diagnose-web-blank.mjs — 网页壁纸「白屏」排查台（无头真浏览器）。
 *
 * 用户报「某张网页壁纸白屏」时，先跑这个：它用**真实 Chromium 系浏览器**按 client 的
 * 真实 URL 形状挂载渲染页，等几秒后给你三样东西 ——
 *   1. 截图（`--shot`，默认 .test-cache/diagnose-web-blank/shot.png）：白不白一眼可见；
 *   2. 渲染页实况：`iframeLoaded` / `webError` / `webFps` / 内层 iframe 的 sandbox 与 src
 *      （src 是 blob: 说明走的是「fetch HTML → 注入 → blob 挂载」那条跨源路径）；
 *   3. 浏览器控制台里的报错。**沙箱内的异常只有这一条通道能看到** —— 壁纸 iframe 是
 *      不透明源，父页读不到它的 DOM，DevTools 的 Console 也不收录子文档的报错。
 *
 * 为什么需要它：白屏的成因彼此独立，光看「白」分不出是哪一类。已知的两类都靠这个台子
 * 定过案（都能在控制台里看到决定性一句）：
 *   · 不透明源里 `window.localStorage` 读取即抛 SecurityError（严格沙箱 = allow-scripts
 *     only），而工坊应用常在 useState 初始化里直读 → 首屏渲染崩 → 白屏（2905017768）；
 *   · 作者自带 `<base href="./">`（SPA/Angular 构建）→ blob 文档里 `.` 解析到 blob 自己
 *     → 相对子资源一个请求都发不出 → 白屏（上游 web-rewrite.ts 已修：就地改写相对 base）。
 *
 * 用法（环境变量）：
 *   WALL_ID=2905017768 node test/tools/diagnose-web-blank.mjs
 *   WALL_ROOT=/path/to/library WALL_ID=my-fixture node test/tools/diagnose-web-blank.mjs
 *   SHOT=/tmp/x.png FPS=30 WAIT_MS=14000 RENDERER_DIR=… node test/tools/diagnose-web-blank.mjs
 *
 *   WALL_ID      壁纸目录名（库存 id 的 up-dir- 之后那段）
 *   WALL_ROOT    壁纸库根目录（默认读插件 config.json 的 uploadDir）
 *   RENDERER_DIR 覆盖渲染页目录（A/B 对照用；空 = 插件 vendored 版）
 *   FPS          帧率上限（默认 30，与用户设置一致）
 *   WAIT_MS      等待毫秒（默认 14000；大壁纸冷启动慢，可加大）
 *   SHOT         截图输出路径
 *
 * 不碰 node_modules、不写插件数据目录；只在 .test-cache/ 下开一个隔离的迷你 host。
 */
import { createServer } from 'node:http';
import { mkdirSync, rmSync, readFileSync, existsSync, statSync, createReadStream, openSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WALL_ID = process.env.WALL_ID || '2905017768';
const FPS = process.env.FPS || '30';
const WAIT_MS = Number(process.env.WAIT_MS || 14000);
const RENDERER_DIR = process.env.RENDERER_DIR || '';
const MARKER = 'BLANK-' + process.pid;

const cfgPath = join(process.env.HOME, '.dsh-wallpaper-engine', 'config.json');
const WALL_ROOT = process.env.WALL_ROOT
  || (existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')).uploadDir : '')
  || join(process.env.HOME, 'Library/Application Support/io.github.oneincase.wallpaperem/wallpapers');
const WALL_DIR = join(WALL_ROOT, WALL_ID);
if (!existsSync(join(WALL_DIR, 'index.html'))) {
  console.error(`找不到壁纸入口：${join(WALL_DIR, 'index.html')}`);
  console.error('（custom storage 的网页壁纸目录里应有 index.html；用 WALL_ROOT/WALL_ID 指定）');
  process.exit(2);
}

const TEST_ROOT = join(root, '.test-cache', 'diagnose-web-blank');
rmSync(TEST_ROOT, { recursive: true, force: true });
mkdirSync(TEST_ROOT, { recursive: true });
process.env.DSH_WE_STEAM_ROOT = join(TEST_ROOT, 'steamlib');
mkdirSync(join(process.env.DSH_WE_STEAM_ROOT, 'steamapps', 'common', 'wallpaper_engine'), { recursive: true });
process.env.DSH_WE_CACHE_DIR = join(TEST_ROOT, 'cache');
process.env.DSH_WE_UPLOAD_DIR = WALL_ROOT;
// 假播放器 + 永不碰系统音频：排查白屏不需要媒体链路，也别弹授权
process.env.DSH_WE_MEDIA_PROVIDER = 'mock';
process.env.DSH_WE_MEDIA_NO_AUDIO = '1';

const DIAG_FILE = join(process.env.HOME, '.dsh-wallpaper-engine', 'diag', 'http.jsonl');
const DIAG_START = existsSync(DIAG_FILE) ? statSync(DIAG_FILE).size : 0;

console.log(`壁纸：${WALL_DIR}`);
console.log(`壁纸库：${WALL_ROOT}`);
console.log(`渲染页：${RENDERER_DIR || join(root, 'lib', 'webwallgl')}（cap=${FPS}fps）`);

// ── 迷你 host：与 e2e 同约定（exact 精确 / prefix 前缀 / 第一个匹配优先）────────
const routes = [];
const ctx = {
  webServer: {
    register(route) { routes.push(route); return () => { const i = routes.indexOf(route); if (i >= 0) routes.splice(i, 1); }; },
    tapIndex() { return () => {}; },
  },
};

// 渲染页目录可覆盖（A/B 用）：抢在插件路由之前注册，让匹配先命中它。
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
};
if (RENDERER_DIR) {
  routes.push({
    kind: 'prefix',
    path: '/wallpaper-engine/scene-live',
    handler(req, res) {
      const p = new URL(req.url || '/', 'http://x').pathname.slice('/wallpaper-engine/scene-live'.length);
      const rest = decodeURIComponent(p).replace(/^\/+/, '') || 'index.html';
      const abs = join(RENDERER_DIR, rest);
      if (!existsSync(abs) || !statSync(abs).isFile()) { res.statusCode = 404; res.end('nope'); return; }
      res.setHeader('Content-Type', MIME[extname(abs)] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      createReadStream(abs).pipe(res);
    },
  });
}

const hostMod = await import(pathToFileURL(join(root, 'lib', 'index.js')).href);
const host = hostMod.default || hostMod;
const dispose = (host.apply || host.inject)(ctx);

const matchRoute = (pathname) => routes.find((r) => (
  r.kind === 'exact' ? r.path === pathname : (pathname === r.path || pathname.startsWith(r.path + '/'))
));

let wrapperHtml = '';
const appServer = createServer((req, res) => {
  const pathname = new URL(req.url || '/', 'http://x').pathname;
  if (pathname === '/diag-host.html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(wrapperHtml);
    return;
  }
  const route = matchRoute(pathname);
  if (!route) { res.statusCode = 404; res.end('no route'); return; }
  Promise.resolve(route.handler(req, res)).catch(() => { try { res.statusCode = 500; res.end('handler error'); } catch { /* ignore */ } });
});
await new Promise((r) => { appServer.listen(0, '127.0.0.1', r); });
const APP = `http://127.0.0.1:${appServer.address().port}`;

// ── 库存 → 渲染页 URL（与 client 的 liveRenderUrl 同形） ──────────────────────
const inv = await (await fetch(`${APP}/wallpaper-engine/inventory`, { cache: 'no-store' })).json();
const target = (inv.wallpapers || []).find((w) => String(w.id) === `up-dir-${WALL_ID}` || String(w.id) === WALL_ID);
if (!target) {
  console.error(`库存里没有 ${WALL_ID}。可用 id 样例：`,
    (inv.wallpapers || []).slice(0, 8).map((w) => w.id).join(', '));
  try { if (dispose) dispose(); } catch { /* ignore */ }
  appServer.close();
  process.exit(2);
}
console.log(`库存条目：id=${target.id} type=${target.type} title=${target.title}`);
console.log(`webLiveSrc=${String(target.webLiveSrc || '').slice(0, 140)}`);

const rendererUrl = `${APP}/wallpaper-engine/scene-live/index.html?type=web&webSandbox=strict`
  + `&fit=cover&sceneFps=${FPS}&muted=true`
  + `&src=${encodeURIComponent(target.webLiveSrc)}`
  + `&mediaBase=${encodeURIComponent(`${APP}/wallpaper-engine/scene-files`)}`;

// ── 宿主页：嵌渲染页 + 轮询 __wp 实况，经 /diag 信标回传 ───────────────────────
wrapperHtml = `<!doctype html><html><head><meta charset="utf-8"><title>diagnose</title>`
  + `<style>html,body{margin:0;height:100%;background:#111}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style>`
  + `</head><body><script>`
  + `var f=document.createElement('iframe');f.src=${JSON.stringify(rendererUrl)};document.body.appendChild(f);`
  + `function beacon(msg){var i=new Image();i.src=${JSON.stringify(APP + '/wallpaper-engine/diag?msg=')} + encodeURIComponent(${JSON.stringify(MARKER + ' ')} + msg);}`
  + `window.onerror=function(m,s,l,c){beacon('HOSTERR '+m+' @'+l+':'+c);};`
  + `var n=0;var iv=setInterval(function(){n++;`
  + `var wp=null,st=null,stats='';`
  + `try{wp=f.contentWindow&&f.contentWindow.__wp;}catch(e){}`
  + `try{st=wp&&wp.getState?wp.getState():null;}catch(e){st={err:String(e&&e.message||e)};}`
  + `try{stats=JSON.stringify(f.contentWindow.__wpStats&&f.contentWindow.__wpStats.frame?f.contentWindow.__wpStats.frame():null);}catch(e){stats='ERR';}`
  + `var innerSandbox='',innerSrc='';`
  + `try{var inner=f.contentDocument&&f.contentDocument.body.querySelector('iframe');`
  + `if(inner){innerSandbox=String(inner.getAttribute('sandbox'));innerSrc=String(inner.getAttribute('src')||'').slice(0,70);}}catch(e){}`
  + `beacon('T'+n+' iframeLoaded='+(st&&st.iframeLoaded)+' webFps='+(st&&st.webFps)+' webError='+(st&&st.webError)`
  + `+' type='+(st&&st.type)+' stats='+stats+' innerSandbox='+innerSandbox+' innerSrc='+innerSrc);`
  + `if(n>=16)clearInterval(iv);},1000);`
  + `</script></body></html>`;

// ── 起浏览器（Chromium 系；与 e2e 同一份候选表）──────────────────────────────
const CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];
const browser = CANDIDATES.find((p) => existsSync(p));
if (!browser) { console.error('未找到 Chromium 系浏览器（Chrome / Edge / Chromium）'); process.exit(2); }
console.log(`浏览器：${browser}`);

const profile = join(TEST_ROOT, 'profile');
const errLog = join(TEST_ROOT, 'browser-stderr.log');
const shot = process.env.SHOT || join(TEST_ROOT, 'shot.png');
const errFd = openSync(errLog, 'w');
const child = spawn(browser, [
  '--headless=new',
  '--enable-unsafe-swiftshader',   // 无头下要软件 WebGL2
  // macOS：假钥匙串 —— 不给它，无头 Chromium 会去碰真钥匙串并弹「找不到…钥匙串」
  // 对话框（本机实测复现）；其他平台无害。
  '--use-mock-keychain',
  '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`,
  '--window-size=1280,720',
  '--enable-logging=stderr', '--v=1', '--log-level=0',
  `--screenshot=${shot}`,
  // 必须给虚拟时间预算：`--screenshot` 默认在 **load 完成时**就拍，而壁纸是渲染页
  // 之后才 fetch → 注入 → blob 挂载的（几百 ms 到几秒），没有预算就会拍到一张空页 ——
  // 看起来像「白屏」其实只是拍早了（踩过一次）。
  '--virtual-time-budget=9000',
  `${APP}/diag-host.html`,
], { stdio: ['ignore', 'ignore', errFd] });

console.log(`已启动（pid ${child.pid}），等 ${WAIT_MS} ms …`);
await new Promise((r) => { setTimeout(r, WAIT_MS); });
try { child.kill('SIGKILL'); } catch { /* ignore */ }
await new Promise((r) => { setTimeout(r, 300); });

// ── 读回：本次新增的诊断 + 浏览器控制台 ──────────────────────────────────────
console.log('\n· 渲染页实况（每秒一条）');
if (existsSync(DIAG_FILE)) {
  const slice = readFileSync(DIAG_FILE, 'utf8').slice(DIAG_START);
  for (const ln of slice.split('\n')) {
    if (!ln.includes(MARKER)) continue;
    try {
      const d = JSON.parse(ln);
      console.log('   ' + String(d.msg || '').replace(MARKER + ' ', '').slice(0, 300));
    } catch { /* ignore */ }
  }
  console.log('\n· 本次新增的其它诊断（req / fence / renderer / client）');
  let any = false;
  for (const ln of slice.split('\n')) {
    if (!ln.trim() || ln.includes(MARKER)) continue;
    let d; try { d = JSON.parse(ln); } catch { continue; }
    if (!['req', 'fence', 'http', 'renderer', 'client'].includes(d.kind)) continue;
    any = true;
    console.log('   ' + JSON.stringify({
      kind: d.kind, event: d.event, route: d.route, status: d.status, dest: d.dest,
      detail: String(d.detail || '').slice(0, 90), msg: String(d.msg || '').slice(0, 160),
    }));
  }
  if (!any) console.log('   （无）');
}

console.log('\n· 浏览器控制台（只列可疑行）');
if (existsSync(errLog)) {
  const lines = readFileSync(errLog, 'utf8').split('\n');
  const hit = lines.filter((l) => /CONSOLE|SecurityError|Uncaught|NotAllowedError|Failed to (read|set)|Access is denied|insecure/i.test(l));
  for (const l of hit.slice(0, 30)) console.log('   ' + l.slice(0, 320));
  if (!hit.length) console.log(`   （无可疑行；stderr 共 ${lines.length} 行）`);
}

const shotSize = existsSync(shot) ? statSync(shot).size : 0;
console.log(`\n· 截图：${shot}（${Math.round(shotSize / 1024)}KB）`);
if (shotSize) {
  console.log(`  体积判读：${shotSize < 20000 ? '⚠ 很小 —— 大概率白屏/空白' : '正常（有内容）'}`);
  console.log('  注意体积只是粗判：画面本身接近纯色的壁纸也会很小，务必**亲眼看图**。');
}

try { if (dispose) dispose(); } catch { /* ignore */ }
appServer.close();
process.exit(0);
