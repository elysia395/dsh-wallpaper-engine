// 搜官方 exe 中背景/全屏渲染特殊处理的字符串 + 对象类型分派
import fs from 'node:fs';
const b = fs.readFileSync('C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/wallpaper64.exe');
const latin = b.toString('latin1');
for (const n of ['background', 'fullscreen', 'Background', 'Fullscreen', 'bgimage', 'scenebackground', 'passthrough', 'autosize', 'isBackground', 'screenPos']) {
  let idx = -1, cnt = 0;
  const hits = [];
  while ((idx = latin.indexOf(n, idx + 1)) >= 0 && cnt < 8) {
    if (idx >= 0x424e00 && idx < 0x4da000) { hits.push(idx); cnt++; }
  }
  if (hits.length) console.log(`"${n}": ${hits.length}处 rdata: ` + hits.map(h => `0x${(0x426000 + (h - 0x424e00)).toString(16)}`).join(' '));
  else console.log(`"${n}": 未找到`);
}
