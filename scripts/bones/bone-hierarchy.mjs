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

// 解析骨骼: 矩阵平移(floats[12],floats[13]) + tp + 父(unk1)
let p = mdls + 17;
const bones = {};
for (let b = 0; b < 53 && p < mdla; b++) {
  const tmp = buf[p];
  const type = dv2.getUint32(p + 1, true);
  const parent = dv2.getUint32(p + 5, true);
  const entryLen = dv2.getUint32(p + 9, true);
  if (entryLen <= 0 || entryLen > 10000) { p += 9; continue; }
  const floats = [];
  for (let i = 0; i < Math.floor(entryLen / 4); i++) floats.push(dv2.getFloat32(p + 13 + i * 4, true));
  const infoStart = p + 13 + entryLen;
  let infoStr = '';
  let ip2 = infoStart;
  while (ip2 < buf.length && buf[ip2] >= 32 && buf[ip2] < 127) { infoStr += String.fromCharCode(buf[ip2]); ip2++; }
  let tp = null;
  const m = infoStr.match(/"tp"\s*:\s*"([^"]+)"/);
  if (m) tp = m[1].trim().split(/\s+/).map(Number);
  bones[b] = { parent, mat: floats, tp, info: infoStr.slice(0, 50) };
  p = infoStart + infoStr.length + 1;
}

// 计算骨骼世界位置: 递归累加父链 tp
function boneWorld(b) {
  const bone = bones[b];
  if (!bone) return [0, 0];
  if (bone._w) return bone._w;
  const parentWorld = bone.parent < 53 && bone.parent !== b && bone.parent !== 4294967295 ? boneWorld(bone.parent) : [0, 0];
  const tp = bone.tp || [0, 0];
  bone._w = [parentWorld[0] + tp[0], parentWorld[1] + tp[1]];
  return bone._w;
}
console.log('骨骼世界位置（父链累加 tp）:');
for (let b = 0; b < 53; b++) {
  if (!bones[b]) continue;
  const w = boneWorld(b);
  const matX = bones[b].mat[12], matY = bones[b].mat[13];
  console.log('B' + String(b).padStart(2) + ': parent=' + (bones[b].parent === 4294967295 ? 'root' : bones[b].parent) +
    ' world(' + w[0].toFixed(1) + ',' + w[1].toFixed(1) + ') matTrans(' + matX.toFixed(1) + ',' + matY.toFixed(1) + ') tp(' + (bones[b].tp ? bones[b].tp.map(v => v.toFixed(1)).join(',') : '-') + ')');
}
