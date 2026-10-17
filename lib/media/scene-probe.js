/**
 * scene-probe.js — 场景探测族（场景独立音频缓存 + 场景视频/侧栏图探测的并发队列）。
 *
 * 从 `lib/index.js` **纯搬移**（P0.2-A）：函数体、常量、正则、注释、错误文案逐字未改，只加工厂
 * 包裹与 2 格缩进；唯一的路径级改动是族内那两条动态 `await import` 的说明符 —— 从同级
 * `pkg-read.js` 多退一级到 `../pkg-read.js`（文件从 lib/ 下沉到 lib/media/ 后相对路径必须跟着走）。
 * 模块级状态（`_sceneAudioState`、
 * `_sceneVideoProbeCache` / `_sceneVideoProbeQueue` / `_sceneVideoProbeActive`）收进工厂闭包。
 *
 * deps 契约（键名 → 门面来源）：
 *   · ensureFrameCacheDir() → 抽帧缓存目录（场景视频侧栏图存放处，来自 lib/media/frame-store.js，
 *     由门面以同名访问器注入）
 *   · atomicWriteFileP(p, data, mode) → 原子写（`lib/kernel/config.js` 的模块级导出，由门面透传）
 *
 * 门面在模块作用域建一次实例并同名解构，调用点逐字未变。
 * 本模块**绝不** import `lib/index.js`（会成环）。
 */

import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { extractSceneVideoFromDir, probeSceneVideoFromPkgFile } from '../scene-manifest.js';

/**
 * 建一次场景探测套件。deps 见文件头；返回门面要用的面。
 */
export function createSceneProbeKit(deps) {
  const { ensureFrameCacheDir, atomicWriteFileP } = deps;

  // ── Scene 独立音频（BGM/音效，WE 音频组件引用）──────────────────
  // 长安雪等场景无内嵌 MP4，音轨以独立文件存放 —— scene-audio 路由此处抽出（取最大者当 BGM）。
  const SCENE_AUDIO_EXT_RE = /\.(mp3|ogg|oga|wav|m4a|flac|aac)$/i;
  const _sceneAudioState = new Map(); // abs → { sig, file: 缓存路径|null }
  function sceneAudioCacheKey(abs, mtime) {
    return 'sa1_' + Buffer.from(abs, 'utf8').toString('base64url') + '_' + Math.round(mtime);
  }
  async function ensureSceneAudio(abs) {
    /** @type {number} */
    let mtime;
    try { mtime = statSync(abs).mtimeMs; } catch { return null; }
    const sig = String(Math.round(mtime));
    const hit = _sceneAudioState.get(abs);
    if (hit && hit.sig === sig) return hit.file;
    let best = null;
    try {
      const { parsePkg } = await import('../pkg-read.js');
      if (abs.toLowerCase().endsWith('.json')) {
        const { readdirSync: rd } = await import('node:fs');
        const dirAbs = dirname(abs);
        for (const name of rd(dirAbs)) {
          if (!SCENE_AUDIO_EXT_RE.test(name)) continue;
          const p = join(dirAbs, name);
          try {
            const st = statSync(p);
            if (!best || st.size > best.size) best = { path: p, size: st.size, ext: name.split('.').pop().toLowerCase(), loose: true };
          } catch { /* ignore */ }
        }
      } else {
        const data = await readFile(abs);
        const entries = parsePkg(data);
        for (const e of entries) {
          const p = String(e.path || e.p || '');
          if (!SCENE_AUDIO_EXT_RE.test(p)) continue;
          const size = Number(e.size) || 0;
          if (best && size <= best.size) continue;
          best = { entry: e, path: p, size, ext: p.split('.').pop().toLowerCase(), loose: false, data };
        }
      }
    } catch { best = null; }
    let file = null;
    if (best) {
      const key = sceneAudioCacheKey(abs, mtime);
      const target = join(ensureFrameCacheDir(), key + '.' + best.ext);
      try {
        if (!existsSync(target)) {
          if (best.loose) {
            await atomicWriteFileP(target, await readFile(best.path));
          } else {
            const { readPkgEntry } = await import('../pkg-read.js');
            const bytes = readPkgEntry(best.data, best.entry);
            if (!bytes || !bytes.length) throw new Error('empty audio entry');
            await atomicWriteFileP(target, Buffer.from(bytes));
          }
        }
        file = target;
      } catch { file = null; }
    }
    _sceneAudioState.set(abs, { sig, file });
    return file;
  }

  // ── sceneVideo 字段的诚实来源: 「该 scene 主文件是否内嵌 MP4」探测缓存 ────────
  // 字段必须诚实:「内嵌 MP4」只能由真实探测得出 —— 拿 hasFrame (静态帧可用性)
  // 冒充它, 对几乎 100% 的 scene 壁纸都会输出 sceneVideo URL → 客户端请求 /scene-video/<token>
  // 拿到 404 (客户端能容错, 但字段在说谎)。
  // 真实探测 = scene-manifest 的文件版 probeSceneVideoFromPkgFile（issue #136:
  // 只读 PKG 索引 + 每个 .tex 前缀, 不再 readFile 整包 —— 旧版曾在启动时对几百个
  // pkg 做整包读风暴）; 结果仍按「pkg 路径 + mtime」缓存 (改/换 pkg 自动
  // 重探, true/false 都存), 缓存命中的价值 = 连索引头都不用读; inventory 只读缓存,
  // 未命中 = 未知 → null (绝不猜) 并把探测投到后台。这里给出有界 LRU。
  const _sceneVideoProbeCache = new Map(); // `${abs}|${mtimeMs}` → boolean (LRU: 尾部最新)
  const SCENE_VIDEO_PROBE_MAX = 512; // 有界: 超出丢最旧
  const SCENE_VIDEO_PROBE_CONCURRENCY = 2; // 单包已降到读索引+前缀(毫秒级); 2 并发足够
  const _sceneVideoProbeQueue = []; // 待探测 { key, abs } (按 key 去重)
  let _sceneVideoProbeActive = 0;

  /** 探测缓存键: 主文件路径 + mtime (mtimeMs 省略时现取, 取不到按 0)。 */
  function sceneVideoProbeKey(abs, mtimeMs) {
    let m = mtimeMs;
    if (m === undefined || m === null) {
      try { m = statSync(abs).mtimeMs; } catch { m = 0; }
    }
    return abs + '|' + Math.round(Number(m) || 0);
  }

  /** 读缓存: undefined = 未知 (调用方必须当 null 处理)。命中刷新 LRU 位置。 */
  function sceneVideoProbeGet(key) {
    if (!_sceneVideoProbeCache.has(key)) return undefined;
    const v = _sceneVideoProbeCache.get(key);
    _sceneVideoProbeCache.delete(key);
    _sceneVideoProbeCache.set(key, v);
    return v;
  }

  /** 记录探测结果 (有界 LRU); 后台探测与真实路由共用。 */
  function sceneVideoProbeSet(key, has) {
    if (_sceneVideoProbeCache.has(key)) _sceneVideoProbeCache.delete(key);
    _sceneVideoProbeCache.set(key, !!has);
    while (_sceneVideoProbeCache.size > SCENE_VIDEO_PROBE_MAX) {
      _sceneVideoProbeCache.delete(_sceneVideoProbeCache.keys().next().value);
    }
  }

  /** 投递后台探测 (未知才投; 已在队列或已有结果则跳过)。 */
  function scheduleSceneVideoProbe(abs, key) {
    if (_sceneVideoProbeCache.has(key)) return;
    if (!_sceneVideoProbeQueue.some((j) => j.key === key)) _sceneVideoProbeQueue.push({ key, abs });
    drainSceneVideoProbeQueue();
  }

  /** 后台探测泵: 小并发; 任何失败都记「否」, 异常不会冒到 inventory。 */
  function drainSceneVideoProbeQueue() {
    while (_sceneVideoProbeActive < SCENE_VIDEO_PROBE_CONCURRENCY && _sceneVideoProbeQueue.length) {
      const job = _sceneVideoProbeQueue.shift();
      if (_sceneVideoProbeCache.has(job.key)) continue; // 排队期间已有结果 (真实请求回填)
      _sceneVideoProbeActive++;
      // 与 /scene-video 路由同一条探测路径: 松散 scene.json 传目录, pkg 传文件。
      (async () => {
        // 先让出当前 macrotask: 松散目录的探测是完全同步的 (遍历 + 读文件),
        // 若就地执行会跑在 inventory 的 map 回调里 → 拖慢响应。推迟一拍再做。
        await new Promise((r) => { setTimeout(r, 0); });
        /** @type {boolean} */
        let has;
        try {
          // 松散目录仍走内存版（目录遍历本来就是本地读）；pkg 走文件版：
          // 只读索引 + .tex 前缀（issue #136），不再 readFile 整包。
          if (job.abs.toLowerCase().endsWith('.json')) {
            const bytes = extractSceneVideoFromDir(dirname(job.abs));
            has = !!(bytes && bytes.length);
          } else {
            has = await probeSceneVideoFromPkgFile(job.abs);
          }
        } catch { has = false; }
        sceneVideoProbeSet(job.key, has);
      })().then(
        () => { _sceneVideoProbeActive--; drainSceneVideoProbeQueue(); },
        () => { _sceneVideoProbeActive--; drainSceneVideoProbeQueue(); },
      );
    }
  }

  return {
    ensureSceneAudio, sceneVideoProbeKey, sceneVideoProbeGet, sceneVideoProbeSet, scheduleSceneVideoProbe,
  };
}
