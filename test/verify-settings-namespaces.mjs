#!/usr/bin/env node
/**
 * verify-settings-namespaces.mjs — P1-S1「设置分区」的判据（设计 B：逻辑命名空间 + 按键合并）。
 *
 * 被钉住的八件事（每条都配**能判红的负对照**，见各节里以「负对照」开头的那些 check）：
 *   ① **注册表分区**：宿主持久键里，组件键**恰好**落在一个簇、`settingsVersion` 落 `meta`；
 *      `SETTINGS_NAMESPACES` 的键集与 `sanitizeFromSchema({}, 'host')` **逐个相等**（多一个 / 少一个都红）；
 *      簇名与顺序 == 契约 `NAMESPACE_ORDER`、无空簇、逐簇计数 == 反查表计数。
 *      （具体键数**不写死**：三处一致地增删一个设置键是正常演进，数字钉住只会制造无判别力的红。）
 *   ② **组件写路径** `/settings/<ns>`：段外键**忽略**（宿主配置一字不变）、只写本簇键、未知 ns ⇒ JSON 404、
 *      非 GET/PUT ⇒ 405、GET 回本簇视图。
 *   ③ **幂等**：同一个 body 连发两次（中间夹一次 GET）⇒ `config.json` 的 settings 段**逐字节相同**。
 *   ④ **兼容整段入口** `/settings`：含全部键的 body ≡ 旧「整段替换」（逐字节）、缺键 body ⇒ 缺键**保留**、
 *      空体 / 全是未知键的体**不触发任何写入**。
 *   ⑤ **老存档**（没有 `settingsVersion`、键也不全）放在隔离 `DSH_WE_DATA_DIR` 里 ⇒ `GET /settings`
 *      回宿主持久白名单键数的规范化快照，而 `config.json` **逐字节不变**（读不落盘）。
 *   ⑥ **装配与源码棘轮**：注册调用仍是行首形态、`/settings` 仍是一条 prefix 注册（服务裸路径与子路径）、
 *      `lib/routes/settings.js` 里既有守卫钉住的四个字面量仍在。
 *   ⑦ **客户端差分发送**（P1-S2，`src/persistence.js`）：只发改动键、按组件簇分组、无改动不发请求、
 *      CLIENT_ONLY / `settingsVersion` / `kind:'const'` 的键都不发、首启迁移与宿主不可达仍走整段入口。
 *      这一节 import **真模块本体**并把工厂作用域的名字挂到 globalThis（内联契约见 build-client.mjs）。
 *   ⑧ **刻度盲区**（P1-FIX）：组件差分 body 不带 `settingsVersion`，不能因此把 body 当"旧档"再迁移一次
 *      —— v4 的 6 个换算键（`glassAlpha` / `sidebarAlpha` / `sidebarContentAlpha` /
 *      `settingsWindowTransparency` / `floatersTransparency` / `leftSidebarTransparency`）在 v6 存档下
 *      PUT 70 必须落成 **70**；老档（缺 `settingsVersion`）的存量键只迁移**一次**（100 ⇒ 50 不是 25）、
 *      同一次 PUT 的 patch 值不被换算。⑦ 只比对字节与字符串键 ⇒ 这条缺陷落在它的盲区里。
 *
 * 为什么 ②③④ 必须打**真路由**而不是读源码：它们断言的"磁盘上到底变了哪些键"只有跑一遍才知道；
 * ⑥ 反过来只读源码，两者互补。
 *
 * 环境隔离**必须在 import lib/index.js 之前**（与 test/verify-adapter.mjs:43-69 同一套约定）：
 * 配置目录由 `DSH_WE_DATA_DIR` 决定，不隔离就会碰用户真实的那份 config.json。
 * 全程不 build、不跑 verify:all、不 commit。
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable, Writable } from 'node:stream';
import { stripComments } from './tools/js-text.mjs';
// 真源定位：`BASE`（宿主路由前缀）、`src/persistence.js`（客户端差分发送实现）、
// `registerSettingsRoutes`（路由模块的声明处 + 门面里的调用点）都不写死路径 ——
// 实现搬家时判据跟着符号走；0 处 / 多处即红（缺锚即红，不回落到默认值）。
import { locate, locateCallSites } from './tools/source-locator.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log('  ✓ ' + name + (detail ? ' — ' + detail : ''));
  else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); failed++; }
};

/** 锚点取值：锚点丢失时**由判据报红**（这里返回 null，下面的读盘会明确失败）。 */
const anchorRel = (r) => {
  check('锚点：`' + (r.symbol || r.name) + '` 在真源面里唯一命中（0 处 / 多处即红）', r.ok, r.detail);
  return r.ok ? r.hit.rel : null;
};

// ── 环境隔离（先做，再 import 门面）──────────────────────────────────────────
const ISO = join(ROOT, '.test-cache', 'settings-namespaces');
rmSync(ISO, { recursive: true, force: true });
const DATA_DIR = join(ISO, 'data');
process.env.DSH_WE_DATA_DIR = DATA_DIR;
process.env.DSH_WE_CACHE_DIR = join(ISO, 'cache');
process.env.DSH_WE_UPLOAD_DIR = join(ISO, 'uploads');
process.env.DSH_WE_STEAM_ROOT = join(ISO, 'steam');
process.env.HOME = join(ISO, 'home');
process.env.USERPROFILE = process.env.HOME;
mkdirSync(DATA_DIR, { recursive: true });

const schema = await import(pathToFileURL(join(ROOT, 'lib', 'settings-schema.js')).href);
const { configPath } = await import(pathToFileURL(join(ROOT, 'lib', 'kernel', 'data-dir.js')).href);
const CONFIG_PATH = configPath();
const hostMod = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href);
const host = hostMod.default || hostMod;
const apply = host.apply || (host.inject && host.apply);

const BASE = (() => {
  // 宿主路由前缀的**真源** = `lib/**` 里 `BASE` 的唯一声明（`export const BASE = '…'`）。
  // 原先这里手抄一份 `'/wallpaper-engine'`：宿主改前缀时判据仍拿旧字面量比对，
  // 报出来的是"路由没注册"（误导），而不是"判据的锚点过期了"。
  const hit = anchorRel(locate('BASE', { in: 'lib' }));
  const src = hit ? readFileSync(join(ROOT, hit), 'utf8') : '';
  const m = /^[ \t]*(?:export\s+)?const\s+BASE\s*=\s*'([^']*)'/m.exec(src);
  check('锚点：`BASE` 的声明处能抠出字面量（缺锚即红 —— 不回落默认前缀）',
    Boolean(m), m ? 'BASE=' + JSON.stringify(m[1]) + ' @ ' + hit : '**抠不到 `const BASE = \'…\'`**');
  return m ? m[1] : '';
})();
const SETTINGS_URL = BASE + '/settings';
/** 一次 apply()：真注册表（mock webServer 只收登记，不起 socket）。 */
const routes = [];
const dispose = apply({
  webServer: {
    register(route) { routes.push(route); return () => {}; },
    tapIndex() { return () => {}; },
  },
});
const settingsRoute = routes.find((r) => r.path === SETTINGS_URL);

// ── 收体 / 应答替身（形态抄 test/verify-adapter.mjs:191-220 与 verify-cache-dir.mjs:77-99）──
function fakeRes() {
  const state = { status: 200, headers: {}, body: Buffer.alloc(0), ended: false };
  const res = new Writable({
    write(chunk, enc, cb) {
      state.body = Buffer.concat([state.body, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]); cb();
    },
    final(cb) { state.ended = true; cb(); },
  });
  res.setHeader = (k, v) => { state.headers[k] = v; };
  res.writeHead = (s, h) => { state.status = s; if (h) Object.assign(state.headers, h); };
  Object.defineProperty(res, 'statusCode', { get: () => state.status, set: (v) => { state.status = v; } });
  res.__state = state;
  return res;
}
function fakeReqBody(url, method, obj) {
  const r = Readable.from([Buffer.from(JSON.stringify(obj))]);
  r.url = url; r.method = method;
  r.headers = { 'content-type': 'application/json' };
  return r;
}
function fakeReq(url, method) { return { url, method, headers: {} }; }
/** 等应答 end/finish —— PUT 的应答在写盘之后才发，等它就是等持久化完成。 */
async function runHandler(req) {
  const res = fakeRes();
  const done = settingsRoute.handler(req, res);
  if (done && typeof done.then === 'function') await done;
  if (!res.__state.ended) {
    await new Promise((resolveFn) => {
      const t = setTimeout(resolveFn, 8000);
      res.on('finish', () => { clearTimeout(t); resolveFn(); });
    });
  }
  return res;
}
const bodyJson = (res) => { try { return JSON.parse(res.__state.body.toString('utf8')); } catch { return null; } };
const put = async (url, obj) => bodyJson(await runHandler(fakeReqBody(url, 'PUT', obj)));
const get = async (url) => bodyJson(await runHandler(fakeReq(url, 'GET')));
const readCfg = () => JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
const settingsBytes = () => JSON.stringify(readCfg().settings);
/** 直接写一份 config（守卫自己造磁盘状态；形状与宿主落盘一致：顶层三段 + settings）。 */
const writeCfg = (settings, extra) => {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(Object.assign({ fontSetId: '', uploadDir: '', cacheDir: '' }, extra, { settings })));
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const HOST_KEYS = Object.keys(schema.sanitizeFromSchema({}, 'host'));
const NAMES = schema.SETTINGS_NAMESPACE_NAMES;
const NS = schema.SETTINGS_NAMESPACES;
const META_KEYS = schema.SETTINGS_META_KEYS;
const HOST_KEY_COUNT = HOST_KEYS.length;   // 现算：键集随 schema 演进（上游加键不该让判据变脆）
const CLIENT_ONLY_COUNT = Object.keys(schema.sanitizeFromSchema({}, 'client')).length - HOST_KEY_COUNT;
/**
 * ① 的**簇名 / 顺序契约**（唯一真源 = 这一行）：7 个簇名同时是 `/settings/<ns>` 的 URL 段，
 * 顺序是裁决文档里的登记顺序 ⇒ 改一次 = 一次可见的决策。
 * ⚠️ **每簇计数**不再是契约的一部分（task-14 的三次最小变异探针判定：数字钉住没有独有的真阳性
 * 覆盖 —— 三处一致地增删一个设置键是正常演进，却会让"数字判据"变红 = 无判别力的红）。
 * 保留的真不变量在下面 `namespaceContractProblems()` 里：簇名/顺序、无空簇、簇计数 == 反查表计数。
 */
const NAMESPACE_ORDER = ['core', 'appearance', 'mascot', 'fx', 'parallax', 'typeColor', 'media'];

if (!settingsRoute) {
  console.log('  ✗ /wallpaper-engine/settings 路由没注册 —— 后面全部判据无从谈起');
  console.log('\nSETTINGS NAMESPACE CHECKS FAILED — route missing');
  process.exit(1);
}

// ═══ ① 注册表分区对账 ═════════════════════════════════════════════════════════
console.log('\n① 注册表分区：每个宿主持久键恰属一个簇');
{
  /** 共享判据：注册表 + 白名单 → 问题清单（空 = 分区合法）。阴性对照喂它合成的坏表。 */
  const partitionProblems = (keys, registry, metaKeys) => {
    const owner = new Map();
    const bad = [];
    for (const ns of Object.keys(registry)) {
      for (const key of registry[ns]) {
        if (owner.has(key)) bad.push('duplicate:' + key); else owner.set(key, ns);
      }
    }
    for (const key of keys) {
      if (metaKeys.includes(key)) { if (owner.has(key)) bad.push('meta-overlap:' + key); continue; }
      if (!owner.has(key)) bad.push('unowned:' + key);
    }
    for (const key of owner.keys()) if (!keys.includes(key)) bad.push('extra:' + key);
    return bad;
  };
  const problems = partitionProblems(HOST_KEYS, NS, META_KEYS);
  check('① 宿主持久键无一遗漏 / 无一重复登记（数量见详情 —— 不写死会漂的数字）', problems.length === 0,
    problems.join(' ') || HOST_KEYS.length + ' 键：' + Object.keys(NS).map((ns) => ns + ':' + NS[ns].length).join(' ')
      + ' + meta ' + META_KEYS.length);
  // 负对照 1：白名单里多出一个没人登记的键 ⇒ 必须判出
  check('① 负对照：白名单里有键没被任何簇登记会被判出',
    partitionProblems([...HOST_KEYS, 'ghostKey'], NS, META_KEYS).includes('unowned:ghostKey'));
  // 负对照 2：把 meta 键也登记进一个组件簇 ⇒ 必须判出（`settingsVersion` 不许有组件路由）
  check('① 负对照：meta 键被同时登记进组件簇会被判出',
    partitionProblems(HOST_KEYS, Object.assign({}, NS, { core: [...NS.core, 'settingsVersion'] }), META_KEYS)
      .some((p) => p.startsWith('meta-overlap:')),
    '把 settingsVersion 塞进 core');
  // 负对照 3：同一个键登记进两个簇 ⇒ 必须判出（重复登记 = 两簇都能写同一个键 = M4 复现）
  check('① 负对照：同一个键登记进两个簇会被判出',
    partitionProblems(HOST_KEYS, { core: ['id'], appearance: ['id'] }, []).includes('duplicate:id'));
  // 负对照 4：白名单少一个键（注册表多出来）⇒ 必须判出
  check('① 负对照：注册表里有白名单之外的幽灵键会被判出',
    partitionProblems(HOST_KEYS, Object.assign({}, NS, { media: [...NS.media, 'ghostKey'] }), META_KEYS)
      .includes('extra:ghostKey'));

  // 逐簇计数（与裁决文 / task-3 的 7 个数字逐条对上）
  // ⚠️ 原先这里是 `NAMES.filter((ns) => NS[ns].length !== EXPECT_COUNTS[ns])`，而
  //    `EXPECT_COUNTS` **就是从 `NS` 现算的** ⇒ 那一半**恒真**（假绿：判据什么都没断言）。
  //    现在改成：簇名/顺序（契约）+ 无空簇 + **注册表计数 == 反查表计数**（两个独立面交叉），
  //    负对照喂合成坏表（下面的 5 条）。
  const namespaceContractProblems = (names, registry, hostKeys, lookup, order) => {
    const bad = [];
    if (names.join(',') !== order.join(',')) bad.push('簇名 / 顺序 ≠ 契约：[' + names.join(',') + '] vs [' + order.join(',') + ']');
    for (const ns of names) {
      const keys = registry[ns] || [];
      if (keys.length === 0) bad.push('空簇（有组件路由却没有键）：' + ns);
      const byLookup = hostKeys.filter((k) => lookup(k) === ns);
      if (keys.length !== byLookup.length) bad.push(ns + '：注册表 ' + keys.length + ' 键 ≠ 反查表 ' + byLookup.length + ' 键');
      const stray = keys.filter((k) => lookup(k) !== ns);
      if (stray.length) bad.push(ns + '：键反查不到本簇 ' + stray.join(','));
    }
    return bad;
  };
  const nsProblems = namespaceContractProblems(NAMES, NS, HOST_KEYS, schema.settingsNamespaceOf, NAMESPACE_ORDER);
  check('① 簇名/顺序 == 契约 [' + NAMESPACE_ORDER.join(' / ') + ']、无空簇、逐簇计数 == 反查表计数（三项都有牙，见负对照）',
    nsProblems.length === 0,
    nsProblems.join('；') || NAMES.map((ns) => ns + ':' + NS[ns].length).join(' ') + '（反查表逐簇相符）');
  // 负对照（调**上面同一份** namespaceContractProblems，合成坏表；每一条都能真的红）
  const LK = (k) => (k === 'id' ? 'core' : (k === 'blur' ? 'appearance' : ''));
  const OK_REG = { core: ['id'], appearance: ['blur'] };
  check('negative control ①a：簇顺序被换 ⇒ 同一条判据判红',
    namespaceContractProblems(['appearance', 'core'], OK_REG, ['id', 'blur'], LK, ['core', 'appearance']).some((p) => /顺序/.test(p)));
  check('negative control ①b：空簇 ⇒ 同一条判据判红',
    namespaceContractProblems(['core', 'appearance'], { core: ['id'], appearance: [] }, ['id', 'blur'], LK, ['core', 'appearance']).some((p) => /空簇/.test(p)));
  check('negative control ①c：注册表漏登记一个键（簇计数 ≠ 反查表计数）⇒ 同一条判据判红',
    namespaceContractProblems(['core', 'appearance'], { core: ['id'], appearance: ['blur'] },
      ['id', 'blur', 'ghostMissing'], (k) => (k === 'id' ? 'core' : 'appearance'), ['core', 'appearance'])
      .some((p) => /反查表/.test(p)));
  check('negative control ①d：键的反查归属与所在簇不符 ⇒ 同一条判据判红',
    namespaceContractProblems(['core', 'appearance'], { core: ['id'], appearance: ['id'] }, ['id'], LK, ['core', 'appearance'])
      .some((p) => /反查不到本簇/.test(p)));
  check('正对照 ①：完全合法的合成表 ⇒ 同一条判据 0 问题（判据不是恒假）',
    namespaceContractProblems(['core', 'appearance'], OK_REG, ['id', 'blur'], LK, ['core', 'appearance']).length === 0);
  const componentKeys = NAMES.flatMap((ns) => NS[ns]);
  // ⚠️ task-14 裁定：这里原先是 `componentKeys.length === 131 && HOST_KEYS.length === 132`。
  //    对 `lib/settings-schema.js` 做了三次最小变异探针，结论是**数字钉住没有独有的真阳性覆盖**：
  //      · p1 注册表多一个键（真漂移）⇒ `:155` 报 `extra:ghostKey`、`:189` 报 `注册表独有 [ghostKey]`
  //        —— 两条都**点名那个键**，比这条只报总数更具体；本行同样红。
  //      · p3 同一簇里重复登记一个键 ⇒ `:155` 报 `duplicate:audioSource`（`:189` 因 `Set` 去重而绿）
  //        —— 仍是 `:155` 更具体；本行红（但 `:155` 已覆盖）。
  //      · p2 **三处一致地删掉一个键** ⇒ `:155` / `:189` 全绿（方案自洽、无任何不一致），
  //        只有这条数字红 = **假红**：新增/删除一个设置键是正常演进，不该让判据红。
  //    ⇒ 降为**派生式**：关系照旧被钉住（重复登记造成的计数膨胀仍然红，见 p3 的判据形态），
  //      但不再写死数字（不换成另一个会漂的数字）。
  check('① 组件键合计 + meta = 宿主总数（派生式：数字不写死，见 task-14 探针）',
    componentKeys.length + META_KEYS.length === HOST_KEYS.length,
    '组件 ' + componentKeys.length + ' + meta ' + META_KEYS.length + ' vs 宿主 ' + HOST_KEYS.length);
  // 反查表不得漂移：`settingsNamespaceOf` 对每个组件键都回它的所有者
  const drift = componentKeys.filter((key) => schema.settingsNamespaceOf(key) !==
    NAMES.find((ns) => NS[ns].includes(key)));
  check('① settingsNamespaceOf 与注册表逐键一致（反查表无漂移）', drift.length === 0, drift.join(' '));
  // 键集逐个相等：`SETTINGS_NAMESPACES` ∪ meta == `sanitizeFromSchema({}, 'host')`
  const nsSet = new Set([...componentKeys, ...META_KEYS]);
  const onlyHost = HOST_KEYS.filter((k) => !nsSet.has(k));
  const onlyRegistry = [...nsSet].filter((k) => !HOST_KEYS.includes(k));
  check('① 注册表键集与 sanitizeFromSchema({}, "host") 逐个相等',
    onlyHost.length === 0 && onlyRegistry.length === 0,
    '宿主独有 [' + onlyHost.join(',') + '] 注册表独有 [' + onlyRegistry.join(',') + ']');
  check('① settingsVersion 属 meta 且不在任何有路由的簇里',
    META_KEYS.length === 1 && META_KEYS[0] === 'settingsVersion'
    && schema.settingsNamespaceOf('settingsVersion') === 'meta' && !NAMES.includes('meta'));
  check('① 未知键没有归属（不猜、不兜底）', schema.settingsNamespaceOf('__nope__') === '');
  check('① 负对照：判据对未知键的期望本身有牙（真键不为空）', schema.settingsNamespaceOf('blur') === 'appearance');

  // 显式标注落点：三类"不在宿主 settings 段里"的键必须被明确排除（而不是漏登记）
  const excluded = [
    ['CLIENT_ONLY（只住 localStorage）', schema.CLIENT_ONLY],
    ['DEFAULTS_ONLY（从不落盘）', schema.DEFAULTS_ONLY],
    ['FONTSET_KEYS（住 fontsets/<id>.json）', schema.FONTSET_KEYS],
  ];
  for (const [label, keys] of excluded) {
    const wrong = keys.filter((k) => schema.settingsNamespaceOf(k) !== '' || HOST_KEYS.includes(k));
    check(`① ${label} ${keys.length} 个键：无归属且不在宿主白名单（显式排除，不是漏登记）`,
      keys.length > 0 && wrong.length === 0, wrong.join(' ') || keys.join(','));
  }
}

// ═══ ② 组件写路径：只写本簇键 / 段外键忽略 / 未知 ns 404 / 405 ═══════════════
console.log('\n② /settings/<ns>：只写本簇键，段外键一字不动');
{
  // 夹具基准：全部默认值 + 每簇一个"与默认不同"的标记值（供下面 other 对比）
  const baseline = schema.sanitizeFromSchema({
    settingsVersion: 6, id: 'seed-core', noticeSeen: 'seed-seen', blur: 16, ropeShown: true,
    fxEnabled: false, parallaxEnabled: false, themeFollow: false, adapterTarget: 'auto',
  }, 'host');
  writeCfg(baseline);

  // ② a 段外键：body 里全是别簇的键 ⇒ 忽略 + 磁盘一字不动
  const beforeIgnore = settingsBytes();
  const ignoreRes = await put(`${SETTINGS_URL}/core`, { blur: 31, adapterTarget: 'desktop-official' });
  check('② 段外键被忽略并回报（blur / adapterTarget 在 ignored 里，本簇视图里没有）',
    ignoreRes && ignoreRes.ok === true && ignoreRes.ignored.join(',') === 'blur,adapterTarget'
    && ignoreRes.settings && !('blur' in ignoreRes.settings) && !('adapterTarget' in ignoreRes.settings),
    ignoreRes ? 'ignored=[' + ignoreRes.ignored.join(',') + ']' : '无应答');
  check('② 全是段外键的 body ⇒ 宿主配置逐字节不变', settingsBytes() === beforeIgnore);
  // 负对照：同一个 body 再加一个本簇键 ⇒ 字节必须变（证明上一条的"逐字节不变"有牙）
  await put(`${SETTINGS_URL}/core`, { blur: 31, adapterTarget: 'desktop-official', id: 'ignore-control' });
  check('② 负对照：同一 body 外加一个本簇键后字节确实变了（"不变"不是恒真式）',
    settingsBytes() !== beforeIgnore);

  // ② b 本簇键：真的写进去
  const coreRes = await put(`${SETTINGS_URL}/core`, { id: 'core-guard' });
  check('② 本簇键真的落盘（id 改成 core-guard）', readCfg().settings.id === 'core-guard' && coreRes.ok === true);

  // ② c 逐簇：用一份"每簇各有一个合法改动"的完整 body 打每个 ns，只允许本簇键变化。
  // media 簇里 `audioSource` / `mediaIntegration` / `mediaLyricsOnline` 都是 `kind:'const'`（值由宿主
  // 决定、body 改不动），唯一可写的键是枚举 `adapterTarget` —— 所以标记值取它。
  const other = schema.sanitizeFromSchema(Object.assign({}, baseline, {
    id: 'other-core', noticeSeen: 'other-seen', blur: 21, ropeShown: false,
    fxEnabled: true, parallaxEnabled: true, themeFollow: true, adapterTarget: 'browser',
  }), 'host');
  const bodyDiff = HOST_KEYS.filter((k) => !same(baseline[k], other[k]));
  check('② 夹具自检：other/baseline 的差异覆盖 7 个簇各至少一个键（判据才有牙）',
    NAMES.every((ns) => NS[ns].some((k) => bodyDiff.includes(k))),
    '差异 ' + bodyDiff.length + ' 键：' + bodyDiff.join(','));
  for (const ns of NAMES) {
    writeCfg(baseline);
    const res = await put(`${SETTINGS_URL}/${ns}`, other);
    const after = readCfg().settings;
    const changed = HOST_KEYS.filter((k) => !same(baseline[k], after[k]));
    const outOfNs = changed.filter((k) => !NS[ns].includes(k));
    check(`② /settings/${ns}：改动只落在本簇（${changed.length} 键）`, res && res.ok === true && changed.length > 0 && outOfNs.length === 0,
      outOfNs.length ? '越界键 ' + outOfNs.join(',') : '本簇 ' + changed.length + ' 键');
    check(`② /settings/${ns}：ignored 恰好是段外的 ${HOST_KEY_COUNT - NS[ns].length} 个键`,
      res && res.ignored.length === HOST_KEY_COUNT - NS[ns].length && !res.ignored.some((k) => NS[ns].includes(k)),
      res ? 'ignored ' + res.ignored.length : '无应答');
  }

  // ② d 未知 ns（含 meta）⇒ JSON 404，且不写盘
  writeCfg(baseline);
  const beforeUnknown = settingsBytes();
  for (const bad of ['meta', 'nope', 'core/x', 'CORE', '']) {
    const res = await put(`${SETTINGS_URL}/${bad}`, { blur: 44 });
    check(`② 未知 ns "${bad}" ⇒ JSON 404（meta 也走这条：它没有组件路由）`,
      res && res.ok === false && typeof res.error === 'string', res ? JSON.stringify(res.error) : '无应答');
  }
  check('② 未知 ns 的 PUT 一字不写（连规范化重写都没发生）', settingsBytes() === beforeUnknown);
  const unknownGet = await get(`${SETTINGS_URL}/meta`);
  check('② 未知 ns 的 GET ⇒ JSON 404', unknownGet && unknownGet.ok === false);

  // ② e 方法 / 视图
  const delRes = await runHandler(fakeReq(`${SETTINGS_URL}/core`, 'DELETE'));
  check('② 组件路径只认 GET/PUT（DELETE ⇒ 405）',
    delRes.__state.status === 405 && /method not allowed/.test(delRes.__state.body.toString('utf8')));
  const viewRes = await get(`${SETTINGS_URL}/core`);
  const viewKeys = viewRes && viewRes.settings ? Object.keys(viewRes.settings) : [];
  check('② GET /settings/core 回本簇视图（键都在本簇内，且是磁盘上真有的键）',
    viewRes && viewRes.ok === true && viewRes.ns === 'core'
    && viewKeys.length > 0 && viewKeys.every((k) => NS.core.includes(k) && k in readCfg().settings),
    'view=' + viewKeys.length + ' 键');
  const viewFx = await get(`${SETTINGS_URL}/fx`);
  check('② GET /settings/<ns> 逐簇可用（fx 视图只含 fx 键）',
    viewFx && Object.keys(viewFx.settings).every((k) => NS.fx.includes(k)));
}

// ═══ ③ 幂等：同 body 两连发（中间 GET）═══════════════════════════════════════
console.log('\n③ 幂等：同 body 连发两次，settings 段逐字节相同');
{
  const seed = schema.sanitizeFromSchema({ id: 'idem-seed', blur: 16, glassAlpha: 20 }, 'host');
  writeCfg(seed);
  const first = await put(`${SETTINGS_URL}/appearance`, { blur: 23, glassAlpha: 44 });
  const bytes1 = settingsBytes();
  await get(SETTINGS_URL);            // 中间夹一次 GET（读不得改盘）
  const bytesAfterGet = settingsBytes();
  const second = await put(`${SETTINGS_URL}/appearance`, { blur: 23, glassAlpha: 44 });
  const bytes2 = settingsBytes();
  check('③ GET 不改盘（连规范化重写都没发生）', bytesAfterGet === bytes1);
  check('③ 同 body 连发两次 ⇒ settings 段逐字节相同', bytes1 === bytes2);
  check('③ 两次应答的本簇视图相同', first && second && same(first.settings, second.settings));
  check('③ settingsVersion 没有随写入漂移', readCfg().settings.settingsVersion === seed.settingsVersion);
  // 负对照：换一个 body ⇒ 字节必须不同（证明上面那条相等判据有牙）
  await put(`${SETTINGS_URL}/appearance`, { blur: 24 });
  check('③ 负对照：换 body 后字节不同（相等判据不是恒真）', settingsBytes() !== bytes2);
}

// ═══ ④ 兼容整段入口 /settings ════════════════════════════════════════════════
console.log('\n④ 整段入口：全键 body ≡ 整段替换、缺键 body ⇒ 缺键保留');
{
  const seed = schema.sanitizeFromSchema({ id: 'whole-seed', blur: 16 }, 'host');
  writeCfg(seed);
  // 4 a 含全部键的 body：结果必须与「规范化快照」逐字节相同（旧语义就是写这份快照）
  const fullBody = schema.sanitizeFromSchema({
    settingsVersion: 6, id: 'whole-guard', blur: 33, glassAlpha: 55, fxEnabled: true,
  }, 'host');
  const fullRes = await put(SETTINGS_URL, fullBody);
  const expected = schema.sanitizeFromSchema(fullBody, 'host');
  check('④ 含全部键的 body ⇒ 与旧「整段替换」逐字节等价（= 规范化快照）',
    fullRes && fullRes.ok === true && settingsBytes() === JSON.stringify(expected));
  check('④ 全键 body 后仍是宿主持久白名单的键数（不多不少）', Object.keys(readCfg().settings).length === HOST_KEY_COUNT);
  check('④ 全键 body 的值照旧生效（blur 33 / glassAlpha 55 / id whole-guard）',
    readCfg().settings.blur === 33 && readCfg().settings.glassAlpha === 55 && readCfg().settings.id === 'whole-guard');
  // 4 b 缺键 body：提到的键改、没提到的键保留
  const beforePartial = readCfg().settings;
  const partialRes = await put(SETTINGS_URL, { blur: 41 });
  const afterPartial = readCfg().settings;
  check('④ 缺键 body：提到的键被改（blur 41）', afterPartial.blur === 41 && partialRes.ok === true);
  check('④ 缺键 body：没提到的键保留（glassAlpha 仍是 55，不是默认 ' + schema.sanitizeFromSchema({}, 'host').glassAlpha + '）',
    afterPartial.glassAlpha === 55);
  check('④ 缺键 body：其余键逐字节不变',
    HOST_KEYS.filter((k) => k !== 'blur').every((k) => same(afterPartial[k], beforePartial[k])));
  check('④ 负对照：旧「整段替换」语义下 glassAlpha 会被重置成默认（所以上一条有牙）',
    schema.sanitizeFromSchema({}, 'host').glassAlpha !== 55);
  // 4 c 空体 / 全未知键：不触发任何写入
  const beforeEmpty = settingsBytes();
  const emptyRes = await put(SETTINGS_URL, {});
  check('④ PUT {} 200 但不触发写入（旧语义会把整段重置成默认值）',
    emptyRes && emptyRes.ok === true && settingsBytes() === beforeEmpty);
  const ghostRes = await put(SETTINGS_URL, { __nope__: 1, anotherGhost: 'x' });
  check('④ 全是未知键的 body ⇒ 200、一字不写（未知键由消毒丢弃）',
    ghostRes && ghostRes.ok === true && settingsBytes() === beforeEmpty);
  check('④ 负对照：空体那两条不是恒真（换一个真 body 会改字节）',
    (await put(SETTINGS_URL, { blur: 42 })) !== null && settingsBytes() !== beforeEmpty);
}

// ═══ ⑤ 老存档（无 settingsVersion）原地可用 ══════════════════════════════════
console.log('\n⑤ 老 config.json：GET 回宿主持久白名单键数的规范化快照，文件逐字节不变');
{
  const LEGACY_SETTINGS = { id: 'legacy-guard', blur: 9, noticeSeen: 'legacy-seen', hiddenIds: ['a', 'b'], playbackRate: 1.5 };
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify({ settings: LEGACY_SETTINGS, fontSetId: '', uploadDir: '' }, null, 2));
  const legacyBytes = readFileSync(CONFIG_PATH);
  const res = await get(SETTINGS_URL);
  const got = res && res.settings;
  const expect = schema.sanitizeFromSchema(LEGACY_SETTINGS, 'host');
  const countIsHostKeys = (x) => !!x && typeof x === 'object' && Object.keys(x).length === HOST_KEY_COUNT;
  check('⑤ 无 settingsVersion 的老存档 ⇒ GET 回宿主持久白名单键数的规范化快照', countIsHostKeys(got),
    got ? Object.keys(got).length + ' 键' : '无 settings');
  check('⑤ 负对照：老存档本身远不到宿主持久键数（"宿主键数"不是夹具自带的）',
    !countIsHostKeys(LEGACY_SETTINGS) && !('settingsVersion' in LEGACY_SETTINGS),
    Object.keys(LEGACY_SETTINGS).length + ' 键 vs 宿主 ' + HOST_KEY_COUNT + ' 键');
  check('⑤ 老存档里的值仍能读出来（id / blur / noticeSeen / hiddenIds / playbackRate）',
    got && got.id === 'legacy-guard' && got.blur === 9 && got.noticeSeen === 'legacy-seen'
    && same(got.hiddenIds, ['a', 'b']) && got.playbackRate === 1.5);
  check('⑤ GET 回的 = sanitizeFromSchema(老存档, "host") 逐键相等（迁移在响应里，不在盘上）',
    got && HOST_KEYS.every((k) => same(got[k], expect[k])));
  check('⑤ GET 不会回写老文件（config.json 逐字节不变）', readFileSync(CONFIG_PATH).equals(legacyBytes));
  // 迁移期护栏：老文件里带着内联字体键、fontSetId 还是空 ⇒ 字体值必须仍在响应里。
  // 注意 `themeSize` / `themeWeight` 这类角色表键的合法形状是**对象**、`globalFamily` 是 familyKey
  // 白名单（自由字符串会被消毒成 ''）—— 这里挑两个形状最简单的键当哨兵。
  const withFonts = Object.assign({}, LEGACY_SETTINGS, { themeDarkSeparate: true, globalFamily: 'inherit' });
  // 期望键数**现算**：宿主白名单 + 这份夹具比老存档多出来的那几个内联字体键（不再写死 `+ 2`）。
  const fontExtraKeys = Object.keys(withFonts).filter((k) => !(k in LEGACY_SETTINGS));
  writeFileSync(CONFIG_PATH, JSON.stringify({ settings: withFonts, fontSetId: '', uploadDir: '' }, null, 2));
  const fontRoom = await get(SETTINGS_URL);
  check('⑤ 迁移期护栏：fontSetId 为空时内联字体键仍在响应里（老客户端的字体外观不静默丢）',
    fontRoom && fontRoom.settings.themeDarkSeparate === true && fontRoom.settings.globalFamily === 'inherit'
    && Object.keys(fontRoom.settings).length === HOST_KEY_COUNT + fontExtraKeys.length,
    '响应 ' + (fontRoom && fontRoom.settings ? Object.keys(fontRoom.settings).length : '?') + ' 键 = 宿主 '
      + HOST_KEY_COUNT + ' + 内联字体 ' + fontExtraKeys.length + '（' + fontExtraKeys.join(',') + '）');
  check('⑤ 负对照：这份带字体键的响应确实多于宿主持久键数（护栏判据不是恒真）', !countIsHostKeys(fontRoom.settings));
  // 磁盘上没有 settings 段 ⇒ 仍回 null（客户端靠 null 判"宿主还没有存档"）
  writeFileSync(CONFIG_PATH, JSON.stringify({ fontSetId: '', uploadDir: '' }));
  const emptyDisk = await get(SETTINGS_URL);
  check('⑤ 磁盘上没有 settings 段 ⇒ settings: null（客户端迁移分支的前提）', emptyDisk && emptyDisk.settings === null);
  check('⑤ null 时另外两个旁路字段仍在（betterSidebar / adapter）',
    emptyDisk && typeof emptyDisk.betterSidebar === 'boolean' && 'adapter' in emptyDisk);
}

// ═══ ⑥ 装配与源码棘轮 ════════════════════════════════════════════════════════
console.log('\n⑥ 装配（行首注册）+ 单条 prefix + 既有棘轮字面量');
{
  // 门面（注册调用点所在文件）与路由模块路径都**定位符号**得到，不写死 `lib/index.js` /
  // `lib/routes/settings.js`：实现搬家时判据跟着走，0 处 / 多处即红。
  const callSite = locateCallSites('registerSettingsRoutes');
  check('锚点：`registerSettingsRoutes(webServer, …)` 的调用点唯一（0 处 / 多处即红）', callSite.ok, callSite.detail);
  const ROUTE_REL = anchorRel(locate('registerSettingsRoutes'));
  const hostSrc = callSite.ok ? readFileSync(join(ROOT, callSite.hit.rel), 'utf8') : '';
  const callRe = /^\s*registerSettingsRoutes\s*\(\s*webServer\s*,/m;
  check('⑥ 门面里的注册调用仍是行首形态（host-route-index 只认这一种）',
    hostSrc !== '' && callRe.test(hostSrc), callSite.ok ? callSite.hit.rel + ':' + callSite.hit.line : '**调用点锚点丢失**');
  check('⑥ 负对照：赋值前缀会被同一条判据判出',
    callRe.test('  const x = registerSettingsRoutes(webServer, {})') === false
    && callRe.test('  registerSettingsRoutes(webServer, {});') === true);
  check('⑥ /settings 只有一条注册（prefix：同时服务裸路径与子路径）',
    routes.filter((r) => r.path === SETTINGS_URL).length === 1 && settingsRoute.kind === 'prefix',
    'kind=' + settingsRoute.kind);
  check('⑥ 负对照：尾斜杠注册永不匹配子路径（匹配语义 = 等于或前缀 + "/"）',
    !('/wallpaper-engine/settings/core'.startsWith('/wallpaper-engine/settings/' + '/'))
    && '/wallpaper-engine/settings/core'.startsWith(SETTINGS_URL + '/'));
  const routeSrc = ROUTE_REL ? readFileSync(join(ROOT, ROUTE_REL), 'utf8') : '';
  check('⑥ 既有守卫钉住的四个字面量仍在（path / method !== PUT / sanitizeSettings(parsed) / withLegacyFontValues(sanitized)）',
    routeSrc.includes('path: `${BASE}/settings`') && /method !== 'PUT'/.test(routeSrc)
    && /sanitizeSettings\(parsed\)/.test(routeSrc) && /withLegacyFontValues\(sanitized\)/.test(routeSrc));
  check('⑥ 收体的三条（上限 / 超时 / 一次性解码）只写一遍（两条写路径共用 readSettingsBody）',
    (routeSrc.match(/maxBytes: SETTINGS_MAX_BYTES/g) || []).length === 1
    && (routeSrc.match(/armBodyIdleTimeout\(req,/g) || []).length === 1
    && (routeSrc.match(/req\.on\('data', reader\.onData\)/g) || []).length === 1);
}

// ═══ ⑦ 客户端差分发送（P1-S2：只发改动键、按 ns 分组、首启迁移仍走整段）════════
// `src/persistence.js` 是**构建期内联**的浏览器半边：它不 import 任何东西，靠工厂作用域里的名字
// （lib/settings-schema.js 与 client.js 的 const）工作。所以这里按同一套契约把那些名字挂到 globalThis，
// 再 import **真文件**本体 —— 断言打在实现上，不是复刻一份判据。
console.log('\n⑦ 客户端差分：只发改动键、按 ns 分组、首启迁移仍走整段');
{
  // 客户端差分发送实现的真源：按符号定位（原先写死 `src/persistence.js`）。
  const PERSIST_REL = anchorRel(locate('flushPersist'));
  const persistSrc = PERSIST_REL ? readFileSync(join(ROOT, PERSIST_REL), 'utf8') : '';
  const PERSIST_URL = pathToFileURL(join(ROOT, PERSIST_REL)).href;
  const CLIENT_KEY = 'dsh-we-settings-guard';
  const clientSnap = (raw) => schema.sanitizeFromSchema(raw, 'client');
  let seq = 0;
  /** 每个用例一个全新模块实例（module 级的 `pushedSnapshot`/`persistDirty` 必须从零开始）。 */
  async function loadPersist({ hostSettings, localRaw, failPuts, noHost } = {}) {
    const calls = [];
    const store = new Map();
    if (localRaw !== undefined && localRaw !== null) {
      store.set(CLIENT_KEY, typeof localRaw === 'string' ? localRaw : JSON.stringify(localRaw));
    }
    globalThis.SETTINGS_KEY = CLIENT_KEY;
    globalThis.SETTINGS_URL = SETTINGS_URL;
    globalThis.selection = clientSnap(hostSettings && typeof hostSettings === 'object' ? hostSettings : {});
    globalThis.DEFAULTS = schema.DEFAULTS;
    globalThis.KINDS = schema.KINDS;
    globalThis.serializeSettings = schema.serializeSettings;
    globalThis.sanitizeSettings = clientSnap;
    globalThis.settingsNamespaceOf = schema.settingsNamespaceOf;
    globalThis.SETTINGS_META_NAMESPACE = schema.SETTINGS_META_NAMESPACE;
    globalThis.emit = () => {};
    globalThis.applyEffects = () => {};
    globalThis.setAdapterFromHost = () => {};
    globalThis.document = { hidden: false };
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    };
    globalThis.apiFetch = async (url, init) => {
      const rec = { url, method: init && init.method, keepalive: !!(init && init.keepalive), body: null };
      try { rec.body = init && init.body ? JSON.parse(init.body) : null; } catch { rec.body = null; }
      calls.push(rec);
      const fail = typeof failPuts === 'function' ? failPuts(url, rec) : false;
      return { ok: !fail, status: fail ? 500 : 200, data: null, error: null };
    };
    globalThis.apiJson = async (url) => {
      calls.push({ url, method: 'GET', body: null });
      if (noHost) return { ok: false, status: 404, data: null, error: 'not found' };
      return { ok: true, status: 200, error: null,
        data: { settings: hostSettings === undefined ? null : hostSettings, betterSidebar: false, adapter: null } };
    };
    const mod = await import(PERSIST_URL + '?case=' + (++seq));
    return { mod, calls, store, selection: globalThis.selection };
  }
  // `flushPersist()` 里的 `pushPersisted()` 是即发即忘（不 await）⇒ 用一个宏任务排空在途微任务链再断言。
  // ⚠️ 执行器用**语句体**：`(r) => setImmediate(r)` 会把 `setImmediate` 的返回（Timeout）当执行器返回值
  //    返回出去，被 `no-promise-executor-return` 判红（返回值没人能读 = 静默的形态错误）。
  const drain = () => new Promise((r) => { setImmediate(r); });
  const putsOf = (calls) => calls.filter((c) => c.method === 'PUT');
  const putBody = (calls, ns) => {
    const p = putsOf(calls).find((c) => c.url === SETTINGS_URL + '/' + ns);
    return p ? p.body : null;
  };

  // ⑦ a 宿主胜（基线来自宿主 GET）⇒ 只发改动键、按 ns 分组
  const hostPayload = schema.sanitizeFromSchema(
    { id: 'host-id', blur: 30, glassAlpha: 40, fxEnabled: false, parallaxEnabled: false, adapterTarget: 'auto' }, 'host');
  check('⑦ 夹具自检：宿主 GET 体是宿主持久白名单键数、客户端快照多出 CLIENT_ONLY 两键（两端键集不同是设计，不是漂移）',
    Object.keys(hostPayload).length === HOST_KEY_COUNT && Object.keys(clientSnap({})).length === HOST_KEY_COUNT + CLIENT_ONLY_COUNT);
  const c1 = await loadPersist({ hostSettings: hostPayload });
  await c1.mod.loadPersisted();
  check('⑦ 宿主胜：加载阶段只 GET、不打 PUT', c1.calls.length === 1 && c1.calls[0].method === 'GET',
    c1.calls.map((c) => c.method + ' ' + c.url).join(' | '));
  c1.selection.blur = 21;                  // appearance
  c1.selection.fxEnabled = true;           // fx
  c1.selection.adapterTarget = 'browser';  // media
  c1.mod.flushPersist();
  await drain();
  const puts1 = putsOf(c1.calls);
  check('⑦ 3 个改动键 ⇒ 恰好 3 条组件 PUT（不是 1 条整段）', puts1.length === 3,
    puts1.map((p) => p.url.replace(SETTINGS_URL, '')).join(',') + ' 条');
  check('⑦ 分组正确：appearance / fx / media 各一条，body 只含该簇的改动键',
    same(putBody(c1.calls, 'appearance'), { blur: 21 })
    && same(putBody(c1.calls, 'fx'), { fxEnabled: true })
    && same(putBody(c1.calls, 'media'), { adapterTarget: 'browser' }));
  check('⑦ 负对照：同簇里没改的键不发（appearance 体里没有 glassAlpha / id；否则就是"整簇回发"）',
    !('glassAlpha' in (putBody(c1.calls, 'appearance') || {}))
    && !('id' in (putBody(c1.calls, 'appearance') || {})));
  check('⑦ 陷阱 1：kind:"const" 的键一个都不发（media 簇只发 adapterTarget）',
    !('audioSource' in (putBody(c1.calls, 'media') || {}))
    && !('mediaIntegration' in (putBody(c1.calls, 'media') || {}))
    && !('mediaLyricsOnline' in (putBody(c1.calls, 'media') || {}))
    && schema.KINDS.audioSource.kind === 'const');
  check('⑦ 请求形状不变：PUT + keepalive（pagehide 的 flush 能活下来）',
    puts1.length === 3 && puts1.every((p) => p.keepalive === true));
  check('⑦ 任何一次请求体里都不出现 settingsVersion（meta 无路由）',
    putsOf(c1.calls).every((p) => !p.body || !('settingsVersion' in p.body)));

  // ⑦ b 无改动 / 只改 CLIENT_ONLY ⇒ 都不发请求；本地缓存仍整段写
  const n1 = c1.calls.length;
  c1.mod.flushPersist();
  await drain();
  check('⑦ 无改动：再 flush 一个请求都不发', c1.calls.length === n1);
  c1.selection.frameVariants = { guard: 'local-only' };
  c1.mod.flushPersist();
  await drain();
  check('⑦ 陷阱 2：只改 CLIENT_ONLY 键（frameVariants）⇒ 一个请求都不发', c1.calls.length === n1);
  const cache = JSON.parse(c1.store.get(CLIENT_KEY));
  check('⑦ 本地缓存仍是整段快照（宿主键数 + CLIENT_ONLY），CLIENT_ONLY 值在里面',
    Object.keys(cache).length === HOST_KEY_COUNT + CLIENT_ONLY_COUNT && cache.frameVariants && cache.frameVariants.guard === 'local-only',
    Object.keys(cache).length + ' 键');

  // ⑦ c 失败 ⇒ 不推进基线 ⇒ 重发同一批键；成功后不再重发
  let failing = true;
  const c2 = await loadPersist({ hostSettings: hostPayload, failPuts: () => failing });
  await c2.mod.loadPersisted();
  c2.selection.blur = 26;
  c2.mod.flushPersist();
  await drain();
  check('⑦ 非 2xx：请求照样发出（脏标记/重试语义不变）',
    putsOf(c2.calls).length === 1 && same(putBody(c2.calls, 'appearance'), { blur: 26 }));
  c2.mod.flushPersist();
  await drain();
  check('⑦ 失败后重试：基线没推进 ⇒ 同一批键重发（宿主侧按键合并 ⇒ 重发幂等）',
    putsOf(c2.calls).length === 2 && same(putBody(c2.calls, 'appearance'), { blur: 26 }));
  failing = false;
  c2.mod.flushPersist();
  await drain();
  const n2 = putsOf(c2.calls).length;
  c2.mod.flushPersist();
  await drain();
  check('⑦ 成功推进基线：之后无改动就不再发（' + n2 + ' → ' + putsOf(c2.calls).length + '）',
    n2 === 3 && putsOf(c2.calls).length === 3);

  // ⑦ d 首启迁移：宿主空 + 本地有 ⇒ 仍走老整段入口（唯一合法的整段写）
  const c3 = await loadPersist({ hostSettings: null, localRaw: clientSnap({ id: 'local-id', blur: 12 }) });
  await c3.mod.loadPersisted();
  await drain();
  const mputs = putsOf(c3.calls);
  check('⑦ 首启迁移：恰好 1 条 PUT 且打的是整段入口 /settings（没有 ns 后缀）',
    mputs.length === 1 && mputs[0].url === SETTINGS_URL,
    mputs.map((p) => p.url).join(','));
  check('⑦ 首启迁移的 body 是整段快照（宿主键数 + CLIENT_ONLY、值来自本地存档）',
    mputs[0] && mputs[0].body && Object.keys(mputs[0].body).length === HOST_KEY_COUNT + CLIENT_ONLY_COUNT
    && 'frameVariants' in mputs[0].body && mputs[0].body.blur === 12 && mputs[0].body.id === 'local-id',
    mputs[0] && mputs[0].body ? Object.keys(mputs[0].body).length + ' 键' : '无体');

  // ⑦ e 宿主不可达 ⇒ localStorage 兜底；用户改动仍回落到整段入口（基线未知时不许猜 ns）
  const c4 = await loadPersist({ noHost: true, localRaw: clientSnap({ id: 'local-only-id', blur: 13 }) });
  await c4.mod.loadPersisted();
  check('⑦ 宿主不可达 ⇒ localStorage 兜底（id 来自本地存档）', c4.selection.id === 'local-only-id');
  check('⑦ 宿主不可达：加载阶段不打 PUT（没有可迁移的宿主）', putsOf(c4.calls).length === 0);
  c4.selection.blur = 14;
  c4.mod.flushPersist();
  await drain();
  const nputs = putsOf(c4.calls);
  check('⑦ 宿主不可达 + 用户改动 ⇒ 回落整段入口（基线未知时不猜 ns）',
    nputs.length === 1 && nputs[0].url === SETTINGS_URL);
  check('⑦ 负对照：这条回落路径确实发了整段体（不是空体假绿）',
    nputs[0] && nputs[0].body && Object.keys(nputs[0].body).length === HOST_KEY_COUNT + CLIENT_ONLY_COUNT && nputs[0].body.blur === 14);

  // ⑦ f 源码锚点：行为用例之外的形态棘轮（"退回整段发送"必须红）
  check('⑦ 源码锚点：旧的整段发送形态已消失，body 由分组结果驱动',
    !/body:\s*JSON\.stringify\(serializeSelection\(\)\)/.test(persistSrc)
    && persistSrc.includes('body: JSON.stringify(body)')
    && persistSrc.includes('SETTINGS_URL + "/" + ns'));
  check('⑦ 源码锚点：差分用 settingsNamespaceOf 分簇、跳过 kind:"const" 与 meta',
    /settingsNamespaceOf\(key\)/.test(persistSrc) && /kind === "const"/.test(persistSrc)
    && /SETTINGS_META_NAMESPACE/.test(persistSrc));
  check('⑦ 源码锚点：整段入口被"基线未知"守卫住（不是默认路径）',
    /if \(!pushedSnapshot\) \{[\s\S]{0,200}putSettingsBody\(SETTINGS_URL, snapshot\)/.test(persistSrc));
  check('⑦ 源码锚点：localStorage 缓存仍是整段（零改动）',
    persistSrc.includes('localStorage.setItem(SETTINGS_KEY, JSON.stringify(serializeSelection()))'));
  // 剥注释走共享的字符串感知实现（本仓禁止朴素块注释正则，见 test/verify-module-layout.mjs ⑦）。
  const persistCode = stripComments(persistSrc);
  check('⑦ 客户端仍零裸 fetch（apiFetch 是唯一出入口；注释里的 "fetch (" 不算）',
    !/(^|[^.\w])fetch\s*\(/m.test(persistCode));
}

// ═══ ⑧ 刻度：组件写路径的 patch 值按"当前刻度"落盘（P1-FIX）════════════════════
// 缺陷（终态 verifier 端到端复现）：组件差分 body **不带** `settingsVersion`，宿主把它当"档"跑
// `migrateSettings` ⇒ v4 的 6 个换算键每次经组件写路径落盘都被**二次换算**（70 ⇒ 100 / 35 / 88）。
// 机制：`lib/routes/settings.js` 的 `sanitizeSettings(parsed)` → `lib/settings-schema.js:1687-1689`
// `migrateSettings`（`Number(raw.settingsVersion)` 为 NaN ⇒ 不短路）→ `:1713-1719` 的 rescale；
// `lib/kernel/config.js` 的 `mergeSettings` 又把"未规范化的存量 base + 已换算的 patch"混着迁一次。
// ⑦ 只断言字节变没变与字符串键 `id`，从不比对这 6 个键的**字面值** ⇒ 缺陷落在它的盲区里（本节由来）。
// 本节的判据全部读**磁盘上的字面值**，并带"二次换算值 ≠ 期望值"的夹具自检（防止判据恒真）。
console.log('\n⑧ 组件写路径：v4 换算键按当前刻度落盘（70 就是 70）');
{
  // 6 个换算键；WRONG = 若被当旧档再换算一次会得到的值（`lib/settings-schema.js:1706-1719`）。
  const SCALE_KEYS = [
    'glassAlpha', 'sidebarAlpha', 'sidebarContentAlpha',
    'settingsWindowTransparency', 'floatersTransparency', 'leftSidebarTransparency',
  ];
  const WRONG = {
    glassAlpha: 100, sidebarAlpha: 35, sidebarContentAlpha: 88,
    settingsWindowTransparency: 100, floatersTransparency: 100, leftSidebarTransparency: 100,
  };
  const V6 = schema.sanitizeFromSchema({}, 'host');       // 全默认 + 当前版本号 = "v6 存档"
  const V = V6.settingsVersion;

  check('⑧ 夹具自检：6 个换算键同属一个组件簇（本节只有一条 PUT 路径）',
    new Set(SCALE_KEYS.map((k) => schema.settingsNamespaceOf(k))).size === 1,
    '簇=' + SCALE_KEYS.map((k) => schema.settingsNamespaceOf(k)).join(','));
  check('⑧ 夹具自检：6 个键"被当旧档再换算一次"都会变成别的值（下面那组判据不是恒真）',
    SCALE_KEYS.every((k) => WRONG[k] !== 70));
  const NS_OF = schema.settingsNamespaceOf(SCALE_KEYS[0]);

  // 8 a v6 存档：每个键单独经组件写路径写 70 ⇒ 磁盘必须还是 70
  for (const key of SCALE_KEYS) {
    writeCfg(V6);
    const res = await put(`${SETTINGS_URL}/${NS_OF}`, { [key]: 70 });
    const got = readCfg().settings[key];
    check(`⑧ ${key}:70 经 /settings/${NS_OF} 落盘仍是 70（不是旧刻度解读的 ${WRONG[key]}）`,
      !!(res && res.ok === true) && got === 70, '磁盘=' + JSON.stringify(got));
  }

  // 8 b 上界：100 仍落 100（换算的钳制上界没被这处修复带偏）
  writeCfg(V6);
  await put(`${SETTINGS_URL}/${NS_OF}`, { glassAlpha: 100 });
  check('⑧ glassAlpha:100（上界）落盘仍 100', readCfg().settings.glassAlpha === 100);

  // 8 c 兼容整段入口行为不变：带版本号 ⇒ 不迁；缺版本号 ⇒ 仍按旧刻度迁移一次
  writeCfg(V6);
  await put(SETTINGS_URL, { settingsVersion: V, glassAlpha: 70 });
  check('⑧ 老整段入口：带当前版本号的 body ⇒ 70 原样落盘（行为不变）', readCfg().settings.glassAlpha === 70);
  writeCfg(V6);
  await put(SETTINGS_URL, { glassAlpha: 70 });
  check('⑧ 老整段入口：缺版本号的 body ⇒ 仍按旧刻度迁移一次（70 ⇒ 100，老客户端语义不变）',
    readCfg().settings.glassAlpha === 100);

  // 8 d 老档：磁盘存档缺 settingsVersion 且键在旧刻度 ⇒ 存量键迁移一次、同一次 PUT 的 patch 不被换算
  writeCfg({ id: 'legacy-scale', glassAlpha: 42, sidebarAlpha: 100, settingsWindowTransparency: 42, blur: 9 });
  await put(`${SETTINGS_URL}/${NS_OF}`, { glassAlpha: 70 });
  const after = readCfg().settings;
  check('⑧ 老档：存量键迁移**一次**（sidebarAlpha 100 ⇒ 50，不是 25）',
    after.sidebarAlpha === 50, '磁盘=' + JSON.stringify(after.sidebarAlpha));
  check('⑧ 老档：存量键迁移一次（settingsWindowTransparency 42 ⇒ 70）',
    after.settingsWindowTransparency === 70, '磁盘=' + JSON.stringify(after.settingsWindowTransparency));
  check('⑧ 老档：同一次 PUT 的 patch 值**不被换算**（glassAlpha 70 ⇒ 70）',
    after.glassAlpha === 70, '磁盘=' + JSON.stringify(after.glassAlpha));
  check('⑧ 老档：写入后盖上当前版本号（老档只迁一次，不会每次写都迁）',
    after.settingsVersion === V, '版本=' + JSON.stringify(after.settingsVersion));
  check('⑧ 老档：未提及的键照旧（blur 9 仍是 9 —— 它只钳制、不换算）',
    after.blur === 9, '磁盘=' + JSON.stringify(after.blur));
  check('⑧ 老档：仍是宿主持久键数（迁移没多键也没丢键）',
    Object.keys(after).length === HOST_KEY_COUNT, Object.keys(after).length + ' 键 vs 宿主 ' + HOST_KEY_COUNT + ' 键');
}

if (typeof dispose === 'function') { try { dispose(); } catch { /* 清理失败不影响判定 */ } }
console.log('');
if (failed) { console.log(`SETTINGS NAMESPACE CHECKS FAILED — ${failed} failed`); process.exit(1); }
console.log('ALL SETTINGS NAMESPACE CHECKS PASSED');
process.exit(0);
