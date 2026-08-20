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
};

// Selectable values for the two filters. Declared up top because
// readPersisted() validates against them at module load (const TDZ).
const RATING_VALUES = ["all", "everyone", "pg13", "mature", "unrated"];
const TYPE_VALUES = ["all", "video", "web", "image", "scene"];

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

function readPersisted() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { id: "", ...DEFAULTS };
    const o = JSON.parse(raw);
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
      playbackRate: clampNum(o.playbackRate, 0.25, 2, DEFAULTS.playbackRate),
      flip: o.flip === true,
      objectFit: ["cover", "contain", "center", "fill"].includes(o.objectFit)
        ? o.objectFit : DEFAULTS.objectFit,
      contentRatingFilter: RATING_VALUES.includes(o.contentRatingFilter)
        ? o.contentRatingFilter : DEFAULTS.contentRatingFilter,
      typeFilter: TYPE_VALUES.includes(o.typeFilter)
        ? o.typeFilter : DEFAULTS.typeFilter,
      pickerLayout: o.pickerLayout === "classic" ? "classic" : "fixed",
      accent: typeof o.accent === "string" && /^#[0-9a-f]{6}$/i.test(o.accent)
        ? o.accent : DEFAULTS.accent,
      glassAlpha: clampNum(o.glassAlpha, 0, 60, DEFAULTS.glassAlpha),
      glassColor: typeof o.glassColor === "string" && /^#[0-9a-f]{6}$/i.test(o.glassColor)
        ? o.glassColor : DEFAULTS.glassColor,
      glassWindow: o.glassWindow !== false,
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
  previewUrl: null,
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

function persistSelection() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
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
      flip: selection.flip,
      objectFit: selection.objectFit,
      contentRatingFilter: selection.contentRatingFilter,
      typeFilter: selection.typeFilter,
      pickerLayout: selection.pickerLayout,
      accent: selection.accent,
      glassAlpha: selection.glassAlpha,
      glassColor: selection.glassColor,
      glassWindow: selection.glassWindow,
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
      uploadDir: data.uploadDir || null,
      wallpapers: data.wallpapers || [],
      total: data.total || 0,
      portableCount: data.portableCount || 0,
      playlists: Array.isArray(data.playlists) ? data.playlists : [],
      error: null,
    };
  } catch (err) {
    selection.inventory = {
      installDir: null,
      uploadDir: null,
      wallpapers: [],
      total: 0,
      portableCount: 0,
      playlists: [],
      error: String(err && err.message ? err.message : err),
    };
  }
  selection.loading = false;
  selection.loaded = true;
  // Fresh inventory → reset pagination (the list changed under the user).
  selection.page = 0;
  selection.hiddenPage = 0;
  selection.editorPage = 0;

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
  // Empty inventory = the scan hasn't finished / the host isn't ready yet
  // (boot, bundle update, WSL mount lag). Keep the saved selection instead of
  // wiping it — re-validation runs again on the next successful refresh.
  if (selection.inventory.wallpapers.length === 0) return;
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

function groupWallpapers(group) {
  if (!group || !Array.isArray(group.wallpaperIds)) return [];
  const byId = new Map(selection.inventory.wallpapers.map((w) => [w.id, w]));
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
    syncRotationTimer();
    emit();
    return;
  }
  const w = selection.inventory.wallpapers.find((x) => x.id === selection.id);
  if (!w || !isRotatableWallpaper(w)) {
    selection.url = null;
    selection.type = null;
    selection.previewUrl = null;
    syncRotationTimer();
    emit();
    return;
  }
  selection.url = w.type === "scene" ? w.frameUrl : w.media;
  selection.type = w.type;
  // Keep the preview around so a failed static frame can fall back to it.
  selection.previewUrl = w.preview || null;
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
  emit();
}

function restoreWallpapers(ids) {
  const set = new Set(ids.filter(Boolean));
  if (!set.size) return;
  const before = selection.hiddenIds.length;
  selection.hiddenIds = selection.hiddenIds.filter((id) => !set.has(id));
  if (selection.hiddenIds.length !== before) {
    persistSelection();
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
function buildMedia(sel) {
  // Scene wallpapers render as a static frame image (extracted by the host),
  // exactly like an uploaded image — with a preview fallback on load failure.
  const isStill = sel.type === "image" || sel.type === "scene";
  const media = sel.type === "video"
    ? document.createElement("video")
    : isStill
      ? document.createElement("img")
      : document.createElement("iframe");
  // Custom uploads (id prefix "up-") get the user-chosen object-fit mode;
  // Wallpaper Engine media always keeps cover (its intended framing).
  const fitClass = sel.id && sel.id.indexOf("up-") === 0 ? " we-media--fit" : "";
  if (sel.type === "video") {
    media.src = sel.url;
    media.autoplay = true;
    media.loop = true;
    media.muted = true;
    media.setAttribute("playsinline", "");
    media.className = "we-media" + fitClass;
    // Native playbackRate — hardware-decoded, instant, no reload (and the
    // videos are muted anyway, so there is no audio to keep in sync).
    try { media.playbackRate = sel.playbackRate; } catch { /* ignore */ }
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
      // Keep the rate in sync on every layer sync (covers rate changes while
      // the same wallpaper keeps playing — instant, no media reload).
      try { if (video.playbackRate !== selection.playbackRate) video.playbackRate = selection.playbackRate; } catch { /* ignore */ }
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
  // iOS liquid glass: the backdrop "colour melt" (saturation) scales with the
  // blur radius, so the 玻璃 slider drives BOTH frosted depth and how strongly
  // the wallpaper colour bleeds through the glass (0 blur → no melt). Kept
  // gentle so the glass stays 通透 (clear) instead of oversaturated.
  s.setProperty("--we-saturate", String(1.15 + selection.blur * 0.028));
  s.setProperty("--we-glass-brightness", "1.04");
  // Wallpaper blur strength in px (blurs the wallpaper itself).
  s.setProperty("--we-wallpaper-blur", selection.wallpaperBlur + "px");
  // Compensate for the fringe the blur reveals by scaling the layer up.
  const scale = (1 + selection.wallpaperBlur * 0.006).toFixed(4);
  s.setProperty("--we-wallpaper-scale", scale);
  // Horizontal mirror: composed with the blur-compensation scale on the same
  // transform (scaleX(-1) is a pure compositor operation).
  s.setProperty("--we-wallpaper-flip", selection.flip ? "-1" : "1");
  // Fit mode for custom uploads (consumed by .we-media--fit only).
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
  s.removeProperty("--we-saturate");
  s.removeProperty("--we-glass-brightness");
  s.removeProperty("--we-wallpaper-blur");
  s.removeProperty("--we-wallpaper-scale");
  s.removeProperty("--we-wallpaper-flip");
  s.removeProperty("--we-object-fit");
  s.removeProperty("--we-accent");
  s.removeProperty("--we-glass-alpha");
  s.removeProperty("--we-glass-color");
  document.body.removeAttribute("data-we-glass-window");
  const scrim = document.getElementById(SCRIM_ID);
  if (scrim) scrim.style.background = "";
}

// ── Settings picker ─────────────────────────────────────────────────────────
// Thumbnail fallback for preview-less media (macOS loose files have no
// sidecar previews): images render themselves, videos show their first frame
// via preload=metadata (no playback), everything else falls back to 无预览.
const cardThumb = (w) => w.preview
  ? React.createElement("img", { src: w.preview, alt: w.title, loading: "lazy", onError: (e) => { e.target.style.display = "none"; } })
  : (w.type === "image"
      ? React.createElement("img", { src: w.media, alt: w.title, loading: "lazy", onError: (e) => { e.target.style.display = "none"; } })
      : (w.type === "video"
          ? React.createElement("video", { src: w.media, preload: "metadata", muted: true, playsInline: true, onError: (e) => { e.target.style.display = "none"; } })
          : React.createElement("span", { className: "we-picker__card-placeholder" }, "无预览")));

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
          })
        : React.createElement("span", { className: "we-vinyl__empty" }, "▦"),
    ),
    React.createElement("span", { className: "we-vinyl__hole" }),
  );
}

function WallpaperPicker() {
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

  // Slider callbacks: keep the stored value in its canonical unit, then apply
  // the effect IMMEDIATELY (applyEffects writes the CSS var synchronously) so
  // the visual feedback is instant even if a listener/emit path is lagging;
  // emit() additionally re-renders the picker's numeric readouts.
  const onScrim = (pct) => { selection.scrim = pct / 100; persistSelection(); applyEffects(); emit(); };
  const onBorder = (pct) => { selection.border = pct / 100; persistSelection(); applyEffects(); emit(); };
  const onBlur = (px) => { selection.blur = px; persistSelection(); applyEffects(); emit(); };
  const onWallpaperBlur = (px) => { selection.wallpaperBlur = px; persistSelection(); applyEffects(); emit(); };
  const onPlaybackRate = (v) => { selection.playbackRate = v; persistSelection(); emit(); };
  // 配色 (accent color) + 玻璃透明度 (glass transparency) + 玻璃颜色 (glass base
  // tint): applied instantly through applyEffects() (--we-accent /
  // --we-glass-alpha / --we-glass-color), persisted so the settings page keeps
  // its custom look across reloads.
  const onAccent = (hex) => {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
    selection.accent = hex;
    persistSelection(); applyEffects(); emit();
  };
  const onGlassColor = (hex) => {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
    selection.glassColor = hex;
    persistSelection(); applyEffects(); emit();
  };
  const onGlassAlpha = (pct) => {
    selection.glassAlpha = clampNum(pct, 0, 60, DEFAULTS.glassAlpha);
    persistSelection(); applyEffects(); emit();
  };

  // Close the picker modal (ESC / backdrop / close buttons share this path).
  const closePicker = () => {
    selection.pickerOpen = false;
    selection.batchMode = false;
    selection.batchSelected = [];
    emit();
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
  // Only playable Video/Web/Image wallpapers are shown — Scene/Application
  // cannot be embedded in the web UI, so hiding them keeps the grid useful.
  // Hidden (soft-deleted) wallpapers leave this list and move to the 已隐藏
  // section. The rating/type filters further narrow playableList.
  const playableList = list.filter((w) => isRotatableWallpaper(w) && !isHiddenWallpaper(w.id));
  // Per-category counts for the two filter dropdowns (playable, non-hidden):
  // they reflect what is actually available, independent of the active filters.
  const basePlayable = list.filter((w) => isPlayableType(w) && !isHiddenWallpaper(w.id));
  const ratingCount = (r) => basePlayable.filter((w) => ratingOf(w) === r).length;
  const typeCount = (t) => basePlayable.filter((w) => w.type === t).length;
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
            applyEffects();
            emit();
          },
        }),
        "设置窗口液态玻璃",
      ),
      React.createElement("span", { className: "we-picker__hint" },
        "整个设置窗口（含 General / 模型 / 插件等全部原生分区）跟随配色与透明度；关闭则恢复原生样式",
      ),
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
          onClick: () => { selection.pickerOpen = true; selection.modalView = "normal"; emit(); },
        }, "选择壁纸"),
      ),
    // ── Wallpaper picker modal. Portalled onto <body>: fixed positioning is
    //    immune to ancestor transforms/backdrop-filters (the shell's own glass
    //    effects would otherwise trap it), and z-index 1000 sits above the
    //    shell overlays. Close: ESC, backdrop click, or the close buttons. ──
    sel.pickerOpen && ReactDOM.createPortal(
      React.createElement("div", { className: "we-picker__modal-overlay", onClick: closePicker },
        React.createElement("div", {
          className: "we-picker__modal",
          "data-we-cards": sel.pickerLayout,
          onClick: (e) => e.stopPropagation(),
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
            }, "关闭"),
          ),
          React.createElement("div", { className: "we-picker__modal-tabs" },
            React.createElement("button", {
              className: "we-picker__btn we-picker__tab" + (sel.modalView === "hidden" ? "" : " we-picker__tab--active"),
              type: "button",
              onClick: () => { selection.modalView = "normal"; emit(); },
            }, "正常列表（" + playableList.length + "）"),
            React.createElement("button", {
              className: "we-picker__btn we-picker__tab" + (sel.modalView === "hidden" ? " we-picker__tab--active" : ""),
              type: "button",
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
                        onClick: () => applySelection(w.id),
                      },
                      cardThumb(w),
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
                  React.createElement("span", { className: "we-picker__hint we-picker__label" }, "内容分级"),
                  React.createElement("select", {
                    className: "we-picker__playlist-select",
                    value: sel.contentRatingFilter,
                    onChange: onRatingFilterChange,
                    title: "对应 Wallpaper Engine 的内容分级（project.json contentrating）",
                  },
                  React.createElement("option", { value: "all" }, "全部（" + basePlayable.length + "）"),
                  React.createElement("option", { value: "everyone" }, "Everyone / G（" + ratingCount("everyone") + "）"),
                  React.createElement("option", { value: "pg13" }, "PG13（" + ratingCount("pg13") + "）"),
                  React.createElement("option", { value: "mature" }, "Mature / R（" + ratingCount("mature") + "）"),
                  React.createElement("option", { value: "unrated" }, "未分级（" + ratingCount("unrated") + "）"),
                  ),
                  React.createElement("span", { className: "we-picker__hint we-picker__label" }, "类型"),
                  React.createElement("select", {
                    className: "we-picker__playlist-select",
                    value: sel.typeFilter,
                    onChange: onTypeFilterChange,
                    title: "按壁纸类型过滤",
                  },
                  React.createElement("option", { value: "all" }, "全部（" + basePlayable.length + "）"),
                  React.createElement("option", { value: "video" }, "视频（" + typeCount("video") + "）"),
                  React.createElement("option", { value: "web" }, "网页（" + typeCount("web") + "）"),
                  React.createElement("option", { value: "image" }, "图片（" + typeCount("image") + "）"),
                  React.createElement("option", { value: "scene" }, "场景（" + typeCount("scene") + "）"),
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
                    onKeyDown: (e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); }
                    },
                  },
                  React.createElement("span", { className: "we-picker__card-close" }, "✕ 关闭"),
                  ),
                  playableList.length === 0
                    ? React.createElement("span", { className: "we-picker__hint" }, "没有可播放的壁纸")
                    : (cdMode ? playableList : normalPage.items).map((w) => React.createElement("div", {
                        key: w.id,
                        className: "we-picker__card" + (w.id === sel.id ? " we-picker__card--selected" : ""),
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
                        onKeyDown: (e) => {
                          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); }
                        },
                      },
                      cardThumb(w),
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
      // Fit mode — applies to CUSTOM uploads only (WE media always keeps cover
      // to preserve its intended framing). 覆盖=cover 填充=contain 居中=center 拉伸=fill
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, "适配"),
        ["cover", "contain", "center", "fill"].map((mode) => {
          const label = { cover: "覆盖", contain: "填充", center: "居中", fill: "拉伸" }[mode];
          return React.createElement("button", {
            key: mode,
            className: "we-picker__btn we-picker__rate" + (sel.objectFit === mode ? " we-picker__rate--active" : ""),
            type: "button",
            title: mode,
            onClick: () => { selection.objectFit = mode; persistSelection(); applyEffects(); emit(); },
          }, label);
        }),
        React.createElement("span", { className: "we-picker__hint" }, "仅自定义壁纸"),
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
          onInput: (e) => { editing.name = e.target.value; emit(); },
        }),
      ),
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, "间隔"),
        React.createElement("select", {
          className: "we-picker__rotation-interval",
          value: String(editing.interval),
          onChange: (e) => { editing.interval = clampNum(Number(e.target.value), 1, 1440, DEFAULTS.rotationInterval); emit(); },
        },
        ...INTERVALS.map((minutes) =>
          React.createElement("option", { key: minutes, value: String(minutes) }, minutes + " 分钟"),
        )),
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, "顺序"),
        React.createElement("select", {
          className: "we-picker__playlist-select",
          value: editing.order,
          onChange: (e) => { editing.order = e.target.value; emit(); },
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
      // Playback speed — free-sliding slider (0.25x–2x, step="any"), applied
      // via native playbackRate. Video wallpapers only (web/iframe have none).
      sel.type === "video" && SliderRow("播放速度", 0.25, 2, "any", sel.playbackRate, onPlaybackRate, (Math.round(sel.playbackRate * 100) / 100) + "x"),
      // Horizontal mirror — scaleX(-1), compositor-only; works for video,
      // web (iframe) and (later) uploaded image wallpapers alike.
      React.createElement("label", { className: "we-picker__rotation-toggle" },
        React.createElement("input", {
          type: "checkbox",
          checked: sel.flip,
          onChange: (e) => { selection.flip = e.target.checked; persistSelection(); applyEffects(); emit(); },
        }),
        "水平翻转",
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
    /* Flip composes with the blur-compensation scale on the SAME transform
       (scaleX(-1) mirrors around the center; pure compositor work). */
    transform: scale(var(--we-wallpaper-scale, 1)) scaleX(var(--we-wallpaper-flip, 1));
    transform-origin: center;
  }
  /* Custom uploads: the user-chosen fit mode (覆盖/填充/居中/拉伸). WE media
     keeps cover above; only .we-media--fit reads the variable. */
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

  /* ── dsh-better-sidebar glass ──────────────────────────────────────────────
     The sidebar shell is portalled onto <body> under a stable host attribute
     "data-dsh-better-sidebar" (set by the plugin's own mount code), so we can
     target the whole tree without depending on its CSS-module hashes. Its root
     panels read the opaque --dsw-alias-bg-layer-1 token (hence the "black
     frame") — give them the SAME clear liquid-glass recipe as the
     composer/bubbles (faint specular sheen + gentle frosted melt), with blur
     radius + saturation driven by the 玻璃 slider (--we-blur / --we-saturate).
     Inner chrome surfaces that paint the same opaque tokens get a translucent
     base too; the blur lives on the root panels (one blur per shell). */
  body[data-we-wallpaper] [data-dsh-better-sidebar] [class*="_boundaryError"],
  body[data-we-wallpaper] [data-dsh-better-sidebar] [class*="_panel"] {
    background-color: rgba(255, 255, 255, calc(var(--we-glass-alpha, 0.15) * 0.66)) !important;
    background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.04) 38%, rgba(255, 255, 255, 0.01)) !important;
    -webkit-backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01) !important;
    backdrop-filter: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01) !important;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, var(--we-glass-highlight, 0.32)),
      inset 0 -1px 0 rgba(255, 255, 255, 0.08),
      inset 0 0 0 0.5px rgba(255, 255, 255, 0.06);
  }
  body[data-we-wallpaper] [data-dsh-better-sidebar] [class*="_pane"],
  body[data-we-wallpaper] [data-dsh-better-sidebar] [class*="_tabBar"],
  body[data-we-wallpaper] [data-dsh-better-sidebar] [class*="_paneCard"],
  body[data-we-wallpaper] [data-dsh-better-sidebar] [class*="_editorHeader"],
  body[data-we-wallpaper] [data-dsh-better-sidebar] [class*="_explorerHeader"],
  body[data-we-wallpaper] [data-dsh-better-sidebar] [class*="_gitHeader"],
  body[data-we-wallpaper] [data-dsh-better-sidebar] [class*="_browserBar"],
  body[data-we-wallpaper] [data-dsh-better-sidebar] [class*="_terminalWrap"] {
    background-color: rgba(255, 255, 255, calc(var(--we-glass-alpha, 0.15) * 0.53)) !important;
  }
  body[data-ds-dark-theme][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_boundaryError"],
  body[data-ds-dark-theme][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_panel"] {
    background-color: rgba(255, 255, 255, calc(var(--we-glass-alpha, 0.15) * 0.33)) !important;
  }
  body[data-ds-dark-theme][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_pane"],
  body[data-ds-dark-theme][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_tabBar"],
  body[data-ds-dark-theme][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_paneCard"],
  body[data-ds-dark-theme][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_editorHeader"],
  body[data-ds-dark-theme][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_explorerHeader"],
  body[data-ds-dark-theme][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_gitHeader"],
  body[data-ds-dark-theme][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_browserBar"],
  body[data-ds-dark-theme][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_terminalWrap"] {
    background-color: rgba(255, 255, 255, calc(var(--we-glass-alpha, 0.15) * 0.26)) !important;
  }

  /* Picker chrome. */
  .we-picker { display: flex; flex-direction: column; gap: 10px; }
  .we-picker__select { max-width: 100%; }
  .we-picker__row { display: flex; gap: 8px; align-items: center; }
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
    transition: transform 0.12s ease, box-shadow 0.12s ease;
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
  .we-picker__hint { font-size: 0.8em; opacity: 0.7; }
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
    background: var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.4));
  }
  .we-picker__slider::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    width: 14px; height: 14px; margin-top: -5px; border-radius: 50%;
    background: var(--dsw-alias-bg-layer-1, #fff);
    border: 2px solid var(--we-accent, #4f8cff);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  }
  .we-picker__slider::-moz-range-track {
    height: 4px; border-radius: 2px;
    background: var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.4));
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
    transition: background-color 120ms ease;
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.3);
  }
  .we-picker__switch input:checked + .we-picker__switch-track {
    background: #4f8cff;
  }
  .we-picker__switch-thumb {
    position: absolute; left: 3px; top: 3px;
    width: 18px; height: 18px; border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
    transition: transform 120ms ease;
  }
  .we-picker__switch input:checked + .we-picker__switch-track .we-picker__switch-thumb {
    transform: translateX(18px);
  }

  /* Custom chevron for the flat selects (appearance: none removed the native
     arrow; heights stay pinned at 26px so rows can never shift). */
  .we-picker select {
    background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M1 1l3 3 3-3' fill='none' stroke='%23888' stroke-width='1.4' stroke-linecap='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 8px center;
    padding-right: 24px;
  }

  /* Motion: state-only transitions (background/color/border — never layout),
     150ms ease; disabled entirely under prefers-reduced-motion. */
  .we-picker__btn, .we-picker select, .we-picker__card, .we-picker__editor-card,
  .we-picker__tab, .we-picker__rate, .we-picker__card-hide {
    transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease, box-shadow 150ms ease;
  }
  @media (prefers-reduced-motion: reduce) {
    .we-picker * { transition: none !important; }
  }
  .we-picker__slider { flex: 1; }
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
     Cards use a FIXED height + absolutely-positioned filling image, never
     aspect-ratio: some browsers (old Chromium/WebView) ignore aspect-ratio on
     cards and let percentage-height images resolve to their intrinsic size,
     which made previews bleed over the row above. inset:0 + overflow:hidden
     pins the image inside the card in every engine. */
  .we-picker__grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 8px; max-height: 280px; overflow-y: auto; padding: 2px;
  }
  .we-picker__card {
    position: relative; height: 92px; padding: 0; cursor: pointer;
    display: block; overflow: hidden;
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
    border-radius: 8px;
    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.15));
  }
  .we-picker__card img, .we-picker__card video {
    position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: cover; display: block;
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
    /* Compact CD-rack columns: ~7 cards per row at modal width. */
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    padding-bottom: 42px;
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
  .we-picker__modal[data-we-cards="classic"] .we-picker__card img,
  .we-picker[data-we-cards="classic"] .we-picker__card video,
  .we-picker__modal[data-we-cards="classic"] .we-picker__card video {
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
  /* Per-card "hide" button (soft delete) — top-right overlay. */
  .we-picker__card-hide {
    position: absolute; top: 4px; right: 4px; z-index: 2;
    padding: 2px 7px; font-size: 0.68em; line-height: 1.5;
    border: 0; border-radius: 4px; cursor: pointer;
    background: rgba(0, 0, 0, 0.6); color: #fff;
  }
  .we-picker__card-hide:hover { background: rgba(190, 50, 50, 0.9); }
  /* Batch-mode selection check — top-left overlay. */
  .we-picker__card-check {
    position: absolute; top: 4px; left: 4px; z-index: 2;
    width: 18px; height: 18px; border-radius: 4px;
    background: rgba(0, 0, 0, 0.6); color: #fff;
    font-size: 12px; line-height: 18px; text-align: center;
  }
  .we-picker__card--selected .we-picker__card-check {
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
  }
  .we-picker__modal {
    position: relative; z-index: 1001;
    width: min(760px, 92vw); max-height: 86vh;
    display: flex; flex-direction: column; gap: 10px;
    padding: 16px; border-radius: 14px;
    background: var(--dsw-alias-bg-layer-1, #202127);
    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.25);
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

  loadInventory();
}

exports.apply = apply;
exports.inject = inject;
return module.exports;
