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

// 绑定矩阵区从 @58 开始。分析 @58-58+53*36 的矩阵序列
// 猜测: 53 骨骼 × 36B (9 float: 3x3 旋转 + 平移? 或 平移+旋转)
// @64 模式: [16B 0][3×1.0][433.xx][800.xx]... 
// 更精确: @58 是第一个矩阵起点? @58: 72 2d d8 43 = 433.685
// 让我逐矩阵分析 @58 起, 尝试 36B 步长
console.log('尝试 36B 步长矩阵（@58 起）:');
for (let m = 0; m < 10; m++) {
  const o = mdla + 58 + m * 36;
  const vals = [];
  for (let i = 0; i < 9; i++) vals.push(dv2.getFloat32(o + i * 4, true));
  console.log('  M' + m + ': [' + vals.map(v => v.toFixed(2)).join(', ') + ']');
}

// 尝试 64B 步长（4x4）
console.log('\n尝试 64B 步长矩阵（@58 起）:');
for (let m = 0; m < 8; m++) {
  const o = mdla + 58 + m * 64;
  const vals = [];
  for (let i = 0; i < 16; i++) vals.push(dv2.getFloat32(o + i * 4, true));
  console.log('  M' + m + ': [' + vals.map(v => v.toFixed(2)).join(', ') + ']');
}

// 尝试 48B
console.log('\n尝试 48B 步长矩阵（@58 起）:');
for (let m = 0; m < 8; m++) {
  const o = mdla + 58 + m * 48;
  const vals = [];
  for (let i = 0; i < 12; i++) vals.push(dv2.getFloat32(o + i * 4, true));
  console.log('  M' + m + ': [' + vals.map(v => v.toFixed(2)).join(', ') + ']');
}
