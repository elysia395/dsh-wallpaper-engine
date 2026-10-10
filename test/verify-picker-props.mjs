#!/usr/bin/env node
/**
 * verify-picker-props.mjs — 「壁纸属性」（WE 用户属性）面板的守卫。
 *
 * 为什么单独一个守卫：这块面板在 `test/verify-client.mjs` 的挂载台里**渲染不出来** ——
 * 那套夹具里没有带 `propsUrl` 的壁纸，`fetch` 也没有 `/props/<token>` 的应答。面板的渲染
 * 闸门是三道（`propsPanelOpen` + 选中项有 `propsUrl` + `propsState.props` 已加载），缺一道
 * 整块子树就是 `null` ⇒ 在那套夹具上写"面板长什么样"的判据只会是一条空转的绿。
 * 本文件把三道闸门都补齐：夹具给一张带 `propsUrl` 的网页壁纸、给 `/props/<token>` 一条
 * **可控**应答（在途 / 成功 / 失败三态），于是「面板渲染出了什么」第一次成为可达的判据。
 *
 * 被钉住的不变量（都是面板对外的可观察行为）：
 *   ① 入口可达：只有「场景/网页壁纸 + 有 propsUrl」才出「壁纸属性」按钮 —— 图片壁纸、
 *      没有 propsUrl 的场景壁纸都不出（同一条判据的三种输入）；
 *   ② 面板本体：读取中 → 属性行落地；分组标题（`text`/`group`）不是行；每个 ptype 出对得上
 *      的控件（bool / color / slider / combo / file / 兜底文本输入）；带 `condition` 的属性
 *      按当前值显隐；实时渲染未接管时给一句提示；
 *   ③ 改动落地：勾选 / 滑块 / 下拉 / 颜色都写进设置（`userProps`，按 token 存，200ms 去抖），
 *      **拖动中（silent）不重渲染**，「恢复默认」清掉该 token 的全部覆盖；
 *   ④ 标记等价：面板子树的 class 序列（深度优先 + 深度前缀）与搬迁前录下的 golden 逐字相同
 *      —— 它此后与渲染器所在文件（`src/picker-props-panel.js`）解耦：搬走这段标记时，
 *      这里必须原样通过。
 *
 * 判据纪律（docs/DEV-GUIDE.md §4.7 约定 5）：每条判据只定义一次（命名函数 / 命名常量），
 * 正判据与负对照**调同一个函数**，负对照喂的是**变异输入**（换夹具状态 / 改渲染树 /
 * 换宿主应答 / 改 golden），不是另抄一份判据。
 *
 * Usage: node test/verify-picker-props.mjs
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// ══ 判据（唯一一份）══════════════════════════════════════════════════════════

/** 节点上的 class 令牌（mock React 的宿主节点把 className 放在 props 里）。 */
const classTokens = (n) => {
  const c = n && n.props && n.props.className;
  return typeof c === 'string' ? c.split(/\s+/).filter(Boolean) : [];
};
const hasClass = (n, cls) => classTokens(n).includes(cls);

/** 渲染树里第一个满足谓词的节点（函数组件已被 mock React 展开成宿主节点）。 */
function findNode(root, pred) {
  let hit = null;
  (function walk(node) {
    if (hit) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    if (pred(node)) { hit = node; return; }
    if (Array.isArray(node.children)) node.children.forEach(walk);
  })(root);
  return hit;
}

/** 全部满足谓词的节点（顺序即深度优先序）。 */
function findAllNodes(root, pred) {
  const out = [];
  (function walk(node) {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    if (pred(node)) out.push(node);
    if (Array.isArray(node.children)) node.children.forEach(walk);
  })(root);
  return out;
}

const findByClass = (root, cls) => findNode(root, (n) => hasClass(n, cls));
const findAllByClass = (root, cls) => findAllNodes(root, (n) => hasClass(n, cls));

/** 子树里的字符串叶子拼接（渲染出的可见文案）。 */
function textUnder(node) {
  let out = '';
  (function walk(n) {
    if (typeof n === 'string') { out += n; return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n.children)) n.children.forEach(walk);
  })(node);
  return out;
}
const treeText = (root) => JSON.stringify(root);

/** 「壁纸属性」入口按钮（类型不对 / 没有 propsUrl / 面板所在的页签没渲染 → null）。
 *  定位按**按钮类 + 文案**：入口已并入播放控制行（排在「暂停」之前），不再有专属
 *  `--props` 类；文案仍是唯一锚（面板本体里没有同名按钮）。 */
const propsEntry = (root) => findNode(root, (n) => hasClass(n, 'we-picker__btn') && textUnder(n) === '壁纸属性');

/** 面板根（没打开 / 没有 token → null）。 */
const propsPanel = (root) => findByClass(root, 'we-picker__props');

/** 面板头部那句状态文案（读取中… / 宿主错误 / 当前条件下没有可调项 / 没有用户属性 / ""）。
 *  ⚠️ 这段文案**只写给人读的成因**：排查期曾在这里追加过一段自陈读数（` · <token> · <条数>`），
 *  问题定位后已撤除（用户口径：不要那串东西）—— `propsStamp` 因此不再是"读数"，而是
 *  **"读数不存在"的探针**，§8 用它钉住它不被加回来。 */
const propsNote = (root) => {
  const head = findByClass(root, 'we-picker__props-head');
  const note = head ? findByClass(head, 'we-picker__props-note') : null;
  return note ? textUnder(note) : null;
};
/** 排查期的自陈读数**必须不存在**：返回 null 才算对（有内容 ⇒ 有人把它加回来了）。 */
const propsStamp = (root) => {
  const raw = propsNote(root);
  if (raw === null) return null;
  return raw.indexOf('·') === -1 ? null : raw;
};

/** 属性行（`text` / `group` 是分组标题，渲染成 `we-picker__props-section`，不算行）。 */
const propRows = (root) => findAllByClass(root, 'we-picker__props-row');

/** 以标签文案定位一行（找不到 → null）。 */
const rowByLabel = (root, label) =>
  findNode(root, (n) => hasClass(n, 'we-picker__props-row') && treeText(n).includes(label));

/** 该行当前是否可见（带 condition 的属性不满足时整行不渲染）。 */
const rowVisible = (root, label) => rowByLabel(root, label) !== null;

/** 行里的某个控件（没有该控件 → null）。 */
const controlIn = (row, cls) => (row ? findByClass(row, cls) : null);

/**
 * `<select>` 的选项列表：mock React 的 `createElement(type, props, ...children)` 收到
 * 一个数组实参时会把它当成**单个** child（`children === [ [opt…] ]`）⇒ 这里摊平一层。
 */
const optionList = (selectNode) => (selectNode && Array.isArray(selectNode.children)
  ? selectNode.children.flat().filter(Boolean)
  : []);

/** 带「已改」圆点的行数（= 当前 overridden 的可见行）。 */
const overriddenRows = (root) => propRows(root).filter((r) => findByClass(r, 'we-picker__props-dot')).length;

/** 「恢复默认」按钮（面板没渲染 → null）。 */
const resetButton = (root) => {
  const head = findByClass(root, 'we-picker__props-head');
  return head ? findNode(head, (n) => n.type === 'button') : null;
};

/**
 * 面板子树的 class 令牌，按**节点**分组（深度优先 + 深度前缀 `深度:令牌`）。
 * 深度进序列 ⇒「增删一个类名」与「改一个层级」都会让下面的判据变假。
 */
function propsClassNodes(root) {
  const panel = propsPanel(root);
  if (!panel) return [];
  const nodes = [];
  (function walk(node, depth) {
    if (Array.isArray(node)) { node.forEach((c) => walk(c, depth)); return; }
    if (!node || typeof node !== 'object') return;
    const toks = classTokens(node).map((t) => depth + ':' + t);
    if (toks.length) nodes.push(toks);
    if (Array.isArray(node.children)) node.children.forEach((c) => walk(c, depth + 1));
  })(panel, 0);
  return nodes;
}
const propsClassSequence = (root) => propsClassNodes(root).flat();

/** 判据只有这一处：正判据与全部负对照都调它。 */
const sequenceMatches = (seq, golden) =>
  seq.length === golden.length && seq.every((t, i) => t === golden[i]);

// ══ 变异输入生成器（负对照专用；判据本身不改）═════════════════════════════════

/** 深拷贝渲染树，把等于 from 的字符串叶子换成 to。 */
/** 把渲染树里的某段文案换掉（负对照用）。
 *  ⚠️ 按**子串**换而不是整串相等：状态说明句后面还追加着自陈读数（` · <token> · <条数>`），
 *  说明句不再是整个字符串 —— 只在整串相等时替换的写法会静默不改，负对照随即恒假。 */
function mutateText(node, from, to) {
  if (typeof node === 'string') return node.includes(from) ? node.split(from).join(to) : node;
  if (Array.isArray(node)) return node.map((n) => mutateText(n, from, to));
  if (!node || typeof node !== 'object') return node;
  const copy = Object.assign({}, node);
  if (Array.isArray(node.children)) copy.children = node.children.map((n) => mutateText(n, from, to));
  return copy;
}

/** 深拷贝渲染树，从一个节点的 className 里剥掉一个令牌（其余不动）。 */
function dropClassToken(node, cls) {
  if (Array.isArray(node)) return node.map((n) => dropClassToken(n, cls));
  if (!node || typeof node !== 'object') return node;
  const copy = Object.assign({}, node);
  if (copy.props && typeof copy.props.className === 'string' && hasClass(node, cls)) {
    copy.props = Object.assign({}, copy.props, {
      className: classTokens(node).filter((t) => t !== cls).join(' '),
    });
  }
  if (Array.isArray(node.children)) copy.children = node.children.map((n) => dropClassToken(n, cls));
  return copy;
}

/** 深拷贝渲染树，删掉第一个带该令牌的节点整棵子树。 */
function withoutClass(node, cls) {
  if (Array.isArray(node)) return node.map((n) => withoutClass(n, cls));
  if (!node || typeof node !== 'object') return node;
  if (hasClass(node, cls)) return null;
  const copy = Object.assign({}, node);
  if (Array.isArray(node.children)) {
    copy.children = node.children.map((n) => withoutClass(n, cls)).filter((n) => n !== null);
  }
  return copy;
}

/** 序列变异：只把第一个属性行的深度 +1（长度不变，只有层级变）。 */
function bumpFirstRowDepth(seq) {
  const out = seq.slice();
  const i = out.findIndex((t) => t.endsWith(':we-picker__props-row'));
  if (i >= 0) {
    const cls = out[i].slice(out[i].indexOf(':') + 1);
    out[i] = (Number(out[i].slice(0, out[i].indexOf(':'))) + 1) + ':' + cls;
  }
  return out;
}

// ══ 挂载台 ═══════════════════════════════════════════════════════════════════
// 变异测试钩子：默认读构建产物，DSH_MUT_LIB 指向变异副本时读它。
const code = readFileSync(process.env.DSH_MUT_LIB || new URL('../lib/client.js', import.meta.url), 'utf8');

const React = {
  Fragment: 'Fragment',
  // 函数初始化器被调用（惰性 useState），与真 React 一致。
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
  useRef: (v) => ({ current: v }),
  createElement: (type, props, ...children) =>
    (typeof type === 'function' ? type(props || {}) : ({ type, props: props || null, children })),
};

const byId = {};
const sandboxTimers = [];
function makeEl(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    children: [],
    dataset: {},
    attributes: {},
    style: { _props: {}, setProperty(k, v) { this._props[k] = v; }, removeProperty(k) { delete this._props[k]; } },
    className: '',
    _parent: null,
    appendChild(c) { this.children.push(c); c._parent = this; if (c.id) byId[c.id] = c; return c; },
    remove() {
      if (this._parent) { const i = this._parent.children.indexOf(this); if (i >= 0) this._parent.children.splice(i, 1); }
      if (this.id) delete byId[this.id];
    },
    setAttribute(k, v) { this.attributes[k] = v; },
    removeAttribute(k) { delete this.attributes[k]; },
    // 实时渲染的 iframe / 视频会注册 load / error（本文件不断言事件，但注册点不能抛）。
    addEventListener() {},
    removeEventListener() {},
    focus() {},
    blur() {},
    querySelector() { return null; },
  };
}

const bodyEl = makeEl('body');
const document = {
  createElement: (t) => {
    const el = makeEl(t);
    if (t === 'img' || t === 'iframe') {
      let _src = '';
      Object.defineProperty(el, 'src', {
        get: () => _src,
        set: (v) => { _src = String(v || ''); },
      });
    }
    return el;
  },
  getElementById: (id) => byId[id] || null,
  querySelector: () => null,
  head: makeEl('head'),
  body: bodyEl,
};

const SELECTION_KEY = 'dsh-wallpaper-engine:selection';
const PICKER_TAB_KEY = 'dsh-wallpaper-engine:picker-tab';
const localStorage = {
  // 启动就选中那张**带 propsUrl 的网页壁纸**：面板三道渲染闸门里的「选中项有 propsUrl」
  // 由夹具直接满足（另两道由下面那个按钮与 /props 应答满足）。
  _store: {
    [SELECTION_KEY]: JSON.stringify({ id: 'webA' }),
    [PICKER_TAB_KEY]: 'wallpaper',
  },
  getItem(k) { return this._store[k] ?? null; },
  setItem(k, v) { this._store[k] = v; },
  removeItem(k) { delete this._store[k]; },
};

// ── 宿主侧 mock（负对照就是换这里的应答）──
const PROPS_TOKEN = 'tokA';
const PROPS_PATH = '/wallpaper-engine/props/' + PROPS_TOKEN;
const PROPS_TOKEN_B = 'tokB';
const PROPS_PATH_B = '/wallpaper-engine/props/' + PROPS_TOKEN_B;
const PROPS_FAIL_REASON = 'project.json 读不出来（测试）';

const WALLPAPERS = [
  // 三种「入口该不该出」的输入：图片（类型不对）、场景（类型对但没 propsUrl）、网页（两者都对）。
  { id: 'img1', title: '图片壁纸一', type: 'image', playable: true, media: '/wallpaper-engine/media/img1', preview: null, contentrating: 'Everyone' },
  { id: 'scn1', title: '场景壁纸一', type: 'scene', playable: true, media: null, frameUrl: '/wallpaper-engine/scene-frame/scn1', preview: null, contentrating: 'Everyone' },
  { id: 'webA', title: '网页壁纸 A', type: 'web', playable: true, media: '/wallpaper-engine/media/webA', preview: null, contentrating: 'Everyone', propsUrl: PROPS_PATH },
  // 第二张带属性入口的壁纸：用来把面板开在 A 上、期间切到 B，判"上一张的属性表不得冒充这一张"。
  { id: 'webB', title: '网页壁纸 B', type: 'web', playable: true, media: '/wallpaper-engine/media/webB', preview: null, contentrating: 'Everyone', propsUrl: PROPS_PATH_B },
];

const inventoryCalls = [];
const propsCalls = [];
const inventoryPayload = () => ({
  installDir: 'D:/we', uploadDir: 'D:/we/uploads', weAssetsDir: null, weAssetsAvailable: false,
  total: WALLPAPERS.length, portableCount: WALLPAPERS.length, playlists: [], wallpapers: WALLPAPERS,
});

/**
 * 宿主 `/props/<token>` 的应答体（与 lib/index.js 那条路由同形：ok / token / props / overrides）。
 * 属性表按 `lib/we-props.js` 的输出形状手写：每个 ptype 一条，外加一条带 condition 的。
 */
const PROPS_DEFS = [
  { name: 'look', ptype: 'text', text: '外观', order: 0, value: null, default: null, overridden: false },
  { name: 'bgcolor', ptype: 'color', text: '背景颜色', order: 1, value: '0.1 0.2 0.3', default: '0 0 0', overridden: false },
  { name: 'speed', ptype: 'slider', text: '速度', order: 2, value: 1.5, default: 1, overridden: true, min: 0, max: 4, step: 0.1, precision: 1 },
  { name: 'glow', ptype: 'bool', text: '发光', order: 3, value: false, default: false, overridden: false },
  { name: 'mode', ptype: 'combo', text: '模式', order: 4, value: 2, default: 1, overridden: false,
    options: [{ label: '慢', value: 1 }, { label: '快', value: 2 }] },
  { name: 'customImage', ptype: 'file', text: '自定义图片', order: 5, value: '', default: '', overridden: false,
    files: ['a.png', 'b.jpg'] },
  { name: 'note', ptype: 'textinput', text: '备注', order: 6, value: 'hi', default: '', overridden: false },
  { name: 'extra', ptype: 'bool', text: '仅在发光时可见', order: 7, value: false, default: false, overridden: false,
    condition: 'glow == true' },
];
const propsPayload = (props, token) => ({ ok: true, token: token || PROPS_TOKEN, props, overrides: {}, hasProject: true });

let pendingProps = null;
let propsStatus = 200;
// 2xx 时用的体（负对照 / 失败腿换它）；null = 正常的属性表。
let propsBody = null;
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};
/** 结算在途的 /props 请求：status + 宿主体（非 2xx 的 { error } 就是失败腿的原因）。 */
function settleProps(status, body) {
  if (!pendingProps) throw new Error('harness: settleProps 必须在有在途请求时调用');
  const p = pendingProps;
  pendingProps = null;
  p.resolve({ status, json: () => Promise.resolve(body) });
}

const fetch = (url, opts) => {
  const u = String(url);
  const method = String((opts && opts.method) || 'GET').toUpperCase();
  if (u.includes('/wallpaper-engine/inventory')) {
    inventoryCalls.push(u);
    return Promise.resolve({ status: 200, json: () => Promise.resolve(inventoryPayload()) });
  }
  if (u.includes('/wallpaper-engine/props/')) {
    propsCalls.push({ url: u, method });
    if (propsStatus !== 200) {
      return Promise.resolve({ status: propsStatus, json: () => Promise.resolve({ ok: false, error: PROPS_FAIL_REASON }) });
    }
    if (propsBody) return Promise.resolve({ status: 200, json: () => Promise.resolve(propsBody) });
    pendingProps = deferred();
    return pendingProps.promise;
  }
  if (u.includes('/wallpaper-engine/settings')) {
    return Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true }) });
  }
  return Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true }) });
};

const winListeners = {};
const docListeners = {};
const addTo = (reg) => (ev, fn) => { (reg[ev] ||= []).push(fn); };
const removeFrom = (reg) => (ev, fn) => {
  const a = reg[ev]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
};

const cap = { handoff: null };
const sandbox = {
  window: {
    __ModuleLoader__: { load: (h) => { cap.handoff = h; } },
    setTimeout: (fn, ms) => { const t = { fn, ms, cleared: false }; sandboxTimers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.cleared = true; },
    addEventListener: addTo(winListeners),
    removeEventListener: removeFrom(winListeners),
  },
  document, localStorage, fetch, React,
  // 浏览器里裸 setTimeout/setInterval 就是 window 上的 —— 沙箱同样提供（持久化去抖、
  // 轮换定时器、live 心跳都走它们；缺了这些路径会静默退化成本文件测不到的形态）。
  setTimeout: (fn, ms) => { const t = { fn, ms, cleared: false }; sandboxTimers.push(t); return t; },
  clearTimeout: (t) => { if (t) t.cleared = true; },
  setInterval: (fn, ms) => { const t = { fn, ms, cleared: false, interval: true }; sandboxTimers.push(t); return t; },
  clearInterval: (t) => { if (t) t.cleared = true; },
};
document.addEventListener = addTo(docListeners);
document.removeEventListener = removeFrom(docListeners);
vm.createContext(sandbox);
new vm.Script(code, { filename: 'client.js' }).runInContext(sandbox);

const { factory } = cap.handoff;
const requireMock = (spec) => {
  if (spec === 'react') return React;
  if (spec === 'react-dom') return { createPortal: (node) => node };
  throw new Error('unexpected require: ' + spec);
};
const exportsObj = factory(requireMock);

const pickerRenders = [];
const slots = {
  inject: (key, cb) => cb(),
  register: (opts, render) => { pickerRenders.push(render); },
};
// ctx.effect 立刻执行（与 fiber 首次提交同序），否则订阅没挂上、emit() 不重渲染。
const ctx = { slots, effect(fn) { fn(); return fn; } };
exportsObj.apply(ctx);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(80); // 等 loadPersisted → loadInventory → revalidateSelection 这条启动链落定

// ── 标记等价 golden ──────────────────────────────────────────────────────────
// 搬迁**前**从入库产物（lib/client.js）录下的面板子树 class 序列：面板从 WallpaperPicker
// 体内搬进 `src/picker-props-panel.js` 时，标记必须逐字未变（含嵌套层级）。序列按**节点**
// 分组，每行一个节点，令牌形如 `深度:类名`。
const EXPECTED_PROPS_GOLDEN = [
  // 面板骨架：头部（标题 / 状态说明 / 恢复默认）+ 实时渲染提示
  '0:we-picker__props',
  '1:we-picker__props-head',
  '2:we-picker__props-title',
  '2:we-picker__props-note',
  '2:we-picker__btn 2:we-picker__btn--mini',
  '1:we-picker__props-hint',
  // 分组标题（ptype=text）
  '1:we-picker__props-section',
  // color
  '1:we-picker__props-row',
  '2:we-picker__props-label',
  '2:we-picker__props-color',
  // slider（控件是 Fragment：range + 数值回显，故深度 3）
  '1:we-picker__props-row',
  '2:we-picker__props-label',
  '3:we-picker__slider',
  '3:we-picker__props-value',
  // bool
  '1:we-picker__props-row',
  '2:we-picker__props-label',
  '2:we-picker__props-check',
  // combo
  '1:we-picker__props-row',
  '2:we-picker__props-label',
  '2:we-picker__props-select',
  // file
  '1:we-picker__props-row',
  '2:we-picker__props-label',
  '2:we-picker__props-select',
  // 兜底文本输入（ptype=textinput）
  '1:we-picker__props-row',
  '2:we-picker__props-label',
  '2:we-picker__props-text',
].join(' ').split(' ');
const EXPECTED_PROPS_LENGTH = 27;

// ══ 检查 ═════════════════════════════════════════════════════════════════════
let failures = 0;
const check = (label, cond, detail) => {
  if (cond) console.log('  ✓ ' + label + (detail ? ' — ' + detail : ''));
  else { failures++; console.log('  ✗ ' + label + (detail ? ' — ' + detail : '')); }
};

const hasPickerRender = (renders) => renders.length > 0;
const render = () => pickerRenders[0]();
/** 落盘是 200ms 去抖：读 localStorage 前必须先把在途 persist 放掉。 */
const flushPersist = () => {
  for (const t of sandboxTimers.filter((x) => !x.cleared && !x.fired && x.ms === 200)) {
    t.fired = true;
    t.fn();
  }
};
const persisted = () => JSON.parse(localStorage._store[SELECTION_KEY] || '{}');
const persistedUserProps = () => persisted().userProps || {};

/** 打开库视图（「选择壁纸」入口）。 */
function openModal(root) {
  const btn = findNode(root, (n) => hasClass(n, 'we-picker__btn')
    && Array.isArray(n.children) && n.children.length === 1 && n.children[0] === '选择壁纸');
  if (!btn) throw new Error('harness: 找不到「选择壁纸」入口');
  btn.props.onClick();
}
/** 退出库视图（「返回」入口；页内下钻后页签内容要经它才回来）。 */
function closeModal(root) {
  const btn = findNode(root, (n) => hasClass(n, 'we-picker__btn')
    && Array.isArray(n.children) && n.children.length === 1 && n.children[0] === '返回');
  if (!btn) throw new Error('harness: 找不到库视图的「返回」入口');
  btn.props.onClick();
}
/** 在模态框网格里点一张卡（按标题定位）。 */
function pickCard(root, title) {
  const card = findNode(root, (n) => hasClass(n, 'we-picker__card') && n.props && n.props.title === title);
  if (!card) throw new Error('harness: 网格里没有这张卡：' + title);
  card.props.onClick();
}

console.log('0. 挂载台自检');
{
  check('挂载：settings.section 注册了 picker 渲染回调（否则后面每条判据都在空跑）',
    hasPickerRender(pickerRenders), 'render 回调 ' + pickerRenders.length + ' 个');
  check('夹具：启动链确实拉过库存（判据读的是真渲染，不是空树）',
    inventoryCalls.length >= 1, inventoryCalls.length + ' 次 /inventory');
}

console.log('\n1. 入口可达：只有「场景/网页 + propsUrl」才出「壁纸属性」');
let tree = render();
{
  check('网页壁纸（有 propsUrl）⇒ 出「壁纸属性」按钮',
    !!propsEntry(tree) && textUnder(propsEntry(tree)) === '壁纸属性');
  // 同一条判据的另外两种输入：图片壁纸（类型不对）与场景壁纸（类型对但没 propsUrl）。
  // 页内下钻后「壁纸属性」入口住在页签内容里 ⇒ 每次选完先经「返回」退出库视图再判。
  openModal(tree);
  tree = render();
  pickCard(tree, '图片壁纸一');
  tree = render();
  closeModal(tree);
  tree = render();
  check('图片壁纸 ⇒ 不出（同一条判据，换输入）', propsEntry(tree) === null);
  openModal(tree);
  tree = render();
  pickCard(tree, '场景壁纸一');
  tree = render();
  closeModal(tree);
  tree = render();
  check('场景壁纸（无 propsUrl）⇒ 不出（类型对也拦得住）', propsEntry(tree) === null);
  openModal(tree);
  tree = render();
  pickCard(tree, '网页壁纸 A');
  tree = render();
  closeModal(tree);
  tree = render();
  check('切回网页壁纸 ⇒ 按钮回来（判据对输入敏感，不是恒假）', propsEntry(tree) !== null);
  // 负对照：把两种变异输入（文案不符 / 类不符）喂进同一条判据 —— 各判"不出"
  check('负对照：文案不符或类不符的按钮树，同一条判据判为"不出"',
    propsEntry({ props: { className: 'we-picker__btn' }, children: ['别的按钮'] }) === null
      && propsEntry({ props: { className: 'we-picker__card' }, children: ['壁纸属性'] }) === null);
}

console.log('\n2. 面板本体：在途 → 落地（先证明它真的渲染出来了）');
{
  propsEntry(tree).props.onClick();
  tree = render();
  check('点「壁纸属性」⇒ 真的发出一次 /props/<token> 请求（面板不是靠假状态画出来的）',
    propsCalls.length === 1 && propsCalls[0].url.endsWith('/props/' + PROPS_TOKEN),
    propsCalls.map((c) => c.url).join(' ') || '（一次都没发）');
  check('应答未落定 ⇒ 面板已渲染，头部说明是「读取中…」',
    !!propsPanel(tree) && propsNote(tree) === '读取中…');
  check('读取中不得先把行画出来（此时宿主还没给属性表）', propRows(tree).length === 0);
  // 负对照：同一条状态文案判据喂变异输入（改掉那句文案 / 删掉整块头部）
  check('负对照：把「读取中…」换成别的文案后，同一条判据判为假',
    propsNote(mutateText(tree, '读取中…', '读取完毕')) !== '读取中…');
  check('负对照：删掉头部后同一条判据给 null（不是"恰好也算读取中"）',
    propsNote(withoutClass(tree, 'we-picker__props-head')) === null);

  settleProps(200, propsPayload(PROPS_DEFS));
  await sleep(0); // 等 .then 链落地（loadUserPropDefs → propsState 更新）
  tree = render();
  const panel = propsPanel(tree);
  check('属性表落地 ⇒ 面板渲染出来（防空跑锚点：根 + 头部都在）',
    !!panel && !!findByClass(tree, 'we-picker__props-head') && !!findByClass(tree, 'we-picker__props-title'));
  // 绝对锚点：8 条属性里 1 条分组标题（不是行）、1 条带 condition 被藏起来 ⇒ 6 行
  check('绝对锚点：可见属性行 = 6（8 条属性 − 1 分组标题 − 1 条件不满足）',
    propRows(tree).length === 6, propRows(tree).length + ' 行');
  check('分组标题（ptype=text）渲染成 section，不占行',
    !!findByClass(tree, 'we-picker__props-section')
      && textUnder(findByClass(tree, 'we-picker__props-section')).includes('外观'));
  check('落地后头部说明清空（不再声称读取中）', propsNote(tree) === '');
  check('实时渲染未接管 ⇒ 明说改动何时生效（sel.sceneLiveActive 为假）',
    textUnder(findByClass(tree, 'we-picker__props-hint')).includes('实时渲染当前未接管'));
  check('已改过的属性带「已改」圆点（本夹具恰好 1 条 overridden）',
    overriddenRows(tree) === 1, overriddenRows(tree) + ' 条');
  // 负对照：把渲染树里的行整批删掉，同一条锚点判据必须判假
  check('负对照：空面板不得算作「行数达标」',
    propRows(withoutClass(tree, 'we-picker__props-row')).length === 0
      && propRows(withoutClass(tree, 'we-picker__props-row')).length !== 6);
}

console.log('\n3. 每个 ptype 出对得上的控件（renderUserPropRow 的各分支）');
{
  const boolRow = rowByLabel(tree, '发光');
  const boolInput = controlIn(boolRow, 'we-picker__props-check');
  check('bool ⇒ checkbox（且未勾选时 checked === false）',
    !!boolInput && boolInput.type === 'input' && boolInput.props.type === 'checkbox'
      && boolInput.props.checked === false);

  const colorInput = controlIn(rowByLabel(tree, '背景颜色'), 'we-picker__props-color');
  check('color ⇒ type=color，WE 的 "r g b" 浮点串换算成 #rrggbb（0.1/0.2/0.3 ⇒ #1a334d）',
    !!colorInput && colorInput.props.type === 'color' && colorInput.props.value === '#1a334d',
    colorInput ? String(colorInput.props.value) : '（没有颜色控件）');

  const sliderRow = rowByLabel(tree, '速度');
  const sliderInput = controlIn(sliderRow, 'we-picker__slider');
  check('slider ⇒ range，min/max/step 来自属性声明',
    !!sliderInput && sliderInput.props.min === 0 && sliderInput.props.max === 4 && sliderInput.props.step === 0.1);
  const shownValue = findByClass(sliderRow, 'we-picker__props-value');
  check('slider 的数值回显按 precision 格式化（1.5 ⇒ "1.5"）',
    !!shownValue && textUnder(shownValue) === '1.5', shownValue ? textUnder(shownValue) : '（没有回显）');

  const comboSelect = controlIn(rowByLabel(tree, '模式'), 'we-picker__props-select');
  const comboLabels = optionList(comboSelect).map((o) => textUnder(o));
  check('combo ⇒ select，值用**下标**（声明值 2 ⇒ "1"），选项文案来自宿主',
    !!comboSelect && comboSelect.props.value === '1'
      && JSON.stringify(comboLabels) === JSON.stringify(['慢', '快']),
    JSON.stringify(comboLabels));

  const fileSelect = controlIn(rowByLabel(tree, '自定义图片'), 'we-picker__props-select');
  const fileValues = optionList(fileSelect).map((o) => o.props && o.props.value);
  check('file ⇒ select：首项是「（默认）」空值，候选文件来自宿主',
    !!fileSelect && fileSelect.props.value === ''
      && JSON.stringify(fileValues) === JSON.stringify(['', 'a.png', 'b.jpg']),
    JSON.stringify(fileValues));

  const textInput = controlIn(rowByLabel(tree, '备注'), 'we-picker__props-text');
  check('兜底分支（textinput）⇒ 文本输入，默认值是宿主给的值',
    !!textInput && textInput.props.type === 'text' && textInput.props.defaultValue === 'hi');
  // 负对照：把变异输入（换成别的行）喂进同一条「控件在不在这一行」判据
  check('负对照：颜色行里没有 checkbox（同一条控件判据对别的行判为 null）',
    controlIn(rowByLabel(tree, '背景颜色'), 'we-picker__props-check') === null);
  check('负对照：滑块行里没有文本输入（分支没被张冠李戴）',
    controlIn(rowByLabel(tree, '速度'), 'we-picker__props-text') === null);
}

console.log('\n4. condition 显隐：条件属性按当前值进出（不是一次性渲染）');
{
  check('glow == false ⇒ 「仅在发光时可见」那一行不渲染', !rowVisible(tree, '仅在发光时可见'));
  const boolInput = controlIn(rowByLabel(tree, '发光'), 'we-picker__props-check');
  boolInput.props.onChange({ target: { checked: true } });
  tree = render();
  check('勾上 glow ⇒ 条件成立，那一行出现（行数 6 → 7）',
    rowVisible(tree, '仅在发光时可见') && propRows(tree).length === 7,
    propRows(tree).length + ' 行');
  // 负对照：同一条「行可见」判据喂变异输入（把标签文案改掉 / 喂一棵空树）
  check('负对照：把标签文案改掉后同一条判据判为不可见',
    !rowVisible(mutateText(tree, '仅在发光时可见', '改过的标签'), '仅在发光时可见'));
  check('负对照：空渲染树对同一条判据一律不可见', !rowVisible({}, '仅在发光时可见'));
}

console.log('\n5. 改动落地：写进设置（按 token 存）+ 拖动中不重渲染 + 恢复默认');
{
  flushPersist();
  check('勾选 ⇒ 落进设置的 userProps[token]（200ms 去抖后写进 localStorage）',
    persistedUserProps()[PROPS_TOKEN] && persistedUserProps()[PROPS_TOKEN].glow === true,
    JSON.stringify(persistedUserProps()));
  // 负对照：同一条落盘判据喂变异输入（换 token / 换值都读不出来）
  check('负对照：换个 token 读同一条判据 ⇒ 读不到（判据真的按 token 取）',
    !(persistedUserProps()['other-token'] && persistedUserProps()['other-token'].glow === true));

  const comboSelect = controlIn(rowByLabel(tree, '模式'), 'we-picker__props-select');
  comboSelect.props.onChange({ target: { value: '1' } });   // 下标 1 ⇒ 声明值 2
  tree = render();
  flushPersist();
  check('combo 改动按**声明类型**回写（下标 1 ⇒ 数字 2，不是字符串 "2"）',
    persistedUserProps()[PROPS_TOKEN].mode === 2, JSON.stringify(persistedUserProps()[PROPS_TOKEN]));

  const fileSelect = controlIn(rowByLabel(tree, '自定义图片'), 'we-picker__props-select');
  fileSelect.props.onChange({ target: { value: 'b.jpg' } });
  tree = render();
  flushPersist();
  check('file 改动回写相对路径', persistedUserProps()[PROPS_TOKEN].customImage === 'b.jpg');

  const colorInput = controlIn(rowByLabel(tree, '背景颜色'), 'we-picker__props-color');
  colorInput.props.onChange({ target: { value: '#ff0000' } });
  tree = render();
  flushPersist();
  check('color 改动回写成 WE 的 "r g b" 浮点串',
    persistedUserProps()[PROPS_TOKEN].bgcolor === '1 0 0', String(persistedUserProps()[PROPS_TOKEN].bgcolor));

  // 滑块：拖动（input，silent）只写设置、不重渲染；change 才刷新数值回显
  const sliderInput = controlIn(rowByLabel(tree, '速度'), 'we-picker__slider');
  sliderInput.props.onInput({ target: { value: '3' } });
  flushPersist();
  check('滑块拖动（silent）⇒ 设置里已是新值',
    Number(persistedUserProps()[PROPS_TOKEN].speed) === 3);
  check('滑块拖动（silent）⇒ 旧渲染树里的回显**没变**（拖动中不 emit）',
    textUnder(findByClass(rowByLabel(tree, '速度'), 'we-picker__props-value')) === '1.5');
  controlIn(rowByLabel(tree, '速度'), 'we-picker__slider').props.onChange({ target: { value: '3' } });
  tree = render();
  check('滑块 change ⇒ 重渲染后回显跟上（precision=1 ⇒ "3.0"）',
    textUnder(findByClass(rowByLabel(tree, '速度'), 'we-picker__props-value')) === '3.0');

  // 恢复默认：清掉该 token 的全部覆盖，回显回默认值
  const reset = resetButton(tree);
  check('「恢复默认」在**有覆盖**时可用', !!reset && reset.props.disabled === false);
  reset.props.onClick();
  tree = render();
  flushPersist();
  check('恢复默认 ⇒ 该 token 的覆盖整条消失（不是留一个空对象）',
    !(PROPS_TOKEN in persistedUserProps()), JSON.stringify(persistedUserProps()));
  check('恢复默认 ⇒ 没有任何行再带「已改」圆点', overriddenRows(tree) === 0);
  check('恢复默认 ⇒ 按钮自己变成不可用（没有可恢复的东西了）',
    resetButton(tree).props.disabled === true);
  check('恢复默认 ⇒ 回显回到宿主给的默认值（3.0 ⇒ 1.0）',
    textUnder(findByClass(rowByLabel(tree, '速度'), 'we-picker__props-value')) === '1.0');
}

console.log('\n6. 标记等价：面板子树的 class 序列与搬迁前逐字一致');
{
  // 复现「刚落地」那个状态：把 glow 关回去（条件行随之消失），值不影响 class 序列。
  const glowInput = controlIn(rowByLabel(tree, '发光'), 'we-picker__props-check');
  if (glowInput) { glowInput.props.onChange({ target: { checked: false } }); tree = render(); }
  const nodes = propsClassNodes(tree);
  const seq = propsClassSequence(tree);
  check('绝对锚点：面板 class 令牌数（空序列不得算通过）', seq.length === EXPECTED_PROPS_LENGTH,
    seq.length + ' 个令牌');
  check('绝对锚点：面板里确实有 6 行（防"两边都空"也算等价）', propRows(tree).length === 6);
  check('面板标记序列与搬迁前录下的 golden 逐字一致', sequenceMatches(seq, EXPECTED_PROPS_GOLDEN));
  // 负对照：把**变异输入**喂进同一条判据
  check('负对照：删掉一个类名 ⇒ 判据变假',
    !sequenceMatches(seq.filter((_, i) => i !== 4), EXPECTED_PROPS_GOLDEN));
  check('负对照：插入一个类名 ⇒ 判据变假',
    !sequenceMatches(seq.concat(['0:we-picker__props-fake']), EXPECTED_PROPS_GOLDEN));
  check('负对照：只把一个节点的层级挪一格（长度不变）⇒ 判据变假',
    !sequenceMatches(bumpFirstRowDepth(seq), EXPECTED_PROPS_GOLDEN));
  check('负对照：空序列不得算作"一致"', !sequenceMatches([], EXPECTED_PROPS_GOLDEN));
  check('负对照：删掉整棵面板（root 为 null）⇒ 序列为空、判据变假',
    !sequenceMatches(propsClassSequence(withoutClass(tree, 'we-picker__props')), EXPECTED_PROPS_GOLDEN));
  // 判据自身可达性：把节点分组也检查一遍（golden 是按节点分组的）
  check('判据非空转：节点分组数与序列非空', nodes.length > 10 && seq.length > 0);
}

console.log('\n7. 失败腿：宿主非 2xx / 2xx 但体说 not-ok ⇒ 头部给出可读原因（不假装成"没有属性"）');
{
  // 关掉再打开是**强制**重拉（按钮处理器用的是 force=true），用它换应答重走一遍同一块面板。
  const togglePanel = () => { propsEntry(tree).props.onClick(); tree = render(); };
  togglePanel();  // 关

  // 腿 A：宿主非 2xx（apiFetch 默认不解析非 2xx 的体）⇒ 客户端自己的兜底文案
  propsStatus = 503;
  togglePanel();
  await sleep(0);
  tree = render();
  check('宿主 503 ⇒ 面板头部显示「读取失败」，且不画任何属性行',
    propsNote(tree) === '读取失败' && propRows(tree).length === 0,
    String(propsNote(tree)));
  check('失败态下「恢复默认」不可用（没有属性可恢复）',
    resetButton(tree).props.disabled === true);
  // 负对照：同一条状态文案判据喂变异输入（把「读取失败」换成别的文案）
  check('负对照：把「读取失败」换成别的文案后，同一条判据判为假',
    propsNote(mutateText(tree, '读取失败', '读取成功')) !== '读取失败');

  // 腿 B：2xx 但体里 ok:false ⇒ 直接用宿主给的原因
  propsStatus = 200;
  propsBody = { ok: false, error: PROPS_FAIL_REASON };
  togglePanel();  // 关
  togglePanel();  // 开（强制重拉）
  await sleep(0);
  tree = render();
  check('2xx + {ok:false,error} ⇒ 头部显示宿主给的原因（不是客户端兜底文案）',
    propsNote(tree) === PROPS_FAIL_REASON, String(propsNote(tree)));
  check('负对照：换成客户端兜底文案后同一条判据判为假', propsNote(tree) !== '读取失败');

  // 复位：成功应答 ⇒ 面板回来（证明失败态不是单向门）
  propsBody = null;
  togglePanel();
  togglePanel();
  settleProps(200, propsPayload(PROPS_DEFS));
  await sleep(0);
  tree = render();
  check('重拉成功 ⇒ 属性行回来（失败是可恢复的）', propRows(tree).length === 6,
    propRows(tree).length + ' 行');
}

console.log('\n8. 说明句按**成因**自陈（空表的三种成因必须能分辨；排查期的读数已撤除）');
{
  // 成功态：说明句为空，但读数必须写出来（` · tokA · 8`）。
  // ⚠️ 读数是**宿主给的定义条数**（8），不是可见行数（6 = 8 − 1 分组标题 − 1 条件不满足）：
  //    这两个数必须能分别读出来，否则"条件挡住"与"宿主没给"看起来一模一样。
  check('成功态：说明句为空，且头部**没有**任何读数（排查期的 token/条数已撤除）',
    propsNote(tree) === '' && propsStamp(tree) === null, JSON.stringify(propsNote(tree)));
  check('负对照：把读数加回来会被同一条判据判出',
    propsStamp({ type: 'div', props: { className: 'we-picker__props-head' }, children: [
      { type: 'span', props: { className: 'we-picker__props-note' }, children: [' · tokA · 8'] },
    ] }) !== null);

  // 空表：宿主答了"这张没有属性" ⇒ 说明句必须点明成因（不再是一块什么都看不出来的空面板）。
  const toggle = () => { propsEntry(tree).props.onClick(); tree = render(); };
  propsBody = propsPayload([], PROPS_TOKEN);
  toggle(); toggle();
  await sleep(0);
  tree = render();
  check('宿主回空表 ⇒ 头部说明「这张壁纸没有用户属性…」（且没有读数）',
    propsNote(tree) === '这张壁纸没有用户属性（project.json 的 general.properties）'
      && propsStamp(tree) === null, String(propsNote(tree)));
  check('负对照：空表不得被说成「当前条件下没有可调项」（两种成因分开写）',
    propsNote(tree) !== '当前条件下没有可调项');
  check('负对照：空表也不得显示「读取中…」', propsNote(tree) !== '读取中…');

  // 条件把属性全挡住：另一种"看着像空"的成因，说法必须不同。
  const ALL_HIDDEN = [
    { name: 'bgcolor', ptype: 'color', text: '背景颜色', value: '0 0 0', default: '0 0 0', overridden: false, condition: 'glow == true' },
    { name: 'glow', ptype: 'bool', text: '发光', value: false, default: false, overridden: false, condition: 'bgcolor != "0 0 0"' },
  ];
  propsBody = propsPayload(ALL_HIDDEN, PROPS_TOKEN);
  toggle(); toggle();
  await sleep(0);
  tree = render();
  check('属性都被 condition 挡住 ⇒ 头部说明「当前条件下没有可调项」（读数不存在）',
    propsNote(tree) === '当前条件下没有可调项' && propsStamp(tree) === null
      && propRows(tree).length === 0, String(propsNote(tree)));
  check('负对照：这种成因不得被说成「这张壁纸没有用户属性」',
    propsNote(tree) !== '这张壁纸没有用户属性（project.json 的 general.properties）');

  // 换壁纸：面板开着时切到 B ⇒ A 的属性表**不得**冒充 B 的（读数与说明句都要说"正在取 B 的"）。
  propsBody = null;
  toggle(); toggle(); // 回到 A 的成功态（在途 -> settle）
  settleProps(200, propsPayload(PROPS_DEFS, PROPS_TOKEN));
  await sleep(0);
  tree = render();
  check('回到 A 的成功态（换壁纸判据的前置）', propRows(tree).length === 6);
  openModal(tree); tree = render();
  pickCard(tree, '网页壁纸 B'); // 期间 A 的表还在 propsState 里
  tree = render();
  closeModal(tree); tree = render();
  check('开着的面板切到另一张壁纸：不画上一张的属性行，并明说正在取这张的',
    propRows(tree).length === 0 && propsNote(tree) === '正在取这张壁纸的属性…',
    String(propsNote(tree)) + ' / ' + propRows(tree).length + ' 行');
  // 换壁纸的"不得冒充"由**行数**判（读数撤除后不能再靠它读 token）：
  // 切换途中一行都不画，且说明句说"正在取这张的"。
  check('换壁纸途中不画上一张的行（说明句 = 正在取这张的，且没有残留行）',
    propRows(tree).length === 0 && propsNote(tree) === '正在取这张壁纸的属性…',
    String(propsNote(tree)));
  settleProps(200, propsPayload(PROPS_DEFS, PROPS_TOKEN_B));
  await sleep(0);
  tree = render();
  check('B 的属性到达 ⇒ 行回来（切换不是单向门）', propRows(tree).length === 6,
    propRows(tree).length + ' 行');
}

console.log('\n9. 清掉壁纸 ⇒ 面板收起（不留一个挂在开关上的空面板）');
{
  // 内联设计下的对应不变量：清掉当前壁纸后，`sel.propsUrl` 随之消失 —— 面板必须跟着
  // 收起来，而不是"开关还是 true、面板却画不出来"（那正是侧栏那次"空白"的同源形态）。
  // 处理器层（`onClear`）负责把开关一并关掉，这里从**真产物**上验证结果。
  const clearBtn = () => findNode(tree, (n) => hasClass(n, 'we-picker__btn') && textUnder(n) === '清除');
  check('前置：面板开着、且有「清除」按钮可点', !!propsPanel(tree) && !!clearBtn());
  clearBtn().props.onClick();
  tree = render();
  check('清掉壁纸后：面板收起（不再画面板），头部文案与读数一并消失',
    !propsPanel(tree) && propsNote(tree) === null && propsStamp(tree) === null,
    '面板=' + Boolean(propsPanel(tree)));
  // 负对照：不清开关的写法会让面板留着一个"没有 token"的空壳 —— 用合成树证明判据有牙。
  const staleShell = { type: 'div', props: { className: 'we-picker__props' }, children: [] };
  check('负对照：残留一个空面板壳会被同一条判据判出（判据不是"反正都没有"）',
    !!propsPanel(staleShell) && !propsPanel(tree));
  // 再选回一张带属性的壁纸：开关已被收起 ⇒ 面板**不会自己弹开**（用户没点过它）。
  const entry = propsEntry(tree);
  check('清掉壁纸后入口本身也不在了（没有可调对象）', entry === null);
}


console.log('');
if (failures) {
  console.log('PICKER PROPS CHECKS FAILED — ' + failures + ' failed');
  process.exit(1);
}
console.log('ALL PICKER PROPS CHECKS PASSED');
