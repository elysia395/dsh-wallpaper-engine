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

function parseMdl(buf) {
  const markerSize = 9;
  const meshHeaderSize = 8;
  const vertexStride = 80;
  const uvOffset = 72;
  let mdlsOffset = buf.length;
  for (let off = markerSize; off + 4 < buf.length; off++) {
    if (buf[off] === 0x4d && buf[off+1] === 0x44 && buf[off+2] === 0x4c && buf[off+3] === 0x53) { mdlsOffset = off; break; }
  }
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let found = null;
  for (let offset = markerSize; offset + meshHeaderSize + 4 < mdlsOffset; offset++) {
    const vertexBytes = dv.getUint32(offset + 4, true);
    const verticesOffset = offset + meshHeaderSize;
    if (vertexBytes === 0 || vertexBytes % vertexStride !== 0) continue;
    const indexLenOffset = verticesOffset + vertexBytes;
    if (indexLenOffset + 4 > mdlsOffset) continue;
    const indexBytes = dv.getUint32(indexLenOffset, true);
    const indicesOffset = indexLenOffset + 4;
    if (indexBytes === 0 || indexBytes % 2 !== 0 || indicesOffset + indexBytes > mdlsOffset) continue;
    found = { headerOffset: offset, vertexBytes, indexBytes, verticesOffset, indicesOffset };
    break;
  }
  if (!found) throw new Error('no mesh block');
  const vertexCount = found.vertexBytes / vertexStride;
  const indexCount = found.indexBytes / 2;
  const positions = [], uvs = [], bones = [];
  for (let i = 0; i < vertexCount; i++) {
    const vo = found.verticesOffset + i * vertexStride;
    positions.push([dv.getFloat32(vo, true), dv.getFloat32(vo + 4, true), dv.getFloat32(vo + 8, true)]);
    uvs.push([dv.getFloat32(vo + uvOffset, true), dv.getFloat32(vo + uvOffset + 4, true)]);
    bones.push(dv.getUint32(vo + 40, true));
  }
  const indices = [];
  for (let i = 0; i < indexCount; i++) indices.push(dv.getUint16(found.indicesOffset + i * 2, true));
  return { vertexCount, indexCount, positions, uvs, indices, bones };
}

function encodePng(w, h, rgba) {
  const buf = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) { raw[y * stride] = 0; buf.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4); }
  const idat = zlib.deflateSync(raw);
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

// v6: 网格渲染 + 线性 UV→场景补全（对网格未覆盖的贴图 v63-100% 内容）
// 网格顶点提供 (uv, pos) 采样对 —— v5 纯网格渲染（无补全）
function rasterizeWithFill(mesh, tex) {
  const { positions, uvs, indices, bones } = mesh;
  const tw = tex.width, th = tex.height, tdata = tex.rgba;

  // Premultiplied 双线性采样 + alpha 裁切：
  // 组件边界由贴图透明区域定义——边缘插值在 premultiplied 空间进行，
  // 避免透明像素拉脏边缘颜色；alpha 低于阈值裁切，防止错误覆盖下方组件。
  const ALPHA_CUTOFF = 8; // 0-255：低于此 alpha 的像素完全透明（裁切）
  function sample(u, v) {
    const fx = u * tw - 0.5, fy = v * th - 0.5;
    const x0 = Math.max(0, Math.min(tw - 1, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(th - 1, Math.floor(fy)));
    const x1 = Math.min(tw - 1, x0 + 1), y1 = Math.min(th - 1, y0 + 1);
    const tx = fx - x0, ty = fy - y0;
    const i00 = (y0 * tw + x0) * 4, i10 = (y0 * tw + x1) * 4;
    const i01 = (y1 * tw + x0) * 4, i11 = (y1 * tw + x1) * 4;
    // 4 个角的 premultiplied 值 (r*a, g*a, b*a, a)
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
    // alpha 裁切：低于阈值 → 完全透明
    if (out[3] < ALPHA_CUTOFF) return [0, 0, 0, 0];
    // 从 premultiplied 恢复 straight alpha（除以 alpha，恢复组件真实颜色，避免脏边）
    const a = out[3];
    return [
      Math.min(255, Math.round(out[0] / a)),
      Math.min(255, Math.round(out[1] / a)),
      Math.min(255, Math.round(out[2] / a)),
      Math.round(a),
    ];
  }

  // 角色坐标范围
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const p of positions) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const w = Math.ceil(maxX - minX);
  const h = Math.ceil(maxY - minY);
  const rgba = new Uint8Array(w * h * 4);
  const flipY = (y) => maxY - y;

  // 渲染网格三角形
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t], i1 = indices[t + 1], i2 = indices[t + 2];
    const a = [positions[i0][0] - minX, flipY(positions[i0][1])];
    const b = [positions[i1][0] - minX, flipY(positions[i1][1])];
    const c = [positions[i2][0] - minX, flipY(positions[i2][1])];
    const bx0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    const bx1 = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const by0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    const by1 = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
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
        const di = (y * w + x) * 4;
        const u = la * w0[0] + lb * w1[0] + lc * w2[0];
        const v = la * w0[1] + lb * w1[1] + lc * w2[1];
        const s = sample(u, v);
        const srcA = s[3] / 255;
        if (srcA <= 0) continue;
        // source-over alpha 混合：组件重叠区域正确融合，防止后画三角形硬切先画组件
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

  return { rgba, w, h, box: { minX, maxX, minY, maxY }, drawOffset: [minX, -maxY] };
}

const { read } = readPkg();
const jobs = [
  { name: '人物', model: 'models/人物.json', out: 'puppet_人物.png' },
  { name: '后发', model: 'models/发.json', out: 'puppet_后发.png' },
];

for (const job of jobs) {
  try {
    const model = JSON.parse(Buffer.from(read(job.model)).toString('utf8'));
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
      for (let y = 0; y < h; y++) {
        rgba.set(texDec.rgba.subarray(y * srcW * 4, y * srcW * 4 + w * 4), y * w * 4);
      }
      tex = { width: w, height: h, rgba };
    } else {
      tex = texDec;
    }
    const mdlRaw = read(model.puppet);
    const mesh = parseMdl(mdlRaw);
    console.log(job.name, mesh.vertexCount + 'v/' + mesh.indexCount + 'i', 'tex', tex.width + 'x' + tex.height);

    const img = rasterizeWithFill(mesh, tex);
    fs.writeFileSync(path.join(OUT, job.out), encodePng(img.w, img.h, img.rgba));
    fs.writeFileSync(path.join(OUT, job.out.replace('.png', '.offset.json')), JSON.stringify({
      box: img.box, size: [img.w, img.h], drawOffset: img.drawOffset,
    }));
    let nonZero = 0;
    for (let i = 3; i < img.rgba.length; i += 4) if (img.rgba[i] > 10) nonZero++;
    console.log('  →', job.out, img.w + 'x' + img.h, '非空', (100 * nonZero / (img.w * img.h)).toFixed(1) + '%', 'drawOffset=(' + img.drawOffset[0].toFixed(0) + ',' + img.drawOffset[1].toFixed(0) + ')');
  } catch (e) {
    console.log(job.name, '失败:', e.message);
  }
}
