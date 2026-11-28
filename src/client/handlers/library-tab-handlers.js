/**
 * library-tab-handlers.js — 「壁纸库」页签的处理器（渲染器只读值 + 调这些），从 `src/client.js`
 * 按族搬出，函数体逐字未改。
 *
 * 契约：
 *   1) 本文件不 import —— 构建期由 scripts/build-client.mjs 内联在正文之前，与正文同处一个扁平作用域；
 *      函数体引用的 selection / setSetting / setTransient / emit / loadInventory 等自由名由正文与
 *      其它内联模块提供。
 *   2) 搬移只改了"声明住哪"：本文件正文与拆前 src/client.js 的 2240–2384 行逐字节相同
 *      （复核：git show <拆前提交>:src/client.js | sed -n '2240,2384p'）。
 *   3) 本文件只有函数声明、无顶层状态：不读正文的 const、不挂监听 ⇒ 无 TDZ 风险。
 *   4) 段末的 WE 素材目录草稿/取消两个处理器按"渲染侧只读值"的口径留在这里；真正保存与浏览
 *      在 src/client/handlers/dir-settings.js（同一族的两半，读的是同一组 transient 键）。
 */
// ── 壁纸库页签的处理器（渲染器只读值 + 调这些）────────────────────────────────
// `src/panel-tabs.js` 的契约是「只读 + 组装 React 树」：**写设置 / 改状态 / 发通知都归这里**。
// 下面这些处理器是 ctx 的**供给方**（同模态框 / 属性面板那条契约）：渲染器只读值 + 调它们，
// 本身不引用 `selection` / `emit`，也不写本文件模块作用域的 `propsPanelOpen` /
// `pickerFocusPending` / `pickerOpener`（**别人的状态**）。
// 判据：`test/verify-client.mjs` 的接缝判据（页签与那两个渲染器同一条口径）。
function setPickerOpener(el) { pickerOpener = el; }
function onTogglePropsPanel() {
  propsPanelOpen = !propsPanelOpen;
  if (propsPanelOpen) {
    loadUserPropDefs(propTokenOf(selection), true);
  }
  emit();
}
/** 两个「选择壁纸」入口只差草稿标志：普通下钻（点卡片即应用）与轮播编辑器的草稿下钻。 */
function openPicker(draft) {
  setTransient("pickerOpen", true);
  setTransient("pickerDraft", draft);
  setTransient("modalView", "normal");
  pickerFocusPending = true; // 打开后焦点落入下钻视图（见 modalInitialFocus）
  emit();
}
function onOpenPicker() { openPicker(false); }
function onOpenPickerDraft() { openPicker(true); }
// 轮播列表编辑器的**草稿**（住在 selection.editing；保存才由 saveEditingGroup 落盘）。
function onEditName(e) {
  if (selection.editing) { selection.editing.name = e.target.value; emit(); }
}
function onEditInterval(e) {
  if (!selection.editing) return;
  // ⚠️ 取值域用 ROTATION_INTERVAL_MIN/MAX 而不是 schemaRange("rotationInterval")：
  // `rotationInterval` 是 DEFAULTS_ONLY 键（**不在 KINDS 里**）⇒ 问 KINDS 得到的是
  // [undefined, undefined] ⇒ clampNum 恒回落默认值 30，界面上"选任何时间都无效"
  // （issue #230 的根因）。真源见 lib/settings-schema.js 的那对常量。
  selection.editing.interval = clampNum(Number(e.target.value), ROTATION_INTERVAL_MIN, ROTATION_INTERVAL_MAX, DEFAULTS.rotationInterval);
  emit();
}
function onEditTrigger(e) {
  if (!selection.editing) return;
  selection.editing.trigger = e.target.value === "videoEnd" ? "videoEnd" : "interval";
  emit();
}
function onEditOrder(e) {
  if (selection.editing) { selection.editing.order = e.target.value; emit(); }
}
// 两个可编辑路径（上传目录 / 官方资源路径）的**草稿**状态 —— 都在 selection 的瞬态字段里。
function onStartEditUploadDir() {
  setTransient("editingUploadDir", true);
  setTransient("uploadDirDraft", selection.inventory.uploadDir || "");
  emit();
}
function onUploadDirDraft(e) { setTransient("uploadDirDraft", e.target.value); emit(); }
function onCancelEditUploadDir() { setTransient("editingUploadDir", false); emit(); }
function onCacheDirDraft(e) { setTransient("cacheDirDraft", e.target.value); emit(); }
// 缓存位置（高级页签）的草稿态 —— 与上传目录同口径：生效值从 inventory 取。
// 「更改」= 打开草稿行（保留确认/迁移提示那一步）**并**弹出目录浏览器 —— 网页拿不到
// 原生选择框（给不了绝对路径），这块面板就是等价物：宿主列目录、用户点着进出。
function onStartEditCacheDir() {
  setTransient("editingCacheDir", true);
  setTransient("cacheDirDraft", selection.inventory.cacheDir || "");
  setTransient("cacheDirError", "");
  setTransient("cacheDirNote", "");
  openCacheDirBrowse(selection.inventory.cacheDir || "");
  emit();
}
function openCacheDirBrowse(path) {
  setTransient("cacheDirBrowse", {
    path: path || "", display: path || "", dirs: [], parent: null,
    home: "", truncated: false, loading: true, error: "",
  });
  browseCacheDir(path);
}
function onCloseCacheDirBrowse() { setTransient("cacheDirBrowse", null); emit(); }
function onCacheDirBrowseInput(e) {
  const b = selection.cacheDirBrowse;
  if (b) setTransient("cacheDirBrowse", { ...b, display: e.target.value });
  emit();
}
function onCacheDirBrowseGo() {
  const b = selection.cacheDirBrowse;
  if (b) browseCacheDir(b.display);
}
function onCacheDirBrowseEnter(entryPath) { browseCacheDir(entryPath); }
function onCacheDirBrowseUp() {
  const b = selection.cacheDirBrowse;
  if (b && b.parent) browseCacheDir(b.parent);
}
// 选中：地址栏草稿（改了没跳转也算数）填进 cacheDirDraft，收起浏览器 —— 保存/迁移
// 语义仍在草稿行那一步（与上传目录同族口径：选完还要按保存）。
function onPickCacheDir() {
  const b = selection.cacheDirBrowse;
  const picked = b ? String(b.display || b.path || "").trim() : "";
  if (picked) setTransient("cacheDirDraft", picked);
  setTransient("cacheDirBrowse", null);
  setTransient("editingCacheDir", true);
  emit();
}
// 拉一级目录列表（根视图传空）。失败**保住旧列表**只亮错误行：浏览是辅助，
// 不能因为一次读失败把用户已经走到的位置丢掉。
async function browseCacheDir(path) {
  const prev = selection.cacheDirBrowse || {};
  setTransient("cacheDirBrowse", { ...prev, path: path || "", loading: true, error: "" });
  emit();
  try {
    const q = path ? "?path=" + encodeURIComponent(path) : "";
    const res = await apiJson(CACHE_DIR_BROWSE_URL + q, { parse: "always" });
    if (!res.ok) throw new Error(hostFailureReason(res));
    const d = res.data || {};
    setTransient("cacheDirBrowse", {
      path: d.current || "",
      display: d.current || "",
      home: d.home || "",
      dirs: Array.isArray(d.dirs) ? d.dirs : [],
      parent: d.parent || null,
      truncated: d.truncated === true,
      loading: false,
      error: "",
    });
  } catch (err) {
    setTransient("cacheDirBrowse", {
      ...prev,
      loading: false,
      error: weT("无法读取该目录：{error}", { error: weT(err && err.message ? err.message : err) }),
    });
  }
  emit();
}
function onCancelEditCacheDir() {
  setTransient("editingCacheDir", false);
  setTransient("cacheDirBrowse", null);
  setTransient("cacheDirError", "");
  emit();
}
function onStartEditWeAssetsDir() {
  setTransient("editingWeAssetsDir", true);
  setTransient("weAssetsDirDraft", selection.inventory.weAssetsDir || "");
  setTransient("weAssetsError", "");
  emit();
}
function onWeAssetsDirDraft(e) { setTransient("weAssetsDirDraft", e.target.value); emit(); }
function onCancelEditWeAssetsDir() {
  setTransient("editingWeAssetsDir", false);
  setTransient("weAssetsError", "");
  emit();
}
