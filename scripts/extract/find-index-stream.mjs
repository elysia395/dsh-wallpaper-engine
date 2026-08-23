// 找 demon_core MDL 中的索引流: 全文件扫描 u16/u32 小值连续段
import fs from 'fs';

for (const p of [
  'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/projects/defaultprojects/demon_core/models/core/core.mdl',
  'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/projects/defaultprojects/demon_core/models/backgroundsphere/backgroundsphere.mdl',
]) {
  const b = fs.readFileSync(p);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  console.log(`\n========== ${p.split('/').pop()} (${b.length}B) ==========`);
  const matStart = b.indexOf('materials/', 8);
  const matEnd = b.indexOf(0, matStart);
  const dataStart = matEnd + 1;
  console.log('dataStart:', dataStart);

  // u16 连续段: 找最长区间 [a, a+n*2) 内所有 u16 值 < maxIdx
  for (const maxIdx of [530, 1459, 2000, 3000, 60000]) {
    let bestStart = -1, bestLen = 0;
    let curStart = -1, curLen = 0;
    for (let o = dataStart; o + 2 <= b.length; o += 2) {
      const v = dv.getUint16(o, true);
      if (v < maxIdx) {
        if (curStart < 0) { curStart = o; curLen = 0; }
        curLen += 2;
        if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
      } else { curStart = -1; curLen = 0; }
    }
    if (bestLen > 200) console.log(`u16<${maxIdx}: run of ${bestLen} bytes @${bestStart} (${bestLen/2} indices, tri=${bestLen/6})`);
  }
  // u32 连续段
  for (const maxIdx of [530, 1459, 2000, 3000]) {
    let bestStart = -1, bestLen = 0;
    let curStart = -1, curLen = 0;
    for (let o = dataStart; o + 4 <= b.length; o += 4) {
      const v = dv.getUint32(o, true);
      if (v < maxIdx) {
        if (curStart < 0) { curStart = o; curLen = 0; }
        curLen += 4;
        if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
      } else { curStart = -1; curLen = 0; }
    }
    if (bestLen > 400) console.log(`u32<${maxIdx}: run of ${bestLen} bytes @${bestStart} (${bestLen/4} idx)`);
  }

  // 检查头部的子网格表假设: [nSubMesh][per mesh: {vertCount, idxCount, vertOff, idxOff}?]
  console.log('header u32s:', [0,1,2,3,4].map(i => `${dataStart + i*4}:${dv.getUint32(dataStart + i*4, true)}`).join(' '));
}
