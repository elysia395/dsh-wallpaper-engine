/**
 * panel-tabs.js — 面板页签的**渲染器**（七个域：壁纸 / 外观 / 吉祥物 / 效果 / 声音 / 高级 / 关于，
 * 再加一个**模块容器**「扩展」；组合成六页签 壁纸库 / 外观 / 播放 / 系统 / 扩展 / 关于，
 * 装配点见 src/client.js 的 renderActiveTab）。
 *
 * 为什么单独一个文件：这些渲染器**读**面板状态、**调**面板处理器，但自己不持有状态 ——
 * 正是最适合独立出去的一层。这样面板组件体只剩"状态 + 处理器 + 装配"，页签怎么画看这里。
 * （「关于」除组件行状态外不读任何 ctx 字段：静态文案 + 两张随包二维码。「扩展」也只画
 * `extensionModules()` 里登记过的模块（外加组件行状态与 `onResetModule`），一张都没登记就画空态。）
 *
 * 契约（构建期由 scripts/build-client.mjs 内联进 bundle 的工厂作用域，"外部作用域"=
 * 同一 prelude / src/client.js 的顶层）：
 *   · 每个渲染器**只从一个参数取外界**：`(ctx)`。函数体**逐字搬入**，唯一改动是开头那段
 *     解构 —— 于是"这个页签要什么"写在签名处，"怎么画"一行没动（模板字符串里的有效空白
 *     也不会被批量重排弄坏）。
 *   · ctx 由 `WallpaperPicker` 在调用点就地组装（见 src/client.js 的 `renderActiveTab`）：
 *     面板的 `sel` / 页签需要的局部视图状态 / 处理器。**多传字段无害，漏传会当场
 *     ReferenceError**（守卫会抓住）—— 这是刻意选的失败方式：响亮且可定位。
 *   · 页签**只做"读 + 组装 React 树"**，四类越界由 `test/verify-client.mjs` 的接缝判据钉住
 *     （与 `src/picker-modal.js` / `src/picker-props-panel.js` **同一条口径**）：
 *       ① 不得引用 `selection`（写入经 ctx 的 `setSetting` / `setTransient` 两个入口）；
 *       ② 不得调 `emit(`（通知归处理器）；
 *       ③ 不得改写 **ctx 别名**指向的东西（`editing` = `selection.editing`、`sel` = store 快照…）
 *          —— `editing.name = …` 是"渲染器成了状态的写入方"，那不是读；
 *       ④ 不得改写**模块级状态**（`propsPanelOpen` / `pickerFocusPending` / `pickerOpener` …）。
 *     ③④ 两类**不是风格问题**：它们不含 `selection.` 字面量，因此躲得过"只数字面量"的判据 ——
 *     那正是本文件长期违规却一直没变红的原因（同一批搬出去的另外两个渲染器早就在严口径下）。
 *   · **动作经具名处理器**：除写设置外还要做别的事（重建层 / 清失败记忆 / 重绘 / 刷库存…）
 *     一律收口成 `src/client.js` 里的 `on*` 处理器，经 ctx 传进来；页签只写 `onClick: onFoo`。
 *     于是"点了会发生什么"住在处理器里，页签只回答"画什么"。
 *   · 模块级依赖（React / SliderRow / switchRow / ctlText / FRAME_VARIANTS / 各类预设表 /
 *     纯函数如 `weT` / `adapterCaps` / `liveRenderEnabled`…）仍按内联规则直接读，不经过 ctx
 *     —— 它们是常量与纯组件/纯函数，与面板状态无关。**判据只盯状态与动作，不盯这些。**
 *   · 本文件必须保持浏览器安全（无 import / require / Node API），且**不得有顶层可执行语句**
 *     读 client.js 的 const（会被内联到 bundle 顶部，撞 TDZ）。
 *
 * 把五个域的**节渲染器**按域搬进同族兄弟模块（构建期内联在本文件之前，
 * 见 scripts/build-client.mjs 的 INLINE_MODULES）：src/panel-tabs-wallpaper.js /
 * -appearance.js / -mascot.js / -effects.js / -advanced.js。本文件只留八个 render*Tab
 * （守卫与 src/client.js 的调用点都按名字取它们，导出名必须在**本文件**里有绑定）与
 * extensionModules()。搬出的 render*Section / renderMascotFormCards / renderFont* 等
 * 仍是同一工厂作用域的自由名字（打包后同作用域；按文件 import 的台架按既有口径挂全局）。
 * **接缝四类越界的判据扫的是全族并集**（test/verify-client.mjs 的 RENDERERS 表 +
 * test/tools/src-scope.mjs 的 panelText()），搬出去不等于搬出判据。
 */

/**
 * 可见面判据的**本地包装**（同 `avatar-layer.js` 的口径）：本文件可被**独立求值**
 * （判据逐页签抽函数真跑），因此不裸引用拼接作用域里的 `weComponentVisible`，改读
 * `globalThis.__weComponentVisible`（`src/client.js` 启动时注入）；缺省 `true` = 不渲染（D3① 安全方向）。
 */
function weComponentVisibleOf(components, name) {
  const f = globalThis.__weComponentVisible;
  // 缺省 **true**（未知 ⇒ 按可用渲染）：注入缺失只可能是接线疏漏或独立求值上下文，
  // 那种情况下"把整个面板藏掉"是更坏的失败；生产侧 src/client.js 启动时必定注入。
  return typeof f === 'function' ? f(components, name) : true;
}

  // 这一层只**按顺序组装**各节（"有哪几节、什么顺序"一眼可读；
  // 判据按真渲染的节序列钉住，见 verify-scene-live 的节顺序一节）。
  // 首行空解构是**契约**（test/verify-scene-live.mjs 的『每个页签首行都从 ctx 解构』）：
  // 本页签只把 ctx **转交**给各节、自己不读字段 —— 所以那不是无操作声明，是"要什么写在签名处"。
  function renderWallpaperTab(ctx) {
    const { } = ctx;
    return React.createElement(React.Fragment, null,
      renderWallpaperCurrentSection(ctx),
      renderWallpaperTransitionSection(ctx),
      renderWallpaperRotationSection(ctx),
      renderWallpaperUploadsSection(ctx),
    );
  }


  // 这一层只**按顺序组装**各节（"有哪几节、什么顺序"一眼可读；
  // 判据按真渲染的节序列钉住，见 verify-scene-live 的节顺序一节）。
  // ⚠️ 这个顺序是**两个界面共用的**（侧边栏的 `qpRenderAppearancePane` 调的也是本函数）
  //    ⇒ 改这里等于同时改设置页与侧边栏 —— 这正是用户口径要的"两边同序"。
  // 用户口径：主题 → 细节 → 玻璃 UI → 侧边栏圆角 → 全局 UI 配色 → 全局字体。
  // 与上一版的差别只有一处：**「玻璃 UI」与「侧边栏圆角」对调**（前者上移到细节之后）。
  // 首行的空解构是**契约**（test/verify-scene-live.mjs 的『每个页签首行都从 ctx 解构』）：
  // 本页签只把 ctx 转交给各节、自己不读字段 —— 所以那不是无操作声明。
  function renderAppearanceTab(ctx) {
    const { } = ctx;
    // 第六节「全局字体」在 P-C 之后**住在 packages/fonts**（子包把渲染器登记进
    // src/extension-registry.js 的面板节注册表）⇒ 这里按注册表续接，屏上位置仍**在最后**
    //（描述符不写 `order` ⇒ 落到默认位 100；顺序口径与 extensionModules() 同源）。
    // ⚠️ 注册表为空 = 该子包没装 / 被关：页签照画前五节，**不**整页签消失
    //    （D3①/D3③ 在这条通道上的形态：缺的是那一节，不是这一页）。
    const registered = wePanelSectionsOf("appearance").map((section) => (
      React.createElement(React.Fragment, { key: section.id }, section.render(ctx))
    ));
    return React.createElement(React.Fragment, null,
      renderAppearanceThemeSection(ctx),
      renderAppearanceDetailSection(ctx),
      renderAppearanceGlassSection(ctx),
      renderAppearanceSidebarCornersSection(ctx),
      // 「全局 UI 配色」在「全局字体」**上面**（用户口径：「变成全局UI配色放在全局字体上面」）；
      // 原「输入光标」节已撤销，其唯一一行（光标颜色）并入本节（见该渲染器的 ③）。
      renderAppearanceUiColorSection(ctx),
      registered,
    );
  }


  // 模块级 ↺ 的**薄包装**（issue #192）：真实现住在 `src/module-reset.js`（panel-tabs 与
  // glass-panel 共用，抽出来才能让挂载台 import 真实现）。这里只把"取词 + 处理器"两样外界
  // 喂给它 —— 中文因此留在本文件的 `weT(...)` 里（i18n 扫描器认这个形态；写进被调模块会
  // 被判成"裸中文"），各节调用点则保持 `moduleResetButton("模块名", onResetModule)` 这么短。
  // ⚠️ 必须是**本文件的模块级（工厂作用域）声明**，不能留在 `renderAppearanceTab` 体内：
  //    五个域模块（src/panel-tabs-*.js）按域搬出后仍按这个名字引用它 —— 打包后同一工厂
  //    作用域没问题，但按文件 import 的守卫台架（verify-fontset / verify-scene-live 的
  //    侧栏档）只有把真实现挂到全局才找得到。
  function moduleResetButton(moduleName, onResetModule) {
    return moduleResetButtonNode(moduleName, onResetModule, {
      title: weT("把这一块的参数恢复为默认值（不需要确认）"),
      aria: weT("重置本模块"),
    });
  }

  function renderAudioTab(ctx) {
    const { onToggleAudio, onVideoVolume, sel } = ctx;
    // 声音：壁纸音轨（视频 / 场景内嵌 MP4 / 场景包内音频共用一套设置）。
    // 系统音频反应 / 媒体信息 / 在线歌词三键**恒为常开**（schema kind 'const'）：
    // 面板不提供页面定义，运行时两侧一律按默认接入读值。
    return React.createElement(React.Fragment, null,
      React.createElement("div", { className: "we-picker__section" },
        React.createElement("div", { className: "we-picker__section-head" },
          React.createElement("span", { className: "we-picker__section-label" }, weT("声音")),
        ),
        SliderRow(weT("音量"), 0, 100, 5,
          Math.round((Number(sel.videoVolume) || 0) * 100), onVideoVolume,
          Math.round((Number(sel.videoVolume) || 0) * 100) + "%"),
        switchRow(weT("壁纸音轨"), sel.videoAudioEnabled !== false, () => onToggleAudio(), {
          hint: weT("关闭=静音（保留音量数值）· 开启时音量 0 自动 50%"),
          tooltip: weT("视频壁纸与场景壁纸（内嵌 MP4 音轨 / 包内独立音频）共用；默认静音，开启时若音量为 0 会自动提到 50%"),
        }),
      ),
    );
  }


  function renderMascotTab(ctx) {
    const { onRopeScaleChange, onRopeVisibilityChange, onMascotFormConfirm, onDisarmConfirm, sel, paneWidth } = ctx;
    // ── D3 可见面 gate（ADR-0013 D3①/D3③）：该组件行关掉 ⇒ **整块不渲染**（返回 null，
    // 界面不显示；配置项由调用方按同一判据隐藏）。判据：test/verify-component-visibility.mjs
    // 的"声明落点必须被 gate"双向对账。唯一实现在 src/client.js 的 weComponentVisible。
    if (!weComponentVisibleOf(ctx.sel && ctx.sel.inventory && ctx.sel.inventory.components, 'mascot-avatar')) return null;
    // 主页面那只吉祥物**当前用的立绘**（自定义优先 / 否则内置形态）—— 与 RopeDock 共用
    // 同一条解析（`ropeArtOf`）：设置页看到的盒与主页面那只的盒必须是同一个数。
    const previewArt = ropeArtOf(sel);
    const customArt = previewArt.custom;
    // 自定义立绘卡片的舞台盒 = 内置卡里最高的那张（Deepseek_Pro 64×96）的盒 ——
    // "同样的卡片大小和样式"（用户口径）在这条链上就落到这两个数上。
    const boxW = 64, boxH = 96;
    // 卡面舞台：把当前立绘等比缩进 64×96（与最高的内置卡「Deepseek_Pro」同一个盒）——
    // 保持宽高比，直接夹住某一边会把长竖图压成方的，看到的就不是那只吉祥物的形状了。
    const previewFit = Math.min(1, boxW / previewArt.w, boxH / previewArt.h);
    // 没导入时占位就是整块舞台（虚线框 + 一个加号），导入后图片按自己的比例缩进它。
    const previewW = customArt ? Math.max(1, Math.round(previewArt.w * previewFit)) : boxW;
    const previewH = customArt ? Math.max(1, Math.round(previewArt.h * previewFit)) : boxH;
    return React.createElement(React.Fragment, null,
      // ── 吉祥物：形态卡片固定基础尺寸（「吉祥物大小」只作用于主页面），开关总控 ──
      React.createElement("div", { className: "we-picker__section" },
        React.createElement("div", { className: "we-picker__section-head" },
          React.createElement("span", { className: "we-picker__section-label" }, weT("聊天吉祥物")),
        ),
        switchRow(weT("显示吉祥物"), sel.ropeShown !== false, onRopeVisibilityChange, {
          key: "rope-shown",
          hint: weT("关闭后隐藏吉祥物与壁纸仓库抽屉"),
          tooltip: weT("关闭后隐藏吉祥物与壁纸仓库抽屉；可随时在本页重新开启"),
        }),
        // ── 自定义立绘（用户口径：可导入，已导入时下一次导入覆盖上一次）──────────
        // 它是**转盘（3D 环）上的最后一项**（用户口径：与内置立绘同样的卡片大小和样式）——
        // 点它导入 / 替换（再导入即覆盖），正在用时是 `--active` 那一项；内置项**不因**自定义
        // 生效而禁用（并入 #180 之后：点内置项 = 两步确认换回出厂自带，见
        // `onMascotFormConfirm`），只有导入进行中才禁用（`disabled: mascotBusy`）。
        // 卡面尺寸口径与内置项一致（固定，不随「吉祥物大小」缩放）：图片按自己的宽高比
        // contain 进 64×96 的小舞台（那是最高的内置项「Deepseek_Pro」的盒）。清除入口排在最后。
        renderMascotFormCards(sel, previewArt, previewW, previewH, onRopeFormChange, onMascotPick, onMascotClear, onMascotFormConfirm, onDisarmConfirm, paneWidth),
        sel.mascotError
          && React.createElement("div", { className: "we-picker__hint we-avatar-error", key: "rope-custom-err" }, sel.mascotError),
        SliderRow(weT("吉祥物大小"), ROPE_SCALE_MIN, ROPE_SCALE_MAX, ROPE_SCALE_STEP,
          sel.ropeScale, onRopeScaleChange, Math.round(sel.ropeScale * 100) + "%", "rope-scale"),
      ),
    );
  }


  // 这一层保留"空态提前返回 + 唯一的节外壳"，把**节里的内容**按块分给子渲染器；
  // "有哪几块、什么顺序"一眼可读（细锚按真渲染的**控件标签有序序列**钉住，见 verify-scene-live）。
  function renderEffectsTab(ctx) {
    const { sel, setPickerOpener, onOpenPicker, onPickWallpaper, surface } = ctx;
    const sidebarSurface = surface === "sidebar";
    if (!sel.id) {
      return React.createElement("div", { className: "we-picker__empty" },
        React.createElement("span", { className: "we-picker__empty-title" }, weT("还没有启用壁纸")),
        React.createElement("span", { className: "we-picker__hint" },
          weT("选择一款壁纸后，可在这里调整模糊、亮度、适配、倍速等效果")),
        React.createElement("button", {
          className: "we-picker__btn we-picker__btn--primary", type: "button",
          ref: sidebarSurface ? undefined : setPickerOpener,
          onClick: sidebarSurface ? onPickWallpaper : onOpenPicker,
        }, sidebarSurface ? weT("去挑一张 ›") : weT("选择壁纸")),
      );
    }
    return React.createElement(React.Fragment, null,
      React.createElement("div", { className: "we-picker__section" },
        React.createElement("div", { className: "we-picker__section-head" },
          React.createElement("span", { className: "we-picker__section-label" }, weT("画面")),
        ),
        renderEffectsSlidersSection(ctx),
        renderEffectsLiveSection(ctx),
        renderEffectsSourceSection(ctx),
        renderEffectsPlaybackSection(ctx),
        renderEffectsFitSection(ctx),
      ),
    );
  }

  // 这一层只**按顺序组装**各节 —— 于是"这个页签有哪几节、什么顺序"
  // 一眼可读（判据按真渲染的节序列钉住，见 verify-scene-live 的节顺序一节）。
  // 首行的空解构是**契约**（test/verify-scene-live.mjs 的『每个页签首行都从 ctx 解构』）：
  // 本页签只把 ctx 转交给各节、自己不读字段 —— 所以那不是无操作声明。
  function renderAdvancedTab(ctx) {
    const { } = ctx;
    return React.createElement(React.Fragment, null,
      renderAdvancedBrowsingSection(ctx),
      renderAdvancedCompatSection(ctx),
      renderAdvancedAdapterSection(ctx),
      renderAdvancedPowerSection(ctx),
      renderAdvancedCacheSection(ctx),
      renderAdvancedDiagSection(ctx),
    );
  }
  // ── 「扩展」页签：后续功能的**模块容器** ─────────────────────────────────────
  // 这一页刻意只放一张**注册表**：加一个功能 = 往 EXTENSION_MODULES 里加一项，页签本身
  // 不用改（"接下来的功能追加都以模块形式放在该 tab 下"是用户的明确口径，见 CHANGELOG）。
  // 注册表为空时页签照旧在、只画空态 —— 页签栏是稳定的，用户不会因为"现在还没有模块"
  // 就找不到这一页的入口。
  //
  // 每一项的**描述符住在它自己的 src/<语义名>.js 里**（渲染器不膨胀）。取用一律走下面这个
  // **惰性**函数：顶层直接写 `const EXTENSION_MODULES = [SYMBOL]` 会踩两个坑 ——
  //   ① 内联后 prelude 求值期就要读兄弟模块的常量，模块顺序成了隐式契约；
  //   ② test/verify-scene-live.mjs 是**单独 import 本文件**、再喂 `globalThis` 的，
  //      顶层一引用别处的符号就当场 ReferenceError。
  // 写成函数后两个坑都没了：求值发生在"画这一页"的时候，那时兄弟模块早就内联好了。
  //
  // 模块形状（给未来加功能的自己）：
  //   { id, title, desc?, render? }
  //   · `id`    React key，稳定且唯一；
  //   · `title` / `desc` 取到的就是**译文**（描述符里写成 getter，见下）。写法上有个硬约束：
  //     **不能直接写成 `title: "…"`** —— 那在 test/verify-i18n.mjs 的判据 ① 里是
  //     "没进 weT(...) 的裸中文"；也不能写成顶层 `title: weT("…")`，那会在内联后的
  //     prelude 求值期撞 TDZ。既有写法是**getter**：
  //       get title() { return weT("点击效果与拖尾效果"); }
  //     这样 `weT(...)` 就落在字面量的最内层调用帧上，且取译文发生在渲染时（照抄
  //     packages/fx/src/ext-fx.js 的 FX_EXTENSION_MODULE 即可）—— 因此**本文件不再套一层
  //     weT**（套了就成了拿译文再查一次词表）。
  //   · `render(ctx)` 可选：给了就在这个模块的位置画它自己的控件；没给就只显示
  //     title + desc —— "功能还没做完"的模块可以先上架占位。
  //   · 模块**不得**自己写设置 / 发通知 / 持有状态：本文件是渲染器（契约见文件头），
  //     要动状态就把动作做成 src/client.js 的具名处理器、经 ctx 传进来。
  // 现有三项 —— **本文件不再枚举它们**（P-A 起）：
  //   一号 = 自定义会话头像（src/ext-avatar.js + src/avatar-layer.js，会话界面上的 DOM 补丁），
  //          **留在主包**，由 src/client.js 在模块作用域自登记；
  //   二号 = 点击效果与拖尾效果（packages/fx）、三号 = 3D 效果（packages/parallax）**各自
  //          是一个独立包** —— 三份 bundle 的求值顺序不保证，同一个工厂作用域里再也放不下
  //          一份"按数组顺序排好的清单"，于是"谁登记了什么"落在一张共享注册表上
  //          （src/extension-registry.js；跨包通道见 BUNDLE-SPLIT §6.2）。
  // ⚠️ **顺序即屏上顺序**：跨包顺序**不能**靠数组序（bundle 求值顺序不是契约），改由描述符的
  //    `order` 声明（avatar=1 / fx=2 / parallax=3），排序 = (order, 注册序)。
  //    加第四项 = 在它自己的包里调 `weRegisterExtensionModule(id, descriptor)`，本文件零改动。
  // 注册表为空时页签照旧在、只画下面那个空态（形状见 :230-252 的注释）。
  function extensionModules() {
    return weExtensionModules();
  }

  // 这一页自己不读 ctx 的任何字段：整包（sel + 具名 on* 处理器）转交给各模块的 render。
  // ⚠️ 判据口径：`const { … } = ctx;` 必须是函数体的**第一条语句**（前面连注释行都不许有），
  // 所以说明文字只能写在函数外面 —— 见 test/verify-scene-live.mjs 的『每个页签首行都从 ctx 解构』。
  function renderExtensionsTab(ctx) {
    const { onResetModule } = ctx;
    // ── D3 可见面 gate（ADR-0013 D3①/D3③）：该组件行关掉 ⇒ **整块不渲染**（返回 null，
    // 界面不显示；配置项由调用方按同一判据隐藏）。判据：test/verify-component-visibility.mjs
    // 的"声明落点必须被 gate"双向对账。唯一实现在 src/client.js 的 weComponentVisible。
    if (!weComponentVisibleOf(ctx.sel && ctx.sel.inventory && ctx.sel.inventory.components, 'mascot-avatar')) return null;
    const modules = extensionModules();
    return React.createElement(React.Fragment, null,
      React.createElement("div", { className: "we-picker__section" },
        React.createElement("div", { className: "we-picker__section-head" },
          React.createElement("span", { className: "we-picker__section-label" }, weT("扩展模块")),
        ),
        React.createElement("div", { className: "we-ext" },
          modules.length === 0
            ? React.createElement("div", { className: "we-picker__empty" },
                React.createElement("span", { className: "we-picker__empty-title" },
                  weT("还没有可用的扩展模块")),
                React.createElement("span", { className: "we-picker__hint" },
                  weT("后续新增的功能会以模块形式收在这里，每个模块自带它的控件")),
              )
            : modules.map((mod) => React.createElement("div", {
                key: mod.id, className: "we-ext__module",
              },
                React.createElement("div", { className: "we-ext__module-head" },
                  React.createElement("span", { className: "we-ext__module-title" }, mod.title),
                  moduleResetButton(mod.resetGroup, onResetModule),
                ),
                mod.desc ? React.createElement("span", { className: "we-picker__hint" }, mod.desc) : null,
                mod.render ? mod.render(ctx) : null,
              )),
        ),
      ),
    );
  }

  // ── 「关于」页签：项目简介 / 仓库与 Star / 交流群二维码 / 贡献者致谢（压尾）──────
  // 内容全是静态文案 + 两张内联二维码（数据在 src/about-assets.js，构建期随 prelude
  // 内联）；**唯一的外部能力**是 `ctx.onReopenNotice`（「重新查看更新公告」按钮）。
  // 它不是"读面板状态"：状态写入与 emit 都发生在 client.js 那一侧（回调体内），本渲染器
  // 只读模块级真值 + 调一个交进来的回调 —— 这正是 test/verify-about.mjs 那条
  // "渲染器只读模块级状态（不自己发请求 / 不写设置 / 不发通知）"允许的形状。
  // 契约是**逐页签**的 —— verify-scene-live 要求每个 render*Tab 首行从 ctx 解构
  //（"要什么"写在签名处），所以这里显式解构出那一个回调。
  // 四段的**顺序**是用户的明确口径（致谢压尾），判据按首次出现下标比大小钉住。
  function renderAboutTab(ctx) {
    const { onReopenNotice } = ctx;
    // ── D3 可见面 gate（ADR-0013 D3①/D3③）：该组件行关掉 ⇒ **整块不渲染**（返回 null，
    // 界面不显示；配置项由调用方按同一判据隐藏）。判据：test/verify-component-visibility.mjs
    // 的"声明落点必须被 gate"双向对账。唯一实现在 src/client.js 的 weComponentVisible。
    if (!weComponentVisibleOf(ctx.sel && ctx.sel.inventory && ctx.sel.inventory.components, 'about-notice')) return null;
    // star 数那一行（模块级：值 + 三态文案都在 client.js 的 starCountLabel 里；
    // 这里的"读"与 SliderRow 一类模块级助手同口径 —— 只读，不发请求）。
    const stars = starCountLabel();
    // 两张码的参数表：图（路由 URL）/ 图题 / 替代文本 / 一句话说明。渲染一次 map 两遍，
    // 免得两段几乎一样的 createElement 各自演化（改一处忘一处正是这类页面最容易烂的地方）。
    const qrCards = [
      {
        key: "qq",
        title: weT("🐧 QQ 群 · DSHWE | LLM 讨论群"),
        // 图本体是随包 PNG（lib/about/），这里只给路径 —— apiUrl 补 BASE 前缀。
        src: apiUrl(ABOUT_QR_QQ_PATH),
        alt: weT("QQ 群二维码"),
        hint: weT("手机 QQ 扫码加入 · 群里见 👋"),
      },
      {
        key: "douyin",
        title: weT("🎵 抖音群 · dsh 交流群"),
        src: apiUrl(ABOUT_QR_DOUYIN_PATH),
        alt: weT("抖音群二维码"),
        hint: weT("抖音扫码加入 · 群号 252729465001"),
      },
    ];
    // 贡献者致谢逐条列出（名字 / 做了什么）——「谢谢」要能落到具体的人身上，
    // 一句笼统的"感谢所有贡献者"没有信息量。
    const credits = [
      weT("🧩 oneincase —— 内置 WebWallGL 实时渲染引擎与 media-bridge 媒体中间件的作者：场景 / 网页壁纸的实时渲染，以及 Windows / macOS / Linux 三平台的原生媒体链路，都建立在它们之上"),
      weT("🛠️ YV3507 —— 提交量最大的贡献者：从早期场景渲染器起步，到静态帧系列修复、液态玻璃令牌体系、实时帧链路与多轮大型重构，几乎每个里程碑都有他"),
      weT("🎨 yuxilao —— scene-gl 的 Linux 实时渲染管线（WebGL2 官方 shader 驱动）、轮换交接与 GPU 帧回填"),
      weT("🍎 Jerry —— 在三平台原生支持落地之前，macOS 侧的适配与贡献路径由他维护"),
      weT("🌟 还有 SiriLee、libiwolve、0-007pro、jujubaoj646-star、xiahou001、wilianyichen、hecoococ、ShamSky88、Rekk0、Y1X1n 等贡献者，以及所有通过 issue 反馈与 PR 参与改进的朋友 —— 谢谢你们！"),
    ];
    return React.createElement(React.Fragment, null,
      // ── ① 项目简介 ──
      React.createElement("div", { className: "we-picker__section" },
        React.createElement("div", { className: "we-picker__section-head" },
          React.createElement("span", { className: "we-picker__section-label" }, weT("📖 项目简介")),
        ),
        React.createElement("div", { className: "we-about__lead" },
          React.createElement("div", { className: "we-about__lead-title" }, weT("🖼️ 壁纸引擎 · 让 DSH 的背后动起来")),
          React.createElement("p", { className: "we-about__p" },
            weT("把 Wallpaper Engine 的壁纸搬到 DSH 界面后面：视频直接播放，场景（Scene）与网页（Web）壁纸由内置的 WebWallGL 引擎实时渲染，再配上一整套液态玻璃界面改造 —— 你桌面上那张会动的画，现在就在对话背后放着。🎬✨")),
          React.createElement("p", { className: "we-about__p" },
            weT("壁纸全部来自你自己的机器（本机库 / WE 工程目录 / 手动上传），插件不联网也能用，更不会把它们传到任何地方。🔒")),
        ),
      ),
      // ── ② 仓库与 Star ──
      React.createElement("div", { className: "we-picker__section" },
        React.createElement("div", { className: "we-picker__section-head" },
          React.createElement("span", { className: "we-picker__section-label" }, weT("⭐ 开源与支持")),
        ),
        React.createElement("p", { className: "we-about__p" },
          weT("项目以 MIT 协议开源、完全免费。如果它让你的 DSH 好看了一点点，去仓库点一颗 ⭐ 就是最直接的鼓励～")),
        React.createElement("div", { className: "we-about__star-row" },
          React.createElement("a", {
            className: "we-picker__btn we-picker__btn--primary we-about__star",
            href: ABOUT_REPO_URL,
            target: "_blank",
            rel: "noopener noreferrer",
            title: weT("在浏览器里打开项目仓库"),
          }, weT("⭐ 去 GitHub 点亮 Star")),
          // 实时 star 数：宿主代取（带缓存，见 packages/about-notice/lib/routes/github-stars.js）。
          // 取不到时**整行不消失**、改说"暂时取不到" —— 数字是点缀，按钮才是主操作。
          stars
            ? React.createElement("span", {
                className: "we-about__stars",
                title: weT("来自 GitHub API 的实时数据（带缓存；拉不到时显示上一次取到的值）"),
              }, stars)
            : null,
        ),
        React.createElement("div", { className: "we-about__url-row" },
          React.createElement("span", { className: "we-picker__hint" }, weT("🔗 仓库地址（按钮打不开时可手动复制）：")),
          // 可选中、可整段复制的裸地址：桌面壳里外链能否唤起浏览器不由插件说了算，
          // 这条是给"点了没反应"的场景留的兜底（同字体集导出的"普通链接"口径）。
          React.createElement("code", { className: "we-about__url" }, ABOUT_REPO_URL),
        ),
        // 「重新查看本版更新公告」：公告的哨兵 `noticeSeen` 让它**一版只弹一次** ⇒ 不给一条
        // 重看路径的话，用户"想再看这版改了什么"就只能去改设置文件。
        // ⚠️ 只调回调（`ctx.onReopenNotice`）：状态写入与 emit 都在 client.js 那一侧 ——
        // 本渲染器因此保持"只读模块级状态"（判据见文件头那段说明）。
        // 与上面那枚 Star 按钮**同放一节**是有意的：它们是同一件事的两个面（公告配图下那行
        // 也是同一个求星入口，见 src/client.js 的 UpdateNotice）。
        React.createElement("button", {
          className: "we-picker__btn we-about__reopen", type: "button",
          onClick: () => { if (typeof onReopenNotice === "function") onReopenNotice(); },
          title: weT("再弹一次本版更新公告（含配图下方的求星入口）"),
        }, weT("重新查看本版更新公告")),
        React.createElement("p", { className: "we-about__p" },
          weT("想要新功能、遇到问题，或者想看看接下来要做什么，都欢迎来仓库提 Issue / PR —— 一起把它做得更好 🧰")),
      ),
      // ── ③ 交流群（两张二维码）──
      React.createElement("div", { className: "we-picker__section" },
        React.createElement("div", { className: "we-picker__section-head" },
          React.createElement("span", { className: "we-picker__section-label" }, weT("💬 加入交流群")),
        ),
        React.createElement("p", { className: "we-about__p" },
          weT("卡住了、想吐槽、或者想第一时间拿到新版本，都欢迎来群里找我们 👋")),
        React.createElement("div", { className: "we-about__qr-row" },
          qrCards.map((c) => React.createElement("figure", { key: c.key, className: "we-about__qr" },
            React.createElement("figcaption", { className: "we-about__qr-title" }, c.title),
            React.createElement("img", {
              className: "we-about__qr-img",
              src: c.src,
              alt: c.alt,
              draggable: false,
            }),
            React.createElement("figcaption", { className: "we-about__qr-hint" }, c.hint),
          )),
        ),
      ),
      // ── ④ 贡献者致谢（**压尾**：用户口径——先讲清"这是什么、去哪支持、怎么找我们"，
      //    最后再把功劳簿摆出来。💌 那句收尾也并进这一段，页面结束在"谢谢"上。）──
      React.createElement("div", { className: "we-picker__section" },
        React.createElement("div", { className: "we-picker__section-head" },
          React.createElement("span", { className: "we-picker__section-label" }, weT("🙏 贡献者致谢")),
        ),
        React.createElement("p", { className: "we-about__p" }, weT("这个插件是许多人一起做出来的成果，谢谢他们：❤️")),
        React.createElement("ul", { className: "we-about__credits" },
          credits.map((line, i) => React.createElement("li", { key: "credit-" + i, className: "we-about__credit" }, line)),
        ),
        React.createElement("p", { className: "we-about__p" }, weT("也谢谢上游 Wallpaper Engine 生态与 DSH 官方插件的作者们 —— 站在你们的肩膀上。🙇")),
        React.createElement("p", { className: "we-about__p we-about__foot" },
          weT("💌 感谢每一位使用者 —— 换上你喜欢的那张壁纸，这个插件就没白写。")),
      ),
    );
  }


  // ── 页签级重置（issue #192 用户口径：「每个选项卡后面加重置，重置指定选项卡」）──────────
  // 压在**每个页签内容的最末尾**，由 client.js 的渲染点在 renderActiveTab() 之后统一挂 ——
  // 六处渲染器各挂一遍必然漏一个，挂一处才是结构性的。
  // 走两步确认：整页设置量不小（外观页就有 60 个键）且不可撤销 ⇒ 与模块级 ↺ 分档
  //（那是单模块、用户口径明确"无需确认"）。令牌按页签区分，因为 `armedConfirm` 是单值。
  function renderTabReset(ctx, tabId) {
    const { armedConfirm, onArmConfirm, onDisarmConfirm, onResetTab } = ctx;
    // 「关于」页签没有任何设置（纯静态文案）⇒ 不给它画一个点了没反应的按钮。
    if (tabId === "about") return null;
    const token = "tab:" + tabId;
    // ⚠️ 刻意**不用** `we-picker__section-label`：那是"设置分组卡"的类名，而本节的判据口径
    //（既有守卫按"末三张分组卡"取窗口）会被这一节顶掉 —— 3D 效果那一页就有三张分组卡，
    // 重置节排在它后面会挤走「背景」。它是**操作区**不是分组卡，用独立类名在语义上也更准。
    const cls = "we-picker__section-reset-label";
    return React.createElement("div", { className: "we-picker__section" },
      React.createElement("div", { className: "we-picker__section-head" },
        React.createElement("span", { className: cls }, weT("重置本页")),
      ),
      React.createElement("span", { className: "we-picker__hint" },
        weT("把这一页的设置恢复为默认值；其他页签与导入的图片不受影响。")),
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("button", {
          className: "we-picker__btn",
          type: "button",
          disabled: armedConfirm === token,
          onClick: () => onArmConfirm(token),
        }, weT("重置本页")),
      ),
      renderConfirmRow(armedConfirm, token,
        weT("确定要把这一页的设置恢复为默认吗？此操作不可撤销。"),
        () => onResetTab(tabId), onDisarmConfirm),
    );
  }

  // ── 全局重置节（issue #192，压在「系统」页签末尾）──────────────────────────────
  // 三档里的最高一档：**模块 < 页签 < 全局**。全局必须二次确认（不可撤销）。
  // 二次确认复用 client.js 既有的 `armConfirm` / `renderConfirmRow` 两步构件 ——
  // `selection.armedConfirm` 是单值 ⇒ 结构上同一时刻只有一个动作待确认。
  // ⚠️ 只重置**设置值**：导入的头像图 / 吉祥物立绘 / 字体集住各自的目录，删不删是另一件事
  //（文案必须把这一点说清，否则用户会以为"重置"连图一起删了）。
  function renderResetSection(ctx) {
    const { armedConfirm, onArmConfirm, onDisarmConfirm, onResetAll } = ctx;
    const token = "resetAll";
    return React.createElement("div", { className: "we-picker__section" },
      React.createElement("div", { className: "we-picker__section-head" },
        // 同 renderTabReset：操作区不用「设置分组卡」那个类名（它会被"末三张分组卡"那类
        // 位置口径的判据看见，挤掉真正的分组卡）。
        React.createElement("span", { className: "we-picker__section-reset-label" }, weT("重置")),
      ),
      React.createElement("span", { className: "we-picker__hint" },
        weT("把全部设置恢复为出厂默认值；导入的头像与吉祥物图片、字体集不受影响。此操作不可撤销。")),
      React.createElement("div", { className: "we-picker__row" },
        React.createElement("button", {
          className: "we-picker__btn we-picker__btn--danger",
          type: "button",
          disabled: armedConfirm === token,
          onClick: () => onArmConfirm(token),
        }, weT("全部重置")),
      ),
      renderConfirmRow(armedConfirm, token,
        weT("确定要将所有设置恢复为默认吗？此操作不可撤销。"),
        onResetAll, onDisarmConfirm),
    );
  }

export {
  renderWallpaperTab, renderAppearanceTab, renderAudioTab, renderMascotTab, renderEffectsTab, renderAdvancedTab,
  renderExtensionsTab, renderAboutTab, renderResetSection, renderTabReset,
  // 模块级 ↺ 的薄包装：域模块（-appearance / -effects / -mascot）的节头按工厂作用域自由名字引用它
  // （打包后同作用域）。导出它只为让**按文件 import 的守卫台架**能挂上真实现，
  // 不是新公共 API；bundle 侧无消费者（内联后同作用域）。
  moduleResetButton,
};
