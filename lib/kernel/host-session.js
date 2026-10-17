/**
 * dsh-wallpaper-engine — 宿主会话段（P1b 拆出，纯搬移）。
 *
 * `lib/index.js` 的 `apply(ctx)` 里**会话期构建**的一切都收在这里：版本戳、宿主日志与
 * 提示通道、token→路径表、虚拟 faststart 族、启动清扫、字节出站套件、壁纸媒体源、
 * 清单构建族，以及末尾的 teardown（改由返回的 `dispose()` 承担）。
 *
 * 契约形状与 P1a 的 `createHostKernel` 同形：第二个形参 `c` 是**显式依赖包**（体内
 * `const { … } = c;` 解构，`test/tools/host-route-index.mjs` 的工厂表按这个形态取契约），
 * 第一个形参是模块加载期建好的宿主内核。返回的字段是门面 `apply()` 的注册实参来源。
 *
 * 纪律（P1b）：
 *   1. 本模块的代码正文是 `lib/index.js` 原会话段的**逐行搬移**（缩进/注释一并搬），
 *      只改了相对 import 的目录深度（`./x.js` → `../x.js`）与新增解构/工厂包裹行。
 *   2. **模块 import 期零副作用**（`test/verify-route-index.mjs` 第 ⑤ 段在 import 前设好
 *      env 隔离后真跑 `apply()`）：不建目录、不起定时器、不读配置 —— 一切都在工厂体内。
 *   3. `ctx.logger` 可能是 undefined（同一处 mock ctx 只有 `webServer`）⇒ 保持
 *      `typeof ctx.logger === 'function' ? … : ctx.logger` 形态逐字不变。
 *   4. 工厂内的构造顺序是硬约束（各段注释各钉一条）：`createMp4VfsKit` 先于
 *      `createFaststartKit`；`createServeKit` 先于 `createMediaOrigin`；`createInventoryBuilder`
 *      最后（它立即读 `mediaOriginApi`）。
 *   5. 本文件零 `console.*`（终端镜像的唯一落点是 lib/log.js）：`test/verify-logging.mjs`
 *      的 `wiredUp` 判据要求这里 `consoleCalls === 0`。
 */
import { statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configPath } from './data-dir.js';
// 内核租约（D5）：内核是模块级单例、可能被**多行**共享 ⇒ 释放要经引用计数，
// 只有最后一个卸载的会话才真的 dispose 共享资源。host-kernel.js 不反向 import 本文件（无环）。
import { acquireKernelLease, releaseKernelLease } from './host-kernel.js';
import { createInventoryBuilder } from '../inventory.js';
import { createServeKit } from '../serve.js';
import { createMp4VfsKit } from '../mp4-vfs.js';
import { createFaststartKit } from '../faststart.js';
import { createStartupSweepKit } from '../startup-sweep.js';
import { createLog } from '../log.js';
import { createNotice } from '../notice.js';
import { createMediaOrigin } from '../media-origin.js';
// 容器后缀判据（清单构建族用）：唯一真源在叶子模块 `lib/fs-paths.js`。
// 上游把它做成扫描族工厂的闭包导出、门面再解构出来；本分支抽到叶子模块，去掉原先
// `host-session → 门面（index.js）` 那条环边。
import { extOf } from '../fs-paths.js';

/** 终端行前缀里的名字（与门面 `PLUGIN_NAME` 同一个字面量，逐字搬移，别写成两处不同值）。 */
const PLUGIN_NAME = 'wallpaper-engine';

/**
 * 会话段的返回契约（`buildHostSession()` 的产出，门面 `lib/index.js` 按名解构消费）。
 *
 * 为什么写在这里而不是 `@returns {object}`：写成 `object` 会让 `lib/index.js` 的解构一次
 * 全部落空（`Property 'x' does not exist on type '{}'`）—— 那正是拆文件最容易引入的形状错配，
 * 而 `tsc --checkJs` 的基线是 **0 错**（`test/fixtures/static-baseline.json` 的 `byCode` 为空）。
 *
 * @typedef {object} HostSession
 * @property {((text: string, level?: string) => void) & { tag: (name: string) => (text: string, level?: string) => void }} log 宿主日志入口（`createLog()`，带 `.tag()`；两个面都与 `lib/log.js` 的 `LogCall` 逐字一致）
 * @property {Function} notice 成功提示通道
 * @property {Map<string, string>} mediaMap token → 绝对路径
 * @property {(absPath: string) => string} tokenFor 登记并返回 token
 * @property {Function} faststartVariant
 * @property {Function} pinnedFaststartVariant
 * @property {Function} warmFaststartFavorites
 * @property {Function} sweepLegacyFaststartVariants
 * @property {Array<() => void>} disposers 逐条收尾句柄
 * @property {Set<object>} activeStreams 在途流
 * @property {Function} trackStream
 * @property {Function} serveFile
 * @property {Function} serveLayout
 * @property {Function} handleSceneFiles
 * @property {any} mediaOriginApi 媒体源 + 适配器观测面（键面由 `lib/media-origin.js` 的返回契约定义）
 * @property {Function} buildInventory
 * @property {Map<string, object>} SCENE_VIDEO_INFLIGHT 场景内嵌媒资提取去重账本
 * @property {() => void} dispose fiber 卸载时的整段收尾
 */

/**
 * 建一次会话段。`kernel` 是模块加载期建好的宿主内核（`lib/kernel/host-kernel.js`），
 * `c` 只需 `base`（门面常量 `BASE`）与 `ctx` 两个字段 —— 其余依赖全部从 `kernel` 解构。
 *
 * 本函数只负责**租约**：登记 → 装配（下面的 `buildHostSession`）→ 装配抛错则原样退还并重抛。
 * 装配正文拆到单独函数里，唯一目的就是让那个 `try` 能包住**整段**装配。
 *
 * @param {any} kernel 模块加载期建好的宿主内核（`createHostKernel()` 的平坦返回值）；
 *   刻意不写 `object`/`Record`：那些会把整个内核的键面收成空集或 `unknown`，
 *   而本工厂的全部工作就是按名解构它（内核的键面契约由 `test/verify-component-face.mjs` 机械复算）
 * @param {{ base: string, ctx: { logger?: { error?: Function, warn?: Function, info?: Function } | ((name: string) => object) | null } }} c 门面常量 `BASE` 与 fiber 上下文
 * @returns {HostSession} 会话段
 */
export function createHostSession(kernel, c) {
  const { base, ctx } = c;

  // 内核租约（D5）：`kernel` 是门面模块级单例（多行共享同一份 `transcodeKit`）⇒ 这里
  // 登记一次、下面 teardown 里释放一次；只有**最后一个**释放的会话才真的 dispose。
  //
  // ⚠️ **必须一登记就 `try`**：本工厂在 acquire 之后还有**一整段**装配（日志 / 版本戳 / mp4-vfs /
  // faststart / 清扫 / 出站套件 / 媒体源 / 清单构建）。其中任何一处抛错，`dispose()` 就从未被构造
  // 出来、也从没交给 `ctx.effect` ⇒ 租约计数**永久 >0**，此后本进程内**所有**后续会话的正常卸载
  // 都不再触发 `transcodeKit.dispose()`（在途 ffmpeg 不被杀、`ensuredDirs` 不清、在途表不清）。
  // 单行（现状）下这不是"暂缓释放"，而是**永久泄漏**。所以装配期抛错必须在这里原样退还租约、
  // 再把原始错误往外抛（绝不吞错：装载失败必须仍然是红的）。
  acquireKernelLease(kernel);
  let session;
  try {
    session = buildHostSession(kernel, { base, ctx });
  } catch (error) {
    releaseKernelLease(kernel);
    throw error;
  }
  return session;
}

/**
 * 会话段的装配体（`createHostSession` 的正文）—— 单独提出来的目的只有一个：让**租约的退还**
 * 能包住整段装配（见上面的 `try`）。本函数只在 `acquireKernelLease()` 成功之后被调用一次，
 * 自身不碰租约（退还与释放都在调用方 / `dispose()` 里）。
 *
 * @param {any} kernel 模块加载期建好的宿主内核（理由见 `createHostSession` 的同名参数）
 * @param {{ base: string, ctx: { logger?: { error?: Function, warn?: Function, info?: Function } | ((name: string) => object) | null } }} c 门面常量 `BASE` 与 fiber 上下文
 * @returns {HostSession} 会话段
 */
function buildHostSession(kernel, c) {
  const { base, ctx } = c;
  const {
    appendDiagLine, cacheBaseDir, readConfig, traceRequests, traceMediaRequests, readWebShim,
    buildSeedScript, atomicWriteFileSync, pluginDataDir, readSettings, transcodeCacheDir,
    sweepTranscodeArtifacts, sweepCustomFrameTmp, customFrameDir, avatarDir, mascotDir,
    pruneVideoPreviewCache, pruneCacheDirBySize, TRANSCODE_CACHE_MAX_BYTES,
    locateWallpaperEngineP, owningLibrariesP, enumerateWallpapersAsync, scanSignatureP, pathKey,
    listCustomFrameIds, pathExistsP, mtimeOrNullP, ensureUploadDir, readUploadMeta, enumerateUploadsP,
    metaEntry, readPlaylistsP, playlistItemId, weAssetsAvailable, sceneVideoProbeKey,
    sceneVideoProbeGet, scheduleSceneVideoProbe, customIdFromAbs, getUploadDir, getWeAssetsDir,
  } = kernel;

  // 版本戳：host 每次启动记录一次「加载的是哪份代码」，用于排查
  //「桌面端/CLI 到底跑的是哪个版本」（node_modules 里的 link 目标 + mtime）。
  try {
    const self = fileURLToPath(import.meta.url);
    atomicWriteFileSync(
      join(dirname(configPath()), 'build-stamp.json'),
      JSON.stringify({
        at: new Date().toISOString(),
        hostFile: self,
        hostMtime: statSync(self).mtimeMs,
      }, null, 2) + '\n',
    );
  } catch { /* 诊断用途，失败不影响加载 */ }

  // 宿主日志的唯一入口（三档 + 终端镜像，见 lib/log.js 的文件头）。平台侧取一个具名
  // logger，这样 Desktop 的运行日志里每行都带 `[wallpaper-engine]`，而不是只有 fiber 名。
  const log = createLog(
    typeof ctx.logger === 'function' ? ctx.logger(PLUGIN_NAME) : ctx.logger,
    PLUGIN_NAME,
  );
  // 成功提示通道（sink 甲：终端一行，详见 lib/notice.js）。会话作用域 —— HMR 重挂后
  // `seen` 随之重建，所以"每 kind 每会话至多一条"与 `apply` 的生命周期严格对齐。
  const notice = createNotice(log, PLUGIN_NAME);

  // Token → absolute path map. Tokens are base64url of the abs path, so the
  // route never exposes an arbitrary filesystem string the client could not
  // otherwise obtain from the inventory.
  const mediaMap = new Map();
  const tokenFor = (absPath) => {
    const token = Buffer.from(absPath, 'utf8').toString('base64url');
    mediaMap.set(token, absPath);
    return token;
  };

  // 虚拟 faststart：布局分析器（有界内存缓存）→ lib/mp4-vfs.js；布局钉子 / 预热 / 旧副本清扫
  // → lib/faststart.js。这一族全部实现都在那两个文件里；`c` 只装它们**用到但不属于它们**的东西
  //（见各自文件头）。⚠️ 顺序：分析器先建 —— faststart 吃它的 `layoutFor`。
  const { layoutFor } = createMp4VfsKit({ appendDiagLine });
  // 旧版（≤ v1.3.1）的 faststart 副本写死在**数据目录**下的 `cache/faststart` —— 那条
  // `faststartCacheDir()` 不认 `DSH_WE_CACHE_DIR`，也不认设置里的「缓存位置」。所以搬过缓存根
  // 的用户那几 GB 只可能留在它下面：清扫要连它一起扫（见 lib/faststart.js 的 `legacyFaststartDirs`）。
  const legacyCacheBaseDir = () => join(pluginDataDir(), 'cache');
  const {
    faststartVariant, pinnedFaststartVariant, warmFaststartFavorites, sweepLegacyFaststartVariants,
  } = createFaststartKit({ layoutFor, cacheBaseDir, legacyCacheBaseDir, readConfig, mediaMap });

  // Startup sweep: 一次性回收上个进程死在半途留下的产物（.tmp/.prog/.part/ffmpeg-err），
  // 并把缓存清扫/裁剪推迟到插件加载完成之后 —— 整块已纯搬移进 lib/startup-sweep.js
  // （工厂与 deps 契约见该文件头；3000ms 延迟与七条调用顺序逐字未变）。
  const startupSweepKit = createStartupSweepKit({
    log, sweepTranscodeArtifacts, sweepCustomFrameTmp,
    customFrameDir, avatarDir, mascotDir,
    pruneVideoPreviewCache, pruneCacheDirBySize, transcodeCacheDir, TRANSCODE_CACHE_MAX_BYTES,
    sweepLegacyFaststartVariants,
  });

  const disposers = [];
  disposers.push(startupSweepKit.dispose);

  // 在途流台账：被 serveFile 登记的每条流都进这里，teardown（文件末尾的 fiber disposer）
  // 逐流 destroy。登记/三层收尾的实现都在 lib/serve.js（那边是闭包，这边只给引用）。
  const activeStreams = new Set();

  // 2/3. 媒体 + 预览字节直出（Range / HEAD / 条件 GET）与壁纸自有文件服务 → lib/serve.js。
  //      套件（trackStream / serveFile / handleSceneFiles）与载荷账本都在那个文件里。
  //      ⚠️ 调用点必须早于下面 createMediaOrigin —— 它吃 handleSceneFiles（原靠函数声明提升）。
  const { trackStream, serveFile, serveLayout, handleSceneFiles } = createServeKit({
    activeStreams, BASE: base, mediaMap, log, appendDiagLine,
    traceRequests, traceMediaRequests, readWebShim, buildSeedScript,
  });

  // 壁纸媒体源 + 适配器形态观测：整块收进 lib/media-origin.js（见该文件头）。
  // 依赖显式传入；返回的访问器供扫描链 / /inventory / /settings / 诊断族 / 场景载荷族共用。
  const mediaOriginApi = createMediaOrigin({
    base, log, notice, appendDiagLine, disposers, handleSceneFiles, readSettings,
  });

  // ── 清单构建族（`sceneFieldsFor` / `webFieldsFor` / `buildInventory` ＋ 3s TTL 缓存）
  //    → lib/inventory.js 的工厂 `createInventoryBuilder`（见该文件头）。这不是路由族而是
  //    工厂：TTL 缓存是**跨请求状态**，工厂形式让它与"apply() 的一次调用"同生命周期
  //    （做成模块级单例就会让两次 apply 共用缓存）。
  //    ⚠️ `getUploadDir` / `getWeAssetsDir` 传的是**访问器**不是值：这两个目录会被
  //       /upload-dir 与 /we-assets-dir 在运行时改写，传值快照会让清单一直报旧目录。
  //    `warmFaststartFavorites` 是下方（function 声明，hoisted）的预热器，此处只取引用；
  //    调用点必须在 `mediaOriginApi` 之后 —— 工厂要**立即读**它（const 非 hoist）。
  const buildInventory = createInventoryBuilder({
    log, BASE: base, tokenFor, mediaOriginApi, warmFaststart: warmFaststartFavorites,
    locateWallpaperEngineP, owningLibrariesP, enumerateWallpapersAsync,
    // ⚠️ 上一行必须**逐字**保持这个顺序与换行：test/verify-we-install-probe.mjs 的 D8 按
    //    字面量断言这三者仍是清单载荷的消费面（扫描签名是并列的第四项，另起一行）。
    scanSignatureP,
    pathKey, listCustomFrameIds, pathExistsP, mtimeOrNullP, extOf,
    ensureUploadDir, readUploadMeta, enumerateUploadsP, metaEntry,
    readPlaylistsP, playlistItemId, weAssetsAvailable,
    sceneVideoProbeKey, sceneVideoProbeGet, scheduleSceneVideoProbe, customIdFromAbs,
    getUploadDir, getWeAssetsDir, cacheBaseDir,
  });

  // 3e. 场景内嵌媒资族路由（场景包自带的动画 MP4 + 独立音频）→ lib/routes/scene-media.js。
  //     两条注册、提取去重账本与提取链都在那个文件里；这里只声明它的依赖。
  //     ⚠️ `SCENE_VIDEO_INFLIGHT` 声明在**本文件**、以引用进 `c` —— 保持"本 fiber 单例"，
  //        生命周期与一次 apply 一致。
  const SCENE_VIDEO_INFLIGHT = new Map();

  return {
    log,
    notice,
    mediaMap,
    tokenFor,
    faststartVariant,
    pinnedFaststartVariant,
    warmFaststartFavorites,
    sweepLegacyFaststartVariants,
    disposers,
    activeStreams,
    trackStream,
    serveFile,
    serveLayout,
    handleSceneFiles,
    mediaOriginApi,
    buildInventory,
    SCENE_VIDEO_INFLIGHT,
    dispose: () => {
      for (const d of disposers) { try { d(); } catch { /* ignore */ } }
      // 转码套件的收尾（ensureDirOnce 记忆化 / 在途 ffmpeg 子进程 / 进度账本 / 在途表）已搬进
      // lib/media/transcode.js 的 `dispose()` —— 原有的逐条理由注释随实现一起搬过去了。
      // 这里经租约释放：多行共享内核时，只有计数归零的那次 release 才真的 dispose。
      releaseKernelLease(kernel);
      // Destroy every in-flight media stream so the fiber (HMR / plugin stop)
      // releases all file descriptors — zero residue.
      for (const s of activeStreams) {
        if (!s.destroyed) { try { s.destroy(); } catch { /* ignore */ } }
      }
      activeStreams.clear();
      mediaMap.clear();
    },
  };
}
