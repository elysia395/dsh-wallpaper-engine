/**
 * avatar-ext-handlers.js — 「扩展」页签**一号模块（自定义会话头像）**的处理器，从 `src/client.js`
 * 按族搬出，函数体逐字未改。
 *
 * 契约：
 *   1) 本文件不 import —— 构建期由 scripts/build-client.mjs 内联在正文之前，与正文同处一个扁平作用域；
 *      函数体引用的 selection / setSetting / setTransient / commitLiveSetting / emit / pickImageFile
 *      等自由名由正文与其它内联模块提供。
 *   2) 搬移只改了"声明住哪"：本文件正文与拆前 src/client.js 的 2986–3139 行逐字节相同
 *      （复核：git show <拆前提交>:src/client.js | sed -n '2986,3139p'，与本文件去掉本头注释后 diff）。
 *   3) 本文件只有函数声明与顶层字面量状态（AVATAR_CROP_VIEW / avatarCropPending /
 *      avatarOverflowPending）：不读正文的 const、不挂监听 ⇒ 内联到 bundle 顶部不会撞 TDZ。
 *   4) 裁切几何与出图住在 src/client/image-assets.js；装饰层（src/extensions/avatar-layer.js）是 emit 的订阅者，
 *      所以滑块走 commitLiveSetting 的 live 档时要额外 syncAvatarLayer() —— 那条约定留在原地未改。
 */

// ── 「扩展」页签（一号模块：自定义会话头像）的处理器 ────────────────────────────
// 控件只报事件，写设置 + 重渲染都在这里。装饰层（src/extensions/avatar-layer.js）每收到一次 emit
// 就按当前设置重画一遍，所以：开关 / 导入 / 清除走完整路径（emit）；两个滑块走
// commitLiveSetting 的 live 档，但**额外补一次 syncAvatarLayer()** —— 那一层是 emit 的
// 订阅者（不 emit 就不会被叫到），而拖动时的即时反馈正是这个模块的主要看点。
function onAvatarEnabled(e) { setSetting("avatarEnabled", e.target.checked); emit(); }
function onAvatarSize(v, live) { commitLiveSetting("avatarSize", v, live); if (live) syncAvatarLayer(); }
function onAvatarRadius(v, live) { commitLiveSetting("avatarRadius", v, live); if (live) syncAvatarLayer(); }
/** 助手头像的出现间隔（issue #231）：只影响分组判定，没有样式变量 ⇒ 抬手那一次 emit 重算即可
 *  （渲染器不重算分组；分组由 emit 订阅链里的 syncAvatarLayer 触发，见下）。 */
function onAvatarAiRepeatRows(v, live) {
  // 取值域走 schemaRange（与其它滑块同一口径：改 KINDS 不会漏改这里的第二份数字）。
  commitLiveSetting("avatarAiRepeatRows", clampNum(Math.round(Number(v)), ...schemaRange("avatarAiRepeatRows"), DEFAULTS.avatarAiRepeatRows), live);
  if (live) syncAvatarLayer();
}
// 上传裁切（issue #191 问题 1）：用户口径是"上传非正方形、或主体不在中央时效果很差"。
// 做法是**导入时先裁再传**（而不是存裁切参数第二次渲染）：
//   · 盘上那张就是裁完的方形图 ⇒ 预览、会话里、以及"以后任何读到它的地方"天然一致，
//     不存在"存了参数但某处忘了应用"的漏网点；
//   · **零新设置键**（不动 KINDS / 夹具 / 预设段），也就没有"预设带不带裁切参数"的语义问题。
// 代价：裁切是一次性的、事后不可再调（要重调就重新导入 —— 与"替换图片"同一条路）。
const AVATAR_CROP_VIEW = 260; // 弹窗取景框边长（px，与 CSS 里那格同值）
/** 待裁的原图（**内存**里，不是设置）：唯一消费者是当前这次弹窗。 */
let avatarCropPending = null;
/** 超限**被拦下**的原图（内存里）：用户在提示行点「自动压缩后导入」时走它。 */
let avatarOverflowPending = null;
/** 导入前的裁切弹窗：先让用户框选构图，确认后才真正上传。 */
function onAvatarPick(side) {
  // 收的格式 = 直传层 ∪ 仅光栅化层（AVATAR_PICK_ACCEPT 与两层清单同住 src/extensions/avatar-import.js）。
  pickImageFile((file) => onAvatarFileChosen(side, file), AVATAR_PICK_ACCEPT);
}
/**
 * 选好图之后的**第一站**：先过两道闸，再进裁切弹窗（`#185` 后续，用户口径）。
 *
 * 顺序就是这道闸的全部价值 —— `avatarImportLimit` 只读文件头，**一次都不解码**；
 * 超限则当场拦下并记住这张图（`avatarOverflowPending`），让面板画一行提示 + 一枚
 * 「自动压缩后导入」。用户点它才真的解码 → 缩到 1024 → 无损重编（见 `onAvatarAutoCompress`）。
 */
async function onAvatarFileChosen(side, file) {
  if (!file) return;
  const type = String(file.type || "").toLowerCase();
  // 白名单两层都收；认不出的 MIME（或浏览器不给 type）仍放行给解码腿去判 ——
  // 这里只挡"明确不在清单里"的，别把扩展名不规范的图也一起拒了。
  const known = (IMAGE_DIRECT_ACCEPT + "," + IMAGE_RASTER_ACCEPT).split(",");
  if (type && !known.includes(type)) {
    setTransient("avatarOverflow", null);
    setTransient("avatarError", weT("仅支持 JPG / PNG / WebP / SVG / GIF / BMP / AVIF 图片"));
    emit();
    return;
  }
  const size = await probeImageSize(file);
  const verdict = avatarImportLimit(file, size);
  if (verdict.ok) {
    avatarOverflowPending = null;
    setTransient("avatarOverflow", null);
    await openAvatarCrop(side, file);
    return;
  }
  // 拦下：把"哪一条超了、实测多少"说清楚（笼统的"图太大"等于什么都没说）。
  avatarOverflowPending = { side: side, file: file };
  setTransient("avatarError", "");
  setTransient("avatarOverflow", {
    side: side,
    bytes: verdict.bytes,
    width: verdict.width,
    height: verdict.height,
    overBytes: verdict.overBytes,
    overEdge: verdict.overEdge,
    // 压缩后仍可能装不下的提示用得上（超大图压到 1024 也可能 > 4 MiB —— 见 ext-avatar 文案）。
    compressible: true,
  });
  emit();
}
/**
 * 「自动压缩后导入」：解码 → 缩到 1024 → **无损优先**重编（PNG，装不下才退 WebP）→ 进裁切弹窗。
 *
 * 为什么压在 1024 而不是更小：用户要的是"信息不丢失"，1024 是显示尺寸（72px）的 14 倍，
 * 肉眼与矢量几乎没有差别；PNG 优先则保证**像素级无损**（只有 PNG 真装不下时才退视觉无损的
 * WebP，并在面板上如实说明）。
 */
async function onAvatarAutoCompress() {
  const pending = avatarOverflowPending;
  if (!pending) return;
  setTransient("avatarCompressing", true);
  setTransient("avatarError", "");
  emit();
  try {
    const src = await decodeImageFile(pending.file);
    const shrunk = await downscaleDecoded(src, AVATAR_IMPORT_MAX_EDGE, pending.file, true);
    // 压缩结果包成 File 再进裁切弹窗：裁切腿吃的是 File（它要 type 与 size）。
    const name = "avatar-compressed." + (shrunk.blob.type === "image/png" ? "png" : "webp");
    const compressed = (typeof File === "function")
      ? new File([shrunk.blob], name, { type: shrunk.blob.type })
      : shrunk.blob;
    setTransient("avatarCompressing", false);
    avatarOverflowPending = null;
    setTransient("avatarOverflow", null);
    await openAvatarCrop(pending.side, compressed);
  } catch (err) {
    setTransient("avatarCompressing", false);
    setTransient("avatarError", weT("压缩失败：{error}", { error: err && err.message ? err.message : String(err) }));
    emit();
  }
}
/** 打开裁切弹窗（读原图尺寸 → 填瞬态 → 交给面板画）。 */
async function openAvatarCrop(side, file) {
  if (!file || !/^image\//.test(String(file.type || ""))) {
    setTransient("avatarError", weT("仅支持 JPG / PNG / WebP / SVG / GIF / BMP / AVIF 图片"));
    emit();
    return;
  }
  let url;
  // ⚠️ `w` / `h` 必须声明在 try **之外**：它们要在 catch 之后写进瞬态（`avatarCropW/H`）。
  // 写进 try 内会让 catch 里的赋值抛 `ReferenceError` —— 裁切弹窗照弹但几何恒为 0
  // （图不可见），且 `emit()` 到不了（首次选图界面毫无反应）。
  let w;
  let h;
  try {
    const src = await decodeImageFile(file);
    w = Number(src.width) || 0;
    h = Number(src.height) || 0;
    if (src.close) { try { src.close(); } catch { /* ignore */ } }
    if (!w || !h) throw new Error(weT("读不出图片尺寸"));
    url = URL.createObjectURL(file);
  } catch (err) {
    setTransient("avatarError", weT("导入失败：{error}", { error: err && err.message ? err.message : String(err) }));
    emit();
    return;
  }
  // 待裁的原图**存在内存里**（不是设置）：它的唯一消费者是这次弹窗。
  avatarCropPending = { side: side, file: file };
  setTransient("avatarError", "");  setTransient("avatarCropSide", side);
  setTransient("avatarCropUrl", url);
  setTransient("avatarCropW", w);
  setTransient("avatarCropH", h);
  setTransient("avatarCropZoom", 1);
  setTransient("avatarCropX", 0);
  setTransient("avatarCropY", 0);
  emit();
}
/** 关掉裁切弹窗（撤掉预览 URL，**不上传**）。 */
function closeAvatarCrop() {
  const url = selection.avatarCropUrl;
  if (url) { try { URL.revokeObjectURL(url); } catch { /* ignore */ } }
  avatarCropPending = null;
  setTransient("avatarCropSide", "");
  setTransient("avatarCropUrl", "");
  setTransient("avatarCropW", 0);
  setTransient("avatarCropH", 0);
  setTransient("avatarCropZoom", 1);
  setTransient("avatarCropX", 0);
  setTransient("avatarCropY", 0);
  emit();
}
