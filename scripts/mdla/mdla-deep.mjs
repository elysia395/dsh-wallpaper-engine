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

// MDLA 完整头部结构（重新精确解析）
const mdla = 79842;
console.log('MDLA@' + mdla);
let p = mdla;
console.log('@0: ', buf.toString('ascii', p, p + 8)); p += 8; // MDLA0006
console.log('@8: u32', dv2.getUint32(p, true), 'f32', dv2.getFloat32(p, true).toFixed(2)); p += 4;
// 字符串
let s = buf.toString('utf8', p, p + 60);
console.log('@12: bytes', Buffer.from(buf.slice(p, p + 48)).toString('hex'));
console.log('    ascii:', s.replace(/[^\x20-\x7e\u4e00-\u9fa5]/g, '.'));

// 用之前确认的: "动画 1" @25, "loop" @34
// loop 后 @38: u32 1879048192 (0x70000000)
// @42: u32 33858 (0x8442)
// @46: 0
// @50: u32 13568 (0x3500) → 0x35 = 53?
// 从 @54 起是绑定数据？
console.log('\n@42-60 详细:');
for (let off = 42; off < 60; off += 4) {
  console.log('  @' + off + ': u32=' + dv2.getUint32(mdla + off, true) + ' f32=' + dv2.getFloat32(mdla + off, true).toFixed(3));
}

// 关键：找绑定矩阵。尝试从 @54 后解析
// 之前 ASCII 显示 @54+ 有 "r-.C7.ED" 重复 = 矩阵模式
// 分析 @54 后 200 字节的 float
console.log('\n@54 后前 200 字节 float（每 16 个一行）:');
for (let i = 0; i < 200; i += 16) {
  const vals = [];
  for (let j = 0; j < 16; j++) vals.push(dv2.getFloat32(mdla + 54 + i * 4 + j * 4, true).toFixed(2));
  console.log('  ' + vals.join(' '));
}
