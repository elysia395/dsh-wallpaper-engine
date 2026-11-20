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
 *   · **只碰消息行**：只给 `user` / `steering` / `assistant-step` 三种 kind 补头像；
 *     过程组（`[data-step-process-body]`）里的 `assistant-step` 步骤行**照常补、照常按间隔露脸**
 *     （用户口径：间隔参数就是为 CoT 过程中控制头像频率而设）；只有不露脸的**续行**才由行标记
 *     `data-we-avatar-cont` 把该行退化成单列，隐藏的头像移出 grid 流，正文不再被空列顶到右边。
 *     工具调用、压缩标记、turn 尾巴一律不碰（那些不是"好友发的消息"）。
 *   · **出现频率（issue #231）**：助手侧**每个回合都露脸**，且长回合不会"一张脸滚出屏幕后整页
 *     再没有"。口径是三条叠加：① 回合的**第一条可见**助手行露脸（宿主会把思考 / 工具调用折叠成
 *     `hidden` / `data-turn-process-hidden`，折叠行不占这个位置，否则整轮一张脸都不剩）；
 *     ② 之后每过「助手头像间隔」条**可见**流条目（思考 / 工具调用 / 回复都算）在
 *     下一条可见助手行上再露一次 —— 实测 24 条流条目（思考 / 工具交替）的长回合里露 3 张脸，
 *     约合每 8 行一张、一屏 2~3 张；既不空屏，也不至于每步一张；
 *     ③ 用户开口后重新从"第一条可见"起算。隐藏行（折叠窗口里的）不参与计数 —— 否则
 *     折叠掉几十条后脸会被判成"早该出现"而挤在一起。用户侧口径不变：连续的用户行只显示第一条。
 *   · **幂等**：同一个消息行只补一次（`data-we-avatar-row` 是标记）；设置变化时**就地更新**
 *     已补节点的图与形状，不重建 DOM（否则每改一次滑块，整屏消息的头像都要重挂一遍）。
 *   · **不假设头像是行首**：第三方插件也会往这一行里塞东西，而且常常是插到最前面
 *     （dsh-meme 把「表情: 描述」换成 `<img>` 后执行 `row.insertBefore(img, row.firstChild)`）
 *     ⇒ 头像节点会退到第二位。找节点一律按属性扫**直接子元素**，否则下一次 sweep 会把
 *     "首个子节点不是头像"误判成"节点没了"，再补一张脸（两张头像并排）；左右位次由
 *     styles.js 里 `.we-avatar` 的 `grid-column` 决定，与 DOM 先后无关。
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
/**
 * **全部**会话流行的选择器（分组用）。分组必须看见工具调用 / 思考过程这些**不补头像**的行：
 * 它们承载宿主的折叠状态，决定哪一条助手行才是屏幕上真正可见的"段首"（issue #231）。
 */
const AVATAR_FLOW_ROW_SELECTOR = '[data-chat-flow-kind]';
/** 宿主写在每条流条目上的**回合号**：同一回合的助手行只配一张脸（issue #231 的频率口径）。 */
const AVATAR_TURN_ATTR = 'data-chat-turn';
/**
 * 宿主"这一行属于折叠中的过程窗口"的标记。它与 `hidden` / `hidden="until-found"` 一起
 * 表示**当前不可见**；折叠窗口成员的头像再漂亮也没人看得见，所以它们不占"段首"。
 */
const AVATAR_FOLD_ATTR = 'data-turn-process-hidden';
/**
 * 长回合里助手的脸**隔多少条可见流条目**再露一次（issue #231 的用户反馈：一个回合只贴一张，
 * 而思考 / 工具调用常常占满好几屏 ⇒ 整页看不到助手）。
 *
 * ⚠️ 这个数**由设置驱动**（`avatarAiRepeatRows`，「扩展」页签的「助手头像间隔」滑块；
 * 合法域的真源见 lib/settings-schema.js 的 AVATAR_AI_REPEAT_MIN/MAX）。下面的常量只是
 * 设置缺失 / 坏值时的兜底 —— 与 schema 的默认值同值（守卫对账）。
 *
 * 为什么按"流条目"而不是"助手行"计数：思考与工具调用在宿主里是两类不同的行，一个回合里
 * 助手行可能只有几条、工具调用却几十条；按任意可见行计数才与"屏幕上滚过去多少内容"成正比。
 */
const AVATAR_AI_REPEAT_FALLBACK = 6;
/** 本层的间隔上下界（**兜底**，不是真源）：单独 import 时 schema 常量不在作用域里。 */
const AVATAR_AI_REPEAT_CLAMP = { min: 1, max: 30 };
/** 设置里那个间隔读出来（钳到合法域；缺 / 坏 ⇒ 兜底值）。 */
function avatarAiRepeatRows(selLike) {
  const sel = selLike || selection;
  const n = Number(sel && sel.avatarAiRepeatRows);
  if (!isFinite(n)) return AVATAR_AI_REPEAT_FALLBACK;
  return Math.max(AVATAR_AI_REPEAT_CLAMP.min, Math.min(AVATAR_AI_REPEAT_CLAMP.max, Math.round(n)));
}
/** 注入标记：`data-we-avatar-row="<side>"` 加在消息行上，`we-avatar` 是注入节点（那张脸）自己的类。 */
const AVATAR_ROW_ATTR = 'data-we-avatar-row';
const AVATAR_NODE_CLASS = 'we-avatar';
// 第三方提到行首的图（dsh-meme 的表情）由装饰层收进这一个横排容器：
//   · 有文本时它排在内容后面 ⇒ 文本先出完，表情另起一行（仍在内容列里）；
//   · 没文本时内容根是 display:none、不占格 ⇒ 它自然落在第 1 行、紧跟头像。
// 不包这一层就无法既让表情**成组横排**、又让它们整体落到正文下面（grid 的每个直接子项
// 会各占一行，三张表情会竖着排）。
const AVATAR_MEDIA_CLASS = 'we-avatar-media';
/** 这一行有没有可见文本；没有时表情包要跟头像同一行，不能落到空正文下面一行。 */
const AVATAR_NO_TEXT_ATTR = 'data-we-avatar-no-text';
const AVATAR_NODE_ATTR = 'data-we-avatar-node';
/**
 * 「连续同侧消息的后续行」标记（issue #191 问题 2）：加在**头像节点**上。
 * CSS 里只做 `visibility: hidden` —— 节点始终留在 DOM 里（摘节点会踩 issue #154 的锚点塌陷）。
 */
const AVATAR_CONT_CLASS = 'we-avatar--cont';
/**
 * 同一件事在**行**上的标记：只给助手侧的续行加。
 * 头像隐藏后若仍保留 40px 的 auto 列 + 8px gap，整条思考链会右移；这个属性让该行
 * 退化为单列、列间距归零，正文回到与折叠头同一条左边缘。用户侧不塌列（气泡本来就靠右）。
 */
const AVATAR_CONT_ROW_ATTR = 'data-we-avatar-cont';
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

/**
 * 这一行里**本层注入的头像节点**（不假设它在行首）。
 *
 * 行首可能被别的插件占用：dsh-meme 把 `[表情: x]` 换成 `<img>` 后执行
 * `row.insertBefore(img, row.firstChild)`，于是我们的节点退到第二位。若仍按
 * `firstElementChild` 判"节点没了"，下一次 sweep 会再补一张脸（两张头像并排）。
 * 真实 DOM 与验证替身都有 `children`；没有它就退回 `firstElementChild`。
 */
function avatarNodeOf(row) {
  if (!row) return null;
  const kids = row.children;
  if (kids && typeof kids.length === 'number') {
    for (let i = 0; i < kids.length; i++) {
      const kid = kids[i];
      if (kid && kid.classList && typeof kid.classList.contains === 'function'
        && kid.classList.contains(AVATAR_NODE_CLASS)) return kid;
    }
    return null;
  }
  const first = row.firstElementChild;
  return first && first.classList && first.classList.contains(AVATAR_NODE_CLASS) ? first : null;
}

/** 给一条消息行补头像（已补过则只做就地更新）。返回是否动过 DOM。 */
/** 本层注入的表情横排容器（只找直接子元素）。 */
function avatarMediaOf(row) {
  if (!row || !row.children) return null;
  for (let i = 0; i < row.children.length; i++) {
    const kid = row.children[i];
    if (kid && kid.classList && typeof kid.classList.contains === 'function'
      && kid.classList.contains(AVATAR_MEDIA_CLASS)) return kid;
  }
  return null;
}

/**
 * 这一行有没有**看得见的正文文本**（表情包容器与头像里的字不算）。
 *
 * dsh-meme 把 `[表情: x]` 提成行首 `<img>` 后，正文往往只剩一个空的/被 `display:none`
 * 藏掉的文本层。此时若仍按"先正文、后表情"排，表情会落在空正文的下一行、头像下面 ——
 * 用户要的是"没有文本时表情直接跟在头像右侧"。用 `checkVisibility` 同时排除
 * `display:none` / `visibility:hidden` / `opacity:0` 的文本层。
 *
 * ⚠️ 性能（issue #385）：`checkVisibility` / `getClientRects` 是**强制布局查询**。原实现在
 * 每个文本节点上各调一次，且调用点紧跟在插入头像节点之后 —— DOM 已失效，于是每次都要
 * 触发一次整页样式重算。实测 840 次调用累计 480ms，把整段历史加载拖慢到秒级，推迟到
 * `requestAnimationFrame` 也救不回来（rAF 里刚写完 DOM，同样失效）。
 *
 * 现在的顺序是「先便宜地判有没有文本，再只对**可见的**候选做查询」：
 *   · 没有非空白文本 ⇒ 一次 `textContent` 判定即返回，零布局查询；
 *   · 有文本 ⇒ 从第一个候选开始查可见性：可见就停，被藏掉就继续看下一个。
 *     不能因为第一个候选被藏就断定这行没有正文 —— 折叠的思考过程常排在正文前面。
 */
function avatarHasVisibleText(row) {
  let root;
  try {
    root = row.querySelector && row.querySelector('[data-slot="conversation.chat.node"]');
  } catch { root = null; }
  if (!root) root = row;

  // ① 便宜的早退：整段没有非空白文本 ⇒ 判定"没有可见文本"，不触发布局。
  let text;
  try { text = root.textContent; } catch { text = ''; }
  if (typeof text !== 'string' || text.replace(/\s+/g, '') === '') return false;

  // ② 有文本时，才需要确认它没有被 CSS 藏起来。只对第一个候选取证。
  if (typeof document.createTreeWalker !== 'function') return true;
  let walker;
  try { walker = document.createTreeWalker(root, 4 /* SHOW_TEXT */); } catch { walker = null; }
  if (!walker) return true;
  let n;
  try {
    while ((n = walker.nextNode())) {
      const v = n.nodeValue;
      if (!v || !v.trim()) continue;
      const p = n.parentElement;
      if (!p) continue;
      try {
        if (p.closest && (p.closest('.' + AVATAR_NODE_CLASS) || p.closest('.' + AVATAR_MEDIA_CLASS)
          || p.closest('[aria-hidden="true"],button,[role="button"]'))) continue;
      } catch { /* ignore */ }
      // 第一个**可见**的非空白文本节点才是答案：被藏起来的候选不算，但也别因为
      // 第一个候选被藏就说整行没有正文（折叠的思考过程就排在正文前面）。
      if (typeof p.checkVisibility === 'function') {
        let vis = true;
        try { vis = p.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }); } catch { vis = true; }
        if (!vis) continue;
      } else if (p.getClientRects) {
        let rects = 1;
        try { rects = p.getClientRects().length; } catch { rects = 1; }
        if (rects === 0) continue;
      }
      return true;
    }
    // 走完一圈都没有可见候选 ⇒ 确实没有可见正文。
    return false;
  } catch { return true; }
}

function avatarSyncNoText(row) {
  if (!row) return false;
  const noText = !avatarHasVisibleText(row);
  const had = !!(row.hasAttribute && row.hasAttribute(AVATAR_NO_TEXT_ATTR));
  if (noText === had) return false;
  try {
    if (noText) row.setAttribute(AVATAR_NO_TEXT_ATTR, '');
    else row.removeAttribute(AVATAR_NO_TEXT_ATTR);
  } catch { return false; }
  return true;
}

/**
 * 把行里被第三方提到行首的 `<img>` 收进一个横排容器。
 *
 * 只动**直接子元素**里的 IMG（dsh-meme 的 `row.insertBefore(img, row.firstChild)`）；
 * 正文里的图（在内容根里面）不受影响。返回是否改过 DOM。
 *
 * ⚠️ 顺序（issue #385）：先看这行有没有表情图，没有就直接返回 —— `avatarSyncNoText` 要调
 * `avatarHasVisibleText`，后者做 `checkVisibility`（强制布局）。而 `AVATAR_NO_TEXT_ATTR`
 * 的唯一用途就是「表情没有文本可排在其后」，**没有表情图的行读不读它都不影响排版**。
 * 绝大多数流式消息行没有表情图，这个早期返回把最贵的查询从热路径上摘掉：
 * 实测 42 行的 sweep 从 478ms 降到 3ms。
 */
function avatarSyncMedia(row) {
  if (!row || !row.children) return false;
  let media = avatarMediaOf(row);
  const imgs = [];
  for (let i = 0; i < row.children.length; i++) {
    const kid = row.children[i];
    if (kid && kid !== media && kid.tagName && String(kid.tagName).toUpperCase() === 'IMG') imgs.push(kid);
  }
  // 没有待收拢的图、也没有残留容器 ⇒ 这行与表情排版无关，不必判断文本可见性。
  if (imgs.length === 0 && !media) return false;
  let changed = avatarSyncNoText(row);
  if (imgs.length === 0) {
    // 图已经在容器里（不是行的直接子元素）⇒ 保留；只有容器真的空了才撤。
    if (media.children && media.children.length > 0) return changed;
    try { media.remove(); } catch { /* ignore */ }
    return true;
  }
  if (!media) {
    media = document.createElement('div');
    media.className = AVATAR_MEDIA_CLASS;
    try { row.appendChild(media); changed = true; } catch { return false; }
  }
  for (const img of imgs) {
    try { media.appendChild(img); changed = true; } catch { /* ignore */ }
  }
  // 第三方的图可能被 dedupe / 清理摘走：容器空了就撤掉，别留一条空白行。
  if (media.children && media.children.length === 0) {
    try { media.remove(); } catch { /* ignore */ }
    changed = true;
  }
  return changed;
}

/** 关掉时把容器里的图放回行里，再摘容器（"逐字节回原生"的最后一环）。 */
function avatarUnwrapMedia(media) {
  if (!media || !media.parent) return;
  const parent = media.parent;
  // 第三方（dsh-meme）本来就是把图提到行首；按原顺序插回行首，别留在容器原来的行尾。
  const kids = [];
  for (let i = 0; i < (media.children ? media.children.length : 0); i++) kids.push(media.children[i]);
  for (let i = kids.length - 1; i >= 0; i--) {
    try { parent.insertBefore(kids[i], parent.firstChild); } catch { /* ignore */ }
  }
  try { media.remove(); } catch { /* ignore */ }
}

function avatarDecorateRow(row) {
  if (!row || typeof row.getAttribute !== 'function') return false;
  const side = AVATAR_FLOW_SIDES[row.getAttribute('data-chat-flow-kind')];
  if (!side) return false;
  const marked = row.getAttribute(AVATAR_ROW_ATTR);
  const existing = avatarNodeOf(row);
  if (existing && marked === side) {
    avatarFillNode(existing, side);
    return avatarSyncMedia(row);
  }
  // 旧节点先摘掉：同一行换了另一方（kind 变了），或标记已丢但节点还在。
  if (existing) {
    try { existing.remove(); } catch { /* ignore */ }
  }
  if (marked) row.removeAttribute(AVATAR_ROW_ATTR);
  // 旧行可能带着上一轮的“续行塌列”标记；重建时先清掉，等分组重算再按新状态写。
  if (row.hasAttribute && row.hasAttribute(AVATAR_CONT_ROW_ATTR)) {
    try { row.removeAttribute(AVATAR_CONT_ROW_ATTR); } catch { /* ignore */ }
  }
  const node = document.createElement('div');
  node.className = AVATAR_NODE_CLASS + ' ' + AVATAR_NODE_CLASS + '--' + side;
  node.setAttribute(AVATAR_NODE_ATTR, side);
  node.setAttribute('aria-hidden', 'true');
  avatarFillNode(node, side);
  // 插到行的**最前面**只是习惯位次：左右由 styles.js 的 grid 列决定（助手第 1 列、
  // 用户第 2 列），插入位置不再承担左右语义。第三方插件把图提到行首也不会把头像挤到另一侧。
  row.setAttribute(AVATAR_ROW_ATTR, side);
  try { row.insertBefore(node, row.firstChild); } catch { /* ignore */ }
  avatarSyncMedia(row);
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
 * 这一行**当前是否看不见**（宿主自己的两种折叠机制 + 标准 `hidden`）。
 *
 * 只看三样东西，都是宿主写在流条目上的真实事实（asar 复算，DSH 0.2.0-rc.2）：
 *   · 条目自己的 `hidden`（`hidden="until-found"` 也是隐藏）；
 *   · `data-turn-process-hidden`（这条属于"折叠中的过程窗口"）；
 *   · 祖先里那层 `[data-step-process-body][hidden]` —— 过程组折叠时是整个 body 被藏起来，
 *     成员行自己不带 `hidden`。
 * **不向上无限找 `hidden`**：侧栏 / 整页级隐藏也会用 `hidden`，那种情况下把每行都判成
 * "看不见"会让整轮头像全灭，而它们重新显示时未必有我们监听得到的变异。
 */
function avatarRowHidden(row) {
  if (!row || typeof row.getAttribute !== 'function') return false;
  if (row.hasAttribute && row.hasAttribute('hidden')) return true;
  if (row.getAttribute(AVATAR_FOLD_ATTR) !== null) return true;
  try {
    return !!(row.closest && row.closest('[data-step-process-body][hidden]'));
  } catch {
    return false;
  }
}

/**
 * 分组：助手侧**每个回合都露脸、长回合按可见行数周期性再露**，用户侧连续消息只显示第一张
 * （issue #191 问题 2 + issue #231 的频率口径）。
 *
 * 为什么不能只按"连续同侧"：宿主把思考 / 工具调用渲染成**过程窗口**里的独立行，折叠时它们
 * 带 `hidden` / `data-turn-process-hidden` —— 若"段首"落在这些**看不见**的行上，本轮唯一
 * 可见的那条回复就会被判成续行，整轮一张脸都没有（issue #231 的实测：助手侧 83% 被隐藏）。
 * 为什么不能"一个回合只一张"：一个回合里思考 + 几十次工具调用能撑满好几屏，唯一那张脸
 * 早早滚出视野 ⇒ 整页看不到助手（用户实测反馈）。所以助手侧的口径是：
 *   · 回合的**第一条可见**助手行露脸；
 *   · 之后每过「助手头像间隔」条**可见**流条目（任何 kind，含工具调用）就在下一条
 *     可见助手行上再露一次 —— 脸因此跟着内容往下走（实测每 8 行左右一张、一屏 2~3 张）；
 *   · 同一回合计一次"该露了"的额度，**工具调用行不重置它**（否则每一步工具调用都重新贴一张，
 *     正是 issue #231 说的"太频繁"来的那一侧）；不同回合（`data-chat-turn` 变了）重新起算；
 *   · 折叠窗口里的行不计数也不露脸（看不见的图不占位），展开 / 收起时重算；
 *   · 用户开口（user / steering）⇒ 助手侧重新从"第一条可见"起算。
 * 用户侧仍是"连续同侧只显示第一条"，但**任何非用户行都会断开连续段**（issue #231 已证实：
 * 过程行曾被跳过 ⇒ 跨过工具调用后第二条用户消息也共用上一张脸）。
 *
 * ⚠️ 做法是给不露脸的行**头像节点加一个 `--cont` 修饰类**（CSS 里 `visibility: hidden`），
 * **绝不摘掉节点**：节点在，锚点下内容的宽度约束就不会塌（issue #154）。
 * 助手侧续行同时给**行**加 `data-we-avatar-cont`，CSS 让该行退化为单列、列间距归零 ——
 * 脸不露，但正文也不再多缩进 48px（用户截图里思考链"层次不齐"的根因）。
 */
function avatarApplyGrouping() {
  if (!avatarActive || typeof document.querySelectorAll !== 'function') return;
  let rows;
  try { rows = document.querySelectorAll(AVATAR_FLOW_ROW_SELECTOR); } catch { return; }
  let prevSide = '';         // 用户侧连续段：任何非用户行都断开
  // 间隔在每次重算时现读设置（滑块不重渲染面板；分组本来就是每次 emit 重算的一趟）。
  const repeatRows = avatarAiRepeatRows();
  let turn;                  // 助手侧当前回合（宿主没写 data-chat-turn 时是 undefined）
  let aiFacePending = true;  // 下一条**可见**助手行该不该露脸
  let aiSince = 0;           // 上次露脸之后又滚过去多少条**可见**流条目
  for (const row of rows) {
    const turnAttr = row.getAttribute(AVATAR_TURN_ATTR);
    if (turnAttr !== null && turnAttr !== turn) {
      // 新回合一进来就重新起算（第一条可见的助手行必定露脸）。
      turn = turnAttr;
      aiFacePending = true;
      aiSince = 0;
    }
    const side = AVATAR_FLOW_SIDES[row.getAttribute('data-chat-flow-kind')];
    const hidden = avatarRowHidden(row);
    const node = avatarNodeOf(row);
    // 没头像节点的行（工具调用、回合头等不属于 AVATAR_FLOW_SIDES 的条目）：
    // 看得见就计一条可见流内容，但不消耗 aiFacePending —— 否则额度会被不是“好友消息”的行花掉。
    if (!side || !node) {
      prevSide = '';
      if (!hidden) aiSince++;
      continue;
    }
    let cont;
    if (side === 'ai') {
      const show = !hidden && (aiFacePending || aiSince >= repeatRows);
      cont = !show;
      if (!hidden) {
        if (show) { aiFacePending = false; aiSince = 0; }
        else aiSince++;
      }
      prevSide = 'ai';
    } else {
      cont = prevSide === 'user';
      prevSide = 'user';
      aiFacePending = true;
      aiSince = 0;
    }
    if (typeof node.classList.toggle === 'function') {
      try { node.classList.toggle(AVATAR_CONT_CLASS, cont); } catch { /* ignore */ }
    }
    // 助手续行：把行退化成单列（头像仍留在 DOM 里、只是不可见），正文不再被空列顶到右边。
    // 只点头侧的续行；用户侧连续消息保持原 grid，气泡靠右不受影响。
    try {
      if (cont && side === 'ai') row.setAttribute(AVATAR_CONT_ROW_ATTR, '');
      else if (row.hasAttribute(AVATAR_CONT_ROW_ATTR)) row.removeAttribute(AVATAR_CONT_ROW_ATTR);
    } catch { /* ignore */ }
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
 * 观察者的回调。两类，按代价从低到高：
 *   ① **属性变化**（只订 `hidden` / 折叠标记 / 行种类 / 回合号）：宿主展开或收起过程窗口时
 *      "哪条助手行可见"会变 ⇒ 只需要重算分组（不重建任何节点）；
 *   ② 新增元素：新增的**消息行** ⇒ 补头像；其余新增元素如果已经在装饰过的行里就直接放行 ——
 *      流式输出期间消息内部每帧都在插节点，这一级早退把开销钉在"每个新增元素一次 `closest`"上，
 *      绝不逐个 `querySelectorAll` 扫子树（那是 O(帧 × 子树) 的写法）。
 */
function avatarOnMutations(records) {
  if (!avatarActive) return;
  let decorated = false;
  let regroup = false;
  for (const r of records) {
    if (r.type === 'attributes') {
      regroup = true;
      // dsh-meme 用 style/class 把纯表情消息的文本层藏起来；藏完"有没有文本"就变了，
      // 得重新决定表情排第一行还是第二行（不订这条，隐藏发生在收图之后时会漏）。
      const t = r.target;
      const row = t && t.closest && t.closest('[' + AVATAR_ROW_ATTR + ']');
      if (row && avatarSyncMedia(row)) decorated = true;
      continue;
    }
    // 流式输出/停写：正文文本节点在变，而"有没有文本"决定表情包排第一行还是第二行。
    if (r.type === 'characterData') {
      const p = r.target && r.target.parentElement;
      const row = p && p.closest && p.closest('[' + AVATAR_ROW_ATTR + ']');
      if (row) {
        // 已经判定有文本、且这次变化仍留着非空白文本 ⇒ 结论不变，不必重扫整段正文。
        const v = r.target && r.target.nodeValue;
        if (!(v && v.trim() && !row.hasAttribute(AVATAR_NO_TEXT_ATTR))) {
          if (avatarSyncMedia(row)) decorated = true;
        }
      }
      continue;
    }
    // 第三方把图从横排容器里摘走（dedupe / 清理）⇒ 容器空了就撤，别留空白行。
    const removed = r.removedNodes;
    if (removed && removed.length && r.target && r.target.classList
      && r.target.classList.contains(AVATAR_MEDIA_CLASS)) {
      const row = r.target.closest && r.target.closest('[' + AVATAR_ROW_ATTR + ']');
      if (row && avatarSyncMedia(row)) decorated = true;
    }
    const added = r.addedNodes;
    if (!added || !added.length) continue;
    for (const n of added) {
      if (!n) continue;
      if (n.nodeType === 3) {
        const p = n.parentElement;
        const row = p && p.closest && p.closest('[' + AVATAR_ROW_ATTR + ']');
        if (row && row.hasAttribute(AVATAR_NO_TEXT_ATTR) && avatarSyncMedia(row)) decorated = true;
        continue;
      }
      if (n.nodeType !== 1) continue;
      try {
        if (n.matches && n.matches(AVATAR_ROW_SELECTOR)) {
          if (avatarDecorateRow(n)) decorated = true;
          continue;
        }
        const hostRow = n.closest && n.closest('[' + AVATAR_ROW_ATTR + ']');
        if (hostRow) {
          // dsh-meme 后续补图时仍按 row.insertBefore(img, row.firstChild) 直插行首；
          // 看到新 IMG 就收进横排容器，别让它单独占一行。纯表情行里新增的文本节点 /
          // 元素会把"无正文"改成"有正文"，也要重新排（否则表情一直停在第 1 行）。
          if ((n.tagName && String(n.tagName).toUpperCase() === 'IMG'
            || hostRow.hasAttribute(AVATAR_NO_TEXT_ATTR)) && avatarSyncMedia(hostRow)) decorated = true;
          continue;
        }
      } catch { continue; }
      let inner;
      try { inner = n.querySelectorAll ? n.querySelectorAll(AVATAR_ROW_SELECTOR) : []; } catch { inner = []; }
      for (const row of inner) { if (avatarDecorateRow(row)) decorated = true; }
    }
  }
  // 补了新行 ⇒ 分组可能变了（新行算不算"续行"取决于它前面那条）；属性变化（折叠 / 展开）
  // 会让"当前可见的第一条助手行"换人 ⇒ 同样重算。两者都合并到一帧一次。
  if (decorated || regroup) avatarScheduleGrouping();
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
  // 第三方图先放回行里，再摘横排容器；最后才摘头像与行标记。
  let mediaNodes = [];
  try { mediaNodes = document.querySelectorAll('.' + AVATAR_MEDIA_CLASS); } catch { /* ignore */ }
  for (const m of mediaNodes) avatarUnwrapMedia(m);
  let nodes = [];
  try { nodes = document.querySelectorAll('[' + AVATAR_NODE_ATTR + ']'); } catch { /* ignore */ }
  for (const n of nodes) { try { n.remove(); } catch { /* ignore */ } }
  let rows = [];
  try { rows = document.querySelectorAll('[' + AVATAR_ROW_ATTR + ']'); } catch { /* ignore */ }
  for (const row of rows) {
    try { row.removeAttribute(AVATAR_ROW_ATTR); } catch { /* ignore */ }
    try { row.removeAttribute(AVATAR_NO_TEXT_ATTR); } catch { /* ignore */ }
    try { row.removeAttribute(AVATAR_CONT_ROW_ATTR); } catch { /* ignore */ }
  }
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
      avatarObserver.observe(body, {
        childList: true, subtree: true, characterData: true,
        // 折叠 / 展开过程窗口会改这些属性，而"哪条助手行可见"决定这一轮的脸贴在哪条上
        // （issue #231）⇒ 只订这四枚，别的属性变化（包括本层自己加的 class）一概不惊动。
        attributes: true,
        attributeFilter: ['hidden', AVATAR_FOLD_ATTR, AVATAR_TURN_ATTR, 'data-chat-flow-kind', 'style', 'class', 'data-meme-hidden'],
      });
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
