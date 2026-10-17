/**
 * i18n.js — 插件文案的本地化层（**跟随宿主 `locale` 服务**，语言种类与 dsh web 同一份目录）。
 *
 * ── 一句话 ────────────────────────────────────────────────────────────────────
 * 宿主 web GUI 的语言由 `@deepseek-ai/dsh-client-locale` 提供（设置 → 通用 → 语言，
 * 内置 `zh` / `en`，语言包可通过 `ctx.locale.addLanguage` 追加）。本模块把插件自己的
 * 文案接进**同一份目录**：不新造语言开关、不自己读写偏好 —— 用户在官方语言行里切一次，
 * 插件的界面跟着变。
 *
 * ── 词典形态：中文原文即键（msgid）────────────────────────────────────────────
 * 键**就是**界面上的中文原文（`weT("壁纸模糊")`），`src/i18n-copy.js` 里那张表是
 * 「中文 → 英文」。为什么不用 `picker.blur.label` 这类语义键：
 *   · 本仓 700+ 条文案散布在数十个模块里，语义键要额外发明 700+ 个名字，每多一层
 *     间接就多一次"键指错行"的机会，而**原文做键不可能指错**：查不到就是原文。
 *   · 缺译/漏包的表现是"中文原样露出"（可读、可 grep、可断言），而不是界面里冒出
 *     `picker.blur.label` 这种机器味道的占位符。
 *   · 守卫（test/verify-i18n.mjs）可以双向对账：代码里的 `weT("…")` 集合 ⇄ 词表键集，
 *     少一条、多一条都当场变红。
 * 代价（写在明处）：键是中文 ⇒ 英文词表自带一份中文原文，改中文文案等于改键
 * （旧键会变成孤儿，守卫的"零孤儿"那条会钉住这次改动）。语言包（ja 等）若想覆盖本
 * 插件，需要拿到这份中文键集 —— 这是本方案明确的取舍。
 *
 * ── 语言解析（与官方同一套口径）──────────────────────────────────────────────
 *   ① `?we-lang=<id>` 覆盖 —— 排障与守卫用的逃生舱（本仓既有 `?we-saturate=` 风格）；
 *   ② 已接入官方服务 ⇒ 读 `getSnapshot().active`（**权威**，含语言包）；
 *   ③ 服务缺席（低版本宿主 / 测试沙箱）⇒ `zh`（保持历史行为：没有语言服务时界面不变）。
 * 文案取值：`zh` ⇒ 原文即键；其它语言 ⇒ 英文词表（查不到落回原文）。官方服务在场时
 * 走它自己的 `bind(ns)`（同一条 fallback 链：语言包的 ja → 声明回退 en → 本表），
 * 服务缺席时用本模块的等价实现 —— 两条路径的输出由守卫逐条比对，不许漂移。
 *
 * ── 切换怎么传到界面（live）──────────────────────────────────────────────────
 *   · React 组件：在**顶层组件**调 `useWeLocale()`（订阅 revision 的 uSES 钩子），
 *     语言一变整棵子树重渲染；文案在**渲染期**取（`weT(...)` 现读现算）。
 *   · 非 React 的 DOM 补丁（设置 nav 图标、DOM 锚点文案）：`weOnLocaleChange(fn)`
 *     订阅后自行重放；模块级"冻结"的文案对象一律改成函数/渲染期取值。
 *   · 宿主注册面的 thunk（`label: () => weT("壁纸引擎")`）由宿主在每次读取时求值，
 *     自动跟随 —— 本插件的 slot/shortcut/tab 注册都已用 thunk 形态。
 *
 * ── 契约（构建期由 scripts/build-client.mjs 内联进 bundle 的工厂作用域）────────
 *   · 本文件必须保持浏览器安全（无 import / require / Node API），且**不得有顶层可执行
 *     语句**读 client.js 的 const（会被内联到 bundle 顶部，撞 TDZ）；React 只在钩子
 *     被调用时才读（同 panel-tabs.js 的口径）。
 *   · 内联顺序：`src/i18n-copy.js` 在本文件之前（`WE_I18N_EN` 必须先于 `weT` 的定义存在？
 *     不必 —— 函数声明只在调用时才读它，但**顺序保持 copy → i18n** 更省心）。
 *   · `weT` 是本层唯一的取词入口；除守卫在册的允许清单外，界面上不得出现裸中文串
 *     （见 test/verify-i18n.mjs 的判据 ①）。
 */

/** 官方 locale 注册表里的命名空间：只属于本插件，一个命名空间一份文案所有权。 */
const WE_I18N_NS = "wallpaper-engine";

/** 语言覆盖的查询参数名（排障 / 守卫用；与 `?we-saturate=` 同一种逃生舱口径）。 */
const WE_LANG_PARAM = "we-lang";

/** 无语言服务时的默认语言：保持本插件的历史行为（界面是中文）。 */
const WE_I18N_DEFAULT_LOCALE = "zh";

let weLocaleService = null;   // 已接入的官方 LocaleRuntime（缺席 = null）
let weLocaleActive = WE_I18N_DEFAULT_LOCALE;
let weLocaleRevision = 0;
const weLocaleListeners = new Set();

/** 中文判定：`zh` / `zh-CN` / `zh-Hans` 一律算中文（与官方 localeKey 无关，只看前缀）。 */
function weLocaleIsZh(id) {
  return String(id || "").toLowerCase().startsWith("zh");
}

/**
 * 语言覆盖 `?we-lang=<id>`：只解析一次并缓存。
 * 缺省 / 空 / 非法值 ⇒ null（不覆盖，回到官方服务或默认语言）。
 */
let weLangOverrideResolved = false;
let weLangOverrideValue = null;
function weLangOverride() {
  if (weLangOverrideResolved) return weLangOverrideValue;
  weLangOverrideResolved = true;
  weLangOverrideValue = null;
  try {
    if (typeof location === "undefined" || !location || typeof location.search !== "string") return null;
    let raw = "";
    if (typeof URLSearchParams === "function") raw = new URLSearchParams(location.search).get(WE_LANG_PARAM) || "";
    else {
      const m = new RegExp("[?&]" + WE_LANG_PARAM + "=([^&]*)").exec(location.search);
      raw = m ? decodeURIComponent(m[1]) : "";
    }
    const id = String(raw).trim().toLowerCase();
    // 只收 BCP 47 风格的短 id（防垃圾值把界面切到一个查不到的"语言"）。
    if (/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(id)) weLangOverrideValue = id;
  } catch { /* 解析异常：不覆盖 */ }
  return weLangOverrideValue;
}

/** 当前生效语言 id（`useWeLocale` 的读口，也是守卫的观测点）。 */
function weLocaleId() {
  const override = weLangOverride();
  if (override !== null) return override;
  if (weLocaleService !== null) return weLocaleActive;
  return WE_I18N_DEFAULT_LOCALE;
}

/** 修订号：语言切换 / 词表注册都 +1（uSES 的快照值，必须稳定可比）。 */
function weLocaleRevisionValue() {
  return weLocaleRevision;
}

/** 订阅语言变化（返回退订函数）。React 侧走 useWeLocale，DOM 侧走这个。 */
function weLocaleSubscribe(fn) {
  if (typeof fn !== "function") return () => {};
  weLocaleListeners.add(fn);
  return () => { weLocaleListeners.delete(fn); };
}

/** `weLocaleSubscribe` 的语义别名：DOM 补丁重放用（读作"语言变了重跑一次"）。 */
function weOnLocaleChange(fn) {
  return weLocaleSubscribe(fn);
}

/** 广播：只在**真的变了**（语言 id 或修订号）时通知，避免注册期空转整棵界面。 */
function weLocalePublish(nextActive, force) {
  const changed = force === true || nextActive !== weLocaleActive;
  if (nextActive !== weLocaleActive) weLocaleActive = nextActive;
  if (!changed) return;
  weLocaleRevision += 1;
  for (const fn of Array.from(weLocaleListeners)) {
    try { fn(); } catch { /* 单个订阅者异常不许打断其它订阅者（同 emit 口径） */ }
  }
}

/**
 * 同形歧义键的分隔符：原文一样的字符串在不同屏幕可能是两个词义（例：「适配」在
 * 「效果 → 适配」是 Fit，在「高级 → 适配」是 Adapter）。词表键允许写成
 * `<context>\u0000<原文>`（调用侧 `weT("适配", null, "adapter")`），查表用**带上下文的全键**，
 * 中文态仍然只显示原文。NUL 是唯一的合法分隔符 —— UI 文案里不可能出现它，
 * 所以"某个字面量恰好含分隔符"永远不可能把键拆错。守卫按"去掉上下文后必须等于
 * 代码里的原文"对账（见 test/verify-i18n.mjs）。
 */
const WE_I18N_CTX_SEP = "\u0000";

/** 全键 = 上下文 + NUL + 原文（无上下文时就是原文本身）。 */
function weI18nKey(key, context) {
  const text = String(key);
  return context ? String(context) + WE_I18N_CTX_SEP + text : text;
}

/** 全键 → 原文（词表键的 zh 身份值；也是"去掉上下文"的唯一实现）。 */
function weI18nKeySource(full) {
  const at = String(full).indexOf(WE_I18N_CTX_SEP);
  return at < 0 ? String(full) : String(full).slice(at + 1);
}

/** `{name}` 占位符插值（与官方 translate 的实现同形：认 `{word}`，缺参原样保留）。 */
function weI18nInterpolate(template, params) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

/**
 * 取词：`weT("壁纸模糊")` → 当前语言下的文案。
 * @param key - 中文原文（同时是词表键；可能带上下文后缀，见 WE_I18N_CTX_SEP）。
 * @param params - `{name}` 占位符取值（官方 `bind` 与本地实现都按 `{name}` 插值）。
 * @param context - 同形歧义的消歧上下文（可选；只在原文一词多义时才写）。
 */
function weT(key, params, context) {
  const full = weI18nKey(key, context);
  // 服务在场走它自己的链路（含语言包 fallback 与 `{name}` 插值）；缺席走本地等价实现。
  if (weLocaleService !== null && weLangOverride() === null && typeof weLocaleService.bind === "function") {
    try {
      const bound = weLocaleService.bind(WE_I18N_NS);
      if (typeof bound === "function") return bound(full, params);
    } catch { /* 服务异常：落到本地实现，绝不因取词抛错 */ }
  }
  const id = weLocaleId();
  let out;
  if (weLocaleIsZh(id)) {
    out = weI18nKeySource(full);
  } else {
    const en = WE_I18N_EN[full] !== undefined ? WE_I18N_EN[full]
      : WE_I18N_HOST_EN[full] !== undefined ? WE_I18N_HOST_EN[full]
        : WE_I18N_EN[weI18nKeySource(full)] !== undefined ? WE_I18N_EN[weI18nKeySource(full)]
          : WE_I18N_HOST_EN[weI18nKeySource(full)] !== undefined ? WE_I18N_HOST_EN[weI18nKeySource(full)]
            : weI18nKeySource(full);
    out = en;
  }
  return weI18nInterpolate(out, params);
}

/** 中文原文的**身份词表**：`{全键: 原文}` —— 注册进官方注册表用（zh 不做逐条翻译）。 */
function weI18nZhDict() {
  const out = {};
  for (const key of Object.keys(WE_I18N_EN)) out[key] = weI18nKeySource(key);
  for (const key of Object.keys(WE_I18N_HOST_EN)) out[key] = weI18nKeySource(key);
  return out;
}

/** 英文词表（客户端 + 宿主两份合并后的**注册形态**；官方注册表按命名空间只收一份）。 */
function weI18nEnDict() {
  return Object.assign({}, WE_I18N_EN, WE_I18N_HOST_EN);
}

/**
 * 接上官方 locale 服务（可选服务，短轮询 —— 同 pollThemeService 口径）：
 *   · 注册本插件词表（zh 身份表 + en 表）到命名空间 `wallpaper-engine`；
 *   · 订阅 revision，把 `active` 同步成插件的当前语言并广播一次；
 *   · 返回清理函数（fiber 注销时退订 + 注销词表）。
 * 服务永远不出现（低版本宿主 / 沙箱）⇒ 静默返回，界面停在默认语言（中文）。
 * @param ctx - 插件上下文（只用 `ctx.get`）。
 */
function weI18nAttach(ctx) {
  if (!ctx || typeof ctx.get !== "function") return null;
  let disposed = false;
  let poll = 0;
  let offDicts = null;   // 词表注销（register 的返回值）
  let offSub = null;     // 订阅退订
  let attachedTo = null; // 已接入的服务（快照身份比对：服务换代要重接）
  const sync = () => {
    if (disposed || attachedTo === null) return;
    let active = WE_I18N_DEFAULT_LOCALE;
    try {
      const snap = attachedTo.getSnapshot();
      active = (snap && snap.active) || WE_I18N_DEFAULT_LOCALE;
    } catch { /* 快照读不到：停在默认语言 */ }
    weLocalePublish(active, false);
  };
  const attempt = () => {
    if (disposed) return;
    let service;
    try { service = ctx.get("locale"); } catch { service = null; }
    if (!service || typeof service.getSnapshot !== "function" || typeof service.register !== "function") {
      poll = scheduleWeTimeout(attempt, 250);
      return;
    }
    attachedTo = service;
    weLocaleService = service;
    try {
      const offZh = service.register(WE_I18N_NS, "zh", weI18nZhDict());
      const offEn = service.register(WE_I18N_NS, "en", weI18nEnDict());
      offDicts = () => { try { offZh(); } catch { /* ignore */ } try { offEn(); } catch { /* ignore */ } };
    } catch { offDicts = null; /* 注册被拒（命名空间被占）：取词仍走本地实现 */ }
    if (typeof service.subscribe === "function") {
      try { offSub = service.subscribe(sync); } catch { offSub = null; }
    }
    // 首次同步：服务可能已是 en（浏览器语言 / 宿主偏好）⇒ 挂上就立刻切过去。
    sync();
    weLocalePublish(weLocaleActive, true); // 强制一次广播：让已挂载的界面重渲染
  };
  attempt();
  return () => {
    disposed = true;
    if (poll) { try { clearWeTimeout(poll); } catch { /* ignore */ } poll = 0; }
    if (offSub) { try { offSub(); } catch { /* ignore */ } offSub = null; }
    if (offDicts) { try { offDicts(); } catch { /* ignore */ } offDicts = null; }
    if (weLocaleService === attachedTo) weLocaleService = null;
    attachedTo = null;
    // 退回默认语言并广播：卸载后界面（若还挂着别的片段）不该停在"半截英文"。
    weLocalePublish(WE_I18N_DEFAULT_LOCALE, true);
  };
}

/**
 * React 侧的语言订阅钩子：返回 revision（数字）。
 * 用法：在**顶层组件**第一行 `useWeLocale();` —— 语言一变整棵子树重渲染，
 * 文案在渲染期由 `weT(...)` 现取（不要在模块级把结果存进常量）。
 * 两个实现都判在**稳定的条件**上（同一个 React 实例只会走其中一条），
 * 所以不违反 hook 顺序规则：18 用 `useSyncExternalStore`，更老的 React / 测试桩
 * 退回 `useState + useEffect`（本仓的验证沙箱可能只给部分 React 面）。
 */
function useWeLocale() {
  const R = typeof React !== "undefined" ? React : null;
  if (R && typeof R.useSyncExternalStore === "function") {
    return R.useSyncExternalStore(weLocaleSubscribe, weLocaleRevisionValue);
  }
  if (R && typeof R.useState === "function" && typeof R.useEffect === "function") {
    const [, setTick] = R.useState(0);
    R.useEffect(() => weLocaleSubscribe(() => setTick((n) => n + 1)), []);
    return weLocaleRevisionValue();
  }
  return 0;
}

export {
  weLocaleRevisionValue,
  weLocaleSubscribe,
  weOnLocaleChange,
  weT,
  weI18nAttach,
  useWeLocale,
};
