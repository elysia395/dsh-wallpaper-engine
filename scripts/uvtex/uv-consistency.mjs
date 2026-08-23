import fs from 'fs';
import { decodeTex } from 'file:///D:/dsh-wallpaper-engine/lib/pkg-extract.js';

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
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

// 顶点流 @79, stride 80
const streamStart = 79, stride = 80, vc = 634;
// 分析：顶点 y（raw）与 UV v 的相关性
// 如果 UV v 对应贴图正确区域，那么 rawY 高（头顶）的顶点，UV v 应该指向贴图头部区域
console.log('顶点 rawY vs UV v 相关性（每 50 顶点采样）:');
console.log('rawY(模型y)  →  贴图y(size/2-rawY)  →  UV v  →  UV贴图y(v*3776)');
for (let i = 0; i < vc; i += 50) {
  const o = streamStart + i * stride;
  const rawY = dv.getFloat32(o + 4, true);
  const u = dv.getFloat32(o + 72, true);
  const v = dv.getFloat32(o + 76, true);
  const texY = 1888 - rawY; // 贴图空间位置
  const uvY = v * 3776;     // UV 采样位置
  console.log(
    '  v' + String(i).padStart(3),
    'rawY=' + rawY.toFixed(0).padStart(6),
    'texY=' + texY.toFixed(0).padStart(6),
    'u=' + u.toFixed(2),
    'v=' + v.toFixed(2),
    'uvY=' + uvY.toFixed(0).padStart(6),
    '一致?' + (Math.abs(texY - uvY) < 200 ? '✓' : '✗')
  );
}

// 头部顶点（rawY 最大）的 UV 应该指向贴图头部（y 小）
console.log('\n头部/顶部顶点 (rawY 最大 5 个):');
const sorted = [];
for (let i = 0; i < vc; i++) {
  const o = streamStart + i * stride;
  const rawY = dv.getFloat32(o + 4, true);
  const u = dv.getFloat32(o + 72, true);
  const v = dv.getFloat32(o + 76, true);
  sorted.push({ rawY, u, v, texY: 1888 - rawY, uvY: v * 3776 });
}
sorted.sort((a, b) => b.rawY - a.rawY);
for (const s of sorted.slice(0, 5)) {
  console.log('  rawY=' + s.rawY.toFixed(0), 'uvY=' + s.uvY.toFixed(0), 'texY=' + s.texY.toFixed(0), 'diff=' + (s.texY - s.uvY).toFixed(0));
}
console.log('\n底部顶点 (rawY 最小 5 个):');
for (const s of sorted.slice(-5)) {
  console.log('  rawY=' + s.rawY.toFixed(0), 'uvY=' + s.uvY.toFixed(0), 'texY=' + s.texY.toFixed(0), 'diff=' + (s.texY - s.uvY).toFixed(0));
}
