// 找 camera 字段字符串 (0x14048e4d0 附近) 的 lea xref
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
const targets = [0x14048e59c, 0x14048e4d0, 0x14048e8c8, 0x14048e918, 0x14048e968]; // eye, camera, camera?, up?, ...
const targetNames = { 0x14048e59c: 'eye', 0x14048e4d0: 'camera', 0x14048e8c8: 'cam?', 0x14048e918: 'cam?', 0x14048e968: 'cam?' };
// lea reg, [rip+disp32] : 48 8d xx / 4c 8d xx, disp32 at +3
for (let i = textSec.roff; i < textSec.roff + textSec.rsize - 7; i++) {
  if ((b[i] === 0x48 || b[i] === 0x4c) && b[i+1] === 0x8d) {
    const modrm = b[i+2];
    const mod = (modrm >> 6) & 3, rm = modrm & 7;
    if (mod === 0 && rm === 5) {
      const disp = b.readInt32LE(i + 3);
      const instrRva = textSec.vaddr + (i - textSec.roff);
      const target = (0x140000000 + instrRva + 7 + disp) & 0xffffffff;
      if (targets.includes(target)) {
        console.log(`lea @ 0x${(0x140000000 + instrRva).toString(16)} → ${targetNames[target]} (0x${target.toString(16)})`);
      }
    }
  }
}
console.log('done');
