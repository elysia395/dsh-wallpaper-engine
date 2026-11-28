/**
 * image-preview.js — 自定义上传**图片**的缩略图族（按需 ffmpeg 缩放 + 磁盘缓存 + 并发闸，
 *）。
 *
 * ══ 为什么需要它 ══════════════════════════════════════════════════════════════
 * 上传图片**不能直接把自己当 preview**（`/preview/<token>` = 原图）。壁纸库卡片只有
 * 92px 高、列宽 ~120–160px，却让浏览器下载并解码一张 8064×5376（43 MP、17 MB）的原图；
 * 一页 24 张就是 ~400 MB 传输 + 24 × 43 MP 解码（解码后 ~165 MB RGBA/张）⇒ 同一个渲染
 * 进程里的整个 GUI（点击 / 滚动 / 重渲染）全部排队，表现为"翻到含大图那几页就卡死"。
 *
 * 缩略图把每张压到 ~10 KB 量级（320px 宽 JPEG），卡片只解 0.1 MP ⇒ 卡顿消失；
 * 原图与 `/media` 一个字节都不动，点开播放仍是原画质。
 *
 * ══ 契约 ══════════════════════════════════════════════════════════════════════
 * deps：
 *   · pluginDataDir()      → 插件数据目录（缩略图落 `<它>/thumbs/`）
 *   · ensureDirOnce(dir)   → memo 化的 mkdirSync（转码套件里那份共享实现）
 *   · transcodeKit         → 只借 `resolveFfmpeg` / `spawnFfmpeg`（不自带供给链，避免成环）
 *
 * 返回面：`imageThumbDir()` · `imageThumbPath(abs)` · `ensureImagePreview(abs)` ·
 *         `pruneImagePreviewCache()` · `IMAGE_PREVIEW_WIDTH`
 *
 * 不变量：
 *   · **缓存键含 size + mtime**：替换源图 ⇒ 键变 ⇒ 重新生成，不会把旧缩略图端出去。
 *   · **同一个键的并发请求共享一次生成**（in-flight 表）：一页 24 张卡片会同时问同一个
 *     源（兜底路径 / 重试），不合并就是 24 次 ffmpeg。
 *   · **失败一律返回 null，绝不抛给路由**：调用方据此回落原图（换机器 / 没装 ffmpeg /
 *     源文件是畸形图片都要能退化成"慢一点但可用"）。
 *   · **产出判定是 spawn 正常返回**，不是"文件存在"——失败那次可能在盘上留 0 字节残片
 *     （与 video-preview 同一条教训），拿它 rename 发布会留下永久坏图。
 *   · **缩略图不放 `<cacheDir>/`**：那里会被 cache-prune 按体积/年龄扫，把缩略图当垃圾
 *     清掉。它们是**派生但稳定**的资产（源图在就在），放插件数据目录。
 *   · 本模块只 import `node:*` 与相对路径，**绝不** import `lib/index.js`（会成环）。
 */

import { existsSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * 缩略图宽度上限（px）。卡片最宽约 160 CSS px，按 2× 屏给到 320 —— 再大只是浪费带宽，
 * 再小在高 DPI 上会糊。写进缓存键 ⇒ 以后调这个值会让旧缩略图自然失效（不会端糊图）。
 */
const IMAGE_PREVIEW_WIDTH = 320;
/** 并发生成闸：一页 24 张同时打开时，别一次 spawn 24 个 ffmpeg 把机器压住。 */
const IMAGE_PREVIEW_MAX_CONCURRENT = 2;
/** 磁盘缓存上限（文件个数）。一张 ~10 KB ⇒ 512 个约 5 MB，足够一个几百张的库。 */
const IMAGE_PREVIEW_CACHE_MAX = 512;

export function createImagePreviewKit(deps) {
  const { pluginDataDir, ensureDirOnce, transcodeKit } = deps;
  const { resolveFfmpeg, spawnFfmpeg } = transcodeKit;

  function imageThumbDir() { return ensureDirOnce(join(pluginDataDir(), 'thumbs')); }

  /** 缓存路径：键 = 绝对路径 + size + mtime + 目标宽度（换源 / 换宽度都自然失效）。 */
  function imageThumbPath(abs) {
    let size = 0, mtime = 0;
    try { const st = statSync(abs); size = st.size; mtime = Math.round(st.mtimeMs); } catch { /* ignore */ }
    const key = createHash('sha256')
      .update(String(abs) + '|' + size + '|' + mtime + '|ip1|' + IMAGE_PREVIEW_WIDTH)
      .digest('hex').slice(0, 24);
    return join(imageThumbDir(), 'ip_' + key + '.jpg');
  }

  let active = 0;
  const waiters = [];
  function acquire() {
    if (active < IMAGE_PREVIEW_MAX_CONCURRENT) { active += 1; return Promise.resolve(); }
    return new Promise((resolve) => { waiters.push(resolve); });
  }
  function release() {
    const next = waiters.shift();
    if (next) next(); else active -= 1;
  }

  const INFLIGHT = new Map();
  /**
   * 确保某个源图有缩略图，返回缩略图绝对路径；失败返回 null（调用方回落原图）。
   * @param {string} abs 源图绝对路径
   */
  async function ensureImagePreview(abs) {
    if (!abs) return null;
    let out;
    try { out = imageThumbPath(abs); } catch { return null; }
    if (existsSync(out)) return out;
    const pending = INFLIGHT.get(out);
    if (pending) return pending;
    const job = (async () => {
      await acquire();
      const tmp = out + '.tmp' + process.pid;
      try {
        if (existsSync(out)) return out; // 排队期间同键的兄弟已经产出
        const ff = await resolveFfmpeg(null);
        // 短边等比缩到 320 以内，保持偶数高度（JPEG 友好；`-2` 让 ffmpeg 自己取整）。
        // `-update 1` + image2：单帧输出；`-q:v 5` 约 10 KB/张（320px）。
        await spawnFfmpeg(ff, [
          '-y', '-hide_banner', '-nostdin',
          '-i', abs,
          '-frames:v', '1', '-an',
          '-vf', `scale='min(${IMAGE_PREVIEW_WIDTH},iw)':-2`,
          '-q:v', '5',
          '-update', '1', '-f', 'image2', tmp,
        ], 60 * 1000, {});
        if (!existsSync(tmp)) return null;
        renameSync(tmp, out);
        return out;
      } catch {
        try { unlinkSync(tmp); } catch { /* ignore */ }
        return null;
      } finally {
        release();
      }
    })();
    INFLIGHT.set(out, job);
    const cleanup = () => { if (INFLIGHT.get(out) === job) INFLIGHT.delete(out); };
    job.then(cleanup, cleanup);
    return job;
  }

  /** 按文件个数裁剪（mtime-LRU）；删掉最旧的，保留最近的。 */
  function pruneImagePreviewCache() {
    let names;
    try { names = readdirSync(imageThumbDir()); } catch { return; }
    const files = names.filter((n) => n.startsWith('ip_') && n.endsWith('.jpg'));
    if (files.length <= IMAGE_PREVIEW_CACHE_MAX) return;
    const ranked = files.map((n) => {
      const p = join(imageThumbDir(), n);
      let mtime = 0; try { mtime = statSync(p).mtimeMs; } catch { /* keep 0 */ }
      return { p, mtime };
    }).sort((a, b) => b.mtime - a.mtime);
    for (const f of ranked.slice(IMAGE_PREVIEW_CACHE_MAX)) {
      try { unlinkSync(f.p); } catch { /* ignore */ }
    }
  }

  return {
    imageThumbDir, imageThumbPath, ensureImagePreview, pruneImagePreviewCache,
    IMAGE_PREVIEW_WIDTH, IMAGE_PREVIEW_CACHE_MAX,
  };
}
