/**
 * routes/scene-serve.js — **场景载荷服务族**路由：live 渲染页（`/scene-live`）、壁纸自有文件
 * （`/scene-files`）与媒体源诊断（`/media-origin`）。
 *
 * 为什么值得独立成文件：这三条路由回答同一个问题 —— **渲染页与壁纸载荷从哪个源、
 * 经哪条路径出去**（同源应用源 / 我们自监听的第二个 loopback 端口）。
 * "哪条路径服务什么、围栏在哪"都在一处，
 * 而**依赖写在签名上**（`c`）。
 *
 * 契约：`registerSceneServeRoutes(webServer, c)`；`c` 里是这一族**用到但不属于它**的东西：
 *   · `disposers` / `base`            ← 清理句柄数组与路径前缀
 *   · `WEBWALLGL_DIR`                  ← vendored 渲染页根目录（`/scene-live` 的目录围栏基准）
 *   · `traceRequests`                  ← 逐请求记录（应用源；媒体源那条在 handleSceneFiles 内）
 *   · `serveFile`                      ← 静态发送器（Range / HEAD / 缓存头）
 *   · `appendDiagLine`                 ← 围栏拒绝的落盘留痕
 *   · `log`                            ← `lib/log.js` 的宿主日志入口（围栏拒绝按 `warn` 分级）
 *   · `handleSceneFiles`               ← `/scene-files` 的**共用处理函数**（两处挂载：应用源 + 媒体源）
 *   · `mediaOriginInfo`                ← 媒体源地址与端口的**访问器**
 *   · `payloadProgress`                ← 载荷传输账本快照（首帧看护分辨「在下载」与「出不了帧」）
 * 媒体源服务本身（`handleSceneFiles` / `ensureMediaOrigin` / `mediaOrigin*`）留在 `lib/index.js`：
 * `/inventory` 也消费 `mediaOriginBase()`（给网页壁纸拼 media/preview 前缀），而 `mediaOrigin`
 * 是那个作用域的**可变量** ⇒ 只能以函数/访问器形式出去，传值就是陈旧快照。
 *
 * 不变量：
 *   · **两处挂载共用同一段处理逻辑**（`handleSceneFiles(req, res, mount)`）：应用源与媒体源的行为
 *     必须一致（目录围栏 / CORS / shim+seed 注入 / Range）；`mount` **只**影响请求记录 ——
 *     应用源逐请求全记（量小），媒体源只记文档型请求与错误（网页壁纸子资源太多，全量会冲掉诊断环）。
 *   · **目录围栏**：`/scene-live` 只在 `WEBWALLGL_DIR` 内、`/scene-files` 只在壁纸目录内解析目标；
 *     越界一律 403 **且带自解释文案 + appendDiagLine 留痕**（用户截图即可定位，不必先看日志）。
 *   · **缓存头分型**：`/scene-live` 的哈希名资源 immutable（一年），`index.html` 必须 no-store
 *     —— 上游同步会换掉它携带的哈希引用；`/scene-files` 的 HTML 同样 no-store（带注入的
 *     shim/种子），其余文件走**可重验证缓存**（ETag + Last-Modified → 304）：`scene.pkg`
 *     100–336MB，内容由 size+mtime 唯一确定，让浏览器复用手上的字节是本族最贵那条路径的解药。
 *   · **`/scene-live/index.html` 注入遮挡桥**（沿 `/scene-files` 的 shim 注入先例）：读盘 →
 *     `<head>` 后插 `<script src=…/occlusion-bridge.js?v=<插件版本>>` → 自设 text/html 出站；
 *     只 GET 注入（HEAD 走 serveFile 原样），读盘失败落回 serveFile 常规路径。桥把父页
 *     postMessage 转成 `window.__weSetOcclusion`（bundle 曝光），职责见
 *     `lib/webwallgl/occlusion-bridge.js` 文件头。
 *   · `OPTIONS` 由 `handleSceneFiles` 直接放行（媒体源上的跨源 fetch + Range 预检）。
 *   · 注册返回值必须推进 `c.disposers`，否则卸载 / HMR 后路由仍挂着已释放的处理器。
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 桥 script 的缓存破坏参数：**桥文件内容的 sha256 前 12 位**（不是插件版本）。
 * 桥不是哈希名产物、却随 `occlusion-bridge.js` 发 immutable 一年 —— 键用版本号时
 * "改桥不 bump 版本"会让浏览器手握旧字节最长一年；内容哈希让任何一次桥改动自动
 * 失效所有旧缓存。读不到文件回落 '0'（退化为每次文档重载都重取桥，no-store 的
 * index.html 本就带着新引用）。
 */
let occlusionBridgeVersionCache;
function occlusionBridgeVersion() {
  if (occlusionBridgeVersionCache !== undefined) return occlusionBridgeVersionCache;
  try {
    const bridgePath = resolve(dirname(fileURLToPath(import.meta.url)), '../webwallgl/occlusion-bridge.js');
    occlusionBridgeVersionCache = createHash('sha256').update(readFileSync(bridgePath)).digest('hex').slice(0, 12);
  } catch {
    occlusionBridgeVersionCache = '0';
  }
  return occlusionBridgeVersionCache;
}

export function registerSceneServeRoutes(webServer, c) {
  const {
    disposers, base: BASE, WEBWALLGL_DIR, appendDiagLine, traceRequests, serveFile,
    handleSceneFiles, mediaOriginInfo, payloadProgress, log,
  } = c;

  // 3c-2. WebWallGL live renderer page, vendored into lib/webwallgl/ by
  //       test/tools/sync-webwallgl.mjs (built with --base=/wallpaper-engine/
  //       scene-live/ so its absolute asset references resolve under this
  //       prefix). Same-origin and NOT sandboxed: the parent page drives it
  //       through frame.contentWindow.__wp / __wpStats, and backdrop-filter
  //       (liquid glass) can sample the composited output. Scene scripts stay
  //       confined inside WebWallGL's own SceneScript sandbox.
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/scene-live`,
    handler: (req, res) => {
      traceRequests(res, 'scene-live', new URL(req.url || '/', 'http://x').pathname);
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') { res.statusCode = 405; res.end('method not allowed'); return; }
      let rest = '';
      try {
        rest = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname.slice(`${BASE}/scene-live`.length));
      } catch {
        res.statusCode = 400; res.end('bad request'); return;
      }
      rest = rest.replace(/^\/+/, '');
      if (!rest || rest.endsWith('/')) rest += 'index.html';
      const abs = resolve(WEBWALLGL_DIR, rest);
      // Directory fence: nothing outside the vendored tree is ever served.
      if (abs === WEBWALLGL_DIR || !abs.startsWith(WEBWALLGL_DIR + sep)) {
        // 自解释的 403：谁被拦、从哪来。这行文字会直接显示在壁纸层上 —— 用户
        // 截图即可定位。
        appendDiagLine('fence', { route: 'scene-live', rest: rest.slice(0, 160), referer: String(req.headers.referer || '').slice(0, 120), dest: req.headers['sec-fetch-dest'] || '' });
        // 围栏拒绝 = 有请求被挡下 ⇒ 影响显示效果的非正常表现 ⇒ warn。
        log.warn(`scene-live fenced: rest="${rest}" referer="${req.headers.referer || '-'}" ua-iframe=${req.headers['sec-fetch-dest'] || '-'}`);
        res.setHeader('Cache-Control', 'no-store');
        res.statusCode = 403; res.end(`forbidden-scene-live[${rest}]`); return;
      }
      // Hash-named assets are immutable; index.html must revalidate (an
      // upstream sync changes the hashed references it carries). The fallback
      // page (`default-wallpaper/index.html`) is upstream-vendored static HTML
      // that a sync may replace — revalidate it the same way.
      res.setHeader('Cache-Control', rest === 'index.html' || rest === 'default-wallpaper/index.html'
        ? 'no-store'
        : 'public, max-age=31536000, immutable');
      // 3c-2b. 遮挡桥注入（沿 handleSceneFiles 的 shim 注入先例：读盘 → <head> 后插标签
      //        → 自设 text/html 出站）：index.html 是渲染页入口，遮挡消息桥必须随文档到达
      //        （父页 postMessage → 页内桥 → window.__weSetOcclusion → 遮挡管线）。只注
      //        index.html（目录形态已归一成它）；default-wallpaper 是无渲染器的静态兜底页，
      //        不需要桥。缓存头语义不变：index.html 本就 no-store（注入体必须随文档新鲜）。
      if (method === 'GET' && rest === 'index.html') {
        let html = '';
        try { html = readFileSync(join(WEBWALLGL_DIR, 'index.html'), 'utf8'); } catch { html = ''; }
        if (html) {
          // `?v=<桥内容哈希>` 做缓存破坏：桥不是哈希名产物，此路由对它发 immutable
          // —— 键用内容哈希，任何一次桥改动自动失效旧缓存（评审 C6：版本号键会在
          // "改桥不 bump 版本"时让浏览器手握旧字节最长一年）。
          const tag = `<script src="${BASE}/scene-live/occlusion-bridge.js?v=${occlusionBridgeVersion()}"></script>`;
          const m = /<head[^>]*>/i.exec(html);
          html = m
            ? html.slice(0, m.index + m[0].length) + tag + html.slice(m.index + m[0].length)
            : tag + html;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(html);
          return;
        }
        // 源文件读不到（异常态）⇒ 落回 serveFile 的常规 404 路径，不自造响应。
      }
      serveFile(abs, req, res, method === 'HEAD');
    },
  }));

  // 3c-3. 应用源挂载：渲染页（同源非沙箱 frame）取 scene.pkg / project.json。
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/scene-files`,
    handler: (req, res) => handleSceneFiles(req, res, 'app'),
  }));

  // 3c-3b. 诊断：上报媒体源地址（verify 脚本与用户截图都能一眼看出网页壁纸
  //        到底从哪个源加载）。端口来自 `lib/index.js` 的可变量 ⇒ 只经访问器取。
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/media-origin`,
    handler: (req, res) => {
      mediaOriginInfo().then((info) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(info));
      });
    },
  }));

  // 3c-3c. 载荷进度（客户端首帧看护用）：`?token=<sceneLiveSrc>` →
  //        `{ ok, served, size, active, transfers, completed, startedAt, lastByteAt, lastEndAt }`。
  //
  // 为什么需要这条：首帧**必须等整包到齐**（渲染页 2.0.2 在 `pkg body` 之前不发任何东西），
  // 而已知最坏形态是"传输被别的实例饿死"（同一份 336MB 包：媒体源上 0.6s，应用源上
  // 出现过 15–74s 甚至永不返回）—— 客户端只有墙钟，分辨不出"在下载"与"渲染不出来"，
  // 于是把前者写进共享失败记忆。服务端是唯一知道字节在不在动的地方。
  // `ok:false` = 这个 token 一次传输都没见过 = **未知**（客户端据此回落墙钟预算）。
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/scene-payload-progress`,
    handler: (req, res) => {
      let token = '';
      try { token = new URL(req.url || '/', 'http://x').searchParams.get('token') || ''; } catch { token = ''; }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(payloadProgress(token)));
    },
  }));
}
