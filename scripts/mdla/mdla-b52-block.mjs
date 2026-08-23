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

// 打印 tail 区逐字节 hex: 从 entry 7049 对应偏移开始, 前 1000 字节
const off = DATA0 + 7049 * 36;
console.log('tail 起点 @', off - mdla, '(相对 mdla)');
for (let row = 0; row < 40; row++) {
  const base = off + row * 16;
  let hex = '', asc = '';
  for (let i = 0; i < 16; i++) {
    const b = buf[base + i];
    hex += b.toString(16).padStart(2, '0') + ' ';
    asc += (b >= 32 && b < 127) ? String.fromCharCode(b) : '.';
  }
  console.log(`  @${base - mdla}: ${hex} |${asc}|`);
}

// 检查 head 区最后一个骨骼块的精确边界: B52 head 块从哪到哪
// 前面 mdla-structure 发现 B52 start=6927 len=22, cursor=6949
// 用 rot=5 解码 B52 块: 从 6927 开始打印 50 条
console.log('\n=== B52 head 块 (entry 6927 起, rot=5 解码) ===');
for (let k = 6927; k < 6927 + 50; k++) {
  const o = DATA0 + k * 36;
  const st = [];
  for (let i = 0; i < 9; i++) st.push(dv2.getFloat32(o + i * 4, true));
  const rot = 5;
  const un = [];
  for (let i = 0; i < 9; i++) un.push(st[(i + rot) % 9]);
  console.log(`  k=${k}: st=[${st.map(f => isFinite(f) ? f.toFixed(1) : 'N').join(',')}] un=(${un[0].toFixed(1)},${un[1].toFixed(1)},${un[2].toFixed(1)})`);
}
