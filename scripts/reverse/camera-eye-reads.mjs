// 找相机对象 eye@0x118/0x11c/0x120 的读取者 (场景相机)
// 以及相机对象 center 存储偏移
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
// 找 0x118/0x11c/0x120 的 movss 读取 (相机 eye)
console.log('相机 eye (0x118/0x11c/0x120) movss 读取:');
let cnt = 0;
for (let i = textSec.roff; i < textSec.roff + textSec.rsize - 6; i++) {
  if (b[i] === 0xf3 && b[i+1] === 0x0f && b[i+2] === 0x10) {
    const modrm = b[i+3];
    const mod = (modrm >> 6) & 3;
    let disp = null;
    if (mod === 1) disp = b[i+4];
    else if (mod === 2) disp = b.readInt32LE(i+4);
    if ([0x118, 0x11c, 0x120, 0x124, 0x128, 0x12c].includes(disp)) {
      const va = 0x140000000 + textSec.vaddr + (i - textSec.roff);
      console.log(`  0x${va.toString(16)}: movss [r+0x${disp.toString(16)}]`);
      cnt++;
    }
  }
}
console.log(`总数: ${cnt}`);
console.log('done');
