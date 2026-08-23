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

// 用合理阈值 (pos 变化 > 0.05 或 rot 变化 > 0.001) 检测活跃
console.log('=== 动画2 每骨骼活跃 (阈值: Δpos>0.05 或 Δrot>0.001) ===');
const animBones = [];
for (let b = 0; b < 53; b++) {
  let first = -1, last = -1;
  let prev = decodeFrame(b, 1);
  for (let f = 2; f < BLOCK; f++) {
    const un = decodeFrame(b, f);
    const dp = Math.abs(un[0] - prev[0]) + Math.abs(un[1] - prev[1]);
    const dr = Math.abs(un[3] - prev[3]) + Math.abs(un[4] - prev[4]) + Math.abs(un[5] - prev[5]);
    if (dp > 0.05 || dr > 0.001) {
      if (first < 0) first = f;
      last = f;
    }
    prev = un;
  }
  if (first >= 0) {
    animBones.push(b);
    const un = decodeFrame(b, first);
    const ax = bones[b].mtxT[0], ay = bones[b].mtxT[1];
    console.log(`  B${String(b).padStart(2)}: 活跃 f=[${first}..${last}] len=${last - first + 1} 首帧pos=(${un[0].toFixed(1)},${un[1].toFixed(1)}) anchor=(${ax.toFixed(1)},${ay.toFixed(1)})`);
  }
}
console.log('活跃骨骼:', animBones.join(','), '(', animBones.length, ')');

// 检查这些活跃骨骼的幅度
console.log('\n=== 活跃骨骼幅度 (相对 anchor 的 max 偏移) ===');
for (const b of animBones.slice(0, 30)) {
  const ax = bones[b].mtxT[0], ay = bones[b].mtxT[1];
  let maxD = 0, maxRot = 0;
  for (let f = 1; f < BLOCK; f++) {
    const un = decodeFrame(b, f);
    const d = Math.hypot(un[0] - ax, un[1] - ay);
    if (d > maxD) maxD = d;
    const r = Math.hypot(un[3], un[4], un[5]);
    if (r > maxRot) maxRot = r;
  }
  console.log(`  B${String(b).padStart(2)}: max偏移=${maxD.toFixed(1)} max旋转=${maxRot.toFixed(3)}`);
}
