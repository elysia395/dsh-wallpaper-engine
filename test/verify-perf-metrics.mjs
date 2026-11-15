/**
 * verify-perf-metrics.mjs — #263 重做版：「扩展」页签的性能监控模块 + 桌面悬浮窗。
 *
 * 背景（m02233 的产品决定）：性能读数**不是**场景壁纸专属 —— 视频有解码帧，静态图也在
 * 参与合成。所以它从属性面板搬到「扩展」页签，与点击拖尾 / 3D 视差同级，覆盖
 * 场景 / 网页 / 视频 / 静态图。正式合并 #370 暂缓，先在本机把重做版钉住。
 *
 * 这一档钉五件事：
 *   1. 宿主半只留 CPU（lib/perf-metrics.js 的 snapshot() 增量口径），帧率全部在渲染侧量。
 *   2. /client-diag 不再有 perf-frame 特判；/diag-log?perf= 回 CPU 快照，不带参数仍为 null。
 *   3. 模块接线：INLINE_MODULES / 注册调用 / 采样通道分流（live / video / static）。
 *   4. 岛与悬浮窗共用**一份**模块级采样器（Set + 单 timer/rAF + CPU 单飞），
 *      浮窗关掉配置面板后仍能继续跑，但关掉监控 / 关掉组件行就退场。
 *   5. 旧属性面板接线必须彻底消失（否则两份读数会互相打脸）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EventEmitter } from 'node:events';

import { snapshot, resetPerfMetrics } from '../lib/perf-metrics.js';
import { registerDiagRoutes } from '../lib/routes/diag.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? '✓ ' : '✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!ok) failed += 1;
};

// ── 1. 宿主半：本进程 CPU 增量口径 ─────────────────────────────────────────
resetPerfMetrics();
const cold = snapshot();
check('首次采样没有基线 ⇒ cpu=0', cold.cpu === 0, 'cpu=' + cold.cpu);
check('快照只带 cpu 一个字段（帧样本不再回宿主聚合）',
  Object.keys(cold).join(',') === 'cpu', 'keys=' + Object.keys(cold).join(','));
const until = Date.now() + 90;
while (Date.now() < until) { /* 忙循环：制造可测的 CPU 增量 */ }
const warm = snapshot();
check('忙循环后 CPU% > 0 且有限',
  Number.isFinite(warm.cpu) && warm.cpu > 0, 'cpu=' + warm.cpu);
resetPerfMetrics();
check('重置后回到无基线状态', snapshot().cpu === 0);

// ── 2. 路由：/diag-log?perf= 回 CPU 快照，普通诊断不受影响 ─────────────────
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
      componentsProbe: () => null,
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
  const readLog = (query) => {
    const res = mkRes();
    diagLogRoute.handler({ method: 'GET', url: '/wallpaper-engine/diag-log' + query, headers: {} }, res);
    return JSON.parse(res.body);
  };

  resetPerfMetrics();
  check('不带 perf 参数 ⇒ perf 为 null（既有调用方不受影响）', readLog('').perf === null);
  const withPerf = readLog('?perf=perf-monitor');
  check('带 perf 参数 ⇒ 回 {cpu}（第一拍 0 也算有效读数）',
    Boolean(withPerf.perf) && typeof withPerf.perf.cpu === 'number',
    'perf=' + JSON.stringify(withPerf.perf));
  check('perf 快照不带 token / fps（旧口径已删）',
    withPerf.perf && !('token' in withPerf.perf) && !('fps' in withPerf.perf),
    'perf=' + JSON.stringify(withPerf.perf));

  const normal = postClientDiag({ event: 'live-ready', type: 'scene', id: 'w1', detail: 'firstFrame ok' });
  check('普通诊断事件仍落盘 + 走提示通道',
    normal.statusCode === 204 && diagLines.length === 1 && notices.includes('scene-ready'),
    'lines=' + diagLines.length + ' notices=' + JSON.stringify(notices));

  const perfFrame = postClientDiag({ event: 'perf-frame', type: 'web', id: 'w1', detail: '16.7' });
  check('perf-frame 不再被特判（现在只是普通一行诊断）',
    perfFrame.statusCode === 204 && diagLines.length === 2,
    'lines=' + diagLines.length);
}

// ── 3. 静态接线：模块登记、悬浮窗挂载与旧接线清除 ─────────────────────────
const build = read('scripts/build-client.mjs');
const extPerf = read('src/ext-perf.js');
const clientText = read('src/client.js');
const probeText = read('src/live-layer/probe.js');
const watchText = read('src/live-layer/watch.js');
const mediaFrameText = read('src/client/media-frame.js');
const panelText = read('src/picker-props-panel.js');
const panelCss = read('src/styles/panel.js');
const diagText = read('lib/routes/diag.js');

check('ext-perf.js 已登记进 INLINE_MODULES（带唯一性 markers）',
  /file:\s*['"]src\/ext-perf\.js['"]/.test(build)
  && build.includes("'const PERF_EXTENSION_MODULE = {'")
  && build.includes("'function renderPerfIsland(ctx)'"));
check('client.js 注册 perf 模块',
  clientText.includes('weRegisterExtensionModule("perf", PERF_EXTENSION_MODULE)'));
check('perf 岛以组件方式挂载（hooks 不落到外层页签组件上）',
  /render:\s*\(ctx\)\s*=>\s*React\.createElement\(renderPerfIsland,\s*ctx\)/.test(extPerf)
  && !/render:\s*renderPerfIsland\b/.test(extPerf));
check('悬浮窗有独立的 body 宿主与 React root（与 RopeDock 同款）',
  /const PERF_FLOAT_HOST_ID = "dsh-wallpaper-engine-perf-float"/.test(extPerf)
  && clientText.includes('ReactDOM.createRoot(host)')
  && clientText.includes('React.createElement(PerfFloat, null)')
  && clientText.includes('document.getElementById(PERF_FLOAT_HOST_ID)'));
check('关掉监控总开关时顺手关掉悬浮窗（不留空壳）',
  /if \(!on\) setSetting\("perfFloat", false\);/.test(clientText));
check('悬浮窗开关写 perfFloat 后 emit，交给独立 root 自己订阅',
  /function onPerfFloatToggle\(\) \{[\s\S]{0,160}setSetting\("perfFloat", next\);\s*\n\s*emit\(\);/.test(clientText)
  && clientText.includes('onPerfEnabled, onPerfFloatToggle'));
check('旧属性面板接线全部消失（报告 / 轮询 / 面板 / 样式）',
  !/reportPerfFrame/.test(mediaFrameText)
  && !/reportPerfFrameTick/.test(probeText)
  && !/reportPerfFrameTick/.test(watchText)
  && !/startPerfPoll|stopPerfPoll/.test(clientText)
  && !/we-picker__props-perf/.test(panelText)
  && !/we-picker__props-perf/.test(panelCss));
check('宿主路由不再特判 perf-frame，也不再有 recordBatch',
  !/perf-frame/.test(diagText) && !/recordBatch/.test(diagText) && /snapshot/.test(diagText));
check('/diag-log 用 searchParams.has(perf) 而不是取具体 token',
  /searchParams\.has\(\s*['"]perf['"]\s*\)/.test(diagText));

// ── 4. 采样通道分流（纯函数，vm 里跑真实现） ──────────────────────────────
{
  const from = extPerf.indexOf('/** 当前壁纸的采样通道');
  const to = extPerf.indexOf('/** 视频：拿当前正在播的那个');
  const body = extPerf.slice(from, to);
  const make = new Function(
    'liveRenderEnabled', 'playbackIsVideoLike', 'liveStats', 'liveStateOf', 'weT',
    body + '\nreturn { perfKindOf, perfLiveSample };',
  );
  const mk = (live, video, stats, state) => make(
    () => live, () => video, () => stats, () => state, (k) => k,
  );

  check('场景 + 实时渲染开 ⇒ live', mk(true, false).perfKindOf({ type: 'scene' }) === 'live');
  check('网页 + 实时渲染开 ⇒ live', mk(true, false).perfKindOf({ type: 'web' }) === 'live');
  check('视频壁纸 ⇒ video', mk(false, true).perfKindOf({ type: 'scene' }) === 'video');
  check('静态图 ⇒ static', mk(false, false).perfKindOf({ type: 'image' }) === 'static');

  check('渲染页 running=false ⇒ 0 + 已暂停',
    mk(false, false, { running: false, fps: 120 }).perfLiveSample({}).fps === 0
    && mk(false, false, { running: false, fps: 120 }).perfLiveSample({}).note === '已暂停');
  check('渲染页 fps 优先且取整（118.6 ⇒ 119）',
    mk(false, false, { running: true, fps: 118.6 }).perfLiveSample({}).fps === 119);
  check('没有 stats.fps 时退到网页自身帧率',
    mk(false, false, null, { webFps: 30 }).perfLiveSample({}).fps === 30
    && mk(false, false, null, { webFps: 30 }).perfLiveSample({}).note === '网页自身帧率');
  check('两者都没有 ⇒ 0 + 等待画面',
    mk(false, false, null, null).perfLiveSample({}).fps === 0
    && mk(false, false, null, null).perfLiveSample({}).note === '等待画面');
}

// ── 5. 共享采样器：单例、引用计数、岛与浮窗共用 ────────────────────────────
check('岛与浮窗共用模块级采样器（Set 订阅 + 单 timer/rAF + 最后一人走才停表）',
  /(?:let|const) perfSampleSubs = new Set\(\)/.test(extPerf)
  && /function perfSubscribe\(/.test(extPerf)
  && /if \(!perfTimer\) \{/.test(extPerf)
  && /perfSampleSubs\.size === 0\) perfStop\(\)/.test(extPerf)
  && (extPerf.match(/setInterval\(/g) || []).length === 1);
check('两个消费者都走 usePerfSample（没有各自的秒表）',
  (extPerf.match(/usePerfSample\(/g) || []).length === 3);
check('采样键含壁纸 id 与通道：换一张 / 换通道旧样本立即作废',
  /function perfSampleKey\(selLike\)/.test(extPerf)
  && /String\(id\) \+ "\|" \+ perfKindOf\(selLike\)/.test(extPerf)
  && /perfPublish\(null\)/.test(extPerf));
check('CPU 轮询单飞（岛和浮窗同时开着也只发一份 /diag-log?perf=）',
  /if \(perfCpuBusy\) return;/.test(extPerf)
  && extPerf.includes('apiJson("/diag-log?perf=perf-monitor")'));
check('视频暂停时清基线，恢复播放第一拍重新起算',
  /v\.paused \|\| v\.ended/.test(extPerf)
  && /perfVideoAt = 0;/.test(extPerf));
check('静态图明说没有渲染帧', extPerf.includes('weT("静态壁纸没有渲染帧")'));

// ── 6. 岛 + 浮窗的形状 ────────────────────────────────────────────────────
check('岛里四个读数标签齐全',
  ['weT("壁纸帧率")', 'weT("平均帧时间")', 'weT("界面帧率")', 'weT("本进程 CPU")']
    .every((s) => extPerf.includes(s)));
check('默认关时只画开关，读数与浮窗开关都包在 enabled 分支里',
  /enabled && React\.createElement\("div", \{ className: "we-perf" \}/.test(extPerf)
  && /enabled && React\.createElement\("div", \{ className: "we-perf" \}[\s\S]{0,1600}显示悬浮窗/.test(extPerf));
check('未知读数用占位符 —，不画 0',
  /const PERF_EMPTY = "—";/.test(extPerf)
  && /sample && sample\.wallFps > 0 \?/.test(extPerf)
  && /PERF_EMPTY/.test(extPerf));
check('hooks 无条件调用：关着也 setSample(null) 后返回',
  /if \(!enabled \|\| !selLike\) \{ setSample\(null\); return undefined; \}/.test(extPerf));
check('采样副作用依赖开关 / 通道 / 壁纸 id',
  /\[enabled, kind, selLike && selLike\.id\]/.test(extPerf));
check('cleanup 取消 rAF 并清掉秒表', /cancelAnimationFrame\(perfRaf\)/.test(extPerf)
  && /clearInterval\(perfTimer\)/.test(extPerf));
check('浮窗开关复用同款胶囊行，点击交给 onPerfFloatToggle',
  /switchRow\(weT\("显示悬浮窗"\), floatOn, onPerfFloatToggle, \{ key: "perf-float" \}\)/.test(extPerf)
  && !/weT\(floatOn \?/.test(extPerf));
check('浮窗只在 监控开 + 浮窗开 + 组件行可见 时渲染',
  /const open = enabled && Boolean\(sel && sel\.perfFloat === true\)/.test(extPerf)
  && /weComponentVisible\(sel\.inventory && sel\.inventory\.components, "mascot-avatar"\)/.test(extPerf));
check('浮窗标题栏可拖、松手存位置、窗口缩放重新钳位',
  /onPointerDown: onPointerDown/.test(extPerf)
  && /setPointerCapture\(e\.pointerId\)/.test(extPerf)
  && /perfFloatSavePos\(d\.last\)/.test(extPerf)
  && /window\.addEventListener\("resize", onResize\)/.test(extPerf)
  && extPerf.includes('PERF_FLOAT_POS_KEY'));
check('浮窗关闭按钮走同一个开关（不是只藏 DOM）',
  /onClick: \(\) => \{ if \(typeof onPerfFloatToggle === "function"\) onPerfFloatToggle\(\); \}/.test(extPerf));

// ── 7. 浮窗位置钳位（纯函数行为） ─────────────────────────────────────────
{
  const from = extPerf.indexOf('/** 悬浮窗位置钳位');
  const to = extPerf.indexOf('/** 读回上次位置');
  const make = new Function(extPerf.slice(from, to) + '\nreturn perfFloatClamp;');
  const clamp = make();
  const d = clamp(null, 1000, 700, 244, 168);
  check('没存过位置 ⇒ 右上角默认位（留 24 / 92 边距）',
    d.x === 732 && d.y === 92, JSON.stringify(d));
  const neg = clamp({ x: -50, y: -80 }, 1000, 700, 244, 168);
  check('拖出左上角 ⇒ 钳到 12px 边距', neg.x === 12 && neg.y === 12, JSON.stringify(neg));
  const big = clamp({ x: 5000, y: 5000 }, 1000, 700, 244, 168);
  check('拖出右下角 ⇒ 钳到窗口内', big.x === 744 && big.y === 520, JSON.stringify(big));
  const tiny = clamp({ x: 900, y: 600 }, 200, 150, 244, 168);
  check('窗口比卡片还小 ⇒ 仍留在可见区', tiny.x === 12 && tiny.y === 12, JSON.stringify(tiny));
  const bad = clamp({ x: 'a', y: NaN }, 1000, 700, 244, 168);
  check('坏位置回落到默认位', bad.x === 732 && bad.y === 92, JSON.stringify(bad));
}

// ── 8. 设置 / i18n / 预设回填 ──────────────────────────────────────────────
const schema = read('lib/settings-schema.js');
check('perfEnabled / perfFloat 默认关 + boolFalse + 归 RESET_MODULES.perf',
  /perfEnabled:\s*false/.test(schema)
  && /perfFloat:\s*false/.test(schema)
  && /perfEnabled:\s*\{\s*kind:\s*'boolFalse'\s*\}/.test(schema)
  && /perfFloat:\s*\{\s*kind:\s*'boolFalse'\s*\}/.test(schema)
  && /RESET_MODULES[\s\S]{0,800}\n {2}perf:/.test(schema)
  && /extensions: Object\.keys\(KINDS\)\.filter[\s\S]{0,300}indexOf\('perf'\)/.test(schema));
check('perfFloat 进核心设置命名空间（会落盘 / 会随预设走）',
  /'presetGuideDismissed', 'perfEnabled', 'perfFloat'/.test(schema));

const i18nExt = read('src/i18n/i18n-copy-ext.js');
const needI18n = ['性能监控', '启用性能监控', '壁纸帧率', '界面帧率', '网页自身帧率',
  '等待画面', '已暂停', '静态壁纸没有渲染帧', '等待视频', '等待采样',
  '显示悬浮窗', '关闭悬浮窗'];
const missingI18n = needI18n.filter((k) => !i18nExt.includes('"' + k + '":'));
check('英文词条覆盖性能监控模块与悬浮窗的新文案', missingI18n.length === 0,
  'missing=' + missingI18n.join(','));

const extCss = read('src/styles/ext.js');
check('浮窗在玻璃门内用中性霜面 + 浮层模糊（不常驻 backdrop-filter）',
  /body\[data-we-glass-floaters\] \.we-perf-float \{[\s\S]{0,900}backdrop-filter: blur\(calc\(var\(--we-floaters-blur\) \* 1\.6\)\) saturate\(1\.25\)/.test(extCss)
  && /var\(--we-panel-color/.test(extCss.slice(extCss.indexOf('body[data-we-glass-floaters] .we-perf-float'))));

const presetFiles = ['factory-author', 'factory-default', 'factory-frosted', 'factory-night',
  'factory-readable', 'factory-vivid', 'purple-mood'];
const missingPreset = presetFiles.filter((n) => {
  try {
    const values = JSON.parse(read('lib/glass-presets/' + n + '.json')).values;
    return values.perfEnabled !== false || values.perfFloat !== false;
  } catch { return true; }
});
check('七套内置预设都回填 perfEnabled / perfFloat:false', missingPreset.length === 0,
  'missing=' + missingPreset.join(','));

if (failed) {
  console.log('\nverify-perf-metrics: CHECKS FAILED — ' + failed + ' failed');
  process.exit(1);
}
console.log('\nverify-perf-metrics: ALL CHECKS PASSED');
