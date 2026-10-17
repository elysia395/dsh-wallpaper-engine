/**
 * packages/mascot-avatar/lib/routes/avatar.js — **会话头像族**路由：导入（POST）/ 查看（GET、HEAD）/ 清除（DELETE）两张头像图。
 *
 * 为什么值得独立成文件：这三条是**唯一**会动头像目录的一组，而它们共用同一套
 * "谁是合法的一方 / 文件名长什么样 / 换图怎么清兄弟"的规则 —— 收在一处才能一次读完。
 * 依赖写在签名上（`c`）。
 *
 * 契约：`registerAvatarRoutes(webServer, c)`；`c` 里是这一族**用到但不属于它**的东西。
 * 头像目录的**服务层**（`avatarDir` / `avatarPath` / `AVATAR_SIDES` / `AVATAR_EXT` /
 * `AVATAR_MAX_BYTES`）住在 `lib/media/media-dirs.js`：`AVATAR_EXT` 是 `test/verify-contracts.mjs`
 * 读取的**跨半边契约表**，且目录归属与配置目录同处一源。它们的归属是那条依赖。
 *   · `disposers` / `base`       ← 清理句柄数组与路径前缀
 *   · `serveFile`                 ← 静态发送（带 Range / 条件 GET）
 *   · `avatarDir` / `avatarPath`  ← 头像目录与"当前那张"的定位
 *   · `AVATAR_SIDES` / `AVATAR_EXT` / `AVATAR_MAX_BYTES`
 *   · `bodyReader`                ← 收 body 的**唯一**实现（上限 + 收完一次性解码，见 lib/http-body.js）
 *   · `atomicWriteFileP`          ← 原子落盘（`.tmp` + rename，半写的图会被当成有效头像服务出去）
 *   · `armBodyIdleTimeout` / `lingerClose` ← 请求体 idle 超时与"写应答后再断"的收尾
 *
 * 不变量：
 *   · **只认两个 side**（`user` / `ai`）：路径段当白名单查，不是拼进文件名 ——
 *     路径穿越在这一步就不可能（`../` 与分隔符根本不在表里）。
 *   · **收 body 走共享读体器，不走第三个流式豁免**：上限只有 8 MB（客户端导入前已按
 *     512px 缩过一轮），缓冲在内存里完全够用；内联流式落盘是给 512 MB / 30 MB 那两条腿留的
 *     结构性豁免（见 test/verify-body-caps.mjs 的棘轮：内联收集器只许**减**、共享读体器只许**增**）
 *     ⇒ 这一条走 `bodyReader` + `atomicWriteFileP`，两边棘轮都朝收敛方向动。
 *   · **换图即清兄弟**：同一 side 的旧文件（可能换了扩展名、也可能换了时间戳）先删 ——
 *     读取侧 `avatarPath` 是按前缀扫目录取第一个命中的，留着旧文件就是
 *     "新图导进去了、屏上还是旧图"（名字每次都变，所以这里按前缀清而不是按同名清）。
 *   · **Cache-Control 由文件名担保**：URL 上带的是文件名（`?v=<name>`），换图即换名 ⇒
 *     这一条可以给出长缓存（一屏头像会渲染多份 `<img>`，不给缓存就是每个气泡一次请求）。
 *     未导入 ⇒ 404 + `no-store`（错误响应绝不能被缓存，否则导入后仍显示上次的 404）。
 *   · 注册返回值必须推进 `c.disposers`，否则卸载 / HMR 后路由仍挂着已释放的处理器。
 */

import { readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/** 文件名里那段时间戳（`Date.now()` 的 36 进制 + 4 位随机 —— 形状见 `AVATAR_FILE_RE`）：换图即换名。 */
function avatarStamp() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** 注入契约（P2-7A / ADR-0013 D12）：本族从 `c` 消费的**必需**键 —— 门面/组件行调用点必须逐键给到（判据 test/verify-inject-contracts.mjs 双向对账）。 */
export const DEPS = ['disposers', 'base', 'serveFile', 'avatarDir', 'avatarPath', 'AVATAR_SIDES', 'AVATAR_EXT', 'AVATAR_MAX_BYTES', 'atomicWriteFileP', 'armBodyIdleTimeout', 'lingerClose', 'http'];

export function registerAvatarRoutes(webServer, c) {
  const {
    disposers, base: BASE, serveFile, http,
    avatarDir, avatarPath, AVATAR_SIDES, AVATAR_EXT, AVATAR_MAX_BYTES,
    atomicWriteFileP, armBodyIdleTimeout, lingerClose,
  } = c;

  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/avatar`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      const pathname = new URL(req.url || '/', 'http://x').pathname;
      const side = decodeURIComponent(pathname.slice(`${BASE}/avatar/`.length)).replace(/\/+$/, '');
      // 薄别名：保留调用点写法，实现收敛到主包的 lib/json-response.js（默认带 no-store），
      // 经注入面 `http` 送达（本包零主包说明符）。
      const json = (code, payload) => http.sendJson(res, code, payload);
      // 只认两个 side（不变量 ①）：非法的一方连目录都不碰。
      if (!AVATAR_SIDES.includes(side)) { json(400, { error: 'bad-side' }); return; }

      if (method === 'GET' || method === 'HEAD') {
        const p = avatarPath(side);
        if (!p) { json(404, { error: 'not-set' }); return; }
        // 名字在 URL 上 ⇒ 可以长缓存（不变量 ④）。serveFile 只在错误路径写 no-store，
        // 成功路径不会覆盖这里已经写下的头；HEAD 只做磁盘探测、绝不生成。
        res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
        serveFile(p, req, res, method === 'HEAD');
        return;
      }

      if (method === 'DELETE') {
        const p = avatarPath(side);
        let removed = false;
        if (p) {
          try { unlinkSync(p); removed = true; } catch { /* ignore */ }
        }
        json(200, { ok: true, side, removed });
        return;
      }

      if (method !== 'POST') { json(405, { error: 'method not allowed' }); return; }

      const ctype = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const ext = AVATAR_EXT[ctype];
      if (!ext) {
        json(415, { error: '不支持的格式：' + ctype + '（仅支持 JPG / PNG / WebP）' });
        return;
      }
      const dir = avatarDir();
      let timedOut = false;
      let tooLarge = false;
      armBodyIdleTimeout(req, () => {
        timedOut = true;
        json(408, { error: 'request timeout' });
      });
      // 上限 + 收完一次性解码 —— 唯一实现见主包 lib/http-body.js（经注入面 `http`）。
      const reader = http.bodyReader(req, {
        maxBytes: AVATAR_MAX_BYTES,
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
        // 换图即清兄弟（不变量 ③）：同 side 的旧正式文件与陈旧 `.tmp` 一并清掉，
        // 再写这次的新名字 —— 读取侧只取第一个命中的正式文件。
        try {
          for (const name of readdirSync(dir)) {
            if (name.slice(0, side.length + 1) !== side + '-') continue;
            try { unlinkSync(join(dir, name)); } catch { /* ignore */ }
          }
        } catch { /* 空目录 */ }
        const name = side + '-' + avatarStamp() + '.' + ext;
        atomicWriteFileP(join(dir, name), body).then(
          () => json(200, { ok: true, side, name, bytes: body.length }),
          () => {
            json(500, { error: 'write failed' });
            lingerClose(req, res);
          },
        );
      });
      req.on('error', () => { if (!timedOut && !tooLarge) json(400, { error: 'request error' }); });
    },
  }));
}
