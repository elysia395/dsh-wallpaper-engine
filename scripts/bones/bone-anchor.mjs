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
const mdls = 64571, mdla = 79842;

// 解析骨骼: 矩阵 + tp + 父
let p = mdls + 17;
const bones = {};
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
  let tp = null;
  const m = infoStr.match(/"tp"\s*:\s*"([^"]+)"/);
  if (m) tp = m[1].trim().split(/\s+/).map(Number);
  bones[b] = { parent, mat: floats, tp };
  p = infoStart + infoStr.length + 1;
}

// 关键验证: 顶点 rawPos 与骨骼矩阵 mat 的关系
// mat 是 4x4 列主序: mat[0..3]=col0, mat[4..7]=col1, mat[8..11]=col2, mat[12..15]=col3
// 但显示 [1,0,0,0, 0,1,0,0, 0,0,1,0, tx,ty,0,1] = 行主序单位矩阵 + 平移
// 即 mat[12]=tx, mat[13]=ty
// 顶点 v0 骨骼8: rawPos(-309,1208), B8 matTrans(-229,151)
// 如果 rawPos 是"骨骼局部"，组装位置 = matTrans + rawPos? = (-538, 1359)?
// 或组装位置 = rawPos（因为 v5 已验证 rawPos 就是正确显示位置）
// 验证: rawPos 是否就是"组装后"位置（用户确认 v5 正确）
// 那么骨骼矩阵的意义是? matTrans 可能 = 骨骼在该位置的锚点
// 检查: 同一骨骼的顶点, rawPos 相对 matTrans 的偏移是否集中（说明顶点绕骨骼锚点）
console.log('同骨骼顶点相对骨骼锚点(matTrans)的分布:');
// B37: 顶点 v3-v20 等
const byBone = {};
for (let v = 0; v < 634; v++) {
  const o = 79 + v * 80;
  const b = dv2.getUint32(o + 40, true);
  const x = dv2.getFloat32(o, true), y = dv2.getFloat32(o + 4, true);
  if (!byBone[b]) byBone[b] = [];
  byBone[b].push([x, y]);
}
for (const b of [37, 22, 31, 8, 40, 44]) {
  const verts = byBone[b] || [];
  const bm = bones[b];
  if (!bm || !verts.length) continue;
  // 顶点相对 matTrans 的偏移
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const [x, y] of verts) {
    const dx = x - bm.mat[12], dy = y - bm.mat[13];
    minX = Math.min(minX, dx); maxX = Math.max(maxX, dx);
    minY = Math.min(minY, dy); maxY = Math.max(maxY, dy);
  }
  console.log('骨骼' + b + ': ' + verts.length + ' 顶点, matTrans(' + bm.mat[12].toFixed(0) + ',' + bm.mat[13].toFixed(0) + '), 顶点相对偏移 x[' + minX.toFixed(0) + ',' + maxX.toFixed(0) + '] y[' + minY.toFixed(0) + ',' + maxY.toFixed(0) + ']');
}
