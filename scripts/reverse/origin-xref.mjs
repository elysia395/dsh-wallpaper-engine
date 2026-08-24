// 找 "origin" (0x14048f4dc) 的 xref — 官方场景对象 origin 应用处
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
const targets = { 0x4048f4dc: 'origin', 0x40491f65: 'origin2', 0x40490c54: 'puppet', 0x4048daf8: 'g_Bones' };
for (let i = textSec.roff; i < textSec.roff + textSec.rsize - 7; i++) {
  if ((b[i] === 0x48 || b[i] === 0x4c) && b[i+1] === 0x8d) {
    const modrm = b[i+2];
    const mod = (modrm >> 6) & 3, rm = modrm & 7;
    if (mod === 0 && rm === 5) {
      const disp = b.readInt32LE(i + 3);
      const instrRva = textSec.vaddr + (i - textSec.roff);
      const target = (0x140000000 + instrRva + 7 + disp) & 0xffffffff;
      if (targets[target]) {
        console.log(`lea "${targets[target]}" @ 0x${(0x140000000 + instrRva).toString(16)}`);
      }
    }
  }
}
console.log('done');
