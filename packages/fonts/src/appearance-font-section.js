/**
 * appearance-font-section.js — 外观页签第六节「全局字体」的渲染器（P-C 搬出）。
 *
 * 原来住在 src/panel-tabs-appearance.js 的 54-420 行，**函数体逐字未改**，只是换了住处。
 *
 * 跨包形状（契约 §2.1 / §2.2）：
 *   · 本文件**只画界面**：稳定零件（React / weT / switchRow / ctlText / sectionHead /
 *     moduleResetButton / 字族与主题数据表）由入口 src/client.js 从 host 的**显式键集**解构，
 *     落在同一个工厂作用域里 —— 所以这里照旧按裸名引用，不 import、不 require。
 *   · 每次渲染才存在的值与意图回调（sel / fontSet / onThemeFamily / onToggleFontSection …）
 *     仍走 ctx（主包在渲染处构造）。
 *   · 屏上顺序由入口登记的描述符决定：不写 order ⇒ 排在五个内置节之后（见 panel-tabs.js）。
 *
 * ⚠️ 归属（§6.1 = A / ADR-0013 D20）：本节只画界面。字体的**键与状态真源**在主包
 * `lib/settings-schema.js` 的 `FONTSET_KEYS` 与 `fontsets/<id>.json`；本文件不持键、
 * 不落盘、不注册 settings 段 —— 读值只走渲染 ctx 与入口解构的 host 显式键集。
 */
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

  // ── 文字颜色角色：逐角色上色 + 深色单独设置 ──
  function renderFontColorRoles(sel, officialColorOf, onThemeDarkSeparate, onThemeColor, onThemeColorClear) {
    return React.createElement(React.Fragment, null,
    // 分角色上色 —— 每个角色独立放开（不把四个角色压成同一个色而压平 DSH 的四级层次），
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
    const { officialColorOf, onComponentFamily, onComponentFont, onFontAdvanced, onFontResetAll, onGlobalFamily, onRefreshSystemFonts, onResetModule, onThemeColor, onThemeColorClear, onThemeDarkSeparate, onThemeFamily, onThemeSize, onThemeTypeOnly, onThemeWeight, onToggleFontCustom, fontOpen, onToggleFontSection, fontSet, sel } = ctx;
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
    //    ⚠️ 分档（ADR-0008 D4 **三次修订**，用户口径）：这一节**两档都画**
    //    （侧栏 + 设置页），无 surface 门。二次修订曾把它单向迁进侧栏，随后用户在设置页
    //    找不到该节、报"字体自定义被干掉了" ⇒ 用户口径"两边都有"。两档都**默认收起**
    //    （节头点击展开），开合状态各记各的键。──
    React.createElement("div", { className: "we-picker__section" },
      // 节头一律走共用构件（`sectionHead`）：折叠三角与模块级 ↺ 的**次序只有一份实现**
      // ——手写副本正是次序会漂的地方（一处改了另一处不改 ⇒ 只有部分模块对齐）。
      sectionHead(weT("全局字体"), open, onToggleFontSection, moduleResetButton("font", onResetModule)),
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

// 独立文件形态下必须有导出：本文件被内联进产物时这一行会被构建器剥掉
// （scripts/build-client.mjs 的 EXPORT_BLOCK，同 packages/fonts/src/fontset-editor.js:205 的先例），
// 但渲染挂载台（test/verify-scene-live.mjs 等）是**按文件 import** 的，没有它就取不到渲染器。
export { renderAppearanceFontSection };
