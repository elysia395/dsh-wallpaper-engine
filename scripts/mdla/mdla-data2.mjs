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

// 从 @41 起解析（数据区起点）
console.log('=== 数据区 @41 起 ===');
// @41: 数据开始。结构猜测: 可能先是 u32 或 float
// 多编码解读 @41-80
for (let off = 41; off < 81; off += 4) {
  const le = dv2.getFloat32(mdla + off, true);
  const be = dv2.getFloat32(mdla + off, false);
  const u32le = dv2.getUint32(mdla + off, true);
  const u16a = dv2.getUint16(mdla + off, true);
  const u16b = dv2.getUint16(mdla + off + 2, true);
  console.log('@' + off + ': LEf=' + le.toFixed(3) + ' BEf=' + be.toFixed(3) + ' u32le=' + u32le + ' u16(' + u16a + ',' + u16b + ') hex=' + Buffer.from(buf.slice(mdla + off, mdla + off + 4)).toString('hex'));
}

// 假设: 数据区 = 512 骨骼 × 每骨骼数据? 或 53 骨骼 × 帧?
// @41 起, 找第一个"有意义"的块
// 尝试: @41 起是骨骼数? u32 @41?
console.log('\n@41 u32:', dv2.getUint32(mdla + 41, true), 'u16:', dv2.getUint16(mdla + 41, true));
// @41 单字节
console.log('@41-45 字节:', Buffer.from(buf.slice(mdla + 41, mdla + 45)).toString('hex'));

// 关键: 数据区可能以"帧数/骨骼数"开始
// 打印 @41 起 200 字节的 u16 序列（小端）
console.log('\n@41 起 u16 序列:');
for (let i = 0; i < 60; i++) {
  const v = dv2.getUint16(mdla + 41 + i * 2, true);
  process.stdout.write(v.toString().padStart(6));
  if (i % 8 === 7) console.log('');
}
console.log('');
