/**
 * transcode.js — 抽帧转码族（ffmpeg 供给链 / 并发闸 / 落盘缓存 / 进度账本）。
 *
 * 从 `lib/index.js` **纯搬移**（P0 库化）：函数体、常量、注释、错误文案逐字未改，只把族外依赖
 * 收进一个工厂 `createTranscodeKit(deps)`。门面在**模块作用域**建一次并解构出与原来同名的绑定，
 * 所以门面里所有调用点逐字未变。
 *
 * ⚠️ 为什么实例建在**模块作用域**（而不是像 lib/routes/*.js 那样在 apply() 里建一次）：
 * 这一族有**模块级**调用者 —— 门面的 `generateVideoPreview()` 直接调 `resolveFfmpeg()` /
 * `spawnFfmpeg()`，而 `ensureDirOnce()` 还被非转码族使用（customFrameDir / avatarDir /
 * mascotDir / liveFrameDir / ensureUploadDir 以及 fontsets / presets 两个路由族）。建在 apply()
 * 里这些模块级调用点就拿不到同名绑定（要么改签名、要么靠未初始化的 let 兜底）。模块作用域实例的
 * 生命周期与原实现完全一致：同一模块实例被再次 apply 时状态保留（与原来的模块级 Map/Set 同），
 * 卸载时由 `dispose()` 逐项清空。
 *
 * deps 契约（键名 → 门面来源 / 原因）：
 *   · cacheBaseDir()         → `transcodeCacheDir()` = join(<cache>, 'transcodes')
 *   · configPath()           → `ffmpegDataDir()`     = join(dirname(configPath()), 'ffmpeg')
 *   · videoPreviewCacheDir() → `sweepTranscodeArtifacts()` 扫的第三个目录（唯一一个不属本族的
 *                              目录，见该函数头）
 *   · getMediaInfo(abs)      → 源分辨率 / 时长（码率换算与 `-t` 输出时长上限）
 *   · atomicTmpPath(p)       → 唯一 `.tmp<pid><递增序号>` 临时名（`transcodeToFps` 的取消语义
 *                              依赖它，见那里的 ⚠️）
 *   · pluginRoot             → 本地 ./ffmpeg/ffmpeg(.exe) 的查找根。搬移前是
 *                              `join(dirname(fileURLToPath(import.meta.url)), '..')`（即 bundle 根）；
 *                              注入后本模块不需要 `import.meta.url`。
 *
 * 本模块**绝不** import `lib/index.js`（会成环），只 import `node:` 内置。
 */

import { dirname, join } from 'node:path';
import {
  chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync,
  readSync, readdirSync, renameSync, statSync, unlinkSync, writeSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

/**
 * 建一次抽帧转码套件。deps 见文件头；返回门面要用的面 + `dispose()`。
 */
export function createTranscodeKit(deps) {
  const { cacheBaseDir, configPath, videoPreviewCacheDir, getMediaInfo, atomicTmpPath, pluginRoot } = deps;

  // ── Frame-skip transcode (抽帧转码, ffmpeg) ──────────────────────────────────
  // The decode-side fps cap is implemented as a re-encode, NOT playbackRate:
  // playbackRate is a speed multiplier, so slowing decode also slows motion.
  // Instead the host transcodes the wallpaper ONCE to the capped frame rate
  // (4K120 → 4K60: ffmpeg drops every other frame, timeline stays 1.0x, reference
  // chains are re-encoded intact) and the browser plays a normal capped-fps file.
  // Output is AV1 via NVENC (decode throughput ≈ 2× H.264 on NVDEC, so decode
  // util roughly halves again), falling back to H.264 when AV1 encode is missing.
  // ffmpeg resolution: DSH_WE_FFMPEG env → a local ./ffmpeg/ffmpeg(.exe) next to
  // the bundle → system PATH. Missing ffmpeg ⇒ the transcode route errors and the
  // client transparently keeps the original file (feature degrades gracefully).
  const TRANSCODE_INFLIGHT = new Map();
  // Hard deadline for ONE ffmpeg transcode job (covers ALL encoder attempts of
  // that job — the timer no longer restarts per attempt — so a hung encode can
  // never leave /transcoded waiting forever: the child is killed and the route
  // answers 502, and the client falls back to the original). Queue wait behind
  // the concurrency gate below does NOT consume the budget; the deadline starts
  // when the job actually begins encoding. Overridable via
  // DSH_WE_TRANSCODE_TIMEOUT_MS (ms).
  const TRANSCODE_TIMEOUT_MS = Number(process.env.DSH_WE_TRANSCODE_TIMEOUT_MS) || 15 * 60 * 1000;
  /** Active ffmpeg child processes, so a job deadline can kill them. */
  const ACTIVE_FFMPEG = new Set();

  // 全局转码并发闸：ffmpeg 重编码吃满 CPU/GPU 解码器，N 个并发只会一起变慢，
  // 不会变快。最多 `TRANSCODE_MAX_CONCURRENT` 个并发，其余排队（排队不计入 TRANSCODE_TIMEOUT_MS，
  // deadline 从拿到闸、开始编码起算）。
  const TRANSCODE_MAX_CONCURRENT = 2;
  let transcodeActive = 0;
  const transcodeWaiters = [];
  function acquireTranscodeSlot() {
    if (transcodeActive < TRANSCODE_MAX_CONCURRENT) {
      transcodeActive += 1;
      return Promise.resolve();
    }
    return new Promise((resolveSlot) => { transcodeWaiters.push(resolveSlot); });
  }
  function releaseTranscodeSlot() {
    const next = transcodeWaiters.shift();
    // 有等待者：名额直接移交（计数不变）；无等待者：名额归还。
    if (next) next();
    else transcodeActive -= 1;
  }

  function transcodeCacheDir() {
    return join(cacheBaseDir(), 'transcodes');
  }

  // 目录创建记忆化：recursive mkdirSync 每次都要走一串同步 syscall（逐层
  // stat），而 ensure*Dir 都在请求热路径上。同一路径只 mkdir 一次。
  const ensuredDirs = new Set();
  function ensureDirOnce(dir) {
    if (!ensuredDirs.has(dir)) {
      try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
      ensuredDirs.add(dir);
    }
    return dir;
  }

  function ensureTranscodeCacheDir() {
    return ensureDirOnce(transcodeCacheDir());
  }

  // ── Lazy ffmpeg provisioning (B + C + D) ─────────────────────────────────────
  // Resolution chain (each level falls through to the next):
  //   B. system PATH (bare name)                       ← last resort
  //   C. lazy download cache ~/.dsh-wallpaper-engine/ffmpeg/ffmpeg[.exe]
  //      (pinned single-file ffmpeg-static release asset, magic-byte + size
  //      verified, atomic rename; runs once per machine, then cached)
  //   env DSH_WE_FFMPEG  /  plugin-local ./ffmpeg/     ← explicit overrides
  // Downloaded binaries are pinned by sha256 (FFMPEG_STATIC_SHA256, computed from
  // the b6.0 release bytes) — a mismatch aborts before anything is executed; the
  // magic-byte + size checks remain as a second layer.
  const FFMPEG_STATIC_TAG = 'b6.0';
  // process.platform → process.arch → release asset name (ffmpeg-static naming).
  const FFMPEG_STATIC_ASSETS = {
    win32: { x64: 'ffmpeg-win32-x64', ia32: 'ffmpeg-win32-ia32' },
    linux: { x64: 'ffmpeg-linux-x64', ia32: 'ffmpeg-linux-ia32', arm: 'ffmpeg-linux-arm', arm64: 'ffmpeg-linux-arm64' },
    darwin: { x64: 'ffmpeg-darwin-x64', arm64: 'ffmpeg-darwin-arm64' },
  };
  // Pinned sha256 for every asset in FFMPEG_STATIC_ASSETS (ffmpeg-static b6.0).
  // Computed from the exact release bytes served by both registry.npmmirror.com
  // and github.com/eugeneware/ffmpeg-static releases/download/b6.0 (cross-verified
  // on win32-x64; npmmirror mirrors the GitHub asset byte-for-byte). A mismatch
  // aborts the download instead of executing an unverified binary.
  const FFMPEG_STATIC_SHA256 = {
    'ffmpeg-win32-x64': 'e9fd5e711debab9d680955fc1e38a2c1160fd280b144476cc3f62bc43ef49db1',
    'ffmpeg-win32-ia32': 'fb3766af5cc193ca863e15cd4554a33732973209dad5e3c1433b5e291bceb16c',
    'ffmpeg-linux-x64': 'ed652b2f32e0851d1946894fb8333f5b677c1b2ce6b9d187910a67f8b99da028',
    'ffmpeg-linux-ia32': '103500b65ccb78c3c804088d6e17111d85e2bd03f5a0c61c349dc2d05e165f09',
    'ffmpeg-linux-arm': '1a9ddc19d0e071b6e1ff6f8f34dc05ec6dd4d8f3e79a649f5a9ec0e8c929c4cb',
    'ffmpeg-linux-arm64': '237800b37bb65a81ad47871c6c8b7c45c0a3ca62a5b3f9d2a7a9a2dd9a338271',
    'ffmpeg-darwin-x64': 'cfe20936c83ecf5d68e424b87e8cc45b24dd6be81787810123bb964a0df686f9',
    'ffmpeg-darwin-arm64': 'a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584',
  };

  function ffmpegDataDir() {
    const dir = join(dirname(configPath()), 'ffmpeg');
    try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
    return dir;
  }
  function ffmpegExeName() {
    return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  }

  // Startup-only sweep of orphaned transcode/download artifacts (see apply()).
  // Matches: `*.tmp<pid>` transcode outputs, `*.prog` progress files (legacy),
  // `*.part*` download partials, `ffmpeg-err-*.log` spawn logs. Runs once before
  // any route is served, so nothing of the current process is ever touched.
  function sweepTranscodeArtifacts() {
    const dirs = [transcodeCacheDir(), ffmpegDataDir(), videoPreviewCacheDir()];
    // A plugin HMR/re-apply re-runs this sweep while the SAME process may still be
    // mid-transcode; never delete artifacts owned by the current pid (the ffmpeg
    // child keeps writing to `.tmp<pid>` — removing it would corrupt the job).
    // ⚠️ 尾部要允许**递增序号**：转码临时名走 `atomicTmpPath`（`.tmp<pid><6 位序号>`），
    // 只认 `.tmp<pid>` 结尾会让"保护本进程在途写"这条在改名后静默失效（HMR 时删掉正在写的产物）。
    const ownTmpRe = new RegExp('\\.tmp' + process.pid + '\\d*$');
    for (const dir of dirs) {
      /** @type {string[]} */
      let entries;
      try { entries = readdirSync(dir); } catch { continue; }
      for (const name of entries) {
        if (ownTmpRe.test(name)) continue;
        if (!(/\.tmp\d*$/.test(name) || /\.part\d*$/.test(name)
          || /\.prog$/.test(name) || /^ffmpeg-err-/.test(name))) continue;
        try { unlinkSync(join(dir, name)); } catch { /* ignore */ }
      }
    }
  }

  /**
   * 自定义画面目录的孤儿 `.tmp` 清扫。
   *
   * `/custom-frame` 的"中途放弃"已由 `req 'close'` 收口（见 `routes/scene-frame.js` 文件头的不变量）
   * ⇒ 正常路径不再留孤儿。剩下的来源是**进程被强杀 / 崩溃**：写流随进程消失，`.tmp` 留在盘上。
   * 而读取侧（`customFramePath` / `listCustomFrameIds`）只认 `.png|.jpg|.webp` ⇒ 那种垃圾
   * **看不见**、只会累积（`sweepTranscodeArtifacts` 扫的三个目录都不含自定义画面目录）。
   *
   * ⚠️ 只清**够旧**的：HMR 重新 apply 会再跑一次本清扫，而同一进程里可能正有一个上传在写那个
   * 确定性的 `.tmp` 名 —— 按年龄设限就不会误删在途写（与 `sweepTranscodeArtifacts` 的
   * `ownTmpSuffix` 是同一类保护，这里是时间口径）。
   */
  const CUSTOM_FRAME_TMP_STALE_MS = 10 * 60 * 1000;
  function sweepCustomFrameTmp(dir) {
    /** @type {string[]} */
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    const cutoff = Date.now() - CUSTOM_FRAME_TMP_STALE_MS;
    for (const name of entries) {
      if (!name.endsWith('.tmp')) continue;
      const abs = join(dir, name);
      try { if (statSync(abs).mtimeMs > cutoff) continue; } catch { continue; }
      try { unlinkSync(abs); } catch { /* ignore */ }
    }
  }

  function ffmpegMagicOk(buf) {
    if (buf.length < 4) return false;
    // PE (Windows): "MZ"; ELF: 0x7F 'ELF'; Mach-O 64: CF FA ED FE.
    const mz = buf[0] === 0x4d && buf[1] === 0x5a;
    const elf = buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46;
    const mach = buf[0] === 0xcf && buf[1] === 0xfa && buf[2] === 0xed && buf[3] === 0xfe;
    return mz || elf || mach;
  }

  let ffmpegDownloadPromise = null;
  // Last download failure (URL + reason) surfaced in the transcode 502 detail,
  // so a bad tag/URL, blocked network or missing fetch is diagnosable instead of
  // looking like a spawn problem.
  let lastFfmpegDownloadError = null;

  // Active transcode-job progress, keyed by abs|fps, polled by the picker's
  // progress bar via GET /transcode-progress/<token>?fps=N:
  //   phase 'download'  — bytes/total (content-length when the mirror sends it)
  //   phase 'transcode' — output-file growth (see runFfmpegTranscode)
  //   phase 'done'      — cached file is ready to serve
  //   phase 'error'     — the job failed (client falls back to the original)
  // Per-JOB entries (not a single global slot), so rotation can run several
  // transcodes in parallel and each wallpaper still sees its own progress.
  const transcodeJobs = new Map();
  const TRANSCODE_JOBS_MAX = 64;
  function setTranscodeJob(job) {
    transcodeJobs.set(job.key, job);
    if (transcodeJobs.size > TRANSCODE_JOBS_MAX) {
      const first = transcodeJobs.keys().next().value;
      if (first !== undefined) transcodeJobs.delete(first);
    }
  }

  // Download sources, raced in parallel (first success wins — the fastest mirror
  // for THIS user wins automatically, no region pre-sorting):
  //   npmmirror  — fast for CN users (validated ~2 min for the 70MB binary)
  //   GitHub     — fast for everyone else
  // `DSH_WE_FFMPEG_URL` replaces the list (user-chosen mirror / self-hosted).
  function ffmpegDownloadUrls(asset) {
    const env = process.env.DSH_WE_FFMPEG_URL && process.env.DSH_WE_FFMPEG_URL.trim();
    if (env) return [env];
    return [
      'https://registry.npmmirror.com/-/binary/ffmpeg-static/' + FFMPEG_STATIC_TAG + '/' + asset,
      'https://github.com/eugeneware/ffmpeg-static/releases/download/' + FFMPEG_STATIC_TAG + '/' + asset,
    ];
  }

  // Stream one source to its .part file (visible progress on disk, no 70MB
  // in-memory buffer), computing a streaming sha256. The caller owns the abort
  // signal (per-source timeout / loser cancellation).
  async function downloadFfmpegToFile(url, tmp, ctrl, job) {
    const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': 'dsh-wallpaper-engine' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (!res.body) throw new Error('no response body');
    const reader = res.body.getReader();
    const fd = openSync(tmp, 'w');
    let total = 0;
    const totalBytes = Number(res.headers.get('content-length')) || 0;
    if (job && job.phase === 'download') {
      job.total = totalBytes;
      job.source = url;
    }
    const hash = createHash('sha256');
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.length) {
          let off = 0;
          while (off < value.length) {
            off += writeSync(fd, value, off, value.length - off);
          }
          hash.update(value);
          total += value.length;
          if (job && job.phase === 'download') {
            job.downloaded = total;
          }
        }
      }
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (total < 20 * 1024 * 1024) throw new Error('implausible size ' + total);
    const head = Buffer.alloc(8);
    const rfd = openSync(tmp, 'r');
    try {
      let got = 0;
      while (got < 8) { const n = readSync(rfd, head, got, 8 - got, got); if (n <= 0) break; got += n; }
    } finally {
      closeSync(rfd);
    }
    if (!ffmpegMagicOk(head)) throw new Error('unrecognized binary magic');
    return { total, sha256: hash.digest('hex') };
  }

  async function ensureDownloadedFfmpeg(job) {
    const target = join(ffmpegDataDir(), ffmpegExeName());
    if (existsSync(target)) return target;
    const assets = FFMPEG_STATIC_ASSETS[process.platform];
    const asset = assets && assets[process.arch];
    if (!asset) {
      lastFfmpegDownloadError = 'unsupported platform ' + process.platform + '/' + process.arch;
      return null;
    }
    if (typeof fetch !== 'function') {
      lastFfmpegDownloadError = 'fetch unavailable (Node < 18?)';
      return null;
    }
    if (ffmpegDownloadPromise) return ffmpegDownloadPromise;
    ffmpegDownloadPromise = (async () => {
      const urls = ffmpegDownloadUrls(asset);
      const ctrls = urls.map(() => new AbortController());
      const tmpFiles = urls.map((u, i) => target + '.part' + i);
      const timers = ctrls.map((c) => setTimeout(() => c.abort(), 5 * 60 * 1000));
      const errors = [];
      const cleanup = () => timers.forEach(clearTimeout);
      const win = await new Promise((resolve) => {
        let done = false;
        let remaining = urls.length;
        urls.forEach((url, i) => {
          downloadFfmpegToFile(url, tmpFiles[i], ctrls[i], job)
            .then((r) => {
              if (done) return;
              const want = FFMPEG_STATIC_SHA256[asset];
              if (want && r.sha256 !== want) {
                errors.push(url + ' → sha256 mismatch');
                try { unlinkSync(tmpFiles[i]); } catch { /* ignore */ }
                remaining--; if (remaining === 0) { done = true; resolve(-1); }
                return;
              }
              done = true;
              resolve(i);
            })
            .catch((err) => {
              if (done) return;
              errors.push(url + ' → ' + String(err && err.message ? err.message : err));
              remaining--; if (remaining === 0) { done = true; resolve(-1); }
            });
        });
      });
      cleanup();
      if (win < 0) {
        try { tmpFiles.forEach((f) => { try { unlinkSync(f); } catch { /* ignore */ } }); } catch { /* ignore */ }
        lastFfmpegDownloadError = errors.join('; ') || 'all sources failed';
        return null;
      }
      for (let i = 0; i < ctrls.length; i++) {
        if (i !== win) {
          ctrls[i].abort();
          try { unlinkSync(tmpFiles[i]); } catch { /* ignore */ }
        }
      }
      if (process.platform !== 'win32') { try { chmodSync(tmpFiles[win], 0o755); } catch { /* ignore */ } }
      renameSync(tmpFiles[win], target);
      lastFfmpegDownloadError = null;
      return target;
    })().catch((err) => {
      lastFfmpegDownloadError = 'download internal error: ' + String(err && err.message ? err.message : err);
      return null;
    }).finally(() => {
      ffmpegDownloadPromise = null;
    });
    return ffmpegDownloadPromise;
  }

  // Async resolution chain (the C level may download on first use).
  async function resolveFfmpeg(job) {
    if (process.env.DSH_WE_FFMPEG && process.env.DSH_WE_FFMPEG.trim()) {
      return process.env.DSH_WE_FFMPEG.trim();
    }
    try {
      const local = join(pluginRoot, 'ffmpeg', ffmpegExeName());
      if (existsSync(local)) return local;
    } catch { /* ignore */ }
    const dl = await ensureDownloadedFfmpeg(job);
    if (dl) return dl;
    return ffmpegExeName(); // system PATH
  }

  // Spawn ffmpeg for the (potentially long) background transcode. The dsh web
  // process runs in a constrained spawn context (observed: console-app children
  // dying at startup with 0xFFFFFFEA = -22, and piped stdio failing with EPERM).
  // We therefore: (1) never use pipes — stderr is redirected to a temp FILE so
  // its content survives into the 502 detail; (2) try, in order: a detached
  // process group (own hidden console), then a plain direct spawn; (3) keep
  // EVERY attempt's error so the final message shows the full picture.
  // `timeoutMs` is the per-attempt budget handed down from the JOB deadline
  // (runFfmpegTranscode computes it as the remaining time, so all encoder
  // attempts share one 15min wall-clock budget instead of 15min each).
  // opts.signal (AbortSignal) additionally cancels the running ffmpeg (client
  // disconnect / wallpaper switch).
  /** @returns {Promise<void>} 子进程正常退出（code 0）⇒ resolve(void)；失败/超时 ⇒ reject */
  function spawnFfmpeg(ff, args, timeoutMs, opts = {}) {
    const limit = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : TRANSCODE_TIMEOUT_MS;
    const signal = (opts && opts.signal) || null;
    return new Promise((resolve, reject) => {
      const errLog = join(ensureTranscodeCacheDir(), 'ffmpeg-err-' + process.pid + '-' + Date.now() + '.log');
      const attempts = [
        { name: 'detached', opts: { detached: true, windowsHide: true } },
        { name: 'plain', opts: { windowsHide: true } },
      ];
      let idx = 0;
      let curProc = null;
      const onAbort = () => {
        if (curProc && curProc.pid !== undefined) { try { curProc.kill(); } catch { /* ignore */ } }
      };
      // 监听器无条件挂一次 (不能因 signal.aborted 为真就 return): abort 已在
      // 「检查」与「spawn」之间发生时, 第二次尝试会 spawn 出一个没有任何 abort 监听
      // 的子进程 —— 无人取消, 它就一直编码到超时。abort 后再挂监听不会触发,
      // 由下面的 spawn 后复查兜底。
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      const errors = [];
      const runNext = () => {
        if (idx >= attempts.length) {
          if (signal) signal.removeEventListener('abort', onAbort);
          let detail = errors.join('; ');
          try {
            const t = readFileSync(errLog, 'utf8').trim();
            if (t) detail += ' | stderr: ' + t.split('\n').slice(-4).join(' | ');
          } catch { /* ignore */ }
          try { unlinkSync(errLog); } catch { /* ignore */ }
          reject(new Error('ffmpeg spawn failed' + (detail ? ': ' + detail : '')));
          return;
        }
        const a = attempts[idx++];
        let errFd = null;
        try { errFd = openSync(errLog, 'w'); } catch { /* ignore */ }
        let proc = null;
        try {
          // cwd: Windows 用 SystemRoot (console-app 启动稳定性, 见上方注释);
          // 非 Windows 必须给真实存在的目录 — 回退 'C:\\' 在 Linux/macOS 上不存在
          // → spawn ENOENT → ffmpeg 必然启动失败（cwd 必须是真实存在的目录）。
          const spawnCwd = process.env.SystemRoot
            || (process.platform === 'win32' ? 'C:\\' : undefined);
          proc = spawn(a.file || ff, a.args || args,
            { ...a.opts, cwd: spawnCwd, stdio: errFd ? ['ignore', 'ignore', errFd] : 'ignore' });
        } catch (err) {
          if (errFd) { try { closeSync(errFd); } catch { /* ignore */ } }
          errors.push(a.name + ' spawn throw ' + (err && err.code ? err.code : err));
          runNext();
          return;
        }
        curProc = proc;
        // Track the child so a job deadline (see TRANSCODE_TIMEOUT_MS) can kill it
        // even while it is detached / mid-encode.
        ACTIVE_FFMPEG.add(proc);
        // spawn 与上面的 signal 检查之间的 abort 竞态: 此时 onAbort 早已返回
        // (curProc 还是 null), 该子进程不会收到任何取消 → 刚起的进程立刻杀掉并
        // 结束整个尝试链 (不 spawn 第二次), 避免切换壁纸后它继续编码到超时。
        if (signal && signal.aborted) {
          if (proc.pid !== undefined) { try { proc.kill(); } catch { /* ignore */ } }
          ACTIVE_FFMPEG.delete(proc);
          curProc = null;
          if (errFd) { try { closeSync(errFd); } catch { /* ignore */ } }
          signal.removeEventListener('abort', onAbort);
          try { unlinkSync(errLog); } catch { /* ignore */ }
          reject(new Error('ffmpeg aborted'));
          return;
        }
        let done = false;
        let timedOut = false;
        const settle = (msg) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          ACTIVE_FFMPEG.delete(proc);
          if (curProc === proc) curProc = null;
          if (errFd) { try { closeSync(errFd); } catch { /* ignore */ } }
          errors.push(msg);
          runNext();
        };
        const timer = setTimeout(() => {
          timedOut = true;
          if (proc.pid !== undefined) { try { proc.kill(); } catch { /* ignore */ } }
          settle(a.name + ' timed out after ' + limit + 'ms');
        }, limit);
        proc.on('error', (err) => {
          // 收窄：`child_process` 的 'error' 监听形参在声明里是 `Error`，而真实抛出的是 errno
          // 异常（带 `code`）—— 不这么写，IDE 的 TS 会判 `类型"Error"上不存在属性"code"`。
          const e = /** @type {NodeJS.ErrnoException} */ (err);
          settle(a.name + ' spawn error ' + (e && e.code ? e.code + ' ' + e.message : e));
        });
        proc.on('exit', (code) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          ACTIVE_FFMPEG.delete(proc);
          if (curProc === proc) curProc = null;
          if (errFd) { try { closeSync(errFd); } catch { /* ignore */ } }
          if (code === 0) {
            try { unlinkSync(errLog); } catch { /* ignore */ }
            if (signal) signal.removeEventListener('abort', onAbort);
            resolve();
            return;
          }
          errors.push(a.name + ' exit ' + code + (timedOut ? ' (killed by timeout)' : ''));
          runNext();
        });
      };
      runNext();
    });
  }

  async function runFfmpegTranscode(abs, out, fps, signal) {
    const key = abs + '|' + fps;
    // Download phase: resolveFfmpeg may lazy-download ffmpeg (bytes/total).
    const job = { key, phase: 'download', downloaded: 0, total: 0, source: '' };
    setTranscodeJob(job);
    const ff = await resolveFfmpeg(job);
    const mi = getMediaInfo(abs);
    // Real-time progress source: ffmpeg's `-progress FILE` output is BUFFERED and
    // invisible until the process exits on this platform, so instead we encode at
    // a fixed bitrate (size ∝ time) and derive percent/ETA from the OUTPUT FILE
    // size, which the muxer grows continuously. Bitrate scales with resolution.
    const pixels = mi && mi.width && mi.height ? mi.width * mi.height : 3840 * 2160;
    const bitrate = Math.round(Math.min(20e6, Math.max(4e6, 20e6 * pixels / (3840 * 2160))));
    job.phase = 'transcode';
    job.downloaded = 0;
    job.total = 0;
    job.source = ff;
    job.outFile = out;
    job.expectedBytes = mi && mi.duration ? Math.round((bitrate / 8) * mi.duration) : null;
    job.samples = []; // [{t, size}] rolling samples for growth-rate / ETA
    const base = ['-y', '-hide_banner', '-loglevel', 'error', '-i', abs,
      '-map', '0:v:0', '-an',
      '-vf', 'fps=' + String(fps), '-g', String(fps * 2)];
    // ★ 质量参数必须**按编码器**给：`-preset p1` 是 NVENC 专属，软件编码器会直接报
    //   `x264 [error]: invalid preset 'p1'` ⇒ 光把 -c:v 换成 libx264 也是死。
    //   自动下载的 ffmpeg-static（johnvansickle）**不含 NVENC**（`-encoders` 里没有
    //   h264_nvenc/av1_nvenc），所以在没有系统 ffmpeg 的机器上，软件兜底是唯一出路。
    const ENC_TUNE = {
      av1_nvenc: ['-preset', 'p1', '-b:v', String(bitrate), '-maxrate', String(bitrate), '-bufsize', String(bitrate * 2)],
      h264_nvenc: ['-preset', 'p1', '-b:v', String(bitrate), '-maxrate', String(bitrate), '-bufsize', String(bitrate * 2)],
      // 软件兜底：capped CRF（不叠 -b:v，避免与 crf 语义打架）。一次性缓存，慢一点可接受。
      libx264: ['-preset', 'veryfast', '-crf', '20'],
    };
    // 输出时长限制: 部分源视频容器帧率信息异常 (实测 100k fps/100k tbn),
    // 这种输入下 `-r fps` 纠正不了 → ffmpeg 按输入帧率解码并大量复制帧 (5 万帧)
    // 卡死 + 长时间占满 CPU。fps 滤镜做正确 CFR 采样 + -t 限制输出时长。
    if (mi && mi.duration && isFinite(mi.duration) && mi.duration > 0) {
      base.push('-t', String(mi.duration));
    }
    // 整个任务所有编码尝试共享一个 deadline（见 TRANSCODE_TIMEOUT_MS 注释）：
    // 每次 spawn 只拿到剩余预算，避免「每种编码器各 15 分钟」的预算重计。
    const deadline = Date.now() + TRANSCODE_TIMEOUT_MS;
    let lastErr = null;
    // 顺序：AV1(NVENC) → H.264(NVENC) → **软件兜底 libx264**。
    // 兜底这一档保证没有 NVENC 的 ffmpeg 也能出片（否则功能全关）。
    for (const enc of ['av1_nvenc', 'h264_nvenc', 'libx264']) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        lastErr = new Error('transcode deadline exceeded (' + TRANSCODE_TIMEOUT_MS + 'ms total)');
        break;
      }
      try {
        // -f mp4 is REQUIRED: the temp output path ends in ".tmp<pid>", which
        // ffmpeg cannot map to a muxer by extension (it exits -22 on that).
        // `+faststart` 把 moov 挪到文件头：这几张源实测 moov 在**尾部**
        //（moovStart≈EOF，见 probeMp4），播放器要先把尾巴取回来才能开始解复用 ——
        // 产物若同样把 moov 留在尾部，就等于把这笔成本原样交给下一次播放。
        const tune = ENC_TUNE[enc] || [];
        await spawnFfmpeg(ff, [...base, ...tune, '-c:v', enc, '-movflags', '+faststart', '-f', 'mp4', out],
          remaining, { signal });
        return;
      } catch (err) {
        lastErr = err; // try the next encoder (e.g. AV1 encode unsupported)
      }
    }
    throw new Error('ffmpeg transcode failed (ff=' + ff + ')'
      + (lastErr ? ': ' + lastErr.message : '')
      + (lastFfmpegDownloadError ? ' | download: ' + lastFfmpegDownloadError : ''));
  }

  /**
   * 抽帧缓存的**键**：`abs | round(mtimeMs) | fps` 的 sha256 前 20 位（纯函数）。
   * 转码（写）与"这个上限有没有缓存"（读）必须共用它 —— 两处各算一份就会漂移，
   * 而漂移的症状是"客户端被告知有缓存、请求却打不中"（或反过来：永远轮不到缓存）。
   */
  function transcodeCacheKey(abs, mtimeMs, fps) {
    return createHash('sha256')
      .update(abs + '|' + Math.round(mtimeMs) + '|' + fps)
      .digest('hex').slice(0, 20);
  }

  /**
   * 只读地问"这个 (源, 上限) 的抽帧版在不在盘上" —— **绝不转码、绝不建目录**。
   *
   * 用途：`/media-info?fps=` 把它答给客户端，客户端于是能在**建层之前**就知道该用
   * 抽帧版当 `src`（见 src/video-layer.js 的 refreshMediaInfo / buildVideoMedia），
   * 不必"先取原片、再等探针回来换源"。源文件不可 stat（已删/无权限）⇒ null（当作没缓存）。
   */
  function transcodeCachePathFor(abs, fps) {
    /** @type {import('node:fs').Stats} */
    let st;
    try { st = statSync(abs); } catch { return null; }
    return join(transcodeCacheDir(), 'tc_' + transcodeCacheKey(abs, st.mtimeMs, fps) + '.mp4');
  }

  /** Transcode to <fps> with a disk cache keyed by abs-path + mtime + fps. */
  function transcodeToFps(abs, fps, onEntry) {
    const st = statSync(abs);
    const key = transcodeCacheKey(abs, st.mtimeMs, fps);
    const cachePath = join(ensureTranscodeCacheDir(), 'tc_' + key + '.mp4');
    if (existsSync(cachePath)) return Promise.resolve(cachePath);
    let entry = TRANSCODE_INFLIGHT.get(cachePath);
    if (entry) {
      // 在途命中：加入者也要过 onEntry（路由在它里面 registerTranscodeWaiter）。
      // 直接 `return entry.promise` 会让加入者永远进不了账本 ⇒ waiters 只算发起者一个
      // ⇒ 发起者一断开就 cancel（kill ffmpeg + 删 tmp），而仍在等的其他客户端拿到 502。
      // 账本语义（见 registerTranscodeWaiter）本来就是「**所有**等待者断开才 cancel」。
      if (typeof onEntry === 'function') onEntry(entry);
      return entry.promise;
    }
    // 取消: 所有等待者断开 (切换壁纸) 时终止转码 — kill ffmpeg 释放 CPU + 删 tmp
    // (没有这条取消, 卡死的转码要等 15 分钟硬超时才被杀, 期间占满 CPU)
    const ctrl = new AbortController();
    // ⚠️ 临时名必须**每次调用唯一**（`atomicTmpPath` = `.tmp<pid><递增序号>`），且在**开跑之前**
    // 就定下来，好让 `cancel()` 与任务体共用同一个路径。
    // 若用同一个确定性名（如 `cachePath + '.tmp' + pid`）会有一处"删兄弟产物"的静默缺陷：
    // `cancel()` 会立刻把条目从 `TRANSCODE_INFLIGHT` 删掉 ⇒ 新任务能在旧任务收尾**之前**用同一
    // 路径开跑，而旧任务 `catch` 里那句 `unlinkSync(tmp)` 删掉的正是**新任务正在写的产物**。
    const tmp = atomicTmpPath(cachePath);
    const cancel = () => {
      if (ctrl.signal.aborted) return;
      ctrl.abort();
      try { unlinkSync(tmp); } catch { /* ignore */ }
      TRANSCODE_INFLIGHT.delete(cachePath);
    };
    const p = (async () => {
      const progKey = abs + '|' + fps;
      // 并发闸：排队等待期间 deadline 未启动（deadline 在 runFfmpegTranscode
      // 内、拿到闸之后才开始计时）。
      await acquireTranscodeSlot();
      try {
        await runFfmpegTranscode(abs, tmp, fps, ctrl.signal);
        renameSync(tmp, cachePath);
        const job = transcodeJobs.get(progKey);
        if (job) job.phase = 'done';
        return cachePath;
      } catch (err) {
        try { unlinkSync(tmp); } catch { /* ignore */ }
        const job = transcodeJobs.get(progKey);
        if (job) job.phase = 'error';
        throw err; // surface the real ffmpeg error in the route's 502 detail
      } finally {
        releaseTranscodeSlot();
        if (TRANSCODE_INFLIGHT.get(cachePath) === entry) TRANSCODE_INFLIGHT.delete(cachePath);
      }
    })();
    entry = { promise: p, waiters: 0, cancel };
    TRANSCODE_INFLIGHT.set(cachePath, entry);
    if (typeof onEntry === 'function') onEntry(entry);
    return entry.promise;
  }

  // transcode 请求等待者注册: 路由 res close 时调用, 全部断开 → 取消转码
  function registerTranscodeWaiter(entry, res) {
    if (!entry) return;
    entry.waiters++;
    const onClose = () => {
      entry.waiters--;
      if (entry.waiters <= 0) entry.cancel();
    };
    res.once('close', onClose);
  }

  // ── 门面接口面（其余全是族内私有）──────────────────────────────────────────
  // 门面在模块作用域同名解构，所以那边所有调用点逐字未变。
  return {
    ensureDirOnce,
    transcodeCacheDir,
    sweepTranscodeArtifacts,
    sweepCustomFrameTmp,
    resolveFfmpeg,
    spawnFfmpeg,
    transcodeToFps,
    registerTranscodeWaiter,
    transcodeCachePathFor,
    transcodeJobs,

    /** 卸载收尾（门面 fiber disposer 调用）；逐条理由注释与原 lib/index.js 的 disposer 相同。 */
    dispose() {
      // 目录创建记忆化 (ensureDirOnce) 只对本次 apply 的路径有意义, 卸载后同一
      // 模块实例可能被再次 apply 且路径不同 → 清空, 避免 Set 无界增长。
      ensuredDirs.clear();
      // 杀掉所有在途 ffmpeg 子进程：插件卸载 / HMR 后宿主再无权管理它们，
      // 不杀就是孤儿进程继续吃 CPU/GPU（detached 模式下尤甚）。它们写一半
      // 的 .tmp<pid> 输出留给下次 apply 的 sweepTranscodeArtifacts 清理。
      for (const proc of ACTIVE_FFMPEG) {
        if (proc.pid !== undefined) { try { proc.kill(); } catch { /* ignore */ } }
      }
      ACTIVE_FFMPEG.clear();
      // 在途转码任务置 error：正在轮询 transcode-progress 的客户端立刻看到
      // 失败并回退原始文件，而不是等一个永远不会 done 的任务。
      for (const job of transcodeJobs.values()) {
        if (job.phase === 'download' || job.phase === 'transcode') job.phase = 'error';
      }
      // 在途 Promise 本身无法取消，但其 finally 的 delete 对空 Map 是 no-op；
      // 清空后新 apply 的同名任务不会被旧的 inflight 条目误命中。
      TRANSCODE_INFLIGHT.clear();
    },
  };
}
