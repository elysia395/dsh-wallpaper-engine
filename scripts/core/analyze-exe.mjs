// wallpaper64.exe 字符串分析: 找格式魔数位置 + MDLE/TEXV0004 上下文
import fs from 'node:fs';

const bytes = fs.readFileSync('C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/wallpaper64.exe');
const ascii = (o, n) => {
  let s = '';
  for (let i = o; i < o + n && i < bytes.length; i++) {
    const b = bytes[i];
    s += b >= 32 && b <= 126 ? String.fromCharCode(b) : '.';
  }
  return s;
};
const find = (target) => {
  const hits = [];
  const b = Buffer.from(target, 'ascii');
  let idx = -1;
  while ((idx = bytes.indexOf(b, idx + 1)) >= 0) { hits.push(idx); if (hits.length >= 8) break; }
  return hits;
};

for (const t of ['MDLE0002', 'TEXV0004', 'MDLVS001', 'MDLV0021', 'TEXB0003', 'MDLV0014', 'MDLV0024']) {
  const hits = find(t);
  console.log(t + ': ' + hits.length + ' 处 ' + hits.map(h => '@' + h + ' [' + ascii(h - 40, 100).replace(/\s+/g, ' ').trim() + ']').join('\n  '));
}

// 全部 MDL 相关魔数
console.log('\n=== 全部魔数扫描 ===');
for (const t of ['MDLV', 'MDLS', 'MDLA', 'MDLE', 'MDLVS', 'TEXV', 'TEXI', 'TEXB', 'TEXS', 'TEX0', 'PKGV', 'SCND', 'WECM']) {
  const hits = find(t + '00');
  if (hits.length) console.log(t + '00: ' + hits.length + ' 处 @' + hits.slice(0, 6).join(','));
}
