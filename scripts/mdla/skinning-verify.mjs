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

// 完整解析所有顶点的蒙皮数据
let ok1 = 0, okNot1 = 0;
let single = 0, doubleB = 0, tripleB = 0, quadB = 0;
const badOnes = [];
const boneUsage = new Set();
for (let v = 0; v < 634; v++) {
  const o = 79 + v * 80;
  const bones = [
    dv2.getUint32(o + 40, true), dv2.getUint32(o + 44, true),
    dv2.getUint32(o + 48, true), dv2.getUint32(o + 52, true),
  ];
  const weights = [
    dv2.getFloat32(o + 56, true), dv2.getFloat32(o + 60, true),
    dv2.getFloat32(o + 64, true), dv2.getFloat32(o + 68, true),
  ];
  const sum = weights.reduce((a, b) => a + b, 0);
  const active = weights.filter(w => w > 0.001).length;
  for (const b of bones) if (b < 100) boneUsage.add(b);
  if (Math.abs(sum - 1) < 0.02) ok1++; else { okNot1++; if (badOnes.length < 6) badOnes.push({ v, bones, weights: weights.map(x => x.toFixed(2)), sum: sum.toFixed(2) }); }
  if (active === 1) single++;
  else if (active === 2) doubleB++;
  else if (active === 3) tripleB++;
  else if (active === 4) quadB++;
}
console.log('权重和=1:', ok1, '≠1:', okNot1);
console.log('混合骨骼: 单', single, '双', doubleB, '三', tripleB, '四', quadB);
console.log('骨骼索引集合:', [...boneUsage].sort((a, b) => a - b).join(','));
if (badOnes.length) console.log('异常:', JSON.stringify(badOnes, null, 1));
