// Coexistence v1 verification (计划 v4 §五矩阵的 headless 子集):
//   相位门控快照(T12/T13) / idle 卸载与恢复闭环(T5b/T4) /
//   契约上报所有权 / 双引擎阻塞卡决策路径(T8) /
//   静态断言: portal 打标不变量(T11) + z-index 错开(C4) + rAF 合帧(C5)。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const React = {
  Fragment: 'Fragment',
  useState: (init) => [init, () => {}],
  useEffect: () => {},
  useRef: (v) => ({ current: v }),
  createElement: (type, props, ...children) =>
    typeof type === 'function' ? type(props || {}) : ({ type, props: props || null, children }),
};

let failures = 0;
const check = (name, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + name); if (!ok) failures++; };
process.on('unhandledRejection', (e) => console.log('UNHANDLED-REJECTION', e && (e.stack || e.message || e)));
process.on('uncaughtException', (e) => console.log('UNCAUGHT', e && (e.stack || e.message)));

let byId = {};
function makeEl(tag) {
  return {
    tagName: tag.toUpperCase(),
    children: [],
    dataset: {},
    attributes: {},
    style: { _props: {}, setProperty(k, v) { this._props[k] = String(v); }, removeProperty(k) { delete this._props[k]; } },
    className: '',
    _listeners: {},
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); },
    removeEventListener() {},
    dispatch(type, evt) { for (const fn of [...(this._listeners[type] || [])]) fn(evt); },
    appendChild(c) { this.children.push(c); c._parent = this; if (c.id) byId[c.id] = c; return c; },
    remove() {
      if (this._parent) { const i = this._parent.children.indexOf(this); if (i >= 0) this._parent.children.splice(i, 1); }
      delete byId[this.id];
      this.isConnected = false;
    },
    getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; },
    setAttribute(k, v) { this.attributes[k] = v; },
    removeAttribute(k) { delete this.attributes[k]; },
    hasAttribute(k) { return k in this.attributes; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    isConnected: true,
  };
}

const observers = [];
class MutationObserver {
  constructor(cb) { this._cb = cb; observers.push(this); }
  observe(_t, _o) {}
  disconnect() {}
  static fireAll() { for (const o of [...observers]) o._cb([], o); }
}

async function settle(maxMs = 300) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 10));
    // 双条件：壁纸 id 已解析（层挂载路径）且没有待处理微任务
    if (byId['dsh-wallpaper-engine-layer'] !== undefined && Date.now() - t0 > 40) break;
  }
  await new Promise((r) => setTimeout(r, 20));
}

async function bootHarness({ seed, preInject }) {
  byId = {};
  observers.length = 0;
  const htmlEl = makeEl('html');
  const bodyEl = makeEl('body');
  if (preInject) preInject({ htmlEl, bodyEl }); // 模拟上游先于本插件启动的基线状态
  const doc = {
    createElement: (t) => makeEl(t),
    getElementById: (id) => byId[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    documentElement: htmlEl,
    head: makeEl('head'),
    body: bodyEl,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const localStorageMock = {
    _store: { 'dsh-wallpaper-engine:selection': JSON.stringify(seed) },
    getItem(k) { return this._store[k] ?? null; },
    setItem(k, v) { this._store[k] = String(v); },
    removeItem(k) { delete this._store[k]; },
  };
  const fetchMock = (url) => {
    if (String(url).includes('/wallpaper-engine/settings')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, betterSidebar: false }) });
    }
    return Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({ installDir: 'D:/we', total: 1, portableCount: 1, playlists: [], wallpapers: [
        { id: 'a', title: 'Video A', type: 'video', playable: true, media: '/wallpaper-engine/media/a', preview: null, contentrating: 'Everyone' },
      ] }),
    });
  };
  let handoff = null;
  const windowHandlers = {};
  const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  const sandbox = {
    window: {
      __ModuleLoader__: { load: (h) => { handoff = h; } },
      setTimeout: (fn) => setTimeout(fn, 0),
      clearTimeout: (t) => clearTimeout(t),
      requestAnimationFrame: (fn) => setTimeout(() => fn(), 0), // 合帧直通但保持异步边界
      cancelAnimationFrame: (id) => clearTimeout(id),
      MutationObserver,
      addEventListener: (type, fn) => { (windowHandlers[type] ||= []).push(fn); },
      removeEventListener: () => {},
      _fire(type, evt) { for (const fn of windowHandlers[type] || []) fn(evt); },
    },
    document: doc, localStorage: localStorageMock, fetch: fetchMock, React, MutationObserver,
    confirm: () => true,
  };
  vm.createContext(sandbox);
  new vm.Script(code, { filename: 'client.js' }).runInContext(sandbox);
  const requireMock = (spec) => {
    if (spec === 'react') return React;
    if (spec === 'react-dom') return { createPortal: (node) => node };
    throw new Error('unexpected require: ' + spec);
  };
  const exportsObj = handoff.factory(requireMock);
  const ctx = {
    slots: { inject: (_k, cb) => cb(), register: (_o, r) => r() },
    effect(fn) { try { fn(); } catch (e) { console.log('EFFECT-ERROR', e && e.message); failures++; } return fn; },
  };
  exportsObj.apply(ctx);
  await settle();
  return { htmlEl, bodyEl, store: localStorageMock, win: sandbox.window };
}

const baseSeed = { id: 'a', url: '/wallpaper-engine/media/a', type: 'video' };

function findDescendant(root, pred) {
  const queue = [...root.children];
  while (queue.length) {
    const el = queue.shift();
    if (pred(el)) return el;
    queue.push(...el.children);
  }
  return null;
}

// ── 场景 1: owning ───────────────────────────────────────────────────────────
{
  const h = await bootHarness({ seed: baseSeed });
  check('T2/owning html[data-we-state]=owning', h.htmlEl.attributes['data-we-state'] === 'owning');
  check('owning 上报 wallpaper-active', h.htmlEl.hasAttribute('data-dsh-wallpaper-active'));
  check('owning 上报 backdrop-active(body)', h.bodyEl.hasAttribute('data-dsh-backdrop-active'));
  check('owning 主题通道开启(glass-window)', h.bodyEl.hasAttribute('data-we-glass-window'));
  check('层已挂载(url 已解析)', !!byId['dsh-wallpaper-engine-layer']);
}

// ── 场景 2: 皮肤在场 + owner=plugin → 仍全量 owning（v0.7.1 口径）────────────
{
  const h = await bootHarness({ seed: { ...baseSeed, fontCustom: true, fontColor: '#123456' } });
  h.htmlEl.setAttribute('data-dsh-skin', 'blue-fantasy');
  MutationObserver.fireAll();
  await settle(60);
  const p = h.bodyEl.style._props;
  check('T3/皮肤在场仍 owning', h.htmlEl.attributes['data-we-state'] === 'owning');
  check('T12 液态玻璃主题通道保持(glass-window)', !!h.bodyEl.hasAttribute('data-we-glass-window'));
  check('T12 侧栏玻璃通道保持(sidebar-glass)', !!h.bodyEl.hasAttribute('data-we-sidebar-glass'));
  check('T13 字体补丁正常注入(fontCustom=true)', !!byId['we-font-patch']);
  check('配色/玻璃变量在位(--we-accent/--we-glass-alpha)', typeof p['--we-accent'] === 'string' && typeof p['--we-glass-alpha'] === 'string');
  check('层仍在屏', !!byId['dsh-wallpaper-engine-layer']);
  // 显式关闭皮肤不影响本插件（无翻转回归）
  h.htmlEl.removeAttribute('data-dsh-skin');
  MutationObserver.fireAll();
  await settle(40);
  check('皮肤移除后仍 owning（无状态抖动）', h.htmlEl.attributes['data-we-state'] === 'owning');
}

// ── 场景 3: owner=skin → idle；皮肤被关 → 自动接管 ────────────────────────────
{
  const h = await bootHarness({ seed: { ...baseSeed, appearanceOwner: 'skin' } });
  h.htmlEl.setAttribute('data-dsh-skin', 'blue-fantasy');
  MutationObserver.fireAll();
  await settle(40);
  check('T5/idle 状态位', h.htmlEl.attributes['data-we-state'] === 'idle');
  check('T5/idle 层卸载', !byId['dsh-wallpaper-engine-layer']);
  check('T5/idle scrim 卸载', !byId['dsh-wallpaper-engine-scrim']);
  check('T5/idle 无主题属性残留', !h.bodyEl.hasAttribute('data-we-glass-window') && !h.bodyEl.hasAttribute('data-we-sidebar-glass'));
  check('T5/idle 撤除我方上报', !h.htmlEl.hasAttribute('data-dsh-wallpaper-active') && !h.bodyEl.hasAttribute('data-dsh-backdrop-active'));
  // url 是瞬态派生字段（sanitize 白名单外，host=truth 下由 id 重新解析）；归属
  // 保持看 id 而非 url（url 在迁移写回时被规范剥离是设计内行为）。
  check('idle 不吞掉用户选择(id 保留)',
    JSON.parse(h.store.getItem('dsh-wallpaper-engine:selection')).id === baseSeed.id);
  h.htmlEl.removeAttribute('data-dsh-skin');
  MutationObserver.fireAll();
  await settle(40);
  check('T5b/idle→皮肤关闭自动接管', h.htmlEl.attributes['data-we-state'] === 'owning');
  check('T5b 层恢复挂载', !!byId['dsh-wallpaper-engine-layer']);
}

// ── 场景 4: 上报所有权 —— 对方先置位时不抢不撤 ────────────────────────────────
{
  const h = await bootHarness({ seed: baseSeed });
  h.bodyEl.setAttribute('data-dsh-backdrop-active', 'true'); // 模拟对方在播
  h.htmlEl.removeAttribute('data-dsh-wallpaper-active'); // 先清我方，验证后续不重写？——预期仍重写（我们的所有权独立于 body）
  MutationObserver.fireAll();
  await settle(30);
  check('上报让位: 对方 backdrop 不被清除', h.bodyEl.attributes['data-dsh-backdrop-active'] === 'true');
}

// ── 场景 5: 双引擎阻塞卡（上游先行：boot 基线即有 backdrop 且无皮肤）──────────
{
  const h = await bootHarness({
    seed: baseSeed,
    preInject: ({ bodyEl }) => bodyEl.setAttribute('data-dsh-backdrop-active', 'true'),
  });
  await settle(60);
  const card = byId['we-coex-dual-card'];
  check('T8/双引擎阻塞卡弹出', !!card);
  if (card) {
    // 处理器挂在 scrim 根上、读 e.target 的 data-act；stub 不解析 innerHTML，
    // 直接以伪造 target 派发即可走通「改用皮肤中心」决策路径。
    card.dispatch('click', { target: { getAttribute: (k) => (k === 'data-act' ? 'keep-skin' : null) } });
    await settle(40);
    check('T8/选择后归属持久化为 skin',
      JSON.parse(h.store.getItem('dsh-wallpaper-engine:selection')).appearanceOwner === 'skin');
    // 冲突源仍在 + owner=skin + 皮肤未激活 ⇒ 保持 idle（不替用户反悔，规则见 computePhase）
    check('T8/另一引擎在播期间保持 idle', h.htmlEl.attributes['data-we-state'] === 'idle');
  }
}

// ── 场景 6: reportBackdropCompat=false 逃生口 ────────────────────────────────
{
  const h = await bootHarness({ seed: { ...baseSeed, reportBackdropCompat: false } });
  check('逃生口: 不写 wallpaper-active', !h.htmlEl.hasAttribute('data-dsh-wallpaper-active'));
  check('逃生口: 不写 backdrop-active', !h.bodyEl.hasAttribute('data-dsh-backdrop-active'));
  check('逃生口: 渲染不受影响', h.htmlEl.attributes['data-we-state'] === 'owning' && !!byId['dsh-wallpaper-engine-layer']);
}

// ── 场景 7: 跨窗 storage 写入 owner=skin → 收敛 idle ─────────────────────────
{
  const h = await bootHarness({ seed: baseSeed });
  h.htmlEl.setAttribute('data-dsh-skin', 'dark-pro');
  MutationObserver.fireAll();
  await settle(30);
  check('前置: 皮肤在场默认仍 owning', h.htmlEl.attributes['data-we-state'] === 'owning');
  const next = JSON.parse(h.store.getItem('dsh-wallpaper-engine:selection'));
  next.appearanceOwner = 'skin';
  h.store.setItem('dsh-wallpaper-engine:selection', JSON.stringify(next));
  h.win._fire('storage', { key: 'dsh-wallpaper-engine:selection', storageArea: h.store, newValue: JSON.stringify(next) });
  await settle(40);
  check('跨窗同步收敛 idle', h.htmlEl.attributes['data-we-state'] === 'idle');
}

// ── 静态断言 ────────────────────────────────────────────────────────────────
{
  const src = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');
  const built = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  const serverLib = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8');
  check('T11/静态: portal 根 ref 打标(≥2 处)', (src.match(/ref: \(el\) => \{ if \(el\) stampPluginRoot\(el\)/g) || []).length >= 2);
  check('T11/静态: rope dock 宿主打标', src.includes('stampPluginRoot(host)'));
  check('C4/静态: 更新提示 z=1090', /bottom: 26px; z-index: 1090/.test(src));
  check('C4/静态: picker 模态 z=1005', /inset: 0; z-index: 1005/.test(src));
  check('C4/静态: 移动端抽屉展开隐藏拉绳', src.includes('[data-sidebar-collapsed]) .we-rope'));
  check('C5/静态: SliderRow rAF 合帧', /SliderRow[\s\S]{0,1200}requestAnimationFrame/.test(src));
  check('镜像/静态: 服务端 sanitize 含 appearanceOwner/reportBackdropCompat',
    /appearanceOwner/.test(serverLib) && serverLib.includes('reportBackdropCompat'));
  check('产物/静态: 三态字符串齐备', ['"owning"', '"yielding"', '"idle"'].every((s) => built.includes(s)));
}

console.log(failures === 0 ? '\nALL COEXISTENCE CHECKS PASSED' : '\n' + failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
