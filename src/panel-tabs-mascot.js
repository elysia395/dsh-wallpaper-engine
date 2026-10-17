/**
 * 「吉祥物」页签的节渲染器与其模块级常量 / 拖拽状态（原 src/panel-tabs.js）。
 * MASCOT_* 常量与 mascotDrag / mascotDragMoved / mascotRingLogical 都随本节搬到这里；
 * renderMascotTab 仍在组装点（src/panel-tabs.js）；本节渲染器从 src/panel-tabs.js 按域搬出，函数体逐字未改。
 */
  // ── 吉祥物形态：**3D 圆环转盘**（**四次返工**；形态取自用户给的 `28-3d.html`）──
  // 前三版各自的形态与缺陷（经过都记在 docs/CHANGELOG.md，这里只留结论）：
  //   ① 卡片一排 —— 平铺，不像转盘；
  //   ② 铺满舞台的绝对定位层 + 行内百分比位移 —— 中心层的**按钮盒**（立绘 64 + padding 16 = 80）
  //      压住相邻项约 12px ⇒ 每个侧项一条点不到的死带；且"自定义生效时把内置项与 ‹ › 全禁用"
  //      ⇒ 用户实测「**按钮都没办法点**」；
  //   ③ 流式轨道（定宽项 + 整轨位移）—— 有界滚动，选中**末项**时右半屏整片空着（用户截图）；
  //   ④ 现在：**真 3D 圆环** —— 每张卡 `rotateY(i·步进) translateZ(半径)`，整环 `rotateY(−逻辑索引·步进)`。
  //      前三类缺陷在结构上都不存在了：环是闭合的（任一档左右都有邻居）、前后由**真实 z** 决定
  //      （不靠层叠 + z-index 猜）、背面由 `backface-visibility: hidden` **整张剔除**
  //      （|φ| > 90° 的卡是环的后半圈，不剔会透到中间、看着很乱）。
  // ⚠️ **半径是解出来的、系数是量出来的**（verify-client 的环形几何判据会独立复算一遍）：
  //      相切半径 = (卡宽/2)/tan(π/n)（相邻两卡正好相切）⇒ 乘系数 = 留出间距。
  //      系数 **1.15** 的实测依据：1.00 时相邻卡的**可点盒相切重叠** ⇒ 前卡抢走邻卡的点击
  //      （就是 ② 那类"看着能点、点了却是别人"）；1.28 时侧栏里 ±2 档可见度掉到 **0.00**
  //      ⇒ 只剩 3 张、没有纵深。1.15：前排占舞台 **31%**、±1 邻卡 **100% 完整可见**、
  //      邻卡**零抢点**、±2 档仍露 46% 提供纵深。
  // ⚠️ **可点盒宽 = 立绘显示宽（64），不留透明内边距**：留了的话那圈透明边会盖在邻卡上
  //      抢走它的点击 —— ②的死带正是这么来的。这条由判据钉住。
  // ⚠️ 舞台有 `max-width`（340）：环是固定尺寸的（立绘宽固定 64），不封顶的话在宽面板里
  //      会变成正中间一小撮、四周全是空。
  const MASCOT_BOX_PX = 64;         // 卡宽 = 立绘显示宽（两者必须相等，理由见上）
  const MASCOT_RING_FACTOR = 1.15;  // 半径系数（1.0 = 相邻立绘正好相切）
  const MASCOT_PERSP_PX = 820;      // 透视 = 舞台上限 340 × 2.4（参考实现的公式）取整
  // ── 按**面板实测宽度**等比缩放（用户口径：「这个左右也可以拉宽一点，顶格就行」）──
  // ⚠️ 为什么只能**等比**缩放：卡宽与半径锁在同一比例（半径 = (卡宽/2)/tan(π/n)×系数）——
  //    只放大卡宽会让相邻卡的可点盒重叠 ⇒ 前卡抢走邻卡的点击（历次缺陷的共同形态）；
  //    只放大半径会让卡片散成"天女散花"。所以两者必须同乘一个 scale。
  // ⚠️ 等比缩放要**连透视 P 一起乘**：放大率 k = P/(P−R)，P 与 R 同乘时 k 不变 ⇒
  //    投影出来的排布与设计档**逐点相似**，"邻卡不重叠"这条性质在任意 scale 下自动成立
  //    （不必重新解不等式 —— 这正是判据能简单地对任意 scale 复算的原因）。
  // ⚠️ scale 的**上限由高度预算**定：等比放大同时变高（窗口高 ∝ scale）。面板宽到一定程度后
  //    再放大只会得到一个巨大的控件，所以到顶就停。两个数都写在这儿，改之前先读下面的算式。
  /** s = 1 的设计宽度（按侧栏那一档标定：面板内容宽 328 时环正好铺满）。 */
  const MASCOT_DESIGN_PANE_PX = 328;
  /**
   * s 的上限。**它其实是一条高度预算**，换算关系（改之前先算一遍）：
   *   窗口高 = (最高立绘 96 × s + 排版余量 36) × 前排放大率 1.2006 + 12
   *   ⇒ s = 2.1 时窗口高 ≈ **298px**（实测：卡宽 134、半径 288、透视 1722）。
   * ⚠️ 为什么必须有上限：等比放大**同时变高**。而 **11 项环最多可见 5 张**
   *    （|φ| ≥ 90° 被背面剔除，与半径无关）⇒ "要填满 900px 面板"得把 s 提到 ≈3.2，
   *    即卡宽 203px、**窗口高 504px** —— 那不是"拉宽"，是换一个占掉大半屏的巨大控件。
   *    想更宽/更窄就调这个数；上面那行式子就是它的换算依据（判据按同一算式复算）。
   */
  const MASCOT_SCALE_MAX = 2.1;
  // ── 卡高**不写死**：由「最高的那只立绘」推出来（在渲染器里算，见下）─────────────────
  // ⚠️ 写死过 120，而最高的立绘是Deepseek_Pro的 **96px** —— 96 + padding 12 + gap 4 + 名字行 ≈13
  //    = **125 > 120**，卡内内容本身就溢出 4px（名字行被挤出卡片）。这是用户实测
  //    「上下有截断」的**第二个**来源（第一个是 3D 透视把卡片整体放大，见下）。
  //    改成"从立绘推"之后，以后加一只更高的立绘，卡高会自动跟着长。
  /** 卡内排版余量：上下 padding(6+6) + 立绘与名字之间的 gap(4) + 名字行(≈13) + 呼吸(7)。 */
  const MASCOT_CARD_PAD_PX = 36;
  /** "点"与"拖"的分界（px）。低于它算点击 —— 否则手抖 1px 就被当成拖动。 */
  const MASCOT_DRAG_SLOP_PX = 6;
  /** 抛掷投影时长（s）：落点 = 当前位置 + 速度 × 这个值。参考实现同值。 */
  const MASCOT_FLING_S = 0.32;
  /** 取样陈旧阈值（ms）：松手前超过这么久没有新样本 ⇒ 手指早已停 ⇒ 速度按 0 算。 */
  const MASCOT_FLING_STALE_MS = 70;
  // 拖动的**瞬时**状态：只活在"按下 → 抬起"之间，不进 settings、不进 localStorage。
  // ⚠️ `mascotDragMoved` 必须是**模块级**：指针抬起后 `onRopeFormChange` 会触发重渲染，
  //    闭包里的标志会被换成新的一份，而 `click` 是**之后**才到的 —— 放闭包里等于没生效
  //    （症状就是"拖一下换了两只"）。
  let mascotDrag = null;
  let mascotDragMoved = false;
  // **环的视图索引**（模块级，同属"视图状态"）：当前居中的逻辑索引。
  // ⚠️ 它必须与 `sel.ropeForm` 一致（不变量：中心 = 当前生效的形态）；不一致时以 settings 为准
  //    对齐（见渲染器里的 `alignedLogical`）——预设应用 / 外部改动会碰到这种情况。
  // ⚠️ 它**可以超出 [0, n)**：真值域是"整数槽位"，靠它才能**走近路**（从第 0 档往左一格到第
  //    n−1 档，而不是倒着转 n−1 格）。渲染器**只读不写**（panel-tabs 的契约 ④：渲染期不得改写
  //    模块级状态），写只发生在处理器里。
  let mascotRingLogical = 0;

  function renderMascotFormCards(sel, previewArt, previewW, previewH, onRopeFormChange, onMascotPick, onMascotClear, onMascotFormConfirm, onDisarmConfirm, paneWidth) {
    const customArt = previewArt.custom;
    const forms = ROPE_FORM_VALUES.map((k) => ({ id: k, kind: "builtin", form: ROPE_FORMS[k] }));
    // 自定义那一项排在最后（用户口径：导入后显示在最后）。
    const items = forms.concat([{ id: "custom", kind: "custom" }]);
    const builtinIdx = forms.findIndex((f) => f.id === sel.ropeForm);
    // **不变量：中心 = 当前生效的那一个**（中心若不是选中项，用户一眼看不出现在用的是哪个）。
    const activeIdx = customArt ? items.length - 1 : (builtinIdx >= 0 ? builtinIdx : 0);
    // ── scale：按**面板实测宽度**等比缩放（量不到 ⇒ 1，与设计档逐字相同）────────────────
    // `paneWidth` 由两端的面板组件量好经 ctx 传进来（渲染器是纯函数、拿不到宽度）；
    // 量不到（0 / undefined / 非数）时退回 1 —— **安全兜底**：宁可小，也不能把控件画坏。
    const paneW = Number(paneWidth) > 0 ? Number(paneWidth) : 0;
    const SCALE = paneW > 0
      ? Math.round(Math.min(MASCOT_SCALE_MAX, Math.max(1, paneW / MASCOT_DESIGN_PANE_PX)) * 100) / 100
      : 1;
    /** 设计档尺寸 × scale，取整（判据按同一算式复算，见 verify-client）。 */
    const at = (v) => Math.round(v * SCALE);

    // ── 环的几何（全部**由项数与卡宽推出**，没有魔法数）──────────────────────────────
    const n = items.length;
    const STEP_DEG = 360 / n;                       // 相邻两卡的角度间隔（环闭合 ⇒ 整除 360）
    const BOX_S = at(MASCOT_BOX_PX);                // 卡宽（= 立绘显示宽，两者必须相等）
    const PERSP_S = at(MASCOT_PERSP_PX);            // 透视（必须与半径同乘，见上）
    const RADIUS_PX = at((MASCOT_BOX_PX / 2) / Math.tan(Math.PI / n) * MASCOT_RING_FACTOR);
    /** 真模：JS 的 `%` 对负数返回负值，`((x % n) + n) % n` 才是数学模。 */
    const norm = (v) => ((v % n) + n) % n;
    /** 从 from 到 to 的**最短有符号步数**（∈ [−n/2, n/2]）—— "走近路"就靠它。 */
    const shortest = (from, to) => {
      const d = ((to - from) % n + n) % n;
      return d > n / 2 ? d - n : d;
    };
    // 拖拽灵敏度：**拖过一个「相邻卡在屏幕上的间距」= 换一档**（1:1 跟手，且有据可依）。
    // 相邻卡中心的屏幕间距 = R·sin(步进) × 它所在 z 处的透视缩放。
    const RAD_STEP = (STEP_DEG * Math.PI) / 180;
    const ADJACENT_PX = RADIUS_PX * Math.sin(RAD_STEP)
      * (PERSP_S / (PERSP_S - RADIUS_PX * Math.cos(RAD_STEP)));
    const DEG_PER_PX = STEP_DEG / ADJACENT_PX;
    const DRAG_LIMIT_PX = n * ADJACENT_PX;          // 一次拖动最多转一整圈
    // ── 环的**水平外沿**：取所有"朝向观众那一侧"卡片里最靠外的那个边（四角投影算）──────
    // 用途是给窗口一个 `max-width`：窗口**贴住环**（而不是写死 340 或铺满整行）——
    // 铺满整行会在环两侧留下大片空白（用户看到的"中间一小坨"就是这么来的）。
    const RING_EXTENT_PX = (() => {
      const half = Math.floor((n - 1) / 2);          // |d| ≤ half；|φ| ≥ 90° 的已被背面剔除
      let ext = 0;
      for (let d = 0; d <= half; d++) {
        const phi = ((d * STEP_DEG) * Math.PI) / 180;
        if (Math.abs(phi) >= Math.PI / 2) break;
        const cx = RADIUS_PX * Math.sin(phi), cz = RADIUS_PX * Math.cos(phi);
        const ux = Math.cos(phi), uz = -Math.sin(phi);
        for (const sx of [-1, 1]) {
          const x = cx + sx * (BOX_S / 2) * ux;
          const z = cz + sx * (BOX_S / 2) * uz;
          ext = Math.max(ext, Math.abs(x * (PERSP_S / (PERSP_S - z))));
        }
      }
      return Math.ceil(ext);
    })();
    // ── 卡高与窗口高**算出来**（用户实测「上下有截断」）────────────────────
    // 两笔账，缺一笔就会切掉东西：
    //   ① **卡内**：卡高必须容得下最高的那只立绘 + padding + gap + 名字行（都随 scale 放大）。
    //   ② **卡外**：3D 透视会把卡片**整体**放大，前排放大率 k = P/(P−R) ⇒ 窗口必须按
    //      `ceil(卡高 × k) + 上下各 6px` 来给，否则立绘头顶与名字底部被切。
    const TALLEST_ART_PX = Math.max(...items.filter((it) => it.kind === "builtin").map((it) => it.form.h));
    const CARD_H_PX = at(TALLEST_ART_PX) + MASCOT_CARD_PAD_PX;
    const FRONT_ZOOM = PERSP_S / (PERSP_S - RADIUS_PX);
    const WINDOW_H_PX = Math.ceil(CARD_H_PX * FRONT_ZOOM) + 12;

    // ── 与 settings 对齐的**逻辑索引**（只读；写只发生在处理器里，见文件上方说明）────────
    // 不一致 ⇒ 以 `activeIdx`（= 当前生效的形态）为准：**不变量优先于"走近路"**。
    const alignedLogical = norm(mascotRingLogical) === activeIdx ? mascotRingLogical : activeIdx;
    /** 第 i 张卡相对**前排**的最短偏移（槽位，∈ [−n/2, n/2]）：决定它的透明度。 */
    const slotOffsetOf = (i) => shortest(alignedLogical, i);
    /** 越靠后越淡（|偏移| ≥ 3 的卡已被 backface-visibility 整张剔掉，这里的值用不上）。 */
    const opacityOf = (off) => {
      const a = Math.abs(off);
      return a === 0 ? 1 : Math.max(0.45, 0.88 - (a - 1) * 0.22);
    };

    // ── 跳到某一张 ──────────────────────────────────────────────────────────────
    /** 把环转到第 i 张（**走近路**：取离当前位置最近的等价角度，不倒着转大半圈）。 */
    const focusCard = (i) => {
      const target = alignedLogical + shortest(norm(alignedLogical), i);
      mascotRingLogical = target;
      onRopeFormChange(items[norm(target)].id);
    };
    /**
     * 点卡片 / 点圆点 / 按 ‹ › 的**统一入口**。
     * ⚠️ 「自定义立绘」是**动作**（选文件）而不是"一种形态" ⇒ 它不是落点：
     *    点它 = 导入；拖动碰上它要顺着同方向再走一格（见 dragEnd）。这两条合起来保证
     *    拖动**永远不会弹出文件选择框** —— 那会是纯粹的惊吓。
     */
    const activate = (i) => {
      if (items[i].kind !== "builtin") { onMascotPick(); return; }
      focusCard(i);
    };
    // ‹ › / ← → / Home / End：只在**内置形态**之间循环（自定义那一项是"选文件"这个动作）。
    // ⚠️ 导航**永不禁用**（用户口径：按钮要可点击）—— 自定义生效时按它走的是"改用内置形态"
    //    那条带确认的路（client.js 的 onRopeFormChange 收口），不是"点了没反应"。
    const cycle = (delta) => {
      const fn = forms.length;
      const cur = builtinIdx >= 0 ? builtinIdx : 0;
      activate((cur + delta + fn) % fn);
    };
    // ── 拖动 + 抛掷（环上的实现；物理口径沿用前几版，逐条都写了理由）───────────────────
    //   · 按下记基准；移动**直接写 DOM**（不 emit —— 每帧 setState + 整棵面板重渲染太贵，
    //     而这只是视图旋转）；抬起按**速度投影**吸附到最近的卡位。
    //   · ⚠️ 拖动期必须**关掉过渡**（环加 `is-dragging`）：否则每帧写 transform 都会被
    //     220ms 的过渡"追"一次，手感从跟手变成拖橡皮筋。
    //   · 抛掷时长 0.32s、"只留最近 100ms 取样"、"样本陈旧 70ms 即视为速度 0"都取自参考实现：
    //     手指停住再松手时速度必须是 0，否则"停一会儿再放"会莫名多转一格。
    //   · 吸附用 `Math.round(-rotation / 步进)`（参考实现同式）。环上**没有端点**，
    //     所以没有阻尼回弹那一套 —— 那是"有界滚动"才需要的东西（上一版就是有界滚动）。
    // ⚠️⚠️ **指针捕获必须等"真的开始拖"才做，绝不能在 pointerdown 就做**（实测
    //   「自定义那个目前没法点击」的根因）：`setPointerCapture` 会把后续指针事件（含 pointerup）
    //   重定向到捕获元素；而浏览器把 `click` 派发给「pointerdown 与 pointerup 目标的**最近公共
    //   祖先**」—— pointerdown 的目标是卡片、pointerup 被重定向到舞台 ⇒ 公共祖先 = **舞台**
    //   ⇒ **卡片自己的 onClick 永远收不到**。症状就是"卡片都点不了"（圆点在外面，所以还点得动，
    //   这会让人误判成"只有某一项坏了"）。
    //   正确姿势：按下只记录；位移超过 `MASCOT_DRAG_SLOP_PX` 才认定"开始拖"，**那时**再捕获
    //   （捕获也是为了拖出舞台边界后仍能收到 pointermove / pointerup）。
    const dragStart = (e) => {
      if (e.button != null && e.button !== 0) return;
      const st = e.currentTarget;
      const ring = st.querySelector(".we-picker__mascot-ring");
      if (!ring) return;
      mascotDrag = {
        x0: e.clientX, dx: 0, ring, st, pointerId: e.pointerId, dragging: false,
        startRot: -alignedLogical * STEP_DEG,
        samples: [{ x: e.clientX, t: Date.now() }],
      };
      mascotDragMoved = false;
      // 这里**不**加 is-dragging、**不**捕获 —— 见上面的 ⚠️⚠️。
    };
    const dragMove = (e) => {
      if (!mascotDrag) return;
      const raw = e.clientX - mascotDrag.x0;
      // 越过阈值 = 这是一次**拖动**（而不是点击）：此刻才进入拖动模式。
      if (Math.abs(raw) > MASCOT_DRAG_SLOP_PX) {
        mascotDragMoved = true;
        if (!mascotDrag.dragging) {
          mascotDrag.dragging = true;
          try { mascotDrag.ring.classList.add("is-dragging"); } catch { /* ignore */ }
          try { mascotDrag.st.setPointerCapture(mascotDrag.pointerId); } catch { /* ignore */ }
        }
      }
      const dx = Math.max(-DRAG_LIMIT_PX, Math.min(DRAG_LIMIT_PX, raw));
      mascotDrag.dx = dx;
      mascotDrag.ring.style.transform =
        "rotateY(" + (mascotDrag.startRot + dx * DEG_PER_PX) + "deg)";
      const now = Date.now();
      mascotDrag.samples.push({ x: e.clientX, t: now });
      // 只留最近 100ms 的样本（够算"松手那一刻"的速度，又不被早先的大位移带偏）。
      while (mascotDrag.samples.length > 2 && now - mascotDrag.samples[0].t > 100) mascotDrag.samples.shift();
    };
    const dragEnd = () => {
      const d = mascotDrag;
      mascotDrag = null;
      if (!d) return;
      // 一次**点击**（没越过阈值）：什么都不做 —— 让浏览器照常把 click 派发给卡片本身。
      // 这里提前返回还顺带避免了"点一下也去写一次 transform"（那会打断正在进行的吸附过渡）。
      if (!d.dragging) return;
      try { d.ring.classList.remove("is-dragging"); } catch { /* ignore */ }
      // 松手速度（px/s，正 = 向右拖 = 环朝正方向转）。样本太旧（手指已停）⇒ 速度算 0。
      let vPx = 0;
      const s0 = d.samples[0], s1 = d.samples[d.samples.length - 1];
      if (s0 && s1 && s1.t > s0.t && Date.now() - s1.t < MASCOT_FLING_STALE_MS) {
        vPx = ((s1.x - s0.x) / (s1.t - s0.t)) * 1000;
      }
      const projectedRot = d.startRot + (d.dx + vPx * MASCOT_FLING_S) * DEG_PER_PX;
      let target = Math.round(-projectedRot / STEP_DEG);   // 吸附到最近的整数槽位
      const dir = target === alignedLogical ? 0 : Math.sign(target - alignedLogical);
      // ⚠️ 「自定义立绘」不是落点（它是"选文件"这个动作，不是一种形态）⇒ 顺着同方向再走一格。
      //    有这一条，拖动**永远不会弹出文件选择框** —— 那会是纯粹的惊吓。
      if (dir !== 0 && items[norm(target)].kind !== "builtin") target += dir;
      if (dir === 0 || items[norm(target)].kind !== "builtin") {
        // 没换档：把拖动期写下的行内 transform 弹回吸附值 —— 那一步绕过了 React，
        // 而此刻 `is-dragging` 已摘掉 ⇒ CSS 过渡负责把这一下走圆。
        d.ring.style.transform = "rotateY(" + (-alignedLogical * STEP_DEG) + "deg)";
        return;
      }
      mascotRingLogical = target;
      onRopeFormChange(items[norm(target)].id);
    };
    // 待确认的形态切换：自定义立绘生效时点内置项 / 按 ‹ › 都会走到这儿（**唯一的破坏性动作**，
    // 所以用两步确认 —— 切到内置形态必须先清除那张自定义立绘，而清除不可恢复）。
    const pendingId = typeof sel.mascotPendingForm === "string" ? sel.mascotPendingForm : "";
    const pendingLabel = pendingId ? (ROPE_FORMS[pendingId] ? ROPE_FORMS[pendingId].label : pendingId) : "";
    const confirmRow = pendingId
      ? renderConfirmRow(sel.armedConfirm, "mascot-form",
        weT("改用「{name}」需要先清除自定义立绘（清除不可恢复），继续吗？", { name: pendingLabel }),
        () => onMascotFormConfirm(), () => onDisarmConfirm())
      : null;
    // 层与职责（三层，每层只干一件事）：
    //   · `.we-picker__mascot-window`：**只负责裁剪**（环会伸出舞台）＋两端淡出遮罩。
    //     ⚠️ 裁剪必须由**祖先**做，不能直接给 `perspective` 那一层加 `overflow` ——
    //     overflow / mask 都是"分组属性"，加在 3D 上下文根上会把它**压平**。
    //     （参考实现也是靠更上层的 body 裁剪的，同一条道理。）
    //   · `.we-picker__mascot-stage`：3D 上下文根（`perspective`）＋指针 / 键盘事件。
    //   · `.we-picker__mascot-ring`：整环旋转（`rotateY(−逻辑索引 · 步进)`），拖动期被直接改写。
    return React.createElement("div", { className: "we-picker__ctl we-picker__ctl--wrap" },
      // ⚠️ **不给 hint**（用户口径：「上面文案去掉」）：
      //    原来那句提示写的是"按 ‹ ›、用 ← / →、点圆点、点任意一只"—— 而 ‹ › 两个箭头
      //    同一轮被删掉了，留着就是**指导用户去点不存在的东西**。剩下的三条路（拖、点圆点、
      //    点立绘）本身自解释，再补一句反而又把这一行的文字拉长。
      //    标签「吉祥物形态」保留：它是这一行的名字，去掉后这一行就没有标签了
      //    （与上面「显示吉祥物」那一行不同形，读屏也失去分组名）。
      ctlText(weT("吉祥物形态")),
      React.createElement("div", { className: "we-picker__mascot-carousel" },
        React.createElement("div", {
          className: "we-picker__mascot-window",
          // 高度**算出来的**（见上 FRONT_ZOOM / WINDOW_H_PX）：3D 透视会把卡片整体放大，
          // 写死高度就会把立绘的头顶与名字的底部切掉 —— 用户实测的「上下有截断」正是这个。
          // 宽度是**贴住环**（`max-width` = 环的水平外沿）：铺满整行会在环两侧留下大片空白
          // （那正是"中间一小坨"的成因），而写死 340 又会在宽面板里显得窄。
          style: { height: WINDOW_H_PX + "px", maxWidth: RING_EXTENT_PX * 2 + "px" },
        },
          React.createElement("div", {
            className: "we-picker__mascot-stage",
            role: "group", "aria-label": weT("吉祥物形态"),
            // 透视也与 scale 同乘（写在行内，因为它随 scale 变；CSS 里那份是设计档的兜底）。
            style: { perspective: PERSP_S + "px" },
            onPointerDown: dragStart,
            onPointerMove: dragMove,
            onPointerUp: dragEnd,
            onPointerCancel: dragEnd,
            onKeyDown: (e) => {
              // ← / → 换形态；Home / End 跳到首/末。
              // ⚠️ 一律 `preventDefault`：不拦的话 ← / → 会把整块面板横向滚走、
              //    Home / End 会把页面滚到顶/底。
              if (e.key === "ArrowLeft") { e.preventDefault(); cycle(-1); }
              else if (e.key === "ArrowRight") { e.preventDefault(); cycle(1); }
              else if (e.key === "Home") { e.preventDefault(); activate(0); }
              else if (e.key === "End") { e.preventDefault(); activate(forms.length - 1); }
            },
          },
            React.createElement("div", {
              className: "we-picker__mascot-ring",
              style: { transform: "rotateY(" + (-alignedLogical * STEP_DEG) + "deg)" },
            },
              items.map((it, i) => {
                const off = slotOffsetOf(i);
                const isCenter = off === 0;
                const isBuiltin = it.kind === "builtin";
                const isActive = isCenter && (isBuiltin ? !customArt : Boolean(customArt));
                const label = isBuiltin ? it.form.label : weT("自定义");
                return React.createElement("button", {
                  key: it.id,
                  type: "button",
                  // ⚠️ **内置项永不禁用**（用户口径：按钮要可点击）：自定义立绘生效时点它会走
                  //    "改用内置形态"那条带确认的路。只有"正在导入"这一个瞬时态才禁用。
                  disabled: !isBuiltin && Boolean(sel.mascotBusy),
                  className: "we-picker__mascot-item" + (isCenter ? " we-picker__mascot-item--center" : "")
                    + (isActive ? " we-picker__mascot-item--active" : ""),
                  "aria-pressed": isActive ? "true" : "false",
                  "aria-label": label,
                  title: isBuiltin
                    ? (customArt ? weT("改用「{name}」（会先清除自定义立绘）", { name: label }) : label)
                    : (customArt ? weT("替换图片…（再导入会覆盖上一次）") : weT("导入图片…")),
                  // 尺寸与角度**全部行内写**：判据要能直接从渲染树里读到
                  // 「盒宽 = 立绘宽（不留透明内边距）」「卡高容得下最高的立绘」
                  // 与「每张卡等角度铺在环上」，而不是去猜 CSS。
                  style: {
                    width: BOX_S + "px",
                    height: CARD_H_PX + "px",
                    marginLeft: (-BOX_S / 2) + "px",
                    marginTop: (-CARD_H_PX / 2) + "px",
                    transform: "rotateY(" + (i * STEP_DEG) + "deg) translateZ(" + RADIUS_PX + "px)",
                    opacity: opacityOf(off),
                  },
                  onClick: () => {
                    // 拖动刚结束的那一次 click 丢掉（否则"拖一下"会顺带选中手指底下的卡）。
                    if (mascotDragMoved) { mascotDragMoved = false; return; }
                    activate(i);
                  },
                },
                  isBuiltin
                    ? React.createElement("span", {
                      className: "we-picker__mascot-art",
                      // 立绘盒也随 scale 放大（否则卡变大了、立绘还是 64px，中间空一圈）。
                      // 各形态的 w/h 比例不变 ⇒ "盒宽 = 卡宽"这条不变量在任意 scale 下都保持。
                      style: { width: at(it.form.w) + "px", height: at(it.form.h) + "px" },
                    }, React.createElement("img", { src: it.form.img, alt: label, draggable: false }))
                    : React.createElement("span", {
                      // ⚠️ 类名与内置项的立绘框**不同**（`we-picker__mascot-art` 是"内置形态"的
                      //    记号，复用会把"固定基础尺寸"那条判据的计数带偏 —— 实测踩过）。
                      className: "we-picker__mascot-custom-art",
                      style: { width: at(previewW) + "px", height: at(previewH) + "px" },
                    },
                      customArt
                        ? React.createElement("img", { src: previewArt.img, alt: weT("自定义"), draggable: false })
                        : React.createElement("span", { className: "we-picker__mascot-empty" }, "+")),
                  // 名字每项都画：环上名字各在自己的卡里、不会打架（旧扇面会，那时只画中心一项）。
                  React.createElement("span", { className: "we-picker__mascot-name" },
                    !isBuiltin && sel.mascotBusy ? weT("导入中…") : label),
                );
              }),
            ),
          ),
        ),
      ),
      // 圆点：10 只内置时"一只一只翻"太笨 ⇒ 给**直接跳到任意一只**的路，
      // 顺带回答"一共几只、现在第几只"（环上只能看见 3–5 张，答不了这个问题）。
      // ⚠️ 两个 ‹ › 箭头按用户口径删掉了：它们与圆点功能重叠，
      //    而圆点更强（直接跳任意一只 + 显示总数）。换形态仍有四条路：拖环 / 点圆点 /
      //    点立绘 / 键盘 ← →（键盘那条对键盘用户是必需的，所以 `cycle` 保留）。
      React.createElement("div", { className: "we-picker__mascot-dots" },
        items.map((it, i) => {
          const label = it.kind === "builtin" ? it.form.label : weT("自定义");
          const on = i === activeIdx;
          return React.createElement("button", {
            key: "dot-" + it.id,
            type: "button",
            className: "we-picker__mascot-dot" + (on ? " is-active" : ""),
            "aria-label": weT("切换到「{name}」", { name: label }),
            "aria-current": on ? "true" : undefined,
            title: label,
            onClick: () => activate(i),
          });
        }),
      ),
      confirmRow,
      // 屏读播报：形态一变就念一次"<名字>，第 N 个，共 M 个"。轮播类控件不能只靠视觉 ——
      // 拖一下屏上转了、读屏用户却毫无感知（参考实现同样带 aria-live）。
      React.createElement("span", {
        key: "mascot-live", className: "we-sr-only",
        "aria-live": "polite", "aria-atomic": "true",
      }, weT("{name}，第 {n} 个，共 {m} 个", {
        name: customArt ? weT("自定义") : (ROPE_FORMS[sel.ropeForm] ? ROPE_FORMS[sel.ropeForm].label : ""),
        n: String(activeIdx + 1), m: String(items.length),
      })),
      customArt && React.createElement("button", {
        key: "custom-clear",
        className: "we-picker__btn we-picker__mascot-clear",
        type: "button",
        disabled: Boolean(sel.mascotBusy),
        onClick: onMascotClear,
      }, weT("清除")),
    );
  }


export { renderMascotFormCards };
