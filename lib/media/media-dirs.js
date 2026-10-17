/**
 * lib/media/media-dirs.js —— 立绘 / 头像 / 自定义画面目录与路径（P0.2-C 纯搬移）
 *
 * 从 `lib/index.js` 整段搬出：UPLOAD_EXT / CUSTOM_FRAME_* / customFrameDir、
 * AVATAR_* / avatarDir、MASCOT_* / mascotDir / mascotPath、avatarPath、liveFrameDir、
 * liveFrameFile、customIdFromAbs / customFramePath / listCustomFrameIds。
 * **逐字保真**：只做 +2 缩进与工厂包裹。
 *
 * `pluginDataDir` 与 `ensureDirOnce` 由门面注入（后者来自 transcode 套件；`ensureDirOnce`
 * 是共享 memo，门面多族共用同一实例）。
 */

import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function createMediaDirsKit(deps) {
  const { pluginDataDir, ensureDirOnce } = deps;

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
    /** @type {string[]} */
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
    /** @type {string[]} */
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

  /** 缓存文件路径（按入口文件 id）；不做有效性判断，mtime 校验在读取处做。 */
  function liveFrameFile(abs) { return join(liveFrameDir(), customIdFromAbs(abs) + '.jpg'); }

  function customIdFromAbs(abs) {
    const m = /431960[\\/]([^\\/]+)[\\/]/.exec(String(abs));
    if (m) return m[1];
    return Buffer.from(String(abs), 'utf8').toString('base64url').slice(0, 48);
  }
  function customFramePath(id) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(id))) return null;
    for (const ext of ['png', 'jpg', 'webp']) {
      const p = join(customFrameDir(), String(id) + '.' + ext);
      if (existsSync(p)) return p;
    }
    return null;
  }
  function listCustomFrameIds() {
    const ids = new Set();
    try {
      for (const f of readdirSync(customFrameDir())) {
        const m = /^([A-Za-z0-9_-]{1,64})\.(png|jpg|webp)$/.exec(f);
        if (m) ids.add(m[1]);
      }
    } catch { /* empty dir */ }
    return ids;
  }

  return {
    UPLOAD_EXT,
    CUSTOM_FRAME_EXT,
    CUSTOM_FRAME_MAX_BYTES,
    customFrameDir,
    AVATAR_EXT,
    AVATAR_MAX_BYTES,
    AVATAR_SIDES,
    AVATAR_FILE_RE,
    avatarDir,
    MASCOT_EXT,
    MASCOT_MAX_BYTES,
    MASCOT_FILE_RE,
    mascotDir,
    mascotPath,
    avatarPath,
    liveFrameDir,
    liveFrameFile,
    customIdFromAbs,
    customFramePath,
    listCustomFrameIds,
  };
}
