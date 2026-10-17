/**
 * font/typography.js — 按角色调整**排版**（字号绝对值 px + 字重/字族），走 DSH theme 令牌层。
 *
 * ══ 为什么是这套令牌（静态分析结论；不是猜的）══════════════════════════
 *
 * ① **组件消费的是 shorthand，不是细粒度令牌**：组件 module.css 的 `font:` 全是简写
 *    （`font: var(--dsw-font-<角色>)` 共 **21 处**）；细粒度里**只有** `-font-family` 有 1 处
 *    消费者（user-text.module.css），`-font-size` / `-font-weight` / `-font-style` **零消费者**
 *    ⇒ 只改 `--dsw-font-<角色>-font-size` **必然无效**（那条路是诱饵）。
 *
 * ② **shorthand 是字面量、不由细粒度令牌组合**（定义在
 *    @deepseek-ai/dsh-client-ui-theme/lib/client.js 的 design-platform CSS 串），三种形态：
 *    A. 带 delta 的基准 / B. 用 DSH 正文字号 / C. 纯字面量（不随 DSH 字号缩放）。
 *    ⇒ 本模块**照抄 DSH 的角色表达式**（角色表 size 字段，不"统一化"）：未设字号的角色继续
 *      引用 DSH 令牌（C 类不缩放、B 类跟随 DSH 字号），设了绝对值的角色用该 px。
 *
 * ③ **DSH 的「通用 → 字号」经 `--dsh-content-font-delta` 进来**（CSS 侧自带 14px 兜底
 *    ⇒ shorthand 不会 invalid）。**本模块从不写 `--dsh-content-font-size`** —— 那是 DSH
 *    自己的设置（红线 3），只在角色级写该角色自己的令牌，用户的 DSH 字号照常生效。
 *
 * ④ **重取角色表的方法**（DSH 升级后基准值变了就重跑这一条，然后核对下表）：
 *    node -e "const s=require('fs').readFileSync(process.argv[1],'utf8');for(const m of s.matchAll(/--dsw-font-([a-z0-9-]+?):([^;{}\\"]+)/g))if(!/-font-|-line-height$|-font$/.test(m[1]))console.log(m[1],'=',m[2].trim().slice(0,90))"
 *      "D:/DSH Desktop/resources/app/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js"
 *
 * ⑤ **字重同样可细化**：39 个组件 CSS 里 `font-weight` 写死 **71 处、`!important` 零处**，每个
 *    角色在 design-platform 里都有细粒度令牌 `--dsw-font-<角色>-font-weight`（= 本表 `prefix`）
 *    ⇒ 角色级（组合式的字重前缀换成该令牌再覆盖）与组件级（与字号同一条 `[class*="_<模块>_"]`
 *    通道，零 `!important` ⇒ 等特异性即可压过）两条路径；官方值：角色级取自细粒度令牌，组件级取
 *    组件声明（写前先 getComputedStyle 取基线，与令牌层 `onBeforeFirstWrite` 同法）。⚠️ katex 与 `@font-face` 不碰。
 *
 * ══ 契约 ══════════════════════════════════════════════════════════════════════════
 * 需要的外界：**无**（纯计算；令牌可用性由调用方给的判据决定，族键 → CSS 栈的解析函数
 *   也由调用方传入 —— 见 buildTypePayload 的 `resolveFamily`）。
 * 对外提供：THEME_TYPE_ROLES / buildTypePayload / THEME_TYPE_SOURCE / GLOBAL_FAMILY_TOKEN /
 *   字号上下限。
 *   建层与轮询复用 src/font/color-roles.js 的 createThemeLayer / pollThemeService ——
 *   **必须用不同的 source**：同 source 再注册会整层替换，会把文字颜色角色的令牌层顶掉。
 *
 * 不变量（有守卫）：
 *   · 每个被接管的角色写 **shorthand**，设了字号时另写该角色的 `-font-size`
 *     （`-line-height` 只被 shorthand 以 `var()` 读，从不写）；且**四个令牌全部存在**
 *     才接管该角色（缺一个就会写出坏 shorthand ⇒ 整条字体失效）。
 *   · **不重写** DSH 的表达式、不写 DSH 的 `--dsh-content-font-size`；字重/字族只走 DSH
 *     自己的细粒度令牌（`var(--dsw-font-<角色>-font-weight)` / `-font-family`）。
 *   · 值一律 `{light, dark}` 且**两侧同值**（排版与配色无关）。
 */

const THEME_TYPE_SOURCE = 'wallpaper-engine-typography';

/**
 * DSH 的**基准字族令牌**：角色表之外的界面文字与"没被我们接管的角色"都从它继承。
 * 全局字族除按角色写之外，还写这一个（否则"全局"够不到那些地方）。
 * 它不在角色表里 ⇒ 可用性单独判（`isAvailable(GLOBAL_FAMILY_TOKEN)`）。
 */
const GLOBAL_FAMILY_TOKEN = '--dsw-font-family';

/** 绝对字号范围（px）。用户口径：字号用**绝对值**，默认值可见（角色表的 defaultPx）。 */
const THEME_SIZE_MIN = 8;
const THEME_SIZE_MAX = 48;

const DELTA = 'var(--dsh-content-font-delta)';
const DELTA_2 = 'var(--dsh-content-font-delta-secondary)';
const BODY_SIZE = 'var(--dsh-content-font-size,14px)';
const BODY_SIZE_2 = 'var(--dsh-content-font-size-secondary,13px)';

/**
 * 角色表：`id` = DSH 的令牌角色名（令牌名由它派生），表达式**照抄 DSH 原文**。
 * prefix 是 shorthand 里字号之前的那一段（字重/斜体），同样照抄。
 * **行高不在此表**：一律沿用 DSH 令牌 `--dsw-font-<角色>-line-height`（组装 shorthand 时读，见
 * `buildTypePayload`）⇒ 表里不再保存 lh 值（此前有 12 个纯数据 `lh` 字段，零消费者，已删）。
 */
const THEME_TYPE_ROLES = [
  // —— 对话区 markdown（MarkdownText.module.css 消费）——
  { id: 'markdown-h1', get label() { return weT('标题 1'); }, prefix: '700', size: `calc(21px + ${DELTA})`, defaultPx: 21 },
  { id: 'markdown-h2', get label() { return weT('标题 2'); }, prefix: '700', size: `calc(19px + ${DELTA})`, defaultPx: 19 },
  { id: 'markdown-h3', get label() { return weT('标题 3'); }, prefix: '700', size: `calc(18px + ${DELTA})`, defaultPx: 18 },
  { id: 'markdown-h4', get label() { return weT('标题 4'); }, prefix: '600', size: BODY_SIZE, defaultPx: 14 },
  { id: 'markdown-base', get label() { return weT('对话正文'); }, prefix: '', size: BODY_SIZE, defaultPx: 14 },
  { id: 'markdown-small', get label() { return weT('小字说明'); }, prefix: '', size: '12px', defaultPx: 12 },
  { id: 'markdown-code', get label() { return weT('行内代码'); }, prefix: '', size: '12px', defaultPx: 12 },
  { id: 'markdown-code-block', get label() { return weT('代码块'); }, prefix: '', size: '11px', defaultPx: 11 },
  { id: 'markdown-table', get label() { return weT('表格'); }, prefix: '', size: BODY_SIZE_2, defaultPx: 13 },
  { id: 'markdown-table-head', get label() { return weT('表头'); }, prefix: '500', size: BODY_SIZE_2, defaultPx: 13 },
  // —— 界面通用阶梯（SearchBlock / WebBlock / TerminalBlock 消费 xs-13）——
  { id: 'xs-13', get label() { return weT('界面小字'); }, prefix: '', size: '13px', defaultPx: 13 },
  { id: 'xxs-12', get label() { return weT('界面极小字'); }, prefix: '', size: '12px', defaultPx: 12 },
];

const typeTokenNames = (role) => ({
  size: `--dsw-font-${role}-font-size`,
  lineHeight: `--dsw-font-${role}-line-height`,
  family: `--dsw-font-${role}-font-family`,
  weight: `--dsw-font-${role}-font-weight`,
  shorthand: `--dsw-font-${role}`,
});

/** 字号是否可用（整数、在范围内）。未设置 = 用 DSH 官方值（保留 delta 联动）。 */
function isTypeSize(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= THEME_SIZE_MIN && v <= THEME_SIZE_MAX;
}

/**
 * 把「角色 → 字号绝对值(px) / 字重 / 字族」+「**全局字族**」编译成 overrideTokens 载荷。
 *
 * 全局字族是**默认**而不是强制，分两条腿落地（两条的必要性见循环里那段注释）：
 *   · 写一次 DSH 的**基准字族令牌** `--dsw-font-family` —— 角色表之外的一切、以及"没被我们
 *     接管的角色"（DSH 自己的组合式读的就是它）都从它继承；
 *   · 已经被接管的角色（用户改过它的字号/字重）顺带把它的字族也落到全局 —— 那些角色的
 *     组合式已经改读细粒度令牌了，不再经过基准令牌。
 * @param sizes 形如 `{ 'markdown-h1': 21, 'markdown-small': 12 }`（可缺键/可脏）
 * @param isAvailable `(token) => boolean` —— 四个令牌全可用才接管该角色
 * @param weights 角色字重（可缺）
 * @param families 角色字族**族键**（可缺）
 * @param resolveFamily `(族键) => CSS 栈`（内置键 / `sys:` 本机字体键都经它解析）
 * @param globalFamily 全局字族**族键**（空 = 不设全局；`inherit` 视作不设）
 * @returns {{ payload: object, roles: string[] }}
 */
function buildTypePayload(sizes, isAvailable, weights, families, resolveFamily, globalFamily) {
  const szs = sizes && typeof sizes === 'object' ? sizes : {};
  const wts = weights && typeof weights === 'object' ? weights : {};
  const fams = families && typeof families === 'object' ? families : {};
  const ok = typeof isAvailable === 'function' ? isAvailable : () => true;
  const resolve = typeof resolveFamily === 'function' ? resolveFamily : (() => '');
  // 全局字族的栈：`inherit`（内置的「默认」项）在这里等于"不设全局"—— 写它没有意义，
  // 而把它当成一个值会让每个角色都被接管（等于把官方外观改写一遍）。
  // 值本身不在这里消毒：族键的值域是共享内核（`sanitizeFamilyKey`）的事，而本模块是
  // **零外界**的纯计算（守卫直接 import 它，拿不到 bundle 作用域）⇒ 只做"空 / inherit"两判，
  // 认不出的值由 resolveFamily 兜成 `inherit`（同样落进下面这条 useGlobal 判据）。
  const globalKey = typeof globalFamily === 'string' ? globalFamily.trim() : '';
  const globalStack = globalKey ? resolve(globalKey) : '';
  const useGlobal = typeof globalStack === 'string' && globalStack.length > 0 && globalStack !== 'inherit';
  const payload = {};
  const roles = [];
  // 基准字族：只写**我们真正有值**的那一个（令牌不在就整条不做，保持官方外观）。
  if (useGlobal && ok(GLOBAL_FAMILY_TOKEN)) {
    payload[GLOBAL_FAMILY_TOKEN] = { light: globalStack, dark: globalStack };
  }
  for (const role of THEME_TYPE_ROLES) {
    const sz = szs[role.id];
    const useSize = isTypeSize(sz);
    const w = wts[role.id];
    const useWeight = typeof w === 'number' && Number.isInteger(w) && w >= 100 && w <= 900;
    const famKey = typeof fams[role.id] === 'string' && fams[role.id] ? fams[role.id] : '';
    // 角色字族优先；没设才落到全局 —— 但**只在"这个角色本来就要被接管"时**才落，
    // 这一点是承重的：接管一个角色意味着连它的字号/行高都改走细粒度令牌（组合式要凑齐四件套），
    // 而"用户只挑了个全局字体"不该顺手改动任何角色的字号。没被接管的角色照旧用 DSH 的组合式，
    // 那里读的就是 `--dsw-font-family`（上面刚写过）⇒ 全局字体照样到得了它。
    const famStack = famKey ? resolve(famKey)
      : (useGlobal && (useSize || useWeight) ? globalStack : '');
    const useFamily = typeof famStack === 'string' && famStack.length > 0;
    if (!useSize && !useWeight && !useFamily) continue;
    const t = typeTokenNames(role.id);
    // 令牌齐备性：四件套（size/line-height/family/shorthand），调字重时多要 -font-weight。
    const need = [t.size, t.lineHeight, t.family, t.shorthand];
    if (useWeight) need.push(t.weight);
    if (!need.every((n) => ok(n))) continue;
    let prefix = role.prefix ? role.prefix + ' ' : '';
    if (useWeight) {
      payload[t.weight] = { light: String(Math.round(w)), dark: String(Math.round(w)) };
      prefix = `var(${t.weight}) `;
    }
    if (useFamily) {
      // 覆盖 DSH 的字族令牌（两侧同值）：这样"按角色的字体"能落到用 `font:` 简写的元素上。
      payload[t.family] = { light: famStack, dark: famStack };
    }
    // 字号：**绝对值**（用户口径）—— 设了就写该角色的字号令牌，组合式直接用这个 px。
    // 副作用（已确认接受）：设过的角色不再随 DSH「通用 → 字号」缩放；未设的照旧跟随。
    if (useSize) payload[t.size] = { light: sz + 'px', dark: sz + 'px' };
    const sizeExpr = useSize ? sz + 'px' : `var(${t.size})`;
    // 行高一律沿用 DSH 的令牌（用户口径：行高保持 DSH 的，不随绝对值缩放）。
    const shorthand = `${prefix}${sizeExpr} / var(${t.lineHeight}) var(${t.family})`;
    payload[t.shorthand] = { light: shorthand, dark: shorthand };
    roles.push(role.id);
  }
  return { payload, roles };
}

export {
  THEME_TYPE_SOURCE, THEME_TYPE_ROLES,
  THEME_SIZE_MIN, THEME_SIZE_MAX,
  buildTypePayload,
};
