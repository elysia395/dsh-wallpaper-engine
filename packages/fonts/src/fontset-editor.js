/**
 * fontset-editor.js — 「字体集」编辑器面板：**纯渲染 + 意图回调**。
 *
 * ⚠️ 归属（§6.1 = A / ADR-0013 D20）：本文件只渲染 + 抛意图。字体集的**状态与真源**仍在主包
 *    （键定义 `lib/settings-schema.js` 的 `FONTSET_KEYS`、落盘 `fontsets/<id>.json`、
 *    读写 `src/fontset-store.js`）⇒ 本文件**不持键、不持久化、不注册 settings 段**。
 *
 * 为什么单独一个模块、而且只做渲染：面板要能被判据**驱动**（点「切换」是否真的调切换、
 * 点「删除」是否先过 confirm）—— 渲染与副作用分开之后，挂载台给一组记录用的回调就能把
 * "哪个按钮对应哪个意图"钉死；真正的网络调用住在 `src/fontset-store.js`。
 * 这与 `src/picker-props-panel.js` 的分工同形（渲染 + 意图回调，副作用住调用点）。
 *
 * 契约：`renderFontSetEditor(ctx)`；`ctx` 里是**这一屏用到的一切**：
 *   · `fontSets`        宿主清单 `[{ id, name, origin, active, overrides?, broken? }]`
 *   · `activeId`        当前活动集 id（清单里的 `active` 也一致；这里显式再给一份便于渲染）
 *   · `loading` / `error`  载入中 / 可判定的失败文案（空串 = 没问题）
 *   · `editingId` / `draftName`  两个**瞬态**字段（改名那一行的 id 与输入框内容；
 *     它们住在 `selection` 里、由 client 侧 setTransient 维护 —— 与 `selection.editing` 同一手法）
 *   · `onActivate(id)` / `onRefresh()` / `onDelete(id)` / `exportUrl(id)` / `onImport(file)`
 *   · `onEdit(id)` / `onDraftName(v)` / `onRenameCommit(id)` / `onCancelEdit()`
 *   · `onCreate()` —— **不带名字**：新集的名字由客户端生成（面板不再先问一句），
 *     用户随时可以用「重命名」改；两个按钮做同一件事的形态见下。
 *     ⇒ 因此**没有** `newName` / `onNewName` 这一对：新建不需要输入框，面板也不该有那条路。
 * 对外提供：`renderFontSetEditor`（唯一的导出）。
 *
 * 导出为什么是**普通链接**（`<a download>`，不是 blob、也不是自己弹框）：这正是 DSH 自己的做法 ——
 * `@deepseek-ai/dsh-session-log-export` 的客户端把宿主下载路由交给浏览器下载管理器
 * （`document.createElement("a")` + `download` + `click()`）。在 DSH Desktop（Electron）里，
 * 应用会话**没有任何** `will-download` 拦截（唯一那处在登录会话上，而且是 `preventDefault`），
 * 于是走 Electron 默认下载流程 = **系统「另存为」对话框**。自己造一套保存通道只会与平台分叉。
 *
 * 不变量（都有守卫）：
 *   · **来源不在界面上露出**：随包 / 用户层是**实现细节**，用户面对的只是"一份份字体集"。
 *     `origin` / `overrides` 仍然照读，但只用于**能力**判定（能不能删、删下去是什么语义），
 *     一个字都不显示。
 *   · **「使用中」= 值仍然一致**（`inUseId`，不是"宿主指针"）：用户手动改过字体值之后，那一行
 *     换成「（已改）」—— 标记凭空消失会让人以为出了错。`activeId`（指针）只用于**能力判定**
 *     （活动集不可删、要先切走），与标记分开，免得漂移把"不可删"这条规则也带偏。
 *   · **发布物删不掉**：`origin === 'builtin'` 且未被覆盖时**不渲染删除按钮**（宿主也会拒）；
 *     **活动集**那一行也不出删除（要先切走 —— 界面上不摆必然报错的按钮）。
 *   · **被改过的那一份，删除按钮的语义是「恢复原样」**（同一个动作、按语义换标签：只说效果 ——
 *     删掉改动之后这一份回到它原本的样子 —— 不说来源）。
 *   · **读不懂的行不能用**：`broken` 的行禁用「使用」与「重命名」，但**保留删除**
 *     （删掉覆盖/坏文件是唯一的出路），并显示**可判定的原因**。
 *   · **删除要两下、且不用原生模态**：第一下只"待确认"，第二下「确认」才发请求。
 *   · 载入中与失败态各自可见：失败时给的是**原因**，不是"什么都没发生"。
 */

/**
 * 导入用的隐藏 file input（与自定义画面的导入同形：模块级 ref + 一个按钮去 `.click()`）。
 * 只做"选文件"，读文件与校验在 `importFontSet`（src/fontset-store.js）里。
 */
let importInput = null;

/** 删除按钮的标签：被改过的那一份，这个动作的语义是"恢复原样"（只说效果，不说来源）。 */
function deleteLabel(row) {
  return row.overrides ? weT("恢复原样") : weT("删除");
}

function renderFontSetEditor(ctx) {
  const {
    fontSets, activeId, inUseId, loading, error, editingId, draftName, armedId,
    onActivate, onRefresh, onDelete, onArm, onDisarm, exportUrl, onImport,
    onEdit, onDraftName, onRenameCommit, onCancelEdit, onCreate,
  } = ctx;
  const rows = Array.isArray(fontSets) ? fontSets : [];
  const btn = (key, label, onClick, extra) => React.createElement("button",
    Object.assign({ key, className: "we-picker__btn", type: "button", onClick }, extra || {}), label);
  /** 导出 = **普通链接**（宿主带 attachment 头应答）—— 不引入 blob，也不需要 window.open。 */
  const exportLink = (id) => React.createElement("a", {
    key: "exp", className: "we-picker__btn", href: exportUrl(id), download: id + ".json",
    title: weT("下载这个字体集（可分享 / 可再导入）"),
  }, weT("导出"));
  /**
   * 破坏性动作要**再确认一次**，且**不许用原生对话框**（`window.confirm`）。
   *
   * 机制与三条不变量（唯一令牌 / 只由「确认」落地 / 上下文切换必清）**收口在
   * src/client.js** 的 `armConfirm` / `disarmConfirm` / `renderConfirmRow` 那一段 ——
   * 本渲染器只是其中一个使用点，不在两处复述同一套理由。
   *
   * 本文件侧只剩一条自己的形态约定：`armedId` 非空 ⇒ 那个动作待确认，此时原按钮**置灰但
   * 不隐藏**（仍占着那一格 ⇒ 行宽完全不抖，并向用户指路到问句行）。清令牌由 ctx 的
   * `onDisarm` 落地；换行 / 收起子分支也都必须清（见 src/client.js 的 `fontSetCtx`）。
   */
  const answerText = (row) => (row.overrides === true
    ? weT("把「{name}」恢复成它原本的样子？你在这份上的改动会丢掉。", { name: row.name || row.id })
    : weT("删除「{name}」？此操作不可恢复。", { name: row.name || row.id }));

  const cells = [];
  for (const row of rows) {
    const isActive = row.id === activeId || row.active === true;
    const broken = typeof row.broken === "string" && row.broken;
    const overrides = row.overrides === true;
    // 发布物那份删不掉（宿主也拒）；**活动集**同样不出删除（宿主的规则：先切走 ——
    // "正在用的那份被删掉"没有可判定的结果，界面上也不该摆一个必然报错的按钮）。
    const canDelete = row.origin === "user" && !isActive;
    const actions = [];
    if (!broken) {
      if (!isActive) actions.push(btn("use", weT("使用"), () => onActivate(row.id),
        { title: weT("切换到这个字体集（立即生效）") }));
      if (editingId !== row.id) {
        actions.push(btn("ren", weT("重命名"), () => onEdit(row.id)));
      }
    }
    if (canDelete) {
      // 待确认时**按钮不隐藏**（也**不换位置**）：它仍占着那一格，宽度就完全不变 —— 藏起来会让
      // 整行缩一下、看起来像"点完少了个东西"。改成置灰 + 不可点，并向用户指路（问句在下面那行）。
      const armed = armedId === row.id;
      actions.push(btn("del", deleteLabel(row), () => { if (!armed) onArm(row.id); }, {
        disabled: armed,
        title: armed
          ? weT("已经问过你了 —— 在下面那一行选「确认」或「取消」")
          : (overrides ? weT("删掉你在这份上的改动，恢复它原本的样子") : weT("删除这个字体集（会再问一次）")),
      }));
    }
    actions.push(exportLink(row.id));

    cells.push(React.createElement("tr", { key: row.id, className: "we-picker__fontset-row" },
      React.createElement("td", null,
        React.createElement("span", { className: "we-picker__fontset-name" }, row.name || row.id),
        // 「使用中」= **值仍然一致**（指针指着它 + 自采纳以来没被手动改过）；被改过就换成「已改」，
        // 让人知道"当前这套是在它的基础上动过的"，而不是让标记凭空消失。
        row.id === inUseId
          ? React.createElement("span", { className: "we-picker__hint" }, weT("（使用中）"))
          : (row.id === activeId
            ? React.createElement("span", { className: "we-picker__hint", title: weT("当前外观在这套的基础上被手动改过；点「使用」把它整份读回来") }, weT("（已改）"))
            : null),
        broken ? React.createElement("span", { className: "we-picker__hint" }, weT("无法读取：{msg}", { msg: broken })) : null,
      ),
      React.createElement("td", null,
        editingId === row.id
          ? React.createElement(React.Fragment, null,
            React.createElement("input", {
              className: "we-picker__file",
              type: "text",
              value: draftName,
              placeholder: row.name || row.id,
              onChange: (e) => onDraftName(e.target.value),
              onKeyDown: (e) => { if (e && e.key === "Enter") onRenameCommit(row.id); },
            }),
            btn("ok", weT("保存"), () => onRenameCommit(row.id)),
            btn("cancel", weT("取消"), () => onCancelEdit()),
          )
          : actions,
      ),
    ));
    // 待确认**独占一行**（跨两列）：塞进操作格里会把整行往右推，既不美观也让"哪一行在问"
    // 变得含糊。这一行紧跟它自己那一行，问句在左、两枚按钮在右。
    if (canDelete && armedId === row.id) {
      cells.push(React.createElement("tr", { key: row.id + "-ask", className: "we-picker__fontset-confirm" },
        React.createElement("td", { colSpan: 2 },
          React.createElement("span", { className: "we-picker__hint" }, answerText(row)),
          btn("yes", weT("确认"), () => onDelete(row.id), { title: weT("就这么办") }),
          btn("no", weT("取消"), () => onDisarm(), { title: weT("算了") }),
        ),
      ));
    }
  }

  return React.createElement(React.Fragment, null,
    React.createElement("div", { className: "we-picker__ctl we-picker__ctl--wrap" },
      ctlText(weT("字体集"), weT("一份集 = 整套字体外观（颜色角色 / 排版 / 字重 / 字族 / 组件）。改动只落到当前这一份、随时可以恢复原样；导入导出按整份文件走。")),
    ),
    loading ? React.createElement("div", { className: "we-picker__hint" }, weT("正在读取字体集…")) : null,
    // ⚠️ reason 必须再过一次 weT：它来自宿主回包（lib/routes/fontsets.js 里那批中文 error），
    //    原样塞进去会让英文界面露出中文，并让 i18n-copy.js 里为这些串备好的词条永远成为死词条。
    error ? React.createElement("div", { className: "we-picker__hint" }, weT("字体集不可用：{reason}", { reason: weT(error) })) : null,
    rows.length === 0 && !loading
      ? React.createElement("div", { className: "we-picker__hint" }, weT("还没有任何字体集 —— 下面可以新建一份。"))
      : null,
    rows.length
      ? React.createElement("table", { className: "we-picker__font-table" },
        React.createElement("thead", null,
          React.createElement("tr", null,
            React.createElement("th", null, weT("字体集")),
            React.createElement("th", null, weT("操作")),
          ),
        ),
        React.createElement("tbody", null, cells),
      )
      : null,
    React.createElement("div", { className: "we-picker__ctl" },
      React.createElement("input", {
        className: "we-picker__file",
        type: "file",
        // 只做文件对话框的提示（真正的门是 `$schema`，宿主权威校验）；
        // 与自定义画面的导入同形：隐藏 input + 一个按钮去 click()。
        accept: ".json,application/json",
        style: { display: "none" },
        ref: (el) => { importInput = el; },
        onChange: (e) => {
          const f = e.target.files && e.target.files[0];
          try { e.target.value = ""; } catch { /* ignore */ }
          if (f) onImport(f);
        },
      }),
      btn("import", weT("导入字体集…"), () => {
        if (importInput && typeof importInput.click === "function") importInput.click();
      }, { title: weT("从「导出」得到的 .json 导入一份字体集") }),
      // 「新建」不再先问名字：名字由客户端生成（「我的字体集」/「我的字体集 2」…），
      // 建完立刻切过去 —— 用户的下一步一定是调它；想改名随时用行内的「重命名」。
      btn("new", weT("新建（以当前外观）"), () => onCreate(),
        { title: weT("把当前这套字体外观存成一份新的集，并切换过去（名字之后可以改）") }),
      btn("refresh", weT("刷新"), () => onRefresh()),
    ),
  );
}

export { renderFontSetEditor };
