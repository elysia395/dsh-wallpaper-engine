import fs from 'fs';
const PKG = 'c:/program files (x86)/steam/steamapps/workshop/content/431960/3461168300/scene.pkg';
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
const buf = read('models/人物_puppet.mdl');
const dv2 = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
let mdlsOffset = buf.length;
for (let off = 9; off + 4 < buf.length; off++) {
  if (buf[off] === 0x4d && buf[off+1] === 0x44 && buf[off+2] === 0x4c && buf[off+3] === 0x53) { mdlsOffset = off; break; }
}
let found = null;
for (let offset = 9; offset + 12 < mdlsOffset; offset++) {
  const vertexBytes = dv2.getUint32(offset + 4, true);
  const verticesOffset = offset + 8;
  if (vertexBytes === 0 || vertexBytes % 80 !== 0) continue;
  const indexLenOffset = verticesOffset + vertexBytes;
  if (indexLenOffset + 4 > mdlsOffset) continue;
  const indexBytes = dv2.getUint32(indexLenOffset, true);
  const indicesOffset = indexLenOffset + 4;
  if (indexBytes === 0 || indexBytes % 2 !== 0 || indicesOffset + indexBytes > mdlsOffset) continue;
  found = { verticesOffset, vertexBytes, indicesOffset, indexBytes };
  break;
}
const vertexCount = found.vertexBytes / 80;
const bGroups = {};
for (let i = 0; i < vertexCount; i++) {
  const vo = found.verticesOffset + i * 80;
  const u = dv2.getFloat32(vo + 72, true), v = dv2.getFloat32(vo + 76, true);
  const b0 = dv2.getUint32(vo + 40, true);
  const w0 = dv2.getFloat32(vo + 56, true);
  if (w0 < 0.5) continue;
  if (!bGroups[b0]) bGroups[b0] = [];
  bGroups[b0].push([u, v]);
}

// 所有骨骼的 UV 区域 (v 0.3-0.45 是脸部/眼睛区域)
console.log('=== 所有骨骼 UV 区域 ===');
for (const [b, pts] of Object.entries(bGroups).sort((a, b) => a[0] - b[0])) {
  let minU = 1e9, maxU = -1e9, minV = 1e9, maxV = -1e9;
  for (const [u, v] of pts) {
    if (u < minU) minU = u; if (u > maxU) maxU = u;
    if (v < minV) minV = v; if (v > maxV) maxV = v;
  }
  const face = (minV <= 0.45 && maxV >= 0.30) ? ' ← 可能脸/眼区域' : '';
  console.log(`  B${b.padStart(2)}: ${pts.length}顶点 u[${minU.toFixed(2)},${maxU.toFixed(2)}] v[${minV.toFixed(2)},${maxV.toFixed(2)}]${face}`);
}
