/**
 * ext-perf.js — 「扩展」页签的性能监控模块（重做版）。
 *
 * 为什么从属性面板搬到「扩展」页签：性能读数只对**场景 / 网页**壁纸有用是旧实现的
 * 错判 —— 视频壁纸有解码帧、静态图也确实在参与合成，用户想看的恰恰是"我这一张到底
 * 占了多少"。所以它是一项**通用能力**，与点击拖尾 / 3D 视差同级，收进「扩展」页签。
 *
 * 采样口径（四条，缺一条读数就会骗人）：
 *   · 场景 / 网页（实时渲染开着）：读渲染页自己的帧率（`__wpStats.frame()` 的 fps），
 *     不是宿主页面 rAF —— 后者在壁纸暂停 / 软渲染暂停时仍然满帧。
 *   · 视频：读 `getVideoPlaybackQuality().totalVideoFrames` 的逐秒增量；暂停 / 播完即 0。
 *   · 静态图：没有渲染帧，壁纸帧率固定为 0 并明说"静态壁纸没有渲染帧"。
 *   · 界面帧率：本组件自己的 rAF 计数（约 0.9 秒折算一次）—— 它量的是整页合成，
 *     与壁纸帧率是两件事；不复用 probe.js 的诊断探针（那会把 live-fps 的样本偷走）。
 *
 * 生命周期：面板里的岛和桌面悬浮窗**共用一份采样器**（模块级，引用计数）——
 * 两个消费者同时开着时也只有一个定时器、一次 CPU 轮询。最后一个消费者离开后
 * 立刻停表：不留后台常驻定时器、不落盘。悬浮窗关掉配置面板后仍然活着，这是它
 * 存在的意义；因此"离开页签就停"只对岛成立，浮窗是**用户显式打开**的常驻入口。
 *
 * 契约：需要的外界 `ctx`（`sel` + `onPerfEnabled` + `onPerfFloatToggle`）与同作用域
 * 的内联助手（React / ReactDOM / useStore / useWeLocale / weComponentVisible / weT /
 * switchRow / apiJson / liveStats / liveStateOf / liveFrameEl / liveRenderEnabled /
 * playbackIsVideoLike / LAYER_ID）。对外提供 `PERF_EXTENSION_MODULE` 与
 * `perfKindOf(selLike)`；`renderPerfIsland` / `PerfFloat` 只被注册表与 client.js 调用，不导出。
 */

/** 采样间隔（毫秒）：1 秒一次，与界面上"每秒采样一次"的说法一致。 */
const PERF_SAMPLE_MS = 1000;
/** 界面帧率的折算窗口（毫秒）：短于 0.9 秒的窗口在 60/120Hz 下抖动太大。 */
const PERF_UI_WINDOW_MS = 900;
/** 没有读数时的占位符（不是 0 —— 0 是一个有效读数）。 */
const PERF_EMPTY = "—";
/** 悬浮窗挂到 <body> 的宿主 id（client.js 与清理逻辑共用）。 */
const PERF_FLOAT_HOST_ID = "dsh-wallpaper-engine-perf-float";
/** 悬浮窗位置（localStorage，窗口内坐标）。 */
const PERF_FLOAT_POS_KEY = "dsh-wallpaper-engine:perf-float-pos";

/** 当前壁纸的采样通道：live / video / static。 */
function perfKindOf(selLike) {
  if (!selLike) return "static";
  const live = (selLike.type === "scene" || selLike.type === "web") && liveRenderEnabled(selLike);
  if (live) return "live";
  if (playbackIsVideoLike(selLike)) return "video";
  return "static";
}

/** 场景 / 网页：渲染页自己的帧率优先；没有 `__wpStats` 的网页退到 `__wp.getState().webFps`。 */
function perfLiveSample(frame) {
  const stats = frame ? liveStats(frame) : null;
  if (stats && stats.running === false) return { fps: 0, note: weT("已暂停") };
  const raw = stats ? Number(stats.fps) : NaN;
  if (Number.isFinite(raw) && raw > 0) return { fps: Math.round(raw), note: weT("实时渲染") };
  const state = frame ? liveStateOf(frame) : null;
  const web = state ? Number(state.webFps) : NaN;
  if (Number.isFinite(web) && web > 0) return { fps: Math.round(web), note: weT("网页自身帧率") };
  return { fps: 0, note: weT("等待画面") };
}

/** 视频：拿当前正在播的那个 `<video>`（层里可能有多个候选，取已就绪的第一个）。 */
function perfVideoEl() {
  try {
    const layer = document.getElementById(LAYER_ID);
    const nodes = layer ? layer.querySelectorAll("video") : [];
    for (const v of nodes) if (v && v.readyState >= 1) return v;
  } catch { /* ignore */ }
  return null;
}

/** 累计解码帧数：标准字段优先，老 Chromium 回退到 webkit 前缀。 */
function perfVideoFrames(v) {
  try {
    if (typeof v.getVideoPlaybackQuality === "function") {
      const q = v.getVideoPlaybackQuality();
      return Number(q && q.totalVideoFrames) || 0;
    }
  } catch { /* ignore */ }
  const legacy = Number(v.webkitDecodedFrameCount);
  return Number.isFinite(legacy) && legacy > 0 ? legacy : 0;
}

/** 一个读数格：标签 + 值（值未知时画占位符，不画 0）。 */
function perfMetric(label, value) {
  return React.createElement("div", { className: "we-perf__item", key: label },
    React.createElement("span", { className: "we-perf__label" }, label),
    React.createElement("span", { className: "we-perf__value" }, value),
  );
}

// ── 共享采样器：岛与悬浮窗共用，引用计数到 0 就停表 ─────────────────────────
const perfSampleSubs = new Set();
let perfSampleLatest = null;
let perfTimer = 0;
let perfRaf = 0;
let perfSel = null;
let perfKey = "";
let perfCpuBusy = false;
let perfCpu = 0;
let perfUiFrames = 0;
let perfUiFrom = 0;
let perfUiFps = 0;
let perfVideoElRef = null;
let perfVideoFramesVal = 0;
let perfVideoAt = 0;

/** 采样键：换壁纸 / 换通道都算换代，旧样本立即作废（不能拿上一张的 FPS 冒充这一张）。 */
function perfSampleKey(selLike) {
  if (!selLike) return "";
  const id = selLike.id || selLike.path || selLike.src || selLike.name || "";
  return String(id) + "|" + perfKindOf(selLike);
}

/** 把一份样本推给所有消费者（复制订阅表：回调里退订不会打断本轮）。 */
function perfPublish(sample) {
  perfSampleLatest = sample;
  for (const fn of [...perfSampleSubs]) {
    try { fn(sample); } catch { /* 单个消费者出错不影响另一个 */ }
  }
}

/** 界面帧率：整页合成，与壁纸帧率分开算；只刷新样本里的 uiFps 字段。 */
function perfUiTick() {
  if (!perfTimer) return;
  perfUiFrames += 1;
  const now = perfNow();
  if (now - perfUiFrom >= PERF_UI_WINDOW_MS) {
    perfUiFps = Math.round((perfUiFrames * 1000) / (now - perfUiFrom));
    perfUiFrames = 0;
    perfUiFrom = now;
    if (perfSampleLatest) perfPublish({ ...perfSampleLatest, uiFps: perfUiFps });
  }
  perfRaf = requestAnimationFrame(perfUiTick);
}

/** 本进程 CPU：宿主 /diag-log?perf=1 已经做差，这里只取最后一次读数（单飞，防重入）。 */
function perfFetchCpu() {
  if (perfCpuBusy) return;
  perfCpuBusy = true;
  apiJson("/diag-log?perf=perf-monitor")
    .then((res) => {
      const p = res && res.data && res.data.perf;
      const next = p ? Number(p.cpu) : NaN;
      if (Number.isFinite(next) && next >= 0) {
        perfCpu = next;
        // CPU 是整进程读数，与哪张壁纸无关：样本在就顺手刷新，不必等到下一拍。
        if (perfSampleLatest) perfPublish({ ...perfSampleLatest, cpu: perfCpu });
      }
    })
    .catch(() => { /* 下一拍再试 */ })
    .then(() => { perfCpuBusy = false; });
}

/** 一秒一拍：通道样本 + 界面帧率 + CPU。 */
function perfSampleTick() {
  if (!perfTimer) return;
  const kind = perfKindOf(perfSel);
  let wallFps = 0;
  let note;
  if (kind === "live") {
    const r = perfLiveSample(liveFrameEl());
    wallFps = r.fps;
    note = r.note;
  } else if (kind === "video") {
    const v = perfVideoEl();
    const now = perfNow();
    if (!v) note = weT("等待视频");
    else if (v.paused || v.ended) {
      // 暂停时把基线也清掉：恢复播放的第一拍要重新起算，不能把暂停时长算进帧率。
      note = weT("已暂停");
      perfVideoElRef = null;
      perfVideoAt = 0;
    } else {
      const frames = perfVideoFrames(v);
      if (v !== perfVideoElRef || !perfVideoAt) {
        perfVideoElRef = v;
        perfVideoFramesVal = frames;
        perfVideoAt = now;
        note = weT("等待视频");
      } else {
        const dt = (now - perfVideoAt) / 1000;
        const df = frames - perfVideoFramesVal;
        perfVideoElRef = v;
        perfVideoFramesVal = frames;
        perfVideoAt = now;
        if (dt > 0 && df >= 0) wallFps = Math.round(df / dt);
        note = weT("视频");
      }
    }
  } else {
    note = weT("静态壁纸没有渲染帧");
  }
  const frameMs = wallFps > 0 ? 1000 / wallFps : 0;
  perfPublish({
    kind: kind, wallFps: wallFps, frameMs: frameMs,
    uiFps: perfUiFps, cpu: perfCpu, note: note,
  });
  perfFetchCpu();
}

/** 停表：最后一个消费者走了，或组件被卸载。 */
function perfStop() {
  if (perfTimer) clearInterval(perfTimer);
  if (perfRaf) { try { cancelAnimationFrame(perfRaf); } catch { /* ignore */ } }
  perfTimer = 0;
  perfRaf = 0;
  perfSampleLatest = null;
  perfSel = null;
  perfKey = "";
  perfCpuBusy = false;
  perfCpu = 0;
  perfUiFrames = 0;
  perfUiFps = 0;
  perfVideoElRef = null;
  perfVideoAt = 0;
  perfVideoFramesVal = 0;
}

/** 订阅：返回退订函数。第一个消费者启动单例，最后一个离开时停表。 */
function perfSubscribe(selLike, push) {
  perfSampleSubs.add(push);
  perfSel = selLike;
  const key = perfSampleKey(selLike);
  if (key !== perfKey) {
    perfKey = key;
    perfVideoElRef = null;
    perfVideoAt = 0;
    perfVideoFramesVal = 0;
    perfPublish(null);
  }
  if (!perfTimer) {
    perfUiFrames = 0;
    perfUiFps = 0;
    perfUiFrom = perfNow();
    perfTimer = setInterval(perfSampleTick, PERF_SAMPLE_MS);
    if (typeof requestAnimationFrame === "function") perfRaf = requestAnimationFrame(perfUiTick);
    perfSampleTick();
  } else {
    push(perfSampleLatest);
  }
  return function unsubscribe() {
    perfSampleSubs.delete(push);
    if (perfSampleSubs.size === 0) perfStop();
  };
}

/**
 * 岛与浮窗共用的读数 hook。开关关着时也**无条件**调用它（hooks 规则），
 * 只是 effect 里立刻清空、不启动采样器。
 */
function usePerfSample(enabled, selLike, kind) {
  const [sample, setSample] = React.useState(null);
  React.useEffect(() => {
    if (!enabled || !selLike) { setSample(null); return undefined; }
    return perfSubscribe(selLike, setSample);
  }, [enabled, kind, selLike && selLike.id]);
  return sample;
}

/**
 * 性能监控岛：总开关 + 四项读数 + 同款胶囊开关（显示悬浮窗）。
 *
 * hooks 必须无条件调用（开关关着的那一帧也一样）—— 这是 React 的规则，也是
 * test/verify-scene-live.mjs 单文件形状判据要看的东西。采样副作用全部在 hook 里。
 */
function renderPerfIsland(ctx) {
  const { sel, onPerfEnabled, onPerfFloatToggle } = ctx;
  const enabled = Boolean(sel && sel.perfEnabled === true);
  const floatOn = Boolean(sel && sel.perfFloat === true);
  const kind = perfKindOf(sel);
  const sample = usePerfSample(enabled, sel, kind);

  return React.createElement(React.Fragment, null,
    switchRow(weT("启用性能监控"), enabled, onPerfEnabled, {
      key: "perf-enabled",
      hint: weT("显示当前壁纸的渲染帧率、界面帧率与本进程 CPU；每秒采样一次，离开这个页签就停止"),
    }),
    enabled && React.createElement("div", { className: "we-perf" },
      React.createElement("div", { className: "we-perf__grid" },
        perfMetric(weT("壁纸帧率"), sample && sample.wallFps > 0 ? sample.wallFps + " FPS" : PERF_EMPTY),
        perfMetric(weT("平均帧时间"), sample && sample.frameMs > 0 ? sample.frameMs.toFixed(1) + " ms" : PERF_EMPTY),
        perfMetric(weT("界面帧率"), sample && sample.uiFps > 0 ? String(sample.uiFps) : PERF_EMPTY),
        perfMetric(weT("本进程 CPU"), sample && sample.cpu > 0 ? sample.cpu.toFixed(1) + "%" : PERF_EMPTY),
      ),
      sample && sample.note ? React.createElement("span", { className: "we-perf__note" }, sample.note) : null,
      switchRow(weT("显示悬浮窗"), floatOn, onPerfFloatToggle, { key: "perf-float" }),
    ),
  );
}

/** 悬浮窗位置钳位：窗口缩放 / 换屏后不能把卡片留在屏幕外。 */
function perfFloatClamp(pos, vw, vh, w, h) {
  const margin = 12;
  const width = Math.max(160, Number(w) || 244);
  const height = Math.max(90, Number(h) || 168);
  const viewW = Number(vw) || 1280;
  const viewH = Number(vh) || 800;
  const maxX = Math.max(margin, viewW - width - margin);
  const maxY = Math.max(margin, viewH - height - margin);
  const px = pos && Number.isFinite(Number(pos.x)) ? Number(pos.x) : viewW - width - 24;
  const py = pos && Number.isFinite(Number(pos.y)) ? Number(pos.y) : 92;
  return {
    x: Math.min(Math.max(margin, px), maxX),
    y: Math.min(Math.max(margin, py), maxY),
  };
}

/** 读回上次位置；坏 JSON / 缺字段就当没存过。 */
function perfFloatLoadPos() {
  try {
    const raw = window.localStorage.getItem(PERF_FLOAT_POS_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (o && Number.isFinite(Number(o.x)) && Number.isFinite(Number(o.y))) {
      return { x: Number(o.x), y: Number(o.y) };
    }
  } catch { /* ignore */ }
  return null;
}

function perfFloatSavePos(pos) {
  try { window.localStorage.setItem(PERF_FLOAT_POS_KEY, JSON.stringify({ x: Math.round(pos.x), y: Math.round(pos.y) })); } catch { /* ignore */ }
}

function perfFloatInitialPos() {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  return perfFloatClamp(perfFloatLoadPos(), vw, vh, 244, 168);
}

/**
 * 桌面悬浮窗：独立 React root 挂在 <body> 下（与 RopeDock 同款），浮在对话上，
 * 只显示读数，不接管输入，也不需要左吸附翻转。标题栏可拖，位置存 localStorage。
 */
function PerfFloat() {
  useWeLocale();
  const sel = useStore();
  const enabled = Boolean(sel && sel.perfEnabled === true);
  const open = enabled && Boolean(sel && sel.perfFloat === true)
    && weComponentVisible(sel.inventory && sel.inventory.components, "mascot-avatar");
  const kind = perfKindOf(sel);
  const sample = usePerfSample(open, sel, kind);
  const [pos, setPos] = React.useState(perfFloatInitialPos);
  const elRef = React.useRef(null);
  const dragRef = React.useRef(null);

  // 窗口缩放 / 侧栏开合后重新钳位；浮窗关着时不用管。
  React.useEffect(() => {
    if (!open) return undefined;
    const onResize = () => {
      setPos((prev) => {
        const el = elRef.current;
        const next = perfFloatClamp(prev, window.innerWidth, window.innerHeight,
          el ? el.offsetWidth : 244, el ? el.offsetHeight : 168);
        if (next.x !== prev.x || next.y !== prev.y) {
          perfFloatSavePos(next);
          return next;
        }
        return prev;
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  const onPointerDown = (e) => {
    if (e.button !== 0 || (e.target && e.target.closest && e.target.closest("button"))) return;
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, last: null };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    e.preventDefault();
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const el = elRef.current;
    const next = perfFloatClamp(
      { x: e.clientX - d.dx, y: e.clientY - d.dy },
      window.innerWidth, window.innerHeight,
      el ? el.offsetWidth : 244, el ? el.offsetHeight : 168,
    );
    d.last = next;
    // 拖动期直接写样式，不走 React state（每秒还有一次读数刷新，重渲染会拖影）。
    if (el) { el.style.left = next.x + "px"; el.style.top = next.y + "px"; }
  };
  const onPointerUp = (e) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d && d.last) {
      setPos(d.last);
      perfFloatSavePos(d.last);
    }
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  if (!open) return null;

  const shown = sample || {};
  return React.createElement("div", {
    ref: elRef,
    className: "we-perf-float",
    style: { left: pos.x, top: pos.y },
    role: "dialog",
    "aria-label": weT("性能监控"),
  },
    React.createElement("div", {
      className: "we-perf-float__head",
      onPointerDown: onPointerDown,
      onPointerMove: onPointerMove,
      onPointerUp: onPointerUp,
      onPointerCancel: onPointerUp,
    },
      React.createElement("span", { className: "we-perf-float__title" }, weT("性能监控")),
      React.createElement("button", {
        type: "button",
        className: "we-perf-float__close",
        "aria-label": weT("关闭悬浮窗"),
        title: weT("关闭悬浮窗"),
        onClick: () => { if (typeof onPerfFloatToggle === "function") onPerfFloatToggle(); },
      }, "×"),
    ),
    React.createElement("div", { className: "we-perf__grid" },
      perfMetric(weT("壁纸帧率"), shown.wallFps > 0 ? shown.wallFps + " FPS" : PERF_EMPTY),
      perfMetric(weT("平均帧时间"), shown.frameMs > 0 ? shown.frameMs.toFixed(1) + " ms" : PERF_EMPTY),
      perfMetric(weT("界面帧率"), shown.uiFps > 0 ? String(shown.uiFps) : PERF_EMPTY),
      perfMetric(weT("本进程 CPU"), shown.cpu > 0 ? shown.cpu.toFixed(1) + "%" : PERF_EMPTY),
    ),
    React.createElement("span", { className: "we-perf__note" },
      shown.note || weT("等待采样")),
  );
}

/** 单调时钟：优先 performance.now，测试宿主没有时退到 Date.now。 */
function perfNow() {
  if (typeof performance !== "undefined" && performance && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

/** 「扩展」页签的第四号模块（注册表项；title / desc 写成 getter，理由同别的模块）。 */
const PERF_EXTENSION_MODULE = {
  id: "perf",
  order: 4,
  resetGroup: "perf",
  get title() { return weT("性能监控"); },
  get desc() { return weT("查看当前壁纸的渲染帧率、界面帧率与本进程 CPU；静态图没有渲染帧（默认关）"); },
  // ⚠️ 必须挂成**组件**，不能直接写 renderPerfIsland：panel-tabs.js 的 renderExtensionsTab
  // 是普通函数，`mod.render(ctx)` 在它体内同步调用，没有独立的 hook 槽位。若直接调用，
  // 岛里的 useState/useEffect 会算到外层配置界面组件头上；切走「扩展」页签时外层少调
  // 这两个 hook，React 抛 "Rendered fewer hooks than expected"，整个配置界面崩溃。
  render: (ctx) => React.createElement(renderPerfIsland, ctx),
};

export { PERF_EXTENSION_MODULE, perfKindOf };
