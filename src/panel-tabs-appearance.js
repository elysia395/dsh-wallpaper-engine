/**
 * 「外观」页签的节渲染器（原 src/panel-tabs.js 的 520–1119 行）：主题 / 细节 /
 * 全局字体 / 输入光标 / 侧边栏圆角 / 全局 UI 配色，含 familyOptions / sysFontNote /
 * sysFontRefresh / sidebarCornerGroup 与 renderFont* 一族。本节渲染器从 src/panel-tabs.js 按域搬出，函数体逐字未改。
 * 内联顺序见 scripts/build-client.mjs：本模块排在组装点之前（打包后同一工厂作用域）。
 */
  function renderAppearanceThemeSection(ctx) {
    const { onToggleThemeFollow, sel } = ctx;
    return React.createElement(React.Fragment, null,
    // ── 主题：本节点只剩「主题随壁纸」—— 玻璃配置在「玻璃 UI」节，
    //    **「配色」（accent）已迁进「全局 UI 配色」节**（2026-10-11 用户口径：配色要成为
    //    一个独立大项，并作为"直接调整全部"的总色；见 renderAppearanceUiColorSection）。──
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
    ),
    );
  }

  function renderAppearanceDetailSection(ctx) {
    const { onBorder, sel, detailOpen, onToggleDetailSection } = ctx;
    // 简化 / 高级分档见 ADR-0008 **D4**（实现口径在 `src/glass-panel.js`，按 `ctx.surface` 判定）：
    // 全局四件套、预设方案与各面总开关属简化配置（侧栏档也画）；本节的「独立配置」层及其子项
    // 属高级配置 ⇒ 只在设置页画。它与 quick-panel 的 setting-only 占位器互为负对照。
    // ⚠️ 折叠门（2026-10-11 **二次修订**）：**两档都支持隐藏**；差别只在默认值
    //    （组件算好当 `open` 传进来）—— 侧边栏默认展开、设置页默认展开。
    const open = detailOpen === true;
    return React.createElement(React.Fragment, null,
    // ── 细节：只剩**非釉层**的「边框」（边框 / 分割线对比度）—— 不属于玻璃配方 ──
    React.createElement("div", { className: "we-picker__section" },
      sectionHead(weT("细节"), open, onToggleDetailSection),
      open && SliderRow(weT("边框"), 0, 90, 5, Math.round(sel.border * 100), onBorder, Math.round(sel.border * 100) + "%", "border-emphasis", {
        tooltip: weT("提高边框 / 分割线的对比度（浅色与深色主题通用）"),
      }),
      // ── 「左侧栏液态玻璃」及其子项在「玻璃 UI」节（门槛 `leftSidebarGlass`，见
      //    `src/glass-panel.js`）：总开关两档都画，其下「独立配置」层属高级配置、只在设置页画。──
    ),
    );
  }

  // ── 字族下拉的**选项**（一处生成，四张表共用）────────────────────────────────
  // 两组：内置族键（FONT_FAMILY_LABELS，栈写死在 client.js）+ **本机字体**
  // （宿主枚举出来的族名，经 systemFontKeyOf 变成 `sys:` 族键，见 src/system-fonts.js）。
  // ⚠️ 本机那一组先过 **`filterUsableSystemFonts`**：只留**本浏览器真的能匹配**的名字 ——
  //    系统列出的族名里有相当一部分（系统保留字体、同一字体的另一种写法）浏览器压根取不到，
  //    摆出来就是"选了没反应"（现场缺陷："控制台切换了字体，特殊文字还是显示成口"）。
  //    量不到时（替身 DOM / 无布局）它原样返回 ⇒ 这里不会因为"测不出来"而少给。
  // 本机那一组可能为空（清单还在路上 / 取不到）—— 空组**不渲染** optgroup
  //（给一个拉不动的分组比没有这个分组更让人困惑），状态由 sysFontNote 那一行说。
  // `skipInherit`：全局字体那一行不要「默认」项（它在那里等于"不覆盖"，与「跟随 DSH」同义）。
  // `current`：**当前值**。它即使不在清单里（换了机器 / 之前选过一个本浏览器取不到的名字）
  //   也必须摆进去 —— 否则 `<select>` 会显示成第一项（「跟随」）而值其实还存着，界面在撒谎。
  function familyOptions(sel, opts) {
    const o = opts || {};
    const builtin = o.skipInherit
      ? FONT_FAMILY_LABELS.filter((f) => f.v !== "inherit") : FONT_FAMILY_LABELS;
    const nodes = builtin.map((f) => React.createElement("option", { key: f.v, value: f.v }, f.label));
    const sys = filterUsableSystemFonts(sel.systemFonts).fonts
      .map((name) => ({ v: systemFontKeyOf(name), label: name }))
      .filter((x) => x.v);
    // ⚠️ 局部名不叫 `current`：那是本仓 `MUTABLE_ALIASES` 里的一员（picker 的 ctx 别名），
    //    `verify-client` 的"渲染器不得改写别名"判据会把这个**声明**误认成赋值。
    const curKey = typeof o.current === "string" ? o.current : "";
    if (curKey && !builtin.some((f) => f.v === curKey) && !sys.some((x) => x.v === curKey)) {
      const name = systemFontNameOf(curKey);
      if (name) sys.unshift({ v: curKey, label: name });
    }
    if (sys.length) {
      nodes.push(React.createElement("optgroup", { key: "__sys", label: weT("本机字体") },
        sys.map((x) => React.createElement("option", { key: x.v, value: x.v }, x.label))));
    }
    return nodes;
  }

  /**
   * 本机字体那一组的**状态行**（空串 = 没什么要说的）。
   * 四种要说话的情形都是"用户会以为坏了"的：还在扫、取不到、**按文件名推测**出来的清单、
   * 以及**有名字被本浏览器过滤掉** —— 最后这种必须说：否则用户找 `Apple Color Emoji` 找不到，
   * 只会以为清单又漏了，而真相是这个名字在本浏览器里取不到。
   */
  function sysFontNote(sel) {
    if (sel.systemFontsLoading) return weT("正在读取本机字体…");
    if (sel.systemFontsError) return weT("本机字体读不到：{why}", { why: sel.systemFontsError });
    if (sel.systemFontsApproximate && (sel.systemFonts || []).length) {
      return weT("本机字体是按文件名推测的（没拿到系统字体清单）");
    }
    const probe = filterUsableSystemFonts(sel.systemFonts);
    if (probe.skipped > 0) {
      return weT("已略过 {count} 个本浏览器取不到的字体名（选了也不会生效）", { count: probe.skipped });
    }
    return "";
  }

  /** 本机字体那一组的「重新扫描」（刚装完字体时的出路；在途时禁用）。 */
  function sysFontRefresh(sel, onRefresh) {
    return React.createElement("button", {
      key: "sys-font-refresh",
      type: "button",
      className: "we-picker__chip",
      disabled: sel.systemFontsLoading === true,
      onClick: () => onRefresh(),
      title: weT("重新读取本机已安装的字体（装了新字体之后用）"),
    }, weT("重新扫描"));
  }

  // ── 全局 / 终端字体两行 + 本机字体状态行 ──
  function renderFontGlobalFamily(sel, onGlobalFamily, onComponentFamily, onRefreshSystemFonts) {
    return React.createElement(React.Fragment, null,
    // ── 全局字体 / 终端字体：本机字体的两个入口 ──────────────────────────────
    // 两行一个形状。**全局**是"默认"不是"强制"：角色表与组件表里单独设过的仍以那里为准
    // （解析在 src/font/typography.js 的 buildTypePayload —— 角色没设才落到全局）。
    // **终端**写的就是「高级字体设置 → 终端」那一行的同一个键
    // （`componentFonts.terminal.family`）：两处是同一个值的两个入口，不会漂。
    React.createElement("div", { className: "we-picker__ctl", key: "global-family" },
      ctlText(weT("默认字体"), weT("整套界面的默认字族（全局）；角色 / 组件里单独设过的仍以那里为准")),
      React.createElement("select", {
        value: sanitizeFamilyKey(sel.globalFamily),
        style: { width: "150px" },
        onChange: (e) => onGlobalFamily(e.target.value),
        title: weT("整套界面（含角色表覆盖不到的文字）的默认字体；任意角色 / 组件单独设了字族，那里优先"),
      },
        React.createElement("option", { value: "" }, weT("跟随 DSH")),
        familyOptions(sel, { skipInherit: true, current: sanitizeFamilyKey(sel.globalFamily) }),
      ),
    ),
    React.createElement("div", { className: "we-picker__ctl", key: "terminal-family" },
      ctlText(weT("终端字体"), weT("对话里的终端块 + 侧栏终端面板（dsh-ssh）；与「高级字体设置 → 终端」同一项")),
      React.createElement("select", {
        value: fontFamilyKeyOf((sel.componentFonts.terminal || {}).family),
        style: { width: "150px" },
        onChange: (e) => onComponentFamily("terminal", e.target.value),
        title: weT("终端字体：① 对话里的终端块（走官方 --dsl-terminal-font 钩子）② 侧栏 / SSH 终端面板（走 dsh-ssh 给皮肤留的 --dsh-ssh-terminal-font 钩子）；「跟随」= 都不覆盖，各用它们自己的默认。⚠️ 若在 dsh-ssh 的设置里填过 terminalFontFamily，那个值优先级更高"),
      },
        React.createElement("option", { value: "" }, weT("跟随")),
        familyOptions(sel, { current: fontFamilyKeyOf((sel.componentFonts.terminal || {}).family) }),
      ),
    ),
    // 「本机字体」那一组的状态行 + 重新扫描：在途 / 取不到 / 按文件名推测都要说出来
    //（后两种用户会以为坏了；推测那种不说的话，用户会以为系统里真有那个族名）。
    React.createElement("div", { className: "we-picker__row", key: "sys-font-note" },
      React.createElement("span", { className: "we-picker__hint" }, sysFontNote(sel)),
      sysFontRefresh(sel, onRefreshSystemFonts),
    ),
    );
  }

  // ── 文字颜色角色（F1）：逐角色上色 + 深色单独设置 ──
  function renderFontColorRoles(sel, officialColorOf, onThemeDarkSeparate, onThemeColor, onThemeColorClear) {
    return React.createElement(React.Fragment, null,
    // F1：分角色上色 —— 每个角色独立放开（不把四个角色压成同一个色而压平 DSH 的四级层次），
    // 留空 = 跟随原生。经 theme 令牌层生效：body 内联、免 !important、{light,dark} 随配色自动换值。
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
    );
  }

  // ── 排版角色（F2/G4）：字号 / 字重 / 字族表 ──
  function renderFontTypeRoles(sel, typeRoles, onThemeTypeOnly, onThemeSize, onThemeWeight, onThemeFamily) {
    return React.createElement(React.Fragment, null,
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
            familyOptions(sel, { current: sel.themeFamily[role.id] || "" }),
          )),
        );
      }),
      ),
    ),
    );
  }

  // ── 组件字体（G3/G4，高级）：按组件细化表 ──
  function renderFontComponents(sel, onFontAdvanced, onComponentFont, onComponentFamily) {
    return React.createElement(React.Fragment, null,
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
        const famKey = fontFamilyKeyOf(c.family);
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
            familyOptions(sel, { current: famKey }),
          )),
        );
      }),
        ),
      ),
    ),
    );
  }

  // ── 字体集预设：总开关 + 编辑器 ──
  function renderFontSet(fontSet) {
    return React.createElement(React.Fragment, null,
    // 字重**没有全局值**（一个全局值会把 DSH 的粗细层次压成一档）：按角色（下面「排版角色」
    // 每行一个输入框）与按组件（「高级字体设置」里每组件一项）细化，都能填任意值；
    // 留空 /「恢复默认」即回 DSH 官方字重。
    // 字族同样无全局值：按角色（「排版角色」每行的字族下拉）与按组件（「高级字体设置」里每项
    // 的下拉）设置 —— 全局字族只经 body 继承，既压平 DSH 的字体栈层次，又够不到用 `font:` 简写的标题/表格/代码。
    // ── 字体集（**「字体自定义」的附属**）：总开关管"要不要自定义"，这里管"用哪一整套"。
    //    放在 `sel.fontCustom` 这一支**里面** —— 关掉自定义就整块收起（那时这一整套并不
    //    生效，摆出来只会让人以为它在起作用）。
    switchRow(weT("字体集预设"), fontSet.open, (e) => fontSet.onOpen(e.target.checked), {
      tooltip: weT("预设 = 一整套字体外观；改动只落到当前这一套，随时可以恢复原样"),
    }),
    fontSet.open && renderFontSetEditor(fontSet),
    );
  }

  function renderAppearanceFontSection(ctx) {
    const { officialColorOf, onComponentFamily, onComponentFont, onFontAdvanced, onFontResetAll, onGlobalFamily, onRefreshSystemFonts, onThemeColor, onThemeColorClear, onThemeDarkSeparate, onThemeFamily, onThemeSize, onThemeTypeOnly, onThemeWeight, onToggleFontCustom, fontOpen, onToggleFontSection, fontSet, sel } = ctx;
    // 「排版角色」表要按「只看改过的」筛，而**筛完是空**时要单独给一行提示 ⇒ 先算出来再渲染表。
    // ⚠️ 必须在 `React.createElement(...)` **之前**算（写成参数位置上的赋值表达式 ——
    //    赋值表达式的值是那个**数组本身**，于是它被当成一个子节点 ⇒ React #31「对象不能作为子节点」；
    //    空数组时看不出来，一旦有筛出来的角色就整块面板崩掉）。
    const typeRoles = THEME_TYPE_ROLES.filter((role) => !sel.themeTypeOnly
      || sel.themeSize[role.id] !== undefined
      || sel.themeWeight[role.id] !== undefined
      || sel.themeFamily[role.id] !== undefined);
    // ── 折叠态：整节一个开关（`fontOpen`，**默认收起** —— 调节项太多，默认全开太杂乱）。
    //    开合状态住 localStorage，渲染器只经 ctx 读它 + 调 onToggleFontSection，保持纯读契约。
    //    ⚠️ 两档各有自己的键（侧栏 `qp-font-open` / 设置页 `picker-font-open`）—— 与
    //    `qp-tab` / `picker-tab` 同一条"每档各自的 UI 状态"口径；两档默认值都是收起。
    const open = fontOpen === true;
    return React.createElement(React.Fragment, null,
    // ── 字体 (custom typography)：总开关（关 = 恢复 dsh 原生字体）+ 颜色角色 / 排版角色 /
    //    字体族 / 组件字体（高级），开启时才渲染细节控件。字重不设全局值：按角色与按组件细化。
    //    ⚠️ 分档（ADR-0008 D4 **三次修订**，2026-10-11 用户口径）：这一节**两档都画**
    //    （侧栏 + 设置页），无 surface 门。二次修订曾把它单向迁进侧栏，随后用户在设置页
    //    找不到该节、报"字体自定义被干掉了" ⇒ 用户口径"两边都有"。两档都**默认收起**
    //    （节头点击展开），开合状态各记各的键。──
    React.createElement("div", { className: "we-picker__section" },
      React.createElement("div", {
        className: "we-picker__section-head we-picker__section-head--toggle",
        role: "button",
        tabIndex: 0,
        "aria-expanded": open ? "true" : "false",
        onClick: () => onToggleFontSection && onToggleFontSection(),
        onKeyDown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (onToggleFontSection) onToggleFontSection();
          }
        },
      },
        React.createElement("span", { className: "we-picker__section-label" }, weT("全局字体")),
        React.createElement("span", {
          className: "we-picker__section-caret" + (open ? " is-open" : ""),
          "aria-hidden": "true",
        }, "▾"),
      ),
      open && switchRow(weT("字体自定义"), sel.fontCustom, (e) => onToggleFontCustom(e.target.checked), {
        tooltip: weT("关闭后恢复 dsh 默认字体外观；开启后可调颜色角色、排版角色（字号/字重/字族）与组件字体"),
      }),
      // 「恢复默认」只在总开关开启时出现：关闭时字体本就是 DSH 默认值，摆一个"恢复默认"
      // 没有意义（也会让人以为关掉开关还残留了什么自定义）。
      open && sel.fontCustom && React.createElement("div", { className: "we-picker__ctl" },
        React.createElement("button", {
          type: "button",
          className: "we-picker__chip",
          onClick: onFontResetAll,
          title: weT("清空所有字体自定义项（颜色角色 / 排版 / 字重 / 字族 / 组件字体），回到 DSH 默认"),
        }, weT("恢复默认")),
      ),
      open && sel.fontCustom && React.createElement(React.Fragment, null,
        renderFontGlobalFamily(sel, onGlobalFamily, onComponentFamily, onRefreshSystemFonts),
        renderFontColorRoles(sel, officialColorOf, onThemeDarkSeparate, onThemeColor, onThemeColorClear),
        renderFontTypeRoles(sel, typeRoles, onThemeTypeOnly, onThemeSize, onThemeWeight, onThemeFamily),
        renderFontComponents(sel, onFontAdvanced, onComponentFont, onComponentFamily),
        renderFontSet(fontSet),
      ),
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
    const { onSidebarAllCorners, onSidebarCornerRadius, onSidebarCornerSquare, sel, cornersOpen, onToggleCornersSection } = ctx;
    // ⚠️ 折叠门同「细节」节（2026-10-11 二次修订）：两档都支持隐藏，差别只在默认值。
    const open = cornersOpen === true;
    return React.createElement(React.Fragment, null,
      React.createElement("div", { className: "we-picker__section" },
        sectionHead(weT("侧边栏圆角"), open, onToggleCornersSection),
        open && sidebarCornerGroup("left", weT("左侧栏"), sel, onSidebarCornerRadius, onSidebarCornerSquare, onSidebarAllCorners),
        open && sidebarCornerGroup("right", weT("右侧栏"), sel, onSidebarCornerRadius, onSidebarCornerSquare, onSidebarAllCorners),
      ),
    );
  }

  // ── 「全局 UI 配色」节（2026-10-11 用户口径）：配色成为独立大项 + 五处"蓝色元素"可单独调 ──
  //    结构按用户原话：「做成 <全局 UI 配色> 下挂 <全局配色> 和 <UI 配色自定义>」——
  //      · **全局配色**（accent，原住「主题」节）＝ "用于直接调整全部"；
  //      · **UI 配色自定义**（开关，**默认关**，与 fontCustom 同形）＝ 开启后下面五项各自可调，
  //        此时「全局配色」整行**禁用**（用户口径：「开启后<全局配色>禁用，采用<UI配色自定义>」）。
  //    ⚠️ 五项的空值语义 = **跟随「全局配色」**（effects.js 里 `selection[k] || accent`）⇒
  //       开启那一刻观感零变化，随后逐项微调；不是"清空成宿主原生"。
  //    ⚠️ 折叠门与字体节同形（`uiColorOpen`，默认收起，两档各记各的 localStorage 键）。
  //    令牌与宿主消费者的实证见 `src/styles.js` 的同名段与 `lib/settings-schema.js` 的 DEFAULTS 注释。
  function renderAppearanceUiColorSection(ctx) {
    const { onAccent, onCaretColor, onToggleUiColorCustom, onUiColorElement, sel, uiColorOpen, onToggleUiColorSection } = ctx;
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
      React.createElement("div", {
        className: "we-picker__section-head we-picker__section-head--toggle",
        role: "button",
        tabIndex: 0,
        "aria-expanded": open ? "true" : "false",
        onClick: () => onToggleUiColorSection && onToggleUiColorSection(),
        onKeyDown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (onToggleUiColorSection) onToggleUiColorSection();
          }
        },
      },
        React.createElement("span", { className: "we-picker__section-label" }, weT("全局 UI 配色")),
        React.createElement("span", {
          className: "we-picker__section-caret" + (open ? " is-open" : ""),
          "aria-hidden": "true",
        }, "▾"),
      ),
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


export { renderAppearanceThemeSection, renderAppearanceDetailSection, familyOptions, renderFontGlobalFamily, renderFontColorRoles, renderFontTypeRoles, renderFontComponents, renderFontSet, renderAppearanceFontSection, renderAppearanceSidebarCornersSection, renderAppearanceUiColorSection };
