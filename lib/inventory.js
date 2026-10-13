/**
 * inventory.js — **清单构建族**：`/inventory` 的载荷构造（`buildInventory`）与它的两个
 * 单条目字段函数（`sceneFieldsFor` / `webFieldsFor`）。
 *
 * 为什么这一族独立成文件：它是 `apply(ctx)` 里**最大的一块**（约 230 行），而且是
 * `apply()` 里**唯一**一个"读盘 → 组装 JSON"的纯产出过程 —— 不注册路由、不持有跨请求
 * 资源，只在工厂闭包里留缓存。把它摊在门面里，会让"注册与协议聚合"这件事被 200 多行
 * 扫描逻辑淹没（见 docs/CODE-STRUCTURE.md §5 的硬约束）。
 *
 * 契约：`createInventoryBuilder(c)` → 返回 `buildInventory`（同一个引用交给 `/inventory`
 * 路由）。这不是"路由族"而是**工厂**：本族要保留一份跨请求状态（缓存），工厂形式
 * 让这份状态的生命周期与 `apply()` 的一次调用严格一致 —— 若把它做成模块级单例，两次
 * apply 会共用缓存，那是行为改动。
 *
 * `c` 里是这一族**用到但不属于它**的东西（全是 `lib/index.js` 的模块级纯函数/常量，
 * 外加两个可变状态的**访问器**）：
 *   · `BASE`                        ← 路由前缀（拼 `media`/`preview`/`scene-frame` … 的 URL）
 *   · `tokenFor`                    ← 绝对路径 → token（**写** `mediaMap`，故由门面持有）
 *   · `mediaOriginApi`              ← 壁纸媒体源（`mediaOriginBase` / `ensureSceneMediaOrigin`）
 *   · `warmFaststart`               ← 视频 faststart 变体预热（门面里的 `warmFaststartFavorites`）
 *   · `log`                         ← 日志面
 *   · 扫描链：`locateWallpaperEngineP` / `owningLibrariesP` / `enumerateWallpapersAsync`
 *     / `scanSignatureP`（后者只 stat 各扫描根，见 lib/index.js）
 *   · 条目设施：`pathKey` / `listCustomFrameIds` / `pathExistsP` / `mtimeOrNullP` / `extOf`
 *   · 上传存储：`ensureUploadDir` / `readUploadMeta` / `enumerateUploadsP` / `metaEntry`
 *   · 播放列表：`readPlaylistsP` / `playlistItemId`
 *   · 场景探测：`sceneVideoProbeKey` / `sceneVideoProbeGet` / `scheduleSceneVideoProbe`
 *   · 自定义画面：`customIdFromAbs`
 *   · `weAssetsAvailable`           ← WE 素材目录可用性谓词
 *   · `getUploadDir` / `getWeAssetsDir` / `cacheBaseDir` ← ⚠️ **访问器不是值**：这三个目录
 *     都能被用户在运行时改（`/upload-dir`、`/we-assets-dir`、`/cache-dir`）⇒ 传值快照
 *     会让清单一直报旧目录。
 *
 * 不变量：
 *   · **三级缓存只为省掉重复全扫**（见下）：客户端每次切壁纸/刷新面板都会重拉清单，
 *     而全量扫描（locate + readdir + 逐项目读 project.json + 逐条目探测）在慢盘上
 *     要几百 ms 到几秒。语义不变 —— 浏览器半每次加载都会重取，新鲜度语义与"不缓存"一致。
 *   · **两个字段函数必须逐字共用**：Steam 扫描与自定义存储扫描都要同一套 scene/web
 *     字段（同一张场景从哪个来源来都必须表现一致）。
 *   · **`propsUrl` 只能在条目里给一次**：两个字段函数都返回过它，
 *     `webFieldsFor` 的 `null` 会把场景壁纸的值盖掉（实测 216 张场景一张都拿不到）。
 *   · **`sceneVideo` 诚实化**：只有探测缓存确认内嵌 MP4 才给 URL；未知则 `null` +
 *     投递后台探测，**绝不拿 `hasFrame` 冒充**（否则字段在说谎、客户端必然 404）。
 *   · **`scenePkgBytes` 只对单文件容器有意义**（松散目录没有"整包"，预算走基准）。
 *   · 清单里的 `sceneLiveSrc` / `sceneVideo` / `sceneAudio` / `media` / `preview` /
 *     `frameUrl` / `propsUrl` / `liveFrame` 的 URL 形态是**客户端契约**，
 *     被 `src/picker-model.js` 与 `src/live-layer.js` 消费 —— 改形态要同改它们。
 *
 * ── 三级缓存（#158：大库冷扫 1.9 s / 重启即失 / 改一张也要全扫）───────────────
 *   ① **内存 TTL**（`INVENTORY_TTL_MS`）：同一 `apply` 内连续请求不重复任何 I/O。
 *   ② **扫描索引**（`cacheBaseDir()` 下的 JSON）：缓存"`enumerateWallpapersAsync` 的原始
 *      产出 + 逐条目探测结果"。签名（`scanSignatureP`）没变 ⇒ **零 fs 探测**直接重组载荷。
 *   ③ **stale-while-revalidate 只服务"签名没变、内容可能变了"**（索引老过
 *      `INVENTORY_REVALIDATE_MS`）：本次照旧应答、后台重扫，扫完替换。
 *   ⚠️ **签名对不上时绝不回旧载荷**：那意味着**库本身**变了（换 Steam 根、增删项目目录），
 *      回旧载荷等于把上一个库的清单端给用户。实测踩过 —— `test/verify-we-install-probe.mjs`
 *      的四个夹具共用一个 `DSH_WE_CACHE_DIR`，B6/B8 立刻红（拿到的 installDir 是本 case 的、
 *      壁纸却是上一个 case 的）。所以签名对不上（以及冷启动）都**等这一次重扫**，
 *      并发请求共用同一次在途扫描（`rescanOnce`）。
 *
 *   ⚠️ **不许把载荷整个落盘再回放**：载荷里全是 `tokenFor()` 的产物，而 token 是绝对路径
 *   的 base64url、`mediaMap` 是**进程内**的 Map（`lib/index.js`）。直接回放旧载荷会让
 *   重启后的每一个 media/preview/scene URL 都 404。所以索引里存的是**扫描原料**，
 *   回放时照常走 `assembleInventory` 重组一遍 —— 重新铸造 token（顺带把 `mediaMap`
 *   重播回来），字段形状也仍然只有一处实现。
 */

import { statSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

export function createInventoryBuilder(c) {
  const {
    log, BASE, tokenFor, mediaOriginApi, warmFaststart,
    locateWallpaperEngineP, owningLibrariesP, enumerateWallpapersAsync, scanSignatureP,
    pathKey, listCustomFrameIds, pathExistsP, mtimeOrNullP, extOf,
    ensureUploadDir, readUploadMeta, enumerateUploadsP, metaEntry,
    readPlaylistsP, playlistItemId, weAssetsAvailable,
    sceneVideoProbeKey, sceneVideoProbeGet, scheduleSceneVideoProbe, customIdFromAbs,
    getUploadDir, getWeAssetsDir, cacheBaseDir,
  } = c;

  /**
   * Scene-shaped derived fields for ONE wallpaper entry: the WebWallGL
   * live-render capability (sceneLive / sceneLiveSrc), the embedded MP4 and
   * packaged-audio availability (sceneVideo / sceneAudio), and the 自定义画面
   * memory (hasCustomFrame).
   * Shared verbatim by the Steam scan and the custom-storage (uploads) scan —
   * a scene found in either place must behave identically, and every one of
   * these routes is driven by the entry's absolute main-file path, so no
   * extra plumbing is needed for the custom-storage case.
   */
  function sceneFieldsFor(w, hasFrame, customIds, sceneMtime) {
    const isScene = Boolean(w.type === 'scene' && hasFrame && w.fileAbs);
    // WebWallGL 2.1.0 起 httpSource 原生支持「松散目录」形态：站点根两种形态一致
    // （<mediaBase>/<token>/，token = 主文件绝对路径，根 = 其所在目录），渲染器先拉
    // project.json、按 file 后缀自动判形态（.json 结尾 → loose：拉入口 json 与同级
    // 素材；否则回退 scene.pkg 容器），auto 档 sceneDir 先试、scenePkg 兜底。所以 token
    // 一律发放、形态判定交给渲染器 —— 宿主不按扩展名关死松散目录的实时渲染。isPkg
    // 只剩一个用途：scenePkgBytes 只对单文件容器有意义（松散目录没有"整包"，预算走基准）。
    const isPkg = isScene && !w.fileAbs.toLowerCase().endsWith('.json');
    // sceneVideo 诚实化: 只有探测缓存确认该 pkg 真的内嵌 MP4 才给 URL;
    // 未知 (无缓存项) → null 并投递后台探测, 绝不猜 —— 拿 hasFrame 冒充
    // 「内嵌视频」客户端请求必然 404 (字段在说谎)。
    const svKey = isScene ? sceneVideoProbeKey(w.fileAbs, sceneMtime) : null;
    const svKnown = svKey === null ? undefined : sceneVideoProbeGet(svKey);
    if (svKey !== null && svKnown === undefined) scheduleSceneVideoProbe(w.fileAbs, svKey);
    // `scene.pkg` 的体积：客户端拿它把**首帧预算**按"这份载荷至少要传多久"放大
    //（见 `src/live-layer.js` 的 liveFirstFrameBudget）—— 首帧必须等整包到齐，
    // 而 100–336MB 的包在饿死的传输下远超固定 15s。取不到就 0（= 退回基准预算，
    // 绝不因为"量不出体积"把壁纸判失败）。
    let scenePkgBytes = 0;
    if (isPkg) {
      try { scenePkgBytes = statSync(w.fileAbs).size || 0; } catch { scenePkgBytes = 0; }
    }
    return {
      sceneLive: isScene,
      sceneLiveSrc: isScene ? tokenFor(w.fileAbs) : null,
      scenePkgBytes,
      sceneVideo: svKnown === true ? `${BASE}/scene-video/${tokenFor(w.fileAbs)}` : null,
      sceneAudio: isScene ? `${BASE}/scene-audio/${tokenFor(w.fileAbs)}` : null,
      hasCustomFrame: isScene ? customIds.has(customIdFromAbs(w.fileAbs)) : false,
    };
  }

  /**
   * Web-wallpaper live-render fields. `webLiveSrc` is the FULL entry URL
   * (mediaBase-relative path + file name), not a token: the renderer page's
   * web form expects `src` to be the complete entry URL (the WallpaperEM
   * protocol), and it derives project.json from it. Strict sandbox keeps the
   * third-party HTML on an opaque origin so it can never act with the DSH
   * origin's authority.
   */
  function webFieldsFor(w, entryOk, mediaBase) {
    const isWeb = Boolean(w.type === 'web' && entryOk && w.fileAbs);
    return {
      webLive: isWeb,
      // 绝对 URL（壁纸媒体源）——不透明源的沙箱 iframe 只有在这个源上才能把
      // 入口 HTML 与其子资源取回来；媒体源不可用时回落成应用源相对路径
      //（浏览器形态照旧，Desktop 上会 403）。
      webLiveSrc: isWeb
        ? `${mediaBase || ''}${BASE}/scene-files/${tokenFor(w.fileAbs)}/${basename(w.fileAbs)}`
        : null,
    };
  }

  // ── 三级缓存（见文件头）─────────────────────────────────────────────────────
  const INVENTORY_TTL_MS = 3000;
  /** 索引格式版本：**改索引/扫描原料的形状时必须 +1**（老索引会被当成没有）。 */
  const INDEX_VERSION = 2;
  const INDEX_FILE = 'inventory-index.json';
  /** 签名没变时的定期复核窗口：改一个**已存在**项目的 project.json 不改根目录 mtime，
   *  靠这个窗口在后台捞回来（载荷一直即时可回，代价是"多久后变新"）。 */
  const INVENTORY_REVALIDATE_MS = 30000;
  /** 逐条目探测的有界并发：与 `lib/index.js` 的 `SCAN_CHUNK` 同一纪律 —— 无上限的
   *  `Promise.all(entries)` 在慢盘上会堆出十几到几十 ms 的事件循环停顿。 */
  const PROBE_CHUNK = 24;

  let inventoryCache = null;   // { t, payload }
  let indexLoaded = false;     // 磁盘索引一个 apply 只读一次
  let indexState = null;       // { builtAt, sig, installDir, libraryDirs, we, probes }
  let rebuildInFlight = null;  // stale-while-revalidate 的在途重扫（并发请求共用）

  function indexPath() {
    try {
      const dir = cacheBaseDir();
      return dir ? join(dir, INDEX_FILE) : '';
    } catch { return ''; }
  }

  /** 读一次磁盘索引。**任何异常都只是"没有索引"**（照旧全扫），绝不冒泡。 */
  async function loadIndex() {
    if (indexLoaded) return indexState;
    indexLoaded = true;
    const file = indexPath();
    if (!file) return null;
    try {
      const raw = JSON.parse(await readFile(file, 'utf8'));
      if (!raw || raw.v !== INDEX_VERSION || typeof raw.sig !== 'string'
        || !Array.isArray(raw.we) || !raw.probes || typeof raw.probes !== 'object') return null;
      // 逐元素形状：索引是**磁盘上的持久状态**（可被手改、可被半截写入毁坏），而
      // `we: [null]` 这种内容以前会一路走到 `assembleInventory` 里的 `w.fileAbs` 并抛
      // TypeError —— 调用方 catch 成 500，且索引一旦锁存就不再重读 ⇒ **跨重启永久 500**，
      // 只能靠用户手删索引文件。形状不对就按这条函数的老规矩当"没有索引"，照旧全扫，
      // 重扫后 `saveIndex` 会重写一份干净的（自愈）。见 §11 A3-F3。
      if (!raw.we.every((w) => w && typeof w === 'object')) return null;
      indexState = {
        builtAt: Number(raw.builtAt) || 0,
        sig: raw.sig,
        installDir: typeof raw.installDir === 'string' ? raw.installDir : null,
        libraryDirs: Array.isArray(raw.libraryDirs) ? raw.libraryDirs : [],
        we: raw.we,
        probes: raw.probes,
      };
      return indexState;
    } catch { return null; }
  }

  /** 原子落盘（先写 `.tmp` 再 rename）：读到的索引永远是完整的旧版或新版。写不进去
   *  只是"下次照旧全扫"，不影响本次应答。 */
  async function saveIndex(entry) {
    indexState = entry;
    indexLoaded = true;
    const file = indexPath();
    if (!file) return;
    try {
      await mkdir(dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      await writeFile(tmp, JSON.stringify({
        v: INDEX_VERSION,
        builtAt: entry.builtAt,
        sig: entry.sig,
        installDir: entry.installDir,
        libraryDirs: entry.libraryDirs,
        we: entry.we,
        probes: entry.probes,
      }), 'utf8');
      await rename(tmp, file);
    } catch { /* 索引是优化，不是正确性的一部分 */ }
  }

  /**
   * 用扫描原料组装载荷。**这是清单字段的唯一产出点**（`sceneFieldsFor` / `webFieldsFor`
   * 经 spread 进入每条）：签名快路径与真扫描都必须走这里，字段形状才不会分叉成两份。
   *
   * `we` = `enumerateWallpapersAsync` 的原始产出；`probes` = 「主文件路径 → 探测记忆」
   * 的表（`pathKey(fileAbs)` → `{ m, v }`：`m` = 该条目**项目目录**的 mtime，`v` =
   * `[hasMedia, hasPreview, sceneMtime]`）。
   *
   * `revalidate` 决定要不要给记忆表做失效检查：
   *   · `false`（**签名快路径**）：库的扫描根一个字节都没动 ⇒ 全表直接复用，**一格 fs 都不发**。
   *   · `true`（**重扫**）：逐条 `stat` 一次项目目录，只有 `m` 变了（目录内新增/删除/替换了
   *     文件）的条目才重探 —— 这就是"改一张壁纸不必重探整个库"的那一半。
   */
  /**
   * 逐元素形状过滤。`we` 可能来自**磁盘索引**（可被手改 / 半截写入毁坏）或枚举结果，
   * 非对象元素（`null` / 字符串 / 数字）一律丢掉：`w.fileAbs` 那一类解引用会抛 TypeError，
   * 症状是整条 `/inventory` 500（见 §11 A3-F3）。**两个入口都要过**——`assembleInventory`
   * 是字段产出点，`rescan` 收尾还会用原始列表清探测记忆并落盘索引。
   */
  function liveEntries(list) {
    return (Array.isArray(list) ? list : []).filter((w) => w && typeof w === 'object');
  }

  async function assembleInventory(we, probes, installDir, libraryDirs, revalidate) {
    // 兜一道元素形状：`we` 可能来自磁盘索引（见 loadIndex 的逐元素校验）。这里再守一次是
    // 因为"清单字段的唯一产出点"不该依赖调用方守规矩 —— 半个坏条目就抛 TypeError 的话，
    // 症状是整条 /inventory 500（§11 A3-F3）。**今天两个入口（loadIndex 的逐元素校验、
    // rescan 的 liveEntries）都已经先过滤了，这一道是纯函数的自保**（不被调用方是否守规矩绑住）。
    const items = liveEntries(we);
    const byPath = new Map(items.map((w) => [pathKey(w.fileAbs), w.id]));
    const byId = new Map(items.map((w) => [w.id, w]));
    const customIds = listCustomFrameIds();
    const wallpapers = [];
    // 有界并发分块（见 PROBE_CHUNK 的注释）。分块只影响 I/O 并发度：`push(...rows)`
    // 保持顺序，与原 `Promise.all(we.map(...))` 的元素次序逐字一致。
    for (let i = 0; i < items.length; i += PROBE_CHUNK) {
      const rows = await Promise.all(items.slice(i, i + PROBE_CHUNK).map(async (w) => {
        const probeKey = w.fileAbs ? pathKey(w.fileAbs) : '';
        // 记忆表的失效键 = 项目目录 mtime（`mtimeOrNullP` 一次 stat）。**只在重扫路径上付**。
        const stamp = revalidate && w.dirAbs ? await mtimeOrNullP(w.dirAbs) : undefined;
        const known = probeKey ? probes[probeKey] : undefined;
        let reused = null;
        if (known && Array.isArray(known.v) && known.v.length === 3) {
          if (!revalidate) reused = known;
          else if (stamp !== undefined && known.m === stamp) reused = known;
        }
        // 三次存在性探测并发（串行在慢盘上是 3× 延迟）；命中记忆表则一次 fs 都不发。
        const [hasMedia, hasPreview, sceneMtime] = reused ? reused.v : await Promise.all([
          w.type === 'video' || w.type === 'web' ? pathExistsP(w.fileAbs) : Promise.resolve(false),
          w.previewAbs ? pathExistsP(w.previewAbs) : Promise.resolve(false),
          // Scenes: fileAbs points at the resolved scene main file (scene.pkg /
          // scene.json); frameUrl serves the live-captured frame or the
          // user-imported 自定义画面 (there is no extraction step any more).
          // 用 stat 取 mtime：一次异步探测同时给出 mtime ——
          // 兼作存在性（hasFrame）与 sceneVideo 探测缓存（路径+mtime）的键。
          w.type === 'scene' && w.fileAbs ? mtimeOrNullP(w.fileAbs) : Promise.resolve(null),
        ]);
        // require-atomic-updates（噪声，非竞态）：写入的是**按 key 整体替换**的记忆表条目（三元组），
        // 不是读-改-写累加器 ⇒ 不存在"丢一次更新"；不同 key 互不影响，同 key 只是最后完成者胜出。
        // 陈旧条目也不会被长期采信：读取侧只在 `known.m === stamp`（或本次不 revalidate）时复用。
        if (probeKey && !reused) {
          // eslint-disable-next-line require-atomic-updates -- 见上方注释：按 key 整体替换，无读-改-写累加器。
          probes[probeKey] = { m: stamp === undefined ? null : stamp, v: [hasMedia, hasPreview, sceneMtime] };
        }
        const hasFrame = sceneMtime !== null;
        // 只有真的存在网页条目时才按需起媒体源监听（懒启动，失败回落空串）。
        const webMediaBase = w.type === 'web' && hasMedia ? await mediaOriginApi.mediaOriginBase() : '';
        return {
          id: w.id,
          title: w.title,
          type: w.type,
          contentrating: w.contentrating,
          playable: hasMedia,
          media: hasMedia ? `${BASE}/media/${tokenFor(w.fileAbs)}` : null,
          // 真实容器后缀（小写、不含点）。**为什么必须由宿主给**：媒体 URL 是 token 形态
          //（`/media/<base64url>`），路径里没有扩展名 —— 客户端靠 URL 猜容器只会恒判"不可解"，
          // 于是"原生可解的源不整片重编码"这条治理永远不生效。客户端同样保留 URL 兜底，
          // 以便夹具/旧宿主没有这个字段时行为不变。
          mediaExt: w.fileAbs ? extOf(w.fileAbs) : null,
          preview: hasPreview ? `${BASE}/preview/${tokenFor(w.previewAbs)}` : null,
          frameUrl: hasFrame ? `${BASE}/scene-frame/${tokenFor(w.fileAbs)}` : null,
          // 加载期占位底色（主题色）：尚无抽帧图时的兜底，避免一上来就是黑屏。
          schemeColor: w.schemeColor || null,
          // Scene fields — WebWallGL live render,
          // embedded MP4, packaged audio, 自定义画面 (see sceneFieldsFor).
          ...sceneFieldsFor(w, hasFrame, customIds, sceneMtime),
          // Web wallpapers: WebWallGL live render (entry HTML + injected shim) +
          // the automatic first-frame cache (可能还没有 → GET 404 → 用主题色)。
          ...webFieldsFor(w, hasMedia, webMediaBase),
          // 「壁纸属性」面板入口：只有场景/网页壁纸的项目目录才有 project.json
          // 用户属性。**必须在这里统一给一次** —— 上面两个字段函数都返回过
          // propsUrl，webFieldsFor 的 null 会把场景壁纸的值盖掉（实测 216 张场景
          // 一张都拿不到，按钮因此不显示）。
          propsUrl: (w.type === 'scene' || w.type === 'web') && w.fileAbs
            ? `${BASE}/props/${tokenFor(w.fileAbs)}`
            : null,
          liveFrame: w.type === 'web' && hasMedia ? `${BASE}/live-frame/${tokenFor(w.fileAbs)}` : null,
        };
      }));
      wallpapers.push(...rows);
    }
    // ── 上传存储：每次请求都现扫（read-A storage，见 lib/index.js 的注释）──
    // 它**不进索引**：目录小、变化自由，而且"上传了什么"必须立刻可见。
    // Custom storage: scanned fresh each request (read-A storage), appended
    // AFTER the WE wallpapers. Two shapes come out of enumerateUploadsP —
    // `up-*` single-file uploads (images / MP4) and `up-dir-*` WE project
    // directories (scene.pkg / index.html / *.mp4 with a project.json), i.e.
    // a WallpaperEM-style downloads folder. Both get the same scene fields as
    // the Steam scan, so a scene from either source plays identically
    // (live WebWallGL / static frame / embedded video / packaged audio).
    const uploadsDir = ensureUploadDir();
    const uploadMeta = readUploadMeta();
    const uploads = await Promise.all((await enumerateUploadsP(uploadsDir)).map(async (w) => {
      const isDirProject = w.id.startsWith('up-dir-');
      const me = metaEntry(uploadMeta, w.id);
      const [hasMedia, hasPreview, sceneMtime] = await Promise.all([
        (w.type === 'video' || w.type === 'web') && w.fileAbs
          ? pathExistsP(w.fileAbs) : Promise.resolve(false),
        w.previewAbs ? pathExistsP(w.previewAbs) : Promise.resolve(false),
        // 同 Steam 扫描：mtime 兼作存在性与 sceneVideo 探测缓存键。
        w.type === 'scene' && w.fileAbs ? mtimeOrNullP(w.fileAbs) : Promise.resolve(null),
      ]);
      const hasFrame = sceneMtime !== null;
      const webMediaBase = w.type === 'web' && hasMedia ? await mediaOriginApi.mediaOriginBase() : '';
      return {
        id: w.id,
        // Project directories carry their own project.json title/rating;
        // single-file uploads use uploads/.meta.json (written by the upload route).
        title: isDirProject ? (w.title || w.id) : (me.title || w.id),
        contentrating: isDirProject ? (w.contentrating || null) : me.contentrating,
        type: w.type,
        // Single-file uploads exist by construction (they came from readdir);
        // directory entries report real existence. Scenes need no media —
        // they go through frameUrl / live render.
        playable: isDirProject ? hasMedia : true,
        media: w.type === 'scene' ? null : `${BASE}/media/${tokenFor(w.fileAbs)}`,
        // 同 Steam 扫描：真实容器后缀（见那里的注释）。
        mediaExt: w.fileAbs ? extOf(w.fileAbs) : null,
        preview: hasPreview
          ? `${BASE}/preview/${tokenFor(w.previewAbs)}`
          : w.type === 'video'
            ? `${BASE}/video-preview/${tokenFor(w.fileAbs)}`
            : null,
        frameUrl: hasFrame ? `${BASE}/scene-frame/${tokenFor(w.fileAbs)}` : null,
        schemeColor: w.schemeColor || null,
        ...sceneFieldsFor(w, hasFrame, customIds, sceneMtime),
        // Directory-shaped web wallpapers (project.json + index.html) get the
        // same live render path as scene directories.
        ...webFieldsFor(w, hasMedia, webMediaBase),
        // 同上：propsUrl 只在条目里给一次（见 Steam 扫描处的注释）。
        propsUrl: (w.type === 'scene' || w.type === 'web') && w.fileAbs
          ? `${BASE}/props/${tokenFor(w.fileAbs)}`
          : null,
        liveFrame: w.type === 'web' && hasMedia ? `${BASE}/live-frame/${tokenFor(w.fileAbs)}` : null,
      };
    }));
    wallpapers.push(...uploads);
    const playableIds = new Set(wallpapers.filter((w) => w.playable).map((w) => w.id));
    const playlists = (await readPlaylistsP(installDir)).map((playlist) => {
      const ids = [];
      const seenIds = new Set();
      for (const item of playlist.items) {
        const id = playlistItemId(item, byPath, byId);
        if (id && !seenIds.has(id)) { seenIds.add(id); ids.push(id); }
      }
      return {
        id: playlist.id,
        name: playlist.name,
        order: playlist.order,
        delay: playlist.delay,
        wallpaperIds: ids,
        total: ids.length,
        portableCount: ids.filter((id) => playableIds.has(id)).length,
        // ⚠️ 别按"写了没人读"删它：`unresolvedCount` 是**已发布的对外契约**
        // （`lib/types/index.d.ts:92` 的 PlaylistDescriptor 字段，随清单整块回给客户端）。
        // 客户端当前只读 portableCount / wallpaperIds / total ⇒ 零内部读者是**有意的扩展位**；
        // 删它等于缩对外类型面，不是清死代码。"写而不读"审计请放过这一处。
        unresolvedCount: Math.max(0, playlist.items.length - ids.length),
      };
    });
    // 场景壁纸渲染页的 mediaBase（**宿主是唯一真源**，客户端不得自己拼 `location.origin`）。
    // **不按适配器形态门控**：网页壁纸要独立源是为了绕能力头栅栏，而场景壁纸要它是为了
    // **带宽**（`scene.pkg` 实测到 336MB；走应用源那条路挤不过首帧预算）—— 这个理由与
    // "是不是桌面壳"无关，浏览器形态同样成立。库里有可实时渲染的场景才起监听（懒启动）。
    // 起不来（`mediaOriginDead`）仍返回 '' ⇒ 客户端据此回落应用源（慢但可见），而不是空白。
    const sceneMediaBase = wallpapers.some((w) => w.sceneLive) ? await mediaOriginApi.ensureSceneMediaOrigin() : '';
    return {
      installDir,
      uploadDir: getUploadDir(),
      // 当前生效的**缓存根**（解析链 env → config.cacheDir → 默认，见 lib/index.js 的
      // cacheBaseDir）：设置页「高级 → 缓存位置」把它显示出来，`/cache-dir` 改完也靠
      // 重拉清单回显。这里给的就是解析链的答案 —— 设了 DSH_WE_CACHE_DIR 时它不等于
      // 用户填的值，客户端据此提示"当前由环境变量覆盖"。
      cacheDir: cacheBaseDir(),
      // WE 官方素材（local-assets）：客户端据此决定 scene-live URL 是否带
      // localAssets=1，并在设置面板展示配置状态。
      weAssetsDir: getWeAssetsDir(),
      weAssetsAvailable: weAssetsAvailable(),
      // 场景渲染页的 mediaBase（独立壁纸媒体源的 origin；'' = 回落应用源）。
      // 客户端把它拼上 `${BASE}/scene-files` 后交给渲染页 —— 见 `src/live-layer.js` 的
      // liveRenderUrl（**不要再**在那里拼 location.origin，那会把大 pkg 推回应用源那条路）。
      sceneMediaBase,
      total: wallpapers.length,
      portableCount: wallpapers.filter((w) => w.playable).length,
      wallpapers,
      playlists,
    };
  }

  /**
   * 全量重扫：locate → enumerate → 逐条目探测（只有项目目录变了的才真探）→ 组装 → 落盘索引。
   * 签名在扫描**之前**算（见 lib/index.js scanSignatureP 的注释：库在扫描期间又变时，
   * 存下的签名偏旧 ⇒ 下一次请求就会发现不匹配并再扫一次，保守）。
   */
  async function rescan() {
    const installDir = await locateWallpaperEngineP();
    const libraryDirs = await owningLibrariesP();
    const sig = await scanSignatureP(installDir, libraryDirs);
    const we = liveEntries(await enumerateWallpapersAsync(installDir, libraryDirs));
    // 探测记忆**跨扫描延续**：上一次索引里的条目只要项目目录 mtime 没变就不重探
    // （`assembleInventory` 的 revalidate 那一支）—— 于是"库里新增一张壁纸"只探测新的那一条。
    const prev = (await loadIndex())?.probes;
    const probes = prev && typeof prev === 'object' ? { ...prev } : {};
    const payload = await assembleInventory(we, probes, installDir, libraryDirs, true);
    // 丢掉已经不在库里的条目：索引不该随删除无限长（也不该把早已删除的路径当"记得"）。
    const live = new Set(we.map((w) => (w.fileAbs ? pathKey(w.fileAbs) : '')).filter(Boolean));
    for (const key of Object.keys(probes)) {
      if (!live.has(key)) delete probes[key];
    }
    await saveIndex({ builtAt: Date.now(), sig, installDir, libraryDirs, we, probes });
    // 视频壁纸先排队生成 faststart 变体（轮换列表优先）：第一次切就该快，而不是"用过一次才快"。
    // 串行、只排一次、单张失败不影响其它；见 warmFaststartFavorites。
    // ⚠️ **只挂在重扫这条路上**：它是真扫描的收尾（磁盘上的变体本来就跨重启保留），
    // 签名快路径每次请求都跑一遍就变成"每次重读一遍视频头"了。
    warmFaststart(payload.wallpapers, log).catch(() => { /* 预热是优化 */ });
    return payload;
  }

  /**
   * 立刻重扫并把结果记为缓存；并发请求共用同一次在途扫描。
   * 失败时**抛出给调用者**（清单端点该报 500 就报 500，不要静默端旧数据）。
   */
  function rescanOnce() {
    if (rebuildInFlight) return rebuildInFlight;
    const p = rescan()
      .then((payload) => { inventoryCache = { t: Date.now(), payload }; return payload; })
      .finally(() => { if (rebuildInFlight === p) rebuildInFlight = null; });
    rebuildInFlight = p;
    return p;
  }

  /** 后台重扫（stale-while-revalidate 的 revalidate 那一半）：调用方不等待、失败静默。 */
  function scheduleRescan() {
    rescanOnce().catch(() => null);
  }

  // Build the inventory (async scan chain — fs.promises, event-loop friendly).
  // The browser half refetches live each load, so freshness semantics are
  // unchanged; only the blocking behavior is gone.
  async function buildInventory() {
    if (inventoryCache && Date.now() - inventoryCache.t < INVENTORY_TTL_MS) {
      return inventoryCache.payload;
    }
    // 扫描输入本身很便宜（`steamProbeDirsP` 自带 60s TTL，见 lib/steam-discovery.js）：
    // 定位 + 签名一共十几次 stat，对手是冷扫那一万多次 fs 操作。
    const installDir = await locateWallpaperEngineP();
    const libraryDirs = await owningLibrariesP();
    const sig = await scanSignatureP(installDir, libraryDirs);
    const index = await loadIndex();
    if (index && sig && index.sig === sig) {
      // ② 快路径：库没动 ⇒ 零 fs 探测，照既有原料重组（token 重新铸造、mediaMap 重播）。
      const payload = await assembleInventory(index.we, index.probes, installDir, libraryDirs, false);
      // require-atomic-updates（噪声，有界陈旧）：`inventoryCache` 有两个写者（这里的快路径与
      // `rescanOnce` 的 .then），并发时最后完成者胜出 —— 最坏是后完成者把更旧的载荷写回，
      // 上界 = INVENTORY_TTL_MS（3s）；随后 TTL 到期、或 `index.sig !== sig` 分支立刻重扫自愈。
      // 真要消除它得给载荷做版本比较（比 builtAt/sig），超出最小改法 ⇒ 记为后续可选刀。
      // eslint-disable-next-line require-atomic-updates -- 见上方注释：有界陈旧（≤ INVENTORY_TTL_MS）且随后 TTL/sig 分支自愈。
      inventoryCache = { t: Date.now(), payload };
      if (Date.now() - index.builtAt > INVENTORY_REVALIDATE_MS) scheduleRescan();
      return payload;
    }
    // ③' 索引对不上（或磁盘上还没有索引）：**这一次必须同步扫完**。
    //     对不上 = 库变了（见文件头的 ⚠️），回旧载荷会把别的库端出去；冷启动那一次躲不掉。
    return rescanOnce();
  }

  return buildInventory;
}
