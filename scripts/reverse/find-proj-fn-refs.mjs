// 找 0x140183a70 的引用: vtable 槽 / 间接调用 / lea
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
function rvaToFile(rva) {
  const s = secs.find(x => rva >= x.vaddr && rva < x.vaddr + x.vsize);
  return s ? s.roff + (rva - s.vaddr) : -1;
}
const target = 0x140183a70;
// 1. .rdata 中 4 字节/8 字节值 = target (vtable 槽)
for (const s of secs) {
  if (!s.name.startsWith('.rdata')) continue;
  for (let i = s.roff; i < s.roff + s.rsize - 4; i++) {
    const v32 = b.readUInt32LE(i);
    if (v32 === (target & 0xffffffff)) {
      const rva = s.vaddr + (i - s.roff);
      console.log(`.rdata 0x${(0x140000000 + rva).toString(16)}: dword = 0x${target.toString(16)}`);
    }
    if (i + 8 <= s.roff + s.rsize) {
      const lo = b.readUInt32LE(i), hi = b.readUInt32LE(i + 4);
      if (lo === (target & 0xffffffff) && hi === 0) {
        const rva = s.vaddr + (i - s.roff);
        console.log(`.rdata 0x${(0x140000000 + rva).toString(16)}: qword = 0x${target.toString(16)}`);
      }
    }
  }
}
// 2. .text 中 lea rax,[rip+disp] → target
const textSec = secs.find(s => s.name === '.text');
for (let i = textSec.roff; i < textSec.roff + textSec.rsize - 7; i++) {
  if ((b[i] === 0x48 || b[i] === 0x4c) && b[i+1] === 0x8d) {
    const modrm = b[i+2];
    const mod = (modrm >> 6) & 3, rm = modrm & 7;
    if (mod === 0 && rm === 5) {
      const disp = b.readInt32LE(i + 3);
      const instrRva = textSec.vaddr + (i - textSec.roff);
      const t = (0x140000000 + instrRva + 7 + disp) & 0xffffffff;
      if (t === (target & 0xffffffff)) {
        console.log(`.text lea @ 0x${(0x140000000 + instrRva).toString(16)} → 0x${target.toString(16)}`);
      }
    }
  }
}
console.log('done');
