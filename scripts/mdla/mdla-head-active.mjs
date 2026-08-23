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

// HEAD (动画1): @63 起 53×133 帧; 动画2: @254324 起 53×601 帧
const DATA1 = mdla + 63;
const DATA2 = mdla + 254324;
function decodeFrame(b, f, dataBase, blockLen) {
  const rot = (2 * b) % 9;
  const o = dataBase + (b * blockLen + f) * 36;
  const un = [];
  for (let i = 0; i < 9; i++) un.push(dv2.getFloat32(o + ((i + rot) % 9) * 4, true));
  return un;
}

// HEAD 每骨骼: f=1..132 是否有 >0.05 变化 (排除 f=0 特殊帧)
console.log('=== HEAD (动画1, 133帧) 真实活跃骨骼 ===');
const headActive = [];
for (let b = 0; b < 53; b++) {
  let maxD = 0;
  let prev = decodeFrame(b, 1, DATA1, 133);
  for (let f = 2; f < 133; f++) {
    const un = decodeFrame(b, f, DATA1, 133);
    const d = Math.abs(un[0]-prev[0]) + Math.abs(un[1]-prev[1]) + Math.abs(un[3]-prev[3]) + Math.abs(un[4]-prev[4]) + Math.abs(un[5]-prev[5]);
    if (d > maxD) maxD = d;
    prev = un;
  }
  if (maxD > 0.05) headActive.push(b);
}
console.log('HEAD 活跃骨骼:', headActive.join(','), '(', headActive.length, ')');

// HEAD B4 完整动画 (每 5 帧)
console.log('\n=== HEAD B4 曲线 (每 5 帧) ===');
for (let f = 0; f < 133; f += 5) {
  const un = decodeFrame(4, f, DATA1, 133);
  console.log(`  f=${String(f).padStart(3)}: pos=(${un[0].toFixed(1)},${un[1].toFixed(1)}) rot=(${un[3].toFixed(3)},${un[4].toFixed(3)},${un[5].toFixed(3)})`);
}

// HEAD B6 曲线 (背景层骨骼?)
console.log('\n=== HEAD B6 曲线 (每 5 帧) ===');
for (let f = 0; f < 133; f += 5) {
  const un = decodeFrame(6, f, DATA1, 133);
  console.log(`  f=${String(f).padStart(3)}: pos=(${un[0].toFixed(1)},${un[1].toFixed(1)}) rot=(${un[3].toFixed(3)},${un[4].toFixed(3)},${un[5].toFixed(3)})`);
}
