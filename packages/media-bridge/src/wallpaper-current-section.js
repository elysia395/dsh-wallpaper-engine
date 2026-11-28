/**
 * 「壁纸库」页签第一节「当前壁纸」的渲染器。
 *
 * 归属（ADR-0013 D20）：随包走的是**渲染器**；当前壁纸的 selection、播放动作体、
 * 失败原因计算仍在主包（src/client.js / src/live-layer.js）⇒ 本文件**不持键、不写 selection、
 * 不调 emit**，只读 ctx；跨包通道只有主 bundle 的显式 host 键集：
 *   · VinylRecord / vinylSpinVisible（src/client.js 工厂作用域）· liveFailReasonOf（src/live-layer.js）
 *   · 四节共享的 React / weT
 * 内联形状见 packages/media-bridge/client.build.json；入口的 registerPanelSection 把 render 登记进
 * 面板节注册表（library，order 10）。与同族三节共享同一契约：只读 ctx、不写 selection、不调 emit
 * （判据扫全族并集，见 test/verify-scene-live.mjs / test/verify-client.mjs）。
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
          // 播放失败原因: 浏览器解不了的编码 / 解码失败等 —— 给出可读原因，
          // 配合下面的「播放」按钮重试（不是静默空白）。
          sel.videoError && React.createElement("div", { className: "we-picker__current-error" }, sel.videoError),
          // 选择被过滤条件排除: 明确指出是哪一项过滤挡住了、怎么恢复
          sel.blockedNote && React.createElement("div", { className: "we-picker__current-error" }, sel.blockedNote),
          // 实时渲染失败原因（自动回退到旧链时显示）：让「为什么黑」可见 ——
          // 用户反馈时能直接说明，也提示了重试入口（重开「实时渲染」开关）。
          liveFailReasonOf(sel) && React.createElement("div", { className: "we-picker__current-error" },
            weT("实时渲染失败（{reason}），已自动回退；重新打开「实时渲染」开关可重试", { reason: weT(liveFailReasonOf(sel)) }))
          ),
        ),
        // 主操作区：选择壁纸（下钻库视图）。壁纸属性入口在下面那排播放控制里、
        // 排在「暂停」之前（同排同级、同款式）。
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
          // 按钮显示真实状态: 播放失败时回到「播放」，就是用户要的「继续」。
        }, playbackLive ? weT("暂停") : weT("播放", null, "play")),
        // 音乐开关：与「播放」同级的一键切换。只影响音轨，不动播放态 ——
        // 关掉后画面继续播放。仅对含音轨的壁纸类型显示（视频 / 场景内嵌 MP4）。
        //
        // ⚠️ 高亮判据必须与**按钮自己的状态**（也就是下面文案那个判据）**逐字同一个**：
        // 这颗按钮切的是 `videoAudioEnabled`，所以「亮」= 该开关为开。按别的量（如音量）判亮
        // 会让文案与高亮互相矛盾、点击没有任何视觉反馈。
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

export { renderWallpaperCurrentSection };
