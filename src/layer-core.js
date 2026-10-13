/*
 * layer-core.js — **两条通道共用的切换核心**（视频通道 / 实时通道都从它取）。
 *
 * 这里只放**与壁纸类型无关**的东西：层退役与延迟移除、过场的内联样式工具、
 * 可见性复推与"画面真的回到屏上了吗"的留痕。
 *
 * 判据：本文件**不得引用任何实时专属符号**（`test/verify-scene-live.mjs` 的围栏
 * 对 `CHANNEL_FILES` 里的每一项生效，本文件在其中）。搬进来的每一块都要先过它 ——
 * 这也是"视频通道不过实时模块"这条目标能守住的原因。
 */

function nudgeWallpaperRepaint() {
  try {
    if (typeof document === "undefined" || !document) return;
    const node = document.getElementById(LAYER_ID);
    if (!node || !node.classList) return;
    node.classList.add("we-layer--repaint");
    const drop = () => { try { node.classList.remove("we-layer--repaint"); } catch { /* ignore */ } };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => requestAnimationFrame(drop));
    else if (typeof window !== "undefined" && window.setTimeout) window.setTimeout(drop, 32);
  } catch { /* ignore */ }
}

function onScreenBrief(node) {
  const n = node || (typeof document !== "undefined" && document ? document.getElementById(LAYER_ID) : null);
  if (!n) return "layer=-";
  let rect = "-";
  try {
    const r = n.getBoundingClientRect();
    rect = Math.round(r.width) + "x" + Math.round(r.height) + "@" + Math.round(r.left) + "," + Math.round(r.top);
  } catch { /* ignore */ }
  let leaf = "leaf=-";
  try {
    const el = n.querySelector("video.we-media") || n.querySelector("img.we-media")
      || n.querySelector("canvas.we-media--canvas") || n.querySelector("iframe.we-live-iframe");
    if (el) {
      const kind = String(el.tagName || "").toUpperCase();
      const dim = (w, h) => (Number(w) > 0 && Number(h) > 0 ? Math.round(w) + "x" + Math.round(h) : "-");
      const px = kind === "VIDEO" ? dim(el.videoWidth, el.videoHeight)
        : kind === "IMG" ? dim(el.naturalWidth, el.naturalHeight)
          : dim(el.clientWidth, el.clientHeight);
      leaf = "leaf=" + kind + " " + px + " rs=" + (el.readyState === undefined ? "-" : el.readyState)
        + " paused=" + (el.paused === undefined ? "-" : (el.paused ? 1 : 0));
    }
  } catch { /* ignore */ }
  return "rect=" + rect + " " + leaf + " mediaFrames=" + mediaFramesOf(n);
}

function retireFadingLayer() {
  const node = fadingLayerNode;
  if (!node) return;
  fadingLayerNode = null;
  releaseLayerMedia(node);
  try { node.remove(); } catch { /* ignore */ }
  // 旧层已退场 → 放行这次渐变的新层音频（不匹配则说明闸属于另一次渐变）。
  releaseRotationAudioGateFor(node);
}

function scheduleFadingLayerRemoval(node, ms) {
  const hold = (typeof ms === "number" && ms > 0 ? ms : ROTATION_FADE_MS) + 100;
  if (typeof window === "undefined" || typeof window.setTimeout !== "function") {
    retireFadingLayer();
    return;
  }
  window.setTimeout(() => {
    if (fadingLayerNode !== node) return; // 已被快速连切即时退役
    fadingLayerNode = null;
    releaseLayerMedia(node);
    try { node.remove(); } catch { /* ignore */ }
    // 渐变结束、旧层退场 → 新层 BGM 此刻才起播。
    releaseRotationAudioGateFor(node);
    // Edge canvas：只有绘制上下文仍属于旧层时才停（新层已 weStartDraw 接管）。
    if (weDrawCtx && weDrawCtx.canvas && typeof node.contains === "function"
      && node.contains(weDrawCtx.canvas)) weStopDraw();
  }, hold);
}

function applyInlineStyle(node, style) {
  if (!node || !node.style) return;
  for (const k in style) {
    try { node.style[k] = style[k]; } catch { /* ignore */ }
  }
}
function startLayerTransition(node, outgoing, tr) {
  // 音频闸先开：新层静音，等旧层这次过场结束后才出声（见 openRotationAudioGate）。
  openRotationAudioGate(node, outgoing);
  // 两者默认都是 z-index:-2，谁在上面靠 DOM 顺序（live 的 staging 容器是**提前**
  // 挂到 body 的，顺序不保证）—— 过场期间显式把旧层压到新层之下。两者都仍在
  // scrim(-1) 之下，所以不会盖到界面上。
  try { outgoing.style.zIndex = "-3"; } catch { /* ignore */ }
  const frames = switchFrames(tr.id, tr.dir);
  applyInlineStyle(node, frames.inFrom);
  try { node.style.setProperty("--we-switch-ms", tr.ms + "ms"); } catch { /* ignore */ }
  node.className = "we-layer we-layer--switch";   // 顺带脱掉 we-layer--staging
  // 只有需要旧层同时动起来的过场（推移 / 缩放）才给它挂 switch 类；其余过场旧层
  // 保持不透明静止垫着（玻璃 backdrop-filter 依赖这层不透明背景）。
  if (tr.id !== "fade") outgoing.className = "we-layer we-layer--switch we-layer--switch-out";
  void node.offsetWidth;                          // 强制 reflow：让初态成为 transition 起点
  applyInlineStyle(node, frames.inTo);
  applyInlineStyle(outgoing, frames.outTo);
  scheduleFadingLayerRemoval(outgoing, tr.ms);
  if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
    window.setTimeout(() => resetLayerSwitchStyles(node), tr.ms + 60);
  }
}
function mediaFramesOf(node) {
  try {
    const v = node && node.querySelector ? node.querySelector("video.we-media") : null;
    if (!v || typeof v.getVideoPlaybackQuality !== "function") return -1;
    const q = v.getVideoPlaybackQuality();
    return q && typeof q.totalVideoFrames === "number" ? q.totalVideoFrames : -1;
  } catch { return -1; }
}
function layerKeyDiff(oldKey, nextKey) {
  const a = String(oldKey || "").split("\u0000"), b = String(nextKey || "").split("\u0000");
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) out.push((LAYER_KEY_FIELDS[i] || "seg" + i) + ":" + keySegBrief(a[i]) + "→" + keySegBrief(b[i]));
  }
  return out.join(" | ") || weT("(同 key)");
}
function switchTransitionOf(selLike) {
  const id = selLike && SWITCH_TRANSITION_VALUES.includes(selLike.switchTransition)
    ? selLike.switchTransition : DEFAULTS.switchTransition;
  const def = SWITCH_TRANSITIONS.find((t) => t.id === id) || SWITCH_TRANSITIONS[0];
  const speed = SWITCH_SPEEDS.find((s) => s.id === (selLike && selLike.switchTransitionSpeed))
    || SWITCH_SPEEDS[1];
  const dir = selLike && SWITCH_DIRS.includes(selLike.switchTransitionDir)
    ? selLike.switchTransitionDir : DEFAULTS.switchTransitionDir;
  return {
    id,
    dir,
    directional: SWITCH_DIRECTIONAL.includes(id),
    ms: def.ms > 0 ? Math.max(60, Math.round(def.ms * speed.factor)) : 0,
  };
}
function releaseLayerMedia(node) {
  if (!node) return;
  const v = node.querySelector("video");
  if (v) {
    try { v.pause(); v.removeAttribute("src"); v.load(); } catch { /* ignore */ }
  }
  // live / web 层的 <iframe> 才是大头：Chromium 实测：「从 DOM 摘除的 iframe 其 JS
  // 世界仍在跑」（contentWindow 已 null 而 setInterval 照跳）—— 只 remove() 等于把它
  // 交给 GC，回收时序不可控，每个渐变周期都可能多留一个活着的渲染页。
  // 显式导航到 about:blank 终止它（与 disposeMediaEl 的 iframe 分支同一手法）。
  if (typeof node.querySelectorAll !== "function") return; // 精简 mock：无选择器即跳过
  for (const f of node.querySelectorAll("iframe")) {
    try { f.src = "about:blank"; } catch { /* ignore */ }
  }
}
function openRotationAudioGate(node, outgoing) {
  if (!node) return;
  rotationAudioGate = { node, outgoing: outgoing || null, released: false };
  muteNodeAudio(node);
  const live = liveFrameOf(node);
  if (live) {
    // 缓存里可能还是真实音量（同帧复用）→ 先清缓存再强制下发 0。
    liveApplied.volume = null;
    setLiveVolumeNow(live, 0);
  }
  if (sceneAudioEl) {
    try { sceneAudioEl.volume = 0; sceneAudioEl.muted = true; sceneAudioEl.pause(); } catch { /* ignore */ }
  }
}

export {
  nudgeWallpaperRepaint,
  onScreenBrief,
  retireFadingLayer,
  startLayerTransition,
  layerKeyDiff,
  switchTransitionOf,
  releaseLayerMedia,
  openRotationAudioGate,
};
