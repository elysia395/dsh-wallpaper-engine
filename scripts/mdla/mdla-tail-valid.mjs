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

function decodeWithRot(rot, k) {
  const o = DATA0 + k * 36;
  const un = [];
  for (let i = 0; i < 9; i++) un.push(dv2.getFloat32(o + ((i + rot) % 9) * 4, true));
  return un;
}
// 有效动画帧: scale≈1, rot 小, pos 有限合理
function isAnimFrame(un) {
  return isFinite(un[0]) && isFinite(un[1]) && isFinite(un[2])
    && Math.abs(un[0]) < 5000 && Math.abs(un[1]) < 5000 && Math.abs(un[2]) < 5000
    && Math.abs(un[6] - 1) < 0.1 && Math.abs(un[7] - 1) < 0.1 && Math.abs(un[8] - 1) < 0.1
    && Math.abs(un[3]) < 3.2 && Math.abs(un[4]) < 3.2 && Math.abs(un[5]) < 3.2;
}

// 扫描 tail 全区域, 找每个 entry 的"有效 rot 集"
console.log('=== tail 有效帧扫描 (每 20 条) ===');
for (let k = 7049; k < ENTRIES; k += 20) {
  const rots = [];
  let best = null;
  for (let r = 0; r < 9; r++) {
    const un = decodeWithRot(r, k);
    if (isAnimFrame(un)) { rots.push(r); if (!best) best = un; }
  }
  const raw = [];
  const o = DATA0 + k * 36;
  for (let i = 0; i < 9; i++) raw.push(dv2.getFloat32(o + i * 4, true));
  if (rots.length) {
    console.log(`k=${k}: rot{${rots.join(',')}} pos=(${best[0].toFixed(1)},${best[1].toFixed(1)}) rotdeg=(${best[3].toFixed(2)},${best[4].toFixed(2)},${best[5].toFixed(2)})`);
  } else {
    console.log(`k=${k}: 无有效帧 raw=[${raw.slice(0, 3).map(f => isFinite(f) ? f.toFixed(1) : 'N').join(',')},...]`);
  }
}
