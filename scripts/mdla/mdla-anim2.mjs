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
const mdla = 79842, mdle = 1481325;
const mdls = 64571;

// 解析 MDLS bones (mtxT)
let p = mdls + 17;
const bones = [];
for (let b = 0; b < 53 && p < mdla; b++) {
  const type = dv2.getUint32(p + 1, true);
  const entryLen = dv2.getUint32(p + 9, true);
  if (entryLen <= 0 || entryLen > 10000) { p += 9; bones.push({ b, error: true }); continue; }
  const floats = [];
  for (let i = 0; i < Math.floor(entryLen / 4); i++) floats.push(dv2.getFloat32(p + 13 + i * 4, true));
  const infoStart = p + 13 + entryLen;
  let infoStr = '';
  let ip2 = infoStart;
  while (ip2 < buf.length && buf[ip2] >= 32 && buf[ip2] < 127) { infoStr += String.fromCharCode(buf[ip2]); ip2++; }
  bones.push({ b, type, entryLen, mtxT: [floats[12] ?? NaN, floats[13] ?? NaN] });
  p = infoStart + infoStr.length + 1;
}

// 动画 2 数据起点: 找到第二个 "动画" 字符串
const anim2Idx = buf.indexOf(Buffer.from('动画 2', 'utf8'), mdla);
console.log('动画 2 字符串 @', anim2Idx - mdla);
// 动画 2 头: "动画 2\0" + "loop\0" + f32(60?) + u32 + ... 数据起点
// 从 hex 分析: 数据起点 @254324 (相对 mdla)
// 验证: @254324 = 72 2d d8 43 = 432.36 = B0 anchor x
const DATA2 = anim2Idx - mdla + 49; // 动画 2 头在字符串后 49 字节? 精确计算:
// "动画 2" = e5 8a a8 e7 94 bb 20 32 (7B) + \0 = 8B → 字符串后
// "loop\0" = 5B → 后
// 00 00 70 42 (f32 60) = 4B
// 58 02 00 00 (u32 600?) = 4B
// 00 00 00 00 = 4B
// 35 (53) + 00×7 = 8B
// 84 54 (u16 21636) + 00 00 = 4B
// 共 8+5+4+4+4+8+4 = 37? 让我从字节直接验证
// @254286 = '动', 数据起点 = ?
// 扫描: 从 anim2Idx+8 起找 "loop", loop 后 8 字节后找 0x35(53), 再后 8 字节 = 块大小
const loop2 = buf.indexOf(Buffer.from('loop'), anim2Idx);
console.log('动画 2 loop @', loop2 - mdla);
// 打印动画 2 头附近字节 (anim2Idx 起 60 字节)
const hx = Buffer.from(buf.slice(anim2Idx, anim2Idx + 60)).toString('hex');
console.log('动画2头:', hx.match(/.{2}/g).join(' '));

// 数据起点: 从 loop2 找
// 头结构(动画1): "动画 1\0" loop\0 00 00 70 42 84 00 00 00 | 00 00 00 35 00 00 00 00 | 00 00 00 b4 12 00 00 72...
// 动画1 loop@34, 数据@63. 动画1 loop 后 = 63-34-4 = 25 字节头字段
// 动画2 类似: 数据起点 = loop2 + 4 + 25? 用 (mdle - X) % 36 == 0 验证
const total = mdle - mdla;
for (let s = 0; s < 80; s++) {
  const cand = loop2 - mdla + 4 + s;
  const n = total - cand;
  if (n % 36 === 0 && n / 36 > 1000) {
    console.log(`候选动画2起点 @${cand}: ${n / 36} 条 (=${(n / 36 / 53).toFixed(3)}/骨骼)`);
  }
}
