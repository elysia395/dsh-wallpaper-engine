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
const mdls = 64571;

// MDLS 头: "MDLS0004"(8) + u32 + u32，然后骨骼条目
// 但之前解析 @11/@15 不对。打印 @8-40 的每个字节
console.log('MDLS @8-48 字节:');
for (let off = 8; off < 48; off += 1) {
  const b = buf[mdls + off];
  console.log('  @' + off + ': 0x' + b.toString(16).padStart(2, '0') + ' ' + (b >= 32 && b < 127 ? String.fromCharCode(b) : '.'));
}

// 从 010 模板: MDLSHEADER = CHAR header[] + DWORD mightBeByteLength + DWORD numberOfBones + BONEENTRY[]
// header 可能到第一个 \0
let hEnd = 8;
while (hEnd < buf.length && buf[mdls + hEnd] !== 0) hEnd++;
console.log('\nheader @8-' + hEnd + ': "' + buf.toString('ascii', mdls + 8, mdls + hEnd) + '"');
let p = mdls + hEnd + 1; // 跳过 \0
console.log('mightBeByteLength @' + (p - mdls) + ':', dv2.getUint32(p, true));
p += 4;
console.log('numberOfBones @' + (p - mdls) + ':', dv2.getUint32(p, true));
const numBones = dv2.getUint32(p, true);
p += 4;
console.log('骨骼条目区 @' + (p - mdls));

// 解析骨骼条目
console.log('\n=== 骨骼条目（BONEENTRY = BYTE+DWORD+DWORD + DWORD entryLen + float[] + CHAR info[]）===');
for (let b = 0; b < Math.min(numBones, 10) && p < mdls + 15271; b++) {
  const tmp = buf[p];
  const type = dv2.getUint32(p + 1, true);
  const unk1 = dv2.getUint32(p + 5, true);
  const entryLen = dv2.getUint32(p + 9, true);
  if (entryLen <= 0 || entryLen > 5000) { console.log('B' + b + ' 异常 entryLen=' + entryLen + ' @' + (p - mdls) + ', 停止'); break; }
  const floatCount = Math.floor(entryLen / 4);
  const floats = [];
  for (let i = 0; i < Math.min(floatCount, 20); i++) floats.push(dv2.getFloat32(p + 13 + i * 4, true));
  const infoStart = p + 13 + entryLen;
  let infoStr = '';
  let ip2 = infoStart;
  while (ip2 < buf.length && buf[ip2] >= 32 && buf[ip2] < 127) { infoStr += String.fromCharCode(buf[ip2]); ip2++; }
  console.log('B' + b + ' @' + (p - mdls) + ': tmp=' + tmp + ' type=' + type + ' unk1=' + unk1 + ' entryLen=' + entryLen);
  console.log('   floats[' + floats.map(f => f.toFixed(2)).join(', ') + ']');
  console.log('   info: "' + infoStr + '"');
  p = infoStart + infoStr.length + 1;
}
