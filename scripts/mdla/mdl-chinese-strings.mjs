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
for (const mdl of ['models/人物_puppet.mdl', 'models/发_puppet.mdl']) {
  const buf = read(mdl);
  console.log(`\n=== ${mdl} (${buf.length}B) 全部 UTF-8 中文串 ===`);
  const seen = new Set();
  for (let i = 0; i + 2 < buf.length; i++) {
    // 检测 UTF-8 3字节中文开头
    const b0 = buf[i], b1 = buf[i + 1], b2 = buf[i + 2];
    if (b0 >= 0xE4 && b0 <= 0xE9 && b1 >= 0x80 && b1 <= 0xBF && b2 >= 0x80 && b2 <= 0xBF) {
      // 向后扩展（允许 ASCII 混合）
      let e = i;
      while (e < buf.length && (buf[e] >= 0x20 || buf[e] >= 0x80)) {
        if (buf[e] >= 0x20 && buf[e] < 0x7f) { e++; continue; }
        if (buf[e] >= 0x80 && e + 2 < buf.length && buf[e + 1] >= 0x80 && buf[e + 2] >= 0x80) { e += 3; continue; }
        break;
      }
      // 截断到合理长度且含 \0 结尾
      let end = e;
      while (end < buf.length && buf[end] !== 0) end++;
      const s = buf.toString('utf8', i, Math.min(end, i + 60));
      if (/[\u4e00-\u9fff]/.test(s) && s.length > 1) seen.add(s);
      i = end;
    }
  }
  console.log([...seen].join(' | '));
}
