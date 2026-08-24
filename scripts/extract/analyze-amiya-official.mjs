// 分析官方 preview 帧: 人物轮廓 (头部是否完整可见)
import { createRequire } from 'module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const sharp = require('C:/Users/Kai/.dsh/profiles/node_modules/sharp');

// 官方帧 (多帧平均找稳定人物)
const src = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/preview.gif';
// 取帧 5, 15, 25 分析
for (const page of [5, 15, 25]) {
  const { data, info } = await sharp(src, { page }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  // 非白内容 bbox + 垂直分布
  let minX = W, minY = H, maxX = -1, maxY = -1, nz = 0;
  const rowCount = new Array(H).fill(0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    const lum = 0.3 * data[i] + 0.6 * data[i+1] + 0.1 * data[i+2];
    if (lum < 230) { nz++; rowCount[y]++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  console.log(`page=${page}: 非白 ${nz} bbox ${minX},${minY}..${maxX},${maxY}`);
  // 垂直带分布 (每 20px)
  let prev = -1;
  for (let y = 0; y < H; y += 10) {
    const cnt = rowCount.slice(y, Math.min(y + 10, H)).reduce((a, b) => a + b, 0);
    const bar = Math.round(cnt / 40);
    console.log(`  y=${String(y).padStart(3)}: ${String(cnt).padStart(5)} ${'#'.repeat(Math.min(50, bar))}`);
  }
}
