// 修正 imul 搜索: 69 /r imm32 (Reg 模式 modrm 0xc0-0xff, imm32 在 i+2)
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
function va(i) { return 0x140000000 + textSec.vaddr + (i - textSec.roff); }
// 关键立即数: 36(0x24帧), 240(0xf0动画记录), 9(0x9列), 8(骨骼pos?), 32, 48(float4x3?)
const targets = { 36: [], 240: [], 9: [], 32: [], 48: [] };
for (let i = textSec.roff; i < textSec.roff + textSec.rsize - 7; i++) {
  if (b[i] === 0x69 && (b[i+1] & 0xc0) === 0xc0) {
    const imm = b.readInt32LE(i + 2);
    for (const [k, arr] of Object.entries(targets)) {
      if (imm === Number(k) && arr.length < 8) arr.push(va(i));
    }
  }
  // 也搜 48 69 /r imm32 (REX.W)
  if (b[i] === 0x48 && b[i+1] === 0x69 && (b[i+2] & 0xc0) === 0xc0) {
    const imm = b.readInt32LE(i + 3);
    for (const [k, arr] of Object.entries(targets)) {
      if (imm === Number(k) && arr.length < 8) arr.push(va(i));
    }
  }
}
for (const [k, arr] of Object.entries(targets)) {
  console.log(`imul imm=${k}: ${arr.length} 处`);
  arr.forEach(a => console.log(`  0x${a.toString(16)}`));
}
