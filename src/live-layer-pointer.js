/**
 * live-layer-pointer.js — **指针注入 / 帧元素 / poster 与挂载**域。
 *
 * 纯搬移：下列声明与函数体逐字未改，只换了声明住哪。构建期由 scripts/build-client.mjs 按
 * INLINE_MODULES 顺序内联进同一工厂作用域（本模块排在组装点 src/live-layer.js 之前）。
 * 契约不变：不 import、无顶层可执行语句、只用扁平作用域里的自由名字；导出块只列本模块
 * 真声明过的名字（台架按文件 import 时靠它把名字挂回全局）。
 */
// ── live 指针注入（视差/click 交互场景）────────────────────────────────────
// 壁纸层 pointer-events:none，鼠标事件由 DSH UI 消费；window 级 capture 监听
// 仍能收到全部 mousemove/mousedown/mouseup（capture 阶段先于任何元素），归一
// 化后经 __wp.pushPointer 注入渲染页 —— 视差 / cursor 脚本 / 粒子锁点等
// 指针消费方全部激活。协议同 webwallgl docs/INTEGRATION.md §4：u,v ∈ [0,1]、
// Y 朝下勿翻（shader 内自翻）、buttons bit0=左键、按下态保持 ≥16ms（渲染器
// 按帧检测边缘，同帧内 down+up 会丢 click）。事件只在 DSH 窗口内可得 —— 与
// WallpaperEM 的系统级轮询不同，窗口外不推（pointerLeave 语义由 blur 承担）。
let livePointerFrame = null;
let livePointerPending = null; // { u, v, buttons }
let livePointerRaf = 0;
let livePointerDownAt = 0;
function livePointerFlush() {
  livePointerRaf = 0;
  const p = livePointerPending;
  const frame = livePointerFrame;
  if (!p || !frame || !frame.isConnected || !selection.sceneLiveActive) return;
  try {
    const wp = frame.contentWindow && frame.contentWindow.__wp;
    if (wp && typeof wp.pushPointer === "function") wp.pushPointer(p.u, p.v, p.buttons);
  } catch { /* ignore */ }
}
function livePointerSample(e, buttons) {
  if (!livePointerFrame || !selection.sceneLiveActive) return;
  const iw = window.innerWidth || 1;
  const ih = window.innerHeight || 1;
  livePointerPending = {
    u: Math.max(0, Math.min(1, e.clientX / iw)),
    v: Math.max(0, Math.min(1, e.clientY / ih)), // Y 朝下，归一化即协议值
    buttons: buttons,
  };
  if (!livePointerRaf) livePointerRaf = requestAnimationFrame(livePointerFlush);
}
function ensureLivePointer(frame) {
  livePointerFrame = frame;
  if (ensureLivePointer.attached) return;
  ensureLivePointer.attached = true;
  const opts = { capture: true, passive: true };
  window.addEventListener("mousemove", (e) => {
    // e.buttons 实时位掩码；只取 bit0（渲染器也只消费左键语义）。
    livePointerSample(e, e.buttons & 1);
  }, opts);
  window.addEventListener("mousedown", (e) => {
    livePointerDownAt = Date.now();
    livePointerSample(e, 1);
  }, opts);
  window.addEventListener("mouseup", (e) => {
    // 快速点击边缘保持：down→up < 16ms 时延后一拍再抬，保住一次完整
    // down→up 边缘（否则按帧采样会整段漏掉这次点击）。
    if (Date.now() - livePointerDownAt < 16) setTimeout(() => livePointerSample(e, 0), 20);
    else livePointerSample(e, 0);
  }, opts);
  window.addEventListener("blur", () => {
    const f = livePointerFrame;
    if (!f || !f.isConnected || !selection.sceneLiveActive) return;
    try {
      const wp = f.contentWindow && f.contentWindow.__wp;
      if (wp && typeof wp.pointerLeave === "function") wp.pointerLeave();
    } catch { /* ignore */ }
  }, opts);
}
function liveFrameEl() {
  try {
    const layer = document.getElementById(LAYER_ID);
    return layer ? layer.querySelector("iframe.we-live-iframe") : null;
  } catch {
    return null;
  }
}
// 帧**字节**的留存（URL → 一份可同步上屏的东西）。为什么不能只记 URL：把地址写进
// `background-image`，浏览器仍要从零走一遍取值 + 解码，于是同一张壁纸同一份文件，有时第一帧就是帧、
// 有时先是一块主题色纯色 —— 差别只在这一次浏览器来不来得及把它拿回来、解码出来。这一级记的就是
// 那个"来不来得及"：帧加载成功时把它的字节转成一个 object URL（拿不到时留那个已解码的 Image），
// 命中时同步写上屏 —— 画的是已经在本进程里的东西，关键路径上再没有网络与解码环节，于是同样的输入
// 必然得到同样的第一帧。
//
// **必须有界**（FRAME_BYTES_MAX）：一条 object URL 背后是一整帧的字节。不留上限的话，用户每看过
// 一张壁纸就多留一份，一整个会话下来就是"看过的张数 × 单帧体积"的常驻内存 —— 越用越多，且没有任何
// 一处在回收它。超上限即淘汰表头那一条（插入序最早的 = 最久没被用到的，见 paintFrame 的搬尾），
// 并 URL.revokeObjectURL 释放字节（只删记账不撤 object URL，那部分字节在页面关闭前都收不回来）。
//
// **只在真帧 URL 上留**（frameRank === 0 验收）：预览图不能进这张表 —— 它一旦进来，命中分支就会把
// 作者预览图当成"帧"直接上屏，把"帧可用时不得出现缩略图那一帧"那条契约从背面绕过去。
const FRAME_BYTES_MAX = 8;
const liveFrameBytes = new Map();
// 诊断面：留存表本体（排查"内存为什么涨"时，这是唯一能看出留存条数与当前留下哪几张的地方）。
// 只读用途，写它不会改变行为；不挂它就得为同一件事在别处再抄一份记账。
if (typeof window !== "undefined") {
  try { window.__weFrameBytes = liveFrameBytes; } catch { /* ignore */ }
}
function revokeFrameBytes(entry) {
  if (!entry || !entry.objectUrl) return;
  try {
    const api = typeof URL !== "undefined" ? URL : null;
    if (api && typeof api.revokeObjectURL === "function") api.revokeObjectURL(entry.objectUrl);
  } catch { /* ignore */ }
  entry.objectUrl = "";
}
function retainFrameBytes(src, img) {
  let api = null;
  try { api = typeof URL !== "undefined" ? URL : null; } catch { /* ignore */ }
  const existing = liveFrameBytes.get(src);
  if (existing) { revokeFrameBytes(existing); liveFrameBytes.delete(src); }
  const entry = { objectUrl: "", img: img || null };
  liveFrameBytes.set(src, entry);
  while (liveFrameBytes.size > FRAME_BYTES_MAX) {
    const oldest = liveFrameBytes.keys().next();
    if (oldest.done) break;
    revokeFrameBytes(liveFrameBytes.get(oldest.value));
    liveFrameBytes.delete(oldest.value);
  }
  // 字节的来源是**已经解码好的那个 Image**：画进 canvas 再取回 blob（只走本进程内存，不发新请求）。
  // 取不回来（无 canvas / 无 toBlob / 画布被跨源污染）时不记 object URL，命中时退回逐级探针那条路。
  if (!img || typeof document === "undefined" || typeof document.createElement !== "function") return;
  if (!api || typeof api.createObjectURL !== "function" || typeof Blob !== "function") return;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width || 0;
    canvas.height = img.naturalHeight || img.height || 0;
    if (!canvas.width || !canvas.height) return;
    const ctx = typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
    if (!ctx || typeof ctx.drawImage !== "function") return;
    ctx.drawImage(img, 0, 0);
    const toBlob = canvas.toBlob || canvas.webkitToBlob;
    if (typeof toBlob !== "function") return;
    toBlob.call(canvas, (blob) => {
      if (!blob) return;
      // 异步回来时这一条可能已被淘汰 / 已被换掉：那时不能再写进去（否则又是一条没人释放的 object URL）。
      if (liveFrameBytes.get(src) !== entry) return;
      let url;
      try { url = api.createObjectURL(blob); } catch { return; }
      entry.objectUrl = url;
    }, "image/png");
  } catch { /* ignore */ }
}
// 帧被删掉（用户清除 / 几何不符重抓 / 重新截图）时连同留存一起撤掉：留着就等于继续拿一份已经
// 不存在的帧上屏，屏上是错构图，而且那份字节在页面关闭前不会自己消失。
function releaseFrameBytes(token) {
  const key = String(token || "");
  if (!key) return;
  for (const src of [...liveFrameBytes.keys()]) {
    if (src.indexOf(key) === -1) continue;
    revokeFrameBytes(liveFrameBytes.get(src));
    liveFrameBytes.delete(src);
  }
}
// 从留存上屏（同步）：object URL 优先（写 `background-image`，与逐级探针同一条上屏通道，
// 定位/适应的样式一个字都不用改）；拿不到 object URL 的重宿主退回插入那个**已解码的 Image**
// 本身（元素进 DOM 即可绘制，同样不触发新的取值与解码）。
function paintFrame(poster, src) {
  const entry = liveFrameBytes.get(src);
  if (!entry) return false;
  // 命中 = 这一条**刚被用到**：把它移到表尾，淘汰侧（retainFrameBytes 的 while）才有
  // 「最早出表的是最久没被画过的那一条」这条语义。只读 `get` 不搬尾的话，淘汰顺序退化成
  // 插入顺序，常用的老条目会在"来回切少数几张 + 偶尔来一张新的"下被先淘汰掉。
  liveFrameBytes.delete(src);
  liveFrameBytes.set(src, entry);
  if (entry.objectUrl) {
    poster.dataset.weFrameSrc = src; // 诊断口径不变：记**屏上**那一级
    poster.style.backgroundImage = "url(" + entry.objectUrl + ")";
    return true;
  }
  if (!entry.img || typeof entry.img.cloneNode !== "function") return false;
  // 克隆而不是搬原元素：探针那个 Image 可能还挂在别处，搬走会把它从原位置抽掉。
  const copy = entry.img.cloneNode(false);
  if (copy.style) {
    copy.style.position = "absolute";
    copy.style.inset = "0";
    copy.style.width = "100%";
    copy.style.height = "100%";
    copy.style.objectFit = "cover";
  }
  try { copy.setAttribute("data-we-frame-src", src); } catch { /* ignore */ }
  copy.className = "we-media we-media--fit";
  poster.appendChild(copy);
  poster.dataset.weFrameSrc = src;
  return true;
}
function buildLivePoster(sel) {
  const poster = document.createElement("div");
  poster.className = "we-media we-live-poster";
  // 底色兜底：壁纸没写 schemecolor 时用主题面板色打底 —— 无抽帧图、无主题色时
  // 加载期也必须是「一层安静的颜色」，不能是纯黑或透明。
  poster.style.backgroundColor = sel.schemeColor || "var(--dsw-alias-bg-layer-1, #101418)";
  // 垫底画面的来源（**唯一权威顺序**）：**实时抓帧 → 作者随包发布的工程预览图 → 主题色**。
  //   · 抓帧 = 场景的出图 URL（`?v=` 只剩 0 / 4 两档）或网页的 live 抽帧（见 maybeCaptureLiveFrame）；
  //   · 预览图**只作首帧前的占位**：新壁纸**第一次**激活时抓帧还不存在（要等这一轮 live 首帧
  //     回填），只试一级会 404 —— 而失败若「静默保留主题色」（`#101418`，近黑）就是一块黑屏。
  //   · 预览图是**作者随包发布的那张**，不是本插件合成的"猜图"（与 buildMedia 里 scene 静态
  //     img 的 onerror 回落同源）⇒ 不破「要么给真画面、要么诚实留空」那条裁定。
  // 顺序不能反：抓帧才是当前视口的真实构图，它一到就被顶掉；预览图只是"还没来得及出帧"的占位。
  const candidates = (sel.type === "web" ? [sel.liveFrame, sel.previewUrl] : [sel.url, sel.previewUrl])
    .filter((s) => typeof s === "string" && s);
  if (!candidates.length) return poster;
  poster.dataset.weFrameSrc = candidates[0];
  // 与 prepareSceneStaticStage 同一约定：无 Image 的环境（headless 验收 /
  // 只给部分 DOM 的测试宿主）跳过预载，保留主题色兜底 —— 否则建 live 层时
  // 会直接抛 ReferenceError。
  if (typeof Image !== "function") return poster;
  // 第 1 级（实时帧）究竟是哪个候选：web 支没有 `liveFrame` 时**这一级不存在**（宿主发了这条
  // 字段，客户端却没有它的写入点 ⇒ web 的候选表里实际只剩预览图）。那种情况下不能把
  // `candidates[0]` 当成"实时帧已存在"记进来 —— 记下的会是缩略图，语义就假了。所以下面只认
  // 「rank 0 且确实等于实时帧 URL」的那一个。
  const frameSrc = sel.type === "web" ? (sel.liveFrame || "") : (sel.url || "");
  const frameRank = frameSrc && candidates[0] === frameSrc ? 0 : -1;
  // **图恒盖色**：`background-image` 永远画在同一元素的 `background-color` 之上，且全仓只有
  // 上面那一处写底色 ⇒ 这里不存在"谁遮谁"，只有两件事要定：**谁允许上屏**与**什么时候发请求**。
  // 上屏规则（**存在性闸门**，与请求解耦）：第 r 级只允许在比它更权威的每一级都**已判失败**
  // 之后上屏 —— 高权威级在飞 / 已就绪，低权威级一律不许上屏（缓存实时帧存在时，作者预览图
  // 一次都不该成为屏上那张，哪怕它先解码完）；高权威级判失败 ⇒ 已就绪的低权威级此刻补上
  // （它就是"这一级不存在"的兜底）；全部判失败 ⇒ 停在主题色兜底。级号越小越权威（见 candidates）。
  const loadedRank = candidates.map(() => ""); // 已就绪的候选（可能仍被更权威的级挡在屏外）
  const failedRank = candidates.map(() => false); // 每一级是否已**判失败**（= 这一级不存在）
  const noneAbove = (rank) => {
    for (let i = 0; i < rank; i++) if (!failedRank[i]) return false; // 更权威的级未判失败 ⇒ 挡住
    return true;
  };
  // 这一层「已经有画面 / 已经判定没有画面」的**元素级**记账 —— 建层方在等这个信号
  //（见 syncLayers 的切层内容闸门）。窗口 = 探针发出 → 有图或被判无图，也就是屏上
  // 只有第 0 级纯色的那一段。
  const contentSettled = () => {
    poster.dataset.weContent = "ready";
    noteLayerContent(poster);
  };
  const applyRank = (rank) => {
    const src = loadedRank[rank];
    if (!src || !noneAbove(rank)) return;
    poster.dataset.weFrameSrc = src; // 记录**屏上**那一级（诊断：当前用的是哪一级）
    if (poster.isConnected) poster.style.backgroundImage = "url(" + src + ")";
    contentSettled();
  };
  const probeRank = (rank) => {
    const src = candidates[rank];
    const probe = new Image();
    probe.onload = () => {
      // 第 1 级加载成功 ⇒ 先留下可同步上屏的字节（见 liveFrameBytes），下一次建层就能同步上帧。
      // 其它级（作者预览图）**不留**：留了命中分支就会把预览图当成"帧"直接上屏。
      if (rank === frameRank) retainFrameBytes(src, probe);
      loadedRank[rank] = src;
      applyRank(rank);
    };
    probe.onerror = () => {
      // 判失败 = 这一级**不存在**：低权威级的上屏闸门因此打开（已经就绪的那一级立刻补上）。
      failedRank[rank] = true;
      for (let i = rank + 1; i < candidates.length; i++) applyRank(i);
      // 每一级都判失败、且一张都没上屏 ⇒「这张壁纸没有画面」这个结论已经确定，再等也不会有图：
      // 闸门必须放行，否则守着旧层的那个等待永远等不到信号。终点语义仍是主题色兜底。
      if (failedRank.every(Boolean) && !loadedRank.some(Boolean)) contentSettled();
    };
    probe.src = src;
  };
  if (frameRank === 0 && paintFrame(poster, frameSrc)) {
    // 字节命中：帧同步上屏，**探针一个都不发** —— 连"复核这一级还在不在"都不需要：字节已经在本
    // 进程里，此刻屏上那一张就是可用的。复核反而会把一份完好的帧撤下来退回缩略图。
  } else {
    // 图到手之前这一层不算「有画面」（垫底图此刻只有第 0 级底色）——先记账，出图或
    // 被判无图时由上面两处销账。
    poster.dataset.weContent = "pending";
    // 没有字节在手（首次激活 / 冷启动 / 清帧之后）⇒ 逐级**并行**发请求（退级不依赖彼此的成败、
    // 也不挡发请求），谁上屏仍由上面的存在性闸门说了算。帧这次成功了就在 onload 里留下字节，
    // 下一次建层走上面那条。
    for (let i = 0; i < candidates.length; i++) probeRank(i);
  }
  return poster;
}

// 页面加载后是否仍处于「重启恢复」阶段：true 期间首次挂载 live 会延迟（见
// buildMedia 的 liveBootDelay）；用户一旦有交互（点击/按键）立即置 false ——
// 手动切换壁纸必须即时反馈，不延迟。
let bootRestore = true;
// 两条一次性监听**随 fiber 注册/注销**（模块级监听器不挂 fiber ⇒ 会随 revision 重跑叠加，
// 用户一直没交互时它们就一直叠着；见上方 `installLiveDiagnostics` 的整段说明）。
// `once: true` 让它们在首次交互后自摘，注销时再兜一次。
function installLiveBootRestore() {
  const drop = () => { bootRestore = false; };
  const opts = { capture: true, passive: true, once: true };
  const target = typeof window === "undefined" ? null : window;
  let bound = [];
  if (target && typeof target.addEventListener === "function") {
    for (const ev of ["pointerdown", "keydown"]) {
      try { target.addEventListener(ev, drop, opts); bound.push(ev); } catch { /* ignore */ }
    }
  }
  return function () {
    for (const ev of bound) { try { target.removeEventListener(ev, drop, opts); } catch { /* ignore */ } }
    bound = [];
  };
}
// 延迟挂载（只作用于「重启恢复上次壁纸」那一档）：**延迟期照常开始加载** —— iframe 一赋
// `src` 就已经在拉 pkg / 解码纹理 / 编译 shader，这正是这一档存在的理由（让首帧先热起来，
// 上屏时才不至于慢）。延迟只决定**什么时候把它插进图层**。
//
// 两条不变量，缺哪条都会变成用户可见的卡顿：
//   ① **首帧就绪即挂载**：`liveBootDelay` 是**上限**而不是固定等待 —— 读到首帧就立刻换屏，
//      出帧快的壁纸不再白等满 N 秒；到上限仍未出帧也照挂（最坏情况与固定等待一致）。
//   ② **切走必须取消并释放**：未挂载的预热页是一个**正在跑**的渲染页，不是普通元素 ——
//      换壁纸时不显式终止（`src = about:blank`）它就会留在后台继续抢 CPU/GPU，与新壁纸的
//      启动叠在同一主线程上（用户反馈：延迟期切下一张会卡）。这与轮换准备期的 staging 探针
//      是同一条纪律（见 prepareSceneLiveStage 的 bail / 「准备期零驻留」）。
let liveMountPending = null; // { sel, frame, timer, deadline }
const LIVE_MOUNT_POLL_MS = 300;
function cancelLiveMount(reason) {
  const p = liveMountPending;
  if (!p) return;
  liveMountPending = null;
  if (p.timer) { try { clearTimeout(p.timer); } catch { /* ignore */ } }
  // 未挂载 ⇒ 显式中止在途加载并拆掉那个渲染页（WebGL context / rAF / 定时器一起消失）。
  // ⚠️ **分离态** iframe 上赋 `src` 不会提交导航（实测：预热页带着整个引擎常驻到
  // 会话结束 —— 本机一次泄漏 9 个 4K 引擎，把后续所有大包首帧拖到超时）——
  // 先隐身挂进文档让导航真实发生，提交后再把空壳移除。已连接的帧可能是别的路径
  // 刚领养的 live 层（见 mount 的轮换领养分支），保持原样绝不动它。
  try {
    if (p.frame && !p.frame.isConnected) {
      p.frame.style.cssText = "position:fixed;left:-99999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none";
      (document.body || document.documentElement).appendChild(p.frame);
      p.frame.src = "about:blank";
      setTimeout(() => { try { p.frame.remove(); } catch { /* ignore */ } }, 1000);
    }
  } catch { /* ignore */ }
  if (reason) liveLog("boot-mount-cancel", "wid=" + p.sel.id + " reason=" + reason);
}
/** 首帧是否已出来。场景与 startLiveWatch 的「活」判据同源（running 且 fps>0）；网页壁纸
 *  常无 rAF 打点，退化为「渲染页可达」（getState 可读）—— 与运行期 watchdog 同口径。 */
function liveFrameReady(frame, sel) {
  if (sel.type === "web") return Boolean(liveStateOf(frame));
  const st = liveStats(frame);
  return Boolean(st && st.running && st.fps > 0);
}
// ── 看护器「活着」的唯一判据──────────────────────────────────────
// 就绪分型（**两处看护**必须逐字共用，否则两只眼睛会对同一帧给出不同答案）：
//   · 场景：每帧都有 GL 提交 ⇒ 要求真出帧（`running && fps > 0`）；
//   · 网页：很多没有 rAF 打点（setTimeout 主循环 / 纯静态）⇒ 只要渲染页**可达**
//     （`getState` 可读，退一步信 `__wpStats`）就算活着 —— 按 fps 判定会把它们
//     误判失败并降级（实测：一直停在占位图，15 秒后黑屏）。
// 参数是**本拍的本地读数**（心跳 tick 与领养补挂都在手上），不是 frame：
// 于是它一次碰渲染页都不碰，调用方也不会为了问一句话多读一遍 `__wpStats`。
// 为什么抽出来：心跳自愈（startLiveWatch 的 tick）与领养补挂（syncLayers 的 adopt 分支）
// 原本各写各的等价判据 —— 心跳那边问 `alive`（只看 `iframeLoaded`），领养那边问
// `liveFrameReady`。对**可达但还没 load 完**的网页窗口两者答案不同：领养那一跳放行、
// 心跳那一拍却不算自愈，于是"清零点把标志清了、而自愈偏不认这帧"会一直悬着，直到
// 下一次 emit 才被补挂（可能永远等不到）。合成一处后，两边对同一帧的答案逐字相同。
function liveHeartbeatAlive(frame, stats, wstate, isWeb) {
  return isWeb
    ? (wstate ? wstate.iframeLoaded === true : Boolean(stats))
    : Boolean(stats && stats.running && stats.fps > 0);
}
/**
 * 领养补挂那一跳的类型就绪判据（与 `liveHeartbeatAlive` 同一函数体 —— 同名同义，
 * 别名只为在调用点读出自证）：它手上只有本拍的心跳读数，而 `liveFrameReady` 对网页
 * 要求 `getState` 可读 ⇒ 可达到底、但还没 load 完的窗口会恒判 false，自愈也就永远
 * 不认这帧。场景那边两者本来就同源（`running && fps > 0`），零行为差异。
 */
const liveHeartbeatReady = liveHeartbeatAlive;
function scheduleLiveMount(sel, frame, delayMs) {
  cancelLiveMount("replaced"); // 同一时刻只允许一个未上屏的预热页
  const entry = { sel, frame, timer: 0, deadline: Date.now() + delayMs };
  liveMountPending = entry;
  const mount = (viaIdle) => {
    if (liveMountPending !== entry) return; // 已被取消 / 被替换
    const layer = document.getElementById(LAYER_ID);
    if (selection.id !== sel.id || !liveRenderEnabled(selection) || !layer) { cancelLiveMount("stale"); return; }
    if (frame.isConnected) { liveMountPending = null; return; } // 已被别的路径挂上（轮换领养）
    // 层里已经有 live 页（轮换的节点级领养）：绝不再插第二个。
    if (layer.querySelector("iframe.we-live-iframe")) { cancelLiveMount("layer-has-live"); return; }
    liveMountPending = null;
    layer.appendChild(frame);
    // 延迟载荷的帧：挂上之后再问一次"现在能加载了吗"（挂载本身不 emit，
    // 否则它要等下一次无关的 syncLayers 才补 src）。
    armDeferredLiveFrame(frame);
    // ⚠️ 必须在这里补一次武装：`load` 回调只在 `isConnected` 时武装心跳，而延迟路径的文档
    //    很可能**在挂载之前**就 load 完了（那一刻 isConnected=false）⇒ 不补这一次，首帧确认
    //    永远不会发生、`we-live-on` 永远不加上、iframe 一直停在 opacity 0（只有垫底图）。
    //    startLiveWatch 自己会停掉上一个，重复武装是安全的。
    //    **延迟载荷的帧不在这里武装**（它还没有 src，武装了只会白烧一个预算窗口）：
    //    交给 load 回调 —— armDeferredLiveFrame 赋 src 之后它才会来。
    if (!liveFrameDeferred(frame)) { try { startLiveWatch(frame, sel.id); } catch { /* ignore */ } }
    liveLog("boot-mount", "wid=" + sel.id + (viaIdle ? " idle" : " ready"));
  };
  const tick = () => {
    if (liveMountPending !== entry) return;
    if (liveFrameReady(frame, sel)) { mount(false); return; } // ① 就绪即挂载，不等上限
    if (Date.now() >= entry.deadline) {
      // 到上限仍未出帧：仍走「等首屏空闲再挂」（最坏情况与固定等待那一版一致）。
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(() => mount(true), { timeout: 2000 });
      } else {
        setTimeout(() => mount(true), 300);
      }
      return;
    }
    entry.timer = setTimeout(tick, LIVE_MOUNT_POLL_MS);
  };
  entry.timer = setTimeout(tick, Math.min(LIVE_MOUNT_POLL_MS, delayMs)); // 首拍稍早：小 pkg 可能一帧内就绪
}

function createLiveFrame(sel) {
  const frame = document.createElement("iframe");
  const url = liveRenderUrl(sel);
  // **不该现在拉载荷就先不赋 src**（隐藏 / 用户暂停 / 省电暂停）：首帧等于整包到齐，
  // 而这样的实例根本出不了帧（Chromium 冻结隐藏页的 rAF），拉下来只会和**可见**那个
  // 实例抢带宽与解码器 —— 实测 3 个实例同时挂同一份 336MB 包，唯一走完的是最后那个，
  // 可见那个在 15s 时一帧都没出。层键仍算 live（`wantKey` 里没变）⇒ 不触发重建，
  // 垫底图照旧；补 src 由 armDeferredLiveFrame 在"可见且应播"时做（可见性变化会 emit）。
  if (liveFrameShouldDefer()) {
    frame.dataset.weLiveSrc = url;
    liveLog("live-payload-defer", "wid=" + (sel && sel.id) + " 隐藏/未播放中 → 先不加载载荷（可见时补）", "info", true);
  } else {
    frame.src = url;
  }
  frame.setAttribute("frameborder", "0");
  frame.setAttribute("scrolling", "no");
  // iframe 内音频（HTMLAudioElement / 网页壁纸的媒体）的自动播放授权。
  frame.setAttribute("allow", "autoplay");
  frame.className = "we-media we-iframe we-live-iframe";
  frame.addEventListener("load", () => {
    // onload 只说明文档加载完成（模块还在执行 / pkg 未拉取），真正「活」
    // 由心跳判定；文档若已被重建移除则直接放弃。
    // **延迟载荷的帧要跳过**：载荷暂停时我们把 src 摘成 about:blank（也会触发 load），
    // 那时武装心跳只会让看护对着一个空白页烧掉预算 → 15s 后误判首帧超时。
    if (frame.isConnected && !liveFrameDeferred(frame)) startLiveWatch(frame, sel.id);
  });
  return frame;
}

// 网页壁纸：live 就绪 3 秒后抽一帧（等动画进入稳定画面）存到 host，
// 之后每次加载/重启先用它占位。抽帧失败静默（占位逻辑不受影响）。
let liveFrameCapturedFor = "";
function maybeCaptureLiveFrame(frame, sel) {
  if (sel.type !== "web" || !sel.liveFrame) return;
  if (liveFrameCapturedFor === String(sel.id)) return;
  liveFrameCapturedFor = String(sel.id);
  setTimeout(() => {
    if (!frame.isConnected || selection.id !== sel.id) return;
    let dataUrl;
    try {
      const wp = frame.contentWindow && frame.contentWindow.__wp;
      dataUrl = wp && typeof wp.capture === "function" ? wp.capture(1920) : null;
    } catch { return; }
    if (!dataUrl || dataUrl.indexOf("data:image/") !== 0) return;
    // 网页壁纸的真实帧同样是比作者预览图更好的证据：交给「主题随壁纸」重判一次
    //（排名 2；作者配色在场时它自己会让路）。
    themeFollowOnFrameImage(dataUrl);
    // 两跳都走统一出入口：`data:` URL 是**本地字节转换**（apiUrl 原样放行），POST 才是宿主 API。
    // ⚠️ 第一跳必须 `parse: false`：默认路径在 2xx 上 `response.json()` 会先吃掉 body 流，
    // 随后的 `response.blob()` 必抛 —— 帧上传链路会整条静默断掉（同封面那条）。
    apiFetch(dataUrl, { parse: false }).then((r) => r.response.blob()).then((blob) => apiFetch(sel.liveFrame, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: blob,
    })).then(() => {
      // 帧被换掉了：留存里那份字节属于正被替换掉的那一帧，撤掉（下一次建层按新帧重新留）。
      releaseFrameBytes(sel.liveFrame);
      // 就地换上刚抽的帧（当前会话立刻可见；下次加载由 host 缓存直接提供）
      const layer = document.getElementById(LAYER_ID);
      const poster = layer && layer.querySelector(".we-live-poster");
      if (poster && poster.style && !poster.dataset.weFrameApplied) {
        poster.dataset.weFrameApplied = "1";
        poster.style.backgroundImage = "url(" + sel.liveFrame + "?t=" + Date.now() + ")";
      }
      reportClientDiag("live-capture", "uploaded");
    }).catch((e) => { reportClientDiag("live-capture-fail", String(e && e.message || e)); });
  }, 3000);
}


export { liveFrameEl, buildLivePoster, scheduleLiveMount, cancelLiveMount, createLiveFrame, installLiveBootRestore, livePointerFrame, bootRestore };
