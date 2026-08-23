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
const mdla = 79842, mdle = 1481325;

// 从 @70 开始解析绑定矩阵。结构猜测:
// @70: u32 0x44 = 68? (可能是骨骼数或标记)
// 然后矩阵序列
// 模式: [3×1.0 对角线][平移 433.xx]... 每矩阵可能是 64B (4x4) 或 48B (3x4)
// 关键: 找矩阵序列的边界
let p = mdla + 70;
console.log('@70 u32:', dv2.getUint32(p, true), 'f32:', dv2.getFloat32(p, true).toFixed(2));
p += 4;
// 尝试从 p 开始解析 4x4 矩阵（64B），检查平移分量合理性
console.log('\n从 @74 起解析矩阵（尝试 64B 4x4）:');
for (let m = 0; m < 12; m++) {
  const o = p + m * 64;
  const r00 = dv2.getFloat32(o, true), r01 = dv2.getFloat32(o + 4, true), r02 = dv2.getFloat32(o + 8, true);
  const tx = dv2.getFloat32(o + 48, true), ty = dv2.getFloat32(o + 52, true), tz = dv2.getFloat32(o + 56, true);
  const r10 = dv2.getFloat32(o + 16, true), r11 = dv2.getFloat32(o + 20, true), r12 = dv2.getFloat32(o + 24, true);
  const r20 = dv2.getFloat32(o + 32, true), r21 = dv2.getFloat32(o + 36, true), r22 = dv2.getFloat32(o + 40, true);
  console.log('  M' + m + ': r00=' + r00.toFixed(2) + ' r01=' + r01.toFixed(2) + ' r02=' + r02.toFixed(2) +
    ' | t(' + tx.toFixed(1) + ',' + ty.toFixed(1) + ',' + tz.toFixed(1) + ')' +
    ' | r10=' + r10.toFixed(2) + ' r11=' + r11.toFixed(2) + ' r12=' + r12.toFixed(2) +
    ' | r20=' + r20.toFixed(2) + ' r21=' + r21.toFixed(2) + ' r22=' + r22.toFixed(2));
}

// 尝试 48B 3x4
console.log('\n尝试 48B 3x4 矩阵:');
for (let m = 0; m < 8; m++) {
  const o = p + m * 48;
  const r00 = dv2.getFloat32(o, true), r01 = dv2.getFloat32(o + 4, true), r02 = dv2.getFloat32(o + 8, true);
  const tx = dv2.getFloat32(o + 36, true), ty = dv2.getFloat32(o + 40, true), tz = dv2.getFloat32(o + 44, true);
  const r10 = dv2.getFloat32(o + 12, true), r11 = dv2.getFloat32(o + 16, true), r12 = dv2.getFloat32(o + 20, true);
  const r20 = dv2.getFloat32(o + 24, true), r21 = dv2.getFloat32(o + 28, true), r22 = dv2.getFloat32(o + 32, true);
  console.log('  M' + m + ': [' + r00.toFixed(2) + ',' + r01.toFixed(2) + ',' + r02.toFixed(2) +
    ' | ' + r10.toFixed(2) + ',' + r11.toFixed(2) + ',' + r12.toFixed(2) +
    ' | ' + r20.toFixed(2) + ',' + r21.toFixed(2) + ',' + r22.toFixed(2) +
    ' | t(' + tx.toFixed(1) + ',' + ty.toFixed(1) + ',' + tz.toFixed(1) + ')]');
}
