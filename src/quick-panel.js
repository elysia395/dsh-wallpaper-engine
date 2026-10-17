/**
 * quick-panel.js — 快捷播放面板（侧边栏的**唯一**内容）：当前壁纸 + 轮播 + 三档页签
 * （壁纸 / 外观 / 播放）+ 设置入口。
 *
 * 为什么单独一个文件：它是两个宿主位置的**同一份**内容 —— ① 官方右侧栏的 tab
 * （harness ≥0.1.5，`sidebar.right.pane.tab` 座位）；② 低版本宿主的右滑抽屉
 * （RopeDock 的 `.we-repo-panel`）。UI 重构后侧栏不再是"设置页的副本"，只放日常
 * 高频操作；「外观」「播放」两页是**用户点名**要的例外 —— 它们与设置页同名页签
 * **共用同一批渲染器**（`renderAppearanceTab` / `renderEffectsTab` / `renderAudioTab`，
 * 侧栏档由 `ctx.surface === "sidebar"` 少画设置页专属的分组），于是两处永远是同一份
 * 控件、同一份状态（改哪边另一边都跟着变，不会有第二份值）。同一份面板画在两个壳里，
 * 壳的差异只有根类修饰（`dock`）。
 *
 * 契约（构建期由 scripts/build-client.mjs 内联进 bundle 的工厂作用域，"外部作用域" =
 * 同一 prelude / src/client.js 的顶层）：
 *   · 这是一个**组件**（同 WallpaperPicker / RopeDock 一类），不是纯渲染器：直接
 *     `useStore()` 读 store，直呼模块级处理器（播放控制那几个，以及 `onAccent` /
 *     `onScrim` / `onGlassAlpha` / `onWallpaperOpacity` … 这批与设置页共用的
 *     「外观 / 画面处理器」）与模块级工具（applySelection / setSetting / setTransient /
 *     emit / SliderRow / switchRow / cardKeyDown / playableInventory / groupWallpapers /
 *     playbackIsVideoLike / CARD_TYPE_LABELS / openSettingsSection / userPropsPanelOpen /
 *     openUserPropsPanel / closeUserPropsPanel / renderUserPropsPanel）。
 *   · 三档页签是**视图状态**（localStorage，仅 UI，不进 config.json）；两页里的控件
 *     一律受控：值从 `sel` 读、写走上面那批处理器 —— **不得**出现 `selection.X =`
 *     字面直写（守卫 ①e 的棘轮只盯直写，本文件必须保持 0），也不许在组件里另存一份值
 *     （否则侧栏与设置页会分叉，而且不会报错）。壁纸属性那条同理：开关与面板**都是
 *     设置页那一份**（`userPropsPanelOpen()` / `renderUserPropsPanel()`），侧栏只决定
 *     "什么时候把它画出来"（**页内下钻**：打开时内容区整区换成面板、列表让位，
 *     与设置页库视图那套下钻同一形态；不是内联在列表下方）。
 *   · 本文件必须保持浏览器安全（无 import / require / Node API），且**不得有顶层可执行语句**
 *     读 client.js 的 const（会被内联到 bundle 顶部，撞 TDZ）；React 只在渲染期读。
 */

  // ── 列表虚拟滚动（用户口径：**全量加载、不隐藏**）──────────────────────────
  // 库可以上千张 ⇒ 用"占位 spacer + 只画可视窗口"兜住性能 —— scrollHeight 由 spacer
  // 撑出全集的高度，滚动/搜索/筛选的语义与全量 DOM 完全一致。窗口按**网格行**计（列表
  // 一行 1 张；卡片一行 = cols 张、列数自适应必须实测），再换算成条目下标 —— 按条目直算的话，
  // 卡片档滚一行窗口只挪一张，画出来的卡永远盖不满视口（实测踩过）。行距常量与 styles.js
  // 一一对应（**改样式必须同步改这里**，否则窗口算错位）：
  const QP_ROW_H = 34;   // 列表行高：.we-qp__item 的 min-height（内容恒为单行，min 即实高）
  const QP_ROW_GAP = 2;  // .we-qp__list 的 gap
  const QP_CARD_H = 92;  // 卡片高：.we-qp__card 的固定 height（网格轨道不认内容高，见那边注释）
  const QP_CARD_GAP = 8; // .we-qp__list--cards 的 gap
  const QP_CARD_MIN = 130; // .we-qp__list--cards 的 minmax 下限（还没画出卡片时的列数兜底）
  const QP_VP_OVERSCAN = 6; // 视口外上下各多渲染几**行**（快速滚动不露白）
  const QP_VP_FIRST = 30;   // 首帧还没量到滚动容器 / 列数时先画的**条目数**（量完立刻收窄）
  /** 找实际滚动容器：官方档是列表自己（`.we-qp--official .we-qp__list` overflow-y:auto），
      抽屉档是祖先 `.we-repo-panel__body`（整个面板滚、列表不叠第二层滚）。列表自身
      滚得动就选自己；一路都不滚返回 null（内容不足一屏，无需虚拟化）。 */
  function qpFindScroller(el) {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      let oy = "";
      try { oy = getComputedStyle(node).overflowY; } catch { /* ignore */ }
      if ((oy === "auto" || oy === "scroll") && node.scrollHeight > node.clientHeight + 1) return node;
    }
    return null;
  }
  /** 可视窗口 {start, end, cols, cards, tag}：start/end 是条目下标 [start, end)，
      cols = 卡片档的实测列数（列表档恒 1），cards = 测量时的视图档（渲染侧用它识别
      "换视图瞬间的旧窗口"），tag = 调用方自定义的形态戳（同样用于识别旧窗口；不给
      即 undefined）。两种壳同一个测量式：官方档（列表自己滚）取 scrollTop /
      clientHeight；抽屉档（祖先滚）取「列表顶被滚出滚动容器顶多少」+ 容器可视高。
      窗口先把 hidden→可视底这段折成网格行（行距 = 卡高 + gap），再乘 cols 摊回条目。
      滚动事件 rAF 合并；窗口没变不触发重渲染；官方档在 deps 变化（换视图 / 条数变化）
      时 scrollTop 归零 —— 旧行距下的位置在新几何里指向别处，还会先被临时高度钳一把，
      不如回顶重测，语义可预期（抽屉档是祖先在滚，不动它）。meta 走 ref 进闭包，
      滚动重测不因一次输入而重挂监听。 */
  function qpVirtWindow(ref, count, itemH, gap, cards, tag) {
    const [win, setWin] = React.useState(() => ({ start: 0, end: QP_VP_FIRST, cols: 0, cards: false, tag }));
    const metaRef = React.useRef(null);
    metaRef.current = { count, itemH, gap, cards };
    React.useEffect(() => {
      const el = ref.current;
      if (!el) return undefined;
      let raf = 0;
      const measure = () => {
        raf = 0;
        const meta = metaRef.current || { count: 0, itemH: QP_ROW_H, gap: QP_ROW_GAP, cards: false };
        const pitch = meta.itemH + meta.gap;
        // 列数：卡片档取首张已渲染卡片的实际轨宽反推（1fr 等宽 ⇒ (W+gap)/(轨宽+gap) 恰为
        // 列数，天然吃进滚动条 / gutter 的宽度差）；一张都没画时退回 CSS 的 minmax 公式。
        let cols = 1;
        if (meta.cards) {
          const W = el.clientWidth;
          const card = el.querySelector(".we-qp__card");
          const cw = card ? card.offsetWidth : 0;
          cols = cw > 0
            ? Math.max(1, Math.round((W + meta.gap) / (cw + meta.gap)))
            : Math.max(1, Math.floor((W + meta.gap) / (QP_CARD_MIN + meta.gap)));
        }
        const sc = qpFindScroller(el);
        let hidden = 0; let view = Infinity;
        if (sc === el) { hidden = el.scrollTop; view = el.clientHeight; }
        else if (sc) {
          const a = sc.getBoundingClientRect();
          const b = el.getBoundingClientRect();
          hidden = Math.max(0, a.top - b.top);
          view = a.height;
        }
        const rowsTotal = Math.max(1, Math.ceil(meta.count / cols));
        const r0 = Math.max(0, Math.floor(hidden / pitch) - QP_VP_OVERSCAN);
        const r1 = view === Infinity
          ? rowsTotal
          : Math.min(rowsTotal, Math.ceil((hidden + view) / pitch) + QP_VP_OVERSCAN);
        const start = r0 * cols;
        const end = Math.min(meta.count, r1 * cols);
        setWin((w) => (w.start === start && w.end === end && w.cols === cols && w.cards === meta.cards && w.tag === tag
          ? w : { start, end, cols, cards: meta.cards, tag }));
      };
      const schedule = () => { if (!raf) raf = requestAnimationFrame(measure); };
      el.scrollTop = 0;
      measure();
      const sc = qpFindScroller(el);
      if (sc) sc.addEventListener("scroll", schedule, { passive: true });
      // 尺寸变化（窗口缩放 / 页签换档 / 列表换视图 / 列数增减）都从 el 的尺寸兜一道；
      // 再补 window resize 覆盖"滚动容器变高但列表没变"的形态。
      const ro = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
      if (ro) ro.observe(el);
      window.addEventListener("resize", schedule);
      return () => {
        if (raf) cancelAnimationFrame(raf);
        if (sc) sc.removeEventListener("scroll", schedule);
        if (ro) ro.disconnect();
        window.removeEventListener("resize", schedule);
      };
    }, [ref, count, itemH, gap, cards, tag]);
    return win;
  }
  // 面板的类型筛选档（全部 / 场景 / 网页 / 视频 / 图片）：**与设置页同一个键**
  // `typeFilter`（用户口径：类型变动两处同步，不做单独的档；持久化 ⇒ 同时管设置页列表与轮播候选）。
  function qpTypes() {
    return [
      { id: "all", label: weT("全部") },
      { id: "scene", label: weT("场景") },
      { id: "web", label: weT("网页") },
      { id: "video", label: weT("视频") },
      { id: "image", label: weT("图片") },
    ];
  }
  /** 类型档 id → 面板文案（上游提示用；值域与设置页的 typeFilter 是同一套 id）。 */
  function qpTypeLabelOf(id) {
    const hit = qpTypes().find((t) => t.id === id);
    return hit ? hit.label : String(id || "");
  }
  // 面板的内容分级筛选档（**紧凑纯文字**，与类型档同一风格；值域与设置页
  // contentRatingFilter 是同一套 id）。**与设置页同一个键** —— 分级闸门本就长在
  // playableInventory 上（两级过滤的第一级），所以这里必须有控件：否则设置页切了档，
  // 面板列表会跟着缩、却没有任何地方能解释或改回来。
  function qpRatings() {
    return [
      { id: "all", label: weT("全部") },
      { id: "everyone", label: weT("全年龄") },
      // PG13 是纯 ASCII：i18n 的调用点扫描器只认含 CJK 的字符串字面量，包 weT 会让
      // 词表键变成"看不见调用点"的孤儿 —— 本就无需翻译，裸字面量是正解。
      { id: "pg13", label: "PG13" },
      { id: "mature", label: weT("成人") },
      { id: "unrated", label: weT("未分级") },
    ];
  }
  /** 分级档 id → 面板文案（空态提示用；值域与设置页的 contentRatingFilter 同一套 id）。 */
  function qpRatingLabelOf(id) {
    const hit = qpRatings().find((r) => r.id === id);
    return hit ? hit.label : String(id || "");
  }
  // ── 三档页签（壁纸 / 外观 / 播放）──────────────────────────────────────────
  // 位置在「轮播」之下：当前壁纸与轮播在三档页签下都显示（调外观 / 播放参数时想换一张
  // 对照很常见）。与设置页的页签表（PICKER_TABS）是两件事 —— 这里只镜像用户点名要的
  // 两页，外加壁纸页。
  const QP_TABS = [
    { id: "wallpaper", get label() { return weT("壁纸"); } },
    { id: "appearance", get label() { return weT("外观"); } },
    { id: "playback", get label() { return weT("播放"); } },
  ];
  // 页签记忆（同 picker-tab / qp-view 口径：仅 UI 状态，localStorage，不进 config.json）。
  const QP_TAB_KEY = "dsh-wallpaper-engine:qp-tab";
  /** 读页签偏好；缺失 / 非法回落「壁纸」。 */
  function readQpTab() {
    try {
      const v = localStorage.getItem(QP_TAB_KEY);
      if (v && QP_TABS.some((t) => t.id === v)) return v;
    } catch { /* ignore */ }
    return "wallpaper";
  }

  // ── 侧栏档的渲染 ctx（与设置页共用同一批渲染器）────────────────────────────
  // 侧栏「外观」画**简化配置**（全局四件套与各面的**总开关**）+ 两块**默认收起的折叠块**
  // （全局字体节、「详细玻璃调节」门后的高级行）。分档见 ADR-0008 **D4**（三次修订）。
  // 折叠态住 localStorage（本档 `qp-font-open` / `qp-glass-detail`；设置页那份字体节用它自己的
  // `picker-font-open`），经 `qpRenderAppearancePane` 作为 `fontOpen` / `glassDetailOpen`
  // 两个布尔传进渲染器。
  //
  // 仍指向占位器的只有两类（取用即抛错，与门互为负对照）：预设方案（跨面批量快照覆盖、
  // 无撤销 ⇒ 只在设置页画）与播放/画面页专属（出图来源 / 实时帧 / 自定义画面 / 帧率上限）。
  // ⚠️ 字体节与玻璃高级行的处理器**已随那次迁移移出本名单**（改传真值）——
  //     三次修订后**字体节两档都画**，它的处理器在两档都是真值；玻璃高级行仍
  //    只在侧栏（含「详细玻璃调节」折叠门）。若有人再把某一行挪成"设置页专属"，记得同时
  //    改回占位器，否则渲染器解构到 undefined 会静默画出死旋钮。
  function sidebarCtxStub(name) {
    const boom = () => { throw new Error("[we-sidebar] ctx." + name + " 属于设置页，侧栏档不提供"); };
    return new Proxy(function () {}, { get: boom, apply: boom });
  }
  const QP_CTX_SETTINGS_ONLY = [
    // ── #159② 玻璃颜色的「分套设置」（门在 `src/glass-panel.js` 的 `!sidebarSurface`）──
    //    「深色单独设置」开关与「玻璃颜色 · 深色」那一行都只在设置页画；侧栏档只画
    //    "写当前配色那一侧"的一个色板（`onGlassColor` 走真值，不在这里）。列这个处理器
    //    进来是给那道门上牙：哪天它在侧栏档被取用 = 渲染时当场抛错，而不是静默冒出深色行。
    "onGlassDarkSeparate",
    // ── 预设方案（ADR-0008 D4：跨面批量覆盖 + 无撤销，只在设置页画）──
    //    门在 `src/glass-panel.js`（`!sidebarSurface`）。列它进来是给"预设块只在设置页"这件事上牙：
    //    补上这个字段 = 渲染时**当场抛错**（替身取用即炸），而不是静默让预设块冒到侧栏 ——
    //    那些"整块快照覆盖且不可撤销"的动作不该随手可达。
    "glassPresets",
    // ── 播放/画面页专属（renderEffectsTab 的侧栏档门）──
    "onClearCustomFrame", "onClearGpuFrame", "onCustomFrameFile",
    "onRecaptureGpuFrame", "onRefreshFrame",
    // 帧率上限（抽帧转码）那行带 `!sidebarSurface` 门 ⇒ 侧栏档不画它，处理器进占位器。
    "onFpsCap",
  ];
  // 占位器只建一次（每帧重建 25 个 Proxy 纯属浪费；它们是常量、可跨渲染共用）。
  let qpSettingsOnlyCtx = null;
  function sidebarRenderCtx(provided) {
    if (!qpSettingsOnlyCtx) {
      qpSettingsOnlyCtx = {};
      for (const k of QP_CTX_SETTINGS_ONLY) qpSettingsOnlyCtx[k] = sidebarCtxStub(k);
    }
    return Object.assign({ surface: "sidebar" }, qpSettingsOnlyCtx, provided);
  }
  // 列表/卡片视图的记忆键（同 picker-tab 口径：仅 UI 状态，localStorage，不进 config.json）。
  const QP_VIEW_KEY = "dsh-wallpaper-engine:qp-view";
  /** 读取面板视图偏好；缺失/非法回落**卡片**（默认形态），显式选过列表的仍读列表。 */
  function readQpView() {
    try {
      return localStorage.getItem(QP_VIEW_KEY) === "list" ? "list" : "cards";
    } catch { return "cards"; }
  }

  // ── 外观页各节的折叠态（同 qp-view 口径：仅 UI 状态，localStorage，不进 config.json）。
  //    用户口径（**二次修订**）：**后面三节默认隐藏**、前面两节默认展开；
  //    每节各自独立、各自记忆（显式操作过的用户永远以他自己的选择为准）。
  //    「之后三节」= 侧边栏圆角 / 全局 UI 配色 / 全局字体 —— 与设置页同序的最后三节。
  const QP_FONT_OPEN_KEY = "dsh-wallpaper-engine:qp-font-open";
  const QP_GLASS_DETAIL_KEY = "dsh-wallpaper-engine:qp-glass-detail";
  const QP_UI_COLOR_OPEN_KEY = "dsh-wallpaper-engine:qp-ui-color-open";
  const QP_DETAIL_OPEN_KEY = "dsh-wallpaper-engine:qp-detail-open";
  const QP_GLASS_UI_OPEN_KEY = "dsh-wallpaper-engine:qp-glass-ui-open";
  const QP_CORNERS_OPEN_KEY = "dsh-wallpaper-engine:qp-corners-open";
  // ⚠️ 「详细玻璃调节」是**子门**（管玻璃节内部的高级行），与整节门不是一回事，默认仍收起。
  /**
   * 读展开态。`defaultOpen` = **该节在本档的默认开合**（用户没表过态时用它）。
   * ⚠️ 存储语义：只在**用户真的点过**时才写 `"1"`/`"0"` ⇒ 读到 `"0"` 一定是"他主动收起过"，
   *    必须尊重；读到 `null`（从没点过）才用默认值。这样改默认值不会覆盖用户的选择，
   *    也不会把"以前默认收起时没点过"的人永久锁在收起态。
   */
  function readQpOpen(key, defaultOpen) {
    try {
      const v = localStorage.getItem(key);
      if (v === null) return defaultOpen === true;
      return v === "1";
    } catch { return defaultOpen === true; }
  }
  /** 写展开态（localStorage 独享；与 view / tab 同一条"不进 config.json"的纪律）。 */
  function writeQpOpen(key, open) {
    try { localStorage.setItem(key, open ? "1" : "0"); } catch { /* ignore */ }
  }

  /** 类型 + live 形态的一句话徽标（与设置页当前壁纸卡同口径，去掉播放态）。 */
  function qpTypeLabel(w, sel) {
    if (!w) return "";
    const live = (w.type === "scene" || w.type === "web") && liveRenderEnabled(sel);
    if (w.type === "scene") return weT(live ? "场景 · 实时渲染" : "场景 · 静态帧");
    if (w.type === "web") return weT(live ? "网页 · 实时渲染" : "网页 · 兼容模式");
    return CARD_TYPE_LABELS[w.type] || weT("壁纸");
  }

  // ── 面板的子渲染器 ──────────────────────────────────────────────────────
  // 判据：这些子树的输入只来自 props / 局部现算值（sel / view / rows / …）与模块级处理器
  // ⇒ 不需要 QuickPanel 的 hook 作用域。父组件只留 hooks + 派生 + 装配。
  // ⚠️ 建在**工厂作用域**（构建期与 client.js 同一 prelude）⇒ 名字必须全局唯一，故一律 `qp` 前缀；
  //    它们仍是"组件的一部分"，直呼模块级处理器，不是纯渲染器。

  function qpRenderRow(w, sel) {
    // ── 行：一张可快切的壁纸 ──
    return React.createElement("div", {
      key: w.id,
      // 卡片自报身份：视频壁纸的提交前预热靠它（见 src/video-layer.js 的 warmVideoForPointer）。
      "data-we-id": String(w.id),
      className: "we-qp__item" + (w.id === sel.id ? " we-qp__item--current" : ""),
      role: "option",
      tabIndex: 0,
      "aria-selected": w.id === sel.id ? "true" : "false",
      title: w.title,
      onClick: () => applySelection(w.id, { fromManual: true }),
      onKeyDown: cardKeyDown,
    },
      React.createElement("span", { className: "we-qp__item-thumb" },
        w.preview
          ? React.createElement("img", {
              src: w.preview, alt: "", loading: "lazy",
              onError: (e) => { e.target.style.display = "none"; },
              onLoad: (e) => { e.target.style.opacity = "1"; },
            })
          : null),
      React.createElement("span", { className: "we-qp__item-title" }, w.title),
      w.id === sel.id
        ? React.createElement("span", { className: "we-qp__item-badge" }, weT("当前"))
        : React.createElement("span", { className: "we-qp__item-type" }, CARD_TYPE_LABELS[w.type] || weT("壁纸")),
    );
  }

  function qpRenderCard(w, sel) {
    // ── 卡：缩略图网格形态（视图切换的「卡片」档；点击语义与列表行一致）──
    return React.createElement("div", {
      key: w.id,
      // 同 renderRow：预热身份标记。
      "data-we-id": String(w.id),
      className: "we-qp__card" + (w.id === sel.id ? " we-qp__card--current" : ""),
      role: "option",
      tabIndex: 0,
      "aria-selected": w.id === sel.id ? "true" : "false",
      title: w.title,
      onClick: () => applySelection(w.id, { fromManual: true }),
      onKeyDown: cardKeyDown,
    },
      w.preview
        ? React.createElement("img", {
            src: w.preview, alt: "", loading: "lazy",
            onError: (e) => { e.target.style.display = "none"; },
            onLoad: (e) => { e.target.style.opacity = "1"; },
          })
        : React.createElement("span", { className: "we-qp__card-empty" }, weT("无预览")),
      React.createElement("span", { className: "we-qp__card-type" }, CARD_TYPE_LABELS[w.type] || weT("壁纸")),
      w.id === sel.id && React.createElement("span", { className: "we-qp__card-badge" }, weT("当前")),
      React.createElement("span", { className: "we-qp__card-title" }, w.title),
    );
  }

  function qpRenderSpacer(key, h) {
    // 虚拟滚动的占位行：撑出未渲染部分的高度（上 / 下各一枚，都可能缺席）。高度 =
    // **网格行数** × 行距 − 一个 gap（spacer 自己与相邻行之间还各隔一个 gap；卡片档
    // 一行 cols 张，行数由调用侧折好）。卡片档必须横跨整行，否则会占一个卡位把可见
    // 卡片挤错行。
    return React.createElement("div", {
      key,
      className: "we-qp__vspacer",
      style: { height: Math.max(0, h) + "px" },
      "aria-hidden": "true",
    });
  }

  function qpRenderCurrent(sel, current, playbackLive) {
    // ── ① 当前壁纸（常驻：三档页签都显示）──
    // 缩略图是一枚旋转圆盘（styles.js 的 .we-qp__thumb）：--playing 跟播放态文字
    // （"· 播放中 / · 已暂停"）同源同值 —— 播放时匀速自转，暂停停在原角度。
    return React.createElement("div", {
      className: "we-qp__current" + (playbackLive ? " we-qp__current--playing" : ""),
    },
      React.createElement("span", { className: "we-qp__thumb" },
        current && current.preview
          ? React.createElement("img", {
              src: current.preview, alt: "", loading: "lazy",
              onError: (e) => { e.target.style.display = "none"; },
              onLoad: (e) => { e.target.style.opacity = "1"; },
            })
          : null),
      React.createElement("div", { className: "we-qp__current-info" },
        React.createElement("div", { className: "we-qp__title", title: current ? current.title : "" },
          sel.id && current ? current.title : weT("未选择壁纸")),
        React.createElement("div", { className: "we-qp__meta" },
          current
            ? qpTypeLabel(current, sel) + weT(playbackLive ? " · 播放中" : " · 已暂停")
            : weT("从下面列表挑一张")),
        sel.videoError && React.createElement("div", { className: "we-picker__current-error" }, sel.videoError),
      ),
      React.createElement("div", { className: "we-qp__current-actions" },
        // ⚠️ **不变量：这一行只放日常操作**（暂停 / 播放 · 刷新 · 清除；场景与网页壁纸再加
        // 「壁纸属性」）。求星之类不是日常动作，不放这里 —— 求星入口在「关于」页常驻
        //（Star 按钮 + 重看公告按钮）与更新公告配图下那行，都不占这一行。
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: onTogglePlay, disabled: !sel.url,
        }, playbackLive ? weT("暂停") : weT("播放", null, "play")),
        // 「刷新」（用户口径）：总有人找不到设置页里的刷新键 ⇒ 在顶栏
        // 「暂停」旁边给一份同款（与设置页同一动作 loadInventory、同一在途态
        // 「刷新中…」）。列表的「重试」只在不扫描失败时出现，这里是常态入口。
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: () => loadInventory(), disabled: sel.loading,
          title: weT("重新扫描 Wallpaper Engine 壁纸库（新装 / 已删除的壁纸立即出现）"),
        }, sel.loading ? weT("刷新中…") : weT("刷新")),
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: onClear, disabled: !sel.id,
          title: weT("清除当前壁纸（停止播放，回到无壁纸状态）"),
        }, weT("清除")),
      ),
    );
  }

  function qpRenderRotation(sel, groups, playable) {
    // ── ② 轮播（常驻：列表 + 启停 + 下一张）──
    return React.createElement("div", { className: "we-qp__section" },
      React.createElement("div", { className: "we-qp__row" },
        React.createElement("select", {
          className: "we-picker__select we-qp__group",
          value: sel.rotationGroupId,
          onChange: onGroupChange,
          disabled: groups.length === 0,
          "aria-label": weT("轮播列表"),
        },
          React.createElement("option", { value: "" }, weT(groups.length ? "— 选择轮播列表 —" : "— 暂无轮播列表 —")),
          ...groups.map((g) => React.createElement("option", {
            key: g.id, value: g.id,
          }, weT("{name}（{count} 可播放 · {interval} 分钟）", {
            name: g.name, count: groupWallpapers(g).length, interval: g.interval,
          }))),
        ),
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: onNextWallpaper,
          disabled: (sel.rotationEnabled ? rotationCandidates() : playable).length < 2,
          title: weT("切到下一张（轮播开着按活动列表、关着按可播放网格）"),
        }, weT("下一张")),
      ),
      switchRow(weT("自动轮播"), sel.rotationEnabled === true, () => onToggleRotation(), {
        hint: weT(groups.length ? "按所选列表定时切换" : "先到设置页新建一个轮播列表"),
      }),
    );
  }

  function qpRenderTabs(qpTab, switchQpTab) {
    // ── ③ 页签栏（在「轮播」之下；当前壁纸与轮播三档都显示）──
    return React.createElement("div", {
      className: "we-tabs we-qp__tabs", role: "tablist", "aria-label": weT("壁纸面板分区"),
    },
      React.createElement("span", {
        className: "we-tabs__pill",
        "aria-hidden": "true",
        style: {
          width: "calc((100% - 6px) / " + QP_TABS.length + ")",
          transform: "translateX(" + Math.max(0, QP_TABS.findIndex((t) => t.id === qpTab)) * 100 + "%)",
        },
      }),
      QP_TABS.map((t) => React.createElement("button", {
        key: t.id,
        type: "button",
        role: "tab",
        "aria-selected": qpTab === t.id ? "true" : "false",
        className: "we-tabs__tab" + (qpTab === t.id ? " we-tabs__tab--active" : ""),
        onClick: () => switchQpTab(t.id),
      }, t.label)),
    );
  }

  function qpRenderPropsButton(qpTab, switchQpTab) {
    // ── ③b 壁纸属性入口（页签栏**下方**、独占整行、无背景）──
    // 用户口径：入口固定在页签栏下方这一行、**三档都看得见**，不随下钻状态消失 —— 下钻开着时
    // 它就地当"收起"用（同一行、同一位置，打开态用 is-on 高亮）。点开走**页内下钻**（内容区
    // 整区换成面板）；面板本体只在壁纸档画，所以在别的档点它时先把档切回壁纸，
    // 否则用户会觉得"点了没反应"。
    return React.createElement("button", {
      className: "we-picker__btn we-qp__propsbtn" + (userPropsPanelOpen() ? " is-on" : ""),
      type: "button",
      "aria-expanded": userPropsPanelOpen() ? "true" : "false",
      title: weT("壁纸作者提供的可调属性（改动立即生效）"),
      onClick: () => {
        if (qpTab === "wallpaper") {
          if (userPropsPanelOpen()) closeUserPropsPanel(); else openUserPropsPanel();
          return;
        }
        switchQpTab("wallpaper");
        openUserPropsPanel();
      },
    }, userPropsPanelOpen() ? weT("收起壁纸属性") : weT("壁纸属性"));
  }

  function qpRenderAppearancePane(sel, ui) {
    // `ui` = QuickPanel 传下来的两块折叠态与开关（localStorage 记忆，见 QP_FONT_OPEN_KEY）。
    // 渲染器保持纯读：状态在组件里、写在 handler 里，这里只装配进 ctx。
    return renderAppearanceTab(sidebarRenderCtx({
      setSetting, setTransient, sel,
      // 模块级重置（issue #192）：本档也画外观那六个节头 ⇒ ↺ 也要能用
      //（同一个模块级处理器，与设置页那份同源）。
      onResetModule,
      onAccent, onBlur, onBorder, onChatGlassFidelity, onExtraGlassSelectors, onGlassAlpha, onGlassColor, onGlassFidelity, onLeftSidebarGlass, onTitlebarGlass, onSidebarGlass, onSidebarFullClear, onToggleThemeFollow,
      // 侧边栏圆角（外观 → 侧边栏圆角）：侧栏档也画这一节 ⇒ 处理器走真值（不是占位器）
      onSidebarAllCorners, onSidebarCornerRadius, onSidebarCornerSquare,
      onCaretColor, onSidebarFollowGlobal, onThinkingMode,
      // ── 全局 UI 配色节（本档默认收起；处理器与设置页同一批模块级函数）──
      uiColorOpen: ui.uiColorOpen, onToggleUiColorSection: ui.onToggleUiColorSection,
      onToggleUiColorCustom, onUiColorElement,
      // ── 整节折叠（「细节 / 玻璃 UI / 侧边栏圆角」三节默认收起）──
      //    ⚠️ 只有本档传这三对 —— 设置页那三节恒展开（用户口径），渲染器那边 `collapsible`
      //    为假时**短路**、根本不读它们（所以设置页不传也不会 ReferenceError）。
      detailOpen: ui.detailOpen, onToggleDetailSection: ui.onToggleDetailSection,
      glassUiOpen: ui.glassUiOpen, onToggleGlassUiSection: ui.onToggleGlassUiSection,
      cornersOpen: ui.cornersOpen, onToggleCornersSection: ui.onToggleCornersSection,
      // ── 吉祥物 3D 环的等比缩放基准（见 QuickPanel 里 paneW 那段）──
      paneWidth: ui.paneWidth,
      // ── 全局字体节（**本档**默认收起；三次修订后该节两档都画，设置页那份
      //    用它自己的 `picker-font-open` 键。原 setting-only 占位器早已摘掉）──
      fontOpen: ui.fontOpen, onToggleFontSection: ui.onToggleFontSection,
      fontSet: fontSetCtx(), officialColorOf,
      onComponentFamily, onComponentFont, onFontAdvanced, onFontResetAll, onGlobalFamily,
      onRefreshSystemFonts, onToggleFontCustom, onThemeColor, onThemeColorClear,
      onThemeDarkSeparate, onThemeFamily, onThemeSize, onThemeTypeOnly, onThemeWeight,
      // ── 玻璃高级行（「详细玻璃调节」折叠块，同批迁出占位器）──
      glassDetailOpen: ui.glassDetailOpen, onToggleGlassDetail: ui.onToggleGlassDetail,
      onToggleChildIndependent, onGlassChildParam, childIndependentOn,
      onSidebarAlpha, onSidebarBlur, onSidebarColor,
      onSidebarContentAlpha, onSidebarContentColor, onCapsuleBlur, onCapsuleColor,
    }));
  }

  function qpRenderPlaybackPane(sel, switchQpTab) {
    return React.createElement(React.Fragment, null,
        renderEffectsTab(sidebarRenderCtx({
          setSetting, sel,
          onScrim, onWallpaperBlur, onWallpaperOpacity,
          onBackgroundBrightness, onBackgroundContrast, onBackgroundSaturate,
          // 壁纸层取景（位置 / 缩放）：侧栏「播放」档同样画这三行 ⇒ 必须传真处理器。
          // ⚠️ 不要只把它们登记进 QP_CTX_SETTINGS_ONLY：那份名单的对象在 sidebarRenderCtx 里
          //    是 Object.assign 的第一个实参，会连设置页那棵树一起盖成「取用即抛错」的替身。
          onLayerPositionX, onLayerPositionY, onLayerScale, onLayerReset,
          // 与设置页同源的那几个播放控制：实时渲染总开关 / 启动等待 / 实时帧率 /
          // 倍速 / 适配 / 翻转（侧栏档真的会画到它们）。
          onToggleSceneLive, onLiveBootDelay, onSceneLiveFps, onPlaybackRate, onObjectFit, onFlip,
          onOpenPicker, setPickerOpener,
          // 侧栏档的空态 CTA：切到本面板的壁纸页（不是设置页的库下钻）。
          onPickWallpaper: () => switchQpTab("wallpaper"),
        })),
        renderAudioTab(sidebarRenderCtx({ sel, onToggleAudio, onVideoVolume })),
      );
  }

  function qpRenderViewBar(sel, view, typeFilter, ratingFilter, switchView) {
    return React.createElement("div", { className: "we-qp__viewbar" },
      React.createElement("input", {
        className: "we-picker__text we-qp__search", type: "text",
        value: sel.qpSearch || "",
        placeholder: weT("搜索壁纸标题…"),
        "aria-label": weT("搜索壁纸标题"),
        onInput: (e) => { setTransient("qpSearch", e.target.value); emit(); },
      }),
      // 内容分级筛选：与设置页**同一个键**（contentRatingFilter，typeFilter
      // 同款治理）—— 这里改，设置页列表与轮播候选同步生效；设置页改，
      // 这边同步显示。分级是**内容闸门**（拦播放，不只筛列表），改档立刻
      // 决定哪些壁纸能点。
      React.createElement("select", {
        className: "we-picker__select we-qp__rating",
        value: ratingFilter,
        onChange: (e) => { setSetting("contentRatingFilter", e.target.value); emit(); },
        "aria-label": weT("内容分级"),
        title: weT("对应 Wallpaper Engine 的内容分级（project.json contentrating）"),
      },
      ...qpRatings().map((r) => React.createElement("option", { key: r.id, value: r.id }, r.label)),
      ),
      // 类型筛选：与设置页「类型」**同一个键**（typeFilter；不再单独存 qpType）——
      // 这里改，设置页列表与轮播候选同步生效；
      // 设置页改，这边同步显示。两处都只筛「列表」，不拦正在应用的壁纸。
      React.createElement("select", {
        className: "we-picker__select we-qp__type",
        value: typeFilter,
        onChange: (e) => { setSetting("typeFilter", e.target.value); emit(); },
        "aria-label": weT("类型筛选"),
        title: weT("按类型筛选壁纸列表（与设置页同一档）"),
      },
      ...qpTypes().map((t) => React.createElement("option", { key: t.id, value: t.id }, t.label)),
      ),
      // 列表 / 卡片：标签式切换（滑动胶囊做激活指示、无分段底 —— 样式见
      // .we-qp__viewtabs），偏好记 localStorage（QP_VIEW_KEY），两个壳共用一份。
      // 语义仍是开关（role=group + aria-pressed），只是外观走标签形态。
      React.createElement("div", { className: "we-tabs we-qp__viewtabs", role: "group", "aria-label": weT("视图") },
        React.createElement("span", {
          className: "we-tabs__pill",
          "aria-hidden": "true",
          style: {
            width: "calc((100% - 6px) / 2)",
            transform: "translateX(" + (view === "cards" ? 100 : 0) + "%)",
          },
        }),
        React.createElement("button", {
          type: "button",
          // 自带挂钩类 we-qp__viewtab：把这两枚从 verify-scene-live 的
          // 「三档页签栏」页签计数里摘出去（那条判据按 we-tabs__tab 的
          // 精确类名数 3 枚，视图切换不是页签栏的一员）。
          className: "we-tabs__tab we-qp__viewtab" + (view !== "cards" ? " we-tabs__tab--active" : ""),
          "aria-pressed": view !== "cards" ? "true" : "false",
          onClick: () => switchView("list"),
        }, weT("列表")),
        React.createElement("button", {
          type: "button",
          className: "we-tabs__tab we-qp__viewtab" + (view === "cards" ? " we-tabs__tab--active" : ""),
          "aria-pressed": view === "cards" ? "true" : "false",
          onClick: () => switchView("cards"),
        }, weT("卡片")),
      ),
    );
  }

  function qpRenderList(listRef, rows, view, cardsView, vTopH, vBtmH, q, ratingFilter, typeFilter, sel) {
    return React.createElement("div", {
      ref: listRef,
      className: "we-qp__list" + (view === "cards" ? " we-qp__list--cards" : ""),
      role: "listbox", "aria-label": weT("壁纸列表"),
    },
      rows.length
        ? React.createElement(React.Fragment, null,
            vTopH > 0 ? qpRenderSpacer("we-qp-vtop", vTopH) : null,
            rows.map(cardsView ? qpRenderCard : qpRenderRow),
            vBtmH > 0 ? qpRenderSpacer("we-qp-vbtm", vBtmH) : null,
          )
        : React.createElement(React.Fragment, null,
            React.createElement("span", { className: "we-picker__hint" },
              q ? weT("没有匹配「{query}」的壁纸", { query: sel.qpSearch })
                  : weT(ratingFilter !== "all" ? "「{name}」分级下没有可播放的壁纸"
                      : typeFilter !== "all" ? "「{name}」类型下没有可播放的壁纸" : "没有可播放的壁纸",
                      { name: qpRatingLabelOf(ratingFilter) })),
          ),
    );
  }

  function qpRenderFoot(foot) {
    // ── ⑤ 底栏：设置入口（文案与落点随当前页签）──
    return React.createElement("div", { className: "we-qp__foot" },
      React.createElement("button", {
        className: "we-picker__btn we-qp__settings", type: "button",
        "data-we-qp-entry": "1",
        onClick: () => openSettingsSection(foot.target),
        title: foot.title,
      }, foot.label),
    );
  }

  function qpRenderLibrarySection(sel, view, typeFilter, ratingFilter, listRef, rows, cardsView, vTopH, vBtmH, q, switchView) {
    return React.createElement("div", { className: "we-qp__section we-qp__library" },
      !sel.loaded
        ? React.createElement("span", { className: "we-picker__hint" }, weT("扫描 Wallpaper Engine…"))
        : sel.inventory.error
          ? React.createElement(React.Fragment, null,
              React.createElement("div", { className: "we-picker__error" },
                weT("未检测到 Wallpaper Engine：{error}", { error: weT(sel.inventory.error) })),
              React.createElement("button", {
                className: "we-picker__btn", type: "button",
                onClick: () => loadInventory(), disabled: sel.loading,
              }, weT(sel.loading ? "刷新中…" : "重试")),
            )
          : React.createElement(React.Fragment, null,
      qpRenderViewBar(sel, view, typeFilter, ratingFilter, switchView),
      qpRenderList(listRef, rows, view, cardsView, vTopH, vBtmH, q, ratingFilter, typeFilter, sel),
    ),
  );
  }

  function QuickPanel(props) {
    // 语言切换：面板自己订阅（它挂在两个宿主壳里，都不保证会因语言而重渲染）。
    useWeLocale();
    const sel = useStore();
    const dock = (props && props.dock) || "drawer";
    // 「壁纸属性」面板渲染器与开关读数/动作都是**模块级**的（见 client.js 顶部）——
    // 本文件当自由变量用。⚠️ 它绝不能是 `apply()` 里的闭包：`src/sidebar-right.js` 是
    // **prelude**（在 `apply()` 之前求值），它注册的那个渲染回调引用不到 apply 的作用域，
    // 一旦那样写，真机上是 `ReferenceError: renderUserPropsPanel is not defined`
    // ⇒ React 卸载整棵树 ⇒ **整个页面空白**（实测复现，不是"这里不画"）。
    // 视图偏好（列表 / 卡片）与页签：useState 必须在早退分支之前（Rules of Hooks）。
    const [view, setView] = React.useState(readQpView);
    const [qpTab, setQpTab] = React.useState(readQpTab);
    // 外观页两块折叠块的展开态（默认收起，localStorage 记忆；两块各自独立）。
    // 同 view / qpTab 一条纪律：useState 在早退分支之前，写状态即写 localStorage（不 emit、
    // 不进 config.json）—— 面板重渲染由 React 状态驱动。
    // ── 各节折叠态的**默认值**（二次修订：侧边栏「后面三节默认隐藏」）────────
    //    顺序与设置页同序：主题 / 细节 / 玻璃 UI / 侧边栏圆角 / 全局 UI 配色 / 全局字体。
    //    侧边栏：**细节、玻璃 UI 默认展开**；**侧边栏圆角、全局 UI 配色、全局字体默认收起**。
    //    （主题没有门，恒展开。）
    const [fontOpen, setFontOpen] = React.useState(() => readQpOpen(QP_FONT_OPEN_KEY, false));
    const [glassDetailOpen, setGlassDetailOpen] = React.useState(() => readQpOpen(QP_GLASS_DETAIL_KEY, false));
    const [uiColorOpen, setUiColorOpen] = React.useState(() => readQpOpen(QP_UI_COLOR_OPEN_KEY, false));
    const [detailOpen, setDetailOpen] = React.useState(() => readQpOpen(QP_DETAIL_OPEN_KEY, true));
    const [glassUiOpen, setGlassUiOpen] = React.useState(() => readQpOpen(QP_GLASS_UI_OPEN_KEY, true));
    const [cornersOpen, setCornersOpen] = React.useState(() => readQpOpen(QP_CORNERS_OPEN_KEY, false));
    const toggleFontSection = () => {
      setFontOpen((prev) => { const next = !prev; writeQpOpen(QP_FONT_OPEN_KEY, next); return next; });
    };
    const toggleUiColorSection = () => {
      setUiColorOpen((prev) => { const next = !prev; writeQpOpen(QP_UI_COLOR_OPEN_KEY, next); return next; });
    };
    const toggleDetailSection = () => {
      setDetailOpen((prev) => { const next = !prev; writeQpOpen(QP_DETAIL_OPEN_KEY, next); return next; });
    };
    const toggleGlassUiSection = () => {
      setGlassUiOpen((prev) => { const next = !prev; writeQpOpen(QP_GLASS_UI_OPEN_KEY, next); return next; });
    };
    const toggleCornersSection = () => {
      setCornersOpen((prev) => { const next = !prev; writeQpOpen(QP_CORNERS_OPEN_KEY, next); return next; });
    };
    const toggleGlassDetail = (open) => {
      const next = open === true;
      setGlassDetailOpen(next);
      writeQpOpen(QP_GLASS_DETAIL_KEY, next);
    };
    // ── 吉祥物 3D 环的「面板宽度」（「左右拉宽、顶格」）──────────────────────
    // 与设置页那侧同形（见 client.js 的 paneW effect）：环要随可用宽度等比放大才填得满，
    // 而渲染器是纯函数、拿不到宽度 ⇒ 在本档量一次、经 ctx 传下去。
    // 量的是 `.we-picker__mascot-carousel`（width:100% 的 flex 行）—— 它的宽度不随窗口
    // 的 max-width 变，所以拿它当"可用宽度"不会自我指涉。侧栏通常 s≈1（设计档就是按它标定的），
    // 但面板可被用户拉宽 ⇒ 仍然值得量。
    const qpPaneRef = React.useRef(null);
    const [paneW, setPaneW] = React.useState(0);
    React.useEffect(() => {
      const root = qpPaneRef.current;
      if (!root) return undefined;
      const measure = () => {
        const el = root.querySelector(".we-picker__mascot-carousel");
        const w = el && el.clientWidth ? el.clientWidth : 0;
        setPaneW((prev) => (Math.abs(prev - w) < 2 ? prev : w));
      };
      measure();
      const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
      if (ro) ro.observe(root);
      window.addEventListener("resize", measure);
      return () => {
        if (ro) ro.disconnect();
        window.removeEventListener("resize", measure);
      };
    }, [qpTab]);
    // ── 本机字体清单（本档的触发点；三次修订后字体节两档都画 ⇒ 设置页那侧
    //    也有一条同形 effect，见 src/client.js 的 pickerFontOpen 那段）──
    // 停在外观页 + 字体节**展开** + 「字体自定义」开着 ⇒ 才去要一次（宿主那次扫描
    // macOS 实测 ~10s，收起态下拉根本不可见，不付）。TTL 内是空操作。
    React.useEffect(() => {
      if (qpTab === "appearance" && fontOpen && sel.fontCustom) ensureSystemFonts(false);
    }, [qpTab, fontOpen, sel.fontCustom]);
    const switchView = (v) => {
      if (v === view) return;
      setView(v);
      try { localStorage.setItem(QP_VIEW_KEY, v); } catch { /* ignore */ }
    };
    const switchQpTab = (id) => {
      if (!QP_TABS.some((t) => t.id === id) || id === qpTab) return;
      // 属性下钻状态跟着页签走：切到别的档时**只是不画**（面板与「返回」都在壁纸档分支里），
      // 切回壁纸档它还在原地。入口那一行三档都可见，所以不存在"找不到入口"的困惑。
      setQpTab(id);
      try { localStorage.setItem(QP_TAB_KEY, id); } catch { /* ignore */ }
    };
    // 虚拟滚动的测量锚点：挂在下面列表容器上（qpVirtWindow 的 effect 只在浏览器跑，
    // 渲染期只借 useRef 的壳）。hook 顺序必须稳定 —— 排在 view / qpTab 两个 useState 之后。
    const listRef = React.useRef(null);

    const list = sel.inventory.wallpapers;
    const current = list.find((w) => w.id === sel.id) || null;
    const playbackLive = playbackIsVideoLike(sel) ? sel.videoPlaying : sel.playing;
    // ── 壁纸属性（**页内下钻**：内容区整区换成面板）──────────────────────────────
    // 开关与设置页共用**同一份**（client.js 的 `propsPanelOpen`，经 `userPropsPanelOpen()`
    // 读；侧栏不另存一份，否则两个壳会分叉）。面板渲染器也是设置页那一份 ——
    // 这里只决定"什么时候画它"（见下面内容区那三个分支：打开时列表/搜索栏让位）。
    // 本档有没有属性可调：与设置页入口同一条判据（仅场景/网页 + 有 propsUrl）。
    const propsAvailable = Boolean(current && (current.type === "scene" || current.type === "web") && sel.propsUrl);
    // 快切列表：与库视图同一过滤口径（分级 / 类型 / 隐藏），再叠面板自己的搜索词。
    // 类型档（全部 / 场景 / 网页 / 视频 / 图片）**与设置页是同一个键** `typeFilter`
    //（用户口径：类型变动两处同步、不做单独的档）。持久化 ⇒ 同时管设置页列表与轮播候选；
    // 两处同值，设置页切档这边立刻跟着变，反之亦然。
    const q = String(sel.qpSearch || "").trim().toLowerCase();
    const typeFilter = qpTypes().some((t) => t.id === sel.typeFilter) ? sel.typeFilter : "all";
    // 分级档与 typeFilter 同一套钳制（旧档/坏值回落「全部」）；闸门在 playableInventory
    // 里已经生效，这里钳出来的值只喂空态文案与下拉的受控 value。
    const ratingFilter = qpRatings().some((r) => r.id === sel.contentRatingFilter)
      ? sel.contentRatingFilter : "all";
    const playable = playableInventory();
    const filtered = playable.filter((w) => {
      if (typeFilter !== "all" && w.type !== typeFilter) return false;
      if (q && String(w.title || "").toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    // 虚拟滚动：列表一行一张、卡片一行 cols 张（列数由测量 effect 实测回填）。搜索 /
    // 筛选把列表收窄后旧窗口可能越界 —— 渲染期先钳一道（测量 effect 随 count 变化跟上）；
    // 换视图瞬间旧窗口是另一档的几何（cards 标记对不上）⇒ 按未测量处理：先画顶部
    // QP_VP_FIRST 张、无占位，量完立刻收窄到正确窗口。
    const cardsView = view === "cards";
    const vGap = cardsView ? QP_CARD_GAP : QP_ROW_GAP;
    const vItemH = cardsView ? QP_CARD_H : QP_ROW_H;
    const vwin = qpVirtWindow(listRef, filtered.length, vItemH, vGap, cardsView);
    const vMeasured = vwin.cards === cardsView && vwin.cols > 0;
    const vStart = vMeasured ? Math.min(vwin.start, filtered.length) : 0;
    const vEnd = vMeasured
      ? Math.max(vStart, Math.min(vwin.end, filtered.length))
      : Math.min(QP_VP_FIRST, filtered.length);
    const rows = filtered.slice(vStart, vEnd);
    const rowsAfter = filtered.length - vStart - rows.length;
    // 占位行高按**网格行**折算：行数 × 行距 − 一个 gap（spacer 自己与相邻行之间还各隔
    // 一个 gap）。上占位向下取整、下占位向上取整（末行不满也占一行）—— 测量回来的窗口
    // 本就按 cols 对齐，这里只是防御。
    const vTopH = vMeasured && vStart > 0
      ? Math.floor(vStart / vwin.cols) * (vItemH + vGap) - vGap : 0;
    const vBtmH = vMeasured && rowsAfter > 0
      ? Math.ceil(rowsAfter / vwin.cols) * (vItemH + vGap) - vGap : 0;
    const groups = sel.rotationGroups;

    // 页签内容区（此区独立滚动；官方档下宿主 tab 身体是固定高 + overflow:hidden，
    // 滚动必须自管）。壁纸页另挂 --library：列表自己滚，viewbar / 声音组常驻。
    const tabBodyClass = "we-qp__tabbody" + (qpTab === "wallpaper" ? " we-qp__tabbody--library" : "");
    // 底栏入口随页签：壁纸页=打开设置（落在它自己记住的那页）；外观 / 播放页=深链到
    // 设置页同名页签 —— 玻璃详细调节仍只在侧栏（本页，折叠块），设置页那边留玻璃预设、
    // 全量配置与**字体节**（三次修订后字体节两档都画）；播放页的出图来源 /
    // 实时帧仍住设置页。
    const foot = qpTab === "appearance"
      ? {
        label: weT("更多外观设置 ›"),
        target: "appearance",
        title: weT("在设置页打开「外观」页签 —— 玻璃预设与全部外观配置在那里"),
      }
      : qpTab === "playback"
        ? {
          label: weT("更多播放设置 ›"),
          target: "playback",
          title: weT("在设置页打开「播放」页签 —— 出图来源 / 实时帧 / 帧率上限在那里"),
        }
        : {
          label: weT("壁纸引擎设置 ›"),
          target: "",
          title: weT("打开设置对话框的「壁纸引擎」分区（外观 / 播放 / 系统与全部配置）"),
        };

    return React.createElement("div", { className: "we-qp we-qp--" + dock },
      qpRenderCurrent(sel, current, playbackLive),
      qpRenderRotation(sel, groups, playable),
      qpRenderTabs(qpTab, switchQpTab),
      propsAvailable && qpRenderPropsButton(qpTab, switchQpTab),
      // ── ④ 当前页 ──
      // 下钻打开时内容区**直接就是面板**（没有返回按钮那一行 —— 用户口径：多余；
      // 收起走页签下面那枚「收起壁纸属性」，路径没丢）。
      // 外观 / 播放：与设置页同名页签**同一批渲染器**（surface 档少画设置页专属分组）；
      // 壁纸：列表 + 声音（声音与播放页那份同源 —— 同一状态、同一处理器、同一份渲染器）。
      // 属性下钻：打开时整区换成面板（先于其它分支 —— 反过来就被列表顶掉）。
      React.createElement("div", { className: tabBodyClass, ref: qpPaneRef },
        qpTab === "wallpaper" && userPropsPanelOpen() && propsAvailable
          && React.createElement("div", { className: "we-qp__propsview we-qp__propsview--drill" }, renderUserPropsPanel()),
        !(qpTab === "wallpaper" && userPropsPanelOpen() && propsAvailable) && (qpTab === "appearance"
          ? qpRenderAppearancePane(sel, {
            fontOpen, onToggleFontSection: toggleFontSection,
            uiColorOpen, onToggleUiColorSection: toggleUiColorSection,
            glassDetailOpen, onToggleGlassDetail: toggleGlassDetail,
            detailOpen, onToggleDetailSection: toggleDetailSection,
            glassUiOpen, onToggleGlassUiSection: toggleGlassUiSection,
            cornersOpen, onToggleCornersSection: toggleCornersSection,
            // ⚠️ 状态变量叫 `paneW`；这里传给渲染器的字段名是 `paneWidth`（**不能写简写** ——
            //    写成 `paneWidth,` 会引用一个不存在的变量，实测当场 `paneWidth is not defined`）。
            paneWidth: paneW,
          })
          : qpTab === "playback"
            ? qpRenderPlaybackPane(sel, switchQpTab)
            : null),
        !(qpTab === "wallpaper" && userPropsPanelOpen() && propsAvailable) && qpTab === "wallpaper" && React.createElement(React.Fragment, null,
                // ── 壁纸列表（搜索 + 视图切换 + 快切）──
                // 库还没回来 / 扫描失败：**只有这一页**给一句话 —— 外观 / 播放两页不依赖库，
                // 照常可用（不能整块替换掉，那样连外观都进不去）。
                qpRenderLibrarySection(sel, view, typeFilter, ratingFilter, listRef, rows, cardsView, vTopH, vBtmH, q, switchView),
                // 声音（与播放页那份同源：同一份渲染器、同一状态）。包一层 .we-qp__section
                // 只为保留这一节的分隔线与间距（渲染器自己那份 section 是给设置页排版的）。
                React.createElement("div", { className: "we-qp__section" },
                  renderAudioTab(sidebarRenderCtx({ sel, onToggleAudio, onVideoVolume })),
                ),
        ),
      ),
      qpRenderFoot(foot),
    );
  }

  // `qpTypes` / `QP_TAB_KEY` / `qpTypeLabel` 是文件内自用（PR #202 的底座落后于本地线
  // 的导出面清理，顺手把它们留在了导出里）⇒ 按本仓口径收回，声明本体不动。
  export {
    QP_TABS,
    QP_CTX_SETTINGS_ONLY,
    sidebarRenderCtx,
    QuickPanel,
  };
