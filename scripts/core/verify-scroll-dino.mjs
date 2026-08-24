// dino_run scroll 鏃堕棿鍗峰姩楠岃瘉 + 鍥炲綊妫€鏌?
import { SceneRenderer, encodePng } from '../../lib/scene-renderer.js';
import fs from 'node:fs';
import path from 'node:path';

const WE = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\wallpaper_engine';
const OUT = 'D:\\dsh-wallpaper-engine\\scene-layers-out\\effects';

function renderScene(src, opts = {}) {
  const r = new SceneRenderer(src, { width: opts.w || 1920, height: opts.h || 1080, time: opts.t ?? 2.5, weAssetsDir: WE, log: (m) => console.log('  [log]', m) });
  const canvas = r.render();
  return { r, canvas };
}

function frameDiff(a, b, w, h, step = 8) {
  let diff = 0, n = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      if (Math.abs(a[i] - b[i]) + Math.abs(a[i+1] - b[i+1]) + Math.abs(a[i+2] - b[i+2]) > 24) diff++;
      n++;
    }
  }
  return { diff, n };
}

// dino_run: scroll 鏄椂闂村姩鐢?鈫?t=2.5 涓?t=3.5 甯у簲鏈夊樊寮?(鏉ヨ嚜 scroll 鍗峰姩)
const dinoDir = path.join(WE, 'projects', 'defaultprojects', 'dino_run');
const a = renderScene(dinoDir, { t: 2.5 });
const b = renderScene(dinoDir, { t: 3.5 });
const d = frameDiff(a.canvas.data, b.canvas.data, a.canvas.w, a.canvas.h);
console.log(`dino_run t=2.5 vs t=3.5: ${d.diff}/${d.n} (${(d.diff / d.n * 100).toFixed(1)}%)`);

// 涓庢棤 scroll 瀵规瘮: 绂佺敤 bg1_*/grass_ground 鐨?effects 鍚庡抚搴旀帴杩?t=2.5 鏃犲嵎鍔?
{
  const r = new SceneRenderer(dinoDir, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
  for (const o of r.objects) if (o.effects) o.effects = [];
  const c = r.render();
  const dd = frameDiff(a.canvas.data, c.data, a.canvas.w, a.canvas.h);
  console.log(`dino_run 鏈塻croll(t2.5) vs 鏃爏croll: ${dd.diff}/${dd.n} (${(dd.diff / dd.n * 100).toFixed(1)}%)`);
  fs.writeFileSync(path.join(OUT, 'dino_run_noscroll.png'), encodePng(c.w, c.h, c.data));
}

// 鍥炲綊: demon_core (搴斾繚鎸佹纭?
const demonDir = path.join(WE, 'projects', 'defaultprojects', 'demon_core');
const dc = renderScene(demonDir);
fs.writeFileSync(path.join(OUT, 'demon_core_regression.png'), encodePng(dc.canvas.w, dc.canvas.h, dc.canvas.data));
console.log('demon_core 娓叉煋瀹屾垚 (鍥炲綊)');
