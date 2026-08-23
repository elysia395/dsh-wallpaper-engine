// 稳健扫描 scene.pkg 中的 MP4 (容错处理各条目)
import fs from 'fs';

const PKG = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3461168300/scene.pkg';
const data = fs.readFileSync(PKG);
const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
let pos = 0;
const rstr = () => { const len = dv.getInt32(pos, true); pos += 4; const s = data.toString('utf8', pos, pos + len); pos += len; return s; };
rstr(); const count = dv.getInt32(pos, true); pos += 4;
const entries = [];
for (let i = 0; i < count; i++) { const p = rstr(); const off = dv.getUint32(pos, true); const len = dv.getUint32(pos + 4, true); pos += 8; entries.push({ p, off, len }); }
const dataStart = pos;
function lz4(src, dstSize) {
  const dst = new Uint8Array(dstSize);
  let ip = 0, op = 0;
  try {
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
  } catch (e) { return null; }
  return dst;
}
const read = (p) => {
  const e = entries.find(x => x.p === p);
  if (!e) return null;
  const abs = dataStart + e.off;
  const seg = data.subarray(abs, abs + e.len);
  const orig = dv.getUint32(abs, true) + dv.getUint32(abs + 4, true) * 4294967296;
  if (orig <= e.len || orig > 2147483647) return seg;
  let r = abs + 8;
  const out = new Uint8Array(orig);
  let written = 0;
  try {
    while (written < orig) {
      const u = dv.getInt32(r, true), c = dv.getInt32(r + 4, true);
      r += 8;
      const dec = lz4(data.subarray(r, r + c), u);
      if (!dec) return null;
      out.set(dec, written);
      r += c; written += u;
    }
  } catch (e) { return null; }
  return out;
};

// 扫描所有条目找 MP4
let mp4Count = 0;
for (const e of entries) {
  const raw = read(e.p);
  if (!raw || raw.length < 12) continue;
  const isMp4 = raw[4] === 0x66 && raw[5] === 0x74 && raw[6] === 0x79 && raw[7] === 0x70;
  if (isMp4) {
    const boxSize = (raw[0] << 24) | (raw[1] << 16) | (raw[2] << 8) | raw[3];
    const brand = raw.toString('latin1', 8, 12);
    mp4Count++;
    console.log('MP4: ' + e.p + ' (' + raw.length + 'B, box=' + boxSize + ', brand=' + brand + ')');
  }
}
console.log('MP4 总数:', mp4Count, '/', entries.length);

// 也扫描: 是否有非 ftyp 开头的视频 (moov/mdat)
let moovCount = 0;
for (const e of entries) {
  const raw = read(e.p);
  if (!raw || raw.length < 12) continue;
  const brand = raw.toString('latin1', 4, 8);
  if (brand === 'moov' || brand === 'mdat' || brand === 'ftyp') {
    if (brand !== 'ftyp') {
      moovCount++;
      console.log('视频容器: ' + e.p + ' (' + raw.length + 'B, ' + brand + ')');
    }
  }
}
console.log('moov/mdat 条目:', moovCount);
