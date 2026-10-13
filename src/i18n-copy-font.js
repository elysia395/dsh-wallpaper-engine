/**
 * i18n-copy-font.js — 英文词表域：字体与配色（src/font/* · fontset-editor · fontset-store）
 *
 * 本域词条**原样搬自** `src/i18n-copy.js`（拆分属纯搬移：中文键与英文值一行未改、顺序未动）。
 * 组装点在同族的 `src/i18n-copy.js`（composer）；域模块必须排在 composer **之前**登记进
 * `scripts/build-client.mjs` 的 INLINE_MODULES —— 构建期内联进同一工厂作用域，顶层读受 TDZ 约束。
 * 只读不写：纯数据，不得有可执行语句。守卫判据见 `test/verify-i18n.mjs`（族读法 test/tools/src-scope.mjs）。
 */
const WE_I18N_EN_FONT = {
  // ── src/font/color-roles.js ──
  "正文": "Primary text",
  "次要文字": "Secondary text",
  "弱化说明": "Muted text",
  "极小说明": "Caption text",
  "禁用 / 更弱": "Disabled / dimmed",

  // ── src/font/components.js ──
  "对话正文": "Message body",
  "markdown 容器": "Markdown container",
  "代码块": "Code block",
  "代码": "Code",
  "终端块": "Terminal block",
  "表格": "Table",
  "对话": "Conversation",
  "代码块正文": "Code block content",
  "代码块标题条": "Code block title bar",
  "终端": "Terminal",

  // ── src/font/typography.js ──
  "标题 1": "Heading 1",
  "标题 2": "Heading 2",
  "标题 3": "Heading 3",
  "标题 4": "Heading 4",
  "小字说明": "Small text",
  "行内代码": "Inline code",
  "表头": "Table header",
  "界面小字": "UI small text",
  "界面极小字": "UI extra-small text",

  // ── src/fontset-editor.js ──
  "恢复原样": "Restore original",
  "删除": "Delete",
  "下载这个字体集（可分享 / 可再导入）": "Download this font set (shareable / re-importable)",
  "导出": "Export",
  "把「{name}」恢复成它原本的样子？你在这份上的改动会丢掉。": "Restore \"{name}\" to its original state? Your changes to this set will be lost.",
  "删除「{name}」？此操作不可恢复。": "Delete \"{name}\"? This cannot be undone.",
  "使用": "Use",
  "切换到这个字体集（立即生效）": "Switch to this font set (takes effect immediately)",
  "重命名": "Rename",
  "已经问过你了 —— 在下面那一行选「确认」或「取消」": "Already asked — choose Confirm or Cancel in the row below",
  "删掉你在这份上的改动，恢复它原本的样子": "Discard your changes to this set and restore its original state",
  "删除这个字体集（会再问一次）": "Delete this font set (asks again)",
  "（使用中）": "(in use)",
  "当前外观在这套的基础上被手动改过；点「使用」把它整份读回来": "The current Appearance was manually changed on top of this set; click Use to load the whole set back",
  "（已改）": "(modified)",
  "无法读取：{msg}": "Cannot read: {msg}",
  "保存": "Save",
  "就这么办": "Go ahead",
  "一份集 = 整套字体外观（颜色角色 / 排版 / 字重 / 字族 / 组件）。改动只落到当前这一份、随时可以恢复原样；导入导出按整份文件走。": "One set = a whole font appearance (color roles / typography / weight / font family / components). Changes apply only to the current set and can be reset anytime; import and export work on the whole file.",
  "正在读取字体集…": "Loading font sets…",
  "字体集不可用：{reason}": "Font sets unavailable: {reason}",
  "还没有任何字体集 —— 下面可以新建一份。": "No font sets yet — you can create one below.",
  "操作": "Actions",
  "导入字体集…": "Import font set…",
  "从「导出」得到的 .json 导入一份字体集": "Import a font set from a .json obtained from \"Export\"",
  "新建（以当前外观）": "New (from current appearance)",
  "把当前这套字体外观存成一份新的集，并切换过去（名字之后可以改）": "Save the current font appearance as a new set and switch to it (the name can be changed later)",
  "刷新": "Refresh",

  // ── src/fontset-store.js ──
  "宿主里没有字体集路由：重启 DSH 后再试（改过宿主代码要重挂，刷新页面不够）": "The host has no font set route: restart DSH and try again (if you changed host code it must be re-mounted; refreshing the page is not enough)",
  "宿主没有活动字体集": "The host has no active font set",
  "字体集不可用": "Font set unavailable",
  "读不出这个文件（换一个 .json 再试）": "Could not read this file (try a different .json)",
  "这不是 JSON 文件（字体集是导出出来的 .json）": "This is not a JSON file (a font set is an exported .json)",
  "这不是字体集文件（需要 {tag} 标记 —— 只有从「导出」拿到的文件才有）": "This is not a font set file (requires {tag} marker — only files obtained from \"Export\" have it)",

};

export { WE_I18N_EN_FONT };
