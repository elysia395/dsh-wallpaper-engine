// 找官方 puppet 定位: "puppet" 字符串 + g_Bones shader + 顶点缓冲更新
import fs from 'node:fs';
const b = fs.readFileSync('C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/wallpaper64.exe');
const latin = b.toString('latin1');
for (const n of ['puppet', 'g_Bones', 'Bones', 'skinning', 'a_Position', 'raw', 'origin', 'MDL', 'mdl']) {
  let idx = -1, cnt = 0;
  const hits = [];
  while ((idx = latin.indexOf(n, idx + 1)) >= 0 && cnt < 10) {
    if (idx >= 0x424e00 && idx < 0x4da000) { hits.push(idx); cnt++; }
  }
  if (hits.length) console.log(`"${n}": ${hits.length}处: ` + hits.slice(0, 6).map(h => `0x${(0x426000 + (h - 0x424e00)).toString(16)}`).join(' '));
}
