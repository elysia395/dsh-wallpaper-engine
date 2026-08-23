// 场景帧渲染 worker: 把 SceneRenderer 的同步 CPU 渲染移到 worker 线程,
// 避免阻塞 DSH 主进程事件循环 (大型壁纸渲染数秒~数十秒).
import { parentPort, workerData } from 'node:worker_threads';
import { SceneRenderer, encodePng } from './scene-renderer.js';

const { src, width, height, time, weAssetsDir } = workerData;

try {
  const renderer = new SceneRenderer(src, { width, height, time, weAssetsDir, log: () => {} });
  const canvas = renderer.render();
  // 空帧门禁统计 (与主线程旧逻辑一致): 与 clearcolor 差异 < 0.05% 视为空白
  const cc = renderer.scene && renderer.scene.general && renderer.scene.general.clearcolor;
  const ccv = typeof cc === 'string' && cc.trim() ? cc.trim().split(/\s+/).map(Number) : [0, 0, 0];
  const cr0 = (ccv[0] || 0) * 255, cg0 = (ccv[1] || 0) * 255, cb0 = (ccv[2] || 0) * 255;
  const step = 8;
  let diff = 0, checked = 0;
  for (let y = 0; y < canvas.h; y += step) {
    for (let x = 0; x < canvas.w; x += step) {
      const i = (y * canvas.w + x) * 4;
      checked++;
      if (Math.abs(canvas.data[i] - cr0) > 24 || Math.abs(canvas.data[i + 1] - cg0) > 24 || Math.abs(canvas.data[i + 2] - cb0) > 24) diff++;
    }
  }
  const png = encodePng(canvas.w, canvas.h, canvas.data);
  // 转移底层 ArrayBuffer, 零拷贝回传
  parentPort.postMessage({ ok: true, png, diff, checked }, [png.buffer]);
} catch (e) {
  parentPort.postMessage({ ok: false, error: String(e && e.message ? e.message : e) });
}
