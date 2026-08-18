window.__ModuleLoader__.load({
	id: "dsh-plugin-wallpaper-engine",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

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
		  blur: 16,
		  wallpaperBlur: 0,
		  speed: 1,
		  rotationEnabled: false,
		  rotationInterval: 30,
		  rotationGroupId: "",
		  rotationGroups: [],
		  rotationSeeded: false,
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
		      blur: clampNum(o.blur, 0, 40, DEFAULTS.blur),
		      wallpaperBlur: clampNum(o.wallpaperBlur, 0, 60, DEFAULTS.wallpaperBlur),
		      speed: clampNum(o.speed, 0.25, 2, DEFAULTS.speed),
		      rotationEnabled: o.rotationEnabled === true,
		      rotationGroupId: typeof o.rotationGroupId === "string" ? o.rotationGroupId : "",
		      rotationGroups: readRotationGroups(o.rotationGroups),
		      rotationSeeded: o.rotationSeeded === true,
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
		  // Draft of the rotation group currently being created/edited in the picker
		  // (null when the editor is closed). Mutated live; committed on 保存.
		  editing: null,
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
		      speed: selection.speed,
		      rotationEnabled: selection.rotationEnabled,
		      rotationGroupId: selection.rotationGroupId,
		      rotationGroups: selection.rotationGroups,
		      rotationSeeded: selection.rotationSeeded,
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

		  // After a refresh, drop the selection if the chosen wallpaper vanished or is
		  // no longer playable (avoids a dangling media URL).
		  if (selection.id && !selection.inventory.wallpapers.some((w) => w.id === selection.id && w.playable)) {
		    selection.id = "";
		    persistSelection();
		  }
		  if (selection.rotationEnabled && selection.id && !rotationCandidates().some((w) => w.id === selection.id)) {
		    selection.id = "";
		    persistSelection();
		  }
		  if (!selection.id && selection.rotationEnabled) {
		    const first = rotationCandidates()[0];
		    if (first) selection.id = first.id;
		  }
		  applySelection(selection.id);
		  emit();
		}

		function isRotatableWallpaper(w) {
		  return Boolean(w && w.playable && (w.type === "video" || w.type === "web"));
		}

		function playableInventory() {
		  return selection.inventory.wallpapers.filter(isRotatableWallpaper);
		}

		// ── Rotation groups (user-defined carousel lists) ───────────────────────────
		function activeRotationGroup() {
		  return selection.rotationGroups.find((g) => g.id === selection.rotationGroupId) || null;
		}

		function groupWallpapers(group) {
		  if (!group || !Array.isArray(group.wallpaperIds)) return [];
		  const byId = new Map(selection.inventory.wallpapers.map((w) => [w.id, w]));
		  return group.wallpaperIds.map((id) => byId.get(id)).filter(isRotatableWallpaper);
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
		    syncRotationTimer();
		    emit();
		    return;
		  }
		  const w = selection.inventory.wallpapers.find((x) => x.id === selection.id);
		  if (!w || !w.playable) {
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
		      try { video.playbackRate = selection.speed; } catch {}
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
		  const onTogglePlay = () => { selection.playing = !selection.playing; emit(); };
		  const onClear = () => applySelection("");
		  const onRefresh = () => loadInventory();
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

		  // macOS loose media has no sidecar preview image, so thumbnails fall back to
		  // the wallpaper itself: images render as <img>, videos show their first
		  // frame via a metadata-only <video> (no autoplay, just a still).
		  const cardThumb = (w) => w.preview
		    ? React.createElement("img", { src: w.preview, alt: w.title, loading: "lazy", onError: (e) => { e.target.style.display = "none"; } })
		    : (w.type === "image"
		        ? React.createElement("img", { src: w.media, alt: w.title, loading: "lazy" })
		        : (w.type === "video"
		            ? React.createElement("video", { src: w.media, preload: "metadata", muted: true, playsInline: true })
		            : React.createElement("span", { className: "we-picker__card-placeholder" }, "无预览")));
		  const onBorder = (pct) => { selection.border = pct / 100; persistSelection(); applyEffects(); emit(); };
		  const onBlur = (px) => { selection.blur = px; persistSelection(); applyEffects(); emit(); };
		  const onWallpaperBlur = (px) => { selection.wallpaperBlur = px; persistSelection(); applyEffects(); emit(); };
		  const onSpeed = (v) => { selection.speed = v; persistSelection(); const el = document.getElementById(LAYER_ID); const video = el && el.querySelector("video"); if (video) { try { video.playbackRate = v; } catch {} } emit(); };

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
		  // Only playable wallpapers are shown — Scene/Application cannot be embedded
		  // in the web UI, so hiding them keeps the grid useful. Image wallpapers are
		  // playable and stay in the grid (don't gate on rotation eligibility).
		  const playableList = list.filter((w) => w.playable);
		  const groups = sel.rotationGroups;
		  const group = activeRotationGroup();
		  const candidates = rotationCandidates();
		  const playableCount = candidates.length;
		  const editing = sel.editing;
		  const INTERVALS = [1, 5, 10, 30, 60, 120];
		  return React.createElement("div", { className: "we-picker" },
		    React.createElement("div", { className: "we-picker__grid" },
		      // "Close wallpaper" card — equivalent of the old first <option>.
		      React.createElement("button", {
		        className: "we-picker__card" + (sel.id ? "" : " we-picker__card--selected"),
		        type: "button",
		        onClick: onClear,
		        title: "关闭壁纸",
		      },
		      React.createElement("span", { className: "we-picker__card-close" }, "✕ 关闭"),
		      ),
		      playableList.length === 0
		        ? React.createElement("span", { className: "we-picker__hint" }, "没有可播放的壁纸")
		        : playableList.map((w) => React.createElement("button", {
		            key: w.id,
		            className: "we-picker__card" + (w.id === sel.id ? " we-picker__card--selected" : ""),
		            type: "button",
		            onClick: () => applySelection(w.id),
		            title: w.title,
		          },
		          cardThumb(w),
		          React.createElement("span", { className: "we-picker__card-title" }, w.title),
		          )),
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
		    // ── Rotation groups: user-defined carousel lists, each with its own
		    //    wallpaper set, interval and order. Fully client-side, so rotation no
		    //    longer depends on Wallpaper Engine's own playlist paths.
		    React.createElement("div", { className: "we-picker__row we-picker__playlist-row" },
		      React.createElement("span", { className: "we-picker__hint we-picker__label" }, "轮播列表"),
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
		          ? React.createElement("span", { className: "we-picker__hint" }, "没有可播放的 Video/Web 壁纸")
		          : playableInventory().map((w) => {
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
		              cardThumb(w),
		              checked && React.createElement("span", { className: "we-picker__editor-check" }, "✓"),
		              );
		            }),
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
		        title: "当前列表的切换间隔",
		      },
		      ...INTERVALS.map((minutes) =>
		        React.createElement("option", { key: minutes, value: String(minutes) }, minutes + " 分钟"),
		      )),
		      !sel.rotationGroupId && React.createElement("span", { className: "we-picker__hint" }, "请先选择或新建一个轮播列表"),
		      sel.rotationGroupId && playableCount < 2 && React.createElement("span", { className: "we-picker__hint" }, "当前列表至少需要 2 个可播放壁纸"),
		    ),
		    sel.id && React.createElement(React.Fragment, null,
		      SliderRow("播放速度", 0.25, 2, 0.25, sel.speed, onSpeed, sel.speed + "x"),
		      SliderRow("壁纸模糊", 0, 60, 1, sel.wallpaperBlur, onWallpaperBlur, sel.wallpaperBlur + "px"),
		      SliderRow("暗化", 0, 90, 5, Math.round(sel.scrim * 100), onScrim, Math.round(sel.scrim * 100) + "%"),
		      SliderRow("边框", 0, 90, 5, Math.round(sel.border * 100), onBorder, Math.round(sel.border * 100) + "%"),
		      SliderRow("玻璃", 0, 40, 1, sel.blur, onBlur, sel.blur + "px"),
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
		    --dsw-specific-input-major: rgba(255, 255, 255, 0.15);
		    --dsw-specific-bubble: rgba(255, 255, 255, 0.12);
		  }
		  body[data-ds-dark-theme][data-we-wallpaper] {
		    --dsw-specific-input-major: rgba(255, 255, 255, 0.06);
		    --dsw-specific-bubble: rgba(255, 255, 255, 0.05);
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
		    background-color: rgba(255, 255, 255, 0.1) !important;
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
		    background-color: rgba(255, 255, 255, 0.08) !important;
		  }
		  body[data-ds-dark-theme][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_boundaryError"],
		  body[data-ds-dark-theme][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_panel"] {
		    background-color: rgba(255, 255, 255, 0.05) !important;
		  }
		  body[data-ds-dark-theme][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_pane"],
		  body[data-ds-dark-theme][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_tabBar"],
		  body[data-ds-dark-theme][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_paneCard"],
		  body[data-ds-dark-theme][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_editorHeader"],
		  body[data-ds-dark-theme][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_explorerHeader"],
		  body[data-ds-dark-theme][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_gitHeader"],
		  body[data-ds-dark-theme][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_browserBar"],
		  body[data-ds-dark-theme][data-we-wallpaper] [data-dsh-better-sidebar] [class*="_terminalWrap"] {
		    background-color: rgba(255, 255, 255, 0.04) !important;
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
		  .we-picker__text { flex: 1; min-width: 0; }
		  .we-picker__editor {
		    display: flex; flex-direction: column; gap: 6px;
		    padding: 8px;
		    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
		    border-radius: 8px;
		  }
		  /* Wallpaper thumbnail grid (main picker). */
		  .we-picker__grid {
		    display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
		    gap: 8px; max-height: 280px; overflow-y: auto; padding: 2px;
		  }
		  .we-picker__card {
		    position: relative; width: 100%; padding: 0; cursor: pointer;
		    aspect-ratio: 16 / 9; display: block; overflow: hidden;
		    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
		    border-radius: 8px;
		    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.15));
		  }
		  .we-picker__card img, .we-picker__card video { width: 100%; height: 100%; object-fit: cover; display: block; }
		  .we-picker__card--selected {
		    outline: 2px solid var(--dsw-alias-brand-primary, #4f8cff);
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
		  .we-picker__card-placeholder {
		    position: absolute; inset: 0;
		    display: flex; align-items: center; justify-content: center;
		    font-size: 0.72em; opacity: 0.55;
		  }
		  /* Rotation group editor thumbnail grid. */
		  .we-picker__editor-grid {
		    display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
		    gap: 6px; max-height: 220px; overflow-y: auto; padding: 2px;
		  }
		  .we-picker__editor-card {
		    position: relative; width: 100%; padding: 0; cursor: pointer;
		    aspect-ratio: 16 / 10; display: block; overflow: hidden;
		    border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35));
		    border-radius: 6px;
		    background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.15));
		  }
		  .we-picker__editor-card img, .we-picker__editor-card video { width: 100%; height: 100%; object-fit: cover; display: block; }
		  .we-picker__editor-card--checked {
		    outline: 2px solid var(--dsw-alias-brand-primary, #4f8cff);
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
	},
});
