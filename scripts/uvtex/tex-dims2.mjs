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
const raw = read('materials/人物.tex');

// 手动解析 mip0 的实际字节长度和存储尺寸
// TEXI 头: TEXI0001 + format(4) + flags(4) + texW(4) + texH(4) + imgW(4) + imgH(4) + u32 + TEXB000x
const pos1 = raw.indexOf('TEXI0001');
console.log('TEXI @', pos1);
const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
let o = pos1 + 8;
const format = dv.getInt32(o, true); o += 4;
const flags = dv.getInt32(o, true); o += 4;
const texW = dv.getInt32(o, true); o += 4;
const texH = dv.getInt32(o, true); o += 4;
const imgW = dv.getInt32(o, true); o += 4;
const imgH = dv.getInt32(o, true); o += 4;
o += 4; // unknown
const container = raw.toString('ascii', o, o + 8); o += 8;
console.log('format:', format, 'flags:', flags.toString(16));
console.log('texW x texH:', texW, 'x', texH);
console.log('imgW x imgH:', imgW, 'x', imgH);
console.log('container:', container);
const imgCount = dv.getInt32(o, true); o += 4;
console.log('imageCount:', imgCount);
// 第一个 image 的 mip 数
const mipCount = dv.getInt32(o, true); o += 4;
console.log('mipmapCount:', mipCount);
// 第一个 mip: u32 isLz4 + u32 decompressedCount + u32 storedLen
const isLz4 = dv.getInt32(o, true); o += 4;
const decCount = dv.getInt32(o, true); o += 4;
const storedLen = dv.getInt32(o, true); o += 4;
console.log('mip0: isLz4=' + isLz4, 'decCount=' + decCount, 'storedLen=' + storedLen);
console.log('DXT5 存储字节 = ceil(texW/4)*ceil(texH/4)*16 =', Math.ceil(texW/4) * Math.ceil(texH/4) * 16);
console.log('但 decCount 实际 =', decCount, '→ 若 decCount =', Math.ceil(3550/4)*Math.ceil(3750/4)*16, '则实际尺寸 3550x3750');
