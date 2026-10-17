/**
 * routes/upload.js — **上传资产族**路由：导入（`/upload`）、删除（`/remove`）与
 * 上传目录切换（`/upload-dir`）。
 *
 * 为什么值得独立成文件：这三条路由是**唯一**会写上传目录的一组 ——
 * "谁能动上传目录、动完谁负责迁移"收在本文件里就能一次读完。
 * 这三条注册与它们的依赖都在一处，
 * 而**依赖写在签名上**（`c`）。
 *
 * 契约：`registerUploadRoutes(webServer, c)`；`c` 里是这一族**用到但不属于它**的东西。
 * 上传资产的**存储层**（`ensureUploadDir` / `readUploadMeta` / `metaEntry` / `setUploadMeta` /
 * `removeUploadMeta` / `resolveUploadFile` / `setUploadDir` / `UPLOAD_MAX_BYTES`）住在
 * `lib/upload-store.js`（`normalizeUserDir` 也由它导出）；MIME→扩展名契约表 `UPLOAD_EXT` 随
 * 「目录与路径」族住在 `lib/media/media-dirs.js`。两者都由门面注入，不是路由族的私产：存储层由
 * `/inventory` 与上传族共用（`/we-assets-dir` 只用到 `normalizeUserDir`），`UPLOAD_EXT` 是
 * `test/verify-contracts.mjs` 读取的**跨半边契约表**。它们的归属是那条依赖，不是路由族的边界。
 *   · `disposers` / `base`        ← 清理句柄数组与路径前缀
 *   · `tokenFor`                  ← `apply` 作用域的 token 生成器（多族共用）
 *   · `UPLOAD_EXT` / `UPLOAD_MAX_BYTES` ← MIME→扩展名映射与 512MB 上限
 *   · `CONTROL_JSON_MAX_BYTES`    ← 小控制面 JSON 请求体的统一上限（64KB，见下"收 body"）
 *   · `ensureUploadDir` / `readUploadMeta` / `metaEntry` / `setUploadMeta` / `removeUploadMeta`
 *   · `resolveUploadFile` / `setUploadDir` / `normalizeUserDir`
 *   · `armBodyIdleTimeout` / `lingerClose` ← 请求体 idle 超时与"写应答后再断"的收尾
 *
 * 不变量：
 *   · **收 body 必须同时满足两条**（本族是本仓该不变量的权威表述处）：
 *     ① **有上限** —— 逐块累加却从不比较长度，异常大的请求体会把宿主堆无界撑大（默认只听
 *        loopback，但 webserver 允许 `host: 0.0.0.0`，而这几条都是 POST）。上限用
 *        `CONTROL_JSON_MAX_BYTES`（小控制面 JSON），大载荷走流式落盘那条腿（见下）。
 *     ② **收完一次性解码** —— 逐块 `body += chunk` 会把落在两个 TCP 分片之间的多字节码点
 *        切成 U+FFFD，用户可见字符串（壁纸 id / 字体名 / 字体族）被静默写坏且客户端不知道。
 *        正确形态是 `chunks.push(chunk)` + `Buffer.concat(chunks).toString('utf8')`。
 *     判据：`test/verify-body-caps.mjs` 从磁盘枚举**每一个** `req.on('data')` 站点并断言上限在位 ——
 *     这条从"靠人记得抄"改成机器判。
 *   · **上传目录是跨族共享的可变量**：本模块一律经上面那些模块级助手读写它，**不得**缓存目录值的
 *     副本 —— `setUploadDir` 会重新赋值它，缓存副本会让"改了目录却仍写回老目录"静默发生。
 *   · **流式落盘**：边收边写 `.tmp`、边更新 sha256，完成后 rename 发布。**不得**把上限 512MB 的
 *     请求体整个缓冲在内存里；`.tmp` 与目标同目录，rename 才是同设备原子操作。
 *   · **中途断开必须清理**：上传中途关标签页 / 断网不会走 `req 'end'` / `'error'` / 超时
 *     ⇒ `req 'close'` 里必须销毁写流并清 `.tmp`，否则上传目录里留下一个打开的文件描述符与
 *     最多 512MB 的 `.tmp`（启动清扫只看 transcode / ffmpeg / preview 目录，不扫 uploads）。
 *     而 `completed` 置位后**不得**再销毁写流 —— 否则发布回调不执行，文件永远停在 `.tmp`。
 *   · **内容去重**：同 sha256 的重复上传返回既有条目（`duplicate: true`）并丢弃刚收的临时文件；
 *     meta 的 sha256 **无条件写**（没有 title 也要写），否则去重比对不到哈希、形同虚设。
 *   · **背压**：`ws.write` 返回 false ⇒ `req.pause()`，`'drain'` 后恢复。
 *   · `armBodyIdleTimeout` 60s 无数据 ⇒ 408（客户端连上不发数据不得永久占住 socket）。
 *   · `/remove` 只删 uploads 目录内、`up-…` 形状的 id：`resolveUploadFile` 复检规范化后的前缀
 *     ⇒ 路径穿越不可能（id 由宿主生成，不接受调用方给的路径）。
 *   · `/upload-dir` 只接受**绝对路径**（`normalizeUserDir`），且该路径必须能解析成目录
 *     （缺失则 mkdir；存在但不是目录 ⇒ 400），否则拒绝而不是留下一个坏配置。
 *   · 注册返回值必须推进 `c.disposers`，否则卸载 / HMR 后路由仍挂着已释放的处理器。
 */

import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
// 收 body 的**唯一缓冲实现**（累加 + 字节计闸 + 一次解码）；流式落盘那两处是本模块的
// 结构性豁免，见 `lib/http-body.js` 文件头与下面的"流式落盘"不变量。
import { bodyReader } from '../http-body.js';

/** 注入契约（P2-7A / ADR-0013 D12）：本族从 `c` 消费的**必需**键 —— 门面/组件行调用点必须逐键给到（判据 test/verify-inject-contracts.mjs 双向对账）。 */
export const DEPS = ['disposers', 'base', 'tokenFor', 'UPLOAD_EXT', 'UPLOAD_MAX_BYTES', 'CONTROL_JSON_MAX_BYTES', 'ensureUploadDir', 'readUploadMeta', 'metaEntry', 'setUploadMeta', 'removeUploadMeta', 'resolveUploadFile', 'setUploadDir', 'normalizeUserDir', 'armBodyIdleTimeout', 'lingerClose'];

export function registerUploadRoutes(webServer, c) {
  const {
    disposers, base: BASE, tokenFor, UPLOAD_EXT, UPLOAD_MAX_BYTES, CONTROL_JSON_MAX_BYTES,
    ensureUploadDir, readUploadMeta, metaEntry, setUploadMeta, removeUploadMeta,
    resolveUploadFile, setUploadDir, normalizeUserDir, armBodyIdleTimeout, lingerClose,
  } = c;
  // 4. Custom upload (raw body; MIME whitelist; writes into the uploads dir).
  //    Returns the new wallpaper entry so the client can refresh the inventory.
  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/upload`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'POST') {
        res.statusCode = 405; res.end('method not allowed'); return;
      }
      const query = new URL(req.url || '/', 'http://x').searchParams;
      const title = (query.get('title') || '').trim().slice(0, 80);
      const ctype = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const ext = UPLOAD_EXT[ctype];
      if (!ext) {
        res.statusCode = 415;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({
          error: '不支持的格式：' + ctype + '（仅支持 JPG / PNG / MP4）',
        }));
        return;
      }
      // 流式落盘：边收边写 .tmp 文件、边更新 sha256，完成后 rename 发布 —
      // 不把最多 512MB 的文件整个缓冲在内存里。.tmp 在同目录，rename 为
      // 同设备原子操作；失败路径（超限/超时/写错误）由 ws 'close' 清理临时文件。
      const dir = ensureUploadDir();
      const id = 'up-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      const fileAbs = join(dir, id + '.' + ext);
      const tmpAbs = fileAbs + '.tmp';
      const hash = createHash('sha256');
      const ws = createWriteStream(tmpAbs);
      let size = 0;
      let failed = false;
      let completed = false; // 请求已成功应答 (临时文件已 rename 或本就该保留)
      let tmpCleaned = false; // 防重复清理
      const cleanupTmp = () => {
        if (tmpCleaned) return;
        tmpCleaned = true;
        try { unlinkSync(tmpAbs); } catch { /* ignore */ }
      };
      const fail = (code, payload) => {
        if (failed) return;
        failed = true;
        try { ws.destroy(); } catch { /* ignore */ } // 'close' 里 cleanupTmp
        res.statusCode = code;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(payload));
        lingerClose(req, res);
      };
      ws.on('error', () => fail(500, { error: 'upload write failed' }));
      ws.on('close', () => { if (failed) cleanupTmp(); });
      // 上传中途关标签页/断网：不会走 req 'end' / 'error' / 超时 ⇒ 必须在这里销毁写流
      // 并清 .tmp。否则上传目录里留下一个打开的文件描述符 + 最多 512MB 的 .tmp
      //（启动清扫只看 transcode/ffmpeg/preview 目录，不扫 uploads）。
      req.once('close', () => {
        if (completed || failed) return;
        failed = true;
        try { ws.destroy(); } catch { /* ignore */ } // 'close' 里 cleanupTmp
        cleanupTmp();
      });
      // 60s 无数据即超时（见 armBodyIdleTimeout）。
      armBodyIdleTimeout(req, () => fail(408, { error: 'request timeout' }));
      req.on('data', (c) => {
        if (failed) return;
        size += c.length;
        if (size > UPLOAD_MAX_BYTES) {
          fail(413, { error: '文件过大（上限 512MB）' });
          return;
        }
        hash.update(c);
        // 背压：写流缓冲满时暂停读取，drain 后恢复。
        if (!ws.write(c)) req.pause();
      });
      ws.on('drain', () => { if (!failed) req.resume(); });
      req.on('end', () => {
        if (failed) return;
        // 请求体已完整收到: 从此处起临时文件由下面的 ws.end 回调负责发布
        // (rename 或清理), req 'close' 不得再销毁写流 (否则回调不会执行)。
        completed = true;
        ws.end(async () => {
          try {
            const sha = hash.digest('hex');
            // Content dedup: uploading the SAME file again must not create a
            // duplicate entry — return the existing wallpaper instead. meta
            // stores each upload's sha256; legacy entries without a hash never
            // match, so pre-existing uploads are unaffected.
            const meta = readUploadMeta();
            let dupId = null;
            for (const metaId of Object.keys(meta)) {
              if (metaEntry(meta, metaId).sha256 === sha) { dupId = metaId; break; }
            }
            if (dupId) {
              const existing = resolveUploadFile(dir, dupId);
              if (existing && existsSync(existing)) {
                // 内容已存在：丢弃刚收的临时文件，返回既有条目。
                failed = true; // 让 ws 'close' 清掉临时文件
                const eext = existing.slice(existing.lastIndexOf('.') + 1).toLowerCase();
                const etype = eext === 'mp4' ? 'video' : 'image';
                const etitle = metaEntry(meta, dupId).title || dupId;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({
                  id: dupId,
                  title: etitle,
                  type: etype,
                  playable: true,
                  duplicate: true,
                  media: `${BASE}/media/${tokenFor(existing)}`,
                  preview: etype === 'image' ? `${BASE}/preview/${tokenFor(existing)}` : null,
                }));
                return;
              }
              // meta says the id exists but the file is gone — fall through and
              // store a fresh copy under a new id.
            }
            renameSync(tmpAbs, fileAbs);
            // meta 无条件写（即便无 title 也记 sha256）：否则重复上传同一文件
            // 时 dedup 比对不到哈希，内容去重形同虚设。
            // 写已串行化（enqueueConfigWrite）⇒ **等它落盘再应答**：保持"响应即已持久化"，
            // 且下一次上传的 dedup 一定读得到这次的 sha256。
            await setUploadMeta(id, title || id, sha);
            const type = ext === 'mp4' ? 'video' : 'image';
            const payload = {
              id,
              title: title || id,
              type,
              playable: true,
              media: `${BASE}/media/${tokenFor(fileAbs)}`,
              preview: type === 'image' ? `${BASE}/preview/${tokenFor(fileAbs)}` : null,
            };
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(payload));
          } catch (err) {
            failed = true; // 让 ws 'close' 清掉临时文件
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
          }
        });
      });
      req.on('error', () => {
        if (!failed) {
          failed = true;
          try { ws.destroy(); } catch { /* ignore */ } // 'close' 里 cleanupTmp
          res.statusCode = 400; res.end('request error');
        }
      });
    },
  }));

  // 5. Custom upload removal — ONLY files inside the uploads dir with an
  //    `up-…` id (path traversal is impossible: the id is host-generated and
  //    resolveUploadFile re-checks the normalized prefix).
  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/remove`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'POST') {
        res.statusCode = 405; res.end('method not allowed'); return;
      }
      // 60s 无数据即超时（见 armBodyIdleTimeout）。
      let timedOut = false;
      let tooLarge = false;
      armBodyIdleTimeout(req, () => {
        timedOut = true;
        res.statusCode = 408;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'request timeout' }));
      });
      // 上限 + 收完一次性解码 —— 这两件事的唯一实现在 `lib/http-body.js`。
      const reader = bodyReader(req, {
        maxBytes: CONTROL_JSON_MAX_BYTES,
        shouldStop: () => timedOut,
        onOverflow: () => {
          tooLarge = true;
          res.statusCode = 413;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'payload too large' }));
        },
      });
      req.on('data', reader.onData);
      req.on('end', async () => {
        if (timedOut || tooLarge) return;
        const body = reader.text();
        let id = null;
        try { id = JSON.parse(body || '{}').id; } catch { /* ignore */ }
        const dir = ensureUploadDir();
        const abs = resolveUploadFile(dir, id);
        if (!abs) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'invalid upload id' }));
          return;
        }
        let removed = false;
        try { unlinkSync(abs); removed = true; } catch { /* ignore */ }
        // meta 写已串行化（enqueueConfigWrite）⇒ 等它落盘再应答（"响应即已持久化"）。
        await removeUploadMeta(id);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ removed }));
      });
      req.on('error', () => { res.statusCode = 400; res.end('request error'); });
    },
  }));

  // 6. Change the upload directory (persisted to config.json; survives
  //    restarts without env setup). Existing uploads migrate to the new
  //    location by default. The user enters an absolute path in the settings
  //    UI — most users prefer their data off the system (C:) drive.
  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/upload-dir`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'POST') {
        res.statusCode = 405; res.end('method not allowed'); return;
      }
      // 与同族其它两条同口径：idle 超时 + 上限 + 收完一次性解码（见文件头不变量）。
      let timedOut = false;
      let tooLarge = false;
      armBodyIdleTimeout(req, () => {
        timedOut = true;
        res.statusCode = 408;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'request timeout' }));
      });
      // 上限 + 收完一次性解码 —— 唯一实现见 `lib/http-body.js`。
      const reader = bodyReader(req, {
        maxBytes: CONTROL_JSON_MAX_BYTES,
        shouldStop: () => timedOut,
        onOverflow: () => {
          tooLarge = true;
          res.statusCode = 413;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'payload too large' }));
        },
      });
      req.on('data', reader.onData);
      req.on('end', () => {
        if (timedOut || tooLarge) return;
        const body = reader.text();
        let dirRaw = null;
        let migrate = true;
        try {
          const o = JSON.parse(body || '{}');
          dirRaw = o.dir;
          migrate = o.migrate !== false;
        } catch { /* ignore */ }
        const dir = normalizeUserDir(dirRaw);
        if (!dir) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({
            error: '请输入有效的绝对路径（如 D:\\MyWallpapers 或 /data/wallpapers）',
          }));
          return;
        }
        // The path must resolve to a directory (mkdir when missing; reject a
        // path that exists as a FILE).
        try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
        let isDir = false;
        try { isDir = statSync(dir).isDirectory(); } catch { /* ignore */ }
        if (!isDir) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: '无法在该路径创建目录（权限不足或路径被占用）' }));
          return;
        }
        // setUploadDir 是异步的（迁移走线程池 + 写串行化）。
        setUploadDir(dir, migrate).then(
          (result) => {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(result));
          },
          (err) => {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
          },
        );
      });
      req.on('error', () => { res.statusCode = 400; res.end('request error'); });
    },
  }));
}
