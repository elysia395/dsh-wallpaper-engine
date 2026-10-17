/**
 * routes/media-bytes.js — **原始媒体字节直出族**：`/media/<token>`（媒体原片）与
 * `/preview/<token>`（预览图）。
 *
 * 为什么这两条同文件、又为什么不并进 `media-derived.js`：本族是**字节透传** —— 除了
 * 「这次该给哪份字节」之外没有任何判定；`media-derived.js` 管的是**派生**产物
 * （源元信息 / 抽帧转码 + 进度 / 视频缩略图），两者对 `serveFile` 的用法相同、
 * 但"响应体从哪来"的答案完全不同（一个直接指磁盘，一个先算/转码再落盘）。
 *
 * 契约：`registerMediaBytesRoutes(webServer, c)`；`c` 里是这一族**用到但不属于它**的东西。
 *   · `disposers`              ← 清理句柄数组（注册返回值必须推进去，否则卸载 / HMR 后路由仍挂着）
 *   · `base`                   ← `/wallpaper-engine` 前缀
 *   · `serveFile`              ← 静态发送（Range / HEAD / 条件 GET），来自 lib/serve.js
 *   · `serveLayout`            ← 同一套语义的**段映射**版本：按虚拟布局在响应时合成字节
 *                                （moov 前置、mdat 不动，见 lib/mp4-vfs.js）
 *   · `mediaMap`               ← token → 磁盘绝对路径
 *   · `log`                    ← 首次算出虚拟布局的信息日志出口
 *   · `pinnedFaststartVariant` ← 「同一次播放钉住同一份字节布局」的定音器（实现在 lib/faststart.js）
 *
 * 不变量：
 *   · **同一次播放必须是同一份字节**：原片与虚拟布局的媒体数据偏移不同，中途换布局会让
 *     解复用器按旧偏移读新布局 ⇒ 花屏 / 解码失败。所以 `/media` **必须**经 `pinnedFaststartVariant`
 *     选片（第一次请求定音，之后钉住），不能直接问布局分析器。
 *   · 布局判不了（非 mp4 / 结构不认识 / IO 失败）一律**退回原片**：这条是优化，不是功能。
 *   · `/preview` 不参与：预览图不是视频，没有 moov 可搬。
 *   · 只放行 `GET` / `HEAD`，其余 405（带 `Allow`）。
 *   · token 由 pathname 尾部解出；空 / 未知 token 交给 `serveFile` 出 404（本族不自己判存在性）。
 */

/** 注入契约（P2-7A / ADR-0013 D12）：本族从 `c` 消费的**必需**键 —— 门面/组件行调用点必须逐键给到（判据 test/verify-inject-contracts.mjs 双向对账）。 */
export const DEPS = ['disposers', 'base', 'serveFile', 'serveLayout', 'mediaMap', 'log', 'pinnedFaststartVariant'];

export function registerMediaBytesRoutes(webServer, c) {
  const { disposers, base: BASE, serveFile, serveLayout, mediaMap, log, pinnedFaststartVariant } = c;

  // 2/3. Media + preview (stream, with Range support for `<video>` seeking).
  for (const seg of ['media', 'preview']) {
    const prefix = `${BASE}/${seg}/`;
    disposers.push(webServer.register({
      kind: 'prefix',
      path: `${BASE}/${seg}`,
      handler: (req, res) => {
        // GET 流式返回；HEAD 返回与 GET 相同的头但无 body；其余方法 405。
        const method = (req.method || 'GET').toUpperCase();
        if (method !== 'GET' && method !== 'HEAD') {
          res.statusCode = 405;
          res.setHeader('Allow', 'GET, HEAD');
          res.end('method not allowed');
          return;
        }
        const pathname = new URL(req.url || '/', 'http://x').pathname;
        const token = decodeURIComponent(pathname.slice(prefix.length));
        const abs = mediaMap.get(token);
        // faststart 虚拟布局（moov 在尾部的源）：有就按段表发 —— 播放器第一段就能拿到 moov，
        // 不必顺流整读整个文件，而磁盘上一个字节都不用搬（见 lib/mp4-vfs.js）。**但同一次播放
        // 必须始终是同一份布局**（原片与虚拟布局的偏移不同），所以由第一次请求定音、之后钉住：
        // 见 pinnedFaststartVariant。判不了就退回原片。
        const pick = seg === 'media' ? pinnedFaststartVariant(abs, token, log) : null;
        if (pick) { serveLayout(pick.layout, pick.abs, req, res, method === 'HEAD'); return; }
        serveFile(abs, req, res, method === 'HEAD');
      },
    }));
  }
}
