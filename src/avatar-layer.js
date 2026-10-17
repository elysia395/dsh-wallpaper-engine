/**
 * avatar-layer.js — 「扩展」页签**第一个模块**（自定义会话头像）的**会话界面装饰层**。
 *
 * ══ 它是什么 ══════════════════════════════════════════════════════════════════
 * 开启后把会话里的消息**左右分列并配上头像** —— 你的消息在右、头像在右；助手的消息在左、
 * 头像在左，像好友之间互相发消息。做法是**纯 DOM 装饰**：给宿主已经渲染出来的消息行补一个
 * 头像节点，不改任何官方组件的代码、也不注册任何插槽。
 *
 * ══ 为什么是 DOM 补丁而不是插槽 ══════════════════════════════════════════════
 * 官方聊天列表的消息渲染器是按 kind 注册的（`conversation.chat.node` 的 `user` /
 * `assistant-step` 两个 key），注册同名 key 是**替换**官方渲染器 —— 那等于把宿主的消息卡片
 * 整个接过来养，升级一次就崩一次。而"在旁边放一张头像"只需要两件东西：一个稳定的选择器
 * （`data-chat-flow-kind`，官方 ChatNodeSeat 写在每个消息行上的属性）与一个观察者
 * （消息是动态插入的）。这与 `src/nav-icon.js` 的设置导航图标补丁是同一条路子。
 *
 * 契约：
 *   需要的外界：扁平设置 store `selection`（**只读**）、`apiUrl`（拼宿主路由）、
 *     `weComponentVisible`（组件行可见面判据，唯一实现在 src/client.js；内联后同作用域）。
 *   对外提供：`syncAvatarLayer()`（设置变了就调一次）、`disposeAvatarLayer()`（卸载清理）、
 *     `avatarImageUrl(side)`（面板预览与层共用同一条 URL 构造）、
 *     `avatarGlyphSvgString(side, size)` / `renderAvatarGlyph(side, size)`（内置默认头像的几何，
 *     字符串版给 DOM 用、React 版给面板用 —— 同一张零件表，见下）。
 *   设置项（`avatar*`，真源 lib/settings-schema.js）：总开关 / 大小 / 圆角强度 / 两张文件名。
 *   ⚠️ **没有自定义名字行**（用户口径："加了它太丑了"）—— 不要加回来：读模型名要挂在官方输入框
 *      的选择器槽位上，是一整条额外的 DOM 依赖，而这层装饰的职责只是"配一张脸"。
 *
 * 不变量：
 *   · **只读 `selection`**：一个字节都不写（写设置只发生在 src/client.js 的具名处理器里）。
 *   · **组件行不可用 = 整层不挂**（ADR-0013 D3①/D3③）：`mascot-avatar` 那一行关掉时
 *     `/avatar/<side>` 整族 404 ⇒ 装饰出来的必然是破图，所以与"用户关掉开关"同一条 stop 路径。
 *     判据经 `weComponentVisible(selection.inventory.components, 'mascot-avatar')` 一处读入。
 *   · **`<img>` 一族的兜底**（D3③）：图加载失败 ⇒ 就地换成内置默认头像（按 URL 记账，
 *     同一张不重试），绝不留在"破图"上 —— 见 `avatarFillNode`。
 *   · **零顶层可执行语句**：本文件的顶层只有声明 —— 读 `selection` 的语句一律在函数里
 *     （内联后 prelude 早于 `src/client.js` 正文求值，顶层读它必撞 TDZ）。
 *   · **关掉 = 逐字节回到原生**：摘掉所有注入的头像节点、抹掉加在消息行上的标记属性、
 *     断开观察者、撤掉 body 上的开关属性与两个变量。宿主 DOM 上不留任何痕迹。
 *   · **只碰消息行**：只给 `user` / `steering` / `assistant-step` 三种 kind 补头像
 *     （工具调用、思考过程、压缩标记、turn 尾巴一律不碰 —— 那些不是"好友发的消息"）。
 *   · **幂等**：同一个消息行只补一次（`data-we-avatar-row` 是标记）；设置变化时**就地更新**
 *     已补节点的图与形状，不重建 DOM（否则每改一次滑块，整屏消息的头像都要重挂一遍）。
 *   · **观察者的开销有硬界**：流式输出时消息内部每帧都在插节点 ⇒ 回调里对**不是消息行**
 *     的插入只做一次 `closest('[data-we-avatar-row]')` 判定（已在装饰过的行里就直接放行），
 *     绝不逐个 `querySelectorAll` 扫子树。
 *   · **没有 DOM 的环境连观察者都不建**（无头验证沙箱）：这一层是装饰，宁可不画。
 *   · **默认头像是画出来的、不是资源**：两侧各一张内置 SVG（零件表在下面），
 *     与「我 / 助手」的角色一一对应；导入的图片只是**替换**这张默认头像。
 */

/**
 * 可见面判据的**本地包装**（模块边界真实化）。
 *
 * ⚠️ 本文件必须能**单独 import**，且**导出面固定为四项**（判据钉死）；输入一律走 `globalThis`
 * ——与 `selection` / `apiUrl` 同一契约。因此这里**不裸引用** `weComponentVisible`
 *（它只在拼接后的作用域里存在，单独 import 会 ReferenceError，实测），
 * 而是读宿主注入的全局：`src/client.js` 启动时设置 `globalThis.__weComponentVisible`。
 *
 * 缺省返回 `true`：与 ADR-0013 D3①「组件行不可用 ⇒ 整层不挂」**同向**（安全方向）。
 */
function avatarComponentVisible(components, name) {
  const f = globalThis.__weComponentVisible;
  // 缺省 **true**（未知 ⇒ 按可用渲染）：注入缺失只可能是接线疏漏或独立求值上下文，
  // 那种情况下"把整个面板藏掉"是更坏的失败；生产侧 src/client.js 启动时必定注入。
  return typeof f === 'function' ? f(components, name) : true;
}


/** 三种"消息行"的 kind（官方 ChatNodeSeat 的 `data-chat-flow-kind` 值）→ 头像属于哪一方。 */
const AVATAR_FLOW_SIDES = { user: 'user', steering: 'user', 'assistant-step': 'ai' };
/** 消息行的选择器（只扫这三种；`closest` 的早退判定用的也是它）。 */
const AVATAR_ROW_SELECTOR = '[data-chat-flow-kind="user"], [data-chat-flow-kind="steering"], [data-chat-flow-kind="assistant-step"]';
/** 注入标记：`data-we-avatar-row="<side>"` 加在消息行上，`we-avatar` 是注入节点（那张脸）自己的类。 */
const AVATAR_ROW_ATTR = 'data-we-avatar-row';
const AVATAR_NODE_CLASS = 'we-avatar';
const AVATAR_NODE_ATTR = 'data-we-avatar-node';
/**
 * 「连续同侧消息的后续行」标记（issue #191 问题 2）：加在**头像节点**上。
 * CSS 里只做 `visibility: hidden` —— 节点与它的框都还在，缩进对齐与 flex 几何逐字节不变。
 */
const AVATAR_CONT_CLASS = 'we-avatar--cont';
/** 开关属性与两个观感变量（styles.js 的「自定义会话头像」段读它们）。 */
const AVATAR_ATTR = 'data-we-avatar';
const AVATAR_VAR_SIZE = '--we-avatar-size';
const AVATAR_VAR_ROUND = '--we-avatar-round';
/**
 * 「这张图试过、加载失败」的记账属性（值 = 失败时那个 URL）：失败后按"没设置过"画内置
 * 头像，且**同一 URL 不再重试**（换图 ⇒ URL 变 ⇒ 自然重试）。见 `avatarFillNode`。
 */
const AVATAR_IMG_FAILED = 'data-we-avatar-imgfail';
/** 两方在设置里对应的文件名键（**唯一**的 side → 设置键映射）。 */
const AVATAR_IMAGE_KEYS = { user: 'avatarUserImage', ai: 'avatarAiImage' };
/**
 * 画之前的**兜底钳位**（不是设置范围的真源 —— 真源是 lib/settings-schema.js 的
 * AVATAR_SIZE_* / AVATAR_RADIUS_*，面板那两个滑块的 min/max 读的就是它）。
 * 这里再写一份的理由只有一条：**本文件会被单独 import**（test/verify-*.mjs 逐模块加载），
 * 那时 schema 的常量不在作用域里 —— 直接引用会 ReferenceError。名字刻意与 schema 的不同
 * （`AVATAR_SIZE_MIN` 那一族已经被 schema 占了，内联后同作用域 ⇒ 重名即构建失败）。
 */
const AVATAR_CLAMP_SIZE = { min: 24, max: 72, def: 40 };
const AVATAR_CLAMP_RADIUS = { min: 0, max: 100, def: 100 };

/**
 * 内置默认头像的**零件表**（唯一真源）：字符串版与 React 版都由它现算，改图只动这张表。
 * 两侧都画在 0..16 的方格上（与「壁纸引擎」图标同一个网格口径），`currentColor` 上色、
 * `fill="none"` + 描边 —— 于是它们自动跟随主题的文字色，深浅两套都不需要第二份配色。
 *   · `user` = 人像（头 + 肩），最不容易被误读的一张。
 *   · `ai`  = 四角星（"助手"的中性记号；不画品牌鲸 —— 头像位是用户的，不是我们的广告位）。
 */
const AVATAR_GLYPH_PARTS = {
  user: [
    ['circle', { cx: '8', cy: '5.6', r: '2.5' }],
    ['path', { d: 'M3.4 13.2c0-2.3 2.1-3.8 4.6-3.8s4.6 1.5 4.6 3.8' }],
  ],
  ai: [
    ['path', { d: 'M8 2.2l1.35 3.9a1.6 1.6 0 0 0 1 1l3.9 1.35-3.9 1.35a1.6 1.6 0 0 0-1 1L8 14.7l-1.35-3.9a1.6 1.6 0 0 0-1-1L1.75 8.45l3.9-1.35a1.6 1.6 0 0 0 1-1z' }],
  ],
};
const AVATAR_GLYPH_VIEW_BOX = '0 0 16 16';

/** 消息行的观察者与开关（模块级单例：这一层只有一份）。 */
let avatarObserver = null;
let avatarActive = false;
/** 分组重算的 rAF 句柄（0 = 没有挂起的一次；见 avatarScheduleGrouping）。 */
let avatarGroupRaf = 0;

/* `weBody()` / `weClampTo()` 的唯一实现见 src/we-base.js（内联后同作用域）。 */

/**
 * 头像图的 URL：`/avatar/<side>?v=<文件名>`。
 * 文件名进查询串既是"这一方到底设置过没有"的判据，也是**缓存键** —— 换图 ⇒ 换名 ⇒
 * URL 变（路由那边因此敢给长缓存，见 packages/mascot-avatar/lib/routes/avatar.js 的不变量 ④）。
 * 没设置过就返回空串（调用方画内置默认头像）。
 */
function avatarImageUrl(side, selLike) {
  const sel = selLike || selection;
  const key = AVATAR_IMAGE_KEYS[side];
  const name = key && sel ? String(sel[key] || '') : '';
  if (!name) return '';
  return apiUrl('/avatar/' + side + '?v=' + encodeURIComponent(name));
}

/** 字符串版默认头像（DOM 的 innerHTML 用）。 */
function avatarGlyphSvgString(side, size) {
  const parts = AVATAR_GLYPH_PARTS[side] || AVATAR_GLYPH_PARTS.user;
  const px = (Number(size) > 0 ? Number(size) : 16);
  const attrs = 'viewBox="' + AVATAR_GLYPH_VIEW_BOX + '" width="' + px + '" height="' + px
    + '" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"'
    + ' stroke-linejoin="round" aria-hidden="true" focusable="false"';
  const inner = parts.map(([tag, a]) => '<' + tag + ' '
    + Object.keys(a).map((k) => k + '="' + a[k] + '"').join(' ') + '/>').join('');
  return '<svg ' + attrs + '>' + inner + '</svg>';
}

/** React 版默认头像（面板预览用）：与上面同一张零件表，调用时才读 React（同 nav-icon 口径）。 */
function renderAvatarGlyph(side, size) {
  const parts = AVATAR_GLYPH_PARTS[side] || AVATAR_GLYPH_PARTS.user;
  const px = (Number(size) > 0 ? Number(size) : 16);
  return React.createElement("svg", {
    viewBox: AVATAR_GLYPH_VIEW_BOX,
    width: px,
    height: px,
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.4",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    focusable: "false",
  }, parts.map(([tag, a]) => React.createElement(tag, a)));
}

/**
 * 把一个已注入的头像节点**就地更新**到当前设置：里面是一个圆脸（导入的图或内置默认头像）
 * 加一行名字。只在"该显示什么"真的变了才动 DOM —— 滑块每格都会走到这里
 * （size/round 只改 body 变量，与节点内容无关），所以这些早退是热路径的一部分。
 */
function avatarFillNode(node, side) {
  const url = avatarImageUrl(side);
  // 这一方这张图**试过且失败**（宿主行关了 / 导入的文件被删）⇒ 本轮按"没设置过"画内置头像；
  // URL 不变就不再重试，URL 变了（换了一张图）自然重试。
  const failed = url && node.getAttribute(AVATAR_IMG_FAILED) === url;
  const want = url && !failed ? 'img' : 'glyph';
  if (node.getAttribute('data-we-avatar-kind') === want) {
    if (want === 'img') {
      const img = node.firstElementChild;
      const src = img ? img.getAttribute('src') : '';
      if (src !== url) { try { img.setAttribute('src', url); } catch { /* ignore */ } }
    }
    return;
  }
  node.setAttribute('data-we-avatar-kind', want);
  try { node.textContent = ''; } catch { /* ignore */ }
  if (want === 'img') {
    const img = document.createElement('img');
    img.className = AVATAR_NODE_CLASS + '__img';
    img.setAttribute('alt', '');
    img.setAttribute('draggable', 'false');
    // D3③ 的 `<img>` 兜底：图加载失败 ⇒ 记下这次失败（按 URL 记）并把节点**就地**改成内置
    // 头像 —— 会话里绝不会停在"破图"上。走 `avatarFillNode` 自己那条就地更新路，
    // 于是后续设置变化（大小 / 圆角 / 换图）照常生效，不需要第二个状态机。
    img.onerror = () => {
      try { node.setAttribute(AVATAR_IMG_FAILED, url); } catch { /* ignore */ }
      avatarFillNode(node, side);
    };
    img.setAttribute('src', url);
    node.appendChild(img);
  } else {
    const glyph = document.createElement('span');
    glyph.className = AVATAR_NODE_CLASS + '__glyph';
    glyph.innerHTML = avatarGlyphSvgString(side, 16);
    node.appendChild(glyph);
  }
}

/** 给一条消息行补头像（已补过则只做就地更新）。返回是否动过 DOM。 */
function avatarDecorateRow(row) {
  if (!row || typeof row.getAttribute !== 'function') return false;
  const side = AVATAR_FLOW_SIDES[row.getAttribute('data-chat-flow-kind')];
  if (!side) return false;
  const marked = row.getAttribute(AVATAR_ROW_ATTR);
  if (marked === side) {
    const node = row.firstElementChild;
    if (node && node.classList && node.classList.contains(AVATAR_NODE_CLASS)) {
      avatarFillNode(node, side);
      return false;
    }
    // 标记在、节点却没了（宿主重建过这一行的子节点）⇒ 当作没补过，重补一次。
    row.removeAttribute(AVATAR_ROW_ATTR);
  } else if (marked) {
    // 同一行换了另一方（kind 变了）：先摘旧的，再按新的一方补。
    const old = row.firstElementChild;
    if (old && old.classList && old.classList.contains(AVATAR_NODE_CLASS)) {
      try { old.remove(); } catch { /* ignore */ }
    }
    row.removeAttribute(AVATAR_ROW_ATTR);
  }
  const node = document.createElement('div');
  node.className = AVATAR_NODE_CLASS + ' ' + AVATAR_NODE_CLASS + '--' + side;
  node.setAttribute(AVATAR_NODE_ATTR, side);
  node.setAttribute('aria-hidden', 'true');
  avatarFillNode(node, side);
  // 插到行的**最前面**：助手行是 `flex-direction: row`（头像在最左），
  // 用户行是 `row-reverse`（最前面的子元素落在最右）—— 一份插入顺序同时满足两侧（见 styles.js）。
  row.setAttribute(AVATAR_ROW_ATTR, side);
  try { row.insertBefore(node, row.firstChild); } catch { /* ignore */ }
  return true;
}

/** 扫一遍全文档，把还没补过的消息行补上（观察者只管新插入的，这一条管"已经在了的"）。 */
function avatarSweep() {
  if (typeof document.querySelectorAll !== 'function') return;
  let rows;
  try { rows = document.querySelectorAll(AVATAR_ROW_SELECTOR); } catch { return; }
  for (const row of rows) avatarDecorateRow(row);
  // 扫完立刻重算分组：`sweep` 本来就是一次全文档扫，分组复用同一次遍历的开销类别。
  avatarApplyGrouping();
}

/**
 * 分组：**连续的同侧消息只在第一条前面显示头像**（issue #191 问题 2）—— 主流聊天软件的
 * 形态（微信 / Discord / Telegram 同款），免得"连着十条助手回复贴着十张一样的脸"。
 *
 * ⚠️ 做法是给后续同侧的**头像节点加一个 `--cont` 修饰类**（CSS 里 `visibility: hidden`），
 * **绝不摘掉节点**：节点在、框还占着 ⇒ 缩进对齐与 flex 几何**逐字节不变**。
 * 那正是 issue #154 那个坑的规避方式 —— 摘掉头像节点会让宿主那层 `display: contents`
 * 锚点下的内容退回 `flex: 0 1 auto`，收起的思考行固有宽为 0 ⇒ 整条消息连入口一起消失
 *（见 src/styles.js 头像段的血泪注释与 test/verify-scene-live.mjs 的假 DOM 判据）。
 *
 * 顺序判定：按**文档序**走一遍消息行，记住上一条的 side；同侧且不是第一条 ⇒ 标记为续行。
 * 不同类型之间（助手 → 用户）自然断开。只认三种消息行（`AVATAR_FLOW_SIDES`）。
 */
function avatarApplyGrouping() {
  if (!avatarActive || typeof document.querySelectorAll !== 'function') return;
  let rows;
  try { rows = document.querySelectorAll(AVATAR_ROW_SELECTOR); } catch { return; }
  let prev = '';
  for (const row of rows) {
    const side = AVATAR_FLOW_SIDES[row.getAttribute('data-chat-flow-kind')];
    if (!side) continue;
    const node = row.firstElementChild;
    if (node && node.classList && node.classList.contains(AVATAR_NODE_CLASS)) {
      try { node.classList.toggle(AVATAR_CONT_CLASS, side === prev); } catch { /* ignore */ }
    }
    prev = side;
  }
}

/**
 * 分组重算的**限频**入口：流式输出时消息行会连续插入，每插一行就全文档扫一次是
 * O(帧 × 行数)。合并到一帧一次（没有 rAF 的环境退化为同步 —— 验证沙箱走这条）。
 */
function avatarScheduleGrouping() {
  if (avatarGroupRaf) return;
  if (typeof requestAnimationFrame !== 'function') { avatarApplyGrouping(); return; }
  avatarGroupRaf = requestAnimationFrame(() => {
    avatarGroupRaf = 0;
    avatarApplyGrouping();
  });
}

/**
 * 观察者的回调。两件事，按代价从低到高：
 *   ① 新增的**消息行** ⇒ 补头像；
 *   ② 其余新增元素：如果它已经在装饰过的行里就直接放行 —— 流式输出期间消息内部每帧都在
 *      插节点，这一级早退把开销钉在"每个新增元素一次 `closest`"上，
 *      绝不逐个 `querySelectorAll` 扫子树（那是 O(帧 × 子树) 的写法）。
 */
function avatarOnMutations(records) {
  if (!avatarActive) return;
  let decorated = false;
  for (const r of records) {
    const added = r.addedNodes;
    if (!added || !added.length) continue;
    for (const n of added) {
      if (!n || n.nodeType !== 1) continue;
      try {
        if (n.matches && n.matches(AVATAR_ROW_SELECTOR)) {
          if (avatarDecorateRow(n)) decorated = true;
          continue;
        }
        if (n.closest && n.closest('[' + AVATAR_ROW_ATTR + ']')) continue; // 已在装饰过的行里
      } catch { continue; }
      let inner;
      try { inner = n.querySelectorAll ? n.querySelectorAll(AVATAR_ROW_SELECTOR) : []; } catch { inner = []; }
      for (const row of inner) { if (avatarDecorateRow(row)) decorated = true; }
    }
  }
  // 补了新行 ⇒ 分组可能变了（新行算不算"续行"取决于它前面那条）⇒ 合并到一帧重算一次。
  if (decorated) avatarScheduleGrouping();
}

function avatarStop() {
  avatarActive = false;
  if (avatarObserver) {
    try { avatarObserver.disconnect(); } catch { /* ignore */ }
    avatarObserver = null;
  }
  // 挂起的分组重算要取消：它不属于 fiber，留着会在卸载后再扫一次 DOM。
  if (avatarGroupRaf) {
    try { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(avatarGroupRaf); } catch { /* ignore */ }
    avatarGroupRaf = 0;
  }
  if (typeof document === 'undefined' || !document) return;
  const body = weBody();
  if (body) {
    body.removeAttribute(AVATAR_ATTR);
    body.style.removeProperty(AVATAR_VAR_SIZE);
    body.style.removeProperty(AVATAR_VAR_ROUND);
  }
  // 摘掉所有注入的头像节点与行标记（"关掉 = 逐字节回到原生"）。
  if (typeof document.querySelectorAll !== 'function') return;
  let nodes = [];
  try { nodes = document.querySelectorAll('[' + AVATAR_NODE_ATTR + ']'); } catch { /* ignore */ }
  for (const n of nodes) { try { n.remove(); } catch { /* ignore */ } }
  let rows = [];
  try { rows = document.querySelectorAll('[' + AVATAR_ROW_ATTR + ']'); } catch { /* ignore */ }
  for (const row of rows) { try { row.removeAttribute(AVATAR_ROW_ATTR); } catch { /* ignore */ } }
}

/**
 * 设置变了就调一次（由 `src/client.js` 的 `subscribe(syncAvatarLayer)` 驱动）。
 *
 * 开 → 挂开关属性与两个变量、起观察者、补一遍现况；关 → 全部收掉。
 * **每一条写入都是幂等的**：这个函数每次 emit 都会跑（滑块每格一次），
 * 重复 setAttribute / 重复 sweep 的代价是"一次属性写 + 一次选择器扫描"，
 * 但换来的是"任何时刻屏上的形态都等于当前设置"这条不需要额外状态机的性质。
 */
function syncAvatarLayer() {
  // 组件行 gate（ADR-0013 D3①/D3③）：`mascot-avatar` 行不可用 ⇒ 这一层**整层不挂** —— 它画的
  // 头像走宿主 `/avatar/<side>` 直出，那一行关掉时路由整族没了，挂上去必然是破图。
  // 判据只有一处实现：src/client.js 的 `weComponentVisible`（内联后同作用域）；状态面是宿主
  // 行状态（`selection.inventory.components`），本层与别处一样**只读** selection。
  // 不可用与"用户关掉开关"走**同一条 stop 路径**（幂等，不留痕）。
  const componentOn = avatarComponentVisible(selection.inventory && selection.inventory.components, "mascot-avatar");
  const on = componentOn && selection.avatarEnabled === true;
  const body = weBody();
  if (!on || !body || typeof MutationObserver !== 'function') {
    if (avatarActive || avatarObserver) avatarStop();
    else if (body) { body.removeAttribute(AVATAR_ATTR); body.style.removeProperty(AVATAR_VAR_SIZE); body.style.removeProperty(AVATAR_VAR_ROUND); }
    return;
  }
  const size = weClampTo(selection.avatarSize, AVATAR_CLAMP_SIZE.min, AVATAR_CLAMP_SIZE.max, AVATAR_CLAMP_SIZE.def);
  const round = weClampTo(selection.avatarRadius, AVATAR_CLAMP_RADIUS.min, AVATAR_CLAMP_RADIUS.max, AVATAR_CLAMP_RADIUS.def);
  body.setAttribute(AVATAR_ATTR, 'on');
  body.style.setProperty(AVATAR_VAR_SIZE, Math.round(size) + 'px');
  body.style.setProperty(AVATAR_VAR_ROUND, String(Math.round(round)));
  if (!avatarObserver) {
    try {
      avatarObserver = new MutationObserver(avatarOnMutations);
      avatarObserver.observe(body, { childList: true, subtree: true });
    } catch { avatarObserver = null; }
  }
  avatarActive = true;
  avatarSweep();
}

/** 卸载清理（插件禁用 / HMR 重挂）：与关掉同一条路径，额外保证观察者断开。 */
function disposeAvatarLayer() {
  avatarStop();
}

export {
  syncAvatarLayer,
  disposeAvatarLayer,
  avatarImageUrl,
  renderAvatarGlyph,
};
