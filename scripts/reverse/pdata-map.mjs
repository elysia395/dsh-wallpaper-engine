// pdata 定位函数边界
import fs from 'node:fs';
const b = fs.readFileSync('C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/wallpaper64.exe');
const peOff = b.readUInt32LE(0x3c);
const nSec = b.readUInt16LE(peOff + 6);
const optSize = b.readUInt16LE(peOff + 20);
const secOff = peOff + 24 + optSize;
const secs = [];
for (let i = 0; i < nSec; i++) {
  const so = secOff + i * 40;
  secs.push({ name: b.toString('ascii', so, so + 8).replace(/\0/g, ''), vaddr: b.readUInt32LE(so + 12), roff: b.readUInt32LE(so + 20), rsize: b.readUInt32LE(so + 16) });
}
const pdata = secs.find(s => s.name === '.pdata');
const targets = [0x14017ff00, 0x1401800b8, 0x14017fe00, 0x14017fc00, 0x140180113, 0x14005f5b0];
const n = pdata.rsize / 12;
for (let i = 0; i < n; i++) {
  const off = pdata.roff + i * 12;
  const begin = b.readUInt32LE(off);
  const end = b.readUInt32LE(off + 4);
  for (const t of targets) {
    const rva = t - 0x140000000;
    if (rva >= begin && rva < end) {
      console.log(`0x${t.toString(16)} -> func 0x${(begin + 0x140000000).toString(16)}-0x${(end + 0x140000000).toString(16)}`);
    }
  }
}
console.log('done');
