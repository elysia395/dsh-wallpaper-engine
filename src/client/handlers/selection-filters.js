/**
 * selection-filters.js — 内容分级 / 类型筛选的调用点（判定本体仍住 src/picker/picker-model.js），
 * 从 `src/client.js` 按族搬出，函数体逐字未改。
 *
 * 契约：
 *   1) 本文件不 import —— 构建期由 scripts/build-client.mjs 内联在正文之前，与正文同处一个扁平作用域；
 *      函数体引用的 selection / setTransient / emit / applySelection 等自由名由正文提供。
 *   2) 搬移只改了"声明住哪"：本文件正文与拆前 src/client.js 的 1107–1209 行逐字节相同。
 *   3) 本文件只有函数声明、无顶层状态：不读正文的 const、不挂监听 ⇒ 无 TDZ 风险。
 *   4) 过滤判定仍是**单一真源**（src/picker/picker-model.js）：这里只做"读两个档 + 调模型 + 落选择"。
 */
// ── Content-rating + type filters ───────────────────────────────────────────
// 判定本身（`ratingOf` / `matchesRatingFilter` / `matchesTypeFilter` /
// `isPlayableType` / `isRotatableWallpaper` / `isHiddenWallpaper`）与它们的分级正则已抽到
// **src/picker/picker-model.js** —— 网格、轮换编辑器、轮换候选、自动选择与两个下拉的计数共用
// 同一份判定，判定留在本文件就会长出第二个真源。这里是**调用点**：两个过滤档从
// `selection` 显式传入，模型自己不读任何模块级状态。

// 选择被拒 / 被丢弃时的可读原因（`""` = 没有可解释的原因，正常应用）：壁纸层不渲染、
// 播放按钮因 !sel.url 变灰时，卡片上至少给出原因。类型档不在原因表里：它只筛选择器网格
// 的显示，不拦播放、也不影响轮播与「下一张」（keepPlayingWallpaper / isRotationEligible）。
function selectionBlockedNote(w) {
  if (!w) return weT("当前壁纸已不在列表里（可能已被移除或隐藏）");
  if (!isPlayableType(w)) return weT("这张壁纸没有可播放的媒体文件");
  if (!matchesRatingFilter(w, selection.contentRatingFilter)) return weT("这张壁纸的内容分级不在勾选的分级里 —— 在「内容分级」里勾上它所在的档即可播放");
  return "";
}

function playableInventory() {
  return playableWallpapers(
    selection.inventory.wallpapers, selection.contentRatingFilter, selection.typeFilter, selection.hiddenIds,
  );
}

/**
 * 把宿主的 WE 文件夹树摊平成选择器下拉的选项（层级用 `depth` 表达，渲染侧画缩进）。
 *
 * 为什么摊平：`<details>` 里的候选行是一维的，而层级信息只在树的形状里 —— 摊平后每项
 * 自带 `depth`，既保住"子夹缩进"的观感，也让"当前选中夹子的成员集"只有一个查法
 * （`find`）。过滤与计数都用**含后代**的并集（`deepWallpaperIds` / `deepUnresolvedCount`）：
 * WE 的树是"父夹包含子夹"，选中父夹要连子夹一起看。
 */
function flattenWallpaperFolders(folders, depth, out) {
  for (const folder of folders || []) {
    if (!folder || typeof folder !== "object" || !folder.id) continue;
    const deepIds = Array.isArray(folder.deepWallpaperIds)
      ? folder.deepWallpaperIds
      : (Array.isArray(folder.wallpaperIds) ? folder.wallpaperIds : []);
    out.push({
      id: folder.id,
      name: typeof folder.name === "string" ? folder.name : "",
      depth,
      wallpaperIds: deepIds,
      // 下拉里显示的是「夹子（含子夹）里有多少张**能落到清单里**的壁纸」；`unresolvedCount`
      // 是 WE 记着、清单里却没有的那部分（卸载残留），>0 时显示「6/11」。
      count: deepIds.length,
      unresolvedCount: typeof folder.deepUnresolvedCount === "number"
        ? folder.deepUnresolvedCount
        : (typeof folder.unresolvedCount === "number" ? folder.unresolvedCount : 0),
    });
    flattenWallpaperFolders(folder.subfolders, depth + 1, out);
  }
  return out;
}

// 「下一张」在轮播关闭时的池：与轮播候选同一份入选判据（内容安全 ∧ 可播放，不读类型档），
// 免得「类型档只筛显示」这条口径在轮播关闭的分支里漏掉一处。
function rotationPoolAll() {
  return selection.inventory.wallpapers.filter((w) =>
    isRotationEligible(w, selection.contentRatingFilter)
    && !isHiddenWallpaper(w.id, selection.hiddenIds));
}

// Re-validate the active selection against the current inventory + filters.
// Called after a refresh AND after changing the rating/type filter. 丢弃闸门是
// keepPlayingWallpaper：分级是内容闸门（勾选集合：勾上的档才允许播）；类型档只筛选择器
// 网格的**显示**，既不得把正在应用的壁纸干掉，也不得改变轮播成员与「下一张」（用户口径）。轮播在场时拿不到候选就换下一张；当前壁纸被勾选集合挡掉
// 时**立即换台**（「换得了就换，换不了才提示」）。
function revalidateSelection() {
  // 被过滤条件丢弃的选择要留下原因：先取下来，applySelection("") 会清掉
  // blockedNote，故在其之后写回 —— 否则用户改一次过滤条件，壁纸就无声变空白。
  let droppedNote = "";
  const cur = selection.id ? selection.inventory.wallpapers.find((w) => w.id === selection.id) : null;
  const keepCurrent = keepPlayingWallpaper(cur, selection.contentRatingFilter);
  // 「被勾选集合挡掉」这一支要区分于「壁纸被移除 / 已不在列表」：只有前者才自动换台。
  const droppedByRating = Boolean(cur) && isPlayableType(cur)
    && !matchesRatingFilter(cur, selection.contentRatingFilter);
  if (selection.id && !keepCurrent) {
    droppedNote = selectionBlockedNote(cur);
    setSetting("id", "");
  }
  // 轮播在场时：当前壁纸不在候选里就换下一张。候选判据（isRotationEligible：可播放 ∧
  // 勾选集合）不含类型档 ⇒ 切类型档既不会把人踢下台，也不会改变轮播成员与「下一张」。
  if (selection.rotationEnabled && selection.id
    && !rotationCandidates().some((w) => w.id === selection.id)) {
    const first = rotationCandidates()[0];
    setSetting("id", first ? first.id : "");
  }
  if (!selection.id && selection.rotationEnabled) {
    const first = rotationCandidates()[0];
    if (first) selection.id = first.id;
  }
  // 收窄分级档把当前壁纸挡掉 ⇒ 立即换到当前档内第一张可播候选（轮播分支上面已接手，
  // 这里兜「轮播关闭」与「轮播在场但候选为空」两种）；一张都找不到才留提示。
  if (!selection.id && droppedByRating) {
    const first = playableInventory()[0];
    if (first) selection.id = first.id;
  }
  applySelection(selection.id);
  // 仍然没有可播壁纸 → 把被排除的原因显示出来（有接手则不打扰）。
  if (droppedNote && !selection.id) setTransient("blockedNote", droppedNote);
  emit();
}
