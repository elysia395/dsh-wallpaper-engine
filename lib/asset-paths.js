/**
 * 本机目录与导入素材的路径/清单解析（从 lib/index.js 搬出；宿主只留门面与 `UPLOAD_DIR` 状态）。
 *
 * 不变量：
 *   ① 所有目录都由注入的 `pluginDataDir()` 派生 —— **绝不写死家目录**：`DSH_WE_DATA_DIR` 是本仓
 *      全部自检脚本的隔离开关，写死会让"自定义画面 / 头像 / 立绘 / 首帧"落进用户真实数据目录。
 *   ② 上传目录解析保持**加载期**语义：env 覆盖 → 持久化 config → 默认值。`UPLOAD_DIR` 可变状态
 *      仍留在宿主门面（`setUploadDir` 运行期改写它），本模块只提供 `resolveUploadDir`。
 *   ③ WE 官方素材目录**只读**：只解析路径 + 探测 `materials/` + 列出 `.tex` 名，绝不复制入库。
 *   ④ 素材名清单缓存 60s（官方树 ~586 文件），缓存键是目录 ⇒ 换目录即失效（setter 清表）。
 *   ⑤ 与搬出前逐字一致：只整体缩进 +2，依赖全部由工厂注入；谁改这里都要保住上面四条。
 */
import { readdirSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, normalize } from 'node:path';

export function createAssetPathsKit({
  pluginDataDir, ensureDirOnce, readConfig, writeConfig, enqueueConfigWrite,
}) {
  /**
   * Upload directory, resolved in order: env override → persisted user config →
   * default. Users change it from the settings UI (POST /upload-dir), which
   * persists it to config.json so it survives restarts without any env setup.
   *
   * 默认值**走 `pluginDataDir()`**（原来是写死的 `~/.dsh-wallpaper-engine/uploads`）：
   * 写死意味着 `DSH_WE_DATA_DIR` 挪得走 config.json、却挪不走 uploads —— 自检脚本里
   * "整个插件数据目录都被隔离"这句话就不成立（uploads 会落进真实家目录）。
   */
  function defaultUploadDir() { return join(pluginDataDir(), 'uploads'); }
  function resolveUploadDir() {
    if (process.env.DSH_WE_UPLOAD_DIR) return process.env.DSH_WE_UPLOAD_DIR;
    const cfg = readConfig();
    if (typeof cfg.uploadDir === 'string' && cfg.uploadDir.trim()) return cfg.uploadDir.trim();
    return defaultUploadDir();
  }

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

  /** Accepted upload MIME → file extension (matches mimeFor in lib/serve.js). */
  const UPLOAD_EXT = { 'video/mp4': 'mp4', 'image/jpeg': 'jpg', 'image/png': 'png' };

  // ── 自定义画面（截屏导入）─────────────────────────────────────────────────
  // 用户在 WE 等处对无法静态生成的壁纸（骨骼拼装场景如 Kirito x Asuna，预览
  // gif 仅 160px）自行截图后按壁纸 id 导入；scene-frame ?v=4 直接服务该图，
  // 作为刷新档位的「自定义画面」档。分辨率 = 用户截图分辨率。
  const CUSTOM_FRAME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const CUSTOM_FRAME_MAX_BYTES = 30 * 1024 * 1024;
  // ⚠️ 必须走 `pluginDataDir()`（**不**写死 `~/.dsh-wallpaper-engine`）：DSH_WE_DATA_DIR 是
  //    本仓所有自检脚本的隔离开关，写死家目录会让「自定义画面」落进用户真实数据目录 ——
  //    而 scene-frame 路由会清掉"同一个壁纸 id 的旧文件"，指错目录就是在动用户的东西。
  function customFrameDir() { return ensureDirOnce(join(pluginDataDir(), 'overrides')); }

  // ── 自定义会话头像（「扩展」页签第一个模块）──────────────────────────────────
  // 两张图（「我」/「助手」）由用户导入，落在插件自己的数据目录里（**不进** overrides ——
  // 那是"某个壁纸的画面"，语义不同；也不进 uploads —— 那会污染壁纸库存）。
  // 文件名带一颗宿主生成的时间戳：`<side>-<stamp>.<ext>`，换图即换名 ⇒ `<img>` 的 URL 变、
  // 不吃浏览器旧缓存（设置里存的正是这个名字，见 settings-schema 的 avatarFile 档）。
  const AVATAR_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  /** 头像体积上限：客户端导入前已按 512px 压过一轮，8 MB 是"用户直接丢原图"的宽松上限。 */
  const AVATAR_MAX_BYTES = 8 * 1024 * 1024;
  /** 两张头像的**落盘侧**名字（= 路由路径段，也是文件名前缀）。 */
  const AVATAR_SIDES = ['user', 'ai'];
  const AVATAR_FILE_RE = /^(user|ai)-[a-z0-9]{4,16}\.(png|jpg|webp)$/;
  function avatarDir() { return ensureDirOnce(join(pluginDataDir(), 'avatars')); }
  /**
   * 某一方当前的头像文件绝对路径（没有则 null）。
   * 只认 `AVATAR_FILE_RE` 形状且前缀匹配的文件 —— 路由不接受调用方给的路径，
   * 于是"删掉旧图再写新图"这件事只需按前缀扫一次目录（同侧的正式文件至多一个）。
   */
  // ── 自定义吉祥物立绘（「系统」页签 · 聊天吉祥物）──────────────────────────────
  // 与头像同一套落盘约定（插件数据目录里的文件 + 设置里只存文件名），但**只有一张**：
  // 再导入即覆盖（路由会清同族旧文件）。
  const MASCOT_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const MASCOT_MAX_BYTES = 8 * 1024 * 1024;
  const MASCOT_FILE_RE = /^mascot-[a-z0-9]{4,16}\.(png|jpg|webp)$/;
  function mascotDir() { return ensureDirOnce(join(pluginDataDir(), 'mascot')); }
  /** 当前那张立绘的绝对路径（没有则 null）：只认 `mascot-*.{png,jpg,webp}`。 */
  function mascotPath() {
    let entries;
    try { entries = readdirSync(mascotDir()); } catch { return null; }
    for (const name of entries) {
      if (!MASCOT_FILE_RE.test(name)) continue;
      return join(mascotDir(), name);
    }
    return null;
  }

  function avatarPath(side) {
    const s = String(side || '');
    if (!AVATAR_SIDES.includes(s)) return null;
    let entries;
    try { entries = readdirSync(avatarDir()); } catch { return null; }
    for (const name of entries) {
      if (!AVATAR_FILE_RE.test(name) || name.slice(0, s.length + 1) !== s + '-') continue;
      return join(avatarDir(), name);
    }
    return null;
  }

  /**
   * 自动首帧缓存目录（网页壁纸）：live 渲染就绪后由客户端用 `__wp.capture()` 抽一帧
   * POST 上来，之后每次加载/重启都先显示它 —— 加载期不再黑屏、也不再停在作者预览图。
   * 与用户手动导入的「自定义画面」（overrides/）分开存放，互不覆盖。
   */
  function liveFrameDir() { return ensureDirOnce(join(pluginDataDir(), 'live-frames')); }

  return {
    defaultUploadDir, resolveUploadDir,
    UPLOAD_EXT, CUSTOM_FRAME_EXT, CUSTOM_FRAME_MAX_BYTES, customFrameDir,
    AVATAR_EXT, AVATAR_MAX_BYTES, AVATAR_SIDES, AVATAR_FILE_RE, avatarDir, avatarPath,
    MASCOT_EXT, MASCOT_MAX_BYTES, MASCOT_FILE_RE, mascotDir, mascotPath, liveFrameDir,
    WE_ASSETS_SOURCE_ID, resolveWeAssetsDir, weAssetsAvailable, getWeAssetsDir, setWeAssetsDir,
    listWeAssetNames,
  };
}
