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
// 呼吸 = e5 91 bc e5 90 b8
const hx = (s) => Buffer.from(s, 'utf8');
console.log('呼吸 bytes:', hx('呼吸').toString('hex'));
console.log('眼 bytes:', hx('眼').toString('hex'));
console.log('动画 bytes:', hx('动画').toString('hex'));
for (const [name, bytes] of [['呼吸', hx('呼吸')], ['眼', hx('眼')], ['眨眼', hx('眨眼')], ['动画', hx('动画')]]) {
  const pos = [];
  let i = 0;
  while ((i = buf.indexOf(bytes, i)) !== -1) { pos.push(i); i += 1; }
  console.log(`${name}: ${pos.length} 处 ${pos.slice(0, 20).join(',')}`);
}

// 眼 单字出现太多, 找 "眼" 后跟的字符构成完整词
console.log('\n=== "眼" 字上下文 ===');
let idx = 0;
const seen = new Set();
while ((idx = buf.indexOf(hx('眼'), idx)) !== -1) {
  // 前后扩展 20 字节
  const start = Math.max(0, idx - 12);
  const end = Math.min(buf.length, idx + 15);
  const s = buf.toString('utf8', start, end).replace(/[^\x20-\x7e\u4e00-\u9fff]/g, '');
  if (s.includes('眼') && s.length < 30) seen.add(s);
  idx += 3;
}
console.log([...seen].join(' | '));
