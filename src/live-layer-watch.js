/**
 * live-layer-watch.js — 实时管线的**心跳/载荷/判失败/抓帧回填**域。
 *
 * 纯搬移：下列声明与函数体逐字未改，只换了声明住哪。构建期由 scripts/build-client.mjs 按
 * INLINE_MODULES 顺序内联进同一工厂作用域（本模块排在组装点 src/live-layer.js 之前）。
 * 契约不变：不 import、无顶层可执行语句、只用扁平作用域里的自由名字；导出块只列本模块
 * 真声明过的名字（台架按文件 import 时靠它把名字挂回全局）。
 */
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
// 而 6 次 `liveFail reason=timeout` 的 `stats` 全是"一帧都没出"。
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
  let pending;
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
    firstFrame: false, stall: 0, resumed: false, heldPaused: 0, rearmed: false,
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
    const alive = liveHeartbeatAlive(frame, stats, wstate, isWeb);
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
    if (responsive) {
      // 兜底自愈：这个标志的语义就是「渲染页活着且应在播」，看护心跳在这里的判据
      // （responsive / alive）比任何清零点都权威 —— 而全文件唯一的置真点是上面的
      // **首帧门**，它一辈子只走一次。于是同键重新 apply（领养分支不重载渲染页、
      // 也不重新武装首帧门）会把标志永久钉在 false：画面照播（`we-live-on` 类与
      // 垫底图早就是终态），可消费点全是提前 return —— `livePointerFlush` /
      // `livePointerSample` 挡住指针注入、`startMediaSync` 的 1s 拍挡住音频频谱与
      // Now Playing。用户看到的就是"壁纸有时候坏了，动一下鼠标没反应"。
      // 不在清零点上逐个补，是因为清零点分散（applySelection 三处 / stopLiveWatch）
      // 且各自都有"看起来正当"的理由；把语义的**唯一权威**放回心跳这一层，任何
      // 现在或将来漏掉的清零点都会被下一拍（≤1s）纠回来。
      // ⚠️ 分支进 `responsive`（上面那行），但**自愈本身**挂 `alive && isEffectivelyPlaying()`：
      // 场景暂停期 fps=0 ⇒ `alive` 恒为假，天然不自愈；**网页**的 `alive` 只问 iframe 加载
      // 与否（`iframeLoaded`），暂停期照样为真 —— 暂停语义必须由 `isEffectivelyPlaying()`
      // 补上，否则暂停期会把一个**故意暂停**的渲染页标成 active，指针注入与媒体桥白热。
      // 两头都对：真的在出帧才自愈，暂停/隐藏期不自愈，恢复播放后的第一拍再自愈
      // （延迟 ≤1s，用户无感）。
      // 判据里那第二个 `alive` 是**领养补挂那一跳的同名量**：只看本拍的本地
      // 读数（不读 `__wpStats`）⇒ 心跳这一层不依赖渲染页是否已 load 完。对可达但还没 load
      // 完的网页窗口，它与领养那边（`liveHeartbeatReady`）给出**同一个答案**，于是"标志被清
      // 了但没等到下一次 emit"的缝没有了：最迟下一拍补上。
      if (alive && isEffectivelyPlaying() && liveHeartbeatReady(frame, stats, wstate) && !selection.sceneLiveActive) {
        selection.sceneLiveActive = true;
        if (!watch.rearmed) {
          watch.rearmed = true;
          liveLog("live-rearm", "wid=" + watch.wid + " 心跳自愈（激活态被清后又恢复）", "info");
        }
      }
      watch.stall = 0;
      watch.resumed = false;
      // 帧率取证：每 5 秒一条（只上报，不做任何控制）——「限了 30 还卡」时
      // 这条能立刻分清是壁纸自身帧率低还是整页一起掉。
      watch.fpsTick = (watch.fpsTick || 0) + 1;
      if (watch.fpsTick % 5 === 0) reportLiveFps(watch, frame, stats, wstate);
      return;
    }
    if (!isEffectivelyPlaying()) { watch.stall = 0; watch.resumed = false; return; }
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
  // Linux 遮挡轮询：只对 scene 渲染页开（遮挡桥由宿主注入 scene-live HTML；web 壁纸
  // 是严格沙箱第三方页，把窗口几何投给它是泄漏也是噪声）。P0 仅 X11 宿主有数据，
  // 其余平台轮询只会拿到 backend=none ⇒ clearOcclusion，无害。
  // ⚠️ 必须在看护定时器之后建：两者同为 1s 周期，smoke 夹具按「第一个 1000ms 定时器」认看护。
  if (selection.type === "scene") startOcclusionPolling(frame);
}
function stopLiveWatch() {
  if (!liveWatch) return;
  try { clearInterval(liveWatch.timer); } catch { /* ignore */ }
  stopUiFpsProbe();
  stopMediaSync(liveWatch.frame);
  stopOcclusionPolling(); // 看护停 ⇒ 轮询停（1Hz 心跳断了渲染器会自清遮挡，别留孤儿定时器）
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
// 页/上游配合。首帧确认后 2.5s（实时画面进稳态）HEAD 探测主帧（裸 URL，拿
// X-WE-GPU-W/H 算**面积**）：
// - 主帧面积 ≥ 画布×0.95（X-WE-GPU=1）→ 不动（cover 缩小显示，大帧无损失）；
// - 主帧缺失（404）、只有自定义画面（204 + X-WE-GPU=0）或明显偏小 ⇒ 抓帧 PUT
//   覆盖（升级，直写——宿主面积守卫兜底，见 /scene-frame-cache）。
// 失败路径会清 token，于是下一次 live 首帧（通常来自重新挂载）可以重试；
// 成功/被更大主帧挡下（409 frame-smaller）则保留 token，避免同一壁纸反复抓帧。
const LIVE_FRAME_BACKFILL_DELAY_MS = 2500;
// 主帧升级判定的面积容差（与宿主 GPU_FRAME_AREA_TOL 同值同义，两端独立部署）：
// 主帧面积 ≥ 画布 × 95% 视为"不比画布小"，保留 + cover 缩放，不抓新帧。
const GPU_FRAME_AREA_TOL = 0.05;
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
      // 画布面积先于 HEAD：升级判定是「主帧面积 ≥ 我的画布面积」——基准取**抓帧
      // 用的那个 canvas**（存帧的 IHDR 就是它的尺寸）。canvas 读不到 ⇒ 面积未知
      // ⇒ 保守保留（无头/极简环境不写缓存，避免无休止重抓）。
      const win = frame.contentWindow;
      const doc = win && win.document;
      const canvas = doc && typeof doc.querySelector === "function"
        ? doc.querySelector("canvas[data-webwallgl-gl]") : null;
      const canvasW = canvas ? Number(canvas.width) || 0 : 0;
      const canvasH = canvas ? Number(canvas.height) || 0 : 0;
      const areaRef = canvasW > 0 && canvasH > 0 ? canvasW * canvasH : 0;
      const head = await apiHead(src);
      const hh = head.response;
      const hasGpu = Boolean(head.ok && hh && hh.headers
        && typeof hh.headers.get === "function" && hh.headers.get("x-we-gpu") === "1");
      // 主帧面积：宿主从 PNG 的 IHDR 读（X-WE-GPU-W/H）。缺失 = 未知几何 ⇒ 按
      // 「可能偏小」处理：抓一次，宿主面积守卫兜底（真比盘上小会被 409 拒掉，
      // 主帧毫发无损）——重抓一次必然收敛到正确状态。
      let masterArea = 0;
      if (hasGpu) {
        const gw = Number(hh.headers.get("x-we-gpu-w"));
        const gh = Number(hh.headers.get("x-we-gpu-h"));
        masterArea = Number.isFinite(gw) && gw > 0 && Number.isFinite(gh) && gh > 0 ? gw * gh : 0;
      }
      // **只升不降**：主帧面积 ≥ 我的画布（容差内）⇒ 保留（显示侧 cover 缩小，
      // 大帧缩小无损失）；主帧明显更小、缺失、或几何未知 ⇒ 抓我的尺寸覆盖（升级
      // —— 未知也敢抓，因为宿主面积守卫兜底：真比盘上小的帧会被 409 拒掉，主帧
      // 毫发无损，重抓一次必然收敛）。频繁调整窗口大小在这里零成本：形状变小
      // 根本不触发抓帧。force（「重新截」）一律重抓。
      const stale = force || (hasGpu && areaRef > 0
        && (masterArea <= 0 || masterArea < areaRef * (1 - GPU_FRAME_AREA_TOL)));
      // 主帧面积达标（≥ 画布×0.95）：无需抓帧，保留 token 免重复。
      if (hasGpu && !stale) return true; // 主帧面积达标：保留
      if (!hasGpu) {
        // 主帧缺失：首次回填（而非清写）。
        liveLog("gpu-frame-slot-missing", "wid=" + backfillWid + " 主帧缺失 → 抓帧回填", "info", true);
      } else if (stale && !force) {
        liveLog("gpu-frame-stale", "wid=" + backfillWid + " 主帧 "
          + Math.round(masterArea / 10000) + " 万px < 画布 "
          + Math.round(areaRef / 10000) + " 万px → 升级重抓");
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
      // 清旧帧只属于 **force**（用户要换内容）：且放在抓帧+门禁**之后**——先清后
      // 抓一旦抓帧失败就只剩空槽，比留旧帧更糟。自动升级路径**不清**：PUT 直写，
      // 宿主面积守卫保证小帧覆盖不掉大帧（409 frame-smaller = 别处有更大的帧，
      // 那就保留它），删这一步纯属多余。等面积覆盖放行 = force 在换内容。
      let clearedOld = true;
      let forceErrorLatched = false; // force 的"明示失败"一旦落账，成功路径不得擦掉
      if (force) {
        const del = await apiDelete("/scene-frame-cache/" + encodeURIComponent(token), { parse: true });
        // 只认 HTTP 层成败：200 + removed:false（本来就没有/已被并发清掉）也算清完。
        clearedOld = Boolean(del && del.ok);
        if (!clearedOld) {
          liveLog("gpu-frame-stale-keep", "wid=" + backfillWid + " 旧帧删除失败 → 仍尝试覆盖写", "info", true);
        }
      }
      const put = await apiFetch("/scene-frame-cache/" + encodeURIComponent(token), {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body: blob,
      });
      // 200 写入成功 / 409 frame-smaller（盘上有更大的主帧，我的写入被守卫拒了）：
      // 两种都算「已定局」——409 时主帧在位且比我的大，显示侧只会更好，不必重试。
      const ok = Boolean(put && (put.ok || put.status === 409));
      // force 且旧帧没删掉且 PUT 被守卫拒了：用户要的"换一张"没发生，必须明示失败
      //（静默成功会让面板显示已重抓而画面纹丝不动）。
      if (ok && force && !clearedOld && put.status === 409) {
        forceErrorLatched = true;
        forceFail(weT("旧实时帧删不掉（被占用或宿主报错）→ 没有换成新抓的这张，可稍后重试"));
      }
      // 槽位内容刚被替换：留存里那份字节已不对应盘上这张帧，撤掉（下一次建层重新取、重新留）。
      if (ok && put.ok) {
        releaseFrameBytes(token);
        recaptured = true;
        recaptureSize = canvasW + "x" + canvasH;
      }
      if (!ok && force) forceFail(weT("写入失败（宿主返回 {status}）", { status: put && put.status }));
      return ok;
    })().then((settled) => {
      // 抓帧 + 上传是异步的（多 MB PNG 要 0.1–1s），期间用户可能已经切走：
      // 状态更新只对发起时那张壁纸有效 —— 否则会给**当前**壁纸打上「已有 GPU 帧」
      // 的假标记（面板提示错、30s 内被误判为 pinned）。host 侧写入
      // 仍落在 token 自己的槽位，下次回到这张壁纸时面板探测自然会读到。
      if (settled && force) {
        gpuFrameUi.recapturing = false;
        if (!forceErrorLatched) gpuFrameUi.error = ""; // 明示失败在屏：不得被成功路径擦掉
        try { emit(); } catch { /* ignore */ }
      }
      if (String(selection.id || "") !== backfillWid) return;
      if (settled) {
        // 缓存里已有（或刚写入）GPU 帧 → 面板提示「优先于全部档位」。
        markGpuFrameProbed(backfillWid, true);
        markGpuFramePin(token, true); // 该 token 槽位刚写入 GPU 帧：探测缓存同步生效，无需再探
        if (recaptured && !forceErrorLatched) {
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


export { startLiveWatch, stopLiveWatch, liveStats, scheduleLiveFrameBackfill, cancelLiveFrameBackfill, clearLiveSessionFailures, liveWatch };
