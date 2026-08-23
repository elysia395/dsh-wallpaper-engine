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

// MDLA 头部精确定位数据区起点
// @42 起是第一个骨骼条目。结构: [BONEENTRYHEADER?] 或直接数据
// 从 @42 开始, 找到"帧数据"的规律
// 之前 @42: tmp=66(0x42='B'), type=132, unk1=0, entryLen=53
// 这些不像 BONEENTRY (MDLS 用)。MDLA 可能是不同结构
// 分析 @42 起 200 字节的 u32 序列
console.log('MDLA @42 起 u32 序列（前 50）:');
for (let i = 0; i < 50; i++) {
  const o = mdla + 42 + i * 4;
  const u = dv2.getUint32(o, true);
  const f = dv2.getFloat32(o, true);
  process.stdout.write(u.toString().padStart(12));
  if (i % 6 === 5) console.log('');
}
console.log('');

// 尝试找帧边界: 512 帧? 数据区长度
console.log('\n数据区分析:');
// MDLA 数据区从哪开始? 假设 @42 后是骨骼数据
// 53 骨骼 × 每骨骼大小 = ?
// 之前 B0 数据 [0,0,432,788, 0×4, 1,1,1, 432,788] = 13 floats = 52B + 头?
// 数据区总长 = mdle - 数据起点
// 尝试: 数据起点 = @42, 长度 = mdle - (mdla+42) = 1401483 - 42 = 1401441
// 512 帧 × 53 骨骼 = 27136 单元
// 每单元 = 1401441 / 27136 ≈ 51.6B
// 但 51.6 不是整数 → 不是简单 512×53
// 也许 512 是"骨骼槽"，动画帧数 = ?
console.log('MDLA 总长:', mdle - mdla);
console.log('@42 到 MDLE:', mdle - (mdla + 42));
// 找 MDLA 内的其他标记
const marks = [];
for (let i = mdla; i < mdle - 8; i++) {
  const s = buf.toString('ascii', i, i + 4);
  if (s === 'MDL' || s === 'ANIM' || s === 'KEYF') { marks.push([i - mdla, s]); }
}
console.log('MDLA 内标记:', marks.slice(0, 10));
