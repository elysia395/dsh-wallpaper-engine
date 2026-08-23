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

function decodeForBone(b, k) {
  const rot = (2 * b) % 9;
  const o = DATA0 + k * 36;
  const un = [];
  for (let i = 0; i < 9; i++) un.push(dv2.getFloat32(o + ((i + rot) % 9) * 4, true));
  return un;
}

// tail 起点: 53×133 = 7049
const TAIL = 7049;
console.log('tail 起点 entry', TAIL, 'tail 条目数', ENTRIES - TAIL, '(=', ENTRIES - TAIL, ')');

// 对每个 tail entry, 试所有 53 个骨骼的解码, 找 "合理" 的 (pos 有限且 |pos|<4000, rot 接近 0, scale 接近 1)
// 采样: 每 100 个 entry 分析一次
console.log('\n=== tail 每 150 entry 的归属骨骼 ===');
for (let k = TAIL; k < ENTRIES; k += 150) {
  let best = null;
  for (let b = 0; b < 53; b++) {
    const un = decodeForBone(b, k);
    const sane = isFinite(un[0]) && isFinite(un[1]) && Math.abs(un[0]) < 4000 && Math.abs(un[1]) < 4000
      && Math.abs(un[3]) < 0.5 && Math.abs(un[4]) < 0.5 && Math.abs(un[5]) < 0.5
      && Math.abs(un[6] - 1) < 0.1 && Math.abs(un[7] - 1) < 0.1;
    if (sane) {
      best = { b, pos: [un[0], un[1]], scale: [un[6], un[7], un[8]] };
      break;
    }
  }
  if (best) {
    console.log(`  k=${k}: 归属 B${best.b} pos=(${best.pos[0].toFixed(1)},${best.pos[1].toFixed(1)}) scale=(${best.scale.map(v => v.toFixed(1)).join(',')})`);
  } else {
    console.log(`  k=${k}: 无匹配`);
  }
}

// 精确找每块边界: 从 TAIL 起, 解码为 B52 (第一块可能是 B52), 然后找变化模式
// 更稳: 对 k 递增, 记录 "归属骨骼" 变化点
console.log('\n=== tail 块边界 (归属变化点) ===');
let prevBone = -1;
let lastChange = TAIL;
let curStart = TAIL;
const boundaryInfo = [];
for (let k = TAIL; k < ENTRIES; k++) {
  let found = -1;
  for (let b = 0; b < 53; b++) {
    const un = decodeForBone(b, k);
    const sane = isFinite(un[0]) && isFinite(un[1]) && Math.abs(un[0]) < 4000 && Math.abs(un[1]) < 4000
      && Math.abs(un[3]) < 0.5 && Math.abs(un[4]) < 0.5 && Math.abs(un[5]) < 0.5
      && Math.abs(un[6] - 1) < 0.1 && Math.abs(un[7] - 1) < 0.1;
    if (sane) { found = b; break; }
  }
  if (found !== prevBone) {
    if (prevBone >= 0) {
      boundaryInfo.push({ start: curStart, end: k, len: k - curStart, bone: prevBone });
    }
    prevBone = found;
    curStart = k;
  }
}
boundaryInfo.push({ start: curStart, end: ENTRIES, len: ENTRIES - curStart, bone: prevBone });
console.log('块数:', boundaryInfo.length);
let sum = 0;
for (const bi of boundaryInfo) {
  sum += bi.len;
  console.log(`  块 B${bi.bone}: entries [${bi.start}-${bi.end}) len=${bi.len}`);
}
console.log('总:', sum);
