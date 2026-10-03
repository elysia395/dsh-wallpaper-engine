/**
 * live-layer.js — **实时渲染管线**：live 渲染与控制、看护心跳、判失败、抓帧回填、指针转发、
 * poster/挂载/抓首帧，以及壁纸层的构建（syncLayers）与过场过渡。
 *
 * 为什么单独一个文件：这是"壁纸层从建到退"的整条链路，横跨 live 渲染、看护心跳、判失败、
 * 抓帧回填、指针转发、poster/挂载/抓首帧与过场过渡。留在 client.js 里，它会被**别的域**
 * （媒体集成、GPU 帧槽助手、用户属性、diag 上报）切开成若干不相邻区段 ⇒
 * "画面为什么没出来"要跨几段读完。放在这里，这类问题只需读一个文件。
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
 *   live 与帧          livePauseReason · GPU_FRAME_ASPECT_TOL · gpuFrameAspectKnown ·
 *                     liveViewportAspect · probeGpuFrameState · markGpuFramePin · markGpuFrameProbed ·
 *                     clearGpuFrameSlot · refreshStaticFrameNodes · prepareSceneLiveStage ·
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
  let wp = null;
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

// ── live 诊断日志 ───────────────────────────────────────────────────────────
// **为什么要有这条路**：live 判失败只写 sceneLiveFailures + 面板一行文案，事后无法回答
// 「为什么 15 秒没出帧」。渲染页内部的问题由它自己的 reportDiag 送到 host 的诊断环形缓冲
// （host 的 /diag 路由 → GET /wallpaper-engine/diag-log），这里把**客户端**事件送到同一个
// 缓冲，两条时间线于是可以对齐着看：
//   curl -s 127.0.0.1:<port>/wallpaper-engine/diag-log
// 逐秒心跳 tick 只在 localStorage.weLiveDebug === "1" 时打（默认关：一秒一条
// 会刷屏，也会给环形缓冲刷出无用的像素请求）。
const LIVE_DIAG_KEY = "weLiveDebug";
// 诊断代码版本 + 页面实例 id：日志里带着它们，事后能回答两个必问的问题 ——
// 「这一行是哪个 bundle 打的」（刷新是否真的生效）和「是哪个页面/窗口在跑引擎」
// （同时开两个 DSH 视图时，两个客户端会各自轮换、互相覆盖设置）。
// `d7`：上报自带级别（`&lvl=`，宿主按它分档；未知 / 缺失落 info）
// `d8`：首帧看护按载荷进展判超时 + 隐藏实例不拉载荷 + 失败分因（传输类不落盘）；
//       同时它是**失败记忆的管线身份**的一半（见 migrateStaleLiveFailures）——
//       旧管线挣来的 timeout 断言不许跨管线复用。
const LIVE_DIAG_BUILD = "d8";
const LIVE_PAGE_ID = (function () { try { return Math.random().toString(36).slice(2, 7); } catch { return "?"; } })();
// 面板开关（本会话有效、不落盘）：给「打不开 DevTools」的环境留的入口 ——
// DSH web 的根路径鉴权是 303 跳到干净的 `/`，URL 上的查询参数到不了客户端，
// 所以不能靠 ?weLiveDebug=1 传参。
let liveDiagOn = false;
function liveDiagVerbose() {
  if (liveDiagOn) return true;
  try { return typeof localStorage !== "undefined" && localStorage.getItem(LIVE_DIAG_KEY) === "1"; } catch { return false; }
}
// 三个档位名与宿主侧同集合（`lib/log.js` 的 LEVELS）。两侧**不共享内核**：共享内核会触发
// 构建清单与共享内核白名单的变更，成本高于收益。不一致也是安全的 —— 宿主对未知 / 缺失的
// `lvl` 一律落 `info`，客户端多一个档位名最多让那批消息变安静。防漂由守卫 N6 兜住。
const LIVE_LEVELS = ["error", "warn", "info"];
function liveLog(tag, detail, level, verboseOnly) {
  if (verboseOnly && !liveDiagVerbose()) return;
  // detail 支持传函数：热路径（每秒 tick）在开关关闭时不构造那串注定被丢弃的字符。
  const text = typeof detail === "function" ? detail() : detail;
  // 档位：`error` / `warn` / `info`，缺省与未知一律 `info`（宿主侧的判据同此）。
  const lvl = LIVE_LEVELS.indexOf(level) >= 0 ? level : "info";
  const line = "[we-live " + LIVE_DIAG_BUILD + "\u00b7p" + LIVE_PAGE_ID + "] " + tag + (text ? " · " + text : "");
  try { if (typeof console !== "undefined" && console.info) console.info(line); } catch { /* ignore */ }
  // 同源像素请求 → host /diag 环形缓冲（与渲染页 reportDiag 同一条通路；`lvl` 让宿主
  // 不必靠文案猜档位，字节前缀仍是 `/diag?msg=`；无 host（单测 sandbox）时 Image
  // 不存在，静默跳过）。
  try {
    if (typeof Image === "function") {
      const img = new Image();
      img.src = "/diag?msg=" + encodeURIComponent(line) + "&lvl=" + lvl;
    }
  } catch { /* ignore */ }
}
// 一句话状态尾巴：出帧判定 + 暂停原因 + 首帧/运行期计数。
function liveStateBrief(extra) {
  const hold = livePauseReason();
  return "playing=" + isEffectivelyPlaying() + (hold ? " hold=" + hold : "")
    + " hidden=" + (typeof document !== "undefined" && document.hidden ? 1 : 0)
    + " focus=" + (typeof document !== "undefined" && typeof document.hasFocus === "function" && document.hasFocus() ? 1 : 0)
    + (extra ? " " + extra : "");
}
// 加载即留痕：确认「哪次刷新、哪个 bundle、哪个页面」真的生效了（用户这台机器
// 打不开 DevTools，唯一取证通道是宿主诊断缓冲）。
//
// **必须延迟一拍**：本文件被内联在 bundle 顶部，而 `liveStateBrief()` 经
// `livePauseReason()` → `occlusionReason()` 读 `src/client.js` 的 `selection`
//（`const`，此刻仍在 TDZ）⇒ 顶层直接调会被外层 `try{}catch{}` **静默吞掉**。
// 实测代价：两份诊断文件 2495 行里 `client-boot` 出现 **0 次** —— 唯一带页 id /
// 窗口模式、能回答"同一时刻有几个客户端实例在跑"的那一行从来没落过盘。
// `setTimeout(0)` 在整个工厂作用域求值完成之后才跑，那时 `selection` 已就绪。
try {
  if (typeof document !== "undefined" && typeof setTimeout === "function") {
    setTimeout(function () {
      try {
        liveLog("client-boot", "build=" + LIVE_DIAG_BUILD + " page=p" + LIVE_PAGE_ID
          + " mode=" + desktopWindowMode() + " extSwap=" + (useExtendedFrameSwap() ? 1 : 0)
          + " " + liveStateBrief());
      } catch { /* ignore */ }
    }, 0);
  }
} catch { /* ignore */ }
// 失焦/隐藏是「首帧看护为什么不计时」的直接证据 —— 事件级留痕（只在变化时触发）。
try {
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("focus", function () { liveLog("play-state", liveStateBrief("window-focus")); });
    window.addEventListener("blur", function () { liveLog("play-state", liveStateBrief("window-blur")); });
  }
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", function () {
      liveLog("play-state", liveStateBrief(document.hidden ? "tab-hidden" : "tab-visible"));
    });
  }
} catch { /* ignore */ }
// 心跳留痕（60s 一条，常开）：任何时候事后回看，都能知道「页面在跑吗 / 哪张壁纸 /
// 什么播放态 / 看护进行到哪一步」，不必依赖复现时机。
try {
  if (typeof window !== "undefined" && typeof window.setInterval === "function") {
    window.setInterval(function () {
      const w = liveWatch;
      liveLog("beat", liveStateBrief("id=" + (selection.id || "-")
        + " liveOn=" + (selection.sceneLiveActive ? 1 : 0)
        + (w ? " watch=" + w.wid + " first=" + (w.firstFrame ? 1 : 0) + " held=" + w.heldPaused + " stall=" + w.stall : " watch=-")
        + " fails=" + Object.keys(selection.sceneLiveFailures || {}).length));
    }, 60000);
  }
} catch { /* ignore */ }

// ── live 心跳 ───────────────────────────────────────────────────────────────
// 1s tick 读渲染页 __wpStats.frame()（{fps, running}，最近 500ms 实测窗口）：
// - 首帧：running 且 fps>0 → 记 sceneLiveActive、iframe 淡入（we-live-on）、
//   音频互斥切换（停外置 <audio>）；
// - 首帧超时 → 失败；
// - 运行期：期望播放却连续 `LIVE_STALL_TICKS` 拍无帧（先单次 resume 自救）或页面失联 → 失败。
//
// **首帧预算不是固定 15s 的墙钟**：首帧必须等**整包到齐**
//（渲染页在 `pkg body` 之前不发任何东西），而实测 `scene.pkg` 到 336MB。于是：
//   · 基准 `LIVE_FIRST_FRAME_MS`：装配 + 纹理解码 + shader 编译的合理上限；
//   · 按包大小放大：`scenePkgBytes`（宿主 inventory 给）÷ 吞吐下限
//     `LIVE_PAYLOAD_FLOOR_BPS`，封顶 `LIVE_FIRST_FRAME_MAX_MS`；
//   · **传输有进展就不计超时**：宿主载荷账本（/scene-payload-progress）说字节在涨
//     ⇒ 每拍重置计时（与"暂停期不计时"同一条纪律：无帧有正当理由就不算失败）。
//     无进展且超过预算 → 失败，并按"传输未完成"归类（软失败，见 liveFail）。
// 实测依据：同一份 336MB 包，媒体源上 0.6s 到齐；应用源上出现过 15–74s 与永不返回，
// 而当时 6 次 `liveFail reason=timeout` 的 `stats` 全是"一帧都没出"。
// ⚠️ `LIVE_FIRST_FRAME_MS` 与 `LIVE_STALL_TICKS` 的声明在文件更上方（`LIVE_FAIL_LABELS` 之前）——
//    用户可见的失败文案从它们插值，顶层模板字符串不能引用后面声明的 `const`（TDZ）。
// 预算放大用的吞吐下限（8MB/s）：比实测（媒体源上 ~500MB/s）低两个量级，只用来
// 把"这份包至少得传多久"算进来，不当性能预期。取 0 或量不出体积时退回基准预算。
const LIVE_PAYLOAD_FLOOR_BPS = 8000000;
// 硬上限：无论有没有进展都不再等（进展只免除"无进展判死"，不免除总量上限）。
const LIVE_FIRST_FRAME_MAX_MS = 90000;
// 账本 `served` 连续这么久没有增长 ⇒ 视为停摆（有在飞的连接但一个字节都没进）。
const LIVE_PAYLOAD_STALL_MS = 10000;
// 传输类软失败的自动重试：冷却 + 上限（都在会话内，不落盘）。
const LIVE_TRANSFER_RETRY_DELAY_MS = 45000;
const LIVE_TRANSFER_RETRY_LIMIT = 2;
let liveWatch = null; // { frame, wid, timer, startedAt, hardAt, budget, firstFrame, stall, resumed, payload… }
let liveTransferRetryTimer = 0;
const liveTransferAttempts = new Map(); // wid -> 传输类软失败的次数（成功即清零）
function liveStats(frame) {
  try {
    const st = frame.contentWindow && frame.contentWindow.__wpStats;
    if (!st || typeof st.frame !== "function") return null;
    return st.frame();
  } catch { return null; }
}
// 当前壁纸的 inventory 条目（`scenePkgBytes` 在这里；找不到就 null）。
function liveInventoryEntry(wid) {
  const list = (selection.inventory && selection.inventory.wallpapers) || [];
  const key = String(wid == null ? selection.id : wid);
  if (!key) return null;
  for (const w of list) if (String(w && w.id) === key) return w;
  return null;
}
/** 首帧预算（毫秒）：基准 + 按包大小放大，封顶硬上限。 */
function liveFirstFrameBudget(wid) {
  const entry = liveInventoryEntry(wid);
  const bytes = Number(entry && entry.scenePkgBytes) || 0;
  const scaled = LIVE_FIRST_FRAME_MS + Math.ceil(bytes / (LIVE_PAYLOAD_FLOOR_BPS / 1000));
  return Math.max(LIVE_FIRST_FRAME_MS, Math.min(LIVE_FIRST_FRAME_MAX_MS, scaled));
}
/**
 * 问宿主载荷账本（**只上报，不做控制**）。`ok:false` = 这个 token 一次传输都没见过
 * ⇒ 一律当**未知**（`livePayloadFlowing` 返回 false，退回墙钟），绝不把"宿主没记账"
 * 当成"没在下载"。请求失败（旧宿主 404 / 断网）同样静默退回未知。
 */
function pollLivePayload(watch) {
  if (!watch || watch.payloadPolling) return;
  // 只有场景走载荷账本：网页壁纸的 `webLiveSrc` 是入口 URL（不是一个包 token），
  // 而它的就绪判据本来也不要求出帧（见上面的 alive 分型）。
  if (selection.type !== "scene") return;
  const token = String(watch.payloadToken || "");
  if (!token) return;
  watch.payloadPolling = true;
  let pending = null;
  try {
    pending = apiJson(SCENE_PAYLOAD_PROGRESS_PATH + "?token=" + encodeURIComponent(token));
  } catch { watch.payloadPolling = false; return; }
  if (!pending || typeof pending.then !== "function") { watch.payloadPolling = false; return; }
  pending.then((res) => {
    watch.payloadPolling = false;
    if (!watch || liveWatch !== watch) return; // 看护已换/已停：读数作废
    const d = res && res.ok && res.data && typeof res.data === "object" ? res.data : null;
    if (!d || d.ok !== true) {
      // 账本**明确**说"从没见过这个 token"（HTTP 200 + ok:false）= 本实例的取包请求
      // 根本没到过宿主 —— 这是失败归因的重要证据（见 liveFailCauseOf），要跟
      // "请求根本没问成"（旧宿主 404 / 断网，res.ok=false）区分开。
      if (d && d.ok === false) watch.payloadUnseen = true;
      watch.payload = null;
      return;
    }
    watch.payloadUnseen = false;
    const served = Number(d.served) || 0;
    watch.payload = {
      served,
      size: Number(d.size) || 0,
      active: Number(d.active) || 0,
      transfers: Number(d.transfers) || 0,
      completed: Number(d.completed) || 0,
      lastByteAt: Number(d.lastByteAt) || 0,
    };
    // "涨过"必须拿**上一次采样**比：同一拍里既采样又判活会把结论抹平。
    watch.payloadGrew = served > (watch.payloadPrev || 0);
    watch.payloadPrev = served;
    // 本看护窗口的**第一次**成功采样留底（served/completed 是跨实例只增的累积量，
    // 归因时要的是"这个窗口期间涨了多少"，见 liveFailCauseOf）。
    if (!watch.payloadStart) watch.payloadStart = { served, completed: watch.payload.completed };
  }).catch(() => { watch.payloadPolling = false; });
}
/** 传输还在动吗（无帧时唯一能免除超时的证据）。未知一律 false。 */
function livePayloadFlowing(watch) {
  const p = watch && watch.payload;
  if (!p) return false;
  if (watch.payloadGrew) return true;
  // 有在飞的连接且最近 `LIVE_PAYLOAD_STALL_MS` 内还进过字节：也算在动
  //（一拍采样之间恰好没有新字节，不等于停摆）。
  if (p.active > 0 && Date.now() - p.lastByteAt < LIVE_PAYLOAD_STALL_MS) return true;
  return false;
}
/**
 * 失败时归因：'transfer' = 传输没走完 / 没到过宿主（≠ 这张壁纸渲染不出来）。
 *
 * ⚠️ 账本按 token 记账、**跨实例跨时间累积**（`served`/`completed` 只增）—— 它答不了
 * "**我这个实例**的传输走完了吗"。而失败记忆（sceneLiveFailures）是所有窗口共用的
 * 持久设置：把"别的窗口很久以前传完过"当成"传输没问题"，一次远程取包失败就会
 * 被归成渲染侧、落盘、把本机一起拉黑（issue #129 的完整链条）。所以归"渲染侧"
 * （落盘）之前，必须先有**本看护窗口内**的整包完成证据：
 *   · 账本明确说没见过这个 token（`payloadUnseen`）⇒ 本实例的取包根本没到宿主 ⇒ 传输侧；
 *   · 账本有记录但看护窗口内 `completed` 没涨、`served` 也没涨够一个整包 ⇒ 传输侧；
 *   · 窗口内确有整包完成（completed 涨过，或 served 涨了 ≥ size）⇒ 渲染侧，维持原语义落盘；
 *   · 窗口开始前就已完成的传输（第一次采样时就 `completed>0` 且此后无增长）⇒ 无法
 *     区分"是我自己的快传输"还是"别的窗口的旧传输"，**维持原语义**（渲染侧）——
 *     本机媒体源上整包 0.6s 就到齐，多半落在第一次采样之前；把它错判成传输侧会让
 *     真正坏掉的渲染永远得不到持久降级。
 *   · 账本真的未知（旧宿主 404 / 断网，`payload=null` 且没见过 ok:false）⇒ 不归因，
 *     维持原语义 —— "没问成"不是"传输没到"的证据。
 */
function liveFailCauseOf(watch) {
  const p = watch && watch.payload;
  if (!p) return watch && watch.payloadUnseen ? "transfer" : "";
  if (p.transfers <= 0) return "transfer";
  if (p.active > 0) return "transfer";
  const s = watch.payloadStart;
  if (s) {
    if (p.completed - s.completed <= 0) {
      const size = p.size > 0 ? p.size : 0;
      if (!(size > 0 && p.served - s.served >= size)) return "transfer";
    }
  }
  return "";
}

// 渲染页运行时状态（新渲染页提供 __wp.getState）：网页壁纸很多没有 rAF 帧打点
// （setTimeout 主循环 / 纯静态页），fps 恒为 0 —— 「iframe 已 load」才是可靠的
// 「壁纸就绪」信号。旧渲染页没有该方法时返回 null（退化为「可达即就绪」）。
function liveStateOf(frame) {
  try {
    const wp = frame.contentWindow && frame.contentWindow.__wp;
    if (!wp || typeof wp.getState !== "function") return null;
    return wp.getState();
  } catch { return null; }
}
// 「整页卡不卡」与「壁纸自己卡不卡」是两回事：网页壁纸跑在跨源沙箱 iframe
//（独立渲染进程），它内部掉帧＝壁纸自己的开销；整页同时掉帧＝合成/模糊这类
// 全页代价（例如液态玻璃的 backdrop-filter 每帧重采样壁纸）。判读「限了 30
// 还是卡」必须先分清是哪一种，所以这里用一条**只做计数**的 rAF 链量 UI 帧率，
// 与渲染页上报的壁纸自身帧率（getState().webFps）一起写进诊断。
let uiFpsFrames = 0;
let uiFpsRaf = 0;
let uiFpsSince = 0;
// 计时全局按环境取：UI fps 是诊断探针，不该因为宿主没有 performance / rAF
// 就抛异常、打断实时渲染链（真浏览器恒有这两者，测试宿主可能只给部分 DOM）。
const uiNow = () => (typeof performance !== "undefined" && performance && typeof performance.now === "function")
  ? performance.now() : 0;
function startUiFpsProbe() {
  if (uiFpsRaf || typeof requestAnimationFrame !== "function") return;
  uiFpsFrames = 0;
  uiFpsSince = uiNow();
  const tick = () => { uiFpsFrames += 1; uiFpsRaf = requestAnimationFrame(tick); };
  uiFpsRaf = requestAnimationFrame(tick);
}
function stopUiFpsProbe() {
  if (uiFpsRaf) { try { cancelAnimationFrame(uiFpsRaf); } catch { /* ignore */ } }
  uiFpsRaf = 0;
  uiFpsFrames = 0;
  uiFpsSince = 0;
}
function takeUiFps() {
  const now = uiNow();
  const seconds = uiFpsSince > 0 ? (now - uiFpsSince) / 1000 : 0;
  const frames = uiFpsFrames;
  uiFpsFrames = 0;
  uiFpsSince = now;
  return seconds > 0.2 ? Math.round(frames / seconds) : -1;
}

// 运行时帧率上报：每 5 秒一条，落进 host 的 diag 文件（DSH Desktop 拿不到
// console，只能靠这条通道）。`cap` 是当前上限设置，`web` 是壁纸自身帧率
//（-1 = 渲染页没给，例如纯 CSS 动画的壁纸不靠 rAF），`rnd` 是渲染页线程帧率。
function reportLiveFps(watch, frame, stats, wstate) {
  const secs = Math.max(1, Math.round((Date.now() - (watch.fpsAt || watch.startedAt)) / 1000));
  watch.fpsAt = Date.now();
  const ui = takeUiFps();
  const web = wstate && typeof wstate.webFps === "number" ? wstate.webFps : -1;
  const rnd = stats && typeof stats.fps === "number" ? Math.round(stats.fps) : -1;
  reportClientDiag("live-fps",
    `ui=${ui} web=${web} rnd=${rnd} cap=${selection.sceneLiveFps || "-"}`
    + ` win=${secs}s playing=${isEffectivelyPlaying() ? 1 : 0}`);
}

// 宿主窗口模式（页面 URL 的 dsh-desktop-mode 参数；兼容模式为缺省值）。
function desktopWindowMode() {
  try {
    const m = new URLSearchParams(window.location.search).get("dsh-desktop-mode");
    return m === "extended" || m === "advanced" ? m : "compatibility";
  } catch { return "compatibility"; }
}

// A/B 逃生舱：extended 模式的「首帧后延迟换元」自救开关（与 dsh-desktop-mica /
// we-saturate 同风格，只解析一次并缓存）。
//   ?we-ext-swap=1 → 恢复换元（用于复验"启动期子框架合成层坏死"那个老问题）
//   缺省 / 垃圾值 → **不换元**（现行默认）
// 为什么默认关掉：换元后的新元素为防白闪被刻意摘掉 `we-live-on`（见 rebuildLiveFrame），
// 层随即回落垫底图（场景=静态帧、网页=作者预览图），而渲染页仍照旧出声。实机表现
// 「场景/网页壁纸都正常几秒后失效成静态、只有扩展模式、网页退成预览图」与 8000ms
// 定时器 + first-frame-ok 后正好 +8s 的 live-frame-rebuilt 日志逐条吻合 —— 前提
//（"启动期 iframe 永不上屏"）在当前 2.0.14 上已不成立，换元只剩破坏。
let extendedFrameSwap; // undefined = 未解析 · true = 换元 · false = 不换元
function useExtendedFrameSwap() {
  if (extendedFrameSwap !== undefined) return extendedFrameSwap;
  extendedFrameSwap = false;
  try {
    if (typeof location !== "undefined" && location && typeof location.search === "string") {
      let rawFlag = "";
      if (typeof URLSearchParams === "function") {
        rawFlag = new URLSearchParams(location.search).get("we-ext-swap") || "";
      } else {
        const m = /[?&]we-ext-swap=([^&]*)/.exec(location.search);
        rawFlag = m ? decodeURIComponent(m[1]) : "";
      }
      extendedFrameSwap = String(rawFlag).toLowerCase() === "1";
    }
  } catch { /* 解析异常：保持不换元（现行默认），绝不抛出 */ }
  return extendedFrameSwap;
}

// extended 模式下，启动期创建的 live iframe 合成层坏死（元素级红底都上不了
// 屏、文档 reload 与 reparent 均无效，实测 2.0.14；见 first-frame-ok 处的
// 注释）。唯一有效的自救是换一个全新元素：同 src 新帧由宿主在窗口稳定后重新
// 分配，合成恢复。只做一次（dataset 标记）。
// 两个硬约束（首轮实现漏掉后踩出的坑）：
// ① 只在 extended 触发——advanced 的帧合成正常，重建纯属误伤（切壁纸白闪 +
//    指针/音频接线全断）；
// ② 新元素不得拷贝 we-live-on：先隐藏装载，等它自己的 first-frame-ok 由首帧
//    门点亮（走标准淡入），否则加载中的空白 iframe 直接可见 = 闪白。
// 换元后同步改道三条接线：livePointerFrame（窗口 mousemove → pushPointer 的
// 目标）、startMediaSync（模块级 mediaTimer 闭包锁帧，不重发音频就永远断）、
// watch 状态（firstFrame/stall/startedAt 重走首帧门）。
let liveFrameRebuildTimer = 0;
function rebuildLiveFrame(frame, watch) {
  if (desktopWindowMode() !== "extended") return false;
  try {
    if (!frame || frame.dataset.weRebuilt === "1") return false;
    frame.dataset.weRebuilt = "1";
    const fresh = document.createElement("iframe");
    for (const a of frame.attributes) {
      try { fresh.setAttribute(a.name, a.value); } catch { /* ignore */ }
    }
    fresh.classList.remove("we-live-on"); // 场景活着再由首帧门点亮，杜绝白闪
    fresh.dataset.weRebuilt = "1";
    if (frame.parentNode) frame.parentNode.replaceChild(fresh, frame);
    else if (frame.isConnected) frame.replaceWith(fresh);
    else return false;
    watch.frame = fresh;
    watch.firstFrame = false; // 新帧重走首帧门：alive 分支会补齐媒体接线/回放/回填
    watch.stall = 0;
    watch.startedAt = Date.now();
    ensureLivePointer(fresh); // livePointerFrame 闭包还指着被移除的旧元素
    startMediaSync(fresh);    // mediaTimer 闭包锁的是旧帧，音频/Now Playing 断供
    liveLog("live-frame-rebuilt", "wid=" + watch.wid + " mode=extended"
      + " 启动期子框架合成层坏死 → 换新元素重挂同 src（指针/音频已改道）");
    return true;
  } catch { return false; }
}

function startLiveWatch(frame, wid) {
  stopLiveWatch();
  const watch = {
    frame, wid: String(wid || ""), timer: 0,
    startedAt: Date.now(),      // 会被"有正当理由的无帧"重置（暂停 / 传输在动）
    hardAt: Date.now(),         // 首次武装时刻，**从不重置**：预算的绝对上限
    budget: liveFirstFrameBudget(wid),
    payloadToken: String((selection.type === "scene" ? selection.sceneLiveSrc : selection.webLiveSrc) || ""),
    payload: null,              // 宿主账本最近一次读数（null = 未知）
    payloadUnseen: null,        // true = 账本明确说没见过这个 token（取包没到过宿主）
    payloadStart: null,         // 本看护窗口第一次成功采样的留底 {served, completed}
    payloadPrev: 0, payloadGrew: false, payloadPolling: false,
    loadingTicks: 0,
    firstFrame: false, stall: 0, resumed: false, heldPaused: 0,
  };
  liveLog("watch-start", "wid=" + watch.wid + " 预算=" + watch.budget + "ms " + liveStateBrief());
  watch.timer = setInterval(() => {
    if (!frame.isConnected) { liveLog("watch-stop", "iframe 已从文档移除", "info", true); stopLiveWatch(); return; }
    // 先读统计、后下发控制：虽然 applyLiveControls 已去重（只在变化时
    // resume/pause），保持这个顺序让读数不受任何控制调用的副作用影响。
    const stats = liveStats(frame);
    applyLiveControls(frame);
    const isWeb = selection.type === "web";
    const wstate = isWeb ? liveStateOf(frame) : null;
    // 就绪判定分类型：场景每帧都有 GL 提交 → 要求真出帧；网页壁纸很多没有 rAF
    // 打点（setTimeout 主循环 / 纯静态），只要渲染页可达（或 iframe 已 load）即算
    // 就绪 —— 按 fps 判定会把它们误判失败并降级（实测：一直停在占位图，15 秒后黑屏）。
    const alive = isWeb
      ? (wstate ? wstate.iframeLoaded === true : Boolean(stats))
      : Boolean(stats && stats.running && stats.fps > 0);
    // 渲染页明确记录了 iframe 加载错误 → 立即降级，不必等 15 秒超时。
    if (isWeb && wstate && wstate.iframeLoaded === false && wstate.webError) {
      liveFail("load");
      return;
    }
    liveLog("tick", () => liveStateBrief("fps=" + (stats ? Math.round(stats.fps * 10) / 10 : "null")
      + " running=" + (stats ? stats.running : "null") + " alive=" + alive
      + " first=" + watch.firstFrame + " stall=" + watch.stall + " held=" + watch.heldPaused
      + " load=" + watch.loadingTicks + " served=" + (watch.payload ? watch.payload.served : "?"))
      , "info", true);
    if (!watch.firstFrame) {
      if (alive) {
        watch.firstFrame = true;
        selection.sceneLiveActive = true;
        frame.classList.add("we-live-on");
        startUiFpsProbe();
        // live 真的出首帧 → 清掉准备期超时冷却。手动选择壁纸走的是建层路径、不经过
        // 准备链，所以不在这里清的话，一张「准备期超时过、实际跑得动 live」的壁纸会被
        // 轮换降级成 sceneVideo/静态帧直到页面关闭，而用户手动点开它却是活的。
        clearPrepareLiveTimeout(watch.wid);
        // 真的出过帧 = 这张壁纸跑得动：传输类软失败与它的重试计数一起清零。
        liveSessionFailures.delete(watch.wid);
        liveTransferAttempts.delete(watch.wid);
        liveLog("first-frame-ok", "wid=" + watch.wid + " 用时 " + (Date.now() - watch.startedAt) + "ms"
          + "（总 " + (Date.now() - watch.hardAt) + "ms，预算 " + watch.budget + "ms"
          + (watch.heldPaused ? weT("，暂停期跳过 {n} tick", { n: watch.heldPaused }) : "")
          + (watch.loadingTicks ? weT("，传输中 {n} tick", { n: watch.loadingTicks }) : "")
          + "，整包 " + ((watch.payload && watch.payload.size) || 0) + "B 完成 " + ((watch.payload && watch.payload.completed) || 0) + " 次）");
        try { syncSceneAudio(selection); emit(); } catch { /* ignore */ }
        // 网页壁纸：首帧稳定后抽一帧存到 host（下次加载/重启用它当占位图）。
        maybeCaptureLiveFrame(frame, selection);
        // 「壁纸属性」面板改过的值：网页壁纸随 HTML 种子到达（host 侧合并），
        // 场景壁纸没有种子通道 —— 就绪后在这里回放一次。
        applyStoredUserProps(selection);
        // 媒体桥接线：频谱（拉模式）与 Now Playing 转发。
        startMediaSync(frame);
        // GPU 抓帧回填静态帧缓存（best-effort，见 scheduleLiveFrameBackfill）。
        scheduleLiveFrameBackfill(frame);
        reportClientDiag("live-ready", "firstFrame ok");
        // ── extended 窗口模式：启动期子框架合成层坏死 workaround ──
        //（版本 2.0.14 / 内核 0.1.7-rc.1）：仅 extended 模式下，随页面启动创建的
        // live iframe 无论内容是否在画（toDataURL 有完整帧、GL 无报错），其合成层
        // 永远到不了屏幕——连元素级红底都不显示；而同 URL 的全新 iframe（哪怕含
        // WebGL 子画布）完全正常。兼容/advanced 模式无此问题（advanced 误触发
        // 重建会白闪 + 指针/音频接线全断，用户反馈）。场景链路本身已由
        // first-frame-ok 证明可用，此处把元素整个换成携带同一 src 的新元素：新帧
        // 由渲染进程新 allocations 承载，合成恢复。换元后重置首帧门，让下方
        // alive 分支对新元素再走一遍完整的同步链（媒体接线/属性回放/抓帧回填）。
        // dataset 标记保证只换一次。
        // 重建不在首帧瞬间执行：宿主窗口的合成环境在启动后数秒内仍未稳定
        // （首帧即换，4s 新帧照样坏死，实测），因此先起一次性定时器延后换元。
        // ⚠️ 该前提在当前 2.0.14 上已不成立：live 首帧能正常上屏，而换元把 `we-live-on`
        // 摘掉后层只剩下垫底图（正是"正常几秒后失效"的成因）⇒ **改为 opt-in**，缺省
        // 不换元（见 useExtendedFrameSwap）。
        if (desktopWindowMode() === "extended" && !liveFrameRebuildTimer && useExtendedFrameSwap()) {
          const cursed = frame;
          liveFrameRebuildTimer = setTimeout(() => {
            liveFrameRebuildTimer = 0;
            try {
              if (cursed.isConnected && watch.frame === cursed) rebuildLiveFrame(cursed, watch);
            } catch { /* ignore */ }
          }, 8000);
        }
      } else if (!isEffectivelyPlaying()) {
        // 主动暂停（失焦/隐藏/用户暂停）→ 是我们自己 applyLiveControls 把渲染页
        // pause() 掉的，而暂停中的渲染页 __wpStats.frame() 恒为 {fps:0,running:false}
        // —— 「无帧」是预期行为，不是失败信号：暂停期间不计时（每 tick 重新起算），
        // 恢复播放后再给满一个预算窗口。缺这条守卫时，轮换的**节点级领养**路径
        // （syncLayers 领养分支在同一个任务里就 applyLiveControls → pause）只要碰上
        // 失焦/隐藏/暂停，15s 后就会把这张壁纸持久记成「首帧超时」并降级回
        // sceneVideo/静态帧（要手动重开开关才能恢复）—— 而渲染页其实是好好的。
        // 运行期 stall 规则早就有同款守卫（见下），这里补齐对称性。
        watch.heldPaused += 1;
        watch.startedAt = Date.now();
        // 标签页隐藏且首帧还没出来：这份载荷是**纯负债** —— 隐藏页的 rAF 被冻结
        //（出帧物理上不可能），而它照样在按实例抢带宽/磁盘/解码器，抢的正是那个
        // **可见**实例（它同时卡在同一个预算里）。停掉载荷（about:blank 会中止在飞
        // 请求），层键不变、垫底图照旧，可见时由 armDeferredLiveFrame 补回 src。
        suspendLivePayload(frame, watch);
      } else {
        // 传输还在动吗 —— 只有宿主账本知道（渲染页 2.0.2 不上报下载进度）。
        // 有进展就与"暂停期"同等待遇：每拍重置计时，只受 hardAt 的绝对上限约束。
        pollLivePayload(watch);
        if (livePayloadFlowing(watch)) {
          watch.loadingTicks += 1;
          watch.startedAt = Date.now();
        }
        if (Date.now() - watch.hardAt > LIVE_FIRST_FRAME_MAX_MS
          || (!livePayloadFlowing(watch) && Date.now() - watch.startedAt > watch.budget)) {
          liveFail("timeout");
        }
      }
      return;
    }
    // 运行期：场景要求持续出帧；网页只要求渲染页可达（能读到 getState / stats，
    // 静止画面本身是正常状态，不是失联）。
    const responsive = isWeb ? Boolean(wstate || stats) : alive;
    if (responsive || !isEffectivelyPlaying()) {
      watch.stall = 0;
      watch.resumed = false;
      // 帧率取证：每 5 秒一条（只上报，不做任何控制）——「限了 30 还卡」时
      // 这条能立刻分清是壁纸自身帧率低还是整页一起掉。
      watch.fpsTick = (watch.fpsTick || 0) + 1;
      if (watch.fpsTick % 5 === 0) reportLiveFps(watch, frame, stats, wstate);
      return;
    }
    watch.stall += 1;
    if (watch.stall === LIVE_STALL_TICKS && !watch.resumed) {
      // 单次自救：contextlost 恢复后渲染器可能停摆但未上报，先推一把。
      watch.resumed = true;
      liveLog("stall-rescue", "wid=" + watch.wid + " 连续 " + watch.stall + "s 无帧 → 试 resume()", "warn");
      try {
        const wp = frame.contentWindow && frame.contentWindow.__wp;
        if (wp) wp.resume();
      } catch { /* ignore */ }
      return;
    }
    if (watch.stall >= LIVE_STALL_TICKS * 2) liveFail("stall");
  }, 1000);
  liveWatch = watch;
}
function stopLiveWatch() {
  if (!liveWatch) return;
  try { clearInterval(liveWatch.timer); } catch { /* ignore */ }
  stopUiFpsProbe();
  stopMediaSync(liveWatch.frame);
  liveWatch = null;
  // 只重置标志；音频互斥由调用方收敛 —— 重建（fps 切换）时若在这里拉起
  // 外置 <audio>，新一帧 live 又要立刻把它停掉，中间会闪一下双声道。
  selection.sceneLiveActive = false;
}

// ── 载荷的延迟与暂停（"隐藏的实例不该拉 300MB"）──────────────────────────────
// 首帧**等于整包到齐**，而已知最坏形态是"多个实例同时拉同一份大包互相饿死"：
// 实测 3 个客户端实例在 5 秒内挂同一份 336MB 包，只有最后一个走完，可见那个实例
// 在 15s 时 `stats={"fps":0,"running":false}`（一帧都没出）→ 被判首帧超时并写进
// **全局**失败记忆。而隐藏/不播的实例本来也出不了帧（Chromium 对隐藏页冻结 rAF），
// 它的载荷是纯负债。于是两条对称的纪律：
//   · `liveFrameShouldDefer()` —— 建层时（createLiveFrame）就不赋 src，等"可见且应播"；
//   · `suspendLivePayload()`   —— 加载中途转隐藏：把 src 摘成 about:blank
//     （**会中止在飞请求**），留 `weLiveSrc` 待补。
// 两者都不动层键（层仍算 live）⇒ 不触发重建，垫底图全程在位；补回由
// `armDeferredLiveFrame` 在每次 syncLayers（可见性变化会 emit）里做，幂等。
function liveFrameDeferred(frame) {
  return Boolean(frame && frame.dataset && frame.dataset.weLiveSrc);
}
/** 建层时就该延迟吗（不该在"看不见 / 不该播"时拉载荷）。 */
function liveFrameShouldDefer() {
  return !isEffectivelyPlaying();
}
/**
 * 延迟的渲染页现在该加载了吗：可见且应播才赋 src。幂等（补过就没有 `weLiveSrc` 了）。
 * 返回是否真的补了 —— 调用点据此写诊断行。
 */
function armDeferredLiveFrame(frame) {
  if (!liveFrameDeferred(frame)) return false;
  if (!isEffectivelyPlaying()) return false;
  const url = frame.dataset.weLiveSrc;
  frame.dataset.weLiveSrc = "";
  try { frame.src = url; } catch { frame.dataset.weLiveSrc = url; return false; }
  liveLog("live-payload-arm", "延迟的渲染页开始加载（可见且应播；载荷 " + livePayloadSizeBrief() + "）", "info");
  return true;
}
/** 诊断用：从 inventory 里取当前壁纸的包体积（拿不到就 '?'）。 */
function livePayloadSizeBrief() {
  const entry = liveInventoryEntry(selection.id);
  const bytes = Number(entry && entry.scenePkgBytes) || 0;
  return bytes ? (Math.round(bytes / 1048576) + "MB") : "?";
}
/**
 * 隐藏中转隐藏：把还没出首帧的 live 载荷停掉（可见时补回）。
 * **只对"首帧未确认"的帧生效**：已经出过帧的渲染页留着（它不再拉载荷，只有显存），
 * 拆掉它反而会让切回来的那一刻重新下载整包。
 */
function suspendLivePayload(frame, watch) {
  if (!frame || !watch || watch.firstFrame) return false;
  if (typeof document === "undefined" || !document.hidden) return false; // 只有"真的隐藏"才停
  const url = frame.getAttribute && frame.getAttribute("src");
  if (!url || url === "about:blank") return false;
  frame.dataset.weLiveSrc = url;
  try { frame.src = "about:blank"; } catch { return false; }
  liveLog("live-payload-suspend", "wid=" + watch.wid + " 隐藏中且首帧未出 → 停掉载荷（可见时补回）", "info");
  stopLiveWatch();
  return true;
}

// 判定失败：按壁纸写入持久失败记忆 → syncLayers key 变化重建为旧播放链
//（sceneVideo / 静态帧）→ 恢复外置音频互斥。本会话不再对该壁纸尝试 live，
// 直到用户重开「场景实时渲染」开关（显式重试入口，清空全部记忆）。
//
// **失败分级**（哪些进"所有窗口共用"的持久记忆、哪些只进本会话）：
//   · 传输类（`reason=timeout` 且归因是传输，见 liveFailCauseOf）＝ 这张壁纸渲染不出来的
//     **反证**（同一份包在别的实例 1–2s 就出帧了）⇒ 只进**会话内**软失败，
//     冷却后自动重试一次；绝不写共享设置（那会让一次饿死变成所有窗口的永久降级）。
//   · `stall`（运行期连续无帧）⇒ 同样只进会话内：失焦/被遮挡的窗口（Chromium 对
//     遮挡页冻结 rAF）也会"看起来"在无帧运行，而它跟传输停滞一样不是"这张壁纸
//     渲染不出来"的证据 —— 落盘就会把本机的其它窗口一起拉黑（issue #129 实测：
//     focus=0 的窗口 stall 落盘后，正常窗口也变静态）。本会话内软失败 + 冷却重试。
//   · 其余（首帧超时且确有本窗口的整包完成证据 / 渲染页加载错误）⇒ 维持原语义：落盘记忆。
function liveFail(reason) {
  const wid = liveWatch ? liveWatch.wid : String(selection.id || "");
  // 失败前抓一份现场：这是「为什么黑/为什么降级」唯一的事后证据（host 侧
  // /wallpaper-engine/diag-log 与渲染页自己的 reportDiag 对齐时间线）。
  const watched = liveWatch;
  const cause = reason === "timeout" ? liveFailCauseOf(watched) : "";
  liveLog("liveFail", "reason=" + reason + (cause ? "/" + cause : "") + " wid=" + wid
    + " 运行时长=" + (watched ? Date.now() - watched.startedAt : 0) + "ms"
    + " 总时长=" + (watched ? Date.now() - watched.hardAt : 0) + "ms"
    + " 预算=" + (watched ? watched.budget : 0) + "ms"
    + " stats=" + JSON.stringify(watched ? liveStats(watched.frame) : null)
    + " 已确认首帧=" + Boolean(watched && watched.firstFrame)
    + " 暂停期跳过tick=" + (watched ? watched.heldPaused : 0)
    + " 传输中tick=" + (watched ? watched.loadingTicks : 0)
    + " 载荷=" + JSON.stringify(watched ? watched.payload : null)
    + " 媒体源=" + (resolveSceneMediaBase() || weT("(应用源)"))
    + " " + liveStateBrief()
    + " prepare超时计数=" + (prepareLiveTimeouts.get(String(wid)) || 0)
    + " 帧率档=" + selection.sceneLiveFps, "warn");
  stopLiveWatch();
  if (!wid) return;
  if (cause === "transfer" || reason === "stall") {
    const attempts = (liveTransferAttempts.get(wid) || 0) + 1;
    liveTransferAttempts.set(wid, attempts);
    const softReason = cause === "transfer" ? "transfer" : "stall";
    liveSessionFailures.set(wid, softReason);
    reportClientDiag("live-fail", cause === "transfer" ? "reason=transfer" : "reason=stall-soft");
    liveLog("liveFail-soft", "wid=" + wid + " " + (LIVE_FAIL_LABELS[softReason] || softReason)
      + " → 只记会话内、不写全局记忆"
      + (attempts <= LIVE_TRANSFER_RETRY_LIMIT ? weT("，冷却 {s}s 后自动重试", { s: Math.round(LIVE_TRANSFER_RETRY_DELAY_MS / 1000) }) : weT("，已达重试上限")), "warn");
    scheduleLiveTransferRetry(wid, attempts);
  } else {
    const map = Object.assign({}, selection.sceneLiveFailures || {});
    // 记原因而不是 true：设置面板会把它显示出来（用户能反馈「为什么黑」）
    map[wid] = reason === "stall" ? "stall" : "timeout";
    reportClientDiag("live-fail", "reason=" + reason);
    selection.sceneLiveFailures = map;
    // 记下"这条管线挣来了这份记忆"：下次启动才不会被 migrateStaleLiveFailures 当成陌生管线清掉。
    rememberLivePipeline();
    try { persistSelection(); } catch { /* ignore */ }
  }
  try { syncLayers(); } catch { /* ignore */ }
  try { syncSceneAudio(selection); } catch { /* ignore */ }
  try { emit(); } catch { /* ignore */ }
}
/**
 * 显式重试入口（面板重开「场景实时渲染」）用的清理：**会话内**的软失败与重试计数一起清零。
 *
 * 为什么必须是独立入口：`sceneLiveFailures` 是宿主持久化设置（面板那句 `setSetting` 清它），
 * 而传输类软失败住在**内存**里 —— 少了这一条，"重开开关可重试"这条逃生门对传输类失败
 * 不成立（页面上看不见它，它却仍然拦着 live，用户只能刷新页面）。
 */
function clearLiveSessionFailures() {
  liveSessionFailures.clear();
  liveTransferAttempts.clear();
  if (liveTransferRetryTimer) { try { clearTimeout(liveTransferRetryTimer); } catch { /* ignore */ } }
  liveTransferRetryTimer = 0;
  // 显式重试也是"重新挣一次记忆"的起点：把管线身份一并刷新，避免下一次启动又把这份
  // 清空后的状态当成"陌生管线"再清一遍（无害，但会多写一次盘与一次日志）。
  rememberLivePipeline();
}
/**
 * 传输类软失败后的自动重试（会话内，不落盘）。
 *
 * 两条纪律：① **切走了就不重试**（不替用户在他已经不看的那张壁纸上花 300MB）；
 * ② 重试前若 `sceneMediaBase` 还是空串，先刷一次库存 —— 传输失败的常见成因正是
 * "这个实例的 inventory 是媒体源起来之前拉的、粘住了空串 ⇒ 包走应用源那条会饿死的路"。
 * 库存一刷新，层键（含 mediaBase）变化 ⇒ 下一次建层就会用上媒体源。
 */
function scheduleLiveTransferRetry(wid, attempts) {
  if (attempts > LIVE_TRANSFER_RETRY_LIMIT) return;
  if (liveTransferRetryTimer) return;
  if (typeof setTimeout !== "function") return;
  liveTransferRetryTimer = setTimeout(() => {
    liveTransferRetryTimer = 0;
    if (String(selection.id || "") !== String(wid)) return;
    if (!liveSessionFailures.has(String(wid))) return;
    if (!(selection.inventory && selection.inventory.sceneMediaBase)) {
      try { loadInventory(); } catch { /* ignore */ }
    }
    liveSessionFailures.delete(String(wid));
    liveLog("live-payload-retry", "wid=" + wid + " 第 " + attempts + " 次传输软失败 → 自动重试（清掉软记忆重建 live 层）", "info");
    try { syncLayers(); } catch { /* ignore */ }
    try { emit(); } catch { /* ignore */ }
  }, LIVE_TRANSFER_RETRY_DELAY_MS);
}

// ── live GPU 抓帧回填静态帧缓存 ─────────────────────────────────────────────
// 渲染页的显示 canvas 在 DOM 内（data-webwallgl-gl 标记）且 WebGL2 上下文带
// preserveDrawingBuffer:true —— 父页面同源即可随时 toBlob 抓当前帧，无需渲染
// 页/上游配合。首帧确认后 2.5s（实时画面进稳态）HEAD 探测静态帧槽位：
// - 已有 GPU 帧（X-WE-GPU=1）→ 不动；
// - 空槽（404）或已有自定义画面（204 + X-WE-GPU=0）→ 抓帧 PUT 回填：GPU 帧优先
//   于自定义画面（host 每壁纸只接受一次 GPU 帧写入，见 /scene-frame-cache）。
// 失败路径会清 token，于是下一次 live 首帧（通常来自重新挂载）可以重试；
// 成功/已被别人写入则保留 token，避免同一壁纸反复抓帧。
const LIVE_FRAME_BACKFILL_DELAY_MS = 2500;
const LIVE_FRAME_BACKFILL_MIN_BYTES = 4096;
// 空帧门禁（内容判定）：体积不可靠 —— headless Chrome 实测全黑 PNG：
// 960×540=12KB / 1080p=44KB / 4K=165KB，全都远超任何固定的字节阈值。改为把
// canvas 降采样到 `LIVE_FRAME_SAMPLE` 见方看亮度分布：近全黑或几乎无对比度 → 判为
// 「还没渲染出画面」，放弃回填（宁可继续用自定义画面，也不要写一张坏帧被 409 永久固化）。
const LIVE_FRAME_SAMPLE = 64;
const LIVE_FRAME_LIT_RATIO = 0.02;   // 亮于阈值(12/255)的像素占比下限
const LIVE_FRAME_MIN_VARIANCE = 4;   // 亮度方差下限（纯色帧≈0）
const LIVE_FRAME_BYTES_PER_PX = 0.02; // 黑帧实测约 0.021 B/px，取作体积地板
function liveFrameLooksUsable(canvas, blob) {
  try {
    const w = Number(canvas.width) || 0;
    const h = Number(canvas.height) || 0;
    // 分辨率相关的体积地板：比固定 4KB 有意义（真实画面远高于此）。
    if (w > 0 && h > 0 && blob.size < Math.max(LIVE_FRAME_BACKFILL_MIN_BYTES, w * h * LIVE_FRAME_BYTES_PER_PX)) {
      return false;
    }
    if (!w || !h) return true; // 尺寸未知：退回调用方的基础体积闸
    const probe = document.createElement("canvas");
    probe.width = LIVE_FRAME_SAMPLE;
    probe.height = LIVE_FRAME_SAMPLE;
    const ctx = probe.getContext && probe.getContext("2d");
    if (!ctx || typeof ctx.drawImage !== "function" || typeof ctx.getImageData !== "function") return true;
    ctx.drawImage(canvas, 0, 0, LIVE_FRAME_SAMPLE, LIVE_FRAME_SAMPLE);
    const px = ctx.getImageData(0, 0, LIVE_FRAME_SAMPLE, LIVE_FRAME_SAMPLE).data;
    let lit = 0, sum = 0, sumSq = 0, n = 0;
    for (let i = 0; i + 3 < px.length; i += 4) {
      const lum = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
      sum += lum; sumSq += lum * lum; n++;
      if (lum > 12) lit++;
    }
    if (!n) return true;
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    return lit / n >= LIVE_FRAME_LIT_RATIO && variance >= LIVE_FRAME_MIN_VARIANCE;
  } catch {
    return true; // 采样失败不阻断（基础体积闸已过）
  }
}
let liveFrameBackfill = { token: "", timer: 0 };
function cancelLiveFrameBackfill() {
  if (liveFrameBackfill.timer && typeof window !== "undefined" && typeof window.clearTimeout === "function") {
    try { window.clearTimeout(liveFrameBackfill.timer); } catch { /* ignore */ }
  }
  liveFrameBackfill = { token: "", timer: 0 };
}
// 抓一张实时画面回填 <key>_gpu.png。
// opts.force = 用户在面板上点了「重新截」：即使缓存里已有 GPU 帧也重抓一张，
// 且失败原因要**告诉用户**（后台自动回填是静默的）。仍然遵守原有的安全顺序：
// 先抓帧 + 过内容门禁，**成功之后**才清旧帧 —— 抓不到就原样保留，绝不留空槽。
function scheduleLiveFrameBackfill(frame, opts) {
  const force = Boolean(opts && opts.force);
  const src = selection.sceneFrameUrl || "";
  if (!src || src.indexOf("/scene-frame/") === -1 || !frame) {
    if (force) { gpuFrameUi.recapturing = false; gpuFrameUi.error = weT("拿不到实时画面（这个壁纸没有实时渲染）"); try { emit(); } catch { /* ignore */ } }
    return;
  }
  if (typeof window === "undefined" || typeof window.setTimeout !== "function") return;
  const token = String(src.split("/scene-frame/").pop() || "").split("?")[0];
  // force 要能打断「同一 token 已排队/在途」的去重（否则用户点了没反应）。
  if (!token || (!force && liveFrameBackfill.token === token)) return;
  cancelLiveFrameBackfill();
  liveFrameBackfill.token = token;
  const backfillWid = String(selection.id || "");
  // 本次是否因「存帧几何不符」而重抓（落地后据此刷新屏上静帧 + 留诊断痕迹）。
  let recaptured = false;
  let recaptureSize = "";
  // 手动重抓的失败原因要落到面板上（后台自动回填失败是静默的，只在 liveLog 留痕）。
  const forceFail = (msg) => {
    if (!force) return;
    liveLog("gpu-frame-recapture-fail", "wid=" + backfillWid + " " + msg);
    gpuFrameUi.recapturing = false;
    gpuFrameUi.error = msg;
    try { emit(); } catch { /* ignore */ }
  };
  liveFrameBackfill.timer = window.setTimeout(() => {
    liveFrameBackfill.timer = 0;
    (async () => {
      const head = await apiHead(src);
      const hh = head.response;
      const hasGpu = Boolean(head.ok && hh && hh.headers
        && typeof hh.headers.get === "function" && hh.headers.get("x-we-gpu") === "1");
      const win = frame.contentWindow;
      const doc = win && win.document;
      const canvas = doc && typeof doc.querySelector === "function"
        ? doc.querySelector("canvas[data-webwallgl-gl]") : null;
      // 「当前几何」的基准取**抓帧用的那个 canvas**（存帧的 IHDR 就是它的尺寸）：
      // 渲染器若把画布尺寸夹到某个比例（画布比 ≠ iframe 盒比），拿盒比去对照会
      // 永远判「不符」→ 每次挂载都清写一遍。canvas 读不到时退回 iframe 盒比。
      const canvasW = canvas ? Number(canvas.width) || 0 : 0;
      const canvasH = canvas ? Number(canvas.height) || 0 : 0;
      const arRef = canvasW > 0 && canvasH > 0 ? canvasW / canvasH : liveViewportAspect(frame);
      // 存帧几何：宿主从 PNG 的 IHDR 读（X-WE-GPU-AR）；旧宿主没有这个头时退回
      // 本会话抓帧时记下的比例，两者都没有 = 未知。
      let arStored = 0;
      if (hasGpu) {
        const raw = Number(hh.headers.get("x-we-gpu-ar"));
        arStored = Number.isFinite(raw) && raw > 0 ? raw : (gpuFrameAspectKnown.get(token) || 0);
      }
      // 未知（旧宿主 + 本会话没抓过）→ 按「可能不符」处理：重抓一次必然正确，
      // 留一张别处视口的帧则会让用户一直看到放大且被裁的构图。判不了当前几何
      // （arRef=0，如无头/极简环境）时反过来保守保留，避免无休止清写。
      // 用户手点「重新截」（force）时一律按需要重抓处理 —— 他就是要换一张。
      const stale = force || (hasGpu && arRef > 0
        && (arStored <= 0 || Math.abs(arStored - arRef) > GPU_FRAME_ASPECT_TOL * arRef));
      // 已有 GPU 帧且几何相符（含并发窗口里被别人写入）：无需抓帧，保留 token 免重复。
      if (hasGpu && !stale) {
        // 未知几何的保留要留痕：这是「没有头也没重抓」的唯一解释。
        if (arStored <= 0) liveLog("gpu-frame-keep-unknown", "wid=" + backfillWid + " 存帧视比未知 → 保留", "info", true);
        return true;
      }
      if (stale) {
        liveLog("gpu-frame-stale", "wid=" + backfillWid + " 存帧视比 "
          + (arStored > 0 ? arStored.toFixed(4) : weT("未知")) + " ≠ 当前视口 " + arRef.toFixed(4)
          + " → 清掉按当前视口重抓");
      }
      if (!canvas || typeof canvas.toBlob !== "function") {
        if (force) forceFail(weT("拿不到实时画面（实时渲染没在运行，或渲染页还没画布）"));
        return false;
      }
      const blob = await new Promise((resolveBlob) => {
        try { canvas.toBlob(resolveBlob, "image/png"); } catch { resolveBlob(null); }
      });
      if (!blob || blob.size < LIVE_FRAME_BACKFILL_MIN_BYTES) {
        if (force) forceFail(weT("抓到的画面是空的（实时渲染还在启动中？稍等一两秒再试）"));
        return false;
      }
      // 内容门禁：黑帧/纯色帧判为未渲染 → 放弃（保留槽里原有的帧）。
      if (!liveFrameLooksUsable(canvas, blob)) {
        if (force) forceFail(weT("抓到的画面还没有内容（全黑/纯色）→ 已保留原来那张"));
        return false;
      }
      // 真实渲染帧比作者预览图更能代表这张壁纸 ⇒ 顺手给「主题随壁纸」重判一次
      //（排名 2 会盖过预览图那一档；作者配色在场时它自己会让路）。取色复用同一档
      // 64×64 采样，代价可以忽略。
      themeFollowOnFrameCanvas(canvas);
      // 清旧帧放在抓帧+门禁**之后**：先清后抓一旦抓帧失败（画面没出来/网络断）就
      // 只剩空槽 → 退回自定义画面/空态，比留一张旧构图的帧更糟（旧的至少是同一张壁纸）。
      if (stale) {
        const cleared = await clearGpuFrameSlot(token);
        if (!cleared) {
          // 没删掉（权限/占用/宿主报错）→ PUT 也会 409，本帧没换成；清 token 让下
          // 次挂载重试，并留痕（否则用户只看到构图依旧是旧的，没有任何线索）。
          liveLog("gpu-frame-stale-blocked", "wid=" + backfillWid + " 旧帧未删除 → 本轮放弃，下次挂载重试");
          if (force) forceFail(weT("旧实时帧删不掉（被占用或宿主报错）→ 没有改动它，可稍后重试"));
          return false;
        }
        recaptured = true;
        recaptureSize = canvasW + "x" + canvasH;
      }
      const put = await apiFetch("/scene-frame-cache/" + encodeURIComponent(token), {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body: blob,
      });
      // 200 写入成功 / 409 已被写入：两种都算「已定局」，不必重试。
      const ok = Boolean(put && (put.ok || put.status === 409));
      // 槽位内容刚被替换：留存里那份字节已不对应盘上这张帧，撤掉（下一次建层重新取、重新留）。
      if (ok) releaseFrameBytes(token);
      if (!ok && force) forceFail(weT("写入失败（宿主返回 {status}）", { status: put && put.status }));
      if (ok && arRef > 0) gpuFrameAspectKnown.set(token, arRef);
      return ok;
    })().then((settled) => {
      // 抓帧 + 上传是异步的（多 MB PNG 要 0.1–1s），期间用户可能已经切走：
      // 状态更新只对发起时那张壁纸有效 —— 否则会给**当前**壁纸打上「已有 GPU 帧」
      // 的假标记（面板提示错、30s 内被误判为 pinned）。host 侧写入
      // 仍落在 token 自己的槽位，下次回到这张壁纸时面板探测自然会读到。
      if (settled && force) {
        gpuFrameUi.recapturing = false;
        gpuFrameUi.error = "";
        try { emit(); } catch { /* ignore */ }
      }
      if (String(selection.id || "") !== backfillWid) return;
      if (settled) {
        // 缓存里已有（或刚写入）GPU 帧 → 面板提示「优先于全部档位」。
        markGpuFrameProbed(backfillWid, true);
        markGpuFramePin(token, true); // 该 token 槽位刚写入 GPU 帧：探测缓存同步生效，无需再探
        if (recaptured) {
          liveLog("gpu-frame-recaptured", "wid=" + backfillWid + " 已按当前视口重抓（" + recaptureSize + "）");
          // 屏上若正显示这张静帧（静态帧壁纸 / live 垫底 poster）→ 就地重挂取回新图。
          refreshStaticFrameNodes(token);
        }
        try { emit(); } catch { /* ignore */ }
        return;
      }
      // 未定局（拿不到画面、门禁判定未渲染、网络失败）→ 清 token 允许下次重试。
      if (liveFrameBackfill.token === token) liveFrameBackfill.token = "";
      if (force) forceFail(weT("这次没抓成（拿不到画面或写入失败）→ 原来那张没动"));
    }).catch(() => {
      if (liveFrameBackfill.token === token) liveFrameBackfill.token = "";
      forceFail(weT("抓帧过程出错 → 原来那张没动"));
    });
  }, LIVE_FRAME_BACKFILL_DELAY_MS);
}

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
      let url = "";
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
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  for (const ev of ["pointerdown", "keydown"]) {
    window.addEventListener(ev, () => { bootRestore = false; }, { capture: true, passive: true, once: true });
  }
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
  // 会话结束 —— 本机曾一次泄漏 9 个 4K 引擎，把后续所有大包首帧拖到超时）——
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
    let dataUrl = null;
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
    // 事的判据；留一个"曾经就绪过"的纪念标记，只会让"这一刻屏上没有帧"的层被放行（真机
    // 日志：放行时 rs=0，屏上就是这一层的底色）。画面判据只认「当下这一帧」。
    // 视频档的"有画面"判据**归视频通道**（见 src/video-layer.js 的文件头）：
    //   · 海报图**已加载**（不是"属性存在" —— 属性刚设上时 <video> 还是透明，
    //     屏上就是层底色，那正是"十几秒纯色"的成因）｜· 首帧 readyState ≥ 2。
    // 两者都没有 ⇒ 返回 false，旧壁纸继续留屏（绝不露底色）。
    // Edge 把画面画进镜像 canvas，而画布底是写死的 #000：视频有帧还不够，要等
    // weDrawFrame 真的画上去一笔（那一笔落下时 canvas 会来报）。
    if (node.querySelector("canvas.we-media--canvas")) return false;
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
  // cancelStall 闭包（读最新 id + dead 标记）才是完整收口（2026-10-02 审计）。
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

// ── 画布兜底色（--we-wallpaper-underlay）──────────────────────────────────────
// 机制与"为什么必须是根元素"见 src/styles.js 的 `html { background-color: … }` 那段。
// 这里只说两个来源与优先级：
//   · **画面取样**（64×64 下采样后的占比最大色）优先 —— 兜底色的用途是"壁纸的像素没送到
//     屏上的那一瞬间，屏上还剩一层像它的颜色"，画面自己的主色比作者的 UI 配色更贴近这个语义；
//   · **作者 / 面板配色**兜底 —— 场景 / 网页 live 壁纸的可视叶子是 iframe，没有可直接采样的
//     媒体元素，只能走这条（作者填的恰好 0 0 0 视作"没填"、面板覆盖值照用，沿用 theme-follow
//     的同一套口径，不另立一份）。
// 取样只在**已经解码进 DOM 的叶子**上做（video / canvas / img 在屏上本来就有一份），因此不
// 额外发起任何网络请求或解码；全程 try/catch：跨源污染、无 2d 上下文、元素还没数据一律静默
// 放弃并保持作者配色那条腿，绝不抛。
const UNDERLAY_SAMPLE_DELAY_MS = 6000;   // 首帧后的复采：视频常有黑场淡入，首帧不足以代表画面
let underlayScheme = "";       // 作者 / 面板配色（"rgb(r, g, b)"；"" = 没有）
let underlaySampled = "";      // 画面取样结果（"rgb(r, g, b)"；"" = 还没采到）
let underlaySampledFor = "";   // 取样结果属于哪张壁纸（换壁纸即作废）
let underlayResampleTimer = 0; // 首帧后的复采定时器
let underlayWritten = "";      // 最近一次**真正写进去**的颜色（"" = 现在没写）

function underlayRgbText(rgb) {
  return Array.isArray(rgb) && rgb.length >= 3
    ? "rgb(" + rgb[0] + ", " + rgb[1] + ", " + rgb[2] + ")"
    : "";
}

/**
 * 把当前兜底色写到根元素（`""` = 摘掉变量 ⇒ 画布回到透明）。
 * 两条"什么都不做"的门：**从没写过、现在也没有颜色** ⇒ 连属性带留痕一起跳过（壁上本来
 * 就是宿主自己的底色，没有任何变化值得记）；**值没变** ⇒ 只写属性、不重复留痕（换壁纸时
 * 两个来源会各调一次，值相同不该各记一行）。留痕本身就是一次上报，所以这两条门同时也是
 * "别给诊断通道添噪声"。
 */
function writeUnderlayColor(reason) {
  if (typeof document === "undefined" || !document || !document.documentElement) return;
  const color = underlaySampled || underlayScheme;
  if (!color && !underlayWritten) return;
  try {
    const st = document.documentElement.style;
    if (color) st.setProperty("--we-wallpaper-underlay", color);
    else st.removeProperty("--we-wallpaper-underlay");
  } catch { /* 写不进去（极简环境）：保持既有值，不影响壁纸 */ }
  if (color === underlayWritten) return;
  underlayWritten = color;
  liveLog("underlay", "色=" + (color || "-") + " 源=" + reason + " wid=" + (selection.id || "-"));
}

/**
 * 作者 / 面板配色那条腿（同步、幂等）。换壁纸、面板改「壁纸属性」、开关主题类设置都会走到；
 * 画面取样结果在场时它不覆盖（写入口的优先级在 writeUnderlayColor 里，只有一处）。
 */
function refreshUnderlayColor() {
  let next = "";
  try { next = underlayRgbText(themeFollowSchemeColorOf(selection)); } catch { next = ""; }
  if (next === underlayScheme) return;
  underlayScheme = next;
  writeUnderlayColor(weT("作者配色"));
}

/** 清空两条腿并摘掉变量（清除壁纸 / 插件卸载）。 */
function clearUnderlayColor() {
  underlayScheme = "";
  underlaySampled = "";
  underlaySampledFor = "";
  underlayWritten = "";
  scrubUnderlayResample();
  if (typeof document === "undefined" || !document || !document.documentElement) return;
  try { document.documentElement.style.removeProperty("--we-wallpaper-underlay"); } catch { /* ignore */ }
}

function scrubUnderlayResample() {
  if (!underlayResampleTimer) return;
  try { if (typeof window !== "undefined" && window.clearTimeout) window.clearTimeout(underlayResampleTimer); } catch { /* ignore */ }
  underlayResampleTimer = 0;
}

/** 从层里的媒体叶子采一次占比最大色（画不出来就说"没有"，不改任何既有值）。 */
function sampleUnderlayOnce(el, wid) {
  try {
    if (!el || typeof document === "undefined" || !document) return false;
    const probe = document.createElement("canvas");
    if (!probe || typeof probe.getContext !== "function") return false;
    probe.width = THEME_FOLLOW_SAMPLE_PX;
    probe.height = THEME_FOLLOW_SAMPLE_PX;
    const g = probe.getContext("2d");
    if (!g) return false;
    g.drawImage(el, 0, 0, THEME_FOLLOW_SAMPLE_PX, THEME_FOLLOW_SAMPLE_PX);
    const px = g.getImageData(0, 0, THEME_FOLLOW_SAMPLE_PX, THEME_FOLLOW_SAMPLE_PX).data;
    const text = underlayRgbText(themeFollowModeColorOf(px, THEME_FOLLOW_SAMPLE_PX, THEME_FOLLOW_SAMPLE_PX));
    if (!text) return false;
    if (underlaySampledFor !== wid) return false;   // 采样期间换过壁纸：这次结果作废
    if (text === underlaySampled) return true;
    underlaySampled = text;
    writeUnderlayColor(weT("画面取样"));
    return true;
  } catch { return false; }   // 跨源污染 / 取像素被拒：保持作者配色那条腿
}

/**
 * 画面取样那条腿的调度（syncLayers 每次调用，幂等）：叶子已经解码 ⇒ 立刻采一次，并在
 * 播放一段时间后复采一次（黑场淡入的视频首帧不足以代表画面）；还没解码 ⇒ 等它的就绪事件。
 */
function scheduleUnderlaySample(node) {
  try {
    if (!node || typeof document === "undefined" || !document) return;
    const wid = String(selection.id || "");
    if (!wid) return;
    if (underlaySampledFor !== wid) {           // 换壁纸：上一张的取样结果作废
      underlaySampledFor = wid;
      underlaySampled = "";
      scrubUnderlayResample();
      writeUnderlayColor(weT("换壁纸"));
    }
    const el = node.querySelector("canvas.we-media--canvas")
      || node.querySelector("video.we-media")
      || node.querySelector("img.we-media");
    if (!el) return;                            // live（iframe）没有可直接采样的叶子
    const armed = el.dataset ? el.dataset.weUnderlayWid : "";
    if (armed === wid) return;                  // 这张壁纸的这个叶子已经排过取样
    if (el.dataset) el.dataset.weUnderlayWid = wid;
    const kind = String(el.tagName || "").toUpperCase();
    const ready = kind === "CANVAS"
      || (kind === "VIDEO" && Number(el.readyState) >= 2 && Number(el.videoWidth) > 0)
      || (kind === "IMG" && el.complete && Number(el.naturalWidth) > 0);
    const take = (again) => {
      try {
        if (String(selection.id || "") !== wid) return;   // 期间换过壁纸
        if (!sampleUnderlayOnce(el, wid)) return;
        if (!again) {
          scrubUnderlayResample();
          underlayResampleTimer = window.setTimeout(() => {
            underlayResampleTimer = 0;
            try { if (String(selection.id || "") === wid) sampleUnderlayOnce(el, wid); } catch { /* ignore */ }
          }, UNDERLAY_SAMPLE_DELAY_MS);
        }
      } catch { /* ignore */ }
    };
    if (ready) take(false);
    else if (typeof el.addEventListener === "function") {
      // 只等一次：`loadeddata`（video 首帧）/ `load`（img 解码完成）。不 bind 到具体壁纸 ——
      // 回调里按 wid 再校一次，换过壁纸就自然空转（元素本身随层一起被回收）。
      const ev = kind === "VIDEO" ? "loadeddata" : "load";
      try { el.addEventListener(ev, () => take(false), { once: true }); } catch { /* ignore */ }
    }
  } catch { /* 兜底色是增强：任何异常都不该影响壁纸主路径 */ }
}

// ── 可见性恢复：复合成微推 + 「画面真的回到屏上了吗」留痕 ────────────────────────
// 最小化 / 遮挡 / 后台节流之后再回到屏上时，合成器可能仍拿着那一层的陈旧状态：壁纸层是
// 整屏的负 z-index 普通元素，而本仓刻意不给它常驻合成层（见 --we-wallpaper-transform 的
// 注释）—— 于是"回来时它没被重新提交"没有第二条自愈路径。这里只做**一次两帧**的提升：
// 让合成器重新提交这一层的像素，随后立刻撤掉，不留常驻层。

/** 层的一句话在屏状态：几何 + 叶子就绪态 + 已呈现帧数（video 才有）。 */

/** 已呈现（解码输出）的帧数；拿不到返回 -1（判据是"它在不在涨"，不是绝对值）。 */

/**
 * 可见性恢复后的留痕（事件级，绝不进热路径）：意图态（playing / hidden / focus）答不了
 * "画面到底有没有回到屏上"，而这类只在特定窗口状态下复现的问题恰恰要这一条。
 * 第二行取**下一帧真的被呈现**那一刻（`requestVideoFrameCallback`），比等一个固定时长更
 * 贴近问题本身（"隔了多久画面才回来"），也不给任何"按毫秒数找定时器"的夹具添一个同槽位
 * 的干扰项 —— 弹这行的是**媒体事件**，与定时器命名空间无关。引擎没有 rVFC（或层里没有
 * video）时不补第二行：第一行已经带上了几何 + 叶子就绪态 + 已呈现帧数。
 */
function probeWallpaperOnScreen(source) {
  try {
    const node = document.getElementById(LAYER_ID);
    liveLog("onscreen", source + " · " + onScreenBrief(node));
    const v = node && node.querySelector ? node.querySelector("video.we-media") : null;
    if (!v || typeof v.requestVideoFrameCallback !== "function") return;
    const t0 = Date.now();
    v.requestVideoFrameCallback(() => {
      try {
        liveLog("onscreen", source + " · 画面呈现于 +" + Math.round(Date.now() - t0) + "ms · "
          + onScreenBrief(document.getElementById(LAYER_ID)));
      } catch { /* ignore */ }
    });
  } catch { /* 诊断是增强：失败不影响壁纸 */ }
}

// The official Windows preload observes body.style, but not ACTIVE_ATTR.
// Keep its measured native caption colour in step with the wallpaper gate.
// The plugin-owned marker only wakes that existing observer; it paints nothing.
function setWallpaperActive(active) {
  const body = document.body;
  if (active) body.setAttribute(ACTIVE_ATTR, "on");
  else body.removeAttribute(ACTIVE_ATTR);
  if (document.documentElement?.dataset?.windowsTitlebar === undefined) return;
  const marker = "--we-caption-active";
  if (active) {
    if (body.style.getPropertyValue(marker) !== "1") body.style.setProperty(marker, "1");
  } else if (body.style.getPropertyValue(marker)) {
    body.style.removeProperty(marker);
  }
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
    const wantKey = selection.type + "\u0000" + selection.url + "\u0000"
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
        // （本函数末尾）若判定「非有效播放」会把它 pause 掉，而暂停中的渲染页
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
    // ── 旧层处置：新层有画面 ⇒ 立刻按过场 / 硬切换；还没有画面 ⇒ 旧层留在屏上，
    //    新层先不参与绘制，画面一到就放行（见本文件上方的切层内容闸门）。─────────
    //    过场：新层在旧层之上入场（旧层保持不透明垫着，玻璃 backdrop-filter 依赖
    //    不透明背景）；旧层退场 / 音频放行 / 收尾清理都在 startLayerTransition 里统一处理。
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

  // 3. GPU 抓帧缓存状态（面板提示 + 清除入口）：场景壁纸才可能被抓帧。
  // 带 TTL 去重，syncLayers 调用频繁也不会打爆 HEAD。
  if (selection.type === "scene" && selection.sceneFrameUrl) {
    try { probeGpuFrameState(selection.sceneFrameUrl, false); } catch { /* ignore */ }
  }

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
  // 放在函数收尾（本函数无提前 return）：无论走哪条建层/领养路径、无论
  // buildMedia 是否被调用，退出时槽位必空。空槽位调用是 no-op。
  disposePreparedMedia();
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
 * 当时是否在记。返回翻转后的值。
 */
function toggleLiveDiag() {
  liveDiagOn = !liveDiagVerbose();
  liveLog("diag-" + (liveDiagOn ? "on" : "off"),
    liveDiagOn ? "逐秒心跳日志已开启（本会话有效，刷新后失效）" : "逐秒心跳日志已关闭");
  return liveDiagOn;
}
export {
  syncLayers, startLiveWatch, stopLiveWatch, liveFail, liveRenderEnabled, liveRenderUrl,
  liveFailReasonOf, liveLog, liveStateBrief, liveDiagVerbose, liveStats, applyLiveControls,
  scheduleLiveFrameBackfill, cancelLiveFrameBackfill, liveFrameEl, buildLivePoster,
  scheduleLiveMount, cancelLiveMount, createLiveFrame, retireFadingLayer, toggleLiveDiag,
  clearLiveSessionFailures,
  refreshUnderlayColor, clearUnderlayColor, nudgeWallpaperRepaint, probeWallpaperOnScreen,
  liveWatch, livePointerFrame, liveApplied, liveDiagOn, LIVE_FIRST_FRAME_MS, bootRestore,
};
