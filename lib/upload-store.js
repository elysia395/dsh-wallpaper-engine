/**
 * 上传元数据账本（`<uploads>/.meta.json`）——把「用户上传的这份文件叫什么、内容 sha256 是多少」
 * 落成一份可并发读改写的账本。
 *
 * 为什么单独成模块：这一族只在做一件事，但它与 `config.json` 的原子写、`ensureDirOnce()` 的目录
 * 记忆化共用同一套纪律（原子发布 + 串行队列 + 失败不抛），任何一处放松都会静默丢数据，所以它必须
 * 与宿主其余部分**同一时刻**活着，且不掺进 apply 的编排里。
 *
 * 不变量：
 *   1. 所有写入都过注入的 `enqueueConfigWrite`（与 config.json 共用同一队列）：「读整份 → 改一条
 *      → 原子写回」三步不得交错，否则后写者基于旧快照会吞掉先写者的 sha256，`/upload` 的内容
 *      去重（按 sha256 比对）就再也匹配不上，同一份文件被反复堆成副本。
 *   2. 落盘一律注入的 `atomicWriteFileSync`（.tmp + rename）：崩溃/断电不留半截 JSON。
 *   3. 读路径永不抛：文件缺失 / 坏 JSON / 非对象都退化为 `{}`。
 *   4. 目录只通过 `getUploadDir()` 访问器取 —— `UPLOAD_DIR` 是**加载期解析**、运行期还能被
 *      `setUploadDir()` 改写的宿主状态（env 口径见 docs/DEV-GUIDE.md），套件不持有它，
 *      也就不会出现"套件里的路径"与"宿主认的路径"分叉。
 *
 * 消费方：`lib/routes/upload.js`（写入/移除）与 inventory（`metaEntry` 决定 title/sha256/rating）。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function createUploadStoreKit({ getUploadDir, ensureDirOnce, enqueueConfigWrite, atomicWriteFileSync }) {
  function ensureUploadDir() {
    // 按路径 memoize：UPLOAD_DIR 变化（setUploadDir）时新路径仍会 mkdir。
    return ensureDirOnce(getUploadDir());
  }

  function uploadMetaPath() { return join(getUploadDir(), '.meta.json'); }

  function readUploadMeta() {
    const p = uploadMetaPath();
    if (!existsSync(p)) return {};
    try {
      // 数组也是 `typeof 'object'`：放它进来，`m[id] = …` 挂的是非索引属性，
      // `JSON.stringify([])` 仍是 `"[]"` ⇒ 之后的每一次写都静默丢掉（去重永久失效）。
      const o = JSON.parse(readFileSync(p, 'utf8'));
      return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
    } catch { return {}; }
  }

  /**
   * Normalize one meta entry: legacy shape `{ id: title }` or the current
   * `{ id: { title, sha256 } }`. sha256 lets the upload route deduplicate
   * identical content (re-uploading the same file returns the existing entry
   * instead of piling up copies).
   */
  function metaEntry(meta, id) {
    const v = meta[id];
    if (typeof v === 'string') return { title: v, sha256: null, contentrating: null };
    if (v && typeof v === 'object') return {
      title: typeof v.title === 'string' && v.title.trim() ? v.title : id,
      sha256: typeof v.sha256 === 'string' ? v.sha256 : null,
      // Same field the Workshop path reads from project.json, mirrored for
      // custom uploads in uploads/.meta.json (WE's G / PG13 / R tags). Missing
      // or non-string values stay null: the inventory reports what is actually
      // recorded, and the CLIENT decides how a missing rating is filtered (see
      // ratingOf — uploads without a rating count as Everyone, #84).
      contentrating: typeof v.contentrating === 'string' && v.contentrating.trim()
        ? v.contentrating.trim() : null,
    };
    return { title: id, sha256: null, contentrating: null };
  }

  /**
   * 写入一份上传 meta。**必须串行**（与 `config.json` 共用同一写队列）。
   *
   * 这是「读整份 → 改一条 → 原子写回」三步：并发交错时后写者基于旧快照，会吞掉先写者的改动。
   * 丢掉的若是 `sha256`，`/upload` 的内容去重（按 sha256 比对）就再也匹配不上 ⇒ 同一文件被
   * 反复堆成副本。`/remove` 与上传完成回调本来就可以交错，所以这条不是理论风险。
   * 返回值是该次写盘的 promise（调用方等它落盘再应答，保持"响应即已持久化"的语义）。
   */
  function setUploadMeta(id, title, sha256) {
    return enqueueConfigWrite(() => {
      try {
        const m = readUploadMeta();
        m[id] = { title: title || id, sha256: sha256 || null };
        // 原子写（.tmp+rename）：崩溃/断电不留半截 JSON，整份 meta 不会丢失。
        atomicWriteFileSync(uploadMetaPath(), JSON.stringify(m));
      } catch { /* ignore */ }
    });
  }

  function removeUploadMeta(id) {
    return enqueueConfigWrite(() => {
      try {
        const m = readUploadMeta();
        if (id in m) { delete m[id]; atomicWriteFileSync(uploadMetaPath(), JSON.stringify(m)); }
      } catch { /* ignore */ }
    });
  }

  /** Common preview file names probed inside a WE project directory. */
  const PREVIEW_CANDIDATES = ['preview.jpg', 'preview.png', 'preview.gif', 'preview.webp'];

  return {
    ensureUploadDir, uploadMetaPath, readUploadMeta, metaEntry, setUploadMeta, removeUploadMeta,
    PREVIEW_CANDIDATES,
  };
}
