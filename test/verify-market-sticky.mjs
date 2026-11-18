#!/usr/bin/env node
/**
 * verify-market-sticky.mjs — 市场吸顶条裁切（glass-market-sticky.js）的写 / 还原 / 节拍。
 *
 * 为什么要有这一层：这条行为直接改宿主 DOM 的内联样式，出错的方式都很安静 ——
 *   · **还原判断**（05046eae 修的那类）：Chrome 会把我们写下的 mask 原串规范化
 *     （省掉 "to bottom"、把 rgba(0, 0, 0, 1) 写成 rgb(0, 0, 0)），若拿原串跟读回值比，
 *     「别人改过这一格」恒成立 ⇒ mask 永远撕不掉，滚回顶部后卡片墙顶部留一条缺块。
 *     这条只有「写 → 读回 → 还原」的用例能挡住，肉眼要滚一遍市场才看得见。
 *   · **去重**：比错字符串的另一种形态 —— 每次 sync 都重写两个属性（样式重算）。
 *   · **只裁最外层**：_masonryCol 的类名同样含 _masonry，子元素再叠一层同位置的切口会多一次
 *     离屏合成，父元素先还原时子元素还会留下独立的洞。
 *   · **节拍**：市场没开时不许留定时器（glass-surfaces.js 的「静止时不安排循环帧」）。
 *
 * 分节：① 还原（含「别人改过就不动」的负对照）② 去重 ③ 只裁最外层 + 门控关掉即还原
 *       ④ band 取 sticky 下沿 ⑤ 轮询只在市场挂着时开
 *
 * 夹具刻意**复刻画 Chrome 的规范化**：否则「记录读回值」与「记录原串」两种写法在单测里
 * 恒等，这条回归判据就成了恒真。
 *
 * Usage: node test/verify-market-sticky.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'packages', 'glass', 'src', 'glass-market-sticky.js'), 'utf8');

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log('  ✓ ' + name + (detail ? ' — ' + detail : ''));
  else { failed += 1; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
};

/** Chrome 对我们这两种 mask 的序列化：去掉 "to bottom"，rgba(...,1) → rgb(...)。 */
const normalizeCss = (v) => String(v)
  .replace('linear-gradient(to bottom, ', 'linear-gradient(')
  .replace(/rgba\(0, 0, 0, 1\)/g, 'rgb(0, 0, 0)');

function makeStyle() {
  const props = new Map();
  return {
    _props: props,
    _sets: 0,
    setProperty(k, v) { props.set(k, String(v)); this._sets += 1; },
    removeProperty(k) { props.delete(k); },
    getPropertyValue(k) { return props.has(k) ? normalizeCss(props.get(k)) : ''; },
    getPropertyPriority() { return ''; },
  };
}

const matchesSelector = (el, sel) => sel.split(',').some((part) => {
  const m = /^\[class\*="([^"]+)"\]$/.exec(part.trim());
  return m ? String(el.className).includes(m[1]) : false;
});

function makeEl(opts = {}) {
  const el = {
    className: opts.cls || '',
    tagName: 'DIV',
    style: makeStyle(),
    parentElement: opts.parent || null,
    children: [],
    _pos: opts.pos || 'static',
    _rect: opts.rect || { top: 0, bottom: 0, height: 0 },
    getBoundingClientRect() { return { ...el._rect }; },
    matches(sel) { return matchesSelector(el, sel); },
    closest(sel) { let n = el; while (n) { if (n.matches && n.matches(sel)) return n; n = n.parentElement; } return null; },
    querySelectorAll(sel) {
      const out = [];
      const walk = (node) => {
        for (const child of node.children) { if (child.matches && child.matches(sel)) out.push(child); walk(child); }
      };
      walk(el);
      return out;
    },
    querySelector(sel) { return el.querySelectorAll(sel)[0] || null; },
  };
  if (el.parentElement) el.parentElement.children.push(el);
  return el;
}

/** 一次「独立运行」的夹具：document / window / getComputedStyle 全部重造，模块状态互不残留。 */
function makeEnv({ market = null, attr = '26' } = {}) {
  const attrs = new Map();
  if (attr !== null) attrs.set('data-we-market-sticky', attr);
  const body = {
    hasAttribute: (n) => attrs.has(n),
    getAttribute: (n) => (attrs.has(n) ? attrs.get(n) : null),
    setAttribute: (n, v) => { attrs.set(n, String(v)); },
    removeAttribute: (n) => { attrs.delete(n); },
  };
  const listeners = new Map();
  const timers = new Set();
  let timerSeq = 0;
  const document = {
    body,
    visibilityState: 'visible',
    querySelector: (sel) => (sel === '[data-dsh-market-root]' ? market : null),
    addEventListener: (t) => { listeners.set('doc:' + t, true); },
    removeEventListener: (t) => { listeners.delete('doc:' + t); },
  };
  const window = {
    addEventListener: (t) => { listeners.set('win:' + t, true); },
    removeEventListener: (t) => { listeners.delete('win:' + t); },
    setInterval: () => { timerSeq += 1; timers.add(timerSeq); return timerSeq; },
    clearInterval: (id) => { timers.delete(id); },
  };
  return { document, window, body, attrs, listeners, timers, getComputedStyle: (el) => ({ position: el._pos }) };
}

function buildModule(env) {
  globalThis.document = env.document;
  globalThis.window = env.window;
  globalThis.getComputedStyle = env.getComputedStyle;
  globalThis.requestAnimationFrame = (cb) => { cb(); return 1; };
  globalThis.cancelAnimationFrame = () => {};
  const factory = new Function(SRC + '\nreturn { marketStickyPaint, marketStickyRestoreOne, marketStickySync, marketStickyBand, marketStickyFade, syncMarketStickyClip, stopMarketStickyClip };');
  return factory();
}

// ── ① 还原：写 → 读回（已规范化）→ 还原 ───────────────────────────────────────
{
  console.log('① 还原（05046eae 那类：读回值 vs 原串）');
  const env = makeEnv();
  const mod = buildModule(env);
  const el = makeEl({ cls: 'nUhMVa_masonry', rect: { top: 506, bottom: 2742, height: 2236 } });
  mod.marketStickyPaint(el, 73.5, 26, 2236);
  const read = el.style.getPropertyValue('mask-image');
  check('写下去后读回的是规范化值（夹具复刻 Chrome）', read === 'linear-gradient(rgba(0, 0, 0, 0) 73.5px, rgb(0, 0, 0) 99.5px)', read);
  mod.marketStickyRestoreOne(el);
  check('读回值 = 我们写的（规范化后）⇒ 还原成功', el.style.getPropertyValue('mask-image') === '',
    'mask=' + JSON.stringify(el.style.getPropertyValue('mask-image')));
  check('-webkit-mask-image 一起还', el.style.getPropertyValue('-webkit-mask-image') === '');

  // 负对照：别人在这期间改过这一格 ⇒ 还原必须让路（否则会擦掉别人的样式）。
  const el2 = makeEl({ cls: 'nUhMVa_masonry' });
  mod.marketStickyPaint(el2, 40, 26, 800);
  el2.style.setProperty('mask-image', 'linear-gradient(rgb(0, 0, 0), rgb(255, 255, 255))');
  mod.marketStickyRestoreOne(el2);
  check('别人改过 ⇒ 还原让路（不擦别人的样式）',
    el2.style.getPropertyValue('mask-image') === 'linear-gradient(rgb(0, 0, 0), rgb(255, 255, 255))');
}

// ── ② 去重：同一切口第二次 sync 不许重写 ─────────────────────────────────────
{
  console.log('② 去重（原串 vs 读回值比错的那一类）');
  const env = makeEnv();
  const mod = buildModule(env);
  const el = makeEl({ cls: 'nUhMVa_masonry' });
  const before = el.style._sets;
  mod.marketStickyPaint(el, 73.5, 26, 2000);
  const once = el.style._sets - before;
  mod.marketStickyPaint(el, 73.5, 26, 2000);
  check('同一切口：第一次写 2 个属性，第二次 0 次', once === 2 && el.style._sets - before === 2,
    'sets=' + (el.style._sets - before));
  mod.marketStickyPaint(el, 74, 26, 2000);
  check('切口变了：重写', el.style._sets - before === 4);
}

// ── ③ 只裁最外层 + 门控关掉即还原 ────────────────────────────────────────────
{
  console.log('③ 只裁最外层 / 门控关掉');
  const root = makeEl({});
  const head = makeEl({ cls: 'nUhMVa_stickyHead', pos: 'sticky', rect: { top: 248, bottom: 352, height: 104 }, parent: root });
  const masonry = makeEl({ cls: 'nUhMVa_masonry', rect: { top: 306, bottom: 2500, height: 2194 }, parent: root });
  const col = makeEl({ cls: 'nUhMVa_masonryCol', rect: { top: 306, bottom: 2400, height: 2094 }, parent: masonry });
  const env = makeEnv({ market: root, attr: '26' });
  const mod = buildModule(env);
  mod.marketStickySync();
  check('卡片墙在吸顶条下沿被裁（band 352 − top 306 = 46px，渐隐 26 ⇒ 72px）',
    masonry.style.getPropertyValue('mask-image') === 'linear-gradient(rgba(0, 0, 0, 0) 46px, rgb(0, 0, 0) 72px)',
    masonry.style.getPropertyValue('mask-image'));
  check('子元素（masonryCol）不再单独叠一层', col.style.getPropertyValue('mask-image') === '');
  check('吸顶行本身不动', head.style.getPropertyValue('mask-image') === '');
  env.body.removeAttribute('data-we-market-sticky');
  mod.marketStickySync();
  check('门控摘掉 ⇒ 全部还原', masonry.style.getPropertyValue('mask-image') === '' && col.style.getPropertyValue('mask-image') === '');
}

// ── ④ band：只认 sticky/fixed 的 bottom，取最大值 ─────────────────────────────
{
  console.log('④ band 口径');
  const root = makeEl({});
  makeEl({ cls: 'nUhMVa_head', pos: 'sticky', rect: { top: 202, bottom: 248, height: 46 }, parent: root });
  makeEl({ cls: 'nUhMVa_cats', pos: 'sticky', rect: { top: 298, bottom: 352, height: 54 }, parent: root });
  makeEl({ cls: 'nUhMVa_catsRow', pos: 'relative', rect: { top: 298, bottom: 324, height: 26 }, parent: root });
  const mod = buildModule(makeEnv({ market: root }));
  check('band = 352（static/relative 候选不参与）', mod.marketStickyBand(root) === 352, 'band=' + mod.marketStickyBand(root));
  check('渐隐默认 26（属性在）', mod.marketStickyFade() === 26);
  const env2 = makeEnv({ attr: null });
  const mod2 = buildModule(env2);
  check('属性读不到 ⇒ 26，不是 0（Number(null) 的坑）', mod2.marketStickyFade() === 26);
}

// ── ⑤ 节拍：市场没开时零定时器 ───────────────────────────────────────────────
{
  console.log('⑤ 轮询只在市场挂着时开');
  const env = makeEnv({ market: null });
  const mod = buildModule(env);
  mod.syncMarketStickyClip();
  check('市场不在 ⇒ 不挂定时器', env.timers.size === 0, 'timers=' + env.timers.size);
  check('scroll（捕获）/ pointerdown 监听都在', env.listeners.has('win:scroll') && env.listeners.has('win:pointerdown'));
  const root = makeEl({});
  env.document.querySelector = (sel) => (sel === '[data-dsh-market-root]' ? root : null);
  mod.marketStickySync();
  check('市场出现 ⇒ 挂一个定时器', env.timers.size === 1, 'timers=' + env.timers.size);
  mod.stopMarketStickyClip();
  check('关掉 ⇒ 定时器清零', env.timers.size === 0);
}

console.log('');
if (failed > 0) {
  console.log('MARKET STICKY CHECKS FAILED — ' + failed + ' 条');
  process.exit(1);
}
console.log('ALL MARKET STICKY CHECKS PASSED');
