/**
 * supervisor-protocol.js — media-bridge 监督者的**协议常量与纯函数**（2026-11-07 从
 * `supervisor.js` 纯搬移折出：进程生命周期留在 supervisor.js，这里只放"纯计算"）。
 *
 * 为什么单独一层：协议版本、引导预算、spawn 姿势、空闲/重启窗口、命令白名单、
 * 命令行拼装都是**不碰可变状态**的决策面 —— 从 556 行的 `createBridgeSupervisor` 里
 * 拿出来之后既可以直接单测（`verify-media-bridge` 已按导出名断言），也让"哪一行是协议、
 * 哪一行是状态机"在文件边界上可见。零行为改动。
 */

/** 支持的协议版本（`hello.protocol`）；不匹配就回落 legacy，不做猜测性兼容。 */
export const PROTOCOL_VERSION = 1;
export const BANDS = 64;
/** 频谱推送间隔：与客户端 50ms 拉取节奏对齐。 */
export const SPECTRUM_INTERVAL_MS = 50;
export const CALL_TIMEOUT_MS = 8000;
/**
 * 引导阶段的超时放宽：刚下载下来的二进制第一次执行时，macOS 会先做一遍安全
 * 检查（实测首次启动可慢到数秒），这段时间里 hello 还没回来是正常的，不该
 * 因此判定「中间件起不来」而回落。
 */
export const BOOT_CALL_TIMEOUT_MS = 25000;
export const SPAWN_TIMEOUT_MS = 15000;
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
export function bootCallTimeoutMs() {
  const raw = process.env.DSH_WE_MEDIA_BOOT_MS;
  if (raw === undefined || raw === '') return BOOT_CALL_TIMEOUT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1000 ? n : BOOT_CALL_TIMEOUT_MS;
}

/** 第一次握手尝试占总预算的比例（余下留给"换 spawn 姿势再试一次"）。 */
export const FIRST_ATTEMPT_SHARE = 0.6;
/** 单次尝试的最小预算：少于它就不值得起一个进程（第二次直接不试）。 */
export const MIN_ATTEMPT_MS = 3000;

/**
 * 把**总**引导预算分给两次握手尝试（姿势 A → 姿势 B）—— **绝不翻倍**。
 *
 * 为什么要分：CI run `38357286484` windows 腿红过一次典型抖动 ——
 * 子进程**活着、两路输出皆空、`hello` 直到预算耗尽都没回**；同提交重跑即绿。
 * 这类抖动落在"起进程 + 握手"这一层：换一种 spawn 姿势（`detached` ↔ `plain`）
 * 重来一次往往就好了。但重试**不能**把等待时间翻倍（那会把现场回落延迟一起拉长），
 * 所以第一次只拿 `FIRST_ATTEMPT_SHARE`（且至少 `MIN_ATTEMPT_MS`），余下全给第二次；
 * 两次之和恒 ≤ `bootMs`。
 *
 * @param {number} bootMs 总预算（毫秒，来自 `DSH_WE_MEDIA_BOOT_MS` / 默认值）
 * @returns {{ first: number, second: number }} 两次尝试各自的预算（`second === 0` = 不重试）
 */
export function bootAttemptBudgets(bootMs) {
  const total = Math.max(0, Math.floor(Number(bootMs) || 0));
  const first = Math.max(MIN_ATTEMPT_MS, Math.floor(total * FIRST_ATTEMPT_SHARE));
  const second = total - first;
  return { first: second >= MIN_ATTEMPT_MS ? first : total, second: second >= MIN_ATTEMPT_MS ? second : 0 };
}

/** 两种 spawn 姿势（值即 `spawn()` 的 opts 增量）；顺序按平台（Windows 先 detached）。 */
export const POSTURES = {
  detached: { detached: true, windowsHide: true },
  plain: { windowsHide: true },
};
/** 姿势尝试顺序：平台第一选择在前，另一种作为抖动重试。 */
export function postureOrder() {
  return process.platform === 'win32' ? ['detached', 'plain'] : ['plain', 'detached'];
}

export const KILL_GRACE_MS = 3000;
/** 崩溃重启预算：窗口内超过这个次数就判定为「跑不起来」，回落 legacy。 */
export const MAX_RESTARTS = 3;
export const RESTART_WINDOW_MS = 5 * 60 * 1000;
/**
 * 空闲停进程：没有任何取数请求这么久就退出（下次访问再自动拉起）。
 * 壁纸实时渲染时客户端 50ms 拉一次，永不触发；没在用的时候不该白占一个
 * 20MB 进程 + 一路系统音频采集。0 = 不停。DSH_WE_MEDIA_IDLE_MS 可覆盖。
 */
/** 状态缓存的兜底刷新间隔：中间件只在「元数据源出错」时推 status 事件，音频源
 *  idle→preparing→running 的变化不主动通知（v0.1.3 实测；已在 v0.1.4 补事件）。
 *  这里定期重问一次，避免消费端一直看到过期的 preparing —— 症状是频谱明明有数据、
 *  客户端却因为 `running===false` 不把音频交给壁纸。 */
export const STATUS_REFRESH_MS = 5000;

export const IDLE_STOP_MS = (() => {
  const raw = process.env.DSH_WE_MEDIA_IDLE_MS;
  if (raw === undefined || raw === '') return 15 * 60 * 1000;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 15 * 60 * 1000;
})();

/** 播放态 → 旧 wire 的数值约定（0 停止 / 1 播放 / 2 暂停）。 */
export function stateCode(state) {
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
export const CONTROL_TIMEOUT_MS = 5000;

/**
 * 中间件的完整命令行（宿主设置 → 开关）。**纯函数、单一真源**：守护侧与自检的
 * "不经过管道"探针（`verify-media-bridge` 的文件探针）必须用同一套参数，否则探针失败
 * 分不清是环境问题还是参数漂移。
 *
 * `--no-online` 是**显式隐私闸门**：中间件自带的在线歌词查询（外发歌名/歌手/专辑到
 * lrclib.net）本插件已经不消费（歌词透传已整条移除），所以恒关；不依赖中间件各版本的
 * 默认值 —— 那边的默认值会变，这条不会。
 */
export function bridgeServeArgs({ cacheDir = '', audio = true, mock = false, verbose = false } = {}) {
  const args = ['serve', '--cache-dir', String(cacheDir), '--poll-ms', '1000'];
  if (!audio) args.push('--no-audio');              // 音频关但元数据要：连授权都不会弹
  args.push('--no-online');
  if (mock) args.push('--provider', 'mock');
  if (verbose) args.push('--verbose');
  return args;
}
