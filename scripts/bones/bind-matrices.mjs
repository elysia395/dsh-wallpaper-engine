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

// 数据起点（loop 后）
const loopIdx = buf.indexOf(Buffer.from('loop'), 79842);
let dataStart = loopIdx + 4;
while (buf[dataStart] === 0) dataStart++;

// 解析矩阵序列：尝试每矩阵 64B（4x4）或 48B（3x4）
// 先看第一个矩阵的 16 个 float
console.log('dataStart @', dataStart);
console.log('前 128 字节 hex:', Buffer.from(buf.slice(dataStart, dataStart + 128)).toString('hex'));

// 尝试 64B 矩阵：打印前 8 个
console.log('\n64B 矩阵（前 8 个，每行显示 平移 tx,ty,tz）:');
for (let m = 0; m < 8; m++) {
  const o = dataStart + m * 64;
  const floats = [];
  for (let i = 0; i < 16; i++) floats.push(dv.getFloat32(o + i * 4, true).toFixed(2));
  console.log('  M' + m + ': [' + floats.join(', ') + ']');
}

// 尝试 48B 矩阵（3x4 行主序）
console.log('\n48B 矩阵（前 8 个）:');
for (let m = 0; m < 8; m++) {
  const o = dataStart + m * 48;
  const floats = [];
  for (let i = 0; i < 12; i++) floats.push(dv.getFloat32(o + i * 4, true).toFixed(2));
  console.log('  M' + m + ': [' + floats.join(', ') + ']');
}

// 找到矩阵序列结束（下一个非矩阵数据）→ 推断骨骼数
// 打印 2000 字节内 ASCII 标记
console.log('\n数据区前 400 字节中重复模式检查:');
// 检查矩阵是 64B 还是 48B：找平移分量明显的
// 平移通常 > 100（像素级）
for (const ms of [48, 64]) {
  console.log('  矩阵大小 ' + ms + 'B:');
  for (let m = 0; m < 10; m++) {
    const o = dataStart + m * ms;
    // 平移通常在最后一行（64B 的 12,13,14 或 48B 的 9,10,11）
    const tx = dv.getFloat32(o + (ms === 64 ? 48 : 36), true);
    const ty = dv.getFloat32(o + (ms === 64 ? 52 : 40), true);
    const tz = dv.getFloat32(o + (ms === 64 ? 56 : 44), true);
    if (Math.abs(tx) > 0.1 || Math.abs(ty) > 0.1 || Math.abs(tz) > 0.1) {
      console.log('    M' + m + ' 平移(' + tx.toFixed(1) + ',' + ty.toFixed(1) + ',' + tz.toFixed(1) + ')');
    }
  }
}
