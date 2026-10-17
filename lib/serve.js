/**
 * serve.js — **字节出站套件**：把"一次文件/流响应"的全部机制收在一处。
 *
 * 它管三件事，且三者互相咬合（这也是它们必须同文件的原因）：
 *   ① **载荷传输账本**（`payloadEntry` … `payloadProgress`）—— 记 `scene.pkg` 这类大包的
 *      传输进度，供 `/scene-payload-progress` 让客户端分辨「在下载」与「出不了帧」；
 *   ② **静态发送**（`trackStream` / `serveFile` / `serveLayout`）—— Range / HEAD / 条件 GET /
 *      原子记账。`serveLayout` 是同一套语义的**段映射**版本：字节按 lib/mp4-vfs.js 算出的
 *      虚拟布局（moov 前置、mdat 不动）**在响应时合成**，磁盘上没有对应文件；
 *   ③ **壁纸自有文件服务**（`handleSceneFiles`）—— `/scene-files` 的路径围栏与 HTML 注入。
 *      `serveFile` 是它的下游（大包走 `revalidate + payloadToken`）。
 *
 * 契约：`createServeKit(c)` → `{ trackStream, serveFile, serveLayout, handleSceneFiles }`。
 *   用**工厂**而不是纯函数，是因为 `trackStream` 要把每次流登记进 `c.activeStreams`
 *   —— 那张表由 `apply()` 建、由 teardown 逐流 `destroy()`，必须与一次 `apply()` 同生命周期。
 *   `c` 里是这一族**用到但不属于它**的东西：
 *   · `activeStreams`        ← 在途流台账（teardown 靠它收尾）
 *   · `BASE`                 ← `/wallpaper-engine` 前缀（HTML 注入段的站点根声明）
 *   · `mediaMap`             ← token → 磁盘绝对路径
 *   · `log`                  ← 围栏拒绝要 warn（用户可见性：路径拼错 / 越界取文件）
 *   · `appendDiagLine`       ← 围栏拒绝落诊断环
 *   · `traceRequests` / `traceMediaRequests` ← 请求记录（应用源全记 / 媒体源只记文档型）
 *   · `readWebShim`          ← 内联 WE API shim 的源码（宿主侧唯一副本，带缓存）
 *   · `buildSeedScript`      ← 用户属性 seed 脚本（与 `/props` 共用 `userPropsFor`）
 *
 * ⚠️ **账本刻意住在模块作用域**（不在工厂里）：它是"最近看过哪些 token"的有界缓存
 *   （`PAYLOAD_LEDGER_MAX`），寿命本就该跨 `apply()` —— 放进工厂会让插件重载时把
 *   仍在传输的进度一次性丢掉。`activeStreams` 相反（per-apply），故走 `c`。
 *
 * 不变量：
 *   · 流登记**三层收尾**（`res` close / `stream` end / teardown），少一层就是 fd 泄漏
 *     （实测：每次切换壁纸漏一个句柄，直到进程退出）。
 *   · `payloadBytes` 的监听必须挂在 `pipe()` **之后**（`on('data')` 会立刻进入 flowing
 *     模式，先挂它会让首块在 pipe 装上之前被消费掉 = 响应少一段字节）。
 *   · 只是「记账失败」绝不许反过来影响服务：计数与结算全部 try/catch 兜住。
 *   · 错误响应一律 `no-store`（缓存住 404 会让"文件后来到位了"仍显示旧错误页）。
 *   · `handleSceneFiles` 的围栏是 **fail-closed**：解析异常 = 拒（不是放行）。
 */

import {
  createReadStream, existsSync, lstatSync, readFileSync, realpathSync, statSync,
} from 'node:fs';
import { Readable } from 'node:stream';
import { dirname, resolve, sep } from 'node:path';
import { weFocusGuardSource } from './we-focus-guard.js';

// ── 场景载荷传输账本 ────────────────────────────────────────────────────────
// **为什么需要它**：`/scene-files` 的 `scene.pkg` 动辄 100–336MB（实测本机
// `pkg body: 336161480 bytes`），而渲染页的**首帧**必须等整包到齐（`mountScene` 里
// `await source.scenePkg()` 在 `pkg body` 之前，见 WebWallGL 的 scene-mount）。
// 客户端的首帧看护是**墙钟**的（15s），于是"传输被饿死"会被判成"这张壁纸渲染不出来"
// 并写进共享的失败记忆。传输到底有没有在动，**只有服务端知道**（客户端拿不到渲染页
// 的下载进度，渲染页 2.0.2 也不上报）⇒ 由这里记账，经
// `GET ${BASE}/scene-payload-progress?token=…` 供看护判"有进展就不算超时"。
//
// 记账口径：**每一次**带体的 GET（含 Range）都算一次传输；`served` 只增不减（跨重试累积，
// 于是客户端可以靠"上一次采样到这一次采样之间 served 有没有涨"判活，不必对时钟）；
// `completed` 只在响应的 `finish`（整包真的写出去）时 +1 —— 客户端断开走 `close`，
// 那次传输不计完成。**这正好是"传输未完成"与"渲染页不出帧"的分野**。
//
// 有界：只留最近 `PAYLOAD_LEDGER_MAX` 个 token（长会话里看过的壁纸很多，旧条目没人再问）。
const PAYLOAD_LEDGER_MAX = 64;
const payloadLedger = new Map(); // token -> entry
let payloadTransferSeq = 0;
const payloadOpen = new Map(); // 传输 id -> { token, entry, settled }
function payloadEntry(token) {
  let entry = payloadLedger.get(token);
  if (!entry) {
    entry = { served: 0, size: 0, active: 0, transfers: 0, completed: 0, startedAt: 0, lastByteAt: 0, lastEndAt: 0 };
    payloadLedger.set(token, entry);
    while (payloadLedger.size > PAYLOAD_LEDGER_MAX) {
      const oldest = payloadLedger.keys().next();
      if (oldest.done) break;
      payloadLedger.delete(oldest.value);
    }
  } else {
    // 重新取用即视为"最近用过"：淘汰按插入序，重取要搬到表尾。
    payloadLedger.delete(token);
    payloadLedger.set(token, entry);
  }
  return entry;
}
/** 开一次带体传输（返回结算句柄；调用方在 `res` 的 finish / close 上结算）。 */
function payloadBegin(token, size) {
  const entry = payloadEntry(token);
  const id = ++payloadTransferSeq;
  entry.active += 1;
  entry.transfers += 1;
  entry.size = Math.max(entry.size, Number(size) || 0);
  if (!entry.startedAt) entry.startedAt = Date.now();
  payloadOpen.set(id, { entry, settled: false });
  return id;
}
/** 累加这次传输已经写出去的字节（喂 `served` / `lastByteAt`：客户端靠它判"还在动"）。 */
function payloadBytes(id, n) {
  const open = payloadOpen.get(id);
  if (!open || !n) return;
  open.entry.served += n;
  open.entry.lastByteAt = Date.now();
}
/**
 * 结算一次传输（`res` 的 finish = 整包写完 / close = 没写完就断了）。
 * 只生效一次：`close` 在 `finish` 之后也会来，绝不能把已完成的传输改判成未完成。
 */
function payloadSettle(id, completed) {
  const open = payloadOpen.get(id);
  if (!open || open.settled) return;
  open.settled = true;
  payloadOpen.delete(id);
  open.entry.active = Math.max(0, open.entry.active - 1);
  open.entry.lastEndAt = Date.now();
  if (completed) open.entry.completed += 1;
}
/**
 * 账本快照（`GET ${BASE}/scene-payload-progress` 的应答体）。
 * `ok:false` = 这个 token 一次传输都没见过 —— 那是**未知**，不是"没在动"：
 * 客户端据此回落墙钟预算，绝不把"宿主没记账"当成失败证据。
 */
export function payloadProgress(token) {
  const entry = token ? payloadLedger.get(token) : null;
  if (!entry) return { ok: false, token: String(token || ''), served: 0, size: 0, active: 0, transfers: 0, completed: 0, startedAt: 0, lastByteAt: 0, lastEndAt: 0 };
  return {
    ok: true,
    token: String(token),
    served: entry.served,
    size: entry.size,
    active: entry.active,
    transfers: entry.transfers,
    completed: entry.completed,
    startedAt: entry.startedAt,
    lastByteAt: entry.lastByteAt,
    lastEndAt: entry.lastEndAt,
  };
}

/** 按扩展名给 Content-Type（`lib/routes/media-derived.js` 等的替身测试同口径）。 */
function mimeFor(absPath) {
  const ext = absPath.slice(absPath.lastIndexOf('.') + 1).toLowerCase();
  return {
    mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska',
    avi: 'video/x-msvideo', mov: 'video/quicktime',
    html: 'text/html', htm: 'text/html', js: 'text/javascript', mjs: 'text/javascript',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    png: 'image/png', webp: 'image/webp', apng: 'image/apng', bmp: 'image/bmp',
    // Web-wallpaper subresources: a stylesheet served as
    // application/octet-stream is REJECTED by the browser (strict MIME
    // checking), so the full set a workshop HTML page can reference must be
    // mapped — css/json/svg/fonts/audio included.
    css: 'text/css', json: 'application/json', svg: 'image/svg+xml',
    txt: 'text/plain', xml: 'application/xml', wasm: 'application/wasm',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
    mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', wav: 'audio/wav',
    m4a: 'audio/mp4', flac: 'audio/flac', aac: 'audio/aac',
  }[ext] || 'application/octet-stream';
}

/**
 * 条件 GET 判定（ETag / Last-Modified → 304）。
 *
 * 为什么只在**显式要求**的调用点用（见 `handleSceneFiles` 的 .pkg 分支）：其余族
 * （预览图 / 上传 / 转码产物）的内容随时可能被用户改，`no-store` 是它们的正确默认。
 * 而 `scene.pkg` 的内容由 **size + mtime** 唯一确定，且一次传输就是几百 MB ——
 * 让浏览器复用手上的字节（304 无体）比重新读一遍盘便宜几个数量级。
 *
 * 语义按 RFC 9110：带 `If-None-Match` 时**忽略** `If-Modified-Since`；弱比较符
 * （`W/`）两边都剥掉再比；HTTP 日期精度只到秒 ⇒ mtime 也按秒截断比较。
 */
function notModifiedSince(req, etag, mtimeMs) {
  const headers = (req && req.headers) || {};
  const inm = headers['if-none-match'];
  if (typeof inm === 'string' && inm.trim()) {
    const want = inm.split(',').map((s) => s.trim().replace(/^W\//, ''));
    return want.includes('*') || want.includes(String(etag).replace(/^W\//, ''));
  }
  const ims = headers['if-modified-since'];
  if (typeof ims === 'string' && ims.trim()) {
    const t = Date.parse(ims);
    if (Number.isFinite(t)) return Math.floor(Number(mtimeMs) / 1000) * 1000 <= t;
  }
  return false;
}

// ── 虚拟布局（mp4-vfs）的段映射流 ──────────────────────────────────────────
// `layout.segments` 是按**虚拟字节序**排好的一段段：要么是内存里的一份字节（`buf`，目前只有
// 打了补丁的 moov），要么是原文件里的一段偏移（`srcStart`）。本函数把 `[start,end]` 切成与段
// 相交的若干片按序交给一个 Readable；**单段命中退回今天那条 `createReadStream` 快路**
// （绝大多数 `bytes=A-B` 请求落在同一个段里），跨段的（首个 `bytes=0-` 一定跨：
// ftyp + moov + mdat）走生成器。
// ⚠️ 生成器必须自己收尾内层流：`trackStream` 的 `cleanup` 只 destroy 外层那个 Readable，
//    而 Node 在 destroy 时会调生成器的 `return()` ⇒ `finally` 里的 `rs.destroy()` 才真正关掉 fd。
function layoutRangeStream(layout, absPath, start, end) {
  const parts = [];
  for (const seg of layout.segments) {
    const segEnd = seg.vStart + seg.len - 1;
    if (segEnd < start || seg.vStart > end) continue;
    parts.push({
      seg,
      from: Math.max(start, seg.vStart) - seg.vStart,
      to: Math.min(end, segEnd) - seg.vStart,
    });
  }
  if (!parts.length) return Readable.from([], { objectMode: false });
  if (parts.length === 1) {
    const { seg, from, to } = parts[0];
    if (seg.buf) return Readable.from([seg.buf.subarray(from, to + 1)], { objectMode: false });
    return createReadStream(absPath, { start: seg.srcStart + from, end: seg.srcStart + to });
  }
  return Readable.from((async function* streamParts() {
    for (const { seg, from, to } of parts) {
      if (seg.buf) { yield seg.buf.subarray(from, to + 1); continue; }
      const rs = createReadStream(absPath, { start: seg.srcStart + from, end: seg.srcStart + to });
      try { for await (const chunk of rs) yield chunk; } finally { rs.destroy(); }
    }
  })(), { objectMode: false });
}

/**
 * 入口 HTML 的四段注入 —— 宿主的**唯一构造点**。
 *
 * 顺序是契约（每一段都有判据钉住）：
 *   `data-we-site-root` → `data-we-shim` → `data-we-focus-guard` → `data-we-seed`
 *   · site-root 必须**早于 shim**：shim 首次解析 URL 前就要读到（不给它，按官方语义写
 *     `../assets/…` 的 spine 类壁纸会逃出条目目录 ⇒ 404 黑屏）。
 *   · focus-guard 必须**早于 seed**：晚于作者脚本就等于没装（帧级夺焦围栏失效）。
 *   · seed 只随 HTML 注入：严格沙箱下渲染页读不到 iframe，无法运行时补推 `__weApplyProps`。
 * 两个入口（serve 套件的文件分支、门面 `/scene-files` 路由）都调用本函数 —— 两处各写一份
 * 必然漂移（历史上就漂出过"标签在、正文是空的"）。
 *
 * @param {string} html 原始 HTML
 * @param {object} a
 * @param {string} a.token 该壁纸的覆盖值键（同时是站点根目录段）
 * @param {string} a.htmlPath 入口 HTML 的绝对路径（seed 要读同目录的 project.json）
 * @param {() => string} a.readWebShim
 * @param {(htmlPath: string, token: string) => string} a.buildSeedScript
 * @param {() => string} a.weFocusGuardSource
 * @param {string} a.BASE 路由前缀
 * @returns {string} 注入后的 HTML（无 shim 或已注入过则原样返回）
 */
function injectEntryHtml(html, { token, htmlPath, readWebShim, buildSeedScript, weFocusGuardSource, BASE }) {
  const shim = readWebShim();
  if (!shim || html.indexOf('data-we-shim') !== -1) return html;
  // 注入到 <head> 之后（最前）：shim 必须早于作者脚本执行；属性 seed 紧跟其后
  //（shim 的 __weSeedProps 若早于作者注册 listener 会挂起等待，安全）。
  // 段内的 `</script` 都先转义，否则内联脚本会被提前截断。
  const esc = (x) => x.replace(/<\/script/gi, '<\\/script');
  const seed = buildSeedScript(htmlPath, token);   // token = 该壁纸的覆盖值键
  // token 是 base64url，无需再编码。
  const siteRoot = `${BASE}/scene-files/${token}/`;
  const tag = `<script data-we-site-root="host">window.__weSiteRoot=${JSON.stringify(siteRoot)};</script>`
    + `<script data-we-shim="host">${esc(shim)}</script>`
    + `<script data-we-focus-guard="host">${esc(weFocusGuardSource())}</script>`
    + (seed ? `<script data-we-seed="host">${esc(seed)}</script>` : '');
  const m = /<head[^>]*>/i.exec(html);
  return m
    ? html.slice(0, m.index + m[0].length) + tag + html.slice(m.index + m[0].length)
    : tag + html;
}

export function createServeKit(c) {
  const {
    activeStreams, BASE, mediaMap, log, appendDiagLine,
    traceRequests, traceMediaRequests, readWebShim, buildSeedScript,
  } = c;

  // `payloadId`（可选）= 这次响应的载荷账本身份：只有**带体**的传输才有，
  // 字节数在流的 `data` 上累加（`payloadBytes`），完成/中断由 `res` 的 finish/close 结算
  //（结算挂在 serveFile 里 —— 订阅点的顺序比这里更早，不会被 clean 抢在前面）。
  // ⚠️ 计数监听必须**挂在 `pipe()` 之后**：`on('data')` 会立刻让流进入 flowing 模式，
  //    先挂它、后 pipe 有"首块在 pipe 装上之前就被消费掉"的风险（= 响应少一段字节）。
  function trackStream(stream, res, payloadId) {
    activeStreams.add(stream);
    const cleanup = () => {
      activeStreams.delete(stream);
      if (!stream.destroyed) { try { stream.destroy(); } catch { /* ignore */ } }
    };
    stream.once('end', cleanup);
    stream.once('error', (err) => {
      cleanup();
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
      } else {
        try { res.destroy(); } catch { /* ignore */ }
      }
    });
    res.once('close', cleanup);
    stream.pipe(res);
    // 记账监听挂在 pipe 之后（见上方 ⚠️）：它只**观察**已流过的块，不参与背压。
    if (payloadId) {
      stream.on('data', (chunk) => {
        try { payloadBytes(payloadId, chunk && chunk.length ? chunk.length : 0); } catch { /* 记账失败不影响服务 */ }
      });
    }
    return stream;
  }

  // headOnly: HEAD 请求返回与 GET 完全相同的头，但不开流、无 body。
  // opts（可选）：
  //   · `revalidate`  —— 可重验证缓存（ETag / Last-Modified / 304）。**默认关**：
  //     只有内容能由 size+mtime 唯一确定的载荷（scene.pkg / project.json）才该开，
  //     其余族保持 no-store（它们的内容随时可能被用户改）。
  //   · `payloadToken` —— 把这次带体传输记进载荷账本（见 payloadBegin 上方那段）。
  // 两者都只影响**响应头与记账**，不改字节、Range、HEAD 的任何既有语义。
  //
  // 字节源 `source = { path, layout? }`：`layout` 是 lib/mp4-vfs.js 算出的**虚拟布局**
  //（moov 前置、mdat 一个字节都不动 —— 见那个文件头）。**"字节从哪来"是两者唯一的区别**：
  // Range / HEAD / 条件 GET / 记账全部共用下面这一份实现（两份实现漂移一次，就会让某一族
  // 悄悄缺 Range —— 那是 `<video>` 拖不动进度的 bug）。
  function serveBytes(source, req, res, headOnly, opts) {
    const absPath = source.path;
    const layout = source.layout || null;
    if (!absPath || !existsSync(absPath)) {
      // 错误响应绝不能被宿主缓存：Electron 若缓存过 404 页，之后即使文件到位也会
      // 一直显示缓存的错误页（实测：服务端看不到请求、画面却是旧的错误文本）。
      res.setHeader('Cache-Control', 'no-store');
      res.statusCode = 404; res.end('not found'); return;
    }
    const st = statSync(absPath);
    // 虚拟布局的**总长与源完全相同**（只把 moov 挪位置，见 lib/mp4-vfs.js）⇒ Content-Length、
    // Range 端点、suffix 语义都与发原片时逐字一致；`size` 只在"布局自称的长度"上取一次。
    const size = layout ? layout.size : st.size;
    const payloadToken = opts && opts.payloadToken ? String(opts.payloadToken) : '';
    res.setHeader('Content-Type', mimeFor(absPath));
    res.setHeader('Accept-Ranges', 'bytes');
    // 条件 GET：内容由 size+mtime 钉住 ⇒ 未变就 304 无体（几百 MB 的包不必重传）。
    // 带 Range 的请求不走这条（部分内容请求的语义是"要这一段"，不是"复用手上的"）。
    if (opts && opts.revalidate) {
      const etag = 'W/"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';
      res.setHeader('ETag', etag);
      res.setHeader('Last-Modified', new Date(st.mtimeMs).toUTCString());
      res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
      if (!headOnly && !req.headers.range && notModifiedSince(req, etag, st.mtimeMs)) {
        res.statusCode = 304; res.end(); return;
      }
    }
    // 一次带体传输（GET、非 HEAD）：开账 → 计数 → 结算（finish=写完 / close=断在半路）。
    const beginPayload = (bytes) => {
      if (headOnly || !payloadToken) return 0;
      const id = payloadBegin(payloadToken, bytes);
      res.once('finish', () => payloadSettle(id, true));
      res.once('close', () => payloadSettle(id, false));
      return id;
    };
    // 开流：布局有的话走段表，否则就是今天那条 `createReadStream`。
    const openStream = (from, to) => (layout
      ? layoutRangeStream(layout, absPath, from, to)
      : createReadStream(absPath, { start: from, end: to }));
    const range = req.headers.range;
    if (range) {
      // 显式三分支：bytes=A-B / bytes=A- / bytes=-S（suffix）。
      // suffix 分支的含义是**末尾 S 字节**：bytes=-500 = 最后 500 字节，不是从 0 起的前 500 字节。
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      if (!m || (!m[1] && !m[2])) {
        // 两端皆空（bytes=-）或格式不匹配 → 不可满足。
        res.statusCode = 416;
        res.setHeader('Content-Range', `bytes */${size}`);
        res.end(); return;
      }
      let start;
      let end;
      if (m[1] && m[2]) {          // bytes=A-B
        start = parseInt(m[1], 10);
        end = Math.min(parseInt(m[2], 10), size - 1);
      } else if (m[1]) {           // bytes=A-
        start = parseInt(m[1], 10);
        end = size - 1;
      } else {                     // bytes=-S（suffix：末尾 S 字节）
        start = Math.max(0, size - parseInt(m[2], 10));
        end = size - 1;
      }
      if (start > end) {
        res.statusCode = 416;
        res.setHeader('Content-Range', `bytes */${size}`);
        res.end(); return;
      }
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      if (headOnly) { res.end(); return; }
      trackStream(openStream(start, end), res, beginPayload(end - start + 1));
      return;
    }
    res.setHeader('Content-Length', String(size));
    if (headOnly) { res.end(); return; }
    trackStream(openStream(0, size - 1), res, beginPayload(size));
  }

  // 静态文件发送（今天所有族的入口）—— 行为与本文件此前的实现逐字一致。
  function serveFile(absPath, req, res, headOnly, opts) {
    return serveBytes({ path: absPath, layout: null }, req, res, headOnly, opts);
  }

  /**
   * 按**虚拟布局**发送（moov 在尾部的 mp4 源）—— 与 `serveFile` 共享全部头发送 / Range /
   * HEAD / 记账语义，只有"字节从哪来"换成段表（见 lib/mp4-vfs.js）。
   * 任何非 `virtual` 的布局一律**退回原片**：这条路上宁可慢，也不许让壁纸播不出来。
   */
  function serveLayout(layout, absPath, req, res, headOnly) {
    if (!layout || layout.kind !== 'virtual') return serveFile(absPath, req, res, headOnly);
    return serveBytes({ path: absPath, layout }, req, res, headOnly, null);
  }

  // 3c-3. Wallpaper file endpoint: raw bytes straight from the wallpaper's own
  //       directory. Scene wallpapers use it as WebWallGL's mediaBase (the
  //       renderer fetches scene.pkg / project.json and parses the container
  //       itself — LZ4 / TEX / DXT decode all live in WebWallGL). Web
  //       wallpapers use it for the HTML entry plus its subresources, with two
  //       host duties the strict-sandbox web path needs:
  //         a) inject the WE API shim into HTML responses — under the strict
  //            sandbox the renderer page cannot reach into the wallpaper
  //            iframe, so the shim must arrive with the document itself (the
  //            same job WallpaperEM's /web/ middleware does);
  //         b) allow opaque-origin fetches via CORS — strict sandbox gives the
  //            wallpaper an opaque origin, so its fetch()/XHR carries
  //            `Origin: null` (img/script/css subresource loads are unaffected).
  //       Path-fenced to the wallpaper directory; Range via serveFile.
  /**
   * /scene-files 的请求处理，**两处挂载共用同一段逻辑**：
   *   a) 应用源（宿主插件路由，见下方 3c-3）——场景壁纸由渲染页自己 fetch
   *      scene.pkg / project.json 走这条（渲染页是同源非沙箱 frame，Desktop 的
   *      能力头栅栏放行）；
   *   b) 壁纸媒体源（我们自己监听的第二个 loopback 端口，见 ensureMediaOrigin）
   *      ——网页壁纸的入口 HTML 与其全部子资源走这条。
   * `mount` 只影响请求记录：应用源逐请求全记（场景 pkg 等，量小），媒体源只记
   * 文档型请求与错误（网页壁纸的子资源太多，全量会把诊断环冲掉）。
   */
  function handleSceneFiles(req, res, mount) {
    const tracePath = () => new URL(req.url || '/', 'http://x').pathname.slice(`${BASE}/scene-files/`.length);
    if (mount === 'app') traceRequests(res, 'scene-files', tracePath());
    else traceMediaRequests(req, res, tracePath());
    const method = (req.method || 'GET').toUpperCase();
    if (method === 'OPTIONS') {
      // 跨源预检（媒体源上的 fetch + 自定义头，例如 Range）：直接放行。
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'range, content-type',
        'Access-Control-Max-Age': '600',
        'Cache-Control': 'no-store',
      });
      res.end();
      return;
    }
    if (method !== 'GET' && method !== 'HEAD') { res.setHeader('Cache-Control', 'no-store'); res.statusCode = 405; res.end('method not allowed'); return; }
      let rest;
      try {
        rest = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname.slice(`${BASE}/scene-files/`.length));
      } catch {
        res.setHeader('Cache-Control', 'no-store');
        res.statusCode = 400; res.end('bad request'); return;
      }
      const token = rest.split('/')[0] ?? '';
      const abs = mediaMap.get(token);
      // 错误响应一律 no-store（与 serveFile 的 404 同纪律）：可重验证缓存只放行**载荷**，
      // 缓存住一个 404 会让"文件后来到位了"仍然显示旧错误。
      if (!abs) { res.setHeader('Cache-Control', 'no-store'); res.statusCode = 404; res.end('unknown-token'); return; }
      const subpath = rest.slice(token.length).replace(/^\/+/, '');
      if (!subpath) { res.setHeader('Cache-Control', 'no-store'); res.statusCode = 404; res.end('missing-subpath'); return; }
      // The wallpaper root is the directory holding scene.pkg / scene.json;
      // project.json and the web entry sit next to them. Fence the target.
      //
      // 围栏**两层，缺一不可**：
      //   a) **字面路径**必须落在 root 内（`resolve()` + `startsWith`）—— 挡 `..` 与绝对路径；
      //   b) **解析后的真实路径**也必须落在 root 内 —— `resolve()` 不认识链接，而 `serveFile`
      //      会跟随链接 ⇒ 只有 (a) 不足以把目标钉在壁纸目录里。
      //      `lstatSync` 拒最终组件是链接；`realpathSync.native` 的包含性比对覆盖"中间目录是
      //      链接"（**必须 native**：JS 版 realpathSync 在 Windows 上不解析 junction —— 实测
      //      junction 内的文件它原样返回，native 才给出真实路径）。
      // 两层共用同一个 403 出口 ⇒ 响应形状（状态码 + 体）固定。
      const root = dirname(abs);
      const target = resolve(root, subpath);
      const fenceOut = (why) => {
        appendDiagLine('fence', { route: 'scene-files', why, subpath: subpath.slice(0, 160), referer: String(req.headers.referer || '').slice(0, 120), dest: req.headers['sec-fetch-dest'] || '' });
        // 围栏拒绝 = 有请求被挡下（多半是路径拼错或第三方 HTML 在越界取文件）⇒ 影响显示效果 ⇒ warn。
        log.warn(`scene-files fenced (${why}): subpath="${subpath}" referer="${req.headers.referer || '-'}" dest=${req.headers['sec-fetch-dest'] || '-'}`);
        res.setHeader('Cache-Control', 'no-store');
        res.statusCode = 403; res.end(`forbidden-scene-files[${subpath}]`);
      };
      if (target === root || !target.startsWith(root + sep)) { fenceOut('path'); return; }
      // 「压根不存在」不在这里判 —— 交给下游的 `existsSync` / `serveFile` 出 404，免得把
      // "文件不在"报成"越界"（那会把排除故障的人引向错误方向）。**其余错误一律围栏**：
      // 解析不出来就不发。这一层刻意是 **fail-closed** —— 若"catch 里一律放行"，一个解析
      // 异常就等于围栏整层失效（`verify-scene-live` 的 junction 判据钉住这条）。
      let linked = false;
      let realTarget = '';
      let unresolved = false;
      try {
        linked = lstatSync(target).isSymbolicLink();
        realTarget = realpathSync.native(target);
      } catch (e) {
        const code = e && e.code;
        if (code !== 'ENOENT' && code !== 'ENOTDIR') unresolved = true;
      }
      if (linked) { fenceOut('symlink'); return; }
      if (unresolved) { fenceOut('unresolved'); return; }
      let realRoot;
      try { realRoot = realpathSync.native(root); } catch { realRoot = ''; }
      if (!realRoot) { fenceOut('unresolved-root'); return; }
      if (realTarget && realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) { fenceOut('realpath'); return; }
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (method === 'GET' && /\.html?$/i.test(target)) {
        // 入口 HTML 必须 no-store：它带着注入的 shim + 用户属性种子，且上游同步会
        // 换掉它携带的哈希引用（缓存住了就等于把旧种子喂给壁纸）。
        res.setHeader('Cache-Control', 'no-store');
        if (!existsSync(target)) { res.statusCode = 404; res.end('not found'); return; }
        let html;
        try { html = readFileSync(target, 'utf8'); } catch { res.statusCode = 500; res.end('read failed'); return; }
        html = injectEntryHtml(html, {
          token, htmlPath: target, readWebShim, buildSeedScript, weFocusGuardSource, BASE,
        });
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(html);
        return;
      }
      // 其余壁纸自有文件（`scene.pkg` 100–336MB、`project.json`）：内容由 size+mtime
      // 唯一确定 ⇒ 走可重验证缓存（ETag/304），并记进载荷账本 ——
      // 大包每次重建 live 层都重读一遍盘的代价，就靠这两条一起消掉。
      serveFile(target, req, res, method === 'HEAD', { revalidate: true, payloadToken: token });
  }

  return { trackStream, serveFile, serveLayout, handleSceneFiles };
}
