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

// MDLA 结构: 头部 + 数据。头部长度待定。
// 找数据区真正起点：扫描 @50 后，找第一个"合理的矩阵块"
// 之前 @70 = 0x44 (68)。0x44 可能是"骨骼名表长度"或"矩阵数量"
// 策略: 找包含 53 个连续 4x4 单位矩阵（对角 1）的块 = 绑定矩阵
// 或者绑定矩阵就在 @74 后的某处，只是我找错了位置

// 全扫描: 从 mdla+50 到 mdle，找 "对角线上有 1.0" 的 4x4 矩阵簇
function isIdentityLike(o) {
  const m = [
    dv2.getFloat32(o, true), dv2.getFloat32(o + 4, true), dv2.getFloat32(o + 8, true), dv2.getFloat32(o + 12, true),
    dv2.getFloat32(o + 16, true), dv2.getFloat32(o + 20, true), dv2.getFloat32(o + 24, true), dv2.getFloat32(o + 28, true),
    dv2.getFloat32(o + 32, true), dv2.getFloat32(o + 36, true), dv2.getFloat32(o + 40, true), dv2.getFloat32(o + 44, true),
    dv2.getFloat32(o + 48, true), dv2.getFloat32(o + 52, true), dv2.getFloat32(o + 56, true), dv2.getFloat32(o + 60, true),
  ];
  // 检查对角线接近 1，非对角线接近 0
  return Math.abs(m[0] - 1) < 0.01 && Math.abs(m[5] - 1) < 0.01 && Math.abs(m[10] - 1) < 0.01 &&
    Math.abs(m[1]) < 0.01 && Math.abs(m[2]) < 0.01 && Math.abs(m[4]) < 0.01 &&
    Math.abs(m[6]) < 0.01 && Math.abs(m[8]) < 0.01 && Math.abs(m[9]) < 0.01;
}

const candidates = [];
for (let off = mdla + 50; off + 64 * 3 < mdle; off += 4) {
  if (isIdentityLike(off)) {
    // 检查连续 3 个
    if (isIdentityLike(off + 64) && isIdentityLike(off + 128)) {
      candidates.push(off - mdla);
      if (candidates.length > 10) break;
    }
  }
}
console.log('单位矩阵簇位置（相对 MDLA）:', candidates.join(', '));
if (candidates.length) {
  const start = mdla + candidates[0];
  console.log('第一个簇 @', candidates[0], '—— 检查连续矩阵数:');
  let count = 0;
  while (isIdentityLike(start + count * 64)) count++;
  console.log('  连续单位矩阵:', count);
}
