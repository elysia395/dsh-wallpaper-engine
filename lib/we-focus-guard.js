/**
 * 网页壁纸的**帧级夺焦围栏** —— 一段以文本形式注入进壁纸文档的经典脚本。
 *
 * 现象：播某些网页类壁纸时，DSH 自己的输入框 / 下拉选择框 / 左下角账号菜单每被点一次就
 * 失去焦点（窗口仍在焦点、`relatedTarget` 为 null ⇒ 焦点被搬进了**另一个文档**）。
 * 与点击位置无关、与组件类型有关 —— 只有"必须持有键盘焦点才正常"的那类控件看得出来。
 *
 * 机制（在《鲸鱼计划表》workshopid 3800777313 上静态闭合）：
 *   ① 壁纸层 `pointer-events:none`，鼠标事件由 DSH UI 消费；插件在 window 捕获相把每次真实
 *      mousedown/mousemove 经 `__wp.pushPointer` 注入渲染页（src/live-layer.js），
 *      且只在 `selection.sceneLiveActive` 时发 ⇒ **暂停即停止注入**，这正是
 *      「暂停就恢复」的原因。
 *   ② 严格沙箱下渲染页够不到壁纸文档，控制只能经 web-shim 的 op 通道落到壁纸一侧；shim 用
 *      `elementFromPoint` 命中元素后 `dispatchEvent` 合成 pointer/mouse 事件
 *      （npm 包 webwallgl 内嵌的 web shim 的 `pushPointer` / `elementFromPoint` / `dispatchEvent`）。
 *      合成事件的 `isTrusted === false`，与用户真点壁纸可区分。
 *   ③ 作者为了在 WE 桌面模式下"让键盘有处可去"，在**捕获相 mousedown** 里调 `window.focus()`
 *      （该壁纸 index.html 中全文件唯一的 `window.focus` 调用点）⇒ 宿主窗口里
 *      **任何位置**点一下，DSH 的 composer / 下拉框就丢焦点。
 *
 * 为什么可以整条废掉：本插件从不把键盘送进壁纸帧 —— web-shim 里 `keydown/keyup/keypress/
 * KeyboardEvent` 零命中，渲染页的 keydown 只用于音频解锁（webwallgl 引擎内）。
 * 所以壁纸抢到帧级焦点，唯一效果就是**从 DSH 手里把键盘拿走**，而它在 DSH 里本来就收不到按键
 *（作者为此内置了软键盘）。
 *
 * #148 第二步：**元素级也围栏，但按"有无用户手势"区分**（`installElementFence`）。
 *  - 只拦帧级那一条不够：报告里"每点一次就丢焦点 / 周期 0.9–3.6 s"是**定时器**特征，
 *    本机探针确认 `setInterval(() => input.focus(), 2000)` 这类**元素级**夺焦 10/10 全穿透。
 *  - 为什么可以拦：壁纸层是 `pointer-events:none`（鼠标由宿主消费）且本插件不转发键盘 ⇒
 *    壁纸文档里程序化的 `element.focus()` 同样只能从 DSH 手里把键盘拿走，作者页在 DSH 里
 *    本来就用不上那个焦点。
 *  - 为什么要留窗口：用户真点壁纸时，shim 会**合成** pointer/mouse 送进来（`isTrusted === false`
 *    但确实是用户的手），壁纸自己的编辑框/模态框靠这次点击拿焦点是合理的 ⇒ 只在"最近一次
 *    真实交互"之后 `gestureWindowMs`（默认 1000 ms）内放行，窗口外吞掉并留计数与调用栈。
 *  - 可调：`__weFocusGuard.gestureWindowMs`；逃生门仍是 `allow = true`（两条围栏一起放开）。
 *
 * 实现纪律：
 *  - 注入体是**源码文本**（`weFocusGuardSource()` 用 `Function.prototype.toString` 取下面那个
 *    函数的原文），所以函数体必须**自足**：只碰 `window` 与标准内建，不引用本模块作用域的任何
 *    名字、不用 `import`/`export`（被当成经典脚本执行）。
 *  - 不放进 `lib/webwallgl/`：那是浏览器端渲染页的目录，围栏是宿主注入网页壁纸文档的字节，
 *    故随 `<script data-we-focus-guard>`
 *    注入 —— 与 shim 同一处（`lib/serve.js` 的 `/scene-files` HTML 分支），两条 web 路径
 *    （live 严格沙箱 + 旧链）都吃这一处注入。
 *  - 绝不抛：壁纸文档里任何异常都会毁掉作者脚本，而围栏的意义恰恰是"别让宿主被第三方代码
 *    拖下水"。补丁动作各自 try/catch，失败只体现为 `__weFocusGuard.installed === false`。
 *  - 留计数：`window.__weFocusGuard = { calls, blocked, allowed, installed, allow }`（帧级）
 *    + `{ elCalls, elAllowed, elBlocked, elInstalled, gestureAt, gestureWindowMs,
 *    elLastBlockedAt, elLastBlockedStack }`（元素级）。
 *    壁纸帧控制台里一眼能看到拦了多少次 —— 这是围栏唯一的自证手段。`allow = true` 是
 *    **逃生门**（给对比测试用，不是用户开关）：置 true 后原函数照旧调用、`allowed` 累加。
 *
 * 已知残留（不在本围栏射程内）：跨源 WindowProxy 上的 `top.focus()` / `parent.focus()` 无法从
 * 壁纸文档侧改写（同源策略允许调用、禁止改写）；要拦它只能在宿主半拦，代价是与作者页拉锯，
 * 本仓不做。真出现这类壁纸时，`__weFocusGuard.blocked` 不涨而症状仍在 —— 那就是这个残留。
 */
export function weFocusGuardSource() {
  return '(' + weFocusGuardInstall.toString() + ')();';
}

/** 注入体本身（自足；注释会随源码一起进 HTML，写短） */
function weFocusGuardInstall() {
  var w = window;
  if (w.__weFocusGuard) return;                       // 幂等：同一文档重复注入只装一次
  var guard = {
    calls: 0, blocked: 0, allowed: 0, installed: false, allow: false,
    elCalls: 0, elAllowed: 0, elBlocked: 0, elInstalled: false,
    gestureAt: 0, gestureWindowMs: 1000, elLastBlockedAt: 0, elLastBlockedStack: "",
  };
  w.__weFocusGuard = guard;

  // ── 帧级：window.focus() 无条件吞掉 ──
  var raw = null;
  try { raw = w.focus; } catch { raw = null; }
  if (typeof raw === 'function') {
    var patched = function () {
      guard.calls += 1;
      if (guard.allow) { guard.allowed += 1; return raw.apply(w, arguments); }
      guard.blocked += 1;                             // 帧级夺焦：吞掉，不转交原函数
      return undefined;
    };
    // ① 直接赋值：Window 上的 focus 是原型上的可写操作 ⇒ 赋值产生自有属性并遮蔽它。
    try { w.focus = patched; } catch { /* 只读/访问器：交给 ② */ }
    // ② 赋值没生效（继承来的不可写属性 / 访问器）时改用 defineProperty —— 自有属性的创建
    //    不受继承链约束，所以这条腿覆盖 ① 覆盖不到的形态。
    if (w.focus !== patched) {
      try { Object.defineProperty(w, 'focus', { configurable: true, writable: true, value: patched }); } catch { /* 如实记账 */ }
    }
    guard.installed = w.focus === patched;
  }

  // ── 元素级：只在"最近一次真实交互"的窗口内放行 element.focus()（见文首 #148 第二步）──
  try {
    var doc = w.document;
    var El = w.HTMLElement;
    if (doc && El && El.prototype && typeof El.prototype.focus === 'function') {
      var rawEl = El.prototype.focus;
      // 手势源：pointer/mouse/touch 的按下 + 按键（含 shim 合成的 isTrusted === false 事件 ——
      // 那正是用户真手经 op 通道送进来的那一次）。
      var mark = function () { guard.gestureAt = Date.now(); };
      var names = ['pointerdown', 'mousedown', 'touchstart', 'keydown'];
      var i;
      for (i = 0; i < names.length; i++) {
        try { w.addEventListener(names[i], mark, true); } catch { /* 少一个手势源不影响围栏 */ }
      }
      var elPatched = function () {
        guard.elCalls += 1;
        var win = guard.gestureWindowMs > 0 ? guard.gestureWindowMs : 1000;
        var fresh = guard.gestureAt > 0 && (Date.now() - guard.gestureAt) <= win;
        if (guard.allow || fresh) { guard.elAllowed += 1; return rawEl.apply(this, arguments); }
        guard.elBlocked += 1;                         // 无手势的周期性夺焦：吞掉（这里刻意不写 return undefined）
        guard.elLastBlockedAt = Date.now();
        try {
          guard.elLastBlockedStack = String(new Error().stack || '').split('\n').slice(0, 4).join(' | ');
        } catch { /* 栈拿不到就算了 */ }
        return;
      };
      try { El.prototype.focus = elPatched; } catch { /* 交给下一条腿 */ }
      if (El.prototype.focus !== elPatched) {
        try { Object.defineProperty(El.prototype, 'focus', { configurable: true, writable: true, value: elPatched }); } catch { /* 如实记账 */ }
      }
      guard.elInstalled = El.prototype.focus === elPatched;
    }
  } catch { /* 元素级整体装不上：帧级那一半仍然有效 */ }
}
