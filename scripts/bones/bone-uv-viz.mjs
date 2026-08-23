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
let mdlsOffset = buf.length;
for (let off = 9; off + 4 < buf.length; off++) {
  if (buf[off] === 0x4d && buf[off+1] === 0x44 && buf[off+2] === 0x4c && buf[off+3] === 0x53) { mdlsOffset = off; break; }
}
let found = null;
for (let offset = 9; offset + 12 < mdlsOffset; offset++) {
  const vertexBytes = dv2.getUint32(offset + 4, true);
  const verticesOffset = offset + 8;
  if (vertexBytes === 0 || vertexBytes % 80 !== 0) continue;
  const indexLenOffset = verticesOffset + vertexBytes;
  if (indexLenOffset + 4 > mdlsOffset) continue;
  const indexBytes = dv2.getUint32(indexLenOffset, true);
  const indicesOffset = indexLenOffset + 4;
  if (indexBytes === 0 || indexBytes % 2 !== 0 || indicesOffset + indexBytes > mdlsOffset) continue;
  found = { verticesOffset, vertexBytes, indicesOffset, indexBytes };
  break;
}

// 贴图
const model = JSON.parse(Buffer.from(read('models/人物.json')).toString('utf8'));
const mat = JSON.parse(Buffer.from(read(model.material)).toString('utf8'));
const texName = (mat.passes || [])[0].textures[0];
const texRaw = read('materials/' + texName + '.tex');
const texInfo = parseTex(texRaw);
const texDec = decodeTex(texRaw);
let tex;
if (texDec.kind === 'rgba' && (texDec.width !== texInfo.width || texDec.height !== texInfo.height)) {
  const srcW = texDec.width;
  const w = texInfo.width, h = texInfo.height;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) rgba.set(texDec.rgba.subarray(y * srcW * 4, y * srcW * 4 + w * 4), y * w * 4);
  tex = { width: w, height: h, rgba };
} else tex = texDec;
console.log('贴图:', tex.width + 'x' + tex.height);

// 对 B4 的 UV 区域做"内容感知"分析: 采样该区域的像素, 判断是脸/眉/发
// 用顶点 UV 精确范围
const vertexCount = found.vertexBytes / 80;
const groups = {};
for (let i = 0; i < vertexCount; i++) {
  const vo = found.verticesOffset + i * 80;
  const u = dv2.getFloat32(vo + 72, true), v = dv2.getFloat32(vo + 76, true);
  const b0 = dv2.getUint32(vo + 40, true);
  const w0 = dv2.getFloat32(vo + 56, true);
  if (w0 < 0.5) continue;
  if (!groups[b0]) groups[b0] = { pts: [] };
  groups[b0].pts.push([u, v]);
}

// 为关键骨骼生成 UV 区域 ASCII 图 (贴图内容亮度)
function renderUV(b, label) {
  const g = groups[b];
  if (!g) { console.log(`B${b}: 无顶点`); return; }
  const CW = 40, CH = 24;
  const grid = Array.from({ length: CH }, () => new Array(CW).fill(' '));
  let sum = 0, cnt = 0;
  for (const [u, v] of g.pts) {
    const px = Math.min(tex.width - 1, Math.max(0, Math.floor(u * tex.width)));
    const py = Math.min(tex.height - 1, Math.max(0, Math.floor((1 - v) * tex.height)));
    const i = (py * tex.width + px) * 4;
    if (tex.rgba[i + 3] > 30) {
      const lum = (tex.rgba[i] + tex.rgba[i+1] + tex.rgba[i+2]) / 3;
      sum += lum; cnt++;
      const gx = Math.floor(u * CW), gy = Math.floor((1 - v) * CH);
      if (gx >= 0 && gx < CW && gy >= 0 && gy < CH) {
        grid[gy][gx] = lum > 180 ? '@' : lum > 100 ? '#' : lum > 50 ? '+' : '.';
      }
    }
  }
  console.log(`\n=== ${label} (B${b}, 平均亮度 ${(sum / Math.max(1, cnt)).toFixed(0)}) ===`);
  for (const row of grid) console.log(row.join(''));
  // 完整 UV 范围
  let minU = 1e9, maxU = -1e9, minV = 1e9, maxV = -1e9;
  for (const [u, v] of g.pts) {
    if (u < minU) minU = u; if (u > maxU) maxU = u;
    if (v < minV) minV = v; if (v > maxV) maxV = v;
  }
  console.log(`UV范围: u[${minU.toFixed(2)},${maxU.toFixed(2)}] v[${minV.toFixed(2)},${maxV.toFixed(2)}]`);
}

renderUV(3, 'B3');
renderUV(4, 'B4 (anim1 大幅摆动)');
renderUV(8, 'B8');
renderUV(13, 'B13');
renderUV(22, 'B22');
renderUV(39, 'B39 (anim1 摆动)');
renderUV(44, 'B44 (anim1 摆动)');
renderUV(51, 'B51');
