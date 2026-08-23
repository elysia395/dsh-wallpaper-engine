// 扫描全部 3 个场景 pkg 的 MP4/视频容器 + 大纹理 (可能是视频纹理)
import fs from 'fs';

function scanPkg(pkgPath) {
  const data = fs.readFileSync(pkgPath);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 0;
  const rstr = () => { const len = dv.getInt32(pos, true); pos += 4; const s = data.toString('utf8', pos, pos + len); pos += len; return s; };
  try { rstr(); } catch { return; }
  const count = dv.getInt32(pos, true); pos += 4;
  const entries = [];
  for (let i = 0; i < count; i++) { const p = rstr(); const off = dv.getUint32(pos, true); const len = dv.getUint32(pos + 4, true); pos += 8; entries.push({ p, off, len }); }
  const dataStart = pos;
  function lz4(src, dstSize) {
    const dst = new Uint8Array(dstSize);
    let ip = 0, op = 0;
    try {
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
    } catch { return null; }
    return dst;
  }
  const read = (p) => {
    const e = entries.find(x => x.p === p);
    if (!e) return null;
    const abs = dataStart + e.off;
    const seg = data.subarray(abs, abs + e.len);
    const orig = dv.getUint32(abs, true) + dv.getUint32(abs + 4, true) * 4294967296;
    if (orig <= e.len || orig > 2147483647) return seg;
    let r = abs + 8;
    const out = new Uint8Array(orig);
    let written = 0;
    try {
      while (written < orig) {
        const u = dv.getInt32(r, true), c = dv.getInt32(r + 4, true);
        r += 8;
        const dec = lz4(data.subarray(r, r + c), u);
        if (!dec) return null;
        out.set(dec, written);
        r += c; written += u;
      }
    } catch { return null; }
    return out;
  };
  let mp4 = 0, mp4Files = [], largeTex = [];
  for (const e of entries) {
    const raw = read(e.p);
    if (!raw || raw.length < 12) continue;
    const sig = raw.toString('latin1', 4, 8);
    if (raw[4] === 0x66 && raw[5] === 0x74 && raw[6] === 0x79 && raw[7] === 0x70) { mp4++; mp4Files.push(e.p + '(' + raw.length + 'B)'); }
    // 大纹理 (>500KB, 可能视频)
    if (e.p.endsWith('.tex') && e.len > 500000) largeTex.push(e.p + '(' + Math.round(e.len/1024) + 'KB)');
  }
  return { mp4, mp4Files, largeTex, count: entries.length };
}

const scenes = [
  ['普拉娜', 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3461168300/scene.pkg'],
  ['伊蕾娜', 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3470764447/scene.pkg'],
  ['阿米娅', 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/scene.pkg'],
];
for (const [name, pkg] of scenes) {
  if (!fs.existsSync(pkg)) { console.log(name, '不存在'); continue; }
  const r = scanPkg(pkg);
  console.log('===== ' + name + ' =====');
  console.log('MP4:', r.mp4, r.mp4Files.slice(0, 5).join(', '));
  console.log('大纹理:', r.largeTex.slice(0, 8).join(', '));
}
