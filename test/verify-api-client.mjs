/**
 * verify-api-client.mjs — 宿主 API 客户端的守卫。
 *
 * 两件事：
 *   ① **不变量**：业务代码**零裸 `fetch(`** —— 新代码必须走 src/api-client.js（单一出入口）。
 *   ② **行为**：用注入的假 fetch 测本模块自己的契约（前缀、no-store、HEAD/DELETE 不解析、
 *      非 2xx 不改判、网络中断不抛、JSON 解析失败不吞 ok、POST 序列化）。
 *      每条带负对照。
 *
 * Usage:  node test/verify-api-client.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
// 剥注释：共享的字符串感知实现（test/tools/js-text.mjs）。
import { stripComments } from './tools/js-text.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const api = await import(new URL('../src/api-client.js', import.meta.url).href);
const { BASE, apiUrl, apiFetch, apiJson, apiHead, apiPostJson, apiDelete } = api;

/**
 * ① 的不变量：**业务代码零裸 `fetch(`** —— 客户端每个模块都必须走 `src/api-client.js`。
 * 不做"≤ 基线"的棘轮：终态就是 0，留一个基线数字只会让人以为还有余量。
 */
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log('  ✓ ' + name + (detail ? ' — ' + detail : ''));
  else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); failed++; }
};
/** 判据只认代码：调用点沿用短名 `strip`。 */
const strip = stripComments;

/**
 * 客户端全模块清单（① 与 ①b 共用）：**从磁盘枚举** `src/**`，不手抄名单。
 * 硬编码名单只守它自己：新增一个 `src` 模块、里面写裸 `fetch(`，扫描看不见它 ⇒ 全绿
 * （违反 `docs/DEV-GUIDE.md:363-364` 约定 4「判据的域应当从磁盘枚举」）。
 */
const walkSrc = (dir, out = []) => {
  let names = [];
  try { names = readdirSync(join(root, dir)); } catch { return out; }
  for (const n of names) {
    const rel = dir + '/' + n;
    let st = null;
    try { st = statSync(join(root, rel)); } catch { continue; }
    if (st.isDirectory()) walkSrc(rel, out);
    else if (n.endsWith('.js')) out.push(rel);
  }
  return out;
};
const srcWalk = walkSrc('src').sort();
/** 被判据扫描的客户端模块清单（① 与 ①b 共用）——就是磁盘枚举的结果，不额外手抄一份。 */
const CLIENT_MODULES = srcWalk;

// ── ① 零裸 fetch（客户端全模块）──────────────────────────────────────────────
console.log('\n① 裸 fetch 清点（业务代码必须为 0）');
{
  const count = (rel) => (strip(readFileSync(join(root, rel), 'utf8')).match(/\bfetch\s*\(/g) || []).length;
  const counts = CLIENT_MODULES.map((rel) => [rel, count(rel)]);
  const dirty = counts.filter(([, n]) => n > 0);
  check('客户端**全部**模块零裸 fetch（P2-9 终态）', dirty.length === 0,
    dirty.length ? dirty.map(([f, n]) => f + '=' + n).join(' ') : CLIENT_MODULES.length + ' 个模块全为 0');
  // 覆盖面断言：上面那条在"扫不到文件"时也会绿（本仓踩过 walker 静默返回空表），
  // 所以先钉住"枚举真的非退化：模块数够、出入口与主客户端都在清单里、文件非空"。
  check('负对照：磁盘枚举覆盖面成立（src/** ≥14 个模块、含出入口与主客户端、都非空）',
    CLIENT_MODULES.length === srcWalk.length && srcWalk.length >= 14
    && ['src/api-client.js', 'src/client.js', 'src/panel-tabs.js'].every((f) => CLIENT_MODULES.includes(f))
    && CLIENT_MODULES.every((rel) => readFileSync(join(root, rel), 'utf8').length > 500),
    CLIENT_MODULES.length + ' 个模块（磁盘枚举 src/**）');
  check('负对照：判据能数出合成文本里的裸 fetch',
    (strip("const r = await fetch('/x'); // fetch( in comment").match(/\bfetch\s*\(/g) || []).length === 1);
  check('src/api-client.js 存在且是出入囗模块',
    readFileSync(join(root, 'src/api-client.js'), 'utf8').includes('async function apiFetch'));
  // 唯一的 fetch 调用点在出入口模块内部（`pickFetch` 里把它取出来），不在业务代码里。
  check('fetch 只在出入口模块内部被"取用"（业务代码零调用）',
    readFileSync(join(root, 'src/api-client.js'), 'utf8').includes('const doFetch = pickFetch(o.fetch);'));
}

// ── ①b 二进制响应消费者必须 parse: false ─────────────────────────────────────
// 默认解析路径在 2xx 上把 body 交给 `response.json()`：**解析失败也照样消费流**，
// 调用点随后的 `response.blob()` / `response.arrayBuffer()` 必抛「Body is unusable」。
// 实测教训：封面（/now-playing/artwork）与 live 帧抓帧上传两条链路都因此整条静默断掉
// （推送永远 hasThumb:false、只在 7 秒一次的封面重试链里空转）。
console.log('\n①b 二进制响应消费者（.response.blob/arrayBuffer）必须 parse: false');
{
  const BIN_CONSUMER = /\.response\.(blob|arrayBuffer)\s*\(/;
  const HAS_PARSE = /parse:\s*(false|'none'|"none")/;
  const consumers = [];
  const offenders = [];
  for (const rel of CLIENT_MODULES) {
    const lines = strip(readFileSync(join(root, rel), 'utf8')).split('\n');
    lines.forEach((line, i) => {
      if (!BIN_CONSUMER.test(line)) return;
      // 同一次调用（apiFetch 与消费者的距离）都在十余行内 —— 取前 14 行做窗口。
      const near = lines.slice(Math.max(0, i - 14), i + 1).join('\n');
      const tag = rel + ':' + (i + 1);
      consumers.push(tag);
      if (!HAS_PARSE.test(near)) offenders.push(tag);
    });
  }
  check('每个二进制消费者在同一调用窗内都有 parse: false', offenders.length === 0,
    offenders.length ? '缺 parse：' + offenders.join(', ')
      : consumers.length + ' 处全带（' + consumers.join(', ') + '）');
  // 覆盖面：真扫到了消费者（否则上一条是空转恒真）
  check('覆盖面：判据扫到 ≥3 处二进制消费者', consumers.length >= 3, consumers.join(', '));
  // 负对照：喂一条缺 parse 的合成调用窗口 —— 同一条判据必须判"缺"
  const synth = ['const r = await apiFetch(url);', 'const b = await r.response.blob();'].join('\n');
  check('负对照：缺 parse: false 的合成窗口被判出', !HAS_PARSE.test(synth));
  // 正对照：带上 parse: false 的窗口不被误伤
  check('正对照：带 parse: false 的窗口不被误伤', HAS_PARSE.test('await apiFetch(url, { parse: false })\n.then((r) => r.response.blob())'));
}

// ── ② 前缀与默认值 ──────────────────────────────────────────────────────────
console.log('\n② URL 前缀 / 默认值');
{
  check('相对路径补前缀', apiUrl('/settings') === BASE + '/settings');
  check('不带斜杠也补', apiUrl('settings') === BASE + '/settings');
  check('已带前缀不重复补', apiUrl(BASE + '/settings') === BASE + '/settings');
  // 应用侧 origin 是自定义协议（dsh-app://app）：绝对 URL 判定只认 http(s) 会把
  // location.origin + path 重拼成 /wallpaper-engine/dsh-app://... 畸形路径（封面恒 404）。
  check('绝对 URL 判定认任意 scheme（自定义协议不得被重拼）',
    apiUrl('dsh-app://app/wallpaper-engine/now-playing/artwork') === 'dsh-app://app/wallpaper-engine/now-playing/artwork'
      && apiUrl('blob:http://x/y') === 'blob:http://x/y');
  check('绝对 URL 原样返回', apiUrl('https://x/y') === 'https://x/y');
  check('空值不炸', apiUrl(null) === BASE + '/' && apiUrl(undefined) === BASE + '/');

  const calls = [];
  const fake = async (url, init) => { calls.push({ url, init }); return { status: 200, text: async () => '{"a":1}' }; };
  await apiJson('/stats', { fetch: fake });
  check('默认 no-store', calls[0].init.cache === 'no-store', JSON.stringify(calls[0].init.cache));
  check('默认 GET', calls[0].init.method === 'GET');
  check('路径经前缀', calls[0].url === BASE + '/stats');
  check('负对照：显式覆盖 cache 时必须尊重', await apiFetch('/x', { fetch: fake, cache: 'force-cache' })
    .then(() => calls[calls.length - 1].init.cache === 'force-cache'));
}

// ── ③ 语义：不吞错、不误判 ──────────────────────────────────────────────────
console.log('\n③ 语义（非 2xx / 网络中断 / 解析失败）');
{
  const mk = (status, text) => async () => ({ status, text: async () => text });
  const okRes = await apiJson('/a', { fetch: mk(200, '{"v":1}') });
  check('2xx + JSON ⇒ ok 且解析出 data', okRes.ok === true && okRes.data.v === 1);
  const notFound = await apiJson('/a', { fetch: mk(404, '') });
  check('404 ⇒ ok=false 且 status 保留（由调用点决定语义）',
    notFound.ok === false && notFound.status === 404);
  const boom = await apiJson('/a', { fetch: async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; } });
  check('网络/中断 ⇒ 不抛，error 记下名字（调用点可区分 AbortError）',
    boom.ok === false && boom.status === 0 && boom.error === 'AbortError');
  const badJson = await apiJson('/a', { fetch: mk(200, 'not-json') });
  check('JSON 解析失败 ⇒ 仍是 ok（成功但无体/非 JSON），只置 error',
    badJson.ok === true && badJson.data === null && String(badJson.error).startsWith('parse:'));
  const headRes = await apiHead('/a', { fetch: mk(200, '{"should":"not parse"}') });
  check('HEAD 不解析体', headRes.data === null);
  const delRes = await apiDelete('/a', { fetch: mk(200, '{"should":"not parse"}') });
  check('DELETE 默认不解析体（很多接口 204/空体）', delRes.data === null && delRes.ok === true);
  // 非 2xx 的体：默认不读（错误页不是数据），显式要 `parse: 'always'` 才读（读宿主给的 {error}）。
  const errBody = { status: 400, text: async () => '{"error":"素材目录不存在"}' };
  const errDefault = await apiFetch('/a', { fetch: async () => errBody });
  check('非 2xx 默认**不**解析体（错误页不当数据）',
    errDefault.ok === false && errDefault.status === 400 && errDefault.data === null);
  const errAlways = await apiFetch('/a', { fetch: async () => errBody, parse: 'always' });
  check("parse:'always' 能读到宿主给的原因（4xx 的 {error}）",
    errAlways.ok === false && errAlways.data && errAlways.data.error === '素材目录不存在');
  check('本地 data:/blob: URL 原样通过（本模块也是本地字节转换的出口）',
    apiUrl('data:image/png;base64,AAA') === 'data:image/png;base64,AAA'
    && apiUrl('blob:http://x/y') === 'blob:http://x/y');
  // `fetch: null` **不是**"没有 fetch"：`pickFetch` 只认函数，任何非函数都回退到环境里的全局
  // fetch（模块契约：fetch 由调用方或全局提供，`o.fetch` 只是可选注入口）—— 于是"传 null"
  // 与"不注入"同路，会真的发请求。旧断言写成 `error === 'no-fetch' || typeof fetch === 'function'`，
  // 而 Node ≥18 上后半句恒真 ⇒ 这条从来测不出任何东西（抛错/真发网络请求都照样绿）。
  // 现在拆成两条、都无逃生门：①环境里有 fetch 时必须真的用它，且结果照常结构化、不抛；
  // ②环境里也没有 fetch 时才给 'no-fetch' 结构化失败，同样不抛。
  const isNoFetchShape = (r) => !!r && r.ok === false && r.status === 0 && r.data === null
    && r.error === 'no-fetch' && r.url === BASE + '/a';
  {
    const realFetch = globalThis.fetch;
    try {
      const seen = [];
      globalThis.fetch = async (url, init) => { seen.push({ url, init }); return { status: 200, json: async () => ({ ok: 1 }) }; };
      let viaGlobal = null, threw = null;
      try { viaGlobal = await apiFetch('/a', { fetch: null }); } catch (e) { threw = String(e); }
      check('fetch: null（非函数）⇒ 回退到全局 fetch，并按同一形状返回结果（不抛）',
        !threw && seen.length === 1 && seen[0].url === BASE + '/a'
        && viaGlobal.ok === true && viaGlobal.status === 200
        && !!viaGlobal.data && viaGlobal.data.ok === 1 && viaGlobal.url === BASE + '/a',
        threw ? '抛了：' + threw : JSON.stringify(seen));

      globalThis.fetch = undefined;
      let noFetch = null; threw = null;
      try { noFetch = await apiFetch('/a', { fetch: null }); } catch (e) { threw = String(e); }
      check('环境里也没有 fetch 时给出结构化失败而不是抛（error=no-fetch）',
        !threw && isNoFetchShape(noFetch), threw ? '抛了：' + threw : JSON.stringify(noFetch));
    } finally {
      globalThis.fetch = realFetch;
    }
  }
  check('负对照：no-fetch 形状判据对"抛了 / 形状不对 / 其实是别的原因"都有牙',
    !isNoFetchShape(null)
    && !isNoFetchShape({ ok: false, status: 0, data: null, error: 'TypeError', url: BASE + '/a' })
    && !isNoFetchShape({ ok: true, status: 200, data: {}, error: null, url: BASE + '/a' })
    && !isNoFetchShape({ ok: false, status: 0, data: null, error: 'no-fetch' }));
}

// ── ④ POST：序列化与头 ─────────────────────────────────────────────────────
console.log('\n④ POST 序列化');
{
  const calls = [];
  const fake = async (url, init) => { calls.push({ url, init }); return { status: 200, text: async () => '{}' }; };
  await apiPostJson('/x', { a: 1 }, { fetch: fake });
  check('POST 序列化 JSON 体', calls[0].init.body === '{"a":1}');
  check('POST 带 Content-Type',
    calls[0].init.headers && calls[0].init.headers['Content-Type'] === 'application/json');
  check('method 默认 POST', calls[0].init.method === 'POST');
  await apiPostJson('/x', undefined, { fetch: fake });
  check('空体 ⇒ 空对象而不是 undefined', calls[calls.length - 1].init.body === '{}');
}

// ── ⑤ 源码不变量 ────────────────────────────────────────────────────────────
console.log('\n⑤ 源码不变量');
{
  const code = strip(readFileSync(join(root, 'src/api-client.js'), 'utf8'));
  check('模块内零 !important', !/!\s*important/.test(code));
  check('模块不读 selection / DOM（纯网络出入口）', !/\bselection\b/.test(code) && !/querySelector/.test(code));
  check('不硬编码宿主地址（只走相对前缀）',
    !/https?:\/\/[a-z0-9]/i.test(code) && !/localhost|127\.0\.0\.1/i.test(code));
}

// ── ⑥ 出入口必须真的在产物里（"孤儿模块"防线）────────────────────────────────
// `src/api-client.js` 一度是**孤儿**：文件在、守卫在逐条测它，但它既不在 `INLINE_MODULES`
// 里、也没有被任何文件 import ⇒ **从不进 bundle**。那时调用点一改用它就会 ReferenceError，
// 而没有任何守卫会红 —— 浏览器半的模块只有登记进构建清单才存在。
console.log('\n⑥ 出入口已登记进构建清单、并真的进了产物');
{
  const build = readFileSync(join(root, 'scripts/build-client.mjs'), 'utf8');
  const bundle = readFileSync(join(root, 'lib/client.js'), 'utf8');
  check('INLINE_MODULES 登记了 src/api-client.js',
    /file:\s*'src\/api-client\.js'/.test(build));
  check('产物里确有 apiFetch 实现（已内联，不是只登记）',
    bundle.includes('async function apiFetch('));
  check('产物里只有**一份**实现（防"正文自带一份旧的"两处漂移）',
    (bundle.match(/async function apiFetch\(/g) || []).length === 1);
  check('负对照：登记判据对未登记的模块名有牙',
    !/file:\s*'src\/not-registered\.js'/.test(build));
}

// ── ⑦ Response 替身必须给出 `status`（`ok` 的唯一来源）──────────────────────
// **不变量**：`api-client` 的 `ok` 由 `response.status` 推出；替身若只写
// `{ ok: true, json }`（没有 status），status 被读成 0 ⇒ **一律判失败**。
// 症状却是"清单加载失败 → picker 按钮不渲染"，与网络层完全看不出关系。所以把"替身形态"
// 钉在这里：**同时带 `ok:` 与 `json:` 的替身对象必须带 `status:`**。
console.log('\n⑦ Response 替身必须带 status');
{
  const walk = (dir, out = []) => {
    let names = [];
    try { names = readdirSync(dir); } catch { return out; }
    for (const n of names) {
      const abs = join(dir, n);
      let st = null;
      try { st = statSync(abs); } catch { continue; }
      if (st.isDirectory()) walk(abs, out);
      else if (st.isFile() && /\.mjs$/.test(n)) out.push(relative(root, abs).split('\\').join('/'));
    }
    return out;
  };
  const stubFiles = [...walk(join(root, 'scripts')), ...walk(join(root, 'test'))];
  const offenders = [];
  const stubObjects = [];
  for (const rel of stubFiles) {
    const text = readFileSync(join(root, rel), 'utf8');
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== '{') continue;
      // 只认"像替身对象"的花括号：紧跟 Promise.resolve( / => ( / return
      const head = text.slice(Math.max(0, i - 16), i);
      if (!/(Promise\.resolve\(|=>\s*\(|return\s*)$/.test(head)) continue;
      let depth = 0; let j = i;
      for (; j < text.length; j++) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') { depth--; if (!depth) break; }
      }
      const block = text.slice(i, j + 1);
      if (/\bok\s*:/.test(block) && /\bjson\s*:/.test(block)) {
        stubObjects.push(rel + ':' + (text.slice(0, i).split('\n').length));
        if (!/\bstatus\s*:/.test(block)) {
          offenders.push(rel + ':' + (text.slice(0, i).split('\n').length));
        }
      }
    }
  }
  check('所有 Response 替身都带 status（ok 只能由 status 推出）', offenders.length === 0,
    offenders.length ? offenders.join(', ') : stubObjects.length + ' 个替身对象干净');
  // **覆盖面断言**：上面那句"都带 status"在扫不到文件时也会绿（本仓踩过：walk 里少导入
  // readdirSync，异常被吞 ⇒ 0 个文件、假绿）。所以先钉住"真的扫到了文件"。
  check('负对照：扫描确实覆盖到文件（>20 个 mjs，防 walker 静默返回空表）',
    stubFiles.length > 20, stubFiles.length + ' 个');
  // 域非空地板：上面那条在"扫到 0 个替身对象"时同样恒真（`stubFiles` 够多 ≠ 扫描循环有效）。
  check('覆盖面：扫描真的命中 stub 形对象 ≥ 1（域空 ⇒ 上一条恒真）',
    stubObjects.length >= 1, stubObjects.length + ' 个 stub 形对象');
  const mk = (o, j, s) => `${o ? '{ ok: true, ' : '{ '}${j ? 'json: () => x, ' : ''}${s ? 'status: 200, ' : ''}}`;
  check('负对照：判据对"缺 status 的替身"有牙、对合规替身放行',
    /\bok\s*:/.test(mk(true, true, false)) && !/\bstatus\s*:/.test(mk(true, true, false))
    && /\bstatus\s*:/.test(mk(true, true, true)));
}

console.log('');
if (failed) { console.log(`API CLIENT CHECKS FAILED — ${failed} failed`); process.exit(1); }
console.log('ALL API CLIENT CHECKS PASSED');
