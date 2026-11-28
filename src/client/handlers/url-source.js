/**
 * url-source.js — 图片 URL 源（Bing 每日一图 / 用户直链），从 `src/client.js` 按族搬出，函数体逐字未改。
 *
 * 契约：
 *   1) 本文件不 import —— 构建期由 scripts/build-client.mjs 内联在正文之前，与正文同处一个扁平作用域；
 *      函数体引用的 selection / setTransient / emit / loadInventory 等自由名由正文与其它内联模块提供。
 *   2) 搬移只改了"声明住哪"：本文件正文与拆前 src/client.js 的 1683–1740 行逐字节相同。
 *   3) 本文件只有函数声明、无顶层状态：不读正文的 const、不挂监听 ⇒ 无 TDZ 风险。
 *   4) 宿主负责下载与落盘；成功后它就是一张普通自定义壁纸（筛选 / 轮播 / 玻璃照常）。
 */
// ── 图片 URL 源（Bing 每日一图 / 用户直链）────────────────────────────────────
// 宿主负责下载与落盘；成功后它就是一张普通自定义壁纸（筛选 / 轮播 / 玻璃照常）。
// 失败时宿主保留旧图，这里只把原因显示出来。
function onUrlDraft(e) {
  setTransient("urlDraft", e.target.value);
  emit();
}

async function importUrlWallpaper(kind) {
  const isBing = kind === "bing";
  const url = String(selection.urlDraft || "").trim();
  if (!isBing && !url) {
    setTransient("urlError", weT("请输入图片 URL"));
    emit();
    return;
  }
  setTransient("urlBusy", true);
  setTransient("urlError", "");
  setTransient("urlNote", "");
  emit();
  try {
    const payload = isBing ? { action: "add", kind: "bing" } : { action: "add", kind: "url", url };
    const res = await apiPostJson(URL_IMPORT_URL, payload, { parse: "always" });
    if (!res.ok) throw new Error(hostFailureReason(res));
    const data = res.data || {};
    setTransient("urlNote", data.duplicate
      ? weT("已更新这张 URL 壁纸")
      : weT(isBing ? "已添加 Bing 每日一图" : "已从 URL 添加壁纸"));
    if (!isBing) setTransient("urlDraft", "");
    await loadInventory();
    applySelection(data.id);
  } catch (err) {
    setTransient("urlError", weT("URL 导入失败：{error}", { error: weT(err && err.message ? err.message : err) }));
  }
  setTransient("urlBusy", false);
  emit();
}

async function refreshUrlWallpaper(id) {
  if (!id) return;
  setTransient("urlBusy", true);
  setTransient("urlError", "");
  setTransient("urlNote", "");
  emit();
  try {
    const res = await apiPostJson(URL_IMPORT_URL, { action: "refresh", id }, { parse: "always" });
    if (!res.ok) throw new Error(hostFailureReason(res));
    setTransient("urlNote", weT("已刷新这张 URL 壁纸"));
    await loadInventory();
  } catch (err) {
    setTransient("urlError", weT("刷新失败：{error}", { error: weT(err && err.message ? err.message : err) }));
  }
  setTransient("urlBusy", false);
  emit();
}

function addUrlWallpaper() { return importUrlWallpaper("url"); }
function addBingWallpaper() { return importUrlWallpaper("bing"); }
