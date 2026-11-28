/**
 * image-assets.js — 用户图片资产导入的**共用腿**（会话头像裁切 + 吉祥物立绘），从 `src/client.js`
 * 按族搬出，函数体逐字未改。
 *
 * 契约：
 *   1) 本文件不 import —— 构建期由 scripts/build-client.mjs 内联在正文之前，与正文同处一个扁平作用域；
 *      函数体引用的 selection / setSetting / setTransient / emit / apiPost / apiDelete / pickImageFile
 *      等自由名由正文与其它内联模块提供。
 *   2) 搬移只改了"声明住哪"：本文件正文与拆前 src/client.js 的 3140–3352 行逐字节相同
 *      （复核：git show <拆前提交>:src/client.js | sed -n '3140,3352p'，与本文件去掉本头注释后 diff）。
 *   3) 本文件只有函数声明与一条纯字面量常量（MASCOT_BOX_MIN_SIDE），**无顶层可执行语句**：
 *      不读正文的 const、不挂监听 ⇒ 内联到 bundle 顶部不会撞 TDZ。
 *   4) 渲染器（ext-avatar / mascot 页签）只读 ctx 传进来的几何与回调，不直接引这里的裸标识符；
 *      「适配方式」onObjectFit 不属于本族（它是外观处理器），仍住正文。
 */

/**
 * 取景框里那张图的实际绘制几何（换算成"显示 px"）。
 *
 * 口径：方形取景框边长 `AVATAR_CROP_VIEW`；`zoom = 1` 时图**短边刚好铺满**取景框
 * （cover 语义 —— 再小就会在框里露白），放大只增不减。`x` / `y` 是 -1..1 的归一化平移，
 * 边界取"图不能露出空白"的最大可移动量。
 */
function avatarCropGeometry() {
  const w = Number(selection.avatarCropW) || 0;
  const h = Number(selection.avatarCropH) || 0;
  const zoom = Math.max(1, Number(selection.avatarCropZoom) || 1);
  if (!w || !h) return { dw: 0, dh: 0, dx: 0, dy: 0, base: 1 };
  const base = AVATAR_CROP_VIEW / Math.min(w, h); // 短边铺满
  const dw = w * base * zoom;
  const dh = h * base * zoom;
  const slackX = Math.max(0, (dw - AVATAR_CROP_VIEW) / 2);
  const slackY = Math.max(0, (dh - AVATAR_CROP_VIEW) / 2);
  const nx = Math.max(-1, Math.min(1, Number(selection.avatarCropX) || 0));
  const ny = Math.max(-1, Math.min(1, Number(selection.avatarCropY) || 0));
  return {
    dw: dw, dh: dh, base: base,
    dx: -slackX * nx, // 向右拖（nx>0）⇒ 图左移
    dy: -slackY * ny,
  };
}
/**
 * 拖动 / 缩放期间把取景框里那张图**就地**挪到新几何（live 档的"看得见的那部分"）。
 *
 * 为什么不是 emit：拖动与滚轮一次就是上百个事件，emit 会重渲染整棵设置面板（与
 * `commitLiveSetting` 的两档纪律相同）。渲染器只在完整渲染时按 ctx 里的几何写 inline
 * style，而 live 档**没有**重渲染 ⇒ 图必须由这里自己挪。几何仍然只来自唯一实现
 * `avatarCropGeometry()`；抬手那一次照常 emit，React 写回的值与这里逐字相同。
 */
function syncAvatarCropLive() {
  if (typeof document === "undefined" || typeof document.querySelector !== "function") return;
  let view;
  try { view = document.querySelector(".we-crop__view"); } catch { return; }
  const img = view && typeof view.querySelector === "function" ? view.querySelector(".we-crop__img") : null;
  if (!img || !img.style) return;
  const geo = avatarCropGeometry();
  img.style.width = geo.dw + "px";
  img.style.height = geo.dh + "px";
  img.style.left = ((AVATAR_CROP_VIEW - geo.dw) / 2 + geo.dx) + "px";
  img.style.top = ((AVATAR_CROP_VIEW - geo.dh) / 2 + geo.dy) + "px";
  // 缩放滑块也跟着回真值：live 档没有重渲染，不补这一下，滚轮放大了图而滑块还停在 100%
  // （滑块自己的 liveFill 只在**它的** input 事件里跑，滚轮不经过它）。
  try {
    const row = document.querySelector(".we-crop");
    const range = row && typeof row.querySelector === "function" ? row.querySelector('input[type="range"]') : null;
    if (!range) return;
    const pct = Math.round((Math.max(1, Number(selection.avatarCropZoom) || 1)) * 100);
    range.value = String(pct);
    const lo = Number(range.min); const hi = Number(range.max);
    if (typeof range.style.setProperty === "function" && isFinite(lo) && isFinite(hi) && hi > lo) {
      range.style.setProperty("--we-fill", ((pct - lo) / (hi - lo) * 100) + "%");
    }
    const input = row.querySelector(".we-picker__value-input");
    if (input) input.value = String(pct);
    else {
      const out = row.querySelector(".we-picker__value");
      if (out) out.textContent = pct + "%";
    }
  } catch { /* 回显是增强，失败不影响取值 */ }
}
/** 拖动取景：把**这一步**的指针增量换成归一化平移（1 = 可用位移的满量）。 */
function onAvatarCropDrag(dxPx, dyPx) {
  const geo = avatarCropGeometry();
  const slackX = Math.max(0, (geo.dw - AVATAR_CROP_VIEW) / 2);
  const slackY = Math.max(0, (geo.dh - AVATAR_CROP_VIEW) / 2);
  const nx = slackX > 0 ? (Number(selection.avatarCropX) || 0) - dxPx / slackX : 0;
  const ny = slackY > 0 ? (Number(selection.avatarCropY) || 0) - dyPx / slackY : 0;
  // 拖动是"看得见的那部分" ⇒ 走 live 档（面板不重渲染），图由 syncAvatarCropLive 就地挪。
  commitLiveTransient("avatarCropX", Math.max(-1, Math.min(1, nx)), true);
  commitLiveTransient("avatarCropY", Math.max(-1, Math.min(1, ny)), true);
  syncAvatarCropLive();
}
/** 缩放取景（滑块：绝对值）。 */
function onAvatarCropZoom(z, live) {
  const v = Math.max(1, Math.min(4, Number(z) || 1));
  commitLiveTransient("avatarCropZoom", v, live);
  if (live) syncAvatarCropLive();
}
/**
 * 滚轮缩放（增量）。**必须从 `selection` 现读当前值**：live 档不 emit，渲染器手里的
 * `sel.avatarCropZoom` 会停在事件发生前那一版 —— 拿它累加的话连滚十格也只放大一步。
 */
function onAvatarCropWheel(delta) {
  const cur = Math.max(1, Number(selection.avatarCropZoom) || 1);
  // 按百分位取整：滚轮一格是 ±0.1，浮点累加会留下 1.2000000000000002 这类尾巴
  // （它会被写进滑块回显，也让「滚十格正好到上限」变得不确定）。
  const v = Math.round(Math.max(1, Math.min(4, cur + (Number(delta) || 0))) * 100) / 100;
  commitLiveTransient("avatarCropZoom", v, true);
  syncAvatarCropLive();
}
/** 把取景框里那一块**按原图分辨率**裁出来（再用既有 downscale 链缩到 512）。 */
async function cropAvatarToBlob() {
  const pending = avatarCropPending;
  if (!pending) throw new Error(weT("没有待裁的图片"));
  const src = await decodeImageFile(pending.file);
  const w = Number(src.width) || 0;
  const h = Number(src.height) || 0;
  const geo = avatarCropGeometry();
  // 显示几何 → 原图像素：取景框边长对应原图 (AVATAR_CROP_VIEW / (base*zoom)) 个像素。
  const perSrc = 1 / (geo.base * Math.max(1, Number(selection.avatarCropZoom) || 1));
  const side = AVATAR_CROP_VIEW * perSrc;
  // 取景框左上角在图坐标里的位置：图中心 + dx/dy，再退半个框。
  const cx = w / 2 - geo.dx * perSrc;
  const cy = h / 2 - geo.dy * perSrc;
  const sx = Math.max(0, Math.min(w - side, cx - side / 2));
  const sy = Math.max(0, Math.min(h - side, cy - side / 2));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(side));
  out.height = Math.max(1, Math.round(side));
  const g = out.getContext("2d");
  if (!g) throw new Error(weT("没有可用的画布"));
  g.drawImage(src, sx, sy, side, side, 0, 0, out.width, out.height);
  if (src.close) { try { src.close(); } catch { /* ignore */ } }
  const toBlob = (type, quality) => new Promise((resolve) => {
    try { out.toBlob((b) => resolve(b), type, quality); } catch { resolve(null); }
  });
  const webp = await toBlob("image/webp", 0.92);
  return (webp && webp.type === "image/webp") ? webp : (await toBlob("image/png"));
}
/** 确认裁切 → 上传裁好的图（走既有 postImageAsset 那条腿）。 */
async function onAvatarCropConfirm() {
  const pending = avatarCropPending;
  if (!pending) { closeAvatarCrop(); return; }
  const side = pending.side;
  setTransient("avatarBusy", side);
  emit();
  try {
    const cut = await cropAvatarToBlob();
    if (!cut) throw new Error(weT("裁切失败"));
    const img = await downscaleImageBlob(cut, AVATAR_IMPORT_MAX_EDGE);
    const posted = await postImageAsset("/avatar/" + side, img.blob, weT("头像"));
    if (!posted.ok) throw new Error(posted.error);
    // 记账：文件名进设置（它同时是"设置过没有"与 `<img>` 的缓存键）。
    setSetting(side === "ai" ? "avatarAiImage" : "avatarUserImage", posted.name);
    setTransient("avatarBusy", "");
    closeAvatarCrop(); // 它自己会 emit
  } catch (err) {
    setTransient("avatarBusy", "");
    setTransient("avatarError", weT("导入失败：{error}", { error: err && err.message ? err.message : String(err) }));
    closeAvatarCrop();
  }
}
function onAvatarClear(side) {
  setTransient("avatarError", "");
  apiDelete("/avatar/" + side, { parse: "always" }).then((r) => {
    if (!r.ok) throw new Error(assetRouteFailure(r, weT("头像")));
    setSetting(side === "ai" ? "avatarAiImage" : "avatarUserImage", "");
    emit();
  }).catch((err) => {
    setTransient("avatarError", weT("清除失败：{error}", { error: err && err.message ? err.message : String(err) }));
    emit();
  });
}

// ── 「系统」页签（自定义吉祥物立绘）的处理器 ──────────────────────────────────
// 与头像同一条导入链（pickImageFile / downscaleImageFile / postImageAsset），差别只有：
//   · 路由不带 side（立绘只有一张，再导入即覆盖 —— 宿主那边清同族旧文件）；
//   · 除文件名外还记一个**显示盒**（`<宽>x<高>`）：立绘按自己的宽高比适配 96×192 的框，
//     结果存下来给主页面那只吉祥物用（拖动 / 贴边 / 视口钳位都读它）。
// 立绘的尺寸直接改主页面那只（RopeDock 是 emit 的订阅者）⇒ 全部走完整路径。
// 盒的**设计上限**（MASCOT_BOX_MAX_W/H）真源在 lib/settings-schema.js —— `mascotBox`
// 档限量级与上传腿的适配框同作用域引用这一对常量，两侧永不漂；短边下限是上传腿
// 自己的口径（"太小的图标点不到"），schema 不知道它。
const MASCOT_BOX_MIN_SIDE = 28;
function onMascotPick() { pickImageFile((file) => uploadMascotFile(file)); }
async function uploadMascotFile(file) {
  if (!file || !/^image\/(png|jpeg|webp)$/.test(String(file.type || ""))) {
    setTransient("mascotError", weT("仅支持 JPG / PNG / WebP 图片"));
    emit();
    return;
  }
  setTransient("mascotError", "");
  setTransient("mascotBusy", true);
  emit();
  try {
    const img = await downscaleImageFile(file, IMAGE_IMPORT_MAX_EDGE);
    // 显示盒：等比适配 96×192（大图缩到框内）；小图不放大，只为"太小的图标点不到"
    // 留一条下限（短边 < 28px 才放大到 28px）。
    const fit = Math.min(MASCOT_BOX_MAX_W / img.width, MASCOT_BOX_MAX_H / img.height);
    const lift = Math.max(1, MASCOT_BOX_MIN_SIDE / Math.min(img.width, img.height));
    const k = Math.min(fit, lift);
    const box = Math.max(1, Math.round(img.width * k)) + "x" + Math.max(1, Math.round(img.height * k));
    const posted = await postImageAsset("/mascot", img.blob, weT("立绘"));
    if (!posted.ok) throw new Error(posted.error);
    setSetting("mascotImage", posted.name);
    setSetting("mascotImageBox", box);
  } catch (err) {
    setTransient("mascotError", weT("导入失败：{error}", { error: err && err.message ? err.message : String(err) }));
  } finally {
    setTransient("mascotBusy", false);
    emit();
  }
}
function onMascotClear() {
  setTransient("mascotError", "");
  // 回执是**布尔**（真删掉 = true / 失败 = false）：`onMascotFormConfirm` 要拿它决定"改不改档位"，
  // 所以这里不能把结果吞掉。失败路径自己已经把原因写进 `mascotError` 并 emit。
  return apiDelete("/mascot", { parse: "always" }).then((r) => {
    if (!r.ok) throw new Error(assetRouteFailure(r, weT("立绘")));
    setSetting("mascotImage", "");
    setSetting("mascotImageBox", "");
    emit();
    return true;
  }).catch((err) => {
    setTransient("mascotError", weT("清除失败：{error}", { error: err && err.message ? err.message : String(err) }));
    emit();
    return false;
  });
}
