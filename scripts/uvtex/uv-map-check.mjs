import fs from 'fs';
import { parseTex, decodeTex } from 'file:///D:/dsh-wallpaper-engine/lib/pkg-extract.js';

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

// 顶点位置 vs UV 对应贴图像素
// 左半贴图：x∈[0,1775], 角色内容 x[32,1774]
// 假设 UV 相对全贴图：u×3550
// 假设 UV 相对左半：u×2×1775 = u×3550（同）？不，若相对左半 u'∈[0,0.5] → u'×3550 = u'×2×1775
// 关键测试：头部顶点（rawY 最大）UV 采样贴图哪个区域，是否"看起来像头部"
console.log('顶点 UV 采样位置分析（rawY 排序，采样 10 个顶点）:');
const verts = [];
for (let i = 0; i < 634; i++) {
  const o = 79 + i * 80;
  verts.push({
    x: dv2.getFloat32(o, true), y: dv2.getFloat32(o + 4, true),
    u: dv2.getFloat32(o + 72, true), v: dv2.getFloat32(o + 76, true),
  });
}
verts.sort((a, b) => b.y - a.y); // rawY 大 = 顶部
const tw = 3550, th = 3750;
console.log('(rawX, rawY) | UV(u,v) | 贴图像素(u*3550, v*3750) | 是否左半');
for (const v of verts.slice(0, 8)) {
  const px = v.u * tw, py = v.v * th;
  const half = px < 1775 ? '左' : '右';
  console.log('  (' + v.x.toFixed(0) + ',' + v.y.toFixed(0) + ') | (' + v.u.toFixed(3) + ',' + v.v.toFixed(3) + ') | (' + px.toFixed(0) + ',' + py.toFixed(0) + ') | ' + half);
}
console.log('...');
console.log('底部顶点:');
for (const v of verts.slice(-6)) {
  const px = v.u * tw, py = v.v * th;
  const half = px < 1775 ? '左' : '右';
  console.log('  (' + v.x.toFixed(0) + ',' + v.y.toFixed(0) + ') | (' + v.u.toFixed(3) + ',' + v.v.toFixed(3) + ') | (' + px.toFixed(0) + ',' + py.toFixed(0) + ') | ' + half);
}

// 检查 UV 的 u 是否可能相对"左半"（即 u 应该 ∈[0,0.5] 但被当作 [0,1]）
// 如果角色主体 u∈[0.3,0.5]，映射到左半 x[0.6,1.0]×1775 = x[1065,1775]
// 而左半角色内容 x[32,1774] → 如果角色应占满左半，UV 应该是 u'∈[0,0.5] 对应 x[0,1775]
console.log('\nUV u 范围 [0.003, 1.018] — 若角色占满左半，UV u 应在 [0, 0.5] 附近');
console.log('但实际峰值在 0.3-0.4 → 角色被压缩到左半的 60-80% 区域');
