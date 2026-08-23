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
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

// 顶点骨骼索引分布：统计所有顶点用到的骨骼
const streamStart = 79, stride = 80, vc = 634;
const boneSet = new Set();
const boneWeights = {};
for (let i = 0; i < vc; i++) {
  const o = streamStart + i * stride;
  const bi = dv.getUint32(o + 40, true);
  boneSet.add(bi);
  // weight @44
  const w = dv.getFloat32(o + 44, true);
  if (!boneWeights[bi]) boneWeights[bi] = [];
  boneWeights[bi].push(w);
}
const bones = [...boneSet].sort((a, b) => a - b);
console.log('骨骼数:', bones.length);
console.log('骨骼索引:', bones.join(', '));
console.log('\n每骨骼权重值（前10个）:');
for (const b of bones) {
  const ws = boneWeights[b];
  console.log('  骨骼', b, '顶点数', ws.length, '权重:', ws.slice(0, 10).map(x => x.toFixed(2)).join(' '));
}

// 检查是否有第二个权重集（4 骨骼混合？offset 48+ 可能有更多 weights）
console.log('\n检查多权重（offset 48/52/56 是否还有权重）:');
for (let i = 0; i < 10; i++) {
  const o = streamStart + i * stride;
  console.log('v' + i, '@44=' + dv.getFloat32(o+44, true).toFixed(2), '@48=' + dv.getFloat32(o+48, true).toFixed(2), '@52=' + dv.getFloat32(o+52, true).toFixed(2), '@56=' + dv.getFloat32(o+56, true).toFixed(2), '@60=' + dv.getFloat32(o+60, true).toFixed(2));
}

// 检查 MDLA 中骨骼数量声明：u32@mdla+12 = 512？或其他位置
const mdla = 79842;
console.log('\nMDLA 头: u32@+8:', dv.getUint32(mdla+8, true), '+12:', dv.getUint32(mdla+12, true), '+16:', dv.getUint32(mdla+16, true), '+20:', dv.getUint32(mdla+20, true));
console.log('骨骼索引最大:', Math.max(...bones), '→ 若 0-based 则骨骼数 ≥', Math.max(...bones) + 1);
