/**
 * verify-perf-metrics.mjs — #263「更小的第一步」：逐壁纸性能指标守卫。
 *
 * 背景：issue #263 要逐壁纸的 FPS / 平均帧时间 / 掉帧率 / 本进程 CPU。repo owner 决定只落
 * 「更小的第一步」：当前壁纸的实时 FPS / 平均帧时间 / 本进程 CPU，**不落盘**、**不做
 * low/medium/high 徽标**、显示在属性面板。显式不做：系统级 GPU/VRAM、自动降载
 *（改 fpsCap / sceneLiveFps 是另一个 PR 的行为变更）。
 *
 * 这一档同时钉住三件事：
 *   1. **纯函数口径**（lib/perf-metrics.js）：有界环形缓冲、FPS = 1000/平均帧时间、
 *      掉帧 = 单帧 > 均值×1.5、本进程 CPU 走 process.cpuUsage() 增量。
 *   2. **接线**：帧间隔由浏览器侧探针采集 → 既有 /client-diag 通道上报 → 主机侧
 *      lib/perf-metrics.js 聚合 → /diag-log?perf=<token> 回给客户端 → 属性面板。
 *   3. **面板渲染**：性能区**只在 perf 非空时出现** —— 既有 golden（ctx 无 perf）
 *      必须逐字不变。
 *   4. **真实路由集成**：把帧间隔真的喂进 /client-diag，再从 /diag-log?perf= 读回来
 *      —— 事件名 / detail 解析 / 查询参数任一处写错都会在这里红。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EventEmitter } from 'node:events';

import { recordBatch, snapshot, resetPerfMetrics } from '../lib/perf-metrics.js';
import { registerDiagRoutes } from '../lib/routes/diag.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? '✓ ' : '✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!ok) failed += 1;
};

// ── 1. 纯函数口径：环形缓冲 / FPS / 平均帧时间 / 掉帧 ────────────────────────
resetPerfMetrics();
recordBatch([16.7, 16.7, 16.7, 16.7], 'w1');
const steady = snapshot('w1');
check('稳态 16.7ms ⇒ FPS≈60', steady.fps === 60, 'fps=' + steady.fps);
check('稳态 16.7ms ⇒ 平均帧时间≈16.7',
  Math.abs(steady.averageFrameTimeMs - 16.7) < 0.01, 'avg=' + steady.averageFrameTimeMs);
check('稳态无掉帧', steady.jankCount === 0, 'jank=' + steady.jankCount);
check('快照带样本数与 token',
  steady.samples === 4 && steady.token === 'w1',
  'samples=' + steady.samples + ' token=' + steady.token);

resetPerfMetrics();
recordBatch([16.7, 16.7, 50, 16.7], 'w1');
const janky = snapshot('w1');
check('尖峰帧计入掉帧', janky.jankCount === 1, 'jank=' + janky.jankCount);
check('掉帧率 = 掉帧数 / 样本数',
  Math.abs(janky.jankRatio - 0.25) < 1e-9, 'ratio=' + janky.jankRatio);

resetPerfMetrics();
recordBatch(new Array(500).fill(16.7), 'w1');
const bounded = snapshot('w1');
check('样本环形缓冲有上界（≤120）', bounded.samples <= 120, 'samples=' + bounded.samples);

resetPerfMetrics();
recordBatch([16.7, 16.7], 'w1');
recordBatch([16.7, 16.7], 'w2');
const switched = snapshot('w2');
check('换 token ⇒ 旧样本清零', switched.samples === 2, 'samples=' + switched.samples);
check('空样本 ⇒ fps 有限且非负',
  Number.isFinite(switched.fps) && switched.fps >= 0, 'fps=' + switched.fps);

resetPerfMetrics();
recordBatch(['x', NaN, 0, -5, 16.7], 'w1');
const filtered = snapshot('w1');
check('非法间隔被丢弃', filtered.samples === 1, 'samples=' + filtered.samples);

// ── 2. 本进程 CPU：process.cpuUsage() 增量 ─────────────────────────────────
resetPerfMetrics();
const cpuIdle = snapshot('cpu').cpu;
const until = Date.now() + 80;
while (Date.now() < until) { /* 忙循环：制造可测的 CPU 增量 */ }
const cpuBusy = snapshot('cpu').cpu;
check('空闲采样为 0 或非负', Number.isFinite(cpuIdle) && cpuIdle >= 0, 'idle=' + cpuIdle);
check('忙循环后 CPU% > 0', Number.isFinite(cpuBusy) && cpuBusy > 0, 'busy=' + cpuBusy);

// ── 3. 静态接线：帧间隔从客户端采集，经既有通道上报 ──────────────────────
const probeText = read('src/live-layer/probe.js');
const watchText = read('src/live-layer/watch.js');
const mediaFrameText = read('src/client/media-frame.js');
const clientText = read('src/client.js');
const panelText = read('src/picker-props-panel.js');
const diagText = read('lib/routes/diag.js');
const i18nPanelText = read('src/i18n/i18n-copy-panel.js');

check('探针维护帧间隔缓冲并逐 tick 上报',
  /uiFrameIntervals/.test(probeText) && /reportPerfFrameTick/.test(probeText));
check('watch 每 tick 调用一次上报', /reportPerfFrameTick\s*\(\s*\)/.test(watchText));
check('上报走既有 client-diag 通道',
  /function reportPerfFrame\s*\(/.test(mediaFrameText)
  && mediaFrameText.includes('perf-frame')
  && mediaFrameText.includes('/client-diag'));
check('客户端轮询 /diag-log?perf=', /diag-log\?perf=/.test(clientText));
check('面板只在 perf 非空时渲染性能区',
  /we-picker__props-perf/.test(panelText) && /perf\s*&&/.test(panelText));
check('主机路由特判 perf-frame',
  /perf-frame/.test(diagText) && /recordBatch/.test(diagText) && /snapshot/.test(diagText));
check('/diag-log 支持 perf 参数', /searchParams\.get\(\s*['"]perf['"]\s*\)/.test(diagText));
check('i18n 面板词条覆盖三个新标签',
  ['性能', '平均帧时间', '本进程 CPU'].every((k) => i18nPanelText.includes('"' + k + '":')));

// ── 4. 面板渲染：perf 非空才出现性能区（既有 golden 不带 perf ⇒ 必须为空） ──
const textOf = (node) => {
  if (!node) return '';
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  const cls = node.props && typeof node.props.className === 'string' ? node.props.className + ' ' : '';
  const kids = node.props && node.props.children != null ? node.props.children : node.children;
  return cls + textOf(kids);
};

const React = {
  Fragment: 'Fragment',
  createElement: (type, props, ...children) => (
    typeof type === 'function' ? type(props || {}) : { type, props: props || null, children }
  ),
};
const panelSource = read('src/picker-props-panel.js');
const panelBody = panelSource.slice(
  panelSource.indexOf('function renderPickerPropsPanel(ctx)'),
  panelSource.indexOf('export {'),
);
const makeRender = new Function(
  'React', 'weT', 'weEvalCondition', 'weColorToHex', 'weHexToColor', 'sameUserPropValue',
  panelBody + '\nreturn renderPickerPropsPanel;',
);
const renderPickerPropsPanel = makeRender(
  React, (k) => k, () => true, (v) => v, (v) => v, (a, b) => a === b,
);
const baseCtx = {
  open: true, token: 'w1', loading: false, error: '', props: [], sceneLiveActive: true,
  source: {}, we: null, ensureDefs: () => {}, onPropInput: () => {}, onReset: () => {}, onImportWe: () => {},
};
const noPerf = textOf(renderPickerPropsPanel(baseCtx));
check('无 perf 时性能区不渲染（既有 golden 不变）',
  !noPerf.includes('we-picker__props-perf'), 'text=' + noPerf.slice(0, 80));
const withPerf = textOf(renderPickerPropsPanel({
  ...baseCtx,
  perf: { fps: 60, averageFrameTimeMs: 16.7, cpu: 12.5, jankCount: 1, jankRatio: 0.02, samples: 120, token: 'w1' },
}));
check('perf 非空时性能区出现', withPerf.includes('we-picker__props-perf'), 'text=' + withPerf.slice(0, 80));
check('性能区渲染三个指标',
  withPerf.includes('60') && withPerf.includes('16.7') && withPerf.includes('12.5'),
  'text=' + withPerf.slice(0, 120));
const missing = ['fps', 'averageFrameTimeMs', 'cpu'].filter((k) => !panelSource.includes(k));
check('面板消费 perf 的三个字段', missing.length === 0, 'missing=' + missing.join(','));

// ── 5. 集成：/client-diag 上行 → perf-metrics 聚合 → /diag-log?perf= 回读 ──────
// 上面 3 是静态接线（正则），这一节打**真实路由处理器**：把帧间隔真的喂进
// /client-diag，再从 /diag-log?perf= 读回来 —— 事件名、detail 解析、查询参数
// 任一处写错都会在这里红，而不是在静态正则里空真。
{
  const routes = [];
  const diagLines = [];
  const notices = [];
  const log = { tag: () => () => {} };
  registerDiagRoutes(
    { register: (entry) => { routes.push(entry); return () => {}; } },
    {
      disposers: [],
      appendDiagLine: (kind, obj) => diagLines.push(kind + ':' + JSON.stringify(obj)),
      base: '/wallpaper-engine',
      log,
      notice: (kind) => notices.push(kind),
    },
  );
  const mkRes = () => {
    const res = new EventEmitter();
    res.setHeader = () => {};
    res.statusCode = 200;
    res.body = '';
    res.end = (text) => { res.body = text == null ? '' : String(text); };
    return res;
  };
  const clientDiag = routes.find((r) => r.path === '/wallpaper-engine/client-diag');
  const diagLogRoute = routes.find((r) => r.path === '/wallpaper-engine/diag-log');
  const postClientDiag = (body) => {
    const req = new EventEmitter();
    req.method = 'POST';
    req.url = '/wallpaper-engine/client-diag';
    req.headers = {};
    const res = mkRes();
    clientDiag.handler(req, res);
    req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
    return res;
  };
  const readPerfLog = (token) => {
    const res = mkRes();
    diagLogRoute.handler({ method: 'GET', url: '/wallpaper-engine/diag-log?perf=' + encodeURIComponent(token), headers: {} }, res);
    return JSON.parse(res.body);
  };

  resetPerfMetrics();
  const posted = postClientDiag({ event: 'perf-frame', type: 'web', id: 'w1', detail: '16.7,16.7,16.7,16.7' });
  check('perf-frame 上行 ⇒ 204', posted.statusCode === 204, 'status=' + posted.statusCode);
  check('perf-frame 不落诊断档案（否则每秒一行冲垮 JSONL）',
    diagLines.length === 0, 'lines=' + diagLines.length);
  const read = readPerfLog('w1');
  check('/diag-log?perf= 回读快照且 FPS≈60',
    Boolean(read.perf) && read.perf.fps === 60, 'perf=' + JSON.stringify(read.perf));
  check('快照 token 与上行一致', Boolean(read.perf) && read.perf.token === 'w1',
    'token=' + (read.perf && read.perf.token));
  check('不带 perf 参数 ⇒ perf 为 null（既有调用方不受影响）',
    readPerfLog('').perf === null);
  const normal = postClientDiag({ event: 'live-ready', type: 'scene', id: 'w1', detail: 'firstFrame ok' });
  check('普通诊断事件仍落盘 + 走提示通道（分流没吃掉正常诊断）',
    normal.statusCode === 204 && diagLines.length === 1 && notices.includes('scene-ready'),
    'lines=' + diagLines.length + ' notices=' + JSON.stringify(notices));
}

if (failed) {
  console.log('\nverify-perf-metrics: CHECKS FAILED — ' + failed + ' failed');
  process.exit(1);
}
console.log('\nverify-perf-metrics: ALL CHECKS PASSED');
