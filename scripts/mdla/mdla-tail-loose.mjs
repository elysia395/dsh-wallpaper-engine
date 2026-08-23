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
// 超宽松: 只要求 pos 两个值有限且 |pos|<5000
function isLoose(un) {
  return isFinite(un[0]) && isFinite(un[1]) && Math.abs(un[0]) < 5000 && Math.abs(un[1]) < 5000;
}

// 整个 tail 区域 (7049..38928) 每 100 条扫描, 列出所有合格 rot
console.log('=== tail 全区域采样 (每 100 条) 合格 rot ===');
for (let k = 7049; k < ENTRIES; k += 100) {
  const cleans = [];
  for (let r = 0; r < 9; r++) {
    if (isLoose(decodeWithRot(r, k))) cleans.push(r);
  }
  const un5 = decodeWithRot(5, k);
  console.log(`  k=${k}: rot{${cleans.join(',')}} pos5=(${un5[0].toFixed(1)},${un5[1].toFixed(1)})`);
}

// 仔细检查 k=7049 附近: 打印 k=7049-7090 的原始存储 + 各 rot 解码
console.log('\n=== k=7049-7068 原始存储 ===');
for (let k = 7049; k < 7069; k++) {
  const o = DATA0 + k * 36;
  const st = [];
  for (let i = 0; i < 9; i++) st.push(dv2.getFloat32(o + i * 4, true));
  console.log(`  k=${k}: [` + st.map(f => isFinite(f) ? f.toFixed(2) : 'INF').join(', ') + ']');
}
