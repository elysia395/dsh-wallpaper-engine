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

// 找所有 animationlayers 块的完整内容 + 所属对象
const blocks = [];
const re = /"animationlayers"\s*:\s*\[(.*?)\]\s*,/gs;
let m;
while ((m = re.exec(scene)) !== null) {
  // 找所属对象: 向前找最近的 "name" / "image" / "id"
  const pre = scene.slice(Math.max(0, m.index - 600), m.index);
  const nameM = [...pre.matchAll(/"name"\s*:\s*"([^"]+)"/g)].pop();
  const imageM = [...pre.matchAll(/"image"\s*:\s*"([^"]+)"/g)].pop();
  const idM = [...pre.matchAll(/"id"\s*:\s*(\d+)/g)].pop();
  blocks.push({
    objName: nameM ? nameM[1] : '?',
    objImage: imageM ? imageM[1] : '?',
    objId: idM ? idM[1] : '?',
    layers: m[1].trim(),
  });
}
console.log('=== scene.json 所有 animationlayers ===');
for (const b of blocks) {
  console.log(`\n对象: "${b.objName}" image="${b.objImage}" id=${b.objId}`);
  console.log(b.layers.slice(0, 900));
}

// 人物.json 模型定义 (含 puppet 引用?)
console.log('\n=== models/人物.json ===');
const mj = read('models/人物.json');
console.log(mj ? mj.toString('utf8').slice(0, 800) : 'null');

console.log('\n=== models/发.json ===');
const fj = read('models/发.json');
console.log(fj ? fj.toString('utf8').slice(0, 500) : 'null');
