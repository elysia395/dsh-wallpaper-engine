/**
 * backend.js — 媒体桥的**媒体后端门面**：**首选 media-bridge 子进程，失败自动回落内置实现**。
 *
 * 对宿主只暴露一小组方法（start/stop/spectrum/nowPlaying/artworkFile/artworkMime/status
 * 与内置实现同名，另有中间件专供的 usingBridge/bridgeInfo/control），所以同目录的路由族
 * （`now-playing.js`）不需要知道底下是谁在供数 —— 这是刻意留的接缝：换后端不动路由形状，
 * 回滚也不需要改路由。
 *
 * 选择逻辑（每次会话只决定一次，之后靠 bridge.ready() 判断中间件是否还活着）：
 *   1. `DSH_WE_MEDIA_LEGACY=1`            → 直接用内置实现（排查/对比用）
 *   2. 产物解析成功 + spawn + 握手通过     → 中间件（三平台同一套能力）
 *   3. 任一步失败（取不到产物/起不来/协议不符/连续崩溃）→ 内置实现 + 原因进 status
 *
 * 日志注入契约：本目录只调用注入的 `log(msg, level?)`，**不自己写终端**（终端与落档的唯一
 * 入口是 `lib/log.js`，见其文件头）。级别缺省 `info`；判据是"影响显示效果的非正常表现
 * ⇒ `warn`"：回落、启动失败、中间件报错与重启都是 `warn`，成功事实与运行信息是 `info`。
 */
import { join } from 'node:path';
import { createMediaBridge as createLegacy } from './legacy.js';
import { createBridgeSupervisor } from './supervisor.js';
import { provisionMediaBridge } from './provision.js';

/**
 * @param {object} o
 * @param {string} o.dataDir 插件数据目录（**不是**缓存根）：中间件产物 `<dataDir>/bin/media-bridge/`
 *   与 macOS 音频 tap 的编译产物 `<dataDir>/bin/we-audio-tap` 都落这里 —— 它们属**工具链**，
 *   和 ffmpeg 一样不随「缓存位置」走（挪了要重下 / 重编译，那是另一件事）。
 * @param {string|(() => string)} [o.cacheBaseDir] 缓存根（见 `lib/kernel/data-dir.js` 的 `cacheBaseDir()`）：中间件的
 *   运行时缓存（`--cache-dir`）与内置实现的封面缓存都在它下面。缺省 `<dataDir>/cache` ——
 *   与默认布局逐字一致，所以只传 `dataDir` 的老调用点行为不变。**可以传访问器**（推荐，
 *   路由就这么传）：那样「缓存位置」改完，中间件下一次起动 / 下一张封面就走新根，不必重启宿主。
 * @param {(text: any, level?: string) => void} [o.log] 日志被调用面（`log(msg, level?)`）；缺省空实现。
 * @param {(name:string, data?:any) => void} [o.diag] 诊断上报（宿主注入 `appendDiagLine` 包装）。
 */
export function createMediaBackend({ dataDir, cacheBaseDir = join(dataDir, 'cache'), log = () => {}, diag = () => {} }) {
  // 缓存根**每次现问**（同 `cacheBaseDir()` 的理由）：传进来是访问器就现算，是字符串就照用。
  // 在这里存值快照会让"改完缓存位置、新缓存又写回旧盘"悄悄发生 —— 正是本轮要修的那类 bug。
  const cacheRoot = () => (typeof cacheBaseDir === 'function' ? cacheBaseDir() : cacheBaseDir);

  let started = false;
  let useBridge = false;         // 中间件可用（握手通过且没被判死）
  let fallback = '';             // 回落原因（空 = 没回落）
  let note = '';                 // 准备中的说明（设置界面可见）
  let booting = null;
  let sup = null;
  let legacy = null;
  const optsRef = { audio: true, online: false };
  const forceLegacy = String(process.env.DSH_WE_MEDIA_LEGACY || '').trim() === '1';

  /** 内置实现按需构造（音频开关要跟着用户设置走，不能构造时就定死）。 */
  function legacyBackend() {
    if (!legacy) legacy = createLegacy({ dataDir, cacheBaseDir: cacheRoot, log, audio: optsRef.audio });
    return legacy;
  }

  /** 当前真正在供数的后端（中间件没就绪/已判死时都落到内置实现）。 */
  function active() {
    if (useBridge && sup && sup.ready()) return sup;
    return legacyBackend();
  }

  function fallBackTo(reason) {
    if (fallback) return;
    fallback = reason || '中间件不可用';
    useBridge = false;
    note = '';
    log('回落到内置媒体实现：' + fallback, 'warn');
    diag('media-fallback', { reason: String(fallback).slice(0, 200) });
    try { legacyBackend().start(); } catch (err) { log('内置媒体实现启动失败：' + err, 'warn'); }
  }

  function bootBridge() {
    if (booting) return booting;
    booting = (async () => {
      note = '正在准备系统媒体中间件…';
      const prov = await provisionMediaBridge({ dataDir, log });
      if (!prov.path) { fallBackTo(prov.error || '中间件产物不可用'); return; }
      sup = createBridgeSupervisor({
        binPath: prov.path,
        cacheDir: join(cacheRoot(), 'media-bridge'),
        log,
        diag,
        onFatal: (why) => fallBackTo(why),
      });
      const ok = await sup.start({ audio: optsRef.audio, online: optsRef.online });
      if (!ok) { fallBackTo(sup.lastError() || '中间件启动失败'); return; }
      useBridge = true;
      note = '';
      log(`媒体数据源：系统媒体中间件（${prov.source}${prov.tag ? ', ' + prov.tag : ''}）`, 'info');
    })().catch((err) => {
      fallBackTo('中间件准备出错：' + String(err && err.message ? err.message : err));
    }).finally(() => { booting = null; });
    return booting;
  }

  return {
    /** 懒启动（由路由第一次被访问时触发；重复调用无副作用）。 */
    start(opts = {}) {
      if (started) return;
      started = true;
      Object.assign(optsRef, { audio: opts.audio !== false, online: opts.online === true });
      if (forceLegacy) {
        fallback = '按 DSH_WE_MEDIA_LEGACY=1 使用内置实现';
        log('媒体数据源：内置实现（DSH_WE_MEDIA_LEGACY=1）', 'info');
        legacyBackend().start();
        return;
      }
      bootBridge();
    },
    stop() {
      try { if (sup) sup.stop(); } catch { /* ignore */ }
      try { if (legacy) legacy.stop(); } catch { /* ignore */ }
    },
    spectrum: () => active().spectrum(),
    nowPlaying: () => active().nowPlaying(),
    artworkFile: () => active().artworkFile(),
    artworkMime: () => active().artworkMime(),
    /**
     * 反向控制（壁纸里的播放按钮 / 宿主面板 → 真实播放器）：**只有中间件能做**
     * —— 内置实现是纯读取。中间件没就绪（还没启动 / 已判死回落）时统一回不可用，
     * 不在此处触发启动：控制是用户点一下的交互，不该顺带把产物下载与子进程
     * 拉起来（启动仍由取数那四条路由的懒启动决定）。
     *
     * 返回值一律是 `{ ok, … }`（不抛），路由按它决定状态码。
     */
    async control(action) {
      if (useBridge && sup && sup.ready()) return sup.control(action);
      return { ok: false, error: fallback ? 'control-unsupported' : 'media-backend-not-ready' };
    },
    status() {
      const live = useBridge && sup && sup.ready();
      const st = active().status();
      return {
        ...st,
        backend: live ? 'bridge' : st.backend,
        fallback,
        note,
      };
    },
    /** 当前是否中间件在供数（自检与设置界面用）。 */
    usingBridge: () => Boolean(useBridge && sup && sup.ready()),
    bridgeInfo: () => (sup ? sup.info() : null),
  };
}
