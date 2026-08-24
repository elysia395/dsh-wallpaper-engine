// 找 0x11c 字段 bit1 的设置 — puppet vs image 标志
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
// 搜 [r+0x11c] 访问 (testb/mov/or)
console.log('0x11c 字段访问:');
for (let i = textSec.roff; i < textSec.roff + textSec.rsize - 7; i++) {
  const va = 0x140000000 + textSec.vaddr + (i - textSec.roff);
  const b0 = b[i];
  // testb $imm8,[r+0x11c]: f6 8? disp32 imm8 / f6 4? ...
  // orl $imm,[r+0x11c]: 81 8? disp32 imm32 / 83 8? disp8 imm8
  // mov [r+0x11c]: 8b/89 8? disp32
  if ((b0 === 0xf6 || b0 === 0x81 || b0 === 0x83 || b0 === 0x8b || b0 === 0x89) && i + 6 < textSec.roff + textSec.rsize) {
    const disp = b.readUInt32LE(i + 2);
    if (disp === 0x11c) {
      const op = b0 === 0xf6 ? 'test' : (b0 === 0x81 ? 'or32' : (b0 === 0x83 ? 'or8' : (b0 === 0x8b ? 'mov-r' : 'mov-w')));
      console.log(`  0x${va.toString(16)}: ${op} [r+0x11c] (b0=0x${b0.toString(16)} b1=0x${b[i+1].toString(16)})`);
    }
  }
}
console.log('done');
