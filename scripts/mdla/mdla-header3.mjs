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

// 精确定位 MDLA 头部结构
// 头部: MDLA0006 + 变长
// @8: u32 0x169A6D00
// @12: u32 512 (帧数?)
// @16: u32 0x10E700 (1107712)
// @20: 0
// @24-33: "动画 1" (UTF-8, 6 字节 + \0)
// @34-38: "loop\0"
// @39: 更多
// 逐字节 dump @8-100 标注含义
console.log('MDLA 头部逐字段:');
let pos = mdla + 8;
console.log('@8: u32 =', dv2.getUint32(pos, true), '(0x' + dv2.getUint32(pos, true).toString(16) + ')'); pos += 4;
console.log('@12: u32 =', dv2.getUint32(pos, true), '(0x' + dv2.getUint32(pos, true).toString(16) + ')'); pos += 4;
console.log('@16: u32 =', dv2.getUint32(pos, true)); pos += 4;
console.log('@20: u32 =', dv2.getUint32(pos, true)); pos += 4;
// 字符串 "动画 1"
const animIdx = buf.indexOf(Buffer.from('动画 1', 'utf8'), mdla);
console.log('"动画 1" @', animIdx - mdla, '长度', '动画 1'.length);
const loopIdx = buf.indexOf(Buffer.from('loop'), mdla);
console.log('"loop" @', loopIdx - mdla);
// loop 之后的结构
pos = loopIdx + 4; // "loop\0"
console.log('loop 后 @' + (pos - mdla) + ':');
// 打印 loop 后 100 字节的 u32 + 字符串交替
for (let i = 0; i < 30; i++) {
  const u = dv2.getUint32(pos, true);
  const isStr = buf[pos] >= 32 && buf[pos] < 127;
  if (isStr) {
    let e = pos;
    while (e < buf.length && buf[e] >= 32 && buf[e] < 127) e++;
    console.log('  @' + (pos - mdla) + ': str="' + buf.toString('ascii', pos, e) + '"');
    pos = e;
  } else {
    console.log('  @' + (pos - mdla) + ': u32=' + u + ' f32=' + dv2.getFloat32(pos, true).toFixed(2));
    pos += 4;
  }
  if (pos - mdla > 300) break;
}
