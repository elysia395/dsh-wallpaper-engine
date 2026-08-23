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

// 完整解析 MDLA 头部
console.log('=== MDLA 头部 ===');
// MDLA0006 @0-7
// @8: u32 = ?
// @12: u32 = 512
// 字符串 "动画 1" @25, "loop" @34
// @38: u32 = 1879048192 (0x70000000)
// @42: u32 = 33858
// @46: u32 = 0
// @50: u32 = 13568 (0x3500)
// @54: u32 = 0
// @58: u32 = 1225728
// @62: u32 = ?
console.log('@8:', dv2.getUint32(mdla + 8, true).toString(16), '=', dv2.getUint32(mdla + 8, true));
console.log('@12:', dv2.getUint32(mdla + 12, true));
console.log('@16:', dv2.getUint32(mdla + 16, true));
console.log('@20:', dv2.getUint32(mdla + 20, true));
// 字符串区 @16-34
console.log('@16-36 ascii:', buf.toString('utf8', mdla + 16, mdla + 36).replace(/[^\x20-\x7e\u4e00-\u9fa5]/g, '.'));
console.log('@38:', dv2.getUint32(mdla + 38, true).toString(16));
console.log('@42:', dv2.getUint32(mdla + 42, true).toString(16), '=', dv2.getUint32(mdla + 42, true));
console.log('@46:', dv2.getUint32(mdla + 46, true));
console.log('@50:', dv2.getUint32(mdla + 50, true).toString(16), '=', dv2.getUint32(mdla + 50, true));
console.log('@54:', dv2.getUint32(mdla + 54, true));
console.log('@58:', dv2.getUint32(mdla + 58, true));
console.log('@62:', dv2.getUint32(mdla + 62, true));
console.log('@66:', dv2.getUint32(mdla + 66, true));
console.log('@70:', dv2.getUint32(mdla + 70, true));

// 数据区从哪开始？@54 后是 float 序列
// 尝试找绑定矩阵（bind pose）区域：53 骨骼 × 矩阵
// 或者动画帧数据
console.log('\n@70-150 字节:');
console.log(Buffer.from(buf.slice(mdla + 70, mdla + 150)).toString('hex'));
console.log('\n@70 起 float:');
for (let i = 0; i < 20; i++) {
  console.log('  @' + (70 + i * 4) + ': ' + dv2.getFloat32(mdla + 70 + i * 4, true).toFixed(3));
}
