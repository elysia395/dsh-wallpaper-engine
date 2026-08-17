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
 */

const React = require("react");

const SETTINGS_KEY = "dsh-wallpaper-engine:selection";
const INVENTORY_URL = "/wallpaper-engine/inventory";
// Body attribute set while a wallpaper is active; CSS uses it to make the frame
// background transparent so the behind-body layer shows through.
const ACTIVE_ATTR = "data-we-wallpaper";
const LAYER_ID = "dsh-wallpaper-engine-layer";
const SCRIM_ID = "dsh-wallpaper-engine-scrim";

// ── Defaults ─────────────────────────────────────────────────────────────────
// scrim default is intentionally LOW now: iOS liquid glass needs the wallpaper
// colour to pass through the glass, so we no longer crush it behind a near-black
// scrim. Users can raise it back via the 暗化 slider for busy wallpapers.
const DEFAULTS = {
  scrim: 0.25,
  border: 0.35,
  blur: 24,
  wallpaperBlur: 0,
  rotationEnabled: false,
  rotationInterval: 30,
  playlistId: "",
};

// ── Persisted selection ─────────────────────────────────────────────────────
function clampNum(v, lo, hi, fallback) {
  return typeof v === "number" && v >= lo && v <= hi ? v : fallback;
}

function readPersisted() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { id: "", ...DEFAULTS };
    const o = JSON.parse(raw);
    return {
      id: typeof o.id === "string" ? o.id : "",
      scrim: clampNum(o.scrim, 0, 1, DEFAULTS.scrim),
      border: clampNum(o.border, 0, 1, DEFAULTS.border),
      blur: clampNum(o.blur, 0, 40, DEFAULTS.blur),
      wallpaperBlur: clampNum(o.wallpaperBlur, 0, 60, DEFAULTS.wallpaperBlur),
      rotationEnabled: o.rotationEnabled === true,
      rotationInterval: clampNum(o.rotationInterval, 1, 1440, DEFAULTS.rotationInterval),
      playlistId: typeof o.playlistId === "string" ? o.playlistId : "",
    };
  } catch {
    return { id: "", ...DEFAULTS };
  }
}

// ── Shared selection store (React + DOM layer share it) ────────────────────
const selection = {
  ...readPersisted(),
  url: null,
  type: null,
  playing: true,
  loading: false,
  rotationTimer: null,
  inventory: { installDir: null, wallpapers: [], total: 0, portableCount: 0, playlists: [], error: null },
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

function persistSelection() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      id: selection.id,
      scrim: selection.scrim,
      border: selection.border,
      blur: selection.blur,
      wallpaperBlur: selection.wallpaperBlur,
      rotationEnabled: selection.rotationEnabled,
      rotationInterval: selection.rotationInterval,
      playlistId: selection.playlistId,
    }));
  } catch { /* ignore */ }
}

async function loadInventory() {
  selection.loading = true;
  emit();
  try {
    const res = await fetch(INVENTORY_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("inventory HTTP " + res.status);
    const data = await res.json();
    selection.inventory = {
      installDir: data.installDir,
      wallpapers: data.wallpapers || [],
      total: data.total || 0,
      portableCount: data.portableCount || 0,
      playlists: Array.isArray(data.playlists) ? data.playlists : [],
      error: null,
    };
  } catch (err) {
    selection.inventory = {
      installDir: null,
      wallpapers: [],
      total: 0,
      portableCount: 0,
      playlists: [],
      error: String(err && err.message ? err.message : err),
    };
  }
  selection.loading = false;
  selection.loaded = true;

  if (selection.playlistId && !selectedPlaylist()) {
    selection.playlistId = "";
    persistSelection();
  }
  if (selection.rotationEnabled && !selection.playlistId) {
    const firstPlaylist = firstPlayablePlaylist();
    if (firstPlaylist) selection.playlistId = firstPlaylist.id;
  }

  // After a refresh, drop the selection if the chosen wallpaper vanished or is
  // no longer playable (avoids a dangling media URL).
  if (selection.id && !selection.inventory.wallpapers.some((w) => w.id === selection.id && isRotatableWallpaper(w))) {
    selection.id = "";
    persistSelection();
  }
  if (selection.rotationEnabled && selection.id && !playableWallpapers().some((w) => w.id === selection.id)) {
    selection.id = "";
    persistSelection();
  }
  if (!selection.id && selection.rotationEnabled) {
    const first = playableWallpapers()[0];
    if (first) selection.id = first.id;
  }
  applySelection(selection.id);
  emit();
}

function isRotatableWallpaper(w) {
  return Boolean(w && w.playable && (w.type === "video" || w.type === "web"));
}

function selectedPlaylist() {
  return selection.inventory.playlists.find((p) => p.id === selection.playlistId) || null;
}

function playlistWallpapers(playlist) {
  if (!playlist || !Array.isArray(playlist.wallpaperIds)) return [];
  const byId = new Map(selection.inventory.wallpapers.map((w) => [w.id, w]));
  return playlist.wallpaperIds
    .map((id) => byId.get(id))
    .filter(isRotatableWallpaper);
}

function playableWallpapers() {
  return playlistWallpapers(selectedPlaylist());
}

function firstPlayablePlaylist() {
  return selection.inventory.playlists.find((playlist) => playlistWallpapers(playlist).length > 0) || null;
}

function nextRotationWallpaper() {
  const list = playableWallpapers();
  if (list.length < 2) return null;
  const playlist = selectedPlaylist();
  if (playlist && playlist.order === "random") {
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
  if (playableWallpapers().length < 2) return;
  if (typeof window === "undefined" || typeof window.setTimeout !== "function") return;
  selection.rotationTimer = window.setTimeout(() => {
    selection.rotationTimer = null;
    if (!selection.rotationEnabled || !selection.id) return;
    const next = nextRotationWallpaper();
    if (next) applySelection(next.id);
  }, selection.rotationInterval * 60 * 1000);
}

function applySelection(id) {
  selection.id = id || "";
  persistSelection();
  if (!selection.id) {
    selection.url = null;
    selection.type = null;
    syncRotationTimer();
    emit();
    return;
  }
  const w = selection.inventory.wallpapers.find((x) => x.id === selection.id);
  if (!w || !isRotatableWallpaper(w)) {
    selection.url = null;
    selection.type = null;
    syncRotationTimer();
    emit();
    return;
  }
  selection.url = w.media;
  selection.type = w.type;
  syncRotationTimer();
  emit();
}

// ── Behind-body layer: wallpaper + scrim (plain DOM, NOT a slot) ───────────
function buildMedia(sel) {
  if (sel.type === "image") {
    const img = document.createElement("img");
    img.src = sel.url;
    img.alt = "";
    img.className = "we-media we-image";
    return img;
  }
  const media = sel.type === "video"
    ? document.createElement("video")
    : document.createElement("iframe");
  if (sel.type === "video") {
    media.src = sel.url;
    media.autoplay = true;
    media.loop = true;
    media.muted = true;
    media.setAttribute("playsinline", "");
    media.className = "we-media";
  } else {
    media.src = sel.url;
    media.setAttribute("frameborder", "0");
    media.setAttribute("scrolling", "no");
    media.className = "we-media we-iframe";
  }
  return media;
}

function syncLayers() {
  // 1. Wallpaper element.
  const existing = document.getElementById(LAYER_ID);
  if (selection.url) {
    const wantKey = selection.type + "\u0000" + selection.url;
    const gotKey = existing && existing.dataset.weKey;
    if (existing && gotKey !== wantKey) existing.remove();
    let node = document.getElementById(LAYER_ID);
    if (!node) {
      node = document.createElement("div");
      node.id = LAYER_ID;
      node.className = "we-layer";
      node.dataset.weKey = wantKey;
      node.appendChild(buildMedia(selection));
      document.body.appendChild(node);
    }
    const video = node.querySelector("video");
    if (video) {
      if (selection.playing) { try { video.play().catch(() => {}); } catch {} }
      else video.pause();
    }
  } else if (existing) {
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
function applyEffects() {
  const s = document.body.style;
  s.setProperty("--we-scrim-color", "rgba(0,0,0," + selection.scrim + ")");
  // Border emphasis: the border tokens are low-alpha hairlines; raise their
  // alpha via a neutral gray so both light and dark themes stay legible.
  s.setProperty("--we-border-alpha", String(selection.border));
  // Glass blur strength in px (0 disables the frosted-glass effect).
  s.setProperty("--we-blur", selection.blur + "px");
  // Wallpaper blur strength in px (blurs the wallpaper itself).
  s.setProperty("--we-wallpaper-blur", selection.wallpaperBlur + "px");
  // Compensate for the fringe the blur reveals by scaling the layer up.
  const scale = (1 + selection.wallpaperBlur * 0.006).toFixed(4);
  s.setProperty("--we-wallpaper-scale", scale);

  // Scrim immediacy: some composited/kiosk environments do not repaint a
  // z-index:-1 layer promptly when only an inherited CSS variable changes.
  // Write the resolved color DIRECTLY onto the scrim element's inline style and
  // then force a synchronous layout, so the change is visible on this frame no
  // matter how the browser layers the page.
  const scrim = document.getElementById(SCRIM_ID);
  if (scrim) {
    scrim.style.background = "rgba(0,0,0," + selection.scrim + ")";
  }
  // Force reflow so a stalled compositor picks up the new value immediately.
  if (document.body && document.body.offsetHeight !== undefined) {
    void document.body.offsetHeight;
  }
}

function clearEffects() {
  const s = document.body.style;
  s.removeProperty("--we-scrim-color");
  s.removeProperty("--we-border-alpha");
  s.removeProperty("--we-blur");
  s.removeProperty("--we-wallpaper-blur");
  s.removeProperty("--we-wallpaper-scale");
  const scrim = document.getElementById(SCRIM_ID);
  if (scrim) scrim.style.background = "";
}

// ── Settings picker ─────────────────────────────────────────────────────────
function SliderRow(label, min, max, step, value, onInput, suffix) {
  return React.createElement("div", { className: "we-picker__row we-picker__slider-row" },
    React.createElement("span", { className: "we-picker__hint we-picker__label" }, label),
    React.createElement("input", {
      className: "we-picker__slider", type: "range",
      min: String(min), max: String(max), step: String(step),
      value: String(value),
      // onInput fires continuously while dragging a range input (onChange may
      // only fire on release in some engines) — this is what makes the knob
      // feedback instant. onChange stays as a final commit fallback.
      onInput: (e) => onInput(Number(e.target.value)),
      onChange: (e) => onInput(Number(e.target.value)),
    }),
    React.createElement("span", { className: "we-picker__hint we-picker__value" }, suffix),
  );
}

function WallpaperPicker() {
  const sel = useStore();
  const onChange = (e) => applySelection(e.target.value);
  const onTogglePlay = () => { selection.playing = !selection.playing; emit(); };
  const onClear = () => applySelection("");
  const onRefresh = () => loadInventory();
  const onPlaylistChange = (e) => {
    selection.playlistId = e.target.value;
    const first = playableWallpapers()[0];
    if (selection.rotationEnabled) {
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
    if (selection.rotationEnabled && !selection.playlistId) {
      const firstPlaylist = firstPlayablePlaylist();
      if (firstPlaylist) selection.playlistId = firstPlaylist.id;
    }
    if (selection.rotationEnabled && !playableWallpapers().some((w) => w.id === selection.id)) {
      const first = playableWallpapers()[0];
      if (first) {
        applySelection(first.id);
        return;
      }
    }
    persistSelection();
    syncRotationTimer();
    emit();
  };
  const onRotationInterval = (e) => {
    selection.rotationInterval = clampNum(Number(e.target.value), 1, 1440, DEFAULTS.rotationInterval);
    persistSelection();
    syncRotationTimer();
    emit();
  };

  // Slider callbacks: keep the stored value in its canonical unit, then apply
  // the effect IMMEDIATELY (applyEffects writes the CSS var synchronously) so
  // the visual feedback is instant even if a listener/emit path is lagging;
  // emit() additionally re-renders the picker's numeric readouts.
  const onScrim = (pct) => { selection.scrim = pct / 100; persistSelection(); applyEffects(); emit(); };
  const onBorder = (pct) => { selection.border = pct / 100; persistSelection(); applyEffects(); emit(); };
  const onBlur = (px) => { selection.blur = px; persistSelection(); applyEffects(); emit(); };
  const onWallpaperBlur = (px) => { selection.wallpaperBlur = px; persistSelection(); applyEffects(); emit(); };

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
  const playlists = sel.inventory.playlists;
  const playlist = selectedPlaylist();
  const playableCount = playableWallpapers().length;
  return React.createElement("div", { className: "we-picker" },
    React.createElement("select", { className: "we-picker__select", value: sel.id, onChange },
      React.createElement("option", { value: "" }, "— 无（关闭） —"),
      ...list.map((w) => React.createElement("option", {
        key: w.id, value: w.id, disabled: !isRotatableWallpaper(w),
      }, (isRotatableWallpaper(w) ? "" : "[不可播放] ") + w.title)),
    ),
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
    React.createElement("div", { className: "we-picker__row we-picker__playlist-row" },
      React.createElement("span", { className: "we-picker__hint we-picker__label" }, "播放列表"),
      React.createElement("select", {
        className: "we-picker__playlist-select",
        value: sel.playlistId,
        onChange: onPlaylistChange,
        disabled: playlists.length === 0,
      },
      React.createElement("option", { value: "" }, playlists.length ? "— 选择播放列表 —" : "— 未检测到播放列表 —"),
      ...playlists.map((p) => React.createElement("option", {
        key: p.id, value: p.id,
      }, p.name + "（" + (p.portableCount || 0) + " 可播放）")),
      ),
    ),
    React.createElement("div", { className: "we-picker__row we-picker__rotation-row" },
      React.createElement("label", { className: "we-picker__rotation-toggle" },
        React.createElement("input", {
          type: "checkbox",
          checked: sel.rotationEnabled,
          onChange: onToggleRotation,
          disabled: !sel.playlistId || playableCount < 2,
        }),
        "自动轮转",
      ),
      React.createElement("select", {
        className: "we-picker__rotation-interval",
        value: String(sel.rotationInterval),
        onChange: onRotationInterval,
        disabled: !sel.rotationEnabled || !sel.playlistId || playableCount < 2,
        title: "自动轮转间隔",
      },
      ...[1, 5, 10, 30, 60, 120].map((minutes) =>
        React.createElement("option", { key: minutes, value: String(minutes) }, minutes + " 分钟"),
      )),
      !sel.playlistId && React.createElement("span", { className: "we-picker__hint" }, "请先选择播放列表"),
      sel.playlistId && playableCount < 2 && React.createElement("span", { className: "we-picker__hint" }, "当前播放列表至少需要 2 个可播放壁纸"),
    ),
    sel.id && React.createElement(React.Fragment, null,
      SliderRow("壁纸模糊", 0, 60, 1, sel.wallpaperBlur, onWallpaperBlur, sel.wallpaperBlur + "px"),
      SliderRow("暗化", 0, 90, 5, Math.round(sel.scrim * 100), onScrim, Math.round(sel.scrim * 100) + "%"),
      SliderRow("边框", 0, 90, 5, Math.round(sel.border * 100), onBorder, Math.round(sel.border * 100) + "%"),
      SliderRow("玻璃", 0, 40, 1, sel.blur, onBlur, sel.blur + "px"),
    ),
    React.createElement("div", { className: "we-picker__row" },
      React.createElement("span", { className: "we-picker__hint" },
        (playlist
          ? playlist.name + "：" + (playlist.total || 0) + " 项 · " + playableCount + " 可播放"
          : list.length + " 个壁纸 · " + sel.inventory.portableCount + " 可播放") +
        (sel.rotationEnabled ? " · 每 " + sel.rotationInterval + " 分钟轮转" : "")),
    ),
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
    filter: blur(var(--we-wallpaper-blur, 0px));
    transform: scale(var(--we-wallpaper-scale, 1));
    transform-origin: center;
  }

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
       - large-radius blur + HIGH saturation + slight brightness boost, so the
         wallpaper colour melts into a soft glow instead of a gray smear;
       - a light, low-alpha base (not a dark one) so the wallpaper shows through;
       - a 1px top highlight (refraction edge) + soft shadow for "thick glass";
       - blur radius + saturation both scale off --we-blur / --we-saturate.

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
    --dsw-specific-input-major: rgba(255, 255, 255, 0.18);
    --dsw-specific-bubble: rgba(255, 255, 255, 0.14);
  }
  body[data-ds-dark-theme][data-we-wallpaper] {
    --dsw-specific-input-major: rgba(255, 255, 255, 0.07);
    --dsw-specific-bubble: rgba(255, 255, 255, 0.06);
  }
  body[data-we-wallpaper] [data-composer-card],
  body[data-we-wallpaper] [class*="_bubble"] {
    -webkit-backdrop-filter: blur(var(--we-blur, 24px)) saturate(var(--we-saturate, 1.8)) brightness(1.08);
    backdrop-filter: blur(var(--we-blur, 24px)) saturate(var(--we-saturate, 1.8)) brightness(1.08);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, var(--we-glass-highlight, 0.3)),
      inset 0 -1px 0 rgba(255, 255, 255, 0.05),
      0 8px 32px rgba(0, 0, 0, var(--we-glass-shadow, 0.14));
  }

  /* Picker chrome. */
  .we-picker { display: flex; flex-direction: column; gap: 8px; }
  .we-picker__select { max-width: 100%; }
  .we-picker__row { display: flex; gap: 8px; align-items: center; }
  .we-picker__playlist-select { flex: 1; min-width: 0; }
  .we-picker__rotation-toggle { display: inline-flex; align-items: center; gap: 6px; }
  .we-picker__rotation-interval { margin-left: auto; }
  .we-picker__btn { cursor: pointer; }
  .we-picker__hint { font-size: 0.8em; opacity: 0.7; }
  .we-picker__error { font-size: 0.85em; opacity: 0.8; }
  .we-picker__slider { flex: 1; }
  .we-picker__slider-row { display: flex; align-items: center; gap: 8px; }
  .we-picker__label { min-width: 28px; }
  .we-picker__value { min-width: 40px; text-align: right; }
`;

const TAG_ID = "dsh-wallpaper-engine/styles";
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

function apply(ctx) {
  // 1. Mount the behind-body wallpaper + scrim layers and keep them in sync
  //    with the selection store. ctx.effect gives fiber-lifetime cleanup.
  if (ctx.effect) {
    ctx.effect(() => {
      const unsub = subscribe(syncLayers);
      const unsubEffects = subscribe(applyEffects);
      syncLayers();
      applyEffects();
      return () => {
        unsub();
        unsubEffects();
        clearRotationTimer();
        const node = document.getElementById(LAYER_ID);
        if (node) node.remove();
        const scrim = document.getElementById(SCRIM_ID);
        if (scrim) scrim.remove();
        clearEffects();
        document.body.removeAttribute(ACTIVE_ATTR);
      };
    });
  }

  // 2. Settings picker row (this slot is NOT the overlay; safe).
  if (ctx.slots) {
    ctx.slots.inject("settings.general.item", () =>
      ctx.slots.register(
        { name: "settings.general.item", id: "wallpaper-engine", order: 500, label: "Wallpaper Engine" },
        () => React.createElement(WallpaperPicker),
      ),
    );
  }

  loadInventory();
}

exports.apply = apply;
exports.inject = inject;
return module.exports;
