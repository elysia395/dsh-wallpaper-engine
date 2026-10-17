/**
 * module-reset.js —— **模块级重置按钮节点**（名字带 Node：与 panel-tabs 里那个同名薄包装，即 issue #192 的 ↺，
 * 必须区分开 —— 内联后同作用域，重名即构建失败）。
 *
 * 契约：
 *   · 纯渲染 + 意图回调，零状态、零副作用 ⇒ 与其余"只读 ctx"的渲染器同一条口径。
 *   · 抽成独立模块的**理由与 `src/section-head.js` 完全相同**：调用方横跨两个模块 ——
 *     `src/panel-tabs.js`（外观各节 + 扩展模块头）与 `src/glass-panel.js`（玻璃 UI）。
 *     打包后两者同作用域、按名字直接调；而 `test/verify-scene-live.mjs` 是**按文件 import**
 *     的替身（每个模块各有自己的作用域）⇒ 它必须能 import 到**真实现**才不会把判据架在替身上。
 *   · 依赖：`React`（外层 client 作用域）+ 调用方传入的两样东西：
 *       `onResetModule(moduleName)` ← 具名处理器（写设置 + 重渲染的唯一入口）
 *       `labels` = { title, aria }  ← **已翻译**的文案，由调用方在呼叫点完成 weT
 *     ⚠️ 本模块**不碰 weT**（与 `section-head.js` 同一条理由）：i18n 判据是**文本扫描**，
 *     它只认出现在 `weT(...)` 实参里的中文 —— 本模块不写中文，词条就不会成孤儿、
 *     也不会被判成"裸中文"。多一个自由变量还得多一处替身注入。
 *
 * 参数：
 *   @param {string} moduleName 模块名（键集在 lib/settings-schema.js 的 RESET_MODULES 里）
 *   @param {(name: string) => void} onResetModule 具名处理器
 *   @param {{title: string, aria: string}} labels 已翻译的文案
 *   @returns {*} 按钮节点；`moduleName` 为空时返回 null（不画假按钮）
 *
 * 不变量：
 *   · **必须阻止冒泡**：外观各节的节头本身是**折叠开关**（`role="button"`），不拦的话
 *     点 ↺ 会连带把这一节收起来 —— 重置完看不到结果，像是"点坏了"。
 *   · 模块级**不需要确认**（单模块代价低 —— 用户口径）；需要确认的是页签级与全局。
 */
function moduleResetButtonNode(moduleName, onResetModule, labels) {
  if (!moduleName) return null;
  const say = labels && typeof labels === 'object' ? labels : { title: '', aria: '' };
  const stop = (e) => { if (e && typeof e.stopPropagation === 'function') e.stopPropagation(); };
  return React.createElement("button", {
    className: "we-mod-reset",
    type: "button",
    title: say.title || '',
    "aria-label": say.aria || '',
    onClick: (e) => { stop(e); if (typeof onResetModule === 'function') onResetModule(moduleName); },
    onKeyDown: stop,
  }, "↺");
}

export { moduleResetButtonNode };
