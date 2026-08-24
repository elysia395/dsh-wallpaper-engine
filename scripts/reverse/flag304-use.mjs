// 找官方 0x304 标志位 (fullscreen=0x2, passthrough=0x4) 的所有使用
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
// 找 [reg+0x304] 访问: 8b 87 04 03 00 00 (mov eax,[rdi+0x304]) / f6 87 04 03 00 00 xx (testb)
console.log('0x304 标志访问:');
for (let i = textSec.roff; i < textSec.roff + textSec.rsize - 7; i++) {
  const va = 0x140000000 + textSec.vaddr + (i - textSec.roff);
  // mov reg,[r+0x304]: 8b / 8d / f6 / 81 带 04 03 00 00
  const b0 = b[i];
  const isTest = b0 === 0xf6 || b0 === 0xf7;
  const isMov = b0 === 0x8b || b0 === 0x8d || b0 === 0x83 || b0 === 0x81;
  if ((isTest || isMov) && i + 6 < textSec.roff + textSec.rsize) {
    const disp = b.readUInt32LE(i + 2);
    if (disp === 0x304) {
      const op = isTest ? 'test' : (b0 === 0x8b ? 'mov' : (b0 === 0x83 || b0 === 0x81 ? 'op' : '?'));
      console.log(`  0x${va.toString(16)}: ${op} [r+0x304] (b0=0x${b0.toString(16)} b1=0x${b[i+1].toString(16)})`);
    }
  }
}
console.log('done');
