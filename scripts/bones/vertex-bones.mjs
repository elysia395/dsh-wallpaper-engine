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

// 顶点 stride 80：检查每个顶点的 60 字节"中间区"（pos 12B + uv 8B = 20B，剩 60B）
// 常见布局: pos(12) normal(12) tangent(16) uv(8) boneIdx(4) boneW(8) 或类似
// 前 20 个顶点，打印 offset 12-72 的值，找 bone indices（u8/u16 小整数）和 weights（float 0-1）
console.log('顶点中间区分析（offset 12..72, 每 4 字节）:');
for (let v = 0; v < 12; v++) {
  const o = 79 + v * 80;
  let desc = 'v' + String(v).padStart(2) + ': ';
  for (let off = 12; off < 72; off += 4) {
    const f = dv.getFloat32(o + off, true);
    desc += f.toFixed(2) + ' ';
  }
  console.log(desc);
}
// 尝试把 offset 40-48 解读为 4×u8 bone indices
console.log('\nBone index 假设（offset 36-40 或 44-48 为 u8/u16）:');
for (let v = 0; v < 8; v++) {
  const o = 79 + v * 80;
  const u8 = [];
  for (let off = 12; off < 72; off++) u8.push(dv.getUint8(o + off));
  console.log('v' + v + ' u8[12..72]:', u8.join(' '));
}
