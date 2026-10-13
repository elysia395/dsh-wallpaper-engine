/**
 * 视频缩略图：抽一帧落到缓存（picker 的每张视频卡都要一张）。
 *
 * 为什么单独成模块：这是"派外部进程 + 落盘缓存 + 同键合流"三件事绑在一起的一小块 —— 它必须
 * 与宿主的编排解耦，否则每次给 picker 调一次缩略图，宿主文件都要为它多长一段状态机。
 *
 * 不变量：
 *   1. **同键合流**：同一输出路径的并发请求共享同一个在途任务（只 spawn 一次、只写一次盘）；
 *      任务 settle 后回收账本项，且只在"账本里仍是自己"时删除（避免误删后来者）。函数是 async，
 *      外层包装 promise 天然各不相同 —— 合流点在账本，不在返回值身份。
 *   2. **自己的并发闸**：`VIDEO_PREVIEW_MAX_CONCURRENT` 由注入（值语义，常量），不排在 15 分钟
 *      的转码闸后面 —— 缩略图是短任务，混排会让 picker 一开就饿死。
 *   3. **缓存键含 size + mtime + width**：换掉源视频或改宽度都会重开一帧，绝不吐旧图。
 *   4. 失败路径必须清 `.tmp` 并放闸（finally）—— 否则一次失败会永久吃掉一个并发名额。
 *   5. **产出只看"spawn 正常返回且留下文件"**，不看"文件是否存在"—— 失败尝试可能在磁盘上留
 *      残片（0 字节/半张图），拿它当产出发布就会在该缓存键下留下**永久坏图**。
 *
 * 注入面：目录解析（`ensureVideoPreviewCacheDir`）、ffmpeg 解析与 spawn（转码套件）、
 * 宽度与闸值（宿主常量）。函数体与搬来前逐字相同，唯一差异是外面多包了一层工厂。
 */

import { existsSync, statSync, unlinkSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export function createVideoPreviewKit({
  ensureVideoPreviewCacheDir, resolveFfmpeg, spawnFfmpeg,
  VIDEO_PREVIEW_WIDTH, VIDEO_PREVIEW_MAX_CONCURRENT,
}) {
  let videoPreviewActive = 0;
  const videoPreviewWaiters = [];
  function acquireVideoPreviewSlot() {
    if (videoPreviewActive < VIDEO_PREVIEW_MAX_CONCURRENT) {
      videoPreviewActive += 1;
      return Promise.resolve();
    }
    return new Promise((resolveSlot) => { videoPreviewWaiters.push(resolveSlot); });
  }
  function releaseVideoPreviewSlot() {
    const next = videoPreviewWaiters.shift();
    if (next) next();
    else videoPreviewActive -= 1;
  }
  /** Cache path keyed by source path + size + mtime, so replacing the video
   *  regenerates the frame instead of serving a stale thumbnail. */
  function videoPreviewCachePath(abs) {
    let size = 0, mtime = 0;
    try { const st = statSync(abs); size = st.size; mtime = Math.round(st.mtimeMs); } catch { /* ignore */ }
    const key = createHash('sha256')
      .update(abs + '|' + size + '|' + mtime + '|v1|' + VIDEO_PREVIEW_WIDTH)
      .digest('hex').slice(0, 24);
    return join(ensureVideoPreviewCacheDir(), 'pv_' + key + '.jpg');
  }

  // Same-key concurrent requests share one extraction (and one disk write).
  const VIDEO_PREVIEW_INFLIGHT = new Map();
  async function generateVideoPreview(abs) {
    const out = videoPreviewCachePath(abs);
    if (existsSync(out)) return out;
    let entry = VIDEO_PREVIEW_INFLIGHT.get(out);
    if (entry) return entry;
    entry = (async () => {
      await acquireVideoPreviewSlot();
      const tmp = out + '.tmp' + process.pid;
      try {
        if (existsSync(out)) return out; // a queued sibling may have produced it
        const ff = await resolveFfmpeg(null);
        let lastErr = null;
        // 产出＝spawn 正常返回且留下文件；"文件存在"不能当产出 —— 抛错的那次可能在盘上留残片。
        let produced = false;
        // Skip the opening second first: many videos start on a black fade-in,
        // which would otherwise become a black thumbnail. Fall back to 0 for
        // clips shorter than the seek point.
        for (const ss of [1, 0]) {
          try { unlinkSync(tmp); } catch { /* ignore */ }
          try {
            await spawnFfmpeg(ff, [
              '-y', '-hide_banner', '-nostdin',
              '-ss', String(ss),
              '-i', abs,
              '-frames:v', '1', '-an',
              '-vf', `scale='min(${VIDEO_PREVIEW_WIDTH},iw)':-2`,
              '-q:v', '3',
              '-update', '1', '-f', 'image2', tmp,
            ], 60 * 1000, {});
            if (existsSync(tmp)) { lastErr = null; produced = true; break; }
            lastErr = new Error('no preview frame produced');
          } catch (e) { lastErr = e; }
        }
        if (!produced) throw lastErr || new Error('no preview frame produced');
        renameSync(tmp, out);
        return out;
      } catch (e) {
        try { unlinkSync(tmp); } catch { /* ignore */ }
        throw e;
      } finally {
        releaseVideoPreviewSlot();
      }
    })();
    VIDEO_PREVIEW_INFLIGHT.set(out, entry);
    entry.then(
      () => { if (VIDEO_PREVIEW_INFLIGHT.get(out) === entry) VIDEO_PREVIEW_INFLIGHT.delete(out); },
      () => { if (VIDEO_PREVIEW_INFLIGHT.get(out) === entry) VIDEO_PREVIEW_INFLIGHT.delete(out); },
    );
    return entry;
  }

  return { acquireVideoPreviewSlot, releaseVideoPreviewSlot, videoPreviewCachePath, generateVideoPreview };
}
