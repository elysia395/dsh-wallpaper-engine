// 预渲染水波帧序列: Node 端 CPU 实现 waterwaves shader 数学
// 输出 water_frames_v17/frame_XX.png (480x220 波纹图), demo 轮播 drawImage 即可
// 避免浏览器 getImageData (file:// canvas 污染 SecurityError)
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const OUT = 'D:/dsh-wallpaper-engine/scene-layers-out';
const SRC = path.join(OUT, '水.png');
const FRAMES = 60;          // 2 秒循环 @30fps (每帧 1/30s, t = k/30)
const SW = 960;             // 提高分辨率 (480→960, 放大 4 倍显示更清晰)
const SH = 440;

function readPNG(p) {
  const b = fs.readFileSync(p);
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  let idat = Buffer.alloc(0);
  let pos = 8;
  while (pos < b.length) {
    const len = b.readUInt32BE(pos);
    const type = b.toString('ascii', pos + 4, pos + 8);
    if (type === 'IDAT') idat = Buffer.concat([idat, b.slice(pos + 8, pos + 8 + len)]);
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

// 降采样 3840x1760 → 480x220
const { w: WW, h: HH, rgba: src } = readPNG(SRC);
console.log('源图', WW + 'x' + HH);
const down = Buffer.alloc(SW * SH * 4);
for (let y = 0; y < SH; y++) {
  const sy = Math.floor(y / SH * HH);
  for (let x = 0; x < SW; x++) {
    const sx = Math.floor(x / SW * WW);
    const si = (sy * WW + sx) * 4;
    const di = (y * SW + x) * 4;
    for (let c = 0; c < 4; c++) down[di + c] = src[si + c];
  }
}

// waterwaves 数学 (与 shader 一致):
// pos = abs(dot(texCoord-0.5, dir)); distance = time*speed + dot(texCoord,dir)*scale
// offset = (dir.y, -dir.x); texCoord += sin(distance)^exponent * sign * offset * strength^2 * mask
// 两个 waterwaves (direction -2.133/2.453, scale 2/44.85, speed 2.03/0.46, strength 0.1/0.07)
// + waterripple + shake 简化为强度调制
const waves = [
  { dir: -2.1334417, scale: 2, speed: 2.03, strength: 0.1, exp: 1 },
  { dir: 2.4534507, scale: 44.85, speed: 0.46, strength: 0.07, exp: 1.07 },
];

const outDir = path.join(OUT, 'water_frames_v17');
fs.mkdirSync(outDir, { recursive: true });
let maxDisp = 0;
for (let k = 0; k < FRAMES; k++) {
  const t = k / 30;
  const out = Buffer.alloc(down.length);
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      let u = (x + 0.5) / SW, v = (y + 0.5) / SH;
      for (const wv of waves) {
        const dx = Math.cos(wv.dir), dy = Math.sin(wv.dir);
        const dist = t * wv.speed + (u * dx + v * dy) * wv.scale;
        const s = Math.pow(Math.abs(Math.sin(dist)), wv.exp);
        const strength = wv.strength * wv.strength;
        u += s * dy * strength;
        v += -s * dx * strength;
      }
      const sx = Math.max(0, Math.min(SW - 1, Math.floor(u * SW)));
      const sy = Math.max(0, Math.min(SH - 1, Math.floor(v * SH)));
      const disp = Math.hypot(u * SW - (x + 0.5), v * SH - (y + 0.5));
      if (disp > maxDisp) maxDisp = disp;
      const si = (sy * SW + sx) * 4, di = (y * SW + x) * 4;
      for (let c = 0; c < 4; c++) out[di + c] = down[si + c];
    }
  }
  fs.writeFileSync(path.join(outDir, `frame_${String(k).padStart(2, '0')}.png`), encodePng(SW, SH, out));
}
console.log(`water_frames_v17 ${FRAMES} 帧 →`, outDir, '最大位移', maxDisp.toFixed(2), 'offscreen px (×8 =', (maxDisp*8).toFixed(1), 'px @3840)');
