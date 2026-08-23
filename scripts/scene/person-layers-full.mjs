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

// 完整 dump 人物对象 (id=53) 的 animationlayers 上下文
const lines = scene.split('\n');
console.log('=== 人物对象 animationlayers (L588-625) ===');
for (let i = 588; i < 626; i++) console.log('L' + (i + 1) + ': ' + lines[i].trim());

// 后发 MDL 是否有多个动画块
const bh = read('models/发_puppet.mdl');
const loops = [];
let idx = 0;
while ((idx = bh.indexOf(Buffer.from('loop'), idx)) !== -1) { loops.push(idx); idx += 4; }
console.log('\n发_puppet.mdl loop 位置:', loops.map(l => l - 4057).join(', '), '(相对 MDLA)');

// 人物 MDL 的 "动画 1" 和 "动画 2" 是否可能是 呼吸/眼
// 检查 scene.json 的 animation ID 与 MDL 动画的关联: 也许 animation 字段是 MDL 内偏移?
console.log('\n=== scene.json animation 引用 ===');
const animRefs = [...scene.matchAll(/"animation"\s*:\s*(\d+)/g)].map(m => m[1]);
console.log('animation IDs:', animRefs.join(', '));
