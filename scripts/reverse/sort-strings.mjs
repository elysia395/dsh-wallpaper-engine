// 搜 wallpaper64.exe 排序相关字符串
import fs from 'node:fs';
const b = fs.readFileSync('C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/wallpaper64.exe');
const text = b.toString('latin1');
// 提取字符串 (rdata 区 0x424e00-0x4da000)
const start = 0x424e00, end = 0x4da000;
const strs = [];
let cur = '';
for (let i = start; i < end; i++) {
  const c = b[i];
  if (c >= 0x20 && c <= 0x7e) cur += String.fromCharCode(c);
  else {
    if (cur.length >= 4) strs.push(cur);
    cur = '';
  }
}
// 排序/顺序相关
const kws = ['sort', 'order', 'depth', 'zsort', 'parallax', 'layer', 'priority', 'draw'];
for (const k of kws) {
  const hits = strs.filter(s => s.toLowerCase().includes(k));
  console.log(`=== ${k} (${hits.length}) ===`);
  hits.slice(0, 12).forEach(s => console.log(`  "${s}"`));
}
