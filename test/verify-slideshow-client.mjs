#!/usr/bin/env node
/**
 * verify-slideshow-client.mjs —— 「图片 / 幻灯片壁纸在**浏览器半边**的图内切换」的聚焦判据。
 *
 * 被测对象是 `src/media-prep.js` 里那一族：`pictureSlideIntervalMs` / `scheduleImageSlideshow` /
 * `installImageSlideshow` / `refreshImageSlideshow`。判据**执行真文件**（`node:vm` 装载，只去掉
 * 文末的 `export {…}`）而不是 grep 源码 —— 这一族的契约是行为（叠几张、谁在动、何时停表），
 * 静态文本读不出"一拍之后哪张图不透明"。
 *
 * 为什么值得独立守卫：这条链路坏了不会报错 ——
 *   · 叠层不摘 ⇒ 换壁纸后旧图集继续解码（内存 / CPU 白烧），且两张透明 img 永远压在画面上；
 *   · 失联判断丢了 ⇒ 后台标签页 + 已换壁纸的孤儿计时器一直跑；
 *   · `document.hidden` 判断丢了 ⇒ 最小化时还在后台连续解码大图；
 *   · 周期换算错了 ⇒ 用户设的"5 秒"变成 5 分钟，或反过来。全是静默形态 ⇒ 硬档。
 *
 * 判据设计（DEV-GUIDE §4.7）：
 *   · DOM / 定时器全部是**可控替身**：`document.createElement`、`window.setInterval`、元素
 *     的 `src` / `load` / `isConnected` 都是判据自己造的，所以"扒开一拍做了什么事"是确定的；
 *   · C8/C9 是变异体负对照（源码现场改写，落 `.test-cache/`，不动 `src/`）：拆掉失联闸 /
 *     拆掉 `document.hidden` 闸，同一段判据必须报红；
 *   · 另有一小组**静态契约**（C10）：`buildMedia` 的图片支必须接上 `scheduleImageSlideshow`、
 *     `applySelection` 必须落地/清空两个 transient 字段、CSS 必须有 `.we-slide` 的绝对定位
 *     —— 这三处是 vm 装载碰不到装配点（面板 / 层构建在 client.js 一侧）。
 *
 * Usage:  node test/verify-slideshow-client.mjs
 */

import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ISO = join(ROOT, '.test-cache', 'slideshow-client-guard');
const MEDIA_SRC = join(ROOT, 'src', 'media-prep.js');
const PANEL_SRC = join(ROOT, 'packages', 'media-bridge', 'src', 'wallpaper-rotation-section.js');
const STYLE_SRC = join(ROOT, 'src', 'styles-base.js');
const CLIENT_SRC = join(ROOT, 'src', 'client.js');
const I18N_SRC = join(ROOT, 'src', 'i18n-copy-panel.js');

let passed = 0; let failed = 0;
function check (name, ok, detail) {
  if (ok) passed++;
  else failed++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
}
function section (t) { console.log('\n' + t); }

rmSync(ISO, { recursive: true, force: true });
mkdirSync(ISO, { recursive: true });

const MEDIA_CODE = readFileSync(MEDIA_SRC, 'utf8');

// ── 可控 DOM / 定时器替身 ──────────────────────────────────────────────────
function makeEl (tag) {
  const el = {
    tagName: tag,
    className: '',
    alt: '',
    draggable: false,
    style: {},
    children: [],
    parentNode: null,
    isConnected: false,
    complete: false,
    naturalWidth: 0,
    _listeners: {},
    appendChild (child) {
      child.parentNode = el;
      el.children.push(child);
      child.isConnected = el.isConnected;
    },
    removeChild (child) {
      const i = el.children.indexOf(child);
      if (i >= 0) el.children.splice(i, 1);
      child.parentNode = null;
      child.isConnected = false;
    },
    addEventListener (type, fn) {
      (el._listeners[type] = el._listeners[type] || []).push(fn);
    },
    _fire (type) {
      const list = el._listeners[type] || [];
      el._listeners[type] = [];
      for (const fn of list) fn();
    },
  };
  if (tag === 'img') {
    let src = '';
    Object.defineProperty(el, 'src', {
      get () { return src; },
      set (value) { src = value; el.complete = false; el.naturalWidth = 0; },
    });
  }
  return el;
}

/** 一张已经解码完成的图（判据用它把"这一拍该交接了"落地）。 */
function settleImage (img) {
  img.complete = true;
  img.naturalWidth = 1200;
  img._fire('load');
}

function makeEnv (options = {}) {
  const timers = [];
  const root = makeEl('div');
  root.isConnected = true;
  const documentStub = {
    hidden: false,
    createElement: (tag) => makeEl(tag),
    body: root,
  };
  const windowStub = {
    setInterval (fn, ms) { const id = timers.length + 1; timers.push({ id, fn, ms, alive: true }); return id; },
    clearInterval (id) { const t = timers.find((x) => x.id === id); if (t) t.alive = false; },
    setTimeout: () => 1,
    clearTimeout: () => {},
  };
  const calls = { apiJson: [] };
  const apiJson = (path) => {
    calls.apiJson.push(path);
    return Promise.resolve({ ok: true, data: { ok: true, images: options.images || [] } });
  };
  const sandbox = {
    document: documentStub,
    window: windowStub,
    apiJson,
    clampNum: (v, lo, hi, dflt) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return dflt;
      return Math.min(hi, Math.max(lo, n));
    },
    emit: () => {},
    __exports: null,
  };
  vm.createContext(sandbox);
  return { sandbox, root, timers, calls, documentStub, windowStub };
}

/** 装载真 `src/media-prep.js`（只剥文末 export 块），返回 helper 表。 */
function loadMediaPrep (source = MEDIA_CODE, images = IMAGES3) {
  const body = source.replace(/\nexport \{[\s\S]*?\};\s*$/, '\n');
  if (body === source) throw new Error('export 块没剥掉（判据装不到真模块）');
  const env = makeEnv({ images });
  vm.runInContext(`${body}\n;__exports = { pictureSlideIntervalMs, scheduleImageSlideshow, installImageSlideshow, refreshImageSlideshow, IMAGE_SLIDES_CACHE };`,
    env.sandbox, { filename: 'src/media-prep.js' });
  env.exports = env.sandbox.__exports;
  return env;
}

const flush = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise((resolve) => { setImmediate(resolve); }); };

/** 一块"当前壁纸"的底层图（过场层叠在它的 parentNode 上；它的 src 一律不许被改写）。 */
function mountBase (env) {
  const media = env.sandbox.document.createElement('img');
  media.src = '/media/cover-token';
  media.isConnected = true;
  env.root.appendChild(media);
  return media;
}

const IMAGES3 = [
  { url: '/media/slide-a' },
  { url: '/media/slide-b' },
  { url: '/media/slide-c' },
];
const SEL_BASE = {
  id: 'we/1001',
  type: 'image',
  slidesUrl: '/wallpaper-engine/slides/cover-token',
  slideIntervalMs: 60000,
  pictureSlideSeconds: 0,
};

// ── C1：不是多图 / 没接上 ⇒ 不取数、不叠层 ─────────────────────────────────
section('C1. 不是多图图片项目 ⇒ 不取数、不叠层（单图不能被"幻灯片"包装一层）');
{
  const env = loadMediaPrep(undefined, []);
  const media = mountBase(env);
  env.exports.scheduleImageSlideshow(media, { ...SEL_BASE, slidesUrl: null });
  await flush();
  check('C1 没有 slidesUrl ⇒ 一次都没请求', env.calls.apiJson.length === 0,
    'apiJson calls=' + env.calls.apiJson.length);
  check('C1 也没有多挂任何 img', env.root.children.length === 1);
  const one = loadMediaPrep();
  one.sandbox.document.body = one.root;
  const media2 = mountBase(one);
  one.sandbox.apiJson = undefined; // `apiJson` 不在作用域里 ⇒ 直接退化成单图
  one.exports.scheduleImageSlideshow(media2, SEL_BASE);
  await flush();
  check('C1 没有 apiJson 通道 ⇒ 静默退化（不抛）', one.root.children.length === 1);
}

// ── C2：装两张过场层、预载第二张、底层不动、周期=声明值 ──────────────────────
section('C2. 叠两张过场层：预载第二张、底层 src 不动、定时器周期=声明值');
const env2 = loadMediaPrep();
{
  const media = mountBase(env2);
  env2.exports.scheduleImageSlideshow(media, SEL_BASE);
  await flush();
  const layers = env2.root.children.slice(1);
  check('C2 叠了两张 `.we-media .we-media--fit .we-slide`',
    layers.length === 2 && layers.every((el) => el.className === 'we-media we-media--fit we-slide'),
    JSON.stringify(layers.map((el) => el.className)));
  check('C2 两张初始都透明（不抢底层封面）', layers.every((el) => el.style.opacity === '0'));
  check('C2 第二张预载了图集里的第二张（首拍不空）', layers[1].src === '/media/slide-b', layers[1].src);
  check('C2 底层 src 没被改写（只管附加层）', media.src === '/media/cover-token', media.src);
  check('C2 定时器周期 = WE 预设 60000ms', env2.timers.length === 1 && env2.timers[0].ms === 60000,
    JSON.stringify(env2.timers.map((t) => t.ms)));
  check('C2 只请求一次图集', env2.calls.apiJson.length === 1);
}

// ── C3：一拍推进 ⇒ 交叉淡化 ───────────────────────────────────────────────
section('C3. 一拍推进：incoming 换图 + 淡入，outgoing 淡出（周期按声明走）');
{
  const tick = env2.timers.find((t) => t.alive);
  tick.fn();
  const layers = env2.root.children.slice(1);
  check('C3 这一拍把第二张图挂到 incoming 上', layers[1].src === '/media/slide-b', layers[1].src);
  settleImage(layers[1]);
  check('C3 incoming 淡入到 1、outgoing 淡出到 0',
    layers[1].style.opacity === '1' && layers[0].style.opacity === '0',
    layers[1].style.opacity + '/' + layers[0].style.opacity);
  check('C3 过渡时长 = 600ms 的 opacity 过渡', /opacity 600ms/.test(layers[1].style.transition || ''),
    layers[1].style.transition);
  check('C3 底层封面仍然没被动过', env2.root.children[0].src === '/media/cover-token');
}

// ── C4：一拍循环：三张图按顺序绕回来 ───────────────────────────────────────
section('C4. 三张图绕一圈（周期切换不跳图）');
{
  const tick = env2.timers.find((t) => t.alive);
  tick.fn(); // 第二拍 ⇒ slide-c（incoming 换成另一颗层）
  let layers = env2.root.children.slice(1);
  let incoming = layers.find((el) => el.src === '/media/slide-c');
  check('C4 第二拍换到第三张（走的是另一颗层）', !!incoming);
  settleImage(incoming);
  check('C4 第三张淡入（上一张淡出）', incoming.style.opacity === '1'
    && layers.filter((el) => el !== incoming).every((el) => el.style.opacity === '0'));
  tick.fn(); // 第三拍 ⇒ slide-a（绕回第一张）
  layers = env2.root.children.slice(1);
  incoming = layers.find((el) => el.src === '/media/slide-a');
  check('C4 第三拍绕回第一张（% order.length 而不是越界）', !!incoming, JSON.stringify(layers.map((el) => el.src)));
  settleImage(incoming);
  check('C4 绕回的那张也正常淡入', incoming.style.opacity === '1');
}

// ── C5：脱离文档 ⇒ 停表 + 摘图 ────────────────────────────────────────────
section('C5. 壁纸脱离文档（换壁纸 / 清壁纸）⇒ 一拍内停表摘图');
{
  const env = loadMediaPrep();
  const media = mountBase(env);
  env.exports.scheduleImageSlideshow(media, SEL_BASE);
  await flush();
  const tick = env.timers.find((t) => t.alive);
  check('C5 装好后底层 + 两张过场层 = 3 个节点', env.root.children.length === 3);
  media.isConnected = false;
  env.root.isConnected = false;
  tick.fn();
  check('C5 失联那一拍就 clearInterval', !env.timers.some((t) => t.alive),
    JSON.stringify(env.timers.map((t) => t.alive)));
  check('C5 两张过场层被摘掉（不留孤儿图）', env.root.children.length === 1, String(env.root.children.length));
}

// ── C6：页面隐藏 ⇒ 不推进（回来再继续）─────────────────────────────────────
section('C6. document.hidden ⇒ 不推进（后台标签页不连续解码大图）');
{
  const env = loadMediaPrep();
  const media = mountBase(env);
  env.exports.scheduleImageSlideshow(media, SEL_BASE);
  await flush();
  const tick = env.timers.find((t) => t.alive);
  // 两张过场图都"已解码完成" ⇒ 只要推进就一定会立刻交接（否则 commit 要等 load 事件，
  // 判据分不清"没推进"与"推进了但图还没到"）。
  for (const layer of env.root.children.slice(1)) { layer.complete = true; layer.naturalWidth = 1200; }
  env.documentStub.hidden = true;
  tick.fn();
  const layers = env.root.children.slice(1);
  check('C6 隐藏时那一拍没有交接（两张过场层都还是透明）',
    layers.length === 2 && layers.every((el) => el.style.opacity === '0'),
    JSON.stringify(layers.map((el) => el.style.opacity)));
  check('C6 隐藏时连"等图"都没登记（根本没进推进分支）',
    layers.every((el) => !(el._listeners.load && el._listeners.load.length)),
    JSON.stringify(layers.map((el) => (el._listeners.load || []).length)));
  check('C6 隐藏时表照旧跑着（回来能继续）', env.timers.some((t) => t.alive));
  env.documentStub.hidden = false;
  tick.fn();
  const incoming = env.root.children.slice(1).find((el) => (el._listeners.load || []).length > 0);
  check('C6 恢复可见后下一拍正常推进', !!incoming, JSON.stringify(env.root.children.slice(1).map((el) => el.src)));
  settleImage(incoming);
  check('C6 推进的图到位后正常交接（透明不变的是另一颗层）',
    incoming.style.opacity === '1'
    && env.root.children.slice(1).filter((el) => el !== incoming).every((el) => el.style.opacity === '0'));
}

// ── C7：周期换算（用户秒数优先，否则 WE 档位）──────────────────────────────
section('C7. 周期换算：用户秒数 > WE 预设档位；用户 0 才跟随壁纸');
{
  const env = loadMediaPrep();
  const { pictureSlideIntervalMs } = env.exports;
  check('C7 用户设 5 秒 ⇒ 5000ms（压过 WE 的 60000）',
    pictureSlideIntervalMs({ ...SEL_BASE, pictureSlideSeconds: 5 }) === 5000);
  check('C7 用户设 0 ⇒ 跟随 WE 的 60000ms',
    pictureSlideIntervalMs({ ...SEL_BASE, pictureSlideSeconds: 0 }) === 60000);
  check('C7 谁都没设 ⇒ 默认 30000ms（clamp 默认值）',
    pictureSlideIntervalMs({ ...SEL_BASE, pictureSlideSeconds: 0, slideIntervalMs: null }) === 30000);
  check('C7 WE 档位越界（0）=地 5000ms 地板',
    pictureSlideIntervalMs({ ...SEL_BASE, pictureSlideSeconds: 0, slideIntervalMs: 0 }) === 5000);
  check('C7 用户秒数被钳到 3600 秒上限',
    pictureSlideIntervalMs({ ...SEL_BASE, pictureSlideSeconds: 99999 }) === 3600000);
}

// ── C8：改设置 ⇒ 原地重装过场层（图片档的层不会自己重建）─────────────────────
section('C8. `pictureSlideSeconds` 改了 ⇒ 原地停表重装（不必重建整层）');
{
  const env = loadMediaPrep();
  const media = mountBase(env);
  env.exports.scheduleImageSlideshow(media, SEL_BASE);
  await flush();
  const oldTimer = env.timers.find((t) => t.alive);
  env.exports.refreshImageSlideshow({ ...SEL_BASE, pictureSlideSeconds: 15 });
  await flush();
  check('C8 旧表被停掉', !oldTimer.alive);
  check('C8 新表周期 = 15000ms', env.timers.some((t) => t.alive && t.ms === 15000),
    JSON.stringify(env.timers.filter((t) => t.alive).map((t) => t.ms)));
  check('C8 过场层数仍是 2（旧两张摘干净了）', env.root.children.length === 3,
    String(env.root.children.length));
  check('C8 缓存按 `id@周期` 分桶（新周期是冷取）', env.calls.apiJson.length === 2,
    String(env.calls.apiJson.length));
}

// ── C9：变异体负对照：拆掉两道闸，同一段判据必须报红 ─────────────────────────
section('C9. 变异体负对照（拆掉失联闸 / 隐藏闸 ⇒ C5、C6 的判据必须看到差别）');
async function scenarioDetachStops (source) {
  const env = loadMediaPrep(source);
  const media = mountBase(env);
  env.exports.scheduleImageSlideshow(media, SEL_BASE);
  await flush();
  const tick = env.timers.find((t) => t.alive);
  if (!tick) return true; // 装都没装上 ⇒ 判据已失败，交给 C2 报
  media.isConnected = false;
  env.root.isConnected = false;
  tick.fn();
  return !env.timers.some((t) => t.alive) && env.root.children.length === 1;
}
async function scenarioHiddenHolds (source) {
  const env = loadMediaPrep(source);
  const media = mountBase(env);
  env.exports.scheduleImageSlideshow(media, SEL_BASE);
  await flush();
  const tick = env.timers.find((t) => t.alive);
  for (const layer of env.root.children.slice(1)) { layer.complete = true; layer.naturalWidth = 1200; }
  env.documentStub.hidden = true;
  tick.fn();
  const layers = env.root.children.slice(1);
  return layers.every((el) => el.style.opacity === '0')
    && layers.every((el) => !(el._listeners.load && el._listeners.load.length));
}
const detachMutant = MEDIA_CODE.replace('if (!media.isConnected || !parent.isConnected) { stop(); return; }',
  'if (false) { stop(); return; }');
const hiddenMutant = MEDIA_CODE.replace('if (document.hidden) return;', 'if (false) return;');
check('C9 两个变异体都真的改到了源码锚点', detachMutant !== MEDIA_CODE && hiddenMutant !== MEDIA_CODE);
check('C9 失联闸被拆 ⇒ C5 判据判红（说明那条闸真的在判）',
  (await scenarioDetachStops(MEDIA_CODE)) === true && (await scenarioDetachStops(detachMutant)) === false);
check('C9 隐藏闸被拆 ⇒ C6 判据判红', (await scenarioHiddenHolds(MEDIA_CODE)) === true
  && (await scenarioHiddenHolds(hiddenMutant)) === false);

// ── C10：装配点的静态契约（vm 装载碰不到的部分）─────────────────────────────
section('C10. 装配点：buildMedia 接上 / applySelection 落地与清空 / CSS 定位 / 面板与文案');
{
  const mediaSrc = MEDIA_CODE;
  const applyStart = mediaSrc.indexOf('function applySelection(');
  const buildStart = mediaSrc.indexOf('function buildMedia(');
  const applyBody = mediaSrc.slice(applyStart, buildStart);
  const buildBody = mediaSrc.slice(buildStart, mediaSrc.indexOf('const SLIDE_FADE_MS'));
  check('C10 applySelection：两处早退清空块都清掉 slidesUrl / slideIntervalMs',
    (applyBody.match(/selection\.slidesUrl = null;/g) || []).length >= 2
    && (applyBody.match(/selection\.slideIntervalMs = null;/g) || []).length >= 2);
  check('C10 applySelection：image 条目落地两个字段（有条件下传）',
    /selection\.slidesUrl = w\.type === "image" && w\.slidesUrl \? w\.slidesUrl : null;/.test(applyBody)
    && /selection\.slideIntervalMs = w\.type === "image" && typeof w\.slideIntervalMs === "number" \? w\.slideIntervalMs : null;/.test(applyBody));
  check('C10 buildMedia：图片支真的调了 scheduleImageSlideshow',
    /if \(sel\.type === "image" && sel\.slidesUrl\) scheduleImageSlideshow\(media, sel\);/.test(buildBody));
  check('C10 buildMedia：重建这一层前先摘掉上一档过场层（否则旧图集压在换上的新壁上，最多等一个周期）',
    /if \(activeImageSlideshow\) activeImageSlideshow\.stop\(\);/.test(buildBody));
  const styleSrc = readFileSync(STYLE_SRC, 'utf8');
  check('C10 CSS：`.we-layer .we-slide` 绝对定位铺满（否则两颗过场图上下排开）',
    /\.we-layer \.we-slide \{ position: absolute; inset: 0; \}/.test(styleSrc));
  const clientSrc = readFileSync(CLIENT_SRC, 'utf8');
  check('C10 client.js：selection 带两个 transient 字段', /slidesUrl: null,\s*\n\s*slideIntervalMs: null,/.test(clientSrc));
  check('C10 client.js：处理器钳制走 schemaRange（不许数字字面量，否则改 KINDS 会漏改）+ 原地重装',
    /const onPictureSlideSeconds = \(e\) => \{[\s\S]{0,400}?clampNum\(Number\(e\.target\.value\), \.\.\.schemaRange\("pictureSlideSeconds"\), DEFAULTS\.pictureSlideSeconds\)[\s\S]{0,600}?setSetting\("pictureSlideSeconds", seconds\)[\s\S]{0,600}?refreshImageSlideshow\(selection\)/.test(clientSrc));
  check('C10 client.js：renderWallpaperTab 实参把回调传下去', /onPictureSlideSeconds,/.test(clientSrc.slice(clientSrc.indexOf('renderWallpaperTab({'), clientSrc.indexOf('renderWallpaperTab({') + 2400)));
  const panelSrc = readFileSync(PANEL_SRC, 'utf8');
  check('C10 面板：图片轮播 ctl 存在、`we-picker__picture-slide-interval`、非多图时禁用',
    /we-picker__picture-slide-interval/.test(panelSrc)
    && /disabled: !\(sel\.type === "image" && sel\.slidesUrl\)/.test(panelSrc)
    && /onPictureSlideSeconds/.test(panelSrc));
  const i18nSrc = readFileSync(I18N_SRC, 'utf8');
  check('C10 i18n：新增文案有英文（图片轮播 / 跟随壁纸）',
    /"图片轮播": "Picture slideshow"/.test(i18nSrc) && /"跟随壁纸": "Follow wallpaper"/.test(i18nSrc));
  check('C10 i18n：秒 / 分钟模板都有英文（选项文本走 `{n} 秒` / `{n} 分钟`）',
    /"\{n\} 秒": "\{n\}s"/.test(i18nSrc) && /"\{n\} 分钟": "\{n\} min"/.test(i18nSrc));
}

// ── 收尾 ─────────────────────────────────────────────────────────────────
console.log('');
if (failed) {
  console.log(`FAILED (${failed}) / passed (${passed})`);
  process.exit(1);
}
console.log(`ALL SLIDESHOW-CLIENT CHECKS PASSED (${passed})`);
