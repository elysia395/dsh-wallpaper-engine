/**
 * routes/live-frame.js — **网页壁纸首帧缓存**族路由：`/live-frame/<token>`。
 *
 * 场景：网页壁纸 live 渲染起来后，客户端抓一帧（`__wp.capture`）POST 到这里存成 JPEG；
 * 之后每次加载 / 重启都在启动延迟里先显示这张图，而不是黑屏（还没有缓存 → 客户端回落到
 * 壁纸的 schemecolor）。GET 侧按**入口文件的 mtime** 校验新鲜度 ⇒ 壁纸更新后旧帧自动作废。
 *
 * 契约：`registerLiveFrameRoutes(webServer, c)`；`c` 里是这一族**用到但不属于它**的东西：
 *   · `disposers`           ← 清理句柄数组
 *   · `base`                ← `/wallpaper-engine` 前缀
 *   · `mediaMap`            ← token → 磁盘绝对路径（同一 Map 实例，传值）
 *   · `serveFile`           ← 静态发送（Range / HEAD；本族的 GET 走它）
 *   · `traceRequests`       ← 请求落 `http.jsonl`（本族每条请求都会记一行）
 *   · `liveFrameFile`       ← token 对应的缓存文件路径（与 backfill / sweep 共用同一份命名）
 *   · `atomicWriteFileSync` ← 原子写（先写 .tmp 再 rename，避免读到半张图）
 *   · `lingerClose`         ← 应答先发、排空后再断（收体失败腿用）
 * 收体的 `bodyReader` 由本模块**自己 import**（不经 `c`，见 verify-body-caps 的逐文件断言）。
 *
 * 不变量：
 *   · **只接受 JPEG**：体首两字节必须是 `FF D8`，否则 415 —— 别把 PNG/WebP 塞进这个 `.jpg`。
 *   · **有上限**：4MB（`bodyReader.maxBytes`）超限即 413，未超限也**一次性解码**。
 *   · 新鲜度判据是 `缓存 mtime >= 入口 mtime`，不新鲜即 404 `no-frame`（客户端回落）。
 *   · 写盘走原子替换；`done` 旗标保证任何一条失败腿都只应答一次。
 */

import { statSync } from 'node:fs';
import { bodyReader } from '../http-body.js';

/** 注入契约（P2-7A / ADR-0013 D12）：本族从 `c` 消费的**必需**键 —— 门面/组件行调用点必须逐键给到（判据 test/verify-inject-contracts.mjs 双向对账）。 */
export const DEPS = ['disposers', 'base', 'mediaMap', 'serveFile', 'traceRequests', 'liveFrameFile', 'atomicWriteFileSync', 'lingerClose'];

export function registerLiveFrameRoutes(webServer, c) {
  const {
    disposers, base: BASE, mediaMap, serveFile, traceRequests,
    liveFrameFile, atomicWriteFileSync, lingerClose,
  } = c;

  // 3c-4. Automatic first-frame cache for WEB wallpapers: once live rendering is
  //       up, the client captures one frame (`__wp.capture`) and POSTs it here —
  //       every later load/restart shows it during the boot delay instead of a
  //       black screen (no cache yet → the client falls back to the wallpaper's
  //       schemecolor). GET validates freshness against the entry file's mtime,
  //       so an updated wallpaper invalidates its stale frame automatically.
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/live-frame`,
    handler: (req, res) => {
      traceRequests(res, 'live-frame', new URL(req.url || '/', 'http://x').pathname.slice(`${BASE}/live-frame/`.length));
      const method = (req.method || 'GET').toUpperCase();
      let token;
      try {
        token = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname
          .slice(`${BASE}/live-frame/`.length)).replace(/\/+$/, '');
      } catch { res.statusCode = 400; res.end('bad request'); return; }
      const abs = mediaMap.get(token);
      if (!abs) { res.statusCode = 404; res.end('unknown-token'); return; }
      if (method === 'GET' || method === 'HEAD') {
        const file = liveFrameFile(abs);
        let fresh;
        try { fresh = statSync(file).mtimeMs >= statSync(abs).mtimeMs; } catch { fresh = false; }
        if (!fresh) { res.statusCode = 404; res.end('no-frame'); return; }
        res.setHeader('Cache-Control', 'no-store');
        serveFile(file, req, res, method === 'HEAD');
        return;
      }
      if (method !== 'POST') { res.statusCode = 405; res.end('method not allowed'); return; }
      let done = false;
      const fail = (code) => {
        if (done) return;
        done = true;
        res.statusCode = code; res.end();
        lingerClose(req, res);
      };
      const reader = bodyReader(req, {
        maxBytes: 4 * 1024 * 1024,
        shouldStop: () => done,
        onOverflow: () => fail(413),
      });
      req.on('data', reader.onData);
      req.on('end', () => {
        if (done) return;
        done = true;
        try {
          const buf = reader.buf();
          if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) { res.statusCode = 415; res.end('not jpeg'); return; }
          atomicWriteFileSync(liveFrameFile(abs), buf);
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: true, bytes: buf.length }));
        } catch (err) {
          res.statusCode = 500;
          res.end(String(err && err.message ? err.message : err));
        }
      });
      req.on('error', () => { done = true; });
    },
  }));
}
