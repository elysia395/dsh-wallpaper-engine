import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

function readPng(file) {
  const buf = fs.readFileSync(file);
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  let idat = Buffer.alloc(0);
  let pos = 8;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    if (type === 'IDAT') idat = Buffer.concat([idat, buf.slice(pos + 8, pos + 8 + len)]);
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(idat);
  const rgba = Buffer.alloc(w * h * 4);
  const stride = w * 4 + 1;
  for (let y = 0; y < h; y++) raw.copy(rgba, y * w * 4, y * stride + 1, (y + 1) * stride);
  return { w, h, rgba };
}

function diffStats(a, b) {
  const w = a.w, h = a.h;
  let diff = 0, total = 0;
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (a.rgba[i+3] > 10 || b.rgba[i+3] > 10) {
        total++;
        const da = Math.abs(a.rgba[i]-b.rgba[i]) + Math.abs(a.rgba[i+1]-b.rgba[i+1]) + Math.abs(a.rgba[i+2]-b.rgba[i+2]);
        if (da > 30) {
          diff++;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
  }
  return { diff, total, pct: total ? diff/total*100 : 0, minX, maxX, minY, maxY };
}

const dir = 'D:/dsh-wallpaper-engine/scene-layers-out/mdla_anim2_uniform';
const frame = (i) => readPng(path.join(dir, `frame_${String(i).padStart(3)}.png`));
console.log('画布:', frame(12).w + 'x' + frame(12).h);

console.log('\n=== 动画2 帧间差异 (统一画布) ===');
for (const i of [12, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 132, 150, 300, 500]) {
  const s = diffStats(frame(i), frame(i + 1));
  console.log(`  f${i}→f${i+1}: ${s.pct.toFixed(3)}% (${s.diff}px) 区域 x[${s.minX}-${s.maxX}] y[${s.minY}-${s.maxY}]`);
}

console.log('\n=== 摆动段整体 f12 vs f132 ===');
const s = diffStats(frame(12), frame(132));
console.log(`  ${s.pct.toFixed(2)}% (${s.diff}px) 区域 x[${s.minX}-${s.maxX}] y[${s.minY}-${s.maxY}]`);
