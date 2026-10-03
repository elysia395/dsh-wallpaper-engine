/**
 * panel-tabs.js — 面板页签的**渲染器**（七个域：壁纸 / 外观 / 吉祥物 / 效果 / 声音 / 高级 / 关于，
 * 组合成五页签 壁纸库 / 外观 / 播放 / 系统 / 关于，装配点见 src/client.js 的 renderActiveTab）。
 *
 * 为什么单独一个文件：这些渲染器**读**面板状态、**调**面板处理器，但自己不持有状态 ——
 * 正是最适合独立出去的一层。这样面板组件体只剩"状态 + 处理器 + 装配"，页签怎么画看这里。
 * （「关于」是唯一连面板状态都不读的渲染器：静态文案 + 两张随包二维码。）
 *
 * 契约（构建期由 scripts/build-client.mjs 内联进 bundle 的工厂作用域，"外部作用域"=
 * 同一 prelude / src/client.js 的顶层）：
 *   · 每个渲染器**只从一个参数取外界**：`(ctx)`。函数体**逐字搬入**，唯一改动是开头那段
 *     解构 —— 于是"这个页签要什么"写在签名处，"怎么画"一行没动（模板字符串里的有效空白
 *     也不会被批量重排弄坏）。
 *   · ctx 由 `WallpaperPicker` 在调用点就地组装（见 src/client.js 的 `renderActiveTab`）：
 *     面板的 `sel` / 页签需要的局部视图状态 / 处理器。**多传字段无害，漏传会当场
 *     ReferenceError**（守卫会抓住）—— 这是刻意选的失败方式：响亮且可定位。
 *   · 页签**只做"读 + 组装 React 树"**，四类越界由 `test/verify-client.mjs` 的接缝判据钉住
 *     （与 `src/picker-modal.js` / `src/picker-props-panel.js` **同一条口径**）：
 *       ① 不得引用 `selection`（写入经 ctx 的 `setSetting` / `setTransient` 两个入口）；
 *       ② 不得调 `emit(`（通知归处理器）；
 *       ③ 不得改写 **ctx 别名**指向的东西（`editing` = `selection.editing`、`sel` = store 快照…）
 *          —— `editing.name = …` 是"渲染器成了状态的写入方"，那不是读；
 *       ④ 不得改写**模块级状态**（`propsPanelOpen` / `pickerFocusPending` / `pickerOpener` …）。
 *     ③④ 两类**不是风格问题**：它们不含 `selection.` 字面量，因此躲得过"只数字面量"的判据 ——
 *     那正是本文件长期违规却一直没变红的原因（同一批搬出去的另外两个渲染器早就在严口径下）。
 *   · **动作经具名处理器**：除写设置外还要做别的事（重建层 / 清失败记忆 / 重绘 / 刷库存…）
 *     一律收口成 `src/client.js` 里的 `on*` 处理器，经 ctx 传进来；页签只写 `onClick: onFoo`。
 *     于是"点了会发生什么"住在处理器里，页签只回答"画什么"。
 *   · 模块级依赖（React / SliderRow / switchRow / ctlText / FRAME_VARIANTS / 各类预设表 /
 *     纯函数如 `weT` / `adapterCaps` / `liveRenderEnabled`…）仍按内联规则直接读，不经过 ctx
 *     —— 它们是常量与纯组件/纯函数，与面板状态无关。**判据只盯状态与动作，不盯这些。**
 *   · 本文件必须保持浏览器安全（无 import / require / Node API），且**不得有顶层可执行语句**
 *     读 client.js 的 const（会被内联到 bundle 顶部，撞 TDZ）。
 */

  function renderWallpaperCurrentSection(ctx) {
    const { current, isLiveScene, onClear, onOpenPicker, onRefresh, onToggleAudio, onTogglePlay, onTogglePropsPanel, playbackLive, propsPanelOpen, renderUserPropsPanel, sel, setPickerOpener } = ctx;
    return React.createElement(React.Fragment, null,
    // ── 当前壁纸: vinyl record beside the selection, in both card styles. ──
    React.createElement("div", { className: "we-picker__section" },
      React.createElement("div", { className: "we-picker__section-head" },
        React.createElement("span", { className: "we-picker__section-label" }, weT("当前壁纸")),
      ),
      React.createElement("div", { className: "we-picker__current" },
        React.createElement(VinylRecord, {
          cover: current && current.preview, title: current ? current.title : "",
          playing: playbackLive && Boolean(sel.url) && vinylSpinVisible(),
        }),
        React.createElement("div", { className: "we-picker__current-info" },
          React.createElement("div", { className: "we-picker__current-title", title: current ? current.title : "" },
            sel.id && current ? current.title : weT("未选择壁纸"),
            // 类型 + 播放态：宽卡片里另起一行；抽屉（窄容器）里由 CSS 改成
            // 「名称（类型 · 播放中）」同一行，整行超出省略（见 .we-repo-panel 规则）。
            React.createElement("span", { className: "we-picker__current-meta" },
              current
                ? weT("{type}{status}", {
                    type: { video: weT("视频壁纸"), web: weT("网页壁纸"), image: weT("图片壁纸"), scene: weT(isLiveScene ? "场景壁纸（实时渲染）" : "场景壁纸（静态帧）") }[current.type] || weT("壁纸"),
                    status: weT(playbackLive ? " · 播放中" : " · 已暂停"),
                  })
                : weT("尚未选择壁纸"))),
          // 失败/被过滤的原因说明包一层：抽屉里该层用 display:contents 展开成
          // grid 项（标题已独走第一行），靠这个包裹层保证「一行一项」。
          React.createElement("div", { className: "we-picker__current-sub" },
          // 播放失败原因（#84）: 浏览器解不了的编码 / 解码失败等，过去是
          // 「静默空白」，现在给出可读原因，配合下面的「播放」按钮重试。
          sel.videoError && React.createElement("div", { className: "we-picker__current-error" }, sel.videoError),
          // 选择被过滤条件排除（#84）: 过去壁纸层直接空白、按钮变灰且无任何
          // 说明，现在明确指出是哪一项过滤挡住了、怎么恢复。
          sel.blockedNote && React.createElement("div", { className: "we-picker__current-error" }, sel.blockedNote),
          // 实时渲染失败原因（自动回退到旧链时显示）：让「为什么黑」可见 ——
          // 用户反馈时能直接说明，也提示了重试入口（重开「实时渲染」开关）。
          liveFailReasonOf(sel) && React.createElement("div", { className: "we-picker__current-error" },
            weT("实时渲染失败（{reason}），已自动回退；重新打开「实时渲染」开关可重试", { reason: weT(liveFailReasonOf(sel)) }))
          ),
        ),
        // 主操作区：选择壁纸（下钻库视图）。壁纸属性入口移到下面那排播放控制里、
        // 排在「暂停」之前（同排同级、同款式），见下方的控件行。
        React.createElement("div", { className: "we-picker__current-actions" },
          React.createElement("button", {
            className: "we-picker__btn we-picker__btn--primary", type: "button",
            ref: setPickerOpener,
            onClick: onOpenPicker,
          }, weT("选择壁纸")),
        ),
      ),
      // 属性面板紧贴卡片下方（同一节里），抽屉/弹窗两种形态都可见。
      renderUserPropsPanel(),
      // Playback controls (wallpaper-independent; the thumbnail grid lives in
      // the modal above, so these stay within reach).
      React.createElement("div", { className: "we-picker__row" },
        // 壁纸属性（仅场景/网页壁纸 + 有 propsUrl）：与播放控制同排、同款式
        //（普通 .we-picker__btn；面板开着时 is-on 高亮）——入口与播放控制同级更顺手。
        (current && (current.type === "scene" || current.type === "web") && sel.propsUrl)
          && React.createElement("button", {
            className: "we-picker__btn" + (propsPanelOpen ? " is-on" : ""),
            type: "button",
            title: weT("壁纸作者提供的可调属性（改动立即生效）"),
            onClick: onTogglePropsPanel,
          }, weT("壁纸属性")),
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: onTogglePlay, disabled: !sel.url,
          // 按钮显示真实状态（#84）: 播放失败时回到「播放」，就是用户要的「继续」。
        }, playbackLive ? weT("暂停") : weT("播放", null, "play")),
        // 音乐开关：与「播放」同级的一键切换。只影响音轨，不动播放态 ——
        // 关掉后画面继续播放。仅对含音轨的壁纸类型显示（视频 / 场景内嵌 MP4）。
        //
        // ⚠️ 高亮判据必须与**按钮自己的状态**（也就是下面文案那个判据）**逐字同一个**：
        // 这颗按钮切的是 `videoAudioEnabled`，所以「亮」= 该开关为开。此前写的是
        // `weAudioVolume() > 0 || disabled`（化简后 = 只有"开着且音量为 0"时才亮），于是
        // 出厂默认（`videoVolume: 0` + `videoAudioEnabled: true`）下按钮亮着而壁纸是哑的，
        // 用户一点（音轨关掉）高亮反而消失 —— 文案与高亮互相矛盾，且点击没有任何视觉反馈。
        // 音量是**另一颗**控件，不参与这颗按钮的开关状态。
        (sel.type === "video" || (sel.type === "scene" && (sel.sceneVideo || sel.sceneHasAudio)))
          && React.createElement("button", {
            className: "we-picker__btn" + (sel.videoAudioEnabled === false ? "" : " is-on"),
            type: "button",
            onClick: onToggleAudio,
            disabled: !sel.url,
            title: sel.videoAudioEnabled === false
              ? weT("开启壁纸音轨（音量为 0 时自动设为 50%）")
              : weT("关闭壁纸音轨（画面继续播放）"),
          }, sel.videoAudioEnabled === false ? weT("🔇 音乐关") : weT("🔊 音乐开")),
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: onClear, disabled: !sel.id,
          title: weT("清除当前壁纸（停止播放，回到无壁纸状态）"),
        }, weT("清除")),
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: onRefresh, disabled: sel.loading,
        }, sel.loading ? weT("刷新中…") : weT("刷新")),
      ),
    ),
    );
  }

  function renderWallpaperTransitionSection(ctx) {
    const { onSwitchTransition, onSwitchTransitionDir, onSwitchTransitionSpeed, sel } = ctx;
    const switchTr = switchTransitionOf(sel);
    return React.createElement(React.Fragment, null,
    // ── 切换过场（手动点选与自动轮播共用）：类型 / 方向 / 速度 ──
    // 默认「硬切」（零成本、零风险）；等「最帅的」讨论定下来，改 DEFAULTS 一处
    // 即可换默认。每种过场只动 transform / opacity / clip-path（见 switchFrames）。
    React.createElement("div", { className: "we-picker__section" },
      React.createElement("div", { className: "we-picker__section-head" },
        React.createElement("span", { className: "we-picker__section-label" }, weT("切换过场")),
      ),
      // 过场动画：**下拉菜单**（不用水平平铺）—— 过场会持续增加，平铺一排按钮
      // 迟早挤成两行、还会把「方向 / 时长」挤下去；下拉天然可扩展。
      React.createElement("div", { className: "we-picker__ctl" },
        ctlText(weT("过场动画"), weT("换壁纸时的转场")),
        React.createElement("select", {
          className: "we-picker__select",
          value: sel.switchTransition,
          onChange: (e) => onSwitchTransition(e.target.value),
          "aria-label": weT("过场动画"),
        },
          ...SWITCH_TRANSITIONS.map((t) =>
            React.createElement("option", { key: t.id, value: t.id }, t.label)),
        ),
      ),
      // 方向：只有方向型过场（推移 / 擦除 / 条带）听它；条带用它决定竖条 / 横条。
      switchTr.directional && React.createElement("div", { className: "we-picker__ctl we-picker__ctl--wrap" },
        ctlText(weT("方向"), weT("新画面从哪边进")),
        React.createElement("div", { className: "we-picker__seg" },
          SWITCH_DIRS.map((d) =>
            React.createElement("button", {
              key: d,
              className: "we-picker__btn we-picker__rate" + (sel.switchTransitionDir === d ? " we-picker__rate--active" : ""),
              type: "button",
              onClick: () => onSwitchTransitionDir(d),
              "aria-pressed": sel.switchTransitionDir === d ? "true" : "false",
              "aria-label": weT("过场方向 {dir}", { dir: weT(SWITCH_DIR_LABELS[d]) }),
            }, SWITCH_DIR_LABELS[d]),
          ),
        ),
      ),
      // 时长档：只影响速度乘子，基准时长写在各过场里（见 SWITCH_TRANSITIONS）。
      switchTr.ms > 0 && React.createElement("div", { className: "we-picker__ctl we-picker__ctl--wrap" },
        ctlText(weT("时长"), weT("当前约 {ms} ms", { ms: switchTr.ms })),
        React.createElement("div", { className: "we-picker__seg" },
          SWITCH_SPEEDS.map((s) =>
            React.createElement("button", {
              key: s.id,
              className: "we-picker__btn we-picker__rate" + (sel.switchTransitionSpeed === s.id ? " we-picker__rate--active" : ""),
              type: "button",
              onClick: () => onSwitchTransitionSpeed(s.id),
              "aria-pressed": sel.switchTransitionSpeed === s.id ? "true" : "false",
              "aria-label": weT("过场速度 {speed}", { speed: weT(s.label) }),
            }, s.label),
          ),
        ),
      ),
    ),
    );
  }

  function renderWallpaperRotationSection(ctx) {
    const { INTERVALS, armedConfirm, editing, group, groups, onArmDeleteGroup, onDeleteGroup, onDisarmConfirm, onEditInterval, onEditName, onEditOrder, onGroupChange, onGroupInterval, onOpenPickerDraft, onToggleRotation, playableCount, sel } = ctx;
    const groupToken = group ? "group:" + group.id : "";
    return React.createElement(React.Fragment, null,
    // ── 自动轮播（原「轮播列表」）: user-defined carousel lists, each with its own
    //    wallpaper set, interval and order. Persisted as `rotationGroups` (host config.json). ──
    React.createElement("div", { className: "we-picker__section" },
      React.createElement("div", { className: "we-picker__section-head" },
        React.createElement("span", { className: "we-picker__section-label" }, weT("自动轮播")),
      ),
      React.createElement("div", { className: "we-picker__row we-picker__playlist-row" },
      React.createElement("select", {
        className: "we-picker__playlist-select",
        value: sel.rotationGroupId,
        onChange: onGroupChange,
        disabled: groups.length === 0,
        "aria-label": weT("轮播列表"),
      },
      React.createElement("option", { value: "" }, groups.length ? weT("— 选择轮播列表 —") : weT("— 暂无轮播列表 —")),
      ...groups.map((g) => React.createElement("option", {
        key: g.id, value: g.id,
      }, weT("{name}（{count} 可播放 · {interval} 分钟）", { name: g.name, count: groupWallpapers(g).length, interval: g.interval }))),
      ),
      React.createElement("button", {
        className: "we-picker__btn", type: "button",
        onClick: startCreateGroup,
      }, weT("新建")),
      React.createElement("button", {
        className: "we-picker__btn", type: "button",
        onClick: () => startEditGroup(sel.rotationGroupId),
        disabled: !sel.rotationGroupId,
      }, weT("编辑")),
      React.createElement("button", {
        className: "we-picker__btn", type: "button",
        // 第一下只置令牌（`onArmDeleteGroup`）；落地在下面那行问句的「确认」里。
        // 待确认时**置灰**（不隐藏、不换位置）：按钮仍占着那一格，宽度就完全不变，
        // 而且它指路到问句行 —— 留着可点会让"再点一下是不是就删了"变成猜测。
        onClick: onArmDeleteGroup,
        disabled: !sel.rotationGroupId || armedConfirm === groupToken,
        title: armedConfirm === groupToken
          ? weT("已经问过你了 —— 在下面那一行选「确认」或「取消」")
          : weT("删除这个轮播列表（会再问一次）"),
      }, weT("删除")),
    ),
    renderConfirmRow(armedConfirm, groupToken,
      weT("删除轮播列表「{name}」？此操作不可恢复。", { name: (group && group.name) || "" }),
      onDeleteGroup, onDisarmConfirm),
    editing && React.createElement("div", { className: "we-picker__editor" },
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, weT("名称")),
        React.createElement("input", {
          className: "we-picker__text", type: "text",
          value: editing.name,
          "aria-label": weT("轮播列表名称"),
          onInput: onEditName,
        }),
      ),
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, weT("间隔")),
        React.createElement("select", {
          className: "we-picker__rotation-interval",
          value: String(editing.interval),
          onChange: onEditInterval,
          "aria-label": weT("轮播间隔"),
        },
        ...INTERVALS.map((minutes) =>
          React.createElement("option", { key: minutes, value: String(minutes) }, weT("{min} 分钟", { min: minutes })),
        )),
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, weT("顺序")),
        React.createElement("select", {
          className: "we-picker__playlist-select",
          value: editing.order,
          onChange: onEditOrder,
          "aria-label": weT("轮播顺序"),
        },
        React.createElement("option", { value: "sequence" }, weT("顺序", null, "seq")),
        React.createElement("option", { value: "random" }, weT("随机")),
        ),
      ),
      // 选片走**页内下钻**（与「选择壁纸」同一套库视图）：点按钮进库浏览，
      // 卡片点击 = 加入/移出草稿（pickerDraft），顶部提示已选数；「返回」回编辑器。
      // 这里**只有一行入口按钮、没有内联网格**：大库在 24px 缩略图里翻页选片不可用，
      // 全尺寸浏览 + 搜索/过滤才是选片的正确形态。
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("button", {
          className: "we-picker__btn we-picker__btn--primary", type: "button",
          onClick: onOpenPickerDraft,
        }, weT("选择壁纸")),
        React.createElement("span", { className: "we-picker__hint" },
          weT("下钻进库挑选 · 点卡片加入 / 移出")),
      ),
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint" }, weT("已选 {count} 个", { count: editing.wallpaperIds.length })),
        sel.inventory.playlists.length > 0 && React.createElement("select", {
          className: "we-picker__playlist-select",
          value: "",
          onChange: (e) => {
            const p = sel.inventory.playlists.find((pl) => pl.id === e.target.value);
            if (p) importPlaylistIntoDraft(p);
          },
        },
        React.createElement("option", { value: "" }, weT("从 WE 播放列表导入…")),
        ...sel.inventory.playlists.map((p) => React.createElement("option", {
          key: p.id, value: p.id,
        }, weT("{name}（{count} 可播放）", { name: p.name, count: p.portableCount || 0 }))),
        ),
      ),
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: saveEditingGroup,
        }, weT("保存")),
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: cancelEditGroup,
        }, weT("取消")),
      ),
    ),
    React.createElement("div", { className: "we-picker__ctl" },
      ctlText(weT("自动轮转"),
        !sel.rotationGroupId
          ? weT("请先选择或新建一个轮播列表")
          : playableCount < 2
            ? weT("当前列表至少需要 2 个可播放壁纸")
            : weT("每 {min} 分钟切换一次", { min: group ? group.interval : DEFAULTS.rotationInterval })),
      React.createElement("div", { className: "we-picker__ctl-side" },
        React.createElement("select", {
          className: "we-picker__rotation-interval",
          value: String(group ? group.interval : DEFAULTS.rotationInterval),
          onChange: onGroupInterval,
          disabled: !sel.rotationEnabled || !sel.rotationGroupId || playableCount < 2,
          "aria-label": weT("轮转间隔"),
        },
        ...INTERVALS.map((minutes) =>
          React.createElement("option", { key: minutes, value: String(minutes) }, weT("{min} 分钟", { min: minutes })),
        )),
        Toggle({
          checked: sel.rotationEnabled,
          onChange: onToggleRotation,
          label: weT("自动轮转"),
          disabled: !sel.rotationGroupId || playableCount < 2,
          title: weT("按列表顺序/随机自动切换壁纸"),
        }),
      ),
    ),
    ),
    );
  }

  function renderWallpaperUploadsSection(ctx) {
    const { armedConfirm, group, onArmConfirm, onCancelEditUploadDir, onCancelEditWeAssetsDir, onDisarmConfirm, onStartEditUploadDir, onStartEditWeAssetsDir, onUploadDirDraft, onWeAssetsDirDraft, playableCount, playableList, sel, uploadedList } = ctx;
    const uploadToken = (w) => "upload:" + w.id;
    return React.createElement(React.Fragment, null,
    // ── 自定义壁纸: local JPG/PNG/MP4 as wallpapers. Files are written by the
    //    host into its plugin-managed directory and served through the same
    //    media/preview routes (read-A storage: survives restarts, no quota
    //    limits). Uploads merge into the inventory on the host side. ──
    React.createElement("div", { className: "we-picker__section" },
      React.createElement("div", { className: "we-picker__section-head" },
        React.createElement("span", { className: "we-picker__section-label" }, weT("自定义壁纸")),
      ),
      React.createElement("div", { className: "we-picker__uploads" },
      // Storage location — users can point uploads at a non-system drive
      // (most people don't want wallpaper files piling up on C:). The host
      // persists the choice and migrates existing files on change.
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, weT("存储位置")),
        React.createElement("span", {
          className: "we-picker__uploads-path",
        }, sel.inventory.uploadDir || "—"),
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          disabled: sel.uploading,
          onClick: onStartEditUploadDir,
        }, weT("更改")),
      ),
      sel.editingUploadDir && React.createElement("div", { className: "we-picker__row" },
        React.createElement("input", {
          className: "we-picker__text", type: "text",
          value: sel.uploadDirDraft,
          placeholder: weT("绝对路径，如 D:\\MyWallpapers"),
          onInput: onUploadDirDraft,
          onKeyDown: (e) => {
            if (e.key === "Enter") changeUploadDir(sel.uploadDirDraft, true);
            if (e.key === "Escape") onCancelEditUploadDir();
          },
        }),
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          disabled: sel.uploading,
          onClick: () => changeUploadDir(sel.uploadDirDraft, true),
        }, weT("保存")),
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: onCancelEditUploadDir,
        }, weT("取消")),
      ),
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint" },
          weT("已有文件会迁移到新位置")),
        React.createElement("span", { className: "we-picker__hint" },
          weT("支持 ~ 表示用户主目录")),
      ),
      // ── 官方资源路径（local-assets）：场景实时渲染的 util、particle、
      // gradient 贴图默认是程序化复刻（观感近似）；指向本机 WE 安装目录的
      // assets 树后按名取官方像素，与官方引擎逐像素对齐。素材属 WE 版权
      // 内容，只从本机路径只读取用，不会被复制/上传。路径不硬编码 ——
      // 持久化在宿主 config.json（weAssetsDir），经 we-assets-dir 端点读写。
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, weT("官方资源路径")),
        React.createElement("span", {
          className: "we-picker__uploads-path",
        }, sel.inventory.weAssetsDir || "—"),
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: onStartEditWeAssetsDir,
        }, sel.inventory.weAssetsDir ? weT("更改") : weT("设置")),
      ),
      sel.editingWeAssetsDir && React.createElement("div", { className: "we-picker__row" },
        React.createElement("input", {
          className: "we-picker__text", type: "text",
          value: sel.weAssetsDirDraft,
          placeholder: weT("WE assets 绝对路径，留空保存=清除"),
          onInput: onWeAssetsDirDraft,
          onKeyDown: (e) => {
            if (e.key === "Enter") changeWeAssetsDir(sel.weAssetsDirDraft);
            if (e.key === "Escape") onCancelEditWeAssetsDir();
          },
        }),
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: () => changeWeAssetsDir(sel.weAssetsDirDraft),
        }, weT("保存")),
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: onCancelEditWeAssetsDir,
        }, weT("取消")),
      ),
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint" },
          sel.inventory.weAssetsAvailable
            ? weT("已启用 · 场景实时渲染取官方像素")
            : (sel.inventory.weAssetsDir
              ? weT("目录不可用（缺 materials/），场景实时渲染走程序化复刻")
              : weT("未配置 · 场景实时渲染贴图走程序化复刻"))),
        React.createElement("span", { className: "we-picker__hint" },
          weT("指向 Wallpaper Engine 安装目录的 assets（或其拷贝）")),
      ),
      sel.weAssetsError && React.createElement("div", { className: "we-picker__error" },
        sel.weAssetsError,
      ),
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint we-picker__label" }, weT("自定义")),
        React.createElement("input", {
          className: "we-picker__file", type: "file",
          accept: ".jpg,.jpeg,.png,.mp4",
          disabled: sel.uploading,
          onChange: (e) => {
            const f = e.target.files && e.target.files[0];
            if (f) uploadWallpaperFile(f);
            e.target.value = "";
          },
        }),
        sel.uploading && React.createElement("span", { className: "we-picker__hint" }, weT("上传中…")),
      ),
      sel.uploadError && React.createElement("div", { className: "we-picker__error" }, sel.uploadError),
      sel.uploadNote && React.createElement("div", { className: "we-picker__note" }, sel.uploadNote),
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("span", { className: "we-picker__hint" }, weT("已上传 {count} 个", { count: uploadedList.length })),
        React.createElement("span", { className: "we-picker__hint" }, weT("支持 JPG / PNG / MP4，及含 project.json 的 WE 壁纸目录")),
      ),
      uploadedList.length > 0 && React.createElement("div", { className: "we-picker__uploads-list" },
        uploadedList.map((w) => React.createElement(React.Fragment, { key: w.id },
          React.createElement("div", { className: "we-picker__uploads-item" },
          React.createElement("span", { className: "we-picker__uploads-name", title: w.title }, w.title),
          React.createElement("span", { className: "we-picker__hint" }, w.type === "video" ? "MP4" : weT("图片")),
          React.createElement("button", {
            className: "we-picker__btn", type: "button",
            // **会删本地文件** ⇒ 这一处最需要两下：第一下只置令牌。
            onClick: () => onArmConfirm(uploadToken(w)),
            disabled: sel.uploading || armedConfirm === uploadToken(w),
            title: armedConfirm === uploadToken(w)
              ? weT("已经问过你了 —— 在下面那一行选「确认」或「取消」")
              : weT("移除这个自定义壁纸（会再问一次，且会删除本地文件）"),
          }, weT("移除")),
          ),
          // 问句行紧跟它自己那一项（挂在同一个 `key` 下，位置不会串到别的壁纸那里）。
          renderConfirmRow(armedConfirm, uploadToken(w),
            weT("移除自定义壁纸「{name}」？此操作会删除本地文件，且不可恢复。", { name: w.title }),
            () => removeUploadWallpaper(w.id), onDisarmConfirm),
        )),
      ),
      ),
    ),
    React.createElement("div", { className: "we-picker__row" },
      React.createElement("span", { className: "we-picker__hint" },
        (group
          ? weT("列表「{name}」：{count} 项 · {playable} 可播放 · 每 {interval} 分钟 · {order}{rotating}", {
            name: group.name,
            count: group.wallpaperIds.length,
            playable: playableCount,
            interval: group.interval,
            order: group.order === "random" ? weT("随机") : weT("顺序", null, "seq"),
            rotating: sel.rotationEnabled ? weT(" · 自动轮转中") : "",
          })
          : weT("{count} 个可播放壁纸{rotating}", { count: playableList.length, rotating: sel.rotationEnabled ? weT(" · 自动轮转中") : "" }))),
    ),
    );
  }
  // 这一层不再自己画，只**按顺序组装**各节（"有哪几节、什么顺序"一眼可读；
  // 判据按真渲染的节序列钉住，见 verify-scene-live 的节顺序一节）。
  function renderWallpaperTab(ctx) {
    const { } = ctx;
    return React.createElement(React.Fragment, null,
      renderWallpaperCurrentSection(ctx),
      renderWallpaperTransitionSection(ctx),
      renderWallpaperRotationSection(ctx),
      renderWallpaperUploadsSection(ctx),
    );
  }


  function renderAppearanceThemeSection(ctx) {
    const { onAccent, onToggleThemeFollow, sel } = ctx;
    return React.createElement(React.Fragment, null,
    // ── 主题：配色（accent）**只留配色** —— 玻璃四件套已归入「玻璃 UI」节 ──
    React.createElement("div", { className: "we-picker__section" },
      React.createElement("div", { className: "we-picker__section-head" },
        React.createElement("span", { className: "we-picker__section-label" }, weT("主题")),
      ),
      // 主题随壁纸：总开关（**默认关** = 不按壁纸自动改深浅主题；**试验性功能**，行内已标注）。
      // 开着时才取色判决，并把**最近一次结论**摊开（"为什么判成浅色"要能当场答）；
      // 关着时这个功能整体不生效。见 src/theme-follow.js。
      switchRow(weT("主题随壁纸"), sel.themeFollow === true, (e) => onToggleThemeFollow(e.target.checked), {
        key: "theme-follow",
        hint: weT("试验性功能 · 关 = 不按壁纸自动改深浅主题（默认关）"),
        tooltip: weT("试验性功能：开着时按当前壁纸自动切全局深/浅：作者配色 → 画面主色，两条腿不一致时取深色；在 DSH 设置里手动改过主题后，本张壁纸不再自动。关（默认）时这个功能整体不生效：不取色、不判决、不改主题；切换开关立刻生效。"),
      }),
      sel.themeFollow === true && sel.themeFollowLine
        && React.createElement("div", { className: "we-picker__hint", key: "theme-follow-line" },
          weT("当前：{line}", { line: weT(sel.themeFollowLine) })),
      swatchRow(weT("配色"), ACCENT_PRESETS, sel.accent, onAccent, { key: "accent" }),
    ),
    );
  }

  function renderAppearanceDetailSection(ctx) {
    const { onBorder, onGlassChildParam, onLeftSidebarGlass, onToggleChildIndependent, childIndependentOn, sel, surface } = ctx;
    // ⚠️ 简化配置 vs 复杂配置（wip §10.22 的规则）：**「独立配置」层属复杂配置**
    //    ⇒ 侧栏那一档不画它（本节其余项照旧两档都画：左侧栏覆盖本身是乙类显示开关）。
    const sidebarSurface = surface === "sidebar";
    return React.createElement(React.Fragment, null,
    // ── 细节：边框强调 + 左侧栏覆盖（原「效果」页签的材质细调项与本页的左侧栏项）──
    // 玻璃四件套与「雾化」已归入「玻璃 UI」节；本节的「边框」是**非釉层**参数
    //（边框 / 分割线对比度），不属于玻璃配方，故留在细节。
    React.createElement("div", { className: "we-picker__section" },
      React.createElement("div", { className: "we-picker__section-head" },
        React.createElement("span", { className: "we-picker__section-label" }, weT("细节")),
      ),
      SliderRow(weT("边框"), 0, 90, 5, Math.round(sel.border * 100), onBorder, Math.round(sel.border * 100) + "%", "border-emphasis", {
        tooltip: weT("提高边框 / 分割线的对比度（浅色与深色主题通用）"),
      }),
      // ── 「左侧栏覆盖」及其子项**已搬进「玻璃 UI」节**（用户口径，见 §10.25）──
      // 为什么现在可以并进去：它当初被排除，是因为「玻璃 UI」那节里有"关 = 回原生纯色"的显示开关
      // （乙类语义冲突）；那一层已在 §10.20 整体退役 ⇒ 冲突消失，面控件与其余玻璃配置同处更顺。
      // 门槛照旧（`leftSidebarGlass` 前提 + `!sidebarSurface` 的复杂配置边界），见 `src/glass-panel.js`。
      // 本节只剩「边框」——它是**非釉层**参数（边框 / 分割线对比度），不属于玻璃配方，故留在细节。
    ),
    );
  }

  function renderAppearanceFontSection(ctx) {
    const { officialColorOf, onComponentFamily, onComponentFont, onFontAdvanced, onFontResetAll, onThemeColor, onThemeColorClear, onThemeDarkSeparate, onThemeFamily, onThemeSize, onThemeTypeOnly, onThemeWeight, onToggleFontCustom, fontSet, sel, surface } = ctx;
    const sidebarSurface = surface === "sidebar";
    // 「排版角色」表要按「只看改过的」筛，而**筛完是空**时要单独给一行提示 ⇒ 先算出来再渲染表。
    // ⚠️ 必须在 `React.createElement(...)` **之前**算（写成参数位置上的赋值表达式 ——
    //    赋值表达式的值是那个**数组本身**，于是它被当成一个子节点 ⇒ React #31「对象不能作为子节点」；
    //    空数组时看不出来，一旦有筛出来的角色就整块面板崩掉）。
    const typeRoles = THEME_TYPE_ROLES.filter((role) => !sel.themeTypeOnly
      || sel.themeSize[role.id] !== undefined
      || sel.themeWeight[role.id] !== undefined
      || sel.themeFamily[role.id] !== undefined);
    return React.createElement(React.Fragment, null,
    // ── 字体 (custom typography)：原「字体」页签并入「外观」——总开关（关 =
    //    恢复 dsh 原生字体）+ 颜色角色 / 排版角色 / 字体族 / 组件字体（高级），
    //    开启时才渲染细节控件。字重不设全局值：按角色与按组件细化。 ──
    !sidebarSurface && React.createElement("div", { className: "we-picker__section" },
      React.createElement("div", { className: "we-picker__section-head" },
        React.createElement("span", { className: "we-picker__section-label" }, weT("全局字体")),
      ),
      switchRow(weT("字体自定义"), sel.fontCustom, (e) => onToggleFontCustom(e.target.checked), {
        tooltip: weT("关闭后恢复 dsh 默认字体外观；开启后可调颜色角色、排版角色（字号/字重/字族）与组件字体"),
      }),
      // 「恢复默认」只在总开关开启时出现：关闭时字体本就是 DSH 默认值，摆一个"恢复默认"
      // 没有意义（也会让人以为关掉开关还残留了什么自定义）。
      sel.fontCustom && React.createElement("div", { className: "we-picker__ctl" },
        React.createElement("button", {
          type: "button",
          className: "we-picker__chip",
          onClick: onFontResetAll,
          title: weT("清空所有字体自定义项（颜色角色 / 排版 / 字重 / 字族 / 组件字体），回到 DSH 默认"),
        }, weT("恢复默认")),
      ),
      sel.fontCustom && React.createElement(React.Fragment, null,
        // F1：分角色上色。原「字体颜色」把四个角色压成同一个色（把 DSH 的四级文字层次
        // 压平）—— 那条全局折叠路径已随全局字体层删除；这里逐个角色放开，留空 = 跟随
        // 原生。经 theme 令牌层生效：body 内联、免 !important、{light,dark} 随配色自动换值。
        React.createElement("div", { className: "we-picker__ctl we-picker__ctl--wrap" },
          ctlText(weT("文字颜色角色"), weT("未设置 = 用 DSH 默认色（色块显示当前值）")),
        ),
        switchRow(weT("深色单独设置"), sel.themeDarkSeparate, (e) => onThemeDarkSeparate(e.target.checked), {
          tooltip: weT("关闭时一个颜色同时用于浅色与深色两套（内部仍存两套值）；开启后浅色/深色分别设置"),
        }),
        THEME_COLOR_ROLES.map((role) => {
          const v = sel.themeColors[role.id] || { light: "", dark: "" };
          return React.createElement("div", { className: "we-picker__ctl", key: role.id },
            ctlText(role.label),
            React.createElement("label", { className: "we-picker__swatch-custom" },
              React.createElement("input", {
                type: "color",
                value: v.light || officialColorOf(role.tokens) || "#ffffff",
                onInput: (e) => onThemeColor(role.id, "light", e.target.value, sel.themeDarkSeparate),
                onChange: (e) => onThemeColor(role.id, "light", e.target.value, sel.themeDarkSeparate),
                title: weT("{role} · 浅色配色", { role: weT(role.label) }),
              }),
              React.createElement("span", { className: "we-picker__hint we-picker__value" },
                v.light ? weT("浅 {color}", { color: v.light }) : (officialColorOf(role.tokens) || weT("跟随"))),
            ),
            sel.themeDarkSeparate && React.createElement("label", { className: "we-picker__swatch-custom" },
              React.createElement("input", {
                type: "color",
                value: v.dark || officialColorOf(role.tokens) || "#000000",
                onInput: (e) => onThemeColor(role.id, "dark", e.target.value, true),
                onChange: (e) => onThemeColor(role.id, "dark", e.target.value, true),
                title: weT("{role} · 深色配色", { role: weT(role.label) }),
              }),
              React.createElement("span", { className: "we-picker__hint we-picker__value" },
                v.dark ? weT("深 {color}", { color: v.dark }) : (officialColorOf(role.tokens) || weT("跟随"))),
            ),
            (v.light || v.dark) && React.createElement("button", {
              type: "button",
              className: "we-picker__chip",
              onClick: () => onThemeColorClear(role.id),
              title: weT("清除该角色，回到原生层次"),
            }, weT("清除")),
          );
        }),
        // F2/G4：排版角色（**绝对字号**）。用户口径：字号用绝对值、默认值可见 ——
        // 未填时输入框显示 DSH 官方字号（角色表的 defaultPx），清空即回它。
        // 已确认接受的副作用：设过绝对值的角色不再随 DSH「通用 → 字号」缩放（未设的照旧跟随）；
        // 行高一律沿用 DSH 的令牌，不随绝对值缩放。我们始终**不写** --dsh-content-font-size（红线 3）。
        React.createElement("div", { className: "we-picker__ctl we-picker__ctl--wrap" },
          ctlText(weT("排版角色"), weT("字号 px；留空 = 不改（字号/字重显示 DSH 当前值，字族选「跟随」）")),
        ),
        switchRow(weT("只看改过的"), sel.themeTypeOnly, (e) => onThemeTypeOnly(e.target.checked), {
          tooltip: weT("只列出改过字号/字重/字族的角色，便于收尾核对"),
        }),
        // 表格化：表头放「字号 / 字重 / 字体」，一行一个角色 —— 三项在固定列上对齐，
        // 比每行重复三个无标签控件好扫读（颜色角色那张形状不同，仍用行式）。
        // 「只看改过的」**默认开** ⇒ 一行都没改过时表是空的：那种"空表"必须有话说，
        // 否则看着像坏了（这也是把默认值翻成开之后必须同时补的一件事）。
        typeRoles.length === 0
          ? React.createElement("div", { className: "we-picker__hint" },
            weT("没有改过的角色 —— 「只看改过的」正开着（共 {count} 个角色）。关掉它就能看到全部。", { count: THEME_TYPE_ROLES.length }))
          : null,
        React.createElement("table", { className: "we-picker__font-table" },
          React.createElement("thead", null,
            React.createElement("tr", null,
              React.createElement("th", null, weT("角色")),
              React.createElement("th", null, weT("字号")),
              React.createElement("th", null, weT("字重")),
              React.createElement("th", null, weT("字体")),
            ),
          ),
          React.createElement("tbody", null,
        typeRoles
          .map((role) => {
            const size = sel.themeSize[role.id];
            return React.createElement("tr", { key: role.id },
              React.createElement("td", null, ctlText(role.label)),
              React.createElement("td", null, React.createElement("input", {
                type: "number",
                value: size === undefined ? role.defaultPx : size,
                min: THEME_SIZE_MIN,
                max: THEME_SIZE_MAX,
                step: 1,
                style: { width: "46px" },
                onChange: (e) => onThemeSize(role.id, e.target.value),
                title: weT("{role}：字号 px（清空即回 DSH 默认 {px}px）", { role: weT(role.label), px: role.defaultPx }),
              })),
              React.createElement("td", null, React.createElement("input", {
                type: "number",
                value: sel.themeWeight[role.id] === undefined
                  ? (role.prefix ? Number(role.prefix) : 400)
                  : sel.themeWeight[role.id],
                min: 100,
                max: 900,
                step: 100,
                style: { width: "54px" },
                onChange: (e) => onThemeWeight(role.id, e.target.value),
                title: weT("{role}：字重 100–900（清空即回默认）", { role: weT(role.label) }),
              })),
              React.createElement("td", null, React.createElement("select", {
                value: sel.themeFamily[role.id] === undefined ? "" : sel.themeFamily[role.id],
                style: { width: "92px" },
                onChange: (e) => onThemeFamily(role.id, e.target.value),
                title: weT("{role}：字族（跟随 = 不覆盖，用 DSH 该角色的字族）", { role: weT(role.label) }),
              },
                React.createElement("option", { value: "" }, weT("跟随")),
                FONT_FAMILY_LABELS.map((f) =>
                  React.createElement("option", { key: f.v, value: f.v }, f.label)),
              )),
            );
          }),
          ),
        ),
        // G3/G4：组件字体 —— 属"高级"，收进本区内的「高级字体设置」子分支
        //（是"字体"的子分支，**不是**「高级」页签）。三条来自静态分析的纪律：
        //   ① 命中靠启动自探测（未命中的组件整条不生效，改名即降级、不误伤）；
        //   ② 代码块/终端的字体来自后代 `font:` 简写 ⇒ 只有官方 `--dsl-*` 钩子这条腿有效；
        //   ③ 不填 = 不生成规则（DSH 官方值）。
        switchRow(weT("高级字体设置"), sel.fontAdvanced, (e) => onFontAdvanced(e.target.checked), {
          tooltip: weT("按组件细化（模块前缀通道 + 官方 --dsl-* 钩子）：只对探测到的组件生效；不填即用 DSH 默认值"),
        }),
        sel.fontAdvanced && React.createElement(React.Fragment, null,
          React.createElement("div", { className: "we-picker__ctl we-picker__ctl--wrap" },
            ctlText(weT("组件字体"), weT("未填时显示该组件当前的 DSH 默认值（— = 此刻不在页面上）；清空即回默认")),
          ),
          // 表格化：与「排版角色」表同构 —— 表头放「字号 / 字重 / 字体」，一行一个组件。
          React.createElement("table", { className: "we-picker__font-table" },
            React.createElement("thead", null,
              React.createElement("tr", null,
                React.createElement("th", null, weT("组件")),
                React.createElement("th", null, weT("字号")),
                React.createElement("th", null, weT("字重")),
                React.createElement("th", null, weT("字体")),
              ),
            ),
            React.createElement("tbody", null,
          COMPONENT_FONT_TARGETS.map((target) => {
            const c = sel.componentFonts[target.id] || {};
            // 未填时**直接显示 DSH 当前默认值**（启动自探测时顺带读回的 computed 值）。
            const d = (typeof componentFontDefaults === "function"
              ? componentFontDefaults()[target.id] : null) || {};
            const famKey = FONT_FAMILY_LABELS.reduce(
              (acc, f) => (acc === "" && c.family !== undefined && fontFamilyStack(f.v) === c.family ? f.v : acc), "");
            return React.createElement("tr", { key: target.id },
              React.createElement("td", null, ctlText(weT(target.label), weT("{group} · 走 {route}", { group: weT(target.group), route: target.route }))),
              React.createElement("td", null, React.createElement("input", {
                type: "number",
                value: c.size === undefined ? (d.size || "") : c.size,
                placeholder: d.size ? "" : "—",
                min: 6,
                max: 40,
                style: { width: "44px" },
                onChange: (e) => onComponentFont(target.id, "size", e.target.value),
                title: weT("{target}：字号 px（清空即回 DSH 默认{suffix}）", { target: weT(target.label), suffix: d.size ? " " + d.size + "px" : "" }),
              })),
              React.createElement("td", null, React.createElement("input", {
                type: "number",
                value: c.weight === undefined ? (d.weight || "") : c.weight,
                placeholder: d.weight ? "" : "—",
                min: 100,
                max: 900,
                step: 100,
                style: { width: "54px" },
                onChange: (e) => onComponentFont(target.id, "weight", e.target.value),
                title: weT("{target}：字重 100–900（清空即回 DSH 默认{suffix}）", { target: weT(target.label), suffix: d.weight ? " " + d.weight : "" }),
              })),
              React.createElement("td", null, React.createElement("select", {
                value: famKey,
                style: { width: "96px" },
                onChange: (e) => onComponentFamily(target.id, e.target.value),
                title: weT("{target}：字体族（跟随 = 不覆盖，用 DSH 默认）", { target: weT(target.label) }),
              },
                React.createElement("option", { value: "" }, weT("跟随")),
                FONT_FAMILY_LABELS.map((f) =>
                  React.createElement("option", { key: f.v, value: f.v }, f.label)),
              )),
            );
          }),
            ),
          ),
        ),
        // 全局字重已移除（与「字体颜色」同一类问题：一个全局值会把 DSH 的粗细层次压成
        // 一档）。字重改**按角色**细化（下面「排版角色」每行一个输入框）与**按组件**细化
        // （「高级字体设置」里每组件一项），都能填任意值；留空/「恢复默认」即回 DSH 官方字重。
        // 全局字体族已移除：字族改按角色（「排版角色」每行的字族下拉）
        // 与按组件（「高级字体设置」里每项的下拉）设置 —— 全局字族只经 body 继承，
        // 既压平 DSH 的字体栈层次，又够不到用 `font:` 简写的标题/表格/代码。
        // ── 字体集（**「字体自定义」的附属**）：总开关管"要不要自定义"，这里管"用哪一整套"。
        //    放在 `sel.fontCustom` 这一支**里面** —— 关掉自定义就整块收起（那时这一整套并不
        //    生效，摆出来只会让人以为它在起作用）。
        switchRow(weT("字体集预设"), fontSet.open, (e) => fontSet.onOpen(e.target.checked), {
          tooltip: weT("预设 = 一整套字体外观；改动只落到当前这一套，随时可以恢复原样"),
        }),
        fontSet.open && renderFontSetEditor(fontSet),
      ),
    ),
    );
  }

  function renderAppearanceCaretSection(ctx) {
    const { onCaretColor, sel, surface } = ctx;
    const sidebarSurface = surface === "sidebar";
    return React.createElement(React.Fragment, null,
    // ── 输入光标（#83）：光标色与壁纸相近时会隐形，这里给它一个独立于字体
    //    自定义的颜色项。「自动」= 不注入任何规则，跟随 dsh 原生表现。──
    !sidebarSurface && React.createElement("div", { className: "we-picker__section" },
      React.createElement("div", { className: "we-picker__section-head" },
        React.createElement("span", { className: "we-picker__section-label" }, weT("输入光标")),
      ),
      swatchRow(weT("光标颜色"), CARET_COLOR_PRESETS, sel.caretColor, onCaretColor, {
        key: "caret-color",
        hint: weT("输入框光标看不清时换个颜色"),
        auto: React.createElement("button", {
          key: "auto",
          className: "we-picker__swatch we-picker__swatch--auto" + (sel.caretColor === "" ? " we-picker__swatch--active" : ""),
          type: "button",
          title: weT("跟随 dsh 原生光标颜色"),
          onClick: () => onCaretColor(""),
          "aria-label": weT("光标颜色 自动"),
        }, weT("自动")),
        colorValue: sel.caretColor || "#4f8cff",
      }),
    ),
    );
  }

  // ── 「窗口与侧栏」节**已撤销**（§10.25）：它的内容全部并进「玻璃 UI」节 ──
  // 原委：那节**只在宿主上报 `sidebarPresent`（装了 dsh-better-sidebar）时才画得出内容**，
  // 没装的机器上它就是一个**只有标题的空节**；而它同时是侧栏家族唯一的家 ⇒ 单纯删掉会让那些
  // 控件无处可去。并进「玻璃 UI」之后：所有玻璃配置同处一节，空节消失，
  // 且「左侧栏覆盖」终于与其余面控件放在一起（它当初被排除的理由——与那节"关即回原生纯色"
  // 的乙类语义冲突——已随 §10.20 的退役消失）。
  // 实现见 `src/glass-panel.js` 的 renderAppearanceGlassSection（门槛一个都没放松）。
  // ── 「玻璃 UI」节的渲染器已抽到 src/glass-panel.js（wip §10.13）：
  //    它与其余页签只共享模块级纯助手 ⇒ 抽出去不需要 ctx 样板，这里按名字调用即可。

  // 这一层不再自己画，只**按顺序组装**各节（"有哪几节、什么顺序"一眼可读；
  // 判据按真渲染的节序列钉住，见 verify-scene-live 的节顺序一节）。
  function renderAppearanceTab(ctx) {
    const { } = ctx;
    return React.createElement(React.Fragment, null,
      renderAppearanceThemeSection(ctx),
      renderAppearanceDetailSection(ctx),
      renderAppearanceGlassSection(ctx),
      renderAppearanceFontSection(ctx),
      renderAppearanceCaretSection(ctx),
      // 「窗口与侧栏」节已撤销（内容并进「玻璃 UI」，见上面的说明与 §10.25）。
    );
  }


  function renderAudioTab(ctx) {
    const { onToggleAudio, onVideoVolume, sel } = ctx;
    // 声音：壁纸音轨（视频 / 场景内嵌 MP4 / 场景包内音频共用一套设置）。
    // 系统音频反应 / 媒体信息 / 在线歌词三键已**退役为常开**（schema kind 'const'）：
    // 面板不再提供页面定义，运行时两侧一律按默认接入读值。
    return React.createElement(React.Fragment, null,
      React.createElement("div", { className: "we-picker__section" },
        React.createElement("div", { className: "we-picker__section-head" },
          React.createElement("span", { className: "we-picker__section-label" }, weT("声音")),
        ),
        SliderRow(weT("音量"), 0, 100, 5,
          Math.round((Number(sel.videoVolume) || 0) * 100), onVideoVolume,
          Math.round((Number(sel.videoVolume) || 0) * 100) + "%"),
        switchRow(weT("壁纸音轨"), sel.videoAudioEnabled !== false, () => onToggleAudio(), {
          hint: weT("关闭=静音（保留音量数值）· 开启时音量 0 自动 50%"),
          tooltip: weT("视频壁纸与场景壁纸（内嵌 MP4 音轨 / 包内独立音频）共用；默认静音，开启时若音量为 0 会自动提到 50%"),
        }),
      ),
    );
  }


  function renderMascotTab(ctx) {
    const { onRopeFormChange, onRopeScaleChange, onRopeVisibilityChange, sel } = ctx;
    return React.createElement(React.Fragment, null,
      // ── 吉祥物：形态卡片即实时预览（随「吉祥物大小」滑块缩放），开关总控 ──
      React.createElement("div", { className: "we-picker__section" },
        React.createElement("div", { className: "we-picker__section-head" },
          React.createElement("span", { className: "we-picker__section-label" }, weT("聊天吉祥物")),
        ),
        switchRow(weT("显示吉祥物"), sel.ropeShown !== false, onRopeVisibilityChange, {
          key: "rope-shown",
          hint: weT("关闭后隐藏吉祥物与壁纸仓库抽屉"),
          tooltip: weT("关闭后隐藏吉祥物与壁纸仓库抽屉；可随时在本页重新开启"),
        }),
        // 吉祥物形态（maid = 默认小女仆 / whale = 鲸御姐）：卡片直接渲染形态
        // 立绘并按当前 ropeScale 缩放 —— 选形态与看大小两件事在同一处完成，
        // 调整下方滑块时卡片实时跟着变。关闭时仍可先设定，重新开启即生效。
        React.createElement("div", { className: "we-picker__ctl we-picker__ctl--wrap" },
          ctlText(weT("吉祥物形态"), weT("卡片按当前大小实时预览")),
          React.createElement("div", { className: "we-picker__mascot-row", role: "group", "aria-label": weT("吉祥物形态") },
            ROPE_FORM_VALUES.map((k) => {
              const form = ROPE_FORMS[k];
              return React.createElement("button", {
                key: k,
                type: "button",
                className: "we-picker__mascot-card" + (sel.ropeForm === k ? " we-picker__mascot-card--active" : ""),
                "aria-pressed": sel.ropeForm === k ? "true" : "false",
                title: form.label,
                onClick: () => onRopeFormChange(k),
              },
                React.createElement("span", {
                  className: "we-picker__mascot-art",
                  style: { width: Math.round(form.w * sel.ropeScale) + "px", height: Math.round(form.h * sel.ropeScale) + "px" },
                },
                  React.createElement("img", { src: form.img, alt: form.label, draggable: false })),
                React.createElement("span", { className: "we-picker__mascot-name" }, form.label),
              );
            }),
          ),
        ),
        SliderRow(weT("吉祥物大小"), ROPE_SCALE_MIN, ROPE_SCALE_MAX, ROPE_SCALE_STEP,
          sel.ropeScale, onRopeScaleChange, Math.round(sel.ropeScale * 100) + "%", "rope-scale"),
      ),
    );
  }


  function renderEffectsSlidersSection(ctx) {
    const { onBackgroundBrightness, onBackgroundContrast, onBackgroundSaturate, onScrim, onWallpaperBlur, onWallpaperOpacity, sel } = ctx;
    return React.createElement(React.Fragment, null,
      SliderRow(weT("壁纸模糊"), 0, 60, 1, sel.wallpaperBlur, onWallpaperBlur, sel.wallpaperBlur + "px"),
      SliderRow(weT("亮度"), 40, 160, 5, sel.backgroundBrightness, onBackgroundBrightness, sel.backgroundBrightness + "%"),
      SliderRow(weT("对比度"), 40, 200, 5, sel.backgroundContrast, onBackgroundContrast, sel.backgroundContrast + "%"),
      SliderRow(weT("饱和度"), 0, 200, 5, sel.backgroundSaturate, onBackgroundSaturate, sel.backgroundSaturate + "%"),
      // 壁纸透明度（#82）：越大越透，淡出后壁纸融向**原生外观**（浅色纯白 /
      // 深色纯黑，IDEA 背景图式）。与暗化互补 —— 一个减淡壁纸本身，一个压暗
      // 整体画面；上限 90% 避免调到「壁纸完全不可见但暗化还在」的诡异状态
      // （想关壁纸直接关掉即可）。
      SliderRow(weT("壁纸透明度"), 0, 90, 5, sel.wallpaperOpacity, onWallpaperOpacity, sel.wallpaperOpacity + "%", "wallpaper-opacity", {
        tooltip: weT("壁纸向原生底色淡出（浅色纯白 / 深色纯黑）；透明生效时壁纸层会垫这层原生底色，以保证玻璃模糊不被透明背景破坏。场景壁纸的垫底实时帧会在实时画面出场后退场，不会在淡出时透出来"),
      }),
      SliderRow(weT("暗化"), 0, 90, 5, Math.round(sel.scrim * 100), onScrim, Math.round(sel.scrim * 100) + "%"),
    );
  }

  function renderEffectsLiveSection(ctx) {
    const { onLiveBootDelay, onSceneLiveFps, onToggleSceneLive, sel } = ctx;
    return React.createElement(React.Fragment, null,
      // ── 场景实时渲染（WebWallGL）：scene.pkg 壁纸的实时 WebGL 形态，默认
      // 开启。失败（首帧超时/运行失联）按壁纸记忆并自动降级回内嵌 MP4 →
      // 静态帧；重开本开关清空全部失败记忆（显式重试入口）。
      (sel.type === "scene" || sel.type === "web") && switchRow(
        sel.type === "web" ? weT("网页实时渲染") : weT("场景实时渲染"),
        sel.sceneLive !== false, onToggleSceneLive, {
        key: "scene-live",
        hint: weT("WebGL 实时渲染 · 失败自动降级"),
        tooltip: sel.type === "web"
          ? weT("网页壁纸由 WebWallGL 加载并注入 WE API（音频/属性监听等），严格沙箱隔离（不继承宿主权限）；加载失败或运行失联时自动退回兼容 iframe。重新开启会重试此前失败的壁纸")
          : weT("场景壁纸由 WebWallGL 实时渲染（粒子/脚本/视差/包内音频）；加载失败或运行失联时自动退回内嵌视频 / 实时帧。重新开启会重试此前失败的壁纸"),
      }),
      (sel.type === "scene" || sel.type === "web") && sel.sceneLive !== false
        && React.createElement("div", { className: "we-picker__ctl", key: "live-boot-delay" },
        ctlText(weT("启动最长等待时间")),
        React.createElement("div", { className: "we-picker__seg" },
          [0, 3, 5, 10].map((secs) =>
            React.createElement("button", {
              key: secs,
              className: "we-picker__btn we-picker__rate" + (Number(sel.liveBootDelay) === secs ? " we-picker__rate--active" : ""),
              type: "button",
              onClick: () => onLiveBootDelay(secs),
            }, secs === 0 ? weT("立即") : "≤" + secs + "s"),
          ),
        ),
      ),
      (sel.type === "scene" || sel.type === "web") && sel.sceneLive !== false
        && (sel.sceneLiveSrc || sel.webLiveSrc)
        && React.createElement("div", { className: "we-picker__ctl", key: "scene-live-fps" },
        ctlText(weT("实时渲染帧率"), weT("渲染 fps · 越低越省电")),
        React.createElement("div", { className: "we-picker__seg" },
          SCENE_LIVE_FPS_VALUES.map((f) =>
            React.createElement("button", {
              key: f,
              className: "we-picker__btn we-picker__rate" + (sel.sceneLiveFps === f ? " we-picker__rate--active" : ""),
              type: "button",
              // 帧率进 iframe query（sceneFps）→ syncLayers key 变化重建层
              onClick: () => onSceneLiveFps(f),
            }, f + "fps"),
          ),
        ),
      ),
    );
  }

  function renderEffectsSourceSection(ctx) {
    const { onClearCustomFrame, onClearGpuFrame, onCustomFrameFile, onRecaptureGpuFrame, onRefreshFrame, sel, surface } = ctx;
    const sidebarSurface = surface === "sidebar";
    const sceneWithFrame = sel.type === "scene" && Boolean(sel.sceneFrameUrl);
    const gpuPinnedHere = gpuFrameUi.wid === String(sel.id) && gpuFrameUi.pinned;
    return React.createElement(React.Fragment, null,
      // ── 出图来源：**只在实时渲染未生效时**出现 —— 它换的是「没有实时画面时显示什么」，
      //    实时画面在跑时它没有任何作用（换实时帧用下面的「重新截」）。
      //    侧栏档不出现在这里（准备与诊断，见函数头）。──
      !sidebarSurface && sel.type === "scene" && sel.sceneFrameUrl && !liveRenderEnabled(sel)
        && React.createElement("div", { className: "we-picker__ctl" },
        ctlText(weT("出图来源"), weT("这张画面从哪来"),
          weT("场景壁纸「这张画面从哪来」。两档：**实时画面**（有抓帧就用它，没有则留空）与**自定义画面**（手动导入的截图）。点一次切换一次，选择记忆在当前壁纸上。实时渲染生效时本行不显示（那时画面来自实时渲染，切这里不会生效）")),
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: onRefreshFrame,
          "aria-label": weT("切换出图来源"),
        }, weT("切换")),
        React.createElement("span", { className: "we-picker__hint we-picker__value" },
          // 按**档位值**查表，不能当下标：值域有洞（0 与 4），下标会越界成 undefined.label
          (() => {
            const v = Number(sel.frameVariants && sel.frameVariants[String(sel.id)]) || 0;
            const i = Math.max(0, FRAME_VARIANTS.findIndex((f) => f.id === v));
            return weT("第 {n}/{total} 档 · {label}", { n: i + 1, total: frameVariantCount(sel, String(sel.id)), label: weT(FRAME_VARIANTS[i].label) });
          })()),
      ),
      // ── GPU 实时帧（抓帧缓存 + 重新截 + 微缩预览）：**实时渲染开着时同样显示**。
      //    它是切换途中 / live 首帧之前给用户看的那张静帧 —— 构图不对（黑帧、旧视口、
      //    切走瞬间抓的）时用户必须能立刻重抓，而不是先关掉实时渲染再回来。
      //    预览窗口指向的就是**层上正在用的那个 URL**（同一档位 + 缓存破坏参数），
      //    所以「预览看到什么，切换途中就是什么」。
      //    侧栏档不出现在这里（准备与诊断，见函数头）。──
      !sidebarSurface && sceneWithFrame && (gpuPinnedHere || liveRenderEnabled(sel))
        && React.createElement("div", { className: "we-picker__ctl we-picker__ctl--wrap" },
        ctlText(weT("实时帧"),
          gpuPinnedHere
            ? weT("已抓帧 · 优先于全部画面档位")
            : weT("实时渲染中 · 可随时抓一张"),
          weT("实时渲染成功后会自动抓帧缓存这一帧（<key>_gpu.png），它优先于「出图来源」的自动档；切换壁纸途中、以及 live 首帧出来之前，屏幕上显示的就是它。「重新截」会按**当前**画面重抓一张（已存在的缓存会被替换，抓不到则原样保留）；「清除 GPU 帧」删掉缓存、回到「自动」：没有实时画面时是空态（不再**合成**任何「猜」出来的图）；唯一的例外是该帧连**加载都失败**、而壁纸有工程预览图时，退到预览图垫底（作者随包发布的图）。")),
        // 微缩预览：只有槽里真有实时帧时才显示（否则这里会显示成 CPU 档位帧，误导）。
        gpuPinnedHere && React.createElement("img", {
          className: "we-picker__frame-shot",
          src: framePreviewSrc(sel),
          alt: weT("当前壁纸实时帧预览"),
          title: weT("当前壁纸的实时帧（就是切换途中 / live 首帧前显示的那张静帧）{size}", { size: gpuFrameUi.w > 0 && gpuFrameUi.h > 0 ? " · " + gpuFrameUi.w + "×" + gpuFrameUi.h : "" }),
        }),
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: onRecaptureGpuFrame,
          disabled: gpuFrameUi.recapturing,
          "aria-label": weT("重新截取当前壁纸实时帧"),
        }, gpuFrameUi.recapturing ? weT("抓帧中…") : weT("重新截")),
        gpuPinnedHere && React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: onClearGpuFrame,
          "aria-label": weT("清除 GPU 实时帧缓存"),
        }, gpuFrameUi.busy ? weT("清除中…") : weT("清除 GPU 帧")),
        gpuPinnedHere && gpuFrameUi.w > 0
          && React.createElement("span", { className: "we-picker__hint we-picker__value" },
            gpuFrameUi.w + "×" + gpuFrameUi.h),
        gpuFrameUi.error
          && React.createElement("div", { className: "we-picker__hint" }, gpuFrameUi.error),
      ),
      // ── 自定义画面（截屏导入）：出不了实时画面的壁纸（骨骼拼装场景，预览 gif 仅
      //    160px）由用户从 WE 截图导入，画质=截图分辨率；就是 ?v=4 那一档。
      //    同样**不受实时渲染开关影响**（导入/清除与 live 互不干扰）。──
      !sidebarSurface && sel.type === "scene" && React.createElement("div", { className: "we-picker__ctl" },
        ctlText(weT("自定义画面"),
          weT("手动给电脑桌面截图，导入截图解决错误壁纸"),
          weT("手动对电脑桌面截图（壁纸显示效果的分辨率即最终展示画质），再回来点「导入画面…」选中该截图；导入后自动切换为该图，可随时切回「实时画面」档。实时渲染生效时它仍会作为「出图来源」的自定义档")),
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: () => { if (customFrameInput) customFrameInput.click(); },
        }, frameVariantCount(sel, String(sel.id)) === FRAME_VARIANTS.length ? weT("替换图片…") : weT("导入画面…")),
        frameVariantCount(sel, String(sel.id)) === FRAME_VARIANTS.length && React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: onClearCustomFrame,
        }, weT("清除")),
        React.createElement("input", {
          type: "file",
          accept: "image/png,image/jpeg,image/webp",
          style: { display: "none" },
          ref: (el) => { customFrameInput = el; },
          onChange: onCustomFrameFile,
        }),
      ),
    );
  }

  function renderEffectsPlaybackSection(ctx) {
    const { onFpsCap, onPlaybackRate, sel, surface } = ctx;
    const sidebarSurface = surface === "sidebar";
    return React.createElement(React.Fragment, null,
      // Playback speed — native playbackRate, instant, no media reload. Video
      // wallpapers only (web/iframe and scene wallpapers have no playbackRate).
      sel.type === "video"
        && React.createElement("div", { className: "we-picker__ctl", key: "rate" },
        ctlText(weT("倍速")),
        React.createElement("div", { className: "we-picker__seg" },
          [0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) =>
            React.createElement("button", {
              key: rate,
              className: "we-picker__btn we-picker__rate" + (sel.playbackRate === rate ? " we-picker__rate--active" : ""),
              type: "button",
              onClick: () => onPlaybackRate(rate),
            }, String(rate).replace(/\.?0+$/, "") + "x"),
          ),
        ),
      ),
      // 解码帧率上限（抽帧转码）：host 一次性把源视频重编码为上限帧率（时间线
      // 1.0x 正常速度，解码占用随帧率线性下降），与倍速解耦。首次转码需等待，
      // 播放中原片、转好自动切换；无 ffmpeg 自动回退原片。
      // 侧栏档不出现在这里（准备与诊断，见函数头）。──
      !sidebarSurface && sel.type === "video"
        && React.createElement("div", { className: "we-picker__ctl", key: "fps" },
        ctlText(weT("帧率上限"), weT("抽帧转码 · 降低解码占用")),
        React.createElement("div", { className: "we-picker__seg" },
          FPS_CAP_VALUES.map((cap) =>
            React.createElement("button", {
              key: cap,
              className: "we-picker__btn we-picker__rate" + (sel.fpsCap === cap ? " we-picker__rate--active" : ""),
              type: "button",
              onClick: () => onFpsCap(cap),
            }, cap === 0 ? weT("无限制") : cap + "fps"),
          ),
        ),
      ),
      // Source metadata + transcode status (host moov probe / transcode lifecycle).
      // 源信息与转码进度同样是准备/诊断行 —— 侧栏档不画（见函数头）。
      !sidebarSurface && sel.type === "video" && sel.mediaInfo && React.createElement("span", { className: "we-picker__hint", key: "media-info" },
        weT("源 {width}×{height}{fps}{codec}{state}", {
          width: sel.mediaInfo.width,
          height: sel.mediaInfo.height,
          fps: sel.mediaInfo.fps ? " · " + sel.mediaInfo.fps + "fps" : "",
          codec: sel.mediaInfo.codec ? " · " + weT(codecLabel(sel.mediaInfo.codec)) : "",
          state: sel.transcodeState === "working" ? weT(" · 抽帧准备中…")
            : sel.transcodeState === "ready" ? weT(" · 已切换至 {fps}fps 抽帧版（正常速度，解码占用约减半）", { fps: sel.fpsCap })
            : sel.transcodeState === "cached" ? weT(" · 抽帧版已就绪（下次切换到这张时生效）")
            : sel.transcodeState === "native" ? weT(" · 源帧率未知，未抽帧")
            : sel.transcodeState === "fallback" ? weT(" · 转码不可用，已回退原片")
            : sel.transcodeState === "skipped" ? weT(" · 源帧率 ≤ 上限，无需抽帧")
            : "",
        }),
      ),
      // Download / transcode progress bar (polled from /transcode-progress).
      !sidebarSurface && sel.type === "video" && sel.transcodeState === "working" && sel.transcodeProgress
        && React.createElement("div", { className: "we-picker__row we-picker__prog", key: "transcode-prog" },
          React.createElement("div", {
            className: "we-picker__prog-track",
            role: "progressbar",
            "aria-label": weT("转码进度"),
            "aria-valuemin": 0,
            "aria-valuemax": 100,
            "aria-valuenow": Math.max(0, Math.min(100, sel.transcodeProgress.percent || 0)),
          },
            React.createElement("div", {
              className: "we-picker__prog-bar",
              style: { width: Math.max(2, Math.min(100, sel.transcodeProgress.percent || 0)) + "%" },
            }),
          ),
          React.createElement("span", { className: "we-picker__hint" },
            sel.transcodeProgress.phase === "download"
              ? weT("下载 ffmpeg {percent}%", { percent: sel.transcodeProgress.percent || 0 })
              : sel.transcodeProgress.phase === "transcode" && sel.transcodeProgress.finalizing ? weT("收尾中…")
              : sel.transcodeProgress.phase === "transcode"
                ? weT("转码中 {percent}%{eta}", {
                  percent: sel.transcodeProgress.percent || 0,
                  eta: sel.transcodeProgress.eta ? weT(" · 约剩 {sec} 秒", { sec: sel.transcodeProgress.eta }) : "",
                })
              : sel.transcodeProgress.phase === "done" ? weT("即将完成…")
              : weT("准备中…"),
          ),
        ),
    );
  }

  function renderEffectsFitSection(ctx) {
    const { onFlip, onObjectFit, sel } = ctx;
    return React.createElement(React.Fragment, null,
      // Fit mode — applies to the CURRENT wallpaper whatever its type (WE
      // video/scene image and custom uploads alike; web/iframe wallpapers
      // have no object-fit). 覆盖=cover 填充=contain 居中=center 拉伸=fill
      React.createElement("div", { className: "we-picker__ctl", key: "fit" },
        ctlText(weT("适配")),
        React.createElement("div", { className: "we-picker__seg" },
          ["cover", "contain", "center", "fill"].map((mode) => {
            const label = { cover: weT("覆盖"), contain: weT("填充"), center: weT("居中"), fill: weT("拉伸") }[mode];
            return React.createElement("button", {
              key: mode,
              className: "we-picker__btn we-picker__rate" + (sel.objectFit === mode ? " we-picker__rate--active" : ""),
              type: "button",
              title: mode,
              onClick: () => onObjectFit(mode),
            }, label);
          }),
        ),
      ),
      // Horizontal mirror — scaleX(-1), compositor-only; works for video,
      // web (iframe) and (later) uploaded image wallpapers alike.
      switchRow(weT("水平翻转"), sel.flip, onFlip, { key: "flip" }),
    );
  }
  // 这一层保留"空态提前返回 + 唯一的节外壳"，把**节里的内容**按块分给子渲染器；
  // "有哪几块、什么顺序"一眼可读（细锚按真渲染的**控件标签有序序列**钉住，见 verify-scene-live）。
  function renderEffectsTab(ctx) {
    const { sel, setPickerOpener, onOpenPicker, onPickWallpaper, surface } = ctx;
    const sidebarSurface = surface === "sidebar";
    if (!sel.id) {
      return React.createElement("div", { className: "we-picker__empty" },
        React.createElement("span", { className: "we-picker__empty-title" }, weT("还没有启用壁纸")),
        React.createElement("span", { className: "we-picker__hint" },
          weT("选择一款壁纸后，可在这里调整模糊、亮度、适配、倍速等效果")),
        React.createElement("button", {
          className: "we-picker__btn we-picker__btn--primary", type: "button",
          ref: sidebarSurface ? undefined : setPickerOpener,
          onClick: sidebarSurface ? onPickWallpaper : onOpenPicker,
        }, sidebarSurface ? weT("去挑一张 ›") : weT("选择壁纸")),
      );
    }
    return React.createElement(React.Fragment, null,
      React.createElement("div", { className: "we-picker__section" },
        React.createElement("div", { className: "we-picker__section-head" },
          React.createElement("span", { className: "we-picker__section-label" }, weT("画面")),
        ),
        renderEffectsSlidersSection(ctx),
        renderEffectsLiveSection(ctx),
        renderEffectsSourceSection(ctx),
        renderEffectsPlaybackSection(ctx),
        renderEffectsFitSection(ctx),
      ),
    );
  }

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

  function renderAdvancedDiagSection(ctx) {
    const { onToggleLiveDiag, sel } = ctx;
    return React.createElement(React.Fragment, null,
    // ── 实时渲染诊断（本会话有效，不落盘；从「效果」页签移来）：只对**能走实时
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
  // 这一层不再自己画，只**按顺序组装**各节 —— 于是"这个页签有哪几节、什么顺序"
  // 一眼可读（判据按真渲染的节序列钉住，见 verify-scene-live 的节顺序一节）。
  function renderAdvancedTab(ctx) {
    const { } = ctx;
    return React.createElement(React.Fragment, null,
      renderAdvancedBrowsingSection(ctx),
      renderAdvancedCompatSection(ctx),
      renderAdvancedAdapterSection(ctx),
      renderAdvancedPowerSection(ctx),
      renderAdvancedDiagSection(ctx),
    );
  }
  // ── 「关于」页签：项目简介 / 仓库与 Star / 交流群二维码 / 贡献者致谢（压尾）──────
  // 这是**唯一不读面板状态**的页签：内容全是静态文案 + 两张内联二维码（数据在
  // src/about-assets.js，构建期随 prelude 内联）。但契约是**逐页签**的 ——
  // verify-scene-live 要求每个 render*Tab 首行从 ctx 解构（"要什么"写在签名处），
  // 所以这里显式写下空解构：别让后来人以为"这个页签不用取外界"就能绕过接缝。
  // 四段的**顺序**是用户的明确口径（致谢压尾），判据按首次出现下标比大小钉住。
  function renderAboutTab(ctx) {
    const { } = ctx;
    // star 数那一行（模块级：值 + 三态文案都在 client.js 的 starCountLabel 里；
    // 这里的"读"与 SliderRow 一类模块级助手同口径 —— 只读，不发请求）。
    const stars = starCountLabel();
    // 两张码的参数表：图（路由 URL）/ 图题 / 替代文本 / 一句话说明。渲染一次 map 两遍，
    // 免得两段几乎一样的 createElement 各自演化（改一处忘一处正是这类页面最容易烂的地方）。
    const qrCards = [
      {
        key: "qq",
        title: weT("🐧 QQ 群 · DSHWE | LLM 讨论群"),
        // 图本体是随包 PNG（lib/about/），这里只给路径 —— apiUrl 补 BASE 前缀。
        src: apiUrl(ABOUT_QR_QQ_PATH),
        alt: weT("QQ 群二维码"),
        hint: weT("手机 QQ 扫码加入 · 群里见 👋"),
      },
      {
        key: "douyin",
        title: weT("🎵 抖音群 · dsh 交流群"),
        src: apiUrl(ABOUT_QR_DOUYIN_PATH),
        alt: weT("抖音群二维码"),
        hint: weT("抖音扫码加入 · 群号 252729465001"),
      },
    ];
    // 贡献者致谢逐条列出（名字 / 做了什么）——「谢谢」要能落到具体的人身上，
    // 一句笼统的"感谢所有贡献者"没有信息量。
    const credits = [
      weT("🧩 oneincase —— 内置 WebWallGL 实时渲染引擎与 media-bridge 媒体中间件的作者：场景 / 网页壁纸的实时渲染，以及 Windows / macOS / Linux 三平台的原生媒体链路，都建立在它们之上"),
      weT("🛠️ YV3507 —— 提交量最大的贡献者：从早期场景渲染器起步，到静态帧系列修复、液态玻璃令牌体系、实时帧链路与多轮大型重构，几乎每个里程碑都有他"),
      weT("🎨 yuxilao —— scene-gl 的 Linux 实时渲染管线（WebGL2 官方 shader 驱动）、轮换交接与 GPU 帧回填"),
      weT("🍎 Jerry —— 在三平台原生支持落地之前，macOS 侧的适配与贡献路径由他维护"),
      weT("🌟 还有 SiriLee、libiwolve、0-007pro、jujubaoj646-star、xiahou001、wilianyichen、hecoococ、ShamSky88、Rekk0、Y1X1n 等贡献者，以及所有通过 issue 反馈与 PR 参与改进的朋友 —— 谢谢你们！"),
    ];
    return React.createElement(React.Fragment, null,
      // ── ① 项目简介 ──
      React.createElement("div", { className: "we-picker__section" },
        React.createElement("div", { className: "we-picker__section-head" },
          React.createElement("span", { className: "we-picker__section-label" }, weT("📖 项目简介")),
        ),
        React.createElement("div", { className: "we-about__lead" },
          React.createElement("div", { className: "we-about__lead-title" }, weT("🖼️ 壁纸引擎 · 让 DSH 的背后动起来")),
          React.createElement("p", { className: "we-about__p" },
            weT("把 Wallpaper Engine 的壁纸搬到 DSH 界面后面：视频直接播放，场景（Scene）与网页（Web）壁纸由内置的 WebWallGL 引擎实时渲染，再配上一整套液态玻璃界面改造 —— 你桌面上那张会动的画，现在就在对话背后放着。🎬✨")),
          React.createElement("p", { className: "we-about__p" },
            weT("壁纸全部来自你自己的机器（本机库 / WE 工程目录 / 手动上传），插件不联网也能用，更不会把它们传到任何地方。🔒")),
        ),
      ),
      // ── ② 仓库与 Star ──
      React.createElement("div", { className: "we-picker__section" },
        React.createElement("div", { className: "we-picker__section-head" },
          React.createElement("span", { className: "we-picker__section-label" }, weT("⭐ 开源与支持")),
        ),
        React.createElement("p", { className: "we-about__p" },
          weT("项目以 MIT 协议开源、完全免费。如果它让你的 DSH 好看了一点点，去仓库点一颗 ⭐ 就是最直接的鼓励～")),
        React.createElement("div", { className: "we-about__star-row" },
          React.createElement("a", {
            className: "we-picker__btn we-picker__btn--primary we-about__star",
            href: ABOUT_REPO_URL,
            target: "_blank",
            rel: "noopener noreferrer",
            title: weT("在浏览器里打开项目仓库"),
          }, weT("⭐ 去 GitHub 点亮 Star")),
          // 实时 star 数：宿主代取（带缓存，见 lib/routes/github-stars.js）。
          // 取不到时**整行不消失**、改说"暂时取不到" —— 数字是点缀，按钮才是主操作。
          stars
            ? React.createElement("span", {
                className: "we-about__stars",
                title: weT("来自 GitHub API 的实时数据（带缓存；拉不到时显示上一次取到的值）"),
              }, stars)
            : null,
        ),
        React.createElement("div", { className: "we-about__url-row" },
          React.createElement("span", { className: "we-picker__hint" }, weT("🔗 仓库地址（按钮打不开时可手动复制）：")),
          // 可选中、可整段复制的裸地址：桌面壳里外链能否唤起浏览器不由插件说了算，
          // 这条是给"点了没反应"的场景留的兜底（同字体集导出的"普通链接"口径）。
          React.createElement("code", { className: "we-about__url" }, ABOUT_REPO_URL),
        ),
        React.createElement("p", { className: "we-about__p" },
          weT("想要新功能、遇到问题，或者想看看接下来要做什么，都欢迎来仓库提 Issue / PR —— 一起把它做得更好 🧰")),
      ),
      // ── ③ 交流群（两张二维码）──
      React.createElement("div", { className: "we-picker__section" },
        React.createElement("div", { className: "we-picker__section-head" },
          React.createElement("span", { className: "we-picker__section-label" }, weT("💬 加入交流群")),
        ),
        React.createElement("p", { className: "we-about__p" },
          weT("卡住了、想吐槽、或者想第一时间拿到新版本，都欢迎来群里找我们 👋")),
        React.createElement("div", { className: "we-about__qr-row" },
          qrCards.map((c) => React.createElement("figure", { key: c.key, className: "we-about__qr" },
            React.createElement("figcaption", { className: "we-about__qr-title" }, c.title),
            React.createElement("img", {
              className: "we-about__qr-img",
              src: c.src,
              alt: c.alt,
              draggable: false,
            }),
            React.createElement("figcaption", { className: "we-about__qr-hint" }, c.hint),
          )),
        ),
      ),
      // ── ④ 贡献者致谢（**压尾**：用户口径——先讲清"这是什么、去哪支持、怎么找我们"，
      //    最后再把功劳簿摆出来。💌 那句收尾也并进这一段，页面结束在"谢谢"上。）──
      React.createElement("div", { className: "we-picker__section" },
        React.createElement("div", { className: "we-picker__section-head" },
          React.createElement("span", { className: "we-picker__section-label" }, weT("🙏 贡献者致谢")),
        ),
        React.createElement("p", { className: "we-about__p" }, weT("这个插件是许多人一起做出来的成果，谢谢他们：❤️")),
        React.createElement("ul", { className: "we-about__credits" },
          credits.map((line, i) => React.createElement("li", { key: "credit-" + i, className: "we-about__credit" }, line)),
        ),
        React.createElement("p", { className: "we-about__p" }, weT("也谢谢上游 Wallpaper Engine 生态与 DSH 官方插件的作者们 —— 站在你们的肩膀上。🙇")),
        React.createElement("p", { className: "we-about__p we-about__foot" },
          weT("💌 感谢每一位使用者 —— 换上你喜欢的那张壁纸，这个插件就没白写。")),
      ),
    );
  }


export {
  renderWallpaperTab, renderAppearanceTab, renderAudioTab, renderMascotTab, renderEffectsTab, renderAdvancedTab,
  renderAboutTab,
};
