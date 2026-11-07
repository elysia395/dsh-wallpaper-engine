/**
 * live-layer-probe.js — 实时管线的**心跳读数 / 首帧预算 / 载荷账本 / 失败归因 / FPS 诊断**域。
 *
 * 纯搬移（2026-11-07，S4）：下列声明与函数体逐字未改，只换了声明住哪。构建期由
 * scripts/build-client.mjs 按 INLINE_MODULES 顺序内联进同一工厂作用域（本模块排在
 * live-layer/watch.js 之前；看护 tick 是这些读数的唯一调用方）。
 *
 * 契约不变：不 import、无顶层可执行语句、只用扁平作用域里的自由名字（`liveWatch` /
 * `selection` / `apiJson` / `reportClientDiag` … 都由同作用域别的模块或正文声明）。
 * 导出块只列本模块真声明过的名字（台架按文件 import 时靠它把名字挂回全局）。
 */

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
    const grew = p.completed - s.completed > 0;
    const size = p.size > 0 ? p.size : 0;
    const servedEnough = size > 0 && p.served - s.served >= size;
    if (!grew && !servedEnough) {
      // 窗口内既没有整包完成、也没有涨够一个整包。此时**不能**直接判传输侧：
      // 「窗口开始前就已传完」与「本窗口确实没传完」在账本上都是"无增长"，靠上面
      // 那两个量分不开。两者处置相反（见本函数注释最后一条）——窗口第一次采样时
      // 就已经有完成的整包（`completed > 0`）⇒ 视为窗口前传完，维持渲染侧（落盘）；
      // 否则本窗口从零开始且一分钱没进展 ⇒ 传输侧，只记会话内 + 冷却重试。
      if (s.completed > 0) return "";
      return "transfer";
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

export { liveStats, liveFirstFrameBudget, liveFailCauseOf };
