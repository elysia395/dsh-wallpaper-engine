/**
 * live-layer-diag.js — 实时渲染管线的**诊断与日志**域。
 *
 * 纯搬移：下列声明与函数体逐字未改，只换了声明住哪。构建期由 scripts/build-client.mjs 按
 * INLINE_MODULES 顺序内联进同一工厂作用域（本模块排在组装点 src/live-layer.js 之前）。
 * 契约不变：不 import、无顶层可执行语句、只用扁平作用域里的自由名字；导出块只列本模块
 * 真声明过的名字（台架按文件 import 时靠它把名字挂回全局）。
 */
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
// eslint-disable-next-line prefer-const -- 跨片段写入：live-layer.js:560
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
// ── 诊断留痕的安装（随 fiber 活、随 fiber 死）────────────────────────────────
// 下面这四条（加载即留痕 / 窗口失焦·隐藏的事件留痕 / 60s 心跳）**不能是模块级副作用**。
// DSH 的客户端装载契约（`dsh-client-modules`）是：bundle 只注册 factory，模块体（含一切
// 副作用）在 materialize 时求值一次并被 `loadCache` 记忆化；而**每次 revision 变化**
//（产物 mtime/ctime/size 一变就算，内容相同也算）宿主都会 `tearDownEntryFiber` 再用新模块体
// 重跑一遍。模块级副作用不挂在 fiber 上 ⇒ 每次重载，旧实例的定时器与监听器都留在原地：
// 实测同一个 document 里 **214 个页 id、64 个存活**，一次真实的 window blur 被 **117 份
// 实例各记一条**（每行还发一个 /diag 像素请求 ⇒ 日志与请求双双 100× 噪声）。
// 官方文档原文："Keep factories free of side effects. Register styles, timers, listeners and
// other resources inside `apply` with `ctx.effect`/`ctx.on` and return their cleanup functions."
// ⇒ 四条一律在这里注册、由返回值一次性注销；`liveDiagUninstall` 只记"上一份装到哪"，万一
// 宿主重复 apply 也先拆旧的再装新的（不叠加）。
let liveDiagUninstall = null;
function installLiveDiagnostics() {
  if (typeof liveDiagUninstall === "function") {
    try { liveDiagUninstall(); } catch { /* ignore */ }
  }
  const cleanups = [];
  // 监听器一律记账：注销时逐条摘掉（本仓 `src/client.js` 的 apply 里是同一套写法）。
  const listen = (target, type, fn) => {
    if (!target || typeof target.addEventListener !== "function") return;
    try {
      target.addEventListener(type, fn);
      cleanups.push(function () { try { target.removeEventListener(type, fn); } catch { /* ignore */ } });
    } catch { /* ignore */ }
  };
  // 加载即留痕：确认「哪次刷新、哪个 bundle、哪个页面」真的生效了（用户这台机器
  // 打不开 DevTools，唯一取证通道是宿主诊断缓冲）。
  //
  // **仍然延迟一拍**：`liveStateBrief()` 经 `livePauseReason()` → `occlusionReason()` 读
  // `src/client.js` 的 `selection`；在 apply 里它已过 TDZ，但延迟一拍还顺带保证这一行落在
  // 本 fiber 的其余安装之后（顶层直调会被外层 `try{}catch{}` 静默吞掉 —— 实测两份诊断文件
  // 2495 行里 `client-boot` 出现 **0 次**）。注销时把它一起清掉。
  try {
    if (typeof setTimeout === "function") {
      const bootTimer = setTimeout(function () {
        try {
          liveLog("client-boot", "build=" + LIVE_DIAG_BUILD + " page=p" + LIVE_PAGE_ID
            + " mode=" + desktopWindowMode() + " extSwap=" + (useExtendedFrameSwap() ? 1 : 0)
            + " " + liveStateBrief());
        } catch { /* ignore */ }
      }, 0);
      cleanups.push(function () { try { clearTimeout(bootTimer); } catch { /* ignore */ } });
    }
  } catch { /* ignore */ }
  // 失焦/隐藏是「首帧看护为什么不计时」的直接证据 —— 事件级留痕（只在变化时触发）。
  const win = typeof window === "undefined" ? null : window;
  const doc = typeof document === "undefined" ? null : document;
  listen(win, "focus", function () { liveLog("play-state", liveStateBrief("window-focus")); });
  listen(win, "blur", function () { liveLog("play-state", liveStateBrief("window-blur")); });
  listen(doc, "visibilitychange", function () {
    liveLog("play-state", liveStateBrief(doc.hidden ? "tab-hidden" : "tab-visible"));
  });
  // 心跳留痕（60s 一条，常开）：任何时候事后回看，都能知道「页面在跑吗 / 哪张壁纸 /
  // 什么播放态 / 看护进行到哪一步」，不必依赖复现时机。
  try {
    if (typeof setInterval === "function") {
      const beatTimer = setInterval(function () {
        const w = liveWatch;
        liveLog("beat", liveStateBrief("id=" + (selection.id || "-")
          + " liveOn=" + (selection.sceneLiveActive ? 1 : 0)
          + (w ? " watch=" + w.wid + " first=" + (w.firstFrame ? 1 : 0) + " held=" + w.heldPaused + " stall=" + w.stall : " watch=-")
          + " fails=" + Object.keys(selection.sceneLiveFailures || {}).length));
      }, 60000);
      cleanups.push(function () { try { clearInterval(beatTimer); } catch { /* ignore */ } });
    }
  } catch { /* ignore */ }
  const dispose = function () {
    if (liveDiagUninstall === dispose) liveDiagUninstall = null;
    for (const fn of cleanups.splice(0)) { try { fn(); } catch { /* ignore */ } }
  };
  liveDiagUninstall = dispose;
  return dispose;
}


export { liveLog, liveStateBrief, liveDiagVerbose, installLiveDiagnostics, liveDiagOn };
