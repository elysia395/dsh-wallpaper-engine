// 找官方 0x304 标志 0x1100 (0x1000|0x100) 的设置 — 背景/全屏对象标记
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
// 搜 orl $0x1000 / orl $0x100 / 或 0x1100 写入 0x304
console.log('0x304 标志设置 (orl 0x10xx):');
for (let i = textSec.roff; i < textSec.roff + textSec.rsize - 8; i++) {
  // 81 8? xx xx xx xx 00 10 00 00 (orl $imm32,[r+0x304]) 或 83 8? xx 00 10 (orl $imm8)
  const b0 = b[i];
  if (b0 === 0x81 && (b[i+1] & 0x38) === 0x08) {
    const disp = b.readUInt32LE(i + 2);
    const imm = b.readUInt32LE(i + 6);
    if (disp === 0x304 && (imm & 0x1100)) {
      const va = 0x140000000 + textSec.vaddr + (i - textSec.roff);
      console.log(`  0x${va.toString(16)}: orl $0x${imm.toString(16)},[r+0x304]`);
    }
  }
  if (b0 === 0x83 && (b[i+1] & 0x38) === 0x08) {
    const disp = b[i+2];
    const imm = b[i+3];
    if (disp === 0x304 && (imm & 0x0f) && [0x10, 0x08].includes(imm & 0x10 ? 0x10 : imm)) {
      // imm8 sign-extended; 0x10 = 0x10, 0x08 = 0x08
    }
  }
  // 也搜 testl $0x1100
  if (b0 === 0xf7 && (b[i+1] & 0x38) === 0x00) {
    const disp = b.readUInt32LE(i + 2);
    const imm = b.readUInt32LE(i + 6);
    if (disp === 0x304 && (imm & 0x1100)) {
      const va = 0x140000000 + textSec.vaddr + (i - textSec.roff);
      console.log(`  0x${va.toString(16)}: testl $0x${imm.toString(16)},[r+0x304]`);
    }
  }
}
console.log('done');
