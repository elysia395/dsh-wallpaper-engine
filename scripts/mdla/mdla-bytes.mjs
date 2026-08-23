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

// B0 块: @63 起 133 条 × 36B = 4788B → B1 @4851
// 打印 B0 最后 2 条 + B1 前 10 条，逐字节 hex + 逐 float
console.log('=== 逐 float: B0 尾部 → B1 头部 (@4788 起 480 字节) ===');
const start = mdla + 4788;
for (let i = 0; i < 120; i++) {
  const o = start + i * 4;
  const f = dv2.getFloat32(o, true);
  const u = dv2.getUint32(o, true);
  console.log(`  @${o - mdla}: f=${f.toFixed(2)} hex=${u.toString(16).padStart(8, '0')}`);
}

// 分析 B0 结构: [432.36, 788.44, 0,0,0,0, 1,1,1]
// B1 结构: [0,0, -82.29,-58.78, 0,0,0,0, 1] 首条; [1,1,-82.29,-58.78,0,0,0,0,1] 后续
// 打印 B1 前 20 条完整 9-float
console.log('\n=== B1 前 20 条 36B 条目 ===');
for (let k = 0; k < 20; k++) {
  const o = mdla + 4851 + k * 36;
  const vals = [];
  for (let i = 0; i < 9; i++) vals.push(dv2.getFloat32(o + i * 4, true));
  console.log(`  k=${k} @${o - mdla}: [` + vals.map(f => f.toFixed(2)).join(', ') + ']');
}
