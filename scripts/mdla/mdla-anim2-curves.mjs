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
const BLOCK = 601;
function decodeFrame(b, f) {
  const rot = (2 * b) % 9;
  const o = DATA2 + (b * BLOCK + f) * 36;
  const un = [];
  for (let i = 0; i < 9; i++) un.push(dv2.getFloat32(o + ((i + rot) % 9) * 4, true));
  return un;
}

// 1) 验证所有骨骼 f=0 和 f=1
console.log('=== 全骨骼 f=0/f=1 检查 ===');
let special = [];
for (let b = 0; b < 53; b++) {
  const f0 = decodeFrame(b, 0);
  const f1 = decodeFrame(b, 1);
  const f0special = Math.abs(f0[6]) < 0.5 || Math.abs(f0[7]) < 0.5 || !isFinite(f0[0]);
  if (f0special) special.push(b);
}
console.log('f=0 特殊骨骼:', special.join(','));

// 2) 每块动画幅度统计: pos 和 rot 在 f=1..600 的 min/max
console.log('\n=== 每块动画幅度 (f=1..600) ===');
const moving = [];
for (let b = 0; b < 53; b++) {
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  let minR = 1e9, maxR = -1e9;
  let anyValid = false;
  for (let f = 1; f < BLOCK; f++) {
    const un = decodeFrame(b, f);
    if (!isFinite(un[0])) continue;
    anyValid = true;
    if (un[0] < minX) minX = un[0]; if (un[0] > maxX) maxX = un[0];
    if (un[1] < minY) minY = un[1]; if (un[1] > maxY) maxY = un[1];
    const r = Math.abs(un[3]) + Math.abs(un[4]) + Math.abs(un[5]);
    if (r < minR) minR = r; if (r > maxR) maxR = r;
  }
  const dx = maxX - minX, dy = maxY - minY;
  const dr = maxR - minR;
  if (dx > 0.5 || dy > 0.5 || dr > 0.05) {
    moving.push(b);
    if (b < 12 || b >= 40) {
      console.log(`  B${String(b).padStart(2)}: pos Δ(${dx.toFixed(1)},${dy.toFixed(1)}) rotΔ=${dr.toFixed(3)} 范围 x[${minX.toFixed(1)},${maxX.toFixed(1)}] y[${minY.toFixed(1)},${maxY.toFixed(1)}]`);
    }
  }
}
console.log('运动骨骼数:', moving.length, '/ 53');
console.log('运动骨骼:', moving.join(','));

// 3) 提取 B22 (裙摆?) 的 pos 曲线采样
console.log('\n=== B22 曲线采样 ===');
for (const f of [0, 1, 50, 100, 200, 300, 400, 500, 600]) {
  const un = decodeFrame(22, f);
  console.log(`  f=${f}: pos=(${un[0].toFixed(1)},${un[1].toFixed(1)}) rot=(${un[3].toFixed(4)},${un[4].toFixed(4)},${un[5].toFixed(4)})`);
}
