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
// 搜索 "呼吸" 和 "眼" 的 UTF-8 字节
const targets = {
  '呼吸': Buffer.from('呼吸', 'utf8'),
  '眼': Buffer.from('眼', 'utf8'),
  '动画': Buffer.from('动画', 'utf8'),
};
for (const mdl of ['models/人物_puppet.mdl', 'models/发_puppet.mdl']) {
  const buf = read(mdl);
  console.log(`\n=== ${mdl} ===`);
  for (const [name, bytes] of Object.entries(targets)) {
    const positions = [];
    let idx = 0;
    while ((idx = buf.indexOf(bytes, idx)) !== -1) {
      positions.push(idx);
      idx += bytes.length;
    }
    console.log(`  "${name}" (${bytes.length}B): ${positions.length} 处: ${positions.slice(0, 10).join(', ')}`);
  }
}

// 检查 人物_puppet.mdl 中所有 "loop" 位置 (可能有多个动画)
const buf1 = read('models/人物_puppet.mdl');
const loops = [];
let idx = 0;
while ((idx = buf1.indexOf(Buffer.from('loop'), idx)) !== -1) { loops.push(idx); idx += 4; }
console.log('\n人物_puppet.mdl "loop" 位置:', loops.join(', '));

// 检查 loop 附近上下文 (是否有动画名)
for (const lp of loops) {
  const start = Math.max(0, lp - 40);
  const seg = buf1.toString('utf8', start, lp + 10).replace(/[^\x20-\x7e\u4e00-\u9fff]/g, '.');
  console.log(`  loop@${lp}: ...${seg}...`);
}
