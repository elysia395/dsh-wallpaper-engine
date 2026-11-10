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
import { basename, isAbsolute, join, normalize, relative, resolve } from 'node:path';

export function createWallpaperScanKit({
  WE_APPID, pathExistsP, isFileP, isDirectoryP, extOf, schemeToCss,
}) {
  // WE 图片扩展名：`image` 类型（单图 / 幻灯片项目）的判定真源。
  const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;

  function inferType(file) {
    if (/\.(mp4|webm|mkv|avi|mov)$/i.test(file)) return 'video';
    if (/\.(html?|js)$/i.test(file)) return 'web';
    if (IMAGE_EXT_RE.test(file)) return 'image';
    return 'scene';
  }

  const KINDS = ['scene', 'video', 'web', 'image', 'application'];

  // WE 幻灯片项目的 `preset.imageswitchtimes` 是 1–5 档，不是秒数。档位 → 毫秒。
  const SLIDE_SWITCH_MS = { 1: 60000, 2: 300000, 3: 600000, 4: 1800000, 5: 3600000 };
  // 幻灯片目录的递归上限：条数（防 project.json 指到 Steam 库根 / 我的下载）与深度。
  const SLIDE_MAX = 2000;
  const SLIDE_MAX_DEPTH = 3;

  /**
   * 递归列出 `dir` 下的图片，返回相对 `dir` 的 POSIX 风格路径，按**自然序**排序。
   *
   * 顺序是这条链路（清单 → 路由回包 → 客户端过场）的唯一真源：WE 自己的幻灯片就是自然序
   * （`1.jpg < 2.jpg < 10.jpg`），纯字典序会把 `10` 排到 `2` 前面。隐藏文件跳过
   * （macOS 的 `._` 副本不是壁纸）；深度与条数都有上限（见 SLIDE_MAX 的注释）。
   */
  async function listImages(dir) {
    const out = [];
    async function walk(current, prefix, depth) {
      let entries;
      try { entries = await readdir(current, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (out.length >= SLIDE_MAX) return;
        const name = entry.name;
        if (name.startsWith('.')) continue;
        const rel = prefix ? `${prefix}/${name}` : name;
        if (entry.isDirectory()) {
          if (depth >= SLIDE_MAX_DEPTH) continue;
          await walk(join(current, name), rel, depth + 1);
        } else if (IMAGE_EXT_RE.test(name)) {
          out.push(rel);
        }
      }
    }
    await walk(dir, '', 0);
    out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return out;
  }

  /**
   * WE 图片项目：`project.json` 的 `file` 指向 preset 时，真身在 `preset` 里。
   * `wallpapermode` 1 = 单图 / 2 = 幻灯片；`customdirectory` 是项目内的图片目录（相对路径），
   * `image` 是单图路径，`imageswitchtimes` 是切换档位。
   *
   * 返回 `{ file, slides, slideIntervalMs }`（相对路径，`file` = 首图）；一张图都拿不到 ⇒ null。
   * 目录包含校验**不在这里**：这里只按 project.json 的声明读盘，越界由 enumerateWallpapersAsync
   * 统一收紧（issue #252 的口径）。
   */
  async function readPictureProjectP(dir, o) {
    const preset = o && o.preset && typeof o.preset === 'object' ? o.preset : null;
    if (!preset) return null;
    const mode = Number(preset.wallpapermode);
    const custom = typeof preset.customdirectory === 'string' ? preset.customdirectory.trim() : '';
    const single = typeof preset.image === 'string' ? preset.image.trim() : '';
    const slides = [];
    if (custom && (mode === 1 || mode === 2)) {
      const prefix = custom.replace(/\\/g, '/').replace(/\/+$/, '');
      for (const name of await listImages(resolve(dir, custom))) {
        slides.push(prefix ? `${prefix}/${name}` : name);
      }
    } else if (single && IMAGE_EXT_RE.test(single) && await isFileP(resolve(dir, single))) {
      slides.push(single);
    }
    if (!slides.length) return null;
    const switchTimes = preset.imageswitchtimes;
    const interval = typeof switchTimes === 'number' ? switchTimes : Number(switchTimes);
    return {
      file: slides[0],
      slides,
      slideIntervalMs: SLIDE_SWITCH_MS[interval] || null,
    };
  }

  async function readProjectP(dir) {
    const pj = join(dir, 'project.json');
    if (!(await pathExistsP(pj))) return null;
    try {
      const o = JSON.parse(await readFile(pj, 'utf8'));
      if (!o || typeof o !== 'object') return null;
      const declared = typeof o.type === 'string' ? o.type.toLowerCase() : '';
      // `file` 可以是媒体文件，也可以是 preset 类型的图片路径；空串等同"没有 file"。
      let file = typeof o.file === 'string' && o.file !== '' ? o.file : null;
      let type;
      let slides = [];
      let slideIntervalMs = null;
      if (file) {
        type = declared ? (KINDS.includes(declared) ? declared : 'scene') : inferType(file);
        if (type === 'image') slides = [file];
      } else {
        // 单图 / 幻灯片项目：真身在 preset 里（`file` 常缺省）⇒ 看 preset；
        // 没有 preset 的老项目仍按"缺主文件"丢弃。
        const picture = await readPictureProjectP(dir, o);
        if (!picture) return null;
        file = picture.file;
        slides = picture.slides;
        slideIntervalMs = picture.slideIntervalMs;
        type = 'image';
      }
      return {
        id: basename(dir),
        title: typeof o.title === 'string' ? o.title : basename(dir),
        type,
        file,
        // 图片项目没有 preview 时用首图当预览（缩略图路由会再降采样）。
        preview: (typeof o.preview === 'string' ? o.preview : null) || (type === 'image' ? file : null),
        slides,
        slideIntervalMs,
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
   * WE 的「从库中移除」标记（issue #260）：用户在 WE 里把内置默认壁纸移出库时，WE 只把
   * `<扫描根>/visibility.json` 里对应键写成 `false`，项目目录本身仍在盘上。旧实现只按
   * project.json 枚举 ⇒ 已移除的壁纸继续出现在选择器里。这里读该文件得到**隐藏名集合**
   * （键通常是项目目录名；也容忍嵌套一层的对象 / 带路径分隔符的键）；文件缺失或坏 JSON
   * 一律「不过滤」（宁可多列，不能凭空少列）。
   */
  async function hiddenEntryNamesP(root) {
    let text;
    try { text = await readFile(join(root, 'visibility.json'), 'utf8'); } catch { return new Set(); }
    let obj;
    try { obj = JSON.parse(text); } catch { return new Set(); }
    const out = new Set();
    const walk = (node) => {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return;
      for (const [key, value] of Object.entries(node)) {
        if (value === false) {
          out.add(String(key));
          out.add(String(key).replace(/\\/g, '/'));
          out.add(String(key).split(/[\\/]/).pop());
        } else if (value && typeof value === 'object') walk(value);
      }
    };
    walk(obj);
    return out;
  }

  /**
   * 扫描签名（#158）：**库没动就不必重扫**。每个扫描根 stat 一次（mtimeMs + size），
   * 掺上版本与目录名，取 sha1 —— 十几次 stat，对手是冷扫那一万多次 fs 操作。
   *
   * 为什么 stat 根目录就够：新增 / 删除一个壁纸项目会改**根目录**的 mtime。改一个
   * **已存在**项目里的 `project.json` 不会（那是项目目录的 mtime）⇒ 那一类改动交给
   * 索引的定期复核窗口（`lib/inventory.js` 的 `INVENTORY_REVALIDATE_MS`）。
   * ⚠️ `visibility.json` 的 mtime/size 必须单独掺进来（#260）：在 WE 里「移出库」只改它、
   * 不改根目录 ⇒ 不掺就等于"移除了还一直列着"，直到下次根目录变化。
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
      let visStamp = 'missing';
      try {
        const st = await stat(join(root, 'visibility.json'));
        visStamp = `${Math.round(st.mtimeMs)}:${st.size}`;
      } catch { /* 没有 visibility.json 是常态 */ }
      h.update(root + '\0' + stamp + '\0' + visStamp + '\0');
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
      // issue #260：WE 的「移出库」写在 visibility.json 里，项目目录仍在盘上。
      const hidden = await hiddenEntryNamesP(root);
      for (const entry of entries) {
        if (hidden.has(entry) || hidden.has(entry.replace(/\\/g, '/'))) continue;
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
        // issue #252（[security] 第三方 project.json 的 file/preview 是**外部可控输入**）：
        // WE 的语义是「项目目录内的相对路径」，但创意工坊的 project.json 由上传者随便写
        // （`"preview": "/etc/passwd"` / `"file": "../../../.ssh/id_ed25519"`）。此前这里
        // 直接 `resolve(dir, x)` 就把越界路径登记进 mediaMap ⇒ `/preview`、`/media`、
        // `/scene-files` 会原样交出用户可读的任意文件。现在先做**目录包含校验**：
        //   · 越界的 `file` ⇒ 整条壁纸丢弃（不登记，也不进清单/令牌表）；
        //   · 越界的 `preview` ⇒ 只是没有预览图，保留壁纸本身。
        // scene 的候选探测也先按声明值收紧：声明越界时不再拿它探存在性，直接走兜底候选
        // （scene.pkg / scene.json / 目录里唯一 .pkg），避免"越界文件恰好存在"被当成主文件。
        const containedInDir = (abs) => {
          const rel = relative(dir, abs);
          return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
        };
        const declaredSafe = typeof proj.file === 'string' && containedInDir(resolve(dir, proj.file));
        // Scenes: resolve the real container (scene.pkg vs scene.json) so the
        // scene-frame route reads a file that actually exists.
        const fileRel = proj.type === 'scene'
          ? (await resolveSceneMainFileP(dir, declaredSafe ? proj.file : null))
          : (declaredSafe ? proj.file : null);
        if (!fileRel) continue;
        proj.fileAbs = resolve(dir, fileRel);
        if (!containedInDir(proj.fileAbs)) continue;
        // 幻灯片清单同样要过目录包含校验：`preset.customdirectory` 也是 project.json 的
        // 外部可控字段（`../..\..\我的图片` 一类写法会让 `/slides` 把项目目录之外的图
        // 注册成媒体 token）。越界项逐条丢弃；首图已在上一步校验过。
        if (Array.isArray(proj.slides) && proj.slides.length) {
          proj.slides = proj.slides
            .filter((name) => typeof name === 'string' && containedInDir(resolve(dir, name)));
        }
        const previewAbs = typeof proj.preview === 'string' ? resolve(dir, proj.preview) : null;
        proj.previewAbs = previewAbs && containedInDir(previewAbs) ? previewAbs : null;
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

  /**
   * `<installDir>/config.json` 的解析结果。清单组装时播放列表与文件夹**各要一次**，
   * 于是按「路径 + mtime + size」记忆一份解析值：WE 改配置永远是整份重写，size/mtime
   * 必变；解析失败不记忆（下次仍会重试）。省掉的是每请求一次的重复读盘 + JSON.parse。
   */
  let weConfigCache = null; // { path, stamp, value }
  async function readWeConfigP(installDir) {
    if (!installDir) return null;
    const configPath = join(installDir, 'config.json');
    let stamp;
    try {
      const st = await stat(configPath);
      stamp = `${Math.round(st.mtimeMs)}:${st.size}`;
    } catch { return null; }
    if (weConfigCache && weConfigCache.path === configPath && weConfigCache.stamp === stamp) {
      return weConfigCache.value;
    }
    let value;
    try { value = JSON.parse(await readFile(configPath, 'utf8')); } catch { return null; }
    // 缓存写入：`require-atomic-updates` 认为这里可能基于过期的 weConfigCache 覆盖（上面在
    // await 之前读过它）。并发首读最多各解析一次、各自写入同一 stamp 的等价结果，后写者覆盖
    // 同值内容，不产生正确性问题；这里显式豁免（与 test/verify-client.mjs 的同类先例一致）。
    // eslint-disable-next-line require-atomic-updates -- 单飞缓存：并发写同值，无 stale 覆盖语义
    weConfigCache = { path: configPath, stamp, value };
    return value;
  }

  async function readPlaylistsP(installDir) {
    const config = await readWeConfigP(installDir);
    if (!config) return [];

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

  // ── WE 的「已安装」文件夹（config.json 的 general.browser.folders）──────────
  // WE 的「已安装」页允许把壁纸拖进文件夹（可嵌套）。这份分类**不是**壁纸文件的一部分，
  // 而是 WE 自己的 UI 状态，和播放列表住在同一个 `<installDir>/config.json` 里，按 Steam
  // 用户名分 profile：
  //   general.browser.folders = [{ type: "folder", title, items: { <workshop id>: 1 }, subfolders: [...] }]
  // ⚠️ 位置是 `browser.folders`（实测 WE 2.x：整块「已安装」浏览态都在 `browser` 下），
  // 旧/新布局的 `general.folders` 也一并认 —— 认错位置不会抛，只会静默读到空数组。
  // `items` 的键与壁纸 id 同口径（workshop 目录名，实测 11 个键与目录一一对应）；本地项目
  // 若按路径记录，交给 `folderMemberId`（先按 id 直查，再走播放列表那条路径解析）。
  // 只读：本族**绝不写回** config.json —— 那是 WE 的文件，写坏等于用户的分类丢失。
  function folderIdOf(profileName, trail) {
    return Buffer.from(`${profileName}\0${trail.join('\0')}`, 'utf8').toString('base64url');
  }
  /** 文件夹内容的签名：跨 Steam profile 去重用（同一个夹子各 profile 一份时只出去一份）。
   *  成员键**排过序**再入签名：WE 重写 config 时对象键顺序可能变，不排序会把同一个夹子
   *  当成两个（下拉里出现两条同名项）。 */
  function folderSignature(node) {
    return JSON.stringify([node.name, [...(node.items || [])].sort(), node.subfolders.map(folderSignature)]);
  }
  function folderNodes(profileName, rows, trail) {
    const out = [];
    if (!Array.isArray(rows)) return out;
    for (const row of rows) {
      if (!row || typeof row !== 'object' || row.type !== 'folder') continue;
      const name = typeof row.title === 'string' ? row.title.trim() : '';
      if (!name) continue;
      const items = row.items && typeof row.items === 'object' && !Array.isArray(row.items)
        ? Object.keys(row.items)
        : [];
      const nextTrail = trail.concat(name);
      const subfolders = folderNodes(profileName, row.subfolders, nextTrail);
      // 空文件夹（既没有成员也没有非空子夹）不出去：界面上只会变成一个永远筛出 0 张的死选项。
      if (!items.length && !subfolders.length) continue;
      out.push({ id: folderIdOf(profileName, nextTrail), name, items, subfolders });
    }
    return out;
  }
  /**
   * 一份 profile 里的文件夹行。**实测位置是 `general.browser.folders`**（WE 2.x 把整块
   * 「已安装」浏览态 —— 过滤档、每页张数、文件夹 —— 都放在 `browser` 下），
   * 兼容旧/新布局的 `general.folders` 一起读。位置判错不会抛，只会静默读到空数组，
   * 所以这里两种都认，并由守卫钉住两种形态。
   */
  function profileFolders(profile) {
    const general = profile && typeof profile === 'object' ? profile.general : null;
    if (!general || typeof general !== 'object') return null;
    const browser = general.browser && typeof general.browser === 'object' ? general.browser : null;
    if (browser && Array.isArray(browser.folders)) return browser.folders;
    return Array.isArray(general.folders) ? general.folders : null;
  }
  async function readFoldersP(installDir) {
    const config = await readWeConfigP(installDir);
    if (!config) return [];
    const out = [];
    const seen = new Set();
    for (const [profileName, profile] of Object.entries(config || {})) {
      const rows = profileFolders(profile);
      if (!Array.isArray(rows) || !rows.length) continue;
      for (const node of folderNodes(profileName, rows, [])) {
        const signature = folderSignature(node);
        if (seen.has(signature)) continue;
        seen.add(signature);
        out.push(node);
      }
    }
    return out;
  }

  /**
   * 文件夹成员 → 壁纸 id。成员键**两种形态都真实存在**：
   *   · 工坊壁纸 = 裸 workshop id（实测 `"1186645315": 1`，与本插件清单 id 同字面量）；
   *   · 本地项目（projects/ 下的目录）= 绝对路径（与播放列表同形状）。
   * 所以先按 id 直查，再交给 `playlistItemId` 的路径解析 —— 两条路**共用**这一处，
   * 别让文件夹与播放列表对同一张壁纸给出不同答案。
   */
  function folderMemberId(item, byPath, byId) {
    if (typeof item !== 'string' || !item) return null;
    // ⚠️ `byId` 的值是**壁纸条目对象**（见 `playlistItemId` 里 `project.id` 的取法），
    // 不是 id 字符串 —— 直接把它当 id 返回会让文件夹成员变成对象（实测：客户端比对
    // `w.id === 对象` 恒假 ⇒ 选了文件夹就是空网格）。这里统一返回字符串 id。
    const project = byId.get(item);
    if (project) return typeof project === 'string' ? project : project.id;
    const viaPlaylist = playlistItemId(item, byPath, byId);
    if (viaPlaylist) return viaPlaylist;
    // 本地项目在 WE 的分类里可能是**相对安装根**的目录（`projects\myprojects\<名>`，
    // 没有主文件那一段），`playlistItemId` 的三级匹配到不了 ⇒ 再按最后一段试一次
    // （项目目录名 = 清单 id）。只在本族做，不动播放列表的既有匹配口径。
    const tail = /[\\/]([^\\/]+)[\\/]?$/.exec(item);
    const hit = tail ? byId.get(tail[1]) : null;
    return hit ? (typeof hit === 'string' ? hit : hit.id) : null;
  }

  /**
   * 把 `readFoldersP` 的树映射成清单里的文件夹树：成员 → 壁纸 id，带上
   * `total` / `unresolvedCount`（与 `PlaylistDescriptor` 同口径），映射后为空的夹子丢掉。
   *
   * 纯函数：两个映射表由调用点给（清单族在 assembleInventory 里现建 `byPath`/`byId`），
   * 所以能脱离宿主直接单测（守卫 `test/verify-we-folders.mjs` 就是这样钉的）。
   */
  function foldersWithIds(nodes, byPath, byId) {
    const out = [];
    for (const node of nodes || []) {
      const ids = [];
      const seen = new Set();
      for (const item of node.items || []) {
        const id = folderMemberId(item, byPath, byId);
        if (id && !seen.has(id)) { seen.add(id); ids.push(id); }
      }
      const subfolders = foldersWithIds(node.subfolders, byPath, byId);
      if (!ids.length && !subfolders.length) continue;
      // 「选中父夹要连子夹一起看」—— WE 的树本身就是"父夹包含子夹"。只给直接成员的话，
      // 一个只装子夹的父夹选中后是空网格（实测口径），所以这里额外给一份**含后代**的并集。
      // `wallpaperIds` 仍保持"直接成员"（结构真源），并集单独一个字段，不混语义。
      const deepWallpaperIds = [];
      const deepSeen = new Set();
      const pushDeep = (list) => {
        for (const id of list || []) {
          if (deepSeen.has(id)) continue;
          deepSeen.add(id); deepWallpaperIds.push(id);
        }
      };
      pushDeep(ids);
      for (const sub of subfolders) pushDeep(sub.deepWallpaperIds);
      out.push({
        id: node.id,
        name: node.name,
        wallpaperIds: ids,
        total: ids.length,
        unresolvedCount: Math.max(0, (node.items || []).length - ids.length),
        deepWallpaperIds,
        deepUnresolvedCount: Math.max(0, (node.items || []).length - ids.length)
          + subfolders.reduce((n, sub) => n + sub.deepUnresolvedCount, 0),
        subfolders,
      });
    }
    return out;
  }

  // 只导出宿主真正消费的名字：`inferType` / `KINDS` / `scanRootsP` / `playlistId` /
  // `playlistRows` / `folderIdOf` / `folderSignature` / `folderNodes` / `folderMemberId`
  // 是这一族的内部步骤，留在闭包里（导出它们等于给"绕过 scanRootsP 的根推导"开口子）。
  // `listImages` 是 `/slides` 路由的数据源（宿主经内核键面转给媒体桥），顺序口径因此只有这一份。
  return {
    extOf,
    readProjectP,
    resolveSceneMainFileP,
    listImages,
    SCAN_CHUNK,
    scanSignatureP,
    enumerateWallpapersAsync,
    pathKey,
    readPlaylistsP,
    playlistItemId,
    readFoldersP,
    foldersWithIds,
  };
}
