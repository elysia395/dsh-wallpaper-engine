// 找对象 rsi+0x340 区域 (4x4 矩阵 M) 的写入点 — 确认 M 的内容
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
// movups/movss [r+0x340-0x37f] 写入 (0f 11 / f3 0f 11)
console.log('对象矩阵区 (0x340-0x37f) 写入点:');
let cnt = 0;
for (let i = textSec.roff; i < textSec.roff + textSec.rsize - 8; i++) {
  const b0 = b[i];
  const isMovups = b0 === 0x0f && b[i+1] === 0x11;
  const isMovss = b0 === 0xf3 && b[i+1] === 0x0f && b[i+2] === 0x11;
  if (!isMovups && !isMovss) continue;
  const modrm = b[i + (isMovups ? 2 : 3)];
  const mod = (modrm >> 6) & 3;
  let disp = null;
  if (mod === 1) disp = b[i + (isMovups ? 3 : 4)];
  else if (mod === 2) disp = b.readInt32LE(i + (isMovups ? 3 : 4));
  if (disp != null && disp >= 0x340 && disp <= 0x37f) {
    const va = 0x140000000 + textSec.vaddr + (i - textSec.roff);
    console.log(`  0x${va.toString(16)}: ${isMovups?'movups':'movss'} [r+0x${disp.toString(16)}]`);
    cnt++;
    if (cnt > 25) break;
  }
}
console.log(`前${Math.min(cnt,25)}个`);
