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

// 验证后发动画帧 f0 vs f30 的差异区域 (确认长发摆动位置)
const dir = 'D:/dsh-wallpaper-engine/scene-layers-out/backhair_frames';
const f0 = readPng(path.join(dir, 'frame_00.png'));
const f30 = readPng(path.join(dir, 'frame_30.png'));

// 差异 ASCII 图
const w = f0.w, h = f0.h;
const CW = 46, CH = 30;
const grid = Array.from({ length: CH }, () => new Array(CW).fill(' '));
let diffCount = 0;
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const da = Math.abs(f0.rgba[i]-f30.rgba[i]) + Math.abs(f0.rgba[i+1]-f30.rgba[i+1]) + Math.abs(f0.rgba[i+2]-f30.rgba[i+2]);
    if (da > 30) {
      diffCount++;
      const gx = Math.floor(x / w * CW), gy = Math.floor(y / h * CH);
      if (gx >= 0 && gx < CW && gy >= 0 && gy < CH) grid[gy][gx] = '#';
    }
  }
}
console.log(`后发 f0 vs f30 差异: ${diffCount}px`);
console.log('=== 后发摆动差异分布 (画布 2246x1691) ===');
for (const row of grid) console.log(row.join(''));

// 后发内容分布
const cgrid = Array.from({ length: CH }, () => new Array(CW).fill(' '));
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    if (f0.rgba[(y * w + x) * 4 + 3] > 10) {
      const gx = Math.floor(x / w * CW), gy = Math.floor(y / h * CH);
      if (gx >= 0 && gx < CW && gy >= 0 && gy < CH) cgrid[gy][gx] = '#';
    }
  }
}
console.log('\n=== 后发 f0 内容分布 ===');
for (const row of cgrid) console.log(row.join(''));
