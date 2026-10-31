/**
 * picker-modal.js — 壁纸选择器**库视图**的渲染器（整棵 `we-picker__modal` 子树）。
 *
 * 形态是**页内下钻视图**：调用点（src/client.js）在 `pickerOpen` 时把它整棵嵌进页签面板，
 * ESC / 顶部「返回」/ 切页签退出。类名沿用 `we-picker__modal*` 一系 —— 那些选择器**按层级与
 * 相邻关系**绑定这棵树（跨层绑定两个 picker 类的规则还落在本子树里），改一个类名或挪一层
 * 就**静默**失效，所以类名是契约而不是命名。`modal` 只剩名字，语义就是"壁纸库浏览视图"。
 *
 * 两套模式（渲染开关 `sel.pickerDraft`）：普通 = 点卡片即应用当前壁纸；草稿 = 轮播
 * 编辑器的下钻，点卡片加入/移出列表草稿（隐藏页 / 批量 / 关闭卡收起，顶部显已选数）。
 * **草稿=false 时逐字走普通分支**（标记等价 golden 只录普通形态）。
 *
 * 为什么单独一个文件：它是选择器里**层级契约最重**的一块标记，而把它留在
 * `WallpaperPicker` 的 return 表达式里，就等于让"库视图怎么画"混在"状态 + 处理器 + 装配"
 * 之间；搬出后组件体只剩后者，前者看这里。
 *
 * 契约（构建期由 scripts/build-client.mjs 内联进 bundle 的工厂作用域，"外部作用域" =
 * 同一 prelude / src/client.js 的顶层）：
 *   · 渲染器**只从一个参数取外界**：`(ctx)` —— 状态读值 + 派生列表 + 库视图那几个
 *     「改状态 + 发通知」的过渡回调，由 `WallpaperPicker` 在**调用点**就地组装。
 *   · **多传字段无害，漏传会当场 ReferenceError**（守卫会抓住）—— 刻意选的
 *     失败方式：响亮且可定位。
 *   · 本渲染器**不写 `selection`、不自己发通知**：改状态是处理器的职责（它们仍住在面板组件
 *     里）。库视图里那些改状态的箭头 —— 页签切换 ×2、批量 ×3、
 *     搜索 ×1、卡片点击 ×1 —— 都是 ctx 里的回调名；「全部恢复」与隐藏卡片的「恢复」
 *     仍直接调模块级函数（`restoreWallpapers` / `applySelection`），这与 src/panel-tabs.js
 *     直接调 `syncLayers()` 是同一口径：模块级工具可以直呼，组件状态只能经 ctx。
 *   · 虚拟滚动的窗口（vwin）与网格 ref（gridRef）也走 ctx：hooks 长在 WallpaperPicker
 *     里（本渲染器是纯函数），测量由 src/quick-panel.js 的 qpVirtWindow 负责 ——
 *     库视图**不分页**（用户口径），classic CD 架除外（见下）。
 *   · 模块级依赖（React / VinylRecord / cardKeyDown /
 *     modalInitialFocus / CARD_TYPE_LABELS / vinylSpinVisible / restoreWallpapers /
 *     hideWallpapers / applySelection）直接读，不经过 ctx —— 它们是常量、纯组件与模块级工具。
 *   · 本文件必须保持浏览器安全（无 import / require / Node API），且**不得有顶层可执行语句**
 *     读 client.js 的 const（会被内联到 bundle 顶部，撞 TDZ）。
 *
 * **标记等价**是这一项的验收核心：搬迁前后这棵子树的 class 序列（深度优先 + 深度前缀）必须
 * 逐字相同 —— 判据在 `test/verify-client.mjs` 的「模态框标记等价」一段，含三个状态的 golden
 * （普通视图 / 批量模式 / 隐藏页）、负对照与绝对锚点。
 */

  // ── 网格几何常量（顶层：client.js 的 qpVirtWindow 调用引用同一份，改样式两边同步）──
  const PICKER_CARD_H = 92;   // .we-picker__card 的固定 height（网格轨道不认内容高，见 styles.js）
  const PICKER_CARD_GAP = 8;  // .we-picker__grid 的 gap
  const PICKER_VP_FIRST = 30; // 还没量到窗口时的首帧条目数（关闭卡在内；量完立刻收窄）

  function renderPickerModal(ctx) {
    const { sel, playableList, hiddenList, cdMode, vwin } = ctx;
  // ── 库视图虚拟滚动（用户口径：**不要分页**）────────────────────
  // 网格按"占位 spacer + 可视窗口"渲染，与侧栏（quick-panel）同一套机制：窗口由
  // `qpVirtWindow` 在 WallpaperPicker（组件）里量，经 ctx（vwin / gridRef）传进来 ——
  // 本渲染器是纯函数，hooks 不能长在它身上。classic CD 架**不虚拟化**（卡片是
  // aspect-ratio + 负 margin 叠盖，行高随列宽变，固定行距的算式不成立；那一档本来
  // 就没有分页），维持全量渲染。
  //   · 「✕ 关闭」卡是网格的**第 0 个条目**（不是列表元素）：必须算进窗口切片，
  //     否则它会把首行数据卡挤到别处（full-span 的上占位没法与它同行）。
  //   · viewTag 必须与 client.js 侧喂给 qpVirtWindow 的取值一致：换形态（正常 / 草稿 /
  //     隐藏 / 开关下钻）的一帧，旧窗口是另一份几何 ⇒ 按未测量处理（首窗 + 零占位），
  //     测量 effect 立刻跟上。
  const PICKER_CLOSE_ITEM = { __closeCard: true };
  // 草稿模式（轮播编辑器的「选择壁纸」下钻，pickerDraft）：点卡片 = 加入/移出
  // 草稿（onPickCard 在组件侧路由），本形态下隐藏页 / 批量 / 关闭卡都无意义、整体收起，
  // 顶部换成已选计数提示。draft=false（普通下钻）时每一处都走原分支，逐字不受影响。
  const draft = sel.pickerDraft === true;
  const draftIdSet = new Set((sel.editing && sel.editing.wallpaperIds) || []);
  const viewTag = sel.modalView === "hidden" ? "hidden" : (draft ? "draft" : "normal");
  // 窗口换算（vItems = gridItems.slice(vStart, vEnd)）：未测量 ⇒ 首窗；classic ⇒ 全量。
  // 占位高 = **网格行数** × 行距 − 一个 gap（spacer 自己与相邻行之间还各隔一个 gap）；
  // 上占位向下取整、下占位向上取整（末行不满也占一行）—— 测量回来的窗口本就按 cols
  // 对齐，这里只是防御。
  const pickerWindow = (gridItems) => {
    const meas = !cdMode && vwin && vwin.tag === viewTag && vwin.cols > 0;
    const start = meas ? Math.min(vwin.start, gridItems.length) : 0;
    const end = meas
      ? Math.max(start, Math.min(vwin.end, gridItems.length))
      : (cdMode ? gridItems.length : Math.min(PICKER_VP_FIRST, gridItems.length));
    const items = gridItems.slice(start, end);
    const after = gridItems.length - start - items.length;
    const pitch = PICKER_CARD_H + PICKER_CARD_GAP;
    return {
      items,
      topH: meas && start > 0 ? Math.floor(start / vwin.cols) * pitch - PICKER_CARD_GAP : 0,
      btmH: meas && after > 0 ? Math.ceil(after / vwin.cols) * pitch - PICKER_CARD_GAP : 0,
    };
  };
  // 两份窗口现算（切片是 O(窗口) 的浅拷贝，每渲染一次的开销可以忽略）：
  const closePlus = draft ? playableList : [PICKER_CLOSE_ITEM].concat(playableList);
  const normalWin = pickerWindow(closePlus);
  const hiddenWin = pickerWindow(hiddenList);
  // 这棵子树的所有渲染器（head / tabs / 两个 body 分支 / 批量条 / 过滤行 / 关闭卡 / 数据卡）
  // 都在下方的「子渲染器」段 —— 本函数只留"派生 + 装配"。

  // 页内下钻视图：不再 portal 到 body、不再有遮罩与对话框语义 —— 整棵子树原样
  // 嵌进页签面板，挂载时机由调用点（WallpaperPicker 的 pickerOpen 分支）决定。
  return React.createElement("div", {
          className: "we-picker__modal",
          "data-we-cards": sel.pickerLayout,
          "aria-label": weT("选择壁纸"),
        },
          renderPickerModalHead(ctx),
          !draft && renderPickerModalTabs(ctx, draft),
          sel.modalView === "hidden" && !draft
            ? renderPickerHiddenBody(ctx, hiddenWin)
            : renderPickerNormalBody(ctx, draft, draftIdSet, normalWin),
          // 底部只留提示：返回按钮在顶部（modal-head，也是初始焦点落点），
          // 底部再放一个是重复的。
          renderPickerModalFoot(draft),
    );
}

  // ── 库视图的子渲染器 ─────────────────────────────────────────────────
  // 判据：这些子树的输入全部来自 `ctx`（外加现算的 draft / draftIdSet / normalWin / hiddenWin）
  // ⇒ 不需要父函数的局部作用域。父函数只留"派生 + 装配"。

  function renderPickerVSpacer(key, h) {
    return React.createElement("div", {
      key,
      className: "we-picker__vspacer",
      style: { height: Math.max(0, h) + "px" },
      "aria-hidden": "true",
    });
  }

  function renderPickerCloseCard(ctx) {
    const { sel, onClear, onTogglePlay, closePicker } = ctx;
    // #255③：库视图第一张卡是「当前壁纸」的快捷动作，**不是**清空开关。
    // 有壁纸时 = 暂停 / 继续（壁纸保持当前画面）；没有壁纸时才退化成关闭库视图。
    // 清空仍走「当前壁纸」卡上的「清除」（有二次确认）——关一张卡就黑屏是用户报障的那条。
    const hasWallpaper = Boolean(sel.id);
    const canToggle = hasWallpaper && typeof onTogglePlay === "function";
    const onClick = canToggle ? onTogglePlay : (typeof closePicker === "function" ? closePicker : onClear);
    const paused = canToggle && !sel.playing;
    return React.createElement("div", {
      className: "we-picker__card" + (sel.id ? "" : " we-picker__card--selected"),
      role: "button",
      tabIndex: 0,
      onClick,
      title: canToggle ? (paused ? weT("继续播放壁纸") : weT("暂停壁纸（保留当前画面）")) : weT("关闭壁纸库"),
      onKeyDown: cardKeyDown,
    },
    React.createElement("span", { className: "we-picker__card-close" },
      canToggle ? (paused ? weT("▶ 播放") : weT("⏸ 暂停")) : weT("✕ 关闭")),
    );
  }

  function renderPickerPickCard(ctx, w, draft, draftIdSet) {
    const { sel, onPickCard } = ctx;
    return React.createElement("div", {
      key: w.id,
      // 卡片自报身份：视频壁纸的提交前预热靠它（见 src/video-layer.js
      // 的 warmVideoForPointer）——按下即预热，抬手才点击。
      "data-we-id": String(w.id),
      className: "we-picker__card" + (w.id === sel.id ? " we-picker__card--selected" : "")
        // 勾选高亮：草稿模式 = 成员集合；批量模式 = batchSelected。
        // ⚠️ 高亮类必须是 `--checked` —— CSS 挂在它上面，挂到
        // `--selected`（= 当前播放）上会"勾了永远不亮"。
        + ((draft ? draftIdSet.has(w.id) : sel.batchMode && sel.batchSelected.indexOf(w.id) >= 0) ? " we-picker__card--checked" : ""),
      role: "button",
      tabIndex: 0,
      title: w.title,
      onClick: () => onPickCard(w),
      onKeyDown: cardKeyDown,
    },
    w.preview
      ? React.createElement("img", {
          src: w.preview, alt: w.title, loading: "lazy",
          onError: (e) => { e.target.style.display = "none"; },
          onLoad: (e) => { e.target.style.opacity = "1"; },
        })
      : React.createElement("span", { className: "we-picker__card-placeholder" }, weT("无预览")),
    // 类型徽标（卡片左上角）：勾选态（草稿 / 批量）下让位给勾选框。
    !sel.batchMode && !draft && CARD_TYPE_LABELS[w.type]
      && React.createElement("span", { className: "we-picker__card-type" }, CARD_TYPE_LABELS[w.type]),
    React.createElement("span", { className: "we-picker__card-title" }, w.title),
    w.type === "scene" && React.createElement("span", { className: "we-picker__card-badge" }, w.sceneLive ? weT("实时渲染") : weT("静态帧")),
    w.type === "web" && React.createElement("span", { className: "we-picker__card-badge" }, w.webLive ? weT("实时渲染") : weT("兼容模式")),
    (draft || sel.batchMode)
      ? React.createElement("span", { className: "we-picker__card-check" },
          (draft ? draftIdSet.has(w.id) : sel.batchSelected.indexOf(w.id) >= 0) ? "✓" : "")
      : React.createElement("button", {
          className: "we-picker__card-hide", type: "button",
          title: weT("隐藏此壁纸（可在「已隐藏」中恢复）"),
          onClick: (e) => { e.stopPropagation(); hideWallpapers([w.id]); },
        }, weT("隐藏")),
    );
  }

  function renderPickerHiddenBody(ctx, hiddenWin) {
    const { hiddenList, armedConfirm, onArmConfirm, onDisarmConfirm, cdMode, gridRef } = ctx;
    return React.createElement("div", { className: "we-picker__modal-body" },
        hiddenList.length === 0
          ? React.createElement("span", { className: "we-picker__hint" }, weT("没有已隐藏的壁纸"))
          : React.createElement(React.Fragment, null,
              // 头部行与问句行放在网格**外**（modal-body 直属）：它们是语义行不是
              // 网格单元 —— 作为网格子元素会被 auto-fill 塞进一张卡位（挤压变形）；
              // 放在网格外与正常列表的过滤行同构，网格里只剩纯卡片，虚拟
              // 窗口的行号折算才成立。
              React.createElement("div", { className: "we-picker__row" },
                React.createElement("span", { className: "we-picker__hint" },
                  weT("已隐藏 {n} 张（仅从列表隐藏，不删除源文件）", { n: hiddenList.length })),
                React.createElement("button", {
                  className: "we-picker__btn", type: "button",
                  // 第一下只置令牌；落地在问句行的「确认」里（`restoreWallpapers` 是
                  // 模块级工具 ⇒ 与隐藏卡片的「恢复」同口径，可以在问句行里直呼）。
                  onClick: () => onArmConfirm("restoreAll"),
                  disabled: armedConfirm === "restoreAll",
                  title: armedConfirm === "restoreAll"
                    ? weT("已经问过你了 —— 在下面那一行选「确认」或「取消」")
                    : weT("把已隐藏的全部恢复（会再问一次）"),
                }, weT("全部恢复")),
              ),
              renderConfirmRow(armedConfirm, "restoreAll",
                weT("恢复全部 {n} 张已隐藏壁纸？", { n: hiddenList.length }),
                () => restoreWallpapers(hiddenList.map((w) => w.id)), onDisarmConfirm),
              React.createElement("div", { ref: cdMode ? undefined : gridRef, className: "we-picker__grid" },
                hiddenWin.topH > 0 ? renderPickerVSpacer("we-picker-vtop", hiddenWin.topH) : null,
                hiddenWin.items.map((w) => React.createElement("div", {
                  key: w.id,
                  className: "we-picker__card we-picker__card--hidden",
                  // 卡片自报身份：视频壁纸的提交前预热靠它（指针按下 → 预到元数据，
                  // 见 src/video-layer.js 的 warmVideoForPointer）。
                  "data-we-id": String(w.id),
                  role: "button",
                  tabIndex: 0,
                  title: w.title,
                  "aria-label": weT("恢复并应用 {name}", { name: w.title }),
                  onClick: () => applySelection(w.id),
                  // 键盘可达性：正常列表卡片一直有 Enter/Space 处理，
                  // 已隐藏卡片漏了 —— 补上（共享 cardKeyDown）。
                  onKeyDown: cardKeyDown,
                },
                w.preview
                  ? React.createElement("img", {
                      src: w.preview, alt: w.title, loading: "lazy",
                      onError: (e) => { e.target.style.display = "none"; },
                      onLoad: (e) => { e.target.style.opacity = "1"; },
                    })
                  : React.createElement("span", { className: "we-picker__card-placeholder" }, weT("无预览")),
                CARD_TYPE_LABELS[w.type]
                  && React.createElement("span", { className: "we-picker__card-type" }, CARD_TYPE_LABELS[w.type]),
                React.createElement("span", { className: "we-picker__card-title" }, w.title),
                w.type === "scene" && React.createElement("span", { className: "we-picker__card-badge" }, w.sceneLive ? weT("实时渲染") : weT("静态帧")),
                w.type === "web" && React.createElement("span", { className: "we-picker__card-badge" }, w.webLive ? weT("实时渲染") : weT("兼容模式")),
                React.createElement("button", {
                  className: "we-picker__card-hide", type: "button",
                  title: weT("恢复此壁纸"),
                  onClick: (e) => { e.stopPropagation(); restoreWallpapers([w.id]); },
                }, weT("恢复")),
                )),
                hiddenWin.btmH > 0 ? renderPickerVSpacer("we-picker-vbtm", hiddenWin.btmH) : null,
              ),
            ),
      );
  }

  function renderPickerNormalBody(ctx, draft, draftIdSet, normalWin) {
    const { sel, playableList, onToggleBatchMode, armedConfirm, onBatchHide, onDisarmConfirm, cdMode, gridRef, query, folderFilter } = ctx;
    return React.createElement("div", { className: "we-picker__modal-body" },
        draft
          ? React.createElement("div", { className: "we-picker__row" },
              React.createElement("span", { className: "we-picker__hint" },
                weT("已选 {n} 个 · 点卡片加入 / 移出", { n: draftIdSet.size })),
            )
          : React.createElement("div", { className: "we-picker__row" },
            React.createElement("span", { className: "we-picker__hint" },
              weT("{n} 个可播放壁纸 · 点击卡片即应用", { n: playableList.length })),
            React.createElement("button", {
              className: "we-picker__btn", type: "button",
              onClick: onToggleBatchMode,
              disabled: playableList.length === 0,
              title: weT("多选后批量隐藏"),
            }, sel.batchMode ? weT("退出批量") : weT("批量")),
          ),
        sel.batchMode && renderPickerBatchBar(ctx),
        // 问句行是**同级**（不是包一层）：包 Fragment 会把批量条整棵子树推深一层，
        // 那会让 116 个按层级绑定的选择器与「标记等价」golden 当场漂。
        renderConfirmRow(armedConfirm, "batchHide",
          weT("隐藏选中的 {n} 张壁纸？可在「已隐藏」中随时恢复。", { n: sel.batchSelected.length }),
          onBatchHide, onDisarmConfirm),
        renderPickerFilterRow(ctx),
        React.createElement("div", { ref: cdMode ? undefined : gridRef, className: "we-picker__grid" },
          // "Close wallpaper" card — equivalent of the first <option> in the
          // select-based UI. Rendered as a <div role="button"> like every other card:
          // <button> ignores aspect-ratio in several browsers, which
          // collapses the cell and lets the "✕ 关闭" label float over
          // the adjacent thumbnail.
          // 草稿模式下不渲染：该形态挑的是"进哪个列表"，与当前播放无关。
          // 虚拟窗口形态：关闭卡是窗口的第 0 个条目（pickerWindow），随切片走；
          // 空库时窗口里只有它 + 空态提示。
          playableList.length === 0
            ? React.createElement(React.Fragment, null,
                !draft && renderPickerCloseCard(ctx),
                React.createElement("span", { className: "we-picker__hint" },
                  query
                    ? weT("没有匹配「{q}」的壁纸 · 试试缩短关键词或清除过滤", { q: sel.search })
                    // 选了文件夹却一张都没有：多半是分级 / 类型把它们挡在门外（成员数 ≠
                    // 当前过滤下的可用数）。单独说一句，否则用户会以为文件夹是空的。
                    : folderFilter !== "all"
                      ? weT("这个文件夹里没有通过当前分级 / 类型过滤的壁纸")
                      : weT("没有可播放的壁纸")),
              )
            : React.createElement(React.Fragment, null,
                normalWin.topH > 0 ? renderPickerVSpacer("we-picker-vtop", normalWin.topH) : null,
                normalWin.items.map((w) => (w && w.__closeCard) ? renderPickerCloseCard(ctx) : renderPickerPickCard(ctx, w, draft, draftIdSet)),
                normalWin.btmH > 0 ? renderPickerVSpacer("we-picker-vbtm", normalWin.btmH) : null,
              ),
        ),
      );
  }

  function renderPickerModalHead(ctx) {
    const { current, playbackLive, sel, closePicker } = ctx;
    return React.createElement("div", { className: "we-picker__modal-head" },
      React.createElement("div", { className: "we-picker__modal-head-left" },
        React.createElement(VinylRecord, {
          cover: current && current.preview, title: current ? current.title : "",
          playing: playbackLive && Boolean(sel.url) && vinylSpinVisible(), sm: true,
        }),
        React.createElement("span", { className: "we-picker__modal-title" }, weT("选择壁纸")),
      ),
      React.createElement("button", {
        className: "we-picker__btn", type: "button", onClick: closePicker,
        // 打开库视图时焦点落在这里（一次性，见 modalInitialFocus）。
        ref: modalInitialFocus,
      }, weT("返回")),
    );
  }

  function renderPickerModalTabs(ctx, draft) {
    const { sel, onShowNormalView, onShowHiddenView, playableList, hiddenList } = ctx;
    return React.createElement("div", { className: "we-picker__modal-tabs", role: "tablist" },
      React.createElement("button", {
        className: "we-picker__btn we-picker__tab" + (sel.modalView === "hidden" ? "" : " we-picker__tab--active"),
        type: "button",
        role: "tab",
        "aria-selected": sel.modalView !== "hidden",
        onClick: onShowNormalView,
      }, weT("正常列表（{n}）", { n: playableList.length })),
      React.createElement("button", {
        className: "we-picker__btn we-picker__tab" + (sel.modalView === "hidden" ? " we-picker__tab--active" : ""),
        type: "button",
        role: "tab",
        "aria-selected": sel.modalView === "hidden",
        onClick: onShowHiddenView,
      }, weT("已隐藏（{n}）", { n: hiddenList.length })),
    );
  }

  function renderPickerModalFoot(draft) {
    return React.createElement("div", { className: "we-picker__modal-foot" },
      React.createElement("span", { className: "we-picker__hint" },
        draft ? weT("点卡片加入 / 移出 · ESC 返回") : weT("ESC 返回 · 点击卡片即应用")),
    );
  }

  function renderPickerBatchBar(ctx) {
    const { sel, armedConfirm, onArmBatchHide, onBatchCancel } = ctx;
    return React.createElement("div", { className: "we-picker__row we-picker__batch-bar" },
      React.createElement("span", { className: "we-picker__hint" }, weT("已选 {n} 张", { n: sel.batchSelected.length })),
      React.createElement("button", {
        className: "we-picker__btn", type: "button",
        // 第一下只置令牌（`onArmBatchHide`）；落地在下面那行问句的「确认」里。
        // 待确认时置灰但**不隐藏**：位置与宽度都不变，并指路到问句行。
        onClick: onArmBatchHide,
        disabled: sel.batchSelected.length === 0 || armedConfirm === "batchHide",
        title: armedConfirm === "batchHide"
          ? weT("已经问过你了 —— 在下面那一行选「确认」或「取消」")
          : weT("隐藏选中的这些壁纸（会再问一次）"),
      }, weT("批量隐藏")),
      React.createElement("button", {
        className: "we-picker__btn", type: "button",
        onClick: onBatchCancel,
      }, weT("取消")),
    );
  }

  function renderPickerFilterRow(ctx) {
    const {
      sel, basePlayable, ratingCounts, typeCounts, onSearchInput, onRatingToggle, onTypeToggle,
      folderOptions, folderFilter, onFolderFilterChange,
    } = ctx;
    // 分级是**多档勾选**（用户口径 2026-10-30，像 WE 本身那样自由组合）：勾上的档才允许
    // 出现在列表、轮播与播放里；计数用各档精确张数（不是累加，勾选本身就是自由组合）。
    const ratingsOn = new Set(Array.isArray(sel.contentRatingFilter) ? sel.contentRatingFilter : []);
    const ratingTiers = ["everyone", "pg13", "mature", "unrated"];
    // 每档标签是一条整句词条（带 `{n}` 占位符、渲染期带计数取值）—— 调用点不拼半句话，
    // 否则英文语序对不上（i18n 守卫判据 ①b）。
    const ratingLabelOf = {
      everyone: () => weT("全年龄（{n}）", { n: ratingCounts.everyone }),
      pg13: () => weT("PG13（{n}）", { n: ratingCounts.pg13 }),
      mature: () => weT("成人 / R（{n}）", { n: ratingCounts.mature }),
      unrated: () => weT("未分级（{n}）", { n: ratingCounts.unrated }),
    };
    // 摘要只写固定的「内容分级」四个字（用户口径 2026-10-30：随勾选变宽会让整行不协调，
    // 选中状态读勾选框本身即可）。计数文案只出现在候选行的整句词条里。
    // 类型勾选集合（v8 起 typeFilter 是数组，与内容分级同款下拉多选）；计数用各档精确张数。
    const typesOn = new Set(Array.isArray(sel.typeFilter) ? sel.typeFilter : []);
    const typeTiers = ["video", "web", "image", "scene"];
    const typeLabelOf = {
      video: () => weT("视频（{n}）", { n: typeCounts.video || 0 }),
      web: () => weT("网页（{n}）", { n: typeCounts.web || 0 }),
      image: () => weT("图片（{n}）", { n: typeCounts.image || 0 }),
      scene: () => weT("场景（{n}）", { n: typeCounts.scene || 0 }),
    };
    return React.createElement("div", { className: "we-picker__row we-picker__filter-row" },
      // 标题搜索：几百上千张壁纸时最快的定位方式。输入即过滤，与分级/类型过滤叠加。
      React.createElement("input", {
        className: "we-picker__text we-picker__search", type: "text",
        value: sel.search,
        placeholder: weT("搜索壁纸标题…"),
        "aria-label": weT("搜索壁纸标题"),
        onInput: onSearchInput,
      }),
      // 文件夹（#264）：只在**用户真的在 WE 里建过文件夹**时才画这一栏（`folderOptions`
      // 空 ⇒ 整块不渲染）。单选取值（不是多档）：夹子之间是互斥浏览，组合起来没有意义。
      // 与内容分级/类型同一套 `<details>` 下拉形态，行样式复用 `we-picker__rating-toggle`，
      // 所以筛选行观感一致、也不用另写一份候选行 CSS。
      folderOptions.length
        ? React.createElement("details", { className: "we-picker__folder-menu" },
          React.createElement("summary", {
            className: "we-picker__folder-btn",
            "aria-label": weT("文件夹"),
            title: weT("对应 Wallpaper Engine「已安装」里的文件夹（只筛这一张列表，不改轮播）"),
          },
          React.createElement("span", { className: "we-picker__folder-text" },
            folderFilter === "all"
              ? weT("文件夹")
              : weT("{name}（{n}）", {
                name: (folderOptions.find((f) => f.id === folderFilter) || {}).name || "",
                n: (folderOptions.find((f) => f.id === folderFilter) || {}).count || 0,
              })),
          React.createElement("span", { className: "we-picker__folder-caret", "aria-hidden": "true" }, "▾"),
          ),
          React.createElement("div", { className: "we-picker__folder-list" },
            React.createElement("label", {
              className: "we-picker__rating-toggle" + (folderFilter === "all" ? " we-picker__rating-toggle--on" : ""),
            },
            React.createElement("input", {
              type: "radio", name: "we-folder", className: "we-picker__rating-check",
              checked: folderFilter === "all",
              onChange: () => onFolderFilterChange("all"),
              "aria-label": weT("全部（{n}）", { n: basePlayable.length }),
            }),
            React.createElement("span", null, weT("全部（{n}）", { n: basePlayable.length })),
            ),
            folderOptions.map((o) => React.createElement("label", {
              key: o.id,
              className: "we-picker__rating-toggle" + (folderFilter === o.id ? " we-picker__rating-toggle--on" : ""),
            },
            React.createElement("input", {
              type: "radio", name: "we-folder", className: "we-picker__rating-check",
              checked: folderFilter === o.id,
              onChange: () => onFolderFilterChange(o.id),
              "aria-label": o.name,
            }),
            React.createElement("span", null, (o.depth ? "— ".repeat(o.depth) : "") + (o.unresolvedCount > 0
              ? weT("{name}（{n}/{m}）", { name: o.name, n: o.count, m: o.count + o.unresolvedCount })
              : weT("{name}（{n}）", { name: o.name, n: o.count }))),
            )),
          ),
          )
        : null,
      // 内容分级：下拉 + 多档勾选（用户口径 2026-10-30：四枚胶囊铺在筛选行里观感差）。
      // `<details>/<summary>` 给原生开合与键盘可达性；勾选即写数组，任一下拉项都不改列表
      // 语义（分级是内容闸门，勾上的档才允许出现在列表、轮播与播放里）。
      React.createElement("details", { className: "we-picker__rating-menu" },
      React.createElement("summary", {
        className: "we-picker__rating-btn",
        "aria-label": weT("内容分级"),
        title: weT("对应 Wallpaper Engine 的内容分级（project.json contentrating）；多档勾选、自由组合：勾上的档才允许出现在列表、轮播与播放里"),
      },
      React.createElement("span", { className: "we-picker__rating-text" }, weT("内容分级")),
      React.createElement("span", { className: "we-picker__rating-caret", "aria-hidden": "true" }, "▾"),
      ),
      React.createElement("div", { className: "we-picker__rating-list" },
      ratingTiers.map((tier) => React.createElement("label", {
        key: tier,
        className: "we-picker__rating-toggle" + (ratingsOn.has(tier) ? " we-picker__rating-toggle--on" : ""),
      },
      React.createElement("input", {
        type: "checkbox", className: "we-picker__rating-check",
        value: tier,
        checked: ratingsOn.has(tier),
        onChange: () => onRatingToggle(tier, !ratingsOn.has(tier)),
        "aria-label": weT("内容分级（{name}）", { name: ratingLabelOf[tier]() }),
      }),
      React.createElement("span", null, ratingLabelOf[tier]()),
      )),
      ),
      ),
      // 类型筛选：与内容分级同款「下拉 + 多档勾选」（v8 起 typeFilter 是勾选集合）；
      // 类型档只筛列表与「下一张」候选，不拦正在应用的壁纸。
      React.createElement("details", { className: "we-picker__type-menu" },
      React.createElement("summary", {
        className: "we-picker__type-btn",
        "aria-label": weT("类型"),
        title: weT("按壁纸类型过滤（勾选集合；只筛列表与「下一张」候选，不打断正在应用的壁纸）"),
      },
      React.createElement("span", { className: "we-picker__rating-text" }, weT("类型")),
      React.createElement("span", { className: "we-picker__rating-caret", "aria-hidden": "true" }, "▾"),
      ),
      React.createElement("div", { className: "we-picker__rating-list" },
      typeTiers.map((tier) => React.createElement("label", {
        key: tier,
        className: "we-picker__rating-toggle" + (typesOn.has(tier) ? " we-picker__rating-toggle--on" : ""),
      },
      React.createElement("input", {
        type: "checkbox", className: "we-picker__rating-check",
        value: tier,
        checked: typesOn.has(tier),
        onChange: () => onTypeToggle(tier, !typesOn.has(tier)),
        "aria-label": weT("类型（{name}）", { name: typeLabelOf[tier]() }),
      }),
      React.createElement("span", null, typeLabelOf[tier]()),
      )),
      ),
      ),
    );
  }

  export {
    renderPickerModal,
  };
