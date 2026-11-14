/**
 * wallpaper-transition-section.js — 「壁纸库」页签第二节「切换过场」的渲染器。
 *
 * 归属 / 构建期形状 / 消费侧契约见本包 `src/client.js` 文件头（同一份 P-D 口径）。
 * 本文件是 `packages/media-bridge/client.build.json` 的 inline 模块：与入口落在**同一个工厂
 * 作用域**，不收 import / require；自由标识符（React / weT / ctlText / switchTransitionOf /
 * SWITCH_TRANSITIONS / SWITCH_DIRS / SWITCH_DIR_LABELS / SWITCH_SPEEDS）由入口从 host 显式键集解构。
 *
 * ctx 键（onSwitchTransition / onSwitchTransitionDir / onSwitchTransitionSpeed / sel）
 * 由主包 renderWallpaperTab 在渲染处构造 ⇒ 本渲染器只读 ctx。
 */

  function renderWallpaperTransitionSection(ctx) {
    const { onSwitchTransition, onSwitchTransitionDir, onSwitchTransitionSpeed, sel } = ctx;
    const switchTr = switchTransitionOf(sel);
    return React.createElement(React.Fragment, null,
    // ── 切换过场（手动点选与自动轮播共用）：类型 / 方向 / 速度 ──
    // 默认「硬切」（零成本、零风险）；换默认改 DEFAULTS 一处即可。
    // 每种过场只动 transform / opacity / clip-path（见 switchFrames）。
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
        ctlText(weT("时长"), switchTr.id === "random"
          ? weT("最长约 {ms} ms", { ms: switchTr.ms })
          : weT("当前约 {ms} ms", { ms: switchTr.ms })),
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

export { renderWallpaperTransitionSection };
