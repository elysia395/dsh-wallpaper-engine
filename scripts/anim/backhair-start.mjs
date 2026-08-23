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
const buf = read('models/发_puppet.mdl');
const dv2 = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const mdla = 4057, mdle = 32923;

// 头部解析: 人物是 @63 数据起点, 后发可能不同
// 打印 loop 后 60 字节 hex
const loopIdx = buf.indexOf(Buffer.from('loop'), mdla);
console.log('loop@', loopIdx - mdla, '(相对 mdla)');
const after = loopIdx + 4;
console.log('loop 后 50 字节:', Buffer.from(buf.slice(after, after + 50)).toString('hex').match(/.{2}/g).join(' '));

// 对比人物头部: 人物 loop@34, 数据@63 → loop 后 29 字节
// 后发 loop@34 → 数据起点 = 34 + 29 = 63? 但 @63 读出的不是 26096...
// 再试: 打印 @63 和 @66 的内容
for (const off of [57, 60, 63, 66, 69, 72]) {
  const o = mdla + off;
  const vals = [];
  for (let i = 0; i < 9; i++) vals.push(dv2.getFloat32(o + i * 4, true));
  console.log(`@${off}: [` + vals.map(f => isFinite(f) ? f.toFixed(1) : 'N').join(', ') + ']');
}

// 尝试: 找到能解码出合理骨骼位置的起点
// 后发 6 骨骼, 数据 = 800 条 = 6×133 + 2
// 可能: 6 块 × 133 = 798 + 2 尾部
// 或者: 块大小不同。用 anchor 匹配: 先解析 MDLS 锚点
const mdls = buf.indexOf(Buffer.from('MDLS'));
console.log('\nMDLS@', mdls);
// 解析 6 骨骼
let p = mdls + 17;
const bones = [];
for (let b = 0; b < 6 && p < mdla; b++) {
  const entryLen = dv2.getUint32(p + 9, true);
  if (entryLen <= 0 || entryLen > 10000) { p += 9; bones.push({ b, error: true }); continue; }
  const floats = [];
  for (let i = 0; i < Math.floor(entryLen / 4); i++) floats.push(dv2.getFloat32(p + 13 + i * 4, true));
  const infoStart = p + 13 + entryLen;
  let infoLen = 0;
  while (infoStart + infoLen < buf.length && buf[infoStart + infoLen] >= 32 && buf[infoStart + infoLen] < 127) infoLen++;
  const parent = dv2.getUint32(p + 5, true);
  bones.push({ b, parent: parent === 0xffffffff ? -1 : parent, anchor: [floats[12] ?? 0, floats[13] ?? 0] });
  p = infoStart + infoLen + 1;
}
console.log('后发骨骼:');
for (const bn of bones) console.log(`  B${bn.b}: parent=${bn.parent} anchor=(${bn.anchor[0].toFixed(1)},${bn.anchor[1].toFixed(1)})`);

// 用 anchor 匹配找数据起点: 扫描所有 36B 对齐位置
console.log('\n扫描 6 骨骼 anchor 匹配 (找数据起点):');
let bestStart = -1, bestScore = 0;
for (let start = 0; start < 200; start++) {
  let score = 0;
  for (let b = 0; b < 6; b++) {
    const rot = (2 * b) % 9;
    const o = mdla + start + (b * 133) * 36;
    if (o + 36 > mdle) continue;
    const un = [];
    for (let i = 0; i < 9; i++) un.push(dv2.getFloat32(o + ((i + rot) % 9) * 4, true));
    const ax = bones[b].anchor[0], ay = bones[b].anchor[1];
    if (isFinite(un[0]) && Math.abs(un[0] - ax) < 50 && Math.abs(un[1] - ay) < 50) score++;
  }
  if (score > bestScore) { bestScore = score; bestStart = start; }
}
console.log('最佳起点 @', bestStart, '得分', bestScore, '/6');
