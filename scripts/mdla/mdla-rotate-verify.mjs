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
const mdls = 64571;

// 解析 MDLS bones 取 mtxT (矩阵平移列)
let p = mdls + 17;
const bones = [];
for (let b = 0; b < 53 && p < mdla; b++) {
  const tmp = buf[p];
  const type = dv2.getUint32(p + 1, true);
  const unk1 = dv2.getUint32(p + 5, true);
  const entryLen = dv2.getUint32(p + 9, true);
  if (entryLen <= 0 || entryLen > 10000) { p += 9; bones.push({ b, error: true }); continue; }
  const floatCount = Math.floor(entryLen / 4);
  const floats = [];
  for (let i = 0; i < floatCount; i++) floats.push(dv2.getFloat32(p + 13 + i * 4, true));
  const infoStart = p + 13 + entryLen;
  let infoStr = '';
  let ip2 = infoStart;
  while (ip2 < buf.length && buf[ip2] >= 32 && buf[ip2] < 127) { infoStr += String.fromCharCode(buf[ip2]); ip2++; }
  bones.push({ b, type, entryLen, mtxT: [floats[12] ?? NaN, floats[13] ?? NaN] });
  p = infoStart + infoStr.length + 1;
}

const DATA0 = mdla + 63;
// 验证旋转假设: 对 head 前 12 块, 用 2b mod 9 旋转后读 anchor
console.log('=== 旋转假设验证 (head 前 12 块) ===');
// 块边界: 逐块推进, 块长 = 133 或 134 (通过旋转后 anchor 是否匹配判断)
let cursor = 0;
for (let b = 0; b < 12; b++) {
  const rot = (2 * b) % 9;
  // 读当前 entry 的 9 floats
  const o = DATA0 + cursor * 36;
  const f = [];
  for (let i = 0; i < 9; i++) f.push(dv2.getFloat32(o + i * 4, true));
  // 旋转: stored = rotateRight(unrotated, rot) => unrotated[i] = stored[(i+rot)%9]
  // anchor = unrotated[0], unrotated[1]
  const ax = f[(0 + rot) % 9], ay = f[(1 + rot) % 9];
  const sx = f[(6 + rot) % 9], sy = f[(7 + rot) % 9], sz = f[(8 + rot) % 9];
  const expected = bones[b].mtxT;
  const match = isFinite(ax) && Math.abs(ax - expected[0]) < 1 && Math.abs(ay - expected[1]) < 1;
  console.log(`  B${b}: rot=${rot} 旋转后 anchor=(${ax.toFixed(2)},${ay.toFixed(2)}) scale=(${sx.toFixed(1)},${sy.toFixed(1)},${sz.toFixed(1)}) 期望=(${expected[0].toFixed(2)},${expected[1].toFixed(2)}) ${match ? '✓' : '✗ MISMATCH'}`);
  // 判断块长: 检查下一条是否还是同 anchor (可能 134 首条 scale=0)
  // 简化: 假设 133, 由循环验证
  cursor += 133;
}
