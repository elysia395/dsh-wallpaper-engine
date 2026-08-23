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
const buf = read('models/发_puppet.mdl');
const dv2 = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const mdla = 4057, mdle = 32923;
const DATA0 = mdla + 99; // 数据起点
const ENTRIES = Math.floor((mdle - DATA0) / 36);
console.log('后发数据条目:', ENTRIES);

// 尝试块长: 6 骨骼, 找能整除的结构
// 800 条 / 6 = 133.33 → 不是简单 6×133
// 尝试多种块长验证每块起点 anchor 匹配
const bones = [
  { b: 0, anchor: [1166.0, 198.8] },
  { b: 1, anchor: [-679.5, -393.7] },
  { b: 2, anchor: [-1268.1, -732.2] },
  { b: 3, anchor: [-544.4, -38.2] },
  { b: 4, anchor: [911.2, 552.5] },
  { b: 5, anchor: [-1107.2, -1478.6] },
];
function decodeBone(b, entryIdx) {
  const rot = (2 * b) % 9;
  const o = DATA0 + entryIdx * 36;
  const un = [];
  for (let i = 0; i < 9; i++) un.push(dv2.getFloat32(o + ((i + rot) % 9) * 4, true));
  return un;
}

console.log('\n=== 尝试块长 ===');
for (const blk of [133, 100, 134, 200, 400, 160]) {
  let ok = 0;
  for (let b = 0; b < 6; b++) {
    const start = b * blk;
    if (start >= ENTRIES) break;
    const un = decodeBone(b, start);
    if (isFinite(un[0]) && Math.abs(un[0] - bones[b].anchor[0]) < 50 && Math.abs(un[1] - bones[b].anchor[1]) < 50) ok++;
  }
  if (ok > 0) console.log(`  块长 ${blk}: ${ok}/6 起点匹配`);
}

// 扫描每骨骼块起点 (anchor 匹配)
console.log('\n=== 逐骨骼找块起点 ===');
let cursor = 0;
const starts = [];
for (let b = 0; b < 6; b++) {
  let start = -1;
  for (let k = cursor; k < Math.min(cursor + 300, ENTRIES); k++) {
    const un = decodeBone(b, k);
    if (isFinite(un[0]) && Math.abs(un[0] - bones[b].anchor[0]) < 50 && Math.abs(un[1] - bones[b].anchor[1]) < 50) { start = k; break; }
  }
  starts.push({ b, start });
  console.log(`  B${b}: 起点 entry ${start}`);
  cursor = start >= 0 ? start + 1 : cursor;
}
// 块长 = 起点差
for (let i = 1; i < starts.length; i++) {
  if (starts[i].start > 0 && starts[i - 1].start > 0) {
    console.log(`  B${i-1}→B${i} 块长: ${starts[i].start - starts[i-1].start}`);
  }
}
const lastEnd = starts[5].start;
console.log('B5 起点:', lastEnd, '总条目:', ENTRIES, '剩余:', ENTRIES - lastEnd);
