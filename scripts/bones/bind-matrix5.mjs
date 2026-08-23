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

// 绑定矩阵 @74 起，步长 36B。每个矩阵 = ?
// 模式: [16B 零][1.0,1.0,1.0][433.68, 800.xx][下个矩阵开始?]
// 36B = 9 float。9 float = 3x3 旋转矩阵？但看到 [0,0,0,0, 1,1,1, 433, 800] 是 16B零+3个1+2个平移
// 重新看: @74-109 (36B): 00 00 00 00 ×4 (16B) | 00 00 80 3f 00 00 80 3f 00 00 80 3f (3×1.0) | 72 2d d8 43 37 1c 45 44 (433.68, 800.xx)
// 这是 [16B 未知][scale 1,1,1][translation x,y]？缺 z？
// 或者: 前 16B 是旋转四元数的一部分?
// 让我 dump 完整 53 骨骼 × 36B
console.log('绑定矩阵区（@74 起, 36B 步长, 前 12 骨骼）:');
for (let m = 0; m < 12; m++) {
  const o = mdla + 74 + m * 36;
  const floats = [];
  for (let i = 0; i < 9; i++) floats.push(dv2.getFloat32(o + i * 4, true));
  console.log('  B' + String(m).padStart(2) + ': [' + floats.map(f => f.toFixed(2)).join(', ') + ']');
}
console.log('\n完整 36B 布局 @74 (B0) 每 4 字节:');
for (let i = 0; i < 9; i++) {
  const o = mdla + 74 + i * 4;
  console.log('  @' + (74 + i * 4) + ': f32=' + dv2.getFloat32(o, true).toFixed(2) + ' u32=' + dv2.getUint32(o, true) + ' hex=' + Buffer.from(buf.slice(o, o + 4)).toString('hex'));
}
