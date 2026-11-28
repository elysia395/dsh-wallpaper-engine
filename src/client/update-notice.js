/**
 * update-notice.js — 更新公告（what's new）组件与哨兵，从 `src/client.js` 按族搬出，函数体逐字未改。
 *
 * 契约：
 *   1) 本文件不 import —— 构建期由 scripts/build-client.mjs 内联在正文之前，与正文同处一个扁平作用域；
 *      函数体引用的 selection / setSetting / setTransient / emit / weT / React 等自由名由正文与其它内联模块提供。
 *   2) 搬移只改了"声明住哪"：正文与拆前 src/client.js 的 3535–3763 行逐字节相同。
 *   3) 顶层状态只有字面量（若有）：不读正文的 const、不挂监听 ⇒ 无 TDZ 风险。
 */
// ── One-time "what's new" notice ─────────────────────────────────────────────
// The notice carries four user-facing stories:
//   ① session avatars got a big import upgrade — SVG / GIF / BMP / AVIF now
//      supported, oversized images get an「auto-compress & import」escape hatch,
//      and a crop dialog runs before upload (Extensions tab),
//   ② a batch of fixes — live scene wallpapers in multiple windows stop kicking
//      each other off; web-wallpaper audio reactivity under the strict sandbox;
//      inline code in thinking blocks, native dropdown popups and the preset
//      dialog display correctly again,
//   ③ Linux X11 occlusion power saving — a covered window drops frames, a fully
//      covered one pauses (more battery left),
//   ④ a bold tip: enabling dark mode + the「作者自用」preset is one of the
//      plugin's best looks.
// The notice art (GitHub star plea, shipped as lib/about/update-notice.jpg and
// served by the /about-qr whitelist route — same family as the contact QRs,
// NOT inlined: see src/about-assets.js) sits at the top with a caption
// that links straight to the repo — this is the star entry the notice carries.
// The dismissal version is stored WITH the
// settings (host file, port-independent) so it survives DSH Desktop's random
// --port restarts and never re-shows after being closed. Bump NOTICE_VERSION
// next release to announce something new again (swap the art bytes in
// lib/about/, the path stays put — ETag revalidation picks it up).
//
// ⚠️ 公告**等配图就绪才弹**（art-gate，见 UpdateNotice）：面板 bundle 宿主每次开页
// 都从磁盘现读，而后端路由只在 DSH 重启时换血 —— 更新后未重启的窗口期里，旧后端
// 的 /about-qr 白名单还没有 update-notice.jpg ⇒ 图 404。若照旧立刻弹窗，用户看到
// 裂图，而「知道了」一关整版公告永久退场，配图等于永远没人看到。
// ⚠️ 公告正文与配图是**随版本换血**的：改内容就要升哨兵（否则看过旧版的用户永远看不到
// 新说明，改了等于没改 ⇒ 重弹一次是设计意图）。配图下方那行是**求星跳转** —— 与正文四条
// 各管一件事，同守 `art === "ready"` 的门控。
// ⚠️ 1.4.2 是**纯缺陷修复版**（拖动吉祥物导致右侧栏按帧开合），公告正文一个字没改
// ⇒ 哨兵**故意**停在 "1.4.1"：为一次 bugfix 再弹一遍同样的六条，是在消费用户的注意力。
// 下一个有用户可见新内容的版本才动这个值。
const NOTICE_VERSION = "1.4.1";
// 配图就绪探针的节奏：HEAD 轮询到新白名单在场（= 后端已重启）才弹；旧后端一直
// 不在场超过 WAIT 则降级为**无图**弹出（文案信息完整；求星入口另有「关于」页那枚常驻按钮
// 与它的重看按钮，不靠弹窗这一条命）。探针打在 /about-qr 上是自清洁的：404 响应 no-store、200
// no-cache（packages/about-notice/lib/routes/about-qr.js），怎么轮询都不会污染 Electron 缓存。
const NOTICE_ART_WAIT_MS = 90000;
// 探针的**退避表**（不是固定间隔）：旧后端在场时，1.5s 一拍的固定轮询在一个时限里就是
// 60 个 HEAD，而每个 404 都会在 DevTools 控制台留下一行 —— 用户看到的是"一屏红字"
// （实测：未重启的后端 + 面板多开几次 ≈150 行 404）。
// 请求本身是自清洁的，但刷屏不是。换成 1.5→3→6→12→30（表尾封顶）后，同一时限内
// 总请求数 **≤10**（见 noticeArtSchedule），而"新后端一上线就带图弹"的灵敏度几乎不变
// —— 第一拍仍在挂载瞬间，最坏情况只是晚一拍发现。
const NOTICE_ART_BACKOFF_MS = [1500, 3000, 6000, 12000, 30000];
// 同一次**页面加载**内只探一个结论：面板可反复开关（每次挂载都新建组件、重跑 effect），
// 但"这台机器上这个后端有没有那张图"是页面级事实 —— 缓存下来后多开面板只发一轮请求。
// 空串 = 还没结论；"ready"/"timeout" 是**终态**（不做 TTL：页面刷新即重新探，恰好等价于
// "后端重启后刷新页面就能拿到图"）。用模块级变量而不是 store 字段：纯视图态，进 store
// 会平白多一对瞬态字段要过直写棘轮（与 art 用组件本地 state 同一条理由）。
let noticeArtVerdict = "";
// 「重新查看本版更新公告」的**请求位**（关于页那枚按钮经 `onReopenNotice` 回调写它；消费在
// `UpdateNotice`，清在它的 `dismiss()`）。
// 不变量：① 它是**页面级视图态**（刷新即失效）—— 公告"看过了"的真源始终是 `settings.noticeSeen`，
// 这里只记"刚才有人点过重看"；② 它是**模块级变量而非 store 字段**，与上面的 `noticeArtVerdict`
// 同一条理由（纯视图态进 store 会平白多一个瞬态字段要过直写棘轮）。
let noticeReopenRequest = false;

/**
 * 配图探针的时刻表（**纯函数**：判据在真源码上跑它，见 test/verify-about.mjs ⑤）。
 * @param {number} waits   总时限（ms）—— 到点仍未就绪就降级
 * @param {number[]} backoff 退避表（ms，表尾持续复用 = 封顶）
 * @returns {number[]} 每次请求的相对时刻（ms），首个恒为 0（挂载即探）
 * 末拍允许被时限**截短**（`min(step, left)`）：这样"等满时限"那一拍仍然真的发出，
 * 降级判定紧跟其后（失败回来时看是否超时）。
 */
function noticeArtSchedule(waits, backoff) {
  const out = [0];
  let t = 0;
  let i = 0;
  for (;;) {
    const left = waits - t;
    if (left <= 0) break;
    const step = backoff[Math.min(i, backoff.length - 1)];
    const next = t + Math.min(step, left);
    if (next <= t) break;
    out.push(next);
    t = next;
    i += 1;
  }
  return out;
}

// ❗ 的字体强制：U+2757 在正文字体栈里落到细杆字形（实测渲染成细红竖线，用户口径
// 是"红色感叹号"）—— 单包一层 span 强制走 Segoe UI Emoji，出来的才是胖红感叹号。
const noticeEx = (n) => React.createElement("span",
  { style: { fontFamily: '"Segoe UI Emoji", "Noto Color Emoji", sans-serif' } }, "❗".repeat(n) + " ");

function UpdateNotice() {
  useWeLocale(); // 更新说明是长文案，语言切换后要跟着换（同一棵 RopeDock 子树）
  const sel = useStore();
  // Art-gate 探针：pending（探测中，什么都不弹）→ ready（新后端在场，带图弹）→
  // timeout（等满 WAIT 仍 404，降级为无图弹）。用组件本地 state 而不是共享
  // selection —— 纯视图态，进 store 会平白多一对瞬态字段要过直写棘轮。
  //
  // ⚠️ **手动重看时必须从 pending 起步**，不能拿缓存结论当初始值：`noticeArtVerdict` 是
  // **页面级**缓存，可能停在任何终态（`timeout` = 那次没等到图、按无图降级过）。拿它当初始
  // art 会让重看直接按"无图公告"渲染，而**配图下方那行求星链接与配图同一条门控** ⇒ 那条腿
  // 整条不渲染，用户看到的就是"点了没反应"。从 pending 起步 + 下面 effect 让手动请求重新探
  // 一次，语义才对：手动重看应当现算"这台机器的后端**现在**有没有这张图"。
  const [art, setArt] = React.useState(noticeReopenRequest ? "pending" : (noticeArtVerdict || "pending"));
  // ⚠️ 上面这个初始化式读模块级 `noticeReopenRequest`（模块级 `let`，声明在 `UpdateNotice`
  //    之前）—— 模块求值期不读它，只在组件渲染期读，所以不存在 TDZ 面。
  // Only render once the host settings (source of truth) are applied, so the
  // persisted noticeSeen is final. On a fresh port/restart the localStorage
  // origin is empty (noticeSeen == "") and would briefly flash the notice before
  // the host GET merges the real value — wait for hostLoaded to avoid that.
  const eligible = sel.hostLoaded && sel.noticeSeen !== NOTICE_VERSION;
  // 「重新查看本版更新公告」：关于页那枚按钮把请求位立起来，本组件**随时挂载** ⇒ emit() 一响
  // 这里就重渲染、读到 true ⇒ 即使 noticeSeen 已是本版也照样展示一次（这正是该按钮的用途：
  // 公告是"一等版本弹一次"的展示面，用户想再看时不该只能改设置文件）。
  // 只读、不消费：请求位由 `dismiss()` 清（见那里），这样"知道了"一关就回到正常口径。
  const reopenRequested = noticeReopenRequest;
  // 更新公告整块（含配图那条 `/about-qr/update-notice.jpg` 腿）归 `about-notice` 组件行
  // （ADR-0013 D3②）：那一行关掉 ⇒ 公告**整块不弹**，探针也一个请求都不发（路由整族没了，
  // 探到的是必然的 404）。判据只此一处实现 —— `weComponentVisible`。
  // ⚠️ 手动请求那条支路**仍受这一行约束**（按钮本身也长在这一行的 gate 之内，见
  // `renderAboutTab`）：两者同源，不会出现"重开后无按钮"或"行关了还能弹"的错配。
  const componentOn = weComponentVisible(sel.inventory && sel.inventory.components, "about-notice");
  React.useEffect(() => {
    // 已关过本版公告、且这次也不是手动请求 ⇒ 一个请求都不发（每次开面板都探一遍是纯浪费）。
    if (!eligible && !reopenRequested) return undefined;
    // 组件行（about-notice）不可用 ⇒ 它那一族路由整族没注册，探到的是必然的 404 —— 一个请求
    // 都不发。与上面那句**分开写**：两条门挡的是两件不同的事（用户已关公告 / 组件行关了）。
    if (!componentOn) return undefined;
    // 同一页面已有结论 ⇒ 直接采纳，一个请求都不再发（多开面板 / 来回切页不复探）。
    // ⚠️ **手动重看不吃这条缓存**：用户点「重新查看本版更新公告」的语义是"现在让我再看看"，
    // 要的是"此刻这台机器的后端有没有那张图"的现算结论（他可能刚重启过 DSH）。吃缓存会按旧
    // 结论（可能是 timeout 的无图形态）弹出来，那条求星腿就跟着没了。
    if (noticeArtVerdict && !reopenRequested) { setArt(noticeArtVerdict); return undefined; }
    let alive = true;
    const timers = [];
    const schedule = noticeArtSchedule(NOTICE_ART_WAIT_MS, NOTICE_ART_BACKOFF_MS);
    const probe = (i) => {
      // apiHead 不抛（api-client 契约）：404/断网都是 ok:false —— 落到时刻表的下一拍，
      // 走完最后一拍仍在 404 就降级（timeout = 无图弹出，文案信息完整）。
      apiHead(NOTICE_ART_PATH).then((r) => {
        if (!alive) return;
        if (r.ok) { noticeArtVerdict = "ready"; setArt("ready"); return; }
        if (i + 1 >= schedule.length) { noticeArtVerdict = "timeout"; setArt("timeout"); return; }
        timers.push(setTimeout(() => probe(i + 1), schedule[i + 1] - schedule[i]));
      });
    };
    timers.push(setTimeout(() => probe(0), schedule[0]));
    return () => { alive = false; for (const t of timers) clearTimeout(t); };
  }, [eligible, componentOn, reopenRequested]);
  // 展示条件：正常口径（本版没看过）**或** 用户手动请求重看（关于页那枚按钮）。
  // 两条都受 `componentOn` 约束（组件行关了 ⇒ 公告整族没了）。
  // `reopenRequested` 进依赖数组：请求位在 effect 之外被置起来时（关于页点击 → emit → 本组件
  // 重渲染）要重新评估探针那一段，否则"手动重看却拿不到 art 结论"会卡在 pending 不显示。
  const show = componentOn && (reopenRequested || eligible) && (art === "ready" || art === "timeout");
  const dismiss = () => {
    // Persist the dismissed version through the settings pipeline (localStorage
    // cache + host file). emit() re-renders this component (useStore) to hide it.
    setSetting("noticeSeen", NOTICE_VERSION);
    // 手动请求也要清掉：否则这一次关掉后 `show` 仍为真（请求位还立着）⇒ 关不掉。
    // 命令式写法（不是 setState）—— 与请求位的模块级归属一致：它记的是"请求发生过了"。
    noticeReopenRequest = false;
    emit();
  };
  if (!show) return null;
  // ══ UPDATE NOTICE COPY（begin）══════════════════════════════════════════════
  // 下面到 end 之间的区段是**纯公告文案**：CI 的 `notice` 快通道只在这一段内放行
  // "只改字符串内容"的提交。判据是**内容级**的（见 test/tools/ci-routing.mjs 的
  // judgeNoticeEdit）：① 区块外逐字节完全一致；② 区块内剥掉字符串内容后的**代码骨架**
  // 逐字一致。改结构（增删条目、改 props、加分支）⇒ 骨架变 ⇒ 回落 `npm run verify:all`。
  // ⚠️ 不要在这里写注释以外的逻辑：注释会被骨架判据剥掉（所以写注释是安全的），
  //    任何可执行 token 的增删都会让骨架判据判红。
  return React.createElement("div", { className: "we-update-notice", role: "alert" },
    React.createElement("div", { className: "we-update-notice__title" }, weT("🎉 更新：图片幻灯片壁纸 · 桌宠联动重写 · 玻璃更稳")),
    // 只有 ready 才渲染配图与说明行（timeout 降级态无图弹出，正文信息自足）。
    // 图下那行是**求星入口**（见下面的说明），所以它随配图同一条门控：无图降级态没有它，
    // 但求星入口另有「关于」页那枚常驻按钮兜住，不是唯一命脉。
    art === "ready" ? React.createElement("img", {
      className: "we-update-notice__art",
      src: apiUrl(NOTICE_ART_PATH),
      alt: weT("新朋友「星来」登场"),
      // D3③ 的 `<img>` 兜底：探针过了（HEAD 通）但取字节时仍失败 ⇒ 就地退回那条**无图公告**
      // （与等满时限的降级态同一个形态，正文信息自足），不留破图。
      onError: () => setArt("timeout"),
    }) : null,
    art === "ready" ? React.createElement("div", { className: "we-update-notice__art-cap" },
      // 求星入口：配图下方这一行是**真跳转**（不是纯文字指路），用户读完图就能一步到仓库。
      // 用 `<a>` 而不是 `<button>`：外链交给浏览器原生行为（新窗 / 中键 / 修饰键都对），
      // 与关于页那枚 Star 按钮同款；`we-picker__btn--primary`（实心 accent + 墨随 accent）
      // 在公告的恒定深色玻璃底上**逐字沿用**，不另造一套公告专用按钮样式。
      // ⚠️ **不变量：公告底部只许有一枚 `<button>`**（`知道了`）。`test/compat-harness-pages.mjs`
      // 用 `document.querySelector('.we-update-notice__btn')` 定位"知道了"来关公告；再加一枚
      // 同名 class 的 `<button>` 会让它点到错的那枚。所以求星这条腿用 `<a>` + 自己的
      // `we-update-notice__star` 类。
      // 只在 `art === "ready"` 时渲染（与配图同一条门控）：无图降级态的正文信息自足，
      // 且求星入口另有「关于」页那枚常驻按钮与它的重看按钮 —— 这条腿不是唯一命脉。
      React.createElement("a", {
        className: "we-update-notice__star we-picker__btn we-picker__btn--primary",
        href: ABOUT_REPO_URL,
        target: "_blank",
        rel: "noopener noreferrer",
        title: weT("在浏览器里打开项目仓库"),
      }, weT("⭐ 去 GitHub 点亮 Star"))) : null,
    React.createElement("div", { className: "we-update-notice__body" },
      // 行文体例（用户口径：简单公告）：简洁 + 大字 —— 只讲五件事，
      // 全部走 16pt callout（.we-update-notice__callout），每条一句不加尾巴长文。
      React.createElement("p", { className: "we-update-notice__callout" },
        "① ", noticeEx(2), React.createElement("strong", null, weT("关掉也能再看")),
        weT("：本公告点「知道了」后不再自动弹出，想回顾就到「设置 → 壁纸引擎 → 关于」点「重新查看本版更新公告」。")),
      React.createElement("p", { className: "we-update-notice__callout" },
        "② ", noticeEx(2), React.createElement("strong", null, weT("图片 / 幻灯片壁纸")),
        weT("：WE preset 型图片项目直接可用；多图项目自动成图集，播放页新增「图片轮播」节奏下拉（跟随壁纸 / 5 秒–5 分钟）。")),
      React.createElement("p", { className: "we-update-notice__callout" },
        "③ ", noticeEx(2), React.createElement("strong", null, weT("玻璃更稳")),
        weT("：首启与行开关不再闪黑或残留坏滤镜；第三方弹窗在玻璃下不再半透明透字。")),
      React.createElement("p", { className: "we-update-notice__callout" },
        "④ ", noticeEx(2), React.createElement("strong", null, weT("桌宠联动重写")),
        weT("：接入官方安装引导，设置页开关点按立即生效，重开页面不再回弹。")),
      React.createElement("p", { className: "we-update-notice__callout" },
        "⑤ ", noticeEx(2), React.createElement("strong", null, weT("头像排版修复")),
        weT("：消息行改两列布局，第三方表情包不再抢占行首、不再冒出「两张头像并排」；表情收进横排容器排在正文之后。")),
      React.createElement("p", { className: "we-update-notice__callout" },
        "⑥ ", noticeEx(2), React.createElement("strong", null, weT("另修一批")),
        weT("：设置面板分段控件与色板行不再被长说明挤扁，中文字体名正常显示；库存加载失败不再误关自动轮播；大清单恢复压缩提速；UI 受压自动降帧防冻结；非默认玻璃配色不再遮挡壁纸。")),
      React.createElement("p", { className: "we-update-notice__hint" },
        weT("升级后建议重启一次 DSH，改动才完整生效；本提示每个新版本只出现一次，点下方按钮关闭后不再弹出。"),
        weT("本版已发布到 npm，可直接按包名安装。")),
    ),
    React.createElement("button", { className: "we-update-notice__btn we-picker__btn", type: "button", onClick: dismiss }, weT("知道了")),
  );
  // ══ UPDATE NOTICE COPY（end）════════════════════════════════════════════════
}
