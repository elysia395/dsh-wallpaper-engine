/**
 * 「外观」页签的节渲染器（原 src/panel-tabs.js）：主题 / 细节 /
 * 侧边栏圆角 / 全局 UI 配色，含 sidebarCornerGroup 一族。本节渲染器从 src/panel-tabs.js 按域搬出，函数体逐字未改。
 * ⚠️ P-C 之后第六节「全局字体」**不在本文件**：它住在 packages/fonts/src/appearance-font-section.js，
 *    由子包把渲染器登记进面板节注册表（src/extension-registry.js），节顺序见 src/panel-tabs.js。
 * 内联顺序见 scripts/build-client.mjs：本模块排在组装点之前（打包后同一工厂作用域）。
 */
  function renderAppearanceThemeSection(ctx) {
    const { onResetModule, onToggleThemeFollow, sel } = ctx;
    return React.createElement(React.Fragment, null,
    // ── 主题：本节点只剩「主题随壁纸」—— 玻璃配置在「玻璃 UI」节，
    //    **「配色」（accent）已迁进「全局 UI 配色」节**（用户口径：配色要成为
    //    一个独立大项，并作为"直接调整全部"的总色；见 renderAppearanceUiColorSection）。──
    React.createElement("div", { className: "we-picker__section" },
      React.createElement("div", { className: "we-picker__section-head" },
        React.createElement("span", { className: "we-picker__section-label" }, weT("主题")),
        moduleResetButton("theme", onResetModule),
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
    ),
    );
  }

  function renderAppearanceDetailSection(ctx) {
    const { onBorder, onResetModule, sel, detailOpen, onToggleDetailSection } = ctx;
    // 简化 / 高级分档见 ADR-0008 **D4**（实现口径在 `src/glass-panel.js`，按 `ctx.surface` 判定）：
    // 全局四件套、预设方案与各面总开关属简化配置（侧栏档也画）；本节的「独立配置」层及其子项
    // 属高级配置 ⇒ 只在设置页画。它与 quick-panel 的 setting-only 占位器互为负对照。
    // ⚠️ 折叠门（**二次修订**）：**两档都支持隐藏**；差别只在默认值
    //    （组件算好当 `open` 传进来）—— 侧边栏默认展开、设置页默认展开。
    const open = detailOpen === true;
    return React.createElement(React.Fragment, null,
    // ── 细节：只剩**非釉层**的「边框」（边框 / 分割线对比度）—— 不属于玻璃配方 ──
    React.createElement("div", { className: "we-picker__section" },
      sectionHead(weT("细节"), open, onToggleDetailSection, moduleResetButton("detail", onResetModule)),
      open && SliderRow(weT("边框"), 0, 90, 5, Math.round(sel.border * 100), onBorder, Math.round(sel.border * 100) + "%", "border-emphasis", {
        tooltip: weT("提高边框 / 分割线的对比度（浅色与深色主题通用）"),
      }),
      // ── 「左侧栏液态玻璃」及其子项在「玻璃 UI」节（门槛 `leftSidebarGlass`，见
      //    `src/glass-panel.js`）：总开关两档都画，其下「独立配置」层属高级配置、只在设置页画。──
    ),
    );
  }

  // ── 「侧边栏圆角」节（外观页签）：左右两条侧栏各自一套 —— 统一档 + 四角单独直角 ──
  // 统一档写 border-radius 简写，四角开关写 border-*-radius 长属性覆盖它（CSS 见 styles.js
  // 同名块，顺序即语义）；真源 lib/settings-schema.js 的 leftSidebarCornerRadius /
  // rightSidebarCornerRadius 与两族 Square* 键。
  // ⚠️ 宿主原生左栏与右栏面板**都不带圆角** ⇒「圆角」要靠统一档选 6 / 12 / 20px 才看得见，
  //    「直角」是把某一角按回 0 的覆盖档；默认「跟随原生」= 一个属性都不挂（逐字节现状）。
  // 四角按几何排（左上 / 右上 / 右下 / 左下），与用户看到的形状同构。
  function sidebarCornerGroup(side, sideLabel, sel, onSidebarCornerRadius, onSidebarCornerSquare, onSidebarAllCorners) {
    const radiusLabels = { native: weT("跟随原生"), 6: weT("小 6px"), 12: weT("中 12px"), 20: weT("大 20px") };
    const corners = [["tl", weT("左上")], ["tr", weT("右上")], ["br", weT("右下")], ["bl", weT("左下")]];
    const radiusKey = side + "SidebarCornerRadius";
    const isSquare = (c) => sel[side + "SidebarSquare" + c.toUpperCase()] === true;
    return React.createElement(React.Fragment, null,
      React.createElement("div", { className: "we-picker__ctl we-picker__ctl--wrap" },
        ctlText(weT("{side} · 统一圆角", { side: sideLabel }), weT("四角都按这个值；单独标「直角」的角覆盖它")),
        React.createElement("div", { className: "we-picker__seg" },
          SIDEBAR_CORNER_RADIUS_VALUES.map((v) =>
            React.createElement("button", {
              key: v,
              className: "we-picker__btn we-picker__rate" + (sel[radiusKey] === v ? " we-picker__rate--active" : ""),
              type: "button",
              onClick: () => onSidebarCornerRadius(side, v),
              "aria-pressed": sel[radiusKey] === v ? "true" : "false",
              "aria-label": weT("{side}统一圆角 {value}", { side: sideLabel, value: radiusLabels[v] }),
            }, radiusLabels[v]),
          ),
        ),
      ),
      React.createElement("div", { className: "we-picker__ctl we-picker__ctl--wrap" },
        ctlText(weT("{side} · 四角单独", { side: sideLabel }), weT("点一下就切换：圆角（用统一值）/ 直角（0px）")),
        React.createElement("div", { className: "we-picker__seg" },
          corners.map(([c, cornerLabel]) =>
            React.createElement("button", {
              key: c,
              className: "we-picker__btn we-picker__rate" + (isSquare(c) ? " we-picker__rate--active" : ""),
              type: "button",
              onClick: () => onSidebarCornerSquare(side, c, !isSquare(c)),
              "aria-pressed": isSquare(c) ? "true" : "false",
              "aria-label": weT("{side}{corner}：{state}", { side: sideLabel, corner: cornerLabel, state: weT(isSquare(c) ? "直角" : "圆角") }),
            }, weT("{corner}角 {state}", { corner: cornerLabel, state: weT(isSquare(c) ? "直角" : "圆角") })),
          ),
        ),
      ),
      React.createElement("div", { className: "we-picker__ctl we-picker__ctl--wrap" },
        React.createElement("div", { className: "we-picker__seg" },
          React.createElement("button", { className: "we-picker__btn", type: "button", onClick: () => onSidebarAllCorners(side, true) }, weT("四角全直角")),
          React.createElement("button", { className: "we-picker__btn", type: "button", onClick: () => onSidebarAllCorners(side, false) }, weT("四角全圆角")),
        ),
      ),
    );
  }

  function renderAppearanceSidebarCornersSection(ctx) {
    const { onResetModule, onSidebarAllCorners, onSidebarCornerRadius, onSidebarCornerSquare, sel, cornersOpen, onToggleCornersSection } = ctx;
    // ⚠️ 折叠门同「细节」节（二次修订）：两档都支持隐藏，差别只在默认值。
    const open = cornersOpen === true;
    return React.createElement(React.Fragment, null,
      React.createElement("div", { className: "we-picker__section" },
        sectionHead(weT("侧边栏圆角"), open, onToggleCornersSection, moduleResetButton("corners", onResetModule)),
        open && sidebarCornerGroup("left", weT("左侧栏"), sel, onSidebarCornerRadius, onSidebarCornerSquare, onSidebarAllCorners),
        open && sidebarCornerGroup("right", weT("右侧栏"), sel, onSidebarCornerRadius, onSidebarCornerSquare, onSidebarAllCorners),
      ),
    );
  }

  // ── 「全局 UI 配色」节（用户口径）：配色成为独立大项 + 五处"蓝色元素"可单独调 ──
  //    结构按用户原话：「做成 <全局 UI 配色> 下挂 <全局配色> 和 <UI 配色自定义>」——
  //      · **全局配色**（accent，原住「主题」节）＝ "用于直接调整全部"；
  //      · **UI 配色自定义**（开关，**默认关**，与 fontCustom 同形）＝ 开启后下面五项各自可调，
  //        此时「全局配色」整行**禁用**（用户口径：「开启后<全局配色>禁用，采用<UI配色自定义>」）。
  //    ⚠️ 五项的空值语义 = **跟随「全局配色」**（effects.js 里 `selection[k] || accent`）⇒
  //       开启那一刻观感零变化，随后逐项微调；不是"清空成宿主原生"。
  //    ⚠️ 折叠门与字体节同形（`uiColorOpen`，默认收起，两档各记各的 localStorage 键）。
  //    令牌与宿主消费者的实证见 `src/styles.js` 的同名段与 `lib/settings-schema.js` 的 DEFAULTS 注释。
  function renderAppearanceUiColorSection(ctx) {
    const { onAccent, onCaretColor, onResetModule, onToggleUiColorCustom, onUiColorElement, sel, uiColorOpen, onToggleUiColorSection } = ctx;
    const open = uiColorOpen === true;
    const custom = sel.uiColorCustom === true;
    // 五个元素行：id 与 settings 键一一对应；文案与 tooltip 写明它**具体是哪一处** ——
    // 用户是按截图点名的，标签必须让他能对上号（"发送键"而不是"主按钮"）。
    const rows = [
      { key: "uiColorSend", label: weT("发送键"), hint: weT("输入框右侧那个圆形箭头按钮（它的箭头固定白色，建议选中间调）") },
      { key: "uiColorLink", label: weT("链接文字"), hint: weT("会话与面板里的链接、强调文字") },
      { key: "uiColorFileIcon", label: weT("文件图标"), hint: weT("交付物卡片里 `</>` 那个文件图标（与链接共用令牌，这里单独覆盖）") },
      { key: "uiColorTab", label: weT("页签 / 焦点环"), hint: weT("会话的「对话 / 轨迹」页签与下划线；焦点环与状态点同源，一并跟色") },
      { key: "uiColorDeepDiving", label: weT("深度求索状态"), hint: weT("「深度求索中，用时 …」那行文字与它的微光") }
    ];
    // 「跟随配色」按钮：清空该项 ⇒ 回到 accent（与光标那行的「自动」同形）。
    const followSwatch = (key) => React.createElement("button", {
      key: "follow",
      className: "we-picker__swatch we-picker__swatch--auto" + (sel[key] === "" ? " we-picker__swatch--active" : ""),
      type: "button",
      title: weT("跟随「全局配色」"),
      onClick: () => onUiColorElement(key, ""),
      "aria-label": weT("跟随全局配色"),
    }, weT("跟随"));
    return React.createElement(React.Fragment, null,
    React.createElement("div", { className: "we-picker__section" },
      // 节头一律走共用构件（`sectionHead`）：折叠三角与模块级 ↺ 的**次序只有一份实现**
      // ——手写副本正是次序会漂的地方（一处改了另一处不改 ⇒ 只有部分模块对齐）。
      sectionHead(weT("全局 UI 配色"), open, onToggleUiColorSection, moduleResetButton("uiColor", onResetModule)),
      open && React.createElement(React.Fragment, null,
        // ① 全局配色：直接调全部。开自定义后**禁用**（不是隐藏）—— 让它可见但明示"此刻不由它说了算"。
        React.createElement("div", { key: "global-accent", className: custom ? "we-picker__ctl we-picker__ctl--disabled" : "" },
          swatchRow(weT("全局配色"), ACCENT_PRESETS, sel.accent, custom ? () => {} : onAccent, {
            key: "accent",
            hint: custom
              ? weT("已开启「UI 配色自定义」—— 此刻由下面五项分别决定，本行暂不生效")
              : weT("一处调全部：界面强调色、按钮、选中态与下面那几处都会跟着变"),
            tooltip: custom
              ? weT("关闭「UI 配色自定义」后本行重新生效")
              : weT("调它等于一次性改全部；想给某几处单独指定颜色，打开下面的「UI 配色自定义」"),
          }),
        ),
        // ② UI 配色自定义：总开关。
        switchRow(weT("UI 配色自定义"), custom, (e) => onToggleUiColorCustom(e.target.checked), {
          key: "ui-color-custom",
          tooltip: weT("开启后「全局配色」不再生效，改由下面五项分别决定；每一项留「跟随」即回到全局配色"),
        }),
        custom && React.createElement(React.Fragment, null,
          ...rows.map((r) => swatchRow(weT(r.label), ACCENT_PRESETS, sel[r.key], (hex, live) => onUiColorElement(r.key, hex, live), {
            key: r.key,
            hint: weT(r.hint),
            auto: followSwatch(r.key),
            colorValue: sel[r.key] || sel.accent || "#4f8cff",
          })),
        ),
        // ③ 光标颜色：**原「输入光标」节唯一的一行，整节撤销后并入本节**（用户口径：
        //    「输入光标这一栏目取消 …… 光标颜色 …… 并入里面可以调单独设置」）。
        //    ⚠️ 它**不在** `custom` 门里：这一项从来是可用的可读性设置（#83），
        //       藏到总开关后面就是能力回退。也不吃 accent —— 它的空值语义是
        //       **跟随 dsh 原生光标色**（不注入任何规则），与上面五项"空 = 跟随全局配色"不同。
        swatchRow(weT("光标颜色"), CARET_COLOR_PRESETS, sel.caretColor, onCaretColor, {
          key: "caret-color",
          hint: weT("输入框光标看不清时换个颜色（与上面的总开关无关，始终可调）"),
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
    ),
    );
  }

  // ── 「玻璃 UI」节：所有玻璃配置（含「左侧栏液态玻璃」及其子项）同处一节。渲染器在
  //    `src/glass-panel.js` 的 renderAppearanceGlassSection（门槛一个都没放松）—— 它与其余页签
  //    只共享模块级纯助手 ⇒ 不需要 ctx 样板，这里按名字调用即可。


export {
  renderAppearanceThemeSection,
  renderAppearanceDetailSection,
  renderAppearanceSidebarCornersSection,
  renderAppearanceUiColorSection,
};
