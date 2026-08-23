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
const DATA0 = mdla + 63;
const ENTRIES = Math.floor((mdle - DATA0) / 36);

// 解析 MDLS bones
let p = mdls + 17;
const bones = [];
for (let b = 0; b < 53 && p < mdla; b++) {
  const type = dv2.getUint32(p + 1, true);
  const entryLen = dv2.getUint32(p + 9, true);
  if (entryLen <= 0 || entryLen > 10000) { p += 9; bones.push({ b, error: true }); continue; }
  const floats = [];
  for (let i = 0; i < Math.floor(entryLen / 4); i++) floats.push(dv2.getFloat32(p + 13 + i * 4, true));
  const infoStart = p + 13 + entryLen;
  let infoStr = '';
  let ip2 = infoStart;
  while (ip2 < buf.length && buf[ip2] >= 32 && buf[ip2] < 127) { infoStr += String.fromCharCode(buf[ip2]); ip2++; }
  bones.push({ b, type, entryLen, mtxT: [floats[12] ?? NaN, floats[13] ?? NaN] });
  p = infoStart + infoStr.length + 1;
}

// 解码函数: unrotated[i] = stored[(i+rot)%9]
function decodeForBone(b, k) {
  const rot = (2 * b) % 9;
  const o = DATA0 + k * 36;
  const un = [];
  for (let i = 0; i < 9; i++) un.push(dv2.getFloat32(o + ((i + rot) % 9) * 4, true));
  return un;
}

const TAIL = 7049;
console.log('tail 起点 entry', TAIL);

// tail 块边界: 用固定 rot=5 (B52) 解码, 找 pos 突变点 (每块锚点不同)
// 但不同骨骼 rot 不同! 先假设 tail 骨骼顺序 = head 顺序 (B0..B52), 逐块解码:
// 块长 = 601 或 602? 尝试按顺序累积, 每块用对应骨骼的 rot 解码, 检查合理性
console.log('\n=== 尝试顺序解码 tail (B0..B52, 块长 601/602) ===');
let cursor = TAIL;
for (let b = 0; b < 53; b++) {
  if (cursor >= ENTRIES) break;
  const un = decodeForBone(b, cursor);
  const sane = isFinite(un[0]) && Math.abs(un[0]) < 4000 && Math.abs(un[1]) < 4000
    && Math.abs(un[6] - 1) < 0.1 && Math.abs(un[7] - 1) < 0.1;
  const rot = (2 * b) % 9;
  console.log(`  B${String(b).padStart(2)} (rot=${rot}): 块首@${cursor} 解码 pos=(${un[0].toFixed(1)},${un[1].toFixed(1)}) scale=(${un[6].toFixed(1)},${un[7].toFixed(1)}) ${sane ? '' : '<== 不合理'}`);
  cursor += (b % 2 === 0) ? 602 : 601; // 猜测交替
}
console.log('按 601/602 交替后 cursor =', cursor);

// 反方向: 假设 tail 骨骼顺序是 B52..B0 (倒序)? 或按 mtxT 匹配
console.log('\n=== 找 tail 每块起点 (扫描 pos 突变) ===');
// 用 rot=5 解码整段 tail, 看 pos 序列的突变点
const posSeq = [];
for (let k = TAIL; k < ENTRIES; k++) {
  const un = decodeForBone(52, k);
  posSeq.push([un[0], un[1]]);
}
// 找突变: |Δpos| > 300
const jumps = [];
for (let k = 1; k < posSeq.length; k++) {
  const d = Math.abs(posSeq[k][0] - posSeq[k - 1][0]) + Math.abs(posSeq[k][1] - posSeq[k - 1][1]);
  if (d > 300) jumps.push({ k: TAIL + k, d });
}
console.log('突变点数:', jumps.length);
for (const j of jumps.slice(0, 60)) {
  console.log(`  entry ${j.k} (Δ=${j.d.toFixed(0)})`);
}
// 块长度 = 相邻突变点间距
console.log('\n块长度序列:');
let prev = TAIL;
const lens = [];
for (const j of jumps) { lens.push(j.k - prev); prev = j.k; }
lens.push(ENTRIES - prev);
console.log(lens.join(','));
console.log('块数:', lens.length);
