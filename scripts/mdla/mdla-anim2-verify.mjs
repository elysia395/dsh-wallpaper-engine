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

// 解析 MDLS bones (mtxT)
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

// 动画 2: 数据起点 @254324 (相对 mdla), 块大小 21636B = 601 帧
const DATA2 = mdla + 254324;
const BLOCK2 = 601;
// 验证: 每骨骼块起点第一条的解码 (rot = 2b mod 9)
console.log('=== 动画 2 块验证 (假设 53 块 × 601 帧) ===');
let cursor = 0;
const matches = [];
for (let b = 0; b < 53; b++) {
  const rot = (2 * b) % 9;
  const o = DATA2 + cursor * 36;
  const st = [];
  for (let i = 0; i < 9; i++) st.push(dv2.getFloat32(o + i * 4, true));
  // 解码: un[i] = st[(i+rot)%9]
  const un = [];
  for (let i = 0; i < 9; i++) un.push(st[(i + rot) % 9]);
  const ax = bones[b].mtxT[0], ay = bones[b].mtxT[1];
  const ok = isFinite(un[0]) && Math.abs(un[0] - ax) < 3 && Math.abs(un[1] - ay) < 3;
  matches.push(ok);
  // 只打印前 6 和后 6 个骨骼
  if (b < 6 || b >= 47) {
    console.log(`  B${String(b).padStart(2)} (rot=${rot}) 首帧 pos=(${un[0].toFixed(1)},${un[1].toFixed(1)}) scale=(${un[6].toFixed(1)},${un[7].toFixed(1)},${un[8].toFixed(1)}) 期望=(${ax.toFixed(1)},${ay.toFixed(1)}) ${ok ? '✓' : '✗'}`);
  }
  cursor += BLOCK2;
}
const okCount = matches.filter(Boolean).length;
console.log('匹配数:', okCount, '/ 53');
const end = DATA2 + cursor * 36 - mdla;
console.log('动画2结束 @', end, 'MDLE相对=', mdle - mdla, '剩余', mdle - mdla - end, '字节');

// 如果全匹配, 检查动画曲线: B1 的 pos.y 在 601 帧内变化
console.log('\n=== B1 (rot=2) 动画曲线 (采样每 20 帧) ===');
const b1o = DATA2 + 1 * BLOCK2 * 36;
for (let f = 0; f < BLOCK2; f += 20) {
  const o = b1o + f * 36;
  const st = [];
  for (let i = 0; i < 9; i++) st.push(dv2.getFloat32(o + i * 4, true));
  const rot = 2;
  const un = [];
  for (let i = 0; i < 9; i++) un.push(st[(i + rot) % 9]);
  console.log(`  f=${f}: pos=(${un[0].toFixed(2)},${un[1].toFixed(2)}) rot=(${un[3].toFixed(4)},${un[4].toFixed(4)},${un[5].toFixed(4)}) scale=(${un[6].toFixed(3)},${un[7].toFixed(3)},${un[8].toFixed(3)})`);
}
