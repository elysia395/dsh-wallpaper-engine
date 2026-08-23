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
// 用 parseTexInternal 同款逻辑读 mipmap record 的 width/height
// 先读 TEXI 头确定容器版本和 mip 起点
for (const p of ['materials/人物.tex', 'materials/发.tex']) {
  const raw = read(p);
  const dv2 = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  let pos = 0;
  const nstr = (n) => { const s = raw.toString('utf8', pos, pos + n).replace(/\0+$/, ''); pos += n; return s; };
  const magic1 = nstr(8);
  const magic2 = nstr(8);
  const format = dv2.getInt32(pos, true); pos += 4;
  const flags = dv2.getInt32(pos, true); pos += 4;
  const textureWidth = dv2.getInt32(pos, true); pos += 4;
  const textureHeight = dv2.getInt32(pos, true); pos += 4;
  const imageWidth = dv2.getInt32(pos, true); pos += 4;
  const imageHeight = dv2.getInt32(pos, true); pos += 4;
  pos += 4; // unknown
  const containerMagic = nstr(8);
  const ver = Number(/TEXB000([1-4])/.exec(containerMagic)[1]);
  const imageCount = dv2.getInt32(pos, true); pos += 4;
  let cver = ver;
  if (cver === 3) { pos += 4; }
  else if (cver === 4) { const f = dv2.getInt32(pos, true); const isMp4 = dv2.getInt32(pos + 4, true); pos += 8; if (!(f === -1 && isMp4 === 1)) cver = 3; }
  // 第一个 image 的 mipmap
  const mipCount = dv2.getInt32(pos, true); pos += 4;
  const mip = [];
  for (let j = 0; j < mipCount; j++) {
    if (cver === 1) {
      const w = dv2.getInt32(pos, true); const h = dv2.getInt32(pos + 4, true); const len = dv2.getInt32(pos + 8, true); pos += 12;
      mip.push({ w, h, len });
    } else {
      const w = dv2.getInt32(pos, true); const h = dv2.getInt32(pos + 4, true); pos += 8;
      const isLz4 = dv2.getInt32(pos, true); const dc = dv2.getInt32(pos + 4, true); const sl = dv2.getInt32(pos + 8, true); pos += 12;
      mip.push({ w, h, isLz4, dc, sl });
    }
  }
  console.log('===', p, '===');
  console.log('magic:', magic1, magic2);
  console.log('format:', format, 'flags:', flags.toString(16));
  console.log('textureWidth/Height:', textureWidth, 'x', textureHeight);
  console.log('imageWidth/Height:', imageWidth, 'x', imageHeight);
  console.log('container:', containerMagic, 'imageCount:', imageCount, 'mipCount:', mipCount);
  console.log('mip0:', JSON.stringify(mip[0]));
  console.log('mip1:', JSON.stringify(mip[1]));
  console.log('mip2:', JSON.stringify(mip[2]));
}
