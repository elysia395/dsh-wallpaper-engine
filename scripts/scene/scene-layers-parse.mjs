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

// 解析每个 object 的 animationlayers
// 简化: 找所有 "animationlayers" 块, 提取其前后的 image/name/animation/name/additive/rate/blend
const objRe = /\{\s*"angles"[^}]*?"animationlayers"\s*:\s*\[(.*?)\]\s*,?\s*(?:"castshadow"|"effects"|"id"\s*:\s*\d+)/gs;
let m;
const layers = [];
while ((m = objRe.exec(scene)) !== null) {
  const block = m[0];
  const nameM = block.match(/"name"\s*:\s*"([^"]+)"/);
  const imageM = block.match(/"image"\s*:\s*"([^"]+)"/);
  const layersArr = m[1];
  const items = [...layersArr.matchAll(/\{\s*"additive"\s*:\s*(true|false),\s*"animation"\s*:\s*(\d+),\s*"blend"\s*:\s*([\d.]+),\s*"blendin"\s*:\s*(true|false),\s*"blendout"\s*:\s*(true|false),\s*"blendtime"\s*:\s*([\d.]+),\s*"id"\s*:\s*(\d+),\s*"name"\s*:\s*"([^"]+)",\s*"rate"\s*:\s*([\d.]+)/g)];
  for (const it of items) {
    layers.push({
      object: nameM ? nameM[1] : (imageM ? imageM[1] : '?'),
      animName: it[8],
      animId: it[2],
      additive: it[1] === 'true',
      blend: parseFloat(it[3]),
      rate: parseFloat(it[9]),
    });
  }
}
console.log('=== scene.json animationlayers 引用 ===');
for (const l of layers) {
  console.log(`  ${l.object}: "${l.animName}" id=${l.animId} additive=${l.additive} blend=${l.blend} rate=${l.rate}`);
}

// 检查 MDL 中的动画名: 人物_puppet.mdl 和 发_puppet.mdl
const buf1 = read('models/人物_puppet.mdl');
const txt1 = buf1.toString('latin1');
const animNames1 = [...txt1.matchAll(/[\x20-\x7e\xe5-\xe9][\x20-\x7e\xe5-\xe9]{0,20}/g)].filter(s => /动画|\u547c\u5438|\u773c|loop/.test(s[0])).slice(0, 20);
console.log('\n人物_puppet.mdl 含动画字样:', animNames1.map(a => JSON.stringify(a[0])).join(' '));

// 用 utf8 找所有 "动画 X" 和中文动画名
const names1 = [];
for (let i = 0; i + 4 < buf1.length; i++) {
  if (buf1[i] === 0xe5 && buf1[i + 1] === 0x8a && buf1[i + 2] === 0xa8) { // 动
    let e = i;
    while (e < buf1.length && (buf1[e] >= 0x20 && buf1[e] < 0x7f || buf1[e] >= 0x80)) e++;
    const s = buf1.toString('utf8', i, Math.min(e, i + 40));
    if (/[\u4e00-\u9fff]/.test(s)) names1.push(s.split('\0')[0]);
    i = e;
  }
}
console.log('人物_puppet.mdl 动画名:', [...new Set(names1)].join(' | '));

const buf2 = read('models/发_puppet.mdl');
const names2 = [];
for (let i = 0; i + 4 < buf2.length; i++) {
  if (buf2[i] === 0xe5 && buf2[i + 1] === 0x8a && buf2[i + 2] === 0xa8) {
    let e = i;
    while (e < buf2.length && (buf2[e] >= 0x20 && buf2[e] < 0x7f || buf2[e] >= 0x80)) e++;
    const s = buf2.toString('utf8', i, Math.min(e, i + 40));
    if (/[\u4e00-\u9fff]/.test(s)) names2.push(s.split('\0')[0]);
    i = e;
  }
}
console.log('发_puppet.mdl 动画名:', [...new Set(names2)].join(' | '));
