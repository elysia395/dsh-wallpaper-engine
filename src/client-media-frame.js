/** 客户端正文的画布 / 媒体 / GPU 帧助手（从 `src/client.js` 按族搬出，函数体逐字未改）。
 *
 * 契约：
 *   1) 本文件不 import 任何模块 —— 构建期由 scripts/build-client.mjs 内联在正文之前，
 *      与正文同处一个扁平作用域，所以函数体内引用的 React / selection / liveWatch / apiPostJson
 *      等自由名由正文提供（构建期脚本按 INLINE_MODULES 顺序拼装）。
 *   2) 搬移只改了"声明住哪"：本文件里每个函数与 `src/client.js` 拆前逐字节相同。
 *   3) 本文件自带的模块级状态（媒体计时器、GPU 帧 pin、画布 ctx 句柄…）与各自的赋值点同处本文件；
 *      其初始化式全是字面量或容器构造，不读正文状态（无 TDZ / 无快照语义）。
 *   4) 「壁纸属性」的开关与快照状态（propsPanelOpen / propsState）留在正文：改它们的处理器仍在正文。
 */
let weVfHandle = 0;     // requestVideoFrameCallback handle
let weRafId = 0;        // requestAnimationFrame fallback handle
let weResizeObs = null; // ResizeObserver (canvas size / DPR changes)
let weDrawCtx = null;   // { canvas, video, fit }
function weStopDraw() {
  const v = weDrawCtx && weDrawCtx.video;
  if (weVfHandle && v && v.cancelVideoFrameCallback) {
    try { v.cancelVideoFrameCallback(weVfHandle); } catch { /* ignore */ }
  }
  weVfHandle = 0;
  if (weRafId) { cancelAnimationFrame(weRafId); weRafId = 0; }
  if (weResizeObs) { weResizeObs.disconnect(); weResizeObs = null; }
  weDrawCtx = null;
}
// Detach is NOT enough: a playing <video> is a GC root and keeps decoding in
// the background after removal — every rotation switch used to accumulate one
// more background decoder. Pause + clear src BEFORE dropping the node.
function weDrawFrame() {
  const ctx = weDrawCtx;
  if (!ctx || !ctx.canvas.isConnected) return;
  const video = ctx.video;
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;
  const canvas = ctx.canvas;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // Cap the bitmap at the video's native resolution; CSS does the upscaling.
  const cw = Math.max(1, Math.min(vw, Math.round(canvas.clientWidth * dpr)));
  const ch = Math.max(1, Math.min(vh, Math.round(canvas.clientHeight * dpr)));
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
  const g = canvas.getContext("2d");
  g.clearRect(0, 0, cw, ch);
  // Same semantics as CSS object-fit (cover / contain / center / fill).
  const vr = vw / vh, cr = cw / ch;
  let dx = 0, dy = 0, dw = cw, dh = ch, sx = 0, sy = 0, sw = vw, sh = vh;
  if (ctx.fit === "cover") {
    if (cr > vr) { sw = vh * cr; sx = (vw - sw) / 2; }
    else { sh = vw / cr; sy = (vh - sh) / 2; }
  } else if (ctx.fit === "contain") {
    if (cr > vr) { dh = cw / vr; dy = (ch - dh) / 2; }
    else { dw = ch * vr; dx = (cw - dw) / 2; }
  } else if (ctx.fit === "center") {
    sw = Math.min(vw, cw); sh = Math.min(vh, ch);
    sx = (vw - sw) / 2; sy = (vh - sh) / 2;
    dw = sw; dh = sh; dx = (cw - dw) / 2; dy = (ch - dh) / 2;
  }
  // "fill" stretches the full source over the full canvas (defaults above).
  g.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh);
  // 这一笔落下之前画布底是写死的 #000（见 buildMedia 的 Edge 镜像分支）：切层内容闸门
  // 据此判"新层有画面了"（见 src/live-layer.js 的 layerContentReady / noteLayerContent）。
  canvas.dataset.weDrawn = "1";
  noteLayerContent(canvas);
}
function weDrawTick() {
  weDrawFrame();
  const ctx = weDrawCtx;
  if (!ctx || !ctx.canvas.isConnected) return;
  const v = ctx.video;
  if (v.requestVideoFrameCallback) { weVfHandle = v.requestVideoFrameCallback(weDrawTick); return; }
  // rAF fallback: a PAUSED wallpaper must not redraw the same frame 60–120
  // times per second. Stop the loop while paused; a one-shot play listener
  // resumes it (identity-guarded so a stale listener can't re-arm after stop).
  if (!v.paused && !v.ended) { weRafId = requestAnimationFrame(weDrawTick); return; }
  v.addEventListener("play", () => { if (weDrawCtx === ctx) weDrawTick(); }, { once: true });
}
function weStartDraw(canvas, video, customFit) {
  weStopDraw();
  weDrawCtx = {
    canvas,
    video,
    fit: customFit
      ? (getComputedStyle(document.body).getPropertyValue("--we-object-fit").trim() || "cover")
      : "cover",
  };
  weDrawFrame(); // first paint (a paused wallpaper never presents new frames)
  // If the video is still loading while paused, neither the paint above nor
  // rVFC covers it — draw once as soon as the first frame is available.
  if (!video.dataset.weLoadedOnce) {
    video.dataset.weLoadedOnce = "1";
    video.addEventListener("loadeddata", () => weDrawFrame(), { once: true });
  }
  if (video.requestVideoFrameCallback) weVfHandle = video.requestVideoFrameCallback(weDrawTick);
  else weRafId = requestAnimationFrame(weDrawTick);
  weResizeObs = new ResizeObserver(() => weDrawFrame());
  weResizeObs.observe(canvas);
}

// 「有抓帧就优先于其它来源的画面」的判据（用户决策）：探测该壁纸出图
// 槽位是否有 _gpu.png —— HEAD 是纯磁盘探测，绝不触发任何生成。带 TTL 与 in-flight
// 去重（同一壁纸反复进出只探一次）；探测失败/无 token 按「无 GPU 帧」处理：
// 显示侧本来就会优先服务 GPU 帧，这里失败放开只影响一次多余探测，不该让判定
// 因一次网络抖动而反转。
const GPU_FRAME_PIN_TTL_MS = 30000;
const gpuFramePins = new Map();        // token -> { pinned, at }
const gpuFramePinInflight = new Map(); // token -> Promise<boolean>
function probeGpuFramePin(token, force) {
  const key = String(token || "");
  if (!key) return Promise.resolve(false);
  const hit = gpuFramePins.get(key);
  if (!force && hit && Date.now() - hit.at < GPU_FRAME_PIN_TTL_MS) return Promise.resolve(hit.pinned);
  const flying = gpuFramePinInflight.get(key);
  if (flying && !force) return flying;
  const req = apiHead("/scene-frame/" + encodeURIComponent(key))
    .then((res) => {
      // HEAD 探测：`res.response` 才是原始 Response —— 判 X-WE-GPU 要读它的头。
      const h = res.response;
      const pinned = Boolean(res.ok && h && h.headers && typeof h.headers.get === "function"
        && h.headers.get("x-we-gpu") === "1");
      gpuFramePins.set(key, { pinned, at: Date.now() });
      return pinned;
    })
    // 保留兜底：上面 `.then` 体里若抛（例如 map 操作），不能让 inflight 记录悬着。
    .catch(() => false)
    .then((pinned) => { if (gpuFramePinInflight.get(key) === req) gpuFramePinInflight.delete(key); return pinned; });
  gpuFramePinInflight.set(key, req);
  return req;
}
function forgetGpuFramePin(token) {
  const key = String(token || "");
  gpuFramePins.delete(key);
  gpuFramePinInflight.delete(key);
}
function markGpuFramePin(token, pinned) {
  const key = String(token || "");
  if (key) gpuFramePins.set(key, { pinned: Boolean(pinned), at: Date.now() });
}

// ── 场景实时渲染（WebWallGL live WebGL）─────────────────────────────────────
// scene.pkg 壁纸的实时播放形态：同源 iframe 加载 WebWallGL 渲染页
//（/scene-live：lib/webwallgl/ 的适配页 + npm 依赖 webwallgl 的引擎），由它 fetch
// /scene-files/<token>/scene.pkg 自行解析渲染（LZ4/TEX/DXT 解码、HLSL→GLSL、
// 粒子/脚本/音频全在渲染页内）。父页面经 contentWindow 直接调用渲染页的
// window.__wp 控制面（pause/resume/setVolume/setFit/pushPointer），并轮询
// __wpStats.frame() 作心跳：首帧超时 / 运行期失联 → 按壁纸记失败并降级回
// sceneVideo → 静态帧链（buildMedia 优先级自动重排）。
// 同源且不加 sandbox：sandbox 会产生 opaque origin，contentWindow.__wp 将
// 无法访问；场景作者脚本隔离在渲染页自己的 SceneScript 沙箱内，与 DSH 宿主
// API 无缘，安全边界只由同源 + 渲染页自有沙箱提供。同源还保住了父页面
// backdrop-filter（液态玻璃）对 iframe 合成结果的采样。
// 实时渲染形态的适用判定：场景（scene.pkg 走 WebWallGL 场景管线）与
// 网页（入口 HTML 走 WebWallGL 的 web 挂载 + 注入 WE shim）共用同一开关
// （sceneLive，默认开）、同一失败记忆与同一套心跳看护。
// ── 实时渲染管线（live 看护 / 抓帧回填 / 壁纸层构建与过场）──────────────────
// 这一族的实现按域拆在 **src/live-layer* 一族**（live 渲染 URL 与控制、诊断日志、看护心跳、
// 判失败、帧可用性、抓帧回填、指针转发、poster/挂载/抓首帧，以及 syncLayers 与层过渡）。
// 构建期内联回本作用域，调用点无需改动。
// **故意留在本文件的**（别的域，别处找）：媒体集成（下方「媒体后端」段）、GPU 帧槽助手
// （refreshStaticFrameNodes 等）、用户属性、diag 上报。
// 契约：出向依赖清单 / 入口 / 不变量 —— 见该文件头（清单只在那里维护，此处不复述数量）。

// ── 媒体后端（宿主侧的系统音频频谱 / Now Playing → 渲染页）─────────────────────
// 频谱：宿主侧采集（media-bridge 中间件按 50ms 推 64 段）→ 渲染页经
// __wp.setAudioBridge(fn) 每帧「拉」（拉模式是上游设计：避免每帧跨层推 128 个浮点）。
// 这里 client 按 50ms 从 host 拉到本地缓存，fn 直接返回同一数组引用（零拷贝）。
// 媒体：1s 一次的 Now Playing 轮询（宿主侧也是 1s），变化时 __wp.setMedia(wire)
// —— 封面经宿主代理 URL（同源）。壁纸没有监听器时两者都无副作用。
// 控制：同一族还有**反向**一路 —— 壁纸里的播放按钮经 __wp.setMediaControl 回到
// 宿主 POST /media-control（见 syncMediaControl）；它随数据面一起装、一起卸。
let mediaTimer = 0;
let mediaSpectrum = null;
let mediaAudioInstalled = false;   // 音频桥当前是否已装进渲染页
let mediaNpKey = "";
let mediaFetchBusy = false;
let mediaNpTick = 0;
// 封面：宿主给的是插件路由 /now-playing/artwork，**沙箱网页壁纸取不到它** ——
// DSH Desktop 的能力头栅栏按 frame.origin 放行，不透明源一律 403（同一条栅栏也挡住黑屏
// 那条路）。所以由主页面（同源、有权限）取回、降采样成 **data URL**
// 再交给渲染页：壁纸拿到的是一张自包含的图，不依赖任何源，也能随便画进 canvas。
// 降采样到 512²：壁纸上的封面通常只有几百像素，顺带把几 MB 的原图压到几十 KB。
const MEDIA_THUMB_MAX = 512;
let mediaArtData = "";      // 当前曲目的封面 data URL（降采样后）
let mediaArtKey = "";       // 这份封面属于哪首（title\u0000artist\u0000album）
let mediaArtTimer = 0;      // 重试计时器（宿主下载封面是异步的，换曲瞬间可能还没有）
let mediaArtTries = 0;
// 已上报过终态诊断的曲目 key（media-art* 诊断每曲最多一条，见 scheduleArtworkFetch）。
// 封面诊断的每曲一次性标记（{fail, slow, ok} 各最多一条）。
let mediaArtDiag = { fail: "", slow: "", ok: "" };
// 封面就绪可能滞后换曲（桥要抽帧/下载封面）：窗口太短会在「桥还没出封面」时放弃整整
// 一首歌。故取 12 次 + 退避（0.7s×次数，封顶 4s）—— 覆盖 ~40s，足够等到
// 桥把封面备好；「换曲即重置」，放弃后到下一曲为止不再空转。
const MEDIA_ART_MAX_TRIES = 12;

/** 取封面并按 MEDIA_THUMB_MAX 降采样成 JPEG data URL（失败返回空串）。 */
let mediaArtLastErr = ""; // 最后一次失败的原因（进 media-art* 诊断；成功时清空）。
async function fetchArtworkDataUrl(url) {
  // 封面 URL 由宿主给（`/now-playing/artwork`），走统一出入口；体是二进制，只要原始
  // Response。⚠️ 必须 `parse: false`：默认路径会在 2xx 上 `response.json()`，**先把 body
  // 流吃掉**，随后的 `response.blob()` 必抛（Body is unusable）—— 封面于是永远为空、
  // 只在重试链里空转（实测症状：推送永远 hasThumb:false）。
  const r = await apiFetch(url, { parse: false });
  if (!r.ok) { mediaArtLastErr = "http=" + r.status + (r.error ? "/" + r.error : ""); return ""; }
  const blob = await r.response.blob().catch((e) => {
    mediaArtLastErr = "blob:" + String((e && e.name) || e); return null;
  });
  if (!blob) return "";
  if (!/^image\//.test(blob.type || "")) {
    mediaArtLastErr = "ctype=" + (blob.type || "?") + " size=" + blob.size; return "";
  }
  const bitmap = await createImageBitmap(blob).catch((e) => {
    mediaArtLastErr = "bitmap:" + String((e && e.name) || e); return null;
  });
  if (!bitmap) return "";
  try {
    const scale = Math.min(1, MEDIA_THUMB_MAX / Math.max(bitmap.width || 1, bitmap.height || 1));
    const w = Math.max(1, Math.round((bitmap.width || 1) * scale));
    const h = Math.max(1, Math.round((bitmap.height || 1) * scale));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) { mediaArtLastErr = "no-2d-ctx"; return ""; }
    ctx.drawImage(bitmap, 0, 0, w, h);
    mediaArtLastErr = "";
    return c.toDataURL("image/jpeg", 0.88);
  } finally {
    try { bitmap.close(); } catch { /* ignore */ }
  }
}

/** 向渲染页推一次媒体快照（封面用已缓存的 data URL；没有就是 undefined）。 */
function pushMediaSnapshot(frame, m) {
  try {
    const wp = frame.contentWindow && frame.contentWindow.__wp;
    if (!wp || typeof wp.setMedia !== "function") return;
    if (!m) { wp.setMedia(null); return; }
    wp.setMedia({
      hasMedia: true,
      title: m.title || "",
      artist: m.artist || "",
      album: m.album || "",
      albumArtist: m.albumArtist || "",
      playing: Boolean(m.playing),
      // 宿主给的是 0/1/2（停/播/暂停），比「playing?1:2」更准（能表达停止）；
      // 老宿主不给 state 时按 playing 回落到 1/2。
      state: Number.isFinite(Number(m.state)) ? Number(m.state) : (m.playing ? 1 : 2),
      position: Number(m.position) || 0,
      duration: Number(m.duration) || 0,
      thumbnail: mediaArtData || undefined,
      // 歌词：宿主已换算成渲染页要的 [[秒, 文本], …]（含 LRC 的 [offset:]），
      // 渲染页自己按 position 算当前行（xd() → jA()），这里只透传，不做二次加工。
      lyrics: Array.isArray(m.lyrics) && m.lyrics.length ? m.lyrics : undefined,
    });
  } catch { /* ignore */ }
}

/**
 * 音频桥的装/卸。**只在宿主确认采集真在跑时才装**：
 * 渲染页一旦发现 audioBridge 存在，就会跳过给场景 BGM 接分析器
 * （renderer 里 `if(t.audioBridge) return`），并优先用宿主返回的数组 ——
 * 所以「装了桥但宿主拿不到音频（未授权/无设备）」的后果是把壁纸的音频反应
 * 从内置模拟源换成一条死线。running=false 时保持不装，让渲染页用自己的源。
 */
function syncAudioBridge(frame, running) {
  try {
    const wp = frame.contentWindow && frame.contentWindow.__wp;
    if (!wp || typeof wp.setAudioBridge !== "function") return;
    if (running && !mediaAudioInstalled) {
      wp.setAudioBridge(() => (mediaSpectrum ? { left: mediaSpectrum, right: mediaSpectrum } : null));
      mediaAudioInstalled = true;
    } else if (!running && mediaAudioInstalled) {
      wp.setAudioBridge(null);
      mediaAudioInstalled = false;
    }
  } catch { /* ignore */ }
}

/**
 * 媒体控制面（控制反转）：场景壁纸里 Now Playing 组件的「播放/暂停/上下曲」按钮，
 * 渲染页把它们推断成动作后打到宿主注入的控制面上（`__wp.setMediaControl`）。
 *
 * **数据面与控制面分开装**：`setMedia(null)`（没在播）之后控制面仍在位 —— 空播时
 * 点「播放」要能唤醒真实播放器，而不是掉到渲染页的模拟源去切模拟曲目。这也是
 * 上游把 `pickControlDriver` 与显示源选择分开的原因（同一份语义，两端各一半）。
 *
 * 五个动作与宿主 `POST /media-control` 的动作名一一对应；失败只记诊断（按钮点了
 * 没反应不该打断渲染页，也不该把 `{ok:false}` 伪装成成功）。
 */
const MEDIA_CONTROL_ACTIONS = ["play", "pause", "playPause", "skipNext", "skipPrevious"];
let mediaControlInstalled = false;    // 控制面当前是否已装进渲染页
let mediaControlWin = null;           // 装进了哪个 window（渲染页重载后要重装）
let mediaControlFails = 0;            // 连续失败数（诊断用；成功即清零）
function hostMediaControl(action) {
  return apiPostJson("/media-control", { action }).then((res) => {
    const d = res && res.data;
    if (d && d.ok === true) { mediaControlFails = 0; return d; }
    mediaControlFails += 1;
    // 只在第一次失败时报一条：用户在壁纸上连点按钮不该刷屏诊断环。
    if (mediaControlFails === 1) {
      reportClientDiag("media-control-fail", action + " err=" + ((d && d.error) || res.error || ("http=" + res.status)));
    }
    return null;
  }).catch(() => null);
}
function syncMediaControl(frame) {
  try {
    const win = frame.contentWindow;
    if (!win || (mediaControlInstalled && mediaControlWin === win)) return;
    const wp = win.__wp;
    if (!wp || typeof wp.setMediaControl !== "function") return;
    const controls = {};
    for (const name of MEDIA_CONTROL_ACTIONS) controls[name] = () => hostMediaControl(name);
    wp.setMediaControl(controls);
    mediaControlWin = win;
    mediaControlInstalled = true;
  } catch { /* ignore */ }
}

/** 封面重试：宿主「换曲 → 下载封面」是异步的，且**应用重启后桥要重新热身**（实测
 *  应用侧 12×404 全灭、片刻后同一路径 200）—— 所以快拍用尽**不放弃**：转 45s 慢拍
 *  直到拿到或换曲（`hasArt` = /now-playing 的 hasArtwork，false 时直接走慢拍）。
 *  每曲最多各报一条：首次失败 / 转慢拍 / 成功。 */
const MEDIA_ART_SLOW_MS = 45000;
// 在途 timer 是否为慢拍（hasArtwork 翻真时据此抢占：作废慢拍、立即快拍）。
let mediaArtTimerSlow = false;
function scheduleArtworkFetch(frame, m, artKey, hasArt) {
  if (!m || !m.thumbnail) return;
  if (mediaArtTimer) {
    // 慢拍在途、而 /now-playing 的 hasArtwork 已翻真（桥备好了）→ 抢占重排；
    // 同曲同状态则不重复排。
    if (!(mediaArtTimerSlow && hasArt !== false)) return;
    try { clearTimeout(mediaArtTimer); } catch { /* ignore */ }
    mediaArtTimer = 0;
    mediaArtTries = 0;
  }
  const diagOnce = (tag, event, detail) => {
    if (mediaArtDiag[tag] === artKey) return;
    mediaArtDiag[tag] = artKey;
    reportClientDiag(event, detail);
  };
  const slow = hasArt === false || mediaArtTries >= MEDIA_ART_MAX_TRIES;
  if (slow) diagOnce("slow", "media-art-slow", "tries=" + mediaArtTries + " thumb=true");
  else mediaArtTries += 1;
  mediaArtTimerSlow = slow;
  mediaArtTimer = setTimeout(() => {
    mediaArtTimer = 0;
    mediaArtTimerSlow = false;
    if (!frame.isConnected || !selection.sceneLiveActive || mediaArtKey !== artKey) return;
    fetchArtworkDataUrl(location.origin + m.thumbnail).then((d) => {
      if (mediaArtKey !== artKey) return;
      if (d) {
        mediaArtData = d;
        pushMediaSnapshot(frame, m);
        diagOnce("ok", "media-art", "ok len=" + d.length + " tries=" + mediaArtTries);
      } else {
        diagOnce("fail", "media-art-try-fail",
          "attempt=" + mediaArtTries + (slow ? "/slow" : "") + " err=" + (mediaArtLastErr || "?"));
        scheduleArtworkFetch(frame, m, artKey, hasArt);
      }
    }).catch(() => { scheduleArtworkFetch(frame, m, artKey, hasArt); });
  }, slow ? MEDIA_ART_SLOW_MS : Math.min(700 * mediaArtTries, 4000));
}
function stopMediaSync(frame) {
  if (mediaTimer) { try { clearInterval(mediaTimer); } catch { /* ignore */ } mediaTimer = 0; }
  if (mediaArtTimer) { try { clearTimeout(mediaArtTimer); } catch { /* ignore */ } mediaArtTimer = 0; }
  mediaArtTimerSlow = false;
  mediaNpKey = "";
  mediaArtKey = "";
  mediaArtData = "";
  mediaArtTries = 0;
  mediaArtDiag = { fail: "", slow: "", ok: "" };
  mediaAudioInstalled = false;
  mediaControlInstalled = false;
  mediaControlWin = null;
  mediaControlFails = 0;
  const f = frame || (liveWatch && liveWatch.frame);
  if (!f || !f.isConnected) return;
  try {
    const wp = f.contentWindow && f.contentWindow.__wp;
    if (!wp) return;
    if (typeof wp.setAudioBridge === "function") wp.setAudioBridge(null);
    if (typeof wp.setMedia === "function") wp.setMedia(null);
    if (typeof wp.setMediaControl === "function") wp.setMediaControl(null);
  } catch { /* ignore */ }
}
function startMediaSync(frame) {
  stopMediaSync(frame);
  if (selection.audioSource === "off" && selection.mediaIntegration === false) return;
  const wantSpectrum = selection.audioSource !== "off";
  const wantNp = selection.mediaIntegration !== false;
  mediaTimer = setInterval(() => {
    if (!frame.isConnected || !selection.sceneLiveActive) return;
    // 控制面与「有没有在播」无关（见 syncMediaControl），但和数据面同一道设置闸：
    // 关掉「媒体信息」= 不接系统媒体，壁纸按钮便回落渲染页自己的模拟源。
    if (wantNp) syncMediaControl(frame);
    if (wantSpectrum && !mediaFetchBusy) {
      mediaFetchBusy = true;
      apiJson("/audio-spectrum")
        .then((res) => {
          const d = res.data;
          if (!d || !d.ok) return;
          if (Array.isArray(d.bands) && d.bands.length) {
            const arr = new Float32Array(d.bands.length);
            for (let i = 0; i < d.bands.length; i++) arr[i] = (d.bands[i] || 0) / 255;
            mediaSpectrum = arr;
          }
          // 装桥的时机交给宿主的 running（见 syncAudioBridge 的说明）
          syncAudioBridge(frame, d.running === true);
        })
        .catch(() => { /* 静默：保持现状，回落模拟源 */ })
        .finally(() => { mediaFetchBusy = false; });
    }
    if (wantNp && ++mediaNpTick % 20 === 0) {
      apiJson("/now-playing")
        .then((res) => {
          const d = res.data;
          if (!d || !d.ok) return;
          const m = d.media || null;
          // key 里带歌词版本：歌词是异步到齐的（本地 .lrc → 缓存 → 在线），
          // 到齐时 title/position 都没变 —— 不带它就不会再推一帧，壁纸永远拿不到歌词。
          const lyr = m && Array.isArray(m.lyrics) ? m.lyrics : [];
          const lyrRev = lyr.length ? lyr.length + ":" + String(lyr[lyr.length - 1][1] || "").length : 0;
          const key = m ? [m.title, m.artist, m.playing ? 1 : 0, Math.floor((m.position || 0) / 5), lyrRev].join("\u0000") : "";
          if (key === mediaNpKey) return;
          mediaNpKey = key;
          // 换曲：清掉上一首的封面缓存与重试计数（position 每 5 秒变一次 key，
          // 封面只在曲目变化时重新取，不会每 5 秒重下一次）。
          const artKey = m ? [m.title, m.artist, m.album].join("\u0000") : "";
          if (artKey !== mediaArtKey) {
            mediaArtKey = artKey;
            mediaArtData = "";
            mediaArtTries = 0;
            if (mediaArtTimer) { try { clearTimeout(mediaArtTimer); } catch { /* ignore */ } mediaArtTimer = 0; }
          }
          // 先推一版（可能还没封面，壁纸至少能立刻更新歌名/歌手），封面到位后再推一次。
          pushMediaSnapshot(frame, m);
          if (m && m.playing && !mediaArtData) scheduleArtworkFetch(frame, m, artKey, d.hasArtwork !== false);
        })
        .catch(() => { /* 静默 */ });
    }
  }, 50);
}

// ── GPU 抓帧主帧（单主帧 + 面积升级制）──────────────────────────────────────
// _gpu.png 是**抓帧那一刻渲染页画布的画面**，每壁纸一份（单主帧）。升级判定
// 不看视口比，看**面积**：主帧面积 ≥ 我的画布（容差 5%，GPU_FRAME_AREA_TOL）⇒
// 保留，显示侧 CSS object-fit: cover 缩小 —— 大帧缩小无损失；主帧缺失、明显
// 更小或几何未知 ⇒ 抓**我的画布尺寸** PUT 覆盖（升级）。宿主 PUT 侧另有面积
// 守卫（frame-smaller 409）兜底竞态：小帧永远覆盖不掉大帧。历史上"存帧视比
// ≠ 我的视口就清掉重抓"的规则让两个视比不同的窗口在每轮轮播到访时互踢对方
// 的帧（实测 60s 一对永不收敛）；而推演过的按形状精确缓存又躲不开 resize 场景
// 的无界写盘（每个新形状落一份）—— 面积升级制把两者一起解决：写入次数 = 主帧面积单调升级次数（个位数封顶），
// resize 零写入。
// 重抓落地后，当前层若正显示这张静帧（静态帧 img / live 垫底 poster），就地重挂
// 一次：scene-frame 响应带 no-store，换个 query 即重新取图（同「切换出图来源」的既有
// 做法）。否则用户要等下一次切换才看到修正后的构图。
function refreshStaticFrameNodes(token) {
  try {
    const root = typeof document !== "undefined" && typeof document.getElementById === "function"
      ? document.getElementById(LAYER_ID) : null;
    if (!root || typeof root.querySelectorAll !== "function") return;
    const imgs = root.querySelectorAll("img");
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i];
      const src = String((img.getAttribute && img.getAttribute("src")) || img.src || "");
      if (!src || src.indexOf("/scene-frame/" + token) === -1) continue;
      try { img.src = src + (src.indexOf("?") === -1 ? "?" : "&") + "gpur=" + Date.now(); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

// ── 加载期占位图（div + background 双层）─────────────────────────────────────
// 先铺主题色（WE 的 schemecolor），有图再叠：网页 = 自动首帧（host 缓存的
// /live-frame）；场景 = 静态帧（frameUrl，本身就是抽帧）。图 404（首次尚无缓存）
// 时保持主题色 —— 任何情况下加载期都不是黑屏，也不会停在作者预览图。
// 渲染链路行为上报（宿主落盘 ~/.dsh-wallpaper-engine/diag/http.jsonl）：
// 只在某个宿主环境复现的问题，靠「走了哪条分支、卡在哪一步」定位。
// 失败静默，绝不打断渲染。
function reportClientDiag(event, detail) {
  try {
    // `keepalive` 必须留下：页面卸载走 pagehide 时靠它把最后一条上报送出去
    //（api-client 的契约里显式透传该字段）。
    apiPostJson("/client-diag", {
      event,
      type: selection.type || "",
      id: selection.id || "",
      detail: String(detail == null ? "" : detail).slice(0, 300),
      src: String(selection.url || selection.sceneLiveSrc || selection.webLiveSrc || "").slice(0, 200),
    }, { keepalive: true }).catch(() => { /* 忽略 */ });
  } catch { /* 忽略 */ }
}

/** 「壁纸属性」开关的**唯一**读数（两个壳共用这一份：设置页工具栏 + 侧栏壁纸档）。
 *  侧栏经 ctx 拿到本函数后再取当前值 —— 它若直接读 `propsPanelOpen` 这个 `let`，
 *  内联后的 `var` 提升会让它在赋值前读到 undefined（见 scripts/build-client.mjs 的
 *  预置顺序）。开了窗再关窗也不需要 emit：两处都是受控渲染，重渲染由处理器负责。 */
function userPropsPanelOpen() {
  return propsPanelOpen === true;
}

/** 面板状态的**只读快照**（渲染器与守卫共用；渲染器不读模块级 `propsState`）。
 *  `heard` = 这次求值**已经有宿主答复**（成功或失败都算）—— 空表的两条成因（宿主说
 *  "没有属性" / 请求还在路上）在界面上必须能分辨，否则"空面板"无法自陈。 */
function userPropsStateOf() {
  return {
    open: propsPanelOpen === true,
    token: propsState.token,
    loading: propsState.loading === true,
    error: String(propsState.error || ""),
    count: propsState.props.length,
    heard: !propsState.loading && !propsState.remote,
  };
}

/** 「壁纸属性」面板的**装配点**（两个壳共用：设置页页签 + 侧栏壁纸档）。
 *  ⚠️ 必须住在**模块级**，不能是 `apply()` 里的闭包 —— `src/sidebar-right.js` 是 prelude
 *  （在 `apply()` 之前求值），它注册的渲染回调引用不到 apply 的作用域：写成闭包时真机上
 *  抛 `ReferenceError: renderUserPropsPanel is not defined`，React 随即卸载整棵树 ⇒
 *  **整个页面空白**（实测复现；不是"这里不画"那种局部问题）。
 *  它只读模块级的 `propsState` 与三个模块级函数，选中态从 `selection` 现取。 */
function renderUserPropsPanel() {
  const st = userPropsStateOf();
  const sel = selection;
  return renderPickerPropsPanel({
    open: st.open,
    // token 取**当前选中项**（不是 propsState 里那一个）：两者不等时（刚换壁纸）
    // 面板应当报"这张的属性还没到"，绝不能拿上一张的属性表冒充这一张。
    token: propTokenOf(sel),
    loading: st.loading,
    error: st.error,
    props: propsState.props,
    sceneLiveActive: sel.sceneLiveActive,
    // 失败态自陈用的读数（token / 表长 / 有没有宿主答复）—— 见 picker-props-panel.js 的 note。
    source: st,
    ensureDefs: (token) => {
      if (propsState.token !== token && !propsState.loading) loadUserPropDefs(token, true);
    },
    onPropInput: onUserPropInput,
    onReset: resetUserProps,
  });
}
