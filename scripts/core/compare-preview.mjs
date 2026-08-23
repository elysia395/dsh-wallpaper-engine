// 对比引擎 preview.jpg vs 我的渲染 (验证坐标语义)
import fs from 'node:fs';
import path from 'node:path';
import { decodeJpeg } from '../../lib/we-renderer/jpeg.js';
import { decodePngBuffer } from '../../lib/we-renderer/canvas.js';
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';

// 引擎 preview
const prevPath = WE + '/projects/defaultprojects/beach/preview.jpg';
const prev = decodeJpeg(fs.readFileSync(prevPath));
console.log('引擎 preview:', prev.width + 'x' + prev.height);

// 我的渲染 (beach)
const r = new SceneRenderer(WE + '/projects/defaultprojects/beach', { width: 480, height: 270, time: 0, weAssetsDir: WE, log: () => {} });
r.render();
const mine = { width: r.canvas.w, height: r.canvas.h, rgba: r.canvas.data };
console.log('我的渲染:', mine.width + 'x' + mine.height);

// 采样网格对比 (亮度)
const sample = (img, sx, sy, sw, sh) => {
  // 缩放到统一网格 24x14
  const rows = [];
  for (let gy = 0; gy < 14; gy++) {
    let row = '';
    for (let gx = 0; gx < 24; gx++) {
      const x = Math.floor((gx + 0.5) / 24 * sw), y = Math.floor((gy + 0.5) / 14 * sh);
      const o = (y * img.width + x) * 4;
      const lum = (img.rgba[o] + img.rgba[o + 1] + img.rgba[o + 2]) / 3;
      row += lum > 180 ? '#' : lum > 90 ? '+' : lum > 30 ? '.' : ' ';
    }
    rows.push(row);
  }
  return rows.join('\n');
};

console.log('\n=== 引擎 preview (beach) ===');
console.log(sample(prev, 0, 0, prev.width, prev.height));
console.log('\n=== 我的渲染 (beach) ===');
console.log(sample(mine, 0, 0, mine.width, mine.height));
