// 找 camera 字段解析 (eye/center/up 字符串) + xref
import fs from 'node:fs';
const b = fs.readFileSync('C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/wallpaper64.exe');
const latin = b.toString('latin1');
// rdata 段大约 0x424e00-0x4da000 (文件偏移)
for (const n of ['eye', 'center', 'up', 'projection', 'orthogonal', 'camera', 'nearz', 'farz', 'fov', 'perspective']) {
  let idx = -1, cnt = 0;
  const hits = [];
  while ((idx = latin.indexOf(n, idx + 1)) >= 0 && cnt < 20) {
    if (idx >= 0x424e00 && idx < 0x4da000) {
      hits.push(idx);
      cnt++;
    }
  }
  if (hits.length) {
    console.log(`"${n}": ${hits.length} 处`);
    hits.slice(0, 8).forEach(h => console.log(`  文件 0x${h.toString(16)} RVA 0x${(0x426000 + (h - 0x424e00)).toString(16)} VA 0x${(0x140000000 + 0x426000 + (h - 0x424e00)).toString(16)}`));
  }
}
