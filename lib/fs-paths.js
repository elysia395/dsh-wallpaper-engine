/**
 * fs-paths.js —— 用户目录归一 + 跨卷安全移动（两个**叶子级**工具）。
 *
 * 为什么单独成模块（而不是留在门面或 upload-store 里）：
 *   · 它们是**纯函数 + node 内置**，没有门面状态依赖，任何一层都可以直接用；
 *   · 上游把它们留在 `lib/index.js` 的**模块私有**位置（只被门面内的上传目录迁移用），
 *     而本分支的内核层（`lib/kernel/host-kernel.js`）与路由族也要用同一份语义 ——
 *     若从门面 import 就会形成 `内核 → 门面` 的环（本仓明令禁止）。
 *   · 因此这里保留**与上游逐字相同的实现**，作为唯一真源；门面与内核都从这里取。
 *
 * `moveFileP` 的跨卷回落不是可选优化：Windows 上把上传目录从 C: 挪到 D: 时
 * `rename` 必然 EXDEV —— 这就是用户实际会踩的那条路径。
 */
import { homedir } from 'node:os';
import { join, normalize } from 'node:path';
import { copyFile, rename, unlink } from 'node:fs/promises';

// ⚠️ **不要**对 `node:fs/promises` 的函数再 `promisify`：那是回调式 API 的包装器，它会调
// `rename(src, dst, cb)`，而 promises 版**忽略第三个参数**、返回自己的 promise ⇒ 回调永不触发
// ⇒ 包装出的 promise **永不 settle** ⇒ 迁移整条链挂死（实测：改缓存/上传目录时插件不回包）。
// 这正是本轮 `verify-cache-dir` 抓到的用户可见 bug；这里直接用 promises 版即可。
const renameP = rename;
const copyFileP = copyFile;
const unlinkP = unlink;

/**
 * 路径的扩展名（小写、不含点）。门面与内核共用同一份 —— 上游把它做成扫描族工厂的闭包导出
 * （`createWallpaperScanKit` 的返回键），本分支抽到叶子模块，避免 `内核 → 门面` 的环。
 * @param {string} p
 * @returns {string}
 */
export function extOf(p) {
  const s = String(p || '');
  const dot = s.lastIndexOf('.');
  const sepAt = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return dot > sepAt + 1 ? s.slice(dot + 1).toLowerCase() : '';
}

/**
 * 校验并归一用户给出的上传目录字符串：接受绝对路径（Windows 盘符 / UNC / POSIX）、
 * 可用 `~` 表示主目录；剥掉首尾引号；非法返回 `null`。
 * @param {unknown} raw
 * @returns {string|null}
 */
export function normalizeUserDir(raw) {
  if (typeof raw !== 'string') return null;
  let dir = raw.trim().replace(/^["']|["']$/g, '');
  if (!dir) return null;
  if (dir === '~' || dir.startsWith('~\\') || dir.startsWith('~/')) {
    dir = join(homedir(), dir.slice(1));
  }
  if (/[\u0000-\u001f]/.test(dir)) return null;   // 控制字符 / NUL
  const isAbsolute = /^[a-zA-Z]:[\\/]/.test(dir) || /^\\\\/.test(dir) || /^\//.test(dir);
  if (!isAbsolute) return null;
  return normalize(dir);
}

/**
 * 移动文件；跨卷时回落到「复制 + 删除」（Windows 上 C: → D: 就是用户实际会踩的那条）。
 * @param {string} src
 * @param {string} dst
 * @returns {Promise<boolean>} 成功 true / 失败 false（不抛）
 */
export async function moveFileP(src, dst) {
  try { await renameP(src, dst); return true; } catch { /* 跨卷 */ }
  try {
    await copyFileP(src, dst);
    await unlinkP(src);
    return true;
  } catch { return false; }
}
