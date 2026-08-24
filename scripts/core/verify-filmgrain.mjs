// 鏁板€奸獙璇?filmgrain: 寮€/鍏?filmgrain 瀵规瘮灞€閮ㄦ柟宸?(鍣偣搴斿澶у抚鍐呮柟宸?
import { SceneRenderer } from '../../lib/scene-renderer.js';
import fs from 'node:fs';
import path from 'node:path';

const WE = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\wallpaper_engine';
const neonDir = path.join(WE, 'projects', 'defaultprojects', 'neon_sunset');

// 璁＄畻鍥惧儚鍖哄煙鏂瑰樊 (鍣偣鎸囨爣)
function localVariance(rgba, w, h) {
  // 閲囨牱 3x3 閭诲煙鍧囧€煎亸宸? 鍦?40x40 缃戞牸鐐逛笂
  let total = 0, n = 0;
  for (let gy = 4; gy < h - 4; gy += Math.max(1, Math.floor(h / 30))) {
    for (let gx = 4; gx < w - 4; gx += Math.max(1, Math.floor(w / 40))) {
      const c = (gy * w + gx) * 4;
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const i = ((gy + dy) * w + (gx + dx)) * 4;
          s += Math.abs(rgba[i] - rgba[c]);
        }
      }
      total += s / 9;
      n++;
    }
  }
  return total / n;
}

function renderWith(opts) {
  const r = new SceneRenderer(neonDir, { width: 1920, height: 1080, time: opts.t ?? 2.5, weAssetsDir: WE, log: () => {} });
  // 绂佺敤 filmgrain: 鎶?Fullscreen 瀵硅薄鐨?effects 娓呯┖
  if (opts.noFilmGrain) {
    const o = r.objects.find((x) => x.name === 'Fullscreen' && x.effects);
    if (o) o.effects = [];
  }
  const canvas = r.render();
  return canvas;
}

const withGrain = renderWith({});
const noGrain = renderWith({ noFilmGrain: true });
const vGrain = localVariance(withGrain.data, withGrain.w, withGrain.h);
const vNo = localVariance(noGrain.data, noGrain.w, noGrain.h);
console.log(`neon_sunset 灞€閮ㄦ柟宸? 鏈?filmgrain=${vGrain.toFixed(3)}, 鏃?filmgrain=${vNo.toFixed(3)}, 姣斿€?${(vGrain / vNo).toFixed(2)}x`);

// 鏃堕棿鍗峰姩: t=2.5 vs t=3.5 甯у簲涓嶅悓 (鍣０闅忔椂闂村嵎鍔?
const t25 = renderWith({ t: 2.5 });
const t35 = renderWith({ t: 3.5 });
let diff = 0, n = 0;
for (let y = 0; y < t25.h; y += 8) {
  for (let x = 0; x < t25.w; x += 8) {
    const i = (y * t25.w + x) * 4;
    if (Math.abs(t25.data[i] - t35.data[i]) + Math.abs(t25.data[i+1] - t35.data[i+1]) + Math.abs(t25.data[i+2] - t35.data[i+2]) > 24) diff++;
    n++;
  }
}
console.log(`neon_sunset t=2.5 vs t=3.5 甯у樊寮傚儚绱? ${diff}/${n} (${(diff / n * 100).toFixed(1)}%)`);

// 鏃?filmgrain 鏃朵袱甯у簲鍑犱箮鐩稿悓 (闈欐€佸満鏅?
const ng25 = renderWith({ noFilmGrain: true, t: 2.5 });
const ng35 = renderWith({ noFilmGrain: true, t: 3.5 });
let d2 = 0;
for (let y = 0; y < ng25.h; y += 8) {
  for (let x = 0; x < ng25.w; x += 8) {
    const i = (y * ng25.w + x) * 4;
    if (Math.abs(ng25.data[i] - ng35.data[i]) + Math.abs(ng25.data[i+1] - ng35.data[i+1]) + Math.abs(ng25.data[i+2] - ng35.data[i+2]) > 24) d2++;
  }
}
console.log(`neon_sunset 鏃爁ilm t=2.5 vs t=3.5 甯у樊寮傚儚绱? ${d2}/${n} (${(d2 / n * 100).toFixed(1)}%)`);
