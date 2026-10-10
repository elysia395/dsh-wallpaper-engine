/**
 * glass-panel.js — 「玻璃 UI」节的**渲染器**（纯渲染 + 显式 ctx）。
 *
 * 为什么单开一个文件：它与其它页签**只共享模块级纯助手** —— `React` / `SliderRow` / `switchRow` /
 * `swatchRow` / `weT` / `GLASS_COLOR_PRESETS` 都是**顶层声明**（`src/client.js` 等），构建期内联进
 * 同一工厂作用域 ⇒ **不需要任何 ctx 传参样板**，`renderAppearanceTab` 按名字调用即可。
 *
 * 契约（与 `src/panel-tabs.js` 文件头同一条，不在此重复解释）：
 *   · **只读** ctx —— 不得写 `selection` / ctx 别名指向的东西 / 模块级状态；
 *   · **动作经具名处理器** —— 写设置一律走 `on*`（由 `src/client.js` 提供），本文件只回答"画什么"；
 *   · 浏览器安全（无 import / require / Node API），且不得有顶层可执行语句读 client.js 的 const。
 *
 * 渲染源是**注册表驱动**的：`GLASS_CHILDREN`（`lib/settings-schema.js` 的登记表）+ `childGlassKey()`
 * 决定每个子项有哪些参数、叫什么 ⇒ 这里**不硬编码四项**（硬编码正是"面板渲染死旋钮"的来源，
 * 见 wip §10.12）。
 */
/**
 * 「玻璃 UI」节 —— 全局四件套 + 每个子面的「独立配置」开关（高级配置）。
 *
 * 结构：
 *   玻璃 UI
 *   ├─ 全局：玻璃颜色 · 玻璃透明度 · 雾化 · 玻璃保真度
 *   └─ 子 UI 独立配置（不进简化配置）
 *      └─ 每个子面一个开关：[独立配置] ⇒ 打开后展开它自己的参数行
 *
 * ⚠️ **没有"要不要玻璃"的开关**（用户口径）：玻璃是恒要的 —— 实测一个"关"并**不能**如愿恢复
 *    原生黑/白纯色（那些面上还有一批不挂门控的令牌改写，见 `src/glass.js` 的退役说明）⇒ 这一节
 *    剩下的**唯一**问题就是"读自己 还是 跟全局"。
 * ⚠️ 「左侧栏液态玻璃」**不在**本节的子项里：它的"关"是**恢复背景**（那列回到壁纸原样），
 *    语义不同 —— 它是乙类，独立成项留在「细节」，本节的 `panelOff` 过滤就是为它。
 */
/**
 * 「预设方案」块（玻璃节顶部的第一行，先于全局四件套）。
 *
 * 为什么放在最顶上：这一节的调节粒度太细（全局四件套 + 每面独立配置 + 侧栏族），
 * 预设是"不想逐项调"的用户的主路 —— 进门第一眼就该是它。它与下面的旋钮**读写同一批键**：
 * 应用 = 整机配置快照合并（ADR-0011：settings 段总带 + 资产段按勾选，键集见
 * `PROFILE_PRESET_KEYS`），应用完下面所有滑块跟着变（同一 selection）。
 *
 * 形态纪律（承 fontset-editor.js，均有守卫）：
 *   · **出厂预设的名字走词表**（`FACTORY_PRESET_CN` 就地包 weT ⇒ 文本扫描看得见），
 *     用户预设显示原名 —— 随包文件里的 name 是数据，扫描看不见，所以映射表必须是字面量；
 *   · **破坏性动作两步确认**且不用原生对话框（复用 client.js 的 armConfirm / renderConfirmRow）；
 *   · **出厂预设的删除 = 永久删除**（两步确认点明不可恢复；宿主落墓碑遮蔽，无恢复通道）；
 *   · **读不懂的预设禁用但保留删除**（删掉坏文件是唯一出路）：「禁用」指**应用键**
 *     （`disabled: Boolean(broken)`）；「保留删除」指删除键与**两步确认行对坏行照常渲染**
 *     （此前的 `!armedRow.broken` 把确认行挡掉 ⇒ 坏行点了 `×` 没反应、永远删不掉，t7 配套修复）。
 *     `broken` 的文案按 origin 分：出厂 = **版本作废**口径（旧 tag 已作废，出路是"从预设栏
 *     重新保存一份"），用户层 = 文件坏了/被清空了；不能只给笼统的"读不出来"（ADR-0011 D6）；
 *   · 失败态给**可判定原因**（selection.glassPresetError，宿主原话 + weT 查英文表）。
 *
 * 保存 / 导出的**资产勾选对话框**（ADR-0011 D4，非模态）：三个勾选项各带一行
 * **不勾的后果**说明 —— 不勾字体 ⇒ 回落接收方当前那份；不勾吉祥物 ⇒ 回落内置
 * maid/whale/phoebe；不勾头像 ⇒ 回落内置默认头像。数值键（开关/尺寸/圆角）恒在 settings 段，
 * 不受勾选影响。默认值：字体 ✅ / 吉祥物 ✅ / 头像 ❌（D4：头像体积翻倍、与"分享一份
 * 外观配置"关系最弱）。勾选状态是视图态（ctx.assetChecks + onAssetToggle）。
 * **保存与导出都先过这道对话框**（ADR 修订版第③条）：保存 = 名字行 → 勾选 → 「保存预设」；
 * 导出 = 每行「导出」→ 同一组勾选 → 「下载 .json」。勾选的每一项只在**本机确实有那份
 * 资产**时才可勾（宿主按名单内嵌，没有的东西内嵌不出段；行的说明会写明）。
 * 本渲染器**只画**：网络与状态全部经 ctx（store 在 src/preset-store.js，接线在 client.js 的
 * glassPresetCtx）。
 */
/**
 * 导入用的隐藏 file input 的**模块级 ref**（与 src/fontset-editor.js 同形：模块级变量 +
 * 按钮去 `.click()`；⚠️ 名字不能撞 —— fontset-editor 已占 `importInput`，平铺进 bundle
 * 后是同一作用域，撞名 = SyntaxError，构建期会红）。只做"选文件"，读文件与三道
 * 本地预检在 `importGlassPreset`（src/preset-store.js）。
 */
let gpImportInput = null;

function renderGlassPresetsBlock(gp) {
  const {
    presets, loading, error, note, saving, draftName, armedId,
    saveTarget, exportTargetId, assetChecks, onAssetToggle, onExportCommit, onSaveCommit2,
    onApply, onOpenSave, onOpenExport, onExportTargetChange, onDraftName, onSaveCommit, onCancelSave,
    onArmDelete, onDisarm, onDelete,
    onImportFile,
  } = gp || {};
  if (!presets) return null; // ctx 缺席时不画（渲染器不抛，也不画半个块）
  const rows = Array.isArray(presets) ? presets : [];
  // 可导出的 = 清单里**读得出来**的那几份。broken 的没有可导出的正文（宿主对它 422），
  // 故不进选择器 —— 画一个选了必然失败的下拉项等于骗用户。
  const exportable = rows.filter((r) => !(typeof r.broken === "string" && r.broken));
  // 出厂预设名字的词表：**就地包 weT**（渲染函数内，理由见本文件 CHILD_CN 同款注释 ——
  // i18n 判据是文本扫描，只认 weT("…") 字面量；数据里的名字扫描看不见）。
  // 两侧靠 id 对齐；漏了的出厂 id 回落显示文件里的原名（渐进式，不炸）。
  const FACTORY_PRESET_CN = {
    "factory-default": weT("黑客绿(Fish)"),
    "factory-clear": weT("清透速览"),
    "factory-frosted": weT("重磨砂"),
    "factory-night": weT("暗夜釉色"),
    "factory-vivid": weT("原色直出"),
    "factory-readable": weT("可读优先"),
    "factory-author": weT("作者自用"),
  };
  const labelOf = (row) => (row.origin === "builtin" && FACTORY_PRESET_CN[row.id])
    ? FACTORY_PRESET_CN[row.id]
    : (row.name || row.id);
  const checks = assetChecks || {};
  const has = (k) => checks[k] === true;
  // ── 资产勾选对话框的行（保存与导出共用同一组勾选项与后果说明；非模态、就地展开）──
  // 每行 = 胶囊开关（复用 switchRow）+ 一行**不勾的后果**（D4 用户明确要求写出来）。
  // available = 本机现在**有**这份资产（没有可带的段 —— 勾了也带不出东西，禁用并说明）。
  const fontAvailable = checks.fontAvailable === true;
  const mascotAvailable = checks.mascotAvailable === true;
  const avatarAvailable = checks.avatarAvailable === true;
  const assetRows = React.createElement(React.Fragment, null,
    switchRow(weT("字体"), has("font"), (e) => onAssetToggle("font", e.target.checked), {
      key: "pa-font",
      disabled: !fontAvailable,
      hint: fontAvailable
        ? weT("不勾：接收方的字体回落它当前那份（颜色 / 排版 / 字族不变）")
        : weT("本机还是默认字体（没改过字体集）—— 没有可携带的字体配置"),
      tooltip: weT("把当前活动字体集的颜色角色 / 排版 / 字族 / 组件字体一并存进预设"),
    }),
    switchRow(weT("吉祥物立绘"), has("mascot"), (e) => onAssetToggle("mascot", e.target.checked), {
      key: "pa-mascot",
      disabled: !mascotAvailable,
      hint: mascotAvailable
        ? weT("不勾：吉祥物回落内置立绘（小女仆 / 鲸御姐 / 菲比啾比）")
        : weT("本机没有自定义立绘 —— 用的是内置小女仆 / 鲸御姐 / 菲比啾比"),
      tooltip: weT("把自定义吉祥物立绘的图片与显示盒一并存进预设（默认勾选）"),
    }),
    switchRow(weT("会话头像"), has("avatar"), (e) => onAssetToggle("avatar", e.target.checked), {
      key: "pa-avatar",
      disabled: !avatarAvailable,
      hint: avatarAvailable
        ? weT("不勾：会话头像回落内置默认头像；头像体积翻倍，默认不勾")
        : weT("本机没有自定义头像 —— 会话用的是内置默认头像"),
      tooltip: weT("把自定义会话头像的两张图一并存进预设（默认不勾：体积翻倍，与分享一份外观配置关系最弱）"),
    }),
    React.createElement("div", { className: "we-picker__hint", key: "pa-note" },
      weT("数值配置（开关 / 尺寸 / 圆角 / 颜色等）总是完整保存，不受勾选影响 —— 勾选只决定图片与字体要不要一并带走。")),
  );
  // 两行四列的圆角表格（用户口径）：每格 = 预设名（点击应用，占满）
  // + 右侧固定删除键；不足 8 个的格子画虚框空位 —— 上限 8 直接看得见。
  // ⚠️ armedId 是 **裸 id**（armedIdOf("gpreset") 已把族前缀剥掉，与 fontset-editor
  //    同一口径）—— 拿它和带前缀的令牌串比较永远不等 ⇒ 确认行永远不渲染
  //    （实测："点删除没反应"就是这个）。行为守卫：verify-presets ④。
  const cells = [];
  for (let i = 0; i < 8; i++) {
    const row = rows[i];
    if (!row) {
      cells.push(React.createElement("div", {
        key: "empty-" + i, className: "we-picker__preset-cell we-picker__preset-cell--empty",
      }, React.createElement("span", { className: "we-picker__hint" }, weT("空预设位"))));
      continue;
    }
    const broken = typeof row.broken === "string" && row.broken;
    const isUser = row.origin === "user";
    const armed = armedId === row.id;
    // ⚠️ broken 文案按 **origin** 分口径（ADR-0011 D6）：
    //   · 出厂 = **版本作废**：旧 tag 的预设正文已被作废、不做兼容 —— 出路是
    //     "重新保存一份"（对出厂即"从预设栏按当前配置再存一份同名预设"）；
    //   · 用户层 = 文件读不出（坏文件/被清空）—— 出路同样是删掉重存。
    //   不能只给笼统的"读不出来"：用户看到的是"该重存"，不是"预设没了"。
    const brokenTitle = isUser
      ? weT("这份预设读不出来：{reason}（删掉它，重新保存一份）", { reason: broken })
      : weT("这份出厂预设的版本已作废：{reason}（旧格式不再兼容 —— 从预设栏重新保存一份即可）", { reason: broken });
    cells.push(React.createElement("div", {
      key: row.id,
      className: "we-picker__preset-cell" + (armed ? " we-picker__preset-cell--armed" : ""),
    },
      React.createElement("button", {
        className: "we-picker__btn", type: "button",
        disabled: Boolean(broken) || loading === true,
        title: broken
          ? brokenTitle
          : weT("应用「{name}」：整机配置快照立即生效（观感 / 行为 / 勾选的字体与图片），之后可以继续微调", { name: labelOf(row) }),
        onClick: () => onApply(row.id),
      }, labelOf(row)),
      // ⚠️ 这里**没有**导出的格子键（2026-10-11 用户口径）：导出已独立成网格下方的
      //    「导出预设…」入口 —— 导出是**对"哪一份"**的动作，逐格挂一排同名键既挤格子
      //    又和"导出自己想要的那份"重复；独立入口 + 对话框里选目标，一处就够。
      // ⚠️ 删除键对**所有格**都有（用户口径：出厂预设可删，删除即永久、
      //    不可恢复），统一固定在每格最右侧；文案按 origin 分。
      React.createElement("button", {
        className: "we-picker__btn we-picker__preset-del", type: "button",
        disabled: loading === true,
        title: armed
          ? weT("已经问过你了 —— 在下面那一行选「确认」或「取消」")
          : (isUser
            ? weT("删除这个预设（会再问一次）")
            : weT("删除这个出厂预设（不可恢复）")),
        onClick: () => { if (!armed) onArmDelete(row.id); },
      }, "×"),
    ));
  }
  const chipRow = React.createElement("div", { className: "we-picker__preset-grid", key: "gp-grid" }, cells);
  // 网格下方的**动作行**（不在格子里 —— 格子属于预设本身）：保存 / 导出 / 导入。
  //   · 保存：满 8 个禁用并指路（删除腾位）；
  //   · 导出：**独立入口**（2026-10-11 用户口径）—— 对话框里再选"导出哪一份"；
  //   · 导入：隐藏 file input + 按钮。
  const openSaveRow = saving
    ? null
    : React.createElement("div", { className: "we-picker__ctl we-picker__ctl--wrap", key: "gp-save-open" },
      React.createElement("button", {
        className: "we-picker__btn", type: "button",
        disabled: loading === true || rows.length >= 8,
        title: rows.length >= 8
          ? weT("已达预设上限（8 个）—— 删除不需要的预设后再存")
          : weT("把当前这套整机配置存成一份你自己的预设（之后从预设行一键取回）"),
        onClick: () => onOpenSave(),
      }, weT("保存当前为预设…")),
      React.createElement("button", {
        className: "we-picker__btn", type: "button", key: "gp-export-open",
        disabled: loading === true || exportable.length === 0,
        title: exportable.length === 0
          ? weT("没有可导出的预设 —— 先保存一份，或先删掉读不出来的那份")
          : weT("把已有预设导出成 .json（可分享 / 可再导入）—— 先选导出哪一份，再选带哪些资产"),
        onClick: () => onOpenExport(),
      }, weT("导出预设…")),
      // 导入：隐藏 file input + 按钮（与字体集导入同形；三道本地预检在 store）。
      // ⚠️ 这里的 ref 回调在渲染期执行，属 React 托管行为，不是顶层副作用。
      React.createElement("input", {
        className: "we-picker__file", type: "file", key: "gp-import-input",
        accept: ".json,application/json",
        style: { display: "none" },
        ref: (el) => { gpImportInput = el; },
        onChange: (e) => {
          const f = e.target.files && e.target.files[0];
          try { e.target.value = ""; } catch { /* ignore */ }
          if (f) onImportFile(f);
        },
      }),
      React.createElement("button", {
        className: "we-picker__btn", type: "button", key: "gp-import-btn",
        disabled: loading === true,
        title: weT("从「导出」得到的 .json 导入一份预设（导入后不会立刻应用 —— 去列表里点它）"),
        onClick: () => { if (gpImportInput && typeof gpImportInput.click === "function") gpImportInput.click(); },
      }, weT("导入预设…")),
    );
  // 删除的两步确认行（令牌族 "gpreset:"；`!token` 退化不渲染 —— renderConfirmRow 的不变量）。
  // ⚠️ **坏行也要渲染**（t7 配套修复）：文件头的「读不懂的预设禁用但保留删除 —— 删掉坏文件是
  //    唯一出路」指的正是这条确认行。此前的 `!armedRow.broken` 把它挡掉，用户点 `×` 的观感是
  //    "点了没反应"（令牌置了、确认行不来），坏预设从界面上永远删不掉；ADR-0011 D6 让旧 tag
  //    统一作废后每份旧预设都命中这条。禁用的只是**应用键**（上面的 `disabled: Boolean(broken)`），
  //    删除键与确认行对所有行（含 broken）同形。令牌判据仍由 renderConfirmRow 自己守
  //   （armedId 找不到对应行 ⇒ armedRow 为 null ⇒ 不渲染）。
  const armedRow = armedId ? rows.find((r) => r.id === armedId) : null;
  const armedQuestion = armedRow && (armedRow.origin === "user"
    ? weT("删除预设「{name}」？此操作不可恢复。", { name: labelOf(armedRow) })
    : weT("删除出厂预设「{name}」？此操作不可恢复。", { name: labelOf(armedRow) }));
  const confirmRow = armedRow
    ? renderConfirmRow(armedId, armedId, armedQuestion, () => onDelete(armedRow.id), () => onDisarm())
    : null;
  // ── 保存 / 导出对话框（非模态，同一组资产勾选项；ADR 修订版第③条：两处都先问）────
  //   · saveTarget === "save"   → 名字行 + 勾选 + 「保存预设」（真正落盘）；
  //   · saveTarget === "export" → **选目标** + 勾选 + 「下载 .json」。导出是"对某一份"的
  //     动作，而入口已独立成一行（2026-10-11 用户口径）⇒ 目标由这里的下拉选，值经
  //     `onExportTargetChange` 落进 `glassPresetTargetId`。下载走普通链接导航（宿主带
  //     Content-Disposition 应答），导出**不走**改名/正文路径 —— 正文由宿主读到的值重建。
  //   取消把对话框与名字行一起收起。
  const exportRow = saving && saveTarget === "export"
    ? React.createElement(React.Fragment, { key: "gp-export" },
      React.createElement("div", { className: "we-picker__ctl we-picker__ctl--wrap", key: "gp-export-target" },
        ctlText(weT("导出哪一份"), weT("从当前已有的预设里选一份（正文由宿主按读到的值重建，不是照抄磁盘字节）")),
        React.createElement("select", {
          className: "we-picker__select",
          value: exportTargetId || "",
          disabled: loading === true || exportable.length === 0,
          onChange: (e) => onExportTargetChange(e.target.value),
          "aria-label": weT("导出哪一份"),
        },
          exportable.length === 0
            ? React.createElement("option", { key: "__none", value: "" }, weT("没有可导出的预设"))
            : exportable.map((r) => React.createElement("option", { key: r.id, value: r.id }, labelOf(r))),
        ),
      ),
      assetRows,
      React.createElement("div", { className: "we-picker__ctl", key: "gp-export-commit" },
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          // 没有目标就没有可下载的正文（目标清空 ⇒ 禁用，而不是发起一次必然 404 的导航）。
          disabled: loading === true || !exportTargetId,
          title: weT("按上面勾选的资产，把这份预设下载成 .json（可分享 / 可再导入）"),
          onClick: () => onExportCommit(),
        }, weT("下载 .json")),
        React.createElement("button", {
          className: "we-picker__btn", type: "button", onClick: () => onCancelSave(),
        }, weT("取消")),
      ),
    )
    : null;
  // ── 保存对话框（非模态）：名字行 + 资产勾选 + 「保存预设」────────────────────
  // Enter 在名字框里 = 「下一步」（进入资产勾选那一段）。取消把两段一起收起。
  const saveRow = saving && saveTarget === "save"
    ? React.createElement(React.Fragment, { key: "gp-save" },
      React.createElement("div", { className: "we-picker__ctl" },
        React.createElement("input", {
          className: "we-picker__file", type: "text", value: draftName || "",
          placeholder: weT("预设名字，回车进入下一步"),
          onChange: (e) => onDraftName(e.target.value),
          onKeyDown: (e) => { if (e && e.key === "Enter") onSaveCommit(); },
        }),
        React.createElement("button", {
          className: "we-picker__btn", type: "button", disabled: loading === true,
          onClick: () => onSaveCommit(),
        }, weT("下一步")),
        React.createElement("button", {
          className: "we-picker__btn", type: "button", onClick: () => onCancelSave(),
        }, weT("取消")),
      ),
      assetRows,
      React.createElement("div", { className: "we-picker__ctl", key: "gp-save-commit" },
        React.createElement("button", {
          className: "we-picker__btn", type: "button", disabled: loading === true,
          title: weT("以当前整机配置 + 上面勾选的资产，保存为一份新预设"),
          onClick: () => onSaveCommit2(),
        }, weT("保存预设")),
        React.createElement("button", {
          className: "we-picker__btn", type: "button", onClick: () => onCancelSave(),
        }, weT("取消")),
      ),
    )
    : null;
  return React.createElement(React.Fragment, null,
    React.createElement("div", { className: "we-picker__ctl we-picker__ctl--wrap" },
      ctlText(weT("预设方案"), weT("一键套用整套配置（出厂七套 + 你自己存的，上限 8 个）：观感、行为与勾选的字体 / 立绘 / 头像一起生效，应用后可继续微调")),
    ),
    loading ? React.createElement("div", { className: "we-picker__hint" }, weT("正在处理…")) : null,
    // ⚠️ reason 必须再过一次 weT：它可能来自宿主回包（lib/routes/presets.js 的中文 error），
    //    原样塞进去会让英文界面露出中文 —— 与 fontset-editor 的 error 行同款纪律。
    error ? React.createElement("div", { className: "we-picker__hint" }, weT("预设不可用：{reason}", { reason: weT(error) })) : null,
    note ? React.createElement("div", { className: "we-picker__hint" }, weT(note)) : null,
    rows.length === 0 && !loading
      ? React.createElement("div", { className: "we-picker__hint" }, weT("还没有任何预设 —— 出厂那几套加载失败或宿主未重挂。"))
      : null,
    chipRow,
    confirmRow,
    openSaveRow,
    saveRow,
    exportRow,
  );
}

/**
 * 面板侧读「玻璃颜色」那一对（#159②）。
 *
 * 为什么本文件**自带**一份归一而不复用 effects.js 的 `glassColorOf` / client.js 的助手：
 * `test/verify-scene-live.mjs` 把本文件当**真模块 `import`**（与 `panel-tabs.js` 各在自己的模块
 * 作用域里，只有全局那几个替身可用）⇒ 引用工厂作用域里的兄弟名字就是渲染期 ReferenceError。
 * 这里只用局部逻辑 ⇒ 不依赖任何外部绑定，也不依赖 `document`。
 *
 * 形态：内部永远是一对 `{light, dark}`；标量（老预设定档直传）两侧同值；缺一侧用另一侧补；
 * 两侧都没有就回空串 —— 空串只让色板行没有选中项，**不猜颜色**（猜错的代价是面板显示与实际不符）。
 */
function panelGlassPair(sel) {
  const clean = (v) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim() : "");
  const raw = sel && sel.glassColor;
  if (typeof raw === "string") { const v = clean(raw); return { light: v, dark: v }; }
  if (!raw || typeof raw !== "object") return { light: "", dark: "" };
  const light = clean(raw.light) || clean(raw.dark);
  const dark = clean(raw.dark) || light;
  return { light, dark };
}

function renderAppearanceGlassSection(ctx) {
  const {
    onBlur, onGlassAlpha, onGlassChildParam, onGlassColor, onGlassDarkSeparate, onGlassFidelity,
    onToggleChildIndependent, childIndependentOn, sel, surface,
    onCapsuleBlur, onCapsuleColor,
    onLeftSidebarGlass, onTitlebarGlass, onSidebarAlpha, onSidebarBlur, onSidebarColor,
    onSidebarContentAlpha, onSidebarContentColor, onSidebarGlass,
    onSidebarFollowGlobal, onSidebarFullClear,
    onThinkingMode, glassDetailOpen, onToggleGlassDetail,
  } = ctx;
  // ── 简化配置 vs 高级配置（ADR-0008 **D4**，2026-10-09 用户口径修订）────────────
  //   · **简化配置**（侧栏档 + 设置页都画）：全局四件套（玻璃颜色 / 玻璃透明度 / 雾化 /
  //     玻璃保真度）、"要不要这一面吃玻璃"的**总开关**（思考块液态玻璃 / 侧栏液态玻璃 /
  //     侧栏全透明 / 侧栏玻璃跟随全局 / 左侧栏液态玻璃）；
  //   · **高级配置**（**只在侧栏档画，且默认收起** —— 节尾「详细玻璃调节」开关门控）：
  //     每个面的「独立配置」层**及其子项参数**，以及挂在总开关下面的**细调行**
  //     （思考块门下的胶囊雾化 / 胶囊颜色）。动因：设置页对话框挡住主页面、调完看不到
  //     实时效果 ⇒ 迁侧栏；调节项太多 ⇒ 默认收起（开合住 localStorage，见 quick-panel）。
  //   · **预设方案仍只在设置页画**（`!sidebarSurface` 门不动）：整快照覆盖无撤销，属高阶
  //     动作，不进随手可点的窄面板 —— 这一条**没有**随本次迁移改变。
  //   判定一律走 `ctx.surface`（quick-panel 传 "sidebar"）+ 折叠态 `glassDetailOpen`。
  //   ⚠️ 分档口径以 **ADR-0008 D4** 为准，上面这张表就是它的实现。
  //   ⚠️ 与 D4 配套的 quick-panel 占位器现在只剩「预设方案」与播放页专属字段
  //   （高级行处理器已随迁移**移出**占位器名单、改为真值接线）。判据见 verify-scene-live
  //   的「侧栏 ctx 覆盖」与两档标签序列。
  const sidebarSurface = surface === "sidebar";
  const children = ((typeof GLASS_CHILDREN !== "undefined" && GLASS_CHILDREN) || [])
    // ⚠️ 排除 `panelOff` 的子项：乙类（左侧栏）**不进这一层** ——
    //    它已有自己的总开关「左侧栏液态玻璃」，而它的"独立配置"耦合在那一项下面
    //    （见本文件「细节」节）。它留在登记表里只为生成 schema 键。
    .filter((c) => !c.panelOff);
  // i18n 词表：**就地包 weT(...)** —— 不能用 `weT(cn.label)` 那种属性访问。
  // i18n 判据是**文本扫描**：它只认出现在 `weT(` 实参里的中文；属性访问看不见 ⇒
  // 词条会全成孤儿、文本也进不了"裸中文"检查。所以词表每一项都直接过 weT。
  // （放在渲染函数内而非模块级：weT 依赖当前语言，必须每次渲染重取。）
  // 两侧靠 `id` 对齐；下面有兜底把"漏了哪个 id"当场画出来（比静默无标签好）。
  // ⚠️ 词表只有 `hint`（子面的**身份**，挂在「独立配置」那一行上）与各参数文案 —— 子面的
  //    `label`（开关标签）随"要不要玻璃"那一层一起不存在（对应的 i18n 词条同批清掉）。
  const CHILD_CN = {
    settingsWindow: {
      hint: weT("整个设置窗口（含全部原生分区）"),
      indep: weT("设置窗口玻璃·独立配置"), color: weT("设置窗口玻璃·玻璃颜色"),
      alpha: weT("设置窗口玻璃·玻璃透明度"), blur: weT("设置窗口玻璃·雾化"),
      fidelity: weT("设置窗口玻璃·玻璃保真度"),
    },
    conversation: {
      hint: weT("输入卡片 / 消息气泡 / 工具弹卡"),
      indep: weT("对话框玻璃·独立配置"), color: weT("对话框玻璃·玻璃颜色"),
      alpha: weT("对话框玻璃·玻璃透明度"), blur: weT("对话框玻璃·雾化"),
      fidelity: weT("对话框玻璃·玻璃保真度"),
    },
    leftSidebar: {
      hint: weT("宿主原生左栏（会话列表 / 工作区那一列）"),
      indep: weT("左侧栏玻璃·独立配置"), color: weT("左侧栏玻璃·玻璃颜色"),
      alpha: weT("左侧栏玻璃·玻璃透明度"), blur: weT("左侧栏玻璃·雾化"),
      fidelity: weT("左侧栏玻璃·玻璃保真度"),
    },
    floaters: {
      hint: weT("插件自己的更新提示 / 壁纸仓库抽屉"),
      indep: weT("浮层玻璃·独立配置"), color: weT("浮层玻璃·玻璃颜色"),
      alpha: weT("浮层玻璃·玻璃透明度"), blur: weT("浮层玻璃·雾化"),
      fidelity: weT("浮层玻璃·玻璃保真度"),
    },
    // ⚠️ 这一面只登记了 `transparency` / `blur` 两个参数（无 color / fidelity：共享面纱
    //    ⇒ 保真度不可达；本面 CSS 也不消费颜色）⇒ 标签只给**真正会渲染**的那几个，
    //    不留"参数不存在却有一份翻译"的死文案（R3a 的同一口径）。
    // ⚠️ 它还挂在 `thinkingGlass` 门下（登记表的 `master`）⇒ 开关关着时这几条文案根本不渲染
    //    （那正是"门关着 ⇒ 本面不生效"的如实反映）。
    thinkingTrigger: {
      hint: weT("对话里「思考过程」那一行的入口条"),
      indep: weT("思考触发条玻璃·独立配置"),
      alpha: weT("思考触发条玻璃·玻璃透明度"), blur: weT("思考触发条玻璃·雾化"),
    },
  };
  // ⚠️ 用户口径：**"要不要玻璃"这一层不存在** —— 所有子面**恒吃玻璃**。实测一个"关"并不能
  //   如愿恢复原生不透明纯色（那些面上还有一批不挂门控的令牌改写，见 glass.js 的退役说明）。
  // ⇒ 这一节只剩一层：每个子面一个「独立配置」开关 —— 它回答的是
  //   "读自己那套参数 还是 跟全局"。
  const childRows = [];
  // ── 高级配置（D4，2026-10-09）：只在**侧栏档且「详细玻璃调节」展开时**构建/渲染。
  //    设置页档不再画这些行（真迁移）；侧栏收起时连构建都不做（省一遍无用遍历）。
  //    处理器在侧栏 ctx 里是**真值接线**（已从 setting-only 占位器名单移出）。
  const detailOpen = sidebarSurface && glassDetailOpen === true;
  for (const c of detailOpen ? children : []) {
    const cn = CHILD_CN[c.id];
    // 登记表与词表必须一一对应：漏一个就整项无标签（比 ReferenceError 更隐蔽）。
    if (!cn) { childRows.push(React.createElement("div", { className: "we-picker__hint", key: "gc-missing-" + c.id }, weT("内部错误：这个子界面缺少文案"))); continue; }
    // ⚠️ `master`：这一面挂在某个**总开关**门下（登记表里声明，如 `thinkingTrigger` → `thinkingGlass`）。
    //    开关关着时它一行都不画 —— 画了就是"画出来又不生效的旋钮"：那种状态下它的 CSS 整组不匹配
    //    （令牌不被接管、模糊不挂），滑杆拖了没有任何变化（同一条纪律见本函数上方关于胶囊雾化的注释）。
    if (c.master && sel[c.master] !== true) continue;
    // 每个子面**直接**一个「独立配置」开关（子面的名字进 `hint`，见词表的 cn.hint）。
    const indep = !!(childIndependentOn && childIndependentOn(c.id));
    childRows.push(switchRow(cn.indep, indep, (e) => onToggleChildIndependent(c.id, e.target.checked), {
      key: "gi-" + c.id,
      hint: cn.hint,
      tooltip: weT("打开后**紧接在本行下方**出现这一项自己的独立配置，**完全覆盖**上面的全局配置；关闭则回到继承全局"),
    }));
    // 独立配置关着 ⇒ 不显示它自己的参数行（默认就是关 ⇒ 默认跟随全局）
    if (!indep) continue;
    const P = (param) => childGlassKey(c.id, param);
    // ⚠️ 按登记表的 `params` 渲染，**不硬编码四项** —— 不是每个子项都拿得到全部参数。
    //    `fidelity` 只有 `conversation` 有：它的面纱有专属的 `--we-chat-readability-*`，
    //    而共享面纱的面受 F2a / F1c 约束、**逐面保真度不可达**（见 wip §4.14）。
    //    硬编码会让那两个面多出一个"点了没反应"的旋钮 —— 正是要消灭的那类死开关。
    if (c.params.blur !== undefined) {
      childRows.push(SliderRow(cn.blur, 0, 60, 1,
        sel[P("blur")], (v) => onGlassChildParam(c.id, "blur", v),
        sel[P("blur")] + "px", "gc-blur-" + c.id));
    }
    if (c.params.transparency !== undefined) {
      childRows.push(SliderRow(cn.alpha, 0, 100, 5,
        sel[P("transparency")], (v) => onGlassChildParam(c.id, "transparency", v),
        sel[P("transparency")] + "%", "gc-alpha-" + c.id));
    }
    if (c.params.fidelity !== undefined) {
      childRows.push(SliderRow(cn.fidelity, 0, 100, 5,
        sel[P("fidelity")], (v) => onGlassChildParam(c.id, "fidelity", v),
        sel[P("fidelity")] + "%", "gc-fid-" + c.id));
    }
    if (c.params.color !== undefined) {
      childRows.push(swatchRow(cn.color, GLASS_COLOR_PRESETS,
        sel[P("color")], (v) => onGlassChildParam(c.id, "color", v), { key: "gc-color-" + c.id }));
    }
  }
  // 「思考块液态玻璃」三挡的当前值与按钮工厂（必须在 return 之前声明 —— 它们是语句，
  // 进不了下面的 createElement 实参表）。
  const thinkMode = sel.thinkingNative === true ? "native" : (sel.thinkingGlass === true ? "glass" : "off");
  // #159②：玻璃色那一对（内部永远是一对；标量/残缺由本文件的 panelGlassPair 归一 ——
  // 这里**不能**调 client.js / effects.js 的兄弟函数，见 panelGlassPair 的注释）。
  const glassPair = panelGlassPair(sel);
  const thinkGear = (id, label, tip) => React.createElement("button", {
    key: "think-" + id,
    className: "we-picker__btn we-picker__rate" + (thinkMode === id ? " we-picker__rate--active" : ""),
    type: "button",
    title: tip,
    onClick: () => onThinkingMode(id),
    "aria-pressed": thinkMode === id ? "true" : "false",
  }, label);
  // ── 高级配置行（D4，2026-10-09 起 = 侧栏「详细玻璃调节」折叠块的内容）────────────
  //   胶囊细调 + 各面「独立配置」层及其子项参数 + 子 UI 独立配置 —— 只在侧栏档
  //   **且展开时**构建（`detailOpen`）；设置页档不再画这些行（真迁移 ⇒ 恒空）。
  //   每行的**内在门**（思考玻璃挡 / 各面总开关 / 宿主能力位 / 跟随全局）原样保留 ——
  //   折叠只是把它们整体挪到节尾一处，不改变任何一行的生效条件。
  const advRows = [];
  if (detailOpen) {
    // 胶囊雾化（capsuleBlur，默认 8px）：**只在思考玻璃开着时渲染** —— 消费它的规则
    // 全部挂在 data-we-thinking-glass 门下，门关着时这个滑杆就是"画出来又不生效的旋钮"
    //（本仓要防的那类死旋钮，见 glass-panel 文件头 wip §10.12）。
    if (sel.thinkingGlass === true && sel.thinkingNative !== true) {
      advRows.push(SliderRow(weT("胶囊雾化"), 0, 60, 1,
        sel.capsuleBlur, onCapsuleBlur, sel.capsuleBlur + "px", "capsule-blur", {
        tooltip: weT("正文里行内代码胶囊、新会话按钮、导航按钮的模糊半径 —— 越大越像磨砂玻璃。只在这些胶囊吃玻璃（思考块液态玻璃开着）时生效；0 = 关掉雾化。"),
      }));
      // 胶囊釉色（capsuleColor，默认白 = 原观感）：与胶囊雾化同族同门。色板行不做
      // 可读性钳制（10% 雾底不是正文面，理由见 schema 注释）。
      advRows.push(swatchRow(weT("胶囊颜色"), GLASS_COLOR_PRESETS,
        sel.capsuleColor, onCapsuleColor, {
        key: "capsule-color",
        tooltip: weT("行内代码胶囊、新会话按钮、导航按钮与聊天滚动条拇指的雾底色相 —— 默认白（原观感）。只在这些胶囊吃玻璃（思考块液态玻璃开着）时生效；浓度档不变（10%）。"),
      }));
    }
    // ── 左侧栏玻璃·独立配置（与「左侧栏液态玻璃」耦合：总开关关着时不显示）──
    if (sel.leftSidebarGlass === true) {
      advRows.push(switchRow(weT("左侧栏玻璃·独立配置"),
        !!(childIndependentOn && childIndependentOn("leftSidebar")),
        (e) => onToggleChildIndependent("leftSidebar", e.target.checked), {
        key: "left-sidebar-independent",
        hint: weT("用这一项自己的釉层参数覆盖全局"),
        tooltip: weT("打开后**紧接在本行下方**出现左侧栏自己的两项（玻璃透明度 / 雾化），**完全覆盖**「玻璃 UI」里的全局配置；关闭则回到继承全局。"),
      }));
      // 独立配置开着才出现它自己的两项（默认关 ⇒ 默认跟随全局）。
      // ⚠️ 只画**真正接线**的那两个 —— 本面 CSS 只读 `--we-left-sidebar-blur/-alpha`，
      //    不消费颜色与保真度 ⇒ 画了就是死旋钮（R3a）。
      if (childIndependentOn && childIndependentOn("leftSidebar")) {
        advRows.push(SliderRow(weT("左侧栏玻璃·玻璃透明度"), 0, 100, 5,
          sel.leftSidebarTransparency, (v) => onGlassChildParam("leftSidebar", "transparency", v),
          sel.leftSidebarTransparency + "%", "ls-alpha"));
        advRows.push(SliderRow(weT("左侧栏玻璃·雾化"), 0, 60, 1,
          sel.leftSidebarBlur, (v) => onGlassChildParam("leftSidebar", "blur", v),
          sel.leftSidebarBlur + "px", "ls-blur"));
      }
    }
    // ── 标题栏玻璃·独立配置（与「标题栏液态玻璃」耦合，同左栏）──
    if (sel.titlebarGlass === true) {
      advRows.push(switchRow(weT("标题栏玻璃·独立配置"),
        !!(childIndependentOn && childIndependentOn("titlebar")),
        (e) => onToggleChildIndependent("titlebar", e.target.checked), {
        key: "titlebar-independent",
        hint: weT("用这一项自己的釉层参数覆盖全局"),
        tooltip: weT("打开后**紧接在本行下方**出现标题栏自己的两项（玻璃透明度 / 雾化），**完全覆盖**「玻璃 UI」里的全局配置；关闭则回到继承全局（与左侧栏同一数值 ⇒ 同一观感）。"),
      }));
      // ⚠️ 与左栏同：只画**真正接线**的那两个 —— 本面 CSS 只读 --we-titlebar-blur/-alpha，
      //    不消费颜色与保真度 ⇒ 画了就是死旋钮（R3a）。
      if (childIndependentOn && childIndependentOn("titlebar")) {
        advRows.push(SliderRow(weT("标题栏玻璃·玻璃透明度"), 0, 100, 5,
          sel.titlebarTransparency, (v) => onGlassChildParam("titlebar", "transparency", v),
          sel.titlebarTransparency + "%", "tb-alpha"));
        advRows.push(SliderRow(weT("标题栏玻璃·雾化"), 0, 60, 1,
          sel.titlebarBlur, (v) => onGlassChildParam("titlebar", "blur", v),
          sel.titlebarBlur + "px", "tb-blur"));
      }
    }
    // ── 侧栏族（dsh-better-sidebar）的「独立配置」层：`glassMode` 的唯一写入方是
    //    `onToggleChildIndependent`，而 `sidebar` / `sidebarContent` 不在登记表里 ⇒
    //    没有这两个开关时它们的 mode 永远停在 `'inherit'` ⇒ 下面那 5 个滑块**全是死的**。
    //    判据见第 ⑧ 组的 mode 可达性。能力位门（sidebarPresent / sidebarGlass）原样保留。
    if (sel.sidebarPresent && sel.sidebarGlass) {
      // 跟随全局开着 ⇒ 侧栏族的独立配置收起（画出来又不生效的旋钮是要防的）。
      if (!sel.sidebarFollowGlobal) {
        advRows.push(switchRow(weT("侧栏玻璃·独立配置"),
          !!(childIndependentOn && childIndependentOn("sidebar")),
          (e) => onToggleChildIndependent("sidebar", e.target.checked), {
            key: "sb-independent",
            hint: weT("用这一项自己的釉层参数覆盖全局"),
            tooltip: weT("打开后**紧接在本行下方**出现这一项自己的独立配置，**完全覆盖**上面的全局配置；关闭则回到继承全局"),
          }));
        if (childIndependentOn && childIndependentOn("sidebar")) {
          advRows.push(SliderRow(weT("侧栏模糊"), 0, 60, 1, sel.sidebarBlur, onSidebarBlur, sel.sidebarBlur + "px", "sb-blur"));
          advRows.push(SliderRow(weT("侧栏透明度"), 0, 100, 1, sel.sidebarAlpha, onSidebarAlpha, sel.sidebarAlpha + "%", "sb-alpha"));
          advRows.push(swatchRow(weT("侧栏玻璃颜色"), GLASS_COLOR_PRESETS, sel.sidebarColor, onSidebarColor, { key: "sb-color" }));
        }
      }
      // 内容面（编辑器 / 终端，即 dsh-better-sidebar 面板内的内容区）近不透明玻璃底。
      // 它与跟随全局无关 ⇒ 不受上面那道门影响。
      advRows.push(switchRow(weT("内容面玻璃·独立配置"),
        !!(childIndependentOn && childIndependentOn("sidebarContent")),
        (e) => onToggleChildIndependent("sidebarContent", e.target.checked), {
          key: "content-independent",
          hint: weT("用这一项自己的釉层参数覆盖全局"),
          tooltip: weT("打开后**紧接在本行下方**出现这一项自己的独立配置，**完全覆盖**上面的全局配置；关闭则回到继承全局"),
        }));
      if (childIndependentOn && childIndependentOn("sidebarContent")) {
        advRows.push(SliderRow(weT("内容面透明度"), 0, 100, 5, sel.sidebarContentAlpha, onSidebarContentAlpha, sel.sidebarContentAlpha + "%", "content-alpha"));
        advRows.push(swatchRow(weT("内容面底色"), GLASS_COLOR_PRESETS, sel.sidebarContentColor, onSidebarContentColor, {
          key: "content-color",
          auto: React.createElement("button", {
            key: "auto",
            className: "we-picker__swatch we-picker__swatch--auto" + (sel.sidebarContentColor === "" ? " we-picker__swatch--active" : ""),
            type: "button",
            title: weT("跟随主题面板色"),
            onClick: () => onSidebarContentColor(""),
            "aria-label": weT("内容面底色 跟随主题"),
          }, weT("主题")),
          colorValue: sel.sidebarContentColor || "#1e1f26",
        }));
      }
    }
    // ── 子 UI 独立配置：这一节只有**一层** —— 每个子面一个「独立配置」开关（开 = 用
    //    自己那套参数覆盖全局）。⚠️ 这里**没有**「要不要玻璃」的开关：所有子面恒吃玻璃。
    advRows.push(...childRows);
  }
  return React.createElement(React.Fragment, null,
  React.createElement("div", { className: "we-picker__section" },
    React.createElement("div", { className: "we-picker__section-head" },
      React.createElement("span", { className: "we-picker__section-label" }, weT("玻璃 UI")),
    ),
    // ── 预设方案（本节第一行，先于一切旋钮；**高级配置：只在设置页画**，ADR-0008 D4）──
    // ctx 成员由 client.js 的 glassPresetCtx 提供（清单/错误是宿主投影；应用走 settings 通道）。
    // ⚠️ 这道门是**显式**的，三处对齐：① 门在这里；② `glassPresets` 已进 quick-panel 的
    //    setting-only 占位器（误补 ⇒ 当场炸）；③ verify-scene-live 两档都钉住预设块
    //    （标签序列 + 整树文本锚：侧栏档不许有、设置档必须有）。
    //    分类理由：它不是"总开关"也不是"逐面覆盖"，而是**跨面批量覆盖**（一份预设 = 玻璃子系统
    //    完整快照，应用即 Object.assign 整套覆盖、**无确认无撤销**），且出厂预设**删除即永久** ——
    //    这类动作按 D4 的取向属高阶；侧栏是窄面板 + 随手调的场合。
    !sidebarSurface && renderGlassPresetsBlock(ctx.glassPresets),
    // ── 全局四件套 ──
    // 玻璃颜色: the settings-window glass BASE tint. Defaults keep the stock
    // look (white light / deep navy dark); picking any preset or a custom
    // color tints the whole window glass in BOTH themes.
    // #159② 分主题：色板行的"一个颜色"是**浅色那一侧**；开了「深色单独设置」再多一行专写深色。
    // `sel.glassDarkSeparate` 只是面板开关，不改渲染 —— 取色在 effects.js / glass.js 按主题各取一半。
    // 侧栏档（窄面板 + 随手调）**不给这个开关**（D4 同向：独立/分套属配置层）；它只有一个色板，
    // 只写**浅色那一侧** —— 侧栏的玻璃色变量就只消费浅色半（`src/glass.js` / `src/effects.js`
    // 的 sidebar 分支都取 `glassColorOf(sel,"light")`：侧栏没有 `data-ds-dark-theme` 孪生，
    // 有意不分深浅）。**不要**改回"写当前配色那一侧"：深色主题下那等于让用户改一个他看不到的
    // 值（§11 A2-F2）；面板也不许自己采样主题（`panelThemeIsDark` 已随之删除）。
    !sidebarSurface && switchRow(weT("深色单独设置"), sel.glassDarkSeparate === true, (e) => onGlassDarkSeparate(e.target.checked), {
      key: "glass-dark-separate",
      tooltip: weT("关闭时一个颜色同时用于浅色与深色两套（内部仍存两套值）；开启后浅色/深色分别设置"),
    }),
    swatchRow(weT("玻璃颜色"), GLASS_COLOR_PRESETS,
      glassPair.light,
      (hex, live) => onGlassColor("light", hex, live), { key: "glass-color" }),
    !sidebarSurface && sel.glassDarkSeparate === true && swatchRow(weT("玻璃颜色 · 深色"), GLASS_COLOR_PRESETS, glassPair.dark,
      (hex, live) => onGlassColor("dark", hex, live), { key: "glass-color-dark" }),
    SliderRow(weT("玻璃透明度"), 0, 100, 5, sel.glassAlpha, onGlassAlpha, sel.glassAlpha + "%"),
    // 「雾化」控制的只有**模糊半径**（雾面深度），饱和度是解耦的常量材料属性（见 GLASS_SATURATE）。
    // ⚠️ 覆盖面的实测口径（`.test-cache/blur-selectors.mjs` 复算，按规则头归面）：
    //    它喂的 `--we-blur` 被这些面消费 —— 对话栏一族（输入卡片 / 气泡 / 工具弹卡）、
    //    **左侧栏液态玻璃**（`data-we-left-sidebar` 那列的 `::before`）、**设置窗口**、
    //    插件自身浮层（更新提示 / 仓库面板）。
    //    而**侧栏**（dsh-better-sidebar 与右栏面板）走的是它**自己的** `--we-sidebar-blur`
    //    （由「侧栏模糊」管）—— 那才是唯一不吃本项的面。
    SliderRow(weT("雾化"), 0, 60, 1, sel.blur, onBlur, sel.blur + "px", "glass-frost", {
      tooltip: weT("玻璃面板（对话栏卡片、左侧栏、设置窗口、插件浮层）的模糊半径 —— 越大越像磨砂玻璃；色彩饱和度不随本滑块变化。侧栏有自己的「侧栏模糊」，不受本项影响"),
    }),
    // 玻璃保真度（默认 100 = 完整可读性红线）：唯一的「颜色 vs 可读」权衡旋钮。
    // 100 = 玻璃色经亮度钳制保正文 ≥4.5:1（深色压暗 / 浅色提亮的现状）；拉低 =
    // 釉色向用户原色线性回退（单调，中间档不会更黑/更白）+ 地板层覆盖度同比例
    // 减薄，正文在极端壁纸上可读性让位；0 = 原色直出不钳制。数学入口
    // weClampSurfaceColor 第三参 + --we-glass-fidelity。
    SliderRow(weT("玻璃保真度"), 0, 100, 5, sel.glassFidelity, onGlassFidelity, sel.glassFidelity + "%", "glass-fidelity", {
      tooltip: weT("100 = 完整可读性红线（默认）：自定义玻璃色经亮度钳制，正文对比度始终 ≥4.5:1 —— 深色主题下颜色被压暗、浅色主题下被提亮。拉低后颜色更贴你选的原色，但正文在极端明暗的壁纸上可能看不清；看不清字时把本项拉回 100，或按「看不清字三步」调节。"),
    }),
    // ⚠️ 「对话栏的保真度」**只有**「对话框玻璃·独立配置」下的「对话框玻璃·玻璃保真度」一个入口
    //    （两个旋钮控同一件事是要防的）；存储键复用 `chatGlassFidelity`（D2：不新建平行键），
    //    老配置值不丢。
    // 思考块液态玻璃 —— **三挡**（用户口径）：关（对话区半透明透壁纸）/ 液态玻璃（磨砂）/
    // 原生（**只有正文内容** —— 气泡 / 代码块 / 思考区 —— 恢复 DSH 原生不透明实色；输入框与画布
    // 保留玻璃）。存储是两个布尔（thinkingGlass + thinkingNative），**原生挡赢**的互斥在 effects.js
    // 门控层保证，本分段只负责把两键写一致。总开关级 ⇒ 两侧都画（D4）。
    // ⚠️ 原生挡下胶囊两行（门 = thinkingGlass）整组不画 —— 那族 CSS 挂在
    //    data-we-thinking-glass 门下，原生挡不挂门 ⇒ 画了就是死旋钮。
    React.createElement("div", { className: "we-picker__ctl we-picker__ctl--wrap", key: "thinking-mode" },
      ctlText(weT("思考块液态玻璃"), weT("对话内容的三挡：关（半透明）/ 液态玻璃 / 原生（正文实色、输入框保持玻璃）")),
      React.createElement("div", { className: "we-picker__seg" },
        thinkGear("off", weT("关"), weT("对话区保持半透明：壁纸透过面板与代码块显出来（无磨砂）")),
        thinkGear("glass", weT("液态玻璃"), weT("思考区与文件卡清底，文字胶囊与七类工具内容玻璃；代码块随玻璃透明度透出壁纸")),
        thinkGear("native", weT("原生"), weT("消息正文（气泡、代码块、思考区）恢复 DSH 原生不透明实色；输入框与对话画布保留玻璃透壁纸；胶囊与思考条的玻璃细调在本挡停用")),
      ),
    ),
    // ── 既有面的**显示开关**与它们的独立配置 ──
    // ⚠️ 门槛分两层：宿主能力位（`sidebarPresent` / `sidebarGlass`：装没装 dsh-better-sidebar、
    //    总开关开没开）**与**档位门 —— **总开关**两档都画；挂在它们下面的**独立配置层**
    //    属高级配置：只在侧栏档「详细玻璃调节」展开时画（见函数头的 D4 表；设置页不再画）。
    // 左侧栏液态玻璃（默认关）：宿主原生左栏在壁纸下只是「透明的洞」，打开后它走同一张配方表。
    // ⚠️ 它**不是**"要不要玻璃"那一类：它的「关」是**恢复背景**（那一列回到壁纸原样）——
    //    所以它是唯一保留的**显示开关**（乙类），与其余面"恒吃玻璃"不同。
    switchRow(weT("左侧栏液态玻璃"), sel.leftSidebarGlass === true, onLeftSidebarGlass, {
      key: "left-sidebar-glass",
      hint: weT("左侧栏也跟随玻璃配方（配色 / 玻璃颜色 / 透明度 / 雾化 / 边框）"),
      tooltip: weT("宿主原生左侧栏（会话列表 / 工作区那一列）默认直接透出壁纸、不吃玻璃参数。打开后它变成与其余界面同款的玻璃面板，跟随「配色 / 玻璃颜色 / 玻璃透明度 / 雾化 / 边框」；关闭即恢复原生观感。默认关。"),
    }),
    // 标题栏液态玻璃（默认关）：壳层顶栏（拖拽区 / 窗口按钮那一行）是本插件唯一**刻意**
    // 留成不透明的面（画布被清成透明后，这一层必须保留底色否则标题文字压在壁纸上）。
    // 打开后它改吃**与其余面板同一张配方表**，且与左侧栏那条**逐条同形** —— 同一组釉层
    // 变量、同一条可读性下限、同一条玻璃色 ⇒ 两侧栏在同一数值下同观感，不出现色差。
    // ⚠️ 与左侧栏同为**乙类**（关 = 恢复宿主那条不透明底），所以同为**总开关级**（两档都画）；
    //    它的「独立配置」层属高级配置，在节尾折叠块里（D4 表见函数头）。
    switchRow(weT("标题栏液态玻璃"), sel.titlebarGlass === true, onTitlebarGlass, {
      key: "titlebar-glass",
      hint: weT("标题栏也跟随玻璃配方（配色 / 玻璃颜色 / 透明度 / 雾化 / 边框）"),
      tooltip: weT("桌面壳顶栏（拖拽区 / 窗口按钮那一行）默认保持不透明底色。打开后它变成与其余界面、**以及左侧栏完全同款**的玻璃面板，跟随「配色 / 玻璃颜色 / 玻璃透明度 / 雾化 / 边框」——两侧栏同一数值下观感一致，不会出现色差；关闭即恢复原生观感。默认关。"),
    }),
    // 侧栏玻璃（dsh-better-sidebar 适配）：总开关 + 专用模糊 / 透明度 / 玻璃基底色调，
    // 只作用于 dsh-better-sidebar 子树，不动会话玻璃的设置。仅在宿主检测到该插件时显示。
    sel.sidebarPresent && switchRow(weT("侧栏液态玻璃"), sel.sidebarGlass, onSidebarGlass, {
      key: "sidebar-glass-toggle",
      hint: weT("dsh-better-sidebar 侧栏毛玻璃适配"),
      tooltip: weT("dsh-better-sidebar 侧栏（文件 / 终端 / Git 等面板）的毛玻璃适配；关闭则恢复其原生外观"),
    }),
    // 侧栏全透明（issue #137）：放弃可读性下限换全透的显式开关。刻意**不跟在
    // 侧栏液态玻璃的门后面** —— 玻璃关着时右栏那条原生不透明兜底同样是"透不出来"
    // 的一极，本开关在两个状态都要可达（issue 里用户正是在玻璃关着的档位打的补丁）。
    sel.sidebarPresent && switchRow(weT("侧栏全透明"), sel.sidebarFullClear === true, onSidebarFullClear, {
      key: "sidebar-fullclear",
      hint: weT("壁纸下撤掉侧栏的可读性底与色染"),
      tooltip: weT("打开：壁纸激活时侧栏的可读性下限、色染与釉光整块撤掉，壁纸原样透出（文字直接压在壁纸上）；模糊仍由侧栏模糊/全局雾化旋钮管。关闭（默认）：保留可读性下限，最坏壁纸下正文仍 ≥4.5:1"),
    }),
    // 跟随全局（sidebarFollowGlobal，默认开，现场口径："我需要侧栏玻璃也跟随全局"）：
    // 开着 ⇒ 侧栏的釉变量直接指向全局三件套（effects 里写 var() 引用），并把下面
    // 侧栏那一族的「独立配置」收起 —— 画出来又不生效的旋钮是要防的。
    // 内容面（可读性旋钮）与跟随无关 ⇒ 不受此门影响，照旧在场。
    sel.sidebarPresent && sel.sidebarGlass && switchRow(weT("侧栏玻璃跟随全局"), sel.sidebarFollowGlobal === true, onSidebarFollowGlobal, {
      key: "sidebar-follow-global",
      hint: weT("模糊 / 透明度 / 底色都跟随全局玻璃"),
      tooltip: weT("打开：侧栏玻璃跟随「玻璃 / 玻璃透明度 / 玻璃颜色」（与原生左栏同一条配方，两侧栏一致）；关闭：用下面三个旋钮单独调侧栏"),
    }),
    // ── 「详细玻璃调节」折叠开关（**仅侧栏档**；默认收起）──────────────────────────
    //    开关后面的 `advRows` = 全部高级行（胶囊细调 / 各面独立配置及参数 / 子 UI 独立配置），
    //    见函数头构建处。设置页档不画开关也不画这些行（真迁移，D4 2026-10-09）。
    //    开合状态住 localStorage（quick-panel 的 qp-glass-detail），渲染器只经 ctx 读它。
    sidebarSurface && switchRow(weT("详细玻璃调节"), glassDetailOpen === true,
      (e) => onToggleGlassDetail && onToggleGlassDetail(e.target.checked), {
        key: "glass-detail-toggle",
        hint: weT("各面独立配置、胶囊细调等进阶旋钮（默认收起）"),
        tooltip: weT("展开后出现每个面自己的「独立配置」与细调行（胶囊雾化 / 胶囊颜色、侧栏族参数等）——调完立刻能看到实时效果；收起只留本节的简化配置"),
      }),
    ...advRows,
  ),
  );
}

export { renderAppearanceGlassSection };
