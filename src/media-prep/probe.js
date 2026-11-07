/**
 * media-prep/probe.js — 媒体预备族的**探测段**（S5 从 src/media-prep.js 纯搬移）。
 *
 * 内容：prepareVideoProbe（detached <video> 预载 + 预播，上屏即活画面）、
 * prepareWebProbe（detached <iframe> + `we-layer--staging` 容器 —— iframe 不许直接挂 body，
 * 同文档 reparent 会重载文档，commit 时容器整体转层）。
 * 依赖：adoptProbe / releaseProbeMedia / prepTimeout / document；守卫按本文件冻结函数体
 * 断言 staging 容器与 `div.appendChild(f)`。
 */

// detached <video> 预载 + 预播：canplay = 可播放就绪，元素本身（含已解码画面）
// 在 commit 时移入新层 —— 上屏即是活画面，无重新加载黑窗。error = 硬失败
// （跳过/回退），超时 = 兜底提交（poster 覆盖空窗）。
function prepareVideoProbe(url, posterUrl, prep, onReady, onFail) {
  if (!url || typeof document === "undefined" || typeof document.createElement !== "function") { onReady(); return; }
  const v = document.createElement("video");
  // headless mock 元素无事件设施 → 同步直通。
  if (!v || typeof v.addEventListener !== "function") { onReady(); return; }
  prep.probeMedia = v;
  const onCanplay = () => { adoptProbe(prep, { ready: true }); onReady(); };
  const onErr = () => { releaseProbeMedia(prep); onFail(); };
  v.__weCanplay = onCanplay;
  v.__weError = onErr;
  v.addEventListener("canplay", onCanplay, { once: true });
  v.addEventListener("error", onErr, { once: true });
  prepTimeout(prep, () => { adoptProbe(prep); onReady(); }); // 慢网络兜底提交
  try {
    v.muted = true;
    v.loop = true;
    v.autoplay = true;
    v.preload = "auto";
    v.setAttribute("playsinline", "");
    if (posterUrl) v.poster = posterUrl;
    v.className = "we-media we-media--fit";
    v.src = url;
    v.load();
    // detached 也先播起来：移入新层时正在播放的画面无缝续播。
    const p = typeof v.play === "function" ? v.play() : null;
    if (p && typeof p.catch === "function") p.catch(() => { /* 可见后 syncLayers 补 play */ });
  } catch { adoptProbe(prep); onReady(); }
}

// detached <iframe> 预载：load 事件（跨域也在元素上触发）后即随元素移入新层。
// 与 live 同款 staging 容器承载 —— iframe 在同文档内 reparent 会重载文档，
// commit 时容器整体转为新层（节点级领养），iframe 全程不移动。
function prepareWebProbe(w, prep, onReady) {
  if (!w.media || typeof document === "undefined" || typeof document.createElement !== "function") { onReady(); return; }
  const f = document.createElement("iframe");
  if (!f || typeof f.addEventListener !== "function") { onReady(); return; }
  prep.probeMedia = f;
  const onLoad = () => { adoptProbe(prep, { ready: true }); onReady(); };
  f.__weLoad = onLoad;
  f.addEventListener("load", onLoad, { once: true });
  prepTimeout(prep, () => { adoptProbe(prep); onReady(); }); // 慢页兜底提交（元素继续加载）
  try {
    f.setAttribute("frameborder", "0");
    f.setAttribute("scrolling", "no");
    // 安全隔离：WE web 壁纸是 workshop 第三方 HTML/JS，与宿主同源 —— 不
    // sandbox 的话壁纸脚本可以宿主 origin 身份调宿主 API。allow-scripts 保留
    // 动态壁纸能力，opaque origin 阻断身份冒用。
    f.setAttribute("sandbox", "allow-scripts");
    f.className = "we-media we-iframe";
    const div = document.createElement("div");
    div.className = "we-layer we-layer--staging";
    prep.staged = { div };
    div.appendChild(f);
    document.body.appendChild(div);
    f.src = w.media;
  } catch { adoptProbe(prep); onReady(); }
}

