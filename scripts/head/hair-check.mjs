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

// 发.tex 内容分布
const texInfo = parseTex(read('materials/发.tex'));
const texDec = decodeTex(read('materials/发.tex'));
const tw = texInfo.width, th = texInfo.height, srcW = texDec.width;
const tdata = texDec.rgba;
console.log('发.tex 逻辑尺寸:', tw + 'x' + th);
console.log('发.tex 内容（8x8 非空%）:');
for (let gy = 0; gy < 8; gy++) {
  const cells = [];
  for (let gx = 0; gx < 8; gx++) {
    let cnt = 0, tot = 0;
    const x0 = (tw * gx) / 8 | 0, x1 = (tw * (gx + 1)) / 8 | 0;
    const y0 = (th * gy) / 8 | 0, y1 = (th * (gy + 1)) / 8 | 0;
    for (let y = y0; y < y1; y += 4) {
      for (let x = x0; x < x1; x += 4) {
        tot++;
        if (tdata[(y * srcW + x) * 4 + 3] > 10) cnt++;
      }
    }
    cells.push((100 * cnt / tot).toFixed(0));
  }
  console.log('  v' + (gy * 12.5).toFixed(0) + '%: ' + cells.map((s) => s.padStart(3)).join(' '));
}

// 发_puppet.mdl 的 UV 分布
const buf = read('models/发_puppet.mdl');
const dv2 = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
let mdlsOffset = buf.length;
for (let off = 9; off + 4 < buf.length; off++) {
  if (buf[off] === 0x4d && buf[off+1] === 0x44 && buf[off+2] === 0x4c && buf[off+3] === 0x53) { mdlsOffset = off; break; }
}
let found = null;
for (let offset = 9; offset + 12 < mdlsOffset; offset++) {
  const vertexBytes = dv2.getUint32(offset + 4, true);
  if (vertexBytes === 0 || vertexBytes % 80 !== 0) continue;
  const indexLenOffset = offset + 8 + vertexBytes;
  if (indexLenOffset + 4 > mdlsOffset) continue;
  const indexBytes = dv2.getUint32(indexLenOffset, true);
  if (indexBytes === 0 || indexBytes % 2 !== 0 || indexLenOffset + 4 + indexBytes > mdlsOffset) continue;
  found = { verticesOffset: offset + 8, vertexBytes, indexBytes };
  break;
}
if (found) {
  const vc = found.vertexBytes / 80;
  const grid = Array.from({ length: 8 }, () => new Array(8).fill(0));
  for (let i = 0; i < vc; i++) {
    const o = found.verticesOffset + i * 80;
    const u = dv2.getFloat32(o + 72, true);
    const v = dv2.getFloat32(o + 76, true);
    const gx = Math.min(7, Math.max(0, Math.floor(u * 8)));
    const gy = Math.min(7, Math.max(0, Math.floor(v * 8)));
    grid[gy][gx]++;
  }
  console.log('\n发_puppet.mdl UV 分布（8x8 顶点数）:');
  for (let gy = 0; gy < 8; gy++) {
    console.log('  v' + (gy * 12.5).toFixed(0) + '%: ' + grid[gy].map((n) => String(n).padStart(4)).join(' '));
  }
  // 顶点位置范围
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (let i = 0; i < vc; i++) {
    const o = found.verticesOffset + i * 80;
    minX = Math.min(minX, dv2.getFloat32(o, true));
    maxX = Math.max(maxX, dv2.getFloat32(o, true));
    minY = Math.min(minY, dv2.getFloat32(o + 4, true));
    maxY = Math.max(maxY, dv2.getFloat32(o + 4, true));
  }
  console.log('位置范围 X[' + minX.toFixed(0) + ',' + maxX.toFixed(0) + '] Y[' + minY.toFixed(0) + ',' + maxY.toFixed(0) + ']');
}
