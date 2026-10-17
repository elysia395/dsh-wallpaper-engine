#!/usr/bin/env node
/**
 * verify-slideshow-client.mjs — 图片 / 幻灯片壁纸**客户端轮播腿**的聚焦判据
 * （`src/media-prep.js` 的 `scheduleImageSlideshow` / `installImageSlideshow`）。
 *
 * 为什么单独一个守卫：这条腿在 `test/verify-client.mjs` 的挂载台里跑不到 —— 那套夹具
 * 的 `fetch` 没有 `/slides/<token>` 应答，`selection` 也不会带 `slidesUrl`。于是
 * 「清单到齐后是否真的开始轮播」在别处只有静态判据（字段是否被登记），没有行为判据。
 * 而它的两种典型坏法都是静默的：过场图**没有绝对定位**（两张图在文档流里上下排开 ⇒
 * 看上去永远停在首图，用户报告的正是这个症状）与**层换掉后定时器没停**（旧图每
 * interval 拉着已卸载的 DOM 跑）。
 *
 * 判据口径：在 `node:vm` 里**跑真源码**（去掉尾部 `export {…}` 块，其余逐字），
 * 只替换浏览器边界（`document` / `window` / `apiJson` / `clampNum`）。每条判据只定义
 * 一次，正/负对照调同一个函数；负对照喂的是**变异源码**。
 *
 * Usage: node test/verify-slideshow-client.mjs
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createCheck } from './tools/assert-harness.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ISO = join(ROOT, '.test-cache', 'slideshow-client-guard');
const SRC = join(ROOT, 'src', 'media-prep.js');
const { check, stats } = createCheck();

rmSync(ISO, { recursive: true, force: true });
mkdirSync(ISO, { recursive: true });

/** 浏览器边界替身：`document` / `window` / 取数 / 钳位，并记录可观察行为。 */
function makeEnv(options = {}) {
  const images = options.images || ['u1', 'u2', 'u3'];
  const appended = [];
  const removed = [];
  const timers = [];
  let fetchCount = 0;
  const doc = {
    hidden: Boolean(options.hidden),
    createElement(tag) {
      const el = {
        tagName: String(tag).toUpperCase(), className: '', alt: '', draggable: true, src: '',
        style: {}, isConnected: true, parentNode: null, listeners: {},
        complete: true, naturalWidth: 4,
        addEventListener(type, fn) { this.listeners[type] = fn; },
        remove() { removed.push(this); this.parentNode = null; this.isConnected = false; },
      };
      return el;
    },
  };
  const parent = {
    isConnected: true, children: [],
    appendChild(child) { child.parentNode = parent; child.isConnected = true; parent.children.push(child); appended.push(child); },
  };
  const media = doc.createElement('img');
  media.src = images[0];   // 底层首图（生产链里由 buildMedia 先设好）
  parent.appendChild(media);
  const win = {
    setInterval(fn, ms) { timers.push({ fn, ms, cleared: false }); return timers.length; },
    clearInterval(handle) { const t = timers[handle - 1]; if (t) t.cleared = true; },
  };
  const context = vm.createContext({
    document: doc, window: win,
    // 与 lib/settings-schema.js 的 clampNum 同语义：越界即回落默认值。
    clampNum: (v, lo, hi, fallback) => (typeof v === 'number' && v >= lo && v <= hi ? v : fallback),
    apiJson: () => {
      fetchCount++;
      return Promise.resolve({ ok: true, status: 200, data: { ok: true, images: images.map((url) => ({ name: url, url })) } });
    },
  });
  return { context, doc, win, timers, appended, removed, media, parent, images, fetches: () => fetchCount };
}

/** 跑源码：`node:vm` 里求值真源码（尾部 export 块去掉），返回两个入口 + 替身环境。 */
function boot(source, options) {
  const env = makeEnv(options);
  const cut = source.lastIndexOf('\nexport {');
  const body = (cut >= 0 ? source.slice(0, cut) : source)
    + '\n;({ scheduleImageSlideshow, installImageSlideshow })';
  const script = new vm.Script(body, { filename: 'media-prep.guard.js' });
  const api = script.runInContext(env.context);
  env.api = api;
  return env;
}

const flush = () => new Promise((r) => { setTimeout(r, 0); });

// ── 判据（正/负对照共用）─────────────────────────────────────────────────────
/** ① 没有清单入口 ⇒ 一次取数都不发（普通图片 / 上传图不受影响）。 */
async function noFetchWithoutManifest(runEnv) {
  const env = runEnv();
  env.api.scheduleImageSlideshow(env.media, { id: 'plain', type: 'image' });
  await flush();
  const overlays = env.appended.filter((el) => el.className.includes('we-slide'));
  return env.fetches() === 0 && overlays.length === 0;
}

/** ② 清单到齐 ⇒ 底层之上叠两张过场图，第二张预载、周期取声明值。 */
async function installsTwoOverlays(runEnv) {
  const env = runEnv();
  env.api.scheduleImageSlideshow(env.media, { id: 'w', type: 'image', slidesUrl: '/slides/t', slideIntervalMs: 5000 });
  await flush();
  const overlays = env.appended.filter((el) => el.className.includes('we-slide'));
  return overlays.length === 2
    && env.media.src === 'u1' && !env.media.style.opacity // 底层首图不被改写（透明度归 CSS 变量管）
    && overlays[1].src === 'u2'   // 第二张预载，第一拍立刻换画
    && env.timers.length === 1 && env.timers[0].ms === 5000;
}

/** ③ 一拍推进 ⇒ 可见的那张淡入（opacity 1）。 */
async function tickAdvances(runEnv) {
  const env = runEnv();
  env.api.scheduleImageSlideshow(env.media, { id: 'w', type: 'image', slidesUrl: '/slides/t', slideIntervalMs: 5000 });
  await flush();
  const overlays = env.appended.filter((el) => el.className.includes('we-slide'));
  env.timers[0].fn();
  return overlays[1].style.opacity === '1';
}

/** ④ 层被换掉（底层离开 DOM）⇒ 下一拍停表并摘掉过场图。 */
async function stopsWhenDetached(runEnv) {
  const env = runEnv();
  env.api.scheduleImageSlideshow(env.media, { id: 'w', type: 'image', slidesUrl: '/slides/t', slideIntervalMs: 5000 });
  await flush();
  env.media.isConnected = false;
  env.timers[0].fn();
  return env.removed.length === 2 && env.timers[0].cleared === true;
}

/** ⑤ 页面隐藏那拍不推进（恢复可见后继续）。 */
async function hiddenDoesNotAdvance(runEnv) {
  const env = runEnv();
  env.api.scheduleImageSlideshow(env.media, { id: 'w', type: 'image', slidesUrl: '/slides/t', slideIntervalMs: 5000 });
  await flush();
  const overlays = env.appended.filter((el) => el.className.includes('we-slide'));
  env.doc.hidden = true;
  env.timers[0].fn();
  return overlays[1].src === 'u2' && overlays[1].style.opacity === '0' && env.removed.length === 0;
}

// ── 变异体 ──────────────────────────────────────────────────────────────────
function mutate(label, transform) {
  const src = readFileSync(SRC, 'utf8');
  const out = transform(src);
  if (out === src) throw new Error('变异体没改到源码（判据会失真）: ' + label);
  const file = join(ISO, label + '.mjs');
  writeFileSync(file, out);
  return out;
}

// ═══ 正向判据 ═══════════════════════════════════════════════════════════════
const source = readFileSync(SRC, 'utf8');
const run = (options) => boot(source, options);

check('C1 没有 slidesUrl ⇒ 不取清单、不叠过场图（普通图片不受影响）',
  await noFetchWithoutManifest(() => run()));
check('C2 清单到齐 ⇒ 两张过场图（we-slide）叠上，第二张预载，周期 = 声明值',
  await installsTwoOverlays(() => run()));
check('C3 一拍推进 ⇒ 第二张淡入（可见）', await tickAdvances(() => run()));
check('C4 底层离开 DOM ⇒ 停表 + 摘掉两张过场图', await stopsWhenDetached(() => run()));
check('C5 页面隐藏那拍不推进（图与透明度都不变）', await hiddenDoesNotAdvance(() => run()));

// 覆盖面地板：夹具必须真的给到 3 张图（少于此 C2 的"预载第 2 张"会退化成恒真）。
check('C6 覆盖面：夹具 3 张图，判据不是空集', (() => {
  const env = makeEnv();
  return env.images.length === 3;
})());

// ═══ 负对照（同一段判据，喂变异源码）═══════════════════════════════════════
const noDetachGuard = mutate('no-detach-guard', (s) => s.replace(
  'if (!media.isConnected || !parent.isConnected) { stop(); return; }',
  'if (false) { stop(); return; }'));
check('C7 负对照：变异体删掉脱离闸 ⇒ C4 判据判红',
  await stopsWhenDetached(() => boot(noDetachGuard)) === false);

const noHiddenGuard = mutate('no-hidden-guard', (s) => s.replace(
  'if (document.hidden) return; // 页面隐藏不推进；恢复可见后下一拍继续',
  'if (false) return; // 页面隐藏不推进；恢复可见后下一拍继续'));
check('C8 负对照：变异体删掉隐藏闸 ⇒ C5 判据判红',
  await hiddenDoesNotAdvance(() => boot(noHiddenGuard)) === false);

console.log(`\n${stats.failed === 0 ? 'ALL SLIDESHOW-CLIENT CHECKS PASSED' : 'SLIDESHOW-CLIENT CHECKS FAILED'} (${stats.passed + stats.failed})`);
process.exit(stats.failed === 0 ? 0 : 1);
