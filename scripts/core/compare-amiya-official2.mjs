// 对比: 我的 Amiya 渲染 (880x495 → 220x220) vs 官方 preview.gif 帧 0
import { createRequire } from 'module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const sharp = require('C:/Users/Kai/.dsh/profiles/node_modules/sharp');

const mine = await sharp('scripts/out/amiya_mine_880.png').resize(220, 220, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const off = await sharp('C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/preview.gif', { page: 0 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
console.log('官方帧0: ' + off.info.width + 'x' + off.info.height + ' 我的: ' + mine.info.width + 'x' + mine.info.height);

const W = 220, H = 220;
console.log('3x3 网格平均通道差 (0-255, 越小越接近):');
for (let gy = 0; gy < 3; gy++) {
  let line = '';
  for (let gx = 0; gx < 3; gx++) {
    let sum = 0, n = 0;
    for (let y = Math.floor(gy * H / 3); y < Math.floor((gy + 1) * H / 3); y++) {
      for (let x = Math.floor(gx * W / 3); x < Math.floor((gx + 1) * W / 3); x++) {
        const mi = (y * W + x) * 3, oi = (y * W + x) * 3;
        const d = Math.abs(mine.data[mi] - off.data[oi]) + Math.abs(mine.data[mi+1] - off.data[oi+1]) + Math.abs(mine.data[mi+2] - off.data[oi+2]);
        sum += d; n++;
      }
    }
    line += (sum / n / 3).toFixed(0).padStart(4) + ' ';
  }
  console.log('  y' + gy + ': ' + line);
}
// 官方帧0 保存
const offPng = await sharp('C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/preview.gif', { page: 0 }).png().toBuffer();
fs.writeFileSync('scripts/out/amiya_official_frame0.png', offPng);
console.log('官方帧0 保存: scripts/out/amiya_official_frame0.png');
