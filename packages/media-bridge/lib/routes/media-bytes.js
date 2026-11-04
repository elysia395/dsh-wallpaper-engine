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
export const DEPS = ['disposers', 'base', 'serveFile', 'serveLayout', 'mediaMap', 'log', 'pinnedFaststartVariant', 'ensureImagePreview'];

export function registerMediaBytesRoutes(webServer, c) {
  const { disposers, base: BASE, serveFile, serveLayout, mediaMap, log, pinnedFaststartVariant, ensureImagePreview } = c;

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
        if (seg !== 'preview') { serveFile(abs, req, res, method === 'HEAD'); return; }
        // ── /preview（issue #240）：**图片走缩略图**，缺失/生成失败回落原图 ──────────
        // 卡片只有 92px 高，此前让浏览器下载并解码整张原图（8064×5376 = 43 MP × 24 张/页）
        // ⇒ 整个渲染进程被解码/内存带宽拖住（翻页卡死数秒）。这里按需把源图缩到 320px 再发；
        // `ensureImagePreview` 失败一律回落原图（"慢一点但可用"），绝不返回 404。
        // 同时开 `{ revalidate: true }`：内容由 size+mtime 唯一确定，可安全走 304 ——
        // 重开面板 / 翻页 / 换筛选不该把同样的字节重新下一遍（原响应既无 ETag 也无 Cache-Control）。
        // ⚠️ revalidate 只开在这一条：`/media` 要支持 Range 且播放中不能换字节语义，
        // 保持默认（无缓存头）。
        if (!/\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(String(abs || ''))) {
          serveFile(abs, req, res, method === 'HEAD', { revalidate: true });
          return;
        }
        // ── `?full=1`：这条路由有两个**尺度差三个数量级**的消费者 ────────────────────
        // ① 壁纸库卡片（约 92 CSS px 高）—— #240 为此把源图缩到 320px / `-q:v 5`；
        // ② **全屏垫底图**——场景实时渲染未出帧时的占位、以及实时渲染不可用时的静态帧
        //    （见 src/live-layer-pointer.js 的 buildLivePoster 与 src/media-prep.js 的
        //    scene 兜底）。那里这条 URL 铺满整个窗口：1600 CSS px 宽时 320px 要放大 5 倍，
        //    `-q:v 5` 的再编码损耗再叠一层 ⇒ 用户看到的就是"背景图变糊"。
        // 缩略图对全屏没有意义（放大不恢复细节），再做第二档尺寸也只是换一个损失点：
        // 带 `full=1` 就**直出作者随包发布的源图字节** —— 不 spawn ffmpeg、不落缩略图缓存。
        // 这与本路由既有的回落语义同源（`ensureImagePreview` 失败时本来就发原图），
        // 且不改变默认（无参）请求：卡片那条链逐字节不变。
        if (new URL(req.url || '/', 'http://x').searchParams.get('full') === '1') {
          serveFile(abs, req, res, method === 'HEAD', { revalidate: true });
          return;
        }
        // 新清单始终用源图 token，经下面 ensureImagePreview 选择或重建缩略图。
        // 兼容旧清单已发出的缩略图 token：只直出，避免二次缩略；旧 token 没有源图映射，
        // 缓存一旦淘汰便无法恢复，不能继续把它当作公开的稳定地址。
        if (/[\\/]thumbs[\\/]ip_[0-9a-f]+\.jpg$/i.test(String(abs || ''))) {
          serveFile(abs, req, res, method === 'HEAD', { revalidate: true });
          return;
        }
        (async () => {
          const thumb = await ensureImagePreview(abs).catch(() => null);
          serveFile(thumb || abs, req, res, method === 'HEAD', { revalidate: true });
        })().catch(() => {
          res.statusCode = 404;
          res.end('not found');
        });
      },
    }));
  }
}
