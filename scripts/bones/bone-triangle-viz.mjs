import fs from 'fs';
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
const verts = [];
for (let i = 0; i < vertexCount; i++) {
  const vo = found.verticesOffset + i * 80;
  verts.push({
    pos: [dv2.getFloat32(vo, true), dv2.getFloat32(vo + 4, true)],
    b0: dv2.getUint32(vo + 40, true), w0: dv2.getFloat32(vo + 56, true),
    b1: dv2.getUint32(vo + 44, true), w1: dv2.getFloat32(vo + 60, true),
  });
}
const indices = [];
for (let i = 0; i < indexCount; i++) indices.push(dv2.getUint16(found.indicesOffset + i * 2, true));

// 每个三角形的主骨骼 = 权重最大的顶点骨骼
let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
for (const v of verts) {
  if (v.pos[0] < minX) minX = v.pos[0]; if (v.pos[0] > maxX) maxX = v.pos[0];
  if (v.pos[1] < minY) minY = v.pos[1]; if (v.pos[1] > maxY) maxY = v.pos[1];
}
const CW = 50, CH = 34;

function renderTriangles(label, boneFilter) {
  const grid = Array.from({ length: CH }, () => new Array(CW).fill(' '));
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t], i1 = indices[t + 1], i2 = indices[t + 2];
    // 三角形主骨骼 = 顶点平均权重最大
    const bs = [verts[i0].b0 * verts[i0].w0, verts[i1].b0 * verts[i1].w0, verts[i2].b0 * verts[i2].w0];
    const b = verts[i0].w0 > verts[i1].w0 ? (verts[i0].w0 > verts[i2].w0 ? verts[i0].b0 : verts[i2].b0) : (verts[i1].w0 > verts[i2].w0 ? verts[i1].b0 : verts[i2].b0);
    if (boneFilter && !boneFilter(b)) continue;
    // 三角形重心映射
    const cx = (verts[i0].pos[0] + verts[i1].pos[0] + verts[i2].pos[0]) / 3;
    const cy = (verts[i0].pos[1] + verts[i1].pos[1] + verts[i2].pos[1]) / 3;
    const gx = Math.floor((cx - minX) / (maxX - minX) * CW);
    const gy = Math.floor((maxY - cy) / (maxY - minY) * CH);
    if (gx >= 0 && gx < CW && gy >= 0 && gy < CH) grid[gy][gx] = '#';
  }
  console.log(`\n=== ${label} ===`);
  for (const row of grid) console.log(row.join(''));
}

renderTriangles('全角色');
renderTriangles('B4 (anim1 摆动)', (b) => b === 4);
renderTriangles('B39-52 (anim1 摆动)', (b) => b >= 39 && b <= 52);
renderTriangles('B22-37 (anim2 摆动)', (b) => b >= 22 && b <= 37);
renderTriangles('B3 (头?)', (b) => b === 3);
renderTriangles('B8-13 (深色?)', (b) => b === 8 || b === 13);
