/**
 * supervisor.js — media-bridge 子进程的守护与协议客户端（宿主侧）。
 *
 * 传输用 **stdio NDJSON**（`media-bridge serve`），不用它的 HTTP 服务：端口分配、
 * 防火墙、孤儿进程都不用管，stdin 一关子进程就干净退出；中间件的 HTTP 面默认
 * CORS `*` 且没有插件路由那道能力头栅栏，对「本机任意进程/页面都能读你在放什么、
 * 还能反向控制」这件事没有必要，不启用。
 *
 * 职责边界（对上层只暴露 legacy 那套同名 API，见 lib/media/index.js）：
 *   - spawn / 握手（校验 `hello.protocol`）/ 订阅事件 / 退避重启 / 空闲停进程
 *   - 把事件流维护成**快照缓存**，`nowPlaying()` / `spectrum()` 只读缓存
 *     —— 消费端不轮询中间件（它自己的 1s 基线轮询 + 控制后突发窗口才是权威）
 *   - 位置外推：快照里的 `positionMs` 是「上报时刻」的值，读的时候按
 *     `positionMs + (now - refMs) * rate` 外推（暂停/停止不外推）
 *
 * 协议约定（media-bridge docs/PROTOCOL.md）：**有 `ok` 是响应、有 `event` 是事件**，
 * 事件会插在任意两条响应之间 —— 所以绝不能用「下一行就是我的响应」这种读法。
 */
import { spawn } from 'node:child_process';

/** 支持的协议版本（`hello.protocol`）；不匹配就回落 legacy，不做猜测性兼容。 */
const PROTOCOL_VERSION = 1;
const BANDS = 64;
/** 频谱推送间隔：与客户端 50ms 拉取节奏对齐。 */
const SPECTRUM_INTERVAL_MS = 50;
const CALL_TIMEOUT_MS = 8000;
/**
 * 引导阶段的超时放宽：刚下载下来的二进制第一次执行时，macOS 会先做一遍安全
 * 检查（实测首次启动可慢到数秒），这段时间里 hello 还没回来是正常的，不该
 * 因此判定「中间件起不来」而回落。
 */
const BOOT_CALL_TIMEOUT_MS = 25000;
const SPAWN_TIMEOUT_MS = 15000;
/**
 * 引导预算的**逐次读取**覆盖（`DSH_WE_MEDIA_BOOT_MS`，毫秒，下限 1000）。
 * 为什么是一个函数而不是顶层常量：顶层常量在 **import 时**就冻结了，调用方
 * （`test/verify-media-bridge.mjs`）在 import 之后才设 env ⇒ 覆盖会静默失效
 * ——同文件的 `IDLE_STOP_MS` 就是这个形状（顶层常量，同样读不到 import 后设的 env）。
 * 为什么需要这个旋钮：CI runner 上**首次执行**一个刚下载的 7MB 二进制可能远超
 * 25s（实测 `verify:bridge` 在 windows-latest 上 25s 拿不到 `hello`，而同一个
 * 产物在同一套参数下在本机 <25s 就绪）。现场默认值**不动**——把"冷启动慢"与
 * "真的起不来"分开，靠的是一个显式旋钮，而不是把现场的回落延迟一起调大。
 */
function bootCallTimeoutMs() {
  const raw = process.env.DSH_WE_MEDIA_BOOT_MS;
  if (raw === undefined || raw === '') return BOOT_CALL_TIMEOUT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1000 ? n : BOOT_CALL_TIMEOUT_MS;
}

const KILL_GRACE_MS = 3000;
/** 崩溃重启预算：窗口内超过这个次数就判定为「跑不起来」，回落 legacy。 */
const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 5 * 60 * 1000;
/**
 * 空闲停进程：没有任何取数请求这么久就退出（下次访问再自动拉起）。
 * 壁纸实时渲染时客户端 50ms 拉一次，永不触发；没在用的时候不该白占一个
 * 20MB 进程 + 一路系统音频采集。0 = 不停。DSH_WE_MEDIA_IDLE_MS 可覆盖。
 */
/** 状态缓存的兜底刷新间隔：中间件只在「元数据源出错」时推 status 事件，音频源
 *  idle→preparing→running 的变化不主动通知（v0.1.3 实测；已在 v0.1.4 补事件）。
 *  这里定期重问一次，避免消费端一直看到过期的 preparing —— 症状是频谱明明有数据、
 *  客户端却因为 `running===false` 不把音频交给壁纸。 */
const STATUS_REFRESH_MS = 5000;

const IDLE_STOP_MS = (() => {
  const raw = process.env.DSH_WE_MEDIA_IDLE_MS;
  if (raw === undefined || raw === '') return 15 * 60 * 1000;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 15 * 60 * 1000;
})();

/** 播放态 → 旧 wire 的数值约定（0 停止 / 1 播放 / 2 暂停）。 */
function stateCode(state) {
  if (state === 'playing') return 1;
  if (state === 'paused') return 2;
  return 0;
}

/**
 * 宿主动作名 → 中间件的 `control` action。**白名单就是闸门**：
 * `/media-control` 是开放的 HTTP 入口，调用方给的字符串不得直达中间件
 * （协议里还有 seek / set-loop / toggle-shuffle 这类本插件不暴露的动作）。
 * 键与渲染页的媒体控制面五个方法同名（play/pause/playPause/skipNext/skipPrevious）
 * —— 壁纸里的播放按钮推断出动作名后，经它原样落到这里。
 */
export const MEDIA_CONTROL_ACTIONS = {
  play: 'play',
  pause: 'pause',
  playPause: 'play-pause',
  skipNext: 'next',
  skipPrevious: 'previous',
};

/** 控制命令的响应窗口：中间件发命令后会睡一小拍再回读状态（<250ms），5s 足够。 */
const CONTROL_TIMEOUT_MS = 5000;

/**
 * 中间件歌词 → 渲染页要的 `[[秒, 文本], …]`。
 *
 * 渲染页的 `xd()`/`jA()` 只认这种元组数组（自己按 position 找当前行），而中间件给
 * 的是 `{ lines: [{ tMs, text }], offsetMs }`：这里做单位换算（ms → 秒）并叠加 LRC
 * 头部的 `[offset:]`（正值 = 歌词整体晚出现）。导出成纯函数是为了自检能直接用
 * 样例数据验证换算（真歌词要靠真实播放器，mock provider 不给歌词）。
 */
export function lyricsToTuples(lyr) {
  if (!lyr || !Array.isArray(lyr.lines) || !lyr.lines.length) return null;
  const off = Number(lyr.offsetMs) || 0;
  const out = [];
  for (const ln of lyr.lines) {
    const raw = ln && ln.tMs;
    // 只认「数字 / 能解析成数字的字符串」；null 会被 Number() 变成 0 混进来
    // （那会让一行歌词跑到 0 秒上），所以先按类型挡掉。
    if (raw === null || raw === undefined || typeof raw === 'boolean' || typeof raw === 'object') continue;
    const ms = Number(raw);
    if (!Number.isFinite(ms)) continue;
    out.push([Math.max(0, (ms + off) / 1000), String(ln.text == null ? '' : ln.text)]);
  }
  return out.length ? out : null;
}

/**
 * 中间件的完整命令行（宿主设置 → 开关）。**纯函数、单一真源**：守护侧与自检的
 * "不经过管道"探针（`verify-media-bridge` 的文件探针）必须用同一套参数，否则探针失败
 * 分不清是环境问题还是参数漂移。
 */
export function bridgeServeArgs({ cacheDir = '', audio = true, online = false, mock = false, verbose = false } = {}) {
  const args = ['serve', '--cache-dir', String(cacheDir), '--poll-ms', '1000'];
  if (!audio) args.push('--no-audio');              // 音频关但元数据要：连授权都不会弹
  args.push(online ? '--online' : '--no-online');
  if (mock) args.push('--provider', 'mock');
  if (verbose) args.push('--verbose');
  return args;
}

/**
 * 造中间件守护器（依赖全可注入：单测 / 探针）。
 *
 * @param {object} o
 * @param {string} o.binPath 中间件可执行文件路径（`provisionMediaBridge()` 的产物）。
 * @param {string} o.cacheDir 中间件运行时缓存目录（`--cache-dir`）。
 * @param {import('../log.js').LogCall} [o.log] 日志被调用面（`log(msg, level?)`）；缺省空实现。
 * @param {(name:string, data?:any) => void} [o.diag] 诊断上报（宿主注入 `appendDiagLine` 包装）。
 * @param {((why:string) => void)|null} [o.onFatal] 连续崩溃超预算时的回调（门面据此回落内置实现）。
 */
export function createBridgeSupervisor({ binPath, cacheDir, log = () => {}, diag = () => {}, onFatal = null }) {
  let child = null;
  let buf = '';
  let seq = 0;
  const pending = new Map();
  const optsRef = { audio: true, online: false, mock: false };
  const lyricsMemo = { key: '', value: null };

  let started = false;
  let stopping = false;
  let booted = false;        // hello/subscribe/now 已走通
  let asleep = false;        // 空闲停过，下次取数自动唤醒
  let fatal = '';            // 非空 = 不再重启（上层据此回落 legacy）
  let info = null;           // hello 的结果
  let snap = null;           // { hasMedia, track, playback, capabilities }
  let art = { path: '', mime: '' };
  let spectrum = new Uint8Array(BANDS);
  let sources = [];
  let lastError = '';
  let lastStderr = '';
  // 子进程 stdout 上**非协议**输出的第一行（横幅 / 用法 / 报错文本都可能走 stdout）。
  // 为什么值得留：引导失败的典型形态是「进程活着、stderr 为空、hello 不回」——那种现场里
  // stdout 是唯一还可能说话的一条流 —— 不留住它，引导失败时就只剩一句「hello 超时」无从下手。
  let lastStdout = '';
  // 实际用上的 spawn 姿势（windows 上先试 detached 再试 plain）：失败行里必须能看出用的是哪种，
  // 否则「同一份产物在本机就绪、在别的环境不吭声」永远分不清是姿势差异还是产物差异。
  let spawnVia = '';
  let lastUsedAt = Date.now();
  let lastStatusAt = 0;
  let statusRefreshing = false;
  const restartAt = [];
  let restartTimer = null;
  let idleTimer = null;
  let booting = null;

  // ── 协议收发 ───────────────────────────────────────────────────────────────
  function onLine(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    if (msg.event) { onEvent(msg); return; }
    if (msg.id !== undefined && msg.id !== null && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error((msg.error && (msg.error.code + ': ' + msg.error.message)) || '协议错误'));
    }
  }

  function onEvent(ev) {
    const ts = Number(ev.tsMs) || Date.now();
    switch (ev.event) {
      // 事件顺序有保证：track → playback → artwork。
      case 'track':
      case 'playback':
        if (ev.now) applySnapshot(ev.now, ts);
        break;
      case 'artwork':
        if (ev.artwork) {
          art = { path: String(ev.artwork.path || ''), mime: String(ev.artwork.mime || '') };
          if (snap && snap.track) snap.track.artwork = ev.artwork;
          diag('media-artwork', { mime: art.mime, bytes: Number(ev.artwork.bytes) || 0 });
        }
        break;
      case 'lyrics':
        // 歌词可能晚几秒（在线查询）；只认当前曲目，避免把上一首的歌词贴过来。
        if (snap && snap.track) {
          const cur = snap.track.id;
          if (!ev.trackId || !cur || ev.trackId === cur) snap.track.lyrics = ev.lyrics || null;
        }
        lyricsMemo.key = '';
        break;
      case 'status':
        if (ev.status && Array.isArray(ev.status.sources)) sources = ev.status.sources;
        break;
      case 'spectrum':
        if (ev.frame && Array.isArray(ev.frame.bands)) frameToSpectrum(ev.frame.bands);
        break;
      case 'error':
        lastError = String(ev.message || ev.code || '未知错误');
        log('中间件报错：' + lastError, 'warn');
        diag('media-error', { source: ev.source || '', code: ev.code || '', message: lastError.slice(0, 200) });
        break;
      default:
        break;
    }
  }

  function frameToSpectrum(bands) {
    const out = new Uint8Array(BANDS);
    const n = Math.min(BANDS, bands.length);
    for (let i = 0; i < n; i++) {
      const v = Number(bands[i]);
      out[i] = Number.isFinite(v) ? Math.max(0, Math.min(255, Math.round(v))) : 0;
    }
    spectrum = out;
  }

  /**
   * 归一化快照。事件载荷里的位置是**已经外推到事件时刻**的值
   * （`snapshot_at_now()`，positionSource=interpolated），而 updatedAtMs 仍是轮询
   * 时刻 —— 直接拿它再外推会重复计时。这里把参考时刻改写成事件时刻，之后所有读取
   * 都走同一条外推公式。
   */
  function applySnapshot(now, refMs) {
    snap = now;
    const pb = snap && snap.playback;
    if (pb && pb.positionSource === 'interpolated' && refMs) pb.updatedAtMs = refMs;
    const a = snap && snap.track && snap.track.artwork;
    if (a && a.path) art = { path: String(a.path), mime: String(a.mime || '') };
    lyricsMemo.key = '';
  }

  function call(method, params = {}, timeoutMs = CALL_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      if (!child || !child.stdin || child.stdin.destroyed) { reject(new Error('中间件未运行')); return; }
      const id = ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(method + ' 超时'));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try {
        child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
      } catch (err) {
        clearTimeout(timer);
        pending.delete(id);
        reject(err);
      }
    });
  }

  function drainPending(err) {
    for (const [, p] of pending) { clearTimeout(p.timer); try { p.reject(err); } catch { /* ignore */ } }
    pending.clear();
  }

  // ── 进程生命周期 ───────────────────────────────────────────────────────────
  /** 命令行：把宿主设置翻译成中间件开关（真源是导出的 `bridgeServeArgs`）。 */
  function childArgs() {
    return bridgeServeArgs({
      cacheDir,
      audio: optsRef.audio,
      online: optsRef.online,
      mock: optsRef.mock,
      verbose: process.env.DSH_WE_MEDIA_DEBUG === '1',
    });
  }

  /**
   * 杀掉一个可能**还没真正 spawn 出来**的子进程。
   *
   * 实测：macOS 首次执行刚下载的二进制时，安全检查会让 'spawn' 事件晚到好几秒；
   * 这时 `awaitSpawn` 超时后立刻 `kill()` 是打在空气上（pid 还没落地），进程随后才
   * 起来并且没人回收 —— 留下一只孤儿（跑完自检后 `pgrep media-bridge` 能看到它）。
   * 所以补一手：无论何时真的 spawn 出来，立刻杀。
   */
  function killWhenSpawned(p) {
    if (!p) return;
    // 判 pid 再 kill：pid 还没落地时 `kill()` 会同步挂死事件循环（不抛，`try/catch` 挡不住）。
    // 这一手本来就是"打在空气上"的兜底 —— 真正的击杀交给下面的 'spawn' 回调（该事件
    // 只在 pid 落地后才触发，形态上无需再判）。
    if (p.pid !== undefined) { try { p.kill('SIGKILL'); } catch { /* 还没起来，走下面那一手 */ } }
    p.once('spawn', () => { try { p.kill('SIGKILL'); } catch { /* ignore */ } });
  }

  /** 等到子进程真的 spawn 出来（或报错）。dsh web 的受限上下文里管道 spawn
   *  失败是以 'error' 事件到达的，不是同步抛异常。
   *  @returns {Promise<void>} 成功即"已 spawn"（无值；失败/超时 reject）。 */
  function awaitSpawn(p) {
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        reject(new Error('spawn 超时'));
      }, SPAWN_TIMEOUT_MS);
      p.once('spawn', () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      });
      p.once('error', (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /** 依次尝试「普通」与「独立进程组」两种 spawn 姿势，错误全留着。 */
  async function spawnChild() {
    // dsh web 的受限 spawn 上下文里出现过「带管道直接 spawn 失败」（ffmpeg 那条
    // 链路踩过），所以两种姿势都试；失败原因写进 diag，别让它看起来像协议问题。
    const attempts = process.platform === 'win32'
      ? [{ name: 'detached', opts: { detached: true, windowsHide: true } }, { name: 'plain', opts: { windowsHide: true } }]
      : [{ name: 'plain', opts: { windowsHide: true } }, { name: 'detached', opts: { detached: true, windowsHide: true } }];
    const errors = [];
    for (const a of attempts) {
      let p = null;
      try {
        p = spawn(binPath, childArgs(), { stdio: ['pipe', 'pipe', 'pipe'], ...a.opts });
        await awaitSpawn(p);
        spawnVia = a.name;
        if (a.name !== attempts[0].name) diag('media-spawn', { via: a.name });
        return p;
      } catch (err) {
        const msg = `${a.name}: ${String(err && err.message ? err.message : err)}`;
        errors.push(msg);
        killWhenSpawned(p);
      }
    }
    throw new Error('无法启动中间件（' + errors.join('; ') + '）');
  }

  function attach(p) {
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.trim()) {
          // 协议行一律以 `{` 开头；第一行不这样的就是子进程自己在说话（诊断用，且只留第一行：
          // 横幅通常只有一行，而后续的协议行没有信息量）。
          if (!lastStdout && line.charCodeAt(0) !== 0x7b) lastStdout = line.slice(0, 200);
          onLine(line);
        }
      }
      if (buf.length > 1 << 20) buf = '';   // 防御：半行堆积不该无限增长
    });
    p.stderr.setEncoding('utf8');
    p.stderr.on('data', (chunk) => {
      const text = String(chunk).trim();
      if (!text) return;
      lastStderr = text.slice(0, 400);
      if (process.env.DSH_WE_MEDIA_DEBUG === '1') log('中间件: ' + lastStderr, 'info');
    });
    p.on('exit', (code, signal) => {
      if (child !== p) return;
      child = null;
      booted = false;
      drainPending(new Error('中间件已退出'));
      if (stopping || asleep) return;
      onUnexpectedExit(code, signal);
    });
  }

  function onUnexpectedExit(code, signal) {
    const now = Date.now();
    restartAt.push(now);
    while (restartAt.length && now - restartAt[0] > RESTART_WINDOW_MS) restartAt.shift();
    const reason = `中间件退出（code ${code}${signal ? ', ' + signal : ''}）${lastStderr ? '：' + lastStderr : ''}`;
    lastError = reason;
    diag('media-exit', { code, signal, restarts: restartAt.length });
    if (restartAt.length > MAX_RESTARTS) {
      fatal = `${reason} —— 连续失败 ${restartAt.length} 次，本次会话改用内置实现`;
      log(fatal, 'warn');
      diag('media-fatal', { reason: fatal.slice(0, 200) });
      if (typeof onFatal === 'function') { try { onFatal(fatal); } catch { /* ignore */ } }
      return;
    }
    const delay = 500 * Math.pow(2, Math.max(0, restartAt.length - 1));
    log(`中间件退出，${delay}ms 后重启（第 ${restartAt.length} 次）`, 'warn');
    restartTimer = setTimeout(() => {
      restartTimer = null;
      startBoot();
    }, delay);
    if (restartTimer.unref) restartTimer.unref();
  }

  /** 拉起并握手（幂等：并发调用共用同一个 promise）。 */
  function startBoot() {
    if (booting) return booting;
    if (stopping || fatal) return Promise.resolve(false);
    booting = (async () => {
      const bootMs = bootCallTimeoutMs();   // 逐次读取：调用方可在 import 之后设 env
      try {
        buf = '';
        const p = await spawnChild();
        child = p;
        asleep = false;
        attach(p);

        const hello = await call('hello', {}, bootMs);
        if (!hello || Number(hello.protocol) !== PROTOCOL_VERSION) {
          throw new Error(`协议版本不匹配（中间件 protocol=${hello && hello.protocol}，本插件支持 ${PROTOCOL_VERSION}）`);
        }
        info = hello;

        const events = ['track', 'playback', 'artwork', 'lyrics', 'status'];
        if (optsRef.audio) events.push('spectrum');
        await call('subscribe', optsRef.audio
          ? { events, intervalMs: SPECTRUM_INTERVAL_MS }
          : { events }, bootMs);

        // 初始快照用 interpolate:false：拿原始轮询值 + updatedAtMs，外推自己做
        //（服务端外推一次、这里再外推一次 = 进度条跑得比歌快）。
        const now = await call('now', { interpolate: false }, bootMs);
        if (now) applySnapshot(now, Date.now());
        try {
          const st = await call('status', {}, bootMs);
          if (st && Array.isArray(st.sources)) sources = st.sources;
        } catch { /* 状态拿不到不影响取数 */ }

        booted = true;
        lastError = '';
        restartAt.length = 0;
        log(`系统媒体中间件就绪：${hello.provider || ''} ${hello.version || ''}（${hello.platform || ''}/${hello.arch || ''}）`
          + (optsRef.audio ? '，含系统音频' : '，仅元数据'), 'info');
        diag('media-ready', {
          version: hello.version, provider: hello.provider, platform: hello.platform,
          arch: hello.arch, audio: optsRef.audio, online: optsRef.online,
        });
        return true;
      } catch (err) {
        lastError = String(err && err.message ? err.message : err);
        // 子进程**自己说的话**必须出现在失败行里：`hello 超时`（起来了但不吭声）与
        // 「起来了、报了错」是两种完全不同的故障 —— 只报一句「hello 超时」时无从下手。
        // 存活位与 spawn 姿势同理：
        // 超时时进程还在 = 不是崩溃而是"没回话"，而姿势决定了这能不能归因到 spawn 方式。
        const alive = Boolean(child);
        const spoke = lastStderr ? '，子进程 stderr：' + lastStderr
          : (lastStdout ? '，子进程 stdout：' + lastStdout : '，子进程两路输出都为空');
        log('中间件启动失败：' + lastError + '（预算 ' + bootMs + 'ms，存活=' + alive
          + '，姿势=' + (spawnVia || '?') + spoke + '）', 'warn');
        diag('media-boot-failed', {
          reason: lastError.slice(0, 200), bin: binPath, budgetMs: bootMs, alive,
          via: spawnVia, stderr: lastStderr.slice(0, 200), stdout: lastStdout.slice(0, 200),
        });
        hardStop();
        return false;
      } finally {
        booting = null;
      }
    })();
    return booting;
  }

  /** 兜底刷新 status（节流；见 STATUS_REFRESH_MS 的说明）。 */
  function refreshStatusSoon() {
    const now = Date.now();
    if (statusRefreshing || now - lastStatusAt < STATUS_REFRESH_MS) return;
    lastStatusAt = now;
    statusRefreshing = true;
    call('status')
      .then((st) => { if (st && Array.isArray(st.sources)) sources = st.sources; })
      .catch(() => { /* 拿不到就保持旧值 */ })
      .finally(() => { statusRefreshing = false; });
  }

  function touch() {
    lastUsedAt = Date.now();
    if (asleep && !fatal && !stopping) {
      asleep = false;
      startBoot();     // 空闲退出后自动唤醒；本次读到的还是旧快照/空谱，几百毫秒后恢复
    }
  }

  function ensureIdleTimer() {
    if (idleTimer || !IDLE_STOP_MS) return;
    idleTimer = setInterval(() => {
      if (stopping || !child) return;
      if (Date.now() - lastUsedAt < IDLE_STOP_MS) return;
      log('媒体中间件空闲超时，退出（下次被访问时自动拉起）', 'info');
      diag('media-idle-stop', { idleMs: Date.now() - lastUsedAt });
      asleep = true;
      hardStop();
    }, Math.min(60 * 1000, Math.max(5000, Math.floor(IDLE_STOP_MS / 4))));
    if (idleTimer.unref) idleTimer.unref();
  }

  /** 关掉子进程；child 置空后 exit 处理器不会再当成崩溃。 */
  function hardStop() {
    const p = child;
    child = null;
    booted = false;
    drainPending(new Error('中间件已停止'));
    if (!p) return;
    try { p.stdin.end(); } catch { /* ignore */ }
    // SIGTERM **立即**发（实测：host 退出仅 ~0.2s ⇒ 任何延迟发的 unref 定时器都
    // 没机会触发，media-bridge 子进程会变孤儿一直活着，每次用过媒体就漏一个）。
    // 判 pid 再 kill：`stop()` 可能在 spawn 还没落地（或已经失败）时到达，那种情况下
    // `kill()` 会同步挂死事件循环；pid 不在就没有进程可杀，兜底交给 killWhenSpawned。
    if (p.pid !== undefined) { try { p.kill('SIGTERM'); } catch { /* 还没起来，交给下面的 SIGKILL 兜底 */ } }
    const t2 = setTimeout(() => killWhenSpawned(p), KILL_GRACE_MS);
    if (t2.unref) t2.unref();
  }

  function statusOf(name) {
    return sources.find((s) => s && s.name === name) || null;
  }

  /** 中间件数据源状态 → legacy 后端的 status 形状（设置界面按 status 决定提示）。 */
  function mapSource(name, fallbackStatus) {
    const s = statusOf(name);
    if (!s) return { status: fallbackStatus, hint: '' };
    const st = s.state === 'error' ? 'unavailable' : String(s.state || fallbackStatus);
    return { status: st, hint: String(s.hint || '') };
  }

  /** 歌词换算（带备忘：同一首反复读不该反复构造数组）。 */
  function lyricsFor(track) {
    const lyr = track && track.lyrics;
    const key = lyr && Array.isArray(lyr.lines)
      ? `${track.id || ''}|${lyr.lines.length}|${lyr.offsetMs || 0}|${lyr.source || ''}`
      : '';
    if (!key) return null;
    if (lyricsMemo.key === key) return lyricsMemo.value;
    lyricsMemo.key = key;
    lyricsMemo.value = lyricsToTuples(lyr);
    return lyricsMemo.value;
  }

  return {
    /** 启动并握手。resolve(false) = 起不来（含 spawn 失败/协议不符/超时）。 */
    async start(opts = {}) {
      if (started) return booted;
      started = true;
      stopping = false;
      Object.assign(optsRef, {
        audio: opts.audio !== false,
        online: opts.online === true,
        mock: opts.mock === true || process.env.DSH_WE_MEDIA_PROVIDER === 'mock',
      });
      ensureIdleTimer();
      lastUsedAt = Date.now();
      return startBoot();
    },
    stop() {
      stopping = true;
      if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
      if (idleTimer) { clearInterval(idleTimer); idleTimer = null; }
      hardStop();
    },
    /** 子进程活着且握手通过（上层据此决定「当前用谁取数」）。 */
    ready: () => Boolean(child && booted && !fatal),
    fatalReason: () => fatal,
    lastError: () => lastError,
    info: () => (info ? { ...info } : null),

    // ── 与 legacy 同名的取数 API ──────────────────────────────────────────────
    spectrum: () => { touch(); return spectrum; },
    nowPlaying() {
      touch();
      if (!snap || !snap.hasMedia || !snap.track) return null;
      const t = snap.track;
      const pb = snap.playback || {};
      const durMs = Number(pb.durationMs) || Number(t.durationMs) || 0;
      const playing = pb.state === 'playing';
      let posMs = Number(pb.positionMs) || 0;
      if (playing && pb.positionSource !== 'unavailable') {
        const ref = Number(pb.updatedAtMs) || 0;
        const rate = Number.isFinite(Number(pb.rate)) && Number(pb.rate) > 0 ? Number(pb.rate) : 1;
        if (ref) posMs += Math.max(0, Date.now() - ref) * rate;
        if (durMs > 0) posMs = Math.min(posMs, durMs);
      }
      const hasArt = Boolean(art.path);
      const lyrics = lyricsFor(t);
      return {
        hasMedia: true,
        title: String(t.title || ''),
        artist: String(t.artist || ''),
        album: String(t.album || ''),
        albumArtist: String(t.albumArtist || ''),
        playing,
        state: stateCode(pb.state),
        position: Math.max(0, posMs) / 1000,
        duration: durMs / 1000,
        thumbnail: hasArt ? '/wallpaper-engine/now-playing/artwork' : undefined,
        loopMode: String(pb.loopMode || ''),
        shuffle: pb.shuffle === true,
        appName: String((t.source && t.source.appName) || ''),
        ...(lyrics ? { lyrics } : {}),
      };
    },
    artworkFile: () => (art.path || null),
    artworkMime: () => (art.mime || ''),
    /**
     * 反向控制：动作名 → 中间件的 `control` RPC（白名单见 MEDIA_CONTROL_ACTIONS）。
     *
     * 两条不可省的收尾：① `touch()` —— 空闲停掉的子进程要先被唤醒，否则「点播放」
     * 在停着的后端上永远超时；② 响应里带回的 `now` 快照**立刻**写进缓存 ——
     * 中间件发完命令会开突发窗口重轮询，但事件到达前宿主的 Now Playing 与壁纸的
     * 播放/暂停图标会慢一拍（用户点完按钮看不到反馈）。
     *
     * 返回 `{ ok }` 而不是抛：这是"用户点一下"的交互，失败要能显示成不可用，
     * 不该把调用方的响应链打断（调用方是路由）。
     */
    async control(action) {
      const mapped = MEDIA_CONTROL_ACTIONS[action];
      if (!mapped) return { ok: false, error: 'unknown-action' };
      touch();
      try {
        const report = await call('control', { action: mapped }, CONTROL_TIMEOUT_MS);
        if (report && report.now) applySnapshot(report.now, Date.now());
        return { ok: true, action, outcome: (report && report.outcome) || null };
      } catch (err) {
        const msg = String(err && err.message ? err.message : err);
        diag('media-control', { action: mapped, error: msg.slice(0, 120) });
        return { ok: false, error: msg };
      }
    },
    status() {
      touch();
      refreshStatusSoon();
      // 用户主动关掉音频时给一个明确的「关了」，而不是中间件那边的环境缺失提示。
      const audio = optsRef.audio
        ? mapSource('audio', 'idle')
        : { status: 'off', hint: '已在设置中关闭「系统音频反应」' };
      const np = mapSource('metadata', 'idle');
      const lyrics = mapSource('lyrics', 'idle');
      return {
        backend: 'bridge',
        bridge: info ? {
          version: info.version, platform: info.platform, arch: info.arch,
          provider: info.provider, protocol: info.protocol, pid: info.pid,
          features: Array.isArray(info.features) ? info.features : [],
        } : null,
        audio: { status: audio.status, hint: audio.hint },
        nowPlaying: { status: np.status, hint: np.hint },
        lyrics: { status: lyrics.status, hint: lyrics.hint },
        sources: sources.slice(),
      };
    },
  };
}

export { BANDS };
