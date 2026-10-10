#!/usr/bin/env node
/**
 * e2e-web-media-origin.mjs — 真浏览器端到端：网页壁纸跑在独立媒体源上。
 *
 * 为什么要有这一层（verify-scene-live.mjs 覆盖不到的部分）：
 *   C4 证明媒体源在真实 socket 上服务正确，但它不证明**渲染页真的能把它挂进沙箱
 *   iframe 并跑起来**。这条链路只有真浏览器说得清，而它正是「网页壁纸全黑」的现场形态：
 *   DSH Desktop 的能力头（x-dsh-desktop-renderer）栅栏只放行同源 frame，
 *   严格沙箱 iframe 是不透明源 → 插件路由一律 403 → 载荷必须由 host 自建的独立
 *   loopback 源提供（见 lib/index.js 的 ensureMediaOrigin）。
 *
 * 做法：迷你 host（node:http 实现 DSH 的 webServer 契约：exact / prefix 路由）
 *   + 合成蒸汽库里的一个网页壁纸 + 真实 Chromium 系浏览器加载渲染页。
 *   所有判据都由**页面自己**经 `/diag` 信标回传（无需 CDP）：
 *     ran=1        壁纸文档里的脚本真的执行了
 *     shim=1       宿主注入的 WE shim 在位（严格沙箱下 shim 必须随文档到达）
 *     propsCalls≥1 宿主注入的属性种子到达作者（漏掉它 = 依赖属性的壁纸画成默认/黑屏）
 *     fps=15       渲染页经 postMessage 通道下发的 setFps 到达作者（跨源控制通道活着）
 *
 * 不属于 npm run verify —— 它需要本机有 Chromium 系浏览器。
 * Usage: node test/e2e-web-media-origin.mjs
 */

import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEST_ROOT = join(root, '.test-cache', 'e2e-media-origin');
const STEAM_ROOT = join(TEST_ROOT, 'steamlib');
process.env.DSH_WE_STEAM_ROOT = STEAM_ROOT;
process.env.DSH_WE_CACHE_DIR = join(TEST_ROOT, 'cache');
process.env.DSH_WE_UPLOAD_DIR = join(TEST_ROOT, 'uploads');

const DIAG_FILE = join(process.env.HOME || '', '.dsh-wallpaper-engine', 'diag', 'http.jsonl');
const DEBUG = process.env.E2E_DEBUG === '1';   // 打印迷你 host 的每条请求与本次新增的全部诊断行
const MARKER = 'E2E-WEB-' + process.pid;
// 媒体后端用中间件自带的假播放器：**不需要真播放器、也不会弹「音频录制」授权**
//（DSH_WE_MEDIA_NO_AUDIO=1 让宿主只取元数据、永不碰系统音频采集）。
process.env.DSH_WE_MEDIA_PROVIDER = 'mock';
process.env.DSH_WE_MEDIA_NO_AUDIO = '1';

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) passed++; else failed++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
}

// ── 合成蒸汽库：一个网页壁纸（project.json + index.html + preview）──────────
const webDir = join(STEAM_ROOT, 'steamapps', 'workshop', 'content', '431960', '990101');
rmSync(TEST_ROOT, { recursive: true, force: true });
mkdirSync(webDir, { recursive: true });
mkdirSync(join(STEAM_ROOT, 'steamapps', 'common', 'wallpaper_engine'), { recursive: true });
writeFileSync(join(webDir, 'project.json'), JSON.stringify({
  title: 'E2E Web Wallpaper',
  type: 'web',
  file: 'index.html',
  preview: 'preview.jpg',
  contentrating: 'Everyone',
  // 属性种子：host 必须把它注入 HTML（严格沙箱下渲染页无法运行时补推）
  general: { properties: { color0: { order: 0, type: 'color', value: '0.2 0.7 0.4' } } },
}));
writeFileSync(join(webDir, 'preview.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

// ── 迷你 host：实现 DSH 的 webServer 契约（exact / prefix）───────────────────
const routes = [];
const ctx = {
  webServer: {
    register(route) { routes.push(route); return () => { const i = routes.indexOf(route); if (i >= 0) routes.splice(i, 1); }; },
    tapIndex() { return () => {}; },
  },
};
const hostMod = await import(pathToFileURL(join(root, 'lib', 'index.js')).href);
const host = hostMod.default || hostMod;
// 期望的中间件版本从产物钉推导，不写字面量 —— 否则每次升 TAG 都要回来改断言
// （**实测**：只改产物不改断言时，跑的是新产物、断言还钉着上一个版本号 ⇒ 假红）。
const { MEDIA_BRIDGE_TAG } = await import(pathToFileURL(join(root, 'lib', 'media', 'provision.js')).href);
const WANT_BRIDGE_VERSION = MEDIA_BRIDGE_TAG.replace(/^v/, '');
const dispose = (host.apply || host.inject)(ctx);

const matchRoute = (pathname) => routes.find((r) => (
  r.kind === 'exact' ? r.path === pathname : (pathname === r.path || pathname.startsWith(r.path + '/'))
));
// 宿主页（等价于插件 client 的那半边）：嵌渲染页 + 就绪后推一次媒体快照。
// 有它才能测「封面/歌名能不能穿过沙箱到达壁纸」—— 直接开渲染页没法调 __wp.setMedia。
let wrapperHtml = '';
// 插件真实 CSS（样式表模块里的模板字面量）——布局断言必须在真 CSS 上做，
// 否则「抽屉里按钮上下排列、间距 8px」这种要求测了等于没测。
// ⚠️ 取模板用**行首锚定（容忍缩进）**：散文里出现同样的声明字面量会把锚点带偏。
const pluginCss = (() => {
  const srcText = readFileSync(join(root, 'src', 'styles.js'), 'utf8');
  const m = /^\s*const CSS = `([^`]*)`;/m.exec(srcText);
  return m ? m[1] : '';
})();
if (!pluginCss.includes('.we-picker__current')) {
  console.log('  ! 未能从 src/client.js 提取插件 CSS，布局断言会跳过');
}
const appServer = createServer((req, res) => {
  const pathname = new URL(req.url || '/', 'http://x').pathname;
  if (DEBUG) console.log(`[host] ${req.method} ${pathname}${req.url.indexOf('?') >= 0 ? '?…' : ''}`);
  if (pathname === '/e2e/host.html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(wrapperHtml || '<!doctype html><title>no recipe</title>');
    return;
  }
  if (pathname === '/e2e/base.html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(baseWrapperHtml || '<!doctype html><title>no base recipe</title>');
    return;
  }
  const route = matchRoute(pathname);
  if (!route) { res.statusCode = 404; res.end('no route'); return; }
  Promise.resolve(route.handler(req, res)).catch(() => { try { res.statusCode = 500; res.end('handler error'); } catch { /* ignore */ } });
});
await new Promise((r) => appServer.listen(0, '127.0.0.1', r));
const appPort = appServer.address().port;
const APP = `http://127.0.0.1:${appPort}`;
console.log(`迷你 host 监听 ${APP}（${routes.length} 条路由）`);

// ── 合成夹具 2：自带 <base href="./"> 的 SPA（白屏回归）────────────────────────
// 跨源入口是经 **blob URL** 挂载的，blob 没有目录概念：作者自带的相对 base 会让相对
// 子资源解析到 blob 自己 ⇒ 一个请求都发不出 ⇒ 整页白屏（SPA/Angular 构建常自带
// `<base href="./">`；CRA 不带）。修法是挂载改写时**就地换掉相对 base**，绝对 base
// 保留不动（见上游 renderer/src/web-rewrite.ts）。
// 这个夹具的可见内容**全部**由相对路径脚本产出，所以「脚本跑了」就等于 base 解析对了；
// 而「谁能解析」是浏览器行为，字符串断言测不出来 —— 必须真浏览器跑。
const baseDir = join(STEAM_ROOT, 'steamapps', 'workshop', 'content', '431960', '990102');
mkdirSync(join(baseDir, 'static'), { recursive: true });
writeFileSync(join(baseDir, 'project.json'), JSON.stringify({
  title: 'E2E Base Tag Wallpaper',
  type: 'web',
  file: 'index.html',
  preview: 'preview.jpg',
  contentrating: 'Everyone',
}));
writeFileSync(join(baseDir, 'preview.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
writeFileSync(join(baseDir, 'index.html'), [
  '<!doctype html><html lang="en"><head><meta charset="utf-8">',
  '<base href="./">',
  '<title>base</title>',
  '<script defer="defer" src="./static/app.js"></script>',
  '</head><body><div id="root"></div></body></html>',
].join('\n'));
writeFileSync(join(baseDir, 'static', 'app.js'), [
  'document.body.style.background = "#0b2b1a";',
  'document.getElementById("root").textContent = "APP JS RAN";',
  // 回传两个判据：脚本真的执行了；document.baseURI 指到媒体源入口目录（改写生效）
  'var i = new Image();',
  `i.src = ${JSON.stringify(APP)} + '/wallpaper-engine/diag?msg=' + encodeURIComponent(`,
  `  ${JSON.stringify(MARKER + ' BASEFIX ran=1 base=')} + document.baseURI +`,
  `  ${JSON.stringify(' href=')} + String(location.href).slice(0, 40));`,
  'var n = 0; (function loop(){ n++; document.title = "frames " + n; requestAnimationFrame(loop); })();',
].join('\n'));

// 帧间隔度量（页面侧算、Node 侧判）。**同一份源码**既注入页面、也用于下面的判据自检
// （`new Function(FPS_METRIC_JS)`）—— 度量与判据各写一份是这类测试最容易烂的地方。
// `nSlow` 只数**迟到**的帧（超过中位 25ms），方向与 `p95 - p50` 一致但不受单个离群值支配；
// `maxOf` 只记录。
const FPS_METRIC_JS = [
  '  function pct(a, q) {',
  '    if (!a.length) return 0;',
  '    var c = a.slice().sort(function (x, y) { return x - y; });',
  '    return Math.round(c[Math.min(c.length - 1, Math.floor(c.length * q))]);',
  '  }',
  '  function nSlow(a) {',
  '    var p = pct(a, 0.5), c = 0;',
  '    for (var i = 0; i < a.length; i++) if (a[i] - p > 25) c++;',
  '    return c;',
  '  }',
  '  function maxOf(a) {',
  '    var m = 0;',
  '    for (var i = 0; i < a.length; i++) if (a[i] > m) m = a[i];',
  '    return Math.round(m);',
  '  }',
].join('\n');

// 壁纸 HTML：把判据回传给宿主的 /diag（<img> 信标，免 CORS）。
writeFileSync(join(webDir, 'index.html'), [
  '<!doctype html><html><head><meta charset="utf-8"><title>e2e</title>',
  '<style>html,body{margin:0;background:#123}</style></head><body>',
  '<script>',
  '  window.__e2e = { propsCalls: 0, fps: null, vol: null, keys: [], frames: 0,',
  '                  mediaTitle: "", mediaThumb: "", mediaImg: "none", mediaState: null,',
  '                  mediaAA: "", mtlPos: null, mtlDur: null, ls: "?" };',
  // 不透明源（严格沙箱）里 window.localStorage 的**读取本身**抛 SecurityError，而工坊
  // 应用常在 useState 初始化里直读 → 首屏渲染崩 → 整页白屏（2905017768 Bocchi 实测）。
  // shim 在作者脚本前换成内存实现，这条断言就是它的真浏览器闸门。
  '  try { window.localStorage.setItem("e2e", "1"); window.__e2e.ls = "ok:" + window.localStorage.getItem("e2e"); }',
  '  catch (e) { window.__e2e.ls = "throw:" + (e && e.name); }',
  // 媒体三件套（WE 官方 API）：属性 / 封面 / 播放态。封面不仅看字符串，
  // 还真的 new Image() 加载一次 —— 「data URL 到位」与「能显示」是两回事。
  '  if (window.wallpaperRegisterMediaPropertiesListener) {',
  '    window.wallpaperRegisterMediaPropertiesListener(function (e) {',
  '      window.__e2e.mediaTitle = ((e && e.title) || "").replace(/\\s+/g, "_");',
  // albumArtist：内置实现给不出这个字段，中间件才给 —— 壁纸要能收到
  '      window.__e2e.mediaAA = ((e && e.albumArtist) || "").replace(/\\s+/g, "_");',
  '    });',
  '  }',
  '  if (window.wallpaperRegisterMediaThumbnailListener) {',
  '    window.wallpaperRegisterMediaThumbnailListener(function (e) {',
  '      var t = (e && e.thumbnail) || "";',
  '      window.__e2e.mediaThumb = t;',
  '      if (!t) { window.__e2e.mediaImg = "none"; return; }',
  '      window.__e2e.mediaImg = "loading";',
  '      var im = new Image();',
  '      im.onload = function () { window.__e2e.mediaImg = "ok:" + im.naturalWidth + "x" + im.naturalHeight; };',
  '      im.onerror = function () { window.__e2e.mediaImg = "err"; };',
  '      im.src = t;',
  '    });',
  '  }',
  '  if (window.wallpaperRegisterMediaPlaybackListener) {',
  '    window.wallpaperRegisterMediaPlaybackListener(function (e) {',
  '      window.__e2e.mediaState = e && e.state;',
  '    });',
  '  }',
  // 时间轴：进度/时长。内置实现在 Linux 上给不出这两个值（playerctl 那路没有），
  // 中间件三平台都有 —— 所以这条断言同时守着「字段真的送到了」。
  '  if (window.wallpaperRegisterMediaTimelineListener) {',
  '    window.wallpaperRegisterMediaTimelineListener(function (e) {',
  '      window.__e2e.mtlPos = Math.round(((e && e.position) || 0) * 10) / 10;',
  '      window.__e2e.mtlDur = Math.round(((e && e.duration) || 0) * 10) / 10;',
  '    });',
  '  }',
  '  window.wallpaperPropertyListener = {',
  '    applyUserProperties: function (p) {',
  '      window.__e2e.propsCalls++;',
  '      window.__e2e.keys = Object.keys(p || {});',
  '      if (p && p.color0) window.__e2e.color0 = String(p.color0.value).replace(/\\s+/g, "_");',
  '    },',
  '    applyGeneralProperties: function (p) {',
  '      if (p && typeof p.fps === "number") window.__e2e.fps = p.fps;',
  '      if (p && typeof p.volume === "number") window.__e2e.vol = p.volume;',
  '    },',
  '  };',
  '  window.__e2e.iv = [];',
  '  (function loop() {',
  '    var t = performance.now();',
  '    var iv = window.__e2e.iv;',
  '    if (window.__e2e.last) { iv.push(t - window.__e2e.last); if (iv.length > 60) iv.shift(); }',
  '    window.__e2e.last = t;',
  '    window.__e2e.frames++;',
  '    requestAnimationFrame(loop);',
  '  })();',
  FPS_METRIC_JS,
  '  function beacon(tag) {',
  '    var e = window.__e2e;',
  '    var img = new Image();',
  `    img.src = "${APP}/wallpaper-engine/diag?msg=" + encodeURIComponent(`,
  `      "${MARKER} " + tag`,
  '      + " ran=1 shim=" + (typeof window.__weSeedProps === "function" ? 1 : 0)',
  '      + " propsCalls=" + e.propsCalls + " fps=" + e.fps + " vol=" + e.vol',
  '      + " frames=" + e.frames + " keys=" + e.keys.join(",")',
  '      + " p50=" + pct(e.iv, 0.5) + " p95=" + pct(e.iv, 0.95) + " n=" + e.iv.length',
  '      + " nSlow=" + nSlow(e.iv) + " max=" + maxOf(e.iv)',
  '      + " media=" + e.mediaTitle + " thumb=" + e.mediaThumb.length',
  '      + " aa=" + e.mediaAA + " mtl=" + e.mtlPos + "," + e.mtlDur',
  '      + " img=" + e.mediaImg + " mstate=" + e.mediaState',
  '      + " ls=" + e.ls',
  '      + " prop0=" + (e.color0 || ""));',
  '  }',
  '  window.addEventListener("load", function () {',
  '    setTimeout(function () { beacon("load"); }, 900);',
  '    setTimeout(function () { beacon("late"); }, 3200);',
  // 媒体快照在渲染页就绪后才推（~1–2s），再晚一点收一次
  '    setTimeout(function () { beacon("media"); }, 6500);',
  '  });',
  '</script></body></html>',
].join('\n'));

// ── 拿 inventory → 组出与 client 完全一致的渲染页 URL ────────────────────────
// 带能力头：本 e2e 的立意就是**有栅栏的桌面端现场**（网页壁纸载荷必须由独立媒体源
// 提供）。裸请求（原生浏览器）走应用源那一档由 test/verify-adapter.mjs 断言。
const invRes = await fetch(`${APP}/wallpaper-engine/inventory`, {
  cache: 'no-store',
  headers: { 'x-dsh-desktop-renderer': '1' },
});
const inv = await invRes.json();
const web = (inv.wallpapers || []).find((w) => w.id === '990101') || null;
check('inventory 列出网页壁纸且 webLiveSrc 是绝对 URL',
  Boolean(web && web.webLive === true && /^http:\/\/127\.0\.0\.1:\d+\//.test(String(web.webLiveSrc || ''))),
  web ? String(web.webLiveSrc || '').slice(0, 60) : 'not found');
if (!web) { try { dispose && dispose(); } catch { /* ignore */ } appServer.close(); process.exit(1); }

const rendererUrl = `${APP}/wallpaper-engine/scene-live/index.html?type=web&webSandbox=strict`
  + `&fit=cover&sceneFps=15&muted=true`
  + `&src=${encodeURIComponent(web.webLiveSrc)}`
  + `&mediaBase=${encodeURIComponent(`${APP}/wallpaper-engine/scene-files`)}`;
console.log(`渲染页 URL: ${rendererUrl.slice(0, 140)}…`);
// 夹具 2 的渲染页 URL（自带 <base href="./"> 的那张）。**单独开一次浏览器运行**：
// 同一页里跑两个渲染页 + 软件 GL 会把主运行的 rAF 节奏带偏（实测 p50 从 67ms 变
// 33ms），而下面有几条断言正是拿帧间隔当判据的。
const baseWall = (inv.wallpapers || []).find((w) => w.id === '990102') || null;
check('inventory 也列出带 <base> 的夹具（否则下面的回归断言无从谈起）', Boolean(baseWall),
  baseWall ? String(baseWall.webLiveSrc || '').slice(0, 60) : 'not found');
const baseRendererUrl = baseWall
  ? `${APP}/wallpaper-engine/scene-live/index.html?type=web&webSandbox=strict`
    + `&fit=cover&sceneFps=15&muted=true`
    + `&src=${encodeURIComponent(baseWall.webLiveSrc)}`
    + `&mediaBase=${encodeURIComponent(`${APP}/wallpaper-engine/scene-files`)}`
  : '';
let baseWrapperHtml = '';
// 1x1 JPEG（合法最小图）：模拟 client 把宿主封面降采样成的 data URL。
const THUMB_DATA_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
baseWrapperHtml = baseRendererUrl
  ? `<!doctype html><html><head><meta charset="utf-8"><title>e2e base host</title>`
    + `<style>html,body{margin:0;height:100%;background:#111}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style>`
    + `</head><body><iframe src=${JSON.stringify(baseRendererUrl)}></iframe></body></html>`
  : '';
// ── 产品侧判据来源：抽屉「当前壁纸」卡片的主操作区 ────────────────────────────
// 期望值必须取自**产品源码**：镜像 DOM 里的按钮数是本测试自己摆的（镜像按构造各放 1 个
// `.we-picker__btn` ⇒ `acSingle` 恒为 1，产品把「壁纸属性」退回卡片也照样绿）。
// 口径：按产品源码里
// `React.createElement(<scope 所在的那个元素>, {…})` 的 `(`…`)` 括号平衡定位目标元素，
// 再数它的**直接子元素**（括号深度 1）里有多少个 `React.createElement("button"`。
// 深度 2 起的按钮（子容器里的）不算 —— 否则子容器塞满按钮也能把"只剩 1 枚"顶回绿。
// 扫描器在字符串/模板串/注释里不认括号，源码里中文文案带的括号不会把深度带偏。
function extractScopeText(src, scope) {
  const s = String(src == null ? '' : src);
  const anchor = s.indexOf(scope);
  if (anchor < 0) return null;
  const CALL = 'React.createElement(';
  // scope 是 props 对象里的一行；props 对象以 `{` 开头，它前面几个字符必然是目标元素的
  // `React.createElement("<tag>",` —— 用这个前缀把目标元素的调用和子按钮的调用区分开。
  const brace = s.lastIndexOf('{', anchor);
  if (brace < 0) return null;
  const head = s.slice(Math.max(0, brace - 60), brace);
  const owner = head.lastIndexOf(CALL);
  // 目标元素这一层的 `(` 后面只会是元素名和它的 props 对象（`"div", ` / `div, `），
  // 子按钮那一层不是（它前面还有别的实参或 props 里的引号）—— 用这个把两层区分开。
  if (owner < 0 || !/(?:\)|,)\s*$/.test(head.slice(owner + CALL.length))) return null;
  const callAt = Math.max(0, brace - 60) + owner;
  const open = s.indexOf('(', callAt);
  if (open < 0 || open > brace) return null;
  let depth = 1, quote = '', lineC = false, blockC = false, i = open + 1;
  for (; i < s.length; i++) {
    const ch = s[i], nx = s[i + 1];
    if (lineC) { if (ch === '\n') lineC = false; continue; }
    if (blockC) { if (ch === '*' && nx === '/') { blockC = false; i++; } continue; }
    if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = ''; continue; }
    if (ch === '/' && nx === '/') { lineC = true; i++; continue; }
    if (ch === '/' && nx === '*') { blockC = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '(' || ch === '{') depth++;
    else if (ch === ')' || ch === '}') { depth--; if (depth === 0) break; }
  }
  // 返回目标元素的那次 `createElement("…", {…}, 子元素…)` 整段：深度 0 是目标元素自己，
  // 深度 1 才是它的直接子元素（计数在下面按深度过滤）。
  return depth === 0 ? s.slice(open, i) : null;
}
// 找 `React.createElement(` 这次调用的收尾 `)`（括号平衡；字符串/注释里的括号不参与）。
function elementCallEnd(src, callAt) {
  const open = src.indexOf('(', callAt);
  if (open < 0) return -1;
  let depth = 1, quote = '', lineC = false, blockC = false, i = open + 1;
  for (; i < src.length; i++) {
    const ch = src[i], nx = src[i + 1];
    if (lineC) { if (ch === '\n') lineC = false; continue; }
    if (blockC) { if (ch === '*' && nx === '/') { blockC = false; i++; } continue; }
    if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = ''; continue; }
    if (ch === '/' && nx === '/') { lineC = true; i++; continue; }
    if (ch === '/' && nx === '*') { blockC = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '(' || ch === '{') depth++;
    else if (ch === ')' || ch === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}
function productPrimaryActions(src, scope, element = 'button') {
  const text = extractScopeText(src, scope);
  if (text === null) return null;
  const want = 'React.createElement("' + element + '"';
  let depth = 0, quote = '', lineC = false, blockC = false, n = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], nx = text[i + 1];
    if (lineC) { if (ch === '\n') lineC = false; continue; }
    if (blockC) { if (ch === '*' && nx === '/') { blockC = false; i++; } continue; }
    if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = ''; continue; }
    if (ch === '/' && nx === '/') { lineC = true; i++; continue; }
    if (ch === '/' && nx === '*') { blockC = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (depth === 1 && text.startsWith(want, i)) n++;
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') depth--;
  }
  return n;
}
// 产品里真正画这张卡片的是 src/panel-tabs.js:79 的 `we-picker__current-actions`（抽屉/弹窗两种
// 形态共用），主操作区里就一枚「选择壁纸」。镜像 DOM 只是把这枚按钮照抄了一份，所以判据必须
// 落在产品源码上，别落在镜像的字面量上。
const PRODUCT_DRAWER_ACTIONS_SCOPE = 'className: "we-picker__current-actions"';
const productDrawerPanelSrc = readFileSync(join(root, 'src', 'panel-tabs.js'), 'utf8');
const productDrawerActions = (expected) => productPrimaryActions(productDrawerPanelSrc, PRODUCT_DRAWER_ACTIONS_SCOPE) === expected;
// 对照用的另一个真来源：快捷面板的**播放控制行**也叫 actions（`we-qp__current-actions`，
// 里面是暂停/刷新/清除三枚）。判据只在目标 scope 上生效 ⇒ 数它必须是 3 而不是 1，
// 顺带证明计数器不是"读到谁都返回同一个数"。
const PRODUCT_QP_ACTIONS_SCOPE = 'className: "we-qp__current-actions"';
const productQuickPanelSrc = readFileSync(join(root, 'src', 'quick-panel.js'), 'utf8');

wrapperHtml = `<!doctype html><html><head><meta charset="utf-8"><title>e2e host</title>`
  + `<style>html,body{margin:0;height:100%;background:#111}iframe.we-live{position:fixed;inset:0;width:100%;height:100%;border:0}</style>`
  + `</head><body><script>`
  + `var f=document.createElement('iframe');f.className='we-live';f.src=${JSON.stringify(rendererUrl)};document.body.appendChild(f);`
  + `var tries=0;var timer=setInterval(function(){tries++;var wp=null,st=null;`
  + `try{wp=f.contentWindow&&f.contentWindow.__wp;}catch(e){}`
  + `try{st=wp&&wp.getState?wp.getState():null;}catch(e){}`
  + `if(st&&st.iframeLoaded){clearInterval(timer);`
  + `var pushErr='';`
  // 推的字段对齐 client 的真实 wire：albumArtist + 歌词（[[秒,文本]]）+ 进度。
  // 歌词放在 0s 与 8s 两行、position=5（渲染页只认这种元组，自己按 position 取当前行）。
  + `try{wp.setMedia({hasMedia:true,title:'E2E Song',artist:'E2E Artist',album:'E2E Album',`
  + `albumArtist:'E2E AlbumArtist',playing:true,state:1,position:5,duration:100,`
  + `lyrics:[[0,'line1'],[8,'line2']],thumbnail:${JSON.stringify(THUMB_DATA_URL)}});}catch(e){pushErr=String(e&&e.message||e);}`
  + `(function(){var im=new Image();im.src='${APP}/wallpaper-engine/diag?msg='+encodeURIComponent('${MARKER} SETMEDIA push='+(pushErr?('err:'+pushErr):'ok')+' hasFn='+(typeof wp.setMedia)+' type='+(st.type||''));})();`
  + `setTimeout(function(){try{wp.updateWebProps({color0:{value:'0 1 0'}});}catch(e){}},1200);return;}`
  + `if(tries>60)clearInterval(timer);},250);`
  // ── 卡片布局对照（真实 CSS + 镜像标记）：抽屉里名称独占首行、两个按钮上下
  //    排列且间距 8px；宽容器里两个按钮并排。测的是 computed geometry。
  + `</script>`
  + `<style>${pluginCss}</style>`
  + `<div class="we-repo-panel" id="e2e-drawer" style="transform:none">`
  + `<div class="we-picker__section"><div class="we-picker__current">`
  + `<div class="we-vinyl"><span class="we-vinyl__hole"></span></div>`
  + `<div class="we-picker__current-info">`
  + `<div class="we-picker__current-title"><span class="we-picker__current-name">一个特别长的壁纸名称用来压出省略号效果</span><span class="we-picker__current-meta">场景壁纸（实时渲染） · 播放中</span></div>`
  + `<div class="we-picker__current-sub"></div>`
  + `</div>`
  + `<div class="we-picker__current-actions">`
  + `<button class="we-picker__btn we-picker__btn--primary">选择壁纸</button>`
  + `</div></div></div></div>`
  + `<div id="e2e-wide" style="position:fixed;left:0;top:0;width:720px">`
  + `<div class="we-picker__section"><div class="we-picker__current">`
  + `<div class="we-vinyl"><span class="we-vinyl__hole"></span></div>`
  + `<div class="we-picker__current-info">`
  + `<div class="we-picker__current-title"><span>音域回响</span><span class="we-picker__current-meta">网页壁纸 · 播放中</span></div>`
  + `<div class="we-picker__current-sub"></div>`
  + `</div>`
  + `<div class="we-picker__current-actions">`
  + `<button class="we-picker__btn we-picker__btn--primary">选择壁纸</button>`
  + `</div></div></div></div>`
  + `<script>`
  + `function measureCard(scope){`
  + `var card=scope.querySelector('.we-picker__current');`
  + `var root=card.getBoundingClientRect();`
  + `var tl=card.querySelector('.we-picker__current-title');`
  + `var wm=document.getElementById('e2e-wide').querySelector('.we-picker__current-meta');`
  + `var t=tl.getBoundingClientRect();`
  + `var v=card.querySelector('.we-vinyl').getBoundingClientRect();`
  + `var bs=card.querySelectorAll('.we-picker__current-actions .we-picker__btn');`
  + `var a=bs[0].getBoundingClientRect();`
  + `var m=card.querySelector('.we-picker__current-meta');`
  + `var ms=getComputedStyle(m), ts=getComputedStyle(tl);`
  + `var parens=(String(ms.content).indexOf('（')>=0||String(getComputedStyle(m,'::before').content).indexOf('（')>=0)?1:0;`
  + `var oneLine=tl.getBoundingClientRect().height<=parseFloat(ts.fontSize)*2.0?1:0;`
  + `var clipped=tl.scrollWidth>tl.clientWidth+1?1:0;`
  + `return {acs:(bs.length===1)?1:0,titleAbove:t.top<v.top?1:0,`
  + `metaDisplay:ms.display,parens:parens,oneLine:oneLine,clipped:clipped,wideMeta:getComputedStyle(wm).display,`
  + `titleAlign:ts.textAlign};`
  + `}`
  + `setTimeout(function(){`
  + `var d=measureCard(document.getElementById('e2e-drawer'));`
  + `var w=measureCard(document.getElementById('e2e-wide'));`
  + `var img=new Image();`
  + `img.src='${APP}/wallpaper-engine/diag?msg='+encodeURIComponent('${MARKER} LAYOUT drawerTitleAbove='+d.titleAbove+' acSingle='+d.acs`
  + `+' metaInline='+(d.metaDisplay==='inline'?1:0)+' parens='+d.parens+' oneLine='+d.oneLine+' clipped='+d.clipped+' wideMetaBlock='+(w.wideMeta==='block'?1:0)`
  + `+' titleCenter='+(d.titleAlign==='center'?1:0)+' wideTitleAlign='+w.titleAlign);`
  + `},1500);`
  + `</script></body></html>`;

// ① 产品侧（真源码，不是镜像 DOM）：抽屉卡片的主操作容器里**直接子元素**只剩 1 枚按钮。
//    回归（"壁纸属性"退回卡片、又变成两个按钮、或按钮被换掉）⇒ 计数变了 ⇒ 红。
//    下面镜像 DOM 里的 `acSingle` 只在**产品源码这一关之后**才有意义（它只证明"渲染出来的
//    几何与真 CSS 一致"，不再兼任"按钮个数"的唯一来源）。
check('产品源码：抽屉「当前壁纸」卡片主操作区只剩 1 个按钮',
  productDrawerActions(1),
  'panel-tabs.js 卡片主操作按钮 = ' + productPrimaryActions(productDrawerPanelSrc, PRODUCT_DRAWER_ACTIONS_SCOPE)
    + '（期望 1），quick-panel.js 播放控制行 = ' + productPrimaryActions(productQuickPanelSrc, PRODUCT_QP_ACTIONS_SCOPE)
    + '（期望 3，证明计数器按 scope 生效）；镜像 DOM 里的 acSingle 只作几何对照');
// ② 对照（同一具名判据、合成输入）：计数必须对**结构**敏感，而不是"能读出 1 就恒真"。
//    三个合成输入都以真源码为底，只改目标容器，保证判据对象是产品源码而不是测试自己的字面量：
//      空容器（去掉那枚按钮）        ⇒ 0
//      同深度兄弟按钮（多一枚）      ⇒ 2
//      子容器里的按钮（深度 2 的）   ⇒ 仍 1（它不算"主操作区"的子元素）
{
  const scopeAt = productDrawerPanelSrc.indexOf(PRODUCT_DRAWER_ACTIONS_SCOPE);
  const brace = productDrawerPanelSrc.lastIndexOf('{', scopeAt);
  let j = brace + 1, bd = 1;
  while (j < productDrawerPanelSrc.length && bd > 0) {
    if (productDrawerPanelSrc[j] === '{') bd++;
    else if (productDrawerPanelSrc[j] === '}') bd--;
    j++;
  }
  const firstChild = productDrawerPanelSrc.indexOf('React.createElement(', j);   // 容器第一个子元素
  const firstButton = productDrawerPanelSrc.indexOf('React.createElement("button"', j);
  const ind = firstChild < 0 ? '' : productDrawerPanelSrc.slice(productDrawerPanelSrc.lastIndexOf('\n', firstChild) + 1, firstChild);
  // 空容器：整段摘掉那枚按钮（到它配对的 `)` 为止）连同后面的逗号。
  const buttonEnd = elementCallEnd(productDrawerPanelSrc, firstButton);
  let afterButton = buttonEnd + 1;
  while (afterButton < productDrawerPanelSrc.length && ', \t\r'.indexOf(productDrawerPanelSrc[afterButton]) >= 0) afterButton++;
  const withoutButton = buttonEnd < 0 ? null : productDrawerPanelSrc.slice(0, firstButton) + productDrawerPanelSrc.slice(afterButton);
  const sibling = productDrawerPanelSrc.slice(0, firstChild) + 'React.createElement("button", { className: "we-picker__btn" }, "合成"),\r\n' + ind + productDrawerPanelSrc.slice(firstChild);
  const nested = productDrawerPanelSrc.slice(0, firstChild)
    + 'React.createElement("i", null, React.createElement("button", { className: "we-picker__btn" }, "合成")),\r\n' + ind
    + productDrawerPanelSrc.slice(firstChild);
  const qp = productPrimaryActions(productQuickPanelSrc, PRODUCT_QP_ACTIONS_SCOPE);
  check('对照：同一判据喂合成源码必须判出（空容器 0 / 兄弟按钮 2 / 子容器按钮仍 1 / 另一 scope 3）',
    productPrimaryActions(withoutButton, PRODUCT_DRAWER_ACTIONS_SCOPE) === 0
      && productPrimaryActions(sibling, PRODUCT_DRAWER_ACTIONS_SCOPE) === 2
      && productPrimaryActions(nested, PRODUCT_DRAWER_ACTIONS_SCOPE) === 1
      && qp === 3,
    '空容器=' + productPrimaryActions(withoutButton, PRODUCT_DRAWER_ACTIONS_SCOPE)
      + '，兄弟按钮=' + productPrimaryActions(sibling, PRODUCT_DRAWER_ACTIONS_SCOPE)
      + '，子容器按钮=' + productPrimaryActions(nested, PRODUCT_DRAWER_ACTIONS_SCOPE)
      + '，播放控制行=' + qp
      + '（期望 0 / 2 / 1 / 3；只有真卡片那份是 1）');
}

// ── 宿主媒体路由：mock 播放器 + 不碰系统音频 ────────────────────────────────
// 走真实 HTTP 打宿主自己的四条路由，把「中间件 → 门面 → 路由映射」这一半端到端
// 验掉（另一半「client → 渲染页 → 壁纸」在下面的浏览器部分）。
console.log('');
console.log('· 宿主媒体路由（mock 播放器，不碰系统音频）');
let mstat = null;
for (let i = 0; i < 80; i++) {
  const r = await fetch(`${APP}/wallpaper-engine/media-status`, { cache: 'no-store' });
  mstat = await r.json();
  if (mstat && mstat.nowPlaying && mstat.nowPlaying.status === 'running') break;
  await new Promise((res) => setTimeout(res, 250));
}
check('媒体后端走中间件（backend=bridge，没有回落）',
  Boolean(mstat) && mstat.ok === true && mstat.backend === 'bridge' && !mstat.fallback,
  mstat ? `backend=${mstat.backend} fallback=${mstat.fallback || '-'} note=${mstat.note || '-'}` : '无响应');
check('音频未启用时状态明确为 off（不申请授权、不装音频桥）',
  Boolean(mstat && mstat.audio) && mstat.audio.status === 'off',
  mstat && mstat.audio ? mstat.audio.status : '?');
check('中间件版本/后端可查（排查时能一眼看出跑的是哪个产物）',
  Boolean(mstat && mstat.bridge) && mstat.bridge.version === WANT_BRIDGE_VERSION && mstat.bridge.protocol === 1,
  mstat && mstat.bridge ? `${mstat.bridge.version} ${mstat.bridge.provider}（期望 ${WANT_BRIDGE_VERSION}）` : '?');
// 独立地板（与上面那条解耦）：期望值取自产品自己的常量（lib/media/provision.js 的
// MEDIA_BRIDGE_TAG），所以它能抓"产物陈旧/下载被挡"，抓不到"tag 该升没升"——那是有意的
// 取舍（见 :78 注释）。但"观测点本身不在场"（mstat.bridge 空）绝不允许静默：否则取值为空
// 时上面那条只是变成一条普通的红，没人分得清是"版本不对"还是"根本没有版本可查"。
check('覆盖面：桥版本观测点在场（bridge.version 取得到，不是空对象）',
  Boolean(mstat && mstat.bridge && mstat.bridge.version),
  mstat && mstat.bridge ? 'version=' + mstat.bridge.version : 'mstat.bridge 缺失/为空 ⇒ 版本判据无从谈起');

const npRes = await fetch(`${APP}/wallpaper-engine/now-playing`, { cache: 'no-store' });
const npj = await npRes.json();
const m = (npj && npj.media) || null;
check('now-playing 给出曲目 + 时长（秒，不是毫秒）',
  Boolean(m) && m.title === '示例曲目' && m.albumArtist === '示例歌手'
    && m.duration > 10 && m.duration < 10000 && m.playing === true && m.state === 1,
  m ? `${m.title}/${m.artist} dur=${m.duration}s state=${m.state}` : 'null');
check('进度按真实时间外推（不是卡在上报值）', await (async () => {
  if (!m) return false;
  const before = m.position;
  await new Promise((res) => setTimeout(res, 1200));
  const again = await (await fetch(`${APP}/wallpaper-engine/now-playing`, { cache: 'no-store' })).json();
  const after = again && again.media ? again.media.position : 0;
  return after > before;
})(), m ? '两次读取比较（1.2s 间隔）' : '-');
check('封面存在时给宿主代理路径 + hasArtwork', Boolean(m && m.thumbnail) === Boolean(npj.hasArtwork),
  m && m.thumbnail ? String(m.thumbnail) : '（无封面）');
const artUrl = m && m.thumbnail ? APP + m.thumbnail : '';
const artRes = artUrl ? await fetch(artUrl, { cache: 'no-store' }) : null;
check('封面路由直接给图片（宿主代理中间件落盘的封面文件）',
  Boolean(artRes) && artRes.status === 200 && /^image\//.test(String(artRes.headers.get('content-type') || '')),
  artRes ? `${artRes.status} ${artRes.headers.get('content-type')}` : '无封面 URL');
const spRes = await fetch(`${APP}/wallpaper-engine/audio-spectrum`, { cache: 'no-store' });
const spj = await spRes.json();
check('频谱恒 64 段 + running=false（客户端据此不装音频桥）',
  spj && spj.ok === true && Array.isArray(spj.bands) && spj.bands.length === 64 && spj.running === false,
  spj ? `bands=${(spj.bands || []).length} running=${spj.running}` : '无响应');

// ── 起浏览器（Chromium 系；Edge 兜底）──────────────────────────────────────
const NAV_URL = APP + '/e2e/host.html';
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
const browser = CANDIDATES.find((p) => existsSync(p));
if (!browser) {
  // 自动跳过（非操作者显式选择）= 退出码 0 会给出**假通过**：把退出码当绿灯的调用者
  // 拿不到任何"其实零页面断言"的信号。所以：具名 SKIP 输出 + 覆盖面地板（数**已经执行**
  // 过的判据，不是"我打印了一句正在跳过"）。
  // 地板是常量、不是"数一下自己"：这里现取 `passed + failed` 就是为**排除**本判据自己
  // （check() 在下一行才调用 ⇒ 此刻的计数里没有它）。**不要再减 1**：`preBrowserChecks - 1 >= 12`
  // 会把门槛抬成 13，与常量 12 不符。
  // 更要紧的是：地板必须**影响退出码**，否则判红也照样 exit 0，调用方拿到的仍是"通过"。
  const PRE_BROWSER_MIN_CHECKS = 12;
  const preBrowserChecks = passed + failed;
  const preBrowserOk = preBrowserChecks >= PRE_BROWSER_MIN_CHECKS;
  check('覆盖面：自动跳过也算执行（跳过前至少 ' + PRE_BROWSER_MIN_CHECKS + ' 条前置判据）',
    preBrowserOk,
    '本轮已执行 ' + preBrowserChecks + ' 条前置判据 / 地板 ' + PRE_BROWSER_MIN_CHECKS + '（不含本判据自己）');
  const skipCode = preBrowserOk ? 0 : 1;
  console.log('  ! SKIP 未找到 Chromium 系浏览器，页面断言未执行（本脚本不进 npm run verify）'
    + ' —— 已执行 ' + preBrowserChecks + ' 条前置判据，页面部分 0 条；退出码 ' + skipCode
    + (skipCode === 0 ? ' 仅表示"显式跳过"，不是"页面断言通过"'
      : '：前置判据不足，按**失败**退出（不接受"没跑完"当通过）'));
  try { dispose && dispose(); } catch { /* ignore */ }
  appServer.close();
  process.exit(skipCode);
}
console.log(`浏览器: ${browser}`);

// /diag 落盘位置（先记录起始偏移，只读本次新增的行）
const diagStart = existsSync(DIAG_FILE) ? readFileSync(DIAG_FILE, 'utf8').length : 0;

const profileDir = join(TEST_ROOT, 'chromium-profile');
mkdirSync(profileDir, { recursive: true });
const child = spawn(browser, [
  '--headless=new',
  '--enable-unsafe-swiftshader',   // 无头下要软件 WebGL2，渲染页才能起来
  '--disable-extensions', '--no-first-run', '--no-default-browser-check',
  '--disable-features=Translate,MediaRouter',
  // macOS 上给无头浏览器一个**假钥匙串**：不给它，Chromium 系（实测 Edge）会去碰
  // 真钥匙串并弹「找不到…钥匙串」对话框打断跑测的人。其他平台该开关无害。
  '--use-mock-keychain',
  `--user-data-dir=${profileDir}`,
  '--window-size=1280,720',
  NAV_URL,
], { stdio: 'ignore' });

await new Promise((r) => setTimeout(r, 12000));
try { child.kill('SIGKILL'); } catch { /* ignore */ }
await new Promise((r) => setTimeout(r, 400));

// ── 第二次运行：带 <base href="./"> 的夹具（单独进程，不干扰上面的帧间隔断言）──────
if (baseWrapperHtml) {
  const baseProfile = join(TEST_ROOT, 'chromium-profile-base');
  mkdirSync(baseProfile, { recursive: true });
  const child2 = spawn(browser, [
    '--headless=new',
    '--enable-unsafe-swiftshader',
    // 同第一次运行：macOS 上不给假钥匙串，无头 Chromium 会弹「找不到…钥匙串」打断跑测的人。
    // 口径由 verify-contracts 守：每个 --headless=new 启动点都必须带这个开关。
    '--use-mock-keychain',
    '--disable-extensions', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${baseProfile}`,
    '--window-size=1280,720',
    APP + '/e2e/base.html',
  ], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 9000));
  try { child2.kill('SIGKILL'); } catch { /* ignore */ }
  await new Promise((r) => setTimeout(r, 400));
}

// ── 读回信标（按本次运行的标记过滤）────────────────────────────────────────
const lines = existsSync(DIAG_FILE) ? readFileSync(DIAG_FILE, 'utf8').slice(diagStart).split('\n') : [];
const mine = [];
for (const line of lines) {
  if (!line.trim()) continue;
  try { mine.push(JSON.parse(line)); } catch { /* ignore */ }
}
// 信标按本次运行的标记过滤（诊断文件是多个实例共用的）；媒体源请求与渲染页自身
// 的诊断不携带标记，按「本次运行新增」这个时间窗来认。
const beacons = mine.filter((d) => d.kind === 'renderer' && String(d.msg || '').indexOf(MARKER) === 0);
const mediaReqs = mine.filter((d) => d.kind === 'req' && d.route === 'scene-files@media');
const rendererDiag = mine.filter((d) => d.kind === 'renderer' && String(d.msg || '').indexOf(MARKER) !== 0);
// 夹具 2（自带 <base>）的信标形状与主夹具不同，必须分开取 —— 混在一起会把主夹具的
// g() 断言带偏（谁最后发就取谁）。
const baseBeacons = beacons.filter((b) => String(b.msg || '').includes(' BASEFIX '));
const mainBeacons = beacons.filter((b) => !String(b.msg || '').includes(' BASEFIX '));
const lastBeacon = mainBeacons.length ? String(mainBeacons[mainBeacons.length - 1].msg || '') : '';
const baseMsg = baseBeacons.length ? String(baseBeacons[baseBeacons.length - 1].msg || '') : '';
const g = (k) => (new RegExp('(?:^|\\s)' + k + '=([^\\s]+)').exec(lastBeacon) || [])[1] || '';
const gb = (k) => (new RegExp('(?:^|\\s)' + k + '=([^\\s]+)').exec(baseMsg) || [])[1] || '';

console.log('');
if (DEBUG) {
  console.log('本次运行新增的诊断行：');
  for (const line of lines) if (line.trim()) console.log('    | ' + line.slice(0, 200));
}
console.log(`信标 ${beacons.length} 条 / 媒体源文档请求 ${mediaReqs.length} 条`);
for (const b of beacons) console.log('    · ' + String(b.msg || '').slice(0, 160));
for (const r of mediaReqs.slice(0, 6)) console.log(`    · media ${r.status} ${String(r.path || '').slice(0, 70)} dest=${r.dest || '-'}`);
for (const d of rendererDiag.slice(-6)) console.log('    · renderer ' + String(d.msg || '').slice(0, 150));

// 渲染页对跨源入口的处理是「fetch HTML → 运行时注入 shim → blob + <base href> 挂载」，
// 所以媒体源上看到的是 fetch（dest=empty）而不是 iframe 导航；关键是入口 HTML 真的
// 从媒体源取到了，且取到之后壁纸脚本真的跑起来了（下面几条）。
check('媒体源把壁纸入口 HTML 交给了渲染页', mediaReqs.some((r) => r.status === 200 && /\.html?$/i.test(String(r.path || ''))),
  mediaReqs.map((r) => r.status + ' ' + String(r.path || '')).join(' | ').slice(0, 120) || '无请求');
check('壁纸文档里的脚本真的执行了（信标 ran=1）', g('ran') === '1', lastBeacon.slice(0, 80));
// 白屏回归 ①：严格沙箱 = 不透明源，window.localStorage 的**读取本身**抛 SecurityError
//（不是给一个不可用对象），而工坊应用常在 useState 初始化里直读 → 首屏渲染崩 →
// 整页白屏（2905017768 Bocchi 实测：Uncaught SecurityError … lacks the
// 'allow-same-origin' flag，随后作者一帧都没跑）。shim 在作者脚本前换成内存实现。
// 本机全库 15 张 web 壁纸里 6 张读 localStorage、2 张读 document.cookie。
check('不透明源里 localStorage 可用（shim 兜底，作者不会首屏崩）',
  String(g('ls') || '').startsWith('ok:'), 'ls=' + (g('ls') || '?'));
// 白屏回归 ②：自带 <base href="./"> 的 SPA（Angular/部分构建产物）。跨源入口经 blob
// URL 挂载，blob 没有目录概念 —— 相对 base 会让相对子资源解析到 blob 自己，一个请求
// 都发不出 ⇒ 整页白屏。改写时必须**就地换掉相对 base**（作者的绝对 base 保留）。
// 只有真浏览器能测：这是 URL 解析行为，字符串断言测不出来。
check('自带 <base href="./"> 的壁纸同样挂载成功（相对 base 被改写为入口目录）',
  gb('ran') === '1' && String(gb('base') || '').indexOf('/scene-files/') !== -1,
  baseMsg ? baseMsg.slice(0, 130) : '无信标：脚本没跑 = base 解析错（整页白屏）');
check('宿主注入的 shim 在位（shim=1）', g('shim') === '1', 'shim=' + (g('shim') || '?'));
check('属性种子到达作者（propsCalls≥1，含 color0）',
  Number(g('propsCalls') || 0) >= 1 && String(g('keys') || '').indexOf('color0') !== -1,
  'propsCalls=' + (g('propsCalls') || '?') + ' keys=' + (g('keys') || '?'));
check('跨源控制通道活着（渲染页下发的 sceneFps=15 到达作者）', g('fps') === '15',
  'fps=' + (g('fps') || '?'));
// 帧率上限的实现质量：sceneFps=15 → 目标间隔 66.7ms。setTimeout(1000/fps) 之后再 rAF 的
// 写法会把回调落在刷新的任意相位上 → 间隔抖动（17/33/50ms 混排，用户观感就是
// 「限了 30 反而更卡」）。现实现是跳帧：每帧都对齐 vsync，只交付第 n 帧。
//
// ⚠️ **p95 不是判据，只作记录**：n=60 时 `pct` 的 0.95 落在**第 3 大**的样本上，两帧被
// 同机负载抢掉就能把它从 73 推到 199（同一份代码两跑差 20 倍）。尾巴呈**目标间隔整数倍**
// 是 web-shim「按回调计数交付」的既有性质（上游 issue），不是被测实现的回归。**有牙的是
// p50**：定时器相位抖动产出的混排小间隔会把 p50 压到 45 以下、掉队帧数同时爆掉。故这里
// 用「紧判 p50 + 松判掉队比例」，并把 p95/max 记进输出。
const p50 = Number(g('p50') || 0);
const p95 = Number(g('p95') || 0);
const maxIv = Number(g('max') || 0);
const nSlow = Number(g('nSlow') || 0);
const nIv = Number(g('n') || 0);
// 判据的**命名参数**：真阈值与对照共用这一份（对照不许再手抄 45/100/0.2）。
const FPS_P50_FLOOR = 45, FPS_P50_CEIL = 100;
const FPS_SLOW_FRAC = 0.2, FPS_SLOW_MIN = 2;
// 判据 = "给一组帧间隔，它落在目标附近且没有系统性抖动"这一个**命名函数**：
// 真观测（浏览器回传的 p50/p95/nSlow）+ 下面两条合成对照走同一个函数、同一组阈值 ——
// 对照喂的是**变异序列**（setTimeout 混排抖动），且两侧共用同一组阈值常量：门槛只放宽真判据那一侧，
// 对照就会一直按放宽前的门槛判（真判据改了，对照还是绿的）。掉队上限对两侧都算一遍取严者。
const FPS_METRICS = new Function(`${FPS_METRIC_JS}\nreturn { pct: pct, nSlow: nSlow, maxOf: maxOf };`)();
const fpsWithinTarget = (p50v, nSlowv, nIvLen,
  floor = FPS_P50_FLOOR, ceil = FPS_P50_CEIL, frac = FPS_SLOW_FRAC, min = FPS_SLOW_MIN) => {
  const ceilFor = (len) => Math.max(min, Math.round(len * frac));
  return p50v > 0 && p50v >= floor && p50v <= ceil && nSlowv <= ceilFor(nIvLen);
};
const fpsJudge = (intervals) => fpsWithinTarget(FPS_METRICS.pct(intervals, 0.5), FPS_METRICS.nSlow(intervals), intervals.length);
check('帧间隔样本量够（防「三个样本也算均匀」）', nIv >= 40, `n=${nIv}`);
check('15fps 上限下帧间隔落在目标附近（跳帧生效）', fpsWithinTarget(p50, nSlow, nIv),
  `p50=${p50}ms（目标 ${Math.round(1000 / 15)}ms）n=${nIv}`);
check('帧间隔无系统性抖动（掉队帧 ≤20%；紧判据是上一条的 p50）', fpsWithinTarget(p50, nSlow, nIv),
  `p50=${p50} p95=${p95} max=${maxIv} 掉队=${nSlow}/${nIv}`);

// 判据自检（不需要浏览器）：用**同一份**度量源码喂两种合成序列 —— 健康序列（中位落在目标上、
// 偶尔一次 1 vsync 迟到）必须判为合格，setTimeout 相位抖动的混排序列必须被判出。没有这组对照，
// 上面那条"掉队 ≤20%"的松判据等于没有牙。
{
  // 同一判据 `fpsJudge` 吃两条合成序列；阈值来自上面那组命名常量（与真判据同源、一起放宽）。
  const G_FLOOR = FPS_P50_FLOOR, G_SLOW_FRAC = FPS_SLOW_FRAC, G_SLOW_MIN = FPS_SLOW_MIN, G_P50_CEIL = FPS_P50_CEIL;
  const healthy = [67, 67, 67, 83, 67, 67, 67, 67, 67, 67];
  const broken = [17, 33, 50, 17, 33, 50, 17, 33, 50, 17]; // 定时器相位抖动：混排小间隔
  check('对照：健康序列（p50 在目标上、一次 1 vsync 迟到）必须判为合格', fpsJudge(healthy),
    `p50=${FPS_METRICS.pct(healthy, 0.5)} 掉队=${FPS_METRICS.nSlow(healthy)}/${healthy.length} max=${FPS_METRICS.maxOf(healthy)}`
      + `（阈值 ${G_FLOOR}–${G_P50_CEIL}ms、掉队 ≤${G_SLOW_FRAC} 或 ${G_SLOW_MIN}）`);
  check('对照：旧 setTimeout 混排抖动序列必须被判出', !fpsJudge(broken),
    `p50=${FPS_METRICS.pct(broken, 0.5)} 掉队=${FPS_METRICS.nSlow(broken)}/${broken.length} max=${FPS_METRICS.maxOf(broken)}`);
}
// 媒体链路（歌名 / 封面 / 播放态）：封面必须真的能显示 —— 宿主给的是插件路由，
// 沙箱壁纸取不到（能力头栅栏），所以 client 转成 data URL 再推。
check('媒体属性到达壁纸（title）', g('media') === 'E2E_Song', 'media=' + (g('media') || '?'));
check('播放态到达壁纸', g('mstate') === '1', 'mstate=' + (g('mstate') || '?'));
// 新字段（中间件带来的）：albumArtist 走 properties、进度/时长走 timeline。
// 注意：渲染页自带一个「模拟媒体源」（WebWallGL 的演示播放列表，第一首时长 212s），
// 它也在推 timeline —— 所以断言在全部信标里找**宿主推的那组值**，而不是取最后一条
//（最后一条可能是模拟源的）。宿主该赢的地方是 properties/thumbnail/playback。
check('albumArtist 到达壁纸（中间件新增字段）', g('aa') === 'E2E_AlbumArtist', 'aa=' + (g('aa') || '?'));
// 时间轴（进度/时长）：`op:"timeline"` → wallpaperRegisterMediaTimelineListener 这条
// 通道要通，**而且必须是宿主推的那组值**（内置实现在 Linux 上根本给不出这两个值，
// 中间件三平台都给）。
// 这里同时守着一条渲染页不变量：渲染页自带「演示媒体源」（createSimulatedMedia，
// 首曲时长 212s），它也会推 timeline —— 宿主 wire 必须存档到 rt.mediaSource 并与媒体泵
// 共用 diff 记录，才不会被演示源按秒推的进度盖掉。所以这里必须一路都是宿主的 5,100。
const mtlSeen = beacons
  .map((b) => (/(?:^|\s)mtl=([^\s]+)/.exec(String(b.msg || '')) || [])[1] || '')
  .filter(Boolean);
check('进度/时长到达壁纸，且归宿主（不再被演示源覆盖）',
  mtlSeen.length > 0 && mtlSeen.every((v) => v === '5,100'),
  `mtl 序列: ${mtlSeen.join(' → ') || '无'}`);
// 卡片布局（用户口径：抽屉里名称放顶层第一行、右边两个按钮上下排列、间距 8px）
const layoutLine = (() => {
  for (const d of mine) {
    const m = String((d && d.msg) || '');
    if (m.indexOf(MARKER) === 0 && m.indexOf('LAYOUT') > 0) return m;
  }
  return '';
})();
const lg = (k) => (new RegExp('(?:^|\\s)' + k + '=([^\\s]+)').exec(layoutLine) || [])[1] || '';
check('抽屉里名称独占顶层第一行', lg('drawerTitleAbove') === '1', layoutLine || '未测到');
// 「按钮个数」这个产品契约只由上面的真源码判据 `productPrimaryActions` 守（drawer=1 / quick-panel=3）；
// 「镜像页确实起来了」由上一行的 `drawerTitleAbove === '1'` 守，镜像 DOM 的按钮数不能当判据。
// 用户口径：抽屉里「类型 · 播放中」跟在名称后面、括号包起来、超出一行用省略号
check('抽屉里类型/播放态内联加括号、整行不换行且在超长时省略',
  lg('metaInline') === '1' && lg('parens') === '1' && lg('oneLine') === '1' && lg('clipped') === '1',
  `inline=${lg('metaInline')} 括号=${lg('parens')} 单行=${lg('oneLine')} 省略=${lg('clipped')}`);
check('宽卡片里类型/播放态仍在名称下方另起一行', lg('wideMetaBlock') === '1', 'wide=' + (lg('wideMetaBlock') || '?'));
check('抽屉里名称行文字居中（宽卡片保持左对齐）',
  lg('titleCenter') === '1' && (lg('wideTitleAlign') === 'start' || lg('wideTitleAlign') === 'left'),
  `drawer=${lg('titleCenter')} center / wide=${lg('wideTitleAlign')}`);
// 属性热更新（「壁纸属性」面板的写路径）：渲染页 __wp.updateWebProps → shim
// → 作者 applyUserProperties。种子给的是 '1 0 0'，热更新后必须是 '0 1 0'。
check('属性热更新到达壁纸（updateWebProps）', g('prop0') === '0_1_0', 'prop0=' + (g('prop0') || '?'));
check('封面 data URL 到达壁纸且能加载显示',
  /^ok:\d+x\d+$/.test(g('img') || '') && Number(g('thumb') || 0) > 100,
  `thumb=${g('thumb') || 0}ch img=${g('img') || '?'}`);

// ── teardown ────────────────────────────────────────────────────────────────
try { dispose && dispose(); } catch { /* ignore */ }
try { appServer.close(); } catch { /* ignore */ }
delete process.env.DSH_WE_STEAM_ROOT;
delete process.env.DSH_WE_UPLOAD_DIR;
rmSync(TEST_ROOT, { recursive: true, force: true });

console.log('');
if (failed > 0) {
  console.log(`E2E FAILED — ${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`ALL E2E CHECKS PASSED (${passed})`);
