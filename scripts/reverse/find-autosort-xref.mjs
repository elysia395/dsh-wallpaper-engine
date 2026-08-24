// 找 autosort (0x490c18) 和 PUED0002 (0x490c60) 的 xref
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
const text = secs.find(s => s.name === '.text');
function fileToRva(off) {
  const s = secs.find(x => off >= x.roff && off < x.roff + x.rsize);
  return s ? s.vaddr + (off - s.roff) : -1;
}
const targets = {
  'autosort': 0x490c18,
  'PUED0002': 0x490c60,
  'REFLECTION': 0x490c2c,
  'genericimage2': 0x490c38,
};
const results = {};
for (const [name, t] of Object.entries(targets)) results[name] = [];
for (let i = text.roff; i < text.roff + text.rsize - 7; i++) {
  const b0 = b[i];
  const ok = (b0 === 0x48 || b0 === 0x4c || b0 === 0x44) && (b[i+1] === 0x8d || b[i+1] === 0x8b) && (b[i+2] & 0xc7) === 0x05;
  if (!ok) continue;
  const disp = b.readInt32LE(i + 3);
  const instrRva = fileToRva(i);
  if (instrRva < 0) continue;
  const target = (instrRva + 7 + disp) & 0xffffffff;
  for (const [name, t] of Object.entries(targets)) {
    if (target === t) results[name].push({ fileOff: i, rva: instrRva });
  }
}
for (const [name, hits] of Object.entries(results)) {
  console.log(`${name}: ${hits.length} 处`);
  hits.slice(0, 8).forEach(h => console.log(`  file=0x${h.fileOff.toString(16)} rva=0x${h.rva.toString(16)} va=0x${(0x140000000 + h.rva).toString(16)}`));
}
