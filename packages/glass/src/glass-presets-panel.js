/**
 * glass-presets-panel.js — 「主题预设」独立节的渲染器（2026-11-07 从 glass-panel.js 纯搬移折出）。
 *
 * 为什么单独一层：预设块的形态纪律（出厂名字走词表、破坏性动作两步确认、坏预设「禁用但可删」、
 * 资产勾选对话框）与「玻璃 UI」节的四件套旋钮是**两类东西** —— 前者是整机快照的读写入口，
 * 后者是玻璃参数。玻璃子包按 inline 模块拼接进同一个 bundle 作用域（无 import），因此这里只放
 * 函数与模块级 ref，跨文件引用靠打包期同作用域；独立 import 的场景由测试按真入口同形挂全局
 * （verify-scene-live / verify-fontset 的 prelude）。零行为改动。
 */

/**
 * 「主题预设」节 + 「玻璃 UI」节 —— 预设升为整机快照（ADR-0011）后自成一节，玻璃节只留玻璃。
 *
 * 结构：
 *   主题预设（独立节，仅设置页）
 *   └─ 预设方案：卡片网格 + 保存 / 导出 / 导入
 *   玻璃 UI
 *   ├─ 全局：玻璃颜色 · 玻璃透明度 · 雾化 · 玻璃保真度
 *   └─ 子 UI 独立配置（不进简化配置）
 *      └─ 每个子面一个开关：[独立配置] ⇒ 打开后展开它自己的参数行
 *
 * ⚠️ **没有"要不要玻璃"的开关**（用户口径）：玻璃是恒要的 —— 实测一个"关"并**不能**如愿恢复
 *    原生黑/白纯色（那些面上还有一批不挂门控的令牌改写，见本包 `glass.js` 的退役说明）⇒ 这一节
 *    剩下的**唯一**问题就是"读自己 还是 跟全局"。
 * ⚠️ 「左侧栏液态玻璃」**不在**本节的子项里：它的"关"是**恢复背景**（那列回到壁纸原样），
 *    语义不同 —— 它是乙类，独立成项留在「细节」，本节的 `panelOff` 过滤就是为它。
 */
/**
 * 「预设方案」块（「主题预设」独立节的正文，先于「玻璃 UI」节）。
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
 * whale/phoebe/DeepSeek；不勾头像 ⇒ 回落内置默认头像。数值键（开关/尺寸/圆角）恒在 settings 段，
 * 不受勾选影响。默认值：字体 ✅ / 吉祥物 ✅ / 头像 ❌（D4：头像体积翻倍、与"分享一份
 * 外观配置"关系最弱）。勾选状态是视图态（ctx.assetChecks + onAssetToggle）。
 * **保存与导出都先过这道对话框**（ADR 修订版第③条）：保存 = 名字行 → 勾选 → 「保存预设」；
 * 导出 = 每行「导出」→ 同一组勾选 → 「下载 .json」。勾选的每一项只在**本机确实有那份
 * 资产**时才可勾（宿主按名单内嵌，没有的东西内嵌不出段；行的说明会写明）。
 * 本渲染器**只画**：网络与状态全部经 ctx（store 在 src/preset-store.js，接线在 client.js 的
 * glassPresetCtx）。
 */
/**
 * 导入用的隐藏 file input 的**模块级 ref**（与 packages/fonts/src/fontset-editor.js 同形：模块级变量 +
 * 按钮去 `.click()`；⚠️ 名字不能撞 —— fontset-editor 已占 `importInput`，平铺进 bundle
 * 后是同一作用域，撞名 = SyntaxError，构建期会红）。只做"选文件"，读文件与三道
 * 本地预检在 `importGlassPreset`（src/preset-store.js）。
 */
let gpImportInput = null;

function renderGlassPresetsBlock(gp) {
  const {
    presets, loading, error, note, saving, draftName, armedId,
    saveTarget, exportTargetId, assetChecks, onAssetToggle, onMascotPoint, onExportCommit, onSaveCommit2,
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
    "factory-default": weT("黑客绿(Fish)"), "purple-mood": weT("紫色心情"), "factory-frosted": weT("重磨砂"), "factory-night": weT("暗夜釉色"), "factory-vivid": weT("原色直出"), "factory-readable": weT("可读优先"), "factory-author": weT("作者自用"),
  };
  const labelOf = (row) => (row.origin === "builtin" && FACTORY_PRESET_CN[row.id])
    ? FACTORY_PRESET_CN[row.id]
    : (row.name || row.id);
  const checks = assetChecks || {};
  const has = (k) => checks[k] === true;
  // ── 资产勾选对话框的行（保存与导出共用同一组勾选项与后果说明；非模态、就地展开）──
  // 每行 = 胶囊开关（复用 switchRow）+ 一行**三态后果**（D4）。
  // 口径：**勾上 = 按本机现状声明这一族**（有就带上；没有就**显式声明「无」**），
  // **不勾 = 不动对方的这一族**。所以开关**不再按 available 禁用** —— 旧版禁用导致"本机没有
  // 自定义立绘"的用户永远无法声明「无」，那一族只能靠出厂预设的 null 来清（本次缺陷的客户端半边）。
  // available 只决定提示文案（说清"勾上会存成无"还是"勾上会把这张带过去"）。
  const fontAvailable = checks.fontAvailable === true;
  const mascotAvailable = checks.mascotAvailable === true;
  const avatarAvailable = checks.avatarAvailable === true;
  // 吉祥物族的**指向**（第四态，用户口径）：`""` = 按本机现状（老行为），任一形态
  // id（`ROPE_FORM_VALUES`，10 只）= 这一段只存"指向出厂自带的那一只"（零字节）。
  const mascotPoint = typeof checks.mascotPoint === "string" ? checks.mascotPoint : "";
  const assetRows = React.createElement(React.Fragment, null,
    switchRow(weT("字体"), has("font"), (e) => onAssetToggle("font", e.target.checked), {
      key: "pa-font",
      hint: fontAvailable
        ? weT("勾上：把当前字体带进预设（不勾 = 不动对方的字体，保持它当前那份）")
        : weT("本机字体还是全默认 —— 勾着存 = 声明「无」，套用它的人回到内置字体（不勾 = 不动对方的字体）"),
      tooltip: weT("把当前活动字体集的颜色角色 / 排版 / 字族 / 组件字体一并存进预设"),
    }),
    switchRow(weT("吉祥物立绘"), has("mascot"), (e) => onAssetToggle("mascot", e.target.checked), {
      key: "pa-mascot",
      hint: mascotAvailable
        ? weT("勾上：把自定义立绘带进预设（不勾 = 不动对方的立绘，保持它当前那张）")
        : weT("本机没有自定义立绘 —— 勾着存 = 声明「无」，套用它的人回到内置立绘（Deepseek_Pro / 菲比啾比）；不勾 = 不动对方的立绘"),
      tooltip: weT("把自定义吉祥物立绘的图片与显示盒一并存进预设（默认勾选）"),
    }),
    // ── 吉祥物族的**指向**（ADR-0011 D4 第四态，用户口径）──────────────────
    // 勾上这一族才有意义（不勾 = 不动对方那一族，指向无处可落）。两种选择：
    //   ·「本机现状」= 老行为：有自定义立绘就带上它（内嵌字节），没有就声明「无」；
    //   · 选一只出厂自带 = 正文里只存**指向**（`assets.mascot` 字符串，零字节），套用它的人
    //     换回那一只 —— 这是"自己存的预设也能指定出厂自带"的唯一入口（旧版只能存"我的图"
    //     或"无"两态，想让人换回内置那一只只能用出厂预设）。
    has("mascot") && React.createElement("div", {
      className: "we-picker__ctl we-picker__ctl--wrap", key: "pa-mascot-point",
    },
      ctlText(weT("吉祥物 · 指向"), mascotAvailable
        ? weT("「本机现状」= 把这台的自定义立绘带进预设；选一只出厂自带 = 只存「指向它」（不占体积），套用它的人换回那一只")
        : weT("本机没有自定义立绘 —— 「本机现状」会存成「无」；也可以直接选一只出厂自带，让套用它的人换回那一只")),
      // （并入 #180 后形态 3 → 11，「小女仆」除名后为 10）：最多 1 + 10 = 11 个键。段控件的基样式
      // 是「等分、不换行」，11 个键在 564px 内容宽下会被压成同样的窄格、标签互相截断 ⇒ 走 chips 变体
      // （换行 + 每键取内容宽，见 src/styles/settings.js 里 .we-picker__seg--chips 的注释，#253）。
      React.createElement("div", { className: "we-picker__seg we-picker__seg--chips", role: "group", "aria-label": weT("吉祥物 · 指向") },
        React.createElement("button", {
          key: "own",
          type: "button",
          className: "we-picker__btn we-picker__rate" + (mascotPoint ? "" : " we-picker__rate--active"), "aria-pressed": mascotPoint ? "false" : "true",
          title: weT("按本机现状存这一族：有自定义立绘就连图带显示盒一起存，没有就声明「无」（套用的人回到内置立绘）"),
          onClick: () => onMascotPoint(""),
        }, weT("本机现状")),
        ROPE_FORM_VALUES.map((k) => React.createElement("button", {
          key: k,
          type: "button",
          className: "we-picker__btn we-picker__rate" + (mascotPoint === k ? " we-picker__rate--active" : ""), "aria-pressed": mascotPoint === k ? "true" : "false",
          title: weT("预设里只存「指向出厂自带的「{name}」」（不内嵌图片；套用它的人换回那一只，本机自己的立绘不动）", { name: ROPE_FORMS[k].label }),
          onClick: () => onMascotPoint(k),
        }, ROPE_FORMS[k].label)),
      ),
    ),
    switchRow(weT("会话头像"), has("avatar"), (e) => onAssetToggle("avatar", e.target.checked), {
      key: "pa-avatar",
      hint: avatarAvailable
        ? weT("勾上：把两张自定义头像带进预设（不勾 = 不动对方的头像；头像体积翻倍，默认不勾）")
        : weT("本机没有自定义头像 —— 勾着存 = 声明「无」，套用它的人回到内置默认头像（不勾 = 不动对方的头像）"),
      tooltip: weT("把自定义会话头像的两张图一并存进预设（默认不勾：体积翻倍，与分享一份外观配置关系最弱）"),
    }),
    React.createElement("div", { className: "we-picker__hint", key: "pa-note" },
      weT("数值配置（开关 / 尺寸 / 圆角 / 颜色等）总是完整保存，不受勾选影响 —— 勾选只决定图片与字体要不要一并带走；不勾的那一族一个字都不动对方，勾了而本机没有 = 声明「无」（对方回到内置）。")),
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
      // ⚠️ 这里**没有**导出的格子键（用户口径）：导出已独立成网格下方的
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
  //   · 导出：**独立入口**（用户口径）—— 对话框里再选"导出哪一份"；
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
  //     动作，而入口已独立成一行（用户口径）⇒ 目标由这里的下拉选，值经
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
          onChange: (e) => onExportTargetChange(e.target.value), "aria-label": weT("导出哪一份"),
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

export { renderGlassPresetsBlock };
