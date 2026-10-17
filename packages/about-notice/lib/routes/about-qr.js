/**
 * packages/about-notice/lib/routes/about-qr.js — 「关于」页签那两张联系方式二维码 + 「更新公告」配图的**静态资源路由**：
 * `GET/HEAD <BASE>/about-qr/<文件名>`（`lib/about/` 下的 PNG/JPEG，白名单里没有的一律 404）。
 * 公告配图（`update-notice.jpg`）与二维码同走这一族：同为随包静态图、同为"会换"的图
 * （群号换了就得换码、公告配图随版本换图），URL 段沿用 `/about-qr/` 前缀 —— 本文件头注释
 * 就是口径，改名反而会 churn 两处稳定 URL。
 *
 * 为什么单独成文件：这是全插件**唯一一处"把随包文件按 URL 直出"**的资源族（其余静态面要么是
 * 用户数据 `/media`，要么是渲染页 `/scene-live`），而"URL 段怎么变成路径"必须能在一处读完 ——
 * 这段代码离用户输入最近。
 *
 * 契约：`registerAboutQrRoutes(webServer, c)`；`c` 里是这一族用到但不属于它的东西：
 *   · `disposers` / `base: BASE`  ← 清理句柄与路径前缀
 *   · `aboutDir`                  ← `lib/about/` 的绝对路径（包内资源，只读）
 *   · `serveFile`                 ← 出字节的统一出口（mime / Range / 条件 GET 都在它手里）
 *
 * 不变量（每条都有守卫）：
 *   · **路径只能来自白名单**：URL 段**不做**任何拼接 —— 先用 `decodeURIComponent` 取到名字，
 *     再在 `aboutQrFile(name)` 里**查表**换路径。没进表的名字连 `join()` 都不会被调用，
 *     于是 `..`、绝对路径、NUL、编码穿越在结构上就不可能落到白名单之外（第二道是
 *     `serveFile` 前的存在性判断）。
 *   · **只认 GET/HEAD**：其余方法 405（本路由没有写面）。
 *   · **304 由 serveFile 负责**：`revalidate` 让应答带 ETag(`size-mtime`) + `no-cache`，
 *     换掉 `lib/about/` 里的 PNG 后客户端**立刻**拿到新图（这是一张会变的图：群号换了就得换码）。
 *   · **错误响应不带缓存**（`serveFile` 的既有口径）：Electron 缓存过 404 之后即使文件到位
 *     也会一直显示旧的错误页。
 */

import { resolve, relative, isAbsolute } from 'node:path';

/**
 * 白名单：URL 段 → 文件名。**唯一**把请求映射到磁盘的地方。
 * 名字用 `String` 的精确比较（`===`），不看前缀/后缀 —— 于是 `qq-group.png.bak`、
 * `./qq-group.png`、`qq-group.png/` 之类都过不了。
 */
const ABOUT_QR_FILES = ['qq-group.png', 'douyin-group.png', 'update-notice.jpg'];

/**
 * 命中白名单返回绝对路径（含目录包含性复查），否则 null。
 * ⚠️ **不导出**：路由族模块（`lib/routes/*.js` 或组件目录里的实现文件）里每个导出函数都会被
 * 路由索引当成一个"注册入口"去解析 context 契约（多导一个普通函数会让那条判据误红）——
 * 这条规则由 `verify-route-index` 钉住。
 * 要测它就走路由（穿越 / 编码 / 未登记名字一律 404）。
 */
function aboutQrFile(name, aboutDir) {
  const hit = ABOUT_QR_FILES.find((f) => f === String(name));
  if (!hit) return null;
  const dir = resolve(aboutDir);
  const abs = resolve(dir, hit);
  // 第二道（对将来的白名单维护者）：文件名必须是该目录的**直接子项**。
  // 现在这张表里不可能有 `..`，但表是人维护的 —— 判据不依赖"人不犯错"。
  //
  // ⚠️ 判据必须**分隔符无关**：`relative()`，不是 `abs.startsWith(dir + '/')`。
  // **实测（CI windows-latest）**：前缀写法在 Windows 上必然判 null ——
  // `resolve()` 产出的是反斜杠路径，而前缀拼的是正斜杠 ⇒ 连白名单命中的图都 404
  // （本机 macOS 全绿、CI 红，症状就是这个）。
  // 这条判据与 lib/routes/fontsets.js 的 `insideDir`、lib/upload-store.js 的 `resolveUploadFile`
  // **逐字同一条**。
  const rel = relative(dir, abs);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? abs : null;
}

/** 注入契约（P2-7A / ADR-0013 D12）：本族从 `c` 消费的**必需**键 —— 门面/组件行调用点必须逐键给到（判据 test/verify-inject-contracts.mjs 双向对账）。 */
export const DEPS = ['disposers', 'base', 'aboutDir', 'serveFile'];

export function registerAboutQrRoutes(webServer, c) {
  const { disposers, base: BASE, aboutDir, serveFile } = c;

  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/about-qr`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') { res.statusCode = 405; res.end(); return; }
      const headOnly = method === 'HEAD';
      // `new URL` 会先把 `..` / `%2e%2e` / 反斜杠形式的点段规范化掉（WHATWG 语义），
      // 能走到这里的只剩"看起来像文件名"的段；随后还要过白名单。
      let url;
      try { url = new URL(req.url || '/', 'http://x'); } catch { res.statusCode = 400; res.end('bad url'); return; }
      const rest = url.pathname.slice(`${BASE}/about-qr`.length).replace(/^\/+/, '');
      if (!rest || rest.includes('/')) { res.statusCode = 404; res.end('not found'); return; }
      let name;
      try { name = decodeURIComponent(rest); } catch { res.statusCode = 400; res.end('bad encoding'); return; }
      const abs = aboutQrFile(name, aboutDir);
      if (!abs) { res.statusCode = 404; res.setHeader('Cache-Control', 'no-store'); res.end('not found'); return; }
      // revalidate：尺寸/时间未变 ⇒ 304 无体；变了 ⇒ 立刻送新图（这些都是"会换"的图：
      // 群号换了就得换码，公告配图随版本换）。serveFile 按**扩展名**给 mime —— 混排
      // PNG/JPEG 不需要这里做任何事。
      serveFile(abs, req, res, headOnly, { revalidate: true });
    },
  }));
}
