/**
 * rotation-crud.js — 轮播组 CRUD（草稿式编辑器），从 `src/client.js` 按族搬出，函数体逐字未改。
 *
 * 契约：
 *   1) 本文件不 import —— 构建期由 scripts/build-client.mjs 内联在正文之前，与正文同处一个扁平作用域；
 *      函数体引用的 selection / setSetting / setTransient / emit / weT 等自由名由正文与其它内联模块提供。
 *   2) 搬移只改了"声明住哪"：正文与拆前 src/client.js 的 1401–1482 行逐字节相同。
 *   3) 顶层状态只有字面量（若有）：不读正文的 const、不挂监听 ⇒ 无 TDZ 风险。
 */
// ── Rotation group CRUD (draft-based editor) ────────────────────────────────
function startEditGroup(id) {
  const group = selection.rotationGroups.find((g) => g.id === id);
  if (!group) return;
  setTransient("editing", JSON.parse(JSON.stringify(group)));
  emit();
}

function startCreateGroup() {
  setTransient("editing", {
    id: nextGroupId(),
    name: weT("轮播列表 {index}", { index: selection.rotationGroups.length + 1 }),
    interval: DEFAULTS.rotationInterval,
    order: "sequence",
    trigger: "interval",
    wallpaperIds: [],
  });
  emit();
}

function saveEditingGroup() {
  const draft = selection.editing;
  if (!draft) return;
  const idx = selection.rotationGroups.findIndex((g) => g.id === draft.id);
  const cleaned = {
    id: draft.id,
    name: typeof draft.name === "string" && draft.name.trim() ? draft.name.trim() : weT("轮播列表"),
    interval: clampNum(draft.interval, ROTATION_INTERVAL_MIN, ROTATION_INTERVAL_MAX, DEFAULTS.rotationInterval),
    trigger: draft.trigger === "videoEnd" ? "videoEnd" : "interval",
    order: draft.order === "random" ? "random" : "sequence",
    wallpaperIds: Array.isArray(draft.wallpaperIds)
      ? draft.wallpaperIds.filter((x) => typeof x === "string" && x)
      : [],
  };
  if (idx >= 0) selection.rotationGroups[idx] = cleaned;
  else selection.rotationGroups.push(cleaned);
  selection.rotationGroupId = cleaned.id;
  setTransient("editing", null);
  // 列表成员可能已变：进行中的轮换准备候选作废，下轮按新成员重评。
  cancelRotationPrepare();
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
  setTransient("editing", null);
  emit();
}

function deleteGroup(id) {
  const idx = selection.rotationGroups.findIndex((g) => g.id === id);
  if (idx < 0) return;
  selection.rotationGroups.splice(idx, 1);
  // 列表结构变化：进行中的轮换准备候选可能已不在活动列表 → 取消，下轮重评。
  cancelRotationPrepare();
  if (selection.rotationGroupId === id) {
    selection.rotationGroupId = "";
    if (selection.rotationEnabled) {
      const fallback = firstUsableGroup();
      if (fallback) selection.rotationGroupId = fallback.id;
      else selection.rotationEnabled = false;
    }
  }
  if (selection.editing && selection.editing.id === id) setSetting("editing", null);
  // 删除是**结构变更**，必须落盘：原来只 `splice` 内存、不调 persistSelection ⇒ 删掉的列表
  // 重启后「复活」。与 saveEditingGroup 同一条纪律：改完列表就 persist。
  persistSelection();
  syncRotationTimer();
  emit();
}

function importPlaylistIntoDraft(playlist) {
  if (!selection.editing || !playlist || !Array.isArray(playlist.wallpaperIds)) return;
  selection.editing.wallpaperIds = playlist.wallpaperIds.slice();
  emit();
}
