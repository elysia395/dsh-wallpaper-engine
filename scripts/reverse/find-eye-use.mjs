// 搜 eye 字段 (相机 0x124) 的读取 — 投影矩阵构造
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
// movss xmm, [reg+0x124/0x128/0x12c] — eye.x/y/z 读取: f3 0f 10 40 124 / f3 0f 10 41 124 等
// 以及 movss [reg+0x124], xmm (写)
console.log('eye 字段 (0x124/0x128/0x12c) 的 movss 读取:');
let cnt = 0;
for (let i = textSec.roff; i < textSec.roff + textSec.rsize - 5; i++) {
  // f3 0f 10 /r (movss xmm, r/m32) — modrm 00/01/10 + disp8/32
  if (b[i] === 0xf3 && b[i+1] === 0x0f && b[i+2] === 0x10) {
    const modrm = b[i+3];
    const mod = (modrm >> 6) & 3, rm = modrm & 7;
    let disp = null;
    if (mod === 1) disp = b[i+4];
    else if (mod === 2) disp = b.readInt32LE(i+4);
    if ([0x124, 0x128, 0x12c].includes(disp)) {
      const va = 0x140000000 + textSec.vaddr + (i - textSec.roff);
      console.log(`  0x${va.toString(16)}: movss xmm, [reg+0x${disp.toString(16)}] (modrm 0x${modrm.toString(16)})`);
      cnt++;
      if (cnt > 15) break;
    }
  }
}
console.log(`总数(前15): ${cnt}`);
// 也搜 0x354 (投影宽度) 的使用
console.log('投影宽度 (0x354) 的 movss 使用:');
cnt = 0;
for (let i = textSec.roff; i < textSec.roff + textSec.rsize - 5; i++) {
  if (b[i] === 0xf3 && b[i+1] === 0x0f && (b[i+2] === 0x10 || b[i+2] === 0x11)) {
    const modrm = b[i+3];
    const mod = (modrm >> 6) & 3;
    let disp = null;
    if (mod === 1) disp = b[i+4];
    else if (mod === 2) disp = b.readInt32LE(i+4);
    if (disp === 0x354) {
      const va = 0x140000000 + textSec.vaddr + (i - textSec.roff);
      console.log(`  0x${va.toString(16)}: (opcode 0x${b[i+2].toString(16)}) [reg+0x354]`);
      cnt++;
      if (cnt > 12) break;
    }
  }
}
console.log(`0x354 总数: ${cnt}`);
