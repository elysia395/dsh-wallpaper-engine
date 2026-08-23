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

function dumpAnimHeaders(pkg, mdl, label) {
  const buf = pkg.read(mdl);
  if (!buf) return;
  console.log(`\n=== ${label} (${mdl}) ===`);
  // 找所有 "loop" 及前面的头部
  let idx = 0;
  const loopPos = [];
  while ((idx = buf.indexOf(Buffer.from('loop'), idx)) !== -1) { loopPos.push(idx); idx += 4; }
  for (const lp of loopPos) {
    // 打印 loop 前 60 字节 hex + 解码
    const start = Math.max(0, lp - 60);
    const seg = buf.slice(start, lp + 8);
    console.log(`\n  loop@${lp} (相对 MDLA 偏移见下), 前部 hex:`);
    const hex = seg.toString('hex').match(/.{2}/g).join(' ');
    console.log('  ' + hex);
    // 尝试提取 "动画 X" 或中文名: 从 loop 向前找第一个 \0 前的字符串
    let s = lp - 1;
    while (s > start && buf[s] !== 0) s--;
    const name = buf.toString('utf8', s + 1, lp).replace(/\0/g, '').trim();
    console.log(`  动画名候选: "${name}"`);
    // 也找 "动画" 前缀
    const animIdx = buf.lastIndexOf(Buffer.from('动画', 'utf8'), lp);
    if (animIdx >= start) {
      let e = animIdx;
      while (e < buf.length && buf[e] !== 0) e++;
      console.log(`  "动画" 字符串: "${buf.toString('utf8', animIdx, e)}"`);
    }
  }
}

const pkg1 = openPkg(base + '3461168300/scene.pkg');
dumpAnimHeaders(pkg1, 'models/人物_puppet.mdl', '人物');
dumpAnimHeaders(pkg1, 'models/发_puppet.mdl', '后发');
const pkg2 = openPkg(base + '3486806915/scene.pkg');
dumpAnimHeaders(pkg2, 'models/右眼_puppet.mdl', '伊蕾娜-右眼');
dumpAnimHeaders(pkg2, 'models/头_puppet.mdl', '伊蕾娜-头');
