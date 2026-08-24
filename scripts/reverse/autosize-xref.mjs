// 找 "autosize" (0x140490bf8) xref
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
const targets = {};
for (const rva of [0x490bf8, 0x490be8, 0x490c00]) targets[(0x140000000 + rva) & 0xffffffff] = `str@0x${rva.toString(16)}`;
for (let i = textSec.roff; i < textSec.roff + textSec.rsize - 7; i++) {
  if ((b[i] === 0x48 || b[i] === 0x4c) && b[i+1] === 0x8d) {
    const modrm = b[i+2];
    const mod = (modrm >> 6) & 3, rm = modrm & 7;
    if (mod === 0 && rm === 5) {
      const disp = b.readInt32LE(i + 3);
      const instrRva = textSec.vaddr + (i - textSec.roff);
      const target = (0x140000000 + instrRva + 7 + disp) & 0xffffffff;
      if (targets[target]) {
        console.log(`lea ${targets[target]} @ 0x${(0x140000000 + instrRva).toString(16)}`);
      }
    }
  }
}
console.log('done');
