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
const mdls = 64571, mdla = 79842;

// 解析 53 骨骼，提取 tp（平移）
let p = mdls + 17;
const bones = [];
for (let b = 0; b < 53 && p < mdla; b++) {
  const tmp = buf[p];
  const type = dv2.getUint32(p + 1, true);
  const unk1 = dv2.getUint32(p + 5, true);
  const entryLen = dv2.getUint32(p + 9, true);
  if (entryLen <= 0 || entryLen > 10000) { p += 9; bones.push({ b, error: true }); continue; }
  const floatCount = Math.floor(entryLen / 4);
  const floats = [];
  for (let i = 0; i < floatCount; i++) floats.push(dv2.getFloat32(p + 13 + i * 4, true));
  const infoStart = p + 13 + entryLen;
  let infoStr = '';
  let ip2 = infoStart;
  while (ip2 < buf.length && buf[ip2] >= 32 && buf[ip2] < 127) { infoStr += String.fromCharCode(buf[ip2]); ip2++; }
  // 解析 info JSON 的 tp
  let tp = null;
  try {
    const m = infoStr.match(/"tp"\s*:\s*"([^"]+)"/);
    if (m) tp = m[1].trim().split(/\s+/).map(Number);
  } catch (e) {}
  bones.push({ b, tmp, type, unk1, entryLen, floats, tp, info: infoStr.slice(0, 60) });
  p = infoStart + infoStr.length + 1;
}
console.log('=== 53 骨骼绑定数据 ===');
for (const bm of bones) {
  if (bm.error) { console.log('B' + bm.b + ': 解析错误'); continue; }
  // 矩阵: 16 floats (4x4, 列主序?)
  const m = bm.floats;
  const mat = `[${m.slice(0, 4).map(f => f.toFixed(2)).join(',')} | ${m.slice(4, 8).map(f => f.toFixed(2)).join(',')} | ${m.slice(8, 12).map(f => f.toFixed(2)).join(',')} | ${m.slice(12, 16).map(f => f.toFixed(2)).join(',')}]`;
  console.log('B' + String(bm.b).padStart(2) + ': type=' + bm.type + ' unk1=' + bm.unk1 + ' mat=' + mat + ' tp=' + (bm.tp ? bm.tp.map(v => v.toFixed(1)).join(',') : 'null'));
}
// 保存
import fs2 from 'fs';
fs2.writeFileSync('D:/dsh-wallpaper-engine/scripts/mdls-bones-full.json', JSON.stringify(bones.map(b => ({ ...b, floats: b.floats })), null, 1));
