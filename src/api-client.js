/**
 * api-client.js — 客户端访问宿主 API 的**唯一出入口**。
 *
 * ══ 为什么需要 ════════════════════════════════════════════════════════════════
 * 裸 `fetch(` 会散落在设置、库存、上传、抓帧、诊断等各业务家族里，同一个后端契约
 * （路径前缀、`cache: "no-store"`、JSON 解析、非 2xx 语义、超时/中断）被各写一遍 ——
 * 想改一处行为（例如统一加超时、统一记诊断）必须找齐全部调用点，漏掉一处不会有任何提示。
 *
 * 本模块把"**怎么发请求**"收成一处；调用点只说"**要什么**"（path + method + 期望）。
 * 不变量（由 test/verify-api-client.mjs 断言）：**业务代码零裸 `fetch(`** ——
 * 新代码必须走本模块，没有例外名单。
 *
 * ══ 契约 ══════════════════════════════════════════════════════════════════════
 * 需要的外界：**无**（`fetch` 由调用方或全局提供，便于单测注入）。
 * 对外提供：BASE / apiUrl(path) / apiFetch / apiJson / apiHead / apiPostJson / apiDelete。
 *
 * 不变量：
 *   · **不吞错**：网络失败与非 2xx 都返回结构化结果（`{ ok, status, data, error }`），
 *     由调用点决定语义 —— 本模块不替业务决定"404 算不算失败"。
 *   · **本模块是客户端的唯一网络出口，包括 `data:` / `blob:` 这类本地 URL**：
 *     它们经 `apiUrl()` 原样通过（绝对的本地字节转换不是宿主 API，但同样走统一结果形状，
 *     于是"业务代码零裸 fetch"可以是一条干净的不变量，而不必维护例外名单）。
 *   · **何时解析体**：默认只在 2xx 解析（`parse !== false && ok`）；调用点需要读
 *     **宿主给的原因**（4xx/5xx 的 `{ error }`）时传 `parse: 'always'` —— 这条是显式的，
 *     因为"非 2xx 也可能是结构化错误体"与"错误页不是数据"两种立场都成立，选择权在调用点。
 *     HEAD/DELETE 默认不解析（避免空体报错）。
 *   · ⚠️ **二进制体必须 `parse: false`**：默认路径会把 body 交给 `response.json()`
 *     —— 解析（多半）失败没关系，但**流已经被消费**，调用点随后的
 *     `response.blob()` / `response.arrayBuffer()` 必抛「Body is unusable」。
 *     封面（`/now-playing/artwork`）、live 帧抓帧上传、转码 Range 探测都吃过这个亏。
 *   · 默认 `cache: "no-store"`：这些接口全是"读当前状态"，缓存只会带来陈旧数据。
 *     （唯一例外由调用方显式覆盖 —— 目前无例外。）
 *   · 路径一律经 `apiUrl()` 补前缀，禁止把裸路径直接交给 fetch（棘轮守卫检查的也是这一点）。
 */

const BASE = '/wallpaper-engine';

/** 拼出带前缀的 URL（path 允许已含前缀 / 已含查询串 / 是绝对或 data:/blob: URL —— 后者原样返回）。 */
function apiUrl(path) {
  const p = String(path == null ? '' : path);
  // 绝对 URL = 带 scheme 的任何地址（含 dsh-app:// 等自定义协议）——只认 http(s) 的话，
  // 会把这类地址在自定义协议 origin 下重新拼接成畸形路径（实测症状：
  // 应用侧封面恒 404，而同路径 curl 200）。
  if (/^[a-z][a-z0-9+.-]*:/i.test(p) || p.startsWith('data:') || p.startsWith('blob:')) return p;
  if (p.startsWith(BASE)) return p;
  return BASE + (p.startsWith('/') ? p : '/' + p);
}

function pickFetch(injected) {
  if (typeof injected === 'function') return injected;
  if (typeof fetch === 'function') return fetch;
  return null;
}

/**
 * 发一个请求。**不抛**（除调用方显式要求）：返回
 *   { ok, status, data, error, response }
 * `ok` 仅表示"HTTP 2xx"；`error` 是网络/中断/解析失败的说明字符串。
 */
async function apiFetch(path, options) {
  const o = options || {};
  const doFetch = pickFetch(o.fetch);
  const url = apiUrl(path);
  if (!doFetch) return { ok: false, status: 0, data: null, error: 'no-fetch', url };
  const init = { method: o.method || 'GET', cache: o.cache || 'no-store' };
  if (o.signal) init.signal = o.signal;
  if (o.headers) init.headers = o.headers;
  if (o.body !== undefined) init.body = o.body;
  // 透传我们真正用到的原生 init 字段。keepalive 必须留下：落盘 flush 靠它活过 pagehide。
  if (o.keepalive) init.keepalive = true;
  if (o.credentials) init.credentials = o.credentials;
  if (o.mode) init.mode = o.mode;
  if (o.integrity) init.integrity = o.integrity;
  let response;
  try {
    response = await doFetch(url, init);
  } catch (e) {
    // 中断（AbortError）与网络故障都走这里：调用点据 error 区分即可，不必各自 try/catch。
    return { ok: false, status: 0, data: null, error: String((e && e.name) || (e && e.message) || e), url };
  }
  const status = (response && response.status) || 0;
  const ok = status >= 200 && status < 300;
  let data = null;
  let error = null;
  // `parse: 'always'` = 连非 2xx 的体也解析（读宿主给的 `{ error }` 用）；
  // 默认只在 2xx 解析 —— 两者都由调用点显式选择，本模块不替业务猜。
  if (o.parse === 'always' || (o.parse !== false && ok && o.parse !== 'none')) {
    try {
      // **json() 优先**：替身与真实 Response 都实现它；
      // 空体（204 / 无体 200）在真实 Response 上会抛，于是再用 text() 兜一次 ——
      // 这样"只实现 json() 的替身"与"真实 Response"两种形态都能吃。
      // （反过来 text() 优先会让只实现 json() 的替身**静默读到 null**：smoke 的 fetch 替身
      // 就是这么把库存读成空、轮播定时器不武装的。）
      if (typeof response.json === 'function') {
        data = await response.json();
      } else if (typeof response.text === 'function') {
        const text = await response.text();
        data = text ? JSON.parse(text) : null;
      }
    } catch (e) {
      // 解析失败不改判 ok：有些接口成功但无体/非 JSON；由调用点看 data === null 决定。
      data = null;
      error = 'parse:' + String((e && e.message) || e);
    }
  }
  return { ok, status, data, error, response, url };
}

/** GET + 解析 JSON（最常用的一条）。 */
const apiJson = (path, options) => apiFetch(path, Object.assign({ method: 'GET' }, options));

/** HEAD（探测存在性/取响应头，不解析体）。 */
const apiHead = (path, options) => apiFetch(path, Object.assign({ method: 'HEAD', parse: false }, options));

/** POST/PUT + JSON 体（自动序列化与 Content-Type）。 */
const apiPostJson = (path, payload, options) => apiFetch(path, Object.assign({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload === undefined ? {} : payload),
}, options));

/** DELETE（多数接口不返回体；需要时传 parse: true）。 */
const apiDelete = (path, options) => apiFetch(path, Object.assign({ method: 'DELETE', parse: false }, options));

export { BASE, apiUrl, apiFetch, apiJson, apiHead, apiPostJson, apiDelete };
