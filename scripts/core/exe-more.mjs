// wallpaper64.exe 更多格式线索: PKGV 版本 / tex-json / 其他魔数
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
  while ((idx = bytes.indexOf(b, idx + 1)) >= 0) { hits.push(idx); if (hits.length >= 6) break; }
  return hits;
};

// PKGV / pkg / tex-json / scene 相关
console.log('=== PKGV ===');
for (const h of find('PKGV')) console.log('  @' + h + ': ' + ascii(h - 20, 60).replace(/\s+/g, ' ').trim());
console.log('=== tex-json ===');
for (const h of find('tex-json')) console.log('  @' + h + ': ' + ascii(h - 40, 100).replace(/\s+/g, ' ').trim());
console.log('=== .pkg ===');
for (const h of find('.pkg')) console.log('  @' + h + ': ' + ascii(h - 30, 70).replace(/\s+/g, ' ').trim());
console.log('=== scene.json ===');
for (const h of find('scene.json')) console.log('  @' + h + ': ' + ascii(h - 30, 70).replace(/\s+/g, ' ').trim());
console.log('=== resourcecompiler 命令 ===');
for (const h of find('resourcecompiler')) console.log('  @' + h + ': ' + ascii(h - 10, 80).replace(/\s+/g, ' ').trim());
console.log('=== 错误消息 (Cannot/Invalid/Failed/Unsupported) ===');
const strs = [];
let cur = '';
for (const b of bytes) {
  if (b >= 32 && b <= 126) cur += String.fromCharCode(b);
  else { if (cur.length >= 8 && /(Cannot|Invalid|Failed|Unsupported|Error|version|not supported|corrupt|missing)/i.test(cur)) strs.push(cur); cur = ''; }
}
strs.slice(0, 30).forEach((s) => console.log('  ' + s));
