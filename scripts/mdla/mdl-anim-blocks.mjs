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

function analyzeAnimations(pkg, mdl, label) {
  const buf = pkg.read(mdl);
  if (!buf) { console.log(`${label}: 无`); return; }
  const dv2 = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // 找所有 MDLA + MDLE 块
  const blocks = [];
  let i = 0;
  while (i < buf.length) {
    const tag = buf.toString('ascii', i, i + 8);
    if (tag.startsWith('MDLA')) {
      const ver = buf.toString('ascii', i + 4, i + 8);
      // 找下一个 MDLE
      let end = buf.length;
      for (let j = i + 8; j < buf.length; j++) {
        const t2 = buf.toString('ascii', j, j + 8);
        if (t2.startsWith('MDLE')) { end = j; break; }
        if (t2.startsWith('MDLA') && j > i + 8) { end = j; break; }
      }
      blocks.push({ start: i, end, tag: tag + ver });
      i = end;
    } else i++;
  }
  console.log(`\n=== ${label} (${mdl}) ===`);
  console.log('MDLA/MDLE 块:', blocks.map(b => `${b.tag}@${b.start}-${b.end} (${b.end - b.start}B)`).join(' | '));
  // 每个 MDLA 块内的动画名和 loop 数
  for (const b of blocks) {
    if (!b.tag.startsWith('MDLA')) continue;
    const seg = buf.slice(b.start, b.end);
    const names = [];
    const loops = [];
    let idx = 0;
    while ((idx = seg.indexOf(Buffer.from('loop'), idx)) !== -1) { loops.push(idx); idx += 4; }
    // 找 loop 前的动画名 (C 字符串)
    for (const lp of loops) {
      // 向前找字符串起点
      let s = lp - 1;
      while (s > 0 && (seg[s] >= 0x20 && seg[s] < 0x7f || seg[s] >= 0x80)) s--;
      const name = seg.toString('utf8', s + 1, lp).trim();
      if (name && /[\u4e00-\u9fff\x20-\x7e]/.test(name) && name.length < 30) names.push(name);
    }
    console.log(`  MDLA@${b.start}: ${names.length} 个动画名: ${[...new Set(names)].join(' | ')} (loop@${loops.join(',')})`);
  }
}

const pkg1 = openPkg(base + '3461168300/scene.pkg');
analyzeAnimations(pkg1, 'models/人物_puppet.mdl', '人物');
analyzeAnimations(pkg1, 'models/发_puppet.mdl', '后发');

const pkg2 = openPkg(base + '3486806915/scene.pkg');
analyzeAnimations(pkg2, 'models/头_puppet.mdl', '伊蕾娜-头');
analyzeAnimations(pkg2, 'models/右眼_puppet.mdl', '伊蕾娜-右眼');
analyzeAnimations(pkg2, 'models/眉毛_puppet.mdl', '伊蕾娜-眉毛');
