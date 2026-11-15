/**
 * perf-metrics.js — #263：本进程 CPU 采样（性能监控扩展的宿主半）。
 *
 * 为什么只有 CPU 留在这里：帧率与帧时间由**渲染侧**直接量（场景取 WebWallGL 的
 * FrameStats、视频取 totalVideoFrames、界面取宿主 rAF），浏览器半自己就能算完并显示；
 * 而 `process.cpuUsage()` 只有 Node 侧拿得到，且必须跨请求保存「上次采样」基线 ——
 * 所以这一份聚合器只承担这一件事。
 *
 * 契约：
 *   · `snapshot()` —— { cpu }：距上次采样的本进程 CPU 百分比（单核 100% 满）。
 *   · `resetPerfMetrics()` —— 清空采样基线（测试用）。
 *
 * 口径：CPU = 两次采样之间 (user + system) 增量 / 墙钟增量，单位 %。首次采样没有基线，
 * 返回 0 —— 调用方（性能监控面板）把 0 当作"还没有基线"显示 —，第二秒起才是真值。
 *
 * 依赖：仅 node:process（ESM、无 React、无 DOM）—— 可直接在 Node 里单元测试。
 */
import { cpuUsage } from 'node:process';

/** 上次 CPU 采样。 */
let lastCpu = null;
/** 上次 CPU 采样的墙钟毫秒。 */
let lastCpuAt = 0;

/**
 * 快照本进程 CPU 占用（%，单核 100% 满）。
 * 用 `process.cpuUsage()` 的**增量**除以墙钟增量 —— 累计值本身没有意义。
 * @returns {{cpu:number}}
 */
export function snapshot() {
  const now = Date.now();
  const usage = cpuUsage();
  if (!lastCpu || !lastCpuAt) {
    lastCpu = usage;
    lastCpuAt = now;
    return { cpu: 0 };
  }
  const delta = (usage.user - lastCpu.user) + (usage.system - lastCpu.system);
  const elapsed = now - lastCpuAt;
  lastCpu = usage;
  lastCpuAt = now;
  const cpu = elapsed > 0 ? (delta / 1000) / elapsed * 100 : 0;
  return { cpu };
}

/** 清空采样基线（测试用）。 */
export function resetPerfMetrics() {
  lastCpu = null;
  lastCpuAt = 0;
}
