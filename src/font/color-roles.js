/**
 * font/color-roles.js — 用 DSH 的 `theme` 服务给「文字颜色角色」分角色上色（只做颜色）。
 *
 * 为什么需要它：把四个文字角色压成**同一个**用户色会把 DSH 的四级文字层次**压平** ——
 * 本模块改用官方令牌层：每个角色一个色，原生层次保留。
 *
 * 契约（本文件是客户端程序的一部分，构建期由 scripts/build-client.mjs 内联进 bundle 的工厂
 * 作用域；依赖少到可以列全）：
 *   需要的外界：**无** —— 只用传入的 `theme` 服务对象、`document`/`window`（全部 feature-detect），
 *             不读 `selection`、不读设置表（颜色由调用方 `getColors()` 给出）。
 *   对外提供：THEME_COLOR_ROLES（角色表）/ THEME_LAYER_SOURCE（层身份）
 *             pollThemeService(ctx, opts)        后台轮询服务（启动竞态）
 *             scanThemeTokens(doc)               当前 DSH 真的定义了哪些 --dsw-*（白名单来源）
 *             buildTokenPayload(colors, isAvailable)  设置 → overrideTokens 载荷
 *             createThemeLayer(opts)             建层/同步/销毁
 *             themeLayerOwnedRoles()             层当前接管的角色（按 source 记账；当前无消费者）
 *
 * 不变量（都有守卫）：
 *   · **不写 `!important`、不用 DOM 选择器**：令牌层走 body 内联，天然压过宿主样式表。
 *   · 载荷里的值**必须是 `{light, dark}` 对**：服务对裸字符串/缺项**抛 TypeError**（已读源码确认）。
 *   · 未知令牌**必须自己筛掉**：服务的校验只看形状，不看令牌是否存在 —— 写进去不报错、也不生效。
 *   · 同 source 再注册 = **整层替换**；且**旧 disposer 会变成 no-op**（源码注释明说）
 *     ⇒ 只保留最新一个 disposer，且绝不把旧 disposer 当成"移除当前层"用。
 *   · 任何令牌写入**之前**必须先取宿主基线（`onBeforeFirstWrite`），否则退出契约会把我们的颜色
 *     当宿主原值快照下来（表现为设置面板被染色）。
 */

const THEME_LAYER_SOURCE = 'wallpaper-engine';

/**
 * 开放的 5 个角色（对应 6 个令牌）。`label-error` **不开放**（错误色有语义）。
 * （角色用量数字没有可复算的出处 ⇒ 不在此记录；需要时按 token 在 DSH 样式表里重新统计。）
 */
const THEME_COLOR_ROLES = [
  { id: 'primary', get label() { return weT('正文'); }, tokens: ['--dsw-alias-label-primary'] },
  { id: 'secondary', get label() { return weT('次要文字'); }, tokens: ['--dsw-alias-label-secondary'] },
  { id: 'tertiary', get label() { return weT('弱化说明'); }, tokens: ['--dsw-alias-label-tertiary'] },
  { id: 'caption', get label() { return weT('极小说明'); }, tokens: ['--dsw-alias-label-caption'] },
  { id: 'dimmed', get label() { return weT('禁用 / 更弱'); }, tokens: ['--dsw-alias-label-dimmed', '--dsw-alias-label-primary-dimmed'] },
];

const THEME_HEX_RE = /^#[0-9a-f]{6}$/i;
/** 只接受 `#rrggbb`（大小写不敏感）—— 令牌值会原样进 CSS，宽进会把脏值带进去。 */
function isThemeHex(v) {
  return typeof v === 'string' && THEME_HEX_RE.test(v.trim());
}

/**
 * 层当前接管的角色，**按 source 分别记账**：颜色层与排版层（THEME_TYPE_SOURCE）的角色集合
 * 必须分开 —— 若两层共用一份记账，后同步的那层会把前者的列表覆盖掉。
 * ⚠️ `themeLayerOwnedRoles()` 目前**没有消费者**。
 */
const themeLayerRolesBySource = Object.create(null);
function themeLayerOwnedRoles() { return (themeLayerRolesBySource[THEME_LAYER_SOURCE] || []).slice(); }

/**
 * 扫描样式表，收集当前 DSH **真的定义了**的 `--dsw-*` 令牌名。
 * 权威来源是样式表：`getTheme().active.tokens` 为空、`exportInspectTokens()` 只有 14 条
 * （实测），都不能当清单。
 * @returns {Set<string>} 令牌名集合（跨源样式表读不到 cssRules 时跳过，不抛）。
 */
function scanThemeTokens(doc) {
  const found = new Set();
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || !d.styleSheets) return found;
  const visit = (rules) => {
    for (const rule of rules || []) {
      const style = rule && rule.style;
      if (!style) {
        if (rule && rule.cssRules) visit(rule.cssRules);
        continue;
      }
      for (let i = 0; i < style.length; i++) {
        const prop = style.item ? style.item(i) : style[i];
        if (typeof prop === 'string' && prop.startsWith('--dsw-')) found.add(prop);
      }
      if (rule.cssRules) visit(rule.cssRules);
    }
  };
  for (const sheet of d.styleSheets) {
    try { visit(sheet.cssRules); } catch { /* 跨源样式表读不到，跳过 */ }
  }
  return found;
}

/**
 * 把设置里的角色色编译成 `overrideTokens` 的载荷。
 * @param colors 形如 `{ primary: { light:'#fff', dark:'#000' }, ... }`（可缺键/可脏）
 * @param isAvailable 令牌可用性判据（`(token) => boolean`）—— 未知令牌在这里被筛掉
 * @returns {{ payload: object, roles: string[] }} 只含可用令牌；没有任何可用角色时 payload 为 {}
 */
function buildTokenPayload(colors, isAvailable) {
  const payload = {};
  const roles = [];
  const src = colors && typeof colors === 'object' ? colors : {};
  for (const role of THEME_COLOR_ROLES) {
    const v = src[role.id];
    if (!v || typeof v !== 'object') continue;
    const light = isThemeHex(v.light) ? v.light.trim() : null;
    const dark = isThemeHex(v.dark) ? v.dark.trim() : null;
    if (!light || !dark) continue; // 两套必须都有：缺一在另一套配色下会不可读
    const usable = role.tokens.filter((t) => (typeof isAvailable === 'function' ? isAvailable(t) : true));
    if (!usable.length) continue;
    for (const t of usable) payload[t] = { light, dark };
    roles.push(role.id);
  }
  return { payload, roles };
}

/**
 * 后台轮询 `ctx.get('theme')`，**拿到即停**。
 * 启动竞态是实测的：7ms 时 `get` 为 null，325ms 才有。拿不到就什么都不做，
 * `/style` 回落路径照旧可用（红线 7 的双通道）。
 * @returns {() => void} 取消轮询
 */
function pollThemeService(ctx, opts) {
  const o = opts || {};
  const intervalMs = o.intervalMs || 250;
  const timeoutMs = o.timeoutMs === undefined ? 6000 : o.timeoutMs;
  const setT = o.setTimeoutFn || (typeof setTimeout === 'function' ? setTimeout : null);
  const clearT = o.clearTimeoutFn || (typeof clearTimeout === 'function' ? clearTimeout : null);
  if (!setT) { if (o.onGiveUp) o.onGiveUp('no-timer'); return () => {}; }
  let cancelled = false;
  let waited = 0;
  let handle = null;
  const lookup = () => {
    if (typeof ctx.get !== 'function') return null;
    try { return ctx.get('theme') || null; } catch { return null; }
  };
  const tick = () => {
    if (cancelled) return;
    const theme = lookup();
    if (theme) { if (o.onReady) o.onReady(theme); return; }
    waited += intervalMs;
    if (waited >= timeoutMs) { if (o.onGiveUp) o.onGiveUp('timeout'); return; }
    handle = setT(tick, intervalMs);
  };
  tick(); // 先试一次：服务已经就绪时不必等一个间隔
  return () => { cancelled = true; if (handle !== null && clearT) clearT(handle); };
}

/**
 * 建一层角色色覆盖。同 source 再注册 = 整层替换（见文件头不变量），因此这里**只保留最新
 * disposer**，绝不把旧 disposer 当"移除当前层"。
 */
function createThemeLayer(opts) {
  const o = opts || {};
  const theme = o.theme;
  // source 必须由调用方区分：同 source 再注册 = 整层替换（会把另一层的令牌顶掉）。
  const source = o.source || THEME_LAYER_SOURCE;
  const getColors = o.getColors || (() => ({}));
  const isAvailable = o.isAvailable || (() => true);
  // 载荷构建可注入（排版层传自己的）：默认是颜色角色那一套，保持默认调用面不变。
  const build = o.buildPayload || (() => buildTokenPayload(getColors(), isAvailable));
  let dispose = null;
  let owned = [];
  let firstWriteDone = false;
  let applies = 0, disposes = 0, attempts = 0;

  function releaseLayer() {
    if (dispose) {
      try { dispose(); } catch { /* 服务已换/已销毁：忽略 */ }
      dispose = null;
      disposes++;
    }
    owned = [];
    themeLayerRolesBySource[source] = [];
  }

  function sync() {
    attempts++;
    if (!theme || typeof theme.overrideTokens !== 'function') return { ok: false, reason: 'no-theme' };
    const { payload, roles } = build();
    if (!Object.keys(payload).length) {
      // 没有可用角色 ⇒ 撤层（用户清空颜色时回到原生层次）
      releaseLayer();
      return { ok: false, reason: 'empty' };
    }
    // 宿主基线必须在**任何**令牌写入之前取（否则退出契约快照到我们自己的颜色）
    if (!firstWriteDone) {
      firstWriteDone = true;
      try { if (o.onBeforeFirstWrite) o.onBeforeFirstWrite(); } catch { /* 基线失败不阻断上色 */ }
    }
    try {
      // 再注册即替换：旧 disposer 已失效，直接丢弃引用（调用它反而是 no-op 语义陷阱）
      dispose = theme.overrideTokens(source, payload);
      applies++;
    } catch (e) {
      dispose = null;
      releaseLayer();
      return { ok: false, reason: 'throw', error: String((e && e.message) || e).slice(0, 120) };
    }
    owned = roles;
    themeLayerRolesBySource[source] = roles.slice();
    return { ok: true, roles };
  }

  return {
    sync,
    dispose: releaseLayer,
    ownedRoles: () => owned.slice(),
    stats: () => ({ applies, disposes, attempts, roles: owned.length }),
  };
}

export {
  THEME_LAYER_SOURCE, THEME_COLOR_ROLES,
  isThemeHex, themeLayerOwnedRoles, scanThemeTokens, buildTokenPayload,
  pollThemeService, createThemeLayer,
};
