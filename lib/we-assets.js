/**
 * lib/we-assets.js —— WE 官方资源目录 + 随包内建目录
 *
 * 四个随包内建目录常量（WEBWALLGL / about / fontsets / glass-presets）与 WE 官方资源路径族
 * （来源 id / 解析 / weAssetsAvailable / 取值与设值 / 目录缓存 / 资源名列举）都住这里。
 * 三个目录常量由 `resolve(pluginRoot, 'x')` 定位（`pluginRoot` 由门面注入 = `lib/`）。
 *
 * `WE_ASSETS_DIR` 仍是可变模块状态，收在本工厂闭包里；门面经 `getWeAssetsDir()` 读取，
 * 注释契约（`setWeAssetsDir` 会改写它）不变。
 */

import { resolve, normalize, join } from 'node:path';
import { statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';

export function createWeAssetsKit(deps) {
  const { pluginRoot, readConfig, writeConfig, enqueueConfigWrite } = deps;

  /** 本仓的 WebWallGL **渲染页适配层**（`lib/webwallgl/`）：引擎本体走 npm 依赖 `webwallgl`，
   *  由 `WEBWALLGL_PKG_DIR` 定位；页面的资源引用前缀写成 `/wallpaper-engine/scene-live/`。
   *  （不再有 vendored 副本与同步工具 —— 别按旧形态找 `sync-webwallgl`。） */
  const WEBWALLGL_DIR = resolve(pluginRoot, 'webwallgl');
  /**
   * 「关于」页签的联系方式二维码（`lib/about/*.png`）—— 与 `WEBWALLGL_DIR` 同一套"包内资源"
   * 口径：随包发布、只读、由插件自己的路由（`packages/about-notice/lib/routes/about-qr.js`）按白名单直出。
   * README 里引用的就是这两张图（展示与插件用的是同一份字节，不另存副本）。
   */
  const ABOUT_DIR = resolve(pluginRoot, 'about');
  /**
   * 随包字体集（F3）：`lib/fontsets/<id>.json` —— 与 `WEBWALLGL_DIR` 同一套"包内资源"口径
   * （相对本模块解析，随 `files` 发布）。**只读**：它是发布出去的字节，任何写路径都不得指向它；
   * 用户的编辑走"写时复制"落到 `pluginDataDir()/fontsets/`（见 lib/routes/fontsets.js 的文件头）。
   */
  const FONTSET_BUILTIN_DIR = resolve(pluginRoot, 'fontsets');
  /**
   * 随包玻璃预设：`lib/glass-presets/<id>.json` —— 与随包字体集同一套"包内资源"口径
   *（七套出厂观感，随 `files` 发布）。**只读**；用户保存的快照落
   * `pluginDataDir()/glass-presets/`（见 lib/routes/presets.js 的文件头）。
   */
  const GLASS_PRESET_BUILTIN_DIR = resolve(pluginRoot, 'glass-presets');

  /**
   * WE 官方资源路径（本机 Wallpaper Engine 安装目录的 assets 树或其拷贝）。
   * 场景壁纸效果链 / 材质 / 粒子按名引用的公共贴图（util/*、particle/**、
   * gradient/*）不在壁纸 pkg 里 —— WebWallGL 渲染页对它们默认走程序化复刻
   * （观感近似、逐像素对不上）。配了这个目录后，渲染页经 /api/local-assets
   * 端点（契约对齐上游 renderer/src/local-assets.ts）+ URL 参数
   * ?localAssets=1 按名取官方像素，渲染与官方引擎对齐；未配置 / 目录无效时
   * 渲染页静默回落程序化复刻。
   * 素材属 WE 版权内容：只从用户本机路径只读取用，绝不复制入库（合规同上游
   * docs/COMPLIANCE.md）。持久化在 config.json（weAssetsDir 字段），设置 UI
   * 走 POST /wallpaper-engine/we-assets-dir；DSH_WE_ASSETS_DIR 可环境覆盖。
   */
  const WE_ASSETS_SOURCE_ID = 'local';
  function resolveWeAssetsDir() {
    if (process.env.DSH_WE_ASSETS_DIR && process.env.DSH_WE_ASSETS_DIR.trim()) {
      return normalize(process.env.DSH_WE_ASSETS_DIR.trim());
    }
    const cfg = readConfig();
    if (typeof cfg.weAssetsDir === 'string' && cfg.weAssetsDir.trim()) {
      return normalize(cfg.weAssetsDir.trim());
    }
    return null;
  }
  let WE_ASSETS_DIR = resolveWeAssetsDir();

  /** 目录可用 = 存在 materials/ 子目录（渲染端只按名消费贴图，上游同一探测约定）。 */
  function weAssetsAvailable() {
    if (!WE_ASSETS_DIR) return false;
    try { return statSync(join(WE_ASSETS_DIR, 'materials')).isDirectory(); } catch { return false; }
  }

  /**
   * 取**当前**素材目录的访问器（**不是**值快照）。给 `lib/routes/we-assets.js` 用：
   * `WE_ASSETS_DIR` 是可变模块状态（`setWeAssetsDir` 会改写它）⇒ 若把值传进 `c`，
   * 配置端点刚 POST 完、消费端点却仍读旧值。此处与 `weAssetsAvailable` 成对。
   */
  function getWeAssetsDir() { return WE_ASSETS_DIR; }

  /** 设置 / 清除素材目录（persist config.json；写串行化，与 settings/uploadDir 不交错）。 */
  function setWeAssetsDir(dir) {
    return enqueueConfigWrite(() => {
      WE_ASSETS_DIR = dir;
      weAssetsIndexCache.clear();
      const cfg = readConfig();
      if (dir) cfg.weAssetsDir = dir;
      else delete cfg.weAssetsDir;
      writeConfig(cfg);
      return dir;
    });
  }

  // 素材名清单：materials/**/*.tex 的相对路径去扩展名（引擎名，posix 分隔 ——
  // `materials/util/noise.tex` → `util/noise`，与 shader/材质引用同名）。
  // 扫盘结果缓存 60s（官方树 ~586 个文件，每次壁纸挂载都重扫不值得；上游
  // dev server 同一约定）。
  const weAssetsIndexCache = new Map(); // dir → { names, at }
  async function listWeAssetNames(dir) {
    const hit = weAssetsIndexCache.get(dir);
    if (hit && Date.now() - hit.at < 60_000) return hit.names;
    const names = [];
    const walk = async (d, prefix) => {
      let entries;
      try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const rel = prefix ? prefix + '/' + e.name : e.name;
        if (e.isDirectory()) await walk(join(d, e.name), rel);
        else if (e.isFile() && e.name.toLowerCase().endsWith('.tex')) names.push(rel.slice(0, -4));
      }
    };
    await walk(join(dir, 'materials'), '');
    names.sort();
    weAssetsIndexCache.set(dir, { names, at: Date.now() });
    return names;
  }

  return {
    WEBWALLGL_DIR,
    ABOUT_DIR,
    FONTSET_BUILTIN_DIR,
    GLASS_PRESET_BUILTIN_DIR,
    WE_ASSETS_SOURCE_ID,
    resolveWeAssetsDir,
    WE_ASSETS_DIR,
    weAssetsAvailable,
    getWeAssetsDir,
    setWeAssetsDir,
    weAssetsIndexCache,
    listWeAssetNames,
  };
}
