import fs from 'fs';
const base = 'c:/program files (x86)/steam/steamapps/workshop/content/431960/';
function openPkg(pkgPath) {
  const data = fs.readFileSync(pkgPath);
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

// 提取 MDL 中所有 C 字符串 (可打印 + 中文), 找动画名
function extractStrings(buf, label) {
  const strs = [];
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    const isAscii = b >= 32 && b < 127;
    const isCN = b >= 0x80 && i + 2 < buf.length && buf[i + 1] >= 0x80 && buf[i + 2] >= 0x80;
    if (isAscii || isCN) {
      let e = i;
      while (e < buf.length) {
        const bb = buf[e];
        const a = bb >= 32 && bb < 127;
        const c = bb >= 0x80 && e + 2 < buf.length && buf[e + 1] >= 0x80 && buf[e + 2] >= 0x80;
        if (!a && !c) break;
        e += c ? 3 : 1;
      }
      let s;
      try { s = buf.toString('utf8', i, e); } catch { i = e; continue; }
      if (s.length >= 2 && s.length <= 40 && /[\u4e00-\u9fff]/.test(s) && !/[\x00-\x08\x0e-\x1f]/.test(s)) {
        strs.push(s);
      }
      i = e;
    }
  }
  // 去重并按出现位置
  const seen = new Set();
  const uniq = [];
  for (const s of strs) {
    const key = s;
    if (!seen.has(key)) { seen.add(key); uniq.push(s); }
  }
  console.log(`\n=== ${label} 中文字符串 ===`);
  console.log(uniq.join(' | '));
}

const pkg1 = openPkg(base + '3461168300/scene.pkg');
extractStrings(pkg1.read('models/人物_puppet.mdl'), '人物_puppet');
extractStrings(pkg1.read('models/发_puppet.mdl'), '发_puppet');

const pkg2 = openPkg(base + '3486806915/scene.pkg');
extractStrings(pkg2.read('models/头_puppet.mdl'), '伊蕾娜-头');
extractStrings(pkg2.read('models/右眼_puppet.mdl'), '伊蕾娜-右眼');
