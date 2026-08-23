import fs from 'fs';
const base = 'c:/program files (x86)/steam/steamapps/workshop/content/431960/';
function openPkg(pkgPath) {
  const data = fs.readFileSync(pkgPath);
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

// 眉毛: 2 骨骼, 423 条目
const pkg2 = openPkg(base + '3486806915/scene.pkg');
const buf = pkg2.read('models/眉毛_puppet.mdl');
const dv2 = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const mdla = 2348, mdle = 17654;
const DATA0 = mdla + 63;
const ENTRIES = Math.floor((mdle - DATA0) / 36);
console.log('眉毛: 条目', ENTRIES);

function decodeWithRot(rot, k) {
  const o = DATA0 + k * 36;
  const un = [];
  for (let i = 0; i < 9; i++) un.push(dv2.getFloat32(o + ((i + rot) % 9) * 4, true));
  return un;
}

// 眉毛只有 2 骨骼 (rot 0 和 rot 2)。打印所有条目, 用 rot 0 和 rot 2 解码
console.log('=== 眉毛全部条目 (k, 存储, rot0解码, rot2解码) ===');
for (let k = 0; k < ENTRIES; k++) {
  const o = DATA0 + k * 36;
  const st = [];
  for (let i = 0; i < 9; i++) st.push(dv2.getFloat32(o + i * 4, true));
  const r0 = decodeWithRot(0, k), r2 = decodeWithRot(2, k);
  console.log(`k=${k}: st[${st.map(f => f.toFixed(1)).join(',')}] r0=(${r0[0].toFixed(1)},${r0[1].toFixed(1)}) r2=(${r2[0].toFixed(1)},${r2[1].toFixed(1)})`);
}
