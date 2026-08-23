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
const mdla = 79842, mdle = 1481325, mdls = 64571;

// MDLS 骨骼: index, parent, anchor
let p = mdls + 17;
const bones = [];
for (let b = 0; b < 53 && p < mdla; b++) {
  const type = dv2.getUint32(p + 1, true);
  const parent = dv2.getUint32(p + 5, true);
  const entryLen = dv2.getUint32(p + 9, true);
  if (entryLen <= 0 || entryLen > 10000) { p += 9; bones.push({ b, error: true }); continue; }
  const floats = [];
  for (let i = 0; i < Math.floor(entryLen / 4); i++) floats.push(dv2.getFloat32(p + 13 + i * 4, true));
  const infoStart = p + 13 + entryLen;
  let infoStr = '';
  let ip2 = infoStart;
  while (ip2 < buf.length && buf[ip2] >= 32 && buf[ip2] < 127) { infoStr += String.fromCharCode(buf[ip2]); ip2++; }
  let tp = null;
  try {
    const m = infoStr.match(/"tp"\s*:\s*"([^"]+)"/);
    if (m) tp = m[1].trim().split(/\s+/).map(Number);
  } catch (e) {}
  bones.push({ b, type, parent: parent === 0xffffffff ? -1 : parent, mtxT: [floats[12] ?? NaN, floats[13] ?? NaN], tp });
  p = infoStart + infoStr.length + 1;
}

// 动画数据提取
// 动画1: DATA1 @63, 53块×133帧; 动画2: DATA2 @254324, 53块×601帧
const DATA1 = mdla + 63;
const DATA2 = mdla + 254324;

function extractAnim(base, blockLen, totalFrames) {
  // 返回: perBone[53] = { frames: [{pos:[3], rot:[3], scale:[3]}, ...] }
  const anim = [];
  for (let b = 0; b < 53; b++) {
    const rot = (2 * b) % 9;
    const frames = [];
    for (let f = 0; f < blockLen; f++) {
      const o = base + (b * blockLen + f) * 36;
      const un = [0,0,0,0,0,0,0,0,0];
      for (let i = 0; i < 9; i++) {
        const v = dv2.getFloat32(o + ((i + rot) % 9) * 4, true);
        un[i] = isFinite(v) ? v : 0;
      }
      frames.push({ pos: un.slice(0,3), rot: un.slice(3,6), scale: un.slice(6,9) });
    }
    anim.push({ b, parent: bones[b].parent, anchor: bones[b].mtxT, frames });
  }
  return anim;
}

console.log('提取动画1 (133帧)...');
const anim1 = extractAnim(DATA1, 133, 133);
console.log('提取动画2 (601帧)...');
const anim2 = extractAnim(DATA2, 601, 601);

// 统计每块 f=0 特殊帧情况
const specialCount = anim2.filter(a => {
  const f0 = a.frames[0];
  return Math.abs(f0.scale[0]) < 0.5 || Math.abs(f0.scale[1]) < 0.5 || Math.abs(f0.scale[2]) < 0.5;
}).length;
console.log('动画2 中 f=0 特殊帧骨骼数:', specialCount, '/ 53');

// 写 JSON (只保留 pos/rot/scale, 压缩)
const out = {
  bones: bones.map((bn, i) => ({ b: i, parent: bn.parent, anchor: bn.mtxT, tp: bn.tp })),
  anim1: { frames: 133, perBone: anim1.map(a => ({ frames: a.frames })) },
  anim2: { frames: 601, perBone: anim2.map(a => ({ frames: a.frames })) },
};
fs.writeFileSync('D:/dsh-wallpaper-engine/scene-layers-out/mdla-anim-data.json', JSON.stringify(out));
console.log('已写入 scene-layers-out/mdla-anim-data.json, 大小:', fs.statSync('D:/dsh-wallpaper-engine/scene-layers-out/mdla-anim-data.json').size, 'B');
