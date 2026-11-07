/** 客户端主页面吉祥物组件（RopeDock，从 `src/client.js` 按族搬出，函数体逐字未改）。
 *
 * 契约：
 *   1) 本文件不 import —— 构建期由 scripts/build-client.mjs 内联在正文之前，与正文同处一个扁平作用域；
 *      函数体引用的 ROPE_FORMS / ropeArtOf / readRopePos / ropeClamp / Sidebar 桥（ropeDrawerControl 等）
 *      / QuickPanel / UpdateNotice / weT / useWeLocale 等自由名由正文与其它内联模块提供。
 *   2) 搬移只改了"声明住哪"：本文件里每段文本与拆前 src/client.js 逐字节相同。
 *   3) 顶层只有组件声明，无模块级可变量；抽屉桥的注册与撤销仍在组件内 effect 里成对完成。
 */
function RopeDock() {
  useWeLocale(); // 语言切换 → 吉祥物/抽屉里的文案跟着换（见 src/i18n/i18n.js）
  const sel = useStore();
  const hidden = !sel.ropeShown;
  // 立绘：自定义优先（用户导入的那张），否则当前形态的内置图（同一条解析见 ropeArtOf）。
  const art = ropeArtOf(sel);
  const scale = clampNum(sel.ropeScale, ROPE_SCALE_MIN, ROPE_SCALE_MAX, 1);
  // The artwork's base box scaled by the user's size setting (rounded to px);
  // written inline so the .we-rope CSS box follows it and ropeSize() reads it.
  const box = { w: Math.round(art.w * scale), h: Math.round(art.h * scale) };
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState(() => readRopePos(box));
  const ropeRef = React.useRef(null);
  const panelRef = React.useRef(null);
  const dragRef = React.useRef(null);

  const ropeSize = () => {
    const el = ropeRef.current;
    if (el && el.offsetWidth > 0) return { w: el.offsetWidth, h: el.offsetHeight };
    return box;
  };
  const clampX = (x) => {
    const w = (typeof window !== "undefined" && window.innerWidth) || 1280;
    return ropeClamp(x, ROPE_VIEW_MARGIN, Math.max(ROPE_VIEW_MARGIN, w - ropeSize().w - ROPE_VIEW_MARGIN));
  };
  const clampY = (y) => {
    const h = (typeof window !== "undefined" && window.innerHeight) || 800;
    return ropeClamp(y, ROPE_EDGE_INSET, Math.max(ROPE_EDGE_INSET, h - ropeSize().h - ROPE_VIEW_MARGIN));
  };
  // Live drag preview on the panel: p ∈ [0,1], 1 = fully open. The panel is a
  // right-edge drawer — it slides in from the RIGHT (translateX) as it opens.
  // Written as inline styles (compositor-only props) straight to the DOM —
  // bypassing React state keeps QuickPanel out of the per-pointermove render path.
  const applyPreview = (p) => {
    const el = panelRef.current;
    if (!el) return;
    const q = ropeClamp(p, 0, 1);
    // Follow the pull with a gentle, regulated glide (a set "speed") rather
    // than a 1:1 snap: the drawer eases after the hand (weighty, not twitchy).
    // On commit the inline transition is cleared so the slow open/close run
    // takes over from wherever the hand left the panel.
    el.style.transition = "transform 440ms cubic-bezier(0.25, 0.8, 0.25, 1), opacity 320ms ease";
    el.style.visibility = "visible";
    el.style.opacity = String(q);
    el.style.transform = "translateX(" + ((1 - q) * 102).toFixed(2) + "%)";
  };
  const clearPreview = () => {
    const el = panelRef.current;
    if (!el) return;
    el.style.transition = "";
    el.style.visibility = "";
    el.style.opacity = "";
    el.style.transform = "";
  };

  const onRopePointerDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const el = ropeRef.current;
    if (!el || dragRef.current) return;
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    dragRef.current = {
      id: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      baseX: pos.x, baseY: pos.y,
      lastX: pos.x, lastY: pos.y,
      moved: false,
    };
    el.classList.add("we-rope--dragging");   // kill the settle transition while following the finger
    el.classList.remove("we-rope--settle");
    e.preventDefault();
  };
  const onRopePointerMove = (e) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && dx * dx + dy * dy < 9) return; // dead zone: treat jitter as a click
    if (!d.moved) { d.moved = true; if (sidebarRightMode() === "official") { try { petLink.performer.onGrab(); } catch { /* 不影响原生手势。 */ } } }
    d.lastX = clampX(d.baseX + dx);
    d.lastY = clampY(d.baseY + dy);
    const el = ropeRef.current;
    if (el) { el.style.left = d.lastX + "px"; el.style.top = d.lastY + "px"; }
    // Follow-hand preview: pull down opens (when closed), push up closes (when open).
    // 官方态没有抽屉可预览（面板在右侧栏里）—— 只跟手移动吉祥物，不出抽屉影子。
    if (sidebarRightMode() === "official") { clearPreview(); try { petLink.performer.onPull(Math.abs(dy) / ROPE_OPEN_THRESHOLD); } catch { /* 不影响拖动。 */ } return; }
    if (!open && dy > ROPE_PREVIEW_START) {
      applyPreview((dy - ROPE_PREVIEW_START) / (ROPE_OPEN_THRESHOLD - ROPE_PREVIEW_START));
    } else if (open && dy < -ROPE_PREVIEW_START) {
      applyPreview(1 - (-dy - ROPE_PREVIEW_START) / (ROPE_OPEN_THRESHOLD - ROPE_PREVIEW_START));
    } else {
      clearPreview();
    }
  };
  // 吉祥物触发的统一入口（click / 手势 / 快捷键共用一组模块级开关，见
  // src/sidebar-right.js 的 wallSidebarToggle/Open/Close）：官方态 → 控制器切换
  // 右侧栏（展开且正显示「壁纸」⇒ 收起；否则展开并聚焦本 tab）；抽屉态 → 开关抽屉。
  const finishDrag = (clientX, clientY, canceled) => {
    const d = dragRef.current;
    const el = ropeRef.current;
    dragRef.current = null;
    if (!el) return;
    if (d) { try { el.releasePointerCapture(d.id); } catch { /* 捕获可能已归还。 */ } }
    el.classList.remove("we-rope--dragging");
    el.classList.add("we-rope--settle");
    if (d) {
      const dy = clientY - d.startY;
      // 点击 = 开/关切换；下拉 ≥ 阈值 = 开；上推 ≥ 阈值 = 关（官方态收起同样由此统一）。
      if (sidebarRightMode() !== "official") {
        if (!canceled && !d.moved) wallSidebarToggle();
      } else if (!canceled && !d.moved) {
        try { petLink.mascot.tap(); } catch { wallSidebarToggle(); }
      }
      if (!canceled && d.moved && dy >= ROPE_OPEN_THRESHOLD) wallSidebarOpen();
      else if (!canceled && d.moved && dy <= -ROPE_OPEN_THRESHOLD) wallSidebarClose();
    }
    clearPreview(); // committed class transitions continue smoothly from the inline value
    // Snap to the TOP edge; Y resets to the top inset while X stays wherever
    // the user dragged it (clamped so the rope is never lost off-screen). The
    // rope is a pull-cord that hangs from the top, so it always returns there.
    const x = d ? d.lastX : pos.x;
    const next = { x: clampX(x), y: ROPE_EDGE_INSET };
    // Write the snapped coords imperatively TOO: if they happen to equal the
    // previous React-managed values, React would skip the style diff and the
    // rope would stay wherever the finger left it instead of settling.
    if (el) { el.style.left = next.x + "px"; el.style.top = next.y + "px"; }
    setPos(next);
    try { localStorage.setItem(ROPE_POS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const onRopeKeyDown = (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (sidebarRightMode() !== "official") wallSidebarToggle(); else { try { petLink.mascot.tap(); } catch { wallSidebarToggle(); } } }
  };

  // ESC anywhere closes the panel — unless the picker modal is open. The
  // modal's handler sits on WINDOW capture and calls stopPropagation, which
  // halts the event BEFORE it reaches this DOCUMENT-level capture listener,
  // so ESC closes the modal first and the panel survives. When no modal is
  // open the event arrives here and closes the panel.
  React.useEffect(() => {
    if (typeof document === "undefined" || !document.addEventListener) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape" || selection.pickerOpen) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  React.useEffect(() => petLink.mascot.registerGesture(() => { const d = dragRef.current; if (d) finishDrag(d.startX, d.startY, true); }), []);

  // Keep the rope inside the viewport when the window shrinks/grows.
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.addEventListener) return undefined;
    const onResize = () => setPos((p) => ({ x: clampX(p.x), y: clampY(p.y) }));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // When the mascot FORM or SIZE actually changes (bigger box), re-clamp the
  // position so a larger form (e.g. whale) never ends up half off-screen. The
  // ref skips the FIRST run (the box is pristine on mount), so the default
  // path adds no extra setPos/render/paint in the kiosk window — keeping the
  // markup identical to the build that shipped the lazy-mounted panel.
  const lastBoxRef = React.useRef(null);
  React.useEffect(() => {
    const last = lastBoxRef.current;
    lastBoxRef.current = box;
    if (last && (last.w !== box.w || last.h !== box.h)) {
      setPos((p) => ({ x: clampX(p.x), y: clampY(p.y) }));
    }
    // 依赖数组刻意收窄成 box.w / box.h：只有形态尺寸真的变了才需要重新钳位
    // （上面那段"首次运行不做事"的纪律靠它成立）。clampX / clampY / setPos 是稳定引用，
    // 补进依赖数组只会让这个 effect 每次渲染都白跑一遍 setPos。
  }, [box.w, box.h]);

  // Hidden ⇒ 抽屉必须关上（吉祥物没了，它的面板入口也没了）。
  React.useEffect(() => {
    if (hidden) setOpen(false);
  }, [open, hidden]);

  // 模块桥（src/sidebar-right.js 的 ropeDrawerControl）：抽屉的三个动作注册给
  // 快捷键与统一开关使用 —— 组件 state 只能由组件自己改。吉祥物隐藏时撤销注册
  // （此时抽屉开不出来，快捷键 resolve 走 pass 不吞键）；卸载时同样撤销。
  React.useEffect(() => {
    if (hidden) { ropeDrawerControl = null; return undefined; }
    ropeDrawerControl = {
      toggle: () => setOpen((o) => !o),
      open: () => setOpen(true),
      close: () => setOpen(false),
    };
    return () => { ropeDrawerControl = null; };
  }, [hidden]);

  const petOfficialMode = sidebarRightMode() === "official";
  // 只接管过渡时序，不改宿主列宽值；新版须同时控制外层 grid 与 panel 内的 DockKit。
  const officialPull = {
    saved: null,
    savedOverflow: null,
    savedFrame: null,
    savedSurface: null,
    savedTransition: null,
    savedPriority: "",
    motionRun: null,
    // 临时现场诊断：最多24组，不采文本/URL/会话标识。定位完成后移除。
    traceLeft: 24,
    trace(stage, target, progress) {
      if (officialPull.traceLeft <= 0 || typeof apiPostJson !== "function") return;
      officialPull.traceLeft--;
      try {
        const panel = target && target.surface;
        const round = value => Number.isFinite(value) ? Math.round(value) : null;
        const rectOf = node => {
          if (!node || typeof node.getBoundingClientRect !== "function") return null;
          const r = node.getBoundingClientRect();
          return [round(r.left), round(r.top), round(r.width), round(r.height)];
        };
        const clipOf = node => node && node.style ? node.style.getPropertyValue("clip-path") : "";
        const record = panel && typeof weSurfaceRuntime !== "undefined" && weSurfaceRuntime
          ? weSurfaceRuntime.records.get(panel) : null;
        const docks = panel ? Array.from(panel.querySelectorAll('[data-dockkit-host="dock"], [data-dockkit-empty]')).slice(0, 3) : [];
        const data = { s: stage, q: progress, m: !!(target && target.modern),
          o: !!(panel && panel.hasAttribute("data-sidebar-right-open")), p: rectOf(panel), c: clipOf(panel),
          d: docks.map(node => [...rectOf(node), !!(node.closest && node.closest('[hidden], [aria-hidden="true"]'))]),
          g: record ? rectOf(record.plate) : null, gc: record ? clipOf(record.plate) : "" };
        const detail = JSON.stringify(data);
        if (detail.length <= 300) apiPostJson("/client-diag", {
          event: "sidebar-paint-v4", type: "sidebar-motion", detail,
        }, { keepalive: true }).catch(() => {});
        if (target && target.frame && typeof getComputedStyle === "function") {
          const frame = target.frame, style = getComputedStyle(frame);
          const column = panel && panel.closest("[data-rightbar-col]");
          const animations = typeof frame.getAnimations === "function" ? frame.getAnimations() : [];
          const data = { s: stage, q: progress, f: rectOf(frame), c: rectOf(column),
            g: style.gridTemplateColumns, d: style.transitionDuration,
            v: style.getPropertyValue("--ds-transition-duration-slow"),
            a: animations.filter(animation => animation.effect?.target === frame).slice(0, 2).map(animation => [
              animation.transitionProperty || "waapi", round(animation.effect?.getTiming?.().duration),
              round(animation.currentTime), animation.playState,
            ]) };
          const detail = JSON.stringify(data);
          if (detail.length <= 300) apiPostJson("/client-diag", {
            event: "sidebar-grid-v6", type: "sidebar-motion", detail,
          }, { keepalive: true }).catch(() => {});
        }
        if (stage === "moving" && (progress === 0 || progress === 1)
          && panel && typeof document.elementsFromPoint === "function") {
          const r = panel.getBoundingClientRect();
          const x = Math.max(0, r.left + r.width * .1), y = Math.max(0, r.top + r.height * .9);
          const layers = document.elementsFromPoint(x, y).slice(0, 3).map(node => {
            const style = getComputedStyle(node), before = getComputedStyle(node, "::before");
            return [String(node.tagName || "").toLowerCase(), String(node.className || "").slice(0, 42),
              style.backgroundColor, before.content !== "none" ? before.backgroundColor : ""];
          });
          const data = { q: progress, x: round(x), y: round(y), e: layers };
          while (JSON.stringify(data).length > 300 && data.e.length) data.e.pop();
          apiPostJson("/client-diag", { event: "sidebar-layers-v5", type: "sidebar-motion", detail: JSON.stringify(data) },
            { keepalive: true }).catch(() => {});
        }
      } catch { /* 诊断失败不影响动画与宿主 */ }
    },
    motionElements(panel, dividers = false) {
      const selector = '[data-dockkit-host="dock"], [data-dockkit-empty]'
        + (dividers ? ', [data-dockkit-divider]' : '');
      return Array.from(panel.querySelectorAll(selector)).filter(node => {
        if (node.isConnected === false || (typeof node.closest === "function"
          && node.closest('[hidden], [aria-hidden="true"]'))) return false;
        if (typeof node.getBoundingClientRect === "function") {
          const rect = node.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
        }
        if (typeof getComputedStyle === "function") {
          const style = getComputedStyle(node);
          if (style.display === "none" || style.visibility === "hidden") return false;
        }
        return true;
      });
    },
    armMotion(target, ms, expanded) {
      if (officialPull.motionRun) officialPull.motionRun.cancel();
      if (!target.modern || typeof MutationObserver !== "function") return;
      const panel = target.surface;
      const wasOpen = typeof panel.hasAttribute === "function" ? panel.hasAttribute("data-sidebar-right-open") : null;
      if (wasOpen === expanded) return;
      const animations = new Set(), seen = new Set(), clips = new Map();
      let disposed = false, frameId = null, reached = false, tracePhase = -1, tracedWait = false;
      const traceStart = Date.now();
      const clip = (node, inset) => {
        if (!node || !node.style) return;
        if (!clips.has(node)) clips.set(node, {
          before: node.style.getPropertyValue("clip-path"),
          priority: typeof node.style.getPropertyPriority === "function" ? node.style.getPropertyPriority("clip-path") : "",
          written: null,
        });
        const record = clips.get(node), value = "inset(0px 0px 0px " + inset + "px)";
        if (record.inset !== inset || node.style.getPropertyValue("clip-path") !== record.written) {
          node.style.setProperty("clip-path", value);
          record.written = node.style.getPropertyValue("clip-path");
          record.inset = inset;
        }
      };
      const syncClip = initial => {
        const rect = panel.getBoundingClientRect();
        if (!(rect.width > 0)) return;
        let inset = expanded ? rect.width : 0;
        if (!initial) {
          const edges = officialPull.motionElements(panel)
            .map(node => node.getBoundingClientRect().left).filter(Number.isFinite);
          if (edges.length) inset = Math.max(0, Math.min(rect.width, Math.min(...edges) - rect.left));
        }
        clip(panel, inset);
        // 霜层是独立根叶，不能只裁宿主外壳；从当前区域记录取，避免碰其他会话。
        const surface = typeof weSurfaceRuntime !== "undefined" && weSurfaceRuntime
          && weSurfaceRuntime.records.get(panel);
        if (surface && surface.plate) {
          if (!clips.has(surface.plate)) observer.observe(surface.plate, { attributes: true, attributeFilter: ["style"] });
          clip(surface.plate, inset);
        }
      };
      const scan = () => {
        if (disposed) return;
        if (officialPull.targets()?.surface !== panel) { run.cancel(); return; }
        if (typeof panel.hasAttribute === "function" && panel.hasAttribute("data-sidebar-right-open") !== expanded) {
          // React 可延迟提交；首次到达目标状态前不是取消，不能先撤底板裁剪。
          if (!tracedWait) { officialPull.trace("waiting", target); tracedWait = true; }
          if (reached) run.cancel();
          return;
        }
        reached = true;
        const reduced = typeof window !== "undefined" && typeof window.matchMedia === "function"
          && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const column = target.frame !== panel && panel.closest("[data-rightbar-col]");
        for (const element of officialPull.motionElements(panel, true)) {
          if (seen.has(element) || typeof element.animate !== "function") continue;
          seen.add(element);
          // 已有过渡由宿主管；首次挂载没有旧样式，只补本次位移动画。
          const native = typeof element.getAnimations === "function" && element.getAnimations().some(animation =>
            animation.transitionProperty === "transform" && !["idle", "finished"].includes(animation.playState));
          if (native || reduced) continue;
          const width = panel.getBoundingClientRect().width;
          if (!(width > 0)) continue;
          const closed = "translateX(" + width + "px)";
          const animation = element.animate([
            { transform: expanded ? closed : "none" },
            { transform: expanded ? "none" : closed },
          ], { duration: ms, easing: column ? "linear" : "ease-in-out" });
          if (column) animation.pause();
          animations.add(animation);
        }
        if (column && animations.size) {
          // 直接锁到宿主整列的实时边缘；不同缓动/掉帧/暂停都不能再让内容抢跑。
          const rect = panel.getBoundingClientRect(), edge = column.getBoundingClientRect().left;
          if (rect.width > 0 && Number.isFinite(edge)) {
            const closed = Math.max(0, Math.min(1, (edge - rect.left) / rect.width));
            for (const animation of animations) animation.currentTime = ms * (expanded ? 1 - closed : closed);
          }
        }
        syncClip(false);
        const phase = Math.min(4, Math.floor((Date.now() - traceStart) / Math.max(1, ms) * 4));
        if (phase !== tracePhase) { tracePhase = phase; officialPull.trace("moving", target, phase); }
      };
      const observer = new MutationObserver(scan);
      observer.observe(panel, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-sidebar-right-open"] });
      const body = panel.ownerDocument ? panel.ownerDocument.body : document.body;
      if (body) observer.observe(body, { childList: true, subtree: true });
      const run = {
        animations,
        cancel() {
          if (disposed) return;
          disposed = true;
          observer.disconnect();
          if (frameId !== null) cancelAnimationFrame(frameId);
          for (const animation of animations) animation.cancel();
          for (const [node, record] of clips) {
            if (node.style.getPropertyValue("clip-path") !== record.written) continue;
            if (record.before) node.style.setProperty("clip-path", record.before, record.priority);
            else node.style.removeProperty("clip-path");
          }
          if (officialPull.motionRun === run) officialPull.motionRun = null;
        },
      };
      officialPull.motionRun = run;
      syncClip(true);
      const tick = () => {
        scan();
        if (!disposed) frameId = requestAnimationFrame(tick);
      };
      if (typeof requestAnimationFrame === "function") frameId = requestAnimationFrame(tick);
    },
    targets() {
      if (typeof document === "undefined" || !document.querySelector) return null;
      if (typeof document.querySelectorAll === "function") {
        const panels = Array.from(document.querySelectorAll("[data-sidebar-right-panel]"));
        const active = panels.filter(panel => !panel.closest("[hidden]"));
        const ours = active.filter(panel => panel.querySelector(".we-qp--official"));
        const panel = ours.length === 1 ? ours[0] : ours.length === 0 && active.length === 1 ? active[0] : null;
        if (panel) {
          // 新宿主把类名模块化；稳定标记所在列的父节点才拥有整层 grid 过渡。
          const column = panel.closest("[data-rightbar-col]");
          return { frame: column && column.parentElement || panel, surface: panel, modern: true };
        }
        if (panels.length) return null;
      }
      const frame = document.querySelector(".dshDesktopFrame");
      return frame ? { frame, surface: document.querySelector(".dshDesktopRightbarSurface"), modern: false } : null;
    },
    begin(ms, expanded = true) {
      const target = officialPull.targets();
      officialPull.trace(expanded ? "begin-open" : "begin-close", target);
      if (!target) { if (expanded) wallSidebarOpen(); else wallSidebarClose(); return 0; }
      const { frame, surface } = target;
      if (officialPull.savedFrame && officialPull.savedFrame !== frame) officialPull.restore();
      if (officialPull.saved === null) {
        officialPull.savedFrame = frame;
        officialPull.saved = frame.style.getPropertyValue("--ds-transition-duration-slow") || "";
        officialPull.savedPriority = frame.style.getPropertyPriority?.("--ds-transition-duration-slow") || "";
      }
      if (surface && officialPull.savedOverflow === null) {
        officialPull.savedSurface = surface;
        officialPull.savedOverflow = surface.style.getPropertyValue("overflow") || "";
        try { surface.style.setProperty("overflow", "hidden"); } catch { /* ignore */ }
      }
      frame.style.setProperty("--ds-transition-duration-slow", ms + "ms");
      const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      const instant = frame.hasAttribute && ["data-dragging", "data-rightbar-fullscreen", "data-rightbar-instant"]
        .some(name => frame.hasAttribute(name));
      if (target.modern && frame !== surface && !reduced && !instant) {
        // 宿主在 600ms 后撤掉 data-animating；仅延长变量会被中途切断。
        if (!officialPull.savedTransition) officialPull.savedTransition = {
          value: frame.style.getPropertyValue("transition"),
          priority: frame.style.getPropertyPriority?.("transition") || "",
        };
        frame.style.setProperty("transition", "grid-template-columns var(--ds-transition-duration-slow) var(--ds-ease-in-out, ease-in-out)");
      }
      officialPull.armMotion(target, ms, expanded);
      // 开合前结算已有节点的旧样式，否则与 React 提交合并时也可能没有过渡。
      if (surface && typeof surface.getBoundingClientRect === "function") surface.getBoundingClientRect();
      if (expanded) wallSidebarOpen(); else wallSidebarClose();
      return ms;
    },
    restore() {
      if (officialPull.motionRun) officialPull.motionRun.cancel();
      // 还给本次实际改过的节点，不能重查 DOM 后误改新会话或替换后的面板。
      const frame = officialPull.savedFrame, surface = officialPull.savedSurface;
      if (frame && officialPull.saved !== null) {
        if (officialPull.saved) frame.style.setProperty("--ds-transition-duration-slow", officialPull.saved, officialPull.savedPriority);
        else frame.style.removeProperty("--ds-transition-duration-slow");
        if (officialPull.savedTransition) {
          const { value, priority } = officialPull.savedTransition;
          if (value) frame.style.setProperty("transition", value, priority);
          else frame.style.removeProperty("transition");
        }
      }
      if (surface && officialPull.savedOverflow !== null) {
        try {
          if (officialPull.savedOverflow) surface.style.setProperty("overflow", officialPull.savedOverflow);
          else surface.style.removeProperty("overflow");
        } catch { /* ignore */ }
      }
      officialPull.saved = null;
      officialPull.savedOverflow = null;
      officialPull.savedFrame = null;
      officialPull.savedSurface = null;
      officialPull.savedTransition = null;
      officialPull.savedPriority = "";
    },
    syncOpen() {
      if (officialPull.syncOwner) officialPull.syncOwner.cancel();
      const target = officialPull.targets(), frame = target && target.frame;
      const list = () => frame && typeof frame.getAnimations === 'function'
        ? frame.getAnimations(target.modern ? { subtree: true } : undefined) : [];
      const before = new Set(list()), owned = new Set();
      const current = () => officialPull.syncOwner === session;
      const capture = () => {
        for (const animation of list()) {
          const element = animation.effect && animation.effect.target;
          const mountedMotion = officialPull.motionRun && officialPull.motionRun.animations.has(animation);
          const matches = target.modern
            ? (frame !== target.surface && element === frame && animation.transitionProperty === 'grid-template-columns')
              || (animation.transitionProperty === 'transform' || mountedMotion) && element && typeof element.matches === 'function'
                && element.matches('[data-dockkit-host="dock"], [data-dockkit-empty], [data-dockkit-divider]')
            : animation.transitionProperty === 'grid-template-columns';
          if (before.has(animation) || owned.has(animation) || !matches) continue;
          owned.add(animation);
          animation.pause();
          animation.effect.updateTiming({ easing: 'linear' });
        }
        return owned;
      };
      const release = complete => {
        if (!current()) return;
        officialPull.syncOwner = null;
        for (const animation of capture()) { if (complete) animation.finish(); else animation.cancel(); }
        officialPull.restore();
      };
      const session = {
        seek(progress) {
          if (!current() || !Number.isFinite(progress)) return;
          for (const animation of capture()) {
            const duration = Number(animation.effect.getComputedTiming().duration);
            if (Number.isFinite(duration)) animation.currentTime = duration * Math.max(0, Math.min(.999, progress));
          }
        },
        finish() { release(true); },
        cancel() { release(false); },
      };
      officialPull.syncOwner = session;
      officialPull.begin(1000);
      return session;
    },
    edgeX() {
      const target = officialPull.targets();
      if (!target || !target.surface) return null;
      const surfaces = target.modern
        ? officialPull.motionElements(target.surface)
        : [target.surface];
      let edge = null;
      for (const surface of surfaces) {
        const rect = surface.getBoundingClientRect();
        if (Number.isFinite(rect.left) && (edge === null || rect.left < edge)) edge = rect.left;
      }
      // 收起时 dock 由 aria-hidden 隐藏，仍须给彩蛋一提供首次弹出的碰撞起点。
      if (edge === null && target.modern) {
        const rect = target.surface.getBoundingClientRect();
        if (Number.isFinite(rect.right)) return rect.right;
      }
      return edge;
    },
  };
  React.useEffect(() => {
    try {
      petLink.mascot.registerSidebar({
        mode: "official",
        open: () => wallSidebarOpen(),
        close: () => wallSidebarClose(),
        isOpen: () => sidebarRightOursActive(),
        // 默认展开时长按用户导出的参数；提前量由 pet-link 单独计入。
        pullMs: 8125,
        // ⚠️ `ms` 是**透传**的（不在这里写死）：调参面板可以把 `slowOpenMs` 改掉，
        //    那时侧栏的 CSS 过渡必须跟着变，否则「宠物拉完了、面板还在动」。
        //    面板没改过时，pet-link.js 传下来的就是 `pullMs` 本身。
        beginPull: (ms) => { officialPull.begin(Number.isFinite(ms) ? ms : 8125); },
        rebound: (expanded, ms) => { officialPull.begin(Number.isFinite(ms) ? ms : 240, expanded); },
        syncOpen: () => officialPull.syncOpen(),
        edgeX: () => officialPull.edgeX(),
        commit: () => { officialPull.restore(); },
      });
      officialPull.trace("ready", officialPull.targets());
    } catch { /* 注册失败不影响面板本身 */ }
    return () => {
      try { petLink.mascot.registerSidebar(null); } catch { /* ignore */ }
      try { if (officialPull.syncOwner) officialPull.syncOwner.cancel(); officialPull.restore(); } catch { /* 还原失败不影响布局 */ }
    };
  }, [hidden, petOfficialMode]);

  // Hidden: render nothing (rope + drawer), but keep the one-time update
  // notice — it is independent of the mascot and must still surface.
  if (hidden) {
    return React.createElement(React.Fragment, null,
      React.createElement(UpdateNotice, null),
    );
  }

  // Rope style: only emit an explicit box size when it differs from the
  // stylesheet's default (52×57 at 1× — the box the retired chibi maid used). At the default the rope is
  // exactly CSS-sized, so we leave width/height out — making the default markup
  // byte-identical to the build that shipped the lazy-mounted panel (no extra
  // layout/compositing the kiosk window could trip on).
  const ropeStyle = { top: pos.y + "px", left: pos.x + "px" };
  if (box.w !== 52 || box.h !== 57) {
    ropeStyle.width = box.w + "px";
    ropeStyle.height = box.h + "px";
  }

  return React.createElement(React.Fragment, null,
    React.createElement("div", {
      ref: ropeRef,
      className: "we-rope we-rope--settle",
      style: ropeStyle,
      role: "button",
      tabIndex: 0,
      "aria-label": weT("壁纸库拉绳：沿顶部拖动移动位置，向下拉打开壁纸库面板"),
      title: weT("壁纸库 · 沿顶部拖动 / 向下拉打开"),
      onPointerDown: onRopePointerDown,
      onPointerMove: onRopePointerMove,
      onPointerUp: (e) => finishDrag(e.clientX, e.clientY, false),
      onPointerCancel: (e) => finishDrag(e.clientX, e.clientY, true),
      onKeyDown: onRopeKeyDown,
    },
      React.createElement("div", { className: "we-rope__art", "aria-hidden": "true" },
        React.createElement("img", { className: "we-rope__img", src: art.img, alt: "", draggable: false }),
      ),
    ),
    React.createElement("aside", {
      ref: panelRef,
      className: "we-repo-panel" + (open ? " we-repo-panel--open" : ""),
      "aria-hidden": String(!open),
      "aria-label": weT("壁纸库面板"),
      // Closed panel must not expose focusable descendants to Tab / AT.
      inert: open ? undefined : "",
    },
      React.createElement("header", { className: "we-repo-panel__head" },
        React.createElement("span", { className: "we-repo-panel__title" }, weT("壁纸库")),
        React.createElement("button", {
          type: "button",
          tabIndex: open ? 0 : -1,
          className: "we-picker__btn",
          onClick: () => setOpen(false),
        }, weT("收起")),
      ),
      React.createElement("div", { className: "we-repo-panel__body" },
        // Lazy-mount the panel only while the drawer is open: keeping it mounted
        // behind a hidden full-viewport fixed panel was the biggest compositing
        // footprint of the rope dock — a driver of the kiosk-window white flash.
        // 内容与官方侧栏 tab 同一份（QuickPanel），壳只有这一个抽屉。
        open ? React.createElement(QuickPanel, { dock: "drawer" }) : null,
      ),
    ),
    React.createElement(UpdateNotice, null),
  );
}
