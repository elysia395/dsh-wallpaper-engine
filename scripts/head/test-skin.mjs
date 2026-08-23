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
let mdlsOffset = buf.length;
for (let off = 9; off + 4 < buf.length; off++) {
  if (buf[off] === 0x4d && buf[off+1] === 0x44 && buf[off+2] === 0x4c && buf[off+3] === 0x53) { mdlsOffset = off; break; }
}
let found = null;
for (let offset = 9; offset + 12 < mdlsOffset; offset++) {
  const vertexBytes = dv2.getUint32(offset + 4, true);
  const verticesOffset = offset + 8;
  if (vertexBytes === 0 || vertexBytes % 80 !== 0) continue;
  const indexLenOffset = verticesOffset + vertexBytes;
  if (indexLenOffset + 4 > mdlsOffset) continue;
  const indexBytes = dv2.getUint32(indexLenOffset, true);
  const indicesOffset = indexLenOffset + 4;
  if (indexBytes === 0 || indexBytes % 2 !== 0 || indicesOffset + indexBytes > mdlsOffset) continue;
  found = { verticesOffset, vertexBytes, indicesOffset, indexBytes };
  break;
}

// 读取动画 JSON
const animData = JSON.parse(fs.readFileSync('D:/dsh-wallpaper-engine/scene-layers-out/mdla-anim-data.json', 'utf8'));

// 手动蒙皮 B22 相关顶点
// 原始锚点 (MDLS): B22 anchor=(-278.5,-18.4), B23 anchor=(-13.4,8.9) 等
const anchors = {};
for (const bn of animData.bones) anchors[bn.b] = bn.anchor;

// f=65 动画 pos
function getPose(anim, frame) {
  const pose = {};
  for (const pb of anim.perBone) pose[pb.b] = pb.frames[frame];
  return pose;
}
const pose65 = getPose(animData.anim2, 65);
const pose1 = getPose(animData.anim2, 1);

console.log('pose65 keys sample:', Object.keys(pose65).slice(0, 5).join(','));
console.log('pose65[22]:', JSON.stringify(pose65[22]?.pos));
console.log('pose65[23]:', JSON.stringify(pose65[23]?.pos));
console.log('anchors[22]:', anchors[22]);
console.log('anchors[23]:', anchors[23]);

console.log('=== B22 顶点蒙皮对比 (f=1 vs f=65) ===');
const vo = found.verticesOffset;
for (let vi = 253; vi <= 262; vi++) {
  const o = vo + vi * 80;
  const x = dv2.getFloat32(o, true), y = dv2.getFloat32(o + 4, true);
  const b0 = dv2.getUint32(o + 40, true), b1 = dv2.getUint32(o + 44, true);
  const w0 = dv2.getFloat32(o + 56, true), w1 = dv2.getFloat32(o + 60, true);
  // 蒙皮
  function skin(pose) {
    let dx = 0, dy = 0;
    if (w0 > 0 && pose[b0]) {
      const oa = anchors[b0], na = pose[b0].pos;
      dx += w0 * (na[0] - oa[0]); dy += w0 * (na[1] - oa[1]);
    }
    if (w1 > 0 && pose[b1]) {
      const oa = anchors[b1], na = pose[b1].pos;
      dx += w1 * (na[0] - oa[0]); dy += w1 * (na[1] - oa[1]);
    }
    return [x + dx, y + dy];
  }
  const p1 = skin(pose1), p65 = skin(pose65);
  console.log(`  v${vi}: 原始(${x.toFixed(1)},${y.toFixed(1)}) b=(${b0}w${w0.toFixed(2)},${b1}w${w1.toFixed(2)}) f1=(${p1[0].toFixed(1)},${p1[1].toFixed(1)}) f65=(${p65[0].toFixed(1)},${p65[1].toFixed(1)})`);
}
