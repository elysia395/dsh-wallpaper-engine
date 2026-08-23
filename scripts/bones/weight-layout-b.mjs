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

// 假设布局：@40-47 = 4×u16 骨骼索引, @48-63 = 4×f32 权重
console.log('假设布局 A: @40-47 4×u16 bones, @48-63 4×f32 weights');
console.log('前 10 顶点:');
for (let v = 0; v < 10; v++) {
  const o = 79 + v * 80;
  const b0 = dv2.getUint16(o + 40, true), b1 = dv2.getUint16(o + 42, true);
  const b2 = dv2.getUint16(o + 44, true), b3 = dv2.getUint16(o + 46, true);
  const w0 = dv2.getFloat32(o + 48, true), w1 = dv2.getFloat32(o + 52, true);
  const w2 = dv2.getFloat32(o + 56, true), w3 = dv2.getFloat32(o + 60, true);
  console.log('  v' + v + ': bones[' + b0 + ',' + b1 + ',' + b2 + ',' + b3 + '] weights[' +
    w0.toFixed(2) + ',' + w1.toFixed(2) + ',' + w2.toFixed(2) + ',' + w3.toFixed(2) + '] 和=' +
    (w0 + w1 + w2 + w3).toFixed(2));
}

// 统计：所有顶点的权重和是否为 1.0
console.log('\n所有 634 顶点权重和统计:');
let sum1 = 0, sumNot1 = 0;
const badSums = [];
for (let v = 0; v < 634; v++) {
  const o = 79 + v * 80;
  const w0 = dv2.getFloat32(o + 48, true), w1 = dv2.getFloat32(o + 52, true);
  const w2 = dv2.getFloat32(o + 56, true), w3 = dv2.getFloat32(o + 60, true);
  const s = w0 + w1 + w2 + w3;
  if (Math.abs(s - 1) < 0.01) sum1++;
  else { sumNot1++; if (badSums.length < 8) badSums.push({ v, w: [w0, w1, w2, w3].map(x => x.toFixed(2)), s: s.toFixed(2) }); }
}
console.log('权重和=1.0:', sum1, '≠1:', sumNot1);
if (badSums.length) console.log('异常:', JSON.stringify(badSums));

// 骨骼索引范围
let minB = 65535, maxB = 0;
for (let v = 0; v < 634; v++) {
  const o = 79 + v * 80;
  for (let k = 0; k < 4; k++) {
    const b = dv2.getUint16(o + 40 + k * 2, true);
    if (b < 65535) { if (b < minB) minB = b; if (b > maxB) maxB = b; }
  }
}
console.log('骨骼索引范围:', minB, '-', maxB);
