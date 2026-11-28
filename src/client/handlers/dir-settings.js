/**
 * dir-settings.js — 三个目录设置（上传目录 / 缓存目录 / WE 素材目录）的处理器，从 `src/client.js`
 * 按族搬出，函数体逐字未改。
 *
 * 契约：
 *   1) 本文件不 import —— 构建期由 scripts/build-client.mjs 内联在正文之前，与正文同处一个扁平作用域；
 *      函数体引用的 selection / setTransient / emit / loadInventory / syncLayers 等自由名由正文提供。
 *   2) 搬移只改了"声明住哪"：本文件正文与拆前 src/client.js 的 1742–1833 行逐字节相同。
 *   3) 顶层只有四个字面量路由常量（UPLOAD_DIR_URL / CACHE_DIR_URL / CACHE_DIR_BROWSE_URL /
 *      WE_ASSETS_DIR_URL）：不读正文的 const、不挂监听 ⇒ 无 TDZ 风险。
 *   4) 失败文案走 weT + hostFailureReason（与其它宿主路由同口径），搬迁不改语义。
 */
const UPLOAD_DIR_URL = "/wallpaper-engine/upload-dir";

// Change where custom uploads are stored. The host persists the choice to its
// config file (survives restarts) and migrates existing files by default —
// users can point uploads at a non-system drive without touching config files.
async function changeUploadDir(dir, migrate) {
  if (!dir || !String(dir).trim()) {
    setTransient("uploadError", weT("请输入存储位置路径"));
    emit();
    return;
  }
  setTransient("uploading", true);
  setTransient("uploadError", "");
  emit();
  try {
    const res = await apiPostJson(UPLOAD_DIR_URL,
      { dir: String(dir).trim(), migrate: migrate !== false }, { parse: "always" });
    if (!res.ok) throw new Error(hostFailureReason(res));
    setTransient("editingUploadDir", false);
    setTransient("uploadDirDraft", "");
    await loadInventory();
  } catch (err) {
    setTransient("uploadError", weT("更改失败：{error}", { error: weT(err && err.message ? err.message : err) }));
  }
  setTransient("uploading", false);
  emit();
}

const CACHE_DIR_URL = "/wallpaper-engine/cache-dir";
const CACHE_DIR_BROWSE_URL = "/wallpaper-engine/cache-dir/browse";

// Change where regenerable caches live (transcoded wallpapers / faststart variants /
// scene frames / video previews / media-bridge). The host persists the choice to its
// config file (survives restarts) and moves the known cache subdirectories by default —
// the point is not making users edit config files, and not letting a multi-GB cache
// pile up on the system drive. Nothing here is user-authored data: worst case the
// moved-away cache is rebuilt on demand.
async function changeCacheDir(dir, migrate) {
  if (!dir || !String(dir).trim()) {
    setTransient("cacheDirError", weT("请输入缓存位置路径"));
    emit();
    return;
  }
  setTransient("cacheDirError", "");
  setTransient("cacheDirNote", "");
  setTransient("cacheDirBusy", true);
  emit();
  try {
    const res = await apiPostJson(CACHE_DIR_URL,
      { dir: String(dir).trim(), migrate: migrate !== false }, { parse: "always" });
    if (!res.ok) throw new Error(hostFailureReason(res));
    const moved = Number((res.data && res.data.migrated) || 0);
    const skipped = Number((res.data && res.data.skipped) || 0);
    setTransient("editingCacheDir", false);
    setTransient("cacheDirDraft", "");
    setTransient("cacheDirBrowse", null);
    // 生效值一律以 host 的解析链为准（重新拉清单回显）—— 设了 DSH_WE_CACHE_DIR 时
    // 保存成功但生效值仍是环境变量那个目录，这条提示就是给那种情形看的。
    setTransient("cacheDirNote", skipped > 0
      ? weT("已迁移 {moved} 个缓存文件，{skipped} 个跳过", { moved, skipped })
      : weT("已迁移 {moved} 个缓存文件", { moved }));
    await loadInventory();
  } catch (err) {
    setTransient("cacheDirError", weT("更改失败：{error}", { error: weT(err && err.message ? err.message : err) }));
  }
  setTransient("cacheDirBusy", false);
  emit();
}

const WE_ASSETS_DIR_URL = "/wallpaper-engine/we-assets-dir";

// Set / clear the WE official-assets directory (host-persisted). Scene live
// rendering then serves official pixels via /api/local-assets instead of the
// renderer's programmatic recreations. Empty input clears the setting.
// 保存后刷新 inventory（weAssetsAvailable 进 syncLayers key）→ live 渲染页
// 带新参数重建，官方像素即刻生效。
async function changeWeAssetsDir(dir) {
  setTransient("weAssetsError", "");
  emit();
  try {
    const res = await apiPostJson(WE_ASSETS_DIR_URL,
      { dir: String(dir || "").trim() }, { parse: "always" });
    if (!res.ok) throw new Error(hostFailureReason(res));
    setTransient("editingWeAssetsDir", false);
    setTransient("weAssetsDirDraft", "");
    await loadInventory();
    syncLayers(); // 可用性变化进 key → live iframe 带/去 localAssets=1 重建
  } catch (err) {
    setTransient("weAssetsError", weT("保存失败：{error}", { error: weT(err && err.message ? err.message : err) }));
  }
  emit();
}
