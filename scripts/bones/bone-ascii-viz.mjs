import fs from 'fs';
import zlib from 'zlib';

// 渲染每骨骼控制的顶点区域为 ASCII 图
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
const indexCount = found.indexBytes / 2;
const indices = [];
for (let i = 0; i < indexCount; i++) indices.push(dv2.getUint16(found.indicesOffset + i * 2, true));

// 顶点: pos, boneIdx, weight
const verts = [];
for (let i = 0; i < vertexCount; i++) {
  const vo = found.verticesOffset + i * 80;
  verts.push({
    pos: [dv2.getFloat32(vo, true), dv2.getFloat32(vo + 4, true)],
    b0: dv2.getUint32(vo + 40, true), w0: dv2.getFloat32(vo + 56, true),
  });
}

// 全角色边界
let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
for (const v of verts) {
  if (v.pos[0] < minX) minX = v.pos[0]; if (v.pos[0] > maxX) maxX = v.pos[0];
  if (v.pos[1] < minY) minY = v.pos[1]; if (v.pos[1] > maxY) maxY = v.pos[1];
}
const CW = 60, CH = 40;

// 渲染指定骨骼的区域 (用三角形填充近似: 只画顶点位置的点阵)
function renderBone(b, label) {
  const grid = Array.from({ length: CH }, () => new Array(CW).fill('.'));
  for (const v of verts) {
    if (v.w0 < 0.5 || v.b0 !== b) continue;
    const gx = Math.floor((v.pos[0] - minX) / (maxX - minX) * CW);
    const gy = Math.floor((maxY - v.pos[1]) / (maxY - minY) * CH); // y 翻转
    if (gx >= 0 && gx < CW && gy >= 0 && gy < CH) grid[gy][gx] = '#';
  }
  console.log(`\n=== ${label} (B${b}) ===`);
  for (const row of grid) console.log(row.join(''));
}

renderBone(0, '根');
renderBone(1, 'B1');
renderBone(2, 'B2');
renderBone(3, 'B3');
renderBone(4, 'B4 (anim1 大幅摆动)');
renderBone(8, 'B8 (深色发?)');
renderBone(13, 'B13');
renderBone(22, 'B22 (anim2 摆动)');
renderBone(31, 'B31');
renderBone(39, 'B39 (anim1 摆动)');
renderBone(44, 'B44 (anim1 摆动)');
renderBone(51, 'B51 (anim1 摆动)');

// 全角色总览
console.log('\n=== 全角色总览 ===');
const grid2 = Array.from({ length: CH }, () => new Array(CW).fill('.'));
for (const v of verts) {
  const gx = Math.floor((v.pos[0] - minX) / (maxX - minX) * CW);
  const gy = Math.floor((maxY - v.pos[1]) / (maxY - minY) * CH);
  if (gx >= 0 && gx < CW && gy >= 0 && gy < CH) grid2[gy][gx] = '#';
}
for (const row of grid2) console.log(row.join(''));
console.log(`角色范围: x[${minX.toFixed(0)},${maxX.toFixed(0)}] y[${minY.toFixed(0)},${maxY.toFixed(0)}]`);
