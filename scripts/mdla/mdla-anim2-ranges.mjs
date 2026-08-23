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
const DATA2 = mdla + 254324;
const BLOCK = 601;
function decodeFrame(b, f) {
  const rot = (2 * b) % 9;
  const o = DATA2 + (b * BLOCK + f) * 36;
  const un = [];
  for (let i = 0; i < 9; i++) un.push(dv2.getFloat32(o + ((i + rot) % 9) * 4, true));
  return un;
}

// 对每个骨骼, 找出动画 2 块内"有效动画帧"范围: 从 f=1 起, 每帧检查是否与上一帧相同
// 找到最后一个"变化"的帧
console.log('=== 动画 2: 每骨骼有效动画段 (f=1 起最后一个变化帧) ===');
for (let b = 0; b < 53; b++) {
  let lastChange = -1;
  let prev = null;
  let staticFrames = 0;
  for (let f = 1; f < BLOCK; f++) {
    const un = decodeFrame(b, f);
    if (!isFinite(un[0])) break;
    if (prev) {
      const d = Math.abs(un[0] - prev[0]) + Math.abs(un[1] - prev[1]) + Math.abs(un[3] - prev[3]) + Math.abs(un[4] - prev[4]) + Math.abs(un[5] - prev[5]);
      if (d > 1e-6) lastChange = f;
      else staticFrames++;
    }
    prev = un;
  }
  console.log(`  B${String(b).padStart(2)}: 最后变化帧 f=${lastChange} 静止帧=${staticFrames}`);
}

// B52 动画 2 曲线
console.log('\n=== 动画2 B52 曲线 (每 5 帧, f=0..150) ===');
for (let f = 0; f < 151; f += 5) {
  const un = decodeFrame(52, f);
  console.log(`  f=${String(f).padStart(3)}: pos=(${un[0].toFixed(1)},${un[1].toFixed(1)}) rot=(${un[3].toFixed(3)},${un[4].toFixed(3)},${un[5].toFixed(3)})`);
}
