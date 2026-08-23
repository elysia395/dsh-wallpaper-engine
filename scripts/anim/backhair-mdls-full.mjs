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
const buf = read('models/发_puppet.mdl');
const dv2 = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
// MDLS 头解析: 骨骼数
const mdls = buf.indexOf(Buffer.from('MDLS'));
console.log('MDLS@', mdls);
console.log('MDLS 头 40B:', Buffer.from(buf.slice(mdls, mdls + 40)).toString('hex').match(/.{2}/g).join(' '));
// numberOfBones 在 @13
console.log('骨骼数 @13:', dv2.getUint32(mdls + 13, true));

// 完整解析所有骨骼
const mdlaOffset = buf.indexOf(Buffer.from('MDLA0006'));
let p = mdls + 17;
const bones = [];
for (let b = 0; b < 30 && p < mdlaOffset; b++) {
  const entryLen = dv2.getUint32(p + 9, true);
  if (entryLen <= 0 || entryLen > 10000) { console.log(`B${b}: 解析失败 @${p - mdls}`); p += 9; continue; }
  const floats = [];
  for (let i = 0; i < Math.floor(entryLen / 4); i++) floats.push(dv2.getFloat32(p + 13 + i * 4, true));
  const infoStart = p + 13 + entryLen;
  let infoLen = 0;
  while (infoStart + infoLen < buf.length && buf[infoStart + infoLen] >= 32 && buf[infoStart + infoLen] < 127) infoLen++;
  const parent = dv2.getUint32(p + 5, true);
  const tp = floats.length > 12 ? `(${floats[12]?.toFixed(1)},${floats[13]?.toFixed(1)})` : '?';
  console.log(`B${b}: parent=${parent} mtxT=${tp}`);
  bones.push({ b, parent });
  p = infoStart + infoLen + 1;
}
console.log('解析骨骼数:', bones.length);
