/**
 * routes/scene-media.js — **场景内嵌媒资族**路由：场景包自带的动画 MP4（`/scene-video`）
 * 与独立音频（`/scene-audio`）。
 *
 * 为什么这两条是一族、且与 `/scene-frame` **不是**一族：这族回答的是同一个问题 ——
 * "这个场景包里自带的那份媒体，发给我"。两条腿的服务方式逐字相同（token → `mediaMap` →
 * 就绪后走 `serveFile` 的 Range 三分支），区别只在**就绪是怎么来的**：视频按需从包里提取
 * （可缓存、可并发去重），音频走 `ensureSceneAudio` 的转换链。于是"提取 → 缓存 → 直出"
 * 这条链的两个端点住在一起。`/scene-frame` 发的是**渲染出来的帧**（实时抓帧缓存），
 * 与"包里的字节"失效语义不同（前者随视口几何失效，后者随源文件 mtime 失效）。
 *
 * 契约：`registerSceneMediaRoutes(webServer, c)`；`c` 里是这一族**用到但不属于它**的东西。
 * 提取/转换的**实现层**住在 `lib/media/scene-probe.js`（探测账本与 `ensureSceneAudio`）与
 * `lib/media/frame-store.js`（缓存目录）：两者被 `buildInventory` 与后台探测泵共用。
 *   · `disposers` / `base`        ← 清理句柄数组与路径前缀
 *   · `mediaMap`                   ← token → 绝对路径（本仓多族共用；规模由 `node test/tools/host-route-index.mjs --deps` 现算）
 *   · `serveFile`                  ← 静态发送（Range 三分支 + HEAD）
 *   · `ensureFrameCacheDir`        ← 提取产物落盘的缓存目录
 *   · `sceneVideoProbeKey` / `sceneVideoProbeSet` ← "这个 pkg 有没有内嵌 MP4"的探测账本
 *   · `atomicWriteFileP`           ← 原子发布提取产物（`.tmp` + rename）
 *   · `ensureSceneAudio`           ← 场景音频就绪（无音频 → null）
 *   · `SCENE_VIDEO_INFLIGHT`       ← 按「abs+mtime」的提取去重账本。**声明在 `apply()`**、
 *                                     以引用进 `c` —— 本 fiber 单例（生命周期与一次 apply 一致）。
 *
 * 不变量：
 *   · **两把键、两个构造点**：缓存键是 `sv1_<abs 的 base64url>_<mtimeMs>`；探测键另有构造点
 *     （`sceneVideoProbeKey`，与 inventory 同键）。两者不许互相抄 —— 抄一处就少一处会漂的拼接。
 *   · **机会式缓存**：真实请求（含客户端拿到的 404）都回填探测账本 ⇒ inventory 不必自己探。
 *   · **in-flight 只按槽位键合并，settle 即摘**：并发请求共享一次提取；失败也摘（允许重试）。
 *   · 注册返回值必须推进 `c.disposers`，否则卸载 / HMR 后路由仍挂着已释放的处理器。
 */

import { statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
// 提取本体来自 `lib/scene-manifest.js`（**库**，不是 `apply` 的状态）⇒ 自己 import，
// 不经 `c`：路由模块对新 import 的依赖越少越难与门面漂开（见 verify-module-layout ⑤）。
import { extractSceneVideoFromDir, extractSceneVideoFromPkgFile } from '../scene-manifest.js';

/** 注入契约（P2-7A / ADR-0013 D12）：本族从 `c` 消费的**必需**键 —— 门面/组件行调用点必须逐键给到（判据 test/verify-inject-contracts.mjs 双向对账）。 */
export const DEPS = ['disposers', 'base', 'mediaMap', 'serveFile', 'ensureFrameCacheDir', 'sceneVideoProbeKey', 'sceneVideoProbeSet', 'atomicWriteFileP', 'ensureSceneAudio', 'SCENE_VIDEO_INFLIGHT'];

export function registerSceneMediaRoutes(webServer, c) {
  const {
    disposers, base: BASE, mediaMap, serveFile,
    ensureFrameCacheDir, sceneVideoProbeKey, sceneVideoProbeSet,
    atomicWriteFileP, ensureSceneAudio, SCENE_VIDEO_INFLIGHT,
  } = c;

  // 3e. Scene MP4 video: extract the scene's embedded animation and serve it as
  //     a hardware-decodable <video> source. Cached like scene-frame. Scenes
  //     without an embedded video answer 404. This is the second source in the
  //     out-figure chain — live WebWallGL rendering comes first (a scene's own
  //     MP4 is a cheap hardware-decoded layer, not a replacement for it).
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/scene-video`,
    handler: (req, res) => {
      // GET 流式返回（支持 Range，<video> 拖动/循环用）；HEAD 只返回头。
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') {
        res.statusCode = 405;
        res.setHeader('Allow', 'GET, HEAD');
        res.end('method not allowed');
        return;
      }
      const pathname = new URL(req.url || '/', 'http://x').pathname;
      const token = decodeURIComponent(pathname.slice(`${BASE}/scene-video/`.length));
      const abs = mediaMap.get(token);
      if (!abs) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'unknown-token' }));
        return;
      }
      (async () => {
        let mtime = 0;
        try { mtime = statSync(abs).mtimeMs; } catch { /* keep 0 */ }
        const key = 'sv1_' + Buffer.from(abs, 'utf8').toString('base64url') + '_' + Math.round(mtime);
        const mp4Path = join(ensureFrameCacheDir(), key + '.mp4');
        // 机会式缓存：真实请求的结果回填探测缓存（与 inventory 同键：路径+mtime），
        // 让一次真实请求（含客户端拿到的 404）也「教会」缓存。状态码/响应体不变。
        const probeKey = sceneVideoProbeKey(abs, mtime);
        const cachedMp4 = existsSync(mp4Path);
        // 已有抽好的 mp4 = 该 abs+mtime 曾成功提取过 → 正向回填，不必重提取。
        if (cachedMp4) sceneVideoProbeSet(probeKey, true);
        if (!cachedMp4) {
          // in-flight 去重：同一 key 的并发请求共享一次提取 + 一次缓存写入
          // （按槽位键登记在途任务，落地后只摘自己那一条）。
          let inflight = SCENE_VIDEO_INFLIGHT.get(key);
          if (!inflight) {
            inflight = (async () => {
              try {
                // 异步读盘：scene.pkg 可达几百 MB，readFileSync 会阻塞事件循环。
                // pkg 走文件版提取（issue #136：只读索引 + 前缀 + 命中条目，不再整包读）。
                const bytes = abs.toLowerCase().endsWith('.json')
                  ? extractSceneVideoFromDir(dirname(abs))
                  : await extractSceneVideoFromPkgFile(abs);
                // 确实没有内嵌 MP4（返回空）→ 记否：后续 inventory 不再为该 pkg
                // 给 URL，后台也不再重复探测。
                if (!bytes || bytes.length === 0) { sceneVideoProbeSet(probeKey, false); return null; }
                // 异步原子发布（.tmp+rename）：写入中途崩溃不留半截缓存文件。
                await atomicWriteFileP(mp4Path, bytes);
                sceneVideoProbeSet(probeKey, true); // 产物已发布 → 正向回填
                return mp4Path;
              } catch (e) {
                // 提取失败记否（客户端 404 从此教会缓存）。
                sceneVideoProbeSet(probeKey, false);
                throw e;
              }
            })();
            SCENE_VIDEO_INFLIGHT.set(key, inflight);
            // 无论成败都摘除（失败允许后续请求重试）。
            inflight.then(
              () => SCENE_VIDEO_INFLIGHT.delete(key),
              () => SCENE_VIDEO_INFLIGHT.delete(key),
            );
          }
          const produced = await inflight;
          if (!produced) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: 'no-scene-video' }));
            return;
          }
        }
        // serveFile：Range 三分支 + HEAD + 流式（与 /media 同一条路径）。
        serveFile(mp4Path, req, res, method === 'HEAD');
      })().catch((err) => {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
      });
    },
  }));

  // 场景包内独立音频：GET/HEAD 流式返回（Range 与 /media 同路径）；无音频 404。
  // 客户端选中场景壁纸时 HEAD 探测此路由，决定卡片音乐按钮与 <audio> 播放。
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/scene-audio`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') {
        res.statusCode = 405; res.end('method not allowed'); return;
      }
      const pathname = new URL(req.url || '/', 'http://x').pathname;
      const token = decodeURIComponent(pathname.slice(`${BASE}/scene-audio/`.length));
      const abs = mediaMap.get(token);
      if (!abs) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'unknown-token' }));
        return;
      }
      (async () => {
        const file = await ensureSceneAudio(abs);
        if (!file) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'no-scene-audio' }));
          return;
        }
        serveFile(file, req, res, method === 'HEAD');
      })().catch(() => {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'scene-audio failed' }));
      });
    },
  }));
}
