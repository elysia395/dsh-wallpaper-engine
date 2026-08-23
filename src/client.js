/**
 * dsh-wallpaper-engine — client (browser) half source.
 *
 * CANONICAL source; `scripts/build-client.mjs` emits `lib/client.js`. Edit this
 * file, run `npm run build`. Do not hand-edit `lib/client.js`.
 *
 * The plugin:
 *   1. Fetches the wallpaper inventory from the host half's same-origin route
 *      (GET /wallpaper-engine/inventory). A "刷新" button refetches on demand so
 *      newly downloaded Wallpaper Engine wallpapers appear without a page reload.
 *   2. Renders the selected wallpaper BEHIND the DSH GUI: a `position:fixed;
 *      z-index:-1` child of `document.body`, plus a scrim (darkened overlay). The
 *      app frame + sidebar backgrounds are made transparent so the wallpaper
 *      shows through the whole frame while the scrim keeps text readable.
 *   3. Applies four user-adjustable effects, each with its own slider:
 *      - 壁纸模糊 (wallpaper blur) → `--we-wallpaper-blur`
 *      - 暗化 (scrim strength)      → `--we-scrim-color`
 *      - 边框 (border emphasis)     → `--dsw-alias-border-l1/l2` alpha
 *      - 玻璃 (glass blur on panels)→ `--we-blur` + frosted-glass backgrounds
 *      The "glass" effect turns the opaque conversation surfaces (composer card,
 *      message bubbles, raised panels) into translucent frosted glass backed by
 *      `backdrop-filter`, so the wallpaper shows through them softly.
 *   4. Automatic rotation over USER-DEFINED carousel lists (轮播列表): the user
 *      can create any number of lists, pick wallpapers into each from the
 *      inventory, and give each list its own switch interval and order. Lists
 *      are persisted client-side (localStorage), so rotation never depends on
 *      Wallpaper Engine's own config.json playlist paths. A playable WE
 *      playlist is imported as the first list on first run so the feature
 *      starts working out of the box.
 */

const React = require("react");
// Portal for the wallpaper picker modal. react-dom is registered in the DSH
// client module loader (see @deepseek-ai/dsh-client-web), so out-of-tree client
// bundles can require it just like "react".
const ReactDOM = require("react-dom");

const SETTINGS_KEY = "dsh-wallpaper-engine:selection";
// Host-sourced settings: the same-origin route the browser half uses to read
// and write its persisted settings. The host stores them in a plain file
// (~/.dsh-wallpaper-engine/config.json), which is PORT-INDEPENDENT — unlike
// localStorage, which is origin-scoped and therefore reset whenever DSH
// Desktop restarts on a new random --port 0 loopback port.
const SETTINGS_URL = "/wallpaper-engine/settings";
const INVENTORY_URL = "/wallpaper-engine/inventory";
// Body attribute set while a wallpaper is active; CSS uses it to make the frame
// background transparent so the behind-body layer shows through.
const ACTIVE_ATTR = "data-we-wallpaper";
const LAYER_ID = "dsh-wallpaper-engine-layer";
const SCRIM_ID = "dsh-wallpaper-engine-scrim";
// Chat-interface rope dock: a draggable pull-cord floating over the chat plus
// the glass repo side panel it pulls out. Both are portalled onto <body> under
// their own React root (see apply), independent of the settings view.
const ROPE_DOCK_ID = "dsh-wallpaper-engine-rope-dock";
const ROPE_POS_KEY = "dsh-wallpaper-engine:rope-pos";

// ── Defaults ─────────────────────────────────────────────────────────────────
// scrim default is intentionally LOW now: iOS liquid glass needs the wallpaper
// colour to pass through the glass, so we no longer crush it behind a near-black
// scrim. Users can raise it back via the 暗化 slider for busy wallpapers.
const DEFAULTS = {
  scrim: 0.25,
  border: 0.35,
  blur: 16,
  wallpaperBlur: 0,
  rotationEnabled: false,
  rotationInterval: 30,
  rotationGroupId: "",
  rotationGroups: [],
  rotationSeeded: false,
  // Soft-delete: ids of wallpapers the user hid (localStorage only, no file
  // changes). Hidden wallpapers leave the normal list + rotation candidates
  // but keep playing if already active; they reappear on restore.
  hiddenIds: [],
  // Video playback speed (0.5x–2x, applied via native playbackRate).
  playbackRate: 1,
  // 解码帧率上限（fps；0 = 无限制）：对源帧率高于上限的视频壁纸，host 一次性
  // ffmpeg 重编码为上限帧率的"抽帧版"（4K120→4K60，时间线保持 1.0x 正常速度，
  // 解码占用随帧率线性下降）。与倍速完全解耦 —— 倍速照常叠加在抽帧版上。
  // 无 ffmpeg 或转码失败时自动回退原片（transcodeState: "fallback"）。
  fpsCap: 0,
  // 遮挡暂停（借鉴 Wallpaper Engine 的「被遮挡时暂停」——桌面端大部分时间
  // GPU≈0 主因就是它）：
  // - pauseOnHidden：页面隐藏（窗口最小化 / 切到其它标签页）时暂停视频。
  //   浏览器对后台页的节流并不保证解码停止，显式 pause 让解码引擎直接归零。
  // - pauseOnBlur：窗口失焦（切到其它应用，壁纸很可能被遮挡）时暂停。
  //   浏览器无法直接探测"被窗口遮挡"，失焦是最接近的代理信号。
  // 恢复可见 / 聚焦后，若用户未手动暂停则自动继续（同步 effective 播放态）。
  pauseOnHidden: true,
  pauseOnBlur: false,
  // 使用电池供电时暂停（类似 WE 的电池优化）：navigator.getBattery 判定
  // 是否在电池上（!charging），不支持的浏览器自动无操作。
  pauseOnBattery: false,
  // Horizontal mirror (CSS scaleX(-1)) — pure compositor, no main-thread cost.
  flip: false,
  // Fit mode for CUSTOM-uploaded wallpapers only (WE wallpapers keep cover):
  // 覆盖=cover · 填充=contain · 居中=center · 拉伸=fill (one object-fit var).
  objectFit: "cover",
  // Content-rating filter, reproducing Wallpaper Engine's own rating taxonomy
  // (project.json `contentrating`: "Everyone" / "PG13" / "Mature" — WE's
  // workshop tags G / PG13 / R; projects without the field are "unrated").
  // "everyone" is the default, matching WE's conservative first-run stance.
  contentRatingFilter: "everyone",
  // Wallpaper-type filter (all / video / web / image / scene). "all" disables it.
  typeFilter: "all",
  // Thumbnail-card style: "classic" (WE's original aspect-ratio 16/9 cards —
  // the CD-like look the author liked; can overlap in older browsers) or
  // "fixed" (rewritten fixed-height cards that never overlap). The vinyl
  // record next to the selection is shown in BOTH styles (here + modal head).
  pickerLayout: "fixed",
  // Edge 兼容渲染：Edge（且仅 Edge）会在任何"可见的 <video>"上绘制浏览器
  // 自带的「下载 / 投屏」悬浮工具栏且无官方开关，故默认在 Edge 中把视频壁纸
  // 改为 canvas 渲染（见 IS_EDGE / weStartDraw）；关闭后所有浏览器一律使用
  // 原生 <video>（Edge 上悬浮栏会重新出现，属预期）。
  edgeCompat: true,
  // Settings-page liquid-glass theming:
  // - accent: the plugin's own accent color (#rrggbb), written to --we-accent
  //   and consumed by buttons/sliders/selected cards/badges/glass highlights —
  //   independent of the shell's theme brand token.
  // - glassAlpha: glass-surface transparency in % (0–60, step 5), written to
  //   --we-glass-alpha and used by the settings window, settings card, composer
  //   card, bubbles and sidebar panels. Higher = MORE transparent (clearer
  //   wallpaper shows through), lower = closer to solid.
  // - glassColor: the GLASS BASE COLOR of the settings window (#rrggbb),
  //   written to --we-glass-color. Defaults keep the stock look (white glass
  //   in light mode, deep navy in dark); once the user picks a color BOTH
  //   themes use it, so the window glass can be tinted to taste.
  // - glassWindow: master switch for the WHOLE native settings window — when
  //   on, the dialog (nav + every native section: General/Models/Plugins/…)
  //   becomes liquid glass with the accent + transparency above; off restores
  //   the shell's stock look.
  accent: "#4f8cff",
  glassAlpha: 12,
  glassColor: "#ffffff",
  glassWindow: true,
  // dsh-better-sidebar 液态玻璃：与设置窗口玻璃同级的一套「细节自由」控制，
  // 独立于会话玻璃（玻璃 / 玻璃透明度）——侧栏想多透 / 多糊 / 换个底色都行：
  // - sidebarGlass：总开关，关闭后侧栏恢复原生外观（不再透明 / 不再模糊）；
  // - sidebarBlur：侧栏专用 backdrop 模糊半径（px，0 = 关闭毛玻璃）；
  // - sidebarAlpha：侧栏玻璃透明度（%），语义与玻璃透明度一致（越大越透）；
  // - sidebarColor：侧栏玻璃基底色调（#rrggbb），默认白色，双主题统一生效。
  sidebarGlass: true,
  sidebarBlur: 16,
  sidebarAlpha: 12,
  sidebarColor: "#ffffff",
};

// Selectable values for the two filters. Declared up top because
// readPersisted() validates against them at module load (const TDZ).
const RATING_VALUES = ["all", "everyone", "pg13", "mature", "unrated"];
const TYPE_VALUES = ["all", "video", "web", "image", "scene"];
// 帧率上限 options (fps); 0 = 无限制. Mirror of the host whitelist.
const FPS_CAP_VALUES = [0, 60, 48, 30, 24];

// 配色 presets for the settings-page liquid-glass theme. The accent drives
// buttons/sliders/selected cards/badges and the glass sheen via --we-accent;
// users can also pick any color with the native <input type="color">.
const ACCENT_PRESETS = [
  "#4f8cff", // 经典蓝 (default)
  "#67DCE7", // 冰青 (summer-liquid-glass primary)
  "#DD8FAC", // 玫瑰粉 (summer-liquid-glass brand)
  "#F3B75F", // 琥珀金
  "#F1717F", // 珊瑚红
  "#CBE77D", // 黄绿 (success)
];

// 玻璃颜色 presets for the settings-window glass BASE tint (--we-glass-color).
// The first two are the stock-look defaults (white in light mode, deep navy in
// dark); picking any preset (or a custom color) tints the glass in BOTH themes.
const GLASS_COLOR_PRESETS = [
  "#ffffff", // 白（浅色默认）
  "#0d1524", // 深夜蓝（深色默认）
  "#67DCE7", // 冰青
  "#DD8FAC", // 玫瑰粉
  "#F3B75F", // 琥珀金
  "#F1717F", // 珊瑚红
];

// ── Persisted selection ─────────────────────────────────────────────────────
function clampNum(v, lo, hi, fallback) {
  return typeof v === "number" && v >= lo && v <= hi ? v : fallback;
}

// Rotation groups are user-defined carousel lists: each holds a set of
// wallpaper ids picked from the inventory, its own switch interval (minutes),
// and its own playback order. They are fully client-side (localStorage), so
// rotation never depends on Wallpaper Engine's own config.json paths.
function readRotationGroups(raw) {
  if (!Array.isArray(raw)) return [];
  const groups = [];
  for (const g of raw) {
    if (!g || typeof g !== "object") continue;
    const id = typeof g.id === "string" && g.id ? g.id : "";
    if (!id) continue;
    groups.push({
      id,
      name: typeof g.name === "string" && g.name.trim() ? g.name.trim() : "轮播列表",
      interval: clampNum(g.interval, 1, 1440, DEFAULTS.rotationInterval),
      order: g.order === "random" ? "random" : "sequence",
      wallpaperIds: Array.isArray(g.wallpaperIds)
        ? g.wallpaperIds.filter((x) => typeof x === "string" && x)
        : [],
    });
  }
  return groups;
}

// Shared settings sanitizer: used by readPersisted() (localStorage cache) and
// by loadPersisted() (host /wallpaper-engine/settings). The host half keeps a
// mirror (lib/index.js sanitizeSettings) — keep the two in sync.
function sanitizeSettings(o) {
  if (!o || typeof o !== "object") return { id: "", ...DEFAULTS };
  return {
    id: typeof o.id === "string" ? o.id : "",
    scrim: clampNum(o.scrim, 0, 1, DEFAULTS.scrim),
    border: clampNum(o.border, 0, 1, DEFAULTS.border),
    blur: clampNum(o.blur, 0, 60, DEFAULTS.blur),
    wallpaperBlur: clampNum(o.wallpaperBlur, 0, 60, DEFAULTS.wallpaperBlur),
    rotationEnabled: o.rotationEnabled === true,
    rotationGroupId: typeof o.rotationGroupId === "string" ? o.rotationGroupId : "",
    rotationGroups: readRotationGroups(o.rotationGroups),
    rotationSeeded: o.rotationSeeded === true,
    hiddenIds: Array.isArray(o.hiddenIds)
      ? o.hiddenIds.filter((x) => typeof x === "string" && x)
      : [],
    playbackRate: clampNum(o.playbackRate, 0.5, 2, DEFAULTS.playbackRate),
    fpsCap: FPS_CAP_VALUES.includes(o.fpsCap) ? o.fpsCap : DEFAULTS.fpsCap,
    pauseOnHidden: o.pauseOnHidden !== false,
    pauseOnBlur: o.pauseOnBlur === true,
    pauseOnBattery: o.pauseOnBattery === true,
    flip: o.flip === true,
    objectFit: ["cover", "contain", "center", "fill"].includes(o.objectFit)
      ? o.objectFit : DEFAULTS.objectFit,
    contentRatingFilter: RATING_VALUES.includes(o.contentRatingFilter)
      ? o.contentRatingFilter : DEFAULTS.contentRatingFilter,
    typeFilter: TYPE_VALUES.includes(o.typeFilter)
      ? o.typeFilter : DEFAULTS.typeFilter,
    pickerLayout: o.pickerLayout === "classic" ? "classic" : "fixed",
    edgeCompat: o.edgeCompat !== false,
    accent: typeof o.accent === "string" && /^#[0-9a-f]{6}$/i.test(o.accent)
      ? o.accent : DEFAULTS.accent,
    glassAlpha: clampNum(o.glassAlpha, 0, 60, DEFAULTS.glassAlpha),
    glassColor: typeof o.glassColor === "string" && /^#[0-9a-f]{6}$/i.test(o.glassColor)
      ? o.glassColor : DEFAULTS.glassColor,
    glassWindow: o.glassWindow !== false,
    sidebarGlass: o.sidebarGlass !== false,
    sidebarBlur: clampNum(o.sidebarBlur, 0, 60, DEFAULTS.sidebarBlur),
    sidebarAlpha: clampNum(o.sidebarAlpha, 0, 60, DEFAULTS.sidebarAlpha),
    sidebarColor: typeof o.sidebarColor === "string" && /^#[0-9a-f]{6}$/i.test(o.sidebarColor)
      ? o.sidebarColor : DEFAULTS.sidebarColor,
  };
}

function readPersisted() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { id: "", ...DEFAULTS };
    return sanitizeSettings(JSON.parse(raw));
  } catch {
    return { id: "", ...DEFAULTS };
  }
}

// ── Shared selection store (React + DOM layer share it) ────────────────────
const selection = {
  ...readPersisted(),
  url: null,
  type: null,
  previewUrl: null,
  // Transient: scene wallpaper animation MP4 URL (host /scene-video route).
  // When present the scene plays as a hardware-decoded <video>; on load error
  // it is nulled and the layer rebuilds as the extracted static frame.
  sceneVideo: null,
  // Transient: source media metadata ({ width, height, codec, fps }) from
  // /media-info (host moov probe, cached).
  mediaInfo: null,
  // Transient: whether dsh-better-sidebar is installed & enabled (host reports
  // it via the settings GET response). Gates the 侧栏玻璃 control group in the
  // picker — the knobs are meaningless without the sidebar, so they only show
  // when it is actually there.
  sidebarPresent: false,
  // Transient: 抽帧转码 lifecycle — "idle" | "working" | "ready" | "fallback"
  // | "skipped" (see maybeUpgradeToTranscoded).
  transcodeState: "idle",
  // Transient: { phase: "download"|"transcode"|"done"|"error", percent, source }
  // polled from /transcode-progress while "working" (progress bar).
  transcodeProgress: null,
  playing: true,
  loading: false,
  rotationTimer: null,
  // Draft of the rotation group currently being created/edited in the picker
  // (null when the editor is closed). Mutated live; committed on 保存.
  editing: null,
  // Transient picker UI state (NOT persisted): batch hide/restore selection
  // mode, the open/closed state of the wallpaper picker MODAL and its active
  // view ("normal" | "hidden"). The hidden section used to be inline; it now
  // lives as a tab inside the modal (see WallpaperPicker).
  batchMode: false,
  batchSelected: [],
  page: 0,
  hiddenPage: 0,
  editorPage: 0,
  hiddenOpen: false,
  pickerOpen: false,
  modalView: "normal",
  // Transient: picker-modal title search (not persisted).
  search: "",
  // Custom-upload UI state (transient): in-flight flag + last error message.
  uploading: false,
  uploadError: "",
  uploadNote: "",
  // Upload-directory editor (transient): open state + draft path.
  editingUploadDir: false,
  uploadDirDraft: "",
  inventory: { installDir: null, uploadDir: null, wallpapers: [], total: 0, portableCount: 0, playlists: [], error: null },
  loaded: false,
};

const listeners = new Set();
function emit() { for (const fn of [...listeners]) fn(); }
function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// ── React hook for the picker UI ────────────────────────────────────────────
function useStore() {
  const [, setTick] = React.useState(0);
  React.useEffect(() => subscribe(() => setTick((n) => n + 1)), []);
  return selection;
}

// Whitelist serialization of the persisted settings (the ONLY fields the host
// file and the localStorage cache carry).
function serializeSelection() {
  return {
    id: selection.id,
    scrim: selection.scrim,
    border: selection.border,
    blur: selection.blur,
    wallpaperBlur: selection.wallpaperBlur,
    rotationEnabled: selection.rotationEnabled,
    rotationGroupId: selection.rotationGroupId,
    rotationGroups: selection.rotationGroups,
    rotationSeeded: selection.rotationSeeded,
    hiddenIds: selection.hiddenIds,
    playbackRate: selection.playbackRate,
    fpsCap: selection.fpsCap,
    pauseOnHidden: selection.pauseOnHidden,
    pauseOnBlur: selection.pauseOnBlur,
    pauseOnBattery: selection.pauseOnBattery,
    flip: selection.flip,
    objectFit: selection.objectFit,
    contentRatingFilter: selection.contentRatingFilter,
    typeFilter: selection.typeFilter,
    pickerLayout: selection.pickerLayout,
    edgeCompat: selection.edgeCompat,
    accent: selection.accent,
    glassAlpha: selection.glassAlpha,
    glassColor: selection.glassColor,
    glassWindow: selection.glassWindow,
    sidebarGlass: selection.sidebarGlass,
    sidebarBlur: selection.sidebarBlur,
    sidebarAlpha: selection.sidebarAlpha,
    sidebarColor: selection.sidebarColor,
  };
}

// Host persistence: debounced PUT to /wallpaper-engine/settings (same origin;
// the host writes ~/.dsh-wallpaper-engine/config.json — port-independent).
// localStorage stays a synchronous-read cache + migration source + rollback,
// never the source of truth — and its WRITE is debounced together with the
// PUT: slider drags used to trigger a full JSON.stringify + synchronous
// localStorage write on every input tick (dozens per drag). Timers go through
// window.* (guarded) like the rotation timer below, so headless verify
// environments without a timer facility fall back to an immediate write.
let persistTimer = null;
// Dirty flag: a failed/非-2xx PUT must not be silently dropped — the host file
// would go stale and the NEXT load (host = source of truth) would roll the
// user's settings back. Retried on the next persistSelection or when the page
// becomes visible again.
let persistDirty = false;
// Write counter: loadPersisted() snapshots it before its GET and skips the
// host→selection merge when the user edited settings while the GET was in
// flight (the user's pending PUT is newer than the host's answer).
let persistWrites = 0;
function writeLocalCache() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(serializeSelection())); } catch { /* ignore */ }
}
async function pushPersisted() {
  try {
    const res = await fetch(SETTINGS_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(serializeSelection()),
      keepalive: true, // let a pending flush survive pagehide/close
    });
    persistDirty = !res.ok;
  } catch {
    // Host unreachable: the localStorage cache remains the fallback.
    persistDirty = true;
  }
}
function flushPersist() {
  persistTimer = null;
  writeLocalCache();
  pushPersisted();
}
function schedulePersist() {
  if (persistTimer) return;
  if (typeof window === "undefined" || typeof window.setTimeout !== "function") {
    flushPersist();
    return;
  }
  persistTimer = window.setTimeout(flushPersist, 200);
}

// Flush a pending write when the page goes away (tab close / navigate), and
// retry a failed PUT when the page becomes visible again.
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("pagehide", () => {
    if (persistTimer && typeof window.clearTimeout === "function") {
      window.clearTimeout(persistTimer);
      flushPersist();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && persistDirty && !persistTimer) schedulePersist();
  });
}

function persistSelection() {
  persistWrites++;
  schedulePersist();
}

// ── Host-sourced settings (load once at startup) ────────────────────────────
// GET /wallpaper-engine/settings: the host file is the source of truth (it
// survives DSH Desktop's random --port 0 restarts and browser data clears;
// localStorage is origin-scoped). Migration: when the host has nothing yet but
// localStorage does, upload it once so the host becomes the truth. On any host
// failure fall back to localStorage so a plain web load keeps working.
async function loadPersisted() {
  let hostSettings = null;
  let hostOk = false;
  // Race guard: if the user edits settings while this GET is in flight, the
  // response is STALE (their pending PUT is newer) and must not overwrite the
  // live selection.
  const writesAtStart = persistWrites;
  try {
    const res = await fetch(SETTINGS_URL, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      hostSettings = data && data.settings;
      // 侧栏玻璃控制组只在 dsh-better-sidebar 已安装且启用时显示（host 检测）。
      selection.sidebarPresent = !!(data && data.betterSidebar);
      hostOk = true;
    }
  } catch { /* host unreachable */ }

  const stale = persistWrites !== writesAtStart;
  if (hostOk && hostSettings && typeof hostSettings === "object") {
    // Host is the truth: apply it and refresh the local cache copy — unless the
    // user edited settings during the fetch (their write wins).
    if (!stale) {
      Object.assign(selection, sanitizeSettings(hostSettings));
      writeLocalCache();
    }
  } else if (hostOk) {
    // Host has nothing saved yet: migrate any existing localStorage data once.
    // JSON.parse MUST be guarded here: a corrupted localStorage payload used to
    // reject loadPersisted(), which broke the loadPersisted().then(loadInventory)
    // boot chain and left the picker stuck on "扫描 Wallpaper Engine…" forever.
    const local = localStorage.getItem(SETTINGS_KEY);
    let parsedLocal = null;
    try { parsedLocal = local ? JSON.parse(local) : null; } catch { /* corrupted cache: treat as absent */ }
    if (!stale) Object.assign(selection, parsedLocal ? sanitizeSettings(parsedLocal) : { id: "", ...DEFAULTS });
    if (parsedLocal) pushPersisted();
  } else {
    // Host unreachable (route missing / static load): localStorage fallback.
    if (!stale) Object.assign(selection, readPersisted());
  }

  applyEffects();
  emit();
}

// Concurrency guard: 刷新 / 上传完成 / 移除 / 改目录 all call loadInventory(),
// and two overlapping requests used to resolve in arbitrary order — an older,
// slower response could clobber a newer inventory. The last caller wins;
// superseded requests drop their result entirely.
let inventorySeq = 0;
async function loadInventory() {
  const seq = ++inventorySeq;
  selection.loading = true;
  emit();
  let next;
  try {
    const res = await fetch(INVENTORY_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("inventory HTTP " + res.status);
    const data = await res.json();
    next = {
      installDir: data.installDir,
      uploadDir: data.uploadDir || null,
      wallpapers: data.wallpapers || [],
      total: data.total || 0,
      portableCount: data.portableCount || 0,
      playlists: Array.isArray(data.playlists) ? data.playlists : [],
      error: null,
    };
  } catch (err) {
    next = {
      installDir: null,
      uploadDir: null,
      wallpapers: [],
      total: 0,
      portableCount: 0,
      playlists: [],
      error: String(err && err.message ? err.message : err),
    };
  }
  if (seq !== inventorySeq) return; // superseded by a newer loadInventory()
  selection.inventory = next;
  selection.loading = false;
  selection.loaded = true;
  // Fresh inventory → reset pagination, but ONLY when the wallpaper id set
  // actually changed: an upload/remove/refresh that keeps the same list must
  // not kick the user back to page 1.
  const prevIds = selection._invIds || "";
  const nextIds = next.wallpapers.map((w) => w.id).join("\u0001");
  if (prevIds !== nextIds) {
    selection._invIds = nextIds;
    selection.page = 0;
    selection.hiddenPage = 0;
    selection.editorPage = 0;
  }

  // Rotation groups: validate the active one and seed a first group from a
  // playable Wallpaper Engine playlist when the user has none yet (so the
  // rotation feature starts working out of the box, using ids the host already
  // resolved — no WE config.json path matching involved). Seeding happens once
  // (`rotationSeeded`), so deleting every list stays respected on refresh.
  if (!selection.rotationGroups.length && !selection.rotationSeeded) {
    selection.rotationSeeded = true;
    seedGroupsFromPlaylists();
    persistSelection();
  }
  if (selection.rotationGroupId && !activeRotationGroup()) {
    selection.rotationGroupId = "";
    persistSelection();
  }
  if (selection.rotationEnabled) {
    if (!selection.rotationGroupId) {
      const usable = firstUsableGroup();
      if (usable) selection.rotationGroupId = usable.id;
      else selection.rotationEnabled = false;
    } else if (rotationCandidates().length < 2) {
      const usable = firstUsableGroup();
      if (usable && usable.id !== selection.rotationGroupId) selection.rotationGroupId = usable.id;
      else if (!usable) selection.rotationEnabled = false;
    }
    persistSelection();
  }

  // Re-validate the selection against the refreshed inventory + filters (also
  // covers the rating/type filters): drop vanished/no-longer-matching
  // selections, then restore rotation state.
  revalidateSelection();
}

// ── Content-rating + type filters ───────────────────────────────────────────
// Reproduces Wallpaper Engine's own content categories (project.json
// `contentrating`): "Everyone" (G) / "PG13" (parental guidance) / "Mature" (R);
// projects without the field are "unrated". A separate type filter narrows the
// playable types (video / web / image / scene static frame). Both are enforced
// at the single choke point below, so the grid, the rotation editor, the
// rotation candidates and the auto-selection all stay consistent. Matching is
// case-insensitive and accepts common spellings so other local copies behave
// the same.
const ADULT_RATING_PATTERN = /^(mature|adult|adultonly|18\+|r18)$/i;
const PG13_RATING_PATTERN = /^(pg13|pg-13|pg ?13|questionable)$/i;

function ratingOf(w) {
  const rating = typeof w.contentrating === "string" ? w.contentrating.trim() : "";
  if (!rating) return "unrated";
  if (/^(everyone|general|g)$/i.test(rating)) return "everyone";
  if (PG13_RATING_PATTERN.test(rating)) return "pg13";
  if (ADULT_RATING_PATTERN.test(rating)) return "mature";
  return "unrated";
}

function matchesRatingFilter(w) {
  const filter = selection.contentRatingFilter;
  if (filter === "all") return true;
  return ratingOf(w) === filter;
}

function matchesTypeFilter(w) {
  const filter = selection.typeFilter;
  if (filter === "all") return true;
  return w.type === filter;
}

function isPlayableType(w) {
  // "image" = user-uploaded still image (custom uploads, id prefix "up-").
  // "scene" = WE scene wallpaper — usable as a static frame when the host
  // served a frameUrl (extracted from its main texture).
  if (!w) return false;
  if (w.playable && (w.type === "video" || w.type === "web" || w.type === "image")) return true;
  return w.type === "scene" && Boolean(w.frameUrl);
}

function isRotatableWallpaper(w) {
  return isPlayableType(w) && matchesRatingFilter(w) && matchesTypeFilter(w);
}

function playableInventory() {
  return selection.inventory.wallpapers.filter(
    (w) => isRotatableWallpaper(w) && !isHiddenWallpaper(w.id),
  );
}

// Re-validate the active selection against the current inventory + filters.
// Called after a refresh AND after changing the rating/type filter: drop a
// selection that vanished, is no longer playable, or no longer matches the
// selected categories; when rotation is on and nothing matches, pick the next
// candidate instead of stopping playback.
function revalidateSelection() {
  if (selection.id && !selection.inventory.wallpapers.some((w) => w.id === selection.id && isRotatableWallpaper(w))) {
    selection.id = "";
    persistSelection();
  }
  if (selection.rotationEnabled && selection.id && !rotationCandidates().some((w) => w.id === selection.id)) {
    const first = rotationCandidates()[0];
    selection.id = first ? first.id : "";
    persistSelection();
  }
  if (!selection.id && selection.rotationEnabled) {
    const first = rotationCandidates()[0];
    if (first) selection.id = first.id;
  }
  applySelection(selection.id);
  emit();
}

// ── Rotation groups (user-defined carousel lists) ───────────────────────────
function activeRotationGroup() {
  return selection.rotationGroups.find((g) => g.id === selection.rotationGroupId) || null;
}

// byId lookup cache: groupWallpapers() is called from render, revalidate,
// rotation scheduling and firstUsableGroup() — rebuilding a full Map per call
// was O(N) × O(calls) on every emit. Keyed by the inventory ARRAY REFERENCE,
// so a fresh loadInventory() (which replaces the array) invalidates it.
let byIdCache = null;
let byIdRef = null;
function wallpaperById() {
  const list = selection.inventory.wallpapers;
  if (byIdRef !== list) {
    byIdRef = list;
    byIdCache = new Map(list.map((w) => [w.id, w]));
  }
  return byIdCache;
}

function groupWallpapers(group) {
  if (!group || !Array.isArray(group.wallpaperIds)) return [];
  const byId = wallpaperById();
  return group.wallpaperIds
    .map((id) => byId.get(id))
    .filter((w) => w && isRotatableWallpaper(w) && !isHiddenWallpaper(w.id));
}

function rotationCandidates() {
  return groupWallpapers(activeRotationGroup());
}

function firstUsableGroup() {
  return selection.rotationGroups.find((g) => groupWallpapers(g).length >= 2) || null;
}

// First run / upgrade path: turn the first playable Wallpaper Engine playlist
// into a rotation group so existing setups keep working without any WE-side
// configuration. Returns true when a group was created.
function seedGroupsFromPlaylists() {
  const playable = selection.inventory.playlists.filter((p) => (p.portableCount || 0) >= 2);
  const source = playable[0];
  if (!source) return false;
  const ids = Array.isArray(source.wallpaperIds) ? source.wallpaperIds.slice() : [];
  if (!ids.length) return false;
  selection.rotationGroups.push({
    id: nextGroupId(),
    name: typeof source.name === "string" && source.name.trim() ? source.name.trim() : "轮播列表",
    interval: DEFAULTS.rotationInterval,
    order: source.order === "random" ? "random" : "sequence",
    wallpaperIds: ids,
  });
  selection.rotationGroupId = selection.rotationGroups[selection.rotationGroups.length - 1].id;
  return true;
}

function nextGroupId() {
  return "grp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function nextRotationWallpaper() {
  const list = rotationCandidates();
  if (list.length < 2) return null;
  const group = activeRotationGroup();
  if (group && group.order === "random") {
    const candidates = list.filter((w) => w.id !== selection.id);
    return candidates[Math.floor(Math.random() * candidates.length)] || null;
  }
  const current = list.findIndex((w) => w.id === selection.id);
  return list[(current + 1 + list.length) % list.length] || null;
}

function clearRotationTimer() {
  if (selection.rotationTimer === null) return;
  if (typeof window !== "undefined" && typeof window.clearTimeout === "function") {
    window.clearTimeout(selection.rotationTimer);
  }
  selection.rotationTimer = null;
}

function syncRotationTimer() {
  clearRotationTimer();
  if (!selection.rotationEnabled || !selection.id) return;
  if (rotationCandidates().length < 2) return;
  if (typeof window === "undefined" || typeof window.setTimeout !== "function") return;
  const group = activeRotationGroup();
  const minutes = group ? group.interval : DEFAULTS.rotationInterval;
  selection.rotationTimer = window.setTimeout(() => {
    selection.rotationTimer = null;
    if (!selection.rotationEnabled || !selection.id) return;
    const next = nextRotationWallpaper();
    if (next) applySelection(next.id);
    // 静默停摆修复：候选在 armed 期间被隐藏到不足 2 个时 next 为 null，
    // 不重建定时器轮播就无声停止。re-arm（候选仍 <2 时 syncRotationTimer
    // 自身不会 arm；恢复 ≥2 由 hide/restore 里的补 arm 接管）。
    else syncRotationTimer();
  }, minutes * 60 * 1000);
}

// ── Rotation group CRUD (draft-based editor) ────────────────────────────────
function startEditGroup(id) {
  const group = selection.rotationGroups.find((g) => g.id === id);
  if (!group) return;
  selection.editing = JSON.parse(JSON.stringify(group));
  emit();
}

function startCreateGroup() {
  selection.editing = {
    id: nextGroupId(),
    name: "轮播列表 " + (selection.rotationGroups.length + 1),
    interval: DEFAULTS.rotationInterval,
    order: "sequence",
    wallpaperIds: [],
  };
  emit();
}

function saveEditingGroup() {
  const draft = selection.editing;
  if (!draft) return;
  const idx = selection.rotationGroups.findIndex((g) => g.id === draft.id);
  const cleaned = {
    id: draft.id,
    name: typeof draft.name === "string" && draft.name.trim() ? draft.name.trim() : "轮播列表",
    interval: clampNum(draft.interval, 1, 1440, DEFAULTS.rotationInterval),
    order: draft.order === "random" ? "random" : "sequence",
    wallpaperIds: Array.isArray(draft.wallpaperIds)
      ? draft.wallpaperIds.filter((x) => typeof x === "string" && x)
      : [],
  };
  if (idx >= 0) selection.rotationGroups[idx] = cleaned;
  else selection.rotationGroups.push(cleaned);
  selection.rotationGroupId = cleaned.id;
  selection.editing = null;
  if (selection.rotationEnabled && !rotationCandidates().some((w) => w.id === selection.id)) {
    const first = rotationCandidates()[0];
    applySelection(first ? first.id : "");
    return;
  }
  persistSelection();
  syncRotationTimer();
  emit();
}

function cancelEditGroup() {
  selection.editing = null;
  emit();
}

function deleteGroup(id) {
  const idx = selection.rotationGroups.findIndex((g) => g.id === id);
  if (idx < 0) return;
  selection.rotationGroups.splice(idx, 1);
  if (selection.rotationGroupId === id) {
    selection.rotationGroupId = "";
    if (selection.rotationEnabled) {
      const fallback = firstUsableGroup();
      if (fallback) selection.rotationGroupId = fallback.id;
      else selection.rotationEnabled = false;
    }
  }
  if (selection.editing && selection.editing.id === id) selection.editing = null;
  persistSelection();
  syncRotationTimer();
  emit();
}

function importPlaylistIntoDraft(playlist) {
  if (!selection.editing || !playlist || !Array.isArray(playlist.wallpaperIds)) return;
  selection.editing.wallpaperIds = playlist.wallpaperIds.slice();
  emit();
}

function applySelection(id) {
  selection.id = id || "";
  persistSelection();
  if (!selection.id) {
    selection.url = null;
    selection.type = null;
    selection.previewUrl = null;
    selection.sceneVideo = null;
    selection.mediaInfo = null;
    selection.transcodeState = "idle";
    mediaInfoToken = "";
    abortTranscodeUpgrade();
    syncRotationTimer();
    emit();
    return;
  }
  const w = selection.inventory.wallpapers.find((x) => x.id === selection.id);
  if (!w || !isRotatableWallpaper(w)) {
    selection.url = null;
    selection.type = null;
    selection.previewUrl = null;
    selection.sceneVideo = null;
    selection.mediaInfo = null;
    selection.transcodeState = "idle";
    mediaInfoToken = "";
    abortTranscodeUpgrade();
    syncRotationTimer();
    emit();
    return;
  }
  selection.url = w.type === "scene" ? w.frameUrl : w.media;
  selection.type = w.type;
  // Keep the preview around so a failed static frame can fall back to it.
  selection.previewUrl = w.preview || null;
  // Scene wallpapers with an embedded animation (host-extracted MP4) play it
  // as a hardware-decoded <video>; scenes without one stay on the static frame.
  selection.sceneVideo = w.type === "scene" ? (w.sceneVideo || null) : null;
  selection.transcodeState = "idle";
  // The previous wallpaper's media info must not leak into the new one: a stale
  // fps would make the sync "源帧率 ≤ 上限" check wrongly skip the transcode
  // (and the UI would keep claiming 无需抽帧 for a 120fps source).
  selection.mediaInfo = null;
  abortTranscodeUpgrade();
  refreshMediaInfo();
  syncRotationTimer();
  emit();
}

// ── Hidden wallpapers (soft delete / restore, localStorage only) ───────────
// Hiding is a pure status flag: no source file is touched, and a hidden
// wallpaper that is currently playing keeps playing (it only leaves the
// lists). Rotation candidates exclude hidden ids via groupWallpapers(), so a
// hidden wallpaper can never be auto-selected by the carousel.
function isHiddenWallpaper(id) {
  return Boolean(id) && selection.hiddenIds.includes(id);
}

function hiddenInventoryList() {
  return selection.inventory.wallpapers.filter((w) => isHiddenWallpaper(w.id));
}

function hideWallpapers(ids) {
  const added = ids.filter((id) => id && !selection.hiddenIds.includes(id));
  if (!added.length) return;
  for (const id of added) selection.hiddenIds.push(id);
  persistSelection();
  syncRotationTimer(); // 候选可能跌破 2 个 → 停表；恢复时重新 arm
  emit();
}

function restoreWallpapers(ids) {
  const set = new Set(ids.filter(Boolean));
  if (!set.size) return;
  const before = selection.hiddenIds.length;
  selection.hiddenIds = selection.hiddenIds.filter((id) => !set.has(id));
  if (selection.hiddenIds.length !== before) {
    persistSelection();
    syncRotationTimer(); // 候选恢复到 ≥2 → 重新 arm 轮播
    emit();
  }
}

// ── Custom uploads (read-A storage) ─────────────────────────────────────────
// The HOST writes the uploaded bytes to its plugin-managed directory and
// serves them through the same token/media/preview routes as WE media; the
// client only POSTs the file, then refreshes the (already-merged) inventory.
const UPLOAD_URL = "/wallpaper-engine/upload";
const REMOVE_URL = "/wallpaper-engine/remove";
const UPLOAD_TYPES = ["image/jpeg", "image/png", "video/mp4"];

function isUploadedWallpaper(w) {
  return Boolean(w && w.id && w.id.indexOf("up-") === 0);
}

async function uploadWallpaperFile(file) {
  const ctype = (file.type || "").toLowerCase();
  if (!UPLOAD_TYPES.includes(ctype)) {
    selection.uploadError = "仅支持 JPG / PNG 图片与 MP4 视频";
    emit();
    return;
  }
  if (!/\.(jpe?g|png|mp4)$/i.test(file.name)) {
    selection.uploadError = "文件扩展名需为 .jpg / .png / .mp4";
    emit();
    return;
  }
  selection.uploading = true;
  selection.uploadError = "";
  selection.uploadNote = "";
  emit();
  try {
    const title = file.name.replace(/\.[^.]+$/, "").slice(0, 80);
    const res = await fetch(UPLOAD_URL + "?title=" + encodeURIComponent(title), {
      method: "POST",
      headers: { "Content-Type": ctype },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
    // Host dedup: uploading the same file again returns the existing entry
    // (data.duplicate) instead of storing a second copy.
    if (data.duplicate) {
      selection.uploadNote = "已存在相同内容的壁纸，已直接选择原有的那张";
    }
    await loadInventory();
    applySelection(data.id);
  } catch (err) {
    selection.uploadError = "上传失败：" + (err && err.message ? err.message : err);
  }
  selection.uploading = false;
  emit();
}

async function removeUploadWallpaper(id) {
  if (!id) return;
  selection.uploading = true;
  selection.uploadError = "";
  emit();
  try {
    const res = await fetch(REMOVE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
    if (selection.id === id) applySelection("");
    await loadInventory();
  } catch (err) {
    selection.uploadError = "移除失败：" + (err && err.message ? err.message : err);
  }
  selection.uploading = false;
  emit();
}

const UPLOAD_DIR_URL = "/wallpaper-engine/upload-dir";

// Change where custom uploads are stored. The host persists the choice to its
// config file (survives restarts) and migrates existing files by default —
// users can point uploads at a non-system drive without touching config files.
async function changeUploadDir(dir, migrate) {
  if (!dir || !String(dir).trim()) {
    selection.uploadError = "请输入存储位置路径";
    emit();
    return;
  }
  selection.uploading = true;
  selection.uploadError = "";
  emit();
  try {
    const res = await fetch(UPLOAD_DIR_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir: String(dir).trim(), migrate: migrate !== false }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
    selection.editingUploadDir = false;
    selection.uploadDirDraft = "";
    await loadInventory();
  } catch (err) {
    selection.uploadError = "更改失败：" + (err && err.message ? err.message : err);
  }
  selection.uploading = false;
  emit();
}

// ── Behind-body layer: wallpaper + scrim (plain DOM, NOT a slot) ───────────
// Edge (and only Edge) paints its own floating "下载/投屏" media-overlay toolbar
// over any VISIBLE <video> element, and it ignores pointer-events / controlsList /
// disableRemotePlayback; there is no browser switch to turn it off. The only
// reliable way to keep it off the wallpaper is to never paint a visible video
// element, so on Edge video wallpapers are drawn onto a <canvas> instead:
//   * Edge-only (UA-gated): Chrome/Firefox/other engines keep the native <video>
//     path untouched — zero cost and zero behaviour change outside Edge.
//   * Event-driven: requestVideoFrameCallback() redraws only when the video
//     presents a NEW frame (video framerate, not display refresh rate; paused or
//     background-tab → no callbacks → zero work). Falls back to rAF if absent.
//   * The canvas bitmap is capped at the video's native resolution (never
//     upscaled), then CSS scales it to the viewport — ~1/4 the pixels of a
//     dpr-2 fullscreen canvas.
// The <video> stays in the DOM (offscreen, invisible) purely as the decoder
// source for drawImage; play/pause/playbackRate still work on it.
const IS_EDGE = typeof navigator !== "undefined" && /Edg\//.test(navigator.userAgent);
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
function releaseLayerMedia(node) {
  const v = node && node.querySelector("video");
  if (v) {
    try { v.pause(); v.removeAttribute("src"); v.load(); } catch { /* ignore */ }
  }
}
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

function buildMedia(sel) {
  // Scene wallpapers: prefer the scene animation exposed as an MP4 <video>
  // (hardware-decoded, smooth, no WebGL context). Scenes without an embedded
  // video fall back to the extracted static frame.
  const isSceneVideo = sel.type === "scene" && Boolean(sel.sceneVideo);
  const isStill = sel.type === "image" || (sel.type === "scene" && !isSceneVideo);
  const media = sel.type === "video"
    ? document.createElement("video")
    : isSceneVideo
      ? document.createElement("video")
      : isStill
        ? document.createElement("img")
        : document.createElement("iframe");
  // The user-chosen fit mode (覆盖/填充/居中/拉伸) applies to every wallpaper
  // type — WE media included (the 适配 control used to be uploads-only).
  // iframes (web wallpapers) don't read object-fit, so they skip the class.
  const fitClass = " we-media--fit";
  if (sel.type === "video") {
    media.src = sel.url;
    media.autoplay = true;
    media.loop = true;
    media.muted = true;
    media.setAttribute("playsinline", "");
    // Native playbackRate — hardware-decoded, instant, no reload (and the
    // videos are muted anyway, so there is no audio to keep in sync).
    try { media.playbackRate = sel.playbackRate; } catch { /* ignore */ }
    if (IS_EDGE && sel.edgeCompat !== false) {
      // Edge: keep the decoder element out of sight (its floating 下载/投屏
      // toolbar attaches to any VISIBLE <video>), render via <canvas> instead
      // (see weStartDraw / weDrawFrame). Attributes are belt-and-suspenders.
      media.setAttribute("disablepictureinpicture", "");
      media.setAttribute("disableremoteplayback", "");
      media.style.cssText = "position:absolute;left:-100000px;top:0;width:320px;height:180px;opacity:0.01;pointer-events:none;";
      const canvas = document.createElement("canvas");
      canvas.className = "we-media we-media--canvas" + fitClass;
      canvas.style.background = "#000";
      return [media, canvas];
    }
    media.className = "we-media" + fitClass;
  } else if (isSceneVideo) {
    // Scene animation as <video>: autoplay/loop/muted, poster = the extracted
    // static frame (shown while the video loads). Hardware-decoded → smooth,
    // no WebGL context → no freeze.
    media.src = sel.sceneVideo;
    media.autoplay = true;
    media.loop = true;
    media.muted = true;
    media.setAttribute("playsinline", "");
    media.poster = sel.url;   // frameUrl as poster
    media.className = "we-media" + fitClass;
    // No embedded video (404) or codec failure → degrade to the static frame.
    media.addEventListener("error", () => {
      if (selection.sceneVideo) {
        selection.sceneVideo = null;
        try { syncLayers(); emit(); } catch { /* ignore */ }
      }
    });
  } else if (isStill) {
    media.src = sel.url;
    media.alt = "";
    media.draggable = false;
    media.className = "we-media" + fitClass;
    // Scene frames are generated on demand; a failed extraction (e.g. an
    // unsupported texture format) falls back to the project preview image.
    if (sel.type === "scene" && sel.previewUrl) {
      media.onerror = () => {
        if (media.src !== sel.previewUrl) media.src = sel.previewUrl;
      };
    }
  } else {
    media.src = sel.url;
    media.setAttribute("frameborder", "0");
    media.setAttribute("scrolling", "no");
    // 安全隔离：WE web 壁纸是 workshop 第三方 HTML/JS，而 media 路由与宿主
    // 同源 —— 不 sandbox 的话壁纸脚本可以 DSH 宿主 origin 身份调用宿主全部
    // API。allow-scripts 保留动态壁纸能力，但拿到 opaque origin（无
    // allow-same-origin），无法再冒用宿主身份。
    media.setAttribute("sandbox", "allow-scripts");
    media.className = "we-media we-iframe";
  }
  return media;
}

// ── Occlusion pause (遮挡暂停, WE-style) ────────────────────────────────────
// Desktop Wallpaper Engine pauses rendering whenever the wallpaper is covered
// — the main reason its GPU load is ~0 most of the time. Browsers cannot
// detect window occlusion directly, so we use the two closest proxies:
// document.hidden (minimized / tab switched away) and window focus loss
// (another app took the foreground; the wallpaper is likely covered). Pausing
// the <video> stops decode entirely (rVFC stops → decode engine → 0); on
// restore, the effective playing state resumes automatically unless the user
// manually paused. Web/iframe wallpapers cannot be paused from outside — they
// are only throttled by the browser while the page is hidden.
let weBattery = null; // BatteryManager from navigator.getBattery (if available)
function occlusionActive() {
  if (selection.pauseOnHidden && typeof document !== "undefined" && document.hidden) return true;
  if (selection.pauseOnBlur && typeof document !== "undefined"
    && typeof document.hasFocus === "function" && !document.hasFocus()) return true;
  if (selection.pauseOnBattery && weBattery && !weBattery.charging) return true;
  return false;
}
function isEffectivelyPlaying() {
  return selection.playing && !occlusionActive();
}

// ── Source metadata + frame-skip transcode (抽帧转码) ────────────────────────
// The decode-side fps cap (帧率上限) is implemented as a HOST re-encode, NOT as
// playbackRate: playbackRate is a speed multiplier, so capping decode through
// it would slow the motion. The host transcodes the wallpaper once to the cap
// fps (4K120 → 4K60, timeline 1.0x, AV1 via NVENC) and caches it; here we play
// the ORIGINAL immediately (instant first paint) and, while the host runs the
// one-time transcode, swap to the capped-fps file when it is ready — normal
// speed + halved decode. 倍速 (playbackRate) keeps working on top of either.
let mediaInfoToken = "";
// In-flight marker: while the /media-info probe for this token is pending,
// maybeUpgradeToTranscoded must NOT fire a transcode request — the probe may
// come back with fps ≤ cap (no transcode needed). Without this guard every
// wallpaper selection used to trigger a throwaway host-side ffmpeg run.
let mediaInfoInFlight = "";
async function refreshMediaInfo(force) {
  const token = selection.type === "video" && selection.url
    ? selection.url.split("/").pop()
    : null;
  if (!token || (!force && token === mediaInfoToken)) return;
  mediaInfoToken = token;
  mediaInfoInFlight = token;
  try {
    const res = await fetch("/wallpaper-engine/media-info/" + encodeURIComponent(token), { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (mediaInfoToken === token) {
      selection.mediaInfo = (data && data.info) || null;
      // Source fps ≤ cap → no transcode needed; cancel an in-flight upgrade.
      const mi = selection.mediaInfo;
      if (mi && mi.fps && mi.fps > 0 && selection.fpsCap > 0 && mi.fps <= selection.fpsCap) {
        abortTranscodeUpgrade();
        // Also drop a swapped transcode from a previous LOWER cap, so the
        // "无需抽帧" hint matches what is actually playing (the original).
        const layer = document.getElementById(LAYER_ID);
        const video = layer && layer.querySelector("video");
        if (video && video.dataset.weTranscoded) revertTranscodedVideo(video);
        selection.transcodeState = "skipped";
      }
    }
  } catch {
    if (mediaInfoToken === token) selection.mediaInfo = null;
  }
  if (mediaInfoInFlight === token) mediaInfoInFlight = "";
  // Settle → single re-emit so a deferred transcode decision (see
  // mediaInfoInFlight) runs against the final mediaInfo, success or failure.
  if (mediaInfoToken === token) emit();
}

let upgradeAbort = null;
let upgradeToken = "";
// The fps cap the in-flight upgrade request targets (0 = none). The in-flight
// latch is keyed by token ONLY in the old code, so switching 24→48 while the
// 24fps transcode was still running was treated as "already working on it" —
// the stale 24fps request then completed and swapped the video to a 24fps
// re-encode while the picker advertised the new cap ("已切换至 48fps 抽帧版").
// Tracking the cap lets a cap change abort the stale request and start fresh.
let upgradeFps = 0;
let upgradePollTimer = null; // progress poller while the transcode fetch pends
function clearUpgradePoll() {
  if (upgradePollTimer) { clearInterval(upgradePollTimer); upgradePollTimer = null; }
}
function abortTranscodeUpgrade() {
  clearUpgradePoll();
  if (upgradeAbort) { upgradeAbort.abort(); upgradeAbort = null; }
  upgradeToken = "";
  upgradeFps = 0;
  selection.transcodeProgress = null;
}
// Revert a video that was swapped to a capped-fps transcode back to the source.
// NOTE: no emit() here — this runs inside syncLayers (already inside an emit
// cycle); emitting synchronously from a subscriber re-enters the listener chain
// and recurses until the stack overflows. UI updates ride the outer emit.
function revertTranscodedVideo(video) {
  if (!video || !video.dataset.weTranscoded) return;
  delete video.dataset.weTranscoded;
  try { video.src = selection.url; video.load(); } catch { /* ignore */ }
}
function maybeUpgradeToTranscoded(video, token) {
  if (!video || !video.isConnected) return;
  const cap = selection.fpsCap;
  // Cap off / lowered to 0: revert any swapped video back to the original.
  if (!cap || cap <= 0) {
    abortTranscodeUpgrade();
    if (video.dataset.weTranscoded) {
      revertTranscodedVideo(video);
      selection.transcodeState = "idle";
    }
    return;
  }
  const mi = selection.mediaInfo;
  if (mi && mi.fps && mi.fps > 0 && mi.fps <= cap) {
    // Source already at/below the cap — no transcode needed; drop any previously
    // swapped (lower-cap) version. No in-flight reservation is made, so raising
    // the cap later can still start one.
    if (video.dataset.weTranscoded) revertTranscodedVideo(video);
    selection.transcodeState = "skipped";
    return;
  }
  // mediaInfo probe still in flight for THIS token: defer the decision — the
  // probe may come back with fps ≤ cap (transcode unnecessary). The settle
  // emit in refreshMediaInfo re-runs syncLayers and brings us back here.
  if (!mi && mediaInfoInFlight === token) return;
  if (video.dataset.weTranscoded === String(cap)) return; // already on this cap
  // Only an in-flight request for THIS cap counts as "working on it": a request
  // for a different cap would complete and swap in a stale-fps re-encode while
  // the picker advertises the current cap (24→48 direct switch bug). The guard
  // is deliberately NOT conditioned on weTranscoded: the progress poller emits
  // (→ syncLayers → this function), and with the video already on a transcode
  // that emit used to abort + re-start the request forever (page freeze).
  if (upgradeToken === token && upgradeAbort && upgradeFps === cap) return; // already working on this cap
  abortTranscodeUpgrade();
  upgradeToken = token;
  upgradeFps = cap;
  const ctrl = new AbortController();
  upgradeAbort = ctrl;
  selection.transcodeState = "working";
  selection.transcodeProgress = null;
  // Progress poller: 500ms interval reading /transcode-progress (download %,
  // then frame-based transcode % + ETA). Cleared on settle/abort. The timer is
  // ALSO kept in this closure so THIS request's completion only ever clears its
  // OWN timer — a stale request must not kill the newer request's poller.
  const pollProgress = () => {
    if (ctrl.signal.aborted) return;
    fetch("/wallpaper-engine/transcode-progress/" + encodeURIComponent(token) + "?fps=" + cap, { cache: "no-store" })
      .then((r) => r.json().catch(() => ({})))
      .then((d) => {
        if (ctrl.signal.aborted) return;
        if (d && d.phase) {
          const changed = !selection.transcodeProgress
            || selection.transcodeProgress.phase !== d.phase
            || selection.transcodeProgress.percent !== d.percent
            || selection.transcodeProgress.eta !== d.eta;
          if (changed) {
            selection.transcodeProgress = {
              phase: d.phase, percent: d.percent || 0, source: d.source || "",
              finalizing: d.finalizing === true, eta: typeof d.eta === "number" ? d.eta : null,
            };
            emit();
          }
        }
      })
      .catch(() => { /* transient poll failure: ignore */ });
  };
  clearUpgradePoll();
  const pollTimer = setInterval(pollProgress, 500);
  upgradePollTimer = pollTimer;
  pollProgress();
  const transcodedUrl = "/wallpaper-engine/transcoded/" + encodeURIComponent(token) + "?fps=" + cap;
  // Trigger + completion probe: a tiny Range request that blocks until the host
  // has the transcode cached, then answers 206 with one byte (discarded). The
  // <video> then streams the SAME url via range requests — no full-file blob is
  // ever held in memory and playback starts as soon as the first bytes arrive.
  fetch(transcodedUrl, { signal: ctrl.signal, headers: { Range: "bytes=0-0" } })
    .then(async (res) => {
      if (ctrl.signal.aborted) return; // superseded by a newer request
      if (pollTimer) clearInterval(pollTimer); // only ever this request's own timer
      if (!res.ok) { transcodeUpgradeFailed(video, token); return; }
      try { await res.arrayBuffer(); } catch { /* 1-byte body; discard */ }
      if (ctrl.signal.aborted) return;
      if (selection.fpsCap !== cap || !video.isConnected) {
        // The user changed the cap (or the wallpaper) while this request was in
        // flight: its output is stale. NEVER swap a stale-fps re-encode in —
        // drop the request state and re-decide for the CURRENT cap instead.
        abortTranscodeUpgrade();
        if (video.isConnected && selection.url && token === selection.url.split("/").pop()) {
          const cur = selection.fpsCap;
          if (cur > 0 && video.dataset.weTranscoded === String(cur)) {
            // Already playing exactly the requested cap (the user switched back
            // while this request was in flight): just settle as ready.
            selection.transcodeState = "ready";
            selection.transcodeProgress = null;
            emit();
          } else {
            maybeUpgradeToTranscoded(video, token);
          }
        } else {
          // The layer/video was rebuilt while this request was in flight (e.g.
          // Edge 兼容 render-mode toggle, or a wallpaper switch that raced the
          // abort): re-run syncLayers so the CURRENT video gets its own fresh
          // upgrade decision — otherwise it would sit on the original (full
          // decode) until some unrelated emit happened to re-trigger it.
          emit();
        }
        return;
      }
      if (selection.url && token === selection.url.split("/").pop()) {
        video.dataset.weTranscoded = String(cap);
        const t = video.currentTime;
        const wasPlaying = isEffectivelyPlaying();
        // 兜底超时：转码文件损坏 / 元数据异常时 loadedmetadata 可能永远不来，
        // UI 会永停「转码中」——15s 未就绪按失败回退原片。定时器走 window.*
        //（headless 验证环境无计时器设施时直接跳过超时兜底）。
        let metaTimer = null;
        const clearMetaTimer = () => {
          if (metaTimer && typeof window !== "undefined" && typeof window.clearTimeout === "function") {
            window.clearTimeout(metaTimer);
          }
          metaTimer = null;
        };
        const onErr = () => {
          clearMetaTimer();
          if (video.dataset.weTranscoded) {
            delete video.dataset.weTranscoded;
            try { video.src = selection.url; video.load(); } catch { /* ignore */ }
            selection.transcodeState = "fallback";
            emit();
          }
        };
        video.addEventListener("error", onErr, { once: true });
        video.src = transcodedUrl;
        video.load();
        const onMeta = () => {
          clearMetaTimer();
          try { if (t > 0 && t < video.duration) video.currentTime = t; } catch { /* ignore */ }
          if (wasPlaying) { try { video.play().catch(() => {}); } catch { /* ignore */ } }
          // Edge canvas：转码 swap 复用同一 <video>，weLoadedOnce 已置位，
          // 暂停态下补一帧避免画布停在旧画面。
          weDrawFrame();
          selection.transcodeState = "ready";
          selection.transcodeProgress = null;
          emit(); // syncLayers re-arms the Edge canvas + re-applies rate/play
        };
        video.addEventListener("loadedmetadata", onMeta, { once: true });
        if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
          metaTimer = window.setTimeout(() => {
            video.removeEventListener("loadedmetadata", onMeta);
            onErr();
          }, 15000);
        }
      }
    })
    .catch(() => {
      if (ctrl.signal.aborted) return;
      if (pollTimer) clearInterval(pollTimer); // only ever this request's own timer
      transcodeUpgradeFailed(video, token);
    });
}

// A transcode request for the CURRENT cap failed (502 / network / encode
// error): the documented fallback is to play the ORIGINAL, so revert any
// swapped transcode (a request only ever runs when the video is on a DIFFERENT
// cap's transcode or the original, so this restores the honest "原片" state).
// The in-flight latch (upgradeToken/upgradeAbort/upgradeFps) is deliberately
// LEFT set: it is what stops the emit-driven syncLayers re-entry from
// auto-restarting a request that just failed, while a cap change / 无限制
// switch still clears it and allows a retry.
function transcodeUpgradeFailed(video, token) {
  if (video && video.isConnected && video.dataset.weTranscoded) {
    revertTranscodedVideo(video);
  }
  selection.transcodeState = "fallback";
  selection.transcodeProgress = null;
  emit();
}

function codecLabel(codec) {
  return { avc1: "H.264", hvc1: "H.265", hev1: "H.265", av01: "AV1", vp09: "VP9", mp4v: "MPEG-4" }[codec] || codec;
}

function syncLayers() {
  // 1. Wallpaper element.
  const existing = document.getElementById(LAYER_ID);
  if (selection.url) {
    const wantKey = selection.type + "\u0000" + selection.url + "\u0000"
      + (IS_EDGE && selection.edgeCompat !== false ? "canvas" : "video")
      // Scene wallpapers: the media kind depends on sceneVideo (MP4 <video> vs
      // static-frame <img>), and the 404 fallback nulls sceneVideo — the key
      // must reflect it so the fallback rebuilds the layer.
      + "\u0000" + (selection.sceneVideo || "");
    const gotKey = existing && existing.dataset.weKey;
    if (existing && gotKey !== wantKey) {
      releaseLayerMedia(existing);
      existing.remove();
      // Release the previous draw loop: without this, switching from an Edge
      // canvas video to a non-canvas wallpaper (image/web/scene, or Edge 兼容
      // turned off) would keep the old hidden <video> referenced and playing
      // forever — CPU/GPU/battery + memory leak per switch (rotation mixes
      // types). weStartDraw() re-initialises when a canvas exists again.
      weStopDraw();
    }
    let node = document.getElementById(LAYER_ID);
    if (!node) {
      node = document.createElement("div");
      node.id = LAYER_ID;
      node.className = "we-layer";
      node.dataset.weKey = wantKey;
      const built = buildMedia(selection);
      if (Array.isArray(built)) for (const el of built) node.appendChild(el);
      else node.appendChild(built);
      document.body.appendChild(node);
    }
    const canvas = node.querySelector("canvas.we-media--canvas");
    const video = node.querySelector("video");
    // Edge-only: drive the canvas mirror from the hidden decoder video.
    // Incremental guard: every emit (including the 500ms transcode poll) used
    // to run a FULL weStopDraw + weStartDraw — rebuilding the ResizeObserver,
    // re-registering rVFC and forcing a getComputedStyle read each time.
    // Same canvas + same video → the draw loop is already running; skip it.
    // (自定义壁纸的 objectFit 变更由「适配」按钮直接写 weDrawCtx.fit。)
    if (canvas && video) {
      const sameDraw = weDrawCtx && weDrawCtx.canvas === canvas && weDrawCtx.video === video;
      if (!sameDraw) weStartDraw(canvas, video, canvas.className.indexOf("we-media--fit") !== -1);
    }
    if (video) {
      if (isEffectivelyPlaying()) { try { video.play().catch(() => {}); } catch {} }
      else video.pause();
      // Keep the rate in sync on every layer sync (covers rate changes while
      // the same wallpaper keeps playing — instant, no media reload).
      try { if (video.playbackRate !== selection.playbackRate) video.playbackRate = selection.playbackRate; } catch { /* ignore */ }
      // Frame-skip transcode (帧率上限): play the original now, swap to the
      // capped-fps re-encode when the host finishes it (no-op when cap is 0).
      if (selection.type === "video" && selection.url) {
        maybeUpgradeToTranscoded(video, selection.url.split("/").pop());
      }
    }
  } else if (existing) {
    weStopDraw();
    releaseLayerMedia(existing);
    existing.remove();
  }

  // 2. Scrim element (always present while a wallpaper is active).
  const scrim = document.getElementById(SCRIM_ID);
  if (selection.url) {
    if (!scrim) {
      const s = document.createElement("div");
      s.id = SCRIM_ID;
      s.className = "we-scrim";
      document.body.appendChild(s);
    }
    document.body.setAttribute(ACTIVE_ATTR, "on");
  } else {
    if (scrim) scrim.remove();
    document.body.removeAttribute(ACTIVE_ATTR);
  }
}

// ── Effect application: push the knobs into CSS variables ───────────────────
// Scrim immediacy tracking: the inline-write + forced reflow below only runs
// when the scrim value ACTUALLY changed. It used to run unconditionally on
// every emit — i.e. twice per slider tick (handler + subscribed applyEffects)
// and on every 500ms transcode poll — a forced synchronous layout storm.
let lastScrimCss = "";
function applyEffects() {
  const s = document.body.style;
  s.setProperty("--we-scrim-color", "rgba(0,0,0," + selection.scrim + ")");
  // Border emphasis: the border tokens are low-alpha hairlines; raise their
  // alpha via a neutral gray so both light and dark themes stay legible.
  s.setProperty("--we-border-alpha", String(selection.border));
  // Glass blur strength in px (0 disables the frosted-glass effect).
  s.setProperty("--we-blur", selection.blur + "px");
  // iOS liquid glass: the backdrop "colour melt" (saturation) scales with the
  // blur radius, so the 玻璃 slider drives BOTH frosted depth and how strongly
  // the wallpaper colour bleeds through the glass (0 blur → no melt). Kept
  // gentle so the glass stays 通透 (clear) instead of oversaturated.
  s.setProperty("--we-saturate", String(1.15 + selection.blur * 0.028));
  s.setProperty("--we-glass-brightness", "1.04");
  // Wallpaper blur strength in px (blurs the wallpaper itself).
  s.setProperty("--we-wallpaper-blur", selection.wallpaperBlur + "px");
  // Apply the blur filter only when it is actually > 0 (see .we-media above).
  s.setProperty("--we-media-filter",
    selection.wallpaperBlur > 0 ? ("blur(" + selection.wallpaperBlur + "px)") : "none");
  // Compensate for the fringe the blur reveals by scaling the layer up.
  const scale = (1 + selection.wallpaperBlur * 0.006).toFixed(4);
  s.setProperty("--we-wallpaper-scale", scale);
  // Horizontal mirror: composed with the blur-compensation scale on the same
  // transform (scaleX(-1) is a pure compositor operation).
  s.setProperty("--we-wallpaper-flip", selection.flip ? "-1" : "1");
  // Fit mode for the current wallpaper (consumed by .we-media--fit).
  s.setProperty("--we-object-fit", selection.objectFit);

  // Settings-page liquid-glass theming:
  // - --we-accent: plugin-owned accent color; every fallback below that used
  //   the shell's brand token (var(--dsw-alias-brand-primary, #4f8cff)) now
  //   reads --we-accent first, so the 配色 control restyles the whole picker
  //   and glass highlights without touching the shell theme.
  s.setProperty("--we-accent", selection.accent);
  // - --we-glass-alpha: white-overlay alpha of the glass surfaces. The 玻璃透明
  //   度 slider semantics: higher = MORE transparent (clearer wallpaper shows
  //   through), lower = closer to solid. 0% → ~0.25 (frosted, solid-ish),
  //   60% → ~0.03 (nearly invisible glass). The 12% default ≈ the previous
  //   hardcoded look (~0.15–0.2 white overlay).
  const glassAlpha = Math.max(0.03, 0.25 - (selection.glassAlpha / 60) * 0.22);
  s.setProperty("--we-glass-alpha", String(glassAlpha));
  // - --we-glass-color: glass base tint of the settings window. The stock
  //   defaults live in CSS (white glass light / deep navy dark); once the user
  //   picks a color (玻璃颜色), both themes use it.
  s.setProperty("--we-glass-color", selection.glassColor);
  // - Master switch for the WHOLE native settings window: when on, the dialog
  //   (nav + every native section) becomes liquid glass with the accent +
  //   transparency above. Toggled instantly via a body attribute the scoped
  //   CSS below keys on; off restores the shell's stock look.
  if (selection.glassWindow) document.body.setAttribute("data-we-glass-window", "on");
  else document.body.removeAttribute("data-we-glass-window");

  // dsh-better-sidebar 液态玻璃：一套独立于会话玻璃的细粒度控制（侧栏模糊 /
  // 侧栏透明度 / 侧栏玻璃颜色 + 总开关）。变量只作用于 [data-dsh-better-sidebar]
  // 子树（CSS 见下），关闭总开关时侧栏恢复原生外观。
  s.setProperty("--we-sidebar-blur", selection.sidebarBlur + "px");
  s.setProperty("--we-sidebar-saturate", String(1.15 + selection.sidebarBlur * 0.028));
  const sidebarAlpha = Math.max(0.03, 0.25 - (selection.sidebarAlpha / 60) * 0.22);
  s.setProperty("--we-sidebar-alpha", String(sidebarAlpha));
  s.setProperty("--we-sidebar-color", selection.sidebarColor);
  if (selection.sidebarGlass) document.body.setAttribute("data-we-sidebar-glass", "on");
  else document.body.removeAttribute("data-we-sidebar-glass");

  // Scrim immediacy: some composited/kiosk environments do not repaint a
  // z-index:-1 layer promptly when only an inherited CSS variable changes.
  // Write the resolved color DIRECTLY onto the scrim element's inline style and
  // then force a synchronous layout — but ONLY when the value changed (see
  // lastScrimCss above).
  const scrimCss = "rgba(0,0,0," + selection.scrim + ")";
  if (scrimCss !== lastScrimCss) {
    lastScrimCss = scrimCss;
    const scrim = document.getElementById(SCRIM_ID);
    if (scrim) {
      scrim.style.background = scrimCss;
    }
    // Force reflow so a stalled compositor picks up the new value immediately.
    if (document.body) {
      void document.body.offsetHeight;
    }
  }
}

function clearEffects() {
  const s = document.body.style;
  s.removeProperty("--we-scrim-color");
  s.removeProperty("--we-border-alpha");
  s.removeProperty("--we-blur");
  s.removeProperty("--we-saturate");
  s.removeProperty("--we-glass-brightness");
  s.removeProperty("--we-wallpaper-blur");
  s.removeProperty("--we-media-filter");
  s.removeProperty("--we-wallpaper-scale");
  s.removeProperty("--we-wallpaper-flip");
  s.removeProperty("--we-object-fit");
  s.removeProperty("--we-accent");
  s.removeProperty("--we-glass-alpha");
  s.removeProperty("--we-glass-color");
  document.body.removeAttribute("data-we-glass-window");
  s.removeProperty("--we-sidebar-blur");
  s.removeProperty("--we-sidebar-saturate");
  s.removeProperty("--we-sidebar-alpha");
  s.removeProperty("--we-sidebar-color");
  document.body.removeAttribute("data-we-sidebar-glass");
  const scrim = document.getElementById(SCRIM_ID);
  if (scrim) scrim.style.background = "";
  lastScrimCss = "";
}

// ── Settings picker ─────────────────────────────────────────────────────────
// `key` is only needed when a SliderRow sits inside a conditionally-rendered
// ARRAY (the sidebar-glass group) — React requires keys there.
function SliderRow(label, min, max, step, value, onInput, suffix, key) {
  return React.createElement("div", { className: "we-picker__row we-picker__slider-row", key: key },
    React.createElement("span", { className: "we-picker__hint we-picker__label" }, label),
    React.createElement("input", {
      className: "we-picker__slider", type: "range",
      min: String(min), max: String(max), step: String(step),
      value: String(value),
      // accent 填充进度：track 左段着 accent 色（macOS/Linear 式滑块质感），
      // --we-fill 由当前值算出，emit 重渲染时同步更新。
      style: { "--we-fill": Math.max(0, Math.min(100, ((Number(value) - min) / (max - min)) * 100)) + "%" },
      // The visible label is a <span> (not a <label>), so expose it to AT.
      "aria-label": label,
      onInput: (e) => onInput(Number(e.target.value)),
      // onChange stays as a final commit fallback (some engines only fire it
      // on release); onInput above is what makes the knob feedback instant.
      onChange: (e) => onInput(Number(e.target.value)),
    }),
    React.createElement("span", { className: "we-picker__hint we-picker__value" }, suffix),
  );
}

// ── Vinyl record (黑胶唱片) ─────────────────────────────────────────────────
// A rotating record disc showing the SELECTED wallpaper's cover as the label —
// the "CD player" presentation the author liked. Pure presentational: cover =
// the current wallpaper's preview URL (or null), playing drives the spin.
// Shown in BOTH settings layouts and in the picker modal head.
function VinylRecord(props) {
  const cover = props.cover;
  const title = props.title || "未选择壁纸";
  const playing = props.playing === true;
  const sm = props.sm === true;
  return React.createElement("div", {
    className: "we-vinyl" +
      (playing ? " we-vinyl--playing" : "") +
      (sm ? " we-vinyl--sm" : ""),
    title: title,
  },
    React.createElement("div", { className: "we-vinyl__cover" },
      cover
        ? React.createElement("img", {
            src: cover, alt: "", loading: "lazy",
            onError: (e) => { e.target.style.display = "none"; },
                            onLoad: (e) => { e.target.style.opacity = "1"; },
          })
        : React.createElement("span", { className: "we-vinyl__empty" }, "▦"),
    ),
    React.createElement("span", { className: "we-vinyl__hole" }),
  );
}

// ── Modal a11y helpers ─────────────────────────────────────────────────────
// pickerOpener: the「选择壁纸」button — focus returns here when the modal
// closes. pickerFocusPending: one-shot flag so the modal's initial focus lands
// exactly once on open (an inline ref callback would re-fire every render).
let pickerOpener = null;
let pickerFocusPending = false;
function modalInitialFocus(el) {
  if (el && pickerFocusPending) {
    pickerFocusPending = false;
    try { el.focus(); } catch { /* ignore */ }
  }
}
// Minimal Tab trap for the picker modal: wraps focus at both ends. Attached as
// the modal's onKeyDown; ESC is handled separately (capture-phase, global).
const FOCUSABLE_SEL = "button, select, input, [tabindex]";
function trapModalTab(e) {
  if (e.key !== "Tab") return;
  const nodes = e.currentTarget.querySelectorAll(FOCUSABLE_SEL);
  const list = Array.prototype.filter.call(nodes, (n) =>
    !n.disabled && n.tabIndex >= 0 && n.getClientRects().length > 0);
  if (!list.length) return;
  const first = list[0];
  const last = list[list.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
// Keyboard activation for the div[role="button"] wallpaper cards
// (Enter / Space → click), shared by the normal / hidden / close cards.
function cardKeyDown(e) {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); }
}

function WallpaperPicker(props) {
  // repoPanel: this copy lives inside the rope-dock side panel. While the dock
  // exists it owns the picker modal portal (repoPanelOwnsModal); the settings
  // copy suppresses its own so two identical modals never stack.
  const isRepoPanelCopy = Boolean(props && props.repoPanel);
  const sel = useStore();
  const onTogglePlay = () => { selection.playing = !selection.playing; emit(); };
  const onClear = () => applySelection("");
  const onRefresh = () => loadInventory();
  // Filter changes: persist + re-validate so wallpapers outside the selected
  // categories drop out of the grid/rotation immediately.
  const onRatingFilterChange = (e) => {
    selection.contentRatingFilter = e.target.value;
    persistSelection();
    revalidateSelection();
  };
  const onTypeFilterChange = (e) => {
    selection.typeFilter = e.target.value;
    persistSelection();
    revalidateSelection();
  };
  // Card style: classic (CD-rack) vs fixed (overlap-proof).
  const onLayoutChange = (value) => {
    selection.pickerLayout = value;
    persistSelection();
    emit();
  };
  // Edge 兼容渲染开关：关闭后任何浏览器都走原生 <video>。改的是渲染模式，
  // syncLayers 的 wantKey 已并入模式，emit 会重建壁纸层并立即按新路径生效。
  const onEdgeCompatChange = (checked) => {
    selection.edgeCompat = checked;
    persistSelection();
    emit();
  };
  const onGroupChange = (e) => {
    selection.rotationGroupId = e.target.value;
    if (selection.rotationEnabled) {
      const first = rotationCandidates()[0];
      if (first) applySelection(first.id);
      else applySelection("");
      return;
    }
    persistSelection();
    syncRotationTimer();
    emit();
  };
  const onToggleRotation = () => {
    selection.rotationEnabled = !selection.rotationEnabled;
    if (selection.rotationEnabled) {
      if (!selection.rotationGroupId) {
        const usable = firstUsableGroup();
        if (usable) selection.rotationGroupId = usable.id;
      }
      if (!rotationCandidates().some((w) => w.id === selection.id)) {
        const first = rotationCandidates()[0];
        if (first) {
          applySelection(first.id);
          return;
        }
      }
    }
    persistSelection();
    syncRotationTimer();
    emit();
  };
  // Per-group interval: writes straight into the active group so each rotation
  // list keeps its own switch cadence.
  const onGroupInterval = (e) => {
    const group = activeRotationGroup();
    if (!group) return;
    group.interval = clampNum(Number(e.target.value), 1, 1440, DEFAULTS.rotationInterval);
    persistSelection();
    syncRotationTimer();
    emit();
  };
  const onDeleteGroup = () => {
    const group = activeRotationGroup();
    if (!group) return;
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      if (!window.confirm("删除轮播列表「" + group.name + "」？")) return;
    }
    deleteGroup(group.id);
  };

  // Slider callbacks: keep the stored value in its canonical unit, then emit —
  // applyEffects is a subscribed listener (see apply()), so emit() applies the
  // CSS vars synchronously AND re-renders the numeric readouts in one pass.
  // (Calling applyEffects directly here too used to double-apply every tick.)
  const onScrim = (pct) => { selection.scrim = pct / 100; persistSelection(); emit(); };
  const onBorder = (pct) => { selection.border = pct / 100; persistSelection(); emit(); };
  const onBlur = (px) => { selection.blur = px; persistSelection(); emit(); };
  const onWallpaperBlur = (px) => { selection.wallpaperBlur = px; persistSelection(); emit(); };
  // 配色 (accent color) + 玻璃透明度 (glass transparency) + 玻璃颜色 (glass base
  // tint): applied instantly through applyEffects() (--we-accent /
  // --we-glass-alpha / --we-glass-color), persisted so the settings page keeps
  // its custom look across reloads.
  const onAccent = (hex) => {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
    selection.accent = hex;
    persistSelection(); emit();
  };
  const onGlassColor = (hex) => {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
    selection.glassColor = hex;
    persistSelection(); emit();
  };
  const onGlassAlpha = (pct) => {
    selection.glassAlpha = clampNum(pct, 0, 60, DEFAULTS.glassAlpha);
    persistSelection(); emit();
  };
  // 侧栏玻璃（dsh-better-sidebar）：独立于会话玻璃的一套细粒度控制，各自立即
  // 生效并持久化（--we-sidebar-blur / --we-sidebar-alpha / --we-sidebar-color）。
  const onSidebarBlur = (px) => {
    selection.sidebarBlur = clampNum(px, 0, 60, DEFAULTS.sidebarBlur);
    persistSelection(); emit();
  };
  const onSidebarAlpha = (pct) => {
    selection.sidebarAlpha = clampNum(pct, 0, 60, DEFAULTS.sidebarAlpha);
    persistSelection(); emit();
  };
  const onSidebarColor = (hex) => {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
    selection.sidebarColor = hex;
    persistSelection(); emit();
  };

  // Close the picker modal (ESC / backdrop / close buttons share this path).
  const closePicker = () => {
    selection.pickerOpen = false;
    selection.batchMode = false;
    selection.batchSelected = [];
    emit();
    // Focus restore: return focus to the「选择壁纸」button that opened the
    // modal (WCAG focus management for dialogs).
    if (pickerOpener && pickerOpener.isConnected) {
      try { pickerOpener.focus(); } catch { /* ignore */ }
    }
  };
  // ESC anywhere closes the modal. Capture phase + stopPropagation so the
  // shell's own ESC handling (which may close the whole settings panel) never
  // sees the key while our modal is open.
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && selection.pickerOpen) {
        e.stopPropagation();
        closePicker();
      }
    };
    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("keydown", onKey, true);
      return () => { window.removeEventListener("keydown", onKey, true); };
    }
  }, []);
  // Scroll lock: while the modal is open the settings page behind it must not
  // scroll (wheel over the modal would otherwise move the background).
  React.useEffect(() => {
    if (!sel.pickerOpen || typeof document === "undefined") return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [sel.pickerOpen]);

  if (!sel.loaded) {
    return React.createElement("div", { className: "we-picker" },
      React.createElement("span", { className: "we-picker__hint" }, "扫描 Wallpaper Engine…"));
  }
  if (sel.inventory.error) {
    return React.createElement("div", { className: "we-picker" },
      React.createElement("div", { className: "we-picker__error" },
        "未检测到 Wallpaper Engine：" + sel.inventory.error),
      React.createElement("button", {
        className: "we-picker__btn", type: "button", onClick: onRefresh, disabled: sel.loading,
      }, sel.loading ? "刷新中…" : "重试"));
  }

  const list = sel.inventory.wallpapers;
  // Title search (picker modal): narrows the playable grid on top of the
  // rating/type filters. Case-insensitive substring match.
  const query = (sel.search || "").trim().toLowerCase();
  // Only playable Video/Web/Image wallpapers are shown — Scene/Application
  // cannot be embedded in the web UI, so hiding them keeps the grid useful.
  // Hidden (soft-deleted) wallpapers leave this list and move to the 已隐藏
  // section. The rating/type filters further narrow playableList.
  const playableList = list.filter((w) =>
    isRotatableWallpaper(w) && !isHiddenWallpaper(w.id)
    && (!query || String(w.title || "").toLowerCase().indexOf(query) !== -1));
  // Per-category counts for the two filter dropdowns (playable, non-hidden):
  // they reflect what is actually available, independent of the active filters.
  const basePlayable = list.filter((w) => isPlayableType(w) && !isHiddenWallpaper(w.id));
  // Single-pass aggregation — used to be 10 separate O(n) filters per render
  // (5 rating options + 5 type options, each a full basePlayable scan).
  const ratingCounts = { everyone: 0, pg13: 0, mature: 0, unrated: 0 };
  const typeCounts = { video: 0, web: 0, image: 0, scene: 0 };
  for (const w of basePlayable) {
    const r = ratingOf(w);
    ratingCounts[r] = (ratingCounts[r] || 0) + 1;
    typeCounts[w.type] = (typeCounts[w.type] || 0) + 1;
  }
  // CD-rack mode: compact one-page grid (no pagination) + stronger overlap.
  const cdMode = sel.pickerLayout === "classic";
  const hiddenList = hiddenInventoryList();
  const current = list.find((w) => w.id === sel.id) || null;
  const uploadedList = list.filter(isUploadedWallpaper);
  const groups = sel.rotationGroups;
  const group = activeRotationGroup();
  const candidates = rotationCandidates();
  const playableCount = candidates.length;
  const editing = sel.editing;
  const INTERVALS = [1, 5, 10, 30, 60, 120];

  // ── Pagination: big libraries must not render every card at once (hundreds
  //    of thumbnails per emit make the picker lag). Each list slices to one
  //    page of PAGE_SIZE cards; the page number clamps automatically when the
  //    list shrinks (hide/restore/refresh). ──
  const PAGE_SIZE = 24;
  function pageSlice(list, page) {
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    const p = Math.min(Math.max(0, page | 0), pages - 1);
    return { items: list.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE), page: p, pages };
  }
  const normalPage = pageSlice(playableList, sel.page);
  const hiddenPageView = pageSlice(hiddenList, sel.hiddenPage);
  const editorPageView = pageSlice(playableInventory(), sel.editorPage);
  const pagerRow = (count, page, pages, onPrev, onNext) =>
    React.createElement("div", { className: "we-picker__pager" },
      React.createElement("span", { className: "we-picker__hint" },
        "共 " + count + " 个 · 第 " + (page + 1) + " / " + pages + " 页"),
      React.createElement("button", {
        className: "we-picker__btn", type: "button",
        disabled: page <= 0,
        onClick: onPrev,
      }, "‹ 上一页"),
      React.createElement("button", {
        className: "we-picker__btn", type: "button",
        disabled: page >= pages - 1,
        onClick: onNext,
      }, "下一页 ›"),
    );

  return React.createElement("div", { className: "we-picker", "data-we-cards": sel.pickerLayout },
    // ── Card header (mirrors the skin-center's pluginCard header): plugin
    //    name + live wallpaper count badge + description. ──
    React.createElement("div", { className: "we-picker__card-head" },
      React.createElement("span", { className: "we-picker__card-name" }, "Wallpaper Engine"),
      React.createElement("span", { className: "we-picker__card-badge" }, String(playableList.length)),
      React.createElement("span", { className: "we-picker__card-desc" }, "本地 Wallpaper Engine 壁纸 · 液态玻璃主题"),
    ),
    // ── 外观 (liquid-glass theming): 配色 presets + custom color, and the
    //    glass 透明度 slider. Applied instantly via --we-accent /
    //    --we-glass-alpha (applyEffects), persisted in localStorage. ──
    React.createElement("div", { className: "we-picker__section" },
      React.createElement("div", { className: "we-picker__section-head" },
        React.createElement("span", { className: "we-picker__section-label" }, "外观"),
      ),
      React.createElement("div", { className: "we-picker__row we-picker__accent-row" },
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, "配色"),
        ACCENT_PRESETS.map((hex) => React.createElement("button", {
          key: hex,
          className: "we-picker__swatch" + (sel.accent === hex ? " we-picker__swatch--active" : ""),
          type: "button",
          style: { background: hex },
          title: hex,
          onClick: () => onAccent(hex),
          "aria-label": "配色 " + hex,
        })),
        React.createElement("label", { className: "we-picker__swatch-custom" },
          React.createElement("input", {
            type: "color",
            value: sel.accent,
            onInput: (e) => onAccent(e.target.value),
            onChange: (e) => onAccent(e.target.value),
            title: "自定义配色",
          }),
          React.createElement("span", { className: "we-picker__hint" }, "自定义"),
        ),
      ),
      // 玻璃颜色: the settings-window glass BASE tint. Defaults keep the stock
      // look (white light / deep navy dark); picking any preset or a custom
      // color tints the whole window glass in BOTH themes.
      React.createElement("div", { className: "we-picker__row we-picker__accent-row" },
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, "玻璃颜色"),
        GLASS_COLOR_PRESETS.map((hex) => React.createElement("button", {
          key: hex,
          className: "we-picker__swatch" + (sel.glassColor === hex ? " we-picker__swatch--active" : ""),
          type: "button",
          style: { background: hex },
          title: hex,
          onClick: () => onGlassColor(hex),
          "aria-label": "玻璃颜色 " + hex,
        })),
        React.createElement("label", { className: "we-picker__swatch-custom" },
          React.createElement("input", {
            type: "color",
            value: sel.glassColor,
            onInput: (e) => onGlassColor(e.target.value),
            onChange: (e) => onGlassColor(e.target.value),
            title: "自定义玻璃颜色",
          }),
          React.createElement("span", { className: "we-picker__hint" }, "自定义"),
        ),
      ),
      SliderRow("玻璃透明度", 0, 60, 5, sel.glassAlpha, onGlassAlpha, sel.glassAlpha + "%"),
      // 设置窗口液态玻璃 master switch: turns the WHOLE native settings window
      // (nav + every native section, not just this page) into liquid glass with
      // the accent + transparency above; off restores the stock shell look.
      React.createElement("label", { className: "we-picker__rotation-toggle we-picker__window-toggle" },
        React.createElement("input", {
          type: "checkbox",
          checked: sel.glassWindow,
          onChange: (e) => {
            selection.glassWindow = e.target.checked;
            persistSelection();
            emit();
          },
        }),
        "设置窗口液态玻璃",
      ),
      React.createElement("span", { className: "we-picker__hint" },
        "整个设置窗口（含 General / 模型 / 插件等全部原生分区）跟随配色与透明度；关闭则恢复原生样式",
      ),
      // 侧栏玻璃（dsh-better-sidebar 适配）：与设置窗口玻璃同级的一套独立细粒度
      // 控制 —— 总开关 + 专用模糊 + 专用透明度 + 玻璃基底色调，全部只作用于
      // dsh-better-sidebar 子树，不动会话玻璃（玻璃 / 玻璃透明度）的设置。
      // 仅在 host 检测到 dsh-better-sidebar 已安装且启用时显示（sidebarPresent）。
      // 开关本体 + 说明始终显示；三个细节滑块（侧栏模糊 / 侧栏透明度 / 侧栏玻璃
      // 颜色）以「侧栏液态玻璃」开关为前提 —— 关闭时隐藏，开启后随 emit 重渲染
      // 实时出现（滑块只在毛玻璃生效时有意义）。
      sel.sidebarPresent && [
      React.createElement("label", { key: "sidebar-glass-toggle", className: "we-picker__rotation-toggle we-picker__window-toggle" },
        React.createElement("input", {
          type: "checkbox",
          checked: sel.sidebarGlass,
          onChange: (e) => {
            selection.sidebarGlass = e.target.checked;
            persistSelection();
            emit();
          },
        }),
        "侧栏液态玻璃",
      ),
      React.createElement("span", { key: "sidebar-glass-hint", className: "we-picker__hint" },
        "dsh-better-sidebar 侧栏（文件 / 终端 / Git 等面板）的毛玻璃适配；关闭则恢复其原生外观",
      ),
      ],
      sel.sidebarPresent && sel.sidebarGlass && [
      SliderRow("侧栏模糊", 0, 60, 1, sel.sidebarBlur, onSidebarBlur, sel.sidebarBlur + "px", "sb-blur"),
      SliderRow("侧栏透明度", 0, 60, 5, sel.sidebarAlpha, onSidebarAlpha, sel.sidebarAlpha + "%", "sb-alpha"),
      React.createElement("div", { key: "sb-color", className: "we-picker__row we-picker__accent-row" },
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, "侧栏玻璃颜色"),
        GLASS_COLOR_PRESETS.map((hex) => React.createElement("button", {
          key: hex,
          className: "we-picker__swatch" + (sel.sidebarColor === hex ? " we-picker__swatch--active" : ""),
          type: "button",
          style: { background: hex },
          title: hex,
          onClick: () => onSidebarColor(hex),
          "aria-label": "侧栏玻璃颜色 " + hex,
        })),
        React.createElement("label", { className: "we-picker__swatch-custom" },
          React.createElement("input", {
            type: "color",
            value: sel.sidebarColor,
            onInput: (e) => onSidebarColor(e.target.value),
            onChange: (e) => onSidebarColor(e.target.value),
            title: "自定义侧栏玻璃颜色",
          }),
          React.createElement("span", { className: "we-picker__hint" }, "自定义"),
        ),
      ),
      ],
    ),
    // ── Card-style switch: classic (WE's original aspect-ratio 16/9 cards —
    //    the CD-like look the author liked) vs the rewritten fixed-height
    //    cards that never overlap in older browsers. The vinyl record beside
    //    the selection stays in BOTH styles (here + modal head). ──
    React.createElement("div", { className: "we-picker__row" },
      React.createElement("span", { className: "we-picker__hint we-picker__label" }, "紧凑布局"),
      React.createElement("label", { className: "we-picker__switch", title: "紧凑 CD 架：层叠 + 一页到底" },
        React.createElement("input", {
          type: "checkbox",
          checked: sel.pickerLayout === "classic",
          onChange: (e) => onLayoutChange(e.target.checked ? "classic" : "fixed"),
        }),
        React.createElement("span", { className: "we-picker__switch-track" },
          React.createElement("span", { className: "we-picker__switch-thumb" }),
        ),
      ),
      React.createElement("span", { className: "we-picker__hint" },
        sel.pickerLayout === "classic"
          ? "CD 架：层叠 + 一页到底"
          : "常规网格 · 分页"),
      // Edge 兼容渲染开关：与"紧凑布局"同一行、靠右。仅在 Edge 中生效
      // （canvas 渲染，避免浏览器自带的「下载 / 投屏」悬浮工具栏）。
      React.createElement("label", {
        className: "we-picker__switch we-picker__switch--edge",
        // 关键布局用内联样式而非插件 CSS：插件样式表按 TAG_ID 去重注入，
        // 页面若残留旧样式表，新 CSS 规则不会生效（开关会靠左 / 不居中 /
        // 字号不同）。内联样式始终生效，与样式表注入状态无关。
        style: { marginLeft: "auto", alignItems: "center", gap: "6px", fontSize: "inherit" },
        title: "Edge 兼容：视频壁纸改用 canvas 渲染，避免浏览器自带的「下载 / 投屏」悬浮工具栏；关闭则始终使用原生 <video>",
      },
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, "Edge 兼容"),
        React.createElement("input", {
          type: "checkbox",
          checked: sel.edgeCompat !== false,
          onChange: (e) => onEdgeCompatChange(e.target.checked),
        }),
        React.createElement("span", { className: "we-picker__switch-track" },
          React.createElement("span", { className: "we-picker__switch-thumb" }),
        ),
      ),
    ),
    // ── 当前壁纸: vinyl record beside the selection, in both card styles. ──
    React.createElement("div", { className: "we-picker__section" },
      React.createElement("div", { className: "we-picker__current" },
        React.createElement(VinylRecord, {
          cover: current && current.preview, title: current ? current.title : "",
          playing: sel.playing && Boolean(sel.url),
        }),
        React.createElement("div", { className: "we-picker__current-info" },
          React.createElement("div", { className: "we-picker__current-title", title: current ? current.title : "" },
            sel.id && current ? current.title : "未选择壁纸"),
          React.createElement("div", { className: "we-picker__current-meta" },
            current
              ? ({ video: "视频壁纸", web: "网页壁纸", image: "图片壁纸", scene: "场景壁纸（静态帧）" }[current.type] || "壁纸") + (sel.playing ? " · 播放中" : " · 已暂停")
              : "尚未选择壁纸"),
        ),
        React.createElement("button", {
          className: "we-picker__btn we-picker__btn--primary", type: "button",
          ref: (el) => { pickerOpener = el; },
          onClick: () => {
            selection.pickerOpen = true;
            selection.modalView = "normal";
            pickerFocusPending = true; // 打开后焦点落入模态框（见 modalInitialFocus）
            emit();
          },
        }, "选择壁纸"),
      ),
    // ── Wallpaper picker modal. Portalled onto <body>: fixed positioning is
    //    immune to ancestor transforms/backdrop-filters (the shell's own glass
    //    effects would otherwise trap it), and z-index 1000 sits above the
    //    shell overlays. Close: ESC, backdrop click, or the close buttons. ──
    sel.pickerOpen && (isRepoPanelCopy || !repoPanelOwnsModal) && ReactDOM.createPortal(
      // repoPanel path: the picker opens as its own right-quarter liquid-glass
      // window (same recipe as the repo panel), NOT the centred dark dialog that
      // the settings copy uses. The scrim is a transparent full-screen click
      // catcher (no dark dim/blur) so picking stays visually continuous.
      React.createElement("div", { className: isRepoPanelCopy ? "we-repo-panel__modal-scrim" : "we-picker__modal-overlay", onClick: closePicker },
        React.createElement("div", {
          className: isRepoPanelCopy ? "we-picker__modal we-picker__modal--panel" : "we-picker__modal",
          "data-we-cards": sel.pickerLayout,
          role: "dialog",
          "aria-modal": "true",
          "aria-label": "选择壁纸",
          onClick: (e) => e.stopPropagation(),
          onKeyDown: trapModalTab,
        },
          React.createElement("div", { className: "we-picker__modal-head" },
            React.createElement("div", { className: "we-picker__modal-head-left" },
              React.createElement(VinylRecord, {
                cover: current && current.preview, title: current ? current.title : "",
                playing: sel.playing && Boolean(sel.url), sm: true,
              }),
              React.createElement("span", { className: "we-picker__modal-title" }, "选择壁纸"),
            ),
            React.createElement("button", {
              className: "we-picker__btn", type: "button", onClick: closePicker,
              // 打开模态框时焦点落在这里（一次性，见 modalInitialFocus）。
              ref: modalInitialFocus,
            }, "关闭"),
          ),
          React.createElement("div", { className: "we-picker__modal-tabs", role: "tablist" },
            React.createElement("button", {
              className: "we-picker__btn we-picker__tab" + (sel.modalView === "hidden" ? "" : " we-picker__tab--active"),
              type: "button",
              role: "tab",
              "aria-selected": sel.modalView !== "hidden",
              onClick: () => { selection.modalView = "normal"; emit(); },
            }, "正常列表（" + playableList.length + "）"),
            React.createElement("button", {
              className: "we-picker__btn we-picker__tab" + (sel.modalView === "hidden" ? " we-picker__tab--active" : ""),
              type: "button",
              role: "tab",
              "aria-selected": sel.modalView === "hidden",
              onClick: () => { selection.modalView = "hidden"; selection.batchMode = false; selection.batchSelected = []; emit(); },
            }, "已隐藏（" + hiddenList.length + "）"),
          ),
          sel.modalView === "hidden"
            ? React.createElement("div", { className: "we-picker__modal-body" },
                hiddenList.length === 0
                  ? React.createElement("span", { className: "we-picker__hint" }, "没有已隐藏的壁纸")
                  : React.createElement("div", { className: "we-picker__grid" },
                      React.createElement("div", { className: "we-picker__row" },
                        React.createElement("span", { className: "we-picker__hint" },
                          "已隐藏 " + hiddenList.length + " 张（仅从列表隐藏，不删除源文件）"),
                        React.createElement("button", {
                          className: "we-picker__btn", type: "button",
                          onClick: () => {
                            if (!window.confirm("恢复全部 " + hiddenList.length + " 张已隐藏壁纸？")) return;
                            restoreWallpapers(hiddenList.map((w) => w.id));
                          },
                        }, "全部恢复"),
                      ),
                      (cdMode ? hiddenList : hiddenPageView.items).map((w) => React.createElement("div", {
                        key: w.id,
                        className: "we-picker__card we-picker__card--hidden",
                        role: "button",
                        tabIndex: 0,
                        title: w.title,
                        "aria-label": "恢复并应用 " + w.title,
                        onClick: () => applySelection(w.id),
                        // 键盘可达性：正常列表卡片一直有 Enter/Space 处理，
                        // 已隐藏卡片漏了 —— 补上（共享 cardKeyDown）。
                        onKeyDown: cardKeyDown,
                      },
                      w.preview
                        ? React.createElement("img", {
                            src: w.preview, alt: w.title, loading: "lazy",
                            onError: (e) => { e.target.style.display = "none"; },
                            onLoad: (e) => { e.target.style.opacity = "1"; },
                          })
                        : React.createElement("span", { className: "we-picker__card-placeholder" }, "无预览"),
                      React.createElement("span", { className: "we-picker__card-title" }, w.title),
                      w.type === "scene" && React.createElement("span", { className: "we-picker__card-badge" }, "静态帧"),
                      React.createElement("button", {
                        className: "we-picker__card-hide", type: "button",
                        title: "恢复此壁纸",
                        onClick: (e) => { e.stopPropagation(); restoreWallpapers([w.id]); },
                      }, "恢复"),
                      )),
                    ),
                    !cdMode && hiddenPageView.pages > 1 && pagerRow(
                      hiddenList.length, hiddenPageView.page, hiddenPageView.pages,
                      () => { selection.hiddenPage--; emit(); },
                      () => { selection.hiddenPage++; emit(); },
                    ),
              )
            : React.createElement("div", { className: "we-picker__modal-body" },
                React.createElement("div", { className: "we-picker__row" },
                  React.createElement("span", { className: "we-picker__hint" },
                    playableList.length + " 个可播放壁纸 · 点击卡片即应用"),
                  React.createElement("button", {
                    className: "we-picker__btn", type: "button",
                    onClick: () => { selection.batchMode = !selection.batchMode; selection.batchSelected = []; emit(); },
                    disabled: playableList.length === 0,
                    title: "多选后批量隐藏",
                  }, selection.batchMode ? "退出批量" : "批量"),
                ),
                selection.batchMode && React.createElement("div", { className: "we-picker__row we-picker__batch-bar" },
                  React.createElement("span", { className: "we-picker__hint" }, "已选 " + selection.batchSelected.length + " 张"),
                  React.createElement("button", {
                    className: "we-picker__btn", type: "button",
                    disabled: selection.batchSelected.length === 0,
                    onClick: () => {
                      const n = selection.batchSelected.length;
                      if (!window.confirm("隐藏选中的 " + n + " 张壁纸？可在「已隐藏」中随时恢复。")) return;
                      hideWallpapers(selection.batchSelected.slice());
                      selection.batchMode = false;
                      selection.batchSelected = [];
                      emit();
                    },
                  }, "批量隐藏"),
                  React.createElement("button", {
                    className: "we-picker__btn", type: "button",
                    onClick: () => { selection.batchMode = false; selection.batchSelected = []; emit(); },
                  }, "取消"),
                ),
                React.createElement("div", { className: "we-picker__row we-picker__filter-row" },
                  // 标题搜索：几百上千张壁纸时最快的定位方式。输入即过滤
                  // （重置到第 1 页），与分级/类型过滤叠加。
                  React.createElement("input", {
                    className: "we-picker__text we-picker__search", type: "text",
                    value: sel.search,
                    placeholder: "搜索壁纸标题…",
                    "aria-label": "搜索壁纸标题",
                    onInput: (e) => { selection.search = e.target.value; selection.page = 0; emit(); },
                  }),
                  React.createElement("span", { className: "we-picker__hint we-picker__label" }, "内容分级"),
                  React.createElement("select", {
                    className: "we-picker__playlist-select",
                    value: sel.contentRatingFilter,
                    onChange: onRatingFilterChange,
                    "aria-label": "内容分级",
                    title: "对应 Wallpaper Engine 的内容分级（project.json contentrating）",
                  },
                  React.createElement("option", { value: "all" }, "全部（" + basePlayable.length + "）"),
                  React.createElement("option", { value: "everyone" }, "Everyone / G（" + ratingCounts.everyone + "）"),
                  React.createElement("option", { value: "pg13" }, "PG13（" + ratingCounts.pg13 + "）"),
                  React.createElement("option", { value: "mature" }, "Mature / R（" + ratingCounts.mature + "）"),
                  React.createElement("option", { value: "unrated" }, "未分级（" + ratingCounts.unrated + "）"),
                  ),
                  React.createElement("span", { className: "we-picker__hint we-picker__label" }, "类型"),
                  React.createElement("select", {
                    className: "we-picker__playlist-select",
                    value: sel.typeFilter,
                    onChange: onTypeFilterChange,
                    "aria-label": "类型",
                    title: "按壁纸类型过滤",
                  },
                  React.createElement("option", { value: "all" }, "全部（" + basePlayable.length + "）"),
                  React.createElement("option", { value: "video" }, "视频（" + (typeCounts.video || 0) + "）"),
                  React.createElement("option", { value: "web" }, "网页（" + (typeCounts.web || 0) + "）"),
                  React.createElement("option", { value: "image" }, "图片（" + (typeCounts.image || 0) + "）"),
                  React.createElement("option", { value: "scene" }, "场景（" + (typeCounts.scene || 0) + "）"),
                  ),
                ),
                React.createElement("div", { className: "we-picker__grid" },
                  // "Close wallpaper" card — equivalent of the old first <option>.
                  // Rendered as a <div role="button"> like every other card:
                  // <button> ignores aspect-ratio in several browsers, which
                  // collapses the cell and lets the "✕ 关闭" label float over
                  // the adjacent thumbnail.
                  React.createElement("div", {
                    className: "we-picker__card" + (sel.id ? "" : " we-picker__card--selected"),
                    role: "button",
                    tabIndex: 0,
                    onClick: onClear,
                    title: "关闭壁纸",
                    onKeyDown: cardKeyDown,
                  },
                  React.createElement("span", { className: "we-picker__card-close" }, "✕ 关闭"),
                  ),
                  playableList.length === 0
                    ? React.createElement("span", { className: "we-picker__hint" },
                        query
                          ? "没有匹配「" + sel.search + "」的壁纸 · 试试缩短关键词或清除过滤"
                          : "没有可播放的壁纸")
                    : (cdMode ? playableList : normalPage.items).map((w) => React.createElement("div", {
                        key: w.id,
                        className: "we-picker__card" + (w.id === sel.id ? " we-picker__card--selected" : "")
                          // 批量勾选高亮：此前勾选态只进了 batchSelected，高亮 CSS
                          // 却挂在 --selected（=当前播放）上，勾了永远不亮。
                          + (selection.batchMode && selection.batchSelected.indexOf(w.id) >= 0 ? " we-picker__card--checked" : ""),
                        role: "button",
                        tabIndex: 0,
                        title: w.title,
                        onClick: () => {
                          if (selection.batchMode) {
                            const i = selection.batchSelected.indexOf(w.id);
                            if (i >= 0) selection.batchSelected.splice(i, 1);
                            else selection.batchSelected.push(w.id);
                            emit();
                          } else {
                            applySelection(w.id);
                          }
                        },
                        onKeyDown: cardKeyDown,
                      },
                      w.preview
                        ? React.createElement("img", {
                            src: w.preview, alt: w.title, loading: "lazy",
                            onError: (e) => { e.target.style.display = "none"; },
                            onLoad: (e) => { e.target.style.opacity = "1"; },
                          })
                        : React.createElement("span", { className: "we-picker__card-placeholder" }, "无预览"),
                      React.createElement("span", { className: "we-picker__card-title" }, w.title),
                      w.type === "scene" && React.createElement("span", { className: "we-picker__card-badge" }, "静态帧"),
                      selection.batchMode
                        ? React.createElement("span", { className: "we-picker__card-check" },
                            selection.batchSelected.indexOf(w.id) >= 0 ? "✓" : "")
                        : React.createElement("button", {
                            className: "we-picker__card-hide", type: "button",
                            title: "隐藏此壁纸（可在「已隐藏」中恢复）",
                            onClick: (e) => { e.stopPropagation(); hideWallpapers([w.id]); },
                          }, "隐藏"),
                      )),
                ),
                !cdMode && normalPage.pages > 1 && pagerRow(
                  playableList.length, normalPage.page, normalPage.pages,
                  () => { selection.page--; emit(); },
                  () => { selection.page++; emit(); },
                ),
              ),
          React.createElement("div", { className: "we-picker__modal-foot" },
            React.createElement("span", { className: "we-picker__hint" }, "ESC / 点击遮罩关闭"),
            React.createElement("button", {
              className: "we-picker__btn", type: "button", onClick: closePicker,
            }, "关闭"),
          ),
        ),
      ),
      document.body,
    ),
    // ── Playback controls (wallpaper-independent; the thumbnail grid lives in
    //    the modal above, so these stay within reach). ──
    React.createElement("div", { className: "we-picker__row" },
      React.createElement("button", {
        className: "we-picker__btn", type: "button",
        onClick: onTogglePlay, disabled: !sel.url,
      }, sel.playing ? "暂停" : "播放"),
      React.createElement("button", {
        className: "we-picker__btn", type: "button",
        onClick: onClear, disabled: !sel.id,
      }, "关闭"),
      React.createElement("button", {
        className: "we-picker__btn", type: "button",
        onClick: onRefresh, disabled: sel.loading,
      }, sel.loading ? "刷新中…" : "刷新"),
    ),
    ),
    // ── 自定义壁纸: local JPG/PNG/MP4 as wallpapers. Files are written by the
    //    host into its plugin-managed directory and served through the same
    //    media/preview routes (read-A storage: survives restarts, no quota
    //    limits). Uploads merge into the inventory on the host side. ──
    React.createElement("div", { className: "we-picker__section" },
      React.createElement("div", { className: "we-picker__section-head" },
        React.createElement("span", { className: "we-picker__section-label" }, "自定义壁纸"),
      ),
      React.createElement("div", { className: "we-picker__uploads" },
      // Storage location — users can point uploads at a non-system drive
      // (most people don't want wallpaper files piling up on C:). The host
      // persists the choice and migrates existing files on change.
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, "存储位置"),
        React.createElement("span", {
          className: "we-picker__uploads-path",
        }, sel.inventory.uploadDir || "—"),
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          disabled: sel.uploading,
          onClick: () => {
            selection.editingUploadDir = true;
            selection.uploadDirDraft = sel.inventory.uploadDir || "";
            emit();
          },
        }, "更改"),
      ),
      sel.editingUploadDir && React.createElement("div", { className: "we-picker__row" },
        React.createElement("input", {
          className: "we-picker__text", type: "text",
          value: selection.uploadDirDraft,
          placeholder: "绝对路径，如 D:\\MyWallpapers",
          onInput: (e) => { selection.uploadDirDraft = e.target.value; emit(); },
          onKeyDown: (e) => {
            if (e.key === "Enter") changeUploadDir(selection.uploadDirDraft, true);
            if (e.key === "Escape") { selection.editingUploadDir = false; emit(); }
          },
        }),
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          disabled: sel.uploading,
          onClick: () => changeUploadDir(selection.uploadDirDraft, true),
        }, "保存"),
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: () => { selection.editingUploadDir = false; emit(); },
        }, "取消"),
      ),
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint" },
          "已有文件会迁移到新位置"),
        React.createElement("span", { className: "we-picker__hint" },
          "支持 ~ 表示用户主目录"),
      ),
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, "自定义"),
        React.createElement("input", {
          className: "we-picker__file", type: "file",
          accept: ".jpg,.jpeg,.png,.mp4",
          disabled: sel.uploading,
          onChange: (e) => {
            const f = e.target.files && e.target.files[0];
            if (f) uploadWallpaperFile(f);
            e.target.value = "";
          },
        }),
        sel.uploading && React.createElement("span", { className: "we-picker__hint" }, "上传中…"),
      ),
      sel.uploadError && React.createElement("div", { className: "we-picker__error" }, sel.uploadError),
      sel.uploadNote && React.createElement("div", { className: "we-picker__note" }, sel.uploadNote),
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint" }, "已上传 " + uploadedList.length + " 个"),
        React.createElement("span", { className: "we-picker__hint" }, "格式仅限 JPG / PNG / MP4"),
      ),
      uploadedList.length > 0 && React.createElement("div", { className: "we-picker__uploads-list" },
        uploadedList.map((w) => React.createElement("div", { key: w.id, className: "we-picker__uploads-item" },
          React.createElement("span", { className: "we-picker__uploads-name", title: w.title }, w.title),
          React.createElement("span", { className: "we-picker__hint" }, w.type === "video" ? "MP4" : "图片"),
          React.createElement("button", {
            className: "we-picker__btn", type: "button",
            disabled: sel.uploading,
            onClick: () => {
              if (!window.confirm("移除自定义壁纸「" + w.title + "」？此操作会删除本地文件，且不可恢复。")) return;
              removeUploadWallpaper(w.id);
            },
          }, "移除"),
        )),
      ),
      ),
    ),
    // ── 轮播列表: user-defined carousel lists, each with its own wallpaper
    //    set, interval and order. Fully client-side (localStorage). ──
    React.createElement("div", { className: "we-picker__section" },
      React.createElement("div", { className: "we-picker__section-head" },
        React.createElement("span", { className: "we-picker__section-label" }, "轮播列表"),
      ),
      React.createElement("div", { className: "we-picker__row we-picker__playlist-row" },
      React.createElement("select", {
        className: "we-picker__playlist-select",
        value: sel.rotationGroupId,
        onChange: onGroupChange,
        disabled: groups.length === 0,
        "aria-label": "轮播列表",
      },
      React.createElement("option", { value: "" }, groups.length ? "— 选择轮播列表 —" : "— 暂无轮播列表 —"),
      ...groups.map((g) => React.createElement("option", {
        key: g.id, value: g.id,
      }, g.name + "（" + groupWallpapers(g).length + " 可播放 · " + g.interval + " 分钟）")),
      ),
      React.createElement("button", {
        className: "we-picker__btn", type: "button",
        onClick: startCreateGroup,
      }, "新建"),
      React.createElement("button", {
        className: "we-picker__btn", type: "button",
        onClick: () => startEditGroup(sel.rotationGroupId),
        disabled: !sel.rotationGroupId,
      }, "编辑"),
      React.createElement("button", {
        className: "we-picker__btn", type: "button",
        onClick: onDeleteGroup,
        disabled: !sel.rotationGroupId,
      }, "删除"),
    ),
    editing && React.createElement("div", { className: "we-picker__editor" },
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, "名称"),
        React.createElement("input", {
          className: "we-picker__text", type: "text",
          value: editing.name,
          "aria-label": "轮播列表名称",
          onInput: (e) => { editing.name = e.target.value; emit(); },
        }),
      ),
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, "间隔"),
        React.createElement("select", {
          className: "we-picker__rotation-interval",
          value: String(editing.interval),
          onChange: (e) => { editing.interval = clampNum(Number(e.target.value), 1, 1440, DEFAULTS.rotationInterval); emit(); },
          "aria-label": "轮播间隔",
        },
        ...INTERVALS.map((minutes) =>
          React.createElement("option", { key: minutes, value: String(minutes) }, minutes + " 分钟"),
        )),
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, "顺序"),
        React.createElement("select", {
          className: "we-picker__playlist-select",
          value: editing.order,
          onChange: (e) => { editing.order = e.target.value; emit(); },
          "aria-label": "轮播顺序",
        },
        React.createElement("option", { value: "sequence" }, "顺序"),
        React.createElement("option", { value: "random" }, "随机"),
        ),
      ),
      React.createElement("div", { className: "we-picker__editor-grid" },
        playableInventory().length === 0
          ? React.createElement("span", { className: "we-picker__hint" }, "没有可播放的壁纸")
          : (cdMode ? playableInventory() : editorPageView.items).map((w) => {
              const checked = editing.wallpaperIds.indexOf(w.id) >= 0;
              return React.createElement("button", {
                key: w.id,
                className: "we-picker__editor-card" + (checked ? " we-picker__editor-card--checked" : ""),
                type: "button",
                title: w.title,
                "aria-pressed": checked,
                "aria-label": w.title,
                onClick: () => {
                  const i = editing.wallpaperIds.indexOf(w.id);
                  if (i >= 0) editing.wallpaperIds.splice(i, 1);
                  else editing.wallpaperIds.push(w.id);
                  emit();
                },
              },
              w.preview
                ? React.createElement("img", {
                    src: w.preview, alt: w.title, loading: "lazy",
                    onError: (e) => { e.target.style.display = "none"; },
                            onLoad: (e) => { e.target.style.opacity = "1"; },
                  })
                : React.createElement("span", { className: "we-picker__card-placeholder" }, "无预览"),
              checked && React.createElement("span", { className: "we-picker__editor-check" }, "✓"),
              );
            }),
      ),
      !cdMode && editorPageView.pages > 1 && pagerRow(
        playableInventory().length, editorPageView.page, editorPageView.pages,
        () => { selection.editorPage--; emit(); },
        () => { selection.editorPage++; emit(); },
      ),
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint" }, "已选 " + editing.wallpaperIds.length + " 个"),
        sel.inventory.playlists.length > 0 && React.createElement("select", {
          className: "we-picker__playlist-select",
          value: "",
          onChange: (e) => {
            const p = sel.inventory.playlists.find((pl) => pl.id === e.target.value);
            if (p) importPlaylistIntoDraft(p);
          },
        },
        React.createElement("option", { value: "" }, "从 WE 播放列表导入…"),
        ...sel.inventory.playlists.map((p) => React.createElement("option", {
          key: p.id, value: p.id,
        }, p.name + "（" + (p.portableCount || 0) + " 可播放）")),
        ),
      ),
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: saveEditingGroup,
        }, "保存"),
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: cancelEditGroup,
        }, "取消"),
      ),
    ),
    React.createElement("div", { className: "we-picker__row we-picker__rotation-row" },
      React.createElement("label", { className: "we-picker__rotation-toggle" },
        React.createElement("input", {
          type: "checkbox",
          checked: sel.rotationEnabled,
          onChange: onToggleRotation,
          disabled: !sel.rotationGroupId || playableCount < 2,
        }),
        "自动轮转",
      ),
      React.createElement("select", {
        className: "we-picker__rotation-interval",
        value: String(group ? group.interval : DEFAULTS.rotationInterval),
        onChange: onGroupInterval,
        disabled: !sel.rotationEnabled || !sel.rotationGroupId || playableCount < 2,
        "aria-label": "轮转间隔",
      },
      ...INTERVALS.map((minutes) =>
        React.createElement("option", { key: minutes, value: String(minutes) }, minutes + " 分钟"),
      )),
      !sel.rotationGroupId && React.createElement("span", { className: "we-picker__hint" }, "请先选择或新建一个轮播列表"),
      sel.rotationGroupId && playableCount < 2 && React.createElement("span", { className: "we-picker__hint" }, "当前列表至少需要 2 个可播放壁纸"),
    ),
    ),
    sel.id && React.createElement("div", { className: "we-picker__section" },
      React.createElement("div", { className: "we-picker__section-head" },
        React.createElement("span", { className: "we-picker__section-label" }, "壁纸效果"),
      ),
      React.createElement(React.Fragment, null,
      SliderRow("壁纸模糊", 0, 60, 1, sel.wallpaperBlur, onWallpaperBlur, sel.wallpaperBlur + "px"),
      SliderRow("暗化", 0, 90, 5, Math.round(sel.scrim * 100), onScrim, Math.round(sel.scrim * 100) + "%"),
      SliderRow("边框", 0, 90, 5, Math.round(sel.border * 100), onBorder, Math.round(sel.border * 100) + "%"),
      SliderRow("玻璃", 0, 60, 1, sel.blur, onBlur, sel.blur + "px"),
      // Playback speed — native playbackRate, instant, no media reload. Video
      // wallpapers only (web/iframe wallpapers have no playbackRate).
      sel.type === "video" && React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, "倍速"),
        [0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) =>
          React.createElement("button", {
            key: rate,
            className: "we-picker__btn we-picker__rate" + (sel.playbackRate === rate ? " we-picker__rate--active" : ""),
            type: "button",
            onClick: () => { selection.playbackRate = rate; persistSelection(); emit(); },
          }, String(rate).replace(/\.?0+$/, "") + "x"),
        ),
      ),
      // 解码帧率上限（抽帧转码）：host 一次性把源视频重编码为上限帧率（时间线
      // 1.0x 正常速度，解码占用随帧率线性下降），与倍速解耦。首次转码需等待，
      // 播放中原片、转好自动切换；无 ffmpeg 自动回退原片。
      sel.type === "video" && React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, "帧率上限"),
        FPS_CAP_VALUES.map((cap) =>
          React.createElement("button", {
            key: cap,
            className: "we-picker__btn we-picker__rate" + (sel.fpsCap === cap ? " we-picker__rate--active" : ""),
            type: "button",
            onClick: () => { selection.fpsCap = cap; persistSelection(); refreshMediaInfo(true); emit(); },
          }, cap === 0 ? "无限制" : cap + "fps"),
        ),
      ),
      // Source metadata + transcode status (host moov probe / transcode lifecycle).
      sel.type === "video" && sel.mediaInfo && React.createElement("span", { className: "we-picker__hint" },
        "源 " + sel.mediaInfo.width + "×" + sel.mediaInfo.height
          + (sel.mediaInfo.fps ? " · " + sel.mediaInfo.fps + "fps" : "")
          + (sel.mediaInfo.codec ? " · " + codecLabel(sel.mediaInfo.codec) : "")
          + (sel.transcodeState === "working" ? " · 抽帧准备中…"
            : sel.transcodeState === "ready" ? " · 已切换至 " + sel.fpsCap + "fps 抽帧版（正常速度，解码占用约减半）"
            : sel.transcodeState === "fallback" ? " · 转码不可用，已回退原片"
            : sel.transcodeState === "skipped" ? " · 源帧率 ≤ 上限，无需抽帧"
            : ""),
      ),
      // Download / transcode progress bar (polled from /transcode-progress).
      sel.type === "video" && sel.transcodeState === "working" && sel.transcodeProgress
        && React.createElement("div", { className: "we-picker__row we-picker__prog" },
          React.createElement("div", {
            className: "we-picker__prog-track",
            role: "progressbar",
            "aria-label": "转码进度",
            "aria-valuemin": 0,
            "aria-valuemax": 100,
            "aria-valuenow": Math.max(0, Math.min(100, sel.transcodeProgress.percent || 0)),
          },
            React.createElement("div", {
              className: "we-picker__prog-bar",
              style: { width: Math.max(2, Math.min(100, sel.transcodeProgress.percent || 0)) + "%" },
            }),
          ),
          React.createElement("span", { className: "we-picker__hint" },
            sel.transcodeProgress.phase === "download"
              ? "下载 ffmpeg " + (sel.transcodeProgress.percent || 0) + "%"
              : sel.transcodeProgress.phase === "transcode" && sel.transcodeProgress.finalizing ? "收尾中…"
              : sel.transcodeProgress.phase === "transcode"
                ? "转码中 " + (sel.transcodeProgress.percent || 0) + "%"
                  + (sel.transcodeProgress.eta ? " · 约剩 " + sel.transcodeProgress.eta + " 秒" : "")
              : sel.transcodeProgress.phase === "done" ? "即将完成…"
              : "准备中…",
          ),
        ),
      // Horizontal mirror — scaleX(-1), compositor-only; works for video,
      // web (iframe) and (later) uploaded image wallpapers alike.
      React.createElement("label", { className: "we-picker__rotation-toggle" },
        React.createElement("input", {
          type: "checkbox",
          checked: sel.flip,
          onChange: (e) => { selection.flip = e.target.checked; persistSelection(); emit(); },
        }),
        "水平翻转",
      ),
      // Fit mode — applies to the CURRENT wallpaper whatever its type (WE
      // video/scene image and custom uploads alike; web/iframe wallpapers
      // have no object-fit). 覆盖=cover 填充=contain 居中=center 拉伸=fill
      React.createElement("div", { className: "we-picker__row we-picker__fit-row" },
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, "适配"),
        ["cover", "contain", "center", "fill"].map((mode) => {
          const label = { cover: "覆盖", contain: "填充", center: "居中", fill: "拉伸" }[mode];
          return React.createElement("button", {
            key: mode,
            className: "we-picker__btn we-picker__rate" + (sel.objectFit === mode ? " we-picker__rate--active" : ""),
            type: "button",
            title: mode,
            onClick: () => {
              selection.objectFit = mode;
              persistSelection();
              emit();
              // Edge canvas 渲染路径的 fit 存在 weDrawCtx 上（syncLayers 的
              // same-canvas 守卫不会重建 draw loop），直接更新并重绘。
              if (weDrawCtx) {
                weDrawCtx.fit = mode;
                weDrawFrame();
              }
            },
          }, label);
        }),
        React.createElement("span", { className: "we-picker__hint" }, "覆盖=cover · 填充=contain · 居中=center · 拉伸=fill"),
      ),
      // 遮挡暂停（借鉴 Wallpaper Engine 的「被遮挡时暂停」）：三个省电开关
      // 并排一行，说明放下一行 —— 最小化/切页、窗口失焦、电池供电时视频暂停、
      // 解码归零，回到界面 / 接通电源自动继续。
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("label", { className: "we-picker__rotation-toggle" },
          React.createElement("input", {
            type: "checkbox",
            checked: sel.pauseOnHidden,
            onChange: (e) => { selection.pauseOnHidden = e.target.checked; persistSelection(); emit(); },
          }),
          "最小化/切页时暂停",
        ),
        React.createElement("label", { className: "we-picker__rotation-toggle" },
          React.createElement("input", {
            type: "checkbox",
            checked: sel.pauseOnBlur,
            onChange: (e) => { selection.pauseOnBlur = e.target.checked; persistSelection(); emit(); },
          }),
          "窗口失焦时暂停",
        ),
        React.createElement("label", { className: "we-picker__rotation-toggle" },
          React.createElement("input", {
            type: "checkbox",
            checked: sel.pauseOnBattery,
            onChange: (e) => { selection.pauseOnBattery = e.target.checked; persistSelection(); emit(); },
          }),
          "使用电池时暂停",
        ),
      ),
      React.createElement("span", { className: "we-picker__hint" },
        "类似 WE 的遮挡暂停：最小化、切到其它应用或使用电池供电时视频暂停、GPU 解码归零；回到界面 / 接通电源自动继续（网页壁纸仅随页面隐藏被浏览器节流）",
      ),
      ),
    ),
    React.createElement("div", { className: "we-picker__row" },
      React.createElement("span", { className: "we-picker__hint" },
        (group
          ? "列表「" + group.name + "」：" + group.wallpaperIds.length + " 项 · " + playableCount + " 可播放 · 每 " + group.interval + " 分钟 · " + (group.order === "random" ? "随机" : "顺序")
          : playableList.length + " 个可播放壁纸") +
        (sel.rotationEnabled ? " · 自动轮转中" : "")),
    ),
  );
}

// ── Settings section wrapper (first-level page) ─────────────────────────────
// Mirrors the skin-center's sectionList > pluginCard structure: the picker is
// rendered inside a liquid-glass card shell so the whole settings page reads
// as one frosted surface over the wallpaper. Owner props ({ close }) are
// intentionally ignored — this section never leaves settings.
function WallpaperPickerSection() {
  return React.createElement("ul", { className: "we-picker__section-list" },
    React.createElement("li", { className: "we-picker__card-shell" },
      React.createElement(WallpaperPicker, null),
    ),
  );
}

// ── Chat-interface rope dock ────────────────────────────────────────────────
// A chibi ship-whale maid grips a pull-cord and floats over the chat. Drag it
// along the top to reposition; on release it snaps back to the TOP edge (and is
// clamped so it can never be dragged out of view). Drag it DOWNWARD past the
// threshold to pull the glass wallpaper-repo DRAWER out — it descends from the
// top of the viewport like a drawer, with a live, finger-following preview
// while dragging. While open, drag UP / press ESC / click the rope or 收起 to
// close. The panel hosts <WallpaperPicker/> untouched, so every repo
// interaction (filters, rotation, uploads, hidden list, classic/fixed card
// layouts) behaves exactly as in the settings page — zero business logic
// rewritten.
//
// Modal ownership: with both the settings copy and the panel copy mounted,
// two identical picker modals would stack. The panel copy therefore OWNS the
// modal whenever the dock exists (repoPanelOwnsModal), and the settings copy
// suppresses its own portal while the flag is up. Flipping the flag triggers
// emit() so the settings copy re-renders immediately.
let repoPanelOwnsModal = false;

// ── Rope artwork ────────────────────────────────────────────────────────────
// The pull-cord is the coloured ship-whale maid gripping a rope with both
// hands, supplied by the user as a transparent-background PNG. It is downscaled
// to 256×283 (≈4× the 60px rendered box, preserving alpha) and inlined as a
// base64 data URI so the single-file client bundle stays self-contained. The
// <img> fills .we-rope__art and uses object-fit: contain.
const ROPE_IMG = "data:image/png;base64,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";

const ROPE_OPEN_THRESHOLD = 96;   // px of downward/upward drag that commits open/close (less twitchy)
const ROPE_PREVIEW_START = 32;    // px of pull before the panel preview starts tracking
const ROPE_EDGE_INSET = 8;        // resting distance below the snapped top edge
const ROPE_VIEW_MARGIN = 8;       // hard clamp so the rope can never leave the viewport
const ROPE_FALLBACK_SIZE = { w: 52, h: 57 }; // matches the CSS box; real size measured at runtime

// Standard clamping (the shared clampNum is an in-range-or-fallback check).
function ropeClamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// Resting rope position, persisted across sessions (viewport-clamped on read).
function readRopePos() {
  const w = (typeof window !== "undefined" && window.innerWidth) || 1280;
  const h = (typeof window !== "undefined" && window.innerHeight) || 800;
  let p = null;
  try {
    const raw = localStorage.getItem(ROPE_POS_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && Number.isFinite(o.x) && Number.isFinite(o.y)) p = { x: o.x, y: o.y };
    }
  } catch { /* ignore */ }
  // Resting position is the TOP edge (any horizontal spot). x stays wherever
  // the user left it (clamped to the viewport); y is always the top inset.
  if (!p) p = { x: Math.max(ROPE_EDGE_INSET, Math.round((w - ROPE_FALLBACK_SIZE.w) / 2)), y: ROPE_EDGE_INSET };
  return {
    x: ropeClamp(p.x, ROPE_VIEW_MARGIN, Math.max(ROPE_VIEW_MARGIN, w - ROPE_FALLBACK_SIZE.w - ROPE_VIEW_MARGIN)),
    y: ropeClamp(p.y, ROPE_EDGE_INSET, Math.max(ROPE_EDGE_INSET, h - ROPE_FALLBACK_SIZE.h - ROPE_VIEW_MARGIN)),
  };
}

function RopeDock() {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState(readRopePos);
  const ropeRef = React.useRef(null);
  const panelRef = React.useRef(null);
  const dragRef = React.useRef(null);

  const ropeSize = () => {
    const el = ropeRef.current;
    if (el && el.offsetWidth > 0) return { w: el.offsetWidth, h: el.offsetHeight };
    return ROPE_FALLBACK_SIZE;
  };
  const clampX = (x) => {
    const w = (typeof window !== "undefined" && window.innerWidth) || 1280;
    return ropeClamp(x, ROPE_VIEW_MARGIN, Math.max(ROPE_VIEW_MARGIN, w - ropeSize().w - ROPE_VIEW_MARGIN));
  };
  const clampY = (y) => {
    const h = (typeof window !== "undefined" && window.innerHeight) || 800;
    return ropeClamp(y, ROPE_EDGE_INSET, Math.max(ROPE_EDGE_INSET, h - ropeSize().h - ROPE_VIEW_MARGIN));
  };
  // Live drag preview on the panel: p ∈ [0,1], 1 = fully open. The panel is a
  // top drawer — it DESCENDS from the top edge (translateY) as it opens.
  // Written as inline styles (compositor-only props) straight to the DOM —
  // bypassing React state keeps WallpaperPicker out of the per-pointermove
  // render path.
  const applyPreview = (p) => {
    const el = panelRef.current;
    if (!el) return;
    const q = ropeClamp(p, 0, 1);
    // Follow the pull with a gentle, regulated glide (a set "speed") rather
    // than a 1:1 snap: the drawer eases after the hand (weighty, not twitchy).
    // On commit the inline transition is cleared so the slow open/close run
    // takes over from wherever the hand left the panel.
    el.style.transition = "transform 440ms cubic-bezier(0.25, 0.8, 0.25, 1), opacity 320ms ease";
    el.style.visibility = "visible";
    el.style.opacity = String(q);
    el.style.transform = "translateY(" + (-(1 - q) * 102).toFixed(2) + "%)";
  };
  const clearPreview = () => {
    const el = panelRef.current;
    if (!el) return;
    el.style.transition = "";
    el.style.visibility = "";
    el.style.opacity = "";
    el.style.transform = "";
  };

  const onRopePointerDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const el = ropeRef.current;
    if (!el || dragRef.current) return;
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    dragRef.current = {
      id: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      baseX: pos.x, baseY: pos.y,
      lastX: pos.x, lastY: pos.y,
      moved: false,
    };
    el.classList.add("we-rope--dragging");   // kill the settle transition while following the finger
    el.classList.remove("we-rope--settle");
    e.preventDefault();
  };
  const onRopePointerMove = (e) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && dx * dx + dy * dy < 9) return; // dead zone: treat jitter as a click
    d.moved = true;
    d.lastX = clampX(d.baseX + dx);
    d.lastY = clampY(d.baseY + dy);
    const el = ropeRef.current;
    if (el) { el.style.left = d.lastX + "px"; el.style.top = d.lastY + "px"; }
    // Follow-hand preview: pull down opens (when closed), push up closes (when open).
    if (!open && dy > ROPE_PREVIEW_START) {
      applyPreview((dy - ROPE_PREVIEW_START) / (ROPE_OPEN_THRESHOLD - ROPE_PREVIEW_START));
    } else if (open && dy < -ROPE_PREVIEW_START) {
      applyPreview(1 - (-dy - ROPE_PREVIEW_START) / (ROPE_OPEN_THRESHOLD - ROPE_PREVIEW_START));
    } else {
      clearPreview();
    }
  };
  const finishDrag = (clientX, clientY, canceled) => {
    const d = dragRef.current;
    const el = ropeRef.current;
    dragRef.current = null;
    if (!el) return;
    el.classList.remove("we-rope--dragging");
    el.classList.add("we-rope--settle");
    if (d) {
      const dy = clientY - d.startY;
      if (!canceled && !d.moved) setOpen((o) => !o);            // plain click toggles
      else if (!canceled && !open && dy >= ROPE_OPEN_THRESHOLD) setOpen(true);
      else if (!canceled && open && dy <= -ROPE_OPEN_THRESHOLD) setOpen(false);
    }
    clearPreview(); // committed class transitions continue smoothly from the inline value
    // Snap to the TOP edge; Y resets to the top inset while X stays wherever
    // the user dragged it (clamped so the rope is never lost off-screen). The
    // rope is a pull-cord that hangs from the top, so it always returns there.
    const x = d ? d.lastX : pos.x;
    const next = { x: clampX(x), y: ROPE_EDGE_INSET };
    // Write the snapped coords imperatively TOO: if they happen to equal the
    // previous React-managed values, React would skip the style diff and the
    // rope would stay wherever the finger left it instead of settling.
    if (el) { el.style.left = next.x + "px"; el.style.top = next.y + "px"; }
    setPos(next);
    try { localStorage.setItem(ROPE_POS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const onRopeKeyDown = (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((o) => !o); }
  };

  // ESC anywhere closes the panel — unless the picker modal is open. The
  // modal's handler sits on WINDOW capture and calls stopPropagation, which
  // halts the event BEFORE it reaches this DOCUMENT-level capture listener,
  // so ESC closes the modal first and the panel survives. When no modal is
  // open the event arrives here and closes the panel.
  React.useEffect(() => {
    if (typeof document === "undefined" || !document.addEventListener) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape" || selection.pickerOpen) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  // Keep the rope inside the viewport when the window shrinks/grows.
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.addEventListener) return undefined;
    const onResize = () => setPos((p) => ({ x: clampX(p.x), y: clampY(p.y) }));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Claim modal ownership ONLY while the panel is open (its picker is mounted).
  // When closed the picker is unmounted, so the settings copy must own the modal
  // again — otherwise 选择壁纸 from settings would open nothing. Flipping the
  // flag triggers emit() so the settings copy re-renders immediately.
  React.useEffect(() => {
    repoPanelOwnsModal = open;
    emit();
    return () => { repoPanelOwnsModal = false; emit(); };
  }, [open]);

  return React.createElement(React.Fragment, null,
    React.createElement("div", {
      ref: ropeRef,
      className: "we-rope we-rope--settle",
      style: { top: pos.y + "px", left: pos.x + "px" },
      role: "button",
      tabIndex: 0,
      "aria-label": "壁纸仓库拉绳：沿顶部拖动移动位置，向下拉打开壁纸仓库面板",
      title: "壁纸仓库 · 沿顶部拖动 / 向下拉打开",
      onPointerDown: onRopePointerDown,
      onPointerMove: onRopePointerMove,
      onPointerUp: (e) => finishDrag(e.clientX, e.clientY, false),
      onPointerCancel: (e) => finishDrag(e.clientX, e.clientY, true),
      onKeyDown: onRopeKeyDown,
    },
      React.createElement("div", { className: "we-rope__art", "aria-hidden": "true" },
        React.createElement("img", { className: "we-rope__img", src: ROPE_IMG, alt: "", draggable: false }),
      ),
    ),
    React.createElement("aside", {
      ref: panelRef,
      className: "we-repo-panel" + (open ? " we-repo-panel--open" : ""),
      "aria-hidden": String(!open),
      "aria-label": "壁纸仓库面板",
      // Closed panel must not expose focusable descendants to Tab / AT.
      inert: open ? undefined : "",
    },
      React.createElement("header", { className: "we-repo-panel__head" },
        React.createElement("span", { className: "we-repo-panel__title" }, "壁纸仓库"),
        React.createElement("button", {
          type: "button",
          tabIndex: open ? 0 : -1,
          className: "we-picker__btn",
          onClick: () => setOpen(false),
        }, "收起"),
      ),
      React.createElement("div", { className: "we-repo-panel__body" },
        // Lazy-mount the picker only while the drawer is open: keeping the
        // whole WallpaperPicker (spinning vinyl etc.) mounted behind a hidden
        // full-viewport fixed panel was the biggest new compositing footprint
        // the rope update added — a driver of the kiosk-window white flash.
        open ? React.createElement(WallpaperPicker, { repoPanel: true }) : null,
      ),
    ),
    React.createElement(UpdateNotice, null),
  );
}

// ── One-time "what's new / fix" notice ──────────────────────────────────────
// Users running the plugin in a desktop-shortcut immersive (standalone / kiosk /
// fullscreen) window can hit a full-screen white flash on click/typing — a
// Chromium compositor bug with hardware acceleration, not fixable by the plugin.
// Show a one-time notice (keyed per version) telling them how to fix it. On
// dismiss we record the version; bump NOTICE_VERSION next release to show again.
const NOTICE_KEY = "dsh-wallpaper-engine:notice-version";
const NOTICE_VERSION = "0.6.2";

function UpdateNotice() {
  const [visible, setVisible] = React.useState(() => {
    try {
      if (typeof localStorage === "undefined") return true;
      return (localStorage.getItem(NOTICE_KEY) || "") !== NOTICE_VERSION;
    } catch { return true; }
  });
  const dismiss = () => {
    try { localStorage.setItem(NOTICE_KEY, NOTICE_VERSION); } catch { /* ignore */ }
    setVisible(false);
  };
  if (!visible) return null;
  return React.createElement("div", { className: "we-update-notice", role: "alert" },
    React.createElement("div", { className: "we-update-notice__title" }, "✅ 已修复：沉浸式窗口偶尔全屏白闪"),
    React.createElement("div", { className: "we-update-notice__body" },
      React.createElement("p", null,
        "v0.6.2 已修复「桌面快捷方式打开的沉浸式全屏窗口」里，点击/输入可能整屏白闪的问题。"),
      React.createElement("p", null,
        "原因：该更新新增的浮动仓库面板/拉绳等在 kiosk/全屏窗口 + 硬件加速下，让 Chromium 合成器偶发把背景画白。"),
      React.createElement("p", null,
        "修复：插件现在会在仓库面板关闭时不再挂载其内容（懒加载），大幅减少不必要的合成层。普通浏览器标签页不受影响，保持原有毛玻璃效果。"),
      React.createElement("p", null,
        "若在极少数环境下仍遇到闪白，可在该窗口的浏览器里关闭「使用硬件加速」作为兜底（该窗口软件渲染也顺滑）。"),
      React.createElement("p", { className: "we-update-notice__hint" },
        "本提示每个新版本只出现一次，点下方按钮即可关闭。"),
    ),
    React.createElement("button", { className: "we-update-notice__btn we-picker__btn", type: "button", onClick: dismiss }, "知道了"),
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const CSS = `
  /* Wallpaper layer: a fixed child of <body>, sunk BELOW the app frame. */
  .we-layer { position: fixed; inset: 0; z-index: -2; overflow: hidden; pointer-events: none; }
  /* Blurring via CSS filter darkens/thins the edges, so the layer is scaled up
     (--we-wallpaper-scale tracks blur) to hide the transparent fringe the blur
     would otherwise reveal at the viewport edges. */
  .we-layer .we-media {
    width: 100%; height: 100%; object-fit: cover; display: block;
    background: transparent; border: 0;
    /* Blur is applied ONLY when > 0 (see --we-media-filter in applyEffects):
       a permanent blur(0px) would still force an offscreen filter layer on
       the wallpaper <video>/canvas every frame — a known source of periodic
       compositing glitches (brief white flash) in Chromium. */
    filter: var(--we-media-filter, none);
    /* Flip composes with the blur-compensation scale on the SAME transform
       (scaleX(-1) mirrors around the center; pure compositor work). */
    transform: scale(var(--we-wallpaper-scale, 1)) scaleX(var(--we-wallpaper-flip, 1));
    transform-origin: center;
  }
  /* The 适配 row sets the fit mode for the CURRENT wallpaper (any type);
     only .we-media--fit reads the variable (iframes have no object-fit). */
  .we-layer .we-media--fit { object-fit: var(--we-object-fit, cover); }

  /* Scrim: sits ABOVE the wallpaper (z-index -1 > -2, so it never depends on
     DOM insertion order — the wallpaper element is re-appended on wallpaper
     switch and could otherwise slide above the scrim). Below the UI. */
  .we-scrim {
    position: fixed; inset: 0; z-index: -1;
    pointer-events: none;
    background: var(--we-scrim-color, rgba(0, 0, 0, 0.25));
  }

  /* While a wallpaper is active: make the app frame AND sidebar transparent so
     all columns share the same wallpaper+scrim background, raise border alpha
     for visibility, and apply the frosted-glass effect to opaque surfaces. */
  body[data-we-wallpaper] {
    --dsw-alias-bg-base: transparent;
    --dsw-specific-sidebar-fill: transparent;
    /* Border emphasis: neutral gray so it reads on both light and dark themes;
       alpha is driven by the "边框" slider through --we-border-alpha. */
    --dsw-alias-border-l1: rgba(180, 180, 180, var(--we-border-alpha, 0.35));
    --dsw-alias-border-l2: rgba(180, 180, 180, var(--we-border-alpha, 0.35));
    --dsw-alias-border-l2-darkmode-thin: rgba(180, 180, 180, var(--we-border-alpha, 0.35));
  }
  /* DSH rc.7+ injects the theme palette (design-platform.css) as a plugin-owned
     stylesheet appended to <head> AFTER this one, so in dark mode the shell's
     body[data-ds-dark-theme] rules (equal specificity 0,1,1, later in the
     document) win the cascade and repaint the app frame / sidebar / borders
     with their opaque dark colors — hiding the wallpaper behind them. Repeat
     the transparency + border-emphasis overrides under the higher-specificity
     dark selector (0,2,1) so the wallpaper always wins regardless of stylesheet
     order. */
  body[data-ds-dark-theme][data-we-wallpaper] {
    --dsw-alias-bg-base: transparent;
    --dsw-specific-sidebar-fill: transparent;
    --dsw-alias-border-l1: rgba(180, 180, 180, var(--we-border-alpha, 0.35));
    --dsw-alias-border-l2: rgba(180, 180, 180, var(--we-border-alpha, 0.35));
    --dsw-alias-border-l2-darkmode-thin: rgba(180, 180, 180, var(--we-border-alpha, 0.35));
  }

  /* ── Light-scheme text contrast boost ──────────────────────────────────────
     In light mode the grays (tertiary/caption/secondary) were tuned against a
     near-white page. Over a busy wallpaper + light scrim they lose contrast, so
     push the whole gray ramp darker while a wallpaper is active. Primary text
     is already near-black; we still pin it to pure black for max legibility.
     (Dark mode is untouched: its white-on-dark text already reads fine.) */
  body[data-we-wallpaper]:not([data-ds-dark-theme]) {
    --dsw-alias-label-primary: rgb(0, 0, 0);
    --dsw-alias-label-primary-dimmed: rgb(10, 10, 12);
    --dsw-alias-label-secondary: rgb(40, 42, 46);
    --dsw-alias-label-tertiary: rgb(70, 73, 79);
    --dsw-alias-label-caption: rgb(110, 114, 120);
    --dsw-alias-label-dimmed: rgb(50, 52, 56);
  }

  /* ── iOS liquid glass ──────────────────────────────────────────────────────
     The opaque conversation surfaces become translucent glass. The recipe is
     Apple-like, not a plain blur:
       - LARGE-radius blur + HIGH saturation + brightness/contrast lift, so the
         wallpaper colour melts into a soft glow instead of a gray smear
         (saturation scales with blur in applyEffects: 0 blur → no melt);
       - a top-weighted specular gradient (background-image) — the sheen is
         what makes the surface read as "wet glass", not a flat tint;
       - a light, low-alpha base (not a dark one) so the wallpaper shows through;
       - a 1px top refraction highlight + 0.5px hairline + soft elevation
         shadow for "thick glass";
       - blur radius + saturation both scale off --we-blur / --we-saturate
         (the 玻璃 slider drives both, so composer, bubbles AND the
         better-sidebar shell stay in one uniform liquid look).

     Transparency is driven through the design tokens the surfaces already read
     (--dsw-specific-input-major on the composer card, --dsw-specific-bubble on
     message bubbles) rather than through class selectors: CSS-module class
     names are build hashes and change whenever the shell frontend is rebuilt,
     which silently kills the effect. backdrop-filter cannot be expressed as a
     token, so the blur itself still needs an element selector — [data-composer-card]
     is authored in the shell source and survives rebuilds. Bubbles carry no such
     attribute, so they fall back to the module-CSS suffix convention; if that
     ever stops matching the bubble stays translucent, just without the blur. */
  body[data-we-wallpaper] {
    --dsw-specific-input-major: rgba(255, 255, 255, var(--we-glass-alpha, 0.15));
    --dsw-specific-bubble: rgba(255, 255, 255, calc(var(--we-glass-alpha, 0.15) * 0.8));
  }
  body[data-ds-dark-theme][data-we-wallpaper] {
    --dsw-specific-input-major: rgba(255, 255, 255, calc(var(--we-glass-alpha, 0.15) * 0.4));
    --dsw-specific-bubble: rgba(255, 255, 255, calc(var(--we-glass-alpha, 0.15) * 0.33));
  }
  body[data-we-wallpaper] [data-composer-card],
  body[data-we-wallpaper] [class*="_bubble"] {
    /* Specular sheen: a top-weighted white gradient turns a flat translucent
       tint into "wet glass" — kept faint so the wallpaper stays 通透 (clear)
       instead of glaring. */
    background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.05) 38%, rgba(255, 255, 255, 0.02));
    -webkit-backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
    backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, var(--we-glass-highlight, 0.32)),
      inset 0 -1px 0 rgba(255, 255, 255, 0.08),
      inset 0 0 0 0.5px rgba(255, 255, 255, 0.08),
      0 12px 40px rgba(0, 0, 0, var(--we-glass-shadow, 0.12));
  }
  /* Note (anti-flicker): the composer/bubbles keep ONLY the backdrop-filter
     glass. Extra always-on layers (transform/will-change/contain) were removed —
     they did not stop the white flash and instead added compositing layers. The
     flash was traced to the rope's permanent CSS filter, which is now gone. */

  /* ── dsh-better-sidebar glass ──────────────────────────────────────────────
     The sidebar shell is portalled onto <body> under a stable host attribute
     "data-dsh-better-sidebar" (set by the plugin's own mount code), so we can
     target the whole tree without depending on its CSS-module hashes. Its root
     panels read the opaque --dsw-alias-bg-layer-1 token (hence the "black
     frame") — give them the SAME clear liquid-glass recipe as the
     composer/bubbles (faint specular sheen + gentle frosted melt).
     Unlike the conversation surfaces, the sidebar glass is FULLY independent:
     the master switch body[data-we-sidebar-glass] (侧栏液态玻璃) gates the whole
     adaptation, and blur / saturation / transparency / base tint each have
     their own knob (--we-sidebar-blur / --we-sidebar-saturate /
     --we-sidebar-alpha / --we-sidebar-color, from 侧栏模糊 / 侧栏透明度 /
     侧栏玻璃颜色), so the sidebar can be blurrier, clearer, more transparent
     or tinted however you like without touching the 玻璃 / 玻璃透明度 sliders.
     Inner chrome surfaces that paint the same opaque tokens get a translucent
     base too; the blur lives on the root panels (one blur per shell). */
  body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_boundaryError"],
  body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_panel"] {
    background-color: color-mix(in srgb, var(--we-sidebar-color, #ffffff) calc(var(--we-sidebar-alpha, 0.15) * 0.66 * 100%), transparent) !important;
    background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.04) 38%, rgba(255, 255, 255, 0.01)) !important;
    -webkit-backdrop-filter: blur(var(--we-sidebar-blur, 16px)) saturate(var(--we-sidebar-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01) !important;
    backdrop-filter: blur(var(--we-sidebar-blur, 16px)) saturate(var(--we-sidebar-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01) !important;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, var(--we-glass-highlight, 0.32)),
      inset 0 -1px 0 rgba(255, 255, 255, 0.08),
      inset 0 0 0 0.5px rgba(255, 255, 255, 0.06);
  }
  body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_pane"],
  body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_tabBar"],
  body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_paneCard"],
  body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_editorHeader"],
  body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_explorerHeader"],
  body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_gitHeader"],
  body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_browserBar"],
  body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_terminalWrap"] {
    background-color: color-mix(in srgb, var(--we-sidebar-color, #ffffff) calc(var(--we-sidebar-alpha, 0.15) * 0.53 * 100%), transparent) !important;
  }
  body[data-ds-dark-theme][data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_boundaryError"],
  body[data-ds-dark-theme][data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_panel"] {
    background-color: color-mix(in srgb, var(--we-sidebar-color, #ffffff) calc(var(--we-sidebar-alpha, 0.15) * 0.33 * 100%), transparent) !important;
  }
  body[data-ds-dark-theme][data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_pane"],
  body[data-ds-dark-theme][data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_tabBar"],
  body[data-ds-dark-theme][data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_paneCard"],
  body[data-ds-dark-theme][data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_editorHeader"],
  body[data-ds-dark-theme][data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_explorerHeader"],
  body[data-ds-dark-theme][data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_gitHeader"],
  body[data-ds-dark-theme][data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_browserBar"],
  body[data-ds-dark-theme][data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_terminalWrap"] {
    background-color: color-mix(in srgb, var(--we-sidebar-color, #ffffff) calc(var(--we-sidebar-alpha, 0.15) * 0.26 * 100%), transparent) !important;
  }
  /* No backdrop-filter support: fall back to near-opaque tinted surfaces so
     sidebar text never sits directly on a busy wallpaper (same policy as the
     settings-window glass). The tint still applies. */
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_boundaryError"],
    body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_panel"],
    body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_pane"],
    body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_tabBar"],
    body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_paneCard"],
    body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_editorHeader"],
    body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_explorerHeader"],
    body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_gitHeader"],
    body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_browserBar"],
    body[data-we-sidebar-glass][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_terminalWrap"] {
      background-color: color-mix(in srgb, var(--we-sidebar-color, #ffffff) 92%, transparent) !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }
  }

  /* Picker chrome. */
  .we-picker { display: flex; flex-direction: column; gap: 10px; }
  .we-picker__select { max-width: 100%; }
  .we-picker__row { display: flex; gap: 8px; align-items: center; }
  /* 抽帧转码下载/转码进度条. */
  .we-picker__prog { gap: 8px; }
  .we-picker__prog-track {
    flex: 1; min-width: 0; height: 5px; border-radius: 3px;
    background: rgba(128, 128, 128, 0.3);
    overflow: hidden;
  }
  .we-picker__prog-bar {
    height: 100%; border-radius: 3px;
    background: var(--we-accent, #4f8cff);
    transition: width 0.4s ease;
  }
  /* First-level settings section wrapper (mirrors the skin-center's
     sectionList): the ul/li carry no default list styling. */
  .we-picker__section-list { margin: 0; padding: 0; list-style: none; }

  /* ── WHOLE native settings window → liquid glass (master switch).
     Keyed on body[data-we-glass-window] (set by applyEffects from the
     glassWindow preference). The settings dialog is the shell's
     div[role="dialog"] containing the settings.section outlet anchor
     (data-slot="settings.section" — stamped by the slot renderer, same anchor
     the skin-center's semantic layer uses). The dialog reads inherited shell
     tokens (panel background = --dsw-alias-bg-layer-2, nav active/hover =
     --dsw-specific-sidebar-nav-item-*, close hover = --dsw-alias-interactive-bg-hover,
     accents = --dsw-alias-brand-primary), so overriding those tokens ON the
     dialog element restyles the ENTIRE window — left nav, content header and
     every native section (General / Models / Plugins / …) — in one shot:
     translucent glass base + backdrop blur + specular sheen + inner highlight,
     with the accent color remapped to --we-accent (配色) and all surface alphas
     driven by --we-glass-alpha (玻璃透明度). Off = stock shell look. ── */
  body[data-we-glass-window] [role="dialog"]:has([data-slot="settings.section"]) {
    /* Glass surface alphas (light scheme): the base tint is --we-glass-color
       (玻璃颜色) mixed with transparent at the 玻璃透明度-driven alpha, so the
       whole window glass can be tinted to any color. Default (no custom color)
       = white glass, the stock look. */
    --dsw-alias-bg-layer-1: color-mix(in srgb, var(--we-glass-color, #ffffff) calc(var(--we-glass-alpha, 0.5) * 0.9 * 100%), transparent);
    --dsw-alias-bg-layer-2: color-mix(in srgb, var(--we-glass-color, #ffffff) calc(var(--we-glass-alpha, 0.5) * 1.0 * 100%), transparent);
    --dsw-alias-bg-layer-3: color-mix(in srgb, var(--we-glass-color, #ffffff) calc(var(--we-glass-alpha, 0.5) * 1.1 * 100%), transparent);
    /* Nav + interactive states tinted with the accent. */
    --dsw-specific-sidebar-nav-item-active: color-mix(in srgb, var(--we-accent, #4f8cff) 26%, rgba(255, 255, 255, 0.08));
    --dsw-specific-sidebar-nav-item-hover: color-mix(in srgb, var(--we-accent, #4f8cff) 13%, rgba(255, 255, 255, 0.05));
    --dsw-alias-interactive-bg-hover: color-mix(in srgb, var(--we-accent, #4f8cff) 14%, transparent);
    --dsw-alias-interactive-bg-hover-accent: color-mix(in srgb, var(--we-accent, #4f8cff) 18%, transparent);
    /* Whole-dialog accent remap: every native control (links, primary buttons,
       switches, active tabs, slider fills) follows the 配色 control. */
    --dsw-alias-brand-primary: var(--we-accent, #4f8cff);
    --dsw-alias-brand-text: var(--we-accent, #4f8cff);
    --dsw-alias-button-primary-fill: var(--we-accent, #4f8cff);
    --dsw-alias-button-primary-hover: color-mix(in srgb, var(--we-accent, #4f8cff) 88%, #fff);
    --dsw-alias-button-primary-dimmed: color-mix(in srgb, var(--we-accent, #4f8cff) 22%, transparent);
    --dsw-alias-state-business-primary: var(--we-accent, #4f8cff);
    /* Frosted finish — the SAME recipe as the conversation surfaces (composer
       card / bubbles): the blur radius, saturation melt and brightness all
       read the 玻璃 slider (--we-blur 0–60px, --we-saturate, --we-glass-brightness),
       so the settings window glass tracks the conversation-bar adjustment range
       exactly. Plus a specular sheen + inner edge highlight + diffuse shadow
       (the shell already rounds the panel at 24px). */
    -webkit-backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
    backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
    background-image: linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.1) 0%,
      rgba(255, 255, 255, 0.03) 38%,
      rgba(255, 255, 255, 0.05) 100%
    );
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.22),
      inset 0 0 0 1px rgba(255, 255, 255, 0.06),
      0 24px 80px rgba(0, 7, 18, 0.35);
  }
  /* Dark scheme: deep translucent base instead of white. The default glass
     color is deep navy; a user-picked 玻璃颜色 overrides it in both themes. */
  body[data-ds-dark-theme][data-we-glass-window] [role="dialog"]:has([data-slot="settings.section"]) {
    --dsw-alias-bg-layer-1: color-mix(in srgb, var(--we-glass-color, #0d1524) calc(var(--we-glass-alpha, 0.5) * 0.9 * 100%), transparent);
    --dsw-alias-bg-layer-2: color-mix(in srgb, var(--we-glass-color, #0d1524) calc(var(--we-glass-alpha, 0.5) * 1.0 * 100%), transparent);
    --dsw-alias-bg-layer-3: color-mix(in srgb, var(--we-glass-color, #0d1524) calc(var(--we-glass-alpha, 0.5) * 1.1 * 100%), transparent);
    --dsw-specific-sidebar-nav-item-active: color-mix(in srgb, var(--we-accent, #4f8cff) 30%, rgba(255, 255, 255, 0.06));
    --dsw-specific-sidebar-nav-item-hover: color-mix(in srgb, var(--we-accent, #4f8cff) 14%, rgba(255, 255, 255, 0.04));
    background-image: linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.07) 0%,
      rgba(255, 255, 255, 0.02) 38%,
      rgba(255, 255, 255, 0.03) 100%
    );
  }
  /* No backdrop-filter support: fall back to near-opaque glass so text stays
     readable (same policy as the skin's patches.css). */
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    body[data-we-glass-window] [role="dialog"]:has([data-slot="settings.section"]) {
      --dsw-alias-bg-layer-1: var(--we-glass-color, #ffffff);
      --dsw-alias-bg-layer-2: var(--we-glass-color, #ffffff);
      --dsw-alias-bg-layer-3: var(--we-glass-color, #ffffff);
    }
    body[data-ds-dark-theme][data-we-glass-window] [role="dialog"]:has([data-slot="settings.section"]) {
      --dsw-alias-bg-layer-1: var(--we-glass-color, #0d1524);
      --dsw-alias-bg-layer-2: var(--we-glass-color, #0d1524);
      --dsw-alias-bg-layer-3: var(--we-glass-color, #0d1524);
    }
  }

  /* Section card (mirrors the skin-center's pluginCard): a quiet layer card —
     translucent token background + hairline border + radius. NO own backdrop
     blur: the whole settings window is the glass surface (see the
     body[data-we-glass-window] dialog rules above), so a nested blur would
     double-frost and look muddy. Without the master switch the card still
     reads as a subtle layer over the stock panel. */
  .we-picker__card-shell {
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.28));
    border-radius: 12px;
    background: var(--dsw-alias-bg-layer-3, rgba(128, 128, 128, 0.08));
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
    padding: 14px 16px;
    transition: border-color 0.16s ease, background-color 0.16s ease;
  }
  .we-picker__card-shell:hover { border-color: var(--dsw-alias-label-dimmed, rgba(128, 128, 128, 0.5)); }
  /* Card header: name + count badge + description (mirrors skin-center). */
  .we-picker__card-head {
    display: flex; align-items: baseline; gap: 8px;
    padding-bottom: 10px; border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.22));
  }
  .we-picker__card-name {
    font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary, inherit);
  }
  .we-picker__card-badge {
    font-size: 11px; font-weight: 500; color: var(--dsw-alias-label-secondary, #6b7280);
  }
  .we-picker__card-desc {
    margin-left: auto; font-size: 12px; color: var(--dsw-alias-label-tertiary, #6b7280);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  /* 配色 swatches: circular preset buttons + native color picker. The active
     swatch gets an accent ring so the current choice is obvious at a glance. */
  .we-picker__accent-row { flex-wrap: wrap; }
  .we-picker__swatch {
    width: 20px; height: 20px; padding: 0; border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.7);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
    cursor: pointer;
    transition: transform var(--we-dur-fast, 120ms) var(--we-ease, ease), box-shadow var(--we-dur-fast, 120ms) var(--we-ease, ease);
  }
  .we-picker__swatch:hover { transform: scale(1.12); }
  .we-picker__swatch--active {
    box-shadow: 0 0 0 2px var(--we-accent, #4f8cff), 0 0 0 4px rgba(255, 255, 255, 0.5);
  }
  .we-picker__swatch-custom {
    display: inline-flex; align-items: center; gap: 4px; cursor: pointer;
  }
  .we-picker__swatch-custom input[type="color"] {
    width: 22px; height: 22px; padding: 0; border: 0; border-radius: 50%;
    background: transparent; cursor: pointer;
  }
  .we-picker__swatch-custom input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
  .we-picker__swatch-custom input[type="color"]::-webkit-color-swatch { border: 1px solid rgba(255, 255, 255, 0.6); border-radius: 50%; }
  /* Master-switch row (设置窗口液态玻璃) sits on its own line under the 透明度
     slider so the switch and the hint read as one labelled control. */
  .we-picker__window-toggle { font-size: 0.82em; }
  .we-picker__window-toggle + .we-picker__hint { margin-left: 2px; }

  /* Pagination bar under each paged grid (normal / hidden / group editor).
     Horizontally centered; as a direct child of the flex modal body it sinks
     to the bottom when the grid leaves free space (margin-top: auto). */
  .we-picker__pager {
    display: flex; gap: 10px; align-items: center; justify-content: center;
    margin-top: auto; padding-top: 8px; flex-wrap: wrap;
  }
  .we-picker__playlist-select { flex: 1; min-width: 0; }
  .we-picker__filter-row { flex-wrap: wrap; flex-shrink: 0; }
  .we-picker__filter-row .we-picker__playlist-select { flex: 1 1 130px; }
  .we-picker__rotation-toggle { display: inline-flex; align-items: center; gap: 6px; }
  .we-picker__rotation-interval { margin-left: auto; }
  /* Flat, uniform-height controls. Native <select> renders as a raised "3D"
     OS widget whose height can shift a pixel on hover; inside tightly packed
     rows that squeezes the neighbours and, with the cursor near a row edge,
     oscillates (hover → grow → shift → unhover → shrink → …). Strip the
     native chrome and PIN the height so no control's intrinsic size can move
     a row. */
  .we-picker__btn {
    cursor: pointer; height: 26px; line-height: 24px; padding: 0 10px;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
    border-radius: 6px; background: transparent;
    color: var(--dsw-alias-label-secondary, #888); font-size: 0.82em;
    white-space: nowrap;
  }
  .we-picker__btn:hover { background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.12)); }
  .we-picker__btn:disabled { opacity: 0.45; cursor: default; }
  .we-picker select {
    appearance: none; -webkit-appearance: none;
    height: 26px; padding: 0 8px;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
    border-radius: 6px; background: transparent;
    color: var(--dsw-alias-label-secondary, #888); font-size: 0.82em;
    cursor: pointer;
  }
  .we-picker select:hover { background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.12)); }
  .we-picker select:disabled { opacity: 0.45; cursor: default; }
  .we-picker__hint { font-size: 0.8em; opacity: 0.78; }
  /* 数字读数等宽：页码 / 计数 / fps / 百分比切换时不再跳动。 */
  .we-picker__pager .we-picker__hint, .we-picker__card-badge, .we-picker__value {
    font-variant-numeric: tabular-nums;
  }
  /* 统一焦点环：accent 色、2px、外偏移（a11y + 跟随配色）。 */
  .we-picker button:focus-visible, .we-picker select:focus-visible,
  .we-picker input:focus-visible, .we-picker [role="button"]:focus-visible,
  .we-picker__modal button:focus-visible, .we-picker__modal select:focus-visible,
  .we-picker__modal input:focus-visible, .we-picker__modal [role="button"]:focus-visible {
    outline: 2px solid var(--we-accent, #4f8cff);
    outline-offset: 2px;
  }
  /* Text inputs (搜索 / 路径 / 列表名称): match the flat 26px control style. */
  .we-picker__text {
    height: 26px; padding: 0 8px;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
    border-radius: 6px; background: transparent;
    color: var(--dsw-alias-label-secondary, #888); font-size: 0.82em;
  }
  .we-picker__search { flex: 1 1 150px; min-width: 0; }
  .we-picker__error { font-size: 0.82em; opacity: 0.9; color: #e5534b; }
  .we-picker__note { font-size: 0.8em; opacity: 0.85; color: var(--we-accent, var(--dsw-alias-brand-primary, #4f8cff)); }

  /* ── Visual grouping: sections with a hairline divider + quiet label. ── */
  .we-picker__section { display: flex; flex-direction: column; gap: 8px; }
  .we-picker__section + .we-picker__section {
    border-top: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.22));
    padding-top: 10px;
  }
  .we-picker__section-head { display: flex; align-items: center; }
  .we-picker__section-label {
    font-size: 0.75em; font-weight: 500; opacity: 0.55;
    letter-spacing: 0.01em;
  }

  /* ── Vinyl record (黑胶唱片): rotating disc with the selected wallpaper's
     cover as the label. Spins while the wallpaper is playing; pauses
     otherwise. Shown in both settings layouts and in the modal head. ── */
  .we-vinyl {
    position: relative; width: 128px; height: 128px; flex: 0 0 auto;
    border-radius: 50%;
    background:
      repeating-radial-gradient(circle at center, #191920 0 2px, #23232c 2px 4px);
    box-shadow:
      0 6px 18px rgba(0, 0, 0, 0.55),
      inset 0 0 0 1px rgba(255, 255, 255, 0.07);
    animation: we-vinyl-spin 8s linear infinite;
    animation-play-state: paused;
  }
  .we-vinyl--playing { animation-play-state: running; }
  .we-vinyl--sm { width: 56px; height: 56px; }
  .we-vinyl__cover {
    position: absolute; inset: 24%; border-radius: 50%; overflow: hidden;
    background: rgba(128, 128, 128, 0.25);
    border: 2px solid rgba(0, 0, 0, 0.85);
    box-shadow:
      0 0 0 2px rgba(255, 255, 255, 0.1),
      inset 0 0 8px rgba(0, 0, 0, 0.6);
  }
  .we-vinyl__cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .we-vinyl__empty {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    color: rgba(255, 255, 255, 0.45); font-size: 1.3em;
  }
  .we-vinyl__hole {
    position: absolute; left: 50%; top: 50%;
    width: 12px; height: 12px; margin: -6px 0 0 -6px;
    border-radius: 50%; background: #0b0b0e;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.9);
  }
  .we-vinyl--sm .we-vinyl__hole { width: 6px; height: 6px; margin: -3px 0 0 -3px; }
  @keyframes we-vinyl-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    .we-vinyl { animation: none; }
  }
  .we-picker__modal-head-left { display: flex; align-items: center; gap: 8px; min-width: 0; }

  /* ── Current-wallpaper card: thumbnail + title + type + primary action. ── */
  .we-picker__current {
    display: flex; align-items: center; gap: 10px;
    padding: 10px; border-radius: 12px;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.28));
    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.06));
  }
  .we-picker__current-thumb {
    width: 64px; height: 36px; flex: 0 0 auto;
    object-fit: cover; border-radius: 8px;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
    background: rgba(128, 128, 128, 0.14);
  }
  .we-picker__current-thumb--empty {
    display: flex; align-items: center; justify-content: center;
    font-size: 0.85em; opacity: 0.4;
  }
  .we-picker__current-info { flex: 1; min-width: 0; }
  .we-picker__current-title {
    font-size: 0.9em; font-weight: 500;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .we-picker__current-meta { font-size: 0.75em; opacity: 0.55; margin-top: 2px; }

  /* Primary action (选择壁纸): brand accent, restrained — accent is for the
     main action only, per the product register's "accent ≠ decoration". */
  .we-picker__btn--primary {
    color: var(--we-accent, #4f8cff);
    border-color: var(--we-accent, #4f8cff);
  }
  .we-picker__btn--primary:hover {
    background: var(--we-accent, #4f8cff);
    color: #fff;
  }

  /* Refined range sliders: thin track + circular brand ring thumb. */
  .we-picker__slider {
    -webkit-appearance: none; appearance: none;
    flex: 1; height: 18px; background: transparent; cursor: pointer;
  }
  .we-picker__slider::-webkit-slider-runnable-track {
    height: 4px; border-radius: 2px;
    /* accent 填充段（0 → --we-fill）+ 灰色剩余段 */
    background: linear-gradient(to right,
      var(--we-accent, #4f8cff) var(--we-fill, 0%),
      var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.4)) var(--we-fill, 0%));
  }
  .we-picker__slider::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    width: 14px; height: 14px; margin-top: -5px; border-radius: 50%;
    background: var(--dsw-alias-bg-layer-1, #fff);
    border: 2px solid var(--we-accent, #4f8cff);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
    transition: transform var(--we-dur-fast, 120ms) var(--we-ease, ease);
  }
  .we-picker__slider:hover::-webkit-slider-thumb { transform: scale(1.15); }
  .we-picker__slider::-moz-range-track {
    height: 4px; border-radius: 2px;
    background: var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.4));
  }
  /* Firefox 的填充段走专用伪元素（不认 webkit 的渐变轨道方案）。 */
  .we-picker__slider::-moz-range-progress {
    height: 4px; border-radius: 2px;
    background: var(--we-accent, #4f8cff);
  }
  .we-picker__slider::-moz-range-thumb {
    width: 14px; height: 14px; border-radius: 50%;
    background: var(--dsw-alias-bg-layer-1, #fff);
    border: 2px solid var(--we-accent, #4f8cff);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  }
  /* Native checkboxes tinted with the accent (自动轮转 / 水平翻转). */
  .we-picker input[type="checkbox"] { accent-color: var(--we-accent, #4f8cff); }
  .we-picker__rotation-toggle { cursor: pointer; }

  /* Sliding toggle switch (紧凑布局). Track + thumb slide left/right with a
     snappy 120ms transition; pinned accent so light themes stay readable. */
  .we-picker__switch {
    position: relative; display: inline-flex; cursor: pointer;
  }
  .we-picker__switch input {
    position: absolute; opacity: 0; width: 0; height: 0;
  }
  .we-picker__switch-track {
    position: relative; width: 42px; height: 24px; border-radius: 12px;
    background: rgba(128, 128, 128, 0.4);
    transition: background-color var(--we-dur-fast, 120ms) var(--we-ease, ease);
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.3);
  }
  /* 键盘焦点环：input 视觉隐藏但可聚焦，焦点环落在 track 上。 */
  .we-picker__switch input:focus-visible + .we-picker__switch-track {
    outline: 2px solid var(--we-accent, #4f8cff);
    outline-offset: 2px;
  }
  .we-picker__switch input:checked + .we-picker__switch-track {
    background: var(--we-accent, #4f8cff); /* 跟随「配色」设置，不再硬编码 */
  }
  .we-picker__switch-thumb {
    position: absolute; left: 3px; top: 3px;
    width: 18px; height: 18px; border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
    transition: transform var(--we-dur-fast, 120ms) var(--we-ease, ease);
  }
  .we-picker__switch input:checked + .we-picker__switch-track .we-picker__switch-thumb {
    transform: translateX(18px);
  }
  /* Edge 兼容渲染开关：塞在"紧凑布局"同一行，margin-left:auto 使其靠右。 */
  .we-picker__switch--edge {
    margin-left: auto; align-items: center; gap: 6px;
  }

  /* Custom chevron for the flat selects (appearance: none removed the native
     arrow; heights stay pinned at 26px so rows can never shift). */
  .we-picker select {
    background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M1 1l3 3 3-3' fill='none' stroke='%23888' stroke-width='1.4' stroke-linecap='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 8px center;
    padding-right: 24px;
  }

  /* Motion tokens: one shared ease (expo-out) + two durations. Modal is
     portalled onto <body> (outside .we-picker), so the token scope covers both
     roots. */
  .we-picker, .we-picker__modal, .we-picker__modal-overlay {
    --we-ease: cubic-bezier(0.16, 1, 0.3, 1);
    --we-dur-fast: 120ms;
    --we-dur: 200ms;
  }
  /* Motion: state-only transitions (background/color/border/transform — never
     layout), token-driven; disabled entirely under prefers-reduced-motion. */
  .we-picker__btn, .we-picker select, .we-picker__card, .we-picker__editor-card,
  .we-picker__tab, .we-picker__rate, .we-picker__card-hide {
    transition:
      background-color var(--we-dur-fast, 120ms) var(--we-ease, ease),
      border-color var(--we-dur-fast, 120ms) var(--we-ease, ease),
      color var(--we-dur-fast, 120ms) var(--we-ease, ease),
      box-shadow var(--we-dur-fast, 120ms) var(--we-ease, ease),
      transform var(--we-dur-fast, 120ms) var(--we-ease, ease);
  }
  /* 按压反馈：点击即缩，松手回弹（transform = 合成器属性，不引发布局）。 */
  .we-picker__btn:active, .we-picker__rate:active, .we-picker__tab:active {
    transform: scale(0.96);
  }
  @media (prefers-reduced-motion: reduce) {
    .we-picker *, .we-picker__modal, .we-picker__modal *, .we-picker__modal-overlay {
      transition: none !important;
      animation: none !important;
    }
  }
  .we-picker__slider-row { display: flex; align-items: center; gap: 8px; }
  .we-picker__label { min-width: 28px; }
  .we-picker__value { min-width: 40px; text-align: right; }
  .we-picker__text { flex: 1; min-width: 0; }
  .we-picker__editor {
    display: flex; flex-direction: column; gap: 6px;
    padding: 8px;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
    border-radius: 8px;
  }
  /* Wallpaper thumbnail grid (main picker).
     Cards use a FIXED height + absolutely-positioned filling <img>, never
     aspect-ratio: some browsers (old Chromium/WebView) ignore aspect-ratio on
     cards and let percentage-height images resolve to their intrinsic size,
     which made previews bleed over the row above. inset:0 + overflow:hidden
     pins the image inside the card in every engine. */
  .we-picker__grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 8px; max-height: 280px; overflow-y: auto; padding: 2px;
    /* hover 放大（CD 架 scale 1.12）不得撑出水平滚动条：clip 裁掉溢出且不
       产生滚动条（hidden 仍可被程序滚动，clip 才是纯裁剪），scrollbar-gutter
       让垂直滚动条的出现/消失也不再挤压内容 —— 两者一起消除「hover 最后一列
       → 溢出 → 滚动条 → 宽度变化 → unhover → 回缩」的震荡循环。 */
    overflow-x: hidden; /* fallback：老旧内核不认识 clip 时的平替 */
    overflow-x: clip;
    scrollbar-gutter: stable;
  }
  .we-picker__card {
    position: relative; height: 92px; padding: 0; cursor: pointer;
    display: block; overflow: hidden;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
    border-radius: 8px;
    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.15));
  }
  .we-picker__card img {
    position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: cover; display: block;
    /* 加载淡入（onLoad 置 opacity:1）+ hover 微放大（合成器属性）。 */
    opacity: 0;
    transition:
      opacity var(--we-dur, 200ms) ease,
      transform 300ms var(--we-ease, ease);
  }
  /* hover 缩略图缓放大 —— 仅非 CD 架模式（CD 架是卡片整体 scale，叠加会双重放大）。 */
  .we-picker:not([data-we-cards="classic"]) .we-picker__card:hover img,
  .we-picker__modal:not([data-we-cards="classic"]) .we-picker__card:hover img {
    transform: scale(1.06);
  }
  /* 编辑器卡片 / 黑胶封面同样加载淡入。 */
  .we-picker__editor-card img, .we-vinyl__cover img {
    opacity: 0;
    transition: opacity var(--we-dur, 200ms) ease;
  }
  /* Classic — "CD 架" (CD-rack) card style: cards stack like CD jewel cases
     on a rack. Each row strongly overlaps the row ABOVE it (the lower card's
     top covers roughly half of the upper card's bottom — vertical only, never
     horizontal), with a soft drop shadow for shelf depth. Hovering scales the
     card up and brings it to the front. Opt-in via the 卡片样式 switch. The
     modal is PORTALLED onto <body>, so the attribute is scoped on BOTH the
     settings root and the modal element. The grid gets extra bottom padding
     so the last row's overlap is not clipped. */
  .we-picker[data-we-cards="classic"] .we-picker__grid,
  .we-picker__modal[data-we-cards="classic"] .we-picker__grid {
    /* Compact CD-rack columns: ~7 cards per row at modal width. 两侧留出
       8px 让位列：最左/最右列 hover 放大 12%（≈6px/侧）时在让位区内展开，
       不触碰溢出边界、不被 clip 裁掉。 */
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    padding: 2px 8px 42px;
  }
  .we-picker[data-we-cards="classic"] .we-picker__editor-grid,
  .we-picker__modal[data-we-cards="classic"] .we-picker__editor-grid {
    grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  }
  .we-picker[data-we-cards="classic"] .we-picker__card,
  .we-picker__modal[data-we-cards="classic"] .we-picker__card {
    position: relative; width: 100%; padding: 0; cursor: pointer;
    height: auto; aspect-ratio: 16 / 9; display: block; overflow: hidden;
    margin-bottom: -36px;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
    border-radius: 8px;
    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.15));
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
    transition: transform 120ms ease, box-shadow 120ms ease;
  }
  .we-picker[data-we-cards="classic"] .we-picker__card:hover,
  .we-picker__modal[data-we-cards="classic"] .we-picker__card:hover {
    transform: scale(1.12);
    z-index: 10;
    box-shadow: 0 14px 28px rgba(0, 0, 0, 0.5);
  }
  .we-picker[data-we-cards="classic"] .we-picker__card img,
  .we-picker__modal[data-we-cards="classic"] .we-picker__card img {
    position: static; width: 100%; height: 100%; object-fit: cover; display: block;
  }
  .we-picker[data-we-cards="classic"] .we-picker__editor-card,
  .we-picker__modal[data-we-cards="classic"] .we-picker__editor-card {
    position: relative; width: 100%; padding: 0; cursor: pointer;
    height: auto; aspect-ratio: 16 / 10; display: block; overflow: hidden;
    margin-bottom: -30px;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
    border-radius: 6px;
    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.15));
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
    transition: transform 120ms ease, box-shadow 120ms ease;
  }
  .we-picker[data-we-cards="classic"] .we-picker__editor-card:hover,
  .we-picker__modal[data-we-cards="classic"] .we-picker__editor-card:hover {
    transform: scale(1.1);
    z-index: 10;
    box-shadow: 0 12px 24px rgba(0, 0, 0, 0.5);
  }
  .we-picker[data-we-cards="classic"] .we-picker__editor-card img,
  .we-picker__modal[data-we-cards="classic"] .we-picker__editor-card img {
    position: static; width: 100%; height: 100%; object-fit: cover; display: block;
  }
  .we-picker__card--selected {
    outline: 2px solid var(--we-accent, #4f8cff);
    outline-offset: -2px;
    /* 选中即"发光"：accent 色柔光晕，比裸描边更读得出"当前"。 */
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--we-accent, #4f8cff) 45%, transparent),
      0 4px 16px color-mix(in srgb, var(--we-accent, #4f8cff) 30%, transparent);
  }
  .we-picker__card-close {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: 0.8em; color: var(--dsw-alias-label-secondary, #888);
  }
  .we-picker__card-title {
    position: absolute; left: 0; right: 0; bottom: 0; padding: 3px 6px;
    font-size: 0.7em; line-height: 1.2; color: #fff;
    background: linear-gradient(transparent, rgba(0, 0, 0, 0.7));
    text-overflow: ellipsis; white-space: nowrap; overflow: hidden;
  }
  /* Scene-wallpaper "静态帧" badge — top-right under the hide button. */
  .we-picker__card-badge {
    position: absolute; top: 4px; right: 4px; z-index: 1;
    padding: 1px 6px; font-size: 0.62em; line-height: 1.6;
    border-radius: 4px; color: #fff;
    background: rgba(30, 90, 160, 0.85);
  }
  .we-picker__card-placeholder {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: 0.72em; opacity: 0.55;
  }
  /* Per-card "hide" button (soft delete) — top-right overlay. 默认隐去，
     hover / 键盘聚焦（focus-within）时浮现：网格不常驻一层噪声按钮。 */
  .we-picker__card-hide {
    position: absolute; top: 4px; right: 4px; z-index: 2;
    padding: 2px 7px; font-size: 0.68em; line-height: 1.5;
    border: 0; border-radius: 4px; cursor: pointer;
    background: rgba(0, 0, 0, 0.6); color: #fff;
    opacity: 0;
  }
  .we-picker__card:hover .we-picker__card-hide,
  .we-picker__card:focus-within .we-picker__card-hide { opacity: 1; }
  .we-picker__card-hide:hover { background: rgba(190, 50, 50, 0.9); }
  /* Batch-mode selection check — top-left overlay. */
  .we-picker__card-check {
    position: absolute; top: 4px; left: 4px; z-index: 2;
    width: 18px; height: 18px; border-radius: 4px;
    background: rgba(0, 0, 0, 0.6); color: #fff;
    font-size: 12px; line-height: 18px; text-align: center;
  }
  /* 批量勾选高亮：独立的 --checked class（勾选 ≠ 当前播放的 --selected）。 */
  .we-picker__card--checked {
    outline: 2px solid var(--we-accent, #4f8cff);
    outline-offset: -2px;
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--we-accent, #4f8cff) 45%, transparent),
      0 4px 16px color-mix(in srgb, var(--we-accent, #4f8cff) 30%, transparent);
  }
  .we-picker__card--checked .we-picker__card-check {
    background: var(--we-accent, #4f8cff);
  }
  /* Hidden wallpapers view: dimmed cards. */
  .we-picker__card--hidden { opacity: 0.78; }
  .we-picker__card--hidden .we-picker__card-title {
    background: linear-gradient(transparent, rgba(0, 0, 0, 0.78));
  }
  /* Batch-action bar. */
  .we-picker__batch-bar {
    padding: 4px 6px; border-radius: 6px;
    border: 1px dashed var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
  }
  /* Current-wallpaper summary (replaces the inline grid in settings). */
  .we-picker__summary {
    flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-size: 0.85em; opacity: 0.85;
  }
  /* ── Wallpaper picker modal (portalled onto <body>, z-index above the shell
     overlays). Fixed positioning from a body child is immune to ancestor
     transforms/backdrop-filters, which would otherwise trap it. ── */
  .we-picker__modal-overlay {
    position: fixed; inset: 0; z-index: 1000;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0, 0, 0, 0.55);
    -webkit-backdrop-filter: blur(3px);
    backdrop-filter: blur(3px);
    animation: we-overlay-in var(--we-dur, 200ms) var(--we-ease, ease-out);
  }
  .we-picker__modal {
    position: relative; z-index: 1001;
    width: min(760px, 92vw); max-height: 86vh;
    display: flex; flex-direction: column; gap: 10px;
    padding: 16px; border-radius: 14px;
    background: var(--dsw-alias-bg-layer-1, #202127);
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.25);
    /* 入场：轻微上浮 + 缩放 settle，expo-out；reduced-motion 由上面的
       媒体查询统一静止为瞬现。 */
    animation: we-modal-in 240ms var(--we-ease, ease-out);
  }
  @keyframes we-overlay-in { from { opacity: 0; } }
  @keyframes we-modal-in {
    from { opacity: 0; transform: translateY(10px) scale(0.98); }
  }
  .we-picker__modal-head {
    display: flex; align-items: center; justify-content: space-between;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.22));
  }
  .we-picker__modal-title { font-weight: 600; font-size: 0.95em; }
  .we-picker__modal-tabs { display: flex; gap: 6px; }
  .we-picker__tab {
    flex: 1; padding: 0; text-align: center; font-size: 0.82em; cursor: pointer;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
    border-radius: 6px; background: transparent;
    color: var(--dsw-alias-label-secondary, #888);
  }
  .we-picker__tab--active {
    background: var(--we-accent, #4f8cff);
    border-color: var(--we-accent, #4f8cff); color: #fff;
  }
  .we-picker__modal-body {
    overflow-y: auto; min-height: 0; flex: 1;
    display: flex; flex-direction: column; gap: 8px;
    overscroll-behavior: contain; /* 滚轮不穿透到背后的设置页 */
    /* modal 里 grid 的 max-height 被放开（见下），真正的滚动容器是这里 ——
       同样的 hover 放大震荡防护也要落在这层。 */
    overflow-x: hidden; /* fallback：老旧内核不认识 clip 时的平替 */
    overflow-x: clip;
    scrollbar-gutter: stable;
  }
  /* The modal is tall enough: let the grid fill it instead of its own 280px
     internal scroll (the modal body scrolls as a whole). */
  .we-picker__modal-body .we-picker__grid { max-height: none; }
  .we-picker__modal-foot { display: flex; align-items: center; justify-content: space-between; }
  /* Custom-upload section. */
  .we-picker__uploads {
    display: flex; flex-direction: column; gap: 6px;
    padding: 10px; border-radius: 10px;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.26));
    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.05));
  }
  .we-picker__file { flex: 1; min-width: 0; max-width: 260px; font-size: 0.8em; }
  .we-picker__uploads-list {
    display: flex; flex-direction: column; gap: 4px; max-height: 150px; overflow-y: auto;
  }
  .we-picker__uploads-item {
    display: flex; align-items: center; gap: 8px;
    padding: 3px 6px; border-radius: 6px;
    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.12));
  }
  .we-picker__uploads-name {
    flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-size: 0.82em;
  }
  .we-picker__uploads-path {
    flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-size: 0.8em; opacity: 0.85;
  }
  /* Playback-rate segmented control (video wallpapers only). Also reused as
     the 卡片样式 two-button switch (wrapped in .we-picker__seg). */
  .we-picker__seg { display: flex; gap: 4px; flex: 1; min-width: 0; }
  .we-picker__rate {
    flex: 1; padding: 0; text-align: center; font-size: 0.78em;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
    border-radius: 6px; background: transparent; cursor: pointer;
    color: var(--dsw-alias-label-secondary, #888);
  }
  .we-picker__rate + .we-picker__rate { margin-left: 0; }
  .we-picker__rate--active {
    background: var(--we-accent, #4f8cff);
    border-color: var(--we-accent, #4f8cff);
    color: #fff;
  }
  /* Rotation group editor thumbnail grid. */
  .we-picker__editor-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 6px; max-height: 220px; overflow-y: auto; padding: 2px;
    /* 同主网格：CD 架 hover 放大不得撑出水平滚动条（防震荡）。 */
    overflow-x: hidden; /* fallback：老旧内核不认识 clip 时的平替 */
    overflow-x: clip;
    scrollbar-gutter: stable;
  }
  .we-picker__editor-card {
    position: relative; height: 80px; padding: 0; cursor: pointer;
    display: block; overflow: hidden;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
    border-radius: 6px;
    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.15));
  }
  .we-picker__editor-card img {
    position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: cover; display: block;
  }
  .we-picker__editor-card--checked {
    outline: 2px solid var(--we-accent, #4f8cff);
    outline-offset: -2px;
  }
  .we-picker__editor-check {
    position: absolute; top: 4px; left: 4px; width: 18px; height: 18px;
    border-radius: 4px; background: rgba(0, 0, 0, 0.55); color: #fff;
    font-size: 12px; line-height: 18px; text-align: center;
  }

  /* ── Rope dock: chibi pull-cord + glass repo drawer ────────────────────────
     The rope floats over the chat (fixed, body-child → immune to ancestor
     transforms/backdrop-filters, same policy as the picker modal). It snaps to
     the TOP edge on release (any horizontal spot); the settle class animates
     that snap via top/left (tiny element, release-only). Dragging removes the
     settle class so the rope follows the pointer 1:1. Pulling it DOWN draws
     out the repo panel, which descends from the top like a drawer. Z-order:
     repo panel 995 < rope 996 (the rope stays grabbable/clickable as the
     panel's handle while it is out) < repo modal scrim 1003 < repo modal 1004. ── */
  .we-rope {
    position: fixed;
    z-index: 996;
    width: 52px; height: 57px;
    box-sizing: border-box;
    cursor: grab;
    touch-action: none;              /* keep the pointer stream unbroken */
    user-select: none; -webkit-user-select: none;
    outline-offset: 2px;
  }
  .we-rope:focus-visible {
    outline: 2px solid var(--we-accent, #4f8cff);
    border-radius: 12px;
  }
  .we-rope--dragging { cursor: grabbing; }
  .we-rope--settle {
    transition:
      top 280ms var(--we-ease, cubic-bezier(0.16, 1, 0.3, 1)),
      left 280ms var(--we-ease, cubic-bezier(0.16, 1, 0.3, 1));
  }
  /* Art box holds the chibi <img>. The PNG is transparent-backed, and
     object-fit: contain keeps its aspect ratio (no stretch) inside the box.
     No CSS filter here: a permanent drop-shadow on a fixed element over the
     wallpaper forces a filter layer that Chromium re-rasterises on any repaint
     (click/typing) and can momentarily flash white. The chibi's own outline
     keeps it readable, so we skip the filter entirely. */
  .we-rope__art {
    width: 100%; height: 100%;
    transition: transform var(--we-dur-fast, 120ms) var(--we-ease, ease);
  }
  .we-rope:hover .we-rope__art { transform: scale(1.06); }
  .we-rope__art img {
    display: block; width: 100%; height: 100%;
    object-fit: contain;
    pointer-events: none; /* drag/capture stays on the .we-rope box */
  }

  /* One-time update notice — a floating glass toast (bottom-center) that tells
     immersive/kiosk-window users about the white flash and its one fix. High
     z-index so it sits above the chat; buttons reuse the flat picker style. */
  .we-update-notice {
    position: fixed; left: 50%; bottom: 26px; z-index: 1100;
    transform: translateX(-50%);
    width: min(600px, 92vw);
    box-sizing: border-box;
    display: flex; flex-direction: column; gap: 10px;
    padding: 16px 18px; border-radius: 14px;
    background-color: color-mix(in srgb, var(--we-glass-color, #ffffff) calc(var(--we-glass-alpha, 0.5) * 90%), rgba(24, 28, 40, 0.82));
    background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.03) 40%, rgba(255, 255, 255, 0.01));
    -webkit-backdrop-filter: blur(var(--we-blur, 16px)) saturate(1.2);
    backdrop-filter: blur(var(--we-blur, 16px)) saturate(1.2);
    border: 1px solid rgba(255, 255, 255, 0.22);
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.18);
    color: inherit;
    animation: we-notice-in 240ms var(--we-ease, cubic-bezier(0.16, 1, 0.3, 1));
  }
  @keyframes we-notice-in { from { opacity: 0; transform: translate(-50%, 12px); } }
  .we-update-notice__title { font-weight: 600; font-size: 0.95em; }
  .we-update-notice__body { font-size: 0.82em; line-height: 1.5; opacity: 0.92; }
  .we-update-notice__body p { margin: 0 0 6px; }
  .we-update-notice__hint { font-size: 0.78em; opacity: 0.6; }
  .we-update-notice__btn { align-self: flex-end; }
  @media (prefers-reduced-motion: reduce) { .we-update-notice { animation: none !important; } }

  /* Glass repo side panel — docked right, locked to 1/4 of the viewport,
     full height, inner body scrolls. Same liquid-glass recipe as the settings
     window: reads the very same --we-blur / --we-saturate / --we-glass-alpha /
     --we-glass-color / --we-glass-brightness knobs, so the 玻璃 sliders in
     settings retint this panel live. Open/close = transform + opacity fade,
     token-driven; closed keeps visibility hidden (delayed so the fade-out
     finishes first) with pointer-events off. */
  .we-repo-panel {
    position: fixed; top: 0; right: 0;
    width: 25vw; max-width: 25vw;
    height: 100vh; height: 100dvh;
    z-index: 995;
    display: flex; flex-direction: column;
    padding: 14px;
    box-sizing: border-box;
    transform: translateY(-102%);
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition:
      transform 800ms cubic-bezier(0.45, 0, 0.55, 1),
      opacity 690ms cubic-bezier(0.45, 0, 0.55, 1),
      visibility 0s linear 800ms;
  }
  /* The glass (backdrop-filter + tint + shadow) lives ONLY on the open state:
     while closed the panel is off-screen and must not allocate a full-viewport
     backdrop-filter compositing layer (a fixed, always-present backdrop-filter
     layer is a known Chromium white-flash-on-repaint source). */
  .we-repo-panel--open {
    border-left: 1px solid rgba(255, 255, 255, 0.22);
    background-color: color-mix(in srgb, var(--we-glass-color, #ffffff) calc(var(--we-glass-alpha, 0.5) * 72%), transparent);
    background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.05) 38%, rgba(255, 255, 255, 0.02));
    -webkit-backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
    backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
    box-shadow:
      inset 1px 0 0 rgba(255, 255, 255, var(--we-glass-highlight, 0.32)),
      inset 0 1px 0 rgba(255, 255, 255, 0.14),
      -18px 0 44px rgba(0, 0, 0, 0.22);
    transform: translateY(0);
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transition:
      transform 800ms cubic-bezier(0.45, 0, 0.55, 1),
      opacity 690ms cubic-bezier(0.45, 0, 0.55, 1),
      visibility 0s;
  }
  .we-repo-panel__head {
    display: flex; align-items: center; justify-content: space-between;
    gap: 8px; flex: 0 0 auto;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.22));
  }
  .we-repo-panel__title { font-weight: 600; font-size: 0.95em; white-space: nowrap; }
  /* Body: THE scroll container. Content (the whole WallpaperPicker) grows
     freely; hover-scale overflow guards mirror the modal body's. */
  .we-repo-panel__body {
    flex: 1; min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;   /* wheel doesn't bleed into the chat behind */
    scrollbar-gutter: stable;
    display: flex; flex-direction: column;
    padding-top: 10px;
  }
  .we-repo-panel__body > .we-picker { flex: 1 0 auto; }
  /* Panel is tall: let grids fill instead of their own internal scroll caps —
     same release as the modal body uses. Layout styles themselves untouched. */
  .we-repo-panel .we-picker__grid { max-height: none; }
  /* Enlarged CD disc inside the panel context only (~1.4×), per design. The
     cover inset is %-based so it scales along; just resize the spindle hole.
     The platter stays a solid black vinyl (user asked to keep it black). */
  .we-repo-panel .we-vinyl {
    width: 176px; height: 176px;
    background: repeating-radial-gradient(circle at center, #191920 0 2px, #23232c 2px 4px);
    box-shadow:
      0 6px 18px rgba(0, 0, 0, 0.55),
      inset 0 0 0 1px rgba(255, 255, 255, 0.07);
  }
  .we-repo-panel .we-vinyl__hole { width: 16px; height: 16px; margin: -8px 0 0 -8px; }
  /* While the drawer is closed it is hidden but the picker stays mounted, so
     the vinyl's spin animation would keep running unseen — constant hidden
     compositor work that can contend with chat repaints and flash white.
     Freeze the disc until the drawer actually opens. */
  .we-repo-panel:not(.we-repo-panel--open) .we-vinyl { animation-play-state: paused; }
  /* Req: the CD-adjacent current-wallpaper card and the custom-wallpaper
     partition render as transparent glass instead of the dark surface layer,
     so the blur behind shows through. */
  .we-repo-panel .we-picker__current,
  .we-repo-panel .we-picker__uploads,
  .we-repo-panel .we-picker__uploads-item { background: transparent !important; }
  /* Repo-path picker modal → its own right-quarter liquid-glass window instead
     of the centred dark dialog. A transparent full-screen scrim keeps "click
     outside to close" + focus containment without dimming the page behind.
     (z-order: repo panel 995 < rope 996 < scrim 1003 < panel modal 1004.) */
  .we-repo-panel__modal-scrim {
    position: fixed; inset: 0; z-index: 1003;
    background: transparent;
  }
  .we-picker__modal--panel {
    position: fixed; top: 0; right: 0; z-index: 1004;
    box-sizing: border-box;
    width: 25vw; max-width: 25vw;
    height: 100dvh; max-height: 100dvh;
    border-radius: 0;
    border: 0; border-left: 1px solid rgba(255, 255, 255, 0.22);
    background-color: color-mix(in srgb, var(--we-glass-color, #ffffff) calc(var(--we-glass-alpha, 0.5) * 80%), transparent);
    background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.05) 38%, rgba(255, 255, 255, 0.02));
    -webkit-backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
    backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
    box-shadow:
      inset 1px 0 0 rgba(255, 255, 255, var(--we-glass-highlight, 0.32)),
      inset 0 1px 0 rgba(255, 255, 255, 0.14),
      -18px 0 44px rgba(0, 0, 0, 0.22);
    animation: we-repo-panel-in 800ms cubic-bezier(0.45, 0, 0.55, 1);
  }
  @keyframes we-repo-panel-in {
    from { transform: translateX(102%); opacity: 0; }
  }

  /* No backdrop-filter support: near-opaque tinted surface, same policy as the
     settings-window/sidebar fallbacks, so panel text stays readable. */
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .we-repo-panel {
      background-color: color-mix(in srgb, var(--we-glass-color, #ffffff) 92%, transparent);
      backdrop-filter: none; -webkit-backdrop-filter: none;
    }
    .we-picker__modal--panel {
      background-color: color-mix(in srgb, var(--we-glass-color, #ffffff) 94%, transparent);
      backdrop-filter: none; -webkit-backdrop-filter: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .we-rope--settle, .we-repo-panel, .we-picker__modal--panel, .we-repo-panel__modal-scrim { transition: none !important; }
    .we-picker__modal--panel { animation: none !important; }
  }
`;

// Bumped v2: force a fresh <style> injection even when a page still carries the
// old stylesheet tag from a previous bundle (TAG_ID dedupes the injection; a
// static id would leave stale CSS rules active and new rules missing).
const TAG_ID = "dsh-wallpaper-engine/styles-v2";
if (typeof document !== "undefined" &&
    document.querySelector("style[data-plugin-css=" + JSON.stringify(TAG_ID) + "]") === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "dsh-wallpaper-engine";
  tag.dataset.pluginCss = TAG_ID;
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

// ── Plugin exports ──────────────────────────────────────────────────────────
const inject = ["slots"];

// Immersive app-window (desktop shortcut → standalone / fullscreen / minimal-ui)
// windows composite on a different path than a normal tab, and Chromium can
// flash the WHOLE window white when a backdrop-filter surface re-rasterises
// over the wallpaper on interaction (click/typing). Detect that mode once and
// tag <body>; the CSS then drops the frosted blur there (translucent glass),
// while normal tabs keep the full frosted look.
function detectAppWindow() {
  try {
    if (typeof navigator !== "undefined" && navigator.standalone) return true; // iOS PWA
    if (typeof window === "undefined") return false;
    if (typeof window.matchMedia === "function"
        && (window.matchMedia("(display-mode: standalone)").matches
          || window.matchMedia("(display-mode: fullscreen)").matches
          || window.matchMedia("(display-mode: minimal-ui)").matches)) return true;
    // Desktop-shortcut / kiosk app window: it has NO browser chrome (tabs,
    // address bar), so the window's outer dimensions equal the inner viewport.
    // A normal tab's window is always larger than its viewport. This reliably
    // catches managed/kiosk/--app windows even when display-mode misreports.
    if (window.outerWidth === window.innerWidth && window.outerHeight === window.innerHeight) return true;
  } catch { /* ignore */ }
  return false;
}

function apply(ctx) {
  // Mark immersive/app-window mode so the CSS can stabilise the compositor there.
  try {
    if (typeof document !== "undefined" && document.body) {
      if (detectAppWindow()) document.body.setAttribute("data-we-appwindow", "on");
      else document.body.removeAttribute("data-we-appwindow");
    }
  } catch { /* ignore */ }

  // 1. Mount the behind-body wallpaper + scrim layers and keep them in sync
  //    with the selection store. ctx.effect gives fiber-lifetime cleanup.
  if (ctx.effect) {
    ctx.effect(() => {
      const unsub = subscribe(syncLayers);
      const unsubEffects = subscribe(applyEffects);
      // Occlusion pause: re-apply the effective playing state whenever the
      // page hides/shows or the window loses/gains focus (see occlusionActive).
      // Fires syncLayers → play/pause on the video; decode drops to 0 while
      // minimized / covered by another app, exactly like desktop WE.
      const onOcclusionChange = () => emit();
      let ocListeners = [];
      if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
        for (const t of ["visibilitychange", "blur", "focus"]) {
          window.addEventListener(t, onOcclusionChange);
          ocListeners.push(t);
        }
      }
      // Battery optimization (省电暂停): navigator.getBattery is deprecated but
      // still functional in Chromium; feature-detected so other engines just
      // no-op. 'chargingchange' covers plug/unplug; onOcclusionChange re-applies
      // the effective playing state.
      let batteryCleanup = null;
      let disposed = false;
      if (typeof navigator !== "undefined" && typeof navigator.getBattery === "function") {
        navigator.getBattery().then((bm) => {
          // The plugin effect may have been torn down (disable / HMR) while
          // this promise was pending — registering listeners then would leak.
          if (disposed) return;
          weBattery = bm;
          bm.addEventListener("chargingchange", onOcclusionChange);
          batteryCleanup = () => bm.removeEventListener("chargingchange", onOcclusionChange);
          emit(); // already on battery → pause immediately
        }).catch(() => { /* battery API unavailable: no-op */ });
      }
      syncLayers();
      applyEffects();
      return () => {
        disposed = true;
        unsub();
        unsubEffects();
        if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
          for (const t of ocListeners) window.removeEventListener(t, onOcclusionChange);
        }
        if (batteryCleanup) { batteryCleanup(); batteryCleanup = null; }
        weBattery = null;
        clearRotationTimer();
        abortTranscodeUpgrade(); // 含 clearUpgradePoll + AbortController.abort（否则卸载后 500ms 轮询永久泄漏）
        weStopDraw();
        const node = document.getElementById(LAYER_ID);
        if (node) { releaseLayerMedia(node); node.remove(); }
        const scrim = document.getElementById(SCRIM_ID);
        if (scrim) scrim.remove();
        clearEffects();
        document.body.removeAttribute(ACTIVE_ATTR);
      };
    });
  }

  // 2. Settings page as a FIRST-LEVEL settings section (mirrors the skin-center
  //    in dsh-web-ui-all: its own nav entry, rendered inside the panel content
  //    column). The picker renders inside the liquid-glass card shell.
  if (ctx.slots) {
    ctx.slots.inject("settings.section", () =>
      ctx.slots.register(
        { name: "settings.section", id: "wallpaper-engine", order: 500, label: "Wallpaper Engine" },
        () => React.createElement(WallpaperPickerSection),
      ),
    );
  }

  // 3. Chat-interface rope dock: the draggable pull-cord + glass repo side
  //    panel, portalled onto <body> under its own React root — independent of
  //    the settings view, floating above the conversation. Feature-detected
  //    (react-dom without createRoot → skip) so minimal host/mocks stay safe.
  if (ctx.effect && typeof document !== "undefined" &&
      typeof ReactDOM !== "undefined" && typeof ReactDOM.createRoot === "function") {
    ctx.effect(() => {
      let host = document.getElementById(ROPE_DOCK_ID);
      if (!host && document.body && typeof document.createElement === "function") {
        host = document.createElement("div");
        host.id = ROPE_DOCK_ID;
        document.body.appendChild(host);
      }
      if (!host) return undefined;
      const root = ReactDOM.createRoot(host);
      root.render(React.createElement(RopeDock, null));
      return () => {
        try { root.unmount(); } catch { /* already gone */ }
        if (host.parentNode) host.parentNode.removeChild(host);
      };
    });
  }

  // Settings first (host file, port-independent), then inventory — so the
  // selection restore inside loadInventory()'s revalidateSelection() sees the
  // persisted id and can resolve its media URL.
  loadPersisted().then(loadInventory);
}

exports.apply = apply;
exports.inject = inject;
return module.exports;
