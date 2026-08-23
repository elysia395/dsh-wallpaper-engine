/**
 * 程序化骨骼动画原型：用已解析的骨骼锚点 + 蒙皮权重，正弦波驱动骨骼旋转。
 * 顶点 finalPos = rawPos + Σ w_i × (R_i(θ_i) × (rawPos - anchor_i) - (rawPos - anchor_i))
 * 输出：渲染 1 帧测试 PNG，验证动画数学。
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { parseTex, decodeTex } from 'file:///D:/dsh-wallpaper-engine/lib/pkg-extract.js';

const OUT = 'D:/dsh-wallpaper-engine/scene-layers-out';
const PKG = 'c:/program files (x86)/steam/steamapps/workshop/content/431960/3461168300/scene.pkg';

function readPkg() {
  const data = fs.readFileSync(PKG);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 0;
  const rstr = () => { const len = dv.getInt32(pos, true); pos += 4; const s = data.toString('utf8', pos, pos + len); pos += len; return s; };
  rstr(); const count = dv.getInt32(pos, true); pos += 4;
  const entries = [];
  for (let i = 0; i < count; i++) { const p = rstr(); const off = dv.getUint32(pos, true); const len = dv.getUint32(pos + 4, true); pos += 8; entries.push({ p, off, len }); }
  const dataStart = pos;
  const byPath = Object.fromEntries(entries.map((e) => [e.p, e]));
  function lz4(src, dstSize) {
    const dst = new Uint8Array(dstSize);
    let ip = 0, op = 0;
    while (ip < src.length) {
      const t = src[ip++];
      let lit = t >> 4;
      if (lit === 15) { let s = 0; do { s = src[ip++]; lit += s; } while (s === 255); }
      dst.set(src.subarray(ip, ip + lit), op); ip += lit; op += lit;
      if (ip >= src.length) break;
      const off = src[ip] | (src[ip + 1] << 8); ip += 2;
      let ml = t & 15;
      if (ml === 15) { let s = 0; do { s = src[ip++]; ml += s; } while (s === 255); }
      ml += 4;
      for (let i = 0; i < ml; i++) { dst[op] = dst[op - off]; op++; }
    }
    return dst;
  }
  const read = (p) => {
    const e = byPath[p];
    if (!e) return null;
    const abs = dataStart + e.off;
    const seg = data.subarray(abs, abs + e.len);
    const orig = dv.getUint32(abs, true) + dv.getUint32(abs + 4, true) * 4294967296;
    if (orig <= e.len || orig > 2147483647) return seg;
    let r = abs + 8;
    const out = new Uint8Array(orig);
    let written = 0;
    while (written < orig) {
      const u = dv.getInt32(r, true), c = dv.getInt32(r + 4, true);
      r += 8;
      out.set(lz4(data.subarray(r, r + c), u), written);
      r += c; written += u;
    }
    return out;
  };
  return { read };
}

const { read } = readPkg();
const buf = read('models/人物_puppet.mdl');
const dv2 = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const mdls = 64571, mdla = 79842;

// 1. 解析骨骼锚点
let p = mdls + 17;
const anchors = {};
for (let b = 0; b < 53 && p < mdla; b++) {
  const tmp = buf[p];
  const type = dv2.getUint32(p + 1, true);
  const parent = dv2.getUint32(p + 5, true);
  const entryLen = dv2.getUint32(p + 9, true);
  if (entryLen <= 0 || entryLen > 10000) { p += 9; continue; }
  const floats = [];
  for (let i = 0; i < Math.floor(entryLen / 4); i++) floats.push(dv2.getFloat32(p + 13 + i * 4, true));
  const infoStart = p + 13 + entryLen;
  let infoStr = '';
  let ip2 = infoStart;
  while (ip2 < buf.length && buf[ip2] >= 32 && buf[ip2] < 127) { infoStr += String.fromCharCode(buf[ip2]); ip2++; }
  anchors[b] = { x: floats[12], y: floats[13], parent };
  p = infoStart + infoStr.length + 1;
}

// 2. 解析顶点
const vc = 634;
const verts = [];
for (let i = 0; i < vc; i++) {
  const o = 79 + i * 80;
  verts.push({
    x: dv2.getFloat32(o, true), y: dv2.getFloat32(o + 4, true),
    bones: [dv2.getUint32(o + 40, true), dv2.getUint32(o + 44, true), dv2.getUint32(o + 48, true), dv2.getUint32(o + 52, true)],
    weights: [dv2.getFloat32(o + 56, true), dv2.getFloat32(o + 60, true), dv2.getFloat32(o + 64, true), dv2.getFloat32(o + 68, true)],
    uv: [dv2.getFloat32(o + 72, true), dv2.getFloat32(o + 76, true)],
  });
}
const indices = [];
for (let i = 0; i < 5358 / 2; i++) indices.push(dv2.getUint16(50803 + i * 2, true));

// 3. 纹理
const texInfo = parseTex(read('materials/人物.tex'));
const texDec = decodeTex(read('materials/人物.tex'));
const tw = texInfo.width, th = texInfo.height, srcW = texDec.width;
const tdata = texDec.rgba;

// 4. 蒙皮函数: 给定时间 t，计算顶点位置
function skin(t) {
  const out = [];
  for (const v of verts) {
    let fx = v.x, fy = v.y;
    for (let k = 0; k < 4; k++) {
      const w = v.weights[k];
      if (w <= 0.001) continue;
      const b = v.bones[k];
      const an = anchors[b];
      if (!an) continue;
      // 骨骼旋转角：按骨骼分组赋予不同摆动
      // B0=根(微呼吸), B1-B37=身体(微摆动), B38-B52=裙摆/发丝(大摆动)
      let amp = 0;
      if (b >= 38) amp = 0.06;      // 裙摆/长发
      else if (b >= 4) amp = 0.015; // 身体部件
      else if (b >= 1) amp = 0.01;  // 主干
      const theta = amp * Math.sin(t * 2 + b * 0.7);
      const cos = Math.cos(theta), sin = Math.sin(theta);
      const lx = v.x - an.x, ly = v.y - an.y;
      // 旋转局部偏移
      const rx = lx * cos - ly * sin;
      const ry = lx * sin + ly * cos;
      // 世界位置 = 锚点 + 旋转后偏移
      const wx = an.x + rx, wy = an.y + ry;
      // 增量 = 旋转带来的位移
      fx += w * (wx - v.x);
      fy += w * (wy - v.y);
    }
    out.push([fx, fy]);
  }
  return out;
}

// 5. 渲染函数
function encodePng(w, h, rgba) {
  const buf2 = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) { raw[y * stride] = 0; buf2.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4); }
  const idat = zlib.deflateSync(raw);
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

function render(positions, filename) {
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const v of verts) {
    // 用原始范围（保持画布稳定）
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
  }
  const w = Math.ceil(maxX - minX), h = Math.ceil(maxY - minY);
  const rgba = new Uint8Array(w * h * 4);
  const flipY = (y) => maxY - y;
  // premultiplied 采样 + alpha 混合
  const ALPHA_CUTOFF = 8;
  function sample(u, v) {
    const fx = u * tw - 0.5, fy = v * th - 0.5;
    const x0 = Math.max(0, Math.min(tw - 1, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(th - 1, Math.floor(fy)));
    const x1 = Math.min(tw - 1, x0 + 1), y1 = Math.min(th - 1, y0 + 1);
    const tx = fx - x0, ty = fy - y0;
    const i00 = (y0 * srcW + x0) * 4, i10 = (y0 * srcW + x1) * 4;
    const i01 = (y1 * srcW + x0) * 4, i11 = (y1 * srcW + x1) * 4;
    const pm = [
      [tdata[i00] * tdata[i00+3], tdata[i00+1] * tdata[i00+3], tdata[i00+2] * tdata[i00+3], tdata[i00+3]],
      [tdata[i10] * tdata[i10+3], tdata[i10+1] * tdata[i10+3], tdata[i10+2] * tdata[i10+3], tdata[i10+3]],
      [tdata[i01] * tdata[i01+3], tdata[i01+1] * tdata[i01+3], tdata[i01+2] * tdata[i01+3], tdata[i01+3]],
      [tdata[i11] * tdata[i11+3], tdata[i11+1] * tdata[i11+3], tdata[i11+2] * tdata[i11+3], tdata[i11+3]],
    ];
    const out = [0, 0, 0, 0];
    for (let c = 0; c < 4; c++) {
      const top = pm[0][c] * (1 - tx) + pm[1][c] * tx;
      const bot = pm[2][c] * (1 - tx) + pm[3][c] * tx;
      out[c] = top * (1 - ty) + bot * ty;
    }
    if (out[3] < ALPHA_CUTOFF) return [0, 0, 0, 0];
    const a = out[3];
    return [Math.min(255, Math.round(out[0] / a)), Math.min(255, Math.round(out[1] / a)), Math.min(255, Math.round(out[2] / a)), Math.round(a)];
  }
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t], i1 = indices[t + 1], i2 = indices[t + 2];
    const a = [positions[i0][0] - minX, flipY(positions[i0][1])];
    const b = [positions[i1][0] - minX, flipY(positions[i1][1])];
    const c = [positions[i2][0] - minX, flipY(positions[i2][1])];
    const bx0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    const bx1 = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const by0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    const by1 = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    if (bx1 < bx0 || by1 < by0) continue;
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(area) < 1e-9) continue;
    const w0 = verts[i0].uv, w1 = verts[i1].uv, w2 = verts[i2].uv;
    for (let y = by0; y <= by1; y++) {
      for (let x = bx0; x <= bx1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const la = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
        const lb = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
        const lc = ((a[0] - px) * (b[1] - py) - (a[1] - py) * (b[0] - px)) / area;
        if (la < -1e-4 || lb < -1e-4 || lc < -1e-4) continue;
        const di = (y * w + x) * 4;
        const u = la * w0[0] + lb * w1[0] + lc * w2[0];
        const v = la * w0[1] + lb * w1[1] + lc * w2[1];
        const s = sample(u, v);
        const srcA = s[3] / 255;
        if (srcA <= 0) continue;
        const dstA = rgba[di + 3] / 255;
        const outA = srcA + dstA * (1 - srcA);
        if (outA <= 0) continue;
        rgba[di] = Math.round((s[0] * srcA + rgba[di] * dstA * (1 - srcA)) / outA);
        rgba[di + 1] = Math.round((s[1] * srcA + rgba[di + 1] * dstA * (1 - srcA)) / outA);
        rgba[di + 2] = Math.round((s[2] * srcA + rgba[di + 2] * dstA * (1 - srcA)) / outA);
        rgba[di + 3] = Math.round(outA * 255);
      }
    }
  }
  fs.writeFileSync(path.join(OUT, filename), encodePng(w, h, rgba));
  let nz = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 10) nz++;
  console.log(filename, w + 'x' + h, '非空', (100 * nz / (w * h)).toFixed(1) + '%');
}

// 渲染 3 帧测试
for (const t of [0, 0.5, 1.0]) {
  const positions = skin(t);
  render(positions, 'anim_test_t' + t + '.png');
}
