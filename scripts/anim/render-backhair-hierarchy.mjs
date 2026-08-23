import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { parseTex, decodeTex } from 'file:///D:/dsh-wallpaper-engine/lib/pkg-extract.js';

const OUT = 'D:/dsh-wallpaper-engine/scene-layers-out';
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
// 后发模型
const model = JSON.parse(Buffer.from(read('models/发.json')).toString('utf8'));
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

const mdlRaw = read(model.puppet);
const buf = mdlRaw;
const dv2 = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

// 解析后发 mesh
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
const vertexCount = found.vertexBytes / 80;
const indexCount = found.indexBytes / 2;
const positions = [], uvs = [], boneIdx = [], boneW = [];
for (let i = 0; i < vertexCount; i++) {
  const vo = found.verticesOffset + i * 80;
  positions.push([dv2.getFloat32(vo, true), dv2.getFloat32(vo + 4, true), dv2.getFloat32(vo + 8, true)]);
  uvs.push([dv2.getFloat32(vo + 72, true), dv2.getFloat32(vo + 76, true)]);
  boneIdx.push([dv2.getUint32(vo + 40, true), dv2.getUint32(vo + 44, true), dv2.getUint32(vo + 48, true), dv2.getUint32(vo + 52, true)]);
  boneW.push([dv2.getFloat32(vo + 56, true), dv2.getFloat32(vo + 60, true), dv2.getFloat32(vo + 64, true), dv2.getFloat32(vo + 68, true)]);
}
const indices = [];
for (let i = 0; i < indexCount; i++) indices.push(dv2.getUint16(found.indicesOffset + i * 2, true));

// MDLS 骨骼 (6): b, parent, anchor
let p = mdlsOffset + 17;
const mdlaOffset = buf.indexOf(Buffer.from('MDLA0006'), mdlsOffset);
const bones = [];
for (let b = 0; b < 6 && p < mdlaOffset; b++) {
  const entryLen = dv2.getUint32(p + 9, true);
  if (entryLen <= 0 || entryLen > 10000) { p += 9; bones.push({ b, error: true, parent: -1, anchor: [0, 0] }); continue; }
  const floats = [];
  for (let i = 0; i < Math.floor(entryLen / 4); i++) floats.push(dv2.getFloat32(p + 13 + i * 4, true));
  const infoStart = p + 13 + entryLen;
  let infoLen = 0;
  while (infoStart + infoLen < buf.length && buf[infoStart + infoLen] >= 32 && buf[infoStart + infoLen] < 127) infoLen++;
  const parent = dv2.getUint32(p + 5, true);
  bones.push({ b, parent: parent === 0xffffffff ? -1 : parent, anchor: [floats[12] ?? 0, floats[13] ?? 0] });
  p = infoStart + infoLen + 1;
}
console.log('后发骨骼:', bones.map(b => `B${b.b}(p${b.parent})`).join(' '));

// 后发动画: DATA0 = mdla+99, 6骨骼×133帧
const mdla = 4057;
const DATA0 = mdla + 99;
const BLOCK = 133;
function decodeBone(b, f) {
  const rot = (2 * b) % 9;
  const o = DATA0 + (b * BLOCK + f) * 36;
  const un = [];
  for (let i = 0; i < 9; i++) un.push(dv2.getFloat32(o + ((i + rot) % 9) * 4, true));
  return un;
}

// 蒙皮: 带父子位移传递
// 骨骼 b 的世界位移 = 自身动画位移 + 父骨骼位移 (沿链累加)
// 自身动画位移 = animPos(b) - anchor(b)  (若 animPos 有效)
function skinPositionsHierarchy(animFrames) {
  // 先算每个骨骼的世界位移
  const worldDisp = new Array(bones.length).fill(null).map(() => [0, 0]);
  for (let b = 0; b < bones.length; b++) {
    const anc = bones[b].anchor;
    const frm = animFrames[b];
    let dx = 0, dy = 0;
    if (frm && isFinite(frm[0]) && Math.abs(frm[0]) < 5000) {
      dx += frm[0] - anc[0];
      dy += frm[1] - anc[1];
    }
    worldDisp[b] = [dx, dy];
  }
  // 累加父链
  for (let b = 0; b < bones.length; b++) {
    let cur = b;
    let total = [worldDisp[b][0], worldDisp[b][1]];
    let guard = 0;
    while (bones[cur] && bones[cur].parent >= 0 && guard < 10) {
      const par = bones[cur].parent;
      total[0] += worldDisp[par][0];
      total[1] += worldDisp[par][1];
      cur = par;
      guard++;
    }
    worldDisp[b] = total;
  }
  // 应用
  const out = [];
  for (let i = 0; i < positions.length; i++) {
    let dx = 0, dy = 0;
    for (let k = 0; k < 4; k++) {
      const bi = boneIdx[i][k];
      const w = boneW[i][k];
      if (bi >= bones.length || w === 0) continue;
      dx += w * worldDisp[bi][0];
      dy += w * worldDisp[bi][1];
    }
    out.push([positions[i][0] + dx, positions[i][1] + dy, positions[i][2]]);
  }
  return out;
}

function encodePng(w, h, rgba) {
  const buf = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) { raw[y * stride] = 0; buf.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4); }
  const idat = zlib.deflateSync(raw, { level: 6 });
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  function crc32(b) {
    let c, t = [];
    for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
    let crc = 0xffffffff;
    for (let i = 0; i < b.length; i++) crc = t[(crc ^ b[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// 全局边界
let gMinX = 1e9, gMaxX = -1e9, gMinY = 1e9, gMaxY = -1e9;
const allPoses = [];
for (let f = 0; f < 133; f++) {
  const animFrames = [];
  for (let b = 0; b < 6; b++) animFrames.push(decodeBone(b, f === 132 ? 131 : f));
  const pos = skinPositionsHierarchy(animFrames);
  allPoses.push(pos);
  for (const pt of pos) {
    if (pt[0] < gMinX) gMinX = pt[0]; if (pt[0] > gMaxX) gMaxX = pt[0];
    if (pt[1] < gMinY) gMinY = pt[1]; if (pt[1] > gMaxY) gMaxY = pt[1];
  }
}
const W = Math.ceil(gMaxX - gMinX) + 1;
const H = Math.ceil(gMaxY - gMinY) + 1;
const flipY = (y) => gMaxY - y;
const ALPHA_CUTOFF = 8;
function sample(u, v) {
  const tw = tex.width, th = tex.height, tdata = tex.rgba;
  const fx = u * tw - 0.5, fy = v * th - 0.5;
  const x0 = Math.max(0, Math.min(tw - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(th - 1, Math.floor(fy)));
  const x1 = Math.min(tw - 1, x0 + 1), y1 = Math.min(th - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const i00 = (y0 * tw + x0) * 4, i10 = (y0 * tw + x1) * 4;
  const i01 = (y1 * tw + x0) * 4, i11 = (y1 * tw + x1) * 4;
  const pm = [
    [tdata[i00] * tdata[i00 + 3], tdata[i00 + 1] * tdata[i00 + 3], tdata[i00 + 2] * tdata[i00 + 3], tdata[i00 + 3]],
    [tdata[i10] * tdata[i10 + 3], tdata[i10 + 1] * tdata[i10 + 3], tdata[i10 + 2] * tdata[i10 + 3], tdata[i10 + 3]],
    [tdata[i01] * tdata[i01 + 3], tdata[i01 + 1] * tdata[i01 + 3], tdata[i01 + 2] * tdata[i01 + 3], tdata[i01 + 3]],
    [tdata[i11] * tdata[i11 + 3], tdata[i11 + 1] * tdata[i11 + 3], tdata[i11 + 2] * tdata[i11 + 3], tdata[i11 + 3]],
  ];
  const out = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const top = pm[0][c] * (1 - tx) + pm[1][c] * tx;
    const bot = pm[2][c] * (1 - tx) + pm[3][c] * tx;
    out[c] = top * (1 - ty) + bot * ty;
  }
  if (out[3] < ALPHA_CUTOFF) return [0, 0, 0, 0];
  const a = out[3];
  return [Math.min(255, Math.round(out[0] / a)), Math.min(255, Math.round(out[1] / a)), Math.min(255, Math.round(out[2] / a)), Math.round(a)];
}
function rasterize(pos) {
  const rgba = new Uint8Array(W * H * 4);
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t], i1 = indices[t + 1], i2 = indices[t + 2];
    const a = [pos[i0][0] - gMinX, flipY(pos[i0][1])];
    const b = [pos[i1][0] - gMinX, flipY(pos[i1][1])];
    const c = [pos[i2][0] - gMinX, flipY(pos[i2][1])];
    const bx0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    const bx1 = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const by0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    const by1 = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    if (bx1 < bx0 || by1 < by0) continue;
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(area) < 1e-9) continue;
    const w0 = uvs[i0], w1 = uvs[i1], w2 = uvs[i2];
    for (let y = by0; y <= by1; y++) {
      for (let x = bx0; x <= bx1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const la = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
        const lb = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
        const lc = ((a[0] - px) * (b[1] - py) - (a[1] - py) * (b[0] - px)) / area;
        if (la < -1e-4 || lb < -1e-4 || lc < -1e-4) continue;
        const di = (y * W + x) * 4;
        const u = la * w0[0] + lb * w1[0] + lc * w2[0];
        const v = la * w0[1] + lb * w1[1] + lc * w2[1];
        const s = sample(u, v);
        const srcA = s[3] / 255;
        if (srcA <= 0) continue;
        const dstA = rgba[di + 3] / 255;
        const outA = srcA + dstA * (1 - srcA);
        if (outA <= 0) continue;
        rgba[di] = Math.round((s[0] * srcA + rgba[di] * dstA * (1 - srcA)) / outA);
        rgba[di + 1] = Math.round((s[1] * srcA + rgba[di + 1] * dstA * (1 - srcA)) / outA);
        rgba[di + 2] = Math.round((s[2] * srcA + rgba[di + 2] * dstA * (1 - srcA)) / outA);
        rgba[di + 3] = Math.round(outA * 255);
      }
    }
  }
  return { rgba, w: W, h: H };
}

const dir = path.join(OUT, 'backhair_frames');
fs.mkdirSync(dir, { recursive: true });
for (let f = 0; f < 133; f++) {
  const img = rasterize(allPoses[f]);
  fs.writeFileSync(path.join(dir, `frame_${String(f).padStart(2, '0')}.png`), encodePng(img.w, img.h, img.rgba));
}
console.log('后发动画 (父子传递) 133 帧 →', dir, W + 'x' + H);
fs.writeFileSync(path.join(OUT, 'backhair_frames.offset.json'), JSON.stringify({ size: [W, H], drawOffset: [gMinX, -gMaxY] }));
console.log('drawOffset:', [gMinX.toFixed(1), (-gMaxY).toFixed(1)]);
