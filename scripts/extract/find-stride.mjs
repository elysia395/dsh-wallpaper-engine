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
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

// 顶点流从 79 开始，字节数 50720
const streamStart = 79;
const streamBytes = 50720;
console.log('顶点流 @79,', streamBytes, 'bytes');

// 尝试多种 stride 和 uv offset 组合，检查 UV 是否覆盖全图 [0,1]
const combos = [];
for (const stride of [40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80, 84, 88, 92, 96, 100]) {
  if (streamBytes % stride !== 0) continue;
  const vc = streamBytes / stride;
  // 尝试 uv 在 pos 后各种偏移（pos 3 floats = 12 bytes，再加 padding）
  for (let uvOff = 12; uvOff + 8 <= stride; uvOff += 4) {
    let minU = 1e9, maxU = -1e9, minV = 1e9, maxV = -1e9, ok = true;
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (let i = 0; i < vc; i++) {
      const o = streamStart + i * stride;
      const fx = dv.getFloat32(o, true);
      const fy = dv.getFloat32(o + 4, true);
      const fz = dv.getFloat32(o + 8, true);
      if (!isFinite(fx) || !isFinite(fy) || !isFinite(fz) || Math.abs(fx) > 50000 || Math.abs(fy) > 50000) { ok = false; break; }
      const u = dv.getFloat32(o + uvOff, true);
      const v = dv.getFloat32(o + uvOff + 4, true);
      if (!isFinite(u) || !isFinite(v) || u < -0.5 || u > 1.5 || v < -0.5 || v > 1.5) { ok = false; break; }
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      minV = Math.min(minV, v); maxV = Math.max(maxV, v);
      minX = Math.min(minX, fx); maxX = Math.max(maxX, fx);
      minY = Math.min(minY, fy); maxY = Math.max(maxY, fy);
    }
    if (ok) {
      combos.push({ stride, uvOff, vc, uv: [minU.toFixed(3), maxU.toFixed(3), minV.toFixed(3), maxV.toFixed(3)], pos: [minX.toFixed(0), maxX.toFixed(0), minY.toFixed(0), maxY.toFixed(0)] });
    }
  }
}
console.log('合理组合:');
for (const c of combos) {
  const uvCovers = parseFloat(c.uv[0]) <= 0.01 && parseFloat(c.uv[1]) >= 0.99 && parseFloat(c.uv[2]) <= 0.01 && parseFloat(c.uv[3]) >= 0.99;
  console.log('  stride=' + c.stride, 'uvOff=' + c.uvOff, 'verts=' + c.vc, 'uv[' + c.uv.join(',') + ']', 'posX[' + c.pos[0] + ',' + c.pos[1] + '] posY[' + c.pos[2] + ',' + c.pos[3] + ']', uvCovers ? '← UV全覆盖!' : '');
}
