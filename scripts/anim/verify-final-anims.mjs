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

function diff(a, b) {
  const w = Math.min(a.w, b.w), h = Math.min(a.h, b.h);
  let d = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * Math.min(a.w, b.w) + x) * 4;
      if (Math.abs(a.rgba[i]-b.rgba[i]) > 20 || Math.abs(a.rgba[i+1]-b.rgba[i+1]) > 20 || Math.abs(a.rgba[i+2]-b.rgba[i+2]) > 20) d++;
    }
  }
  return d;
}

// 后发动画循环性: f0 vs f131 (f132 是特殊帧)
const dir = 'D:/dsh-wallpaper-engine/scene-layers-out/backhair_frames';
const f0 = readPng(path.join(dir, 'frame_00.png'));
const f60 = readPng(path.join(dir, 'frame_60.png'));
const f131 = readPng(path.join(dir, 'frame_131.png'));
console.log('后发: f0 vs f60:', diff(f0, f60), 'px (摆动幅度)');
console.log('后发: f0 vs f131:', diff(f0, f131), 'px (循环衔接)');

// 呼吸帧循环性
const dir2 = 'D:/dsh-wallpaper-engine/scene-layers-out/breath_frames';
const b0 = readPng(path.join(dir2, 'frame_00.png'));
const b30 = readPng(path.join(dir2, 'frame_30.png'));
const b60 = readPng(path.join(dir2, 'frame_60.png'));
console.log('\n呼吸: f0 vs f30:', diff(b0, b30), 'px');
console.log('呼吸: f0 vs f60:', diff(b0, b60), 'px (循环衔接)');

// anim1 眨眼: f12 (静止) vs f67 (摆动峰值)
const dir3 = 'D:/dsh-wallpaper-engine/scene-layers-out/anim1_uniform';
const a12 = readPng(path.join(dir3, 'frame_012.png'));
const a67 = readPng(path.join(dir3, 'frame_067.png'));
console.log('\n眨眼: f12 vs f67:', diff(a12, a67), 'px (眨眼幅度)');
