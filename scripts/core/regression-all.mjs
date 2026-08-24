// 鍏ㄩ噺鍥炲綊: 娓叉煋鎵€鏈?defaultprojects 鍦烘櫙, 璁板綍鎴愬姛/澶辫触/avgRGB
import { SceneRenderer, encodePng } from '../../lib/scene-renderer.js';
import fs from 'node:fs';
import path from 'node:path';

const WE = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\wallpaper_engine';
const OUT = 'D:\\dsh-wallpaper-engine\\scene-layers-out\\regression-r2';

fs.mkdirSync(OUT, { recursive: true });

function stats(rgba, w, h) {
  let sum = [0, 0, 0], n = 0;
  for (let y = 0; y < h; y += 8) {
    for (let x = 0; x < w; x += 8) {
      const i = (y * w + x) * 4;
      sum[0] += rgba[i]; sum[1] += rgba[i + 1]; sum[2] += rgba[i + 2];
      n++;
    }
  }
  return [sum[0] / n, sum[1] / n, sum[2] / n].map((v) => v.toFixed(0));
}

const dirs = fs.readdirSync(path.join(WE, 'projects', 'defaultprojects'))
  .filter((d) => fs.existsSync(path.join(WE, 'projects', 'defaultprojects', d, 'scene.json')));

for (const name of dirs) {
  const dir = path.join(WE, 'projects', 'defaultprojects', name);
  const t0 = Date.now();
  try {
    const r = new SceneRenderer(dir, { width: 1280, height: 720, time: 2.5, weAssetsDir: WE, log: () => {} });
    const c = r.render();
    fs.writeFileSync(path.join(OUT, name + '.png'), encodePng(c.w, c.h, c.data));
    console.log(`OK   ${name}: avgRGB=${stats(c.data, c.w, c.h)} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) {
    console.log(`FAIL ${name}: ${e.message}`);
  }
}
