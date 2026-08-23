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
const DATA0 = mdla + 66; // 数据起点
const ENTRIES = Math.floor((mdle - DATA0) / 36);
console.log('后发: 数据条目', ENTRIES, '= 800');

// 6 骨骼, rot = 2b mod 9 (b=0..5)
// 检查块结构: 800 / 6 = 133.33 → 不是 133/块
// 尝试: 每块大小 = ? 先看块起点是否能匹配 anchor
// 解析 MDLS 骨骼
const mdls = buf.indexOf(Buffer.from('MDLS'));
console.log('MDLS@', mdls);
// MDLS 头: MDLS0004 + u32 + u32(骨骼数)
const boneCount = dv2.getUint32(mdls + 13, true);
console.log('骨骼数:', boneCount);

// 数据区结构探测: 前 20 条原始
console.log('\n前 20 条 (36B):');
for (let k = 0; k < 20; k++) {
  const o = DATA0 + k * 36;
  const vals = [];
  for (let i = 0; i < 9; i++) vals.push(dv2.getFloat32(o + i * 4, true));
  console.log(`  k=${k}: [` + vals.map(f => f.toFixed(1)).join(', ') + ']');
}

// 尝试 6 块: 用 rot=2b mod 9 解码验证块起点
console.log('\n尝试 6 骨骼 × 块长:');
for (const blk of [133, 134, 132]) {
  let ok = 0;
  const total = 6 * blk;
  if (total > ENTRIES) continue;
  for (let b = 0; b < 6; b++) {
    const rot = (2 * b) % 9;
    const o = DATA0 + (b * blk) * 36;
    const un = [];
    for (let i = 0; i < 9; i++) un.push(dv2.getFloat32(o + ((i + rot) % 9) * 4, true));
    // 检查 pos 合理性
    if (isFinite(un[0]) && Math.abs(un[0]) < 3000 && isFinite(un[1]) && Math.abs(un[1]) < 3000) ok++;
  }
  console.log(`  块长 ${blk}: ${ok}/6 块起点合理`);
}
