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

// MDL UV u 分布：是否集中在 [0,0.5]
const buf = read('models/人物_puppet.mdl');
const dv2 = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
let left = 0, right = 0, uMin = 1e9, uMax = -1e9;
const uBins = new Array(10).fill(0);
for (let i = 0; i < 634; i++) {
  const o = 79 + i * 80;
  const u = dv2.getFloat32(o + 72, true);
  const v = dv2.getFloat32(o + 76, true);
  uMin = Math.min(uMin, u); uMax = Math.max(uMax, u);
  const bin = Math.min(9, Math.max(0, Math.floor(u * 10)));
  uBins[bin]++;
  if (u < 0.5) left++; else right++;
}
console.log('人物 MDL UV u 范围:', uMin.toFixed(3), '-', uMax.toFixed(3));
console.log('u<0.5 (左半):', left, 'u>=0.5 (右半):', right);
console.log('u 分布 (10 bins):', uBins.join(' '));

// 后发
const buf2 = read('models/发_puppet.mdl');
const dv3 = new DataView(buf2.buffer, buf2.byteOffset, buf2.byteLength);
let mdlsOffset = buf2.length;
for (let off = 9; off + 4 < buf2.length; off++) {
  if (buf2[off] === 0x4d && buf2[off+1] === 0x44 && buf2[off+2] === 0x4c && buf2[off+3] === 0x53) { mdlsOffset = off; break; }
}
let found = null;
for (let offset = 9; offset + 12 < mdlsOffset; offset++) {
  const vertexBytes = dv3.getUint32(offset + 4, true);
  if (vertexBytes === 0 || vertexBytes % 80 !== 0) continue;
  const indexLenOffset = offset + 8 + vertexBytes;
  if (indexLenOffset + 4 > mdlsOffset) continue;
  const indexBytes = dv3.getUint32(indexLenOffset, true);
  if (indexBytes === 0 || indexBytes % 2 !== 0 || indexLenOffset + 4 + indexBytes > mdlsOffset) continue;
  found = { verticesOffset: offset + 8, vertexBytes };
  break;
}
if (found) {
  const vc = found.vertexBytes / 80;
  let l = 0, r = 0;
  for (let i = 0; i < vc; i++) {
    const o = found.verticesOffset + i * 80;
    const u = dv3.getFloat32(o + 72, true);
    if (u < 0.5) l++; else r++;
  }
  console.log('后发 MDL: u<0.5:', l, 'u>=0.5:', r, '(共' + vc + ')');
}

// 左侧帧内容验证：贴图左半（0-1775）是否完整角色
const info = parseTex(read('materials/人物.tex'));
const dec = decodeTex(read('materials/人物.tex'));
const w = info.width, h = info.height, srcW = dec.width;
const tdata = dec.rgba;
// 左半 每 10% 高度非空 x 范围
console.log('\n贴图左半 (x<1775) 内容分布:');
for (let band = 0; band < 10; band++) {
  const y0 = (h * band) / 10 | 0, y1 = (h * (band + 1)) / 10 | 0;
  let minX = 1775, maxX = -1, cnt = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < 1775; x++) {
      if (tdata[(y * srcW + x) * 4 + 3] > 10) { if (x < minX) minX = x; if (x > maxX) maxX = x; cnt++; }
    }
  }
  console.log('  y' + (band * 10) + '-%: x[' + minX + ',' + maxX + '] 宽' + (maxX - minX) + ' px' + cnt);
}
