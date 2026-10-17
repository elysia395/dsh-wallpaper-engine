/**
 * faststart.js — **moov 前置（faststart）子系统**：把 moov 在文件尾部的视频壁纸源
 * 变成「服务期合成的**虚拟布局**」，并按「源路径 + 大小 + mtime」记住这个结论。
 *
 * 为什么需要它：Chromium 的媒体加载器对 `Range: bytes=0-` 的响应会**顺流整读**，而这几张源的
 * moov 在文件尾部 ⇒ 元数据（duration/尺寸）要读到文件末尾才出来，耗时 ∝ 文件大小。真机
 * `media-req` 取证（官方壳）：
 *   iris2 764,688,296B / 1761ms · lv_0 501,752,315B / 1250ms · kei 155,604,213B / 357ms
 *   · ahq 101,749,329B / 324ms（≈430MB/s），而**同一个 iris2** 在"页面刚加载后的第一张"
 *   那条路上只要 149–233ms —— 两者差别正是 moov 在不在前面。
 * 所以现在**不生成 `fs_*.mp4` 副本**。副本是源的**等大拷贝**（体积与 moov 占比的实测见
 * `lib/mp4-vfs.js` 文件头），且这份拷贝卡在 8GB 上限下几乎永不淘汰。
 * 现在"搬家"改为**服务期按段表合成**（`lib/mp4-vfs.js` 算布局、`lib/serve.js` 的 `serveLayout`
 * 发字节）：mdat 一个字节都不动 ⇒ 磁盘成本 **0**，代价只是每个源一份 moov 的内存。
 * 等价性已真机取证（framemd5 逐帧一致 / 总长不变 / 偏移全在 mdat 内），见 `lib/mp4-vfs.js`
 * 文件头与 docs/CHANGELOG.md。
 * 取不到/判不了一律照旧服务原片：这条是优化，绝不允许它让壁纸播不出来。
 *
 * 契约：`createFaststartKit(c)` → `{ faststartVariant, pinnedFaststartVariant,
 *   warmFaststartFavorites, sweepLegacyFaststartVariants }`（只回**被外面用到**的那几个）。
 *   · `faststartVariant(abs, logFn)` → `{ abs, layout }`（本次可用虚拟布局）| `null`（用原片）
 *   · `pinnedFaststartVariant(abs, token, logFn)` → 同上，但**第一次请求定音**（见 MEDIA_CHOICE_PIN）
 *   · `warmFaststartFavorites(wallpapers, logFn)` ← 预热：轮换列表里的视频先算一遍布局
 *   · `sweepLegacyFaststartVariants()` ← **一次性回收旧版留下的副本**（升级即回收旧缓存；量级见
 *     `lib/mp4-vfs.js` 文件头的实测）
 *   `c` 里是这一族**用到但不属于它**的东西：
 *   · `layoutFor`     ← lib/mp4-vfs.js 的布局分析器（带内存缓存；判不了返回 `{kind:'none'}`）
 *   · `cacheBaseDir`  ← **只用于清扫**：旧副本目录 `cacheBaseDir()/faststart`
 *     （**不**按 `configPath()` 的父目录写死 —— 缓存根可由用户在设置页改，见 `cacheBaseDir()`）
 *   · `legacyCacheBaseDir` ← **只用于清扫**：`≤ v1.3.1` 把旧副本写死的那个根
 *     （数据目录下的 `cache/`）。当年那条 `faststartCacheDir()` 不认 `DSH_WE_CACHE_DIR`、
 *     也不认设置里的「缓存位置」⇒ 搬过缓存根的用户那几 GB 只可能留在它下面
 *   · `readConfig` / `mediaMap` ← 预热器：轮换列表读设置，token → 磁盘绝对路径
 *
 * ⚠️ **状态刻意住在模块作用域**（不在工厂里）：`MEDIA_CHOICE_PIN`（**字节布局钉子**）的寿命
 *   本就该跨 `apply()` —— 放进工厂会让插件重载时把"这一份播放用哪份字节"一次性丢掉。
 *   **唯一的 per-apply 状态**是预热器的 `started`（"每次宿主加载只算一遍"），故只有它在闭包里。
 *
 * 不变量：
 *   · **同一次播放必须是同一份字节**：原片与虚拟布局的**媒体数据偏移不同**，中途换会让解复用器
 *     按旧偏移读新布局 ⇒ 花屏 / 解码失败。所以"这一份播放用哪个布局"只由**第一次**请求决定
 *     （`pinnedFaststartVariant`），命中还会**续期**（循环壁纸一次播放远超 TTL）。
 *   · **绝不为了"下次快"去动正在播的那一份**：没有布局 ⇒ 本次照旧发原片（`null`），绝不抛出。
 *   · 清扫只回收**旧版的副本**：不认识的字节一律不碰（那条纪律与缓存目录搬迁一致）。
 */

import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** 旧副本清扫的单次上限：够把旧缓存清完，又不会把启动卡住（超了下次启动接着删）。 */
const LEGACY_SWEEP_MAX_FILES = 512;
/** 预热最多先算多少张：布局缓存只有 `VFS_CACHE_MAX_ENTRIES` 条（见 lib/mp4-vfs.js），算多了也是白算。 */
const WARM_MAX_SOURCES = 12;

/**
 * **每个 token 在一次宿主运行里钉住"用哪个字节布局"**。
 *
 * 为什么必须有：原片与虚拟布局的**媒体数据偏移不同**（mdat 整体后移了 len(moov)）。若同一次
 * 播放里第一次请求拿到原片、第二次请求（布局算好了）拿到虚拟布局，解复用器就按旧偏移去读新
 * 布局 ⇒ 花屏/解码失败。所以"这一份播放用哪个布局"只由**第一次**请求决定，之后一直用它；
 * 命中会**续期**（循环壁纸一次播放远超 TTL，固定窗口会在会话中途换字节布局），TTL 只兜底回收
 * 早已无人问津的钉子。
 */
const MEDIA_CHOICE_PIN = new Map();
const MEDIA_PIN_TTL_MS = 10 * 60 * 1000;

export function createFaststartKit(c) {
  const { layoutFor, cacheBaseDir, legacyCacheBaseDir, readConfig, mediaMap } = c;

  /**
   * 旧版（≤ v1.3.1）把 moov 搬家的**副本**落在这里：`fs_<key>.mp4`，每张 = 源的全量拷贝。
   * 目录本身仍属缓存子目录表（`CACHE_SUBDIRS` —— 用户在设置页改缓存根时要连它一起搬），
   * 只是本版起不再往里写任何东西。
   *
   * ⚠️ **要扫两个根**：当年那条 `faststartCacheDir()` 是拿 `configPath()` 的**父目录**
   * （= 数据目录）硬拼 `cache/faststart` —— 与 `DSH_WE_CACHE_DIR` / 设置里的「缓存位置」
   * **无关**。把缓存根搬到别的盘（或一开始就用环境变量指着别的盘）的用户，那些旧副本
   * 只可能留在数据目录里；只按当前根扫，它们就永远不会被回收 —— 而本文件的契约与启动日志
   * 都宣称"升级即回收旧缓存"。两个根相同时（缺省配置）只扫一次。
   * （若用户之后又换过 `DSH_WE_DATA_DIR`，副本留在**上一个**数据目录里 —— 那超出本插件可知的范围。）
   */
  function legacyFaststartDirs() {
    const dirs = [join(cacheBaseDir(), 'faststart')];
    try {
      const old = typeof legacyCacheBaseDir === 'function' ? legacyCacheBaseDir() : '';
      if (old) {
        const dir = join(old, 'faststart');
        if (!dirs.some((d) => resolve(d).toLowerCase() === resolve(dir).toLowerCase())) dirs.push(dir);
      }
    } catch { /* 拿不到旧根 ⇒ 只扫当前根（清扫是回收，绝不能因此抛） */ }
    return dirs;
  }

  /**
   * 一次性回收旧版的副本（升级后第一次启动就回收旧缓存）。只认旧版的命名
   * `fs_*.mp4` 与它原子写的残留 `fs_*.mp4.tmp<pid><6位序号>`；失败一律忽略 ——
   * 清扫是回收，绝不能影响启动，也不能碰不认识的字节。
   */
  function sweepLegacyFaststartVariants() {
    const out = { files: 0, bytes: 0, capped: false };
    for (const dir of legacyFaststartDirs()) {
      if (out.capped) break;
      let names;
      try { names = readdirSync(dir); } catch { continue; }
      for (const name of names) {
        if (out.files >= LEGACY_SWEEP_MAX_FILES) { out.capped = true; break; }
        if (!/^fs_.*\.mp4(\.tmp\d*)?$/.test(name)) continue;
        const file = join(dir, name);
        try {
          const st = statSync(file);
          if (!st.isFile()) continue;
          unlinkSync(file);
          out.files += 1;
          out.bytes += st.size;
        } catch { /* 被占用 / 已消失：下次启动再来 */ }
      }
    }
    return out;
  }

  /**
   * 这一份源的**虚拟布局**（没有 / 判不了 ⇒ `null`，调用方照旧发原片）。
   * 注意它**不是磁盘上的某个文件**：字节由 `serveLayout` 按段表合成（见 lib/mp4-vfs.js）。
   */
  function faststartVariant(abs, logFn) {
    if (!abs) return null;
    let res;
    try { res = layoutFor(abs, logFn); } catch { return null; }
    if (!res || res.kind !== 'virtual') return null;
    return { abs, layout: res };
  }

  /**
   * 这一份播放该用哪个布局：**第一次请求定音**，之后一直用它（见 MEDIA_CHOICE_PIN）。
   * 有虚拟布局 ⇒ 用它；没有 ⇒ 本次用原片（绝不为了"下次快"去动正在播的那一份）。
   */
  function pinnedFaststartVariant(abs, token, logFn) {
    if (!abs) return null;
    const key = String(token || abs);
    const now = Date.now();
    const pin = MEDIA_CHOICE_PIN.get(key);
    if (pin && now - pin.at < MEDIA_PIN_TTL_MS) {
      pin.at = now;                             // 命中即续期：播放会话内绝不换字节布局
      // 钉住的若是原片（当时还没有布局）⇒ 继续原片，不许中途换成虚拟布局（偏移不同）。
      if (!pin.virtual) return null;
      const again = faststartVariant(abs, logFn);
      if (again) return again;
      pin.virtual = false;                      // 布局判不了了 ⇒ 钉成原片
      return null;
    }
    const pick = faststartVariant(abs, logFn);
    MEDIA_CHOICE_PIN.set(key, { virtual: Boolean(pick), at: now });
    // 上限保护：钉子只是短命状态，别让它随库增长。
    if (MEDIA_CHOICE_PIN.size > 200) {
      const oldest = [...MEDIA_CHOICE_PIN.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) MEDIA_CHOICE_PIN.delete(oldest[0]);
    }
    return pick;
  }

  // 视频壁纸的布局预热：**轮换列表优先**，然后是库里其余视频 —— 目标是"第一次切就快"，
  // 而不是"用过一次才快"。本版这一步只是**解析 moov**（几十毫秒、不起 ffmpeg、不落盘），
  // 结果进 lib/mp4-vfs.js 的有界内存缓存 ⇒ 不必再按字节预算排队，也不会写坏任何一个字节。
  // 懒算（/media-info 与 /media 首次请求时）仍然是兜底 —— 新加的壁纸不可能等下一次重启才快。
  // ⚠️ `started` 是**工厂闭包**状态（per-apply）—— 插件重载后允许再算一遍。
  let started = false;
  async function warmFaststartFavorites(wallpapers, logFn) {
    if (started) return;
    started = true;
    let favIds = [];
    try {
      const cfg = readConfig();
      const groups = (cfg && cfg.settings && Array.isArray(cfg.settings.rotationGroups))
        ? cfg.settings.rotationGroups : [];
      favIds = groups.flatMap((g) => (g && Array.isArray(g.wallpaperIds) ? g.wallpaperIds : [])).map(String);
    } catch { /* 读不到设置就只有"其余视频"这一档 */ }
    const videos = (Array.isArray(wallpapers) ? wallpapers : [])
      .filter((w) => w.type === 'video' && w.media);
    const picked = [
      ...videos.filter((w) => favIds.includes(String(w.id))),
      ...videos.filter((w) => !favIds.includes(String(w.id))),
    ].slice(0, WARM_MAX_SOURCES);
    for (const w of picked) {
      try {
        const abs = mediaMap.get(String(w.media).split('/').pop());
        if (abs) faststartVariant(abs, logFn);  // 判不了也不报错：本次照旧发原片
      } catch { /* 单张失败不影响其它 */ }
    }
  }

  return { faststartVariant, pinnedFaststartVariant, warmFaststartFavorites, sweepLegacyFaststartVariants };
}
