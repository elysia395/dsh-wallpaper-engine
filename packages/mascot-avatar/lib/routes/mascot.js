/**
 * packages/mascot-avatar/lib/routes/mascot.js — **自定义吉祥物立绘族**路由：导入（POST）/ 查看（GET、HEAD）/ 清除（DELETE）。
 *
 * 为什么独立成族（而不是复用头像那族的第三个 side）：头像按"一方一张"（`user` / `ai`），
 * 立绘**只有一张**且语义完全不同（它不是会话里的脸，而是主页面那只吉祥物的替身）——
 * 混进同一族会让"两个 side"这条不变量变成一句需要解释的话。两族共用同一套**形状**：
 * 一条 prefix 注册覆盖三个方法、raw body + MIME 白名单、原子落盘、换图清兄弟。
 *
 * 契约：`registerMascotRoutes(webServer, c)`；`c` 里是这一族**用到但不属于它**的东西。
 * 目录与上限的**服务层**（`mascotDir` / `mascotPath` / `MASCOT_EXT` / `MASCOT_MAX_BYTES`）
 * 住在 `lib/media/media-dirs.js`：`MASCOT_EXT` 与 `MASCOT_MAX_BYTES` 是 `test/verify-contracts.mjs`
 * 读取的**跨半边契约表**，且目录归属与配置目录同处一源。
 *   · `disposers` / `base`  ← 清理句柄数组与路径前缀
 *   · `serveFile`            ← 静态发送（带 Range / 条件 GET）
 *   · `mascotDir` / `mascotPath`
 *   · `MASCOT_EXT` / `MASCOT_MAX_BYTES`
 *   · `bodyReader`           ← 收 body 的**唯一**实现（上限 + 收完一次性解码）
 *   · `atomicWriteFileP`     ← 原子落盘（`.tmp` + rename）
 *   · `armBodyIdleTimeout` / `lingerClose`
 *
 * 不变量：
 *   · **只有一张**：导入前先清同族旧文件（正式文件与陈旧 `.tmp`）—— "下一次导入覆盖上一次"
 *     是用户明说的口径，也是读取侧 `mascotPath()` 的语义（它只认 `<前缀>-<stamp>.<ext>`
 *     且返回第一个命中的文件；留着旧图就是"新图导进去了、屏上还是旧图"）。
 *   · **收体走共享读体器 + 原子落盘**：上限 8MB（客户端导入前已按 512px 缩过一轮），
 *     不新增流式豁免（见 test/verify-body-caps.mjs 的两条棘轮）。
 *   · **Cache-Control 由文件名担保**：URL 上带的是文件名（`?v=<name>`），换图即换名 ⇒
 *     可以给长缓存；未导入 ⇒ 404 + `no-store`（否则导入后仍会看到上次的 404）。
 *   · 注册返回值必须推进 `c.disposers`，否则卸载 / HMR 后路由仍挂着已释放的处理器。
 */

import { readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/** 文件名里那段时间戳（`Date.now()` 的 36 进制 + 4 位随机 —— 形状见 `MASCOT_FILE_RE`）：换图即换名。 */
function mascotStamp() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** 注入契约（P2-7A / ADR-0013 D12）：本族从 `c` 消费的**必需**键 —— 门面/组件行调用点必须逐键给到（判据 test/verify-inject-contracts.mjs 双向对账）。 */
export const DEPS = ['disposers', 'base', 'serveFile', 'mascotDir', 'mascotPath', 'MASCOT_EXT', 'MASCOT_MAX_BYTES', 'atomicWriteFileP', 'armBodyIdleTimeout', 'lingerClose', 'http'];

export function registerMascotRoutes(webServer, c) {
  const {
    disposers, base: BASE, serveFile, http,
    mascotDir, mascotPath, MASCOT_EXT, MASCOT_MAX_BYTES,
    atomicWriteFileP, armBodyIdleTimeout, lingerClose,
  } = c;

  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/mascot`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      // 薄别名：保留调用点写法，实现收敛到主包的 lib/json-response.js（默认带 no-store），
      // 经注入面 `http` 送达（本包零主包说明符）。
      const json = (code, payload) => http.sendJson(res, code, payload);

      if (method === 'GET' || method === 'HEAD') {
        const p = mascotPath();
        if (!p) { json(404, { error: 'not-set' }); return; }
        // 名字在 URL 上 ⇒ 可以长缓存；serveFile 只在错误路径写 no-store，成功路径不覆盖。
        res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
        serveFile(p, req, res, method === 'HEAD');
        return;
      }

      if (method === 'DELETE') {
        const p = mascotPath();
        let removed = false;
        if (p) {
          try { unlinkSync(p); removed = true; } catch { /* ignore */ }
        }
        json(200, { ok: true, removed });
        return;
      }

      if (method !== 'POST') { json(405, { error: 'method not allowed' }); return; }

      const ctype = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const ext = MASCOT_EXT[ctype];
      if (!ext) {
        json(415, { error: '不支持的格式：' + ctype + '（仅支持 JPG / PNG / WebP）' });
        return;
      }
      const dir = mascotDir();
      let timedOut = false;
      let tooLarge = false;
      armBodyIdleTimeout(req, () => {
        timedOut = true;
        json(408, { error: 'request timeout' });
      });
      // 上限 + 收完一次性解码 —— 唯一实现见主包 lib/http-body.js（经注入面 `http`）。
      const reader = http.bodyReader(req, {
        maxBytes: MASCOT_MAX_BYTES,
        shouldStop: () => timedOut || tooLarge,
        onOverflow: () => {
          tooLarge = true;
          json(413, { error: '图片过大（上限 8MB）' });
        },
      });
      req.on('data', reader.onData);
      req.on('end', () => {
        if (timedOut || tooLarge) return;
        const body = reader.buf();
        // 空体当失败：一次 0 字节的导入只会让 `<img>` 静默裂开，不如当场报错。
        if (!body.length) { json(400, { error: 'empty body' }); return; }
        // 只有一张：同族的旧正式文件与陈旧 `.tmp` 一并清掉，再写这次的新名字。
        try {
          for (const name of readdirSync(dir)) {
            if (name.slice(0, 'mascot-'.length) !== 'mascot-') continue;
            try { unlinkSync(join(dir, name)); } catch { /* ignore */ }
          }
        } catch { /* 空目录 */ }
        const name = 'mascot-' + mascotStamp() + '.' + ext;
        atomicWriteFileP(join(dir, name), body).then(
          () => json(200, { ok: true, name, bytes: body.length }),
          () => { json(500, { error: 'write failed' }); lingerClose(req, res); },
        );
      });
      req.on('error', () => { if (!timedOut && !tooLarge) json(400, { error: 'request error' }); });
    },
  }));
}
