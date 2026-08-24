// 搜 imul $0x24 (36=帧大小) 和 imul $0x9 (9列) — 骨骼帧读取特征
import fs from 'node:fs';
const b = fs.readFileSync('C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/wallpaper64.exe');
const peOff = b.readUInt32LE(0x3c);
const numSec = b.readUInt16LE(peOff + 6);
const optSize = b.readUInt16LE(peOff + 20);
const optOff = peOff + 24;
const secOff = optOff + optSize;
const secs = [];
for (let i = 0; i < numSec; i++) {
  const so = secOff + i * 40;
  secs.push({ name: b.toString('ascii', so, so + 8).replace(/\0/g, ''), vaddr: b.readUInt32LE(so + 12), vsize: b.readUInt32LE(so + 8), roff: b.readUInt32LE(so + 20), rsize: b.readUInt32LE(so + 16) });
}
const textSec = secs.find(s => s.name === '.text');
// imul reg, reg, 0x24: 69 c0 24 00 00 00 / 69 c9 24 ... (69 /r imm32)
// imul reg, 0x24: 6b c0 24 (6b /r imm8)
let count24 = 0, count9 = 0;
console.log('imul $0x24 (36B/帧):');
for (let i = textSec.roff; i < textSec.roff + textSec.rsize - 4; i++) {
  if (b[i] === 0x69 && b[i+3] === 0x24 && b[i+4] === 0 && b[i+5] === 0 && b[i+6] === 0) {
    const va = 0x140000000 + textSec.vaddr + (i - textSec.roff);
    console.log(`  0x${va.toString(16)}: ${b[i+1].toString(16)}`);
    count24++;
    if (count24 > 20) break;
  }
  // 6b reg, 0x24 (imm8)
  if (b[i] === 0x6b && b[i+2] === 0x24) {
    const va = 0x140000000 + textSec.vaddr + (i - textSec.roff);
    console.log(`  (imm8) 0x${va.toString(16)}: ${b[i+1].toString(16)}`);
    count24++;
    if (count24 > 30) break;
  }
}
console.log(`imul $0x24 总数(前20): ${count24}`);
// 也搜 imul reg,reg,0x9 (9列) 和 imul $0xf0 (240 动画记录)
console.log('imul $0xf0 (240=动画记录):');
let cf = 0;
for (let i = textSec.roff; i < textSec.roff + textSec.rsize - 4; i++) {
  if (b[i] === 0x69 && b[i+3] === 0xf0 && b[i+4] === 0 && b[i+5] === 0 && b[i+6] === 0) {
    const va = 0x140000000 + textSec.vaddr + (i - textSec.roff);
    console.log(`  0x${va.toString(16)}`);
    cf++;
    if (cf > 10) break;
  }
}
console.log(`imul $0xf0 总数: ${cf}`);
