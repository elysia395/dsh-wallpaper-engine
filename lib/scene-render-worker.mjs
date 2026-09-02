// 场景静态帧渲染 worker: 把 SceneRenderer 的同步 CPU 光栅化移到 worker 线程,
// 避免阻塞 DSH 主进程事件循环 (大型壁纸渲染数秒~数十秒)。
// 仅单帧模式 (time): /scene-frame 的 CPU 渲染优先路径。多帧动画/APNG/raw
// 烘焙链 (times 数组, fmt=mp4) 已按决策移除 — 本 worker 不再消费这些参数。
import { parentPort, workerData } from 'node:worker_threads';
import { SceneRenderer, encodePng } from './scene-renderer.js';

const { src, width, height, time, weAssetsDir, videoFrames } = workerData;

// 契约 C1: SceneRenderer 支持 opts.onDegraded({object, feature, action}) 时
// 收集降级事件, 随最终结果 postMessage 上浮 (msg.degraded, 结构与 GL gate
// 的 degraded 清单一致)。
const degradedEvents = [];
const collectDegraded = (e) => {
  if (degradedEvents.length < 200 && e && typeof e === 'object') degradedEvents.push(e);
};

// 空白帧门禁阈值 (P-15 复核定案): 与 clearcolor 差异采样 < 0.1% 视为空白。
// 实测 7 张场景壁纸 (§9.5 同一批, 640×360 同款采样): 6 张有实际渲染内容的
// diff 比例为 86.6%~99.6% (3113554287 恰为 0.00% — 其 4 张主纹理是内嵌
// mp4 的 tex, 静态解码失败后只剩 clearcolor, 门禁按设计拦截回退), 全部
// 距阈值 3 个数量级以上、无人落在 0.05%~0.1% 区间 → 按"全部 >5× 阈值则
// 放宽到 0.1%"定案放宽一倍, 为深色合法场景 (近纯色夜空/暗场) 留余量。
const BLANK_DIFF_RATIO = 0.001;

// 对 clearcolor 的采样 diff 计数: 每 8px 采样, 任一通道差 >24 记一次。
// 统计随结果消息上浮, 由宿主 route 按 BLANK_DIFF_RATIO 判定空白帧。
function sampleBlankStats(canvas, cr0, cg0, cb0) {
  const step = 8;
  let diff = 0;
  let checked = 0;
  for (let y = 0; y < canvas.h; y += step) {
    for (let x = 0; x < canvas.w; x += step) {
      const i = (y * canvas.w + x) * 4;
      checked++;
      const r = canvas.data[i];
      const g = canvas.data[i + 1];
      const b = canvas.data[i + 2];
      if (Math.abs(r - cr0) > 24 || Math.abs(g - cg0) > 24 || Math.abs(b - cb0) > 24) diff++;
    }
  }
  return { diff, checked };
}

try {
  const renderer = new SceneRenderer(src, { width, height, time, weAssetsDir, videoFrames, log: () => {}, onDegraded: collectDegraded });
  const canvas = renderer.render();
  const cc = renderer.scene && renderer.scene.general && renderer.scene.general.clearcolor;
  const ccv = typeof cc === 'string' && cc.trim() ? cc.trim().split(/\s+/).map(Number) : [0, 0, 0];
  const cr0 = (ccv[0] || 0) * 255, cg0 = (ccv[1] || 0) * 255, cb0 = (ccv[2] || 0) * 255;
  const { diff, checked } = sampleBlankStats(canvas, cr0, cg0, cb0);
  const png = encodePng(canvas.w, canvas.h, canvas.data);
  const msg = { ok: true, png, diff, checked };
  if (degradedEvents.length) msg.degraded = degradedEvents;
  // 不走 transfer list: encodePng 的 Buffer 常落在 node 分配池的共享
  // ArrayBuffer 上 (小 PNG/近空白帧必中), transfer 直接抛
  // "Cannot transfer object of unsupported type" → 整帧 ok:false。
  // 结构化克隆一次拷贝代价相对 CPU 渲染可忽略。
  parentPort.postMessage(msg);
} catch (e) {
  const msg = { ok: false, error: String(e && e.message ? e.message : e) };
  if (degradedEvents.length) msg.degraded = degradedEvents;
  parentPort.postMessage(msg);
}
