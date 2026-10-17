/**
 * live-layer.js — **实时渲染管线**：live 渲染与控制、看护心跳、判失败、抓帧回填、指针转发、
 * poster/挂载/抓首帧，以及壁纸层的构建（syncLayers）与过场过渡。
 *
 * 为什么单独一个文件：这是"壁纸层从建到退"的整条链路。留在 client.js 里会被**别的域**
 * （媒体集成、GPU 帧槽助手、用户属性、diag 上报）切开成若干不相邻区段 ⇒ "画面为什么没出来"
 * 要跨几段读完；放在这里只需读一个文件。
 *
 * 契约（本文件是客户端程序的一部分，构建期由 scripts/build-client.mjs 内联进 bundle 的
 * 工厂作用域，"外部作用域"= 同一 prelude / src/client.js 的顶层。依赖见下表分组
 * （清单只在这里维护，不在此处写死数量）：
 *   状态 store        selection · gpuFrameUi · liveWatch · livePointerFrame · liveApplied ·
 *                     bootRestore · liveDiagOn · LIVE_FIRST_FRAME_MS（后五个由本文件声明，
 *                     因被外部读取而导出）
 *   DOM 常量/标记      LAYER_ID · SCRIM_ID · ACTIVE_ATTR · IS_EDGE · CSS（prelude）
 *   层与轮换          syncSceneAudio · releaseLayerMedia · fadingLayerNode · pendingRotationFade ·
 *                     ROTATION_FADE_MS · commitRotationSwitch · switchTransitionOf · layerKeyDiff ·
 *                     switchFrames · openRotationAudioGate · releaseRotationAudioGateFor ·
 *                     rotationAudioHoldActive · scheduleSceneVideoResync
 *   live 与帧          livePauseReason · GPU_FRAME_AREA_TOL · probeGpuFrameState ·
 *                     markGpuFramePin · markGpuFrameProbed ·
 *                     refreshStaticFrameNodes · prepareSceneLiveStage ·
 *                     prepareSceneStaticStage · prepareLiveTimeouts · clearPrepareLiveTimeout ·
 *                     disposePreparedMedia · disposeMediaEl · buildMedia
 *   主题随壁纸        themeFollowOnFrameCanvas · themeFollowOnFrameImage（src/theme-follow.js）：抓到的
 *                     真实画面比作者预览图更能代表这张壁纸，用它重判一次全局深/浅（排名更高）
 *   播放与音频        applyVideoPlayback · isEffectivelyPlaying · weAudioVolume · startMediaSync ·
 *                     stopMediaSync · mediaTimer · weStartDraw · weStopDraw · weDrawCtx ·
 *                     applyEffects/clearEffects（prelude）· reportClientDiag · emit ·
 *                     persistSelection · applySelection · applyStoredUserProps ·
 *                     loadInventory（传输类软失败重试前刷库存）·
 *                     apiFetch/apiHead/apiJson（prelude）
 * 提供的入口（被 client.js 或守卫引用，其余是同族助手）：
 *   syncLayers · startLiveWatch · stopLiveWatch · liveFail · liveRenderEnabled · liveRenderUrl ·
 *   liveFailReasonOf · liveLog · liveStateBrief · liveDiagVerbose · liveStats · applyLiveControls ·
 *   scheduleLiveFrameBackfill · cancelLiveFrameBackfill · liveFrameEl · buildLivePoster ·
 *   scheduleLiveMount · createLiveFrame · retireFadingLayer · toggleLiveDiag ·
 *   clearLiveSessionFailures（显式重试入口：清会话内软失败，见那里）·
 *   refreshUnderlayColor / clearUnderlayColor（画布兜底色：壁纸的代表色 → 根元素背景）·
 *   nudgeWallpaperRepaint / probeWallpaperOnScreen（可见性恢复：一次性复合成微推 + 在屏留痕）
 *   ＋ 供外部**读**的状态：liveWatch · livePointerFrame · liveApplied · liveDiagOn ·
 *     LIVE_FIRST_FRAME_MS · bootRestore
 *
 * 不变量：
 *   · `liveLog(tag, detail?, level?, verboseOnly?)` 是**客户端上报的唯一出口**：三档
 *     `error` / `warn` / `info`（与宿主 `lib/log.js` 同集合，见 `LIVE_LEVELS`），缺省与未知
 *     一律 `info`；`verboseOnly` 的调用点在 `weLiveDebug` 关闭时**连字符串都不构造**。
 *   · 档位随同源像素请求以 `&lvl=` 上行（宿主对未知 / 缺失落 `info`）；**判据**：影响显示
 *     效果的非正常表现才是 `warn`（判失败、stall 自救、准备期超时降级），其余全 `info`。
 *   · **live 看护只有一条时间线**：`liveWatch` 是唯一的活动看护记录，start/stop 必须成对
 *     （startLiveWatch 自己会停掉上一个；stopLiveWatch 清 timer）。判失败与首帧确认都写它。
 *   · **抓帧回填不得覆盖新壁纸**：scheduleLiveFrameBackfill 的落地回调必须重校验 token/wid
 *     （换壁纸期间挂起的回填是最容易写错的一处）。
 *   · `syncLayers` 是**幂等的**：它可被 emit / 轮换 / 面板反复调用，只按 key 差量改 DOM，
 *     并且在 emit 周期内运行时**不得**再同步 emit（会重入 listener 链直到爆栈）。
 *   · 定时器与 rAF 全部登记在可取消的句柄上（watch.timer / liveMountTimer / livePointerRaf /
 *     backfill.timer）—— 卸载路径逐个取消，漏一个就是"卸载后仍在跑"。
 *   · **首帧预算不是固定墙钟**：基准 + 按 `scenePkgBytes` 放大（封顶 `LIVE_FIRST_FRAME_MAX_MS`），
 *     且"宿主载荷账本说字节还在涨"时每拍重置计时 —— 首帧必须等整包到齐，把传输算成
 *     "渲染不出来"是本文件最贵的一个误判（会写进**全局**失败记忆）。
 *   · **隐藏 / 不播的实例不拉载荷**：`createLiveFrame` 延迟赋 src、`suspendLivePayload`
 *     中途摘 src（about:blank 会中止在飞请求），都由 `armDeferredLiveFrame` 在
 *     "可见且应播"时补回；层键不含这个状态 ⇒ 不触发重建、垫底图全程在位。
 *   · **失败记忆带管线身份**：`sceneLiveFailures` 只在**同一条管线**内有效 —— bundle 变了、
 *     或媒体源从无到有，`migrateStaleLiveFailures` 就作废它一次（面板那行失败文案的唯一
 *     来源就是它；旧断言会让修好的版本看起来"完全没作用"）。反向不清（见那里）。
 *   · 本文件必须保持浏览器安全（无 import / require / Node API），且**不得有顶层可执行语句**
 *     读 client.js 的 const（会被内联到 bundle 顶部，撞 TDZ）。
 */

function liveRenderEnabled(selLike) {
  return Boolean(selLike && selLike.sceneLive !== false
    // 失败记忆的值是失败原因（'timeout' / 'stall'）；兼容旧的 true。
    && !(selLike.sceneLiveFailures && selLike.sceneLiveFailures[String(selLike.id)])
    // 会话内的软失败（传输未完成）同样让位给回退链，但它**不落盘**、且在
    // 冷却后被自动重试清掉（见 scheduleLiveTransferRetry）。
    && !liveSessionFailures.has(String(selLike.id))
    && ((selLike.type === "scene" && selLike.sceneLiveSrc)
      || (selLike.type === "web" && selLike.webLiveSrc)));
}
// 失败原因 → 可读文案（设置面板展示，便于用户反馈「为什么黑」）。
//
// ⚠️ 文案里的时长**从常量插值**，不写死数字：这几个阈值一旦调参，写死的文案就会对用户撒谎。
// 为此这两个阈值常量的声明被**提到本常量之前** —— 顶层模板字符串引用后面声明的 `const` 会撞 TDZ。
const LIVE_FIRST_FRAME_MS = 15000;
const LIVE_STALL_TICKS = 20;
// 取值用 getter 现取（不在模块级冻结）：语言由 locale 服务在 bundle 求值之后确定，
// 冻结的值会让 en 界面的失败行永远停在中文（见 src/i18n.js 的"模块级冻结"纪律）。
const LIVE_FAIL_LABELS = {
  get timeout() { return weT("首帧超时（{secs} 秒内无画面）", { secs: Math.round(LIVE_FIRST_FRAME_MS / 1000) }); },
  get stall() { return weT("运行中断（{secs} 秒无帧）", { secs: LIVE_STALL_TICKS }); },
  get load() { return weT("壁纸加载失败"); },
  // 软失败（**不落盘**）：载荷传输没走完 —— 证据是"这张壁纸渲染不出来"以外的另一种事实
  //（同一份包在别的实例/别的源上 0.6s 就到了），所以它只进会话内记忆 + 自动重试。
  get transfer() { return weT("载荷传输未完成（下载停滞）"); },
};
// 会话内的**软失败**记忆（wid → 原因）：传输类失败不写共享设置。
// 为什么必须与 sceneLiveFailures 分开：那份是宿主持久化设置（所有窗口共用），
// 一次被饿死的传输写进去 = 把"网络/磁盘一时没供上"变成**每个窗口**的永久降级，
// 而证据并不支持这个结论（实测：同一张壁纸在另一个实例里 1–2s 就出帧了）。
const liveSessionFailures = new Map();
function liveFailReasonOf(selLike) {
  const m = selLike && selLike.sceneLiveFailures;
  const v = m ? m[String(selLike && selLike.id)] : null;
  if (v) return LIVE_FAIL_LABELS[v] || weT("渲染失败");
  const soft = liveSessionFailures.get(String(selLike && selLike.id));
  return soft ? (LIVE_FAIL_LABELS[soft] || weT("渲染失败")) : "";
}
// objectFit（object-fit 语义）→ WebWallGL fit 值。center 无精确对应
//（渲染器的 contain 即完整显示居中，视觉最近似）；fill（拉伸变形）→ stretch。
const SCENE_LIVE_FIT = { cover: "cover", contain: "contain", center: "contain", fill: "stretch" };
// 载荷路径的尾巴。宿主给的是**源**（origin），路径在这里拼 —— 换源不用改路径，
// 也避免宿主与客户端各写一份可能漂移的前缀。
const SCENE_FILES_PATH = "/wallpaper-engine/scene-files";
// 宿主载荷账本（首帧看护判"传输还在动吗"的唯一真源，见 livePayloadFlowing）。
const SCENE_PAYLOAD_PROGRESS_PATH = "/scene-payload-progress";
/**
 * 页面是不是跑在**非本机**的 http(s) 源上（远程桌面 / 代理进来的客户端）。
 * 只有 http(s) 才谈得上"远程"：dsh-app:// 这类壳内自定义 scheme 的页面必然在本机；
 * 判不出（URL 解析失败）也按本机算 —— 误判成远程的代价是大包挤应用源那条慢路，
 * 误判成本机的代价是整条 live 链路在远程端全灭（issue #129），后者贵得多。
 */
function originIsRemoteHttp(origin) {
  try {
    const u = new URL(String(origin || ""));
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const h = u.hostname;
    return !(h === "127.0.0.1" || h === "localhost" || h === "[::1]" || h === "::1" || h === "0.0.0.0");
  } catch { return false; }
}
/**
 * 场景载荷该从哪个 origin 取（不含路径；网页壁纸不问这个，见 liveRenderUrl）。
 * 宿主媒体源只有本机可达 ⇒ 页面自己就是远程的（location.origin 是代理 origin）时
 * 必须回落页面自身 origin —— 载荷与渲染页诊断信标（{mediaBase origin}/diag）都经
 * 代理转发才能活。本机页面维持宿主媒体源（带宽主路径，见 ensureSceneMediaOrigin）。
 */
function resolveSceneMediaBase() {
  const hostSceneBase = selection.inventory && selection.inventory.sceneMediaBase;
  if (typeof hostSceneBase === "string" && hostSceneBase && !originIsRemoteHttp(typeof location !== "undefined" ? location.origin : "")) {
    return hostSceneBase;
  }
  return typeof location !== "undefined" && location.origin ? location.origin : "";
}
function liveRenderUrl(selLike) {
  const isWeb = selLike.type === "web";
  // scene：src 是 mediaBase 下的 token（渲染页用它拼 httpSource）。
  // web：src 必须是**完整入口 URL**（渲染页的 web 形态直接 iframe 加载它，
  // 并从同目录取 project.json）—— 传 token 会被当成相对 URL 而 404。
  //
  // host 给的 webLiveSrc 正常情况下已是**绝对 URL**：网页壁纸的整个载荷
  //（入口 HTML + 全部子资源）由 host 自己的壁纸媒体源（独立 loopback 端口）
  // 提供。原因见 host 的 ensureMediaOrigin：DSH Desktop 给每个插件路由套了
  // 能力头（x-dsh-desktop-renderer）栅栏，而该头只注入给同源 frame 的请求；
  // 严格沙箱 iframe 是不透明源，永远拿不到 —— 于是入口 HTML 一律 403，表现
  // 就是「预览图正常、随后整块黑」。只有旧 host / 媒体源启动失败时才回落成
  // 应用源相对路径（浏览器形态照常可用）。
  const webEntry = String(selLike.webLiveSrc || "");
  const src = isWeb
    ? (/^https?:\/\//i.test(webEntry) ? webEntry : location.origin + webEntry)
    : selLike.sceneLiveSrc;
  const fit = SCENE_LIVE_FIT[selLike.objectFit] || "cover";
  const fps = SCENE_LIVE_FPS_VALUES.includes(selLike.sceneLiveFps) ? selLike.sceneLiveFps : 30;
  const muted = weAudioVolume() > 0 ? "false" : "true";
  // 场景载荷的源：默认**宿主说了算**（inventory.sceneMediaBase = 独立壁纸媒体源的 origin，
  // 见 resolveSceneMediaBase —— 那里同时决定远程页面回落自身 origin 的口径）。
  // 宿主给空串（原生浏览器 / 媒体源不可用 / 库里没有可实时渲染的场景）⇒ 回落应用源，
  // 即改动前的行为。**客户端不再自己拼 location.origin**：70–90MB 的 scene.pkg 走应用源
  // 那条路挤不过首帧 LIVE_FIRST_FRAME_MS 预算（那里还要买纹理解码与 shader 编译）。
  // 网页壁纸**不走**这个源：它的入口是绝对 URL（webLiveSrc），mediaBase 对它只剩
  //「诊断信标打哪个 origin」一个用途，保持原样以免多动一条已经通的链。
  const mediaBase = (isWeb ? (typeof location !== "undefined" && location.origin ? location.origin : "") : resolveSceneMediaBase())
    + SCENE_FILES_PATH;
  return "/wallpaper-engine/scene-live/index.html?type=" + (isWeb ? "web" : "scene")
    // 网页壁纸必须严格沙箱：第三方 workshop HTML 不得继承 DSH 的 origin
    //（否则可冒用宿主身份调宿主 API / 读宿主存储）——只给 allow-scripts，
    // 控制经渲染页的 postMessage 通道下发，shim 由宿主注入 HTML 响应。
    + (isWeb ? "&webSandbox=strict" : "")
    + "&fit=" + fit + "&sceneFps=" + fps + "&muted=" + muted
    // WE 官方素材（local-assets）：host 报告素材目录可用时才打开渲染页的
    // 本地素材通路（探测 /api/local-assets，按名取官方像素）；否则渲染页
    // 静默走程序化复刻，连探测请求都不发。
    + (selection.inventory && selection.inventory.weAssetsAvailable ? "&localAssets=1" : "")
    + "&src=" + encodeURIComponent(src)
    + "&mediaBase=" + encodeURIComponent(mediaBase);
}
// 向 live iframe 的 __wp 控制面收敛播放态/音量/fit。每次 emit 驱动的
// syncLayers 与每秒心跳 tick 都会调用，但**只在目标值变化时真正下发**：
// 渲染页的 resume() 会重置帧计量器（resetFrameMeter），若每秒无条件 resume，
// 紧随其后的心跳读数永远是 fps=0 → 首帧判定永不通过 → 15s 误降级（实测：首帧就绪前那次 in-flight 探针会打断心跳，读数恒为 0）。setVolume/setFit 同理省掉每秒无谓的跨文档调用。
const liveApplied = { frame: null, playing: null, volume: null, fit: null };
function applyLiveControls(frame) {
  if (!frame) return;
  let wp;
  try { wp = frame.contentWindow && frame.contentWindow.__wp; } catch { return; }
  if (!wp) return; // 渲染页未就绪：心跳 tick 每秒重试
  // 新 iframe（或渲染页刚就绪）→ 强制全量同步一次。
  if (liveApplied.frame !== frame) {
    liveApplied.frame = frame;
    liveApplied.playing = null;
    liveApplied.volume = null;
    liveApplied.fit = null;
  }
  try {
    const playing = isEffectivelyPlaying();
    if (liveApplied.playing !== playing) {
      if (playing) wp.resume(); else wp.pause();
      liveApplied.playing = playing;
    }
    // 闸内（正在淡入的新层）目标音量为 0：等旧层退场后再由
    // releaseRotationAudioGateFor 恢复。
    const volume = rotationAudioHoldActive() ? 0 : weAudioVolume();
    if (liveApplied.volume !== volume && typeof wp.setVolume === "function") {
      wp.setVolume(volume);
      liveApplied.volume = volume;
    }
    const fit = SCENE_LIVE_FIT[selection.objectFit] || "cover";
    if (liveApplied.fit !== fit && typeof wp.setFit === "function") {
      wp.setFit(fit);
      liveApplied.fit = fit;
    }
  } catch { /* 渲染页内部异常：下一 tick 重试 */ }
}

// 本文件是组装点：诊断 / 心跳 / 指针 / 内容闸门 / 兜底色五个域由构建期按 INLINE_MODULES
// 顺序内联在本文件之前（见 scripts/build-client.mjs）。下面保留 syncLayers 与层轮换收尾、
// toggleLiveDiag 与导出块。导出块只列本文件真声明过的名字；搬出去的名字由各自模块导出。
// ── syncLayers 的分段助手：抽出的每一段都只读模块级单例 `selection` / 只调模块级函数
//（`selection` 与 `IS_EDGE` 在本模块内是自由变量 —— 构建期与 client.js 同一作用域）
// ⇒ syncLayers 只留编排。

function layerWantKey(layerLive) {
  return selection.type + "\u0000" + selection.url + "\u0000"
    + (IS_EDGE && selection.edgeCompat !== false ? "canvas" : "video")
    // Scene wallpapers: the media kind depends on sceneVideo (MP4 <video> vs
    // static-frame <img>), and the 404 fallback nulls sceneVideo — the key
    // must reflect it so the fallback rebuilds the layer.
    // ⚠️ live 生效期间不算它：buildMedia 的 isSceneVideo 已被 isLive 短路，此时
    // sceneVideo 只影响「live 失败后的回退」，进 key 只会白白冷启动渲染页 ——
    // 「sceneVideo 诚实化」的时序补拉（scheduleSceneVideoResync）落地时正好会
    // 触发这种无意义重建。live 一失效，下面的 live 段就变化 → 仍会重建，且那一次
    // 会用上当时的 sceneVideo 值（回退路径因此照旧正确）。
    + "\u0000" + (layerLive ? "" : (selection.sceneVideo || ""))
    + "\u0000" + (selection.sceneAudioUrl || "")
    // Scene live render: entering/leaving live（开关切换、按壁纸失败记忆、
    // 帧率档变更 → iframe query 变化）都必须重建层；fit/音量不进 key ——
    // 它们经 __wp.setFit/setVolume 热切，无需重载渲染页。
    + "\u0000" + ((selection.type === "scene" || selection.type === "web")
      ? (layerLive
        // weAssetsAvailable 进 key：素材目录开关切换时 live iframe URL 的
        // localAssets 参数变化，必须重建渲染页才生效。
        // **sceneMediaBase 也进 key**：它决定渲染页从哪个源拉 `scene.pkg`
        //（空串 = 回落应用源，那条路在大包上会饿死）。宿主把媒体源端出来之后
        //（可能晚于本实例启动，见 client 的 loadInventory），这一格变化即触发
        // 一次重建 —— 否则旧渲染页会一直用着 URL 里那份陈旧的 mediaBase。
        ? "live\u0000" + (selection.sceneLiveSrc || selection.webLiveSrc) + "\u0000" + selection.sceneLiveFps
          + "\u0000" + (selection.inventory && selection.inventory.weAssetsAvailable ? "la1" : "")
          + "\u0000" + ((selection.inventory && selection.inventory.sceneMediaBase) || "")
        : "nolive")
      : "");
}

function obtainLayerNode(wantKey) {
  let node = document.getElementById(LAYER_ID);
  // 渐变路径旧层已让出 LAYER_ID；mock 环境的 stale byId 命中按 weFading 排除。
  if (node && node.dataset && node.dataset.weFading === "1") node = null;
  if (!node && pendingStagedLayerNode) {
    // live/web 轮换的节点级领养：staging 容器整体转为新层 —— iframe 全程不
    // 移动（同文档 reparent 会重载文档），渲染/加载状态零扰动。
    node = pendingStagedLayerNode;
    pendingStagedLayerNode = null;
    node.id = LAYER_ID;
    node.dataset.weKey = wantKey;
    node.dataset.weWid = String(selection.id || "");
    node.className = "we-layer";
    const adoptedLive = node.querySelector && node.querySelector("iframe.we-live-iframe");
    if (adoptedLive) {
      // 首帧已在准备期确认：立即点亮 + 心跳续跑运行期看护。
      try { adoptedLive.classList.add("we-live-on"); } catch { /* ignore */ }
      // 领养路径的渲染页是**已经在出帧**的热页：紧接着的 applyLiveControls
      // （syncLayers 后段）若判定「非有效播放」会把它 pause 掉，而暂停中的渲染页
      // __wpStats.frame() 恒为 {fps:0,running:false} —— 首帧看护必须据此暂停
      // 计时（见 startLiveWatch），否则 15s 后误判首帧超时并永久降级。
      liveLog("adopt-live", "wid=" + selection.id + " 节点级领养（渲染页不重载）");
      if (!liveFrameDeferred(adoptedLive)) { try { startLiveWatch(adoptedLive, selection.id); } catch { /* ignore */ } }
    }
  }
  if (!node) {
    node = document.createElement("div");
    node.id = LAYER_ID;
    node.className = "we-layer";
    node.dataset.weKey = wantKey;
    node.dataset.weWid = String(selection.id || "");
    const built = buildMedia(selection);
    if (Array.isArray(built)) for (const el of built) node.appendChild(el);
    else node.appendChild(built);
    document.body.appendChild(node);
  }
  return node;
}

function disposeOutgoingLayer(node, outgoing, switchTr, startFade) {
  if (outgoing) {
    if (layerContentReady(node)) {
      if (startFade) startLayerTransition(node, outgoing, switchTr);
      else {
        // 硬切：旧层一次性退场（释放媒体 + 放行新层音频），再停掉旧的镜像绘制循环。
        // Release the previous draw loop: without this, switching from an Edge
        // canvas video to a non-canvas wallpaper (image/web/scene, or Edge 兼容
        // turned off) would keep the old hidden <video> referenced and playing
        // forever — CPU/GPU/battery + memory leak per switch (rotation mixes
        // types). weStartDraw() re-initialises when a canvas exists again.
        retireFadingLayer();
        weStopDraw();
      }
    } else {
      armLayerContentReveal(node, outgoing, switchTr, startFade);
    }
  }
}

function syncScrimElement() {
  // 2. Scrim element (always present while a wallpaper is active).
  const scrim = document.getElementById(SCRIM_ID);
  if (selection.url) {
    if (!scrim) {
      const s = document.createElement("div");
      s.id = SCRIM_ID;
      s.className = "we-scrim";
      document.body.appendChild(s);
    }
    setWallpaperActive(true);
  } else {
    if (scrim) scrim.remove();
    setWallpaperActive(false);
  }
}

function syncSceneFrameProbe() {
  // 3. GPU 抓帧缓存状态（面板提示 + 清除入口）：场景壁纸才可能被抓帧。
  // 带 TTL 去重，syncLayers 调用频繁也不会打爆 HEAD。
  if (selection.type === "scene" && selection.sceneFrameUrl) {
    try { probeGpuFrameState(selection.sceneFrameUrl, false); } catch { /* ignore */ }
  }
}

function reclaimLayerAdoptionSlot() {
  // 4. 元素级领养槽位收尾不变量：槽位寿命 = 一次建层。
  // buildMedia 只在 video / sceneVideo / 静态帧 img 三条分支里收编它，而：
  // ① live 分支自建 iframe（`return frame` / `return [poster, frame]`）——
  //    准备期 live 首帧探测超时会回退出视频/静态帧探针并写进槽位（见
  //    prepareSceneLiveStage 注释：探测放弃刻意不簿记 sceneLiveFailures，因此
  //    随后 buildMedia 的 isLive 仍为 true），两者不一致时槽里那个元素既不上
  //    屏、也没有任何路径能释放它：detached 的 <video> 是解码器根，失去句柄后
  //    仍满速解码到页面关闭（实测 4K ≈35% 单核/个，gc() 收不走），且它属于
  //    **上一张壁纸** —— 之后的非提交重建（liveFail / fps 档位切换等）会按 tag
  //    命中并把它领养进当前层 → 画面串味；
  // ② 节点级领养（pendingStagedLayerNode）整条绕过 buildMedia，同样不收编。
  // 放在 syncLayers 收尾（该函数无提前 return，故本助手只做释放）：无论走哪条
  // 建层/领养路径、无论 buildMedia 是否被调用，退出时槽位必空。空槽位调用是 no-op。
  disposePreparedMedia();
}

function syncLayers() {
  // 失败记忆的管线核对放在最前：它可能把 `sceneLiveFailures` 清掉，而本函数下面就要用它
  // 算层键（清掉 ⇒ 这一跳直接重建回 live，用户不必手动重开开关）。
  migrateStaleLiveFailures();

  // 轮换渐变标记在入口消费：commitRotationSwitch 置位后首个 syncLayers 即
  // applySelection 的 emit；无旧层可淡（首壁纸/已清除）时自然作废，绝不
  // 滞留到下一次无关重建。
  const rotationFade = pendingRotationFade;
  pendingRotationFade = false;
  // 1. Wallpaper element.
  let existing = document.getElementById(LAYER_ID);
  if (selection.url) {
    // live 是否生效只需算一次：它同时决定「media 种类看不看 sceneVideo」与 live 段本身。
    const layerLive = (selection.type === "scene" || selection.type === "web") && liveRenderEnabled(selection);
    // 本次切换用的过场（类型 + 方向 + 毫秒）也只算一次：startFade 判定与两处调用点共用。
    const switchTr = switchTransitionOf(selection);
    const wantKey = layerWantKey(layerLive);
    let gotKey = existing && existing.dataset.weKey;
    // 上一跳停在"等新层画面"上、而这一跳要换层：LAYER_ID 在**还没有画面**的那个层手里，
    // 屏上其实是它守着的旧层。那个空层从未上屏，就地拆掉；这一跳的旧层取守着的那个 ——
    // 否则连切两下会各露一次底色。（键相同则不动：那只是同一次切换的又一次 emit。）
    if (pendingReveal && pendingReveal.node === existing && gotKey !== wantKey) {
      const blank = existing;
      existing = pendingReveal.outgoing || null;
      forgetPendingReveal();
      stopLiveWatch();                 // 空层的心跳随它一起停
      releaseLayerMedia(blank);
      try { blank.remove(); } catch { /* ignore */ }
      gotKey = existing && existing.dataset.weKey;
      if (existing) {
        // 守着的那个层全程没有离开过屏，它就是**当前壁纸那一层**：把 LAYER_ID 还给它、
        // 清掉待退役标记（否则下面会当它是废层，再建一个重复的层出来）。它的心跳在
        // 上一跳里停了，按领养路径同一套规则补回。
        try { existing.dataset.weFading = ""; } catch { /* ignore */ }
        fadingLayerNode = null;
        try { existing.id = LAYER_ID; } catch { /* ignore */ }
        const heldLive = existing.querySelector("iframe.we-live-iframe");
        // 延迟载荷的帧不武装（还没 src）：它自己的 load 回调会补上（见 createLiveFrame）。
        if (heldLive && !liveFrameDeferred(heldLive)) { try { startLiveWatch(heldLive, selection.id); } catch { /* ignore */ } }
      }
    }
    let startFade = false;
    let outgoing = null;               // 这一跳的旧层（让出 LAYER_ID，留到新层有画面为止）
    if (existing && gotKey !== wantKey) {
      liveLog("layer-rebuild", layerKeyDiff(gotKey, wantKey) + " " + liveStateBrief());
      // 交叉淡化判定：**换壁纸**（手动点选/轮换提交，层上 weWid ≠ 当前选择 id）
      // 一律淡出 —— 旧层保留被新层盖过去（真交叉淡化）；**同一张壁纸的内部重建**
      // （live 降级/fps 档/切换出图来源/live 开关，weWid 相同）保持硬切：重建前后是
      // 同一条 BGM，淡出 + 音频闸会让它断 ~2s，反而更糟。rotationFade（轮换
      // commit 的显式标记）作为兜底保留 —— 覆盖 weWid 缺失或轮换同 wid 极端角落。
      const widChanged = String(existing.dataset.weWid || "") !== String(selection.id || "");
      // 过场类型为「硬切」时根本不进过渡路径 —— 但"不搞过场"不等于"现在就拆"：
      // 旧层的处置统一放在新层建好之后（见下面的切层内容闸门）。
      startFade = (rotationFade || widChanged) && switchTr.id !== "cut";
      outgoing = existing;
      // 旧层让出 LAYER_ID（新层要用它）并标记为待退役；拆/淡都推迟到新层建好之后。
      outgoing.dataset.weFading = "1";
      try { outgoing.id = ""; } catch { /* ignore */ }
      // 任何时刻最多 2 层：更早那一份"守层 / 淡出层"先退役（这一跳接着守的那个不算）。
      if (fadingLayerNode && fadingLayerNode !== outgoing) retireFadingLayer();
      fadingLayerNode = outgoing;
      // 旧 live 心跳退役（iframe 本身保活续播）；新层的 watch 由 buildMedia
      // （fresh load 或领养路径）重启。
      stopLiveWatch();
    }
    const node = obtainLayerNode(wantKey);
    // ── 旧层处置：新层有画面 ⇒ 立刻按过场 / 硬切换；还没有画面 ⇒ 旧层留在屏上，
    //    新层先不参与绘制，画面一到就放行（见本文件上方的切层内容闸门）。─────────
    //    过场：新层在旧层之上入场（旧层保持不透明垫着，玻璃 backdrop-filter 依赖
    //    不透明背景）；旧层退场 / 音频放行 / 收尾清理都在 startLayerTransition 里统一处理。
    disposeOutgoingLayer(node, outgoing, switchTr, startFade);
    const canvas = node.querySelector("canvas.we-media--canvas");
    const video = node.querySelector("video");
    // 画布兜底色（见本文件上方的 refreshUnderlayColor / scheduleUnderlaySample）：
    // 幂等，同一次挂载只排一次取样；换壁纸即作废上一张的结果。
    refreshUnderlayColor();
    scheduleUnderlaySample(node);
    // Scene live render: 播放态/音量/fit 向渲染页 __wp 收敛（每次 emit 幂等；
    // __wp 未就绪时由心跳 tick 每秒兜底），并挂上指针注入（capture 监听一次
    // 注册，此后只更新目标 frame 引用）。
    const liveFrame = node.querySelector("iframe.we-live-iframe");
    if (liveFrame) {
      // 延迟/暂停中的载荷：可见且应播时补回 src（幂等；可见性变化会 emit → 走到这里）。
      // 放在 applyLiveControls 之前：补了 src 之后这一拍起渲染页才存在，控制面才有对象。
      armDeferredLiveFrame(liveFrame);
      applyLiveControls(liveFrame);
      ensureLivePointer(liveFrame);
      // 领养路径补挂激活态：这一跳没有重建层（同一张壁纸的再次 apply / revalidate /
      // stopLiveWatch 之后的那一跳），但 `selection.sceneLiveActive` 可能已被清成 false，
      // 而它的唯一置真点是**首帧门**——帧已在出帧时那扇门一辈子不会再走（`watch.firstFrame`
      // 已为真）⇒ 标志永久为假，指针注入与媒体桥（频谱 / Now Playing）双双静默失效，
      // 画面却照旧在播（用户只看得到"壁纸有时候坏了"）。这里按**同一套就绪判据**把
      // 语义补回来：心跳在，且这一拍真的在出帧（网页壁纸按"渲染页可达"）。
      // 判据与心跳自愈共用**同一个函数体**（`liveHeartbeatReady`，见它自己的注释）：它要求
      // 网页窗口的 `getState` 可读 ⇒ 可达到底但还没 load 完的窗口恒 false，而心跳那边早就在
      // 认这帧 —— 两边对同一帧答案不同，缝就出在那里。现在两处逐字同源；`liveFrameReady`
      // 只留给 `scheduleLiveMount` 的预热页。
      // 时序：本块在心跳起动（上面 adopt-live 分支的 startLiveWatch）之后 —— `liveWatch`
      // 与刚武装的对象是同一个，`firstFrame` 此刻可能还是 false（首帧要等一拍 tick），
      // 于是这里以"这一拍就有帧"直接判定，不等那一拍。
      const watchHere = liveWatch;
      if (!selection.sceneLiveActive && watchHere && watchHere.frame === liveFrame
          && liveFrame.isConnected && !liveFrameDeferred(liveFrame)
          && isEffectivelyPlaying()
          && liveHeartbeatReady(liveFrame, liveStats(liveFrame), liveStateOf(liveFrame), selection.type === "web")) {
        selection.sceneLiveActive = true;
        liveLog("live-rearm", "wid=" + selection.id + " 领养后补挂激活态（指针注入 / 媒体桥恢复）", "info");
      }
    }
    // Edge-only: drive the canvas mirror from the hidden decoder video.
    // Incremental guard: every emit (including the 500ms transcode poll) used
    // to run a FULL weStopDraw + weStartDraw — rebuilding the ResizeObserver,
    // re-registering rVFC and forcing a getComputedStyle read each time.
    // Same canvas + same video → the draw loop is already running; skip it.
    // (自定义壁纸的 objectFit 变更由「适配」按钮直接写 weDrawCtx.fit。)
    if (canvas && video) {
      const sameDraw = weDrawCtx && weDrawCtx.canvas === canvas && weDrawCtx.video === video;
      if (!sameDraw) weStartDraw(canvas, video, canvas.className.indexOf("we-media--fit") !== -1);
    }
    if (video) {
      // 播放态收敛（#84）：意图 → 元素真实状态，失败时回写 store 让「播放」
      // 按钮回来（见 applyVideoPlayback）。
      applyVideoPlayback(video);
      // Keep the rate in sync on every layer sync (covers rate changes while
      // the same wallpaper keeps playing — instant, no media reload).
      try { if (video.playbackRate !== selection.playbackRate) video.playbackRate = selection.playbackRate; } catch { /* ignore */ }
      // Frame-skip transcode (帧率上限): play the original now, swap to the
      // capped-fps re-encode when the host finishes it (no-op when cap is 0).
      // ⑤：触发归**视频通道**（这条类型专属逻辑不再留在实时管线里）。
      videoChannelAfterLayerBuild(video, selection);
    } else if (selection.videoPlaying === false || selection.videoError) {
      // 没有 <video>（图片 / 网页 / 静态帧壁纸）: 上一个视频留下的失败态必须
      // 清掉，否则卡片会继续显示属于上一张壁纸的错误。这里不 emit —— 本次
      // syncLayers 正是由 emit 驱动的，当前渲染会读到清空后的值。
      selection.videoPlaying = true;
      selection.videoError = "";
    }
  } else if (existing) {
    weStopDraw();
    stopLiveWatch();
    // 选择被清除：这一跳的旧层与"守着旧层的待显影层"都要一起退场 —— 壁上无壁纸时
    // 屏上不该留着任何一层的像素。
    forgetPendingReveal();
    retireFadingLayer();
    releaseLayerMedia(existing);
    existing.remove();
    // 壁上无壁纸 ⇒ 兜底色一并撤掉（否则根元素会一直带着上一张壁纸的颜色）。
    clearUnderlayColor();
  }
  if (!selection.url) {
    disposePreparedMedia(); // 层未建（选择已清除）：滞留就绪元素立即释放
    if (pendingStagedLayerNode) {
      const div = pendingStagedLayerNode;
      pendingStagedLayerNode = null;
      try {
        const f = div.querySelector && div.querySelector("iframe");
        if (f) disposeMediaEl(f);
      } catch { /* ignore */ }
      try { div.remove(); } catch { /* ignore */ }
    }
  }

  syncScrimElement();

  syncSceneFrameProbe();

  reclaimLayerAdoptionSlot();
}

// ── 轮换渐变：旧层退役 ───────────────────────────────────────────────────────
// retireFadingLayer: 快速连切时上一份 fading 层即时退役（任何时刻最多 2 层）。
// scheduleFadingLayerRemoval: 渐变宽限期后移除旧层并释放其媒体。

// ── 切换过场：把「新层入场 + 旧层退场」交给选定的过场动画 ────────────────────
// 只走内联样式 + 一个通用 transition 规则（.we-layer--switch），不写死每种过场的
// ·-on 类，好处是新增过场只需在 switchFrames 里加一条。
// cut 不会走到这里：调用方已把 startFade 置假、走「立即拆旧层」的硬切路径。
// 过场收尾：新层必须回到「干净」状态 —— 留着内联 transform / clip-path /
// will-change 会让满屏视频永久占一个合成层（applyEffects 特意避免这种开销）。
function resetLayerSwitchStyles(node) {
  if (!node) return;
  try { node.className = "we-layer"; } catch { /* ignore */ }
  try {
    node.style.transform = "";
    node.style.opacity = "";
    node.style.clipPath = "";
    node.style.removeProperty("--we-switch-ms");
  } catch { /* ignore */ }
}

/**
 * 开关"逐秒心跳"诊断日志（面板「live 诊断日志」开关）。
 * 留痕也归本函数：**开关本身必须留痕**（强制档不受该开关影响），否则事后无法判断
 * 那一刻是否在记。返回翻转后的值。
 */
function toggleLiveDiag() {
  liveDiagOn = !liveDiagVerbose();
  liveLog("diag-" + (liveDiagOn ? "on" : "off"),
    liveDiagOn ? "逐秒心跳日志已开启（本会话有效，刷新后失效）" : "逐秒心跳日志已关闭");
  return liveDiagOn;
}
// ⚠️ 这张表只许列**本文件真的声明过**的名字。`retireFadingLayer` / `nudgeWallpaperRepaint`
// 住在 `src/layer-core.js`（内联构建把整块 `export` 剥掉、两个文件并进同一作用域 ⇒ 抄错了
// 也照样解析），但"导出自己没声明的名字"在任何真 ESM 语境下都是链接期错误
// （`node --check` 报 `Export '…' is not defined in module`），故不列于此。
export {
  liveRenderEnabled, liveRenderUrl, liveFailReasonOf, applyLiveControls, liveApplied, LIVE_FIRST_FRAME_MS, syncLayers, toggleLiveDiag,
};

