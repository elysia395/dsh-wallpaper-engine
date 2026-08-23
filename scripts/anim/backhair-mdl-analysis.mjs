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
// 后发 MDL 完整分析
const buf = read('models/发_puppet.mdl');
const dv2 = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
console.log('发_puppet.mdl 大小:', buf.length);

// MDLA 头
const mdla = buf.indexOf(Buffer.from('MDLA0006'));
const mdle = buf.indexOf(Buffer.from('MDLE'));
console.log('MDLA@', mdla, 'MDLE@', mdle, '块大小', mdle - mdla);

// 数据起点: 找 "loop" 后
const loopIdx = buf.indexOf(Buffer.from('loop'), mdla);
console.log('loop@', loopIdx - mdla);
// 头部 hex 前 80
console.log('头部:', Buffer.from(buf.slice(mdla, mdla + 80)).toString('hex').match(/.{2}/g).join(' '));

// 骨骼数
const bonesCount = dv2.getUint32(mdla + 47 + 3, true) || 0;
console.log('骨骼数候选:', bonesCount);

// 找数据起点: (mdle - X) % 36 == 0
const total = mdle - mdla;
for (let s = 30; s < 100; s++) {
  const n = total - s;
  if (n % 36 === 0 && n / 36 > 10) {
    console.log(`候选起点@${s}: ${n / 36} 条`);
  }
}
