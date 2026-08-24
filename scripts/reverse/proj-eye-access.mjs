// 深挖 0x140183a70 投影构造函数: 入口参数 + 0x31bc 字段含义
// 通过反汇编 0x140183a70-0x140183b40 的完整上下文 (之前只看了片段)
// 这里转储该区域, 重点: movss 0x31bc/0x31c0/0x31c8 与 0x84/0x88 的关系
import fs from 'node:fs';
// 直接打印相关指令 (从 .text 提取)
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
// 找 0x140183a70 附近的 movss [reg+0x84/0x88/0x31bc/0x31c0/0x31c8/0x354/0x358]
const start = 0x140183a70 - 0x140000000 - textSec.vaddr + textSec.roff;
const end = 0x140183dc0 - 0x140000000 - textSec.vaddr + textSec.roff;
console.log('区域 0x140183a70-0x140183dc0 中的关键内存访问:');
for (let i = start; i < end - 7 && i < textSec.roff + textSec.rsize; i++) {
  // movss xmm, [reg+disp8/32] / movss [reg+disp], xmm: f3 0f 10 / f3 0f 11
  if (b[i] === 0xf3 && b[i+1] === 0x0f && (b[i+2] === 0x10 || b[i+2] === 0x11)) {
    const modrm = b[i+3];
    const mod = (modrm >> 6) & 3, rm = modrm & 7;
    let disp = null, len = 4;
    if (mod === 1) { disp = b[i+4]; len = 5; }
    else if (mod === 2) { disp = b.readInt32LE(i+4); len = 8; }
    else if (mod === 0 && rm === 5) { disp = b.readInt32LE(i+4); len = 8; }
    if (disp != null && [0x84, 0x88, 0x31bc, 0x31c0, 0x31c8, 0x354, 0x358, 0x14c, 0x150, 0x148, 0x124, 0x128, 0x31b8, 0x31cc, 0x31d0].includes(disp)) {
      const va = 0x140000000 + textSec.vaddr + (i - textSec.roff);
      const op = b[i+2] === 0x10 ? 'movss xmm,[r+' : 'movss [r+';
      console.log(`0x${va.toString(16)}: ${op}0x${disp.toString(16)}] (modrm 0x${modrm.toString(16)} reg=${(modrm>>3)&7})`);
    }
  }
}
console.log('done');
