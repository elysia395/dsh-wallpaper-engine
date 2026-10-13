/**
 * sidebar-right.js — 官方右侧栏接入 + 侧边栏触达模式 + 「壁纸引擎设置」入口。
 *
 * 干什么：
 *   ① 能力门：`ctx.slots.inject("sidebar.right.pane.tab", cb)` —— 该座位只有
 *      harness ≥0.1.5（带官方右侧栏）才会声明，回调跑没跑就是**天然的分支点**：
 *      跑了 → 官方态（面板融进右侧栏 tab）；没跑 → 抽屉态（吉祥物拉出右滑抽屉）。
 *      不调版本号判定（座位存在性 = 功能存在性，少一个漂移源）。
 *   ② 官方态的两段注册（与 better-sidebar 0.19 / documentpreview 同一条公开路径）：
 *      tab 类型（`ctx.sidebarRightTabs.register`）+ tab 身体（`ctx.slots.register`
 *      { name: 'sidebar.right.pane.tab', key: id }）。两个服务都是**可选服务**，
 *      用 `ctx.get` 轮询拿（同 pollThemeService 模式 —— 写进 inject 会在低版本
 *      宿主把插件 park 死）。
 *   ③ 模式真源 `sidebarRightMode()` / `sidebarRightOpen()`：RopeDock 的吉祥物
 *      点击按它路由（官方态 → openTab 展开右侧栏聚焦本 tab；抽屉态 → 开抽屉）。
 *   ④ 「壁纸引擎设置」入口（openSettingsSection）：官方没有公开的"打开设置对话框"
 *      可编程面 —— 走 DOM：点宿主左栏的设置触发钮（aria-haspopup="dialog"），
 *      对话框挂上 body 后再点我们自己的 nav 行（label 是我们注册的，最稳定的锚）。
 *      任一步找不到就静默收尾（用户手动开设置也一样到）。
 *      可选参数 `tabId` = 深链到设置页的某一页签（快捷面板底栏那两颗按钮用）：
 *      写一个瞬态请求（`settingsTabRequest`）就走，落地在 WallpaperPicker 的 effect 里。
 *   ⑤ 调试开关 `?we-sidebar=drawer`：官方宿主上强制抽屉态（验证低版本形态用）。
 *
 * 契约（构建期由 scripts/build-client.mjs 内联进 bundle 的工厂作用域）：
 *   · 本文件必须保持浏览器安全（无 import / require / Node API），且**不得有顶层
 *     可执行语句**读 client.js 的 const（会被内联到 bundle 顶部，撞 TDZ）。
 *   · React 只在渲染期读（同 panel-tabs.js 口径）；emit 只在模式变化时调。
 */

// ── 侧边栏触达模式（唯一真源）────────────────────────────────────────────────
// "drawer"（默认：吉祥物 → 右滑抽屉）| "official"（吉祥物 → 官方右侧栏 tab）。
// 只能从 installSidebarRight 的注册/清理路径翻转，别处只读。
let weSidebarMode = "drawer";
let weSidebarOpenFn = null; // 官方态的 openTab 调用（抽屉态为 null）
let weSidebarCtrl = null;   // 官方态控制器（isExpanded/active/toggleExpanded 的宿主面）
const WE_SIDEBAR_KIND = "wallpaper-library";
const WE_SIDEBAR_ID = "dsh-plugin-wallpaper-engine/library";

function sidebarRightMode() {
  return weSidebarMode;
}
/** 官方态下展开右侧栏并聚焦「壁纸」tab；抽屉态/服务丢失时返回 false（调用方回落开抽屉）。 */
function sidebarRightOpen() {
  if (weSidebarMode !== "official" || !weSidebarOpenFn) return false;
  try { weSidebarOpenFn(); return true; } catch { return false; }
}
/** 当前展开的右侧栏是否正显示「壁纸」tab（TabRecord.kind 即注册时的 kind）。 */
function sidebarRightOursActive() {
  try {
    const a = weSidebarCtrl && typeof weSidebarCtrl.active === "function" ? weSidebarCtrl.active() : null;
    return Boolean(a && a.kind === WE_SIDEBAR_KIND);
  } catch { return false; }
}
/**
 * 官方态「点一下开关切换」：展开且正显示「壁纸」⇒ 收起；否则展开并聚焦本 tab。
 * 返回 false = 非官方态（调用方回落抽屉）。这是吉祥物点击与快捷键共用的语义。
 */
function sidebarRightToggle() {
  if (weSidebarMode !== "official" || !weSidebarCtrl) return false;
  try {
    if (typeof weSidebarCtrl.toggleExpanded === "function" && typeof weSidebarCtrl.isExpanded === "function"
      && weSidebarCtrl.isExpanded() && sidebarRightOursActive()) {
      weSidebarCtrl.toggleExpanded();
      return true;
    }
    return sidebarRightOpen();
  } catch { return false; }
}
/**
 * 官方态关闭：仅当展开且正显示「壁纸」时收起 —— 不替用户关掉别人的 tab。
 * 官方态一律返回 true（"已处理"——没有可关的也不回落到抽屉）；非官方态返回 false。
 */
function sidebarRightClose() {
  if (weSidebarMode !== "official" || !weSidebarCtrl) return false;
  try {
    if (typeof weSidebarCtrl.toggleExpanded === "function" && typeof weSidebarCtrl.isExpanded === "function"
      && weSidebarCtrl.isExpanded() && sidebarRightOursActive()) {
      weSidebarCtrl.toggleExpanded();
    }
    return true;
  } catch { return false; }
}

// ── 壁纸侧栏的统一开关（吉祥物点击 / 快捷键共用；两个宿主形态都覆盖）─────────
// 抽屉态的开关由 RopeDock 组件注册进来：drawer 的 open 状态是组件内部 state，
// 模块层只能经这一组回调改它（注册/撤销见 client.js 的 RopeDock effect）。
// eslint-disable-next-line prefer-const -- 跨片段写入：client.js:4404,4405,4410
let ropeDrawerControl = null; // { toggle, open, close } | null（RopeDock 隐藏/卸载时为 null）
/** 开：官方态展开并聚焦本 tab；抽屉态开抽屉。两边都不可用返回 false。 */
function wallSidebarOpen() {
  if (sidebarRightOpen()) return true;
  if (ropeDrawerControl) { ropeDrawerControl.open(); return true; }
  return false;
}
/** 关：官方态按「正显示本 tab 才收」收；抽屉态关抽屉。 */
function wallSidebarClose() {
  if (sidebarRightClose()) return true;
  if (ropeDrawerControl) { ropeDrawerControl.close(); return true; }
  return false;
}
/** 开/关切换（吉祥物点击、快捷键共用）。不可用（如吉祥物被隐藏且非官方态）返回 false。 */
function wallSidebarToggle() {
  if (sidebarRightToggle()) return true;
  if (ropeDrawerControl) { ropeDrawerControl.toggle(); return true; }
  return false;
}
/** 侧栏此刻有没有可开的形态（快捷键 resolve 据此决定 handled / pass）。 */
function wallSidebarAvailable() {
  return weSidebarMode === "official" || Boolean(ropeDrawerControl);
}

/** 强制抽屉态（官方宿主上验证低版本形态的调试开关）。两种入口：
 *  · `?we-sidebar=drawer` —— 冷启动地址；
 *  · `localStorage.weSidebarTest === "drawer"` —— 宿主会把 query 洗成裸 `/`
 *    （token 消费后跳转），地址参数会被剥掉；存储键走 reload 即可（同
 *    `weRotationTestSec` 的既有测试钩子口径）。 */
function sidebarForcedDrawer() {
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem("weSidebarTest") === "drawer") return true;
  } catch { /* ignore */ }
  try {
    return typeof location !== "undefined"
      && /(?:\?|&)we-sidebar=drawer(?:&|$)/.test(String(location.search || ""));
  } catch { return false; }
}

// 定时器一律走 window.* 且带存在性守卫（bundle 在测试沙箱里跑时裸全局
// setTimeout/clearTimeout 不存在；守卫缺席 = 不再重试，安静落回抽屉态）。
function scheduleWeTimeout(fn, ms) {
  if (typeof window === "undefined" || typeof window.setTimeout !== "function") return 0;
  return window.setTimeout(fn, ms);
}
function clearWeTimeout(id) {
  if (!id) return;
  if (typeof window === "undefined" || typeof window.clearTimeout !== "function") return;
  window.clearTimeout(id);
}

/**
 * 安装官方侧栏接入。在 apply() 里经 ctx.effect 调用；返回清理函数（可空）。
 * 座位回调的返回链：slots.inject 把返回值绑在座位声明的生命周期上（与
 * settings.section 那处同型）。
 */
function installSidebarRight(ctx) {
  if (sidebarForcedDrawer()) return null;
  if (!ctx || !ctx.slots || typeof ctx.slots.inject !== "function") return null;
  return ctx.slots.inject("sidebar.right.pane.tab", () => {
    let disposed = false;
    let poll = 0;
    let off = null;
    const cleanup = () => {
      disposed = true;
      if (poll) { try { clearWeTimeout(poll); } catch { /* ignore */ } poll = 0; }
      if (off) { try { off(); } catch { /* ignore */ } off = null; }
      if (weSidebarMode === "official") {
        weSidebarMode = "drawer";
        weSidebarOpenFn = null;
        weSidebarCtrl = null;
        emit();
      }
    };
    // 座位声明了 ≠ 服务就绪（启动竞态）：短轮询拿两个可选服务，拿到即注册。
    const attempt = () => {
      if (disposed) return;
      const tabs = typeof ctx.get === "function" ? ctx.get("sidebarRightTabs") : null;
      const ctrl = typeof ctx.get === "function" ? ctx.get("sidebarRight") : null;
      if (!tabs || typeof tabs.register !== "function"
        || !ctrl || typeof ctrl.openTab !== "function") {
        poll = scheduleWeTimeout(attempt, 250);
        return;
      }
      let disposeTabs = null;
      let disposeBody = null;
      try {
        disposeTabs = tabs.register({
          id: WE_SIDEBAR_ID,
          kind: WE_SIDEBAR_KIND,
          keepMounted: true,
          title: () => weT("壁纸"),
          guide: [{
            id: "library",
            order: 100,
            title: () => weT("壁纸引擎"),
            description: () => weT("本地 Wallpaper Engine 壁纸库与播放控制"),
            icon: renderWeIcon,
          }],
        });
        disposeBody = ctx.slots.register(
          { name: "sidebar.right.pane.tab", key: WE_SIDEBAR_ID },
          () => React.createElement(QuickPanel, { dock: "official" }),
        );
      } catch {
        // 注册被拒（id 撞车 / 形态不符）：不进入官方态，安静落回抽屉。
        try { if (disposeTabs) disposeTabs(); } catch { /* ignore */ }
        try { if (disposeBody) disposeBody(); } catch { /* ignore */ }
        return;
      }
      weSidebarMode = "official";
      weSidebarCtrl = ctrl;
      weSidebarOpenFn = () => ctrl.openTab(WE_SIDEBAR_KIND);
      emit(); // RopeDock 重读模式（吉祥物行为切换）
      off = () => {
        try { disposeBody(); } catch { /* ignore */ }
        try { disposeTabs(); } catch { /* ignore */ }
      };
    };
    attempt();
    return cleanup;
  });
}

// ── 快捷键：呼出 / 关闭壁纸侧栏（官方桌面默认 Cmd/Ctrl+Alt+W）──────────────
// 走宿主的 shortcuts 服务（`ctx.get("shortcuts")`，可选服务 + 短轮询；不进 inject ——
// 缺服务的旧宿主不该把插件 park）。注册后命令出现在宿主的快捷键编辑器里、可自行改键；
// 默认绑定**只给桌面三档**（desktop:macos/windows/linux = primary+alt+KeyW）：
//   · 与官方既有默认无重叠（page.close 桌面是 primary+W、web 才是 primary+alt+W；
//     sidebar.right.toggle 是 primary+alt+B —— 已按宿主全量默认绑定清单核对）；
//   · web 档故意不设默认（浏览器里 Cmd+Shift+W 是关窗口，不该抢），有需要自行绑定。
// resolve：没有可开的侧栏形态（吉祥物被隐藏且非官方态）时 pass —— 不吞按键。
function installWallSidebarShortcut(ctx) {
  if (!ctx || typeof ctx.get !== "function") return null;
  if (typeof document === "undefined") return null;
  let disposed = false;
  let poll = 0;
  let off = null;
  const attempt = () => {
    if (disposed) return;
    const shortcuts = ctx.get("shortcuts");
    if (!shortcuts || typeof shortcuts.register !== "function") {
      poll = scheduleWeTimeout(attempt, 250);
      return;
    }
    try {
      off = shortcuts.register({
        id: "wallpaper.sidebar.toggle",
        label: () => weT("壁纸侧栏（呼出 / 关闭）"),
        // 别名是**搜索关键词**（宿主快捷键编辑器里按名字找）：中英都留一份，切语言也不丢词。
        aliases: ["wallpaper sidebar", "toggle wallpaper panel", weT("壁纸侧栏"), weT("壁纸库")],
        defaults: {
          "desktop:macos": { code: "KeyW", modifiers: ["primary", "alt"] },
          "desktop:windows": { code: "KeyW", modifiers: ["primary", "alt"] },
          "desktop:linux": { code: "KeyW", modifiers: ["primary", "alt"] },
        },
        regions: ["page", "editable", "terminal"],
        modals: [],
        resolve: () => (wallSidebarAvailable()
          ? { status: "handled", run: () => { wallSidebarToggle(); } }
          : { status: "pass" }),
      });
    } catch { off = null; }
  };
  attempt();
  return () => {
    disposed = true;
    if (poll) { try { clearWeTimeout(poll); } catch { /* ignore */ } poll = 0; }
    if (off) { try { off(); } catch { /* ignore */ } off = null; }
  };
}

// ── 「壁纸引擎设置」入口（DOM 路径）──────────────────────────────────────────
// 官方没有公开的"打开设置对话框"可编程面（shortcuts 服务只有注册面、没有执行面；
// 设置 shell 的 store 不外发）。两步都走宿主自己的 DOM：
//   ① 点左栏底部的设置触发钮（aria-label = 设置 / Settings，shell 的稳定锚）；
//   ② 对话框是 body 直接传送门 —— 挂上后点文本为「壁纸引擎」的 nav 行（label 是
//      我们注册的，比 hash 类名稳定）。任一步缺席 = 静默收尾（不报错、不打扰）。
/**
 * 找设置触发钮。⚠️ 不能取"文档序第一个 `[aria-haspopup="dialog"]`"：官方应用里
 * 带这个属性的按钮有十几个（TurnUsagePanel / StatsPills / ContextMeter / 插件管理器 /
 * 任务管理器的日期时间选择器…），且都在左栏「设置」之前 —— 取第一个必然点错，症状
 * 就是「点设置入口无反应」（实测复现）。**按可读名字选**（aria-label/文本命中
 * 设置|Settings），命中多个时取最靠左的（设置入口在左栏）；再退到文本恰为
 * 设置/Settings 的按钮。都找不到返回 null（静默收尾，不点任何可疑按钮）。
 */
/**
 * 账号菜单触发钮（官方 app 的设置入口真身）：AccountMenu 注册了 `settings.launcher`
 * （搜索 app.asar 的 AccountMenu.js 确认），其触发钮标记 = `aria-haspopup="menu"` +
 * `data-collapsed` / `data-signed-out` 属性（类名 hash 会变、属性名稳定）。点开的
 * 菜单里有「设置」项（onSelect(id==='settings') → openSettings()）。
 */
function findAccountMenuTrigger() {
  try {
    return document.body.querySelector(
      'button[aria-haspopup="menu"][data-collapsed], button[aria-haspopup="menu"][data-signed-out]',
    ) || null;
  } catch { return null; }
}
/**
 * 宿主「设置」入口的可读名锚点 —— **不能**只写中英两个字面词。
 *
 * 为什么不能写死"中英两个字面词"（实测过的失效形状）：
 *   · 宿主的语言由 `locale` 服务决定，**语言包可追加**（`ctx.locale.addLanguage`，
 *     见 `src/i18n.js` 头注释）⇒ 加到第三种语言时点入口就没反应，且**静默**；
 *   · 宿主把这一项改成别的措辞（"偏好设置" / "Preferences"）同样失配。
 *
 * 为什么不直接用 `weT("设置")`：本仓词表里 `"设置"` 是**动词**义（值 `"Set"`，
 *   唯一调用点是 `panel-tabs.js` 的"设置目录"按钮，与 `weT("更改")` 并列）
 *   ⇒ 它在英文下返回 "Set"，**匹配不到**宿主菜单项的 "Settings"。
 *   这是"中文原文即键"的固有歧义（同一个中文词在不同语境下是不同英文词），
 *   不是靠改词表值能解决的 —— 改了会让那个动词按钮变成 "Settings"。
 *
 * 因此用**候选集**：把"我们这边的译文"（语言包 / 与宿主同语言时命中）与"宿主已知的原文形态"
 * 并列。后几条（`"设置"` / `"設定"` / `"全局设置"` / `"Global settings"`）是**宿主 DOM 的原文**、
 * 不是我们界面的文案，所以它们按字面保留、**不翻译**，并在 `test/verify-i18n.mjs` 的
 * `VALUE_ALLOW` 里登记了理由（那几条豁免是"照字面匹配宿主"的正当例外）。任何一条命中即算。
 *
 * ⚠️ **匹配用「包含」而不是「相等」**：宿主的标签常带修饰（实测宿主左栏那颗是 `全局设置`，
 * 桌面壳里还会出现 `Global settings`），而且可能再挂徽标 / 省略号；相等匹配在宿主换个措辞时
 * 静默失效，包含匹配才容得下这些。候选串本身要足够特异 —— 本文件里用到它的两处
 * （左栏触发钮、账号菜单项）都先排除自家入口，见 `isSettingsLabel`。
 */
function settingsLabelCandidates() {
  const out = [];
  const push = (s) => { const v = String(s || "").trim(); if (v && !out.includes(v)) out.push(v); };
  push(weT("设置"));            // 语言包 / 与宿主同语言时最可能命中的一条
  push("设置");                 // 内置中文（词表值是动词义，这里显式补名词义）
  push("Settings");             // 内置英文（同上）
  push("設定");                 // 繁体中文语言包
  push("全局设置");             // 宿主左栏入口的措辞（实测；英文侧见下）
  push("Global settings");      // 同上，英文
  return out;
}
/** 文本是否命中宿主「设置」入口的任一已知标签（包含匹配，见 candidates 上方说明）。 */
function isSettingsText(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  // **长候选先于短候选**：包含匹配下 `设置` 也能命中宿主里别的按钮（如第三方插件的
  // 「按压泡泡设置」），只靠文档序裁决太脆。带上修饰的那几条（`全局设置` / `Global settings`）
  // 更特异，排在前面，命中即返回。
  return settingsLabelCandidates()
    .slice()
    .sort((a, b) => b.length - a.length)
    .some((c) => t.includes(c));
}
/** 账号菜单弹出后的「设置」菜单项（role=menuitem）。 */
function findSettingsMenuItem() {
  try {
    const items = [...document.body.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]')];
    return items.find((el) => isSettingsText(el.textContent)) || null;
  } catch { return null; }
}
function findSettingsTrigger() {
  const labelOf = (el) => {
    try {
      return ((el.getAttribute("aria-label") || "") + " " + ((el.textContent || "").trim())).trim();
    } catch { return ""; }
  };
  const isSettingsLabel = (el) => {
    // 必须排除我们自己的「壁纸引擎设置 ›」入口：它名字里也含「设置」，不排除会
    // 把自己当成宿主触发钮（实测：点入口=再调自己，递归点 5 次、对话框开不了）。
    try { if (el.getAttribute && el.getAttribute('data-we-qp-entry') === '1') return false; } catch { /* ignore */ }
    // 标签按**候选集**判（不是中英两个字面词）：理由见 isSettingsText 上方那段注释。
    return isSettingsText(labelOf(el));
  };
  const leftmost = (list) => list
    .slice()
    .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)[0] || null;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  try {
    const dialogTriggers = [...document.body.querySelectorAll('button[aria-haspopup="dialog"], [role="button"][aria-haspopup="dialog"]')]
      .filter(visible);
    const named = dialogTriggers.filter(isSettingsLabel);
    if (named.length) return leftmost(named);
    // 第二条腿：launcher 换实现（官方 app 自带的桌面组件会替掉 fallback 触发钮）时，
    // 按"可见按钮 + 名字命中"找，左栏优先。
    const texted = [...document.body.querySelectorAll('button, [role="button"]')]
      .filter((b) => visible(b) && isSettingsLabel(b));
    const inLeft = texted.filter((b) => b.getBoundingClientRect().left < 220);
    if (inLeft.length) return leftmost(inLeft);
    if (texted.length) return leftmost(texted);
    // 无名字的图标钮不猜了：官方 app 的设置入口是**账号菜单**（findAccountMenuTrigger
    // → 菜单项「设置」），几何兜底会误点「远程控制」之类（实测），故不设几何腿。
    return null;
  } catch { return null; }
}
let openSettingsBusy = false;
/**
 * 打开「壁纸引擎」设置分区；给了 `tabId` 就深链到设置页的对应页签
 * （`"appearance"` / `"playback"` —— 快捷播放面板底栏那两颗按钮用）。
 * 深链只写一个**瞬态请求**（`settingsTabRequest`），落地在 WallpaperPicker 的一个
 * effect 里走同一个 switchTab —— 打开对话框本身仍是下面那条 DOM 路径，一行没动。
 * 自动打开失手（超时分支）要顺手清掉请求：否则用户几分钟后自己开设置会被旧请求劫持。
 */
function openSettingsSection(tabId) {
  if (typeof document === "undefined" || openSettingsBusy) return;
  openSettingsBusy = true; // 重入锁：误点自己/连点不再递归（实测会递归自点 5 次）
  const release = () => { openSettingsBusy = false; };
  if (tabId) setTransient("settingsTabRequest", String(tabId));

  const clickOurNavRow = () => {
    let rows;
    try { rows = document.body.querySelectorAll("nav button"); } catch { return false; }
    // 锚点是**本插件注册的 nav label** ⇒ 它随语言变（en 下是 "Wallpaper Engine"）。
    // 每次点击现取一次译文，别把中文原文冻结成常量（冻结 = en 模式下找不到自己那一行）。
    const want = weT("壁纸引擎");
    for (const btn of rows) {
      if ((btn.textContent || "").trim() === want) {
        try { btn.click(); return true; } catch { return false; }
      }
    }
    return false;
  };
  // 对话框已经开着：直接定位本节。
  if (clickOurNavRow()) { release(); return; }
  // 代码路径优先（web 与应用同序）：账号菜单（AccountMenu launcher）→ 菜单「设置」项；
  // 该组合没有账号菜单（launcher 退回「设置」按钮）时才按名字找触发钮。
  const menuBtnEarly = findAccountMenuTrigger();
  const trigger = menuBtnEarly ? null : findSettingsTrigger();
  // 诊断：点的是谁 + 左栏可见按钮清单（成功/失败都落，一次点击即可精修匹配）。
  let dump;
  try {
    const visibleB = (b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    // 左栏底部（y>500）全列（设置钮就在那一段，slice 会把它切掉）+ 其余可见按钮摘要。
    const all = [...document.body.querySelectorAll('button, [role="button"], [aria-haspopup]')].filter(visibleB);
    const bottomOnes = all.filter((b) => b.getBoundingClientRect().left < 260 && b.getBoundingClientRect().top > 500);
    const others = all.filter((b) => !bottomOnes.includes(b)).slice(0, 8);
    dump = [...bottomOnes, ...others]
      .map((b) => ((b.getAttribute("aria-label") || "-") + "|" + ((b.textContent || "").trim().slice(0, 8))
        + "|" + (b.getAttribute("aria-haspopup") || "-") + "|" + Math.round(b.getBoundingClientRect().top)))
      .join("; ");
  } catch { dump = "dump-failed"; }
  reportClientDiag("settings-entry", (trigger
    ? "trigger=\"" + (((trigger.textContent || "").trim() || trigger.getAttribute("aria-label") || "?").slice(0, 24))
      + "\" x=" + Math.round(trigger.getBoundingClientRect().left)
    : "trigger=none")
    + " cand=[" + dump.slice(0, 240) + "]");
  let menuMode = false;
  if (trigger) {
    try { trigger.click(); } catch { release(); return; }
  } else {
    const menuBtn = menuBtnEarly || findAccountMenuTrigger();
    if (menuBtn) {
      menuMode = true;
      try { menuBtn.click(); } catch { release(); return; }
    } else {
      // 兜底：设置的默认快捷键（settings.open = Cmd/Ctrl+,）。
      try {
        const primary = (typeof navigator !== "undefined" && /Mac/i.test(String(navigator.platform || navigator.userAgent || "")))
          ? { metaKey: true } : { ctrlKey: true };
        document.dispatchEvent(new KeyboardEvent("keydown", {
          key: ",", code: "Comma", bubbles: true, cancelable: true, ...primary,
        }));
      } catch { release(); return; }
    }
  }
  // 等传送门挂载：短轮询（至多 ~6s）——比单靠 MutationObserver 更耐懒渲染与
  // 冷启动（实测：reload 后首点开对话框可超 2.5s，窗口太短会误判失败）；点到立刻停。
  let clickedNav = false;
  const started = Date.now();
  const tick = () => {
    if (clickedNav) return;
    if (menuMode) {
      const item = findSettingsMenuItem();
      if (item) { try { item.click(); } catch { /* ignore */ } menuMode = false; }
    }
    if (clickOurNavRow()) { clickedNav = true; release(); return; }
    if (Date.now() - started > 6000) {
      reportClientDiag("settings-entry-timeout", "dialog=" + Boolean([...document.querySelectorAll('[role="dialog"]')].length));
      // 深链请求一并清掉（见函数头）：打不开就别留着它等下一次。
      if (tabId) setTransient("settingsTabRequest", "");
      // 给用户一条确定的手动路径（自动打开失手时）。
      try {
        const entry = document.querySelector('button[data-we-qp-entry]');
        if (entry) entry.title = weT("自动打开未成功：请按 Cmd/Ctrl+, 或点左栏的设置入口");
      } catch { /* ignore */ }
      release();
      return;
    }
    scheduleWeTimeout(tick, 120);
  };
  scheduleWeTimeout(tick, 60);
}

export {
  weSidebarCtrl,
  WE_SIDEBAR_KIND,
  sidebarRightMode,
  sidebarRightOpen,
  sidebarRightOursActive,
  ropeDrawerControl,
  wallSidebarOpen,
  wallSidebarClose,
  wallSidebarToggle,
  scheduleWeTimeout,
  clearWeTimeout,
  installSidebarRight,
  installWallSidebarShortcut,
  findAccountMenuTrigger,
  settingsLabelCandidates,
  isSettingsText,
  findSettingsMenuItem,
  findSettingsTrigger,
  openSettingsBusy,
  openSettingsSection,
};
