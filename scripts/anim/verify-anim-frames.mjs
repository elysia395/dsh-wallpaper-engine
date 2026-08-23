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

function framePath(dir, i) {
  return path.join(dir, `frame_${String(i).padStart(3)}.png`);
}

function diffPct(a, b) {
  const w = Math.min(a.w, b.w), h = Math.min(a.h, b.h);
  let diff = 0, total = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (a.rgba[i+3] > 10 || b.rgba[i+3] > 10) {
        total++;
        const da = Math.abs(a.rgba[i]-b.rgba[i]) + Math.abs(a.rgba[i+1]-b.rgba[i+1]) + Math.abs(a.rgba[i+2]-b.rgba[i+2]);
        if (da > 40) diff++;
      }
    }
  }
  return total ? diff / total * 100 : 0;
}

// 动画1 相邻帧差异 (呼吸摆动)
console.log('=== 动画1 相邻帧差异 ===');
const dir1 = 'D:/dsh-wallpaper-engine/scene-layers-out/mdla_anim1';
const cache1 = new Map();
function get1(i) {
  if (!cache1.has(i)) cache1.set(i, readPng(framePath(dir1, i)));
  return cache1.get(i);
}
for (let i = 10; i < 133; i += 15) {
  const pct = diffPct(get1(i), get1(i + 1));
  console.log(`  f${i}→f${i+1}: ${pct.toFixed(2)}% 差异`);
}
console.log(`  f12→f132 (循环回跳): ${diffPct(get1(12), get1(132)).toFixed(2)}%`);

// 动画2 相邻帧差异 (长发摆动)
console.log('\n=== 动画2 相邻帧差异 ===');
const dir2 = 'D:/dsh-wallpaper-engine/scene-layers-out/mdla_anim2';
const cache2 = new Map();
function get2(i) {
  if (!cache2.has(i)) cache2.set(i, readPng(framePath(dir2, i)));
  return cache2.get(i);
}
for (const i of [12, 30, 50, 70, 90, 110, 125, 130, 132, 200, 400]) {
  const pct = diffPct(get2(i), get2(i + 1));
  console.log(`  f${i}→f${i+1}: ${pct.toFixed(2)}% 差异`);
}
console.log(`  f12→f132: ${diffPct(get2(12), get2(132)).toFixed(2)}%`);
console.log(`  f132→f600: ${diffPct(get2(132), get2(600)).toFixed(2)}%`);
