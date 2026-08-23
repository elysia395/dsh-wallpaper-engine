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

// 水对象完整 effects 列表: 从 "id" : 16 前找所有 effect 块
const lines = scene.split('\n');
let inWater = false;
const effects = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('"image" : "models/水.json"')) {
    // 从对象开头 (上一个 "}," 或 "[") 到 "id" : 16
    let j = i - 1;
    while (j > 0 && !lines[j].includes('"effects"')) j--;
    // 提取 effects 数组
    const effectBlocks = [];
    for (let k = j; k < i; k++) {
      const m = lines[k].match(/"file"\s*:\s*"([^"]+)"/);
      if (m) effectBlocks.push(m[1]);
      const p = lines[k].match(/"id"\s*:\s*(\d+)/);
    }
    console.log('水对象 effects 文件:', effectBlocks.join(', '));
    // 打印每个 effect 的常量
    for (let k = j; k < i; k++) {
      const t = lines[k].trim();
      if (t.includes('"file"') || t.includes('"id"') || t.includes('"speed"') || t.includes('"strength"') || t.includes('"scale"') || t.includes('"direction"') || t.includes('"exponent"') || t.includes('"bounds"') || t.includes('"friction"')) {
        console.log(`  L${k + 1}: ${t}`);
      }
    }
    break;
  }
}

// waterwaves 材质 (shader 语义)
console.log('\n=== materials/effects/waterwaves.json ===');
const ww = read('materials/effects/waterwaves.json');
console.log(ww ? ww.toString('utf8') : 'null');

// waterwaves shader 是否有 .frag? 检查 pkg 内 shader
console.log('\n=== shader 文件检查 ===');
const frag = read('shaders/effects/waterwaves.frag');
console.log('waterwaves.frag:', frag ? frag.toString('utf8').slice(0, 1500) : '不在 pkg 内');
