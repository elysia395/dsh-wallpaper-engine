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
const mdla = 79842;

// 手动解析 MDLA 头部（逐字段）
console.log('=== MDLA 头部逐字节解析 ===');
let p = mdla;
console.log('@' + (p - mdla) + '  marker:', buf.toString('ascii', p, p + 8), '(8字节)'); p += 8;
// 之后是 u32 或其他
const u0 = dv.getUint32(p, true); console.log('@' + (p - mdla) + '  u32:', u0); p += 4;
// 尝试 C 字符串
if (buf[p] >= 32 && buf[p] < 127) {
  let e = p; while (e < buf.length && buf[e] !== 0) e++;
  console.log('@' + (p - mdla) + '  str: "' + buf.toString('utf8', p, e) + '"');
  p = e + 1;
}
const u1 = dv.getUint32(p, true); console.log('@' + (p - mdla) + '  u32:', u1); p += 4;
// 看下一段
console.log('@' + (p - mdla) + '  bytes:', Buffer.from(buf.slice(p, p + 32)).toString('hex'));
const u2 = dv.getUint32(p, true); console.log('@' + (p - mdla) + '  u32:', u2); p += 4;
if (buf[p] >= 32 && buf[p] < 127) {
  let e = p; while (e < buf.length && buf[e] !== 0) e++;
  console.log('@' + (p - mdla) + '  str: "' + buf.toString('utf8', p, e) + '"');
  p = e + 1;
}
const u3 = dv.getUint32(p, true); console.log('@' + (p - mdla) + '  u32:', u3); p += 4;
// 继续打印一段
console.log('@' + (p - mdla) + '  bytes:', Buffer.from(buf.slice(p, p + 64)).toString('hex'));
// ASCII
console.log('@' + (p - mdla) + '  ascii:', buf.toString('ascii', p, p + 64).replace(/[^\x20-\x7e]/g, '.'));

// 找 "动画 1" 和 "loop"
const animIdx = buf.indexOf(Buffer.from('动画 1', 'utf8'), mdla);
console.log('\n"动画 1" @', animIdx, '相对', animIdx - mdla);
const loopIdx = buf.indexOf(Buffer.from('loop'), mdla);
console.log('"loop" @', loopIdx, '相对', loopIdx - mdla);

// loop 后结构
p = loopIdx + 4;
console.log('\nloop 后:');
console.log('  @' + (p - mdla) + '  u32:', dv.getUint32(p, true), 'f32:', dv.getFloat32(p, true).toFixed(3)); p += 4;
console.log('  @' + (p - mdla) + '  u32:', dv.getUint32(p, true), 'f32:', dv.getFloat32(p, true).toFixed(3)); p += 4;
console.log('  @' + (p - mdla) + '  u32:', dv.getUint32(p, true), 'f32:', dv.getFloat32(p, true).toFixed(3)); p += 4;
console.log('  @' + (p - mdla) + '  u32:', dv.getUint32(p, true), 'f32:', dv.getFloat32(p, true).toFixed(3)); p += 4;
// 检查是否开始矩阵
console.log('  @' + (p - mdla) + '  bytes:', Buffer.from(buf.slice(p, p + 32)).toString('hex'));
