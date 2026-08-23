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

// 头部完整解析
console.log('=== MDLA 头部 ===');
console.log('标记:', buf.toString('ascii', mdla, mdla + 8));
console.log('@8 u32:', dv2.getUint32(mdla + 8, true), '(0x' + dv2.getUint32(mdla + 8, true).toString(16) + ')');
console.log('@12 u32:', dv2.getUint32(mdla + 12, true), '(0x' + dv2.getUint32(mdla + 12, true).toString(16) + ')');
console.log('@16 u32:', dv2.getUint32(mdla + 16, true));
console.log('@20 u32:', dv2.getUint32(mdla + 20, true));
// 字符串
const animIdx = buf.indexOf(Buffer.from('动画 1', 'utf8'), mdla);
const loopIdx = buf.indexOf(Buffer.from('loop'), mdla);
console.log('"动画 1" @', animIdx - mdla, '"loop" @', loopIdx - mdla);

// @8 和 @12 的十六进制位分析
const v8 = dv2.getUint32(mdla + 8, true);
const v12 = dv2.getUint32(mdla + 12, true);
console.log('@8 二进制:', v8.toString(2).padStart(32, '0'));
console.log('@12 二进制:', v12.toString(2).padStart(32, '0'));
// @8 = 0x169A6D00: 可能是 2 个 u16: 0x169A, 0x6D00
console.log('@8 高16位:', (v8 >> 16).toString(16), '低16位:', (v8 & 0xffff).toString(16));
console.log('@12 高16位:', (v12 >> 16).toString(16), '低16位:', (v12 & 0xffff).toString(16));

// 大端解读 @8, @12
console.log('@8 大端:', dv2.getUint32(mdla + 8, false));
console.log('@12 大端:', dv2.getUint32(mdla + 12, false));

// 尝试: @8 = 动画数/版本, @12 = 512 可能是某种计数
// 数据区起点: loop 后
let dataStart = loopIdx + 4;
while (dataStart < buf.length && buf[dataStart] === 0) dataStart++;
console.log('\n数据区起点 @', dataStart - mdla, '相对 MDLA +', dataStart - mdla);
// 但之前发现 @42 起有 36B 周期，@42 = 相对 mdla 42
// 检查 @38-46 的字节
console.log('@38-50 字节:', Buffer.from(buf.slice(mdla + 38, mdla + 50)).toString('hex'));
console.log('@42 u32:', dv2.getUint32(mdla + 42, true), '@46:', dv2.getUint32(mdla + 46, true));
