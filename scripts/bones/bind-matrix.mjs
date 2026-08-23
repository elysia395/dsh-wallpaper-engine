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

// 间隔 56161-64571（8410B）：分析结构
const segStart = 56161, segEnd = 64571;
console.log('间隔 56161-64571 长度', segEnd - segStart);
console.log('前 16 字节:', Buffer.from(buf.slice(segStart, segStart + 16)).toString('hex'));
console.log('u32@56161:', dv.getUint32(56161, true), 'u32@56165:', dv.getUint32(56165, true), 'u32@56169:', dv.getUint32(56169, true));

// 间隔内找"字符串/标记"
let strs = [];
for (let i = segStart; i < segEnd - 4; i++) {
  if (buf[i] >= 32 && buf[i] < 127 && buf[i+1] >= 32 && buf[i+1] < 127) {
    let end = i;
    while (end < segEnd && buf[end] >= 32 && buf[end] < 127) end++;
    if (end - i >= 4) strs.push([i, buf.toString('ascii', i, end)]);
    i = end;
  }
}
console.log('间隔内字符串:', strs.slice(0, 20));

// 假设：绑定矩阵区 = [u32 骨骼数] + N × 4x4 float 矩阵
// 从数据开头尝试
const start2 = 56165; // 跳过 4 字节 u32
console.log('\n间隔数据按 4x4 矩阵解析尝试:');
for (let bones = 8; bones <= 128; bones *= 2) {
  const bytes = bones * 64;
  if (start2 + bytes <= segEnd) {
    // 检查第一个矩阵是否合理（对角线 1 或平移值合理）
    const m0 = dv.getFloat32(start2, true);
    const m1 = dv.getFloat32(start2 + 4, true);
    const m12 = dv.getFloat32(start2 + 48, true);
    const m13 = dv.getFloat32(start2 + 52, true);
    const m14 = dv.getFloat32(start2 + 56, true);
    console.log('  骨骼=' + bones, '矩阵0: [' + m0.toFixed(2) + ',' + m1.toFixed(2) + '...] 平移(' + m12.toFixed(1) + ',' + m13.toFixed(1) + ',' + m14.toFixed(1) + ')');
  }
}
// 打印前 20 个 float
console.log('\n间隔前 40 个 float:');
const floats = [];
for (let i = 0; i < 40; i++) floats.push(dv.getFloat32(segStart + i * 4, true).toFixed(2));
console.log(floats.join(' '));
