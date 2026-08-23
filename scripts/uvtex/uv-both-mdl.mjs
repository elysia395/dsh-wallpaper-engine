import fs from 'fs';
import { decodeTex } from 'file:///D:/dsh-wallpaper-engine/lib/pkg-extract.js';

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

function meshInfo(mdlPath, texPath) {
  const buf = read(mdlPath);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // 找 mesh block
  let mdlsOffset = buf.length;
  for (let off = 9; off + 4 < buf.length; off++) {
    if (buf[off] === 0x4d && buf[off+1] === 0x44 && buf[off+2] === 0x4c && buf[off+3] === 0x53) { mdlsOffset = off; break; }
  }
  let found = null;
  for (let offset = 9; offset + 12 < mdlsOffset; offset++) {
    const vertexBytes = dv.getUint32(offset + 4, true);
    const verticesOffset = offset + 8;
    if (vertexBytes === 0 || vertexBytes % 80 !== 0) continue;
    const indexLenOffset = verticesOffset + vertexBytes;
    if (indexLenOffset + 4 > mdlsOffset) continue;
    const indexBytes = dv.getUint32(indexLenOffset, true);
    const indicesOffset = indexLenOffset + 4;
    if (indexBytes === 0 || indexBytes % 2 !== 0 || indicesOffset + indexBytes > mdlsOffset) continue;
    found = { verticesOffset, vertexBytes, indexBytes };
    break;
  }
  if (!found) { console.log(mdlPath, '无 mesh'); return; }
  const vc = found.vertexBytes / 80;
  const grid = Array.from({ length: 8 }, () => new Array(8).fill(0));
  for (let i = 0; i < vc; i++) {
    const o = found.verticesOffset + i * 80;
    const u = dv.getFloat32(o + 72, true);
    const v = dv.getFloat32(o + 76, true);
    const gx = Math.min(7, Math.max(0, Math.floor(u * 8)));
    const gy = Math.min(7, Math.max(0, Math.floor(v * 8)));
    grid[gy][gx]++;
  }
  console.log('===', mdlPath, vc + ' 顶点 ===');
  console.log('UV 分布:');
  for (let gy = 0; gy < 8; gy++) {
    console.log('  v' + (gy * 12.5).toFixed(0) + '%: ' + grid[gy].map((n) => String(n).padStart(4)).join(' '));
  }
  // 位置范围
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (let i = 0; i < vc; i++) {
    const o = found.verticesOffset + i * 80;
    const fx = dv.getFloat32(o, true), fy = dv.getFloat32(o + 4, true);
    minX = Math.min(minX, fx); maxX = Math.max(maxX, fx);
    minY = Math.min(minY, fy); maxY = Math.max(maxY, fy);
  }
  console.log('位置范围 X[' + minX.toFixed(0) + ',' + maxX.toFixed(0) + '] Y[' + minY.toFixed(0) + ',' + maxY.toFixed(0) + ']');
}

meshInfo('models/人物_puppet.mdl', 'materials/人物.tex');
meshInfo('models/发_puppet.mdl', 'materials/发.tex');
