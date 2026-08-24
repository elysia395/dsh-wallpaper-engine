// 模拟 DSH worker 渲染: 用 scene-renderer.js 渲染 Amiya 3840x2160, 检查是否失败
import { SceneRenderer, encodePng } from '../../lib/scene-renderer.js';
import fs from 'node:fs';
const src = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/scene.pkg';
try {
  const r = new SceneRenderer(src, { width: 3840, height: 2160, time: 2.5, weAssetsDir: 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine', log: () => {} });
  const canvas = r.render();
  const png = encodePng(r.W, r.H, canvas.data);
  fs.writeFileSync('scripts/out/amiya_worker_sim.png', png);
  // diff 计算 (模拟 worker)
  let diff = 0, checked = r.W * r.H * 4;
  const d = canvas.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i+3] > 0) diff += 4;
  }
  console.log('渲染成功, diff:', diff, 'checked:', checked, 'ratio:', (diff/checked).toFixed(6));
  console.log('blank?', diff < checked * 0.0005);
} catch (e) {
  console.log('渲染失败:', e.message);
  console.log(e.stack.split('\n').slice(0, 5).join('\n'));
}
