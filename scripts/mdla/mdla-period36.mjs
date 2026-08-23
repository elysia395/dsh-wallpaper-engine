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

// MDLA 数据从 @42 起。每骨骼条目 36B?
// 周期: [33858][0][13568][0][1225728][3626856960][1159477059][68][0,0,0][2147483648][2147483711,2147483711][3626857023][1159477059][68]...
// 观察: 68 每 36B (42+36=78: @78=68? 42+36=78, 78+36=114...)
// 验证 36B 周期
console.log('验证 36B 周期（@42, @78, @114... 的 u32）:');
for (let k = 0; k < 8; k++) {
  const o = mdla + 42 + k * 36;
  const vals = [];
  for (let i = 0; i < 9; i++) vals.push(dv2.getUint32(o + i * 4, true));
  console.log('  @' + (42 + k * 36) + ': ' + vals.join(', '));
}

// 如果 36B 周期成立, 53 骨骼 × 36B = 1908B 是第一帧?
// 然后 512 帧 × 1908B = 976896B
// 数据区 1401441B ≈ 512 帧 × 2737B? 不对
// 或者 36B 是"每骨骼每帧"
// 分析 @42 起 36B 条目结构
console.log('\n@42 起 36B 条目字节:');
for (let i = 0; i < 9; i++) {
  const o = mdla + 42 + i * 4;
  console.log('  @' + (42 + i * 4) + ': u32=' + dv2.getUint32(o, true) + ' f32=' + dv2.getFloat32(o, true).toFixed(2) + ' hex=' + Buffer.from(buf.slice(o, o + 4)).toString('hex'));
}

// 观察: 68 可能是"条目字节数", 3626856960=0xD8432D72?
// 1159477059 = 0x451C1C43
// 之前看到 float 433.68 = 0x43D82D72, 800.66 = 0x44481C37
// 3626856960 = 0xD8432D72 (反向字节 = 72 2D 43 D8 = float -433.68?)
// 1159477059 = 0x451C1C43
// 这些是"反向字节序的 float"?
console.log('\n反向字节解读 @42 起:');
for (let i = 0; i < 9; i++) {
  const o = mdla + 42 + i * 4;
  const b = Buffer.from(buf.slice(o, o + 4));
  const reversed = Buffer.from([b[3], b[2], b[1], b[0]]);
  const f = reversed.readFloatLE(0);
  console.log('  @' + (42 + i * 4) + ': 反向f32=' + f.toFixed(2));
}
