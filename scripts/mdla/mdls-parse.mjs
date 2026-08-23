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

// MDLS @64571, MDLA @79842
const mdls = 64571;
console.log('=== MDLS 头部 ===');
console.log('MDLS 标记:', buf.toString('ascii', mdls, mdls + 8));
// 模板: MDLSHEADER = header + mightBeByteLength + numberOfBones + bones[]
// header 是变长 CHAR[]（可能 "MDLS0004\0" 或更长）
let p = mdls;
// 读 header 直到非 ASCII
let hEnd = p;
while (hEnd < buf.length && (buf[hEnd] >= 32 || buf[hEnd] === 0)) hEnd++;
console.log('header 字符串:', buf.toString('ascii', p, hEnd), '(到 @' + hEnd + ')');
p = hEnd;
// mightBeByteLength
console.log('mightBeByteLength @' + (p - mdls) + ':', dv2.getUint32(p, true), '=', dv2.getUint32(p, true).toString(16));
p += 4;
console.log('numberOfBones @' + (p - mdls) + ':', dv2.getUint32(p, true));
p += 4;
console.log('骨骼条目起始 @' + (p - mdls));

// BONEENTRY = BONEENTRYHEADER(9B: BYTE + DWORD + DWORD) + entryByteLength + float v[] + info[]
console.log('\n=== 骨骼条目 ===');
for (let b = 0; b < 8; b++) {
  const tmp = buf[p];
  const type = dv2.getUint32(p + 1, true);
  const unk1 = dv2.getUint32(p + 5, true);
  const entryLen = dv2.getUint32(p + 9, true);
  const floatCount = entryLen / 4;
  const floats = [];
  for (let i = 0; i < Math.min(floatCount, 12); i++) floats.push(dv2.getFloat32(p + 13 + i * 4, true));
  console.log('B' + b + ' @' + (p - mdls) + ': tmp=' + tmp + ' type=' + type + ' unk1=' + unk1 + ' entryLen=' + entryLen + ' floats=' + floatCount);
  console.log('   [' + floats.map(f => f.toFixed(2)).join(', ') + ']');
  // info[] 字符串
  const infoStart = p + 13 + entryLen;
  let infoStr = '';
  let ip2 = infoStart;
  while (ip2 < buf.length && buf[ip2] >= 32 && buf[ip2] < 127) { infoStr += String.fromCharCode(buf[ip2]); ip2++; }
  console.log('   info: "' + infoStr + '"');
  // 下一个条目
  p = infoStart + infoStr.length + 1; // +1 跳过 \0
}
