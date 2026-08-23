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
const DATA0 = mdla + 63;
const ENTRIES = Math.floor((mdle - DATA0) / 36);
const TAIL = 7049;

function decodeWithRot(rot, k) {
  const o = DATA0 + k * 36;
  const un = [];
  for (let i = 0; i < 9; i++) un.push(dv2.getFloat32(o + ((i + rot) % 9) * 4, true));
  return un;
}
// 放宽: 只要求 pos 有限且 |pos|<4000, scale ≈1
function isSane(un) {
  return isFinite(un[0]) && isFinite(un[1]) && isFinite(un[6]) && isFinite(un[7]) && isFinite(un[8])
    && Math.abs(un[0]) < 4000 && Math.abs(un[1]) < 4000
    && Math.abs(un[6] - 1) < 0.2 && Math.abs(un[7] - 1) < 0.2 && Math.abs(un[8] - 1) < 0.2;
}

// 采样扫描: 每个 tail entry 的干净 rot 集
console.log('=== tail 采样 (每 30 条) 的 rot 归属 ===');
const TAIL_END = ENTRIES;
for (let k = TAIL; k < TAIL_END; k += 30) {
  const cleans = [];
  for (let r = 0; r < 9; r++) {
    if (isSane(decodeWithRot(r, k))) cleans.push(r);
  }
  if (cleans.length) console.log(`  k=${k}: rot ${cleans.join(',')}`);
  else console.log(`  k=${k}: 无`);
}

// 扫描 rot=5 连续段 (B52/43/34/25/16/7) — 找第一个完整块的边界
console.log('\n=== rot5 块边界 (放宽) ===');
let inBlock = false, blockStart = -1;
const blocks = [];
for (let k = TAIL; k < TAIL_END; k++) {
  const sane = isSane(decodeWithRot(5, k));
  if (sane && !inBlock) { inBlock = true; blockStart = k; }
  if (!sane && inBlock) {
    blocks.push({ start: blockStart, end: k, len: k - blockStart });
    inBlock = false;
  }
}
if (inBlock) blocks.push({ start: blockStart, end: TAIL_END, len: TAIL_END - blockStart });
console.log('rot5 块数:', blocks.length);
for (const bl of blocks.slice(0, 8)) {
  const un = decodeWithRot(5, bl.start);
  console.log(`  块 [${bl.start}-${bl.end}) len=${bl.len} 首pos=(${un[0].toFixed(1)},${un[1].toFixed(1)})`);
}
