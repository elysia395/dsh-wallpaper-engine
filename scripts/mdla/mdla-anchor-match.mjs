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

// 1. 解析 MDLS 53 骨骼 anchors (tp 或矩阵平移列)
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
  let tp = null;
  try {
    const m = infoStr.match(/"tp"\s*:\s*"([^"]+)"/);
    if (m) tp = m[1].trim().split(/\s+/).map(Number);
  } catch (e) {}
  bones.push({ b, tmp, type, unk1, entryLen, floats, tp, info: infoStr.slice(0, 40) });
  p = infoStart + infoStr.length + 1;
}
console.log('解析骨骼数:', bones.filter(b => !b.error).length);
console.log('骨骼列表 (b, type, entryLen, 矩阵平移列(floats[12],floats[13]), tp):');
for (const b of bones) {
  if (b.error) { console.log(`  B${b.b}: ERROR`); continue; }
  const tx = b.floats.length > 12 ? b.floats[12] : NaN;
  const ty = b.floats.length > 13 ? b.floats[13] : NaN;
  console.log(`  B${String(b.b).padStart(2)}: type=${b.type} len=${b.entryLen} mtxT=(${isFinite(tx) ? tx.toFixed(2) : '?'},${isFinite(ty) ? ty.toFixed(2) : '?'}) tp=${b.tp ? b.tp.map(v => v.toFixed ? v.toFixed(2) : v).join(',') : '?'}`);
}

// 2. 在 MDLA 中找每个骨骼的块起点：扫描 tail 区，找 tx,ty 与 anchor 匹配的连续段
// 先确定 tail 起点：head = 53 块 × 133 entries？需要验证。
// 用 anchor 匹配法：扫描整个 MDLA 数据，对每个 bone 找 (tx,ty) ≈ anchor 的 entry
console.log('\n=== 扫描 MDLA 中 anchor 匹配 ===');
const DATA0 = mdla + 63;
const ENTRIES = Math.floor((mdle - DATA0) / 36);
// 对每个 bone, 找所有 entry 中 |tx-anchor|+|ty-anchor| < 5 的位置（取前 5 个）
for (const b of bones) {
  if (b.error) continue;
  const ax = b.tp ? b.tp[0] : (b.floats.length > 12 ? b.floats[12] : NaN);
  const ay = b.tp ? b.tp[1] : (b.floats.length > 13 ? b.floats[13] : NaN);
  if (!isFinite(ax)) continue;
  const hits = [];
  // 每块内采样：每隔 133 个 entry 采样一次（块首），加上精确扫描前 2000 entries 找首个匹配
  for (let k = 0; k < Math.min(ENTRIES, 8000); k++) {
    const o = DATA0 + k * 36;
    const tx = dv2.getFloat32(o, true), ty = dv2.getFloat32(o + 4, true);
    if (isFinite(tx) && Math.abs(tx - ax) + Math.abs(ty - ay) < 5) {
      hits.push(k);
      if (hits.length >= 3) break;
    }
  }
  if (hits.length) {
    console.log(`  B${String(b.b).padStart(2)} anchor(${ax.toFixed(1)},${ay.toFixed(1)}) 命中 entry: ${hits.join(', ')}`);
  } else {
    console.log(`  B${String(b.b).padStart(2)} anchor(${ax.toFixed(1)},${ay.toFixed(1)}) 无命中 (<8000)`);
  }
}
