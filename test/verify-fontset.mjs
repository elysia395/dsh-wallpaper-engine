#!/usr/bin/env node
// React #31 校验：**对象不能作为子节点**。替身若默默吞掉，这类错就只能在真机上炸
// （实测：参数位置上的赋值表达式会把"角色对象数组"当成子节点，空表时看不出、
// 一旦筛出角色整块面板就崩）。替身必须和 React 一样**抛**。
function badChild(c) {
  if (c === null || c === undefined || typeof c === 'boolean' || typeof c === 'string' || typeof c === 'number') return null;
  if (Array.isArray(c)) { for (const x of c) { const b = badChild(x); if (b) return b; } return null; }
  if (typeof c === 'object' && c.type) return null;
  return c;
}
function assertChildren(children) {
  for (const c of children) {
    const bad = badChild(c);
    if (bad) throw new Error('React #31：无效子节点（对象不能作为子节点）: ' + JSON.stringify(Object.keys(bad)).slice(0, 80));
  }
}/**
 * verify-fontset.mjs — F3「字体集文件化」的守卫（阶段 0 的前置网 + 阶段 1 的宿主侧判据）。
 *
 * 覆盖三件容易"看起来对、实际什么都没发生"的事：
 *   ① **键集（承重）**：字体键当前在 `KINDS` 里；共享内核的 `FONTSET_KEYS` 与本文件列出的
 *      键集逐字一致（单一真源，不是两份清单）。D1 把它们移出 `KINDS` 时本判据会变红
 *      ⇒ 那次改动不可能静默发生（键集变更必须与之一同改写本文件）。
 *   ② **往返**：真 `PUT /settings` → `config.json` → 读回，逐键相等。
 *   ③ **一次性迁移 + 迁移前外观 golden**：老 `config.json`（字体键内联、无 `fontSetId`）
 *      经惰性迁移后，文件里的值必须**逐键不变**、且由它算出的外观与录下的 golden
 *      **逐锚点相同**；再叠**路径安全**的逐条负对照与"合法 id 必须成功"的配对项。
 *
 * 需要的外界：无 —— mock `webServer` + 真实 `apply(ctx)`；数据目录经 `DSH_WE_DATA_DIR`
 *   等变量整体挪进工作区（与 verify-scene-live.mjs 同一套隔离约定），不碰用户真目录。
 *   ⚠️ 正因为宿主半有些守卫**没有**隔离 `DSH_WE_DATA_DIR`（`verify-scene.mjs` 就是），
 *   迁移必须是**惰性**的 —— 本文件断言 `apply()` 本身一个字节都不写。
 * 对外提供：无（可执行守卫）。
 *
 * 不变量（本文件断言的对象）：
 *   · **持久化白名单 = `KINDS` 的键集**：不在其中的键在客户端序列化与宿主消毒两侧都被丢弃，
 *     不报错、不进日志（`fontSetId` 是 config.json 的根字段，故意不在键集里）。
 *   · 字体键经 `PUT /settings` 往返后**逐键取值不变**。
 *   · 负载构建是「值 → 载荷」的纯函数：同一份配置必须给出逐字相同、锚点路径相同的载荷。
 *   · 字体集 id 只认单段白名单；任何非法 id 的请求在读/写之前就被拒，目录内容不变。
 *
 * Usage:  node test/verify-fontset.mjs [--record]
 *   `--record` 只打印 ② 的当前取值（供 golden 更新），不判定、不按失败退出。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable, Writable } from 'node:stream';
// 剥注释：共享的字符串感知实现（test/tools/js-text.mjs）。
import { stripComments } from './tools/js-text.mjs';
// 单独 import `src/**` 时补上 bundle 作用域的取词层（中文身份；见 test/tools/weT-shim.mjs）。
import { installWeTShim } from './tools/weT-shim.mjs';
installWeTShim();

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RECORD = process.argv.includes('--record');

// ── 隔离：设置 / 缓存 / 上传 / 素材根全部挪进工作区 ─────────────────────────
// 必须在 import lib/index.js **之前**设好：那两处路径在模块加载期解析一次。
const ISO = join(root, '.test-cache', 'fontset');
const DATA_DIR = join(ISO, 'data');
const FONTSETS_DIR = join(DATA_DIR, 'fontsets');
const ISO_HOME = join(ISO, 'home');
// 先清干净：上一次跑**中途崩掉**（进程没走到 teardown）会留下 fontsets/，
// 而本节有一条"apply() 零写盘"的判据 —— 残留会让它假红（"启动期写盘"与"上次没清"分不开）。
rmSync(ISO, { recursive: true, force: true });
mkdirSync(ISO_HOME, { recursive: true });
mkdirSync(join(ISO, 'steam'), { recursive: true });
process.env.DSH_WE_DATA_DIR = DATA_DIR;
process.env.DSH_WE_CACHE_DIR = join(ISO, 'cache');
process.env.DSH_WE_UPLOAD_DIR = join(ISO, 'uploads');
process.env.DSH_WE_STEAM_ROOT = join(ISO, 'steam');
// POSIX 读 $HOME、Windows 读 %USERPROFILE%，两个都覆盖。
process.env.HOME = ISO_HOME;
process.env.USERPROFILE = ISO_HOME;

// ── 字体键集（承重判据的一部分：键集变更必须改这里）────────────────────────
/** 持久化字体键。D1 若把它们移出 `KINDS`，① 与 ④ 会一起变红。 */
const FONT_KEYS = ['themeColors', 'themeDarkSeparate', 'themeSize', 'themeWeight', 'themeFamily', 'globalFamily', 'componentFonts'];

/** 往返用的取值：每一项都**非默认**，否则"丢掉了"与"存的是默认值"分不开。 */
const FONT_VALUES = {
  themeColors: {
    primary: { light: '#112233', dark: '#aabbcc' },
    dimmed: { light: '#010203', dark: '#040506' },
  },
  themeDarkSeparate: true,
  themeSize: { 'markdown-h1': 24, 'markdown-small': 11 },
  themeWeight: { 'markdown-h1': 700, 'markdown-table-head': 600 },
  themeFamily: { 'markdown-h1': 'SimSun', 'markdown-base': 'monospace' },
  globalFamily: 'sys:PingFang SC',
  componentFonts: { markdown: { size: 15, weight: 600 }, table: { family: 'Georgia' } },
};

/** 规范 JSON（对象键排序）—— 值比较不能依赖键的书写顺序。 */
const canon = (v) => JSON.stringify(v, (k, val) => (val && typeof val === 'object' && !Array.isArray(val)
  ? Object.fromEntries(Object.keys(val).sort().map((x) => [x, val[x]]))
  : val));

// ── 外观夹具与展开（纯计算，不需要宿主）────────────────────────────────────
const colorRoles = await import(pathToFileURL(join(root, 'src', 'font', 'color-roles.js')).href);
const typo = await import(pathToFileURL(join(root, 'src', 'font', 'typography.js')).href);
const comps = await import(pathToFileURL(join(root, 'src', 'font', 'components.js')).href);

const COLOR_IN = {
  primary: { light: '#112233', dark: '#aabbcc' },
  secondary: { light: '#223344', dark: '#bbccdd' },
  tertiary: { light: '#334455', dark: '#ccddee' },
  caption: { light: '#445566', dark: '#ddeeff' },
  dimmed: { light: '#556677', dark: '#eeff00' },
};
const TYPE_SIZES = { 'markdown-h1': 24, 'markdown-base': 16, 'markdown-code': 13 };
const TYPE_WEIGHTS = { 'markdown-h1': 800, 'markdown-base': 400 };
const TYPE_FAMILIES = { 'markdown-h1': 'SimSun', 'markdown-base': 'monospace' };
const COMPONENT_IN = {
  markdown: { size: 15, weight: 600 },
  table: { family: 'Georgia, serif' },
  codeBlock: { size: 13 },
  terminal: { family: 'Menlo, monospace' },
};
const AVAILABLE = ['markdown', 'table', 'codeBlock', 'terminal'];
/** 钩子定义点：形态照 `scanHookScopes` 的产出（单类选择器）。 */
const HOOK_SCOPES = {
  '--dsl-code-block-content-font': '._block_aaaaaa_1',
  '--dsl-code-block-banner-font': '._block_aaaaaa_2',
  '--dsl-terminal-font': '._block_bbbbbb_3',
};
/** 族键 → CSS 栈（真机上由客户端解析；这里固定一份，让载荷可复现）。 */
const FAMILY_STACKS = {
  SimSun: '"SimSun", serif',
  monospace: 'Menlo, Consolas, monospace',
  // 本机字体键（`sys:<族名>`）：栈 = 族名 + 宿主原字族的快照（真机由 --we-host-font-family 给）。
  'sys:PingFang SC': '"PingFang SC", var(--we-host-font-family, system-ui, sans-serif)',
};
const resolveFamily = (key) => FAMILY_STACKS[key] || '';
/** 全局字族夹具：**本机字体**键（这条路径要同时覆盖"全局"与"sys: 键"两件事）。 */
const GLOBAL_FAMILY = 'sys:PingFang SC';

/**
 * 老 `config.json` 的形状：字体键内联在 settings 里、没有 `fontSetId`。
 * 取值**就是** ② 的夹具 ⇒ 迁移等价可以直接拿 ② 的 golden 当判据，不必再录一份。
 */
const LEGACY_SETTINGS = {
  themeColors: COLOR_IN,
  themeDarkSeparate: true,
  themeSize: TYPE_SIZES,
  themeWeight: TYPE_WEIGHTS,
  themeFamily: TYPE_FAMILIES,
  globalFamily: GLOBAL_FAMILY,
  componentFonts: COMPONENT_IN,
};

/** 四个纯计算的载荷（② 的被测对象）。 */
function buildAppearance(over = {}) {
  const colors = colorRoles.buildTokenPayload(over.colors || COLOR_IN, () => true);
  const types = typo.buildTypePayload(over.sizes || TYPE_SIZES, () => true,
    over.weights || TYPE_WEIGHTS, over.families || TYPE_FAMILIES, resolveFamily,
    over.global === undefined ? GLOBAL_FAMILY : over.global);
  const componentCfg = over.components || COMPONENT_IN;
  return {
    'colors.roles': colors.roles,
    'colors.tokens': colors.payload,
    'type.roles': types.roles,
    'type.tokens': types.payload,
    'components.css': comps.buildComponentCss(componentCfg, AVAILABLE),
    'components.dslHooks': comps.buildDslBlocks(componentCfg, AVAILABLE, () => true, HOOK_SCOPES),
  };
}

/** 字体集正文（全部键）→ 外观夹具。迁移等价用它把"文件里的值"接回 ② 的 golden。 */
function appearanceInputs(values) {
  const v = values || {};
  return {
    colors: v.themeColors, sizes: v.themeSize, weights: v.themeWeight,
    families: v.themeFamily, global: v.globalFamily, components: v.componentFonts,
  };
}

/**
 * 把载荷展开成**绝对锚点**的稳定序列：对象键排序（与插入顺序无关），叶子行形如
 * `colors.tokens.--dsw-alias-label-primary.light = "#112233"`。
 * 锚点路径本身就是判据的一部分 —— 结构下移一层（值不变、路径变深）必须被判出。
 */
function flatten(node, path = '', out = []) {
  if (Array.isArray(node)) {
    node.forEach((v, i) => flatten(v, path + '[' + i + ']', out));
    return out;
  }
  if (node && typeof node === 'object') {
    const keys = Object.keys(node).sort();
    if (!keys.length) { out.push(path + ' = {}'); return out; }
    for (const k of keys) flatten(node[k], path + (path ? '.' : '') + k, out);
    return out;
  }
  out.push(path + ' = ' + JSON.stringify(node));
  return out;
}

/** 逐行比对（含长度差）；空数组 = 逐锚点一致。 */
function diffLines(now, want) {
  const out = [];
  const n = Math.max(now.length, want.length);
  for (let i = 0; i < n; i++) {
    if (now[i] !== want[i]) out.push('#' + i + ' 现在=' + now[i] + ' golden=' + want[i]);
  }
  return out;
}

const GOLDEN_LINES = [
  "colors.roles[0] = \"primary\"",
  "colors.roles[1] = \"secondary\"",
  "colors.roles[2] = \"tertiary\"",
  "colors.roles[3] = \"caption\"",
  "colors.roles[4] = \"dimmed\"",
  "colors.tokens.--dsw-alias-label-caption.dark = \"#ddeeff\"",
  "colors.tokens.--dsw-alias-label-caption.light = \"#445566\"",
  "colors.tokens.--dsw-alias-label-dimmed.dark = \"#eeff00\"",
  "colors.tokens.--dsw-alias-label-dimmed.light = \"#556677\"",
  "colors.tokens.--dsw-alias-label-primary.dark = \"#aabbcc\"",
  "colors.tokens.--dsw-alias-label-primary.light = \"#112233\"",
  "colors.tokens.--dsw-alias-label-primary-dimmed.dark = \"#eeff00\"",
  "colors.tokens.--dsw-alias-label-primary-dimmed.light = \"#556677\"",
  "colors.tokens.--dsw-alias-label-secondary.dark = \"#bbccdd\"",
  "colors.tokens.--dsw-alias-label-secondary.light = \"#223344\"",
  "colors.tokens.--dsw-alias-label-tertiary.dark = \"#ccddee\"",
  "colors.tokens.--dsw-alias-label-tertiary.light = \"#334455\"",
  "components.css = \"body [class*=\\\"_markdown_\\\"] {\\n  font-size: 15px;\\n  font-weight: 600;\\n}\\nbody [class*=\\\"_tableScroll_\\\"] {\\n  font-family: Georgia, serif;\\n}\\n\"",
  "components.dslHooks = \"._block_aaaaaa_1 {\\n  --dsl-code-block-content-font: var(--dsw-font-markdown-code-block-font-weight) 13px / var(--dsw-font-markdown-code-block-line-height) var(--dsw-font-markdown-code-block-font-family);\\n  --dsl-code-block-banner-font: var(--dsw-font-markdown-code-block-font-weight) 13px / var(--dsw-font-markdown-code-block-line-height) var(--dsw-font-markdown-code-block-font-family);\\n}\\n._block_bbbbbb_3 {\\n  --dsl-terminal-font: var(--dsw-font-markdown-code-block-font-weight) var(--dsw-font-markdown-code-block-font-size) / var(--dsw-font-markdown-code-block-line-height) Menlo, monospace;\\n}\\n\"",
  "type.roles[0] = \"markdown-h1\"",
  "type.roles[1] = \"markdown-base\"",
  "type.roles[2] = \"markdown-code\"",
  "type.tokens.--dsw-font-family.dark = \"\\\"PingFang SC\\\", var(--we-host-font-family, system-ui, sans-serif)\"",
  "type.tokens.--dsw-font-family.light = \"\\\"PingFang SC\\\", var(--we-host-font-family, system-ui, sans-serif)\"",
  "type.tokens.--dsw-font-markdown-base.dark = \"var(--dsw-font-markdown-base-font-weight) 16px / var(--dsw-font-markdown-base-line-height) var(--dsw-font-markdown-base-font-family)\"",
  "type.tokens.--dsw-font-markdown-base.light = \"var(--dsw-font-markdown-base-font-weight) 16px / var(--dsw-font-markdown-base-line-height) var(--dsw-font-markdown-base-font-family)\"",
  "type.tokens.--dsw-font-markdown-base-font-family.dark = \"Menlo, Consolas, monospace\"",
  "type.tokens.--dsw-font-markdown-base-font-family.light = \"Menlo, Consolas, monospace\"",
  "type.tokens.--dsw-font-markdown-base-font-size.dark = \"16px\"",
  "type.tokens.--dsw-font-markdown-base-font-size.light = \"16px\"",
  "type.tokens.--dsw-font-markdown-base-font-weight.dark = \"400\"",
  "type.tokens.--dsw-font-markdown-base-font-weight.light = \"400\"",
  "type.tokens.--dsw-font-markdown-code.dark = \"13px / var(--dsw-font-markdown-code-line-height) var(--dsw-font-markdown-code-font-family)\"",
  "type.tokens.--dsw-font-markdown-code.light = \"13px / var(--dsw-font-markdown-code-line-height) var(--dsw-font-markdown-code-font-family)\"",
  "type.tokens.--dsw-font-markdown-code-font-family.dark = \"\\\"PingFang SC\\\", var(--we-host-font-family, system-ui, sans-serif)\"",
  "type.tokens.--dsw-font-markdown-code-font-family.light = \"\\\"PingFang SC\\\", var(--we-host-font-family, system-ui, sans-serif)\"",
  "type.tokens.--dsw-font-markdown-code-font-size.dark = \"13px\"",
  "type.tokens.--dsw-font-markdown-code-font-size.light = \"13px\"",
  "type.tokens.--dsw-font-markdown-h1.dark = \"var(--dsw-font-markdown-h1-font-weight) 24px / var(--dsw-font-markdown-h1-line-height) var(--dsw-font-markdown-h1-font-family)\"",
  "type.tokens.--dsw-font-markdown-h1.light = \"var(--dsw-font-markdown-h1-font-weight) 24px / var(--dsw-font-markdown-h1-line-height) var(--dsw-font-markdown-h1-font-family)\"",
  "type.tokens.--dsw-font-markdown-h1-font-family.dark = \"\\\"SimSun\\\", serif\"",
  "type.tokens.--dsw-font-markdown-h1-font-family.light = \"\\\"SimSun\\\", serif\"",
  "type.tokens.--dsw-font-markdown-h1-font-size.dark = \"24px\"",
  "type.tokens.--dsw-font-markdown-h1-font-size.light = \"24px\"",
  "type.tokens.--dsw-font-markdown-h1-font-weight.dark = \"800\"",
  "type.tokens.--dsw-font-markdown-h1-font-weight.light = \"800\""
];

if (RECORD) {
  const lines = flatten(buildAppearance());
  console.log(JSON.stringify(lines, null, 2).replace(/^\[/, 'const GOLDEN_LINES = [').replace(/\]$/, '];'));
  process.exit(0);
}

// ── 判定脚手架 ──────────────────────────────────────────────────────────────
let failed = 0;
let passed = 0;
const check = (name, ok, detail) => {
  if (ok) { passed++; console.log('  ✓ ' + name + (detail ? ' — ' + detail : '')); }
  else { failed++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
};
const section = (t) => console.log('\n' + t);

// 老形状的 config.json 必须在 apply 之前落好：迁移读的是启动时那份。
mkdirSync(DATA_DIR, { recursive: true });
writeFileSync(join(DATA_DIR, 'config.json'), JSON.stringify({ settings: LEGACY_SETTINGS }, null, 2));

// ── mock webServer + req/res shims（与 verify-scene-live.mjs 同形）──────────
const routes = [];
const mockCtx = {
  webServer: {
    register(route) { routes.push(route); return () => { const i = routes.indexOf(route); if (i >= 0) routes.splice(i, 1); }; },
    tapIndex() { return () => {}; },
  },
};
const schema = await import(pathToFileURL(join(root, 'lib', 'settings-schema.js')).href);
const hostMod = await import(pathToFileURL(join(root, 'lib', 'index.js')).href);
const host = hostMod.default || hostMod;
const apply = host.apply || (host.inject && host.apply);
const dispose = apply(mockCtx);

function fakeRes() {
  const state = { status: 200, headers: {}, body: Buffer.alloc(0), ended: false };
  const res = new Writable({
    write(chunk, enc, cb) { state.body = Buffer.concat([state.body, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]); cb(); },
    final(cb) { state.ended = true; cb(); },
  });
  res.setHeader = (k, v) => { state.headers[k] = v; };
  res.writeHead = (s, h) => { state.status = s; if (h) Object.assign(state.headers, h); };
  Object.defineProperty(res, 'statusCode', { get: () => state.status, set: (v) => { state.status = v; } });
  res.__state = state;
  return res;
}
function fakeReq(url, method = 'GET') {
  const r = Readable.from([]);
  r.url = url;
  r.method = method;
  r.headers = {};
  return r;
}
function fakeReqBody(url, method, obj) {
  const r = Readable.from([Buffer.from(JSON.stringify(obj))]);
  r.url = url;
  r.method = method;
  r.headers = { 'content-type': 'application/json' };
  return r;
}
/** 等响应 end/finish：PUT 的应答在写盘之后才发，等它就是等持久化完成。 */
function waitRes(res) {
  return new Promise((resolveFn) => {
    if (res.__state.ended) { resolveFn(); return; }
    const t = setTimeout(resolveFn, 5000);
    res.on('finish', () => { clearTimeout(t); resolveFn(); });
  });
}
/** 发一个请求并等它结束（宿主处理可能是 async ⇒ 先把 promise 等掉）。 */
async function callRoute(route, req) {
  const res = fakeRes();
  const done = route.handler(req, res);
  if (done && typeof done.then === 'function') await done;
  await waitRes(res);
  return res;
}
const bodyJson = (res) => {
  try { return JSON.parse(res.__state.body.toString('utf8')); } catch { return null; }
};
/** 目录快照（用于"非法 id 一个字节都没写"的断言）。 */
const dirSnapshot = (dir) => {
  try { return readdirSync(dir).sort().join(','); } catch { return ''; }
};
/**
 * 目录**内容**摘要（名字 + 每个文件内容的短哈希）：用来钉住"包内目录只读" ——
 * 只看名字会漏掉"就地改了一份随包预设"，那正是写时复制要防的事。
 */
const dirDigest = (dir) => {
  let names = [];
  try { names = readdirSync(dir).filter((n) => n.endsWith('.json')).sort(); } catch { return null; }
  return names.map((n) => {
    const h = createHash('sha256').update(readFileSync(join(dir, n))).digest('hex').slice(0, 16);
    return n + ':' + h;
  }).join(',');
};
/** 随包预设目录（包内 `lib/fontsets/`，发布物 ⇒ 只读）。 */
const BUILTIN_DIR = join(root, 'lib', 'fontsets');
const builtinIds = (() => {
  try { return readdirSync(BUILTIN_DIR).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)).sort(); } catch { return []; }
})();
const BUILTIN_DIGEST_AT_START = dirDigest(BUILTIN_DIR);

/**
 * 往返后**没保住**的字体键（空数组 = 全部保住）。
 * 正判据与两条负对照共用同一个函数 —— 负对照若另抄一份判据，生产侧改了也不会红。
 */
function fontKeysNotRoundTripped(back) {
  const out = [];
  for (const k of FONT_KEYS) {
    if (!back || !(k in back)) { out.push(k + ':missing'); continue; }
    if (canon(back[k]) !== canon(FONT_VALUES[k])) out.push(k + ':value');
  }
  return out;
}

const SETTINGS_URL = '/wallpaper-engine/settings';
const FONTSETS_URL = '/wallpaper-engine/fontsets';
const settingsRoute = routes.find((r) => r.path === SETTINGS_URL);
const fontsetsRoute = routes.find((r) => r.path === FONTSETS_URL);

// ── ① 字体键集（承重）───────────────────────────────────────────────────────
section('① 字体键集（承重：这些键的归属一变，本判据必须变红）');
const persistedKeys = Object.keys(schema.serializeSettings({}));
const clientKeys = Object.keys(schema.sanitizeFromSchema({}, 'client'));
const hostKeys = Object.keys(schema.sanitizeFromSchema({}, 'host'));
// **阶段 2 的承重事实**：字体值自 F3 起住字体集文件，**不在** settings 的持久化白名单里。
// 三个入口逐一断（客户端的序列化 / 客户端消毒 / 宿主消毒）—— 漏一个就等于还有一条路能把它们
// 写回 settings blob，那时"单一真源"只是散文。
check('字体键都不在持久化白名单里（客户端序列化 / 两侧消毒三处逐一）',
  FONT_KEYS.every((k) => !persistedKeys.includes(k) && !clientKeys.includes(k) && !hostKeys.includes(k)),
  '泄漏: ' + FONT_KEYS.filter((k) => persistedKeys.includes(k) || clientKeys.includes(k) || hostKeys.includes(k)).join(','));
check('配对项：非字体键仍在白名单里（否则上面那条对"白名单整体坏掉"也成立）',
  ['blur', 'scrim', 'videoVolume'].every((k) => persistedKeys.includes(k) && hostKeys.includes(k)));
check('总开关 fontCustom 仍留在 settings 里（D1 的另一半：只把**值**搬走）',
  persistedKeys.includes('fontCustom') && hostKeys.includes('fontCustom')
  && !schema.FONTSET_KEYS.includes('fontCustom'));
check('负对照：同一判据能把"白名单里混进字体键"点出来（不是恒真的空转）',
  (() => {
    const leaks = (keys) => FONT_KEYS.some((k) => keys.includes(k));
    return leaks([...persistedKeys, 'themeSize']) === true && leaks(persistedKeys) === false;
  })());
// kind 元数据**必须留在 KINDS 里** —— `sanitizeFontset` 要按同一份 kind 消毒。
// （这条把"退出 settings ≠ 从 KINDS 里删掉"钉死：真删了的话下面的消毒会直接抛。）
check('字体键的 kind 元数据仍在 KINDS 里（sanitizeFontset 按它消毒 ⇒ 一条消毒路径）',
  FONT_KEYS.every((k) => k in schema.KINDS && schema.KINDS[k] && typeof schema.KINDS[k].kind === 'string'));
check('字体键仍在 DEFAULTS 里（字体集的默认值来源）',
  FONT_KEYS.every((k) => k in schema.DEFAULTS));
check('共享内核的 FONTSET_KEYS 与本文件列出的键集逐字一致（单一真源，不是两份清单）',
  JSON.stringify(schema.FONTSET_KEYS) === JSON.stringify(FONT_KEYS),
  'kernel=' + schema.FONTSET_KEYS.join(','));
check('负对照：键集判据对"多一个键"也有牙（fontSetId 不是正文的键）',
  !schema.FONTSET_KEYS.includes('fontSetId') && !FONT_KEYS.includes('fontSetId'));
check('sanitizeFontset 的宽严与 settings 口径一致（脏值照样丢、合法值照样留）',
  canon(schema.sanitizeFontset({ themeSize: { 'markdown-h1': 24, 'markdown-h2': 4, nope: 10 } }).themeSize)
    === canon({ 'markdown-h1': 24 })
  && canon(schema.sanitizeFontset({ themeColors: { primary: { light: '#112233', dark: 'BAD' } } }).themeColors) === canon({})
  && canon(schema.sanitizeFontset({ themeFamily: { 'markdown-h1': 'SimSun' } }).themeFamily) === canon({ 'markdown-h1': 'SimSun' }));

// ── ② 迁移前外观 golden ─────────────────────────────────────────────────────
section('② 迁移前外观 golden（绝对锚点逐条比对）');
{
  const now = flatten(buildAppearance());
  const drift = diffLines(now, GOLDEN_LINES);
  // 正判据：合法外观必须逐锚点一致（它同时是下面两条负对照的配对项 —— 没有它，负对照是恒真空转）。
  check('四个纯计算的载荷与录下的 golden 逐锚点一致',
    drift.length === 0, drift.slice(0, 3).join(' | ') || now.length + ' 个锚点');

  // 负对照①：改一个输入值 ⇒ 必须出现差异。
  const changed = diffLines(flatten(buildAppearance({ sizes: Object.assign({}, TYPE_SIZES, { 'markdown-h1': 25 }) })), GOLDEN_LINES);
  check('负对照：改一个输入值 ⇒ 判据变红（对字号有牙）', changed.length > 0, changed[0] || '');

  // 负对照②：把 light/dark 对**原样包一层**（值不变、锚点路径变深一层）⇒ 必须被判出。
  // 若判据只收集"值的集合"而不比锚点路径，这一条会被放过。
  const anchor = GOLDEN_LINES.find((l) => l.startsWith('colors.tokens.--dsw-alias-label-primary.light'));
  const app = buildAppearance();
  app['colors.tokens']['--dsw-alias-label-primary'] = { pair: app['colors.tokens']['--dsw-alias-label-primary'] };
  const shifted = flatten(app);
  check('负对照：只挪一层（锚点路径变深）也必须被判出',
    Boolean(anchor) && diffLines(shifted, GOLDEN_LINES).length > 0 && !shifted.some((l) => l === anchor),
    anchor || '锚点不在 golden 里');

  // 判据自身的可达性探针：把 golden 上的那个锚点改一位 ⇒ 比对必须立刻红。
  // 它证明该锚点真的在被逐字比较，而不是一条永远成立的装饰。
  const oneCharOff = GOLDEN_LINES.map((l) => (l === anchor ? l.replace('#112233', '#112234') : l));
  check('可达性探针：golden 改一位 ⇒ 判据立刻红（该锚点确实在被比）',
    oneCharOff.join() !== GOLDEN_LINES.join() && diffLines(now, oneCharOff).length > 0);
}

// ── ③ 迁移前护栏 + 一次性迁移（惰性）─────────────────────────────────────────
section('③ 迁移前护栏 + 一次性迁移（老 config.json → fontsets/default.json，判据 = ② 的 golden）');
check('settings 路由已注册（否则本节的护栏无从谈起）', Boolean(settingsRoute), settingsRoute ? settingsRoute.kind : 'missing');
check('字体集路由族已注册（一个 prefix 覆盖七个端点）', Boolean(fontsetsRoute), fontsetsRoute ? fontsetsRoute.kind : 'missing');
check('apply() 本身一个字节都不写字体集（启动期零写盘 ⇒ 未隔离 DSH_WE_DATA_DIR 的守卫不会被污染）',
  !existsSync(FONTSETS_DIR), existsSync(FONTSETS_DIR) ? 'fontsets/ 已存在' : '');

const readCfg = () => JSON.parse(readFileSync(join(DATA_DIR, 'config.json'), 'utf8'));
const writeCfg = (cfg) => writeFileSync(join(DATA_DIR, 'config.json'), JSON.stringify(cfg, null, 2));

if (settingsRoute && fontsetsRoute) {
  // 3a. **迁移前护栏**：字体值还没有自己的家时，任何 settings 写入都不得抹掉它们 ——
  //     否则用户随便改个别的设置（拖一下模糊）就会静默带走自定义的字体外观。
  //     判据的关键在"来源"：body 必须**不带**字体键（新客户端就是这样），
  //     护栏只能取自磁盘；从 body 取等于没护栏。
  check('前置：老形状的 config.json 里确有内联键（否则下面的判据是空转）',
    FONT_KEYS.every((k) => k in (readCfg().settings || {})));
  const putNoFonts = await callRoute(settingsRoute,
    fakeReqBody(SETTINGS_URL, 'PUT', schema.serializeSettings({ id: 'guard-probe', blur: 7 })));
  const afterPut = readCfg().settings || {};
  check('迁移前：body 不带字体键的 PUT /settings 仍保住磁盘上那全部老值（不静默丢外观）',
    putNoFonts.__state.status === 200 && FONT_KEYS.every((k) => k in afterPut),
    '丢: ' + FONT_KEYS.filter((k) => !(k in afterPut)).join(','));
  check('同期：这次 PUT 的其它字段照常落盘（护栏不是"整份不写"）', afterPut.blur === 7);

  // 3b. 惰性迁移。
  const listRes = await callRoute(fontsetsRoute, fakeReq(FONTSETS_URL));
  const listed = bodyJson(listRes);
  check('GET /fontsets 触发惰性迁移，并把 default 记为活动集',
    listRes.__state.status === 200 && listed && listed.active === 'default' && listed.migrated === true,
    'status=' + listRes.__state.status + ' body=' + JSON.stringify(listed));
  const defaultFile = join(FONTSETS_DIR, 'default.json');
  check('迁移把 default 集落盘（fontsets/default.json）', existsSync(defaultFile), defaultFile);

  const gotRes = await callRoute(fontsetsRoute, fakeReq(FONTSETS_URL + '/default'));
  const got = bodyJson(gotRes);
  check('迁移把老 config.json 的内联值原样搬进默认集（逐键 canon 相等）',
    gotRes.__state.status === 200 && got && canon(got.values) === canon(schema.sanitizeFontset(LEGACY_SETTINGS)),
    got ? 'file=' + canon(got.values).slice(0, 120) : 'status=' + gotRes.__state.status);

  // 迁移等价的**接线**：由文件里的值算出的外观，必须与 ② 那份 golden 逐锚点相同。
  const fromFile = flatten(buildAppearance(appearanceInputs(got && got.values)));
  check('迁移等价：由文件里的值算出的外观与 ② 的 golden 逐锚点一致（迁移没有改变外观）',
    diffLines(fromFile, GOLDEN_LINES).length === 0, diffLines(fromFile, GOLDEN_LINES).slice(0, 2).join(' | '));
  // 配对项：把迁移产物改一个值 ⇒ 同一条判据必须变红（否则"等价"是空转）。
  const tampered = Object.assign({}, got && got.values,
    { themeSize: Object.assign({}, got && got.values && got.values.themeSize, { 'markdown-h1': 25 }) });
  check('负对照：改掉迁移产物的一个值 ⇒ 等价判据立刻红',
    diffLines(flatten(buildAppearance(appearanceInputs(tampered))), GOLDEN_LINES).length > 0);

  // 3c. D1 的终态：迁移**一次写完**"记 id + 摘掉内联键"⇒ config.json 只剩 { fontSetId, fontCustom }。
  const cfgMigrated = readCfg();
  check('迁移后 config.json 的 settings 里不再有内联键（D1 终态：值只住字体集）',
    cfgMigrated.fontSetId === 'default' && FONT_KEYS.every((k) => !(k in (cfgMigrated.settings || {}))),
    '仍在: ' + FONT_KEYS.filter((k) => k in (cfgMigrated.settings || {})).join(','));
  check('活动 id 记在 config.json 的**根字段**（不是 settings 的键集里）',
    cfgMigrated.fontSetId === 'default' && !FONT_KEYS.includes('fontSetId'));
  // 护栏必须**自己终止**：迁移后再 PUT 一次，内联键不许被带回来。
  await callRoute(settingsRoute, fakeReqBody(SETTINGS_URL, 'PUT', { blur: 9 }));
  check('迁移后 PUT /settings 也带不回内联字体键（护栏随迁移终止，不留常驻双写）',
    FONT_KEYS.every((k) => !(k in (readCfg().settings || {}))));

  // 3d. 迁移**不许覆盖**已有的用户 default：客户端在迁移落定前若已改过字体，它会先 PUT 出
  //     一份用户 default；迁移若照写一遍就等于把用户刚做的编辑抹掉（还看起来"迁移成功"）。
  const editedValues = Object.assign({}, schema.sanitizeFontset(LEGACY_SETTINGS),
    { themeWeight: { 'markdown-h1': 900 } });
  await callRoute(fontsetsRoute, fakeReqBody(FONTSETS_URL + '/default', 'PUT', { values: editedValues }));
  const cfgUnmigrated = readCfg();
  delete cfgUnmigrated.fontSetId; // 模拟"用户已编辑、但迁移还没落定"
  writeCfg(cfgUnmigrated);
  const relist = bodyJson(await callRoute(fontsetsRoute, fakeReq(FONTSETS_URL)));
  const afterAdopt = bodyJson(await callRoute(fontsetsRoute, fakeReq(FONTSETS_URL + '/default')));
  check('迁移遇到已有的用户 default ⇒ 采纳（adopted）而不是覆盖：用户的编辑不被抹掉',
    relist && relist.migrated === true && relist.adopted === true
    && afterAdopt && canon(afterAdopt.values.themeWeight) === canon({ 'markdown-h1': 900 }),
    'migrated=' + (relist && relist.migrated) + ' adopted=' + (relist && relist.adopted)
    + ' weight=' + JSON.stringify(afterAdopt && afterAdopt.values && afterAdopt.values.themeWeight));
}

// ── ④ 设置通道仍照常（字体键除外，配对项）───────────────────────────────────
section('④ 设置通道：非字体键照常往返，字体键进不去（D1 的另一半）');
if (settingsRoute) {
  const cfgPath = join(DATA_DIR, 'config.json');
  // 客户端 PUT 的体就是 serializeSettings(selection) —— 字体键**在序列化时就已不在体里**。
  const body = schema.serializeSettings({ id: 'roundtrip-probe', blur: 11, themeSize: { 'markdown-h1': 30 } });
  check('序列化阶段字体键就已经不在体里（客户端根本不会把它们发给 settings）',
    !('themeSize' in body) && body.blur === 11, Object.keys(body).filter((k) => FONT_KEYS.includes(k)).join(','));

  // 就算有人手工把字体键塞进 PUT body，宿主消毒也不收（白名单之外）。
  const raw = {
    blur: 13,
    themeColors: { primary: { light: '#010203', dark: '#040506' } },
    themeSize: { 'markdown-h1': 30 },
  };
  const res = await callRoute(settingsRoute, fakeReqBody(SETTINGS_URL, 'PUT', raw));
  let back = null;
  try { back = JSON.parse(readFileSync(cfgPath, 'utf8')).settings; } catch { /* 断言会报 */ }
  check('PUT /settings 仍返回 200（通道本身没坏）', res.__state.status === 200, 'status=' + res.__state.status);
  check('手工塞进 body 的字体键也进不了 config.json（白名单是硬边界）',
    Boolean(back) && FONT_KEYS.every((k) => !(k in back)),
    '进: ' + FONT_KEYS.filter((k) => back && k in back).join(','));
  check('同期非字体键逐键往返不变（配对项：不是"整份丢弃"）', back && back.blur === 13,
    'blur=' + (back && back.blur));

  // 负对照：kind 元数据是 `sanitizeFontset` 的地基 —— 少了它必须**当场抛**，
  // 而不是静默给出一份半成品（那种失败会以"设置看起来没生效"的形态漂到用户那里）。
  const savedMeta = schema.KINDS.themeSize;
  try {
    delete schema.KINDS.themeSize;
    let threw = false;
    try { schema.sanitizeFontset({ themeSize: { 'markdown-h1': 24 } }); } catch { threw = true; }
    check('负对照：kind 元数据被删掉 ⇒ sanitizeFontset 当场抛（不静默给半份）', threw);
  } finally {
    schema.KINDS.themeSize = savedMeta;
  }
  check('负对照收尾：KINDS 的 kind 元数据已复原（后续判据不跑在被污染的模块上）',
    schema.KINDS.themeSize === savedMeta && schema.KINDS.themeSize.kind === 'typeSizes');
  check('负对照配对：复原后同一份字体集消毒重新成立',
    canon(schema.sanitizeFontset({ themeSize: { 'markdown-h1': 24 } }).themeSize) === canon({ 'markdown-h1': 24 }));
}

// ── ⑤ 字体集的路径安全与往返 ────────────────────────────────────────────────
section('⑤ 字体集存取的路径安全与往返（id 白名单 / 不落盘 / 合法 id 必须成功）');
if (fontsetsRoute) {
  // 5a. 白名单**逐条**（单元级）：URL 规范化会先把 `..` 一类点段吃掉，所以两种口径都要测 ——
  //     这一层测的是"就算它到了分派处也仍然进不去"。
  const BAD_IDS = ['../x', '..\\x', '/abs', 'C:', 'C:\\x', '', '.', '..', 'a/b', 'a\\b',
    'x'.repeat(65), 'import', 'export', 'a b', 'a.json', '%2e%2e', 'con:', 'a\0b', 'default.json'];
  const leaked = BAD_IDS.filter((v) => schema.isFontSetId(v));
  check('id 白名单逐条拒绝（穿越 / 绝对路径 / 盘符 / 空 / 点段 / 保留段 / 超长 / 非法字符）',
    leaked.length === 0, leaked.length ? '漏过: ' + JSON.stringify(leaked) : BAD_IDS.length + ' 个用例');
  check('负对照：合法 id 必须过白名单（否则上面那条恒真）',
    ['default', 'my-set_1', 'A'.repeat(64)].every((v) => schema.isFontSetId(v))
    && !schema.isFontSetId('A'.repeat(65)));

  // 5b. 行为级：非法 id 的请求必须被拒，且目录内容**一个字节都不变**。
  const snapBefore = dirSnapshot(FONTSETS_DIR);
  const BAD_URLS = [
    FONTSETS_URL + '/a%2F..%2Fb',      // 编码斜杠 ⇒ 解码后含 '/' ⇒ 白名单拒
    FONTSETS_URL + '/a%5Cb',           // 编码反斜杠
    FONTSETS_URL + '/' + 'x'.repeat(80),
    FONTSETS_URL + '/a.json',
    FONTSETS_URL + '/C%3A',
    FONTSETS_URL + '/%2e%2e%2Fx',      // 点段：URL 规范化会吃掉它 ⇒ 落到别的分支（仍被拒）
    FONTSETS_URL + '//evil',
    FONTSETS_URL + '/%00',
    FONTSETS_URL + '/export',
  ];
  const seen = [];
  for (const url of BAD_URLS) {
    for (const method of ['PUT', 'DELETE']) {
      const res = await callRoute(fontsetsRoute,
        method === 'PUT' ? fakeReqBody(url, 'PUT', { values: {} }) : fakeReq(url, method));
      if (![400, 404, 405, 409, 413].includes(res.__state.status)) seen.push(method + ' ' + url + '→' + res.__state.status);
    }
  }
  check('非法 id / 非法路径的写删请求全部被拒（400 / 404 / 405）',
    seen.length === 0, seen.slice(0, 3).join(' | ') || BAD_URLS.length * 2 + ' 个请求');
  check('非法请求之后目录内容一个字节都没变（判据落在"没落盘"，不只看状态码）',
    dirSnapshot(FONTSETS_DIR) === snapBefore, 'now=' + dirSnapshot(FONTSETS_DIR));

  // 5c. 合法 id 必须成功 —— 否则上面整组负对照是恒真的空转。
  const probeId = 'probe-set_1';
  const putEmpty = await callRoute(fontsetsRoute,
    fakeReqBody(FONTSETS_URL + '/' + probeId, 'PUT', { name: '探针' }));
  check('PUT 缺 values ⇒ 400（清空必须显式给 {}，不许被静默当成清空）',
    putEmpty.__state.status === 400, 'status=' + putEmpty.__state.status);
  const putRes = await callRoute(fontsetsRoute,
    fakeReqBody(FONTSETS_URL + '/' + probeId, 'PUT', { name: '探针', values: FONT_VALUES }));
  check('合法 id + 合法 body ⇒ 200（负对照组的配对项）',
    putRes.__state.status === 200, 'status=' + putRes.__state.status);
  check('写入后文件出现在目录里', existsSync(join(FONTSETS_DIR, probeId + '.json')));

  const getRes = await callRoute(fontsetsRoute, fakeReq(FONTSETS_URL + '/' + probeId));
  const gotProbe = bodyJson(getRes);
  check('写进去的值能逐键读回（与 settings 往返共用同一个判据函数）',
    getRes.__state.status === 200 && gotProbe && fontKeysNotRoundTripped(gotProbe.values).length === 0,
    gotProbe ? fontKeysNotRoundTripped(gotProbe.values).join(' ') : 'status=' + getRes.__state.status);

  // 导出的字节必须能再导入读回同一份值（导出正文由读到的值重建）。
  const expRes = await callRoute(fontsetsRoute, fakeReq(FONTSETS_URL + '/' + probeId + '/export'));
  const exported = bodyJson(expRes);
  check('export 带 attachment 头且正文是当前版本',
    expRes.__state.status === 200
    && /attachment/.test(String(expRes.__state.headers['Content-Disposition'] || ''))
    && exported && exported.$schema === schema.FONTSET_SCHEMA_TAG,
    String(expRes.__state.headers['Content-Disposition'] || 'no header'));
  const impRes = await callRoute(fontsetsRoute, fakeReqBody(FONTSETS_URL + '/import', 'POST', exported));
  const imported = bodyJson(impRes);
  check('导入导出的字节 ⇒ 分配到新 id（不与既有集撞名）',
    impRes.__state.status === 200 && imported && imported.id && imported.id !== probeId,
    'id=' + (imported && imported.id));
  const impGet = await callRoute(fontsetsRoute, fakeReq(FONTSETS_URL + '/' + (imported && imported.id)));
  const impValues = bodyJson(impGet);
  check('导入读回的值与导出前逐键相同（往返闭合）',
    impGet.__state.status === 200 && impValues && canon(impValues.values) === canon(FONT_VALUES));

  // 读不懂的版本必须**拒绝并说明**，不猜、不静默降级成空集。
  writeFileSync(join(FONTSETS_DIR, 'broken.json'),
    JSON.stringify({ $schema: 'dsh-we/fontset@99', id: 'broken', name: 'x', values: {} }));
  const brokenRes = await callRoute(fontsetsRoute, fakeReq(FONTSETS_URL + '/broken'));
  const broken = bodyJson(brokenRes);
  check('版本读不懂 ⇒ 422 + 可判定原因（不猜、不降级成空集）',
    brokenRes.__state.status === 422 && broken && broken.reason === 'bad-version',
    'status=' + brokenRes.__state.status + ' reason=' + (broken && broken.reason));
  const list2 = bodyJson(await callRoute(fontsetsRoute, fakeReq(FONTSETS_URL)));
  const brokenRow = (list2 && list2.fontsets || []).find((f) => f.id === 'broken');
  check('列表把读不懂的文件标成 broken（不静默隐藏，也不当成正常集）',
    Boolean(brokenRow) && brokenRow.broken === 'bad-version', JSON.stringify(brokenRow));

  // 活动集不可删（"正在用的那份被删掉"没有可判定的正确结果）。
  const delActive = await callRoute(fontsetsRoute, fakeReq(FONTSETS_URL + '/default', 'DELETE'));
  check('删除活动集 ⇒ 400 且文件仍在',
    delActive.__state.status === 400 && existsSync(join(FONTSETS_DIR, 'default.json')),
    'status=' + delActive.__state.status);

  const unknown = await callRoute(fontsetsRoute, fakeReq(FONTSETS_URL + '/no-such-set'));
  check('未知 id ⇒ 404', unknown.__state.status === 404, 'status=' + unknown.__state.status);

  // 切换活动集：切换前必须读得懂（否则拒绝），切成功之后"删不动/删得动"的界限要跟着移动。
  const actUnknown = await callRoute(fontsetsRoute, fakeReq(FONTSETS_URL + '/no-such-set/activate', 'POST'));
  check('切换到不存在的集 ⇒ 404', actUnknown.__state.status === 404, 'status=' + actUnknown.__state.status);
  const actBroken = await callRoute(fontsetsRoute, fakeReq(FONTSETS_URL + '/broken/activate', 'POST'));
  check('切换到读不懂的集 ⇒ 422（不把外观切到说不清的状态）',
    actBroken.__state.status === 422, 'status=' + actBroken.__state.status);
  const actProbe = await callRoute(fontsetsRoute, fakeReq(FONTSETS_URL + '/' + probeId + '/activate', 'POST'));
  const actBody = bodyJson(actProbe);
  check('切换到合法集 ⇒ 200 且 active 跟着变',
    actProbe.__state.status === 200 && actBody && actBody.active === probeId,
    'status=' + actProbe.__state.status + ' active=' + (actBody && actBody.active));
  const cfgAfter = JSON.parse(readFileSync(join(DATA_DIR, 'config.json'), 'utf8'));
  check('活动 id 落在 config.json 根字段上（切换真的持久化了，不只是响应里说了一句）',
    cfgAfter.fontSetId === probeId, 'fontSetId=' + cfgAfter.fontSetId);
  const listAfter = bodyJson(await callRoute(fontsetsRoute, fakeReq(FONTSETS_URL)));
  check('列表的 active 与切换结果一致（列表是真源，不是客户端自己的记忆）',
    listAfter && listAfter.active === probeId
    && (listAfter.fontsets || []).filter((f) => f.active).map((f) => f.id).join() === probeId,
    JSON.stringify((listAfter && listAfter.fontsets || []).map((f) => f.id + (f.active ? '*' : ''))));

  // 界限是会移动的：**前**活动集（default）现在删得掉，**当前**活动集删不掉。
  const delFormer = await callRoute(fontsetsRoute, fakeReq(FONTSETS_URL + '/default', 'DELETE'));
  check('切走之后，前活动集可删 ⇒ 200 且文件消失',
    delFormer.__state.status === 200 && !existsSync(join(FONTSETS_DIR, 'default.json')),
    'status=' + delFormer.__state.status);
  const delCurrent = await callRoute(fontsetsRoute, fakeReq(FONTSETS_URL + '/' + probeId, 'DELETE'));
  check('当前活动集仍不可删 ⇒ 400 且文件仍在（同一条规则在另一个集上同样成立）',
    delCurrent.__state.status === 400 && existsSync(join(FONTSETS_DIR, probeId + '.json')),
    'status=' + delCurrent.__state.status);
}

// ── ⑥ 随包预设（两层存储）──────────────────────────────────────────────────
section('⑥ 随包预设（两层存储：用户层胜 / 写时复制 / 包内只读）');
if (fontsetsRoute) {
  // 6a. 随包预设**是我们自己写的数据** —— 一个 typo 会让所有用户的那份预设不可用，
  //     所以"逐份有效"是发布前的硬闸（`sanitizeFontset` 会**静默丢掉**它不认识的值）。
  const badBuiltin = [];
  for (const id of builtinIds) {
    let raw = null;
    try { raw = JSON.parse(readFileSync(join(BUILTIN_DIR, id + '.json'), 'utf8')); } catch { badBuiltin.push(id + ':unreadable'); continue; }
    if (!raw || raw.$schema !== schema.FONTSET_SCHEMA_TAG) { badBuiltin.push(id + ':schema'); continue; }
    if (raw.id !== id) { badBuiltin.push(id + ':id-mismatch'); continue; }
    if (!schema.isFontSetId(id)) { badBuiltin.push(id + ':bad-id'); continue; }
    for (const [k, v] of Object.entries(raw.values || {})) {
      if (canon(schema.sanitizeFontset({ [k]: v })[k]) !== canon(v)) badBuiltin.push(id + '.' + k);
    }
  }
  check('随包目录存在且**非空**（"开箱就有能用的预设"是需求本身，不是可选装饰）',
    builtinIds.length > 0, BUILTIN_DIR + ' → ' + (builtinIds.join(',') || '(空)'));
  check('随包预设逐份有效（版本 / id 与文件名一致 / id 合法 / 没有值被消毒悄悄丢掉）',
    badBuiltin.length === 0, badBuiltin.join(' ') || builtinIds.length + ' 份都过');
  check('负对照：作者写了一个会被消毒丢掉的值 ⇒ 同一判据必须点名它（否则上面那条是空转）',
    canon(schema.sanitizeFontset({ themeSize: { 'markdown-h1': 4 } }).themeSize['markdown-h1']) !== canon(4));
  check('随包预设不含 `default`（否则迁移出来的用户集会把那份随包预设永久遮住）',
    !builtinIds.includes('default'), 'ids=' + builtinIds.join(','));
  // 6a-2. 随包预设必须**真的改变外观**：`values` 全空的预设 = 用户切换了却没反应，
  //       而且这种"发布物是空壳"没有任何别的机制会发现。
  {
    const blank = flatten(buildAppearance(appearanceInputs({
      themeColors: {}, themeSize: {}, themeWeight: {}, themeFamily: {}, componentFonts: {},
    }))).join();
    const isEmptyPreset = (values) => flatten(buildAppearance(appearanceInputs(values))).join() === blank;
    const readValues = (id) => {
      try { return JSON.parse(readFileSync(join(BUILTIN_DIR, id + '.json'), 'utf8')).values; } catch { return null; }
    };
    const noop = builtinIds.filter((id) => {
      const v = readValues(id);
      return v === null || isEmptyPreset(v);
    });
    check('随包预设必须真的改变外观（空壳预设 = 用户切换了却没反应）',
      builtinIds.length > 0 && noop.length === 0, noop.join(' ') || builtinIds.length + ' 份都有实际取值');
    check('负对照：values 全空会被同一条判据点名（判据有牙，不是恒真）',
      isEmptyPreset({ themeColors: {}, themeSize: {}, themeWeight: {}, themeFamily: {}, componentFonts: {} }) === true
      && builtinIds.every((id) => isEmptyPreset(readValues(id) || {}) === false));
  }
  // 快照函数自身的可达性探针：内容改一位 ⇒ 摘要必须变（否则"字节不变"是恒真）。
  {
    const probeDir = join(ISO, 'digest-probe');
    mkdirSync(probeDir, { recursive: true });
    writeFileSync(join(probeDir, 'a.json'), '{"x":1}');
    const d1 = dirDigest(probeDir);
    writeFileSync(join(probeDir, 'a.json'), '{"x":2}');
    check('可达性探针：内容快照函数真的读内容（改一位 ⇒ 摘要变）',
      Boolean(d1) && d1 !== dirDigest(probeDir));
  }

  const target = builtinIds[0];
  const listB = bodyJson(await callRoute(fontsetsRoute, fakeReq(FONTSETS_URL)));
  const builtinRows = (listB && listB.fontsets || []).filter((f) => builtinIds.includes(f.id));
  check('列表把随包预设标成 origin=builtin（不是"看起来像用户的"）',
    builtinRows.length === builtinIds.length && builtinRows.every((f) => f.origin === 'builtin'),
    JSON.stringify(builtinRows));

  // 6b. 人工切换对随包预设同样适用；随包那份可直接读、直接导出（分享不必先复制）。
  const actB = bodyJson(await callRoute(fontsetsRoute, fakeReq(FONTSETS_URL + '/' + target + '/activate', 'POST')));
  check('激活随包预设 ⇒ 200 且 origin=builtin',
    actB && actB.active === target && actB.origin === 'builtin', JSON.stringify(actB));
  const gotB = bodyJson(await callRoute(fontsetsRoute, fakeReq(FONTSETS_URL + '/' + target)));
  const expB = bodyJson(await callRoute(fontsetsRoute, fakeReq(FONTSETS_URL + '/' + target + '/export')));
  check('随包预设可读、可导出，且两者值一致',
    gotB && gotB.origin === 'builtin' && expB && expB.$schema === schema.FONTSET_SCHEMA_TAG
    && canon(expB.values) === canon(gotB.values),
    'origin=' + (gotB && gotB.origin));

  // 6c. 写时复制（D3）：改随包预设 ⇒ 落一份**用户层**覆盖，包内字节不动。
  const beforeCopy = dirDigest(BUILTIN_DIR);
  const copyValues = Object.assign({}, expB.values, { themeWeight: { 'markdown-h1': 900 } });
  const covRes = bodyJson(await callRoute(fontsetsRoute,
    fakeReqBody(FONTSETS_URL + '/' + target, 'PUT', { values: copyValues })));
  check('PUT 随包 id ⇒ 响应标 overrides + origin=user（写时复制，不是就地改）',
    covRes && covRes.overrides === true && covRes.origin === 'user',
    JSON.stringify(covRes && { origin: covRes.origin, overrides: covRes.overrides }));
  check('覆盖落在**用户层**（同名文件出现在 pluginDataDir/fontsets/）',
    existsSync(join(FONTSETS_DIR, target + '.json')));
  check('覆盖期间包内字节**逐字节不变**（这条就是"包内只读"）',
    dirDigest(BUILTIN_DIR) === beforeCopy);
  const listC = bodyJson(await callRoute(fontsetsRoute, fakeReq(FONTSETS_URL)));
  const rowC = (listC && listC.fontsets || []).find((f) => f.id === target);
  check('列表该行标成用户层覆盖（origin=user + overrides）',
    rowC && rowC.origin === 'user' && rowC.overrides === true, JSON.stringify(rowC));
  const gotC = bodyJson(await callRoute(fontsetsRoute, fakeReq(FONTSETS_URL + '/' + target)));
  check('用户层胜：读到的是覆盖后的值，不是随包那份',
    gotC && canon(gotC.values.themeWeight) === canon({ 'markdown-h1': 900 }),
    JSON.stringify(gotC && gotC.values.themeWeight));

  // 6d. 恢复随包原样 = 删掉覆盖（删活动集要 400，所以先切走）。
  await callRoute(fontsetsRoute, fakeReq(FONTSETS_URL + '/probe-set_1/activate', 'POST'));
  const delCov = bodyJson(await callRoute(fontsetsRoute, fakeReq(FONTSETS_URL + '/' + target, 'DELETE')));
  check('删掉覆盖 ⇒ 200 + restored=builtin（这就是「恢复随包原样」）',
    delCov && delCov.removed === target && delCov.restored === 'builtin', JSON.stringify(delCov));
  const gotD = bodyJson(await callRoute(fontsetsRoute, fakeReq(FONTSETS_URL + '/' + target)));
  check('恢复后读到随包原值、origin 回到 builtin',
    gotD && gotD.origin === 'builtin' && canon(gotD.values) === canon(expB.values),
    'origin=' + (gotD && gotD.origin));

  // 6e. 未覆盖的随包预设删不掉（发布物不是用户数据）。
  const delBuiltinRes = await callRoute(fontsetsRoute, fakeReq(FONTSETS_URL + '/' + target, 'DELETE'));
  const delBuiltin = bodyJson(delBuiltinRes);
  check('未覆盖的随包预设 ⇒ 400 + 说明（可覆盖，不可删）',
    delBuiltinRes.__state.status === 400 && delBuiltin && delBuiltin.origin === 'builtin'
    && existsSync(join(BUILTIN_DIR, target + '.json')),
    'status=' + delBuiltinRes.__state.status);

  // 6f. 收口：整个守卫跑完，包内目录与开跑前逐字节相同。
  check('整个守卫跑完后包内目录逐字节不变（包内只读不是口号）',
    dirDigest(BUILTIN_DIR) === BUILTIN_DIGEST_AT_START,
    'start=' + BUILTIN_DIGEST_AT_START + ' now=' + dirDigest(BUILTIN_DIR));
}

// ── ⑦ 客户端通道（静态契约）────────────────────────────────────────────────
section('⑦ 客户端通道（静态契约：字体值不再经 settings 出去，也不再从 settings 进来）');
{
  const clientSrc = readFileSync(join(root, 'src', 'client.js'), 'utf8');
  const storeSrc = readFileSync(join(root, 'src', 'fontset-store.js'), 'utf8');
  /** 静态判据只认代码：调用点沿用短名 `strip`。 */
  const strip = stripComments;
  const clientCode = strip(clientSrc);

  // 7a. **承重**：这些键**不许**再经 setSetting 出去 —— 那条通道的白名单已经不带它们，
  //     写了就是静默丢（"拖了滑块没反应"的形态，而且没有任何东西会红）。
  const viaSetting = FONT_KEYS.filter((k) => new RegExp('setSetting\\(\\s*["\']' + k + '["\']').test(clientCode));
  check('字体键都不再经 setSetting 落盘（写了就是静默丢）',
    viaSetting.length === 0, viaSetting.join(',') || '零处');
  check('负对照：同一判据对合成的一行有牙',
    FONT_KEYS.some((k) => new RegExp('setSetting\\(\\s*["\']' + k + '["\']').test('setSetting("' + k + '", next);')));
  // 7a′ **"唯一入口"必须真的唯一**：只数 `setFontValues(` 的调用点是不够的 —— 直写的**另一条路**
  //     照样能把"改了不生效 / 刷新后回退"带回来（逐键手抄"赋值 + 落盘"正是它要消掉的东西），
  //     而那种写法**不会**让"调用点 ≥6"这条判据变红。
  //     那些键共三条写路径，其中两条**不以字面赋值出现**、且都是刻意的：
  //       · `setFontValues(patch)`      —— `for (const key of FONTSET_KEYS) … selection[key] = …`（唯一落盘入口）
  //       · `loadFontSet` 的整套采用     —— 一次 `Object.assign(selection, values)`，**刻意不落盘**（写的就是宿主那份）
  //       · `onFontResetAll` 的整批重置 —— 6 个字面赋值 + 紧跟 `persistFontSet()`（逐键走 setFontValues 会发 6 次 PUT）
  //     所以判据钉的是"**字面直写**只许出现在整批重置那一处，且那一处**真的**跟了 persistFontSet"。
  /** 判据：字面直写的处数 / 其中落在整批重置里的处数 / 整批重置是否跟了落盘（正负对照共用它）。 */
  const literalFontWrites = (text) => {
    const count = (t) => FONT_KEYS.reduce((a, k) =>
      a + ((t.match(new RegExp('selection\\.' + k + '\\s*=[^=]', 'g')) || []).length), 0);
    // 整批重置的函数体：`onFontResetAll` 起，到下一个同级 `};` 止（该函数体内没有缩进 0 的声明）。
    const body = (text.match(/const onFontResetAll = \(\) => \{[\s\S]*?\n  \};/) || [''])[0];
    return { total: count(text), inBody: body ? count(body) : 0, paired: /persistFontSet\(\)/.test(body) };
  };
  {
    const w = literalFontWrites(clientCode);
    check('字体键的字面直写**只**出现在「恢复默认」的整批重置里',
      w.total === FONT_KEYS.length && w.inBody === FONT_KEYS.length,
      '总计=' + w.total + ' / 其中在整批重置里=' + w.inBody + '（期望 ' + FONT_KEYS.length + '/' + FONT_KEYS.length + '）');
    check('整批重置**写必成对**：赋值之后跟了 persistFontSet()（否则"恢复默认"改了不生效）',
      w.paired, w.paired ? '成对' : '缺 persistFontSet()');
    // 负对照 1：在整批重置**之外**多一处字面直写 ⇒ 判据必须给"坏"的裁决。
    const stray = literalFontWrites(clientCode + '\nfunction stray(){ selection.themeSize = 1; }\n');
    check('负对照：整批重置之外多一处字面直写会被判出',
      stray.total !== FONT_KEYS.length && stray.total === w.total + 1,
      '总计=' + w.total + ' → ' + stray.total);
    // 负对照 2：把落盘摘掉 ⇒ "写必成对"必须给"坏"的裁决。
    const unpaired = literalFontWrites(clientCode.replace(/persistFontSet\(\);/, ''));
    check('负对照：整批重置后面的 persistFontSet() 被摘掉会被判出',
      w.paired === true && unpaired.paired === false, 'paired ' + w.paired + ' → ' + unpaired.paired);
  }

  // 7b. **启动链顺序**就是"迁移前不丢老值"的客户端那一半：先设置、再字体集、最后库存。
  //     反过来的话，第一次 settings 写入发生在字体集建立之前 —— 那时宿主靠护栏兜着，
  //     但客户端没必要把自己放到需要护栏的位置上。
  check('启动链顺序 = loadPersisted → loadFontSet → loadInventory',
    /loadPersisted\(\)\s*\.then\(loadFontSet\)\s*\.then\(loadInventory\)/.test(clientCode));
  check('负对照：少了 loadFontSet 的启动链会被同一判据点名',
    !/loadPersisted\(\)\s*\.then\(loadFontSet\)\s*\.then\(loadInventory\)/.test('loadPersisted().then(loadInventory);'));
  check('selection 初始化合并了本地缓存那份（首帧即用户字体，不出现默认值→用户值跳变）',
    /\.\.\.readCachedFontSetValues\(\),/.test(clientCode));

  // 7c. 生命周期：这条通道有自己的挂起写，同样要 pagehide 落盘、回前台重试、卸载取消。
  check('字体集通道的 pagehide / visibilitychange / 卸载清理都接了（且随 fiber 注销）',
    /addEventListener\("pagehide", onPageHideFlushFontSet\)/.test(clientCode)
    && /removeEventListener\("pagehide", onPageHideFlushFontSet\)/.test(clientCode)
    && /addEventListener\("visibilitychange", onVisibilityResyncFontSet\)/.test(clientCode)
    && /removeEventListener\("visibilitychange", onVisibilityResyncFontSet\)/.test(clientCode)
    && /cancelPendingFontSet\(\)/.test(clientCode));

  // 7d2. **崩溃修复（点「字体自定义」白屏）的判据链**。根因：那些键已不在 settings 白名单里
  //      ⇒ `readPersisted()` 不再提供它们，而字体集是异步载入、还可能失败 ⇒ `selection` 里
  //      **根本没有** themeColors 等键；面板那份 `fontCustom` 门控的配色区（`sel.themeColors[role.id]`）
  //      恰好在打开开关那一刻首次求值 ⇒ React 渲染期抛 TypeError ⇒ 整个面板崩掉。
  //      三样一起钉：① 初始化必须有兜底且在缓存之前；② 兜底是"全函数"；③ 边界处还有第二道。
  check('selection 初始化带字体键的兜底，且排在缓存之前（缺了就是"点开关白屏"）',
    /\.\.\.fontValueDefaults\(\),\s*\n\s*\.\.\.readCachedFontSetValues\(\),/.test(clientCode));
  check('负对照：同一判据对"只有缓存、没有兜底"的初始化有牙',
    !/\.\.\.fontValueDefaults\(\),\s*\n\s*\.\.\.readCachedFontSetValues\(\),/
      .test('  ...readPersisted(),\n  ...readCachedFontSetValues(),'));
  check('兜底是**全函数**：空输入也必须给出字体键、且形状可读（面板直接下标不抛）',
    (() => {
      const d = schema.sanitizeFontset({});
      return FONT_KEYS.every((k) => k in d)
        && typeof d.themeColors === 'object' && typeof d.themeSize === 'object'
        && typeof d.themeWeight === 'object' && typeof d.themeFamily === 'object'
        && typeof d.componentFonts === 'object' && typeof d.themeDarkSeparate === 'boolean';
    })());
  check('测试夹具与 settings 同口径：脏值照样丢、合法值照样留',
    canon(schema.sanitizeFontset({ themeSize: { 'markdown-h1': 24, 'markdown-h2': 4 } }).themeSize)
      === canon({ 'markdown-h1': 24 }));
  check('令牌层边界也有第二道防护（getter 取值 + 订阅回调各自收异常）',
    /\(selection\.themeColors \|\| \{\}\)/.test(clientCode)
    && /\(selection\.themeSize \|\| \{\}\)/.test(clientCode)
    && /\(selection\.themeWeight \|\| \{\}\)/.test(clientCode)
    && /\(selection\.themeFamily \|\| \{\}\)/.test(clientCode)
    && /try \{ if \(layer\) layer\.sync\(\); if \(typeLayer\) typeLayer\.sync\(\); \} catch/.test(clientCode));

  // 7e. 通道自身的三条结构契约（与宿主端 ⑤ 的行为判据配对）。
  check('通道：载入用**一次** Object.assign 整套采用（不是逐键赋值）',
    /Object\.assign\(selection, values\)/.test(storeSrc));
  check('通道：脏标记重试与在途 GET 竞态守卫都在（与设置同形）',
    /fontSetDirty = !res\.ok/.test(storeSrc) && /fontSetWrites === writesAtStart/.test(storeSrc));
  check('通道：写目标 = 活动 id，未知时退回迁移产物 id（两端同一个字面量，来自共享内核）',
    /activeFontSetId \|\| FONTSET_MIGRATED_ID/.test(storeSrc)
    && schema.FONTSET_MIGRATED_ID === 'default');
  check('通道：缓存键与设置缓存分开（两条真源不互相顶掉）',
    /FONTSET_CACHE_KEY = "we-fontset-active"/.test(storeSrc)
    && !/dsh-wallpaper-engine:selection/.test(storeSrc));
  check('通道：绝不碰 settings 那条路由（两条通道不交叉）',
    !/\/settings/.test(strip(storeSrc)));

  // 7g. **半对丢弃防线**（2026-10-06 用户反馈"重启后保存的自定义颜色没了"的根因之一）：
  //     深浅分开只填一边 ⇒ {light:'',dark:'#x'} 半对。半对过不了任何一层消毒
  //     （readThemeColors / buildTokenPayload 都是"缺一套整角色丢弃"）⇒ 颜色落不了盘、
  //     也不生效，面板却显示着已选 —— 重启后"没了"。修法 = onThemeColor 在 separate
  //     分支把空的那一侧补齐（官方色优先、取不到退回同色），pair 永远完整。
  {
    const onThemeColorBody = (clientCode.match(/const onThemeColor = \(role, mode, hex, separate\) => \{[\s\S]*?\n\};/) || [''])[0];
    check('onThemeColor 的 separate 分支把空的另一侧补齐（半对进不了消毒黑洞）',
      onThemeColorBody.includes('const other = mode === "light" ? "dark" : "light";')
      && /next\[other\] = \(tokens && officialColorOf\(tokens\)\) \|\| hex;/.test(onThemeColorBody),
      onThemeColorBody.includes('officialColorOf') ? '已补齐' : '缺补齐分支');
    check('负对照：补齐分支只挂在 separate 下（不分开的两态同色路径不受影响）',
      Boolean(onThemeColorBody) && onThemeColorBody.indexOf('if (separate) {') < onThemeColorBody.indexOf('const other =')
      && /else \{ next\.light = hex; next\.dark = hex; \}/.test(onThemeColorBody));
    check('行为级：半对确实会被消毒整角色丢弃（这条判据是上面补齐分支存在的理由）',
      (() => {
        const half = schema.sanitizeFontset({ themeColors: { primary: { dark: '#112233' } } }).themeColors;
        const full = schema.sanitizeFontset({ themeColors: { primary: { light: '#112233', dark: '#112233' } } }).themeColors;
        return !('primary' in half) && ('primary' in full);
      })());
  }

  // 7h. **回滚防线**（同一反馈的另一根因）：缓存带跨重启的脏标记 —— 上次落盘失败
  //     （宿主没重挂 / 退出太快 / 任何非 2xx）时，重启后的加载不得拿宿主旧值把
  //     "用户屏幕上最后的所见"静默回滚：宿主值 ≠ 脏缓存 ⇒ 采纳缓存并立即补推。
  {
    check('缓存形状带 dirty（writeFontSetCache 三参；readCachedFontSet 返回 dirty）',
      /function writeFontSetCache\(id, values, dirty\)/.test(storeSrc)
      && /dirty: doc\.dirty === true/.test(storeSrc));
    check('写缓存即标脏、PUT 成功转净（两个方向的写入点都在）',
      /writeFontSetCache\(activeFontSetId \|\| FONTSET_MIGRATED_ID, pickFontValues\(\), true\)/.test(storeSrc)
      && /writeFontSetCache\(id, values, false\)/.test(storeSrc));
    check('loadFontSet 有回滚防线：脏缓存 ≠ 宿主值 ⇒ 采纳缓存 + 立即补推',
      /const cachedNewer = Boolean\(cached && cached\.dirty && cached\.id === id/.test(storeSrc)
      && /Object\.assign\(selection, cached\.values\)/.test(storeSrc)
      && /activeFontSetValues = canonicalFontValues\(cached\.values\);/.test(storeSrc)
      && /scheduleFontSet\(\); \/\/ 补推/.test(storeSrc));
    check('负对照：合成"没有脏标记判定"的加载体会被同一判据判出',
      (() => {
        const bad = storeSrc.replace(/const cachedNewer = Boolean\(cached && cached\.dirty && cached\.id === id[\s\S]*?scheduleFontSet\(\); \/\/ 补推/, 'Object.assign(selection, values)');
        return /const cachedNewer = Boolean\(cached && cached\.dirty && cached\.id === id/.test(bad) === false
          || !/scheduleFontSet\(\); \/\/ 补推/.test(bad);
      })());
    check('负对照 2：缓存不脏（正常关停）时必须走宿主为准的原路径（行为逐字节不变）',
      /cached\.dirty && cached\.id === id/.test(storeSrc)
      && !/Object\.assign\(selection, cached\.values\);[^{}]*writeFontSetCache\(id, values\)/.test(storeSrc));
  }

  // 7f. 失败文案：**裸状态码 = 请求没到本族**（**实测**形态：前端是新的、宿主是旧的时，
  // 请求落到 SPA 兜底 —— GET 裸 404 / 非 GET 裸 405、都没有信封）。
  // 两条约定缺一不可：① 请求一律 `parse:'always'`（否则读不到宿主的 `{ error }`）；
  // ② 失败一律经 `fontSetFailureReason`（否则用户只看到"宿主返回 404"）。
  const storeCode = strip(storeSrc);
  check('通道：**所有**请求走 fsFetch/fsJson（⇒ 一律 parse:\'always\'，读得到宿主的 { error }）',
    /const fsFetch = \(path, options\) => apiFetch\(path, Object\.assign\(\{ parse: "always" \}/.test(storeSrc)
    && !/\bapiFetch\(/.test(storeCode.replace(/const fsFetch[\s\S]{0,120}?\n/, ''))
    && !/\bapiJson\(/.test(storeCode.replace(/const fsJson[\s\S]{0,140}?\n/, '')),
    '通道内裸 apiFetch/apiJson 应为零');
  check('通道：失败文案只走 fontSetFailureReason（裸 404/405 必须被翻译成可判定的话）',
    /function fontSetFailureReason\(res\)/.test(storeSrc)
    && !/=\s*hostFailureReason\(/.test(storeCode)
    && (storeCode.match(/=\s*fontSetFailureReason\(/g) || []).length >= 7,
    (storeCode.match(/=\s*fontSetFailureReason\(/g) || []).length + ' 处');
  check('负对照：裸状态码的判据本身有牙（有信封 ⇒ 不翻译；无信封 ⇒ 翻译）',
    (() => {
      const bare = { status: 404, data: null };
      const wrapped = { status: 404, data: { error: 'not found' } };
      const isBare = (res) => (!res || !res.data || typeof res.data !== 'object' || !res.data.error)
        && (res.status === 404 || res.status === 405);
      return isBare(bare) === true && isBare(wrapped) === false && isBare({ status: 500, data: null }) === false;
    })());
}

/**
 * 字体集清单夹具（⑧ 的面板渲染与 ⑨ 的编辑器驱动共用）。四行刚好覆盖四种形态：
 * 随包（活动）· 我的 · 我的（覆盖了随包）· 我的（读不懂）。负对照靠换掉其中一行。
 */
const FONTSET_ROWS = [
  { id: 'compact', name: '紧凑', origin: 'builtin', active: true },
  { id: 'mine', name: '我的集', origin: 'user', active: false },
  { id: 'over', name: '紧凑', origin: 'user', active: false, overrides: true },
  { id: 'bad', name: '坏掉的一份', origin: 'user', active: false, broken: 'bad-version' },
];

// ── ⑧ 面板渲染回归（"点『字体自定义』白屏"）──────────────────────────────────
// 崩溃形状（已实测复现）：`renderAppearanceTab` 里配色区**只在总开关打开时渲染**，
// 而它读 `sel.themeColors[role.id]` —— 那些键已不在 settings 白名单里，若 selection 初始化
// 没给兜底、字体集又还没载入，这个下标就是 `undefined['primary']` ⇒ React 渲染期抛 ⇒ 整个面板崩。
// 本段直接渲染那个页签（面板模块 + 真角色表 + client.js 的助手 stub），把"渲染得出"钉成判据。
section('⑧ 面板渲染回归（配色区在总开关打开时必须渲染得出）');{
  const clientSrc = readFileSync(join(root, 'src', 'client.js'), 'utf8');
  const panelMod = await import(pathToFileURL(join(root, 'src', 'panel-tabs.js')).href);
  const ReactStub = {
    Fragment: 'Fragment', useState: (i) => [i, () => {}], useEffect: () => {}, useRef: (v) => ({ current: v }),
    createElement: (t, p, ...c) => { assertChildren(c); return typeof t === 'function' ? t(p || {}, ...c) : { type: t, props: p || null, children: c }; },
  };
  const noop = () => null;
  const same = (g, k, v) => { if (!(k in g)) g[k] = v; };
  // 面板求值参数时会调到的 prelude 助手：从 client.js 的顶层声明自动补（新加一个助手也不会让本段假红）。
  for (const m of clientSrc.matchAll(/^function ([a-zA-Z_$][\w$]*)\(/gm)) same(globalThis, m[1], noop);
  for (const m of clientSrc.matchAll(/^const ([A-Za-z_$][\w$]*) = ([^\n]+)$/gm)) {
    if (m[1] in globalThis) continue;
    try { globalThis[m[1]] = (0, eval)('(' + m[2].replace(/;$/, '') + ')'); } catch { /* 非字面量：留给下面兜 */ }
  }
  for (const m of clientSrc.matchAll(/\b([A-Z][A-Z0-9_]{3,})\b/g)) same(globalThis, m[1], []);
  same(globalThis, 'React', ReactStub);
  same(globalThis, 'document', {
    getElementById: () => null, querySelector: () => null, head: { appendChild() {} },
    createElement: () => ({ style: {} }), body: { style: {} }, documentElement: { style: {} },
  });
  same(globalThis, 'window', {});
  same(globalThis, 'localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
  // ⚠️ 角色/族表必须是**真的**：给空数组会把要复现的那一行 map 掉（那样两条判据都会"不抛"）。
  // 做法：把面板会用到的那几个 prelude 模块的**全部导出**映成全局 —— 逐个列举常量会漏
  // （漏一个就是 "X is not defined" 的假红，而不是被判据抓到）。
  const colorRoles = await import(pathToFileURL(join(root, 'src', 'font', 'color-roles.js')).href);
  const preludeMods = [
    colorRoles,
    await import(pathToFileURL(join(root, 'src', 'font', 'typography.js')).href),
    await import(pathToFileURL(join(root, 'src', 'font', 'components.js')).href),
    await import(pathToFileURL(join(root, 'src', 'font', 'apply.js')).href),
    await import(pathToFileURL(join(root, 'src', 'we-cond.js')).href),
    // 面板会调 `renderFontSetEditor(...)`（在 bundle 里是同作用域的内联模块；独立 import 时
    // 得把它映成全局，否则 ⑧ 会以 "is not defined" 的形式假红）。
    await import(pathToFileURL(join(root, 'src', 'fontset-editor.js')).href),
    // 同理（wip §10.13）：「玻璃 UI」节的渲染器已抽到 `src/glass-panel.js`，
    // `panel-tabs.js` 里对它的调用只在**打包后**同作用域 ⇒ 这里也要映成全局。
    await import(pathToFileURL(join(root, 'src', 'glass-panel.js')).href),
    // 面板还会调 `filterUsableSystemFonts(...)`（本机字体那道"本浏览器能否匹配"的筛，同一条理由）。
    await import(pathToFileURL(join(root, 'src', 'system-fonts.js')).href),
    schema,
  ];
  for (const mod of preludeMods) for (const [k, v] of Object.entries(mod)) globalThis[k] = v;
  check('前置：夹具不是空转的（角色表非空，且配色区确实按角色遍历）',
    colorRoles.THEME_COLOR_ROLES.length >= 5
    && /THEME_COLOR_ROLES\.map/.test(readFileSync(join(root, 'src', 'panel-tabs.js'), 'utf8')),
    colorRoles.THEME_COLOR_ROLES.length + ' 个角色');

  /** 面板 ctx：只求"渲染得出"，处理器全 noop。`over.sel` 换夹具（负对照用）。 */
  const panelSel = (over) => Object.assign({
    ...schema.sanitizeFontset({}), // ← 正是 client.js 初始化展开的那份兜底
    fontCustom: true, fontAdvanced: false, themeTypeOnly: false,
    wallpaperBlur: 0, blur: 0, scrim: 0, border: 0, accent: '', caretColor: '',
    glassAlpha: 0, glassColor: '', glassWindow: true, sidebarGlass: true, sidebarBlur: 0,
    sidebarAlpha: 0, sidebarColor: '', sidebarContentAlpha: 0, sidebarContentColor: '',
    sidebarPresent: false, id: 'v', type: 'video',
  }, over || {});
  const panelCtx = (sel) => {
    // `fontSet` 是 F3 阶段 3 的子分支 ctx：面板会**求值** `fontSet.open`（switchRow 的参数）
    // ⇒ 少了它照样抛。这里给一份"打开着"的最小 ctx，顺带让编辑器一并渲染（覆盖更宽）。
    const c = {
      setSetting: noop, setTransient: noop, sel,
      fontSet: {
        open: true, fontSets: FONTSET_ROWS, activeId: 'compact', loading: false, error: '',
        editingId: '', draftName: '', exportUrl: (id) => '/wallpaper-engine/fontsets/' + id + '/export',
        onOpen: noop, onActivate: noop, onRefresh: noop, onDelete: noop, onEdit: noop, onDraftName: noop,
        onRenameCommit: noop, onCancelEdit: noop, onCreate: noop,
      },
    };
    for (const k of ['officialColorOf', 'onAccent', 'onBlur', 'onBorder', 'onCaretColor', 'onComponentFamily',
      'onComponentFont', 'onFontAdvanced', 'onFontResetAll', 'onGlassAlpha', 'onGlassColor', 'onSidebarAlpha',
      'onSidebarBlur', 'onSidebarColor', 'onSidebarContentAlpha', 'onSidebarContentColor', 'onThemeColor',
      'onThemeColorClear', 'onThemeDarkSeparate', 'onThemeFamily', 'onThemeSize', 'onThemeTypeOnly',
      'onThemeWeight', 'onToggleFontCustom']) c[k] = noop;
    return c;
  };
  // 2026-10-09 真迁移：字体节**只在侧栏档渲染**（设置页对话框挡主页面、看不到实时效果 ⇒
  // 迁侧栏），且默认收起 ⇒ 字体内容的渲染回归必须打在 `surface: 'sidebar'` + `fontOpen: true`
  // （展开）上 —— 打在缺省档上这些行根本不进树，判据会空转。
  const panelSideCtx = (sel) => Object.assign(panelCtx(sel), { surface: 'sidebar', fontOpen: true });
  const renderThrew = (sel) => {
    try { panelMod.renderAppearanceTab(panelSideCtx(sel)); return ''; } catch (e) { return String((e && e.message) || e); }
  };
  /** 面板整棵树里的文本（结构判据用）。 */
  const panelText = (sel) => {
    const out = [];
    (function walk(n) {
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n.children)) {
        out.push(...n.children.filter((c) => typeof c === 'string'));
        n.children.forEach(walk);
      }
    })(panelMod.renderAppearanceTab(panelSideCtx(sel)));
    return out.join(' | ');
  };
  const panelTables = (sel) => (function walk(n, acc = []) {
    if (Array.isArray(n)) { n.forEach((x) => walk(x, acc)); return acc; }
    if (!n || typeof n !== 'object') return acc;
    if (n.type === 'table') acc.push(n);
    if (Array.isArray(n.children)) n.children.forEach((x) => walk(x, acc));
    return acc;
  })(panelMod.renderAppearanceTab(panelSideCtx(sel)), []);
  check('总开关打开 + 客户端那份兜底值 ⇒ 外观页签渲染得出（修复前这里是崩溃点）',
    renderThrew(panelSel()) === '', renderThrew(panelSel()) || 'ok');
  const missing = renderThrew(panelSel({ themeColors: undefined }));
  check('配对项：缺 themeColors 时**确实会抛**（证明上一条不是恒真）',
    missing !== '', missing || '没抛 —— 夹具可能把那一行空转了，本段必须重写');

  // ── 语义：字体集是「字体自定义」的**附属** ────────────────────────────────────
  // 判据认**编辑器自己那张表**（表头「操作」），不认文案 —— 本段的 harness 里 `switchRow` /
  // `ctlText` 是 noop（只求"渲染得出"），拿标签文字去判会**空转**：两种情况下都找不到。
  const treeText = (n) => {
    if (Array.isArray(n)) return n.map(treeText).join('');
    if (!n || typeof n !== 'object') return '';
    const own = Array.isArray(n.children) ? n.children.filter((c) => typeof c === 'string').join('') : '';
    const kids = Array.isArray(n.children) ? n.children.map(treeText).join('') : '';
    return own + kids;
  };
  const hasFontSetTable = (sel) => panelTables(sel).some((tb) => treeText(tb).includes('操作'));
  check('字体集是「字体自定义」的附属：关掉总开关 ⇒ 面板里没有字体集那张表',
    !hasFontSetTable(panelSel({ fontCustom: false, fontSetOpen: true })), 'fontCustom=false');
  check('负对照：打开总开关 ⇒ 表必须在（证明上一条不是空转）',
    hasFontSetTable(panelSel({ fontCustom: true, fontSetOpen: true })), 'fontCustom=true');

  // ── 语义：「只看改过的」默认开 + 筛完是空要有话说 ─────────────────────────────
  /** 只数**排版角色**那张表的正文行（面板里还有字体集那张表，不能一起数）。 */
  const typeRowCount = (sel) => {
    const walk = (n, acc = []) => {
      if (Array.isArray(n)) { n.forEach((x) => walk(x, acc)); return acc; }
      if (!n || typeof n !== 'object') return acc;
      if (n.type === 'tr') acc.push(n);
      if (Array.isArray(n.children)) n.children.forEach((x) => walk(x, acc));
      return acc;
    };
    const hasTd = (n) => {
      if (Array.isArray(n)) return n.some(hasTd);
      if (!n || typeof n !== 'object') return false;
      if (n.type === 'td') return true;
      return Array.isArray(n.children) && n.children.some(hasTd);
    };
    const table = panelTables(sel).find((tb) => treeText(tb).includes('角色'));
    return table ? walk(table, []).filter(hasTd).length : -1;
  };
  check('「只看改过的」默认值是**开**（defaults-only 键，改默认值就是全部改动）',
    schema.DEFAULTS.themeTypeOnly === true && schema.DEFAULTS_ONLY.includes('themeTypeOnly'));
  // DEFAULTS_ONLY 的键**不在持久化白名单里** ⇒ `readPersisted()` 与本地缓存都不提供它们。
  // 少了 `panelDefaults()` 这一层，默认值就是 `undefined`：默认 false 的键靠"undefined 也假"侥幸正确，
  // **默认 true 的键会静默失效**（`themeTypeOnly` 就这样失效过一次）。
  check('DEFAULTS_ONLY 的每个键都有默认值来源，且客户端初始化里铺了这一层',
    schema.DEFAULTS_ONLY.every((k) => Object.prototype.hasOwnProperty.call(schema.panelDefaults(), k))
    && /\.\.\.panelDefaults\(\)/.test(clientSrc),
    schema.DEFAULTS_ONLY.length + ' 个键');
  check('默认开 + 一行都没改过 ⇒ 表是空的，但**有专门一行提示**（不是让人以为表坏了）',
    panelText(panelSel({ themeTypeOnly: true })).includes('没有改过的角色')
    && typeRowCount(panelSel({ themeTypeOnly: true })) === 0,
    'rows=' + typeRowCount(panelSel({ themeTypeOnly: true })));
  check('负对照：关掉「只看改过的」⇒ 全表回来、提示消失（判据不是恒真）',
    !panelText(panelSel({ themeTypeOnly: false })).includes('没有改过的角色')
    && typeRowCount(panelSel({ themeTypeOnly: false })) >= 10,
    typeRowCount(panelSel({ themeTypeOnly: false })) + ' 行');

  // ── 语义：「恢复默认」不动「只看改过的」 ──────────────────────────────────────
  // 那是**视图**状态：重置清的是字体值，不该顺手把用户选的筛选也翻掉。
  check('「恢复默认」的函数体里不出现 themeTypeOnly（视图状态不归它管）',
    (() => {
      const body = (/const onFontResetAll = \(\) => \{([\s\S]*?)\n  \};/.exec(clientSrc) || [])[1] || '';
      const negControl = 'selection.themeTypeOnly = false;\n' + body;
      return body.length > 0 && !/themeTypeOnly/.test(body)
        && /themeTypeOnly/.test(negControl); // 负对照：同一判据对"改前那版"会判红
    })(), '判据非空转（拿改动前那份函数体试过）');

  // ── surface 档（设置页 / 侧栏共用同一批渲染器）──────────────────────────────
  // 快捷播放面板的「外观」页用的就是这个渲染器。分档口径（ADR-0008 D4，2026-10-09 修订）：
  // **节**层面「全局字体」**只在侧栏档画**（真迁移：设置页对话框挡主页面、调完看不到实时
  // 效果；侧栏里它默认收起 —— 节头在、内容收，见 panelSideCtx 的展开态判据）；**行**层面
  // 侧栏档还少画预设方案（由 glass-panel 的 `!sidebarSurface` 门与 quick-panel 的占位器管，
  // 玻璃高级行则收在侧栏「详细玻璃调节」折叠块 —— 判据见 verify-scene-live）。本块两件事
  // 必须同时成立：① **缺省档（设置页）与显式 "settings" 逐字相同** —— 属性打错时设置页会
  // 静默变形，源码级判据看不出来；② 两档的节集合各就各位（设置页无字体节、侧栏有）。
  // 判据取**节标题**（那些 span 是真渲染的）：本 harness 的 switchRow / ctlText 是 noop，
  // 行标签拿不到，拿它判会空转。
  const pickSurface = (sel, s) => {
    const c = panelCtx(sel);
    if (s) c.surface = s;
    return panelMod.renderAppearanceTab(c);
  };
  const shapeOf = (n, acc = []) => {
    if (Array.isArray(n)) { n.forEach((x) => shapeOf(x, acc)); return acc; }
    if (!n || typeof n !== 'object') { if (n !== null && n !== undefined) acc.push(String(n)); return acc; }
    if (typeof n.type === 'string') acc.push(n.type + '.' + ((n.props && n.props.className) || ''));
    if (Array.isArray(n.children)) n.children.forEach((x) => shapeOf(x, acc));
    return acc;
  };
  check('外观页 surface 缺省与 "settings" 逐字相同（设置页形态一个节点不少）',
    shapeOf(pickSurface(panelSel())).join('|') === shapeOf(pickSurface(panelSel(), 'settings')).join('|'));
  const sideText = treeText(pickSurface(panelSel(), 'sidebar'));
  const setText = treeText(pickSurface(panelSel(), 'settings'));
  // ⚠️ 侧栏档的「全局字体」**节头**始终在（折叠只收内容、不收节 —— 收起时它就是"展开入口"）。
  //    所以这里判的是节**集合**；"收起时内容不进树"由上面 panelSideCtx 的展开态判据负对照。
  check('设置页档不画「全局字体」一节（2026-10-09 真迁移；主题 / 细节 / 玻璃 UI / 输入光标照旧）',
    !setText.includes('全局字体') && setText.includes('主题') && setText.includes('细节')
      && setText.includes('玻璃 UI') && setText.includes('输入光标')
      && !setText.includes('窗口与侧栏'));
  check('负对照：侧栏档「全局字体」必须在（节头 —— 证明上一条不是空转）',
    sideText.includes('全局字体') && sideText.includes('输入光标') && !sideText.includes('窗口与侧栏'));

  // 播放页（renderEffectsTab）同理：侧栏档少画「准备与诊断」那一组。
  // 本 harness 里 ctlText / SliderRow / switchRow 是 noop ⇒ 只有**直接 createElement 出来的
  // 文本**看得见（节标题、段控档位按钮、空态按钮）。所以判据取段控档位（帧率上限那串
  // 「无限制 / 24fps…」）—— 它在设置页档有、侧栏档没有；而倍速 / 适配两边都在。
  same(globalThis, 'gpuFrameUi', { wid: '', pinned: false, w: 0, h: 0, busy: false, recapturing: false, error: '' });
  same(globalThis, 'FPS_CAP_VALUES', (schema.FPS_CAP_VALUES || [0, 24, 30, 60]));
  const effectsCtx = (sel, s) => {
    const c = { setSetting: noop, setTransient: noop, sel };
    for (const k of ['onBackgroundBrightness', 'onBackgroundContrast', 'onBackgroundSaturate',
      'onClearCustomFrame', 'onClearGpuFrame', 'onCustomFrameFile', 'onRecaptureGpuFrame',
      'onRefreshFrame', 'onScrim', 'onWallpaperBlur', 'onWallpaperOpacity', 'onPickWallpaper']) c[k] = noop;
    if (s) c.surface = s;
    return c;
  };
  const fxShape = (sel, s) => shapeOf(panelMod.renderEffectsTab(effectsCtx(sel, s))).join('|');
  const videoSel = panelSel({ type: 'video' });
  check('播放页 surface 缺省与 "settings" 逐字相同（设置页形态一个节点不少）',
    fxShape(videoSel) === fxShape(videoSel, 'settings'));
  check('侧栏档少掉的正是「准备与诊断」（帧率上限档位在设置页档、不在侧栏档）',
    fxShape(videoSel, 'settings').includes('无限制') && !fxShape(videoSel, 'sidebar').includes('无限制')
      && fxShape(videoSel, 'sidebar').includes('2x') && fxShape(videoSel, 'sidebar').includes('覆盖'),
    '侧栏档保留：倍速 + 适配');
  check('侧栏档空态 CTA =「去挑一张 ›」（设置页档照旧是「选择壁纸」）',
    fxShape(panelSel({ id: '', type: '' }), 'sidebar').includes('去挑一张 ›')
      && fxShape(panelSel({ id: '', type: '' }), 'settings').includes('选择壁纸')
      && !fxShape(panelSel({ id: '', type: '' }), 'sidebar').includes('选择壁纸'));
}

// ── ⑨ 字体集编辑器（面板驱动）────────────────────────────────────────────────
// 面板是**纯渲染**（src/fontset-editor.js）⇒ 挂载台给一组记录用的回调，就能把
// "哪个按钮对应哪个意图""删除有没有过 confirm"钉成行为判据（同 verify-picker-props 的手法）。
section('⑨ 字体集编辑器（面板可驱动：意图映射 / confirm 门控 / 来源与用法规则）');
{
  const editorMod = await import(pathToFileURL(join(root, 'src', 'fontset-editor.js')).href);
  const R = {
    Fragment: 'Fragment', useState: (i) => [i, () => {}], useEffect: () => {}, useRef: (v) => ({ current: v }),
    createElement: (t, p, ...c) => { assertChildren(c); return typeof t === 'function' ? t(p || {}, ...c) : { type: t, props: p || null, children: c }; },
  };
  globalThis.React = R;
  // ctlText 要**看得见文案**（本段要断来源标记）⇒ 别用 ⑧ 那份 noop。
  globalThis.ctlText = (label, hint) => ({
    type: 'span', props: { className: 'we-picker__ctl-text', title: hint || '' }, children: [label],
  });
  const nodes = (root) => {
    const out = [];
    (function walk(n) {
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (!n || typeof n !== 'object') return;
      if (n.type) out.push(n);
      if (Array.isArray(n.children)) n.children.forEach(walk);
    })(root);
    return out;
  };
  const textOf = (n) => (Array.isArray(n.children) ? n.children.filter((c) => typeof c === 'string').join('') : '');
  const allText = (tree) => nodes(tree).map(textOf).join(' | ');
  const buttons = (tree) => nodes(tree).filter((n) => n.type === 'button');
  const buttonWith = (tree, label) => buttons(tree).find((n) => textOf(n) === label);
  const rowOf = (tree, text) => nodes(tree).filter((n) => n.type === 'tr').find((r) => allText(r).includes(text));
  const render = (over) => {
    const calls = [];
    const ctx = Object.assign({
      fontSets: FONTSET_ROWS, activeId: 'compact', inUseId: 'compact', loading: false, error: '',
      editingId: '', draftName: '', armedId: '',
      exportUrl: (id) => '/wallpaper-engine/fontsets/' + id + '/export',
      onActivate: (id) => calls.push(['activate', id]),
      onRefresh: () => calls.push(['refresh']),
      onDelete: (id) => calls.push(['delete', id]),
      onArm: (id) => calls.push(['arm', id]),
      onDisarm: () => calls.push(['disarm']),
      onEdit: (id) => calls.push(['edit', id]),
      onDraftName: (v) => calls.push(['draft', v]),
      onRenameCommit: (id) => calls.push(['rename', id]),
      onCancelEdit: () => calls.push(['cancel']),
      onCreate: () => calls.push(['create']),
      onImport: (f) => calls.push(['import', f]),
    }, over || {});
    return { tree: editorMod.renderFontSetEditor(ctx), calls };
  };

  const t = render().tree;
  // 「来源」不再露出（真机反馈）：随包 / 用户层是**实现细节**，用户面对的只是"一份份字体集"。
  // 判据是**结构性**的（整整少了一列），不是"文案里别出现某个词"那种容易绕过的写法。
  const ths = nodes(t).filter((n) => n.type === 'th');
  const bodyRows = nodes(t).filter((n) => n.type === 'tr' && nodes(n).some((c) => c.type === 'td'));
  // 用**节点文本**而不是"格子文本"：徽标是一枚 span，直接读格子的字符串子节点会读成空 ⇒ 判据空转。
  const nodeTexts = nodes(t).map(textOf).filter(Boolean);
  check('界面上不露来源：表头 2 列、每行 2 格，且没有任何一枚节点是「随包」/「我的」/「已修改」',
    ths.length === 2 && bodyRows.length === FONTSET_ROWS.length
    && bodyRows.every((r) => nodes(r).filter((c) => c.type === 'td').length === 2)
    && !nodeTexts.includes('随包') && !nodeTexts.includes('我的')
    && !/随包|已修改|来源/.test(allText(t)),
    '表头 ' + ths.length + ' 列 / 正文 ' + bodyRows.length + ' 行 / 节点文本 ' + nodeTexts.length + ' 条');
  check('负对照：这条判据抓得到"还留着一枚来源徽标"，且不会把名字里的「我的」误判成徽标',
    (() => {
      const hasBadge = (texts) => texts.includes('随包') || texts.includes('我的');
      return hasBadge(['紧凑', '随包']) === true
        && hasBadge(['紧凑', '我的字体集']) === false
        && hasBadge(['我的']) === true;
    })());
  check('活动行标「（使用中）」', allText(t).includes('（使用中）'));
  // 「使用中」的判据是**值仍然一致**（`inUseId`），不是"宿主指针指着它"：手动改过字体值 ⇒
  // 标记换成「（已改）」（凭空消失会让人以为出错）。`activeId` 仍按指针给能力判定。
  check('值被改过 ⇒ 不再是「使用中」，同一行换成「（已改）」',
    (() => {
      const drifted = render({ inUseId: '' }).tree;
      return !allText(drifted).includes('（使用中）') && allText(drifted).includes('（已改）');
    })());
  check('指针与标记分开：漂移时活动集那一行**仍然删不掉**（能力判定只认指针）',
    (() => {
      // 用户层的活动集（'mine'）：漂移与否都不该出删除按钮 —— 宿主会拒"删活动集"，界面不摆这种按钮。
      const tree = render({ activeId: 'mine', inUseId: '' }).tree;
      const mineRow = nodes(tree).filter((n) => n.type === 'tr' && nodes(n).some((c) => c.type === 'td'))
        .find((r) => allText(r).includes('我的集'));
      return Boolean(mineRow) && !buttons(mineRow).some((b) => textOf(b) === '删除')
        && allText(tree).includes('（已改）');
    })());
  // 本段的**牙齿**：能力判定没被一起删掉 —— `origin` / `overrides` 仍在用来决定
  // "能不能删、删下去是什么语义"，只是这些话不再显示来源。
  check('被改过的那一行删除按钮 =「恢复原样」（只说效果：改动没了、回到原本的样子）',
    Boolean(buttonWith(t, '恢复原样'))
    && !/随包/.test(allText(rowOf(t, '紧凑'))));
  check('未改过的用户层那两行仍然是「删除」（标签仍按语义分叉，不是一刀切）',
    buttons(t).filter((b) => textOf(b) === '删除').length === 2,
    buttons(t).map(textOf).join(','));
  const badRow = rowOf(t, '坏掉的一份');
  check('读不懂的行：给可判定原因、禁掉「使用」与「重命名」，但**保留删除**（唯一的出路）',
    Boolean(badRow) && allText(badRow).includes('无法读取：bad-version')
    && !buttons(badRow).some((b) => textOf(b) === '使用')
    && !buttons(badRow).some((b) => textOf(b) === '重命名')
    && buttons(badRow).some((b) => textOf(b) === '删除'));
  const link = nodes(t).filter((n) => n.type === 'a').find((a) => String(a.props.href).includes('/fontsets/compact/export'));
  check('导出是普通链接、指向宿主导出路由（带 attachment 头那条），不是 blob',
    Boolean(link) && link.props.download === 'compact.json', link ? String(link.props.href) : '没有导出链接');
  // 「重命名」是 <button>、「导出」是 <a>：两者**必须同一枚类名**，而且那枚类名必须把两种元素的
  // 盒子都说全 —— 否则 <a> 默认 inline（**行内盒忽略 height**）、content-box、不继承字体、
  // 还带下划线 ⇒ 两枚按钮大小不一（真机反馈过）。
  const btnClass = String((buttonWith(t, '重命名') || {}).props ? buttonWith(t, '重命名').props.className : '');
  const linkClass = String((link || {}).props ? link.props.className : '');
  check('「重命名」与「导出」挂的是同一枚类名（样式没有第二条来源）',
    btnClass !== '' && btnClass === linkClass && btnClass.includes('we-picker__btn'),
    btnClass + ' vs ' + linkClass);
  const btnRule = (/\.we-picker__btn\s*\{([\s\S]*?)\}/.exec(readFileSync(join(root, 'src', 'styles.js'), 'utf8')) || [])[1] || '';
  const boxDecl = (txt) => ({
    'display:inline-flex': /display:\s*inline-flex/.test(txt),
    'box-sizing:border-box': /box-sizing:\s*border-box/.test(txt),
    'font:inherit': /font:\s*inherit/.test(txt),
    'line-height:1': /line-height:\s*1\s*[;}]/.test(txt),
    'text-decoration:none': /text-decoration:\s*none/.test(txt),
  });
  check('该类名把两种元素的盒子都说全（display / box-sizing / font / line-height / text-decoration）',
    Object.values(boxDecl(btnRule)).every(Boolean),
    JSON.stringify(Object.entries(boxDecl(btnRule)).filter(([, ok]) => !ok).map(([k]) => k)) || '全在');
  check('负对照：同一判据对改动前那条规则会判红（证明它不是恒真）',
    !Object.values(boxDecl('.we-picker__btn { cursor: pointer; height: var(--we-ui-h, 30px);'
      + ' line-height: calc(var(--we-ui-h, 30px) - 2px); padding: 0 12px; white-space: nowrap; }')).every(Boolean),
    '旧规则缺 display / box-sizing / font / text-decoration');

  check('「使用」把该行 id 交给 onActivate（逐行）',
    (() => {
      const r = render();
      buttons(r.tree).filter((b) => textOf(b) === '使用').forEach((b) => b.props.onClick());
      return JSON.stringify(r.calls) === JSON.stringify([['activate', 'mine'], ['activate', 'over']]);
    })(), '（顺序 = 非活动且非坏的那两行）');
  check('负对照：换掉夹具里的 id ⇒ 收到的就是新 id（判据不是恒真）',
    (() => {
      const r = render({ fontSets: [{ id: 'zzz', name: '别的', origin: 'user', active: false }] });
      buttons(r.tree).filter((b) => textOf(b) === '使用').forEach((b) => b.props.onClick());
      return JSON.stringify(r.calls) === JSON.stringify([['activate', 'zzz']]);
    })());
  check('「新建（以当前外观）」交给 onCreate（**不带名字** —— 名字由客户端生成、随时可重命名）',
    (() => {
      const r = render();
      const createBtn = buttonWith(r.tree, '新建（以当前外观）');
      if (createBtn) createBtn.props.onClick();
      return JSON.stringify(r.calls) === JSON.stringify([['create']]);
    })(), '面板不再先问一句名字');
  check('面板里**没有**"新字体集名称"输入框：非编辑态零个文本输入；编辑态恰好一个（重命名用）',
    (() => {
      const textInputs = (sel) => nodes(sel).filter((n) => n.type === 'input'
        && String((n.props || {}).type || '') === 'text').length;
      const idle = textInputs(render().tree);
      const editing = textInputs(render({ editingId: 'mine', draftName: '旧名' }).tree);
      // 后半句是**牙齿**：同一判据必须看得见编辑态那个输入框（否则"零个"是空转）
      return idle === 0 && editing === 1;
    })());
  // ⚠️ 口径：这一条**真跑** `src/client.js` 里的 `nextFontSetName()` —— 从源码文本里按花括号
  //    配平提取那个具名函数，喂桩执行，再对返回值断言。不许用源码 grep 代替执行：三个正则
  //    匹配不代表生成逻辑正确（把循环改成永远 `return base` 它照样绿），而「同样的清单给同样的
  //    名字」与「避开已占用」是两条**行为**契约。名字在**面板层**生成（`src/client.js` 的
  //    `createFontSet(nextFontSetName())`，编辑器侧 `onCreate` 不带参数、观测不到名字），
  //    所以只能这样跑实现。
  check('名字生成（真跑实现）：同清单同名字，且取**第一个**空位（不是"最大+1"）、空/错名字不算占用',
    (() => {
      const code = stripComments(readFileSync(join(root, 'src', 'client.js'), 'utf8'));
      const at = code.indexOf('function nextFontSetName(');
      if (at < 0) return false;
      const open = code.indexOf('{', at);
      if (open < 0) return false;
      let depth = 0, end = -1;
      for (let i = open; i < code.length; i++) {
        if (code[i] === '{') depth++;
        else if (code[i] === '}' && --depth === 0) { end = i + 1; break; }
      }
      if (end < 0) return false;
      const fn = code.slice(at, end);
      const gen = (names) => new Function('weT', 'selection', fn + '\nreturn nextFontSetName;')(
        (s) => s, { fontSets: names.map((name, i) => ({ id: 's' + i, name })) })();
      const base = '我的字体集';
      return gen([]) === base                                   // 清单里没有 ⇒ 基础名
        && gen([base]) === base + ' 2'                          // 基础名被占 ⇒ 后缀 2
        && gen([base, base + ' 2']) === base + ' 3'             // 依次往后
        && gen([base, base + ' 2', base + ' 4']) === base + ' 3'  // 取**第一个**空位（"最大+1"会给 5）
        && gen(['别的名字']) === base                             // 无关的占用不影响
        && gen([base, null, undefined, '']) === base + ' 2'      // 空/错名字不算占用（与实现里的 filter(Boolean) 一致）
        && gen([base, base + ' 2']) === gen([base, base + ' 2']); // 同清单同结果（确定性）
    })());
  check('接线（**源码形状**判据，不是行为判据）：面板新建走 createFontSet(nextFontSetName())，不先问名字',
    (() => {
      const src = readFileSync(join(root, 'src', 'client.js'), 'utf8');
      return /createFontSet\(nextFontSetName\(\)\)/.test(src);
    })());
  check('「重命名」逐行进入编辑态；编辑态下出输入框（带草稿名）+ 保存/取消，且该行不再出「重命名」',
    (() => {
      const r = render();
      buttons(r.tree).filter((b) => textOf(b) === '重命名').forEach((b) => b.props.onClick());
      const edited = render({ editingId: 'mine', draftName: '旧名' }).tree;
      const mineRow = rowOf(edited, '我的集');
      return JSON.stringify(r.calls) === JSON.stringify([['edit', 'compact'], ['edit', 'mine'], ['edit', 'over']])
        && Boolean(buttonWith(edited, '保存')) && Boolean(buttonWith(edited, '取消'))
        && !buttons(mineRow).some((b) => textOf(b) === '重命名')
        && nodes(edited).some((n) => n.type === 'input' && n.props.value === '旧名');
    })(), '顺序 = 非坏的那三行');
  // 删除是**两下**，而且**不用原生模态**：`window.confirm` 会把焦点交给它自己的窗口 ——
  // 本插件在同一个渲染页里跑，后果是壁纸按 pauseOnBlur 停住 + 渲染线程被同步阻塞（输入框
  // 收不到键）+ 回来时的 focus 事件不保证送达（只剩重载能救）。真机报过，故改成面板内确认。
  check('删除要两下：第一下只"待确认"（不发请求），第二下「确认」才发且 id 正确',
    (() => {
      const one = render();
      buttonWith(one.tree, '恢复原样').props.onClick();
      const two = render({ armedId: 'over' });
      buttonWith(two.tree, '确认').props.onClick();
      const armedTree = render({ armedId: 'over' }).tree;
      return JSON.stringify(one.calls) === JSON.stringify([['arm', 'over']])
        && JSON.stringify(two.calls) === JSON.stringify([['delete', 'over']])
        && allText(armedTree).includes('你在这份上的改动会丢掉');
    })(), '待确认那一行要把后果写在行内');
  check('「取消」撤回待确认 —— 一个字节都不发',
    (() => {
      const r = render({ armedId: 'over' });
      buttonWith(r.tree, '取消').props.onClick();
      return JSON.stringify(r.calls) === JSON.stringify([['disarm']]);
    })());
  // 待确认**独占一行**：塞进操作格里会把整行往右推（真机反馈"不美观"），也让"哪一行在问"含糊。
  // 同时**原按钮不隐藏、不换位**（置灰即可）—— 藏起来会让整行缩一下，宽度就不是恒定的了。
  check('待确认独占一行（跨 2 列、紧跟它自己那行），问句不在操作格里；原按钮**仍在原位但置灰**',
    (() => {
      const tree = render({ armedId: 'over' }).tree;
      const allRows = nodes(tree).filter((n) => n.type === 'tr'
        && nodes(n).some((c) => c.type === 'td'));
      const twoCell = allRows.filter((r) => nodes(r).filter((c) => c.type === 'td').length === 2);
      const askRow = allRows.find((r) => nodes(r).some((c) => c.type === 'td' && c.props && c.props.colSpan === 2));
      // 行名不可靠（覆盖行的名字与被覆盖的那份**同名**）⇒ 按**结构**定位：问句那行的上一行。
      const above = askRow ? twoCell.filter((r) => allRows.indexOf(r) < allRows.indexOf(askRow)).pop() : null;
      const kept = above ? buttons(above).find((b) => textOf(b) === '恢复原样') : null;
      return allRows.length === FONTSET_ROWS.length + 1
        && Boolean(askRow) && allText(askRow).includes('你在这份上的改动会丢掉')
        && Boolean(above) && !allText(above).includes('你在这份上的改动会丢掉')
        // 按钮**还在**（不隐藏）、而且被禁用 ⇒ 宽度恒定、也不会被误点第二下
        && Boolean(kept) && kept.props.disabled === true;
    })(), '行数 4 → 5；问句在下、按钮留在原位');
  check('置灰的那个按钮点了也不会再发生什么（既不重复待确认，更不会直接删）',
    (() => {
      const r = render({ armedId: 'over' });
      const allRows = nodes(r.tree).filter((n) => n.type === 'tr' && nodes(n).some((c) => c.type === 'td'));
      const twoCell = allRows.filter((x) => nodes(x).filter((c) => c.type === 'td').length === 2);
      const askRow = allRows.find((x) => nodes(x).some((c) => c.type === 'td' && c.props && c.props.colSpan === 2));
      const above = twoCell.filter((x) => allRows.indexOf(x) < allRows.indexOf(askRow)).pop();
      const kept = buttons(above).find((b) => textOf(b) === '恢复原样');
      kept.props.onClick();   // 浏览器里禁用按钮不会派发 click；这里直接调，验证**处理器自己也拦**
      return r.calls.length === 0;
    })());
  check('未待确认的行只有"待确认"入口（不会一下就把集删了）',
    (() => {
      const r = render();
      buttonWith(r.tree, '删除').props.onClick();
      return JSON.stringify(r.calls) === JSON.stringify([['arm', 'mine']]);
    })());
  check('载入中与失败态各自可见（失败给的是**原因**，不是"什么都没发生"）',
    allText(render({ loading: true }).tree).includes('正在读取字体集')
    && allText(render({ error: '宿主不可达（请求未完成）' }).tree).includes('宿主不可达（请求未完成）'));
  check('负对照：清空 error ⇒ 失败文案消失（该判据不是恒真）',
    !allText(render({ error: '' }).tree).includes('字体集不可用'));

  // ── ⑩ 导入入口（阶段 4）────────────────────────────────────────────────────
  // 面板只做"选文件"：隐藏 input + 一个按钮去 click()（与自定义画面的导入同形）。
  // 读文件 / 校验 / 上传都在 src/fontset-store.js（那里有各自的判据），这一段只管**接线**。
  section('⑩ 导入入口（隐藏 file input + 按钮触发；读/校验/上传在通道里）');
  {
    let clicked = 0;
    const baseReact = globalThis.React;
    const storeSrc = readFileSync(join(root, 'src', 'fontset-store.js'), 'utf8');
    const editorSrc = readFileSync(join(root, 'src', 'fontset-editor.js'), 'utf8');
    // 让假 React 也调 ref 回调：`importInput` 是模块级 ref，面板靠它去 click()。
    globalThis.React = Object.assign({}, baseReact, {
      createElement: (t, p, ...c) => {
        if (p && typeof p.ref === 'function') { try { p.ref({ click: () => { clicked++; } }); } catch { /* ignore */ } }
        return baseReact.createElement(t, p, ...c);
      },
    });
    try {
      const r = render();
      const fileInput = nodes(r.tree).find((n) => n.type === 'input'
        && String((n.props || {}).accept || '').includes('.json'));
      check('有且只有一个 .json 文件选择框，且是隐藏的（选文件靠按钮触发）',
        Boolean(fileInput) && fileInput.props.style.display === 'none'
        && nodes(r.tree).filter((n) => n.type === 'input' && String((n.props || {}).accept || '').includes('.json')).length === 1);
      check('accept 只提示 .json（不把图片/音视频也列进对话框）',
        /\.json/.test(String(fileInput.props.accept)) && !/image\/|video\/|audio\//.test(String(fileInput.props.accept)),
        String(fileInput.props.accept));
      // 选中文件 ⇒ 交给 onImport（并把 input 清空：同一个文件能再选一次）
      const before = r.calls.length;
      const file = { name: '我的字体集.json' };
      const evt = { target: { files: [file], value: 'C:\\fakepath\\x.json' } };
      fileInput.props.onChange(evt);
      check('选中文件 ⇒ 交给 onImport（同一份文件可重复选：input 值被清空）',
        r.calls.length === before + 1 && r.calls[before][0] === 'import' && r.calls[before][1] === file
        && evt.target.value === '', JSON.stringify(r.calls.slice(before)));
      check('负对照：没有选中文件时不触发（取消对话框不该报错、也不该发请求）',
        (() => {
          const r2 = render();
          const input = nodes(r2.tree).find((n) => n.type === 'input' && String((n.props || {}).accept || '').includes('.json'));
          const n0 = r2.calls.length;
          input.props.onChange({ target: { files: [], value: '' } });
          return r2.calls.length === n0;
        })());
      // 按钮 ⇒ click() 隐藏 input（这是真机上唯一能打开文件对话框的路）
      clicked = 0;
      const importBtn = buttonWith(r.tree, '导入字体集…');
      check('「导入字体集…」按钮存在且触发隐藏 input 的 click()',
        Boolean(importBtn) && (importBtn.props.onClick(), clicked === 1), 'clicked=' + clicked);
      // D2 的机制不被偷换：导出是**普通链接**（宿主响应头 + Electron 默认下载 = 系统「另存为」），
      // 不是 blob、也不是自己造一套保存通道。与 DSH 自己的 session-log-export 同形。
      check('导出不引入 blob 通道（D2：宿主响应头 + 普通链接）',
        !/createObjectURL|new Blob|showSaveFilePicker/.test(storeSrc + editorSrc));
      // 原生模态陷阱是**全仓**的，不只是这一处：它抢的是 document 焦点，谁用谁中招。
      // 棘轮已收到 **0**：五处破坏性动作（轮播列表 / 批量隐藏 / 移除自定义画面 / 恢复已隐藏 /
      // 删字体集）全部走同一套面板内令牌（`armConfirm` + `renderConfirmRow`，见 src/client.js）。
      // 判据写成**等号**：0 是终态，回增必须红（`<= 0` 与 `=== 0` 等价，但等号才读得出这一点）。
      const confirmFiles = ['src/client.js', 'src/panel-tabs.js', 'src/picker-modal.js',
        'src/picker-props-panel.js', 'src/media-prep.js', 'src/fontset-editor.js', 'src/fontset-store.js'];
      const confirmSites = confirmFiles.reduce(
        (n, f) => n + ((readFileSync(join(root, f), 'utf8').match(/window\.confirm\(/g) || []).length), 0);
      // 只看**代码**：注释里可以提 window.confirm（说明为什么禁用），代码里不许出现。
      const codeOnly = stripComments;
      check('编辑器里没有原生模态（**代码**里 window.confirm 零命中；注释里可以提它）',
        !/window\.confirm/.test(codeOnly(editorSrc)));
      check('棘轮（终态）：破坏性动作族的 window.confirm 代码命中数 == 0',
        confirmSites === 0, confirmSites + ' 处');
    } finally {
      globalThis.React = baseReact;
    }
  }
}

// ── teardown ────────────────────────────────────────────────────────────────
try { dispose && dispose(); } catch { /* ignore */ }
delete process.env.DSH_WE_STEAM_ROOT;
delete process.env.DSH_WE_UPLOAD_DIR;
rmSync(ISO, { recursive: true, force: true });

console.log('');
if (failed) {
  console.log(`FONTSET CHECKS FAILED — ${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`ALL FONTSET CHECKS PASSED (${passed})`);
