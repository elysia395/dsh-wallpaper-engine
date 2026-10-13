/**
 * 缓存清扫套件：孤儿产物清扫 + 两类容量上限（启动/重扫时各跑一次，见 apply）。
 *
 * 为什么单独成模块：这四件事共享同一套纪律 ——「只清本进程不拥有的、且够旧的孤儿产物」，
 * 之前它们在 `lib/index.js` 里分居两处（约 860 行与 1600 行），任何一处改边界口径都要回头
 * 确认另一处。放在一起后，纪律只有一份可读的定义。
 *
 * 不变量：
 *  1. 永不删本进程在途写。转码临时名是 `.tmp<pid><6 位序号>`（见 `atomicTmpPath`），所以
 *     `ownTmpRe` 必须允许 pid 后跟**递增序号**；只认 `.tmp<pid>` 结尾会让 HMR 重扫时删掉
 *     正在写的产物 —— 这条在改名后会**静默**失效，所以守卫要盯住正则形态而不是调用点。
 *  2. 三个目录解析器（转码缓存 / ffmpeg 数据目录 / 视频缩略图）由宿主注入，本模块不自己推导：
 *     它们的根都是 `cacheBaseDir()`，留在 `lib/index.js` 才能被 `test/verify-cache-dir.mjs`
 *     的文本锚点（`join(cacheBaseDir(), 'transcodes'|'video-previews')`）看住。
 *     宿主在**模块加载期**建立本套件，所以注入点必须是函数声明（可提升），不得改成 `apply()` 内惰性计算。
 *  3. 全部失败路径都是「宁可不清」：readdir/stat 抛异常就跳过，unlink 抛异常也吞掉（下一轮再清）。
 *
 * 调用点：`apply()` 的 `startupSweepTimer`（三个 sweep + 两个上限修剪），以及 `atomicTmpPath`
 * 的命名约定（`sweepCustomFrameTmp` 只清够旧的 `.tmp`，因为上传用的是确定性临时名）。
 */
import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export function createCachePruneKit({ transcodeCacheDir, ffmpegDataDir, videoPreviewCacheDir }) {

  // Startup-only sweep of orphaned transcode/download artifacts (see apply()).
  // Matches: `*.tmp<pid>` transcode outputs, `*.prog` progress files (legacy),
  // `*.part*` download partials, `ffmpeg-err-*.log` spawn logs. Runs once before
  // any route is served, so nothing of the current process is ever touched.
  function sweepTranscodeArtifacts() {
    const dirs = [transcodeCacheDir(), ffmpegDataDir(), videoPreviewCacheDir()];
    // A plugin HMR/re-apply re-runs this sweep while the SAME process may still be
    // mid-transcode; never delete artifacts owned by the current pid (the ffmpeg
    // child keeps writing to `.tmp<pid>` — removing it would corrupt the job).
    // ⚠️ 尾部要允许**递增序号**：转码临时名走 `atomicTmpPath`（`.tmp<pid><6 位序号>`），
    // 只认 `.tmp<pid>` 结尾会让"保护本进程在途写"这条在改名后静默失效（HMR 时删掉正在写的产物）。
    const ownTmpRe = new RegExp('\\.tmp' + process.pid + '\\d*$');
    for (const dir of dirs) {
      let entries;
      try { entries = readdirSync(dir); } catch { continue; }
      for (const name of entries) {
        if (ownTmpRe.test(name)) continue;
        if (!(/\.tmp\d*$/.test(name) || /\.part\d*$/.test(name)
          || /\.prog$/.test(name) || /^ffmpeg-err-/.test(name))) continue;
        try { unlinkSync(join(dir, name)); } catch { /* ignore */ }
      }
    }
  }

  /**
   * 自定义画面目录的孤儿 `.tmp` 清扫。
   *
   * `/custom-frame` 的"中途放弃"已由 `req 'close'` 收口（见 `routes/scene-frame.js` 文件头的不变量）
   * ⇒ 正常路径不再留孤儿。剩下的来源是**进程被强杀 / 崩溃**：写流随进程消失，`.tmp` 留在盘上。
   * 而读取侧（`customFramePath` / `listCustomFrameIds`）只认 `.png|.jpg|.webp` ⇒ 那种垃圾
   * **看不见**、只会累积（`sweepTranscodeArtifacts` 扫的三个目录都不含自定义画面目录）。
   *
   * ⚠️ 只清**够旧**的：HMR 重新 apply 会再跑一次本清扫，而同一进程里可能正有一个上传在写那个
   * 确定性的 `.tmp` 名 —— 按年龄设限就不会误删在途写（与 `sweepTranscodeArtifacts` 的
   * `ownTmpSuffix` 是同一类保护，这里是时间口径）。
   */
  const CUSTOM_FRAME_TMP_STALE_MS = 10 * 60 * 1000;
  function sweepCustomFrameTmp(dir) {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    const cutoff = Date.now() - CUSTOM_FRAME_TMP_STALE_MS;
    for (const name of entries) {
      if (!name.endsWith('.tmp')) continue;
      const abs = join(dir, name);
      try { if (statSync(abs).mtimeMs > cutoff) continue; } catch { continue; }
      try { unlinkSync(abs); } catch { /* ignore */ }
    }
  }

  /** Bound the on-disk cache (one small JPEG per distinct source revision). */
  const VIDEO_PREVIEW_CACHE_MAX = 512;
  function pruneVideoPreviewCache() {
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
    let names;
    try { names = readdirSync(dir); } catch { return; }
    const ownTmpSuffix = '.tmp' + process.pid;
    const now = Date.now();
    const entries = [];
    let total = 0;
    for (const name of names) {
      if (name.endsWith(ownTmpSuffix) || !matchRe.test(name)) continue;
      const p = join(dir, name);
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
  return {
    sweepTranscodeArtifacts,
    sweepCustomFrameTmp,
    pruneVideoPreviewCache,
    pruneCacheDirBySize,
    TRANSCODE_CACHE_MAX_BYTES,
  };
}
