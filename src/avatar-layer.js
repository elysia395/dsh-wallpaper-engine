/**
 * avatar-layer.js — 「消息头像」层：给聊天区的每一条消息挂一个头像。
 *
 * ══ 为什么是这样一个角色 ══════════════════════════════════════════════════════
 * 它是**基座模块**（见 docs/CODE-STRUCTURE.md §3.1）：不吃 ctx、直接读扁平设置 store
 * `selection`，和 `video-layer` / `effects` / `metrics-layer` / `fx-layer` / `parallax-layer`
 * 同层 —— 因为头像不是某次渲染里画出来的一张图，而是**一张常驻样式表**对宿主已有 DOM 的持续
 * 修饰。渲染器给它传 ctx 反而要把每个设置项穿一遍，而"设置一改头像就得跟着变"这件事必须
 * 当场发生（拖滑块即时反馈）。
 *
 * ══ 它画什么 ═════════════════════════════════════════════════════════════════
 *   · **助手消息行左侧**挂一个头像（`avatarAssistant`，没配就用内置灰白剪影）；
 *     **用户消息行右侧**挂一个（`avatarUser`）。
 *   · **观感**：直径 `avatarSize`（默认 42）、行内留白 `avatarGap`（默认 12）、
 *     圆角 `avatarRadius`（默认 0，即方形）、贴边偏移 `avatarLeftInset` / `avatarRightInset`
 *     （默认 0）、总开关 `avatarEnabled`。
 *   · **默认头像**：内置一张灰白剪影 SVG，运行时经 `encodeURIComponent` 编成
 *     `data:image/svg+xml`（# 与引号必须编码，否则 `#c9ced3` 会被当成片段标识符截断）。
 *
 * ══ 为什么是伪元素而不是插 <img> ══════════════════════════════════════════════
 * 聊天行是 React 反复重渲染的：插进去的节点会被下一次 diff 抹掉，得配
 * MutationObserver 才留得住（而且每次重挂都在闪）。伪元素**跟着宿主节点走**，宿主重建它就在，
 * 本层只维护一张样式表 —— 一次 `textContent` 赋值 = 全量换装。
 *
 * 契约：
 *   需要的外界：`selection`（设置 store，只读）、`document`（建一个 `<style>` 标签）。
 *   对外提供：`syncAvatarLayer()`（设置变了就调一次）、`disposeAvatarLayer()`（卸载清理）、
 *   `buildAvatarCss(sel)`（纯函数：给定一个选择器返回它那段 CSS，供单测直接断言）。
 *   设置项（`avatar*`，真源 lib/settings-schema.js）：总开关 / 直径 / 间隙 / 圆角 /
 *   左右贴边偏移 / 助手图 / 用户图（后两个是 data URI）。
 *
 * 不变量：
 *   · **只读 `selection`**：一个字节都不写（裸写棘轮只留给 media-prep / effects / live-layer）。
 *     拖动滑块时的即时反馈靠"每次 sync 现读设置"，不靠写回。
 *   · **零顶层可执行语句**：本文件的顶层只有声明 —— 读 `selection` / 碰 `document` 的语句
 *     一律在函数里（内联后 prelude 早于 `src/client.js` 正文求值，顶层读它必撞 TDZ）。
 *   · **键缺失或类型不对一律走默认值**，绝不抛：`avatarStore()` 包 try/catch（连 TDZ 的
 *     ReferenceError 也接住），数值经 `avatarNum()` 钳回区间，图片经 `avatarImage()` 校验。
 *   · **图片只收 data:image/**：面板给的是 data URI，但 `url()` 里能塞 `javascript:`。
 *     另挡掉 `"` `'` `\` 换行 `<` `>` —— 这些能把 url() 或后面的规则截断（样式表是拼出来的，
 *     一个引号就是一次注入）。括号不管：url 用双引号包住时括号合法，而
 *     `encodeURIComponent` **不编码** `()`，SVG 里常有圆括号。
 *   · ⚠️ **`content: url(img)` 在 Chrome 里不行**：那样生成的是"内容图像"（replaced
 *     element），**不吃 width / height / border-radius**（永远原始尺寸、永远不圆）。
 *     所以必须 `content: ""` + `background-image` + `background-size: cover`。
 *   · ⚠️ **`::before` 默认是 `display: inline`**：inline 盒子吃不下显式的
 *     width / height（height 直接失效）⇒ 必须显式 `display: block`。
 *   · ⚠️ **贴边偏移走 `left` / `right`，不走 padding**：`::before` 是 absolute 定位，
 *     它的基准是**最近的定位祖先**（这里是我们自己写上的 `position: relative`），
 *     **padding 不是 absolute 的基准** ⇒ 想把头像往外挪只能改 left / right，
 *     padding 只负责给行**腾出**位置（`padding-left` / `padding-right`）。
 *   · **行选择器用 CSS module 语义后缀**（`[class*="hWmORq_root"]` = 助手行、
 *     `[class*="Sixlwa_userRow"]` = 用户行）：打包器只保证"类名带语义后缀"，
 *     前面的哈希每次构建都会变 —— 写死哈希等于每次构建都掉头像。
 *   · **每侧各写一套 `::before`**（助手挂 left、用户挂 right）：一条消息行两侧的定位基准
 *     不同，共用一个规则就得靠方向类名区分，而 dsh 没有那个类名。
 *   · **不建任何消息节点、不碰 React**：只写样式表，不 `appendChild` 到聊天区、不改 DOM 结构、
 *     不接管事件（`pointer-events: none`，免得头像吃掉行上的 hover / 复制 / 工具提示）。
 *   · **关掉不留痕**：`avatarEnabled` 为假 ⇒ 直接把 `<style>` 摘掉（不是写空串），
 *     于是那几条规则整段不命中，`position` / `padding` 也一并还原。
 *   · **找不到聊天 DOM 不报错**：本层压根不去查消息节点 —— 规则挂不挂在宿主页面上由浏览器
 *     决定，聊天区还没渲染出来时先写着样式即可。
 */

const AVATAR_STYLE_ID = 'we-avatar-css';

/** 聊天行选择器（CSS module 语义后缀，见文件头；哈希部分每次构建变，别写死）。 */
const AVATAR_ASSISTANT_SEL = '[class*="hWmORq_root"]';
const AVATAR_USER_SEL = '[class*="Sixlwa_userRow"]';

/** 默认头像：灰白剪影（底 #c9ced3 / 形 #767c84）。运行时编成 data URI，见 avatarImage。 */
const AVATAR_DEFAULT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#c9ced3"/><circle cx="20" cy="15.5" r="9" fill="#767c84"/><path d="M1 40c0-8.9 8.5-13.5 19-13.5S39 31.1 39 40z" fill="#767c84"/></svg>';

/** 头像距行顶的偏移（px，常量不是设置项：它是"与首行基线对齐"的观感，与三个旋钮是两件事）。 */
const AVATAR_TOP_PX = 2;

/** 数值区间（与 lib/settings-schema.js 的 KINDS 对齐；写进 CSS 前仍钳一次）。 */
const AVATAR_SIZE_MIN = 20;
const AVATAR_SIZE_MAX = 72;
const AVATAR_SIZE_DEFAULT = 42;
const AVATAR_GAP_MIN = 0;
const AVATAR_GAP_MAX = 40;
const AVATAR_GAP_DEFAULT = 12;
const AVATAR_RADIUS_MIN = 0;
const AVATAR_RADIUS_MAX = 48;
const AVATAR_RADIUS_DEFAULT = 0;
const AVATAR_INSET_MIN = 0;
const AVATAR_INSET_MAX = 32;
const AVATAR_INSET_DEFAULT = 0;

/** 会把 url() 或后面的规则截断的字符（见文件头"图片只收 data:image/"那条）。 */
const AVATAR_UNSAFE_URL_RE = /["'\\\n\r<>]/;

/**
 * 设置 store：拿不到就交一个空对象（`try/catch` 是必须的 —— `typeof` **挡不住 TDZ**，
 * 对 `const selection` 做 typeof 在初始化前照样抛 ReferenceError）。
 */
function avatarStore() {
  try {
    return (typeof selection === 'object' && selection) || {};
  } catch (e) {
    return {};
  }
}

/** 数值钳位：非数字 / 非有限一律回退到默认值（设置存的是字符串也得认）。 */
function avatarNum(value, lo, hi, fallback) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * 图片地址：只收 `data:image/*`，挡掉能截断 CSS 的字符，其余原样用。
 * 缺省 / 不合格 ⇒ 落到内置剪影（`fallback` 已编好的 data URI）。
 */
function avatarImage(value, fallback) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) return fallback;
  if (!/^data:image\/[a-z0-9.+-]+[;,]/i.test(v)) return fallback;
  if (AVATAR_UNSAFE_URL_RE.test(v)) return fallback;
  return v;
}

/** 内置剪影的 data URI（**运行时**编码，不是顶层常量 —— 见文件头"零顶层可执行语句"）。 */
function avatarDefaultImage() {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(AVATAR_DEFAULT_SVG);
}

/**
 * 设置快照（每次 sync 现读 ⇒ 拖滑块不需要 emit 就能看到反馈）。
 * 档位取值刻意**只做字面量比较**、不引 lib/settings-schema.js 的值表：本文件要能被单独
 * import（单测就是这么测的）—— 引那份常量会在单文件环境里 ReferenceError。
 */
function avatarSettings() {
  const s = avatarStore();
  const def = avatarDefaultImage();
  return {
    on: s.avatarEnabled === true,
    size: avatarNum(s.avatarSize, AVATAR_SIZE_MIN, AVATAR_SIZE_MAX, AVATAR_SIZE_DEFAULT),
    gap: avatarNum(s.avatarGap, AVATAR_GAP_MIN, AVATAR_GAP_MAX, AVATAR_GAP_DEFAULT),
    radius: avatarNum(s.avatarRadius, AVATAR_RADIUS_MIN, AVATAR_RADIUS_MAX, AVATAR_RADIUS_DEFAULT),
    leftInset: avatarNum(s.avatarLeftInset, AVATAR_INSET_MIN, AVATAR_INSET_MAX, AVATAR_INSET_DEFAULT),
    rightInset: avatarNum(s.avatarRightInset, AVATAR_INSET_MIN, AVATAR_INSET_MAX, AVATAR_INSET_DEFAULT),
    assistantImage: avatarImage(s.avatarAssistant, def),
    userImage: avatarImage(s.avatarUser, def),
  };
}

/**
 * 选择器清洗：CSS 是拼出来的，一个 `{` 就能提前闭合规则再插一条新规则。
 * 我们的选择器里不会出现这些字符（`[]*=` 与引号都是合法的），去掉它们只影响误传进来的值。
 */
function avatarCleanSelector(sel) {
  if (typeof sel !== 'string') return '';
  return sel.trim().replace(/[\n\r{}<>@;]/g, '');
}

/** 这一侧挂左边还是右边：选择器里带 `userRow` 的是用户行（右侧），其余按助手行（左侧）处理。 */
function avatarSideOf(target) {
  return target.indexOf('userRow') >= 0 ? 'right' : 'left';
}

/**
 * 给一个选择器生成它那侧的头像 CSS（纯函数，单测直接调）。
 * 设置值以**自定义属性**落在这条选择器自己身上（不是 `:root`）：每段自包含 ⇒ 摘掉一段就
 * 连带那几条变量一起消失，不会残留半截状态；作用域也只有这一个选择器命中的那些行。
 * `side` 省略时按选择器推断（见 avatarSideOf）。
 */
function buildAvatarCss(sel, side) {
  const target = avatarCleanSelector(sel);
  if (!target) return '';
  const right = (typeof side === 'string' && side === 'right') ? true
    : (typeof side === 'string' && side === 'left' ? false : avatarSideOf(target) === 'right');
  const st = avatarSettings();
  const size = st.size + 'px';
  const gap = st.gap + 'px';
  const radius = st.radius + 'px';
  // 贴边偏移只落在这一侧（助手读左、用户读右），且**只走 left/right**（见文件头那条 ⚠️）。
  const inset = (right ? st.rightInset : st.leftInset) + 'px';
  const image = right ? st.userImage : st.assistantImage;
  const anchor = right ? 'right' : 'left';
  const padSide = right ? 'padding-right' : 'padding-left';
  return target + ' {\n'
    + '  --we-avatar-size: ' + size + ';\n'
    + '  --we-avatar-gap: ' + gap + ';\n'
    + '  --we-avatar-radius: ' + radius + ';\n'
    + '  --we-avatar-inset: ' + inset + ';\n'
    + '  --we-avatar-image: url("' + image + '");\n'
    + '  /* positioning context: without it ::before anchors to an ancestor and the offset lands outside the chat */\n'
    + '  position: relative;\n'
    + '  /* padding only makes room, it is not the positioning basis */\n'
    + '  ' + padSide + ': calc(var(--we-avatar-size) + var(--we-avatar-gap) + var(--we-avatar-inset));\n'
    + '}\n'
    + target + '::before {\n'
    + '  /* empty string + background-image: content:url() makes a content image that ignores size and radius */\n'
    + '  content: "";\n'
    + '  position: absolute;\n'
    + '  top: ' + AVATAR_TOP_PX + 'px;\n'
    + '  ' + anchor + ': var(--we-avatar-inset);\n'
    + '  /* pseudo-elements default to inline and cannot take a height */\n'
    + '  display: block;\n'
    + '  width: var(--we-avatar-size);\n'
    + '  height: var(--we-avatar-size);\n'
    + '  border-radius: var(--we-avatar-radius);\n'
    + '  background-image: var(--we-avatar-image);\n'
    + '  background-repeat: no-repeat;\n'
    + '  background-position: center center;\n'
    + '  background-size: cover;\n'
    + '  box-sizing: border-box;\n'
    + '  z-index: 0;\n'
    + '  /* do not swallow the row hover / copy / tooltip */\n'
    + '  pointer-events: none;\n'
    + '}\n';
}

/** 全量样式表：助手行（左侧）+ 用户行（右侧）。 */
function avatarCssText() {
  return buildAvatarCss(AVATAR_ASSISTANT_SEL, 'left')
    + buildAvatarCss(AVATAR_USER_SEL, 'right');
}

/** 取（必要时建）那张 `<style>`（幂等）：同 id 已存在就复用，不重复插标签。 */
function avatarStyleTag() {
  if (typeof document === 'undefined' || !document) return null;
  let tag = null;
  try {
    tag = document.getElementById(AVATAR_STYLE_ID);
  } catch (e) {
    tag = null;
  }
  if (tag) return tag;
  const host = document.head || document.body || document.documentElement;
  if (!host || typeof host.appendChild !== 'function') return null;
  tag = document.createElement('style');
  tag.id = AVATAR_STYLE_ID;
  try { tag.dataset.pluginAvatar = 'dsh-wallpaper-engine'; } catch (e) { /* 旧宿主无 dataset */ }
  host.appendChild(tag);
  return tag;
}

/**
 * 设置变了就调一次（由 `src/client.js` 的 `subscribe(syncAvatarLayer)` 驱动）。
 * 重新生成 CSS 文本并整段换进 `<style>`：React 聊天区被重渲染也不影响（样式表不参与 diff）。
 */
function syncAvatarLayer() {
  try {
    if (typeof document === 'undefined') return;
    const st = avatarSettings();
    // 关掉 ⇒ 摘标签（不是写空串）：那几条规则整段不命中，position / padding 一并还原。
    if (!st.on) {
      disposeAvatarLayer();
      return;
    }
    const tag = avatarStyleTag();
    if (!tag) return;
    const css = avatarCssText();
    if (tag.textContent !== css) tag.textContent = css;
  } catch (e) { /* 头像是增强层：任何异常都不该冒到主路径 */ }
}

/** 卸载：本模块拥有的一切都收掉（就那一个标签）。 */
function disposeAvatarLayer() {
  try {
    if (typeof document === 'undefined') return;
    const tag = document.getElementById(AVATAR_STYLE_ID);
    if (tag && tag.parentNode) tag.parentNode.removeChild(tag);
  } catch (e) { /* 已卸载 */ }
}

export { syncAvatarLayer, disposeAvatarLayer, buildAvatarCss };