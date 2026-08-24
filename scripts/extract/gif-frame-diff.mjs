// preview.gif 帧间差异: 定位人物位置 (动画变化区域)
import { createRequire } from 'module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const sharp = require('C:/Users/Kai/.dsh/profiles/node_modules/sharp');

const src = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/preview.gif';
// 读多帧
const frames = [];
for (const page of [0, 5, 10, 15, 20, 25, 30, 35]) {
  const { data, info } = await sharp(src, { page }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  frames.push({ page, data, info });
}
const W = frames[0].info.width, H = frames[0].info.height;
// 帧间差异 (帧5 vs 帧0): 变化区域 = 动画/人物
const [f0, f5] = [frames[0].data, frames[1].data];
let minX = W, minY = H, maxX = -1, maxY = -1, diffPx = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * 3;
  const d = Math.abs(f0[i]-f5[i]) + Math.abs(f0[i+1]-f5[i+1]) + Math.abs(f0[i+2]-f5[i+2]);
  if (d > 30) {
    diffPx++;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
}
console.log(`帧0 vs 帧5 差异: ${diffPx}px bbox=(${minX},${minY})..(${maxX},${maxY})`);
// 差异分布 (每 20px 带)
if (diffPx > 100) {
  const rows = new Array(Math.ceil(H / 10)).fill(0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    const d = Math.abs(f0[i]-f5[i]) + Math.abs(f0[i+1]-f5[i+1]) + Math.abs(f0[i+2]-f5[i+2]);
    if (d > 30) rows[Math.floor(y / 10)]++;
  }
  for (let y = 0; y < rows.length; y++) {
    if (rows[y] > 0) console.log(`  y=${String(y*10).padStart(3)}: ${rows[y]} ${'#'.repeat(Math.min(40, Math.round(rows[y]/30)))}`);
  }
} else {
  console.log('差异太小 — 静态 GIF?');
}
