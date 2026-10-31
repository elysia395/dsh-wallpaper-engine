#!/usr/bin/env node
/**
 * verify-token-domain.mjs — 「**token 域单主权**」的结构守卫（P-D S5c 刀2 / R1）。
 *
 * ── 它守的是什么 ────────────────────────────────────────────────────────────
 * 壁纸媒体通路的令牌域是 `mediaMap`：`token → 磁盘绝对路径`。**铸造面**（写）是
 * `lib/kernel/host-session.js` 的 `tokenFor()`（`lib/inventory.js` 的清单构建器与
 * `/upload` 一族经它签发 token）；**消费面**（读）是六个族里的 `mediaMap.get(token)`。两边
 * **必须是同一张 Map 实例**，否则 `/inventory` 签发的 token 在 `/media`、`/scene-frame` 上
 * 全部 404 —— 静默、无日志、用户只看到"壁纸黑屏"。
 *
 * S5c 刀2 把这 9 族路由搬进 `packages/media-bridge/`。危险点是：包内**也能**建自己的
 * `createComponentSession()`，而它会 `new Map()` 一张**自己的** mediaMap（
 * `lib/kernel/component-session.js`）⇒ 包内自建会话的 `serveFile` 查不到主包签发的 token。
 * 所以单主权不是靠"记得别写错"，而是靠三条结构事实：
 *   ① 整簇同侧：所有需要 apply 面实例的族**整簇**住在同一个包里（搬一半 = 中间态坏态）；
 *   ② 单一来源：这些族只能经 `...keys`（键表 `apply:` 源型）取实例，**不许**覆盖
 *      `mediaMap`/`tokenFor`/`serveFile`/`serveLayout`/`handleSceneFiles`；
 *   ③ 单一实例：键表解析出来的 `mediaMap`/`tokenFor`/... 与服务面 `apply` 上的对象是**同一引用**
 *      （不是副本），且门面 `applyView` 的 15 个键全部来自**同一次** `createHostSession()` 会话。
 *
 * ── 判据形态（为什么这么判）─────────────────────────────────────────────────
 * 全部**静态**（设计稿 §5 S5c 行：R1 纯静态可实现）+ 一条**引用身份**行为臂（`subpackageKeys()`
 * 返回的是服务面上的同一份实例，不是拷贝 —— 这条只有真跑才能判）。没有注册表名单可以漂：
 * 簇成员从每个族模块的 `export const DEPS` 现算（`APPLY_TOKEN_KEYS` ∩ DEPS），族文件面从
 * `test/tools/host-route-index.mjs` 的 `routeModuleFiles()` 现枚举。
 *
 * ── 先红后绿的历史（判据有牙的来历）────────────────────────────────────────
 * 落地时先把 `/inventory` 一族**故意留主包**跑本文件：簇跨侧（`main` + `wallpaper`）+ 铸造/消费
 * 两面跨侧 ⇒ 红。绿态 = 整簇在 `packages/media-bridge/lib/routes/`、21 条路由、门面只余 5 族。
 *
 * ── 负对照（每条判据都配一个"能失败"的探针）──────────────────────────────
 *  a. 簇成员表里把 inventory 改回 `lib/routes/inventory.js` ⇒ `clusterViolations` 点名跨侧；
 *  b. 包入口文本给 media-bytes 加一个 `serveFile: csServeFile` 覆盖 ⇒ `callSiteViolations` 判红；
 *  c. 门面 applyView 文本把 `mediaMap` 换成 `mediaMapCopy` ⇒ `applyViewViolations` 判红；
 *  d. 键面换成"拷贝一份 mediaMap"的合成 apply 面 ⇒ `identityViolations` 判红（判据不恒真）。
 *
 * 红了怎么办：不要放宽任何一条 —— 这 9 族必须整簇搬、只能经 `apply:` 面取实例、门面只能把
 * **本次 apply 会话**的实例交出去。改法见设计稿 §4.2 与 `lib/index.js` 的 R1 注释。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildIndex, routeModuleFiles } from './tools/host-route-index.mjs';
import { stripComments } from './tools/js-text.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log('  ✓ ' + name + (detail ? ' — ' + detail : ''));
  else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); failed++; }
};
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const code = (rel) => stripComments(read(rel));

/** 服务面 `apply` 的 15 个键（= 每个族要从"本次 apply 会话"拿的实例/引用面）。 */
const APPLY_TOKEN_KEYS = [
  'mediaMap', 'tokenFor', 'serveFile', 'serveLayout', 'faststartVariant',
  'pinnedFaststartVariant', 'trackStream', 'handleSceneFiles', 'mediaOriginInfo',
  'payloadProgress', 'transcodeCached', 'SCENE_VIDEO_INFLIGHT', 'buildInventory',
  'componentsProbe', 'mediaOriginApi',
];
/** 铸造面（写 token / 造清单）：这两个依赖名是 mint 的静态指纹。 */
const MINT_KEYS = ['tokenFor', 'buildInventory'];
/** 消费面（读 token）：六族的直接读点是 `mediaMap`。 */
const MEDIA_CONSUME_KEYS = ['mediaMap'];
/**
 * 判「这一族要从 apply 会话取实例」的指纹键 = `APPLY_TOKEN_KEYS` 里**只在 apply 面存在**的那批。
 * 排除三类「主包自己也在合法消费」的键，否则会把留主包的正常族误算进 token 簇：
 *   · `serveFile` —— 组件会话也交一个同名 `serveFile`（`lib/kernel/component-session.js`
 *     自建 mediaMap 的那份），about-notice/mascot-avatar/diag/settings/now-playing/we-assets 都合法用；
 *     它是「who 用了谁那份」的危险点，由 ④ 的调用点覆盖判据盯，不能用来划簇；
 *   · `mediaOriginApi` / `componentsProbe` —— 主包 `settings`（媒体源诊断设置）与 `diag`
 *     （`componentsProbe` 面板）在门面 apply 作用域里直接消费，属门面自己那一份。
 */
const CLUSTER_MARKER_KEYS = APPLY_TOKEN_KEYS.filter((k) => !['serveFile', 'mediaOriginApi', 'componentsProbe'].includes(k));
/** S5c 刀2 搬进包里的 9 族（21 条路由）—— 路径是判据的一部分：搬错包/搬一半都要红。 */
const TOKEN_FAMILY_FILES = [
  'inventory', 'upload', 'props', 'media-bytes', 'media-derived',
  'scene-frame', 'scene-serve', 'scene-media', 'live-frame', 'slides',
].map((n) => 'packages/media-bridge/lib/routes/' + n + '.js');
/** 不许在包入口调用点被**覆盖**的键（覆盖 = 用组件会话那份 ⇒ 第二张 mediaMap）。 */
const NO_OVERRIDE_KEYS = ['mediaMap', 'tokenFor', 'serveFile', 'serveLayout', 'handleSceneFiles'];

const sideOf = (rel) => (rel.startsWith('packages/') ? rel.split('/')[1] : 'main');

/** 族模块的 `export const DEPS = [...]` 逐键（注释已剥；纯静态）。 */
function depsOf(rel) {
  const m = /export\s+const\s+DEPS\s*=\s*\[([\s\S]*?)\]/.exec(code(rel));
  if (!m) return null;
  return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
}

/**
 * ① 整簇同侧 + 铸造/消费同侧。纯函数：主判据与负对照共用这一份口径。
 * @param {{rel:string, deps:string[]}[]} mods 路由族模块面（rel + DEPS）
 */
function clusterViolations(mods) {
  const out = [];
  const tokenMods = mods.filter((m) => m.deps.some((k) => CLUSTER_MARKER_KEYS.includes(k)));
  if (tokenMods.length < 8) out.push('token 簇成员只有 ' + tokenMods.length + ' 个（面地板 8：铸造 2 + 消费 6）');
  const sides = [...new Set(tokenMods.map((m) => sideOf(m.rel)))].sort();
  if (sides.length !== 1) {
    out.push('token 簇跨侧：' + sides.join(' / ') + '；分开的族：'
      + tokenMods.filter((m) => sideOf(m.rel) !== sides[0]).map((m) => m.rel + '(' + sideOf(m.rel) + ')').join('、'));
  } else if (sides[0] === 'main') {
    out.push('token 簇整簇留在主包（应整簇出户进 packages/<pkg>）');
  }
  const mintSides = [...new Set(tokenMods.filter((m) => m.deps.some((k) => MINT_KEYS.includes(k))).map((m) => sideOf(m.rel)))];
  const consumeSides = [...new Set(tokenMods.filter((m) => m.deps.some((k) => MEDIA_CONSUME_KEYS.includes(k))).map((m) => sideOf(m.rel)))];
  if (mintSides.length !== 1) out.push('铸造面不唯一：' + mintSides.join(' / '));
  if (consumeSides.length !== 1) out.push('消费面不唯一：' + consumeSides.join(' / '));
  if (mintSides.length === 1 && consumeSides.length === 1 && mintSides[0] !== consumeSides[0]) {
    out.push('铸造面（' + mintSides[0] + '）与消费面（' + consumeSides[0] + '）**跨侧** ⇒ 主包签发的 token 在另一侧查不到');
  }
  return out;
}

/** ② 包入口调用点：必须展开 `...keys`，且不许覆盖 token 实例键。 */
function callSiteViolations(entrySrc, fns, forbidden = NO_OVERRIDE_KEYS) {
  const out = [];
  for (const fn of fns) {
    const re = new RegExp('\\b' + fn + '\\s*\\(\\s*webServer\\s*,\\s*\\{', 'g');
    const m = re.exec(entrySrc);
    if (!m) { out.push(fn + '：包入口没有 `' + fn + '(webServer, {` 调用点'); continue; }
    // 花括号配对（跳过字符串字面量）拿实参对象全文。
    const open = m.index + m[0].length - 1;
    let depth = 0, i = open, block = null;
    while (i < entrySrc.length) {
      const ch = entrySrc[i];
      if (ch === '"' || ch === "'" || ch === '`') {
        const q = ch; i++;
        while (i < entrySrc.length && entrySrc[i] !== q) { if (entrySrc[i] === '\\') i++; i++; }
        i++; continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { block = entrySrc.slice(open, i + 1); break; } }
      i++;
    }
    if (!block) { out.push(fn + '：调用点实参对象没闭合（解析失败）'); continue; }
    if (!/\.\.\.\s*keys\b/.test(block)) out.push(fn + '：调用点没有展开 `...keys`（实例不来自 apply 面）');
    for (const k of forbidden) {
      if (new RegExp('(?:^|[,{])\\s*' + k + '\\s*:').test(block)) out.push(fn + '：调用点覆盖了 `' + k + '`（应用 apply 面那份，不许用组件会话的）');
    }
  }
  return out;
}

/** 对象字面量体（不含外层花括号）的**顶层属性名**集合：`key` / `key: value` 都认，跳过 `...spread`。 */
function objectLiteralKeySet(body) {
  // ① 顶层逗号切条目（跳过字符串与括号嵌套）；② 每条按顶层第一个 `:` 切 key。
  const entries = [];
  let depth = 0, cur = '', i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch; cur += ch; i++;
      while (i < body.length && body[i] !== q) {
        cur += body[i];
        if (body[i] === '\\') { i++; cur += body[i]; }
        i++;
      }
      if (i < body.length) { cur += body[i]; i++; }
      continue;
    }
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { entries.push(cur); cur = ''; i++; continue; }
    cur += ch; i++;
  }
  if (cur.trim()) entries.push(cur);
  const keys = new Set();
  for (const raw of entries) {
    const entry = raw.trim();
    if (!entry || entry.startsWith('...')) continue;
    let d2 = 0, split = -1;
    for (let j = 0; j < entry.length; j++) {
      const c = entry[j];
      if (c === '(' || c === '{' || c === '[') d2++;
      else if (c === ')' || c === '}' || c === ']') d2--;
      else if (c === ':' && d2 === 0) { split = j; break; }
    }
    const key = (split < 0 ? entry : entry.slice(0, split)).trim();
    if (/^[A-Za-z_$][\w$]*$/.test(key)) keys.add(key);
  }
  return keys;
}

/** ③ 门面 applyView：键集必须**恰好**是 15 个 apply 键，且都由同一次会话/纯符号供给。 */
function applyViewViolations(hostSrc) {
  const out = [];
  const m = /applyView\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)\s*;/.exec(hostSrc);
  if (!m) return ['门面找不到 `applyView = Object.freeze({ … });`'];
  const body = m[1];
  const set = objectLiteralKeySet(body);
  for (const k of APPLY_TOKEN_KEYS) if (!set.has(k)) out.push('applyView 缺键 `' + k + '`');
  for (const k of set) if (!APPLY_TOKEN_KEYS.includes(k)) out.push('applyView 多出未登记键 `' + k + '`（键集漂移）');
  if (/createComponentSession/.test(body)) out.push('applyView 里出现 `createComponentSession`（组件会话自建 mediaMap ⇒ 第二张 token 域）');
  const dm = /const\s*\{([\s\S]*?)\}\s*=\s*createHostSession\(/.exec(hostSrc);
  if (!dm) out.push('门面找不到 `const { … } = createHostSession(...)` 解构');
  else {
    const bound = new Set(dm[1].split(',').map((s) => s.trim().split(':')[0].trim()));
    for (const k of ['mediaMap', 'tokenFor', 'serveFile', 'serveLayout', 'faststartVariant',
      'pinnedFaststartVariant', 'trackStream', 'handleSceneFiles', 'buildInventory', 'mediaOriginApi', 'SCENE_VIDEO_INFLIGHT']) {
      if (!bound.has(k)) out.push('`' + k + '` 不来自 `createHostSession()` 的本次会话解构（applyView 必须用同一份实例）');
    }
  }
  return out;
}

/** ④ 引用身份：键表交出的实例必须与服务面 `apply` 上的对象**同一引用**（不是拷贝）。 */
function identityViolations(keysView, face, names = APPLY_TOKEN_KEYS) {
  const out = [];
  for (const k of names) {
    if (!(k in keysView)) { out.push('键面缺 `' + k + '`'); continue; }
    if (keysView[k] !== face[k]) out.push('`' + k + '` 不是同一引用（拿到的是副本/另一份实例）');
  }
  return out;
}

// ── 主判据面 ────────────────────────────────────────────────────────────────
const routeFiles = routeModuleFiles();
const mods = [];
for (const rel of routeFiles) {
  const deps = depsOf(rel);
  if (!deps) continue;
  mods.push({ rel, deps });
}
const pkgEntryRel = 'packages/media-bridge/lib/index.js';
const hostSrc = code('lib/index.js');
const pkgEntrySrc = code(pkgEntryRel);

// ① 族文件路径（9 族整簇在包内、一个不多一个不少）
const missing = [];
for (const rel of TOKEN_FAMILY_FILES) {
  if (!mods.some((m) => m.rel === rel)) missing.push(rel);
}
check('S5c 刀2 的 9 族路由模块都在 `packages/media-bridge/lib/routes/` 且被认作路由族', missing.length === 0,
  missing.length ? '缺：' + missing.join('、') : TOKEN_FAMILY_FILES.map((r) => r.split('/').pop()).join(' · '));
const stillInMain = TOKEN_FAMILY_FILES.map((r) => 'lib/routes/' + r.split('/').pop()).filter((rel) => mods.some((m) => m.rel === rel));
check('这 9 族在 `lib/routes/` 里零残留', stillInMain.length === 0, stillInMain.join('、'));

// ② 整簇同侧 + 铸造/消费同侧（纯函数口径）
{
  const v = clusterViolations(mods);
  check('token 簇（apply 面消费者）整簇同侧，且铸造面与消费面同侧', v.length === 0,
    v.length ? v.join('；') : '簇 = ' + mods.filter((m) => m.deps.some((k) => CLUSTER_MARKER_KEYS.includes(k))).map((m) => sideOf(m.rel)).filter((x, i, a) => a.indexOf(x) === i).join(' / '));
}

// ③ 单一来源：内核会话只建一张 mediaMap；路由族自己零 new Map / 零 set
{
  const hs = code('lib/kernel/host-session.js');
  const mapDefs = [...hs.matchAll(/const\s+mediaMap\s*=\s*new\s+Map\(\s*\)/g)].length;
  check('`lib/kernel/host-session.js` 里 token 表只建一张（`const mediaMap = new Map()` 恰 1 处）', mapDefs === 1, '实测 ' + mapDefs + ' 处');
  check('铸造器 `tokenFor` 住在同一份会话里（`const tokenFor = (absPath)` 在场）', /const\s+tokenFor\s*=\s*\(\s*absPath\s*\)/.test(hs));
  const ownMaps = [];
  const ownSets = [];
  // 只看 token 簇这 9 族（合并 upstream 1.4.0 后 pet-link 的 official-pet 自有 Map 属另一条线，不在本判据范围）。
  for (const rel of TOKEN_FAMILY_FILES) {
    const src = code(rel);
    if (/new\s+Map\s*\(/.test(src)) ownMaps.push(rel);
    if (/mediaMap\s*\.\s*set\s*\(/.test(src)) ownSets.push(rel);
  }
  check('token 簇 9 族路由模块里零 `new Map()`（token 表不许各族自建）', ownMaps.length === 0, ownMaps.join('、'));
  check('token 簇 9 族路由模块里零 `mediaMap.set(`（铸造点只在会话/清单构建器）', ownSets.length === 0, ownSets.join('、'));
  check('门面不 import `createComponentSession`（applyView 不许拿组件会话那份 serveFile）', !/createComponentSession/.test(hostSrc));
}

// ④ 包入口：9 族注册点都在、都展开 ...keys、都不覆盖 token 实例键
{
  const fns = TOKEN_FAMILY_FILES.map((rel) => {
    const base = rel.split('/').pop().replace(/\.js$/, '');
    return 'register' + base.split('-').map((s) => s[0].toUpperCase() + s.slice(1)).join('') + 'Routes';
  });
  const v = callSiteViolations(pkgEntrySrc, fns);
  check('包入口对 9 族的注册点：展开 `...keys` 且不覆盖 mediaMap/tokenFor/serveFile/serveLayout/handleSceneFiles', v.length === 0, v.join('；'));
  check('包入口的 `keys` 来自组件视图（`const keys = c;`）', /const\s+keys\s*=\s*c\s*;/.test(pkgEntrySrc));
  const inMain = fns.filter((fn) => new RegExp('\\b' + fn + '\\s*\\(\\s*webServer').test(hostSrc));
  check('门面 `lib/index.js` 对 9 族零注册调用（整簇出户，不是双注册）', inMain.length === 0, inMain.join('、'));
  const importsInMain = TOKEN_FAMILY_FILES.map((r) => r.split('/').pop()).filter((f) => new RegExp("from\\s+'\\./routes/" + f.replace('.', '\\.') + "'").test(hostSrc));
  check('门面零 import 这 9 族（`./routes/<族>.js` 说明符全不在）', importsInMain.length === 0, importsInMain.join('、'));
}

// ⑤ 门面 applyView：键集恰好 15 个、实例来自同一次 createHostSession 会话
{
  const v = applyViewViolations(hostSrc);
  check('门面 applyView 的键集恰好 = 服务面 `apply` 的 15 键，且全部来自同一次会话', v.length === 0, v.join('；'));
}

// ⑥ 路由账：总条目 48（上游 1.4.0 新增 1 条 + glass 子包状态路由 1 条 + rope-art 1 条 + 图集清单 1 条），
// 这 9 族贡献 22 条（slides 族新增 1 条），全部挂在包内
{
  const idx = buildIndex();
  const total = idx.routes.length;
  const owned = idx.routes.filter((r) => TOKEN_FAMILY_FILES.includes(r.src));
  check('路由索引总条目 = 48（上游 1.4.0、glass 状态路由、rope-art、`/slides` 各 1 条后；9 族只换模块不换路径集合）', total === 48, '实测 ' + total + ' 条');
  check('9 族的 22 条路由全部挂在包内（索引 src = packages/…；`slides` 复用媒体 token 表）', owned.length === 22, '实测 ' + owned.length + ' 条');
}

// ⑦ 行为臂：键表解析出的实例 = 服务面 apply 上的同一引用（单实例，不是拷贝）
{
  let boot = null;
  try { boot = await import(pathToFileURL(join(ROOT, 'lib/subpackage-boot.js')).href); } catch (e) {
    check('可装载 `lib/subpackage-boot.js`（行为臂前置）', false, String(e && e.message).split('\n')[0]);
  }
  if (boot) {
    const sentinel = (label) => ({ label, tag: Math.random().toString(36).slice(2) });
    const face = {};
    for (const k of APPLY_TOKEN_KEYS) face[k] = sentinel(k);
    let keysView = null, err = null;
    try { keysView = boot.subpackageKeys('media-bridge', { wallpaperEngineHost: { apply: face } }); } catch (e) { err = e; }
    check('`subpackageKeys(\'wallpaper\', ctx)` 可解析（apply 面 15 键全在场时）', keysView !== null, err ? String(err.message).split('\n')[0] : '');
    const v = keysView ? identityViolations(keysView, face) : [];
    check('键表交出的 15 个 apply 实例与服务面是**同一引用**（token 域单实例）', keysView !== null && v.length === 0, v.join('；'));
    // 负对照：把 mediaMap 换成副本 ⇒ 身份判据必须红（判据不恒真）
    const cloned = { ...keysView, mediaMap: new Map() };
    const nv = identityViolations(cloned, face, ['mediaMap']);
    check('负对照：键面拿到的 mediaMap 是副本 ⇒ 身份判据判红', nv.length === 1, nv.join('；'));
  }
}

// ⑧ 负对照：判据本体不恒真 / 不恒绿
{
  const base = mods.map((m) => ({ rel: m.rel, deps: m.deps.slice() }));
  // a. 故意把 inventory 留主包（先红后绿的历史形态）
  const moved = base.map((m) => (m.rel === TOKEN_FAMILY_FILES[0] ? { rel: 'lib/routes/inventory.js', deps: m.deps } : m));
  const vA = clusterViolations(moved);
  check('负对照：把 `/inventory` 族留主包 ⇒ 簇跨侧判红（点名 mint/consume 跨侧）',
    vA.some((s) => s.includes('跨侧')) && vA.some((s) => s.includes('铸造面') || s.includes('消费面')), vA.join('；'));
  // b. 包入口给 media-bytes 加一个组件会话 serveFile 覆盖
  const mutated = pkgEntrySrc.replace(
    'registerMediaBytesRoutes(webServer, {\n      ...keys, disposers,\n    });',
    'registerMediaBytesRoutes(webServer, {\n      ...keys, disposers, serveFile: csServeFile,\n    });');
  const vB = callSiteViolations(mutated, ['registerMediaBytesRoutes']);
  check('负对照：包入口给 media-bytes 覆盖 `serveFile:` ⇒ 调用点判红', mutated !== pkgEntrySrc && vB.length > 0, vB.join('；'));
  // c. 门面 applyView 键名漂移
  const hostMut = hostSrc.replace('  applyView = Object.freeze({\n    mediaMap,', '  applyView = Object.freeze({\n    mediaMapCopy,');
  const vC = applyViewViolations(hostMut);
  check('负对照：applyView 把 `mediaMap` 换成清稿键 ⇒ 键集判红', hostMut !== hostSrc && vC.length > 0, vC.join('；'));
  // d. 面地板：簇成员不足 8 个（只剩 4 个）必须红 —— 只靠"整簇同侧"不够，砍掉一半也得红
  const half = base.filter((m) => TOKEN_FAMILY_FILES.slice(0, 4).includes(m.rel));
  const vD = clusterViolations(half);
  check('负对照：簇成员掉到 8 个以下（面地板）⇒ 判红', vD.some((s) => s.includes('面地板')), vD.join('；'));
}

console.log('');
if (failed) {
  console.log(`TOKEN-DOMAIN CHECKS FAILED — ${failed} 条不合格`);
  console.log('修法：token 域单主权（R1）= 这 9 族整簇住同一个包、只经 `...keys` 的 apply 面取实例、'
    + '门面 applyView 交出**本次 apply 会话**的同一份实例。见设计稿 §4.2 与 lib/index.js 的 R1 注释。');
  process.exit(1);
}
console.log('TOKEN-DOMAIN CHECKS PASSED');
