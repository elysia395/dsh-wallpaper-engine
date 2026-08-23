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
const scene = read('scene.json').toString('utf8');

// 找 scene.json 中所有 "animation" 字段值 (非 animationlayers 内)
const re = /"animation"\s*:\s*(\d+)/g;
const animRefs = new Map();
let m;
while ((m = re.exec(scene)) !== null) {
  const id = parseInt(m[1]);
  animRefs.set(id, (animRefs.get(id) || 0) + 1);
}
console.log('scene.json animation 引用 ID 及次数:', [...animRefs.entries()].join(', '));

// 找每个 animationlayers 完整段落 + 所属对象的 image + id
const layerRe = /"animationlayers"\s*:\s*\[(.*?)\]\s*,\s*"castshadow"/gs;
let lm;
console.log('\n=== 每个 animationlayers 段 ===');
while ((lm = layerRe.exec(scene)) !== null) {
  const block = lm[1];
  const animM = [...block.matchAll(/"animation"\s*:\s*(\d+)/g)];
  const nameM = [...block.matchAll(/"name"\s*:\s*"([^"]+)"/g)];
  const additiveM = [...block.matchAll(/"additive"\s*:\s*(true|false)/g)];
  const rateM = [...block.matchAll(/"rate"\s*:\s*([\d.]+)/g)];
  // 向后找对象 image/id
  const after = scene.slice(lm.index + lm[0].length, lm.index + lm[0].length + 400);
  const imgM = after.match(/"image"\s*:\s*"([^"]+)"/);
  const idM = after.match(/"id"\s*:\s*(\d+)/);
  const objName = after.match(/"name"\s*:\s*"([^"]+)"/);
  console.log(`  对象 image=${imgM ? imgM[1] : '?'} id=${idM ? idM[1] : '?'} name=${objName ? objName[1] : '?'}`);
  for (let i = 0; i < animM.length; i++) {
    console.log(`    动画 id=${animM[i][1]} name="${nameM[i][1]}" additive=${additiveM[i][1]} rate=${rateM[i][1]}`);
  }
}
