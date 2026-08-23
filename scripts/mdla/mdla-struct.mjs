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

// MDLA@79842: MDLA0006 + 字符串头
const mdla = 79842;
console.log('MDLA@' + mdla);
// 头部解析: "MDLA0006\0" (9B) + 字符串
// ASCII 显示: MDLA0006.m.......g.......e.(g.; 1.loop...pB........5.......4...r-
// 推测: marker(9) + u32(4) + 字符串"动画 1"(若干) + u32 + "loop" + ...
// 直接找 "loop" 后的数据
const loopIdx = buf.indexOf(Buffer.from('loop'), mdla);
console.log('"loop" @', loopIdx, '(相对 MDLA +' + (loopIdx - mdla) + ')');
// loop 后: \0\0 + 数据
let p = loopIdx + 4;
// 跳过可能的 \0
while (p < buf.length && buf[p] === 0) p++;
console.log('loop 后首个非零 @', p, 'u32:', dv.getUint32(p, true), 'f32:', dv.getFloat32(p, true).toFixed(4));

// 字符串解析：MDLA 头可能是一系列 C 字符串 + 数值
// 打印 MDLA 前 200 字节的可读结构
console.log('\nMDLA 头部分段:');
let pos2 = mdla + 9;
const parts = [];
for (let i = 0; i < 30 && pos2 < mdla + 300; i++) {
  // 尝试 C 字符串
  if (buf[pos2] >= 32 && buf[pos2] < 127) {
    let end = pos2;
    while (end < buf.length && buf[end] >= 32 && buf[end] < 127) end++;
    parts.push('str[' + (pos2 - mdla) + ']="' + buf.toString('ascii', pos2, end) + '"');
    pos2 = end;
  } else {
    parts.push('u32[' + (pos2 - mdla) + ']=' + dv.getUint32(pos2, true) + ' f32=' + dv.getFloat32(pos2, true).toFixed(2));
    pos2 += 4;
  }
}
console.log(parts.join('\n'));

// 找到骨骼绑定矩阵区：MDLA 数据里应该有 512 骨骼 × 矩阵？
// 或者骨骼数在头部。扫描 MDLA 数据找 "类似矩阵" 的 float 块
console.log('\nMDLA 数据区结构探测（找 4x4 矩阵序列）:');
// 在 loop 之后找数据起点
let dataStart2 = loopIdx + 4;
while (dataStart2 < buf.length && buf[dataStart2] === 0) dataStart2++;
// 尝试多种骨骼数
for (const bones of [16, 32, 48, 64, 128, 512]) {
  const total = (mdle - dataStart2) / bones;
  if (total === Math.round(total)) {
    const perBone = total;
    console.log('  骨骼数=' + bones, '→ 每骨骼 ' + perBone + ' 字节', perBone % 64 === 0 ? '(64B=4x4矩阵?)' : perBone % 48 === 0 ? '(48B=3x4矩阵?)' : '');
  }
}
