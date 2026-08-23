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

// @63 起 36B 都是 (432,788)。找第一个非 (432,788) 的 36B 块 = B0 块结束
console.log('找 B0 块结束（第一个非 432,788 的 36B 块）:');
let firstDiff = -1;
for (let k = 0; k < 500; k++) {
  const o = mdla + 63 + k * 36;
  if (o + 36 > mdle) break;
  const f0 = dv2.getFloat32(o, true);
  const f1 = dv2.getFloat32(o + 4, true);
  if (Math.abs(f0 - 432.4) > 0.5 || Math.abs(f1 - 788.4) > 0.5) {
    firstDiff = k;
    break;
  }
}
console.log('第一个不同块: k=' + firstDiff, '→ @', 63 + firstDiff * 36, '相对 MDLA');

if (firstDiff > 0) {
  const o = mdla + 63 + firstDiff * 36;
  console.log('该块内容:');
  for (let i = 0; i < 9; i++) {
    console.log('  @' + (63 + firstDiff * 36 + i * 4) + ': f32=' + dv2.getFloat32(o + i * 4, true).toFixed(2) + ' 字节=' + Buffer.from(buf.slice(o + i * 4, o + i * 4 + 4)).toString('hex'));
  }
  // 之前的块（B0 块内部）
  console.log('\nB0 块最后几个（@63 + (firstDiff-2)*36）:');
  for (let k = firstDiff - 2; k <= firstDiff + 1; k++) {
    const o2 = mdla + 63 + k * 36;
    const f0 = dv2.getFloat32(o2, true), f1 = dv2.getFloat32(o2 + 4, true);
    console.log('  k=' + k + ' @' + (63 + k * 36) + ': (' + f0.toFixed(1) + ', ' + f1.toFixed(1) + ')');
  }
  // B0 块大小 = firstDiff * 36
  console.log('\nB0 块大小:', firstDiff * 36, 'B → 帧数?', firstDiff);
}
