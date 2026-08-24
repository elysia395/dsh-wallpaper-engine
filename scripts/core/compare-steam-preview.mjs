// 对比 Steam 引擎预览 vs 我的渲染 (找位置差异)
import fs from 'node:fs';
import { decodeJpeg } from '../../lib/we-renderer/jpeg.js';
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { encodePng } from '../../lib/we-renderer/canvas.js';

const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';

// Steam 预览
const prevPath = 'C:/Users/Kai/AppData/Local/Temp/amiya_preview.jpg';
const prev = decodeJpeg(fs.readFileSync(prevPath));
console.log('Steam 预览:', prev.width + 'x' + prev.height);
fs.writeFileSync('scripts/out/steam_amiya.png', encodePng(prev.width, prev.height, prev.rgba));

// 我的渲染 (同 aspect 尽量匹配)
const r = new SceneRenderer(WS + '/3486806915/scene.pkg', { width: 960, height: 540, time: 2.5, weAssetsDir: WE, log: () => {} });
r.render();
fs.writeFileSync('scripts/out/mine_amiya.png', encodePng(r.canvas.w, r.canvas.h, r.canvas.data));

// 亮度网格对比 (归一化到 32x18)
const grid = (img) => {
  const g = [];
  for (let gy = 0; gy < 18; gy++) {
    let row = [];
    for (let gx = 0; gx < 32; gx++) {
      const x = Math.floor((gx + 0.5) / 32 * img.width);
      const y = Math.floor((gy + 0.5) / 18 * img.height);
      const o = (y * img.width + x) * 4;
      const lum = (img.rgba[o] + img.rgba[o + 1] + img.rgba[o + 2]) / 3;
      row.push(lum > 180 ? '#' : lum > 90 ? '+' : lum > 30 ? '.' : ' ');
    }
    g.push(row.join(''));
  }
  return g.join('\n');
};
console.log('\n=== Steam 预览 (引擎) ===');
console.log(grid(prev));
console.log('\n=== 我的渲染 ===');
const mine = { width: r.canvas.w, height: r.canvas.h, rgba: r.canvas.data };
console.log(grid(mine));
