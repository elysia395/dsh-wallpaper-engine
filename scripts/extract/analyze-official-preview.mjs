// 分析官方预览帧0: 非透明区域分布 + 大结构 (上/中/下三带 + 左右分布)
import { createRequire } from 'module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const sharp = require('C:/Users/Kai/.dsh/profiles/node_modules/sharp');

const buf = fs.readFileSync('scripts/out/amiya_preview_frame0.png');
const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
console.log('帧0: ' + W + 'x' + H);
// 非透明 (PNG 有 alpha? 已 removeAlpha → 无 alpha, 全不透明)
// 分析亮度分布: 非白像素 (背景可能白色)
let minX = W, minY = H, maxX = -1, maxY = -1, nz = 0;
const rowCount = new Array(H).fill(0);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    const r = data[i], g = data[i+1], b = data[i+2];
    const lum = 0.3 * r + 0.6 * g + 0.1 * b;
    if (lum < 235) { // 非白
      nz++;
      rowCount[y]++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
}
console.log(`非白内容: ${nz}px bbox=${minX},${minY}..${maxX},${maxY}`);
// 垂直分布: 每 11px 一条带
for (let y = 0; y < H; y += 11) {
  const cnt = rowCount.slice(y, Math.min(y + 11, H)).reduce((a, b) => a + b, 0);
  const bar = '#'.repeat(Math.min(40, Math.round(cnt / 50)));
  console.log(`y=${String(y).padStart(3)}: ${String(cnt).padStart(5)} ${bar}`);
}
