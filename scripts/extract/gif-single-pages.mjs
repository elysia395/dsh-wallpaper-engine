// 提取 GIF 单帧 (page) 并分析布局
import { createRequire } from 'module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const sharp = require('C:/Users/Kai/.dsh/profiles/node_modules/sharp');

const src = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/preview.gif';
for (const page of [0, 5, 10, 15, 20, 30]) {
  try {
    const { data, info } = await sharp(src, { page }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height;
    let minX = W, minY = H, maxX = -1, maxY = -1, nz = 0;
    const rowCount = new Array(H).fill(0);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 3;
        const lum = 0.3 * data[i] + 0.6 * data[i+1] + 0.1 * data[i+2];
        if (lum < 235) {
          nz++;
          rowCount[y]++;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    console.log(`page=${page} ${W}x${H} 非白=${nz} bbox=${minX},${minY}..${maxX},${maxY}`);
    // 垂直带分布 (每 20px)
    for (let y = 0; y < H; y += 20) {
      const cnt = rowCount.slice(y, Math.min(y + 20, H)).reduce((a, b) => a + b, 0);
      if (cnt > 0) console.log(`  y=${String(y).padStart(3)}: ${String(cnt).padStart(5)} ${'#'.repeat(Math.min(40, Math.round(cnt / 100)))}`);
    }
  } catch (e) {
    console.log(`page=${page} ERR: ${e.message}`);
  }
}
