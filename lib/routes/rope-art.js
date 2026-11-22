/**
 * routes/rope-art.js — **拉绳吉祥物立绘**只读族：`GET/HEAD /wallpaper-engine/rope-art/<name>.png`。
 *
 * 为什么需要它（启动性能）：桌面只需当前形态一张立绘，字节住 `assets/rope/<name>.png`
 * （随 npm 包发布）、由本族按需直出，主产物就不必背着全部立绘走。
 * 图片字节本身不改（外置是搬位置，不是重编码）。
 *
 * 不变量：
 *   · **只读、只认 PNG 文件名白名单**（`^[a-z][a-z0-9_-]*\.png$`，且拼接后仍在
 *     `assets/rope/` 内）—— 这是静态资源族，不接受路径穿越 / 其它扩展名；
 *   · **缓存**：文件名不带哈希但内容随包版本稳定，走 `serveFile(..., { revalidate: true })`
 *     的 ETag/Last-Modified 复核（升级后同名换图不会永久读旧缓存）；
 *   · 注册返回值必须推进 `c.disposers`，否则卸载 / HMR 后路由仍挂着已释放的处理器。
 *
 * 契约：`registerRopeArtRoutes(webServer, c)`；`c` 里是这一族**用到但不属于它**的东西：
 *   · `disposers` / `base`  ← 清理句柄数组与路径前缀
 *   · `serveFile`           ← 静态发送（HEAD / 条件 GET 走同一实现）
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 注入契约（ADR-0013 D12）：本族从 `c` 消费的**必需**键。 */
export const DEPS = ['disposers', 'base', 'serveFile'];

/** 运行时载荷目录（与 `assets/rope/README.md` 的契约同源）。 */
const ROPE_ART_DIR = fileURLToPath(new URL('../../assets/rope/', import.meta.url));
/** 只认小写 PNG 文件名；不允许目录分隔符（拼路径前先挡一次）。 */
const ROPE_ART_NAME_RE = /^[a-z][a-z0-9_-]*\.png$/;

export function registerRopeArtRoutes(webServer, c) {
  const { disposers, base: BASE, serveFile } = c;

  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/rope-art`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') { res.statusCode = 405; res.end('method not allowed'); return; }
      let rest;
      try {
        rest = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname.slice(`${BASE}/rope-art/`.length));
      } catch { rest = ''; }
      if (!ROPE_ART_NAME_RE.test(rest)) { res.statusCode = 404; res.end('not found'); return; }
      const abs = join(ROPE_ART_DIR, rest);
      if (!existsSync(abs)) { res.statusCode = 404; res.end('not found'); return; }
      // 同名文件随包版本可能换图 ⇒ 走 serveFile 的可重验证缓存（ETag/Last-Modified → 304），
      // 不在本族另写 Cache-Control（serveFile 会统一设 private, max-age=0, must-revalidate）。
      serveFile(abs, req, res, method === 'HEAD', { revalidate: true });
    },
  }));
}
