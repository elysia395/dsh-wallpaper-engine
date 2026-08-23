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

function diffBox(a, b) {
  const w = a.w, h = a.h;
  let diff = 0, minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const da = Math.abs(a.rgba[i]-b.rgba[i]) + Math.abs(a.rgba[i+1]-b.rgba[i+1]) + Math.abs(a.rgba[i+2]-b.rgba[i+2]);
      if (da > 30) {
        diff++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  return { diff, minX, maxX, minY, maxY };
}

// 对比: 纯长发 frame vs 混合 frame (同帧号)
const d1 = 'D:/dsh-wallpaper-engine/scene-layers-out/anim_frames';
const d2 = 'D:/dsh-wallpaper-engine/scene-layers-out/anim_frames_mdla_mix';
const frame = (dir, i) => readPng(path.join(dir, `frame_${String(i).padStart(2)}.png`));

console.log('=== 纯长发 vs 混合 差异 (同帧) ===');
for (const i of [0, 10, 20, 30, 40, 50, 60]) {
  const a = frame(d1, i), b = frame(d2, i);
  if (a.w !== b.w || a.h !== b.h) { console.log(`f${i}: 尺寸不同 ${a.w}x${a.h} vs ${b.w}x${b.h}`); continue; }
  const d = diffBox(a, b);
  console.log(`  f${i}: ${d.diff}px 区域 x[${d.minX}-${d.maxX}] y[${d.minY}-${d.maxY}]`);
}

console.log('\n=== 混合动画相邻帧差异 (f0→f1, f15→f16, f30→f31) ===');
for (const i of [0, 15, 30, 45]) {
  const a = frame(d2, i), b = frame(d2, i + 1);
  const d = diffBox(a, b);
  console.log(`  f${i}→f${i+1}: ${d.diff}px`);
}
