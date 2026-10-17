/**
 * cache-dir.js —— 缓存根子目录迁移（P0.2-B 存储族）。
 *
 * 来源：从 `lib/index.js` 纯搬移（原 1024–1099：`CACHE_SUBDIRS` / `moveTreeP` / `setCacheDir`）。
 *
 * 形式：整段包进 `createCacheDirKit(deps)`（工厂包裹 ⇒ 每行 +2 缩进，除此之外逐字未改）。
 * `CACHE_SUBDIRS` 的成员清单与调用点逐字保留（它同时是 `cacheBaseDir()` 文档里那份清单的镜像）。
 *
 * deps 契约：
 *   · cacheBaseDir        —— 缓存根解析链（`lib/kernel/data-dir.js`）
 *   · readConfig / writeConfig / enqueueConfigWrite —— config.json 的读、写与串行队列
 *   · pathExistsP         —— 异步存在性探测（内核提供：`lib/kernel/host-kernel.js`）
 *   · ensureDirOnce       —— 按路径 memoize 的 mkdir（`lib/media/transcode.js`）
 *   · moveFileP           —— 跨卷安全的单文件移动（`lib/fs-paths.js` 模块级导出）
 *
 * 本模块绝不 import `lib/index.js`。
 */
import { join, normalize } from 'node:path';
import { readdir } from 'node:fs/promises';

export function createCacheDirKit({
  cacheBaseDir, readConfig, writeConfig, enqueueConfigWrite, pathExistsP, ensureDirOnce, moveFileP,
}) {
  /**
   * 缓存根下**已知**的子目录（`setCacheDir` 的迁移只认这些名字）。
   * 与 `cacheBaseDir()` 的文档一一对应：加一个新的缓存子目录时，这里要同时加。
   */
  const CACHE_SUBDIRS = ['transcodes', 'faststart', 'frames', 'video-previews', 'media-bridge', 'artwork'];

  /**
   * 递归移动一棵目录树（best effort）。返回 `{ moved, skipped }`。
   *
   * 不变量：
   *   · **绝不删除没能搬走的条目** —— 跨卷 copy 失败就留在原地（最多成为旧目录里的垃圾）。
   *     缓存全是可再生物，所以"没搬成功"的正确后果是下次重跑一遍，而不是丢用户的东西。
   *   · **不跟随符号链接**（`withFileTypes` + 只认 `isFile`/`isDirectory`，其余一律 skipped）：
   *     跟随 symlink 会把这次移动带出这棵树，指到用户别的地方去。
   *   · 逐项 `await`：几千个小文件时让出事件循环，避免一次性并发打满 IO。
   */
  async function moveTreeP(src, dst) {
    let moved = 0;
    let skipped = 0;
    /** @type {import('node:fs').Dirent[]} */
    let entries;
    try { entries = await readdir(src, { withFileTypes: true }); } catch { return { moved, skipped }; }
    ensureDirOnce(dst);

    for (const entry of entries) {
      const from = join(src, entry.name);
      const to = join(dst, entry.name);
      if (entry.isDirectory()) {
        const sub = await moveTreeP(from, to);
        moved += sub.moved;
        skipped += sub.skipped;
      } else if (entry.isFile()) {
        if (await moveFileP(from, to)) moved += 1;
        else skipped += 1;
      } else {
        skipped += 1;
      }
    }
    return { moved, skipped };
  }

  /**
   * Switch the cache root (persisted to config.json as the root field `cacheDir`),
   * migrating existing cache by default. 整体进 config 写队列：迁移 + cacheDir 持久化
   * 串行执行，不与 settings / uploadDir 的读-改-写交错。
   *
   * ⚠️ 迁移**只搬 `CACHE_SUBDIRS` 里那几个名字**：目标路径可能是用户随手指的一个已有目录
   *   （D:\ 根、某个项目文件夹、甚至他的下载目录），把目标当"整棵树都归我"来 readdir 全搬
   *   会把无关文件卷进来 —— 而"指错目录等于动用户的东西"是本族最不能犯的错。搬不动也只是
   *   让他重跑一次转码，代价可接受。
   * ⚠️ 旧目录**不删**（只留下被搬空的子目录壳）：插件不替用户删目录，那由系统里自己收尾。
   */
  function setCacheDir(newDir, migrate) {
    return enqueueConfigWrite(async () => {
      const oldDir = normalize(cacheBaseDir());
      const target = normalize(newDir);
      if (oldDir.toLowerCase() === target.toLowerCase()) {
        return { cacheDir: target, migrated: 0, skipped: 0, same: true };
      }
      // 先把目标建出来再搬：目标不存在时每一项都会失败并计入 skipped。
      ensureDirOnce(target);
      let migrated = 0;
      let skipped = 0;
      if (migrate !== false && (await pathExistsP(oldDir))) {
        for (const name of CACHE_SUBDIRS) {
          const from = join(oldDir, name);
          if (!(await pathExistsP(from))) continue;
          const sub = await moveTreeP(from, join(target, name));
          migrated += sub.moved;
          skipped += sub.skipped;
        }
      }
      const cfg = readConfig();
      cfg.cacheDir = target;
      writeConfig(cfg);
      return { cacheDir: target, migrated, skipped, same: false };
    });
  }

  return { setCacheDir };
}
