// Verify the picker's UPLOAD area against the emitted client bundle (lib/client.js).
//
// 挂载台与 test/verify-client.mjs 同一套做法：mock React 直接调函数组件（可反复
// 重渲染）、合成 DOM、mock fetch / localStorage；断言是 node:assert 风格的真判据
// （check(label, cond) 判真假 → 失败即 process.exit(1)），绝不只是打印。
//
// 被钉住的不变量（都是 WallpaperPicker 体内那族处理器的外部行为）：
//   ① 选中 File → 进入「上传中…」（期间 file input 禁用）→ 宿主 2xx 后
//      「已上传 N 个」按库存里的 up- 条目计数（up-dir- 目录项目不算上传）；
//   ② 宿主非 2xx → 错误行显示宿主给的原因，且**不重拉库存**（没有新条目要合并）；
//   ③ 保存官方资源路径 ⇒ **恰好一次** /inventory 重拉（宿主文件是真源，新目录/
//      可用性靠这次重拉带回渲染）；宿主拒绝时显示 weAssetsError，编辑器保持打开、
//      草稿保留（用户能改一改再存）。
//
// 判据纪律（docs/DEV-GUIDE.md §4.7 约定 5）：每条判据只在这里定义一次（命名函数 /
// 命名常量），正判据与负对照**调同一个函数**，负对照喂的是**变异输入**
// （改写文本 / 打补丁 props / 换掉宿主应答 / 换掉计数实参），不是另抄一份判据。
//
// Usage: node test/verify-picker-upload.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// ══ 判据（唯一一份）══════════════════════════════════════════════════════════

const treeText = (root) => JSON.stringify(root);

/** 收集「父节点 className 含 clsPart」的字符串叶子（渲染树里的可见文案）。 */
function stringsUnder(root, clsPart) {
  const out = [];
  (function walk(node) {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    const cls = typeof (node.props && node.props.className) === 'string' ? node.props.className : '';
    const kids = Array.isArray(node.children) ? node.children : [];
    for (const kid of kids) {
      if (typeof kid === 'string') { if (cls.includes(clsPart)) out.push(kid); }
      else walk(kid);
    }
  })(root);
  return out;
}

/** 渲染树里第一个满足谓词的宿主节点（mock React 已把函数组件展开成宿主节点）。 */
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

/** 面板里「一行」：className 含 we-picker__row 且子树含某段文本。 */
function findRow(root, needle) {
  return findNode(root, (n) => {
    const cls = typeof (n.props && n.props.className) === 'string' ? n.props.className : '';
    return cls.split(' ').includes('we-picker__row') && treeText(n).includes(needle);
  });
}

const isFileInput = (n) => n.type === 'input' && n.props && n.props.type === 'file';
const buttonIn = (row, text) => (row ? findNode(row, (n) => n.type === 'button'
  && Array.isArray(n.children) && n.children.length === 1 && n.children[0] === text) : null);

// ── 判据 ① 上传区 ──
/** 在途提示：「上传中…」这一行在场。 */
const uploadInFlight = (root) => stringsUnder(root, 'we-picker__hint').includes('上传中…');

/** 「已上传 N 个」报的 N；找不到该行 → -1（区分「没渲染」与「渲染成 0」）。 */
const uploadedCount = (root) => {
  const line = stringsUnder(root, 'we-picker__hint').find((t) => /^已上传 \d+ 个$/.test(t));
  return line ? Number(line.replace(/\D/g, '')) : -1;
};

/** 错误行集合（上传失败 / weAssetsError 共用同一条渲染通道）。 */
const errorLines = (root) => stringsUnder(root, 'we-picker__error');

// 两条错误通道都渲染成 .we-picker__error，且**互不清除**（上传失败不会被改目录
// 清掉，反之亦然）⇒ 判据必须按文案前缀分通道，否则一条通道的残留会把另一条判成红。
const uploadErrorLines = (root) => errorLines(root).filter((t) => t.startsWith('上传失败：'));
const saveErrorLines = (root) => errorLines(root).filter((t) => t.startsWith('保存失败：'));

/** file input 的 disabled（上传期间必须禁用，否则能并发选第二个文件）。 */
const uploadInputDisabled = (root) => {
  const input = findNode(root, isFileInput);
  return input ? input.props.disabled === true : null;
};

/** 第一条上传请求（无请求 → null）。 */
const uploadRequestOf = (calls) => calls[0] || null;

/** 该请求是否**就是**选中的那个 File：体 === File、MIME 取文件声明值、标题进 query。 */
function uploadRequestCarries(req, file) {
  if (!req) return false;
  const title = file.name.replace(/\.[^.]+$/, '');
  return req.body === file
    && (req.headers || {})['Content-Type'] === file.type
    && req.url.includes('title=' + encodeURIComponent(title));
}

// ── 判据 ② 官方资源路径（目录编辑器）──
/** 编辑器（草稿输入行）是否打开。 */
const weAssetsEditorOpen = (root) => findRow(root, 'WE assets') !== null;

/** 编辑器草稿输入框的当前值（关着 → null）。 */
const weAssetsDraftOf = (root) => {
  const input = findNode(root, (n) => n.type === 'input' && n.props
    && typeof n.props.placeholder === 'string' && n.props.placeholder.startsWith('WE assets'));
  return input ? input.props.value : null;
};

/** 「官方资源路径」那一行显示的当前值（宿主 inventory 的镜像）。 */
const weAssetsShown = (root) => {
  const row = findRow(root, '官方资源路径');
  const shown = row ? stringsUnder(row, 'we-picker__uploads-path') : [];
  return shown.length ? shown[0] : null;
};

/** /inventory 重拉次数（命名二元判据：正判据与负对照都调它）。 */
const inventoryRefetchDelta = (before, after) => after - before;
const exactlyOneInventoryRefetch = (before, after) => inventoryRefetchDelta(before, after) === 1;

/** 一次 we-assets-dir 保存请求携带的目录（无请求/无字段 → null）。 */
const weAssetsSaveDirOf = (call) => (call && call.body && typeof call.body.dir === 'string' ? call.body.dir : null);

/** 挂载台自身：picker 渲染回调已注册（否则后面每条判据都在空跑）。 */
const hasPickerRender = (renders) => renders.length > 0;

// ══ 变异输入生成器（负对照专用；判据本身不改）═════════════════════════════════

/** 深拷贝渲染树，把等于 from 的字符串叶子换成 to。 */
function mutateText(node, from, to) {
  if (typeof node === 'string') return node === from ? to : node;
  if (Array.isArray(node)) return node.map((n) => mutateText(n, from, to));
  if (!node || typeof node !== 'object') return node;
  const copy = Object.assign({}, node);
  if (Array.isArray(node.children)) copy.children = node.children.map((n) => mutateText(n, from, to));
  return copy;
}

/** 深拷贝渲染树，给满足谓词的节点打 props 补丁。 */
function mutateProps(node, pred, patch) {
  if (Array.isArray(node)) return node.map((n) => mutateProps(n, pred, patch));
  if (!node || typeof node !== 'object') return node;
  const copy = Object.assign({}, node);
  if (pred(node)) copy.props = Object.assign({}, node.props || {}, patch);
  if (Array.isArray(node.children)) copy.children = node.children.map((n) => mutateProps(n, pred, patch));
  return copy;
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
  // 最小但真实的渲染器：函数组件真的被调用（picker 树因此materialize），
  // 宿主元素只产描述符。
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
    querySelector() { return null; },
  };
}

const bodyEl = makeEl('body');
const document = {
  createElement: (t) => {
    const el = makeEl(t);
    if (t === 'img') {
      // 静态帧 / 图片壁纸走 <img>.src；记录一下即可（本文件不断言画面来源）。
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

const localStorage = {
  // 不种选择：宿主「还没有存档」→ 从 localStorage 迁移这条启动路径与空库一致。
  _store: {},
  getItem(k) { return this._store[k] ?? null; },
  setItem(k, v) { this._store[k] = v; },
  removeItem(k) { delete this._store[k]; },
};

// ── 宿主侧 mock 状态（负对照就是换这里的应答）──
const inventoryCalls = [];
const uploadCalls = [];
const weAssetsCalls = [];
let uploadedOnce = false;      // 上传成功后宿主库存里多出 up-1（+ 不可计的 up-dir-2）
let weAssetsDirValue = null;   // 宿主侧已保存的官方资源路径
let weAssetsSaveStatus = 200;
let weAssetsSaveError = '';
let pendingUpload = null;      // 在途上传（null = 没有请求在飞）

const assertState = (cond, msg) => { if (!cond) throw new Error('harness: ' + msg); };
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};
/** 结算在途上传：status + 宿主体（非 2xx 的 { error } 就是失败腿的原因）。 */
const settleUpload = (status, body) => {
  const p = pendingUpload;
  assertState(!!p, 'settleUpload 必须在有在途上传时调用');
  pendingUpload = null;
  p.resolve({ status, json: () => Promise.resolve(body) });
};

/** 宿主库存：up- 条目只在「上传过一次」之后出现；up-dir- 是目录项目（不算上传）。 */
function inventoryPayload() {
  const wallpapers = [
    { id: 'w1', title: '视频一', type: 'video', playable: true, media: '/wallpaper-engine/media/w1', preview: null, contentrating: 'Everyone' },
    { id: 'w2', title: '图片二', type: 'image', playable: true, media: '/wallpaper-engine/media/w2', preview: null, contentrating: 'Everyone' },
  ];
  if (uploadedOnce) {
    wallpapers.push({ id: 'up-1', title: '刚上传', type: 'image', playable: true, media: '/wallpaper-engine/media/up-1', preview: null });
    wallpapers.push({ id: 'up-dir-2', title: '目录项目', type: 'image', playable: false, media: null, preview: null });
  }
  return {
    installDir: 'D:/we', uploadDir: 'D:/we/uploads', weAssetsDir: weAssetsDirValue,
    weAssetsAvailable: false, total: wallpapers.length, portableCount: wallpapers.length,
    playlists: [], wallpapers,
  };
}

const fetch = (url, opts) => {
  const u = String(url);
  const method = String((opts && opts.method) || 'GET').toUpperCase();
  const headers = (opts && opts.headers) || {};
  if (u.includes('/wallpaper-engine/inventory')) {
    inventoryCalls.push(u);
    return Promise.resolve({ status: 200, json: () => Promise.resolve(inventoryPayload()) });
  }
  // 注意 /upload-dir 也含 /upload 前缀：按 query 区分（上传带 ?title=）。
  if (method === 'POST' && u.includes('/wallpaper-engine/upload?') && !u.includes('upload-dir')) {
    uploadCalls.push({ url: u, headers, body: opts && opts.body });
    pendingUpload = deferred();
    return pendingUpload.promise;
  }
  if (method === 'POST' && u.includes('/wallpaper-engine/we-assets-dir')) {
    let body;
    try { body = JSON.parse((opts && opts.body) || '{}'); } catch { body = null; }
    weAssetsCalls.push({ url: u, body });
    const ok = weAssetsSaveStatus >= 200 && weAssetsSaveStatus < 300;
    if (ok) weAssetsDirValue = (body && typeof body.dir === 'string' && body.dir) ? body.dir : null;
    return Promise.resolve({
      status: weAssetsSaveStatus,
      json: () => Promise.resolve(ok ? { ok: true, weAssetsDir: weAssetsDirValue } : { error: weAssetsSaveError }),
    });
  }
  if (u.includes('/wallpaper-engine/settings')) {
    return Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true }) });
  }
  return Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true }) });
};

const cap = { handoff: null };
const sandbox = {
  window: {
    __ModuleLoader__: { load: (h) => { cap.handoff = h; } },
    setTimeout: (fn, ms) => { const t = { fn, ms, cleared: false }; sandboxTimers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.cleared = true; },
  },
  document, localStorage, fetch, React,
  // 浏览器里裸 setTimeout/setInterval 就是 window 上的 —— 沙箱同样提供（持久化
  // debounce、轮换定时器走 window.*，但没有裸全局可用时那些路径会静默退化）。
  setTimeout: (fn, ms) => { const t = { fn, ms, cleared: false }; sandboxTimers.push(t); return t; },
  clearTimeout: (t) => { if (t) t.cleared = true; },
  setInterval: (fn, ms) => { const t = { fn, ms, cleared: false, interval: true }; sandboxTimers.push(t); return t; },
  clearInterval: (t) => { if (t) t.cleared = true; },
};
vm.createContext(sandbox);
new vm.Script(code, { filename: 'client.js' }).runInContext(sandbox);

const { factory } = cap.handoff;
const requireMock = (spec) => {
  if (spec === 'react') return React;
  if (spec === 'react-dom') return { createPortal: (node) => node }; // 模态框在 mock 里就地渲染
  throw new Error('unexpected require: ' + spec);
};
const exportsObj = factory(requireMock);

const pickerRenders = [];
const slots = {
  inject: (key, cb) => cb(),
  register: (opts, render) => { pickerRenders.push(render); },
};
// apply(ctx) 必须跑通：抛了就不会有渲染回调，后面每条判据都会在空跑上继续。
// ctx.effect 立刻执行（与 fiber 首次提交同序），否则订阅没挂上、emit() 不重渲染。
const ctx = { slots, effect(fn) { fn(); return fn; } };
exportsObj.apply(ctx);

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const render = () => pickerRenders[0]();
await sleep(80); // 等 loadPersisted → loadInventory → revalidateSelection 这条启动链落定

// ══ 检查 ═════════════════════════════════════════════════════════════════════
let failures = 0;
const check = (label, cond, detail) => {
  if (cond) console.log('  ✓ ' + label + (detail ? ' — ' + detail : ''));
  else { failures++; console.log('  ✗ ' + label + (detail ? ' — ' + detail : '')); }
};

const UPLOAD_OK_FILE = { name: 'wall.png', type: 'image/png' };
const UPLOAD_BAD_FILE = { name: 'wall-again.png', type: 'image/png' };
const UPLOAD_FAIL_REASON = '磁盘已满（测试）';
const WE_ASSETS_OK_DIR = 'D:/we-assets';
const WE_ASSETS_FAIL_DIR = 'Z:/no-such-drive';
const WE_ASSETS_FAIL_REASON = '无法在该路径创建目录（权限不足或路径被占用）';
const pickFileInput = (root) => findNode(root, isFileInput);
const pickFile = (root, file) => pickFileInput(root).props.onChange({ target: { files: [file], value: '' } });

console.log('0. 挂载台自检');
{
  check('挂载：settings.section 注册了 picker 渲染回调（否则以下判据全部空转）',
    hasPickerRender(pickerRenders), 'render 回调 ' + pickerRenders.length + ' 个');
  check('负对照：空渲染回调列表被同一条判据判为未注册',
    !hasPickerRender([]));
}

const initialTree = render();

console.log('1. 上传：选中 File → 上传中 → 成功计数');
{
  // ①-a 上传前：库存里没有任何 up- 条目（下面成功腿的计数才有对照）。
  check('上传前：「已上传 0 个」（up-dir- 目录项目此时也不在库里）',
    uploadedCount(initialTree) === 0, 'N=' + uploadedCount(initialTree));
  check('负对照：变异文案（已上传 3 个）被同一条判据读成 3（判据读的是渲染值，不是常量）',
    uploadedCount(mutateText(initialTree, '已上传 0 个', '已上传 3 个')) === 3);

  // ①-b 空闲时 file input 可点。
  check('空闲：file input 未禁用（sel.uploading === false）',
    uploadInputDisabled(initialTree) === false);
  check('负对照：把同一棵树的 file input 变异成 disabled 后，同一条判据判为已禁用',
    uploadInputDisabled(mutateProps(initialTree, isFileInput, { disabled: true })) === true);

  // ①-c 选中 File → 请求真的发出去（体 === File、MIME 取文件声明值）。
  const beforeUpload = inventoryCalls.length;
  pickFile(initialTree, UPLOAD_OK_FILE);
  const pendingTree = render();
  check('上传：选中的 File 原样进 POST 体，MIME 用文件声明值，标题进 query',
    uploadRequestCarries(uploadRequestOf(uploadCalls), UPLOAD_OK_FILE),
    uploadRequestOf(uploadCalls) ? uploadRequestOf(uploadCalls).url : '(无请求)');
  check('负对照：没有请求 / 换成别的 body 时，同一条判据判为「不是这个 File」',
    !uploadRequestCarries(uploadRequestOf([]), UPLOAD_OK_FILE)
    && !uploadRequestCarries({ url: uploadRequestOf(uploadCalls).url, headers: { 'Content-Type': 'image/png' }, body: { name: 'other.png' } }, UPLOAD_OK_FILE));

  // ①-d 在途：出现「上传中…」且 file input 禁用。
  check('上传中：出现「上传中…」提示行',
    uploadInFlight(pendingTree));
  check('负对照：把「上传中…」变异成其它文案后，同一条判据判为没有在途提示',
    !uploadInFlight(mutateText(pendingTree, '上传中…', '上传完成')));
  check('上传中：file input 被禁用（不能并发选第二个文件）',
    uploadInputDisabled(pendingTree) === true);
  check('负对照：上传前的同一棵树上，同一条判据判为未禁用（判据能区分两个状态）',
    uploadInputDisabled(initialTree) === false);

  // ①-e 宿主 2xx 结算 → 计数按重拉回来的库存算。
  uploadedOnce = true;
  settleUpload(200, { id: 'up-1' });
  await sleep(30);
  const successTree = render();
  check('上传成功：「已上传 1 个」（up-1 计入，up-dir-2 目录项目不计入）',
    uploadedCount(successTree) === 1, 'N=' + uploadedCount(successTree));
  check('负对照：把该行变异成「已上传 7 个」后，同一条判据读成 7（计数不是写死的 1）',
    uploadedCount(mutateText(successTree, '已上传 1 个', '已上传 7 个')) === 7);
  check('上传成功：在途提示消失',
    !uploadInFlight(successTree));
  check('上传成功：恰好一次 /inventory 重拉（新条目靠这次重拉进库存）',
    exactlyOneInventoryRefetch(beforeUpload, inventoryCalls.length),
    'delta=' + inventoryRefetchDelta(beforeUpload, inventoryCalls.length));
  check('负对照：改成 +2 次重拉的计数实参，同一条判据判为不满足「恰好一次」',
    !exactlyOneInventoryRefetch(beforeUpload, beforeUpload + 2));

  // ①-f 宿主非 2xx → 错误行显示宿主原因，且不重拉库存。
  const beforeFailedUpload = inventoryCalls.length;
  pickFile(successTree, UPLOAD_BAD_FILE);
  const failPendingTree = render();
  check('上传失败腿：请求在途时同样处于「上传中…」（先清掉上一次的错误行）',
    uploadInFlight(failPendingTree) && uploadErrorLines(failPendingTree).length === 0);
  check('负对照：上一腿成功结算后的树上，同一条判据判为没有在途提示',
    !uploadInFlight(successTree));
  settleUpload(500, { error: UPLOAD_FAIL_REASON });
  await sleep(30);
  const uploadFailTree = render();
  const expectedUploadError = '上传失败：' + UPLOAD_FAIL_REASON;
  check('上传失败：错误行逐字显示 uploadError（宿主给的原因）',
    uploadErrorLines(uploadFailTree).includes(expectedUploadError),
    uploadErrorLines(uploadFailTree).join(' | ') || '(无错误行)');
  check('负对照：把该错误行变异成别的原因后，同一条判据不再命中（文案不是恒真）',
    !uploadErrorLines(mutateText(uploadFailTree, expectedUploadError, '上传失败：其它原因')).includes(expectedUploadError));
  check('负对照：成功结算后的树上该通道没有任何错误行（同一条判据在两个状态上结论相反）',
    uploadErrorLines(successTree).length === 0);
  check('上传失败：不重拉库存（没有新条目要合并）',
    inventoryRefetchDelta(beforeFailedUpload, inventoryCalls.length) === 0,
    'delta=' + inventoryRefetchDelta(beforeFailedUpload, inventoryCalls.length));
  check('负对照：同一条「恰好一次」判据在失败腿上为假（成功腿的 +1 不是计数器噪声）',
    !exactlyOneInventoryRefetch(beforeFailedUpload, inventoryCalls.length));
  check('上传失败：计数不变（失败不会凭空多出一条）',
    uploadedCount(uploadFailTree) === 1, 'N=' + uploadedCount(uploadFailTree));
}

console.log('2. 目录编辑器（官方资源路径）：保存 ⇒ 恰好一次 /inventory 重拉');
{
  // ②-a 编辑器初始关闭，行上显示宿主当前值（未配置 → 占位符）。
  check('目录编辑器：初始关闭',
    !weAssetsEditorOpen(initialTree));
  check('目录编辑器：未配置时该行显示占位符「—」',
    weAssetsShown(initialTree) === '—', 'shown=' + JSON.stringify(weAssetsShown(initialTree)));
  check('负对照：把该行的显示值变异成目标路径后，同一条判据读成目标路径',
    weAssetsShown(mutateText(initialTree, '—', WE_ASSETS_OK_DIR)) === WE_ASSETS_OK_DIR);

  // ②-b 点「设置」→ 草稿输入行打开，预填宿主当前值（空）。
  const row = findRow(render(), '官方资源路径');
  const openBtn = buttonIn(row, weAssetsDirValue ? '更改' : '设置');
  assertState(!!openBtn, '「官方资源路径」行必须有打开编辑器的按钮');
  openBtn.props.onClick();
  const openTree = render();
  check('目录编辑器：点「设置」后草稿输入行打开且预填宿主当前值',
    weAssetsEditorOpen(openTree) && weAssetsDraftOf(openTree) === '');
  check('负对照：同一棵初始树上，同一条「编辑器打开」判据判为关闭',
    !weAssetsEditorOpen(initialTree));

  // ②-c 填草稿 → 保存 → 请求携带草稿、恰好一次重拉、显示值换成宿主重拉回来的。
  const editorRow = findRow(openTree, 'WE assets');
  const draftInput = findNode(editorRow, (n) => n.type === 'input' && n.props
    && typeof n.props.placeholder === 'string' && n.props.placeholder.startsWith('WE assets'));
  assertState(!!draftInput, '编辑器里必须有草稿输入框');
  draftInput.props.onInput({ target: { value: WE_ASSETS_OK_DIR } });
  const beforeSave = inventoryCalls.length;
  buttonIn(findRow(render(), 'WE assets'), '保存').props.onClick();
  await sleep(30);
  const savedTree = render();

  check('目录保存：POST 体携带草稿路径',
    weAssetsSaveDirOf(weAssetsCalls[0]) === WE_ASSETS_OK_DIR,
    JSON.stringify(weAssetsCalls[0] ? weAssetsCalls[0].body : null));
  check('负对照：换成别的目录的请求体，同一条判据判为不匹配',
    weAssetsSaveDirOf({ body: { dir: 'D:/elsewhere' } }) !== WE_ASSETS_OK_DIR);
  check('目录保存成功：恰好一次 /inventory 重拉',
    exactlyOneInventoryRefetch(beforeSave, inventoryCalls.length),
    'delta=' + inventoryRefetchDelta(beforeSave, inventoryCalls.length));
  check('负对照：+2 次重拉的计数实参被同一条判据判为不满足「恰好一次」',
    !exactlyOneInventoryRefetch(beforeSave, beforeSave + 2));
  check('目录保存成功：行上显示宿主重拉回来的新路径（inventory 是真源）且编辑器关闭',
    weAssetsShown(savedTree) === WE_ASSETS_OK_DIR && !weAssetsEditorOpen(savedTree),
    'shown=' + JSON.stringify(weAssetsShown(savedTree)));
  check('负对照：把该行显示值变异回占位符后，同一条判据不再等于新路径',
    weAssetsShown(mutateText(savedTree, WE_ASSETS_OK_DIR, '—')) !== WE_ASSETS_OK_DIR);
  check('目录保存成功：没有「保存失败：」错误行（同一次会话里上传失败的残留行不算）',
    saveErrorLines(savedTree).length === 0,
    saveErrorLines(savedTree).join(' | ') || '(空)');
  check('负对照：同一判据能把「保存失败：」那一行点出来（成功腿的空集不是判据失灵）',
    saveErrorLines({ props: { className: 'we-picker__error' }, children: ['保存失败：宿主拒绝'] })
      .includes('保存失败：宿主拒绝'));

  // ②-d 宿主拒绝 → weAssetsError 上屏，编辑器保持打开、草稿保留，且不重拉库存。
  const reopenRow = findRow(savedTree, '官方资源路径');
  const changeBtn = buttonIn(reopenRow, '更改');
  assertState(!!changeBtn, '已配置后按钮文案必须是「更改」');
  changeBtn.props.onClick();
  const reopenedTree = render();
  const failInput = findNode(findRow(reopenedTree, 'WE assets'), (n) => n.type === 'input' && n.props
    && typeof n.props.placeholder === 'string' && n.props.placeholder.startsWith('WE assets'));
  failInput.props.onInput({ target: { value: WE_ASSETS_FAIL_DIR } });
  weAssetsSaveStatus = 400;
  weAssetsSaveError = WE_ASSETS_FAIL_REASON;
  const beforeFailSave = inventoryCalls.length;
  buttonIn(findRow(render(), 'WE assets'), '保存').props.onClick();
  await sleep(30);
  const saveFailTree = render();
  const expectedSaveError = '保存失败：' + WE_ASSETS_FAIL_REASON;

  check('目录保存失败：错误行逐字显示 weAssetsError（宿主给的原因）',
    saveErrorLines(saveFailTree).includes(expectedSaveError),
    saveErrorLines(saveFailTree).join(' | ') || '(无错误行)');
  check('负对照：改写成别的原因后同一条判据不再命中，且成功腿上该通道为空（两腿结论相反）',
    !saveErrorLines(mutateText(saveFailTree, expectedSaveError, '保存失败：其它原因')).includes(expectedSaveError)
    && saveErrorLines(savedTree).length === 0);
  check('目录保存失败：不重拉库存（宿主没改，重拉只会白跑）',
    !exactlyOneInventoryRefetch(beforeFailSave, inventoryCalls.length),
    'delta=' + inventoryRefetchDelta(beforeFailSave, inventoryCalls.length));
  check('负对照：同一条判据在成功腿上为真（+1 确实来自保存动作）',
    exactlyOneInventoryRefetch(beforeSave, beforeSave + 1));
  check('目录保存失败：编辑器保持打开且草稿保留（用户能改一改再存）',
    weAssetsEditorOpen(saveFailTree) && weAssetsDraftOf(saveFailTree) === WE_ASSETS_FAIL_DIR,
    'draft=' + JSON.stringify(weAssetsDraftOf(saveFailTree)));
  check('负对照：成功关闭后的同一棵树上，同一条判据判为关闭且无草稿',
    !weAssetsEditorOpen(savedTree) && weAssetsDraftOf(savedTree) === null);
}

console.log('');
console.log(failures === 0 ? 'ALL PICKER UPLOAD CHECKS PASSED' : failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
