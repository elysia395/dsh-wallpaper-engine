// godrays 5-pass 链验证: dino_run postprocess
import { SceneRenderer, encodePng } from '../lib/scene-renderer.js';
import fs from 'node:fs';
import path from 'node:path';

const WE = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\wallpaper_engine';
const OUT = 'D:\\dsh-wallpaper-engine\\scene-layers-out\\effects';

function renderScene(src, opts = {}) {
  const r = new SceneRenderer(src, { width: opts.w || 1920, height: opts.h || 1080, time: opts.t ?? 2.5, weAssetsDir: WE, log: (m) => console.log('  [log]', m) });
  const canvas = r.render();
  return { r, canvas };
}

function stats(rgba, w, h) {
  let sum = [0, 0, 0], n = 0;
  for (let y = 0; y < h; y += 4) {
    for (let x = 0; x < w; x += 4) {
      const i = (y * w + x) * 4;
      sum[0] += rgba[i]; sum[1] += rgba[i + 1]; sum[2] += rgba[i + 2];
      n++;
    }
  }
  return [sum[0] / n, sum[1] / n, sum[2] / n].map((v) => v.toFixed(1));
}

const dinoDir = path.join(WE, 'projects', 'defaultprojects', 'dino_run');
const t0 = Date.now();
const { canvas } = renderScene(dinoDir);
console.log(`dino_run (godrays on): avgRGB=${stats(canvas.data, canvas.w, canvas.h)} 耗时=${((Date.now() - t0) / 1000).toFixed(1)}s`);
fs.writeFileSync(path.join(OUT, 'dino_run_godrays.png'), encodePng(canvas.w, canvas.h, canvas.data));

// 对照: 禁用 postprocess 的 godrays (保留 scroll)
{
  const r = new SceneRenderer(dinoDir, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
  const pp = r.objects.find((o) => o.name === 'postprocess');
  if (pp) pp.effects = [];
  const c = r.render();
  fs.writeFileSync(path.join(OUT, 'dino_run_nogodrays.png'), encodePng(c.w, c.h, c.data));
  console.log(`dino_run (no godrays): avgRGB=${stats(c.data, c.w, c.h)}`);
  // 差异统计
  let diff = 0, n = 0, brightGain = 0;
  for (let y = 0; y < c.h; y += 8) {
    for (let x = 0; x < c.w; x += 8) {
      const i = (y * c.w + x) * 4;
      const d = Math.abs(canvas.data[i] - c.data[i]) + Math.abs(canvas.data[i+1] - c.data[i+1]) + Math.abs(canvas.data[i+2] - c.data[i+2]);
      if (d > 24) diff++;
      brightGain += (canvas.data[i] + canvas.data[i+1] + canvas.data[i+2]) - (c.data[i] + c.data[i+1] + c.data[i+2]);
      n++;
    }
  }
  console.log(`godrays 差异像素: ${diff}/${n} (${(diff / n * 100).toFixed(1)}%), 平均亮度增益=${(brightGain / n / 3).toFixed(2)} (add 模式应 ≥0)`);
}
