/**
 * 配置存储：`config.json` 的读、原子发布、以及 `settings` 段的读改写串行化。
 *
 * 为什么单独成模块：这里是宿主**唯一**的持久状态面（上传目录 / 缓存目录 / 全部设置都写在这
 * 一份 JSON 里），而它的三条纪律 —— 原子发布、临时名唯一、读改写排队 —— 之前和「路径怎么
 * 推导」混在同一个文件里（`lib/index.js` 约 570–663 行）。路径推导要留在 index.js（见下），
 * 纪律放这里，两边各自可读。
 *
 * 不变量：
 *  1. **原子发布**：先写 `<file>.tmp` + `fsync` 再 `rename`（跨设备/被占用的兜底是最朴素的
 *     覆盖写）。崩溃/断电只会留下旧文件或新文件，绝不留下截断的半份。
 *  2. **临时名每次调用唯一**：`<file>.tmp<pid><6 位序号>`。同一目标文件的并发写者不共用同一个
 *     `.tmp`（共用会互相 rename 对方的半截内容）；后缀**必须保持纯数字**，否则
 *     `cache-prune` 的 `.tmp\d*$` / `atomicTmpPath` 前提下的孤儿清扫会认不出它。
 *  3. **所有读-改-写都过 `enqueueConfigWrite`**：settings / uploadDir / cacheDir / fontsetId
 *     的写都是三步，并发时后写者基于旧快照会吞掉先写者的改动；队列本身永不 reject，
 *     一次失败只影响它自己的调用方。
 *  4. **读永不抛**：`readConfig()` 对缺失/坏 JSON/非对象一律回 `{}`，调用方不必 try/catch。
 *  5. `configPath` 由宿主注入（它是 `pluginDataDir()` 的推导，`DSH_WE_DATA_DIR` 覆盖与
 *     `join(pluginDataDir(), 'config.json')` 这两个字面量必须留在 `lib/index.js` —— 有守卫按
 *     文本盯住它们）；宿主在**模块加载期**建立本套件，注入点是函数声明（可提升）。
 *
 * 调用点：`lib/index.js` 的 uploadDir/cacheDir/fontsetId/settings 读写与 `routes/*` 经 `c`
 * 拿到的 `atomicWriteFileP`；`lib/routes/settings.js` 走 readSettings/writeSettings。
 */
import { readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, mkdirSync } from 'node:fs';
import { writeFile as writeFileP, rename as renameP, unlink as unlinkP } from 'node:fs/promises';
import { dirname } from 'node:path';

export function createConfigStoreKit({ configPath }) {
  function readConfig() {
    try {
      // 数组也是 `typeof 'object'`：放它进来，后续 `cfg[SETTINGS_FIELD] = …` 挂的是非索引属性，
      // `JSON.stringify([])` 仍是 `"[]"` ⇒ 设置写静默丢失、且此后每次写都丢（不可逆）。
      const o = JSON.parse(readFileSync(configPath(), 'utf8'));
      return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
    } catch { return {}; }
  }

  /**
   * Atomic whole-file write: temp file + fsync + rename. Crash/断电 mid-write
   * leaves either the old file or the new file, never a truncated one (the same
   * publication semantics @deepseek-ai/dsh-storage-json uses for its JSON units;
   * on Windows libuv rename maps to MoveFileExW with replace).
   */
  function atomicWriteFileSync(filePath, data) {
    const tmp = filePath + '.tmp';
    const fd = openSync(tmp, 'w');
    try {
      writeFileSync(fd, data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      renameSync(tmp, filePath);
    } catch {
      // Cross-device / locked-target fallback: keep best-effort plain write.
      writeFileSync(filePath, data);
    }
  }

  /** Async variant of atomicWriteFileSync (same .tmp + rename publication). */
  // 临时名带 pid + 进程内序号：同一目标文件的并发写入者不共用同一个
  // `<file>.tmp`（共用时两路并发 PUT 会互相 rename/覆盖对方半截内容）。
  // 后缀保持纯数字，兼容既有的 `.tmp\d*$` 清理规则。
  let atomicTmpSeq = 0;
  function atomicTmpPath(filePath) {
    atomicTmpSeq = (atomicTmpSeq + 1) % 1000000;
    return filePath + '.tmp' + process.pid + String(atomicTmpSeq).padStart(6, '0');
  }
  async function atomicWriteFileP(filePath, data) {
    const tmp = atomicTmpPath(filePath);
    await writeFileP(tmp, data);
    try {
      await renameP(tmp, filePath);
    } catch {
      // Cross-device / locked-target fallback: keep best-effort plain write.
      try { await writeFileP(filePath, data); } finally {
        try { await unlinkP(tmp); } catch { /* ignore */ }
      }
    }
  }

  function writeConfig(cfg) {
    try {
      mkdirSync(dirname(configPath()), { recursive: true });
      atomicWriteFileSync(configPath(), JSON.stringify(cfg));
    } catch { /* ignore */ }
  }

  /**
   * Plugin settings (wallpaper selection, scrim/border/blur, rotation groups,
   * hidden ids, playback rate, flip, object-fit, filters, liquid-glass theme)
   * persisted in the SAME config.json as uploadDir — host-side, port-independent.
   * The browser half reads/writes them through GET/PUT /wallpaper-engine/settings:
   * the loopback port is random (`--port 0`) and changes on every DSH Desktop
   * restart, so storage keyed to the page origin cannot be the source of truth.
   */
  const SETTINGS_FIELD = 'settings';

  // config.json 写串行化：settings 与 uploadDir 的写都是「读-改-写」三步，
  // 并发执行时后写者基于旧快照会吞掉先写者的改动。用一个简单的 promise 链
  // 排队，让每次读-改-写完整跑完再开始下一次。
  let configWriteQueue = Promise.resolve();
  function enqueueConfigWrite(fn) {
    const p = configWriteQueue.then(fn, fn);
    // 队列本身永不 reject：一次失败只影响它自己的调用方，不阻塞后续写入。
    configWriteQueue = p.then(() => {}, () => {});
    return p;
  }

  function readSettings() {
    const cfg = readConfig();
    const s = cfg[SETTINGS_FIELD];
    return s && typeof s === 'object' ? s : null;
  }

  function writeSettings(settings) {
    return enqueueConfigWrite(() => {
      const cfg = readConfig();
      cfg[SETTINGS_FIELD] = settings;
      writeConfig(cfg);
      return settings;
    });
  }
  return {
    readConfig, writeConfig, readSettings, writeSettings, SETTINGS_FIELD,
    atomicWriteFileSync, atomicWriteFileP, atomicTmpPath, enqueueConfigWrite,
  };
}
