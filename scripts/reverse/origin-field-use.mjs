// 找官方 image 顶点生成: origin → 顶点位置 (左/右/顶/底)
// 特征: origin ± size/2 或场景尺寸/2 相关
// 搜索官方 exe 中 "size" 解析后的顶点构造 (0x1401e6xxx 对象渲染区)
// 先看 0x1401e8947 (0x304 mov) 区域是否对象渲染
import fs from 'node:fs';
// 找 0x1401e8xxx 区域的关键 movss/mulss (顶点计算)
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
// 搜 movss [r+0x340/0x344] 等 (对象 origin 字段) 在 0x1401e6xxx-0x1401f1xxx 区域的读取
console.log('对象 origin 字段 (0x340-0x34c) 在 0x1401e0000-0x1401f2000 的访问:');
for (let i = textSec.roff; i < textSec.roff + textSec.rsize - 6; i++) {
  const va = 0x140000000 + textSec.vaddr + (i - textSec.roff);
  if (va < 0x1401e0000 || va > 0x1401f2000) continue;
  if (b[i] === 0xf3 && b[i+1] === 0x0f && (b[i+2] === 0x10 || b[i+2] === 0x11)) {
    const modrm = b[i+3];
    const mod = (modrm >> 6) & 3;
    let disp = null;
    if (mod === 1) disp = b[i+4];
    else if (mod === 2) disp = b.readInt32LE(i+4);
    if (disp != null && [0x340, 0x344, 0x348, 0x34c, 0x350, 0x354, 0x358].includes(disp)) {
      console.log(`  0x${va.toString(16)}: ${b[i+2]===0x10?'读':'写'} [r+0x${disp.toString(16)}]`);
    }
  }
}
console.log('done');
