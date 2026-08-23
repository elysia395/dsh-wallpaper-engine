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

// MDLA0006 @79842, MDLE0002 @1481325
const mdla = 79842, mdle = 1481325;
console.log('MDLA@' + mdla + ' 到 MDLE@' + mdle + ' 长度', mdle - mdla);
console.log('MDLA 头 64 字节 hex:', Buffer.from(buf.slice(mdla, mdla + 64)).toString('hex'));
console.log('MDLA 头 ASCII:', buf.toString('ascii', mdla, mdla + 16));

// 尝试解析 MDLA：可能是 [marker, u32 count, ...骨骼数据]
console.log('\nu32 @mdla+8:', dv.getUint32(mdla + 8, true), '@mdla+12:', dv.getUint32(mdla + 12, true), '@mdla+16:', dv.getUint32(mdla + 16, true), '@mdla+20:', dv.getUint32(mdla + 20, true));

// 检查骨骼数量：常见模式是 u32 骨骼数 + 每个骨骼的变换矩阵
// 矩阵 = 4x4 float = 64 bytes
// 试探 count
for (const cand of [dv.getUint32(mdla + 8, true), dv.getUint32(mdla + 12, true), dv.getUint32(mdla + 16, true)]) {
  if (cand > 0 && cand < 500) {
    const region = (mdle - mdla - 8) / cand;
    console.log('候选骨骼数', cand, '→ 每骨骼', region.toFixed(1), '字节', region % 64 === 0 ? '(4x4矩阵)' : '');
  }
}

// 顶点流 vs MDLA：检查顶点是否有骨骼索引（blend indices）——stride 80 里 pos@0 uv@72 中间 60 字节
// 可能是 [pos(12) + normal(12) + tangent(16) + uv(8) + boneIndices(4) + boneWeights(8) + ...]
console.log('\n顶点 stride 80 布局探测（前 4 顶点各偏移值）:');
for (let v = 0; v < 4; v++) {
  const o = 79 + v * 80;
  const vals = [];
  for (let off = 0; off < 80; off += 4) {
    vals.push(dv.getFloat32(o + off, true).toFixed(2));
  }
  console.log('  v' + v + ':', vals.join(' '));
}
