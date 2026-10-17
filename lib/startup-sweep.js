/**
 * 启动清扫（延迟到插件加载完成之后的一次性回收）。
 *
 * 它不是路由族、也不是数据目录族，所以做成工厂套件
 * `createStartupSweepKit({ …deps })`：门面只建实例、把 `dispose` 推进 disposers。
 *
 * 为什么这样写在 apply 里：上个宿主进程可能死在转码/下载中途（detached 的 ffmpeg 子进程在父
 * 进程被重启/HMR 杀掉后仍在写），留下 .tmp 输出、.prog 进度、.part 下载、ffmpeg-err 日志；
 * 本进程启动时不可能有在途产物 ⇒ 一次全清。而缓存清扫/裁剪都是**同步遍历目录**，在 apply()
 * 里直接跑会阻塞插件树加载、拖长整个 profile 的启动时间（实测），所以统一推迟到 3s 之后。
 *
 * 契约：createStartupSweepKit({ log, sweepTranscodeArtifacts, sweepCustomFrameTmp, customFrameDir,
 *   avatarDir, mascotDir, pruneVideoPreviewCache, pruneCacheDirBySize, transcodeCacheDir,
 *   TRANSCODE_CACHE_MAX_BYTES, sweepLegacyFaststartVariants }) → { dispose }
 *   - log                          宿主日志（旧版 faststart 副本的回收条数/体积）
 *   - sweepTranscodeArtifacts     转码缓存垃圾清扫（lib/media/transcode.js）
 *   - sweepCustomFrameTmp         只清够旧 `.tmp` 的清扫器（lib/media/media-dirs.js）
 *   - customFrameDir / avatarDir / mascotDir
 *                                 自定义画面 / 头像 / 吉祥物三个目录（同一个清扫器分别扫）
 *   - pruneVideoPreviewCache      视频缩略图缓存按大小裁剪（lib/media/video-preview.js）
 *   - pruneCacheDirBySize         大文件缓存按 mtime-LRU 收敛到上限（同上套件）
 *   - transcodeCacheDir / TRANSCODE_CACHE_MAX_BYTES
 *                                 转码产物目录与上限（同上套件）
 *   - sweepLegacyFaststartVariants 旧版（≤ v1.3.1）faststart 落盘副本的一次性回收（lib/faststart.js）
 *
 * 不变量：
 *   - `dispose()` **必须** clearTimeout —— fiber 卸载/HMR 后不能再有这次回调跑起来。
 *   - 七条调用各自的 try/catch 兜底，任何一步失败都不许影响另外六步。
 *   - 这七条调用的**顺序**是逐字搬来的（先清扫转码垃圾 → 三个自定义目录 → 两个缓存裁剪 →
 *     最后回收旧版 faststart 副本），不要重排。
 *   - 本模块只 import `node:*` 与相对路径；**绝不** import `lib/index.js`（依赖全部由门面显式注入）。
 */
export function createStartupSweepKit({
  log, sweepTranscodeArtifacts, sweepCustomFrameTmp,
  customFrameDir, avatarDir, mascotDir,
  pruneVideoPreviewCache, pruneCacheDirBySize, transcodeCacheDir, TRANSCODE_CACHE_MAX_BYTES,
  sweepLegacyFaststartVariants,
}) {
  // Startup sweep: a previous host process may have died mid-transcode or
  // mid-download (the detached ffmpeg child keeps writing after its parent is
  // killed by a restart/HMR), orphaning .tmp outputs, .prog progress files,
  // .part downloads and ffmpeg-err logs. Nothing of THIS process can be
  // mid-flight at startup, so all stale artifacts are removed in one pass.
  // 缓存清扫/裁剪推迟到插件加载完成之后：两者都是同步遍历缓存目录，在 apply()
  // 里直接跑会阻塞插件树加载、拖长整个 profile 的启动时间（实测）。
  const startupSweepTimer = setTimeout(() => {
    try { sweepTranscodeArtifacts(); } catch { /* ignore */ }
    // 自定义画面目录不属上面那三个目录，这里单独扫（只清够旧的 `.tmp`，见 sweepCustomFrameTmp）。
    try { sweepCustomFrameTmp(customFrameDir()); } catch { /* ignore */ }
    // 头像目录同理（写流被强杀留下的 `.tmp`；读取侧只认正式扩展名 ⇒ 不扫就是看不见的垃圾）。
    try { sweepCustomFrameTmp(avatarDir()); } catch { /* ignore */ }
    // 吉祥物立绘目录同一条纪律（它同样只认 `mascot-*.{ext}`，`.tmp` 是看不见的垃圾）。
    try { sweepCustomFrameTmp(mascotDir()); } catch { /* ignore */ }
    try { pruneVideoPreviewCache(); } catch { /* ignore */ }
    // 大文件缓存同样要有上限 (见 pruneCacheDirBySize): transcode 输出
    // (tc_*.mp4, 每个 80–280MB) 没有上限就会一路增长 → 按 mtime-LRU 收敛到上限以内。
    // 只匹配真正的转码产物, 不碰同名的 .loop / .prog / .tmp 附属文件。
    try { pruneCacheDirBySize(transcodeCacheDir(), TRANSCODE_CACHE_MAX_BYTES, /^tc_.*\.mp4$/); } catch { /* ignore */ }
    // faststart 的旧变体是**源的全量拷贝**（为什么不可取：体积实测见 `lib/mp4-vfs.js` 文件头，
    // 且卡在 8GB 上限下永不触发淘汰）。现在"搬家"改为**服务期合成**（见 lib/mp4-vfs.js，磁盘 0）
    // ⇒ 那些副本一次性回收，也不再需要"按大小裁剪"这条纪律（不再有新的落盘）。
    // ⚠️ 清扫要连**旧版写死的那个根**一起扫：缓存根搬到别的盘、或一直用 DSH_WE_CACHE_DIR 的
    // 用户，旧副本只在数据目录里（判据与负对照见 test/verify-mp4-vfs.mjs 的 D 段）。
    try {
      const swept = sweepLegacyFaststartVariants();
      if (swept.files) {
        log.info('已回收旧版 faststart 副本：' + swept.files + ' 个 / '
          + (swept.bytes / 1048576).toFixed(1) + ' MB（本版起不再落盘）'
          + (swept.capped ? '（本轮达清扫上限，下次启动继续）' : ''));
      }
    } catch { /* ignore */ }
  }, 3000);

  const dispose = () => { try { clearTimeout(startupSweepTimer); } catch { /* ignore */ } };
  return { dispose };
}
