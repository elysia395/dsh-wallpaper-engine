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

  // 列表一次最多渲染的行数：库可以上千张，面板是"快切"不是"全集浏览" —— 超出
  // 让用户用搜索收敛（全量浏览在设置页的壁纸库下钻视图）。
  const QP_LIST_MAX = 100;
  // 面板本地的类型筛选档（全部 / 场景 / 网页 / 视频 / 图片）：瞬态，与设置页的「类型」
  // 过滤互不影响（那一条是设置，筛设置页列表与轮播候选）。两个档位的**叠加关系**见
  // 列表空态那段 —— 上游那一档不是「全部」时，空列表要说出是谁筛掉的。
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
  // 只放行侧栏档真的会画到的字段；设置页专属字段（字体 / 光标 / 窗口与侧栏 / 出图来源 /
  // 实时帧 / 自定义画面 / 帧率上限）一律指向"取用即抛错"的占位器 —— 将来某次编辑把
  // 一行挪进侧栏档，会当场炸而不是静默变成"点了没反应"（同"漏传 ctx 字段 = 当场
  // ReferenceError"那条纪律：刻意选的失败方式，响亮且可定位）。
  function sidebarCtxStub(name) {
    const boom = () => { throw new Error("[we-sidebar] ctx." + name + " 属于设置页，侧栏档不提供"); };
    return new Proxy(function () {}, { get: boom, apply: boom });
  }
  const QP_CTX_SETTINGS_ONLY = [
    "officialColorOf", "fontSet", "onCaretColor", "onComponentFamily", "onComponentFont",
    "onFontAdvanced", "onFontResetAll", "onToggleFontCustom", "onSidebarAlpha", "onSidebarBlur",
    "onSidebarColor", "onSidebarContentAlpha", "onSidebarContentColor", "onThemeColor",
    "onThemeColorClear", "onThemeDarkSeparate", "onThemeFamily", "onThemeSize", "onThemeTypeOnly",
    "onThemeWeight", "onClearCustomFrame", "onClearGpuFrame", "onCustomFrameFile",
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

  /** 类型 + live 形态的一句话徽标（与设置页当前壁纸卡同口径，去掉播放态）。 */
  function qpTypeLabel(w, sel) {
    if (!w) return "";
    const live = (w.type === "scene" || w.type === "web") && liveRenderEnabled(sel);
    if (w.type === "scene") return weT(live ? "场景 · 实时渲染" : "场景 · 静态帧");
    if (w.type === "web") return weT(live ? "网页 · 实时渲染" : "网页 · 兼容模式");
    return CARD_TYPE_LABELS[w.type] || weT("壁纸");
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

    const list = sel.inventory.wallpapers;
    const current = list.find((w) => w.id === sel.id) || null;
    const playbackLive = playbackIsVideoLike(sel) ? sel.videoPlaying : sel.playing;
    // ── 壁纸属性（**页内下钻**：内容区整区换成面板）──────────────────────────────
    // 开关与设置页共用**同一份**（client.js 的 `propsPanelOpen`，经 `userPropsPanelOpen()`
    // 读；侧栏不另存一份，否则两个壳会分叉）。面板渲染器也是设置页那一份 ——
    // 这里只决定"什么时候画它"（见下面内容区那三个分支：打开时列表/搜索栏让位）。
    // 本档有没有属性可调：与设置页入口同一条判据（仅场景/网页 + 有 propsUrl）。
    const propsAvailable = Boolean(current && (current.type === "scene" || current.type === "web") && sel.propsUrl);
    // 快切列表：与库视图同一过滤口径（分级 / 类型 / 隐藏），再叠面板自己的
    // 搜索词与**面板本地的类型筛选**（qpType：全部 / 场景 / 网页 / 视频 / 图片 ——
    // 瞬态，不影响设置页的过滤与轮播候选）。
    const q = String(sel.qpSearch || "").trim().toLowerCase();
    const typeFilter = qpTypes().some((t) => t.id === sel.qpType) ? sel.qpType : "all";
    // 上游档（设置页的类型过滤，持久化）：它先筛一遍候选，侧栏这一档再筛 ——
    // 空列表时若它不是「全部」，提示要说清是哪一层筛掉的（否则用户以为库里没有）。
    const upstreamType = String(sel.typeFilter || "all");
    const playable = playableInventory();
    const filtered = playable.filter((w) => {
      if (typeFilter !== "all" && w.type !== typeFilter) return false;
      if (q && String(w.title || "").toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    const rows = filtered.slice(0, QP_LIST_MAX);
    const groups = sel.rotationGroups;

    // ── 行：一张可快切的壁纸 ──
    const renderRow = (w) => React.createElement("div", {
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

    // ── 卡：缩略图网格形态（视图切换的「卡片」档；点击语义与列表行一致）──
    const renderCard = (w) => React.createElement("div", {
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

    // 页签内容区（此区独立滚动；官方档下宿主 tab 身体是固定高 + overflow:hidden，
    // 滚动必须自管）。壁纸页另挂 --library：列表自己滚，viewbar / 声音组常驻。
    const tabBodyClass = "we-qp__tabbody" + (qpTab === "wallpaper" ? " we-qp__tabbody--library" : "");
    // 底栏入口随页签：壁纸页=打开设置（落在它自己记住的那页）；外观 / 播放页=深链到
    // 设置页同名页签 —— 侧栏这两页只放"调完立刻看得见"的行，字体 / 出图来源等仍住设置页。
    const foot = qpTab === "appearance"
      ? {
        label: weT("字体与更多外观 ›"),
        target: "appearance",
        title: weT("在设置页打开「外观」页签 —— 字体 / 光标 / 窗口与侧栏在那里"),
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
      // ── ① 当前壁纸（常驻：三档页签都显示）──
      // 缩略图是一枚旋转圆盘（styles.js 的 .we-qp__thumb）：--playing 跟播放态文字
      // （"· 播放中 / · 已暂停"）同源同值 —— 播放时匀速自转，暂停停在原角度。
      React.createElement("div", {
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
          React.createElement("button", {
            className: "we-picker__btn", type: "button",
            onClick: onTogglePlay, disabled: !sel.url,
          }, playbackLive ? weT("暂停") : weT("播放", null, "play")),
          React.createElement("button", {
            className: "we-picker__btn", type: "button",
            onClick: onClear, disabled: !sel.id,
            title: weT("清除当前壁纸（停止播放，回到无壁纸状态）"),
          }, weT("清除")),
        ),
      ),
      // ── ② 轮播（常驻：列表 + 启停 + 下一张）──
      React.createElement("div", { className: "we-qp__section" },
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
      ),
      // ── ③ 页签栏（在「轮播」之下；当前壁纸与轮播三档都显示）──
      React.createElement("div", {
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
      ),
      // ── ③b 壁纸属性入口（页签栏**下方**、独占整行、无背景）──
      // 用户口径：入口固定在这一行（三档都在同一位置），点开走**页内下钻**（内容区整区
      // 换成面板）；drill 打开时这枚不画 —— 同一行的位置交给下面那枚「返回」。
      // 入口固定在这一行、**三档都看得见**（用户口径：放在壁纸 / 外观 / 播放下面、整行、
      // 无背景）。它不随下钻状态消失 —— 下钻开着时它就地当"收起"用（同一行、同一位置），
      // 打开态用 is-on 高亮；面板本体只在壁纸档画（在那支分支里），所以在别的档点它时
      // 先把档切回壁纸，否则用户会觉得"点了没反应"。
      propsAvailable && React.createElement("button", {
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
      }, userPropsPanelOpen() ? weT("收起壁纸属性") : weT("壁纸属性")),
      // ── ④ 当前页 ──
      // 下钻打开时内容区**直接就是面板**（没有返回按钮那一行 —— 用户口径：多余；
      // 收起走页签下面那枚「收起壁纸属性」，路径没丢）。
      // 外观 / 播放：与设置页同名页签**同一批渲染器**（surface 档少画设置页专属分组）；
      // 壁纸：列表 + 声音（声音与播放页那份同源 —— 同一状态、同一处理器、同一份渲染器）。
      // 属性下钻：打开时整区换成面板（先于其它分支 —— 反过来就被列表顶掉）。
      React.createElement("div", { className: tabBodyClass },
        qpTab === "wallpaper" && userPropsPanelOpen() && propsAvailable
          && React.createElement("div", { className: "we-qp__propsview we-qp__propsview--drill" }, renderUserPropsPanel()),
        !(qpTab === "wallpaper" && userPropsPanelOpen() && propsAvailable) && (qpTab === "appearance"
          ? renderAppearanceTab(sidebarRenderCtx({
            setSetting, sel,
            onAccent, onBlur, onBorder, onChatGlassFidelity, onGlassAlpha, onGlassColor, onGlassFidelity, onGlassWindow, onThinkingGlass, onLeftSidebarGlass, onSidebarGlass, onToggleThemeFollow,
          }))
          : qpTab === "playback"
            ? React.createElement(React.Fragment, null,
                renderEffectsTab(sidebarRenderCtx({
                  setSetting, sel,
                  onScrim, onWallpaperBlur, onWallpaperOpacity,
                  onBackgroundBrightness, onBackgroundContrast, onBackgroundSaturate,
                  // 与设置页同源的那几个播放控制：实时渲染总开关 / 启动等待 / 实时帧率 /
                  // 倍速 / 适配 / 翻转（侧栏档真的会画到它们）。
                  onToggleSceneLive, onLiveBootDelay, onSceneLiveFps, onPlaybackRate, onObjectFit, onFlip,
                  onOpenPicker, setPickerOpener,
                  // 侧栏档的空态 CTA：切到本面板的壁纸页（不是设置页的库下钻）。
                  onPickWallpaper: () => switchQpTab("wallpaper"),
                })),
                renderAudioTab(sidebarRenderCtx({ sel, onToggleAudio, onVideoVolume })),
              )
            : null),
        !(qpTab === "wallpaper" && userPropsPanelOpen() && propsAvailable) && qpTab === "wallpaper" && React.createElement(React.Fragment, null,
                // ── 壁纸列表（搜索 + 视图切换 + 快切）──
                // 库还没回来 / 扫描失败：**只有这一页**给一句话 —— 外观 / 播放两页不依赖库，
                // 照常可用（此前是整个面板被一句话替换掉，那样连外观都进不去）。
                React.createElement("div", { className: "we-qp__section we-qp__library" },
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
                  React.createElement("div", { className: "we-qp__viewbar" },
                    React.createElement("input", {
                      className: "we-picker__text we-qp__search", type: "text",
                      value: sel.qpSearch || "",
                      placeholder: weT("搜索壁纸标题…"),
                      "aria-label": weT("搜索壁纸标题"),
                      onInput: (e) => { setTransient("qpSearch", e.target.value); emit(); },
                    }),
                    // 类型筛选：面板本地（全部 / 场景 / 网页 / 视频 / 图片），瞬态不落盘；
                    // 与设置页的「类型」过滤互不影响（那一条筛设置页列表与轮播候选），
                    // 两处都只筛「列表」，不拦正在应用的壁纸。上游那一档的叠加见空态提示。
                    React.createElement("select", {
                      className: "we-picker__select we-qp__type",
                      value: typeFilter,
                      onChange: (e) => { setTransient("qpType", e.target.value); emit(); },
                      "aria-label": weT("类型筛选"),
                      title: weT("按类型筛选侧栏列表（只影响这里）"),
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
                  ),
                  React.createElement("div", {
                    className: "we-qp__list" + (view === "cards" ? " we-qp__list--cards" : ""),
                    role: "listbox", "aria-label": weT("壁纸列表"),
                  },
                    rows.length
                      ? rows.map(view === "cards" ? renderCard : renderRow)
                      : React.createElement(React.Fragment, null,
                          React.createElement("span", { className: "we-picker__hint" },
                            q ? weT("没有匹配「{query}」的壁纸", { query: sel.qpSearch })
                              : (typeFilter !== "all" && upstreamType !== "all" && upstreamType !== typeFilter)
                                ? weT("「{local}」与设置页的类型档「{upstream}」没有交集 —— 两层筛选都放行的壁纸才会出现在这里",
                                    { local: qpTypeLabelOf(typeFilter), upstream: qpTypeLabelOf(upstreamType) })
                                : weT(typeFilter !== "all" ? "「{name}」类型下没有可播放的壁纸" : "没有可播放的壁纸",
                                    { name: qpTypeLabelOf(typeFilter) })),
                          // 两层交集为空时，光说「被上游筛掉了」不够 —— 把从面板到设置页
                          // 类型档的完整点击链写出来，用户不用猜「设置页的类型档」在哪。
                          // 两档相同时不写链路：切成「全部」也变不出该类型的壁纸。
                          typeFilter !== "all" && upstreamType !== "all" && upstreamType !== typeFilter
                            && React.createElement("span", { className: "we-picker__hint" },
                                weT("完整操作链：设置 → 壁纸引擎 → 壁纸库 → 「选择壁纸」→ 顶部「类型」切成「全部」")),
                        ),
                  ),
                  filtered.length > rows.length
                    && React.createElement("span", { className: "we-picker__hint we-qp__more" },
                        weT("还有 {count} 张未显示 · 搜索可收敛，全量浏览在设置页", { count: filtered.length - rows.length })),
                      ),
                ),
                // 声音（与播放页那份同源：同一份渲染器、同一状态）。包一层 .we-qp__section
                // 只为保留这一节的分隔线与间距（渲染器自己那份 section 是给设置页排版的）。
                React.createElement("div", { className: "we-qp__section" },
                  renderAudioTab(sidebarRenderCtx({ sel, onToggleAudio, onVideoVolume })),
                ),
        ),
      ),
      // ── ⑤ 底栏：设置入口（文案与落点随当前页签）──
      React.createElement("div", { className: "we-qp__foot" },
        React.createElement("button", {
          className: "we-picker__btn we-qp__settings", type: "button",
          "data-we-qp-entry": "1",
          onClick: () => openSettingsSection(foot.target),
          title: foot.title,
        }, foot.label),
      ),
    );
  }

  export {
    QP_LIST_MAX,
    qpTypes,
    QP_TABS,
    QP_TAB_KEY,
    QP_CTX_SETTINGS_ONLY,
    sidebarRenderCtx,
    qpTypeLabel,
    QuickPanel,
  };
