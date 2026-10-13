/*
 * video-layer.js — **视频壁纸通道**：视频档的"有画面了吗" + 它的切换放行策略。
 *
 * 为什么单开一条通道：为**实时渲染**设计的那条路（`live-layer.js` 里的切层内容闸门、垫底图、
 * 心跳、载荷、GPU 抓帧…）对视频**只有一部分有意义**。
 * 实测后果：闸门的视频判据是"手上已有一帧"（`readyState ≥ 2`），而视频档**故意不设 poster**
 *（WE 的动图预览当 poster 会先播预览）⇒ 整次切换（含过场）被推迟到首个可解码帧：
 * 源越大越久、帧率上限越高越久，从秒级退化到十几秒。
 *
 * 判据（本文件的两条不变量）：
 *   ① **放行 ⇔ 屏上真的有画面**：海报图**已加载**（不是"属性存在"）｜首帧 `readyState ≥ 2`｜
 *      预算到期（兜底，避免拿不到海报就永远换不下去）。
 *   ② **没画面时旧壁纸留在屏上**：绝不露出这一层的底色。
 *      ⚠️ 不许改成"poster 属性存在即放行"：海报是按需抽帧生成的（与 4K 抽帧转码抢
 *      CPU，十几秒才到）⇒ 那十几秒屏上是一块**纯色**（层底色），观感比"旧壁纸多留
 *      十几秒"更糟。
 *
 * 本文件拥有：就绪判据（`videoContentReady` / `probeVideoPoster` / `VIDEO_POSTER_BUDGET_MS`）、
 * 媒体构建（`buildVideoMedia`：`<video>` / Edge 镜像画布 / poster / 音轨与 `playbackRate` / `object-fit`）、
 * 抽帧换源链路（源元数据探测 → 是否值得转码 → 进度轮询 → 换源或回退）。
 */

/**
 * 海报预算：拿不到海报图时的兜底（到期放行 ⇒ 旧壁纸让位，最坏是黑一下再进正片）。
 *
 * ⚠️ 这个数是**用户感知的延迟上限**，实测调过两次：
 *   · 4000 ms — 诊断里出现 3907/3891/3887 ms 的整簇（全是预算触发的签名）：
 *     按需抽的海报图在 4K 源跑抽帧转码时会被抢 CPU，常常 4 秒内到不了 ⇒ 每次切换
 *     都等到预算；
 *   · 1200 ms — 海报要么很快到（已热时实测 213/215/218/231 ms），要么就让位给视频首帧。
 * 真正的根治不在这个常数上（见文件头"抽帧换源"段的待办：海报预抽/优先级）。
 */
const VIDEO_POSTER_BUDGET_MS = 1200;

/**
 * 停滞上限：到这里仍然没有画面 ⇒ **停止等待，但也不放行空层**（不变量 ②：绝不露出这一层
 * 的底色）。旧壁纸继续留在屏上，只留一条 warn 日志。
 *
 * 为什么要这条：预算到期就放行不行 —— 视频档通常**没有 poster**（只认
 * `/video-preview/`）⇒ 放行那一刻屏上只有这一层的底色（=壁纸主色）。真机日志（桌面壳）
 * 抓到的正是这一幕：
 *   `gate-open … held=1201ms out=1 rs=0 ns=1 vw=0x0` → `loadedmetadata +2053ms` →
 *   `loadeddata +2095ms` → `presented +2167ms`
 * 也就是用户盯着那块纯色 1–2 秒（源慢时更久）。文件头那条实测结论早就写过：这种"铺纯色"
 * 的观感比"旧壁纸多留一会儿"更糟 —— 这里把它落到判据上。
 */
const VIDEO_STALL_GIVE_UP_MS = 15000;


// ── 提交前预热：把"取数"挪出切换的关键路径 ────────────────────────────────────
// 切换那一下真正要等的是**媒体元素的启动**：资源选择 → 取 moov → 解复用器初始化 →
// 首帧解码。本机实测：宿主+磁盘 ~4ms、`loadedmetadata → presented` ~110ms，其余时间都是
// "还没开始取数"。视频档**刻意不跑准备链**（`prepareVideoProbe` 会 `play()` ⇒ 第二个
// 4K 解码器在跑，实测双解码卡顿），于是整段启动成本都压在关键路径上。
//
// 这里的折中：只预热到 **HAVE_METADATA**（`preload="metadata"`、**绝不 play()**、muted）——
// 解复用器与 moov 先就位，**一帧都不解码**；用户真的点了就把这个元素领养进层
//（`consumeWarmVideo`），剩下的只是一帧的取数与解码。
// 单槽位 + TTL：任何时刻最多一个预热元素，没人用就自己释放。
const VIDEO_WARM_TTL_MS = 20000;
// 悬停预热的静默期：鼠标扫过一排卡片时不必把经过的每一张都摸一遍（见 warmVideoForPointer）。
const VIDEO_WARM_HOVER_MS = 120;
let videoWarm = null; // { url, el, timer }
let warmHoverTimer = 0; // 待发的悬停预热
function disposeWarmVideo() {
  const w = videoWarm;
  videoWarm = null;
  if (warmHoverTimer && typeof clearTimeout === "function") {
    try { clearTimeout(warmHoverTimer); } catch { /* ignore */ }
    warmHoverTimer = 0;
  }
  if (!w) return;
  if (w.timer && typeof clearTimeout === "function") { try { clearTimeout(w.timer); } catch { /* ignore */ } }
  try { w.el.removeAttribute("src"); w.el.load(); } catch { /* ignore */ }
}
/**
 * 预热一个视频源（只到元数据）。
 *
 * ⚠️ 三条不变量：
 *   · **绝不 `play()`、绝不 `autoplay`** —— 预热不得引进第二个解码器（本文件头的取舍）；
 *   · 同一个 url 幂等（槽位里已经是它就直接返回）；
 *   · 单槽位：换一个候选就把上一个释放掉（点选来回扫不会攒下一串解复用器）。
 */
function warmVideoUrl(url) {
  const u = String(url || "");
  if (!u || typeof document === "undefined" || typeof document.createElement !== "function") return;
  if (videoWarm && videoWarm.url === u) return;
  disposeWarmVideo();
  let el;
  try { el = document.createElement("video"); } catch { return; }
  if (!el || typeof el.load !== "function") return;
  try {
    el.preload = "metadata";      // ← 只取 moov：Chromium 拿到元数据就停
    el.muted = true;
    el.loop = true;
    el.autoplay = false;          // ← 预热不解码帧
    el.setAttribute("playsinline", "");
    el.src = u;              // 赋 src 本身就会启动资源选择；**不再调 load()** ——
                             // 同值重启资源选择等于白跑一次取数（本文件建层那段有同类注释）。
  } catch { return; }
  const timer = typeof setTimeout === "function" ? setTimeout(() => {
    if (videoWarm && videoWarm.el === el) disposeWarmVideo();
  }, VIDEO_WARM_TTL_MS) : 0;
  videoWarm = { url: u, el, timer };
  liveLog("video-warm", "预热（仅元数据，不解码） " + u.slice(Math.max(0, u.lastIndexOf("/") + 1)).slice(-24));
}
/** 领养预热好的元素（同 url 才给）。命中即交出，槽位随之清空。 */
function consumeWarmVideo(url) {
  const w = videoWarm;
  if (!w || w.url !== String(url || "")) return null;
  videoWarm = null;
  if (w.timer && typeof clearTimeout === "function") { try { clearTimeout(w.timer); } catch { /* ignore */ } }
  liveLog("video-warm", "领养预热元素 " + String(w.el.readyState === undefined ? "-" : w.el.readyState) + " rs");
  return w.el;
}
/**
 * 指针落到某张壁纸卡上时预热它。
 *
 * 两个触发点，窗口不一样：
 *   · `pointerdown`（immediate=true）—— 点击发生在抬手，按下到抬手就是白捡的窗口；
 *   · `pointerover`（immediate=false）—— 鼠标**停在**卡片上通常几百毫秒到几秒，窗口更大；
 *     扫过一排卡片时靠 120ms 的抖动静默掉（单槽位 + 幂等已经把开销压到可忽略，但没必要
 *     扫一次就把一排源都摸一遍）。
 * 卡片靠 `data-we-id`（见 picker-modal / quick-panel）自报身份；解析不到就静默返回。
 */
function warmVideoForPointer(ev, immediate) {
  try {
    const t = ev && ev.target;
    const card = t && typeof t.closest === "function" ? t.closest("[data-we-id]") : null;
    const id = card && typeof card.getAttribute === "function" ? String(card.getAttribute("data-we-id") || "") : "";
    // 任何一次"落到某张卡上"都先撤掉待发的悬停预热：人已经离开了上一张。
    if (warmHoverTimer && typeof clearTimeout === "function") {
      try { clearTimeout(warmHoverTimer); } catch { /* ignore */ }
    }
    warmHoverTimer = 0;
    if (!id) return;
    const list = (selection.inventory && selection.inventory.wallpapers) || [];
    const w = list.find((x) => x && String(x.id) === id);
    if (!w || w.type !== "video" || !w.media) return;
    if (immediate || typeof setTimeout !== "function") { warmVideoUrl(w.media); return; }
    const url = w.media;
    warmHoverTimer = setTimeout(() => { warmHoverTimer = 0; warmVideoUrl(url); }, VIDEO_WARM_HOVER_MS);
  } catch { /* 预热是增强：任何异常都不许影响切换 */ }
}

/**
 * 探一次海报图（`<video poster>` 的 URL）。
 *
 * 为什么要探：`poster` **属性存在**不等于**图已加载** —— 属性刚设上时 `<video>` 还是透明的，
 * 那一瞬屏上就是层底色。只有 `onload` 才算"有画面"。
 * 返回一个取消函数；`Image` 不可用（精简 DOM / 挂载台）时**立即**回调 `onReady`（不拦）。
 */
function probeVideoPoster(video, onReady, onFail) {
  const url = video && video.getAttribute ? String(video.getAttribute("poster") || "") : "";
  if (video) { try { video.__wePosterReady = false; } catch { /* ignore */ } }
  // 判不了就不拦：没有海报 URL、或环境没有 `Image`（精简 DOM / 挂载台）⇒ 直接当"已就绪"。
  if (!url || typeof Image !== "function") {
    if (video) { try { video.__wePosterReady = true; } catch { /* ignore */ } }
    onReady();
    return () => {};
  }
  let done = false;
  const img = new Image();
  img.onload = () => {
    if (done) return;
    done = true;
    try { video.__wePosterReady = true; } catch { /* ignore */ }
    onReady();
  };
  img.onerror = () => { if (!done) { done = true; onFail(); } };
  try { img.src = url; } catch { if (!done) { done = true; onFail(); } }
  return () => { done = true; };
}

/**
 * 视频层现在"有画面"吗（**通道自己的判据**，与实时那条路的闸门无关）。
 *
 * 顺序即优先级：作者静帧/海报（已加载）> 首帧 > 都没有。Edge 的镜像画布那条腿由调用方
 * 先判（画布底写死 #000，要等真画上一笔）。
 */
function videoContentReady(video) {
  if (!video) return true;
  const hasPoster = !!(video.getAttribute && video.getAttribute("poster"));
  if (hasPoster && video.__wePosterReady === true) return true; // 海报真到了 ⇒ 屏上有图
  if (Number(video.readyState) >= 2) return true;              // HAVE_CURRENT_DATA = 手上有帧
  return false;                                                // 都没有 ⇒ 先别换（旧层留屏）
}

/**
 * 这一层现在是否还被"切层内容闸门"押着（`we-layer--pending`）。
 *
 * 为什么视频通道要知道：**换源会清掉已上屏的那一帧**。层还被押着时（旧壁纸在屏上）换源
 * 是免费的；层已经上屏后再换，屏上就只剩这一层的底色 —— 真机形态：设了「帧率上限」时，
 * 抽帧就绪那一刻在**在屏元素**上 `src = transcoded; load()` ⇒ 一块纯色（限制帧率才有、
 * 设成无限制就没有，正是这条）。所以升级只允许在 pending 期间落地，否则推到下一次建层
 * （见 buildVideoMedia 对 selection.transcodeReady 的使用）。
 */
function layerStillPending() {
  try {
    const n = document.getElementById(LAYER_ID);
    return Boolean(n && n.classList && typeof n.classList.contains === "function"
      && n.classList.contains("we-layer--pending"));
  } catch { return false; }
}

/**
 * 视频档的媒体构建（③：自 src/media-prep.js 迁入）。
 *
 * 返回 `media`；Edge 那条腿（镜像画布）返回 `[media, canvas]`，由调用点用 `Array.isArray`
 * 识别。`fitClass` 是调用点所在函数的局部量 ⇒ 作为参数传入。
 */
function buildVideoMedia(sel, fitClass) {
  // 轮换领养：就绪元素（已 canplay/预播中）直接进层，绝不重赋 src（重赋
  // 即使同值也会触发 resource selection 重新加载 = 黑屏闪烁源）。
  const prepared = consumePreparedMedia("VIDEO", sel.url);
  // 预热元素（见 VIDEO_WARM_TTL_MS 那段）：领养它 ⇒ 建层那一刻解复用器已经在位。
  const warmed = prepared ? null : consumeWarmVideo(sel.url);
  const media = prepared || warmed || document.createElement("video");
  if (!prepared && !warmed) {
    // 已经转好的抽帧版（上一次在"已上屏"状态下就绪、刻意没换源的那一份）：
    // **建层时就用它当 src** —— 这样整个生命周期里一次换源都不发生（换源 = 清掉当前帧 = 纯色）。
    // 判据只看"这份抽帧版是不是当前上限的"：**不看原生可解性** —— 帧率上限的意义就是压解码
    // 占用，原生可解的源照样可能帧率超标（4K120 的 H.264），拿它当免转条件会让上限在实际
    // 在用的 mp4 上完全失效（见 capNeedsTranscode 的注释）。
    const tok = String(sel.url || "").split("/").pop();
    const rc = selection.transcodeReady;
    const useCached = Boolean(rc && rc.url && rc.fps === selection.fpsCap && rc.token === tok);
    media.src = useCached ? rc.url : sel.url;
    if (useCached) {
      try { media.dataset.weTranscoded = String(rc.fps); } catch { /* ignore */ }
      selection.transcodeState = "ready";
      selection.transcodeProgress = null;
    }
    // poster=预览图：覆盖初始加载与抽帧转码 swap 的空窗（原黑屏闪烁点）。
    // 视频类壁纸**不设 WE 自带的 `preview.gif`** —— 动图当 poster 会"先播预览、再停首帧、
    // 最后进正片"；改为**只认插件自己抽的静态缩略图**（`/video-preview/…` 是 ffmpeg 抽的一帧
    // JPEG，见宿主 videoPreviewCachePath 的 `pv_*.jpg`）。挂上它有两重收益：
    //   ① 切层内容闸门把 `video[poster]` 直接算作"有画面" ⇒ **立即放行**，不再等首帧
    //     （等首帧实测会把整次切换推到十几秒：源越大 / 帧率上限越高越久）；
    //   ② 加载窗口里屏上是**真缩略图**，而不是无帧 <video> 那块空/黑 ⇒ 闸门要防的
    //     "露出底色"照旧不发生。
    // 场景内嵌 MP4 的 poster 是静态帧，是「先静帧后动态」的既有设计，保留 —— 判据见
    // rotation-prepared-leak-smoke.mjs 的 T2 / T2b（无静态缩略图仍必须等帧）。
    const stillPreview = !!sel.previewUrl
      && (sel.type !== "video" || /\/video-preview\//.test(sel.previewUrl));
    if (stillPreview) media.poster = sel.previewUrl;
  }
  media.autoplay = true;
  media.loop = true;
  // ⚠️ 必须显式 `preload="auto"`：缺省（=metadata）+ 这几张源的 moov 在文件**尾部** ⇒
  // Chromium 取完 moov 就停，真正开始取帧要等 `play()` —— 而 play() 在**更晚的一趟**
  // syncLayers 里才被调用（自动播放被策略拒绝时那一趟永远不会来）。真机日志（桌面壳）
  // 里"rs=0 停 2 秒"正是这一段空窗；而元素从 loadedmetadata 到 presented 实测只要 ~110ms。
  // auto 让元素**建层即开始取数据**（本地文件，代价可忽略）。
  media.preload = "auto";
  // 音轨按用户设置应用（见 weApplyAudio）：默认 0 音量 ⇒ 等价 muted；调高音量后才有声音。
  media.setAttribute("playsinline", "");
  // Native playbackRate — hardware-decoded, instant, no reload.
  try { media.playbackRate = sel.playbackRate; } catch { /* ignore */ }
  if (IS_EDGE && sel.edgeCompat !== false) {
    // Edge: keep the decoder element out of sight (its floating 下载/投屏
    // toolbar attaches to any VISIBLE <video>), render via <canvas> instead
    // (see weStartDraw / weDrawFrame). Attributes are belt-and-suspenders.
    media.setAttribute("disablepictureinpicture", "");
    media.setAttribute("disableremoteplayback", "");
    media.style.cssText = "position:absolute;left:-100000px;top:0;width:320px;height:180px;opacity:0.01;pointer-events:none;";
    const canvas = document.createElement("canvas");
    canvas.className = "we-media we-media--canvas" + fitClass;
    canvas.style.background = "#000";
    return [media, canvas];
  }
  // ⚠️ 这一行是**尺寸与 object-fit 的来源**（`.we-media` / `.we-media--fit`）。
  // ⑧ 提取 `buildVideoMedia` 时我的切分器末端排他，把原分支**最后一行**切掉了 ⇒
  // 视频元素拿不到类名 ⇒ 只显示左上角、占不满屏（实测回归）。判据见 verify-scene-live
  // 的「两条腿都必须挂类名」。
  media.className = "we-media" + fitClass;
  return media;
}


// ══════════════════════════════════════════════════════════════════════════════


// ══════════════════════════════════════════════════════════════════════════════
// 抽帧换源链路（媒体信息探测 + 抽帧升级 + 元数据兜底 + 取消）
//
// 它**零实时引用**，所以整块住在视频通道里而不是拆去别处。
// 不变量：本段的模块级绑定**没有任何顶层求值期读取** ⇒ 在内联清单里换位置不会撞 TDZ
//（顶层读别的模块的 `const` 会撞，见 `CODE-STRUCTURE.md` §5 第 2 条）。
// ══════════════════════════════════════════════════════════════════════════════
/**
 * **源元数据探测 + 抽帧转码升级**的完整生命周期。
 *
 * 为什么单独一个文件：这是一条**有状态的生命周期**（探测 → 决策 → 进度轮询 → 落地/回退），
 * 其中同时有"迟到响应必须作废""换上限要打断旧请求""15s 元数据兜底""播完才换源"四件
 * 容易互相踩的事，集中在一处才看得清它们彼此的约束。
 *
 * 契约（本文件是客户端程序的一部分，构建期由 scripts/build-client.mjs 内联进 bundle 的
 * 工厂作用域，"外部作用域"= 同一 prelude / src/client.js 的顶层。依赖是**机械清点**出来的）：
 *   selection                 ← 设置/选中项的唯一 store（读：type/url/fpsCap/…）
 *   LAYER_ID                  ← 壁纸层元素 id
 *   emit()                    ← 单向重渲染（本文件不直接碰 DOM 结构）
 *   isEffectivelyPlaying()    ← "当前是否在播"（换源前判断，避免打断播放）
 *   weDrawFrame()             ← 抓/重绘一帧（换源后立刻上屏）
 *   apiJson(path) / apiFetch(path)  ← src/api-client.js（宿主 API 唯一出入口；探测带 signal 透传）
 * 提供的入口：
 *   refreshMediaInfo(force)              读 /media-info，写 selection.mediaInfo（含"源 fps ≤ 上限 ⇒ 无需转码"）
 *                                        以及宿主只读回答的"该上限的抽帧版已在盘上"
 *                                        ⇒ 预置 selection.transcodeReady（下一次建层直接播抽帧版）
 *   maybeUpgradeToTranscoded(video, token) 决策并启动/落地抽帧转码（syncLayers 调用）
 *   transcodeUpgradeFailed(video, token)   转码失败回退（含 UI 文案）
 *   abortTranscodeUpgrade()              打断升级：清轮询 + 清兜底 timer + abort 请求
 *   invalidateMediaInfoProbe()           作废"进行中"的探测（迟到的响应不再写 selection）
 *   abortMediaInfoProbe()                断开探测的 AbortController（卸载用）
 *   revertTranscodedVideo(video)         把已换源的 <video> 退回原始源
 *   clearUpgradePoll() / clearUpgradeMeta()  仅供守卫单独取用（内部实现）
 *
 * 不变量：
 *   · 这三个字段的**状态机写入全部在本文件**：`selection.mediaInfo` / `transcodeState` /
 *     `transcodeProgress`。src/client.js 只允许在**换壁纸/切走**时把它们**复位**
 *     （`= null` / `= "idle"`，紧接着 abortTranscodeUpgrade() + refreshMediaInfo() 交接给本文件）
 *     —— 别处改写会绕过状态机，让"旧请求的结果覆盖新请求"重新变成可能。
 *     这条不是口号：test/verify-transcode-state.mjs 扫两个源文件核对它。
 *   · 自己的运行状态（两个探测/升级的 token、AbortController、两个 timer）**不外露**，只经入口操作。
 *   · 定时器与 AbortController 必须成对清理：卸载路径调用 abortTranscodeUpgrade() ——
 *     漏掉就是"卸载后 500ms 轮询永久泄漏"（真实缺陷）。
 *   · 本文件必须保持浏览器安全（无 import / require / Node API），且**不得有顶层可执行语句**
 *     —— 它会被内联到 bundle 顶部（早于 client.js 正文），顶层读 body 里的 const 会撞 TDZ。
 */

// ── Source metadata + frame-skip transcode (抽帧转码) ────────────────────────
// The decode-side fps cap (帧率上限) is implemented as a HOST re-encode, NOT as
// playbackRate: playbackRate is a speed multiplier, so capping decode through
// it would slow the motion. The host transcodes the wallpaper once to the cap
// fps (4K120 → 4K60, timeline 1.0x, AV1 via NVENC) and caches it; here we play
// the ORIGINAL immediately (instant first paint) and, while the host runs the
// one-time transcode, swap to the capped-fps file when it is ready — normal
// speed + halved decode. 倍速 (playbackRate) keeps working on top of either.
let mediaInfoToken = "";
// In-flight marker: while the /media-info probe for this token is pending,
// maybeUpgradeToTranscoded must NOT fire a transcode request — the probe may
// come back with fps ≤ cap (no transcode needed). Without this guard every
// wallpaper selection used to trigger a throwaway host-side ffmpeg run.
let mediaInfoInFlight = "";
// 在途探测的 AbortController: token 变更或强制刷新时终止上一次 fetch — 否则被
// 取代的探测会一直跑 (结果只靠 mediaInfoToken 检查丢弃), fiber 卸载时也要 abort。
let mediaInfoAbort = null;
/**
 * 抽帧版的 URL（唯一构造点）：`maybeUpgradeToTranscoded` 的探针/换源与
 * `refreshMediaInfo` 采纳宿主"已有缓存"的回答都走它 —— 两处各拼一次字符串迟早漂移。
 */
function transcodedUrlFor(token, fps) {
  return "/wallpaper-engine/transcoded/" + encodeURIComponent(token) + "?fps=" + fps;
}
async function refreshMediaInfo(force) {
  const token = selection.type === "video" && selection.url
    ? selection.url.split("/").pop()
    : null;
  if (!token || (!force && token === mediaInfoToken)) return;
  // 旧探测的结果一定没用了 (token 变了, 或被 force 重刷取代) → 立刻断开
  if (mediaInfoAbort) { try { mediaInfoAbort.abort(); } catch { /* ignore */ } mediaInfoAbort = null; }
  // AbortController 可能不存在 (无计时器/无 fetch 设施的验证环境): 为 null 时走无 abort 的退化路径
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  mediaInfoAbort = ctrl;
  mediaInfoToken = token;
  mediaInfoInFlight = token;
  try {
    // 探测带 abort：`apiJson` 透传 signal，被取代的探测不写状态（下方 mediaInfoToken 校验）。
    // `?fps=` 是**当前上限**：宿主据此只读地回答"这个上限的抽帧版在不在盘上"（见下）。
    const res = await apiJson(
      "/media-info/" + encodeURIComponent(token) + "?fps=" + encodeURIComponent(String(selection.fpsCap || 0)),
      { signal: ctrl ? ctrl.signal : undefined });
    const data = res.data || {};
    if (mediaInfoToken === token) {
      selection.mediaInfo = (data && data.info) || null;
      // 源帧率**不高于**上限 ⇒ 不需要抽帧；把在途的升级停掉。
      const mi = selection.mediaInfo;
      if (capNeedsTranscode(mi, selection.fpsCap) === false) {
        abortTranscodeUpgrade();
        // Also drop a swapped transcode from a previous LOWER cap, so the
        // panel hint matches what is actually playing (the original).
        const layer = document.getElementById(LAYER_ID);
        const video = layer && layer.querySelector("video");
        if (video && video.dataset.weTranscoded) revertTranscodedVideo(video);
        selection.transcodeState = "skipped";
      } else if (data.transcode && data.transcode.cached === true
        && Number(data.transcode.fps) === Number(selection.fpsCap)) {
        // 宿主确认这个上限的抽帧版**已经在盘上**（它只会做一次 existsSync，不会起转码）。
        // 记进 `transcodeReady` ⇒ **下一次建层直接用抽帧版当 src**（buildVideoMedia 的
        // useCached 分支），既不再先取原片、也不用等 `/transcoded` 探针回来才换源。
        // 不在这里动 `<video>`：换源会清掉已上屏的那一帧，落地时机只由建层与
        // maybeUpgradeToTranscoded 决定（真机"纯色帧"根因，见 layerStillPending 的注释）。
        selection.transcodeReady = { token, fps: selection.fpsCap, url: transcodedUrlFor(token, selection.fpsCap) };
      }
    }
  } catch {
    // abort 掉的探测不写状态 (它已被更新的探测取代)
    if (!(ctrl && ctrl.signal.aborted) && mediaInfoToken === token) selection.mediaInfo = null;
  }
  const ownsAbort = mediaInfoAbort === ctrl; // 仍是本次探测 (没被更新的探测取代)
  if (ownsAbort) mediaInfoAbort = null;
  if (ownsAbort && mediaInfoInFlight === token) mediaInfoInFlight = "";
  // Settle → single re-emit so a deferred transcode decision (see
  // mediaInfoInFlight) runs against the final mediaInfo, success or failure.
  if (mediaInfoToken === token) emit();
}

let upgradeAbort = null;
let upgradeToken = "";
// The fps cap the in-flight upgrade request targets (0 = none). The in-flight
// latch used to be keyed by token ONLY, so changing the cap while a transcode
// for the OLD cap was still running was treated as "already working on it" —
// the stale request then completed and swapped the video to the old cap's
// re-encode while the picker advertised the new cap. Tracking the cap lets a
// cap change abort the stale request and start fresh.
let upgradeFps = 0;
// 这一次升级是不是**用户刚主动改的上限**（而不是"切换壁纸时顺带触发"）。
// 判据只影响一件事：换源要不要压在"(层还被闸门押着)"这个前提下。
//   · 切换壁纸触发（本值为假）⇒ 已上屏的层一律不换源（换源会清掉当前帧 = 纯色），推到下次建层；
//   · 用户点上限触发（本值为真）⇒ 允许当场换 —— 那是显式操作，短暂一闪是预期内的。
let upgradeByUser = false;
let capChangedAt = 0;
/** 上限被用户改动（`onFpsCap`）时调用：接下来这一轮升级算"用户主动"。 */
function noteFpsCapChange() {
  capChangedAt = Date.now();
}
let upgradePollTimer = null; // progress poller while the transcode fetch pends
function clearUpgradePoll() {
  if (upgradePollTimer) { clearInterval(upgradePollTimer); upgradePollTimer = null; }
}
// 15s metadata 兜底 timer (见 maybeUpgradeToTranscoded): 必须挂到升级状态上,
// abortTranscodeUpgrade 才能清掉它 — 否则被取代的请求超时后回调仍会跑在已
// detach 的 <video> 上 (重新赋 src, 元素再也释放不掉)。
let upgradeMetaTimer = null;
function clearUpgradeMeta() {
  if (upgradeMetaTimer && typeof window !== "undefined" && typeof window.clearTimeout === "function") {
    window.clearTimeout(upgradeMetaTimer);
  }
  upgradeMetaTimer = null;
}
function abortTranscodeUpgrade() {
  clearUpgradePoll();
  clearUpgradeMeta();
  if (upgradeAbort) { upgradeAbort.abort(); upgradeAbort = null; }
  upgradeToken = "";
  upgradeFps = 0;
  upgradeByUser = false;
  selection.transcodeProgress = null;
}
// Revert a video that was swapped to a capped-fps transcode back to the source.
// NOTE: no emit() here — this runs inside syncLayers (already inside an emit
// cycle); emitting synchronously from a subscriber re-enters the listener chain
// and recurses until the stack overflows. UI updates ride the outer emit.
function revertTranscodedVideo(video) {
  if (!video || !video.dataset.weTranscoded) return;
  delete video.dataset.weTranscoded;
  // 抽帧版被弃用（上限调低/关掉、或判明源无需抽帧）⇒ 那条"下次建层用它"的记录一并作废。
  selection.transcodeReady = null;
  try { video.src = selection.url; video.load(); } catch { /* ignore */ }
}
/**
 * ② 源是否**浏览器原生可解**（直接播，不需要抽帧/换源）。
 *
 * 依据：容器 + 编码（mediaInfo 里有就用）。**保守**为原则 —— 编码未知时不否决
 *（MP4/WebM + 未知编码 ⇒ 当可解），已知是 HEVC/其它时否决。
 * 为什么要它：帧率上限是"降低解码占用"的优化，代价却是**每次切换后台跑一次整片
 * 重编码**（实测 4K60 数秒、抢 CPU/磁盘 ⇒ 各壁纸之间等待几乎一样长）。原生可解的
 * 源不再因为上限触发它。
 *
 * ⚠️ 容器**必须**来自 `mediaExt`（宿主给的真实后缀）：媒体 URL 是 `/media/<base64url>`
 * token 形态，路径里没有扩展名 ⇒ 只用 URL 判会恒为假，这条治理等于不存在（实测回归：
 * 设了上限时每次切换都跑整片重编码）。URL 那条留着当兜底：夹具/旧宿主没有该字段时行为不变。
 */
const NATIVE_SRC_EXT = /\.(mp4|m4v|webm)([?#]|$)/i;
const NATIVE_EXT_SET = { mp4: 1, m4v: 1, webm: 1 };
const NATIVE_CODEC_RE = /^(avc1|avc3|h264|vp8|vp09|vp9|av01|av1|theora|opus|vorbis|mp4a)/i;
function isNativelyPlayableSource(mi, url, ext) {
  const e = String(ext || "").toLowerCase();
  const containerOk = e ? Boolean(NATIVE_EXT_SET[e]) : NATIVE_SRC_EXT.test(String(url || ""));
  if (!containerOk) return false;
  const codec = mi && (mi.codec || mi.videoCodec || mi.video_codec || "");
  if (!codec) return true;
  return NATIVE_CODEC_RE.test(String(codec));
}

/**
 * **上限是否真的能降帧** —— 抽帧转码的唯一判据。
 *
 * 设计口径：上限存在的目的是**压 GPU 解码占用**（Video Decode 随帧率上升）。所以只有
 * "源帧率**高于**上限"才值得整片重编码；源帧率已经 ≤ 上限时转码纯属白烧 CPU 还把画质
 * 再压一遍。容差 1 帧：源的 23.976/29.97 这类实际帧率对上整档上限时不该被当成"高于"。
 *
 * 返回三态：`true` = 该抽帧；`false` = 不必抽帧（源帧率已知且不高于上限）；
 * `null` = **源帧率未知**（探测失败 / 还没回来）—— 这时才轮到"原生可解就别盲转"那条成本护栏。
 *
 * ⚠️ **不许把"原生可解"当成"不抽帧"的充分条件**：容器原生可解不代表帧率不超上限
 * （4K120 的 H.264 既原生可解、又比上限高得多），照此判会让帧率上限在你实际在用的这些 mp4
 * 上一律失效、只剩一句面板文案 —— 而它的全部意义就是压解码占用。
 */
const FPS_CAP_TOLERANCE = 1;
function capNeedsTranscode(mi, cap) {
  const src = mi && Number(mi.fps) > 0 ? Number(mi.fps) : 0;
  if (!src || !(cap > 0)) return null;
  return src > cap + FPS_CAP_TOLERANCE;
}

/**
 * ⑤ 视频通道的"建层之后"入口：**转码触发归视频通道**（视频档在实时管线里唯一的类型专属
 * 逻辑）。只负责"要不要起一次抽帧升级"，不做别的。
 */
/**
 * ⑥ 视频档的"押住 → 放行"执行器：**视频通道自己的机器**（实时管线只留一次委托）。
 * 放行条件：海报图**加载出来** / 首帧（loadeddata·canplay）/ 出错放行 / 停滞到上限留旧壁纸。
 * 返回两个句柄供调用点随待放行状态一起收。
 */
function armVideoChannelReveal(video, recheck, giveUp) {
  let cancelPosterProbe = null;
  // 停滞自续期链的取消句柄必须**读得到最新的定时器 id**：返回首跳 id 快照的话，
  // forgetPendingReveal 清的是早已触发过的旧 id，链会在本层已放行/已被替换后继续走 —— 连切
  // 时遗留 tick 会把下一层的空层推上屏（纯色帧回归）。dead 标记让链条在任何收口路径上一次性终结。
  const stall = { id: 0, dead: false };
  const cancelStall = () => {
    stall.dead = true;
    if (stall.id) { clearTimeout(stall.id); stall.id = 0; }
  };
  if (video && typeof video.addEventListener === "function") {
    // Edge 那条路由镜像画布的第一笔补最后一步（layerContentReady 会一起看）。
    const frameReady = () => { try { video.__weReady = true; } catch { /* ignore */ } recheck(); };
    video.addEventListener("loadeddata", frameReady);
    video.addEventListener("canplay", frameReady);
    video.addEventListener("error", giveUp);
    // 海报这一级：**加载出来**才放行；加载失败不再放行（那只是"这一级不存在"，画面仍要看首帧）。
    cancelPosterProbe = probeVideoPoster(video, recheck, recheck);
    // 兜底预算 = **停滞判据**，不是"到期放行"：每 1200ms 复查一次，只有屏上真有东西
    //（首帧 / 海报图已加载）才放行；到 VIDEO_STALL_GIVE_UP_MS 仍未出画面就停止等待并留一条
    // warn —— 旧壁纸继续留着，绝不铺这一层的底色。放行走 **recheck**：video 有画面 ≠ 层有
    // 画面（Edge 的 canvas 路由还要等画布第一笔），layerContentReady 判上了才真放行；没判上
    // 就继续轮询，预算上限仍是停表的终点。
    const startedAt = Date.now();
    const stallGuard = () => {
      if (stall.dead) return;
      if (videoContentReady(video) || video.__weReady === true) {
        recheck();
        if (!stall.dead && Date.now() - startedAt < VIDEO_STALL_GIVE_UP_MS) {
          stall.id = setTimeout(stallGuard, VIDEO_POSTER_BUDGET_MS);
        }
        return;
      }
      const waited = Date.now() - startedAt;
      if (waited >= VIDEO_STALL_GIVE_UP_MS) {
        liveLog("video-stall", "wid=" + selection.id + " " + Math.round(waited / 1000)
          + "s 仍无画面 → 继续留旧壁纸（不放行空层）", "warn");
        return;
      }
      stall.id = setTimeout(stallGuard, VIDEO_POSTER_BUDGET_MS);
    };
    if (typeof setTimeout === "function") stall.id = setTimeout(stallGuard, VIDEO_POSTER_BUDGET_MS);
  }
  return { cancelProbe: cancelPosterProbe, cancelStall };
}

function videoChannelAfterLayerBuild(video, sel) {
  if (!video || !sel || sel.type !== "video" || !sel.url) return;
  maybeUpgradeToTranscoded(video, String(sel.url).split("/").pop());
}

function maybeUpgradeToTranscoded(video, token) {
  if (!video || !video.isConnected) return;
  const cap = selection.fpsCap;
  // Cap off / lowered to 0: revert any swapped video back to the original.
  if (!cap || cap <= 0) {
    abortTranscodeUpgrade();
    selection.transcodeReady = null;
    if (video.dataset.weTranscoded) {
      revertTranscodedVideo(video);
      selection.transcodeState = "idle";
    }
    return;
  }
  const mi = selection.mediaInfo;
  // mediaInfo 探测还在途（本 token）：等它回来再判 —— 它可能带回"源帧率 ≤ 上限"从而免掉
  // 整片转码。settle 时的 emit 会再跑一遍这条路（见 refreshMediaInfo 末尾）。
  if (!mi && mediaInfoInFlight === token) return;
  const need = capNeedsTranscode(mi, cap);
  // 源帧率已知且不高于上限 ⇒ 不抽帧（顺手退回可能存在的、来自更低上限的抽帧版）。
  if (need === false) {
    if (video.dataset.weTranscoded) revertTranscodedVideo(video);
    selection.transcodeReady = null;
    selection.transcodeState = "skipped";
    return;
  }
  // **源帧率读不到**时才用这条成本护栏：容器原生可解 ⇒ 不为一个未知的帧率整片重编码
  //（4K 重编码是数秒级的固定代价）。帧率已知的情况在上面已经按"能不能真降帧"判完了。
  if (need === null && isNativelyPlayableSource(mi, selection.url, selection.mediaExt)) {
    if (video.dataset.weTranscoded) revertTranscodedVideo(video);
    selection.transcodeReady = null;
    selection.transcodeState = "native";
    return;
  }
  if (video.dataset.weTranscoded === String(cap)) return; // already on this cap
  // Only an in-flight request for THIS cap counts as "working on it": a request
  // for a different cap would complete and swap in a stale-fps re-encode while
  // the picker advertises the current cap (24→48 direct switch bug). The guard
  // is deliberately NOT conditioned on weTranscoded: the progress poller emits
  // (→ syncLayers → this function), and with the video already on a transcode
  // that emit used to abort + re-start the request forever (page freeze).
  if (upgradeToken === token && upgradeAbort && upgradeFps === cap) return; // already working on this cap
  abortTranscodeUpgrade();
  upgradeToken = token;
  upgradeFps = cap;
  // 用户刚动过上限（5 秒内）⇒ 这一轮算主动升级，允许在在屏的层上换源（见 upgradeByUser）。
  upgradeByUser = Date.now() - capChangedAt < 5000;
  const ctrl = new AbortController();
  upgradeAbort = ctrl;
  selection.transcodeState = "working";
  selection.transcodeProgress = null;
  // Progress poller: 500ms interval reading /transcode-progress (download %,
  // then frame-based transcode % + ETA). Cleared on settle/abort. The timer is
  // ALSO kept in this closure so THIS request's completion only ever clears its
  // OWN timer — a stale request must not kill the newer request's poller.
  let pollPending = false; // 上一 tick 未返回 → 跳过本次 (宿主高负载时避免 fetch 堆积)
  const pollProgress = () => {
    if (ctrl.signal.aborted) return;
    if (pollPending) return;
    pollPending = true;
    apiJson("/transcode-progress/" + encodeURIComponent(token) + "?fps=" + cap)
      .then((res) => {
        const d = res.data || {};
        if (ctrl.signal.aborted) return;
        if (d && d.phase) {
          const changed = !selection.transcodeProgress
            || selection.transcodeProgress.phase !== d.phase
            || selection.transcodeProgress.percent !== d.percent
            || selection.transcodeProgress.eta !== d.eta;
          if (changed) {
            selection.transcodeProgress = {
              phase: d.phase, percent: d.percent || 0, source: d.source || "",
              finalizing: d.finalizing === true, eta: typeof d.eta === "number" ? d.eta : null,
            };
            emit();
          }
        }
      })
      .catch(() => { /* transient poll failure: ignore */ })
      .then(() => { pollPending = false; }); // 成功/失败都释放 in-flight 标记
  };
  clearUpgradePoll();
  const pollTimer = setInterval(pollProgress, 500);
  upgradePollTimer = pollTimer;
  pollProgress();
  const transcodedUrl = transcodedUrlFor(token, cap);
  // Trigger + completion probe: a tiny Range request that blocks until the host
  // has the transcode cached, then answers 206 with one byte (discarded). The
  // <video> then streams the SAME url via range requests — no full-file blob is
  // ever held in memory and playback starts as soon as the first bytes arrive.
  // 探测响应是 1 字节二进制体 ⇒ `parse: false`（默认路径会先 json() 吃掉 body，
  // 显式的 arrayBuffer() 只能靠 catch 兜住；这里直接不走解析）。
  apiFetch(transcodedUrl, { signal: ctrl.signal, headers: { Range: "bytes=0-0" }, parse: false })
    .then(async (res) => {
      if (ctrl.signal.aborted) return; // superseded by a newer request
      if (pollTimer) clearInterval(pollTimer); // only ever this request's own timer
      if (!res.ok) { transcodeUpgradeFailed(video, token); return; }
      try { await res.response.arrayBuffer(); } catch { /* 1-byte body; discard */ }
      if (ctrl.signal.aborted) return;
      if (selection.fpsCap !== cap || !video.isConnected) {
        // The user changed the cap (or the wallpaper) while this request was in
        // flight: its output is stale. NEVER swap a stale-fps re-encode in —
        // drop the request state and re-decide for the CURRENT cap instead.
        abortTranscodeUpgrade();
        if (video.isConnected && selection.url && token === selection.url.split("/").pop()) {
          const cur = selection.fpsCap;
          if (cur > 0 && video.dataset.weTranscoded === String(cur)) {
            // Already playing exactly the requested cap (the user switched back
            // while this request was in flight): just settle as ready.
            selection.transcodeState = "ready";
            selection.transcodeProgress = null;
            emit();
          } else {
            maybeUpgradeToTranscoded(video, token);
          }
        } else {
          // The layer/video was rebuilt while this request was in flight (e.g.
          // Edge 兼容 render-mode toggle, or a wallpaper switch that raced the
          // abort): re-run syncLayers so the CURRENT video gets its own fresh
          // upgrade decision — otherwise it would sit on the original (full
          // decode) until some unrelated emit happened to re-trigger it.
          emit();
        }
        return;
      }
      if (selection.url && token === selection.url.split("/").pop()) {
        // ⚠️ 只允许在"层还被闸门押着"（旧壁纸在屏上）或"用户刚主动改过上限"时落地：
        // 换源会清掉当前帧 ⇒ 屏上只剩这一层的底色（纯色帧）。切换壁纸时自动触发的升级
        // 一律推到下一次建层（buildVideoMedia 读 selection.transcodeReady）。
        if (!layerStillPending() && !upgradeByUser) {
          selection.transcodeReady = { token, fps: cap, url: transcodedUrl };
          selection.transcodeState = "cached";
          selection.transcodeProgress = null;
          liveLog("transcode-cached", "wid=" + selection.id + " " + cap + "fps 版已就绪 → 留到下次建层换（不在屏上换源）");
          emit();
          return;
        }
        video.dataset.weTranscoded = String(cap);
        const t = video.currentTime;
        const wasPlaying = isEffectivelyPlaying();
        // 兜底超时：转码文件损坏 / 元数据异常时 loadedmetadata 可能永远不来，
        // UI 会永停「转码中」——15s 未就绪按失败回退原片。定时器走 window.*
        //（headless 验证环境无计时器设施时直接跳过超时兜底）。
        let metaTimer = null;
        const clearMetaTimer = () => {
          if (metaTimer && typeof window !== "undefined" && typeof window.clearTimeout === "function") {
            window.clearTimeout(metaTimer);
          }
          // 同步清掉升级状态上的引用 (只清自己的, 否则会抹掉更新请求的 timer)
          if (upgradeMetaTimer === metaTimer) upgradeMetaTimer = null;
          metaTimer = null;
        };
        const onErr = () => {
          clearMetaTimer();
          if (video.dataset.weTranscoded) {
            delete video.dataset.weTranscoded;
            try { video.src = selection.url; video.load(); } catch { /* ignore */ }
            selection.transcodeState = "fallback";
            emit();
          }
        };
        video.addEventListener("error", onErr, { once: true });
        video.src = transcodedUrl;
        video.load();
        const onMeta = () => {
          clearMetaTimer();
          try { if (t > 0 && t < video.duration) video.currentTime = t; } catch { /* ignore */ }
          if (wasPlaying) { try { video.play().catch(() => {}); } catch { /* ignore */ } }
          // Edge canvas：转码 swap 复用同一 <video>，weLoadedOnce 已置位，
          // 暂停态下补一帧避免画布停在旧画面。
          weDrawFrame();
          selection.transcodeState = "ready";
          selection.transcodeProgress = null;
          emit(); // syncLayers re-arms the Edge canvas + re-applies rate/play
        };
        video.addEventListener("loadedmetadata", onMeta, { once: true });
        if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
          metaTimer = window.setTimeout(() => {
            video.removeEventListener("loadedmetadata", onMeta);
            onErr();
          }, 15000);
          upgradeMetaTimer = metaTimer; // 挂到升级状态: abortTranscodeUpgrade 也要能清
        }
      }
    })
    .catch(() => {
      if (ctrl.signal.aborted) return;
      if (pollTimer) clearInterval(pollTimer); // only ever this request's own timer
      transcodeUpgradeFailed(video, token);
    });
}

// A transcode request for the CURRENT cap failed (502 / network / encode
// error): the documented fallback is to play the ORIGINAL, so revert any
// swapped transcode (a request only ever runs when the video is on a DIFFERENT
// cap's transcode or the original, so this restores the honest "原片" state).
// The in-flight latch (upgradeToken/upgradeAbort/upgradeFps) is deliberately
// LEFT set: it is what stops the emit-driven syncLayers re-entry from
// auto-restarting a request that just failed, while a cap change / 无限制
// switch still clears it and allows a retry.
function transcodeUpgradeFailed(video, token) {
  if (video && video.isConnected && video.dataset.weTranscoded) {
    revertTranscodedVideo(video);
  }
  selection.transcodeState = "fallback";
  selection.transcodeProgress = null;
  emit();
}


/**
 * 作废"进行中"的 media-info 探测：把 latch 置空 ⇒ 迟到的响应不再写 selection.mediaInfo，
 * 且同一壁纸下次 refreshMediaInfo 会重新探测。
 * 换壁纸/切走时调用（调用点同时会把 selection.mediaInfo 自己置 null —— 那是**显示状态**，
 * 与本文件的 latch 是两件事）。
 */
function invalidateMediaInfoProbe() {
  mediaInfoToken = "";
}

/**
 * 断开 media-info 探测的 AbortController（卸载时调用：token 可能永远不再变化，
 * 不主动断开会把这次求值的闭包一直钉住）。
 */
function abortMediaInfoProbe() {
  if (mediaInfoAbort) { try { mediaInfoAbort.abort(); } catch { /* ignore */ } mediaInfoAbort = null; }
}
export {
  refreshMediaInfo, abortTranscodeUpgrade,
  invalidateMediaInfoProbe, abortMediaInfoProbe,
};
