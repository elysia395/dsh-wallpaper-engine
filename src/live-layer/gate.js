/**
 * live-layer-gate.js — **切层内容闸门与失败记忆的管线身份**域。
 *
 * 纯搬移：下列声明与函数体逐字未改，只换了声明住哪。构建期由 scripts/build-client.mjs 按
 * INLINE_MODULES 顺序内联进同一工厂作用域（本模块排在组装点 src/live-layer.js 之前）。
 * 契约不变：不 import、无顶层可执行语句、只用扁平作用域里的自由名字。
 */
// ── 切层内容闸门 ─────────────────────────────────────────────────────────────
// 新层一进文档就会被画出来，而它的画面都是**异步**就位的：垫底图要等帧/预览图的探针
// onload，<video> 要等第一帧，Edge 的镜像画布要等 weDrawFrame 的第一笔。于是"切过去"
// 之后最先上屏的其实是**只有第 0 级底色**的新层 —— 一次普通切换里那几帧纯色就是它。
// 深浅主题自动切换只是把这段窗口拉长（它写主题时宿主会重写全量别名令牌并强制读一次
// 样式，都压在同一主线程上，新层的画面要排到它后面），所以把那个开关关掉也仍然看得见。
// 旧层的画面是现成的，于是这里反过来做：**新层有画面之前不撤旧层，也不让新层参与绘制**
// （`we-layer--pending`，见 src/styles.js）。这段窗口里屏上一直是旧壁纸的像素。
// 放行的条件都是**有限**的事件（每一级的成败、视频的 loadeddata/canplay/error、
// 画布的第一笔都会到），不新增等待种类：一张图都没有时仍然停在既有的主题色兜底语义上。
const LAYER_PENDING_CLASS = "we-layer--pending";
let pendingReveal = null; // { node, outgoing, tr, fade, hooks }
// 媒体元素报告"我有画面了"的唯一出口：垫底图的探针与 Edge 的镜像画布各自在落下
// 那一笔时调它（见 buildLivePoster 的 contentSettled 与 weDrawFrame）。
function noteLayerContent(el) {
  if (el && typeof el.__weContent === "function") el.__weContent();
}
// 这一层现在有画面吗（同步判定）。判不了（精简 DOM，没有选择器）时不拦 —— 闸门只用
// 来避免"显示了但没有画面"，不是给所有路径加一道等待。
function layerContentReady(node) {
  if (!node || typeof node.querySelector !== "function") return true;
  // 垫底图（场景 / web 的 live 分支）是这一层里**负责盖住加载窗口**的那一层：
  //   · 它有图 ⇒ 有内容；
  //   · 它已定论"没有图" ⇒ 这一层的内容就是第 0 级兜底（终点语义，见 P2 与 buildLivePoster）；
  //   · 只有"还在等图"时才算没内容 —— 例外是实时渲染页已经出帧：那一刻屏上已经有画面，
  //     垫底图只是被它盖住的下层。
  const poster = node.querySelector("div.we-live-poster");
  if (poster) {
    if (poster.style && String(poster.style.backgroundImage || "")) return true;
    if (poster.dataset && poster.dataset.weContent === "pending") {
      const liveNow = node.querySelector("iframe.we-live-iframe");
      return !!(liveNow && String(liveNow.className).indexOf("we-live-on") !== -1);
    }
    return true;
  }
  const img = node.querySelector("img");
  if (img) {
    // 准备期已经 load 过的元素由 adoptProbe 打上标记；新块的 <img> 看解码结果
    //（`complete` 同时覆盖加载失败，所以还要 naturalWidth —— 失败不算"有画面"）。
    if (img.__weReady === true) return true;
    return img.complete === true && Number(img.naturalWidth) > 0;
  }
  const video = node.querySelector("video");
  if (video) {
    // ⚠️ 这里**不再认 `video.__weReady`**：它只由 loadeddata/canplay 打上，而 rs≥2 是同一件
    // 事的判据；留一个"就绪过"的纪念标记，只会让"这一刻屏上没有帧"的层被放行（真机
    // 日志：放行时 rs=0，屏上就是这一层的底色）。画面判据只认「当下这一帧」。
    // 视频档的"有画面"判据**归视频通道**（见 src/video-layer.js 的文件头）：
    //   · 海报图**已加载**（不是"属性存在" —— 属性刚设上时 <video> 还是透明，
    //     屏上就是层底色，那正是"十几秒纯色"的成因）｜· 首帧 readyState ≥ 2。
    // 两者都没有 ⇒ 返回 false，旧壁纸继续留屏（绝不露底色）。
    // Edge 把画面画进镜像 canvas，而画布底是写死的 #000：视频有帧还不够，要等
    // weDrawFrame 真的画上去一笔。判"画过"读**画布上的留痕**（`dataset.weDrawn`，
    // 见 src/client.js 的 weDrawFrame）——
    // ⚠️ 不能写成"有画布就判否"：首笔落下时回调的 recheck 会再次撞进那条判据，
    // 放行条件永远不成立（真机形态：Edge 里切视频壁纸，旧壁纸永远留在屏上）。
    const mirror = node.querySelector("canvas.we-media--canvas");
    if (mirror) return !!(mirror.dataset && mirror.dataset.weDrawn === "1");
    return videoContentReady(video);
  }
  const live = node.querySelector("iframe.we-live-iframe");
  if (live) return String(live.className).indexOf("we-live-on") !== -1;
  // 裸 iframe（web 旧链）的画面由它自己的文档决定，外面读不到 —— 不拦。
  // 空层没有任何可等的媒体，拦下去就永远放不出来。
  return true;
}
function forgetPendingReveal() {
  const p = pendingReveal;
  pendingReveal = null;
  if (!p) return p;
  for (const el of p.hooks) { try { el.__weContent = null; } catch { /* ignore */ } }
  // 海报探针与它的预算必须一起收：否则它们会在这一层已经放行之后触发（下一次切换时
  // 误放行新层）。停滞链每次续期都换新 id，清"快照 id"清不掉在途的下一跳 —— 通道返回的
  // cancelStall 闭包（读最新 id + dead 标记）才是完整收口。
  try { if (p.stopPosterProbe) p.stopPosterProbe(); } catch { /* ignore */ }
  try { if (p.cancelStall) p.cancelStall(); } catch { /* ignore */ }
  return p;
}
function revealPendingLayer() {
  const p = forgetPendingReveal();
  if (!p) return;
  try { if (p.node.classList) p.node.classList.remove(LAYER_PENDING_CLASS); } catch { /* ignore */ }
  if (p.fade) {
    // 画面到的这一刻才起过场：新层从透明的初态走到终态，全程都有画面。
    startLayerTransition(p.node, p.outgoing, p.tr);
  } else {
    // 硬切：旧层此刻一次性退场（释放媒体 + 放行新层音频），新层已经可以直接画。
    retireFadingLayer();
  }
  // 「这次切换等了多久」是用户直接感知的量：常态留一行（`held=`），有预热/没预热、
  // 有抽帧/没抽帧之间就能直接对比，不必再插临时桩。
  liveLog("layer-reveal", "wid=" + selection.id + " 新层已有画面 → 放行（held="
    + Math.max(0, Date.now() - (p.armedAt || Date.now())) + "ms）");
}
// 新层还没有画面：旧层继续留在屏上，新层先不参与绘制，画面一到就放行。
function armLayerContentReveal(node, outgoing, tr, fade) {
  const recheck = () => { if (layerContentReady(node)) revealPendingLayer(); };
  // 加载失败同样是「这张壁纸没有画面」的确定结论，必须放行 —— 否则这一层永远换不下去。
  const giveUp = () => revealPendingLayer();
  const hooks = [];
  const poster = node.querySelector("div.we-live-poster");
  if (poster) hooks.push(poster);
  const canvasEl = node.querySelector("canvas.we-media--canvas");
  if (canvasEl) hooks.push(canvasEl);
  for (const el of hooks) { try { el.__weContent = recheck; } catch { /* ignore */ } }
  const img = node.querySelector("img");
  if (img && typeof img.addEventListener === "function") {
    img.addEventListener("load", recheck);
    img.addEventListener("error", giveUp);
  }
  // ⑥：视频档的放行机器归**视频通道**（探海报 / 首帧 / 出错 / 预算都在那边）。
  const video = node.querySelector("video");
  const videoReveal = armVideoChannelReveal(video, recheck, giveUp);
  try { if (node.classList) node.classList.add(LAYER_PENDING_CLASS); } catch { /* ignore */ }
  // 新层上屏之前先压住它的音源：旧层还在可见期内出声，两层 BGM 不重叠。
  openRotationAudioGate(node, outgoing);
  pendingReveal = { node, outgoing, tr, fade, hooks, stopPosterProbe: videoReveal.cancelProbe, cancelStall: videoReveal.cancelStall, armedAt: Date.now() };
  // 过场类型是一个完整词，但**先取词再拼接**：`weT(...) + "…"` 会被 i18n 守卫判成
  // "碎片化翻译"（见 test/verify-i18n.mjs 判据 ①b），而这一行本身只是诊断留痕。
  const holdKind = weT(fade ? "过场" : "硬切");
  liveLog("layer-hold", "wid=" + selection.id + " 新层还没有画面 → 旧层留在屏上（"
    + holdKind + "延后到有画面）");
}

// ── 失败记忆的**管线身份**（旧断言不许跨管线复用）────────────────────────────
// `sceneLiveFailures` 说的是"这张壁纸在**当时那条管线**上出不了帧"。管线一换（新 bundle，
// 或者宿主终于把场景媒体源端出来），这句话就过期了 —— 而它偏偏是面板那行「实时渲染失败
// （…）已自动回退」的**唯一**来源，于是旧断言会让修好的版本看起来"完全没作用"
// （实测：宿主半还没重载时留下的 `timeout`，客户端更新后仍然逐字显示，用户据此判定修复无效）。
// 判据**单向**：只有"bundle 变了"或"媒体源从没有到有"才作废旧记忆；反向不清 —— 源一抖动就
// 把用户真实的失败记忆反复抹掉，比留着更糟。记忆身份的写入点两处：迁移自身、**记录失败时**
// （后者保证"这条管线挣来的记忆"下次不会被当成陌生管线清掉）。
const LIVE_PIPELINE_KEY = "weLivePipeline";
let livePipelineChecked = false;
function livePipelineNow() {
  return { build: LIVE_DIAG_BUILD, media: (selection.inventory && selection.inventory.sceneMediaBase) ? 1 : 0 };
}
/** 记住"这条管线"（记录失败时也调一次，见 liveFail）。 */
function rememberLivePipeline() {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(LIVE_PIPELINE_KEY, JSON.stringify(livePipelineNow()));
  } catch { /* 记不住不影响渲染 */ }
}
/** 现管线与记忆里的管线是否不可比：返回 'build' / 'media' / 'unknown' / ''（可比）。 */
function livePipelineChanged() {
  let prev = null;
  try {
    if (typeof localStorage !== "undefined") prev = JSON.parse(localStorage.getItem(LIVE_PIPELINE_KEY) || "null");
  } catch { prev = null; }
  if (!prev || typeof prev !== "object") return "unknown";   // 从没记过 ⇒ 那份记忆来自未知管线
  const now = livePipelineNow();
  if (String(prev.build || "") !== now.build) return "build";
  if (Number(prev.media) === 0 && now.media === 1) return "media";
  return "";
}
/**
 * 换管线 ⇒ 作废一次失败记忆（每页一次）。
 *
 * ⚠️ **必须等设置落地**（`selection.hostLoaded`，由 loadPersisted 在宿主/本地合并完成后置位）：
 * 早于它的判断会把"还没到的记忆"当成"没有记忆"，于是写下基线标记 —— 随后 loadPersisted
 * 用 localStorage 里那份（仍带着旧记忆）覆盖回来，作废就永远不会发生（实测：本 smoke 的
 * L 场景在加这道门之前正是红的）。
 * 没有记忆时只写一次基线标记（否则"这条管线挣来的记忆"下次会被当成陌生管线的）。
 */
function migrateStaleLiveFailures() {
  if (livePipelineChecked) return;
  if (!selection.hostLoaded) return;
  livePipelineChecked = true;
  const keys = Object.keys(selection.sceneLiveFailures || {});
  if (!keys.length) { rememberLivePipeline(); return; }
  const why = livePipelineChanged();
  if (!why) { rememberLivePipeline(); return; }   // 这份记忆就是这条管线挣来的：保留
  liveSessionFailures.clear();
  liveTransferAttempts.clear();
  prepareLiveTimeouts.clear();
  selection.sceneLiveFailures = {};
  rememberLivePipeline();
  liveLog("live-fail-memory-reset", "管线变了（" + why + "）→ 作废 " + keys.length
    + " 张壁纸的失败记忆（旧断言只对旧管线成立，这张壁纸会重新试一次 live）", "info");
  try { persistSelection(); } catch { /* ignore */ }
}

