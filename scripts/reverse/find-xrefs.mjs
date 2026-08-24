// 扫描 .text 找引用目标 RVA 的 lea [rip+disp] 指令
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
  secs.push({
    name: b.toString('ascii', so, so + 8).replace(/\0/g, ''),
    vaddr: b.readUInt32LE(so + 12),
    vsize: b.readUInt32LE(so + 8),
    roff: b.readUInt32LE(so + 20),
    rsize: b.readUInt32LE(so + 16),
  });
}
const text = secs.find(s => s.name === '.text');
// 目标 RVA (rdata 字符串)
const targets = {
  'MDLA0006': 0x4920f0,
  'animationlayers': 0x490c08,
  'puppet': 0x490c54,
  'MDLS0004': 0x492130,
  'MDLV0023': 0x492318,
};
// 指令地址 (文件偏移 → RVA)
function fileToRva(off) {
  const s = secs.find(x => off >= x.roff && off < x.roff + x.rsize);
  return s ? s.vaddr + (off - s.roff) : -1;
}
// 扫描 lea r64, [rip+disp32]: 48 8d /r 其中 ModRM = 05 (rip+disp32)
// 以及 mov r64, [rip+disp]: 48 8b 05
const results = {};
for (const [name, targetRva] of Object.entries(targets)) results[name] = [];
const textStart = text.roff, textEnd = text.roff + text.rsize;
for (let i = textStart; i < textEnd - 7; i++) {
  const byte = b[i];
  // 48 8d 05 / 48 8d 0d / 48 8d 15 / 48 8d 1d / 48 8b 05 / 48 8d 25 (rip-rel)
  if (byte === 0x48 && (b[i+1] === 0x8d || b[i+1] === 0x8b) && (b[i+2] & 0xc7) === 0x05) {
    const disp = b.readInt32LE(i + 3);
    const instrRva = fileToRva(i);
    if (instrRva < 0) continue;
    const target = (instrRva + 7 + disp) & 0xffffffff;
    for (const [name, t] of Object.entries(targets)) {
      if (target === t) results[name].push({ fileOff: i, rva: instrRva });
    }
  }
  // 也扫 4C 8d 05 (lea r8-r15)
  if ((byte === 0x4c || byte === 0x44) && b[i+1] === 0x8d && (b[i+2] & 0xc7) === 0x05) {
    const disp = b.readInt32LE(i + 3);
    const instrRva = fileToRva(i);
    if (instrRva < 0) continue;
    const target = (instrRva + 7 + disp) & 0xffffffff;
    for (const [name, t] of Object.entries(targets)) {
      if (target === t) results[name].push({ fileOff: i, rva: instrRva });
    }
  }
}
for (const [name, hits] of Object.entries(results)) {
  console.log(`${name}: ${hits.length} 处引用`);
  hits.slice(0, 6).forEach(h => console.log(`  file=0x${h.fileOff.toString(16)} rva=0x${h.rva.toString(16)}`));
}
