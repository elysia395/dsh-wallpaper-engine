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

const DATA2 = mdla + 254324;
const TOTAL = Math.floor((mdle - DATA2) / 36);
function decodeAt(b, entryIdx) {
  const rot = (2 * b) % 9;
  const o = DATA2 + entryIdx * 36;
  const un = [];
  for (let i = 0; i < 9; i++) un.push(dv2.getFloat32(o + ((i + rot) % 9) * 4, true));
  return un;
}

// 对每块, 用"第一个匹配 anchor 的 entry"作为有效起点, 计算块长 = 下一块起点 - 本块起点
// 从 B0 开始顺序扫描
let cursor = 0;
const blocks = [];
for (let b = 0; b < 53; b++) {
  const ax = bones[b].mtxT[0], ay = bones[b].mtxT[1];
  // 找连续匹配段的起点和终点 (容差 3)
  let segStart = -1, segEnd = -1;
  for (let k = cursor; k < Math.min(cursor + 700, TOTAL); k++) {
    const un = decodeAt(b, k);
    const m = isFinite(un[0]) && Math.abs(un[0] - ax) < 3 && Math.abs(un[1] - ay) < 3;
    if (m && segStart < 0) segStart = k;
    if (m) segEnd = k + 1;
    if (segStart >= 0 && !m && segEnd > segStart + 5) break; // 段结束
  }
  blocks.push({ b, cursor, segStart, segEnd });
  // 下一块起点 = 本块段起点 + 601? 或 + 601/602
  // 打印本块前几个 entry 的 anchor 匹配情况
  const status = [];
  for (let k = cursor; k < cursor + 4; k++) {
    const un = decodeAt(b, k);
    const m = isFinite(un[0]) && Math.abs(un[0] - ax) < 3 && Math.abs(un[1] - ay) < 3;
    status.push(`${k}:${m ? '✓' : '✗'}`);
  }
  console.log(`B${String(b).padStart(2)} cursor=${cursor} 段[${segStart}-${segEnd}) ${status.join(' ')}`);
  // 前进: 段起点 + 601 (所有块统一 601, f=0 可能特殊)
  cursor = (segStart >= 0 ? segStart : cursor) + 601;
  if (cursor > TOTAL) break;
}
console.log('结束 cursor:', cursor, '/', TOTAL);
