/** 客户端的轮换 / 媒体生命周期助手（从 `src/client.js` 按族搬出，函数体逐字未改）。
 *
 * 契约：
 *   1) 本文件不 import —— 构建期由 scripts/build-client.mjs 内联在正文之前，与正文同处一个扁平作用域；
 *      函数体引用的 selection / buildMedia / layerEl 等自由名由正文与其它内联模块提供。
 *   2) 搬移只改了"声明住哪"：本文件里每段文本与拆前 src/client.js 逐字节相同。
 *   3) 顶层状态（LIVE_FIRST_FADE_MS、rotationPendingHidden、pageHiddenSince）只有字面量或
 *      `document.hidden` 这类宿主只读量，不读模块级可变状态；三个 `let` 的赋值点都在本文件内。
 *   4) 监听器的注册仍在 *fiber 作用域*（apply 的接线处）：本文件只提供注册函数，不在顶层挂监听。
 */
function barsPolygon(dir, p) {
  const horizontal = dir === "left" || dir === "right"; // 横板（沿 x 扫）
  const fromEnd = dir === "left" || dir === "up";       // 从右端 / 下端长出
  const outer = fromEnd ? 1 : 0;
  const inward = fromEnd ? -1 : 1;                      // 往画面里伸的方向
  const n = SWITCH_BARS_TEETH;
  const period = 1 / n;
  const depth = p;
  const spine = Math.min(0.004, depth);                 // 脊宽（p=0 时也为 0，无残留）
  const slat = p / n;                                   // 板厚（p=1 → period，缝隙闭合）
  // 把「距进入侧的距离 a、沿 t 轴的位置 t」映射成坐标。
  const pt = (a, t) => (horizontal ? [outer + inward * a, t] : [t, outer + inward * a]);
  const pts = [pt(0, 0)];
  for (let i = 0; i < n; i++) {
    const y0 = i * period;
    pts.push(pt(depth, y0));
    pts.push(pt(depth, y0 + slat));
    if (i < n - 1) {
      pts.push(pt(spine, y0 + slat));                   // 退到脊上
      pts.push(pt(spine, y0 + period));                 // 沿脊走到下一块板起点
    }
  }
  pts.push(pt(spine, 1));
  pts.push(pt(0, 1));
  return "polygon(" + pts.map(([x, y]) =>
    (x * 100).toFixed(2) + "% " + (y * 100).toFixed(2) + "%").join(", ") + ")";
}

/** 每种过场的「入场层初态 / 入场层终态 / 退场层终态」，直接写成内联样式。 */
function switchFrames(id, dir) {
  const inFrom = { left: "translate3d(100%, 0, 0)", right: "translate3d(-100%, 0, 0)", up: "translate3d(0, 100%, 0)", down: "translate3d(0, -100%, 0)" }[dir];
  const outTo = { left: "translate3d(-100%, 0, 0)", right: "translate3d(100%, 0, 0)", up: "translate3d(0, -100%, 0)", down: "translate3d(0, 100%, 0)" }[dir];
  if (id === "push") {
    return { inFrom: { transform: inFrom }, inTo: { transform: "translate3d(0, 0, 0)" }, outTo: { transform: outTo } };
  }
  if (id === "wipe") {
    return { inFrom: { clipPath: wipeInset(dir) }, inTo: { clipPath: "inset(0)" }, outTo: {} };
  }
  if (id === "iris") {
    // circle(75%) 覆盖全视口（100% 参考长度 = 对角线/√2，角点距离 ≈ 70.7%）。
    return { inFrom: { clipPath: "circle(0% at 50% 50%)" }, inTo: { clipPath: "circle(75% at 50% 50%)" }, outTo: {} };
  }
  if (id === "zoom") {
    return {
      inFrom: { transform: "scale(1.06)", opacity: "0" },
      inTo: { transform: "scale(1)", opacity: "1" },
      // 旧层只轻微前推、**不改 opacity**（保持不透明，玻璃模糊依赖它）。
      outTo: { transform: "scale(1.04)" },
    };
  }
  if (id === "bars") {
    return { inFrom: { clipPath: barsPolygon(dir, 0) }, inTo: { clipPath: barsPolygon(dir, 1) }, outTo: {} };
  }
  return { inFrom: { opacity: "0" }, inTo: { opacity: "1" }, outTo: {} }; // fade
}

// GPU 静帧 → live 首帧的淡入时长（手动切换壁纸时用户面对的正是这条腿：
// 点选壁纸先出 GPU 静帧，渲染页出首帧后缓慢过渡到实时动态画面）。与轮换
// 交叉渐变同取 1.8s —— 0.8s 的短窗口实测过渡太急，用户明确要 1.8s 的缓慢
// 过渡（即便渐变窗口内场景从 T0 播到 T1、目标是运动的）。与 ROTATION_FADE_MS
// 保持独立常量，后续要单独调这条腿不必动轮换。
// CSS .we-live-iframe 的 transition 必须与之同步。
// ⚠️ 「写而不读」静态扫描请勿再报它：本常量在 JS 里**零按名读**，但它不是死代码 ——
// ① `scripts/build-client.mjs` 的内联 markers 钉住它的声明字面量（构建期校验）；
// ② `test/verify-client.mjs:3252` 断言产物文本里同时出现 ROTATION_FADE_MS 与本常量（1800）；
// ③ `src/styles-base.js:138/149` 的 CSS 注释要求 `.we-live-iframe` 的 transition 与之同步。
// ⇒ 这条腿的时长实际由 CSS transition 承担，改值必须同时改这三处。
const LIVE_FIRST_FADE_MS = 1800;

function cancelRotationPrepare() {
  const prep = rotationPrep;
  if (!prep) return;
  rotationPrep = null;
  prep.cancelled = true;
  for (const t of prep.timers) {
    try { clearTimeout(t); } catch { /* ignore */ }
  }
  prep.timers = [];
  if (prep.staged) {
    try { prep.staged.div.remove(); } catch { /* ignore */ }
    prep.staged = null;
  }
  releaseProbeMedia(prep);
  if (prep.readyEl) { disposeMediaEl(prep.readyEl); prep.readyEl = null; }
}

// 媒体元素完整释放（video 是解码器根：pause + 清 src 才真释放，
// releaseLayerMedia 同款处理；iframe 是文档根：导航到空白页才销毁里面的
// 渲染页 —— 仅从 DOM 摘除的 iframe 在 GC 前会继续跑 rAF/WebGL）。
function disposeMediaEl(m) {
  if (!m) return;
  try { m.onload = null; m.onerror = null; } catch { /* ignore */ }
  try {
    if (typeof m.removeEventListener === "function") {
      m.removeEventListener("canplay", m.__weCanplay);
      m.removeEventListener("error", m.__weError);
      m.removeEventListener("load", m.__weLoad);
    }
  } catch { /* ignore */ }
  if (m.tagName === "VIDEO") {
    try { m.pause(); m.removeAttribute("src"); m.load(); } catch { /* ignore */ }
  }
  if (m.tagName === "IFRAME") {
    try { m.src = "about:blank"; } catch { /* ignore */ }
  }
}

// 未就绪/被取消的探测元素：完整释放。
function releaseProbeMedia(prep) {
  const m = prep && prep.probeMedia;
  if (!m) return;
  prep.probeMedia = null;
  disposeMediaEl(m);
}

// 就绪的探测元素：只摘事件监听，元素连同其已加载/已播放状态完整保留 ——
// commit 时由 buildMedia 直接领养进新层（就绪态随元素走，杜绝"探测就绪了
// 但层里另建空白元素重新加载"的黑屏闪烁）。
// `opts.ready` = 调用点**确实观测到了**这个元素的就绪事件（img onload / video canplay /
// 渲染页首帧）。只有这一档能打 `__weReady`：切层内容闸门（见 src/live-layer.js）把这条
// 标记读成"这个元素有画面"，于是"探测该收尾了"（超时兜底提交）与"像素已经到手"必须分开 ——
// 两者在就绪事件领养时重合、在超时领养时分叉，混用等于让闸门相信一个还没有像素的元素。
function adoptProbe(prep, opts) {
  const m = prep && prep.probeMedia;
  if (!m) return;
  prep.probeMedia = null;
  try { m.onload = null; m.onerror = null; } catch { /* ignore */ }
  try {
    if (typeof m.removeEventListener === "function") {
      m.removeEventListener("canplay", m.__weCanplay);
      m.removeEventListener("error", m.__weError);
      m.removeEventListener("load", m.__weLoad);
    }
  } catch { /* ignore */ }
  // 「这个元素已经是就绪画面」这件事必须随元素走：切层内容闸门（见 src/live-layer.js）
  // 判的就是"新层有没有画面"，而领养来的元素早已过了它的就绪事件 —— 不标出来就得
  // 再等一次永远不会重放的事件，图层会白白守着一层旧壁纸。
  if (opts && opts.ready) { try { m.__weReady = true; } catch { /* ignore */ } }
  prep.readyEl = m;
}

function disposePreparedMedia() {
  const el = preparedMediaEl;
  preparedMediaEl = null;
  disposeMediaEl(el);
}

// buildMedia 领养通道：类型与 URL 都对得上才交付，否则立即释放防泄漏。
// URL 校验的必要性：准备期与提交期的来源可能不同 —— 静态帧准备用无档位的
// frameUrl（`/scene-frame/<tok>`），而提交后的 selection.url 带画面档位
//（`…?v=3`）；原样收编会让层里显示另一个档位的画面，而 weKey 记的是当前档位
// → 读数与实际画面不一致，且不会自愈（只有用户再点一次「刷新」才重建）。
// 视频壁纸/内嵌 MP4 两侧同源（都取 inventory 的同一字段），v=0 的静态帧也不带
// query，所以严格相等不会牺牲既有的「就绪态随元素走」预载收益。
function consumePreparedMedia(tag, wantUrl) {
  const el = preparedMediaEl;
  preparedMediaEl = null;
  if (!el) return null;
  if (el.tagName !== tag) { disposeMediaEl(el); return null; }
  const want = String(wantUrl || "");
  if (want) {
    const src = String((el.attributes && el.attributes.src) || el.src || "");
    if (src !== want) { disposeMediaEl(el); return null; } // 内容不符 → 释放后按目标 URL 重建
  }
  return el;
}

// 隐藏期间的轮换处理：不建 staging 渲染页，只置一个待命标记，可见时立刻补做。
// 为什么不在隐藏时照常准备：隐藏页 rAF 被 Chromium 完全停摆（出帧物理不可能），
// staging 页（pkg 堆 + 数十 MB 显存纹理）挂在那里纯属白占 —— 人不在看的时候不
// 轮换，回来再切（延迟 0.5–2s）既省资源又更符合直觉。
let rotationPendingHidden = false;
// 页面开始隐藏的墙钟时刻（0 = 可见）。隐藏页的定时器会被 Chromium 节流到 ≥1s、
// 5 分钟后 1/min —— 用「第一次探测到隐藏」起算会低估隐藏时长（探测本身可能迟到
// 几分钟），所以以 visibilitychange 为准记录起点。
let pageHiddenSince = (typeof document !== "undefined" && document.hidden) ? Date.now() : 0;
function deferRotationWhileHidden(tag) {
  rotationPendingHidden = true;
  liveLog(tag, "标签页隐藏 → 本轮轮换推迟到可见时补做（不建 staging 渲染页）");
}
function resumePendingRotation() {
  pageHiddenSince = (typeof document !== "undefined" && document.hidden) ? (pageHiddenSince || Date.now()) : 0;
  if (!rotationPendingHidden) return;
  if (typeof document !== "undefined" && document.hidden) return;
  rotationPendingHidden = false;
  liveLog("rotation-resume-pending", "已恢复可见 → 立即补做被推迟的轮换 " + liveStateBrief());
  if (selection.rotationEnabled && selection.id) beginRotationPrepare(new Set());
}
// 监听器必须在 **fiber 作用域**里注册（接线见 `apply` 的 2e. 段）：宿主每次 revision 变化都会
// tearDownEntryFiber 后用新模块体重跑本文件，模块顶层的 addEventListener 永不摘除 ⇒ 每换一次
// 版本就在同一 document 里再叠一对，一次 visibilitychange/focus 被 N 份实例重复跑。
function installRotationResumeListeners() {
  const doc = typeof document === "undefined" ? null : document;
  const win = typeof window === "undefined" ? null : window;
  const bound = [];
  if (doc && typeof doc.addEventListener === "function") {
    doc.addEventListener("visibilitychange", resumePendingRotation);
    bound.push(["visibilitychange", doc]);
  }
  if (win && typeof win.addEventListener === "function") {
    win.addEventListener("focus", resumePendingRotation); // 兜底：事件缺失也不会把待命丢掉
    bound.push(["focus", win]);
  }
  return function () {
    for (const [type, target] of bound.splice(0)) {
      try { target.removeEventListener(type, resumePendingRotation); } catch { /* ignore */ }
    }
  };
}
