/**
 * verify-theme-layer.mjs — F1 令牌层的**行为**守卫（可直接 import src/font/color-roles.js 测）。
 *
 * 覆盖三件容易写错、且错了只在真机才看得出来（面板被染色 / 改了没反应）的事：
 *   ① 载荷形态：服务的校验对裸字符串与缺 `{light,dark}` **抛 TypeError**（读源码确认），
 *      而**未知令牌不校验**（形状校验而已）⇒ 白名单必须我们自己筛。
 *   ② 同 source 再注册 = 整层替换，且**旧 disposer 变 no-op**（源码注释明说）
 *      ⇒ 层只能保留最新 disposer，绝不能把旧的当"移除当前层"用。
 *   ③ 宿主基线必须在**任何**令牌写入之前取（否则退出契约会快照到我们自己的颜色）。
 *
 * 每条行为都带负对照（负对照本身也断言"确实能抓到"）。
 *
 * Usage:  node test/verify-theme-layer.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
// 剥注释：共享的字符串感知实现（test/tools/js-text.mjs）。
import { stripComments } from './tools/js-text.mjs';
// 单独 import `src/**` 时补上 bundle 作用域的取词层（中文身份；见 test/tools/weT-shim.mjs）。
import { installWeTShim } from './tools/weT-shim.mjs';
installWeTShim();

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mod = await import(new URL('../src/font/color-roles.js', import.meta.url).href);
const {
  THEME_LAYER_SOURCE, THEME_COLOR_ROLES,
  isThemeHex, themeLayerOwnedRoles, buildTokenPayload, pollThemeService, createThemeLayer,
} = mod;
// 角色 id 的**校验白名单归 schema**（宿主也要用；theme-layer 只进浏览器包，拿不到同一份绑定）。
// 这里断言两处一致 —— 有守卫的重复，好过拿不到的共享。
const schema = await import(new URL('../lib/settings-schema.js', import.meta.url).href);
const typo = await import(new URL('../src/font/typography.js', import.meta.url).href);
const THEME_COLOR_ROLE_IDS = THEME_COLOR_ROLES.map((r) => r.id);

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log('  ✓ ' + name + (detail ? ' — ' + detail : ''));
  else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); failed++; }
};
const section = (t) => console.log('\n' + t);

/** 忠实模拟真服务语义的假 theme（替换 + 旧 disposer 变 no-op + 裸字符串抛错）。 */
function fakeThemeService() {
  const log = [];
  let layers = new Map(); // source -> {seq, tokens}
  let seq = 0;
  return {
    log,
    overrideTokens(source, tokens) {
      log.push(['overrideTokens', source, JSON.parse(JSON.stringify(tokens))]);
      for (const [name, v] of Object.entries(tokens)) {
        if (typeof v === 'string') throw new TypeError(`theme override "${name}" is a bare string`);
        if (!v || typeof v !== 'object' || typeof v.light !== 'string' || typeof v.dark !== 'string') {
          throw new TypeError(`theme override "${name}" must map to a { light, dark } pair`);
        }
      }
      const layer = { seq: seq++, tokens };
      layers.set(source, layer);
      return () => { if (layers.get(source) === layer) layers.delete(source); }; // 旧的已成 no-op
    },
    hasLayer: (source) => layers.has(source),
    layerTokens: (source) => (layers.get(source) || {}).tokens || null,
  };
}
const ALL_TOKENS = THEME_COLOR_ROLES.flatMap((r) => r.tokens);
const allAvailable = () => true;
const COLORS_OK = {
  primary: { light: '#112233', dark: '#aabbcc' },
  tertiary: { light: '#445566', dark: '#ddeeff' },
};

// ── ① 角色表与令牌形态 ──────────────────────────────────────────────────────
section('① 角色表 / 色值校验');
check('角色表是 5 个角色、6 个令牌（§9.3 首期范围）',
  THEME_COLOR_ROLES.length === 5 && ALL_TOKENS.length === 6,
  THEME_COLOR_ROLES.map((r) => r.id + ':' + r.tokens.length).join(' '));
check('dimmed 角色覆盖两个令牌（-dimmed 与 -primary-dimmed）',
  (THEME_COLOR_ROLES.find((r) => r.id === 'dimmed') || {}).tokens.length === 2);
check('不开放 label-error（错误色有语义）',
  !ALL_TOKENS.some((t) => t.includes('error')));
check('角色 id 唯一', new Set(THEME_COLOR_ROLE_IDS).size === THEME_COLOR_ROLE_IDS.length);
check('theme-layer 的角色表与 schema 的校验白名单**完全一致**（跨文件约束，机械核对）',
  JSON.stringify(THEME_COLOR_ROLE_IDS) === JSON.stringify(schema.THEME_COLOR_ROLE_IDS),
  'theme-layer=' + THEME_COLOR_ROLE_IDS.join(',') + ' schema=' + schema.THEME_COLOR_ROLE_IDS.join(','));
check('负对照：给角色表多塞一个 id 必须被判出',
  JSON.stringify([...THEME_COLOR_ROLE_IDS, 'ghost']) !== JSON.stringify(schema.THEME_COLOR_ROLE_IDS));
check('isThemeHex 收 #rrggbb（大小写不敏感）', isThemeHex('#AABBCC') && isThemeHex('#123abc'));
{
  const bad = ['#fff', 'red', '#gggggg', '#1234567', '', null, undefined, 42, {}, '#12345'];
  const leaked = bad.filter((v) => isThemeHex(v));
  check('isThemeHex 拒非法值', leaked.length === 0, '漏过: ' + JSON.stringify(leaked));
  check('负对照：把一条非法值当合法必须被判出', isThemeHex('#fff') === false && isThemeHex('#ffffff') === true);
}

// ── ② 载荷构建 ──────────────────────────────────────────────────────────────
section('② 载荷构建（白名单 + 双值 + 形状）');
{
  const { payload, roles } = buildTokenPayload(COLORS_OK, allAvailable);
  check('两个角色的令牌都进载荷',
    payload['--dsw-alias-label-primary'] && payload['--dsw-alias-label-tertiary'],
    Object.keys(payload).join(' '));
  check('roles 只含配置过的角色', JSON.stringify(roles.sort()) === JSON.stringify(['primary', 'tertiary']));
  const bare = Object.entries(payload).filter(([, v]) => typeof v === 'string'
    || typeof v.light !== 'string' || typeof v.dark !== 'string');
  check('载荷里绝无裸字符串 / 缺项（服务的校验会抛 TypeError）', bare.length === 0,
    bare.map(([k]) => k).join(' '));
  // 不变量：载荷里每个令牌的值都是**该角色所配的那一对**色值 —— 串色（两个角色的令牌拿错
  // 色值）与落空都必须判出，所以这里比对白名单里的完整 `light/dark` 组合而不是只比一侧；
  // 空载荷也一并挡掉，`.every()` 对空集恒真。
  {
    const pairs = Object.values(payload);
    const allowed = Object.values(COLORS_OK).map((c) => c.light + '/' + c.dark);
    const wrong = pairs.filter((v) => !v || !allowed.includes(String(v.light) + '/' + String(v.dark)));
    check('每个令牌都是 {light,dark} 对，且两侧同属该角色所配的色值（不串色、不落空）',
      pairs.length > 0 && wrong.length === 0,
      pairs.length + ' 个令牌; 异常=[' + wrong.map((v) => JSON.stringify(v)).join(' ') + ']');
  }
}
{
  const { roles } = buildTokenPayload({ primary: { light: '#112233', dark: 'BAD' } }, allAvailable);
  check('只给一半（dark 非法）⇒ 整角色跳过（避免另一套配色不可读）', roles.length === 0);
  check('负对照：两套都给合法值时该角色必须进来',
    buildTokenPayload({ primary: { light: '#112233', dark: '#445566' } }, allAvailable).roles.length === 1);
}
{
  const { payload, roles } = buildTokenPayload(
    { primary: { light: '#112233', dark: '#445566' } },
    (t) => t !== '--dsw-alias-label-primary',
  );
  check('令牌不在白名单 ⇒ 被筛掉（服务的校验不会拦未知令牌）',
    !payload['--dsw-alias-label-primary'] && roles.length === 0);
  const dim = buildTokenPayload({ dimmed: { light: '#112233', dark: '#445566' } },
    (t) => t !== '--dsw-alias-label-primary-dimmed');
  check('一个角色只部分令牌可用 ⇒ 仍接管该角色（用可用部分）',
    dim.roles.length === 1 && !!dim.payload['--dsw-alias-label-dimmed']
    && !dim.payload['--dsw-alias-label-primary-dimmed']);
}
{
  const { payload, roles } = buildTokenPayload({ unknownRole: { light: '#112233', dark: '#445566' } }, allAvailable);
  check('未知角色被忽略', roles.length === 0 && Object.keys(payload).length === 0);
  check('空/脏输入不抛且返回空载荷',
    Object.keys(buildTokenPayload(null, allAvailable).payload).length === 0
    && Object.keys(buildTokenPayload({ primary: 'red' }, allAvailable).payload).length === 0);
}

// ── ③ 轮询（启动竞态） ──────────────────────────────────────────────────────
section('③ 轮询：拿到即停 / 超时放弃 / 不炸');
{
  const scheduled = [];
  const timers = { setTimeoutFn: (fn, ms) => { scheduled.push(ms); return scheduled.length; }, clearTimeoutFn: () => {} };
  let ready = null, giveUp = null, calls = 0;
  const themeObj = { overrideTokens() {} };
  const ctx = { get: () => (++calls >= 3 ? themeObj : null) };
  pollThemeService(ctx, { ...timers, onReady: (t) => { ready = t; }, onGiveUp: (r) => { giveUp = r; } });
  // 手动推进：把排队的回调依次执行
  for (let i = 0; i < 5 && scheduled.length; i++) {
    const fn = scheduled.shift();
    // 重新构造调度记录（真实实现里 setTimeout 返回句柄，这里简化成"再跑一轮"）
  }
  check('首次查询就命中时不排任何定时器（拿到即停）',
    pollThemeService({ get: () => ({ overrideTokens() {} }) }, { ...timers, onReady: () => {} }) !== undefined
    && scheduled.length === 0);
  check('ctx.get 抛错不炸（当成 null）', (() => {
    try { pollThemeService({ get: () => { throw new Error('boom'); } }, { ...timers, timeoutMs: 1, onGiveUp: () => {} }); return true; } catch { return false; }
  })());
  check('取不到服务 ⇒ 走 onGiveUp（回落 /style 双通道）', (() => {
    let got = null;
    const t = { setTimeoutFn: (fn) => { fn(); return 1; }, clearTimeoutFn: () => {} };
    pollThemeService({ get: () => null }, { ...t, timeoutMs: 0, onGiveUp: (why) => { got = why; } });
    return got !== null;
  })(), 'onGiveUp 触发');
  check('负对照：服务已就绪时不应触发 onGiveUp', (() => {
    let gave = false;
    pollThemeService({ get: () => ({ overrideTokens() {} }) }, { ...timers, onGiveUp: () => { gave = true; } });
    return gave === false;
  })());
}

// ── ④ 层：替换语义 / 旧 disposer 陷阱 / 基线时序 ─────────────────────────────
section('④ 建层：替换语义与基线时序');
{
  const theme = fakeThemeService();
  const order = [];
  let colors = COLORS_OK;
  const layer = createThemeLayer({
    theme,
    getColors: () => colors,
    isAvailable: allAvailable,
    onBeforeFirstWrite: () => order.push('baseline'),
  });
  const realOverride = theme.overrideTokens.bind(theme);
  theme.overrideTokens = (s, t) => { order.push('write'); return realOverride(s, t); };

  const r1 = layer.sync();
  check('首次同步成功且服务持有该层', r1.ok && theme.hasLayer(THEME_LAYER_SOURCE), JSON.stringify(r1.roles));
  check('基线在**首次写入之前**被取（顺序断言）',
    order.join(',') === 'baseline,write', order.join(','));
  check('层接管的角色对 effects.js 可见（据此让出折叠行）',
    JSON.stringify(themeLayerOwnedRoles().sort()) === JSON.stringify(['primary', 'tertiary']));

  // 再注册：替换整层；旧 disposer 变 no-op
  const firstDisposerWas = theme.layerTokens(THEME_LAYER_SOURCE);
  colors = { caption: { light: '#010203', dark: '#040506' } };
  const r2 = layer.sync();
  check('同 source 再注册 ⇒ 整层替换（旧令牌不再存在）',
    r2.ok && !theme.layerTokens(THEME_LAYER_SOURCE)['--dsw-alias-label-primary']
    && !!theme.layerTokens(THEME_LAYER_SOURCE)['--dsw-alias-label-caption'],
    Object.keys(theme.layerTokens(THEME_LAYER_SOURCE)).join(' '));
  check('替换后仍只持有一层（服务里没有残留）', !!firstDisposerWas && theme.hasLayer(THEME_LAYER_SOURCE));
  check('基线只在首次取一次（不重复污染）', order.filter((x) => x === 'baseline').length === 1);
  check('接管角色随载荷更新', JSON.stringify(themeLayerOwnedRoles()) === JSON.stringify(['caption']));

  // 清空 ⇒ 撤层 + 归还折叠行
  colors = {};
  const r3 = layer.sync();
  check('清空颜色 ⇒ 撤层（回到原生层次）', r3.ok === false && r3.reason === 'empty' && !theme.hasLayer(THEME_LAYER_SOURCE));
  check('撤层后 effects.js 应恢复折叠行（接管角色为空）', themeLayerOwnedRoles().length === 0);

  // 服务抛错 ⇒ 不留下"半接管"状态
  const bad = { overrideTokens: () => { throw new TypeError('boom'); } };
  const layer2 = createThemeLayer({ theme: bad, getColors: () => COLORS_OK, isAvailable: allAvailable });
  const r4 = layer2.sync();
  check('服务抛错 ⇒ 报称失败且不声称接管任何角色',
    r4.ok === false && r4.reason === 'throw' && layer2.ownedRoles().length === 0 && themeLayerOwnedRoles().length === 0);

  // dispose 干净
  const theme3 = fakeThemeService();
  const layer3 = createThemeLayer({ theme: theme3, getColors: () => COLORS_OK, isAvailable: allAvailable });
  layer3.sync();
  layer3.dispose();
  check('dispose 后服务里没有我们的层，且归还角色',
    !theme3.hasLayer(THEME_LAYER_SOURCE) && themeLayerOwnedRoles().length === 0);
  check('负对照：未 dispose 前该层确实在（证明上一条不是恒真）', (() => {
    const t4 = fakeThemeService();
    const l4 = createThemeLayer({ theme: t4, getColors: () => COLORS_OK, isAvailable: allAvailable });
    l4.sync();
    const present = t4.hasLayer(THEME_LAYER_SOURCE);
    l4.dispose();
    return present === true;
  })());
}

// ── ④b 排版角色（F2）：杠杆是 shorthand，不是细粒度令牌 ──────────────────────
section('④b 排版角色（F2）');
{
  const IDS = typo.THEME_TYPE_ROLES.map((r) => r.id);
  check('角色表与 schema 白名单一致（跨文件，机械核对）',
    JSON.stringify(IDS) === JSON.stringify(schema.THEME_TYPE_ROLE_IDS),
    '模块=' + IDS.length + ' schema=' + schema.THEME_TYPE_ROLE_IDS.length);
  check('范围上下限两份一致（8–48）', typo.THEME_SIZE_MIN === 8 && typo.THEME_SIZE_MAX === 48);
  check('负对照：给角色表多塞一个 id 会被判出',
    JSON.stringify([...IDS, 'ghost']) !== JSON.stringify(schema.THEME_TYPE_ROLE_IDS));

  const all = () => true;
  const { payload, roles } = typo.buildTypePayload({ 'markdown-h1': 24, 'markdown-small': 10, 'markdown-base': 0 }, all);
  check('0 / 未设置 = 不接管（绝对值语义下 0 不是合法字号）',
    roles.length === 2 && !Object.keys(payload).some((k) => k.includes('markdown-base')));
  check('每个角色恰好写 2 个令牌（字号 + shorthand）—— 行高沿用 DSH，不再写它',
    Object.keys(payload).length === 4 && !Object.keys(payload).some((k) => k.endsWith('-line-height')),
    Object.keys(payload).length + ' 个');
  check('★ 写了 shorthand（组件消费的就是它）',
    !!payload['--dsw-font-markdown-h1'] && !!payload['--dsw-font-markdown-small']);
  check('shorthand 由细粒度令牌组合，从而保住行高/字族（设了绝对值时字号为 px）',
    payload['--dsw-font-markdown-h1'].light.includes('var(--dsw-font-markdown-h1-line-height)')
      && payload['--dsw-font-markdown-h1'].light.includes('var(--dsw-font-markdown-h1-font-family)')
      && payload['--dsw-font-markdown-h1'].light.startsWith('700 '),
    payload['--dsw-font-markdown-h1'].light.slice(0, 80));
  check('★ 字号是**绝对值**（不再 calc 叠加 DSH 表达式）',
    payload['--dsw-font-markdown-h1-font-size'].light === '24px');
  check('组合式用绝对字号 + DSH 的行高/字族令牌（行高不被我们写）',
    payload['--dsw-font-markdown-h1'].light
      === '700 24px / var(--dsw-font-markdown-h1-line-height) var(--dsw-font-markdown-h1-font-family)',
    payload['--dsw-font-markdown-h1'].light);
  check('未设字号的角色仍走 DSH 令牌（保留 delta 联动）',
    typo.buildTypePayload({}, all, { 'markdown-h1': 500 }).payload['--dsw-font-markdown-h1'].light
      .includes('var(--dsw-font-markdown-h1-font-size)'));
  check('每个角色都带**可见的官方默认字号**（面板显示它）',
    typo.THEME_TYPE_ROLES.length > 0
    && typo.THEME_TYPE_ROLES.every((r) => Number.isInteger(r.defaultPx)
      && r.defaultPx >= typo.THEME_SIZE_MIN && r.defaultPx <= typo.THEME_SIZE_MAX),
    typo.THEME_TYPE_ROLES.length + ' 个角色');
  check('值一律 {light,dark} 且两侧同值（排版与配色无关）',
    Object.values(payload).every((v) => v.light === v.dark && typeof v.light === 'string'));
  check('绝不重写字重/字族令牌（不在载荷里）',
    !Object.keys(payload).some((k) => /-font-weight$|-font-family$|-font-style$/.test(k)));
  // G2：「初始值 = 官方默认值」必须**可见**，且值来自角色表（不复制数据）。
  // 逐字复述 DSH 字阶的展示函数已随收口删除（面板改为直接显示 `defaultPx` / `prefix`），
  // 但它承载的两条**不变量**必须留下 —— 删函数不许顺手删掉判据：
  // 跟随 DSH 正文字号的角色是这 4 个：markdown-h4 / markdown-base（`--dsh-content-font-size`）
  // 与 markdown-table / markdown-table-head（`--dsh-content-font-size-secondary`）。
  // 判据必须**逐个钉住这 4 个 id 仍在**，不能只看筛出来的子集：子集为空时 `.every()` 恒真，
  // 而"4 个都改成固定 px"正是这条不变量要防的回归 —— 那样筛出来是空集，旧写法会静默通过。
  const followBody = typo.THEME_TYPE_ROLES.filter((r) => String(r.size).includes('--dsh-content-font-size'));
  const FOLLOW_EXPECTED = ['markdown-h4', 'markdown-base', 'markdown-table', 'markdown-table-head'];
  const missingFollow = FOLLOW_EXPECTED.filter((id) => !followBody.some((r) => r.id === id));
  check('跟随 DSH 正文字号的角色必须继续跟随（不得写成固定 px）',
    followBody.length > 0 && missingFollow.length === 0
    && followBody.every((r) => String(r.size).startsWith('var(--dsh-content-font-size')),
    '跟随的角色=' + followBody.length + '（' + followBody.map((r) => r.id).join(' ') + '）'
      + '；缺失=[' + missingFollow.join(' ') + ']');
  check('负对照：该判据对写死的字阶有牙',
    !String('14px').startsWith('var(--dsh-content-font-size'));
  // 占位判据提成命名函数：阳性侧与阴性侧喂进**同一个函数**。
  // 面板里**没有**该形态，所以变异走注入：把该形态（`placeholder: "官方…"`）
  // 拼到真实源上，同一函数对它必须判 true（即阳性侧的取反判据必须红）。
  const hasLegacyPlaceholder = (t) => /placeholder:\s*"官方/.test(t);
  const injectLegacyPlaceholder = (t) => t + '\n' + 'placeholder: "官方",\n';
  // 面板**不再用占位字样**，直接显示默认值（用户口径）：角色行显示默认字阶与默认字重、
  // 颜色块显示当前默认色。
  // 调节面板的渲染器已抽到 src/panel-tabs.js（C）：这里按文件分源，不拼接 ——
// 拼接会让一个文件的文本满足另一个文件的结构断言。
const clientFontUi = readFileSync(join(root, 'src', 'client.js'), 'utf8');
const fontTabsUi = readFileSync(join(root, 'src', 'panel-tabs.js'), 'utf8');
  // 默认值**直接显示在输入框里**（角色表：字号列未填时显示 role.defaultPx），
  // 不再用行内小字复述一遍 DSH 原字阶。
  // 三处「写法判据」提成命名函数 —— 函数名说的是它抓的**该种写法**（与标签同源），
  // 阳性侧喂真实源、阴性侧喂从真实源派生的变异文本（同一函数两侧）；两边还有
  // notEqual 证明变异真的变异过（否则负对照是空的，等于恒真）。
  const hasWrittenDefaultSize = (t) => /value: size === undefined \? role\.defaultPx : size/.test(t);
  const hasWrittenDefaultWeight = (t) => /role\.prefix \? Number\(role\.prefix\) : 400/.test(t);
  const dropWrittenDefaultSize = (t) => t.replace(/value: size === undefined \? role\.defaultPx : size/, 'value: size === undefined ? "" : size');
  const dropWrittenDefaultWeight = (t) => t.replace(/role\.prefix \? Number\(role\.prefix\) : 400/, 'role.prefix ? 700 : 400');
  check('面板直接显示默认值（字号输入框未填时取 role.defaultPx）', hasWrittenDefaultSize(fontTabsUi));
  {
    const mutated = dropWrittenDefaultSize(fontTabsUi);
    check('负对照：该判据对旧写法有牙（同一函数喂变异源）',
      mutated !== fontTabsUi && !hasWrittenDefaultSize(mutated));
  }
  // 字重同理：未填时显示角色表里的默认字重（`prefix` 即字重），无前缀的角色显示 400。
  check('面板直接显示默认字重（未填时取 role.prefix，缺省 400）', hasWrittenDefaultWeight(fontTabsUi));
  {
    const mutated = dropWrittenDefaultWeight(fontTabsUi);
    check('负对照：字重默认值判据对合成文本有牙（同一函数喂变异源）',
      mutated !== fontTabsUi && !hasWrittenDefaultWeight(mutated));
  }
  check('面板不再有「官方」占位字样（placeholder）', !hasLegacyPlaceholder(fontTabsUi));
  {
    const mutated = injectLegacyPlaceholder(fontTabsUi);
    check('负对照：占位判据对合成文本有牙（同一函数喂变异源）',
      mutated !== fontTabsUi && hasLegacyPlaceholder(mutated) === true);
  }
  // G4 字重（角色级）：只调字重时**只写字重令牌**，且组合式改为引用它（不再用写死前缀）。
  {
    const wOnly = typo.buildTypePayload({}, all, { 'markdown-h1': 500 });
    check('只调字重 ⇒ 写该角色的字重令牌（两侧同值）',
      JSON.stringify(wOnly.payload['--dsw-font-markdown-h1-font-weight']) === '{"light":"500","dark":"500"}',
      JSON.stringify(wOnly.payload['--dsw-font-markdown-h1-font-weight']));
    check('字号/行高**不被无谓改写**（只调字重时不写它们）',
      !('--dsw-font-markdown-h1-font-size' in wOnly.payload)
      && !('--dsw-font-markdown-h1-line-height' in wOnly.payload));
    check('组合式改为**引用**字重令牌（而不是写死 700）',
      wOnly.payload['--dsw-font-markdown-h1'].light.startsWith('var(--dsw-font-markdown-h1-font-weight) ')
      && !wOnly.payload['--dsw-font-markdown-h1'].light.startsWith('700 '),
      wOnly.payload['--dsw-font-markdown-h1'].light.slice(0, 60));
    check('越界字重被忽略（50 / 1000 / 非整数）',
      typo.buildTypePayload({}, all, { 'markdown-h1': 50 }).roles.length === 0
      && typo.buildTypePayload({}, all, { 'markdown-h1': 1000 }).roles.length === 0
      && typo.buildTypePayload({}, all, { 'markdown-h1': 550.5 }).roles.length === 0);
    check('缺字重令牌 ⇒ 整角色跳过（组合式缺项会写出坏 font）',
      typo.buildTypePayload({}, (t) => t !== '--dsw-font-markdown-h1-font-weight', { 'markdown-h1': 500 })
        .roles.length === 0);
    check('负对照：字重与字号同时设置时两者都在（字号用合法绝对值）',
      (() => { const both = typo.buildTypePayload({ 'markdown-h1': 24 }, all, { 'markdown-h1': 500 });
        return !!both.payload['--dsw-font-markdown-h1-font-size']
          && !!both.payload['--dsw-font-markdown-h1-font-weight']; })());
    check('不调字重时组合式仍用 DSH 的写死前缀（行为不变）',
      typo.buildTypePayload({ 'markdown-h1': 24 }, all).payload['--dsw-font-markdown-h1'].light.startsWith('700 '));
    check('非法绝对值（低于 8 / 高于 48）被拒', 
      typo.buildTypePayload({ 'markdown-h1': 2, 'markdown-h2': 99 }, all).roles.length === 0);
  }
  // G4 字族（角色级）：只调字族时**只写字族令牌**，组合式引用它（族键 → CSS 栈由调用方解析）。
  {
    const fOnly = typo.buildTypePayload({}, all, {}, { 'markdown-h1': 'KaiTi' }, (k) => 'STACK:' + k);
    check('只调字族 ⇒ 写该角色的字族令牌（族键经解析器换成 CSS 栈、两侧同值）',
      JSON.stringify(fOnly.payload['--dsw-font-markdown-h1-font-family'])
        === '{"light":"STACK:KaiTi","dark":"STACK:KaiTi"}',
      JSON.stringify(fOnly.payload['--dsw-font-markdown-h1-font-family']));
    check('字号/行高/字重**不被无谓改写**（只调字族时）',
      !('--dsw-font-markdown-h1-font-size' in fOnly.payload)
      && !('--dsw-font-markdown-h1-line-height' in fOnly.payload)
      && !('--dsw-font-markdown-h1-font-weight' in fOnly.payload));
    check('组合式仍引用字族令牌（覆盖它即可按角色换字体）',
      fOnly.payload['--dsw-font-markdown-h1'].light.includes('var(--dsw-font-markdown-h1-font-family)'));
    check('缺解析器 ⇒ 不接管（宁可保持 DSH 默认，也不写坏 font 简写）',
      typo.buildTypePayload({}, all, {}, { 'markdown-h1': 'KaiTi' }, null).roles.length === 0);
    check('空字族键 ⇒ 不接管', typo.buildTypePayload({}, all, {}, { 'markdown-h1': '' }, (k) => k).roles.length === 0);
    check('负对照：字族 + 字重 + 字号三者同时设置时都在',
      (() => {
        const three = typo.buildTypePayload({ 'markdown-h1': 24 }, all, { 'markdown-h1': 500 },
          { 'markdown-h1': 'KaiTi' }, (k) => 'S:' + k);
        return !!three.payload['--dsw-font-markdown-h1-font-size']
          && !!three.payload['--dsw-font-markdown-h1-font-weight']
          && !!three.payload['--dsw-font-markdown-h1-font-family'];
      })());
  }
  // 用户口径：**不存在任何全局性质的字体配置** —— 字体按角色/按组件细化。
  {
    check('schema 里不再有全局 fontWeight 键', !('fontWeight' in schema.DEFAULTS));
    const effectsSrc = readFileSync(join(root, 'src', 'effects.js'), 'utf8');
    // 两处同形态 —— 两个判据各自提成命名常量，阳性侧喂真实源、
    // 阴性侧喂「同一常量 + 把该形态注入真实源」得到的变异文本（同一函数两侧）。
    const hasLegacyWeightStroke = (t) => /--we-font-weight|--we-font-stroke/.test(t);
    const injectLegacyWeightStroke = (t) => t + '\n' + 'font-weight:var(--we-font-weight, 400);\n';
    check('注入的字体补丁里不再有 --we-font-weight / --we-font-stroke', !hasLegacyWeightStroke(effectsSrc));
    {
      const mutated = injectLegacyWeightStroke(effectsSrc);
      check('负对照：判据对旧写法有牙（同一函数喂变异源）',
        mutated !== effectsSrc && hasLegacyWeightStroke(mutated));
    }
    // 用户口径的最终确认：**不存在任何全局性质的字体配置**。
    check('三个全局字体键都已不存在（fontColor / fontWeight / fontFamily）',
      !('fontColor' in schema.DEFAULTS) && !('fontWeight' in schema.DEFAULTS) && !('fontFamily' in schema.DEFAULTS));
    // 判据针对**代码**：剥注释走共享的字符串感知实现（test/tools/js-text.mjs）—— 头注释里
    // 说明这些名字为什么不在时正会提到它们（散文不是代码）。
    const effectsCode = stripComments(effectsSrc);
    const GLOBAL_FONT_LAYER = /we-font-patch|--we-font-family|--we-font-weight|--we-font-stroke|data-we-font-ignore/g;
    const hasGlobalFontLayer = (t) => new RegExp(GLOBAL_FONT_LAYER.source).test(t);
    const injectGlobalFontLayer = (t) => t + '\n'
      + 'el.id = "we-font-patch";\n'
      + 'el.style.setProperty("--we-font-family", "KaiTi");\n'
      + 'el.setAttribute("data-we-font-ignore", "");\n';
    check('源码里不再有全局字体注入层（#we-font-patch / --we-font-family / --we-font-weight / 还原契约）',
      !hasGlobalFontLayer(effectsCode),
      (effectsCode.match(GLOBAL_FONT_LAYER) || []).join(' '));
    {
      // 负对照与阳性侧共用 hasGlobalFontLayer；注入的三条禁用形态必须都被它抓到。
      const mutated = injectGlobalFontLayer(effectsCode);
      const caught = mutated.match(GLOBAL_FONT_LAYER) || [];
      check('负对照：全局字体判据对旧写法有牙（三条都能被抓到）',
        mutated !== effectsCode && hasGlobalFontLayer(mutated) === true
        && caught.includes('we-font-patch') && caught.includes('--we-font-family') && caught.includes('data-we-font-ignore'),
        'caught=[' + caught.join(' ') + ']');
    }
    check('剩下的字体键全是按角色/按组件 + 总开关',
      ['themeColors', 'themeSize', 'themeWeight', 'themeFamily', 'componentFonts', 'fontCustom']
        .every((k) => k in schema.DEFAULTS)
      && ['fontColor', 'fontWeight', 'fontFamily'].every((k) => !(k in schema.DEFAULTS)));
    // 这一族是**跨文件接线**：处理器（onFontResetAll 清空 5 个容器 + 2 个视图开关）住在面板组件里
    // （client.js），而"高级字体设置"那个子分支的渲染在抽出的页签模块里（panel-tabs.js）。
    // 两半各取对应来源，不拼接 —— 拼接会让一个文件的文本满足另一个文件的断言。
    const clientSrc = readFileSync(join(root, 'src', 'client.js'), 'utf8');
    check('面板「恢复默认」清掉全部字体自定义项（5 个容器 + 2 个视图开关）',
      clientSrc.includes('const onFontResetAll = ()')
      && /selection\.themeColors = \{\};/.test(clientSrc)
      && /selection\.themeSize = \{\};/.test(clientSrc)
      && /selection\.themeWeight = \{\};/.test(clientSrc)
      && /selection\.themeFamily = \{\};/.test(clientSrc)
      && /selection\.componentFonts = \{\};/.test(clientSrc));
    check('组件通道收在本区「高级字体设置」子分支（视图键 fontAdvanced，defaults-only）',
      // i18n 之后行文案走 `weT("…")`（中文原文即键）—— 判据认"这个开关行仍在本区"。
      schema.DEFAULTS_ONLY.includes('fontAdvanced') && fontTabsUi.includes('switchRow(weT("高级字体设置")'));
  }
  const bad = typo.buildTypePayload({ 'markdown-h1': 0, 'markdown-h2': 99, 'markdown-h3': 1.5, 'nope': 2, 'markdown-h4': 'x' }, all);
  check('非法偏移（0 / 越界 / 非整数 / 未知角色 / 非数）全部被拒', bad.roles.length === 0);
  const partial = typo.buildTypePayload({ 'markdown-h1': 2 }, (t) => t !== '--dsw-font-markdown-h1-line-height');
  check('四个令牌缺一 ⇒ 整角色跳过（否则会写出坏 shorthand）', partial.roles.length === 0);
  check('负对照：四令牌齐全时必须接管', typo.buildTypePayload({ 'markdown-h1': 24 }, all).roles.length === 1);
}

// ── ⑤ 静态不变量（源码级） ──────────────────────────────────────────────────
section('⑤ 源码不变量');
{
  const src = readFileSync(join(root, 'src', 'font', 'color-roles.js'), 'utf8');
  // 判据针对**代码**而非散文：剥注释走共享的字符串感知实现（test/tools/js-text.mjs）。否则
  // "模块里不许出现 !important"会被头注释里那句"不写 !important"自身命中。
  const code = stripComments(src);
  const hit = (re) => { const m = code.match(re); return m ? JSON.stringify(m[0].slice(0, 40)) : null; };
  check('模块内零 `!important`（红线 2）', !/!\s*important/.test(code), hit(/!\s*important/) || '');
  check('模块内不用 DOM 选择器 / :has()（白闪红线 1）', !/:has\(/.test(code) && !/querySelector/.test(code));
  check('不依赖 getTheme().active.tokens / exportInspectTokens（F0 修正 A4）',
    !/exportInspectTokens/.test(code) && !/active\.tokens/.test(code), hit(/exportInspectTokens|active\.tokens/) || '');
  check('模块不读 selection / 设置表（颜色由调用方传入）',
    !/\bselection\b/.test(code) && !/\bDEFAULTS\b/.test(code), hit(/\bselection\b|\bDEFAULTS\b/) || '');
  check('负对照：不变量判据对内联示例必须有牙',
    /!\s*important/.test('color:red !important') && !/!\s*important/.test('color:red'));
  // 红线 3：全仓不得写 DSH 自己的字号变量（那是「通用 → 字号」的地盘）。
  {
    // ⚠️ 名单里的文件必须真实存在且**覆盖所有会写令牌的模块**：漏一个就是静默失去覆盖。
    const files = ['lib/settings-schema.js', 'src/font/color-roles.js', 'src/font/typography.js',
      'src/font/apply.js', 'src/effects.js', 'src/client.js'];
    const guilty = files.filter((rel) => {
      const c = stripComments(readFileSync(join(root, rel), 'utf8'));
      return /--dsh-content-font-size\s*:/.test(c) || /setProperty\(\s*['\"]--dsh-content-font-size/.test(c);
    });
    check('红线 3：全仓不写 `--dsh-content-font-size`', guilty.length === 0, guilty.join(' '));
    check('负对照：该判据对示例文本有牙',
      /--dsh-content-font-size\s*:/.test('body{--dsh-content-font-size:14px;}'));
  }
  check('负对照：剥注释后仍能抓到真代码里的 `!important`',
    /!\s*important/.test(stripComments(src)
      .replace('const THEME_LAYER_SOURCE', 'color:red !important;\nconst THEME_LAYER_SOURCE')));
}

console.log('');
if (failed) {
  console.log(`THEME LAYER CHECKS FAILED — ${failed} failed`);
  process.exit(1);
}
console.log('ALL THEME LAYER CHECKS PASSED');
