import fs from 'fs';
const ids = ['2934788040', '3461168300', '3470764447', '3486806915'];
const base = 'c:/program files (x86)/steam/steamapps/workshop/content/431960/';
for (const id of ids) {
  const pkg = base + id + '/scene.pkg';
  const data = fs.readFileSync(pkg);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 0;
  const rstr = () => { const len = dv.getInt32(pos, true); pos += 4; const s = data.toString('utf8', pos, pos + len); pos += len; return s; };
  rstr(); const count = dv.getInt32(pos, true); pos += 4;
  const entries = [];
  for (let i = 0; i < count; i++) { const p = rstr(); const off = dv.getUint32(pos, true); const len = dv.getUint32(pos + 4, true); pos += 8; entries.push({ p, off, len }); }
  console.log(`=== ${id}: ${entries.length} 条目 ===`);
  const mdls = entries.filter(e => /\.mdl$/i.test(e.p));
  const models = entries.filter(e => /^models\//i.test(e.p));
  console.log('MDL 文件:', mdls.length ? mdls.map(e => e.p).join('; ') : '无');
  if (models.length) {
    console.log('models/ 目录:', models.map(e => e.p).slice(0, 30).join('; '));
  }
  // 也看 project.json 标题
  const proj = entries.find(e => e.p === 'project.json');
  if (proj) {
    const abs = pos + proj.off;
    const orig = dv.getUint32(abs, true) + dv.getUint32(abs + 4, true) * 4294967296;
    let buf = data.subarray(abs, abs + proj.len);
    if (orig > proj.len && orig < 2147483647) {
      const out = new Uint8Array(orig);
      let r = abs + 8, written = 0;
      const lz4 = (src, dstSize) => {
        const dst = new Uint8Array(dstSize); let ip = 0, op = 0;
        while (ip < src.length) {
          const t = src[ip++]; let lit = t >> 4;
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
      };
      while (written < orig) {
        const u = dv.getInt32(r, true), c = dv.getInt32(r + 4, true); r += 8;
        out.set(lz4(data.subarray(r, r + c), u), written); r += c; written += u;
      }
      buf = out;
    }
    const title = buf.toString('utf8').match(/"title"\s*:\s*"([^"]+)"/);
    if (title) console.log('标题:', title[1]);
    const general = buf.toString('utf8').match(/"general"\s*:\s*\{[^}]*"title"\s*:\s*"([^"]+)"/);
    if (general) console.log('general.title:', general[1]);
  }
  console.log('');
}
