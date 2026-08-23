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

console.log('=== MDLA 头部原始字节 (相对 mdla, 前 128B) ===');
let hex = '', ascii = '';
for (let i = 0; i < 128; i++) {
  const b = buf[mdla + i];
  hex += b.toString(16).padStart(2, '0') + (i % 16 === 15 ? '\n' : ' ');
  ascii += (b >= 32 && b < 127) ? String.fromCharCode(b) : '.';
  if (i % 16 === 15) { console.log(hex + '  |' + ascii + '|'); hex = ''; ascii = ''; }
}

console.log('\n=== 候选数据起点整除性 (mdle-mdla=', mdle - mdla, ') ===');
for (const start of [41, 57, 61, 63, 67, 74, 75, 78, 79]) {
  const n = mdle - mdla - start;
  if (n % 36 === 0) console.log(`  start=@${start}: ${n} bytes / 36 = ${n / 36} entries  <== 整除`);
  else console.log(`  start=@${start}: ${n} bytes / 36 = ${(n / 36).toFixed(2)} entries`);
}

console.log('\n=== @63 起 36B 条目 (前 20 条, 每条 9 floats) ===');
for (let k = 0; k < 20; k++) {
  const o = mdla + 63 + k * 36;
  const vals = [];
  for (let i = 0; i < 9; i++) vals.push(dv2.getFloat32(o + i * 4, true));
  console.log(`  k=${String(k).padStart(2)} @${o - mdla}: [` + vals.map(f => f.toFixed(2)).join(', ') + ']');
}

console.log('\n=== @74 起 36B 条目 (前 10 条) ===');
for (let k = 0; k < 10; k++) {
  const o = mdla + 74 + k * 36;
  const vals = [];
  for (let i = 0; i < 9; i++) vals.push(dv2.getFloat32(o + i * 4, true));
  console.log(`  k=${k} @${o - mdla}: [` + vals.map(f => f.toFixed(2)).join(', ') + ']');
}

// 找 "loop" 字符串位置
const loopIdx = buf.indexOf(Buffer.from('loop'), mdla);
console.log('\n"loop" @', loopIdx - mdla, '数据疑似起点 @', loopIdx + 4);
const after = loopIdx + 4;
for (let k = 0; k < 10; k++) {
  const o = after + k * 36;
  if (o + 36 > mdle) break;
  const vals = [];
  for (let i = 0; i < 9; i++) vals.push(dv2.getFloat32(o + i * 4, true));
  console.log(`  @${o - mdla}: [` + vals.map(f => f.toFixed(2)).join(', ') + ']');
}
