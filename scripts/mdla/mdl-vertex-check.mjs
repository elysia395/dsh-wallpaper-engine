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
const mdla = 79842;

// 解析顶点数据: MDLV 网格, stride 80, pos@0, uv@72
// 找 MDLV 块
let mdls = 64571;
// 找 mesh: lwe 的 findPuppetMeshBlock 逻辑: 从 9 开始扫描 headerOffset
// 简化: MDLV@0, 找 vertexBytes
const vertexBytes = dv2.getUint32(mdla - 64571 + 0 + 9 + 4, true); // 不准确, 直接扫描
// 用已知信息: 634 顶点, stride 80
// 找顶点区: 扫描 "MDLV0023" 后
let mdlv = 0;
for (let i = 0; i < 100; i++) {
  if (buf.toString('ascii', i, i + 8) === 'MDLV0023') { mdlv = i; break; }
}
console.log('MDLV@', mdlv);
// MDLV 结构: header(9) + u32 + u32 vertexBytes? 用 lwe: meshHeaderSize = 2*u32
// findPuppetMeshBlock 扫描 headerOffset (从 markerSize=9 起), candidateVertexBytes 在 offset+4
// 直接: vertexBytes = u32 at (mdlv+9+4)?
// 用启发式: 顶点数据 = 634 * 80 = 50720 字节, 从某处开始
// 直接找 634 顶点: vertexBytes = 634*80 = 50720
// 扫描找 candidateVertexBytes == 50720
let meshOff = -1;
for (let off = mdlv + 9; off + 8 < mdls; off++) {
  const vb = dv2.getUint32(off + 4, true);
  if (vb === 634 * 80) { meshOff = off; break; }
}
console.log('mesh header @', meshOff, 'vertexBytes =', meshOff >= 0 ? dv2.getUint32(meshOff + 4, true) : '?');
if (meshOff >= 0) {
  const verticesOffset = meshOff + 8;
  // 打印每个顶点: pos, uv
  console.log('=== 顶点 pos/uv (每 30 个) ===');
  const byBone = {};
  for (let vi = 0; vi < 634; vi++) {
    const vo = verticesOffset + vi * 80;
    const x = dv2.getFloat32(vo, true), y = dv2.getFloat32(vo + 4, true), z = dv2.getFloat32(vo + 8, true);
    const u = dv2.getFloat32(vo + 72, true), v = dv2.getFloat32(vo + 76, true);
    // 骨骼索引
    const b0 = dv2.getUint32(vo + 40, true), b1 = dv2.getUint32(vo + 44, true);
    const w0 = dv2.getFloat32(vo + 56, true), w1 = dv2.getFloat32(vo + 60, true);
    if (vi % 30 === 0) console.log(`  v${vi}: pos=(${x.toFixed(0)},${y.toFixed(0)},${z.toFixed(0)}) uv=(${u.toFixed(3)},${v.toFixed(3)}) bone=(${b0}w${w0.toFixed(2)},${b1}w${w1.toFixed(2)})`);
  }
}
