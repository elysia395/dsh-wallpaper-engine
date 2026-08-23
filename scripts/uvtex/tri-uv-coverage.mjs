import fs from 'fs';
import { parseTex, decodeTex } from 'file:///D:/dsh-wallpaper-engine/lib/pkg-extract.js';

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
// 三角形 UV 覆盖的贴图区域（8x8） vs 贴图内容
const buf = read('models/人物_puppet.mdl');
const dv2 = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const indices = [];
for (let i = 0; i < 5358 / 2; i++) indices.push(dv2.getUint16(50803 + i * 2, true));
const verts = [];
for (let i = 0; i < 634; i++) {
  const o = 79 + i * 80;
  verts.push([dv2.getFloat32(o + 72, true), dv2.getFloat32(o + 76, true)]);
}
// 三角形质心 UV 分布（更准确反映覆盖）
const triGrid = Array.from({ length: 8 }, () => new Array(8).fill(0));
for (let t = 0; t < indices.length; t += 3) {
  const a = verts[indices[t]], b = verts[indices[t+1]], c = verts[indices[t+2]];
  const cu = (a[0] + b[0] + c[0]) / 3, cv = (a[1] + b[1] + c[1]) / 3;
  const gx = Math.min(7, Math.max(0, Math.floor(cu * 8)));
  const gy = Math.min(7, Math.max(0, Math.floor(cv * 8)));
  triGrid[gy][gx]++;
}
console.log('三角形质心 UV 分布（8x8）:');
for (let gy = 0; gy < 8; gy++) {
  console.log('  v' + (gy * 12.5).toFixed(0) + '%: ' + triGrid[gy].map((n) => String(n).padStart(4)).join(' '));
}

// 贴图内容
const info = parseTex(read('materials/人物.tex'));
const dec = decodeTex(read('materials/人物.tex'));
const w = info.width, h = info.height, srcW = dec.width;
const tdata = dec.rgba;
console.log('\n贴图内容（8x8 非空%）:');
for (let gy = 0; gy < 8; gy++) {
  const cells = [];
  for (let gx = 0; gx < 8; gx++) {
    let cnt = 0, tot = 0;
    const x0 = (w * gx) / 8 | 0, x1 = (w * (gx + 1)) / 8 | 0;
    const y0 = (h * gy) / 8 | 0, y1 = (h * (gy + 1)) / 8 | 0;
    for (let y = y0; y < y1; y += 3) {
      for (let x = x0; x < x1; x += 3) {
        tot++;
        if (tdata[(y * srcW + x) * 4 + 3] > 10) cnt++;
      }
    }
    cells.push((100 * cnt / tot).toFixed(0));
  }
  console.log('  v' + (gy * 12.5).toFixed(0) + '%: ' + cells.map((s) => s.padStart(3)).join(' '));
}

// 关键对比：贴图有内容但三角形质心无覆盖的区域
console.log('\n贴图内容>10% 但三角形质心覆盖=0 的区域（缺失）:');
for (let gy = 0; gy < 8; gy++) {
  for (let gx = 0; gx < 8; gx++) {
    const x0 = (w * gx) / 8 | 0, x1 = (w * (gx + 1)) / 8 | 0;
    const y0 = (h * gy) / 8 | 0, y1 = (h * (gy + 1)) / 8 | 0;
    let cnt = 0, tot = 0;
    for (let y = y0; y < y1; y += 3) {
      for (let x = x0; x < x1; x += 3) {
        tot++;
        if (tdata[(y * srcW + x) * 4 + 3] > 10) cnt++;
      }
    }
    const pct = 100 * cnt / tot;
    if (pct > 10 && triGrid[gy][gx] === 0) {
      console.log('  u[' + (gx / 8).toFixed(2) + ',' + ((gx + 1) / 8).toFixed(2) + '] v[' + (gy / 8).toFixed(2) + ',' + ((gy + 1) / 8).toFixed(2) + '] 内容' + pct.toFixed(0) + '%');
    }
  }
}
