#!/usr/bin/env node
/**
 * verify-about.mjs — 「关于」页签的**两样外部输入**（star 数 + 两张二维码 PNG）的守卫。
 *
 * 守的是四件事，缺一条这条链路就会以"静默"的方式坏掉：
 *   ① **仓库地址只有一处真源**：`package.json` 的 `repository.url` ⇄ 客户端 `ABOUT_REPO_URL`
 *      ⇄ 宿主 `repoSlugFromPkg()` 的解析结果 —— 三边必须指着同一个 `owner/repo`。
 *      抄第二份字面量不会报错，只会让"关于页的 star 数永远停在旧仓库"。
 *   ② **路由行为**（真模块 + 替身出站，**全程不联网**）：成功回 count、解析坏形状算失败、
 *      非 2xx 算失败、**TTL 内不再出站**、**并发合并成一次**、失败后有落盘旧值就回旧值并标
 *      `stale`、无旧值才 `ok:false`、非 GET 405、仓库地址缺失时不炸。
 *   ③ **二维码资源**（`/about-qr/<文件名>`）：白名单命中才出字节（遍历 / 编码 / 未登记名字一律
 *      404，**不做任何路径拼接**）、GET/HEAD 之外 405、`Content-Type: image/png` + ETag/304、
 *      坏响应不带缓存；并断言 `package.json` 的 `files` 真的把 `lib/about/` 打进包（少了它
 *      发布包里就没有图，而 checkout 里一切正常 —— 打包漏项的经典形态）。
 *   ④ **客户端那一侧**：star 数三态文案（取不到 / 正在取 / 当前值）都进词表、客户端**只读**
 *      宿主路由（`apiJson("/star-count")`）且**不把 star 数写进设置**；两张码的 src 是**路由
 *      URL**（经 apiUrl）而不是内联 base64 —— 码的字节住在 `lib/about/` 的包里，内联等于把
 *      二进制塞进客户端产物、绕过文件白名单。
 *   ⑤ **公告配图的 art-gate**（源码形态判据）：更新公告**等配图就绪才弹** —— 面板 bundle
 *      宿主开页现读、后端路由重启才换血，更新后未重启的窗口期里旧白名单没有
 *      update-notice.jpg（404）；公告若照旧立刻弹就是裂图，而「知道了」一关永久退场，
 *      配图等于永远没人看到（v1.3.0 发布当日的真实事故）。钉住：探针在（HEAD
 *      NOTICE_ART_PATH）、门控在（ready/timeout 才 show）、img 只在 ready 渲染、
 *      **一个时限内的请求数 ≤10**（退避表 + 跑真函数算时刻表，旧固定 1.5s 轮询是 61 拍
 *      —— 上线当日的实测反馈就是"一屏 404 红字"）、**结论按页面加载缓存**（多开面板不复探）。
 *
 * 为什么必须不联网：GitHub 未认证限流是 **60 次/小时/IP、整机共享**的 —— 守卫若真发请求，
 * CI 上跑几次就把额度用光，而且"网络不通"会让判据变成随机红。故本文件**只**用替身 fetchJson。
 *
 * Usage:  node test/verify-about.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Writable } from 'node:stream';
// 剥注释：共享的字符串感知实现（形态判据必须只看**代码** —— 下面那条 fence 判据的注释里
// 就写着"不要用 startsWith(dir + '/')"，不剥注释会被自己的说明误伤成真阳性）。
import { stripComments } from './tools/js-text.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
let passed = 0;
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) passed++; else failed++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
};
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// ══ ① 仓库地址三边一致 ═══════════════════════════════════════════════════════
console.log('① 仓库地址：package.json ⇄ 客户端 ⇄ 宿主解析');

const hostSrc = read('lib/index.js');
/**
 * `owner/repo` 归一化：正则本体**从宿主实现里现抽**（`lib/index.js` 的 `repoSlugFromPkg`），
 * 不在测试里重打一份 —— 重打的那份一旦与产品漂移，判据就退化成"测试自己和自己一致"。
 * 宿主解析腿全仓只有这里一处行为覆盖，故只重写、不删。抽不到时用 `(?!)`（永不匹配），
 * 阳性判据 `pkgSlug.length > 0` 当场变红，而不是静默全绿。
 */
const hostSlugParts = hostSrc.match(/url\.match\(\/(github[^\n]*?)\/([a-z]*)\)/) || [];
const hostSlugRe = new RegExp(hostSlugParts[1] || '(?!)', hostSlugParts[2] || '');
const slugOf = (url) => {
  const m = hostSlugRe.exec(String(url || ''));
  return m ? m[1] : '';
};

const pkg = JSON.parse(read('package.json'));
const pkgSlug = slugOf(pkg.repository && pkg.repository.url);
const clientUrl = (read('src/about-assets.js').match(/const ABOUT_REPO_URL = "([^"]+)"/) || [])[1] || '';
const clientSlug = slugOf(clientUrl);

check('package.json 的仓库地址能解析出 owner/repo（判据非空转）', pkgSlug.length > 0, pkgSlug);
check('客户端 ABOUT_REPO_URL 能解析出 owner/repo', clientSlug.length > 0, clientUrl);
check('两侧指向同一个仓库', pkgSlug !== '' && pkgSlug === clientSlug, pkgSlug + ' vs ' + clientSlug);
check('negative control: 只认 github.com 的地址（别的托管方不算同源）',
  slugOf('https://gitlab.com/a/b.git') === '' && slugOf('https://github.com/a/b.git') === 'a/b');

// 宿主侧：**没有第二份字面量**，只从 package.json 现读（`hostSrc` 已在 ① 开头读入）。
check('宿主从 package.json 现读仓库地址（不抄第二份字面量）',
  /function repoSlugFromPkg\(\)/.test(hostSrc)
    && /JSON\.parse\(readFileSync\(new URL\('\.\.\/package\.json', import\.meta\.url\)/.test(hostSrc));
check('宿主没有把 owner/repo 写死成字面量',
  !/elysia395\/dsh-wallpaper-engine/.test(hostSrc));
check('star 路由的注册点声明了缓存路径与仓库地址',
  /registerGithubStarsRoutes\(webServer, \{[\s\S]{0,240}repoSlug: repoSlugFromPkg\(\)/.test(hostSrc)
    && /cachePath: \(\) => join\(pluginDataDir\(\), 'star-count\.json'\)/.test(hostSrc));
check('一键 star 不做：宿主侧没有任何写 GitHub 的调用',
  !/user\/starred/.test(hostSrc) && !/method:\s*['"]PUT['"]/.test(read('lib/routes/github-stars.js')));

// ══ ② 路由行为（替身出站，不联网）════════════════════════════════════════════
console.log('\n② /star-count 路由行为（替身 fetchJson）');

const { registerGithubStarsRoutes } =
  await import(pathToFileURL(join(ROOT, 'lib', 'routes', 'github-stars.js')).href);
// 路由模块**只导出它的 register 函数**（`lib/routes/*.js` 的统一形状，verify-route-index
// 按这个形状解析 context 契约）⇒ TTL 常量从源码里读，不去 import 一个不存在的导出。
const starSrc = read('lib/routes/github-stars.js');
const STAR_TTL_MS = Number((starSrc.match(/const STAR_TTL_MS = ([0-9_*\s]+);/) || [])[1].replace(/[\s_]/g, '').split('*').reduce((a, b) => a * Number(b), 1));
check('路由模块只导出 register 函数（与其它路由模块同形）',
  (starSrc.match(/^export /gm) || []).length === 1
    && starSrc.includes('export function registerGithubStarsRoutes(webServer, c) {'));
check('TTL 常量解析出来了（判据非空转）', Number.isFinite(STAR_TTL_MS) && STAR_TTL_MS > 0, String(STAR_TTL_MS));

/** 隔离的数据目录：缓存写这里，绝不碰用户真实目录（同 DSH_WE_DATA_DIR 口径）。 */
const TMP = join(ROOT, '.test-cache', 'star-count');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
const CACHE = join(TMP, 'star-count.json');

function fakeRes() {
  // body 按 **Buffer** 累积（PNG 是二进制：按字符串拼会被 UTF-8 解码改写，字节比对必然假红）。
  // JSON 那几条用例照旧 —— `JSON.parse(Buffer)` 会走 toString('utf8')，没区别。
  const state = { status: 200, headers: {}, body: Buffer.alloc(0), ended: false };
  const res = new Writable({
    write(chunk, enc, cb) {
      state.body = Buffer.concat([state.body, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, enc)]);
      cb();
    },
    final(cb) { state.ended = true; cb(); },
  });
  res.setHeader = (k, v) => { state.headers[k] = v; };
  Object.defineProperty(res, 'statusCode', { get: () => state.status, set: (v) => { state.status = v; } });
  res.__state = state;
  return res;
}

/** 装一台 mock webServer，注册真路由（fetchJson 是替身）。返回 { route, calls, logs }。 */
function mount(opts) {
  const o = opts || {};
  const routes = [];
  const calls = [];
  const logs = [];
  const webServer = { register(route) { routes.push(route); return () => {}; } };
  // 默认**清掉落盘缓存**：否则上一条用例的缓存会喂给下一条，判据看起来"通过"却什么
  // 都没测（前一条留下的 0 缓存会把解析用例整个接管）。要接着上一份缓存跑的用例
  // 显式传 keepCache。
  if (!o.keepCache) rmSync(CACHE, { force: true });
  registerGithubStarsRoutes(webServer, {
    disposers: { push() {} },
    base: '/wallpaper-engine',
    repoSlug: o.repoSlug === undefined ? 'elysia395/dsh-wallpaper-engine' : o.repoSlug,
    cachePath: () => CACHE,
    log: (m) => logs.push(String(m)),
    fetchJson: async (url) => {
      calls.push(url);
      if (o.fail) throw new Error(o.fail);
      if (o.payload !== undefined) return o.payload;
      return { stargazers_count: o.count === undefined ? 428 : o.count };
    },
  });
  return { route: routes[0], calls, logs };
}

const run = async (route, method) => {
  const res = fakeRes();
  const done = route.handler({ method: method || 'GET', url: '/wallpaper-engine/star-count', headers: {} }, res);
  if (done && typeof done.then === 'function') await done;
  return JSON.parse(String(res.__state.body || '{}'));
};
const runFull = async (route, method) => {
  const res = fakeRes();
  const done = route.handler({ method: method || 'GET', url: '/wallpaper-engine/star-count', headers: {} }, res);
  if (done && typeof done.then === 'function') await done;
  return res.__state;
};

// 应答形状（经路由判，不去 import 内部函数）：坏了就说"取不到"，绝不显示假数
{
  const bad = mount({ payload: {} });
  const r1 = await run(bad.route);
  check('应答里没有 stargazers_count ⇒ ok:false（宁可说"取不到"也不显示假数）', r1.ok === false, JSON.stringify(r1));
  const weird = mount({ payload: { stargazers_count: 'many' } });
  const r2 = await run(weird.route);
  check('stargazers_count 不是数字 ⇒ 同样算失败', r2.ok === false, JSON.stringify(r2));
  const neg = mount({ payload: { stargazers_count: -1 } });
  const r3 = await run(neg.route);
  check('负数（不可能的计数）⇒ 算失败', r3.ok === false, JSON.stringify(r3));
  const zero = mount({ payload: { stargazers_count: 0 } });
  const r4 = await run(zero.route);
  check('negative control: 0 是合法值（"0 star 的仓库"不该被当成失败）',
    r4.ok === true && r4.count === 0, JSON.stringify(r4));
  const flo = mount({ payload: { stargazers_count: 428.7 } });
  const r5 = await run(flo.route);
  check('小数向下取整（GitHub 不该给小数，但别让 UI 显示 428.7）', r5.ok === true && r5.count === 428, JSON.stringify(r5));
}

{
  const m = mount({ count: 1234 });
  check('路由注册为 exact + 正确路径', m.route.kind === 'exact' && m.route.path === '/wallpaper-engine/star-count');
  const body = await run(m.route);
  check('成功：ok + count + fetchedAt', body.ok === true && body.count === 1234 && Number.isFinite(body.fetchedAt),
    JSON.stringify(body));
  check('成功：出站一次，且打的是 api.github.com 的那个仓库',
    m.calls.length === 1 && m.calls[0] === 'https://api.github.com/repos/elysia395/dsh-wallpaper-engine',
    m.calls.join(' '));
  check('成功：落盘缓存（离线兜底那条腿的数据源）',
    existsSync(CACHE) && JSON.parse(readFileSync(CACHE, 'utf8')).count === 1234);
  const again = await run(m.route);
  check('TTL 内第二次问：直接回缓存，**不再出站**（GitHub 限流 60/h 是整机共享的）',
    again.ok === true && again.count === 1234 && m.calls.length === 1, '出站 ' + m.calls.length + ' 次');
  // 并发合并：两个同时到达的请求只出站一次
  rmSync(CACHE, { force: true });
  const both = await Promise.all([run(m.route), run(m.route)]);
  check('并发/多窗口同时问：合并成一次出站',
    m.calls.length === 1 && both.every((b) => b.ok === true), '出站 ' + m.calls.length + ' 次');
  const res = await runFull(m.route, 'POST');
  check('非 GET ⇒ 405（早退，不出站）', res.status === 405 && m.calls.length === 1, 'status=' + res.status);
  const okRes = await runFull(m.route);
  check('应答带 no-store（缓存由本路由管，不让浏览器再叠一层）',
    okRes.headers['Cache-Control'] === 'no-store');
}

/** 把落盘缓存改成"已过期"（TTL 之外）——失败路径只有在**旧值过期**时才该出站重试。 */
function ageCache(byMs) {
  const o = JSON.parse(readFileSync(CACHE, 'utf8'));
  o.at = Date.now() - byMs;
  writeFileSync(CACHE, JSON.stringify(o));
  return o.count;
}
/** 把缓存真值钉成一个数（先成功一次再把它改成过期） */
async function seedCache(count) {
  rmSync(CACHE, { force: true });
  const m = mount({ count });
  await run(m.route);
  return ageCache(STAR_TTL_MS + 1000);
}

{
  // 失败 + 有**过期**旧值 ⇒ 回旧值并标 stale（"断网也有数字"的全部依据）
  const seeded = await seedCache(777);
  check('前置：缓存里的旧值确实是 777 且已过期', seeded === 777);
  const m2 = mount({ fail: 'HTTP 403', keepCache: true });
  const body = await run(m2.route);
  check('拉取失败 + 有过期缓存 ⇒ 出站重试一次',
    m2.calls.length === 1, '出站 ' + m2.calls.length + ' 次');
  check('拉取失败 + 有过期缓存 ⇒ 回旧值且 stale:true（不是"取不到"）',
    body.ok === true && body.count === 777 && body.stale === true, JSON.stringify(body));
  check('拉取失败：留痕一条（成功不记）', m2.logs.length === 1 && /403/.test(m2.logs[0]), m2.logs.join(' | '));
  // 失败不写 at ⇒ 下次立刻重试（失败不该被 TTL 冷却住）
  const before = m2.calls.length;
  await run(m2.route);
  check('失败不进入冷却：下一次问立刻重试',
    m2.calls.length - before === 1, '再出站 ' + (m2.calls.length - before) + ' 次');
  // 无缓存 + 失败 ⇒ ok:false（客户端显示"暂时取不到"）
  rmSync(CACHE, { force: true });
  const m4 = mount({ fail: 'offline' });
  let threw = null;
  let none = null;
  try { none = await run(m4.route); } catch (e) { threw = e; }
  check('拉取失败但**不抛**（handler 正常应答，页面不会因为联网失败而白屏）', threw === null,
    threw ? String(threw && threw.message) : '');
  check('拉取失败 + 无缓存 ⇒ ok:false + 原因（客户端据此显示"暂时取不到"）',
    Boolean(none) && none.ok === false && none.count === null && /offline/.test(String(none.error)),
    JSON.stringify(none));
  // 成功不记日志（成功是常态，不该刷屏）
  const m5 = mount({ count: 5 });
  await run(m5.route);
  check('成功路径零日志（只有失败留痕）', m5.logs.length === 0, m5.logs.join(' | '));
}

{
  // 仓库地址解析不出来 ⇒ 静默关闭功能，不炸
  const m = mount({ repoSlug: '' });
  const body = await run(m.route);
  check('没有可解析的仓库地址 ⇒ ok:false + no-repo，且不出站',
    body.ok === false && body.error === 'no-repo' && m.calls.length === 0, JSON.stringify(body));
}

check('TTL 常量在合理区间（几分钟量级，不是"永不刷新"也不是"每次刷新"）',
  STAR_TTL_MS >= 60 * 1000 && STAR_TTL_MS <= 60 * 60 * 1000, STAR_TTL_MS + 'ms');

// ══ ③ 随包图：二维码 PNG + 公告配图 JPEG + 白名单路由 ══════════════════════════
console.log('\n③ /about-qr 路由行为（白名单 / 304 / 405 / 404）');

const { registerAboutQrRoutes } = await import(pathToFileURL(join(ROOT, 'lib', 'routes', 'about-qr.js')).href);
const ABOUT_DIR = join(ROOT, 'lib', 'about');
const aboutSrc = read('lib/routes/about-qr.js');
const pkgFiles = JSON.parse(read('package.json')).files || [];

/** 装一台只含 QR 路由的 mock webServer；serveFile 用**真实现**（在 lib/index.js 里是内联函数，
 *  这里用一个语义等价的替身：mime + ETag/304 + 字节直出 —— 判据要测的是**路由那层**的
 *  白名单与状态码，字节出口的行为由 verify-* 的既有覆盖面负责）。 */
function mountQr() {
  const routes = [];
  const seen = [];
  const webServer = { register(route) { routes.push(route); return () => {}; } };
  registerAboutQrRoutes(webServer, {
    disposers: { push() {} },
    base: '/wallpaper-engine',
    aboutDir: ABOUT_DIR,
    serveFile: (abs, req, res, headOnly, opts) => {
      seen.push(abs);
      if (!existsSync(abs)) { res.statusCode = 404; res.setHeader('Cache-Control', 'no-store'); res.end('not found'); return; }
      const st = statSync(abs);
      const etag = 'W/"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';
      // 真 serveFile 按**扩展名**给 mime（lib/index.js 的 mimeFor）——替身同口径。
      res.setHeader('Content-Type', abs.endsWith('.jpg') ? 'image/jpeg' : 'image/png');
      res.setHeader('ETag', etag);
      if (opts && opts.revalidate && String(req.headers['if-none-match'] || '') === etag) {
        res.statusCode = 304; res.end(); return;
      }
      const body = readFileSync(abs);
      res.statusCode = 200;
      if (headOnly) { res.end(); return; }
      res.end(body);
    },
  });
  return { route: routes[0], seen };
}

async function runQr(route, pathname, method, headers) {
  const res = fakeRes();
  const r = { method: method || 'GET', url: pathname, headers: headers || {} };
  const done = route.handler(r, res);
  if (done && typeof done.then === 'function') await done;
  return res.__state;
}

{
  const m = mountQr();
  check('路由注册为 prefix + 正确路径', m.route.kind === 'prefix' && m.route.path === '/wallpaper-engine/about-qr');
  for (const [name, file] of [['qq-group.png', 'qq-group.png'], ['douyin-group.png', 'douyin-group.png'], ['update-notice.jpg', 'update-notice.jpg']]) {
    const st = await runQr(m.route, '/wallpaper-engine/about-qr/' + name);
    const mime = name.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
    check('白名单命中：' + name + ' 出字节 + ' + mime,
      st.status === 200 && st.headers['Content-Type'] === mime && st.body.length > 1000,
      'status=' + st.status + ' bytes=' + st.body.length);
    const bytes = readFileSync(join(ABOUT_DIR, file));
    check('出的是**磁盘上那份**字节（不是别处拼的）',
      Buffer.compare(Buffer.from(st.body), bytes) === 0, 'file ' + bytes.length + ' vs resp ' + Buffer.from(st.body).length);
    check('带 ETag（换图后客户端能立刻拿到新的）', /^W\/"/.test(String(st.headers.ETag || '')), String(st.headers.ETag));
  }
  // 304：带上 ETag 再问一次
  const first = await runQr(m.route, '/wallpaper-engine/about-qr/qq-group.png');
  const second = await runQr(m.route, '/wallpaper-engine/about-qr/qq-group.png', 'GET', { 'if-none-match': first.headers.ETag });
  check('条件 GET：ETag 未变 ⇒ 304 无体', second.status === 304 && second.body.length === 0, 'status=' + second.status);
  // HEAD
  const head = await runQr(m.route, '/wallpaper-engine/about-qr/qq-group.png', 'HEAD');
  check('HEAD 可用且无体（浏览器/壳预检用得上）', head.status === 200 && head.body.length === 0, 'status=' + head.status);
  // 405
  const post = await runQr(m.route, '/wallpaper-engine/about-qr/qq-group.png', 'POST');
  check('非 GET/HEAD ⇒ 405（本路由没有写面）', post.status === 405, 'status=' + post.status);
  // 404：未登记 / 空 / 多段 / 目录
  const notFound = [
    ['未登记的名字', '/wallpaper-engine/about-qr/nope.png'],
    ['空名字', '/wallpaper-engine/about-qr/'],
    ['多段路径', '/wallpaper-engine/about-qr/sub/qq-group.png'],
    ['同名前缀（qq-group.png.bak）', '/wallpaper-engine/about-qr/qq-group.png.bak'],
    ['大小写不同（QQ-Group.png）', '/wallpaper-engine/about-qr/QQ-Group.png'],
  ];
  for (const [label, p] of notFound) {
    const st = await runQr(m.route, p);
    check('404：' + label, st.status === 404, 'status=' + st.status);
  }
  // 点段（`../`）由 `new URL` 在**进 handler 之前**就规范化掉了 ⇒ 归一化之后若仍落在
  // 白名单里就是一次正常请求（这是 URL 语义，不是漏洞）；能不能"穿出去"由下一条反向探针判。
  const dotted = await runQr(m.route, '/wallpaper-engine/about-qr/../about-qr/qq-group.png');
  check('点段归一化后仍指向白名单内 ⇒ 正常出图（不是穿越漏洞）',
    dotted.status === 200, 'status=' + dotted.status);

  // 反向探针：**没进白名单的名字绝不许触到磁盘**
  const touched = m.seen.length;
  const before = touched;
  await runQr(m.route, '/wallpaper-engine/about-qr/%2e%2e%2f%2e%2e%2fpackage.json');
  await runQr(m.route, '/wallpaper-engine/about-qr/..%2f..%2fpackage.json');
  check('穿越形状的名字一律 404，且**不落到磁盘**（"没进白名单就不碰路径"这条要能被数出来）',
    m.seen.length === before, '多出 ' + (m.seen.length - before) + ' 次磁盘访问');
  // 打包：lib/about/ 必须随包（checkout 里永远正常，只有发布包会缺）
  check('package.json 的 files 覆盖 lib/about/（否则发布包里没有图）',
    pkgFiles.some((f) => String(f).replace(/\/$/, '') === 'lib/about'));
  // 白名单成员判据：路由源码的 accept 清单里逐字出现 `'<文件名>'`。下面两条判据与
  // 它们的对照共用这一个函数 —— 对照必须喂进真判据，喂自造数组的 `includes` 等于没测。
  const inWhitelist = (name) => aboutSrc.includes("'" + name + "'");
  check('lib/about/ 里的每张随包图（PNG/JPEG）都在路由白名单里（打包了却取不到 = 图白送）',
    readdirSync(ABOUT_DIR).filter((f) => f.endsWith('.png') || f.endsWith('.jpg'))
      .every((f) => inWhitelist(f)));
  check('路由白名单里的每个名字都在磁盘上（白名单不许空转）',
    ['qq-group.png', 'douyin-group.png', 'update-notice.jpg'].every((f) => existsSync(join(ABOUT_DIR, f))));
  check('negative control: 白名单判据对合成输入有牙（.bak 变体落榜、原名字上榜）',
    !inWhitelist('qq-group.png.bak') && inWhitelist('qq-group.png'));
  // **形态判据**（分隔符那条腿只能在 Windows 上真跑出来，故这里认源码形态）：
  // 包含性检查必须走 `relative()`：`abs.startsWith(dir + '/')` 在 Windows 上必然判 null
  // （resolve 给反斜杠、前缀给正斜杠）⇒ 白名单命中的图也 404，而 macOS 上全绿 —— 正是
  // "只在 CI 上红"的那一类。
  const fenceOk = (src) => {
    const code = stripComments(String(src));
    return /relative\(/.test(code) && /isAbsolute\(/.test(code) && !/startsWith\(\s*(dir|prefix)/.test(code);
  };
  check('包含性检查用分隔符无关的 relative()（不是 startsWith(dir + "/")）', fenceOk(aboutSrc));
  check('negative control: 前缀写法会被判出（windows-latest 上就是这么红的）',
    fenceOk('const prefix = dir + "/"; return abs.startsWith(prefix) ? abs : null;') === false
      && fenceOk('const rel = relative(dir, abs); return rel && !rel.startsWith("..") && !isAbsolute(rel) ? abs : null;') === true);
  // **行为判据**：把同一条谓词放到 `path.win32` 下求值 —— 本机是 macOS，跑不了 Windows，
  // 但 `win32` 就是 Windows 上那套语义，于是平台差异在这里可复现：拼正斜杠前缀的写法在
  // win32 下判 **false**（白名单命中的图也 404），走 `relative()` 的写法判 true。
  {
    const { win32 } = await import('node:path');
    const dirWin = win32.resolve('C:\\repo\\lib\\about');
    const fileWin = win32.resolve(dirWin, 'qq-group.png');
    const upWin = win32.resolve(dirWin, '..', '..', 'package.json');
    const relWin = win32.relative(dirWin, fileWin);
    const upRelWin = win32.relative(dirWin, upWin);
    const winOk = (r) => Boolean(r) && !r.startsWith('..') && !win32.isAbsolute(r);
    check('win32 语义：白名单内（qq-group.png）判**在目录内**', relWin === 'qq-group.png' && winOk(relWin) === true,
      'rel=' + JSON.stringify(relWin));
    check('win32 语义：目录外（..\\..\\package.json）判**在外**', winOk(upRelWin) === false, 'rel=' + JSON.stringify(upRelWin));
    check('win32 语义 · 事故复现：旧写法（dir + "/" 前缀）在白名单命中的图上也判 false',
      fileWin.startsWith(dirWin + '/') === false && fileWin.startsWith(dirWin + '\\') === true,
      '这正是 2026-10-01 CI 全红而本机全绿的原因');
  }
  // 客户端那一半：src 是路由 URL，不是 data URI
  const clientSrc2 = read('src/panel-tabs.js');
  check('渲染器用 apiUrl 拼路由路径（不是内联图）',
    /src: apiUrl\(ABOUT_QR_QQ_PATH\)/.test(clientSrc2) && /src: apiUrl\(ABOUT_QR_DOUYIN_PATH\)/.test(clientSrc2));
  // ⚠️ 不能泛判 `data:image/png;base64,iVBOR` —— 吉祥物立绘就是这种（那两张该留）。要判的是
  // **这两张码的字节**在不在 bundle 里：拿每张图 base64 的头 64 字符做指纹（内联过就必然命中）。
  const bundle = read('lib/client.js');
  const fingerprints = ['qq-group.png', 'douyin-group.png']
    .map((f) => readFileSync(join(ABOUT_DIR, f)).toString('base64').slice(0, 64));
  check('客户端产物里不再有这两张二维码的字节（bundle 体积那条腿；吉祥物立绘不受影响）',
    fingerprints.every((fp) => !bundle.includes(fp))
      && bundle.includes('data:image/png;base64,iVBOR'), // 吉祥物仍在（证明这条不是把 base64 一网打尽）
    '指纹数=' + fingerprints.length + ' bundle=' + bundle.length + 'B');
}

// ══ ④ 客户端那行字 ═══════════════════════════════════════════════════════════
console.log('\n④ 客户端：三态文案 + 只读 + 不进设置');
const clientSrc = read('src/client.js');
const tabsSrc = read('src/panel-tabs.js');
const copySrc = read('src/i18n-copy.js');

check('客户端只读宿主这条路由（apiJson 唯一入口）',
  clientSrc.includes('apiJson("/star-count")') && !/fetch\(\s*["'`]\/star-count/.test(clientSrc));
check('三态文案都在（正在取 / 当前值 / 取不到）',
  ['⭐ 正在获取 star 数…', '⭐ 当前 {count} star', '⭐ 暂时取不到 star 数'].every((k) => clientSrc.includes(k)));
check('三条文案都进了英文词表（i18n 门禁的另一半）',
  ['"⭐ 正在获取 star 数…"', '"⭐ 当前 {count} star"', '"⭐ 暂时取不到 star 数"',
    '"来自 GitHub API 的实时数据（带缓存；拉不到时显示上一次取到的值）"'].every((k) => copySrc.includes(k)));
/** star 数被当成设置写进去（直写 selection 字段 / 交给 setSetting 落盘）——两种都算越界。 */
const writesStarIntoSetting = (s) =>
  /selection\.\w*[Ss]tarCount/.test(s) || /starCount[\s\S]{0,40}setSetting\(/.test(s);
check('star 数**不是设置**：客户端没有把它写进 selection / 落盘', !writesStarIntoSetting(clientSrc));
check('negative control: "不是设置"的判据对两种合成输入都有牙',
  writesStarIntoSetting('selection.starCount = 1;') && writesStarIntoSetting('let starCount = 0; setSetting('));
check('切到「关于」页才去问（别的页签不发请求）',
  /if \(id === "about"\) loadStarCount\(false\);/.test(clientSrc));
check('停在关于页刷新页面也能取到（effect 兜住"不走 switchTab"那条路径）',
  /React\.useEffect\(\(\) => \{ if \(activeTab === "about"\) loadStarCount\(false\); \}, \[activeTab\]\)/.test(clientSrc));
// 渲染器那一腿：**只看「关于」页签自己的函数体**（别的页签本来就有 setSetting —— 它们
// 记的是设置，不是 star 数；按整文件判会把它们误伤成假红）。
const aboutBody = tabsSrc.slice(tabsSrc.indexOf('function renderAboutTab(ctx) {'));
// 三种越界形态的判据提成命名常量：阳性判据与下面的对照**共用同一批正则** —— 对照里重打
// 一遍正则，等于只在验证"测试自己抄得对不对"。
const ABOUT_API_CALL_RE = /api(Json|Fetch)\(/;
const ABOUT_SET_SETTING_RE = /setSetting\(/;
const ABOUT_EMIT_CALL_RE = /\bemit\s*\(/;
check('「关于」渲染器只读模块级状态（不自己发请求 / 不写设置 / 不发通知）',
  aboutBody.length > 0 && aboutBody.includes('const stars = starCountLabel();')
    && !ABOUT_API_CALL_RE.test(aboutBody) && !ABOUT_SET_SETTING_RE.test(aboutBody)
    && !ABOUT_EMIT_CALL_RE.test(aboutBody));
check('negative control: 渲染器判据对三种越界都有牙（喂进同一批常量）',
  ABOUT_API_CALL_RE.test('const x = apiJson("/star-count");')
    && ABOUT_SET_SETTING_RE.test('renderAboutTab(){ setSetting("a", 1); }')
    && ABOUT_EMIT_CALL_RE.test('renderAboutTab(){ emit(); }'));

// ══ ⑤ 公告配图的 art-gate（更新后未重启的窗口期防裂图）═══════════════════════
console.log('\n⑤ 更新公告：配图就绪门控（新面板/旧后端劈叉防裂图）');
// 面板 bundle 宿主每次开页从磁盘现读，后端路由只在 DSH 重启时换血 —— 更新后未重启
// 的窗口期里旧白名单没有 update-notice.jpg，公告若立刻弹就是裂图，而「知道了」一关
// 永久退场。三件事缺一不可：探测在（HEAD NOTICE_ART_PATH）、无图不弹（ready 才弹，
// timeout 是等满超时后的降级）、img 只在 ready 渲染（降级态不得出现裂图）。
const noticeSrc = clientSrc.slice(clientSrc.indexOf('function UpdateNotice'));
check('公告组件里有配图就绪探针（HEAD NOTICE_ART_PATH）',
  noticeSrc.includes('apiHead(NOTICE_ART_PATH)'));
check('公告等配图就绪才弹（pending 不弹；无图只在等满超时后降级出现）',
  /art === "ready" \|\| art === "timeout"/.test(noticeSrc));
check('配图 <img> 只在 ready 态渲染（降级态不得出现裂图）',
  /art === "ready" \? React\.createElement\("img"/.test(noticeSrc));
check('探针只在"会弹"时启动（已关公告的用户不发请求）',
  /if \(!eligible\) return undefined;/.test(noticeSrc));
check('negative control: 门控判据对无门控的合成组件有牙',
  !/art === "ready" \? React\.createElement\("img"/.test('function UpdateNotice() { return React.createElement("img", { src: x }); }')
    && !/art === "ready" \|\| art === "timeout"/.test('function UpdateNotice() { const show = loaded; }'));

// ── ⑤b 请求数上限 + 页面级结论缓存 ─────────────────────────────────────────
// 缘起：未重启的后端 + 面板多开几次 ⇒ 约 150 行 404 红字（用户实测反馈）。请求本身是
// 自清洁的（no-store/200 no-cache），但刷屏不是。两条腿都不读第二份字面量：退避表与
// 时限从源码现取，然后**跑真函数** —— "一个时限里到底发几个请求"是可以直接算出来的
// 事实，不是形态猜测；正负对照喂进**同一条**判据（docs/DEV-GUIDE.md §4.7 约定 5）。
// 形态判据一律只看**剥了注释的代码**：下面这些说明文字里就写着 `NOTICE_ART_POLL_MS`
// 和"固定间隔"之类的词，拿原文比会被自己误伤成真阳性。
const clientCode = stripComments(clientSrc);
const noticeCode = stripComments(noticeSrc);
const noticeTableSrc = (clientCode.match(/const NOTICE_ART_BACKOFF_MS = \[[^\]]*\];/) || [])[0] || '';
const noticeWaitSrc = (clientCode.match(/const NOTICE_ART_WAIT_MS = \d+;/) || [])[0] || '';
const noticeFnSrc = (clientCode.match(/function noticeArtSchedule\([\s\S]*?\r?\n\}/) || [])[0] || '';
check('判据前置：退避表 / 时限 / 时刻表函数都能从源码取到（否则下面几条是空转）',
  noticeTableSrc !== '' && noticeWaitSrc !== '' && noticeFnSrc !== '');
const noticePure = new Function(noticeTableSrc + noticeWaitSrc + noticeFnSrc
  + ' return { noticeArtSchedule, NOTICE_ART_BACKOFF_MS, NOTICE_ART_WAIT_MS };')();
const artSchedule = noticePure.noticeArtSchedule(noticePure.NOTICE_ART_WAIT_MS, noticePure.NOTICE_ART_BACKOFF_MS);
const artScheduleFixed = noticePure.noticeArtSchedule(noticePure.NOTICE_ART_WAIT_MS, [1500]);
check('退避表单调不降且真的退避（首拍仍与旧口径同 1.5s，末档 ≥12s）',
  noticePure.NOTICE_ART_BACKOFF_MS.length >= 3
    && noticePure.NOTICE_ART_BACKOFF_MS.every((v, i, a) => v > 0 && (i === 0 || v >= a[i - 1]))
    && noticePure.NOTICE_ART_BACKOFF_MS[0] === 1500
    && noticePure.NOTICE_ART_BACKOFF_MS[noticePure.NOTICE_ART_BACKOFF_MS.length - 1] >= 12000,
  JSON.stringify(noticePure.NOTICE_ART_BACKOFF_MS));
check('一个时限内的请求数 ≤10（旧固定 1.5s 轮询是 61 拍）',
  artSchedule[0] === 0 && artSchedule.length >= 4 && artSchedule.length <= 10,
  artSchedule.length + ' 拍：' + artSchedule.join(', '));
check('末拍仍落在时限上（"等满时限"那一拍真的发出，降级紧跟其后）',
  Math.abs(artSchedule[artSchedule.length - 1] - noticePure.NOTICE_ART_WAIT_MS) <= 1,
  artSchedule[artSchedule.length - 1] + ' vs ' + noticePure.NOTICE_ART_WAIT_MS);
check('negative control: 同一判据对旧的固定 1.5s 轮询有牙',
  artScheduleFixed.length > 10, artScheduleFixed.length + ' 拍');
// 接线上真的换了退避：只测纯函数是不够的 —— 表建了而组件仍按固定间隔排拍，上面全绿。
// 所以这里同时钉"按时刻表差值排拍"与"没有固定节奏的 setTimeout(probe, …)"（后者连
// 换成裸字面量 1500 也照样判红 —— 判据不该只认那个已退役的常量名）。
const noticeBackoffWired = (s) => s.includes('noticeArtSchedule(NOTICE_ART_WAIT_MS, NOTICE_ART_BACKOFF_MS)')
  && s.includes('schedule[i + 1] - schedule[i]') && !/setTimeout\(probe, /.test(s);
const noticeWiredOk = 'const schedule = noticeArtSchedule(NOTICE_ART_WAIT_MS, NOTICE_ART_BACKOFF_MS);'
  + ' timers.push(setTimeout(() => probe(i + 1), schedule[i + 1] - schedule[i]));';
check('组件按时刻表排拍，旧的固定间隔常量已整体退场',
  noticeBackoffWired(noticeCode) && !clientCode.includes('NOTICE_ART_POLL_MS'));
check('negative control: 接线判据对"退避表建了但组件仍按固定间隔排拍"有牙',
  noticeBackoffWired(noticeWiredOk)
    && !noticeBackoffWired(noticeWiredOk + ' timers.push(setTimeout(probe, 1500));')
    && !noticeBackoffWired(noticeWiredOk + ' timers.push(setTimeout(probe, NOTICE_ART_POLL_MS));'));
// 页面级结论缓存：面板可反复开关，但"这个后端有没有那张图"是页面级事实 ⇒ 第二轮起
// 一个请求都不发。判据要求**读**与**写**同时在（只写不读 = 缓存白建）。
const noticeVerdictCached = (s) => /let noticeArtVerdict\b/.test(s)
  && /if \(noticeArtVerdict\) \{ setArt\(noticeArtVerdict\); return undefined; \}/.test(s)
  && s.includes('noticeArtVerdict = "ready"') && s.includes('noticeArtVerdict = "timeout"');
const noticeCacheOnlyWrite = 'let noticeArtVerdict = ""; noticeArtVerdict = "ready"; noticeArtVerdict = "timeout";';
const noticeCacheOk = 'let noticeArtVerdict = "";'
  + ' if (noticeArtVerdict) { setArt(noticeArtVerdict); return undefined; }'
  + ' noticeArtVerdict = "ready"; noticeArtVerdict = "timeout";';
check('探针有页面级结论缓存（读在、两个终态都在：多开面板不复探）', noticeVerdictCached(clientCode));
check('negative control: 缓存判据对"只写不读"的形态有牙',
  !noticeVerdictCached(noticeCacheOnlyWrite) && noticeVerdictCached(noticeCacheOk));

console.log('\n' + (failed === 0 ? 'ABOUT (stars + QR) CHECKS PASSED' : 'ABOUT (stars + QR) CHECKS FAILED') + ` (${passed})`);
process.exit(failed === 0 ? 0 : 1);
