// 验证 anim2 (真"眼"层) 增量帧视觉: 渲染 anim2 f12 vs f66 组合帧对比
// 基底用 anim1 f12 (静止), 叠加 anim2 增量
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

const mdlRaw = read(model.puppet);
const buf = mdlRaw;
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

const animData = JSON.parse(fs.readFileSync(path.join(OUT, 'mdla-anim-data.json'), 'utf8'));
const bones = animData.bones.map((b, idx) => ({ b: idx, parent: b.parent, anchor: [b.anchor[0], b.anchor[1]] }));
const N = bones.length;

function mat2dMul(a, b) {
  return [
    a[0]*b[0] + a[1]*b[3], a[0]*b[1] + a[1]*b[4], a[0]*b[2] + a[1]*b[5] + a[2],
    a[3]*b[0] + a[4]*b[3], a[3]*b[1] + a[4]*b[4], a[3]*b[2] + a[4]*b[5] + a[5],
  ];
}
function mat2dInv(m) {
  const det = m[0]*m[4] - m[1]*m[3];
  if (Math.abs(det) < 1e-12) return [1,0,0,0,1,0];
  const id = 1/det;
  return [m[4]*id, -m[1]*id, (m[1]*m[5]-m[2]*m[4])*id, -m[3]*id, m[0]*id, (m[2]*m[3]-m[0]*m[5])*id];
}
function mat2dApply(m, x, y) { return [m[0]*x + m[1]*y + m[2], m[3]*x + m[4]*y + m[5]]; }

const bindW = new Array(N).fill(null);
for (let b = 0; b < N; b++) {
  const T = [1, 0, bones[b].anchor[0], 0, 1, bones[b].anchor[1]];
  bindW[b] = bones[b].parent < 0 ? T : mat2dMul(bindW[bones[b].parent], T);
}
const invBind = new Array(N).fill(null);
for (let b = 0; b < N; b++) invBind[b] = mat2dInv(bindW[b]);

function buildSkinFull(framePose) {
  const W = new Array(N).fill(null);
  for (let b = 0; b < N; b++) {
    const fr = framePose[b];
    const px = (fr && isFinite(fr.pos[0]) && Math.abs(fr.pos[0]) < 5000) ? fr.pos[0] : bones[b].anchor[0];
    const py = (fr && isFinite(fr.pos[1]) && Math.abs(fr.pos[1]) < 5000) ? fr.pos[1] : bones[b].anchor[1];
    const rz = (fr && isFinite(fr.rot[2])) ? fr.rot[2] : 0;
    let sc = 1;
    if (fr && fr.scale && isFinite(fr.scale[0]) && fr.scale[0] > 0.01) sc = fr.scale[0];
    const cos = Math.cos(rz), sin = Math.sin(rz);
    const L = [cos*sc, -sin*sc, px, sin*sc, cos*sc, py];
    W[b] = bones[b].parent < 0 ? L : mat2dMul(W[bones[b].parent], L);
  }
  const out = [];
  for (let i = 0; i < positions.length; i++) {
    const v = positions[i];
    let sx = 0, sy = 0;
    for (let k = 0; k < 4; k++) {
      const bi = boneIdx[i][k];
      const w = boneW[i][k];
      if (bi >= N || w === 0) continue;
      const loc = mat2dApply(invBind[bi], v[0], v[1]);
      const world = mat2dApply(W[bi], loc[0], loc[1]);
      sx += w * world[0];
      sy += w * world[1];
    }
    out.push([sx, sy, v[2]]);
  }
  return out;
}

// 组合姿态: anim1[f1] 基底 + anim2[f2] 相对 anim2 静止帧(f132) 的增量 (additive 语义)
function poseMix(f1, f2) {
  const rest = animData.anim2.perBone;
  const pose = new Array(N);
  for (let i = 0; i < N; i++) {
    const p1 = animData.anim1.perBone[i].frames[f1];
    const p2 = animData.anim2.perBone[i].frames[f2];
    const r2 = rest[i].frames[132]; // anim2 静止帧 (保持睁眼)
    if (!p1 || !p2 || !r2) { pose[i] = p1; continue; }
    const dx = (isFinite(p2.pos[0]) && isFinite(r2.pos[0]) && Math.abs(p2.pos[0]) < 5000 && Math.abs(r2.pos[0]) < 5000) ? p2.pos[0] - r2.pos[0] : 0;
    const dy = (isFinite(p2.pos[1]) && isFinite(r2.pos[1]) && Math.abs(p2.pos[1]) < 5000 && Math.abs(r2.pos[1]) < 5000) ? p2.pos[1] - r2.pos[1] : 0;
    const dr = (isFinite(p2.rot[2]) && isFinite(r2.rot[2])) ? p2.rot[2] - r2.rot[2] : 0;
    pose[i] = {
      pos: [p1.pos[0] + dx, p1.pos[1] + dy, 0],
      rot: [0, 0, p1.rot[2] + dr],
      scale: p1.scale,
    };
  }
  return pose;
}

const bounds = { minX: -1122.2, maxX: 1278.2, minY: -748.3, maxY: 1921.6 };
const W = Math.ceil(bounds.maxX - bounds.minX) + 1;
const H = Math.ceil(bounds.maxY - bounds.minY) + 1;
const flipY = (y) => bounds.maxY - y;
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
function rasterize(skinned) {
  const rgba = new Uint8Array(W * H * 4);
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t], i1 = indices[t + 1], i2 = indices[t + 2];
    const a = [skinned[i0][0] - bounds.minX, flipY(skinned[i0][1])];
    const b = [skinned[i1][0] - bounds.minX, flipY(skinned[i1][1])];
    const c = [skinned[i2][0] - bounds.minX, flipY(skinned[i2][1])];
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

// 生成 anim2 增量组合帧: f2 = 12..131 (120帧), 基底 anim1 f12 (静止呼吸)
// 这就是"眨眼"动画: 睁眼(f12) → 闭眼/动作(f66) → 睁眼(f131)
const dir = path.join(OUT, 'blink_v18');
fs.mkdirSync(dir, { recursive: true });
for (let k = 0; k < 120; k++) {
  const f2 = 12 + k;
  const skinned = buildSkinFull(poseMix(12, f2));
  const img = rasterize(skinned);
  fs.writeFileSync(path.join(dir, `frame_${String(k).padStart(3, '0')}.png`), encodePng(img.w, img.h, img.rgba));
}
console.log('blink_v18 (anim2 眼层增量, f12..131) 120 帧 →', dir);

// 验证: frame_000 (睁眼) vs frame_054 (f66 动作峰) 差异区域
function readPNG(p) {
  const b = fs.readFileSync(p);
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  let idat = Buffer.alloc(0);
  let pos = 8;
  while (pos < b.length) {
    const len = b.readUInt32BE(pos);
    const type = b.toString('ascii', pos + 4, pos + 8);
    if (type === 'IDAT') idat = Buffer.concat([idat, b.slice(pos + 8, pos + 8 + len)]);
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(idat);
  const rgba = Buffer.alloc(w * h * 4);
  const stride = w * 4 + 1;
  for (let y = 0; y < h; y++) raw.copy(rgba, y * w * 4, y * stride + 1, y * stride + 1 + w * 4);
  return { w, h, rgba };
}
const a = readPNG(path.join(dir, 'frame_000.png'));
const b = readPNG(path.join(dir, 'frame_054.png'));
console.log('blink f000 vs f054 (f66 峰) 差异行:');
for (let y = 0; y < a.h; y += 40) {
  let cnt = 0;
  for (let x = 0; x < a.w; x++) {
    const i = (y * a.w + x) * 4;
    if (Math.abs(a.rgba[i + 3] - b.rgba[i + 3]) > 20) cnt++;
  }
  if (cnt > 5) console.log('  y=' + y + ' diff:' + cnt);
}
