/**
 * json-response.js —— 宿主 JSON 应答的**唯一实现**（状态码 + 两个头 + `end`）。
 *
 * 为什么单独一个模块：这段三行样板**只许有一处实现**。抄成多份时，差异既没人看得到、
 * 也没人能判定它是有意还是漏抄 —— 现存的一个真实差异：`packages/media-bridge/lib/routes/scene-frame.js` 与
 * `packages/media-bridge/lib/routes/we-assets.js`（S5b 刀1 起出户）**不写 `Cache-Control`**，其余都写 `no-store`（见下方"缓存头口径"）。
 *
 * 缓存头口径（合并时的**唯一**取舍）：
 *   · **默认 `Cache-Control: no-store`** —— 本插件的端点全部回答**本机当前状态**
 *     （settings / 活动媒体 / 探针结果 / 配置），端口是随机的 `--port 0` 回环端口，
 *     任何一层缓存都只会让"刚改完却读到旧值"。
 *   · **`null` = 不写该头** —— 为**保持行为逐字不变**而保留的出口：调用的那一处若没有这
 *     个头，合并**不得**顺手把它加上（那是行为改动）。真要统一成 `no-store`，应当是一次
 *     **显式**的改动，而不是附带的副作用。
 *
 * 用法（路由里的局部名保留，改成薄别名即可零调用点改动）：
 *
 *   import { sendJson } from '../json-response.js';
 *   …
 *   const json = (code, payload) => sendJson(res, code, payload);
 *   const jsonOut = (code, payload) => sendJson(res, code, payload, null); // 不写缓存头
 *
 * ⚠️ **这不是 `bodyReader`（`lib/http-body.js`）的对偶**：那个解决"收请求体不许抄漏上限"，
 * 这个解决"发应答不许抄出差异"。两者都是**同一件事只有一处实现**这条约定的产物。
 *
 * 浏览器安全无关（这是宿主半边），只依赖 `node:zlib`。
 */

import { gzipSync } from 'node:zlib';

/**
 * 压缩阈值（字节）：低于它不压 —— 省不下 1 KB，却要多一次 CPU 与两个响应头。
 * 与宿主 webserver 的 `compressionThresholdBytes` 默认值（1024）同口径。
 */
const GZIP_MIN_BYTES = 1024;

/**
 * 压缩级别：与宿主 webserver 的默认级别同口径（`DEFAULT_COMPRESSION_LEVEL = 1`）。
 * 这一条跑在宿主的事件循环上 ⇒ 取"快"而不是"最小"（大 JSON 上 1 与 6 的差距约一成，
 * CPU 却差数倍）。
 */
const GZIP_LEVEL = 1;

/**
 * 客户端是否接受 gzip（`Accept-Encoding` 协商；`gzip;q=0` = 明确不要）。
 *
 * ⚠️ 请求从 `res.req` 取（Node 的 `ServerResponse` 自带这个引用）—— **不改本函数的签名**：
 *    几十个薄别名调用点一个都不用动；测试台架的假 `res` 没有 `req` ⇒ 走不压缩那条路，
 *    与旧行为逐字节相同。
 */
function acceptsGzip(res) {
  const req = res && res.req;
  const header = req && req.headers ? req.headers['accept-encoding'] : undefined;
  if (typeof header !== 'string') return false;
  const m = /(?:^|,)\s*gzip\s*(?:;\s*q=([0-9.]+))?\s*(?=,|$)/i.exec(header);
  return !!m && (m[1] === undefined || Number(m[1]) > 0);
}

/**
 * 发一个 JSON 应答（`application/json; charset=utf-8`，可带 `Cache-Control`；
 * 客户端声明支持 gzip 且载荷 ≥ 1 KB 时按 `Content-Encoding: gzip` 发出）。
 *
 * @param {import('node:http').ServerResponse} res
 * @param {number} code HTTP 状态码。
 * @param {unknown} payload 载荷（由 `JSON.stringify` 序列化）。
 * @param {string|null} [cacheControl='no-store'] `Cache-Control` 的值；
 *   **`null` 表示不写该头**（见文件头"缓存头口径"）。
 */
export function sendJson(res, code, payload, cacheControl = 'no-store') {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (cacheControl !== null) res.setHeader('Cache-Control', cacheControl);
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  // ── 协商式压缩（#158：大库的 /inventory 是 MB 级载荷）──────────────────────────
  // 只在客户端声明支持 gzip、载荷够大、且**不是 HEAD** 时才压（HEAD 与宿主 `compression`
  // 中间件同口径：只回头、不回体）。没有 `accept-encoding`（本仓全部测试台架的假 res）
  // ⇒ 逐字节与旧行为相同。
  //
  // ⚠️ 与宿主 webserver 的 gzip 中间件**不冲突**：`compression` 见到响应上已经有
  //    `Content-Encoding` 就走 already-encoded 分支不再压（实测其 index.js）
  //    ⇒ 宿主开着（profile 里 `compression: gzip`）也只会压一次；宿主关着（默认
  //    `compression: none`）则这里就是唯一那道。
  const req = res && res.req;
  if (body.length >= GZIP_MIN_BYTES && !(req && req.method === 'HEAD')) {
    res.setHeader('Vary', 'Accept-Encoding');
    if (acceptsGzip(res)) {
      res.setHeader('Content-Encoding', 'gzip');
      res.end(gzipSync(body, { level: GZIP_LEVEL }));
      return;
    }
  }
  res.end(body);
}
