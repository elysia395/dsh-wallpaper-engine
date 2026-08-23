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

// 找数据区真正起点。MDLA 头: MDLA0006(8) + 变长头。
// 关键字段: @12=512, @42=0x8442, @50=0x3500
// 猜测结构: [MDLA0006][u32 版本?][u32 512 帧数?][str 动画名][str loop][u32 flags][...][骨骼数][数据]
// 数据区可能从 @74 或之后开始
// 方法: 找数据区中"每骨骼每帧"的最小重复单元
// 已知: 53 骨骼, 512 帧(?), 每帧 = 53 × 每骨骼数据
// 数据区长度 = 1401483 - 头部
// 试探: 512帧 × 53骨骼 × N字节 = 数据区
// N = (mdle - dataStart) / (512*53)

// 先确定头部结束: 扫描找"骨骼名"字符串（可能有关键帧曲线前的骨骼名表）
// 或直接分析: @74 起的 float 模式
console.log('MDLA 数据区周期性分析:');
// 打印 @74 起 512 字节的 float，观察模式
const floats = [];
for (let i = 0; i < 128; i++) floats.push(dv2.getFloat32(mdla + 74 + i * 4, true));
console.log('@74 起 128 float:');
for (let i = 0; i < 128; i += 8) {
  console.log('  ' + floats.slice(i, i + 8).map(f => f.toFixed(1)).join(' '));
}

// 假设每骨骼关键帧 = 7 floats (quat 4 + pos 3) = 28B 或 6 floats (euler 3 + pos 3) = 24B
// 或 10 floats (quat 4 + pos 3 + scale 3) = 40B
// 检查 @74 起的重复周期
console.log('\n重复周期检测（比较 @74+offset 与 @74+offset+period）:');
for (const period of [24, 28, 32, 40, 48, 64]) {
  let same = 0;
  for (let i = 0; i < 200 && mdla + 74 + i * 4 + period < buf.length; i++) {
    if (dv2.getFloat32(mdla + 74 + i * 4, true) === dv2.getFloat32(mdla + 74 + i * 4 + period, true)) same++;
  }
  console.log('  period=' + period + 'B: 匹配 ' + same + '/200');
}
