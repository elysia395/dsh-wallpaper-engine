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
const ENTRIES = Math.floor((mdle - mdla - 63) / 36); // 38928
const DATA0 = mdla + 63;

console.log('总条目数:', ENTRIES, '数据起点 @63');
console.log('条目布局(部分1): [tx, ty, z, q?, q?, q?, sx, sy, sz]');

// 统计每条目 9 floats 的取值分布: 找哪些 float 位会变化
const stats = [];
for (let i = 0; i < 9; i++) stats.push(new Set());
let junk = 0;
for (let k = 0; k < ENTRIES; k++) {
  const o = DATA0 + k * 36;
  for (let i = 0; i < 9; i++) {
    const f = dv2.getFloat32(o + i * 4, true);
    if (!isFinite(f) || Math.abs(f) > 1e6) { junk++; continue; }
    // 量化到 0.01 统计唯一值
    stats[i].add(Math.round(f * 100) / 100);
  }
}
console.log('非有限/超大值条目数:', junk);
for (let i = 0; i < 9; i++) {
  console.log(`  float[${i}]: 唯一值 ${stats[i].size} 个`);
}

// 分段: 任何 float 变化超过 0.5 视为新块边界 (用 tx/ty = f0/f1)
console.log('\n=== 分段 (基于 f0/f1 变化 > 0.5) ===');
let segments = [];
let segStart = 0;
let prev = null;
for (let k = 0; k < ENTRIES; k++) {
  const o = DATA0 + k * 36;
  const tx = dv2.getFloat32(o, true), ty = dv2.getFloat32(o + 4, true);
  if (!isFinite(tx)) break; // 数据结束
  if (prev !== null) {
    const d = Math.abs(tx - prev[0]) + Math.abs(ty - prev[1]);
    if (d > 0.5) {
      segments.push({ start: segStart, end: k, len: k - segStart });
      segStart = k;
    }
  }
  prev = [tx, ty];
}
segments.push({ start: segStart, end: ENTRIES, len: ENTRIES - segStart });
console.log('分段数:', segments.length);
const lens = segments.map(s => s.len);
console.log('长度序列:', lens.join(','));

// 前 60 段详情 + 首条目
for (let i = 0; i < Math.min(segments.length, 60); i++) {
  const s = segments[i];
  const o = DATA0 + s.start * 36;
  const vals = [];
  for (let j = 0; j < 9; j++) vals.push(dv2.getFloat32(o + j * 4, true));
  console.log(`  段${i}: len=${s.len} (${s.start}-${s.end}) 首条目@${o - mdla}: [` + vals.map(f => isFinite(f) ? f.toFixed(2) : 'INF').join(', ') + ']');
}

// 检查每个段内部 f0/f1 是否恒定（静止段）还是变化（动画段）
console.log('\n=== 每段内部 f0/f1 变化范围 ===');
for (let i = 0; i < Math.min(segments.length, 60); i++) {
  const s = segments[i];
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (let k = s.start; k < s.end && k < ENTRIES; k++) {
    const o = DATA0 + k * 36;
    const tx = dv2.getFloat32(o, true), ty = dv2.getFloat32(o + 4, true);
    if (!isFinite(tx)) break;
    if (tx < minX) minX = tx; if (tx > maxX) maxX = tx;
    if (ty < minY) minY = ty; if (ty > maxY) maxY = ty;
  }
  const span = (maxX - minX) + (maxY - minY);
  console.log(`  段${i}: len=${s.len} tx范围[${minX.toFixed(1)},${maxX.toFixed(1)}] ty范围[${minY.toFixed(1)},${maxY.toFixed(1)}] span=${span.toFixed(1)} ${span > 1 ? '<== 动' : ''}`);
}
