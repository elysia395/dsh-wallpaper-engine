/**
 * 宿主侧**焦点交还**（#148「网页壁纸周期性抢焦点」第二步的后半）。
 *
 * 为什么需要它：`lib/we-focus-guard.js` 只能拦**壁纸文档里**的两条程序化路径
 * （帧级 `window.focus()` 与元素级 `element.focus()`）。还有几条路它够不着：
 *  - 跨源 WindowProxy 上的 `top.focus()` / `parent.focus()`（同源策略允许调用、禁止改写）；
 *  - 不经过 JS 的**内部**聚焦路径：`autofocus` 属性、`dialog.showModal()`、`label` 转发点击等。
 * 这几条一旦把焦点搬进壁纸帧，宿主这边唯一能做的就是把焦点**交还**给用户本来在用的元素。
 *
 * 交还的判据（三条同时成立，缺一不可 —— 少一条就会和用户拉锯）：
 *  ① 焦点**从我们记住的那个宿主元素**离开（`focusout` 的 target 就是它），
 *  ② 它落进了**壁纸帧**（`document.activeElement` 是 `iframe.we-iframe`），
 *  ③ 这件事**不是用户手势引起的**：最近 `GESTURE_WINDOW_MS` 内没有真实 pointer/mouse/key/touch
 *     按下。用户真去点壁纸（或壁纸自己的编辑框）时窗口刚被刷新 ⇒ 不交还，照他点的来。
 *  跳过的交还**不会永久丢失**：手势窗口里跳过时按窗口剩余时间补一次（`retryTimer`）。没有这一步，
 *  打字期间被夺走的焦点就永久掉地 —— 焦点进壁纸帧之后宿主不再收到 keydown，`gestureAt` 就此冻结，
 *  唯一的触发路径（focusout 的那个 `setTimeout`）再也不会来（见判据 A3-F2）。
 *
 * 另外两道保险：记住的元素超过 `STALE_MS` 没被打过焦点就不交还（否则半天前点过的输入框会被
 * 翻出来抢焦点）；两次交还之间至少隔 `MIN_GAP_MS`（壁纸若以极高频率夺焦，不至于把主线程拖成
 * 焦点乒乓）。
 *
 * 自证手段：`window.__weFocusHandback = { lastEl, lastAt, gestureAt, handbacks, skipped, lastHandBackAt, active }`
 * —— 在 DSH 控制台里一眼能看到"交还了几次、跳过了几次"，与 `__weFocusGuard` 同一套纪律。
 * `handbacks` 一直不涨而症状仍在 ⇒ 夺焦路径不在本模块射程内（见上）。
 * `lastHandBackAt` 是**可复位的**：台架每条负对照前把它清零，否则"刚交还过"会替它挡判断（判据 A3-F1）。
 *
 * 与 `lib/we-focus-guard.js` 的分工：那一半住在**壁纸文档**里、负责"别让它是主动作恶的一方"；
 * 这一半住在**宿主文档**里、负责"就算被搬走了也把它搬回来"。两侧的手势窗口取同一个 1000 ms。
 */
let focusHandbackDispose = null;

/** 壁纸帧的判据：`iframe.we-iframe`（live 帧与 compat 帧都带这个类，见 src/live-layer-pointer.js:422
 *  与 src/media-prep.js:303）。用类名而不是某个 data-* 锚点：它随元素本身走，不依赖宿主 DOM。 */
function weIsWallpaperFrame(el) {
  if (!el || el.tagName !== "IFRAME") return false;
  const cls = typeof el.className === "string" ? el.className : "";
  return /(^|\s)we-iframe(\s|$)/.test(cls);
}

/**
 * 装上焦点交还监听器，返回**拆除函数**（挂 `ctx.effect` 用：宿主每次 revision 变化都会
 * tearDownEntryFiber 后重跑，不交还拆除函数就会一份实例一套监听器 —— 与 2e 段同一条理由）。
 * 已在装时重复调用返回同一个拆除函数（幂等）。
 */
function installFocusHandback() {
  if (typeof document === "undefined" || !document || typeof window === "undefined" || !window) return null;
  if (focusHandbackDispose) return focusHandbackDispose;
  // 环境能力检查：真实 DOM 一定有这四个方法；但本仓的 verify 挂载台用的是 stub `document`
  // （只有 body / style），少一个方法不能抛出去 —— `ctx.effect` 里抛会中断整条 apply（实测
  // verify-transcode-state 就是被这个打断的）。装不上就当作"这个环境没有宿主 DOM"。
  if (typeof document.addEventListener !== "function" || typeof document.removeEventListener !== "function"
    || typeof window.addEventListener !== "function" || typeof window.removeEventListener !== "function") return null;

  const GESTURE_WINDOW_MS = 1000; // 与 lib/we-focus-guard.js 的 gestureWindowMs 同值
  const STALE_MS = 120000;
  const MIN_GAP_MS = 300;
  // `lastHandBackAt` 与 `retrying`（有没有一个在途的补交定时器）都在 state 上（不是闭包局部）：
  // 台架要能读/清零。否则"刚刚交还过（< MIN_GAP_MS）"会抢在②③⑤任何一条判定之前返回，把每条
  // 负对照都变成假绿；`retrying` 则让"拆除是否真的清掉了定时器"可以被观测（见判据 A3-F1/F5）。
  const state = { lastEl: null, lastAt: 0, gestureAt: 0, handbacks: 0, skipped: 0, lastHandBackAt: 0, active: true, retrying: false };
  let retryTimer = null;

  const onFocusIn = (e) => {
    const el = e.target;
    // body/html 拿到焦点说明"宿主这边本来就没有焦点"，没有可交还的对象。
    if (!el || el === document.body || el === document.documentElement) return;
    if (weIsWallpaperFrame(el)) return;
    state.lastEl = el;
    state.lastAt = Date.now();
  };
  const onGesture = () => { state.gestureAt = Date.now(); };
  const handBack = () => {
    if (!state.active) return; // 拆除之后一次都不许再交还（包括手势窗口到点后的补交）
    const el = state.lastEl;
    if (!el) return;
    const active = document.activeElement;
    if (!weIsWallpaperFrame(active) || !active.isConnected) return; // ② 焦点得真的在壁纸帧里
    const now = Date.now();
    if (now - state.gestureAt <= GESTURE_WINDOW_MS) { // ③ 是用户自己点的
      state.skipped += 1;
      // 跳过一次 ≠ 放弃这一轮：手势窗口关闭时补交一次（见文件头，判据 A3-F2）。只有一个在途
      // 定时器：窗口里再来几次 focusout 都共用它，到点重判（那时可能已被新的手势刷新窗口）。
      if (retryTimer === null) {
        state.retrying = true;
        retryTimer = setTimeout(() => { retryTimer = null; state.retrying = false; handBack(); },
          Math.max(state.gestureAt + GESTURE_WINDOW_MS - now, 0) + 1);
      }
      return;
    }
    if (now - state.lastAt > STALE_MS) { state.skipped += 1; return; }
    if (now - state.lastHandBackAt < MIN_GAP_MS) { state.skipped += 1; return; }
    if (!el.isConnected) { state.skipped += 1; return; }
    state.lastHandBackAt = now;
    state.handbacks += 1;
    try {
      el.focus({ preventScroll: true });
    } catch (err) {
      try { el.focus(); } catch (err2) { /* 交还失败只体现为没交还，绝不抛 */ }
    }
  };
  const onFocusOut = (e) => {
    // ① 只有"焦点从我们记住的那个元素离开"才管 —— 否则任何一次 blur 都会触发一轮判断。
    if (!state.lastEl || e.target !== state.lastEl) return;
    // `document.activeElement` 在 focusout 之后才更新，所以挪到下一拍再判。
    setTimeout(handBack, 0);
  };

  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("focusout", onFocusOut, true);
  // 手势源与壁纸文档那一侧同集合：pointer/mouse/touch 按下 + 按键。
  window.addEventListener("pointerdown", onGesture, true);
  window.addEventListener("mousedown", onGesture, true);
  window.addEventListener("touchstart", onGesture, true);
  window.addEventListener("keydown", onGesture, true);
  try { window.__weFocusHandback = state; } catch (err) { /* 只读 window：只是少了自证手段 */ }

  focusHandbackDispose = () => {
    state.active = false;
    // 补交定时器也要摘掉：否则拆除之后它仍会醒来（handBack 里的 active 检查兜住交还，
    // 但留一个活着的定时器是泄漏，也会让台架"拆完还有异步动静"）。
    if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; state.retrying = false; }
    document.removeEventListener("focusin", onFocusIn, true);
    document.removeEventListener("focusout", onFocusOut, true);
    window.removeEventListener("pointerdown", onGesture, true);
    window.removeEventListener("mousedown", onGesture, true);
    window.removeEventListener("touchstart", onGesture, true);
    window.removeEventListener("keydown", onGesture, true);
    focusHandbackDispose = null;
  };
  return focusHandbackDispose;
}

export { installFocusHandback };
