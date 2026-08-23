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
const mdla = 79842, mdle = 1481325;

// 绑定矩阵区从 loop 后 @54 附近开始（相对 mdla +54）
// 找数据真正开始：扫描 float 平移量明显的位置
// 从相对 54 开始，尝试 64B 矩阵
const base = mdla + 54;
console.log('绑定矩阵区尝试 @', base, '相对', 54);
// 打印前 256 字节的 float
console.log('前 64 float:');
for (let i = 0; i < 64; i++) console.log('  ' + i + ': ' + dv.getFloat32(base + i * 4, true).toFixed(2));

// 尝试解析 53 骨骼 × 64B 矩阵
console.log('\n53 骨骼 × 64B 矩阵（平移分量 tx,ty,tz）:');
const matSize = 64;
for (let m = 0; m < Math.min(10, 53); m++) {
  const o = base + m * matSize;
  const tx = dv.getFloat32(o + 12, true);
  const ty = dv.getFloat32(o + 13 * 4, true);
  const tz = dv.getFloat32(o + 14 * 4, true);
  // 旋转部分
  const m00 = dv.getFloat32(o, true), m01 = dv.getFloat32(o + 4, true), m02 = dv.getFloat32(o + 8, true);
  const m10 = dv.getFloat32(o + 16, true), m11 = dv.getFloat32(o + 20, true), m12 = dv.getFloat32(o + 24, true);
  const m20 = dv.getFloat32(o + 32, true), m21 = dv.getFloat32(o + 36, true), m22 = dv.getFloat32(o + 40, true);
  console.log('  M' + m + ': rot[' + m00.toFixed(2) + ',' + m01.toFixed(2) + ',' + m02.toFixed(2) + ' | ' + m10.toFixed(2) + ',' + m11.toFixed(2) + ',' + m12.toFixed(2) + ' | ' + m20.toFixed(2) + ',' + m21.toFixed(2) + ',' + m22.toFixed(2) + '] t(' + tx.toFixed(1) + ',' + ty.toFixed(1) + ',' + tz.toFixed(1) + ')');
}
