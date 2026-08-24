// 找 0x14023a980 (对象→屏幕变换) 的调用者
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
const targets = [0x14023a980, 0x14023a700, 0x14023a500, 0x14023a2d0, 0x140240279, 0x14023fe80];
for (let i = textSec.roff; i < textSec.roff + textSec.rsize - 5; i++) {
  if (b[i] === 0xe8) {
    const disp = b.readInt32LE(i + 1);
    const instrRva = textSec.vaddr + (i - textSec.roff);
    const target = (0x140000000 + instrRva + 5 + disp) & 0xffffffff;
    if (targets.includes(target)) {
      console.log(`call 0x${target.toString(16)} @ 0x${(0x140000000 + instrRva).toString(16)}`);
    }
  }
}
console.log('done');
