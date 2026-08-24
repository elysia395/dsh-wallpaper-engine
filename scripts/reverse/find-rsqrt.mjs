// 搜索官方 view 矩阵构造 (lookAt): 特征 = cross product (mulps/subps) + normalize (rsqrtps/divps)
// 在 0x140186xxx-0x140188xxx 相机区域搜索
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
// 找 0x140186000-0x140188000 区域的 rsqrtps (0f 52) 或 divss 归一化 + 相邻 mulps/subps 叉积
console.log('rsqrtps 位置 (0x140186000-0x14018a000):');
for (let i = textSec.roff; i < textSec.roff + textSec.rsize - 3; i++) {
  const va = 0x140000000 + textSec.vaddr + (i - textSec.roff);
  if (va < 0x140186000 || va > 0x14018a000) continue;
  if (b[i] === 0x0f && b[i+1] === 0x52) { // rsqrtps
    console.log(`  0x${va.toString(16)}: rsqrtps`);
  }
  if (b[i] === 0x0f && b[i+1] === 0x51) { // sqrtps
    console.log(`  0x${va.toString(16)}: sqrtps`);
  }
}
console.log('done');
