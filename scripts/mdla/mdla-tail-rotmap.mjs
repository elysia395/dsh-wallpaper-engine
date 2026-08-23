import fs from 'fs';
const base = 'c:/program files (x86)/steam/steamapps/workshop/content/431960/';
const PKG = base + '3461168300/scene.pkg';
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
const TAIL = 7049;

// 所有骨骼的 rot 和 anchor (用 head 第 0 条 anchor)
// 直接: rot(b) = 2b mod 9
function decodeWithRot(rot, k) {
  const o = DATA0 + k * 36;
  const un = [];
  for (let i = 0; i < 9; i++) un.push(dv2.getFloat32(o + ((i + rot) % 9) * 4, true));
  return un;
}
function isClean(un) {
  return isFinite(un[0]) && isFinite(un[1]) && Math.abs(un[0]) < 4000 && Math.abs(un[1]) < 4000
    && Math.abs(un[3]) < 0.01 && Math.abs(un[4]) < 0.01 && Math.abs(un[5]) < 0.01
    && Math.abs(un[6] - 1) < 0.05 && Math.abs(un[7] - 1) < 0.05 && Math.abs(un[8] - 1) < 0.05;
}

// 每个 rot 值(0-8)对应哪些骨骼
const rotToBones = {};
for (let b = 0; b < 53; b++) {
  const r = (2 * b) % 9;
  (rotToBones[r] ||= []).push(b);
}
console.log('rot→骨骼:', JSON.stringify(rotToBones));

// 扫描 tail: 对每个 entry, 记录所有 "干净" 的 rot 解码
// 然后按连续段分组 (同一 rot 连续)
console.log('\n=== tail 每 entry 的干净 rot 集 (采样每 50 条) ===');
for (let k = TAIL; k < TAIL + 2500; k += 50) {
  const cleans = [];
  for (let r = 0; r < 9; r++) {
    if (isClean(decodeWithRot(r, k))) cleans.push(r);
  }
  if (cleans.length) {
    const det = cleans.map(r => `${r}(${rotToBones[r].join('/')})`).join(' ');
    console.log(`  k=${k}: rot ${det}`);
  } else {
    console.log(`  k=${k}: 无干净解码`);
  }
}

// 精细扫描: 找 rot 5 连续段的边界 (tail 第一块是 rot5)
console.log('\n=== rot=5 连续段边界 ===');
let inBlock = false;
let blockStart = -1;
const rot5Blocks = [];
for (let k = TAIL; k < ENTRIES; k++) {
  const clean = isClean(decodeWithRot(5, k));
  if (clean && !inBlock) { inBlock = true; blockStart = k; }
  if (!clean && inBlock) {
    rot5Blocks.push({ start: blockStart, end: k, len: k - blockStart });
    inBlock = false;
  }
}
if (inBlock) rot5Blocks.push({ start: blockStart, end: ENTRIES, len: ENTRIES - blockStart });
console.log('rot5 块数:', rot5Blocks.length);
for (const bl of rot5Blocks.slice(0, 10)) {
  const un0 = decodeWithRot(5, bl.start);
  console.log(`  块 [${bl.start}-${bl.end}) len=${bl.len} 首pos=(${un0[0].toFixed(1)},${un0[1].toFixed(1)})`);
}

// 验证: rot5 的骨骼 = B7/B16/B25/B34/B43/B52, 其中 B52 anchor=(-166.3,-28.5)
// tail 第一块首pos≈(-165.4,-29.6) → 接近 B52 → 确认第一块 = B52
// 现在检查: 是否 tail 从 B52 开始倒序? 第二块应该 rot = 2×51 mod 9 = 3
console.log('\n=== 找第二块 (rot=3, B51) 起始 ===');
for (const r of [3]) {
  let found = [];
  for (let k = TAIL + 580; k < TAIL + 640; k++) {
    if (isClean(decodeWithRot(r, k))) found.push(k);
  }
  console.log(`rot${r} 干净起点候选: ${found.slice(0, 20).join(',')}`);
}
