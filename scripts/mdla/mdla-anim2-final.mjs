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

// 验证块起点公式 b×601: 检查 f=0 (特殊帧) 和 f=1 (正常帧) 对所有骨骼
console.log('=== 块起点 b×601 验证 (f=0 与 f=1) ===');
let ok0 = 0, ok1 = 0;
const animBones = [];
for (let b = 0; b < 53; b++) {
  const f0 = decodeFrame(b, 0);
  const f1 = decodeFrame(b, 1);
  const ax = bones[b].mtxT[0], ay = bones[b].mtxT[1];
  const isSpecial = Math.abs(f0[6]) < 0.5 || Math.abs(f0[7]) < 0.5; // scale 部分为 0
  const m1 = isFinite(f1[0]) && Math.abs(f1[0] - ax) < 3 && Math.abs(f1[1] - ay) < 3;
  if (isSpecial) ok0++;
  if (m1) ok1++;
  else animBones.push(b);
  if (b < 8 || b >= 45) {
    console.log(`  B${String(b).padStart(2)}: f0 pos=(${f0[0].toFixed(1)},${f0[1].toFixed(1)}) scale=(${f0[6].toFixed(1)},${f0[7].toFixed(1)}) ${isSpecial ? '特殊' : ''} | f1 pos=(${f1[0].toFixed(1)},${f1[1].toFixed(1)}) ${m1 ? '✓' : '✗'}`);
  }
}
console.log('f0 特殊帧数:', ok0, '/ 53');
console.log('f1 匹配 anchor:', ok1, '/ 53');
console.log('f1 不匹配(动画骨骼):', animBones.join(','));

// 检查动画骨骼的 f1 到 f600 是否平滑变化
console.log('\n=== 动画骨骼 f=0,1,10,300,600 ===');
for (const b of animBones.slice(0, 8)) {
  const vals = [0, 1, 10, 150, 300, 450, 600].map(f => {
    const un = decodeFrame(b, f);
    return `(${un[0].toFixed(1)},${un[1].toFixed(1)})`;
  });
  console.log(`  B${b}: ${vals.join(' ')}`);
}
