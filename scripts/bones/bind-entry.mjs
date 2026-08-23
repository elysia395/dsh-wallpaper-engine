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
const mdla = 79842;

// 假设: 绑定矩阵条目 @74 起，步长 68B
// 但 @74 不是起始。@58: 00 b4 12 00 = 0x12B4 (4788)?? 
// 让我先完整 dump @54-74 找真正的条目起点
console.log('@54-90 每字节:');
for (let off = 54; off < 90; off += 2) {
  console.log('  @' + off + ': u16=' + dv2.getUint16(mdla + off, true) + ' f32=' + dv2.getFloat32(mdla + off, true).toFixed(2) + ' hex=' + Buffer.from(buf.slice(mdla + off, mdla + off + 4)).toString('hex'));
}

// 尝试: 骨骼条目从 @62 或 @70 开始
// @62: 72 2d d8 43 37 1c 45 44 = 433.68, 800.xx
// @70: 44 00 00 00 = 68
// 也许结构是: [float 433.68][float 800.xx][u32 68]... 每条目?
// 或: @58 = u32 4788 (数据大小), @62 = 433.68, @66 = 800.xx, @70 = 68(长度)
// 检查 68B 条目: @58 起 68B 到 @126, 下一条目 @126?
console.log('\n检查 68B 条目假设（@58 起）:');
for (let m = 0; m < 5; m++) {
  const o = mdla + 58 + m * 68;
  const vals = [];
  for (let i = 0; i < 17; i++) vals.push(dv2.getFloat32(o + i * 4, true));
  console.log('  E' + m + '@' + (58 + m * 68) + ': [' + vals.map(f => f.toFixed(2)).join(', ') + ']');
}

// 检查 64B 条目 (@58 起)
console.log('\n检查 64B 条目假设（@58 起）:');
for (let m = 0; m < 5; m++) {
  const o = mdla + 58 + m * 64;
  const vals = [];
  for (let i = 0; i < 16; i++) vals.push(dv2.getFloat32(o + i * 4, true));
  console.log('  E' + m + '@' + (58 + m * 64) + ': [' + vals.map(f => f.toFixed(2)).join(', ') + ']');
}
