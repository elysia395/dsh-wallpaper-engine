// 渲染 workshop scene.pkg 场景 — 验证 scene.pkg 容器 + 场景组件
import fs from 'node:fs';
import path from 'node:path';
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { encodePng } from '../../lib/we-renderer/canvas.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';

const id = process.argv[2] || '2934788040';
const outDir = path.join('scripts', 'out');
fs.mkdirSync(outDir, { recursive: true });

const pkgPath = path.join(WS, id, 'scene.pkg');
console.log('渲染', pkgPath);

const t0 = Date.now();
const r = new SceneRenderer(pkgPath, {
  width: 960,
  height: 540,
  time: 0,
  weAssetsDir: WE,
  log: (m) => console.log('  [log]', m),
});
console.log('初始化耗时', Date.now() - t0, 'ms');
console.log('对象数:', r.objects.length, '渲染顺序:', r.renderOrder.map((o) => o.name || o.id).join(', '));

try {
  r.render();
  const out = path.join(outDir, 'ws_' + id + '.png');
  fs.writeFileSync(out, encodePng(r.canvas.w, r.canvas.h, r.canvas.data));
  console.log('输出:', out, '耗时', Date.now() - t0, 'ms');
  // 统计非背景像素
  let nz = 0, total = r.canvas.w * r.canvas.h;
  const d = r.canvas.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] || d[i + 1] || d[i + 2]) nz++;
  }
  console.log('非黑像素占比:', (nz / total * 100).toFixed(1) + '%');
} catch (e) {
  console.error('渲染失败:', e.stack || e);
  process.exitCode = 1;
}
