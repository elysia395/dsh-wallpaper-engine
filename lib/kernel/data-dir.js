/**
 * data-dir.js —— 插件数据目录（P0 库化）。
 *
 * 来源：从 `lib/index.js` 纯搬移（原 682–698 与 700–701 两段 + 703–733 的 `cacheBaseDir`）。
 * `pluginDataDir` / `configPath` 是**模块级函数**（门面直接 import，语义与原名一致）；
 * `cacheBaseDir` 包进 `createDataDir`：它运行期要读 config.json 的 `cacheDir`，
 * 而 config.js 单向 import 本模块（反向会成环）⇒ 该依赖由门面注入。
 *
 * deps 契约：
 *   · readConfig       —— 读 config.json（`lib/kernel/config.js` 的 `readConfig`）
 *   · normalizeUserDir —— 用户填的路径归一化（`lib/fs-paths.js` 的模块级导出）
 *
 * 本模块绝不 import `lib/index.js`。
 */
import { join, normalize, resolve } from 'node:path';
import { homedir } from 'node:os';

/**
 * 插件数据目录（设置 / 抽屉抽帧 / 诊断落盘都在这里）。
 * 默认 `~/.dsh-wallpaper-engine`；`DSH_WE_DATA_DIR` 可把它整体挪走 —— 自检脚本
 * 会 PUT 设置，绝不能写用户真实的那份 config.json（与 DSH_WE_UPLOAD_DIR /
 * DSH_WE_CACHE_DIR 同一套测试隔离约定）。不设该变量时路径与从前完全一致。
 *
 * ⚠️ **跨插件读契约（dsh-skins 的首屏预判，issue #51）**：皮肤中心在**出文档之前**同步读
 *   `<该目录>/config.json` 的 `settings.id` —— 非空 ⇒ 视为"壁纸在台"，那一屏首帧不画皮肤、
 *   等壁纸接管（空 / 缺失 / JSON 坏一律 fail-open 向皮肤一侧）。所以下面三样都是**双边契约**，
 *   任何一侧单独改都会把首帧预判打回"皮肤先闪一下"：环境变量名 `DSH_WE_DATA_DIR`、
 *   文件名 `config.json`、键 `settings.id`（由 `serializeSettings` 无条件写出）。判据在
 *   test/verify-client.mjs 的互操作一节（含负对照）。
 */
export function pluginDataDir() {
  const override = process.env.DSH_WE_DATA_DIR;
  return override && override.trim() ? resolve(override.trim()) : join(homedir(), '.dsh-wallpaper-engine');
}

/** Config file that remembers the user-chosen upload directory. */
export function configPath() { return join(pluginDataDir(), 'config.json'); }

/**
 * 建一次数据目录内核（门面在模块作用域建一次）。
 */
export function createDataDir({ readConfig, normalizeUserDir }) {
  /**
   * 缓存**根**目录 —— 所有可再生产的大块产物都在这下面各占一个子目录：
   * `transcodes/`（重编码输出，每个 80–280MB）、`faststart/`（旧版 moov 搬家副本，本版不再落盘、
   * 只剩待回收）、`frames/`（场景抓帧 / 内嵌视频 / 包内音频）、`video-previews/`（缩略图）、
   * `media-bridge/`、`artwork/`。实测这几样合起来能吃掉几个 GB，也是「C 盘洁癖」的
   * 真正触发点（设置 / 头像 / 字体那些小文件挪不挪都无所谓）。
   *
   * 解析顺序：`DSH_WE_CACHE_DIR` → `config.json` 根字段 `cacheDir` → `<数据目录>/cache`。
   * 中间那一层就是设置页「高级 → 缓存位置」写的东西（POST /cache-dir，落盘 ⇒ 重启后仍在，
   * 用户不需要碰任何环境变量）。
   *
   * ⚠️ 两个不变量，改这里之前先读：
   *   ① **每次现读 config**（刻意不 memoize）：设置页改完立刻生效，且绝不会把新产物写回旧
   *      目录 —— 与 `pluginDataDir()` 同一条纪律。一次 readConfig 是几 KB 的同步读，而调用点
   *      都在请求 / 任务级（不是逐像素），代价可忽略。
   *   ② **本函数返回的是"根"**：`DSH_WE_CACHE_DIR` 早期只被帧缓存读、且被当作**帧目录本身**
   *      使用（不追加 `frames/`）。面向用户的 `cacheDir` 落地时统一成"根"这**一种**语义，
   *      两个入口不再各说各话（判据见 test/verify-cache-dir.mjs 的语义一节）。
   */
  function cacheBaseDir() {
    const env = process.env.DSH_WE_CACHE_DIR;
    if (env && env.trim()) return normalize(env.trim());
    const cfg = readConfig();
    if (typeof cfg.cacheDir === 'string' && cfg.cacheDir.trim()) {
      // 用户手写进 config.json 的值同样过一遍校验：坏值（相对路径 / 控制字符）当作没配，
      // 落回默认 —— 宁可缓存继续放老地方，也不许把它写到 cwd 或半个路径上去。
      const dir = normalizeUserDir(cfg.cacheDir);
      if (dir) return dir;
    }
    return join(pluginDataDir(), 'cache');
  }

  return { cacheBaseDir };
}
