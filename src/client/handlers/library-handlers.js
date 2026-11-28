/**
 * library-handlers.js — 壁纸库 / 库视图的模块级处理器（含轮播组触发与立绘两步确认），
 * 从 `src/client.js` 按族搬出，函数体逐字未改。
 *
 * 契约：
 *   1) 本文件不 import —— 构建期由 scripts/build-client.mjs 内联在正文之前，与正文同处一个扁平作用域；
 *      函数体引用的 selection / setSetting / setTransient / emit / loadInventory / emitAudio 等自由名
 *      由正文与其它内联模块提供。
 *   2) 搬移只改了"声明住哪"：本文件正文与拆前 src/client.js 的 3701–3899 行逐字节相同
 *      （复核：git show <拆前提交>:src/client.js | sed -n '3701,3899p'，与本文件去掉本头注释后 diff）。
 *   3) 顶层只有一处字面量常量 INTERVALS（轮播档位表）：不读正文的 const、不挂监听 ⇒ 无 TDZ 风险。
 *   4) 立绘两步确认（onRopeFormChange / onMascotFormConfirm）留在这里而不是砌进 image-assets.js：
 *      它们读写的是立绘**档位**与确认位（armedConfirm），与上传腿是两条通路。
 */
// ── 壁纸库 / 库视图处理器 ────────────────────────────────────────────────────
const onRefresh = () => loadInventory();
// Filter changes: persist + re-validate so wallpapers outside the selected
// categories drop out of the grid/rotation immediately.
// 内容分级是**多档勾选**（v7 起值是数组）：切某一档 = 往集合里加/删，且不允许把最后一档
// 取消（一个都不勾等于全库空白，用户只会以为坏了）。
const onRatingFilterToggle = (tier, on) => {
  const cur = Array.isArray(selection.contentRatingFilter) ? selection.contentRatingFilter : [];
  const next = RATING_TIERS.filter((t) => (t === tier ? on : cur.indexOf(t) !== -1));
  if (!next.length) return;
  setSetting("contentRatingFilter", next);
  revalidateSelection();
};
// 类型筛选也是**多档勾选**（v8 起值是数组，与内容分级同款）：不允许取消最后一档
//（一个都不勾等于网格空白）。类型只筛列表与「下一张」候选，不拦正在播的壁纸。
const onTypeFilterToggle = (tier, on) => {
  const cur = Array.isArray(selection.typeFilter) ? selection.typeFilter : [];
  const next = TYPE_TIERS.filter((t) => (t === tier ? on : cur.indexOf(t) !== -1));
  if (!next.length) return;
  setSetting("typeFilter", next);
  revalidateSelection();
};
// 「文件夹」筛选：单选取值（夹子之间互斥）。只写设置 + 重渲染（**不** revalidate ——
// 它不参与播放闸门，见 picker-model 的 `matchesFolderFilter`；换夹子不该把正在播的壁纸踢掉）。
const onFolderFilterChange = (value) => {
  setSetting("folderFilter", value || "all");
  emit();
};
// 方向筛选：单档枚举，只筛**可见列表** —— 不改变轮播成员 / 「下一张」候选，
// 也不拦正在应用的壁纸（尺寸未知 / 正方形的条目只在「全部方向」里出现）。
const onOrientationFilterChange = (value) => {
  if (value !== "all" && value !== "landscape" && value !== "portrait") return;
  setSetting("orientationFilter", value);
  emit();
};
// Card style: classic (CD-rack) vs fixed (overlap-proof).
const onLayoutChange = (value) => {
  setSetting("pickerLayout", value);
  emit();
};
// Edge 兼容渲染开关：关闭后任何浏览器都走原生 <video>。改的是渲染模式，
// syncLayers 的 wantKey 已并入模式，emit 会重建壁纸层并立即按新路径生效。
const onEdgeCompatChange = (checked) => {
  setSetting("edgeCompat", checked);
  emit();
};
// 轮播实时覆盖：0 = 跟随列表预设；> 0 只改本次运行的间隔，**不写回列表**。
function onRotationLiveInterval(e) {
  setSetting("rotationLiveInterval", clampNum(Number(e.target.value), ...schemaRange("rotationLiveInterval"), DEFAULTS.rotationLiveInterval));
  syncRotationTimer();
  emit();
};
/**
 * 轮播推进方式（「按间隔」/「当前视频播完就换」）。写进**当前列表**（与 interval 同口径：
 * 每个列表记自己的节奏），然后重排计时器 —— 视频结束档要在建层时关掉 loop，而已经上屏
 * 的那一层不会自己变，所以这里额外触发一次层同步。
 */
const onGroupTrigger = (e) => {
  const group = activeRotationGroup();
  if (!group) return;
  group.trigger = e.target.value === "videoEnd" ? "videoEnd" : "interval";
  persistSelection();
  syncRotationTimer();
  // 已经上屏的视频层要跟着换 loop 语义（否则"切到视频结束档"要等下一次换壁纸才生效）。
  const layer = typeof document !== "undefined" && document.getElementById ? document.getElementById(LAYER_ID) : null;
  const media = layer && typeof layer.querySelector === "function" ? layer.querySelector("video") : null;
  if (media && "loop" in media) {
    try { media.loop = group.trigger !== "videoEnd"; } catch { /* ignore */ }
  }
  emit();
};
// 图内过场周期（图片 / 幻灯片壁纸内部多张图之间的切换间隔）。单位是**秒**，0 = 跟随 WE
// 项目里声明的 `imageswitchtimes`；与 rotationInterval（壁纸之间、分钟）是两件事。
// 改完原地重装过场层：图片档的层键只有 type+url，改设置不会触发 syncLayers 重建。
const onPictureSlideSeconds = (e) => {
  const seconds = clampNum(Number(e.target.value), ...schemaRange("pictureSlideSeconds"), DEFAULTS.pictureSlideSeconds);
  setSetting("pictureSlideSeconds", seconds);
  if (selection.type === "image") refreshImageSlideshow(selection);
  emit();
};
// 「删除」按钮**只置令牌**；真正的删除在问句行的「确认」里（不变量 2）。两件事分开的
// 好处：守卫可以分别断言"第一下不删"与"确认才删"，而不是只验一个 if。
const onArmDeleteGroup = () => {
  const group = activeRotationGroup();
  if (!group) return;
  armConfirm("group:" + group.id);
};
const onDeleteGroup = () => {
  const group = activeRotationGroup();
  if (!group) return;
  disarmConfirm();
  deleteGroup(group.id);
};

// 切换过场（类型 / 方向 / 速度）：只写选择 —— 下一次换壁纸（手动点选或轮换提交）
// 生效，不需要重建当前层。
const onSwitchTransition = (id) => {
  if (!SWITCH_TRANSITION_VALUES.includes(id)) return;
  setSetting("switchTransition", id); emit();
};
const onSwitchTransitionDir = (dir) => {
  if (!SWITCH_DIRS.includes(dir)) return;
  setSetting("switchTransitionDir", dir); emit();
};
const onSwitchTransitionSpeed = (id) => {
  if (!SWITCH_SPEED_VALUES.includes(id)) return;
  setSetting("switchTransitionSpeed", id); emit();
};
// Mascot pull-cord show/hide, persisted with the other toggles.
const onRopeVisibilityChange = (e) => {
  setSetting("ropeShown", e.target.checked); emit();
};
/**
 * 点吉祥物环上的内置项 = **换成出厂自带**（用户口径：内置项不再禁用；
 * 并入 #180 后，平铺卡片换成 3D 环、单击换成两步确认）：
 *   · 本机没有自定义立绘 ⇒ 纯档位切换（写一个键、零网络，与旧行为一字不差）；
 *   · 本机有自定义立绘 ⇒ 这里只**上膛**（`mascotPendingForm` + `armedConfirm`），真正的动作在
 *     `onMascotFormConfirm`：走与「清除」按钮**同一条路**（宿主删同族文件），成功后才摘引用 + 钉 form
 *     —— 失败就一个字段都不动（屏上仍是那张自定义图），原因进 `mascotError`。
 * 与预设的第四态（`assets.mascot` 字符串 = 指向内置形态 ⇒ 清本机立绘族 + 钉 `ropeForm`）同语义：
 * 三个入口（环上内置项 / 「清除」按钮 / 套用"指向出厂自带"的预设）在"这一族归谁"上必须给同一个结果。
 */
const onRopeFormChange = (form) => {
  if (!ROPE_FORM_VALUES.includes(form)) return;
  // ── 自定义立绘生效时不能直接改形态（用户口径：「按钮要可点击」）──────────
  // `ropeArtOf` 的优先序是「有自定义立绘就用它」⇒ 只写 ropeForm 对屏上那只**毫无影响**。
  // **禁用内置项与 ‹ › 这条路不能留**：用户实测的反馈正是"按钮都没办法点"。
  // 现在把它做成一条**真能生效**的动作：代价是清除那张自定义立绘，
  // 而清除在宿主那边是 DELETE、**不可恢复** ⇒ 走两步确认（与本仓其它破坏性动作同一口径）。
  if (selection.mascotImage) {
    setTransient("mascotPendingForm", String(form));
    setTransient("armedConfirm", "mascot-form");
    emit();
    return;
  }
  setSetting("ropeForm", form); emit();
};
// 确认后的形态切换：**先真的把文件删掉、拿到成功再改档位**（合并口径）。
// ⚠️ 顺序不能反 —— mascotImage 还在时写 ropeForm 就是"写了没人读"（ropeArtOf 仍取自定义）；
// 而"先写档位再删文件"在 DELETE 失败时会留下"档位变了、图还在"的半截状态（屏上没变化、
// 设置里却已经不是原来那只）⇒ 删除失败就一个字段都不动，原因由 onMascotClear 进 mascotError。
const onMascotFormConfirm = () => {
  const form = selection.mascotPendingForm;
  disarmConfirm();
  setTransient("mascotPendingForm", "");
  if (!ROPE_FORM_VALUES.includes(form)) { emit(); return; }
  const cleared = selection.mascotImage ? onMascotClear() : Promise.resolve(true);
  cleared.then((ok) => {
    if (!ok) return;
    setSetting("ropeForm", form);
    setSetting("mascotImage", "");
    setSetting("mascotImageBox", "");
    emit();
  });
};
const onRopeScaleChange = (scale) => {
  setSetting("ropeScale", clampNum(scale, ROPE_SCALE_MIN, ROPE_SCALE_MAX, DEFAULTS.ropeScale)); emit();
};

// 当前 live 渲染页的 iframe（面板「重新截」的抓帧源）。
// livePointerFrame 由 syncLayers 每次挂上 live 层时更新；切到非 live 壁纸后它可能
// 仍指向已移除的旧元素，所以再用 DOM 查一次兜底。
const currentLiveFrame = () => {
  const ref = livePointerFrame;
  if (ref && (!("isConnected" in ref) || ref.isConnected)) return ref;
  try {
    const node = document.getElementById(LAYER_ID);
    const f = node && typeof node.querySelector === "function" ? node.querySelector("iframe.we-live-iframe") : null;
    if (f) return f;
  } catch { /* ignore */ }
  return null;
};

// 自定义画面（截屏导入）：从 WE 等处截图后导入，成为该壁纸的「自定义画面」档
// （?v=4）显示源。
const setCustomFrameLocal = (wid, on) => {
  const m = Object.assign({}, selection.customFrames || {});
  if (on) m[wid] = true; else delete m[wid];
  selection.customFrames = m;
};

// Close the picker library view (ESC / 返回 button share this path).
const closePicker = () => {
  // 关库视图 ⇒ 清掉待确认（不变量 3）：否则重新打开时会看到一个针对上次那个对象的问句。
  disarmConfirm();
  setTransient("pickerOpen", false);
  setTransient("pickerDraft", false);
  setTransient("batchMode", false);
  setTransient("batchSelected", []);
  emit();
  // Focus restore: return focus to the「选择壁纸」button that opened the
  // view (WCAG focus management).
  if (pickerOpener && pickerOpener.isConnected) {
    try { pickerOpener.focus(); } catch { /* ignore */ }
  }
};

const INTERVALS = [1, 5, 10, 30, 60, 120];

