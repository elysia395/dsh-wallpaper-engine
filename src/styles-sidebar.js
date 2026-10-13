/**
 * styles-sidebar.js —— 样式域模块 **SIDEBAR**（原 src/styles.js 第 1135–1622 行，共 488 行）。
 *
 * 内容：侧栏 —— 左侧栏液态玻璃 · 四角圆角 · 标题栏玻璃与其模糊层 · better-sidebar glass · 官方右侧栏 · 内容面。
 *
 * 拼装契约（样式族 9 个模块共享，组装点见 src/styles.js）：
 *   · 构建期按 INLINE_MODULES 顺序把族内文件**原样内联进同一工厂作用域**，模块之间不 import，靠扁平符号协作
 *     （见 docs/CODE-STRUCTURE.md §3）；
 *   · 本段模板的开引号紧跟本段首行（不另起一行）；段间那一个换行由上一段的收尾换行提供；
 *     本段自身以换行收尾（下一段接着写）；
 *   · 组装点按 BASE → SHELL → SIDEBAR → CHROME → SETTINGS → PANEL → QUICK → EXT 相加 ⇒ 拼出的 CSS 与原单模板
 *     **逐字节相同**（分割前 sha256 前缀 3b6c41dc7dcab44bf5c57f4 · 262306 B）。
 *
 * ⚠️ 本文件（注释与正文）不得出现裸反引号，也不得复述任何样式表声明语句的字面量：守卫按行首的域模板
 *    声明从**产物**里抽取模板，散文里出现同样的字面量或反引号会把锚点带偏。
 *
 * 契约：需要的外界**无**；对外提供本域的样式表常量。不变量：浏览器安全（无 import / require / Node API）、
 * 不得有顶层可执行语句去读宿主状态（内联位置早于 client.js 正文）、整体是**纯数据**。
 */
const CSS_SIDEBAR = `  /* ── 左侧栏液态玻璃（宿主原生左栏的玻璃接管，默认关）────────────────────────────
     原生左栏（会话列表 / 工作区那一列）在壁纸下只是**透明的洞**（本插件把
     --dsw-specific-sidebar-fill 置为 transparent），没有霜、没有底色 —— 主题那套
     「配色 / 玻璃颜色 / 玻璃透明度 / 雾化 / 边框」一个都到不了它。开关
     （body[data-we-left-sidebar]，设置键 leftSidebarGlass，默认关）给它挂上**与其余面板
     同一张配方表**：玻璃颜色（钳制后可读性底色）@ 玻璃透明度 压在可读性下限之上 +
     雾化（--we-blur）+ 边框（竖分割线）+ 配色（选中 / 悬停行、徽标、焦点环的高亮映射）。
     ⚠️ 门控是「页面玻璃锚点 + 本开关」两个：配方与有没有壁纸无关（无壁纸时这一列压着的
     是宿主自己的基色，同一张配方表照旧算出可读底色），壁纸在场只是让它重新"透出画面"。

     锚点：这一列**只有 CSS 模块哈希类名**（构建哈希，跨版本漂移，不得使用）。可钉的是
     **座位锚**：slot 渲染器给每个出口盖章 data-slot="<slotKey>"，左栏那个座位的出口
     div[data-slot="sidebar"] 正是这一列的**直接子元素** ⇒ 用 :has() 反向选中父元素。
     ⚠️ 不能把玻璃画在出口锚自己身上：它带 display:contents（座位渲染器的 ANCHOR_STYLE），
     **不生成盒子**，背景 / 模糊 / 边框全都画不出来。
     ⚠️ 子选择器（>）是刻意的：写宽一档会连带匹配到"任何祖先链里有该锚点"的元素。

     ── 修正（issue #131）：fixed 包含块 ─────────────────────────────────────
     CSS 规范：非 none 的 backdrop-filter 会让该元素成为**其后代 position:fixed 元素的
     包含块**。宿主在 Windows 标题栏模式下把「收起 / 展开侧边栏」按钮与收起态的「新建会话」
     按钮设成 position:fixed ⇒ 若 blur 画在列自身，它们改为相对这一列定位（列上边被
     [data-windows-titlebar] 的 padding-top 推下去，收起时列宽 0 又带 overflow:hidden）
     ⇒ 按钮被整块裁掉、展开按钮「不可见」。
     修法：玻璃配方里**只把 backdrop-filter 那一对声明**搬到本列的 ::before（伪元素没有
     后代，永不成为 fixed 的包含块），列自身加 position:relative（只影响 absolute 的包含块
     选择）与 z-index:0（把 ::before 的 z-index:-1 圈在列内）。
     底色 / 釉光 / 边框 / 令牌留在列上：模糊作用在「底色 + 壁纸」的合成结果上，与「先滤
     壁纸再压底色」数学等价（模糊与滤镜都是线性算子，而这一列底色是中性色）。 */
  body[data-we-glass-page][data-we-left-sidebar] div:has(> [data-slot="sidebar"]) {
    position: relative; /* 只为给下面 ::before 那条规则提供定位参照（不影响 fixed） */
    z-index: 0; /* 把 ::before 的 z-index:-1 圈在这一列内部 */
    background-color: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-light, #ffffff) calc(var(--we-left-sidebar-alpha) * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    /* 顶层白光釉：与设置窗口同一道镜面渐变。它同时**顶掉**壳层 darwin 那条
       「淡蓝渐变 + fill 混色」的左栏背景（background-image 是同一长属性）。 */
    background-image: linear-gradient(180deg,
      rgba(255, 255, 255, var(--we-panel-sheen-a)) 0%,
      rgba(255, 255, 255, var(--we-panel-sheen-b)) 38%,
      rgba(255, 255, 255, var(--we-panel-sheen-c)) 100%);
    /* 模糊不在这里：backdrop-filter 会把这列变成 fixed 后代的包含块（见上），
       已移交给本列 ::before 的那条规则。 */
    /* 边框：这一列**内部**的描边（「新建会话」按钮、焦点环等）读 --dsw-alias-border-l3 ——
       壁纸令牌映射只接管了 l1/l2，故「边框」滑杆只作用于这一列里面的描边（这一条**保留**）。
       ⚠️ 这一列**自己的竖分割线不画**（现场口径："左侧边栏右边框线不要显示，即使全局设置了
       边框拉到了90%"）：这一列已经是一整块玻璃，再画一条竖线就把它与会话区切成两半。
       ⚠️ 必须是**显式 none**，不能只是删掉那行声明：非 darwin 壳层自己有一条读
       --dsw-alias-border-l3 的边框，删声明会让它在别的平台上回来。判据见
       verify-glass-compositing 的 S2（含"种回发丝线即判红"的负对照）。 */
    --dsw-alias-border-l3: rgba(180, 180, 180, var(--we-border-alpha, 0.35));
    border-right: none;
    /* 配色：与设置窗口同一组 accent 映射（选中 / 悬停行 = interactive-bg-hover，
       业务状态点 = state-business-primary，链接与强调文字 = brand-*），
       作用域只在这一列 —— 自定义属性沿 DOM 继承，出不去这一列的子树。 */
    --dsw-alias-interactive-bg-hover: color-mix(in srgb, var(--we-accent, #4f8cff) 14%, transparent);
    --dsw-alias-interactive-bg-hover-accent: color-mix(in srgb, var(--we-accent, #4f8cff) 18%, transparent);
    --dsw-alias-state-business-primary: var(--we-accent, #4f8cff);
    --dsw-alias-brand-primary: var(--we-accent, #4f8cff);
    --dsw-alias-brand-text: var(--we-accent, #4f8cff);
  }
  /* 玻璃的模糊层（issue #131）：::before 铺满这一列、压在内容之下（z-index:-1，父级
     z-index:0 把它圈在列内），只负责 backdrop-filter。它没有后代 ⇒ 不会成为任何
     fixed 元素的包含块，宿主那两个 fixed 按钮（收起/展开侧边栏、收起态新建会话）于是
     继续相对视口定位。深浅两色共用这一条（模糊配方本身不随主题分叉）。 */
  body[data-we-glass-page][data-we-left-sidebar] div:has(> [data-slot="sidebar"])::before {
    content: "";
    position: absolute;
    inset: 0;
    /* 圆角继承（外观 → 侧边栏圆角）：伪元素铺满整列，不给它 inherit 的话，列被改成圆角
       后这一层仍然方角外溢。列没有圆角时 inherit 得到 0，等于没有这条声明。 */
    border-radius: inherit;
    z-index: -1;
    pointer-events: none;
    -webkit-backdrop-filter: blur(var(--we-left-sidebar-blur)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
    backdrop-filter: blur(var(--we-left-sidebar-blur)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01);
  }
  /* 深色：同一张表、同一组层权重，只有玻璃色缺省与高亮mix 不同（与设置窗口深色那条同形）。 */
  body[data-ds-dark-theme][data-we-glass-page][data-we-left-sidebar] div:has(> [data-slot="sidebar"]) {
    background-color: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) calc(var(--we-left-sidebar-alpha) * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%));
    background-image: linear-gradient(180deg,
      rgba(255, 255, 255, var(--we-panel-sheen-a)) 0%,
      rgba(255, 255, 255, var(--we-panel-sheen-b)) 38%,
      rgba(255, 255, 255, var(--we-panel-sheen-c)) 100%);
    --dsw-alias-interactive-bg-hover: color-mix(in srgb, var(--we-accent, #4f8cff) 14%, rgba(255, 255, 255, 0.04));
  }
  /* 无 backdrop-filter：同一政策 —— 近不透明玻璃，文字绝不直接落在壁纸上
     （模糊被关掉后，半透明 + 无霜等于把左侧栏文字放到花壁纸上）。 */
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    body[data-we-glass-page][data-we-left-sidebar] div:has(> [data-slot="sidebar"]) {
      background-color: color-mix(in srgb, var(--we-surface-tint-light, #ffffff) 92%, transparent);
      background-image: none;
    }
    body[data-ds-dark-theme][data-we-glass-page][data-we-left-sidebar] div:has(> [data-slot="sidebar"]) {
      background-color: color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) 92%, transparent);
    }
  }

  /* ── 侧边栏四角圆角 / 直角（外观 → 侧边栏圆角）────────────────────────────────────
     左右两条侧栏各自一套：**统一档**（6 / 12 / 20 px）写 border-radius 简写，四角开关
     写 border-*-radius 长属性覆盖它。设置真源见 lib/settings-schema.js 的
     leftSidebarCornerRadius / rightSidebarCornerRadius 与两族 Square* 键；属性由
     src/glass.js 的 applyGlass 写出。

     ⚠️ **顺序即语义**：简写会一次性设置四个角 ⇒ 四角规则必须排在简写规则**之后**，
        否则被简写覆盖（dsh-myskin 的同款教训，见其 regions.ts 的 hoistShorthand）。
     ⚠️ 左栏锚点与「左侧栏液态玻璃」同一条：座位出口 div[data-slot="sidebar"] 带
        display:contents、**不生成盒子**，背景 / 圆角都画不出来 ⇒ 只能 :has() 反向选父元素。
     ⚠️ 右栏锚点**必须**带 [data-sidebar-right-open]：容器收起时仍挂在布局里（只把子元素
        visibility:hidden），裸锚会给收起态留一块板子（#107，与右栏玻璃同一条护栏）。
     ⚠️ 默认（统一档 = 跟随原生、四角都不直角）时 body 上没有任何属性 ⇒ 本块全部不生效，
        逐字节等于今天。
     ⚠️ 宿主原生左栏与右栏面板都**不带圆角**（.pI_x6G_sidebarCol 只有底色 + 右分割线；
        右栏面板的圆角长在内部 pane 上）⇒「圆角」靠统一档给 px 值才看得见。 */
  body[data-we-left-sidebar-radius] div:has(> [data-slot="sidebar"]) {
    border-radius: var(--we-left-sidebar-radius) !important;
  }
  body[data-we-left-sidebar-square~="tl"] div:has(> [data-slot="sidebar"]) { border-top-left-radius: 0 !important; }
  body[data-we-left-sidebar-square~="tr"] div:has(> [data-slot="sidebar"]) { border-top-right-radius: 0 !important; }
  body[data-we-left-sidebar-square~="br"] div:has(> [data-slot="sidebar"]) { border-bottom-right-radius: 0 !important; }
  body[data-we-left-sidebar-square~="bl"] div:has(> [data-slot="sidebar"]) { border-bottom-left-radius: 0 !important; }
  body[data-we-right-sidebar-radius] [data-sidebar-right-panel][data-sidebar-right-open] {
    border-radius: var(--we-right-sidebar-radius) !important;
  }
  body[data-we-right-sidebar-square~="tl"] [data-sidebar-right-panel][data-sidebar-right-open] { border-top-left-radius: 0 !important; }
  body[data-we-right-sidebar-square~="tr"] [data-sidebar-right-panel][data-sidebar-right-open] { border-top-right-radius: 0 !important; }
  body[data-we-right-sidebar-square~="br"] [data-sidebar-right-panel][data-sidebar-right-open] { border-bottom-right-radius: 0 !important; }
  body[data-we-right-sidebar-square~="bl"] [data-sidebar-right-panel][data-sidebar-right-open] { border-bottom-left-radius: 0 !important; }
  /* 圆角一开，右栏左边缘那条**竖直分割线**（dockkit 拖拽手柄的 ::before：0.5px 宽、
     top:0/bottom:0 全高）就成了"圆角旁边的一道直角"（用户实测截图）。修法 = 让它跟着
     圆角缩进：上面那个角是圆的 ⇒ 线从半径处开始；下面那个角是圆的 ⇒ 线到半径处结束；
     对应的角标了直角 ⇒ 那条边不动（线照旧顶到边）。
     ⚠️ **不再要求它住在面板里**（第一版按"面板内"限定，用户第二轮实测那条线仍在 ⇒ 它可能挂在
        面板的兄弟节点上）；仍然排除 pane 内部的 split 分割线（那是别的布局，缩进它会画错）。
     ⚠️ 手柄本体（可拖拽的命中区）不动，只是那条线变短 —— 拖拽能力一点没少。
     ⚠️ 兜底：--we-right-sidebar-radius 与门控属性由 src/glass.js 同批写出（零兜底读取）。 */
  body[data-we-right-sidebar-radius]:not([data-we-right-sidebar-square~="tl"]) [data-dockkit-divider]:not([data-dockkit-pane] *)::before {
    top: var(--we-right-sidebar-radius) !important;
  }
  body[data-we-right-sidebar-radius]:not([data-we-right-sidebar-square~="bl"]) [data-dockkit-divider]:not([data-dockkit-pane] *)::before {
    bottom: var(--we-right-sidebar-radius) !important;
  }
  /* 宿主第二处画同一条线的地方：**第一列 dock 的 tab host 上的 border-left**（0.5px、
     颜色同 --dsw-alias-border-l4，见前端包 _tabCell_[data-dockkit-host=dock][data-dockkit-column="0"]
     > ._tabHost_ 那条规则）。它画在那个元素**自己**的边上，不跟着面板的圆角走 ⇒ 圆角一开就是
     一道直角。锚点用"第一列 dock 的直接子元素"这个**结构事实**：宿主给它的是 CSS-module 哈希
     类名，不能当锚点（跨构建会漂）。 */
  body[data-we-right-sidebar-radius] [data-sidebar-right-panel][data-sidebar-right-open] [data-dockkit-host="dock"][data-dockkit-column="0"] > * {
    border-left: none !important;
  }

  /* ── 标题栏液态玻璃（壳层顶栏的玻璃接管，默认关）────────────────────────────────
     开关（body[data-we-titlebar-glass]，设置键 titlebarGlass，默认关）把顶栏改挂**与其余
     面板同一张配方表**，且与左侧栏那条**逐条同形**。

     ⚠️ **锚点**：Windows 形态的顶栏不是元素，而是 AppFrame 那条 grid 容器的**伪元素**
        （content 空、height = --dsh-windows-titlebar-height、app-region: drag、
        background = --dsw-specific-sidebar-fill）—— 它是顶栏唯一的那一层，也是"文字下方
        那块底"的全部来源 ⇒ 玻璃必须画在**这个伪元素**上，直接替换它的 background。
        壳层类名 .dshDesktopFrameTitlebar / .dshDesktopFrame / --dsh-desktop-frame-fill
        在当前 DSH Desktop 里**都不存在**（app.asar 字面扫描命中 0 次），不得用作锚点。
     ⚠️ **锚点为什么不用 [data-sidebar-collapsed]**：AppFrame 只在**收起**时才渲染该属性
        ⇒ 把条件属性写进选择器会让本块在默认展开态**恒不生效**。data-rightbar-* 同理。
     ⚠️ **锚点只用一条**：保留的 div[class*="pI_x6G_frame"] 是 CSS 模块哈希类名的**子串**
        匹配（哈希跨版本会漂，漂了的最坏结果是"本块不生效"，失败安全、绝不误伤；运行时实测
        n1=1 / n3=1）。两条硬门是 [data-windows-titlebar]（壳层写进 <html>，只在 Windows
        Electron 形态；实测 winTB=1）与 body[data-we-adapter^="desktop-"]（本插件自己挂；
        实测 ad=desktop-official）。教训两条：
        ⇒ 结论一：**绝不把"未经本引擎验证的选择器"与"已验证的"放进同一个逗号列表** —— CSS
          选择器列表一损俱损（一个不被接受，整条规则连同能命中的一起被丢弃，表现为"变量全对、
          背景与模糊都没算出来"，与"锚点没选对"的现象完全一样，极易误判）；要并存必须拆成
          两条独立规则（一条失效只丢它自己）。
        ⇒ 结论二：**嵌套 :has()**（:has() 里再套 :has()）本壳层的 Chromium 不接受（会抛异常）；
          左栏那条能用是因为它是**单层** :has(> [data-slot="sidebar"]) —— 别把左栏的经验外推。
        哈希漂移的兜底将来若要加，必须**另起一条规则**，不得并进逗号列表。
     ⚠️ **本块的结构分工**：底色 / 釉光 / accent 在下面这条 ::before；模糊在紧随其后的
        ::after —— 为什么必须分两层、绘制顺序、以及 issue #131 的 fixed 包含块，见那条规则的注释。
     ⚠️ **"不要有任何色差"是本块的第一约束**：底色的 color-mix 权重与五条 accent 映射与左侧栏
        **逐字相同**（判据 TB4）。釉光**刻意不同**（判据 TB4a）—— 停靠点是百分比，装进两个高度差
        27.8 倍的盒子会算出不同值，见 ::before 那条注释。两面都**不画分割线**（本面判据 TB6，
        左栏判据 S2）。⚠️ 任何调色改动都必须**同时**改这两块，否则色差立刻出现。
     ⚠️ **可覆盖性**：本块用 !important —— 壳层那条 :before 声明同特异度但写在别的样式表里，
        靠加载顺序取胜不可靠；伪元素只此一层，覆盖它没有副作用。 */
  html[data-windows-titlebar] body[data-we-glass-page][data-we-titlebar-glass][data-we-adapter^="desktop-"] div[class*="pI_x6G_frame"]::before {
    /* 底色：压掉壳层那条 background: var(--dsw-specific-sidebar-fill)，换成与左侧栏
       **逐条同形**的配方（只有面变量 --we-titlebar-alpha 替 --we-left-sidebar-alpha）。
       ⚠️ 必须写成 background-color + background-image 两条**分开的**声明（不是
       background 简写）——简写会把同名的 background-* 长属性一次性重置，而本块与
       左侧栏的"逐条同形"判据（verify-glass-compositing）正是按声明对声明比对的。 */
    background-color: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-light, #ffffff) calc(var(--we-titlebar-alpha) * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%)) !important;
    /* 顶层白光釉 —— **必须是恒定值，不能沿用左栏那条三段渐变**（实测）：
       渐变的停靠点是**百分比**（0% / 38% / 100%），同一条声明装进两个高度差 27.8 倍的
       盒子里会算出**完全不同**的白釉强度 ——
         · 标题栏 ::before 高 **40px**：0.10 →(15px) 0.03 →(40px) 0.05，整段均值 0.0495；
         · 侧栏列高 **1111.33px**：0.10 →(422px) 0.03，其顶部 40px 均值 0.0967。
       交界处台阶 = 0.10 − 0.05 = **0.05 白釉**，整段差 **0.047** ⇒ 肉眼可见的色差。
       而 TB4 判据比的是**声明文本**（两条逐字相同 ⇒ PASS），完全看不见这个 ——
       因为差异出在**盒子尺寸**上，不在配方上。"声明逐字相同 ⇒ 无色差"对**盒子相对**的
       声明（百分比停靠点）是**不成立**的，这条注释就是那个反例。
       修法：本面只用 sheen-a 一个停靠点（恒定 0.10）。左栏顶部 40px 实际是
       0.10 → 0.0934（只漂 0.0066，远低于感知阈值），所以恒定值与之等效。
       ⚠️ 判据见 verify-glass-compositing 的 TB4a（改回三段渐变会被判红）。 */
    background-image: linear-gradient(180deg,
      rgba(255, 255, 255, var(--we-panel-sheen-a)) 0%,
      rgba(255, 255, 255, var(--we-panel-sheen-a)) 100%) !important;
    /* ⚠️ 模糊**不在这里**，在紧随其后的 ::after 上（理由见那条规则的注释）。 */
    /* ⚠️ **不画底分割线**（现场口径）：左栏按 S2 判据是**显式 border-right: none**
       （"这一列已经是一整块玻璃，再画一条线就把它切成两半"）—— 同一条政策必须两面一致，
       否则那条线本身就是色差。
       ⚠️ 判据见 verify-glass-compositing 的 TB6（把线种回去会被判红）。 */
    /* 配色：与左栏**同一组** accent 映射（已由上方 CSS-ENGINE 判据验证逐条 SAME）。 */
    --dsw-alias-interactive-bg-hover: color-mix(in srgb, var(--we-accent, #4f8cff) 14%, transparent);
    --dsw-alias-interactive-bg-hover-accent: color-mix(in srgb, var(--we-accent, #4f8cff) 18%, transparent);
    --dsw-alias-state-business-primary: var(--we-accent, #4f8cff);
    --dsw-alias-brand-primary: var(--we-accent, #4f8cff);
    --dsw-alias-brand-text: var(--we-accent, #4f8cff);
  }
  /* ── 标题栏的**模糊层**：另起一个 ::after ─────────────────────────────────────
     为什么必须是两个伪元素：左栏是「底色在**元素**、模糊在其 ::before（绘制在底色**之上**）」
     ⇒ 结果 = F(壁纸 ⊕ 底色)，底色**经过** saturate(1.8) / brightness(1.04) 滤镜；若把底色
     与模糊写在**同一个** ::before 上 ⇒ 结果 = 底色 ⊕ F(壁纸)，底色**不经过**滤镜 ⇒ 两面在
     数值完全相同的情况下仍出色差。修法：底色留在壳层的 ::before（上一条规则），模糊另起
     ::after（::before 先、::after 后绘制 ⇒ ::after 的 backdrop 恰好**含** ::before 的底色，
     与左栏逐像素同构）。
     ⚠️ 几何必须与壳层那条 ::before 完全一致（inset:0 0 auto + 标题栏高度），否则两层错位露边。
     ⚠️ ::after 没有后代 ⇒ 永不成为 position:fixed 的包含块（issue #131 同一理由）；
        pointer-events:none ⇒ 不挡壳层 ::before 的 app-region 拖拽区，也不挡壳层 z-index:30 的固定按钮。
     ⚠️ 不写 z-index（保持 auto）：这样才能在 ::before **之上**按树序绘制；写成 -1 会掉到
        frame 底色之下，甚至跑到壁纸后面。 */
  html[data-windows-titlebar] body[data-we-glass-page][data-we-titlebar-glass][data-we-adapter^="desktop-"] div[class*="pI_x6G_frame"]::after {
    content: "";
    position: absolute;
    inset: 0 0 auto;
    height: var(--dsh-windows-titlebar-height, 40px);
    pointer-events: none;
    -webkit-backdrop-filter: blur(var(--we-titlebar-blur)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01) !important;
    backdrop-filter: blur(var(--we-titlebar-blur)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01) !important;
  }
  /* 深色：同一张表、同一组层权重，只有玻璃色缺省与高亮 mix 不同（与左栏深色那条同形）。
     ⚠️ 釉光必须**和浅色那条一样恒定**（单停靠点 sheen-a）：照抄左栏三段渐变就会重现
        那个"盒尺寸色差" —— 40px 与 1111px 两个盒子会算出不同白釉强度。
        TB4a 对深浅两条都跑。 */
  html[data-windows-titlebar] body[data-ds-dark-theme][data-we-glass-page][data-we-titlebar-glass][data-we-adapter^="desktop-"] div[class*="pI_x6G_frame"]::before {
    background-color: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) calc(var(--we-titlebar-alpha) * 100%), transparent) calc((1 - var(--we-readability-floor)) * 100%)) !important;
    background-image: linear-gradient(180deg,
      rgba(255, 255, 255, var(--we-panel-sheen-a)) 0%,
      rgba(255, 255, 255, var(--we-panel-sheen-a)) 100%) !important;
    --dsw-alias-interactive-bg-hover: color-mix(in srgb, var(--we-accent, #4f8cff) 14%, rgba(255, 255, 255, 0.04));
  }
  /* 无 backdrop-filter：同一政策 —— 近不透明玻璃，顶栏文字绝不直接落在壁纸上。 */
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    html[data-windows-titlebar] body[data-we-glass-page][data-we-titlebar-glass][data-we-adapter^="desktop-"] div[class*="pI_x6G_frame"]::before {
      background: color-mix(in srgb, var(--we-surface-tint-light, #ffffff) 92%, transparent) !important;
    }
    html[data-windows-titlebar] body[data-ds-dark-theme][data-we-glass-page][data-we-titlebar-glass][data-we-adapter^="desktop-"] div[class*="pI_x6G_frame"]::before {
      background: color-mix(in srgb, var(--we-surface-tint-dark, #0d1524) 92%, transparent) !important;
    }
    /* 模糊层整个不存在：本档不支持 backdrop-filter，留着 ::after 只会多一层
       什么都画不出来的绝对定位块（含 pointer-events:none 的空层）。 */
    html[data-windows-titlebar] body[data-we-glass-page][data-we-titlebar-glass][data-we-adapter^="desktop-"] div[class*="pI_x6G_frame"]::after {
      content: none;
    }
  }
  /* 侧栏的釉取哪一份：跟随全局 ⇒ 与左栏同一道（--we-panel-sheen-*）；
     自定义 ⇒ "随透明度衰减"曲线（--we-sidebar-sheen）。两档都只定义变量，
     面板规则本身不必分叉。 */
  body[data-we-sidebar-follow] {
    --we-sidebar-sheen-a: var(--we-panel-sheen-a);
    --we-sidebar-sheen-b: var(--we-panel-sheen-b);
    --we-sidebar-sheen-c: var(--we-panel-sheen-c);
  }
  body[data-we-sidebar-glass]:not([data-we-sidebar-follow]) {
    --we-sidebar-sheen-a: calc(var(--we-sidebar-sheen) * 0.14);
    --we-sidebar-sheen-b: calc(var(--we-sidebar-sheen) * 0.04);
    --we-sidebar-sheen-c: calc(var(--we-sidebar-sheen) * 0.01);
  }

  /* ── dsh-better-sidebar glass ──────────────────────────────────────────────
     The sidebar shell is portalled onto <body> under a stable host attribute
     "data-dsh-better-sidebar" (set by the plugin's own mount code), so we can
     target the whole tree without depending on its CSS-module hashes. Its root
     panels read the opaque --dsw-alias-bg-layer-1 token (hence the "black
     frame") — give them the SAME clear liquid-glass recipe as the
     composer/bubbles (faint specular sheen + gentle frosted melt).
     Unlike the conversation surfaces, the sidebar glass is FULLY independent
     from the active wallpaper: it can tint and frost the stock DSH surface or
     any other background source without pretending a plugin wallpaper exists.
     The master switch body[data-we-sidebar-glass] (侧栏液态玻璃) gates the whole
     adaptation, and blur / saturation / transparency / base tint each have
     their own knob (--we-sidebar-blur / --we-sidebar-saturate /
     --we-sidebar-alpha / --we-sidebar-color, from 侧栏模糊 / 侧栏透明度 /
     侧栏玻璃颜色), so the sidebar can be blurrier, clearer, more transparent
     or tinted however you like without touching the 玻璃 / 玻璃透明度 sliders.
     Inner chrome surfaces that paint the same opaque tokens get a translucent
     base too; the blur lives on the root panels (one blur per shell). */
  body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_boundaryError"],
  body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_panel"] {
    /* 侧栏面板同样承载文字 → 同一层可读性下限（--we-sidebar-tint 是这里的
       玻璃色权重，只在另一项上生效）。 */
    background-color: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-sidebar-color) var(--we-sidebar-tint), transparent) calc((1 - var(--we-readability-floor)) * 100%)) !important;
    /* Specular sheen + refraction highlights follow --we-sidebar-sheen
       (= min(1, alpha/0.2236)): at default (12%) and any MORE solid setting
       the sheen keeps the ORIGINAL design strength (0.14/0.04/0.01,
       0.32/0.08/0.06); only toward transparency does the white glaze fade,
       so 100% is truly near-transparent instead of pale white. */
    background-image: linear-gradient(180deg,
      rgba(255, 255, 255, var(--we-sidebar-sheen-a)),
      rgba(255, 255, 255, var(--we-sidebar-sheen-b)) 38%,
      rgba(255, 255, 255, var(--we-sidebar-sheen-c))) !important;
    -webkit-backdrop-filter: blur(var(--we-sidebar-blur)) saturate(var(--we-sidebar-saturate)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01) !important;
    backdrop-filter: blur(var(--we-sidebar-blur)) saturate(var(--we-sidebar-saturate)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01) !important;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, calc(var(--we-sidebar-sheen) * 0.32)),
      inset 0 -1px 0 rgba(255, 255, 255, calc(var(--we-sidebar-sheen) * 0.08)),
      inset 0 0 0 0.5px rgba(255, 255, 255, calc(var(--we-sidebar-sheen) * 0.06));
  }
  body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_pane"],
  body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_tabBar"],
  body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_paneCard"],
  body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_editorHeader"],
  body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_explorerHeader"],
  body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_gitHeader"],
  body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_browserBar"],
  body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_terminalWrap"] {
    background-color: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-sidebar-color) calc(var(--we-sidebar-tint) * 0.75), transparent) calc((1 - var(--we-readability-floor)) * 100%)) !important;
  }
  body[data-ds-dark-theme][data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_boundaryError"],
  body[data-ds-dark-theme][data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_panel"] {
    background-color: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-sidebar-color) calc(var(--we-sidebar-tint) * 0.65), transparent) calc((1 - var(--we-readability-floor)) * 100%)) !important;
  }
  body[data-ds-dark-theme][data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_pane"],
  body[data-ds-dark-theme][data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_tabBar"],
  body[data-ds-dark-theme][data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_paneCard"],
  body[data-ds-dark-theme][data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_editorHeader"],
  body[data-ds-dark-theme][data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_explorerHeader"],
  body[data-ds-dark-theme][data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_gitHeader"],
  body[data-ds-dark-theme][data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_browserBar"],
  body[data-ds-dark-theme][data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_terminalWrap"] {
    background-color: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-sidebar-color) calc(var(--we-sidebar-tint) * 0.5), transparent) calc((1 - var(--we-readability-floor)) * 100%)) !important;
  }
  /* No backdrop-filter support: fall back to near-opaque tinted surfaces so
     sidebar text never sits directly on a busy wallpaper (same policy as the
     settings-window glass). The tint still applies. */
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_boundaryError"],
    body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_panel"],
    body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_pane"],
    body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_tabBar"],
    body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_paneCard"],
    body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_editorHeader"],
    body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_explorerHeader"],
    body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_gitHeader"],
    body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_browserBar"],
    body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_terminalWrap"] {
      background-color: color-mix(in srgb, var(--we-sidebar-color) 92%, transparent) !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }
  }

  /* ── Official right sidebar ────────────────────────────────────────────────
     The right column lives in the NATIVE sidebar: better-sidebar registers its
     tabs into it and only keeps its own bottom dock. The native panel paints
     background: var(--dsw-alias-bg-base) — the EXACT token WE set to
     transparent while a wallpaper is active — so without adaptation the whole
     right column would be fully see-through with no frost. The panel is
     addressed via its stable data attributes
     (data-sidebar-right-panel="push"|"fullscreen"; CSS-module hashes like
     P3OORG_panel drift between harness builds and must not be used). The
     侧栏液态玻璃 master switch gates the SAME frosted recipe and the SAME
     侧栏模糊/透明度/玻璃颜色 knobs as the better-sidebar glass; with the
     switch off, the panel falls back to the theme's opaque layer colour so
     「关闭则恢复原生外观」keeps holding there too.

     Collapse mechanics (#107): the CONTAINER stays mounted with its full width
     (reserved for the slide animation, pointer-events:none) and only its
     CHILDREN hide via "visibility:hidden", gated on the
     "data-sidebar-right-open" attribute the host writes only while expanded.
     The container itself has no background of its own — so any plate we paint
     on the bare "[data-sidebar-right-panel]" selector stays VISIBLE over the
     wallpaper while the panel is closed (the 「右栏关了还是一块灰/玻璃」
     report). Every container-painting rule below is therefore scoped to
     "[data-sidebar-right-open]", plus an explicit closed-state clear so a
     stale painted background can never linger.
     ⚠️ 同类陷阱：凡是"宿主容器留在布局里、只靠子元素隐藏"的元素都不能无条件上色；
     护栏见 test/verify-host-paint-scope.mjs（另见 #91 的 body * { !important } 修复）。 */
  body[data-we-glass-page] [data-sidebar-right-panel][data-sidebar-right-open] {
    /* 侧栏玻璃总开关关闭时的兜底：面板必须**不透明**（否则文字直接压在壁纸上）。
       --dsw-alias-bg-layer-* 在壁纸下已被改写成玻璃配方 ⇒ 这里读插件自己的面板色。 */
    background-color: var(--we-panel-color, #1e1f26);
  }
  /* #150（dockkit 层级体系）：backdrop-filter 让本面板自成层叠
     上下文（z=auto 档）。宿主的层级设计是「面板内部的 dock 单元消费
     --dsh-dockkit-dock-layer（常态 10 / 右栏全屏 40）」——层叠上下文一成，这个 z
     被困在面板内部，整个面板作为原子跌回 z=auto，被会话列里宿主自己的更高层内容
     （hero 输入卡 z=1 / composerSeat z=7，同为根层叠上下文里的 flex 项）反压：
     push / 收起态没有空间重叠所以看不出来，唯独「右栏全屏」面板与对话列重叠时，
     输入卡与 hero 标题会穿透玻璃面板叠在侧栏上（issue #150 截图形态）。
     修法 = 玻璃开着时把面板本身抬到宿主为它设计的同一层——该 var 就声明在面板上，
     全屏时自动解析为 40，与内部 dock 单元原生取得的层完全一致；玻璃关着（主开关
     兜底只上不透明底色）与软件光栅回退档（backdrop-filter 显式 none）都不成层叠
     上下文，保持原生绘制顺序，无需此抬升。 */
  body[data-we-sidebar-glass] [data-sidebar-right-panel][data-sidebar-right-open] {
    background-color: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-sidebar-color) var(--we-sidebar-tint), transparent) calc((1 - var(--we-readability-floor)) * 100%)) !important;
    background-image: linear-gradient(180deg,
      rgba(255, 255, 255, var(--we-sidebar-sheen-a)),
      rgba(255, 255, 255, var(--we-sidebar-sheen-b)) 38%,
      rgba(255, 255, 255, var(--we-sidebar-sheen-c))) !important;
    -webkit-backdrop-filter: blur(var(--we-sidebar-blur)) saturate(var(--we-sidebar-saturate)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01) !important;
    backdrop-filter: blur(var(--we-sidebar-blur)) saturate(var(--we-sidebar-saturate)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01) !important;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, calc(var(--we-sidebar-sheen) * 0.32)),
      inset 0 -1px 0 rgba(255, 255, 255, calc(var(--we-sidebar-sheen) * 0.08)),
      inset 0 0 0 0.5px rgba(255, 255, 255, calc(var(--we-sidebar-sheen) * 0.06));
    z-index: var(--dsh-dockkit-dock-layer, 10);
  }
  body[data-ds-dark-theme][data-we-sidebar-glass] [data-sidebar-right-panel][data-sidebar-right-open] {
    background-color: color-mix(in srgb,
      var(--we-readability-base) calc(var(--we-readability-floor) * 100%),
      color-mix(in srgb, var(--we-sidebar-color) calc(var(--we-sidebar-tint) * 0.65), transparent) calc((1 - var(--we-readability-floor)) * 100%)) !important;
  }
  /* Closed state: the host's own container carries no background — keep ours
     off too, whatever the master-switch state (#107). */
  body[data-we-glass-page] [data-sidebar-right-panel]:not([data-sidebar-right-open]) {
    background: none !important;
    background-image: none !important;
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
    box-shadow: none !important;
  }
  /* No backdrop-filter support: near-opaque tinted plate, same policy as the
     better-sidebar glass above. */
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    body[data-we-sidebar-glass] [data-sidebar-right-panel][data-sidebar-right-open] {
      background-color: color-mix(in srgb, var(--we-sidebar-color) 92%, transparent) !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }
  }

  /* ── dsh-better-sidebar CONTENT surfaces: near-opaque tinted glass ─────────
     The editor (CodeMirror) surface is transparent by design, and the terminal
     background reads --dsw-alias-bg-base — which we must keep transparent so
     the wallpaper shows through. Their fixed content palettes (syntax
     highlighting / ANSI colors) are designed for an OPAQUE backdrop (One
     Dark/Light, xterm themes): on the fully frosted composite the mid-gray
     comments etc. lose all contrast (实测注释灰 1.7–2.3:1，看不清).
     Fully opaque surfaces fix readability but kill the glass look. Balance:
     a NEAR-OPAQUE TINTED glass plate — the theme's opaque panel color
     (--dsw-alias-bg-layer-1) at 88% keeps the wallpaper glow bleeding through
     (still reads as glass) while the composite stays dark/light enough for the
     the designed content palettes. Tune via the 内容面透明度 / 内容面底色 controls
     (--we-content-surface-alpha / --we-content-surface-color; color empty =
     follow the theme panel color). The sidebar master switch gates these
     surfaces too, so turning it off restores the complete native sidebar even
     when a wallpaper remains active. .cm-editor / .xterm are library-global
     class names (stable across the sidebar's builds).
     The editor / preview tabs render inside the NATIVE right sidebar
     ([data-sidebar-right-panel]) — extend the same plate to content surfaces
     there, or 内容面透明度 / 内容面底色 stop responding for those tabs. */
  body[data-we-sidebar-glass] [data-dsh-better-sidebar] .cm-editor,
  body[data-we-sidebar-glass] [data-dsh-better-sidebar] .xterm,
  body[data-we-sidebar-glass] [data-sidebar-right-panel][data-sidebar-right-open] .cm-editor,
  body[data-we-sidebar-glass] [data-sidebar-right-panel][data-sidebar-right-open] .xterm {
    background-color: color-mix(in srgb, var(--we-content-surface-color, var(--we-panel-color, #1e1f26)) max(calc(var(--we-readability-floor) * 100%), var(--we-content-surface-alpha, 88%)), transparent) !important;
  }

  /* Picker chrome. */
  .we-picker {
    display: flex; flex-direction: column; gap: 14px;
    /* issue #127：设置窗整窗规则把 --we-accent 掐成 initial（不泄漏给窗内第三方
       分区）—— 我们的 picker 子树在这里从 body 的原件重新别名，消费面不变。 */
    --we-accent: var(--we-accent-src, #4f8cff);
`;

export { CSS_SIDEBAR };
