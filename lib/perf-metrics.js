/**
 * perf-metrics.js — #263「更小的第一步」：逐壁纸性能指标（FPS / 平均帧时间 / 掉帧 / 本进程 CPU）。
 *
 * 为什么是主机侧模块：帧间隔由浏览器侧探针（src/live-layer/probe.js）采集，经既有
 * `/client-diag` 通道上报；`process.cpuUsage()` 只有 Node 侧拿得到。两侧在**这一份
 * 聚合器**里汇合 —— 客户端只负责「量」，主机只负责「算 + 出」。
 *
 * 契约：
 *   · `recordBatch(intervals, token)` —— 追加一批帧间隔（毫秒）；换 token 即清零（逐壁纸口径）。
 *   · `snapshot(token)` —— { fps, averageFrameTimeMs, jankCount, jankRatio, cpu, samples, token }。
 *   · `resetPerfMetrics()` —— 清空全部状态（测试用）。
 *
 * 内部（不导出）：`sampleCpu()` 取距上次采样的本进程 CPU 百分比（单核 100% 满），
 * 由 `snapshot()` 调用 —— 它是一次**采样**而不是一条独立 API，导出只会招来无消费者的
 * 死导出（见 test/verify-settings-schema-exports.mjs）。
 *
 * 口径：
 *   · FPS = 1000 / 平均帧时间（不是「帧数 / 秒」的直接计数 —— 那样受采样窗口长短影响）。
 *   · 掉帧 = 单帧间隔 > 平均帧时间 × 1.5（**相对**判据：60fps 下 25ms 算掉帧，144fps 下
 *     11ms 也算；固定阈值在不同帧率上限下会失真）。
 *   · 环形缓冲上界 MAX_SAMPLES（1 秒 1 个渲染侧样本 ⇒ 约 5 秒窗口）：常数级内存，
 *     且旧样本不会让 FPS 长期滞后；超过 STALE_MS 没新样本即视为未知。
 *   · CPU = 两次采样之间 (user + system) 增量 / 墙钟增量，单位 %。
 *
 * 依赖：仅 node:process（ESM、无 React、无 DOM）—— 可直接在 Node 里单元测试。
 */
import { cpuUsage } from 'node:process';

/** 环形缓冲上界：1 秒 1 个渲染侧样本，约 5 秒窗口。 */
const MAX_SAMPLES = 5;
/** 掉帧判据：单帧间隔 > 平均帧时间 × 该系数。 */
const JANK_FACTOR = 1.5;
/** 样本新鲜度：超过这个墙钟时间没有新样本，就不再当作当前 FPS。 */
const STALE_MS = 3000;

/** 当前 token 的帧间隔（毫秒），最多 MAX_SAMPLES 条。 */
let intervals = [];
/** 当前聚合的 token（空串 = 无）。 */
let token = '';
/** 上次 CPU 采样。 */
let lastCpu = null;
/** 上次 CPU 采样的墙钟毫秒。 */
let lastCpuAt = 0;
/** 上次收到帧样本的墙钟毫秒（新鲜度判据）。 */
let lastAt = 0;

/**
 * 追加一批帧间隔。换 token 即清零 —— 指标是**逐壁纸**的，上一张的样本不能混进来。
 * @param {Iterable<number>} batch 帧间隔（毫秒）
 * @param {string} nextToken 当前壁纸标识
 */
export function recordBatch(batch, nextToken) {
  const key = String(nextToken == null ? '' : nextToken);
  if (key !== token) {
    intervals = [];
    token = key;
  }
  for (const value of batch || []) {
    const ms = Number(value);
    if (!Number.isFinite(ms) || ms <= 0) continue;
    intervals.push(ms);
  }
  if (intervals.length > MAX_SAMPLES) {
    intervals = intervals.slice(intervals.length - MAX_SAMPLES);
  }
  lastAt = Date.now();
}

/**
 * 取本进程 CPU 占用（%，单核 100% 满）。
 * 用 `process.cpuUsage()` 的**增量**除以墙钟增量 —— 累计值本身没有意义。
 * @returns {number} 距上次采样的 CPU 百分比；首次采样返回 0。
 */
function sampleCpu() {
  const now = Date.now();
  const usage = cpuUsage();
  if (!lastCpu || !lastCpuAt) {
    lastCpu = usage;
    lastCpuAt = now;
    return 0;
  }
  const delta = (usage.user - lastCpu.user) + (usage.system - lastCpu.system);
  const elapsed = now - lastCpuAt;
  lastCpu = usage;
  lastCpuAt = now;
  if (elapsed <= 0) return 0;
  return (delta / 1000) / elapsed * 100;
}

/**
 * 快照当前指标。**只读**（不改聚合状态；CPU 基线由 sampleCpu 内部推进）。
 * @param {string} nextToken 当前壁纸标识
 * @returns {{fps:number, averageFrameTimeMs:number, jankCount:number, jankRatio:number, cpu:number, samples:number, token:string}}
 */
export function snapshot(nextToken) {
  const key = String(nextToken == null ? '' : nextToken);
  // 只认**当前 token 且仍然新鲜**的样本：面板轮询的 token 与上报 token 可能
  // 短暂错位（切换/暂停），这时宁可显示「—」也不能把上一张的数字报给这一张。
  const fresh = key !== '' && key === token && lastAt > 0 && (Date.now() - lastAt) <= STALE_MS;
  const samples = fresh ? intervals.length : 0;
  const average = samples ? intervals.reduce((sum, ms) => sum + ms, 0) / samples : 0;
  const jank = samples ? intervals.filter((ms) => ms > average * JANK_FACTOR).length : 0;
  return {
    fps: average > 0 ? Math.round(1000 / average) : 0,
    averageFrameTimeMs: average,
    jankCount: jank,
    jankRatio: samples ? jank / samples : 0,
    cpu: sampleCpu(),
    samples,
    token: key,
  };
}

/** 清空全部聚合状态（测试用）。 */
export function resetPerfMetrics() {
  intervals = [];
  token = '';
  lastCpu = null;
  lastCpuAt = 0;
  lastAt = 0;
}
