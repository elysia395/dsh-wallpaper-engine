/**
 * routes/slides.js — **图片 / 幻灯片壁纸的图集清单**路由：`GET ${BASE}/slides/<token>`。
 *
 * 回答一个问题：这张图片壁纸（WE `preset` 型项目 / 上传目录里的图片集）所在的目录里，
 * 还有哪些图、按什么顺序过场。token = **首图**的媒体 token（与 `/media/<token>` 同一张
 * `mediaMap`，R1 token 域单主权）⇒ 这个端点没有第二套寻址方式。
 *
 * 为什么顺序在宿主算：WE 自己的幻灯片用自然序（`1.jpg < 2.jpg < 10.jpg`），而磁盘 `readdir`
 * 的次序是文件系统给的（Linux 上几乎随机）。顺序一旦漂移，客户端"下一张"就与 WE 里看到的不
 * 一致 ⇒ 顺序的**唯一真源**是内核扫描族的 `listImages()`（本族只转述，不排序）。
 *
 * 契约：`registerSlidesRoutes(webServer, c)`；`c` 里是这一族**用到但不属于它**的东西：
 *   · `disposers`  ← 清理句柄数组（卸载 / HMR 时注销路由）
 *   · `base`       ← `/wallpaper-engine` 前缀
 *   · `mediaMap`   ← token → 磁盘绝对路径（同一张 Map 实例：apply 建、teardown `clear()`）
 *   · `tokenFor`   ← 绝对路径 → token（与其它媒体族同一份实现；**不为每张图新开一套寻址**）
 *   · `listImages` ← 内核扫描族的目录图集（相对路径、自然序）；经键表 `kernel:listImages` 拿到
 *   · `http`       ← 收体器与 JSON 应答的唯一实现（本文件只消费 `sendJson`）
 *
 * 不变量：
 *   · 只回**同源** `/media/<token>` URL：目录里的名字是 `listImages` 递归出来的，客户端拿到的
 *     每条 URL 都可以直接喂 `<img src>`；不拼接任何外部 origin（媒体源那条路留给视频族）。
 *   · token 未知 / 目录里一张图都没有 ⇒ 404（两个不同的 error 文案）；非 GET ⇒ 405；
 *     路径解码失败 ⇒ 400。**都不抛**：路由层不制造 500 之外的未捕获异常。
 *   · 目录里的图会在 `listImages` 与 `tokenFor` 之间被逐个登记进 `mediaMap` —— 这是有意的：
 *     `/media/<token>` 是唯一出口，登记即"可服务"，不额外开静态目录。
 *   · 只 import `node:*` 与相对路径；**绝不** import 主包（跨包纪律）。
 */

import { dirname, join } from 'node:path';

/** 注入契约（P2-7A / ADR-0013 D12）：本族从 `c` 消费的**必需**键 —— 调用点必须逐键给到（判据 test/verify-inject-contracts.mjs 双向对账）。 */
export const DEPS = ['disposers', 'base', 'mediaMap', 'tokenFor', 'listImages', 'http'];

/**
 * 注册图集清单族（一条 prefix 路由）。
 * `webServer` 是宿主 web 服务面（`tolerantWebServer()` 之后的那个）；`c` 见文件头契约。
 */
export function registerSlidesRoutes(webServer, c) {
  const {
    disposers, base: BASE, mediaMap, tokenFor, listImages, http,
  } = c;

  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/slides`,
    handler: (req, res) => {
      const json = (code, payload) => http.sendJson(res, code, payload);
      if ((req.method || 'GET').toUpperCase() !== 'GET') { json(405, { ok: false, error: 'method-not-allowed' }); return; }
      let token;
      try {
        token = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname
          .slice(`${BASE}/slides/`.length)).replace(/\/+$/, '');
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
