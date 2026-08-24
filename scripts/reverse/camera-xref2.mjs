// 找相机字段字符串的完整 xref (所有 lea/mov 寻址模式 + 直接字符串引用)
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
const targets = {
  0x4048e4d0: 'camera', 0x4048e594: 'center', 0x4048e59c: 'eye',
  0x4048e5ec: 'up', 0x4048e880: 'fov', 0x4048e8d4: 'farz', 0x4048e8dc: 'nearz',
  0x4048e8e8: 'perspectiveoverridefov', 0x4048e928: 'customsortorder', 0x4048e938: 'transparentsorting'
};
// 扫描所有指令: 找 4 字节位移指向 target 的 (lea 48 8d / 4c 8d / mov 48 8b/8d 等)
const found = new Map();
for (let i = textSec.roff; i < textSec.roff + textSec.rsize - 7; i++) {
  // 检查这条指令是否有 disp32 指向 target
  // 模式1: lea r64,[rip+disp32]: 48/4c 8d /r, modrm mod=00 rm=101, disp32
  // 模式2: mov r64,[rip+disp32]: 48 8b /r 同上
  const b0 = b[i];
  if ((b0 === 0x48 || b0 === 0x4c) && (b[i+1] === 0x8d || b[i+1] === 0x8b)) {
    const modrm = b[i+2];
    const mod = (modrm >> 6) & 3, rm = modrm & 7;
    if (mod === 0 && rm === 5) {
      const disp = b.readInt32LE(i + 3);
      const instrRva = textSec.vaddr + (i - textSec.roff);
      const target = (0x140000000 + instrRva + 7 + disp) & 0xffffffff;
      if (targets[target]) {
        const key = target;
        if (!found.has(key)) found.set(key, []);
        found.get(key).push(0x140000000 + instrRva);
      }
    }
  }
}
for (const [va, name] of Object.entries(targets)) {
  const hits = found.get(parseInt(va)) || [];
  console.log(`"${name}" (0x${va}): ${hits.length} 处 xref`);
  hits.slice(0, 10).forEach(h => console.log(`  0x${h.toString(16)}`));
}
