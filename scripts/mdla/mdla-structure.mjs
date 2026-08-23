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

// 解码单个 entry: 返回未旋转的 9 floats
function decodeEntry(k) {
  const o = DATA0 + k * 36;
  const stored = [];
  for (let i = 0; i < 9; i++) stored.push(dv2.getFloat32(o + i * 4, true));
  return stored; // 原始存储
}
// 对 bone b, 用 rot 解码
function decodeForBone(b, k) {
  const rot = (2 * b) % 9;
  const stored = decodeEntry(k);
  const un = [];
  for (let i = 0; i < 9; i++) un.push(stored[(i + rot) % 9]);
  return un; // [pos.x, pos.y, pos.z, rot.x, rot.y, rot.z, scale.x, scale.y, scale.z]
}

// 逐骨骼找 head 块起点: 从 cursor 起找解码后 anchor 匹配 mtxT 的 entry
let cursor = 0;
const blocks = [];
for (let b = 0; b < 53; b++) {
  const ax = bones[b].mtxT[0], ay = bones[b].mtxT[1];
  // 从 cursor 向前找（最多 200 entries）
  let start = -1;
  for (let k = cursor; k < Math.min(cursor + 200, ENTRIES); k++) {
    const un = decodeForBone(b, k);
    if (isFinite(un[0]) && Math.abs(un[0] - ax) < 1 && Math.abs(un[1] - ay) < 1) {
      start = k;
      break;
    }
  }
  if (start < 0) { console.log(`B${b}: 未找到起点 (cursor=${cursor})`); break; }
  // 确定 head 长度: 找连续相同条目的长度
  let len = 0;
  for (let k = start; k < ENTRIES; k++) {
    const un = decodeForBone(b, k);
    if (Math.abs(un[0] - ax) < 1 && Math.abs(un[1] - ay) < 1) len++;
    else break;
  }
  blocks.push({ b, start, len });
  cursor = start + len;
  const un0 = decodeForBone(b, start);
  console.log(`B${String(b).padStart(2)}: head 块 start=entry ${start} len=${len} anchor=(${un0[0].toFixed(1)},${un0[1].toFixed(1)}) scale=(${un0[6].toFixed(1)},${un0[7].toFixed(1)},${un0[8].toFixed(1)})`);
}

console.log('\ncursor 结束于 entry', cursor, '/', ENTRIES, '剩余', ENTRIES - cursor);
// 剩余 = tail。分析 tail 结构
const tailStart = cursor;
console.log('tail 起点 entry', tailStart, '@' + (DATA0 + tailStart * 36 - mdla));
// tail 也按骨骼分块? 打印 tail 前 40 条的解码 (用 B52 或按序)
console.log('\n=== tail 前 30 条原始存储 ===');
for (let k = tailStart; k < tailStart + 30; k++) {
  const st = decodeEntry(k);
  console.log(`  k=${k}: [` + st.map(f => isFinite(f) ? f.toFixed(2) : 'INF').join(', ') + ']');
}
