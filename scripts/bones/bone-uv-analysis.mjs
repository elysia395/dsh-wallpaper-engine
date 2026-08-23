import fs from 'fs';
const base = 'c:/program files (x86)/steam/steamapps/workshop/content/431960/';
const PKG = base + '3461168300/scene.pkg';
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

// 1. 人物 MDL: 按骨骼分组顶点, 计算 UV 范围 + 位置范围, 推断部位
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

// MDLS 骨骼锚点
let mdls = mdlsOffset;
const bones = [];
let p = mdls + 17;
const mdlaOffset = buf.indexOf(Buffer.from('MDLA0006'), mdls);
for (let b = 0; b < 300 && p < mdlaOffset; b++) {
  const entryLen = dv2.getUint32(p + 9, true);
  if (entryLen <= 0 || entryLen > 10000) { p += 9; bones.push({ b, error: true }); continue; }
  const floats = [];
  for (let i = 0; i < Math.floor(entryLen / 4); i++) floats.push(dv2.getFloat32(p + 13 + i * 4, true));
  const infoStart = p + 13 + entryLen;
  let infoLen = 0;
  while (infoStart + infoLen < buf.length && buf[infoStart + infoLen] >= 32 && buf[infoStart + infoLen] < 127) infoLen++;
  const parent = dv2.getUint32(p + 5, true);
  bones.push({ b, parent: parent === 0xffffffff ? -1 : parent, anchor: [floats[12] ?? 0, floats[13] ?? 0] });
  p = infoStart + infoLen + 1;
}

// 按骨骼分组顶点
const groups = {};
for (let i = 0; i < vertexCount; i++) {
  const vo = found.verticesOffset + i * 80;
  const x = dv2.getFloat32(vo, true), y = dv2.getFloat32(vo + 4, true);
  const u = dv2.getFloat32(vo + 72, true), v = dv2.getFloat32(vo + 76, true);
  const b0 = dv2.getUint32(vo + 40, true);
  const w0 = dv2.getFloat32(vo + 56, true);
  if (w0 < 0.3) continue; // 只取主要骨骼
  if (!groups[b0]) groups[b0] = { minX: 1e9, maxX: -1e9, minY: 1e9, maxY: -1e9, minU: 1e9, maxU: -1e9, minV: 1e9, maxV: -1e9, cnt: 0 };
  const g = groups[b0];
  if (x < g.minX) g.minX = x; if (x > g.maxX) g.maxX = x;
  if (y < g.minY) g.minY = y; if (y > g.maxY) g.maxY = y;
  if (u < g.minU) g.minU = u; if (u > g.maxU) g.maxU = u;
  if (v < g.minV) g.minV = v; if (v > g.maxV) g.maxV = v;
  g.cnt++;
}

console.log('=== 人物骨骼 → 顶点区域 (贴图 3550x3750, 角色 y 向上) ===');
console.log('骨骼 | 顶点数 | 位置范围 (x, y) | UV 范围 | 锚点');
for (const [b, g] of Object.entries(groups)) {
  const bi = parseInt(b);
  const anc = bones[bi]?.anchor || [0, 0];
  // 位置范围转屏幕: y 翻转
  const posStr = `x[${g.minX.toFixed(0)},${g.maxX.toFixed(0)}] y[${g.minY.toFixed(0)},${g.maxY.toFixed(0)}]`;
  const uvStr = `u[${g.minU.toFixed(2)},${g.maxU.toFixed(2)}] v[${g.minV.toFixed(2)},${g.maxV.toFixed(2)}]`;
  console.log(`B${b.padStart(2)} | ${g.cnt} | ${posStr} | ${uvStr} | (${anc[0].toFixed(0)},${anc[1].toFixed(0)})`);
}
