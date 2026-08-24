// 重新检查官方 cropoffset: 搜索 crop 相关字符串 + 头 MDL 是否含 crop 信息
import fs from 'node:fs';
const b = fs.readFileSync('C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/wallpaper64.exe');
const latin = b.toString('latin1');
for (const n of ['crop', 'Crop', 'CROP', 'offset', 'Offset']) {
  let idx = -1, cnt = 0;
  const hits = [];
  while ((idx = latin.indexOf(n, idx + 1)) >= 0 && cnt < 10) {
    if (idx >= 0x424e00 && idx < 0x4da000) { hits.push(idx); cnt++; }
  }
  if (hits.length) console.log(`"${n}": ${hits.length}处: ` + hits.slice(0, 8).map(h => `0x${(0x426000 + (h - 0x424e00)).toString(16)}`).join(' '));
  else console.log(`"${n}": 未找到`);
}
