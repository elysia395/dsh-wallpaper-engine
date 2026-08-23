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

function analyze(pkg, mdlPath, label, boneCount) {
  const buf = pkg.read(mdlPath);
  const dv2 = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let mdla = -1, mdle = buf.length;
  for (let i = 0; i + 8 < buf.length; i++) {
    if (buf.toString('ascii', i, i + 8) === 'MDLA0006') { mdla = i; break; }
  }
  for (let i = mdla + 8; i + 8 < buf.length; i++) {
    if (buf.toString('ascii', i, i + 8) === 'MDLE0002' || buf.toString('ascii', i, i + 8) === 'MDLE0001') { mdle = i; break; }
  }
  console.log(`\n===== ${label} =====`);
  console.log(`MDLA@${mdla} MDLE@${mdle} 块大小=${mdle - mdla} 骨骼数=${boneCount}`);
  // 头部 hex 前 80 字节
  const hex = Buffer.from(buf.slice(mdla, mdla + 80)).toString('hex');
  const pairs = hex.match(/.{2}/g);
  let line = '';
  for (let i = 0; i < pairs.length; i++) {
    line += pairs[i] + ' ';
    if ((i + 1) % 16 === 0) { console.log(`  @${(i - 15).toString().padStart(3)}: ${line}`); line = ''; }
  }
  if (line) console.log(`  @${(pairs.length - (pairs.length % 16)).toString().padStart(3)}: ${line}`);
  // 头部字段解析: 字符串位置
  const animIdx = buf.indexOf(Buffer.from('动画', 'utf8'), mdla);
  const loopIdx = buf.indexOf(Buffer.from('loop'), mdla);
  console.log(`"动画"@${animIdx - mdla} "loop"@${loopIdx - mdla}`);
  // 头部 u32 字段
  const fields = [];
  for (let o = 8; o < 64; o += 4) {
    const u = dv2.getUint32(mdla + o, true);
    const f = dv2.getFloat32(mdla + o, true);
    fields.push(`@${o}:u32=${u}(0x${u.toString(16)})/f32=${isFinite(f) ? f.toFixed(2) : 'inf'}`);
  }
  console.log(fields.join('\n'));
  // 数据起点候选: loop 之后? 尝试 (mdle-mdla-X)/36 整除
  const total = mdle - mdla;
  for (let s = 30; s < 100; s++) {
    const n = total - s;
    if (n % 36 === 0 && n / 36 > 10) {
      console.log(`候选起点@${s}: ${n / 36} 条 (=${((n / 36) / boneCount).toFixed(3)}/骨骼)`);
    }
  }
  // 验证候选起点: 用多个起点检查首个 36B 是否像数据
  for (const s of [41, 57, 63, 75]) {
    const o = mdla + s;
    const f = [];
    for (let i = 0; i < 9; i++) f.push(dv2.getFloat32(o + i * 4, true));
    console.log(`起点@${s} 首条: [${f.map(v => isFinite(v) ? v.toFixed(1) : 'INF').join(',')}]`);
  }
}

const pkg1 = openPkg(base + '3461168300/scene.pkg');
analyze(pkg1, 'models/人物_puppet.mdl', '人物', 53);
analyze(pkg1, 'models/发_puppet.mdl', '发', 6);
const pkg2 = openPkg(base + '3486806915/scene.pkg');
analyze(pkg2, 'models/眉毛_puppet.mdl', '眉毛', 2);
analyze(pkg2, 'models/鼻子_puppet.mdl', '鼻子', 7);
