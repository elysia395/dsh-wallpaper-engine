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

// 对比 anim1 的 f12 vs f67 (B4 摆动峰值) —— 用之前生成的 mdla_anim1 帧
const dir = 'D:/dsh-wallpaper-engine/scene-layers-out/mdla_anim1';
const f12 = readPng(path.join(dir, 'frame_ 12.png'));
const f67 = readPng(path.join(dir, 'frame_ 67.png'));
console.log('f12:', f12.w + 'x' + f12.h, 'f67:', f67.w + 'x' + f67.h);

// 找差异区域 (B4 摆动影响)
const w = Math.min(f12.w, f67.w), h = Math.min(f12.h, f67.h);
let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, diff = 0;
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const da = Math.abs(f12.rgba[i]-f67.rgba[i]) + Math.abs(f12.rgba[i+1]-f67.rgba[i+1]) + Math.abs(f12.rgba[i+2]-f67.rgba[i+2]);
    if (da > 40) {
      diff++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
}
console.log(`差异: ${diff}px 区域 x[${minX}-${maxX}] y[${minY}-${maxY}]`);
console.log(`画布 ${w}x${h}, 差异区域相对位置: x ${(minX/w*100).toFixed(0)}-${(maxX/w*100).toFixed(0)}%, y ${(minY/h*100).toFixed(0)}-${(maxY/h*100).toFixed(0)}%`);

// ASCII 显示差异区域 (40x26)
const CW = 40, CH = 26;
const grid = Array.from({ length: CH }, () => new Array(CW).fill(' '));
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const da = Math.abs(f12.rgba[i]-f67.rgba[i]) + Math.abs(f12.rgba[i+1]-f67.rgba[i+1]) + Math.abs(f12.rgba[i+2]-f67.rgba[i+2]);
    if (da > 40) {
      const gx = Math.floor(x / w * CW), gy = Math.floor(y / h * CH);
      if (gx >= 0 && gx < CW && gy >= 0 && gy < CH) grid[gy][gx] = '#';
    }
  }
}
console.log('\n=== anim1 f12 vs f67 差异区域 (B4 摆动) ===');
for (const row of grid) console.log(row.join(''));
