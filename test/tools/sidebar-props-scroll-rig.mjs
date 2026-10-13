#!/usr/bin/env node
/**
 * sidebar-props-scroll-rig.mjs —— 侧栏「壁纸属性」下钻的**真浏览器滚动判定台**（手动工具，
 * 不进 `npm run verify` 链）。
 *
 * 回答的问题：**属性很多的壁纸，面板能不能滚到底？**
 * 这是「侧栏列表滚不动」那条布局契约的姊妹形态：官方侧栏的页签内容区是**固定高 +
 * overflow:hidden**（宿主真值取自 DeepSeek Harness.app/Resources/app.asar 的
 * `.irMxjq_tabBody`：`flex-direction:column; height:100%; min-height:0; display:flex;
 * overflow:hidden`），任何祖先都不会替你滚。壁纸档挂 `--library` 时滚动交给列表自己；
 * 而**属性下钻那一屏没有列表** —— 面板若不自带滚动，属性多的壁纸下半截会被裁掉且
 * 滚不动（用户实测到的那一版）。
 *
 * 装置构成（每条都刻意贴着真机）：
 *   · 跑的是**真产物** `lib/client.js`（经宿主那套 `window.__ModuleLoader__` 契约加载），
 *     用**真 React / ReactDOM 18**（从本机 DSH profile 的 node_modules 取，缺了直接退出、
 *     不给假绿）把官方侧栏的 tab body 渲染器挂进 DOM —— 真组件树、真 effect、真点击。
 *   · 页面结构照抄宿主几何契约：300px 宽的侧栏栏 + `overflow:hidden` 的页签内容区。
 *   · 库存夹具 = 1 张带 propsUrl 的场景壁纸 + 119 张凑数壁纸；属性夹具 = 60 项混合类型。
 *   · 判定不看 CSS 文本，而是**真滚一把**：把从末行到 body 的每个「可滚祖先」逐个
 *     `scrollTop = scrollHeight`，再量末行是否落进页签内容区的可视框 —— 能滚到底才算过。
 *
 * 用法：
 *   node test/tools/sidebar-props-scroll-rig.mjs [bundle.js]      # 默认 lib/client.js
 * A/B 对照走**两份产物**：
 *   cp lib/client.js /tmp/sidebar-rig/before.js    # 改之前存一份
 *   node test/tools/sidebar-props-scroll-rig.mjs /tmp/sidebar-rig/before.js "对照"
 *   node test/tools/sidebar-props-scroll-rig.mjs lib/client.js "本次"
 * 退出码：0 = 属性面板能滚到底；1 = 判定失败（或页面报错）；2 = 环境缺件（浏览器 / React）。
 *
 * 前置：Chromium 系浏览器在候选路径上（本机是 Microsoft Edge）。`--use-mock-keychain`
 * 挡掉 headless 浏览器碰真钥匙串弹出的系统授权框（见 docs/DEV-GUIDE.md 的浏览器启动口径）。
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BUNDLE_PATH = process.argv[2] || 'lib/client.js';
const BUNDLE = readFileSync(BUNDLE_PATH, 'utf8');
const LABEL = process.argv[2] ? (process.argv[3] || process.argv[2]) : 'lib/client.js（当前构建）';

const BROWSERS = [
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
];
/** React / ReactDOM 的 UMD 构建位置：本机 DSH profile 的 node_modules（可用环境变量换根）。 */
function reactUmdDir() {
  const roots = [
    process.env.WE_RIG_REACT_DIR,
    join(homedir(), '.dsh', 'profiles', 'web', 'node_modules'),
    join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules'),
  ].filter(Boolean);
  for (const root of roots) {
    const react = join(root, 'react', 'umd', 'react.development.js');
    const reactDom = join(root, 'react-dom', 'umd', 'react-dom.development.js');
    if (existsSync(react) && existsSync(reactDom)) return { react, reactDom };
  }
  return null;
}

const PORT = 8793;
const CDP_PORT = 9457;
const W = 1024;
const H = 800;
const PANE_W = 300;      // 官方右栏最小宽（宿主 clampWidth(rightbar, 300, …)）
const N_PROPS_ROWS = 60; // 属性行数：远超一屏（约 24px/行 × 60 ≈ 1.4k px，可视区约 0.5k px）
const N_WALLPAPERS = 120;
const PROPS_TOKEN = 'tokrig';

const PROPS = (() => {
  const out = [{ name: 'sec', ptype: 'text', text: '外观', order: 0, value: null, default: null, overridden: false }];
  for (let i = 1; i < N_PROPS_ROWS; i++) {
    const kind = i % 3;
    if (kind === 0) out.push({ name: 'b' + i, ptype: 'bool', text: '开关 ' + i, order: i, value: false, default: false, overridden: false });
    else if (kind === 1) out.push({ name: 's' + i, ptype: 'slider', text: '滑杆 ' + i, order: i, min: 0, max: 100, step: 1, precision: 0, value: 50, default: 50, overridden: false });
    else out.push({ name: 'c' + i, ptype: 'color', text: '颜色 ' + i, order: i, value: '1 0.5 0', default: '1 0.5 0', overridden: false });
  }
  return out;
})();

// 场景壁纸进"可播放列表"的前提是 frameUrl 在位（isPlayableType：scene 靠静态帧当图用）。
const WALLPAPERS = [{
  id: 'w-prop', title: '属性壁纸', type: 'scene', playable: true, media: null, preview: null,
  contentrating: 'Everyone', sceneLive: false, frameUrl: '/wallpaper-engine/scene-frame/w-prop',
  propsUrl: '/wallpaper-engine/props/' + PROPS_TOKEN,
}].concat(Array.from({ length: N_WALLPAPERS - 1 }, (_, i) => ({
  id: 'w-' + i, title: '壁纸 ' + String(i + 1).padStart(3, '0'), type: 'video', playable: true,
  media: null, preview: null, contentrating: 'Everyone',
})));

const PAGE = `<!doctype html>
<html>
<head><meta charset="utf-8"><style>
  html, body { height: 100%; margin: 0; background: #0d1117; }
  #shell { display: flex; height: 100%; }
  /* 宿主侧栏的几何契约：真值 = 官方 app.asar 里的 .irMxjq_tabBody（固定高 + overflow:hidden）。 */
  #pane { width: ${PANE_W}px; height: 100%; display: flex; flex-direction: column; min-width: 0; }
  #tabbody { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; }
</style></head>
<body>
<div id="shell"><div id="pane"><div id="tabbody"></div></div></div>
<script>
  window.__facts = { errors: [], requests: [] };
  window.__ModuleLoader__ = { load: (h) => { window.__handoff = h; } };
  window.onerror = (m) => { window.__facts.errors.push(String(m)); };
  window.addEventListener('unhandledrejection', (e) => window.__facts.errors.push('rejection: ' + String(e && e.reason)));
</script>
<script src="/react.js"></script>
<script src="/react-dom.js"></script>
<script src="/client.js"></script>
<script>
(function () {
  var cleanups = [];
  var ctx = {
    slots: {
      inject: function (k, cb) { cb(); },
      register: function (opts, render) {
        if (opts && opts.name === 'sidebar.right.pane.tab') window.__bodyRender = render;
        return function () {};
      },
    },
    effect: function (fn) {
      try { var c = fn(); if (typeof c === 'function') cleanups.push(c); }
      catch (e) { window.__facts.errors.push('effect: ' + String(e && e.stack || e)); }
    },
    get: function (k) {
      if (k === 'sidebarRightTabs') return { register: function () { return function () {}; } };
      if (k === 'sidebarRight') return { openTab: function () {} };
      return undefined;
    },
    on: function () { return function () {}; },
  };
  try {
    var h = window.__handoff;
    var exp = h.factory(function (spec) {
      if (spec === 'react') return React;
      if (spec === 'react-dom') return ReactDOM;
      return {};
    });
    exp.apply(ctx);
    window.__facts.applied = true;
  } catch (e) {
    window.__facts.errors.push('apply: ' + String(e && e.stack || e));
  }
  // 官方壳：把 tab body 渲染器真的挂进 DOM（真 React ⇒ 真 effect / 真点击重渲染）。
  try {
    if (!window.__bodyRender) throw new Error('sidebar.right.pane.tab 渲染器没注册');
    ReactDOM.createRoot(document.getElementById('tabbody')).render(window.__bodyRender());
    window.__facts.mounted = true;
  } catch (e) {
    window.__facts.errors.push('mount: ' + String(e && e.stack || e));
  }
})();
</script>
</body></html>`;

function serve() {
  const react = reactUmdDir();
  if (!react) {
    console.error('找不到 React/ReactDOM 的 UMD 构建（找过 ~/.dsh/profiles/*/node_modules；可用 WE_RIG_REACT_DIR 指定 node_modules 根）');
    process.exit(2);
  }
  const reactSrc = readFileSync(react.react, 'utf8');
  const reactDomSrc = readFileSync(react.reactDom, 'utf8');
  return new Promise((res) => {
    const s = createServer((req, r) => {
      const p = new URL(req.url, 'http://x').pathname;
      const json = (o) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify(o)); };
      if (p === '/') { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(PAGE); return; }
      if (p === '/client.js') { r.setHeader('content-type', 'text/javascript'); r.end(BUNDLE); return; }
      if (p === '/react.js') { r.setHeader('content-type', 'text/javascript'); r.end(reactSrc); return; }
      if (p === '/react-dom.js') { r.setHeader('content-type', 'text/javascript'); r.end(reactDomSrc); return; }
      if (p === '/wallpaper-engine/inventory') {
        return json({ installDir: 'D:/we', uploadDir: 'D:/we/uploads', weAssetsDir: null, weAssetsAvailable: false,
          total: WALLPAPERS.length, portableCount: WALLPAPERS.length, playlists: [], wallpapers: WALLPAPERS });
      }
      if (p.indexOf('/wallpaper-engine/props/') === 0) {
        return json({ ok: true, token: PROPS_TOKEN, props: PROPS, overrides: {}, hasProject: true });
      }
      if (p === '/wallpaper-engine/settings') return json({ ok: true });
      if (p === '/diag' || p === '/wallpaper-engine/client-diag') { r.statusCode = 204; r.end(); return; }
      r.statusCode = 404; r.end('nope');
    });
    s.listen(PORT, '127.0.0.1', () => res(s));
  });
}

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

/** 页内判定：末行能否**被用户滚到可视区里**。
 *  ⚠️ 只有 `overflow-y: auto|scroll` 的祖先才算候选：`overflow:hidden` 的元素
 *  **程序上**也能 `scrollTop`（拿它能滚出假绿），但用户滚不动它 —— 那正是这个 bug 的形态。 */
const MEASURE = `(() => {
  const rect = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: r.height }; };
  const tab = document.getElementById('tabbody');
  const tabR = rect(tab);
  const panel = document.querySelector('.we-qp__propsview');
  const rows = Array.from(document.querySelectorAll('.we-picker__props-row'));
  const last = rows[rows.length - 1];
  if (!tab || !panel || !last) return { ok: false, why: 'panel/rows 不在 DOM', rows: rows.length };
  const nodes = [];
  const chain = [];
  for (let n = last.parentElement; n && n !== document.body; n = n.parentElement) {
    const cs = getComputedStyle(n);
    const user = cs.overflowY === 'auto' || cs.overflowY === 'scroll';
    nodes.push(n);
    chain.push({ cls: String(n.className || n.tagName), oy: cs.overflowY, user,
      sh: n.scrollHeight, ch: n.clientHeight, scrollable: n.scrollHeight > n.clientHeight + 1 });
  }
  const inside = () => { const r = rect(last); return r.bottom <= tabR.bottom + 1 && r.top >= tabR.top - 1; };
  const atRest = inside();
  let winner = null;
  for (let i = 0; i < chain.length; i++) {
    const c = chain[i];
    if (!c.user || !c.scrollable) continue;
    const el = nodes[i];
    el.scrollTop = el.scrollHeight;
    if (inside()) { winner = c.cls; el.scrollTop = 0; break; }
    el.scrollTop = 0;
  }
  const pcs = getComputedStyle(panel);
  const clipper = chain.find((c) => !c.user && c.scrollable);
  return {
    ok: true, rows: rows.length, atRest,
    reachable: Boolean(atRest || winner), winner,
    clippedBy: clipper ? clipper.cls : null,
    tabH: Math.round(tabR.h),
    contentH: Math.round(rect(last).bottom - rect(rows[0]).top),
    panelOverflowY: pcs.overflowY,
    panelScrollH: panel.scrollHeight, panelClientH: panel.clientHeight,
    chain,
  };
})()`;

/** 列表（壁纸库）滚动：折叠属性下钻后，把 .we-qp__list 滚到底，看最后一张在不在。 */
const MEASURE_LIST = `(() => {
  const list = document.querySelector('.we-qp__list');
  if (!list) return { ok: false, why: '没有 .we-qp__list' };
  const cs = getComputedStyle(list);
  const scrollable = list.scrollHeight > list.clientHeight + 1;
  const before = list.scrollTop;
  list.scrollTop = list.scrollHeight;
  const items = Array.from(list.querySelectorAll('[data-we-id]'));
  const lastItem = items[items.length - 1];
  const lr = list.getBoundingClientRect();
  const ir = lastItem && lastItem.getBoundingClientRect();
  const lastVisible = Boolean(ir) && ir.bottom <= lr.bottom + 1 && ir.top >= lr.top - 1;
  list.scrollTop = before;
  return { ok: true, overflowY: cs.overflowY, scrollable, rendered: items.length,
    scrollH: list.scrollHeight, clientH: list.clientHeight, lastVisible };
})()`;

async function main() {
  const browserPath = BROWSERS.find((p) => existsSync(p));
  if (!browserPath) { console.error('找不到 Chromium 系浏览器（候选：' + BROWSERS.join(', ') + '）'); process.exit(2); }
  const server = await serve();
  const browser = spawn(browserPath, [
    '--headless=new', '--enable-unsafe-swiftshader', '--use-mock-keychain',
    '--no-first-run', '--no-default-browser-check', '--disable-features=CalculateNativeWinOcclusion',
    '--user-data-dir=/tmp/sidebar-rig-profile', `--remote-debugging-port=${CDP_PORT}`,
    `--window-size=${W},${H}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let failed = 0;
  const check = (name, ok, detail) => {
    if (!ok) failed++;
    console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
  };
  try {
    let ver = null;
    for (let i = 0; i < 40 && !ver; i++) { try { ver = await get(`http://127.0.0.1:${CDP_PORT}/json/version`); } catch { await sleep(250); } }
    if (!ver) throw new Error('浏览器没起来');
    const cdp = await Cdp.connect(ver.webSocketDebuggerUrl);
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
    const waitFor = async (expr, label, tries = 120) => {
      for (let i = 0; i < tries; i++) { if (await ev(expr)) return true; await sleep(100); }
      throw new Error('等待超时: ' + label);
    };

    console.log(`\n=== ${LABEL} ===`);
    await waitFor(`!!(window.__facts && window.__facts.mounted)`, '面板挂载');
    await waitFor(`document.querySelectorAll('[data-we-id]').length > 0`, '库存卡片');
    const boot = await ev(`({ applied: !!window.__facts.applied, mounted: !!window.__facts.mounted,
      errors: window.__facts.errors.slice(0, 3), cards: document.querySelectorAll('[data-we-id]').length })`);
    console.log('boot:', JSON.stringify(boot));
    check('真产物在官方壳里挂载成功（零 apply/mount 报错）', boot.applied && boot.mounted && boot.errors.length === 0);

    // ① 选中那张带属性的场景壁纸（点卡片 = 真点击路径 ⇒ selection.propsUrl 由 media-prep 落定）
    await ev(`document.querySelector('[data-we-id="w-prop"]').click()`);
    await waitFor(`!!document.querySelector('.we-qp__propsbtn')`, '「壁纸属性」入口');
    // ② 点开下钻
    await ev(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.className.indexOf('we-qp__propsbtn') >= 0); b.click(); return 1; })()`);
    await waitFor(`document.querySelectorAll('.we-picker__props-row').length >= ${N_PROPS_ROWS - 1}`, '属性行渲染');
    const m = await ev(MEASURE);
    console.log('属性下钻:', JSON.stringify(m, null, 2));
    check(`${m.rows} 行属性被渲染`, m.ok && m.rows >= N_PROPS_ROWS - 1);
    check('内容高于可视区（确有"显示不全"的土壤）', m.ok && m.contentH > m.tabH);
    check('末行能被滚进可视区（滚到底可达）', Boolean(m.reachable),
      m.atRest ? '静止即全部可见' : (m.reachable ? '靠 ' + m.winner + ' 滚到底' : '没有任何可滚祖先能露出末行'));

    // ③ 回归：折叠下钻后，壁纸列表自己仍要滚得动
    await ev(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.className.indexOf('we-qp__propsbtn') >= 0); b.click(); return 1; })()`);
    await waitFor(`!!document.querySelector('.we-qp__list')`, '壁纸列表');
    await sleep(300);
    const l = await ev(MEASURE_LIST);
    console.log('壁纸列表:', JSON.stringify(l));
    check('壁纸列表自己可滚且能滚到最后一张', l.ok && l.scrollable && l.lastVisible);

    const errs = await ev(`window.__facts.errors.slice(0, 5)`);
    if (errs.length) console.log('页面报错(前几条):', JSON.stringify(errs));
    console.log(failed === 0 ? '\nRIG PASS' : `\nRIG FAILED — ${failed} 项`);
  } finally {
    try { browser.kill('SIGKILL'); } catch { /* ignore */ }
    server.close();
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error('RIG FAILED', e); process.exit(1); });
