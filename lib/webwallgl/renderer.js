/**
 * WebWallGL 渲染页（`/wallpaper-engine/scene-live/index.html` 加载的模块）。
 *
 * 渲染核心是 npm 依赖 `webwallgl`：宿主的 `/scene-live/engine/` 路由从依赖目录直出
 * `webwallgl.global.min.js`（见 lib/routes/scene-serve.js），由 index.html 以经典脚本先行加载、
 * 挂到 `window.WebWallGL`。本页只做宿主适配这一层：
 *   · URL 协议：`type` / `src` / `mediaBase` / `fit` / `sceneFps` / `muted` /
 *     `renderDpr` / `vidscale` / `autoq` / `bake`（`localAssets` 由库自己读；网页壁纸 iframe 的
 *     严格沙箱是库的缺省，`webSandbox=strict` 无需本页处理）；
 *   · 控制面 `window.__wp` 与观测面 `window.__wpStats`（src/live-layer.js、src/client.js 按名调用，
 *     缺一个方法只表现为壁纸不响应、没有报错）；
 *   · 诊断：库的每条诊断按 `{mediaBase 源}/diag?msg=…&lvl=…` 打到宿主（lib/routes/diag.js）；
 *   · 装配失败时把兜底页 `default-wallpaper/index.html` 挂上，失败要有可见落点。
 */
if (!globalThis.WebWallGL) throw new Error("WebWallGL 引擎未加载（./engine/webwallgl.global.min.js）");
const { createScene, httpSource, fileSource, createMediaSource } = globalThis.WebWallGL;

const params = new URLSearchParams(location.search);
const pageType = (params.get("type") || "scene").toLowerCase();
const pageSrc = params.get("src") || "";
const pageMediaBase = params.get("mediaBase") || "";
const FITS = new Set(["cover", "contain", "stretch"]);
const fitOf = (v) => (FITS.has(v) ? v : "cover");

// 滤镜白名单：宿主只传 id，不让任意字符串进 style.filter（url() 可外链资源）。
const WALLPAPER_FILTERS = {
  none: "",
  blur: "blur(14px)",
  grayscale: "grayscale(1)",
  sepia: "sepia(0.75)",
  vivid: "saturate(1.6)",
  warm: "sepia(0.35) saturate(1.35) brightness(1.05)",
  cool: "sepia(0.25) hue-rotate(175deg) saturate(1.3) brightness(1.03)",
  invert: "invert(1)",
  brighten: "brightness(1.3)",
  darken: "brightness(0.72)",
  contrast: "contrast(1.35)",
};

const host = document.getElementById("wp");

let current = { type: pageType, src: pageSrc, mediaBase: pageMediaBase };

function diagOrigin() {
  try {
    return current.mediaBase ? new URL(current.mediaBase, location.href).origin : "";
  } catch {
    return "";
  }
}

function reportDiag(msg, level) {
  const origin = diagOrigin();
  if (!origin) return;
  const lvl = level === "error" || level === "warn" ? level : "info";
  const text = `scene ${current.src || "?"}: ${String(msg ?? "").slice(0, 500)}`;
  try {
    new Image().src = `${origin}/diag?msg=${encodeURIComponent(text)}&lvl=${lvl}`;
  } catch {
    /* 诊断通道失败不影响渲染 */
  }
}

/** 网页壁纸来源：`src` 是完整入口 URL，project.json 与它同目录。 */
function webSource(entryUrl) {
  const dir = entryUrl.replace(/[?#].*$/, "").replace(/\/[^/]*$/, "");
  let project = null;
  return {
    key: dir,
    project() {
      // 类型以宿主为准：入口缺 project.json 或 type 写错时库会把它当场景装配
      project ??= fetch(`${dir}/project.json`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((p) => ({ ...(p && typeof p === "object" ? p : {}), type: "web" }));
      return project;
    },
    async webEntry() {
      return { url: entryUrl };
    },
    scenePkg() {
      return Promise.reject(new Error("网页壁纸没有 scene.pkg"));
    },
  };
}

function sourceOf(cfg) {
  if (cfg.type === "web") return cfg.src ? webSource(cfg.src) : null;
  if (!cfg.mediaBase || !cfg.src) return null;
  return httpSource(`${cfg.mediaBase.replace(/\/+$/, "")}/${cfg.src}`);
}

const inst = createScene(host, {
  fit: fitOf(params.get("fit")),
  fps: Number(params.get("sceneFps")) || 60,
  volume: params.get("muted") === "false" ? 1 : 0,
  renderDpr: Number(params.get("renderDpr")) || 0,
  videoTexScale: Number(params.get("vidscale")) || 0,
  ...(params.get("autoq") === "0" ? { autoQuality: false } : {}),
  ...(params.get("bake") === "0" ? { bake: false } : {}),
  onDiagnostic: reportDiag,
});

// ── 网页壁纸就绪态（getState）：很多网页壁纸不靠 rAF 出帧，「iframe 已 load」才是就绪信号 ──
const webState = { loaded: false, error: null };
function watchWebFrame(frame) {
  if (frame.dataset.weWatched) return;
  frame.dataset.weWatched = "1";
  frame.addEventListener("load", () => {
    webState.loaded = true;
  });
  frame.addEventListener("error", () => {
    webState.error = "iframe error";
  });
}
new MutationObserver(() => {
  for (const f of host.querySelectorAll("iframe:not(.we-fallback)")) watchWebFrame(f);
}).observe(host, { childList: true, subtree: true });

// ── 兜底页 ──
let fallbackFrame = null;
function clearFallback() {
  fallbackFrame?.remove();
  fallbackFrame = null;
}
function showFallback() {
  if (fallbackFrame) return;
  try {
    inst.release();
  } catch {
    /* 已释放 */
  }
  const f = document.createElement("iframe");
  f.className = "we-fallback";
  f.setAttribute("sandbox", "allow-scripts");
  f.src = new URL("./default-wallpaper/index.html", import.meta.url).href;
  host.appendChild(f);
  fallbackFrame = f;
}

inst.on("error", (err) => {
  if (current.type === "web") webState.error = String(err?.message ?? err);
  reportDiag(`装配失败：${err?.message ?? err}`, "error");
  showFallback();
});

let volume = params.get("muted") === "false" ? 1 : 0;

function loadCurrent(source) {
  clearFallback();
  webState.loaded = false;
  webState.error = null;
  const src = source ?? sourceOf(current);
  if (!src) {
    reportDiag(current.type === "web" ? "网页壁纸：缺少 src" : "场景壁纸缺少 mediaBase/src", "error");
    showFallback();
    return;
  }
  inst
    .load(src)
    .then(() => inst.setVolume(volume))
    .catch(() => {
      /* 失败已经 error 事件上报并挂上兜底页；这里只吞掉 Promise */
    });
}

// ── 媒体集成（Now Playing）：显示数据与控制面分开下发，但库只收一个 MediaSource ──
let mediaInit = null;
let mediaControls = null;
let mediaSrc = null;
function applyMedia(rebuild) {
  if (!mediaInit && !mediaControls) {
    mediaSrc = null;
    inst.setMedia(null);
    return;
  }
  // 宿主没在播时仍要保留控制面：空播点「播放」得打到真实播放器
  const init = mediaInit ?? { hasMedia: false };
  if (mediaSrc && !rebuild) {
    mediaSrc.set(init);
    return;
  }
  mediaSrc = createMediaSource(init, mediaControls ?? undefined);
  inst.setMedia(mediaSrc);
}

function applyFilter(id) {
  host.style.filter = WALLPAPER_FILTERS[id] ?? "";
}

window.__wpStats = {
  frame: () => inst.stats,
};

window.__wp = {
  setWallpaper(cfg) {
    current = {
      type: String(cfg?.type || "scene").toLowerCase(),
      src: cfg?.src || "",
      mediaBase: cfg?.mediaBase ?? current.mediaBase,
    };
    if (cfg?.fit) inst.setFit(fitOf(cfg.fit));
    if (cfg?.sceneFps) inst.setFps(Number(cfg.sceneFps));
    if ("filter" in (cfg ?? {})) applyFilter(cfg.filter);
    loadCurrent();
  },
  pause() {
    inst.pause();
  },
  resume() {
    inst.resume();
  },
  setFit(fit) {
    inst.setFit(fitOf(fit));
  },
  setVolume(v) {
    volume = Math.max(0, Math.min(1, Number(v) || 0));
    inst.setVolume(volume);
  },
  release() {
    inst.release();
  },
  restore() {
    if (fallbackFrame) loadCurrent();
    else inst.restore();
  },
  setRenderDpr(dpr) {
    inst.setRenderDpr(Number(dpr) || 0);
  },
  setSceneFps(fps) {
    inst.setFps(Number(fps) || 60);
  },
  setQuality(patch) {
    inst.setQuality(patch ?? {});
  },
  getQuality() {
    return inst.getQuality();
  },
  setFilter(id) {
    applyFilter(id);
  },
  updateWebProps(wire) {
    const flat = {};
    for (const [k, w] of Object.entries(wire ?? {})) flat[k] = w && typeof w === "object" ? w.value : w;
    inst.setProperties(flat);
  },
  pushPointer(u, v, buttons, mods) {
    inst.pushPointer(u, v, buttons, mods);
  },
  pointerLeave() {
    inst.pointerLeave();
  },
  pushWheel(dx, dy, mode, mods) {
    inst.pushWheel(dx, dy, mode, mods);
  },
  loadSceneFile(file, project) {
    current = { ...current, type: "scene" };
    loadCurrent(fileSource(file, project));
  },
  setAudioBridge(fn) {
    // 桥返回 null 的帧由库回落内置模拟源；注销同样回落模拟源（不是静音）
    inst.setAudio(typeof fn === "function" ? { snapshot: () => fn() } : null);
  },
  capture(maxWidth) {
    const src = inst.canvas instanceof HTMLCanvasElement ? inst.canvas : host.querySelector("canvas");
    if (!src || !src.width || !src.height) return null;
    try {
      const limit = maxWidth && maxWidth > 0 ? maxWidth : 0;
      if (!limit || src.width <= limit) return src.toDataURL("image/jpeg", 0.85);
      const off = document.createElement("canvas");
      off.width = limit;
      off.height = Math.max(1, Math.round(src.height * (limit / src.width)));
      const ctx = off.getContext("2d");
      if (!ctx) return src.toDataURL("image/jpeg", 0.85);
      ctx.drawImage(src, 0, 0, off.width, off.height);
      return off.toDataURL("image/jpeg", 0.85);
    } catch {
      // 画布被跨源内容污染时 toDataURL 会抛 SecurityError
      return null;
    }
  },
  getProperties() {
    return inst.getProperties() ?? null;
  },
  setMedia(init) {
    mediaInit = init && typeof init === "object" ? init : null;
    applyMedia(false);
  },
  setMediaControl(controls) {
    mediaControls = controls && typeof controls === "object" ? controls : null;
    applyMedia(true);
  },
  setOcclusion(payload) {
    inst.setOcclusion(payload ?? null);
  },
  getOcclusion() {
    return null;
  },
  getState() {
    const isWeb = current.type === "web";
    return {
      type: current.type || null,
      iframeLoaded: isWeb ? webState.loaded : null,
      webError: isWeb ? webState.error : null,
      paused: inst.paused === true,
      webFps: isWeb ? Math.round(inst.stats.fps || 0) : null,
    };
  },
};

// 遮挡桥（lib/webwallgl/occlusion-bridge.js，由宿主注入 index.html）的唯一入口：
// payload = { occluders, epoch, gen }，null = 清除。桥在本模块之前装好，未就绪时它会静默丢拍。
window.__weSetOcclusion = (payload) => {
  try {
    inst.setOcclusion(payload ?? null);
  } catch {
    /* 遮挡推送失败不影响渲染 */
  }
};

document.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("pagehide", () => inst.destroy());

loadCurrent();
