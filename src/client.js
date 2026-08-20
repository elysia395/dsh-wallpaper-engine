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

// ── UI strings ──────────────────────────────────────────────────────────────
// All user-visible labels live in one table. Values are intentionally kept
// byte-identical to the shipped UI (including the Chinese/English mix noted in
// the README) so this refactor changes nothing visually; centralizing them is
// the first step toward wiring the plugin into DSH's locale namespaces.
const STR = {
  loadingScan: "扫描 Wallpaper Engine…",
  noWeDetected: "未检测到 Wallpaper Engine：",
  retry: "重试",
  refreshing: "刷新中…",
  refresh: "刷新",
  play: "播放",
  pause: "暂停",
  close: "关闭",
  cardName: "Wallpaper Engine",
  cardDesc: "本地 Wallpaper Engine 壁纸 · 液态玻璃主题",
  sectionAppearance: "外观",
  accent: "配色",
  custom: "自定义",
  customAccent: "自定义配色",
  glassColor: "玻璃颜色",
  customGlassColor: "自定义玻璃颜色",
  glassTransparency: "玻璃透明度",
  windowGlass: "设置窗口液态玻璃",
  windowGlassHint: "整个设置窗口（含 General / 模型 / 插件等全部原生分区）跟随配色与透明度；关闭则恢复原生样式",
  compactLayout: "紧凑布局",
  compactLayoutHint: "紧凑 CD 架：层叠 + 一页到底",
  compactOn: "CD 架：层叠 + 一页到底",
  compactOff: "常规网格 · 分页",
  noneSelected: "未选择壁纸",
  notSelected: "尚未选择壁纸",
  typeVideo: "视频壁纸",
  typeWeb: "网页壁纸",
  typeImage: "图片壁纸",
  typeScene: "场景壁纸（静态帧）",
  typeGeneric: "壁纸",
  playingSuffix: " · 播放中",
  pausedSuffix: " · 已暂停",
  pickWallpaper: "选择壁纸",
  normalTabPrefix: "正常列表（",
  hiddenTabPrefix: "已隐藏（",
  noHidden: "没有已隐藏的壁纸",
  hiddenCount: "已隐藏 ", // + N + " 张（仅从列表隐藏，不删除源文件）"
  hiddenCountTail: " 张（仅从列表隐藏，不删除源文件）",
  restoreAll: "全部恢复",
  restoreAllConfirm: "恢复全部 ", // + N + " 张已隐藏壁纸？"
  restoreAllConfirmTail: " 张已隐藏壁纸？",
  restore: "恢复",
  restoreThis: "恢复此壁纸",
  noPreview: "无预览",
  staticFrameBadge: "静态帧",
  playableCountHint: " 个可播放壁纸 · 点击卡片即应用",
  exitBatch: "退出批量",
  batch: "批量",
  batchSelected: "已选 ", // + N + " 张"
  batchSelectedTail: " 张",
  batchHide: "批量隐藏",
  batchHideConfirm: "隐藏选中的 ", // + N + " 张壁纸？可在「已隐藏」中随时恢复。"
  batchHideConfirmTail: " 张壁纸？可在「已隐藏」中随时恢复。",
  cancel: "取消",
  contentRating: "内容分级",
  typeFilter: "类型",
  allCountPrefix: "全部（",
  countSuffix: "）",
  everyoneOption: "Everyone / G（",
  pg13Option: "PG13（",
  matureOption: "Mature / R（",
  unratedOption: "未分级（",
  videoOption: "视频（",
  webOption: "网页（",
  imageOption: "图片（",
  sceneOption: "场景（",
  closeWallpaper: "✕ 关闭",
  closeWallpaperTitle: "关闭壁纸",
  noPlayable: "没有可播放的壁纸",
  hide: "隐藏",
  hideThis: "隐藏此壁纸（可在「已隐藏」中恢复）",
  escHint: "ESC / 点击遮罩关闭",
  sectionUploads: "自定义壁纸",
  storageLocation: "存储位置",
  change: "更改",
  uploadDirPlaceholder: "绝对路径，如 D:\\MyWallpapers",
  save: "保存",
  migrateHint: "已有文件会迁移到新位置",
  tildeHint: "支持 ~ 表示用户主目录",
  uploadLabel: "自定义",
  uploading: "上传中…",
  uploadedCount: "已上传 ", // + N + " 个"
  uploadedCountTail: " 个",
  formatHint: "格式仅限 JPG / PNG / MP4",
  remove: "移除",
  removeConfirm: "移除自定义壁纸「", // + T + "」？此操作会删除本地文件，且不可恢复。"
  removeConfirmTail: "」？此操作会删除本地文件，且不可恢复。",
  fitLabel: "适配",
  fitCustomOnly: "仅自定义壁纸",
  fitModes: { cover: "覆盖", contain: "填充", center: "居中", fill: "拉伸" },
  sectionRotation: "轮播列表",
  rotationEmpty: "— 暂无轮播列表 —",
  rotationPick: "— 选择轮播列表 —",
  rotationGroupMeta: " 可播放 · ", // name + N + this + M + " 分钟"
  minutes: " 分钟",
  newGroup: "新建",
  edit: "编辑",
  delete: "删除",
  deleteGroupConfirm: "删除轮播列表「", // + N + "」？"
  deleteGroupConfirmTail: "」？",
  name: "名称",
  interval: "间隔",
  order: "顺序",
  orderSequence: "顺序",
  orderRandom: "随机",
  selectedCount: "已选 ", // + N + " 个"
  selectedCountTail: " 个",
  importPlaylist: "从 WE 播放列表导入…",
  importPlaylistMeta: " 可播放）",
  autoRotate: "自动轮转",
  pickGroupFirst: "请先选择或新建一个轮播列表",
  needTwoPlayable: "当前列表至少需要 2 个可播放壁纸",
  sectionEffects: "壁纸效果",
  wallpaperBlur: "壁纸模糊",
  scrim: "暗化",
  border: "边框",
  glass: "玻璃",
  playbackRate: "倍速",
  flip: "水平翻转",
  groupMetaPrefix: "列表「", // + N + "」：" + M + " 项 · " + P + " 可播放 · 每 " + I + " 分钟 · "
  groupMetaCount: " 项 · ", // M + this + P + " 可播放 · 每 "
  groupMetaPlayable: " 可播放 · 每 ", // P + this + I + " 分钟 · "
  groupMetaMinutes: " 分钟 · ",
  rotatingSuffix: " · 自动轮转中",
  groupNameDefault: "轮播列表",
  groupNamePrefix: "轮播列表 ",
  uploadErrorFormat: "仅支持 JPG / PNG 图片与 MP4 视频",
  uploadErrorExt: "文件扩展名需为 .jpg / .png / .mp4",
  uploadDupNote: "已存在相同内容的壁纸，已直接选择原有的那张",
  uploadFailed: "上传失败：",
  removeFailed: "移除失败：",
  changeFailed: "更改失败：",
  dirRequired: "请输入存储位置路径",
  loadTimeout: "加载超时（host 无响应）",
  pageInfoPrefix: "共 ", // + count + " 个 · 第 "
  pageInfoMid: " 个 · 第 ", // page+1 + " / " + pages + " 页"
  pageInfoTail: " 页",
  prevPage: "‹ 上一页",
  nextPage: "下一页 ›",
};

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
      name: typeof g.name === "string" && g.name.trim() ? g.name.trim() : STR.groupNameDefault,
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
      playbackRate: clampNum(o.playbackRate, 0.5, 2, DEFAULTS.playbackRate),
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

// rAF-coalesced updates for high-frequency slider drags (P2): dragging a
// range input fires one event per pixel — without coalescing every event
// triggers a synchronous localStorage write, a full React re-render and a
// forced reflow. Coalescing to one frame keeps the visual feedback instant
// (CSS vars update next frame, ~16ms) while making the cost constant.
let effectsRaf = null;
function scheduleEffects() {
  if (effectsRaf !== null) return;
  if (typeof requestAnimationFrame !== "function") { applyEffects(); return; }
  effectsRaf = requestAnimationFrame(() => { effectsRaf = null; applyEffects(); });
}
let renderRaf = null;
function scheduleRender() {
  if (renderRaf !== null) return;
  if (typeof requestAnimationFrame !== "function") { emit(); return; }
  renderRaf = requestAnimationFrame(() => { renderRaf = null; emit(); });
}

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

async function loadInventory(force) {
  selection.loading = true;
  emit();
  // Timeout guard (P3): without one, a wedged host leaves the picker stuck on
  // "扫描 Wallpaper Engine…" forever. `force` (the 刷新 button) also asks the
  // host to bypass its inventory TTL cache.
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 15000) : null;
  try {
    const url = INVENTORY_URL + (force ? "?refresh=1" : "");
    const res = await fetch(url, { cache: "no-store", signal: controller ? controller.signal : undefined });
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
      error: err && err.name === "AbortError"
        ? STR.loadTimeout
        : String(err && err.message ? err.message : err),
    };
  } finally {
    if (timer) clearTimeout(timer);
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
    name: typeof source.name === "string" && source.name.trim() ? source.name.trim() : STR.groupNameDefault,
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
    name: STR.groupNamePrefix + (selection.rotationGroups.length + 1),
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
    name: typeof draft.name === "string" && draft.name.trim() ? draft.name.trim() : STR.groupNameDefault,
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
    selection.uploadError = STR.uploadErrorFormat;
    emit();
    return;
  }
  if (!/\.(jpe?g|png|mp4)$/i.test(file.name)) {
    selection.uploadError = STR.uploadErrorExt;
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
      selection.uploadNote = STR.uploadDupNote;
    }
    await loadInventory();
    applySelection(data.id);
  } catch (err) {
    selection.uploadError = STR.uploadFailed + (err && err.message ? err.message : err);
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
    selection.uploadError = STR.removeFailed + (err && err.message ? err.message : err);
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
    selection.uploadError = STR.dirRequired;
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
    selection.uploadError = STR.changeFailed + (err && err.message ? err.message : err);
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
    // SECURITY (S1): Web wallpapers are third-party Workshop content served
    // same-origin. Sandbox them WITHOUT allow-same-origin so their scripts get
    // an opaque origin — a malicious wallpaper can animate itself but cannot
    // reach the DSH page's localStorage or same-origin APIs. Relative
    // <img>/<script> subresources still load (no-cors requests).
    media.setAttribute("sandbox", "allow-scripts allow-forms");
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
// `onInput` fires continuously while dragging a range input (onChange may only
// fire on release in some engines) — that is what makes the knob feedback
// instant; callers coalesce it with scheduleEffects/scheduleRender. `onCommit`
// runs on release (the durable localStorage write + final apply).
function SliderRow(label, min, max, step, value, onInput, suffix, onCommit) {
  const commit = onCommit || onInput;
  return React.createElement("div", { className: "we-picker__row we-picker__slider-row" },
    React.createElement("span", { className: "we-picker__hint we-picker__label" }, label),
    React.createElement("input", {
      className: "we-picker__slider", type: "range",
      min: String(min), max: String(max), step: String(step),
      value: String(value),
      onInput: (e) => onInput(Number(e.target.value)),
      onChange: (e) => commit(Number(e.target.value)),
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
  const title = props.title || STR.noneSelected;
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
  // Manual refresh also bypasses the host's inventory TTL cache (?refresh=1).
  const onRefresh = () => loadInventory(true);
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
      if (!window.confirm(STR.deleteGroupConfirm + group.name + STR.deleteGroupConfirmTail)) return;
    }
    deleteGroup(group.id);
  };

  // Slider callbacks, split into input vs commit (P2): `onInput` fires once
  // per pixel while dragging and only updates the value + schedules the CSS
  // effect and re-render through rAF coalescing (scheduleEffects /
  // scheduleRender — instant visual feedback at constant cost); `onChange`
  // fires when the drag is released and does the one-off durable work
  // (localStorage write + final apply + re-render).
  const onScrim = (pct) => { selection.scrim = pct / 100; scheduleEffects(); scheduleRender(); };
  const onScrimCommit = (pct) => { selection.scrim = pct / 100; persistSelection(); applyEffects(); emit(); };
  const onBorder = (pct) => { selection.border = pct / 100; scheduleEffects(); scheduleRender(); };
  const onBorderCommit = (pct) => { selection.border = pct / 100; persistSelection(); applyEffects(); emit(); };
  const onBlur = (px) => { selection.blur = px; scheduleEffects(); scheduleRender(); };
  const onBlurCommit = (px) => { selection.blur = px; persistSelection(); applyEffects(); emit(); };
  const onWallpaperBlur = (px) => { selection.wallpaperBlur = px; scheduleEffects(); scheduleRender(); };
  const onWallpaperBlurCommit = (px) => { selection.wallpaperBlur = px; persistSelection(); applyEffects(); emit(); };
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
    scheduleEffects(); scheduleRender();
  };
  const onGlassAlphaCommit = (pct) => {
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
      React.createElement("span", { className: "we-picker__hint" }, STR.loadingScan));
  }
  if (sel.inventory.error) {
    return React.createElement("div", { className: "we-picker" },
      React.createElement("div", { className: "we-picker__error" },
        STR.noWeDetected + sel.inventory.error),
      React.createElement("button", {
        className: "we-picker__btn", type: "button", onClick: onRefresh, disabled: sel.loading,
      }, sel.loading ? STR.refreshing : STR.retry));
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
        STR.pageInfoPrefix + count + STR.pageInfoMid + (page + 1) + " / " + pages + STR.pageInfoTail),
      React.createElement("button", {
        className: "we-picker__btn", type: "button",
        disabled: page <= 0,
        onClick: onPrev,
      }, STR.prevPage),
      React.createElement("button", {
        className: "we-picker__btn", type: "button",
        disabled: page >= pages - 1,
        onClick: onNext,
      }, STR.nextPage),
    );

  return React.createElement("div", { className: "we-picker", "data-we-cards": sel.pickerLayout },
    // ── Card header (mirrors the skin-center's pluginCard header): plugin
    //    name + live wallpaper count badge + description. ──
    React.createElement("div", { className: "we-picker__card-head" },
      React.createElement("span", { className: "we-picker__card-name" }, STR.cardName),
      React.createElement("span", { className: "we-picker__card-badge" }, String(playableList.length)),
      React.createElement("span", { className: "we-picker__card-desc" }, STR.cardDesc),
    ),
    // ── 外观 (liquid-glass theming): 配色 presets + custom color, and the
    //    glass 透明度 slider. Applied instantly via --we-accent /
    //    --we-glass-alpha (applyEffects), persisted in localStorage. ──
    React.createElement("div", { className: "we-picker__section" },
      React.createElement("div", { className: "we-picker__section-head" },
        React.createElement("span", { className: "we-picker__section-label" }, STR.sectionAppearance),
      ),
      React.createElement("div", { className: "we-picker__row we-picker__accent-row" },
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, STR.accent),
        ACCENT_PRESETS.map((hex) => React.createElement("button", {
          key: hex,
          className: "we-picker__swatch" + (sel.accent === hex ? " we-picker__swatch--active" : ""),
          type: "button",
          style: { background: hex },
          title: hex,
          onClick: () => onAccent(hex),
          "aria-label": STR.accent + " " + hex,
        })),
        React.createElement("label", { className: "we-picker__swatch-custom" },
          React.createElement("input", {
            type: "color",
            value: sel.accent,
            onInput: (e) => onAccent(e.target.value),
            onChange: (e) => onAccent(e.target.value),
            title: STR.customAccent,
          }),
          React.createElement("span", { className: "we-picker__hint" }, STR.custom),
        ),
      ),
      // 玻璃颜色: the settings-window glass BASE tint. Defaults keep the stock
      // look (white light / deep navy dark); picking any preset or a custom
      // color tints the whole window glass in BOTH themes.
      React.createElement("div", { className: "we-picker__row we-picker__accent-row" },
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, STR.glassColor),
        GLASS_COLOR_PRESETS.map((hex) => React.createElement("button", {
          key: hex,
          className: "we-picker__swatch" + (sel.glassColor === hex ? " we-picker__swatch--active" : ""),
          type: "button",
          style: { background: hex },
          title: hex,
          onClick: () => onGlassColor(hex),
          "aria-label": STR.glassColor + " " + hex,
        })),
        React.createElement("label", { className: "we-picker__swatch-custom" },
          React.createElement("input", {
            type: "color",
            value: sel.glassColor,
            onInput: (e) => onGlassColor(e.target.value),
            onChange: (e) => onGlassColor(e.target.value),
            title: STR.customGlassColor,
          }),
          React.createElement("span", { className: "we-picker__hint" }, STR.custom),
        ),
      ),
      SliderRow(STR.glassTransparency, 0, 60, 5, sel.glassAlpha, onGlassAlpha, sel.glassAlpha + "%", onGlassAlphaCommit),
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
        STR.windowGlass,
      ),
      React.createElement("span", { className: "we-picker__hint" },
        STR.windowGlassHint,
      ),
    ),
    // ── Card-style switch: classic (WE's original aspect-ratio 16/9 cards —
    //    the CD-like look the author liked) vs the rewritten fixed-height
    //    cards that never overlap in older browsers. The vinyl record beside
    //    the selection stays in BOTH styles (here + modal head). ──
    React.createElement("div", { className: "we-picker__row" },
      React.createElement("span", { className: "we-picker__hint we-picker__label" }, STR.compactLayout),
      React.createElement("label", { className: "we-picker__switch", title: STR.compactLayoutHint },
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
          ? STR.compactOn
          : STR.compactOff),
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
            sel.id && current ? current.title : STR.noneSelected),
          React.createElement("div", { className: "we-picker__current-meta" },
            current
              ? ({ video: STR.typeVideo, web: STR.typeWeb, image: STR.typeImage, scene: STR.typeScene }[current.type] || STR.typeGeneric) + (sel.playing ? STR.playingSuffix : STR.pausedSuffix)
              : STR.notSelected),
        ),
        React.createElement("button", {
          className: "we-picker__btn we-picker__btn--primary", type: "button",
          onClick: () => { selection.pickerOpen = true; selection.modalView = "normal"; emit(); },
        }, STR.pickWallpaper),
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
              React.createElement("span", { className: "we-picker__modal-title" }, STR.pickWallpaper),
            ),
            React.createElement("button", {
              className: "we-picker__btn", type: "button", onClick: closePicker,
            }, STR.close),
          ),
          React.createElement("div", { className: "we-picker__modal-tabs" },
            React.createElement("button", {
              className: "we-picker__btn we-picker__tab" + (sel.modalView === "hidden" ? "" : " we-picker__tab--active"),
              type: "button",
              onClick: () => { selection.modalView = "normal"; emit(); },
            }, STR.normalTabPrefix + playableList.length + STR.countSuffix),
            React.createElement("button", {
              className: "we-picker__btn we-picker__tab" + (sel.modalView === "hidden" ? " we-picker__tab--active" : ""),
              type: "button",
              onClick: () => { selection.modalView = "hidden"; selection.batchMode = false; selection.batchSelected = []; emit(); },
            }, STR.hiddenTabPrefix + hiddenList.length + STR.countSuffix),
          ),
          sel.modalView === "hidden"
            ? React.createElement("div", { className: "we-picker__modal-body" },
                hiddenList.length === 0
                  ? React.createElement("span", { className: "we-picker__hint" }, STR.noHidden)
                  : React.createElement("div", { className: "we-picker__grid" },
                      React.createElement("div", { className: "we-picker__row" },
                        React.createElement("span", { className: "we-picker__hint" },
                          STR.hiddenCount + hiddenList.length + STR.hiddenCountTail),
                        React.createElement("button", {
                          className: "we-picker__btn", type: "button",
                          onClick: () => {
                            if (!window.confirm(STR.restoreAllConfirm + hiddenList.length + STR.restoreAllConfirmTail)) return;
                            restoreWallpapers(hiddenList.map((w) => w.id));
                          },
                        }, STR.restoreAll),
                      ),
                      (cdMode ? hiddenList : hiddenPageView.items).map((w) => React.createElement("div", {
                        key: w.id,
                        className: "we-picker__card we-picker__card--hidden",
                        role: "button",
                        tabIndex: 0,
                        title: w.title,
                        onClick: () => applySelection(w.id),
                      },
                      w.preview
                        ? React.createElement("img", {
                            src: w.preview, alt: w.title, loading: "lazy",
                            onError: (e) => { e.target.style.display = "none"; },
                          })
                        : React.createElement("span", { className: "we-picker__card-placeholder" }, STR.noPreview),
                      React.createElement("span", { className: "we-picker__card-title" }, w.title),
                      w.type === "scene" && React.createElement("span", { className: "we-picker__card-badge" }, STR.staticFrameBadge),
                      React.createElement("button", {
                        className: "we-picker__card-hide", type: "button",
                        title: STR.restoreThis,
                        onClick: (e) => { e.stopPropagation(); restoreWallpapers([w.id]); },
                      }, STR.restore),
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
                    playableList.length + STR.playableCountHint),
                  React.createElement("button", {
                    className: "we-picker__btn", type: "button",
                    onClick: () => { selection.batchMode = !selection.batchMode; selection.batchSelected = []; emit(); },
                    disabled: playableList.length === 0,
                    title: "多选后批量隐藏",
                  }, selection.batchMode ? STR.exitBatch : STR.batch),
                ),
                selection.batchMode && React.createElement("div", { className: "we-picker__row we-picker__batch-bar" },
                  React.createElement("span", { className: "we-picker__hint" }, STR.batchSelected + selection.batchSelected.length + STR.batchSelectedTail),
                  React.createElement("button", {
                    className: "we-picker__btn", type: "button",
                    disabled: selection.batchSelected.length === 0,
                    onClick: () => {
                      const n = selection.batchSelected.length;
                      if (!window.confirm(STR.batchHideConfirm + n + STR.batchHideConfirmTail)) return;
                      hideWallpapers(selection.batchSelected.slice());
                      selection.batchMode = false;
                      selection.batchSelected = [];
                      emit();
                    },
                  }, STR.batchHide),
                  React.createElement("button", {
                    className: "we-picker__btn", type: "button",
                    onClick: () => { selection.batchMode = false; selection.batchSelected = []; emit(); },
                  }, STR.cancel),
                ),
                React.createElement("div", { className: "we-picker__row we-picker__filter-row" },
                  React.createElement("span", { className: "we-picker__hint we-picker__label" }, STR.contentRating),
                  React.createElement("select", {
                    className: "we-picker__playlist-select",
                    value: sel.contentRatingFilter,
                    onChange: onRatingFilterChange,
                    title: "对应 Wallpaper Engine 的内容分级（project.json contentrating）",
                  },
                  React.createElement("option", { value: "all" }, STR.allCountPrefix + basePlayable.length + STR.countSuffix),
                  React.createElement("option", { value: "everyone" }, STR.everyoneOption + ratingCount("everyone") + STR.countSuffix),
                  React.createElement("option", { value: "pg13" }, STR.pg13Option + ratingCount("pg13") + STR.countSuffix),
                  React.createElement("option", { value: "mature" }, STR.matureOption + ratingCount("mature") + STR.countSuffix),
                  React.createElement("option", { value: "unrated" }, STR.unratedOption + ratingCount("unrated") + STR.countSuffix),
                  ),
                  React.createElement("span", { className: "we-picker__hint we-picker__label" }, STR.typeFilter),
                  React.createElement("select", {
                    className: "we-picker__playlist-select",
                    value: sel.typeFilter,
                    onChange: onTypeFilterChange,
                    title: "按壁纸类型过滤",
                  },
                  React.createElement("option", { value: "all" }, STR.allCountPrefix + basePlayable.length + STR.countSuffix),
                  React.createElement("option", { value: "video" }, STR.videoOption + typeCount("video") + STR.countSuffix),
                  React.createElement("option", { value: "web" }, STR.webOption + typeCount("web") + STR.countSuffix),
                  React.createElement("option", { value: "image" }, STR.imageOption + typeCount("image") + STR.countSuffix),
                  React.createElement("option", { value: "scene" }, STR.sceneOption + typeCount("scene") + STR.countSuffix),
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
                    title: STR.closeWallpaperTitle,
                    onKeyDown: (e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); }
                    },
                  },
                  React.createElement("span", { className: "we-picker__card-close" }, STR.closeWallpaper),
                  ),
                  playableList.length === 0
                    ? React.createElement("span", { className: "we-picker__hint" }, STR.noPlayable)
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
                      w.preview
                        ? React.createElement("img", {
                            src: w.preview, alt: w.title, loading: "lazy",
                            onError: (e) => { e.target.style.display = "none"; },
                          })
                        : React.createElement("span", { className: "we-picker__card-placeholder" }, STR.noPreview),
                      React.createElement("span", { className: "we-picker__card-title" }, w.title),
                      w.type === "scene" && React.createElement("span", { className: "we-picker__card-badge" }, STR.staticFrameBadge),
                      selection.batchMode
                        ? React.createElement("span", { className: "we-picker__card-check" },
                            selection.batchSelected.indexOf(w.id) >= 0 ? "✓" : "")
                        : React.createElement("button", {
                            className: "we-picker__card-hide", type: "button",
                            title: STR.hideThis,
                            onClick: (e) => { e.stopPropagation(); hideWallpapers([w.id]); },
                          }, STR.hide),
                      )),
                ),
                !cdMode && normalPage.pages > 1 && pagerRow(
                  playableList.length, normalPage.page, normalPage.pages,
                  () => { selection.page--; emit(); },
                  () => { selection.page++; emit(); },
                ),
              ),
          React.createElement("div", { className: "we-picker__modal-foot" },
            React.createElement("span", { className: "we-picker__hint" }, STR.escHint),
            React.createElement("button", {
              className: "we-picker__btn", type: "button", onClick: closePicker,
            }, STR.close),
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
      }, sel.playing ? STR.pause : STR.play),
      React.createElement("button", {
        className: "we-picker__btn", type: "button",
        onClick: onClear, disabled: !sel.id,
      }, STR.close),
      React.createElement("button", {
        className: "we-picker__btn", type: "button",
        onClick: onRefresh, disabled: sel.loading,
      }, sel.loading ? STR.refreshing : STR.refresh),
    ),
    ),
    // ── 自定义壁纸: local JPG/PNG/MP4 as wallpapers. Files are written by the
    //    host into its plugin-managed directory and served through the same
    //    media/preview routes (read-A storage: survives restarts, no quota
    //    limits). Uploads merge into the inventory on the host side. ──
    React.createElement("div", { className: "we-picker__section" },
      React.createElement("div", { className: "we-picker__section-head" },
        React.createElement("span", { className: "we-picker__section-label" }, STR.sectionUploads),
      ),
      React.createElement("div", { className: "we-picker__uploads" },
      // Storage location — users can point uploads at a non-system drive
      // (most people don't want wallpaper files piling up on C:). The host
      // persists the choice and migrates existing files on change.
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, STR.storageLocation),
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
        }, STR.change),
      ),
      sel.editingUploadDir && React.createElement("div", { className: "we-picker__row" },
        React.createElement("input", {
          className: "we-picker__text", type: "text",
          value: selection.uploadDirDraft,
          placeholder: STR.uploadDirPlaceholder,
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
        }, STR.save),
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: () => { selection.editingUploadDir = false; emit(); },
        }, STR.cancel),
      ),
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint" },
          STR.migrateHint),
        React.createElement("span", { className: "we-picker__hint" },
          STR.tildeHint),
      ),
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, STR.uploadLabel),
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
        sel.uploading && React.createElement("span", { className: "we-picker__hint" }, STR.uploading),
      ),
      sel.uploadError && React.createElement("div", { className: "we-picker__error" }, sel.uploadError),
      sel.uploadNote && React.createElement("div", { className: "we-picker__note" }, sel.uploadNote),
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint" }, STR.uploadedCount + uploadedList.length + STR.uploadedCountTail),
        React.createElement("span", { className: "we-picker__hint" }, STR.formatHint),
      ),
      uploadedList.length > 0 && React.createElement("div", { className: "we-picker__uploads-list" },
        uploadedList.map((w) => React.createElement("div", { key: w.id, className: "we-picker__uploads-item" },
          React.createElement("span", { className: "we-picker__uploads-name", title: w.title }, w.title),
          React.createElement("span", { className: "we-picker__hint" }, w.type === "video" ? "MP4" : "图片"),
          React.createElement("button", {
            className: "we-picker__btn", type: "button",
            disabled: sel.uploading,
            onClick: () => {
              if (!window.confirm(STR.removeConfirm + w.title + STR.removeConfirmTail)) return;
              removeUploadWallpaper(w.id);
            },
          }, STR.remove),
        )),
      ),
      // Fit mode — applies to CUSTOM uploads only (WE media always keeps cover
      // to preserve its intended framing). 覆盖=cover 填充=contain 居中=center 拉伸=fill
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, STR.fitLabel),
        ["cover", "contain", "center", "fill"].map((mode) => {
          const label = STR.fitModes[mode];
          return React.createElement("button", {
            key: mode,
            className: "we-picker__btn we-picker__rate" + (sel.objectFit === mode ? " we-picker__rate--active" : ""),
            type: "button",
            title: mode,
            onClick: () => { selection.objectFit = mode; persistSelection(); applyEffects(); emit(); },
          }, label);
        }),
        React.createElement("span", { className: "we-picker__hint" }, STR.fitCustomOnly),
      ),
      ),
    ),
    // ── 轮播列表: user-defined carousel lists, each with its own wallpaper
    //    set, interval and order. Fully client-side (localStorage). ──
    React.createElement("div", { className: "we-picker__section" },
      React.createElement("div", { className: "we-picker__section-head" },
        React.createElement("span", { className: "we-picker__section-label" }, STR.sectionRotation),
      ),
      React.createElement("div", { className: "we-picker__row we-picker__playlist-row" },
      React.createElement("select", {
        className: "we-picker__playlist-select",
        value: sel.rotationGroupId,
        onChange: onGroupChange,
        disabled: groups.length === 0,
      },
      React.createElement("option", { value: "" }, groups.length ? STR.rotationPick : STR.rotationEmpty),
      ...groups.map((g) => React.createElement("option", {
        key: g.id, value: g.id,
      }, g.name + "（" + groupWallpapers(g).length + STR.rotationGroupMeta + g.interval + STR.minutes + "）")),
      ),
      React.createElement("button", {
        className: "we-picker__btn", type: "button",
        onClick: startCreateGroup,
      }, STR.newGroup),
      React.createElement("button", {
        className: "we-picker__btn", type: "button",
        onClick: () => startEditGroup(sel.rotationGroupId),
        disabled: !sel.rotationGroupId,
      }, STR.edit),
      React.createElement("button", {
        className: "we-picker__btn", type: "button",
        onClick: onDeleteGroup,
        disabled: !sel.rotationGroupId,
      }, STR.delete),
    ),
    editing && React.createElement("div", { className: "we-picker__editor" },
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, STR.name),
        React.createElement("input", {
          className: "we-picker__text", type: "text",
          value: editing.name,
          onInput: (e) => { editing.name = e.target.value; emit(); },
        }),
      ),
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, STR.interval),
        React.createElement("select", {
          className: "we-picker__rotation-interval",
          value: String(editing.interval),
          onChange: (e) => { editing.interval = clampNum(Number(e.target.value), 1, 1440, DEFAULTS.rotationInterval); emit(); },
        },
        ...INTERVALS.map((minutes) =>
          React.createElement("option", { key: minutes, value: String(minutes) }, minutes + STR.minutes),
        )),
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, STR.order),
        React.createElement("select", {
          className: "we-picker__playlist-select",
          value: editing.order,
          onChange: (e) => { editing.order = e.target.value; emit(); },
        },
        React.createElement("option", { value: "sequence" }, STR.orderSequence),
        React.createElement("option", { value: "random" }, STR.orderRandom),
        ),
      ),
      React.createElement("div", { className: "we-picker__editor-grid" },
        playableInventory().length === 0
          ? React.createElement("span", { className: "we-picker__hint" }, STR.noPlayable)
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
                : React.createElement("span", { className: "we-picker__card-placeholder" }, STR.noPreview),
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
        React.createElement("span", { className: "we-picker__hint" }, STR.selectedCount + editing.wallpaperIds.length + STR.selectedCountTail),
        sel.inventory.playlists.length > 0 && React.createElement("select", {
          className: "we-picker__playlist-select",
          value: "",
          onChange: (e) => {
            const p = sel.inventory.playlists.find((pl) => pl.id === e.target.value);
            if (p) importPlaylistIntoDraft(p);
          },
        },
        React.createElement("option", { value: "" }, STR.importPlaylist),
        ...sel.inventory.playlists.map((p) => React.createElement("option", {
          key: p.id, value: p.id,
        }, p.name + "（" + (p.portableCount || 0) + STR.importPlaylistMeta)),
        ),
      ),
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: saveEditingGroup,
        }, STR.save),
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: cancelEditGroup,
        }, STR.cancel),
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
        STR.autoRotate,
      ),
      React.createElement("select", {
        className: "we-picker__rotation-interval",
        value: String(group ? group.interval : DEFAULTS.rotationInterval),
        onChange: onGroupInterval,
        disabled: !sel.rotationEnabled || !sel.rotationGroupId || playableCount < 2,
      },
      ...INTERVALS.map((minutes) =>
        React.createElement("option", { key: minutes, value: String(minutes) }, minutes + STR.minutes),
      )),
      !sel.rotationGroupId && React.createElement("span", { className: "we-picker__hint" }, STR.pickGroupFirst),
      sel.rotationGroupId && playableCount < 2 && React.createElement("span", { className: "we-picker__hint" }, STR.needTwoPlayable),
    ),
    ),
    sel.id && React.createElement("div", { className: "we-picker__section" },
      React.createElement("div", { className: "we-picker__section-head" },
        React.createElement("span", { className: "we-picker__section-label" }, STR.sectionEffects),
      ),
      React.createElement(React.Fragment, null,
      SliderRow(STR.wallpaperBlur, 0, 60, 1, sel.wallpaperBlur, onWallpaperBlur, sel.wallpaperBlur + "px", onWallpaperBlurCommit),
      SliderRow(STR.scrim, 0, 90, 5, Math.round(sel.scrim * 100), onScrim, Math.round(sel.scrim * 100) + "%", onScrimCommit),
      SliderRow(STR.border, 0, 90, 5, Math.round(sel.border * 100), onBorder, Math.round(sel.border * 100) + "%", onBorderCommit),
      SliderRow(STR.glass, 0, 60, 1, sel.blur, onBlur, sel.blur + "px", onBlurCommit),
      // Playback speed — native playbackRate, instant, no media reload. Video
      // wallpapers only (web/iframe wallpapers have no playbackRate).
      sel.type === "video" && React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, STR.playbackRate),
        [0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) =>
          React.createElement("button", {
            key: rate,
            className: "we-picker__btn we-picker__rate" + (sel.playbackRate === rate ? " we-picker__rate--active" : ""),
            type: "button",
            onClick: () => { selection.playbackRate = rate; persistSelection(); emit(); },
          }, String(rate).replace(/\.?0+$/, "") + "x"),
        ),
      ),
      // Horizontal mirror — scaleX(-1), compositor-only; works for video,
      // web (iframe) and (later) uploaded image wallpapers alike.
      React.createElement("label", { className: "we-picker__rotation-toggle" },
        React.createElement("input", {
          type: "checkbox",
          checked: sel.flip,
          onChange: (e) => { selection.flip = e.target.checked; persistSelection(); applyEffects(); emit(); },
        }),
        STR.flip,
      ),
      ),
    ),
    React.createElement("div", { className: "we-picker__row" },
      React.createElement("span", { className: "we-picker__hint" },
        (group
          ? STR.groupMetaPrefix + group.name + "」：" + group.wallpaperIds.length + STR.groupMetaCount + playableCount + STR.groupMetaPlayable + group.interval + STR.groupMetaMinutes + (group.order === "random" ? STR.orderRandom : STR.orderSequence)
          : playableList.length + STR.playableCountHint) +
        (sel.rotationEnabled ? STR.rotatingSuffix : "")),
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
// Injected by scripts/build-client.mjs from src/client.css (see build script).
const CSS = "__DSH_WE_CLIENT_CSS__";

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
