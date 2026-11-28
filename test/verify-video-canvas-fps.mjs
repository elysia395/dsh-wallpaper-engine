// verify-video-canvas-fps.mjs — #383 的守卫：「Edge 兼容」路径下 canvas 逐帧
// drawImage 的帧率上限（固定 30）。
//
// 为什么需要它：edgeCompat 开启时（Edge 下默认开）`buildVideoMedia()` 把 <video>
// 藏到屏外、改用 <canvas> 逐帧 drawImage 上屏，每帧都是一次纹理回读 + CPU 上传。
// 2K60 的源在 60–120Hz 的 rVFC/rAF 回调里每帧都画，会把主线程与合成器一起拖慢；
// 实测「解码帧一个不少、媒体时钟只走 89.5%」（#383）。修复是在 weDrawTick 里加
// 时间戳节流：首绘不节流，之后只画距上一笔 ≥ 1000/30 ms 的那些帧，rVFC/rAF 的
// 重挂节奏不变（视频照常解码）。
//
// 覆盖：
//   S1 源码静态判据：常量 30、首绘条件、两条重挂分支、weStopDraw 重置时间戳。
//   A1 首绘立即画，且副作用（dataset.weDrawn）没有被节流吃掉。
//   A2 rVFC 路径：60Hz 回调跑 1 秒 → 绘制 ≈ 30 次（不是 60 次、也不是 1 次）。
//   A3 负对照：把常量改成 60 再跑同样的 1 秒 → 绘制 ≈ 60 次（证明是节流在起作用，
//      而不是「永远只画首帧」）。
//   A4 rAF 回退路径同样被节流；暂停时不重挂下一帧（原语义保留）。
//   A5 换壁纸（weStopDraw → weStartDraw）后首绘仍然立即发生（时间戳被重置）。
//   A6 画布尺寸变化（ResizeObserver）立即重画，不受节流影响。
//   A7 软渲染档（#411）：探测为真时同一 1 秒压到 ≈ 15 次。
//   A8 负对照：把软渲染判定改成恒 false，同样 1 秒回到 ≈ 30 次（证明 15 档由探测决定，不是写死）。
//   A9 软渲染降档只留一条诊断（带渲染器名），不是每帧一条。
//   A10 负对照：硬件路径不产生这条诊断（证明留痕由探测决定，不是无条件写）。
//
// Usage: node test/verify-video-canvas-fps.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
}

const SRC = readFileSync(new URL('../src/client/media-frame.js', import.meta.url), 'utf8');

// ── S1. 静态判据 ────────────────────────────────────────────────────────────
check('S1 常量 WE_DRAW_FPS_CAP = 30 存在', /const WE_DRAW_FPS_CAP = 30;/.test(SRC));
check('S1 最小间隔由常量派生（含 0.5ms 浮点容差）',
  /const WE_DRAW_MIN_INTERVAL_MS = 1000 \/ WE_DRAW_FPS_CAP - 0\.5;/.test(SRC));
check('S1 weDrawTick 用「首绘或间隔够一帧」判据',
  /weLastDrawAt === 0 \|\| now - weLastDrawAt >= minInterval/.test(SRC));
check('S1 最小间隔按软渲染判定二选一（15 档 / 30 档），不是两段重复的条件',
  /const minInterval = softRender \? SOFT_RENDER_MIN_INTERVAL_MS : WE_DRAW_MIN_INTERVAL_MS;/.test(SRC));
check('S1 节流只跳过绘制、rVFC 重挂照旧',
  /v\.requestVideoFrameCallback\) \{ weVfHandle = v\.requestVideoFrameCallback\(weDrawTick\)/.test(SRC));
check('S1 rAF 回退的暂停判据未变（!v.paused && !v.ended）',
  /if \(!v\.paused && !v\.ended\) \{ weRafId = requestAnimationFrame\(weDrawTick\)/.test(SRC));
check('S1 软渲染档常量 15 与它自己的最小间隔都在',
  /const SOFT_RENDER_DRAW_FPS = 15;/.test(SRC)
  && /const SOFT_RENDER_MIN_INTERVAL_MS = 1000 \/ SOFT_RENDER_DRAW_FPS - 0\.5;/.test(SRC));
check('S1 weStopDraw 重置 weLastDrawAt = 0',
  /weDrawCtx = null;\s*\n\s*\/\/[^\n]*\n\s*weLastDrawAt = 0;/.test(SRC));

// ── 沙箱：直接执行 src/client/media-frame.js（内联模块，无 import） ────────
function loadFrame(source, { useRvfc = true, softRender = false } = {}) {
  const harness = {
    draws: 0,
    notes: 0,
    clock: 0,
    rafQueue: [],
    rvfcCb: null,
    resizeCbs: [],
    logs: [],
    canvas: null,
    video: null
  };
  const canvas = {
    isConnected: true,
    clientWidth: 1280,
    clientHeight: 720,
    width: 0,
    height: 0,
    dataset: {},
    getContext() {
      return {
        clearRect() {},
        drawImage() { harness.draws += 1; }
      };
    }
  };
  const video = {
    videoWidth: 1920,
    videoHeight: 1080,
    paused: false,
    ended: false,
    dataset: {},
    listeners: {},
    addEventListener(type, cb) { (video.listeners[type] ||= []).push(cb); },
    cancelVideoFrameCallback() {}
  };
  if (useRvfc) {
    video.requestVideoFrameCallback = (cb) => { harness.rvfcCb = cb; return 1; };
  }
  harness.canvas = canvas;
  harness.video = video;
  const globals = {
    performance: { now: () => harness.clock },
    window: { devicePixelRatio: 2 },
    document: { body: {} },
    getComputedStyle: () => ({ getPropertyValue: () => 'cover' }),
    requestAnimationFrame(cb) { harness.rafQueue.push(cb); return harness.rafQueue.length; },
    cancelAnimationFrame() {},
    ResizeObserver: class {
      constructor(cb) { harness.resizeCbs.push(cb); }
      observe() {}
      disconnect() {}
    },
    noteLayerContent() { harness.notes += 1; },
    // #411：降档留痕走 liveLog（真源码里由 src/live-layer/diag.js 提供）。这里收进 harness，
    // A9 / A10 才有东西可断；不注入也能跑，源码里的 typeof 守卫会静默跳过留痕。
    liveLog(tag, detail, level) { harness.logs.push({ tag, detail, level }); }
  };
  // #411：软渲染档的探测桩。真源码在构建期由 probe.js 提供同名函数，这里按用例注入；
  // 不注入 ⇒ `typeof liveSoftRenderProbeNow` 不是 function ⇒ 源码按硬件处理（30fps 档）。
  if (softRender) {
    globals.liveSoftRenderProbeNow = () => true;
    globals.liveSoftRenderName = 'ANGLE (Google, SwiftShader Device)';
  }
  const context = vm.createContext(globals);
  const api = vm.runInContext(
    source + '\n;({ weDrawTick, weStartDraw, weStopDraw, weDrawFrame });',
    context,
    { filename: 'media-frame.js' }
  );
  harness.api = api;
  return harness;
}

/** 推进虚拟时钟并触发 rVFC 回调（每次回调后 weDrawTick 会重挂下一个）。 */
function runRvfc(harness, seconds, fps = 60) {
  const steps = Math.round(seconds * fps);
  for (let i = 0; i < steps; i += 1) {
    harness.clock += 1000 / fps;
    const cb = harness.rvfcCb;
    harness.rvfcCb = null;
    if (!cb) return;
    cb(harness.clock, {});
  }
}

/** 推进虚拟时钟并冲刷 rAF 队列（模拟浏览器每帧调度）。 */
function runRaf(harness, seconds, fps = 60) {
  const steps = Math.round(seconds * fps);
  for (let i = 0; i < steps; i += 1) {
    harness.clock += 1000 / fps;
    const queue = harness.rafQueue.splice(0);
    for (const cb of queue) cb(harness.clock);
  }
}

// ── A1. 首绘：立即画，副作用就位 ───────────────────────────────────────────
{
  const h = loadFrame(SRC);
  h.api.weStartDraw(h.canvas, h.video);
  check('A1 首绘立即 drawImage 一次', h.draws === 1, 'draws=' + h.draws);
  check('A1 首绘副作用 dataset.weDrawn = "1" 仍生效', h.canvas.dataset.weDrawn === '1');
  check('A1 首绘触发 noteLayerContent 一次', h.notes === 1, 'notes=' + h.notes);
  h.api.weStopDraw();
}

// ── A2. rVFC 60Hz 跑 1 秒 → 约 30 次绘制（不是 60 次、不是 1 次） ──────────
{
  const h = loadFrame(SRC);
  h.api.weStartDraw(h.canvas, h.video);
  const first = h.draws; // 1（首绘）
  runRvfc(h, 1.0, 60);
  const throttled = h.draws - first;
  check('A2 60Hz 回调 1 秒内绘制 ≈ 30 次', throttled >= 28 && throttled <= 33, 'throttled=' + throttled);
  check('A2 没有退化成「只画首帧」', throttled >= 25, 'throttled=' + throttled);
  check('A2 没有被节流完全放开（不是 60 次）', throttled <= 35, 'throttled=' + throttled);
  h.api.weStopDraw();
}

// ── A3. 负对照：去掉节流条件 → 同样 1 秒内绘制 ≈ 60 次（满帧） ──────────────
{
  const unthrottled = SRC.replace(
    'if (weLastDrawAt === 0 || now - weLastDrawAt >= minInterval) {',
    'if (true) {'
  );
  check('A3 负对照源码替换成功（去掉节流条件）', unthrottled !== SRC);
  const h = loadFrame(unthrottled);
  h.api.weStartDraw(h.canvas, h.video);
  const first = h.draws;
  runRvfc(h, 1.0, 60);
  const full = h.draws - first;
  check('A3 去掉节流后 1 秒内绘制 ≈ 60 次（即节流真的在起作用）', full >= 55, 'full=' + full);
  h.api.weStopDraw();
}

// ── A4. rAF 回退路径同样节流；暂停时不重挂 ─────────────────────────────────
{
  const h = loadFrame(SRC, { useRvfc: false });
  h.api.weStartDraw(h.canvas, h.video);
  const first = h.draws;
  runRaf(h, 1.0, 60);
  const throttled = h.draws - first;
  check('A4 rAF 回退同样被节流（≈30 次）', throttled >= 28 && throttled <= 33, 'throttled=' + throttled);
  h.video.paused = true;
  runRaf(h, 0.1, 60);
  check('A4 暂停后不再重挂下一帧（队列清空）', h.rafQueue.length === 0, 'queued=' + h.rafQueue.length);
  h.api.weStopDraw();
}

// ── A5. 换壁纸后首绘不被节流吃掉 ───────────────────────────────────────────
{
  const h = loadFrame(SRC);
  h.api.weStartDraw(h.canvas, h.video);
  runRvfc(h, 0.5, 60);
  const before = h.draws;
  h.api.weStopDraw();
  h.api.weStartDraw(h.canvas, h.video); // 新壁纸：weLastDrawAt 必须被重置
  check('A5 weStopDraw 后重新 weStartDraw 首绘立即发生', h.draws === before + 1, `draws=${before} → ${h.draws}`);
  h.api.weStopDraw();
}

// ── A6. ResizeObserver 立即重画（不节流） ──────────────────────────────────
{
  const h = loadFrame(SRC);
  h.api.weStartDraw(h.canvas, h.video);
  const before = h.draws;
  for (const cb of h.resizeCbs) cb();
  check('A6 画布尺寸变化立即重画一次', h.draws === before + 1, `draws=${before} → ${h.draws}`);
  h.api.weStopDraw();
}

// ── A7. 软渲染档（#411）：探测为真时压到 15fps ─────────────────────────────
{
  const h = loadFrame(SRC, { softRender: true });
  h.api.weStartDraw(h.canvas, h.video);
  const first = h.draws;
  runRvfc(h, 1.0, 60);
  const soft = h.draws - first;
  check('A7 软渲染下 60Hz 回调 1 秒内绘制 ≈ 15 次', soft >= 12 && soft <= 18, 'soft=' + soft);
  h.api.weStopDraw();
}

// ── A8. 负对照：软渲染判定恒 false → 回到 30 档 ────────────────────────────
{
  const forced = SRC.replace(
    'return typeof liveSoftRenderProbeNow === "function" && liveSoftRenderProbeNow() === true;',
    'return false;'
  );
  check('A8 负对照源码替换成功（软渲染判定恒 false）', forced !== SRC);
  const h = loadFrame(forced, { softRender: true });
  h.api.weStartDraw(h.canvas, h.video);
  const first = h.draws;
  runRvfc(h, 1.0, 60);
  const back = h.draws - first;
  check('A8 判定恒 false 时回到 ≈ 30 次（15 档不是写死的）', back >= 28 && back <= 33, 'back=' + back);
  h.api.weStopDraw();
}

// ── A9. 降档留痕：软渲染下只打一条诊断，带渲染器名 ─────────────────────────
{
  const h = loadFrame(SRC, { softRender: true });
  h.api.weStartDraw(h.canvas, h.video);
  runRvfc(h, 1.0, 60);
  check('A9 软渲染降档只留一条诊断（每帧都打会刷满环形缓冲）', h.logs.length === 1, 'logs=' + h.logs.length);
  const line = h.logs[0] || {};
  check('A9 诊断带目标档位与渲染器名',
    line.tag === 'video-softrender-throttle' && /15fps/.test(String(line.detail))
    && /SwiftShader/.test(String(line.detail)), JSON.stringify(line));
  h.api.weStopDraw();
}

// ── A10. 负对照：硬件路径不产生这条诊断 ────────────────────────────────────
{
  const h = loadFrame(SRC);
  h.api.weStartDraw(h.canvas, h.video);
  runRvfc(h, 1.0, 60);
  check('A10 负对照：硬件路径不产生降档诊断', h.logs.length === 0, 'logs=' + h.logs.length);
  h.api.weStopDraw();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed > 0) process.exit(1);
