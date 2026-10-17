/**
 * 「系统」页签的节渲染器（原 src/panel-tabs.js）：浏览 / 兼容 / 适配器 /
 * 电源 / 缓存 / 诊断。renderAdvancedTab 仍在组装点，按顺序调这六节。
 * 本节渲染器从 src/panel-tabs.js 按域搬出，函数体逐字未改；内联顺序见 scripts/build-client.mjs（排在组装点之前）。
 */
  function renderAdvancedBrowsingSection(ctx) {
    const { onLayoutChange, sel } = ctx;
    return React.createElement(React.Fragment, null,
    // ── 浏览方式：紧凑 CD 架 vs 常规分页网格 ──
    React.createElement("div", { className: "we-picker__section" },
      React.createElement("div", { className: "we-picker__section-head" },
        React.createElement("span", { className: "we-picker__section-label" }, weT("浏览方式")),
      ),
      // Card style: classic (WE's original aspect-ratio 16/9 cards — the CD-like
      // look) vs the rewritten fixed-height cards that never overlap.
      switchRow(weT("紧凑布局"), sel.pickerLayout === "classic", (e) => onLayoutChange(e.target.checked ? "classic" : "fixed"), {
        hint: sel.pickerLayout === "classic" ? weT("CD 架：层叠 + 一页到底") : weT("常规网格 · 分页"),
        tooltip: weT("紧凑 CD 架：层叠 + 一页到底"),
      }),
    ),
    );
  }

  function renderAdvancedCompatSection(ctx) {
    const { onEdgeCompatChange, sel } = ctx;
    return React.createElement(React.Fragment, null,
    // ── 兼容性 ──
    React.createElement("div", { className: "we-picker__section" },
      React.createElement("div", { className: "we-picker__section-head" },
        React.createElement("span", { className: "we-picker__section-label" }, weT("兼容性")),
      ),
      // Edge 兼容渲染开关：仅在 Edge 中生效（canvas 渲染，避免浏览器自带的
      // 「下载 / 投屏」悬浮工具栏）。
      switchRow(weT("Edge 兼容"), sel.edgeCompat !== false, (e) => onEdgeCompatChange(e.target.checked), {
        hint: weT("Edge 下视频壁纸走 canvas 渲染"),
        tooltip: weT("Edge 兼容：视频壁纸改用 canvas 渲染，避免浏览器自带的「下载 / 投屏」悬浮工具栏；关闭则始终使用原生 <video>"),
      }),
    ),
    );
  }

  function renderAdvancedAdapterSection(ctx) {
    const { onAdapterTarget, sel } = ctx;
    return React.createElement(React.Fragment, null,
    // ── 适配（适配器模式）：本页跑在哪种宿主形态里 —— 自动检测 + 可手选 ──
    // 检测事实来源在宿主侧（能力头 / UA，见 lib/index.js 的 3c-0），客户端拿
    // 上报值 + 本地信号兜底；手选优先于检测，是检测不准时的自救。
    React.createElement("div", { className: "we-picker__section" },
      React.createElement("div", { className: "we-picker__section-head" },
        React.createElement("span", {
          className: "we-picker__section-label",
          title: weT("适配目标决定四件事：网页壁纸载荷走哪个源（有无能力头栅栏）、桌面壳材质规则是否生效、窗口失焦暂停是否适用、面板哪些行可用。默认自动检测，检测不准时可手选覆盖（手选优先）。"),
        }, weT("适配", null, "adapter")),
      ),
      React.createElement("div", { className: "we-picker__ctl" },
        ctlText(weT("适配目标"), weT("自动检测 · 手选可覆盖")),
        React.createElement("select", {
          className: "we-picker__select",
          value: ADAPTER_TARGET_VALUES.includes(sel.adapterTarget) ? sel.adapterTarget : "auto",
          onChange: onAdapterTarget,
          "aria-label": weT("适配目标"),
        },
          ADAPTER_TARGET_VALUES.map((t) =>
            React.createElement("option", { key: t, value: t }, ADAPTER_LABELS[t] || t)),
        ),
      ),
      // 状态行只反映**检测**（与手选无关），且必须与宿主 mediaOriginNeeded 的
      // 三分支逐条对齐 —— 否则文案会说错载荷到底走哪个源：栅栏 ⇒ 独立媒体源；
      // 无栅栏的桌面形态（Electron UA）**仍然**走独立媒体源（安全默认）；只有
      // 原生浏览器才走应用源。desktop/fence 取自 adapterCaps（最终目标 + 上报）。
      React.createElement("div", { className: "we-picker__hint", key: "adapter-detected" },
        weT("检测到：{target}{suffix}", {
          target: weT(adapterDetectedLabel()),
          suffix: adapterCaps().fence
            ? weT(" · 有能力头栅栏（网页壁纸走独立媒体源）")
            : adapterCaps().desktop
              ? weT(" · 无栅栏的桌面形态（网页壁纸仍走独立媒体源）")
              : weT(" · 无栅栏（网页壁纸走应用源）"),
        })),
      adapterMismatchWarning() && React.createElement("div", { className: "we-picker__hint", key: "adapter-warn" },
        adapterMismatchWarning()),
    ),
    );
  }

  function renderAdvancedPowerSection(ctx) {
    const { onPauseOnBattery, onPauseOnBlur, onPauseOnHidden, sel } = ctx;
    return React.createElement(React.Fragment, null,
    // ── 省电：遮挡暂停（借鉴 Wallpaper Engine 的「被遮挡时暂停」）──
    React.createElement("div", { className: "we-picker__section" },
      React.createElement("div", { className: "we-picker__section-head" },
        React.createElement("span", {
          className: "we-picker__section-label",
          title: weT("类似 WE 的遮挡暂停：最小化、切到其它应用或使用电池供电时视频暂停、GPU 解码归零；回到界面 / 接通电源自动继续（网页壁纸仅随页面隐藏被浏览器节流）"),
        }, weT("省电")),
      ),
      switchRow(weT("最小化/切页时暂停"), sel.pauseOnHidden, onPauseOnHidden, { key: "pause-hidden" }),
      // 失焦档按适配目标显隐：桌面壳失焦时壁纸多半仍整块可见，暂停会定格
      // **可见**画面 ⇒ 本目标下不提供；值不删，切到浏览器目标即重新生效。
      adapterCaps().blurPause
        && switchRow(weT("窗口失焦时暂停"), sel.pauseOnBlur, onPauseOnBlur, { key: "pause-blur" }),
      !adapterCaps().blurPause && React.createElement("div", { className: "we-picker__hint", key: "pause-blur-note" },
        weT("「窗口失焦时暂停」只在原生浏览器目标下提供 —— 桌面壳失焦时壁纸仍可见，暂停会定格可见画面{note}", {
          note: sel.pauseOnBlur ? weT("（当前已开启，本目标下不生效，切到浏览器目标后恢复）") : "",
        })),
      switchRow(weT("使用电池时暂停"), sel.pauseOnBattery, onPauseOnBattery, { key: "pause-battery" }),
    ),
    );
  }

  function renderAdvancedCacheSection(ctx) {
    const { onCacheDirDraft, onCancelEditCacheDir, onStartEditCacheDir, sel,
      onCacheDirBrowseInput, onCacheDirBrowseGo, onCacheDirBrowseEnter, onCacheDirBrowseUp, onPickCacheDir, onCloseCacheDirBrowse } = ctx;
    const browse = sel.cacheDirBrowse;
    return React.createElement(React.Fragment, null,
    // ── 缓存位置：转码产物 / faststart 变体 / 静态帧 / 预览图 / 媒体桥缓存都是**可再生**的
    //    大块文件（本机实测到 GB 级），默认落在插件数据目录 —— Windows 上那个目录仍在 C 盘
    //    用户目录下，这正是「C 盘洁癖」的触发点。持久化在宿主 config.json 的 cacheDir，
    //    经 /cache-dir 端点读写；显示值一律取宿主返回的**解析链答案**（设了
    //    `DSH_WE_CACHE_DIR` 时它与用户填的值不同 —— 那是环境变量覆盖，不是保存失败）。──
    React.createElement("div", { className: "we-picker__section" },
      React.createElement("div", { className: "we-picker__section-head" },
        React.createElement("span", { className: "we-picker__section-label" }, weT("缓存位置")),
      ),
      React.createElement("div", { className: "we-picker__uploads" },
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, weT("缓存目录")),
        React.createElement("span", {
          className: "we-picker__uploads-path",
        }, sel.inventory.cacheDir || "—"),
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          disabled: sel.cacheDirBusy,
          onClick: onStartEditCacheDir,
        }, weT("更改")),
      ),
      // 目录浏览器开着时草稿行让位（地址栏就在浏览器里，两行输入框互相打架）；
      // 选中后浏览器收起、草稿行带着填好的路径回来，保存/迁移语义不变。
      sel.editingCacheDir && !browse && React.createElement("div", { className: "we-picker__row" },
        React.createElement("input", {
          className: "we-picker__text", type: "text",
          value: sel.cacheDirDraft,
          placeholder: weT("绝对路径，如 D:\\WallpaperEngineCache"),
          onInput: onCacheDirDraft,
          onKeyDown: (e) => {
            if (e.key === "Enter") changeCacheDir(sel.cacheDirDraft, true);
            if (e.key === "Escape") onCancelEditCacheDir();
          },
        }),
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          disabled: sel.cacheDirBusy,
          onClick: () => changeCacheDir(sel.cacheDirDraft, true),
        }, weT("保存")),
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: onCancelEditCacheDir,
        }, weT("取消")),
      ),
      // 目录浏览器：宿主列目录（GET /cache-dir/browse），这里只管点着进出 ——
      // 客户端不做路径拼接，条目的 path 原样回传问下一级。选中 = 把地址栏（或最后
      // 到达的一级）填进草稿，走既有保存链。
      browse && React.createElement("div", { className: "we-dirpick" },
        React.createElement("div", { className: "we-dirpick__bar" },
          React.createElement("input", {
            className: "we-picker__text we-dirpick__path", type: "text",
            value: browse.display || "",
            placeholder: weT("绝对路径，如 D:\\WallpaperEngineCache"),
            onInput: onCacheDirBrowseInput,
            onKeyDown: (e) => {
              if (e.key === "Enter") onCacheDirBrowseGo();
              if (e.key === "Escape") onCloseCacheDirBrowse();
            },
          }),
          React.createElement("button", {
            className: "we-picker__btn", type: "button",
            disabled: !browse.parent || browse.loading,
            title: weT("上一级"),
            onClick: onCacheDirBrowseUp,
          }, weT("上一级")),
        ),
        React.createElement("div", { className: "we-dirpick__chips" },
          React.createElement("button", {
            className: "we-picker__btn we-dirpick__chip", type: "button",
            disabled: browse.loading,
            onClick: () => onCacheDirBrowseEnter(""),
          }, weT("此电脑")),
          browse.home && React.createElement("button", {
            className: "we-picker__btn we-dirpick__chip", type: "button",
            disabled: browse.loading,
            onClick: () => onCacheDirBrowseEnter(browse.home),
          }, weT("主目录")),
          sel.inventory.cacheDir && React.createElement("button", {
            className: "we-picker__btn we-dirpick__chip", type: "button",
            disabled: browse.loading,
            onClick: () => onCacheDirBrowseEnter(sel.inventory.cacheDir),
          }, weT("当前缓存位置")),
        ),
        React.createElement("div", { className: "we-dirpick__list" },
          browse.loading && React.createElement("div", { className: "we-dirpick__empty" },
            weT("正在读取目录…")),
          !browse.loading && browse.error && React.createElement("div", { className: "we-picker__error" },
            browse.error),
          !browse.loading && !browse.error && !browse.dirs.length && React.createElement("div", { className: "we-dirpick__empty" },
            weT("没有子目录")),
          !browse.loading && browse.dirs.map((d, i) => {
            // 条目形状防御：宿主契约是 { name, path }，但万一拿到裸字符串（服务端形态
            // 漂移）也能渲染出名字、点进去 —— 空行比报错更难排查。
            const label = typeof d === "string" ? d : String((d && d.name) || (d && d.path) || "");
            const path = typeof d === "string" ? d : String((d && d.path) || "");
            return React.createElement("button", {
              key: path || label || i, type: "button", className: "we-dirpick__item",
              title: path,
              onClick: () => onCacheDirBrowseEnter(path),
            }, label || "—");
          }),
        ),
        browse.truncated && React.createElement("div", { className: "we-picker__hint" },
          weT("目录项过多，仅显示部分")),
        React.createElement("div", { className: "we-dirpick__foot" },
          React.createElement("span", {
            className: "we-picker__hint we-dirpick__sel", title: browse.display || "",
          }, browse.display || "—"),
          React.createElement("button", {
            className: "we-picker__btn", type: "button",
            disabled: browse.loading || !(String(browse.display || "").trim() || browse.path),
            onClick: onPickCacheDir,
          }, weT("选择此目录")),
          React.createElement("button", {
            className: "we-picker__btn", type: "button",
            onClick: onCloseCacheDirBrowse,
          }, weT("取消")),
        ),
      ),
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint" },
          weT("已有缓存会迁移到新位置")),
        React.createElement("span", { className: "we-picker__hint" },
          weT("缓存可再生，随时可删")),
      ),
      sel.cacheDirNote && React.createElement("div", { className: "we-picker__hint" },
        sel.cacheDirNote),
      sel.cacheDirError && React.createElement("div", { className: "we-picker__error" },
        sel.cacheDirError),
      ),
    ),
    );
  }

  function renderAdvancedDiagSection(ctx) {
    const { onToggleLiveDiag, sel } = ctx;
    return React.createElement(React.Fragment, null,
    // ── 实时渲染诊断（本会话有效，不落盘）：只对**能走实时
    //    渲染**的壁纸（场景 / 网页）显示 —— 视频、图片壁纸没有渲染页，摆出来是空的。──
    (sel.type === "scene" || sel.type === "web") && sel.sceneLive !== false
      && React.createElement("div", { className: "we-picker__section" },
        React.createElement("div", { className: "we-picker__section-head" },
          React.createElement("span", { className: "we-picker__section-label" }, weT("实时渲染诊断")),
        ),
        // live 诊断日志（本会话有效，不落盘）：默认只记关键事件（准备就绪/领养/
        // 首帧确认/判失败，每轮轮换 2–3 条，写在控制台与宿主诊断缓冲
        // `/wallpaper-engine/diag-log`）；这里开的是**逐秒心跳读数**（fps/running/
        // 暂停原因），排查「为什么没出帧」时用。
        switchRow(
          weT("live 诊断日志"), liveDiagVerbose(), onToggleLiveDiag, {
            key: "scene-live-diag",
            hint: weT("本会话有效 · 逐秒心跳读数"),
            tooltip: weT("开启后每秒记录一次渲染页心跳读数（fps / running / 暂停原因）与准备、领养、判失败事件；同时写入浏览器控制台和宿主诊断缓冲（GET /wallpaper-engine/diag-log）。排查 live 掉帧/降级时用，平时关着。"),
          }),
      ),
    );
  }

export { renderAdvancedBrowsingSection, renderAdvancedCompatSection, renderAdvancedAdapterSection, renderAdvancedPowerSection, renderAdvancedCacheSection, renderAdvancedDiagSection };
