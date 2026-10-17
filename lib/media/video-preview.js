/**
 * video-preview.js — 自定义上传视频的预览抽帧族（按需 ffmpeg 抓一帧 + 磁盘缓存 + 并发闸）。
 *
 * 从 `lib/index.js` **纯搬移**（P0.2-A）：函数体、常量、注释、错误文案逐字未改，只加工厂包裹与
 * 2 格缩进。模块级状态（`videoPreviewActive` / `videoPreviewWaiters` / `VIDEO_PREVIEW_INFLIGHT`）
 * 收进工厂闭包；门面在模块作用域建一次实例并同名解构，调用点逐字未变。
 *
 * deps 契约（键名 → 门面来源）：
 *   · cacheBaseDir()            → `videoPreviewCacheDir()` = join(<cache>, 'video-previews')
 *   · ensureDirOnce(dir)        → 门面同名函数（memo 化的 mkdirSync）
 *   · transcodeKit              → P0 的抽帧转码套件；本族只借 `resolveFfmpeg` / `spawnFfmpeg`
 *                                 （不自带 ffmpeg 供给链，避免门面与两族循环依赖）
 *   · VIDEO_PREVIEW_WIDTH / VIDEO_PREVIEW_MAX_CONCURRENT（**可选**）→ 宿主常量，缺省 960 / 2
 *                                 （上游把它们做成注入项；判据据此仍能钉"键含 width""闸在限流"）
 *
 * 返回面：缓存目录 / 缓存键路径 / 两个容量修剪 / 抽帧入口（`generateVideoPreview`）。
 *
 * 本模块**绝不** import `lib/index.js`（会成环），只 import `node:` 内置与相对路径。
 */

import { existsSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * 建一次视频预览套件。deps 见文件头；返回门面要用的面。
 */
export function createVideoPreviewKit(deps) {
  const { cacheBaseDir, ensureDirOnce, transcodeKit } = deps;
  const { resolveFfmpeg, spawnFfmpeg } = transcodeKit;

  // ── Custom-upload video thumbnails (on-demand ffmpeg frame) ──────────────────
  // An image upload serves itself as its preview, but an MP4 upload has no
  // preview file, so the picker would show the "无预览" placeholder. Extract
  // one frame lazily — only when the browser actually requests the thumbnail —
  // through the same ffmpeg provisioning chain the transcode path uses.
  //
  // ⚠️ 宽度与闸值是**宿主常量**（上游把它们做成注入项）：这里给默认值 ⇒ 内核现有调用点
  // （只传 cacheBaseDir / ensureDirOnce / transcodeKit）行为一字未改；而判据仍可注入别值，
  // 于是"缓存键含 width"与"闸真的在限流"这两条不变量保持可判（不靠读常量字面量）。
  const VIDEO_PREVIEW_WIDTH = deps.VIDEO_PREVIEW_WIDTH === undefined ? 960 : deps.VIDEO_PREVIEW_WIDTH;
  // The picker requests one thumbnail per video card; without a gate, opening it
  // would spawn one ffmpeg per upload. Thumbnails are short jobs, so keep them on
  // their own small gate instead of queueing behind a 15-minute transcode.
  const VIDEO_PREVIEW_MAX_CONCURRENT = deps.VIDEO_PREVIEW_MAX_CONCURRENT === undefined
    ? 2 : deps.VIDEO_PREVIEW_MAX_CONCURRENT;
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

  /** Thumbnail cache dir, under the same cache root as transcodes/frames. */
  function videoPreviewCacheDir() {
    return join(cacheBaseDir(), 'video-previews');
  }
  function ensureVideoPreviewCacheDir() {
    return ensureDirOnce(videoPreviewCacheDir());
  }

  /** Bound the on-disk cache (one small JPEG per distinct source revision). */
  const VIDEO_PREVIEW_CACHE_MAX = 512;
  function pruneVideoPreviewCache() {
    /** @type {string[]} */
    let names;
    try { names = readdirSync(videoPreviewCacheDir()); } catch { return; }
    const files = names.filter((n) => n.startsWith('pv_') && n.endsWith('.jpg'));
    if (files.length <= VIDEO_PREVIEW_CACHE_MAX) return;
    const ranked = files.map((n) => {
      const p = join(videoPreviewCacheDir(), n);
      let mtime = 0; try { mtime = statSync(p).mtimeMs; } catch { /* keep 0 */ }
      return { p, mtime };
    }).sort((a, b) => b.mtime - a.mtime);
    for (const f of ranked.slice(VIDEO_PREVIEW_CACHE_MAX)) {
      try { unlinkSync(f.p); } catch { /* ignore */ }
    }
  }

  // ── 磁盘缓存总量上限 (按 mtime-LRU 淘汰) ─────────────────────────────
  // transcodeCacheDir 的 tc_*.mp4 每个 80–280MB, 没有上限就会一路增长
  // (几十 GB)。启动后扫一次, 超上限就按 mtime 从最旧开始删到上限以内。
  // 保守起见: 永不删最新的一份, 永不删 5 分钟内写出的文件 (可能是在途任务的产物),
  // 永不碰本进程的 .tmp<pid> 输出。
  const TRANSCODE_CACHE_MAX_BYTES = 4 * 1024 * 1024 * 1024;
  const CACHE_PRUNE_MIN_AGE_MS = 5 * 60 * 1000;
  function pruneCacheDirBySize(dir, maxBytes, matchRe) {
    /** @type {string[]} */
    let names;
    try { names = readdirSync(dir); } catch { return; }
    const ownTmpSuffix = '.tmp' + process.pid;
    const now = Date.now();
    const entries = [];
    let total = 0;
    for (const name of names) {
      if (name.endsWith(ownTmpSuffix) || !matchRe.test(name)) continue;
      const p = join(dir, name);
      /** @type {import('node:fs').Stats} */
      let st;
      try { st = statSync(p); } catch { continue; }
      if (!st.isFile()) continue;
      total += st.size;
      entries.push({ p, size: st.size, mtime: st.mtimeMs });
    }
    if (total <= maxBytes) return;
    entries.sort((x, y) => x.mtime - y.mtime); // 最旧优先
    for (let i = 0; i < entries.length - 1 && total > maxBytes; i++) {
      const e = entries[i];
      if (now - e.mtime < CACHE_PRUNE_MIN_AGE_MS) continue; // 可能是在途任务刚写的
      try { unlinkSync(e.p); total -= e.size; } catch { /* ignore */ }
    }
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
        // 产出＝spawn 正常返回且留下文件；"文件存在"不能当产出 —— 抛错的那次可能在盘上留残片
        // （image2 复用器"打开输出即建档"，0 字节/半张图），拿它 renameSync 发布就会在该缓存键下
        // 留下**永久坏图**。判据：test/verify-video-preview.mjs 的 D2（及其 M_LEFTOVER 负对照，
        // 那条变异体回放的正是"只看文件在不在"的旧语义）。
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

  return {
    videoPreviewCacheDir, videoPreviewCachePath,
    pruneVideoPreviewCache, pruneCacheDirBySize, TRANSCODE_CACHE_MAX_BYTES,
    generateVideoPreview,
  };
}
