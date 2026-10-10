#!/usr/bin/env node
/**
 * repro-sidebar-props.mjs — 侧栏「壁纸属性」的**真产物复现台**（跑 `lib/client.js`）。
 *
 * 为什么需要它：`verify-scene-live` 的渲染台会把 QuickPanel 的自由变量**替身化**，
 * 因此它天然发现不了**作用域**错误 —— 面板渲染器曾经是 `apply()` 里的闭包，而
 * `src/sidebar-right.js` 是 prelude（在 `apply()` 之前求值），真机上一渲染就抛
 * `ReferenceError: renderUserPropsPanel is not defined`、React 卸载整棵树 ⇒ **整个页面空白**；
 * 而替身台一路绿灯（它自己把那个名字塞进了作用域）。本台走**真实链路**：
 *   `window.__ModuleLoader__.load` → `factory(require)` → `apply(ctx)`
 *   → `ctx.slots.inject("sidebar.right.pane.tab")` → `ctx.slots.register(...)` 拿 body 渲染器
 *   → 真的选一张壁纸 → 真的点「壁纸属性」→ 再渲染一次。
 * 用法：`node scripts/../test/repro-sidebar-props.mjs`（要求 `lib/client.js` 是当前构建）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { installWeTShim } from './tools/weT-shim.mjs';
installWeTShim();
// ⚠️ 仓库根必须**从本文件位置推**，不能写死绝对路径：上游这版原本写的是作者机器的
// `/Users/oneincase/Documents/workspace/dsh-wallpaper-engine`，在 Windows 上会被解析成
// `D:\Users\oneincase\...` ⇒ `ENOENT` 直接崩（真机实测：合并上游 v1.2.0 后本台跑不起来）。
// 与其余测试同一条口径（`new URL('../', import.meta.url)`）。
const ROOT = fileURLToPath(new URL('../', import.meta.url)).replace(/[/\\]+$/, '');

const React = {
  Fragment: 'Fragment',
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {}, useRef: (v) => ({ current: v }),
  createElement: (type, props, ...children) =>
    (typeof type === 'function' ? type(props || {}) : ({ type, props: props || null, children })),
};
const byId = {};
const mkEl = (tag) => ({ tagName: String(tag).toUpperCase(), children: [], dataset: {}, style: { setProperty(){}, removeProperty(){}, getPropertyValue(){ return ''; } }, classList: { add(){}, remove(){} },
  appendChild(c){ this.children.push(c); return c; }, removeChild(){}, setAttribute(){}, removeAttribute(){}, addEventListener(){}, removeEventListener(){},
  querySelector(){ return null; }, querySelectorAll(){ return []; }, contains(){ return false; }, focus(){}, blur(){}, getBoundingClientRect(){ return { width: 300, height: 600, top:0, left:0, right:300, bottom:600 }; } });
const document = { body: mkEl('body'), documentElement: mkEl('html'), head: mkEl('head'),
  createElement: mkEl, getElementById: (id) => byId[id] || null,
  querySelector(){ return null; }, querySelectorAll(){ return []; }, addEventListener(){}, removeEventListener(){},
  createTextNode: (t) => ({ nodeType: 3, textContent: t }) };
document.body.isConnected = true;
const localStorage = { _d: {}, getItem(k){ return k in this._d ? this._d[k] : null; }, setItem(k,v){ this._d[k]=String(v); }, removeItem(k){ delete this._d[k]; } };

const PROPS_TOKEN = 'tokS';
const WALLPAPER = { id: 'w-wap', title: '场景壁纸一号', type: 'scene', playable: true, media: null,
  frameUrl: '/wallpaper-engine/scene-frame/w-wap', preview: null, contentrating: 'Everyone',
  propsUrl: '/wallpaper-engine/props/' + PROPS_TOKEN, sceneLive: false };
const inventoryPayload = () => ({ installDir: 'D:/we', uploadDir: 'D:/we/uploads', weAssetsDir: null, weAssetsAvailable: false,
  total: 1, portableCount: 1, playlists: [], wallpapers: [WALLPAPER] });
const PROPS_DEFS = [
  { name: 'look', ptype: 'text', text: '外观', order: 0, value: null, default: null, overridden: false },
  { name: 'glow', ptype: 'bool', text: '发光', order: 1, value: false, default: false, overridden: false },
];
const fetch = (url, opts) => {
  const u = String(url); const method = String((opts && opts.method) || 'GET').toUpperCase();
  const json = (body, status = 200) => Promise.resolve({ status, json: () => Promise.resolve(body) });
  if (u.includes('/inventory')) return json(inventoryPayload());
  if (u.includes('/props/')) return json({ ok: true, token: PROPS_TOKEN, props: PROPS_DEFS, overrides: {}, hasProject: true });
  return json({ ok: true });
};

// ── 宿主服务桩：官方侧栏（tabs.register + ctx.slots.register 拿 body 渲染器）──
let bodyRender = null;
const slots = {
  inject: (seat, cb) => cb(),
  register: (opts, render) => { if (opts && opts.name === 'sidebar.right.pane.tab') bodyRender = render; return () => {}; },
};
const sidebarRightTabs = { register: () => () => {} };
const ctx = { slots, effect(fn) { fn(); return fn; },
  get: (k) => (k === 'sidebarRightTabs' ? sidebarRightTabs : k === 'sidebarRight' ? { openTab: () => {} } : null) };

const timers = [];
const setT = (fn) => { const t = { fn }; timers.push(t); return t; };
// 定次齐步走：每轮先把挂起的定时器跑掉，再让出一轮事件循环给 promise 链落地。
// 定时器是"周期性轮询"（scheduleWeTimeout 每 250ms 重排），所以不能按"清空"判结束。
const pump = async (rounds) => {
  for (let i = 0; i < (rounds || 8); i++) {
    const batch = timers.splice(0, timers.length);
    for (const t of batch) { try { t.fn(); } catch { /* ignore */ } }
    await new Promise((r) => setImmediate(r));
  }
};
const sandbox = { window: { __ModuleLoader__: { load: (h) => { sandbox.__handoff = h; } },
    setTimeout: setT, clearTimeout(){}, setInterval: () => 0, clearInterval(){},
    addEventListener(){}, removeEventListener(){}, matchMedia: () => ({ matches: false, addEventListener(){}, removeEventListener(){} }),
    location: { search: '', href: 'http://x/' } },
  document, localStorage, fetch, React, console,
  setTimeout: setT, clearTimeout(){}, setInterval: () => 0, clearInterval(){} };
sandbox.window.document = document; sandbox.window.localStorage = localStorage;
vm.createContext(sandbox);
new vm.Script(readFileSync(ROOT + '/lib/client.js', 'utf8'), { filename: 'client.js' }).runInContext(sandbox);
const { factory } = sandbox.__handoff;
const exportsObj = factory((spec) => (spec === 'react' ? React : spec === 'react-dom' ? { createPortal: (n) => n } : (() => { throw new Error('unexpected require ' + spec); })()));
exportsObj.apply(ctx);
await pump(8);
console.log('sidebar body 渲染器已注册:', typeof bodyRender === 'function');

const findBtn = (root, label) => {
  let hit = null;
  (function walk(n) {
    if (hit) return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== 'object') return;
    const cls = String((n.props && n.props.className) || '');
    if (n.type === 'button' && cls.includes('we-picker__btn') && JSON.stringify(n.children).includes(label)) { hit = n; return; }
    if (Array.isArray(n.children)) n.children.forEach(walk);
  })(root);
  return hit;
};
const textOf = (n) => (Array.isArray(n) ? n.map(textOf).join(' ') : (!n || typeof n !== 'object' ? (typeof n === 'string' ? n : '')
  : (Array.isArray(n.children) ? n.children.map(textOf).join(' ') : '')));
const findAll = (root, pred) => { const out = [];
  (function walk(n) { if (Array.isArray(n)) return n.forEach(walk); if (!n || typeof n !== 'object') return;
    if (pred(n)) out.push(n); if (Array.isArray(n.children)) n.children.forEach(walk); })(root); return out; };
try {
  let tree = bodyRender();
  // 先真的"选一张"：点快切列表里的卡片（选择态由此进入 store）。
  const cards = findAll(tree, (n) => String((n.props && n.props.className) || '').includes('we-qp__card') && String((n.props && n.props.className) || '').includes('we-qp__card--current') === false);
  console.log('① 侧栏面板渲染 OK；可点卡片数:', cards.length);
  console.log('   面板文本:', JSON.stringify(textOf(tree)).slice(0, 400));
  const classes = []; (function w(n){ if(Array.isArray(n)) return n.forEach(w); if(!n||typeof n!=='object')return;
    if(n.props&&n.props.className) classes.push(String(n.props.className)); if(Array.isArray(n.children)) n.children.forEach(w); })(tree);
  console.log('   class 序列:', classes.join(' | ').slice(0, 500));
  if (cards.length) { cards[0].props.onClick(); await pump(8); tree = bodyRender(); }
  console.log('   选中后入口在吗:', !!findBtn(tree, '壁纸属性'));
  const btn = findBtn(tree, '壁纸属性');
  if (!btn) { console.log('没有入口 —— 选择未落定或这张壁纸没有 propsUrl'); process.exit(2); }
  btn.props.onClick();
  console.log('② 点了入口（openUserPropsPanel 已跑）');
  const tree2 = bodyRender();
  console.log('③ 展开后渲染 OK');
  console.log('   文本:', JSON.stringify(textOf(tree2)).slice(0, 300));
  // 只有抛异常才算失败：这里的观测必须真的能失败（打印完就丢的布尔等于没有断言）。
  if (!JSON.stringify(tree2).includes('we-picker__props')) throw new Error('props 面板未渲染');
  console.log('   有面板:', JSON.stringify(tree2).includes('we-picker__props'));
} catch (e) {
  console.log('✗ 渲染抛异常:', e && e.constructor && e.constructor.name, e && e.message);
  console.log(String(e && e.stack || '').split('\n').slice(0, 8).join('\n'));
  process.exit(1);
}
