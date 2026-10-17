/**
 * routes/media-derived.js — **派生媒体族**路由：源元信息（`/media-info`）、抽帧转码
 * （`/transcoded`）与它的进度（`/transcode-progress`）、视频缩略图（`/video-preview`）。
 *
 * 为什么这四条是一族、且与 `/media` `/preview` **不是**一族：这四条服务的都是**算出来的**
 * 东西 —— 一次容器探测、一次 ffmpeg 转码、一次 ffmpeg 抽帧。而 `/media` 与 `/preview`
 * 只把**盘上已有的字节**原样发出去（前者还要钉住 faststart 变体的字节布局）。
 * 两条路的失效语义完全不同（前者 4xx/502 = 这次派生失败，客户端回退原片；后者 404 = 源没了），
 * 所以族界就画在"派生 vs 直出"这条线上。
 *
 * 契约：`registerMediaDerivedRoutes(webServer, c)`；`c` 里是这一族**用到但不属于它**的东西。
 * 转码与探测的**实现层**住在 `lib/media/transcode.js` 与 `lib/media/mp4-probe.js`：它们与本族之外的调用点共享进程内状态
 * （`transcodeJobs` 还被 fiber 回卷时的清理读、`faststartVariant` 被 `/media` 的选片共用），
 * 且 `pinnedFaststartVariant` 的字节布局钉子只在 `/media` 那条路上成立（见那里的注释）。
 *   · `disposers` / `base`   ← 清理句柄数组与路径前缀
 *   · `mediaMap`             ← token → 绝对路径（本仓多族共用；规模由 `node test/tools/host-route-index.mjs --deps` 现算）
 *   · `serveFile`            ← 静态发送（Range 三分支 + HEAD）
 *   · `log`                  ← 宿主日志入口（`/media-info` 顺手排 faststart 变体时留痕）
 *   · `getMediaInfo`         ← 容器探测（分辨率 / 编码 / fps）：`/media-info` 的答案、
 *                             也是客户端"原生可解就不整片重编码"这条治理的依据
 *   · `faststartVariant`     ← 变体就绪即用（就绪判定不许在这里下钉子 —— 见 `pinnedFaststartVariant`）
 *   · `transcodeJobs`        ← 按 `abs|fps` 的在途任务账本：进度与取消都读它
 *   · `transcodeToFps` / `registerTranscodeWaiter` ← 抽帧转码本体与"客户端断开即取消"
 *   · `transcodeCached`      ← **只读**回答"这个 (源, 上限) 的抽帧版在不在盘上"：
 *                             `/media-info?fps=` 的答案，客户端据此在建层前就选抽帧版当 src
 *   · `generateVideoPreview` ← 上传视频的按需首帧
 *
 * 不变量：
 *   · **注册顺序**：`/media-info` 必须在 `/media` **之前**注册 —— 后者的 `prefix` 匹配器会把
 *     `…/media-info/…` 一并吞掉（判据：本族在 `apply()` 里的调用点先于 `/media` 循环）。
 *     `/transcode-progress` 在 `/transcoded` 之前注册。
 *   · **`/media-info` 不下钉子**："这一份播放用哪个文件"只由 `/media` 的第一次请求定音；
 *     这里只把变体**排上队**，抢一点起跑时间。
 *   · **`/media-info` 不起转码**：`transcode: { fps, cached }` 只许来自 `transcodeCached`
 *     （一条 `existsSync`）。顺手在这里转码 = 每个被选中的壁纸白跑一次 ffmpeg。
 *   · **抽帧版的键只有一份**：`cached` 与 `/transcoded` 的落盘路径共用 `transcodeCacheKey`
 *     （lib/media/transcode.js），两处各算一份的漂移会让"说有缓存却打不中"。
 *   · **进度只在有在途任务时非零**：`transcodeJobs` 缺键 ⇒ 原样返回 idle 档，不新建条目
 *     （轮询不该把账本撑大）。
 *   · 注册返回值必须推进 `c.disposers`，否则卸载 / HMR 后路由仍挂着已释放的处理器。
 */

import { statSync } from 'node:fs';
import { clampNum } from '../settings-schema.js';

/** 注入契约（P2-7A / ADR-0013 D12）：本族从 `c` 消费的**必需**键 —— 门面/组件行调用点必须逐键给到（判据 test/verify-inject-contracts.mjs 双向对账）。 */
export const DEPS = ['disposers', 'base', 'mediaMap', 'serveFile', 'log', 'getMediaInfo', 'faststartVariant', 'transcodeJobs', 'transcodeToFps', 'registerTranscodeWaiter', 'generateVideoPreview', 'transcodeCached'];

export function registerMediaDerivedRoutes(webServer, c) {
  const {
    disposers, base: BASE, mediaMap, serveFile, log,
    getMediaInfo, faststartVariant, transcodeJobs,
    transcodeToFps, registerTranscodeWaiter, generateVideoPreview,
    transcodeCached,
  } = c;

  // Media metadata (source resolution / codec / fps) — the picker hint and the
  // 帧率上限 skip-decision. Registered BEFORE the /media loop ("/media-info"
  // starts with "/media", the prefix matcher would otherwise swallow it).
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/media-info`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET') { res.statusCode = 405; res.end('method not allowed'); return; }
      const pathname = new URL(req.url || '/', 'http://x').pathname;
      const token = decodeURIComponent(pathname.slice(`${BASE}/media-info/`.length));
      const abs = mediaMap.get(token);
      if (!abs) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'unknown-token' }));
        return;
      }
      let info;
      try { info = getMediaInfo(abs); } catch { info = null; }
      // 顺手把 faststart 变体排上（见 faststartVariant）：`/media-info` 比播放器的第一个
      // media 请求早到，这里起跑能多抢一点时间；没有变体时本次仍照旧服务原片。
      // 注意：这里**不**下钉子 —— "这一份播放用哪个文件"只由 /media 的第一次请求定音。
      try { faststartVariant(abs, log); } catch { /* ignore */ }
      // 客户端把**当前帧率上限**经 `?fps=` 带上来，这里只读地回答"该上限的抽帧版是否已在盘上"
      // （`transcodeCached` = 一条 `existsSync`；无参数 / 上限 ≤ 0 ⇒ `transcode: null`）。
      // 客户端据此在**建层之前**就把抽帧版当 src（而不是先取原片、等探针回来再换源）。
      // ⚠️ 这个回答**绝不能**顺手起一次转码：每个被选中的壁纸都跑一次 ffmpeg 是这条路由
      // 历史上真实发生过的浪费（见 src/video-layer.js 的 mediaInfoInFlight 注释）。
      let transcode = null;
      try {
        const rawFps = Number(new URL(req.url || '/', 'http://x').searchParams.get('fps')) || 0;
        if (rawFps > 0 && typeof transcodeCached === 'function') {
          const fps = clampNum(rawFps, 1, 120, 60);
          transcode = { fps, cached: transcodeCached(abs, fps) === true };
        }
      } catch { transcode = null; }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ ok: !!info, info, transcode }));
    },
  }));

  // Frame-skip transcode progress (for the picker's progress bar). Polled by
  // the client every ~1s while its transcode fetch is pending; keyed by
  // abs|fps so each wallpaper watches only its own job.
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/transcode-progress`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET') { res.statusCode = 405; res.end('method not allowed'); return; }
      const url = new URL(req.url || '/', 'http://x');
      const token = decodeURIComponent(url.pathname.slice(`${BASE}/transcode-progress/`.length));
      const abs = mediaMap.get(token);
      const fps = clampNum(Number(url.searchParams.get('fps')) || 0, 1, 120, 60);
      let phase = 'idle', percent = 0, source = '', finalizing = false, eta = null;
      const p = abs ? transcodeJobs.get(abs + '|' + fps) : null;
      if (p) {
        phase = p.phase;
        source = p.source || '';
        if (phase === 'download') {
          percent = p.total > 0 ? Math.min(99, Math.round((p.downloaded / p.total) * 100)) : 0;
        } else if (phase === 'transcode' && p.outFile) {
          let size = 0;
          try { size = statSync(p.outFile).size; } catch { /* not created yet */ }
          if (p.expectedBytes && p.expectedBytes > 0) {
            percent = Math.min(99, Math.round((size / p.expectedBytes) * 100));
          }
          // Rolling size samples → growth rate → ETA (wall seconds remaining).
          const now = Date.now();
          if (!Array.isArray(p.samples)) p.samples = [];
          p.samples.push({ t: now, size });
          if (p.samples.length > 24) p.samples.shift();
          if (p.samples.length >= 3 && p.expectedBytes && p.expectedBytes > 0) {
            const a = p.samples[0], b = p.samples[p.samples.length - 1];
            const dt = (b.t - a.t) / 1000;
            const rate = dt > 0 ? (b.size - a.size) / dt : 0;
            if (rate > 0) {
              const rem = p.expectedBytes - b.size;
              if (rem > 0) eta = Math.max(1, Math.round(rem / rate));
            }
          }
          if (percent >= 99) finalizing = true;
        } else if (phase === 'done') {
          percent = 100;
        }
      }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ phase, percent, source, finalizing, eta }));
    },
  }));

  // Frame-skip transcode (抽帧转码): serves a capped-fps re-encode (see
  // transcodeToFps). On cache miss the request waits for the one-time ffmpeg
  // run; the client plays the ORIGINAL first and swaps to this when ready, so
  // first paint is instant. Missing ffmpeg / failed encode ⇒ 502, and the
  // client keeps the original (transparent fallback).
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/transcoded`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET') { res.statusCode = 405; res.end('method not allowed'); return; }
      const url = new URL(req.url || '/', 'http://x');
      const token = decodeURIComponent(url.pathname.slice(`${BASE}/transcoded/`.length));
      const abs = mediaMap.get(token);
      if (!abs) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'unknown-token' }));
        return;
      }
      // Accept every video extension the enumerator produces (WE officially
      // ships MP4/WebM; mkv/avi/mov appear in user folders). ffmpeg demuxes
      // them all and re-muxes to MP4+AV1 regardless of the input container;
      // the moov probe (media-info) stays MP4-only — other containers simply
      // get no source hint and are always transcoded, which is safe.
      if (!/\.(mp4|m4v|mov|webm|mkv|avi)$/i.test(abs)) {
        res.statusCode = 422;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'not-a-video' }));
        return;
      }
      const fps = clampNum(Number(url.searchParams.get('fps')) || 0, 1, 120, 60);
      (async () => {
        let out = null;
        let transcodeErr = null;
        try {
          out = await transcodeToFps(abs, fps, (e) => {
            // 客户端断开 (切换壁纸): 取消转码 — kill ffmpeg + 删 tmp (释放 CPU)
            registerTranscodeWaiter(e, res);
          });
        } catch (err) { transcodeErr = err; }
        if (!out) {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({
            error: 'transcode-failed',
            detail: String(transcodeErr && transcodeErr.message ? transcodeErr.message : transcodeErr),
          }));
          return;
        }
        serveFile(out, req, res);
      })().catch((err) => {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
      });
    },
  }));

  // 3a. On-demand thumbnail for a custom-uploaded video (see
  // generateVideoPreview). MP4 uploads have no preview file, so this extracts
  // one frame with the same lazy ffmpeg chain the transcode path uses; while
  // ffmpeg is unavailable the route answers 4xx and the client keeps its
  // "无预览" placeholder.
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/video-preview`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') {
        res.statusCode = 405;
        res.setHeader('Allow', 'GET, HEAD');
        res.end('method not allowed');
        return;
      }
      const pathname = new URL(req.url || '/', 'http://x').pathname;
      const token = decodeURIComponent(pathname.slice(`${BASE}/video-preview/`.length));
      const abs = mediaMap.get(token);
      if (!abs || !/\.(mp4|m4v|mov|webm|mkv|avi)$/i.test(abs)) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'unknown-token' }));
        return;
      }
      (async () => {
        const out = await generateVideoPreview(abs);
        // The URL only carries the path while the frame is keyed by
        // path+size+mtime: no-store stops a replaced source video from serving
        // a stale frame through the same URL (same policy as scene-frame).
        res.setHeader('Cache-Control', 'no-store');
        serveFile(out, req, res, method === 'HEAD');
      })().catch((err) => {
        res.statusCode = 422;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
      });
    },
  }));
}
