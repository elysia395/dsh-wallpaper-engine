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
const mdla = 79842, mdle = 1481325;

// 扫描整个 MDLA 区，找 53 个连续 64B 矩阵块（旋转 3x3 正交 + 平移合理）
function isOrthogonal(r00, r01, r02, r10, r11, r12, r20, r21, r22) {
  // 行点积≈0, 行范数≈1
  const d01 = r00 * r10 + r01 * r11 + r02 * r12;
  const d02 = r00 * r20 + r01 * r21 + r02 * r22;
  const d12 = r10 * r20 + r11 * r21 + r12 * r22;
  const n0 = Math.sqrt(r00 * r00 + r01 * r01 + r02 * r02);
  const n1 = Math.sqrt(r10 * r10 + r11 * r11 + r12 * r12);
  const n2 = Math.sqrt(r20 * r20 + r21 * r21 + r22 * r22);
  return Math.abs(d01) < 0.05 && Math.abs(d02) < 0.05 && Math.abs(d12) < 0.05 &&
    Math.abs(n0 - 1) < 0.05 && Math.abs(n1 - 1) < 0.05 && Math.abs(n2 - 1) < 0.05;
}

const candidates = [];
for (let off = mdla + 50; off + 64 * 5 < mdle; off += 4) {
  // 检查连续 3 个矩阵是否正交
  let ok = true;
  for (let m = 0; m < 3; m++) {
    const o = off + m * 64;
    const r00 = dv.getFloat32(o, true), r01 = dv.getFloat32(o + 4, true), r02 = dv.getFloat32(o + 8, true);
    const r10 = dv.getFloat32(o + 16, true), r11 = dv.getFloat32(o + 20, true), r12 = dv.getFloat32(o + 24, true);
    const r20 = dv.getFloat32(o + 32, true), r21 = dv.getFloat32(o + 36, true), r22 = dv.getFloat32(o + 40, true);
    if (!isFinite(r00) || !isOrthogonal(r00, r01, r02, r10, r11, r12, r20, r21, r22)) { ok = false; break; }
  }
  if (ok) {
    // 检查 53 个全正交
    let allOk = true;
    for (let m = 3; m < 53; m++) {
      const o = off + m * 64;
      const r00 = dv.getFloat32(o, true), r01 = dv.getFloat32(o + 4, true), r02 = dv.getFloat32(o + 8, true);
      const r10 = dv.getFloat32(o + 16, true), r11 = dv.getFloat32(o + 20, true), r12 = dv.getFloat32(o + 24, true);
      const r20 = dv.getFloat32(o + 32, true), r21 = dv.getFloat32(o + 36, true), r22 = dv.getFloat32(o + 40, true);
      if (!isFinite(r00) || !isOrthogonal(r00, r01, r02, r10, r11, r12, r20, r21, r22)) { allOk = false; break; }
    }
    if (allOk) candidates.push(off);
    else if (candidates.length === 0) {
      // 只记录首个至少 3 个正交的位置用于诊断
    }
    if (candidates.length > 5) break;
  }
}
console.log('找到 53×64B 正交矩阵块位置:', candidates.map((o) => o - mdla).join(', '));

// 如果没有 64B，试 48B（3x4）
const candidates48 = [];
for (let off = mdla + 50; off + 48 * 5 < mdle; off += 4) {
  let ok = true;
  for (let m = 0; m < 3; m++) {
    const o = off + m * 48;
    const r00 = dv.getFloat32(o, true), r01 = dv.getFloat32(o + 4, true), r02 = dv.getFloat32(o + 8, true);
    const r10 = dv.getFloat32(o + 12, true), r11 = dv.getFloat32(o + 16, true), r12 = dv.getFloat32(o + 20, true);
    const r20 = dv.getFloat32(o + 24, true), r21 = dv.getFloat32(o + 28, true), r22 = dv.getFloat32(o + 32, true);
    if (!isFinite(r00) || !isOrthogonal(r00, r01, r02, r10, r11, r12, r20, r21, r22)) { ok = false; break; }
  }
  if (ok) {
    let allOk = true;
    for (let m = 3; m < 53; m++) {
      const o = off + m * 48;
      const r00 = dv.getFloat32(o, true), r01 = dv.getFloat32(o + 4, true), r02 = dv.getFloat32(o + 8, true);
      const r10 = dv.getFloat32(o + 12, true), r11 = dv.getFloat32(o + 16, true), r12 = dv.getFloat32(o + 20, true);
      const r20 = dv.getFloat32(o + 24, true), r21 = dv.getFloat32(o + 28, true), r22 = dv.getFloat32(o + 32, true);
      if (!isFinite(r00) || !isOrthogonal(r00, r01, r02, r10, r11, r12, r20, r21, r22)) { allOk = false; break; }
    }
    if (allOk) candidates48.push(off);
    if (candidates48.length > 5) break;
  }
}
console.log('找到 53×48B 正交矩阵块位置:', candidates48.map((o) => o - mdla).join(', '));
