import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

// 验证 waterwaves 数学: 用 CPU 实现 shader 的纹理位移, 对比原图
// waterwaves: texCoord += sin(distance)^exponent * sign * offset * strength² * mask
// 生成两个时间点的位移效果图

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

function encodePng(w, h, rgba) {
  const buf = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) { raw[y * stride] = 0; buf.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4); }
  const idat = zlib.deflateSync(raw, { level: 6 });
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  function crc32(b) {
    let c, t = [];
    for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
    let crc = 0xffffffff;
    for (let i = 0; i < b.length; i++) crc = t[(crc ^ b[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const img = readPng('D:/dsh-wallpaper-engine/scene-layers-out/水.png');
console.log('水图:', img.w + 'x' + img.h);

// 应用 waterwaves (双波 + ripple + shake 简化)
// wave1: direction -2.133, scale 2, speed 2.03, strength 0.1
// wave2: direction 2.453, scale 44.85, speed 0.46, strength 0.07
function applyWaves(src, t) {
  const { w, h, rgba } = src;
  const out = Buffer.alloc(w * h * 4);
  const dir1 = { x: Math.cos(-2.133), y: Math.sin(-2.133) };
  const dir2 = { x: Math.cos(2.453), y: Math.sin(2.453) };
  const strength1 = 0.1 * 0.1;
  const strength2 = 0.07 * 0.07;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w, v = (y + 0.5) / h;
      const tc = [u, v];
      // wave1
      const d1 = t * 2.03 + (tc[0] * dir1.x + tc[1] * dir1.y) * 2;
      const val1 = Math.sin(d1);
      const off1 = { x: dir1.y, y: -dir1.x };
      tc[0] += val1 * off1.x * strength1;
      tc[1] += val1 * off1.y * strength1;
      // wave2
      const d2 = t * 0.46 + (tc[0] * dir2.x + tc[1] * dir2.y) * 44.85;
      const val2 = Math.sin(d2);
      const off2 = { x: dir2.y, y: -dir2.x };
      tc[0] += val2 * off2.x * strength2;
      tc[1] += val2 * off2.y * strength2;
      // 采样
      const sx = Math.max(0, Math.min(w - 1, Math.floor(tc[0] * w)));
      const sy = Math.max(0, Math.min(h - 1, Math.floor(tc[1] * h)));
      const si = (sy * w + sx) * 4;
      const di = (y * w + x) * 4;
      out[di] = rgba[si]; out[di+1] = rgba[si+1]; out[di+2] = rgba[si+2]; out[di+3] = rgba[si+3];
    }
  }
  return { w, h, rgba: out };
}

// 生成 t=0, t=2, t=4 三帧, 对比差异
const t0 = applyWaves(img, 0);
const t2 = applyWaves(img, 2);
const t4 = applyWaves(img, 4);
fs.writeFileSync('D:/dsh-wallpaper-engine/scene-layers-out/water_wave_t0.png', encodePng(t0.w, t0.h, t0.rgba));
fs.writeFileSync('D:/dsh-wallpaper-engine/scene-layers-out/water_wave_t2.png', encodePng(t2.w, t2.h, t2.rgba));
fs.writeFileSync('D:/dsh-wallpaper-engine/scene-layers-out/water_wave_t4.png', encodePng(t4.w, t4.h, t4.rgba));

// 差异统计
function diff(a, b) {
  let d = 0;
  for (let i = 0; i < a.rgba.length; i += 4) {
    if (Math.abs(a.rgba[i]-b.rgba[i]) > 20 || Math.abs(a.rgba[i+1]-b.rgba[i+1]) > 20 || Math.abs(a.rgba[i+2]-b.rgba[i+2]) > 20) d++;
  }
  return d;
}
console.log('t0 vs t2 差异:', diff(t0, t2), 'px');
console.log('t2 vs t4 差异:', diff(t2, t4), 'px');
console.log('水图总像素:', img.w * img.h);
