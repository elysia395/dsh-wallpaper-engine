/**
 * glass-surfaces.js — 表面策略与可撤销运行管理。
 * 参数沿用 glass.js 写出的变量；只给已验证页面区域放置根级背景叶节点。
 * 不改变共享祖先的定位、层叠、滤镜或宿主内容树；不安全的区域完整保留原生背景。
 * 额外选择器仅借用原生已有的定位/层叠上下文，不为其制造上下文。
 * sync/dispose 经 glass-extra 接入既有 effects 生命周期；静止时不安排循环帧。
 */
function weResolveSurface(id, selection, facts) {
  const native = (reason) => ({ mode: "native", reason });
  if (selection && selection.glassSurfacePolicy && selection.glassSurfacePolicy[id] === "native") return native("policy-native");
  if (facts.preserve) return native("preserve");
  if (!facts.enabled) return native("disabled");
  if (!facts.visible) return native("hidden");
  if (facts.nativeBlur) return native("native-blur");
  if (facts.occupied) return native("carrier-busy");
  if (id === "content") return { mode: "content", reason: "known-canvas" };
  if (id === "settings-window" || id === "declared") return facts.safeLocal
    ? { mode: "local", reason: "native-context" } : native("unsafe-local-carrier");
  if (id === "extra") {
    // 拒绝次序不放宽：unsafe-local-carrier 仍先于软渲档 —— 非安全上下文照旧完整原生。
    if (!facts.safeLocal) return native("unsafe-local-carrier");
    // 软渲档显式回退（G6）：resolver 打出 extra-fallback 标记 ⇒ glass-extra 的无霜
    // 不透明底色规则（body[data-we-glass-fallback] 组）才有着力点；非安全上下文不进这里。
    if (facts.software) return { mode: "extra-fallback", reason: "software-fallback" };
    return { mode: "local", reason: "native-context" };
  }
  if (!facts.safeRoot) return native("unsafe-root-geometry");
  return { mode: facts.software ? "plate" : "root", reason: facts.software ? "software-fallback" : "page-region" };
}

let weSurfaceRuntime = null;
const WE_SURFACE_MARKER = "data-we-surface-runtime";
// #277：浮层实底底板**不得命中**的宿主面标记。与 WE_SURFACE_MARKER 分开是为了覆盖
// 「保留原生」档 —— 那一档 weSurfaceUnmark 会把 data-we-surface-runtime 摘掉，
// 于是仅靠 :not([data-we-surface-runtime]) 挡不住设置窗（实测：底色被从宿主面板色
// rgb(30,31,38) 改成插件的 --we-readability-base）。本标记只在**本插件认领的宿主面
// 是 ARIA 浮层**时打上，且不随 native 摘除 —— 它表达的是"这是宿主自己的对话框，
// 不是第三方浮层"，与玻璃开不开无关。
const WE_HOST_FLOATER_MARKER = "data-we-host-dialog";
// 不随模块实例重置的页面级登记：HMR / 行重挂后的新实例靠它找到并拆掉旧实例
// 的观察者与装饰根，避免同一 target 被多份 backdrop-filter 同时认领。
const WE_SURFACE_RUNTIME_KEY = "__dshWallpaperGlassSurfaceRuntime";

function weSurfaceOwnNode(node) {
  const el = node && (node.nodeType === 1 ? node : node.parentElement);
  return !!(el && el.closest && el.closest("[data-we-surface-root], style[data-plugin-css]"));
}

function weSurfaceUnmark(record) {
  // 摘除判值用本 record 实际写过的标记值（markValue），不能假定它等于 record.id：
  // 软渲档把 extra 面标记跟走为 "extra-fallback"，按 id 判会永久摘不掉。
  const markValue = record.markValue || record.id;
  if (record.marked && record.target.getAttribute(WE_SURFACE_MARKER) === markValue) {
    if (record.before === null) record.target.removeAttribute(WE_SURFACE_MARKER);
    else record.target.setAttribute(WE_SURFACE_MARKER, record.before);
  }
  for (const [node, before] of record.layouts || []) {
    if (node.getAttribute("data-we-layout-runtime") !== record.id) continue;
    if (before === null) node.removeAttribute("data-we-layout-runtime");
    else node.setAttribute("data-we-layout-runtime", before);
  }
  record.layouts = new Map();
  record.marked = false;
  if (record.plate) record.plate.remove();
  record.plate = null;
}

function weSurfaceGeometry(target, id, owned) {
  const win = target.ownerDocument.defaultView;
  const style = win.getComputedStyle(target), rect = target.getBoundingClientRect();
  // 合成微推（client.js nudgeGlassPlateLayers）会在宿主右栏面板上做两帧
  // translateZ(0)/will-change；这两帧内只对 target 自身豁免，否则 safeRoot 被自家
  // 微推判死，行切换后右栏退回纯色。data-we-nudge 由微推会话成对写入/摘除，不常驻。
  const nudged = typeof target.hasAttribute === "function" && target.hasAttribute("data-we-nudge");
  const visible = target.isConnected && rect.width > 0 && rect.height > 0
    && style.display !== "none" && style.visibility === "visible" && Number(style.opacity) > 0;
  const nativeBlur = [style.backdropFilter, style.webkitBackdropFilter].some(v => v && v !== "none");
  const root = target.ownerDocument.documentElement;
  const rootStyle = root && win.getComputedStyle(root);
  // 根平移同时作用于宿主与装饰叶；在共同坐标系内验界，不把哈气位移误判为越界。
  const translated = rootStyle && rootStyle.translate && rootStyle.translate !== "none";
  const origin = translated ? root.getBoundingClientRect() : { left: 0, top: 0 };
  const x = translated ? origin.left + (win.scrollX || 0) : 0;
  const y = translated ? origin.top + (win.scrollY || 0) : 0;
  let safeRoot = visible && rect.left >= x && rect.top >= y
    && rect.right <= x + win.innerWidth + 1 && rect.bottom <= y + win.innerHeight + 1;
  // 宿主明确声明的 push/fullscreen 才进入右栏安全几何路径；未知模式继续原生回退。
  if (id === "right-sidebar" && !['push', 'fullscreen'].includes(target.getAttribute("data-sidebar-right-panel"))) safeRoot = false;
  // ── 正在跑的有限动画 / 过渡 ≠ 不安全 ──────────────────────────────────────
  // 宿主开合右栏时在**整个 frame** 上做 `grid-template-columns` 过渡
  // （AppFrame.module.css：`.frame[data-animating]{transition:grid-template-columns …}`），
  // 而 frame 是左右两侧栏共同的祖先。旧判据把"祖先链上有任何 getAnimations()"当成
  // unsafeRoot ⇒ 动画期间两侧玻璃同时退回原生、底板被撤掉、动画结束才回来
  // （用户原话："侧边栏弹出时会出现丢失左右两侧的玻璃效果…只出现在过程中"）。
  // 口径改为：**有限**的动画/过渡 ⇒ 记录 moving，逐帧跟住载体几何（见 weSurfaceRefresh
  // 末尾的 follow 调度）；无限动画不跟（防常驻 rAF）、静态 transform 仍不安全。
  // 这条通用口径取代了本基线原先只认「该侧栏直接所属网格的列宽过渡 + html 纯 translate」
  // 的窄豁免：窄豁免只管放行，不管几何，过渡期间底板会停在起点；现在统一由 moving
  // 驱动 follow 循环，左栏（没有 data-rightbar-col 锚）也能一并覆盖。
  let moving = false;
  for (let el = target; el; el = el.parentElement) {
    if (!el.getAnimations) continue;
    const finite = el.getAnimations().filter((a) => {
      if (a.playState !== "running" && a.playState !== "pending") return false;
      const timing = a.effect && typeof a.effect.getComputedTiming === "function" ? a.effect.getComputedTiming() : null;
      return !timing || Number.isFinite(timing.endTime);
    });
    if (finite.length) { moving = true; break; }
  }
  for (let el = target; safeRoot && el; el = el.parentElement) {
    const cs = win.getComputedStyle(el);
    // 正在做**有限** transform 动画时才放行 transform（几何由 follow 循环跟住）；
    // 静态 / 无动画 / 无限旋转的 transform 仍按旧纪律回退原生（守卫有负对照）。
    const running = el.getAnimations
      ? el.getAnimations().filter((a) => a.playState === "running" || a.playState === "pending")
      : [];
    const transformMotion = running.some((a) => {
      const timing = a.effect && typeof a.effect.getComputedTiming === "function" ? a.effect.getComputedTiming() : null;
      if (timing && !Number.isFinite(timing.endTime)) return false;
      return a.transitionProperty === "transform"
        || (a.effect && typeof a.effect.getKeyframes === "function"
            && a.effect.getKeyframes().some((k) => k.transform !== undefined));
    });
    const ownNudge = nudged && el === target;
    if (Number(cs.opacity) < 1 || (cs.transform !== "none" && !transformMotion && !ownNudge) || cs.perspective !== "none"
      || cs.filter !== "none" || (cs.backdropFilter && cs.backdropFilter !== "none")
      || cs.isolation === "isolate" || cs.mixBlendMode !== "normal" || cs.contain !== "none"
      || (!ownNudge && /transform|filter|opacity|perspective|contain/.test(cs.willChange))
      // 根平移（哈气/抖动）同时作用于宿主与装饰叶，weSurfaceRefresh 会换算到叶本地坐标，
      // 因此根自身不算"静态 transform"；其余元素上的静态 transform 仍一律不安全。
      || [el === root ? "none" : cs.translate, cs.rotate, cs.scale].some(v => v && v !== "none")
      || el.closest('[role="dialog"], dialog, [aria-modal="true"]')) safeRoot = false;
    if (el !== target && (el.scrollTop || el.scrollLeft || /auto|scroll/.test(cs.overflow + cs.overflowX + cs.overflowY))) safeRoot = false;
    const clip = el.getBoundingClientRect();
    // 亚像素容差：`getBoundingClientRect()` 返回的是分数值，布局取整会让"贴合同一
    // 网格边缘"的两个盒子差出零点几像素。实测（DPR 1.25）宿主 AppFrame 右边缘 =
    // 1281.5999755859375、右栏面板右边缘 = 1281.6000366210938，相差 0.000061px；
    // 严格 `>` 于是把右栏判成"被祖先裁掉" ⇒ safeRoot 恒假 ⇒ 永不认领 ⇒ 右栏退回
    // `--we-panel-color` 实色（非全屏下玻璃丢失，且是确定性的、不会自愈）。
    // 视口边界那一条早就带了 +1 的同款容差；裁剪这一条此前漏了。取 0.5 CSS px：
    // 真被裁掉半像素以上才判不安全，浮点/取整噪声一律放过。
    const CLIP_EPSILON = 0.5;
    if (el !== target && /hidden|clip/.test(cs.overflow + cs.overflowX + cs.overflowY)
      && (rect.left < clip.left - CLIP_EPSILON || rect.top < clip.top - CLIP_EPSILON
        || rect.right > clip.right + CLIP_EPSILON || rect.bottom > clip.bottom + CLIP_EPSILON)) safeRoot = false;
  }
  const pseudo = ["extra", "settings-window", "declared"].includes(id) ? win.getComputedStyle(target, "::before") : null;
  return {
    visible, safeRoot, nativeBlur, rect, radius: style.borderRadius, moving,
    safeLocal: style.position !== "static" && style.zIndex !== "auto" && Number(style.opacity) === 1
      && style.filter === "none" && style.transform === "none" && style.isolation !== "isolate",
    occupied: !!(pseudo && pseudo.content !== "none" && pseudo.content !== "normal"
      && !(owned && pseudo.content === '\"\"')),
    preserve: !!target.closest("[data-we-surface-preserve]"),
  };
}

function weSurfaceCandidates(state) {
  const entries = new Map(), doc = state.doc;
  const add = (target, id, enabled) => {
    if (!entries.has(target) && !weSurfaceOwnNode(target)) entries.set(target, { target, id, enabled });
  };
  const left = doc.querySelectorAll('div:has(> [data-slot="sidebar"])');
  // 唯一宿主区域才可认领；双侧栏/嵌套未知布局不猜测。
  for (const target of left) add(target, "left-sidebar", left.length === 1 && state.selection.leftSidebarGlass === true);
  const right = doc.querySelectorAll("[data-sidebar-right-panel]");
  // ⚠️ 宿主会为**每个被保留的会话**各渲染一份右栏面板（ui-sidebar-right 的 RightbarRoot
  //    按 useViews() 逐会话挂一份 SidebarPanel，非当前会话那份由 `.session[hidden]` 包住），
  //    所以 DOM 里常年有多份 [data-sidebar-right-panel]，但**真正参与布局的只有当前会话那份**。
  //    旧判据数的是 NodeList 长度 ⇒ 用户只要开过第二个会话的右栏，接管资格就永远为假，
  //    右侧栏整块退回原生不透明底（"我的右侧侧边栏玻璃效果被改没了"）。
  //    判据改成"在布局里的面板中，**展开的**恰好一份"：hidden 子树的兄弟不参与，
  //    可见但未展开的其他面板（fullscreen/push 或旧会话残留）也不否定当前展开的那份。
  const rightLive = [...right].filter((panel) => !panel.closest("[hidden]") && panel.getClientRects().length > 0);
  // 宿主可能同时保留**不止一份在布局里的**面板（未隐藏的旧会话 / fullscreen 与 push 并存），
  // 但真正展开的只有一份：判据看「open 的面板恰好一份」，不要被另一份可见但收起的面板否掉
  // （旧写法数 rightLive.length===1 会整块退回原生纯色）。
  const rightOpen = rightLive.filter((panel) => panel.hasAttribute("data-sidebar-right-open"));
  for (const target of right) {
    const sole = rightOpen.length === 1 && rightOpen[0] === target;
    add(target, "right-sidebar", sole && state.selection.sidebarGlass === true);
  }
  for (const target of doc.querySelectorAll('[role="dialog"]:has([data-slot="settings.section"])')) {
    add(target, "settings-window", doc.body.hasAttribute("data-we-glass-window"));
    // #277：这是**宿主自己的**对话框，不是第三方浮层 ⇒ 浮层实底底板规则必须让路。
    // 用独立标记而不是 data-we-surface-runtime：后者在「保留原生」档会被摘掉
    // （见 WE_HOST_FLOATER_MARKER 处的说明），而这条排除在全部档位下都要成立。
    target.setAttribute(WE_HOST_FLOATER_MARKER, "settings-window");
  }
  for (const target of doc.querySelectorAll('[data-we-surface="v1"]')) add(target, "declared", true);
  // ⚠️ 阅读文件页（`[data-document-preview]`，宿主 dsh-client-ui-sidebar-documentpreview 的
  // TextPreview 根节点）也是**内容面**：它此前不在这一组里 ⇒ 「内容面透明度 / 内容面底色」
  // 在那一页从来不生效（用户以为设置被删了）。
  // 与上面同一条纪律：只认在布局里的面板，hidden 子树里保留的旧会话不参与。
  for (const panel of rightLive) {
    if (!panel.hasAttribute("data-sidebar-right-open")) continue;
    for (const target of panel.querySelectorAll(".cm-editor,.xterm,[data-document-preview]"))
      add(target, "content", state.selection.sidebarGlass === true);
  }
  for (const selector of state.selectors) {
    for (const target of doc.querySelectorAll(selector)) {
      if (entries.size >= 32) break;
      if (target !== doc.body && target !== doc.documentElement) add(target, "extra", true);
    }
  }
  return entries;
}

function weSurfaceLayouts(record) {
  for (const [node, before] of record.layouts || []) {
    if (node.getAttribute("data-we-layout-runtime") === record.id) {
      if (before === null) node.removeAttribute("data-we-layout-runtime");
      else node.setAttribute("data-we-layout-runtime", before);
    }
  }
  record.layouts = new Map();
  const selector = record.id === "settings-window" ? '[data-slot="settings.section"]' : '[data-we-surface-layout]';
  for (const node of record.target.querySelectorAll(selector)) {
    if (node.closest('[data-we-surface-preserve]')) continue;
    const owner = node.closest('[data-we-surface="v1"]');
    if (record.id === "declared" ? owner !== record.target : owner !== null) continue;
    const before = node.getAttribute("data-we-layout-runtime");
    if (before !== null) continue;
    record.layouts.set(node, before);
    node.setAttribute("data-we-layout-runtime", record.id);
  }
}

function weSurfaceModalState(state) {
  const blocked = [...state.doc.querySelectorAll('[aria-modal="true"],dialog[open],[role="alertdialog"]')].some(node => {
    if (node.closest('.we-picker__modal,.we-preset-intro,[data-we-owned-modal]')) return false;
    const style = state.win.getComputedStyle(node), rect = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility === "visible" && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
  });
  const body = state.doc.body;
  if (blocked && !body.hasAttribute("data-we-modal-blocked")) { body.setAttribute("data-we-modal-blocked", ""); state.modalOwned = true; }
  if (!blocked && state.modalOwned) { body.removeAttribute("data-we-modal-blocked"); state.modalOwned = false; }
}

function weSurfaceRefresh(state) {
  if (state !== weSurfaceRuntime || state.doc.hidden) return;
  if (!state.doc.body.hasAttribute("data-we-glass-page")) { disposeGlassSurfaces(); return; }
  // 装饰根可能被另一份模块实例的 prune/清理摘掉；记录表里的 plate 还会指向断开的
  // 旧节点，必须把 root+plate 一起作废，下面才会重建（marker 保留即可重新挂）。
  if (state.root && !state.root.isConnected) {
    state.root = null;
    for (const record of state.records.values()) record.plate = null;
  }
  weSurfaceModalState(state);
  const entries = weSurfaceCandidates(state), win = state.win;
  for (const [target, record] of state.records) {
    if (!entries.has(target)) { weSurfaceUnmark(record); state.records.delete(target); }
  }
  // ── 读/写分相 ───────────────────────────────────────────────────────────
  // `weSurfaceGeometry` 每轮要沿祖先链做 getComputedStyle + 对目标 getBoundingClientRect；
  // 原来紧跟着在同一个循环里写 marker / plate 样式 ⇒ 下一轮读又被自己的写强制布局。
  // trace 2026-10-30：启动期 6 次 sync 的几何测量全是这种「读—写—读」抖动。
  // 先把失配记录摘掉、把所有 target 的几何一次读完（本段不做任何 DOM 写），
  // 写完的循环再统一写 —— 读阶段不会被自己的写打断。
  for (const [target, entry] of entries) {
    const record = state.records.get(target);
    if (record && record.id !== entry.id) { weSurfaceUnmark(record); state.records.delete(target); }
  }
  const factsByTarget = new Map();
  for (const [target, entry] of entries) {
    let record = state.records.get(target);
    if (!record) {
      record = { ...entry, before: target.getAttribute(WE_SURFACE_MARKER), marked: false, plate: null };
      state.records.set(target, record);
    }
    factsByTarget.set(target, weSurfaceGeometry(target, entry.id, record.marked));
  }
  const observed = new Set();
  let moving = false;
  for (const [target, entry] of entries) {
    const record = state.records.get(target);
    const facts = factsByTarget.get(target);
    if (facts.moving) moving = true;
    facts.enabled = entry.enabled;
    facts.software = state.doc.body.hasAttribute("data-we-glass-fallback")
      || !(win.CSS && (win.CSS.supports("backdrop-filter", "blur(1px)") || win.CSS.supports("-webkit-backdrop-filter", "blur(1px)")));
    const resolved = record.before !== null && !record.marked ? { mode: "native", reason: "foreign-owner" }
      : weResolveSurface(entry.id, state.selection, facts);
    Object.assign(record, resolved);
    if (resolved.mode === "native") weSurfaceUnmark(record);
    else {
      // 标记值跟走 resolver（t9-001）：软渲档把 extra 面标记从 "extra" 切到
      // "extra-fallback"，解除时切回；weSurfaceUnmark 按 record.markValue 判摘。
      // 不跟走时软渲专属 CSS 规则（:where([data-we-surface-runtime="extra-fallback"])）
      // 永不匹配，无霜不透明可读底色落空。
      const markValue = resolved.mode === "extra-fallback" ? "extra-fallback" : entry.id;
      if (!record.marked) {
        target.setAttribute(WE_SURFACE_MARKER, markValue);
        record.markValue = markValue;
        record.marked = true;
      } else if (target.getAttribute(WE_SURFACE_MARKER) !== markValue) {
        target.setAttribute(WE_SURFACE_MARKER, markValue);
        record.markValue = markValue;
      }
      if (entry.id === "settings-window" || entry.id === "declared") weSurfaceLayouts(record);
      // extra/extra-fallback 只借用目标原生定位/层叠上下文的 ::before，不建 plate
      // （契约：不为其制造上下文/节点；plate 属于页面区域根叶形态）。
      if (resolved.mode !== "local" && resolved.mode !== "content" && entry.id !== "extra") {
        if (!state.root) {
          state.root = state.doc.createElement("div");
          state.root.setAttribute("data-we-surface-root", "v1");
          state.root.setAttribute("aria-hidden", "true");
          state.root.setAttribute("inert", "");
          state.doc.body.appendChild(state.root);
        }
        if (!record.plate) {
          record.plate = state.doc.createElement("div");
          record.plate.setAttribute("data-we-surface-plate", entry.id);
          state.root.appendChild(record.plate);
        }
        const r = facts.rect, origin = state.root.getBoundingClientRect();
        // 共同根平移已经作用于装饰叶，viewport 测量须换算到该叶的本地坐标。
        // 只维护几何属性；cssText 会清掉联动持有的 clip-path，造成展开中漏底。
        const geometry = { left: (r.left - origin.left) + "px", top: (r.top - origin.top) + "px",
          width: r.width + "px", height: r.height + "px", borderRadius: facts.radius };
        for (const [name, value] of Object.entries(geometry)) {
          if (record.plate.style[name] !== value) record.plate.style[name] = value;
        }
      }
    }
    for (let el = target; el; el = el.parentElement) observed.add(el);
  }
  for (const el of state.observed) if (!observed.has(el)) state.resize.unobserve(el);
  for (const el of observed) if (!state.observed.has(el)) state.resize.observe(el);
  state.observed = observed;
  if (state.root && !state.root.children.length) { state.root.remove(); state.root = null; }
  // ── 动画跟随（宿主开合侧栏时的 grid-template-columns 过渡）──────────────────
  // 过渡期间目标的 border-box 尺寸可能不变、只是位置在动（右栏贴着右边缘，
  // 轨道加宽时它整体平移）⇒ ResizeObserver 不会触发。既然已经决定"有限动画期间
  // 继续接管"，就必须逐帧重算载体矩形，否则底板会停在动画开始时的位置。
  // ⚠️ 只在真有 running/pending 的**有限**动画时才续帧；静止后立即停（守卫
  //    「静止不持续安排帧扫描」有断言），并有 MAX_FOLLOW_FRAMES 兜底防死循环。
  state.moving = moving;
  if (moving && state.followFrames < 600) {
    state.followFrames += 1;
    state.schedule();
  } else {
    state.followFrames = 0;
  }
  // 每次 refresh 都收口：旧实例/旧轮次留下的根与 plate 一律只留当前 state.root
  // 那一份。多层同几何 plate 的 backdrop-filter 会叠加 saturate/brightness/contrast，
  // 观感就是“右栏对应位置壁纸对比度/饱和度异常”。
  pruneGlassSurfaces();
}

/** 只保留当前 state.root 及其 plate；顺手清掉上一版微推泄漏的、没有 data-we-nudge
 *  归属的 translateZ(0)+will-change 内联样式（否则 safeRoot 会被永远判死）。 */
function pruneGlassSurfaces() {
  if (typeof document === "undefined" || !document.body) return;
  // keep 必须取**页面级登记**里的 owner：HMR/行重挂后的旧实例也被调用方（探测/微推）
  // 调进 prune，它的模块变量 weSurfaceRuntime 可能是 null；若按模块变量算 keep，
  // 旧实例会把当前实例的装饰根当孤儿删掉，留下“有 marker 但没有 plate”的纯色右栏。
  const shared = document[WE_SURFACE_RUNTIME_KEY];
  const owner = shared && shared.doc === document ? shared : weSurfaceRuntime;
  const keep = owner && owner.root && owner.root.isConnected ? owner.root : null;
  for (const node of document.querySelectorAll("[data-we-surface-root]")) {
    if (node !== keep) node.remove();
  }
  for (const plate of document.querySelectorAll("[data-we-surface-plate]")) {
    if (keep === null || !keep.contains(plate)) plate.remove();
  }
  for (const el of document.querySelectorAll("[data-sidebar-right-panel]")) {
    if (el.hasAttribute("data-we-nudge")) continue;
    const style = el.style;
    if (/^translateZ\(0(?:px)?\)$/i.test(style.transform) && style.willChange === "transform") {
      style.removeProperty("transform");
      style.removeProperty("will-change");
    }
  }
}

function syncGlassSurfaces(selection) {
  if (typeof document === "undefined" || !document.body || !document.defaultView) return;
  const win = document.defaultView;
  // 缺少可验证的几何能力就保留原生，不走定时轮询。
  if (!win.ResizeObserver || !win.MutationObserver || !win.requestAnimationFrame) return;
  if (!document.body.hasAttribute("data-we-glass-page")) { disposeGlassSurfaces(); return; }
  pruneGlassSurfaces();
  // 同一页面可能因为 HMR / 行重挂而出现**多份本模块实例**：每份都有自己的
  // weSurfaceRuntime。仅靠模块内变量清不掉其他实例的根，backdrop-filter 会一层层
  // 叠加（实测 9 个同几何右栏 plate ⇒ 饱和度/对比度爆表）。共享 document 上的
  // 运行时登记 + 每轮 prune 是跨实例的唯一收口。
  const shared = document[WE_SURFACE_RUNTIME_KEY];
  if (shared !== undefined && shared !== weSurfaceRuntime) {
    if (shared && shared.doc === document) {
      try { disposeSurfaceState(shared); } catch { /* 下一轮 prune 兜底 */ }
    } else {
      try { delete document[WE_SURFACE_RUNTIME_KEY]; } catch { /* ignore */ }
    }
  }
  let state = weSurfaceRuntime;
  if (state && state.doc !== document) { disposeGlassSurfaces(); state = null; }
  if (!state) {
    // 行级开关不会重载页面：上个实例/上一轮状态若留下装饰根或运行标记，先清掉，
    // 否则新一轮会叠出第二层 backdrop-filter 底板（右栏最明显，刷新才恢复）。
    for (const node of document.querySelectorAll('[data-we-surface-root]')) node.remove();
    for (const node of document.querySelectorAll('[data-we-surface-runtime]')) node.removeAttribute('data-we-surface-runtime');
    for (const node of document.querySelectorAll('[data-we-host-dialog]')) node.removeAttribute('data-we-host-dialog');
    for (const node of document.querySelectorAll('[data-we-layout-runtime]')) node.removeAttribute('data-we-layout-runtime');
    state = { doc: document, win, selection, selectors: [], records: new Map(), observed: new Set(), root: null, frame: null, moving: false, followFrames: 0, listeners: [] };
    weSurfaceRuntime = state;
    try { document[WE_SURFACE_RUNTIME_KEY] = state; } catch { /* ignore */ }
    state.schedule = () => {
      if (state !== weSurfaceRuntime || state.doc.hidden || state.frame !== null) return;
      state.frame = win.requestAnimationFrame(() => { state.frame = null; weSurfaceRefresh(state); });
    };
    state.resize = new win.ResizeObserver(state.schedule);
    state.mutations = new win.MutationObserver(changes => {
      const selectors = ['div:has(> [data-slot="sidebar"])', '[data-sidebar-right-panel]', '[data-we-surface]', '[data-we-surface-layout]', '[data-we-surface-root]', '[data-slot="settings.section"]', '[role="dialog"]', '[aria-modal]', 'dialog', '[role="alertdialog"]', '.cm-editor', '.xterm', ...state.selectors].join(",");
      // 装饰根即使是本插件节点也要能触发刷新：另一份模块实例刚插进来的孤儿根
      // 必须被 prune 掉，否则多层 backdrop-filter 会叠加成“滤镜爆表”。
      const relevant = node => node && node.nodeType === 1
        && (node.matches('[data-we-surface-root]') || (!weSurfaceOwnNode(node)
          && (node.matches(selectors) || node.querySelector(selectors))));
      for (const change of changes) {
        if (weSurfaceOwnNode(change.target)) continue;
        if (change.type === "childList") {
          if ([...change.addedNodes, ...change.removedNodes].some(relevant)) { state.schedule(); break; }
        } else if (change.target === state.doc.body || change.target === state.doc.documentElement
          || change.attributeName === "data-we-surface-preserve" || change.attributeName === "data-we-surface-layout"
          || [...state.records.keys()].some(el => el === change.target || change.target.contains(el))
          || change.target.matches(selectors)) { state.schedule(); break; }
      }
    });
    state.mutations.observe(document.documentElement, { subtree: true, childList: true, attributes: true,
      attributeFilter: ["class", "style", "hidden", "open", "data-sidebar-right-open", "data-sidebar-right-panel",
        "data-we-surface", "data-we-surface-layout", "data-we-surface-preserve", "role", "aria-modal", "data-we-glass-window", "data-we-glass-page", "data-we-glass-fallback", "data-ds-dark-theme", "data-dsh-skin"] });
    const listen = (target, name, callback, options) => {
      target.addEventListener(name, callback, options); state.listeners.push(() => target.removeEventListener(name, callback, options));
    };
    for (const event of ["resize", "scroll", "transitionrun", "transitionend", "animationstart", "animationend"])
      listen(win, event, state.schedule, { capture: true, passive: true });
    listen(document, "visibilitychange", () => {
      if (document.hidden) {
        if (state.frame !== null) win.cancelAnimationFrame(state.frame);
        state.frame = null;
        for (const record of state.records.values()) weSurfaceUnmark(record);
        state.resize.disconnect(); state.observed.clear();
        if (state.root) { state.root.remove(); state.root = null; }
      } else state.schedule();
    });
  }
  state.selection = selection || {};
  const list = typeof sanitizeExtraGlassSelectors === "function" ? sanitizeExtraGlassSelectors(state.selection.extraGlassSelectors) : "";
  state.selectors = (list ? list.split(", ") : []).filter(selector => {
    try { document.querySelector(selector); return true; } catch { return false; }
  });
  if (state.frame !== null) { win.cancelAnimationFrame(state.frame); state.frame = null; }
  weSurfaceRefresh(state);
}

function disposeGlassSurfaces() {
  const state = weSurfaceRuntime;
  if (state) {
    weSurfaceRuntime = null;
    disposeSurfaceState(state);
  }
  // state 缺失也要兜底扫一遍：HMR/行重挂可能留下另一份实例的根与标记，
  // 不扫掉就会在下次启用时叠成多层滤镜。
  if (typeof document !== "undefined" && document.body) {
    for (const node of document.querySelectorAll("[data-we-surface-root]")) node.remove();
    for (const node of document.querySelectorAll(`[${WE_SURFACE_MARKER}]`)) node.removeAttribute(WE_SURFACE_MARKER);
    for (const node of document.querySelectorAll(`[${WE_HOST_FLOATER_MARKER}]`)) node.removeAttribute(WE_HOST_FLOATER_MARKER);
    for (const node of document.querySelectorAll("[data-we-layout-runtime]")) node.removeAttribute("data-we-layout-runtime");
    try { delete document[WE_SURFACE_RUNTIME_KEY]; } catch { /* ignore */ }
  }
}

function disposeSurfaceState(state) {
  if (!state) return;
  try { if (state.doc[WE_SURFACE_RUNTIME_KEY] === state) delete state.doc[WE_SURFACE_RUNTIME_KEY]; } catch { /* ignore */ }
  if (state.frame !== null && state.win) state.win.cancelAnimationFrame(state.frame);
  try { state.mutations.disconnect(); } catch { /* ignore */ }
  try { state.resize.disconnect(); } catch { /* ignore */ }
  if (state.modalOwned) state.doc.body.removeAttribute("data-we-modal-blocked");
  for (const stop of state.listeners) stop();
  for (const record of state.records.values()) weSurfaceUnmark(record);
  if (state.root) state.root.remove();
  // 兜底：记录表与 DOM 万一不同步（行级开关不重载页面，旧实例可能先被清空状态），
  // 仍要把运行标记与装饰根全部摘掉；否则回注样式后会多出一层旧滤镜。
  for (const node of state.doc.querySelectorAll('[data-we-surface-root]')) node.remove();
  for (const node of state.doc.querySelectorAll(`[${WE_SURFACE_MARKER}]`)) node.removeAttribute(WE_SURFACE_MARKER);
  for (const node of state.doc.querySelectorAll('[data-we-layout-runtime]')) node.removeAttribute('data-we-layout-runtime');
  state.records.clear(); state.observed.clear();
}

/** 高级兼容信息的数据源：不含宿主文本、DOM 引用或任意样式值。 */
function weGlassSurfaceStatus() {
  return weSurfaceRuntime ? [...weSurfaceRuntime.records.values()].map(({ id, mode, reason }) => ({ id, mode, reason })) : [];
}

export { weResolveSurface, syncGlassSurfaces, disposeGlassSurfaces, pruneGlassSurfaces, weGlassSurfaceStatus };
