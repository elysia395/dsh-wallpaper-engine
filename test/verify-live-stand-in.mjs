#!/usr/bin/env node
/**
 * verify-live-stand-in.mjs —— 实时渲染**垫底/降级期间屏上那张图**：不糊、不黑。
 *
 * ── 它守的是什么 ────────────────────────────────────────────────────────────
 * 场景壁纸的实时渲染不是常驻的：首帧之前、重挂期间、以及实时渲染不可用时，屏上下层那张
 * 垫底图（`.we-live-poster` / 静态帧 `<img>`）才是用户看到的东西。它有两个**独立**的病：
 *
 * ① **糊**：垫底图用的是作者预览图，而 `/preview/<token>` 默认发的是给 92px 卡片用的
 *    320px / `-q:v 5` 缩略图（#240）。同一条 URL 被两个尺度差三个数量级的消费者共用 ——
 *    本机实测：作者预览源图 1019×1019 / 215 KB，宿主发出来是 320×320 / 5.5 KB，铺满
 *    1603×1028 设备像素要放大 5 倍。修法：全屏口径显式要源图（`?full=1`），卡片不动。
 * ② **黑**：渲染页 `html/body` 铺着不透明 `#000`。画布由引擎在装配时才建
 *    （`ensureSceneCanvas` 会删旧建新），而装配要先拉完 scene.pkg —— 这段空窗里没有画布，
 *    页面底色就是屏上那一层，于是它整块盖掉了下层垫底图。修法：底色透明。
 *    配套：首帧看护超时那条腿不派发 `error` 事件，`.load()` 的 rejected 分支必须自己挂
 *    兜底页，否则"失败要有可见落点"只在一半路径上成立。
 *
 * ── 判据（每条都配负对照，喂同一个判据函数）────────────────────────────────
 *   H1/H2 路由行为：带 `full=1` ⇒ `serveFile` 收到**源图**、`ensureImagePreview` 一次没调；
 *          不带 ⇒ 仍然走缩略图管线（卡片那条链没被动过）。
 *   H3     源码顺序：`full` 的早退必须**排在**缩略图分支**之前**（排到后面等于没修）。
 *   C1     纯工具 `weFullPreviewUrl` 的语义：附加、幂等、保留既有查询串、非字符串原样。
 *   C2     客户端接线：全屏口径的 `selection.previewUrl` 走 `weFullPreviewUrl`。
 *   C3     卡片侧没被连带：picker 两个模块里不出现 `full=1`。
 *   L1     渲染页底色不得是不透明的（黑底会盖掉垫底图）。
 *   L2     `.load()` 的 rejected 分支必须挂兜底页（首帧超时是"静默黑"的唯一来源）。
 *   L3     耦合前提：垫底图只在 `.we-live-on` 在场时才收（否则修法 ② 的前提不成立）。
 *
 * Usage:  node test/verify-live-stand-in.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCheck } from './tools/assert-harness.mjs';
import { registerMediaBytesRoutes } from '../packages/media-bridge/lib/routes/media-bytes.js';
import { weFullPreviewUrl } from '../src/we-base.js';

const { check, stats } = createCheck();
const src = (rel) => readFileSync(fileURLToPath(new URL('../' + rel, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const ROUTE = src('packages/media-bridge/lib/routes/media-bytes.js');
const PREP = src('src/media-prep.js');
const RENDER_HTML = src('lib/webwallgl/index.html');
const RENDER_JS = src('lib/webwallgl/renderer.js');
const STYLES = src('src/styles-base.js');

const BASE = '/wallpaper-engine';
const TOKEN = 'QzpcUHJvZ3JhbSBGaWxlcyAoeDg2KVxzY2VuZS5wa2c';
const ABS = 'C:\\wallpapers\\3469542717\\preview.jpg';

/** 与宿主同形的最小 webServer：只收 `register`，handler 由用例直接调。 */
function fakeServer() {
  const registered = new Map();
  return {
    registered,
    register(spec) { registered.set(spec.path, spec); return () => {}; },
  };
}

/**
 * 跑一次 `/preview` 请求：返回 `serveFile` 的调用记录与 `ensureImagePreview` 的入参。
 * `thumb` 传 null 模拟"缩略图生成失败"（本路由的既有回落：改发原图）。
 */
async function hitPreview(url, thumb = 'C:\\cache\\thumbs\\ip_deadbeef.jpg') {
  const server = fakeServer();
  const serveCalls = [];
  const previewAsked = [];
  registerMediaBytesRoutes(server, {
    disposers: [],
    base: BASE,
    serveFile: (abs, req, res, headOnly, opts) => {
      serveCalls.push({ abs, headOnly, opts });
      res.statusCode = 200;
      res.end();
    },
    serveLayout: () => { throw new Error('unexpected serveLayout'); },
    mediaMap: new Map([[TOKEN, ABS]]),
    log: () => {},
    pinnedFaststartVariant: () => null,
    ensureImagePreview: async (abs) => { previewAsked.push(abs); return thumb; },
  });
  const spec = server.registered.get(`${BASE}/preview`);
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end() {},
  };
  spec.handler({ method: 'GET', url }, res);
  // 缩略图分支是 async IIFE（`ensureImagePreview` 之后才 serveFile）⇒ 让出事件循环。
  await new Promise((resolve) => setTimeout(resolve, 20));
  return { serveCalls, previewAsked, statusCode: res.statusCode };
}

// ── H1 带 `full=1`：源图直出，缩略图管线零调用 ───────────────────────────────
{
  const r = await hitPreview(`${BASE}/preview/${TOKEN}?full=1`);
  check('H1 `?full=1` 直出源图（serveFile 收到的是源图绝对路径）',
    r.serveCalls.length === 1 && r.serveCalls[0].abs === ABS,
    JSON.stringify(r.serveCalls.map((c) => c.abs)));
  check('H1b `?full=1` 不触碰缩略图管线（ensureImagePreview 一次没调）',
    r.previewAsked.length === 0, 'asked=' + r.previewAsked.length);
  check('H1c `?full=1` 仍带 revalidate（ETag/304 语义不丢）',
    Boolean(r.serveCalls[0] && r.serveCalls[0].opts && r.serveCalls[0].opts.revalidate === true),
    JSON.stringify(r.serveCalls[0] && r.serveCalls[0].opts));
}

// ── H2 不带参数：卡片那条链逐字不变（缩略图优先）─────────────────────────────
{
  const THUMB = 'C:\\cache\\thumbs\\ip_deadbeef.jpg';
  const r = await hitPreview(`${BASE}/preview/${TOKEN}`);
  check('H2 默认请求仍走缩略图（serveFile 收到缩略图路径）',
    r.serveCalls.length === 1 && r.serveCalls[0].abs === THUMB, JSON.stringify(r.serveCalls.map((c) => c.abs)));
  check('H2b 默认请求会问 ensureImagePreview（源图作为入参）',
    r.previewAsked.length === 1 && r.previewAsked[0] === ABS, JSON.stringify(r.previewAsked));
}

// ── H2c 缩略图失败仍回落原图（既有语义，别被早退改坏）───────────────────────
{
  const r = await hitPreview(`${BASE}/preview/${TOKEN}`, null);
  check('H2c 缩略图生成失败 ⇒ 回落源图（既有回落语义保留）',
    r.serveCalls.length === 1 && r.serveCalls[0].abs === ABS, JSON.stringify(r.serveCalls.map((c) => c.abs)));
}

// ── H3 源码顺序：早退必须在缩略图分支之前 ───────────────────────────────────
/** `full` 早退排在 `ensureImagePreview` 之前 ⇒ true。换序 ⇒ false（负对照用它）。 */
function FS(text) {
  const full = text.indexOf("searchParams.get('full')");
  const thumb = text.indexOf('await ensureImagePreview(');
  return full >= 0 && thumb >= 0 && full < thumb;
}
{
  check('H3 源码顺序：`full` 早退排在缩略图分支之前', FS(ROUTE));

  // 负对照：把早退整段搬到 `await ensureImagePreview(...)` **之后** —— 同一判据必须判否。
  const FULL_BLOCK = ROUTE.slice(ROUTE.indexOf('        // ── `?full=1`'), ROUTE.indexOf('        // 新清单始终用源图 token'));
  const stripped = ROUTE.replace(FULL_BLOCK, '');
  const thumbAt = stripped.indexOf('await ensureImagePreview(');
  const afterLine = stripped.indexOf('\n', thumbAt) + 1;
  const misplaced = stripped.slice(0, afterLine) + FULL_BLOCK + stripped.slice(afterLine);
  check('H3b 负对照：早退被搬到缩略图分支之后 ⇒ 判否',
    FULL_BLOCK.length > 0 && thumbAt > 0 && FS(misplaced) === false,
    'block=' + FULL_BLOCK.length + 'B movedAfter=' + (misplaced !== stripped));
}

// ── C1 `weFullPreviewUrl` 的语义 ────────────────────────────────────────────
{
  check('C1 追加参数', weFullPreviewUrl('/wallpaper-engine/preview/T') === '/wallpaper-engine/preview/T?full=1',
    String(weFullPreviewUrl('/wallpaper-engine/preview/T')));
  check('C1b 保留既有查询串（用 & 续接）',
    weFullPreviewUrl('/preview/T?v=4') === '/preview/T?v=4&full=1', String(weFullPreviewUrl('/preview/T?v=4')));
  check('C1c 幂等：已带 full=1 不叠加',
    weFullPreviewUrl('/preview/T?full=1') === '/preview/T?full=1'
      && weFullPreviewUrl('/preview/T?v=4&full=1') === '/preview/T?v=4&full=1',
    String(weFullPreviewUrl('/preview/T?full=1')));
  check('C1d null / 空串 / 非字符串原样返回（null 语义留给调用方）',
    weFullPreviewUrl(null) === null && weFullPreviewUrl('') === '' && weFullPreviewUrl(undefined) === undefined,
    JSON.stringify([weFullPreviewUrl(null), weFullPreviewUrl('')]));
}

// ── C2 客户端接线：全屏口径的 previewUrl 走源图 ─────────────────────────────
{
  const wired = (text) => /selection\.previewUrl\s*=\s*weFullPreviewUrl\(w\.preview\)\s*\|\|\s*null;/.test(text)
    && !/selection\.previewUrl\s*=\s*w\.preview\s*\|\|\s*null;/.test(text);
  check('C2 `selection.previewUrl` 走 weFullPreviewUrl（全屏垫底要源图）', wired(PREP));
  check('C2b 负对照：改回裸 `w.preview || null` ⇒ 判否',
    wired(PREP.replace('selection.previewUrl = weFullPreviewUrl(w.preview) || null;',
      'selection.previewUrl = w.preview || null;')) === false);
}

// ── C3 卡片侧没被连带（picker 不得出现 full=1）──────────────────────────────
{
  const bad = ['src/picker-model.js', 'src/picker-modal.js']
    .filter((f) => /full=1/.test(src(f)));
  check('C3 卡片侧（picker-model / picker-modal）不含 full=1（320px 缩略图仍是卡片口径）',
    bad.length === 0, bad.join(', '));
}

// ── L1 渲染页底色：不得是不透明的（黑底会整块盖掉下层垫底图）────────────────
{
  /** 取 `html, body` 那条规则块；块里出现不透明底色 ⇒ true（= 违约）。 */
  const opaquePageBg = (html) => {
    const at = html.indexOf('html,');
    if (at < 0) return true; // 找不到规则块 ⇒ 无法证明"透明"，按违约处理（不放水）
    const open = html.indexOf('{', at);
    const close = html.indexOf('}', open);
    if (open < 0 || close < 0) return true;
    const block = html.slice(open + 1, close);
    return /background(?:-color)?\s*:\s*(#000(?:000)?\b|black\b|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\))/i.test(block)
      || !/background(?:-color)?\s*:\s*transparent\b/i.test(block);
  };
  check('L1 渲染页 html/body 底色是 transparent（空窗透出下层垫底图，而不是黑屏）',
    opaquePageBg(RENDER_HTML) === false);
  check('L1b 负对照：把底色改回 `#000` ⇒ 判否',
    opaquePageBg(RENDER_HTML.replace('background: transparent;', 'background: #000;')) === true);
}

// ── L2 `.load()` 的 rejected 分支必须挂兜底页 ───────────────────────────────
{
  /** `.load(src)` 的 catch 体里出现 showFallback() ⇒ true。 */
  const catchShowsFallback = (text) => {
    const at = text.indexOf('.load(src)');
    if (at < 0) return false;
    const catchAt = text.indexOf('.catch(', at);
    if (catchAt < 0) return false;
    const open = text.indexOf('{', catchAt);
    const close = text.indexOf('}', open);
    return open > 0 && close > open && /showFallback\(\)/.test(text.slice(open, close));
  };
  check('L2 首帧超时（load 被 reject）也挂兜底页（失败有可见落点，不是静默黑）',
    catchShowsFallback(RENDER_JS));
  // 负对照：把 catch 体换成只吞 Promise 的形态（修法前的原文）。
  const swallowed = RENDER_JS.replace(/\.catch\(\(\) => \{[\s\S]*?\n    \}\);/, '.catch(() => {\n      /* 吞掉 Promise */\n    });');
  check('L2b 负对照：catch 只吞 Promise ⇒ 判否',
    swallowed !== RENDER_JS && catchShowsFallback(swallowed) === false);
}

// ── L3 耦合前提：垫底图只在 `.we-live-on` 在场时收 ──────────────────────────
// L1 的前提是"iframe 透明时下层垫底图还在"。那条规则一旦改成无条件 opacity:0（或在别的
// 状态下也收），透明底色就会露出**真空**（原生底色），黑屏换个形式回来。所以前提本身在册。
{
  const hasFadeGate = /\.we-layer:has\(\.we-live-iframe\.we-live-on\)\s+\.we-live-poster\s*\{[^}]*opacity:\s*0/.test(STYLES);
  check('L3 垫底图只在 `.we-live-on` 在场时收（透明渲染页的下层始终有图）', hasFadeGate);
}

console.log('');
if (stats.failed) {
  console.error('LIVE STAND-IN CHECKS FAILED — ' + stats.failed + ' failed, ' + stats.passed + ' passed');
  process.exitCode = 1;
} else {
  console.log('ALL LIVE STAND-IN CHECKS PASSED (' + stats.passed + ')');
}
