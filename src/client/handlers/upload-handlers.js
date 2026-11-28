/**
 * upload-handlers.js — 自定义上传处理器（read-A 存储），从 `src/client.js` 按族搬出，函数体逐字未改。
 *
 * 契约：
 *   1) 本文件不 import —— 构建期由 scripts/build-client.mjs 内联在正文之前，与正文同处一个扁平作用域；
 *      函数体引用的 selection / setSetting / setTransient / emit / weT 等自由名由正文与其它内联模块提供。
 *   2) 搬移只改了"声明住哪"：正文与拆前 src/client.js 的 1514–1581 行逐字节相同。
 *   3) 顶层状态只有字面量（若有）：不读正文的 const、不挂监听 ⇒ 无 TDZ 风险。
 */
// ── Custom uploads (read-A storage) ─────────────────────────────────────────
// The HOST writes the uploaded bytes to its plugin-managed directory and
// serves them through the same token/media/preview routes as WE media; the
// client only POSTs the file, then refreshes the (already-merged) inventory.
const UPLOAD_URL = "/wallpaper-engine/upload";
const REMOVE_URL = "/wallpaper-engine/remove";
const URL_IMPORT_URL = "/wallpaper-engine/url-import";
const UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp", "video/mp4"];

// `isUploadedWallpaper(w)` / `isDirWallpaper(w)`（id 前缀判定）住在
// **src/picker/picker-model.js** —— ratingOf 的宽松分级与上传管理列表共用同一对判定。

async function uploadWallpaperFile(file) {
  const ctype = (file.type || "").toLowerCase();
  if (!UPLOAD_TYPES.includes(ctype)) {
    setTransient("uploadError", weT("仅支持 JPG / PNG / WebP 图片与 MP4 视频"));
    emit();
    return;
  }
  if (!/\.(jpe?g|png|webp|mp4)$/i.test(file.name)) {
    setTransient("uploadError", weT("文件扩展名需为 .jpg / .png / .webp / .mp4"));
    emit();
    return;
  }
  setTransient("uploading", true);
  setTransient("uploadError", "");
  setTransient("uploadNote", "");
  emit();
  try {
    const title = file.name.replace(/\.[^.]+$/, "").slice(0, 80);
    const res = await apiFetch(UPLOAD_URL + "?title=" + encodeURIComponent(title), {
      method: "POST",
      headers: { "Content-Type": ctype },
      body: file,
      parse: "always", // 失败时也要读宿主给的原因（4xx/5xx 的 {error}）
    });
    const data = res.data || {};
    if (!res.ok) throw new Error(hostFailureReason(res));
    // Host dedup: uploading the same file again returns the existing entry
    // (data.duplicate) instead of storing a second copy.
    if (data.duplicate) {
      setTransient("uploadNote", weT("已存在相同内容的壁纸，已直接选择原有的那张"));
    }
    await loadInventory();
    applySelection(data.id);
  } catch (err) {
    setTransient("uploadError", weT("上传失败：{error}", { error: weT(err && err.message ? err.message : err) }));
  }
  setTransient("uploading", false);
  emit();
}

async function removeUploadWallpaper(id) {
  if (!id) return;
  setTransient("uploading", true);
  setTransient("uploadError", "");
  emit();
  try {
    const res = await apiPostJson(REMOVE_URL, { id }, { parse: "always" });
    if (!res.ok) throw new Error(hostFailureReason(res));
    if (selection.id === id) applySelection("");
    await loadInventory();
  } catch (err) {
    setTransient("uploadError", weT("移除失败：{error}", { error: weT(err && err.message ? err.message : err) }));
  }
  setTransient("uploading", false);
  emit();
}
