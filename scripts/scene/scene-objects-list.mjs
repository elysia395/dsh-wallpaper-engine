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
// 找 id=53 出现次数
let cnt = 0, last = -1;
let idx = 0;
while ((idx = scene.indexOf('"id" : 53', idx)) !== -1) { cnt++; last = idx; idx += 8; }
console.log('"id" : 53 出现次数:', cnt);
if (last >= 0) {
  console.log('最后出现上下文:');
  console.log(scene.slice(Math.max(0, last - 200), last + 100).replace(/\s+/g, ' '));
}

// 找 animationlayers 段前 1000 字符的开头 (确定属于哪个对象)
const alIdx = scene.indexOf('"animationlayers"');
console.log('\nanimationlayers 首次 @', alIdx);
// 打印从 objects 数组开始到 animationlayers 的对象列表
const objStart = scene.indexOf('"objects"');
console.log('\n=== objects 数组中的对象 (id/name/image) ===');
// 粗略解析顶层对象
const objRe = /\{\s*"(?:angles|castshadow|animationlayers|id|attachment)[^]*?"id"\s*:\s*(\d+),\s*"image"\s*:\s*"([^"]+)",\s*"name"\s*:\s*"([^"]+)"/gs;
let m;
while ((m = objRe.exec(scene)) !== null) {
  console.log(`  id=${m[1]} image=${m[2]} name=${m[3]}`);
}
