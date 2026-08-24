// 找官方 MDL (MDLV0023) 解析与顶点位置生成 — 0x140492318 "MDLV0023"
// 以及 puppet 顶点定位 (origin 应用)
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
// MDLV0023 字符串 (0x140492318) xref — 找 cmp/mov 引用 (通常 lea 后 cmp)
const target = (0x140000000 + 0x492318) & 0xffffffff;
console.log('MDLV0023 引用:');
for (let i = textSec.roff; i < textSec.roff + textSec.rsize - 7; i++) {
  // lea reg,[rip+disp]
  if ((b[i] === 0x48 || b[i] === 0x4c) && b[i+1] === 0x8d) {
    const modrm = b[i+2];
    const mod = (modrm >> 6) & 3, rm = modrm & 7;
    if (mod === 0 && rm === 5) {
      const disp = b.readInt32LE(i + 3);
      const instrRva = textSec.vaddr + (i - textSec.roff);
      const t = (0x140000000 + instrRva + 7 + disp) & 0xffffffff;
      if (t === target) console.log(`  lea @ 0x${(0x140000000 + instrRva).toString(16)}`);
    }
  }
  // movabs rax, imm64
  if (b[i] === 0x48 && b[i+1] === 0xb8) {
    const lo = b.readUInt32LE(i + 2), hi = b.readUInt32LE(i + 6);
    const t = (BigInt(hi) << 32n) | BigInt(lo);
    if (t === BigInt(0x140000000 + 0x492318)) {
      const instrRva = textSec.vaddr + (i - textSec.roff);
      console.log(`  movabs @ 0x${(0x140000000 + instrRva).toString(16)}`);
    }
  }
}
console.log('done');
