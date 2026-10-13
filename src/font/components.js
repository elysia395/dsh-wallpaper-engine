/**
 * font/components.js — 按**组件**细化字体：模块前缀通道 + 启动自探测 + 白名单。
 *
 * ══ 为什么是这条通道（静态分析结论）══════════════════════════════════
 * DSH 组件 CSS 里字体绝大多数是**写死**的：39 个 CSS 文件中 `font-size` 走令牌仅 8 处、
 * 写死 212 处；`font-weight` 写死 71 处（值分布 500×24/400×19/600×12/700×11/300×1/inherit×4）。
 * 关键数字：写死的那些里 **`!important` 只有 4 处**（字重 0 处）⇒ 我们的覆盖**等特异性即可**，
 * 不需要 `!important`。
 *
 * 抓手是 CSS-module 的类名形态 `_<模块名>_<哈希>_<行号>`（如 `_wordmark_u7vgf_31`）：
 * 哈希每次构建都变，但**模块名前缀不变** ⇒ `[class*="_<模块名>_"]` 可以稳定命中。
 *
 * ⚠️ 模块名**必须实测**，不能按"组件叫什么"猜：`codeBlock` / `table` / `sidebar` 这三个
 * 按名字想当然写下的前缀，在 DSH 产物里**一个都不存在** ⇒ 那些行是"看得见、填了没用"。
 * 实测口径（在 DSH 产物里数 CSS-module 类名）：
 *   · 代码块与终端块的模块名**都是 `block`**（同名字、不同哈希）—— 同名的还有搜索块 / 网页块，
 *     它们共用 `--dsw-font-markdown-code-block` 这一个角色；
 *   · 表格的模块名是 `tableScroll`（与 `markdown` 同属一个 CSS 模块文件）；
 *   · **侧栏没有任何 CSS-module 类名**（它的插件包里连 `.css` 都没有）⇒ 没有可命中的前缀，
 *     不在白名单内（面板那一行随之消失）。
 *
 * ⚠️ 这是打包器产物，不是官方 API：DSH 换打包器/命名策略会一次性失效。所以本模块
 * **启动时自探测**（按 prefix 采样，命中才启用该组件），而不是写死选择器当契约 ——
 * 失效时只是"这个组件不可调"，不会误伤别处。
 *
 * ⚠️ **一个 prefix 会被两个组件共用**（代码块 / 终端块都是 `block`）⇒ 两条规则：
 *   · `route: 'hooks'` 的组件**只能**靠官方 `--dsl-*` 钩子生效：自定义属性按元素定义消费，
 *     在同名元素上写别人的钩子是**惰性**的 ⇒ 共用作用域安全；
 *   · 反过来它**绝不能**进 `buildComponentCss` —— 那里写的是真实属性
 *     （`font-size/weight/family`），会误伤同名的搜索块 / 网页块。由 `route === 'hooks'` 挡掉。
 *   · 已知代价：面板的"当前默认值"按**第一个命中元素**读，共用前缀的两行会显示同一个值。
 *
 * ══ 契约 ══════════════════════════════════════════════════════════════════════════
 * 需要的外界：**无**（document 由调用方传入，便于单测；族值→CSS 栈的解析函数
 *            `resolveFamily` 也由调用方传入 —— 本文件不认族键的值域，那是共享内核的事）。
 * 对外提供：COMPONENT_FONT_TARGETS（白名单）/ COMPONENT_FONT_PROPS / componentScopeSelector /
 *          probeComponentTargets / buildComponentCss / buildDslBlocks / selectorFor。
 *
 * 不变量（守卫逐条断言）：
 *   · **`id` 与 `prefix` 是两件事，不许合并**：`id` 是设置键（= 面板一行 = 持久化字段），
 *     **永不随 DSH 变**（改名 = 用户设置迁移）；`prefix` 是打包器产物里的模块名，会随 DSH 变。
 *   · 生成的选择器**只能是** `body [class*="_<白名单 prefix>_"]` 形态 —— 不许裸类名、不许标签、
 *     不许 `:has()`/祖先关联（白闪红线 1：作用域只能"直接命中"）。
 *   · 只写**白名单内**的组件；只允许 `font-size` / `font-weight` / `font-family` 三个属性。
 *   · 两态：官方值作初始值 ⇒ 配置里为空/0 的项**不生成**任何规则（等于回官方）。
 *   · 不碰 katex（数学排版自带度量）与 `@font-face`。
 */

/** 允许覆盖的属性白名单（三项，都是"字体"的本义；不碰 line-height 之类布局属性）。 */
const COMPONENT_FONT_PROPS = ['font-size', 'font-weight', 'font-family'];

/**
 * 白名单：只放开**确认值得调、且命中面可控**的组件。
 * `id` = 设置键 / 面板一行（**稳定**）；`prefix` = 打包器产物里的模块名（**实测，会随 DSH 变**）；
 * `source` = **实测出处**（DSH 客户端包里那个 `.module.css` 文件）—— 由守卫强制非空，
 * 在有 DSH 安装的机器上还会逐个核对"该文件里真的定义了 `.prefix`"。
 * `route` 说明这条腿靠什么生效：`tokens`（角色令牌，容器上写属性会被后代简写盖掉）/
 * `hooks`（官方 `--dsl-*` 组件钩子）/ `props`（直接写属性；当前无组件走这条）。
 */
const COMPONENT_FONT_TARGETS = [
  { id: 'markdown', get label() { return weT('对话正文'); }, get group() { return weT('markdown 容器'); }, prefix: 'markdown',
    source: '@deepseek-ai/dsh-client-ui-primitives/lib/markdown/MarkdownText.module.css',
    // markdown 的字号由各元素自己的 `font: var(--dsw-font-markdown-h1)` 决定 ⇒ 直接在容器上
    // 写 font-size 会被那些简写盖掉；这里的正解是角色令牌（见 src/font/typography.js）。
    route: 'tokens' },
  { id: 'codeBlock', get label() { return weT('代码块'); }, get group() { return weT('代码'); }, prefix: 'block',
    source: '@deepseek-ai/dsh-client-ui-primitives/lib/markdown/CodeBlock.module.css',
    // 代码块的字号来自后代 `font: var(--dsl-code-block-content-font)`（官方钩子）。
    // 在后代上写的简写**压过**祖先继承 ⇒ 只有在组件作用域改这个钩子才有效。
    route: 'hooks', dslHooks: ['--dsl-code-block-content-font', '--dsl-code-block-banner-font'] },
  { id: 'terminal', get label() { return weT('终端块'); }, get group() { return weT('代码'); }, prefix: 'block',
    source: '@deepseek-ai/dsh-client-ui-primitives/lib/TerminalBlock.module.css',
    route: 'hooks', dslHooks: ['--dsl-terminal-font'] },
  { id: 'table', get label() { return weT('表格'); }, get group() { return weT('对话'); }, prefix: 'tableScroll',
    source: '@deepseek-ai/dsh-client-ui-primitives/lib/markdown/MarkdownText.module.css',
    route: 'tokens' },
  // 刻意**不放开** `label` / `tab` / `input` 这类泛前缀：它们在多个模块里重名
  // （`[class*="_label_"]` 会命中一堆无关模块），命中面不可控。
  // 唯一的例外是 `block`（上面两条 hooks）—— 它同样是泛前缀，但 hooks 通道的作用域不靠它，
  // 而是靠**钩子的定义点**（见 scanHookScopes）：写在非消费方元素上是惰性的 ⇒ 命中面可控。
  // 这个例外由守卫按 `route` 断言，不许扩散。
];

const PREFIX_RE = /^[A-Za-z][A-Za-z0-9]*$/;
/**
 * 允许注入的**作用域形态**：单个类选择器（DSH 产物里的 `._block_xxxxxxxx_1`）。
 * 扫描样式表拿到的选择器来自 DSH 自己，但仍要过这一关：任何复合/后代/列表选择器
 * 都可能扩大命中面或破坏我们的注入 ⇒ 一律拒绝（拒绝即降级，不误伤）。
 */
const HOOK_SCOPE_RE = /^\.[A-Za-z0-9_-]+$/;

/** id → 白名单项（`id` 与 `prefix` 的映射**只在这里**发生）。 */
function targetById(id) {
  return COMPONENT_FONT_TARGETS.find((t) => t.id === id) || null;
}

/**
 * 按钩子扫样式表，取出**定义**该钩子的那条规则的（单类）选择器。
 *
 * @param doc document（可注入，便于单测）
 * @param hooks 要查的钩子名（缺省 = 官方那三个）
 * @returns {{[hook:string]: string}} 钩子 → 作用域选择器（查不到就没有这一项）
 *
 * **为什么不写死模块名**：同一个模块名被多个组件共用（代码块 / 终端 / 搜索块 / 网页块都是
 * `.block`），按模块名生成的作用域会把它们一起命中：改"代码块"会连带改终端正文，面板的
 * "当前默认值"也只能读到同一个元素。而钩子的**定义点**天然区分它们 ——
 * `--dsl-code-block-*` 只写在代码块的规则上、`--dsl-terminal-font` 只写在终端的规则上。
 * 这与取令牌清单（src/font/color-roles.js）的口径一致：**样式表是权威来源**。
 *
 * 代价：跨域样式表读 cssRules 会抛（跳过即可）；DSH 换写法导致钩子不再出现在样式表里时，
 * 对应的那条钩子整条不生效（降级，不误伤）—— 这正是我们要的方向。
 */
function scanHookScopes(doc, hooks) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  const out = {};
  if (!d || !d.styleSheets) return out;
  const want = hooks && hooks.length ? hooks : DSL_HOOK_NAMES;
  const visit = (rules) => {
    for (const rule of rules || []) {
      const st = rule && rule.style;
      if (st) {
        for (const hook of want) {
          if (out[hook]) continue;
          let v;
          try { v = st.getPropertyValue(hook); } catch { v = ''; }
          const sel = typeof rule.selectorText === 'string' ? rule.selectorText.trim() : '';
          if (v && v.trim() && HOOK_SCOPE_RE.test(sel)) out[hook] = sel;
        }
      }
      if (rule && rule.cssRules) visit(rule.cssRules); // @media / @supports 等分组规则
    }
  };
  for (const sheet of d.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; } // 跨域样式表：读不到就跳过
    try { visit(rules); } catch { /* 不可枚举的规则表：当作扫不到 */ }
  }
  return out;
}

/**
 * 组件 id → 作用域选择器；未知组件返回 null（读默认值用，不做抛错）。
 * hooks 通道优先用**钩子定义点**（`hookScopes` 来自 scanHookScopes）—— 那是精确作用域；
 * 其余组件用白名单模块名（`body [class*="_<prefix>_"]`）。
 */
function componentScopeSelector(id, hookScopes) {
  const t = targetById(id);
  if (!t) return null;
  if (t.dslHooks) {
    const scopes = hookScopes && typeof hookScopes === 'object' ? hookScopes : null;
    for (const hook of t.dslHooks) {
      if (scopes && scopes[hook] && HOOK_SCOPE_RE.test(scopes[hook])) return scopes[hook];
    }
    return null; // hooks 组件没有可用的定义点 ⇒ 没有精确作用域（宁可空，也不退回泛命中）
  }
  if (!PREFIX_RE.test(t.prefix)) return null;
  return 'body [class*="_' + t.prefix + '_"]';
}
/**
 * 选择器形态的唯一合法模板：**只能**由白名单里的 id 生成。
 * @param id 组件 id（= 设置键），**不是**模块名 —— 模块名不许从外部传进来。
 */
function selectorFor(id) {
  const t = targetById(id);
  if (!t) throw new Error('component-fonts: 未知组件 ' + id);
  if (!PREFIX_RE.test(t.prefix)) throw new Error('component-fonts: 非法模块前缀 ' + t.prefix);
  return 'body [class*="_' + t.prefix + '_"]';
}

/**
 * 启动自探测：采样每个白名单 prefix 在当前 DOM 里是否命中（同一 prefix 只查一次）。
 * @returns {string[]} 命中的**组件 id**（未命中的组件整条不启用 —— 失效即降级，不误伤）
 */
function probeComponentTargets(doc, targets) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  const list = targets || COMPONENT_FONT_TARGETS;
  if (!d || typeof d.querySelectorAll !== 'function') return [];
  const byPrefix = new Map();
  const hit = [];
  for (const t of list) {
    if (!byPrefix.has(t.prefix)) {
      let found;
      try { found = d.querySelectorAll('[class*="_' + t.prefix + '_"]').length > 0; } catch { found = false; }
      byPrefix.set(t.prefix, found);
    }
    if (byPrefix.get(t.prefix)) hit.push(t.id);
  }
  return hit;
}

/**
 * 生成组件级字体覆盖 CSS（**只服务 `route !== 'hooks'` 的组件**）。
 * @param config 形如 `{ markdown: { size: 15, weight: 600, family: '...' }, ... }`（键是 id）；
 *               缺项/0/空串 = 不覆盖该项（**初始值即官方值**）。
 * @param available 命中的**组件 id**（来自 probeComponentTargets）；不在其中的不生成规则
 * @param resolveFamily 族值 → CSS 栈（`fontFamilyStack`；见下方"族值要经解析"一段）。
 *               缺省视作**原样值** —— 那是给"没有字体上下文的调用点（守卫 / 单测）"的默认，
 *               真实调用点（src/font/apply.js）**一律传**它，由守卫断言。
 * @returns {string} CSS 文本（空串 = 什么都不做）
 */
function buildComponentCss(config, available, resolveFamily) {
  const cfg = config && typeof config === 'object' ? config : {};
  const avail = Array.isArray(available) ? available : [];
  const resolve = typeof resolveFamily === 'function' ? resolveFamily : (v) => v;
  const blocks = [];
  for (const target of COMPONENT_FONT_TARGETS) {
    // hooks 通道的组件**不在这里出现**：它们的作用域模块名是共用的（代码块/终端块都是
    // `block`，还连着搜索块/网页块），在这里写真实属性会误伤同名元素；而容器上的 font
    // 又会被后代简写盖掉。它们只在 buildDslBlocks 里改官方钩子。
    if (target.route === 'hooks') continue;
    if (!avail.includes(target.id)) continue;
    const c = cfg[target.id];
    if (!c || typeof c !== 'object') continue;
    const decls = [];
    if (typeof c.size === 'number' && Number.isFinite(c.size) && c.size > 0) {
      decls.push('  font-size: ' + Math.round(c.size) + 'px;');
    }
    if (typeof c.weight === 'number' && Number.isFinite(c.weight) && c.weight >= 100 && c.weight <= 900) {
      decls.push('  font-weight: ' + Math.round(c.weight) + ';');
    }
    if (typeof c.family === 'string' && c.family.trim()) {
      // 族值是**族键**（内置键或 `sys:<本机字体>`）⇒ 必须经解析成 CSS 栈；
      // 解析侧两条都认（见 src/client.js 的 fontFamilyStack）。
      decls.push('  font-family: ' + resolve(c.family.trim()) + ';');
    }
    if (!decls.length) continue; // 全空 ⇒ 回官方，不生成
    blocks.push(selectorFor(target.id) + ' {\n' + decls.join('\n') + '\n}');
  }
  return blocks.length ? blocks.join('\n') + '\n' : '';
}

/**
 * 官方的**组件级字体钩子**（`--dsl-*`）—— 全仓只有 13 个，其中与字体相关的就这三个。
 *
 * ⚠️ 关键结论：它们**不是全局覆盖点**。
 *   定义在组件**自己的根类**上（源码 CSS 的 `.block`），由后代消费（`.banner` / `pre` 等）。
 *   自定义属性按元素级联 ⇒ 在 `body` 上写没用（后代取的是祖先 `.block` 上的声明）；
 *   而 `.block` 又是**泛类名**（多个不同模块共用），直接用会命中无关元素。
 *   ⇒ 正解：写进**该钩子自己的定义点** —— 由 `scanHookScopes` 从样式表里取出（精确到文件级
 *   哈希，因此代码块与终端各自命中各自的规则），而不是按模块名猜一个泛作用域。
 *
 * 另一条同样重要的结论：**后代上的 `font:` 简写压过祖先继承**。所以对"字体来自后代简写"的
 * 组件（代码块 / 终端），在容器上写 `font-size` **无效**，只有改这些钩子才有效 ——
 * 这正是角色表里 `route` 字段要区分 `tokens` / `hooks` / `props` 的原因。
 */
const DSL_FONT_HOOKS = [
  { name: '--dsl-code-block-content-font', get label() { return weT('代码块正文'); }, role: 'markdown-code-block' },
  { name: '--dsl-code-block-banner-font', get label() { return weT('代码块标题条'); }, role: 'markdown-code-block' },
  { name: '--dsl-terminal-font', get label() { return weT('终端'); }, role: 'markdown-code-block' },
];
const DSL_HOOK_NAMES = DSL_FONT_HOOKS.map((h) => h.name);

/**
 * 用官方钩子生成覆盖：把钩子值重新组合成 `<字重> <字号>/<行高> <字族>`，
 * 其中字重/行高/字族**取自 DSH 自己的细粒度令牌**（不重写），只把字号按配置调整 ——
 * 与角色令牌的组合式（见 src/font/typography.js）同构，区别只是**写在组件作用域**而非角色令牌上。
 *
 * 钩子的原值形如 `var(--dsw-font-markdown-code-block)`（指回角色令牌）或
 * `11px/18px var(--dsw-font-family)`（字面量）。两种形态都用同一种组合方式覆盖：
 * 角色令牌那份取自 `role` 的细粒度令牌，字面量那份只改字号会丢行高 —— 因此这里
 * **只对"指回角色令牌"的钩子启用**（`role` 字段存在且四个令牌可用）。
 *
 * 作用域 = `hookScopes`（`scanHookScopes` 的结果）：**同一个钩子一个块**，
 * 因此两个组件即使共用模块名也会落到各自精确的定义点上。
 * 查不到定义点的钩子**整条不生成**（降级），不退回泛命中。
 *
 * @param config 组件配置（键是组件 id）
 * @param available 命中的组件 id（`probeComponentTargets`）
 * @param isAvailable 令牌可用性判定（缺省视作都可用）
 * @param hookScopes 钩子 → 作用域选择器（`scanHookScopes(document)`）
 * @param resolveFamily 族值 → CSS 栈（同 `buildComponentCss`；缺省原样值，真实调用点一律传）
 */
function buildDslBlocks(config, available, isAvailable, hookScopes, resolveFamily) {
  const cfg = config && typeof config === 'object' ? config : {};
  const avail = Array.isArray(available) ? available : [];
  const ok = typeof isAvailable === 'function' ? isAvailable : () => true;
  const scopes = hookScopes && typeof hookScopes === 'object' ? hookScopes : {};
  const resolve = typeof resolveFamily === 'function' ? resolveFamily : (v) => v;
  const blocks = [];
  for (const target of COMPONENT_FONT_TARGETS) {
    if (!target.dslHooks || !avail.includes(target.id)) continue;
    const c = cfg[target.id];
    if (!c || typeof c !== 'object') continue;
    const decls = [];
    let scope = null;
    for (const hook of target.dslHooks) {
      const meta = DSL_FONT_HOOKS.find((h) => h.name === hook);
      if (!meta) continue;
      const sel = scopes[hook];
      // 没有定义点（扫不到 / 形态不合规）⇒ 该钩子不生成；一条都没剩下就整条跳过。
      if (!sel || !HOOK_SCOPE_RE.test(sel)) continue;
      const t = (n) => '--dsw-font-' + meta.role + '-' + n;
      // 四个细粒度令牌缺一就跳过该钩子 —— 与角色令牌的组合式同一条规则：缺项会写出坏 font
      //（整条字体失效），宁可不覆盖（保持官方值）。
      if (![t('font-size'), t('line-height'), t('font-family'), t('font-weight')].every((n) => ok(n))) continue;
      const size = typeof c.size === 'number' && Number.isFinite(c.size) && c.size > 0
        ? Math.round(c.size) + 'px' : 'var(' + t('font-size') + ')';
      const family = typeof c.family === 'string' && c.family.trim()
        ? resolve(c.family.trim()) : 'var(' + t('font-family') + ')';
      // 字重与行高一律沿用 DSH 自己的令牌 —— 我们只动用户改的那两项。
      decls.push('  ' + hook + ': var(' + t('font-weight') + ') ' + size
        + ' / var(' + t('line-height') + ') ' + family + ';');
      if (!scope) scope = sel; // 同一组件的钩子共享定义点；不同组件各自独立
    }
    if (!decls.length || !scope) continue;
    blocks.push(scope + ' {\n' + decls.join('\n') + '\n}');
  }
  return blocks.length ? blocks.join('\n') + '\n' : '';
}

export {
  COMPONENT_FONT_TARGETS, COMPONENT_FONT_PROPS, DSL_FONT_HOOKS, HOOK_SCOPE_RE,
  componentScopeSelector, probeComponentTargets, scanHookScopes,
  buildComponentCss, buildDslBlocks, selectorFor,
};
