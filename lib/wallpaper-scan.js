/**
 * 壁纸扫描族（从 lib/index.js 抽出）：扫描根推导、扫描签名、`project.json` → 条目、
 * WE 播放列表读取。
 *
 * 为什么单独成模块：这一族是「目录树 → 清单条目」的**唯一推导链** —— 与 HTTP 面、
 * 转码、缓存都无关。它的三个磁盘探测（存在性 / 目录 / 文件）与 Steam 安装探测族共用
 * 同一份实现，所以注入进来而不是各抄一份路径语义：注入点少了，**"扫描根少算一个"**
 * 这类症状（签名一直"没变" ⇒ 那一根里新增的壁纸永远不进库，见 `scanRootsP` 的注释）
 * 就只剩一个地方可以出错。
 *
 * 调用方：
 *   · `lib/kernel/host-kernel.js` 在**模块加载期**建一次 kit（宿主半的 scan 名字全部来自它）；
 *   · `lib/kernel/host-session.js` 把 scan 系列（`scanSignatureP` / `enumerateWallpapersAsync` /
 *     `pathKey` / `extOf` / `readPlaylistsP` / `playlistItemId`）注入 `lib/inventory.js`；
 *   · uploads 枚举（`lib/upload-dir.js`）复用 `readProjectP` / `resolveSceneMainFileP` /
 *     `SCAN_CHUNK`（同一套「project.json 声明了 scene.json 却只发 scene.pkg」的探针）。
 *
 * 注入依赖：`WE_APPID`（workshop 路径要靠它定位 content 目录）、
 * `pathExistsP` / `isFileP` / `isDirectoryP`（由 Steam 探测族/内核提供 ⇒ 本模块不感知安装布局）、
 * `extOf` / `schemeToCss`。
 *
 * ⚠️ `extOf` / `schemeToCss` 在本分支是**注入项**（与上游不同）：上游把这两个 helper 定义在扫描族
 * 内部（各自被本族返回/使用），而本分支这两个各有单一真源 —— `extOf` 住叶子 `lib/fs-paths.js`
 * （`内核 → 门面` 环的规避点，`lib/index.js` 还把它再导出为对外面），`schemeToCss` 住
 * `lib/kernel/host-kernel.js`。在扫描族里再抄一份就是两个真源（且扫描族的 `extOf` 没有任何
 * 族内调用点 ⇒ 会退化成"返回了没人用"的死导出）。**日后与上游比对时，这一处差异是有意的。**
 *
 * 不变量：① `scanRootsP` 是**唯一**的根推导，签名与枚举都必须经它；
 *         ② 每个扫描根只 stat 一次并把结果掺进签名；
 *         ③ 所有磁盘访问都是异步且分块的（`SCAN_CHUNK`），不阻塞事件循环；
 *         ④ 签名对 `libraryDirs` 的**顺序敏感**：roots 按原序推、按原序掺进 sha1，因为库顺序
 *            决定枚举顺序与同名项目的取舍 ⇒ 顺序变了必须重扫（`scanSignatureP` 里不做排序）。
 */
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join, normalize, resolve } from 'node:path';

export function createWallpaperScanKit({
  WE_APPID, pathExistsP, isFileP, isDirectoryP, extOf, schemeToCss,
}) {
  function inferType(file) {
    if (/\.(mp4|webm|mkv|avi|mov)$/i.test(file)) return 'video';
    if (/\.(html?|js)$/i.test(file)) return 'web';
    return 'scene';
  }

  const KINDS = ['scene', 'video', 'web', 'application'];

  async function readProjectP(dir) {
    const pj = join(dir, 'project.json');
    if (!(await pathExistsP(pj))) return null;
    try {
      const o = JSON.parse(await readFile(pj, 'utf8'));
      if (!o || typeof o !== 'object' || !o.file) return null;
      let type = typeof o.type === 'string' ? o.type.toLowerCase() : inferType(o.file);
      if (!KINDS.includes(type)) type = 'scene';
      return {
        id: basename(dir),
        title: typeof o.title === 'string' ? o.title : basename(dir),
        type,
        file: o.file,
        preview: typeof o.preview === 'string' ? o.preview : null,
        // Content rating: Wallpaper Engine stores its own G / PG13 / R taxonomy
        // in project.json `contentrating` ("Everyone" / "PG13" / "Mature"). Pass
        // it through so the browser half can reproduce WE's rating filter
        // without re-reading the disk.
        contentrating: typeof o.contentrating === 'string' ? o.contentrating : null,
        // 主题色（WE 的 schemecolor）：网页壁纸在「尚无抽帧图」时用它做加载期占位底色。
        schemeColor: schemeToCss(o.general && o.general.properties
          && o.general.properties.schemecolor && o.general.properties.schemecolor.value),
      };
    } catch { return null; }
  }

  /**
   * Resolve a scene project's real main container. project.json's file field is
   * trusted when it exists on disk, but workshop items frequently declare
   * `scene.json` while shipping only the packed `scene.pkg` (and loose projects
   * ship the reverse) — probe the declared file, then scene.pkg, then
   * scene.json, then a single *.pkg in the directory. Returns the hit relative
   * to dir, or null when nothing matches.
   */
  async function resolveSceneMainFileP(dir, declared) {
    for (const candidate of [declared, 'scene.pkg', 'scene.json']) {
      if (!candidate) continue;
      if (await isFileP(resolve(dir, candidate))) return candidate;
    }
    let pkgs;
    try {
      pkgs = (await readdir(dir)).filter((name) => name.toLowerCase().endsWith('.pkg'));
    } catch {
      return null;
    }
    return pkgs.length === 1 ? pkgs[0] : null;
  }

  // Project-directory batch size for the async scan: bounds in-flight I/O and
  // peak memory while still parallelizing across the libuv thread pool.
  const SCAN_CHUNK = 24;

  /**
   * 清扫的**根目录**（#158）：`enumerateWallpapersAsync` 与扫描签名必须用**同一套推导** ——
   * 签名少算一个根，那一根里新增的壁纸就会永远不进库（签名一直"没变"）。
   */
  async function scanRootsP(installDir, libraryDirs) {
    const roots = [];
    if (installDir) {
      for (const sub of ['defaultprojects', 'myprojects']) {
        const p = join(installDir, 'projects', sub);
        if (await pathExistsP(p)) roots.push(p);
      }
    }
    for (const lib of libraryDirs) {
      const ws = join(lib, 'steamapps', 'workshop', 'content', WE_APPID);
      if (await pathExistsP(ws)) roots.push(ws);
    }
    return roots;
  }

  /**
   * 扫描签名（#158）：**库没动就不必重扫**。每个扫描根 stat 一次（mtimeMs + size），
   * 掺上版本与目录名，取 sha1 —— 十几次 stat，对手是冷扫那一万多次 fs 操作。
   *
   * 为什么 stat 根目录就够：新增 / 删除一个壁纸项目会改**根目录**的 mtime。改一个
   * **已存在**项目里的 `project.json` 不会（那是项目目录的 mtime）⇒ 那一类改动交给
   * 索引的定期复核窗口（`lib/inventory.js` 的 `INVENTORY_REVALIDATE_MS`）。
   *
   * 签名在扫描**之前**算、跟着扫描结果一起存：库若在扫描期间又变了，存下的签名偏旧，
   * 下一次请求就会发现不匹配并重扫 —— 保守的那一侧。
   */
  async function scanSignatureP(installDir, libraryDirs) {
    const h = createHash('sha1');
    h.update('we-scan-v1\0');
    h.update(String(installDir || ''));
    h.update('\0');
    // ⚠️ 这里**故意**不排序 `libraryDirs`。roots 是按原序推出来的（不变量 ①），而根顺序决定
    // `enumerateWallpapersAsync` 的产出顺序与「同名项目留先遇到者」的取舍 —— 库顺序一变结果就变，
    // 签名就必须变，否则 inventory 缓存会继续发旧顺序的清单。
    // （旧写法 `[...libraryDirs].sort()` 看似要顺序无关，但紧接着的 roots 循环用的是原序，
    //  那个排序对签名没有任何影响、只留下一个错误意图 —— 已删除，见文件头不变量 ④。）
    h.update([...libraryDirs].join('\0'));
    h.update('\0');
    for (const root of await scanRootsP(installDir, libraryDirs)) {
      let stamp = 'missing';
      try {
        const st = await stat(root);
        stamp = `${Math.round(st.mtimeMs)}:${st.size}`;
      } catch { /* 根目录读不到 ⇒ 记 missing：它一恢复就会改签名并触发重扫 */ }
      h.update(root + '\0' + stamp + '\0');
    }
    return h.digest('hex');
  }

  async function enumerateWallpapersAsync(installDir, libraryDirs) {
    const found = new Map();
    const roots = await scanRootsP(installDir, libraryDirs);
    // Collect candidate project dirs (async per root), then process them in
    // bounded chunks — the heavy per-project I/O (readdir/stat/readFile) runs on
    // the thread pool, so the event loop stays responsive throughout.
    const projectDirs = [];
    for (const root of roots) {
      let entries;
      try { entries = await readdir(root); } catch { continue; }
      for (const entry of entries) {
        const dir = join(root, entry);
        if (await isDirectoryP(dir)) projectDirs.push(dir);
      }
    }
    for (let i = 0; i < projectDirs.length; i += SCAN_CHUNK) {
      const chunk = projectDirs.slice(i, i + SCAN_CHUNK);
      const results = await Promise.all(chunk.map((dir) => readProjectP(dir).then((p) => p ? { dir, p } : null)));
      for (const hit of results) {
        if (!hit || found.has(hit.p.id)) continue;
        const { dir, p: proj } = hit;
        // Scenes: resolve the real container (scene.pkg vs scene.json) so the
        // scene-frame route reads a file that actually exists.
        proj.fileAbs = proj.type === 'scene'
          ? resolve(dir, (await resolveSceneMainFileP(dir, proj.file)) || proj.file)
          : resolve(dir, proj.file);
        proj.previewAbs = proj.preview ? resolve(dir, proj.preview) : null;
        // 项目目录本身：清单索引用它当**逐条目探测记忆的失效键**（目录内新增/删除/替换
        // 文件都会改它的 mtime，见 lib/inventory.js assembleInventory 的 revalidate 支）。
        proj.dirAbs = dir;
        found.set(proj.id, proj);
      }
    }
    return [...found.values()].sort((a, b) =>
      (a.title || '').localeCompare(b.title || ''));
  }

  function pathKey(file) {
    return normalize(String(file).replace(/\//g, '\\')).toLowerCase();
  }

  function playlistId(profileName, index, name) {
    return Buffer.from(`${profileName}\0${index}\0${name}`, 'utf8').toString('base64url');
  }

  function playlistRows(profile) {
    const general = profile && typeof profile === 'object' ? profile.general : null;
    if (!general || typeof general !== 'object') return [];
    if (Array.isArray(general.playlists) && general.playlists.length) return general.playlists;
    const selected = general.wallpaperconfig && general.wallpaperconfig.selectedwallpapers;
    if (!selected || typeof selected !== 'object') return [];
    return Object.values(selected)
      .map((monitor) => monitor && monitor.playlist)
      .filter((playlist) => playlist && typeof playlist === 'object');
  }

  async function readPlaylistsP(installDir) {
    if (!installDir) return [];
    const configPath = join(installDir, 'config.json');
    if (!(await pathExistsP(configPath))) return [];
    let config;
    try { config = JSON.parse(await readFile(configPath, 'utf8')); } catch { return []; }

    const result = [];
    const seen = new Set();
    for (const [profileName, profile] of Object.entries(config || {})) {
      for (const [index, row] of playlistRows(profile).entries()) {
        const items = Array.isArray(row.items)
          ? row.items.filter((item) => typeof item === 'string' && item.trim())
          : [];
        if (!items.length) continue;
        const name = typeof row.name === 'string' && row.name.trim()
          ? row.name.trim() : `Playlist ${index + 1}`;
        const signature = `${name}\0${items.join('\0')}`;
        if (seen.has(signature)) continue;
        seen.add(signature);
        const settings = row.settings && typeof row.settings === 'object' ? row.settings : {};
        result.push({
          id: playlistId(profileName, index, name),
          name,
          items,
          order: settings.order === 'random' ? 'random' : 'sequence',
          delay: typeof settings.delay === 'number' ? settings.delay : null,
        });
      }
    }
    return result;
  }

  function playlistItemId(item, byPath, byId) {
    const exact = byPath.get(pathKey(item));
    if (exact) return exact;
    const match = /[\\/]431960[\\/]([^\\/]+)(?:[\\/]|$)/i.exec(item);
    const project = match ? byId.get(match[1]) : null;
    if (project) return project.id;
    // Last resort: match the trailing project folder name. Covers install-relative
    // entries like `projects\defaultprojects\<name>\project.json` (and media
    // files inside such projects), which never contain the workshop appid.
    const folder = /[\\/]([^\\/]+)[\\/][^\\/]+$/i.exec(item);
    if (folder && byId.has(folder[1])) return folder[1];
    return null;
  }

  // 只导出宿主真正消费的名字：`inferType` / `KINDS` / `scanRootsP` / `playlistId` /
  // `playlistRows` 是这一族的内部步骤，留在闭包里（导出它们等于给"绕过 scanRootsP
  // 的根推导"开口子）。
  return {
    extOf,
    readProjectP,
    resolveSceneMainFileP,
    SCAN_CHUNK,
    scanSignatureP,
    enumerateWallpapersAsync,
    pathKey,
    readPlaylistsP,
    playlistItemId,
  };
}
