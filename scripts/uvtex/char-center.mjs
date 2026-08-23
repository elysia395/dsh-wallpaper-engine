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
// 人物贴图内容包围盒
const info = parseTex(read('materials/人物.tex'));
const dec = decodeTex(read('materials/人物.tex'));
const w = info.width, h = info.height, srcW = dec.width;
const tdata = dec.rgba;
let minX = w, maxX = -1, minY = h, maxY = -1;
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    if (tdata[(y * srcW + x) * 4 + 3] > 10) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}
console.log('人物贴图内容包围盒: x[' + minX + ',' + maxX + '] y[' + minY + ',' + maxY + ']');
console.log('内容中心: (' + ((minX + maxX) / 2).toFixed(0) + ',' + ((minY + maxY) / 2).toFixed(0) + ')');
console.log('贴图中心: (' + (w / 2) + ',' + (h / 2) + ')');
console.log('偏移: dx=' + (((minX + maxX) / 2 - w / 2)).toFixed(0) + ' dy=' + (((minY + maxY) / 2 - h / 2)).toFixed(0));

// MDL 角色中心
const buf = read('models/人物_puppet.mdl');
const dv2 = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
let mcx = 0, mcy = 0, n = 0;
for (let i = 0; i < 634; i++) {
  const o = 79 + i * 80;
  mcx += dv2.getFloat32(o, true);
  mcy += dv2.getFloat32(o + 4, true);
  n++;
}
mcx /= n; mcy /= n;
console.log('\nMDL 角色顶点中心: (' + mcx.toFixed(0) + ',' + mcy.toFixed(0) + ')');
console.log('场景 origin: (2115, 654) → 屏幕 (2115, 1505)');
console.log('若贴图中心对齐 origin：角色内容中心在屏幕 (' + (2115 + ((minX + maxX) / 2 - w / 2)).toFixed(0) + ',' + (1505 - ((minY + maxY) / 2 - h / 2)).toFixed(0) + ')');
