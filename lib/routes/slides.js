/**
 * routes/slides.js — **图片 / 幻灯片清单**族路由：`/slides/<token>`。
 *
 * 它回答一个问题：这张图片壁纸有哪些图、按什么顺序轮播。token 是**首图**的媒体
 * token（与 `/media` 共用同一张 `mediaMap`）—— 路由按 token 所在目录列图，因此
 * 不需要新增令牌种类；切换周期由 inventory 直接给（`slideIntervalMs`），本路由
 * 不读 project.json，也不碰 WE 的 preset 解析（那是扫描族 lib/wallpaper-scan.js
 * 的唯一职责）。
 *
 * 契约：`registerSlidesRoutes(webServer, c)`；`c` 里是这一族用到但不属于它的东西：
 *   · `disposers`  ← 清理句柄数组（卸载 / HMR 时注销路由）
 *   · `base`       ← `/wallpaper-engine` 前缀
 *   · `mediaMap`   ← token → 磁盘绝对路径（同一张 Map 实例）
 *   · `listImages` ← 扫描族的图片收集器（相对路径，自然序）
 *   · `tokenFor`   ← 为目录里每一张图签发媒体 token
 *
 * 不变量：
 *   · 目录读不到 / 没有图片 ⇒ 404（`ok:false`），绝不抛；
 *   · 只回**同源相对 URL**，不回磁盘路径（令牌是路径映射的唯一出口）；
 *   · 顺序必须与扫描一致：两边都用 `listImages` 的自然序，首图即 inventory 的
 *     `media` —— 客户端拿首图当底、用清单接后续帧，顺序错位会让第一张图跳一下。
 */

import { dirname, join } from 'node:path';
import { sendJson } from '../json-response.js';

export function registerSlidesRoutes(webServer, c) {
  const { disposers, base: BASE, mediaMap, listImages, tokenFor } = c;

  // 3c-3d. 图片 / 幻灯片壁纸清单：选择器与图层的轮播腿都从这里取图。
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/slides`,
    handler: (req, res) => {
      const json = (code, payload) => sendJson(res, code, payload);
      if ((req.method || 'GET').toUpperCase() !== 'GET') { json(405, { ok: false, error: 'method-not-allowed' }); return; }
      let token;
      try {
        token = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname.slice(`${BASE}/slides/`.length)).replace(/\/+$/, '');
      } catch { json(400, { ok: false, error: 'bad-request' }); return; }
      const abs = token ? mediaMap.get(token) : null;
      if (!abs) { json(404, { ok: false, error: 'unknown-token' }); return; }
      const dir = dirname(abs);
      listImages(dir).then((names) => {
        if (!names.length) { json(404, { ok: false, error: 'no-images' }); return; }
        json(200, {
          ok: true,
          token,
          images: names.map((name) => ({ name, url: `${BASE}/media/${tokenFor(join(dir, name))}` })),
        });
      }).catch(() => { json(500, { ok: false, error: 'list-failed' }); });
    },
  }));
}
