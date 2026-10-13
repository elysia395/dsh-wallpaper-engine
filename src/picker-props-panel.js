/**
 * picker-props-panel.js — 「壁纸属性」面板（WE 用户属性）的渲染器。
 *
 * 为什么单独一个文件：这块面板是选择器里**控件分支最多**的一处标记 —— 一个 ptype 一条分支
 * （`text`/`group` 分组标题、bool、color、slider、combo、file/directory、兜底文本输入），
 * 另有 `condition` 显隐与「已改」圆点。与 `WallpaperPicker` 的处理器分离之后，组件体只剩
 * 「状态 + 处理器 + 装配」，面板怎么画看这里。
 *
 * 契约（构建期由 scripts/build-client.mjs 内联进 bundle 的工厂作用域，"外部作用域" =
 * 同一 prelude / src/client.js 的顶层）：
 *   · 渲染器**只从一个参数取外界**：`(ctx)` —— 解构出 `open/token/loading/error/props/…`
 *     （对应组件侧的 `propsState.props/loading/error`）与三个回调
 *     （`ensureDefs` / `onPropInput` / `onReset`，对应 `loadUserPropDefs` / `onUserPropInput`
 *     / `resetUserProps`）。
 *   · ctx 由 src/client.js 在**调用点**就地组装（见那里那次 `renderPickerPropsPanel({...})`）：
 *     面板状态（开关 / token / 加载态 / 错误 / 属性表 / 实时渲染是否接管）+ 三个回调。
 *     **多传字段无害，漏传会当场 ReferenceError**（守卫会抓住）—— 刻意选的失败方式：
 *     响亮且可定位。
 *   · 面板状态与「改一个属性」的动作仍住在 src/client.js（属处理器层）：本渲染器**不写
 *     `selection`、不自己发通知**。`ensureDefs(token)` 只表达"该有属性定义了"，那次重拉的
 *     判定（token 变了且不在加载中）与调用留在处理器层。
 *   · 模块级依赖（React / weEvalCondition / weColorToHex / weHexToColor / sameUserPropValue）
 *     直接读，不经过 ctx —— 它们是常量与纯函数工具。
 *   · 本文件必须保持浏览器安全（无 import / require / Node API），且**不得有顶层可执行语句**
 *     读 client.js 的 const（会被内联到 bundle 顶部，撞 TDZ）。
 *
 * **标记等价**是这一项的验收核心：这棵子树的 class 序列（深度优先 + 深度前缀）必须
 * 逐字相同 —— 判据在 `test/verify-picker-props.mjs`（golden + 负对照 + 字面量绝对锚点），
 * 那里同时钉住每个 ptype 的控件分支、`condition` 显隐与改动落盘。
 */

  function renderPickerPropsPanel(ctx) {
    const { open, token, loading, error, props, sceneLiveActive, source, ensureDefs, onPropInput, onReset } = ctx;
    if (!open) return null;
    // 没有 token ⇒ 不画。两个壳都不存在"开关开着却没有 token"的常态：侧栏那支由调用点的
    // 门保证（`userPropsPanelOpen() && propsAvailable`），而清掉壁纸时 `onClear` 会把开关
    // 一并收起（否则下次选一张带属性的壁纸，面板会自己弹开）。
    if (!token) return null;
    // 面板开着换了壁纸：拉当前这张的属性（判定与调用留在处理器层）
    ensureDefs(token);
    const values = {};
    for (const p of props) {
      if (p.ptype !== "text" && p.ptype !== "group") values[p.name] = p.value;
    }
    // `props` 是**上一次求值留下的那张表**（宿主是异步的）：token 与当前选中项不一致时
    // 它属于上一张壁纸 —— 那种情况下不许画出来（否则改的是这张、看到的是上一张的值）。
    const stale = Boolean(source && source.token && source.token !== token);
    const defs = stale ? [] : props;
    const rows = defs
      .filter((p) => !p.condition || weEvalCondition(p.condition, values))
      .map((p) => renderUserPropRow(p, onPropInput));
    // 说明句按**成因**分开写：宿主说"没有属性"、请求还在路上、宿主答了失败、上一张的表
    // 还没换、条件全挡住 —— 这五种在界面上必须能分辨（"空面板"最容易被误读成面板坏了）。
    const note = stale
      ? weT("正在取这张壁纸的属性…")
      : loading
        ? weT("读取中…")
        : error
          ? weT(error)
          : !source || source.heard
            ? rows.length
              ? ""
              : defs.length
                ? weT("当前条件下没有可调项")
                : weT("这张壁纸没有用户属性（project.json 的 general.properties）")
            : weT("等待壁纸属性…（宿主尚未答复）");
    return React.createElement("div", { className: "we-picker__props" },
      React.createElement("div", { className: "we-picker__props-head" },
        React.createElement("span", { className: "we-picker__props-title" }, weT("壁纸属性")),
        React.createElement("span", { className: "we-picker__props-note" }, note),
        React.createElement("button", {
          className: "we-picker__btn we-picker__btn--mini", type: "button",
          onClick: onReset,
          disabled: !props.some((p) => p.overridden),
        }, weT("恢复默认")),
      ),
      // 实时渲染没接管时改动不会立刻可见 —— 明说，免得以为面板坏了
      !sceneLiveActive && React.createElement("div", { className: "we-picker__props-hint" },
        weT("实时渲染当前未接管（静态帧 / 兼容模式），改动会在下次实时渲染时生效。")),
      rows,
    );
  }

  // ── 按 ptype 出控件；拖动类（slider/color）在 input 时就热更新但**不重渲染**
  //（拖动中每帧 emit 整个选择器很浪费），change 时才 emit 刷新数值回显。
  function renderUserPropRow(p, onPropInput) {
    if (p.ptype === "text" || p.ptype === "group") {
      return React.createElement("div", {
        key: p.name, className: "we-picker__props-section",
      }, p.text);
    }
    const label = React.createElement("span", { className: "we-picker__props-label", title: p.name },
      p.text,
      p.overridden && React.createElement("span", { className: "we-picker__props-dot", title: weT("已改（点「恢复默认」还原）") }, "•"),
    );
    let control;
    if (p.ptype === "bool") {
      control = React.createElement("input", {
        type: "checkbox", className: "we-picker__props-check",
        checked: p.value === true,
        onChange: (e) => onPropInput(p, e.target.checked, false),
      });
    } else if (p.ptype === "color") {
      control = React.createElement("input", {
        type: "color", className: "we-picker__props-color",
        value: weColorToHex(p.value),
        onInput: (e) => onPropInput(p, weHexToColor(e.target.value), true),
        onChange: (e) => onPropInput(p, weHexToColor(e.target.value), false),
      });
    } else if (p.ptype === "slider") {
      const min = typeof p.min === "number" ? p.min : 0;
      const max = typeof p.max === "number" ? p.max : 1;
      const step = typeof p.step === "number" && p.step > 0 ? p.step : (max - min) / 100;
      const digits = typeof p.precision === "number" ? Math.max(0, Math.min(6, p.precision)) : 2;
      const shown = typeof p.value === "number" ? p.value.toFixed(digits) : String(p.value === null ? "" : p.value);
      control = React.createElement(React.Fragment, null,
        React.createElement("input", {
          type: "range", className: "we-picker__slider",
          min, max, step,
          value: typeof p.value === "number" ? p.value : min,
          onInput: (e) => onPropInput(p, Number(e.target.value), true),
          onChange: (e) => onPropInput(p, Number(e.target.value), false),
        }),
        React.createElement("span", { className: "we-picker__props-value" }, shown),
      );
    } else if (p.ptype === "combo" && Array.isArray(p.options)) {
      // 选项值可能是数字/字符串/布尔混用：用**下标**做 select 的值，回写时取回
      // 声明类型（字符串化会让壁纸里的 === / switch 失配）。
      const idx = Math.max(0, p.options.findIndex((o) => sameUserPropValue(o.value, p.value)));
      control = React.createElement("select", {
        className: "we-picker__props-select",
        value: String(idx),
        onChange: (e) => {
          const opt = p.options[Number(e.target.value)];
          if (opt) onPropInput(p, opt.value, false);
        },
      }, p.options.map((o, i) => React.createElement("option", {
        key: i, value: String(i),
      }, o.label)));
    } else if ((p.ptype === "file" || p.ptype === "directory") && Array.isArray(p.files)) {
      const cur = typeof p.value === "string" ? p.value : "";
      const list = p.files.includes(cur) || !cur ? p.files : [cur].concat(p.files);
      control = React.createElement("select", {
        className: "we-picker__props-select",
        value: cur,
        onChange: (e) => onPropInput(p, e.target.value, false),
      }, [{ label: weT("（默认）"), value: "" }].concat(list.map((f) => ({ label: f, value: f })))
        .map((o, i) => React.createElement("option", { key: i, value: o.value }, o.label)));
    } else {
      control = React.createElement("input", {
        type: "text", className: "we-picker__props-text",
        defaultValue: typeof p.value === "string" ? p.value : "",
        // 文本类不做逐键热更新（每敲一下都跑一遍壁纸的属性处理太重），失焦/回车生效
        onChange: (e) => onPropInput(p, e.target.value, false),
      });
    }
    return React.createElement("div", { key: p.name, className: "we-picker__props-row" }, label, control);
  }

  export {
    renderPickerPropsPanel,
  };
